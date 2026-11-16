# ccrc history wave W2-6: the report-only counters, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Ship W2's report-only counters in ONE PR on `main`: the deploy lane's W2-6 (W2 decisions document §2, "the report-only counters (required, despite the name)"). It dispatches after W2-5b1 merges and may run beside W2-5b2 on this plan, which shows the two line-disjoint (Q29, W2-D3). It adds one standalone operator entry, `deploy/history-counters.mjs`, with two subcommands: `count`, which the operator runs on each named node after window end (decisions §5, act 23), and `combine`, which sums the nodes' reports into one arm comparison (U2). Per window of every listed family on a node's store, `count` reports the five spec counters (compliance, echo hits, lag, `card_served`, `card_id_mismatch`) and re-discovery, by arm and by the producer of the window's boundary, as the signed defaults part 1 carries (`counters_def: 'v1'`). Nothing it prints feeds `decideGate` (decisions §3 H: "The counters (W2-6) print alongside, never as inputs"). Task by task:
- **Task 1 (W2-D86's frame, W2-D87's names and sources, W2-D88's place and run checks, W2-D15, W2-D23, W2-D24, W2-D25, W2-D51, W2-D53; Q15, Q23, Q29; U1 to U8, U18; V1 to V4).** The module and everything later tasks share, owned once (U7, W2-5a's R3): the import block and its exact-names pin; `COUNTER_NAMES`, derived from the gate's `COUNTERS_DEF_V1`; the one unmeasured list, `COUNTER_UNMEASURED`, and the answer helpers; the spec shape `{source, measure(ctx), fold(values)}` and `COUNTER_MEASURES`, every entry `PENDING` until its task replaces its line; the frame (`windowCtx`, `windowRow`, `countersReport`, `stratify`), which builds one row per main boundary from the gate's `buildWindows`, `windowCopyOf` and `turnsOf` and strata by arm × producer, with changed families and every family whose verify state is not `ok` tallied apart, by arm and by producer (V1, V3); W2-D88's run checks in one ordered function (`checkCountInputs`), a verify output whose presence record has not seen the newest recall-off write refused among them (V2); the store handle (`openCounterStore`); `count`, through the driver's argv grammar, input loader, part 2 loader (`loadFinalRecord`, with Q23's `--allow-code-change` stamp) and `--out` rule; the report's `script_sha256`; and the pins that neither the driver nor the gate loads the counter, that `gate_code` does not hash it, and that the node-wide `counters` table is never read.
- **Task 2 (W2-D87, W2-D86, W2-D15, W2-D14; D-6562).** The five spec counters as five specs in Task 1's shape, each from its named source through the run's one read handle: compliance (the boundary leaf's `nodes.status`, folded as the `PARSE_STATUS` distribution and the ok+degraded share as `{num, den}`); echo hits (the stored `recall-echo` provenance in the window copy's rows, placed in the window by the gate's `windowOf`, the first `tool_result` read through `expandEntryBody`, beside the window's `recall_calls` with the gap reported); lag (the newest measured `ticks` row at or before the boundary); and `card_served` / `card_id_mismatch` (lib's `cardIdsIn`, `cardWindowComplete` and `decideCardDelivery` over the holding copy's first `CARD_MEASURE_ROWS` rows, one verdict projected twice), with a parity CONTROL against card.mjs's own `measureCardDelivery`.
- **Task 3 (W2-D86's unit, W2-D87's emission pin, W2-D88; D-6561; U2, U11).** Re-discovery, the sixth spec: a `Read` in the frame's turns 1 to K whose path, made absolute against N's epoch cwd, is the path of a `Read`, `Edit`, `MultiEdit`, `Write` or `NotebookEdit` tool_use in leaf N's span (`node_sources`, held equal to the driver's `spanRowsOf` by a parity pin); `PENDING` and `'pending'` removed; and `combine`, which checks each node report with its sha and re-folds the concatenated rows through Task 1's `stratify`, so counts add and no fold is spelled twice; node reports counted by two counter scripts are refused (V4).
- **Task 4 (W2-D86, W2-D87, W2-D88, W2-D3, W2-D4, W2-D5; Q29; U12 to U15; V1, V4, V5).** README's own paragraph, `**The W2 counters.**`; erratum E25 amended in place (the two "The live A/B" bullets for re-discovery and the five spec counters, each citing W2-6, its number and the signed defaults); the single-definition pin that `turnsOf` is declared in the gate alone and called by the gate and the counter alone (U12); the two prose pins; the Q29 disjointness measured hunk by hunk; the whole-PR checks; the PR.

Sessions see no change in behaviour: no hook, unit, timer, store, schema, wire, `ccd/**` or driver change, and the counter opens every store read-only. Running `count` or `combine` on a real node is the operator's, after the final W2 release is rolled out (W2-D6) and after window end (W2-D88), never the worker's.

**Architecture:** One new L4 operator script, its pins in two existing test files, one README paragraph and one spec erratum. Ring membership is a property of a file's imports.

*`deploy/history-counters.mjs`* (L4: it owns `fs`, `process` and the clock; mode 100755; shebang `#!/usr/bin/env -S node --no-warnings`) is a standalone ES module. It is **not** imported by `history-replay.mjs` and **not** in `gate_code` (W2-D88). Its layout, fixed by Task 1: the header comment and the import block; the names, words and answer helpers; the frame; the store handle; the commands; then the comment `// ── the measures, composed (W2-D87)`, which opens the block holding `PENDING` and `COUNTER_MEASURES`; then `main`; then the entry guard, the file's last block. Tasks 2 and 3 insert their sections directly above the "measures, composed" comment, in task order, so each spec is declared before `COUNTER_MEASURES` reads it. Its imports, one statement per module, pinned exactly (`W6C_EXPECTED_IMPORTS`, `W6C_EXACT_NAMES`, the shape of D-5814's pin):
- `node:fs`, `node:path`, `node:url`;
- `../ccd/history/lib.mjs` (Task 1: `BACKENDS`, `EXIT`, `SCHEMA_ADDED`, `UUID_RE`, `canonicalJson`, `sha256Hex`; Task 2 adds the card, status and provenance names);
- `../ccd/history/store.mjs` (`StoreError`, `openReader`, `userVersion`), `node:sqlite`'s sole importer, never named by the counter;
- Task 2 adds `../ccd/history/derive.mjs` (`holdingCopyOf`; Task 3 adds `epochOfUuid`) and `../ccd/history/recall.mjs` (`expandEntryBody`), directly after the store statement;
- `./history-gate.mjs` (W2-3's, imported, never edited): `ASSIGNMENT_ARMS`, `COUNTERS_DEF_V1`, `COUNTERS_DEF_V1_SHA256`, `K`, `K_UNIT`, `assembleReports`, `buildWindows`, `changedFamilies`, `familyKey`, `turnsOf`, `windowCopyOf`; Task 2 adds `windowOf`;
- `./history-replay.mjs` (the driver, imported, never edited): `AB_STATES`, `DriverRefusal`, `VERIFY_AB_KIND`, `loadFinalRecord`, `loadInput`, `parseArgs`, `prepareOut`, `refuse`. The edge runs one way only: W2-D88 forbids the driver importing the counter, and Task 1 pins that.

A task that adds a name inside a module's braces updates that module's `W6C_EXACT_NAMES` entry in the same commit; a new module statement updates `W6C_EXPECTED_IMPORTS` in the same commit.

The counter's shape, in the order a run takes it:
- **`count`'s inputs (Task 1).** `count --record <part 2> --record-sha256 … --part1 … --part1-sha256 … --frozen … --frozen-sha256 … [--supersedes … --supersedes-sha256 …] [--allow-code-change] --measure <this node's measure-history.py --families report> --measure-sha256 … --verify-ab <this node's verify --section ab output> --verify-ab-sha256 … --store <store path> --out <fresh dir>`. A flag outside the form is `args-invalid`. An existing `--out` is refused before anything is read. Part 2 comes through the driver's `loadFinalRecord` (W2-5b1's, the one part 2 loader: the sha before the bytes are parsed, the chain validated beside part 1 and the frozen list, W2-D24's re-check first, `--allow-code-change` taken at or after window start only and answered as a stamp, Q23). The measure and the verify output come through the driver's `loadInput` (sha before parse). Every refusal is a `DRIVER_REASONS` word thrown through the driver's `refuse`, printed `ccrc history-counters: <word>: <detail>`, before `prepareOut` makes `--out`.
- **The run checks (Task 1, W2-D88, U7).** `checkCountInputs`, in one order: the run is at or after `window.end_ms` (the window is half-open; `input-invalid`, `window-open: …`); the record's `counters_def` is the signed `v1` (`record-invalid`); `--store` is one of the record's nodes and the measure report is this store's (`input-invalid`); this node's verify output is `VERIFY_AB_KIND` v1, of this record and this store, listing exactly this store's assigned families at their arms (`input-invalid`, `verify-ab-…`); and, after those checks, its presence record has seen the newest recall-off write (`seen_after_write` true, W2-D84; `input-invalid`, `verify-ab-presence-stale: …`, V2). Then `assembleReports` (row cap, script sha, window echo, store, assignment; W2-D22), narrowed to this store's assignment, and `changedFamilies` over `w2.recall_off` (W2-D23; an absent list refuses, never reads as "nothing changed").
- **The frame (Task 1).** One row per main boundary of every found family the report lists: the gate's window, its copy (`windowCopyOf`) and its first K turns (`turnsOf(copy.rows).slice(0, K)`; both null exactly when the window is unmeasured), the producer as `windowOf` reads it (W2-D15), the arm, `changed`, the verify state and `unrealised` (any state but `AB_STATES[0]`, `ok`: W2-D23 as extended by Q15 and W2-D84's never-fold, U3 as V1 words it). Each spec's `measure(ctx)` is called for every row (U5) and answers `measured(value)` or `unmeasured(word)` with a `COUNTER_UNMEASURED` word; anything else is a defect.
- **The report (Task 1).** `counters.json` under a fresh `--out` (0700, the driver's marker), created `wx`, 0600, as `canonicalJson(report)` and one newline, whose sha is printed `sha256 <hex>` on stderr, stdout empty: `{kind: 'ccrc-history-w2-counters', v: 1, counters_def: {id: 'v1', sha256}, k, k_unit, record_sha256, script_sha256, read_ms, code_changed, store_id, record_nodes, user_version, inputs, window, sources: {frame, counters}, excluded, dropped: {changed, unrealised}, recall_off_gaps, windows, strata, dropped_strata: {changed, unrealised}}`. `record_nodes` lists the record's stores, so `combine` can name a node no report covers. `windows` holds every row; `strata[arm][producer | 'all']` holds rows that are neither changed nor unrealised; `dropped_strata[kind][arm][producer | 'all']` tallies each dropped kind (`changed`, `unrealised`) by arm and by producer (U8, V3). A count may be 0; a sum or a fold over no measured value is `null`.
- **`combine` (Task 3, U2).** `combine --node-report <counters.json> --node-report-sha256 … [repeated, one pair per node] --out <fresh dir>` writes `counters-combined.json`: every node report sha-checked, of one record, one window and one counter script (this one's; two scripts are refused, V4), each store once; the rows concatenated and re-folded through `stratify`; the record's stores no node report covers named in `nodes_missing`.

*`server/test/history-replay.test.ts`* gains one contiguous W2-6 region at ONE interior anchor (U4): directly after the three lines closing `describe('W2-5a fix wave: the review\'s minors', …)`, before W2-5b1's first appended block. Task 1 writes the region's opening comment, its import group, its module-scope fixtures, its describe, and a closing marker line, `// ── end of W2-6's region (Q29) ──…`; Tasks 2 to 4 insert their imports after the last import group and their fixtures and describes directly above the marker. Every module-scope binding in the region is `w6c`-prefixed (`w6c`, `W6C_`, `W6c`) and declared inside it; nothing is added to the file's top import block, and no existing line changes. Each task has its own top-level describe titled `W2-6 Task <N>: …`. *`server/test/single-definition.test.ts`* gains one describe at its end (Task 4, U12). *`README.md`* gains one paragraph and *the spec* two replaced lines (Task 4).

**Tech Stack:**
- Node `>=22.16.0` ES modules (`.mjs`). `node:sqlite` only through `store.mjs`'s `openReader` (read-only, `query_only`); importing the driver also loads `cli.mjs` (umask 0o077) and `node:sqlite`, which prints an `ExperimentalWarning` unless the process runs with `--no-warnings`.
- `deploy/history-gate.mjs` as W2-3 shipped it; `deploy/history-replay.mjs` as W2-4, W2-5a and W2-5b1 left it; `ccd/history/*` as W2-1 exported it; `deploy/measure-history.py`'s `--families` report and the driver's `verify --section ab` output, read as data.
- vitest 4 in `server/`: in-process for exported functions over hand-built stores (`createStore` under `mkTmp`), and `node --no-warnings` spawns of the counter for the direct-exec and stderr cases (skipped on darwin where a case runs the file itself).

**Spec:** `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md`, rev 3.6, as amended in place by W2-1. W2-6 holds the spec path (W2-D3) and amends **E25 only**, in Task 4, citing D-6561 and D-6562 (U14); no other row of decisions §6 names W2-6. Line numbers are hints measured at `4f560398c`; re-anchor by content: §10.2 "**The live A/B.**" (about :2739), the uptake bullet (about :2740), `- re-discovery: the same file re-read within 10 assistant turns of a compaction (*chosen*);` (about :2741), ``- compliance, echo hits, lag, `card_served`, `card_id_mismatch`;`` (about :2742) and the stratification bullet (about :2743); §6.2's `recall-echo` bullet (about :971).

**Ledger:** `docs/superpowers/programs/ccrc-history.md`: the W2-6 row ("after W2-5b1; beside W2-5b2 only on a line-disjoint plan the coordinator rules on (Q29)"), the W2-5b split's rulings Q15, Q23 and Q29, and "For W2-5b2's plan". The ledger and the decisions document are the coordinator's files; no task edits them.

**Authority:** the coordinator's rulings for this plan (U1 to U18, V1 to V5 after the plan review, and the two departures, in the Decisions table and "Deviations found"); then `docs/superpowers/plans/2026-10-19-ccrc-history-w2-decisions.md` (§2's "W2-6 (deploy)" entry, §3 I's W2-D86 to W2-D88 and the decisions they cite, §3 H's "print alongside, never as inputs", §4's `counters_def`, §5's acts 23, 24 and 29, §6's E25 row, §7's residuals); then the ledger's Q15, Q23 and Q29; then the spec; then the merged code at the base; then the W2-5a and W2-5b1 plans for house style (their numbers cited, never redefined). The decisions document was written at `bd363a76b` and amended in place since: every line it cites is a hint, and "Drifts since the decisions document" lists what moved. Where this plan and that document differ, the document wins and the worker reports the difference, except where a ruling or a departure below says otherwise. Re-read the merged code before relying on it: a plan text is never ground truth.

**Base:** `main` after W2-5b1 merges (U18), which holds `4f560398c` (W2-1, W2-2a, W2-3, W2-4 and W2-5a merged; W2-5b1's plan). Task 1's Step 0 checks that `deploy/history-counters.mjs` is absent and that `HANDLERS.set('arms'` and `HANDLERS.set('judge'` each appear once in the driver, and its Step 1 that the W2-5b1 names this plan imports are exported (`loadFinalRecord`, `FLAG_SPECS['allow-code-change']`); Task 4's Step 0 checks W2-5b1's merge commit is an ancestor. Either stops before any edit. Anchors are measured at `4f560398c` (hints), except README's, `ccd/history/lib.mjs`'s and `single-definition.test.ts`'s, which are re-measured (V5) against W2-2b's text at `42c9aaf24`, the head of W2-2b's PR (#1154, in its last re-review), which has merged `main` past `4f560398c`. Between `4f560398c` and the dispatch base lie: `main`'s own merges since (#1156, #1161 and #1165, of which only #1165 touches a W2-6 file: one README line changed in place, about :608, and one describe appended to `single-definition.test.ts`); W2-2b's merge (the headless seam, which W2-5b1 waits for), which edits `ccd/history/lib.mjs` (252 lines added, 5 of them above `PARSE_STATUS`, none inside the functions the counter imports), `README.md` (its headless-seam paragraph, `**The headless seam (W2's replay eval).**`, and its blank line, 30 lines inserted after the box-verbs paragraph and before the section's closing rule, its R11: on the dispatch base that paragraph already follows the box verbs), `single-definition.test.ts` (O14's `VOCABS` in place, gaining `RECALL_ARMS`, `HEADLESS_LIST_MAX_BYTES` and `HEADLESS_LIST_MAX_PAIRS`, and one describe appended after #1165's), `shared/lifecycle.ts`, `ccd/history/cli.mjs`, `ccd/history/sweep.mjs` and `lib.d.mts`; and W2-5b1's, which edits the driver and `history-replay.test.ts` only. So lib's line hints and `single-definition.test.ts`'s last line move, README's lines from the section's closing rule on move by the seam paragraph's 30, and every anchor is re-found by its content. README above that rule is unmoved down to the box verbs' last line; the gate, the store, recall.mjs, derive.mjs, card.mjs and the spec are untouched by all of them, and so is W2-6's own README gap, between the card-line and box-verbs paragraphs. If W2-2b's re-review changes its text before it merges, Task 1's Step 1 and Task 4's Steps 0 and 5 re-find these anchors by content all the same:
- `deploy/history-gate.mjs`: `GATE_CODE_FILES` (about :145), `turnsOf` (about :221), `windowCopyOf` (about :244), `producerCopyOf` (about :252), `windowOf` (about :266), `buildWindows` (about :293), `changedFamilies` (about :539), `assembleReports` (about :592), `COUNTERS_DEF_V1` (about :1931), `COUNTERS_DEF_V1_SHA256` (about :1978);
- `deploy/history-replay.mjs`: `DRIVER_REASONS` (about :69), `parseArgs` (about :146), `prepareOut` (about :412), `openReplayStore` (about :2723), `spanRowsOf` (about :2773), `VERIFY_AB_KIND` (about :4775), `AB_STATES` (about :4784), `loadInput` (about :4856), `abStateOf` (about :5196); W2-5b1's `loadFinalRecord(flags, {nowMs, root})` and `recheckCode(record, root, opts)`, per its plan's Task 1;
- `ccd/history/lib.mjs`, measured at `42c9aaf24` (at `4f560398c` in brackets): `PARSE_STATUS` (about :270; :265), `BACKENDS` (about :302; :297), `provenanceOf` (about :1480; :1475), `CARD_MEASURE_ROWS` (about :9330; :9078), `cardIdsIn` (about :9348; :9096), `cardWindowComplete` (about :9370; :9118), `decideCardDelivery` (about :9377; :9125); `ccd/history/store.mjs`: `openReader` (about :284); `ccd/history/recall.mjs`: `expandEntryBody` (about :1752); `ccd/history/derive.mjs`: `holdingCopyOf` (about :1381), `epochOfUuid` (about :1388); `ccd/history/card.mjs`: the private `deliveryOf` (about :474), `measureCardDelivery` (about :507);
- `server/test/history-replay.test.ts` (10,678 lines at the base): the closing lines of `describe('W2-5a fix wave: the review\'s minors', …)` (about :10676-10678), after which W2-5b1's appended describes follow on the dispatch base;
- `server/test/single-definition.test.ts` (8,496 lines at `4f560398c`, 8,566 at `42c9aaf24`): its last line, the `});` closing W2-2b's describe `ccrc history: the headless marker and the arm words are defined once, in lib.mjs, and read one way (…; W2-2b Task 1)` (about :8520 to :8566 at `42c9aaf24`), which follows #1165's appended describe (about :8503); `4f560398c`'s last line (about :8496) is now interior;
- `README.md`, measured at `42c9aaf24`, each line where `4f560398c` has it: "### Session history: lossless recall (`ccrc history`)" (about :5784), the card-line paragraph `**The card line.**` (about :5832) to its last line `… whether the line arrived and named its leaf.` (about :5839), `**Box verbs and operator verbs.**` (about :5841) to its last line `… which the operator removes by hand.` (about :5866); then, new on the dispatch base, W2-2b's seam paragraph (about :5868 to :5896, its last line ending `nothing is counted.`) and the section's closing `---` (about :5898; :5868 at `4f560398c`).

## Global Constraints

- **One PR, deploy lane.** Executed in task order, one commit per task (four). Dispatched after W2-5b1 merged (U18), beside W2-5b2 under Q29 and W2-D3's peer protocol; whichever lands second merges `main` (never a rebase) and keeps both sides.
- **Exactly five paths.** Create `deploy/history-counters.mjs` (mode 100755); modify `server/test/history-replay.test.ts`, `server/test/single-definition.test.ts`, `README.md` and the spec. The plan file is the one other path a commit may touch, only to define a number issued during the build or to correct a prediction, under the task whose prediction it was (U17). A worker who finds another file unavoidable stops and mails the coordinator.
- **Never touched:** `deploy/history-gate.mjs`, `deploy/history-replay.mjs`, `deploy/measure-history.py`, `ccd/**`, `shared/**`, `.github/**`, `CLAUDE.md`, the ledger, the decisions document, and every other test file (re-run, never edited). A mutant applied in place is restored byte for byte (`cmp`) before the next step.
- **Report-only (W2-D88, decisions §3 H).** No counter value reaches `decideGate` or any gate input; the driver and the gate never load the counter, and `GATE_CODE_FILES` never lists it (Task 1's pins and mutant M17), so every report names the counter's own bytes (`script_sha256`).
- **Per window, by arm and by producer, as signed defaults (W2-D87, W2-D15).** Every counter's name is `COUNTERS_DEF_V1`'s, derived and never spelled as a string; the report carries `counters_def: {id: 'v1', sha256: COUNTERS_DEF_V1_SHA256}` and refuses a record whose `counters_def` differs.
- **The node-wide `counters` table is never read**, neither in the store nor as the measure report's `counters` field (Task 1's scan and throwing fixture row; Task 2's `FROM counters` scan). Every figure names its source in `sources`.
- **Unmeasured is never 0.** An unmeasured window or counter answers its own `COUNTER_UNMEASURED` word; a fold is never called on no values and its summary is then `null`; counts of rows may be 0. No two conditions share one word.
- **A gap is reported, never repaired:** echo hits against `recall_calls` (Task 2), `changedFamilies`' gap rows (`recall_off_gaps`, Task 1).
- **Read-only stores, no decode outside W2-1's exports (W2-D51, W2-D86).** Every store read opens through `openReader`; no `deploy/history-*.mjs` spells a `node:sqlite` specifier (W2-4's scan) or decodes a blob itself (W2-5a's W2-D74 scan); bodies come from `expandEntryBody`.
- **Single definition (W2-D12, W2-D86).** The turn rule, the window rule, both copy rules and the card decisions are the gate's and lib's, imported; part 2 is loaded by the driver's `loadFinalRecord`; `turnsOf` is declared in the gate alone and called by the gate and the counter alone, on one code line of the counter (Task 4's pin, U12). Each second spelling the PR keeps is named with its pin: the card glue (D-6562, Task 2's parity CONTROL), the leaf-of-boundary rule (the driver's module-private `LEAF_OF_BOUNDARY_SQL` after W2-5b1; spelled once in the counter, `counterStmts`' `leaves` read by `boundaryLeafOf`, whose node id Task 3's span reads; held by Task 2's M1 and by Task 3's span parity pin, which reads through that node id), the leaf span (Task 3's parity pin against `spanRowsOf`), the store opener (Task 1's parity case against `openReplayStore`), the 256 MiB read cap and `combine`'s list-flag pairing (named residuals).
- **No new vocabulary (U1).** Refusals are `DRIVER_REASONS` words through the driver's `refuse`; the counter declares no refusal list and no O14 `VOCABS` name (D-5774); `COUNTER_UNMEASURED` is the one report list, appended in place.
- **No environment, never a shell.** `main(argv)` reads no `process.env`; `--store` names the store; the counter spawns nothing.
- **Live safety.** Tests use `mkTmp` fixture HOMEs and hand-built fixture stores only; nothing runs `ccd`, `ccrc`, `claude`, the shim, `sweep.mjs`, `cli.mjs`, `measure-history.py` or `history-replay.mjs` as a process, and nothing reads `~/.ccrc`, `~/.cc-sessions`, `~/.cc-limits` or an account home. Nothing spawns a model.
- **Fixtures.** Paths are `mkTmp` paths or synthetic `/home/u/...`; key-shaped values are assembled at runtime from parts; test strings stay ASCII.
- **Running tests.** From `server/`, `./node_modules/.bin/vitest run test/<file> -t '<regex>'`, in the foreground, timeout at least 600000 ms, one suite per tool call, never bare `npx vitest`; a run that reports only skipped tests selected nothing and is not green; CLAUDE.md's load flakes are re-run alone before a red is called a break.
- **Red-first.** Every new guard is watched red on the unguarded code (prediction written before the run), then each named mutant red, then green; a red at a CONTROL is the fixture's to fix. Scratch goes under `.superpowers/sdd/history-w2-6/` (gitignored), never `git stash`.
- **Every commit green.** Each task leaves every suite green at its own commit, the whole of `history-replay.test.ts` and `single-definition.test.ts` included; no task depends on a later one.
- **Citations and growth.** No added code or test line cites `file.mjs:N`, `file.ts:N` or `ccd:NNNN` (`citations.test.ts`, D-5893); `GROWTH_FILES` (D-6178) lists none of the PR's files.
- **D-numbers.** This plan defines D-6561 and D-6562 in "Deviations found", on `main` before dispatch; a number issued during the build is defined there by the commit that first cites it. No placeholder departure token reaches a commit (`dtbd.test.ts`); never a range, never an invented number; before the PR, `git fetch origin main` then `cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts`.
- **Commits.** Subjects `feat(history-counters): … (W2-6 Task <N>; …)` (Task 4: `docs(history-counters): …`), each message ending with the Co-Authored-By line the session's attribution reminder gives, passed as a second `-m` from `CO_AUTHORED_BY` set in the same command; a correction commit names the task that owns the code, `fix(history-counters): … (W2-6 Task <N>; …)`.
- **Public repo.** No host, user, account, wrapper, lane, pool, session or person name, no private project name, no IP address, no absolute home path, no private ticket id and no docserver URL, in plan text, fixtures, comments, commits or the PR body; Task 4 runs the private-name count over every added line, every commit message and the PR body, and it must print 0.
- **Node floor** `>=22.16.0`, unchanged. **macOS:** cases that run the counter as a file skip on darwin (`skipIf(process.platform === 'darwin')`); nothing assumes `/proc`.
- **Peers.** Before the first edit of each existing file, read `GET /api/claims?project=ccrc-pwa`.

## Decisions

| # | Decision | Status | Task(s) |
|---|---|---|---|
| W2-D86 | **Re-discovery is required, report-only.** Windows and turns from the gate's `turnsOf` and window builder over `measure-history.py`'s raw rows; bodies through `openReader` and W2-1's exports; a `Read` in turns 1 to 10 whose absolute path is a span `Read`/`Edit`/`MultiEdit`/`Write`/`NotebookEdit` path (`notebook_path` for `NotebookEdit`, D-6561); an indicator and the distinct-path count, by arm and by producer; changed families dropped from the arm comparison only; Bash reads uncounted (residual); the single-definition pin naming the gate and the counter as `turnsOf`'s only callers. | coordinator ruling (W2 decisions document) | 1 (frame), 3 (unit), 4 (pin, README, E25) |
| W2-D87 | **The five spec counters**, all, per window, by arm and by producer, as signed defaults (`counters_def: 'v1'`), each source named, none from the `counters` table: echo hits (structural `recall-echo`, not an error, beside `recall_calls`, the gap reported); compliance (the boundary leaf's `PARSE_STATUS`, plus the ok+degraded share); lag (newest measured tick at or before the boundary); `card_served` / `card_id_mismatch` (lib's card functions over the holding copy). Every emitted counter named in `COUNTERS_DEF_V1`, none missing. | open-record default | 1 (names, frame, sources, emission pin), 2 (the five), 3 (the sixth), 4 (README, E25) |
| W2-D88 | **W2-6's place.** A standalone entry, not imported by the driver, not in `gate_code`; merged before part 1, so in the piloted tag; run by the operator on each named node after window end. | coordinator ruling | 1 (load pins, run checks, `script_sha256`), 3 (`combine`), 4 (README, PR) |
| Q29 | **Beside W2-5b2 on a line-disjoint plan:** W2-6 may run beside W2-5b2 under W2-D3 if its plan shows the two line-disjoint; the coordinator rules on the plan before dispatching them together. This plan's "Q29" section is that showing. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1 (placement), 4 (measured) |
| Q23 | **`--allow-code-change`:** none for the pilot forms, `marker` and `verify`; arms, judge and report after window start only, stamping every output. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1 (through U6) |
| Q15 | **`unrealised` comes from the per-node `verify --section ab` outputs, sha-checked.** A treatment family whose file names its generation (`treatment-named`) also leaves the comparison (V1). | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1 (through U3 and V1) |
| U1 | **The driver's helpers, imported.** history-counters.mjs imports the driver's exported helpers (`parseArgs` with its own specs, `refuse`/`DriverRefusal`, `loadInput`, `loadFrozenList`, `familiesOf`, `insideGitTree`, `prepareOut`, `recheckCode`). Its refusal words are `DRIVER_REASONS` under its own prefix. W2-D88 forbids only the driver importing the counter. *Applied as (this plan's reading):* W2-5b1's `loadFinalRecord` runs `loadFrozenList`, `familiesOf`, `insideGitTree` and `recheckCode` for its callers, so the counter imports `loadFinalRecord` in their place, beside `parseArgs`, `refuse`, `DriverRefusal`, `loadInput`, `prepareOut` and the verify words `AB_STATES` and `VERIFY_AB_KIND`. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1 |
| U2 | **One node per run, and a `combine`.** `--measure` is this node's file and the strata are per node. A later W2-6 task adds `combine`, which sums the per-node `counters.json` files, each passed with its sha, so the cross-node arm comparison stays W2-6's, not W2-5b2's report's. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1, 3 |
| U3 | **Both W2-D23 drops.** The per-arm counters drop changed families (W2-D86) and assignment-unrealised ones (W2-D23), the latter from each node's `verify --section ab` output, sha-checked. *Amended by V1:* every family whose verify state is not `ok` is dropped, each state listed apart; W2-D23 as extended by Q15 and W2-D84's never-fold (where U3 said "no departure"). | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1, 4 |
| U4 | **One interior test anchor (Q29).** W2-6's tests are whole describes at one interior anchor in `history-replay.test.ts`: directly after W2-5a's last describe, before W2-5b1's first appended block. No existing line is edited; W2-5b2 appends at the end of the file. Every W2-6 test import lives inside W2-6's block, `w6c`-prefixed; fixtures are hoisted to module scope inside the region, `w6c`-prefixed; each task has its own top-level describe, "W2-6 Task <N>: …". | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1 to 4 |
| U5 | **Every measure, every boundary.** The frame calls every measure for every boundary, unmeasured windows included. Each measure answers window-unmeasured itself when it needs turns. *Applied as (this plan's reading):* echo hits need the window's bounds rather than its turns, and answer `window-unmeasured` on an unmeasured window too; re-discovery needs the turns; compliance, lag and the card read the boundary and are measured there. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1, 2, 3 |
| U6 | **`--allow-code-change` on `count`**, after window start only, stamping the counters report `code_changed`, as `report` does (Q23). | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1 |
| U7 | **Ownership.** Task 1 owns the frame, `CounterStore`, the spec shape, `stratify`, `COUNTER_UNMEASURED`, report composition (`countersReport`) and the W2-D88 input checks, in one ordered function. Tasks 2 and 3 add their counter specs in Task 1's shape, and append their unmeasured words to Task 1's list in place. The integrator reconciles every name to the owner's. Task 1's main calls the composed specs once per node. *Applied as:* `main` runs `count`, whose `countCommand` hands `COUNTER_MEASURES` to `countersReport` once per node's run. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1, 2, 3 |
| U8 | **Changed families apart.** They are kept out of the arm × producer cells and tallied apart by producer; per-window rows carry `changed: true`. *Amended by V3:* both dropped kinds are tallied by arm as well as by producer, `dropped_strata[kind][arm][producer \| 'all']`. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1, 3 |
| U9 | **Echo hits read the stored provenance.** `entries.provenance` with `prov_version`; a `prov_version` mismatch is counted `prov_stale`; no re-pairing walk. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 2 |
| U10 | **Untimed echo rows** are counted over the positional range (the boundary to the next main boundary). A named residual. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 2 |
| U11 | **The span's path, made absolute** against N's epoch cwd, is a reading, not a departure; E25 states it. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 3, 4 |
| U12 | **The `turnsOf` callers pin lands in Task 4**, after the counter first calls `turnsOf`, so every commit stays green. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 4 |
| U13 | **README names the entry and its rules, not the argv.** The module's usage text is the one spelling. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 4 |
| U14 | **README's paragraph sits at its own anchor**, which Task 4 names and W2-5b2's driver paragraph cannot overlap. The spec errata are W2-6's own rows only (E25), each citing its number. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 4 |
| U15 | **The carry into W2-5b2's plan:** keep off W2-6's README paragraph region, its spec errata rows and their buffer lines, `single-definition.test.ts`'s W2-6 describe, and W2-6's test region. The coordinator writes it into the ledger. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 4 (Q29 table) |
| U16 | **Decisions §2's "one README line"** is amended in place to "one README paragraph" at the coordinator's next ledger edit. No number. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 4 |
| U17 | **Plan-text commits** are allowed for build-time numbers and corrected predictions, under the task whose prediction it was. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | all |
| U18 | **The base is `main` after W2-5b1 merges**; Task 1's Step 0 checks that W2-5b1's arms and judge handlers exist. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1, 4 |
| V1 | **Every non-`ok` verify state drops its family (amends U3's wording).** The per-arm counters drop every family whose verify state is not `ok`, and list each state separately: `control-absent` and `control-mismatch` (W2-D23's assignment-unrealised); `treatment-named` (Q15: "a treatment family whose file names its generation also leaves the comparison"); `unreadable` (unmeasured is never folded, W2-D84). U3's "no departure" becomes "W2-D23 as extended by Q15 and W2-D84's never-fold"; the Drifts row, `FRAME_SOURCES.unrealised`, README's paragraph and E25 say so. The coordinator carries this exact state set into W2-5b2's plan, so its report's per-arm uptake drops the same families. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1 (the drop, its case and mutant M43), 4 (README, E25, their mutants M11 and M13) |
| V2 | **A stale presence record refuses.** A verify output whose `seen_after_write` is not `true` (the presence record has not seen the newest recall-off write) refuses `input-invalid` (`verify-ab-presence-stale: …`) in `checkCountInputs`, after the verify output's own checks. The fixture is corrected to `seen_after_write: true` with `seen_ms` after `newest_write`. A red-first case, a CONTROL and a mutant. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1 (the check, its case, CONTROLs and mutants M40 and M41) |
| V3 | **The dropped tallies are keyed by arm (amends U8).** `dropped_strata.changed` and `dropped_strata.unrealised` are keyed by arm as well as producer: `dropped_strata[kind][arm][producer \| 'all']`. Task 1's strata, frame and combine assertions gain that level. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1 (`stratify`, its cases and mutant M42), 2 (the frame case), 3 (`combine`'s case) |
| V4 | **The integrator's open points.** W2-6 imports W2-5b1's `loadFinalRecord` (one part 2 loader, which W2-5b2's report also uses), and Task 1's Step 1 stops if W2-5b1 did not ship it as planned; the verify output must name the current part 2's sha, and a mid-window amendment means re-running `verify --section ab` before `count`, stated as operator guidance in README's paragraph; `combine` refuses node reports counted by different counter scripts (a `script_sha256` mismatch); echo hits answer `boundary-absent` when the store does not hold the boundary (confirmed). | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1 (Step 1), 2 (`boundary-absent`), 3 (`combine`'s two-scripts case and mutant M20), 4 (README, mutant M12) |
| V5 | **The stale README map (review F2).** The Base paragraph, the Q29 table and the PR body reflect that W2-2b's headless-seam paragraph already sits after the box-verbs paragraph on the dispatch base; README's, `lib.mjs`'s and `single-definition.test.ts`'s anchors are re-measured against W2-2b's text at `42c9aaf24`; W2-5b2's README slot is after W2-2b's seam paragraph, or wherever W2-5b2's plan puts it outside W2-6's lines. W2-6's own insertion point is unaffected. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | Base, Q29, 4 (Steps 5, 6 and 10, the PR body) |
| W2-D15 | **The producer stratum** is `pickHoldingCopy`'s copy over its `models` (`windowOf`'s `producer`); the window's turns come from `windowCopyOf`'s copy, never the producer's (D-5771). | coordinator ruling | 1, 2, 3 |
| W2-D13, W2-D14, W2-D17 | **Raw rows in, the window in Node.** K turns, the next-boundary end, `unmeasured` and `<synthetic>` rows are the gate's (D-5770); the counter adds no window rule. | coordinator ruling | 1, 2, 3 |
| W2-D22, W2-D23 | **The report's checks and the drops.** `assembleReports` checks row cap, script sha, window echo, store and assignment and lists `excluded`; `changedFamilies` over `w2.recall_off` and the verify output's states drop families from the strata only, gaps reported. | coordinator ruling | 1 |
| W2-D24, W2-D25 | **A `--record` consumer.** Part 2 sha-checked before parse, validated beside part 1 and the frozen list, the code re-checked before any other input is read: all `loadFinalRecord`'s. | coordinator ruling | 1 |
| W2-D51, W2-D53, W2-D57 | **Store and `--out`.** `openReader` only; `--out` 0700 with the driver's marker through `prepareOut`, fresh; the printed sha line, stdout empty. | coordinator ruling | 1, 3 |
| W2-D12, W2-D59 | **No vocabulary of the counter's own.** `DRIVER_REASONS` words through the driver's `refuse`; no `VOCABS` name. | coordinator ruling | 1, 3 |
| W2-D6 | **The build freeze.** The counter ships in W2's final release and runs on the frozen tree; a moved tree refuses `code-changed` unless U6's stamp applies. | coordinator ruling | 1 |
| W2-D3, W2-D4, W2-D5 | **Claims, numbers, tests.** W2-6 holds the spec path and amends its own erratum (E25); a number is defined once; no new test file. | coordinator ruling | 4 |

## Review Focus

These six inputs follow from the decisions and rulings, would mislead the operator or the eval, and are each pinned by the named task's tests. The reviewer probes beyond the pins.

1. **A counter that reaches the gate, or a node-wide total read as a window's.** A driver line that loads `history-counters.mjs` (static, dynamic or by string); a `GATE_CODE_FILES` entry for it; a line that reads the measure report's `counters` field or `FROM counters`. Expected: each scan red, with its CONTROL; a report whose `counters` row throws when read still builds. **Task 1** (the load, `gate_code` and `counters` pins; mutants M17 and M19), **Task 2** (the `FROM counters` scan).
2. **Unmeasured read as 0, or folded into another word.** An unmeasured window (row cap before turn 11), a boundary with no leaf or two, a boundary the store holds at another line than the measure reported, no copy, no measured tick, a card window still open at the read instant, a tombstoned or undecodable turn body, an unresolvable relative path with no hit already found, an empty stratum. Expected: each its own `COUNTER_UNMEASURED` word, `turns` and `recall_calls` `null` on an unmeasured row, `summary` `null` on a stratum with no measured window, no fold called on nothing. **Task 1** (the null rules, mutants M6, M7 and M25), **Task 2** (`boundary-absent`, `boundary-moved`, `leaf-ambiguous`, `no-measured-tick`, `card-wait`, `boundary-uncopied`), **Task 3** (the `it.each` over the unmeasured words, and a hit kept beside an unresolved path).
3. **A window, turn, copy or card rule spelled again, or the wrong copy read.** Two copies of one boundary where `windowCopyOf` and `pickHoldingCopy` disagree; a turn key or longest-copy rule in the counter; an inclusion rule outside the gate; the card glue drifting from card.mjs's. Expected: turns from the window copy, producer and card from the holding copy; the scans red; the card parity CONTROL's served and mismatch counts equal to `measureCardDelivery`'s on the same store. **Task 1** (the two-copy CONTROL, mutants M4 and M5), **Task 2** (the module scan, the parity CONTROL and its mutants), **Task 3** (the turn-key scan), **Task 4** (the `turnsOf` pin).
4. **A dropped family in the arm comparison, or missing from the rows.** A family whose recall-off file changed in the window; a family whose verify state is any of the four that are not `ok`, a treatment family's `treatment-named` and an `unreadable` file included (V1); a dropped family tallied under the other arm, or by producer alone (V3); a gap row. Expected: the family in `windows` with `changed` or `unrealised` true, in `dropped` under its own state word, tallied in `dropped_strata[kind][arm][producer]` under its own arm, absent from every arm stratum; the gap in `recall_off_gaps`, dropping nothing; an absent `w2.recall_off` refused. **Task 1** (mutants M2, M3, M10, M24, M42 and M43), **Task 3** (`combine`'s `dropped_strata`, mutant M14).
5. **A run on the wrong inputs, or one that leaves a partial `--out`.** A run before window end; a record under other definitions; a store not of the record, a measure or verify output of another store or record, a verify output missing a family or listing one twice, a verify output whose presence record has not seen the newest recall-off write (V2); a moved tree with and without `--allow-code-change`; an existing `--out`; a required flag missing, `--supersedes` without its sha, a relative `--out`. Expected: each refused with its driver word before `prepareOut`, in `checkCountInputs`' order, so no `--out` is left; a run at `end_ms` exactly measured; a stamped run carries `code_changed: true`. **Task 1** (mutants M12, M13, M21 to M23, M26, M27, M30 to M33, M39, M40 and M41).
6. **A cross-node sum that is not a sum.** Node reports of two records, two counter scripts (V4) or one store twice; a node of the record with no report; a combine that copies one node's strata or folds with code other than the counting script's. Expected: each refused `input-invalid`; a row or an answer off the shapes `count` writes refused `counters-shape`, never folded or coerced (review 963 F1); a node no report covers named in `nodes_missing`; the combined strata equal `stratify` over the concatenated rows, their window counts the nodes' sums. **Task 3** (mutants M13 to M15, M18, M20 and M21 to M36), and **Task 2**'s M35 (the prototype-less fold), which guards the cross-node fold too (review 966 F4).

## File Structure

| Path | Action | Responsibility | Ring | Task(s) |
|---|---|---|---|---|
| `deploy/history-counters.mjs` | create (100755) | **Task 1:** the header comment, the shebang, every import statement, `COUNTER_NAMES`, `COUNTER_UNMEASURED`, `measured`, `unmeasured`, `nonEmpty`, `FRAME_SOURCES`, `ALL_PRODUCERS`, `COUNTERS_KIND`, `COUNTERS_FILE`, `MEASURE_CAP`, `AB_OK`, `checkMeasures`, `answerOf`, `gateRefusal`, `changedOf`, `windowCtx`, `windowRow`, `abStatesOf`, `checkCountInputs`, `countersReport`, `stratify`, `tallyOf`, `scriptSha256`, `refuseStore`, `openCounterStore`, `COUNTER_FLAG_SPECS`, `COUNTER_FORMS`, `COUNTER_SUBCOMMANDS`, `checkFormFlags`, `refuseUnlessFresh`, `writeReport`, `COUNT_DEPS`, `countCommand`, `PENDING`, `COUNTER_MEASURES`, `main`, the entry guard. **Task 2:** seven `COUNTER_UNMEASURED` words; `counterStmts`, `boundaryLeafOf`, `complianceAt`, `foldCompliance`, `lagAt`, `foldLag`, `insideWindow`, `firstToolResult`, `echoAt`, `foldEcho`, `cardAt`, `cardVerdictOf`, `foldCardFor`, `COMPLIANCE`, `ECHO_HITS`, `LAG`, `CARD_SERVED`, `CARD_ID_MISMATCH`, five `COUNTER_MEASURES` lines. **Task 3:** six words, `'pending'` and `PENDING` removed; `REDISCOVERY_READ_TOOL`, `REDISCOVERY_PATH_FIELD`, `REDISCOVERY_SOURCE_TOOLS`, `toolPathsOf`, `absolutePath`, `rediscoveryVerdict`, `rediscoveryStmts`, `leafSpanRowsOf`, `bodyFor`, `rediscoveryAt`, `foldRediscovery`, `REDISCOVERY`; `COUNTERS_COMBINED_KIND`, `COUNTERS_COMBINED_FILE`, `COMBINE_SAME`, `combineRow`, `combineReports`, `combineCommand`; `combine`'s form and flags. | L4 (operator script) | 1–3 |
| `server/test/history-replay.test.ts` | modify | The W2-6 region at U4's anchor: **Task 1** the region comment, the `w6c` imports and module-scope fixtures, its describe, the closing marker; **Task 2** its imports, fixtures and two describes; **Task 3** its fixtures and two describes; **Task 4** two prose-pin describes. No existing line changes. | test | 1–4 |
| `server/test/single-definition.test.ts` | modify | One describe appended at the end: `turnsOf` declared in the gate alone, the gate and the counter its only callers (W2-D86, U12). | test | 4 |
| `README.md` | modify | One paragraph, `**The W2 counters.**`, between the card-line paragraph and the box-verbs paragraph of "Session history". | docs | 4 |
| `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md` | modify | E25 in place: two bullets of §10.2's "The live A/B" list replaced. | docs | 4 |
| `docs/superpowers/plans/2026-10-22-ccrc-history-w2-6-counters.md` | modify only per U17 | "Deviations found" and corrected predictions | plan | as needed |

## Q29: line-disjoint from W2-5b2

W2-5b2 is not planned yet. Its known scope (ledger, "W2-5b split" and "For W2-5b2's plan"): the driver, README's driver paragraph, the spec errata E2, E7 to E11 and E19 to E24, and its own describes appended to `history-replay.test.ts`. Two edits merge cleanly only when at least one unchanged line lies between them. Anchors are measured at `4f560398c`, README's and `single-definition.test.ts`'s at `42c9aaf24`, W2-2b's text (V5); Task 4's Step 6 re-measures them on the PR's diff and copies the counts into the PR body. The right-hand columns are what the coordinator carries into W2-5b2's plan (U15), beside one carry that is not a line: W2-5b2's report drops, from its per-arm uptake, exactly the families this counter drops, every family whose `verify --section ab` state is not `ok` (`control-absent`, `control-mismatch`, `treatment-named` and `unreadable`, V1).

| File | W2-6 edits these lines, and only these | W2-5b2 keeps off | Why the two cannot meet |
|---|---|---|---|
| `deploy/history-counters.mjs` | the whole new file | the whole file | W2-5b2 never names it; Task 1's pin reds if the driver loads it |
| `deploy/history-replay.mjs` | none (imported only) | the names the counter imports keep their signatures (`AB_STATES`, `VERIFY_AB_KIND`, `loadFinalRecord`, `loadInput`, `parseArgs`, `prepareOut`, `refuse`, `DriverRefusal`), and the driver names no `turnsOf` | a W2-5b2 change to one of them is caught by Task 1's Step 1 export check and by the counter's cases on the merge; a driver line naming `turnsOf` reds Task 4's pin, so that is a coordinator ruling first |
| `server/test/history-replay.test.ts` | one contiguous region inserted directly after the three lines closing `describe('W2-5a fix wave: the review\'s minors', …)` (about :10676-10678 at the base), before W2-5b1's first appended block, ending at its marker line `// ── end of W2-6's region (Q29) ──…`; every module-scope binding declared inside it, `w6c`-prefixed; nothing added to the file's top import block; no existing line changed | W2-6's region and the first line of W2-5b1's first appended block (the region's trailing context); W2-5b2's own describes go at the end of the file | W2-5b1's appended blocks lie between the two insertions, so git merges them cleanly |
| `server/test/single-definition.test.ts` | one describe appended after the file's last line (Task 4): on the dispatch base the `});` closing W2-2b's appended describe (about :8566 at `42c9aaf24`, after #1165's describe), never `4f560398c`'s last line (V5) | W2-6's describe and its buffer line, the line before it (U15) | W2-5b2's known scope does not touch the file. Both PRs appending at the file's end would share one hunk, so a W2-5b2 describe there needs the coordinator's line-disjoint ruling first |
| `README.md` | one paragraph and its blank line, inserted between `… whether the line arrived and named its leaf.` (about :5839) and `**Box verbs and operator verbs.**` (about :5841), the same lines at `4f560398c` and at `42c9aaf24` (V5: W2-2b's paragraph lies below them); no existing line changed | the card-line paragraph (`**The card line.**`, about :5832, to :5839), the gap, and the box-verbs paragraph's first line. On the dispatch base W2-2b's headless-seam paragraph already follows the box-verbs paragraph (W2-2b's R11; about :5868 to :5896 at `42c9aaf24`), so W2-5b2's driver paragraph goes after the seam paragraph's last line (`… nothing is counted.`, about :5896) and before the `---` that closes the section (about :5898 at `42c9aaf24`, :5868 at `4f560398c`), or wherever W2-5b2's plan puts it outside W2-6's lines (V5) | the box-verbs paragraph and W2-2b's seam paragraph, about 56 unchanged lines (:5841 to :5896 at `42c9aaf24`), lie between the two insertions |
| the spec | two lines of §10.2's "The live A/B" list replaced in place (about :2741 and :2742) | those two lines and their buffers, the uptake bullet (about :2740) and the stratification bullet (about :2743); W2-5b2's errata sit in §8.2, §8.3, §9.4, §9.7, §10.2's reconstruction, Answerability, writer, headless-on, Scoring and Pre-registration text, and §10.6 | the nearest W2-5b2 erratum, E23's "Pre-registration", ends about :2736; the lines between are unchanged by both |
| the errata W2-6 owns (decisions §6's E25 row, read only: the decisions document is never edited here) | no line of the decisions document; the spec's two E25 lines, the row above, are W2-6's only erratum edit, citing D-6561 and D-6562 | E2, E7 to E11, E19 to E24, each citing its own number | no shared row, and no shared "Deviations found" entry, so `deviation-refs` cannot red on the pair |

## Drifts since the decisions document

The decisions document was written at `bd363a76b`; the anchors are measured at `4f560398c` and W2-5b1's plan, README's, lib's and `single-definition.test.ts`'s at `42c9aaf24`, W2-2b's text (V5). Each row: what the document says, what the code or text says, and what that changes here.

| Document says | Code or text | Effect | Task |
|---|---|---|---|
| §2, W2-6: "Waits for: W2-5b merged" | The ledger splits W2-5b: W2-6 after W2-5b1, beside W2-5b2 on a line-disjoint plan (Q29) | Step 0 checks W2-5b1 merged; the Q29 table above | 1, 4 |
| §2, W2-6: "one README line" | W2-6's own paragraph, so its anchor can be named apart from W2-5b2's (U14) | A 19-line paragraph and its blank line; §2 amended by the coordinator (U16) | 4 |
| §2, W2-6: the counter imports "`turnsOf`, the window builder and `COUNTERS_DEF_V1`" | The gate's `Window` carries no `file_id`, and `assembleReports` answers measured windows only and drops each boundary's copies | The frame calls `assembleReports` for its checks and `excluded`, and `buildWindows` per found family zipped with its boundaries; it also imports `windowCopyOf`, `K`, `ASSIGNMENT_ARMS` and `COUNTERS_DEF_V1_SHA256` | 1 |
| W2-D24, W2-D25: every `--record` consumer loads and re-checks part 2 | W2-5b1's plan exports `loadFinalRecord(flags, {nowMs, root})`, "the one part 2 loader" W2-5b's consumers share, with Q23's stamp | The counter imports it (U1) and spells no record loader; `code_changed` is its stamp or `assembleReports`' (U6) | 1 |
| W2-D23: per-arm counters drop changed **and** assignment-unrealised families; W2-D86 names changed only | The unrealised verdict comes from each node's `verify --section ab` output (Q15), whose states are the driver's `AB_STATES` | `count` takes `--verify-ab`; every family whose state is not `AB_STATES[0]` (`ok`) is dropped, each state listed apart: `control-absent` and `control-mismatch` (W2-D23's assignment-unrealised), `treatment-named` (Q15) and `unreadable` (W2-D84's never-fold). W2-D23 as extended by Q15 and W2-D84's never-fold, not a departure (U3 as V1 words it); `FRAME_SOURCES.unrealised`, README and E25 say so | 1, 4 |
| W2-D84: `verify --section ab` checks "`status`'s `recall_off.seen_ms` is later than the newest write"; W2-D88's run checks name no such check | The driver's verify output carries that verdict as `seen_after_write` beside `seen_ms` and `newest_write` | `checkCountInputs` refuses an output whose `seen_after_write` is not `true` (`verify-ab-presence-stale`), after the verify output's own checks (V2) | 1 |
| E25 and W2-D86 cite §10.2:2729-2730 (and :2720) | The counter bullets are at about :2741-2743 | Re-anchored by content | 4 |
| W2-D87: `provenanceOf` at lib.mjs:1416-1438, spec §6.2:970 | About lib.mjs:1480 at `42c9aaf24` (:1475 at `4f560398c`); the `recall-echo` bullet about :971 | Cited by symbol; echo hits read the stored `entries.provenance` (U9) | 2 |
| W2-D87: the card counters use "the same functions the sweep's card measure uses (card.mjs:405-425), so no rule is spelled again" | Those lines are a header comment; the measure is card.mjs's private `deliveryOf` (about :474); only `cardIdsIn`, `cardWindowComplete`, `decideCardDelivery` and `CARD_MEASURE_ROWS` are lib exports | The three functions imported and called once each; the glue spelled again, held by a parity CONTROL (D-6562) | 2 |
| W2-D87 names no attachment size bound | card.mjs skips an attachment whose `raw_len` exceeds `CARD_ATTACHMENT_MAX_BYTES` before decoding | The same bound, for parity; each skip counted `attachments_unread` | 2 |
| W2-D87: echo rows "whose tool_result is not an error" | `entries` has no error column; `is_error` lives in the blob body | Read through `expandEntryBody`; the row's first `tool_result` block, `is_error === true` an error, absent not | 2 |
| W2-D86 and `COUNTERS_DEF_V1`'s signed text: "the `file_path` of a … NotebookEdit tool_use" | `NotebookEdit` names its file `notebook_path` (lib's `toolUseInputPath`, derive's card fields, W2-5a's `MINE_PATH_FIELDS`) | `REDISCOVERY_PATH_FIELD.NotebookEdit = 'notebook_path'`; the signed text and its sha untouched (D-6561) | 3 |
| W2-D86: entry bodies "through `store.mjs openReader` and W2-1's exports" | W2-5a's `spanRowsOf` lives in the driver over a `ReplayStore` that builds a pair index | The counter spells its own `node_sources` span query, held equal to `spanRowsOf` by a parity pin; a named residual | 3 |
| W2-D88: "the operator runs it on each named node after window end" | Nothing enforces the timing, and `gate_code` does not hash the counter | `checkCountInputs` refuses before `window.end_ms` (half-open) and the report carries `script_sha256` | 1 |
| W2-D13's per-family list omits `recall_off` | `measure-history.py` emits `w2.recall_off` raw `[k, v]` rows (W2-1) | Changed families come from it through `changedFamilies`; an absent list refuses | 1 |
| README has no W2 driver paragraph (S1 gives it to W2-5b2) | At `4f560398c` "Session history" ends with the box-verbs paragraph, then `---` (about :5868); at `42c9aaf24`, W2-2b's text, the headless-seam paragraph follows the box verbs (its R11; about :5868 to :5896) and `---` moves to about :5898 | W2-6's paragraph goes before the box verbs, at lines W2-2b did not move; W2-5b2's goes after W2-2b's seam paragraph, or wherever W2-5b2's plan puts it outside W2-6's lines (V5) | Base, Q29, 4 |

## Not in this plan

- **W2-5b2 (deploy), "the pilot and the verdict":** `step0b`, `fidelity`, `pilot-result`, `open --amend`, `handcheck`, `report` and `decideGate`'s inputs, the edit of `open --finalize`, README's driver paragraph, and the spec errata E2, E7 to E11 and E19 to E24. W2-6 never edits the driver, and the counter's reports are never one of `report`'s inputs to the gate.
- **The gate and its signed text.** `COUNTERS_DEF_V1`, its sha, `turnsOf`, the window builder and the validator are W2-3's and stay as merged; a correction to the signed `NotebookEdit` text, or to the gate, is a later PR's.
- **Moving card.mjs's glue into lib** so the counter imports it: a later `ccd/**` follow-up (D-6562).
- **A counter descoped at open** takes its D-number then (W2-D87, decisions §7); none is reserved here.
- **The rollout.** Through the release lane only, in W2's final release rolled onto every named node before part 1 (W2-D6). The coordinator's or the operator's, never the worker's.
- **The window and its operator acts** (decisions §4 and §5): `measure-history.py --families`, `verify --section ab` and `count` on each named node after window end (act 23), gathering the reports and `combine` (act 24), copying them out and removing each `--out` by hand (act 29). No step runs `count` or `combine` on a real node or store.
- **The ledger and the decisions document** (U15's carry, U16's wording, and V1's carry: W2-5b2's report drops from its per-arm uptake exactly the families this counter drops, every verify state but `ok`): the coordinator's.

## The PR

**PR:** One PR against `main`, on this workspace's own branch, executed in task order, with one commit per task:
1. `feat(history-counters): the report-only counter module and its frame: the gate's windows and turns, by arm and by producer, both drops, the run checks, the counters table never read (W2-6 Task 1; W2-D86, W2-D87, W2-D88, W2-D15, W2-D23; D-5770, D-5771)`;
2. `feat(history-counters): the five spec counters per window, by arm and by producer (W2-6 Task 2; W2-D87, W2-D86, W2-D15; D-6562)`;
3. `feat(history-counters): re-discovery, and combine over the nodes' reports (W2-6 Task 3; W2-D86, W2-D88; D-6561)`;
4. `docs(history-counters): README's counters paragraph, spec erratum E25 in place and the turnsOf callers pin (W2-6 Task 4; W2-D86, W2-D87, W2-D88)`.

A fix one of Task 4's checks calls for is a correction commit under the owning task's number, before the push. Task 1 goes first: every later task reads its imports, frame, store handle, helpers and test fixtures. Task 2 needs Task 1; Task 3 needs Tasks 1 and 2 (it reuses `boundaryLeafOf` and removes `PENDING` once every counter is wired); Task 4 needs Tasks 1 to 3 and runs last. Every task leaves every suite green at its commit. This PR changes no `.github/` file, so CI runs its selection; the PR body asks the coordinator to check that the `select tests` summary lists `history-replay` and `single-definition` (and the README readers `history-cli`, `history-skill`, `history-lib`, `readme-holds` and `topology-clean`), since a new `deploy/` file is one the dependency map has not yet traced. The PR is opened by Task 4's last step, only after its whole-PR checks, ready for review (not a draft), titled **"ccrc history wave W2-6: the report-only counters"**, with the body Task 4 gives.

The plan's `## Deviations found` comes at its end, after Task 4. It defines D-6561 and D-6562, issued for the departures found while planning, and any number issued during the build, each by the commit that first cites it.

---

### Task 1: the counter module and its frame: windows and turns from the gate, by arm and by producer, both drops, W2-D88's run checks, and the structural pins

This task creates `deploy/history-counters.mjs`, the standalone entry W2-D88 names, and gives it everything the later W2-6 tasks fill in (U7). No counter is measured yet: each of the six answers `unmeasured` (`pending`) until its own task replaces its one line in `COUNTER_MEASURES`. What lands here:
- **`count`:** run by the operator on each named node after window end. Its inputs are part 2 with part 1 and the frozen list (through the driver's `loadFinalRecord`), this node's `measure-history.py --families` report, this node's `verify --section ab` output, and the read-only store path. It writes one report, `counters.json`, under a fresh `--out`, and prints `sha256 <hex>` on stderr with stdout empty (W2-D57's shape);
- **W2-D88's run checks, in one ordered function** (`checkCountInputs`, U7): after window end, the signed `v1` definitions, a store of the record, a measure of this store, a verify output of this record and store listing exactly this store's assigned families, and, after those, a verify output whose presence record has seen the newest recall-off write (V2);
- **the frame:** one row per main boundary of every found family on this store, with the gate's window, the gate's window copy and its first K turns (W2-D14, W2-D15, D-5770, D-5771), the arm, the boundary's producer, `changed` (W2-D23's change rows) and `unrealised` (every verify state but `ok`: W2-D23 as extended by Q15 and W2-D84's never-fold, U3 as V1 words it). It strata by arm × producer (lib's `BACKENDS`, plus a pooled `all`), keeps changed and unrealised families out of the arm cells and tallies each kind apart, by arm and by producer (U8, V3);
- **the spec contract:** a counter is `{source, measure(ctx), fold(values)}`. A measure answers `measured(value)` or `unmeasured(word)` with a `COUNTER_UNMEASURED` word; anything else is a defect. A fold is never called on no values, and the summary is then `null`, never 0;
- **the report:** `counters_def`, `script_sha256` (gate_code does not hash the counter), the read instant, and `code_changed` (Q23's stamp, U6);
- **the pins:** W2-D87's names (derived, never spelled; every row, stratum and source map carries exactly them); the node-wide `counters` table never read (a scan, and a report whose `counters` row throws when read); and neither `history-replay.mjs` nor the gate loading the counter, nor `gate_code` hashing it (W2-D88).

**What this task owns for the whole PR** (U7; W2-5a's R3 rule). Later W2-6 tasks build on these pieces and never spell them again:
- **The import block and its pin** (`W6C_EXPECTED_IMPORTS`, `W6C_EXACT_NAMES`). A later task that adds a name inside a module's braces updates that module's entry in the same commit; a new module statement updates `W6C_EXPECTED_IMPORTS`.
- **`COUNTER_UNMEASURED`** and the answer helpers `measured`, `unmeasured` and `nonEmpty`. Each counter's task appends its own words in place; Task 3 removes `'pending'`.
- **`COUNTER_MEASURES`**, in the block the comment `// ── the measures, composed (W2-D87)` opens. Each counter's task replaces exactly its own line and inserts its section directly above that comment.
- **The frame** (`windowCtx`, `windowRow`, `countersReport`, `stratify`, `tallyOf`) and the `WindowCtx` it hands a measure; **the run checks** (`checkCountInputs`); **the store handle** (`openCounterStore`, `CounterStore = {db, storeId, version, schema, close}`, whose `{db, version, schema}` is `expandEntryBody`'s `rc`); **the commands' table** (`COUNTER_FLAG_SPECS`, `COUNTER_FORMS`) and `writeReport`.
- **The test region** (U4): the region comment, the `w6c` import group, the module-scope fixtures, and the closing marker line above which every later task inserts its describes.

**Decisions:** W2-D86 (the frame: the gate's windows and turns, by arm and by producer, changed families out of the arm comparison only); W2-D87 (the names, every source named, the `counters` table never read, the emission pin); W2-D88 (standalone, not in `gate_code`, run after window end); W2-D15 (the producer is `windowOf`'s; the turns come from `windowCopyOf`'s copy, D-5771); W2-D14 (K, the end rule and `unmeasured` are the gate's); W2-D13 and W2-D22 (`assembleReports`' checks and `excluded`); W2-D23 with Q15 and U3 (both drops); W2-D24, W2-D25 and Q23 with U6 (`loadFinalRecord`, its stamp); W2-D51 (`openReader` only); W2-D53 (`--out` through `prepareOut`, fresh); W2-D12 and W2-D59 with U1 (the driver's words only); U2 (one node per run); U4 (the region); U5 (every measure, every boundary); U7; U8 with V3 (the dropped tallies by arm and producer); U18; V1 (every non-`ok` state dropped, each listed apart); V2 (a stale presence record refused); V4 (`loadFinalRecord` imported, Step 1 stops without it).

It cites D-5770 and D-5771 (W2-3's plan), D-5774 (the deploy-local vocabularies), D-5814 (W2-4's import pin, whose shape this pin copies) and D-5893 (the citation ratchet). It defines no number and cites neither planning departure.

**Files:**
- Create: `deploy/history-counters.mjs`, mode 100755 like the driver (`chmod 755` before `git add`).
- Modify: `server/test/history-replay.test.ts`. Insert one region directly after the three lines that close `describe('W2-5a fix wave: the review\'s minors', () => {`:

  ```ts
      expect(src[0], 'not spelled a second time').not.toMatch(/'v1'/);
    });
  });
  ```

  At `4f560398c` these are the file's last lines (about :10676-10678); on this task's base W2-5b1's appended describes follow them, and the region goes between the two. No existing line of the file is edited.
- Not edited: everything else (Global Constraints).

**Interfaces:**
- Consumes (as merged on `main`; Step 1 confirms each export):
  - `./history-gate.mjs`: `turnsOf(rows): Turn[]` (`Turn = {key, first_line, first_ts_ms, rows}`); `windowCopyOf(copies): Copy | null`; `producerCopyOf(copies)` (tests only); `buildWindows(family, k = K): Window[]`, one window per boundary in order (`Window = {boundary_uuid, ts_ms, producer, state, start_ms, end_ms, end_inclusive, turns, calls, with_call}`, `turns` 0 on an unmeasured window); `windowOf(boundary, calls, k)` (tests only); `assembleReports(reports, record, {allowCodeChange})` answering `{ok: true, families, excluded: {not_found, zero_windows, unmeasured: {count, keys}, not_listed}, code_changed}` or `{ok: false, reason, detail}`, throwing a `TypeError` on a malformed report; `changedFamilies(metaRows, window, list)` answering `{changed, gaps}`, throwing on a presence row off W2-D30's grammar; `familyKey`; `COUNTERS_DEF_V1` (names `compliance`, `echo_hits`, `lag`, `card_served`, `card_id_mismatch`, `rediscovery`) and `COUNTERS_DEF_V1_SHA256`; `K = 10`, `K_UNIT`, `ROW_CAP`, `ASSIGNMENT_ARMS = ['treatment', 'control']`, `GATE_CODE_FILES` (tests only).
  - `./history-replay.mjs`: `parseArgs(argv, {specs, subs})`; `refuse(word, detail): never` and `class DriverRefusal {word, detail}`; `loadInput(label, p, sha256, words = INPUT_WORDS, cap)` answering `{path, sha256, value}` (`args-invalid` for a sha that is not hex, then `input-invalid` for a git-tree path, an unreadable file or bytes that are not JSON, `input-sha-mismatch` before the bytes are parsed); `prepareOut(out)` (0700, marker `OUT_MARKER`, `out-refused`); `loadFinalRecord(flags, {nowMs, root})` (W2-5b1) answering `{record, sha256, frozen: {sha256, list, families}, stamps}`, whose refusals are the record chain's, then `args-invalid` (`--allow-code-change` before window start), `code-unmeasured` or `code-changed`, then the part 2 ranges; `AB_STATES` (`['ok', 'control-absent', 'control-mismatch', 'treatment-named', 'unreadable']`), `VERIFY_AB_KIND`, `abStateOf` (tests only); tests only: `openReplayStore(home)`, `DRIVER_REASONS`, `OUT_MARKER`, `FLAG_SPECS`, and `verifyAbReport({recordSha256, storeId, families, newest, seen})`, whose `seen_after_write` the V2 case's CONTROL reads.
  - `../ccd/history/lib.mjs`: `BACKENDS`, `EXIT`, `SCHEMA_ADDED`, `UUID_RE`, `canonicalJson`, `sha256Hex`; tests only: `historyPaths`, `RECALL_OFF_KEYS`.
  - `../ccd/history/store.mjs`: `openReader(dbPath)` (throws `StoreError(word)` for a missing, zero-byte or unmeasured store), `userVersion(db)`, `StoreError`; tests only: `createStore(home, {storeId})`.
  - `measure-history.py --families`' report, read as data: `{store_id, user_version, script_sha256, counters, w2: {row_cap, window_start_ms, window_end_ms, families, recall_off: [k, v][]}}`. The frame never reads its `counters`.
  - `verify --section ab`'s output, read as data: `{kind: VERIFY_AB_KIND, v: 1, record_sha256, store_id, families: [{ccrc_id, generation, arm, state}], counts, newest_write: {state: 'absent'} | {state: 'value', ms} | {state: 'unmeasured', code}, seen_ms: number | null, seen_after_write, ok}`; `seen_after_write` is the driver's verdict that `seen_ms` is later than the newest write (W2-D84), `false` whenever `newest_write` is `unmeasured` (the presence directory could not be measured, or is not a directory), and the counter reads it, never recomputes it (V2). The counter does not read `ok`, which folds the presence verdict with every family's state.
- Produces (`deploy/history-counters.mjs`, exported unless marked):
  - `COUNTER_NAMES`: `Object.freeze(COUNTERS_DEF_V1.map((c) => c.name))`;
  - `COUNTER_UNMEASURED`, frozen: `'window-unmeasured'` and `'pending'` here;
  - module-private `measured(value): Measure`, `unmeasured(why): Measure` (throws a `TypeError` for a word outside the list) and `nonEmpty(name, values)` (a fold's guard: throws on an empty list);
  - `Measure = {state: 'measured', value} | {state: 'unmeasured', why}`; `CounterSpec = {source: string, measure: (ctx: WindowCtx) => Measure, fold: (values: unknown[]) => unknown, answer?: (value: unknown) => boolean}` (`answer`, review 963 F1: the shape of the measured value the counter writes, which combine checks; Tasks 2 and 3's six specs state it, a stand-in spec need not);
  - `WindowCtx`, frozen: `{rs: CounterStore, family: {key, store_id, ccrc_id, generation, arm}, boundary, window, copy: Copy | null, turns: Turn[] | null, calls, nowMs}`; `copy` and `turns` are null exactly when `window.state` is `'unmeasured'`;
  - `windowCtx({rs, family, boundary, window, calls, nowMs}): WindowCtx`, the one place the counter calls `turnsOf`;
  - `windowRow({ctx, changed, abState, measures}): Row`, where `Row = {family, store_id, ccrc_id, generation, arm, changed, unrealised, ab_state, boundary_uuid, ts_ms, producer, state, turns: number | null, recall_calls: number | null, measures: Record<name, Measure>}`;
  - `checkCountInputs({record, recordSha256, report, ab, rs, nowMs}): {assignment, abStates: Map<key, state>}`;
  - `countersReport({record, recordSha256, inputs, report, ab, rs, measures, nowMs, stamps = [], allowCodeChange = false}): CountersReport` (the shape in the header);
  - `stratify(rows, measures): {strata: Record<arm, Record<producer | 'all', Tally>>, dropped_strata: {changed: Record<arm, Record<producer | 'all', Tally>>, unrealised: Record<arm, Record<producer | 'all', Tally>>}}` (V3: each dropped kind keyed by arm, then producer), where `Tally = {windows, measured_windows, unmeasured_windows, turns: number | null, recall_calls: number | null, counters: Record<name, {measured, unmeasured, unmeasured_by, summary: unknown | null}>}`;
  - `scriptSha256(): string`; `openCounterStore(dbPath): CounterStore`, its refusals word for word `openReplayStore`'s;
  - `FRAME_SOURCES`, `ALL_PRODUCERS = 'all'`, `COUNTERS_KIND = 'ccrc-history-w2-counters'`, `COUNTERS_FILE = 'counters.json'`, `COUNTER_FLAG_SPECS`, `COUNTER_FORMS` (`{count: {required, optional, run}}`), `COUNTER_SUBCOMMANDS = Object.keys(COUNTER_FORMS)`, `COUNTER_MEASURES`;
  - `countCommand(flags, deps = COUNT_DEPS): number`, `main(argv, deps = COUNT_DEPS): number`, where `COUNT_DEPS = {loadFinal: loadFinalRecord, now: () => Date.now()}`;
  - module-private: `MEASURE_CAP`, `AB_OK`, `PREFIX`, `checkMeasures`, `answerOf`, `gateRefusal`, `changedOf`, `abStatesOf`, `tallyOf`, `refuseStore`, `checkFormFlags`, `refuseUnlessFresh`, `writeReport`, `PENDING`.
- Produces (test side): the region comment and marker; the `w6c` import group; the module-scope bindings `w6cGate`, `w6cDrv`, `w6cLib`, `w6cStore`, `W6C_SRC`, `W6C_DRIVER`, `W6C_GATE`, `w6cLoad`, `W6C_NAMES`, `w6cIsComment`, `w6cCode`, `w6cRefusalOf`, `w6cInProcess`, the fixtures `W6C_STORE`, `W6C_OTHER`, `W6C_T0`, `W6C_DAY`, `W6C_WINDOW`, `W6C_AFTER`, `W6C_RECORD_SHA`, `W6C_SCRIPT_SHA`, `w6cGen`, `w6cRef`, `W6C_F_T` to `W6C_F_O`, `w6cKeyOf`, the instants `W6C_B1`, `W6C_B2`, `W6C_BC`, `W6C_BX`, `W6C_BU`, `W6C_CHANGE_TS` and `W6C_GAP_TS`, `w6cArow`, `w6cCopyOf`, `w6cFam`, `w6cFamilies`, `w6cRecallOffRows`, `w6cPlainReport`, `w6cReport`, `w6cRecordOf`, the presence instants `W6C_AB_WRITE` and `W6C_AB_SEEN`, `w6cAbOf`, `W6C_RS`, `W6C_INPUTS`, `w6cProbe`, `w6cFrame`, `w6cMeasuredAs`, `w6cUnmeasuredAs`, `w6cNode`; the types `W6cR` and `W6cRefusal`; and the describe `W2-6 Task 1: the counter module, its frame and its pins (W2-D86, W2-D87, W2-D88)`, 31 cases, one skipped on darwin. Later tasks may use any of these; Task 3's `w6cT3NodeB` uses `W6C_B1`.

**Choices this task makes:**
- **The driver's helpers, imported (U1).** The argv grammar (`parseArgs` with the counter's own specs), the refusal, the input loader, the part 2 loader, `--out`'s rule and the verify words. Importing the driver loads `cli.mjs` (umask 0o077) and `node:sqlite`, so the shebang carries `--no-warnings`, as the driver's does. The counter's refusal words are `DRIVER_REASONS`, printed under its own prefix `ccrc history-counters:`.
- **One part 2 loader.** `count` calls the driver's `loadFinalRecord(flags, {nowMs})`, which W2-5b1 built as the one loader W2-5b's part 2 consumers share. It refuses a record that is not part 2, checks the chain, re-checks `gate_code` first (W2-D24), and takes `--allow-code-change` at or after window start only, answering `['code-changed']` as a stamp (Q23, U6). The counter writes that stamp, or `assembleReports`' own `code_changed` under the same flag, as the report's `code_changed`. Tests inject `loadFinal` and `now`; the driver's own cases pin the loader. It is the one part 2 loader W2-5b2's report also uses (V4), so the counter spells none: Step 1 stops if W2-5b1 did not ship it as its plan states.
- **One node per run (U2).** `--measure` and `--verify-ab` are this node's files; the record's assignment is narrowed to this store before `assembleReports`, so no other node's family reads `not_listed` here. The cross-node sum is Task 3's `combine`.
- **W2-D88's run checks, in one order (U7).** `checkCountInputs` refuses before any window is built: the window end first (the act's precondition, half-open, so a run at `end_ms` exactly is after it), then the signed definitions, then the store, the measure's store and the verify output, and last the verify output's presence record (V2). `assembleReports`' and `changedFamilies`' refusals follow in `countersReport`.
- **assembleReports' refusal words.** `code-changed` and `code-unmeasured` are `DRIVER_REASONS` words and stay themselves; every other gate word concerns an input the operator handed in, so it refuses `input-invalid` with the gate's word leading the detail (`row-cap-mismatch: …`). A `TypeError` from `assembleReports` and any throw from `changedFamilies` are `input-invalid` too.
- **An absent `w2.recall_off` is refused**, never read as "nothing changed"; an empty list is measured: nothing changed.
- **A stale presence record is refused (V2, W2-D84).** A verify output whose `seen_after_write` is not `true` has a presence record that has not been seen after the newest recall-off write, or a newest write the driver could not measure (`newest_write` `unmeasured`), so a control file written after the sweep last looked is unconfirmed: `checkCountInputs` refuses it `input-invalid` (`verify-ab-presence-stale: …`), after the verify output's own checks (its kind, record, store and families), so a verify output of another record still names that first. Only `true` passes: `false`, an absent field or a string `'true'` refuses alike. The detail prints `newest_write`, so an unmeasured newest write is told apart from a presence record that has not caught up; its remedy names both. The counter reads the driver's verdict and never recomputes it from `seen_ms` and `newest_write`.
- **The unrealised families (U3 as V1 words it: W2-D23 as extended by Q15 and W2-D84's never-fold).** The per-arm counters drop every family whose verify state is anything but `AB_STATES[0]` (`ok`, the realised answer, held to `abStateOf`'s by a CONTROL), and list each state separately: W2-D23's assignment-unrealised, a control family whose write was refused or never made (`control-absent`, `control-mismatch`); Q15's "a treatment family whose file names its generation also leaves the comparison" (`treatment-named`, recall off for a treatment family); and an unreadable file (`unreadable`, a realisation nobody measured, which W2-D84 never folds). None of them can be compared as its arm. `dropped.unrealised` lists each state's families apart, never folded; `FRAME_SOURCES.unrealised` names the four states from `AB_STATES`, never spelled. The V1 case drops each of the four in turn, each on a family of the arm it belongs to.
- **Every measure, every boundary (U5).** The frame calls every measure for every boundary of every found family the report lists, unmeasured windows and `zero_windows` families included; a measure that needs the window answers `window-unmeasured` itself. A `found: false` family has no boundary and no row; it is reported in `excluded.not_found`.
- **Unmeasured is never 0.** A row of an unmeasured window carries `turns: null` and `recall_calls: null`; a stratum with no measured window carries `null` sums and each counter's `summary` is `null` there; `windows`, `measured` and `unmeasured` are counts of rows and may be 0.
- **Strata (U8, V3).** For each arm in `ASSIGNMENT_ARMS` a stratum per producer in lib's `BACKENDS` and a pooled `all`, over rows that are neither changed nor unrealised; `dropped_strata.changed` and `dropped_strata.unrealised` tally those rows by arm and then by producer, the same `[arm][producer | 'all']` shape as `strata` (V3), so a dropped treatment family is never read beside the control arm's. A family both changed and unrealised is tallied in both. A row whose arm, producer or verify state is outside its list is a defect (`TypeError`).
- **A fresh `--out`.** `count` refuses an `--out` that exists (`out-refused`, `exists: a counter report goes under a fresh --out`) before it reads anything. Every refusal of an input comes before `writeReport`'s `prepareOut`, so a refused run leaves no `--out`; the one exception is `writeReport`'s own: a write failure after `prepareOut` made `--out` refuses `out-refused` and leaves the marked `--out`, which a re-run then refuses as existing (a residual, review 963 F6). `counters.json` is created `wx`, mode 0600; the sha line is the sha of the bytes written.
- **No environment.** `main` takes `argv` only; the counter spawns nothing.

**Residuals, named:**
- **Two input pieces are spelled a second time:** the store opener (held word for word to `openReplayStore` by a parity case) and the 256 MiB read cap (`MEASURE_CAP`, the driver's private `OUT_STREAM_CAP`, no pin).
- **The fresh-`--out` check races** with another process that makes the same path before `prepareOut`; `prepareOut` then reuses a marked directory, and the `wx` create refuses a second `counters.json`.
- **The import pin has a known width:** a specifier assembled from pieces, or a name pulled by a namespace import and a computed key, is not seen; review is the backstop, as for D-5814's pin.
- **A verify output must name this part 2 (V4).** An operator who amends part 2 mid-window re-runs `verify --section ab` against the new record (it is read-only) on each node before `count`; README's paragraph states it as operator guidance (Task 4), and `checkCountInputs` refuses an output of another record (`verify-ab-record-mismatch`) rather than read it.
- **The counter is a second creator of the `history-replay-out` class.** `count` (and Task 3's `combine`) make their `--out` through the driver's `prepareOut`, which writes the driver's `OUT_MARKER`, but `shared/lifecycle.ts` names `deploy/history-replay.mjs` as that class's only creator (`lifecycle.test.ts` pins the list), and W2-6 never touches `shared/**`. Nothing reds; adding the counter to the class's `creators` is a follow-up outside W2-6's files, which the PR body names for the coordinator to carry.

- [ ] **Step 0: Check the base.** From the repository root, before any edit. Before the first edit of each existing file, read the claims (Global Constraints).

```bash
git fetch origin main
test ! -e deploy/history-counters.mjs && echo 'counter absent' || echo 'STOP: deploy/history-counters.mjs exists'
grep -c "^HANDLERS.set('arms'" deploy/history-replay.mjs
grep -c "^HANDLERS.set('judge'" deploy/history-replay.mjs
```

Expected: `counter absent`, `1`, `1`. The two `1`s mean W2-5b1 has merged (U18). On `STOP`, or on a `0`, make no edit and report to the coordinator.

- [ ] **Step 1: Confirm the anchors, the exports, the names and the warning.** From the repository root:

```bash
grep -c "^export const COUNTERS_DEF_V1 = Object.freeze(\[$" deploy/history-gate.mjs
grep -c "^export const COUNTERS_DEF_V1_SHA256 = '[0-9a-f]\{64\}';$" deploy/history-gate.mjs
grep -c '^export function turnsOf(rows) {$' deploy/history-gate.mjs
grep -c '^// The entry guard stays the LAST block of this file' deploy/history-replay.mjs
grep -c '^#!/usr/bin/env -S node --no-warnings$' deploy/history-replay.mjs
grep -c "recall_off" deploy/measure-history.py
grep -cF "expect(src[0], 'not spelled a second time').not.toMatch(/'v1'/);" server/test/history-replay.test.ts
grep -cF "describe('W2-5a fix wave: the review\\'s minors', () => {" server/test/history-replay.test.ts
grep -cE '\bw6c|W6C_|W6c' server/test/history-replay.test.ts
node --no-warnings --input-type=module -e "
const g = await import('./deploy/history-gate.mjs'); const d = await import('./deploy/history-replay.mjs');
const l = await import('./ccd/history/lib.mjs'); const s = await import('./ccd/history/store.mjs');
const want = { g: ['ASSIGNMENT_ARMS', 'COUNTERS_DEF_V1', 'COUNTERS_DEF_V1_SHA256', 'K', 'K_UNIT', 'ROW_CAP', 'GATE_CODE_FILES', 'assembleReports',
    'buildWindows', 'changedFamilies', 'familyKey', 'producerCopyOf', 'turnsOf', 'windowCopyOf', 'windowOf'],
  d: ['AB_STATES', 'DRIVER_REASONS', 'DriverRefusal', 'FLAG_SPECS', 'OUT_MARKER', 'VERIFY_AB_KIND', 'abStateOf', 'loadFinalRecord', 'loadInput',
    'openReplayStore', 'parseArgs', 'prepareOut', 'refuse', 'verifyAbReport'],
  l: ['BACKENDS', 'EXIT', 'RECALL_OFF_KEYS', 'SCHEMA_ADDED', 'UUID_RE', 'canonicalJson', 'historyPaths', 'sha256Hex'],
  s: ['StoreError', 'createStore', 'openReader', 'userVersion'] };
const mods = { g, d, l, s };
console.log(Object.entries(want).flatMap(([m, ns]) => ns.filter((n) => mods[m][n] === undefined).map((n) => m + '.' + n)).join(' ') || 'all present');
console.log(g.COUNTERS_DEF_V1.map((c) => c.name).join(' '));
console.log(l.sha256Hex(l.canonicalJson(g.COUNTERS_DEF_V1)) === g.COUNTERS_DEF_V1_SHA256);
const words = ['args-invalid', 'out-refused', 'input-invalid', 'input-sha-mismatch', 'record-invalid', 'record-sha-mismatch', 'code-changed', 'code-unmeasured', 'store-unreadable'];
console.log(words.filter((w) => !d.DRIVER_REASONS.includes(w)).join(' ') || 'words present');
console.log(g.GATE_CODE_FILES.includes('deploy/history-counters.mjs'), d.parseArgs.length, d.loadInput.length, d.loadFinalRecord.length, d.FLAG_SPECS['allow-code-change']);
console.log(l.BACKENDS.join(' '), '|', g.ASSIGNMENT_ARMS.join(' '), '|', d.AB_STATES.join(' '), '|', d.VERIFY_AB_KIND);"
node --input-type=module -e "await import('node:sqlite');" 2>&1 | grep -c 'ExperimentalWarning'
```

Expected (predicted from `4f560398c`'s text and W2-5b1's plan):
- `1` five times; then a count of at least `1` (measure-history.py emits `w2.recall_off`; 5 at `4f560398c`);
- `1`, `1`: W2-5a's last describe and its closing case are where the region goes;
- `0`: the `w6c` prefixes are free;
- the node lines print `all present`; `compliance echo_hits lag card_served card_id_mismatch rediscovery`; `true`; `words present`; `false 1 3 2 bool`; `anthropic other unknown | treatment control | ok control-absent control-mismatch treatment-named unreadable | ccrc-history-w2-verify-ab`;
- the last line prints `1`: this Node warns on loading `node:sqlite`.

On any other count or print, stop and report the anchor or export that moved. A missing `loadFinalRecord`, a `loadFinalRecord.length` other than `2` or an `allow-code-change` other than `bool` means W2-5b1's Task 1 shipped another shape than its plan states: stop, make no edit, and report it to the coordinator (V4: the counter imports W2-5b1's loader, the one part 2 loader W2-5b2's report also uses, and never spells one of its own). A missing `verifyAbReport` (W2-5a's, which the V2 case's CONTROL reads) is reported the same way. If the warning line prints `0`, Step 3's prediction for the direct-exec case does not change (it asserts an empty stderr either way), but mutant M16's prediction drops to one red; report it.

- [ ] **Step 2: Write the failing tests.** In `server/test/history-replay.test.ts`, after the three lines Step 1 counted, insert one blank line and then:

```ts
// ── W2-6: the report-only counters (W2-D86, W2-D87, W2-D88; Q29) ─────────────────────────────────────────────────────
// W2-6's one region of this file (Q29, U4): whole describes inserted between W2-5a's last describe and W2-5b1's first
// appended block, so W2-5b2's appends at the end of the file never share a hunk with it. No line outside the region is
// edited. Every module-scope binding the region declares, its imports included, is w6c-prefixed and declared here,
// never in the file's top import block; each W2-6 task adds its own top-level describe, `W2-6 Task <N>: ...`, directly above the
// region's closing marker. Task 1's cases load the counter through w6cLoad (a dynamic import), so while
// deploy/history-counters.mjs is absent only they are red, never the whole file. Every store is a createStore store
// under a mkTmp HOME; every record, measure, verify output and node report is a fixture under a mkTmp directory; nothing
// spawns a model, reads the live HOME or writes outside its own trees.
import * as w6cFs from 'node:fs';
import * as w6cPath from 'node:path';
import { spawnSync as w6cSpawnSync } from 'node:child_process';
import { pathToFileURL as w6cUrl } from 'node:url';
import { DatabaseSync as W6cDb } from 'node:sqlite';
import { describe as w6cDescribe, expect as w6cExpect, it as w6cIt, vi as w6cVi } from 'vitest';
import * as w6cGateMod from '../../deploy/history-gate.mjs';
import * as w6cDrvMod from '../../deploy/history-replay.mjs';
import * as w6cLibMod from '../../ccd/history/lib.mjs';
import * as w6cStoreMod from '../../ccd/history/store.mjs';
import { mkTmp as w6cMkTmp } from './tmpHelpers.js';
import { REPO as W6C_REPO, scrubbedEnv as w6cScrubbed } from './historyHelpers.js';

type W6cR = Record<string, any>;
type W6cRefusal = { word: string; detail: string } | null;
const w6cGate = w6cGateMod as unknown as W6cR;
const w6cDrv = w6cDrvMod as unknown as W6cR;
const w6cLib = w6cLibMod as unknown as W6cR;
const w6cStore = w6cStoreMod as unknown as W6cR;
const W6C_SRC = w6cPath.join(W6C_REPO, 'deploy', 'history-counters.mjs');
const W6C_DRIVER = w6cPath.join(W6C_REPO, 'deploy', 'history-replay.mjs');
const W6C_GATE = w6cPath.join(W6C_REPO, 'deploy', 'history-gate.mjs');
const w6cLoad = async (): Promise<W6cR> => (await import('../../deploy/history-counters.mjs')) as unknown as W6cR;
/** The counter names, from the gate's frozen text: this region spells none of them either. */
const W6C_NAMES: string[] = (w6cGate.COUNTERS_DEF_V1 as Array<{ name: string }>).map((c) => c.name);
const w6cIsComment = (l: string): boolean => /^\s*(\*|\/\/|\/\*)/.test(l);
const w6cCode = (p: string): string[] => w6cFs.readFileSync(p, 'utf8').split('\n').filter((l) => !w6cIsComment(l));
/** A driver refusal: the statically imported driver's class, or the one a module graph loaded after an earlier case's
 *  vi.resetModules() carries (w6cLoad imports the counter dynamically, so its driver is then a fresh copy). */
const w6cIsRefusal = (e: unknown): boolean => e instanceof w6cDrv.DriverRefusal || (e instanceof Error && e.name === 'DriverRefusal');
/** A call's driver refusal as {word, detail}, null when it returns; any other throw passes through. */
function w6cRefusalOf(fn: () => unknown): W6cRefusal {
  try {
    fn();
    return null;
  } catch (e) {
    if (w6cIsRefusal(e)) return { word: (e as W6cR).word, detail: (e as W6cR).detail };
    throw e;
  }
}
/** An in-process call with stderr captured; a refusal answered as {word, detail}. */
function w6cInProcess(fn: () => unknown): { code: unknown; stderr: string; refusal: W6cRefusal } {
  const lines: string[] = [];
  const spy = w6cVi.spyOn(process.stderr, 'write').mockImplementation(((s: string | Uint8Array) => { lines.push(String(s)); return true; }) as typeof process.stderr.write);
  try {
    return { code: fn(), stderr: lines.join(''), refusal: null };
  } catch (e) {
    if (w6cIsRefusal(e)) return { code: null, stderr: lines.join(''), refusal: { word: (e as W6cR).word, detail: (e as W6cR).detail } };
    throw e;
  } finally {
    spy.mockRestore();
  }
}

// ── fixtures: one node's store, five listed families on it, and a sixth on another node ─────────────────────────────
const W6C_STORE = '00000000-0000-4000-8000-0000000006c1';
const W6C_OTHER = '00000000-0000-4000-8000-0000000006c2';
const W6C_T0 = 1_800_000_000_000;
const W6C_DAY = 86_400_000;
const W6C_WINDOW = { start_ms: W6C_T0, end_ms: W6C_T0 + 14 * W6C_DAY };
/** The read instant every frame case passes: window end exactly, which the half-open window puts after it. */
const W6C_AFTER = W6C_WINDOW.end_ms;
const W6C_RECORD_SHA = 'ab'.repeat(32);
const W6C_SCRIPT_SHA = w6cLib.sha256Hex('w2-6 task 1 fixture: measure-history.py') as string;
const w6cGen = (n: number): string => `0189abcd-0000-4000-8000-${String(n).padStart(12, '0')}`;
const w6cRef = (id: string, n: number, store = W6C_STORE): W6cR => ({ store_id: store, ccrc_id: id, generation: w6cGen(n) });
const W6C_F_T = w6cRef('w6c-t', 1);          // treatment: two measured windows, an anthropic and an other producer
const W6C_F_C = w6cRef('w6c-c', 2);          // control: one measured window, unknown producer (null-model rows stay turns)
const W6C_F_X = w6cRef('w6c-x', 3);          // treatment: its recall-off file changed inside the window
const W6C_F_U = w6cRef('w6c-u', 4);          // control: one window the row cap cut before turn 11, so unmeasured (zero_windows)
const W6C_F_N = w6cRef('w6c-n', 5);          // treatment: found false
const W6C_F_O = w6cRef('w6c-o', 6, W6C_OTHER);   // control, on the other node: never this node's run's
const w6cKeyOf = (f: W6cR): string => w6cGate.familyKey(f.store_id, f.ccrc_id, f.generation) as string;
const W6C_B1 = W6C_T0 + W6C_DAY;
const W6C_B2 = W6C_T0 + 2 * W6C_DAY;
const W6C_BC = W6C_T0 + 3 * W6C_DAY;
const W6C_BX = W6C_T0 + 4 * W6C_DAY;
const W6C_BU = W6C_T0 + 5 * W6C_DAY;
const W6C_CHANGE_TS = W6C_T0 + 6 * W6C_DAY;
const W6C_GAP_TS = W6C_T0 + 7 * W6C_DAY;
/** One assistant row as measure-history.py prints it, [line, ts_ms, msg_id, request_id, uuid, model]. Every msg_id is
 *  distinct, so every row is one turn. */
const w6cArow = (line: number, ts: number, model: string | null): unknown[] => [line, ts, `msg-${line}-${ts}`, null, w6cGen(100_000 + line), model];
/** One copy holding a boundary at `ts`: `n` one-row turns 1000 ms apart from ts + 100, a summary row, no next boundary. */
function w6cCopyOf(ts: number, n: number, o: { model?: string | null; models?: Array<string | null>; truncated?: boolean; fileId?: number; sourceKey?: string; after?: number } = {}): W6cR {
  const model = o.model === undefined ? 'claude-fixture-1' : o.model;
  const rows = Array.from({ length: n }, (_, i) => w6cArow(10 + i, ts + 100 + i * 1000, model));
  return { file_id: o.fileId ?? 1, source_key: o.sourceKey ?? '', boundary_line: 1, after_count: o.after ?? n + 1, summary_line: 2,
    next_boundary_line: null, next_boundary_ts_ms: null, last_ts_ms: n === 0 ? null : ts + 100 + (n - 1) * 1000, rows,
    models: o.models ?? ['claude-fixture-1'], truncated: o.truncated ?? false };
}
const w6cFam = (f: W6cR, found: boolean, calls: unknown[], boundaries: W6cR[]): W6cR =>
  ({ ccrc_id: f.ccrc_id, generation: f.generation, found, merged_generations: [], calls, boundaries });
const w6cFamilies = (): W6cR[] => [
  w6cFam(W6C_F_T, true, [[W6C_B1 + 500, 0, 'grep']], [
    { boundary_uuid: w6cGen(201), ts_ms: W6C_B1, copies: [w6cCopyOf(W6C_B1, 3)] },
    { boundary_uuid: w6cGen(202), ts_ms: W6C_B2, copies: [w6cCopyOf(W6C_B2, 11, { model: 'gpt-fixture-1', models: ['gpt-fixture-1'] })] },
  ]),
  w6cFam(W6C_F_C, true, [], [{ boundary_uuid: w6cGen(203), ts_ms: W6C_BC, copies: [w6cCopyOf(W6C_BC, 2, { model: null, models: [] })] }]),
  w6cFam(W6C_F_X, true, [], [{ boundary_uuid: w6cGen(204), ts_ms: W6C_BX, copies: [w6cCopyOf(W6C_BX, 1)] }]),
  w6cFam(W6C_F_U, true, [], [{ boundary_uuid: w6cGen(205), ts_ms: W6C_BU, copies: [w6cCopyOf(W6C_BU, 4, { model: null, models: [], truncated: true })] }]),
  w6cFam(W6C_F_N, false, [], []),
];
/** The presence record's raw rows (W2-D30): one change row for F_X's id inside the window, one gap row, one seen row. */
const w6cRecallOffRows = (): Array<[string, string]> => [
  [`${w6cLib.RECALL_OFF_KEYS.change}${W6C_CHANGE_TS}:w6c-x`, w6cLib.canonicalJson({ from: null, to: w6cGen(3), prev_seen_ms: W6C_CHANGE_TS - 60_000 }) as string],
  [`${w6cLib.RECALL_OFF_KEYS.gap}${W6C_GAP_TS}`, w6cLib.canonicalJson({ from: W6C_GAP_TS - 3_600_000, to: W6C_GAP_TS }) as string],
  [w6cLib.RECALL_OFF_KEYS.seen as string, String(W6C_GAP_TS)],
];
/** measure-history.py --families' report for W6C_STORE, as a file's bytes would hold it, with a planted node-wide row. */
const w6cPlainReport = (w2: W6cR = {}, top: W6cR = {}): W6cR => ({
  store_id: W6C_STORE, user_version: 2, script_sha256: W6C_SCRIPT_SHA, counters: { 'card_served:anthropic': 7 },
  w2: { row_cap: w6cGate.ROW_CAP, window_start_ms: W6C_WINDOW.start_ms, window_end_ms: W6C_WINDOW.end_ms, families: w6cFamilies(), recall_off: w6cRecallOffRows(), ...w2 },
  ...top,
});
/** The same report in process, its node-wide counters row a getter that throws: W2-D87's "never read", measured. */
const w6cReport = (w2: W6cR = {}, top: W6cR = {}): W6cR => {
  const r: W6cR = w6cPlainReport(w2, top);
  Object.defineProperty(r, 'counters', { enumerable: true, get() { throw new Error('the node-wide counters row was read (W2-D87)'); } });
  return r;
};
/** The part 2 fields the frame reads. The loader validates a whole record; the frame is handed one. */
const w6cRecordOf = (over: W6cR = {}): W6cR => ({
  nodes: [{ label: 'node-a', store_id: W6C_STORE }, { label: 'node-b', store_id: W6C_OTHER }],
  assignment: [{ ...W6C_F_T, arm: 'treatment' }, { ...W6C_F_C, arm: 'control' }, { ...W6C_F_X, arm: 'treatment' }, { ...W6C_F_U, arm: 'control' },
    { ...W6C_F_N, arm: 'treatment' }, { ...W6C_F_O, arm: 'control' }],
  gate_code: { release_tag: 'v9.9.7', files: { 'deploy/measure-history.py': W6C_SCRIPT_SHA } },
  window: { ...W6C_WINDOW }, counters_def: { id: 'v1', sha256: w6cGate.COUNTERS_DEF_V1_SHA256 }, ...over,
});
/** The presence record's two instants a verify output reports (W2-D84): the newest recall-off write, a day before window
 *  start, and the sweep's seen_ms a minute after it, so the record has seen the write (V2). */
const W6C_AB_WRITE = W6C_T0 - W6C_DAY;
const W6C_AB_SEEN = W6C_AB_WRITE + 60_000;
/** One node's verify --section ab output for `store`: its assigned families at their arms, each AB_STATES[0] (realised)
 *  unless `states` names another state by ccrc id; its presence record has seen the newest write (seen_ms after
 *  newest_write, seen_after_write true), as the driver's verifyAbReport answers for those two values (V2's CONTROL). */
function w6cAbOf(states: Record<string, string> = {}, top: W6cR = {}, store = W6C_STORE): W6cR {
  const families = (w6cRecordOf().assignment as W6cR[]).filter((a) => a.store_id === store)
    .map((a) => ({ ccrc_id: a.ccrc_id, generation: a.generation, arm: a.arm, state: states[a.ccrc_id] ?? w6cDrv.AB_STATES[0] }));
  return { kind: w6cDrv.VERIFY_AB_KIND, v: 1, record_sha256: W6C_RECORD_SHA, store_id: store, families, counts: {},
    newest_write: { state: 'value', ms: W6C_AB_WRITE }, seen_ms: W6C_AB_SEEN, seen_after_write: true,
    ok: families.every((f) => f.state === w6cDrv.AB_STATES[0]), ...top };
}
const W6C_RS = Object.freeze({ storeId: W6C_STORE, version: 2, schema: null, db: null, close: (): void => undefined });
const W6C_INPUTS = { part1_sha256: 'cd'.repeat(32), frozen_sha256: 'ef'.repeat(32), supersedes_sha256: null, measure_sha256: '12'.repeat(32), verify_ab_sha256: '34'.repeat(32) };
/** A spec for every counter: it answers the number of turns it was handed, or window-unmeasured without them, and folds
 *  to {n, sum}. Its fold throws on an empty list, so a summary of nothing is never folded. `seen` collects every ctx. */
const w6cProbe = (seen: W6cR[] = []): W6cR => Object.fromEntries(W6C_NAMES.map((n) => [n, {
  source: `fixture: ${n}`,
  measure: (ctx: W6cR): W6cR => {
    seen.push(ctx);
    return ctx.turns === null ? { state: 'unmeasured', why: 'window-unmeasured' } : { state: 'measured', value: ctx.turns.length };
  },
  fold: (vs: number[]): W6cR => {
    if (vs.length === 0) throw new Error('fold called on nothing');
    return { n: vs.length, sum: vs.reduce((a, b) => a + b, 0) };
  },
}]));
/** countersReport over the fixtures; every input overridable. */
const w6cFrame = (ctr: W6cR, o: W6cR = {}): W6cR => ctr.countersReport({
  record: o.record ?? w6cRecordOf(), recordSha256: o.recordSha256 ?? W6C_RECORD_SHA, inputs: W6C_INPUTS, report: o.report ?? w6cReport(),
  ab: o.ab ?? w6cAbOf(), rs: o.rs ?? W6C_RS, measures: o.measures ?? w6cProbe(), nowMs: o.nowMs ?? W6C_AFTER,
  stamps: o.stamps ?? [], allowCodeChange: o.allowCodeChange ?? false,
});
const w6cMeasuredAs = (v: number): W6cR => Object.fromEntries(W6C_NAMES.map((n) => [n, { state: 'measured', value: v }]));
const w6cUnmeasuredAs = (why: string): W6cR => Object.fromEntries(W6C_NAMES.map((n) => [n, { state: 'unmeasured', why }]));
/** One node for `count`: a createStore store under a fresh HOME, the measure and verify files for it, the answer the
 *  part 2 loader would give, and a fresh --out. `final` is overridable. */
function w6cNode(o: { recordOver?: W6cR; final?: W6cR } = {}): W6cR {
  const home = w6cMkTmp('ccrc-w2-6-t1-home-');
  w6cStore.createStore(home, { storeId: W6C_STORE });
  const dbFile = w6cLib.historyPaths(home).dbFile as string;
  const dir = w6cMkTmp('ccrc-w2-6-t1-in-');
  const save = (name: string, value: unknown): { path: string; sha: string } => {
    const text = `${JSON.stringify(value)}\n`;
    const p = w6cPath.join(dir, name);
    w6cFs.writeFileSync(p, text, { mode: 0o600 });
    return { path: p, sha: w6cLib.sha256Hex(text) as string };
  };
  const measure = save('measure.json', w6cPlainReport());
  const ab = save('verify-ab.json', w6cAbOf());
  const final = o.final ?? { record: w6cRecordOf(o.recordOver ?? {}), sha256: W6C_RECORD_SHA, frozen: { sha256: 'ef'.repeat(32) }, stamps: [] };
  const out = w6cPath.join(w6cMkTmp('ccrc-w2-6-t1-out-'), 'out');
  const flags = { record: w6cPath.join(dir, 'unused-part2.json'), 'record-sha256': W6C_RECORD_SHA, part1: w6cPath.join(dir, 'unused-part1.json'),
    'part1-sha256': 'cd'.repeat(32), frozen: w6cPath.join(dir, 'unused-frozen.json'), 'frozen-sha256': 'ef'.repeat(32),
    measure: measure.path, 'measure-sha256': measure.sha, 'verify-ab': ab.path, 'verify-ab-sha256': ab.sha, store: dbFile, out };
  return { home, dbFile, final, flags, out, measureSha: measure.sha, abSha: ab.sha };
}

w6cDescribe('W2-6 Task 1: the counter module, its frame and its pins (W2-D86, W2-D87, W2-D88)', () => {
  // ── the module's shape and its pins ─────────────────────────────────────────────────────────────────────────────────
  w6cIt('standalone entry: its shebang passes --no-warnings, its mode is executable, and importing it runs nothing (W2-D88)', () => {
    w6cExpect(w6cFs.readFileSync(W6C_SRC, 'utf8').split('\n')[0]).toBe('#!/usr/bin/env -S node --no-warnings');
    w6cExpect(w6cFs.statSync(W6C_SRC).mode & 0o111, 'mode 755, like the driver').not.toBe(0);
    const r = w6cSpawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', `await import(${JSON.stringify(w6cUrl(W6C_SRC).href)});`],
      { encoding: 'utf8', timeout: 60_000, env: { ...w6cScrubbed(process.env), HOME: w6cMkTmp('ccrc-w2-6-t1-import-') } });
    w6cExpect([r.status, r.stdout, r.stderr]).toEqual([0, '', '']);
  });

  w6cIt.skipIf(process.platform === 'darwin')('run as a file, the shebang keeps the experimental warning off stderr; no subcommand refuses args-invalid', () => {
    const env = { ...w6cScrubbed(process.env), HOME: w6cMkTmp('ccrc-w2-6-t1-exec-'), PATH: `${w6cPath.dirname(process.execPath)}:${process.env['PATH'] ?? ''}` };
    const r = w6cSpawnSync(W6C_SRC, [], { encoding: 'utf8', timeout: 60_000, env });
    w6cExpect([r.status, r.stdout, r.stderr]).toEqual([2, '', 'ccrc history-counters: args-invalid: no subcommand\n']);
  });

  // The counter's import block, pinned as D-5814 pins the driver's: exactly its modules, each with exactly its names.
  // A later W2-6 task that adds a name inside a module's braces updates that module's entry here in the same commit.
  const W6C_EXPECTED_IMPORTS = ['node:fs', 'node:path', 'node:url', '../ccd/history/lib.mjs', '../ccd/history/store.mjs', './history-gate.mjs', './history-replay.mjs'];
  const W6C_EXACT_NAMES: Record<string, string> = {
    'node:fs': '{ lstatSync, readFileSync, realpathSync, writeFileSync }',
    'node:path': 'path',
    'node:url': '{ fileURLToPath, pathToFileURL }',
    '../ccd/history/lib.mjs': '{ BACKENDS, EXIT, SCHEMA_ADDED, UUID_RE, canonicalJson, sha256Hex }',
    '../ccd/history/store.mjs': '{ StoreError, openReader, userVersion }',
    './history-gate.mjs': '{ ASSIGNMENT_ARMS, COUNTERS_DEF_V1, COUNTERS_DEF_V1_SHA256, K, K_UNIT, assembleReports, buildWindows, changedFamilies, familyKey, turnsOf, windowCopyOf }',
    './history-replay.mjs': '{ AB_STATES, DriverRefusal, VERIFY_AB_KIND, loadFinalRecord, loadInput, parseArgs, prepareOut, refuse }',
  };
  const importViolations = (text: string): string[] => {
    const found: string[] = [];
    const froms = [...text.matchAll(/^import\s+([^;]*?)\s*from\s*'([^']+)';/gms)];
    if (JSON.stringify(froms.map((m) => m[2])) !== JSON.stringify(W6C_EXPECTED_IMPORTS)) found.push(`imports ${froms.map((m) => m[2]).join(', ')}`);
    for (const m of froms) if (m[1]!.trim() !== W6C_EXACT_NAMES[m[2]!]) found.push(`${m[2]} brings in ${m[1]}`);
    for (const l of text.split('\n')) {
      if (w6cIsComment(l)) continue;
      if (/^import\s*['"]/.test(l) || /\bimport\s*\(/.test(l) || /\brequire\s*\(/.test(l)) found.push(`side-effect or dynamic load ${l.trim()}`);
      if (/\bprocess\.env\b/.test(l)) found.push(`environment read ${l.trim()}`);
    }
    return found;
  };

  w6cIt('CONTROL: the counter import scan sees an extra module, an extra name, a missing module, a dynamic load and an environment read', () => {
    const real = w6cFs.readFileSync(W6C_SRC, 'utf8');
    w6cExpect(importViolations(real), 'the counter itself').toEqual([]);
    const variants: Array<[string, string]> = [
      ['derive', real.replace('import { StoreError', "import { keptOf } from '../ccd/history/derive-extra.mjs';\nimport { StoreError")],
      ['openWriter', real.replace('{ StoreError, openReader, userVersion }', '{ StoreError, openReader, openWriter, userVersion }')],
      ['missing', real.replace("import { fileURLToPath, pathToFileURL } from 'node:url';\n", '')],
      ['dynamic', `${real}\nconst m = await import('node:zlib');\n`],
      ['env', real.replace('process.exitCode = main(process.argv.slice(2));', 'process.exitCode = main(process.argv.slice(2), process.env);')],
    ];
    for (const [label, text] of variants) {
      w6cExpect(text, `${label}: the variant differs from the counter`).not.toBe(real);
      w6cExpect(importViolations(text), label).not.toEqual([]);
    }
  });

  w6cIt('the counter imports exactly its modules, each with exactly its pinned names, and reads no environment', () => {
    w6cExpect(importViolations(w6cFs.readFileSync(W6C_SRC, 'utf8'))).toEqual([]);
  });

  /** A quoted specifier that names the counter: a static import, a dynamic import or a template specifier all quote it. */
  const LOADS_COUNTER = /(['"`])[^'"`\n]*history-counters(?:\.mjs)?\1/;

  w6cIt('CONTROL: the counter-load needle sees a static import, a dynamic import and a template specifier, and not prose', () => {
    for (const l of ["import { countersReport } from './history-counters.mjs';", "const m = await import('./history-counters.mjs');",
      'const m = () => import(`../deploy/history-counters.mjs`);']) w6cExpect(LOADS_COUNTER.test(l), l).toBe(true);
    w6cExpect(LOADS_COUNTER.test('// history-counters.mjs imports this file, never the reverse')).toBe(false);
    w6cExpect(w6cCode(W6C_DRIVER).length, 'the driver is read').toBeGreaterThan(1000);
  });

  w6cIt('neither the driver nor the gate loads the counter, and gate_code does not hash it (W2-D88)', () => {
    w6cExpect(w6cCode(W6C_DRIVER).filter((l) => LOADS_COUNTER.test(l)), 'history-replay.mjs').toEqual([]);
    w6cExpect(w6cCode(W6C_GATE).filter((l) => LOADS_COUNTER.test(l)), 'history-gate.mjs').toEqual([]);
    w6cExpect([...w6cGate.GATE_CODE_FILES]).not.toContain('deploy/history-counters.mjs');
  });

  w6cIt('COUNTER_NAMES and COUNTER_MEASURES are COUNTERS_DEF_V1\'s names, derived, in order; no counter name is spelled as a string (W2-D87)', async () => {
    const ctr = await w6cLoad();
    w6cExpect([...ctr.COUNTER_NAMES]).toEqual(W6C_NAMES);
    w6cExpect(Object.isFrozen(ctr.COUNTER_NAMES)).toBe(true);
    w6cExpect(Object.keys(ctr.COUNTER_MEASURES)).toEqual(W6C_NAMES);
    w6cExpect(Object.isFrozen(ctr.COUNTER_MEASURES)).toBe(true);
    w6cExpect(w6cCode(W6C_SRC).filter((l) => /^export const COUNTER_NAMES = Object\.freeze\(COUNTERS_DEF_V1\.map\(/.test(l))).toHaveLength(1);
    const quoted = new RegExp(`(['"\`])(?:${W6C_NAMES.join('|')})\\1`);
    w6cExpect(w6cCode(W6C_SRC).filter((l) => quoted.test(l))).toEqual([]);
    for (const n of W6C_NAMES) {
      const s = ctr.COUNTER_MEASURES[n];
      w6cExpect([typeof s.source, s.source.length > 0, typeof s.measure, typeof s.fold], n).toEqual(['string', true, 'function', 'function']);
    }
    w6cExpect(ctr.COUNTER_UNMEASURED[0]).toBe('window-unmeasured');
    w6cExpect(new Set(ctr.COUNTER_UNMEASURED).size).toBe(ctr.COUNTER_UNMEASURED.length);
    w6cExpect(Object.isFrozen(ctr.COUNTER_UNMEASURED)).toBe(true);
  });

  /** The node-wide counters table, or measure-history.py's copy of it, read: a property read, a bracket read, a table read. */
  const NODE_WIDE = /\.counters\b|\[\s*(['"`])counters\1\s*\]|\b(?:FROM|JOIN)\s+counters\b/i;

  w6cIt('CONTROL: the node-wide needle sees a property read, a bracket read and a table read, and never counters_def', () => {
    for (const l of ['const n = report.counters;', "const n = r['counters'];", "db.prepare('SELECT name, n FROM counters').all();"]) w6cExpect(NODE_WIDE.test(l), l).toBe(true);
    for (const l of ['if (record.counters_def?.sha256 !== COUNTERS_DEF_V1_SHA256)', 'COUNTERS_DEF_V1.map((c) => c.name)', '    counters: Object.fromEntries(']) w6cExpect(NODE_WIDE.test(l), l).toBe(false);
  });

  w6cIt('the node-wide counters table is never read: no code line of the counter names it (W2-D87)', () => {
    w6cExpect(w6cCode(W6C_SRC).filter((l) => NODE_WIDE.test(l))).toEqual([]);
  });

  // ── the frame ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  w6cIt('the frame: one row per boundary of every found family of this store, with the gate\'s window, arm, producer and turns (W2-D86, W2-D15, U5)', async () => {
    const ctr = await w6cLoad();
    const out = w6cFrame(ctr);
    const pick = (r: W6cR): W6cR => ({ family: r.family, arm: r.arm, changed: r.changed, unrealised: r.unrealised, boundary_uuid: r.boundary_uuid,
      producer: r.producer, state: r.state, turns: r.turns, recall_calls: r.recall_calls, measures: r.measures });
    w6cExpect(out.windows.map(pick)).toEqual([
      { family: w6cKeyOf(W6C_F_T), arm: 'treatment', changed: false, unrealised: false, boundary_uuid: w6cGen(201), producer: 'anthropic', state: 'measured', turns: 3, recall_calls: 1, measures: w6cMeasuredAs(3) },
      { family: w6cKeyOf(W6C_F_T), arm: 'treatment', changed: false, unrealised: false, boundary_uuid: w6cGen(202), producer: 'other', state: 'measured', turns: 10, recall_calls: 0, measures: w6cMeasuredAs(10) },
      { family: w6cKeyOf(W6C_F_C), arm: 'control', changed: false, unrealised: false, boundary_uuid: w6cGen(203), producer: 'unknown', state: 'measured', turns: 2, recall_calls: 0, measures: w6cMeasuredAs(2) },
      { family: w6cKeyOf(W6C_F_X), arm: 'treatment', changed: true, unrealised: false, boundary_uuid: w6cGen(204), producer: 'anthropic', state: 'measured', turns: 1, recall_calls: 0, measures: w6cMeasuredAs(1) },
      { family: w6cKeyOf(W6C_F_U), arm: 'control', changed: false, unrealised: false, boundary_uuid: w6cGen(205), producer: 'unknown', state: 'unmeasured', turns: null, recall_calls: null, measures: w6cUnmeasuredAs('window-unmeasured') },
    ]);
    w6cExpect(out.windows.map((r: W6cR) => [r.store_id, r.ts_ms, r.ab_state])).toEqual([W6C_B1, W6C_B2, W6C_BC, W6C_BX, W6C_BU].map((ts) => [W6C_STORE, ts, w6cDrv.AB_STATES[0]]));
    // CONTROL: the gate's own windows for F_T, so the frame adds no window rule of its own.
    w6cExpect((w6cGate.buildWindows(w6cFamilies()[0]) as W6cR[]).map((w) => [w.turns, w.calls, w.producer])).toEqual([[3, 1, 'anthropic'], [10, 0, 'other']]);
  });

  w6cIt('excluded is assembleReports\' answer over this node\'s families only (W2-D22, U2)', async () => {
    const ctr = await w6cLoad();
    const unmeasuredKey = w6cLib.canonicalJson([W6C_STORE, W6C_F_U.ccrc_id, W6C_F_U.generation, w6cGen(205)]) as string;
    w6cExpect(w6cFrame(ctr).excluded).toEqual({ not_found: [w6cKeyOf(W6C_F_N)], zero_windows: [w6cKeyOf(W6C_F_U)], unmeasured: { count: 1, keys: [unmeasuredKey] }, not_listed: [] });
    // CONTROL: over the whole record's assignment, the other node's family reads as listed by no report.
    w6cExpect((w6cGate.assembleReports([w6cReport()], w6cRecordOf()) as W6cR).excluded.not_listed).toEqual([w6cKeyOf(W6C_F_O)]);
  });

  w6cIt('a changed family is dropped from the arm comparison only: its row stays, flagged, tallied apart by arm and by producer; gap rows are reported (W2-D86, W2-D23, U8, V3)', async () => {
    const ctr = await w6cLoad();
    const out = w6cFrame(ctr);
    w6cExpect(out.dropped.changed).toEqual([w6cKeyOf(W6C_F_X)]);
    w6cExpect(out.recall_off_gaps).toEqual([{ store_id: W6C_STORE, ts_ms: W6C_GAP_TS, from: W6C_GAP_TS - 3_600_000, to: W6C_GAP_TS }]);
    w6cExpect(out.windows.filter((r: W6cR) => r.changed).map((r: W6cR) => r.boundary_uuid)).toEqual([w6cGen(204)]);
    w6cExpect([out.strata.treatment.anthropic.windows, out.strata.treatment.all.windows], 'F_X is in no arm stratum').toEqual([1, 2]);
    const dc = out.dropped_strata.changed;
    w6cExpect([dc.treatment.anthropic.windows, dc.treatment.other.windows, dc.treatment.all.windows, dc.control.all.windows],
      'F_X, a treatment family, tallied under its own arm and producer (V3)').toEqual([1, 0, 1, 0]);
    w6cExpect(dc.treatment.all.counters[W6C_NAMES[0]!].summary, 'tallied with the arms\' own fold').toEqual({ n: 1, sum: 1 });
    // CONTROL: with no change row, F_X is compared like any other treatment family.
    const still = w6cFrame(ctr, { report: w6cReport({ recall_off: w6cRecallOffRows().slice(1) }) });
    w6cExpect([still.dropped.changed, still.strata.treatment.anthropic.windows, still.dropped_strata.changed.treatment.all.windows]).toEqual([[], 2, 0]);
  });

  w6cIt('a family verify --section ab did not confirm is dropped from the arm comparison only, under its own state word: every state but ok, each listed apart (W2-D23 as extended by Q15 and W2-D84; V1, U3, V3)', async () => {
    const ctr = await w6cLoad();
    const AB = w6cDrv.AB_STATES as string[];
    w6cExpect(w6cDrv.abStateOf('control', W6C_F_C.generation, { state: 'value', value: W6C_F_C.generation }), 'CONTROL: the realised answer is AB_STATES[0]').toBe(AB[0]);
    w6cExpect(AB.slice(1), 'CONTROL: the four states V1 drops').toEqual(['control-absent', 'control-mismatch', 'treatment-named', 'unreadable']);
    const base = w6cFrame(ctr);
    for (const s of AB.slice(1)) w6cExpect(base.sources.frame.unrealised, `the frame's source names ${s}`).toContain(s);
    w6cExpect(base.sources.frame.unrealised).toContain('W2-D23 as extended by Q15 and W2-D84');
    // Each state on a family of the arm it belongs to: W2-D23's two on the control family F_C, Q15's treatment-named on
    // the treatment family F_T (two windows, two producers), and unreadable on F_C.
    const cases: Array<[string, W6cR, string, string]> = [[AB[1]!, W6C_F_C, 'control', 'treatment'], [AB[2]!, W6C_F_C, 'control', 'treatment'],
      [AB[3]!, W6C_F_T, 'treatment', 'control'], [AB[4]!, W6C_F_C, 'control', 'treatment']];
    for (const [s, f, arm, other] of cases) {
      const out = w6cFrame(ctr, { ab: w6cAbOf({ [f.ccrc_id]: s }) });
      w6cExpect(out.dropped.unrealised, s).toEqual(Object.fromEntries(AB.slice(1).map((t) => [t, t === s ? [w6cKeyOf(f)] : []])));
      const mine = out.windows.filter((r: W6cR) => r.family === w6cKeyOf(f));
      w6cExpect(mine.length, `${s}: the family's rows stay`).toBeGreaterThan(0);
      w6cExpect(mine.map((r: W6cR) => [r.unrealised, r.ab_state, r.changed]), s).toEqual(mine.map(() => [true, s, false]));
      const du = out.dropped_strata.unrealised;
      w6cExpect([out.strata[arm].all.windows, du[arm].all.windows, du[other].all.windows], `${s}: out of ${arm}'s cells, tallied under ${arm} alone (V3)`)
        .toEqual([base.strata[arm].all.windows - mine.length, mine.length, 0]);
      for (const r of mine) w6cExpect(du[arm][r.producer].windows, `${s}: ${r.producer}`).toBeGreaterThan(0);
    }
    // CONTROL: every family realised drops none.
    w6cExpect([Object.values(base.dropped.unrealised).flat(), base.strata.control.unknown.windows, base.dropped_strata.unrealised.control.all.windows,
      base.dropped_strata.unrealised.treatment.all.windows]).toEqual([[], 2, 0, 0]);
  });

  w6cIt('strata: by arm, by the boundary\'s producer and pooled; an empty sum is null, never 0, and nothing is folded from nothing (W2-D87, W2-D15)', async () => {
    const ctr = await w6cLoad();
    const out = w6cFrame(ctr);
    const s = out.strata;
    w6cExpect(Object.keys(s)).toEqual([...w6cGate.ASSIGNMENT_ARMS]);
    for (const arm of w6cGate.ASSIGNMENT_ARMS as string[]) w6cExpect(Object.keys(s[arm]), arm).toEqual([...w6cLib.BACKENDS, ctr.ALL_PRODUCERS]);
    w6cExpect(Object.keys(out.dropped_strata)).toEqual(['changed', 'unrealised']);
    for (const kind of ['changed', 'unrealised']) {
      w6cExpect(Object.keys(out.dropped_strata[kind]), `${kind}: keyed by arm first (V3)`).toEqual([...w6cGate.ASSIGNMENT_ARMS]);
      for (const arm of w6cGate.ASSIGNMENT_ARMS as string[]) w6cExpect(Object.keys(out.dropped_strata[kind][arm]), `${kind}/${arm}`).toEqual([...w6cLib.BACKENDS, ctr.ALL_PRODUCERS]);
    }
    const tally = (windows: number, measured: number, turns: number | null, calls: number | null, summary: W6cR | null, by: W6cR = {}): W6cR => ({
      windows, measured_windows: measured, unmeasured_windows: windows - measured, turns, recall_calls: calls,
      counters: Object.fromEntries(W6C_NAMES.map((n) => [n, { measured, unmeasured: windows - measured, unmeasured_by: by, summary }])),
    });
    const none = tally(0, 0, null, null, null);
    w6cExpect(s.treatment).toEqual({ anthropic: tally(1, 1, 3, 1, { n: 1, sum: 3 }), other: tally(1, 1, 10, 0, { n: 1, sum: 10 }),
      unknown: none, all: tally(2, 2, 13, 1, { n: 2, sum: 13 }) });
    const ctl = tally(2, 1, 2, 0, { n: 1, sum: 2 }, { 'window-unmeasured': 1 });
    w6cExpect(s.control).toEqual({ anthropic: none, other: none, unknown: ctl, all: ctl });
  });

  w6cIt('every counter the frame emits is named in COUNTERS_DEF_V1, and none is missing; the report names its definitions, its script and its read instant (W2-D87, W2-D88)', async () => {
    const ctr = await w6cLoad();
    const out = w6cFrame(ctr);
    for (const r of out.windows) w6cExpect(Object.keys(r.measures), r.boundary_uuid).toEqual(W6C_NAMES);
    const tallies = [...(Object.values(out.strata) as W6cR[]).flatMap((a) => Object.values(a)),
      ...(Object.values(out.dropped_strata) as W6cR[]).flatMap((k) => (Object.values(k) as W6cR[]).flatMap((a) => Object.values(a)))];
    w6cExpect(tallies, 'two arms of four tallies, then two dropped kinds of two arms of four (V3)').toHaveLength(2 * 4 + 2 * 2 * 4);
    for (const t of tallies as W6cR[]) w6cExpect(Object.keys(t.counters)).toEqual(W6C_NAMES);
    w6cExpect(Object.keys(out.sources.counters)).toEqual(W6C_NAMES);
    w6cExpect(Object.keys(out.sources.frame).sort()).toEqual(['arm', 'changed', 'excluded', 'producer', 'recall_calls', 'recall_off_gaps', 'record_nodes', 'unrealised', 'windows']);
    w6cExpect(out.record_nodes, 'the record\'s stores: a combine names a node no report covers (U2)').toEqual([W6C_STORE, W6C_OTHER].sort());
    w6cExpect(out.counters_def).toEqual({ id: 'v1', sha256: w6cGate.COUNTERS_DEF_V1_SHA256 });
    w6cExpect([out.kind, out.v, out.k, out.k_unit, out.window, out.store_id, out.record_sha256, out.inputs, out.read_ms, out.code_changed])
      .toEqual([ctr.COUNTERS_KIND, 1, w6cGate.K, w6cGate.K_UNIT, W6C_WINDOW, W6C_STORE, W6C_RECORD_SHA, W6C_INPUTS, W6C_AFTER, false]);
    w6cExpect(out.script_sha256, 'the counter names its own bytes: gate_code does not hash it').toBe(w6cLib.sha256Hex(w6cFs.readFileSync(W6C_SRC)));
    w6cExpect(ctr.scriptSha256()).toBe(out.script_sha256);
  });

  w6cIt('a measure is handed the gate\'s window copy and its first K turns, never the producer\'s copy (W2-D15, D-5771)', async () => {
    const ctr = await w6cLoad();
    const live = w6cCopyOf(W6C_B1, 2, { fileId: 2, sourceKey: '', after: 3, model: 'gpt-fixture-1', models: ['gpt-fixture-1'] });
    const retired = w6cCopyOf(W6C_B1, 11, { fileId: 1, sourceKey: 'retired-1', after: 30 });
    const boundary = { boundary_uuid: w6cGen(206), ts_ms: W6C_B1, copies: [live, retired] };
    w6cExpect([(w6cGate.windowCopyOf(boundary.copies) as W6cR).file_id, (w6cGate.producerCopyOf(boundary.copies) as W6cR).file_id], 'CONTROL: the two rules disagree here').toEqual([1, 2]);
    const seen: W6cR[] = [];
    const out = w6cFrame(ctr, { report: w6cReport({ families: [w6cFam(W6C_F_T, true, [], [boundary])] }), measures: w6cProbe(seen) });
    w6cExpect(out.windows.map((r: W6cR) => [r.producer, r.turns])).toEqual([['other', 10]]);
    w6cExpect(seen.map((c) => [c.copy.file_id, c.turns.length, c.window.turns])).toEqual(W6C_NAMES.map(() => [1, 10, 10]));
    w6cExpect(Object.isFrozen(seen[0])).toBe(true);
    w6cExpect(seen[0]!.turns[0].rows[0]).toEqual(retired.rows[0]);
    w6cExpect([seen[0]!.family.arm, seen[0]!.rs.storeId, seen[0]!.calls, seen[0]!.nowMs]).toEqual(['treatment', W6C_STORE, [], W6C_AFTER]);
  });

  w6cIt('the measures contract: COUNTERS_DEF_V1\'s names in order, each a source, a measure and a fold; an answer measured with a value or unmeasured with a listed word (a defect is a TypeError)', async () => {
    const ctr = await w6cLoad();
    w6cExpect(() => w6cFrame(ctr), 'CONTROL').not.toThrow();
    const missing = w6cProbe();
    delete missing[W6C_NAMES[2]!];
    const extra = { ...w6cProbe(), uptake: w6cProbe()[W6C_NAMES[0]!] };
    const reordered = Object.fromEntries(Object.entries(w6cProbe()).reverse());
    for (const [label, m] of [['missing', missing], ['extra', extra], ['reordered', reordered]] as Array<[string, W6cR]>) {
      w6cExpect(() => w6cFrame(ctr, { measures: m }), label).toThrow(/^countersReport: measures are /);
    }
    const noSource = { ...w6cProbe(), [W6C_NAMES[0]!]: { ...w6cProbe()[W6C_NAMES[0]!], source: '' } };
    w6cExpect(() => w6cFrame(ctr, { measures: noSource })).toThrow(/needs a source, a measure and a fold/);
    const answering = (a: W6cR): W6cR => ({ ...w6cProbe(), [W6C_NAMES[1]!]: { source: 'fixture', measure: (): W6cR => a, fold: (): null => null } });
    for (const a of [{ state: 'unmeasured', why: 'no-such-word' }, { state: 'measured', value: null }, { state: 'measured' }, { state: 'zero', value: 0 }]) {
      w6cExpect(() => w6cFrame(ctr, { measures: answering(a) }), JSON.stringify(a)).toThrow(/a measure answers measured with a value or unmeasured with a COUNTER_UNMEASURED word/);
    }
  });

  w6cIt('W2-D88\'s run checks refuse in one order, before any window is built: window open, counters_def, the store, the measure\'s store, the verify output (CONTROL: a run at window end exactly is after it)', async () => {
    const ctr = await w6cLoad();
    const end = W6C_WINDOW.end_ms;
    const zero = '0'.repeat(64);
    w6cExpect(w6cRefusalOf(() => w6cFrame(ctr, { nowMs: end - 1 })))
      .toEqual({ word: 'input-invalid', detail: `window-open: now ${end - 1} is before window.end_ms ${end}: the counters run after window end (W2-D88)` });
    w6cExpect(w6cRefusalOf(() => w6cFrame(ctr, { nowMs: end })), 'CONTROL: the window is half-open').toBeNull();
    const badDef = { id: 'v1', sha256: zero };
    w6cExpect(w6cRefusalOf(() => w6cFrame(ctr, { record: w6cRecordOf({ counters_def: badDef }) })))
      .toEqual({ word: 'record-invalid', detail: `counters_def ${JSON.stringify(badDef)} is not v1 ${w6cGate.COUNTERS_DEF_V1_SHA256}` });
    w6cExpect(w6cRefusalOf(() => w6cFrame(ctr, { record: w6cRecordOf({ nodes: [{ label: 'node-b', store_id: W6C_OTHER }] }) })))
      .toEqual({ word: 'input-invalid', detail: `store ${W6C_STORE} is not one of the record's nodes` });
    w6cExpect(w6cRefusalOf(() => w6cFrame(ctr, { report: w6cReport({}, { store_id: W6C_OTHER }) })))
      .toEqual({ word: 'input-invalid', detail: `measure-store-mismatch: the measure names store "${W6C_OTHER}", and --store holds ${W6C_STORE}` });
    const abWord = (ab: W6cR): string | undefined => w6cRefusalOf(() => w6cFrame(ctr, { ab }))?.detail.split(':')[0];
    w6cExpect(abWord(w6cAbOf({}, { kind: 'ccrc-history-w2-verify-registry' }))).toBe('verify-ab-shape');
    w6cExpect(abWord(w6cAbOf({}, { record_sha256: zero }))).toBe('verify-ab-record-mismatch');
    w6cExpect(abWord(w6cAbOf({}, { store_id: W6C_OTHER }))).toBe('verify-ab-store-mismatch');
    const short = w6cAbOf();
    short.families = short.families.slice(1);
    w6cExpect(abWord(short)).toBe('verify-ab-families-mismatch');
    const armed = w6cAbOf();
    armed.families[0].arm = 'control';
    w6cExpect(abWord(armed), 'a family at another arm').toBe('verify-ab-families-mismatch');
    w6cExpect(abWord(w6cAbOf({ 'w6c-t': 'no-such-state' }))).toBe('verify-ab-shape');
    const twice = w6cAbOf();
    twice.families.push({ ...twice.families[1], state: w6cDrv.AB_STATES[1] });
    w6cExpect(abWord(twice), 'a family listed twice, realised and then not').toBe('verify-ab-shape');
    // The order: everything wrong at once refuses the window first, then the definitions.
    const wrong = { record: w6cRecordOf({ counters_def: badDef, nodes: [] }), report: w6cReport({}, { store_id: W6C_OTHER }), ab: w6cAbOf({}, { record_sha256: zero }) };
    w6cExpect(w6cRefusalOf(() => w6cFrame(ctr, { ...wrong, nowMs: end - 1 }))?.detail.split(':')[0]).toBe('window-open');
    w6cExpect(w6cRefusalOf(() => w6cFrame(ctr, wrong))?.word).toBe('record-invalid');
  });

  w6cIt('a verify output whose presence record has not seen the newest recall-off write is refused, after the verify output\'s own checks (V2, W2-D84; CONTROL: the driver\'s own verdict over the fixture\'s instants)', async () => {
    const ctr = await w6cLoad();
    const fx = w6cAbOf();
    const verdict = (seen: number | null, newest: W6cR): unknown => (w6cDrv.verifyAbReport({ recordSha256: W6C_RECORD_SHA, storeId: W6C_STORE,
      families: fx.families, newest, seen }) as W6cR).seen_after_write;
    w6cExpect(verdict(fx.seen_ms, fx.newest_write), 'CONTROL: the fixture is what the driver answers for its two instants').toBe(fx.seen_after_write);
    w6cExpect([fx.seen_after_write, verdict(W6C_AB_WRITE - 1, fx.newest_write), verdict(null, { state: 'absent' }),
      verdict(W6C_AB_SEEN, { state: 'unmeasured', code: 'EACCES' })], 'CONTROL: seen before the write, never, or beside an unmeasured write, is stale')
      .toEqual([true, false, false, false]);
    w6cExpect(w6cRefusalOf(() => w6cFrame(ctr)), 'CONTROL: a presence record that saw the newest write is counted').toBeNull();
    const stale = w6cAbOf({}, { seen_ms: W6C_AB_WRITE - 1, seen_after_write: false, ok: false });
    w6cExpect(w6cRefusalOf(() => w6cFrame(ctr, { ab: stale }))).toEqual({ word: 'input-invalid',
      detail: `verify-ab-presence-stale: seen_after_write false, seen_ms ${W6C_AB_WRITE - 1}, newest_write ${JSON.stringify({ state: 'value', ms: W6C_AB_WRITE })}: `
        + 'the presence record has not been seen after the newest recall-off write, or that write is unmeasured, so a control file written since is '
        + 'unconfirmed; re-run verify --section ab once the newest write measures and status\'s recall_off.seen_ms is later than it (W2-D84)' });
    const word = (top: W6cR): string | undefined => w6cRefusalOf(() => w6cFrame(ctr, { ab: w6cAbOf({}, top) }))?.detail.split(':')[0];
    const absent = w6cAbOf();
    delete absent.seen_after_write;
    w6cExpect(w6cRefusalOf(() => w6cFrame(ctr, { ab: absent }))?.detail.split(':')[0], 'an absent verdict').toBe('verify-ab-presence-stale');
    w6cExpect(word({ seen_after_write: 'true' }), 'only true passes, never a string').toBe('verify-ab-presence-stale');
    w6cExpect(word({ seen_after_write: 1 }), 'only true passes, never a number').toBe('verify-ab-presence-stale');
    w6cExpect(word({ seen_after_write: false, newest_write: { state: 'unmeasured', code: 'EACCES' } }), 'an unmeasured newest write').toBe('verify-ab-presence-stale');
    // The order: the verify output's own checks come first, so a stale output of another record, or missing a family, names that.
    w6cExpect(word({ seen_after_write: false, record_sha256: '0'.repeat(64) })).toBe('verify-ab-record-mismatch');
    w6cExpect(word({ seen_after_write: false, families: [] })).toBe('verify-ab-families-mismatch');
  });

  w6cIt('assembleReports\' words: the two code words stay themselves, every other is input-invalid naming it (W2-D22, W2-D24)', async () => {
    const ctr = await w6cLoad();
    const cap = w6cRefusalOf(() => w6cFrame(ctr, { report: w6cReport({ row_cap: w6cGate.ROW_CAP - 1 }) }));
    w6cExpect([cap?.word, cap?.detail.startsWith('row-cap-mismatch: ')]).toEqual(['input-invalid', true]);
    const win = w6cRefusalOf(() => w6cFrame(ctr, { report: w6cReport({ window_end_ms: W6C_WINDOW.end_ms + 1 }) }));
    w6cExpect([win?.word, win?.detail.startsWith('window-mismatch: ')]).toEqual(['input-invalid', true]);
    w6cExpect(w6cRefusalOf(() => w6cFrame(ctr, { report: w6cReport({}, { script_sha256: '1'.repeat(64) }) }))?.word).toBe('code-changed');
  });

  w6cIt('the recall-off rows: absent is refused, never "nothing changed"; a row off W2-D30\'s grammar is refused; CONTROL: an empty list changes nothing (W2-D23)', async () => {
    const ctr = await w6cLoad();
    const absent = w6cReport();
    delete absent.w2.recall_off;
    const r1 = w6cRefusalOf(() => w6cFrame(ctr, { report: absent }));
    w6cExpect([r1?.word, r1?.detail.startsWith('measure w2.recall_off is not a list')]).toEqual(['input-invalid', true]);
    const r2 = w6cRefusalOf(() => w6cFrame(ctr, { report: w6cReport({ recall_off: [['recall_off:change:12x:w6c-x', '{}']] }) }));
    w6cExpect([r2?.word, r2?.detail.startsWith('measure w2.recall_off: ')]).toEqual(['input-invalid', true]);
    w6cExpect(w6cFrame(ctr, { report: w6cReport({ recall_off: [] }) }).dropped.changed, 'CONTROL').toEqual([]);
  });

  w6cIt('--allow-code-change (Q23, U6): the part 2 loader\'s stamp, or a measure script the flag lets through, stamps code_changed; CONTROL: neither leaves it false', async () => {
    const ctr = await w6cLoad();
    w6cExpect(w6cFrame(ctr).code_changed, 'CONTROL').toBe(false);
    w6cExpect(w6cFrame(ctr, { stamps: ['code-changed'] }).code_changed).toBe(true);
    const moved = w6cReport({}, { script_sha256: '1'.repeat(64) });
    w6cExpect(w6cRefusalOf(() => w6cFrame(ctr, { report: moved }))?.word, 'without the flag').toBe('code-changed');
    w6cExpect(w6cFrame(ctr, { report: moved, allowCodeChange: true }).code_changed).toBe(true);
  });

  // ── the command, its inputs and its --out ───────────────────────────────────────────────────────────────────────────
  w6cIt('count writes one report under a fresh --out, its sha the one stderr line, at the clock\'s instant, and leaves the store\'s bytes as they were (W2-D53, W2-D51)', async () => {
    const ctr = await w6cLoad();
    const n = w6cNode();
    const before = w6cLib.sha256Hex(w6cFs.readFileSync(n.dbFile)) as string;
    const loads: unknown[][] = [];
    const stdout: string[] = [];
    const so = w6cVi.spyOn(process.stdout, 'write').mockImplementation(((s: string | Uint8Array) => { stdout.push(String(s)); return true; }) as typeof process.stdout.write);
    let r: ReturnType<typeof w6cInProcess>;
    try {
      r = w6cInProcess(() => ctr.countCommand(n.flags, { loadFinal: (...a: unknown[]) => { loads.push(a); return n.final; }, now: () => W6C_AFTER }));
    } finally {
      so.mockRestore();
    }
    w6cExpect([r.code, r.refusal, stdout.join('')]).toEqual([0, null, '']);
    w6cExpect(loads, 'the part 2 loader is handed the flags and the clock').toEqual([[n.flags, { nowMs: W6C_AFTER }]]);
    const file = w6cPath.join(n.out, ctr.COUNTERS_FILE);
    const bytes = w6cFs.readFileSync(file);
    w6cExpect(r.stderr).toBe(`sha256 ${w6cLib.sha256Hex(bytes)}\n`);
    w6cExpect(w6cFs.readdirSync(n.out).sort()).toEqual([w6cDrv.OUT_MARKER, ctr.COUNTERS_FILE].sort());
    w6cExpect([w6cFs.statSync(n.out).mode & 0o7777, w6cFs.statSync(file).mode & 0o7777]).toEqual([0o700, 0o600]);
    const doc = JSON.parse(bytes.toString('utf8'));
    w6cExpect(bytes.toString('utf8')).toBe(`${w6cLib.canonicalJson(doc)}\n`);
    w6cExpect([doc.kind, doc.store_id, doc.record_sha256, doc.read_ms, doc.code_changed, doc.inputs]).toEqual([ctr.COUNTERS_KIND, W6C_STORE, W6C_RECORD_SHA, W6C_AFTER, false,
      { part1_sha256: 'cd'.repeat(32), frozen_sha256: 'ef'.repeat(32), supersedes_sha256: null, measure_sha256: n.measureSha, verify_ab_sha256: n.abSha }]);
    w6cExpect(doc.windows.map((w: W6cR) => w.boundary_uuid)).toEqual([201, 202, 203, 204, 205].map(w6cGen));
    w6cExpect(Number.isSafeInteger(doc.user_version)).toBe(true);
    w6cExpect(bytes.toString('utf8'), 'the planted node-wide row is not copied').not.toContain('card_served:anthropic');
    w6cExpect(w6cLib.sha256Hex(w6cFs.readFileSync(n.dbFile))).toBe(before);
  });

  w6cIt('count takes --allow-code-change to the part 2 loader and writes its stamp (Q23, U6); a flag outside the form is args-invalid', async () => {
    const ctr = await w6cLoad();
    const n = w6cNode({ final: { record: w6cRecordOf(), sha256: W6C_RECORD_SHA, frozen: { sha256: 'ef'.repeat(32) }, stamps: ['code-changed'] } });
    const flags = { ...n.flags, 'allow-code-change': true };
    const handed: W6cR[] = [];
    const r = w6cInProcess(() => ctr.countCommand(flags, { loadFinal: (f: W6cR) => { handed.push(f); return n.final; }, now: () => W6C_AFTER }));
    w6cExpect([r.refusal, handed.map((f) => f['allow-code-change'])]).toEqual([null, [true]]);
    w6cExpect(JSON.parse(w6cFs.readFileSync(w6cPath.join(n.out, ctr.COUNTERS_FILE), 'utf8')).code_changed).toBe(true);
    const bad = w6cInProcess(() => ctr.countCommand({ ...w6cNode().flags, 'node-label': 'node-a' }, { loadFinal: () => n.final, now: () => W6C_AFTER }));
    w6cExpect(bad.refusal).toEqual({ word: 'args-invalid', detail: '--node-label is not a count flag' });
    w6cExpect(ctr.COUNTER_FLAG_SPECS['allow-code-change'], 'the driver\'s kind for the same flag').toBe(w6cDrv.FLAG_SPECS['allow-code-change']);
  });

  w6cIt('the count flag guards refuse before anything is read: a required flag missing, --supersedes without its sha, a relative --out', async () => {
    const ctr = await w6cLoad();
    const n = w6cNode();
    let loads = 0;
    const deps = { loadFinal: (): W6cR => { loads += 1; return n.final; }, now: () => W6C_AFTER };
    const noMeasure: W6cR = { ...n.flags };
    delete noMeasure.measure;
    const cases: Array<[W6cR, W6cRefusal]> = [
      [noMeasure, { word: 'args-invalid', detail: 'measure-required' }],
      [{ ...n.flags, supersedes: '/home/u/part2-old.json' }, { word: 'args-invalid', detail: '--supersedes and --supersedes-sha256 go together' }],
      [{ ...n.flags, out: 'relative/out' }, { word: 'out-refused', detail: 'relative' }],
    ];
    for (const [flags, want] of cases) w6cExpect(w6cInProcess(() => ctr.countCommand(flags, deps)).refusal, JSON.stringify(want)).toEqual(want);
    w6cExpect([loads, w6cFs.existsSync(n.out)], 'nothing was read and no --out was made').toEqual([0, false]);
  });

  w6cIt('the frame refuses what it cannot place: an arm, a producer or a verify state outside its list and a window of another boundary are defects; a measure report assembleReports cannot read is input-invalid', async () => {
    const ctr = await w6cLoad();
    const f = w6cFamilies()[0]!;
    const ws = w6cGate.buildWindows(f) as W6cR[];
    const fam = { key: w6cKeyOf(W6C_F_T), store_id: W6C_STORE, ccrc_id: W6C_F_T.ccrc_id, generation: W6C_F_T.generation, arm: 'treatment' };
    const ctxOf = (o: W6cR = {}): W6cR => ctr.windowCtx({ rs: W6C_RS, family: { ...fam, ...(o.family ?? {}) }, boundary: o.boundary ?? f.boundaries[0],
      window: o.window ?? ws[0], calls: f.calls, nowMs: W6C_AFTER });
    const rowOf = (ctx: W6cR, abState: string = w6cDrv.AB_STATES[0]): W6cR => ctr.windowRow({ ctx, changed: false, abState, measures: w6cProbe() });
    w6cExpect(rowOf(ctxOf()).boundary_uuid, 'CONTROL: the same row, placed').toBe(w6cGen(201));
    w6cExpect(() => rowOf(ctxOf({ family: { arm: 'unassigned' } }))).toThrow(/has arm "unassigned"/);
    w6cExpect(() => rowOf(ctxOf({ window: { ...ws[0], producer: 'nobody' } }))).toThrow(/has producer "nobody"/);
    w6cExpect(() => rowOf(ctxOf(), 'no-such-state')).toThrow(/has verify state "no-such-state"/);
    w6cExpect(() => ctxOf({ boundary: f.boundaries[1] }), 'B1\'s window handed B2\'s boundary').toThrow(/is not boundary/);
    const r = w6cRefusalOf(() => w6cFrame(ctr, { report: w6cReport({ families: 'not-a-list' }) }));
    w6cExpect([r?.word, r?.detail.startsWith('measure shape: ')]).toEqual(['input-invalid', true]);
  });

  w6cIt('an --out that exists is refused before the record, the measure or the store is read, and is left as it was', async () => {
    const ctr = await w6cLoad();
    const n = w6cNode();
    w6cFs.mkdirSync(n.out, { mode: 0o700 });
    let loads = 0;
    const absentStore = w6cPath.join(n.home, 'absent.db');
    const deps = { loadFinal: (): W6cR => { loads += 1; return n.final; }, now: () => W6C_AFTER };
    const r = w6cInProcess(() => ctr.countCommand({ ...n.flags, store: absentStore }, deps));
    w6cExpect([r.refusal, loads, w6cFs.readdirSync(n.out)]).toEqual([{ word: 'out-refused', detail: 'exists: a counter report goes under a fresh --out' }, 0, []]);
    // CONTROL: the same flags with a fresh --out read the record and reach the store, and refuse there.
    const fresh = w6cInProcess(() => ctr.countCommand({ ...n.flags, out: `${n.out}-fresh`, store: absentStore }, deps));
    w6cExpect([fresh.refusal, loads, w6cFs.existsSync(`${n.out}-fresh`)]).toEqual([{ word: 'store-unreadable', detail: 'store-missing' }, 1, false]);
  });

  w6cIt('a refusal after the inputs are read leaves no --out: a store that is not one of the record\'s nodes', async () => {
    const ctr = await w6cLoad();
    const n = w6cNode({ recordOver: { nodes: [{ label: 'node-b', store_id: W6C_OTHER }] } });
    const r = w6cInProcess(() => ctr.countCommand(n.flags, { loadFinal: () => n.final, now: () => W6C_AFTER }));
    w6cExpect([r.refusal, w6cFs.existsSync(n.out)]).toEqual([{ word: 'input-invalid', detail: `store ${W6C_STORE} is not one of the record's nodes` }, false]);
  });

  w6cIt('a refusal after the inputs are read leaves no --out: a verify output of another part 2 (Q15)', async () => {
    const ctr = await w6cLoad();
    const other = 'ac'.repeat(32);
    const n = w6cNode({ final: { record: w6cRecordOf(), sha256: other, frozen: { sha256: 'ef'.repeat(32) }, stamps: [] } });
    const r = w6cInProcess(() => ctr.countCommand(n.flags, { loadFinal: () => n.final, now: () => W6C_AFTER }));
    w6cExpect([r.refusal, w6cFs.existsSync(n.out)]).toEqual([{ word: 'input-invalid',
      detail: `verify-ab-record-mismatch: it names record "${W6C_RECORD_SHA}", and --record is ${other}` }, false]);
  });

  w6cIt('the store opener refuses as the driver\'s does, word for word; CONTROL: a store opens with its own id and expandEntryBody\'s rc (W2-D51)', async () => {
    const ctr = await w6cLoad();
    const same = (home: string): W6cRefusal => {
      const mine = w6cRefusalOf(() => ctr.openCounterStore(w6cLib.historyPaths(home).dbFile));
      w6cExpect(mine, home).not.toBeNull();
      w6cExpect(mine).toEqual(w6cRefusalOf(() => w6cDrv.openReplayStore(home)));
      return mine;
    };
    const edit = (home: string, sql: string): void => {
      const db = new W6cDb(w6cLib.historyPaths(home).dbFile as string);
      try { db.exec(sql); } finally { db.close(); }
    };
    w6cExpect(same(w6cMkTmp('ccrc-w2-6-t1-none-'))).toEqual({ word: 'store-unreadable', detail: 'store-missing' });
    const noId = w6cMkTmp('ccrc-w2-6-t1-noid-');
    w6cStore.createStore(noId, { storeId: W6C_STORE });
    edit(noId, "DELETE FROM meta WHERE k = 'store_id'");
    w6cExpect(same(noId)?.detail).toBe('store-id-absent');
    const badId = w6cMkTmp('ccrc-w2-6-t1-badid-');
    w6cStore.createStore(badId, { storeId: W6C_STORE });
    edit(badId, "UPDATE meta SET v = 'not-a-uuid' WHERE k = 'store_id'");
    w6cExpect(same(badId)?.detail).toBe('store-id-unreadable');
    const ok = w6cMkTmp('ccrc-w2-6-t1-ok-');
    w6cStore.createStore(ok, { storeId: W6C_STORE });
    const rs = ctr.openCounterStore(w6cLib.historyPaths(ok).dbFile);
    try {
      w6cExpect([rs.storeId, Number.isSafeInteger(rs.version), rs.schema]).toEqual([W6C_STORE, true, w6cLib.SCHEMA_ADDED]);
    } finally {
      rs.close();
    }
    w6cExpect(w6cRefusalOf(() => ctr.openCounterStore('relative/history.db'))).toEqual({ word: 'args-invalid', detail: '--store names no absolute path' });
  });

  w6cIt('run as the operator runs it: the driver\'s part 2 loader refuses a record sha mismatch on one stderr line, exit 2, stdout empty, and no --out', () => {
    const n = w6cNode();
    const dir = w6cMkTmp('ccrc-w2-6-t1-spawn-');
    const recText = '{"part":"final"}\n';
    const rec = w6cPath.join(dir, 'part2.json');
    w6cFs.writeFileSync(rec, recText, { mode: 0o600 });
    const zero = '0'.repeat(64);
    const argv = ['count', ...Object.entries({ ...n.flags, record: rec, 'record-sha256': zero }).flatMap(([k, v]) => [`--${k}`, String(v)])];
    const opts = { encoding: 'utf8' as const, timeout: 60_000, env: { ...w6cScrubbed(process.env), HOME: n.home } };
    const r = w6cSpawnSync(process.execPath, ['--no-warnings', W6C_SRC, ...argv], opts);
    w6cExpect([r.status, r.stdout, r.stderr]).toEqual([2, '', `ccrc history-counters: record-sha-mismatch: record: expected ${zero}, measured ${w6cLib.sha256Hex(recText)}\n`]);
    w6cExpect(w6cFs.existsSync(n.out)).toBe(false);
    const other = w6cSpawnSync(process.execPath, ['--no-warnings', W6C_SRC, 'report'], opts);
    w6cExpect([other.status, other.stdout, other.stderr]).toEqual([2, '', 'ccrc history-counters: args-invalid: unknown subcommand "report"\n']);
  });
});

// ── end of W2-6's region (Q29): later W2-6 tasks insert their describes directly above this line ──────────────────────
```

The marker line is the last line of the region; on this task's base W2-5b1's first appended block follows it after one blank line.

- [ ] **Step 3: Run the new cases; they fail (predicted).** In the foreground, with a timeout of at least 600000 ms:

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-6 Task 1'
```

Expected RED (predicted): **28 failed, 3 passed** on linux; on darwin the direct-exec case is skipped, so 27 failed, 3 passed, 1 skipped.
- Each case that calls `w6cLoad` fails on the dynamic import (`Failed to load url ../../deploy/history-counters.mjs` or `Cannot find module`, by vitest's version). V2's presence case is one of them: red first, before `checkCountInputs` exists, and red again under mutants M40 and M41 once it does.
- The cases that read `W6C_SRC` fail with `ENOENT`: the first shape case, the import CONTROL, the import pin and the node-wide scan.
- The direct-exec case and the spawned operator case fail on the missing file (a null or non-2 status).
- The three that pass hold at the base already: the counter-load CONTROL, the driver-and-gate scan and the node-wide CONTROL. Their reds are mutants M17 and M19's.
- No other case of the file changes state: the region declares only `w6c`-prefixed bindings.

- [ ] **Step 4: Write the module.** Create `deploy/history-counters.mjs` with exactly this content, then `chmod 755 deploy/history-counters.mjs`.

```js
#!/usr/bin/env -S node --no-warnings
// deploy/history-counters.mjs: the ccrc history W2 report-only counters (spec 2026-10-05 §10.2, "The live A/B", its
// counters; W2 decisions W2-D86 to W2-D88).
//
// An L4 operator script and a STANDALONE entry (W2-D88). The operator runs it by hand after the window ends: on each named
// node, over that node's store, then over the nodes' reports together. It reports beside the gate's verdict and never
// feeds it: nothing here reaches decideGate, history-replay.mjs never imports this file, and gate_code does not hash it
// (history-replay.test.ts pins all three), so every report names this file's own sha256. It ships in the release part 1
// pins and runs on the tree the build freeze holds still (W2-D6).
//
// What it reports (W2-D86, W2-D87): the five spec counters and re-discovery, each per window of a listed family, by arm
// and by the producer of the window's boundary (W2-D15), as the signed defaults part 1 carries (counters_def). Their
// names and texts are the gate's COUNTERS_DEF_V1, imported and never spelled here. The windows and their turns are the
// gate's (buildWindows, windowCopyOf, turnsOf; W2-D14, D-5770, D-5771) over measure-history.py's raw rows; the arm is the
// record's assignment. A family whose recall-off file changed in the window, or whose verify --section ab state is any
// but ok (W2-D23 as extended by Q15 and W2-D84's never-fold), is dropped from the arm comparison only: kept in the
// per-window rows and tallied apart by arm and by producer. A verify output whose presence record has not seen the newest
// recall-off write is refused. Every figure names its source. A window or a counter that was not measured is unmeasured with its reason,
// never 0, and a gap between two measures is reported, never repaired. The node-wide counters table, and
// measure-history.py's copy of it, is never read: its totals are not per window (W2-D87).
//
// Imports: node: built-ins; ../ccd/history/lib.mjs; ../ccd/history/store.mjs, whose read-only openReader opens every store
// read (W2-D51: this file spells no node:sqlite specifier); ./history-gate.mjs, the pure gate (W2-D11); and
// ./history-replay.mjs's argv grammar, refusal, input loader, part 2 loader, --out rule and verify --section ab words
// (W2-D25, W2-D24, W2-D53), imported so that none is spelled a second time. Importing the driver loads cli.mjs, which sets
// this process's umask to 0o077; main sets it again. history-replay.test.ts pins the exact list and the names each module
// brings in.
// Its words are the driver's DRIVER_REASONS (W2-D12, W2-D59), thrown through its refuse, never a list of this file's own.
// A refusal prints `ccrc history-counters: <word>: <detail>` on stderr and exits EXIT.REFUSED (2); a defect exits
// EXIT.INTERNAL (1). Environment: none. main reads no process environment, and --store names the store.
import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BACKENDS, EXIT, SCHEMA_ADDED, UUID_RE, canonicalJson, sha256Hex } from '../ccd/history/lib.mjs';
import { StoreError, openReader, userVersion } from '../ccd/history/store.mjs';
import { ASSIGNMENT_ARMS, COUNTERS_DEF_V1, COUNTERS_DEF_V1_SHA256, K, K_UNIT, assembleReports, buildWindows, changedFamilies, familyKey, turnsOf, windowCopyOf } from './history-gate.mjs';
import { AB_STATES, DriverRefusal, VERIFY_AB_KIND, loadFinalRecord, loadInput, parseArgs, prepareOut, refuse } from './history-replay.mjs';

// ── the counters' names, the unmeasured words and the answers (W2-D87) ─────────────────────────────────────────────
/** The counters this file reports, in COUNTERS_DEF_V1's order: derived from the gate's frozen text, never spelled. */
export const COUNTER_NAMES = Object.freeze(COUNTERS_DEF_V1.map((c) => c.name));

/** Why one counter of one window is unmeasured, each word its own condition, never folded into a measured 0. A measure
 *  answering any other word is a defect (unmeasured and answerOf throw), so no reason is invented unseen; each counter's
 *  task appends its own words here, in place. */
export const COUNTER_UNMEASURED = Object.freeze([
  'window-unmeasured',   // the window itself is unmeasured (W2-D14), and the counter needs it
  'pending',             // the stand-in every counter answers until its own measure lands (removed by W2-6 Task 3)
]);

/** @typedef {{ state: 'measured', value: unknown } | { state: 'unmeasured', why: string }} Measure */
/** A measured answer. Its value is never null or undefined: answerOf refuses either, which would read as nothing.
 *  @param {unknown} value  @returns {Measure} */
function measured(value) {
  return { state: 'measured', value };
}
/** An unmeasured answer; a word outside COUNTER_UNMEASURED is a defect that throws here, at its source.
 *  @param {string} why  @returns {Measure} */
function unmeasured(why) {
  if (!COUNTER_UNMEASURED.includes(why)) throw new TypeError(`history-counters: ${JSON.stringify(why)} is not a COUNTER_UNMEASURED word`);
  return { state: 'unmeasured', why };
}
/** A fold's guard: the frame never folds nothing (a stratum with no measured window has a null summary), so a fold handed
 *  an empty list is a defect.  @param {string} name  @param {unknown[]} values  @returns {unknown[]} */
function nonEmpty(name, values) {
  if (!Array.isArray(values) || values.length === 0) throw new TypeError(`${name}: a fold over no measured window is a defect (the frame answers null)`);
  return values;
}

/** @typedef {{ db: object, storeId: string, version: number, schema: object, close: () => void }} CounterStore */
/** What a measure is handed for one boundary, frozen: the store; the family and its arm; the raw boundary report; the
 *  gate's window; for a measured window only, the gate's window copy and its first K turns (both null otherwise); the
 *  family's raw calls; and the run's read instant.
 *  @typedef {{ rs: CounterStore, family: Readonly<{key: string, store_id: string, ccrc_id: string, generation: string, arm: string}>,
 *    boundary: object, window: object, copy: object | null, turns: Array<object> | null, calls: Array<[number, number, string]>,
 *    nowMs: number }} WindowCtx */
/** One counter: the source it reads, named; its measure of one window; its fold of a stratum's measured values, never
 *  called on none. `answer`, when a spec states it, is the shape of the measured value that counter writes: combine refuses
 *  a node report's measured answer that fails it (a stand-in spec that states none is not checked).
 *  @typedef {{ source: string, measure: (ctx: WindowCtx) => Measure, fold: (values: unknown[]) => unknown,
 *    answer?: (value: unknown) => boolean }} CounterSpec */

/** The frame's own sources, named in every report beside each counter's (W2-D87: every source is named). */
export const FRAME_SOURCES = Object.freeze({
  windows: 'measure-history.py w2.families (raw rows) through history-gate buildWindows, windowCopyOf and turnsOf; W2-D14, W2-D15',
  producer: 'history-gate windowOf: lib producerOf over the models of the copy lib pickHoldingCopy chooses (W2-D15)',
  arm: 'the open record part 2 assignment',
  changed: 'measure-history.py w2.recall_off through history-gate changedFamilies (W2-D23)',
  unrealised: `this node's verify --section ab output: a family whose state is any but ${AB_STATES[0]}, each state listed apart: `
    + `${AB_STATES.slice(1).join(', ')} (W2-D23 as extended by Q15 and W2-D84's never-fold)`,
  recall_calls: 'measure-history.py w2.families calls (recall_calls rows with arm IS NULL), counted inside each window by history-gate windowOf',
  excluded: 'history-gate assembleReports over this node\'s assignment: not_found, zero_windows, unmeasured, not_listed (W2-D22)',
  recall_off_gaps: 'measure-history.py w2.recall_off gap rows through history-gate changedFamilies: reported, never dropped (W2-D23)',
  record_nodes: 'the open record part 2 nodes, by store_id: the stores a combine expects one report from (U2)',
});

/** The pooled stratum's key, beside lib's BACKENDS: every producer of one arm. */
export const ALL_PRODUCERS = 'all';
/** The report's kind, and its one file under --out. */
export const COUNTERS_KIND = 'ccrc-history-w2-counters';
export const COUNTERS_FILE = 'counters.json';
/** The most bytes one input report is read to: raw rows over every listed family (the driver's census cap). */
const MEASURE_CAP = 256 * 1024 * 1024;
/** verify --section ab's realised answer: AB_STATES' first word (a parity case holds it to the driver's abStateOf). */
const AB_OK = AB_STATES[0];
const PREFIX = 'ccrc history-counters';

// ── the frame: windows, turns, arms, producers, the drops and the strata (W2-D86, W2-D87, W2-D15, W2-D23) ─────────
/** The measures a report is built with: exactly COUNTER_NAMES, in order, each a CounterSpec. Anything else is a defect. */
function checkMeasures(measures) {
  const names = measures !== null && typeof measures === 'object' ? Object.keys(measures) : [];
  if (names.join('\n') !== COUNTER_NAMES.join('\n')) {
    throw new TypeError(`countersReport: measures are ${JSON.stringify(names)}, and COUNTERS_DEF_V1 names ${JSON.stringify(COUNTER_NAMES)}`);
  }
  for (const n of COUNTER_NAMES) {
    const s = measures[n];
    if (typeof s?.source !== 'string' || s.source === '' || typeof s.measure !== 'function' || typeof s.fold !== 'function') {
      throw new TypeError(`countersReport: measure ${n} needs a source, a measure and a fold`);
    }
  }
}

/** One measure's answer, checked: measured with a value (never null), or unmeasured with a COUNTER_UNMEASURED word.
 *  Anything else is a defect. When the counter's spec states the shape of its value (`valueOk`, combine hands it), a
 *  measured value off that shape is the same refusal, never coerced.
 *  @param {string} name  @param {unknown} a  @param {((value: unknown) => boolean) | undefined} [valueOk]  @returns {Measure} */
function answerOf(name, a, valueOk) {
  const o = /** @type {any} */ (a);
  if (o?.state === 'measured' && o.value !== undefined && o.value !== null) {
    if (valueOk !== undefined && !valueOk(o.value)) {
      throw new TypeError(`countersReport: ${name} answered a measured value off its shape: ${JSON.stringify(o.value).slice(0, 200)}`);
    }
    return { state: 'measured', value: o.value };
  }
  if (o?.state === 'unmeasured' && COUNTER_UNMEASURED.includes(o.why)) return { state: 'unmeasured', why: o.why };
  throw new TypeError(`countersReport: ${name} answered ${JSON.stringify(a ?? null)}: a measure answers measured with a value or unmeasured with a COUNTER_UNMEASURED word`);
}

/** assembleReports' refusal as a driver word: its two code words are DRIVER_REASONS words too; every other is about an
 *  input the operator handed in, so input-invalid with the gate's word leading the detail.  @returns {never} */
function gateRefusal(reason, detail) {
  if (reason === 'code-changed' || reason === 'code-unmeasured') refuse(reason, detail);
  refuse('input-invalid', `${reason}: ${detail}`);
}

/** The families of `assignment` whose recall-off file changed in the window, and the gap rows, from the report's raw
 *  presence rows through the gate's changedFamilies (W2-D23). An absent or malformed list is unmeasured and refused, never
 *  "nothing changed"; a row off W2-D30's grammar is the gate's throw, refused as input-invalid. */
function changedOf(report, window, assignment) {
  const rows = report.w2.recall_off;
  if (!Array.isArray(rows) || !rows.every((r) => Array.isArray(r) && r.length === 2 && typeof r[0] === 'string' && typeof r[1] === 'string')) {
    refuse('input-invalid', 'measure w2.recall_off is not a list of [k, v] string pairs: the presence record is unmeasured, never "nothing changed"');
  }
  try {
    return changedFamilies(rows.map(([k, v]) => ({ store_id: report.store_id, k, v })), window, assignment);
  } catch (e) {
    if (e instanceof Error) refuse('input-invalid', `measure w2.recall_off: ${e.message}`);
    throw e;
  }
}

/** What a measure is handed for one boundary (W2-D86, W2-D15, D-5771): a measured window's turns are the gate's turn
 *  rule over the gate's WINDOW copy, its first K, never the producer's copy; an unmeasured window has neither. The one
 *  place this file calls turnsOf.  @returns {WindowCtx} */
export function windowCtx({ rs, family, boundary, window, calls, nowMs }) {
  if (boundary?.boundary_uuid !== window.boundary_uuid) throw new Error(`windowCtx: window ${window.boundary_uuid} is not boundary ${boundary?.boundary_uuid}'s`);
  const copy = window.state === 'measured' ? windowCopyOf(boundary.copies) : null;
  const turns = copy === null ? null : turnsOf(copy.rows).slice(0, K);
  if (turns !== null && turns.length !== window.turns) throw new Error(`windowCtx: window ${window.boundary_uuid} counts ${window.turns} turns, and its copy gives ${turns.length}`);
  return Object.freeze({ rs, family, boundary, window, copy, turns, calls, nowMs });
}

/** One boundary's row: the gate's window, the drops, and every counter's answer for it (U5: every measure is asked for
 *  every boundary; a measure that needs the window answers window-unmeasured itself). */
export function windowRow({ ctx, changed, abState, measures }) {
  const { family, window: w } = ctx;
  if (!ASSIGNMENT_ARMS.includes(family.arm)) throw new TypeError(`windowRow: family ${family.key} has arm ${JSON.stringify(family.arm)}`);
  if (!BACKENDS.includes(w.producer)) throw new TypeError(`windowRow: window ${w.boundary_uuid} has producer ${JSON.stringify(w.producer)}`);
  if (!AB_STATES.includes(abState)) throw new TypeError(`windowRow: family ${family.key} has verify state ${JSON.stringify(abState)}`);
  const isMeasured = w.state === 'measured';
  return {
    family: family.key, store_id: family.store_id, ccrc_id: family.ccrc_id, generation: family.generation, arm: family.arm,
    changed, unrealised: abState !== AB_OK, ab_state: abState,
    boundary_uuid: w.boundary_uuid, ts_ms: w.ts_ms, producer: w.producer, state: w.state,
    turns: isMeasured ? w.turns : null,
    recall_calls: isMeasured ? w.calls : null,
    measures: Object.fromEntries(COUNTER_NAMES.map((n) => [n, answerOf(n, measures[n].measure(ctx))])),
  };
}

/** This node's verify --section ab output (the driver's VERIFY_AB_KIND), read as W2-D23's realisation record (Q15): of
 *  this run's record and this store, listing exactly this store's assigned families at their arms, each once, each in an
 *  AB_STATES word. Answers each family's state by family key. */
function abStatesOf(ab, recordSha256, storeId, assignment) {
  const bad = (what) => refuse('input-invalid', `verify-ab-${what}`);
  if (ab === null || typeof ab !== 'object' || ab.kind !== VERIFY_AB_KIND || ab.v !== 1 || !Array.isArray(ab.families)) {
    bad(`shape: kind ${JSON.stringify(ab?.kind ?? null)}, v ${JSON.stringify(ab?.v ?? null)}`);
  }
  if (ab.record_sha256 !== recordSha256) bad(`record-mismatch: it names record ${JSON.stringify(ab.record_sha256 ?? null)}, and --record is ${recordSha256}`);
  if (ab.store_id !== storeId) bad(`store-mismatch: it names store ${JSON.stringify(ab.store_id ?? null)}, and --store holds ${storeId}`);
  const states = new Map();
  for (const f of ab.families) {
    if (f === null || typeof f !== 'object' || typeof f.ccrc_id !== 'string' || typeof f.generation !== 'string' || !AB_STATES.includes(f.state)) {
      bad(`shape: family ${JSON.stringify(f ?? null)}`);
    }
    const key = familyKey(storeId, f.ccrc_id, f.generation);
    if (states.has(key)) bad(`shape: family ${key} is listed twice`);
    states.set(key, { arm: f.arm, state: f.state });
  }
  const want = assignment.map((a) => `${familyKey(a.store_id, a.ccrc_id, a.generation)} ${a.arm}`).sort();
  const got = [...states].map(([k, v]) => `${k} ${v.arm}`).sort();
  if (want.join('\n') !== got.join('\n')) bad(`families-mismatch: it lists ${got.length} families of this store, and the record assigns ${want.length} (each at its arm)`);
  return new Map([...states].map(([k, v]) => [k, v.state]));
}

/** W2-D88's run checks, in one order (U7), each refused before any window is built: the run is after window end (the
 *  window is half-open, so a run at end_ms exactly is after it); the record is under the signed v1 definitions; --store is
 *  one of the record's nodes and the measure report is this store's; then this node's verify output (abStatesOf); and,
 *  after its own checks, its presence record has seen the newest recall-off write (V2, W2-D84). Answers this node's
 *  assignment and each family's verify state. */
export function checkCountInputs({ record, recordSha256, report, ab, rs, nowMs }) {
  const end = record.window?.end_ms;
  if (!Number.isSafeInteger(end)) refuse('record-invalid', `window ${JSON.stringify(record.window ?? null)} carries no end_ms`);
  if (!(nowMs >= end)) refuse('input-invalid', `window-open: now ${nowMs} is before window.end_ms ${end}: the counters run after window end (W2-D88)`);
  if (record.counters_def?.id !== 'v1' || record.counters_def?.sha256 !== COUNTERS_DEF_V1_SHA256) {
    refuse('record-invalid', `counters_def ${JSON.stringify(record.counters_def ?? null)} is not v1 ${COUNTERS_DEF_V1_SHA256}`);
  }
  if (!record.nodes.some((n) => n.store_id === rs.storeId)) refuse('input-invalid', `store ${rs.storeId} is not one of the record's nodes`);
  if (report?.store_id !== rs.storeId) {
    refuse('input-invalid', `measure-store-mismatch: the measure names store ${JSON.stringify(report?.store_id ?? null)}, and --store holds ${rs.storeId}`);
  }
  // This node's families only: the store answers for no other node's (U2: one node per run).
  const assignment = record.assignment.filter((a) => a.store_id === rs.storeId);
  const abStates = abStatesOf(ab, recordSha256, rs.storeId, assignment);
  // V2 (W2-D84): verify reports whether status's recall_off.seen_ms is later than the newest write. Until it is, a control
  // file written since the sweep last looked is unconfirmed, so its family's state cannot be read as realised. The driver's
  // verdict is read, never recomputed, and only true passes.
  if (ab.seen_after_write !== true) {
    refuse('input-invalid', `verify-ab-presence-stale: seen_after_write ${JSON.stringify(ab.seen_after_write ?? null)}, seen_ms ${JSON.stringify(ab.seen_ms ?? null)}, `
      + `newest_write ${JSON.stringify(ab.newest_write ?? null)}: the presence record has not been seen after the newest recall-off write, or that write is `
      + 'unmeasured, so a control file written since is unconfirmed; re-run verify --section ab once the newest write measures and status\'s '
      + 'recall_off.seen_ms is later than it (W2-D84)');
  }
  return { assignment, abStates };
}

/**
 * One node's counter report (W2-D86, W2-D87, W2-D88), from values already loaded: part 2 and its sha, the input shas,
 * this node's measure-history.py report and verify output, the open store, the measures, the read instant, the part 2
 * loader's stamps and whether --allow-code-change was given (Q23, U6). Refused, in this order: checkCountInputs' run
 * checks; assembleReports' refusals over this node's assignment (gateRefusal); a presence list that is absent or off its
 * grammar. Measures that are not COUNTER_NAMES' specs, or an answer off the Measure shape, are a defect (TypeError).
 * Rows: one per boundary of every found family the report lists, in its order, measured windows and unmeasured ones
 * alike, a dropped family's flagged. Strata: stratify's.
 */
export function countersReport({ record, recordSha256, inputs, report, ab, rs, measures, nowMs, stamps = [], allowCodeChange = false }) {
  checkMeasures(measures);
  const { assignment, abStates } = checkCountInputs({ record, recordSha256, report, ab, rs, nowMs });
  let asm;
  try {
    asm = assembleReports([report], { ...record, assignment }, { allowCodeChange });
  } catch (e) {
    if (e instanceof TypeError) refuse('input-invalid', `measure shape: ${e.message}`);
    throw e;
  }
  if (!asm.ok) gateRefusal(asm.reason, asm.detail);
  const { changed, gaps } = changedOf(report, record.window, assignment);
  const changedKeys = new Set(changed);
  const arms = new Map(assignment.map((a) => [familyKey(a.store_id, a.ccrc_id, a.generation), a.arm]));
  const rows = [];
  for (const f of report.w2.families) {
    if (f.found !== true) continue;   // excluded.not_found: assembleReports reported it, and it has no boundary
    const key = familyKey(rs.storeId, f.ccrc_id, f.generation);
    const family = Object.freeze({ key, store_id: rs.storeId, ccrc_id: f.ccrc_id, generation: f.generation, arm: arms.get(key) });
    buildWindows(f).forEach((w, i) => {
      const ctx = windowCtx({ rs, family, boundary: f.boundaries[i], window: w, calls: f.calls, nowMs });
      rows.push(windowRow({ ctx, changed: changedKeys.has(key), abState: abStates.get(key), measures }));
    });
  }
  const keys = assignment.map((a) => familyKey(a.store_id, a.ccrc_id, a.generation));
  const unrealised = Object.fromEntries(AB_STATES.filter((s) => s !== AB_OK).map((s) => [s, keys.filter((k) => abStates.get(k) === s).sort()]));
  return {
    kind: COUNTERS_KIND, v: 1, counters_def: { id: 'v1', sha256: COUNTERS_DEF_V1_SHA256 }, k: K, k_unit: K_UNIT,
    record_sha256: recordSha256, script_sha256: scriptSha256(), read_ms: nowMs,
    code_changed: stamps.includes('code-changed') || asm.code_changed,
    store_id: rs.storeId, record_nodes: record.nodes.map((n) => n.store_id).sort(), user_version: rs.version, inputs,
    window: { start_ms: record.window.start_ms, end_ms: record.window.end_ms },
    sources: { frame: FRAME_SOURCES, counters: Object.fromEntries(COUNTER_NAMES.map((n) => [n, measures[n].source])) },
    excluded: asm.excluded, dropped: { changed, unrealised }, recall_off_gaps: gaps,
    windows: rows, ...stratify(rows, measures),
  };
}

/** The arm comparison (W2-D86, U8): for each arm a tally per producer and one pooled, over rows neither changed nor
 *  unrealised; and each dropped kind tallied apart in the same shape, by arm and then by producer (V3), so a dropped
 *  family is read under its own arm only. */
export function stratify(rows, measures) {
  const byProducer = (keep) => Object.fromEntries([...BACKENDS, ALL_PRODUCERS].map((p) => [p,
    tallyOf(rows.filter((r) => keep(r) && (p === ALL_PRODUCERS || r.producer === p)), measures)]));
  const perArm = (keep) => Object.fromEntries(ASSIGNMENT_ARMS.map((arm) => [arm, byProducer((r) => keep(r) && r.arm === arm)]));
  return {
    strata: perArm((r) => !r.changed && !r.unrealised),
    dropped_strata: { changed: perArm((r) => r.changed), unrealised: perArm((r) => r.unrealised) },
  };
}

/** One stratum: counts of rows, sums over measured windows only (null when none, never 0), and per counter its measured
 *  and unmeasured counts, the unmeasured by word, and its fold over the measured values (null when none). */
function tallyOf(rows, measures) {
  const measuredRows = rows.filter((r) => r.state === 'measured');
  const sum = (k) => (measuredRows.length === 0 ? null : measuredRows.reduce((s, r) => s + r[k], 0));
  return {
    windows: rows.length, measured_windows: measuredRows.length, unmeasured_windows: rows.length - measuredRows.length,
    turns: sum('turns'), recall_calls: sum('recall_calls'),
    counters: Object.fromEntries(COUNTER_NAMES.map((n) => {
      const answers = rows.map((r) => r.measures[n]);
      const values = answers.filter((a) => a.state === 'measured').map((a) => a.value);
      const by = {};
      for (const a of answers) if (a.state === 'unmeasured') by[a.why] = (by[a.why] ?? 0) + 1;
      return [n, {
        measured: values.length, unmeasured: answers.length - values.length,
        unmeasured_by: Object.fromEntries(Object.keys(by).sort().map((w) => [w, by[w]])),
        summary: values.length === 0 ? null : measures[n].fold(values),
      }];
    })),
  };
}

/** This file's own sha256 (W2-D88): gate_code does not hash the counter, so every report names the bytes that ran. */
export function scriptSha256() {
  return sha256Hex(readFileSync(fileURLToPath(import.meta.url)));
}

// ── the store (W2-D51) ──────────────────────────────────────────────────────────────────────────────────────────────
/** A failed open or first read as the driver's word, word for word with its openReplayStore (a parity case holds the two
 *  equal): a StoreError by its word alone, SQLite's own error as store-read-failed; anything else is a defect.
 *  @returns {never} */
function refuseStore(e) {
  if (e instanceof DriverRefusal) throw e;
  if (e instanceof StoreError) refuse('store-unreadable', e.word);
  if (e !== null && typeof e === 'object' && /** @type {{ code?: unknown }} */ (e).code === 'ERR_SQLITE_ERROR') {
    refuse('store-unreadable', `store-read-failed: ${/** @type {Error} */ (e).message}`);
  }
  throw e;
}

/** --store, opened read-only through store.mjs's openReader (W2-D51), with its own store id, its user_version and
 *  SCHEMA_ADDED, so {db, version, schema} is the rc recall.mjs's expandEntryBody reads.
 *  @param {string} dbPath  @returns {CounterStore} */
export function openCounterStore(dbPath) {
  if (typeof dbPath !== 'string' || !path.isAbsolute(dbPath)) refuse('args-invalid', '--store names no absolute path');
  let db;
  try {
    db = openReader(dbPath);
  } catch (e) {
    refuseStore(e);
  }
  try {
    const row = db.prepare("SELECT v FROM meta WHERE k = 'store_id'").get();
    if (row === undefined) refuse('store-unreadable', 'store-id-absent');
    if (!UUID_RE.test(String(row.v))) refuse('store-unreadable', 'store-id-unreadable');
    return { db, storeId: String(row.v), version: userVersion(db), schema: SCHEMA_ADDED, close: () => db.close() };
  } catch (e) {
    try { db.close(); } catch { /* the first throw is the signal */ }
    refuseStore(e);
  }
}

// ── the commands (W2-D53, W2-D24, W2-D88; Q23) ──────────────────────────────────────────────────────────────────────
/** Every flag the counter knows and its kind: the driver's parseArgs reads them with these specs, never its own. */
export const COUNTER_FLAG_SPECS = Object.freeze({
  record: 'string', 'record-sha256': 'string', part1: 'string', 'part1-sha256': 'string', frozen: 'string', 'frozen-sha256': 'string',
  supersedes: 'string', 'supersedes-sha256': 'string', measure: 'string', 'measure-sha256': 'string',
  'verify-ab': 'string', 'verify-ab-sha256': 'string', store: 'string', out: 'string', 'allow-code-change': 'bool',
});
/** Each subcommand's flags, required and optional, and its entry. A flag outside both lists is args-invalid. */
export const COUNTER_FORMS = Object.freeze({
  count: Object.freeze({
    required: Object.freeze(['record', 'record-sha256', 'part1', 'part1-sha256', 'frozen', 'frozen-sha256', 'measure', 'measure-sha256',
      'verify-ab', 'verify-ab-sha256', 'store', 'out']),
    optional: Object.freeze(['supersedes', 'supersedes-sha256', 'allow-code-change']),
    run: (flags, deps) => countCommand(flags, deps),
  }),
});
export const COUNTER_SUBCOMMANDS = Object.freeze(Object.keys(COUNTER_FORMS));

function checkFormFlags(sub, flags) {
  const form = COUNTER_FORMS[sub];
  for (const k of form.required) if (flags[k] === undefined) refuse('args-invalid', `${k}-required`);
  for (const k of Object.keys(flags)) if (!form.required.includes(k) && !form.optional.includes(k)) refuse('args-invalid', `--${k} is not a ${sub} flag`);
}

/** A report goes under a FRESH --out, one that does not exist yet: nothing here resumes. An existing path, or one that
 *  cannot be measured, is refused before any input is read; writeReport's prepareOut makes it, 0700 with the driver's
 *  marker (W2-D53). */
function refuseUnlessFresh(out) {
  if (typeof out !== 'string' || !path.isAbsolute(out)) refuse('out-refused', 'relative');
  try {
    lstatSync(path.resolve(out));
  } catch (e) {
    if (/** @type {{ code?: unknown }} */ (e)?.code === 'ENOENT') return;
    refuse('out-refused', `unmeasured ${String(/** @type {{ code?: unknown }} */ (e)?.code ?? 'unknown')}`);
  }
  refuse('out-refused', 'exists: a counter report goes under a fresh --out');
}

/** --out made (prepareOut), `file` written once, 0600, as the report's canonical JSON and one newline; stderr carries
 *  `sha256 <hex>` of the bytes written, stdout stays empty. Called after every refusal a run can make. */
function writeReport(out, file, report) {
  const dir = prepareOut(out);
  const text = `${canonicalJson(report)}\n`;
  try {
    writeFileSync(path.join(dir, file), text, { mode: 0o600, flag: 'wx' });
  } catch (e) {
    refuse('out-refused', `${file} unwritable ${String(/** @type {{ code?: unknown }} */ (e)?.code ?? 'unknown')}`);
  }
  process.stderr.write(`sha256 ${sha256Hex(text)}\n`);
  return EXIT.OK;
}

/** count's part 2 loader and clock: the driver's loadFinalRecord (W2-D25, W2-D24, Q23), the one part 2 loader. Tests
 *  pass their own. */
const COUNT_DEPS = Object.freeze({ loadFinal: loadFinalRecord, now: () => Date.now() });

/** count: the flags; a fresh --out; part 2 through the part 2 loader at the read instant (its chain, W2-D24's re-check
 *  first, --allow-code-change taken after window start only and answered as a stamp); this node's measure and verify
 *  outputs, each sha-checked before it is parsed; the store, read-only; the report built in memory; and only then --out,
 *  with counters.json written once. Every refusal of an input comes before --out exists; the one exception is
 *  writeReport's: a write failure after prepareOut made --out refuses out-refused and leaves the marked --out, which a
 *  re-run then refuses as existing. prepareOut's own createOut can also leave a new --out when it refuses (D-5986), which
 *  is not a refusal of an input. */
export function countCommand(flags, deps = COUNT_DEPS) {
  checkFormFlags('count', flags);
  if ((flags.supersedes === undefined) !== (flags['supersedes-sha256'] === undefined)) refuse('args-invalid', '--supersedes and --supersedes-sha256 go together');
  refuseUnlessFresh(flags.out);
  const nowMs = deps.now();
  const final = deps.loadFinal(flags, { nowMs });
  const measure = loadInput('measure', flags.measure, flags['measure-sha256'], undefined, MEASURE_CAP);
  const ab = loadInput('verify-ab', flags['verify-ab'], flags['verify-ab-sha256']);
  const rs = openCounterStore(flags.store);
  let report;
  try {
    report = countersReport({
      record: final.record, recordSha256: final.sha256, report: measure.value, ab: ab.value, rs, measures: COUNTER_MEASURES, nowMs,
      stamps: final.stamps, allowCodeChange: flags['allow-code-change'] === true,
      inputs: { part1_sha256: flags['part1-sha256'], frozen_sha256: final.frozen.sha256, supersedes_sha256: flags['supersedes-sha256'] ?? null,
        measure_sha256: measure.sha256, verify_ab_sha256: ab.sha256 },
    });
  } finally {
    rs.close();
  }
  return writeReport(flags.out, COUNTERS_FILE, report);
}

// ── the measures, composed (W2-D87): every counter's spec, in COUNTER_NAMES' order ──────────────────────────────────
/** The stand-in every counter is until its own task lands. @type {CounterSpec} */
const PENDING = Object.freeze({
  source: 'none yet: this counter\'s measure has not landed',
  measure: () => unmeasured('pending'),
  fold: () => { throw new Error('PENDING.fold: a pending counter measures nothing, so nothing is folded'); },
});

/** One CounterSpec per counter, keyed and ordered as COUNTER_NAMES (countersReport throws on anything else). Each
 *  counter's task replaces its own line and declares its spec above this block. */
export const COUNTER_MEASURES = Object.freeze({
  compliance: PENDING,
  echo_hits: PENDING,
  lag: PENDING,
  card_served: PENDING,
  card_id_mismatch: PENDING,
  rediscovery: PENDING,
});

/** The entry: the umask first (W2-D53), then the driver's grammar with this file's specs and subcommands. */
export function main(argv, deps = COUNT_DEPS) {
  try {
    process.umask(0o077);
    const { sub, flags } = parseArgs(argv, { specs: COUNTER_FLAG_SPECS, subs: COUNTER_SUBCOMMANDS });
    return COUNTER_FORMS[sub].run(flags, deps);
  } catch (e) {
    if (e instanceof DriverRefusal) {
      process.stderr.write(`${PREFIX}: ${e.word}: ${e.detail}\n`);
      return EXIT.REFUSED;
    }
    process.stderr.write(`${PREFIX}: internal error: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    return EXIT.INTERNAL;
  }
}

// The entry guard stays the LAST block of this file. Importing the module (the tests do) runs nothing; the exit code is
// set, never forced, so stderr drains. main reads no environment.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
```

- [ ] **Step 5: Run the new cases; they pass.** In the foreground, with a timeout of at least 600000 ms:

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-6 Task 1'
```

Expected GREEN (predicted): 31 passed on linux (30 passed and 1 skipped on darwin). If a frame case is red, re-derive its number from the fixture with the gate's `buildWindows` on the same family, as the case's own CONTROL does; a wrong prediction is corrected in this plan's text in the same commit (U17). The guard is never weakened to match a number.

*Measured over predicted (Task 1, U17):* Step 3 measured as predicted (28 failed, 3 passed). Step 5's filtered run measured 31 passed, but the whole file did not: an earlier case of the file calls `vi.resetModules()` (D-6301's), so `w6cLoad`'s dynamic import loads a fresh driver whose `DriverRefusal` is not the statically imported class, and 13 W2-6 cases failed the `instanceof` test in `w6cRefusalOf` and `w6cInProcess` although the word and detail were right. The helpers now test `w6cIsRefusal` (the class, or an `Error` named `DriverRefusal`), and the word and detail are still asserted in full. The emission pin's `tallies` expression also failed the server test project's typecheck (`Object.values` of an `any` read as `unknown[]`), so it casts to `W6cR[]` first. Both corrections are in the code above. The whole file then measured 1163 passed.

*Fix round 1 (review 963 F6, comment only):* `countCommand`'s doc comment said every refusal comes before `--out` exists; `writeReport` is the exception (a `writeFileSync` failure after `prepareOut` refuses `out-refused` and leaves the marked `--out`). The comment and the Choices paragraph above now say so; no code line changed. *Fix round 2 (review 965 F5):* the comment adds that `prepareOut`'s own `createOut` can also leave a new `--out` when it refuses (D-5986, an I/O failure making `--out`), which is not a refusal of an input; still no code line changed.

- [ ] **Step 6: Measure every new guard red, then green.** From the repository root. Each mutant is one or more exact replacements, each asserted to match once. The mutant table is written through a quoted heredoc, so no shell expansion touches the code. Every run restores the touched files with `cp`.

```bash
SCRATCH=.superpowers/sdd/history-w2-6/scratch; mkdir -p "$SCRATCH"
cat > "$SCRATCH/mut6t1.py" <<'EOF'
import sys
C = 'deploy/history-counters.mjs'
D = 'deploy/history-replay.mjs'
MUTANTS = {
  'M1': [(C, "asm = assembleReports([report], { ...record, assignment }, { allowCodeChange });", "asm = assembleReports([report], record, { allowCodeChange });")],
  'M2': [(C, "strata: perArm((r) => !r.changed && !r.unrealised),", "strata: perArm((r) => !r.unrealised),")],
  'M3': [(C, "    buildWindows(f).forEach((w, i) => {", "    if (changedKeys.has(key)) continue;\n    buildWindows(f).forEach((w, i) => {")],
  'M4': [(C, "const copy = window.state === 'measured' ? windowCopyOf(boundary.copies) : null;", "const copy = window.state === 'measured' ? boundary.copies[0] : null;")],
  'M5': [(C, "turnsOf(copy.rows).slice(0, K)", "turnsOf(copy.rows)")],
  'M6': [(C, "(measuredRows.length === 0 ? null : measuredRows.reduce(", "(measuredRows.length === 0 ? 0 : measuredRows.reduce(")],
  'M7': [(C, "summary: values.length === 0 ? null : measures[n].fold(values),", "summary: measures[n].fold(values),")],
  'M8': [(C, "function checkMeasures(measures) {\n", "function checkMeasures(measures) {\n  return;\n")],
  'M9': [(C, "if (o?.state === 'unmeasured' && COUNTER_UNMEASURED.includes(o.why))", "if (o?.state === 'unmeasured')")],
  'M10': [(C, "const rows = report.w2.recall_off;", "const rows = report.w2.recall_off ?? [];")],
  'M11': [(C, "  if (reason === 'code-changed' || reason === 'code-unmeasured') refuse(reason, detail);\n", "")],
  'M12': [(C, "  refuse('out-refused', 'exists: a counter report goes under a fresh --out');\n", "")],
  'M13': [(C, "  refuseUnlessFresh(flags.out);\n  const nowMs", "  refuseUnlessFresh(flags.out);\n  prepareOut(flags.out);\n  const nowMs")],
  'M14': [(C, "process.stderr.write(`sha256 ${sha256Hex(text)}\\n`);", "process.stderr.write(`sha256 ${sha256Hex(canonicalJson(report))}\\n`);")],
  'M15': [(C, "if (row === undefined) refuse('store-unreadable', 'store-id-absent');", "if (row === undefined) refuse('store-unreadable', 'store-id-unreadable');")],
  'M16': [(C, "#!/usr/bin/env -S node --no-warnings\n", "#!/usr/bin/env node\n")],
  'M17': [(D, "// The entry guard stays the LAST block of this file", "const loadCounters = () => import('./history-counters.mjs');\n// The entry guard stays the LAST block of this file")],
  'M18': [(C, "import { StoreError, openReader, userVersion } from", "import { StoreError, openReader, openWriter, userVersion } from")],
  'M19': [(C, "  checkMeasures(measures);\n", "  checkMeasures(measures);\n  const nodeWide = report.counters;\n")],
  'M20': [(C, "export const COUNTERS_FILE = 'counters.json';\n", "export const COUNTERS_FILE = 'counters.json';\nconst SPELLED_NAME = 'echo_hits';\n")],
  'M21': [(C, "if (!(nowMs >= end)) refuse(", "if (!(nowMs > end)) refuse(")],
  'M22': [(C, "  if (record.counters_def?.id !== 'v1' || record.counters_def?.sha256 !== COUNTERS_DEF_V1_SHA256) {\n", "  if (false) {\n")],
  'M23': [(C, "  if (ab.record_sha256 !== recordSha256) bad(", "  if (false) bad(")],
  'M24': [(C, "strata: perArm((r) => !r.changed && !r.unrealised),", "strata: perArm((r) => !r.changed),")],
  'M25': [(C, "    turns: isMeasured ? w.turns : null,\n", "    turns: w.turns,\n")],
  'M26': [(C, "code_changed: stamps.includes('code-changed') || asm.code_changed,", "code_changed: asm.code_changed,")],
  'M27': [(C, "{ ...record, assignment }, { allowCodeChange });", "{ ...record, assignment });")],
  'M28': [(C, "  if (want.join('\\n') !== got.join('\\n')) bad(", "  if (false) bad(")],
  'M29': [(C, "if (!form.required.includes(k) && !form.optional.includes(k)) refuse(", "if (false) refuse(")],
  'M30': [(C, "const final = deps.loadFinal(flags, { nowMs });", "const final = deps.loadFinal(flags, {});")],
  'M31': [(C, "  for (const k of form.required) if (flags[k] === undefined) refuse('args-invalid', `${k}-required`);\n", "")],
  'M32': [(C, "if ((flags.supersedes === undefined) !== (flags['supersedes-sha256'] === undefined)) refuse(", "if (false) refuse(")],
  'M33': [(C, "  if (typeof out !== 'string' || !path.isAbsolute(out)) refuse('out-refused', 'relative');", "  if (typeof out !== 'string') refuse('out-refused', 'relative');")],
  'M34': [(C, "  if (!ASSIGNMENT_ARMS.includes(family.arm)) throw new TypeError(", "  if (false) throw new TypeError(")],
  'M35': [(C, "  if (!BACKENDS.includes(w.producer)) throw new TypeError(", "  if (false) throw new TypeError(")],
  'M36': [(C, "  if (!AB_STATES.includes(abState)) throw new TypeError(", "  if (false) throw new TypeError(")],
  'M37': [(C, "  if (boundary?.boundary_uuid !== window.boundary_uuid) throw new Error(", "  if (false) throw new Error(")],
  'M38': [(C, "    if (e instanceof TypeError) refuse('input-invalid', `measure shape: ${e.message}`);\n", "")],
  'M39': [(C, "    if (states.has(key)) bad(`shape: family ${key} is listed twice`);\n", "")],
  'M40': [(C, "  if (ab.seen_after_write !== true) {\n", "  if (false) {\n")],
  'M41': [(C, "  const abStates = abStatesOf(ab, recordSha256, rs.storeId, assignment);\n",
           "  if (ab?.seen_after_write !== true) refuse('input-invalid', 'verify-ab-presence-stale: checked first');\n  const abStates = abStatesOf(ab, recordSha256, rs.storeId, assignment);\n")],
  'M42': [(C, "    dropped_strata: { changed: perArm((r) => r.changed), unrealised: perArm((r) => r.unrealised) },",
           "    dropped_strata: { changed: byProducer((r) => r.changed), unrealised: byProducer((r) => r.unrealised) },")],
  'M43': [(C, "changed, unrealised: abState !== AB_OK, ab_state: abState,", "changed, unrealised: abState === AB_STATES[1] || abState === AB_STATES[2], ab_state: abState,")],
}
for f, old, new in MUTANTS[sys.argv[1]]:
    s = open(f).read()
    assert s.count(old) == 1, (sys.argv[1], f, old, s.count(old))
    open(f, 'w').write(s.replace(old, new))
EOF
cat > "$SCRATCH/r6t1.sh" <<'EOF'
# r6t1.sh <mutant> <filter>, from the repository root: apply one mutant, run one filter, restore both files.
S=.superpowers/sdd/history-w2-6/scratch
python3 "$S/mut6t1.py" "$1" && (cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t "$2")
cp "$S/counters.t1.orig" deploy/history-counters.mjs; cp "$S/replay.t1.orig" deploy/history-replay.mjs
EOF
cp deploy/history-counters.mjs "$SCRATCH/counters.t1.orig"
cp deploy/history-replay.mjs "$SCRATCH/replay.t1.orig"
```

Then one call per mutant, `bash .superpowers/sdd/history-w2-6/scratch/r6t1.sh <mutant> '<filter>'`, each in the foreground (one suite per tool call). The runner is a file, so no shell function or variable has to outlive a tool call. The filter is a vitest `-t` regex, and none starts with `-` (vitest's argument parser would read a leading `--` as a flag of its own); the table writes its `|` as markdown's `\|`, and the command takes a plain `|`:

| Mutant | filter | Expected RED (predicted) |
|---|---|---|
| M1 | `excluded is assembleReports` | 1 failed: `not_listed` `[key(F_O)]` where `[]` was expected |
| M2 | `changed family is dropped\|strata: by arm` | 2 failed: treatment/anthropic counts F_X (2 windows) |
| M3 | `the frame: one row per boundary\|changed family is dropped` | 2 failed: F_X's row is gone |
| M4 | `window copy and its first K turns` | 1 failed: `windowCtx: window <gen 206> counts 10 turns, and its copy gives 2` |
| M5 | `the frame: one row per boundary` | 1 failed: `windowCtx: window <gen 202> counts 10 turns, and its copy gives 11` |
| M6 | `strata: by arm` | 1 failed: treatment/unknown `turns` 0 where `null` was expected |
| M7 | `strata: by arm` | 1 failed: `fold called on nothing` |
| M8 | `the measures contract` | 1 failed: "missing" throws `Cannot read properties of undefined`; "extra" does not throw |
| M9 | `the measures contract` | 1 failed: `{state: 'unmeasured', why: 'no-such-word'}` is accepted |
| M10 | `the recall-off rows` | 1 failed: no refusal for an absent list |
| M11 | `two code words` | 1 failed: `input-invalid` where `code-changed` was expected |
| M12 | `an --out that exists` | 1 failed: `store-unreadable` and loads 1, where `out-refused` and 0 were expected |
| M13 | `leaves no --out\|an --out that exists` | 3 failed: an `--out` exists after each refusal (measured: the filter selects 20 cases, 3 failed and 17 passed) |
| M14 | `count writes one report` | 1 failed: the stderr sha is of the bytes without their newline |
| M15 | `refuses as the driver` | 1 failed: `store-id-unreadable` where the driver says `store-id-absent` |
| M16 | `standalone entry\|run as a file` | 2 failed on linux (the shebang text; stderr starts `(node:<pid>) ExperimentalWarning`), 1 on darwin |
| M17 | `neither the driver nor the gate` | 1 failed: `history-replay.mjs: [ "const loadCounters = () => import('./history-counters.mjs');" ]` |
| M18 | `imports exactly its modules` | 1 failed: `../ccd/history/store.mjs brings in { StoreError, openReader, openWriter, userVersion }` |
| M19 | `table is never read` | 1 failed: `[ '  const nodeWide = report.counters;' ]` |
| M20 | `derived, in order` | 1 failed: `[ "const SPELLED_NAME = 'echo_hits';" ]` |
| M21 | `run checks refuse in one order` | 1 failed: the CONTROL at `end_ms` exactly refuses `window-open` |
| M22 | `run checks refuse in one order` | 1 failed: null where `record-invalid` was expected |
| M23 | `run checks refuse in one order\|verify output of another part 2` | 2 failed: no `verify-ab-record-mismatch` |
| M24 | `did not confirm is dropped` | 1 failed: a `control-absent` F_C stays in the control cells (`control` all 2 where 1 was expected) |
| M25 | `the frame: one row per boundary` | 1 failed: F_U's `turns` 0 where `null` was expected |
| M26 | `allow-code-change \(Q23\|count takes --allow-code-change` | 2 failed: `code_changed` false under the loader's stamp |
| M27 | `allow-code-change \(Q23` | 1 failed: the flagged run refuses `code-changed` |
| M28 | `run checks refuse in one order` | 1 failed: a verify output missing a family, or a family at another arm, is accepted (measured: the frame then throws `windowRow: family … has verify state undefined`, a `TypeError`, so the case fails on that throw) |
| M29 | `count takes --allow-code-change` | 1 failed: `--node-label` is accepted (the run then succeeds) |
| M30 | `count writes one report` | 1 failed: the loader is handed `{}` where `{nowMs: <the clock>}` was expected |
| M31 | `the count flag guards` | 1 failed: a missing `--measure` is not refused `measure-required` before the record is read |
| M32 | `the count flag guards` | 1 failed: `--supersedes` alone runs through (refusal null, `loads` 1, an `--out` made) |
| M33 | `the count flag guards` | 1 failed: a relative `--out` is refused only by `prepareOut`, after the record is read (`loads` 1) |
| M34 | `the frame refuses what it cannot place` | 1 failed: arm `unassigned` makes a row |
| M35 | `the frame refuses what it cannot place` | 1 failed: producer `nobody` makes a row |
| M36 | `the frame refuses what it cannot place` | 1 failed: verify state `no-such-state` makes a row |
| M37 | `the frame refuses what it cannot place` | 1 failed: the throw is the turn count's (`counts 3 turns, and its copy gives 10`), not `is not boundary` |
| M38 | `the frame refuses what it cannot place` | 1 failed: the gate's `TypeError` escapes unrefused (measured: `assembleReports: report 0: w2 is no object holding a families array`) |
| M39 | `run checks refuse in one order` | 1 failed: a family listed twice is accepted, its last state kept |
| M40 | `presence record has not seen` | 1 failed: the stale verify output is counted (refusal null where `verify-ab-presence-stale` was expected; V2) |
| M41 | `presence record has not seen` | 1 failed: the presence check runs before the verify output's own checks (detail `verify-ab-presence-stale: checked first` where the full detail was expected; V2's order) |
| M42 | `changed family is dropped\|did not confirm is dropped\|strata: by arm\|every counter the frame emits` | 4 failed: the dropped tallies keyed by producer alone (`dropped_strata.changed.treatment` undefined; the keys case; the emission pin's tally count; V3) |
| M43 | `did not confirm is dropped` | 1 failed: a `treatment-named` F_T stays `unrealised: false`, so it is compared as its arm (V1) |

```bash
S=.superpowers/sdd/history-w2-6/scratch
cmp deploy/history-counters.mjs "$S/counters.t1.orig" && cmp deploy/history-replay.mjs "$S/replay.t1.orig" && echo restored \
  && rm -f "$S/counters.t1.orig" "$S/replay.t1.orig"
git status --short   # this task's two paths, plus the plan if U17 applied
```

Then re-run Step 5's command on the restored tree: 31 passed (30 and 1 skipped on darwin). A guard with no mutant here is pinned by a CONTROL inside its own case: the two-copy CONTROL, the `not_listed` CONTROL, the empty-list CONTROL, the realised-word CONTROL, the four-states CONTROL (V1), the half-open CONTROL, the fresh-`--out` CONTROL, and V2's two CONTROLs (the driver's own `verifyAbReport` verdict over the fixture's instants, and the fresh fixture counted). A red at a CONTROL is the fixture's to fix, never the guard's to weaken.

- [ ] **Step 7: Run the file and the neighbours that read these files.** In the foreground, with a timeout of at least 600000 ms, one suite per tool call. A red file is re-run alone before it is called a break (CLAUDE.md's load flakes; `typecheck-tests` is one).

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts
cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts
cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts
cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts
cd server && ./node_modules/.bin/vitest run test/citations.test.ts
cd server && ./node_modules/.bin/vitest run test/growth-check.test.ts
```

Expected (predicted), each green:
- **`history-replay`, the whole file:** W2-4's `node:sqlite` scan now has `history-counters.mjs` in its corpus (`/^history-[\w.-]*\.mjs$/`) and finds no quoted specifier; W2-5a's `keptOf` and decode scans over `deploy/*.mjs` find neither name on a counter code line; the driver's own import pin is unchanged; every W2-5b1 case is untouched.
- **`single-definition`, the whole file:** O13 (the counter writes no switch); O14 (the counter declares no `VOCABS` name: it imports `EXIT`, `BACKENDS` and `SCHEMA_ADDED`, and declares `COUNTER_*`, `COUNTERS_*`, `FRAME_SOURCES`, `ALL_PRODUCERS` and `AB_OK`, none listed, nor W2-2b's three additions to the list, `RECALL_ARMS`, `HEADLESS_LIST_MAX_BYTES` and `HEADLESS_LIST_MAX_PAIRS`); W2-2b's headless-marker describe (its arm-word and marker-path scans read `ccd/history` only, so the counter is outside them); the `isSyntheticModel` scan (no angle-bracket test); the write-verb-and-switch scan (the one write names its `file`); W2-1's deploy-lane exports (none declared).
- **`measure-history`:** the gate is untouched. **`lifecycle`:** it imports the driver, which is unchanged, and it pins `history-replay-out`'s creators to the driver alone, which this task leaves as it is (the residual above).
- **`typecheck-tests`:** every JavaScript export is cast through `unknown`; `node:sqlite`'s `DatabaseSync` is typed.
- **`topology-clean`:** the fixtures name `node-a`, `node-b`, synthetic UUIDs and `mkTmp` paths only.
- **`citations`:** no added code or test line cites `file.mjs:N`. **`growth-check`:** no file of this task is a `GROWTH_FILES` entry.

- [ ] **Step 8: Commit.** This task's two paths, the new file executable, and the plan only when this task corrected a prediction or defined a build-time number in it (U17):

```bash
chmod 755 deploy/history-counters.mjs
git add deploy/history-counters.mjs server/test/history-replay.test.ts
git diff --quiet -- docs/superpowers/plans/2026-10-22-ccrc-history-w2-6-counters.md || git add docs/superpowers/plans/2026-10-22-ccrc-history-w2-6-counters.md   # U17 only
git ls-files -s deploy/history-counters.mjs | cut -c1-6   # 100755
CO_AUTHORED_BY='<the Co-Authored-By line the attribution reminder gives>'
git commit -m "feat(history-counters): the report-only counter module and its frame: the gate's windows and turns, by arm and by producer, both drops, the run checks, the counters table never read (W2-6 Task 1; W2-D86, W2-D87, W2-D88, W2-D15, W2-D23; D-5770, D-5771)" -m "$CO_AUTHORED_BY"
```

### Task 2: the five spec counters, each per window, by arm and by producer, from its named source (W2-D87, W2-D86, W2-D15; D-6562)

This task gives `deploy/history-counters.mjs` the five counters spec §10.2 lists after uptake and re-discovery: compliance, echo hits, lag, `card_served` and `card_id_mismatch`. W2-D87 rules that W2-6 reports **all five, per window, by arm and by producer**, as signed defaults (`counters_def: 'v1'`). Each is one spec in Task 1's shape (U7): a `measure(ctx)` over Task 1's `WindowCtx` and a `fold(values)` over one stratum's measured values, wired as its own line of `COUNTER_MEASURES`. Task 1's frame asks each measure for every boundary (U5) and strata the answers; this task adds no frame, no stratum and no report field. Each counter reads its own named source through the run's one read handle (`ctx.rs`, Task 1's `CounterStore`). None reads the node-wide `counters` table, and none feeds `decideGate` (W2-D88; decisions §3 H).

| Counter | Per-window value | Source (all through `openReader`) | Unmeasured when |
|---|---|---|---|
| `compliance` | the stored `nodes.status` of the depth-0 leaf whose boundary opens the window; folded as lib's `PARSE_STATUS` distribution plus the ok+degraded share | `entries` → `boundaries` → `nodes` | the store holds no boundary with that uuid (`boundary-absent`); no depth-0 leaf (`leaf-absent`); more than one (`leaf-ambiguous`) |
| `echo_hits` | `{hits, errors, untimed, unreadable, prov_stale, recall_calls, gap}`: the recall-echo rows inside the window whose first `tool_result` is not an error, beside the window's `recall_calls` count, and the gap between them | `memberships` + `entries` of `ctx.copy`; each body through W2-1's `expandEntryBody`; `recall_calls` from the gate's window | the window is unmeasured (`window-unmeasured`); the store holds no boundary with that uuid (`boundary-absent`), or holds it at another line of the window copy's file than the measure reported (`boundary-moved`) |
| `lag` | `{lag_ms, tick_ts_ms}` of the newest `ticks` row at or before the boundary's `ts_ms` that has a measured lag; folded as the ascending list | `ticks` | no such row (`no-measured-tick`) |
| `card_served` / `card_id_mismatch` | `{verdict, attachments_unread}`: one verdict per boundary, lib's `decideCardDelivery({ids, leafId, windowComplete})` over `cardIdsIn` of the attachments in the first `CARD_MEASURE_ROWS` rows after the boundary in its holding copy, with `cardWindowComplete`; folded by each counter to its own verdict's count beside the shared distribution | `nodes`, `ingest_files`, `memberships` + `entries` + `boundaries` + `blobs.raw_len` of the holding copy; each attachment body through `expandEntryBody` | `boundary-absent`, `leaf-absent`, `leaf-ambiguous`; no copy holds the boundary (`boundary-uncopied`); the delivery window still open at the read instant (`card-wait`) |

Expected values, which this task reports but never enforces: `compliance` is `not-requested` throughout W2, W3's baseline and a check that nothing was steered (W2-D87). Control windows carry no card line by design, so their card figures are reported and never compared. A gap between echo hits and `recall_calls` is **reported, never repaired**: a control call answers exit 8 and its `tool_result` is expected to be an error; a call made from a subagent writes its echo into another transcript.

**Decisions:** W2-D87 (the five, their sources, per window by arm and by producer, `counters_def: 'v1'`); W2-D86 (entry bodies through `openReader` and W2-1's exports; no decode here); W2-D15 (the producer is the frame's `window.producer`; the window copy is `ctx.copy`, `windowCopyOf`'s); W2-D14 (the window's inclusion rule reached only through the gate's `windowOf`); U5 (compliance, lag and the card measured for every boundary, an unmeasured window included: they read the boundary, not the turns); U7 (Task 1's shape, names and list); U9 (echo hits from the stored provenance); U10 (untimed echo rows over the positional range); V3 (the frame case reads `dropped_strata` by arm, then producer); V4 (echo hits answer `boundary-absent` for a boundary the store does not hold, confirmed).

It cites D-5770 and D-5771 (W2-3's window and copy rules) and D-6238 (`expandEntryBody`'s five states, W2-1's plan). It ships one departure, **D-6562** (`history-w2-counters-card-glue-respelled`), defined in this plan's "Deviations found" before dispatch; this task is the first to cite it.

**Files:**
- Modify: `deploy/history-counters.mjs`:
  - the `../ccd/history/lib.mjs` statement gains `CARD_ATTACHMENT_MAX_BYTES`, `CARD_MEASURE_ROWS`, `PARSE_STATUS`, `PROV_VERSION`, `cardIdsIn`, `cardWindowComplete`, `decideCardDelivery` and `eofAfterBoundary`; the `./history-gate.mjs` statement gains `windowOf`; two statements go directly after the `../ccd/history/store.mjs` statement: `import { holdingCopyOf } from '../ccd/history/derive.mjs';` and `import { expandEntryBody } from '../ccd/history/recall.mjs';`;
  - Task 1's `COUNTER_UNMEASURED` gains seven lines directly after its `'pending'` line;
  - one section, inserted directly above the comment `// ── the measures, composed (W2-D87): every counter's spec, in COUNTER_NAMES' order ──…`;
  - `COUNTER_MEASURES`' first five lines become `compliance: COMPLIANCE,`, `echo_hits: ECHO_HITS,`, `lag: LAG,`, `card_served: CARD_SERVED,` and `card_id_mismatch: CARD_ID_MISMATCH,`.
- Modify: `server/test/history-replay.test.ts`, inside W2-6's region only:
  - Task 1's `W6C_EXPECTED_IMPORTS` and `W6C_EXACT_NAMES` entries, in place, for the import changes above;
  - one import group directly after Task 1's import group;
  - this task's module-scope fixtures and its two describes directly above the region's closing marker.
- Not edited: everything else (Global Constraints). `ccd/history/card.mjs` is imported by the test for one parity CONTROL, never edited.

**Interfaces:**
- Consumes (merged at the base, unchanged; line numbers are hints, anchor by name):
  - `ccd/history/lib.mjs`: `PARSE_STATUS` (`['ok', 'degraded', 'invalid', 'absent', 'not-requested', 'parse-failed']`); `PROV_VERSION` (the provenance rule version ingest stamps on `entries.prov_version`); `CARD_MEASURE_ROWS` (40), `CARD_ATTACHMENT_MAX_BYTES` (1 MiB), `CARD_MEASURE_MAX_WAIT_MS` (tests only); `cardIdsIn(attachment): string[]`; `cardWindowComplete({live, rowsSeen, nextBoundary, eofAfter, waitedMs}): boolean`; `decideCardDelivery({ids, leafId, windowComplete}): 'served' | 'mismatch' | 'none' | 'wait'`; `eofAfterBoundary({eofMs, boundaryTsMs}): boolean`; tests only: `cardLine({leaf})`, `historyPaths`, `SCHEMA_ADDED`, `CARD_PREFIX`, `backendOf`.
  - `ccd/history/derive.mjs`: `holdingCopyOf(db, {entry_id, transcript_pk}): {file_id, eof_ms, source_key} | null`, lib's `pickHoldingCopy` over the store. It prepares derive's statement set on the handle; on a `query_only` handle a prepare succeeds and only a step refuses, and nothing here steps a write (W2-5a Task 1 measured this).
  - `ccd/history/recall.mjs`: `expandEntryBody(rc: {db, version, schema}, e: {entry_id, blob_id}): {state: 'body' | 'unparseable' | 'tombstone' | 'over-cap' | 'undecodable', body, primary, causes, blob}` (D-6238).
  - `ccd/history/card.mjs` (tests only, the parity CONTROL): `measureCardDelivery(db, {nowMs, budgetLeft}, {bytes}): {measured, served, mismatch, waiting}`.
  - `deploy/history-gate.mjs`: `windowOf(boundary, calls, k = K): Window`; tests only: `windowCopyOf`, `producerCopyOf`, `familyKey`.
  - Task 1: `WindowCtx` (`ctx.rs`, `ctx.boundary`, `ctx.window`, `ctx.copy`, `ctx.nowMs`), `windowCtx`, `windowRow`, `stratify`, `COUNTER_MEASURES`, `COUNTER_UNMEASURED`, and the private `measured`, `unmeasured` and `nonEmpty`.
- Produces (`deploy/history-counters.mjs`, exported unless marked):
  - seven `COUNTER_UNMEASURED` words: `'boundary-absent'`, `'boundary-moved'`, `'leaf-absent'`, `'leaf-ambiguous'`, `'boundary-uncopied'`, `'no-measured-tick'`, `'card-wait'`;
  - `boundaryLeafOf(rs, boundaryUuid): {state: 'leaf', entry_id, transcript_pk, node_id, status, created_ms} | Measure` (unmeasured `boundary-absent`, `leaf-absent` or `leaf-ambiguous`), which Task 3 reuses;
  - the measures, each `(ctx: WindowCtx) => Measure`: `complianceAt` (value: the status string), `echoAt`, `lagAt`, `cardAt` (memoised per `ctx`, so both card counters answer one verdict object);
  - the folds, each never handed an empty list (`nonEmpty`): `foldCompliance(values) → {status: Record<PARSE_STATUS word, n>, out_of_vocabulary, ok_degraded: {num, den}}`; `foldEcho(values) → {hits, errors, untimed, unreadable, prov_stale, recall_calls, gap}`; `foldLag(values) → {lag_ms: number[]}`, ascending; `foldCardFor('served' | 'mismatch') → (values) => {n, verdicts: {served, mismatch, none}, attachments_unread}`, any other word a `TypeError`;
  - the specs, frozen: `COMPLIANCE`, `ECHO_HITS`, `LAG`, `CARD_SERVED`, `CARD_ID_MISMATCH`;
  - module-private: `COUNTER_STMTS` and `counterStmts(db)` (SELECTs only, prepared once per handle), `insideWindow(ctx, ts)`, `firstToolResult(body)`, `CARD_VERDICTS`, `cardVerdictOf(ctx)`, `CARD_SOURCE`; and, added by review 963 F1 (the shape of each measured value, read by combine): `isCount`, `isPlain`, `hasKeys`, `CARD_VERDICT_WORDS` (the verdicts `foldCardFor` also derives its keys from) and `complianceValueOk`, `echoValueOk`, `lagValueOk`, `cardValueOk`, `rediscoveryValueOk`.
- Produces (test side): the import bindings `w6cCtrMod`, `w6cCardMod`, `w6cHash`; the module-scope `W6C_T2`, `W6C_T2_MODEL`, `W6C_T2_NOW`, `W6C_T2_GEN`, `W6C_T2_LEAF`, `w6cT2Uid`, `w6cT2Leaf`, `w6cT2NodeId`, `w6cT2Line`, `w6cT2Result`, the row builders, `w6cT2Plant`, `w6cT2Open`, `w6cT2With`, `w6cT2Copy`, `w6cT2Rep`, `w6cT2Part`, `w6cT2Ctx`, `w6cT2EchoStore`, `w6cT2CardStore`, `w6cT2WaitStore`; the describes `W2-6 Task 2: the five spec counters, their folds and their place (W2-D87, W2-D15)` (7 cases, pure and the module scan) and `W2-6 Task 2: the five spec counters over fixture stores (W2-D87, W2-D86, U9, U10)` (8 cases). Neither spawns a child, so neither is skipped on darwin.

**Choices this task makes:**
- **Echo hits read the provenance `provenanceOf` stored (U9).** Ingest stores its answer in `entries.provenance`, beside `prov_version = PROV_VERSION`. Reading `provenance = 'recall-echo'` reads the rule's own answer; calling it again would need a second pairing walk, a second spelling. A row stamped under another `prov_version` is counted `prov_stale`, never a hit, whatever it was stored as: the rows read are the stored `recall-echo` ones and, under another `prov_version`, the stored `tool` ones too (the two answers of `provenanceOf`'s `tool_result` branch), because the rule that would re-read a stale `tool` row may call it an echo. Stale rows are counted inside the window when timed and over the positional range when not (U10).
- **A boundary away from its reported line is `boundary-moved`.** Echo hits read the window copy's rows by the lines measure-history.py printed, so the store must hold the boundary at that line of that file. A line the sweep moved, or a file id a rebuild renumbered, leaves the window unmeasured, never a silent read of another window's rows (Task 3's `row-moved` guards the same seam for re-discovery's turn rows).
- **"Not an error" is the row's first `tool_result` block, with `is_error !== true`.** That block is the one `provenanceOf` paired. An absent `is_error` is not an error. A body `expandEntryBody` cannot give as `body` is counted under its own word (`tombstone`, `over-cap`, `undecodable`, `unparseable`), a body with no `tool_result` block under `no-tool-result`; none is folded into hits or errors.
- **An echo row is in the window by the gate's rule, never by a second one.** The rows are taken from `ctx.copy` in file order, after the boundary line and before the next main boundary's line, the positional range measure-history.py's raw rows use; each is placed in time by `windowOf` over one synthetic call at its `ts_ms`, so the inclusive start and the exclusive or inclusive end are spelled once, in the gate (W2-D14). A row with a null `ts_ms` is counted `untimed` over the whole positional range (U10).
- **A boundary the store does not hold is unmeasured for every counter** (`boundary-absent`), never 0 echo hits: the store answers for a boundary measure-history.py reported only if it holds it. The coordinator confirmed this for echo hits (V4).
- **A boundary no copy holds is `boundary-uncopied`, not `none`.** card.mjs's `deliveryOf` reads it `none` (no copy, so not live, so the window reads complete). That never moves a served or mismatch count, so the parity CONTROL stays exact; but "no copy" is not a measured delivery (D-6562).
- **The card's copy is `holdingCopyOf` over the store, not the gate's `producerCopyOf` over Python's copies.** Both apply lib's `pickHoldingCopy`; only the store's row carries the `eof_ms` `eofAfterBoundary` needs. `live` is card.mjs's: `source_key === ''` and `ingest_files.status === 'live'`. The boundary's time is the store's, card.mjs's `stampAt` spelled again (the newest stamped row at or before the boundary's line in the holding copy, `null` when none, D-6563), and the wait is `ctx.nowMs` less the leaf's `created_ms`.
- **Compliance, lag and the card are measured for every boundary, an unmeasured window included (U5).** Echo hits need the window's bounds, so an unmeasured window answers `window-unmeasured`.
- **The folds divide nothing.** The ok+degraded share is `{num, den}`; a fold is never called on an empty list (Task 1 answers `null` there), so `den` is never 0. Lag is the sorted list of measured values; no p95 or median that `COUNTERS_DEF_V1` does not define.
- **The card verdict per boundary is computed once and projected twice.** Both card specs measure with `cardAt`, memoised on the frozen `ctx` Task 1 hands every measure of one row; `card_served`'s fold counts `served`, `card_id_mismatch`'s counts `mismatch`, and each carries the whole distribution.

**Departure:** **D-6562** (`history-w2-counters-card-glue-respelled`). W2-D87 says the card counters use "the same functions the sweep's card measure uses, so no rule is spelled again". The functions are shared: `cardIdsIn`, `cardWindowComplete` and `decideCardDelivery`, each called once and declared nowhere here, which the module scan pins. The glue around them is card.mjs's module-private `deliveryOf`, and W2-6 never touches `ccd/**`, so it is spelled a second time in `cardVerdictOf`: the rows after the boundary up to the next boundary, at most `CARD_MEASURE_ROWS`; `live`; the `CARD_ATTACHMENT_MAX_BYTES` skip; `waitedMs`. Held by the parity CONTROL against card.mjs's `measureCardDelivery` on the same fixture store (its aggregate counts: measured 8, served 1, mismatch 1, waiting 1) and by mutants M17 to M22, M24 and M30 to M34 (D-6563). A boundary no copy holds answers `boundary-uncopied` where card.mjs answers `none`. Moving the glue into lib is a later `ccd/**` follow-up.

**Residuals, named:**
- **Untimed echo rows are counted over the whole positional range** (U10), so a null-stamped echo row past the window's end is still `untimed`; reported beside the hits, folded into nothing.
- **Lag reads the node's tick series**, so two windows on one node near one instant share a reading (decisions §7, W2-D87).
- **The store is read after measure-history.py ran.** Echo hits read the window copy's lines from Python's report, and the card reads the store's holding copy at the run's read instant. A sweep tick between the two can append rows; a line it moved, or a file id a rebuild renumbered, leaves the boundary away from its reported line, which echo hits answer `boundary-moved`, never a read of other rows. The operator runs both after window end on a frozen tree (W2-D88).
- **Echo rows written in subagent transcripts are not in the main copy:** a positive gap against `recall_calls`.
- **The card glue is a second spelling** (D-6562); the parity CONTROL covers the fixture's shapes only, and compares card.mjs's aggregate counts, the only thing `measureCardDelivery` exposes (review 963 F3).
- **The leaf-of-boundary rule is a second spelling.** `counterStmts`' `leaves` spells leaf N's node (the depth-0 node whose `boundary_entry_id` is N) again from the driver's module-private `LEAF_OF_BOUNDARY_SQL` (W2-5b1), without its `LIMIT 1`, so `boundaryLeafOf` can tell `leaf-ambiguous` apart; the driver's scan reads the driver alone, so nothing reds on a drift. Held by M1 here and, in Task 3, by the span parity pin, which reads the counter's span through `boundaryLeafOf`'s node id. This file spells the rule once: Task 3 reuses that node id rather than a second subquery.

- [ ] **Step 0: Check Task 1's state.** From the repository root, before any edit:

```bash
git log --oneline -1 -- deploy/history-counters.mjs
grep -c "^// ── the measures, composed (W2-D87): every counter's spec, in COUNTER_NAMES' order" deploy/history-counters.mjs
grep -c "^  'pending',  " deploy/history-counters.mjs
grep -cE '^export function (windowCtx|windowRow|stratify|countersReport)\(' deploy/history-counters.mjs
grep -c "^// ── end of W2-6's region (Q29)" server/test/history-replay.test.ts
```

Expected: Task 1's commit line, then `1`, `1`, `4`, `1`. On anything else, stop: Task 1 has not landed as this plan states.

- [ ] **Step 1: Confirm the exports this task consumes, and the window the A1 fixture relies on.** From the repository root:

```bash
node --no-warnings --input-type=module -e "
const lib = await import('./ccd/history/lib.mjs');
const need = ['PARSE_STATUS','PROV_VERSION','BACKENDS','CARD_MEASURE_ROWS','CARD_MEASURE_MAX_WAIT_MS','CARD_ATTACHMENT_MAX_BYTES','cardIdsIn','cardWindowComplete','decideCardDelivery','eofAfterBoundary','cardLine','SCHEMA_ADDED','historyPaths','CARD_PREFIX'];
console.log(need.filter((n) => !(n in lib)).join(',') || 'lib: all present');
const g = await import('./deploy/history-gate.mjs');
console.log(['windowOf','windowCopyOf','producerCopyOf','familyKey'].filter((n) => !(n in g)).join(',') || 'gate: all present');
const d = await import('./ccd/history/derive.mjs'); const r = await import('./ccd/history/recall.mjs'); const c = await import('./ccd/history/card.mjs');
console.log(typeof d.holdingCopyOf, typeof r.expandEntryBody, typeof c.measureCardDelivery, lib.PROV_VERSION, lib.backendOf('claude-fixture-4'));
const M = 'claude-fixture-4';
console.log(JSON.stringify(g.windowOf({ boundary_uuid: 'b', ts_ms: 10000, copies: [{ file_id: 1, source_key: '', boundary_line: 3, after_count: 16, summary_line: 4, next_boundary_line: 18, next_boundary_ts_ms: 30000, last_ts_ms: 12000, rows: [[6, 10100, null, null, 'u6', M], [8, 10300, null, null, 'u8', M], [10, 10500, null, null, 'u10', M]], models: [M], truncated: false }] }, [[10150, 0, 'grep'], [10350, 0, 'describe'], [10450, 8, 'grep'], [31000, 0, 'grep']])));
"
```

Expected, as measured at `4f560398c`:

```
lib: all present
gate: all present
function function function 1 anthropic
{"boundary_uuid":"b","ts_ms":10000,"producer":"anthropic","state":"measured","start_ms":10000,"end_ms":30000,"end_inclusive":false,"turns":3,"calls":3,"with_call":true}
```

A different answer means the gate or lib moved; stop and report it.

- [ ] **Step 2: Write the failing tests.** Three edits, all inside W2-6's region of `server/test/history-replay.test.ts`.

(a) In Task 1's describe, the import pin's two constants become:

```ts
  const W6C_EXPECTED_IMPORTS = ['node:fs', 'node:path', 'node:url', '../ccd/history/lib.mjs', '../ccd/history/store.mjs', '../ccd/history/derive.mjs',
    '../ccd/history/recall.mjs', './history-gate.mjs', './history-replay.mjs'];
  const W6C_EXACT_NAMES: Record<string, string> = {
    'node:fs': '{ lstatSync, readFileSync, realpathSync, writeFileSync }',
    'node:path': 'path',
    'node:url': '{ fileURLToPath, pathToFileURL }',
    '../ccd/history/lib.mjs': '{ BACKENDS, CARD_ATTACHMENT_MAX_BYTES, CARD_MEASURE_ROWS, EXIT, PARSE_STATUS, PROV_VERSION, SCHEMA_ADDED, UUID_RE, canonicalJson, cardIdsIn, cardWindowComplete, decideCardDelivery, eofAfterBoundary, sha256Hex }',
    '../ccd/history/store.mjs': '{ StoreError, openReader, userVersion }',
    '../ccd/history/derive.mjs': '{ holdingCopyOf }',
    '../ccd/history/recall.mjs': '{ expandEntryBody }',
    './history-gate.mjs': '{ ASSIGNMENT_ARMS, COUNTERS_DEF_V1, COUNTERS_DEF_V1_SHA256, K, K_UNIT, assembleReports, buildWindows, changedFamilies, familyKey, turnsOf, windowCopyOf, windowOf }',
    './history-replay.mjs': '{ AB_STATES, DriverRefusal, VERIFY_AB_KIND, loadFinalRecord, loadInput, parseArgs, prepareOut, refuse }',
  };
```

(b) Directly after Task 1's import group (after its `import { REPO as W6C_REPO, scrubbedEnv as w6cScrubbed } from './historyHelpers.js';`):

```ts
// W2-6 Task 2 (W2-D87): the counter, statically now that Task 1 made it, card.mjs for one parity CONTROL, and the blob key.
import * as w6cCtrMod from '../../deploy/history-counters.mjs';
import * as w6cCardMod from '../../ccd/history/card.mjs';
import { createHash as w6cHash } from 'node:crypto';
```

(c) Directly above the region's closing marker:

```ts
// ── W2-6 Task 2: the five spec counters (W2-D87, W2-D86, W2-D15; spec §10.2's live A/B counters, §6.2) ─────────────
// In-process only: no case spawns a child or reads a live home. Every model is the synthetic claude-fixture-4 (lib reads
// it anthropic); leaf ids are 'L' and 20 hex digits; every card line comes from lib's cardLine, never typed here. Each
// measure is asked through Task 1's windowCtx, so the copy and the turns it is handed are the frame's. W6C_T2_NOW is
// the read instant every card case passes.
type W6cT2Value = { state: string; why?: string; value?: any };
type W6cT2RawRow = [number, number | null, string | null, string | null, string, string | null];
interface W6cT2Copy {
  file_id: number; source_key: string; boundary_line: number; after_count: number; summary_line: number | null;
  next_boundary_line: number | null; next_boundary_ts_ms: number | null; last_ts_ms: number | null;
  rows: W6cT2RawRow[]; models: Array<string | null>; truncated: boolean;
}
interface W6cT2Boundary { boundary_uuid: string; ts_ms: number; copies: W6cT2Copy[] }
interface W6cT2Part {
  family: { key: string; store_id: string; ccrc_id: string; generation: string; arm: string };
  boundary: W6cT2Boundary; calls: Array<[number, number, string]>; window: W6cR;
}
interface W6cT2Cs { db: unknown; storeId: string; version: number; schema: unknown; close(): void }
interface W6cT2Api {
  COUNTER_UNMEASURED: readonly string[];
  COUNTER_MEASURES: Record<string, W6cR>;
  COMPLIANCE: W6cR; ECHO_HITS: W6cR; LAG: W6cR; CARD_SERVED: W6cR; CARD_ID_MISMATCH: W6cR;
  windowCtx(o: W6cR): W6cR;
  windowRow(o: W6cR): W6cR;
  stratify(rows: W6cR[], measures: W6cR): W6cR;
  boundaryLeafOf(cs: W6cT2Cs, uuid: string): W6cR;
  complianceAt(ctx: W6cR): W6cT2Value;
  echoAt(ctx: W6cR): W6cT2Value;
  lagAt(ctx: W6cR): W6cT2Value;
  cardAt(ctx: W6cR): W6cT2Value;
  foldCompliance(values: unknown[]): W6cR;
  foldEcho(values: unknown[]): W6cR;
  foldLag(values: unknown[]): W6cR;
  foldCardFor(verdict: string): (values: unknown[]) => W6cR;
}
const W6C_T2 = w6cCtrMod as unknown as W6cT2Api;
const W6C_T2_MODEL = 'claude-fixture-4';
const W6C_T2_NOW = 200_000;
const w6cT2Uid = (seed: number, n: number): string => `${seed.toString(16).padStart(8, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const W6C_T2_GEN = w6cT2Uid(0x626, 0);
const w6cT2Leaf = (n: number): string => `L${n.toString(16).padStart(20, '0')}`;
const w6cT2NodeId = (n: number): string => `N${n.toString(16).padStart(20, '0')}`;
/** A SessionStart context naming `leaf`, after a standing card, as the hook joins them with one space. */
const w6cT2Line = (leaf: string): string => `Graph: fixture card. ${w6cLib.cardLine({ leaf })}`;
/** A user row's stored body holding one tool_result; `isError` undefined leaves the key out. */
const w6cT2Result = (isError?: boolean): unknown[] =>
  [{ type: 'tool_result', tool_use_id: 'toolu_fixture', content: 'fixture output', ...(isError === undefined ? {} : { is_error: isError }) }];

interface W6cT2Row {
  uuid: string; type: string; provenance: string; ts: number | null; body?: unknown; model?: string | null;
  tombstone?: boolean; rawLen?: number; provVersion?: number; boundary?: boolean; summary?: boolean;
}
const w6cT2Op = (uuid: string, ts: number): W6cT2Row => ({ uuid, type: 'user', provenance: 'operator', ts, body: [{ type: 'text', text: 'fixture prompt' }] });
const w6cT2Asst = (uuid: string, ts: number): W6cT2Row => ({ uuid, type: 'assistant', provenance: 'model', ts, model: W6C_T2_MODEL, body: [{ type: 'text', text: 'fixture reply' }] });
const w6cT2Bnd = (uuid: string, ts: number): W6cT2Row => ({ uuid, type: 'system', provenance: 'harness', ts, boundary: true, body: 'fixture boundary' });
const w6cT2Sum = (uuid: string, ts: number): W6cT2Row => ({ uuid, type: 'user', provenance: 'summary', ts, summary: true, body: 'fixture summary' });
const w6cT2Echo = (uuid: string, ts: number | null, o: Partial<W6cT2Row> = {}): W6cT2Row =>
  ({ uuid, type: 'user', provenance: 'recall-echo', ts, body: w6cT2Result(), ...o });
const w6cT2Att = (uuid: string, ts: number, text: string, o: Partial<W6cT2Row> = {}): W6cT2Row =>
  ({ uuid, type: 'attachment', provenance: 'harness', ts, body: { type: 'hook_additional_context', hookName: 'SessionStart', content: [text] }, ...o });

interface W6cT2File { fileId: number; sourceKey?: string; status?: string; eofMs?: number | null; uuids: string[] }
interface W6cT2Transcript { pk: number; ccUuid: string; rows: W6cT2Row[]; files: W6cT2File[] }
interface W6cT2Plan {
  transcripts: W6cT2Transcript[];
  nodes: Array<{ id: string; boundary: string; status: string; createdMs: number; depth?: number }>;
  ticks?: Array<[number, number, number | null]>;
}
/** A store made by store.mjs's createStore under a fresh mkTmp HOME, planted in one transaction, and closed. One
 *  session (generation W6C_T2_GEN) holds one confirmed epoch per transcript. Each row is one entry with its own blob:
 *  brotli of its JSON body, `raw_len` its byte length unless `rawLen` says otherwise, or a tombstone (z NULL, pruned).
 *  A file's memberships are its `uuids` at lines 1, 2 and on; a boundary row gets the next `ord` of its transcript.
 *  `ticks` rows are [tick_id, ts_ms, lag_ms]. */
function w6cT2Plant(plan: W6cT2Plan): { home: string; dbFile: string } {
  const home = w6cMkTmp('ccrc-counters-w6c-t2-');
  w6cStore.createStore(home);
  const dbFile = w6cLib.historyPaths(home).dbFile as string;
  const db = w6cStore.openWriter(dbFile);
  try {
    db.exec('BEGIN');
    db.prepare("INSERT INTO sessions (session_pk, ccrc_id, generation, project, first_seen_ms) VALUES (1, 'fx-counters', ?, 'demo', 1)").run(W6C_T2_GEN);
    const ep = db.prepare("INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, confirmed_ms) VALUES (1, ?, ?, 'startup', 'hook', 1)");
    const tr = db.prepare("INSERT INTO transcripts (transcript_pk, cc_session_uuid, agent_id) VALUES (?, ?, '')");
    const file = db.prepare('INSERT INTO ingest_files (file_id, dev, ino, source_key, transcript_pk, status, eof_ms, parser_version) VALUES (?, 1, ?, ?, ?, ?, ?, 1)');
    const blob = db.prepare("INSERT INTO blobs (sha256, codec, z, raw_len, pruned_ms) VALUES (?, 'br5', ?, ?, ?)");
    const ent = db.prepare(`INSERT INTO entries (uuid, transcript_pk, type, model, provenance, prov_version, struct_rank_ns,
      struct_file_id, blob_id, ts_ms, is_compact_summary) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`);
    const mem = db.prepare('INSERT INTO memberships (file_id, entry_id, line) VALUES (?, ?, ?)');
    const bnd = db.prepare('INSERT INTO boundaries (entry_id, transcript_pk, ord) VALUES (?, ?, ?)');
    const node = db.prepare(`INSERT INTO nodes (node_id, session_pk, epoch_seq, transcript_pk, kind, depth, status,
      boundary_entry_id, parser_version, created_ms) VALUES (?, 1, 1, ?, ?, ?, ?, ?, 1, ?)`);
    const tick = db.prepare('INSERT INTO ticks (tick_id, ts_ms, lag_ms, bytes, files_behind, bytes_behind) VALUES (?, ?, ?, 0, 0, 0)');
    const idOf = new Map<string, { id: number; pk: number }>();
    plan.transcripts.forEach((t, i) => {
      ep.run(i + 1, t.ccUuid);
      tr.run(t.pk, t.ccUuid);
      for (const f of t.files) file.run(f.fileId, 9000 + f.fileId, f.sourceKey ?? '', t.pk, f.status ?? 'live', f.eofMs ?? null);
      let ord = 0;
      for (const r of t.rows) {
        const bytes = Buffer.from(JSON.stringify(r.body ?? null));
        const tomb = r.tombstone === true;
        const blobId = Number(blob.run(w6cHash('sha256').update(r.uuid).digest(), tomb ? null : w6cStore.brotli(bytes),
          r.rawLen ?? bytes.length, tomb ? 1 : null).lastInsertRowid);
        const id = Number(ent.run(r.uuid, t.pk, r.type, r.model ?? null, r.provenance, r.provVersion ?? w6cLib.PROV_VERSION,
          blobId, r.ts, r.summary === true ? 1 : 0).lastInsertRowid);
        idOf.set(r.uuid, { id, pk: t.pk });
        if (r.boundary === true) {
          ord += 1;
          bnd.run(id, t.pk, ord);
        }
      }
      for (const f of t.files) f.uuids.forEach((u, k) => { mem.run(f.fileId, idOf.get(u)!.id, k + 1); });
    });
    for (const n of plan.nodes) {
      const b = idOf.get(n.boundary)!;
      const depth = n.depth ?? 0;
      node.run(n.id, b.pk, depth === 0 ? 'native_leaf' : 'condensed', depth, n.status, b.id, n.createdMs);
    }
    for (const [id, ts, lag] of plan.ticks ?? []) tick.run(id, ts, lag);
    db.exec('COMMIT');
  } finally {
    w6cStore.closeWriter(db);
  }
  return { home, dbFile };
}
/** A read handle in Task 1's CounterStore shape: openReader, its user_version and SCHEMA_ADDED. */
function w6cT2Open(dbFile: string): W6cT2Cs {
  const db = w6cStore.openReader(dbFile);
  return { db, storeId: 'fixture-store', version: w6cStore.userVersion(db) as number, schema: w6cLib.SCHEMA_ADDED, close: () => db.close() };
}
function w6cT2With<T>(dbFile: string, fn: (cs: W6cT2Cs) => T): T {
  const cs = w6cT2Open(dbFile);
  try { return fn(cs); } finally { cs.close(); }
}
/** One copy in measure-history.py's shape (W2-D13), defaults filled. */
const w6cT2Copy = (o: Partial<W6cT2Copy> & { file_id: number; boundary_line: number }): W6cT2Copy => ({
  source_key: '', after_count: 1, summary_line: null, next_boundary_line: null, next_boundary_ts_ms: null, last_ts_ms: null,
  rows: [], models: [W6C_T2_MODEL], truncated: false, ...o,
});
const w6cT2Rep = (boundary_uuid: string, ts_ms: number, copies: W6cT2Copy[]): W6cT2Boundary => ({ boundary_uuid, ts_ms, copies });
/** One boundary of a family as Task 1's frame sees it: the family and its arm, the boundary report, the family's calls,
 *  and the gate's own windowOf over them. */
function w6cT2Part(boundary: W6cT2Boundary, o: { calls?: Array<[number, number, string]>; arm?: string } = {}): W6cT2Part {
  const calls = o.calls ?? [];
  return {
    family: { key: w6cGate.familyKey('fixture-store', 'fx-counters', W6C_T2_GEN) as string, store_id: 'fixture-store', ccrc_id: 'fx-counters', generation: W6C_T2_GEN, arm: o.arm ?? 'treatment' },
    boundary, calls, window: w6cGate.windowOf(boundary, calls) as W6cR,
  };
}
/** The WindowCtx Task 1's frame hands every measure of this boundary, at read instant `nowMs`. */
const w6cT2Ctx = (cs: W6cT2Cs, p: W6cT2Part, nowMs = W6C_T2_NOW): W6cR =>
  W6C_T2.windowCtx({ rs: cs, family: p.family, boundary: p.boundary, window: p.window, calls: p.calls, nowMs });
const W6C_T2_LEAF = {
  A1: w6cT2Leaf(0xa1), H1: w6cT2Leaf(0x91), H2: w6cT2Leaf(0x92), B: w6cT2Leaf(0xb1), C1: w6cT2Leaf(0xc1), D: w6cT2Leaf(0xd1),
  E: w6cT2Leaf(0xe1), F: w6cT2Leaf(0xf1), G: w6cT2Leaf(0x61), U: w6cT2Leaf(0x71), X: w6cT2Leaf(0xfff),
  EA: w6cT2Leaf(0xea), EB: w6cT2Leaf(0xeb), RT: w6cT2Leaf(0x77), NS: w6cT2Leaf(0x57),
};

/** Store 1: compliance, echo hits and lag. Transcript A (file 1) holds two boundaries: A1 (line 3, ts 10000), whose
 *  window is [10000, 30000) over three turns, and A2 (line 18, ts 30000). The rows between them are one of each echo
 *  shape the counter tells apart. Transcript H (file 2) holds H1, H2 and H3: H1's and H2's leaves carry `degraded` and a
 *  status outside PARSE_STATUS, and two depth-0 leaves name H3. A1 also has a depth-1 node naming it, which the depth-0
 *  rule must leave out. */
function w6cT2EchoStore() {
  const uA = (n: number): string => w6cT2Uid(0xa, n);
  const uH = (n: number): string => w6cT2Uid(0x9, n);
  const A: W6cT2Row[] = [
    w6cT2Op(uA(1), 1000),                                                        // 1
    w6cT2Asst(uA(2), 2000),                                                      // 2
    w6cT2Bnd(uA(3), 10000),                                                      // 3  A1
    w6cT2Sum(uA(4), 10001),                                                      // 4
    w6cT2Att(uA(5), 10002, w6cT2Line(W6C_T2_LEAF.A1)),                           // 5  A1's card line
    w6cT2Asst(uA(6), 10100),                                                     // 6  turn 1
    w6cT2Echo(uA(7), 10200),                                                     // 7  a hit (is_error absent)
    w6cT2Asst(uA(8), 10300),                                                     // 8  turn 2
    w6cT2Echo(uA(9), 10400, { body: w6cT2Result(true) }),                        // 9  an error
    w6cT2Asst(uA(10), 10500),                                                    // 10 turn 3
    { ...w6cT2Echo(uA(11), 10600), provenance: 'tool' },                         // 11 a plain tool result: no echo
    w6cT2Echo(uA(12), null),                                                     // 12 untimed
    w6cT2Echo(uA(13), 10800, { tombstone: true }),                               // 13 unreadable: tombstone
    w6cT2Echo(uA(14), 10900, { provVersion: 0 }),                                // 14 another provenance version
    w6cT2Echo(uA(15), 9000),                                                     // 15 stamped before the window opens
    w6cT2Echo(uA(16), 11000, { body: [{ type: 'text', text: 'fixture' }] }),     // 16 an echo row with no tool_result
    { ...w6cT2Echo(uA(19), 11100), provenance: 'tool', provVersion: 0 },         // 17 a tool row under another version: stale
    w6cT2Bnd(uA(17), 30000),                                                     // 18 A2, the next main boundary
    w6cT2Echo(uA(18), 12000),                                                    // 19 past A2, stamped inside A1's window
  ];
  const H: W6cT2Row[] = [w6cT2Op(uH(1), 500), w6cT2Bnd(uH(2), 600), w6cT2Sum(uH(3), 601), w6cT2Bnd(uH(4), 700), w6cT2Sum(uH(5), 701),
    w6cT2Bnd(uH(6), 800), w6cT2Sum(uH(7), 801)];
  const st = w6cT2Plant({
    transcripts: [
      { pk: 1, ccUuid: w6cT2Uid(0xcc, 1), rows: A, files: [{ fileId: 1, uuids: A.map((r) => r.uuid) }] },
      { pk: 2, ccUuid: w6cT2Uid(0xcc, 2), rows: H, files: [{ fileId: 2, uuids: H.map((r) => r.uuid) }] },
    ],
    nodes: [
      { id: W6C_T2_LEAF.A1, boundary: uA(3), status: 'not-requested', createdMs: 10500 },
      { id: w6cT2NodeId(0xa1), boundary: uA(3), status: 'ok', createdMs: 10600, depth: 1 },
      { id: W6C_T2_LEAF.H1, boundary: uH(2), status: 'degraded', createdMs: 650 },
      { id: W6C_T2_LEAF.H2, boundary: uH(4), status: 'fixture-status', createdMs: 750 },
      { id: w6cT2Leaf(0x93), boundary: uH(6), status: 'ok', createdMs: 850 },     // two depth-0 leaves name H3
      { id: w6cT2Leaf(0x94), boundary: uH(6), status: 'ok', createdMs: 851 },
    ],
    // [tick_id, ts_ms, lag_ms]: tick_id order is NOT ts order (ids 2 and 5), and one tick has no measured lag.
    ticks: [[1, 5000, 700], [5, 9500, 1200], [3, 9800, null], [2, 10000, 50], [4, 10001, 9]],
  });
  const M = W6C_T2_MODEL;
  const a1Copy = w6cT2Copy({
    file_id: 1, boundary_line: 3, after_count: 16, summary_line: 4, next_boundary_line: 18, next_boundary_ts_ms: 30000, last_ts_ms: 12000,
    rows: [[6, 10100, null, null, uA(6), M], [8, 10300, null, null, uA(8), M], [10, 10500, null, null, uA(10), M]],
  });
  const calls: Array<[number, number, string]> = [[10150, 0, 'grep'], [10350, 0, 'describe'], [10450, 8, 'grep'], [31000, 0, 'grep']];
  return {
    ...st, uA, uH,
    fA1: w6cT2Part(w6cT2Rep(uA(3), 10000, [a1Copy]), { calls }),
    fA1Cut: w6cT2Part(w6cT2Rep(uA(3), 10000, [{ ...a1Copy, truncated: true }]), { calls }),
    fA1Moved: w6cT2Part(w6cT2Rep(uA(3), 10000, [{ ...a1Copy, boundary_line: 2 }]), { calls }),
    fA2: w6cT2Part(w6cT2Rep(uA(17), 30000, [w6cT2Copy({ file_id: 1, boundary_line: 18, last_ts_ms: 12000 })]), { calls, arm: 'control' }),
    fH1: w6cT2Part(w6cT2Rep(uH(2), 600, [w6cT2Copy({ file_id: 2, boundary_line: 2, after_count: 3, summary_line: 3, next_boundary_line: 4, next_boundary_ts_ms: 700, last_ts_ms: 701 })])),
    fH2: w6cT2Part(w6cT2Rep(uH(4), 700, [w6cT2Copy({ file_id: 2, boundary_line: 4, after_count: 3, summary_line: 5, next_boundary_line: 6, next_boundary_ts_ms: 800, last_ts_ms: 801 })])),
    fH3: w6cT2Part(w6cT2Rep(uH(6), 800, [w6cT2Copy({ file_id: 2, boundary_line: 6, summary_line: 7, last_ts_ms: 801 })])),
    fGhost: w6cT2Part(w6cT2Rep(w6cT2Uid(0x99, 1), 5000, [w6cT2Copy({ file_id: 1, boundary_line: 99 })]), { arm: 'control' }),
    fGhostMeasured: w6cT2Part(w6cT2Rep(w6cT2Uid(0x99, 2), 11000, [w6cT2Copy({ file_id: 1, boundary_line: 99, last_ts_ms: 11000 })])),
    at: (ts: number): W6cT2Part => w6cT2Part(w6cT2Rep(w6cT2Uid(0x98, ts), ts, [w6cT2Copy({ file_id: 1, boundary_line: 99 })])),
  };
}

/** Store 2: one card verdict each, every delivery window closed. B names only another leaf (mismatch). C1's window
 *  meets C2's boundary before C1's line, which sits after C2 (none). D has two copies: the live one (file 3, the holding
 *  copy) names D, the retired one (file 4, more rows after the boundary, so the WINDOW copy) names another leaf
 *  (served). E's only attachment is past CARD_ATTACHMENT_MAX_BYTES by its stored raw_len (none, one unread). F's line is
 *  the 41st row after its boundary (none). C2 has no leaf. EA, EB and RT (D-6563) each have a live-looking window that is
 *  still open by rows and by the leaf's age, closed by something else: EA's file ends a grace after the boundary's own
 *  stamp (none); EB's boundary row has no stamp, so the store's stamp is the newest stamped row before it, and the report
 *  names a later time that would leave the window open (none); RT's copy has source_key '' but its file is retired (none).
 *  NS (D-6563's null arm) has no stamped row at or before its boundary line (the boundary is line 1 and unstamped), so the
 *  store's stamp is null and the file's end closes nothing, though the report's time would close it: the window waits
 *  (card-wait). Its leaf is the LAST node, so card.mjs's wait stops its cursor with no leaf after it. */
function w6cT2CardStore() {
  const u = (seed: number) => (n: number): string => w6cT2Uid(seed, n);
  const [uB, uC, uD, uE, uF] = [u(0xb), u(0xc), u(0xd), u(0xe), u(0xf)];
  const B = [w6cT2Op(uB(1), 39000), w6cT2Asst(uB(2), 39500), w6cT2Bnd(uB(3), 40000), w6cT2Sum(uB(4), 40001),
    w6cT2Att(uB(5), 40002, w6cT2Line(W6C_T2_LEAF.X)), w6cT2Asst(uB(6), 40100)];
  const C = [w6cT2Op(uC(1), 49000), w6cT2Asst(uC(2), 49500), w6cT2Bnd(uC(3), 50000), w6cT2Sum(uC(4), 50001), w6cT2Asst(uC(5), 50100),
    w6cT2Bnd(uC(6), 60000), w6cT2Sum(uC(7), 60001), w6cT2Att(uC(8), 60002, w6cT2Line(W6C_T2_LEAF.C1))];
  const D = [w6cT2Op(uD(1), 69000), w6cT2Asst(uD(2), 69500), w6cT2Bnd(uD(3), 70000), w6cT2Sum(uD(4), 70001),
    w6cT2Att(uD(5), 70002, w6cT2Line(W6C_T2_LEAF.D)), w6cT2Att(uD(6), 70003, w6cT2Line(W6C_T2_LEAF.X)),
    w6cT2Asst(uD(7), 70100), w6cT2Asst(uD(8), 70200), w6cT2Asst(uD(9), 70300)];
  const E = [w6cT2Op(uE(1), 79000), w6cT2Asst(uE(2), 79500), w6cT2Bnd(uE(3), 80000), w6cT2Sum(uE(4), 80001),
    w6cT2Att(uE(5), 80002, w6cT2Line(W6C_T2_LEAF.E), { rawLen: w6cLib.CARD_ATTACHMENT_MAX_BYTES + 1 }), w6cT2Bnd(uE(6), 90000)];
  const F = [w6cT2Op(uF(1), 99000), w6cT2Asst(uF(2), 99500), w6cT2Bnd(uF(3), 100000), w6cT2Sum(uF(4), 100001),
    ...Array.from({ length: 39 }, (_, i) => w6cT2Asst(uF(5 + i), 100100 + i)),          // lines 5 to 43
    w6cT2Att(uF(44), 101000, w6cT2Line(W6C_T2_LEAF.F))];                                // line 44: the 41st row after line 3
  const [uEA, uEB, uRT] = [u(0x11), u(0x12), u(0x13)];
  const EA = [w6cT2Op(uEA(1), 109000), w6cT2Asst(uEA(2), 109500), w6cT2Bnd(uEA(3), 110000), w6cT2Sum(uEA(4), 110001), w6cT2Asst(uEA(5), 110100)];
  const EB = [w6cT2Op(uEB(1), 119000), w6cT2Asst(uEB(2), 119500), { ...w6cT2Bnd(uEB(3), 0), ts: null }, w6cT2Sum(uEB(4), 120001), w6cT2Asst(uEB(5), 120100)];
  const RT = [w6cT2Op(uRT(1), 129000), w6cT2Asst(uRT(2), 129500), w6cT2Bnd(uRT(3), 130000), w6cT2Sum(uRT(4), 130001), w6cT2Asst(uRT(5), 130100)];
  const uNS = u(0x14);
  const NS = [{ ...w6cT2Bnd(uNS(1), 0), ts: null }, w6cT2Sum(uNS(2), 140001), w6cT2Asst(uNS(3), 140100)];
  const all = (rows: W6cT2Row[]): string[] => rows.map((r) => r.uuid);
  const st = w6cT2Plant({
    transcripts: [
      { pk: 1, ccUuid: w6cT2Uid(0xcd, 1), rows: B, files: [{ fileId: 1, uuids: all(B) }] },
      { pk: 2, ccUuid: w6cT2Uid(0xcd, 2), rows: C, files: [{ fileId: 2, uuids: all(C) }] },
      { pk: 3, ccUuid: w6cT2Uid(0xcd, 3), rows: D, files: [
        { fileId: 3, uuids: [1, 2, 3, 4, 5, 7].map(uD) },
        { fileId: 4, sourceKey: 'fixture-retired', status: 'retired', uuids: [1, 2, 3, 4, 6, 7, 8, 9].map(uD) },
      ] },
      { pk: 4, ccUuid: w6cT2Uid(0xcd, 4), rows: E, files: [{ fileId: 5, uuids: all(E) }] },
      { pk: 5, ccUuid: w6cT2Uid(0xcd, 5), rows: F, files: [{ fileId: 6, uuids: all(F) }] },
      // EA: the file ends RAW_LEAF_GRACE_MS after the boundary's stamp. EB: it ends that long after the stamp of the row
      // before the (unstamped) boundary. RT: the only copy has source_key '' and a retired file.
      { pk: 6, ccUuid: w6cT2Uid(0xcd, 6), rows: EA, files: [{ fileId: 7, eofMs: 110000 + w6cLib.RAW_LEAF_GRACE_MS, uuids: all(EA) }] },
      { pk: 7, ccUuid: w6cT2Uid(0xcd, 7), rows: EB, files: [{ fileId: 8, eofMs: 119500 + w6cLib.RAW_LEAF_GRACE_MS, uuids: all(EB) }] },
      { pk: 8, ccUuid: w6cT2Uid(0xcd, 8), rows: RT, files: [{ fileId: 9, status: 'retired', uuids: all(RT) }] },
      // NS: the boundary is line 1 and unstamped, so no stamped row is at or before it; the file ends a grace after the
      // REPORT's time for it (140000), which would close the window if that time were read.
      { pk: 9, ccUuid: w6cT2Uid(0xcd, 9), rows: NS, files: [{ fileId: 10, eofMs: 140000 + w6cLib.RAW_LEAF_GRACE_MS, uuids: all(NS) }] },
    ],
    nodes: [
      { id: W6C_T2_LEAF.B, boundary: uB(3), status: 'not-requested', createdMs: 41000 },
      { id: W6C_T2_LEAF.C1, boundary: uC(3), status: 'not-requested', createdMs: 51000 },
      { id: W6C_T2_LEAF.D, boundary: uD(3), status: 'not-requested', createdMs: 71000 },
      { id: W6C_T2_LEAF.E, boundary: uE(3), status: 'not-requested', createdMs: 81000 },
      { id: W6C_T2_LEAF.F, boundary: uF(3), status: 'not-requested', createdMs: 101000 },
      { id: W6C_T2_LEAF.EA, boundary: uEA(3), status: 'not-requested', createdMs: W6C_T2_NOW - 1000 },
      { id: W6C_T2_LEAF.EB, boundary: uEB(3), status: 'not-requested', createdMs: W6C_T2_NOW - 1000 },
      { id: W6C_T2_LEAF.RT, boundary: uRT(3), status: 'not-requested', createdMs: W6C_T2_NOW - 1000 },
      { id: W6C_T2_LEAF.NS, boundary: uNS(1), status: 'not-requested', createdMs: W6C_T2_NOW - 1000 },   // last: a wait stops card.mjs's cursor here
    ],
  });
  const M = W6C_T2_MODEL;
  return {
    ...st,
    fEA: w6cT2Part(w6cT2Rep(uEA(3), 110000, [w6cT2Copy({ file_id: 7, boundary_line: 3, after_count: 3, summary_line: 4, last_ts_ms: 110100 })])),
    // The report names 120000 for EB's boundary: with that time the file's end is short of a grace, which the old reading took.
    fEB: w6cT2Part(w6cT2Rep(uEB(3), 120000, [w6cT2Copy({ file_id: 8, boundary_line: 3, after_count: 3, summary_line: 4, last_ts_ms: 120100 })])),
    fRT: w6cT2Part(w6cT2Rep(uRT(3), 130000, [w6cT2Copy({ file_id: 9, boundary_line: 3, after_count: 3, summary_line: 4, last_ts_ms: 130100 })])),
    fNS: w6cT2Part(w6cT2Rep(uNS(1), 140000, [w6cT2Copy({ file_id: 10, boundary_line: 1, after_count: 2, summary_line: 2, last_ts_ms: 140100 })])),
    fB: w6cT2Part(w6cT2Rep(uB(3), 40000, [w6cT2Copy({ file_id: 1, boundary_line: 3, after_count: 3, summary_line: 4, last_ts_ms: 40100, rows: [[6, 40100, null, null, uB(6), M]] })])),
    fC1: w6cT2Part(w6cT2Rep(uC(3), 50000, [w6cT2Copy({ file_id: 2, boundary_line: 3, after_count: 5, summary_line: 4, next_boundary_line: 6, next_boundary_ts_ms: 60000, last_ts_ms: 60002, rows: [[5, 50100, null, null, uC(5), M]] })])),
    fC2: w6cT2Part(w6cT2Rep(uC(6), 60000, [w6cT2Copy({ file_id: 2, boundary_line: 6, after_count: 2, summary_line: 7, last_ts_ms: 60002 })])),
    fD: w6cT2Part(w6cT2Rep(uD(3), 70000, [
      w6cT2Copy({ file_id: 3, boundary_line: 3, after_count: 3, summary_line: 4, last_ts_ms: 70100, rows: [[6, 70100, null, null, uD(7), M]] }),
      w6cT2Copy({ file_id: 4, source_key: 'fixture-retired', boundary_line: 3, after_count: 5, summary_line: 4, last_ts_ms: 70300,
        rows: [[6, 70100, null, null, uD(7), M], [7, 70200, null, null, uD(8), M], [8, 70300, null, null, uD(9), M]] }),
    ])),
    fE: w6cT2Part(w6cT2Rep(uE(3), 80000, [w6cT2Copy({ file_id: 5, boundary_line: 3, after_count: 3, summary_line: 4, next_boundary_line: 6, next_boundary_ts_ms: 90000, last_ts_ms: 90000 })])),
    fF: w6cT2Part(w6cT2Rep(uF(3), 100000, [w6cT2Copy({ file_id: 6, boundary_line: 3, after_count: 41, summary_line: 4, last_ts_ms: 101000 })])),
  };
}

/** Store 3: G's delivery window is still open at W6C_T2_NOW (live, two rows, no next boundary, no end-of-file, its
 *  leaf 1 s old); U's boundary row is a member of no file. */
function w6cT2WaitStore() {
  const uG = (n: number): string => w6cT2Uid(0x6, n);
  const uU = (n: number): string => w6cT2Uid(0x7, n);
  const G = [w6cT2Op(uG(1), 149000), w6cT2Asst(uG(2), 149500), w6cT2Bnd(uG(3), 150000), w6cT2Sum(uG(4), 150001), w6cT2Asst(uG(5), 150100)];
  const U = [w6cT2Op(uU(1), 159000), w6cT2Bnd(uU(2), 160000)];
  const st = w6cT2Plant({
    transcripts: [
      { pk: 1, ccUuid: w6cT2Uid(0xce, 1), rows: G, files: [{ fileId: 1, uuids: G.map((r) => r.uuid) }] },
      { pk: 2, ccUuid: w6cT2Uid(0xce, 2), rows: U, files: [{ fileId: 2, uuids: [uU(1)] }] },
    ],
    nodes: [
      { id: W6C_T2_LEAF.G, boundary: uG(3), status: 'not-requested', createdMs: W6C_T2_NOW - 1000 },
      { id: W6C_T2_LEAF.U, boundary: uU(2), status: 'not-requested', createdMs: 161000 },
    ],
  });
  return {
    ...st,
    fG: w6cT2Part(w6cT2Rep(uG(3), 150000, [w6cT2Copy({ file_id: 1, boundary_line: 3, after_count: 2, summary_line: 4, last_ts_ms: 150100 })])),
    fU: w6cT2Part(w6cT2Rep(uU(2), 160000, [w6cT2Copy({ file_id: 2, boundary_line: 2 })])),
  };
}

w6cDescribe('W2-6 Task 2: the five spec counters, their folds and their place (W2-D87, W2-D15)', () => {
  w6cIt('COUNTER_UNMEASURED gains this task\'s seven words, together, in place; COUNTER_MEASURES\' first five entries are this task\'s specs (U7)', () => {
    const L = [...W6C_T2.COUNTER_UNMEASURED];
    const SEVEN = ['boundary-absent', 'boundary-moved', 'leaf-absent', 'leaf-ambiguous', 'boundary-uncopied', 'no-measured-tick', 'card-wait'];
    const i = L.indexOf(SEVEN[0]!);
    w6cExpect(L.slice(i, i + SEVEN.length)).toEqual(SEVEN);
    w6cExpect(L[0]).toBe('window-unmeasured');
    const specs = [W6C_T2.COMPLIANCE, W6C_T2.ECHO_HITS, W6C_T2.LAG, W6C_T2.CARD_SERVED, W6C_T2.CARD_ID_MISMATCH];
    specs.forEach((s, k) => {
      w6cExpect(W6C_T2.COUNTER_MEASURES[W6C_NAMES[k]!], W6C_NAMES[k]).toBe(s);
      w6cExpect(Object.isFrozen(s), W6C_NAMES[k]).toBe(true);
    });
    w6cExpect(W6C_T2.CARD_SERVED.measure, 'one verdict, projected twice').toBe(W6C_T2.CARD_ID_MISMATCH.measure);
  });

  w6cIt('foldCompliance: every PARSE_STATUS word counted, a status outside it apart, ok plus degraded over every measured window', () => {
    const t = W6C_T2.foldCompliance(['not-requested', 'ok', 'degraded', 'invalid', 'fixture-status']);
    w6cExpect(t).toEqual({
      status: { ok: 1, degraded: 1, invalid: 1, absent: 0, 'not-requested': 1, 'parse-failed': 0 },
      out_of_vocabulary: 1, ok_degraded: { num: 2, den: 5 },
    });
    w6cExpect(Object.keys(t.status as object), 'the distribution is keyed by lib\'s PARSE_STATUS, all of it').toEqual([...w6cLib.PARSE_STATUS]);
  });

  w6cIt('every fold refuses nothing: the frame never folds an empty stratum (its summary is null), so no share is 0/0 and no sum is a measured 0', () => {
    const folds: Array<[string, (v: unknown[]) => unknown]> = [['compliance', W6C_T2.foldCompliance], ['echo', W6C_T2.foldEcho], ['lag', W6C_T2.foldLag],
      ['served', W6C_T2.foldCardFor('served')], ['mismatch', W6C_T2.foldCardFor('mismatch')]];
    for (const [label, fold] of folds) w6cExpect(() => fold([]), label).toThrow(/a fold over no measured window is a defect/);
  });

  w6cIt('foldEcho: sums over measured windows, unreadable merged word by word, gap = recall_calls - hits', () => {
    w6cExpect(W6C_T2.foldEcho([
      { hits: 1, errors: 1, untimed: 1, unreadable: { tombstone: 1 }, prov_stale: 0, recall_calls: 3, gap: 2 },
      { hits: 2, errors: 0, untimed: 0, unreadable: { tombstone: 1, 'no-tool-result': 2 }, prov_stale: 1, recall_calls: 1, gap: -1 },
    ])).toEqual({ hits: 3, errors: 1, untimed: 1, unreadable: { tombstone: 2, 'no-tool-result': 2 }, prov_stale: 1, recall_calls: 4, gap: 1 });
  });

  w6cIt('foldEcho: an unreadable key is only ever summed, as a number, whatever its name: __proto__ and constructor are kept, never dropped or turned into a string (review 965 F1)', () => {
    const one = (): W6cR => ({ hits: 0, errors: 0, untimed: 0, unreadable: JSON.parse('{"tombstone":1,"__proto__":3,"constructor":3}'), prov_stale: 0, recall_calls: 0, gap: 0 });
    const t = W6C_T2.foldEcho([one(), one()]).unreadable as Record<string, unknown>;
    w6cExpect(Object.entries(t).sort(), 'CONTROL: tombstone sums as it did, and the two odd keys with it').toEqual([['__proto__', 6], ['constructor', 6], ['tombstone', 2]]);
    w6cExpect(w6cLib.canonicalJson(t), 'the keys reach the report').toBe('{"__proto__":6,"constructor":6,"tombstone":2}');
  });

  w6cIt('foldLag: the measured lags, ascending', () => {
    w6cExpect(W6C_T2.foldLag([{ lag_ms: 50, tick_ts_ms: 10 }, { lag_ms: 7, tick_ts_ms: 9 }])).toEqual({ lag_ms: [7, 50] });
  });

  w6cIt('foldCardFor: served and mismatch each count their own verdict over one shared distribution; any other word throws', () => {
    const vs = [{ verdict: 'served', attachments_unread: 0 }, { verdict: 'mismatch', attachments_unread: 0 },
      { verdict: 'mismatch', attachments_unread: 0 }, { verdict: 'none', attachments_unread: 1 }];
    const common = { verdicts: { served: 1, mismatch: 2, none: 1 }, attachments_unread: 1 };
    w6cExpect(W6C_T2.foldCardFor('served')(vs)).toEqual({ ...common, n: 1 });
    w6cExpect(W6C_T2.foldCardFor('mismatch')(vs)).toEqual({ ...common, n: 2 });
    w6cExpect(() => W6C_T2.foldCardFor('none')).toThrow(TypeError);
    w6cExpect(() => W6C_T2.foldCardFor('served')([{ verdict: 'wait', attachments_unread: 0 }]), 'a wait is unmeasured, never folded').toThrow(TypeError);
  });

  w6cIt('the card verdict is lib\'s, the window rule is the gate\'s, and the counters table is never read (module scan; CONTROL: each pattern sees a planted line)', () => {
    const callOf = (name: string): RegExp => new RegExp(`\\b${name}\\(`);
    const declOf = (name: string): RegExp => new RegExp(`\\bfunction\\s+${name}\\b|\\b(?:const|let|var)\\s+${name}\\b`);
    w6cExpect(callOf('cardIdsIn').test('    ids.push(...cardIdsIn(k.primary));'), 'CONTROL').toBe(true);
    w6cExpect(declOf('decideCardDelivery').test('function decideCardDelivery({ ids }) {'), 'CONTROL').toBe(true);
    w6cExpect(/\bend_inclusive\s*\?/.test('const inside = w.end_inclusive ? ts <= e : ts < e;'), 'CONTROL').toBe(true);
    w6cExpect(/\bFROM\s+counters\b/i.test("db.prepare('SELECT n FROM counters WHERE name = ?')"), 'CONTROL').toBe(true);
    const code = w6cCode(W6C_SRC);
    for (const f of ['decideCardDelivery', 'cardIdsIn', 'cardWindowComplete']) {
      w6cExpect(code.filter((l) => callOf(f).test(l)), `${f}: called once`).toHaveLength(1);
      w6cExpect(code.filter((l) => declOf(f).test(l)), `${f}: never declared here`).toEqual([]);
    }
    w6cExpect(code.filter((l) => /\bend_inclusive\s*\?/.test(l)), 'the inclusion rule is spelled once, in the gate (W2-D14)').toEqual([]);
    w6cExpect(code.filter((l) => /\bFROM\s+counters\b/i.test(l)), 'the node-wide counters table is never read (W2-D87)').toEqual([]);
    w6cExpect(code.filter((l) => l.includes(w6cLib.CARD_PREFIX)), 'no card line text is spelled here').toEqual([]);
  });
});

w6cDescribe('W2-6 Task 2: the five spec counters over fixture stores (W2-D87, W2-D86, U9, U10)', () => {
  w6cIt('compliance: the depth-0 leaf\'s status, verbatim; no boundary, no leaf and two leaves are their own words (CONTROL: a depth-1 node names A1 too)', () => {
    const st = w6cT2EchoStore();
    w6cT2With(st.dbFile, (cs) => {
      w6cExpect(W6C_T2.boundaryLeafOf(cs, st.uA(3))).toMatchObject({ state: 'leaf', transcript_pk: 1, node_id: W6C_T2_LEAF.A1, status: 'not-requested', created_ms: 10500 });
      const c = (p: W6cT2Part): W6cT2Value => W6C_T2.complianceAt(w6cT2Ctx(cs, p));
      w6cExpect(c(st.fA1)).toEqual({ state: 'measured', value: 'not-requested' });
      w6cExpect(c(st.fH1)).toEqual({ state: 'measured', value: 'degraded' });
      w6cExpect(c(st.fH2), 'outside PARSE_STATUS: reported as stored, never folded').toEqual({ state: 'measured', value: 'fixture-status' });
      w6cExpect(c(st.fA2)).toEqual({ state: 'unmeasured', why: 'leaf-absent' });
      w6cExpect(c(st.fGhost)).toEqual({ state: 'unmeasured', why: 'boundary-absent' });
      w6cExpect(c(st.fH3), 'two depth-0 leaves name H3').toEqual({ state: 'unmeasured', why: 'leaf-ambiguous' });
      w6cExpect(W6C_T2.cardAt(w6cT2Ctx(cs, st.fH3)), 'the card reads the same leaf rule').toEqual({ state: 'unmeasured', why: 'leaf-ambiguous' });
      const nodes = (cs.db as { prepare(s: string): { all(...a: unknown[]): unknown[] } })
        .prepare('SELECT depth FROM nodes n JOIN entries e ON e.entry_id = n.boundary_entry_id WHERE e.uuid = ? ORDER BY depth').all(st.uA(3));
      w6cExpect(nodes, 'CONTROL: two nodes name A1, at depth 0 and depth 1').toEqual([{ depth: 0 }, { depth: 1 }]);
    });
  });

  w6cIt('lag: the newest tick at or before the boundary with a measured lag, by ts_ms then tick_id; none is no-measured-tick', () => {
    const st = w6cT2EchoStore();
    w6cT2With(st.dbFile, (cs) => {
      const l = (p: W6cT2Part): W6cT2Value => W6C_T2.lagAt(w6cT2Ctx(cs, p));
      w6cExpect(l(st.fA1), 'the tick AT the boundary\'s ts counts').toEqual({ state: 'measured', value: { lag_ms: 50, tick_ts_ms: 10000 } });
      w6cExpect(l(st.at(9900)), 'the null-lag tick at 9800 is passed over').toEqual({ state: 'measured', value: { lag_ms: 1200, tick_ts_ms: 9500 } });
      w6cExpect(l(st.fA2)).toEqual({ state: 'measured', value: { lag_ms: 9, tick_ts_ms: 10001 } });
      w6cExpect(l(st.at(4000))).toEqual({ state: 'unmeasured', why: 'no-measured-tick' });
    });
  });

  w6cIt('echo hits: by stored provenance and the first tool_result, inside the window by the gate\'s rule, before the next boundary; every other shape counted apart (U9, U10)', () => {
    const st = w6cT2EchoStore();
    w6cExpect(st.fA1.window, 'CONTROL: A1\'s window is measured, [10000, 30000) exclusive, with three of the four calls')
      .toMatchObject({ state: 'measured', start_ms: 10000, end_ms: 30000, end_inclusive: false, calls: 3, producer: 'anthropic' });
    w6cT2With(st.dbFile, (cs) => {
      w6cExpect(W6C_T2.echoAt(w6cT2Ctx(cs, st.fA1))).toEqual({ state: 'measured', value: {
        hits: 1, errors: 1, untimed: 1, unreadable: { tombstone: 1, 'no-tool-result': 1 }, prov_stale: 2, recall_calls: 3, gap: 2,
      } });
    });
  });

  w6cIt('echo hits: an unmeasured window is window-unmeasured, a boundary the store does not hold is boundary-absent, and one it holds at another line is boundary-moved, never 0 hits (CONTROLs: the row cap cut; a measured window)', () => {
    const st = w6cT2EchoStore();
    w6cExpect([st.fA1Cut.window.state, st.fGhostMeasured.window.state], 'CONTROL').toEqual(['unmeasured', 'measured']);
    w6cT2With(st.dbFile, (cs) => {
      w6cExpect(W6C_T2.echoAt(w6cT2Ctx(cs, st.fA1Cut))).toEqual({ state: 'unmeasured', why: 'window-unmeasured' });
      w6cExpect(W6C_T2.complianceAt(w6cT2Ctx(cs, st.fA1Cut)), 'compliance needs no window: still measured (U5)').toEqual({ state: 'measured', value: 'not-requested' });
      w6cExpect(W6C_T2.echoAt(w6cT2Ctx(cs, st.fGhostMeasured))).toEqual({ state: 'unmeasured', why: 'boundary-absent' });
      w6cExpect(W6C_T2.echoAt(w6cT2Ctx(cs, st.fA1Moved)), 'the store holds A1 at line 3, and the measure reported line 2').toEqual({ state: 'unmeasured', why: 'boundary-moved' });
    });
  });

  w6cIt('card: served, mismatch and none by lib\'s decideCardDelivery; the holding copy, the next-boundary stop, the 40-row cap and the size bound each decide one case', () => {
    const st = w6cT2CardStore();
    w6cExpect((w6cGate.windowCopyOf(st.fD.boundary.copies) as W6cR).file_id, 'CONTROL: D\'s WINDOW copy is the retired file 4').toBe(4);
    w6cExpect((w6cGate.producerCopyOf(st.fD.boundary.copies) as W6cR).file_id, 'CONTROL: D\'s holding copy is the live file 3').toBe(3);
    w6cT2With(st.dbFile, (cs) => {
      const card = (p: W6cT2Part): W6cT2Value => W6C_T2.cardAt(w6cT2Ctx(cs, p));
      const verdict = (v: string, unread = 0): W6cT2Value => ({ state: 'measured', value: { verdict: v, attachments_unread: unread } });
      w6cExpect(card(st.fB), 'B names only another leaf').toEqual(verdict('mismatch'));
      w6cExpect(card(st.fC1), 'C1\'s line sits past C2\'s boundary').toEqual(verdict('none'));
      w6cExpect(card(st.fC2)).toEqual({ state: 'unmeasured', why: 'leaf-absent' });
      w6cExpect(card(st.fD), 'the holding copy, not the window copy').toEqual(verdict('served'));
      w6cExpect(card(st.fE), 'skipped unread past CARD_ATTACHMENT_MAX_BYTES, as card.mjs skips it').toEqual(verdict('none', 1));
      w6cExpect(card(st.fF), 'the line is the 41st row after the boundary').toEqual(verdict('none'));
      w6cExpect(card(st.fEA), 'a live window short of rows and of age, closed by the file ending a grace after the boundary\'s stamp').toEqual(verdict('none'));
      w6cExpect(card(st.fEB), 'the boundary row has no stamp: the store\'s stamp is the row before it, not the report\'s time (D-6563)').toEqual(verdict('none'));
      w6cExpect(card(st.fRT), 'source_key is empty but the file is retired, so the copy is not live and the window is closed').toEqual(verdict('none'));
      w6cExpect(card(st.fNS), 'no stamped row at or before the boundary: the store\'s stamp is null, so the file\'s end closes nothing and the window waits, though the report\'s time would close it (D-6563)')
        .toEqual({ state: 'unmeasured', why: 'card-wait' });
    });
  });

  w6cIt('card parity CONTROL (D-6562): card.mjs\'s own measureCardDelivery, over the same store, agrees with the counter on its aggregate counts only, which is all it exposes (measured 8, served 1, mismatch 1, waiting 1); each leaf\'s own verdict is pinned by the card case', () => {
    const st = w6cT2CardStore();
    const ours = w6cT2With(st.dbFile, (cs) => [st.fB, st.fC1, st.fD, st.fE, st.fF, st.fEA, st.fEB, st.fRT, st.fNS].map((p) => W6C_T2.cardAt(w6cT2Ctx(cs, p))));
    const w = w6cStore.openWriter(st.dbFile);
    try {
      w6cStore.withTx(w, 'NORMAL', () => { w6cStore.setStep(w, 'card-measure', 1, '0', null); });
      const theirs = (w6cCardMod as unknown as W6cR).measureCardDelivery(w, { nowMs: W6C_T2_NOW, budgetLeft: () => true }, { bytes: 0 });
      w6cExpect(theirs).toEqual({ measured: 8, served: 1, mismatch: 1, waiting: 1 });
    } finally {
      w6cStore.closeWriter(w);
    }
    w6cExpect(ours.slice(0, 8).every((v) => v.state === 'measured')).toBe(true);
    w6cExpect(ours[8], 'NS waits in both: card.mjs counts it waiting and stops, the counter answers card-wait').toEqual({ state: 'unmeasured', why: 'card-wait' });
    w6cExpect(ours.filter((v) => v.value?.verdict === 'served')).toHaveLength(1);
    w6cExpect(ours.filter((v) => v.value?.verdict === 'mismatch')).toHaveLength(1);
  });

  w6cIt('card: a window still open at the read instant is card-wait, never none; a boundary no copy holds is boundary-uncopied (CONTROL: the same G past CARD_MEASURE_MAX_WAIT_MS is none)', () => {
    const st = w6cT2WaitStore();
    w6cT2With(st.dbFile, (cs) => {
      w6cExpect(W6C_T2.cardAt(w6cT2Ctx(cs, st.fG))).toEqual({ state: 'unmeasured', why: 'card-wait' });
      w6cExpect(W6C_T2.cardAt(w6cT2Ctx(cs, st.fG, W6C_T2_NOW + w6cLib.CARD_MEASURE_MAX_WAIT_MS)), 'CONTROL')
        .toEqual({ state: 'measured', value: { verdict: 'none', attachments_unread: 0 } });
      w6cExpect(W6C_T2.cardAt(w6cT2Ctx(cs, st.fU))).toEqual({ state: 'unmeasured', why: 'boundary-uncopied' });
    });
  });

  w6cIt('the five specs through Task 1\'s frame: windowRow asks each, stratify folds each; one card verdict per boundary, projected twice; a changed family tallied apart (U5, U8)', () => {
    const st = w6cT2EchoStore();
    const STUB = { source: 'fixture: the sixth counter is not this task\'s', measure: (): W6cR => ({ state: 'unmeasured', why: 'window-unmeasured' }),
      fold: (): never => { throw new Error('fold called on nothing'); } };
    const measures = { ...W6C_T2.COUNTER_MEASURES, [W6C_NAMES[5]!]: STUB };
    const out = w6cT2With(st.dbFile, (cs) => {
      const row = (p: W6cT2Part, changed = false): W6cR => W6C_T2.windowRow({ ctx: w6cT2Ctx(cs, p), changed, abState: w6cDrv.AB_STATES[0], measures });
      const rows = [row(st.fA1), row(st.fA2), row(st.fH1, true), row(st.fGhost)];
      return { rows, ...W6C_T2.stratify(rows, measures) } as W6cR;
    });
    const [C, E, L, S, M] = W6C_NAMES;
    w6cExpect(out.rows[0].measures[S!]).toEqual({ state: 'measured', value: { verdict: 'served', attachments_unread: 0 } });
    w6cExpect(out.rows[0].measures[M!].value, 'one verdict object, projected twice').toBe(out.rows[0].measures[S!].value);
    const ta = out.strata.treatment.anthropic.counters;
    w6cExpect(ta[C!]).toMatchObject({ measured: 1, summary: { ok_degraded: { num: 0, den: 1 } } });
    w6cExpect(ta[E!]).toMatchObject({ measured: 1, summary: { hits: 1, errors: 1, recall_calls: 3, gap: 2 } });
    w6cExpect(ta[S!]).toMatchObject({ summary: { n: 1, verdicts: { served: 1, mismatch: 0, none: 0 } } });
    const ca = out.strata.control.anthropic.counters;
    w6cExpect(ca[C!]).toEqual({ measured: 0, unmeasured: 2, unmeasured_by: { 'boundary-absent': 1, 'leaf-absent': 1 }, summary: null });
    w6cExpect(ca[L!]).toMatchObject({ measured: 2, summary: { lag_ms: [9, 700] } });
    w6cExpect(out.dropped_strata.changed.treatment.anthropic.counters[C!], 'H1, a changed treatment family: out of the arm cells, tallied apart under its arm (U8, V3)')
      .toMatchObject({ measured: 1, summary: { ok_degraded: { num: 1, den: 1 } } });
    w6cExpect(out.dropped_strata.changed.control.all.windows, 'no changed control family here (V3)').toBe(0);
    w6cExpect([out.strata.treatment.anthropic.windows, out.strata.treatment.other.windows]).toEqual([1, 0]);
  });
});
```

- [ ] **Step 3: Run them red.** In the foreground, with a timeout of at least 600000 ms:

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-6 Task'
```

Predicted, before the code exists: **15 failed** among Task 2's cases, and two of Task 1's red too (the import CONTROL's "the counter itself" line and the import pin: their constants already name the derive and recall statements the module lacks), so 17 failed and Task 1's other 29 passed (28 and 1 skipped on darwin).
- The `COUNTER_UNMEASURED` case: `indexOf('boundary-absent')` is `-1`, so the slice is `['pending']`.
- The fold cases: `TypeError: W6C_T2.foldCompliance is not a function`, or the same for their own name.
- The module scan: `decideCardDelivery: called once`, `expected [] to have a length of 1 but got +0`; its four CONTROL lines pass.
- The store cases fail at their first measure call (`W6C_T2.boundaryLeafOf is not a function` and the like), after their plant succeeds and their CONTROLs pass. The frame case runs on Task 1's `PENDING` measures and fails at the served verdict.

A store case that fails at the plant (a SQLite constraint or a foreign-key error) is the fixture's own defect: fix the fixture, never the counter.

- [ ] **Step 4: Write the counters.** In `deploy/history-counters.mjs`:
  1. The import statements become:

```js
import { BACKENDS, CARD_ATTACHMENT_MAX_BYTES, CARD_MEASURE_ROWS, EXIT, PARSE_STATUS, PROV_VERSION, SCHEMA_ADDED, UUID_RE, canonicalJson, cardIdsIn, cardWindowComplete, decideCardDelivery, eofAfterBoundary, sha256Hex } from '../ccd/history/lib.mjs';
import { StoreError, openReader, userVersion } from '../ccd/history/store.mjs';
import { holdingCopyOf } from '../ccd/history/derive.mjs';
import { expandEntryBody } from '../ccd/history/recall.mjs';
import { ASSIGNMENT_ARMS, COUNTERS_DEF_V1, COUNTERS_DEF_V1_SHA256, K, K_UNIT, assembleReports, buildWindows, changedFamilies, familyKey, turnsOf, windowCopyOf, windowOf } from './history-gate.mjs';
```

  (the `node:` statements and the driver statement unchanged). The module never spells a quoted sqlite specifier (W2-4's scan) and never names a decompressor (W2-5a's W2-D74 scan).

  2. In `COUNTER_UNMEASURED`, directly after the `'pending',` line:

```js
  'boundary-absent',     // the store holds no boundary row with this uuid
  'boundary-moved',      // the store holds the boundary at another line of the window copy's file than the measure printed
  'leaf-absent',         // the boundary has no depth-0 leaf: no status, and no leaf id for a card line to name
  'leaf-ambiguous',      // more than one depth-0 leaf names the boundary
  'boundary-uncopied',   // no copy holds the boundary (holdingCopyOf answered null), which card.mjs reads as none (D-6562)
  'no-measured-tick',    // no ticks row at or before the boundary has a measured lag
  'card-wait',           // the card's delivery window was still open at the read instant
```

  3. Directly above the comment `// ── the measures, composed (W2-D87): every counter's spec, in COUNTER_NAMES' order ──…`:

```js
// ── W2-6 Task 2: the five spec counters (W2-D87, W2-D86, W2-D15; spec §10.2's live A/B counters, §6.2) ─────────────
// Report-only: nothing here feeds decideGate. Each spec is Task 1's shape: a measure of one window (Task 1's WindowCtx)
// and a fold of one stratum's measured values, never handed none. Each reads its own named source through the run's one
// read handle (ctx.rs, store.mjs openReader); the node-wide `counters` table is never read. No blob is decoded here: an
// entry's body is recall.mjs's expandEntryBody, W2-1's export (W2-D86). A value that could not be measured is
// unmeasured with a COUNTER_UNMEASURED word, never a 0.
//   compliance        `nodes`: the status of the depth-0 leaf whose boundary opens the window, as stored, folded over lib's
//                     PARSE_STATUS with the ok plus degraded share. Expected: not-requested throughout (W3's baseline, and
//                     a check that nothing was steered).
//   echo_hits         `entries` of the window copy (ctx.copy, the gate's windowCopyOf), after the boundary and before the
//                     next main boundary, whose stored provenance is recall-echo (lib provenanceOf's structural rule, as
//                     ingest applied it under PROV_VERSION) and whose first tool_result is not an error, inside the window
//                     by the gate's own rule (windowOf). Beside the window's recall_calls count; the gap between the two is
//                     reported, never repaired.
//   lag               `ticks`: the lag_ms of the newest row at or before the boundary's ts_ms with a measured lag.
//   card_served,      per boundary, one verdict projected twice: lib's decideCardDelivery over cardIdsIn of the
//   card_id_mismatch  attachments in the first CARD_MEASURE_ROWS rows after the boundary in its holding copy (derive.mjs
//                     holdingCopyOf, lib's pickHoldingCopy), with cardWindowComplete: the functions card.mjs's measure
//                     calls. The glue around them (the rows read, `live`, the attachment size bound, the boundary's time,
//                     the wait) is card.mjs's deliveryOf, module-private, spelled a second time here (D-6562, D-6563).

const COUNTER_STMTS = new WeakMap();

/** The counters' statements on one read handle, prepared once per handle. Every one is a SELECT. */
function counterStmts(db) {
  let s = COUNTER_STMTS.get(db);
  if (s !== undefined) return s;
  s = {
    boundary: db.prepare(`SELECT b.entry_id AS entry_id, b.transcript_pk AS transcript_pk
      FROM entries e JOIN boundaries b ON b.entry_id = e.entry_id WHERE e.uuid = ?`),
    leaves: db.prepare('SELECT node_id, status, created_ms FROM nodes WHERE boundary_entry_id = ? AND depth = 0 ORDER BY node_id'),
    tick: db.prepare(`SELECT tick_id, ts_ms, lag_ms FROM ticks WHERE ts_ms <= ? AND lag_ms IS NOT NULL
      ORDER BY ts_ms DESC, tick_id DESC LIMIT 1`),
    echoRows: db.prepare(`SELECT m.line AS line, e.entry_id AS entry_id, e.blob_id AS blob_id, e.ts_ms AS ts_ms,
        e.prov_version AS prov_version
      FROM memberships m JOIN entries e ON e.entry_id = m.entry_id
      WHERE m.file_id = ? AND m.line > ? AND (? IS NULL OR m.line < ?)
        AND (e.provenance = 'recall-echo' OR (e.provenance = 'tool' AND e.prov_version <> ?))
      ORDER BY m.line`),
    lineOf: db.prepare('SELECT line FROM memberships WHERE file_id = ? AND entry_id = ?'),
    fileStatus: db.prepare('SELECT status FROM ingest_files WHERE file_id = ?'),
    stampAt: db.prepare(`SELECT e.ts_ms AS ts_ms FROM memberships m JOIN entries e ON e.entry_id = m.entry_id
      WHERE m.file_id = ? AND m.line <= ? AND e.ts_ms IS NOT NULL ORDER BY m.line DESC LIMIT 1`),
    cardRows: db.prepare(`SELECT e.entry_id AS entry_id, e.type AS type, e.blob_id AS blob_id, bl.raw_len AS raw_len,
        CASE WHEN b.entry_id IS NULL THEN 0 ELSE 1 END AS is_boundary
      FROM memberships m JOIN entries e ON e.entry_id = m.entry_id LEFT JOIN boundaries b ON b.entry_id = e.entry_id
      LEFT JOIN blobs bl ON bl.blob_id = e.blob_id
      WHERE m.file_id = ? AND m.line > ? ORDER BY m.line LIMIT ?`),
  };
  COUNTER_STMTS.set(db, s);
  return s;
}

/** The boundary with this uuid and the one depth-0 leaf that names it (the leaf derivation minted for it, the row
 *  card.mjs's measure reads). Unmeasured when the store holds no such boundary, when no leaf names it, or when two do.
 *  Task 3's re-discovery reads it too.  @param {CounterStore} rs  @param {string} boundaryUuid */
export function boundaryLeafOf(rs, boundaryUuid) {
  const s = counterStmts(rs.db);
  const b = s.boundary.get(boundaryUuid);
  if (b === undefined) return unmeasured('boundary-absent');
  const leaves = s.leaves.all(b.entry_id);
  if (leaves.length === 0) return unmeasured('leaf-absent');
  if (leaves.length > 1) return unmeasured('leaf-ambiguous');
  const [l] = leaves;
  return {
    state: 'leaf', entry_id: Number(b.entry_id), transcript_pk: Number(b.transcript_pk), node_id: String(l.node_id),
    status: String(l.status), created_ms: Number(l.created_ms),
  };
}

/** Compliance for one window: the status of the leaf whose boundary opens it, as stored, so a word outside
 *  PARSE_STATUS is reported, never folded into another (W2-D87).  @param {WindowCtx} ctx */
export function complianceAt(ctx) {
  const leaf = boundaryLeafOf(ctx.rs, ctx.boundary.boundary_uuid);
  return leaf.state === 'leaf' ? measured(leaf.status) : leaf;
}

/** Compliance over one stratum's measured statuses: lib's whole PARSE_STATUS distribution, a status outside it counted
 *  apart, and the ok plus degraded share as {num, den}. Nothing is divided out. */
export function foldCompliance(values) {
  const status = Object.fromEntries(PARSE_STATUS.map((w) => [w, 0]));
  let outOfVocabulary = 0;
  for (const v of nonEmpty('foldCompliance', values)) {
    if (Object.hasOwn(status, v)) status[v] += 1;
    else outOfVocabulary += 1;
  }
  return { status, out_of_vocabulary: outOfVocabulary, ok_degraded: { num: status.ok + status.degraded, den: values.length } };
}

/** Lag for one window: the newest ticks row at or before the boundary's ts_ms whose lag was measured (W2-D87). Two
 *  windows on one node near one instant share a reading (decisions §7).  @param {WindowCtx} ctx */
export function lagAt(ctx) {
  const t = counterStmts(ctx.rs.db).tick.get(ctx.boundary.ts_ms);
  return t === undefined ? unmeasured('no-measured-tick') : measured({ lag_ms: Number(t.lag_ms), tick_ts_ms: Number(t.ts_ms) });
}

/** Lag over one stratum: the measured lags, ascending. No statistic COUNTERS_DEF_V1 does not define is added here. */
export function foldLag(values) {
  return { lag_ms: nonEmpty('foldLag', values).map((v) => v.lag_ms).sort((a, b) => a - b) };
}

/** Is `ts` inside the window? The gate's windowOf, over one synthetic call at `ts`, counts it or not, so the rule
 *  (inclusive start, exclusive or inclusive end, W2-D14) is spelled once, in the gate.
 *  @param {WindowCtx} ctx  @param {number} ts */
function insideWindow(ctx, ts) {
  return windowOf(ctx.boundary, [[ts, 0, 'echo']]).calls === 1;
}

/** The first tool_result block of a stored user body: the block provenanceOf paired (lib toolResultIdsOf reads the
 *  blocks in this order). Null when the body holds none. */
function firstToolResult(body) {
  if (!Array.isArray(body)) return null;
  return body.find((b) => b !== null && typeof b === 'object' && b.type === 'tool_result') ?? null;
}

/** Echo hits for one window (W2-D87, U9, U10): the window copy's rows between the boundary and the next main boundary,
 *  each timed one placed in the window by the gate's rule. The store must hold the boundary at the line the report
 *  printed (boundary-moved otherwise). A row classified under another PROV_VERSION, stored as recall-echo or as tool, is
 *  `prov_stale`; of the current recall-echo rows, one with no ts is `untimed`; a body expandEntryBody cannot give, or one
 *  with no tool_result, is counted under its own word in `unreadable`; of the rest, an `is_error: true` first tool_result
 *  is an error and any other a hit. `gap` is the window's recall_calls minus its hits, reported, never repaired.
 *  @param {WindowCtx} ctx */
export function echoAt(ctx) {
  if (ctx.copy === null) return unmeasured('window-unmeasured');
  const s = counterStmts(ctx.rs.db);
  const b = s.boundary.get(ctx.boundary.boundary_uuid);
  if (b === undefined) return unmeasured('boundary-absent');
  // The rows are read by the lines measure-history.py printed: a moved line or a renumbered file would read another
  // window's rows, so the boundary must sit at its reported line of its reported file.
  const at = s.lineOf.get(ctx.copy.file_id, b.entry_id);
  if (at === undefined || Number(at.line) !== ctx.copy.boundary_line) return unmeasured('boundary-moved');
  const v = { hits: 0, errors: 0, untimed: 0, unreadable: {}, prov_stale: 0, recall_calls: ctx.window.calls, gap: 0 };
  const next = ctx.copy.next_boundary_line;
  for (const r of s.echoRows.all(ctx.copy.file_id, ctx.copy.boundary_line, next, next, PROV_VERSION)) {
    if (r.ts_ms !== null && !insideWindow(ctx, Number(r.ts_ms))) continue;
    // Stale whatever it was stored as: under another PROV_VERSION a stored tool row may be an echo (U9).
    if (Number(r.prov_version) !== PROV_VERSION) {
      v.prov_stale += 1;
      continue;
    }
    if (r.ts_ms === null) {
      v.untimed += 1;
      continue;
    }
    const k = expandEntryBody(ctx.rs, { entry_id: Number(r.entry_id), blob_id: Number(r.blob_id) });
    const block = k.state === 'body' ? firstToolResult(k.body) : null;
    const word = k.state !== 'body' ? k.state : block === null ? 'no-tool-result' : null;
    if (word !== null) {
      v.unreadable[word] = (v.unreadable[word] ?? 0) + 1;
      continue;
    }
    if (block.is_error === true) v.errors += 1;
    else v.hits += 1;
  }
  v.gap = v.recall_calls - v.hits;
  return measured(v);
}

/** Echo hits over one stratum: the measured windows' counts summed, `unreadable` merged word by word (into a prototype-less
 *  object, so no key of a node report, `__proto__` and `constructor` included, is dropped or read as inherited), and the
 *  gap of the sums (recall_calls - hits). */
export function foldEcho(values) {
  const t = { hits: 0, errors: 0, untimed: 0, unreadable: Object.create(null), prov_stale: 0, recall_calls: 0, gap: 0 };
  for (const v of nonEmpty('foldEcho', values)) {
    t.hits += v.hits;
    t.errors += v.errors;
    t.untimed += v.untimed;
    t.prov_stale += v.prov_stale;
    t.recall_calls += v.recall_calls;
    for (const [w, n] of Object.entries(v.unreadable)) t.unreadable[w] = (t.unreadable[w] ?? 0) + n;
  }
  t.gap = t.recall_calls - t.hits;
  return t;
}

/** Each row's card verdict, computed once: Task 1 hands every measure of one row the same frozen ctx. */
const CARD_VERDICTS = new WeakMap();

/** The card verdict for one boundary (W2-D87), projected by both card counters.  @param {WindowCtx} ctx */
export function cardAt(ctx) {
  let v = CARD_VERDICTS.get(ctx);
  if (v === undefined) {
    v = cardVerdictOf(ctx);
    CARD_VERDICTS.set(ctx, v);
  }
  return v;
}

/** lib's decideCardDelivery over cardIdsIn of the attachments in the first CARD_MEASURE_ROWS rows after the boundary in
 *  its holding copy, stopping at the next boundary, with lib's cardWindowComplete. An attachment whose stored raw_len
 *  passes CARD_ATTACHMENT_MAX_BYTES is skipped unread, as card.mjs skips it, and so is one expandEntryBody cannot give;
 *  each is counted in `attachments_unread`. A window still open at the read instant is card-wait; a boundary no copy
 *  holds is boundary-uncopied. The glue is card.mjs's deliveryOf, spelled a second time (D-6562), the boundary's time
 *  included (the store's stampAt, D-6563).
 *  @param {WindowCtx} ctx */
function cardVerdictOf(ctx) {
  const leaf = boundaryLeafOf(ctx.rs, ctx.boundary.boundary_uuid);
  if (leaf.state !== 'leaf') return leaf;
  const holding = holdingCopyOf(ctx.rs.db, { entry_id: leaf.entry_id, transcript_pk: leaf.transcript_pk });
  if (holding === null) return unmeasured('boundary-uncopied');
  const s = counterStmts(ctx.rs.db);
  const fileId = Number(holding.file_id);
  const line = Number(s.lineOf.get(fileId, leaf.entry_id).line);
  const live = holding.source_key === '' && s.fileStatus.get(fileId)?.status === 'live';
  /** @type {string[]} */
  const ids = [];
  let rowsSeen = 0;
  let nextBoundary = false;
  let unread = 0;
  for (const r of s.cardRows.all(fileId, line, CARD_MEASURE_ROWS)) {
    if (r.is_boundary === 1) {
      nextBoundary = true;
      break;
    }
    rowsSeen += 1;
    if (r.type !== 'attachment') continue;
    if (r.raw_len === null || Number(r.raw_len) > CARD_ATTACHMENT_MAX_BYTES) {
      unread += 1;
      continue;
    }
    const k = expandEntryBody(ctx.rs, { entry_id: Number(r.entry_id), blob_id: Number(r.blob_id) });
    if (k.state !== 'body') {
      unread += 1;
      continue;
    }
    ids.push(...cardIdsIn(k.primary));
  }
  // The boundary's time is the store's, as card.mjs's stampAt reads it: the newest stamped row at or before the boundary's
  // line in the holding copy, null when none is stamped. The report's time can differ (D-6563).
  const stamp = s.stampAt.get(fileId, line);
  const eofAfter = eofAfterBoundary({
    eofMs: holding.eof_ms === null ? null : Number(holding.eof_ms), boundaryTsMs: stamp === undefined ? null : Number(stamp.ts_ms),
  });
  const windowComplete = cardWindowComplete({ live, rowsSeen, nextBoundary, eofAfter, waitedMs: ctx.nowMs - leaf.created_ms });
  const verdict = decideCardDelivery({ ids, leafId: leaf.node_id, windowComplete });
  if (verdict === 'wait') return unmeasured('card-wait');
  return measured({ verdict, attachments_unread: unread });
}

/** One card counter's fold: `n` counts its own verdict (card_served counts served, card_id_mismatch counts mismatch)
 *  over the verdict distribution both share.  @param {'served'|'mismatch'} verdict */
export function foldCardFor(verdict) {
  if (verdict !== 'served' && verdict !== 'mismatch') throw new TypeError(`history-counters: a card counter counts served or mismatch, not ${verdict}`);
  return (values) => {
    const verdicts = Object.fromEntries(CARD_VERDICT_WORDS.map((w) => [w, 0]));
    let unread = 0;
    for (const v of nonEmpty(`foldCardFor(${verdict})`, values)) {
      if (!Object.hasOwn(verdicts, v.verdict)) throw new TypeError(`history-counters: not a card verdict: ${v.verdict}`);
      verdicts[v.verdict] += 1;
      unread += v.attachments_unread;
    }
    return { n: verdicts[verdict], verdicts, attachments_unread: unread };
  };
}

// The shape of each counter's measured value, as its measure above writes it (review 963 F1): the keys it writes and,
// where it writes an integer, a non-negative safe one (echo_hits' gap is a difference and may be negative). combine
// refuses a node report's answer that is off its counter's shape; count's own measures write these shapes.
/** A count a measure writes: a non-negative safe integer.  @param {unknown} v */
const isCount = (v) => Number.isSafeInteger(v) && /** @type {number} */ (v) >= 0;
/** A plain object (not a list).  @param {unknown} v */
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** A plain object holding exactly these keys.  @param {unknown} v  @param {string[]} keys */
const hasKeys = (v, keys) => isPlain(v) && Object.keys(/** @type {object} */ (v)).length === keys.length && keys.every((k) => Object.hasOwn(/** @type {object} */ (v), k));
/** The verdicts a card counter measures: decideCardDelivery's three that close a window (its wait is unmeasured). */
const CARD_VERDICT_WORDS = Object.freeze(['served', 'mismatch', 'none']);
const complianceValueOk = (v) => typeof v === 'string';
// unreadable's keys are free names: expandEntryBody's states are literals in recall.mjs, not an exported vocabulary, so
// no allowed set is built from a declared one; foldEcho sums whatever key arrives as a number.
const echoValueOk = (v) => hasKeys(v, ['hits', 'errors', 'untimed', 'unreadable', 'prov_stale', 'recall_calls', 'gap'])
  && [v.hits, v.errors, v.untimed, v.prov_stale, v.recall_calls].every(isCount) && Number.isSafeInteger(v.gap)
  && isPlain(v.unreadable) && Object.values(v.unreadable).every(isCount);
const lagValueOk = (v) => hasKeys(v, ['lag_ms', 'tick_ts_ms']) && isCount(v.lag_ms) && isCount(v.tick_ts_ms);
const cardValueOk = (v) => hasKeys(v, ['verdict', 'attachments_unread']) && CARD_VERDICT_WORDS.includes(v.verdict) && isCount(v.attachments_unread);
const rediscoveryValueOk = (v) => hasKeys(v, ['hit', 'distinct_paths', 'reads', 'sources', 'unresolved']) && typeof v.hit === 'boolean'
  && [v.distinct_paths, v.reads, v.sources, v.unresolved].every(isCount);

/** The five spec counters, each Task 1's CounterSpec with its source named (W2-D87). */
export const COMPLIANCE = Object.freeze({
  source: 'nodes.status of the depth-0 leaf whose boundary opens the window (lib PARSE_STATUS), with the ok plus degraded share',
  measure: complianceAt, fold: foldCompliance, answer: complianceValueOk,
});
export const ECHO_HITS = Object.freeze({
  source: 'entries.provenance recall-echo (lib provenanceOf, stored under PROV_VERSION) in the window copy, the first tool_result through recall.mjs expandEntryBody, beside the window\'s recall_calls',
  measure: echoAt, fold: foldEcho, answer: echoValueOk,
});
export const LAG = Object.freeze({
  source: 'ticks.lag_ms of the newest tick at or before the boundary with a measured lag',
  measure: lagAt, fold: foldLag, answer: lagValueOk,
});
const CARD_SOURCE = 'lib decideCardDelivery over cardIdsIn of the attachments in the first CARD_MEASURE_ROWS rows after the boundary in its holding copy (derive.mjs holdingCopyOf), with cardWindowComplete; the glue spelled again from card.mjs (D-6562)';
export const CARD_SERVED = Object.freeze({ source: CARD_SOURCE, measure: cardAt, fold: foldCardFor('served'), answer: cardValueOk });
export const CARD_ID_MISMATCH = Object.freeze({ source: CARD_SOURCE, measure: cardAt, fold: foldCardFor('mismatch'), answer: cardValueOk });

```

  4. In `COUNTER_MEASURES`, the first five lines become:

```js
  compliance: COMPLIANCE,
  echo_hits: ECHO_HITS,
  lag: LAG,
  card_served: CARD_SERVED,
  card_id_mismatch: CARD_ID_MISMATCH,
```

  (`rediscovery: PENDING,` stays, Task 3's line.)

- [ ] **Step 5: Run them green.** In the foreground, with a timeout of at least 600000 ms:

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-6 Task'
```

Expected (predicted): 46 passed (Task 1's 31 and this task's 15; 45 and 1 skipped on darwin). A run that reports only skipped tests selected nothing and is not green. Task 1's `count` cases now run these measures over an empty fixture store: every answer is unmeasured (`boundary-absent`, `no-measured-tick` or `window-unmeasured`), no fold is called, and each case's own assertions are unchanged.

- [ ] **Step 6: Measure every mutant red, then restore.** Save the file first: `mkdir -p .superpowers/sdd/history-w2-6 && cp deploy/history-counters.mjs .superpowers/sdd/history-w2-6/counters.task2.mjs`. Apply each mutant alone, in place, with Edit (each old text matches once). Run `cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-6 Task 2'`, write down the red, then restore with `cp .superpowers/sdd/history-w2-6/counters.task2.mjs deploy/history-counters.mjs` and check with `cmp` (no output) before the next mutant. In the table, `\|` is markdown's escape for `|`.

| # | Guard | Edit (old → new) | Predicted red |
|---|---|---|---|
| M1 | compliance: the depth-0 rule | `WHERE boundary_entry_id = ? AND depth = 0 ORDER BY node_id` → `WHERE boundary_entry_id = ? ORDER BY node_id` | 3: compliance case (A1 answers `leaf-ambiguous`), frame case, and the echo unmeasured case, whose compliance CONTROL on the cut A1 is then unmeasured (measured; predicted 2) |
| M2 | the ok+degraded share | `num: status.ok + status.degraded,` → `num: status.ok + status.degraded + status.invalid,` | 1: foldCompliance case, `num` 3 |
| M3 | a status outside PARSE_STATUS kept apart | `else outOfVocabulary += 1;` → `else status.absent += 1;` | 1: foldCompliance case, `absent` 1, `out_of_vocabulary` 0 |
| M4 | the error test | `if (block.is_error === true) v.errors += 1;` → `if (block.is_error !== false) v.errors += 1;` | 2: echo case (hits 0, errors 2), frame case |
| M5 | the error test is applied at all | the two lines `if (block.is_error === true) v.errors += 1;` / `else v.hits += 1;` → `v.hits += 1;` | 2: echo case (hits 2, errors 0), frame case |
| M6 | the positional cap at the next boundary | `s.echoRows.all(ctx.copy.file_id, ctx.copy.boundary_line, next, next, PROV_VERSION)` → `s.echoRows.all(ctx.copy.file_id, ctx.copy.boundary_line, null, null, PROV_VERSION)` | 2: echo case (line 19 counts, hits 2), frame case |
| M7 | the window's time rule | delete the line `if (r.ts_ms !== null && !insideWindow(ctx, Number(r.ts_ms))) continue;` | 2: echo case (line 15 counts, hits 2), frame case |
| M8 | untimed kept apart | `v.untimed += 1;` → `v.hits += 1;` | 2: echo case (hits 2, untimed 0), frame case |
| M9 | prov_version | `if (Number(r.prov_version) !== PROV_VERSION) {` → `if (false) {` | 2: echo case (hits 3, prov_stale 0: lines 14 and 17 count), frame case |
| M10 | unreadable kept apart | `v.unreadable[word] = (v.unreadable[word] ?? 0) + 1;` → `v.errors += 1;` | 2: echo case (errors 3), frame case |
| M11 | stored provenance only | `(e.provenance = 'recall-echo' OR` → `(e.provenance IN ('recall-echo', 'tool') OR` | 2: echo case (line 11 counts, hits 2), frame case |
| M12 | the window's gap sign | `v.gap = v.recall_calls - v.hits;` → `v.gap = v.hits - v.recall_calls;` | 1: echo case, gap -2 |
| M13 | the fold's gap sign | `t.gap = t.recall_calls - t.hits;` → `t.gap = t.hits - t.recall_calls;` | 2: foldEcho case (gap -1), frame case (gap -2) |
| M14 | lag at, not before | `WHERE ts_ms <= ? AND lag_ms IS NOT NULL` → `WHERE ts_ms < ? AND lag_ms IS NOT NULL` | 2: lag case (A1 answers 1200), frame case (the 5000 boundary unmeasured) |
| M15 | measured lag only | `WHERE ts_ms <= ? AND lag_ms IS NOT NULL` → `WHERE ts_ms <= ?` | 1: lag case, 9900 answers lag 0 at 9800 |
| M16 | newest by time | `ORDER BY ts_ms DESC, tick_id DESC LIMIT 1` → `ORDER BY tick_id DESC LIMIT 1` | 2: lag case (A1 answers 1200), frame case (`[700, 1200]`) |
| M17 | the card reads the holding copy (D-6562) | `const holding = holdingCopyOf(ctx.rs.db, { entry_id: leaf.entry_id, transcript_pk: leaf.transcript_pk });` → `const holding = ctx.copy === null ? null : { file_id: ctx.copy.file_id, eof_ms: null, source_key: ctx.copy.source_key };` | 2: card case (D answers `mismatch`), parity CONTROL (served 0) |
| M18 | the next-boundary stop (D-6562) | in `cardVerdictOf`, `nextBoundary = true;` / `break;` → `nextBoundary = true;` / `continue;` | 2: card case (C1 answers `served`), parity CONTROL (served 2) |
| M19 | the 40-row cap (D-6562) | `s.cardRows.all(fileId, line, CARD_MEASURE_ROWS)` → `s.cardRows.all(fileId, line, 1e9)` | 2: card case (F answers `served`), parity CONTROL |
| M20 | the attachment size bound (D-6562) | `if (r.raw_len === null \|\| Number(r.raw_len) > CARD_ATTACHMENT_MAX_BYTES) {` → `if (r.raw_len === null) {` | 2: card case (E answers `served`, unread 0), parity CONTROL |
| M21 | wait is unmeasured | delete the line `if (verdict === 'wait') return unmeasured('card-wait');` | 1: wait case, G is measured `wait` |
| M22 | no copy is unmeasured | `if (holding === null) return unmeasured('boundary-uncopied');` → `if (holding === null) return measured({ verdict: 'none', attachments_unread: 0 });` | 1: wait case, U answers `none` |
| M23 | one verdict per boundary | `let v = CARD_VERDICTS.get(ctx);` → `let v;` | 1: frame case, two verdict objects |
| M24 | lib's verdict, not a copy | `const verdict = decideCardDelivery({ ids, leafId: leaf.node_id, windowComplete });` → `const verdict = ids.some((p) => leaf.node_id.startsWith(p)) ? 'served' : ids.length > 0 ? 'mismatch' : windowComplete ? 'none' : 'wait';` | 1: module scan, `decideCardDelivery: called once` (0) |
| M25 | the gate's inclusion rule | `return windowOf(ctx.boundary, [[ts, 0, 'echo']]).calls === 1;` → `return ts >= ctx.window.start_ms && (ctx.window.end_inclusive ? ts <= ctx.window.end_ms : ts < ctx.window.end_ms);` | 1: module scan, the inclusion rule spelled here |
| M26 | a boundary the store does not hold, its own word | `const b = s.boundary.get(ctx.boundary.boundary_uuid);` → `const b = s.boundary.get(ctx.boundary.boundary_uuid) ?? { entry_id: -1 };` | 1: echo unmeasured case, `boundary-moved` where `boundary-absent` was expected |
| M27 | a stale `tool` row is read (U9) | `(e.provenance = 'tool' AND e.prov_version <> ?)` → `(e.provenance = 'tool' AND e.prov_version <> ? AND 0)` | 1: echo case, `prov_stale` 1 (line 17 unseen) |
| M28 | two leaves are leaf-ambiguous | delete the line `if (leaves.length > 1) return unmeasured('leaf-ambiguous');` | 1: compliance case, H3 measured `ok` (and its card measured) |
| M29 | the boundary at its reported line | delete the line `if (at === undefined \|\| Number(at.line) !== ctx.copy.boundary_line) return unmeasured('boundary-moved');` | 1: echo unmeasured case, A1 read from line 2 is measured |
| M30 | the boundary's time is the store's (D-6563) | `boundaryTsMs: stamp === undefined ? null : Number(stamp.ts_ms),` → `boundaryTsMs: ctx.boundary.ts_ms,` | 2: card case (EB answers `card-wait`), parity CONTROL (ours not all measured) |
| M31 | the file's end closes a live window | `const eofAfter = eofAfterBoundary({` → `const eofAfter = false && eofAfterBoundary({` | 2: card case (EA answers `card-wait`), parity CONTROL |
| M32 | `live` needs the file's status | `const live = holding.source_key === '' && s.fileStatus.get(fileId)?.status === 'live';` → `const live = holding.source_key === '';` | 2: card case (RT answers `card-wait`), parity CONTROL |
| M33 | the null arm is reached and read (D-6563) | `boundaryTsMs: stamp === undefined ? null : Number(stamp.ts_ms),` → `boundaryTsMs: stamp === undefined ? (() => { throw new Error('no stamp'); })() : Number(stamp.ts_ms),` | 2: card case (NS throws `no stamp`), parity CONTROL |
| M34 | no stamp is null, never the report's time (D-6563) | `boundaryTsMs: stamp === undefined ? null : Number(stamp.ts_ms),` → `boundaryTsMs: stamp === undefined ? Number(ctx.boundary.ts_ms) : Number(stamp.ts_ms),` | 2: card case (NS answers `measured`, the file's end closing it), parity CONTROL (`ours[8]` measured) |
| M35 | `unreadable` sums into a prototype-less object (review 965 F1) | `unreadable: Object.create(null), prov_stale: 0, recall_calls: 0, gap: 0 };\n  for (const v of nonEmpty('foldEcho'` → `unreadable: {}, ...` | 1: the `foldEcho` `__proto__` and `constructor` case (the entries are `constructor` as a string and no `__proto__`) |

M24 and M25 are behaviour-preserving on these fixtures; only the module scan sees them, which is the point: the scan pins where each rule lives, not what it answers. A mutant that stays green is reported with its measured output, and the guard is strengthened, never the CONTROL weakened. After the last mutant, `cmp .superpowers/sdd/history-w2-6/counters.task2.mjs deploy/history-counters.mjs` prints nothing.

- [ ] **Step 7: Every suite this task can move stays green.** One suite per tool call, in the foreground, with a timeout of at least 600000 ms:

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts
cd server && ./node_modules/.bin/vitest run test/citations.test.ts
cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts
cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
cd server && ./node_modules/.bin/vitest run test/dtbd.test.ts
```

Expected: all green. In `history-replay` that includes W2-4's `node:sqlite` scan, W2-5a's W2-D74 decode scan over `deploy/*.mjs`, and Task 1's pins on the counter module (import list, names, node-wide scan). `single-definition` passes because no O14 `VOCABS` name is declared in `deploy/`: `PARSE_STATUS` and `BACKENDS` are imported, never declared, and `COMPLIANCE` and its siblings are not lib names. `dtbd` passes because the departure is cited by its issued number.

*Measured over predicted (Task 2, U17):* Steps 3 and 5 measured as predicted (17 failed and 29 passed red; 46 passed green, the whole file 1178 passed). Every mutant M1 to M29 measured red, M1 with 3 failures where 2 were predicted (see its row). `typecheck-tests` was red once, which the plan did not predict: the frame case's `{ rows, ...W6C_T2.stratify(rows, measures) }` is typed as `{ rows }` alone, because spreading a `Record<string, any>` adds no keys, so `out.strata` and `out.dropped_strata` were `TS2339` errors. The literal now ends `as W6cR`, in the case's text above; the guard and every assertion are unchanged, and the suite then measured 12 passed. *Fix round 1 (U17, D-6563):* the card's boundary time is the store's `stampAt`, as card.mjs reads it, where this plan first took the report's `ts_ms`; the card store gained leaves EA, EB and RT, and the parity CONTROL measures eight leaves where five were written. Run on the old line, the card case and the parity CONTROL were red (EB answered `card-wait`; EA and RT passed on the old code, since the report's time equals the store's for EA and the old `live` already read the file's status for RT; they pin M31 and M32); M30 to M32 measured red, 2 failed each.

*Fix round 1 (review 963 F2, F3; U17):* the null arm (`stamp === undefined`) was reachable and no fixture reached it. The card store gained NS: its boundary is line 1 and unstamped, so no stamped row is at or before it, and its file ends a grace after the REPORT's time for it, which would close the window if that time were read. The correct answer is therefore `card-wait`, not `none` (a closed window would leave the report's-time fallback unseen, since a next boundary or a non-live file closes the window whatever the stamp says). NS is the last node, so card.mjs's wait stops its cursor with no leaf after it, and the parity CONTROL now reads `{ measured: 8, served: 1, mismatch: 1, waiting: 1 }` (predicted before the run, measured the same) with `ours[8]` unmeasured `card-wait`. The card case and the parity CONTROL were green on the unmodified counter at once (the code was right; the gap was the pin), 15 passed. M33 (a throw on the null arm) and M34 (the report's time as the null arm's fallback) each measured red, 2 failed each (the card case and the parity CONTROL), restored byte for byte (`cmp` clean). F3: the parity CONTROL's title now says it compares card.mjs's aggregate counts, which is all `measureCardDelivery` returns; a swap of which leaf is served and which is a mismatch passes it, and the card case pins each leaf.

*Fix round 2 (review 965 F1(b), F4; U17):* `foldEcho` summed `unreadable` into a plain `{}`, so a node report's `__proto__` key was dropped from the stratum summary and `constructor`, `toString` and the like came out as strings (`"function Object() { [native code] }3"`). It now sums into `Object.create(null)`. The new case (two values, each `unreadable` `{"tombstone":1,"__proto__":3,"constructor":3}` made by `JSON.parse`) measured red on the unmodified fold (the entries held `constructor` as a string and no `__proto__`) and green after: `-t 'W2-6 Task 2'` 16 passed (15 before), the Task 1 to 4 filter 88. M35 (the plain `{}` back) measured red, 1 failed, restored byte for byte (`cmp` clean). Plan text: the D-6562 entry now cites M30 to M34 and the Departure paragraph the parity CONTROL's aggregate counts `{measured 8, served 1, mismatch 1, waiting 1}`.

- [ ] **Step 8: Commit.**

```bash
git status --short   # deploy/history-counters.mjs and server/test/history-replay.test.ts, plus the plan if U17 applied
git add deploy/history-counters.mjs server/test/history-replay.test.ts
git diff --quiet -- docs/superpowers/plans/2026-10-22-ccrc-history-w2-6-counters.md || git add docs/superpowers/plans/2026-10-22-ccrc-history-w2-6-counters.md   # U17 only
CO_AUTHORED_BY='<the Co-Authored-By line the attribution reminder gives>'
git commit -m 'feat(history-counters): the five spec counters per window, by arm and by producer (W2-6 Task 2; W2-D87, W2-D86, W2-D15; D-6562)' -m "$CO_AUTHORED_BY"
```

### Task 3: re-discovery, the sixth counter (W2-D86; D-6561), and `combine` over the nodes' reports (U2, W2-D88)

Re-discovery asks whether, after compaction N, the session went back to a file it had already read or written before N. W2-D86 makes it required, report-only and per window:
- **The unit.** A `Read` tool_use in turns 1 to 10 of N's window whose file path, made absolute, is the file path of a `Read`, `Edit`, `MultiEdit`, `Write` or `NotebookEdit` tool_use in leaf N's span.
- **The turns** are Task 1's `ctx.turns`: the gate's `turnsOf` over the copy the gate's `windowCopyOf` chooses (W2-D14, W2-D15). This task spells no turn rule and no copy rule, and calls no `turnsOf`.
- **The span** is what derivation recorded: the `node_sources` of N's depth-0 node, found through Task 2's `boundaryLeafOf`, in `ord` order. It is never a second span rule over the copy.
- **Every body** comes from `recall.mjs`'s `expandEntryBody` over Task 1's `openReader` handle (W2-D86; W2-D74). This file decodes no blob.
- **Reported** as one spec in Task 1's shape (U7): per window `{hit, distinct_paths, reads, sources, unresolved}`, folded to `{with_hit, distinct_paths, reads, sources, unresolved, bash_reads: 'uncounted'}`, by arm and by producer through Task 1's frame, changed and unrealised families tallied apart, by arm and by producer (U8, V3).
- **Residual, named:** a Bash read of a file (`cat`, `sed`, `rg`) is not counted (W2-D86; decisions §7). The spec's source and every fold say so, and a case pins it.

With re-discovery the last of the six specs lands: `PENDING` and `'pending'` are removed, and a case pins that `COUNTER_MEASURES` holds exactly the six specs (W2-D87's emission pin, completing Task 1's). Then **`combine`** (U2): the operator gathers each node's `counters.json` with its sha, and `combine` checks them (one record, one window, the signed definitions, one counter script, which must be this one, so node reports of two scripts are refused (V4), each store once) and re-folds the concatenated per-window rows through Task 1's `stratify`, so the cross-node arm comparison is W2-6's, its counts the nodes' sums, and no fold is spelled twice.

**Decisions:** W2-D86 (the unit, the turns, the span, the bodies, the residual); W2-D87 (the emission pin, complete); W2-D88 (`combine`, the operator's act 24, report-only); W2-D14, W2-D15 and W2-D17 (turns, window copy and `<synthetic>` rows through Task 1's ctx); W2-D51 (store reads through `openReader`'s handle); W2-D74 with D-6238 (an entry's body is `expandEntryBody`'s pick; its four other words kept apart); U2; U5; U7; U11 (both sides made absolute against N's epoch cwd, a reading); V3 (`combine` re-folds `dropped_strata` by arm and producer, through `stratify`); V4 (`combine` refuses node reports of two counter scripts).

It cites D-5770 and D-5771 (W2-3's), D-6238 (W2-1's body states) and D-6301 (W2-5a's: an unknown body word throws). It ships one departure, **D-6561** (`history-w2-counters-notebook-path`), defined in this plan's "Deviations found" before dispatch; this task is the first to cite it.

**Files:**
- Modify: `deploy/history-counters.mjs`:
  - (a) the `../ccd/history/derive.mjs` statement becomes `import { epochOfUuid, holdingCopyOf } from '../ccd/history/derive.mjs';`;
  - (b) in `COUNTER_UNMEASURED`, the `'pending'` line is removed and six lines go directly after the `'card-wait'` line;
  - (c) `COUNTER_FLAG_SPECS` gains one line, and `COUNTER_FORMS` gains `combine`'s entry after `count`'s;
  - (d) one section, inserted directly above the comment `// ── the measures, composed (W2-D87): …`, below Task 2's;
  - (e) in the composed block, the `PENDING` constant and its doc comment are deleted and `rediscovery: PENDING,` becomes `rediscovery: REDISCOVERY,`.
- Modify: `server/test/history-replay.test.ts`, inside W2-6's region only: Task 1's `W6C_EXACT_NAMES` entry for derive, in place; this task's module-scope fixtures and two describes directly above the region's closing marker. No import is added (Tasks 1 and 2's bindings serve).
- Not edited: everything else (Global Constraints).

**Interfaces:**
- Consumes (base, unchanged): `ccd/history/derive.mjs`'s `epochOfUuid(db, ccUuid): {session_pk, seq, ccrc_id} | null`; `ccd/history/recall.mjs`'s `expandEntryBody`; `ccd/history/store.mjs` (tests only: `createStore`, `openWriter`, `closeWriter`, `openReader`, `userVersion`, `CODEC`, `brotli`); `deploy/history-replay.mjs` (tests only: `openReplayStore(home)`, `spanRowsOf(rs, boundaryEntryId)`); the gate (tests only: `windowOf`).
- Consumes (Tasks 1 and 2): `WindowCtx`, `windowCtx`, `stratify`, `answerOf`, `measured`, `unmeasured`, `nonEmpty`, `scriptSha256`, `checkFormFlags`, `refuseUnlessFresh`, `writeReport`, `MEASURE_CAP`, `AB_OK`, `COUNTERS_KIND`, `COUNTER_MEASURES`, `COUNTER_FORMS`, `COUNTER_FLAG_SPECS`; Task 2's `boundaryLeafOf`.
- Produces (`deploy/history-counters.mjs`, exported unless marked):
  - six `COUNTER_UNMEASURED` words: `'row-moved'`, `'body-unparseable'`, `'body-tombstone'`, `'body-over-cap'`, `'body-undecodable'`, `'path-unresolved'`; `'pending'` removed;
  - `REDISCOVERY_READ_TOOL = 'Read'`; `REDISCOVERY_PATH_FIELD`, frozen: `{Read: 'file_path', Edit: 'file_path', MultiEdit: 'file_path', Write: 'file_path', NotebookEdit: 'notebook_path'}` (D-6561); `REDISCOVERY_SOURCE_TOOLS = Object.keys(REDISCOVERY_PATH_FIELD)`, frozen;
  - `toolPathsOf(body, tools): string[]`, pure; `absolutePath(raw, cwd): string | null`, pure; `rediscoveryVerdict({reads, sources, cwd}): Measure` (a measured value carries `unresolved`, the paths left unresolved beside a hit; unmeasured `path-unresolved`, a bare `{state, why}` as the frame's `answerOf` keeps every unmeasured answer, only when no resolved path hits; the unresolved count reaches `counters.json` only beside a hit), pure;
  - `leafSpanRowsOf(rs, nodeId): {state: 'span', rows} | Measure` (leaf N's `node_sources` for the node id `boundaryLeafOf` answered, so the leaf-of-boundary rule is spelled once in the counter; the driver's `spanRowsOf` columns; a leaf with no source is `leaf-absent`, as the driver words it);
  - `rediscoveryAt(ctx): Measure`, value `{hit, distinct_paths, reads, sources, unresolved}`; `foldRediscovery(values) → {with_hit, distinct_paths, reads, sources, unresolved, bash_reads: 'uncounted'}`; `REDISCOVERY`, frozen;
  - `COUNTERS_COMBINED_KIND = 'ccrc-history-w2-counters-combined'`, `COUNTERS_COMBINED_FILE = 'counters-combined.json'`;
  - `combineReports(nodes: Array<{sha256, value}>, {measures = COUNTER_MEASURES, ownSha256 = scriptSha256()}): CombinedReport`, where `CombinedReport = {kind, v: 1, counters_def, k, k_unit, record_sha256, script_sha256, window, code_changed, nodes: [{store_id, sha256, user_version, read_ms, code_changed}], record_nodes, nodes_missing, sources, excluded, dropped, recall_off_gaps, windows, strata, dropped_strata}`;
  - `combineCommand(flags): number`; `COUNTER_SUBCOMMANDS` becomes `['count', 'combine']`;
  - module-private: `REDISCOVERY_STMTS`, `rediscoveryStmts(db)`, `bodyFor(rs, row)`, `COMBINE_SAME`, `combineRow(row, measures)`.
- Produces (test side): the module-scope `W6C_T3`, `W6C_T3_MODEL`, `W6C_T3_CWD`, `W6C_T3_T0`, `W6C_T3_A`, `W6C_T3_FAMILY`, `w6cT3Uid`, `w6cT3Use`, `w6cT3Read`, `w6cT3Op`, `w6cT3Res`, `w6cT3Asst`, `w6cT3Bnd`, `w6cT3Sum`, `w6cT3Turns`, `w6cT3Story`, `w6cT3PlantStore`, `w6cT3Frame`, `w6cT3Cs`, `w6cT3Ctx`, `w6cT3Measure`, `w6cT3Hit`, `w6cT3NodeB`, `w6cT3AsRead`; the describes `W2-6 Task 3: re-discovery (W2-D86; D-6561, U11)` (21 cases, the `it.each` counting seven) and `W2-6 Task 3: combine, the nodes' reports summed into one arm comparison (U2, W2-D88)` (3 cases; 12 after review 963 F1: nine cases added, one per shape class; 16 after review 965: four more).

**Choices this task makes:**
- **`NotebookEdit`'s file is its `notebook_path` (D-6561).** W2-D86 and `COUNTERS_DEF_V1`'s signed text say "the `file_path` of a … NotebookEdit tool_use"; Claude Code's `NotebookEdit` names its file `notebook_path`, as lib's `toolUseInputPath`, derive's card fields and W2-5a's `MINE_PATH_FIELDS` read it. Read literally, `NotebookEdit` would never match. The signed text stays as W2-3 froze it: editing it would move `COUNTERS_DEF_V1_SHA256` and touch the gate. E25 (Task 4) states the field.
- **Both sides are made absolute, against N's epoch cwd (U11).** W2-D86 says the Read's path is "made absolute"; making the span's path absolute too is a reading, not a departure: the tools take absolute paths, so it only turns a relative spelling of the same file into a match. The cwd is `epochs.cwd` of N's epoch (`epochOfUuid` over N's transcript's session uuid), the cwd W2-5a's `pathFactOf` uses. `path.posix.resolve` normalises `.`, `..` and repeated slashes; the comparison is by string, never by realpath or inode.
- **Unmeasured is never 0.** A window's re-discovery is unmeasured, each its own word, when: the window is unmeasured (`window-unmeasured`); the store holds no boundary for N, no leaf or two (`boundary-absent`, `leaf-absent`, `leaf-ambiguous`, Task 2's `boundaryLeafOf`); the leaf records no source (`leaf-absent`, as `spanRowsOf` words it); a window row's line no longer holds the uuid measure-history.py printed (`row-moved`); a turn row's or span assistant row's body is not `'body'` (`body-<word>`, D-6238's four words apart); a path either side cannot make absolute, when no resolved path already hits (`path-unresolved`). Each could hide a re-discovery. An unresolved path can add a hit, never remove one, so with a hit found the window is measured and carries `unresolved`, its distinct-path count then a lower bound. An unknown body word throws (D-6301's rule, through `unmeasured`).
- **A window row is found by its line in `ctx.copy`, then checked by uuid.** The sweep may have run between measure-history.py and the counter, so a moved row is `row-moved`, never a silent read of another row.
- **The span side reads assistant rows only.** A `tool_use` lives only in an assistant row; a tombstoned user row in the span (a tool result) leaves the window measured.
- **The report carries counts, never paths:** an indicator and counts, as W2-D86 asks; a path is private data, and the report travels to the reporting node (act 24).
- **`combine` re-folds; it never adds summaries.** Each summary is a counter's own fold, so the sum of two summaries is not spelled anywhere; `combine` concatenates the nodes' rows (each re-checked against Task 1's row shape and Measure shape, and, since review 963 F1, a measured row's `turns` and `recall_calls` as non-negative integers, an unmeasured row's as `null`, and each measured answer against its counter spec's `answer`: its keys, and non-negative integers where it writes integers; refused `counters-shape`, never coerced) and calls `stratify` with this file's specs, which is why the nodes' `script_sha256` must be this file's own. Counts add by construction.
- **`combine`'s order of refusals** (all `input-invalid`, each its own detail word): a value that is no counter report (`counters-shape`); definitions other than v1 (`counters-def-mismatch`); a node whose record, window, definitions, K or script differs from the first's (`node-mismatch`; two counter scripts among the nodes are refused here, V4); a script other than this one (`script-mismatch`); a store twice (`store-duplicate`); a row or answer off the shape (`counters-shape`). Every refusal of an input comes before `--out` exists (`writeReport`'s write failure and `prepareOut`'s own `createOut` can leave one: see the Residuals).
- **A node with no report is named, not refused (U2).** Each node report carries `record_nodes`, the record's stores (Task 1), and `COMBINE_SAME` holds it equal across the nodes; `combine` names in `nodes_missing` each store no node report covers, so a comparison over fewer nodes than the record assigned says so. Refusing such a combine instead would be a coordinator ruling; the missing node's rows are never invented.

**Residuals, named:**
- **A row's `store_id` is not checked against its node report's** (review 963 F1, the half left open): a node report that passes its sha check and carries this counter's script sha could carry rows naming another store. Every other cross-node case Review Focus 6 names is refused.
- **Also unchecked, named (review 965 F2, F6):** a row's `ts_ms`, `family`, `boundary_uuid`, `ccrc_id`, `generation` and any extra field; `echo_hits`' `unreadable` key names (free, summed as numbers); `answerOf` accepts any `COUNTER_UNMEASURED` word for any counter, and an unmeasured row's measured `echo_hits` or `rediscovery` answer is folded.
- **Bash reads are not counted** (W2-D86): any shell read of a span file.
- **The leaf span is spelled twice:** the driver's `spanRowsOf` (W2-5a) and the counter's `leafSpanRowsOf`; neither file may load the other's store opener. A parity pin holds the two equal over one store. The counter's span reads `boundaryLeafOf`'s node id, so the leaf-of-boundary rule (the driver's `LEAF_OF_BOUNDARY_SQL`) is spelled once in the counter, Task 2's `leaves`, and the pin, reading through that node id, holds it too.
- **A path reached through a symlink** compares as a different path; **a relative path resolved against N's epoch's launch cwd** is wrong if the session's tools resolved against another directory, the rare case.
- **`combine`'s list-flag pairing** (`--node-report` with `--node-report-sha256`, by position) is spelled again from the driver's private `pairedInputs`, with its own refusal.

- [ ] **Step 1: Confirm Tasks 1 and 2's state.** From the repository root:

```bash
grep -c "^export function boundaryLeafOf(rs, boundaryUuid) {$" deploy/history-counters.mjs
grep -c "^  card_id_mismatch: CARD_ID_MISMATCH,$" deploy/history-counters.mjs
grep -c "^  rediscovery: PENDING,$" deploy/history-counters.mjs
grep -c "^  'card-wait',  " deploy/history-counters.mjs
grep -c "^import { holdingCopyOf } from '../ccd/history/derive.mjs';$" deploy/history-counters.mjs
grep -cE '\bturnsOf\s*\(' deploy/history-counters.mjs
grep -cE 'REDISCOVERY|rediscovery(At|Verdict)|leafSpanRowsOf|toolPathsOf|absolutePath|combineReports|combineCommand|COUNTERS_COMBINED' deploy/history-counters.mjs server/test/history-replay.test.ts
grep -cE "(['\"\`])history-counters" deploy/history-replay.mjs
node --no-warnings --input-type=module -e "const d = await import('./ccd/history/derive.mjs'); const r = await import('./deploy/history-replay.mjs'); console.log(typeof d.epochOfUuid, typeof r.spanRowsOf, typeof r.openReplayStore)"
```

Expected: `1`, `1`, `1`, `1`, `1`, `1` (the one `turnsOf` call, Task 1's `windowCtx`, by Task 4's pattern, which also sees `turnsOf (`), then `deploy/history-counters.mjs:0` and `server/test/history-replay.test.ts:0` (none of this task's names exists yet), then `0` (the driver does not load the counter), and `function function function`. A missing Task 1 or Task 2 name, or any of this task's names already defined, is a gap to report to the coordinator: stop, and never define a name twice.

- [ ] **Step 2: Write the failing tests.** Inside W2-6's region of `server/test/history-replay.test.ts`:

(a) In Task 1's describe, the derive entry of `W6C_EXACT_NAMES` becomes:

```ts
    '../ccd/history/derive.mjs': '{ epochOfUuid, holdingCopyOf }',
```

(b) Directly above the region's closing marker:

```ts
// ── W2-6 Task 3: re-discovery (W2-D86; D-6561), and combine over the nodes' reports (U2, W2-D88) ────────────────────
// In-process only: no case spawns a child, runs measure-history.py or reaches claude, ccrc or gh. Each store is made by
// store.mjs's createStore under a mkTmp HOME, planted through openWriter in one transaction, closed, and read through
// openReader. Bodies are canonical JSON block lists stored as br5 blobs (store.mjs's CODEC and brotli), so recall.mjs's
// expandEntryBody reads them as it reads the sweep's. Each boundary's W2-D13 frame is built by hand from the planted
// rows, never by running Python, and the measure is asked through Task 1's windowCtx. Paths are synthetic under
// /home/u/tree. The combine cases build their node reports with Task 1's fixtures.
type W6cT3Block = Record<string, unknown>;
type W6cT3RawRow = [number, number | null, string | null, string | null, string, string | null];
interface W6cT3Copy { file_id: number; source_key: string; boundary_line: number; after_count: number; summary_line: number | null;
  next_boundary_line: number | null; next_boundary_ts_ms: number | null; last_ts_ms: number | null; rows: W6cT3RawRow[];
  models: Array<string | null>; truncated: boolean }
interface W6cT3Frame { boundary_uuid: string; ts_ms: number; copies: W6cT3Copy[] }
interface W6cT3CsT { db: W6cDb; storeId: string; version: number; schema: unknown; close: () => void }
type W6cT3Result = { state: 'measured'; value: { hit: boolean; distinct_paths: number; reads: number; sources: number; unresolved: number } }
  | { state: 'unmeasured'; why: string };
interface W6cT3Api {
  REDISCOVERY_READ_TOOL: string;
  REDISCOVERY_PATH_FIELD: Readonly<Record<string, string>>;
  REDISCOVERY_SOURCE_TOOLS: readonly string[];
  COUNTER_UNMEASURED: readonly string[];
  COUNTER_MEASURES: Record<string, W6cR>;
  COUNTER_SUBCOMMANDS: readonly string[];
  COMPLIANCE: W6cR; ECHO_HITS: W6cR; LAG: W6cR; CARD_SERVED: W6cR; CARD_ID_MISMATCH: W6cR; REDISCOVERY: W6cR;
  COUNTERS_COMBINED_KIND: string;
  COUNTERS_COMBINED_FILE: string;
  windowCtx(o: W6cR): W6cR;
  stratify(rows: W6cR[], measures: W6cR): W6cR;
  toolPathsOf(body: unknown, tools: readonly string[]): string[];
  absolutePath(raw: string, cwd: string | null): string | null;
  rediscoveryVerdict(o: { reads: string[]; sources: string[]; cwd: string | null }): W6cT3Result;
  boundaryLeafOf(cs: W6cT3CsT, uuid: string): W6cR;
  leafSpanRowsOf(cs: W6cT3CsT, nodeId: string): { state: string; rows?: unknown[] };
  rediscoveryAt(ctx: W6cR): W6cT3Result;
  foldRediscovery(values: unknown[]): W6cR;
  combineReports(nodes: Array<{ sha256: string; value: unknown }>, o?: W6cR): W6cR;
  combineCommand(flags: W6cR): number;
}
const W6C_T3 = w6cCtrMod as unknown as W6cT3Api;
const W6C_T3_MODEL = 'claude-fixture-4';
const W6C_T3_CWD = '/home/u/tree';
const W6C_T3_T0 = 1_760_000_000_000;
/** A uuid in the fixture shape: a fixed 8-hex prefix, then a 12-hex counter. */
const w6cT3Uid = (n: number): string => `c3c30000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const W6C_T3_FAMILY = Object.freeze({ key: 'fam-a', store_id: 'store-a', ccrc_id: 'demo-a', generation: w6cT3Uid(0xfff1), arm: 'treatment' });
const w6cT3Use = (id: string, name: string, input: Record<string, unknown>): W6cT3Block => ({ type: 'tool_use', id, name, input });
const w6cT3Read = (id: string, p: string): W6cT3Block => w6cT3Use(id, 'Read', { file_path: p });
/** One planted row. `msg` is an assistant row's msg_id (default: its own key's, so each assistant row is one turn). */
interface W6cT3PRow { key: string; type: 'user' | 'assistant' | 'system'; provenance: string; model?: string | null; msg?: string; content: W6cT3Block[]; summary?: boolean }
const w6cT3Op = (key: string): W6cT3PRow => ({ key, type: 'user', provenance: 'operator', content: [{ type: 'text', text: `go ${key}` }] });
const w6cT3Res = (key: string, id: string): W6cT3PRow => ({ key, type: 'user', provenance: 'tool', content: [{ type: 'tool_result', tool_use_id: id, content: `ok ${key}` }] });
const w6cT3Asst = (key: string, blocks: W6cT3Block[], o: { msg?: string; model?: string | null } = {}): W6cT3PRow => ({
  key, type: 'assistant', provenance: 'model', model: o.model === undefined ? W6C_T3_MODEL : o.model, msg: o.msg ?? `msg-${key}`,
  content: blocks.length > 0 ? blocks : [{ type: 'text', text: `say ${key}` }],
});
const w6cT3Bnd = (key: string): W6cT3PRow => ({ key, type: 'system', provenance: 'harness', content: [{ type: 'text', text: `compacted ${key}` }] });
const w6cT3Sum = (key: string): W6cT3PRow => ({ key, type: 'user', provenance: 'summary', content: [{ type: 'text', text: `summary ${key}` }], summary: true });
/** `n` assistant turns, each its own msg_id, an operator row before each; `at` maps a turn (1-based) to its blocks. */
function w6cT3Turns(n: number, at: Record<number, W6cT3Block[]> = {}): W6cT3PRow[] {
  const rows: W6cT3PRow[] = [];
  for (let i = 1; i <= n; i += 1) { rows.push(w6cT3Op(`o${i}`)); rows.push(w6cT3Asst(`a${i}`, at[i] ?? [])); }
  return rows;
}
interface W6cT3Plant {
  rows: W6cT3PRow[]; boundary: string; summary: string; span: string[];
  files?: Array<{ fileId: number; sourceKey?: string; keys: string[] }>;
  cwd?: string | null; tombstone?: string[]; noLeaf?: boolean;
}
const W6C_T3_A = `${W6C_T3_CWD}/src/a.ts`;
/** Leaf N's span (p1 an operator row, p2 an Edit of `spanBlocks`' file, default src/a.ts, p3 its result), boundary N,
 *  its summary, then `after`, the window's rows. `pre` rows go before the span, outside it. */
function w6cT3Story(after: W6cT3PRow[], o: { spanBlocks?: W6cT3Block[]; pre?: W6cT3PRow[] } = {}): W6cT3Plant {
  const span = [w6cT3Op('p1'), w6cT3Asst('p2', o.spanBlocks ?? [w6cT3Use('t-p2', 'Edit', { file_path: W6C_T3_A, old_string: 'x', new_string: 'y' })]), w6cT3Res('p3', 't-p2')];
  return { rows: [...(o.pre ?? []), ...span, w6cT3Bnd('n'), w6cT3Sum('s'), ...after], boundary: 'n', summary: 's', span: span.map((r) => r.key) };
}
interface W6cT3Fx { home: string; dbFile: string; uuid: Record<string, string>; ts: Record<string, number>; entry: Record<string, number> }
/** A store made by store.mjs's createStore under a fresh mkTmp HOME, planted in one transaction and closed: one session
 *  (ccrc id demo-a) with one confirmed epoch (cwd `cwd`, default W6C_T3_CWD), one main transcript, the files given
 *  (default: file 1, live, holding every row in order), one entry per row stamped 1 s apart, boundary N (ord 1) anchored
 *  on its summary, and, unless `noLeaf`, N's depth-0 leaf whose node_sources are `span` in order. A `tombstone` row's blob
 *  has no z and a pruned_ms, which expandEntryBody reads as 'tombstone'. */
function w6cT3PlantStore(p: W6cT3Plant): W6cT3Fx {
  const home = w6cMkTmp('ccrc-counters-w6c-t3-');
  w6cStore.createStore(home);
  const dbFile = w6cLib.historyPaths(home).dbFile as string;
  const db = w6cStore.openWriter(dbFile) as W6cDb;
  const fx: W6cT3Fx = { home, dbFile, uuid: {}, ts: {}, entry: {} };
  try {
    db.exec('BEGIN');
    db.prepare("INSERT INTO sessions (session_pk, ccrc_id, generation, project, first_seen_ms) VALUES (1, 'demo-a', ?, 'demo', 1)").run(w6cT3Uid(0xfff1));
    db.prepare("INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, cwd, confirmed_ms) VALUES (1, 1, ?, 'startup', 'hook', ?, 1)")
      .run(w6cT3Uid(0xfff2), p.cwd === undefined ? W6C_T3_CWD : p.cwd);
    db.prepare("INSERT INTO transcripts (transcript_pk, cc_session_uuid, agent_id) VALUES (1, ?, '')").run(w6cT3Uid(0xfff2));
    const files = p.files ?? [{ fileId: 1, keys: p.rows.map((r) => r.key) }];
    const file = db.prepare("INSERT INTO ingest_files (file_id, dev, ino, source_key, transcript_pk, status, parser_version) VALUES (?, 1, ?, ?, 1, 'live', 1)");
    for (const f of files) file.run(f.fileId, 7000 + f.fileId, f.sourceKey ?? '');
    const blob = db.prepare('INSERT INTO blobs (sha256, codec, z, raw_len, pruned_ms) VALUES (?, ?, ?, ?, ?) RETURNING blob_id');
    const ent = db.prepare('INSERT INTO entries (uuid, transcript_pk, type, model, msg_id, provenance, prov_version, struct_rank_ns, struct_file_id, blob_id, ts_ms, is_compact_summary) '
      + 'VALUES (?, 1, ?, ?, ?, ?, 1, ?, 1, ?, ?, ?) RETURNING entry_id');
    p.rows.forEach((r, i) => {
      const bytes = Buffer.from(w6cLib.canonicalJson(r.content) as string);
      const dead = (p.tombstone ?? []).includes(r.key);
      const b = blob.get(w6cHash('sha256').update(`${r.key}\0`).update(bytes).digest(), w6cStore.CODEC, dead ? null : w6cStore.brotli(bytes), bytes.length, dead ? 1 : null) as { blob_id: number | bigint };
      fx.uuid[r.key] = w6cT3Uid(i + 1);
      fx.ts[r.key] = W6C_T3_T0 + 1000 * (i + 1);
      const asst = r.type === 'assistant';
      fx.entry[r.key] = Number((ent.get(fx.uuid[r.key]!, r.type, asst ? (r.model ?? null) : null, asst ? (r.msg ?? null) : null, r.provenance, i,
        Number(b.blob_id), fx.ts[r.key]!, r.summary === true ? 1 : 0) as { entry_id: number | bigint }).entry_id);
    });
    const mem = db.prepare('INSERT INTO memberships (file_id, entry_id, line) VALUES (?, ?, ?)');
    for (const f of files) f.keys.forEach((k, i) => { mem.run(f.fileId, fx.entry[k]!, i + 1); });
    db.prepare('INSERT INTO boundaries (entry_id, transcript_pk, ord, anchor_uuid) VALUES (?, 1, 1, ?)').run(fx.entry[p.boundary]!, fx.uuid[p.summary]!);
    if (p.noLeaf !== true) {
      db.prepare("INSERT INTO nodes (node_id, session_pk, epoch_seq, transcript_pk, kind, depth, status, boundary_entry_id, parser_version, created_ms) "
        + "VALUES ('Lc3', 1, 1, 1, 'native_leaf', 0, 'ok', ?, 1, 1)").run(fx.entry[p.boundary]!);
      const src = db.prepare("INSERT INTO node_sources (node_id, entry_id, ord) VALUES ('Lc3', ?, ?)");
      p.span.forEach((k, i) => { src.run(fx.entry[k]!, i + 1); });
    }
    db.exec('COMMIT');
  } finally {
    w6cStore.closeWriter(db);
  }
  return fx;
}
/** N's W2-D13 frame as measure-history.py prints it for these one-boundary fixtures: every file holding N; per file, its
 *  assistant rows after the summary row (or after N) in file order, up to `rowCap`; `models` every such row's model in
 *  first-appearance order. No fixture has a next boundary. */
function w6cT3Frame(p: W6cT3Plant, fx: W6cT3Fx, rowCap = 400): W6cT3Frame {
  const byKey = new Map(p.rows.map((r) => [r.key, r]));
  const files = p.files ?? [{ fileId: 1, keys: p.rows.map((r) => r.key) }];
  const copies = files.filter((f) => f.keys.includes(p.boundary)).map((f): W6cT3Copy => {
    const bi = f.keys.indexOf(p.boundary);
    const si = f.keys.indexOf(p.summary);
    const opens = si > bi ? si : bi;
    const after = f.keys.slice(opens + 1).map((k, j) => ({ r: byKey.get(k)!, line: opens + 2 + j })).filter((x) => x.r.type === 'assistant');
    const rows: W6cT3RawRow[] = after.map(({ r, line }) => [line, fx.ts[r.key]!, r.msg ?? null, null, fx.uuid[r.key]!, r.model ?? null]);
    return {
      file_id: f.fileId, source_key: f.sourceKey ?? '', boundary_line: bi + 1, after_count: f.keys.length - bi - 1,
      summary_line: si > bi ? si + 1 : null, next_boundary_line: null, next_boundary_ts_ms: null,
      last_ts_ms: fx.ts[f.keys[f.keys.length - 1]!]!, rows: rows.slice(0, rowCap),
      models: [...new Set(after.map(({ r }) => r.model ?? null))], truncated: rows.length > rowCap,
    };
  });
  return { boundary_uuid: fx.uuid[p.boundary]!, ts_ms: fx.ts[p.boundary]!, copies };
}
/** Task 1's CounterStore, opened here on the planted store: openReader's read-only handle and expandEntryBody's rc. */
function w6cT3Cs(fx: W6cT3Fx): W6cT3CsT {
  const db = w6cStore.openReader(fx.dbFile) as W6cDb;
  return { db, storeId: 'store-a', version: w6cStore.userVersion(db) as number, schema: w6cLib.SCHEMA_ADDED, close: () => db.close() };
}
/** The WindowCtx Task 1's frame hands the measure: the gate's own window over the frame. */
const w6cT3Ctx = (cs: W6cT3CsT, frame: W6cT3Frame): W6cR =>
  W6C_T3.windowCtx({ rs: cs, family: W6C_T3_FAMILY, boundary: frame, window: w6cGate.windowOf(frame, []), calls: [], nowMs: 0 });
/** Plant, frame, open and measure one story; the handle is closed before the answer is returned. */
function w6cT3Measure(p: W6cT3Plant, edit?: (frame: W6cT3Frame) => void, rowCap?: number): W6cT3Result {
  const fx = w6cT3PlantStore(p);
  const frame = w6cT3Frame(p, fx, rowCap);
  edit?.(frame);
  const cs = w6cT3Cs(fx);
  try { return W6C_T3.rediscoveryAt(w6cT3Ctx(cs, frame)); } finally { cs.close(); }
}
const w6cT3Hit = (hit: boolean, distinct: number, reads: number, sources: number, unresolved = 0): W6cT3Result =>
  ({ state: 'measured', value: { hit, distinct_paths: distinct, reads, sources, unresolved } });
/** A node report as it comes back from a file: canonical JSON, parsed. */
const w6cT3AsRead = (r: W6cR): W6cR => JSON.parse(w6cLib.canonicalJson(r) as string);
/** The other node's report: its one family, F_O (control), one measured window of two turns, over Task 1's fixtures. */
const w6cT3NodeB = (ctr: W6cR, measures?: W6cR): W6cR => w6cFrame(ctr, {
  report: w6cReport({ families: [w6cFam(W6C_F_O, true, [], [{ boundary_uuid: w6cGen(207), ts_ms: W6C_B1, copies: [w6cCopyOf(W6C_B1, 2)] }])], recall_off: [] }, { store_id: W6C_OTHER }),
  ab: w6cAbOf({}, {}, W6C_OTHER), rs: { ...W6C_RS, storeId: W6C_OTHER }, measures,
});

w6cDescribe('W2-6 Task 3: re-discovery (W2-D86; D-6561, U11)', () => {
  w6cIt('toolPathsOf reads file_path from Read, Edit, MultiEdit and Write, and NotebookEdit\'s notebook_path (D-6561)', () => {
    const body = [
      { type: 'text', text: 'reading' },
      w6cT3Read('r1', '/r'), w6cT3Use('e1', 'Edit', { file_path: '/e' }), w6cT3Use('m1', 'MultiEdit', { file_path: '/m', edits: [] }),
      w6cT3Use('w1', 'Write', { file_path: '/w', content: 'x' }), w6cT3Use('n1', 'NotebookEdit', { notebook_path: '/n.ipynb', new_source: 'x' }),
      w6cT3Use('g1', 'Glob', { path: '/g' }), w6cT3Use('q1', 'Grep', { path: '/q', pattern: 'x' }), w6cT3Use('b1', 'Bash', { command: 'cat /r' }),
      w6cT3Use('n2', 'NotebookEdit', { file_path: '/not-its-field.ipynb' }), w6cT3Use('r2', 'Read', {}),
    ];
    w6cExpect(W6C_T3.toolPathsOf(body, W6C_T3.REDISCOVERY_SOURCE_TOOLS)).toEqual(['/r', '/e', '/m', '/w', '/n.ipynb']);
    w6cExpect(W6C_T3.toolPathsOf(body, [W6C_T3.REDISCOVERY_READ_TOOL])).toEqual(['/r']);
    w6cExpect(W6C_T3.REDISCOVERY_SOURCE_TOOLS).toEqual(['Read', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
    w6cExpect(W6C_T3.toolPathsOf('raw text', W6C_T3.REDISCOVERY_SOURCE_TOOLS), 'a body that is no block list holds no tool_use').toEqual([]);
  });

  w6cIt('absolutePath resolves against the cwd and normalises, and answers null where it cannot (U11)', () => {
    w6cExpect(W6C_T3.absolutePath('/home/u/tree/src/./x/../a.ts', null)).toBe(W6C_T3_A);
    w6cExpect(W6C_T3.absolutePath('src/a.ts', W6C_T3_CWD)).toBe(W6C_T3_A);
    w6cExpect(W6C_T3.absolutePath('./src//a.ts', W6C_T3_CWD)).toBe(W6C_T3_A);
    w6cExpect(W6C_T3.absolutePath('~/a.ts', W6C_T3_CWD), 'no shell expands it').toBeNull();
    w6cExpect(W6C_T3.absolutePath('src/a.ts', null)).toBeNull();
    w6cExpect(W6C_T3.absolutePath('src/a.ts', 'tree'), 'a relative cwd is no cwd').toBeNull();
  });

  w6cIt('rediscoveryVerdict: a Read of a span path is a hit, a path counts once, an unresolvable path is unmeasured, never a miss, and never hides a hit already found', () => {
    w6cExpect(W6C_T3.rediscoveryVerdict({ reads: [W6C_T3_A, 'src/a.ts', '/home/u/tree/b.ts'], sources: ['src/a.ts', '/home/u/tree/c.ts'], cwd: W6C_T3_CWD }))
      .toEqual(w6cT3Hit(true, 1, 3, 2));
    w6cExpect(W6C_T3.rediscoveryVerdict({ reads: ['/home/u/tree/b.ts'], sources: [W6C_T3_A], cwd: W6C_T3_CWD })).toEqual(w6cT3Hit(false, 0, 1, 1));
    w6cExpect(W6C_T3.rediscoveryVerdict({ reads: [W6C_T3_A], sources: ['src/a.ts'], cwd: null }), 'an unresolved span path is unmeasured, never a miss')
      .toEqual({ state: 'unmeasured', why: 'path-unresolved' });
    w6cExpect(W6C_T3.rediscoveryVerdict({ reads: ['src/b.ts'], sources: ['src/a.ts'], cwd: null }), 'CONTROL: two unresolved paths never match as two nulls')
      .toEqual({ state: 'unmeasured', why: 'path-unresolved' });
    w6cExpect(W6C_T3.rediscoveryVerdict({ reads: [W6C_T3_A, 'src/b.ts'], sources: [W6C_T3_A], cwd: null }), 'a hit found stays measured, the unresolved read beside it')
      .toEqual(w6cT3Hit(true, 1, 2, 1, 1));
  });

  w6cIt('a Read in turn 10 of a file the span edited is a re-discovery; CONTROL: the same Read in turn 11 is not', () => {
    w6cExpect(w6cT3Measure(w6cT3Story(w6cT3Turns(11, { 10: [w6cT3Read('r10', W6C_T3_A)] })))).toEqual(w6cT3Hit(true, 1, 1, 1));
    w6cExpect(w6cT3Measure(w6cT3Story(w6cT3Turns(11, { 11: [w6cT3Read('r11', W6C_T3_A)] })))).toEqual(w6cT3Hit(false, 0, 0, 1));
  });

  w6cIt('three rows sharing one msg_id are one turn and a <synthetic> row is no turn: a Read in the thirteenth assistant row is still turn 10', () => {
    const after = [
      w6cT3Op('o1'), w6cT3Asst('a1a', [], { msg: 'm1' }), w6cT3Asst('a1b', [], { msg: 'm1' }), w6cT3Asst('a1c', [], { msg: 'm1' }),
      w6cT3Asst('syn', [], { msg: 'msyn', model: '<synthetic>' }),
      ...w6cT3Turns(9, { 9: [w6cT3Read('r9', W6C_T3_A)] }).map((r) => ({ ...r, key: `x${r.key}`, msg: r.msg === undefined ? undefined : `x${r.msg}` })),
    ];
    w6cExpect(w6cT3Measure(w6cT3Story(after))).toMatchObject({ state: 'measured', value: { hit: true, distinct_paths: 1 } });
  });

  w6cIt('the span is what derivation recorded: a file written before the span is not a re-discovery; CONTROL: the span\'s file is', () => {
    const pre = [w6cT3Op('q1'), w6cT3Asst('q2', [w6cT3Use('t-q2', 'Write', { file_path: `${W6C_T3_CWD}/old.ts`, content: 'x' })]), w6cT3Res('q3', 't-q2')];
    w6cExpect(w6cT3Measure(w6cT3Story(w6cT3Turns(3, { 1: [w6cT3Read('r1', `${W6C_T3_CWD}/old.ts`)] }), { pre }))).toEqual(w6cT3Hit(false, 0, 1, 1));
    w6cExpect(w6cT3Measure(w6cT3Story(w6cT3Turns(3, { 1: [w6cT3Read('r1', W6C_T3_A)] }), { pre }))).toMatchObject({ state: 'measured', value: { hit: true } });
  });

  w6cIt('an Edit, a Bash cat and a Grep of the span\'s file in turns 1 to 10 are not a re-discovery (the Bash-reads residual); CONTROL: a Read is', () => {
    const not = { 2: [w6cT3Use('e2', 'Edit', { file_path: W6C_T3_A, old_string: 'y', new_string: 'z' })], 3: [w6cT3Use('b3', 'Bash', { command: `cat ${W6C_T3_A}` })],
      4: [w6cT3Use('g4', 'Grep', { path: W6C_T3_A, pattern: 'y' })] };
    w6cExpect(w6cT3Measure(w6cT3Story(w6cT3Turns(5, not)))).toEqual(w6cT3Hit(false, 0, 0, 1));
    w6cExpect(w6cT3Measure(w6cT3Story(w6cT3Turns(5, { ...not, 5: [w6cT3Read('r5', W6C_T3_A)] })))).toMatchObject({ state: 'measured', value: { hit: true, distinct_paths: 1 } });
  });

  w6cIt('paths compare made absolute on both sides (U11): a relative span Edit and two other spellings of one file are one path', () => {
    const p = w6cT3Story(w6cT3Turns(4, { 1: [w6cT3Read('r1', '/home/u/tree/src/./a.ts')], 2: [w6cT3Read('r2', '/home/u/tree/lib/../src/a.ts')] }),
      { spanBlocks: [w6cT3Use('t-p2', 'Edit', { file_path: 'src/a.ts', old_string: 'x', new_string: 'y' })] });
    w6cExpect(w6cT3Measure(p)).toEqual(w6cT3Hit(true, 1, 2, 1));
  });

  w6cIt('the Reads are read in the window\'s copy (W1\'s longest, W2-D15), never the producer\'s copy', () => {
    const p = w6cT3Story(w6cT3Turns(3, { 3: [w6cT3Read('r3', W6C_T3_A)] }));
    const keys = p.rows.map((r) => r.key);
    const shortTo = keys.indexOf('a1') + 1;
    // file 1, live (source_key ''), stops after turn 1: pickHoldingCopy's copy. file 2, a retired copy, holds all three turns.
    p.files = [{ fileId: 1, keys: keys.slice(0, shortTo) }, { fileId: 2, sourceKey: 'retired-1', keys }];
    w6cExpect(w6cT3Measure(p)).toMatchObject({ state: 'measured', value: { hit: true, distinct_paths: 1 } });
  });

  w6cIt.each([
    ['window-unmeasured', (): W6cT3Result => w6cT3Measure(w6cT3Story(w6cT3Turns(12, { 2: [w6cT3Read('r2', W6C_T3_A)] })), undefined, 5)],
    ['boundary-absent', (): W6cT3Result => w6cT3Measure(w6cT3Story(w6cT3Turns(2)), (f) => { f.boundary_uuid = w6cT3Uid(0xdead); })],
    ['leaf-absent', (): W6cT3Result => w6cT3Measure({ ...w6cT3Story(w6cT3Turns(2)), noLeaf: true })],
    ['row-moved', (): W6cT3Result => w6cT3Measure(w6cT3Story(w6cT3Turns(2)), (f) => { f.copies[0]!.rows[1]![4] = w6cT3Uid(0xbeef); })],
    ['body-tombstone', (): W6cT3Result => w6cT3Measure({ ...w6cT3Story(w6cT3Turns(3)), tombstone: ['a2'] })],
    ['body-tombstone', (): W6cT3Result => w6cT3Measure({ ...w6cT3Story(w6cT3Turns(3)), tombstone: ['p2'] })],
    ['path-unresolved', (): W6cT3Result => w6cT3Measure({ ...w6cT3Story(w6cT3Turns(2, { 1: [w6cT3Read('r1', W6C_T3_A)] }),
      { spanBlocks: [w6cT3Use('t-p2', 'Edit', { file_path: 'src/a.ts', old_string: 'x', new_string: 'y' })] }), cwd: null })],
  ] as Array<[string, () => W6cT3Result]>)('unmeasured, never 0: %s', (why, run) => {
    w6cExpect(run()).toMatchObject({ state: 'unmeasured', why });
    w6cExpect(W6C_T3.COUNTER_UNMEASURED).toContain(why);
  });

  w6cIt('CONTROL for the tombstone rows: a tombstoned user row in the span (a tool result) leaves the window measured', () => {
    w6cExpect(w6cT3Measure({ ...w6cT3Story(w6cT3Turns(3, { 1: [w6cT3Read('r1', W6C_T3_A)] })), tombstone: ['p3'] })).toMatchObject({ state: 'measured', value: { hit: true } });
  });

  w6cIt('the counter\'s leaf span, read through boundaryLeafOf\'s node, equals the driver\'s spanRowsOf over the same store (one recorded span and one leaf rule, spelled twice)', () => {
    const p = w6cT3Story(w6cT3Turns(2), { pre: [w6cT3Op('q1')] });
    const fx = w6cT3PlantStore(p);
    const cs = w6cT3Cs(fx);
    const rs = w6cDrv.openReplayStore(fx.home);
    try {
      const leaf = W6C_T3.boundaryLeafOf(cs, fx.uuid.n!);
      w6cExpect(leaf, 'CONTROL: the counter finds the one leaf the fixture plants').toMatchObject({ state: 'leaf', node_id: 'Lc3' });
      const mine = W6C_T3.leafSpanRowsOf(cs, leaf.node_id as string);
      const theirs = w6cDrv.spanRowsOf(rs, fx.entry.n!);
      w6cExpect([mine.state, theirs.state]).toEqual(['span', 'span']);
      w6cExpect(mine.rows).toEqual(theirs.rows);
      w6cExpect((mine.rows as Array<{ uuid: string }>).map((r) => r.uuid), 'CONTROL: the span, not the copy before N').toEqual(['p1', 'p2', 'p3'].map((k) => fx.uuid[k]));
    } finally { cs.close(); rs.close(); }
  });

  w6cIt('foldRediscovery counts windows with a hit, sums the distinct and the unresolved paths, and names the Bash residual; it never folds nothing', () => {
    w6cExpect(W6C_T3.foldRediscovery([{ hit: true, distinct_paths: 2, reads: 3, sources: 4, unresolved: 1 }, { hit: false, distinct_paths: 0, reads: 1, sources: 1, unresolved: 0 }]))
      .toEqual({ with_hit: 1, distinct_paths: 2, reads: 4, sources: 5, unresolved: 1, bash_reads: 'uncounted' });
    w6cExpect(() => W6C_T3.foldRediscovery([]), 'the frame never folds an empty stratum').toThrow(/a fold over no measured window is a defect/);
  });

  w6cIt('W2-D86: the counter takes its turns and its window copy from the gate and spells no turn key or copy rule of its own; CONTROL: the patterns see each', () => {
    const TURN_KEY = /\bmsg_id\s*\?\?|\[2\]\s*\?\?\s*\w+\[3\]/;
    // W1's longest-copy rule reads after_count; the card counters' pickHoldingCopy (W2-D87, Task 2) is lib's, not a rule here.
    const COPY_RULE = /\bafter_count\b/;
    w6cExpect(TURN_KEY.test('const key = row.msg_id ?? row.request_id ?? row.uuid;')).toBe(true);
    w6cExpect(TURN_KEY.test('return row[2] ?? row[3] ?? row[4];')).toBe(true);
    w6cExpect(COPY_RULE.test('const most = Math.max(...copies.map((c) => c.after_count));')).toBe(true);
    w6cExpect(w6cCode(W6C_SRC).filter((l) => TURN_KEY.test(l) || COPY_RULE.test(l))).toEqual([]);
    const gateLine = w6cFs.readFileSync(W6C_SRC, 'utf8').split('\n').find((l) => /^import \{[^}]*\} from '\.\/history-gate\.mjs';$/.test(l)) ?? '';
    for (const n of ['K', 'turnsOf', 'windowCopyOf', 'COUNTERS_DEF_V1', 'COUNTERS_DEF_V1_SHA256']) w6cExpect(gateLine, n).toMatch(new RegExp(`[{ ,]${n}[ ,}]`));
  });

  w6cIt('the six specs composed (W2-D87): COUNTER_MEASURES holds Tasks 2 and 3\'s specs in COUNTERS_DEF_V1\'s order, no PENDING or pending is left, and re-discovery names its residual', () => {
    const specs = [W6C_T3.COMPLIANCE, W6C_T3.ECHO_HITS, W6C_T3.LAG, W6C_T3.CARD_SERVED, W6C_T3.CARD_ID_MISMATCH, W6C_T3.REDISCOVERY];
    w6cExpect(Object.keys(W6C_T3.COUNTER_MEASURES)).toEqual(W6C_NAMES);
    specs.forEach((s, k) => w6cExpect(W6C_T3.COUNTER_MEASURES[W6C_NAMES[k]!], W6C_NAMES[k]).toBe(s));
    w6cExpect(W6C_T3.COUNTER_UNMEASURED).not.toContain('pending');
    w6cExpect(w6cCode(W6C_SRC).filter((l) => /\bPENDING\b|'pending'/.test(l))).toEqual([]);
    const SIX = ['row-moved', 'body-unparseable', 'body-tombstone', 'body-over-cap', 'body-undecodable', 'path-unresolved'];
    w6cExpect(W6C_T3.COUNTER_UNMEASURED.slice(-SIX.length)).toEqual(SIX);
    w6cExpect(Object.isFrozen(W6C_T3.REDISCOVERY)).toBe(true);
    w6cExpect(W6C_T3.REDISCOVERY.source).toMatch(/Bash reads \(cat, sed, rg\) are not counted/);
  });
});

w6cDescribe('W2-6 Task 3: combine, the nodes\' reports summed into one arm comparison (U2, W2-D88)', () => {
  w6cIt('combineReports re-folds the nodes\' rows through stratify: every stratum\'s windows are the nodes\' sums, every summary refolded, the lists merged, and a node no report covers named', async () => {
    const ctr = await w6cLoad();
    const A = w6cT3AsRead(w6cFrame(ctr));
    const B = w6cT3AsRead(w6cT3NodeB(ctr));
    const c = W6C_T3.combineReports([{ sha256: 'a1'.repeat(32), value: A }, { sha256: 'b2'.repeat(32), value: B }], { measures: w6cProbe() });
    w6cExpect([c.kind, c.v, c.record_sha256, c.window, c.code_changed, c.script_sha256]).toEqual([W6C_T3.COUNTERS_COMBINED_KIND, 1, W6C_RECORD_SHA, W6C_WINDOW, false, A.script_sha256]);
    w6cExpect(c.nodes.map((n: W6cR) => [n.store_id, n.sha256])).toEqual([[W6C_STORE, 'a1'.repeat(32)], [W6C_OTHER, 'b2'.repeat(32)]]);
    w6cExpect(c.windows).toHaveLength(A.windows.length + B.windows.length);
    for (const arm of w6cGate.ASSIGNMENT_ARMS as string[]) {
      for (const p of [...w6cLib.BACKENDS, ctr.ALL_PRODUCERS]) w6cExpect(c.strata[arm][p].windows, `${arm}/${p}`).toBe(A.strata[arm][p].windows + B.strata[arm][p].windows);
    }
    w6cExpect(c.strata.control.all.counters[W6C_NAMES[0]!].summary, 'refolded over both nodes, never copied').toEqual({ n: 2, sum: 4 });
    w6cExpect(c.strata).toEqual(W6C_T3.stratify(c.windows, w6cProbe()).strata);
    // V3: the dropped tallies carry the arm level too, and add across the nodes cell by cell.
    for (const kind of ['changed', 'unrealised']) {
      w6cExpect(Object.keys(c.dropped_strata[kind]), kind).toEqual([...w6cGate.ASSIGNMENT_ARMS]);
      for (const arm of w6cGate.ASSIGNMENT_ARMS as string[]) {
        for (const p of [...w6cLib.BACKENDS, ctr.ALL_PRODUCERS]) {
          w6cExpect(c.dropped_strata[kind][arm][p].windows, `${kind}/${arm}/${p}`).toBe(A.dropped_strata[kind][arm][p].windows + B.dropped_strata[kind][arm][p].windows);
        }
      }
    }
    w6cExpect([c.dropped_strata.changed.treatment.anthropic.windows, c.dropped_strata.changed.control.all.windows], 'F_X, node A\'s, under its own arm').toEqual([1, 0]);
    w6cExpect(c.dropped_strata).toEqual(W6C_T3.stratify(c.windows, w6cProbe()).dropped_strata);
    w6cExpect([c.excluded.not_found, c.dropped.changed, c.excluded.unmeasured.count]).toEqual([[w6cKeyOf(W6C_F_N)], [w6cKeyOf(W6C_F_X)], 1]);
    w6cExpect([c.record_nodes, c.nodes_missing], 'both of the record\'s nodes reported').toEqual([[W6C_STORE, W6C_OTHER].sort(), []]);
    const alone = W6C_T3.combineReports([{ sha256: 'a1'.repeat(32), value: A }], { measures: w6cProbe() });
    w6cExpect(alone.nodes_missing, 'a node of the record with no report is named, never left out unseen (U2)').toEqual([W6C_OTHER]);
  });

  w6cIt('combineReports refuses, each input-invalid with its own word: another kind, other definitions, another record, another counter, a store twice, a row off the shape', async () => {
    const ctr = await w6cLoad();
    const A = w6cT3AsRead(w6cFrame(ctr));
    const B = w6cT3AsRead(w6cT3NodeB(ctr));
    const n = (value: W6cR): { sha256: string; value: W6cR } => ({ sha256: 'a1'.repeat(32), value });
    const word = (nodes: Array<{ sha256: string; value: W6cR }>, o: W6cR = {}): string | undefined => {
      const r = w6cRefusalOf(() => W6C_T3.combineReports(nodes, { measures: w6cProbe(), ...o }));
      w6cExpect(r?.word ?? 'input-invalid').toBe('input-invalid');
      return r?.detail.split(':')[0];
    };
    w6cExpect(word([n(A), n(B)]), 'CONTROL').toBeUndefined();
    w6cExpect(word([n({ ...A, kind: 'ccrc-history-w2-verify-ab' }), n(B)])).toBe('counters-shape');
    w6cExpect(word([n(A), n({ ...B, counters_def: { id: 'v1', sha256: '0'.repeat(64) } })])).toBe('counters-def-mismatch');
    w6cExpect(word([n(A), n({ ...B, record_sha256: 'cd'.repeat(32) })])).toBe('node-mismatch');
    w6cExpect(word([n(A), n(B)], { ownSha256: '0'.repeat(64) })).toBe('script-mismatch');
    const twoScripts = w6cRefusalOf(() => W6C_T3.combineReports([n(A), n({ ...B, script_sha256: '0'.repeat(64) })], { measures: w6cProbe() }));
    w6cExpect(twoScripts, 'node reports counted by two counter scripts (V4)').toEqual({ word: 'input-invalid', detail: "node-mismatch: node report 1's script_sha256 is not node report 0's" });
    w6cExpect(word([n(A), n(A)])).toBe('store-duplicate');
    w6cExpect(word([n(A), n({ ...A, record_sha256: 'cd'.repeat(32) })]), 'the order: another record before a store twice').toBe('node-mismatch');
    w6cExpect(word([n(A), n({ ...B, windows: [{ ...B.windows[0], arm: 'unassigned' }] })])).toBe('counters-shape');
    const nullAnswer = { ...B.windows[0], measures: { ...B.windows[0].measures, [W6C_NAMES[0]!]: { state: 'measured', value: null } } };
    w6cExpect(word([n(A), n({ ...B, windows: [nullAnswer] })]), 'an answer Task 1 would never write').toBe('counters-shape');
    w6cExpect(w6cRefusalOf(() => W6C_T3.combineReports([]))).toEqual({ word: 'args-invalid', detail: 'node-report-required' });
  });

  // Review 963 F1: a node report is data. combine refuses a row or an answer off the shapes count writes, never folding or
  // coercing it. The shaped nodes answer each counter with exactly the measured value its measure writes, and are combined
  // with the real specs (the default measures), whose `answer` checks are what refuse.
  const [F1_C, F1_E, F1_L, F1_S, F1_M, F1_R] = W6C_NAMES as [string, string, string, string, string, string];
  const F1_SHAPED: Record<string, unknown> = {
    [F1_C]: 'not-requested',
    [F1_E]: { hits: 1, errors: 0, untimed: 0, unreadable: { tombstone: 1 }, prov_stale: 0, recall_calls: 2, gap: 1 },
    [F1_L]: { lag_ms: 40, tick_ts_ms: 10 },
    [F1_S]: { verdict: 'served', attachments_unread: 0 },
    [F1_M]: { verdict: 'served', attachments_unread: 0 },
    [F1_R]: { hit: true, distinct_paths: 1, reads: 2, sources: 1, unresolved: 0 },
  };
  /** The real specs with their measures replaced by the shaped answers; their folds and `answer` checks are the real ones. */
  const f1Shaped = (ctr: W6cR): W6cR => Object.fromEntries(W6C_NAMES.map((name) => [name, { ...ctr.COUNTER_MEASURES[name],
    measure: (ctx: W6cR): W6cR => (ctx.turns === null ? { state: 'unmeasured', why: 'window-unmeasured' } : { state: 'measured', value: F1_SHAPED[name] }) }]));
  /** combine over node A and node B whose first window is `edit`ed: the refusal as {word, detail}, null when it folds. */
  const f1Refusal = (A: W6cR, B: W6cR, edit: (w: W6cR) => W6cR): W6cRefusal =>
    w6cRefusalOf(() => W6C_T3.combineReports([{ sha256: 'a1'.repeat(32), value: A }, { sha256: 'b2'.repeat(32), value: { ...B, windows: [edit(B.windows[0]), ...B.windows.slice(1)] } }]));
  const f1Answer = (name: string, value: unknown) => (w: W6cR): W6cR => ({ ...w, measures: { ...w.measures, [name]: { state: 'measured', value } } });
  /** Every edit is refused input-invalid, counters-shape, with `detail` naming what is off; the unedited report folds first. */
  async function f1Refuses(edits: Array<(w: W6cR) => W6cR>, detail: RegExp): Promise<void> {
    const ctr = await w6cLoad();
    const sh = f1Shaped(ctr);
    const A = w6cT3AsRead(w6cFrame(ctr, { measures: sh }));
    const B = w6cT3AsRead(w6cT3NodeB(ctr, sh));
    w6cExpect(B.windows[0].state, 'CONTROL: B\'s first window is measured').toBe('measured');
    w6cExpect(f1Refusal(A, B, (w) => w), 'CONTROL: the shaped nodes fold').toBeNull();
    for (const edit of edits) {
      const r = f1Refusal(A, B, edit);
      w6cExpect(r?.word).toBe('input-invalid');
      w6cExpect(r?.detail).toMatch(/^counters-shape: /);
      w6cExpect(r?.detail).toMatch(detail);
    }
  }

  w6cIt('combine refuses a measured row\'s turns that is no count, and an unmeasured row\'s that is not null (review 963 F1)', async () => {
    await f1Refuses([(w) => ({ ...w, turns: null }), (w) => ({ ...w, turns: '3' }), (w) => ({ ...w, turns: -1 }), (w) => ({ ...w, turns: 1.5 }),
      (w) => ({ ...w, state: 'unmeasured' })], /(a measured|an unmeasured) row's turns is /);
  });

  w6cIt('combine refuses a measured row\'s recall_calls that is no count, and an unmeasured row\'s that is not null (review 963 F1)', async () => {
    await f1Refuses([(w) => ({ ...w, recall_calls: '7' }), (w) => ({ ...w, recall_calls: null }), (w) => ({ ...w, recall_calls: -1 }),
      (w) => ({ ...w, state: 'unmeasured', turns: null })], /(a measured|an unmeasured) row's recall_calls is /);
  });

  const f1Off = (name: string): RegExp => new RegExp(`^counters-shape: countersReport: ${name} answered a measured value off its shape`);
  w6cIt('combine refuses a compliance answer that is no status string (review 963 F1)', async () => {
    await f1Refuses([f1Answer(F1_C, 7), f1Answer(F1_C, ['ok']), f1Answer(F1_C, {})], f1Off(F1_C));
  });
  w6cIt('combine refuses an echo_hits answer off its keys or counts (review 963 F1)', async () => {
    const ok = F1_SHAPED[F1_E] as Record<string, unknown>;
    await f1Refuses([f1Answer(F1_E, { unreadable: {} }), f1Answer(F1_E, { ...ok, hits: '1' }), f1Answer(F1_E, { ...ok, errors: -1 }), f1Answer(F1_E, { ...ok, gap: 0.5 }),
      f1Answer(F1_E, { ...ok, unreadable: { tombstone: 'x' } }), f1Answer(F1_E, { ...ok, unreadable: [1] }), f1Answer(F1_E, { ...ok, extra: 0 })], f1Off(F1_E));
  });
  w6cIt('combine refuses a lag answer off its keys or counts (review 963 F1)', async () => {
    await f1Refuses([f1Answer(F1_L, { lag_ms: 'x' }), f1Answer(F1_L, { lag_ms: -5, tick_ts_ms: 1 }), f1Answer(F1_L, { lag_ms: 5, tick_ts_ms: '1' }),
      f1Answer(F1_L, 40)], f1Off(F1_L));
  });
  w6cIt('combine refuses a card_served answer off its verdict or its unread count (review 963 F1)', async () => {
    await f1Refuses([f1Answer(F1_S, { verdict: 'served', attachments_unread: 'q' }), f1Answer(F1_S, { verdict: 'wait', attachments_unread: 0 }),
      f1Answer(F1_S, { verdict: 'served' }), f1Answer(F1_S, { verdict: 'served', attachments_unread: -1 })], f1Off(F1_S));
  });
  w6cIt('combine refuses a card_id_mismatch answer off its verdict or its unread count (review 963 F1)', async () => {
    await f1Refuses([f1Answer(F1_M, { verdict: 'wait', attachments_unread: 0 }), f1Answer(F1_M, { verdict: 'mismatch', attachments_unread: 'q' }),
      f1Answer(F1_M, { verdict: 'mismatch', attachments_unread: 0, extra: 1 })], f1Off(F1_M));
  });
  w6cIt('combine refuses a rediscovery answer off its keys, its indicator or its counts (review 963 F1)', async () => {
    const ok = F1_SHAPED[F1_R] as Record<string, unknown>;
    await f1Refuses([f1Answer(F1_R, {}), f1Answer(F1_R, { ...ok, hit: 'yes' }), f1Answer(F1_R, { ...ok, reads: -1 }), f1Answer(F1_R, { ...ok, unresolved: 0.5 }),
      f1Answer(F1_R, { ...ok, sources: '1' })], f1Off(F1_R));
  });
  w6cIt('every real counter spec states the shape of the value it writes, as its `answer` (review 963 F1; CONTROL: a stand-in spec states none and is not checked)', async () => {
    const ctr = await w6cLoad();
    for (const name of W6C_NAMES) w6cExpect(typeof ctr.COUNTER_MEASURES[name].answer, name).toBe('function');
    w6cExpect(typeof w6cProbe()[W6C_NAMES[0]!].answer, 'CONTROL').toBe('undefined');
  });

  // Review 965 F1: lib exports no vocabulary of expandEntryBody's states, so an unreadable key is not refused; it is summed
  // as a number, whatever its name, so a key of a node report is never dropped or turned into a string.
  w6cIt('combine accepts an unreadable key of any name and sums it as a number across the nodes: __proto__ and constructor are kept (review 965 F1)', async () => {
    const ctr = await w6cLoad();
    const sh = f1Shaped(ctr);
    const odd = JSON.parse('{"tombstone":1,"__proto__":3,"constructor":3}') as unknown;
    const withOdd = (r: W6cR): W6cR => ({ ...r, windows: r.windows.map((w: W6cR) => (w.state === 'measured'
      ? f1Answer(F1_E, { ...(F1_SHAPED[F1_E] as Record<string, unknown>), unreadable: odd })(w) : w)) });
    const A = withOdd(w6cT3AsRead(w6cFrame(ctr, { measures: sh })));
    const B = withOdd(w6cT3AsRead(w6cT3NodeB(ctr, sh)));
    const c = W6C_T3.combineReports([{ sha256: 'a1'.repeat(32), value: A }, { sha256: 'b2'.repeat(32), value: B }]);
    const cell = c.strata.control.all.counters[F1_E];
    w6cExpect(cell.measured, 'CONTROL: one control window on each node').toBe(2);
    w6cExpect(Object.entries(cell.summary.unreadable).sort()).toEqual([['__proto__', 6], ['constructor', 6], ['tombstone', 2]]);
  });

  // Review 965 F2: the strata key on a row's unrealised, so a row's ab_state and unrealised are checked as a pair count writes.
  w6cIt('combine refuses a row whose ab_state is no AB_STATES word (review 965 F2)', async () => {
    await f1Refuses([(w) => ({ ...w, ab_state: 'no-such-state' }), (w) => ({ ...w, ab_state: null }), (w) => ({ ...w, ab_state: 7 })], /a row's ab_state is /);
  });
  w6cIt('combine refuses a row whose unrealised is not exactly ab_state !== AB_OK: control-absent with unrealised false, and ok with unrealised true (review 965 F2)', async () => {
    await f1Refuses([(w) => ({ ...w, ab_state: 'control-absent', unrealised: false }), (w) => ({ ...w, unrealised: true })], /a row's unrealised is /);
  });

  // Review 965 F3: count's runtime path is unchanged. This CONTROL holds each spec's `answer` to what the real measures write.
  w6cIt('every real spec\'s `answer` accepts every measured value the real measures produce on the Task 2 and Task 3 fixture stores (review 965 F3; CONTROL: each counter measured at least once)', async () => {
    const ctr = await w6cLoad();
    const seen: Record<string, number> = Object.fromEntries(W6C_NAMES.map((name) => [name, 0]));
    const check = (name: string, a: W6cR): void => {
      if (a.state !== 'measured') return;
      seen[name] = seen[name]! + 1;
      w6cExpect(ctr.COUNTER_MEASURES[name].answer(a.value), `${name}: ${JSON.stringify(a.value)}`).toBe(true);
    };
    const echo = w6cT2EchoStore();
    const card = w6cT2CardStore();
    const wait = w6cT2WaitStore();
    const stores: Array<[{ dbFile: string }, W6cT2Part[]]> = [
      [echo, [echo.fA1, echo.fA1Cut, echo.fA1Moved, echo.fA2, echo.fH1, echo.fH2, echo.fH3, echo.fGhost, echo.fGhostMeasured]],
      [card, [card.fB, card.fC1, card.fC2, card.fD, card.fE, card.fF, card.fEA, card.fEB, card.fRT, card.fNS]],
      [wait, [wait.fG, wait.fU]],
    ];
    for (const [st, parts] of stores) {
      w6cT2With(st.dbFile, (cs) => {
        for (const p of parts) {
          const ctx = w6cT2Ctx(cs, p);
          for (const name of W6C_NAMES.slice(0, 5)) check(name, ctr.COUNTER_MEASURES[name].measure(ctx));
        }
      });
    }
    check(F1_R, w6cT3Measure(w6cT3Story(w6cT3Turns(11, { 10: [w6cT3Read('r10', W6C_T3_A)] }))));
    check(F1_R, w6cT3Measure(w6cT3Story(w6cT3Turns(11, { 11: [w6cT3Read('r11', W6C_T3_A)] }))));
    w6cExpect(Object.values(seen).every((n) => n > 0), `CONTROL: every counter was measured at least once: ${JSON.stringify(seen)}`).toBe(true);
  });

  w6cIt('combine writes one report under a fresh --out, its sha the one stderr line; its paired list flags must pair, and a flag outside its form is args-invalid', async () => {
    const ctr = await w6cLoad();
    const quiet = Object.fromEntries(W6C_NAMES.map((name) => [name, { source: `fixture: ${name}`, measure: (): W6cR => ({ state: 'unmeasured', why: 'window-unmeasured' }),
      fold: (): never => { throw new Error('fold called on nothing'); } }]));
    const dir = w6cMkTmp('ccrc-w2-6-t3-combine-');
    const save = (name: string, value: W6cR): { p: string; sha: string } => {
      const text = `${w6cLib.canonicalJson(value)}\n`;
      const p = w6cPath.join(dir, name);
      w6cFs.writeFileSync(p, text, { mode: 0o600 });
      return { p, sha: w6cLib.sha256Hex(text) as string };
    };
    const a = save('a.json', w6cFrame(ctr, { measures: quiet }));
    const b = save('b.json', w6cT3NodeB(ctr, quiet));
    const out = w6cPath.join(w6cMkTmp('ccrc-w2-6-t3-out-'), 'out');
    const flags = { 'node-report': [a.p, b.p], 'node-report-sha256': [a.sha, b.sha], out };
    const r = w6cInProcess(() => W6C_T3.combineCommand(flags));
    w6cExpect([r.code, r.refusal]).toEqual([0, null]);
    const file = w6cPath.join(out, W6C_T3.COUNTERS_COMBINED_FILE);
    const bytes = w6cFs.readFileSync(file);
    w6cExpect(r.stderr).toBe(`sha256 ${w6cLib.sha256Hex(bytes)}\n`);
    w6cExpect(w6cFs.readdirSync(out).sort()).toEqual([w6cDrv.OUT_MARKER, W6C_T3.COUNTERS_COMBINED_FILE].sort());
    w6cExpect(w6cFs.statSync(file).mode & 0o7777).toBe(0o600);
    const doc = JSON.parse(bytes.toString('utf8'));
    w6cExpect([doc.kind, doc.nodes.map((x: W6cR) => x.sha256), doc.strata.control.all.windows]).toEqual([W6C_T3.COUNTERS_COMBINED_KIND, [a.sha, b.sha], 3]);
    const unpaired = w6cInProcess(() => W6C_T3.combineCommand({ ...flags, 'node-report-sha256': [a.sha], out: `${out}-2` }));
    w6cExpect(unpaired.refusal).toEqual({ word: 'args-invalid', detail: '--node-report given 2 times, and --node-report-sha256 1' });
    const foreign = w6cInProcess(() => W6C_T3.combineCommand({ ...flags, store: '/home/u/x.db', out: `${out}-3` }));
    w6cExpect(foreign.refusal).toEqual({ word: 'args-invalid', detail: '--store is not a combine flag' });
    w6cExpect([w6cFs.existsSync(`${out}-2`), w6cFs.existsSync(`${out}-3`)]).toEqual([false, false]);
    w6cExpect([...W6C_T3.COUNTER_SUBCOMMANDS]).toEqual(['count', 'combine']);
  });
});
```

The `<synthetic>` row in the turn case is planted as an assistant row with its own msg, and the gate's `turnsOf` drops it. The thirteenth assistant row is `xa9` (three rows of turn 1, the synthetic row, then eight rows, `xa1` to `xa8`). The `x` prefix keeps those keys apart from `a1a`, `a1b` and `a1c`.

- [ ] **Step 3: Run them and see them fail.** In the foreground, with a timeout of at least 600000 ms:

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-6 Task'
```

Expected (predicted): **25 failed, 45 passed** (44 passed and 1 skipped on darwin).
- Of this task's 24 cases, 23 fail: each on `TypeError: W6C_T3.<name> is not a function` or on reading a property of undefined (`REDISCOVERY_SOURCE_TOOLS`, `REDISCOVERY`); the `it.each` rows and the store cases after their store is planted, so a failure inside `w6cT3PlantStore` (a constraint, a missing column) is a fixture defect to fix before Step 4. The composition case fails on `COUNTER_MEASURES.rediscovery`, still `PENDING`.
- The W2-D86 scan passes: it pins a state that holds already (Task 1's gate import, no turn key, no copy rule). Its red is mutant M12's.
- Two of Task 1's cases are red (the import CONTROL's "the counter itself" line and the import pin), because the derive entry now names `epochOfUuid`; Task 1's other 29 and Task 2's 15 pass.

- [ ] **Step 4: Implement.** In `deploy/history-counters.mjs`:

(a) The derive statement becomes `import { epochOfUuid, holdingCopyOf } from '../ccd/history/derive.mjs';`.

(b) In `COUNTER_UNMEASURED`, delete the line `  'pending',             // the stand-in every counter answers until its own measure lands (removed by W2-6 Task 3)`, and directly after the `'card-wait'` line add:

```js
  'row-moved',           // a window row's line no longer holds the uuid measure-history.py printed (re-discovery)
  'body-unparseable',    // a turn or span body expandEntryBody answered unparseable (D-6238): it could hide a path
  'body-tombstone',      // the same, tombstone
  'body-over-cap',       // the same, over-cap
  'body-undecodable',    // the same, undecodable
  'path-unresolved',     // a path on either side could not be made absolute against N's epoch cwd (U11), and none resolved hits
```

(c) In `COUNTER_FLAG_SPECS`, directly after the line `  'verify-ab': 'string', 'verify-ab-sha256': 'string', store: 'string', out: 'string', 'allow-code-change': 'bool',` add `  'node-report': 'list', 'node-report-sha256': 'list',`; in `COUNTER_FORMS`, directly after `count`'s closing `}),` add:

```js
  combine: Object.freeze({
    required: Object.freeze(['node-report', 'node-report-sha256', 'out']),
    optional: Object.freeze([]),
    run: (flags) => combineCommand(flags),
  }),
```

(d) Directly above the comment `// ── the measures, composed (W2-D87): …`, below Task 2's section:

```js
// ── W2-6 Task 3: re-discovery (W2-D86), the sixth counter ───────────────────────────────────────────────────────────
// Re-discovery, per window of a listed family (W2-D86): a Read tool_use in turns 1 to K of the window whose file path,
// made absolute, is the file path of a Read, Edit, MultiEdit, Write or NotebookEdit tool_use in leaf N's span. The turns
// are Task 1's ctx.turns, the gate's turnsOf over the copy the gate's windowCopyOf chooses (W2-D14, W2-D15): this file
// spells no turn rule and no copy rule. The span is what derivation recorded, node_sources of N's depth-0 node (Task 2's
// boundaryLeafOf) in ord order, never a rule over the copy; the driver's spanRowsOf reads the same rows, and a parity pin
// holds the two spellings equal. Every body is recall.mjs's expandEntryBody over Task 1's openReader handle (W2-D74,
// W2-D86); nothing here decodes a blob. Paths on both sides are made absolute against N's epoch's cwd (derive.mjs's
// epochOfUuid) and compared as strings (U11). Per window an indicator and counts, folded by Task 1's frame by arm and by
// producer. Unmeasured, never 0: each condition that could hide a re-discovery is its own word.
// RESIDUAL (W2-D86, decisions §7): a Bash read of a file (cat, sed, rg) is not counted; the source and every fold say so.

/** The tool whose call is a re-discovery's read (W2-D86). */
export const REDISCOVERY_READ_TOOL = 'Read';
/** The tools whose file a re-discovery re-reads, each with the input field that names its file (W2-D86): file_path, and
 *  NotebookEdit's notebook_path, the field Claude Code's NotebookEdit carries (D-6561). */
export const REDISCOVERY_PATH_FIELD = Object.freeze({ Read: 'file_path', Edit: 'file_path', MultiEdit: 'file_path', Write: 'file_path', NotebookEdit: 'notebook_path' });
/** The span side's tools, derived from the field map, never listed twice. */
export const REDISCOVERY_SOURCE_TOOLS = Object.freeze(Object.keys(REDISCOVERY_PATH_FIELD));

/** The raw file paths of one body's tool_use blocks whose name is in `tools`, in block order, each read from its tool's
 *  field. A matching block whose field is not a non-empty string names no file and is skipped; a body that is not a
 *  block list holds no tool_use. Pure.  @param {unknown} body  @param {readonly string[]} tools  @returns {string[]} */
export function toolPathsOf(body, tools) {
  if (!Array.isArray(body)) return [];
  const out = [];
  for (const b of body) {
    if (b === null || typeof b !== 'object' || b.type !== 'tool_use' || !tools.includes(b.name)) continue;
    const v = b.input !== null && typeof b.input === 'object' ? b.input[REDISCOVERY_PATH_FIELD[b.name]] : undefined;
    if (typeof v === 'string' && v !== '') out.push(v);
  }
  return out;
}

/** A tool's path made absolute (W2-D86, U11): an absolute path normalised, a relative one resolved against N's epoch's
 *  cwd, by path.posix.resolve; null for a `~`-led path (no shell expands a tool's input) or a relative path with no
 *  absolute cwd. Pure.  @param {string} raw  @param {string | null} cwd  @returns {string | null} */
export function absolutePath(raw, cwd) {
  if (raw.startsWith('~')) return null;
  if (raw.startsWith('/')) return path.posix.resolve(raw);
  if (typeof cwd !== 'string' || !cwd.startsWith('/')) return null;
  return path.posix.resolve(cwd, raw);
}

/** One window's re-discovery from its raw paths (W2-D86). Pure. `reads` are the Read paths in turns 1 to K, `sources`
 *  the span's Read, Edit, MultiEdit, Write and NotebookEdit paths. A path either side cannot make absolute could be the
 *  re-discovery, so with no hit among the resolved paths the window is unmeasured (path-unresolved, a bare word: the
 *  frame's answerOf keeps no count on an unmeasured answer), never a miss; an unresolved path can add a hit, never
 *  remove one, so with a hit found the window is measured, `unresolved` beside it and its distinct count a lower bound.
 *  @param {{reads: string[], sources: string[], cwd: string | null}} o */
export function rediscoveryVerdict({ reads, sources, cwd }) {
  const r = reads.map((p) => absolutePath(p, cwd));
  const s = sources.map((p) => absolutePath(p, cwd));
  const unresolved = r.filter((p) => p === null).length + s.filter((p) => p === null).length;
  const span = new Set(s.filter((p) => p !== null));
  const hits = new Set(r.filter((p) => p !== null && span.has(p)));
  if (hits.size === 0 && unresolved > 0) return unmeasured('path-unresolved');
  return measured({ hit: hits.size > 0, distinct_paths: hits.size, reads: r.length, sources: span.size, unresolved });
}

/** The statements re-discovery reads with, prepared once per handle. They read no body. */
const REDISCOVERY_STMTS = new WeakMap();
/** @param {object} db */
function rediscoveryStmts(db) {
  let s = REDISCOVERY_STMTS.get(db);
  if (s === undefined) {
    s = {
      span: db.prepare(`SELECT e.entry_id AS entry_id, e.uuid AS uuid, e.type AS type, e.model AS model, e.provenance AS provenance,
          e.ts_ms AS ts_ms, e.blob_id AS blob_id
        FROM node_sources s JOIN entries e ON e.entry_id = s.entry_id
        WHERE s.node_id = ?
        ORDER BY s.ord`),
      row: db.prepare('SELECT e.entry_id AS entry_id, e.uuid AS uuid, e.blob_id AS blob_id FROM memberships m JOIN entries e ON e.entry_id = m.entry_id WHERE m.file_id = ? AND m.line = ?'),
      transcript: db.prepare('SELECT cc_session_uuid FROM transcripts WHERE transcript_pk = ?'),
      cwd: db.prepare('SELECT cwd FROM epochs WHERE session_pk = ? AND seq = ?'),
    };
    REDISCOVERY_STMTS.set(db, s);
  }
  return s;
}

/** Leaf N's span (W2-D86): the rows derivation recorded as leaf N's sources (node_sources of N's depth-0 node), in their
 *  recorded order, with the columns the driver's spanRowsOf reads (the parity pin compares them whole). A leaf with no
 *  source is leaf-absent, as spanRowsOf words it. The node is boundaryLeafOf's, already found and checked unambiguous,
 *  so the leaf-of-boundary rule is spelled once in this file (counterStmts' leaves).
 *  @param {CounterStore} rs  @param {string} nodeId */
export function leafSpanRowsOf(rs, nodeId) {
  const rows = rediscoveryStmts(rs.db).span.all(nodeId);
  return rows.length === 0 ? unmeasured('leaf-absent') : { state: 'span', rows };
}

/** An entry's body as expand picks it (W2-D74; D-6238): 'body' carries the parsed pick; each other word is unmeasured as
 *  body-<word>, kept apart. A word expandEntryBody gains later throws in unmeasured rather than reach a wordless answer
 *  (D-6301's rule).  @param {CounterStore} rs  @param {{entry_id: number, blob_id: number}} row */
function bodyFor(rs, row) {
  const k = expandEntryBody(rs, { entry_id: Number(row.entry_id), blob_id: Number(row.blob_id) });
  return k.state === 'body' ? { state: 'body', body: k.body } : unmeasured(`body-${k.state}`);
}

/** One window's re-discovery (W2-D86). In order: window-unmeasured; boundaryLeafOf's words; a leaf with no source; the
 *  window side (the frame's turns, each row found by its line in ctx.copy and checked by uuid: row-moved; its body:
 *  body-<word>); the span side (its assistant rows' bodies: body-<word>); then rediscoveryVerdict over N's epoch's cwd.
 *  @param {WindowCtx} ctx */
export function rediscoveryAt(ctx) {
  if (ctx.turns === null) return unmeasured('window-unmeasured');
  const leaf = boundaryLeafOf(ctx.rs, ctx.boundary.boundary_uuid);
  if (leaf.state !== 'leaf') return leaf;
  const span = leafSpanRowsOf(ctx.rs, leaf.node_id);
  if (span.state !== 'span') return span;
  const s = rediscoveryStmts(ctx.rs.db);
  const reads = [];
  for (const raw of ctx.turns.flatMap((t) => t.rows)) {
    const row = s.row.get(ctx.copy.file_id, raw[0]);
    if (row === undefined || row.uuid !== raw[4]) return unmeasured('row-moved');
    const k = bodyFor(ctx.rs, row);
    if (k.state !== 'body') return k;   // a lost turn body could hide the Read
    reads.push(...toolPathsOf(k.body, [REDISCOVERY_READ_TOOL]));
  }
  const sources = [];
  for (const row of span.rows) {
    if (row.type !== 'assistant') continue;   // a tool_use lives only in an assistant row
    const k = bodyFor(ctx.rs, row);
    if (k.state !== 'body') return k;   // a lost span body could hide the source
    sources.push(...toolPathsOf(k.body, REDISCOVERY_SOURCE_TOOLS));
  }
  const t = s.transcript.get(leaf.transcript_pk);
  const ep = t === undefined ? null : epochOfUuid(ctx.rs.db, t.cc_session_uuid);
  const e = ep === null ? undefined : s.cwd.get(ep.session_pk, ep.seq);
  return rediscoveryVerdict({ reads, sources, cwd: typeof e?.cwd === 'string' ? e.cwd : null });
}

/** Re-discovery over one stratum's measured windows: the windows with a hit, their distinct paths summed, the reads and
 *  sources seen, the paths left unresolved beside a hit; `bash_reads: 'uncounted'` names the residual in every fold. */
export function foldRediscovery(values) {
  const out = { with_hit: 0, distinct_paths: 0, reads: 0, sources: 0, unresolved: 0, bash_reads: 'uncounted' };
  for (const v of nonEmpty('foldRediscovery', values)) {
    out.with_hit += v.hit ? 1 : 0;
    out.distinct_paths += v.distinct_paths;
    out.reads += v.reads;
    out.sources += v.sources;
    out.unresolved += v.unresolved;
  }
  return out;
}

/** The sixth counter's spec, in Task 1's shape (W2-D86, W2-D87). */
export const REDISCOVERY = Object.freeze({
  source: 'Read tool_use paths in the window\'s turns 1 to K against the Read, Edit, MultiEdit, Write and NotebookEdit paths of leaf N\'s node_sources span, both made absolute against N\'s epoch cwd, bodies through recall.mjs expandEntryBody; Bash reads (cat, sed, rg) are not counted (W2-D86)',
  measure: rediscoveryAt, fold: foldRediscovery, answer: rediscoveryValueOk,
});

// ── W2-6 Task 3: combine, the nodes' reports summed into one arm comparison (W2-D88; U2) ─────────────────────────────
// count reports one node; combine sums the nodes' reports, each counters.json passed with its sha, so the cross-node arm
// comparison stays W2-6's (U2). The nodes must agree on the record, the window, the definitions, K and the counter that
// ran, and that counter must be this one: the strata are re-folded from the concatenated per-window rows through Task 1's
// stratify and this file's own folds, so counts add and no summary is ever added to another. A node report is data: a
// row or an answer off the shapes count writes is refused, never folded or coerced: a row's turns and recall_calls (a
// non-negative integer on a measured row, null on an unmeasured one) and each counter's measured value (its spec's
// `answer`), and a row's ab_state (one of AB_STATES) with its unrealised (exactly ab_state !== AB_OK), which the strata
// key on. NOT checked, named: a row's store_id against its node report's, its ts_ms, family, boundary_uuid, ccrc_id and
// generation, and any extra field; and echo_hits' unreadable keys, which are free names (lib exports no vocabulary of
// expandEntryBody's states to build an allowed set from), summed by foldEcho as numbers, never dropped or coerced.

export const COUNTERS_COMBINED_KIND = 'ccrc-history-w2-counters-combined';
export const COUNTERS_COMBINED_FILE = 'counters-combined.json';
/** The node-report fields every node must share, and the combined report carries once. */
const COMBINE_SAME = Object.freeze(['counters_def', 'k', 'k_unit', 'record_nodes', 'record_sha256', 'script_sha256', 'window']);

/** One node report's row, checked against Task 1's row shape (a measured row's turns and recall_calls are counts, an
 *  unmeasured row's are null), each answer re-checked by answerOf against its counter's spec (review 963 F1).
 *  @param {any} w  @param {Record<string, any>} measures */
function combineRow(w, measures) {
  if (w === null || typeof w !== 'object' || !ASSIGNMENT_ARMS.includes(w.arm) || !BACKENDS.includes(w.producer)
    || typeof w.changed !== 'boolean' || typeof w.unrealised !== 'boolean' || (w.state !== 'measured' && w.state !== 'unmeasured')) {
    throw new TypeError(`combine: a row off the counter's shape: ${JSON.stringify(w ?? null).slice(0, 200)}`);
  }
  if (!AB_STATES.includes(w.ab_state)) throw new TypeError(`combine: a row's ab_state is ${JSON.stringify(w.ab_state ?? null)}, which is none of AB_STATES`);
  if (w.unrealised !== (w.ab_state !== AB_OK)) {
    throw new TypeError(`combine: a row's unrealised is ${w.unrealised}, where its ab_state ${w.ab_state} makes it ${w.ab_state !== AB_OK}`);
  }
  for (const k of ['turns', 'recall_calls']) {
    if (w.state === 'measured' ? !isCount(w[k]) : w[k] !== null) {
      throw new TypeError(`combine: ${w.state === 'measured' ? 'a measured' : 'an unmeasured'} row's ${k} is ${JSON.stringify(w[k] ?? null)}, where ${w.state === 'measured' ? 'a non-negative integer' : 'null'} is the shape`);
    }
  }
  return { ...w, measures: Object.fromEntries(COUNTER_NAMES.map((n) => [n, answerOf(n, w.measures?.[n], measures[n]?.answer)])) };
}

/** The nodes' reports summed (U2). Each node is {sha256, value}. Refused input-invalid, in this order: a value that is
 *  no counter report (counters-shape); definitions other than v1 (counters-def-mismatch); a COMBINE_SAME field other than
 *  the first node's (node-mismatch); a counter other than this one (script-mismatch); a store twice (store-duplicate);
 *  a row, an answer or a list off its shape (counters-shape): a row's ab_state, unrealised, turns and recall_calls, and each
 *  counter's measured value against its spec's `answer`. The record's stores no node report covers are named in
 *  nodes_missing, never refused: the comparison says it is over fewer nodes than the record assigned (U2). measures and
 *  ownSha256 are injectable for tests. */
export function combineReports(nodes, { measures = COUNTER_MEASURES, ownSha256 = scriptSha256() } = {}) {
  const bad = (what) => refuse('input-invalid', what);
  if (nodes.length === 0) refuse('args-invalid', 'node-report-required');
  nodes.forEach(({ value: r }, i) => {
    if (r === null || typeof r !== 'object' || r.kind !== COUNTERS_KIND || r.v !== 1 || !Array.isArray(r.windows) || !Array.isArray(r.record_nodes)) bad(`counters-shape: node report ${i} is no ${COUNTERS_KIND} v1`);
    if (r.counters_def?.id !== 'v1' || r.counters_def?.sha256 !== COUNTERS_DEF_V1_SHA256) bad(`counters-def-mismatch: node report ${i} names ${JSON.stringify(r.counters_def ?? null)}`);
  });
  const first = nodes[0].value;
  nodes.forEach(({ value: r }, i) => {
    for (const k of COMBINE_SAME) if (canonicalJson(r[k] ?? null) !== canonicalJson(first[k] ?? null)) bad(`node-mismatch: node report ${i}'s ${k} is not node report 0's`);
  });
  if (first.script_sha256 !== ownSha256) bad(`script-mismatch: the nodes ran counter ${first.script_sha256}, and this counter is ${ownSha256}: a combine re-folds with the code that counted`);
  const stores = nodes.map(({ value: r }) => r.store_id);
  const dup = stores.find((s, i) => stores.indexOf(s) !== i);
  if (dup !== undefined) bad(`store-duplicate: store ${dup} is reported twice`);
  const list = (x, what) => {
    if (!Array.isArray(x)) throw new TypeError(`combine: ${what} is not a list`);
    return x;
  };
  const sorted = (xs) => [...xs].sort();
  try {
    const reps = nodes.map(({ value: r }) => r);
    const rows = reps.flatMap((r) => r.windows.map((w) => combineRow(w, measures)));
    return {
      kind: COUNTERS_COMBINED_KIND, v: 1, counters_def: first.counters_def, k: first.k, k_unit: first.k_unit,
      record_sha256: first.record_sha256, script_sha256: first.script_sha256, window: first.window,
      code_changed: reps.some((r) => r.code_changed === true),
      nodes: nodes.map(({ sha256, value: r }) => ({ store_id: r.store_id, sha256, user_version: r.user_version, read_ms: r.read_ms, code_changed: r.code_changed === true })),
      record_nodes: first.record_nodes,
      nodes_missing: first.record_nodes.filter((st) => !stores.includes(st)),
      sources: first.sources,
      excluded: {
        not_found: sorted(reps.flatMap((r) => list(r.excluded.not_found, 'excluded.not_found'))),
        zero_windows: sorted(reps.flatMap((r) => list(r.excluded.zero_windows, 'excluded.zero_windows'))),
        unmeasured: { count: reps.reduce((n, r) => n + r.excluded.unmeasured.count, 0), keys: sorted(reps.flatMap((r) => list(r.excluded.unmeasured.keys, 'excluded.unmeasured.keys'))) },
        not_listed: sorted(reps.flatMap((r) => list(r.excluded.not_listed, 'excluded.not_listed'))),
      },
      dropped: {
        changed: sorted(reps.flatMap((r) => list(r.dropped.changed, 'dropped.changed'))),
        unrealised: Object.fromEntries(AB_STATES.filter((st) => st !== AB_OK).map((st) => [st, sorted(reps.flatMap((r) => list(r.dropped.unrealised[st], `dropped.unrealised.${st}`)))])),
      },
      recall_off_gaps: reps.flatMap((r) => list(r.recall_off_gaps, 'recall_off_gaps'))
        .sort((a, b) => (a.store_id < b.store_id ? -1 : a.store_id > b.store_id ? 1 : a.ts_ms - b.ts_ms)),
      windows: rows,
      ...stratify(rows, measures),
    };
  } catch (e) {
    if (e instanceof TypeError) bad(`counters-shape: ${e.message}`);
    throw e;
  }
}

/** combine: the paired node-report flags, a fresh --out, each node report sha-checked before it is parsed, the sum built
 *  in memory, and only then --out, with counters-combined.json written once. Every refusal of an input comes before --out
 *  exists; the one exception is writeReport's: a write failure after prepareOut made --out refuses out-refused and leaves
 *  the marked --out, which a re-run then refuses as existing. prepareOut's own createOut can also leave a new --out when it
 *  refuses (D-5986), which is not a refusal of an input. */
export function combineCommand(flags) {
  checkFormFlags('combine', flags);
  const paths = flags['node-report'];
  const shas = flags['node-report-sha256'];
  if (paths.length !== shas.length) refuse('args-invalid', `--node-report given ${paths.length} times, and --node-report-sha256 ${shas.length}`);
  refuseUnlessFresh(flags.out);
  const nodes = paths.map((p, i) => loadInput('node-report', p, shas[i], undefined, MEASURE_CAP));
  return writeReport(flags.out, COUNTERS_COMBINED_FILE, combineReports(nodes));
}

```

(e) In the composed block, delete `PENDING`'s doc comment and its constant (from `/** The stand-in every counter is until its own task lands. @type {CounterSpec} */` through its closing `});`), and replace `  rediscovery: PENDING,` with `  rediscovery: REDISCOVERY,`.

Then, from the repository root:
- `grep -cE "(['\"\`])node:sqlite\1" deploy/history-counters.mjs` prints `0`;
- `grep -nE '\.mjs:[0-9]|\.ts:[0-9]' deploy/history-counters.mjs` prints nothing (`citations.test.ts`, D-5893);
- `grep -nE '\bunbrotli|brotliDecompress|node:zlib' deploy/history-counters.mjs` prints nothing (W2-D74, W2-D86);
- `grep -cE '\bturnsOf\s*\(' deploy/history-counters.mjs` still prints `1` (Task 1's `windowCtx`).

- [ ] **Step 5: Run them and see them pass, then the whole file and the typecheck.** In the foreground, with a timeout of at least 600000 ms, one suite per tool call:

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-6 Task'
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts
cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
```

Expected:
- The filtered run: 70 passed (Task 1's 31, Task 2's 15, this task's 24; 69 and 1 skipped on darwin) (predicted). After review 963 F1, 79 (this task's 33: nine cases added); after review 965, 84 (Task 1's 31, Task 2's 16 and this task's 37: one case more in Task 2 and four more here; review 966 F4 measured 84, not 83).
- The whole file is green: W2-4's, W2-5a's and W2-5b1's cases, and W2-6's.
- `typecheck-tests` green. A failure naming only `agent/src/` or a module that is not installed comes from the worktree's install, not from this task.

- [ ] **Step 6: Measure every new guard red, then green.** From the repository root. Each mutant makes one exact replacement and asserts that it matched once; then it runs one filter, shows the red, and restores the file with `cp`. One mutant per tool call.

```bash
SCRATCH=.superpowers/sdd/history-w2-6/scratch; mkdir -p "$SCRATCH"
cat > "$SCRATCH/mut6t3.py" <<'EOF'
import sys
C = 'deploy/history-counters.mjs'
MUTANTS = {
  'M1': ("NotebookEdit: 'notebook_path' })", "NotebookEdit: 'file_path' })"),
  'M2': ("for (const raw of ctx.turns.flatMap((t) => t.rows)) {", "for (const raw of ctx.copy.rows) {"),
  'M3': ("FROM node_sources s JOIN entries e ON e.entry_id = s.entry_id\n        WHERE s.node_id = ?\n        ORDER BY s.ord",
         "FROM entries e WHERE e.transcript_pk = (SELECT transcript_pk FROM nodes WHERE node_id = ?1)\n        AND e.entry_id < (SELECT boundary_entry_id FROM nodes WHERE node_id = ?1) ORDER BY e.entry_id"),
  'M4': ("const row = s.row.get(ctx.copy.file_id, raw[0]);", "const row = s.row.get(ctx.boundary.copies[0].file_id, raw[0]);"),
  'M5': ("    if (k.state !== 'body') return k;   // a lost turn body could hide the Read", "    if (k.state !== 'body') continue;   // a lost turn body could hide the Read"),
  'M6': ("  if (hits.size === 0 && unresolved > 0) return", "  if (hits.size === 0 && unresolved < 0) return"),
  'M7': ("  if (ctx.turns === null) return unmeasured('window-unmeasured');\n", ""),
  'M8': ("if (row === undefined || row.uuid !== raw[4]) return", "if (row === undefined) return"),
  'M9': ("reads.push(...toolPathsOf(k.body, [REDISCOVERY_READ_TOOL]));", "reads.push(...toolPathsOf(k.body, REDISCOVERY_SOURCE_TOOLS));"),
  'M10': ("  if (raw.startsWith('/')) return path.posix.resolve(raw);", "  if (raw.startsWith('/')) return raw;"),
  'M11': ("  rediscovery: REDISCOVERY,", "  rediscovery: Object.freeze({ ...REDISCOVERY }),"),
  'M12': ("export function toolPathsOf(body, tools) {", "const keyOf = (row) => row[2] ?? row[3] ?? row[4];\nexport function toolPathsOf(body, tools) {"),
  'M13': ("  if (dup !== undefined) bad(", "  if (false) bad("),
  'M14': ("      windows: rows,\n      ...stratify(rows, measures),", "      windows: rows,\n      strata: first.strata, dropped_strata: first.dropped_strata,"),
  'M15': ("  if (first.script_sha256 !== ownSha256) bad(", "  if (false) bad("),
  'M16': ("!ASSIGNMENT_ARMS.includes(w.arm) || !BACKENDS", "!BACKENDS"),
  'M17': ("export const COUNTER_MEASURES = Object.freeze({", "const PENDING = Object.freeze({});\nexport const COUNTER_MEASURES = Object.freeze({"),
  'M18': ("      nodes_missing: first.record_nodes.filter((st) => !stores.includes(st)),", "      nodes_missing: [],"),
  'M19': ("  if (hits.size === 0 && unresolved > 0) return", "  if (unresolved > 0) return"),
  'M20': ("'record_nodes', 'record_sha256', 'script_sha256', 'window']);", "'record_nodes', 'record_sha256', 'window']);"),
}
old, new = MUTANTS[sys.argv[1]]
s = open(C).read()
assert s.count(old) == 1, (sys.argv[1], old, s.count(old))
open(C, 'w').write(s.replace(old, new))
EOF
cat > "$SCRATCH/r6t3.sh" <<'EOF'
# r6t3.sh <mutant> <filter>, from the repository root: apply one mutant, run one filter, restore the counter.
S=.superpowers/sdd/history-w2-6/scratch
python3 "$S/mut6t3.py" "$1" && (cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t "$2")
cp "$S/counters.t3.orig" deploy/history-counters.mjs
EOF
cp deploy/history-counters.mjs "$SCRATCH/counters.t3.orig"
```

Then one call per mutant, `bash .superpowers/sdd/history-w2-6/scratch/r6t3.sh <mutant> '<filter>'`, in the foreground (the runner is a file, so nothing has to outlive a tool call; no filter starts with `-`):

| Mutant | Guard | filter | Expected RED (predicted) |
|---|---|---|---|
| M1 | `NotebookEdit`'s field (D-6561) | `toolPathsOf reads` | 1: `'/not-its-field.ipynb'` in place of `'/n.ipynb'` |
| M2 | the frame's first K turns | `in turn 10 of a file` | 1: the turn-11 CONTROL hits |
| M3 | the recorded span, never a rule over the copy | `W2-6 Task 3: re-discovery` | 2: the pre-span case (old.ts hits) and the parity pin (q1 in the counter's span) |
| M4 | the window copy (W2-D15) | `read in the window` | 1: `row-moved` (the live short copy's lines) |
| M5 | a lost turn body is unmeasured | `unmeasured, never 0` | 1: the turn-row `body-tombstone` row measured |
| M6 | an unresolved path is never a miss | `W2-6 Task 3: re-discovery` | 2: the verdict case (`an unresolved span path is unmeasured, never a miss` answers measured, hit false) and the `path-unresolved` row |
| M7 | an unmeasured window | `unmeasured, never 0` | 1: the `window-unmeasured` row throws (`ctx.turns` is null) |
| M8 | the uuid check | `unmeasured, never 0` | 1: the `row-moved` row measured |
| M9 | the window side reads Reads only | `Bash-reads residual` | 1: the turn-2 Edit hits |
| M10 | an absolute path normalised (U11) | `W2-6 Task 3: re-discovery` | 2: `absolutePath`'s case and the two-spellings case |
| M11 | re-discovery composed | `the six specs composed` | 1: `COUNTER_MEASURES.rediscovery` is not `REDISCOVERY` |
| M12 | no turn key spelled here (W2-D86) | `spells no turn key` | 1: the planted line |
| M13 | a store twice | `combineReports refuses` | 1: `undefined` where `store-duplicate` was expected |
| M14 | the strata re-folded, never copied | `W2-6 Task 3: combine` | 2: the counts-add case and the command case (control/all 2, not 3) |
| M15 | the counting script is this one | `combineReports refuses` | 1: `undefined` where `script-mismatch` was expected |
| M16 | a row off the shape | `combineReports refuses` | 1: the `unassigned` row folds unseen |
| M17 | no `PENDING` left | `the six specs composed` | 1: the planted line |
| M18 | a node no report covers is named (U2) | `combineReports re-folds` | 1: the lone node's combine names no missing node (`[]` where `[W6C_OTHER]` was expected) |
| M19 | a hit is never hidden by an unresolved path | `rediscoveryVerdict: a Read` | 1: the hit beside an unresolved read answers `path-unresolved` |
| M20 | node reports of two counter scripts (V4) | `combineReports refuses` | 1: the second node's other script is combined (refusal null where `node-mismatch: node report 1's script_sha256 …` was expected) |
| M21 | a measured row's turns is a count (review 963 F1) | `for (const k of ['turns', 'recall_calls']) {` → `for (const k of ['recall_calls']) {` | 1: the `turns` case |
| M22 | a measured row's recall_calls is a count | `for (const k of ['turns', 'recall_calls']) {` → `for (const k of ['turns']) {` | 1: the `recall_calls` case |
| M23 | an unmeasured row's turns and recall_calls are null | `if (w.state === 'measured' ? !isCount(w[k]) : w[k] !== null) {` → `if (w.state === 'measured' ? !isCount(w[k]) : false) {` | 2: the `turns` and `recall_calls` cases (their unmeasured rows fold) |
| M24 | a measured answer meets its spec's shape | `if (valueOk !== undefined && !valueOk(o.value)) {` → `if (false) {` | 6: each counter's answer case |
| M25 | compliance's shape | `fold: foldCompliance, answer: complianceValueOk,` → `fold: foldCompliance, answer: () => true,` | 1: the compliance case |
| M26 | echo_hits' shape | `fold: foldEcho, answer: echoValueOk,` → `fold: foldEcho, answer: () => true,` | 1: the echo_hits case |
| M27 | lag's shape | `fold: foldLag, answer: lagValueOk,` → `fold: foldLag, answer: () => true,` | 1: the lag case |
| M28 | card_served's shape | `fold: foldCardFor('served'), answer: cardValueOk` → `fold: foldCardFor('served'), answer: () => true` | 1: the card_served case |
| M29 | card_id_mismatch's shape | `fold: foldCardFor('mismatch'), answer: cardValueOk` → `fold: foldCardFor('mismatch'), answer: () => true` | 1: the card_id_mismatch case |
| M30 | rediscovery's shape | `fold: foldRediscovery, answer: rediscoveryValueOk,` → `fold: foldRediscovery, answer: () => true,` | 1: the rediscovery case |
| M31 | combine hands each row its specs | `r.windows.map((w) => combineRow(w, measures))` → `r.windows.map((w) => combineRow(w, {}))` | 6: each counter's answer case |
| M32 | an answer holds exactly its keys | `isPlain(v) && Object.keys(/** @type {object} */ (v)).length === keys.length && keys.every(` → `isPlain(v) && keys.every(` | 2: the echo_hits case (`extra: 0`) and the card_id_mismatch case (`extra: 1`) |
| M33 | counts are non-negative | `const isCount = (v) => Number.isSafeInteger(v) && /** @type {number} */ (v) >= 0;` → `const isCount = (v) => Number.isSafeInteger(v);` | 6: the `turns`, `recall_calls`, echo_hits, lag, card_served and rediscovery cases |
| M34 | a row's ab_state is an AB_STATES word (review 965 F2) | `if (!AB_STATES.includes(w.ab_state)) throw new TypeError(` → `if (false) throw new TypeError(` | 1: the `ab_state` case |
| M35 | a row's unrealised is exactly `ab_state !== AB_OK` | `if (w.unrealised !== (w.ab_state !== AB_OK)) {` → `if (false) {` | 1: the `unrealised` case (`control-absent` with `unrealised: false`) |
| M36 | every real `answer` accepts what the real measures write (review 965 F3) | `const complianceValueOk = (v) => typeof v === 'string';` → `const complianceValueOk = (v) => v === 'not-requested';` | 1: the `answer` CONTROL over the fixture stores (`degraded` and `fixture-status` are refused) |

```bash
S=.superpowers/sdd/history-w2-6/scratch
cmp "$S/counters.t3.orig" deploy/history-counters.mjs && echo restored && rm -f "$S/counters.t3.orig"
```

If an assertion fails with count 0, print the line with `grep -nF` and correct the match; never loosen it. Then run Step 5's first two commands once more: both green.

- [ ] **Step 7: Run the neighbours that read these files.** In the foreground, with a timeout of at least 600000 ms; a red file is re-run alone before it is called a break (CLAUDE.md's load flakes):

```bash
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts
cd server && ./node_modules/.bin/vitest run test/citations.test.ts
cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts
cd server && ./node_modules/.bin/vitest run test/dtbd.test.ts
cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'expandEntryBody'
```

Expected: green. `single-definition` runs whole, because its O14 corpus scans `deploy/`: this section declares no `VOCABS` name and no second `FACT_KINDS` or `LABELS`. `dtbd`: the departure is cited by its issued number. `history-recall -t 'expandEntryBody'`: the W2-1 export this task reads is unchanged; if the filter selects nothing, run the file whole.

*Measured over predicted (Task 3, U17):* Steps 3 and 5 measured as predicted (25 failed and 45 passed red, the two Task 1 reds the import CONTROL's "the counter itself" line and the import pin; 70 passed green). Every mutant M1 to M20 measured red on the predicted cases (M3, M6, M10 and M14 two failures each, the rest one). The whole-file run measured 1201 passed and one failure, W2-5b1's D-6482 spawn-timing case, which passed alone (2 passed); the task report records a later whole-file run. `typecheck-tests` 12 passed and `deviation-refs` 31 passed. No prediction needed correcting.

*Fix round 1 (review 963 F1, F6; U17):* `combine`'s comment promised that a node report's row or answer off Task 1's shapes is refused, never folded, and `combineRow` checked only the arm, producer, flags and state, and `answerOf` any non-null measured value. A one-node report with a measured row `turns: null, recall_calls: '7', echo_hits {unreadable: {}}, rediscovery {}, lag {lag_ms: 'x'}, attachments_unread: 'q'` was folded to turns 0, recall_calls "07", NaN sums and `lag_ms: ["x"]`. Now `combineRow` refuses (`counters-shape`) a measured row whose `turns` or `recall_calls` is no non-negative safe integer and an unmeasured row whose is not `null`, and `answerOf` takes the counter spec's new optional `answer` (the shape of the value its measure writes: its keys, and non-negative integers where it writes integers, echo_hits' `gap` a safe integer of either sign; compliance a string; card verdicts `served`, `mismatch` or `none`) and refuses a measured value that fails it; a stand-in spec that states none is not checked. The shapes are read from `echoAt`, `lagAt`, `cardVerdictOf`, `rediscoveryVerdict` and `complianceAt`; `foldCardFor` now derives its verdict keys from the same `CARD_VERDICT_WORDS`. Nine cases were added (a CONTROL that every real spec states an `answer`; `turns`; `recall_calls`; and one per counter's answer, six; each first checks that the shaped nodes fold); on the unmodified counter all nine measured red, and green after (the combine describe 12 passed, the whole Task 1 to 4 filter 87). M21 to M33 measured red as the table says, each restored byte for byte (`cmp` clean). The row's `store_id` against its node report's stays a named residual. F6: `combineCommand`'s comment now names `writeReport`'s write-failure exception, as `countCommand`'s does.

*Fix round 2 (review 965 F1, F2, F3, F4, F5, F7; U17):* four cases and no behaviour beyond the rulings. F1: lib and recall.mjs export no vocabulary of `expandEntryBody`'s body states (they are literals in `expandEntryBody`; the driver spells its own tables), so ruling (a), refusing an `unreadable` key outside the words `echoAt` can write, was skipped as the ruling allows; `echoValueOk` and the combine comment name the width (free keys accepted), and (b), Task 2's `foldEcho` summing into `Object.create(null)`, makes every accepted key a number. A combine-level case (`__proto__` and `constructor` keys on both nodes' control windows, summed 6 and 6 beside `tombstone` 2) was green on arrival, after Task 2's fix; Task 2's M35 reds it too (the Task 1 to 4 filter then shows 2 failed). F2: `combineRow` refuses a row whose `ab_state` is no `AB_STATES` word and a row whose `unrealised` is not exactly `ab_state !== AB_OK` (`control-absent` with `unrealised: false`, the review's row, folded into the treatment stratum before); both cases measured red on the unmodified `combineRow` and green after; the comment names `ts_ms`, `family`, `boundary_uuid`, `ccrc_id`, `generation`, extra fields and `store_id` as unchecked. F3: one CONTROL runs the five real measures over the Task 2 stores (echo, card, wait) and rediscovery over the Task 3 stories, and holds each measured value to its spec's `answer` (every counter measured at least once); it was green on arrival, as the review's reproduce lens predicted, and M36 reds it. count's output is unchanged for every key `echoAt` writes; its code path is not, because `foldEcho` is on it and changed under F1(b) (review 966 F3). F5: `combineCommand`'s comment also names `prepareOut`'s own `createOut` (D-5986). F7: the error text reads `an unmeasured row's`, and the two cases' patterns pin `(a measured|an unmeasured)` (red on the old text, 2 failed); the sentence above counts nine cases, the shaped-nodes fold being a check inside each. M34 to M36 each measured red, 1 failed, restored byte for byte (`cmp` clean). `-t 'W2-6 Task 3: combine'` 16 passed, `-t 'W2-6 Task'` 92 passed.

- [ ] **Step 8: Commit.**

```bash
git status --short   # deploy/history-counters.mjs and server/test/history-replay.test.ts, plus the plan if U17 applied
git add deploy/history-counters.mjs server/test/history-replay.test.ts
git diff --quiet -- docs/superpowers/plans/2026-10-22-ccrc-history-w2-6-counters.md || git add docs/superpowers/plans/2026-10-22-ccrc-history-w2-6-counters.md   # U17 only
CO_AUTHORED_BY='<the Co-Authored-By line the attribution reminder gives>'
git commit -m "feat(history-counters): re-discovery, and combine over the nodes' reports (W2-6 Task 3; W2-D86, W2-D88; D-6561)" -m "$CO_AUTHORED_BY"
```

### Task 4: README's counters paragraph, erratum E25 in place, the `turnsOf` callers pin, the Q29 disjointness, the whole-PR checks and the PR

Tasks 1 to 3 ship `deploy/history-counters.mjs` and its pins in `history-replay.test.ts`. This task ships W2-6's two prose edits and their pins, the single-definition pin, then measures what the PR holds against what W2-6 may hold, runs the whole-PR checks, writes the PR body and opens the PR:
- **README** gains one paragraph of W2-6's own, `**The W2 counters.**`, at the anchor this task names (U14): between the card-line paragraph and the box-verbs paragraph of "Session history: lossless recall", a gap W2-5b2's driver paragraph keeps off (U15). It names the entry and its rules, never the argv (U13): among them the four verify states that drop a family (V1) and, as operator guidance, the re-run of `verify --section ab` after a mid-window amendment of part 2 (V4). On the dispatch base W2-2b's headless-seam paragraph already follows the box verbs (V5); W2-6's gap lies above it and is unmoved.
- **The spec's erratum E25** (decisions §6: §10.2's counters, "Decided by W2-6, Amended by W2-6") is amended in place: the two "The live A/B" bullets for re-discovery and the five spec counters, each replaced by one line citing W2-6, its number and the signed defaults (U14): re-discovery cites D-6561 and states both sides made absolute against the epoch's cwd (U11); the five cite D-6562 and name the four verify states that drop a family (V1). No other row of §6 names W2-6.
- **`single-definition.test.ts`** gains the pin that `turnsOf` is declared in the gate alone and named by the gate and the counter alone, the counter calling it on one code line (W2-D86, U12). It lands here, after Task 1's `windowCtx` made the counter a caller, so every commit is green.
- two describes inserted in W2-6's region pin both prose edits, with a mutant list;
- the **Q29 disjointness** is measured, hunk by hunk, on README, the spec and both test files;
- then the whole-PR checks, the PR body, the private-name scans over it, the PR (titled **"ccrc history wave W2-6: the report-only counters"**) and its review threads.

**Decisions:** W2-D86 (re-discovery's unit; the `turnsOf` callers pin), W2-D87 (the five counters, their sources, signed defaults `counters_def: 'v1'`), W2-D88 (a standalone entry, run after window end, report-only), W2-D15, W2-D3 (W2-6 holds the spec path and amends its own erratum; the peer protocol), W2-D4 (no number defined twice; `deviation-refs`), W2-D5 (no new test file), W2-D6 (rollout only with W2's final release), Q29 and U12 to U16; V1 (README and E25 name the four dropped states), V4 (README's operator guidance: re-run `verify --section ab` after a mid-window amendment) and V5 (the anchors re-measured against W2-2b's text; W2-5b2's README slot after W2-2b's seam paragraph). It cites D-6561 and D-6562 (defined in "Deviations found", first cited by Tasks 3 and 2), D-5770, D-5771, D-5774 and D-5893.

**Not this task's, never touched here:** W2-5b2's subcommands, its README driver paragraph and its errata (E2, E7 to E11 and E19 to E24); the box-verbs paragraph, which holds `recall-off`'s README text (W2-1's); README's Architecture list; every other spec line; the ledger and the decisions document (U15's carry and U16's wording are the coordinator's); `deploy/history-gate.mjs`, `deploy/history-replay.mjs`, `deploy/measure-history.py`, `ccd/**`, `shared/**`, `.github/**`; and every operator act in decisions §5.

**Files:** anchors measured at `4f560398c`, README's and `single-definition.test.ts`'s re-measured at `42c9aaf24`, W2-2b's text (V5), hints only; each is re-anchored by its quoted content, and a moved anchor is reported as a drift.
- Modify:
  - `README.md`: insert one paragraph between `line its room, and the sweep counts from each transcript whether the line arrived and named its leaf.` (about :5839) and `**Box verbs and operator verbs.** `ccrc history status` reports the store, its lag, size, cap, free` (about :5841), the same lines at `4f560398c` and `42c9aaf24`; W2-2b's seam paragraph (about :5868 to :5896 at `42c9aaf24`) and the section's `---` (about :5898) lie below, untouched (Step 2).
  - `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md`: replace the two bullets (about :2741 and :2742; the decisions document's E25 cites them as §10.2:2729-2730, written at `bd363a76b`) (Step 3).
  - `server/test/history-replay.test.ts`: two describes directly above W2-6's region marker (Step 1).
  - `server/test/single-definition.test.ts`: one describe appended after the file's last line, the `});` closing W2-2b's appended describe on the dispatch base (about :8566 at `42c9aaf24`; Step 5).
- Read, no edit: `deploy/history-gate.mjs` (`COUNTERS_DEF_V1`); `deploy/history-replay.mjs` (`AB_STATES`, read through Task 1's `w6cDrv`); `server/test/history-cli.test.ts` (the case `README states the verb, its flag and its refusal words`, the precedent for a README pin, and W2-2b's describe `README states the headless seam: …`, which reads the Session history section from its heading to its `---` and the seam paragraph by its lead, so it must stay green with W2-6's paragraph above the box verbs); `server/test/history-skill.test.ts` (the describe `README states grep's reach, …`, whose "exactly once" pins the paragraph must not disturb); `server/test/history-lib.test.ts` (`no false positive: 1 MiB of prose, …`, which reads README whole); `server/test/growth-check.test.ts` (`GROWTH_FILES`); `server/test/citations.test.ts`; `server/test/dtbd.test.ts`; the decisions document's §6 and §7; this plan's "Deviations found".
- Create (gitignored scratch, never committed): `.superpowers/sdd/history-w2-6/t4-mutate.mjs`, `.superpowers/sdd/history-w2-6/t4-dnum.mjs`, `.superpowers/sdd/history-w2-6/t4-imports.mjs`, `.superpowers/sdd/history-w2-6/pr-body.md`, and copies under `.superpowers/sdd/history-w2-6/scratch/`.

**Interfaces:**
- Consumes: `COUNTERS_DEF_V1` (through Task 1's `W6C_NAMES`), the driver's `AB_STATES` (through Task 1's `w6cDrv`, V1), and Task 1's region bindings `w6cFs`, `w6cPath`, `W6C_REPO`, `w6cDescribe`, `w6cIt`, `w6cExpect`; `single-definition.test.ts`'s own `ALL_MJS`, `stallCode`, `stallCodeText`, `rel` and `ccrcRoot`.
- Produces:
  - README: one paragraph whose first line starts `**The W2 counters.**`, once in the file.
  - The spec: one line starting ``- re-discovery (W2-6, D-6561; signed defaults, `counters_def: 'v1'`): per window, `` and, on the next line, one starting ``- compliance, echo hits, lag, `card_served` and `card_id_mismatch` (W2-6, D-6562; signed defaults, `counters_def: 'v1'`), ``.
  - `history-replay.test.ts`: the module-scope helpers `w6cParagraph(text, lead): string | null` and `w6cLeadCount(text, lead): number`, the constants `W6C_T4_LEAD`, `W6C_T4_SPEC`, and the describes `W2-6 Task 4: README states the report-only counters once, in their own paragraph (W2-D86, W2-D87, W2-D88; U13, V1, V4)` (4 cases) and `W2-6 Task 4: spec erratum E25, amended in place in the live A/B list (W2-D86, W2-D87; D-6561, D-6562; U11, U14, V1)` (4 cases).
  - `single-definition.test.ts`: the describe `ccrc history W2-6 Task 4: turnsOf is declared in the gate alone, and the gate and the counter are its only callers (W2-D86, U12)`, 4 cases.
  - The PR body file, the PR, and the measured summary lines the body carries.

**Choices this task makes:**
- **README gets a paragraph, not a line** (U14, U16): its anchor can then be named apart from W2-5b2's driver paragraph. It names no flag (U13).
- **The paragraph sits before the box verbs.** It follows the card-line paragraph, whose last sentence is the sweep's card measure that `card_served` and `card_id_mismatch` reuse, and refers forward to `recall-off` ("the `recall-off` arm, below") without restating it. W2-2b's seam paragraph, already on the dispatch base, sits after the box verbs, so the two new paragraphs of this section are separated by the whole box-verbs paragraph and neither moves the other's anchor (V5).
- **E25 changes two lines and leaves the stratification bullet.** The bullet after them already says what W2-D15 rules and is a Q29 buffer line; "by arm" is written into the two replaced lines.
- **The citation form is the spec's own** (`(W2-1, D-5763)`), with the signed defaults beside it.
- **The prose pins read only W2-6's own lines**, so W2-5b2's errata and driver paragraph cannot red them; placement is a merge-time property Step 6 measures.
- **No `§` in the test file:** test strings stay ASCII.
- **One commit** for the pins, README, the spec and the single-definition pin, so the suite is green at it.

**Live safety.** The new describes read three tracked files; they spawn nothing and open no store. No step reads `~/.ccrc`, `~/.cc-sessions`, `~/.cc-limits` or any account home, or runs `claude`, `ccd`, a `ccrc` verb, the shim, `sweep.mjs`, `cli.mjs`, the counter, the driver, the gate or `measure-history.py` outside a suite. Every mutant is applied in place and restored byte for byte (`cmp`) before the next step; nothing uses `git stash`.

- [ ] **Step 0: Check the base, W2-5b1, Tasks 1 to 3, and the tree.** From the repository root:

```bash
git fetch origin main
git merge-base --is-ancestor 4f560398c HEAD && echo 'base holds W2-5a and the W2-5b1 plan' || echo 'STOP: 4f560398c is not on this base'
W5B1=$(git log --format=%H -1 --grep='^ccrc history wave W2-5b1' origin/main)
test -n "$W5B1" && git merge-base --is-ancestor "$W5B1" HEAD && echo 'base holds W2-5b1' || echo 'STOP: W2-5b1 is not merged under this branch'
git log --format='%h %s' -1 "$W5B1"
PLAN=docs/superpowers/plans/2026-10-22-ccrc-history-w2-6-counters.md
git cat-file -e "origin/main:$PLAN" && echo 'plan on main' || echo 'STOP: the plan is not on main'
grep -c "^export function combineCommand(flags) {$" deploy/history-counters.mjs
grep -c "^  rediscovery: REDISCOVERY,$" deploy/history-counters.mjs
grep -c "^\*\*The headless seam (W2's replay eval)\.\*\*" README.md
awk '/^\*\*Box verbs and operator verbs\.\*\*/ {b = NR} /^\*\*The headless seam \(W2/ {h = NR} /^---$/ && h && !r {r = NR} END {print (b < h && h < r) ? "seam after the box verbs, before the rule" : "STOP: README map moved"}' README.md
git status --short | wc -l
MB=$(git merge-base origin/main HEAD)
git diff --name-only "$MB" origin/main | grep -xF -f <(git diff --name-only "$MB" HEAD) || echo 'main moved no path of this PR'
```

Expected: `base holds W2-5a and the W2-5b1 plan`; `base holds W2-5b1`, then W2-5b1's squash subject, whose number the PR body names; `plan on main`; `1`, `1` (Tasks 1 to 3 landed); `1` and `seam after the box verbs, before the rule` (V5: W2-2b's paragraph sits after the box-verbs paragraph on this base, as the header's Base paragraph and Q29 table state; W2-5b1 merged after W2-2b); `0`; `main moved no path of this PR`. A `0` for the seam paragraph, or `STOP: README map moved`, means README's map differs from the one this plan measured at `42c9aaf24`: report it before any edit. A listed path is W2-5b2's edit of a shared file: merge `origin/main` (never a rebase), keep both sides as the header's Q29 table says, and run Steps 1 to 13 on the merge, every anchor re-measured by content. On any `STOP`, report to the coordinator and run nothing else.

- [ ] **Step 1: Write the prose pins (red-first).** Directly above W2-6's region marker in `server/test/history-replay.test.ts`:

```ts
// ── W2-6 Task 4: README's counters paragraph and spec erratum E25 (W2-D86, W2-D87, W2-D88; decisions section 6) ─────
// Prose pins over two tracked files, as W2-1's README case in history-cli.test.ts reads its own. Each reads only W2-6's
// own lines: the README paragraph by its lead, the two spec bullets by their heads, never a neighbour, so W2-5b2's errata
// and driver paragraph cannot red them (Q29). The counter names come from the gate's COUNTERS_DEF_V1 (W6C_NAMES).
const W6C_T4_LEAD = '**The W2 counters.**';
const W6C_T4_SPEC = 'docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md';
const W6C_T4_CITE = "signed defaults, `counters_def: 'v1'`)";
/** The paragraph whose first line starts with `lead`, to the next blank line, whitespace collapsed; null when no line
 *  starts with it. */
function w6cParagraph(text: string, lead: string): string | null {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => l.startsWith(lead));
  if (i < 0) return null;
  let j = i;
  while (j < lines.length && lines[j]!.trim() !== '') j += 1;
  return lines.slice(i, j).join(' ').replace(/\s+/g, ' ');
}
/** How many lines start with `lead`. */
const w6cLeadCount = (text: string, lead: string): number => text.split('\n').filter((l) => l.startsWith(lead)).length;

w6cDescribe('W2-6 Task 4: README states the report-only counters once, in their own paragraph (W2-D86, W2-D87, W2-D88; U13, V1, V4)', () => {
  const readme = w6cFs.readFileSync(w6cPath.join(W6C_REPO, 'README.md'), 'utf8');

  w6cIt('CONTROL: the reader takes one paragraph to its blank line, answers null without the lead, and counts line starts only', () => {
    w6cExpect(w6cParagraph(`a\n\n${W6C_T4_LEAD} one\ntwo\n\n**Next.** three`, W6C_T4_LEAD)).toBe(`${W6C_T4_LEAD} one two`);
    w6cExpect(w6cParagraph('a\n\n**Other.** one', W6C_T4_LEAD)).toBeNull();
    w6cExpect(w6cLeadCount(`${W6C_T4_LEAD} a\n\n${W6C_T4_LEAD} b\nx ${W6C_T4_LEAD}`, W6C_T4_LEAD)).toBe(2);
  });

  w6cIt('the paragraph is opened once', () => {
    w6cExpect(w6cLeadCount(readme, W6C_T4_LEAD)).toBe(1);
  });

  w6cIt('it names the entry, the signed definitions and every counter COUNTERS_DEF_V1 freezes, and no flag (U13)', () => {
    const p = w6cParagraph(readme, W6C_T4_LEAD);
    w6cExpect(p, 'the paragraph').not.toBeNull();
    for (const n of W6C_NAMES) w6cExpect(p, n).toContain(`\`${n}\``);
    for (const s of ['`deploy/history-counters.mjs`', '`COUNTERS_DEF_V1`', '`counters_def`', '`openReader`', '`verify --section ab`']) w6cExpect(p, s).toContain(s);
    for (const f of ['--record', '--measure', '--verify-ab', '--store', '--out', '--node-report', '--allow-code-change']) {
      w6cExpect(p, `${f}: the module's usage text is the one spelling of its argv`).not.toContain(f);
    }
  });

  w6cIt('it states the report-only rules: never the gate, never the counters table, unmeasured never 0, a gap never repaired, both drops with every dropped state (V1), the verify re-run (V4), its own sha', () => {
    const p = w6cParagraph(readme, W6C_T4_LEAD) ?? '';
    for (const s of [
      'never feed the gate',
      'never reads the node-wide `counters` table',
      '`unmeasured`, never 0',
      'is reported, never repaired',
      'reported and never compared',
      'is anything but `ok`',
      'dropped from the arm comparison only',
      'tallied apart by arm and by producer',
      'has seen the newest recall-off write',
      're-runs `verify --section ab` on each node before counting',
      'names its own sha256',
      'after the window ends',
      'sums the nodes\' reports',
    ]) w6cExpect(p, s).toContain(s);
    for (const st of (w6cDrv.AB_STATES as string[]).slice(1)) w6cExpect(p, `the dropped state ${st} (V1)`).toContain(`\`${st}\``);
  });
});

w6cDescribe('W2-6 Task 4: spec erratum E25, amended in place in the live A/B list (W2-D86, W2-D87; D-6561, D-6562; U11, U14, V1)', () => {
  const lines = w6cFs.readFileSync(w6cPath.join(W6C_REPO, W6C_T4_SPEC), 'utf8').split('\n');
  const A_HEAD = `- re-discovery (W2-6, D-6561; ${W6C_T4_CITE}: per window, `;
  const B_HEAD = `- compliance, echo hits, lag, \`card_served\` and \`card_id_mismatch\` (W2-6, D-6562; ${W6C_T4_CITE}, `;
  const OLD = [
    '- re-discovery: the same file re-read within 10 assistant turns of a compaction (*chosen*);',
    '- compliance, echo hits, lag, `card_served`, `card_id_mismatch`;',
  ];
  const at = (head: string): number[] => lines.flatMap((l, i) => (l.startsWith(head) ? [i] : []));

  w6cIt('the two rev 3.6 bullets are gone', () => {
    for (const o of OLD) w6cExpect(lines.filter((l) => l === o).length, o).toBe(0);
  });

  w6cIt('each new bullet is one line, there once, the two adjacent, inside "The live A/B" before "What the analysis counts"', () => {
    const a = at(A_HEAD);
    const b = at(B_HEAD);
    w6cExpect(a.length, 'the re-discovery line').toBe(1);
    w6cExpect(b.length, 'the five counters line').toBe(1);
    w6cExpect(b[0], 'the five counters follow re-discovery').toBe(a[0]! + 1);
    const ab = lines.findIndex((l) => l.startsWith('**The live A/B.**'));
    const counts = lines.findIndex((l) => l.startsWith('- **What the analysis counts**'));
    w6cExpect(ab, 'the live A/B paragraph').toBeGreaterThan(-1);
    w6cExpect(a[0]!).toBeGreaterThan(ab);
    w6cExpect(b[0]!).toBeLessThan(counts);
  });

  w6cIt('re-discovery states its unit: turns 1 to 10, a Read against the five tools, notebook_path, both sides made absolute, by arm and producer, Bash not counted (D-6561, U11)', () => {
    const l = lines[at(A_HEAD)[0] ?? -1] ?? '';
    for (const s of [
      "the window's turns 1 to 10",
      "made absolute against the epoch's cwd",
      'a Read, Edit, MultiEdit, Write or NotebookEdit `tool_use`',
      "in leaf N's span, also made absolute",
      "`NotebookEdit`'s `notebook_path`",
      'an indicator and a distinct-path count',
      'by arm and by producer',
      'is not counted',
    ]) w6cExpect(l, s).toContain(s);
  });

  w6cIt('the five counters name their sources, per window by arm and producer, both drops with every dropped state, and none of them feeds the gate (D-6562, V1)', () => {
    const l = lines[at(B_HEAD)[0] ?? -1] ?? '';
    for (const s of [
      'each per window of a listed family, by arm and by producer',
      'none read from the node-wide `counters` table',
      '`nodes.status` (`PARSE_STATUS`)',
      '`recall-echo` rows',
      'beside the window\'s `recall_calls` count',
      'never repaired',
      '`unmeasured` when there is none',
      '`decideCardDelivery`',
      '`CARD_MEASURE_ROWS`',
      'never compared',
      '`verify --section ab`',
      'is anything but `ok`',
      'dropped from the arm comparison only',
      'tallied apart by arm and by producer',
      '`deploy/history-counters.mjs`',
      'none of them feeds the gate',
    ]) w6cExpect(l, s).toContain(s);
    for (const st of (w6cDrv.AB_STATES as string[]).slice(1)) w6cExpect(l, `the dropped state ${st} (V1)`).toContain(`\`${st}\``);
  });
});
```

Run, in the foreground, with a timeout of at least 600000 ms:

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-6 Task 4'
```

Predicted (written before the run): `7 failed | 1 passed` among the selected:
- passes: the CONTROL;
- `the paragraph is opened once`: `expected 0 to be 1`;
- `it names the entry …`: `the paragraph: expected null not to be null`;
- `it states the report-only rules …`: `never feed the gate: expected '' to contain 'never feed the gate'`;
- `the two rev 3.6 bullets are gone`: the first old bullet, `expected 1 to be 0`;
- `each new bullet is one line …`: `the re-discovery line: expected 0 to be 1`;
- the two content cases: `expected '' to contain "the window's turns 1 to 10"` and `expected '' to contain 'each per window of a listed family, by arm and by producer'`.

A red at the CONTROL is the reader's to fix, never a reason to edit the pins.

- [ ] **Step 2: Write README's paragraph.** With the Edit tool, in `README.md`, replace

```markdown
line its room, and the sweep counts from each transcript whether the line arrived and named its leaf.

**Box verbs and operator verbs.** `ccrc history status` reports the store, its lag, size, cap, free
```

with

```markdown
line its room, and the sweep counts from each transcript whether the line arrived and named its leaf.

**The W2 counters.** W2's replay eval decides its gate from its quiz and from live uptake alone. Beside
them, `deploy/history-counters.mjs` reports six counters that never feed the gate: `compliance`,
`echo_hits`, `lag`, `card_served`, `card_id_mismatch` and `rediscovery`. Each is counted per
post-compaction window of a family on the eval's list, by arm and by the producer of the window's boundary,
under the definitions part 1 of the open record signs (`counters_def` `v1`, the text frozen as
`COUNTERS_DEF_V1` in `deploy/history-gate.mjs`). It builds each window with the gate's own turn and window
rules over `measure-history.py`'s raw rows, reads the node's store only through `store.mjs`'s `openReader`,
and never reads the node-wide `counters` table. A value it cannot measure is `unmeasured`, never 0. A gap
between two measures, such as echo hits against the window's `recall_calls` count, is reported, never
repaired. A control window (the `recall-off` arm, below) carries no card line, so its card figures are
reported and never compared. A family whose recall-off file changed during the window, or whose state in
its node's `verify --section ab` output is anything but `ok` (`control-absent`, `control-mismatch`,
`treatment-named` or `unreadable`, each listed apart), is dropped from the arm comparison only and tallied
apart by arm and by producer. That verify output must name the part 2 being counted and show that the
presence record has seen the newest recall-off write, or the run is refused: when part 2 is amended during
the window, the operator re-runs `verify --section ab` on each node before counting. The replay driver
does not import the counter and the open record pins no hash of it, so each report names its own sha256.
It ships in the release part 1 pins; the operator runs it on each named node after the window ends, then
sums the nodes' reports into one comparison.

**Box verbs and operator verbs.** `ccrc history status` reports the store, its lag, size, cap, free
```

The `old_string` is unique (the card-line paragraph's last line occurs once). Nothing else in README changes: W2-2b's seam paragraph, below the box verbs on this base, is left as it is (V5). The paragraph is 19 lines. It states no line count of README, no host, account or path, no flag, and none of the strings the history-skill and history-cli README pins count "exactly once" (W2-2b's seam describe counts its own lead, `**The headless seam`, which this paragraph does not contain). It names the four dropped verify states (V1) and, as operator guidance, the re-run of `verify --section ab` after a mid-window amendment (V4). The phrases `the operator re-runs` and `` `treatment-named` `` each sit on one line, where mutants M11 and M12 find them.

- [ ] **Step 3: Amend erratum E25 in place, and check the departures.** With the Edit tool, in `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md`, replace the two lines

```markdown
- re-discovery: the same file re-read within 10 assistant turns of a compaction (*chosen*);
- compliance, echo hits, lag, `card_served`, `card_id_mismatch`;
```

with these two lines, each one line in the file:

```markdown
- re-discovery (W2-6, D-6561; signed defaults, `counters_def: 'v1'`): per window, a Read `tool_use` in the window's turns 1 to 10 (the turns of the W2 window statistic, below) whose path, made absolute against the epoch's cwd, is the path of a Read, Edit, MultiEdit, Write or NotebookEdit `tool_use` in leaf N's span, also made absolute (each tool's `file_path`, and `NotebookEdit`'s `notebook_path`), reported as an indicator and a distinct-path count, by arm and by producer. A Bash read of a file (`cat`, `sed`, `rg`) is not counted;
- compliance, echo hits, lag, `card_served` and `card_id_mismatch` (W2-6, D-6562; signed defaults, `counters_def: 'v1'`), each per window of a listed family, by arm and by producer, its source named, and none read from the node-wide `counters` table: compliance is the `nodes.status` (`PARSE_STATUS`) of the leaf whose boundary opens the window, with its `ok` plus `degraded` share (`not-requested` throughout is the expected value, and W3's baseline); echo hits are the window copy's `recall-echo` rows (§6.2) whose `tool_result` is not an error, beside the window's `recall_calls` count, a gap between the two reported and never repaired; lag is the `lag_ms` of the newest `ticks` row at or before the boundary's `ts_ms` that has a measured lag, `unmeasured` when there is none; `card_served` and `card_id_mismatch` are the sweep's own card decisions (§8.6: `decideCardDelivery` over the first `CARD_MEASURE_ROWS` rows after the boundary in `pickHoldingCopy`'s copy), and a control window, which carries no card line by design, is reported and never compared. A family whose recall-off file changed in the window, or whose `verify --section ab` state is anything but `ok` (`control-absent`, `control-mismatch`, `treatment-named` or `unreadable`, each listed apart), is dropped from the arm comparison only and tallied apart by arm and by producer. `deploy/history-counters.mjs` computes all six after window end, reading the store only through `openReader`, and none of them feeds the gate;
```

The bullet before them (uptake) and the bullet after them (``- every counter stratified by the producer of the window's boundary (§6.2). …``) are unchanged: each is a Q29 buffer line. The spec's status line (rev 3.6) is not changed: W2-1 amended its errata in place under the same status, and W2-6 does likewise (W2-D3).

Then the departures. Write the checker as a quoted heredoc, so nothing in it expands:

```bash
mkdir -p .superpowers/sdd/history-w2-6/scratch
cat > .superpowers/sdd/history-w2-6/t4-dnum.mjs <<'EOF'
// Reads one plan file and the W2 decisions document; prints every number the plan defines in `## Deviations found`,
// how often it is defined, the first `### Task` section that cites it, and whether the decisions document names it.
// Reads only argv[2] and argv[3]; prints names and counts only.
import { readFileSync } from 'node:fs';
const [planPath, decPath] = process.argv.slice(2);
const t = readFileSync(planPath, 'utf8');
const dec = readFileSync(decPath, 'utf8');
const dev = t.indexOf('\n## Deviations found');
const body = dev < 0 ? t : t.slice(0, dev);
const tail = dev < 0 ? '' : t.slice(dev);
const defs = [...tail.matchAll(/^- \*\*(D-\d+)\*\* — /gm)].map((m) => m[1]);
const sections = body.split(/\n(?=### Task \d+:)/).filter((p) => /^### Task \d+:/.test(p));
console.log('plan-defines', defs.length);
for (const d of new Set(defs)) {
  const re = new RegExp(`\\b${d}\\b`);
  const first = sections.find((p) => re.test(p));
  console.log(d, 'defined', defs.filter((x) => x === d).length,
    'first-citing', first ? first.match(/^### Task (\d+):/)[1] : 'none', 'in-decisions', re.test(dec) ? 1 : 0);
}
EOF
PLAN=docs/superpowers/plans/2026-10-22-ccrc-history-w2-6-counters.md
DEC=docs/superpowers/plans/2026-10-19-ccrc-history-w2-decisions.md
node .superpowers/sdd/history-w2-6/t4-dnum.mjs "$PLAN" "$DEC" | tee .superpowers/sdd/history-w2-6/scratch/dnum.txt
N=0; ENTRY="- **D-$N** — \`control\` (Task 4; control)"
printf '%s\n%s\n' "$ENTRY" "$ENTRY" | cat "$PLAN" - > .superpowers/sdd/history-w2-6/scratch/plan-control.md
node .superpowers/sdd/history-w2-6/t4-dnum.mjs .superpowers/sdd/history-w2-6/scratch/plan-control.md "$DEC" | grep -c 'defined 2'
grep -E '^D-[0-9]+ ' .superpowers/sdd/history-w2-6/scratch/dnum.txt | cut -d' ' -f1 > .superpowers/sdd/history-w2-6/scratch/defined.txt
while read -r d; do printf '%s %s\n' "$d" "$(git grep -l -F -e "- **$d** — " origin/main -- docs/superpowers/plans | grep -vcxF "origin/main:$PLAN")"; done < .superpowers/sdd/history-w2-6/scratch/defined.txt
grep -F '| E25 |' "$DEC" | grep -c '— (signed defaults)'
```

Expected:
- `plan-defines 2`, then `D-6561 defined 1 first-citing 3 in-decisions 0` and `D-6562 defined 1 first-citing 2 in-decisions 0` (with a line more per number issued during the build, each `defined 1`);
- `1`: the CONTROL (a scratch copy whose synthetic entry is built at run time and appended twice) reads `defined 2`;
- `D-6561 0` and `D-6562 0`: no other plan on `origin/main` defines either (the loop reads the numbers from the checker's output, never a range);
- `1`: E25's D column is "— (signed defaults)": its in-place lines cite the plan's departures, not a decisions-document number.

A number defined twice, defined elsewhere, or named by the decisions document is a finding for the coordinator, never something to renumber here.

- [ ] **Step 4: Run the prose pins green, then their mutants.** Run:

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-6 Task 4'
```

Expected: the 8 selected cases pass. Then save the two files and write the mutator as a quoted heredoc:

```bash
cp README.md .superpowers/sdd/history-w2-6/scratch/README.md.orig
cp docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md .superpowers/sdd/history-w2-6/scratch/spec.md.orig
cat > .superpowers/sdd/history-w2-6/t4-mutate.mjs <<'EOF'
// Applies one named mutant of Task 4's list in place to README.md or the spec; exits 3 when it does not apply.
// Usage, from the repository root: node .superpowers/sdd/history-w2-6/t4-mutate.mjs <M1..M13>
import { readFileSync, writeFileSync } from 'node:fs';
const SPEC = 'docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md';
const LEAD = '**The W2 counters.**';
const CITE = "signed defaults, `counters_def: 'v1'`)";
const A = `- re-discovery (W2-6, D-6561; ${CITE}: per window, `;
const B = `- compliance, echo hits, lag, \`card_served\` and \`card_id_mismatch\` (W2-6, D-6562; ${CITE}, `;
const edit = (file, fn) => {
  const t = readFileSync(file, 'utf8');
  const u = fn(t);
  if (u === t) { console.error('mutant did not apply'); process.exit(3); }
  writeFileSync(file, u);
};
const para = (t) => {
  const ls = t.split('\n');
  const i = ls.findIndex((l) => l.startsWith(LEAD));
  let j = i;
  while (i >= 0 && j < ls.length && ls[j].trim() !== '') j += 1;
  return { ls, i, j };
};
const head = (ls, h) => ls.findIndex((l) => l.startsWith(h));
/** One spec line, found by its head, edited by `fn`. */
const onLine = (h, fn) => edit(SPEC, (t) => { const ls = t.split('\n'); const k = head(ls, h); if (k < 0) return t; ls[k] = fn(ls[k]); return ls.join('\n'); });
const M = {
  M1: () => edit('README.md', (t) => { const { ls, i, j } = para(t); if (i < 0) return t; ls.splice(i, j - i + 1); return ls.join('\n'); }),
  M2: () => edit('README.md', (t) => { const { ls, i, j } = para(t); if (i < 0) return t; ls.splice(j + 1, 0, ...ls.slice(i, j + 1)); return ls.join('\n'); }),
  M3: () => edit('README.md', (t) => { const { ls, i, j } = para(t); if (i < 0) return t; for (let k = i; k < j; k += 1) ls[k] = ls[k].replace('`rediscovery`', 're-discovery'); return ls.join('\n'); }),
  M4: () => edit('README.md', (t) => t.replace('never feed the gate', 'do not feed the gate')),
  M5: () => onLine(A, () => '- re-discovery: the same file re-read within 10 assistant turns of a compaction (*chosen*);'),
  M6: () => onLine(A, (l) => l.replace('Read, Edit, MultiEdit, Write or NotebookEdit', 'Read, Edit, MultiEdit or Write')),
  M7: () => onLine(B, (l) => l.replace(B, '- compliance, echo hits, lag, `card_served` and `card_id_mismatch`, ')),
  M8: () => onLine(B, (l) => l.replace(', a gap between the two reported and never repaired', '')),
  M9: () => edit(SPEC, (t) => { const ls = t.split('\n'); const a = head(ls, A); const b = head(ls, B);
    if (a < 0 || b !== a + 1) return t; [ls[a], ls[b]] = [ls[b], ls[a]]; return ls.join('\n'); }),
  M10: () => onLine(A, (l) => l.replace("`NotebookEdit`'s `notebook_path`", "`NotebookEdit`'s `file_path`")),
  M11: () => edit('README.md', (t) => { const { ls, i, j } = para(t); if (i < 0) return t; for (let k = i; k < j; k += 1) ls[k] = ls[k].replace('`treatment-named`', 'a treatment file naming its generation'); return ls.join('\n'); }),
  M12: () => edit('README.md', (t) => t.replace('the operator re-runs `verify --section ab`', 'the operator may re-run `verify --section ab`')),
  M13: () => onLine(B, (l) => l.replace('`control-mismatch`, `treatment-named` or `unreadable`', '`control-mismatch` or `unreadable`')),
};
const m = M[process.argv[2]];
if (!m) { console.error('unknown mutant'); process.exit(2); }
m();
EOF
```

Then, for each mutant in turn, three tool calls: apply it, run the filter, restore and check. For M1:

```bash
node .superpowers/sdd/history-w2-6/t4-mutate.mjs M1 && echo applied
```
```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-6 Task 4'
```
```bash
cp .superpowers/sdd/history-w2-6/scratch/README.md.orig README.md && cmp .superpowers/sdd/history-w2-6/scratch/README.md.orig README.md && echo restored
cp .superpowers/sdd/history-w2-6/scratch/spec.md.orig docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md && cmp .superpowers/sdd/history-w2-6/scratch/spec.md.orig docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md && echo restored
```

The same three calls for M2 to M13. Each must print `applied`, then the predicted reds, then `restored` twice:

| Mutant | What it breaks | Predicted reds (of 8) |
|---|---|---|
| M1 | README's paragraph deleted | 3: `opened once` (`expected 0 to be 1`), `names the entry` (`expected null not to be null`), `report-only rules` (`never feed the gate`) |
| M2 | the paragraph doubled | 1: `opened once` (`expected 2 to be 1`) |
| M3 | `` `rediscovery` `` written `re-discovery` | 1: `names the entry`, message `rediscovery` |
| M4 | "never feed the gate" softened | 1: `report-only rules`, message `never feed the gate` |
| M5 | the rev 3.6 re-discovery bullet restored | 3: `rev 3.6 bullets are gone`, `one line, there once` (`the re-discovery line`), `re-discovery states its unit` |
| M6 | NotebookEdit dropped from the write tools | 1: `re-discovery states its unit`, message `a Read, Edit, MultiEdit, Write or NotebookEdit` |
| M7 | the five counters' citation dropped | 2: `one line, there once` (`the five counters line`), `the five counters name their sources` |
| M8 | "never repaired" dropped | 1: `the five counters name their sources`, message `never repaired` |
| M9 | the two bullets swapped | 1: `one line, there once` (`the five counters follow re-discovery`) |
| M10 | the signed text's `file_path` for NotebookEdit (D-6561) | 1: `re-discovery states its unit`, message `` `NotebookEdit`'s `notebook_path` `` |
| M11 | README's `treatment-named` dropped from the dropped states (V1) | 1: `report-only rules`, message `the dropped state treatment-named (V1)` |
| M12 | README's re-run guidance softened (V4) | 1: `report-only rules`, message ``re-runs `verify --section ab` on each node before counting`` |
| M13 | E25's `treatment-named` dropped from the dropped states (V1) | 1: `the five counters name their sources`, message `the dropped state treatment-named (V1)` |

A mutant that does not apply (exit 3) or a run that reds a different case is a finding against Step 1's pins: fix the pin, never the mutant. After M13, re-run the filter on the restored files: 8 passed.

- [ ] **Step 5: The `turnsOf` callers pin (W2-D86, U12).** First confirm its anchors, from the repository root:

```bash
tail -n 1 server/test/single-definition.test.ts
grep -n '^describe(' server/test/single-definition.test.ts | tail -n 1 | cut -c1-120
grep -c 'W2-6' server/test/single-definition.test.ts
grep -c "} from './history-gate.mjs';$" deploy/history-replay.mjs
grep -cE '\bturnsOf\s*\(' deploy/history-counters.mjs
```

Expected: `});`; the last describe's line with its line number, `8520:describe('ccrc history: the headless marker and the arm words are defined once, in lib.mjs, and read one way (W2-D4` at `42c9aaf24` (W2-2b's text; the number is a hint, and a line number other than 8520 before the same text is no drift); `0`, `1`, `1`. The last grep is the pin's own `CALLS_IT` pattern over the whole file, comments and strings included, so a second `turnsOf (` anywhere shows here before the pin reds. Two describes were appended after `4f560398c`'s last line (about :8496): #1165's, `codex bridge Stage 1 Task 5: …` (about :8503), then W2-2b's (V5, re-measured at `42c9aaf24`: 8,566 lines, the file's last line that describe's `});`). Append after the file's last line all the same, and report any other describe appended since as a drift. Then append one blank line and:

```ts
// W2-6 Task 4 (W2-D86, U12): turnsOf, the gate's turn rule, is declared once, in the gate, and only the gate and the
// report-only counter name it, the counter calling it on one code line (its windowCtx), so the driver builds no turns and
// no third turn rule exists under that name. Placed after this file's last describe, in the history area file, as D-6928's
// rule puts a history guard. The CCRC HISTORY block that defines ALL_MJS is helpers.ts's, not this file's; stallCode,
// stallCodeText and rel are defined above that block there, and stallCodeText was added to the existing ./helpers.js import
// line (no import line is added). KNOWN WIDTH: the pin matches the name turnsOf only, so a turn rule re-spelled under
// another name is out of its reach; a code line that names turnsOf after a trailing comment marker still counts; and a
// name assembled from pieces is not seen.
describe('ccrc history W2-6 Task 4: turnsOf is declared in the gate alone, and the gate and the counter are its only callers (W2-D86, U12)', () => {
  const DECLARES = /^\s*(?:export\s+)?(?:function\s+turnsOf\s*\(|(?:const|let|var)\s+turnsOf\s*=)/;
  const NAMES_IT = /\bturnsOf\b/;
  const CALLS_IT = /\bturnsOf\s*\(/;
  const lines = (f: string): string[] => stallCode(f).split('\n');
  const definers = (): string[] => ALL_MJS.filter((f) => lines(f).some((l) => DECLARES.test(l))).map(rel).sort();
  const namers = (): string[] => ALL_MJS.filter((f) => lines(f).some((l) => NAMES_IT.test(l) && !DECLARES.test(l))).map(rel).sort();
  const COUNTER = path.join(ccrcRoot, 'deploy', 'history-counters.mjs');

  it('CONTROL: the patterns see a declaration, a call, an import and a member read, and never a comment or a longer name', () => {
    expect(DECLARES.test('export function turnsOf(rows) {')).toBe(true);
    expect(DECLARES.test('const turnsOf = (rows) => rows;')).toBe(true);
    expect(DECLARES.test('  const turns = turnsOf(copy.rows);')).toBe(false);
    for (const l of ['  const turns = turnsOf(copy.rows);', "import { K, turnsOf } from './history-gate.mjs';", 'const t = g.turnsOf;']) expect(NAMES_IT.test(l), l).toBe(true);
    expect(NAMES_IT.test('const n = turnsOfCopy(c);')).toBe(false);
    expect(CALLS_IT.test('  const turns = turnsOf (copy.rows);')).toBe(true);
    expect(CALLS_IT.test("import { turnsOf } from './history-gate.mjs';")).toBe(false);
    expect(stallCodeText("// W2-6 imports turnsOf for its frame.\n *  deploy/history-gate.mjs's turnsOf imports it")).not.toMatch(NAMES_IT);
    expect(ALL_MJS.map(rel)).toEqual(expect.arrayContaining(['deploy/history-gate.mjs', 'deploy/history-replay.mjs', 'deploy/history-counters.mjs']));
  });

  it('the gate is the one .mjs under ccd/, deploy/ and shared/ that declares turnsOf', () => {
    expect(definers()).toEqual(['deploy/history-gate.mjs']);
  });

  it('the gate and the counter are the only files that name turnsOf on a code line: the driver builds no turns of its own', () => {
    expect(namers()).toEqual(['deploy/history-counters.mjs', 'deploy/history-gate.mjs']);
  });

  it('the counter calls turnsOf on exactly one code line, so its turns are the gate\'s, never a grouping of its own', () => {
    expect(lines(COUNTER).filter((l) => CALLS_IT.test(l))).toHaveLength(1);
  });
});
```

Run it (foreground, at least 600000 ms):

```bash
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'W2-6 Task 4'
```

Expected (predicted): 4 passed. The pin holds at this commit because Task 1's `windowCtx` is the counter's one call (U12); its reds are the mutants below. From the repository root, one tool call per block (one suite per call): the copies, then each mutant with its run and its restore, then the check.

```bash
S=.superpowers/sdd/history-w2-6/scratch; mkdir -p "$S"
cp deploy/history-counters.mjs "$S/counters.t4.orig"; cp deploy/history-replay.mjs "$S/replay.t4.orig"
```
```bash
# S1: a third .mjs that calls turnsOf. Expected RED (predicted): 1 failed, the namers case lists deploy/w2-6-scratch.mjs.
printf '%s\n' "import { turnsOf } from './history-gate.mjs';" 'export const t = (rows) => turnsOf(rows);' > deploy/w2-6-scratch.mjs
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'W2-6 Task 4'); rm deploy/w2-6-scratch.mjs
```
```bash
# S2: a second declaration of turnsOf. Expected RED (predicted): 1 failed, the definers case: [ 'deploy/history-gate.mjs', 'deploy/w2-6-scratch.mjs' ].
printf '%s\n' 'export function turnsOf(rows) { return rows; }' > deploy/w2-6-scratch.mjs
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'W2-6 Task 4'); rm deploy/w2-6-scratch.mjs
```
```bash
# S3: the driver names turnsOf. Expected RED (predicted): 1 failed, the namers case: [ counters, gate, replay ].
S=.superpowers/sdd/history-w2-6/scratch
python3 -c "import sys; p='deploy/history-replay.mjs'; s=open(p).read(); o=\"} from './history-gate.mjs';\"; assert s.count(o)==1; open(p,'w').write(s.replace(o, ', turnsOf ' + o))"
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'W2-6 Task 4'); cp "$S/replay.t4.orig" deploy/history-replay.mjs
```
```bash
# S4: the counter's turns not the gate's call. Expected RED (predicted): 1 failed, the counter-calls case (0 lines); the
# namers case stays green (the import still names it).
S=.superpowers/sdd/history-w2-6/scratch
python3 -c "import sys; p='deploy/history-counters.mjs'; s=open(p).read(); o='turnsOf(copy.rows).slice(0, K)'; assert s.count(o)==1; open(p,'w').write(s.replace(o, 'copy.rows.map((r) => ({ key: r[2], rows: [r] })).slice(0, K)'))"
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'W2-6 Task 4'); cp "$S/counters.t4.orig" deploy/history-counters.mjs
```
```bash
S=.superpowers/sdd/history-w2-6/scratch
cmp deploy/history-counters.mjs "$S/counters.t4.orig" && cmp deploy/history-replay.mjs "$S/replay.t4.orig" \
  && test ! -e deploy/w2-6-scratch.mjs && echo restored && rm -f "$S/counters.t4.orig" "$S/replay.t4.orig"
```

| Mutant | Guard |
|---|---|
| S1 | no third file names `turnsOf` (W2-D86) |
| S2 | one declaration of `turnsOf` (W2-D86) |
| S3 | the driver builds no turns (W2-D86) |
| S4 | the counter's turns are the gate's call (W2-D86) |

Then re-run the filter: 4 passed.

- [ ] **Step 6: Measure the Q29 disjointness.** From the repository root. First the import-binding checker, as a quoted heredoc:

```bash
cat > .superpowers/sdd/history-w2-6/t4-imports.mjs <<'EOF'
// Reads a unified diff on stdin; counts the added import lines and those that bind any name not w6c-prefixed
// (w6c, W6c, W6C_) or that bind a name without `as` (U4: every W2-6 test import is w6c-prefixed). Prints counts only.
import { readFileSync } from 'node:fs';
const added = readFileSync(0, 'utf8').split('\n').filter((l) => l.startsWith('+import '));
const bad = added.filter((l) => {
  const m = l.match(/^\+import\s+(?:type\s+)?(.*?)\s+from\s/);
  if (m === null) return true;
  const names = [...m[1].matchAll(/\bas\s+(\w+)/g)].map((x) => x[1]);
  const bare = m[1].replace(/\*\s+as\s+\w+/g, '').replace(/\w+\s+as\s+\w+/g, '').match(/\w+/g) ?? [];
  return names.length === 0 || bare.length > 0 || !names.every((n) => /^(w6c|W6c|W6C_)/.test(n));
});
console.log('imports', added.length, 'unprefixed', bad.length);
EOF
printf '%s\n' "+import { join } from 'node:path';" "+import * as w6cOk from 'node:path';" | node .superpowers/sdd/history-w2-6/t4-imports.mjs
```

Expected: `imports 2 unprefixed 1` (the CONTROL: the checker sees an unprefixed binding and admits a prefixed one). Then:

```bash
MB=$(git merge-base origin/main HEAD)
SPEC=docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md
T=server/test/history-replay.test.ts
S=server/test/single-definition.test.ts
git diff --numstat "$MB" HEAD -- README.md "$SPEC" "$T" "$S"
git diff -U0 "$MB" HEAD -- README.md | grep -c '^@@'
L=$(git diff -U0 "$MB" HEAD -- README.md | grep '^@@' | sed -E 's/^@@ -([0-9]+),0 .*/\1/')
CARD=$(git show "$MB":README.md | grep -n 'whether the line arrived and named its leaf\.$' | cut -d: -f1)
BOX=$(git show "$MB":README.md | grep -n '^\*\*Box verbs and operator verbs\.\*\*' | cut -d: -f1)
echo "readme card $CARD insert-after $L box $BOX"
git diff -U0 "$MB" HEAD -- "$SPEC" | grep '^@@'
git show "$MB":"$SPEC" | grep -n '^- re-discovery: the same file re-read within 10 assistant turns of a compaction' | cut -d: -f1
git diff -U0 "$MB" HEAD -- "$T" | grep -c '^@@'
TL=$(git diff -U0 "$MB" HEAD -- "$T" | grep '^@@' | sed -E 's/^@@ -([0-9]+),0 .*/\1/')
ANCHOR=$(( $(git show "$MB":"$T" | grep -nF "expect(src[0], 'not spelled a second time').not.toMatch(/'v1'/);" | cut -d: -f1) + 2 ))
echo "test anchor $ANCHOR insert-after $TL of $(git show "$MB":"$T" | wc -l)"
git diff -U0 "$MB" HEAD -- "$S" | grep -c '^@@'
echo "single-definition insert-after $(git diff -U0 "$MB" HEAD -- "$S" | grep '^@@' | sed -E 's/^@@ -([0-9]+),0 .*/\1/') of $(git show "$MB":"$S" | wc -l)"
git diff -U0 "$MB" HEAD -- "$T" | node .superpowers/sdd/history-w2-6/t4-imports.mjs
```

Expected:
- four numstat lines: README `20` and `0` (the paragraph's 19 lines and its blank line); the spec `2` and `2`; the test file `<Tasks 1 to 4's added lines>` and `0`; `single-definition.test.ts` `<the describe's lines and its blank line>` and `0`. A non-zero deletion count on README or a test file means an existing line was edited: a finding against the task that did it.
- `1`, then `readme card C insert-after L box X` with `X - C = 2` and `L` either `C` or `C + 1` (git may place the blank line on either side of the paragraph): the insertion lies in the gap and nowhere else, above the box verbs and so above W2-2b's seam paragraph, which the merge-base already holds (V5; about `card 5839 … box 5841` when the base's README matches `42c9aaf24`'s above the box verbs).
- one spec hunk, `@@ -R,2 +R,2 @@`, where R is the line number the next command prints.
- `1`, then `test anchor A insert-after TL of N` with `TL` either `A` or `A + 1` and `TL` well below `N`: one test-file hunk, a pure insertion at U4's interior anchor, W2-5b1's appended blocks after it, never at the end of the file.
- `1`, then `single-definition insert-after N of N`: one pure append after the base's last line.
- `imports 15 unprefixed 0`: Task 1's twelve and Task 2's three import lines, every binding `w6c`-prefixed (U4).

Copy the numstat lines and the three `… insert-after …` lines into the PR body's "Q29" section. If `main` has moved under this branch, these numbers are measured against the merge-base and stay valid; a W2-5b2 hunk inside W2-6's named lines is a finding for the coordinator before any merge.

- [ ] **Step 7: Commit.** From the repository root, after Steps 1 to 6 are green:

```bash
git add README.md docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md server/test/history-replay.test.ts server/test/single-definition.test.ts
git diff --quiet -- docs/superpowers/plans/2026-10-22-ccrc-history-w2-6-counters.md || git add docs/superpowers/plans/2026-10-22-ccrc-history-w2-6-counters.md   # U17 only
git status --short
CO_AUTHORED_BY='<the Co-Authored-By line the attribution reminder gives>'
git commit -m "docs(history-counters): README's counters paragraph, spec erratum E25 in place and the turnsOf callers pin (W2-6 Task 4; W2-D86, W2-D87, W2-D88)" -m "README gains its own paragraph, between the card line and the box verbs, so W2-5b2's driver paragraph keeps off it (Q29, U14); it names the four dropped verify states (V1) and the verify re-run after a mid-window amendment (V4). E25 replaces the two live A/B bullets for re-discovery and the five spec counters, each citing W2-6, its departure and the signed counters_def v1, the five naming the four dropped verify states (V1). single-definition pins turnsOf's two callers (U12). Prose pins red-first: 7 red then 8 green; mutants M1 to M13 and S1 to S4 each red as predicted, files restored by cmp." -m "$CO_AUTHORED_BY"
```

Expected: `git status --short` lists the four files, staged (`M `), and nothing else, or five with the plan when this task corrected a prediction or defined a build-time number in it (U17); the commit succeeds. Replace the counts in the second `-m` with the measured ones if they differ.

- [ ] **Step 8: The file list, and what the PR's change can reach.** From the repository root:

```bash
PLAN=docs/superpowers/plans/2026-10-22-ccrc-history-w2-6-counters.md
SPEC=docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md
git diff --name-only origin/main...HEAD | grep -vxF -f <(printf '%s\n' deploy/history-counters.mjs server/test/history-replay.test.ts server/test/single-definition.test.ts README.md "$SPEC" "$PLAN") || echo 'only W2-6 files'
git diff --name-only --diff-filter=A origin/main...HEAD
git diff --name-only origin/main...HEAD -- ccd shared .github CLAUDE.md deploy/history-gate.mjs deploy/history-replay.mjs deploy/measure-history.py docs/superpowers/programs docs/superpowers/plans/2026-10-19-ccrc-history-w2-decisions.md | wc -l
sed -n '/^const GROWTH_FILES = \[/,/^\] as const;/p' server/test/growth-check.test.ts | grep -oE "'[^']+'" | tr -d "'" > .superpowers/sdd/history-w2-6/growth-files.txt
git diff --name-only origin/main...HEAD | grep -cxF -f .superpowers/sdd/history-w2-6/growth-files.txt
grep -cE "(['\"\`])[^'\"\`]*history-counters" deploy/history-replay.mjs
git diff --stat origin/main...HEAD | tail -1
```

Expected:
- `only W2-6 files`. The plan path appears only if a build-time number or a corrected prediction was recorded in it (U17).
- exactly one added path, `deploy/history-counters.mjs`: no test file is created (W2-D5).
- `0`: no never-touch path changed.
- `0`: the PR touches no `GROWTH_FILES` entry; `deploy/` is not under `L1_L2_NEW_FILE_DIRS`, so the new module needs no waiver (D-6178).
- `0`: the driver does not load the counter (W2-D88).
- the PR's insertion and deletion totals, copied into the PR body's "How it was measured".

Any other path is a finding against the task that added it: report it, never revert it here.

- [ ] **Step 9: The added lines.** From the repository root. The block prints counts only:

```bash
PLAN=docs/superpowers/plans/2026-10-22-ccrc-history-w2-6-counters.md
added() { git diff -U0 origin/main...HEAD -- deploy/history-counters.mjs server/test/history-replay.test.ts server/test/single-definition.test.ts | grep '^+' | grep -v '^+++'; }
printf 'citations %s\n' "$(added | grep -cE 'ccd:[0-9]{3,5}\b|\.(ts|tsx|mjs|sh):[0-9]+\b')"
printf 'shells %s\n' "$(added | grep -cE 'shell: *true|execSync\(|[^.A-Za-z_]exec\(')"
printf 'live-home %s\n' "$(added | grep -cE 'homedir\(|process\.env\.HOME')"
printf 'real-binaries %s\n' "$(added | grep -cE '(spawn|spawnSync|execFile|execFileSync)\( *.(claude|ccd|ccrc|gh|sqlite3).[,)]')"
printf 'key-literals %s\n' "$(added | grep -cE 'AKIA[0-9A-Z]{16}|sk-ant-[A-Za-z0-9_-]{10,}|gh[opsu]_[A-Za-z0-9]{20,}|xox[abp]-[0-9A-Za-z-]{10,}')"
printf 'sqlite-specifier %s\n' "$(git diff -U0 origin/main...HEAD -- deploy/history-counters.mjs | grep '^+' | grep -v '^+++' | grep -cE "(['\"\`])node:sqlite(['\"\`])")"
printf 'blob-decode %s\n' "$(git diff -U0 origin/main...HEAD -- deploy/history-counters.mjs | grep '^+' | grep -v '^+++' | grep -cE 'node:zlib|brotliDecompress|unbrotli')"
printf 'counters-table %s\n' "$(git diff -U0 origin/main...HEAD -- deploy/history-counters.mjs | grep '^+' | grep -v '^+++' | grep -v '^+ *//' | grep -ciE '\bFROM +counters\b')"
printf 'non-ascii-test %s\n' "$(git diff -U0 origin/main...HEAD -- server/test/history-replay.test.ts server/test/single-definition.test.ts | grep '^+' | grep -v '^+++' | grep -vE '^\+ *(//|\*|/\*)' | LC_ALL=C grep -c '[^ -~]')"
printf 'd-tbd %s\n' "$(git grep -I -c -E 'D-TB[D]-[a-z0-9]' | wc -l)"
printf 'd-ranges %s\n' "$({ added; git log --format=%B origin/main..HEAD; cat "$PLAN"; } | grep -cE 'D-[0-9]+ *(\.\.|–|-|to) *(D-)?[0-9]+')"
```

Expected: every count `0`. The `non-ascii-test` count reads the test files' added code lines only: the region's comment rules carry `─` and `§`, as the file's other section comments do, and the module, README and spec are prose. A non-zero count goes to the task that owns the line:

| Count | What a non-zero means |
|---|---|
| `citations` | a numeric line citation in code or a test (D-5893's ratchet); rewrite it as a symbol citation |
| `shells` | a shell or a command string |
| `live-home`, `real-binaries` | a test or the module could reach a live home or a real binary |
| `key-literals` | a key-shaped literal; assemble it at runtime from parts |
| `sqlite-specifier` | a quoted `node:sqlite` in the module (W2-D86, W2-4's scan) |
| `blob-decode` | the module decodes a blob itself (W2-D86) |
| `counters-table` | the module reads the node-wide `counters` table (W2-D87) |
| `non-ascii-test` | a non-ASCII character in an added test line; write it with `String.fromCharCode` |
| `d-tbd` | a placeholder departure token anywhere in the tree (`dtbd.test.ts`'s pattern) |
| `d-ranges` | a D-number range; rewrite it as a list |

- [ ] **Step 10: The PR's own suites, then the whole-PR checks.** From the repository root, each in the foreground with a timeout of at least 600000 ms, **one tool call per block**: never two suites in one call, never a loop, never a background run. Re-run a red file alone before calling it a break (CLAUDE.md's load flakes).

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts
```

Expected: `Test Files  1 passed (1)`, every case passed or skipped (the root-only and darwin-only rows); among the passes every W2-6 describe (`W2-6 Task 1` to `W2-6 Task 4`, 78 cases, 77 on darwin) and every earlier W2 PR's pins. Copy the summary lines as printed.

```bash
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts
```
```bash
git fetch origin main
```
```bash
cd server && ./node_modules/.bin/vitest run test/docs-policy.test.ts
```
```bash
cd server && ./node_modules/.bin/vitest run test/docs-parity.test.ts
```
```bash
cd server && ./node_modules/.bin/vitest run test/citations.test.ts
```
```bash
cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts
```
```bash
cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts
```
```bash
cd server && ./node_modules/.bin/vitest run test/dtbd.test.ts
```
```bash
cd server && ./node_modules/.bin/vitest run test/ci-pipeline.test.ts
```
```bash
cd server && GROWTH_CHECK=1 ./node_modules/.bin/vitest run test/growth-check.test.ts
```
```bash
cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'README states the verb, its flag and its refusal words'
```
```bash
cd server && ./node_modules/.bin/vitest run test/history-cli.test.ts -t 'README states the headless seam'
```
```bash
cd server && ./node_modules/.bin/vitest run test/history-skill.test.ts -t "README states grep's reach"
```
```bash
cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'no false positive: 1 MiB of prose'
```
```bash
cd server && ./node_modules/.bin/vitest run test/readme-holds.test.ts
```
```bash
cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts
```
```bash
cd server && ./node_modules/.bin/tsc --noEmit
```
```bash
cd server && ./node_modules/.bin/tsc -p test/tsconfig.tests.json --noEmit
```

Expected:
- **`single-definition`** green whole: this task's `turnsOf` pin, O13's and O14's scans over `deploy/*.mjs` (no `VOCABS` name declared in the new module, W2-D12, D-5774), and the definers scans, which red if the module declares a lib name it should import.
- **`docs-policy`** and **`docs-parity`** green: controls.
- **`citations`** green: the ceiling, and "the lines this branch adds hold no numeric line citation".
- **`topology-clean`** green: its walk reads every tracked file, README and the new module included, so a red names a host-shaped, address-shaped or id-shaped token; rewrite the text, never the scanner.
- **`deviation-refs`** green against `origin/main` without merging: D-6561 and D-6562 defined once, in this plan, and no allocator-era number defined in two plans. A red names the number; report it, never renumber.
- **`dtbd`** green. **`ci-pipeline`** green: the PR adds no test file (W2-D5).
- **`growth-check`** green with its rows measured (it needs `origin/main`, fetched above).
- The five README readers green; each `-t` filter selects at least one case. W2-2b's `README states the headless seam` describe (V5) reads the Session history section to its `---` and the seam paragraph by its lead; W2-6's paragraph sits above the box verbs and names neither, so its three cases stay green.
- **`measure-history`** green: the gate is unedited.
- Both **`tsc`** runs print nothing.

Copy each `Test Files … | Tests …` line, and both `tsc` exits, into the PR body.

- [ ] **Step 11: Write the PR body.** Write `.superpowers/sdd/history-w2-6/pr-body.md` with the text below, using the Write tool, never a shell heredoc. Replace each parenthesised line with what the steps measured: under `### Q29`, Step 6's numstat lines and its three `… insert-after …` lines; under `### How it was measured`, Step 8's totals; under `### Tests run`, Steps 4, 5 and 10's summary lines as printed; under `### Departures`, a line per number issued during the build, if any (as its "Deviations found" entry states it). Every other line is final.

```markdown
## ccrc history wave W2-6: the report-only counters

Spec: `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md` (rev 3.6, amended in place): §10.2's live A/B counters, erratum **E25**, amended here. Decisions: `docs/superpowers/plans/2026-10-19-ccrc-history-w2-decisions.md`, §2's "W2-6 (deploy)" entry, §3 I (W2-D86, W2-D87, W2-D88), W2-D15, W2-D23, §6's E25 and §7. Ledger: `docs/superpowers/programs/ccrc-history.md`, the W2-6 row, Q15, Q23 and Q29. Plan: `docs/superpowers/plans/2026-10-22-ccrc-history-w2-6-counters.md`.

W2's gate decides from the quiz and from live uptake. The spec also asks for six counters per post-compaction window, reported beside the gate and never fed into it: compliance, echo hits, lag, `card_served`, `card_id_mismatch`, and re-discovery, which W2-D86 makes required. This PR ships them as a standalone entry on the deploy lane, after W2-5b1. It runs nothing against a live store and spawns nothing.

### What ships

- **`deploy/history-counters.mjs`**, a standalone entry (W2-D88): the replay driver does not import it, and it is not one of the `gate_code` files the open record hashes, so every report names its own `script_sha256`. It imports the gate's `turnsOf`, window builder, copy rule and `COUNTERS_DEF_V1`, never a copy (W2-D86, W2-D87), and the driver's argv grammar, input loader, part 2 loader and `--out` rule, never a copy (U1).
- **`count`**, run by the operator on each named node after window end: part 2 through the driver's `loadFinalRecord` (its chain, the `gate_code` re-check, `--allow-code-change` after window start only, stamped `code_changed`), this node's `measure-history.py --families` report and `verify --section ab` output, each sha-checked before it is parsed, and the store, read-only. W2-D88's run checks in one order: after window end, the signed `v1` definitions, a store of the record, a measure and a verify output of this store and record, and a verify output whose presence record has seen the newest recall-off write (V2). One `counters.json` under a fresh `--out`, its sha on stderr.
- **The six counters**, each per window of a listed family, by arm and by the producer of the window's boundary (W2-D15), under the signed defaults `counters_def: 'v1'`: re-discovery (a Read in turns 1 to 10 of a path leaf N's span read or wrote, both sides made absolute; an indicator and a distinct-path count); compliance (the opening leaf's `nodes.status` distribution and its ok plus degraded share); echo hits (the window copy's stored `recall-echo` rows whose first `tool_result` is not an error, beside the window's `recall_calls`, the gap reported); lag (the newest measured `ticks.lag_ms` at or before the boundary); `card_served` and `card_id_mismatch` (lib's `decideCardDelivery` over `cardIdsIn` in the first `CARD_MEASURE_ROWS` rows of the holding copy, with `cardWindowComplete`, one verdict projected twice).
- **The drops:** a family whose recall-off file changed in the window, or whose `verify --section ab` state is anything but `ok` (`control-absent`, `control-mismatch`, `treatment-named` or `unreadable`, each listed apart: W2-D23 as extended by Q15 and W2-D84's never-fold, V1), stays in the per-window rows and is tallied apart by arm and by producer (V3), out of the arm comparison.
- **`combine`**, run over the nodes' reports: each sha-checked, of one record, window and counter script (reports of two counter scripts are refused, V4); the rows concatenated and re-folded, so the cross-node comparison's counts are the nodes' sums (U2); a node of the record with no report is named in `nodes_missing`.
- **Report-only:** unmeasured is `unmeasured` with its reason, never 0; a gap between two measures is reported, never repaired; control windows' card figures are reported, never compared; the node-wide `counters` table is never read.
- **README** gains one paragraph, "The W2 counters", between the card-line paragraph and the box verbs, with the operator's guidance to re-run `verify --section ab` on each node after a mid-window amendment of part 2 (V4); **the spec's E25** is amended in place; **`single-definition.test.ts`** pins `turnsOf`'s two callers.

Files: `deploy/history-counters.mjs` (new), `server/test/history-replay.test.ts` (one region of whole describes at one interior anchor), `server/test/single-definition.test.ts` (one describe appended), `README.md` (one paragraph) and the spec (E25's two lines), plus this wave's plan only where a build-time number or a corrected prediction is recorded. No test file is created (W2-D5), and no change to `deploy/history-gate.mjs`, `deploy/history-replay.mjs`, `deploy/measure-history.py`, `ccd/**`, `shared/**` or `.github/**`.

### Departures

Defined in the plan's "Deviations found", issued while planning:
- **D-6561** (`history-w2-counters-notebook-path`, Task 3): re-discovery reads `NotebookEdit`'s `notebook_path`, where W2-D86 and the signed `COUNTERS_DEF_V1` text say `file_path`; the signed text and its sha stay as W2-3 froze them.
- **D-6562** (`history-w2-counters-card-glue-respelled`, Task 2): the card measure's glue around lib's three shared functions is spelled a second time, because card.mjs's `deliveryOf` is module-private and W2-6 never touches `ccd/**`; held by a parity CONTROL against `measureCardDelivery` and by mutants.

(numbers issued during the build, one line each, if any)

Cited bare, defined elsewhere: D-5770 and D-5771 (the window in Node, the copy rules), D-5774 (deploy-local vocabularies), D-6238 (the body states), D-6301 (an unknown body word throws), D-5893 (the citation ratchet).

### Spec errata: E25, in place

§10.2's "The live A/B" list: the bullets "re-discovery: the same file re-read within 10 assistant turns of a compaction (*chosen*)" and "compliance, echo hits, lag, `card_served`, `card_id_mismatch`" are each replaced by one line citing W2-6, its departure and the signed defaults. They now state re-discovery's unit (turns, the Read and write tools, `NotebookEdit`'s `notebook_path`, both sides made absolute, Bash not counted) and each of the five counters per window, by arm and by producer, with its source named, none read from the `counters` table, and the two drops, naming the four verify states that drop a family (`control-absent`, `control-mismatch`, `treatment-named` and `unreadable`, V1). The stratification bullet after them is unchanged. No other erratum names W2-6.

### Q29: beside W2-5b2

W2-6 and W2-5b2 share three files; the plan shows them line-disjoint (W2-D3's peer protocol):
- **README:** W2-6 inserts one paragraph between the card-line paragraph and "Box verbs and operator verbs" and changes no other line. On this base W2-2b's headless-seam paragraph already follows the box-verbs paragraph (W2-2b's R11); W2-5b2's driver paragraph goes after the seam paragraph, before the section's closing rule, or wherever W2-5b2's plan puts it outside W2-6's lines, so the box-verbs and seam paragraphs, about 56 unchanged lines, lie between the two insertions.
- **The spec:** W2-6 replaces E25's two lines in §10.2's live A/B list; W2-5b2's errata (E2, E7 to E11, E19 to E24) lie elsewhere, the nearest (E23, "Pre-registration") several unchanged lines above. Each side keeps off the other's buffer lines.
- **`history-replay.test.ts`:** W2-6's region is one insertion at an interior anchor, directly after W2-5a's last describe and before W2-5b1's appended blocks; W2-5b2 appends at the end of the file. No existing line is edited.
- **Not shared, `single-definition.test.ts`:** W2-6 appends one describe after the file's last line, which on this base closes W2-2b's appended describe; W2-5b2's known scope does not touch the file.

(Step 6's numstat lines and its three `… insert-after …` lines, as printed)

### Decisions and rulings this PR applies

- W2-D86, W2-D87, W2-D88, W2-D15, W2-D23, W2-D24, W2-D25 and W2-D3 to W2-D6, as the plan's Decisions table states them.
- The coordinator's rulings in the operator's place under the directive of 2026-10-19, each changeable by the operator: Q15 (unrealised from the verify outputs), Q23 (`--allow-code-change` after window start only), Q29 (beside W2-5b2 on a line-disjoint plan), and the plan's U1 to U18 (the driver's helpers imported; one node per run plus `combine`; both W2-D23 drops; one interior test anchor; every measure for every boundary; the stamp on `count`; Task 1's ownership; changed families apart; echo hits from the stored provenance; untimed echo rows positional; both paths made absolute as a reading; the `turnsOf` pin in Task 4; README names no argv; README's own anchor and E25 only; the carry into W2-5b2's plan; §2's "one README paragraph"; plan-text commits for build-time numbers; the base after W2-5b1), and V1 to V5 after the plan review (every family whose verify state is not `ok` dropped, each state listed apart, as W2-D23 extended by Q15 and W2-D84's never-fold, a carry W2-5b2's report shares; a verify output whose presence record has not seen the newest write refused; the dropped tallies keyed by arm and by producer; the integrator's points: W2-5b1's `loadFinalRecord` imported, the verify re-run after an amendment stated in README, two counter scripts refused by `combine`, `boundary-absent` for a boundary the store does not hold; the README, lib and single-definition anchors re-measured against W2-2b's text).

### Residuals, named

- **Re-discovery misses Bash reads** (`cat`, `sed`, `rg`) of a file (W2-D86).
- **Lag reads the node's tick series**, so two windows on one node near the same instant share a reading (W2-D87).
- **Untimed echo rows** are counted over the positional range, past the window's end included (U10).
- **The card glue, the leaf span and the leaf-of-boundary rule are each spelled twice** (D-6562; the `spanRowsOf` parity pin, which reads the span through the counter's one leaf rule; the driver's `LEAF_OF_BOUNDARY_SQL` is module-private and its scan reads the driver alone); the store opener and the read cap are spelled again from the driver's private ones.
- **Windows cut by the row cap before turn 11 are `unmeasured`**, counted apart (W2-D14).
- **A counter descoped at open** takes a D-number at that point; none is reserved (W2-D87).
- **`combine` does not check a row's `store_id` against its node report's** (the half of review 963 F1 left open): a node report that passes its sha check and carries this counter's script sha could carry rows naming another store. Every other cross-node case in the plan's Review Focus is refused.
- **The card parity CONTROL compares card.mjs's aggregate counts only** (measured, served, mismatch, waiting), which is all `measureCardDelivery` returns: a swap of which leaf is served and which is a mismatch passes it. The card case pins each leaf's verdict.
- **Every refusal of an input comes before `--out` exists, with one exception among refusals of an input:** a write failure after `prepareOut` made `--out` (`writeReport`) refuses `out-refused` and leaves the marked `--out`, which a re-run then refuses as existing.
- **`combine` accepts any name for an `echo_hits.unreadable` key** (fix round 2): lib and recall.mjs export no vocabulary of `expandEntryBody`'s body states, so there is no declared set to refuse against. The fold sums every key as a number into a prototype-less object, so `__proto__`, `constructor` and the like are kept, never dropped or turned into a string.
- **`combine` does not check a row's `ts_ms`, `family`, `boundary_uuid`, `ccrc_id` or `generation`, nor an extra field,** beside its `store_id`: a hand-edited node report with a matching sha could carry them off shape.
- **`answerOf` accepts any `COUNTER_UNMEASURED` word for any counter,** so an unmeasured answer can carry a word another counter writes (only the `unmeasured_by` label is wrong, no total), and an unmeasured row's measured `echo_hits` or `rediscovery` answer is folded into those totals.
- **Some fields of the `echo_hits` and `rediscovery` answers have no red case of their own:** `untimed`, `prov_stale`, `recall_calls` and `distinct_paths` are held by the shape check as a group, and a mutant that drops one field alone is not measured.
- **`prepareOut`'s own `createOut` can also leave a new `--out`** when making `--out` or its marker fails. That is an I/O failure, not a refusal of an input, so it is not a second exception to the line above; `writeReport` stays the one exception among refusals of an input.
- **The `ab_state` case pins the `AB_STATES` check only through its message:** no case feeds an unknown word with `unrealised: true`, so a mutant that dropped the `AB_STATES` check but kept the `unrealised` check would be caught only by the message assertion.
- **`excluded.unmeasured.count` and the dropped lists are taken from node reports unchecked:** a hand-edited count can be coerced in the sum, and the dropped lists' ids are copied through as given.
- **`combine`'s comment says a row's `ab_state` and `unrealised` are "which the strata key on"**, but `stratify` keys on `unrealised` only (`ab_state` reaches only the window rows); the wording is wider than the code.
- **The counter is a second creator of the `history-replay-out` class** (its `--out` goes through the driver's `prepareOut`), which `shared/lifecycle.ts` does not list yet; adding it there is a follow-up outside W2-6's files, for the coordinator to carry.

### How it was measured

- Every guard red-first on the unguarded code, then each named mutant red after the guard landed, then green again; each task's commit records its counts.
- Every test reads fixture stores in `mkTmp` fixture HOMEs, or tracked files; none spawns a model or reads a live store or home.
- The added lines hold no numeric line citation, no shell, no live-HOME read, no key-shaped literal, no quoted `node:sqlite`, no blob decode, no read of the `counters` table, no non-ASCII test code, no placeholder D-number token and no D-number range (counts, all 0).
- The private-name check over every added line, every commit message, the title and this body printed 0.
- (the PR's insertion and deletion totals, from Step 8)

### Steps for the coordinator or the operator, never the worker

1. **The selection.** This PR changes no `.github/` file, so CI runs its selection. Check that the `select tests` summary lists `history-replay` and `single-definition` (both changed), and the README readers `history-cli`, `history-skill`, `history-lib`, `readme-holds` and `topology-clean`. If one is missing, dispatch a full run: `gh workflow run ci.yml --ref <this branch> -f mode=full`.
2. **Merge order beside W2-5b2.** If W2-5b2 lands first, this branch merges `main` (never a rebase), keeps both sides, and re-runs Steps 6 and 10 on the merge.
3. **Rollout through the release lane only**, in W2's final release (W2-D6), rolled onto the named nodes before part 1 of the open record is signed.
4. **The operator runs `count` on each named node after window end, then `combine` over the nodes' reports** (W2-D88), as the module's usage states, and posts each output's sha256 with the report.

### Tests run (foreground, on the worker's box)

(Steps 4, 5 and 10's summary lines, as printed)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Step 12 then checks the finished body.

- [ ] **Step 12: The private-name, host and home-path checks.** Over Step 11's finished body, from the repository root, run the block below. It prints counts only:

```bash
TITLE='ccrc history wave W2-6: the report-only counters'
BODY=.superpowers/sdd/history-w2-6/pr-body.md
PLAN=docs/superpowers/plans/2026-10-22-ccrc-history-w2-6-counters.md
LIST="$(git rev-parse --path-format=absolute --git-common-dir)/info/ccrc-private-names"
test -s "$LIST" && echo 'list present' || echo 'LIST MISSING'
cut -f2 "$LIST" | grep -v '^#' | head -1 | grep -c -i -w -F -f <(cut -f2 "$LIST" | grep -v '^#')
{ git diff -U0 origin/main...HEAD | grep '^+' | grep -v '^+++'; git log --format=%B origin/main..HEAD; printf '%s\n' "$TITLE"; cat "$BODY" "$PLAN"; } \
  | grep -c -i -w -F -f <(cut -f2 "$LIST" | grep -v '^#')
{ git diff -U0 origin/main...HEAD | grep '^+' | grep -v '^+++'; git log --format=%B origin/main..HEAD; printf '%s\n' "$TITLE"; cat "$BODY"; } \
  | grep -cE '([0-9]{1,3}\.){3}[0-9]{1,3}|\.ts\.net|/home/[^u/]|/home/u[A-Za-z0-9_-]|/Users/|/root/|/mnt/'
printf '%s\n' '/home/you/tree' '/home/u/tree' "'/home/u'" 'names(/home/u)' 'paths are /home/u fixtures' | grep -cE '/home/[^u/]|/home/u[A-Za-z0-9_-]'
```

Expected: `list present`; `1` (the list CONTROL: the list's first name counts itself, so the scan is not vacuous); `0` (the names, over every added line, every commit message, the title, the body and this plan); `0` (hosts and homes, over the same text but the plan, whose CONTROL line carries a non-fixture home); then `1` (the CONTROL: the home-path pattern sees the non-fixture home and admits the four fixture shapes). On `LIST MISSING` or a list CONTROL other than `1`, stop and report to the coordinator: an empty or missing list prints `0` over any text. A non-zero count is judged by its line numbers only, never by printing a token: re-run the same pipeline with `grep -n … | cut -d: -f1`, read those lines and rewrite each hit with a neutral stand-in before any push. A hit in a commit message needs a new commit history on this branch, which the worker asks the coordinator about first. After a push, GitHub keeps every revision.

- [ ] **Step 13: Confirm the tree holds only this PR's work.** `git status --short` lists nothing: every task committed its work, the scratch sits under the ignored `.superpowers/`, and no mutant is left in a file (each step's `cmp`).

- [ ] **Step 14: Push, open the PR, and read its threads and checks.** Push the workspace branch, its own branch and never a separate feature branch. Then open the PR against `main`, ready for review (not a draft):

```bash
git push -u origin "$(git branch --show-current)"
gh pr create --base main --head "$(git branch --show-current)" \
  --title "ccrc history wave W2-6: the report-only counters" \
  --body-file .superpowers/sdd/history-w2-6/pr-body.md
read -r OWNER REPO < <(gh repo view --json owner,name -q '.owner.login + " " + .name')
PR=$(gh pr view --json number -q .number)
gh api graphql -F o="$OWNER" -F r="$REPO" -F n="$PR" -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){totalCount nodes{isResolved path line comments(first:1){nodes{author{login}}}}}}}}' \
  --jq '.data.repository.pullRequest.reviewThreads | "threads \(.totalCount) open \([.nodes[] | select(.isResolved | not)] | length) codeql-open \([.nodes[] | select((.isResolved | not) and (.comments.nodes[0].author.login == "github-advanced-security"))] | length)"'
gh pr checks "$PR"
```

Expected: the PR URL; `threads N open 0 codeql-open 0`; once CI settles, every required check green: `test (server)`, `test (agent)`, `test (pwa)`, `build-pwa`, the node-floor leg and the typecheck.

**Re-read the threads after every push.** A thread left open blocks the merge even while every check reads green. An open CodeQL thread (author `github-advanced-security`) is fixed at its cause, in the task that owns the line. The worker never resolves a thread and never dismisses an alert. To list an open thread's place without its text:

```bash
gh api graphql -F o="$OWNER" -F r="$REPO" -F n="$PR" -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){nodes{isResolved path line comments(first:1){nodes{author{login}}}}}}}}' \
  --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved | not) | "\(.path) \(.line) \(.comments.nodes[0].author.login)"'
```

If the body must change after the PR is open, patch it over REST (`gh pr edit` fails on this box) and re-run Step 12 on the new file first:

```bash
gh api -X PATCH "repos/$OWNER/$REPO/pulls/$PR" -F "body=@.superpowers/sdd/history-w2-6/pr-body.md" --jq .html_url
```

**Wave-done** needs all four: the PR open, its checks green, no open thread, and the branch tip equal to the PR head (`git rev-parse HEAD` against `gh pr view "$PR" --json headRefOid -q .headRefOid`). Merging, the merge queue, the rollout and every act in decisions §5 belong to the coordinator and the operator, never the worker.

**Mutants.** The README guard: M1 (paragraph deleted), M2 (doubled), M3 (a counter name dropped), M4 (the never-the-gate rule softened). The spec guard: M5 (the rev 3.6 bullet restored), M6 (a write tool dropped), M7 (the citation dropped), M8 (the never-repaired rule dropped), M9 (the two bullets swapped), M10 (`notebook_path` dropped, D-6561), M13 (`treatment-named` dropped from the dropped states, V1); and back on README, M11 (the same, V1) and M12 (the re-run guidance softened, V4). The `turnsOf` pin: S1 to S4. The checks carry their own CONTROLs: the paragraph reader's CONTROL case; the `turnsOf` patterns' CONTROL case; Step 3's checker answering `defined 2` on a copy with a synthetic entry doubled; Step 6's import checker counting a planted unprefixed binding; Step 12's list CONTROL counting the list's first name, and its home-path pattern counting a non-fixture home; and each focused `-t` run selecting its named cases, so none passes vacuously.

*Measured over predicted (Task 4, U17):* Step 1 measured as predicted (7 failed, 1 passed), and Step 4's 8 passed once README and the spec held their lines. Mutants M1 to M13 and S1 to S4 each measured red on the predicted cases (M9's message reads `expected 2740 to be 2742`, the zero-based line numbers). Drift in Step 5: the file's last describe on this base is `codex bridge Stage 2 Task 10: …` (about :9263, 9,304 lines), not W2-2b's, which sits mid-file (about :9023); the new describe is appended after the file's last line all the same, as the coordinator ruled. Step 6's numstat and hunks are measured on the working tree against the merge-base, because Step 7 commits after it (README `20 0`, the spec `2 2`, the test file one hunk of `1753 0`, `single-definition.test.ts` `40 0`; README card 6180, insert-after 6181, box 6182; test anchor 11129, insert-after 11130 of 16546; single-definition insert-after 9304 of 9304; `imports 15 unprefixed 0`). Task 2's fix round defined D-6563 (see Deviations found), and a plan-text tidy commit corrected the departure prose to eight card leaves and three numbers. After #1528 (D-6928) split `server/test/single-definition.test.ts` into `server/test/single-definition/<area>.test.ts` and `helpers.ts` on `main`, which the merge of `main` took, the `turnsOf` callers describe no longer lives in the single file Task 4's Files line and Step 5 name: it is appended after the last line of `server/test/single-definition/switches-history.test.ts` (the history area file, where D-6928's rule puts a new guard), unchanged apart from one added name, `stallCodeText`, on that file's existing `./helpers.js` import line. Measured there: the filter selects 4 of 118 and passes 4, and S1 to S4 each go red on the predicted case. Step 6's single-definition line becomes `41 1` on the area file (the describe's 40 lines and its blank line, and the changed import line) in two hunks, the import line and a pure append with `insert-after 666 of 666`; the `40 0` numstat, `insert-after 9304 of 9304` and the single-file Q29 row are the predictions this replaces.

*Fix round 1 (review 963 F4, F5; comment only):* the pin's comment now says what holds at its new path: the CCRC HISTORY block it follows is `helpers.ts`'s and defines `ALL_MJS` of the four names it reads (`stallCode`, `stallCodeText` and `rel` sit above that block there); one name, `stallCodeText`, joined the existing `./helpers.js` import line; and the known width names that the pin matches `turnsOf` only, so a turn rule re-spelled under another name is out of its reach. No code line changed, and Step 5's code block above carries the same comment.

**Commit:** one, Step 7's. Every later step reads. A fix a later check calls for goes into the task that owns the code, as a correction commit in that task's form (`fix(history-counters): <what> (W2-6 Task <N>; W2-D<n>)`), committed before Step 14's push, and Steps 6 to 13 are re-run after it. A number issued during the build is defined in this plan's `## Deviations found` by the commit that first cites it.

---

## Deviations found

Three numbers are defined here. D-6561 and D-6562 were issued by the coordinator for the departures found while this plan was drafted, before dispatch, and this plan defines them on `main` before any task runs; D-6563 was issued during the build. A number issued during the build is appended below by the commit that first cites it.

- **D-6561** — `history-w2-counters-notebook-path` (Task 3; W2-D86, and `COUNTERS_DEF_V1`'s signed `rediscovery` text): re-discovery reads a `NotebookEdit` tool_use's file from its `notebook_path` field, where W2-D86 and the signed text say "the `file_path` of a … NotebookEdit tool_use". Claude Code's `NotebookEdit` input names its file `notebook_path`, as lib's `toolUseInputPath`, derive's card fields and W2-5a's `MINE_PATH_FIELDS` read it, so the literal text would make `NotebookEdit` never match and a notebook re-read never count. The signed text cannot change here: editing it moves `COUNTERS_DEF_V1_SHA256` and touches `deploy/history-gate.mjs`, which W2-6 never touches, and part 1 signs that sha. So the code departs from the letter, the module's comment and E25's in-place line (Task 4) state the field, and a correction of the signed text is a later PR's. Pins: Task 3's `toolPathsOf` case (a `NotebookEdit` with `notebook_path` counts, one with `file_path` does not) and mutant M1 of Task 3; Task 4's E25 content case and its mutant M10.
- **D-6562** — `history-w2-counters-card-glue-respelled` (Task 2; W2-D87, "the same functions the sweep's card measure uses, so no rule is spelled again"): `card_served` and `card_id_mismatch` call lib's shared `cardIdsIn`, `cardWindowComplete` and `decideCardDelivery`, once each and declared nowhere in the counter, but the glue around them is spelled a second time in the counter's `cardVerdictOf`: the rows after the boundary up to the next boundary, at most `CARD_MEASURE_ROWS`; `live` (`source_key === ''` and `ingest_files.status === 'live'`); the `CARD_ATTACHMENT_MAX_BYTES` skip; and `waitedMs`. card.mjs's `deliveryOf`, which holds that glue, is module-private, and W2-6 never touches `ccd/**`, so the counter cannot import it. A boundary no copy holds answers unmeasured `boundary-uncopied` in the counter, where card.mjs answers `none`: that never moves a served or mismatch count, and W2-D87 never reports an unmeasured value as a count. Moving the glue into lib, so both callers import it, is a later `ccd/**` follow-up. Pins: Task 2's parity CONTROL (card.mjs's own `measureCardDelivery`, over the same fixture store, agrees with the counter on the aggregate counts it returns: measured 8, served 1, mismatch 1, waiting 1; it exposes no per-leaf verdict, so each leaf's verdict is pinned by the card case's own expectations, review 963 F3), its module scan (each lib function called once, declared nowhere here), its card and wait cases, and mutants M17 to M22, M24 and M30 to M34 (D-6563) of Task 2.
- **D-6563** — `history-w2-counters-card-boundary-stamp` (Task 2; W2-D87, D-6562): the plan's `cardVerdictOf` took `eofAfterBoundary`'s boundary time from the measure report's `ts_ms`. card.mjs's `deliveryOf` takes the store's newest stamped row at or before the boundary's line in the holding copy (its `stampAt` statement), and `null` when none is stamped. The two differ when the boundary row has no timestamp, or whenever the report's time is not the store's, which can move a window between `card-wait` and `none`. The counter now spells `stampAt` again with card.mjs's SQL and parameters, the fifth piece of D-6562's re-spelled glue (beside the rows read, `live`, the size bound and `waitedMs`). Pins: Task 2's card fixture store holds four more leaves, EA (a live window short of rows and of age that the file's end closes), EB (the boundary row has no stamp and the report names a later time, so only the store's stamp closes the window), RT (`source_key` empty, file retired, so not live), each answering `none` in the card case and in the parity CONTROL against `measureCardDelivery`, and NS (review 963 F2: no stamped row at or before the boundary's line, so the store's stamp is `null`, the file's end closes nothing and the window waits, `card-wait`; it is the last node, so card.mjs counts it waiting and stops with no leaf after it: measured 8, waiting 1); mutants M30 to M34 of Task 2 (the report's time, no end-of-file test, `live` without the file's status, a throw on the null arm, the report's time as the null arm's fallback).
