# ccrc history wave W2-5a: reconstruction, admission, the quiz builder and the record subcommands, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Ship the store side of W2's quiz, and the operator's record subcommands, in ONE PR on `main`. It is the deploy lane's W2-5a (W2 decisions document §2), after W2-4 (#826) and W2-1 (#1105) merged; it runs beside the fleet lane's W2-2a and W2-2b. It turns W2-4's driver core and W2-3's pure gate into the acts the operator runs before window start (§5, acts 9 to 19). It spawns no arm and no judge: those are W2-5b's. Task by task:
- **Task 1 (W2-D74, W2-D75, W2-D33, W2-D24, W2-D29; D-6277).** Reconstruction reads the store through W2-1's exports, and this task owns every piece later tasks share (R3, R4): every import statement and its pin, the header sentence (the ledger's R1 carry), `--no-warnings` on the shebang and every spawn of the driver, the `t8Tree` repair, the `keptOf` scan and the `CODE_SHA_FILES parity` pin (`CODE_SHA_FILES` is the gate's `GATE_CODE_FILES`); the one store opener, `openReplayStore`, which builds the run's pair index once and reads the store id; the one holding-copy reader, `boundaryCopyOf`, with the one summary pick, `summaryIndexOf`; the span reader, `spanRowsOf`; kept(N) through `bodyOf`, never `keptOf`; each body as `expandEntryBody`'s pick, its five words (D-6238) mapped one by one; the payload composer, `composePayload` and `renderToolUseLine`; and `RECON_DISCARDS`, the boundary-discard list. `DRIVER_REASONS` gains `store-unreadable`.
- **Task 2 (W2-D61, W2-D65, W2-D67).** Fact mining over leaf N's span into the one candidate shape (R4): the four kinds, F and F_raw, the producer of each row, deduplication within a family, and the redaction screen (`redact-fact` when F_raw or F changes under redaction, R10; then `redact-leaf`), before the producer screen and admission against B. `FACT_DROP_REASONS`, the fact-drop list.
- **Task 3 (W2-D66).** RP5 boundary admission over Task 1's holding copy: the last real assistant row before the boundary and the first real assistant row after the summary row must both be Anthropic, with the straddle CONTROL and the two-copy CONTROL; the population over a store, each verdict a `RECON_DISCARDS` word, each admitted row naming its summary row.
- **Task 4 (W2-D68, W2-D69, W2-D33; D-6278, D-6279).** Baseline B, parts 1 to 3 from the store (Task 1's readers) and part 4 from the baseline files (`baseline_files: 'v1'`), held in memory only: its text is non-enumerable, and the baseline record under `--out` carries counts only. A tombstoned or malformed kept list discards as `kept-unreadable`, never as an empty part 2. W2-D61's and W2-D74's B pins.
- **Task 5 (W2-D70, W2-D34, W2-D71; D-5780).** Answerability with its timed clause, the same-millisecond count over the CLI's family scope as a report that never gates, and seeded sampling: families in seeded order (for the quiz, a per-family seeded key, `quizFamilyOrderKey`, R10), each family's candidates on its own stream, lazy stages, the three caps, the halt floor and the fidelity boundaries.
- **Task 6 (W2-D72, W2-D73, W2-D64, W2-D54, W2-D71).** The question writer through W2-4's writer-mode spawn (RP1-writer, RP3-writer), its windowed and redacted input, the frozen lists (`frozen.json`, canonical bytes, never replaced), the fidelity pilot's three payload stdins and its overhead arithmetic (the spawns are W2-5b's), and `sourceQuiz`, Tasks 1 to 6 composed, which in quiz mode walks every local admitted family less the exclusions, never the census list (R10).
- **Task 7 (W2-D84's first half, W2-D24, W2-D21 as amended, W2-D25, W2-D73, W2-D19, W2-D20, W2-D77; D-6280).** The record subcommands: `pilot-source`, `quiz-source`, `freeze`, `power` (with the census assembler that checks nodes only), `open --template`, `open --draft`, `open --finalize`, `verify --registry` and `verify --section ab`, each `--record` consumer re-checking `codeShas()` before it reads any other input. The `flags_accepted parity` pin, and the `--out` walk over a whole stubbed run. A refusal that needs no store and no spawn answers before `prepareOut` makes `--out` (R10). `freeze`'s meta reports `short_of_min_families` against `quiz.min_families`, never refusing on it (R11).
- **Task 8.** The departures, the whole-PR checks and the PR. It changes no tracked file and has no commit (R2).

Sessions see no change in behaviour: no hook, unit, timer, store, schema, wire or `ccd/**` file changes, and the driver opens every store read-only. Running any subcommand on a real node is the operator's (§5), after the final W2 release is rolled out (W2-D6), never the worker's.

**Architecture:** One L4 operator script and its test file. Ring membership is a property of a file's imports.

*`deploy/history-replay.mjs`* (L4: it owns `fs`, `child_process`, `process` and the clock) stays a standalone ES module whose R1-style entry guard is its last block; every new block goes above the comment that precedes it, after the previous task's section. Task 1 adds every module statement the PR needs, so after Task 1 the import block holds W2-4's seven modules plus seven (R3):
- `node:crypto` (`randomBytes`, used from Task 5);
- `../ccd/history/store.mjs` (`openReader`, `userVersion`, `StoreError`; Task 7 adds `readBounded`), `node:sqlite`'s sole importer, never named by the driver;
- `../ccd/history/derive.mjs` (`blobReadStmts`, `bodyOf`, `holdingCopyOf`; Task 3 adds `epochOfUuid`);
- `../ccd/history/recall.mjs` (`expandEntryBody`; Task 5 adds `familiesOf as scopeFamiliesOf` and `transcriptsOf`);
- `../ccd/history/cli.mjs` (`pairIndexOf`);
- `../ccd/history/sweep.mjs` (`ftsTextOfBlob`, used from Task 5; Task 7 adds `readRegPresence`). Never its `recallOffPresence`, under any name (R6);
- `./history-gate.mjs` (W2-3's pure module, imported, never edited), with names added by Tasks 2 and 5 to 7.

One statement per module. Task 1's pin (D-5814) holds the module list exactly, and an exact name list for `node:child_process`, `node:crypto` and each `ccd/history` module beyond `lib.mjs`; a later task that adds a name to one of those updates its entry in the same commit. The header's `Imports:` sentence (Task 1's) names every module and says the driver spells no `node:sqlite` specifier and reaches it only through `store.mjs` (R1 carry).

Inside the file the decisions stay pure functions over values, and the measuring functions call them:
- **Pure:** `removePointerLines`, `composePayload`, `renderToolUseLine`, `summaryIndexOf`, `renderKeptMember`, `admitBoundary`, `mineBoundary`, `dedupeFamily`, `screenRedaction`, `screenProducer`, `screenBaseline`, `screenCandidate`, `baselineCandidates`, `familyKeyOf`, `seededOrder`, `familyRng`, `quizFamilyOrderKey`, `quizPopulation`, `quizFloor`, `windowExcerpt`, `writerInputOf`, `writerStdin`, `qidOf`, `frozenListText`, `usageInputOf`, `userTextOf`, `originalSideOf`, `fidelityFigures`, `contractFlags`, `familiesOf`, `mergeSourced`, `deriveAssignment`, `coveredDays`, `rhoHat`, `powerReport`, `registryStateOf`, `abStateOf`, `buildDraft`, `buildFinal`.
- **Measuring or acting:** `openReplayStore`, `boundaryCopyOf`, `spanRowsOf`, `keptMembersOf`, `keptRowsOf`, `entryBodyOf`, `reconstructPayload`, `fidelityStdins` (over `reconstructPayload`), `admitStoreBoundaries`, `baselineOf`, `baselineFiles`, `writeBaselineRecord`, `checkSource`, `answerability`, `familyScopeOf`, `asofSameMsHits`, `sampleQuestions`, `sampleFidelityBoundaries`, `openWriter` (the question writer), `writeFrozenList`, `loadFrozenList`, `sourceQuiz`, `controlFileOf`, `loadInput`, `recheckCode`, `assembleCensus`, and the six handlers `pilotSourceCommand`, `quizSourceCommand`, `freezeCommand`, `powerCommand`, `openCommand` and `verifyCommand`, registered after `step0a` and `probe`.

The sourcing pipeline, in W2-D71's order, composed once by Task 6's `sourceQuiz` over the run's one open store: the store's admitted boundaries (Task 3), every local admitted family less the exclusions (W2-D71, W2-D77; R10) → mining over leaf N's span (Tasks 1 and 2) → redaction, producer and admission against B (Tasks 2 and 4) → answerability (Task 5) → the writer and the question's own admission (Task 6), drawn lazily in seeded family order (Task 5; for the quiz, each family's own seeded key, so `freeze` merges the nodes' outputs in that order, R10) → the frozen list (Tasks 6 and 7). Every refusal is still W2-4's `DriverRefusal(word, detail)` with a word in `DRIVER_REASONS`; every drop is a counted word of one of two driver-local lists by stage, `RECON_DISCARDS` (a boundary's) and `FACT_DROP_REASONS` (a fact's), never a refusal (R5).

*`server/test/history-replay.test.ts`* gains one describe per task, each with its own prefixed import block (`w5a1` to `w5a6`, `r7`), and these edits of W2-4's cases: the driver's spawns gain `--no-warnings`, `t8Tree` copies the real gate and the import pin is rewritten (Task 1), the empty-stream reader case gains `firstCallUsage: null` (Task 6), and the `FLAG_SPECS`, `HANDLERS` and recall-off line pins are re-pinned and `withHandler`'s handler type widened (Task 7).

**Tech Stack:**
- Node `>=22.16.0` ES modules (`.mjs`). `node:sqlite` only through `store.mjs`'s `openReader` (read-only, `query_only`); it prints an `ExperimentalWarning` unless the process runs with `--no-warnings`.
- `ccd/history/*` as W2-1 exported it, `deploy/history-gate.mjs` as W2-3 shipped it, and W2-4's driver core (`runBatch`, `spawnArgv`, `admitAccount`, `batchGate`, `preflight`, `codeShas`, `prepareOut`, `claimOut`, `redactForSpawn`, `readStreamJson`).
- vitest 4 in `server/`: in-process for exported functions over hand-built stores (`createStore` under `mkTmp`), spawned `node --no-warnings` for subcommands that run as the operator runs them, and W2-4's recording stub for every Claude Code spawn.

**Spec:** `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md`, rev 3.6, as amended in place by W2-1. **W2-5a amends none of it** and never holds the spec path (W2-D3). Three errata come from W2-5a's decisions and stay standing for W2-5b to amend: E19 (§10.2 "Answerability", D-5780), E20 (§10.2 "sees F and its span", D-5779, W2-3's) and E23 (§10.2 "Pre-registration", no number). Line numbers are hints measured at `cd622b2f6`; re-anchor by content:
- §10.2 "Wave 2: the replay eval" (about :2628): "**Reconstruction**" (about :2641) and its fidelity pilot bullet (about :2646), "**Questions**" (about :2650) with its Answerability (about :2663) and Redaction (about :2664) bullets, "**Two arms**" (about :2670), "**Account and budget**" (about :2698), "Pre-registration" (about :2735);
- the pins this PR builds: RP5 whole (about :2755), RP1-writer and RP3-writer (RP1 about :2751, RP3 about :2753), and the admission, B, answerability and freeze pins of W2-D61 to W2-D75.

**Ledger:** `docs/superpowers/programs/ccrc-history.md`: the W2-5a row ("after W2-1 and W2-4"), "Decisions & deviations" (the W2 block of 19 numbers, of which D-5780 is W2-5a's to define, and the four numbers issued for this plan's planning departures, D-6277, D-6278, D-6279 and D-6280), the carried items "From W2-1's plan (rulings R1 and R3)" and the W2-3 and W2-4 build notes, and "Carried constraints" (where R8's items to W2-5b go). The ledger is the coordinator's file; no task edits it.

**Rulings while planning.** The coordinator ruled R1 to R11 in the operator's place under the directive of 2026-10-19 (the Decisions table). R9 amends §5's act 9 of the decisions document in place (one pilot node, `pilot-source` run once), in the same docs PR as this plan. R10 (2026-10-22) rules the plan review's open points, and the coordinator amended W2-D71 in place to match it (the quiz's per-family seeded order key; no number). R11 (2026-10-22) rules that `quiz.min_families` is reported in `freeze`'s meta as `short_of_min_families`, never a refusal.

**Authority:** `docs/superpowers/plans/2026-10-19-ccrc-history-w2-decisions.md` (the W2 decisions document): §2's "W2-5a (deploy)" entry with the coordinator's amendment of 2026-10-20 (W2-3 review 664, F3 and F8), §3 G (W2-D60 to W2-D75), W2-D84, the decisions they cite, §4 (both parts' fields), §5 (operator acts 9 to 19), §6 (errata) and §7 (residuals, the D-numbers). Then the spec, then the merged code at the base. The document was written at `bd363a76b`, before W2-3, W2-4, 5h-1, 5h-2 and W2-1 merged, and amended in place since: every line it cites is a hint, and "Drifts since the decisions document" below lists what moved and what that changes. Where this plan and that document differ, the document wins and the worker reports the difference. Re-read the merged code before editing it: a plan text is never ground truth.

**Base:** `main` at `cd622b2f6`, W2-1's merge (#1105), which holds W2-3 (#856), W2-4 (#826), 5h-1 (#737) and 5h-2 (#1010). Task 1's Step 0 runs `git merge-base --is-ancestor cd622b2f6 HEAD` and stops before any edit if it fails. Measured anchors (hints; re-anchor each by its quoted content):
- `deploy/history-replay.mjs` (2,517 lines): the header's `Imports:` sentence (about :9), `DRIVER_REASONS` (about :53, 28 words), `FLAG_SPECS` (about :93, 7 flags), `HANDLERS` (about :106, `step0a` and `probe`), `parseArgs` (about :117), `CODE_SHA_FILES` (about :1888), the stale comment naming "history-gate.mjs before W2-3" (about :1900), `recallOffPresence(home, ids)` (about :2070), `step0aCommand` (about :2219), `probeCommand` (about :2387), the entry guard (about :2515);
- `server/test/history-replay.test.ts` (5,450 lines): the `FLAG_SPECS declares exactly …` case (about :178), the `no deploy/history-*.mjs …` `node:sqlite` scan (about :330), `EXPECTED_IMPORTS` (about :3019, D-5814), `t8Tree` (about :3915), the `HANDLERS` key line (about :4765); sixteen spawns of the driver, which Task 1 lists;
- `deploy/history-gate.mjs`: `GATE_CODE_FILES` (about :145, the same four paths in the same order as `CODE_SHA_FILES`), `q18Power` (about :1071), `collapseWs` (about :1141), `admitFact` (about :1232), `ANSWER_PROTOCOL` (about :1403), `WRITER_PROMPT` (about :1434), `OPEN_RECORD_V1` (about :2230), `validateOpenRecord` (about :2325);
- `ccd/history/derive.mjs`: `blobReadStmts` (about :40), `bodyOf` (about :175), `keptOf` (about :192), `holdingCopyOf` (about :1381), `epochOfUuid` (about :1388); `ccd/history/recall.mjs`: `expandEntryBody` (about :1504); `ccd/history/cli.mjs`: `process.umask(0o077)` (about :69), `pairIndexOf` (about :568), the entry guard (about :1700); `ccd/history/sweep.mjs`: `readRegPresence` (about :401), `recallOffPresence(home, id)` (about :813), `ftsTextOfBlob` (about :5914); `ccd/history/store.mjs`: `openReader` (about :284);
- `ccd/history/lib.mjs`: `isSyntheticModel` (about :1564), `producerOfCopy` (about :1593), `redactField` (about :2555), `entryIndexText` (about :2731), `RECALL_OFF_META` (about :4203), `summaryRowFor` (about :5760), `stampAtOrBefore` (about :6014), `renderEntryText` (about :8432);
- `server/test/lifecycle.test.ts` imports the driver in-process for `OUT_MARKER` (about :1336); it is re-run, never edited.

**PR:** see "The PR" at the end of this header.

## Global Constraints

- **One PR, deploy lane.** Executed in task order, one commit per code task (Tasks 1 to 7). W2-5a dispatches only after W2-1 and W2-4 merged (both have) and when no running worker claims either of its files (W2-D3). It runs beside fleet-lane W2-2a and W2-2b, which claim neither file; whichever PR lands second merges `main` (never a rebase) and keeps both sides.
- **Exactly two files, both modified.** `deploy/history-replay.mjs` and `server/test/history-replay.test.ts`. No new file of any kind: no test file (W2-D5), no helper, no `.d.mts`, so `ci.yml`'s node-floor heredoc is unchanged. The plan file itself is the one other path a commit may touch, and only to define a number issued during the build or correct a prediction (R2). A worker who finds another file unavoidable stops and mails the coordinator.
- **Never touched:** `ccd/**`, `shared/**`, the spec, `README.md`, `CLAUDE.md`, `deploy/history-gate.mjs`, `deploy/measure-history.py`, `.github/**`, the programme ledger, and every other test file. `single-definition.test.ts`, `lifecycle.test.ts`, `measure-history.test.ts`, `citations.test.ts`, `dtbd.test.ts`, `growth-check.test.ts` and `deviation-refs.test.ts` are re-run, never edited. A mutant applied in place to the driver is restored byte for byte (`cmp`) before the next step.
- **The spec is untouched.** E19, E20 and E23 stay as rev 3.6 (amended by W2-1) prints them; W2-5b amends them. Task 8 Step 2 asserts the spec path is absent from the diff.
- **No schema change, read-only stores.** No table, column, index or `SCHEMA_ADDED` entry (W2-D10); every store read opens through `store.mjs`'s `openReader` (W2-D51); the driver writes no store, and no `deploy/history-*.mjs` spells a `node:sqlite` specifier, in code or in a comment (W2-4's scan). `deploy/` decodes no blob itself: no `unbrotli`, `brotliDecompress` or `node:zlib` (W2-D74, Task 1's scan).
- **`--no-warnings`.** Importing the driver now loads `store.mjs`, so every spawn of the driver passes `--no-warnings` and the shebang is `#!/usr/bin/env -S node --no-warnings`; without it `node:sqlite`'s `ExperimentalWarning` breaks every stderr pin (Task 1).
- **The umask.** Importing the driver now imports `cli.mjs`, which runs `process.umask(0o077)` in the importing process; `main` never runs on import. The test worker runs under 077 from its first import of the driver, and so does `lifecycle.test.ts`'s worker; both are re-run by every task (Task 1's import pin runs in a child).
- **Never a shell.** Every child is spawned with an argv array; the driver spawns only through W2-4's `launchRun`/`runBatch` (`spawn`), never `exec`, `execSync`, `shell: true` or a command string. CodeQL's `js/shell-command-injection-from-environment` thread blocks the merge.
- **The environment.** `main(argv, env)` keeps W2-4's by-name projection `{HOME, TMUX_PANE, LANG}`; no new `process.env` line (W2-4's env scan has no exemption).
- **Single definition (W2-D12).** Each new name is declared once in the driver: one holding-copy rule (`derive.mjs`'s `holdingCopyOf`, read through Task 1's `boundaryCopyOf`), one summary-row pick (Task 1's `summaryIndexOf`), one kept-list reader (Task 1's `keptMembersOf`), one span reader (Task 1's `spanRowsOf`), one payload composer (Task 1's `composePayload`), one candidate shape (Task 2's), one roster config-dir list (Task 2's `rosterConfigDirs`), one frozen-list writer (Task 6's), one writer-model refusal (Task 6's `refuseWriterModel`, R10), one quiz family order key (Task 5's `quizFamilyOrderKey`, R10), one store opener (Task 1's `openReplayStore`) and one sourcing composition (Task 6's `sourceQuiz`) (R3, R4). `CODE_SHA_FILES` is the gate's array, not a copy. `collapseWs`, `admitFact`, `ANSWER_PROTOCOL`, `WRITER_PROMPT` and the other gate names are imported, never re-spelled; two gate privates the driver needs (`Q18_FIGURE_POWER`, `REGISTRY_DROP_REASONS`) are spelled again with a behavioural parity pin (Task 7). No `deploy/*.mjs` declares an O14 `VOCABS` name (D-5774). `DRIVER_REASONS` gains exactly one word, `store-unreadable`, appended after `interrupted` (Task 1; W2-D59).
- **Drops are counts, never refusals (R5).** Two driver-local lists hold every drop word, each frozen, duplicate-free and defined once: `RECON_DISCARDS` (Task 1), a boundary's discards, appended in place by Tasks 2 to 4; and `FACT_DROP_REASONS` (Task 2), a fact's drops, appended in place by Tasks 5 and 6 (`writer-input-over-cap` is Task 6's). The writer's two W2-D72 discards stay the gate's words. Each task pins its own slice of the list it appends to, and the two lists are pinned disjoint from each other, from `DRIVER_REASONS` and from the gate's `GATE_REASONS`: every pinned pair involves `RECON_DISCARDS` or `FACT_DROP_REASONS` (R5 as amended by R10). `DRIVER_REASONS` and `GATE_REASONS` already share three words at the base (`code-changed`, `assignment-mismatch` and `code-unmeasured`, W2-3's and W2-4's), so that pair is never pinned disjoint. `QUOTA_SKIPS` (Task 5) names a candidate the caps passed over: a separate report list, not a drop list, and pinned against none of them.
- **No overloaded null.** A NULL kept id is `kept-absent`; a tombstoned kept blob or one that is not a list of strings is `kept-unreadable`, never an empty set (the reason `keptOf` is banned from `deploy/`, W2-D33). `expandEntryBody`'s five words each keep their own discard (D-6238). A missing store refuses `store-unreadable` with the store's own word, apart from an unreadable one. `answerability` keeps `unanswerable` and `unanswerable-untimed` apart. An admission verdict names its failing side. A registry and a control file each answer `ok`, `absent`, `unreadable` or a mismatch, never folded.
- **B stays in memory.** Baseline B is never written under `--out`, never logged and never spawned; only its byte count and the admission outcome are recorded (W2-D68). The question writer's input is windowed from leaf N's span, never from B.
- **Live safety.**
  - Every test builds its `HOME` with `mkTmp` and writes its own roster, limits row, secrets file and stub Claude Code at `$HOME/.local/bin/<id>`; every spawned run gets W2-4's `spawnEnv` (a fresh env) with the poisoned `gh` first on its `PATH`. A refused account is asserted by the stub's log being absent.
  - Stores are hand-built (`createStore` under the fixture HOME, written through `store.mjs`'s `openWriter` in one transaction and read through `openReader`), or built by the real sweep in a `historyHelpers` box (`makeHistoryBox` and `runSweep`: a `mkTmp` HOME with the poisoned `gh` first on its `PATH`), which Task 1's reconstruction cases, Task 6's `w6SourceBox` and Task 7's `--out` walk use. No case runs `cli.mjs`, the shim, `ccd`, `ccrc`, `claude`, `deploy/history-gate.mjs` or `deploy/measure-history.py`, and none reads `~/.ccrc`, `~/.cc-sessions`, `~/.cc-limits` or an account home.
  - `pilot-source` and `quiz-source` run in-process with `sourceQuiz` injected, except Task 7's one `--out` walk, which runs the real `sourceQuiz` over `w6SourceBox` with the writer stub; the only child they start otherwise is the stub's `--version`. Every other subcommand runs as `node --no-warnings <driver>` with W2-4's scrubbed env.
  - `pairIndexOf(db, home)` reads the fixture HOME's secret files only; key-shaped values are assembled at runtime from parts, never written whole, in tests and plan text alike.
  - A case that needs an unreadable file (mode 000) is skipped when `process.getuid() === 0`. Never kill a process by pattern; a timeout kills only the run's own process group (D-5984).
  - Each task removes the fixture directories its runs create.
- **Running tests.** From `server/`, `./node_modules/.bin/vitest run test/history-replay.test.ts -t '<regex>'`, in the foreground, timeout at least 600000 ms, one suite per tool call, never bare `npx vitest`. Each `-t` filter is regex-safe and selects at least one test; a run that reports only skipped tests selected nothing and is not green. CLAUDE.md's load flakes are re-run alone before a red is called a break.
- **Red-first.** Every new guard is watched red on the unguarded code (the prediction written before the run), then each named mutant is measured red, then green again. A red at a CONTROL is the fixture's to fix, never the guard's to weaken. Scratch goes under `.superpowers/sdd/history-w2-5a/` (gitignored), never `git stash`.
- **Every commit green.** Each task leaves every suite green at its own commit, the whole of `history-replay.test.ts` included.
- **Citations and growth.** No added code or test line cites `file.mjs:N`, `file.ts:N` or `ccd:NNNN` (`citations.test.ts`, D-5893): cite symbols. `growth-check.test.ts`'s `GROWTH_FILES` (D-6178) lists neither file, so the driver's growth needs no waiver.
- **Commits.** One per code task, in task order, each subject `feat(history-replay): … (W2-5a Task <N>; W2-D…)`, each message ending with the Co-Authored-By line the worker's session's attribution reminder gives, passed as a second `-m` from `CO_AUTHORED_BY`. Shell state does not persist between tool calls, so each commit block sets `CO_AUTHORED_BY='<that line>'` in the same command as its `git commit`.
- **Public repo.** No host, user, account, wrapper, lane, pool, session or person name, no private project name, no IP address, no absolute home path, no private ticket id and no docserver URL, in plan text, fixtures, comments, commits or the PR body. Fixture paths are `mkTmp` paths or synthetic in the `/home/u/tree` style; account ids are W2-4's synthetic `up-a`, `gen-a`, `gen-o`, `cx-a`, `ext-n`, `ext-a` and the rest; model ids are synthetic. Task 8 Step 7 runs the private-name count over every added line, every commit message and the PR body; it must print 0.
- **Node floor.** `>=22.16.0`, identical in `server/`, `agent/` and `pwa/`; no task changes it.
- **macOS.** `test-macos` runs the selection and is advisory, but a `history-replay` red there once blocked a stable promotion (D-6122): paths come from `mkTmp`, nothing assumes `/proc`, and spawning describes skip on darwin as W2-4's do.
- **D-numbers.**
  - This plan defines five numbers, each in "Deviations found" at its end, naming the first task section that cites it (Task 8 Step 1 checks both): **D-5780** from the W2 block (`history-w2-answerable-timed`; W2-D70; erratum E19, amended by W2-5b; Task 5), and the four issued for the departures found while planning (R1): D-6277 (Task 1), D-6278 and D-6279 (Task 4), and D-6280 (Task 7). No other §6 or ledger departure names W2-5a in its "Defined in".
  - Earlier numbers are cited bare, never defined here: D-5052, D-5765 (W2-2a's, defined by W2-2a's plan in the same docs PR), D-5766 (W2-2a's, W2-D34's cut, defined by W2-2a's plan in the same docs PR; the count here ships no part of it), D-5771, D-5773, D-5774, D-5775, D-5776, D-5779, D-5791, D-5812, D-5813, D-5814, D-5815, D-5848, D-5893, D-5983, D-5984, D-5985, D-5986, D-6122, D-6178, D-6211, D-6223 and D-6238.
  - A departure found while executing takes the next unused number from the run's block named in the brief and is defined in "Deviations found" in the commit that first cites it; otherwise it is reported, never invented. Never write a number that was not issued, and never write a range.
  - Before the PR: `git fetch origin main`, then `cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts`.
- **Peers.** Before the first edit of each file, read `GET /api/claims?project=ccrc-pwa`.

## Decisions

| # | Decision | Status | Task(s) |
|---|---|---|---|
| W2-D24 | **`gate_code` re-check.** Each of W2-5a's six `--record` consumers (`quiz-source`, `freeze`, `power`, `open --finalize`, `verify --registry`, `verify --section ab`) re-checks `codeShas()` through `recheckCode` right after the record validates; `pilot-source` records it and `open --draft` measures it. `CODE_SHA_FILES` is the gate's `GATE_CODE_FILES` (decisions §7's parity). | coordinator ruling (W2 decisions document) | 1, 7 |
| W2-D29 | **Two recall-off readers.** The driver's `recallOffPresence(home, ids)` stays its one `lstatSync(recallOffPath(…))` line; `verify --section ab` reads each control file's content through Task 7's `controlFileOf`, over `store.mjs`'s `readBounded`, because W2-D84 requires the content; W2-D29's "the driver does not read content" is about the presence check (W2-D78(ii)), and `controlFileOf` writes nothing (R10). The driver imports no `recallOffPresence` under any name (R6). | coordinator ruling | 1, 7 |
| W2-D33 | **The exports, and the `keptOf` scan.** The driver reads the store only through W2-1's exports; no `deploy/*.mjs` names `keptOf` on a code line, with its CONTROL. | coordinator ruling | 1, 4 |
| W2-D34 | **The same-millisecond count** (its W2-5a half): `asof_same_ms_hits` per admitted question, reported beside the frozen list, never gating. D-5766 (the cut) is W2-2a's, cited bare. | coordinator ruling | 5 |
| W2-D51 | **Store access.** Every store read opens through `openReader`; no `node:sqlite` specifier in `deploy/`. | coordinator ruling | 1 |
| W2-D54 | **Spawned text.** Every field through `redactField` whole before any cut, over the run's pair index. | coordinator ruling | 1, 6 |
| W2-D59 | **A driver word by its owner PR:** `store-unreadable`. | coordinator ruling | 1 |
| W2-D61 | **F and F_raw.** F_raw is the stored leaf or line; F is `collapseWs(F_raw)`, lower-cased or made absolute for sha and path. The source side uses F_raw; admission and scoring use F. | coordinator ruling | 2, 4 |
| W2-D62 | **Admission variants.** Fact admission is the gate's `admitFact` (W2-3's), imported and never re-spelled, over unredacted F and unredacted B in memory, after boundary admission in W2-D71's order. | coordinator ruling | 2, 4 |
| W2-D64 | **The composer half.** Item 3 is the question followed by `ANSWER_PROTOCOL`; the empty-question run carries it too (D-5776, W2-3's). | build plus open-record default (`absent_rate_max`, W2-5b's) | 1, 6 |
| W2-D65 | **Mining.** Leaf N's span only, in holding-copy file order, through the body pick; the four kinds; the producer; never operator, summary, harness, injected or recall-echo rows. | coordinator ruling | 2 |
| W2-D66 | **Boundary admission (RP5).** Both sides Anthropic over the copy `holdingCopyOf` chooses; synthetic and model-less rows skipped. | coordinator ruling | 3 |
| W2-D67 | **The redaction discard.** First, when `redactField(F_raw, idx) !== F_raw`, when `redactField(F, idx) !== F` (R10, F6: the fact's own redaction, also `redact-fact`), or when F_raw is no longer intact in the redacted leaf; admission compares unredacted F against unredacted B in memory. | coordinator ruling | 2, 6 |
| W2-D68 | **Baseline B.** Four parts, both renderings, held in memory only; fails closed on an unreadable kept list or member. | coordinator ruling | 1, 4 |
| W2-D69 | **The baseline files** (`'v1'`): the CLAUDE files of each epoch cwd and its ancestors, every rostered config dir, imports to depth 5. | open-record default: the operator confirms at W2 open | 4 |
| W2-D70 | **Answerability**, with its timed clause (D-5780, defined here; erratum E19). | coordinator ruling | 5 |
| W2-D71 | **Sampling** (as amended 2026-10-20 and 2026-10-22): the population (every family on the node with an admitted boundary, less the exclusions, never only the census's active list), the exclusions, the seeded order over `familyKey`-sorted families and id-sorted candidates (for the quiz, each family's own order key, the `'quiz-sample'` substream seed hashed with `familyKey`, R10), lazy stages, caps, the halt floor; the pilot's fidelity boundaries and usage questions. | open-record default | 5, 6, 7 |
| W2-D72 | **The question writer.** One writer-mode spawn per candidate (RP1-writer, RP3-writer), its excerpt input (D-5779, W2-3's), two discard words, the question's own admission. | open-record default | 6 |
| W2-D73 | **The frozen list.** Exactly `canonicalJson(...)` of its object, 0600, never replaced; the pilot list written by `pilot-source`; `freeze` cuts at `quiz.target`. | coordinator ruling | 6, 7 |
| W2-D74 | **The payload body.** Expand's pick, the unsanitised variant where one exists; a tombstone discards; no second decode in `deploy/`. | coordinator ruling | 1, 2, 4 |
| W2-D75 | **Reconstruction**, items 1 to 3 (the card line is W2-5b's). | coordinator ruling | 1 |
| W2-D76 | **The pilot section.** `pilot-source` writes the values part 1's pilot section copies (its seed, the fidelity boundaries and usage questions, `pilot.families`, the frozen-list sha, `writer_model`, the code shas and its budget); the rest of W2-D76 is W2-5b's. | coordinator ruling (values: open-record defaults) | 7 |
| W2-D84 | **`verify`'s first half:** `--registry` and `--section ab`, read-only, refusing a store that is not one of the record's nodes. | coordinator ruling | 7 |
| W2-D18, W2-D19 | **Seeds.** A sort by stated key before every seeded draw; the record's seed drawn by `open --draft`, never a flag. | coordinator ruling | 5, 7 |
| W2-D20 | **Active families** (D-5773's `verify --registry` half). | open-record default (look-back) plus build | 7 |
| W2-D21 | **`power`** (as amended 2026-10-20): `q18_settings` from the record, `q18Power` per power level at `rho_headline` and at 0, `covered_days` from `lookback_days`. | open-record default (the model choices) plus build | 7 |
| W2-D25 | **The open record's consumers:** `--record PATH --record-sha256 HEX`, the validator's context, `open --template`, and the `flags_accepted` parity pin. | coordinator ruling | 7 |
| W2-D57 | **The printed sha** (D-5983): `pilot-source`, `quiz-source` and `freeze` write under `--out` and print only `sha256 <hex>` on stderr, stdout empty. | coordinator ruling | 7 |
| W2-D55, W2-D56 | **The writer's limits, budget and preflights,** before the first writer spawn and before every writer batch. | coordinator ruling (values: open-record defaults) | 6, 7 |
| W2-D6, W2-D77 | **No `--allow-code-change` before window start; the quiz excludes pilot families and every control-assigned `(store_id, ccrc_id)`.** | coordinator ruling; W2-D77 open-record default | 5, 7 |
| R1 | **The departures and their numbers.** D-6277 (Task 1), D-6278 and D-6279 (Task 4), D-6280 (Task 7) and D-5780 (Task 5) are defined in "Deviations found"; D-5766 is W2-2a's, cited bare. A departure found during the build takes the next unused number from the run's block named in the brief. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1, 4, 5, 7 |
| R2 | **Files.** The two files, plus this plan only for build-time "Deviations found" entries and corrected predictions. Task 8 changes no tracked file and has no commit; a fix one of its checks calls for is a correction commit under the owning task's number. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1 to 8 |
| R3 | **One owner per shared piece.** Task 1 owns every import statement and its pin, the header sentence, `--no-warnings`, `t8Tree`, the `keptOf` scan, the `CODE_SHA_FILES parity` pin, the one store opener and the one holding-copy reader; Task 7 owns the `flags_accepted parity` pin; every subcommand opens the store once. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1, 3, 4, 7 |
| R4 | **One set of names.** Task 2's candidate is the one shape (`store_id`, `ccrc_id`, `generation`, `boundary_uuid`, `kind`, `fact`, `fact_raw`, `source_entry_uuid`, `repo_roots`, `leaf`, `pair`, `span`, then `id`); Task 1's `composePayload` and `renderToolUseLine` are the one composer; Task 1's span reader yields store column names in holding-copy order; every sourced entry carries `rank` and `qidOf`'s id. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1, 2, 5, 6, 7 |
| R5 | **Vocabularies.** `store-unreadable` is W2-5a's one `DRIVER_REASONS` word; `RECON_DISCARDS` and `FACT_DROP_REASONS` are the two drop lists, appended in place, each pinned disjoint from the other lists (as amended by R10: only the pairs that involve one of the two; `DRIVER_REASONS` and `GATE_REASONS` share three words at the base). | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1 to 6 |
| R6 | **The drafts' readings confirmed:** the unbounded before-witness; the writer as a parameter; the user-text run; `writer-malformed` split by failed runs with one warning line; usage questions only in the pilot frozen list, at most one fidelity boundary per family; `asof_same_ms_hits` over distinct entries in the CLI's family scope, with sweep's `ftsTextOfBlob` and no imported `recallOffPresence`; the 5/5 defaults from `OPEN_RECORD_V1`; pool-level deduplication; `screenCandidate`'s order; Task 2's four mining choices (a `~`-led path, or a relative one with no absolute cwd, dropped; sha leaves as `ftsTextOf` selects them; only `tool_result` blocks mined from tool rows; `<synthetic>` rows skipped uncounted); an unparseable kept member read as text; a linked `CLAUDE.md` followed; `rho_hat` as the ANOVA estimate; the below-floor re-source as a stated cost. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 2 to 7 |
| R7 | **Pins owned across tasks.** W2-D67's second pin is Task 6's on Task 2's fixtures; Task 4 re-asserts W2-D61's quoted command on the real B and owns W2-D74's second pin; Task 4 consumes Task 2's `rosterConfigDirs`; Task 7 re-runs the `--out` sentinel walk over a whole stubbed run. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 4, 6, 7 |
| R8 | **Carried to W2-5b** (the ledger's): both parity pins against lib's `asOfCut` once W2-2a merges; README's driver paragraph names the `--no-warnings` shebang; the pilot-result file shape is W2-5b's producer contract; `open --finalize` derives `spend_budget` (D-6280). | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | none |
| R9 | **One pilot node.** `pilot-source` runs once; §5's act 9 of the decisions document is amended in place in the same docs PR. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 5, 7 |
| R10 | **The review's open points (2026-10-22).** C1: W2-D71's population stands, every family on the node with a W2-D66-admitted boundary less the pilot families and every control-held `(store_id, ccrc_id)` (W2-D77); the census's active list feeds the assignment only (W2-D73), and a quiz family need not be active or registry-resolvable (W2-D40). `sourceQuiz` in quiz mode walks the local admitted families, never `assembled.kept`; the family order is a per-family seeded key (`quizFamilyOrderKey`: the `'quiz-sample'` substream seed hashed with `familyKey`, by code unit), candidates keep their per-family stream (`familyRng`), and `freeze` merges the nodes' outputs in that order (W2-D71 amended in place; no number). F6: `screenRedaction` also drops a candidate whose F changes under `redactField`, as `redact-fact`. `verify --section ab` reads content (W2-D84); W2-D29's sentence is the presence check's. R5 amended: disjointness is pinned only for the pairs that involve `RECON_DISCARDS` or `FACT_DROP_REASONS`; `QUOTA_SKIPS` is a report list. A refusal that needs no store and no spawn answers before `prepareOut` makes `--out`, pinned for the writer-model refusal. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 2, 5, 6, 7 |
| R11 | **`quiz.min_families` (2026-10-22; the convergence review's conformance F2).** The signed default 20 (W2-D71's "at least 20 families") is reported, never a refusal: `quizMetaReport` gains `short_of_min_families: boolean`, true when the merged list's family count is below the record's `quiz.min_families`, and `freeze` writes it in `quiz/frozen.meta.json`. The halt floor (60 questions, 12 families) stays the only family-count stop. Pinned by a freeze case where the list meets the target on fewer families than `min_families` (CONTROL: at it, `false`), and Task 7's mutant M44. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 7 |

## Review Focus

These five inputs follow from the decisions and the spec, would bite the operator or the eval, and are each pinned by the named task's tests. The reviewer probes beyond the pins.

1. **A fact that leaks redacted text.** A key-shaped F_raw (assembled at runtime), a whitespace-split bearer token whose F_raw redaction leaves intact and whose F it masks, a fact intact alone but masked inside its leaf, and a span holding a key that reaches the question writer. Expected: `redact-fact` first, then `redact-leaf`, each counted without its value and before any admission (`baseline-hit` never shadows it); the writer's stdin and `<qid>.input.json` carry the redaction mark and no part of the value; B's text is non-enumerable and no B sentinel is found under `--out`. **Task 2** (the screens and `screenCandidate`'s order CONTROL; Task 6's `sourceQuiz` runs the same three Task 2 screens, `screenRedaction`, `screenProducer` and `screenBaseline`, as its first three stages), **Task 5** (the shipped path's order: the sampler runs the stages in `QUIZ_STAGES` order, "the stages run in QUIZ_STAGES order …", M28), **Task 6** (the writer-stub redaction pin; the F6 case: the writer's input carries F as it stands, so the screen is what keeps a masked F from the writer; and the shipped-path case, a key-shaped command in a real store dropped `redact-fact` at `sourceQuiz`'s own redaction stage, never asked of the writer, mutant M39), **Task 4** (B in memory). Both F_raw and F are screened (R10, F6: the writer's input carries F, so an F_raw-only screen would let a whitespace-split bearer token reach it); the reviewer probes that pair, Task 2's bearer case with its CONTROL and mutant M31, Task 2's F_raw-only case (a relative path through a registered value, which resolving removes from F) and mutant M32, and the end-to-end `--out` walk over a whole stubbed run (Task 7, R7).
2. **A straddling or two-copy boundary admitted wrongly.** Anthropic rows before, a gateway row after the summary; the same boundary held by two copies in either order, and a live copy beside a retired one with a smaller `file_id`; a gateway row between the boundary and its summary; synthetic and model-less rows. Expected: the straddle refused `after-other` on one copy and over a planted store; the holding copy is `holdingCopyOf`'s, never the longest; synthetic rows skipped, never witnesses. **Task 3**, mutants M1 (before side only), M2 (the immediately preceding row only) and M3 (the longest-copy rule). The reviewer probes the unbounded before-witness (R6).
3. **A NULL-ts or same-millisecond row.** A source row stamped exactly T_N, one stamped T_N + 1, a NULL-ts source, an unlinked sidecar, a sidecar linked to a NULL-ts row, a boundary with a NULL ts, and entries stamped T_N outside the holding copy reached by row, variant and sidecar. Expected: T_N answerable; T_N + 1, NULL ts and unlinked sidecars `unanswerable-untimed` with the failing clause named; a NULL-ts boundary dropped `ts-null` before mining; the same-millisecond count counts each entry once, outside the holding copy, and never changes the sampled list. **Task 5** (D-5780's clause 4, mutants M14 to M20 on the count) and **Task 3** (`ts-null`).
4. **A writer spawn on a refused account, or on a moved tree.** `cx-a`, `ext-n`, `ext-a` and `gen-o`; a writer model that is not an exact Opus id; a limits row at the threshold at open; a Claude Code version that moves between two asks; a resumed `--out` whose pinned input changed. Expected: each refused before any spawn with the stub's log absent (RP3-writer); RP1-writer's whole argv and env on the admitted `up-a` and `gen-a`; the preflight before every writer batch; a resume that reuses and never respawns, and refuses a changed input. **Task 6**, and **Task 7** for the order against `--out`: a writer model that is not an exact Opus id refuses `args-invalid` before `prepareOut` makes `--out`, so a refused run leaves no `--out` (R10; Task 7's case with its CONTROL, mutant M42). The reviewer probes that order for every refusal that needs no store and no spawn, and `writer-malformed` split by failed runs with its one warning line (R6).
5. **A record subcommand on a stale code sha, or writing outside `--out`.** A tree whose `measure-history.py` moved after part 1; a record path inside a git worktree (`.git` a file); a superseding draft given without its predecessor; a frozen list edited by one byte; a census taken with a `--since` that is not `lookback_days`; a census changed between `quiz-source` and `open --finalize`. Expected: `code-changed` before any other input is read and before any spawn, for each of the six consumers; `record-invalid` before a byte is read; `args-invalid` `supersedes-required`; `quiz-sha-mismatch` with no spawn; `input-invalid` `since-mismatch`; `assignment-mismatch`; `frozen.json` written 0600 under `--out` and never replaced; `open` and `verify` write nothing. **Task 7** (the `it.each` over the six consumers with its CONTROL) and **Task 6** (the frozen list). The reviewer also probes the quiz population and its merge (R10, C1): a local admitted family that no census lists is sourced, a pilot family and a control-held id are not (**Task 6**'s population case and its CONTROL), and two nodes' outputs merged by rank are the one walk over both (**Task 5**'s keyed-order case, mutants M45 to M50; **Task 7**'s freeze merge, M18 and M41).

## File Structure

| Path | Action | Responsibility | Ring | Task(s) |
|---|---|---|---|---|
| `deploy/history-replay.mjs` | modify | **Task 1:** the shebang (`--no-warnings`), the header's `Imports:` sentence (R1 carry), every import statement the PR needs (R3), `DRIVER_REASONS` + `store-unreadable`, `CODE_SHA_FILES` as `GATE_CODE_FILES`, `RECON_DISCARDS`, `POINTER_REMOVED`, `removePointerLines`, `composePayload`, `renderToolUseLine`, `summaryIndexOf`, `openReplayStore` (the pair index and the store id), `boundaryCopyOf`, `spanRowsOf`, `keptMembersOf`, `keptRowsOf`, `entryBodyOf`, `renderKeptMember`, `reconstructPayload`. **Task 2:** `MINE_*` constants, `SPAN_LOST`, `FACT_DROP_REASONS`, the span words appended to `RECON_DISCARDS`, `newDropCounts`, `noteDrop`, `storedField`, `rosterConfigDirs`, `mineBoundary` (the one candidate shape, R4), `dedupeFamily`, `screenRedaction`, `screenProducer`, `screenBaseline`, `screenCandidate`. **Task 3:** its words appended to `RECON_DISCARDS`, `admitBoundary`, `admissionStmts`, `admitStoreBoundaries`. **Task 4:** its words appended to `RECON_DISCARDS`, the `BASELINE_*` constants, `baselineOf`, `baselineCandidates`, `baselineFiles`, `baselineRow`, `writeBaselineRecord`, and `readPlain`'s `follow` option. **Task 5:** `QUIZ_STAGES`, `QUOTA_SKIPS`, `SOURCE_FAILS`, the answerability words appended to `FACT_DROP_REASONS`, `checkSource`, `answerability`, `answerableStage`, `familyScopeOf`, `asofSameMsHits`, `sameMsReport`, `familyKeyOf`, `seededOrder`, `quizRng`, `pilotRng`, `familyRng`, `quizFamilyOrderKey` and the module-private `keyedOrder` (R10), `drawSeedHex`, `quizPopulation`, `sampleQuestions` (with each entry's `rank`, and its `familyOrder` option), `quizFloor`, `sampleFidelityBoundaries`. **Task 6:** the `WRITER_*`, `FROZEN_*` and `FIDELITY_*` constants, `writer-input-over-cap` appended to `FACT_DROP_REASONS`, `windowExcerpt`, `writerInputOf`, `writerStdin`, `qidOf`, the module-private `refuseWriterModel` (R10), `openWriter`, `frozenListText`, `writeFrozenList`, `loadFrozenList`, `usageInputOf`, `userTextOf`, `originalSideOf`, `fidelityStdins`, `fidelityFigures`, `sourceQuiz`, and `readStreamJson`'s `firstCallUsage`. **Task 7:** `FlagKind` `'list'`, 42 new flags in `FLAG_SPECS` (49 in all), `parseArgs`' list flags, `step0aCommand`'s flag allow-list, the kinds and paths, `nodeStoreId` (through `openReplayStore`), `controlFileOf`, `warnFailedRuns`, `contractFlags`, `familiesOf`, `mergeSourced`, `assembleCensus`, `deriveAssignment`, `coveredDays`, `rhoHat`, `powerReport`, the `verify` states and reports, `openTemplate`, `buildDraft`, `buildFinal`, `loadInput`, `recheckCode`, the six handlers and their `HANDLERS.set` lines. Every block above the entry guard; no top-level await outside it. | L4 (operator script) | 1–7 |
| `server/test/history-replay.test.ts` | modify | **Task 1:** two describes (the store-read scans, import pins and `CODE_SHA_FILES parity`; reconstruction over a fixture store); `--no-warnings` on W2-4's driver spawns; `t8Tree` copies the real gate; W2-4's import pin rewritten to the PR's whole module list (D-5814); the `withHandler` comment corrected. **Task 2:** one describe (33 cases) and its module-level fixtures (`w5a2*`). **Task 3:** three describes and `w5a3PlantStore`. **Task 4:** four describes and `w5a4*`. **Task 5:** three describes over hand-built, indexed stores. **Task 6:** the writer, frozen-list and fidelity describes, `W6SourceBox` and `w6SourceBox`, and the `sourceQuiz` describe; W2-4 Task 4's empty-stream case gains `firstCallUsage: null`. **Task 7:** one outer describe (prefix `r7`), with the `flags_accepted parity` pin and the `--out` walk; W2-4's `FLAG_SPECS`, `HANDLERS` and recall-off line pins re-pinned, and `withHandler`'s handler type widened to the new `Flags`. | test | 1–7 |

## Drifts since the decisions document

The decisions document was written at `bd363a76b`; the base is `cd622b2f6`. Each row: what the document says, what the code at the base says, and what that changes here.

| Document says | Code at `cd622b2f6` | Effect | Task |
|---|---|---|---|
| W2-D33, W2-D74 and the W2-1 plan (R1) treat importing W2-1's exports as a header-wording matter | Importing `store.mjs` loads `node:sqlite`, which prints a two-line `ExperimentalWarning` on stderr before any module body runs; W2-4's cases compare a spawned driver's stderr whole; `cli.mjs` and `sweep.mjs` always run with `--no-warnings` | Every spawn of the driver in the test file and the driver's shebang gain `--no-warnings`; README's driver paragraph (W2-5b) must say so (R8) | 1 |
| W2-D51; the driver's header: "never loads node:sqlite in any form" | The driver has no store read and imports only lib and roster-json | Task 1 adds the first store read; the header says the driver spells no `node:sqlite` specifier and reaches it only through `store.mjs`; W2-4's specifier scan stays, its describe title reworded | 1 |
| W2-D24: the unhashed imports are recall.mjs, derive.mjs, cli.mjs and store.mjs | The measured module graph also loads `sweep.mjs`, `card.mjs`, `ccd/compact-card.mjs` and `shared/base-url.mjs`, and recall.mjs spawns `regex-worker.mjs` | The hashed set stays the four files (`release_tag` and `tree-moved` cover the rest); `CODE_SHA_FILES`' comment names the measured graph | 1 |
| §7: the first PR that loads both modules adds `CODE_SHA_FILES` deep-equals `GATE_CODE_FILES` | The driver now imports the gate | `CODE_SHA_FILES` becomes `GATE_CODE_FILES` itself, pinned with `toBe` in Task 1's `CODE_SHA_FILES parity` case (R3) | 1, 7 |
| W2-4's `t8Tree` writes fixture bytes for `deploy/history-gate.mjs`, or leaves it out (`gate: false`), to reach `code-unmeasured` | A driver that imports the gate cannot load beside fixture or absent gate bytes | `t8Tree` copies the real gate; the `code-unmeasured` case leaves `measure-history.py` out instead | 1 |
| D-5814's pin: exactly seven imported modules; header "Imports: … only" | The PR needs four `ccd/history` modules beyond `lib.mjs`, `sweep.mjs`, the gate and `node:crypto` | Task 1 adds every module statement and rewrites the exact pin once, with exact name lists for `node:child_process`, `node:crypto` and each `ccd/history` module beyond `lib.mjs`; Tasks 3, 5 and 7 add names inside braces and update that module's list in the same commit (R3) | 1, 3, 5, 7 |
| W2-1 plan: the two `recallOffPresence` exports may need an alias | Both exist (sweep about :813, the driver about :2070); `cli.mjs` re-exports nothing | Task 1 imports `cli.mjs` by name only and `sweep.mjs` for `ftsTextOfBlob`; the driver imports no `recallOffPresence` under any name, and Task 7 reads a control file through `controlFileOf` (R6) | 1, 7 |
| W2-D33: the body pick answers `'body'`, `'tombstone'`, `'over-cap'` or `'unparseable'` | `expandEntryBody(rc, e)` answers five words, adding `'undecodable'` (D-6238), and takes `rc = {db, version, schema}` | Each word keeps its own discard; an unknown word throws; `unparseable` reads as text for a kept member and discards a summary row (R6); B reads `bodyOf` only | 1, 2, 4 |
| W2-D33: `bodyOf` over `blobReadStmts`; derive.mjs's `stampAtOrBefore` | `stampAtOrBefore` moved into lib (W2-1); `bodyOf` folds tombstone, non-JSON and over-cap into one null (W2-1's residual) | B's member discard is one word, `kept-member-unreadable`; anchors re-found by content | 4 |
| W2-D33: cli.mjs's entry guard at :1668 | About :1700; `process.umask(0o077)` still about :69 | Anchored by content; the import pin runs in a child; the test worker and `lifecycle.test.ts` run under umask 077 after their first import of the driver | 1, 8 |
| W2-D38, W2-D34: lib owns `asOfCut`; the driver defines kept(N) by the same membership; the count is over entries "visible under the cut" | `asOfCut` is not on `main` (W2-2a is unmerged); only `stampAtOrBefore` | kept(N) is read from `boundaries.kept_blob_id` (option (a)); the same-millisecond count is the driver's own SQL; both parity pins are W2-5b's, once W2-2a merges (R8) | 1, 5 |
| W2-D66: `admitBoundary` reads "the copy that `lib.pickHoldingCopy` chooses" | `derive.mjs` exports `holdingCopyOf(db, b)`, which measures `live` and `holds` and is the copy `leafFields` reads | One copy rule for the leaf, the gate's stratum and admission; mutant M3 pins it | 1, 3 |
| W2-D66 names no summary rule | The gate and `measure-history.py` keep W1's rule (D-5771's residual); derive uses lib's `summaryRowFor`; no exported helper applies `derive.mjs`'s echo rule (`copyPlan`'s `isEcho` is private) | The driver composes `summaryRowFor` with the echo rule, a further spelling held to `nodes.summary_blob_id` by a parity CONTROL; Task 1's `summaryIndexOf` is the one pick (R3) | 1, 3 |
| W2-D66: a boolean; "main boundaries of confirmed epochs"; "in families eligible under W2-D71" | W2-D71 requires every drop counted; `epochOfUuid` also requires an unmerged session and takes the smallest `session_pk` (D-5052); eligibility needs the pilot list and the assignment | `admitBoundary` also returns `reason`, `before` and `after`; families come from `epochOfUuid`; the sampler applies W2-D71's eligibility | 3, 5 |
| W2-D66's CONTROL "row immediately before only" and RP5's "a mutant reading only the row before the boundary" | No admission code exists | Both readings measured: M1 reads the before side alone, M2 only the immediately preceding row | 3 |
| W2-D65 cites `provenanceOf` and lib line numbers for the pairing | The sweep pairs in `prepareLines` in file order, last write wins, with a parent-chain fallback that can leave the span | Mining keeps the in-span, in-file-order map and drops the parent-chain walk; a result paired only from outside the span is `result-unpaired` | 2 |
| W2-D61: "W2-3 for collapseWs"; W2-D67: `redactField(F_raw, idx)` | The gate exports `collapseWs`; `redactField` is 5h-2's composed door, wider than the base | Both imported, never copied, each with a no-copy scan | 2 |
| W2-D65: "paths under any rostered account's config dir"; W2-D69: "every rostered home" | The driver builds only the admitted account's config dir; `rosterFromJson` lists hidden accounts with no `hidden` flag on that object | Task 2's `rosterConfigDirs` lists every rostered config dir, hidden included; Task 4 consumes it (R7) | 2, 4 |
| W2-D65's pin: "a NULL sourceToolUseID" | The column is `entries.source_tool_use_id` | Neither spelling may appear on a driver code line (scan with CONTROL) | 2 |
| W2-D68: "an absent summary row discards the boundary" | Task 3 already drops it as `summary-absent` | B takes admitted rows only; its own word is `copy-moved` for a copy that changed between the two reads | 4 |
| W2-D34's residual: B's part 3 stops "after the boundary"; W2-D68 (3): "after the summary row" | — | W2-D68 governs: a row between the boundary and its summary is in neither part | 4 |
| W2-D68: both renderings, `renderEntryText` and `ftsTextOf`'s string leaves | `ftsTextOf` answers `''` for an object body, and an attachment row's body is an object | Every string leaf of an object body is B's second rendering (D-6279) | 4 |
| W2-D68 (3): the stop is "the first operator-provenance or assistant row" | A kept(N) member can sit after the summary row (W2-D68's own pin) | A kept member is passed over, never the stop (D-6278) | 4 |
| W2-D69: "a file that is not regular" discards; "the roster is unreadable" discards | W2-4's `readPlain` is `lstat` + `O_NOFOLLOW` (D-5986); `readRoster` refuses `roster-invalid` once per run | `readPlain` gains `follow`; baseline files follow links and still require a regular target; an unreadable roster builds no B at all (R6) | 4 |
| W2-D75 item 1, spec §10.2: "its transcript-pointer line" | No code, fixture or lib helper defines that line | Any whole line naming a path ending in `.jsonl` is replaced (D-6277) | 1 |
| W2-D70 clause 1: a sidecar's index text is `sidecarIndexText` | `indexBlob` writes `entryIndexText(ftsTextOfBlob(...).text)` for every blob | The driver recomputes through sweep's exported `ftsTextOfBlob`, then `entryIndexText` | 5 |
| W2-D70: source provenance in `SEARCHABLE_PROVENANCE` | The index holds `INDEXED_PROVENANCE`, which adds `recall-echo` | The provenance check is the guard; mutant M1 uses an indexed recall-echo row | 5 |
| W2-D70 clauses 1 and 4 on sidecars | A sidecar's only link is `sidecars.entry_id`, NULL when unlinked | Unlinked sidecars in the span's transcript enter clauses 1 to 3, and clause 4 removes them as `unanswerable-untimed`, counted | 5 |
| W2-D34: "the FTS hits for F_raw"; W2-D70: the count "per admitted question" | `grep`'s hit unit is a referrer; W2-D73's frozen entry keys have no such field | The count is of distinct entries over the CLI's family scope (R6), carried in the sampler's reports by qid, never in the frozen bytes | 5 |
| W2-D71: "5 fidelity boundaries and 5 usage questions" | No per-family rule; the defaults live only in the gate's `OPEN_RECORD_V1` field table | At most one fidelity boundary per family (R6); `pilot-source` reads the defaults from that table | 5, 7 |
| W2-D71 (amended in place 2026-10-22): the quiz population is every family on the named nodes with an admitted boundary, less the exclusions, in an order every node reproduces | Each node's store holds only its own families, and no node knows another's; the census's active, registry-ok list is another set, the assignment's (W2-D20, W2-D73), and a quiz family need not be in it (W2-D40) | Quiz mode walks this node's admitted families less the exclusions, never `assembled.kept`; families sort by `quizFamilyOrderKey` (the `'quiz-sample'` substream seed hashed with `familyKey`), candidates by `familyRng`; a quiz question's `rank` is `[order key, candidate rank]`, and `freeze` merges in that order (R10) | 5, 6, 7 |
| W2-1's export list | `ftsTextOfBlob` was already exported by `sweep.mjs`, outside it | Task 1 imports it; Task 5 uses it (R3, R6) | 1, 5 |
| Spec §10.2: the replay side is "the first-call input tokens" | `readStreamJson` exposes only a total usage | `StreamFacts.firstCallUsage` added; W2-4's empty-stream case re-expected | 6 |
| Spec §10.2: the original side nets "that call's user text" | No tokenizer ships in the driver | A third fidelity stdin, the user-text run, so every count comes from the same model (R6) | 6 |
| W2-D56: preflight wiring is W2-5b's; W2-4's plan: `pilot-source` runs `loadStep0a` and `preflight` | The preflight is an unwired mechanism | `openWriter` runs the whole W2-D56 preflight before its first spawn and before every writer batch | 6 |
| W2-D73: frozen.json is exactly `canonicalJson(...)` | W2-4's outputs are `canonicalJson` + `'\n'` | Frozen lists carry no trailing newline; `loadFrozenList` refuses any other bytes | 6 |
| W2-D72: "4,000 characters", "2,000 characters", "8 KiB" | W2-4's `cutToolResult` counts code points | Windows and caps count code points; the 8 KiB is the excerpt's UTF-8 bytes; a fact that cannot fit is `writer-input-over-cap`, counted | 6 |
| W2-D72: the writer "with `--tools \"\"`" | `spawnArgv`'s writer mode carries the whole contract, `--verbose` included (E26) | RP1-writer pins the whole writer argv | 6 |
| W2-D21: `Q18_FIGURE_POWER` "a module constant"; W2-D20's drop reasons | Both are private in the gate, which W2-5a may not edit | The driver spells them again (`Q18_FIGURES`, `REGISTRY_STATES`), each held to the validator by a behavioural parity case | 7 |
| W2-D21: Q18 reads the census rows | `buildWindows` throws on a row without a boolean `found` | `powerReport` builds each family report with `found: true` | 7 |
| W2-D25: consumers take `--record PATH --record-sha256 HEX` | `validateOpenRecord` needs `ctx.predecessor`, `ctx.draft` and `ctx.frozen` | New flags `--supersedes`, `--part1`, `--frozen`/`--frozen-sha256` and `--prior-final`; a superseding draft without `--supersedes` refuses `supersedes-required` | 7 |
| W2-4's grammar: each flag at most once; `step0a` ignores flags it does not read | `parseArgs` refuses a repeat; `step0aCommand` has no allow-list | A `list` flag kind for per-node inputs; `step0aCommand` refuses a flag it never reads | 7 |
| W2-D84: verify reads through `historyPaths`, `recallOffPath` and `readBounded`; "`recall_off.seen_ms` later than the newest write" | `single-definition.test.ts`' O13 pins exactly one driver `lstatSync(recallOffPath(` line; nothing measures "the newest write" | Content through Task 7's `controlFileOf` over `readBounded` (R6; R10: W2-D84 requires the content, W2-D29's "does not read content" is the presence check's, and the read writes nothing, so O13's one-writer pin holds); the newest write is the presence directory's mtime, compared strictly | 7 |
| W2-D73: `assignment_sha256` "beside the frozen list" | The frozen list's bytes are a closed shape | `freeze` writes `quiz/frozen.meta.json` beside it | 7 |
| W2-D24: `--allow-code-change` stamps every output | W2-D6: before window start the remedy is a re-pilot | No W2-5a subcommand declares it; each refuses `code-changed` | 7 |
| §4: part 2's `spend_budget` is the pilot's extrapolation × 1.25 | The extrapolation is W2-5b's and has no shape at this base | `open --finalize` takes `--spend-budget` from the operator (D-6280) | 7 |
| §5 act 9: `pilot-source` "on the node or nodes holding the pilot families" | Part 1's pilot is one object with one seed and one frozen sha | One pilot node, `pilot-source` run once; act 9 is amended in place (R9); `open --draft` takes exactly one pilot-source output | 7 |
| W2-D51, W2-D84: store reads through `openReader` | `peekStoreId` folds a missing store into `unreadable` | `nodeStoreId` is one `openReplayStore` call, closed at once; its `openReader` refuses an absent store with its own `store-missing` word, so absence is never folded into unreadable (R3) | 7 |
| The decisions predate the citations ratchet (D-5893) and the armed growth check (D-6178) | Both run on every PR | No added numeric line citation; neither file is a `GROWTH_FILES` entry | 8 |
| §2: W2-5a's files are exactly the two | A build-time number must be defined in a plan by the commit that first cites it | Task 8 Step 3 admits the plan path as the one extra path (R2) | 8 |
| W2-4's driver comment: "history-gate.mjs before W2-3 lands" (about :1900) | W2-3 merged as #856 | Stale; corrected by whichever task edits that block, else named in the PR body | 8 |

## Not in this plan

- **W2-5b (deploy):** the arm runs with the real ARM values (RP1-arm), the treatment card line (W2-D75's last item), step 0b's treatment-arm assertions, the fidelity and usage pilots' spawns and the fidelity comparison (the `fidelity` subcommand), the judge (RP1-judge, RP3-judge), the failed-run handling, the hand-check, quiz uptake, the absent-rate guard, `marker` and `verify --section pilot|quiz`, `open --amend`, the arm-batch preflights (W2-D78) and W2-D56's wiring into every arm batch, `report` and `decideGate`'s inputs, the arm-word scan (W2-D42), README's driver paragraph, and the spec errata for W2-2a, W2-2b, W2-5a (E19, E20, E23) and W2-5b.
- **W2-2a (fleet):** the as-of cut, `asOfCut`, `asof-invalid` and D-5766's definition; W2-5a imports no W2-2a name. **W2-2b (fleet):** the headless seam and the marker grammar.
- **W2-6 (deploy):** `deploy/history-counters.mjs`.
- **The spec errata.** W2-5a edits no spec line; E19, E20 and E23 stand for W2-5b, and every other erratum is its owner's.
- **The rollout.** Through the release lane only, as part of W2's final release rolled onto every named node before part 1 (W2-D6). The coordinator's or the operator's, never the worker's.
- **The window and its operator acts** (decisions §4 and §5): step 0a on each node, `pilot-source`, signing part 1, the census, `verify --registry`, `power`, the Q18 decision, `quiz-source`, `freeze`, `open --finalize`, the `recall-off` writes and `verify --section ab`, the build and maintenance freezes, the backfill re-run. None is the worker's, and no step runs a subcommand on a real node or account.
- **The ledger** (R8's carries to W2-5b) and the decisions document's amendments of §5 act 9 (R9) and of W2-D71 (R10, the quiz's per-family order key): the coordinator's, in the same docs PR as this plan.

## The PR

**PR:** One PR against `main`, on this workspace's own branch, executed in task order, with one commit per code task:
1. `feat(history-replay): reconstruction reads the store through W2-1's exports; one gate_code list; the driver runs under --no-warnings (W2-5a Task 1; W2-D74, W2-D75, W2-D68, W2-D33, W2-D24, W2-D29, W2-D54; D-6277)`;
2. `feat(history-replay): mine quiz facts and screen them by redaction, producer and Baseline B (W2-5a Task 2; W2-D61, W2-D65, W2-D67)`;
3. `feat(history-replay): RP5 boundary admission over the holding copy, with the straddle and two-copy CONTROLs (W2-5a Task 3; W2-D66; D-5771)`;
4. `feat(history-replay): Baseline B and its files, held in memory only (W2-5a Task 4; W2-D68, W2-D69, W2-D33; D-6278, D-6279)`;
5. `feat(history-replay): answerability with its timed clause, the same-millisecond count and seeded sampling (W2-5a Task 5; W2-D70, W2-D34, W2-D71; D-5780)`;
6. `feat(history-replay): the question writer through the writer-mode spawn, the frozen lists, the fidelity pilot's payloads and arithmetic, and sourceQuiz (W2-5a Task 6; W2-D72, W2-D73, W2-D71, W2-D64, W2-D54, W2-D55, W2-D56)`;
7. `feat(history-replay): the record subcommands, pilot-source, quiz-source, freeze, power, open and verify, each re-checking the code it runs under (W2-5a Task 7; W2-D84, W2-D24, W2-D73, W2-D21, W2-D19, W2-D20, W2-D25, W2-D71; D-5773, D-6280)`.

Task 8 adds no commit of its own (R2); a fix one of its checks calls for is a correction commit under the owning task's number, before the push, and a number issued during the build is defined in this plan's "Deviations found" by the commit that first cites it. Task 1 goes first: every later task reads the store through it, and it settles the imports, the gate and `--no-warnings`. Tasks 2 to 5 each build on the pieces before them; Task 6 needs Tasks 1 to 5; Task 7 composes everything; Task 8 runs last. Every task leaves every suite green at its commit. This PR changes no `.github/` file, so CI runs its selection; the PR body asks the coordinator to check that the `select tests` summary lists `history-replay`, `lifecycle` and `single-definition`. The PR is opened by Task 8 Step 10, only after its Steps 1 to 9 (the departures, the spec untouched, the file list, the carries, the whole file in one process, the whole-PR checks, the private-name count of 0, a clean tree and the body), ready for review (not a draft), titled **"ccrc history wave W2-5a: reconstruction, admission, the quiz builder and the record subcommands"**, with the body Task 8 Step 9 gives.

---

### Task 1: reconstruction reads the store through W2-1's exports; one gate_code list; the driver runs under --no-warnings

This task gives the driver its first store read, and every later W2-5a task reads the store through what it adds. Boundary N's payload (spec §10.2 "Reconstruction", items 1 to 3; W2-D75) is built from the store on the node that holds it, and `deploy/` decodes nothing itself (W2-D74):
- the store opens through `store.mjs`'s `openReader` (read-only, `query_only`; W2-D51);
- the run's pair index is `cli.mjs`'s `pairIndexOf`, built once per open (W2-D54, W2-D67);
- N's holding copy comes from `derive.mjs`'s `holdingCopyOf`, and N's summary row from lib's `summaryRowFor` over that copy's rows;
- kept(N) is read from `boundaries.kept_blob_id` through `derive.mjs`'s `bodyOf` over `blobReadStmts` (W2-D68 (2), W2-D34 option (a), W2-D38), never through `keptOf`;
- an entry's body comes from `recall.mjs`'s `expandEntryBody`, expand's own pick (W2-D74), whose five state words (D-6238) the driver maps one by one;
- item 3 is the question followed by the gate's `ANSWER_PROTOCOL` (W2-D64, D-5776).

It also does the four things the W2-1 plan and the decisions document hand to "the first W2-5a change that imports these modules":
- it rewords the driver's header sentence "never loads node:sqlite in any form" (the ledger's R1 carry);
- it writes the `keptOf` scan beside its CONTROL (W2-D33, W2-D68);
- it settles the two `recallOffPresence` exports (W2-D29): the driver imports no `recallOffPresence` under any name (R6);
- it ends the double spelling of the four `gate_code` paths (W2-D24; decisions §7): the driver now imports the gate, so `CODE_SHA_FILES` IS the gate's `GATE_CODE_FILES`, and the `CODE_SHA_FILES parity` pin lands here.

**What this task owns for the whole PR (R3, R4, R5).** Later tasks build on these and never spell them again:
- every import statement of the driver and every `EXPECTED_IMPORTS` entry (D-5814), so the module list and the header's `// Imports:` sentence are settled here, once. That includes `node:crypto` (`randomBytes`, used from Task 5) and `../ccd/history/sweep.mjs` (`ftsTextOfBlob`, used from Task 5). A later task adds names inside an existing statement's braces, and updates that module's `EXACT_NAMES` entry in the same commit;
- the store opener, `openReplayStore`, which builds the run's pair index once and reads this node's store id through the same handle: one store open per run;
- the one holding-copy reader (`boundaryCopyOf`), with the one copy-rows query and the one summary pick (`summaryIndexOf`), which admission (Task 3) and Baseline B (Task 4) consume;
- the span reader, `spanRowsOf`, which hands mining (Task 2) leaf N's rows in the store's column names;
- the payload composer, `composePayload` and `renderToolUseLine`, which the fidelity pilot (Task 6) composes through;
- `RECON_DISCARDS`, the one list of boundary discards. Tasks 2, 3 and 4 append their boundary words to it in place (R5);
- `--no-warnings` on the shebang and on every spawn of the driver, and the repair of W2-4 Task 8's `t8Tree`.

**Two consequences no document foresaw, both measured.**
1. Importing `store.mjs` loads `node:sqlite`. That prints Node's `ExperimentalWarning` (two stderr lines) in every process not started with `--no-warnings`. It was measured on v24.14.1, and the warning is printed before an ES module's body runs, so the driver cannot filter it. W2-4's cases compare a spawned driver's stderr whole. So every spawn of the driver gains `--no-warnings`, as every spawn of `cli.mjs` and `sweep.mjs` already does (`historyHelpers.ts`, `ccd/ccd-history-sweep`). The driver's shebang gains it too, because the file is mode 100755.
2. The driver now imports `./history-gate.mjs`. W2-4's `t8Tree` writes fixture bytes for that file (or leaves it out), so a driver copied there could not load. The tree now carries the gate's real bytes, and the one case that left the gate out to reach `code-unmeasured` leaves `measure-history.py` out instead.

**Decisions:**
- W2-D74 (the payload body; `deploy/` holds no second decode);
- W2-D75, items 1 to 3 (the card line is W2-5b's);
- W2-D68 (2) (kept(N) through `bodyOf`; `kept-absent` and `kept-unreadable`; `keptOf` never used);
- W2-D33 (the exports, and the `keptOf` scan W2-1 left to this PR);
- W2-D34 option (a) and W2-D38 (the kept(N) membership);
- W2-D54 (every field redacted whole, then cut);
- W2-D64's composer half (D-5776, defined by W2-3, cited);
- W2-D24 (`gate_code`: which files are hashed);
- W2-D29 (the two `recallOffPresence` contracts);
- W2-D51 (`openReader`; the `node:sqlite` scan);
- W2-D59 (a driver word added by its owner PR: `store-unreadable`).

It cites D-6238 (defined in the W2-1 plan), D-5774 and D-5776 (defined by W2-3), and D-5814 (W2-4's import pin). It ships one departure this plan defines, **D-6277** (`history-replay-pointer-lines`, Choices). The answerability task's departure (W2-D70) is not this task's.

**Files:**
- Modify: `deploy/history-replay.mjs`:
  - line 1, the shebang `#!/usr/bin/env node`, becomes `#!/usr/bin/env -S node --no-warnings`;
  - the header's three lines from `// Imports: node: built-ins, ../ccd/history/lib.mjs and ../shared/roster-json.mjs only. It never loads node:sqlite in` to `// history-replay.test.ts scans every deploy/history-*.mjs for it.` (about :9-11 at cd622b2f6) are reworded (Step 4);
  - `import { randomBytes } from 'node:crypto';` goes directly after `import { fileURLToPath, pathToFileURL } from 'node:url';`;
  - the lib import line `import { EXIT, blobOverDecodeCap, canonicalJson, recallOffPath, redactField, sha256Hex } from '../ccd/history/lib.mjs';` (about :28) gains five names, and six import lines go directly after it, before `import { rosterFromJson, RosterInvalid } from '../shared/roster-json.mjs';` (about :29);
  - `DRIVER_REASONS`'s doc comment, whose last line ends `ends by that signal if it comes after main has removed its listeners: D-5984). */` (about :52), gains one sentence, and the list's last line `  'run-live', 'out-in-use', 'interrupted',` (about :61) is followed by `  'store-unreadable',`;
  - `CODE_SHA_FILES`, with its doc comment `/** The four files whose installed bytes gate_code pins (W2-D24), ...` (about :1886-1888), becomes the gate's list;
  - `codeShas`' doc comment `/** The sha256 of each CODE_SHA_FILES member's bytes under ...` (about :1899-1900) loses its "before W2-3 lands" clause;
  - a new section goes directly above the comment line `// The entry guard stays the LAST block of this file: a module-level declaration below it would still be uninitialised` (about :2511).
- Modify: `server/test/history-replay.test.ts`:
  - an import group goes after `import { DEFAULT_TEST_ROSTER as T6_ROSTER } from './helpers/roster.js';` (about :50);
  - in W2-4 Task 1's word case, `const FIX_ROUND_1 = ['run-live', 'out-in-use', 'interrupted'];   // D-5984, D-5985` (about :142) and its `it` (about :144-149) gain `store-unreadable`;
  - `withHandler`'s doc comment (about :266-269) is corrected;
  - the `node:sqlite` scan's section comment and describe title (about :330-331) are reworded;
  - D-5814's import pin (`const EXPECTED_IMPORTS = [...]` through the `it` that reads `imports exactly its seven modules`, about :3024-3049) is rewritten for fourteen modules and seven exact name lists;
  - the sixteen spawns of the driver, each named by its content in Step 6, gain `--no-warnings`;
  - W2-4 Task 8's section comment (about :3855-3857), `T8_GATE_BYTES` (about :3869), `t8Tree` (about :3912-3929) and the unmeasured case `an unmeasured code sha refuses code-unmeasured, ...` (about :4234-4243) change as Step 6 says;
  - two describes are appended at the end of the file (about :5450).
- Not edited: `ccd/**` (W2-1's exports are consumed as they merged), `deploy/history-gate.mjs` (imported only), `deploy/measure-history.py`, `shared/**`, the spec, README.md and `.github/**`. `single-definition.test.ts`'s O13 and O14 and its W2-D33 block, `measure-history.test.ts` and `history-recall.test.ts` are re-run unedited (Step 9).

**Interfaces:**
- Consumes (merged at cd622b2f6, unchanged):
  - `ccd/history/store.mjs`:
    - `openReader(dbPath): DatabaseSync`, which refuses a missing, zero-byte or unmeasured file with `StoreError(word)` before any open;
    - `userVersion(db): number`;
    - `class StoreError { word: string }`, whose word the caller prints, never its message.
  - `ccd/history/derive.mjs`:
    - `blobReadStmts(db): { blobZ, blobLen }`;
    - `bodyOf(s, blobId, budget: { bytes: number }): unknown`. It answers the parsed body, or null for no row, a tombstone, a damaged blob, non-JSON, JSON null, or an over-cap or unmeasured body;
    - `holdingCopyOf(db, b: { entry_id, transcript_pk }): { file_id, eof_ms, source_key } | null`. It applies lib's `pickHoldingCopy`, and its null means only "no file holds N". It prepares `derive.mjs`'s statement set, INSERTs included, on the handle. On a `query_only` handle a prepare succeeds and only a step refuses (measured on `:memory:` under `PRAGMA query_only = ON`), and nothing here steps a write.
  - `ccd/history/recall.mjs`: `expandEntryBody(rc: { db, version, schema }, e: { entry_id, blob_id }): { state: 'body'|'unparseable'|'tombstone'|'over-cap'|'undecodable', body, primary, causes: string[], blob }`. `blob` is `{ state: 'bytes', bytes: Buffer }` exactly when `state` is `body` or `unparseable` (D-6238).
  - `ccd/history/cli.mjs`: `pairIndexOf(db, home): PairIndex`. Importing `cli.mjs` sets the importing process's umask to 0o077 (about :69), and loads `sweep.mjs`, `recall.mjs` and `store.mjs`. `main` runs only behind the entry guard (about :1700 at cd622b2f6; the decisions document's :1668 is older).
  - `ccd/history/sweep.mjs`: `ftsTextOfBlob`, imported here for Task 5 (R3).
  - `ccd/history/lib.mjs`: `historyPaths(home).dbFile`, `SCHEMA_ADDED`, `UUID_RE`, `summaryRowFor({ boundaryUuid, anchorUuid, rows: { uuid, isCompactSummary, isEcho }[] }): { uuid: string | null, anchorIsBoundary }` and `renderEntryText(body): string`.
  - The store's `nodes` and `node_sources` tables: leaf N is the depth-0 node whose `boundary_entry_id` is N, and its sources are recorded with `ord`, their place in N's holding copy (`derive.mjs`'s leaf writer).
  - `deploy/history-gate.mjs`: `ANSWER_PROTOCOL: string` (three lines, no blank line) and `GATE_CODE_FILES: readonly [four paths]` (frozen).
  - The driver's own W2-4 exports: `redactForSpawn({ text, rawLen }, idx)`, `toolResultText({ text, rawLen }, idx)`, `TOOL_RESULT_CUT` (4000) and `refuse(word, detail)`.
  - Tests: `historyHelpers.ts` (`makeHistoryBox`, `seedFamily`, `runSweep`, `runDriver` (the pass driver), `plantTranscript`, `SEED_SLUG`, `HistoryBox`), `historyFixtures.ts` (`userRow`, `toolUseRow`, `toolResultRow`, `assistantRow`, `boundaryRow`, `summaryRow`) and `tmpHelpers.ts`' `mkTmp`.
- Produces (`deploy/history-replay.mjs`, all exported unless marked):
  - `DRIVER_REASONS` gains `'store-unreadable'`, appended after `'interrupted'`.
  - `CODE_SHA_FILES === GATE_CODE_FILES`: the same frozen array, so the four paths are spelled once.
  - `RECON_DISCARDS: readonly string[]`, frozen: the one list of boundary discards (R5). Task 1's fifteen words come first: `'boundary-absent'`, `'boundary-uncopied'`, `'summary-absent'`, `'summary-unparseable'`, `'summary-tombstone'`, `'summary-over-cap'`, `'summary-undecodable'`, `'kept-absent'`, `'kept-unreadable'`, `'member-tombstone'`, `'member-over-cap'`, `'member-undecodable'`, `'over-decode-cap'`, `'leaf-absent'` and `'body-unrenderable'` (D-6302). Tasks 2, 3 and 4 append theirs in place. It is disjoint from `DRIVER_REASONS` and from the gate's `GATE_REASONS`.
  - `POINTER_REMOVED = '[pointer removed]'`.
  - `removePointerLines(text: string): { text: string, replaced: number }`, pure.
  - `composePayload(parts: { summary: string, kept: readonly string[] }, question: string): string`, pure: items 1 to 3 joined by one blank line, the question (already redacted) followed by `ANSWER_PROTOCOL`. It accepts `''` as the question and empty parts.
  - `renderToolUseLine(name: string, inputText: string): string`, pure: `[tool_use <name>] <input>`, lib's rendering of one tool_use block.
  - `summaryIndexOf(copyRows: { uuid, type, provenance, is_compact_summary }[], boundaryUuid: string, anchorUuid: string | null): number`, pure: the index of lib's `summaryRowFor` pick, or -1.
  - `openReplayStore(home: string): ReplayStore`, where `ReplayStore = { db, storeId, version, schema, blobs, stmts, idx, close }`. It throws `DriverRefusal('store-unreadable', <StoreError word>)` for a store `openReader` refuses, `DriverRefusal('store-unreadable', 'store-id-absent' | 'store-id-unreadable')` for a store whose `meta` holds no UUID store id, and `DriverRefusal('store-unreadable', 'store-read-failed: <sqlite message>')` for SQLite's own error on the open's first reads. Any other throw is a defect.
  - `boundaryCopyOf(rs, boundaryEntryId: number)` answers `{ state: 'copy', boundary: { entry_id, transcript_pk, kept_blob_id, anchor_uuid, uuid }, fileId: number, rows: { line, entry_id, uuid, type, model, provenance, is_compact_summary, ts_ms, blob_id }[], boundaryIndex: number, summaryIndex: number | null }`, or `{ state: 'discard', why: 'boundary-absent' | 'boundary-uncopied' }`. The admission (W2-D66) and Baseline B (W2-D68) tasks read the same answer.
  - `spanRowsOf(rs, boundaryEntryId: number)` answers `{ state: 'span', rows: { entry_id, uuid, type, model, provenance, ts_ms, blob_id }[] }`, leaf N's sources in their recorded order (N's holding copy's file order), or `{ state: 'discard', why: 'leaf-absent' }`.
  - `keptMembersOf(rs, boundary, budget = { bytes: 0 })` answers `{ state: 'kept', uuids: string[] }`, or `{ state: 'discard', why: 'kept-absent' | 'kept-unreadable' }`. A body that is not a list of strings is `kept-unreadable`. The uuids are deduplicated, in first-occurrence order. Baseline B passes its run budget.
  - `keptRowsOf(rs, uuids, fileId): { rows: { entry_id, uuid, type, blob_id, line: number | null }[], absent: number, offCopy: number }`. The rows are in N's holding copy's file order, and members outside that copy come after them, by `entry_id`.
  - `entryBodyOf(rs, row: { entry_id, blob_id })` answers `{ state: 'body' | 'unparseable', body, rawLen }` or `{ state: 'lost', word: 'tombstone' | 'over-cap' | 'undecodable' }`. Any other body state throws a `TypeError` naming it, never a discard with no word (D-6301).
  - `renderKeptMember(row: { type }, k, idx)` answers `{ state: 'text', text }` or `{ state: 'discard', why: 'over-decode-cap' }`.
  - `reconstructPayload(rs, boundaryEntryId: number, question: string)` answers `{ state: 'payload', text, counts: { members, absent, off_copy, unparseable, pointer_lines } }`, or `{ state: 'discard', why: <a RECON_DISCARDS word> }`. A summary or kept-member body that parses and cannot be rendered (nested past `JSON.stringify`'s stack) is the discard `body-unrenderable` (D-6302).
  - Module-private: `replayStmts(db)`, `storeRefusal(e): never`, `reconDiscard(why)`, `renderOrNull(fn)`, `SUMMARY_LOST`, `MEMBER_LOST` and `POINTER_LINE_RE`.
  - Test side, module level for Tasks 3 to 7: `w5a1H` (`historyHelpers`), `w5a1Fx` (`historyFixtures`), `w5a1BeforeAll`.
- Produces (test side):
  - the `w5a1`-prefixed imports;
  - the describe `W2-5a Task 1: the driver reads the store only through W2-1 exports`, which runs everywhere;
  - the describe `W2-5a Task 1: reconstruction from a fixture store`, skipped on darwin.

**How the two `recallOffPresence` exports stay apart (W2-D29).**
- `sweep.mjs`'s `recallOffPresence(home, id)` reads ONE id's file CONTENT through `readBounded(recallOffPath(home, id), CONTROL_FILE_MAX, false)` and answers a Presence (`value`, `absent` or `unreadable`). `decideRecallOff` needs that answer to tell a stale generation from an off one, for the drain and for the CLI's read verbs.
- The driver's `recallOffPresence(home, ids)` lstats a LIST and never opens an entry. Any entry of any type is present (W2-D78(ii): presence alone refuses `family-recall-off`).

The driver imports `sweep.mjs` for its index text (`ftsTextOfBlob`, Task 5) and its registry read (`readRegPresence`, Task 7), and never its `recallOffPresence`, under any name (R6). `cli.mjs` imports sweep's reader but re-exports nothing (no `export {` or `export *` line at cd622b2f6), and the driver's imports from it are named (`{ pairIndexOf }`). So no binding collides. The new import pin (Step 2) pins the exact names imported from each `ccd/history` module beyond `lib.mjs`, and the W2-D29 case refuses any import that binds a `recallOffPresence`. `verify --section ab` (Task 7) reads a control file's content as W2-D84 says, through `historyPaths`, `recallOffPath` and `readBounded`.

**`gate_code` (W2-D24).** The `ccd/history` modules the driver now imports (`store.mjs`, `derive.mjs`, `recall.mjs` and `cli.mjs`) do **not** join the hashed set. W2-D24 says so in terms: "Its imports (recall.mjs, derive.mjs, cli.mjs, store.mjs) are not hashed: they are covered by the `release_tag` comparison and the `tree-moved` preflight." The W2-1 plan says nothing more on it (its "Not in this plan" names only the parity pins). The measured module graph is wider than W2-D24's four names: `sweep.mjs`, `card.mjs`, `ccd/compact-card.mjs` and `shared/base-url.mjs` load too, and `regex-worker.mjs` is spawned by `recall.mjs`. The same release-tag argument covers all of them, so the set stays the four files, and `CODE_SHA_FILES`' comment names the measured graph. The double spelling is ended rather than pinned: the driver imports the gate, so `CODE_SHA_FILES` is `GATE_CODE_FILES` itself (CLAUDE.md, "enumerated once and derived"). A test pins the identity (`toBe`), and W2-4's own case still pins the four literal names.

**Choices this task makes:**
- **A store that cannot be opened or read refuses with a new driver word, `store-unreadable`** (W2-D59: each owner PR adds its own words, and no D-number is needed). Its detail is the `StoreError`'s word alone (`store.mjs`: "the caller prints the word, never the message"), or `store-read-failed: <message>` for SQLite's own error, as `cli.mjs`'s `readFailure` prints it. lib's REASONS has no `store-unreadable` (checked in Step 1), so C-J's disjointness holds.
- **The five body states (D-6238).**

  | State | Kept member | Summary row |
  |---|---|---|
  | `body` | read (expand's pick, so the payload shows what `expand` shows, W2-D74) | read |
  | `unparseable` | read as its stored text, tagged by row type, and counted in `counts.unparseable` | discards N as `summary-unparseable` |
  | `tombstone` | discards N as `member-tombstone` | discards N as `summary-tombstone` |
  | `over-cap` | discards N as `member-over-cap` (W2-D54: never truncated) | discards N as `summary-over-cap` |
  | `undecodable` | discards N as `member-undecodable` | discards N as `summary-undecodable` |

  - **Why `unparseable` is read for a kept member:** the raw-only row is what the session kept, and the W2-1 plan's Choices expect W2-5a to discard on the three body-less words only.
  - **Why it discards N for the summary row:** a line that was never parsed holds its text JSON-escaped, so item 1 could not find the pointer line in it, and the pointer is the leak RV20 names.
  - **Why `undecodable` is never folded into `tombstone`:** it is a damaged store, not a pruned one (D-6238's own argument). The operator's remedy is a doctor or a restore, and a pruned blob has none.
- **The transcript-pointer line is any whole line that names a path ending in `.jsonl`** (`/^.*\/\S*\.jsonl(?![A-Za-z0-9_]).*$/gm`), and each such line becomes `[pointer removed]`. **D-6277.** Neither the spec nor any code or fixture in the tree defines the line. Spec item 1 says "its transcript-pointer line", one line; this rule also removes any other summary line that names a `.jsonl` path. The cost is nil for the quiz: any fact on such a line is in B, which keeps the summary whole with its pointer (W2-D68 (1)), so it is never admitted. The fidelity pilot's token count moves by those lines only. Redaction runs first and the pointer replacement after (W2-D54: whole, then any cut).
- **The item 2 format.**
  - Each block of a kept member is on its own line.
  - A text block, a bare string block and a body that is not a block list are tagged with the row's `entries.type` (`[user] …`, `[assistant] …`).
  - A `tool_use` is `renderToolUseLine(name, JSON of its input)`, which reads exactly as lib's `renderEntryText([b])` does: `[tool_use <name>] <input as JSON>`.
  - A `tool_result` is `[tool_result] ` plus `toolResultText`'s answer: redacted whole, then the first 4,000 code points.
  - Any other block (thinking, image) is `renderEntryText`'s `[<type>]`, with no content.
  - Items and members are joined by one blank line (`\n\n`).
  - W2-D75 names only the two tool tags, and "role-tagged" is read as the row's type for text.
- **The order of kept members.** It is N's holding copy's file order (`memberships.line`), whatever the kept blob's own order. A member present in the store but not in that copy comes after them, by `entry_id`, and is counted (`off_copy`), never discarded. A uuid the store does not hold is skipped and counted (`absent`), as W2-D75's "present in the store" reads.
- **The summary pick.** It is `summaryIndexOf`: lib's `summaryRowFor` with `isEcho = type === 'user' && provenance === 'harness'`, `derive.mjs`'s own inline rule in `copyPlan`. lib exports no helper for the pick (`derive.mjs`'s `copyPlan` and `recall.mjs`'s `summaryLine` are private), so this is a third spelling of the echo rule (Residuals), and the driver's only one: admission and B read it through `boundaryCopyOf`. A CONTROL holds the pick to the leaf derivation minted: the payload's summary row is the blob `nodes.summary_blob_id` names.
- **Leaf N's span is what derivation recorded**, `node_sources` of N's depth-0 node in `ord` order, never a second span rule over the copy. A boundary with no such leaf is `leaf-absent`.
- **The store id is read once, with the open.** `openReplayStore` reads `meta.store_id` through its own handle, so a subcommand never opens the store a second time to learn which node it is on.
- **`--no-warnings` on every spawn that loads the driver, not only on the seven that compare stderr whole.** These are `runDriver`, the entry-guard spawn, `t8Run`, the two Task 8 signal spawns and the two probe signal spawns. The other nine import the driver in a child and read stdout or the status. They gain the flag too, so no spawn of the driver prints the warning, as no spawn of `cli.mjs` or `sweep.mjs` does.
- **The payload reads members with a fresh `{ bytes: 0 }` budget.** Reconstruction reads one boundary at a time, at operator pace. Baseline B (Task 4) passes its own budget to `keptMembersOf`.

**Residuals, named:**
- **The echo rule is spelled a third time** (`derive.mjs`'s `copyPlan`, `recall.mjs`'s `summaryLine` in SQL, and here). No single-definition pin covers it. The parity CONTROL catches a drift on the fixture shape only.
- **kept(N)'s parity with lib's `asOfCut`** cannot be pinned yet: W2-2a has not merged, and `asOfCut` is not on main at cd622b2f6. Both read kept(N) from N's `kept_blob_id` (W2-D34 option (a)). The parity pin (`asOfCut(...).keptUuids` equals `keptMembersOf(...).uuids` as a set) is carried to W2-5b (R8).
- **Importing the driver sets the importing process's umask to 0o077**, through `cli.mjs`, before `main` sets it again (W2-D53). In this test file's fork the worker runs under 0o077 from the import on (vitest's forks pool isolates each file, and `vitest.config.ts` sets no `isolate: false`). The fixtures that need a mode set it explicitly (W2-D33).
- **In a `t8Tree`, two copies of `lib.mjs` load.** The driver and the gate import the tree's copied `lib.mjs`, while `store.mjs`, `derive.mjs`, `recall.mjs` and `cli.mjs`, symlinked and resolved to their real paths, import the checkout's. Step 0a calls none of the store readers, so no value crosses between the two instances in any W2-4 case. A later task that runs reconstruction in a `t8Tree` copies those modules too, or symlinks `lib.mjs`.
- **A spawned driver now loads `cli.mjs`'s module graph.** That is about 25,000 lines beside `lib.mjs`'s, so every spawn in this file starts slower. `MARKER_CHILD`'s deadline is 10 s, and Step 7 measures that its case stays green.

- [ ] **Step 0: Check the base.** From the repository root, before any edit:

```bash
git merge-base --is-ancestor cd622b2f6 HEAD && echo 'base holds W2-1' || echo 'STOP: W2-1 (#1105) is not on this base'
```

Expected: `base holds W2-1`. On `STOP`, make no edit and report to the coordinator.

- [ ] **Step 1: Confirm the anchors, the exports, the names and the warning.** From the repository root:

```bash
grep -c '^#!/usr/bin/env node$' deploy/history-replay.mjs
grep -c "^// Imports: node: built-ins, ../ccd/history/lib.mjs and ../shared/roster-json.mjs only. It never loads node:sqlite in$" deploy/history-replay.mjs
grep -c "^import { EXIT, blobOverDecodeCap, canonicalJson, recallOffPath, redactField, sha256Hex } from '../ccd/history/lib.mjs';$" deploy/history-replay.mjs
grep -c "^  'run-live', 'out-in-use', 'interrupted',$" deploy/history-replay.mjs
grep -c "^export const CODE_SHA_FILES = Object.freeze(\['deploy/history-gate.mjs', 'deploy/measure-history.py', 'deploy/history-replay.mjs', 'ccd/history/lib.mjs'\]);$" deploy/history-replay.mjs
grep -c '^// The entry guard stays the LAST block of this file' deploy/history-replay.mjs
grep -cE '\bkeptOf\b|openReplayStore|reconstructPayload|RECON_DISCARDS|store-unreadable' deploy/history-replay.mjs
grep -cE '^export (\*|\{)' ccd/history/cli.mjs
grep -c "^import { DEFAULT_TEST_ROSTER as T6_ROSTER } from './helpers/roster.js';$" server/test/history-replay.test.ts
grep -c "const T8_GATE_BYTES = '// fixture bytes for deploy/history-gate.mjs (W2-4 Task 8)\\\\n';" server/test/history-replay.test.ts
node --no-warnings --input-type=module -e "
const st = await import('./ccd/history/store.mjs'); const d = await import('./ccd/history/derive.mjs');
const r = await import('./ccd/history/recall.mjs'); const c = await import('./ccd/history/cli.mjs');
const l = await import('./ccd/history/lib.mjs'); const g = await import('./deploy/history-gate.mjs');
console.log([typeof st.openReader, typeof st.userVersion, typeof st.StoreError, typeof d.blobReadStmts, typeof d.bodyOf,
  typeof d.holdingCopyOf, typeof r.expandEntryBody, typeof c.pairIndexOf, typeof l.summaryRowFor, typeof l.renderEntryText,
  typeof l.SCHEMA_ADDED, typeof g.ANSWER_PROTOCOL, g.GATE_CODE_FILES.length, Object.hasOwn(l.REASONS, 'store-unreadable'),
  g.ANSWER_PROTOCOL.includes('\n\n')].join(' '))"
node --input-type=module -e "await import('node:sqlite');" 2>&1 | grep -c 'ExperimentalWarning'
```

Expected (predicted from cd622b2f6's text):
- `1`, `1`, `1`, `1`, `1`, `1`;
- `0`: no name this task adds is taken;
- `0`: `cli.mjs` re-exports nothing;
- `1`, `1`;
- the node line prints `function function function function function function function function function function object string 4 false false`;
- the last line prints `1`: this Node warns on loading `node:sqlite` (measured on v24.14.1; CI's node-floor leg runs 22.16.0, predicted `1`).

On any other count, stop and report the anchor that moved. If the warning line prints `0`, the `--no-warnings` edits are still made (the CLI's convention), and Step 5's predicted red for the warning does not occur. Report that.

- [ ] **Step 2: Write the failing tests.** Five edits to `server/test/history-replay.test.ts`, all test-side, made before any driver edit.

(a) After `import { DEFAULT_TEST_ROSTER as T6_ROSTER } from './helpers/roster.js';`, add:

```ts
// W2-5a Task 1 (W2-D74, W2-D75, W2-D33, W2-D24): w5a1-prefixed bindings, so none collides with a binding above. The
// fixture store is built by the real sweep in a historyHelpers box (a mkTmp HOME whose PATH holds the poisoned gh) and
// read here, in process, through the driver's exports.
import { beforeAll as w5a1BeforeAll } from 'vitest';
import { DatabaseSync as W5a1Db } from 'node:sqlite';
import { brotliCompressSync as w5a1Brotli } from 'node:zlib';
import * as w5a1H from './historyHelpers.js';
import * as w5a1Fx from './historyFixtures.js';
import * as w5a1Lib from '../../ccd/history/lib.mjs';
import * as w5a1Derive from '../../ccd/history/derive.mjs';
import * as w5a1Recall from '../../ccd/history/recall.mjs';
import * as w5a1Gate from '../../deploy/history-gate.mjs';
import * as w5a1Drv from '../../deploy/history-replay.mjs';
```

(b) In W2-4 Task 1's word case, replace

```ts
  const FIX_ROUND_1 = ['run-live', 'out-in-use', 'interrupted'];   // D-5984, D-5985

  it('DRIVER_REASONS is frozen, duplicate-free, and exactly W2-D59\'s sixteen words in order, then W2-4\'s nine, then fix round 1\'s three', () => {
    expect(W2_D59).toHaveLength(16);
    expect(Object.isFrozen(replay.DRIVER_REASONS)).toBe(true);
    expect(new Set(replay.DRIVER_REASONS).size, 'a word is listed twice').toBe(replay.DRIVER_REASONS.length);
    expect([...replay.DRIVER_REASONS]).toEqual([...W2_D59, ...PLAN_CHOSEN, ...FIX_ROUND_1]);
  });
```

with

```ts
  const FIX_ROUND_1 = ['run-live', 'out-in-use', 'interrupted'];   // D-5984, D-5985
  const W2_5A = ['store-unreadable'];   // W2-5a Task 1: a store this node cannot open or read (W2-D59, its owner PR's word)

  it('DRIVER_REASONS is frozen, duplicate-free, and exactly W2-D59\'s sixteen words in order, then W2-4\'s nine, then fix round 1\'s three, then W2-5a\'s', () => {
    expect(W2_D59).toHaveLength(16);
    expect(Object.isFrozen(replay.DRIVER_REASONS)).toBe(true);
    expect(new Set(replay.DRIVER_REASONS).size, 'a word is listed twice').toBe(replay.DRIVER_REASONS.length);
    expect([...replay.DRIVER_REASONS]).toEqual([...W2_D59, ...PLAN_CHOSEN, ...FIX_ROUND_1, ...W2_5A]);
  });
```

(c) Replace the two lines

```ts
// ── W2-4 Task 1: W2-D51, no deploy/history-*.mjs loads node:sqlite ────────
describe('history-replay W2-4 Task 1: no deploy/history-*.mjs loads node:sqlite (W2-D51)', () => {
```

with

```ts
// ── W2-4 Task 1: W2-D51, no deploy/history-*.mjs spells a node:sqlite specifier. From W2-5a Task 1 the driver loads it, but only
// through store.mjs (its one importer), whose openReader is every store read's door; D-5814's import pin names store.mjs.
describe('history-replay W2-4 Task 1: no deploy/history-*.mjs spells a node:sqlite specifier (W2-D51)', () => {
```

(d) Replace D-5814's block, from `  // D-5814: the import block is exactly the seven modules the plan names, and node:child_process brings in `spawn` only,` through the closing `});` of `it('deploy/history-replay.mjs imports exactly its seven modules, and node:child_process brings in spawn only', ...)`, with:

```ts
  // D-5814, widened by W2-5a Task 1: the import block is exactly the fourteen modules W2-5a's driver loads, every one
  // added here once (R3). node:child_process brings in `spawn` only, and node:crypto and each ccd/history module beyond
  // lib.mjs bring in exactly the names the plan's tasks use (W2-D33, W2-D74). A later W2-5a task that adds a name to a
  // module's braces updates that module's entry here in the same commit. So no edit adds a second reader unseen: keptOf
  // (W2-D68), sweep.mjs's recall-off content reader (W2-D29, R6) or a decode of its own. W2-D24's code hash covers the
  // driver and the gate. The other ccd/history modules ride the release tag (W2-D24).
  const EXPECTED_IMPORTS = ['node:fs', 'node:os', 'node:path', 'node:child_process', 'node:url', 'node:crypto',
    '../ccd/history/lib.mjs', '../ccd/history/store.mjs', '../ccd/history/derive.mjs', '../ccd/history/recall.mjs',
    '../ccd/history/cli.mjs', '../ccd/history/sweep.mjs', './history-gate.mjs', '../shared/roster-json.mjs'];
  const EXACT_NAMES: Record<string, string> = {
    'node:child_process': '{ spawn }',
    'node:crypto': '{ randomBytes }',
    '../ccd/history/store.mjs': '{ StoreError, openReader, userVersion }',
    '../ccd/history/derive.mjs': '{ blobReadStmts, bodyOf, holdingCopyOf }',
    '../ccd/history/recall.mjs': '{ expandEntryBody }',
    '../ccd/history/cli.mjs': '{ pairIndexOf }',
    '../ccd/history/sweep.mjs': '{ ftsTextOfBlob }',
  };
  const importViolations = (text: string): string[] => {
    const found: string[] = [];
    const froms = [...text.matchAll(/^import\s+([^;]*?)\s*from\s*'([^']+)';/gms)];
    if (JSON.stringify(froms.map((m) => m[2])) !== JSON.stringify(EXPECTED_IMPORTS)) found.push(`imports ${froms.map((m) => m[2]).join(', ')}`);
    for (const m of froms) {
      const want = EXACT_NAMES[m[2]!];
      if (want !== undefined && m[1]!.trim() !== want) found.push(`${m[2]} brings in ${m[1]}`);
    }
    for (const l of text.split('\n')) {
      if (isComment(l.trim())) continue;
      if (/^import\s*['"]/.test(l) || /\bimport\s*\(/.test(l) || /\brequire\s*\(/.test(l)) found.push(`side-effect or dynamic load ${l.trim()}`);
    }
    return found;
  };
  it('CONTROL: the import scan sees spawnSync, a stray history-gate specifier, node:fs/promises, a dynamic import, a missing module, keptOf from derive.mjs and sweep.mjs\'s recall-off reader', () => {
    const real = t5fs.readFileSync(SRC, 'utf8');
    expect(importViolations(real), 'the driver itself').toEqual([]);
    const variants: Array<[string, string]> = [
      ['spawnSync', real.replace("import { spawn } from 'node:child_process';", "import { spawn, spawnSync } from 'node:child_process';")],
      ['history-gate', real.replace("import { rosterFromJson", "import { x } from '../deploy/history-gate.mjs';\nimport { rosterFromJson")],
      ['fs/promises', real.replace("import os from 'node:os';", "import os from 'node:os';\nimport { readFile } from 'node:fs/promises';")],
      ['dynamic', real + "\nconst m = await import('node:sqlite');\n"],
      ['missing', real.replace("import os from 'node:os';\n", '')],
      // The two below edit a module's braces by pattern, so they hold whatever names later tasks add there.
      ['keptOf', real.replace(/^import \{ ([^}]*) \} from '\.\.\/ccd\/history\/derive\.mjs';$/m, (_m, n: string) => `import { ${n}, keptOf } from '../ccd/history/derive.mjs';`)],
      ['sweep reader', real.replace(/^import \{ ([^}]*) \} from '\.\.\/ccd\/history\/sweep\.mjs';$/m, (_m, n: string) => `import { ${n}, recallOffPresence as sweepPresence } from '../ccd/history/sweep.mjs';`)],
    ];
    for (const [label, text] of variants) {
      expect(text, `${label}: the variant differs from the driver`).not.toBe(real);
      expect(importViolations(text), label).not.toEqual([]);
    }
  });
  it('deploy/history-replay.mjs imports exactly its fourteen modules, and node:child_process, node:crypto and each ccd/history module beyond lib.mjs bring in exactly their pinned names', () => {
    expect(importViolations(t5fs.readFileSync(SRC, 'utf8'))).toEqual([]);
  });
```

(e) Append at the end of the file:

```ts
// ── W2-5a Task 1: reconstruction reads the store through W2-1's exports (W2-D74, W2-D75, W2-D33, W2-D68 (2), W2-D54,
// W2-D24, W2-D29) ────────────────────────────────────────────────────────────────────────────────────────────────────
// The scans and pure cases run everywhere. The store cases run on ONE fixture HOME (historyHelpers' makeHistoryBox: a
// mkTmp HOME whose PATH holds ccrcContainedEnv's poisoned gh, ssh, curl and managers). The real sweep builds its store
// from planted transcripts, as history-recall's W2-D33 block builds its own: no live store, no model and no claude are
// touched or spawned. The cases read it in this process through the driver's exports, and change it only through a
// writer handle on the fixture store, putting every column back in a finally.
type W5a1Rs = { db: W5a1Db; close: () => void } & Record<string, unknown>;
type W5a1Payload =
  | { state: 'payload'; text: string; counts: { members: number; absent: number; off_copy: number; unparseable: number; pointer_lines: number } }
  | { state: 'discard'; why: string };
const w5a1 = w5a1Drv as unknown as {
  openReplayStore(home: string): W5a1Rs;
  reconstructPayload(rs: W5a1Rs, boundaryEntryId: number, question: string): W5a1Payload;
  boundaryCopyOf(rs: W5a1Rs, boundaryEntryId: number): { state: string; rows: Array<{ blob_id: number; uuid: string }>; summaryIndex: number | null };
  spanRowsOf(rs: W5a1Rs, boundaryEntryId: number): { state: 'span'; rows: Array<Record<string, unknown>> } | { state: 'discard'; why: string };
  composePayload(parts: { summary: string; kept: readonly string[] }, question: string): string;
  renderToolUseLine(name: string, inputText: string): string;
  removePointerLines(text: string): { text: string; replaced: number };
  RECON_DISCARDS: readonly string[];
  POINTER_REMOVED: string;
  CODE_SHA_FILES: readonly string[];
  DRIVER_REASONS: readonly string[];
  TOOL_RESULT_CUT: number;
  DriverRefusal: new (word: string, detail: string) => Error & { word: string; detail: string };
};
const w5a1D = w5a1Derive as unknown as {
  blobReadStmts(db: W5a1Db): Record<string, unknown>;
  bodyOf(s: Record<string, unknown>, blobId: number, budget: { bytes: number }): unknown;
  keptOf(s: Record<string, unknown>, blobId: number | null, budget: { bytes: number }): Set<string>;
};
const w5a1R = w5a1Recall as unknown as {
  expandEntryBody(rc: unknown, e: { entry_id: number; blob_id: number }): { state: string; body: unknown; primary: unknown; causes: string[] };
};
const W5A1_DEPLOY = path.join(REPO, 'deploy');
const w5a1DeployMjs = (): string[] => readdirSync(W5A1_DEPLOY).filter((f) => f.endsWith('.mjs')).sort();
/** A deploy file's code lines: a line whose trimmed start is //, * or /* is prose, which may name what the code never calls. */
const w5a1Code = (f: string): string[] => readFileSync(path.join(W5A1_DEPLOY, f), 'utf8').split('\n').filter((l) => !/^\s*(?:\/\/|\*|\/\*)/.test(l));
const W5A1_KEPT_OF = /\bkeptOf\b/;
const W5A1_DECODE = /\bunbrotli(?:Prefix)?\b|\bbrotliDecompress(?:Sync)?\b|\bcreateBrotliDecompress\b|(['"`])node:zlib\1/;
/** Every word the store cases below answer: each must be a RECON_DISCARDS member. */
const W5A1_SEEN_DISCARDS = ['boundary-absent', 'boundary-uncopied', 'summary-absent', 'summary-unparseable', 'summary-tombstone',
  'summary-over-cap', 'summary-undecodable', 'kept-absent', 'kept-unreadable', 'member-tombstone', 'member-over-cap', 'member-undecodable'];

describe('W2-5a Task 1: the driver reads the store only through W2-1 exports', () => {
  it('CONTROL: the keptOf pattern sees an import, a call, a namespace read and an alias, and not another name; the corpus holds the driver and the gate, and the driver reads kept lists through bodyOf', () => {
    for (const planted of ["import { bodyOf, keptOf } from '../ccd/history/derive.mjs';", 'const kept = keptOf(s, b.kept_blob_id, budget);',
      'const v = derive.keptOf(s, id, { bytes: 0 });', "import { keptOf as readKept } from '../ccd/history/derive.mjs';"]) {
      expect(W5A1_KEPT_OF.test(planted), planted).toBe(true);
    }
    expect(W5A1_KEPT_OF.test('const keptOfficial = 1;')).toBe(false);
    expect(w5a1DeployMjs()).toEqual(expect.arrayContaining(['history-gate.mjs', 'history-replay.mjs']));
    expect(w5a1Code('history-replay.mjs').some((l) => /\bbodyOf\(/.test(l)), 'CONTROL: the driver does read a kept list, through bodyOf').toBe(true);
  });

  it('no deploy/*.mjs names keptOf on a code line (W2-D33, W2-D68): a NULL id, a tombstone and a body that is not a list would fold into one empty set', () => {
    expect(w5a1DeployMjs().filter((f) => w5a1Code(f).some((l) => W5A1_KEPT_OF.test(l)))).toEqual([]);
  });

  it('no deploy/*.mjs decodes a blob itself (W2-D74): no unbrotli, brotliDecompress or node:zlib on a code line; CONTROL: the pattern sees each', () => {
    for (const planted of ["import { unbrotli } from '../ccd/history/store.mjs';", 'const b = brotliDecompressSync(z);',
      "import zlib from 'node:zlib';", 'const s = createBrotliDecompress();']) expect(W5A1_DECODE.test(planted), planted).toBe(true);
    expect(W5A1_DECODE.test('const body = bodyOf(rs.blobs, id, { bytes: 0 });')).toBe(false);
    expect(w5a1DeployMjs().filter((f) => w5a1Code(f).some((l) => W5A1_DECODE.test(l)))).toEqual([]);
  });

  it('CODE_SHA_FILES parity (W2-D24, decisions §7): CODE_SHA_FILES is the gate\'s GATE_CODE_FILES itself, so the four gate_code paths are spelled once', () => {
    expect(w5a1.CODE_SHA_FILES).toBe(w5a1Gate.GATE_CODE_FILES);
    expect([...w5a1Gate.GATE_CODE_FILES], 'CONTROL: the four W2-D24 names')
      .toEqual(['deploy/history-gate.mjs', 'deploy/measure-history.py', 'deploy/history-replay.mjs', 'ccd/history/lib.mjs']);
    expect(w5a1Code('history-replay.mjs').filter((l) => l.includes("'deploy/measure-history.py'")), 'the driver spells no gate_code path').toEqual([]);
  });

  it('W2-D29 (R6): the driver\'s recallOffPresence is its own (home, ids) lstat; no driver import binds a recallOffPresence under any name, and cli.mjs re-exports nothing', () => {
    const IMPORT = /^import\s+([^;]*?)\s*from\s*'([^']+)';/gms;
    const bindsReader = (i: RegExpMatchArray): boolean => /\brecallOffPresence\b/.test(i[1]!);
    for (const planted of ["import { recallOffPresence as sweepPresence } from '../ccd/history/sweep.mjs';", "import { ftsTextOfBlob, recallOffPresence } from '../ccd/history/sweep.mjs';"]) {
      expect([...planted.matchAll(IMPORT)].some(bindsReader), `CONTROL: ${planted}`).toBe(true);
    }
    expect([..."import { ftsTextOfBlob } from '../ccd/history/sweep.mjs';".matchAll(IMPORT)].some(bindsReader), 'CONTROL: another sweep.mjs name is not the reader').toBe(false);
    const src = readFileSync(SCRIPT, 'utf8');
    const imports = [...src.matchAll(IMPORT)];
    expect(imports.length, 'CONTROL: the scan read the import block').toBeGreaterThan(5);
    expect(imports.filter(bindsReader).map((i) => i[0])).toEqual([]);
    expect(src.split('\n').filter((l) => /^export function recallOffPresence\(/.test(l))).toEqual(['export function recallOffPresence(home, ids) {']);
    const cli = readFileSync(path.join(REPO, 'ccd', 'history', 'cli.mjs'), 'utf8').split('\n');
    expect(cli.filter((l) => /^export\s*(?:\*|\{)/.test(l)), 'cli.mjs re-exports nothing, so importing pairIndexOf brings no second reader').toEqual([]);
    expect(cli.some((l) => l.includes("recallOffPresence } from './sweep.mjs';")), 'CONTROL: cli.mjs imports sweep\'s reader').toBe(true);
  });

  it('RECON_DISCARDS is frozen, duplicate-free, Task 1\'s fourteen words first, holds every word the store cases answer, and is disjoint from DRIVER_REASONS and GATE_REASONS: a discard is a count, never a refusal (R5)', () => {
    expect(Array.isArray(w5a1.RECON_DISCARDS) && Object.isFrozen(w5a1.RECON_DISCARDS)).toBe(true);
    // Tasks 2, 3 and 4 append their boundary words after these, in place, each pinning its own slice.
    expect(w5a1.RECON_DISCARDS.slice(0, 14)).toEqual(['boundary-absent', 'boundary-uncopied', 'summary-absent', 'summary-unparseable',
      'summary-tombstone', 'summary-over-cap', 'summary-undecodable', 'kept-absent', 'kept-unreadable', 'member-tombstone',
      'member-over-cap', 'member-undecodable', 'over-decode-cap', 'leaf-absent']);
    expect(new Set(w5a1.RECON_DISCARDS).size).toBe(w5a1.RECON_DISCARDS.length);
    expect(W5A1_SEEN_DISCARDS.filter((w) => !w5a1.RECON_DISCARDS.includes(w))).toEqual([]);
    expect(w5a1.RECON_DISCARDS.filter((w) => w5a1.DRIVER_REASONS.includes(w))).toEqual([]);
    expect(w5a1.RECON_DISCARDS.filter((w) => (w5a1Gate.GATE_REASONS as readonly string[]).includes(w))).toEqual([]);
  });

  it('W2-D75 item 3 and W2-D64: composePayload joins the summary, each kept member and the question by one blank line, the question followed by ANSWER_PROTOCOL; an empty question and empty parts still carry it; renderToolUseLine is lib\'s tool_use rendering', () => {
    expect(w5a1.composePayload({ summary: 's', kept: ['a', 'b'] }, 'q')).toBe(`s\n\na\n\nb\n\nq\n\n${w5a1Gate.ANSWER_PROTOCOL}`);
    expect(w5a1.composePayload({ summary: '', kept: [] }, '')).toBe(`\n\n\n\n${w5a1Gate.ANSWER_PROTOCOL}`);
    const input = { file_path: '/home/u/tree/demo/b.md' };
    expect(w5a1.renderToolUseLine('Read', JSON.stringify(input))).toBe('[tool_use Read] {"file_path":"/home/u/tree/demo/b.md"}');
    expect(w5a1.renderToolUseLine('Read', JSON.stringify(input)), 'CONTROL: lib\'s rendering of the same block')
      .toBe(w5a1Lib.renderEntryText([{ type: 'tool_use', id: 'toolu_01W5A1R', name: 'Read', input }]));
  });

  it('item 1 (W2-D75): removePointerLines replaces each whole line naming a .jsonl path with [pointer removed], and nothing else', () => {
    const ptr = 'If you need specific details from before compaction, read the full transcript at: /home/u/.claude/projects/-home-u-tree-demo/abc.jsonl';
    const text = ['1. Primary Request and Intent:', '   keep /home/u/tree/demo/b.md', ptr, 'Continue from where it left off.'].join('\n');
    expect(w5a1.removePointerLines(text)).toEqual({
      text: ['1. Primary Request and Intent:', '   keep /home/u/tree/demo/b.md', '[pointer removed]', 'Continue from where it left off.'].join('\n'), replaced: 1,
    });
    expect(w5a1.POINTER_REMOVED).toBe('[pointer removed]');
    // CONTROL: a .jsonl name with no path, a path ending .jsonlx and a text with no pointer are left alone.
    for (const keep of ['the file notes.jsonl', 'see /home/u/tree/x.jsonlx', 'no pointer here']) expect(w5a1.removePointerLines(keep)).toEqual({ text: keep, replaced: 0 });
    expect(w5a1.removePointerLines(`${ptr}\n${ptr}`).replaced, 'every such line').toBe(2);
  });

  it('openReplayStore refuses store-unreadable with the store\'s own word, never its message: a missing store and a zero-byte one (W2-D51)', () => {
    const answer = (home: string): [string, string] => {
      try { w5a1.openReplayStore(home).close(); return ['opened', '']; } catch (e) {
        expect(e).toBeInstanceOf(w5a1.DriverRefusal);
        const r = e as { word: string; detail: string };
        return [r.word, r.detail];
      }
    };
    expect(answer(mkTmp('ccrc-w5a1-nostore-'))).toEqual(['store-unreadable', 'store-missing']);
    const zero = mkTmp('ccrc-w5a1-zerostore-');
    const f = w5a1Lib.historyPaths(zero).dbFile;
    mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
    writeFileSync(f, '', { mode: 0o600 });
    expect(answer(zero)).toEqual(['store-unreadable', 'store-zero-byte']);
    expect(statSync(f).size, 'the open adopted nothing').toBe(0);
  });

  it('the driver runs under --no-warnings: its shebang passes the flag', () => {
    expect(readFileSync(SCRIPT, 'utf8').split('\n')[0]).toBe('#!/usr/bin/env -S node --no-warnings');
  });

  it('importing the driver loads cli.mjs, which sets the importing process\'s umask to 0o077, and runs no main (W2-D33)', () => {
    const code = ['process.umask(0o022);', `await import(${JSON.stringify(pathToFileURL(SCRIPT).href)});`, 'console.log(String(process.umask(0o022)));'].join('\n');
    const r = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', code],
      { encoding: 'utf8', timeout: 60_000, env: { ...scrubbedEnv(process.env), HOME: mkTmp('ccrc-w5a1-umask-') } });
    expect(r.status, r.stderr).toBe(0);
    expect([r.stdout, r.stderr], 'the umask is 0o077 after the import, and neither main printed').toEqual([`${0o077}\n`, '']);
  });
});

describe.skipIf(process.platform === 'darwin')('W2-5a Task 1: reconstruction from a fixture store', () => {
  const ID = 'claude-a-w5a1';
  const GEN = '0189abcd-1234-4678-9abc-0000000005a1';
  const TAG = 'a5a10001';
  const u = (i: number): string => `${TAG}-0000-4000-8000-${String(i).padStart(12, '0')}`;
  const ts = (i: number): string => new Date(Date.UTC(2026, 9, 1, 10, 0, i)).toISOString();
  const SID = u(0);
  const HEAVY = 120_000;
  /** The run's secret: a fixture token under ~/.ccrc, written after every sweep, so only pairIndexOf's read of it redacts it.
   *  Assembled at run time; no fixture value is key-shaped. */
  const SECRET = ['zq', 'w5a1', 'plain', 'words', 'value'].join('-');
  const POINTER = `If you need specific details from before compaction, read the full transcript at: /home/u/.claude/projects/${w5a1H.SEED_SLUG}/${SID}.jsonl`;
  const SUMMARY = ['<summary>', '1. Primary Request and Intent:', '   zqw5a1 intent', `   zqw5a1 token ${SECRET}`, '9. Optional Next Step:',
    '   zqw5a1 next step', '</summary>', POINTER, 'Continue from where it left off.'].join('\n');
  const RESULT = `zqw5a1 result ${SECRET} ${'r '.repeat(2500)}end`;
  const QUESTION = `Which file did the session read first? ${SECRET}`;
  // W2-D54: the run's secret sits in every part kind, the summary, a user text block and a tool_use input as well as the
  // tool_result and the question, so each redaction call is pinned by its own part (mutants M19 and M20).
  const USER_PART = `[user] zqw5a1 open the app ${w5a1Lib.REDACTED_MARK}`;
  const READ_LINE = `[tool_use Read] {"file_path":"/home/u/tree/demo/b.md","note":"${w5a1Lib.REDACTED_MARK}"}`;
  let box: w5a1H.HistoryBox;
  let dbFile = '';
  /** Leaf N's rows. Its kept list names u(3), u(1), u(2) out of file order, and u(9), which no copy holds. u(4) is not
   *  kept. The first text block of u(2) is `fill`: "..." in the copy seeded first, "" in the second, a ccd-sanitize pair. */
  const rows = (fill: string): object[] => {
    const read = w5a1Fx.toolUseRow({ uuid: u(2), ts: ts(2), parentUuid: u(1), sessionId: SID, toolUseId: 'toolu_01W5A1', name: 'Read', input: { file_path: '/home/u/tree/demo/b.md', note: SECRET } });
    const m = read['message'] as { content: unknown[] };
    m.content = [{ type: 'text', text: fill }, ...m.content];
    return [
      w5a1Fx.userRow({ uuid: u(1), ts: ts(1), sessionId: SID, text: `zqw5a1 open the app ${SECRET}` }),
      read,
      w5a1Fx.toolResultRow({ uuid: u(3), ts: ts(3), parentUuid: u(2), sessionId: SID, toolUseId: 'toolu_01W5A1', content: RESULT }),
      w5a1Fx.assistantRow({ uuid: u(4), ts: ts(4), parentUuid: u(3), sessionId: SID, text: 'zqw5a1 not kept' }),
      w5a1Fx.boundaryRow({ uuid: u(5), ts: ts(5), parentUuid: u(4), sessionId: SID, trigger: 'manual', headUuid: u(4), anchorUuid: u(6),
        tailUuid: u(4), allUuids: [u(3), u(1), u(2), u(9)] }),
      w5a1Fx.summaryRow({ uuid: u(6), ts: ts(6), parentUuid: u(5), sessionId: SID, text: SUMMARY }),
    ];
  };

  w5a1BeforeAll(() => {
    box = w5a1H.makeHistoryBox('ccrc-w5a1-');
    dbFile = w5a1Lib.historyPaths(box.home).dbFile;
    // The sanitised copy is seeded FIRST, so its entries' primary bodies are the "..." ones (history-recall's DM2b shape),
    // and one more tick derives leaf N.
    const seeded = w5a1H.seedFamily(box, { id: ID, project: 'demo', generation: GEN, uuid: SID, rows: rows('...') });
    const t = w5a1H.runSweep(box);
    expect(t.code, t.stderr).toBe(0);
    w5a1H.plantTranscript(box, 'claude-b', path.basename(path.dirname(seeded.transcript)), SID, rows(''));
    // Two discovery passes (SCAN_INTERVAL_MS) find and ingest the second copy.
    for (let k = 0; k < 2; k += 1) {
      const r = w5a1H.runDriver(box, { offsetMs: w5a1Lib.SCAN_INTERVAL_MS + 60_000 });
      expect(r.code, r.stderr).toBe(0);
    }
    writeFileSync(path.join(box.home, '.ccrc', 'w5a1.token'), `${SECRET}\n`, { mode: 0o600 });
  }, 3 * HEAVY);

  const ro = <T,>(fn: (db: W5a1Db) => T): T => { const db = new W5a1Db(dbFile, { readOnly: true }); try { return fn(db); } finally { db.close(); } };
  const rw = <T,>(fn: (db: W5a1Db) => T): T => { const db = new W5a1Db(dbFile); try { return fn(db); } finally { db.close(); } };
  const idOf = (uuid: string): number => ro((db) => Number((db.prepare('SELECT entry_id FROM entries WHERE uuid = ?').get(uuid) as { entry_id: number }).entry_id));
  const blobOf = (uuid: string): number => ro((db) => Number((db.prepare('SELECT blob_id FROM entries WHERE uuid = ?').get(uuid) as { blob_id: number }).blob_id));
  const keptBlob = (): number => ro((db) => Number((db.prepare('SELECT kept_blob_id AS k FROM boundaries WHERE entry_id = ?').get(idOf(u(5))) as { k: number }).k));
  /** A read handle through the driver's own open, closed after `fn`. */
  const withStore = <T,>(fn: (rs: W5a1Rs) => T): T => { const rs = w5a1.openReplayStore(box.home); try { return fn(rs); } finally { rs.close(); } };
  const payload = (q: string = QUESTION): W5a1Payload => withStore((rs) => w5a1.reconstructPayload(rs, idOf(u(5)), q));
  const parts = (p: W5a1Payload): string[] => {
    expect(p.state, JSON.stringify(p).slice(0, 200)).toBe('payload');
    return (p as { text: string }).text.split('\n\n');
  };
  const picked = (uuid: string) => withStore((rs) => w5a1R.expandEntryBody(rs, { entry_id: idOf(uuid), blob_id: blobOf(uuid) }));
  type BlobCols = { z: Uint8Array | null; raw_len: number; pruned_ms: number | null };
  /** Sets a blob's stored columns for `fn`, then puts back the three it read. */
  const withBlob = <T,>(blobId: number, set: Partial<BlobCols>, fn: () => T): T => {
    const orig = ro((db) => db.prepare('SELECT z, raw_len, pruned_ms FROM blobs WHERE blob_id = ?').get(blobId)) as BlobCols;
    const put = (v: BlobCols): void => rw((db) => { db.prepare('UPDATE blobs SET z = ?, raw_len = ?, pruned_ms = ? WHERE blob_id = ?').run(v.z, v.raw_len, v.pruned_ms, blobId); });
    put({ ...orig, ...set });
    try { return fn(); } finally { put(orig); }
  };
  type BoundaryCols = { kept_blob_id: number | null; anchor_uuid: string | null };
  /** Sets boundary N's kept id or anchor for `fn`, then puts both back. */
  const withBoundary = <T,>(set: Partial<BoundaryCols>, fn: () => T): T => {
    const b = idOf(u(5));
    const orig = ro((db) => db.prepare('SELECT kept_blob_id, anchor_uuid FROM boundaries WHERE entry_id = ?').get(b)) as BoundaryCols;
    const put = (v: BoundaryCols): void => rw((db) => { db.prepare('UPDATE boundaries SET kept_blob_id = ?, anchor_uuid = ? WHERE entry_id = ?').run(v.kept_blob_id, v.anchor_uuid, b); });
    put({ ...orig, ...set });
    try { return fn(); } finally { put(orig); }
  };
  /** A body stored as the store stores one: brotli bytes and the raw length. */
  const stored = (text: string): { z: Uint8Array; raw_len: number } => { const b = Buffer.from(text, 'utf8'); return { z: w5a1Brotli(b), raw_len: b.length }; };

  it('W2-D74: a kept member\'s body is expand\'s pick, the unsanitised side, never the sanitised primary', () => {
    const k = picked(u(2));
    expect([k.state, (k.primary as Array<{ text?: string }>)[0]!.text, k.causes], 'CONTROL: the primary is the sanitised copy, seeded first, paired ccd-sanitize')
      .toEqual(['body', '...', ['ccd-sanitize']]);
    expect(parts(payload())[2]).toBe(`[assistant] \n${READ_LINE}`);
  }, HEAVY);

  it('item 1 (W2-D75): the summary row\'s text, redacted whole, with its transcript-pointer line replaced by [pointer removed]', () => {
    expect(picked(u(6)).body, 'CONTROL: the stored summary names the transcript').toBe(SUMMARY);
    const p = payload();
    expect(parts(p)[0]).toBe(SUMMARY.replace(POINTER, '[pointer removed]').replace(SECRET, w5a1Lib.REDACTED_MARK));
    expect((p as { counts: { pointer_lines: number } }).counts.pointer_lines).toBe(1);
  }, HEAVY);

  it('item 2 (W2-D75, W2-D68 (2)): kept(N) members present in the store, in the holding copy\'s file order, role-tagged; a row outside kept(N) is not there', () => {
    const p = payload();
    const ps = parts(p);
    expect(ps, 'summary, three members, question, protocol').toHaveLength(6);
    expect(ps[1]).toBe(USER_PART);
    expect(ps[3]!.startsWith('[tool_result] zqw5a1 result ')).toBe(true);
    expect((p as { text: string }).text).not.toContain('zqw5a1 not kept');
    expect((p as { counts: object }).counts).toEqual({ members: 3, absent: 1, off_copy: 0, unparseable: 0, pointer_lines: 1 });
    const list = withStore((rs) => w5a1D.bodyOf(w5a1D.blobReadStmts(rs.db), keptBlob(), { bytes: 0 }));
    expect(list, 'CONTROL: the kept list is stored out of file order, with a uuid no copy holds').toEqual([u(3), u(1), u(2), u(9)]);
  }, HEAVY);

  it('item 2 (W2-D54): a tool_result is redacted whole over the run\'s pair index (pairIndexOf), then cut to TOOL_RESULT_CUT code points', () => {
    const tr = parts(payload())[3]!;
    expect(tr).not.toContain(SECRET);
    expect(tr.startsWith(`[tool_result] zqw5a1 result ${w5a1Lib.REDACTED_MARK} r r`)).toBe(true);
    expect(Array.from(tr.slice('[tool_result] '.length))).toHaveLength(w5a1.TOOL_RESULT_CUT);
    expect(JSON.stringify(picked(u(3)).body), 'CONTROL: the stored row holds the value verbatim').toContain(SECRET);
    expect(w5a1Lib.redactField(RESULT, w5a1Lib.makePairIndex([])), 'CONTROL: no shape rule redacts it without its pair').toContain(SECRET);
  }, HEAVY);

  it('W2-D54: the summary, a user text block and a tool_use input are each redacted whole over the run\'s pair index; no part carries the value', () => {
    const ps = parts(payload());
    for (const [i, what] of [[0, 'the summary'], [1, 'the user row'], [2, 'the Read tool_use']] as const) {
      expect(ps[i], what).not.toContain(SECRET);
      expect(ps[i], what).toContain(w5a1Lib.REDACTED_MARK);
    }
    for (const id of [u(6), u(1), u(2)]) {
      expect(JSON.stringify(picked(id).body), `CONTROL: the stored row ${id} holds the value verbatim`).toContain(SECRET);
    }
  }, HEAVY);

  it('item 3 (W2-D75, W2-D64): the question, redacted, then ANSWER_PROTOCOL, last; an empty question still carries it', () => {
    const ps = parts(payload());
    expect(ps[4]).toBe(`Which file did the session read first? ${w5a1Lib.REDACTED_MARK}`);
    expect(ps[5]).toBe(w5a1Gate.ANSWER_PROTOCOL);
    expect(parts(payload('')).slice(-2)).toEqual(['', w5a1Gate.ANSWER_PROTOCOL]);
  }, HEAVY);

  it('kept(N) through bodyOf, never keptOf (W2-D68, W2-D33): a NULL kept id is kept-absent; a tombstoned kept blob and one that is not a list are kept-unreadable, never an empty list', () => {
    const kb = keptBlob();
    const live = withStore((rs) => [...w5a1D.keptOf(w5a1D.blobReadStmts(rs.db), kb, { bytes: 0 })]);
    expect(new Set(live), 'CONTROL: on the live blob, keptOf and the payload agree on kept(N)').toEqual(new Set([u(3), u(1), u(2), u(9)]));
    withBoundary({ kept_blob_id: null }, () => expect(payload()).toEqual({ state: 'discard', why: 'kept-absent' }));
    withBlob(kb, { z: null, pruned_ms: Date.UTC(2026, 0, 2) }, () => {
      expect(payload()).toEqual({ state: 'discard', why: 'kept-unreadable' });
      expect(withStore((rs) => w5a1D.keptOf(w5a1D.blobReadStmts(rs.db), kb, { bytes: 0 }).size), 'CONTROL: keptOf folds the tombstone into an empty set').toBe(0);
    });
    withBlob(kb, stored('{"a":1}'), () => expect(payload()).toEqual({ state: 'discard', why: 'kept-unreadable' }));
    expect(parts(payload())[1], 'CONTROL: every column is back').toBe(USER_PART);
  }, HEAVY);

  it('expandEntryBody\'s five words (D-6238): an unparseable kept member is read as text and counted; tombstone, over-cap and undecodable each discard under their own word; for the summary row all four discard', () => {
    const m = blobOf(u(1));
    const s = blobOf(u(6));
    const PRUNED = Date.UTC(2026, 0, 2);
    const OVER = w5a1Lib.BLOB_DECODE_MAX + 1;
    withBlob(m, { z: null, pruned_ms: PRUNED }, () => expect(payload()).toEqual({ state: 'discard', why: 'member-tombstone' }));
    withBlob(m, { raw_len: OVER }, () => expect(payload()).toEqual({ state: 'discard', why: 'member-over-cap' }));
    withBlob(m, { z: null }, () => expect(payload()).toEqual({ state: 'discard', why: 'member-undecodable' }));
    withBlob(m, stored('zq not json {'), () => {
      const p = payload();
      expect(parts(p)[1]).toBe('[user] zq not json {');
      expect((p as { counts: { unparseable: number } }).counts.unparseable).toBe(1);
    });
    withBlob(s, { z: null, pruned_ms: PRUNED }, () => expect(payload()).toEqual({ state: 'discard', why: 'summary-tombstone' }));
    withBlob(s, { raw_len: OVER }, () => expect(payload()).toEqual({ state: 'discard', why: 'summary-over-cap' }));
    withBlob(s, { z: null }, () => expect(payload()).toEqual({ state: 'discard', why: 'summary-undecodable' }));
    withBlob(s, stored('zq not json {'), () => expect(payload()).toEqual({ state: 'discard', why: 'summary-unparseable' }));
    expect(parts(payload())[1], 'CONTROL: every column is back').toBe(USER_PART);
  }, HEAVY);

  it('W2-D65: leaf N\'s span is the rows derivation recorded for leaf N, in holding-copy file order, in the store\'s column names; a row that is no boundary is leaf-absent', () => {
    const b = idOf(u(5));
    const span = withStore((rs) => w5a1.spanRowsOf(rs, b));
    expect(span.state).toBe('span');
    const rows = (span as { rows: Array<Record<string, unknown>> }).rows;
    const recorded = ro((db) => db.prepare(`SELECT e.uuid AS uuid FROM nodes n JOIN node_sources s ON s.node_id = n.node_id
      JOIN entries e ON e.entry_id = s.entry_id WHERE n.boundary_entry_id = ? AND n.depth = 0 ORDER BY s.ord`).all(b)) as Array<{ uuid: string }>;
    expect(recorded.length, 'CONTROL: the sweep recorded leaf N\'s sources').toBeGreaterThan(0);
    expect(rows.map((r) => r['uuid'])).toEqual(recorded.map((r) => r.uuid));
    expect(Object.keys(rows[0]!).sort()).toEqual(['blob_id', 'entry_id', 'model', 'provenance', 'ts_ms', 'type', 'uuid']);
    const copy = withStore((rs) => w5a1.boundaryCopyOf(rs, b));
    const at = rows.map((r) => copy.rows.findIndex((c) => c.uuid === r['uuid']));
    expect(at.every((i, k) => i >= 0 && (k === 0 || i > at[k - 1]!)), 'holding-copy file order').toBe(true);
    expect(withStore((rs) => w5a1.spanRowsOf(rs, idOf(u(1))))).toEqual({ state: 'discard', why: 'leaf-absent' });
  }, HEAVY);

  it('one store open per run (R3): the open reads this node\'s store id through its own handle', () => {
    const want = ro((db) => String((db.prepare("SELECT v FROM meta WHERE k = 'store_id'").get() as { v: string }).v));
    expect(want, 'CONTROL: the fixture store holds a UUID store id').toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(withStore((rs) => rs['storeId'])).toBe(want);
  }, HEAVY);

  it('boundary N and its summary row: boundary-absent, boundary-uncopied and summary-absent; the summary pick is the row leaf N\'s derivation used', () => {
    expect(withStore((rs) => w5a1.reconstructPayload(rs, idOf(u(1)), QUESTION))).toEqual({ state: 'discard', why: 'boundary-absent' });
    withBoundary({ anchor_uuid: u(8) }, () => expect(payload()).toEqual({ state: 'discard', why: 'summary-absent' }));
    const b = idOf(u(5));
    const held = ro((db) => db.prepare('SELECT file_id, entry_id, line FROM memberships WHERE entry_id = ?').all(b)) as Array<{ file_id: number; entry_id: number; line: number }>;
    expect(held.length, 'CONTROL: both copies hold N, so the second copy was ingested').toBe(2);
    rw((db) => { db.prepare('DELETE FROM memberships WHERE entry_id = ?').run(b); });
    try {
      expect(payload()).toEqual({ state: 'discard', why: 'boundary-uncopied' });
    } finally {
      rw((db) => { for (const h of held) db.prepare('INSERT INTO memberships (file_id, entry_id, line) VALUES (?, ?, ?)').run(h.file_id, h.entry_id, h.line); });
    }
    const leaf = ro((db) => db.prepare('SELECT summary_blob_id AS s FROM nodes WHERE boundary_entry_id = ? AND depth = 0').get(b)) as { s: number | null } | undefined;
    expect(leaf?.s, 'CONTROL: the sweep derived leaf N with its summary').toBe(blobOf(u(6)));
    const pick = withStore((rs) => { const c = w5a1.boundaryCopyOf(rs, b); return c.summaryIndex === null ? null : c.rows[c.summaryIndex]!.blob_id; });
    expect(pick, 'the payload\'s summary row is the one derivation used').toBe(leaf!.s);
    expect(parts(payload())[1], 'CONTROL: the memberships are back').toBe(USER_PART);
  }, HEAVY);
});
```

- [ ] **Step 3: Run the new and changed cases; they fail (predicted).** In the foreground, with a timeout of at least 600000 ms:

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-5a Task 1|exactly W2-D59|imports exactly its fourteen modules|the import scan sees spawnSync'
```

Expected RED (predicted; nothing in the driver has changed yet):
- `exactly W2-D59…then W2-5a's`: `store-unreadable` is missing from the list.
- The import pin and its CONTROL: the driver imports seven modules, against fourteen.
- `CODE_SHA_FILES parity …`: two different arrays (`toBe`).
- `RECON_DISCARDS is frozen…`: `Array.isArray(undefined)` is false.
- `removePointerLines …` and `composePayload …`: `w5a1.removePointerLines is not a function`, `w5a1.composePayload is not a function`.
- `openReplayStore refuses …`: the TypeError is not a `DriverRefusal`.
- `the driver runs under --no-warnings`: the shebang is `#!/usr/bin/env node`.
- `importing the driver loads cli.mjs …`: `'18\n'` against `'63\n'`, since the driver imports no `cli.mjs` yet.
- Every case of `reconstruction from a fixture store`: `openReplayStore is not a function`. Its `beforeAll` still builds the box, which proves the fixture.
- The `keptOf` scan's CONTROL: `CONTROL: the driver does read a kept list, through bodyOf` (the base driver has no `bodyOf(` call; its planted pattern lines are green).
- Green at the base, as predicted: the `keptOf` scan itself, the decode scan (nothing in `deploy/` names those words yet), and the W2-D29 case (no driver import binds a `recallOffPresence`, and `cli.mjs` re-exports nothing). Their red comes from Step 8's mutants M6b, M15 and M11 and the case's own planted CONTROL lines.

- [ ] **Step 4: Edit the driver.** Each replacement matches exactly once (Step 1 counted the anchors).

(a) Line 1: `#!/usr/bin/env node` becomes `#!/usr/bin/env -S node --no-warnings`.

(b) Replace the header's three lines

```js
// Imports: node: built-ins, ../ccd/history/lib.mjs and ../shared/roster-json.mjs only. It never loads node:sqlite in
// any form: every store read W2 makes opens through store.mjs's read-only openReader (W2-D51), and
// history-replay.test.ts scans every deploy/history-*.mjs for it.
```

with

```js
// Imports: node: built-ins (node:crypto's randomBytes draws the W2 seeds); ../ccd/history/lib.mjs; the W2-1 exports
// the quiz reads, from ../ccd/history/store.mjs, ../ccd/history/derive.mjs, ../ccd/history/recall.mjs and
// ../ccd/history/cli.mjs (W2-D33, W2-D74); the index text and the registry read from ../ccd/history/sweep.mjs, never
// its recall-off reader (W2-D29); ./history-gate.mjs, the pure gate (W2-D11); and ../shared/roster-json.mjs.
// history-replay.test.ts pins the exact list and the names each ccd/history module brings in (D-5814). The driver spells
// no node:sqlite specifier: it loads node:sqlite only through store.mjs, that module's one importer, and every store read
// opens through store.mjs's read-only openReader (W2-D51); history-replay.test.ts scans every deploy/history-*.mjs for a
// specifier. Loading it prints Node's experimental-feature warning on stderr before any module body runs, so the driver
// runs under --no-warnings (its shebang, and every spawn of it), as cli.mjs and sweep.mjs do. Importing cli.mjs sets this
// process's umask to 0o077 (W2-D33); main sets it again before any file act (W2-D53).
```

The new text quotes neither the specifier nor the flag, so W2-4's scan pattern `(['"`])node:sqlite\1` stays clear of it. Each relative module is named whole on one line, as Task 8 Step 4 reads them.

(c) After `import { fileURLToPath, pathToFileURL } from 'node:url';`, add `import { randomBytes } from 'node:crypto';`. Then replace the lib import line, and add six lines after it:

```js
import { EXIT, SCHEMA_ADDED, UUID_RE, blobOverDecodeCap, canonicalJson, historyPaths, recallOffPath, redactField, renderEntryText, sha256Hex, summaryRowFor } from '../ccd/history/lib.mjs';
import { StoreError, openReader, userVersion } from '../ccd/history/store.mjs';
import { blobReadStmts, bodyOf, holdingCopyOf } from '../ccd/history/derive.mjs';
import { expandEntryBody } from '../ccd/history/recall.mjs';
import { pairIndexOf } from '../ccd/history/cli.mjs';
import { ftsTextOfBlob } from '../ccd/history/sweep.mjs';
import { ANSWER_PROTOCOL, GATE_CODE_FILES } from './history-gate.mjs';
```

`import { rosterFromJson, RosterInvalid } from '../shared/roster-json.mjs';` stays the last import. `randomBytes` and `ftsTextOfBlob` are unused until Task 5: this task owns every module statement, so the module list and its pin are settled once (R3). Names within a statement stay in code-unit order.

(d) In `DRIVER_REASONS`' doc comment, replace `ends by that signal if it comes after main has removed its listeners: D-5984). */` with

```js
 *  ends by that signal if it comes after main has removed its listeners: D-5984). The last is W2-5a's (Task 1):
 *  `store-unreadable`, a store this node cannot open or read (store.mjs's StoreError word, or SQLite's own error as
 *  store-read-failed), so reconstruction never reads an absent store as an empty one. */
```

and replace `  'run-live', 'out-in-use', 'interrupted',` with

```js
  'run-live', 'out-in-use', 'interrupted',
  'store-unreadable',
```

(e) Replace

```js
/** The four files whose installed bytes gate_code pins (W2-D24), relative to the tree the driver runs from. The
 *  imports of lib.mjs (recall.mjs, derive.mjs, cli.mjs, store.mjs) are not hashed: the release stamp covers them. */
export const CODE_SHA_FILES = Object.freeze(['deploy/history-gate.mjs', 'deploy/measure-history.py', 'deploy/history-replay.mjs', 'ccd/history/lib.mjs']);
```

with

```js
/** The four files whose installed bytes gate_code pins (W2-D24), relative to the tree the driver runs from: the gate's
 *  own GATE_CODE_FILES, so the four paths are spelled once (W2-5a Task 1, closing decisions §7's double spelling). The
 *  driver's other ccd/history imports (store.mjs, derive.mjs, recall.mjs, cli.mjs) and the modules they load (sweep.mjs,
 *  card.mjs, ccd/compact-card.mjs, shared/base-url.mjs) are not hashed: the release_tag comparison and the tree-moved
 *  preflight cover them (W2-D24, W2-D56). */
export const CODE_SHA_FILES = GATE_CODE_FILES;
```

(f) In `codeShas`' doc comment, replace `absent file (history-gate.mjs before W2-3 lands) is `absent`; any other read failure is `unreadable`. */` with `absent file is `absent`; any other read failure is `unreadable`. */`.

(g) Insert directly above `// The entry guard stays the LAST block of this file: a module-level declaration below it would still be uninitialised`:

```js
// ── W2-5a Task 1: reconstruction reads the store through W2-1's exports (W2-D74, W2-D75, W2-D33, W2-D68 (2), W2-D54) ──
// Boundary N's payload (spec §10.2 "Reconstruction", items 1 to 3) is built on the node that holds the store, and this
// file decodes nothing itself (W2-D74):
//   - the store opens through store.mjs's openReader (read-only, query_only; W2-D51), and the run's pair index is
//     cli.mjs's pairIndexOf, built once per open (W2-D54, W2-D67);
//   - N's holding copy is derive.mjs's holdingCopyOf (lib's pickHoldingCopy), and N's summary row is lib's
//     summaryRowFor over that copy's rows, as derivation picks it: a harness user row (an echo) is never the pick;
//   - kept(N) is the string members of the blob boundaries.kept_blob_id names, read through derive.mjs's bodyOf over
//     blobReadStmts: W2-D34's option (a), the membership the as-of cut keeps visible (W2-D38). A NULL id discards N as
//     kept-absent; a body that is not a list (a tombstone, a damaged or over-cap blob, JSON that is not a list) as
//     kept-unreadable, never an empty list. derive.mjs's keptOf folds all three into one empty set, so this file never
//     calls it (W2-D33, W2-D68), and history-replay.test.ts scans every deploy/*.mjs for its name;
//   - an entry's body is recall.mjs's expandEntryBody, expand's own pick (the unsanitised ccd-sanitize variant when
//     there is one, DM2b). Of its five words (D-6238), 'body' is read; 'unparseable' (a raw-only row's stored text) is
//     read as text for a kept member and counted, and discards N for the summary row, whose pointer line cannot be found
//     in a line that was never parsed; 'tombstone', 'over-cap' and 'undecodable' each discard N under a word of its own,
//     never folded: a damaged blob is not a pruned one;
//   - every field passes whole through redactForSpawn, a tool_result through toolResultText, before any cut (W2-D54).
// A discard is a count by its RECON_DISCARDS word, never a refusal. A store that cannot be opened or read refuses
// store-unreadable.

/** Every word a boundary is discarded with (R5): reconstruction's (W2-D68, W2-D75, W2-D54), then the words Tasks 2, 3 and
 *  4 append here in place (mining's span words, admission's verdicts, Baseline B's). Counts, never refusals, and never a
 *  DRIVER_REASONS or GATE_REASONS word. */
export const RECON_DISCARDS = Object.freeze([
  'boundary-absent', 'boundary-uncopied',
  'summary-absent', 'summary-unparseable', 'summary-tombstone', 'summary-over-cap', 'summary-undecodable',
  'kept-absent', 'kept-unreadable',
  'member-tombstone', 'member-over-cap', 'member-undecodable',
  'over-decode-cap', 'leaf-absent',
  'body-unrenderable',
]);
/** expandEntryBody's three body-less words (D-6238), each mapped to a discard word of its own. entryBodyOf throws on any
 *  other word, so neither map is ever read with a key it lacks (D-6301). */
const SUMMARY_LOST = Object.freeze({ tombstone: 'summary-tombstone', 'over-cap': 'summary-over-cap', undecodable: 'summary-undecodable' });
const MEMBER_LOST = Object.freeze({ tombstone: 'member-tombstone', 'over-cap': 'member-over-cap', undecodable: 'member-undecodable' });
/** What item 1 puts in place of a transcript-pointer line (spec §10.2 "Reconstruction", item 1). */
export const POINTER_REMOVED = '[pointer removed]';
/** A transcript-pointer line: a whole line naming a path that ends in .jsonl (D-6277). */
const POINTER_LINE_RE = /^.*\/\S*\.jsonl(?![A-Za-z0-9_]).*$/gm;

/** @param {string} why a RECON_DISCARDS word  @returns {{ state: 'discard', why: string }} */
const reconDiscard = (why) => ({ state: 'discard', why });

/** Item 1's pointer rule: each whole line that names a .jsonl path becomes POINTER_REMOVED, and `replaced` counts them. Pure.
 *  @param {string} text  @returns {{ text: string, replaced: number }} */
export function removePointerLines(text) {
  let replaced = 0;
  const out = text.replace(POINTER_LINE_RE, () => { replaced += 1; return POINTER_REMOVED; });
  return { text: out, replaced };
}

/** Items 1 to 3 (W2-D75), joined by one blank line: the summary, each kept member, then the question followed by
 *  ANSWER_PROTOCOL (W2-D64, D-5776). Pure; the parts and the question come already redacted. An empty question and
 *  empty parts still carry the protocol: the fidelity pilot's empty-question run composes through here (Task 6).
 *  @param {{ summary: string, kept: readonly string[] }} parts  @param {string} question  @returns {string} */
export function composePayload(parts, question) {
  return [parts.summary, ...parts.kept, `${question}\n\n${ANSWER_PROTOCOL}`].join('\n\n');
}

/** One tool_use as item 2 and the writer's paired line render it: `[tool_use <name>] <input>`, lib's renderEntryText of
 *  that one block when `inputText` is the JSON of its input. Pure.
 *  @param {string} name  @param {string} inputText  @returns {string} */
export function renderToolUseLine(name, inputText) {
  return `[tool_use ${name}] ${inputText}`;
}

/** The summary row of boundary `boundaryUuid` in one copy: lib's summaryRowFor pick over the meta derive.mjs's copyPlan
 *  builds (a summary is an is_compact_summary row; an echo is a user row of harness provenance, never the pick), as its
 *  index in `copyRows`. -1 when lib picks none, or names a row this copy does not hold. Pure; the driver's one summary
 *  pick, which boundaryCopyOf applies for the payload, admission (Task 3) and Baseline B (Task 4).
 *  @param {Array<{uuid: string, type: string, provenance: string, is_compact_summary: number}>} copyRows
 *  @param {string} boundaryUuid  @param {string|null} anchorUuid  @returns {number} */
export function summaryIndexOf(copyRows, boundaryUuid, anchorUuid) {
  const meta = copyRows.map((r) => ({ uuid: r.uuid, isCompactSummary: r.is_compact_summary === 1, isEcho: r.type === 'user' && r.provenance === 'harness' }));
  const pick = summaryRowFor({ boundaryUuid, anchorUuid, rows: meta });
  return pick.uuid === null ? -1 : copyRows.findIndex((r) => r.uuid === pick.uuid);
}

/** The statements reconstruction reads with, prepared once per open. They read no body: bodies are read only through
 *  bodyOf and expandEntryBody (W2-D74). */
function replayStmts(db) {
  return {
    boundary: db.prepare(`SELECT b.entry_id AS entry_id, b.transcript_pk AS transcript_pk, b.kept_blob_id AS kept_blob_id,
        b.anchor_uuid AS anchor_uuid, e.uuid AS uuid
      FROM boundaries b JOIN entries e ON e.entry_id = b.entry_id WHERE b.entry_id = ?`),
    copyRows: db.prepare(`SELECT m.line AS line, e.entry_id AS entry_id, e.uuid AS uuid, e.type AS type, e.model AS model,
        e.provenance AS provenance, e.is_compact_summary AS is_compact_summary, e.ts_ms AS ts_ms, e.blob_id AS blob_id
      FROM memberships m JOIN entries e ON e.entry_id = m.entry_id WHERE m.file_id = ? ORDER BY m.line`),
    keptRows: db.prepare(`SELECT e.entry_id AS entry_id, e.uuid AS uuid, e.type AS type, e.blob_id AS blob_id, m.line AS line
      FROM entries e LEFT JOIN memberships m ON m.file_id = ? AND m.entry_id = e.entry_id
      WHERE e.uuid IN (SELECT value FROM json_each(?))
      ORDER BY m.line IS NULL, m.line, e.entry_id`),
    span: db.prepare(`SELECT e.entry_id AS entry_id, e.uuid AS uuid, e.type AS type, e.model AS model, e.provenance AS provenance,
        e.ts_ms AS ts_ms, e.blob_id AS blob_id
      FROM node_sources s JOIN entries e ON e.entry_id = s.entry_id
      WHERE s.node_id = (SELECT node_id FROM nodes WHERE boundary_entry_id = ? AND depth = 0 ORDER BY node_id LIMIT 1)
      ORDER BY s.ord`),
    storeId: db.prepare("SELECT v FROM meta WHERE k = 'store_id'"),
  };
}

/** @typedef {{ db: ReturnType<typeof openReader>, storeId: string, version: number, schema: typeof SCHEMA_ADDED,
 *    blobs: ReturnType<typeof blobReadStmts>, stmts: ReturnType<typeof replayStmts>,
 *    idx: import('../ccd/history/lib.mjs').PairIndex, close: () => void }} ReplayStore */

/** This node's store, open for the run (W2-D51, W2-D33, W2-D54): a read-only, query_only handle, this node's store id
 *  (meta.store_id, read through the same handle), its user_version and SCHEMA_ADDED (the `rc` expandEntryBody reads
 *  columns by, DM44), the two blob reads bodyOf needs, this section's statements, and the run's pair index, built once
 *  here through cli.mjs's pairIndexOf. Every subcommand opens the store once, here, and passes it down (R3). A store
 *  openReader refuses (missing, zero-byte, unmeasured), one with no UUID store id, or one whose first reads fail in
 *  SQLite, refuses store-unreadable.
 *  @param {string} home  @returns {ReplayStore} */
export function openReplayStore(home) {
  let db;
  try {
    db = openReader(historyPaths(home).dbFile);
  } catch (e) {
    storeRefusal(e);
  }
  try {
    const stmts = replayStmts(db);
    const id = stmts.storeId.get();
    if (id === undefined || !UUID_RE.test(String(id.v))) refuse('store-unreadable', id === undefined ? 'store-id-absent' : 'store-id-unreadable');
    return { db, storeId: String(id.v), version: userVersion(db), schema: SCHEMA_ADDED, blobs: blobReadStmts(db), stmts, idx: pairIndexOf(db, home), close: () => db.close() };
  } catch (e) {
    try { db.close(); } catch { /* the first throw is the signal */ }
    storeRefusal(e);
  }
}

/** A failed open or first read as the driver's word: a StoreError by its word alone (store.mjs: the caller prints the
 *  word, never the message), SQLite's own error as store-read-failed with its message; anything else is a defect.
 *  @param {unknown} e  @returns {never} */
function storeRefusal(e) {
  if (e instanceof StoreError) refuse('store-unreadable', e.word);
  if (e !== null && typeof e === 'object' && /** @type {{ code?: unknown }} */ (e).code === 'ERR_SQLITE_ERROR') {
    refuse('store-unreadable', `store-read-failed: ${/** @type {Error} */ (e).message}`);
  }
  throw e;
}

/** Boundary N and the copy that holds it (§6.1 "The copy"): N's boundaries row, the holding copy through derive.mjs's
 *  holdingCopyOf, that copy's rows in file order (no body), N's index in them, and N's summary row's index as lib's
 *  summaryRowFor picks it for derivation (a harness user row, an echo, is never the pick), or null when there is none.
 *  The admission (W2-D66) and Baseline B (W2-D68) read this same answer.
 *  @param {ReplayStore} rs  @param {number} boundaryEntryId */
export function boundaryCopyOf(rs, boundaryEntryId) {
  const boundary = rs.stmts.boundary.get(boundaryEntryId);
  if (boundary === undefined) return reconDiscard('boundary-absent');
  const holding = holdingCopyOf(rs.db, { entry_id: boundary.entry_id, transcript_pk: boundary.transcript_pk });
  if (holding === null) return reconDiscard('boundary-uncopied');
  const fileId = Number(holding.file_id);
  const rows = rs.stmts.copyRows.all(fileId);
  const boundaryIndex = rows.findIndex((r) => r.entry_id === boundary.entry_id);
  const at = summaryIndexOf(rows, boundary.uuid, boundary.anchor_uuid);
  return { state: 'copy', boundary, fileId, rows, boundaryIndex, summaryIndex: at < 0 ? null : at };
}

/** Leaf N's span (W2-D65): the rows derivation recorded as leaf N's sources (node_sources of N's depth-0 node), in their
 *  recorded order, which is N's holding copy's file order, each with the entries columns mining reads (R4). No leaf for
 *  N, or a leaf with no source, is leaf-absent. Never a second span rule over the copy.
 *  @param {ReplayStore} rs  @param {number} boundaryEntryId */
export function spanRowsOf(rs, boundaryEntryId) {
  const rows = rs.stmts.span.all(boundaryEntryId);
  if (rows.length === 0) return reconDiscard('leaf-absent');
  return { state: 'span', rows };
}

/** kept(N) (W2-D68 (2), W2-D34 option (a), W2-D38): the members of the blob boundaries.kept_blob_id names, read through
 *  bodyOf, deduplicated in first-occurrence order. A NULL id is kept-absent; a body that is not a list of strings
 *  (bodyOf's null for a tombstone, a damaged, over-cap or non-JSON blob; JSON that is not a list; a list holding
 *  anything but strings, which lib's boundaryOf never stores) is kept-unreadable. Never an empty list for either: that
 *  is the fold this file never calls. Baseline B passes its run budget; the payload reads with a fresh one.
 *  @param {ReplayStore} rs  @param {{ kept_blob_id: number | null }} boundary  @param {{ bytes: number }} [budget] */
export function keptMembersOf(rs, boundary, budget = { bytes: 0 }) {
  if (boundary.kept_blob_id === null) return reconDiscard('kept-absent');
  const v = bodyOf(rs.blobs, boundary.kept_blob_id, budget);
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) return reconDiscard('kept-unreadable');
  return { state: 'kept', uuids: [...new Set(v)] };
}

/** The kept members the store holds, in N's holding copy's file order; a member outside that copy comes after, by
 *  entry_id, and is counted in `offCopy`; a uuid the store does not hold is counted in `absent` (W2-D75 item 2).
 *  @param {ReplayStore} rs  @param {string[]} uuids  @param {number} fileId */
export function keptRowsOf(rs, uuids, fileId) {
  const rows = rs.stmts.keptRows.all(fileId, JSON.stringify(uuids));
  return { rows, absent: uuids.length - rows.length, offCopy: rows.filter((r) => r.line === null).length };
}

/** An entry's body as expand picks it (W2-D74; D-6238): 'body' and 'unparseable' carry the pick and the primary's
 *  decoded length (W2-D54's rawLen; an over-cap blob never decodes, so it is never past the cap here); the three
 *  body-less words come back as `lost`, each kept apart.
 *  @param {ReplayStore} rs  @param {{ entry_id: number, blob_id: number }} row */
export function entryBodyOf(rs, row) {
  const k = expandEntryBody(rs, { entry_id: row.entry_id, blob_id: row.blob_id });
  if (k.state === 'body' || k.state === 'unparseable') return { state: k.state, body: k.body, rawLen: k.blob.bytes.length };
  // D-6301: a word expandEntryBody gains later has no discard here, so it throws rather than reach a wordless discard.
  if (!Object.hasOwn(SUMMARY_LOST, k.state) || !Object.hasOwn(MEMBER_LOST, k.state)) throw new TypeError(`entryBodyOf: unknown body state ${k.state}`);
  return { state: 'lost', word: k.state };
}

/** One kept member as item 2 renders it (W2-D75): each block on its own line. A text block, a bare string block and a
 *  body that is not a block list are tagged with the row's type (`[user] …`, `[assistant] …`). A tool_use is
 *  renderToolUseLine (`[tool_use <name>] <input>`, lib's rendering). A tool_result is `[tool_result] ` and its first TOOL_RESULT_CUT code
 *  points after redaction (toolResultText). Any other block is renderEntryText's `[<type>]`. Every piece is redacted
 *  whole before any cut (W2-D54).
 *  @param {{ type: string }} row  @param {{ body: unknown, rawLen: number }} k
 *  @param {import('../ccd/history/lib.mjs').PairIndex} idx */
export function renderKeptMember(row, k, idx) {
  const pieces = Array.isArray(k.body)
    ? k.body.map((b) => {
      const type = b !== null && typeof b === 'object' ? b.type : null;
      const text = type === 'tool_use' ? renderToolUseLine(typeof b.name === 'string' ? b.name : '', JSON.stringify(b.input ?? null)) : renderEntryText([b]);
      return { type, tagged: typeof b === 'string' || type === 'text', text };
    })
    : [{ type: null, tagged: true, text: renderEntryText(k.body) }];
  const lines = [];
  for (const p of pieces) {
    const field = { text: p.text, rawLen: k.rawLen };
    const r = p.type === 'tool_result' ? toolResultText(field, idx) : redactForSpawn(field, idx);
    if (r.state !== 'text') return r;
    lines.push(p.type === 'tool_result' ? `[tool_result] ${r.text}` : p.tagged ? `[${row.type}] ${r.text}` : r.text);
  }
  return { state: 'text', text: lines.join('\n') };
}

/** `fn()`, or null when it throws a RangeError: a body nested past V8's JSON.stringify stack (about 4,500 levels, far
 *  inside lib's JSON_DEPTH_MAX) parses and cannot be rendered, as recall.mjs's expandEntryText meets it (D-6302). Any other
 *  throw is a defect and propagates.
 *  @template T  @param {() => T} fn  @returns {T | null} */
function renderOrNull(fn) {
  try {
    return fn();
  } catch (e) {
    if (e instanceof RangeError) return null;
    throw e;
  }
}

/** Boundary N's payload (spec §10.2 "Reconstruction"; W2-D75 items 1 to 3), composed by composePayload:
 *  1. the summary row's text, redacted whole, its transcript-pointer lines replaced by POINTER_REMOVED;
 *  2. each kept(N) member the store holds, in N's holding copy's file order, rendered by renderKeptMember;
 *  3. the question, redacted, then ANSWER_PROTOCOL (W2-D64, D-5776).
 *  Any failure discards N under its RECON_DISCARDS word; `counts` reports what was read.
 *  @param {ReplayStore} rs  @param {number} boundaryEntryId  @param {string} question */
export function reconstructPayload(rs, boundaryEntryId, question) {
  const copy = boundaryCopyOf(rs, boundaryEntryId);
  if (copy.state !== 'copy') return copy;
  if (copy.summaryIndex === null) return reconDiscard('summary-absent');
  const sum = entryBodyOf(rs, copy.rows[copy.summaryIndex]);
  if (sum.state === 'lost') return reconDiscard(SUMMARY_LOST[sum.word]);
  if (sum.state === 'unparseable') return reconDiscard('summary-unparseable');
  const sumText = renderOrNull(() => renderEntryText(sum.body));
  if (sumText === null) return reconDiscard('body-unrenderable');
  const s1 = redactForSpawn({ text: sumText, rawLen: sum.rawLen }, rs.idx);
  if (s1.state !== 'text') return s1;
  const item1 = removePointerLines(s1.text);
  const kept = keptMembersOf(rs, copy.boundary);
  if (kept.state !== 'kept') return kept;
  const members = keptRowsOf(rs, kept.uuids, copy.fileId);
  const rendered = [];
  let unparseable = 0;
  for (const row of members.rows) {
    const k = entryBodyOf(rs, row);
    if (k.state === 'lost') return reconDiscard(MEMBER_LOST[k.word]);
    if (k.state === 'unparseable') unparseable += 1;
    const m = renderOrNull(() => renderKeptMember(row, k, rs.idx));
    if (m === null) return reconDiscard('body-unrenderable');
    if (m.state !== 'text') return m;
    rendered.push(m.text);
  }
  const q = redactForSpawn({ text: question, rawLen: Buffer.byteLength(question, 'utf8') }, rs.idx);
  if (q.state !== 'text') return q;
  return {
    state: 'payload', text: composePayload({ summary: item1.text, kept: rendered }, q.text),
    counts: { members: members.rows.length, absent: members.absent, off_copy: members.offCopy, unparseable, pointer_lines: item1.replaced },
  };
}

```

Write nothing else in the driver. In particular:
- no line of the new section calls `exec(` (W2-4's no-shell scan matches `\bexec\s*\(`), so `db.exec` is never used;
- no line names `process.env`;
- no line names lib's display-window redaction, which W2-4's scan matches over the whole file, comments included;
- no line spells a recall-off path or either recall arm word.

- [ ] **Step 5: Run the file; measure the two consequences red (predicted).** In the foreground:

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts
```

Expected (predicted):
- Every `W2-5a Task 1` case is green, and so are the word case and the import pin.
- Red, the warning: every case that compares a spawned driver's stderr whole. These are W2-4 Task 1's RP2 rows and its spawned-main cases, the entry guard through a symlink, every `t8Run` case that pins stderr, the two Task 8 signal cases (`/^ccrc history-replay: interrupted: SIGTERM received; [^\n]*\n$/` against a stderr that starts with the warning's two lines), and the probe signal case. Each fails with `(node:<pid>) ExperimentalWarning: SQLite is an experimental feature…` ahead of the expected line.
- Red, the gate: every `t8Tree` case. The copied driver imports `./history-gate.mjs`, which `t8Tree` writes as a one-line comment (`does not provide an export named 'ANSWER_PROTOCOL'`, exit 1) or leaves out (`gate: false`: `ERR_MODULE_NOT_FOUND`).

Record the failing count. Step 7 shows each class green.

- [ ] **Step 6: Repair W2-4's spawns and its tree.** All edits are in `server/test/history-replay.test.ts`.

(a) `--no-warnings` on every spawn that loads the driver. From the repository root:

```bash
python3 - server/test/history-replay.test.ts <<'EOF'
import sys
p = sys.argv[1]
s = open(p).read()
EDITS = [
    ("spawnSync(process.execPath, [SCRIPT, ...args], {", "spawnSync(process.execPath, ['--no-warnings', SCRIPT, ...args], {", 1),
    ("spawnSync(process.execPath, [link, 'no-such-sub'], {", "spawnSync(process.execPath, ['--no-warnings', link, 'no-such-sub'], {", 1),
    ("spawnSync(process.execPath, ['--input-type=module', '-e', MARKER_CHILD], {", "spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', MARKER_CHILD], {", 1),
    ("t2SpawnSync(process.execPath, ['--input-type=module', '-e', code],", "t2SpawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', code],", 1),
    ("spawnSync(process.execPath, ['--input-type=module', '-e', ADMIT_CHILD], {", "spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', ADMIT_CHILD], {", 1),
    ("spawn(process.execPath, [racer, out], {", "spawn(process.execPath, ['--no-warnings', racer, out], {", 1),
    ("['--fsize=0', process.execPath, script, dir]", "['--fsize=0', process.execPath, '--no-warnings', script, dir]", 1),
    ("[`--fsize=${fsize}`, process.execPath, script, out]", "[`--fsize=${fsize}`, process.execPath, '--no-warnings', script, out]", 3),
    ("spawnSync(process.execPath, [script, dir], {", "spawnSync(process.execPath, ['--no-warnings', script, dir], {", 1),
    ("spawnSync(process.execPath, [path.join(tree, 'deploy', 'history-replay.mjs'), ...args],", "spawnSync(process.execPath, ['--no-warnings', path.join(tree, 'deploy', 'history-replay.mjs'), ...args],", 1),
    ("spawn(process.execPath, [path.join(tree, 'deploy', 'history-replay.mjs'), ...t8Argv(out)],", "spawn(process.execPath, ['--no-warnings', path.join(tree, 'deploy', 'history-replay.mjs'), ...t8Argv(out)],", 2),
    ("spawn(process.execPath, [SCRIPT, 'probe', '--out', out, '--account', 'up-a', '--budget', '1000000', '--arm-model', 'fixture-model-arm'],", "spawn(process.execPath, ['--no-warnings', SCRIPT, 'probe', '--out', out, '--account', 'up-a', '--budget', '1000000', '--arm-model', 'fixture-model-arm'],", 2),
]
for old, new, n in EDITS:
    assert s.count(old) == n, (old, s.count(old))
    s = s.replace(old, new)
open(p, 'w').write(s)
EOF
grep -c "'--no-warnings'" server/test/history-replay.test.ts
```

Expected: the script exits 0, and the count prints `17`: the sixteen spawns plus the Step 2 umask case.

(b) In W2-4 Task 8's section comment, replace

```ts
// run uses a fixture tree (t8Tree): a copy of the driver beside fixture bytes for the two gate_code files this PR
// does not own, so codeShas() is measured whichever of W2-3 and this PR merges first and the recorded shas can be
// pinned exactly; lib.mjs is copied, and ccd/history's other entries and shared/ are symlinks to this checkout.
```

with

```ts
// run uses a fixture tree (t8Tree): a copy of the driver beside the gate's real bytes (the driver imports the gate,
// W2-5a Task 1) and fixture bytes for measure-history.py, so the recorded shas can be pinned exactly; lib.mjs is
// copied, and ccd/history's other entries and shared/ are symlinks to this checkout.
```

(c) Replace `  const T8_GATE_BYTES = '// fixture bytes for deploy/history-gate.mjs (W2-4 Task 8)\n';` with

```ts
  /** The gate's real bytes: the driver imports ./history-gate.mjs (W2-5a Task 1), so a tree it runs from carries the gate
   *  itself, and step 0a records that file's sha. */
  const T8_GATE_BYTES = readFileSync(path.join(REPO, 'deploy', 'history-gate.mjs'));
```

(d) In `t8Tree`, replace

```ts
  /** A tree the driver runs from: its own bytes copied (so TREE_ROOT is this tree), fixture bytes for the two
   *  gate_code files this PR does not own (`gate: false` leaves deploy/history-gate.mjs out), lib.mjs copied and
   *  ccd/history's other entries and shared/ symlinked to this checkout, so every import resolves. */
  function t8Tree(opts: { gate?: boolean } = {}): string {
```

with

```ts
  /** A tree the driver runs from: its own bytes copied (so TREE_ROOT is this tree), the gate's real bytes (the driver
   *  imports it), fixture bytes for deploy/measure-history.py (`measure: false` leaves it out), lib.mjs copied and
   *  ccd/history's other entries and shared/ symlinked to this checkout, so every import resolves. */
  function t8Tree(opts: { measure?: boolean } = {}): string {
```

and replace the two lines

```ts
    if (opts.gate !== false) writeFileSync(path.join(tree, 'deploy', 'history-gate.mjs'), T8_GATE_BYTES);
    writeFileSync(path.join(tree, 'deploy', 'measure-history.py'), T8_MEASURE_BYTES);
```

with

```ts
    writeFileSync(path.join(tree, 'deploy', 'history-gate.mjs'), T8_GATE_BYTES);
    if (opts.measure !== false) writeFileSync(path.join(tree, 'deploy', 'measure-history.py'), T8_MEASURE_BYTES);
```

(e) In the case `an unmeasured code sha refuses code-unmeasured, and an untagged stamp tree-unmeasured, before any spawn`, replace

```ts
    const noGate = t8Run(t8Tree({ gate: false }), home, t8Argv(t8Out()));
    expect(noGate.code).toBe(2);
    expect(noGate.stderr).toBe('ccrc history-replay: code-unmeasured: deploy/history-gate.mjs is absent\n');
```

with

```ts
    // W2-5a Task 1: a tree without the gate cannot load the driver (it imports the gate), so the absent file is the census script.
    const noMeasure = t8Run(t8Tree({ measure: false }), home, t8Argv(t8Out()));
    expect(noMeasure.code).toBe(2);
    expect(noMeasure.stderr).toBe('ccrc history-replay: code-unmeasured: deploy/measure-history.py is absent\n');
```

(f) In `withHandler`'s doc comment, replace the line `   *  pool), so the worker's umask is saved first and restored afterwards: no later case inherits 077. */` (three spaces before the `*`) with

```ts
   *  pool), so the worker's umask is saved first and restored afterwards. From W2-5a Task 1 importing the driver loads
   *  cli.mjs, which sets this worker's umask to 077 at import, so the saved value is 077 too. */
```

(The two lines above that line, `/** Runs \`fn\` with a handler registered under \`sub\`, ...` and `*  on, main sets process.umask(0o077) before parseArgs, and these cases call main in this test process (vitest's fork`, stay as they are.)

- [ ] **Step 7: The whole file green.** In the foreground, with a timeout of at least 600000 ms:

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-5a Task 1'
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'RP2|step0a end to end|marker that is a FIFO'
```

Expected (predicted):
- the whole file passes (on darwin, the fixture-store describe is skipped);
- `-t 'W2-5a Task 1'`: 22 passed (11 scan and pure cases, 11 store cases), the rest skipped;
- the third: green, with the RP2 rows, every Task 8 case and the FIFO-marker child within its 10 s deadline.

If the FIFO-marker case or another child with a short deadline is red with a timeout, the child's import time is the cause (Residuals). Re-run it alone. If it is still red, report it: never raise a W2-4 deadline in this task.

- [ ] **Step 8: Measure every new guard red, then green.** From the repository root. Each block makes one exact replacement, asserted to match once, runs one filter, shows it red, and restores the file.

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w2-5a/scratch"; mkdir -p "$SCRATCH"
mut() {   # mut <file> <old> <new>: one exact replacement, asserted to match once
  python3 - "$1" "$2" "$3" <<'EOF'
import sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
assert s.count(old) == 1, (p, old, s.count(old))
open(p, 'w').write(s.replace(old, new))
EOF
}
cp deploy/history-replay.mjs "$SCRATCH/replay.t1.orig"
cp server/test/history-replay.test.ts "$SCRATCH/test.t1.orig"
R() { (cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t "$1"); cp "$SCRATCH/replay.t1.orig" deploy/history-replay.mjs; cp "$SCRATCH/test.t1.orig" server/test/history-replay.test.ts; }

# M1 (W2-D74): the payload reads the primary, not expand's pick.
mut deploy/history-replay.mjs 'return { state: k.state, body: k.body, rawLen' 'return { state: k.state, body: k.primary, rawLen'
R 'unsanitised side'
# Expected RED (predicted): 1 failed, expected '[assistant] ...\n[tool_use Read] …' to be '[assistant] \n[tool_use Read] …'.

# M2 (item 1): the pointer rule never matches.
mut deploy/history-replay.mjs 'const POINTER_LINE_RE = /^.*\/\S*\.jsonl(?![A-Za-z0-9_]).*$/gm;' 'const POINTER_LINE_RE = /(?!)/gm;'
R 'removePointerLines|item 1'
# Expected RED (predicted): 2 failed: the pure case (replaced 0 against 1) and the store case (the pointer line survives).

# M3 (item 2): members in another order than the holding copy's.
mut deploy/history-replay.mjs '      ORDER BY m.line IS NULL, m.line, e.entry_id`),' '      ORDER BY e.uuid DESC`),'
R 'holding copy'
# Expected RED (predicted): 1 failed, parts[1] is the tool_result line, not USER_PART ('[user] zqw5a1 open the app [redacted]').

# M4 (W2-D54): the pair index built without this HOME's secret files.
mut deploy/history-replay.mjs 'idx: pairIndexOf(db, home)' "idx: pairIndexOf(db, '/nonexistent')"
R 'pairIndexOf|item 3'
# Expected RED (predicted): 2 failed | 1 passed: the tool_result and the question both carry the secret verbatim; the pure
# composePayload case (its title holds "item 3") stays green.

# M5 (item 3): the answer protocol dropped from the one composer.
mut deploy/history-replay.mjs '  return [parts.summary, ...parts.kept, `${question}\n\n${ANSWER_PROTOCOL}`].join('"'"'\n\n'"'"');' '  return [parts.summary, ...parts.kept, question].join('"'"'\n\n'"'"');'
R 'item 3'
# Expected RED (predicted): 2 failed: the store case (parts has 5 entries; ps[5] is undefined) and the composePayload case.

# M6 (W2-D68 CONTROL): keptOf's fold, an unreadable kept blob read as an empty list.
mut deploy/history-replay.mjs "  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) return reconDiscard('kept-unreadable');" "  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) return { state: 'kept', uuids: [] };"
R 'never keptOf'
# Expected RED (predicted): 1 failed, expected { state: 'payload', … } to deeply equal { state: 'discard', why: 'kept-unreadable' }.

# M6b (W2-D33): a deploy/*.mjs that calls keptOf.
printf '%s\n' "import { keptOf } from '../ccd/history/derive.mjs';" 'export const k = (s) => keptOf(s, null, { bytes: 0 });' > deploy/w2-5a-scratch.mjs
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'names keptOf on a code line')
rm deploy/w2-5a-scratch.mjs
# Expected RED (predicted): 1 failed, expected [ 'w2-5a-scratch.mjs' ] to deeply equal [].

# M7 (D-6238): undecodable folded into tombstone.
mut deploy/history-replay.mjs "undecodable: 'member-undecodable' });" "undecodable: 'member-tombstone' });"
R 'five words'
# Expected RED (predicted): 1 failed, 'member-tombstone' against 'member-undecodable'.

# M8: an unparseable summary row accepted.
mut deploy/history-replay.mjs "  if (sum.state === 'unparseable') return reconDiscard('summary-unparseable');
" ''
R 'five words'
# Expected RED (predicted): 1 failed, expected { state: 'payload', … } to deeply equal { state: 'discard', why: 'summary-unparseable' }.

# M9: a NULL kept id read through bodyOf, so kept-absent folds into kept-unreadable.
mut deploy/history-replay.mjs "  if (boundary.kept_blob_id === null) return reconDiscard('kept-absent');
" ''
R 'never keptOf'
# Expected RED (predicted): 1 failed, 'kept-unreadable' against 'kept-absent'.

# M10 (W2-D24): the four paths spelled again.
mut deploy/history-replay.mjs 'export const CODE_SHA_FILES = GATE_CODE_FILES;' 'export const CODE_SHA_FILES = Object.freeze([...GATE_CODE_FILES]);'
R 'spelled once'
# Expected RED (predicted): 1 failed (toBe: two arrays); W2-4's literal four-name case stays green.

# M11 (D-5814, W2-D68, W2-D29): keptOf brought in by the import.
mut deploy/history-replay.mjs "import { blobReadStmts, bodyOf, holdingCopyOf } from '../ccd/history/derive.mjs';" "import { blobReadStmts, bodyOf, holdingCopyOf, keptOf } from '../ccd/history/derive.mjs';"
R 'imports exactly its fourteen modules|names keptOf on a code line'
# Expected RED (predicted): 2 failed: '../ccd/history/derive.mjs brings in { blobReadStmts, bodyOf, holdingCopyOf, keptOf }', and [ 'history-replay.mjs' ].

# M12: the warning back on a spawned driver.
mut server/test/history-replay.test.ts "spawnSync(process.execPath, ['--no-warnings', SCRIPT, ...args], {" "spawnSync(process.execPath, [SCRIPT, ...args], {"
R 'RP2'
# Expected RED (predicted): 4 failed | 1 passed (the in-process paneRefusal case): each stderr starts with '(node:<pid>) ExperimentalWarning'.

# M13: the shebang without the flag.
mut deploy/history-replay.mjs '#!/usr/bin/env -S node --no-warnings' '#!/usr/bin/env node'
R 'runs under --no-warnings'
# Expected RED (predicted): 1 failed.

# M15 (W2-D74): a deploy/*.mjs that decodes a blob itself.
printf '%s\n' "import { unbrotli } from '../ccd/history/store.mjs';" 'export const d = (z, n) => unbrotli(z, n);' > deploy/w2-5a-scratch.mjs
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'decodes a blob itself')
rm deploy/w2-5a-scratch.mjs
# Expected RED (predicted): 1 failed, expected [ 'w2-5a-scratch.mjs' ] to deeply equal [].

# M16: a boundary no copy holds read as held.
mut deploy/history-replay.mjs "  if (holding === null) return reconDiscard('boundary-uncopied');
" ''
R 'boundary-uncopied and summary-absent'
# Expected RED (predicted): 1 failed, TypeError reading 'file_id' of null, where boundary-uncopied was expected.

# M17 (W2-D65, R4): the span in another order than derivation recorded.
mut deploy/history-replay.mjs '      ORDER BY s.ord`),' '      ORDER BY e.uuid DESC`),'
R 'span is the rows derivation recorded'
# Expected RED (predicted): 1 failed, the uuids in reverse.

# M18 (W2-D75): the tool_use line no longer lib's rendering.
mut deploy/history-replay.mjs '  return `[tool_use ${name}] ${inputText}`;' '  return `[tool_use ${name}]${inputText}`;'
R 'renderToolUseLine|unsanitised side'
# Expected RED (predicted): 2 failed: the composePayload case and the W2-D74 store case (READ_LINE).

# M19 (W2-D54): the summary row sent unredacted.
mut deploy/history-replay.mjs '  const s1 = redactForSpawn({ text: sumText, rawLen: sum.rawLen }, rs.idx);' "  const s1 = { state: 'text', text: sumText };"
R 'a user text block and a tool_use input'
# Expected RED (predicted): 1 failed, the summary: expected '<summary>…' not to contain the secret.

# M20 (W2-D54): every kept piece but a tool_result sent unredacted.
mut deploy/history-replay.mjs '    const r = p.type === '"'"'tool_result'"'"' ? toolResultText(field, idx) : redactForSpawn(field, idx);' '    const r = p.type === '"'"'tool_result'"'"' ? toolResultText(field, idx) : { state: '"'"'text'"'"', text: field.text };'
R 'a user text block and a tool_use input'
# Expected RED (predicted): 1 failed, the user row: expected '[user] zqw5a1 open the app zq-…' not to contain the secret.

cmp deploy/history-replay.mjs "$SCRATCH/replay.t1.orig" && cmp server/test/history-replay.test.ts "$SCRATCH/test.t1.orig" && test ! -e deploy/w2-5a-scratch.mjs && echo restored && rm -f "$SCRATCH/replay.t1.orig" "$SCRATCH/test.t1.orig"
git status --short   # only this task's two paths
```

Then re-run `-t 'W2-5a Task 1'` on the restored tree. Expected green (predicted): 22 passed. Which guard each mutant pins:

| Mutant | Guard |
|---|---|
| M1 | W2-D74's primary-reading CONTROL |
| M2 | item 1's pointer rule |
| M3 | file order |
| M4 | the run's pair index |
| M5 | item 3 |
| M6 | W2-D68's keptOf CONTROL |
| M6b | the keptOf scan |
| M7 | D-6238's fifth word |
| M8 | the summary row's fail-closed parse |
| M9 | kept-absent |
| M10 | the one gate_code list |
| M11 | the exact-names import pin |
| M12 | the warning |
| M13 | the shebang |
| M15 | the decode scan |
| M16 | boundary-uncopied |
| M17 | the span reader's order (R4) |
| M18 | the tool_use rendering the composer and the writer share (R4) |
| M19 | W2-D54 on item 1, the summary row |
| M20 | W2-D54 on item 2's pieces that are not a tool_result (text blocks and tool_use inputs) |

The W2-D29 case's red comes from its own planted CONTROL lines. The umask case's red is Step 3's, measured at the base.

- [ ] **Step 9: Run the neighbours that read these files.** In the foreground, with a timeout of at least 600000 ms. A red file is re-run alone before it is called a break (CLAUDE.md's load flakes; `typecheck-tests` is one).

```bash
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'exactly one writer|declared in ccd/history/lib.mjs and in no other|deploy lane exports are each defined once|isSyntheticModel'
cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts
cd server && ./node_modules/.bin/vitest run test/history-recall.test.ts -t 'W2-D33'
cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts
cd server && ./node_modules/.bin/vitest run test/citations.test.ts
cd server && ./node_modules/.bin/vitest run test/ci-pipeline.test.ts
```

Expected (predicted), each green:
- `single-definition`:
  - O13 still sees the driver's one recall-off line, `lstatSync(recallOffPath(home, id));`;
  - O14 sees no VOCABS name declared in the driver (it imports `SCHEMA_ADDED` and declares none);
  - the W2-D33 block sees each blob SELECT spelled once (the driver spells neither, reading through `blobReadStmts`), and `pickExpandBody` called once, by `expandEntryBody`;
  - the `isSyntheticModel` scan sees no angle-bracket test in the driver.
- `measure-history`: the gate is untouched, and its purity pin reads the gate's own import block.
- `history-recall -t 'W2-D33'`: W2-1's export pins are unchanged.
- `typecheck-tests`: the new cases cast every JavaScript export through `unknown`, as W2-1's cases do, and `node:sqlite` and `node:zlib` are typed.
- `topology-clean`: the fixtures name `/home/u/...` paths and roster fixture ids only.
- `citations`: no numeric line citation was added to a source or test file. The plan's "about :N" hints are in `docs/`, which the ratchet exempts.
- `ci-pipeline`: no workflow is edited, and the node-floor list still holds `test/history-replay.test.ts`.

CI selects this PR's tests from its traced map. A change to `deploy/history-replay.mjs` selects `history-replay.test.ts`. The new import edges (store, derive, recall, cli and the gate) are re-traced on merge (CLAUDE.md, "What CI runs").

- [ ] **Step 10: Commit.** Only this task's two paths:

```bash
git add deploy/history-replay.mjs server/test/history-replay.test.ts
CO_AUTHORED_BY='<the Co-Authored-By line the attribution reminder gives>'
git commit -m "feat(history-replay): reconstruction reads the store through W2-1's exports; one gate_code list; the driver runs under --no-warnings (W2-5a Task 1; W2-D74, W2-D75, W2-D68, W2-D33, W2-D24, W2-D29, W2-D54; D-6277)" -m "$CO_AUTHORED_BY"
```


### Task 2: Fact mining, the producer and the redaction screen (W2-D61, W2-D65, W2-D67)

The quiz builder needs candidate facts before it can admit, check or ask anything. This task adds them to `deploy/history-replay.mjs` as pure functions over the span rows Task 1's `spanRowsOf` reads. Its mined candidate is the one candidate shape every later task reads (R4): the writer's item fields, plus the source fields answerability reads. The sampler (W2-D71), Baseline B (W2-D68), answerability (W2-D70), the writer (W2-D72) and the frozen list (W2-D73) all consume what this task produces.
- **How a fact is represented (W2-D61).** Every candidate carries both forms of the fact. `fact_raw` (F_raw) is the exact stored leaf or line. The source side reads it: this task's redaction screen, answerability's index-text check, the writer's excerpt and the arm-time re-check. `fact` (F) is what admission and scoring read: `collapseWs(fact_raw)` for a command or an error, the run lower-cased for a sha, and the path made absolute against the epoch's cwd for a path. `collapseWs` is the gate's (W2-3), imported and never copied.
- **Mining (W2-D65).** Mining reads leaf N's span rows only, in holding-copy file order, and reads each body through W2-1's body pick, `expandEntryBody` (W2-D33, W2-D74). It mines the four kinds W2-D60 names: sha runs, the path fields of seven tools, Bash commands, and the first meaningful line of an `is_error` tool result. Operator, summary, harness, ccrc-injected, recall-echo and `<synthetic>` rows are never mined and never picked. The producer is decided per row through `lib.backendOf` alone. A tool result inherits the backend of the assistant row in the same span whose tool_use ids hold `toolResultIdsOf(body)[0]`. That is the sweep's own pairing, and the `entries` column that the sweep fills from the row's `sourceToolUseID` field is never read. Each `(kind, fact)` is kept once per family.
- **The redaction discard (W2-D67).** This uses lib's `redactField`, the composed door 5h-2 left (5h-2's R11), over the run's pair index. A candidate is dropped **first**, as `redact-fact`, when its `fact_raw` changes under redaction alone or its `fact` (F) does (R10, F6: a whitespace-split bearer token leaves F_raw intact and F masked, and the writer's input carries F), or as `redact-leaf` when its `fact_raw` no longer occurs verbatim in its redacted leaf. Only then do the producer screen and admission against the unredacted Baseline B run, in W2-D71's order. Drops are counted by word, never by value.

**D-numbers.** This task defines none. It cites D-6238 (W2-1's five body-pick states) and D-5774 (deploy-local words), each defined in the merged plan that issued it. W2-D61, W2-D65 and W2-D67 are not departures (decisions section 3 marks each "no"), and section 6 holds no erratum for them.

**Drifts this task meets.** The decisions document was written at `bd363a76b`. The base is `cd622b2f6`.

| Document says | Code at `cd622b2f6` | Effect here |
|---|---|---|
| W2-D65 cites `lib.mjs:1416-1438` (provenanceOf), `:3104` and `:3117` | `provenanceOf` is at about :1470, `toolUsesOf` about :3480 and `toolResultIdsOf` about :3493. The sweep's pairing is in `prepareLines` (sweep.mjs about :4609-4612): a map of the tool_uses seen so far, in file order, last write wins, falling back to `pairedFromStore`'s walk up the parent chain | Anchored by name. Mining keeps the in-file-order map and drops the parent-chain walk, because that walk can leave the span, and W2-D65 refuses a tool_use outside it |
| W2-D61: "W2-3 for collapseWs" | `deploy/history-gate.mjs` exports `collapseWs` (about :1141). It collapses `\p{White_Space}` runs and removes one space at each end, never with `trim`, so a byte-order mark stays | Imported from the gate. F of a command keeps a BOM, as the labeller does |
| W2-D67: `redactField(F_raw, idx) !== F_raw` | `redactField` is 5h-2's composed door (`composeDoor(DOOR_READINGS.redactField, …)`, 5h-2's R11): the widened rules applied over the base door's output | The screen calls lib's exported `redactField`, the same door W2-4's `redactForSpawn` calls. It masks at least what rev 3.6 masked, so it can only discard more (the safe direction). A scan pins that the driver declares no redaction function of its own. R10 (F6) adds the same test on F, `redactField(F, idx) !== F`, under the same word: `collapseWs` can join a header and its value that a newline split, so F can be masked where F_raw is not, and the writer's input carries F |
| W2-D33/W2-D74: the body pick answers `'body'\|'tombstone'\|'over-cap'\|'unparseable'` | W2-1 shipped `expandEntryBody(rc, e)` with five states, `'undecodable'` added (D-6238) | A mined row whose pick is not `body` discards the boundary with its own word, one of the four `span-` words this task appends to Task 1's `RECON_DISCARDS` (R5). A state outside the five throws |
| W2-D65: "Paths under any rostered account's config dir are excluded"; W2-D69 (b), (c): "every rostered home" | The driver builds only the admitted account's config dir (`admitAccount`). `rosterFromJson`'s accounts carry `configDirSuffix` but no `hidden` flag (`shared/roster-json.d.mts`: "`hidden` is validated by `checkAccount` and NOT returned"), and a hidden account is still listed | `rosterConfigDirs(roster, home)` is added here and takes every listed account, a hidden one included. No mutant can drop hidden accounts through that object, so the pin is the expected list itself, which holds `.gen-h` |
| W2-D65 lists the producer under Mining; W2-D71 runs redaction before the producer | — | Mining records the producer on each candidate and drops nothing for it. `screenCandidate` applies redaction, then the producer, then B admission, so counts land in W2-D71's order |
| W2-D65's pin: "a NULL `sourceToolUseID`" | The store's column is `entries.source_tool_use_id` (store.mjs); the transcript field is `sourceToolUseID` | Neither spelling appears on a non-comment driver line (a scan, with a CONTROL) |
| W2-D67 cites spec §10.2 :2652, :2654 and :2629 | At `cd622b2f6` "**Redaction.** Candidate facts that match the redaction set (§8.3) are discarded first." is about :2664, and the Reconstruction paragraph about :2640 | Cited by content |

**Files:**
- Modify `deploy/history-replay.mjs`:
  - The one import from `'../ccd/history/lib.mjs'` (about :28 at `cd622b2f6`) gains `backendOf`, `isHistoryCommand`, `isSyntheticModel`, `toolResultIdsOf` and `toolUsesOf` (measured: Task 1 already imports `UUID_RE`, for the store opener's id check, so the line gains five names, not six). Each name appears once, and the list is in code-unit order, so `EXIT` stays first.
  - Task 1's `./history-gate.mjs` import statement gains `admitFact` and `collapseWs`. Task 1 owns the module list and the header sentence, which name the gate already (R3).
  - Task 1's `RECON_DISCARDS` gains, in place after `'leaf-absent'`, the four boundary words a body-less mined row discards with: `'span-unparseable'`, `'span-tombstone'`, `'span-over-cap'` and `'span-undecodable'` (R5).
  - One section goes directly above the comment line `// The entry guard stays the LAST block of this file`, below Task 1's section. It has no top-level await.
- Modify `server/test/history-replay.test.ts`: one block appended at the end of the file: four import lines under `w5a2` aliases, the module-level fixtures, and one describe.
- Not edited: `ccd/**` (lib's leaf walker is module-private, so the driver walks a tool_use input itself), `deploy/history-gate.mjs`, `shared/**`, the spec, README.md and every other test file.

**Interfaces:**
- Consumes from Task 1 (`deploy/history-replay.mjs`):
  - the import of `expandEntryBody` from `'../ccd/history/recall.mjs'`, and the `ReplayStore` (`rs`), which is the `rc` (`{ db, version, schema }`) it reads. The caller of `mineBoundary` (Task 6's `sourceQuiz`) passes `pick = (row) => expandEntryBody(rs, row)`. This task never calls it itself, so its tests need no store.
  - `spanRowsOf(rs, boundaryEntryId)`: leaf N's span rows in holding-copy file order, each carrying the `entries` columns `entry_id`, `uuid`, `type`, `model`, `provenance`, `ts_ms` and `blob_id` (`SpanRow` below). The caller adds N's `uuid` and non-null `ts_ms`, N's epoch's `cwd` and `cwd_real`, and the family's `store_id`, `ccrc_id` and `generation`.
  - `RECON_DISCARDS`, to which this task appends its span words, and the import block and header sentence, which name the gate already (R3).
- Consumes from the base:
  - `deploy/history-gate.mjs`: `collapseWs(s: string): string`, and `admitFact(kind, F, baselineText, questionText, { repoRoots }): { admitted: boolean, hit: null | { where: 'baseline' | 'question', variant: string } }`. Tests only: `GATE_REASONS`.
  - `ccd/history/lib.mjs`:
    - `redactField(text, idx: PairIndex): string`;
    - `backendOf(model): 'anthropic' | 'other' | 'unknown'`;
    - `isSyntheticModel(model): boolean`;
    - `isHistoryCommand(command): boolean`;
    - `toolUsesOf(content): { id, name, command? }[]`;
    - `toolResultIdsOf(content): string[]`;
    - `UUID_RE`;
    - `canonicalJson`.
    - Tests only: `makePairIndex`, `sha256Hex`, `renderEntryText` and `ftsTextOf`.
  - W2-4 (same file): the module-private `sjObject` and `sjResultText` (a tool_result's text: a string as it is, a block list's text blocks joined by `\n`, or null), `join` and `path` from `node:path`, and `DRIVER_REASONS`. Tests only: the module-level `FIXTURE_ACCOUNTS`, and `rosterFromJson` (imported at the top of the test file).
  - W2-1 (through Task 1's `pick`): `expandEntryBody`'s answer `{ state: 'body' | 'unparseable' | 'tombstone' | 'over-cap' | 'undecodable', body, primary, causes, blob }`. Mining reads only `state` and `body`.
- Produces (all exported from `deploy/history-replay.mjs`):
  - `MINE_PATH_TOOLS = ['Read', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Glob', 'Grep']` and `MINE_PATH_FIELDS = ['file_path', 'path', 'notebook_path']`, both frozen.
  - `MINE_COMMAND_CHARS = { min: 12, max: 300 }` and `MINE_ERROR_CHARS = { min: 16, max: 300 }`, both frozen, in UTF-16 code units.
  - The four boundary words `'span-unparseable'`, `'span-tombstone'`, `'span-over-cap'` and `'span-undecodable'`, appended to `RECON_DISCARDS` (R5), and the module-private map `SPAN_LOST` from the body pick's state to its word.
  - `FACT_DROP_REASONS`, frozen: the one list of fact drops (R5), this task's fourteen words first: `['path-no-cwd', 'path-tilde', 'path-config-dir', 'command-recall', 'command-length', 'error-no-line', 'error-length', 'duplicate', 'redact-fact', 'redact-leaf', 'result-unpaired', 'producer-other', 'producer-unknown', 'baseline-hit']`. It is disjoint from `DRIVER_REASONS`, from the gate's `GATE_REASONS` and from `RECON_DISCARDS`. Tasks 5 and 6 append their fact drops to it in place.
  - `newDropCounts(): Record<string, number>`: every word at 0, in list order.
  - `noteDrop(counts, reason): void`: it throws `TypeError('noteDrop: …')` for a word outside the list and counts nothing.
  - `rosterConfigDirs(roster: { accounts: readonly { configDirSuffix: string }[] }, home): string[]`: `join(home, configDirSuffix)` for every account the validated roster lists (a hidden one included), deduplicated and sorted by code unit.
  - `mineBoundary({ storeId, ccrcId, generation, boundaryUuid, boundaryTsMs, rows, pick, cwd, cwdReal, configDirs })` answers one of:
    - `{ state: 'mined', boundaryUuid, boundaryTsMs, candidates: FactCandidate[], counts }`;
    - `{ state: 'discard', boundaryUuid, why: one of the four span words, or `body-unrenderable` (D-6303), counts }`.
    It throws `TypeError('mineBoundary: body pick state …')` for a pick state outside the five.
  - `dedupeFamily(mined: MinedBoundary[], counts): FactCandidate[]`: each `(kind, fact)` once, at its first site. The earliest `boundaryTsMs` comes first, ties go by `boundaryUuid` in code-unit order, then file order. Each later copy counts `duplicate`.
  - `screenRedaction(c, idx, memo?): null | 'redact-fact' | 'redact-leaf'`: `redact-fact` when `redactField` changes `fact_raw` or `fact` (R10, F6), else `redact-leaf` when `fact_raw` is not intact in the redacted leaf.
  - `screenProducer(c): null | 'result-unpaired' | 'producer-other' | 'producer-unknown'`.
  - `screenBaseline(c, baselineText): null | 'baseline-hit'`: the one spelling of admission against B, `admitFact(c.kind, c.fact, baselineText, '', { repoRoots: c.repo_roots })`.
  - `screenCandidate(c, { idx, baselineText, memo? }): { state: 'pass' } | { state: 'drop', reason }`: redaction, then the producer, then `screenBaseline`, whose hit is `baseline-hit`.
  - **The mined fact's exact shape**, `FactCandidate`, the one candidate shape every later task reads (R4). Its first twelve fields are the writer's item (Task 6's `WriterItem`); `id`, W2-D73's qid, is added by Task 6's `sourceQuiz` once computed:

    | Field | Type | Meaning |
    |---|---|---|
    | `store_id`, `ccrc_id`, `generation` | string | N's family, as the caller hands it |
    | `boundary_uuid` | string | boundary N |
    | `kind` | `'sha' \| 'path' \| 'command' \| 'error'` | W2-D60's kind |
    | `fact` | string | F: admission and scoring read it |
    | `fact_raw` | string | F_raw: the source side reads it |
    | `source_entry_uuid` | string | the span row it was mined from (W2-D73's field; answerability may name another source, Task 6) |
    | `repo_roots` | string[] | the distinct non-empty of N's epoch's `cwd` and `cwd_real` (W2-D62, W2-D73) |
    | `leaf` | `{ text, rawLen }` | the raw (unredacted) text block, tool_use input string, Bash command, path field or tool_result text it was mined from, and its UTF-8 length (W2-D72's excerpt is this leaf, redacted) |
    | `pair` | `{ name, input: { text, rawLen } } \| null` | for a tool_result leaf, the tool_use block it answers in the span, its input as JSON (W2-D72's `[tool_use <name>] <input>`) |
    | `span` | `{ text, rawLen }[]` | leaf N's span: each mined row's `renderEntryText`, in holding-copy order (W2-D72's `leaf-span`); one frozen list shared by the boundary's candidates |
    | `leaf_key` | string | `<entry_id>:<block>` with `:<leaf index>`, `:command` or `:<field>` appended inside a tool_use, unique within a run |
    | `boundary_ts_ms` | number | T_N |
    | `source_entry_id`, `source_ts_ms`, `source_blob_id`, `source_provenance` | number, number \| null, number, `'model' \| 'tool'` | the span row it was mined from (W2-D70's source) |
    | `producer` | `{ state: 'row', backend } \| { state: 'paired', backend, tool_use_uuid } \| { state: 'unpaired' }` | W2-D65's producer |
    | `ord` | number | its position in its boundary's mined order |

    A `rawLen` is the text's own UTF-8 length. A mined row's body decoded under the cap (any other pick discards the boundary), so no leaf is past it; W2-D54's check in `redactForSpawn` still reads it.
  - Tests, module-level, for later W2-5a describes: `w5a2Akia()`, `w5a2Span(specs)`, `w5a2Text`, `w5a2Use`, `w5a2Result`, `w5a2Mine`, `w5a2MinedOf`, `W5A2_CLAUDE`, `W5A2_GATEWAY`, `W5A2_CWD`, `W5A2_CONFIG_DIRS` and `W5A2_IDX0`.
- Consumed later:
  - Baseline B (W2-D68, W2-D69): `rosterConfigDirs`, and `screenCandidate`'s `baselineText` parameter in Task 4's tests. It owns the B text.
  - Task 6's `sourceQuiz`: `screenRedaction`, `screenProducer` and `screenBaseline` are its `redaction`, `producer` and `admit-baseline` stages, run in `QUIZ_STAGES` order by Task 5's sampler (whose order pin is "the stages run in QUIZ_STAGES order …", M28). `screenCandidate` is the same three in that order, for one candidate.
  - Answerability (W2-D70): `fact_raw`, `source_entry_id`, `source_ts_ms`, `source_blob_id` and `source_provenance`.
  - Sampling and the writer (W2-D71, W2-D72): `dedupeFamily`, `screenRedaction`, `screenProducer`, `FACT_DROP_REASONS`, `newDropCounts`, `noteDrop`, `leaf`, `pair`, `span`, and W2-D67's second pin (a span holding a key-shaped value reaches the writer's stub redacted), Task 6's, built on `w5a2Akia()` and `w5a2Span()` (R7).
  - The frozen list (W2-D73): `kind`, `fact`, `fact_raw`, `source_entry_uuid`, `repo_roots` and `boundary_uuid`.

**Spec:** §10.2 "Questions", anchored by content: the "Source by producer, not by lane" bullet (facts "whose span rows were produced there"), the "Admission" bullet and the "**Redaction.** Candidate facts that match the redaction set (§8.3) are discarded first." bullet. No spec text is edited.

**Decisions:** W2-D61, W2-D65 and W2-D67, with W2-D33 (the body pick), W2-D54 (redaction is lib's, never the display window), W2-D60 (the kinds), W2-D62 (admission, the gate's) and W2-D71 (the filter order) as their inputs.

**Choices this task makes:**
- **The producer is recorded, then screened.** W2-D71 runs redaction before the producer. So mining tags every candidate with its producer and drops none for it, and `screenCandidate` applies the two in that order. The pins check the screen's word.
- **Pairing stays inside the span, in file order.** The map holds the tool_uses seen so far, last write wins, exactly as `prepareLines` builds it. The sweep's `pairedFromStore` parent-chain walk is not used, because it reaches rows outside leaf N's span. A tool_use written after its result does not pair.
- **Only mined rows are picked, and only mined rows can discard.** Provenance is filtered before the pick. A tombstoned operator row is never read and never discards the boundary. A mined row whose pick is `tombstone`, `over-cap`, `undecodable` or `unparseable` discards it with its own word (D-6238's five states are kept apart).
- **`<synthetic>` rows are skipped like the never-mined provenances**, uncounted, so their tool_uses never enter the pairing map.
- **The leaves a sha is mined from are ftsTextOf's:** text blocks, every string leaf of a tool_use input, and tool_result text. Thinking blocks are not. A fact outside the index text could never pass W2-D70(1), so mining it would only add a drop. From a tool row, only its tool_result blocks are mined.
- **Paths.** An absolute field is kept as stored. A relative one is resolved against the epoch's `cwd` with `path.posix.resolve`, which also removes `.` and `..`. A `~`-led field (`path-tilde`), and a relative field with no absolute `cwd` (`path-no-cwd`), are dropped, never guessed. The config-dir test reads the resolved form.
- **A UUID is lib's `UUID_RE`, unanchored and case-insensitive,** so the driver holds no second UUID grammar.
- **Deduplication is per family pool, at the first site** (the earliest boundary, then file order). The pool is then well defined before W2-D71 seeds it. The cost is a residual (below).
- **`screenCandidate` passes `''` as the question.** Admission against the writer's question is the writer's, after it (W2-D72).
- **Both forms of the fact are screened (R10, F6).** W2-D67's text tests F_raw; the writer's input carries F (W2-D72's `{v: 1, kind, fact: F, excerpt}`), and `collapseWs` can join what a newline split, so a bearer header and its value on two lines are intact in F_raw and masked in F. `screenRedaction` tests F_raw first and F second, and both drop as `redact-fact`, the fact's own redaction, before the leaf test. The word is already this task's (the ninth of its fourteen), so the list gains no word: R10 names `redact-fact` as appended, and appending it again would break the list's duplicate-free pin. The F test can only drop more, the safe direction.
- **`memo`** keeps each redacted leaf by `leaf_key` for the caller's scope (a family), so a leaf holding many sha runs is redacted once. Without it, each call redacts again and answers the same.

**Residuals, named:**
- A fact whose first site a later filter drops (redaction, the producer, B) is not retried at a later site of its family. The pool is deduplicated before the filters run. Like B's over-rejection, this biases admission against facts, never toward them.
- A tool_result whose tool_use the sweep paired through the parent chain from outside the span is `result-unpaired` here. W2-D65 says so, and the count is reported.
- Upper-case hex is never a sha fact (W2-D65's class is `[0-9a-f]`).
- A Glob or Grep `path` that is relative to a directory a Bash `cd` moved to is resolved against the epoch's cwd. Read, Edit and Write paths are absolute in Claude Code's own tools.

**Live safety.** Every case in this task is in-process and pure. Nothing is spawned, no HOME is built, no store is opened and no file is written. Span rows and bodies are built in memory, and the pick is a stand-in that records which rows it was asked for. The pair indexes come from `makePairIndex`. The key-shaped value is assembled at runtime. Paths are `/home/u` fixtures. Importing the driver runs nothing (its entry guard is false under vitest). Task 1's import of `cli.mjs` sets the worker's umask to 0o077 (W2-D33), and no case here creates a file. No case reaches a real `claude`, `gh`, ccrc verb or live store.

- [ ] **Step 1: Confirm Task 1's state and the anchors.** From the repository root:

```bash
grep -c "from '../ccd/history/lib.mjs';" deploy/history-replay.mjs
grep -c '^if (process.argv\[1\] && import.meta.url === pathToFileURL(realpathSync(process.argv\[1\])).href) {$' deploy/history-replay.mjs
grep -c '^const sjObject = \|^function sjResultText(content) {$' deploy/history-replay.mjs
grep -c "^  'over-decode-cap', 'leaf-absent',$" deploy/history-replay.mjs
grep -c "^import { ANSWER_PROTOCOL, GATE_CODE_FILES } from './history-gate.mjs';$" deploy/history-replay.mjs
grep -c 'source_tool_use_id\|sourceToolUseID' deploy/history-replay.mjs
grep -cE '^\s*(export\s+)?(function\s*\*?\s*|const\s+|let\s+|var\s+)(collapseWs|FACT_KINDS|SECRET_SHAPE_RES|redact[A-Za-z]*)\b' deploy/history-replay.mjs
grep -c '^export \(const\|function\) \(MINE_\|FACT_DROP_REASONS\|newDropCounts\|noteDrop\|rosterConfigDirs\|mineBoundary\|dedupeFamily\|screenRedaction\|screenProducer\|screenBaseline\|screenCandidate\)' deploy/history-replay.mjs
grep -c 'w5a2' server/test/history-replay.test.ts
grep -c 'expandEntryBody' deploy/history-replay.mjs
node --no-warnings --input-type=module -e "const d = await import('./deploy/history-replay.mjs'); console.log(typeof d.mineBoundary, typeof d.redactForSpawn, typeof d.spanRowsOf, d.DRIVER_REASONS.length > 0)"
```

Expected:
- The first five counts print 1, 1, 2, 1 and 1: Task 1's `RECON_DISCARDS` holds `'leaf-absent'` as its fourteenth word and `'body-unrenderable'` (D-6302) as its fifteenth and last, and Task 1's gate import is the line Step 4(a) extends.
- The sixth prints 0: the driver never spells the column.
- The seventh prints 1, which is W2-4's `export function redactForSpawn(` line, and no other.
- The eighth and ninth print 0.
- The tenth prints 1 or more, Task 1's import and use of the body pick. It is information only: this task never calls it.
- The node line prints `undefined function function true`.

A different count is a gap in Task 1 or an earlier declaration of one of this task's names. Stop and report it. Never declare a second `DriverRefusal`, `sjObject` or `FACT_DROP_REASONS`.

- [ ] **Step 2: Write the failing tests.** In `server/test/history-replay.test.ts`:

(a) Append at the end of the file:

```ts

// ── W2-5a Task 2: fact mining, the producer and the redaction screen (W2-D61, W2-D65, W2-D67) ───────────────────
// Pure and in-process: no spawn, no HOME, no store and no network. Span rows are built in memory with the entries
// columns mining reads, and each row's body comes from a stand-in for W2-1's expandEntryBody answer ({state, body,
// primary, causes, blob}; mining reads state and body only), which records every row it is asked for. Redaction runs
// through lib's own redactField over pair indexes built with makePairIndex, standing in for the run's pairIndexOf
// index. Key-shaped fixtures are assembled at runtime and never written whole; paths are /home/u fixtures.
// MODULE-LEVEL below: w5a2Akia, w5a2Span, the w5a2 block builders and the W5A2_ constants, which later W2-5a tasks call
// from their own describes (Task 6's W2-D67 pin: a span holding a key-shaped value reaches the stub redacted, R7).
import { readFileSync as w5a2Read } from 'node:fs';
import * as w5a2Lib from '../../ccd/history/lib.mjs';
import * as w5a2Gate from '../../deploy/history-gate.mjs';
import * as w5a2Drv from '../../deploy/history-replay.mjs';

/** A synthetic access-key-shaped value lib's shape layer masks, assembled at runtime and never written whole. */
function w5a2Akia(): string {
  return ['AK', 'IA', 'Q7V2M9X4', 'P8W3N6Z5'].join('');
}
/** Model names: backendOf reads the first as anthropic and the second as other. */
const W5A2_CLAUDE = 'claude-fixture-model';
const W5A2_GATEWAY = 'fixture-gateway-model';
const W5A2_CWD = '/home/u/tree';
const W5A2_CONFIG_DIRS = ['/home/u/.claude', '/home/u/.gen-a'];
const W5A2_IDX0 = w5a2Lib.makePairIndex([]);
type W5a2Spec = { provenance: string; body: unknown; model?: string | null; type?: string; state?: string; source_tool_use_id?: string | null };
type W5a2Row = {
  entry_id: number; uuid: string; type: string; model: string | null; provenance: string; ts_ms: number | null; blob_id: number;
  source_tool_use_id: string | null;
};
type W5a2Pick = (r: { entry_id: number }) => { state: string; body: unknown; primary: unknown; causes: string[]; blob: null };
let w5a2NextId = 1000;
/** Span rows in file order, entry ids unique across the file, and a pick that answers like expandEntryBody and records
 *  every row it is asked for. An assistant row defaults to W5A2_CLAUDE; `state` other than 'body' gives a null body. */
function w5a2Span(specs: W5a2Spec[]): { rows: W5a2Row[]; pick: W5a2Pick; picked: number[] } {
  const bodies = new Map<number, { state: string; body: unknown }>();
  const rows = specs.map((s): W5a2Row => {
    const entry_id = w5a2NextId++;
    const state = s.state ?? 'body';
    bodies.set(entry_id, { state, body: state === 'body' ? s.body : null });
    const model = 'model' in s ? s.model ?? null : (s.provenance === 'model' ? W5A2_CLAUDE : null);
    return {
      entry_id, uuid: `fixture-${entry_id}`, type: s.type ?? (s.provenance === 'model' ? 'assistant' : 'user'), model,
      provenance: s.provenance, ts_ms: entry_id, blob_id: entry_id + 50_000, source_tool_use_id: s.source_tool_use_id ?? null,
    };
  });
  const picked: number[] = [];
  const pick: W5a2Pick = (r) => {
    picked.push(r.entry_id);
    const b = bodies.get(r.entry_id)!;
    return { state: b.state, body: b.body, primary: b.body, causes: [], blob: null };
  };
  return { rows, pick, picked };
}
const w5a2Text = (text: string) => ({ type: 'text', text });
const w5a2Use = (id: string, name: string, input: Record<string, unknown>) => ({ type: 'tool_use', id, name, input });
const w5a2Result = (id: string, content: unknown, isError?: boolean) =>
  (isError === undefined ? { type: 'tool_result', tool_use_id: id, content } : { type: 'tool_result', tool_use_id: id, content, is_error: isError });
type W5a2MineInput = Parameters<typeof w5a2Drv.mineBoundary>[0];
type W5a2Mined = Extract<ReturnType<typeof w5a2Drv.mineBoundary>, { state: 'mined' }>;
type W5a2Candidate = W5a2Mined['candidates'][number];
/** mineBoundary over a w5a2Span, as boundary 'fixture-boundary' of family ('fixture-store', 'fixture-a', 'fixture-gen')
 *  with cwd and cwd_real W5A2_CWD; `over` replaces any input. */
function w5a2Mine(sp: { rows: W5a2Row[]; pick: W5a2Pick }, over: Partial<W5a2MineInput> = {}): ReturnType<typeof w5a2Drv.mineBoundary> {
  return w5a2Drv.mineBoundary({
    storeId: 'fixture-store', ccrcId: 'fixture-a', generation: 'fixture-gen',
    boundaryUuid: 'fixture-boundary', boundaryTsMs: 900_000, rows: sp.rows, pick: sp.pick, cwd: W5A2_CWD, cwdReal: W5A2_CWD,
    configDirs: W5A2_CONFIG_DIRS, ...over,
  });
}
/** The mined answer; a discard fails the case. */
function w5a2MinedOf(r: ReturnType<typeof w5a2Drv.mineBoundary>): W5a2Mined {
  expect(r.state).toBe('mined');
  return r as W5a2Mined;
}

describe('W2-5a Task 2: fact mining, the producer and the redaction screen', () => {
  const screen = (c: W5a2Candidate) => w5a2Drv.screenCandidate(c, { idx: W5A2_IDX0, baselineText: '' });
  const DRIVER_URL = new URL('../../deploy/history-replay.mjs', import.meta.url);

  // ── mining (W2-D65) and the two forms of a fact (W2-D61) ──
  it('W2-D65 sha: maximal runs of 7 to 40 lower-case hex with a digit and a letter, bounded, never inside a UUID', () => {
    const text = `commit 9f3e2d1 in session 4d1c9e2a-7b3f-4a6c-9d8e-1f2a3b4c5d6e; build-1f2a3b4c5d6e-x; deadbeef 1234567 ABC1234f g1f2a3b4c ${'a1'.repeat(20)}9 ${'0a'.repeat(20)}`;
    const sp = w5a2Span([{ provenance: 'model', body: [w5a2Text(text)] }]);
    const r = w5a2MinedOf(w5a2Mine(sp));
    expect(r.candidates.map((c) => [c.kind, c.fact, c.fact_raw])).toEqual([
      ['sha', '9f3e2d1', '9f3e2d1'], ['sha', '1f2a3b4c5d6e', '1f2a3b4c5d6e'], ['sha', '0a'.repeat(20), '0a'.repeat(20)],
    ]);
    expect(r.candidates.every((c) => c.leaf.text === text && c.source_provenance === 'model')).toBe(true);
    expect(r.candidates[0]).toMatchObject({
      store_id: 'fixture-store', ccrc_id: 'fixture-a', generation: 'fixture-gen',
      producer: { state: 'row', backend: 'anthropic' }, repo_roots: [W5A2_CWD], boundary_uuid: 'fixture-boundary',
      source_entry_uuid: sp.rows[0]!.uuid, source_entry_id: sp.rows[0]!.entry_id, pair: null,
      leaf: { text, rawLen: Buffer.byteLength(text, 'utf8') },
    });
    // R4: the writer's span is each mined row's rendering, one list the boundary's candidates share.
    expect(r.candidates[0]!.span).toEqual([{ text, rawLen: Buffer.byteLength(text, 'utf8') }]);
    expect(r.candidates.every((c) => c.span === r.candidates[0]!.span)).toBe(true);
  });

  it('W2-D65 command: a Bash input command, collapsed, 12 to 300 characters, never a recall, and only from Bash', () => {
    const at300 = `echo ${'x'.repeat(295)}`;
    const sp = w5a2Span([{ provenance: 'model', body: [
      w5a2Use('c1', 'Bash', { command: 'ls -la /tmp' }),
      w5a2Use('c2', 'Bash', { command: 'npm run test' }),
      w5a2Use('c3', 'Bash', { command: at300 }),
      w5a2Use('c4', 'Bash', { command: `${at300}x` }),
      w5a2Use('c5', 'Bash', { command: 'ccrc history grep thing' }),
      w5a2Use('c6', 'Bash', { command: '/home/u/.local/bin/ccrc history expand x' }),
      w5a2Use('c7', 'Task', { command: 'npm run build', prompt: 'look' }),
    ] }]);
    const r = w5a2MinedOf(w5a2Mine(sp));
    expect(r.candidates.filter((c) => c.kind === 'command').map((c) => c.fact)).toEqual(['npm run test', at300]);
    expect([r.counts['command-length'], r.counts['command-recall']]).toEqual([2, 2]);
  });

  it('W2-D61: a multi-line command is mined, F collapsed and F_raw exact, and the redaction screen keeps it', () => {
    const raw = 'cd server &&\n  ./node_modules/.bin/vitest run \\\n    test/a.test.ts';
    const r = w5a2MinedOf(w5a2Mine(w5a2Span([{ provenance: 'model', body: [w5a2Use('m1', 'Bash', { command: raw })] }])));
    expect(r.candidates).toHaveLength(1);
    const c = r.candidates[0]!;
    expect(c).toMatchObject({ kind: 'command', fact: 'cd server && ./node_modules/.bin/vitest run \\ test/a.test.ts', fact_raw: raw, leaf: { text: raw } });
    expect(c.fact).toBe(w5a2Gate.collapseWs(raw));
    expect(screen(c), 'the source side reads F_raw, which its leaf holds verbatim').toEqual({ state: 'pass' });
  });

  it('W2-D61: a short quoted command present in a kept tool_use is rejected by B, CONTROL the JSON rendering alone would admit it', () => {
    const raw = 'git commit -m "wip"';
    const r = w5a2MinedOf(w5a2Mine(w5a2Span([{ provenance: 'model', body: [w5a2Use('q1', 'Bash', { command: raw })] }])));
    expect(r.candidates).toHaveLength(1);
    const c = r.candidates[0]!;
    expect(c).toMatchObject({ kind: 'command', fact: raw, fact_raw: raw });
    // A stand-in for W2-D68's B over one kept member, in both of its renderings; the B task re-asserts this on real B.
    const kept = (command: string) => [w5a2Use('toolu_k', 'Bash', { command })];
    const both = (command: string) => `${w5a2Lib.renderEntryText(kept(command))}\n${w5a2Lib.ftsTextOf(kept(command), 'entry')}`;
    expect(w5a2Drv.screenCandidate(c, { idx: W5A2_IDX0, baselineText: both(raw) })).toEqual({ state: 'drop', reason: 'baseline-hit' });
    expect(w5a2Drv.screenCandidate(c, { idx: W5A2_IDX0, baselineText: w5a2Lib.renderEntryText(kept(raw)) }), 'CONTROL: the JSON rendering escapes the quotes')
      .toEqual({ state: 'pass' });
    expect(w5a2Drv.screenCandidate(c, { idx: W5A2_IDX0, baselineText: both('git commit -m "wap"') }), 'CONTROL: another command in B')
      .toEqual({ state: 'pass' });
  });

  it('W2-D65 path: the path fields of the seven tools, made absolute against the epoch cwd, never under a rostered config dir', () => {
    const sp = w5a2Span([{ provenance: 'model', body: [
      w5a2Use('p1', 'Read', { file_path: '/home/u/tree/src/app.ts' }),
      w5a2Use('p2', 'Edit', { file_path: 'src/lib/x.ts', old_string: 'a', new_string: 'b' }),
      w5a2Use('p3', 'Glob', { pattern: '**/*.ts', path: 'server' }),
      w5a2Use('p4', 'Grep', { pattern: 'TODO', path: '/home/u/tree/docs' }),
      w5a2Use('p5', 'NotebookEdit', { notebook_path: 'nb/a.ipynb', new_source: 'x' }),
      w5a2Use('p6', 'MultiEdit', { file_path: '../other/y.ts', edits: [] }),
      w5a2Use('p7', 'Write', { file_path: '/home/u/.claude/settings.json', content: '{}' }),
      w5a2Use('p8', 'Read', { file_path: '/home/u/.gen-a/projects/p/memory/m.md' }),
      w5a2Use('p9', 'Read', { file_path: '~/notes.md' }),
      w5a2Use('p10', 'WebFetch', { url: 'https://example.com/a', path: '/home/u/tree/web' }),
    ] }]);
    const r = w5a2MinedOf(w5a2Mine(sp));
    expect(r.candidates.map((c) => [c.kind, c.fact, c.fact_raw])).toEqual([
      ['path', '/home/u/tree/src/app.ts', '/home/u/tree/src/app.ts'],
      ['path', '/home/u/tree/src/lib/x.ts', 'src/lib/x.ts'],
      ['path', '/home/u/tree/server', 'server'],
      ['path', '/home/u/tree/docs', '/home/u/tree/docs'],
      ['path', '/home/u/tree/nb/a.ipynb', 'nb/a.ipynb'],
      ['path', '/home/u/other/y.ts', '../other/y.ts'],
    ]);
    expect([r.counts['path-config-dir'], r.counts['path-tilde'], r.counts['path-no-cwd']]).toEqual([2, 1, 0]);
  });

  it('W2-D65 path: with no epoch cwd a relative path is not mined, and the repo roots are the distinct cwd and cwd_real', () => {
    const body = [w5a2Use('q1', 'Read', { file_path: 'src/a.ts' }), w5a2Use('q2', 'Read', { file_path: '/srv/tree/src/b.ts' })];
    const none = w5a2MinedOf(w5a2Mine(w5a2Span([{ provenance: 'model', body }]), { cwd: null, cwdReal: null }));
    expect(none.candidates.map((c) => [c.fact, c.repo_roots])).toEqual([['/srv/tree/src/b.ts', []]]);
    expect(none.counts['path-no-cwd']).toBe(1);
    const two = w5a2MinedOf(w5a2Mine(w5a2Span([{ provenance: 'model', body }]), { cwd: W5A2_CWD, cwdReal: '/srv/tree' }));
    expect(two.candidates.map((c) => c.repo_roots)).toEqual([[W5A2_CWD, '/srv/tree'], [W5A2_CWD, '/srv/tree']]);
  });

  it('W2-D65 error: an is_error result gives its first non-empty line that is not just Exit code N, collapsed, 16 to 300 characters', () => {
    const uses = ['e1', 'e2', 'e3', 'e4', 'e5'].map((id) => w5a2Use(id, 'Bash', { command: `npm run check-${id}` }));
    const sp = w5a2Span([
      { provenance: 'model', body: uses },
      { provenance: 'tool', body: [w5a2Result('e1', 'Exit code 1\n\n  fatal:   not a git repository (or any parent)\nmore', true)] },
      { provenance: 'tool', body: [w5a2Result('e2', 'Exit code 2\nshort failure', true)] },
      { provenance: 'tool', body: [w5a2Result('e3', 'Exit code 3\n   \n', true)] },
      { provenance: 'tool', body: [w5a2Result('e4', 'error: this result is not marked as an error', false)] },
      { provenance: 'tool', body: [w5a2Result('e5', [w5a2Text('Exit code 1'), w5a2Text('npm ERR! missing script: lint')], true)] },
    ]);
    const r = w5a2MinedOf(w5a2Mine(sp));
    expect(r.candidates.filter((c) => c.kind === 'error').map((c) => [c.fact, c.fact_raw])).toEqual([
      ['fatal: not a git repository (or any parent)', '  fatal:   not a git repository (or any parent)'],
      ['npm ERR! missing script: lint', 'npm ERR! missing script: lint'],
    ]);
    expect([r.counts['error-length'], r.counts['error-no-line']]).toEqual([1, 1]);
    const first = r.candidates.find((c) => c.kind === 'error')!;
    expect(first.leaf.text).toBe('Exit code 1\n\n  fatal:   not a git repository (or any parent)\nmore');
    expect(first.producer).toEqual({ state: 'paired', backend: 'anthropic', tool_use_uuid: sp.rows[0]!.uuid });
    expect(first.pair).toEqual({ name: 'Bash', input: { text: '{"command":"npm run check-e1"}', rawLen: 30 } });
  });

  it.each(['operator', 'summary', 'harness', 'ccrc-injected', 'recall-echo'])('W2-D65 never mined: the %s row, whatever its body holds, and its body is never picked', (prov) => {
    const sp = w5a2Span([{ provenance: prov, body: [
      w5a2Text('commit 9f3e2d1 at /home/u/tree/src/app.ts'),
      w5a2Use('o1', 'Read', { file_path: '/home/u/tree/src/app.ts' }),
      w5a2Result('o1', 'see 9f3e2d1 and a long enough failure line here', true),
    ] }]);
    const r = w5a2MinedOf(w5a2Mine(sp));
    expect(r.candidates).toEqual([]);
    expect(sp.picked).toEqual([]);
  });

  it('W2-D65 never mined: a synthetic assistant row, and a path an operator row names in its text', () => {
    const sp = w5a2Span([
      { provenance: 'model', model: '<synthetic>', body: [w5a2Text('commit 9f3e2d1'), w5a2Use('s1', 'Read', { file_path: '/home/u/tree/a.ts' })] },
      { provenance: 'operator', body: [w5a2Text('please open /home/u/tree/src/app.ts')] },
      { provenance: 'model', body: [w5a2Use('s2', 'Read', { file_path: '/home/u/tree/src/b.ts' })] },
    ]);
    const r = w5a2MinedOf(w5a2Mine(sp));
    expect(r.candidates.map((c) => [c.kind, c.fact])).toEqual([['path', '/home/u/tree/src/b.ts']]);
    expect(sp.picked).toEqual([sp.rows[2]!.entry_id]);
  });

  // ── the producer and its pairing (W2-D65) ──
  it('W2-D65 producer: a tool_result answering a gateway tool_use is dropped as producer-other, CONTROL the same result answering an anthropic one passes', () => {
    const run = (useModel: string) => {
      const sp = w5a2Span([
        { provenance: 'model', model: useModel, body: [w5a2Use('g1', 'Bash', { command: 'git rev-parse HEAD' })] },
        { provenance: 'model', model: W5A2_CLAUDE, body: [w5a2Text('checking the head')] },
        { provenance: 'tool', body: [w5a2Result('g1', 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678')] },
      ]);
      return { sha: w5a2MinedOf(w5a2Mine(sp)).candidates.find((c) => c.kind === 'sha')!, sp };
    };
    const gw = run(W5A2_GATEWAY);
    expect(gw.sha.producer).toEqual({ state: 'paired', backend: 'other', tool_use_uuid: gw.sp.rows[0]!.uuid });
    expect(screen(gw.sha)).toEqual({ state: 'drop', reason: 'producer-other' });
    expect(screen(run(W5A2_CLAUDE).sha), 'CONTROL: an anthropic tool_use').toEqual({ state: 'pass' });
  });

  it('W2-D65 pairing: a tool_result row with a NULL source_tool_use_id but a paired block id is mined and passes, and the block id wins over the column', () => {
    const sp = w5a2Span([
      { provenance: 'model', body: [w5a2Use('n1', 'Bash', { command: 'git log -1 --format=%H' })] },
      { provenance: 'model', model: W5A2_GATEWAY, body: [w5a2Use('n2', 'Bash', { command: 'git log -2 --format=%H' })] },
      { provenance: 'tool', source_tool_use_id: null, body: [w5a2Result('n1', '0123456789abcdef0123456789abcdef01234567')] },
      { provenance: 'tool', source_tool_use_id: 'n1', body: [w5a2Result('n2', '89abcdef0123456789abcdef0123456789abcdef')] },
    ]);
    const shas = w5a2MinedOf(w5a2Mine(sp)).candidates.filter((c) => c.kind === 'sha');
    expect(shas.map((c) => [c.fact, c.producer])).toEqual([
      ['0123456789abcdef0123456789abcdef01234567', { state: 'paired', backend: 'anthropic', tool_use_uuid: sp.rows[0]!.uuid }],
      ['89abcdef0123456789abcdef0123456789abcdef', { state: 'paired', backend: 'other', tool_use_uuid: sp.rows[1]!.uuid }],
    ]);
    expect(shas.map((c) => screen(c))).toEqual([{ state: 'pass' }, { state: 'drop', reason: 'producer-other' }]);
  });

  it('W2-D65 pairing: a result whose tool_use is outside the span or written after it is result-unpaired, as the sweep pairs in file order', () => {
    const outside = w5a2Span([{ provenance: 'tool', body: [w5a2Result('x1', 'fixed in 9f3e2d1')] }]);
    const later = w5a2Span([
      { provenance: 'tool', body: [w5a2Result('x2', 'fixed in 9f3e2d1')] },
      { provenance: 'model', body: [w5a2Use('x2', 'Bash', { command: 'git show --stat HEAD' })] },
    ]);
    for (const sp of [outside, later]) {
      const sha = w5a2MinedOf(w5a2Mine(sp)).candidates.find((c) => c.kind === 'sha')!;
      expect(sha.producer).toEqual({ state: 'unpaired' });
      expect(sha.pair).toBeNull();
      expect(screen(sha)).toEqual({ state: 'drop', reason: 'result-unpaired' });
    }
  });

  it('W2-D65: the driver never reads the source_tool_use_id column, CONTROL the pattern sees a planted read', () => {
    const COLUMN = /source_tool_use_id|sourceToolUseID/;
    const code = (t: string): string[] => t.split('\n').filter((l) => !/^\s*(?:\/\/|\*|\/\*)/.test(l) && COLUMN.test(l));
    expect(code('      const first = row.source_tool_use_id ?? undefined;')).toHaveLength(1);
    expect(code(w5a2Read(DRIVER_URL, 'utf8'))).toEqual([]);
  });

  // ── the body pick (W2-D74 through W2-D65) ──
  it.each(['tombstone', 'over-cap', 'undecodable', 'unparseable'])('W2-D74 via W2-D65: a mined row whose body pick answers %s discards the boundary by its own word', (state) => {
    const sp = w5a2Span([{ provenance: 'model', body: [w5a2Text('commit 9f3e2d1')] }, { provenance: 'model', state, body: null }]);
    expect(w5a2Mine(sp)).toMatchObject({ state: 'discard', why: `span-${state}`, boundaryUuid: 'fixture-boundary' });
  });

  it('W2-D65: a body pick state outside expandEntryBody words is a defect that throws, never a discard word', () => {
    expect(() => w5a2Mine(w5a2Span([{ provenance: 'model', state: 'mystery', body: null }]))).toThrow(/body pick state/);
  });

  it('W2-D65 CONTROL: an unmined row whose body is pruned never discards the boundary and is never picked', () => {
    const sp = w5a2Span([{ provenance: 'operator', state: 'tombstone', body: null }, { provenance: 'model', body: [w5a2Text('commit 9f3e2d1')] }]);
    const r = w5a2MinedOf(w5a2Mine(sp));
    expect(r.candidates.map((c) => c.fact)).toEqual(['9f3e2d1']);
    expect(sp.picked).toEqual([sp.rows[1]!.entry_id]);
  });

  it('W2-D65: kind and fact are deduplicated within a family, the earliest boundary first and file order within it, and another kind with the same text is kept', () => {
    const body = (extra: unknown[]) => [w5a2Text('commit 9f3e2d1'), w5a2Use('d1', 'Bash', { command: 'npm run test' }), ...extra];
    const mine = (uuid: string, ts: number, sp: ReturnType<typeof w5a2Span>) => w5a2MinedOf(w5a2Mine(sp, { boundaryUuid: uuid, boundaryTsMs: ts }));
    const early = mine('b-early', 100, w5a2Span([{ provenance: 'model', body: body([w5a2Text('again 9f3e2d1')]) }]));
    const late = mine('b-late', 200, w5a2Span([
      { provenance: 'model', body: body([w5a2Use('d2', 'Read', { file_path: '/home/u/tree/src/app.ts' })]) },
      { provenance: 'tool', body: [w5a2Result('d2', '/home/u/tree/src/app.ts', true)] },
    ]));
    const counts = w5a2Drv.newDropCounts();
    const kept = w5a2Drv.dedupeFamily([late, early], counts);
    expect(kept.map((c) => [c.boundary_uuid, c.kind, c.fact])).toEqual([
      ['b-early', 'sha', '9f3e2d1'], ['b-early', 'command', 'npm run test'],
      ['b-late', 'path', '/home/u/tree/src/app.ts'], ['b-late', 'error', '/home/u/tree/src/app.ts'],
    ]);
    expect(counts.duplicate).toBe(3);
  });

  // ── the redaction discard (W2-D67) ──
  it('W2-D67: a synthetic key-shaped fact assembled at runtime is discarded first as redact-fact, for a command and for an error line, and counted without its value', () => {
    const key = w5a2Akia();
    const sp = w5a2Span([
      { provenance: 'model', body: [w5a2Use('k1', 'Bash', { command: `aws configure set aws_access_key_id ${key}` })] },
      { provenance: 'tool', body: [w5a2Result('k1', `InvalidClientTokenId: key ${key} rejected`, true)] },
    ]);
    const cands = w5a2MinedOf(w5a2Mine(sp)).candidates;
    expect(cands.map((c) => c.kind)).toEqual(['command', 'error']);
    const counts = w5a2Drv.newDropCounts();
    for (const c of cands) {
      const s = screen(c);
      expect(s).toEqual({ state: 'drop', reason: 'redact-fact' });
      w5a2Drv.noteDrop(counts, (s as { reason: string }).reason);
    }
    expect(counts['redact-fact']).toBe(2);
    expect(JSON.stringify(counts), 'counts carry words, never a value').not.toMatch(new RegExp(`${key.slice(0, 4)}|${key.slice(4)}`));
  });

  it('W2-D67: a fact intact alone but masked inside the leaf it was mined from is discarded as redact-leaf', () => {
    const leaf = `rotate key ${['sk', 'a1b2c3d4e5f6'].join('-')} now`;
    const r = w5a2MinedOf(w5a2Mine(w5a2Span([{ provenance: 'model', body: [w5a2Text(leaf)] }])));
    expect(r.candidates).toHaveLength(1);
    const c = r.candidates[0]!;
    expect(c).toMatchObject({ kind: 'sha', fact_raw: 'a1b2c3d4e5f6', leaf: { text: leaf } });
    expect(w5a2Lib.redactField(c.fact_raw, W5A2_IDX0), 'CONTROL: the fact alone is not masked').toBe('a1b2c3d4e5f6');
    expect(w5a2Lib.redactField(leaf, W5A2_IDX0), 'CONTROL: its leaf masks it').not.toContain('a1b2c3d4e5f6');
    expect(screen(c)).toEqual({ state: 'drop', reason: 'redact-leaf' });
  });

  it('W2-D67 (R10, F6): a whitespace-split bearer token leaves F_raw intact under redaction but not F, and is discarded as redact-fact; CONTROL: the same split command with no Authorization header passes', () => {
    // The token is assembled at runtime. A newline splits the header from its value, so lib's bearer rule ([ \t]+ only)
    // misses F_raw; collapseWs joins them in F, which the rule masks.
    const tok = ['zq', 'w5a2', 'bearer', 'value'].join('');
    const split = `curl -H "Authorization: Bearer\n${tok}" https://api.example.test/v1`;
    const plain = `curl -H "Accept: text/plain"\n${tok} https://api.example.test/v1`;
    const cands = w5a2MinedOf(w5a2Mine(w5a2Span([
      { provenance: 'model', body: [w5a2Use('f6', 'Bash', { command: split })] },
      { provenance: 'model', body: [w5a2Use('f7', 'Bash', { command: plain })] },
    ]))).candidates.filter((x) => x.kind === 'command');
    expect(cands.map((x) => x.fact_raw)).toEqual([split, plain]);
    const [c, ctl] = [cands[0]!, cands[1]!];
    expect(c.fact, 'F joins the header and its value').toBe(`curl -H "Authorization: Bearer ${tok}" https://api.example.test/v1`);
    expect(w5a2Lib.redactField(c.fact_raw, W5A2_IDX0), 'CONTROL: F_raw alone is not masked, so an F_raw-only screen passes it').toBe(c.fact_raw);
    expect(w5a2Lib.redactField(c.leaf.text, W5A2_IDX0), 'CONTROL: nor is its leaf, so redact-leaf does not fire').toContain(c.fact_raw);
    expect(w5a2Lib.redactField(c.fact, W5A2_IDX0), 'CONTROL: F is masked').not.toContain(tok);
    expect(w5a2Drv.screenRedaction(c, W5A2_IDX0)).toBe('redact-fact');
    expect(screen(c)).toEqual({ state: 'drop', reason: 'redact-fact' });
    expect(w5a2Lib.redactField(ctl.fact, W5A2_IDX0), 'CONTROL: the header-less command\'s F is not masked').toBe(ctl.fact);
    expect(w5a2Drv.screenRedaction(ctl, W5A2_IDX0), 'CONTROL: so it passes the screen').toBeNull();
  });

  it('W2-D67: an F_raw the redaction masks under an F it does not (a relative path through a registered value, resolved away) is discarded as redact-fact, never redact-leaf', () => {
    // W2-D67's first clause alone: the AKIA cases fire both clauses (F equals F_raw) and the bearer case only the F
    // clause. The value is assembled at runtime and registered in this case's own pair index; path.posix.resolve
    // removes it from F.
    const secret = ['zq', 'w5a2', 'fraw', 'pathvalue'].join('');
    const idx = w5a2Lib.makePairIndex([{ len: secret.length, sha256: w5a2Lib.sha256Hex(secret) }]);
    const raw = `${secret}/../src/app.ts`;
    const cands = w5a2MinedOf(w5a2Mine(w5a2Span([{ provenance: 'model', body: [w5a2Use('fr1', 'Read', { file_path: raw })] }]))).candidates;
    expect(cands.map((x) => [x.kind, x.fact, x.fact_raw])).toEqual([['path', '/home/u/tree/src/app.ts', raw]]);
    const c = cands[0]!;
    expect(w5a2Lib.redactField(c.fact_raw, idx), 'CONTROL: F_raw is masked').not.toContain(secret);
    expect(w5a2Lib.redactField(c.fact, idx), 'CONTROL: F, resolved past the value, is not').toBe(c.fact);
    expect(w5a2Lib.redactField(c.leaf.text, idx), 'CONTROL: the redacted leaf no longer holds F_raw, so redact-leaf is the next word').not.toContain(c.fact_raw);
    expect(w5a2Drv.screenRedaction(c, idx)).toBe('redact-fact');
    expect(w5a2Drv.screenCandidate(c, { idx, baselineText: '' })).toEqual({ state: 'drop', reason: 'redact-fact' });
  });

  it('W2-D67 order CONTROL: redaction runs before admission, so a masked fact that B also holds is counted redact-fact, never baseline-hit', () => {
    const command = `aws configure set aws_access_key_id ${w5a2Akia()}`;
    const c = w5a2MinedOf(w5a2Mine(w5a2Span([{ provenance: 'model', body: [w5a2Use('o1', 'Bash', { command })] }]))).candidates[0]!;
    const baselineText = `notes\n${command}`;
    expect(w5a2Gate.admitFact('command', c.fact, baselineText, '', { repoRoots: [] }).admitted, 'CONTROL: B holds the fact').toBe(false);
    expect(w5a2Drv.screenCandidate(c, { idx: W5A2_IDX0, baselineText })).toEqual({ state: 'drop', reason: 'redact-fact' });
  });

  it('W2-D67: admission compares unredacted F against unredacted B, so a fact B holds only inside a masked value is still rejected', () => {
    const secret = ['9f3e2d1', 'Q7mZx4Kp', 'W3n6Z5r1H8t2'].join('');
    const idx = w5a2Lib.makePairIndex([{ len: secret.length, sha256: w5a2Lib.sha256Hex(secret) }]);
    const r = w5a2MinedOf(w5a2Mine(w5a2Span([{ provenance: 'model', body: [w5a2Text('cherry-pick 9f3e2d1 onto main')] }])));
    expect(r.candidates).toHaveLength(1);
    const baselineText = `token was ${secret} yesterday`;
    expect(w5a2Lib.redactField(baselineText, idx), 'CONTROL: redaction would hide the fact from B').not.toContain('9f3e2d1');
    expect(w5a2Drv.screenCandidate(r.candidates[0]!, { idx, baselineText })).toEqual({ state: 'drop', reason: 'baseline-hit' });
  });

  it('W2-D67, R5: drop counts carry reason words only, each starting at 0, and a word outside FACT_DROP_REASONS throws; the two driver-local lists are disjoint from each other and from DRIVER_REASONS and GATE_REASONS', () => {
    // This task's fourteen come first; Tasks 5 and 6 append their fact drops after them, in place, each pinning its slice.
    expect(w5a2Drv.FACT_DROP_REASONS.slice(0, 14)).toEqual([
      'path-no-cwd', 'path-tilde', 'path-config-dir', 'command-recall', 'command-length', 'error-no-line', 'error-length',
      'duplicate', 'redact-fact', 'redact-leaf', 'result-unpaired', 'producer-other', 'producer-unknown', 'baseline-hit',
    ]);
    expect(w5a2Drv.RECON_DISCARDS.slice(14, 18), 'the span words, appended to Task 1\'s list').toEqual(['span-unparseable', 'span-tombstone', 'span-over-cap', 'span-undecodable']);
    expect(Object.isFrozen(w5a2Drv.FACT_DROP_REASONS)).toBe(true);
    expect(new Set(w5a2Drv.FACT_DROP_REASONS).size).toBe(w5a2Drv.FACT_DROP_REASONS.length);
    // R5 as amended by R10: only the pairs that involve a drop list are pinned. DRIVER_REASONS and GATE_REASONS already
    // share three words at the base (W2-3's and W2-4's), so that pair is never pinned; QUOTA_SKIPS is a report list.
    expect(w5a2Drv.FACT_DROP_REASONS.filter((w) => w5a2Drv.DRIVER_REASONS.includes(w)), 'a drop is a count, not a refusal').toEqual([]);
    expect(w5a2Drv.FACT_DROP_REASONS.filter((w) => (w5a2Gate.GATE_REASONS as readonly string[]).includes(w)), 'one spelling per word').toEqual([]);
    expect(w5a2Drv.FACT_DROP_REASONS.filter((w) => (w5a2Drv.RECON_DISCARDS as readonly string[]).includes(w)), 'a fact drop is not a boundary discard').toEqual([]);
    const counts = w5a2Drv.newDropCounts();
    expect(Object.keys(counts)).toEqual([...w5a2Drv.FACT_DROP_REASONS]);
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
    expect(() => w5a2Drv.noteDrop(counts, 'not-a-reason')).toThrow(/^noteDrop: /);
    expect(Object.keys(counts)).toEqual([...w5a2Drv.FACT_DROP_REASONS]);
  });

  it('W2-D61 and W2-D67: the driver imports collapseWs and lib redaction and declares no copy of either, CONTROL planted copies are seen', () => {
    const COPY = /^\s*(?:export\s+)?(?:function\s*\*?\s*|const\s+|let\s+|var\s+)(collapseWs|FACT_KINDS|SECRET_SHAPE_RES|redact(?!ForSpawn\b)[A-Za-z]*)\b/;
    const copies = (t: string): string[] => t.split('\n').filter((l) => COPY.test(l));
    // The FACT_KINDS line is built from parts, as measure-history.test.ts's OWN_WORDS are: W2-D12's scan there reads
    // every server/test file and is not anchored to a line start, so a whole planted declaration would be a second holder.
    for (const planted of ['function collapseWs(s) {', `export const ${'FACT' + '_KINDS'} = Object.freeze([]);`, 'const redactLeaf = (t) => t;',
      'export function redactField(text, idx) {', 'const SECRET_SHAPE_RES = [];']) expect(copies(planted), planted).toHaveLength(1);
    expect(copies('export function redactForSpawn(field, idx) {'), "W2-4's door is lib's redactField behind the decode cap").toEqual([]);
    const src = w5a2Read(DRIVER_URL, 'utf8');
    expect(copies(src)).toEqual([]);
    expect(src).toMatch(/^import \{[^}]*\bcollapseWs\b[^}]*\} from '\.\/history-gate\.mjs';$/m);
    expect(src).toMatch(/^import \{[^}]*\bredactField\b[^}]*\} from '\.\.\/ccd\/history\/lib\.mjs';$/m);
  });

  it('W2-D65: rosterConfigDirs lists every rostered account config dir under HOME, hidden ones included, once each and sorted', () => {
    const roster = rosterFromJson({ version: 1, accounts: FIXTURE_ACCOUNTS });
    expect(w5a2Drv.rosterConfigDirs(roster, '/home/u')).toEqual([
      '/home/u/.claude', '/home/u/.cx-a', '/home/u/.ext-a', '/home/u/.ext-n', '/home/u/.gen-a', '/home/u/.gen-d',
      '/home/u/.gen-h', '/home/u/.gen-m', '/home/u/.gen-o', '/home/u/.gen-r', '/home/u/.gen-s', '/home/u/.gen-u',
    ]);
  });
});
```

The describe holds 33 cases: 24 `it`, a five-row `it.each` and a four-row `it.each`. Check what the filter selects: `(cd server && ./node_modules/.bin/vitest list test/history-replay.test.ts -t 'W2-5a Task 2')` lists exactly these 33.

(b) The module-level declarations above the describe (`w5a2Akia` to `w5a2MinedOf`) are for the later W2-5a describes. Each later task appends below this describe and reuses them; none declares them again.

- [ ] **Step 3: Run them and see them fail.** From the repository root, in the foreground, with a timeout of at least 600000 ms:

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-5a Task 2'
```

Expected (predicted): red, `32 failed | 1 passed`, with every other case of the file counted as skipped.
- The case that passes is the column scan. It is green from the start, because the driver never spells the column. Step 6's M17 measures its red.
- 31 of this task's cases fail on an export that does not exist yet: `TypeError: __vite_ssr_import_N__.mineBoundary is not a function` (or `screenCandidate`, `newDropCounts`, `dedupeFamily` or `rosterConfigDirs`), and `… is not a function` on `FACT_DROP_REASONS.slice`. The alias index depends on the file's import count.
- The copy scan fails on its gate-import assertion: Task 1's gate import names no `collapseWs` yet (`… to match /^import \{[^}]*\bcollapseWs\b…/m`).

- [ ] **Step 4: Write the implementation.** In `deploy/history-replay.mjs`:

(a) The imports. From the repository root:

```bash
python3 - deploy/history-replay.mjs <<'EOF'
import re, sys
p = sys.argv[1]
s = open(p).read()
m = re.search(r"^import \{ ([^}]*) \} from '\.\./ccd/history/lib\.mjs';$", s, re.M)
assert m and s.count("from '../ccd/history/lib.mjs';") == 1
names = sorted(set([x.strip() for x in m.group(1).split(',')] + ['UUID_RE', 'backendOf', 'isHistoryCommand', 'isSyntheticModel', 'toolResultIdsOf', 'toolUsesOf']))
s = s[:m.start(1)] + ', '.join(names) + s[m.end(1):]
g = re.search(r"^import \{ ([^}]*) \} from '\./history-gate\.mjs';$", s, re.M)
assert g, "Task 1's gate import is missing"
gates = sorted(set([x.strip() for x in g.group(1).split(',')] + ['admitFact', 'collapseWs']))
s = s[:g.start(1)] + ', '.join(gates) + s[g.end(1):]
old = "  'over-decode-cap', 'leaf-absent',\n"
assert s.count(old) == 1
s = s.replace(old, old + "  'span-unparseable', 'span-tombstone', 'span-over-cap', 'span-undecodable',\n")
open(p, 'w').write(s)
EOF
grep -n "^import" deploy/history-replay.mjs
```

Expected: each module is imported on exactly one line, in Task 1's order (no line is added). The lib line reads `import { EXIT, SCHEMA_ADDED, UUID_RE, backendOf, blobOverDecodeCap, canonicalJson, historyPaths, isHistoryCommand, isSyntheticModel, recallOffPath, redactField, renderEntryText, sha256Hex, summaryRowFor, toolResultIdsOf, toolUsesOf } from '../ccd/history/lib.mjs';`, and the gate line `import { ANSWER_PROTOCOL, GATE_CODE_FILES, admitFact, collapseWs } from './history-gate.mjs';`. `RECON_DISCARDS` now holds the four span words at indexes 14 to 17, between `'leaf-absent'` and `'body-unrenderable'`, which is still last (measured over predicted: the list ended with the four span words).

(b) Directly above the comment line `// The entry guard stays the LAST block of this file`, below Task 1's section, insert:

```js
// ── W2-5a Task 2: fact mining, the producer and the redaction screen (W2-D61, W2-D65, W2-D67) ───────────────────
// Mining (W2-D65) reads leaf N's span rows only, in holding-copy file order, each body through W2-1's body pick
// (expandEntryBody, which the caller hands in as `pick`; W2-D74). It yields every candidate of the four fact kinds
// (W2-D60) with both of its forms (W2-D61): `fact_raw`, the exact stored leaf or line, which the source side reads
// (the redaction screen below, answerability's index-text check, the writer's excerpt and the arm-time re-check), and
// `fact`, which admission and scoring read: collapseWs(fact_raw) for a command or an error, the run lower-cased for a
// sha, and the path made absolute against the epoch's cwd for a path. collapseWs is the gate's (W2-3); this file
// keeps no copy of it. Rows of any provenance but model and tool, and assistant rows whose model is Claude Code's own
// notice, are never mined and never picked. A mined row whose pick is not a body discards the boundary, by its own word.
// The producer (W2-D65) is decided per row through lib's backendOf alone. A tool result takes the backend of the
// assistant row in the SAME span whose tool_use ids hold its first answered id: the sweep's own pairing (prepareLines:
// the tool_uses seen so far, in file order). The entries column the sweep fills from the row's own field is never
// read, and nor is the sweep's walk up the parent chain, which can leave the span. A result with no such row is
// unpaired. The producer is recorded at mining and applied by the screen, in W2-D71's lazy order.
// The screen (W2-D71's first three filters): redaction (W2-D67), then the producer, then admission against Baseline B
// (W2-D62: the gate's admitFact over unredacted F and unredacted B, in memory only). Redaction is lib's redactField,
// the composed door 5h-2 left (5h-2's R11), over the run's pair index (pairIndexOf, built once per run by the caller): a
// candidate is dropped when its fact_raw is masked alone, or no longer occurs verbatim in its leaf once the leaf is
// masked. Every drop is counted by its word and never by its value.

/** The tools whose path fields are path facts (W2-D65). */
export const MINE_PATH_TOOLS = Object.freeze(['Read', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Glob', 'Grep']);
/** The path fields read from those tools' inputs, in this order (W2-D65). */
export const MINE_PATH_FIELDS = Object.freeze(['file_path', 'path', 'notebook_path']);
/** A command fact's collapsed length bounds, in UTF-16 code units, the unit the gate measures F in (W2-D65). */
export const MINE_COMMAND_CHARS = Object.freeze({ min: 12, max: 300 });
/** An error fact's collapsed length bounds, in the same unit (W2-D65). */
export const MINE_ERROR_CHARS = Object.freeze({ min: 16, max: 300 });
/** The boundary discard a mined row with no body gives, one per non-body state of W2-1's body pick (D-6238), never
 *  folded into one (W2-D74: a tombstone discards the boundary; W2-D54: so does over-cap). The words are RECON_DISCARDS'
 *  (R5). */
const SPAN_LOST = Object.freeze({ unparseable: 'span-unparseable', tombstone: 'span-tombstone', 'over-cap': 'span-over-cap', undecodable: 'span-undecodable' });
/** Every word a fact site or a candidate is dropped with: the one list of fact drops (R5). Drops are counted by word,
 *  never by value (W2-D67, W2-D71). A drop is a count, not a refusal, so no word here is a DRIVER_REASONS word, none is a
 *  gate word (the writer's two discards are the gate's GATE_REASONS), and none is a RECON_DISCARDS word. Tasks 5 and 6
 *  append theirs here, in place. */
export const FACT_DROP_REASONS = Object.freeze([
  'path-no-cwd', 'path-tilde', 'path-config-dir', 'command-recall', 'command-length', 'error-no-line', 'error-length',
  'duplicate', 'redact-fact', 'redact-leaf', 'result-unpaired', 'producer-other', 'producer-unknown', 'baseline-hit',
]);
/** The span-row provenances mining reads. Operator, summary, harness, ccrc-injected and recall-echo rows never are. */
const MINED_PROVENANCE = Object.freeze(['model', 'tool']);
/** A sha fact's run: 7 to 40 lower-case hex, with no [0-9A-Za-z] on either side, so a longer run yields none. */
const SHA_RUN = /(?<![0-9A-Za-z])[0-9a-f]{7,40}(?![0-9A-Za-z])/g;
/** lib's UUID grammar, unanchored and in either case: a run inside one of these is a UUID segment, not a sha. */
const UUID_SPAN = new RegExp(UUID_RE.source.slice(1, -1), 'gi');
/** A line that says only which exit code a command returned: never an error fact by itself. */
const EXIT_CODE_LINE = /^Exit code -?[0-9]+$/;

/** One span row, in holding-copy file order: the entries columns mining reads.
 *  @typedef {{ entry_id: number, uuid: string, type: string, model: string | null, provenance: string,
 *    ts_ms: number | null, blob_id: number }} SpanRow */
/** W2-1's expandEntryBody answer as mining reads it: the state word and, for 'body', the picked body.
 *  @typedef {{ state: string, body: unknown }} PickedBody */
/** Who produced a candidate's row (W2-D65): its own assistant row, the assistant row its result answers, or nobody.
 *  @typedef {{ state: 'row', backend: string } | { state: 'paired', backend: string, tool_use_uuid: string }
 *    | { state: 'unpaired' }} FactProducer */
/** A stored text as a spawn's input reads it (W2-D54): the text and its UTF-8 length.
 *  @typedef {{ text: string, rawLen: number }} StoredField */
/** One candidate fact (W2-D61, W2-D65), the one candidate shape every later task reads (R4). Its first twelve fields are
 *  the writer's item: the family, boundary N, `kind`, `fact` (F), `fact_raw` (F_raw), `source_entry_uuid`, `repo_roots`,
 *  `leaf` (the raw, unredacted text block, tool_use input string, Bash command, path field or tool_result text it was
 *  mined from), `pair` (the tool_use a tool_result leaf answers, its input as JSON; W2-D72's excerpt reads it) and `span`
 *  (leaf N's span, each mined row's rendering). The rest are mining's: `leaf_key` names the leaf within the run, and the
 *  source fields are W2-D70's.
 *  @typedef {{ store_id: string, ccrc_id: string, generation: string, boundary_uuid: string,
 *    kind: 'sha' | 'path' | 'command' | 'error', fact: string, fact_raw: string, source_entry_uuid: string,
 *    repo_roots: string[], leaf: StoredField, pair: { name: string, input: StoredField } | null, span: StoredField[],
 *    leaf_key: string, boundary_ts_ms: number, source_entry_id: number, source_ts_ms: number | null,
 *    source_blob_id: number, source_provenance: string, producer: FactProducer, ord: number }} FactCandidate */
/** @typedef {{ state: 'mined', boundaryUuid: string, boundaryTsMs: number, candidates: FactCandidate[],
 *    counts: Record<string, number> }} MinedBoundary */
/** @typedef {{ state: 'discard', boundaryUuid: string, why: string, counts: Record<string, number> }} DiscardedBoundary */

/** A fresh drop tally: every FACT_DROP_REASONS word at 0, in that order.
 *  @returns {Record<string, number>} */
export function newDropCounts() {
  return Object.fromEntries(FACT_DROP_REASONS.map((w) => [w, 0]));
}

/** Count one drop. A word outside FACT_DROP_REASONS is a defect: it throws and counts nothing.
 *  @param {Record<string, number>} counts  @param {string} reason */
export function noteDrop(counts, reason) {
  if (!FACT_DROP_REASONS.includes(reason)) throw new TypeError(`noteDrop: ${JSON.stringify(reason)} is not a FACT_DROP_REASONS word`);
  counts[reason] += 1;
}

/** A stored field from a mined leaf: its text and its own UTF-8 length. A mined row's body decoded under the cap (any
 *  other pick discards the boundary), so no leaf is past it. */
const storedField = (text) => ({ text, rawLen: Buffer.byteLength(text, 'utf8') });

/** Every rostered account's config dir under `home`, once each, sorted by code unit: the directories a path fact may
 *  not sit under (W2-D65), and W2-D69's (b) and (c) (Task 4). `roster` is readRoster's validated roster, which lists hidden accounts too and carries no
 *  hidden flag (shared/roster-json.d.mts), so a hidden account's dir is excluded like any other.
 *  @param {{ accounts: readonly { configDirSuffix: string }[] }} roster  @param {string} home
 *  @returns {string[]} */
export function rosterConfigDirs(roster, home) {
  return [...new Set(roster.accounts.map((a) => join(home, a.configDirSuffix)))].sort();
}

/** Every sha fact of one leaf, in position order (W2-D65): a SHA_RUN that holds a digit and a letter and overlaps no
 *  UUID-shaped span. */
function shaRunsOf(leaf) {
  const uuids = [...leaf.matchAll(UUID_SPAN)].map((m) => [m.index, m.index + m[0].length]);
  const out = [];
  for (const m of leaf.matchAll(SHA_RUN)) {
    const run = m[0];
    if (!/[0-9]/.test(run) || !/[a-f]/.test(run)) continue;
    if (uuids.some(([from, to]) => m.index < to && m.index + run.length > from)) continue;
    out.push(run);
  }
  return out;
}

/** The string leaves of a tool_use input, depth-first in key order: the leaves lib's ftsTextOf indexes (its walker
 *  is module-private, and W2-5a never edits lib). */
function inputLeavesOf(input) {
  const out = [];
  const stack = [input];
  while (stack.length > 0) {
    const v = stack.pop();
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) for (let i = v.length - 1; i >= 0; i -= 1) stack.push(v[i]);
    else if (sjObject(v)) {
      const keys = Object.keys(v);
      for (let i = keys.length - 1; i >= 0; i -= 1) stack.push(v[keys[i]]);
    }
  }
  return out;
}

/** A path field's fact, made absolute against the epoch's cwd, or the word it is dropped with (W2-D65). An absolute
 *  field is kept as stored; the config-dir test reads its resolved form, so a `..` cannot walk under one unseen. */
function pathFactOf(raw, cwd, configDirs) {
  if (raw.startsWith('~')) return { drop: 'path-tilde' };
  let fact = raw;
  if (!raw.startsWith('/')) {
    if (typeof cwd !== 'string' || !cwd.startsWith('/')) return { drop: 'path-no-cwd' };
    fact = path.posix.resolve(cwd, raw);
  }
  const where = path.posix.resolve(fact);
  const under = (d) => where === d || where.startsWith(d + '/');
  if (configDirs.some(under)) return { drop: 'path-config-dir' };
  return { fact };
}

/** Mine one boundary's candidates (W2-D61, W2-D65). Pure: it reads the rows it is handed and calls `pick` once for
 *  each row it mines, never for any other row. The family (`storeId`, `ccrcId`, `generation`) is carried onto every
 *  candidate, so the candidate is the writer's item (R4).
 *  @param {{ storeId: string, ccrcId: string, generation: string, boundaryUuid: string, boundaryTsMs: number,
 *    rows: readonly SpanRow[], pick: (row: SpanRow) => PickedBody, cwd: string | null, cwdReal: string | null,
 *    configDirs: readonly string[] }} input
 *  @returns {MinedBoundary | DiscardedBoundary} */
export function mineBoundary({ storeId, ccrcId, generation, boundaryUuid, boundaryTsMs, rows, pick, cwd, cwdReal, configDirs }) {
  const counts = newDropCounts();
  const repoRoots = [...new Set([cwd, cwdReal].filter((r) => typeof r === 'string' && r !== ''))];
  const uses = new Map();
  const span = [];
  const candidates = [];
  for (const row of rows) {
    if (!MINED_PROVENANCE.includes(row.provenance)) continue;
    if (row.provenance === 'model' && isSyntheticModel(row.model)) continue;
    const picked = pick(row);
    if (picked.state !== 'body') {
      const why = Object.hasOwn(SPAN_LOST, picked.state) ? SPAN_LOST[picked.state] : undefined;
      if (why === undefined) throw new TypeError(`mineBoundary: body pick state ${JSON.stringify(picked.state)} is not one expandEntryBody answers`);
      return { state: 'discard', boundaryUuid, why, counts };
    }
    span.push(storedField(renderEntryText(picked.body)));
    const blocks = Array.isArray(picked.body) ? picked.body : [];
    let producer;
    if (row.provenance === 'model') {
      producer = { state: 'row', backend: backendOf(row.model) };
      for (const u of toolUsesOf(picked.body)) uses.set(u.id, { row, block: blocks.find((b) => sjObject(b) && b.type === 'tool_use' && b.id === u.id) });
    } else {
      const first = toolResultIdsOf(picked.body)[0];
      const pair = first === undefined ? undefined : uses.get(first);
      producer = pair === undefined ? { state: 'unpaired' } : { state: 'paired', backend: backendOf(pair.row.model), tool_use_uuid: pair.row.uuid };
    }
    const add = (kind, fact, factRaw, leaf, leafKey, pair) => {
      candidates.push({
        store_id: storeId, ccrc_id: ccrcId, generation, boundary_uuid: boundaryUuid, kind, fact, fact_raw: factRaw,
        source_entry_uuid: row.uuid, repo_roots: repoRoots, leaf: storedField(leaf), pair, span,
        leaf_key: leafKey, boundary_ts_ms: boundaryTsMs, source_entry_id: row.entry_id, source_ts_ms: row.ts_ms,
        source_blob_id: row.blob_id, source_provenance: row.provenance, producer, ord: candidates.length,
      });
    };
    const addShas = (leaf, leafKey, pair) => {
      for (const run of shaRunsOf(leaf)) add('sha', run.toLowerCase(), run, leaf, leafKey, pair);
    };
    blocks.forEach((b, bi) => {
      if (!sjObject(b)) return;
      const key = `${row.entry_id}:${bi}`;
      if (row.provenance === 'model') {
        if (b.type === 'text' && typeof b.text === 'string') addShas(b.text, key, null);
        if (b.type !== 'tool_use') return;
        const input = sjObject(b.input) ? b.input : {};
        if (b.name === 'Bash' && typeof input.command === 'string') {
          const fact = collapseWs(input.command);
          if (isHistoryCommand(input.command)) noteDrop(counts, 'command-recall');
          else if (fact.length < MINE_COMMAND_CHARS.min || fact.length > MINE_COMMAND_CHARS.max) noteDrop(counts, 'command-length');
          else add('command', fact, input.command, input.command, `${key}:command`, null);
        }
        if (MINE_PATH_TOOLS.includes(b.name)) {
          for (const field of MINE_PATH_FIELDS) {
            const raw = input[field];
            if (typeof raw !== 'string' || raw === '') continue;
            const p = pathFactOf(raw, cwd, configDirs);
            if (p.drop !== undefined) noteDrop(counts, p.drop);
            else add('path', p.fact, raw, raw, `${key}:${field}`, null);
          }
        }
        inputLeavesOf(b.input).forEach((leaf, li) => addShas(leaf, `${key}:${li}`, null));
        return;
      }
      if (b.type !== 'tool_result') return;
      const text = sjResultText(b.content);
      if (text === null) return;
      const answered = typeof b.tool_use_id === 'string' ? uses.get(b.tool_use_id) : undefined;
      const pair = answered?.block === undefined ? null
        : { name: typeof answered.block.name === 'string' ? answered.block.name : '', input: storedField(JSON.stringify(answered.block.input ?? null)) };
      if (b.is_error === true) {
        const line = text.split('\n').find((l) => {
          const c = collapseWs(l);
          return c !== '' && !EXIT_CODE_LINE.test(c);
        });
        if (line === undefined) noteDrop(counts, 'error-no-line');
        else {
          const fact = collapseWs(line);
          if (fact.length < MINE_ERROR_CHARS.min || fact.length > MINE_ERROR_CHARS.max) noteDrop(counts, 'error-length');
          else add('error', fact, line, text, key, pair);
        }
      }
      addShas(text, key, pair);
    });
  }
  Object.freeze(span);
  return { state: 'mined', boundaryUuid, boundaryTsMs, candidates, counts };
}

/** Earliest boundary first, ties by boundary uuid in code-unit order. */
function byBoundaryTime(a, b) {
  if (a.boundaryTsMs !== b.boundaryTsMs) return a.boundaryTsMs - b.boundaryTsMs;
  return a.boundaryUuid < b.boundaryUuid ? -1 : a.boundaryUuid > b.boundaryUuid ? 1 : 0;
}

/** One family's candidate pool (W2-D65): (kind, fact) once, kept at its first site, the earliest boundary first and
 *  file order within it, whatever order the boundaries arrive in. Each later copy counts `duplicate`.
 *  @param {readonly MinedBoundary[]} mined  @param {Record<string, number>} counts
 *  @returns {FactCandidate[]} */
export function dedupeFamily(mined, counts) {
  const order = [...mined].sort(byBoundaryTime);
  const seen = new Set();
  const kept = [];
  for (const m of order) {
    for (const c of m.candidates) {
      const key = canonicalJson([c.kind, c.fact]);
      if (seen.has(key)) { noteDrop(counts, 'duplicate'); continue; }
      seen.add(key);
      kept.push(c);
    }
  }
  return kept;
}

/** The redaction screen (W2-D67): 'redact-fact' when lib's redactField changes fact_raw alone, or changes F alone
 *  (R10, F6: collapseWs can join a header and the value a newline split, and the writer's input carries F), then
 *  'redact-leaf' when fact_raw no longer occurs verbatim in its leaf once the leaf is redacted, else null. `memo`
 *  (optional) keeps each redacted leaf by leaf_key for the caller's scope, so a leaf holding many candidates is
 *  redacted once.
 *  @param {FactCandidate} c  @param {import('../ccd/history/lib.mjs').PairIndex} idx  @param {Map<string, string> | null} [memo]
 *  @returns {null | 'redact-fact' | 'redact-leaf'} */
export function screenRedaction(c, idx, memo = null) {
  if (redactField(c.fact_raw, idx) !== c.fact_raw) return 'redact-fact';
  if (redactField(c.fact, idx) !== c.fact) return 'redact-fact';
  let masked = memo === null ? undefined : memo.get(c.leaf_key);
  if (masked === undefined) {
    masked = redactField(c.leaf.text, idx);
    if (memo !== null) memo.set(c.leaf_key, masked);
  }
  return masked.includes(c.fact_raw) ? null : 'redact-leaf';
}

/** The producer screen (W2-D65): null for an anthropic producer, else the word.
 *  @param {FactCandidate} c
 *  @returns {null | 'result-unpaired' | 'producer-other' | 'producer-unknown'} */
export function screenProducer(c) {
  if (c.producer.state === 'unpaired') return 'result-unpaired';
  if (c.producer.backend === 'anthropic') return null;
  return c.producer.backend === 'other' ? 'producer-other' : 'producer-unknown';
}

/** W2-D71's third filter, the one spelling of admission against Baseline B (W2-D62): the gate's admitFact over
 *  unredacted F and B's unredacted text, with no question yet. screenCandidate and Task 6's sourceQuiz 'admit-baseline'
 *  stage both call it, so the admission call is written once.
 *  @param {FactCandidate} c  @param {string} baselineText
 *  @returns {null | 'baseline-hit'} */
export function screenBaseline(c, baselineText) {
  const admission = admitFact(c.kind, c.fact, baselineText, '', { repoRoots: c.repo_roots });
  return admission.admitted ? null : 'baseline-hit';
}

/** W2-D71's first three filters, in its order: redaction, the producer, then admission against Baseline B
 *  (screenBaseline). `baselineText` is B's unredacted text, held in memory by the caller.
 *  @param {FactCandidate} c
 *  @param {{ idx: import('../ccd/history/lib.mjs').PairIndex, baselineText: string, memo?: Map<string, string> | null }} ctx
 *  @returns {{ state: 'pass' } | { state: 'drop', reason: string }} */
export function screenCandidate(c, { idx, baselineText, memo = null }) {
  const early = screenRedaction(c, idx, memo) ?? screenProducer(c);
  if (early !== null) return { state: 'drop', reason: early };
  const late = screenBaseline(c, baselineText);
  return late === null ? { state: 'pass' } : { state: 'drop', reason: late };
}
```

Then check:
- `grep -c '^if (process.argv\[1\] && import.meta.url' deploy/history-replay.mjs` prints 1, and it is still the file's last block.
- `grep -c 'source_tool_use_id\|sourceToolUseID\|redactDisplayWindow' deploy/history-replay.mjs` prints 0.
- `grep -cE '^\s*(export\s+)?(function\s*\*?\s*|const\s+|let\s+|var\s+)(collapseWs|FACT_KINDS|SECRET_SHAPE_RES|redact[A-Za-z]*)\b' deploy/history-replay.mjs` still prints 1, W2-4's `redactForSpawn`.

- [ ] **Step 5: Run them and see them pass, then run the whole file and the typecheck.** In the foreground, with a timeout of at least 600000 ms:

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-5a Task 2'
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts
cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit
```

Expected:
- **The filtered run** is green: `33 passed`, the other cases counted as skipped.
- **The whole file** is green: every earlier case plus these 33, Task 1's `RECON_DISCARDS` case included (it pins only its own first fourteen words).
- **tsc** prints nothing. The cases reach the driver's types through `allowJs` and the JSDoc typedefs (`SpanRow`, `PickedBody`, `FactCandidate`, `MinedBoundary`, `DiscardedBoundary`), and `W5a2Mined` narrows on the literal `state: 'mined'`. A line naming only `agent/src/`, or a module that is not installed, comes from the worktree's install, not from this task. A line naming `history-replay` is this task's.

- [ ] **Step 6: Measure every guard red, then green.** From the repository root. Each mutant is one or more exact replacements, each asserted to match once. The mutant file is written through a quoted heredoc, so no shell expansion touches the code, and every run restores the driver with `cp`. The predictions below were measured on this section's code in a scratch copy outside the tree, under `node:assert` versions of these cases; under vitest they are predicted, with the same failing cases.

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w2-5a/scratch"; mkdir -p "$SCRATCH"
cp deploy/history-replay.mjs "$SCRATCH/driver.orig"
cat > "$SCRATCH/t2-mutants.py" <<'EOF'
import sys
MUTANTS = {
  'M1': [(r'''    if (uuids.some(([from, to]) => m.index < to && m.index + run.length > from)) continue;
''', '')],
  'M2': [(r'''const SHA_RUN = /(?<![0-9A-Za-z])[0-9a-f]{7,40}(?![0-9A-Za-z])/g;''', r'''const SHA_RUN = /[0-9a-f]{7,40}(?![0-9A-Za-z])/g;''')],
  'M3': [(r'''    if (!/[0-9]/.test(run) || !/[a-f]/.test(run)) continue;
''', '')],
  'M4': [(r'''          if (isHistoryCommand(input.command)) noteDrop(counts, 'command-recall');''', r'''          if (false) noteDrop(counts, 'command-recall');''')],
  'M5': [(r'''          else if (fact.length < MINE_COMMAND_CHARS.min || fact.length > MINE_COMMAND_CHARS.max) noteDrop(counts, 'command-length');''', r'''          else if (false) noteDrop(counts, 'command-length');''')],
  'M6': [(r'''          const fact = collapseWs(input.command);''', r'''          const fact = input.command;''')],
  'M7': [(r'''  return masked.includes(c.fact_raw) ? null : 'redact-leaf';''', r'''  return masked.includes(c.fact) ? null : 'redact-leaf';''')],
  'M8': [(r'''          const fact = collapseWs(input.command);''', r'''          const fact = collapseWs(input.command).replace(/["']/g, '');''')],
  'M9': [(r'''  const admission = admitFact(c.kind, c.fact, baselineText, '', { repoRoots: c.repo_roots });''', r'''  const admission = c.fact.length < 40 ? { admitted: true } : admitFact(c.kind, c.fact, baselineText, '', { repoRoots: c.repo_roots });''')],
  'M10': [(r'''    fact = path.posix.resolve(cwd, raw);''', r'''    fact = raw;''')],
  'M11': [(r'''  if (configDirs.some(under)) return { drop: 'path-config-dir' };
''', '')],
  'M12': [(r'''          return c !== '' && !EXIT_CODE_LINE.test(c);''', r'''          return c !== '';''')],
  'M13': [(r'''    if (!MINED_PROVENANCE.includes(row.provenance)) continue;
''', '')],
  'M14': [(r'''    if (row.provenance === 'model' && isSyntheticModel(row.model)) continue;
''', '')],
  'M15': [
    (r'''  const uses = new Map();
''', r'''  const uses = new Map();
  let lastModelRow;
'''),
    (r'''      producer = { state: 'row', backend: backendOf(row.model) };
''', r'''      producer = { state: 'row', backend: backendOf(row.model) };
      lastModelRow = row;
'''),
    (r'''      const pair = first === undefined ? undefined : uses.get(first);''', r'''      const pair = first === undefined || lastModelRow === undefined ? undefined : { row: lastModelRow };'''),
  ],
  'M16': [(r'''  if (c.producer.backend === 'anthropic') return null;''', r'''  if (c.producer.state === 'paired' || c.producer.backend === 'anthropic') return null;''')],
  'M17': [(r'''      const first = toolResultIdsOf(picked.body)[0];''', r'''      const first = row.source_tool_use_id ?? undefined;''')],
  'M18': [(r'''  const candidates = [];
  for (const row of rows) {''', r'''  const candidates = [];
  for (const r0 of rows) if (r0.provenance === 'model') { const p0 = pick(r0); if (p0.state === 'body') for (const u of toolUsesOf(p0.body)) uses.set(u.id, { row: r0, block: undefined }); }
  for (const row of rows) {''')],
  'M19': [(r'''    if (picked.state !== 'body') {
      const why''', r'''    if (picked.state !== 'body') continue;
    if (false) {
      const why''')],
  'M20': [(r'''    if (!MINED_PROVENANCE.includes(row.provenance)) continue;
    if (row.provenance === 'model' && isSyntheticModel(row.model)) continue;
    const picked = pick(row);
''', r'''    const picked = pick(row);
    if (!MINED_PROVENANCE.includes(row.provenance)) continue;
    if (row.provenance === 'model' && isSyntheticModel(row.model)) continue;
''')],
  'M21': [(r'''      if (seen.has(key)) { noteDrop(counts, 'duplicate'); continue; }
''', '')],
  'M22': [(r'''  const order = [...mined].sort(byBoundaryTime);''', r'''  const order = [...mined];''')],
  'M23': [(r'''  const early = screenRedaction(c, idx, memo) ?? screenProducer(c);''', r'''  const early = screenProducer(c);''')],
  'M24': [(r'''  return masked.includes(c.fact_raw) ? null : 'redact-leaf';''', r'''  return null;''')],
  'M25': [(r'''  const early = screenRedaction(c, idx, memo) ?? screenProducer(c);
  if (early !== null) return { state: 'drop', reason: early };
  const late = screenBaseline(c, baselineText);
  return late === null ? { state: 'pass' } : { state: 'drop', reason: late };''', r'''  const late = screenBaseline(c, baselineText);
  if (late !== null) return { state: 'drop', reason: late };
  const early = screenRedaction(c, idx, memo) ?? screenProducer(c);
  return early !== null ? { state: 'drop', reason: early } : { state: 'pass' };''')],
  'M26': [(r'''  const late = screenBaseline(c, baselineText);''', r'''  const late = screenBaseline(c, redactField(baselineText, idx));''')],
  'M27': [(r'''  if (!FACT_DROP_REASONS.includes(reason)) throw new TypeError(`noteDrop: ${JSON.stringify(reason)} is not a FACT_DROP_REASONS word`);
''', '')],
  'M28': [(r'''const MINED_PROVENANCE = Object.freeze(['model', 'tool']);''', r'''const redactLeaf = (t) => t;
const MINED_PROVENANCE = Object.freeze(['model', 'tool']);''')],
  'M29': [(r'''  return [...new Set(roster.accounts.map((a) => join(home, a.configDirSuffix)))].sort();''', r'''  return roster.accounts.map((a) => join(home, a.configDirSuffix));''')],
  'M30': [(r'''      if (why === undefined) throw new TypeError(`mineBoundary: body pick state ${JSON.stringify(picked.state)} is not one expandEntryBody answers`);
''', '')],
  'M31': [(r'''  if (redactField(c.fact, idx) !== c.fact) return 'redact-fact';
''', '')],
  'M32': [(r'''  if (redactField(c.fact_raw, idx) !== c.fact_raw) return 'redact-fact';
''', '')],
}
name, path = sys.argv[1], sys.argv[2]
s = open(path).read()
for old, new in MUTANTS[name]:
    assert s.count(old) == 1, (name, old[:60], s.count(old))
    s = s.replace(old, new)
open(path, 'w').write(s)
EOF
t2mut() {   # t2mut <mutant> <filter>: apply one mutant, run its filter, restore the driver
  python3 "$SCRATCH/t2-mutants.py" "$1" deploy/history-replay.mjs && (cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t "$2")
  cp "$SCRATCH/driver.orig" deploy/history-replay.mjs
}

# M1 (W2-D65 sha): the UUID exclusion dropped.
t2mut M1 'W2-D65 sha'
# Expected RED (predicted): 1 failed, the sha case: 4d1c9e2a and the UUID's 1f2a3b4c5d6e are mined.

# M2 (W2-D65 sha): the left boundary dropped, so a run glued to a letter, and the tail of a 41-character run, are mined.
t2mut M2 'W2-D65 sha'
# Expected RED (predicted): 1 failed, the sha case: 1f2a3b4c (after g) and the last 40 characters of the 41-character run appear.

# M3 (W2-D65 sha): the digit-and-letter test dropped.
t2mut M3 'W2-D65 sha'
# Expected RED (predicted): 1 failed, the sha case: deadbeef and 1234567 appear.

# M4 (W2-D65 command): a recall command mined.
t2mut M4 'W2-D65 command'
# Expected RED (predicted): 1 failed, the command case: the two ccrc history commands appear and command-recall is 0.

# M5 (W2-D65 command): the length bounds dropped.
t2mut M5 'W2-D65 command'
# Expected RED (predicted): 1 failed, the command case: the 11- and 301-character commands appear.

# M6 (W2-D61): F is the stored command, not collapsed.
t2mut M6 'multi-line command'
# Expected RED (predicted): 1 failed, the multi-line case: fact holds the newlines.

# M7 (W2-D61): the source side reads F instead of F_raw.
t2mut M7 'multi-line command'
# Expected RED (predicted): 1 failed, the multi-line case: { state: 'drop', reason: 'redact-leaf' } where pass was expected.

# M8 (W2-D61): a command's quotes stripped from F.
t2mut M8 'short quoted command'
# Expected RED (predicted): 1 failed, the quoted case: fact 'git commit -m wip'.

# M9 (W2-D61, W2-D62): admission skipped for an F under the 40-character window.
t2mut M9 'short quoted command|unredacted F against unredacted B'
# Expected RED (predicted): 2 failed, both: { state: 'pass' } where baseline-hit was expected.

# M10 (W2-D65 path): a relative path kept as stored.
t2mut M10 'W2-D65 path: the path fields'
# Expected RED (predicted): 1 failed, the path case: src/lib/x.ts where /home/u/tree/src/lib/x.ts was expected.

# M11 (W2-D65 path): the config-dir exclusion dropped.
t2mut M11 'W2-D65 path: the path fields'
# Expected RED (predicted): 1 failed, the path case: the two config-dir paths appear and path-config-dir is 0.

# M12 (W2-D65 error): an Exit code N line read as the error.
t2mut M12 'W2-D65 error'
# Expected RED (predicted): 1 failed, the error case: no error fact, error-length 4.

# M13 (W2-D65): the provenance filter dropped.
t2mut M13 'W2-D65 never mined|never discards the boundary'
# Expected RED (predicted): 7 failed: the five never-mined rows, the synthetic case and the pruned-operator CONTROL.

# M14 (W2-D65): a synthetic assistant row mined.
t2mut M14 'synthetic assistant row'
# Expected RED (predicted): 1 failed: the synthetic row's sha and path appear.

# M15 (W2-D65): a result paired with the last assistant row before it, not the row that wrote its tool_use.
t2mut M15 'gateway tool_use|NULL source_tool_use_id'
# Expected RED (predicted): 2 failed: the gateway result reads anthropic, and the column case's producers move.

# M16 (W2-D65): a paired result's producer not screened.
t2mut M16 'gateway tool_use|NULL source_tool_use_id'
# Expected RED (predicted): 2 failed: { state: 'pass' } where producer-other was expected.

# M17 (W2-D65): pairing read from the entries column.
t2mut M17 'W2-D65 error|gateway tool_use|NULL source_tool_use_id|never reads the source_tool_use_id column'
# Expected RED (predicted): 4 failed: results with a NULL column read unpaired (error, gateway, column cases) and the scan sees the line.

# M18 (W2-D65): the pairing map built over the whole span first, so a tool_use written after its result pairs.
t2mut M18 'is result-unpaired|synthetic assistant row|never discards the boundary'
# Expected RED (predicted): 3 failed: the later-written result pairs, and the extra picks show in picked.

# M19 (W2-D74 via W2-D65): a mined row with no body skipped instead of discarding the boundary.
t2mut M19 'discards the boundary by its own word|is a defect that throws'
# Expected RED (predicted): 5 failed: four rows answer mined, and the unknown state no longer throws.

# M20 (W2-D65): the body picked before the provenance filter.
t2mut M20 'W2-D65 never mined|never discards the boundary'
# Expected RED (predicted): 7 failed: picked is not empty for an unmined row.

# M21 (W2-D65): no deduplication.
t2mut M21 'deduplicated within a family'
# Expected RED (predicted): 1 failed: seven candidates kept, duplicate 0.

# M22 (W2-D65): the family's boundaries taken in arrival order.
t2mut M22 'deduplicated within a family'
# Expected RED (predicted): 1 failed: the kept sha and command are b-late's.

# M23 (W2-D67): no redaction screen.
t2mut M23 'synthetic key-shaped fact|discarded as redact-leaf|W2-D67 order CONTROL'
# Expected RED (predicted): 3 failed: pass (or baseline-hit, in the order CONTROL) where redact-fact or redact-leaf was expected.

# M24 (W2-D67): the leaf half of the screen dropped.
t2mut M24 'discarded as redact-leaf'
# Expected RED (predicted): 1 failed: { state: 'pass' } where redact-leaf was expected.

# M25 (W2-D67 CONTROL): admission run before redaction.
t2mut M25 'W2-D67 order CONTROL'
# Expected RED (predicted): 1 failed: baseline-hit where redact-fact was expected.

# M26 (W2-D67): admission against a redacted B.
t2mut M26 'unredacted F against unredacted B'
# Expected RED (predicted): 1 failed: { state: 'pass' } where baseline-hit was expected.

# M27 (W2-D67): noteDrop counts any word.
t2mut M27 'drop counts carry reason words only'
# Expected RED (predicted): 1 failed: expected [Function] to throw /^noteDrop: /.

# M28 (W2-D61, W2-D67): a local redaction helper beside lib's.
t2mut M28 'declares no copy'
# Expected RED (predicted): 1 failed: expected [ 'const redactLeaf = (t) => t;' ] to deeply equal [].

# M29 (W2-D65): the config dirs neither deduplicated nor sorted.
t2mut M29 'rosterConfigDirs lists'
# Expected RED (predicted): 1 failed: the list comes back in the roster's order, /home/u/.claude, /home/u/.gen-a, /home/u/.gen-o, …

# M30 (W2-D65): an unknown pick state read as a discard word.
t2mut M30 'is a defect that throws'
# Expected RED (predicted): 1 failed: expected [Function] to throw /body pick state/.

# M31 (W2-D67, R10 F6): F not screened, only F_raw (the reading R10 withdraws).
t2mut M31 'whitespace-split bearer token|synthetic key-shaped fact|W2-D67 order CONTROL'
# Expected RED (predicted): 1 failed | 2 passed: the bearer case, expected null to be 'redact-fact' (its leaf holds F_raw
# intact, so the leaf test passes it). The AKIA cases stay green: their F_raw is masked, and the F_raw test fires first.

# M32 (W2-D67): F_raw not screened, only F (W2-D67's first clause deleted).
t2mut M32 'an F_raw the redaction masks under an F it does not|synthetic key-shaped fact|whitespace-split bearer token'
# Expected RED (predicted): 1 failed | 2 passed: the F_raw-only case, expected 'redact-leaf' to be 'redact-fact' (F is not
# masked, and the redacted leaf no longer holds F_raw). The AKIA cases stay green, because their F equals their F_raw and
# the F test fires, and so does the bearer case, which only the F test ever caught.

cmp deploy/history-replay.mjs "$SCRATCH/driver.orig" && echo restored
git diff --stat -- deploy/history-replay.mjs server/test/history-replay.test.ts
```

A mutant whose assertion fails ("AssertionError" from the python) did not apply: its anchor drifted from Step 4's code. Re-anchor it on the code as written, keeping the same mutation, and run it again. Then run Step 5's first two commands once more: green.

- [ ] **Step 7: Run the neighbours that read the driver and the gate.** In the foreground, with a timeout of at least 600000 ms. If a file goes red, re-run it alone before calling it a break (CLAUDE.md's load flakes):

```bash
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history'
cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'W2-3 Task 2'
```

Expected: green.
- **`single-definition`**: O13's switch scan walks `deploy/`, and this section spells no switch name and no recall-off write. O14's `DECL_CORPUS` declaration scan finds no `VOCABS` name here: `MINED_PROVENANCE` is not `PROVENANCE`, and `UUID_RE` is imported, never declared.
- **`measure-history`**: the gate is unchanged and still pure. `FACT_KINDS` keeps its one declaring file, because this task imports nothing named so and declares none (its copy scan builds the planted `FACT_KINDS` declaration from parts at runtime, as `measure-history.test.ts`'s `OWN_WORDS` are, because that file's W2-D12 `declares` pattern is not anchored to a line start and reads every `server/test` file).

- [ ] **Step 8: Commit.**

```bash
git add deploy/history-replay.mjs server/test/history-replay.test.ts
CO_AUTHORED_BY='<the Co-Authored-By line the attribution reminder gives>'
git commit -m "feat(history-replay): mine quiz facts and screen them by redaction, producer and Baseline B (W2-5a Task 2; W2-D61, W2-D65, W2-D67)" -m "$CO_AUTHORED_BY"
```


### Task 3: RP5 boundary admission over the holding copy, with the straddle and two-copy CONTROLs (W2-D66)

The quiz asks only about compactions that an Anthropic model produced on both sides. W2-D66 sets the rule, and spec §10.2's RP5 pins it. A boundary is admitted only when two witnesses both read `'anthropic'`:
- **before**: lib's `producerOf` over the models of the assistant rows before the boundary, nearest first. That is the last real assistant row before it. A `<synthetic>` row or a row with no model is skipped, because lib's `backendOf` reads both as `'unknown'`.
- **after**: lib's `producerOfCopy` from the summary row. That is the first real assistant row after the summary, the same witness `derive.mjs#leafFields` reads for the leaf's producer.

Both witnesses are read in **one copy**, Task 1's `boundaryCopyOf`, the driver's one holding-copy reader (R3): `derive.mjs`'s `holdingCopyOf`, which applies lib's `pickHoldingCopy` over every file of the transcript (a live copy first, then the smallest `file_id`), and the one copy-rows query. This is the copy the leaf is derived from, and the copy the gate's producer stratum reads (D-5771, defined in W2-3's plan). It is never W1's longest copy, which only the window reads (W2-D15). The summary row is Task 1's `summaryIndexOf`: lib's `summaryRowFor` pick, made over the same meta that `derive.mjs`'s `copyPlan` builds.

Nothing here reads an account, a wrapper or a roster. A boundary is judged by its rows' model names alone, so an Anthropic-wrapper session whose last real row before the boundary came from a gateway is not admitted (RP5's "even from an Anthropic-wrapper session").

**The population (W2-D66).** It holds every main-transcript boundary (`agent_id = ''`) that meets all three of these conditions:
- its session uuid has a family under `derive.mjs`'s `epochOfUuid`: a confirmed epoch of an unmerged session, taking the smallest `session_pk`. This is the family the boundary's leaf is derived under, and the card's epoch rule (D-5052);
- its `ts_ms` is not null;
- its holding copy has a summary row.

A dropped boundary is counted under one boundary-discard word and never refused. This task appends its six new words to Task 1's `RECON_DISCARDS` (R5): `no-epoch`, `ts-null`, `before-other`, `before-unknown`, `after-other` and `after-unknown`. A boundary no copy holds is Task 1's own `boundary-uncopied`, and one with no summary row Task 1's `summary-absent`. W2-D71's family eligibility (pilot families and control-held ids excluded) belongs to the sampler, a later task. This task hands the sampler each boundary's family key and verdict.

**RP5, sentence by sentence, and the case that pins each part:**

| RP5 / W2-D66 | Case (describe → it) | CONTROL / mutant |
|---|---|---|
| "a boundary whose last real assistant row before it is non-`claude` → not admitted" | D1 "a gateway row as the last real assistant row before the boundary"; D3 "RP5 in a store" | M2 |
| "even from an Anthropic-wrapper session" | D3 "RP5 in a store: an Anthropic-wrapper session" (family `claude-a-p2`, no roster in the HOME, one parameter) | — |
| "an Anthropic→gateway straddle … → not admitted" | D1 "the straddle"; D3 "two copies, the straddle CONTROL" | M1, M2 red on both |
| "a `<synthetic>` row on either side → skipped, the boundary judged by the real rows" | D1 "a synthetic row before … is skipped", "a synthetic row after … is skipped", "a model-less assistant row is skipped" | M4 |
| spec CONTROL: "a mutant reading only the row before the boundary goes red on the straddle" | D1 and D3 straddle cases | M1 (before side only), M2 (the immediately preceding row only) |
| W2-D66 CONTROLs: "row immediately before only" and "most rows after", each on a two-copy fixture | D3 "two copies, the straddle CONTROL", "two copies, reversed", "a live copy is read before a retired copy" | M2, M3 |
| the population: confirmed epoch, non-null ts, a holding copy, an existing summary row | D3 projection, counts, family | M10, M11, M12, M13, M15 |

**Files:**
- Modify: `deploy/history-replay.mjs`.
  - (a) The `../ccd/history/lib.mjs` import line gains `producerOf` and `producerOfCopy` inside its braces.
  - (b) Task 1's `../ccd/history/derive.mjs` import line gains `epochOfUuid` inside its braces (R3: Task 1 owns the line; this task adds a name).
  - (c) Task 1's `RECON_DISCARDS` gains, in place after the four span words Task 2 appended, this task's six words.
  - (d) One section, inserted directly above the comment block that precedes the entry guard. That block begins `// The entry guard stays the LAST block of this file:`, below Tasks 1 and 2's sections. The guard stays the file's last block.
- Modify: `server/test/history-replay.test.ts`.
  - (a) In Task 1's `EXACT_NAMES`, the derive.mjs entry becomes `'{ blobReadStmts, bodyOf, epochOfUuid, holdingCopyOf }'`, in the same commit as the import.
  - (b) Append, at the end of the file, one block: four aliased imports, the module-level fixtures `W5A3_*` and `w5a3*`, and three `describe`s.
- Not edited: `ccd/**` (`derive.mjs`'s `holdingCopyOf` and `epochOfUuid` are imported, never changed), `deploy/history-gate.mjs`, `shared/**`, the spec, any other test file.

**Interfaces:**
- Consumes (base, `ccd/history/lib.mjs`):
  - `producerOf(models: readonly (string|null)[]): 'anthropic'|'other'|'unknown'`: the first backend that is not `'unknown'`;
  - `producerOfCopy(rows: readonly {type, model}[], summaryIndex: number): Backend`: `producerOf` over the assistant rows after `summaryIndex`;
  - `summaryRowFor({boundaryUuid, anchorUuid, rows: {uuid, isCompactSummary, isEcho}[]}): {uuid: string|null, anchorIsBoundary: boolean}`;
  - `historyPaths(home).dbFile` (test side).
- Consumes (base, `ccd/history/derive.mjs`, exported since W1-B3, read by `card.mjs` on a reader handle): `epochOfUuid(db, ccUuid): {session_pk, seq, ccrc_id} | null`.
- Consumes (base, `ccd/history/store.mjs`, test side only): `createStore(home)`, `openWriter(dbFile)`, `closeWriter(db)` and `openReader(dbFile)`.
- Consumes (Task 1):
  - `openReplayStore(home)` (the test side opens the planted store through it, as a subcommand does);
  - `boundaryCopyOf(rs, boundaryEntryId)`, the one holding-copy reader, over `derive.mjs`'s `holdingCopyOf`; this task's mutants M3 and M13 anchor on its `holdingCopyOf` call;
  - `summaryIndexOf(copyRows, boundaryUuid, anchorUuid)`, the one summary pick, which `boundaryCopyOf` applies; this task's second describe pins it, and mutants M8 and M9 anchor on it;
  - `RECON_DISCARDS`, to which this task appends its words.
- Produces (`deploy/history-replay.mjs`, exported):
  - six words appended to `RECON_DISCARDS`: `'no-epoch'`, `'ts-null'`, `'before-other'`, `'before-unknown'`, `'after-other'` and `'after-unknown'`. None is a `DRIVER_REASONS` word.
  - `admitBoundary(copyRows: {type: string, model: string|null}[], boundaryIndex: number, summaryIndex: number): {admitted: boolean, reason: string|null, before: Backend, after: Backend}`. This is W2-D66's signature. The answer is additive: `reason` is `before-<b>` when `before` is not `'anthropic'`, otherwise `after-<a>` when `after` is not, otherwise `null`. An index outside the copy throws `TypeError`, a defect.
  - `admitStoreBoundaries(rs): {boundaries: AdmissionRow[], counts: Record<'admitted' | RECON_DISCARDS[number], number>}`, where `AdmissionRow = {entry_id, uuid, transcript_pk, ts_ms: number|null, ccrc_id: string|null, generation: string|null, admitted, reason, file_id: number|null, boundary_index: number|null, summary_index: number|null, summary_entry_id: number|null, before: Backend|null, after: Backend|null}`.
    - The rows are in `(transcript_pk, entry_id)` order, one per main-transcript boundary.
    - `counts` carries `admitted` and every `RECON_DISCARDS` word, zeros included.
    - `summary_entry_id` (additive, R3) names the summary row admission judged, so Baseline B checks the copy it reads again is that copy.
    - `rs` is the caller's `ReplayStore` (Task 1's `openReplayStore`); the caller closes it.
  - Module-private: `unjudged(reason)`, `ADMISSION_STMTS`, `admissionStmts(db)`, `admitHeld(rs, b)`.
- Produces (test side, module level, for later W2-5a tasks): `W5A3_CLAUDE`, `W5A3_GATEWAY`, `W5A3_SYNTH`, `type W5a3Row`, `w5a3Uid(seed, n)`, `w5a3Copy(before, after, o?)` and `w5a3PlantStore(sessions, transcripts): {home, dbFile}`.
- Later tasks consume:
  - Task 6's `sourceQuiz` reads `admitStoreBoundaries(rs).boundaries` filtered on `admitted`, keyed by `(store_id, ccrc_id, generation)`;
  - Baseline B (Task 4) reads an admitted row's `file_id`, `boundary_index`, `summary_index` and `summary_entry_id`.

**Decisions:** W2-D66 (the rule, the population and the CONTROLs); W2-D15, C-N and D-5771 (the producer copy is `pickHoldingCopy`'s, the copy derive's producer reads, never the window's); W2-D17 (`<synthetic>` is lib's `isSyntheticModel`, reached through `backendOf`); W2-D51 (store reads through `openReader`'s handle). W2-D62 (fact-admission variants) is **not** applied here. It governs `admitFact` against B and against the question, which a later task calls, and W2-D71's filter order runs this boundary admission first. Spec: §10.2 RP5. No departure: W2-D66 is marked "no" in section 3, and section 6 has no erratum for it.

**Choices this task makes:**
- **The holding copy is `derive.mjs`'s own `holdingCopyOf`, read through Task 1's `boundaryCopyOf`, not a second spelling.** W2-D66 says "the copy that `lib.pickHoldingCopy` chooses". `pickHoldingCopy` answers a `file_id` over `{fileId, live, holds}`, and `derive.mjs` measures `live` and `holds` itself. Calling its export keeps one copy rule for the leaf, the gate's stratum, the payload, admission and B. W2-3's RA-10 parity helper (`measure-history.test.ts`'s `t3DeriveProducer`) composes it the same way.
- **The family is `derive.mjs`'s `epochOfUuid`**, so a boundary's family is the one its leaf is hashed under. W2-D66 says only "confirmed epochs". The unmerged-session and smallest-`session_pk` terms are derive's, and the card's (D-5052). They are pinned through this task's cases (M10).
- **`before` is not bounded by the previous boundary.** W2-D66 reads every assistant row before the boundary, nearest first. The bound matters only when leaf N's span holds no real assistant row. R6 confirms the unbounded reading.
- **The after side starts at the summary row, not at the boundary row** (derive's `leafFields`). Case D1 "is no witness" pins it (M5).
- **`reason` names the before side first.** A boundary that fails on both sides is counted once, as `before-<b>` (M14).
- **One copy-rows query (R3).** Each boundary's copy rows are read through `boundaryCopyOf`, so a transcript with several boundaries reads its copy once per boundary: time at operator pace, never a second spelling of the query.
- **No word in this section is quoted as the SQLite module's specifier.** W2-4's scan (`history-replay W2-4 Task 1: no deploy/history-*.mjs spells a node:sqlite specifier`) reds any quoted specifier, a JSDoc `import(...)` type included, so `db` is typed `{object}`.

**Live safety.** No case spawns a child process. No `claude`, `ccrc` or `gh` binary is reached, and no stub or poisoned `gh` is needed, because nothing runs. The pure cases build copies in memory. The store cases create a store with `store.mjs`'s own `createStore` under a `mkTmp` fixture HOME (removed `afterAll` by `tmpHelpers`), write it through `openWriter`, close it, and hand admission Task 1's `openReplayStore` over that HOME (a read-only `openReader` handle; its pair index reads only the fixture HOME's secret files, which are absent). Nothing reads the session's HOME, `~/.ccrc`, a roster, a limits row or a live store. Fixture names: models `claude-fixture-4` (anthropic), `gpt-fixture-5` (a gateway) and Claude Code's own `<synthetic>`; ids `claude-a-p<k>`; uuids minted from hex seeds.

- [ ] **Step 1: Confirm the base and Tasks 1 and 2's state before using anything.** From the repository root:

```bash
grep -c '^if (process.argv\[1\] && import.meta.url === pathToFileURL(realpathSync(process.argv\[1\])).href) {$' deploy/history-replay.mjs
grep -c '^// The entry guard stays the LAST block of this file:' deploy/history-replay.mjs
grep -nE "^import .* from '\.\./ccd/history/(lib|derive)\.mjs';$" deploy/history-replay.mjs
grep -c "^  'span-unparseable', 'span-tombstone', 'span-over-cap', 'span-undecodable',$" deploy/history-replay.mjs
grep -n "'../ccd/history/derive.mjs': " server/test/history-replay.test.ts
node --no-warnings --input-type=module -e "const d = await import('./deploy/history-replay.mjs'); const v = await import('./ccd/history/derive.mjs'); const l = await import('./ccd/history/lib.mjs'); console.log(typeof d.admitBoundary, typeof d.summaryIndexOf, typeof d.admitStoreBoundaries, typeof d.boundaryCopyOf, typeof v.holdingCopyOf, typeof v.epochOfUuid, typeof l.producerOf, typeof l.producerOfCopy, typeof l.summaryRowFor)"
grep -nE 'admitBoundary|admitStoreBoundaries|ADMISSION_STMTS|admitHeld|unjudged' deploy/history-replay.mjs server/test/history-replay.test.ts
grep -c 'w5a3' server/test/history-replay.test.ts
grep -nE "'(ADMISSION_STMTS)'" server/test/single-definition.test.ts
```

Expected:
- The first two counts are each 1.
- The listing shows exactly one lib.mjs line and Task 1's derive.mjs line, `import { blobReadStmts, bodyOf, holdingCopyOf } from '../ccd/history/derive.mjs';`.
- `1`: Task 2 appended its span words to `RECON_DISCARDS`, the line this task appends after.
- Task 1's `EXACT_NAMES` entry for derive.mjs, `'{ blobReadStmts, bodyOf, holdingCopyOf }'`.
- The `node` line prints `undefined function undefined function function function function function function`: `summaryIndexOf` and `boundaryCopyOf` are Task 1's. With `-e`, `process.argv[1]` is unset, so `main` never runs.
- The last three commands print nothing and `0`.

A missing guard, a missing lib or derive export, a missing Task 1 or Task 2 name, or any of this task's names already defined is a gap to report. Stop; never define these names twice.

- [ ] **Step 2: Write the failing tests.** Append at the end of `server/test/history-replay.test.ts`:

```ts

// ── W2-5a Task 3: boundary admission (W2-D66; spec §10.2 RP5 with the straddle and two-copy CONTROLs; D-5771) ──────
// In-process only: no case spawns a child, so no claude, ccrc or gh is reached, and no account or roster is read. The
// pure cases build copies in memory; the store cases plant a store with store.mjs's own createStore under a mkTmp
// HOME, close the writer, and hand admission a handle from store.mjs's openReader, the route W2-D51 names. Models:
// claude-fixture-4 (anthropic), gpt-fixture-5 (a gateway) and Claude Code's own `<synthetic>`.
// The W5A3_ and w5a3 declarations are MODULE-LEVEL: later W2-5a tasks build their copies and stores with them.
import * as w5a3Drv from '../../deploy/history-replay.mjs';
import * as w5a3Store from '../../ccd/history/store.mjs';
import * as w5a3Lib from '../../ccd/history/lib.mjs';
import { mkTmp as w5a3MkTmp } from './tmpHelpers.js';

const W5A3_CLAUDE = 'claude-fixture-4';
const W5A3_GATEWAY = 'gpt-fixture-5';
const W5A3_SYNTH = '<synthetic>';
/** One copy row with the columns admission reads (entries joined through memberships, in file order). */
type W5a3Row = { uuid: string; type: string; model: string | null; provenance: string; is_compact_summary: number };
/** A uuid in the fixture shape: an 8-hex seed, then a 12-hex counter. */
const w5a3Uid = (seed: number, n: number): string => `${seed.toString(16).padStart(8, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const w5a3Op = (uuid: string): W5a3Row => ({ uuid, type: 'user', model: null, provenance: 'operator', is_compact_summary: 0 });
const w5a3Asst = (uuid: string, model: string | null): W5a3Row => ({ uuid, type: 'assistant', model, provenance: 'model', is_compact_summary: 0 });
interface W5a3Copy { rows: W5a3Row[]; boundary: string; summary: string; bi: number; si: number }
/** One copy in the manual shape, reduced to what admission reads. It holds an operator row before each `before`
 *  model's assistant row, the operator's /compact row, the boundary, its summary (the anchor), then an operator row
 *  before each `after` model's assistant row. The head, up to the summary, is minted from `seed`. The rows after the
 *  summary are minted from `tailSeed`, counted from 0x1001. So two copies of one transcript share their head
 *  (boundary and summary included) and part after the summary. `noSummary` leaves the summary row out: the anchor then
 *  names a uuid the copy does not hold (DM25's shape). */
function w5a3Copy(before: Array<string | null>, after: Array<string | null>,
  o: { seed?: number; tailSeed?: number; noSummary?: boolean } = {}): W5a3Copy {
  const seed = o.seed ?? 0xa3;
  const tailSeed = o.tailSeed ?? seed;
  const rows: W5a3Row[] = [];
  let n = 0;
  let m = 0;
  const head = (): string => { n += 1; return w5a3Uid(seed, n); };
  const tail = (): string => { m += 1; return w5a3Uid(tailSeed, 0x1000 + m); };
  for (const model of before) {
    rows.push(w5a3Op(head()));
    rows.push(w5a3Asst(head(), model));
  }
  rows.push(w5a3Op(head()));
  const boundary = head();
  rows.push({ uuid: boundary, type: 'system', model: null, provenance: 'harness', is_compact_summary: 0 });
  const summary = head();
  if (o.noSummary !== true) rows.push({ uuid: summary, type: 'user', model: null, provenance: 'summary', is_compact_summary: 1 });
  for (const model of after) {
    rows.push(w5a3Op(tail()));
    rows.push(w5a3Asst(tail(), model));
  }
  return { rows, boundary, summary, bi: rows.findIndex((r) => r.uuid === boundary), si: rows.findIndex((r) => r.uuid === summary) };
}

interface W5a3PlantSession { pk: number; ccrcId: string; generation: string; mergedInto?: number; epochs: Array<{ ccUuid: string; confirmed: boolean }> }
interface W5a3PlantTranscript {
  pk: number; ccUuid: string; agentId?: string; files: Array<{ fileId: number; sourceKey?: string; rows: W5a3Row[] }>;
  boundary: string; anchor: string; tsNull?: boolean; unheld?: boolean;
}
/** A store made by store.mjs's createStore under a fresh mkTmp HOME, planted in one transaction, and closed. It
 *  answers the HOME and the db file. Each transcript has one boundary (ord 1). A uuid is one entry per transcript, and every file
 *  that lists it is a membership at its row's line (1-based), so two copies share their head entries. `tsNull` stores
 *  the boundary's ts_ms as NULL. `unheld` leaves the boundary row's membership out of every file, so no copy holds
 *  it. Every other entry is stamped 1 s after the one before. The sessions' epochs take seq 1, 2, … in list order. */
function w5a3PlantStore(sessions: W5a3PlantSession[], transcripts: W5a3PlantTranscript[]): { home: string; dbFile: string } {
  const home = w5a3MkTmp('ccrc-replay-w5a3-');
  w5a3Store.createStore(home);
  const dbFile = w5a3Lib.historyPaths(home).dbFile;
  const db = w5a3Store.openWriter(dbFile);
  try {
    db.exec('BEGIN');
    db.prepare("INSERT INTO blobs (blob_id, sha256, codec, z, raw_len) VALUES (1, ?, 'br5', ?, 1)").run(Buffer.alloc(32, 0xa3), Buffer.from([0]));
    const ses = db.prepare("INSERT INTO sessions (session_pk, ccrc_id, generation, project, first_seen_ms, merged_into) VALUES (?, ?, ?, 'demo', 1, ?)");
    const ep = db.prepare("INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, confirmed_ms) VALUES (?, ?, ?, 'startup', 'hook', ?)");
    for (const s of sessions) ses.run(s.pk, s.ccrcId, s.generation, s.mergedInto ?? null);
    for (const s of sessions) s.epochs.forEach((e, i) => { ep.run(s.pk, i + 1, e.ccUuid, e.confirmed ? 1 : null); });
    const tr = db.prepare('INSERT INTO transcripts (transcript_pk, cc_session_uuid, agent_id) VALUES (?, ?, ?)');
    const file = db.prepare("INSERT INTO ingest_files (file_id, dev, ino, source_key, transcript_pk, status, parser_version) VALUES (?, 1, ?, ?, ?, 'live', 1)");
    const ent = db.prepare('INSERT INTO entries (uuid, transcript_pk, type, model, provenance, prov_version, struct_rank_ns, struct_file_id, blob_id, ts_ms, is_compact_summary) VALUES (?, ?, ?, ?, ?, 1, 0, 0, 1, ?, ?)');
    const mem = db.prepare('INSERT INTO memberships (file_id, entry_id, line) VALUES (?, ?, ?)');
    const bnd = db.prepare('INSERT INTO boundaries (entry_id, transcript_pk, ord, anchor_uuid) VALUES (?, ?, 1, ?)');
    let ts = 1_000;
    for (const t of transcripts) {
      tr.run(t.pk, t.ccUuid, t.agentId ?? '');
      const ids = new Map<string, number>();
      for (const f of t.files) {
        file.run(f.fileId, 9000 + f.fileId, f.sourceKey ?? '', t.pk);
        f.rows.forEach((r, i) => {
          let id = ids.get(r.uuid);
          if (id === undefined) {
            ts += 1000;
            const stamp = t.tsNull === true && r.uuid === t.boundary ? null : ts;
            id = Number(ent.run(r.uuid, t.pk, r.type, r.model, r.provenance, stamp, r.is_compact_summary).lastInsertRowid);
            ids.set(r.uuid, id);
          }
          if (!(t.unheld === true && r.uuid === t.boundary)) mem.run(f.fileId, id, i + 1);
        });
      }
      bnd.run(ids.get(t.boundary)!, t.pk, t.anchor);
    }
    db.exec('COMMIT');
  } finally {
    w5a3Store.closeWriter(db);
  }
  return { home, dbFile };
}

describe('W2-5a Task 3: RP5 over one copy, admitBoundary (W2-D66)', () => {
  const CL = W5A3_CLAUDE;
  const GW = W5A3_GATEWAY;
  const SY = W5A3_SYNTH;
  const verdictOf = (c: W5a3Copy) => w5a3Drv.admitBoundary(c.rows, c.bi, c.si);
  const ADMITTED = { admitted: true, reason: null, before: 'anthropic', after: 'anthropic' };

  it('CONTROL: anthropic rows on both sides are admitted', () => {
    expect(verdictOf(w5a3Copy([CL, CL], [CL]))).toEqual(ADMITTED);
  });

  it('RP5: a gateway row as the last real assistant row before the boundary is not admitted, whatever came before it', () => {
    expect(verdictOf(w5a3Copy([CL, GW], [CL]))).toEqual({ admitted: false, reason: 'before-other', before: 'other', after: 'anthropic' });
  });

  it('RP5: the anthropic-to-gateway straddle, anthropic rows before and a gateway row after the summary, is not admitted', () => {
    expect(verdictOf(w5a3Copy([CL, CL], [GW, CL]))).toEqual({ admitted: false, reason: 'after-other', before: 'anthropic', after: 'other' });
  });

  it('RP5: a synthetic row before the boundary is skipped, and the boundary is judged by the real row before it', () => {
    expect(verdictOf(w5a3Copy([CL, SY], [CL]))).toEqual(ADMITTED);
    expect(verdictOf(w5a3Copy([GW, SY], [CL]))).toEqual({ admitted: false, reason: 'before-other', before: 'other', after: 'anthropic' });
  });

  it('RP5: a synthetic row after the summary is skipped, and the boundary is judged by the real row after it', () => {
    expect(verdictOf(w5a3Copy([CL], [SY, CL]))).toEqual(ADMITTED);
    expect(verdictOf(w5a3Copy([CL], [SY, GW]))).toEqual({ admitted: false, reason: 'after-other', before: 'anthropic', after: 'other' });
  });

  it('a model-less assistant row is skipped on either side, as lib.backendOf reads it unknown', () => {
    expect(verdictOf(w5a3Copy([CL, null], [null, CL]))).toEqual(ADMITTED);
  });

  it('with no real assistant row on a side, that side is unknown and the boundary is not admitted', () => {
    expect(verdictOf(w5a3Copy([], [CL]))).toEqual({ admitted: false, reason: 'before-unknown', before: 'unknown', after: 'anthropic' });
    expect(verdictOf(w5a3Copy([CL], [SY]))).toEqual({ admitted: false, reason: 'after-unknown', before: 'anthropic', after: 'unknown' });
  });

  it('both sides failing: the reason names the before side, tested first', () => {
    expect(verdictOf(w5a3Copy([GW], [GW]))).toEqual({ admitted: false, reason: 'before-other', before: 'other', after: 'other' });
  });

  it('only assistant rows are witnesses before the boundary, as lib.producerOfCopy reads after it', () => {
    const c = w5a3Copy([CL], [CL]);
    const rows = c.rows.map((r, i) => (i === c.bi - 1 ? { ...r, model: GW } : r));
    expect(rows[c.bi - 1]!.type, 'CONTROL: the row carrying a gateway model is the operator\'s /compact row').toBe('user');
    expect(w5a3Drv.admitBoundary(rows, c.bi, c.si)).toEqual(ADMITTED);
  });

  it('the after side starts at the summary row, as derive.mjs leafFields reads the producer: a gateway row between the boundary and its summary is no witness', () => {
    const c = w5a3Copy([CL], [CL]);
    const rows = [...c.rows.slice(0, c.bi + 1), w5a3Asst(w5a3Uid(0xa3, 0x2001), GW), ...c.rows.slice(c.bi + 1)];
    expect(rows[c.si + 1]!.is_compact_summary, 'CONTROL: the summary moved one row down').toBe(1);
    expect(w5a3Drv.admitBoundary(rows, c.bi, c.si + 1)).toEqual(ADMITTED);
  });

  it('an index outside the copy is a defect: TypeError, never a verdict', () => {
    const c = w5a3Copy([CL], [CL]);
    for (const [b, s] of [[-1, c.si], [c.bi, c.rows.length], [1.5, c.si], [c.bi, Number.NaN]] as Array<[number, number]>) {
      expect(() => w5a3Drv.admitBoundary(c.rows, b, s), `${b}, ${s}`).toThrow(/is not a row of the copy/);
    }
  });

  it('R6: the before witness is not bounded by the previous boundary: with no assistant row between two boundaries, the second is judged by the real row before the first', () => {
    const c = w5a3Copy([CL], []);
    const boundary2 = w5a3Uid(0xa3, 0x4001);
    const summary2 = w5a3Uid(0xa3, 0x4002);
    const rows: W5a3Row[] = [
      ...c.rows,
      w5a3Op(w5a3Uid(0xa3, 0x4000)),
      { uuid: boundary2, type: 'system', model: null, provenance: 'harness', is_compact_summary: 0 },
      { uuid: summary2, type: 'user', model: null, provenance: 'summary', is_compact_summary: 1 },
      w5a3Op(w5a3Uid(0xa3, 0x4003)),
      w5a3Asst(w5a3Uid(0xa3, 0x4004), CL),
    ];
    const bi2 = rows.findIndex((r) => r.uuid === boundary2);
    const si2 = rows.findIndex((r) => r.uuid === summary2);
    expect(rows.slice(c.si + 1, bi2).some((r) => r.type === 'assistant'), 'CONTROL: no assistant row between the two boundaries').toBe(false);
    expect(w5a3Drv.admitBoundary(rows, bi2, si2)).toEqual(ADMITTED);
  });
});

describe('W2-5a Task 3: the summary row is lib.summaryRowFor\'s pick, summaryIndexOf (W2-D66)', () => {
  const CL = W5A3_CLAUDE;
  const summaryLike = (uuid: string, provenance: string): W5a3Row => ({ uuid, type: 'user', model: null, provenance, is_compact_summary: 1 });

  it('the anchored summary row: its index in the copy', () => {
    const c = w5a3Copy([CL], [CL]);
    expect(w5a3Drv.summaryIndexOf(c.rows, c.boundary, c.summary)).toBe(c.si);
  });

  it('an anchor the copy does not hold is -1, though a compact summary row follows the boundary', () => {
    const c = w5a3Copy([CL], [CL]);
    const rows = c.rows.map((r) => (r.uuid === c.summary ? summaryLike(w5a3Uid(0xa3, 0x3001), 'summary') : r));
    expect(rows.some((r, i) => i > c.bi && r.is_compact_summary === 1), 'CONTROL: a compact summary row follows the boundary').toBe(true);
    expect(w5a3Drv.summaryIndexOf(rows, c.boundary, c.summary)).toBe(-1);
  });

  it('an anchor that names a harness echo row is -1, as derive.mjs copyPlan marks an echo', () => {
    const c = w5a3Copy([CL], [CL]);
    const rows = c.rows.map((r) => (r.uuid === c.summary ? { ...r, provenance: 'harness' } : r));
    expect(w5a3Drv.summaryIndexOf(rows, c.boundary, c.summary)).toBe(-1);
  });

  it('an anchor naming the boundary itself takes the first compact summary row after it that is no echo', () => {
    const c = w5a3Copy([CL], [CL]);
    const rows = [...c.rows.slice(0, c.bi + 1), summaryLike(w5a3Uid(0xa3, 0x3002), 'harness'), ...c.rows.slice(c.bi + 1)];
    expect(w5a3Drv.summaryIndexOf(rows, c.boundary, c.boundary)).toBe(c.si + 1);
  });
});

describe('W2-5a Task 3: the population over a planted store, admitStoreBoundaries (W2-D66)', () => {
  const CL = W5A3_CLAUDE;
  const GW = W5A3_GATEWAY;
  const cc = (k: number): string => w5a3Uid(0xcc, k);
  const gen = (k: number): string => w5a3Uid(0x5e5, k);
  const T3_HELD = w5a3Copy([CL, CL], [GW], { seed: 3, tailSeed: 0x31 });
  const T3_LONG = w5a3Copy([CL, CL], [CL, CL, CL], { seed: 3, tailSeed: 0x32 });
  const T4_HELD = w5a3Copy([CL], [CL], { seed: 4, tailSeed: 0x41 });
  const T4_LONG = w5a3Copy([CL], [GW, GW, GW], { seed: 4, tailSeed: 0x42 });
  const T10_RETIRED = w5a3Copy([CL], [CL], { seed: 0xa, tailSeed: 0xa1 });
  const T10_LIVE = w5a3Copy([CL], [GW], { seed: 0xa, tailSeed: 0xa2 });
  const one = (pk: number, c: W5a3Copy, fileId: number, extra: Partial<W5a3PlantTranscript> = {}): W5a3PlantTranscript =>
    ({ pk, ccUuid: cc(pk), files: [{ fileId, rows: c.rows }], boundary: c.boundary, anchor: c.summary, ...extra });
  const SESSIONS: W5a3PlantSession[] = [
    ...[1, 2, 3, 4, 5, 8, 10, 11].map((k) => ({ pk: k, ccrcId: `claude-a-p${k}`, generation: gen(k), epochs: [{ ccUuid: cc(k), confirmed: true }] })),
    { pk: 6, ccrcId: 'claude-a-p6', generation: gen(6), epochs: [{ ccUuid: cc(6), confirmed: false }] },
    { pk: 9, ccrcId: 'claude-a-p9', generation: gen(9), mergedInto: 1, epochs: [{ ccUuid: cc(9), confirmed: true }] },
    { pk: 12, ccrcId: 'claude-a-other', generation: gen(12), epochs: [{ ccUuid: cc(1), confirmed: true }] },
  ];
  const TRANSCRIPTS: W5a3PlantTranscript[] = [
    one(1, w5a3Copy([CL, CL], [CL], { seed: 1 }), 1),
    one(2, w5a3Copy([CL, GW], [CL], { seed: 2 }), 2),
    { pk: 3, ccUuid: cc(3), files: [{ fileId: 3, rows: T3_HELD.rows }, { fileId: 4, rows: T3_LONG.rows }], boundary: T3_HELD.boundary, anchor: T3_HELD.summary },
    { pk: 4, ccUuid: cc(4), files: [{ fileId: 5, rows: T4_HELD.rows }, { fileId: 6, rows: T4_LONG.rows }], boundary: T4_HELD.boundary, anchor: T4_HELD.summary },
    one(5, w5a3Copy([CL], [CL], { seed: 5 }), 7, { tsNull: true }),
    one(6, w5a3Copy([CL], [CL], { seed: 6 }), 8),
    one(7, w5a3Copy([CL], [CL], { seed: 7 }), 9, { ccUuid: cc(1), agentId: 'a3sub' }),
    one(8, w5a3Copy([CL], [CL], { seed: 8, noSummary: true }), 10),
    one(9, w5a3Copy([CL], [CL], { seed: 9 }), 11),
    { pk: 10, ccUuid: cc(10), files: [{ fileId: 12, sourceKey: 'retired-fixture', rows: T10_RETIRED.rows }, { fileId: 13, rows: T10_LIVE.rows }], boundary: T10_LIVE.boundary, anchor: T10_LIVE.summary },
    one(11, w5a3Copy([CL], [CL], { seed: 0xb }), 14, { unheld: true }),
  ];
  type Result = ReturnType<typeof w5a3Drv.admitStoreBoundaries>;
  let memo: { dbFile: string; res: Result } | null = null;
  /** The planted store and admission's answer over it, through Task 1's store opener as a subcommand opens it, made once;
   *  a throw leaves it unmade, so every case reds. */
  function planted(): { dbFile: string; res: Result } {
    if (memo === null) {
      const { home, dbFile } = w5a3PlantStore(SESSIONS, TRANSCRIPTS);
      const rs = w5a3Drv.openReplayStore(home);
      try {
        memo = { dbFile, res: w5a3Drv.admitStoreBoundaries(rs) };
      } finally {
        rs.close();
      }
    }
    return memo;
  }
  const rowOf = (pk: number) => planted().res.boundaries.find((b) => b.transcript_pk === pk)!;
  /** W1's measure: a copy's membership rows after the boundary row (the window's longest-copy rule, W2-D15). */
  function afterCount(fileId: number, uuid: string): number {
    const db = w5a3Store.openReader(planted().dbFile);
    try {
      return Number((db.prepare(`SELECT count(*) AS n FROM memberships m JOIN memberships mb ON mb.file_id = m.file_id
        JOIN entries e ON e.entry_id = mb.entry_id WHERE m.file_id = ? AND e.uuid = ? AND m.line > mb.line`).get(fileId, uuid) as { n: number }).n);
    } finally {
      db.close();
    }
  }

  it('every main boundary once, in transcript order, with its family and verdict; a subagent transcript\'s boundary is outside the population', () => {
    expect(planted().res.boundaries.map((b) => [b.transcript_pk, b.ccrc_id, b.reason, b.admitted, b.file_id])).toEqual([
      [1, 'claude-a-p1', null, true, 1],
      [2, 'claude-a-p2', 'before-other', false, 2],
      [3, 'claude-a-p3', 'after-other', false, 3],
      [4, 'claude-a-p4', null, true, 5],
      [5, 'claude-a-p5', 'ts-null', false, null],
      [6, null, 'no-epoch', false, null],
      [8, 'claude-a-p8', 'summary-absent', false, 10],
      [9, null, 'no-epoch', false, null],
      [10, 'claude-a-p10', 'after-other', false, 13],
      [11, 'claude-a-p11', 'boundary-uncopied', false, null],
    ]);
    expect(typeof rowOf(1).summary_entry_id, 'R3: the admitted row names the summary row it judged').toBe('number');
    expect(rowOf(5).summary_entry_id, 'a boundary judged before its copy names none').toBeNull();
  });

  it('the counts: admitted and every RECON_DISCARDS word, zeros included', () => {
    const zero = Object.fromEntries(['admitted', ...w5a3Drv.RECON_DISCARDS].map((w) => [w, 0]));
    expect(planted().res.counts).toEqual({
      ...zero, admitted: 2, 'no-epoch': 2, 'ts-null': 1, 'boundary-uncopied': 1, 'summary-absent': 1, 'before-other': 1, 'after-other': 2,
    });
  });

  it('two copies, the straddle CONTROL: the holding copy (live, smaller file_id) straddles and is not admitted, though the copy with the most rows after the boundary is anthropic throughout', () => {
    const t3 = rowOf(3);
    expect(t3).toMatchObject({
      uuid: T3_HELD.boundary, ccrc_id: 'claude-a-p3', generation: gen(3), admitted: false, reason: 'after-other',
      file_id: 3, boundary_index: T3_HELD.bi, summary_index: T3_HELD.si, before: 'anthropic', after: 'other',
    });
    expect(typeof t3.ts_ms).toBe('number');
    expect(afterCount(4, T3_HELD.boundary), 'CONTROL: W1\'s longest-copy rule would read file 4').toBeGreaterThan(afterCount(3, T3_HELD.boundary));
    expect(w5a3Drv.admitBoundary(T3_LONG.rows, T3_LONG.bi, T3_LONG.si).admitted, 'CONTROL: file 4 alone would be admitted').toBe(true);
  });

  it('two copies, reversed: the holding copy is anthropic on both sides and admitted, though the copy with the most rows after the boundary reaches a gateway', () => {
    expect(rowOf(4)).toMatchObject({
      admitted: true, reason: null, file_id: 5, boundary_index: T4_HELD.bi, summary_index: T4_HELD.si, before: 'anthropic', after: 'anthropic',
    });
    expect(afterCount(6, T4_HELD.boundary), 'CONTROL: W1\'s longest-copy rule would read file 6').toBeGreaterThan(afterCount(5, T4_HELD.boundary));
    expect(w5a3Drv.admitBoundary(T4_LONG.rows, T4_LONG.bi, T4_LONG.si).admitted, 'CONTROL: file 6 alone would not be admitted').toBe(false);
  });

  it('two copies, a live copy is read before a retired copy with a smaller file_id (lib.pickHoldingCopy: live first)', () => {
    expect(rowOf(10)).toMatchObject({ admitted: false, reason: 'after-other', file_id: 13, before: 'anthropic', after: 'other' });
    expect(afterCount(12, T10_LIVE.boundary), 'CONTROL: neither length nor file order picks file 13').toBe(afterCount(13, T10_LIVE.boundary));
    expect(w5a3Drv.admitBoundary(T10_RETIRED.rows, T10_RETIRED.bi, T10_RETIRED.si).admitted, 'CONTROL: the retired copy alone would be admitted').toBe(true);
  });

  it('RP5 in a store: an Anthropic-wrapper session (claude-a-p2) whose last real assistant row before the boundary is a gateway row is not admitted, and no roster is read', () => {
    expect(rowOf(2)).toMatchObject({ ccrc_id: 'claude-a-p2', admitted: false, reason: 'before-other', before: 'other', after: 'anthropic', file_id: 2 });
    expect(w5a3Drv.admitStoreBoundaries.length, 'one parameter, the store handle: no HOME, so no roster').toBe(1);
  });

  it('the family is derive.mjs epochOfUuid\'s: a confirmed epoch of an unmerged session, the smallest session_pk', () => {
    expect([rowOf(1).ccrc_id, rowOf(1).generation], 'session 1, not session 12, which holds a later epoch of the same uuid').toEqual(['claude-a-p1', gen(1)]);
    expect([rowOf(6).ccrc_id, rowOf(6).reason], 'an unconfirmed epoch').toEqual([null, 'no-epoch']);
    expect([rowOf(9).ccrc_id, rowOf(9).reason], 'a confirmed epoch of a merged session').toEqual([null, 'no-epoch']);
  });

  it('CONTROL (R5): this task\'s six words are appended to RECON_DISCARDS after Task 2\'s, none is a DRIVER_REASONS word, and every reason a verdict carries is a RECON_DISCARDS word', () => {
    expect(w5a3Drv.RECON_DISCARDS.slice(18, 24)).toEqual(['no-epoch', 'ts-null', 'before-other', 'before-unknown', 'after-other', 'after-unknown']);
    expect(w5a3Drv.RECON_DISCARDS.filter((w) => (w5a3Drv.DRIVER_REASONS as readonly string[]).includes(w))).toEqual([]);
    const reasons = new Set(planted().res.boundaries.map((b) => b.reason).filter((r) => r !== null));
    for (const r of reasons) expect(w5a3Drv.RECON_DISCARDS).toContain(r);
    expect(reasons.size, 'CONTROL: the planted store reaches six reasons').toBe(6);
  });
});
```

- [ ] **Step 3: Run them and see them fail.** In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-5a Task 3')
```

Expected: `18 failed | 5 passed` (measured; predicted `19 failed | 4 passed`). The first describe fails on `TypeError: w5a3Drv.admitBoundary is not a function`, and the third on `w5a3Drv.admitStoreBoundaries is not a function` from `planted()`. The one exception is the first describe's "an index outside the copy is a defect" case: it passes while `admitBoundary` is undefined, because calling `undefined` throws a `TypeError` too, and M7 is what measures its real red. The second describe's four cases pass: `summaryIndexOf` is Task 1's, and they pin it here, where admission reads it; mutants M8 and M9 measure their red. The store is planted, and opened through `openReplayStore`, before that throw, so the planter itself runs and must not fail. A failure inside `w5a3PlantStore` (a constraint, a missing column) is a fixture defect: fix it before Step 4.

- [ ] **Step 4: Implement.**

(a) The lib.mjs import line of `deploy/history-replay.mjs` gains `producerOf` and `producerOfCopy` inside its braces, in code-unit order. No second import line from that specifier.

(b) Task 1's derive.mjs line becomes `import { blobReadStmts, bodyOf, epochOfUuid, holdingCopyOf } from '../ccd/history/derive.mjs';`, and in `server/test/history-replay.test.ts` Task 1's `EXACT_NAMES` entry `'../ccd/history/derive.mjs': '{ blobReadStmts, bodyOf, holdingCopyOf }',` becomes `'../ccd/history/derive.mjs': '{ blobReadStmts, bodyOf, epochOfUuid, holdingCopyOf }',`.

(c) In `RECON_DISCARDS`, replace `  'span-unparseable', 'span-tombstone', 'span-over-cap', 'span-undecodable',` with the two lines below. The list's next line, `'body-unrenderable'` (D-6302), stays after them as its last word, so the new words are `RECON_DISCARDS.slice(18, 24)` and the list does not end with them:

```js
  'span-unparseable', 'span-tombstone', 'span-over-cap', 'span-undecodable',
  'no-epoch', 'ts-null', 'before-other', 'before-unknown', 'after-other', 'after-unknown',
```

(d) Insert, directly above the line `// The entry guard stays the LAST block of this file: a module-level declaration below it would still be uninitialised`:

```js
// ── W2-5a Task 3: boundary admission (W2-D66; spec §10.2 RP5; the producer's copy rule, D-5771) ─────────────────
// A boundary enters the quiz's population only when the backend on BOTH sides of it is anthropic (RP5):
//   before  lib.producerOf over the models of the assistant rows before the boundary, nearest first: the last real
//           assistant row before it, a `<synthetic>` or model-less row skipped (lib.backendOf reads both 'unknown');
//   after   lib.producerOfCopy from the summary row: the first real assistant row after it, the witness
//           derive.mjs#leafFields reads for the leaf's producer.
// Both sides read ONE copy, Task 1's boundaryCopyOf over derive.mjs's holdingCopyOf: lib.pickHoldingCopy over every
// file of the transcript (live first, then the smallest file_id), the copy the leaf is derived from and the gate's
// producer stratum reads (D-5771), never W1's longest copy, which only the window reads (W2-D15). The summary row is
// Task 1's summaryIndexOf: lib.summaryRowFor's pick over the meta derive.mjs's copyPlan builds. Nothing here reads an
// account, a wrapper or a roster: a boundary is judged by its rows' model names alone, so an Anthropic-wrapper session
// whose last real row before the boundary came from a gateway is not admitted.
// The population: every main-transcript boundary (agent_id '') whose session uuid has a family under derive.mjs's
// epochOfUuid (a confirmed epoch of an unmerged session, the smallest session_pk: the family its leaf is derived
// under), with a non-null ts_ms and a summary row in its holding copy. W2-D71's family eligibility (pilot and control
// exclusions) is the sampler's. A drop is counted by its RECON_DISCARDS word (R5), never refused.
// The store is the caller's ReplayStore (Task 1's openReplayStore: a read-only openReader handle, W2-D51): this section
// opens nothing, writes nothing and spawns nothing.

/** A drop decided before both sides were read: no side measured. */
const unjudged = (reason) => ({ admitted: false, reason, file_id: null, boundary_index: null, summary_index: null, summary_entry_id: null, before: null, after: null });

/** RP5 over one copy's rows in file order (W2-D66). `before` folds the assistant rows before the boundary, nearest
 *  first, through lib.producerOf; `after` is lib.producerOfCopy from the summary row. Admitted iff both are
 *  'anthropic'. `reason` names the failing side, the before side first, as `before-<backend>` or `after-<backend>`;
 *  null when admitted. An index outside the copy is the caller's defect: TypeError, never a verdict.
 *  @param {Array<{type: string, model: string|null}>} copyRows
 *  @param {number} boundaryIndex
 *  @param {number} summaryIndex
 *  @returns {{admitted: boolean, reason: string|null, before: 'anthropic'|'other'|'unknown', after: 'anthropic'|'other'|'unknown'}} */
export function admitBoundary(copyRows, boundaryIndex, summaryIndex) {
  if (!Array.isArray(copyRows)) throw new TypeError('admitBoundary: copyRows must be an array');
  for (const [name, i] of [['boundaryIndex', boundaryIndex], ['summaryIndex', summaryIndex]]) {
    if (!Number.isInteger(i) || i < 0 || i >= copyRows.length) throw new TypeError(`admitBoundary: ${name} ${String(i)} is not a row of the copy`);
  }
  const nearestFirst = [];
  for (let i = boundaryIndex - 1; i >= 0; i -= 1) if (copyRows[i].type === 'assistant') nearestFirst.push(copyRows[i].model);
  const before = producerOf(nearestFirst);
  const after = producerOfCopy(copyRows, summaryIndex);
  const reason = before !== 'anthropic' ? `before-${before}` : after !== 'anthropic' ? `after-${after}` : null;
  return { admitted: before === 'anthropic' && after === 'anthropic', reason, before, after };
}

const ADMISSION_STMTS = new WeakMap();

/** The reads admission adds to Task 1's, prepared once per handle: every main-transcript boundary, in (transcript_pk,
 *  entry_id) order (agent_id '', as derive.mjs's todo reads them), and a family's generation. A boundary's copy and
 *  its rows are Task 1's boundaryCopyOf, the one holding-copy reader. */
function admissionStmts(db) {
  let s = ADMISSION_STMTS.get(db);
  if (s !== undefined) return s;
  s = {
    boundaries: db.prepare(`SELECT b.entry_id AS entry_id, e.uuid AS uuid, e.ts_ms AS ts_ms, b.transcript_pk AS transcript_pk,
        t.cc_session_uuid AS cc_uuid
      FROM boundaries b JOIN entries e ON e.entry_id = b.entry_id JOIN transcripts t ON t.transcript_pk = b.transcript_pk
      WHERE t.agent_id = '' ORDER BY b.transcript_pk, b.entry_id`),
    generation: db.prepare('SELECT generation FROM sessions WHERE session_pk = ?'),
  };
  ADMISSION_STMTS.set(db, s);
  return s;
}

/** One boundary that has a family and a time, judged in Task 1's holding copy. A `boundary-absent` answer from
 *  boundaryCopyOf throws rather than being counted: the boundary row was read from this same handle a moment earlier,
 *  and no ccd/history writer deletes boundaries. A boundary no copy holds is
 *  boundary-uncopied, one whose copy has no summary row summary-absent; an admitted row names its summary row
 *  (summary_entry_id), so Baseline B can check the copy it reads again is this one. */
function admitHeld(rs, b) {
  const copy = boundaryCopyOf(rs, Number(b.entry_id));
  if (copy.state !== 'copy') {
    if (copy.why === 'boundary-uncopied') return unjudged('boundary-uncopied');
    throw new TypeError(`admitStoreBoundaries: boundary ${String(b.entry_id)} answered ${copy.why}`);
  }
  if (copy.summaryIndex === null) return { ...unjudged('summary-absent'), file_id: copy.fileId, boundary_index: copy.boundaryIndex };
  return { ...admitBoundary(copy.rows, copy.boundaryIndex, copy.summaryIndex), file_id: copy.fileId, boundary_index: copy.boundaryIndex,
    summary_index: copy.summaryIndex, summary_entry_id: Number(copy.rows[copy.summaryIndex].entry_id) };
}

/** Every main-transcript boundary in the store behind `rs`, each with its family and its W2-D66 verdict, and the count
 *  of each outcome: 'admitted' and every RECON_DISCARDS word, zeros included. In order: no family under derive.mjs's
 *  epochOfUuid is no-epoch, a NULL boundary ts_ms is ts-null, then the holding copy (boundary-uncopied, summary-absent)
 *  and RP5. `rs` is the caller's ReplayStore (Task 1), which the caller closes.
 *  @param {ReplayStore} rs
 *  @returns {{boundaries: Array<{entry_id: number, uuid: string, transcript_pk: number, ts_ms: number|null,
 *    ccrc_id: string|null, generation: string|null, admitted: boolean, reason: string|null, file_id: number|null,
 *    boundary_index: number|null, summary_index: number|null, summary_entry_id: number|null, before: string|null,
 *    after: string|null}>, counts: Record<string, number>}} */
export function admitStoreBoundaries(rs) {
  const s = admissionStmts(rs.db);
  const counts = Object.fromEntries(['admitted', ...RECON_DISCARDS].map((w) => [w, 0]));
  const boundaries = [];
  for (const b of s.boundaries.all()) {
    const ep = epochOfUuid(rs.db, b.cc_uuid);
    const v = ep === null ? unjudged('no-epoch') : b.ts_ms === null ? unjudged('ts-null') : admitHeld(rs, b);
    const key = v.reason ?? 'admitted';
    if (!Object.hasOwn(counts, key)) throw new TypeError(`admitStoreBoundaries: ${key} is not a RECON_DISCARDS word`);
    counts[key] += 1;
    boundaries.push({
      entry_id: Number(b.entry_id), uuid: b.uuid, transcript_pk: Number(b.transcript_pk), ts_ms: b.ts_ms === null ? null : Number(b.ts_ms),
      ccrc_id: ep === null ? null : ep.ccrc_id, generation: ep === null ? null : s.generation.get(ep.session_pk).generation,
      ...v,
    });
  }
  return { boundaries, counts };
}

```

Checks:
- `node --check deploy/history-replay.mjs` prints nothing.
- `grep -cE "(['\"\`])node:sqlite\1" deploy/history-replay.mjs` prints 0.
- `grep -nE '\.mjs:[0-9]' deploy/history-replay.mjs` shows no line this task added.

- [ ] **Step 5: Run them and see them pass, then the whole file and the typecheck.** In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-5a Task 3')
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts)
(cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit)
```

Expected:
- The filtered run: `23 passed (23)` (predicted).
- The whole file is green: W2-4's cases (`EXPECTED_IMPORTS`' pin included, with derive.mjs's names as Step 4(b) left them), Tasks 1 and 2's cases, and these 23.
- tsc prints no line that names `server/test/history-replay.test.ts` or `deploy/history-replay.mjs`. A line that names only `agent/src/` or a module that is not installed comes from the worktree's install, not from this task.

- [ ] **Step 6: Measure every new guard red, then green.** From the repository root. Each block makes one exact replacement and asserts that it matched once. Then it runs one filter, shows the red, and restores the file with `cp`. The python body is a quoted heredoc. M3, M8, M9 and M13 mutate Task 1's one holding-copy reader and summary pick (R3), which admission reads; every other mutant is in this task's section.

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w2-5a/scratch"; mkdir -p "$SCRATCH"
mut() {   # mut <file> <old> <new>: one exact replacement, asserted to match once
  python3 - "$1" "$2" "$3" <<'EOF'
import sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
assert s.count(old) == 1, (p, old, s.count(old))
open(p, 'w').write(s.replace(old, new))
EOF
}
cp deploy/history-replay.mjs "$SCRATCH/replay.orig"

# M1 (spec RP5's CONTROL): admission reads the before side only, the old "last row before the boundary" rule.
mut deploy/history-replay.mjs "  return { admitted: before === 'anthropic' && after === 'anthropic', reason, before, after };" "  return { admitted: before === 'anthropic', reason, before, after };"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'straddle')
cp "$SCRATCH/replay.orig" deploy/history-replay.mjs
# Expected RED (predicted): 2 failed. The one-copy straddle (admitted true against false) and the two-copy store
# straddle (file 3's verdict admitted).

# M2 (W2-D66's CONTROL "row immediately before only"): before reads the row just before the boundary, whatever it is.
mut deploy/history-replay.mjs "  for (let i = boundaryIndex - 1; i >= 0; i -= 1) if (copyRows[i].type === 'assistant') nearestFirst.push(copyRows[i].model);" "  if (boundaryIndex > 0) nearestFirst.push(copyRows[boundaryIndex - 1].model);"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'straddle')
cp "$SCRATCH/replay.orig" deploy/history-replay.mjs
# Expected RED (predicted): 2 failed, both with reason 'before-unknown' in place of 'after-other': the row before
# every fixture boundary is the operator's /compact row, whose model is null.
# M2 reds on every fixture because the row just before each boundary is the operator's /compact row with a null model, so M2
# proves the assistant-type filter. M1 is what covers RP5's "only the row before" CONTROL.

# M3 (W2-D66's CONTROL "most rows after", on the two-copy fixtures): the copy with the most rows after the boundary,
# W1's window rule, ties to the smaller file_id, in place of derive.mjs's holding copy.
mut deploy/history-replay.mjs "  const holding = holdingCopyOf(rs.db, { entry_id: boundary.entry_id, transcript_pk: boundary.transcript_pk });" "  const holding = rs.db.prepare('SELECT m.file_id AS file_id FROM memberships m JOIN memberships mb ON mb.file_id = m.file_id AND mb.entry_id = ? WHERE m.line > mb.line GROUP BY m.file_id ORDER BY count(*) DESC, m.file_id LIMIT 1').get(boundary.entry_id) ?? null;"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-5a Task 3: the population')
cp "$SCRATCH/replay.orig" deploy/history-replay.mjs
# Expected RED (predicted): 5 failed | 3 passed. The projection and the counts fail: T3 is admitted from file 4, T4
# becomes after-other from file 6, and T10 is admitted from retired file 12 on the tie. So do the straddle, the
# reversed and the live-before-retired cases.

# M4: the before side reads only the nearest assistant row, so a synthetic or model-less row is not skipped.
mut deploy/history-replay.mjs "  const before = producerOf(nearestFirst);" "  const before = producerOf(nearestFirst.slice(0, 1));"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'is skipped')
cp "$SCRATCH/replay.orig" deploy/history-replay.mjs
# Expected RED (predicted): 2 failed | 1 passed. "a synthetic row before" and "a model-less assistant row" fail;
# "a synthetic row after" passes (its before side holds one real row).

# M5: the after side read from the boundary row, not the summary (derive.mjs leafFields reads from the summary).
mut deploy/history-replay.mjs "  const after = producerOfCopy(copyRows, summaryIndex);" "  const after = producerOfCopy(copyRows, boundaryIndex);"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'is no witness')
cp "$SCRATCH/replay.orig" deploy/history-replay.mjs
# Expected RED (predicted): 1 failed, after 'other' against 'anthropic'.

# M6: every row before the boundary is a witness, not only assistant rows (producerOfCopy's filter on the after side).
mut deploy/history-replay.mjs "if (copyRows[i].type === 'assistant') nearestFirst.push(copyRows[i].model);" "nearestFirst.push(copyRows[i].model);"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'only assistant rows are witnesses')
cp "$SCRATCH/replay.orig" deploy/history-replay.mjs
# Expected RED (predicted): 1 failed, before 'other' (the /compact row's planted gateway model).

# M7: the index guard dropped.
mut deploy/history-replay.mjs "    if (!Number.isInteger(i) || i < 0 || i >= copyRows.length) throw" "    if (false) throw"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'is a defect')
cp "$SCRATCH/replay.orig" deploy/history-replay.mjs
# Expected RED (predicted): 1 failed, expected [Function] to throw an error (the -1 pair returns a verdict).

# M8: W1's summary rule (the first compact summary row after the boundary) in place of lib.summaryRowFor's pick.
mut deploy/history-replay.mjs "  return pick.uuid === null ? -1 : copyRows.findIndex((r) => r.uuid === pick.uuid);" "  return copyRows.findIndex((r, i) => i > copyRows.findIndex((x) => x.uuid === boundaryUuid) && r.is_compact_summary === 1);"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-5a Task 3: the summary row')
cp "$SCRATCH/replay.orig" deploy/history-replay.mjs
# Expected RED (predicted): 3 failed | 1 passed. The stray, echo and anchor-is-boundary cases fail; the anchored case passes.

# M9: no row is an echo (copyPlan's isEcho dropped).
mut deploy/history-replay.mjs "isEcho: r.type === 'user' && r.provenance === 'harness' }));" "isEcho: false }));"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-5a Task 3: the summary row')
cp "$SCRATCH/replay.orig" deploy/history-replay.mjs
# Expected RED (predicted): 2 failed | 2 passed. The echo-anchor case and the anchor-is-boundary case fail (the echo
# row is taken).

# M10: a naive epoch read in place of derive.mjs's epochOfUuid: any epoch, any session, the largest session_pk.
mut deploy/history-replay.mjs "    const ep = epochOfUuid(rs.db, b.cc_uuid);" "    const ep = rs.db.prepare('SELECT e.session_pk AS session_pk, s.ccrc_id AS ccrc_id FROM epochs e JOIN sessions s ON s.session_pk = e.session_pk WHERE e.cc_session_uuid = ? ORDER BY e.session_pk DESC LIMIT 1').get(b.cc_uuid) ?? null;"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-5a Task 3: the population')
cp "$SCRATCH/replay.orig" deploy/history-replay.mjs
# Expected RED (predicted): 4 failed | 4 passed. The projection, the counts and the family case fail (T1 under
# claude-a-other; T6 and T9 admitted), and so does the RECON_DISCARDS CONTROL (five reasons reached, not six).

# M11: the NULL-ts test dropped (W2-D66's population needs a non-null ts).
mut deploy/history-replay.mjs "    const v = ep === null ? unjudged('no-epoch') : b.ts_ms === null ? unjudged('ts-null') : admitHeld(rs, b);" "    const v = ep === null ? unjudged('no-epoch') : admitHeld(rs, b);"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-5a Task 3: the population')
cp "$SCRATCH/replay.orig" deploy/history-replay.mjs
# Expected RED (predicted): 3 failed | 5 passed. The projection, the counts (T5 admitted) and the RECON_DISCARDS
# CONTROL fail.

# M12: subagent transcripts in the population (main boundaries only, as derive.mjs's todo).
mut deploy/history-replay.mjs "      WHERE t.agent_id = '' ORDER BY b.transcript_pk, b.entry_id\`)," "      ORDER BY b.transcript_pk, b.entry_id\`),"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-5a Task 3: the population')
cp "$SCRATCH/replay.orig" deploy/history-replay.mjs
# Expected RED (predicted): 2 failed | 6 passed. The projection (a row for transcript 7) and the counts (admitted 3) fail.

# M13: the boundary-uncopied test dropped (Task 1's boundaryCopyOf, which admission reads).
mut deploy/history-replay.mjs "  if (holding === null) return reconDiscard('boundary-uncopied');
" ""
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-5a Task 3: the population')
cp "$SCRATCH/replay.orig" deploy/history-replay.mjs
# Expected RED (predicted): 8 failed. On T11, TypeError: Cannot read properties of null (reading 'file_id'), thrown
# from planted() in every case.

# M14: the reason names the after side first.
mut deploy/history-replay.mjs "  const reason = before !== 'anthropic' ? \`before-\${before}\` : after !== 'anthropic' ? \`after-\${after}\` : null;" "  const reason = after !== 'anthropic' ? \`after-\${after}\` : before !== 'anthropic' ? \`before-\${before}\` : null;"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'reason names the before side')
cp "$SCRATCH/replay.orig" deploy/history-replay.mjs
# Expected RED (predicted): 1 failed, reason 'after-other' against 'before-other'.

# M15: the summary-absent test dropped.
mut deploy/history-replay.mjs "  if (copy.summaryIndex === null) return { ...unjudged('summary-absent'), file_id: copy.fileId, boundary_index: copy.boundaryIndex };
" ""
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-5a Task 3: the population')
cp "$SCRATCH/replay.orig" deploy/history-replay.mjs
# Expected RED (predicted): 8 failed. On T8, TypeError: admitBoundary: summaryIndex null is not a row of the copy,
# thrown from planted() in every case.

# M16 (R6, fix round 1): the before witness stops at the previous boundary row.
mut deploy/history-replay.mjs "  for (let i = boundaryIndex - 1; i >= 0; i -= 1) if (copyRows[i].type === 'assistant') nearestFirst.push(copyRows[i].model);" "  for (let i = boundaryIndex - 1; i >= 0; i -= 1) { if (copyRows[i].type === 'system') break; if (copyRows[i].type === 'assistant') nearestFirst.push(copyRows[i].model); }"
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-5a Task 3')
cp "$SCRATCH/replay.orig" deploy/history-replay.mjs
# Expected RED (measured): 1 failed | 23 passed, the "R6: the before witness is not bounded" case, before 'unknown'.

cmp "$SCRATCH/replay.orig" deploy/history-replay.mjs && echo restored
```

In M12 and M14, `\`` and `\$` are shell escapes inside double quotes. They reach python as a literal backtick and `$`, which are the characters in the file. If an assertion fails with count 0, print the line with `grep -nF` and correct the escape; never loosen the match. Each red's skipped count depends on how many cases Tasks 1 and 2 put in the file, so only the failed and passed counts are stated. Then run Step 5's first two commands once more: both green.

- [ ] **Step 7: Run the neighbours that read these files.** In the foreground, with a timeout of at least 600000 ms. If a file goes red, re-run it alone before calling it a break (CLAUDE.md's load flakes):

```bash
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts)
(cd server && ./node_modules/.bin/vitest run test/citations.test.ts)
(cd server && ./node_modules/.bin/vitest run test/history-card.test.ts -t 'holdingCopyOf')
```

Expected: green.
- `single-definition` runs whole, not only `-t 'ccrc history'`, because its models corpus walks `deploy/`. This section declares no `VOCABS` name (Step 1's last grep) and writes no switch path, so O13 and O14 stay green.
- `citations`: the section's comments carry no numeric `.mjs:N` citation (D-5893).
- `history-card -t 'holdingCopyOf'`: the derive export this task reads is unchanged, and its own pin still holds.

- [ ] **Step 8: Commit.**

```bash
git add deploy/history-replay.mjs server/test/history-replay.test.ts
CO_AUTHORED_BY='<the Co-Authored-By line the attribution reminder gives>'
git commit -m "feat(history-replay): RP5 boundary admission over the holding copy, with the straddle and two-copy CONTROLs (W2-5a Task 3; W2-D66; D-5771)" -m "$CO_AUTHORED_BY"
```

**Drifts found while planning this task** (the decisions document was written at `bd363a76b`; the base is `cd622b2f6`):

| Document says | Code at `cd622b2f6` | Effect here |
|---|---|---|
| W2-D66: `admitBoundary(copyRows, boundaryIndex, summaryIndex)` reads "the copy that `lib.pickHoldingCopy` chooses" | `pickHoldingCopy` answers a `file_id` over `{fileId, live, holds}`. `derive.mjs` exports `holdingCopyOf(db, b)`, which measures `live` and `holds` and is the copy `leafFields` reads. `card.mjs` reads it on a reader handle | Admission reads the copy through Task 1's `boundaryCopyOf`, which calls `holdingCopyOf` (one copy rule). The pure `admitBoundary` takes the chosen copy's rows |
| W2-D66: "admitted iff both are `'anthropic'`" (a boolean) | W2-D71 says "every drop reason is counted" | `admitBoundary` also answers `reason`, `before` and `after` (additive); every verdict word is a `RECON_DISCARDS` word (R5) |
| W2-D66 names no summary rule | The gate and `measure-history.py` keep W1's first-compact-summary rule (D-5771's residual); `derive.mjs` uses lib's anchor-based `summaryRowFor` | Admission uses Task 1's `summaryIndexOf` (`summaryRowFor` over `copyPlan`'s meta), so its after side equals the leaf's producer; mutant M8 pins it |
| W2-D66: the population is "main boundaries of confirmed epochs" | `derive.mjs`'s `epochOfUuid` also requires an unmerged session and takes the smallest `session_pk` (D-5052, shared with the card) | Admission's family is `epochOfUuid`'s; mutant M10 pins it |
| W2-D66: "in families eligible under W2-D71" | W2-D71's exclusions need the pilot list and the control assignment, which only `pilot-source` and `quiz-source` hold | This task answers family keys and verdicts; the sampler applies W2-D71 |
| The brief cites W2-D62 among the admission rules | W2-D62 is fact admission (`admitFact`, W2-3's gate), run after boundary admission in W2-D71's order | Nothing from W2-D62 is applied here |
| §2 / W2-D66 CONTROLs: "row immediately before only" and "most rows after", each on a two-copy fixture; spec RP5's CONTROL: "a mutant reading only the row before the boundary goes red on the straddle" | — | Both readings of "only the row before" are measured (M1: the before side alone; M2: the immediately preceding row alone), each red on the one-copy and two-copy straddles; M3 is the longest-copy rule, red on three two-copy store fixtures |
| W2-D15's parity cite "derive.mjs:316" | `leafFields`' producer line is about :321, `const backend = producerOfCopy(copy.rows, summaryAt ?? copy.index.get(b.uuid));` | Anchored by content. The population always has a summary row, so the `?? boundary` arm is never reached |
| W2-4's driver header: "Imports: node: built-ins, ../ccd/history/lib.mjs and ../shared/roster-json.mjs only"; D-5814 pins the seven modules exactly | Task 1 imports `derive.mjs` and owns the module list and the header (R3) | Step 4(b) adds `epochOfUuid` inside derive.mjs's braces and updates its `EXACT_NAMES` entry |
| W2-4's node:sqlite scan "a quoted mention inside a comment reds too" | It reds any quoted specifier, a JSDoc `import(...)` type included | `db` is typed `{object}`; Step 4's grep checks for it |


### Task 4: Baseline B and its files, held in memory only (W2-D68, W2-D69; the kept-list scan, W2-D33)

A fact the session could still see after compaction N is not "present only before the compaction", so the quiz never asks it. Baseline B is that "still sees" (spec §10.2 "Baseline B", about :2654 at cd622b2f6), and W2-D62's `admitFact` (W2-3's, in `deploy/history-gate.mjs`) tests every variant of F against it. This task builds B for one boundary that Task 3's `admitStoreBoundaries` admitted, reads W2-D69's files into it, and records what B was, never what it said. The sampler (a later task) calls `admitFact(kind, F, b.text, '', {repoRoots})` in W2-D71's order. This task calls no admission itself; its tests do, to pin what B holds.

**What B is (W2-D68).** B is the newline-joined UNREDACTED text of four parts. It is held in memory only: never written under `--out`, never logged, never spawned.
1. **The summary row's stored body, whole**, with its transcript-pointer line kept. Only the payload replaces that line (W2-D75, a later task).
2. **Every kept(N) member present in the store**, in holding-copy order: first the members the holding copy holds, by line, then any it does not hold, by `entry_id`. They are read through Task 1's `keptMembersOf` and `keptRowsOf`, the payload's own reader (R3).
   - Task 1 reads `boundaries.kept_blob_id` and decodes it through derive.mjs's `bodyOf`, with B's run budget.
   - A NULL id discards the boundary as `kept-absent`.
   - A null body (bodyOf folds a tombstone, a body that is not JSON and an over-cap body into one null; W2-1's residual), a body that is not an array, or an array holding anything but strings discards it as `kept-unreadable`.
   - Each member is rendered with its primary body **and every `entry_variants` body**, whatever the variant's cause. A member whose primary or variant blob reads null discards the boundary as `kept-member-unreadable`.
3. **The holding copy's rows after the summary row**, up to but excluding the first row that is operator-provenance or an assistant row and is **not a kept member**. A kept member is part 2's row, so it is passed over and is never the stop (D-6278). The served card is one of these rows. More than `BASELINE_POST_ROWS_MAX` (200) such rows discards the boundary (`post-over-cap`), and a row whose body reads null discards it (`post-row-unreadable`). Rows after the stop are never read.
4. **The baseline files** of W2-D69 (below).

**Both renderings.** Every row of parts 1 to 3 enters B twice. The first is lib's `renderEntryText`. The second is its plain string leaves: `ftsTextOf(body, 'entry')` for a string or a block list, and every string leaf of an object body. `ftsTextOf` answers `''` for an object, and an attachment row stores its `attachment` object (lib's `blobBodyOf`), so this is how the served card's own text enters B (D-6279). The two renderings are not redundant:
- `renderEntryText` writes a tool_use input as JSON, escaping a quoted command. Only the leaves hold it whole (W2-D61's pin).
- The leaves drop an input's object keys, and `renderEntryText` keeps them.

**`bodyOf` only, never derive.mjs's kept-set reader (W2-D33).** That reader folds a NULL id, a tombstone and a body that is not an array into one empty set. Read through it, a pruned kept list becomes "nothing was kept", and B loses the rows the session still saw. That admits facts the session could see, the one bias admission must never have. So every blob B reads goes through `bodyOf` over Task 1's `blobReadStmts` (`rs.blobs`), and no `deploy/*.mjs` names the kept-set reader on a code line: Task 1's scan pins it (R3). This task's tombstone case shows the fold the scan exists for.

**The baseline files (W2-D69, `baseline_files: 'v1'`).**
- (a) For each distinct absolute `cwd` and `cwd_real` of the family's epochs up to and including N's: `CLAUDE.md`, `CLAUDE.local.md` and `.claude/CLAUDE.md`, in that directory and in every ancestor up to the filesystem root.
- (b) `CLAUDE.md` in every rostered account's config dir. Hidden accounts are included.
- (c) Every `*.md` under `<config dir>/projects/<slug>/memory/`, for every config dir and every cwd in (a). The slug is W2-4's `projectSlugOf`: each character outside `[A-Za-z0-9]` becomes `-`, which is W2-D69's rule.
- (d) `@`-imports from (a) to (c), breadth-first to depth `BASELINE_IMPORT_DEPTH` (5). A file of (a) to (c) is depth 0. `~/` resolves to `$HOME`, and any other mention resolves against the importing file's directory.

How each file is treated:
- **Left out:** an absent file, ENOENT anywhere in its path or ENOTDIR (a path through a regular file).
- **Not an import:** an `@`-mention that names a directory, or a name too long to be a path. Over-reading `@` only rejects more facts. The one cost, a mention that is not an import naming a FIFO or an unreadable file, is a discard, which is the safe side.
- **Discarded:** N's epoch with no absolute `cwd` (`cwd-unknown`); N's `cwd` or `cwd_real` gone (`cwd-missing`) or unmeasurable (`cwd-unreadable`); and any file that exists but is unreadable (`file-unreadable`, a memory directory that cannot be listed included), not regular (`file-not-regular`), or over 1 MiB (`file-over-cap`). An earlier epoch's gone directory is left out: the session at N runs in N's cwd, and that directory's ancestors are still read.
- **Read through links.** Files are read through W2-4's `readPlain` with a new `follow` option. A `CLAUDE.md` that links to a regular file is read, as Claude Code reads it. Still nothing but a regular file is opened (fstat after the open), and `O_NONBLOCK` keeps a FIFO from ever blocking.

**Recorded (W2-D68, W2-D69 "Reporting").** B's byte count, its file count, its kept-member, absent-member and post-row counts, and each discard word, nothing else. B's discard words are `RECON_DISCARDS` words (R5): this task appends its eleven new ones (`kept-absent` and `kept-unreadable` are Task 1's). `writeBaselineRecord` writes `<out>/<section>/baseline.json` (0600, section `quiz` or `pilot`, the W2-D72 layout), through W2-4's D-5986 writers `ensurePlainDir`, `writePlain` and `shaOfPlain`. A link or a non-directory at the section, or a non-regular file at the record, refuses `out-refused`. The pilot reads its per-boundary file counts from this record.

**Where the doc and the code differ** (each a hint, re-anchored by content at cd622b2f6):

| The decisions document says | The code at cd622b2f6 (or Tasks 1 to 3) says | What this task does |
|---|---|---|
| W2-D68: "an absent summary row … discards the boundary" | Task 3's `admitStoreBoundaries` drops such a boundary as `summary-absent`, before B (its population, W2-D66) | B takes only an admitted row and reads its copy again through Task 1's `boundaryCopyOf`. Its `copy-moved` discard covers a copy that changed between Task 3's read and B's: another file, the boundary at another index, or a summary row other than the admitted row's `summary_entry_id` (R3). |
| W2-D34's residual: "B's part 3 stops at the first operator or assistant row **after the boundary**" | W2-D68 (3) reads "the post-boundary rows of the holding copy **after the summary row**" | W2-D68 governs: part 3 starts after the summary row. A row between the boundary and its summary is in neither part, and the as-of cut hides it too (W2-D34). |
| W2-D68 (2): "a pruned or over-cap member … discards" (counted) | `bodyOf` answers one null for a tombstone, a non-JSON body and an over-cap body (W2-1 plan, Residuals) | One word, `kept-member-unreadable`. The body pick's five states (D-6238) are read by mining and the payload, never by B. |
| W2-D68: "Both renderings … as its `ftsTextOf` string leaves" | `ftsTextOf` answers `''` for an object body, and an attachment row's body is its `attachment` object (lib `blobBodyOf`) | Every string leaf of an object body (D-6279). |
| W2-D68 (3): the stop is "the first operator-provenance or assistant row" | A kept(N) member can sit after the summary row (W2-D68's own pin, "a post-summary kept member") | A kept member is passed over, never the stop (D-6278). |
| W2-D69: "when the roster is unreadable" the boundary is discarded | W2-4's `readRoster` reads the roster once per run and refuses `roster-invalid` (W2-D52) | No boundary is built at all: stronger than a discard. `baselineOf` takes Task 2's `rosterConfigDirs` array and throws `TypeError` without one. |
| W2-D69: a file "not regular" discards | W2-4's `readPlain` is lstat plus `O_NOFOLLOW` (D-5986), so a link reads as not regular | `readPlain(p, cap, follow)`, whose default stays W2-4's. The baseline files follow links. |
| W2-D68's pin: "a scan of `--out` for a planted B sentinel finds nothing" | No subcommand writes under `--out` at this task; the only writer is `writeBaselineRecord` | The scan is pinned here over that writer. Task 7 re-runs the walk over a whole stubbed `pilot-source` run (R7). |
| W2-D33: the body-pick helper answers four state words | `expandEntryBody` answers five (`undecodable`, D-6238) | Not used by B. B reads `bodyOf` only. |

**Files:**
- Modify `deploy/history-replay.mjs`:
  - (a) The one import from `'../ccd/history/lib.mjs'` gains `ftsTextOf` (`renderEntryText` is Task 1's). derive.mjs's line already holds `blobReadStmts`, `bodyOf` and `epochOfUuid` (Tasks 1 and 3). This task adds **no import line and no name to a pinned module**, so `EXPECTED_IMPORTS` and `EXACT_NAMES` (D-5814, Task 1's) are unchanged.
  - (b) `function readPlain(p, cap)` (about :748, W2-4's D-5986 section) becomes `readPlain(p, cap, follow = false)`. Its lstat line `st = lstatSync(p);` and its open line `fd = openSync(p, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);` each read `follow`, and its JSDoc gains one `@param` line. Every existing caller passes two arguments and keeps W2-4's no-follow read.
  - (c) Task 1's `RECON_DISCARDS` gains, in place after Task 3's six words, B's eleven: `'copy-moved'`, `'summary-unreadable'`, `'kept-member-unreadable'`, `'post-row-unreadable'`, `'post-over-cap'`, `'cwd-unknown'`, `'cwd-missing'`, `'cwd-unreadable'`, `'file-unreadable'`, `'file-not-regular'` and `'file-over-cap'` (R5).
  - (d) One section, inserted directly above the comment block that begins `// The entry guard stays the LAST block of this file:`, below every section Tasks 1 to 3 placed there. The guard stays the file's last block.
- Modify `server/test/history-replay.test.ts`: append one block at the end of the file. It holds ten aliased imports, the module-level `W5A4_*` and `w5a4*` fixtures, and four `describe`s.
- Not edited: `ccd/**` (bodyOf, blobReadStmts, epochOfUuid, renderEntryText and ftsTextOf are imported, never changed); `deploy/history-gate.mjs` (imported by the test only); `shared/**`; the spec; README; any other test file.

**Interfaces:**
- Consumes (Task 3, `deploy/history-replay.mjs`):
  - `admitStoreBoundaries(rs): {boundaries: AdmissionRow[], counts}`. B reads an admitted row's `entry_id`, `uuid`, `transcript_pk`, `admitted`, `file_id`, `boundary_index`, `summary_index` and `summary_entry_id`.
  - derive.mjs's `epochOfUuid`, which Task 3 imports. Its family rule is the leaf's and the card's (D-5052).
  - Test side: `W5A3_CLAUDE`, Task 3's module-level fixture model, so the fixture's assistant rows pass RP5 for the case 'B is built for the row admitStoreBoundaries admits'.
- Consumes (Task 1): `openReplayStore(home)` (`rs`: `rs.db`, `rs.blobs`), `boundaryCopyOf(rs, entryId)` (the one holding-copy reader), `keptMembersOf(rs, boundary, budget)` and `keptRowsOf(rs, uuids, fileId)` (the one kept-list reader, R3), and `RECON_DISCARDS`, to which this task appends. Consumes (Task 2): `rosterConfigDirs(roster, home)` (R7).
- Consumes (W2-1, `ccd/history/derive.mjs`, base): `bodyOf(s, blobId, budget: {bytes}): unknown | null`, over Task 1's `rs.blobs`. Test side only, `blobReadStmts` and `keptOf(s, blobId, budget): Set<string>`, as the CONTROL that shows the fold.
- Consumes (base `ccd/history/lib.mjs`): `renderEntryText(body): string`, `ftsTextOf(body, 'entry'): string` and `canonicalJson`. Test side: `historyPaths(home).dbFile`, `BLOB_DECODE_MAX` and `sha256Hex`.
- Consumes (W2-4, `deploy/history-replay.mjs`):
  - module-private: `readPlain(p, cap)`, `ensurePlainDir(out, rel)`, `writePlain(out, rel, bytes, mode?)` and `shaOfPlain(out, rel)`;
  - exported: `projectSlugOf(cwd)`, `readRoster(home): {json, roster}`, `prepareOut(out)` (test side), `DriverRefusal` (test side).
- Consumes (W2-3, test side only): `admitFact(kind, F, baselineText, questionText, {repoRoots}): {admitted, hit}` and `OPEN_RECORD_V1.draft.quiz.fields.baseline_files.value` (`'v1'`).
- Consumes (base `ccd/history/store.mjs`, test side only): `createStore(home)`, `openWriter(dbFile)`, `closeWriter(db)`, `openReader(dbFile)` and `brotli(buf)`.
- Produces (exported from `deploy/history-replay.mjs`):
  - `BASELINE_FILES_ID = 'v1'`, `BASELINE_FILE_MAX = 1048576`, `BASELINE_POST_ROWS_MAX = 200` and `BASELINE_IMPORT_DEPTH = 5`;
  - `BASELINE_NAMES = Object.freeze(['CLAUDE.md', 'CLAUDE.local.md', '.claude/CLAUDE.md'])`;
  - eleven words appended to `RECON_DISCARDS` (R5): B's discards, each counted, never refused; none is a `DRIVER_REASONS` word;
  - `BASELINE_SECTIONS = Object.freeze(['quiz', 'pilot'])`, `BASELINE_RECORD = 'baseline.json'` and `BASELINE_RECORD_KIND = 'ccrc-history-w2-baseline'`;
  - `baselineOf(rs, boundary: AdmissionRow, ctx: {home: string, configDirs: readonly string[], budget: {bytes: number}, top?: string}): BaselineAnswer`. `BaselineAnswer` is `{state: 'built', bytes, files, keptMembers, keptAbsent, postRows}` with `text` as a NON-ENUMERABLE property, frozen, or `{state: 'discard', why}`. It throws `TypeError` for a row that is not admitted, or a `ctx` without `configDirs`. `ctx.top`, which no subcommand passes, is the highest ancestor W2-D69 (a) walks (Task 6's `sourceQuiz` passes it through for its tests);
  - `baselineCandidates({cwds, configDirs, top?}): string[]`, pure: W2-D69 (a) and (b)'s paths in reading order;
  - `baselineFiles({home, configDirs, epochs, epochSeq, top?}): {state: 'files', files: Array<{path, text}>} | {state: 'discard', why}`;
  - `baselineRow(boundaryUuid, b): {boundary_uuid, state, why, bytes, files, kept_members, kept_absent, post_rows}`;
  - `writeBaselineRecord(out, section, {storeId, rows}): string`, the sha256 of the record's bytes on disk;
  - module-private, each with a `bl`/`BL_` prefix so no name collides with Tasks 1 to 3: `blDiscard`, `blOrder`, `BL_STMTS`, `blStmts`, `blMemberBlobs`, `blObjectLeaves`, `blLeaves`, `blRenderings`, `blHeld`, `blDirState`, `blMemoryFiles`, `BL_IMPORT_RE`, `BL_IMPORT_TRAIL`, `blImports` and `blRead`.
- Produces (test side, module level): `W5A4_UUID`, `W5A4_FACT`, `W5A4_QUOTED`, `W5A4_CARD_CMD`, `type W5a4Row`, `w5a4Rows()`, `w5a4With(key, patch)`, `w5a4Fixture(spec?)`, `w5a4WriteFiles(fx)`, `w5a4Put(p, text)`, `w5a4B(fx)`, `w5a4Built(fx)` and `w5a4Admitted(kind, F, text)`.
- Consumed later: Task 6's `sourceQuiz` calls `baselineOf` over each admitted row a candidate reaches, `admitFact` against `b.text`, and `baselineRow` and `writeBaselineRecord` for every boundary it built or discarded; the subcommands record the open record's `quiz.baseline_files` default, which this task's `BASELINE_FILES_ID is the open record default` case holds equal to `BASELINE_FILES_ID`, as the quiz plan's `baseline_files` and the pilot's `used.baseline_files`.

**Spec:** §10.2 "Baseline B" (about :2654 at cd622b2f6) and "Admission" (about :2659). The spec is never edited here; W2-D68 and W2-D69 carry no erratum.

**Decisions:**
- W2-D68 (its four parts, both renderings, fail closed, the pins).
- W2-D69 (the file set `'v1'`, absence and failure, reporting, the pins).
- W2-D33 (bodyOf over blobReadStmts; the scan that no `deploy/*.mjs` names the kept-set reader).
- W2-D61 (its second pin: "a short quoted command present in a kept tool_use is rejected by B").
- W2-D62 (`admitFact`, W2-3's, called by the tests).
- W2-D51 (store reads through `openReader`'s handle).
- W2-D52 (the roster read once).
- W2-D72's `--out` layout (`quiz/`, `pilot/`).
- D-5986 (the type-checked I/O under `--out`).

Departures this task ships, each defined in this plan's `## Deviations found`: D-6278 (`history-replay-baseline-kept-not-a-stop`) and D-6279 (`history-replay-baseline-object-leaves`), below. Neither is a spec departure that W2-D68 already numbered. W2-D68 and W2-D69 are marked "no" in section 3, and section 6 lists no erratum for either. Both readings only grow B, so admission rejects more facts, never fewer.

**Choices this task makes:**
- **B takes Task 3's admitted row, not a new boundary record.** It reads the copy again through Task 1's `boundaryCopyOf`, the one holding-copy reader, and keeps the position check: another file, the boundary no longer at `boundary_index`, or a summary row at `summary_index` that is not the admitted row's `summary_entry_id` is `copy-moved`, never a guess (R3). N's epoch is `epochOfUuid` over the transcript's session uuid, the same rule Task 3 used. If it no longer answers, the cwd is unknown (`cwd-unknown`).
- **The text is non-enumerable and the answer is frozen.** `canonicalJson` (which reads `Object.keys`), `JSON.stringify` and `util.inspect` never carry it. Any writer handed the whole answer by mistake still writes only counts. `baselineRow` reads named fields only.
- **An array with a non-string member is `kept-unreadable`** (Task 1's `keptMembersOf`). lib's `boundaryOf` stores `allUuids` only when every member is a non-empty string (it reads the array as null otherwise), so such a blob is damaged. The kept-set reader would filter it; B refuses it.
- **An empty kept list is an empty part 2, not a discard.** `[]` is a measured "nothing was kept". Only a NULL id is `kept-absent`.
- **Members the holding copy does not hold come after the held ones**, by `entry_id` (Task 1's `keptRowsOf`). `absent` counts listed uuids the store does not hold. Neither changes admission, which is a substring test, but both are recorded.
- **Part 3 reads the copy's rows `boundaryCopyOf` answered**, after the summary row, in file order: no second copy-rows query.
- **`ctx.top` is a test seam with a pinned default.** Without it, a test's ancestor walk would read files above its temp tree. The default walk to `/` is pinned on the pure `baselineCandidates`, which reads nothing.
- **`readPlain` gains `follow`, not a second reader.** One function keeps W2-4's type rules (regular only, fstat after open, bounded read). `follow` changes only the stat and the open's `O_NOFOLLOW`. W2-4's D-5986 cases run unchanged in the whole-file run.
- **The record has its own file per section** (`quiz/baseline.json`, `pilot/baseline.json`), not a field of a list or record another task writes. So Task 6's frozen-list bytes (W2-D73) are untouched by B's counts.

**Departures this task ships** (each defined in this plan's `## Deviations found`):
- D-6278: W2-D68 (3) stops part 3 at "the first operator-provenance or assistant row" after the summary. A kept(N) member there is part 2's row (W2-D68 itself pins "a post-summary kept member"), so this task passes over it: it is never the stop. The rows after it, the served card among them, stay in B. The departure only grows B, so it rejects more facts, never fewer. Pins: the case 'a kept member after the summary is never the stop' with its CONTROL; mutant M9.
- D-6279: W2-D68's second rendering is "its `ftsTextOf` string leaves". `ftsTextOf` answers `''` for an object body, and an attachment row's stored body is its `attachment` object, so the served card would enter B only as JSON, with its quotes escaped. B takes every string leaf of an object body instead. This only grows B. Pins: the case 'part 3 takes the rows after the summary', whose CONTROL is the card's JSON rendering; mutant M6.
- D-6304 (a fix round before review): B renders each stored body of parts 1 to 3 through `renderOrNull`, and a body nested past about 4,500 levels fails B closed as `body-unrenderable`, the existing word (D-6302, D-6303). Pins: the D-6304 cases and mutants MA to MD.
- **W2-D74's second pin is here (R7):** a fact only in the sanitised body, the primary that expand passes over, is rejected by B, because B reads the primary and every variant. Pin: its own case; mutant M36.

**Residuals, named:**
- **A fact in a row outside N's holding copy, stamped exactly T_N**, is visible to treatment and absent from B (W2-D34). It is counted, as `asof_same_ms_hits`, by the answerability task, not here.
- **Over-reading `@`**: prose such as `@someone` is resolved and, absent, left out. A mention that is not an import but names a FIFO or an unreadable file discards the boundary. That is the safe side, and it is counted.
- **B over-rejects** (decisions §7): the union of every rostered home's files, and admission's tails and windows have no token boundaries.

**Live safety.** No case spawns anything but `mkfifo` (argv array, never a shell), and no `claude`, `ccrc` or `gh` binary is reached, because nothing in this task launches a run. Every store is made by `store.mjs`'s `createStore` under a `mkTmp` root, written with `openWriter`, closed, and read through Task 1's `openReplayStore`, as a subcommand reads one (its pair index reads only the fixture HOME's secret files, which are absent). The roster is two of W2-4 Task 3's `FIXTURE_ACCOUNTS` rows, written with its module-level `writeRoster` under the fixture HOME, so the config dirs are fixture dirs. W2-D69's ancestor walk stops at the case's own root (`ctx.top`), so no case reads a file outside its temp tree. `--out` is a `prepareOut` directory under the same root. Nothing reads the session's HOME, `~/.ccrc`, a limits row or a live store. Facts are SHA-shaped (`fa` + five digits + `cafe`), so each has its own seven-character prefix, the variant W2-D62 tests. Commands are short and synthetic. No key-shaped value is planted, and fixture paths inside bodies are in the `/home/u/tree` style.

- [ ] **Step 1: Confirm what this task builds on.** From the repository root:

```bash
grep -c '^// The entry guard stays the LAST block of this file:' deploy/history-replay.mjs
grep -c '^if (process.argv\[1\] && import.meta.url === pathToFileURL(realpathSync(process.argv\[1\])).href) {$' deploy/history-replay.mjs
grep -nE "^import \{[^}]*\} from '\.\./ccd/history/(lib|derive)\.mjs';$" deploy/history-replay.mjs
grep -c 'never loads node:sqlite in any form' deploy/history-replay.mjs
grep -c '^function readPlain(p, cap) {$' deploy/history-replay.mjs
grep -c '^    st = lstatSync(p);$' deploy/history-replay.mjs
grep -c '^    fd = openSync(p, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);$' deploy/history-replay.mjs
grep -vE '^\s*(//|\*|/\*)' deploy/history-replay.mjs | grep -cE '\bkeptOf\b'
grep -nE 'BASELINE_|baselineOf|baselineCandidates|baselineFiles|baselineRow|writeBaselineRecord|\bbl[A-Z][A-Za-z]*\(|BL_(STMTS|IMPORT)' deploy/history-replay.mjs
grep -c "^  'no-epoch', 'ts-null', 'before-other', 'before-unknown', 'after-other', 'after-unknown',$" deploy/history-replay.mjs
grep -c 'w5a4\|W5A4_' server/test/history-replay.test.ts
grep -c '^const W5A3_CLAUDE = ' server/test/history-replay.test.ts
node --no-warnings --input-type=module -e "const d = await import('./deploy/history-replay.mjs'); const v = await import('./ccd/history/derive.mjs'); const l = await import('./ccd/history/lib.mjs'); console.log(typeof d.admitStoreBoundaries, typeof d.projectSlugOf, typeof d.readRoster, typeof v.bodyOf, typeof v.blobReadStmts, typeof v.epochOfUuid, typeof l.renderEntryText, typeof l.ftsTextOf, typeof d.keptMembersOf, typeof d.keptRowsOf, typeof d.boundaryCopyOf, typeof d.rosterConfigDirs)"
```

Expected:
- The first two counts print 1 each.
- The import listing shows exactly one lib.mjs line and exactly one derive.mjs line, `import { blobReadStmts, bodyOf, epochOfUuid, holdingCopyOf } from '../ccd/history/derive.mjs';`. Note whether `ftsTextOf` is already in the lib line.
- `never loads node:sqlite in any form` prints 0, because Task 1 reworded the header (R1).
- The `readPlain` header line and its two lines each print 1.
- `keptOf` prints 0. The count reads code lines only, as Task 1's scan does: Task 1's section header comment names `keptOf` once, so a count over every line prints 1.
- The name listing prints nothing; Task 3's `RECON_DISCARDS` line prints 1; the `w5a4` count prints 0.
- `W5A3_CLAUDE` prints 1 (Task 3's fixture).
- The `node` line prints `function` twelve times. Under `-e`, `process.argv[1]` is unset, so `main` never runs.

Stop and report to the coordinator if any of these differ:
- no derive.mjs line, or one that is not a single-line braces import (M1's regex below reads that shape);
- the old header sentence still present (R1 is Task 1's);
- a Task 1, 2 or 3 name missing, or any of this task's names already defined.

Never define a name twice.

- [ ] **Step 2: Write the failing tests.** Append at the end of `server/test/history-replay.test.ts`:

```ts

// ── W2-5a Task 4: Baseline B and its files (W2-D68, W2-D69; W2-D33's kept-list scan; W2-D61's quoted-command pin) ────
// In-process, on fixture stores and fixture trees only. Each case makes a mkTmp root that holds a fixture HOME (its
// roster is two of W2-4 Task 3's FIXTURE_ACCOUNTS rows; its store is made by store.mjs's createStore and written with
// openWriter) and a fixture tree, and hands the driver Task 1's openReplayStore over that HOME, as a subcommand does. W2-D69's
// ancestor walk stops at that root (ctx.top), so no case reads a file outside its own tree; the default walk to the
// filesystem root is pinned on baselineCandidates, which reads nothing. Nothing is spawned but mkfifo, and no live
// store or real home is read. Facts are SHA-shaped, `fa` + five digits + `cafe`, so each has its own seven-character
// prefix (the variant W2-D62 tests), or short synthetic commands; nothing key-shaped is planted.
// The W5A4_ and w5a4 declarations are MODULE-LEVEL: later W2-5a tasks build B fixtures with them.
import * as w5a4Fs from 'node:fs';
import * as w5a4Path from 'node:path';
import { createHash as w5a4Hash } from 'node:crypto';
import { inspect as w5a4Inspect } from 'node:util';
import type { DatabaseSync as W5a4Db } from 'node:sqlite';
import * as w5a4Lib from '../../ccd/history/lib.mjs';
import * as w5a4St from '../../ccd/history/store.mjs';
import * as w5a4DeriveMod from '../../ccd/history/derive.mjs';
import * as w5a4Gate from '../../deploy/history-gate.mjs';
import * as w5a4Drv from '../../deploy/history-replay.mjs';
import { mkTmp as w5a4MkTmp } from './tmpHelpers.js';

/** derive.mjs has no .d.mts (W2-1, R1): the two reads the CONTROL needs, typed at the call site. */
const w5a4Derive = w5a4DeriveMod as unknown as {
  keptOf: (s: unknown, blobId: number | null, budget: { bytes: number }) => Set<string>;
  blobReadStmts: (db: W5a4Db) => unknown;
};
const W5A4_UUID = (n: number): string => `5a400000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const W5A4_FACT = (n: number): string => `fa${String(n).padStart(5, '0')}cafe`;
/** A short Bash command with quotes: renderEntryText escapes them, so only the string-leaf rendering holds it whole. */
const W5A4_QUOTED = 'git log --format="%h %s" -n 3';
/** The served card's command, quoted the same way, inside an attachment object. */
const W5A4_CARD_CMD = 'make check ARGS="--fast --keep"';
const W5A4_ROOT_USER = (process.getuid?.() ?? 1) === 0;

type W5a4Stored = 'tombstone' | 'over-cap';
type W5a4Row = {
  key: string;
  type: 'user' | 'assistant' | 'system' | 'attachment';
  provenance: 'operator' | 'model' | 'tool' | 'summary' | 'harness';
  body: unknown;
  stored?: W5a4Stored;
  variants?: Array<{ body: unknown; cause: 'ccd-sanitize' | 'unknown'; stored?: W5a4Stored }>;
  held?: boolean;
};
interface W5a4Spec {
  rows?: W5a4Row[];
  kept?: string[] | null | 'tombstone' | 'object' | 'non-string';
  keptExtra?: string[];
  /** Epochs 1..n of the family, each cwd a name under the tree (null: none). N's is `nSeq`, default the last. */
  epochs?: Array<{ cwd: string | null; cwdReal?: string | null }>;
  nSeq?: number;
}
/** An admitted row of Task 3's admitStoreBoundaries, as the fixture knows it. */
type W5a4Admission = {
  entry_id: number; uuid: string; transcript_pk: number; ts_ms: number | null; ccrc_id: string | null; generation: string | null;
  admitted: boolean; reason: string | null; file_id: number | null; boundary_index: number | null; summary_index: number | null;
  summary_entry_id: number | null; before: string | null; after: string | null;
};
/** Task 1's ReplayStore, as the fixture reads it. */
type W5a4Rs = { db: W5a4Db; close(): void };
interface W5a4Fixture {
  root: string; home: string; tree: string; cwd: string; rs: W5a4Rs; db: W5a4Db; keptBlobId: number | null;
  boundary: W5a4Admission;
  ctx: { home: string; configDirs: string[]; budget: { bytes: number }; top: string };
  uuidOf: (key: string) => string;
}
type W5a4Answer =
  | { state: 'built'; bytes: number; files: number; keptMembers: number; keptAbsent: number; postRows: number; text: string }
  | { state: 'discard'; why: string };

/** The holding copy, in line order: an operator row and three kept rows before the boundary; the summary (its last line
 *  the transcript pointer); a kept assistant row; the served card and a harness notice; the operator's next prompt (the
 *  stop); and a row after it. Assistant rows carry Task 3's anthropic fixture model, so RP5 admits the boundary. */
function w5a4Rows(): W5a4Row[] {
  const bash = { type: 'tool_use', id: 'toolu_k1', name: 'Bash', input: { command: W5A4_QUOTED } };
  return [
    { key: 'op1', type: 'user', provenance: 'operator', body: `look at ${W5A4_FACT(4)} please` },
    { key: 'a1', type: 'assistant', provenance: 'model', body: [{ type: 'text', text: '...' }, bash], variants: [
      { cause: 'ccd-sanitize', body: [{ type: 'text', text: `the sanitised text named ${W5A4_FACT(5)}` }, bash] },
      { cause: 'unknown', body: [{ type: 'text', text: `another copy named ${W5A4_FACT(6)}` }, bash] },
    ] },
    { key: 'r1', type: 'user', provenance: 'tool', body: [{ type: 'tool_result', tool_use_id: 'toolu_k1', content: `kept output ${W5A4_FACT(3)}` }] },
    { key: 'a2', type: 'assistant', provenance: 'model', body: [{ type: 'tool_use', id: 'toolu_k2', name: 'Edit', input: { [W5A4_FACT(9)]: true } }] },
    { key: 'boundary', type: 'system', provenance: 'harness', body: 'Conversation compacted' },
    { key: 'summary', type: 'user', provenance: 'summary',
      body: `This session is being continued. Summary: ${W5A4_FACT(1)} was the head.\nIf you need specifics, read the full transcript at: /home/u/.claude/projects/-home-u-tree-demo/${W5A4_FACT(2)}.jsonl` },
    { key: 'a3', type: 'assistant', provenance: 'model', body: [{ type: 'text', text: `a kept reply after the summary, ${W5A4_FACT(7)}` }] },
    { key: 'card', type: 'attachment', provenance: 'harness', body: { type: 'hook_additional_context', content: [`History: node L1a2b3c4 ran ${W5A4_CARD_CMD}`] } },
    { key: 'sys', type: 'system', provenance: 'harness', body: `a harness notice ${W5A4_FACT(8)}` },
    { key: 'op2', type: 'user', provenance: 'operator', body: 'the next prompt' },
    { key: 'late', type: 'attachment', provenance: 'harness', body: { type: 'hook_additional_context', content: [`later context ${W5A4_FACT(30)}`] } },
  ];
}
const W5A4_KEPT = ['a1', 'r1', 'a2', 'a3'];
/** w5a4Rows with one row patched. */
const w5a4With = (key: string, patch: Partial<W5a4Row>): W5a4Row[] => w5a4Rows().map((r) => (r.key === key ? { ...r, ...patch } : r));

const w5a4Open: W5a4Rs[] = [];
afterEach(() => {
  for (const rs of w5a4Open) { try { rs.close(); } catch { /* its case closed it */ } }
  w5a4Open.length = 0;
});

/** One family, one confirmed epoch per `epochs` entry, one transcript (N's epoch's session uuid), one live copy
 *  (file 1) holding every row not marked `held: false`, and the boundary's kept list. Answers the admitted row Task 3
 *  would hand B, built by position over the held rows, and the ctx a subcommand passes, with `top` at the root. */
function w5a4Fixture(spec: W5a4Spec = {}): W5a4Fixture {
  const root = w5a4MkTmp('w5a4-baseline-');
  const home = w5a4Path.join(root, 'home');
  const tree = w5a4Path.join(root, 'tree');
  const cwd = w5a4Path.join(tree, 'demo');
  w5a4Fs.mkdirSync(cwd, { recursive: true });
  w5a4Fs.mkdirSync(home, { recursive: true });
  writeRoster(home, FIXTURE_ACCOUNTS.slice(0, 2));
  w5a4St.createStore(home);
  const dbFile = w5a4Lib.historyPaths(home).dbFile;
  const w = w5a4St.openWriter(dbFile);
  const rows = spec.rows ?? w5a4Rows();
  const epochs = spec.epochs ?? [{ cwd: 'demo' }];
  const nSeq = spec.nSeq ?? epochs.length;
  const under = (name: string | null | undefined): string | null => (name === null || name === undefined ? null : w5a4Path.join(tree, name));
  let blobN = 0;
  const blob = (body: unknown, stored?: W5a4Stored): number => {
    blobN += 1;
    const raw = Buffer.from(JSON.stringify(body), 'utf8');
    const sha = w5a4Hash('sha256').update(`${blobN}:`).update(raw).digest();
    if (stored === 'tombstone') {
      return Number(w.prepare("INSERT INTO blobs (sha256, codec, z, raw_len, pruned_ms) VALUES (?, 'br5', NULL, ?, 1)").run(sha, raw.length).lastInsertRowid);
    }
    const rawLen = stored === 'over-cap' ? w5a4Lib.BLOB_DECODE_MAX + 1 : raw.length;
    return Number(w.prepare("INSERT INTO blobs (sha256, codec, z, raw_len) VALUES (?, 'br5', ?, ?)").run(sha, w5a4St.brotli(raw), rawLen).lastInsertRowid);
  };
  const ids = new Map<string, number>();
  const uuids = new Map<string, string>();
  const uuidOf = (key: string): string => {
    const u = uuids.get(key);
    if (u === undefined) throw new Error(`w5a4Fixture: no row ${key}`);
    return u;
  };
  w.exec('BEGIN');
  w.prepare("INSERT INTO sessions (session_pk, ccrc_id, generation, project, first_seen_ms) VALUES (1, 'fam-a', ?, 'demo', 1)").run(W5A4_UUID(0xfa));
  const epoch = w.prepare("INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, cwd, cwd_real, confirmed_ms) VALUES (1, ?, ?, 'startup', 'hook', ?, ?, 1)");
  epochs.forEach((e, i) => { epoch.run(i + 1, W5A4_UUID(0xe0 + i), under(e.cwd), under(e.cwdReal)); });
  w.prepare('INSERT INTO transcripts (transcript_pk, cc_session_uuid) VALUES (1, ?)').run(W5A4_UUID(0xe0 + nSeq - 1));
  w.prepare("INSERT INTO ingest_files (file_id, dev, ino, transcript_pk, status, parser_version) VALUES (1, 1, 5401, 1, 'live', 1)").run();
  const entry = w.prepare(`INSERT INTO entries (uuid, transcript_pk, type, model, provenance, prov_version, struct_rank_ns, struct_file_id, blob_id, ts_ms, is_compact_summary)
    VALUES (?, 1, ?, ?, ?, 1, 0, 1, ?, ?, ?)`);
  const member = w.prepare('INSERT INTO memberships (file_id, entry_id, line) VALUES (1, ?, ?)');
  const variant = w.prepare('INSERT INTO entry_variants (entry_id, blob_id, first_file_id, first_seen_ms, cause) VALUES (?, ?, 1, 1, ?)');
  rows.forEach((r, i) => {
    const primary = blob(r.body, r.stored);
    const id = Number(entry.run(W5A4_UUID(i + 1), r.type, r.type === 'assistant' ? W5A3_CLAUDE : null, r.provenance, primary, 1_000 + i,
      r.provenance === 'summary' ? 1 : 0).lastInsertRowid);
    ids.set(r.key, id);
    uuids.set(r.key, W5A4_UUID(i + 1));
    if (r.held !== false) member.run(id, i + 1);
    if (r.variants !== undefined) {
      variant.run(id, primary, 'unknown');   // a store may list the primary among its variants; B reads it once
      for (const v of r.variants) variant.run(id, blob(v.body, v.stored), v.cause);
    }
  });
  const kept = spec.kept === undefined ? W5A4_KEPT : spec.kept;
  let keptBlobId: number | null = null;
  if (kept === 'tombstone') keptBlobId = blob([uuidOf('a1')], 'tombstone');
  else if (kept === 'object') keptBlobId = blob({ allUuids: [uuidOf('a1')] });
  else if (kept === 'non-string') keptBlobId = blob([uuidOf('a1'), 7]);
  else if (kept !== null) keptBlobId = blob([...kept.map(uuidOf), ...(spec.keptExtra ?? [])]);
  w.prepare('INSERT INTO boundaries (entry_id, transcript_pk, ord, anchor_uuid, kept_blob_id) VALUES (?, 1, 1, ?, ?)')
    .run(ids.get('boundary')!, uuidOf('summary'), keptBlobId);
  w.exec('COMMIT');
  w5a4St.closeWriter(w);
  const rs = w5a4Drv.openReplayStore(home) as unknown as W5a4Rs;
  w5a4Open.push(rs);
  const held = rows.filter((r) => r.held !== false).map((r) => r.key);
  const boundary: W5a4Admission = {
    entry_id: ids.get('boundary')!, uuid: uuidOf('boundary'), transcript_pk: 1, ts_ms: 1_000 + rows.findIndex((r) => r.key === 'boundary'),
    ccrc_id: 'fam-a', generation: W5A4_UUID(0xfa), admitted: true, reason: null, file_id: 1,
    boundary_index: held.indexOf('boundary'), summary_index: held.indexOf('summary'), summary_entry_id: ids.get('summary')!,
    before: 'anthropic', after: 'anthropic',
  };
  const configDirs = w5a4Drv.rosterConfigDirs(w5a4Drv.readRoster(home).roster, home);
  return { root, home, tree, cwd, rs, db: rs.db, keptBlobId, boundary, ctx: { home, configDirs, budget: { bytes: 0 }, top: root }, uuidOf };
}

/** A file with its parent directories. */
const w5a4Put = (p: string, text: string): void => {
  w5a4Fs.mkdirSync(w5a4Path.dirname(p), { recursive: true });
  w5a4Fs.writeFileSync(p, text);
};
/** W2-D69's tree for a fixture, one fact per file: the cwd's CLAUDE.md (with a relative, a `~`, a directory, a
 *  nobody and a chained mention), the cwd's .claude/CLAUDE.md, the tree's CLAUDE.local.md and a CLAUDE.md that links to
 *  a regular file, gen-a's config-dir CLAUDE.md, a memory file under the cwd's slug in the upstream config dir, the two
 *  imported files, and a six-link import chain. */
function w5a4WriteFiles(fx: W5a4Fixture): void {
  w5a4Put(w5a4Path.join(fx.cwd, 'CLAUDE.md'),
    `# demo\nfact ${W5A4_FACT(10)}\nsee @docs/notes.md and @~/shared/team.md, the folder @docs/ and ask @nobody.\nchain: @chain/d1.md\n`);
  w5a4Put(w5a4Path.join(fx.cwd, '.claude', 'CLAUDE.md'), `fact ${W5A4_FACT(12)}\n`);
  w5a4Put(w5a4Path.join(fx.tree, 'CLAUDE.local.md'), `fact ${W5A4_FACT(11)}\n`);
  w5a4Put(w5a4Path.join(fx.root, 'elsewhere', 'real.md'), `fact ${W5A4_FACT(18)}\n`);
  w5a4Fs.symlinkSync(w5a4Path.join(fx.root, 'elsewhere', 'real.md'), w5a4Path.join(fx.tree, 'CLAUDE.md'));
  w5a4Put(w5a4Path.join(fx.home, '.gen-a', 'CLAUDE.md'), `fact ${W5A4_FACT(13)}\n`);
  w5a4Put(w5a4Path.join(fx.home, '.claude', 'projects', fx.cwd.replace(/[^A-Za-z0-9]/g, '-'), 'memory', 'topic.md'), `fact ${W5A4_FACT(14)}\n`);
  w5a4Put(w5a4Path.join(fx.cwd, 'docs', 'notes.md'), `fact ${W5A4_FACT(15)}\n`);
  w5a4Put(w5a4Path.join(fx.home, 'shared', 'team.md'), `fact ${W5A4_FACT(16)}\n`);
  for (let i = 1; i <= 6; i += 1) w5a4Put(w5a4Path.join(fx.cwd, 'chain', `d${i}.md`), `fact ${W5A4_FACT(20 + i)}\n${i < 6 ? `@d${i + 1}.md\n` : ''}`);
}
const w5a4B = (fx: W5a4Fixture, boundary: W5a4Admission = fx.boundary): W5a4Answer =>
  w5a4Drv.baselineOf(fx.rs as never, boundary, fx.ctx) as unknown as W5a4Answer;
function w5a4Built(fx: W5a4Fixture): Extract<W5a4Answer, { state: 'built' }> {
  const b = w5a4B(fx);
  if (b.state !== 'built') throw new Error(`B was not built: ${JSON.stringify(b)}`);
  return b;
}
const w5a4Admitted = (kind: 'sha' | 'command', F: string, text: string): boolean =>
  w5a4Gate.admitFact(kind, F, text, '', { repoRoots: [] }).admitted;

describe('W2-5a Task 4: Baseline B parts 1 to 3, W2-D68', () => {
  it('B is built for the row admitStoreBoundaries admits, read in place of a hand-made row', () => {
    const fx = w5a4Fixture();
    const rows = w5a4Drv.admitStoreBoundaries(fx.rs as never).boundaries as unknown as W5a4Admission[];
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.admitted, JSON.stringify(row)).toBe(true);
    const pick = (r: W5a4Admission) => [r.entry_id, r.uuid, r.transcript_pk, r.file_id, r.boundary_index, r.summary_index, r.summary_entry_id];
    expect(pick(row)).toEqual(pick(fx.boundary));
    const viaTask3 = w5a4B(fx, row);
    expect(viaTask3.state).toBe('built');
    expect((viaTask3 as { text: string }).text).toBe(w5a4Built(fx).text);
  });

  it('part 1 is the summary row whole, its pointer line kept', () => {
    const b = w5a4Built(w5a4Fixture());
    expect(w5a4Admitted('sha', W5A4_FACT(1), b.text), 'the summary text').toBe(false);
    expect(w5a4Admitted('sha', W5A4_FACT(2), b.text), 'the transcript-pointer line: B keeps it, only the payload removes it').toBe(false);
  });

  it('part 2 is every kept member in the store, its primary and every variant', () => {
    const b = w5a4Built(w5a4Fixture());
    expect(w5a4Admitted('sha', W5A4_FACT(3), b.text), 'a kept tool_result').toBe(false);
    expect(w5a4Admitted('sha', W5A4_FACT(5), b.text), 'only in a ccd-sanitize variant').toBe(false);
    expect(w5a4Admitted('sha', W5A4_FACT(6), b.text), 'only in a variant of another cause: expand would not pick it, B reads it').toBe(false);
    expect(w5a4Admitted('sha', W5A4_FACT(7), b.text), 'only in a post-summary kept member').toBe(false);
    // CONTROL: a row of leaf N's span outside kept(N) is not in B, so B is not the whole copy.
    expect(w5a4Admitted('sha', W5A4_FACT(4), b.text)).toBe(true);
  });

  it('W2-D74: a fact only in the sanitised body, the primary expand passes over, is rejected by B (R7)', () => {
    const a1 = w5a4Rows().find((r) => r.key === 'a1')!;
    const primary = [{ type: 'text', text: `the sanitised primary ${W5A4_FACT(42)}` }, ...(a1.body as unknown[]).slice(1)];
    const b = w5a4Built(w5a4Fixture({ rows: w5a4With('a1', { body: primary }) }));
    expect(w5a4Admitted('sha', W5A4_FACT(42), b.text)).toBe(false);
    // CONTROL: no variant holds it, so only B's reading of the primary rejects it.
    expect(a1.variants!.some((v) => JSON.stringify(v.body).includes(W5A4_FACT(42)))).toBe(false);
  });

  it('both renderings: a short quoted command in a kept tool_use and a fact only in a tool_use key are not admitted', () => {
    const b = w5a4Built(w5a4Fixture());
    expect(w5a4Admitted('command', W5A4_QUOTED, b.text), 'W2-D61: the string leaf holds it whole').toBe(false);
    expect(w5a4Admitted('sha', W5A4_FACT(9), b.text), 'renderEntryText keeps an input key; the leaves do not').toBe(false);
    // CONTROL: each rendering alone misses one of them, so neither half is redundant.
    const bash = [{ type: 'tool_use', id: 'toolu_k1', name: 'Bash', input: { command: W5A4_QUOTED } }];
    expect(w5a4Admitted('command', W5A4_QUOTED, w5a4Lib.renderEntryText(bash))).toBe(true);
    const keyed = [{ type: 'tool_use', id: 'toolu_k2', name: 'Edit', input: { [W5A4_FACT(9)]: true } }];
    expect(w5a4Admitted('sha', W5A4_FACT(9), w5a4Lib.ftsTextOf(keyed, 'entry'))).toBe(true);
  });

  it('part 3 takes the rows after the summary to the first operator row, the served card included', () => {
    const b = w5a4Built(w5a4Fixture());
    expect(w5a4Admitted('command', W5A4_CARD_CMD, b.text), 'the served card: its string leaves hold the quoted command').toBe(false);
    expect(w5a4Admitted('sha', W5A4_FACT(8), b.text), 'a harness row before the stop').toBe(false);
    expect(b.postRows).toBe(2);
    // CONTROL: the row after the operator's next prompt is not in B.
    expect(w5a4Admitted('sha', W5A4_FACT(30), b.text)).toBe(true);
    // CONTROL: the card's JSON rendering escapes its quotes, and ftsTextOf reads nothing of an object, so the object's
    // string leaves are what reject it (D-6279).
    const card = { type: 'hook_additional_context', content: [`History: node L1a2b3c4 ran ${W5A4_CARD_CMD}`] };
    expect(w5a4Admitted('command', W5A4_CARD_CMD, w5a4Lib.renderEntryText(card))).toBe(true);
    expect(w5a4Lib.ftsTextOf(card, 'entry')).toBe('');
  });

  it('a kept member after the summary is never the stop, and an assistant row that is not kept is', () => {
    // a3, a kept assistant row between the summary and the card, is part 2's, so the card is still read
    // (D-6278).
    const b = w5a4Built(w5a4Fixture());
    expect(w5a4Admitted('sha', W5A4_FACT(7), b.text)).toBe(false);
    expect(w5a4Admitted('command', W5A4_CARD_CMD, b.text)).toBe(false);
    // CONTROL: with a3 outside kept(N) it is the first assistant row after the summary, the stop, so neither it nor the
    // card is in B.
    const c = w5a4Built(w5a4Fixture({ kept: ['a1', 'r1', 'a2'] }));
    expect(w5a4Admitted('sha', W5A4_FACT(7), c.text)).toBe(true);
    expect(w5a4Admitted('command', W5A4_CARD_CMD, c.text)).toBe(true);
    expect(c.postRows).toBe(0);
  });

  it('kept members come in holding-copy order, absent ones are counted, and the run budget is charged', () => {
    const rows: W5a4Row[] = [...w5a4Rows(), { key: 'x', type: 'user', provenance: 'tool', held: false,
      body: [{ type: 'tool_result', tool_use_id: 'toolu_x', content: `elsewhere ${W5A4_FACT(31)}` }] }];
    const fx = w5a4Fixture({ rows, kept: ['x', 'a3', 'a2', 'r1', 'a1'], keptExtra: [W5A4_UUID(0xdead), W5A4_UUID(0xbeef)] });
    const b = w5a4Built(fx);
    expect([b.keptMembers, b.keptAbsent]).toEqual([5, 2]);
    const at = (n: number): number => b.text.indexOf(W5A4_FACT(n));
    expect(at(5)).toBeGreaterThan(-1);
    expect(at(5) < at(3) && at(3) < at(7) && at(7) < at(31), 'held members by line (a1, r1, a3), then the unheld one').toBe(true);
    expect(b.bytes).toBe(Buffer.byteLength(b.text, 'utf8'));
    expect(fx.ctx.budget.bytes, 'every blob B read was charged to the run budget').toBeGreaterThan(0);
  });
});

describe('W2-5a Task 4: B fails closed, W2-D68', () => {
  it('a NULL kept id discards as kept-absent', () => {
    expect(w5a4B(w5a4Fixture({ kept: null }))).toEqual({ state: 'discard', why: 'kept-absent' });
  });

  it('a tombstoned kept blob discards as kept-unreadable, never an empty B', () => {
    const fx = w5a4Fixture({ kept: 'tombstone' });
    expect(w5a4B(fx)).toEqual({ state: 'discard', why: 'kept-unreadable' });
    // CONTROL, the reason for Task 1's keptOf scan (W2-D33): derive.mjs's kept-set reader answers an empty set for this
    // same blob, which a B built on it would read as "nothing was kept".
    expect(w5a4Derive.keptOf(w5a4Derive.blobReadStmts(fx.db), fx.keptBlobId, { bytes: 0 }).size).toBe(0);
  });

  it('a kept body that is not an array of strings discards as kept-unreadable', () => {
    expect(w5a4B(w5a4Fixture({ kept: 'object' }))).toEqual({ state: 'discard', why: 'kept-unreadable' });
    expect(w5a4B(w5a4Fixture({ kept: 'non-string' }))).toEqual({ state: 'discard', why: 'kept-unreadable' });
  });

  it('an empty kept list is an empty part 2, not a discard', () => {
    const b = w5a4Built(w5a4Fixture({ kept: [] }));
    expect([b.keptMembers, b.keptAbsent]).toEqual([0, 0]);
    expect(w5a4Admitted('sha', W5A4_FACT(3), b.text)).toBe(true);
  });

  it('a kept member whose primary or a variant is pruned or over the decode cap discards', () => {
    const a1 = w5a4Rows().find((r) => r.key === 'a1')!;
    for (const rows of [
      w5a4With('a1', { stored: 'tombstone' }),
      w5a4With('a1', { stored: 'over-cap' }),
      w5a4With('a1', { variants: [{ ...a1.variants![0]!, stored: 'tombstone' }, a1.variants![1]!] }),
    ]) expect(w5a4B(w5a4Fixture({ rows }))).toEqual({ state: 'discard', why: 'kept-member-unreadable' });
  });

  it('a summary that cannot be read is summary-unreadable, a copy that moved is copy-moved, and a row not admitted throws', () => {
    expect(w5a4B(w5a4Fixture({ rows: w5a4With('summary', { stored: 'tombstone' }) }))).toEqual({ state: 'discard', why: 'summary-unreadable' });
    const fx = w5a4Fixture();
    expect(w5a4B(fx, { ...fx.boundary, boundary_index: fx.boundary.boundary_index! + 1 })).toEqual({ state: 'discard', why: 'copy-moved' });
    expect(w5a4B(fx, { ...fx.boundary, summary_index: 999 })).toEqual({ state: 'discard', why: 'copy-moved' });
    expect(() => w5a4B(fx, { ...fx.boundary, admitted: false, reason: 'after-other' })).toThrow(TypeError);
  });

  it('a post-summary row that cannot be read discards; a row after the stop is never read', () => {
    expect(w5a4B(w5a4Fixture({ rows: w5a4With('sys', { stored: 'tombstone' }) }))).toEqual({ state: 'discard', why: 'post-row-unreadable' });
    // CONTROL: the same damage after the operator's next prompt is never read.
    expect(w5a4B(w5a4Fixture({ rows: w5a4With('late', { stored: 'tombstone' }) })).state).toBe('built');
  });

  it('B\'s discard words are appended to RECON_DISCARDS after Task 3\'s, each once (R5)', () => {
    expect(w5a4Drv.RECON_DISCARDS.slice(24, 35)).toEqual(['copy-moved', 'summary-unreadable', 'kept-member-unreadable', 'post-row-unreadable',
      'post-over-cap', 'cwd-unknown', 'cwd-missing', 'cwd-unreadable', 'file-unreadable', 'file-not-regular', 'file-over-cap']);
    expect(w5a4Drv.RECON_DISCARDS, 'kept-absent and kept-unreadable are Task 1\'s').toEqual(expect.arrayContaining(['kept-absent', 'kept-unreadable']));
    expect(new Set(w5a4Drv.RECON_DISCARDS).size).toBe(w5a4Drv.RECON_DISCARDS.length);
  });

  it('more than 200 post-summary rows discard as post-over-cap; 200 do not', () => {
    const many = (n: number): W5a4Row[] => [
      ...w5a4Rows().slice(0, 6),
      ...Array.from({ length: n }, (_, i): W5a4Row => ({ key: `h${i}`, type: 'system', provenance: 'harness', body: `notice ${i}` })),
      { key: 'op2', type: 'user', provenance: 'operator', body: 'the next prompt' },
    ];
    expect(w5a4Built(w5a4Fixture({ rows: many(200), kept: ['a1', 'r1', 'a2'] })).postRows).toBe(200);
    expect(w5a4B(w5a4Fixture({ rows: many(201), kept: ['a1', 'r1', 'a2'] }))).toEqual({ state: 'discard', why: 'post-over-cap' });
  });
});

describe('W2-5a Task 4: B fails closed on a body that cannot be rendered, D-6304', () => {
  /** A fixture whose row `key` stores an object nested `depth` deep. It parses, and lib's renderEntryText throws a
   *  RangeError on it from about 4,500 levels. Built at runtime: the blob is written raw, because JSON.stringify of the
   *  nested value would throw in the fixture itself. */
  const nested = (key: string, depth: number): W5a4Fixture => {
    const fx = w5a4Fixture();
    fx.rs.close();
    const w = w5a4St.openWriter(w5a4Lib.historyPaths(fx.home).dbFile);
    const row = w.prepare('SELECT blob_id FROM entries WHERE uuid = ?').get(fx.uuidOf(key)) as { blob_id: number };
    const raw = Buffer.from(`${'{"a":'.repeat(depth)}"x"${'}'.repeat(depth)}`, 'utf8');
    w.prepare('UPDATE blobs SET z = ?, raw_len = ? WHERE blob_id = ?').run(w5a4St.brotli(raw), raw.length, Number(row.blob_id));
    w5a4St.closeWriter(w);
    const rs = w5a4Drv.openReplayStore(fx.home) as unknown as W5a4Rs;
    w5a4Open.push(rs);
    return { ...fx, rs, db: rs.db };
  };

  it.each([['summary', 'the summary row (part 1)'], ['a3', 'a kept member (part 2)'], ['card', 'a post-summary row (part 3)']])(
    '%s: a body nested 5,000 deep discards body-unrenderable, and 4,000 deep builds B (%s)', (key) => {
      expect(w5a4B(nested(key, 5000))).toEqual({ state: 'discard', why: 'body-unrenderable' });
      // CONTROL: the same row 4,000 deep renders, so the discard is the depth and not the fixture.
      expect(w5a4B(nested(key, 4000)).state).toBe('built');
    });

  it('body-unrenderable is an existing RECON_DISCARDS word, and no word was added for it', () => {
    expect(w5a4Drv.RECON_DISCARDS).toContain('body-unrenderable');
    expect(w5a4Drv.RECON_DISCARDS.at(-1)).toBe('body-unrenderable');
    expect(w5a4Drv.RECON_DISCARDS).toHaveLength(35 + 1);
  });
});

describe('W2-5a Task 4: B is held in memory only, W2-D68 and W2-D33', () => {
  /** What the default fixture plants in B, as the seven-character variant W2-D62 tests, and the two commands. */
  const IN_B = [1, 2, 3, 5, 6, 7, 8, 9].map((n) => W5A4_FACT(n).slice(0, 7));
  const leaks = (text: string): string[] => [...IN_B, W5A4_QUOTED, W5A4_CARD_CMD].filter((s) => text.includes(s));
  const refusal = (fn: () => unknown): { word: string; detail: string } | null => {
    try { fn(); return null; } catch (e) { if (e instanceof DriverRefusal) return { word: e.word, detail: e.detail }; throw e; }
  };
  const byUuid = (a: { boundary_uuid: string }, b: { boundary_uuid: string }): number =>
    (a.boundary_uuid < b.boundary_uuid ? -1 : a.boundary_uuid > b.boundary_uuid ? 1 : 0);

  it('its text is not enumerable, so no serialiser or inspector carries it', () => {
    const fx = w5a4Fixture();
    const spies = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m));
    const b = w5a4Built(fx);
    const calls = spies.map((s) => s.mock.calls.length);
    for (const s of spies) s.mockRestore();
    expect(calls, 'B is never logged').toEqual([0, 0, 0, 0]);
    expect(leaks(b.text), 'CONTROL: the text holds every planted fact').toHaveLength(IN_B.length + 2);
    expect(Object.keys(b)).not.toContain('text');
    expect(Object.isFrozen(b)).toBe(true);
    for (const [how, s] of [['JSON.stringify', JSON.stringify(b)], ['canonicalJson', w5a4Lib.canonicalJson(b)], ['inspect', w5a4Inspect(b, { depth: 8 })]] as const) {
      expect(leaks(s), how).toEqual([]);
    }
  });

  it('the baseline record carries counts only, and a scan of --out finds no B text', () => {
    const fx = w5a4Fixture();
    const b = w5a4Built(fx);
    const out = w5a4Drv.prepareOut(w5a4Path.join(fx.root, 'out'));
    const rows = [w5a4Drv.baselineRow(fx.boundary.uuid, b), w5a4Drv.baselineRow(W5A4_UUID(2), { state: 'discard', why: 'kept-absent' })];
    expect(rows[0]).toEqual({ boundary_uuid: fx.boundary.uuid, state: 'built', why: null, bytes: b.bytes, files: 0, kept_members: 4, kept_absent: 0, post_rows: 2 });
    const sha = w5a4Drv.writeBaselineRecord(out, 'quiz', { storeId: 'store-a', rows });
    const file = w5a4Path.join(out, 'quiz', w5a4Drv.BASELINE_RECORD);
    const bytes = w5a4Fs.readFileSync(file);
    expect(bytes.toString('utf8')).toBe(`${w5a4Lib.canonicalJson({
      kind: 'ccrc-history-w2-baseline', v: 1, baseline_files: 'v1', store_id: 'store-a', boundaries: [...rows].sort(byUuid), discards: { 'kept-absent': 1 },
    })}\n`);
    expect(sha).toBe(w5a4Lib.sha256Hex(bytes));
    expect(w5a4Fs.statSync(file).mode & 0o777).toBe(0o600);
    // The scan: every file under --out, read whole, holds nothing B holds (the CONTROL is the case above: the text does).
    const walk = (dir: string): string[] => w5a4Fs.readdirSync(dir, { withFileTypes: true })
      .flatMap((d) => (d.isDirectory() ? walk(w5a4Path.join(dir, d.name)) : [w5a4Path.join(dir, d.name)]));
    const files = walk(out);
    expect(files).toContain(file);
    for (const f of files) expect(leaks(w5a4Fs.readFileSync(f, 'utf8')), f).toEqual([]);
  });

  it('the record is sorted by boundary and counts each discard word', () => {
    const fx = w5a4Fixture();
    const out = w5a4Drv.prepareOut(w5a4Path.join(fx.root, 'out'));
    const d = (n: number, why: string) => w5a4Drv.baselineRow(W5A4_UUID(n), { state: 'discard', why });
    w5a4Drv.writeBaselineRecord(out, 'pilot', { storeId: 'store-a', rows: [d(3, 'kept-absent'), d(1, 'post-over-cap'), d(2, 'kept-absent')] });
    const rec = JSON.parse(w5a4Fs.readFileSync(w5a4Path.join(out, 'pilot', 'baseline.json'), 'utf8')) as
      { boundaries: Array<{ boundary_uuid: string }>; discards: Record<string, number> };
    expect(rec.boundaries.map((r) => r.boundary_uuid)).toEqual([W5A4_UUID(1), W5A4_UUID(2), W5A4_UUID(3)]);
    expect(rec.discards).toEqual({ 'kept-absent': 2, 'post-over-cap': 1 });
  });

  it('the record refuses a link at its section or its file, and a caller defect throws', () => {
    const fx = w5a4Fixture();
    const rows = [w5a4Drv.baselineRow(W5A4_UUID(1), { state: 'discard', why: 'kept-absent' })];
    const out1 = w5a4Drv.prepareOut(w5a4Path.join(fx.root, 'out1'));
    w5a4Fs.mkdirSync(w5a4Path.join(fx.root, 'elsewhere-dir'));
    w5a4Fs.symlinkSync(w5a4Path.join(fx.root, 'elsewhere-dir'), w5a4Path.join(out1, 'quiz'));
    expect(refusal(() => w5a4Drv.writeBaselineRecord(out1, 'quiz', { storeId: 's', rows }))).toEqual({ word: 'out-refused', detail: 'quiz is not a directory' });
    expect(w5a4Fs.readdirSync(w5a4Path.join(fx.root, 'elsewhere-dir'))).toEqual([]);
    const out2 = w5a4Drv.prepareOut(w5a4Path.join(fx.root, 'out2'));
    w5a4Fs.mkdirSync(w5a4Path.join(out2, 'quiz'));
    w5a4Fs.writeFileSync(w5a4Path.join(fx.root, 'target.json'), 'untouched\n');
    w5a4Fs.symlinkSync(w5a4Path.join(fx.root, 'target.json'), w5a4Path.join(out2, 'quiz', 'baseline.json'));
    expect(refusal(() => w5a4Drv.writeBaselineRecord(out2, 'quiz', { storeId: 's', rows })))
      .toEqual({ word: 'out-refused', detail: 'quiz/baseline.json is not a regular file' });
    expect(w5a4Fs.readFileSync(w5a4Path.join(fx.root, 'target.json'), 'utf8')).toBe('untouched\n');
    expect(() => w5a4Drv.writeBaselineRecord(out2, 'arms', { storeId: 's', rows })).toThrow(TypeError);
    expect(() => w5a4Drv.writeBaselineRecord(out2, 'pilot', { storeId: 's', rows: [rows[0]!, rows[0]!] })).toThrow(TypeError);
  });

  it('BASELINE_FILES_ID is the open record default', () => {
    const rec = w5a4Gate.OPEN_RECORD_V1 as unknown as { draft: { quiz: { fields: { baseline_files: { value: string } } } } };
    expect(w5a4Drv.BASELINE_FILES_ID).toBe(rec.draft.quiz.fields.baseline_files.value);
    expect(w5a4Drv.BASELINE_FILES_ID).toBe('v1');
  });
});

describe('W2-5a Task 4: the baseline files, W2-D69', () => {
  it('a fact in any file of a, b or c is not admitted; a later epoch is not read', () => {
    const fx = w5a4Fixture({ epochs: [{ cwd: 'old' }, { cwd: 'demo' }, { cwd: 'later' }], nSeq: 2 });
    w5a4WriteFiles(fx);
    w5a4Put(w5a4Path.join(fx.tree, 'old', 'CLAUDE.md'), `fact ${W5A4_FACT(17)}\n`);
    w5a4Put(w5a4Path.join(fx.tree, 'later', 'CLAUDE.md'), `fact ${W5A4_FACT(19)}\n`);
    const b = w5a4Built(fx);
    for (const [n, where] of [[10, 'the cwd CLAUDE.md'], [11, 'an ancestor CLAUDE.local.md'], [12, 'the cwd .claude/CLAUDE.md'],
      [13, 'a config dir CLAUDE.md'], [14, 'a memory file under the slug'], [17, 'an earlier epoch cwd'],
      [18, 'a CLAUDE.md that links to a regular file']] as const) {
      expect(w5a4Admitted('sha', W5A4_FACT(n), b.text), where).toBe(false);
    }
    // CONTROL: an epoch after N's is not the family's history up to N.
    expect(w5a4Admitted('sha', W5A4_FACT(19), b.text)).toBe(true);
    // 7 at depth 0 (demo/CLAUDE.md, demo/.claude/CLAUDE.md, tree/CLAUDE.md, tree/CLAUDE.local.md, old/CLAUDE.md,
    // .gen-a/CLAUDE.md, topic.md), 3 at depth 1 (notes.md, team.md, d1.md), d2 to d5.
    expect(b.files).toBe(14);
  });

  it('a fact only in an imported file is not admitted, to depth 5 and no deeper', () => {
    const fx = w5a4Fixture();
    w5a4WriteFiles(fx);
    const b = w5a4Built(fx);
    expect(w5a4Admitted('sha', W5A4_FACT(15), b.text), 'a relative import').toBe(false);
    expect(w5a4Admitted('sha', W5A4_FACT(16), b.text), 'a ~ import, read as HOME').toBe(false);
    for (let depth = 1; depth <= 5; depth += 1) expect(w5a4Admitted('sha', W5A4_FACT(20 + depth), b.text), `depth ${depth}`).toBe(false);
    // CONTROL: the sixth link of the chain is past BASELINE_IMPORT_DEPTH and is never read.
    expect(w5a4Admitted('sha', W5A4_FACT(26), b.text)).toBe(true);
    expect(w5a4Drv.BASELINE_IMPORT_DEPTH).toBe(5);
  });

  it('an absent file is left out, and a mention of a directory or of nothing is not an import', () => {
    expect(w5a4Built(w5a4Fixture()).files).toBe(0);
    const fx = w5a4Fixture();
    w5a4Put(w5a4Path.join(fx.cwd, 'docs', 'keep.txt'), 'not markdown\n');
    w5a4Put(w5a4Path.join(fx.cwd, 'CLAUDE.md'), 'see the folder @docs/ and ask @nobody.\n');
    expect(w5a4Built(fx).files).toBe(1);
  });

  it('a removed worktree discards: N cwd or cwd_real gone is cwd-missing, an unknown one cwd-unknown; an earlier gone cwd is left out', () => {
    const removed = w5a4Fixture();
    w5a4Fs.rmSync(removed.cwd, { recursive: true });
    expect(w5a4B(removed)).toEqual({ state: 'discard', why: 'cwd-missing' });
    expect(w5a4B(w5a4Fixture({ epochs: [{ cwd: 'demo', cwdReal: 'real-gone' }] }))).toEqual({ state: 'discard', why: 'cwd-missing' });
    expect(w5a4B(w5a4Fixture({ epochs: [{ cwd: null }] }))).toEqual({ state: 'discard', why: 'cwd-unknown' });
    // CONTROL: an earlier epoch's removed directory is left out, and its ancestors are still read.
    const earlier = w5a4Fixture({ epochs: [{ cwd: 'gone' }, { cwd: 'demo' }] });
    w5a4Put(w5a4Path.join(earlier.tree, 'CLAUDE.md'), `fact ${W5A4_FACT(40)}\n`);
    expect(w5a4Admitted('sha', W5A4_FACT(40), w5a4Built(earlier).text)).toBe(false);
  });

  it.skipIf(W5A4_ROOT_USER)('an unreadable memory file or memory directory discards as file-unreadable', () => {
    const fx = w5a4Fixture();
    w5a4WriteFiles(fx);
    const memory = w5a4Path.join(fx.home, '.claude', 'projects', fx.cwd.replace(/[^A-Za-z0-9]/g, '-'), 'memory');
    const topic = w5a4Path.join(memory, 'topic.md');
    w5a4Fs.chmodSync(topic, 0o000);
    try {
      expect(w5a4B(fx)).toEqual({ state: 'discard', why: 'file-unreadable' });
    } finally { w5a4Fs.chmodSync(topic, 0o600); }
    w5a4Fs.chmodSync(memory, 0o000);
    try {
      expect(w5a4B(fx)).toEqual({ state: 'discard', why: 'file-unreadable' });
    } finally { w5a4Fs.chmodSync(memory, 0o700); }
    expect(w5a4B(fx).state, 'CONTROL: readable again, B is built').toBe('built');
  });

  it.skipIf(W5A4_ROOT_USER)('an unreadable cwd discards as cwd-unreadable', () => {
    const fx = w5a4Fixture();
    w5a4Fs.chmodSync(fx.tree, 0o600);   // no search permission: the stat of tree/demo fails EACCES
    try {
      expect(w5a4B(fx)).toEqual({ state: 'discard', why: 'cwd-unreadable' });
    } finally { w5a4Fs.chmodSync(fx.tree, 0o700); }
  });

  it('a FIFO or a directory at CLAUDE.md discards as file-not-regular', () => {
    const fifo = w5a4Fixture();
    const mk = spawnSync('mkfifo', [w5a4Path.join(fifo.cwd, 'CLAUDE.md')], { encoding: 'utf8' });
    expect(mk.status, mk.stderr).toBe(0);
    expect(w5a4B(fifo), 'answered from the stat, never a blocking open').toEqual({ state: 'discard', why: 'file-not-regular' });
    const dir = w5a4Fixture();
    w5a4Fs.mkdirSync(w5a4Path.join(dir.cwd, 'CLAUDE.md'));
    expect(w5a4B(dir)).toEqual({ state: 'discard', why: 'file-not-regular' });
  });

  it('a file over 1 MiB discards as file-over-cap; one of exactly 1 MiB is read', () => {
    expect(w5a4Drv.BASELINE_FILE_MAX).toBe(1024 * 1024);
    const over = w5a4Fixture();
    w5a4Put(w5a4Path.join(over.cwd, 'CLAUDE.md'), 'x'.repeat(w5a4Drv.BASELINE_FILE_MAX + 1));
    expect(w5a4B(over)).toEqual({ state: 'discard', why: 'file-over-cap' });
    const at = w5a4Fixture();
    w5a4Put(w5a4Path.join(at.cwd, 'CLAUDE.md'), `${W5A4_FACT(41)}${'x'.repeat(w5a4Drv.BASELINE_FILE_MAX - W5A4_FACT(41).length)}`);
    expect(w5a4Admitted('sha', W5A4_FACT(41), w5a4Built(at).text)).toBe(false);
  });

  it('the ancestor walk reaches the filesystem root by default and stops at top when given', () => {
    const names = (dir: string): string[] => ['CLAUDE.md', 'CLAUDE.local.md', '.claude/CLAUDE.md'].map((n) => w5a4Path.join(dir, n));
    expect(w5a4Drv.baselineCandidates({ cwds: ['/home/u/tree/demo'], configDirs: ['/home/u/.gen-a'] })).toEqual([
      ...names('/home/u/tree/demo'), ...names('/home/u/tree'), ...names('/home/u'), ...names('/home'), ...names('/'),
      '/home/u/.gen-a/CLAUDE.md',
    ]);
    // Each path once: the upstream config dir's CLAUDE.md is also an ancestor's .claude/CLAUDE.md, and is read once.
    expect(w5a4Drv.baselineCandidates({ cwds: ['/home/u/tree/demo'], configDirs: ['/home/u/.claude'] })).toHaveLength(15);
    expect(w5a4Drv.baselineCandidates({ cwds: ['/home/u/tree/demo'], configDirs: [], top: '/home/u/tree' }))
      .toEqual([...names('/home/u/tree/demo'), ...names('/home/u/tree')]);
    expect(w5a4Drv.BASELINE_NAMES).toEqual(['CLAUDE.md', 'CLAUDE.local.md', '.claude/CLAUDE.md']);
  });
});
```

`afterEach`, `vi`, `spawnSync`, `DriverRefusal`, `REPO`, `writeRoster`, `FIXTURE_ACCOUNTS` and `W5A3_CLAUDE` are the file's existing module-level bindings. The first five come from its top import block, `writeRoster` and `FIXTURE_ACCOUNTS` from W2-4 Task 3, and `W5A3_CLAUDE` from Task 3. None is imported again.

- [ ] **Step 3: Run them and see them fail as predicted.** In the foreground, with a timeout of at least 600000 ms:

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-5a Task 4'
```

Expected RED (predicted): `35 failed` (as root, `33 failed | 2 skipped`).
- The fixture builds (Tasks 1 to 3 supply its store opener, `rosterConfigDirs` and `admitStoreBoundaries`), and every case that reads B fails at `w5a4Drv.baselineOf is not a function`.
- The record cases fail at `writeBaselineRecord` or `baselineRow`, `BASELINE_FILES_ID is the open record default` with `expected undefined to be 'v1'`, and `the ancestor walk` at `w5a4Drv.baselineCandidates is not a function`.
- The `RECON_DISCARDS` case fails: `slice(24, 35)` holds only `body-unrenderable`, which is the list's last word since D-6302 (measured over predicted: the slice is not empty).

A count that differs is a fixture or filter error. Fix it before Step 4, never by weakening an assertion.

- [ ] **Step 4: Write the code.** In `deploy/history-replay.mjs`:

(a) In the one `import { … } from '../ccd/history/lib.mjs';` line, add `ftsTextOf` inside the braces, keeping the names in code-unit order. Add no import line and no name to any other statement. In `RECON_DISCARDS`, replace `  'no-epoch', 'ts-null', 'before-other', 'before-unknown', 'after-other', 'after-unknown',` with:

```js
  'no-epoch', 'ts-null', 'before-other', 'before-unknown', 'after-other', 'after-unknown',
  'copy-moved', 'summary-unreadable', 'kept-member-unreadable', 'post-row-unreadable', 'post-over-cap',
  'cwd-unknown', 'cwd-missing', 'cwd-unreadable', 'file-unreadable', 'file-not-regular', 'file-over-cap',
```

(b) In `readPlain` (W2-4's D-5986 section), make four edits. Each replaced line occurs once (Step 1):
- the JSDoc line ` *  @param {string} p  @param {number} cap` becomes ` *  @param {string} p  @param {number} cap  @param {boolean} [follow] W2-D69: follow a link to what it names, as Claude Code reads a CLAUDE.md, still opening nothing but a regular file and never blocking on a FIFO (O_NONBLOCK). Every --out read leaves it false.`;
- `function readPlain(p, cap) {` becomes `function readPlain(p, cap, follow = false) {`;
- `    st = lstatSync(p);` becomes `    st = follow ? statSync(p) : lstatSync(p);`;
- `    fd = openSync(p, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);` becomes `    fd = openSync(p, constants.O_RDONLY | (follow ? 0 : constants.O_NOFOLLOW) | constants.O_NONBLOCK);`.

(c) Insert this section directly above the line `// The entry guard stays the LAST block of this file: a module-level declaration below it would still be uninitialised`:

```js
// ── W2-5a Task 4: Baseline B and its files (W2-D68, W2-D69; spec §10.2 "Baseline B") ──────────────────────────────
// B is what the session still saw after compaction N, so a fact found in it is not "present only before the
// compaction" and is never asked: W2-D62's admitFact tests every variant of F against it. It is the newline-joined
// UNREDACTED text of four parts: (1) the summary row's stored body, whole, its transcript-pointer line kept; (2) every
// kept(N) member present in the store, in holding-copy order, each with its primary body and every entry_variants
// body; (3) the holding copy's rows after the summary row, up to but excluding the first operator-provenance or
// assistant row that is not a kept member, at most BASELINE_POST_ROWS_MAX of them
// (D-6278); (4) the baseline files (W2-D69). Every row of (1)-(3) is in B twice: as lib's renderEntryText, and as its
// plain string leaves, ftsTextOf's, or every string leaf of an object body (D-6279).
// The copy is Task 1's boundaryCopyOf, read again and held to the one admission judged (R3). Every blob B reads goes
// through derive.mjs's bodyOf over Task 1's blobReadStmts (W2-D33), and the kept list is Task 1's keptMembersOf and
// keptRowsOf. derive.mjs's kept-set reader folds a NULL id, a tombstone and a body that is not an array into one empty
// set, which would read as "nothing was kept" and admit facts the session still saw; Task 1's scan keeps it out of
// every deploy/*.mjs (W2-D33).
// B is held in memory only: never written under --out, never logged, never spawned. Its text is a non-enumerable
// property of a frozen answer, so canonicalJson, JSON.stringify and util.inspect never carry it; only counts are
// recorded (baselineRow, writeBaselineRecord). A boundary whose B cannot be built whole is discarded with a
// RECON_DISCARDS word and counted, never read as empty text. W2-D69's files are read through readPlain with links
// followed, as Claude Code follows them: still nothing but a regular file of at most BASELINE_FILE_MAX is opened.

/** The baseline file set this code reads (W2-D69), recorded as the open record's quiz.baseline_files and in the
 *  pilot's `used`. A change to the set is a W2-5a amendment before part 1, under a new id; history-replay.test.ts pins
 *  this id to the open record's default (OPEN_RECORD_V1), as decisions §7 pins CODE_SHA_FILES to GATE_CODE_FILES. */
export const BASELINE_FILES_ID = 'v1';
/** The largest baseline file read (W2-D69): a larger one discards its boundary, `file-over-cap`. */
export const BASELINE_FILE_MAX = 1024 * 1024;
/** The most rows B's part 3 takes (W2-D68): one more discards its boundary, `post-over-cap`. */
export const BASELINE_POST_ROWS_MAX = 200;
/** How deep `@`-imports are followed (W2-D69 (d)): a file of (a)-(c) is depth 0. */
export const BASELINE_IMPORT_DEPTH = 5;
/** The instruction files W2-D69 (a) reads in each listed directory and in each of its ancestors. */
export const BASELINE_NAMES = Object.freeze(['CLAUDE.md', 'CLAUDE.local.md', '.claude/CLAUDE.md']);
/** The --out sections a baseline record is written under (W2-D72's layout). */
export const BASELINE_SECTIONS = Object.freeze(['quiz', 'pilot']);
/** The baseline record's file name in its section. */
export const BASELINE_RECORD = 'baseline.json';
/** The baseline record's kind. */
export const BASELINE_RECORD_KIND = 'ccrc-history-w2-baseline';

/** @typedef {{state: 'built', bytes: number, files: number, keptMembers: number, keptAbsent: number, postRows: number, readonly text: string}} BaselineBuilt */
/** @typedef {{state: 'discard', why: string}} BaselineDiscard */
/** @typedef {BaselineBuilt | BaselineDiscard} BaselineAnswer */
/** An admitted row of Task 3's admitStoreBoundaries, read in part.
 *  @typedef {{entry_id: number, uuid: string, transcript_pk: number, admitted: boolean, file_id: number | null,
 *    boundary_index: number | null, summary_index: number | null, summary_entry_id: number | null}} BaselineBoundary */

/** Why a boundary has no B (W2-D68, W2-D69): a RECON_DISCARDS word (R5), counted in the baseline record, never refused.
 *  `copy-moved`: the holding copy is not the one admission judged (another file, the boundary at another index, or
 *  another summary row; W2-D68's "absent summary row" is Task 3's own `summary-absent` drop, before B). `cwd-unknown`:
 *  N's epoch has no absolute cwd, or no longer answers.
 *  @param {string} why  @returns {BaselineDiscard} */
const blDiscard = (why) => ({ state: 'discard', why });
/** Code-unit order (W2-D18's comparison, never a locale's). */
const blOrder = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const BL_STMTS = new WeakMap();

/** The reads B adds to Task 1's, prepared once per handle, each naming its columns: a member's variants, a transcript's
 *  session uuid and a family's epochs up to N's. The copy, its rows and the kept list are Task 1's readers. */
function blStmts(db) {
  let s = BL_STMTS.get(db);
  if (s !== undefined) return s;
  s = {
    variants: db.prepare('SELECT blob_id FROM entry_variants WHERE entry_id = ? ORDER BY blob_id'),
    transcript: db.prepare('SELECT cc_session_uuid FROM transcripts WHERE transcript_pk = ?'),
    epochs: db.prepare('SELECT seq, cwd, cwd_real FROM epochs WHERE session_pk = ? AND seq <= ? ORDER BY seq'),
  };
  BL_STMTS.set(db, s);
  return s;
}

/** A kept member's blobs (a row of Task 1's keptRowsOf): its primary, then every entry_variants blob but the primary, by
 *  blob id, whatever its cause. */
const blMemberBlobs = (s, m) => [Number(m.blob_id), ...s.variants.all(Number(m.entry_id)).map((v) => Number(v.blob_id)).filter((id) => id !== Number(m.blob_id))];

/** Every string leaf of a value, depth-first in key order, with an explicit stack: an attachment's object can nest. */
function blObjectLeaves(value) {
  const out = [];
  const stack = [value];
  while (stack.length > 0) {
    const v = stack.pop();
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) for (let i = v.length - 1; i >= 0; i -= 1) stack.push(v[i]);
    else if (v !== null && typeof v === 'object') {
      const keys = Object.keys(v);
      for (let i = keys.length - 1; i >= 0; i -= 1) stack.push(v[keys[i]]);
    }
  }
  return out.join('\n');
}

/** A row's plain string leaves (W2-D68's second rendering): ftsTextOf's for a string or a block list; for an object
 *  body (an attachment's, where ftsTextOf answers '') every string leaf (D-6279). */
function blLeaves(body) {
  if (body !== null && typeof body === 'object' && !Array.isArray(body)) return blObjectLeaves(body);
  return ftsTextOf(body, 'entry');
}

/** One row of parts 1-3 in both renderings (W2-D68), or null when renderEntryText cannot render the body: one nested past
 *  V8's JSON.stringify stack parses and then throws a RangeError, which renderOrNull turns into null so the caller fails
 *  closed as `body-unrenderable` (D-6304, as D-6302 and D-6303 rule). The string leaves never throw: blObjectLeaves is
 *  iterative and ftsTextOf is measured fine at every depth.
 *  @returns {string[] | null} */
function blRenderings(body) {
  const rendered = renderOrNull(() => renderEntryText(body));
  return rendered === null ? null : [rendered, blLeaves(body)];
}

/** A built B: its counts enumerable, its text not (W2-D68: never written, logged or spawned), the whole frozen. */
function blHeld(text, counts) {
  const b = { state: 'built', bytes: Buffer.byteLength(text, 'utf8'), ...counts };
  Object.defineProperty(b, 'text', { value: text, enumerable: false });
  return Object.freeze(b);
}

/** Baseline B for one boundary Task 3's admitStoreBoundaries admitted (W2-D68), unredacted, in memory only. The parts
 *  are built in order and the first failure answers `{state: 'discard', why}` with a RECON_DISCARDS word; otherwise
 *  `{state: 'built', bytes, files, keptMembers, keptAbsent, postRows}` with a non-enumerable `text`. `ctx.configDirs` is
 *  Task 2's rosterConfigDirs answer from the run's one roster read (W2-D52); `ctx.budget` is the run's bodyOf byte
 *  budget; `ctx.home` resolves a `~` import; `ctx.top`, which no subcommand passes, is the highest ancestor W2-D69 (a)
 *  walks. A row that is not admitted, or a ctx without configDirs, is a caller defect (TypeError).
 *  @param {ReplayStore} rs Task 1's store
 *  @param {BaselineBoundary} boundary
 *  @param {{home: string, configDirs: readonly string[], budget: {bytes: number}, top?: string}} ctx
 *  @returns {BaselineAnswer} */
export function baselineOf(rs, boundary, ctx) {
  if (boundary.admitted !== true || boundary.file_id === null || boundary.boundary_index === null || boundary.summary_index === null
    || boundary.summary_entry_id === null) {
    throw new TypeError('baselineOf: B is built only for a boundary admitStoreBoundaries admitted');
  }
  if (!Array.isArray(ctx.configDirs)) throw new TypeError("baselineOf: ctx.configDirs is rosterConfigDirs' answer, an array");
  const s = blStmts(rs.db);
  // The copy admission judged, read again through Task 1's one holding-copy reader: the same file, the boundary at its
  // index, and at the summary's index the summary row admission named. Anything else moved: never a guess (R3).
  const copy = boundaryCopyOf(rs, Number(boundary.entry_id));
  const sum = copy.state === 'copy' && copy.summaryIndex !== null ? copy.rows[copy.summaryIndex] : undefined;
  if (copy.state !== 'copy' || copy.fileId !== Number(boundary.file_id) || copy.boundaryIndex !== Number(boundary.boundary_index)
    || copy.summaryIndex !== Number(boundary.summary_index) || sum === undefined || Number(sum.entry_id) !== Number(boundary.summary_entry_id)) return blDiscard('copy-moved');
  const parts = [];
  // (1) the summary row, whole. Its transcript-pointer line stays here; only the payload replaces it (W2-D75).
  const summary = bodyOf(rs.blobs, Number(sum.blob_id), ctx.budget);
  if (summary === null) return blDiscard('summary-unreadable');
  const summaryParts = blRenderings(summary);
  if (summaryParts === null) return blDiscard('body-unrenderable');
  parts.push(...summaryParts);
  // (2) kept(N), through Task 1's kept-list reader with B's budget: every member's primary and every variant.
  const kept = keptMembersOf(rs, copy.boundary, ctx.budget);
  if (kept.state !== 'kept') return kept;
  const members = keptRowsOf(rs, kept.uuids, copy.fileId);
  const keptIds = new Set();
  for (const m of members.rows) {
    keptIds.add(Number(m.entry_id));
    for (const blobId of blMemberBlobs(s, m)) {
      const body = bodyOf(rs.blobs, blobId, ctx.budget);
      if (body === null) return blDiscard('kept-member-unreadable');
      const memberParts = blRenderings(body);
      if (memberParts === null) return blDiscard('body-unrenderable');
      parts.push(...memberParts);
    }
  }
  // (3) the copy's rows after the summary row, to the first operator or assistant row that is not a kept member.
  let postRows = 0;
  let stopped = null;
  for (const r of copy.rows.slice(copy.summaryIndex + 1)) {
    if (keptIds.has(Number(r.entry_id))) continue;   // part 2's row, never the stop (D-6278)
    if (r.type === 'assistant' || r.provenance === 'operator') break;
    postRows += 1;
    if (postRows > BASELINE_POST_ROWS_MAX) { stopped = 'post-over-cap'; break; }
    const body = bodyOf(rs.blobs, Number(r.blob_id), ctx.budget);
    if (body === null) { stopped = 'post-row-unreadable'; break; }
    const rowParts = blRenderings(body);
    if (rowParts === null) { stopped = 'body-unrenderable'; break; }
    parts.push(...rowParts);
  }
  if (stopped !== null) return blDiscard(stopped);
  // (4) the baseline files, over N's epoch as Task 3 found its family (derive.mjs's epochOfUuid).
  const t = s.transcript.get(Number(boundary.transcript_pk));
  const ep = t === undefined ? null : epochOfUuid(rs.db, t.cc_session_uuid);
  if (ep === null) return blDiscard('cwd-unknown');
  const files = baselineFiles({
    home: ctx.home, configDirs: ctx.configDirs, epochs: s.epochs.all(Number(ep.session_pk), Number(ep.seq)),
    epochSeq: Number(ep.seq), top: ctx.top,
  });
  if (files.state === 'discard') return files;
  for (const f of files.files) parts.push(f.text);
  return blHeld(parts.join('\n'), { files: files.files.length, keptMembers: members.rows.length, keptAbsent: members.absent, postRows });
}

/** W2-D69 (a) and (b)'s paths, in reading order, each once: for every listed cwd (code-unit order), BASELINE_NAMES in it
 *  and in each ancestor up to `top` (default: the filesystem root), then CLAUDE.md in every config dir. Pure.
 *  @param {{cwds: readonly string[], configDirs: readonly string[], top?: string}} o  @returns {string[]} */
export function baselineCandidates({ cwds, configDirs, top }) {
  const out = new Set();
  for (const cwd of [...cwds].sort(blOrder)) {
    for (let dir = cwd; ; dir = path.dirname(dir)) {
      for (const name of BASELINE_NAMES) out.add(join(dir, name));
      if (dir === top || dir === path.dirname(dir)) break;
    }
  }
  for (const c of configDirs) out.add(join(c, 'CLAUDE.md'));
  return [...out];
}

/** A directory's state, following links: 'dir'; 'missing' (ENOENT, ENOTDIR, or not a directory); 'unreadable'. */
function blDirState(d) {
  let st;
  try {
    st = statSync(d);
  } catch (e) {
    return e?.code === 'ENOENT' || e?.code === 'ENOTDIR' ? 'missing' : 'unreadable';
  }
  return st.isDirectory() ? 'dir' : 'missing';
}

/** Every `*.md` under a memory directory (W2-D69 (c)): real subdirectories walked, a link never walked as a directory,
 *  names in code-unit order. An absent directory (ENOENT, or a path through a regular file) holds none; any other
 *  failure to list answers null, which discards the boundary, `file-unreadable`. */
function blMemoryFiles(root) {
  const out = [];
  const walk = (dir) => {
    let ents;
    try {
      ents = readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return dir === root && (e?.code === 'ENOENT' || e?.code === 'ENOTDIR');
    }
    for (const d of [...ents].sort((a, b) => blOrder(a.name, b.name))) {
      const p = join(dir, d.name);
      if (d.isDirectory()) {
        if (!walk(p)) return false;
      } else if (d.name.endsWith('.md')) out.push(p);
    }
    return true;
  };
  return walk(root) ? out : null;
}

/** `@`-mentions (W2-D69 (d)): an `@` at the start or after whitespace and the run of non-space after it, trailing
 *  punctuation dropped. `~/` is `home`; anything else resolves against the importing file's directory. Over-reading
 *  only rejects more facts; a mention that names nothing or a directory is left out by blRead. */
const BL_IMPORT_RE = /(?<=^|\s)@(\S+)/g;
const BL_IMPORT_TRAIL = /[.,;:!?)\]}'"`>]+$/;
function blImports(text, file, home) {
  const out = [];
  for (const m of text.matchAll(BL_IMPORT_RE)) {
    const tok = m[1].replace(BL_IMPORT_TRAIL, '');
    if (tok === '' || tok === '~' || tok.includes('\0')) continue;
    out.push(tok.startsWith('~/') ? join(home, tok.slice(2)) : path.resolve(path.dirname(file), tok));
  }
  return out;
}

/** One baseline file through readPlain, links followed (W2-D69). `absent` leaves it out: nothing there, or a path
 *  through a regular file (ENOTDIR); for an `@`-import also a directory or a name too long to be a path, since such a
 *  mention is not an import. Anything else that is not a regular file of at most BASELINE_FILE_MAX discards. */
function blRead(p, imported) {
  const r = readPlain(p, BASELINE_FILE_MAX, true);
  if (r.state !== 'bad') return r;
  if (r.why === 'unreadable' && (r.code === 'ENOTDIR' || (imported && r.code === 'ENAMETOOLONG'))) return { state: 'absent' };
  if (imported && r.why === 'not-regular' && blDirState(p) === 'dir') return { state: 'absent' };
  if (r.why === 'over-cap') return blDiscard('file-over-cap');
  if (r.why === 'not-regular') return blDiscard('file-not-regular');
  return blDiscard('file-unreadable');
}

/** W2-D69's files for boundary N, read whole. `epochs` are the family's epochs up to and including N's ({seq, cwd,
 *  cwd_real}), `epochSeq` N's. N's cwd must be known and absolute (`cwd-unknown`), and it and N's cwd_real must exist as
 *  directories (`cwd-missing`, `cwd-unreadable`). Then every candidate (baselineCandidates over the distinct absolute
 *  cwd and cwd_real values), every `*.md` under `<config dir>/projects/<projectSlugOf(cwd)>/memory/` for each config dir
 *  and listed cwd, then their `@`-imports breadth-first to BASELINE_IMPORT_DEPTH, `~` read as `home`, each path once.
 *  An absent file is left out; any other failure discards (blRead).
 *  @param {{home: string, configDirs: readonly string[], epochs: ReadonlyArray<{seq: number, cwd: string | null, cwd_real: string | null}>, epochSeq: number, top?: string}} o
 *  @returns {{state: 'files', files: Array<{path: string, text: string}>} | BaselineDiscard} */
export function baselineFiles({ home, configDirs, epochs, epochSeq, top }) {
  const n = epochs.find((e) => Number(e.seq) === epochSeq);
  if (n === undefined) return blDiscard('cwd-unknown');
  const nDirs = [n.cwd, n.cwd_real].filter((d) => d !== null);
  if (typeof n.cwd !== 'string' || !nDirs.every((d) => typeof d === 'string' && path.isAbsolute(d))) return blDiscard('cwd-unknown');
  for (const d of nDirs) {
    const st = blDirState(d);
    if (st === 'missing') return blDiscard('cwd-missing');
    if (st === 'unreadable') return blDiscard('cwd-unreadable');
  }
  const cwds = [...new Set(epochs.flatMap((e) => [e.cwd, e.cwd_real]).filter((d) => typeof d === 'string' && path.isAbsolute(d)))].sort(blOrder);
  const roots = baselineCandidates({ cwds, configDirs, top });
  for (const c of configDirs) {
    for (const cwd of cwds) {
      const listed = blMemoryFiles(join(c, 'projects', projectSlugOf(cwd), 'memory'));
      if (listed === null) return blDiscard('file-unreadable');
      roots.push(...listed);
    }
  }
  const seen = new Set();
  const files = [];
  let frontier = roots.map((p) => ({ p, depth: 0 }));
  while (frontier.length > 0) {
    const next = [];
    for (const { p, depth } of frontier) {
      if (seen.has(p)) continue;
      seen.add(p);
      const r = blRead(p, depth > 0);
      if (r.state === 'absent') continue;
      if (r.state === 'discard') return r;
      const text = r.bytes.toString('utf8');
      files.push({ path: p, text });
      if (depth < BASELINE_IMPORT_DEPTH) for (const q of blImports(text, p, home)) next.push({ p: q, depth: depth + 1 });
    }
    frontier = next;
  }
  return { state: 'files', files };
}

/** One boundary's line in the baseline record: counts and the discard word, never B's text (W2-D68).
 *  @param {string} boundaryUuid  @param {BaselineAnswer} b */
export function baselineRow(boundaryUuid, b) {
  if (b.state === 'built') {
    return { boundary_uuid: boundaryUuid, state: 'built', why: null, bytes: b.bytes, files: b.files, kept_members: b.keptMembers,
      kept_absent: b.keptAbsent, post_rows: b.postRows };
  }
  return { boundary_uuid: boundaryUuid, state: 'discard', why: b.why, bytes: null, files: null, kept_members: null, kept_absent: null,
    post_rows: null };
}

/** `<out>/<section>/baseline.json` (0600), the run's baseline record: exactly the bytes of canonicalJson({kind, v: 1,
 *  baseline_files, store_id, boundaries, discards}) and one newline, `boundaries` sorted by boundary_uuid (code unit) and
 *  `discards` counting each word. Written through ensurePlainDir and writePlain (D-5986: a link or a non-directory at the
 *  section, or a non-regular file at the record, refuses out-refused), and answered as the sha256 of the bytes on disk.
 *  A section outside BASELINE_SECTIONS, or one boundary twice, is a caller defect (TypeError). The pilot's per-boundary
 *  file counts are read from this record (W2-D69).
 *  @param {string} out  @param {string} section
 *  @param {{storeId: string, rows: ReadonlyArray<ReturnType<typeof baselineRow>>}} o  @returns {string} */
export function writeBaselineRecord(out, section, { storeId, rows }) {
  if (!BASELINE_SECTIONS.includes(section)) {
    throw new TypeError(`writeBaselineRecord: section ${JSON.stringify(section)} is not one of ${BASELINE_SECTIONS.join(', ')}`);
  }
  const sorted = [...rows].sort((a, b) => blOrder(a.boundary_uuid, b.boundary_uuid));
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].boundary_uuid === sorted[i - 1].boundary_uuid) throw new TypeError(`writeBaselineRecord: boundary ${sorted[i].boundary_uuid} twice`);
  }
  const discards = {};
  for (const r of sorted) if (r.state === 'discard') discards[r.why] = (discards[r.why] ?? 0) + 1;
  const rel = `${section}/${BASELINE_RECORD}`;
  ensurePlainDir(out, section);
  writePlain(out, rel, `${canonicalJson({ kind: BASELINE_RECORD_KIND, v: 1, baseline_files: BASELINE_FILES_ID, store_id: storeId, boundaries: sorted, discards })}\n`);
  return shaOfPlain(out, rel);
}
```

Then check, from the repository root:
- `node --check deploy/history-replay.mjs` prints nothing;
- `grep -vE '^\s*(//|\*|/\*)' deploy/history-replay.mjs | grep -cE '\bkeptOf\b'` prints 0 (code lines only, as Task 1's scan reads them; Task 1's section header comment is the one comment that names it);
- `grep -cE "(['\"\`])node:sqlite\1" deploy/history-replay.mjs` prints 0. No JSDoc here quotes the module: the store is Task 1's `ReplayStore`;
- `grep -nE '\.mjs:[0-9]' deploy/history-replay.mjs` shows no line this task added (D-5893's citations ratchet);
- `grep -c '^if (process.argv\[1\] && import.meta.url' deploy/history-replay.mjs` prints 1, and the guard is still the last block.

- [ ] **Step 5: Run them and see them pass, then the whole file and the typecheck.** In the foreground, with a timeout of at least 600000 ms:

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-5a Task 4'
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts
cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit
```

Expected:
- The filtered run is green: `35 passed` (as root, `33 passed | 2 skipped`: the two permission cases).
- The whole file is green. That includes W2-4's D-5986 cases, which pin `readPlain`'s two-argument behaviour unchanged; Task 1's import pin, unchanged, because no import line or pinned name was added; Task 1's `keptOf` scan; and W2-4 Task 1's `node:sqlite` scan.
- tsc prints nothing. A line naming only `agent/src/` or a module that is not installed comes from the worktree's install. A line naming `history-replay` is this task's.

- [ ] **Step 6: Measure every guard red, then green.** From the repository root. Each block applies one exact replacement, asserted to match once, runs one filter, shows it red, and restores the file. The python bodies are quoted heredocs.

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w2-5a/scratch"; mkdir -p "$SCRATCH"
mut() {   # mut <file> <old> <new>: one exact replacement, asserted to match once
  python3 - "$1" "$2" "$3" <<'EOF'
import sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
assert s.count(old) == 1, (p, old, s.count(old))
open(p, 'w').write(s.replace(old, new))
EOF
}
cp deploy/history-replay.mjs "$SCRATCH/driver.orig"
t4run() { (cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t "$1"); cp "$SCRATCH/driver.orig" deploy/history-replay.mjs; }

# M1 (W2-D68, W2-D33): the kept list read through derive.mjs's kept-set reader, its NULL check gone with it (Task 1's
# keptMembersOf, which B reads).
python3 - deploy/history-replay.mjs <<'EOF'
import re, sys
p = sys.argv[1]; s = open(p).read()
imp = re.findall(r"^import \{ [^}]*\} from '\.\./ccd/history/derive\.mjs';$", s, re.M)
assert len(imp) == 1, imp
s = s.replace(imp[0], imp[0].replace('import { ', 'import { keptOf, ', 1))
old = "  if (boundary.kept_blob_id === null) return reconDiscard('kept-absent');\n  const v = bodyOf(rs.blobs, boundary.kept_blob_id, budget);"
assert s.count(old) == 1
s = s.replace(old, "  const v = [...keptOf(rs.blobs, boundary.kept_blob_id, budget)];")
open(p, 'w').write(s)
EOF
t4run 'NULL kept id|tombstoned kept blob'
# Expected RED (predicted): 3 failed (measured over predicted 2). A NULL id and a tombstone both build B, with
# { state: 'built', … } where { state: 'discard', why: 'kept-absent' } (or 'kept-unreadable') was expected. The third is
# Task 1's case 'kept(N) through bodyOf, never keptOf …', which the filter's 'tombstoned kept blob' also selects. (Task 1's
# keptOf scan reds too, outside this filter.)

# M2 (W2-D68 (2)): the primary only, no variant.
mut deploy/history-replay.mjs "const blMemberBlobs = (s, m) => [Number(m.blob_id), ...s.variants.all(Number(m.entry_id)).map((v) => Number(v.blob_id)).filter((id) => id !== Number(m.blob_id))];" "const blMemberBlobs = (s, m) => [Number(m.blob_id)];"
t4run 'part 2 is every kept member'
# Expected RED (predicted): 1 failed, only in a ccd-sanitize variant: expected true to be false.

# M3 (W2-D68 (2)): the variants as expand picks them, ccd-sanitize only.
mut deploy/history-replay.mjs "variants: db.prepare('SELECT blob_id FROM entry_variants WHERE entry_id = ? ORDER BY blob_id')," "variants: db.prepare(\"SELECT blob_id FROM entry_variants WHERE entry_id = ? AND cause = 'ccd-sanitize' ORDER BY blob_id\"),"
t4run 'part 2 is every kept member'
# Expected RED (predicted): 1 failed, only in a variant of another cause: expected true to be false.

# M4 (W2-D68 (2)): kept(N) left out of B.
mut deploy/history-replay.mjs "  for (const m of members.rows) {" "  for (const m of []) {"
t4run 'part 2 is every kept member|both renderings'
# Expected RED (predicted): 2 failed, a kept tool_result: expected true to be false; W2-D61: expected true to be false.

# M5 (W2-D68, both renderings): the string leaves dropped.
mut deploy/history-replay.mjs "  return rendered === null ? null : [rendered, blLeaves(body)];" "  return rendered === null ? null : [rendered];"
t4run 'both renderings|part 3 takes the rows'
# Expected RED (predicted): 2 failed, the quoted command and the card's command admitted: expected true to be false.

# M6 (D-6279): an object body read by ftsTextOf alone.
mut deploy/history-replay.mjs "  if (body !== null && typeof body === 'object' && !Array.isArray(body)) return blObjectLeaves(body);
" ""
t4run 'part 3 takes the rows'
# Expected RED (predicted): 1 failed, the served card: expected true to be false.

# M7 (W2-D68, both renderings): renderEntryText dropped.
mut deploy/history-replay.mjs "  return rendered === null ? null : [rendered, blLeaves(body)];" "  return rendered === null ? null : [blLeaves(body)];"
t4run 'both renderings'
# Expected RED (predicted): 1 failed, renderEntryText keeps an input key: expected true to be false.

# M8 (W2-D68 (3)): no stop, every later row read.
mut deploy/history-replay.mjs "    if (r.type === 'assistant' || r.provenance === 'operator') break;
" ""
t4run 'part 3 takes the rows|never the stop|after the stop is never read'
# Expected RED (predicted): 3 failed. 'part 3 takes the rows': the later row's fact rejected (expected false to be true).
# 'never the stop', its CONTROL: a3 no longer stops. 'a row after the stop is never read', its CONTROL: the tombstoned
# late row is read, post-row-unreadable.

# M9 (D-6278): a kept member after the summary is the stop, as W2-D68 reads literally.
mut deploy/history-replay.mjs "    if (keptIds.has(Number(r.entry_id))) continue;   // part 2's row, never the stop (D-6278)
" ""
t4run 'never the stop|part 3 takes the rows'
# Expected RED (predicted): 2 failed, the card's command admitted: expected true to be false.

# M10 (W2-D68 (3)): the operator row the only stop.
mut deploy/history-replay.mjs "    if (r.type === 'assistant' || r.provenance === 'operator') break;" "    if (r.provenance === 'operator') break;"
t4run 'never the stop'
# Expected RED (predicted): 1 failed, the CONTROL's unkept assistant row read on: expected false to be true.

# M11 (W2-D68 (3)): the 200-row cap off by one.
mut deploy/history-replay.mjs "    if (postRows > BASELINE_POST_ROWS_MAX) { stopped = 'post-over-cap'; break; }" "    if (postRows >= BASELINE_POST_ROWS_MAX) { stopped = 'post-over-cap'; break; }"
t4run '200 do not'
# Expected RED (predicted): 1 failed, B was not built: {"state":"discard","why":"post-over-cap"}.

# M12 (W2-D68 (3)): an unreadable post row skipped.
mut deploy/history-replay.mjs "    if (body === null) { stopped = 'post-row-unreadable'; break; }" "    if (body === null) continue;"
t4run 'cannot be read discards'
# Expected RED (predicted): 1 failed, expected { state: 'built', … } to deeply equal { state: 'discard', why: 'post-row-unreadable' }.

# M13 (W2-D68, fail closed): an unreadable kept member skipped.
mut deploy/history-replay.mjs "      if (body === null) return blDiscard('kept-member-unreadable');" "      if (body === null) continue;"
t4run 'pruned or over the decode cap'
# Expected RED (predicted): 1 failed, expected { state: 'built', … } to deeply equal { state: 'discard', why: 'kept-member-unreadable' }.

# M14 (W2-D68): a kept array with a non-string member tolerated (Task 1's keptMembersOf).
mut deploy/history-replay.mjs "  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) return reconDiscard('kept-unreadable');" "  if (!Array.isArray(v)) return reconDiscard('kept-unreadable');"
t4run 'not an array of strings'
# Expected RED (predicted): 1 failed, the non-string list builds B (its number matches no uuid and is counted absent).

# M15 (W2-D68 (2), order): the kept members out of holding-copy order (Task 1's keptRowsOf).
mut deploy/history-replay.mjs '      ORDER BY m.line IS NULL, m.line, e.entry_id`),' '      ORDER BY e.entry_id DESC`),'
t4run 'holding-copy order'
# Expected RED (predicted): 1 failed, held members by line: expected false to be true.

# M16 (W2-D68 (1), fail closed): an unreadable summary read as empty text.
mut deploy/history-replay.mjs "  if (summary === null) return blDiscard('summary-unreadable');
" ""
t4run 'summary that cannot be read'
# Expected RED (predicted): 1 failed, expected { state: 'built', … } to deeply equal { state: 'discard', why: 'summary-unreadable' }.

# M17 (the copy admission judged): the positions not re-checked.
mut deploy/history-replay.mjs "  if (copy.state !== 'copy' || copy.fileId !== Number(boundary.file_id) || copy.boundaryIndex !== Number(boundary.boundary_index)
    || copy.summaryIndex !== Number(boundary.summary_index) || sum === undefined || Number(sum.entry_id) !== Number(boundary.summary_entry_id)) return blDiscard('copy-moved');" "  if (copy.state !== 'copy' || sum === undefined) return blDiscard('copy-moved');"
t4run 'summary that cannot be read'
# Expected RED (predicted): 1 failed, the shifted boundary_index builds B where copy-moved was expected.

# M18 (W2-D68 (1)): the pointer line dropped from B, as the payload drops it.
mut deploy/history-replay.mjs "  const summaryParts = blRenderings(summary);" "  const summaryParts = blRenderings(String(summary).split('\n').slice(0, -1).join('\n'));"
t4run 'part 1 is the summary row'
# Expected RED (predicted): 1 failed, the transcript-pointer line: expected true to be false.

# M19 (W2-D68): the text enumerable.
mut deploy/history-replay.mjs "  Object.defineProperty(b, 'text', { value: text, enumerable: false });" "  Object.defineProperty(b, 'text', { value: text, enumerable: true });"
t4run 'not enumerable'
# Expected RED (predicted): 1 failed, expected [ 'state', 'bytes', …(6) ] not to include 'text'.

# M20 (W2-D69): links not followed.
mut deploy/history-replay.mjs "    st = follow ? statSync(p) : lstatSync(p);" "    st = lstatSync(p);"
t4run 'any file of a, b or c'
# Expected RED (predicted): 1 failed, B was not built: {"state":"discard","why":"file-not-regular"} (tree/CLAUDE.md is a link).

# M21 (W2-D69 (d)): one import level too many.
mut deploy/history-replay.mjs "      if (depth < BASELINE_IMPORT_DEPTH) for" "      if (depth <= BASELINE_IMPORT_DEPTH) for"
t4run 'to depth 5 and no deeper'
# Expected RED (predicted): 1 failed, the sixth link read: expected false to be true.

# M22 (W2-D69 (d)): one import level too few.
mut deploy/history-replay.mjs "export const BASELINE_IMPORT_DEPTH = 5;" "export const BASELINE_IMPORT_DEPTH = 4;"
t4run 'to depth 5 and no deeper'
# Expected RED (predicted): 1 failed, depth 5: expected true to be false.

# M23 (W2-D69 (d)): a mention of a directory read as an import.
mut deploy/history-replay.mjs "  if (imported && r.why === 'not-regular' && blDirState(p) === 'dir') return { state: 'absent' };
" ""
t4run 'not an import|any file of a, b or c'
# Expected RED (predicted): 2 failed, B was not built: {"state":"discard","why":"file-not-regular"} (@docs/).

# M24 (W2-D69): a removed worktree tolerated.
mut deploy/history-replay.mjs "    if (st === 'missing') return blDiscard('cwd-missing');" "    if (st === 'missing') continue;"
t4run 'removed worktree'
# Expected RED (predicted): 1 failed, expected { state: 'built', … } to deeply equal { state: 'discard', why: 'cwd-missing' }.

# M25 (W2-D69): N's cwd_real not checked.
mut deploy/history-replay.mjs "  const nDirs = [n.cwd, n.cwd_real].filter((d) => d !== null);" "  const nDirs = [n.cwd];"
t4run 'removed worktree'
# Expected RED (predicted): 1 failed, the cwd_real case builds B.

# M26 (W2-D69): an unmeasurable cwd read as present. Skipped as root, so unmeasured there.
mut deploy/history-replay.mjs "    if (st === 'unreadable') return blDiscard('cwd-unreadable');" "    if (st === 'unreadable') continue;"
t4run 'unreadable cwd'
# Expected RED (predicted, non-root): 1 failed, expected { state: 'discard', why: 'file-unreadable' } to deeply equal { …, why: 'cwd-unreadable' }.

# M27 (W2-D69): an unreadable file left out. Skipped as root.
mut deploy/history-replay.mjs "  return blDiscard('file-unreadable');
}" "  return { state: 'absent' };
}"
t4run 'memory file or memory directory'
# Expected RED (predicted, non-root): 1 failed, the mode-000 topic.md builds B.

# M28 (W2-D69): an unlistable memory directory left out. Skipped as root.
mut deploy/history-replay.mjs "      if (listed === null) return blDiscard('file-unreadable');" "      if (listed === null) continue;"
t4run 'memory file or memory directory'
# Expected RED (predicted, non-root): 1 failed, the mode-000 memory directory builds B.

# M29 (W2-D69): a file that is not regular left out.
mut deploy/history-replay.mjs "  if (r.why === 'not-regular') return blDiscard('file-not-regular');" "  if (r.why === 'not-regular') return { state: 'absent' };"
t4run 'FIFO or a directory'
# Expected RED (predicted): 1 failed, expected { state: 'built', … } to deeply equal { state: 'discard', why: 'file-not-regular' }.

# M30 (W2-D69): an over-cap file left out.
mut deploy/history-replay.mjs "  if (r.why === 'over-cap') return blDiscard('file-over-cap');" "  if (r.why === 'over-cap') return { state: 'absent' };"
t4run 'exactly 1 MiB'
# Expected RED (predicted): 1 failed, expected { state: 'built', … } to deeply equal { state: 'discard', why: 'file-over-cap' }.

# M31 (W2-D69 (a)): the epochs after N's read too.
mut deploy/history-replay.mjs "WHERE session_pk = ? AND seq <= ? ORDER BY seq" "WHERE session_pk = ? AND ? > 0 ORDER BY seq"
t4run 'a later epoch is not read'
# Expected RED (predicted): 1 failed, the later epoch's fact rejected: expected false to be true.

# M32 (W2-D69 (a)): the ancestor walk stops short of the filesystem root.
mut deploy/history-replay.mjs "      if (dir === top || dir === path.dirname(dir)) break;" "      if (dir === top || path.dirname(dir) === '/') break;"
t4run 'filesystem root by default'
# Expected RED (predicted): 1 failed, the '/' names missing from the candidates.

# M33 (the record): rows left unsorted.
mut deploy/history-replay.mjs "  const sorted = [...rows].sort((a, b) => blOrder(a.boundary_uuid, b.boundary_uuid));" "  const sorted = [...rows];"
t4run 'counts each discard word'
# Expected RED (predicted): 1 failed, expected [ '…003', '…001', '…002' ] to deeply equal [ '…001', '…002', '…003' ].

# M34 (the record, D-5986): the section made by a plain mkdir that follows a link.
mut deploy/history-replay.mjs "  ensurePlainDir(out, section);" "  mkdirSync(join(out, section), { recursive: true });"
t4run 'refuses a link at its section'
# Expected RED (predicted): 1 failed, the record written through the link into elsewhere-dir: expected null to deeply equal { word: 'out-refused', … }.

# M35 (the parity pin): the id moved without the open record.
mut deploy/history-replay.mjs "export const BASELINE_FILES_ID = 'v1';" "export const BASELINE_FILES_ID = 'v2';"
t4run 'open record default'
# Expected RED (predicted): 1 failed, expected 'v2' to be 'v1'.

# M36 (W2-D74's second pin, R7): the primary passed over, only the variants read, as expand's pick would.
mut deploy/history-replay.mjs "const blMemberBlobs = (s, m) => [Number(m.blob_id), ...s.variants.all(Number(m.entry_id)).map((v) => Number(v.blob_id)).filter((id) => id !== Number(m.blob_id))];" "const blMemberBlobs = (s, m) => s.variants.all(Number(m.entry_id)).map((v) => Number(v.blob_id)).filter((id) => id !== Number(m.blob_id));"
t4run 'only in the sanitised body'
# Expected RED (predicted): 1 failed, the primary's fact admitted: expected true to be false.

cmp deploy/history-replay.mjs "$SCRATCH/driver.orig" && echo restored
git diff --stat -- deploy/history-replay.mjs server/test/history-replay.test.ts
```

Every filter above is a substring of one or more `it` titles in this task's four describes. Each holds no regex metacharacter except a deliberate `|`, and each selects at least one test. M1, M14 and M15 mutate Task 1's kept-list reader, which B reads (R3). Then run Step 5's first two commands once more: green.

- [ ] **Step 7: Run the neighbours that read the driver.** In the foreground, with a timeout of at least 600000 ms. If a file goes red, re-run it alone before calling it a break (CLAUDE.md's load flakes):

```bash
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history'
cd server && ./node_modules/.bin/vitest run test/dtbd.test.ts
cd server && ./node_modules/.bin/vitest run test/citations.test.ts
```

Expected:
- `single-definition` is green. O13 walks `deploy/` and finds no switch name here. O14's `DECL_CORPUS` finds no `VOCABS` name: `RECON_DISCARDS`, `BASELINE_NAMES` and `BASELINE_SECTIONS` are not in that list.
- `dtbd` is green: this task's code comments cite D-6278 and D-6279 by number, each defined in this plan's `## Deviations found`.
- `citations` is green: no line added here cites `file:line`.

- [ ] **Step 8: Commit.**

```bash
git add deploy/history-replay.mjs server/test/history-replay.test.ts
CO_AUTHORED_BY='<the Co-Authored-By line the attribution reminder gives>'
git commit -m "feat(history-replay): Baseline B and its files, held in memory only (W2-5a Task 4; W2-D68, W2-D69, W2-D33; D-6278, D-6279)" -m "$CO_AUTHORED_BY"
```

---


### Task 5: Answerability with its timed clause, the same-millisecond count, and seeded sampling (W2-D70, W2-D34, W2-D71; D-5780)

This task adds the last filters a candidate fact meets before the question writer, the one number the quiz reports about the as-of cut's residual, and the order in which the quiz and the pilot reach candidates. It ships:
- **Answerability (W2-D70).** A candidate is answerable when some source in leaf N's span passes all four clauses. Clause 1: the source is a searchable span row, or a sidecar linked to one, and F_raw occurs verbatim in that blob's index text, recomputed exactly as the sweep's `indexBlob` writes it. Clause 2: the blob is indexed and not pruned. Clause 3: `blobs_fts MATCH ftsPhrase(F_raw)` returns the blob. Clause 4 is **new, and it is D-5780** (`history-w2-answerable-timed`): the source entry's `ts_ms` is non-null and at most T_N, and a sidecar source needs a non-null `entry_id` whose entry passes the same test. `checkSource` checks one source and names the clause it fails, which W2-5b's arm-time re-check reads (W2-D78(iii)(b)). `answerability` finds the first passing source in leaf N's span, and `answerableStage` makes it the `answerable` filter. A candidate that clauses 1 to 3 admit and clause 4 removes is dropped as `unanswerable-untimed`, apart from `unanswerable`, so the cost of D-5780 is counted (W2-D70, section 7). The two words are fact drops, appended to Task 2's `FACT_DROP_REASONS` in place (R5).
- **The same-millisecond count (W2-D34's last bullet).** `asofSameMsHits` counts, per admitted question, the distinct entries whose FTS hits hold F_raw and that are visible under the cut, outside N's holding copy, and stamped exactly T_N. Its scope is the family scope the CLI would search, `familyScopeOf`: recall.mjs's own `familiesOf` and `transcriptsOf`, never a second family rule, pinned with a CONTROL (R6). `sameMsReport` turns it into the after-admission report. The count is reported and never gates.
- **Sampling (W2-D71, as amended after review 664).**
  - `seededOrder`: sort by a stated key, by code unit, then a Fisher–Yates order drawn from the stream (W2-D18's amendment).
  - `quizRng` and `pilotRng`, the record seed's `'quiz-sample'` substream and the pilot seed's `'pilot-sample'` substream; `drawSeedHex`, the pilot's own crypto seed.
  - `quizFamilyOrderKey`, the quiz's per-family order key (W2-D71 as amended in place on 2026-10-22, R10): the `'quiz-sample'` substream's seed, as the gate's `substream` derives it, hashed with the family's `familyKey`. Families sorted by it, by code unit, come in the same order on every node, and a node needs no list of the others' families.
  - `quizPopulation`: the exclusions, pilot families and every (store_id, ccrc_id) holding a control-assigned family at any generation (W2-D77).
  - `sampleQuestions`: families in seeded order, then each family's candidates in seeded order, with the per-family, per-boundary and per-kind caps, the target, and the filters run lazily in `QUIZ_STAGES` order. Each question carries its `rank`, `[family rank, candidate rank]`. By default one stream draws both orders; `candidateRng` gives each family its own candidate stream (`familyRng`), and `familyOrder` replaces the drawn family order with a sort by a per-family key, whose key is then the family rank. With both (the quiz, R10), a family's place and its candidates' ranks are the same on whichever node holds it, so Task 7's `freeze` merges the nodes' lists by rank (R4).
  - `quizFloor`: the halt floor.
  - `sampleFidelityBoundaries`: the pilot's fidelity boundaries, at most one per family (R6).

**What W2-5a may assume about W2-2a, and what it may not.** W2-2a's as-of cut runs alongside this PR in the fleet lane and may merge before or after it. At `cd622b2f6`, lib has none of W2-2a: no `asOfCut`, no SQL predicate fragment, no `rc.scope.cut`, no `asof-invalid`. The only piece of the cut on `main` is W2-1's `stampAtOrBefore`.
- **It may assume:**
  - **W2-D34's rule as ruled text.** An entry outside N's holding copy is visible when its `ts_ms` is non-null and at most T_N, when it is N's boundary or summary entry, or when it is a kept(N) member. Restricted to entries stamped exactly T_N, the first clause alone decides. N's boundary and summary entries are members of the holding copy, so "outside" excludes them. A kept(N) member stamped T_N outside the copy is visible by the first clause anyway. So the count needs no kept(N) read and no cut code: it is `ts_ms = T_N` AND not a member of N's holding file.
  - **T_N is boundary N's own `ts_ms`.** W2-D66's population admits only boundaries with a non-null ts, so `stampAtOrBefore`'s fallback and `asof-invalid` never arise for a boundary this task reaches.
  - **N's holding copy is `lib.pickHoldingCopy`'s answer.** That function is on `main`, and W2-D38's `asOfCut` carries the same `holdingFileId`. The caller passes it from Task 3's admission.
  - **W2-D35's sidecar rule.** A sidecar follows its entry, and one with a NULL `entry_id` is absent.
- **It may not assume:**
  - **any W2-2a name.** It imports none of them, so this PR builds and passes whichever of the two merges first.
  - **that the CLI applies the cut.** No subcommand here spawns an arm. The arms reach the cut only through the CLI (W2-D38), in W2-5b.
  - **that its SQL agrees with lib's predicate.** No pin can tie the two while lib has no predicate. The parity pin is carried to W2-5b (R8). The count reads entries, variants and sidecars only, never nodes, so W2-D35's node cut does not reach it.
  - **D-5766 as its own.** The count is a report and departs from no spec sentence, so D-5766 (`asof-time-cut`) stays W2-2a's to define (its plan, in the same docs PR as this one). This task cites it bare.

**Files:**
- Modify: `deploy/history-replay.mjs`.
  - Add one section directly above the comment line `// The entry guard stays the LAST block of this file`, after Task 4's section.
  - Extend Task 1's import statements, never a second import of a module (R3):
    - `../ccd/history/lib.mjs` gains `SEARCHABLE_PROVENANCE`, `entryIndexText` and `ftsPhrase`;
    - `./history-gate.mjs` gains `ASSIGNMENT_ARMS`, `FACT_KINDS`, `PILOT_SUBSTREAM`, `familyKey`, `randInt` and `substream`;
    - `../ccd/history/recall.mjs` gains `familiesOf as scopeFamiliesOf` and `transcriptsOf` (R6). The alias keeps recall.mjs's family scope apart from Task 7's own `familiesOf(items)`;
    - `ftsTextOfBlob` (sweep.mjs) and `randomBytes` (node:crypto) are already Task 1's imports.
  - Task 2's `FACT_DROP_REASONS` gains, in place after `'baseline-hit'`, `'unanswerable'` and `'unanswerable-untimed'` (R5).
- Modify: `server/test/history-replay.test.ts`.
  - Task 1's `EXACT_NAMES` entry for recall.mjs becomes `'{ expandEntryBody, familiesOf as scopeFamiliesOf, transcriptsOf }'`, in the same commit as the import.
  - Append one describe at the end of the file, with its own import block. Every imported name carries the `w5a5` prefix, because W2-4's tasks already use `t2` to `t9`.
- Not edited: `deploy/history-gate.mjs` (imported only), `ccd/**`, `shared/**`, the spec, README.md, `deploy/measure-history.py`, `.github/**`. No file is created. D-5780's entry is in this plan's `## Deviations found`, written with the plan, and Step 9 checks that it is there once.

**Interfaces:**
- Consumes (base, `ccd/history/lib.mjs`, typed in `lib.d.mts`):
  - `entryIndexText(text, idx): string`;
  - `ftsPhrase(value): string`;
  - recall.mjs's `familiesOf(db, sel)` (with `sel.kind === 'family'`, the family's row-life) and `transcriptsOf(db, sessionPks)` (the confirmed epochs' transcripts that hold rows): the CLI's own family scope (cli.mjs's scope reader calls the same pair);
  - `SEARCHABLE_PROVENANCE` (`['operator','model','tool']`) and, in tests only, `INDEXED_PROVENANCE` (`[...SEARCHABLE_PROVENANCE, 'recall-echo']`);
  - `canonicalJson`, `historyPaths(home).dbFile`, `makePairIndex(pairs)` and `SIDECAR_FTS_BYTES` (524,288);
  - `sha256Hex(data)`, already in the driver's lib statement since W2-4, for `quizFamilyOrderKey` (R10).
- Consumes (base, `ccd/history/sweep.mjs`, already exported before W2-1):
  - `ftsTextOfBlob(z, isSidecar, pairIdx, rawLen): Promise<{text, decoded, undecodable, overCap?}>`. A sidecar is read through `unbrotliPrefix` to `SIDECAR_FTS_BYTES + SIDECAR_REDACT_MARGIN` and passed through `sidecarIndexText`. An entry over `BLOB_DECODE_MAX` answers `overCap: true`, and an undecodable one answers `undecodable: true`.
  - In tests only: `indexBlob(db, blobId, text, pairIdx, overCap = false)`, which inserts `entryIndexText(text, pairIdx)` unless `overCap`, then marks the blob indexed.
- Consumes (base, `ccd/history/store.mjs`, tests only): `createStore`, `openWriter`, `openReader`, `closeWriter`, `createFtsTables`, `brotli`, `CODEC`.
- Consumes (base, `deploy/history-gate.mjs`, W2-3's):
  - `familyKey(storeId, ccrcId, generation)` (`canonicalJson([s, c, g])`);
  - `substream(seedHex, label)`, which refuses a label outside `SUBSTREAMS` and `PILOT_SUBSTREAM`;
  - `randInt(rng, n)` (rejection sampling);
  - `PILOT_SUBSTREAM` (`'pilot-sample'`), `FACT_KINDS` and `ASSIGNMENT_ARMS`.
- Consumes (Tasks 1 to 4), as values only. This task calls no name Tasks 1 to 4 define. Its functions take what they need as parameters, so Task 6's `sourceQuiz`, which composes them, maps the earlier shapes onto them:
  - the read-only handle `rs.db` and the run's pair index `rs.idx`, from Task 1's `openReplayStore` (W2-D51, W2-D67);
  - per admitted boundary: T_N (its non-null `ts_ms`), its `transcript_pk`, its holding `file_id` (Task 3's admission row), and leaf N's span entry ids in holding-copy file order (Task 1's `spanRowsOf`);
  - per family, the transcripts the CLI's family scope reads (`familyScopeOf`, this task);
  - the `redaction`, `producer` and `admit-baseline` stages (Tasks 2 and 4), and the `writer` and `admit-question` stages (Task 6).
- Produces (`deploy/history-replay.mjs`):
  - `QUIZ_STAGES = Object.freeze(['redaction','producer','admit-baseline','answerable','writer','admit-question'])`;
  - `QUOTA_SKIPS = Object.freeze(['cap-family','cap-boundary','cap-kind'])`;
  - `'unanswerable'` and `'unanswerable-untimed'`, appended to `FACT_DROP_REASONS` (R5);
  - `SOURCE_FAILS = Object.freeze({'entry-absent': 1, provenance: 1, 'not-verbatim': 1, 'blob-absent': 2, 'not-indexed': 2, pruned: 2, 'no-match': 3, unlinked: 4, 'ts-null': 4, 'ts-after': 4})`;
  - `checkSource(db, idx, source, factRaw, tsMs): Promise<{ok: true, entryUuid: string} | {ok: false, clause: 1|2|3|4, why: keyof SOURCE_FAILS}>`, where `source` is `{via: 'entry'|'sidecar', entryId: number|null, blobId: number, name: string|null}`;
  - `answerability(db, idx, {tsMs, transcriptPk, spanEntryIds}, factRaw): Promise<{state: 'answerable', source: {via, entryId, blobId, name, entryUuid}} | {state: 'untimed'} | {state: 'unanswerable'}>`;
  - `answerableStage(db, idx, contextOf): Stage`, where `contextOf(candidate)` answers `{tsMs, transcriptPk, spanEntryIds, factRaw}`;
  - `familyScopeOf(db, {ccrc_id, generation}): number[]`, the transcript pks the CLI searches for that family (R6);
  - `asofSameMsHits(db, {tsMs, holdingFileId, transcriptPks}, factRaw): number`;
  - `sameMsReport(db, contextOf): (candidate) => Promise<{asof_same_ms_hits: number}>`, where `contextOf(candidate)` answers `{tsMs, holdingFileId, transcriptPks, factRaw}`;
  - `seededOrder(rng, items, keyOf): T[]`;
  - `quizRng(recordSeedHex): Rng`, `pilotRng(pilotSeedHex): Rng`, `familyRng(seedHex, label, family): Rng` (one family's own substream) and `drawSeedHex(draw = randomBytes): string` (64 lowercase hex);
  - `quizFamilyOrderKey(recordSeedHex, family): string`: lib's `sha256Hex` over the substream seed (`sha256Hex(recordSeedHex + ':quiz-sample')`, the hex the gate's `substream` reads its words from), a colon and `familyKey(store_id, ccrc_id, generation)`; 64 lowercase hex (R10);
  - `quizPopulation(families, {pilotFamilies, assignment}): {families, excluded: {'no-admitted-boundary', pilot, 'control-id'}}`;
  - `sampleQuestions({families, rng, quotas, stages, afterAdmit?, candidateRng?, familyOrder?}): Promise<{questions, families: string[], drops: Record<stage, Record<reason, number>>, skips: Record<QUOTA_SKIPS, number>, reports: Record<id, unknown>}>`; each question is the candidate as the last stage kept it, with `rank: [familyRank, candidateRank]`. `familyRank` is the family's index in the drawn order, or, with `familyOrder` (a `(family) => string`), the family's key in a sort by that key, by code unit. `rng` draws whichever of the two orders no option supplies;
  - `quizFloor(nQuestions, nFamilies, haltFloor): {halt: boolean, short: Array<'questions'|'families'>}`;
  - `sampleFidelityBoundaries({families, rng, n, admitBoundary}): Promise<{boundaries: Array<{family, boundary}>, drops: Record<reason, number>}>`.
  - The shapes:
    - a **Stage** is `(candidate, family) => Promise<{keep: true, candidate} | {keep: false, reason: string}>`;
    - a **QuizCandidate** carries at least `{id, kind, boundary_uuid}`, where `id` is W2-D73's qid, unique in its family (Task 2's candidate with the `id` Task 6's `sourceQuiz` adds, R4);
    - a **QuizFamily** is `{store_id, ccrc_id, generation, admitted: number, candidates: () => Promise<QuizCandidate[]>}`;
    - a **FidelityFamily** is `{store_id, ccrc_id, generation, boundaries: () => Promise<Array<{boundary_uuid}>>}`.
  - Module-private: `ANSWER_STMTS`, `answerStmts`, `indexTextOf`, `sourceFail`, `SAME_MS_SQL`, `SAME_MS_STMTS`, `cmpUnit`, `familyKeyOf`, `keyedOrder` (R10), `assertCount`. Task 6's `sourceQuiz` reads `familyKeyOf` (same module).

**Spec:** §10.2 "**Questions**" (about :2650 at `cd622b2f6`), and its "Answerability" bullet (about :2663). The decisions document cites the second as :2651, which predates rev 3.6's later edits. The bullet's sentence is amended by W2-5b, erratum E19, never here. W2 decisions document: W2-D70, W2-D34 (its last bullet), W2-D71 (with the 2026-10-20 amendment and the coordinator's in-place amendment of 2026-10-22, R10), W2-D18's amendment, W2-D77, W2-D73 (the qid), W2-D74 (no second decode), W2-D78(iii)(b) (the re-check that reads `checkSource`). This task **defines D-5780** (section 6's "Defined in": W2-5a). It cites no other D-number as its own.

**Drifts against the decisions document, measured at `cd622b2f6`:**

| Document says | Code at `cd622b2f6` | Effect here |
|---|---|---|
| W2-D70 clause 1: "for a sidecar, `sidecarIndexText`" | The FTS row the sweep writes is `indexBlob`'s `entryIndexText(text)` over `ftsTextOfBlob`'s text, and for a sidecar that text is already `sidecarIndexText` over its prefix. `rederiveFts` recomputes it the same way. | The driver recomputes through the sweep's own `ftsTextOfBlob`, then `entryIndexText`: the row's own composition, with no second decode in `deploy/` (W2-D74) |
| W2-D70: the source's provenance is in `SEARCHABLE_PROVENANCE` | The index holds `INDEXED_PROVENANCE`, which also holds `recall-echo` | Clauses 2 and 3 alone would admit a `recall-echo` row. The provenance check is what refuses it, and its pin uses one |
| W2-D70 clause 1: "a sidecar linked to such a row"; clause 4: "a non-null entry_id" | A sidecar's only link is `sidecars.entry_id`, which `linkSidecar` leaves NULL when no tool_result names it | Clauses 1 to 3 read a sidecar linked to a searchable span row, or linked to nothing in the span's transcript, as the spec did. Clause 4 removes the unlinked ones, so the removal is counted (section 7's residual: "sidecars with no entry are never asked") |
| W2-D34: the count is taken "under the cut" | lib has no `asOfCut`, no predicate and no `asof-invalid`; only W2-1's `stampAtOrBefore` | The count is computed from the store with its own SQL, derived from W2-D34's first clause at `ts_ms = T_N`. No W2-2a name is imported; the parity pin is carried to W2-5b (R8) |
| W2-D34: "the FTS hits for F_raw" | grep's hit unit is a referrer (entry, variant or sidecar; recall.mjs's `referrerSql`) | The count is of distinct entries reached by any of the three routes. A row holding F_raw in its body and in its sidecar counts once (R6) |
| W2-D70: "Sourcing also reports … `asof_same_ms_hits` per admitted question" | W2-D73's frozen entry keys are fixed and have no such field | The count rides beside the list in `sampleQuestions`' `reports`, keyed by qid, and never enters the frozen bytes |
| W2-D71: "Quotas, pilot: 5 fidelity boundaries and 5 usage questions under the same filters" | No per-family rule for the fidelity boundaries; part 1's `pilot.n_fidelity` and `n_usage` defaults live only in `history-gate.mjs`'s record field table, and `pilot-source` runs before part 1 | `sampleFidelityBoundaries` takes `n` and picks at most one boundary per family. `pilot-source` reads the defaults from `OPEN_RECORD_V1`'s field table and passes the counts (R6) |
| W2-D70's "§10.2:2651"; W2-D71's "§10.2:2638" | Answerability is at about :2663 and Questions at about :2650 | None: no spec edit here |
| W2-1's export list (W2-D33) | `ftsTextOfBlob` was already exported by sweep.mjs, outside that list | Task 1 imports it for this task (R3). `cli.mjs`, which Task 1 imports for `pairIndexOf`, already loads sweep.mjs |
| W2-D71: one seeded walk over "the named nodes"; as amended in place on 2026-10-22, the quiz's family order is a per-family seeded key | Each node sources only the families its store holds, knows no other node's admitted families, and `freeze` merges the nodes' lists by rank | The quiz's family order is a sort by `quizFamilyOrderKey` (the `'quiz-sample'` substream seed hashed with `familyKey`, by code unit), never a draw over a global list; each family's candidate order comes from its own substream (`familyRng`). So a node's ranks, `[order key, candidate rank]`, are the walk over every node's families, whatever the other nodes hold (R4, R10). The pilot, one node (R9), keeps the drawn order |

**Choices this task makes:**
- **Clause order inside `checkSource`: cheapest first.** The provenance part of clause 1, then clause 2, clause 3, the verbatim part of clause 1, and clause 4 last. The FTS `MATCH` (clause 3) is an index lookup, so it runs before the recompute (decompress and redact). A source that fails it is never decoded, so no index text needs caching across candidates. Clause 4 runs last, so "passes 1 to 3 and fails 4" is measured, never inferred. The reported clause is the first that fails in this order. `SOURCE_FAILS` names each word's clause once.
- **Source order: the span's rows in holding-copy file order, then its sidecars by `(name, blob_id)`.** The first source that passes decides `source_entry_uuid` (W2-D73). For a sidecar source that is its linked row's uuid.
- **A span entry id missing from the store is a defect** (`TypeError`, exit 1): Task 3 read the span from this store a moment before. `checkSource`'s `'entry-absent'` word is for W2-5b's re-check of a frozen source on a store that may have changed.
- **The same-millisecond count's scope is the family scope the CLI would search** (`transcriptPks`, from `familyScopeOf`: recall.mjs's `familiesOf` for the family's row-life and `transcriptsOf` for its confirmed epochs' transcripts; R6). A hit outside the family is never shown to that family's arm. It counts searchable rows and linked sidecars, as grep's default does. A sidecar is counted by its route, whatever its row's provenance, because grep shows every sidecar as `tool`.
- **One stream per draw, or one per family.** `sampleQuestions` draws the family order from the `rng` it is handed and, by default, each family's candidate order from the same stream, so the same seed and inputs give the same list in any input order (W2-D18's amendment). With `candidateRng`, each family's candidate order comes from `candidateRng(family)`, so it depends on nothing but the family: Task 6's quiz mode passes `familyRng`, because a node holds only some families and must still rank its own as the global walk does. The rule is the one `handcheckSample` uses: a Fisher–Yates draw by `randInt` over a list first sorted by its key. A full order of n items takes n − 1 draws.
- **The quiz's family order is a key, not a draw (W2-D71 as amended in place on 2026-10-22; R10).** A drawn order over n families depends on all n, and a node knows only its own. So `familyOrder` sorts the families by a key each one carries alone, `quizFamilyOrderKey`: the `'quiz-sample'` substream's seed (the hex the gate's `substream` hashes the record seed and label into) hashed with the family's `familyKey`, compared by code unit. Each node then orders its own families exactly as the order over every named node would, and a question's `rank` is `[that key, candidate rank]`, so Task 7's `freeze` merges the nodes' outputs by rank and cuts at the target to the one walk over both (the keyed-order case pins it, with the concatenation as its CONTROL). A key listed twice (one family given twice) is a defect, as in `seededOrder`. The pilot runs on one node (R9) and keeps the drawn order on its one stream.
- **Caps are checked before any stage, and counted only on admission.** A candidate a cap skips reaches no stage, so it never costs a writer spawn. A candidate a stage drops never counts toward a cap.
- **`afterAdmit` cannot drop.** Its answer is stored in `reports` and is never read by the sampler. That is how "reported, never gating" is enforced.
- **The pilot's draw order.** Task 6's `sourceQuiz` in pilot mode calls `sampleFidelityBoundaries` and then `sampleQuestions` on one `pilotRng(seed)` object, in that order. The fidelity draw takes at most one boundary per family (R6).
- **New words are local to the driver** (D-5774's ground, cited bare): `QUIZ_STAGES`, `QUOTA_SKIPS` and `SOURCE_FAILS` are report words, and the two answerability drops are `FACT_DROP_REASONS` words (R5): never `DRIVER_REASONS` and never lib `REASONS`. `QUOTA_SKIPS` counts candidates a cap passes over, not drops: a separate report list, never a drop list, so no disjointness pin names it (R5 as amended by R10). No name is in O14's `VOCABS`.

**Residuals, named:**
- **`entryIndexText`'s outer pass is not pinned on its own.** No registered pair reaches these fixtures, and W2-D67's discard runs first, so F_raw never holds a registered value. Under those conditions the outer redaction leaves every fixture text unchanged. The composition is the sweep's (`indexBlob`, `rederiveFts`), which history-ingest and history-lib pin.
- **The 512 KiB window is guarded twice.** A fact past the window is refused both by clause 3 (the index row is cut) and by clause 1 (the recomputed text is cut). One mutant alone leaves that case green. Step 6 measures the pair together.
- **The count and lib's cut are two spellings** until W2-5b's parity pin ties them (R8).

- [ ] **Step 1: Confirm the base and the earlier tasks before the first edit.** From the repository root:

```bash
grep -n "^import" deploy/history-replay.mjs
grep -n "^// Imports:" deploy/history-replay.mjs
grep -c "never loads node:sqlite in any form" deploy/history-replay.mjs
grep -cE "^export (async )?function (seededOrder|answerability|checkSource|answerableStage|familyScopeOf|asofSameMsHits|sameMsReport|quizRng|pilotRng|familyRng|quizFamilyOrderKey|drawSeedHex|quizPopulation|sampleQuestions|quizFloor|sampleFidelityBoundaries)\(|^export const (QUIZ_STAGES|QUOTA_SKIPS|SOURCE_FAILS) " deploy/history-replay.mjs
grep -nE "^export (async )?function (ftsTextOfBlob|indexBlob)\(" ccd/history/sweep.mjs
grep -nE "^export (const|function) (familyKey|substream|randInt|PILOT_SUBSTREAM|FACT_KINDS|ASSIGNMENT_ARMS)\b" deploy/history-gate.mjs
grep -nE "^export (const|function) (entryIndexText|ftsPhrase|SEARCHABLE_PROVENANCE|INDEXED_PROVENANCE)\b" ccd/history/lib.mjs
grep -nE "^export function (familiesOf|transcriptsOf)\(" ccd/history/recall.mjs
grep -c "keptOf(" deploy/history-replay.mjs
grep -c "^  'duplicate', 'redact-fact', 'redact-leaf', 'result-unpaired', 'producer-other', 'producer-unknown', 'baseline-hit',$" deploy/history-replay.mjs
```

Expected:
- the import block holds exactly one statement per module, Task 1's fourteen, among them `import { ftsTextOfBlob } from '../ccd/history/sweep.mjs';` and `import { randomBytes } from 'node:crypto';`;
- the header has one `// Imports:` line;
- the old header sentence counts 0: Task 1 reworded it (R1), and this task leaves the header as Task 1 wrote it;
- the names this task adds count 0;
- sweep.mjs shows `export async function ftsTextOfBlob(` and `export function indexBlob(`;
- the gate shows its six names, lib its four, and recall.mjs `familiesOf` and `transcriptsOf`;
- `keptOf(` counts 0, because Task 1's scan forbids it;
- `1`: Task 2's `FACT_DROP_REASONS` line that this task appends after.

The following are gaps in Tasks 1 to 4: stop and report each one, and never fix it here.
- a name this task adds already defined;
- `keptOf(` called in the driver;
- a module this task needs without its statement (Task 1 owns every statement, R3).

Each name this task needs goes into its module's existing statement; this task adds no `import` line.

- [ ] **Step 2: Write the failing tests.** Append at the end of `server/test/history-replay.test.ts`:

```ts

// ── W2-5a Task 5: answerability, the same-millisecond count and sampling ─────────────────────────────────────────
// (W2-D70, W2-D34, W2-D71; D-5780). In-process only. Every store is built by hand under a mkTmp HOME, as
// history-card.test.ts's W1-B3 Task 4 builds one: createStore, then rows inserted directly, and each blob the sweep would
// index indexed through the sweep's own ftsTextOfBlob and indexBlob. Nothing here runs a pass, spawns a child, reads a
// roster, a live store or a live HOME, or reaches claude, ccrc or gh. The sampler's stages are recording stand-ins.
import { createHash as w5a5Hash } from 'node:crypto';
import type { DatabaseSync as W5a5Db } from 'node:sqlite';
import { describe as w5a5describe, expect as w5a5expect, it as w5a5it } from 'vitest';
import * as w5a5Drv from '../../deploy/history-replay.mjs';
import * as w5a5Lib from '../../ccd/history/lib.mjs';
import * as w5a5Gate from '../../deploy/history-gate.mjs';
import * as w5a5StoreMod from '../../ccd/history/store.mjs';
import * as w5a5SweepMod from '../../ccd/history/sweep.mjs';
import { mkTmp as w5a5MkTmp } from './tmpHelpers.js';

type W5a5Rng = { nextU32(): number };
type W5a5Cand = { id: string; kind: string; boundary_uuid: string; rank?: [number | string, number]; [k: string]: unknown };
type W5a5Verdict = { keep: true; candidate: W5a5Cand } | { keep: false; reason: string };
type W5a5Stage = (c: W5a5Cand, f: unknown) => Promise<W5a5Verdict>;
type W5a5Src = { via: 'entry' | 'sidecar'; entryId: number | null; blobId: number; name: string | null };
type W5a5Check = { ok: true; entryUuid: string } | { ok: false; clause: number; why: string };
type W5a5Answer = { state: 'answerable'; source: W5a5Src & { entryUuid: string } } | { state: 'untimed' } | { state: 'unanswerable' };
type W5a5Span = { tsMs: number; transcriptPk: number; spanEntryIds: number[] };
type W5a5Same = { tsMs: number; holdingFileId: number; transcriptPks: number[] };
type W5a5FamRef = { store_id: string; ccrc_id: string; generation: string };
type W5a5Quotas = { target: number; caps: { family: number; boundary: number; kind_per_family: number } };
type W5a5Sampled = { questions: W5a5Cand[]; families: string[]; drops: Record<string, Record<string, number>>; skips: Record<string, number>; reports: Record<string, unknown> };
/** The exports this task adds, typed for the test. The driver is JavaScript, so its inferred JSDoc types are loose. */
interface W5a5Api {
  QUIZ_STAGES: readonly string[];
  QUOTA_SKIPS: readonly string[];
  FACT_DROP_REASONS: readonly string[];
  RECON_DISCARDS: readonly string[];
  DRIVER_REASONS: readonly string[];
  SOURCE_FAILS: Readonly<Record<string, number>>;
  familyScopeOf(db: W5a5Db, f: { ccrc_id: string; generation: string }): number[];
  familyRng(seedHex: string, label: string, f: W5a5FamRef): W5a5Rng;
  checkSource(db: W5a5Db, idx: unknown, source: W5a5Src, factRaw: string, tsMs: number): Promise<W5a5Check>;
  answerability(db: W5a5Db, idx: unknown, ctx: W5a5Span, factRaw: string): Promise<W5a5Answer>;
  answerableStage(db: W5a5Db, idx: unknown, contextOf: (c: W5a5Cand) => W5a5Span & { factRaw: string }): W5a5Stage;
  asofSameMsHits(db: W5a5Db, ctx: W5a5Same, factRaw: string): number;
  sameMsReport(db: W5a5Db, contextOf: (c: W5a5Cand) => W5a5Same & { factRaw: string }): (c: W5a5Cand) => Promise<{ asof_same_ms_hits: number }>;
  seededOrder<T>(rng: W5a5Rng, items: readonly T[], keyOf: (x: T) => string): T[];
  quizRng(seedHex: string): W5a5Rng;
  pilotRng(seedHex: string): W5a5Rng;
  quizFamilyOrderKey(seedHex: string, f: W5a5FamRef): string;
  drawSeedHex(draw?: (n: number) => Uint8Array): string;
  quizPopulation<F extends W5a5FamRef & { admitted: number }>(families: F[], o: { pilotFamilies: W5a5FamRef[]; assignment: Array<W5a5FamRef & { arm: string }> }): { families: F[]; excluded: Record<string, number> };
  sampleQuestions(o: { families: unknown[]; rng: W5a5Rng; quotas: W5a5Quotas; stages: Record<string, W5a5Stage>; afterAdmit?: (c: W5a5Cand, f: unknown) => Promise<unknown>; candidateRng?: (f: W5a5FamRef) => W5a5Rng; familyOrder?: (f: W5a5FamRef) => string }): Promise<W5a5Sampled>;
  quizFloor(nQuestions: number, nFamilies: number, haltFloor: { questions: number; families: number }): { halt: boolean; short: string[] };
  sampleFidelityBoundaries(o: { families: unknown[]; rng: W5a5Rng; n: number; admitBoundary: (b: { boundary_uuid: string }, f: unknown) => Promise<{ keep: true } | { keep: false; reason: string }> }): Promise<{ boundaries: Array<{ family: W5a5FamRef; boundary: { boundary_uuid: string } }>; drops: Record<string, number> }>;
}
const w5a5D = w5a5Drv as unknown as W5a5Api;
const w5a5Sweep = w5a5SweepMod as unknown as {
  ftsTextOfBlob(z: Uint8Array, isSidecar: boolean, idx: unknown, rawLen: number): Promise<{ text: string | null; overCap?: boolean }>;
  indexBlob(db: W5a5Db, blobId: number, text: string, idx: unknown, overCap?: boolean): void;
};

w5a5describe('W2-5a Task 5: answerability, the same-millisecond count and sampling', () => {
  const D = w5a5D;
  const T = 1_760_000_000_000;              // boundary N's ts_ms: T_N
  const IDX = w5a5Lib.makePairIndex([]);    // no registered pair: redaction changes none of these texts
  const INDEXED = new Set<string>(w5a5Lib.INDEXED_PROVENANCE as readonly string[]);
  const UUID = (n: number): string => `5a5e0000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
  type RowSpec = { key: string; ts: number | null; provenance: string; text: string; files?: number[]; indexed?: boolean; variantText?: string };
  type SideSpec = { key: string; name: string; bytes: Buffer; linkTo: string | null; tpk?: number };
  type Fx = { dbFile: string; entry: Record<string, number>; blob: Record<string, number>; uuid: Record<string, string> };

  /** A store built by hand. Transcript 1 is this family's main transcript, with file 1 (N's holding copy) and file 2 (another
   *  copy of it). Transcript 2 is another family's, with file 3. Rows go in the order given, each a member of every file it
   *  lists (default file 1) at its own line. A row whose provenance the sweep indexes (INDEXED_PROVENANCE) is indexed
   *  through the sweep's own functions unless `indexed: false`, and so is every variant and sidecar. `edit` runs on the
   *  writer before it closes. */
  async function build(rows: RowSpec[], sides: SideSpec[] = [], edit?: (w: W5a5Db, fx: Fx) => void): Promise<Fx> {
    const home = w5a5MkTmp('w5a5-store-');
    w5a5StoreMod.createStore(home);
    const dbFile = w5a5Lib.historyPaths(home).dbFile;
    const w = w5a5StoreMod.openWriter(dbFile) as unknown as W5a5Db;
    w5a5StoreMod.createFtsTables(w);
    w.prepare('INSERT INTO transcripts (transcript_pk, cc_session_uuid) VALUES (1, ?), (2, ?)').run(UUID(9001), UUID(9002));
    const file = w.prepare("INSERT INTO ingest_files (file_id, dev, ino, transcript_pk, status, parser_version) VALUES (?, 1, ?, ?, 'live', 1)");
    file.run(1, 5001, 1);
    file.run(2, 5002, 1);
    file.run(3, 5003, 2);
    const fx: Fx = { dbFile, entry: {}, blob: {}, uuid: {} };
    const blobOf = (bytes: Buffer): number => Number((w.prepare('INSERT INTO blobs (sha256, codec, z, raw_len) VALUES (?, ?, ?, ?) RETURNING blob_id')
      .get(w5a5Hash('sha256').update(bytes).digest(), w5a5StoreMod.CODEC, w5a5StoreMod.brotli(bytes), bytes.length) as { blob_id: number | bigint }).blob_id);
    const index = async (blobId: number, isSidecar: boolean): Promise<void> => {
      const b = w.prepare('SELECT z, raw_len FROM blobs WHERE blob_id = ?').get(blobId) as { z: Uint8Array; raw_len: number | bigint };
      const t = await w5a5Sweep.ftsTextOfBlob(b.z, isSidecar, IDX, Number(b.raw_len));
      w5a5Sweep.indexBlob(w, blobId, t.text ?? '', IDX, t.overCap === true);
    };
    const body = (text: string): Buffer => Buffer.from(w5a5Lib.canonicalJson([{ type: 'text', text }]));
    const ent = w.prepare("INSERT INTO entries (uuid, transcript_pk, type, provenance, prov_version, struct_rank_ns, struct_file_id, blob_id, ts_ms) VALUES (?, ?, 'user', ?, 1, ?, ?, ?, ?) RETURNING entry_id");
    const member = w.prepare('INSERT INTO memberships (file_id, entry_id, line) VALUES (?, ?, ?)');
    for (const [i, r] of rows.entries()) {
      const files = r.files ?? [1];
      const blobId = blobOf(body(r.text));
      const id = Number((ent.get(UUID(i + 1), files.includes(3) ? 2 : 1, r.provenance, i, files[0]!, blobId, r.ts) as { entry_id: number | bigint }).entry_id);
      for (const f of files) member.run(f, id, i + 1);
      fx.entry[r.key] = id;
      fx.blob[r.key] = blobId;
      fx.uuid[r.key] = UUID(i + 1);
      if (r.indexed !== false && INDEXED.has(r.provenance)) await index(blobId, false);
      if (r.variantText !== undefined) {
        const v = blobOf(body(r.variantText));
        w.prepare("INSERT INTO entry_variants (entry_id, blob_id, first_file_id, first_seen_ms, cause) VALUES (?, ?, ?, 1, 'unknown')").run(id, v, files[0]!);
        fx.blob[`${r.key}:variant`] = v;
        await index(v, false);
      }
    }
    for (const s of sides) {
      const blobId = blobOf(s.bytes);
      w.prepare('INSERT INTO sidecars (transcript_pk, name, blob_id, entry_id, first_seen_ms) VALUES (?, ?, ?, ?, ?)')
        .run(s.tpk ?? 1, s.name, blobId, s.linkTo === null ? null : fx.entry[s.linkTo]!, T - 60_000);
      fx.blob[s.key] = blobId;
      await index(blobId, true);
    }
    edit?.(w, fx);
    w5a5StoreMod.closeWriter(w);
    return fx;
  }
  /** The driver's reads go through the read-only handle, as W2-D51's openReader route opens it. */
  async function withReader<R>(fx: Fx, fn: (db: W5a5Db) => Promise<R> | R): Promise<R> {
    const db = w5a5StoreMod.openReader(fx.dbFile) as unknown as W5a5Db;
    try { return await fn(db); } finally { db.close(); }
  }
  const span = (fx: Fx, keys: string[]): W5a5Span => ({ tsMs: T, transcriptPk: 1, spanEntryIds: keys.map((k) => fx.entry[k]!) });
  const ans = (fx: Fx, keys: string[], fact: string): Promise<W5a5Answer> => withReader(fx, (db) => D.answerability(db, IDX, span(fx, keys), fact));
  const check = (fx: Fx, src: W5a5Src, fact: string): Promise<W5a5Check> => withReader(fx, (db) => D.checkSource(db, IDX, src, fact, T));
  const rowSrc = (fx: Fx, key: string): W5a5Src => ({ via: 'entry', entryId: fx.entry[key]!, blobId: fx.blob[key]!, name: null });

  w5a5describe('answerability, W2-D70 and D-5780', () => {
    w5a5it('the words are fixed: the two drop words, appended to FACT_DROP_REASONS after Task 2\'s (R5), and each failure word with its clause', () => {
      w5a5expect(D.FACT_DROP_REASONS.slice(14, 16)).toEqual(['unanswerable', 'unanswerable-untimed']);
      w5a5expect(new Set(D.FACT_DROP_REASONS).size).toBe(D.FACT_DROP_REASONS.length);
      w5a5expect({ ...D.SOURCE_FAILS }).toEqual({
        'entry-absent': 1, provenance: 1, 'not-verbatim': 1, 'blob-absent': 2, 'not-indexed': 2, pruned: 2, 'no-match': 3, unlinked: 4, 'ts-null': 4, 'ts-after': 4,
      });
      w5a5expect(Object.isFrozen(D.SOURCE_FAILS)).toBe(true);
    });

    w5a5it('a fact in a stamped model row of the span is answerable, and the source is that row', async () => {
      const fx = await build([{ key: 'm', ts: T - 5000, provenance: 'model', text: 'run zqcmd51 now' }]);
      w5a5expect(await ans(fx, ['m'], 'zqcmd51 now')).toEqual({
        state: 'answerable', source: { via: 'entry', entryId: fx.entry.m, blobId: fx.blob.m, name: null, entryUuid: fx.uuid.m },
      });
    });

    w5a5it('clause 4: a source stamped exactly T_N is answerable, and one stamped one ms after T_N is untimed', async () => {
      const at = await build([{ key: 'r', ts: T, provenance: 'tool', text: 'zqat51 output' }]);
      w5a5expect((await ans(at, ['r'], 'zqat51 output')).state).toBe('answerable');
      const after = await build([{ key: 'r', ts: T + 1, provenance: 'tool', text: 'zqat51 output' }]);
      w5a5expect(await ans(after, ['r'], 'zqat51 output')).toEqual({ state: 'untimed' });
      w5a5expect(await check(after, rowSrc(after, 'r'), 'zqat51 output')).toEqual({ ok: false, clause: 4, why: 'ts-after' });
    });

    w5a5it('clause 4: a NULL-ts source is not answerable, and is untimed', async () => {
      const fx = await build([{ key: 'r', ts: null, provenance: 'tool', text: 'zqnull51 output' }]);
      w5a5expect(await ans(fx, ['r'], 'zqnull51 output')).toEqual({ state: 'untimed' });
      w5a5expect(await check(fx, rowSrc(fx, 'r'), 'zqnull51 output')).toEqual({ ok: false, clause: 4, why: 'ts-null' });
    });

    w5a5it('clause 1: a harness row and an indexed recall-echo row are not sources; CONTROL: the same text in a tool row is', async () => {
      const harness = await build([{ key: 'h', ts: T - 1000, provenance: 'harness', text: 'zqmeta51 injected' }]);
      w5a5expect(await ans(harness, ['h'], 'zqmeta51 injected')).toEqual({ state: 'unanswerable' });
      w5a5expect(await check(harness, rowSrc(harness, 'h'), 'zqmeta51 injected')).toEqual({ ok: false, clause: 1, why: 'provenance' });
      const echo = await build([{ key: 'e', ts: T - 1000, provenance: 'recall-echo', text: 'zqecho51 result' }]);
      w5a5expect(await ans(echo, ['e'], 'zqecho51 result')).toEqual({ state: 'unanswerable' });
      w5a5expect(await check(echo, rowSrc(echo, 'e'), 'zqecho51 result')).toEqual({ ok: false, clause: 1, why: 'provenance' });
      const tool = await build([{ key: 'e', ts: T - 1000, provenance: 'tool', text: 'zqecho51 result' }]);
      w5a5expect((await ans(tool, ['e'], 'zqecho51 result')).state).toBe('answerable');
    });

    w5a5it('clause 2: a blob marked unindexed, and a pruned blob, are not sources even with their index row still present', async () => {
      const cold = await build([{ key: 'r', ts: T - 1000, provenance: 'tool', text: 'zqcold51 output' }], [],
        (w, fx) => { w.prepare('UPDATE blobs SET fts_indexed = 0 WHERE blob_id = ?').run(fx.blob.r!); });
      w5a5expect(await ans(cold, ['r'], 'zqcold51 output')).toEqual({ state: 'unanswerable' });
      w5a5expect(await check(cold, rowSrc(cold, 'r'), 'zqcold51 output')).toEqual({ ok: false, clause: 2, why: 'not-indexed' });
      const pruned = await build([{ key: 'r', ts: T - 1000, provenance: 'tool', text: 'zqgone51 output' }], [],
        (w, fx) => { w.prepare('UPDATE blobs SET z = NULL, pruned_ms = ? WHERE blob_id = ?').run(T, fx.blob.r!); });
      w5a5expect(await ans(pruned, ['r'], 'zqgone51 output')).toEqual({ state: 'unanswerable' });
      w5a5expect(await check(pruned, rowSrc(pruned, 'r'), 'zqgone51 output')).toEqual({ ok: false, clause: 2, why: 'pruned' });
    });

    w5a5it('clause 3: a source the index MATCH does not return is not answerable', async () => {
      const fx = await build([{ key: 'r', ts: T - 1000, provenance: 'tool', text: 'zqmiss51 output' }], [],
        (w, f) => { w.prepare('DELETE FROM blobs_fts WHERE rowid = ?').run(f.blob.r!); });
      w5a5expect(await ans(fx, ['r'], 'zqmiss51 output')).toEqual({ state: 'unanswerable' });
      w5a5expect(await check(fx, rowSrc(fx, 'r'), 'zqmiss51 output')).toEqual({ ok: false, clause: 3, why: 'no-match' });
    });

    w5a5it('clause 1: a phrase the MATCH finds but the index text does not hold verbatim is not answerable; CONTROL: the verbatim fact is', async () => {
      const fx = await build([{ key: 'r', ts: T - 1000, provenance: 'tool', text: 'zqrun51 zqtest51:zqunit51 now' }]);
      w5a5expect(await ans(fx, ['r'], 'zqrun51 zqtest51-zqunit51')).toEqual({ state: 'unanswerable' });
      w5a5expect(await check(fx, rowSrc(fx, 'r'), 'zqrun51 zqtest51-zqunit51')).toEqual({ ok: false, clause: 1, why: 'not-verbatim' });
      w5a5expect((await ans(fx, ['r'], 'zqrun51 zqtest51:zqunit51')).state).toBe('answerable');
    });

    w5a5it('the sidecar window: a fact past SIDECAR_FTS_BYTES is not answerable, and one inside it is', async () => {
      const bytes = Buffer.from(`zqhead51 ${'x '.repeat(270_000)}zqtail51\n`);
      w5a5expect(bytes.indexOf('zqtail51'), 'CONTROL: the tail starts past the window').toBeGreaterThan(w5a5Lib.SIDECAR_FTS_BYTES);
      const fx = await build([{ key: 'tr', ts: T - 2000, provenance: 'tool', text: 'Output too large. Full output saved to: tool-results/big51.txt' }],
        [{ key: 's', name: 'big51.txt', bytes, linkTo: 'tr' }]);
      w5a5expect(await ans(fx, ['tr'], 'zqhead51')).toEqual({
        state: 'answerable', source: { via: 'sidecar', entryId: fx.entry.tr, blobId: fx.blob.s, name: 'big51.txt', entryUuid: fx.uuid.tr },
      });
      w5a5expect(await ans(fx, ['tr'], 'zqtail51')).toEqual({ state: 'unanswerable' });
    });

    w5a5it('clause 4: an unlinked sidecar is untimed; CONTROL: the same sidecar linked to a stamped span row is answerable', async () => {
      const side = (linkTo: string | null): SideSpec[] => [{ key: 's', name: 'toolu_01SIDE51.txt', bytes: Buffer.from('zqside51 body\n'), linkTo }];
      const row: RowSpec[] = [{ key: 'tr', ts: T - 2000, provenance: 'tool', text: 'saved elsewhere' }];
      const unlinked = await build(row, side(null));
      w5a5expect(await ans(unlinked, ['tr'], 'zqside51 body')).toEqual({ state: 'untimed' });
      w5a5expect(await check(unlinked, { via: 'sidecar', entryId: null, blobId: unlinked.blob.s!, name: 'toolu_01SIDE51.txt' }, 'zqside51 body'))
        .toEqual({ ok: false, clause: 4, why: 'unlinked' });
      const linked = await build(row, side('tr'));
      w5a5expect((await ans(linked, ['tr'], 'zqside51 body'))).toEqual({
        state: 'answerable', source: { via: 'sidecar', entryId: linked.entry.tr, blobId: linked.blob.s, name: 'toolu_01SIDE51.txt', entryUuid: linked.uuid.tr },
      });
    });

    w5a5it('clause 4: a sidecar linked to a NULL-ts span row is untimed, though the sidecar has a first-seen time', async () => {
      const fx = await build([{ key: 'tr', ts: null, provenance: 'tool', text: 'saved elsewhere' }],
        [{ key: 's', name: 'toolu_01SIDE52.txt', bytes: Buffer.from('zqside52 body\n'), linkTo: 'tr' }]);
      w5a5expect(await ans(fx, ['tr'], 'zqside52 body')).toEqual({ state: 'untimed' });
      w5a5expect(await check(fx, { via: 'sidecar', entryId: fx.entry.tr!, blobId: fx.blob.s!, name: 'toolu_01SIDE52.txt' }, 'zqside52 body'))
        .toEqual({ ok: false, clause: 4, why: 'ts-null' });
    });

    w5a5it('a sidecar linked to a row outside the span is never a source', async () => {
      const fx = await build([
        { key: 'tr', ts: T - 2000, provenance: 'tool', text: 'nothing here' },
        { key: 'post', ts: T + 5000, provenance: 'tool', text: 'a later result' },
      ], [{ key: 's', name: 'toolu_01SIDE53.txt', bytes: Buffer.from('zqside53 body\n'), linkTo: 'post' }]);
      w5a5expect(await ans(fx, ['tr'], 'zqside53 body')).toEqual({ state: 'unanswerable' });
    });

    w5a5it('sources are tried rows first, in span order, then sidecars: a fact in both answers from the row', async () => {
      const fx = await build([{ key: 'r', ts: T - 3000, provenance: 'tool', text: 'zqboth51 in the row' }],
        [{ key: 's', name: 'toolu_01SIDE54.txt', bytes: Buffer.from('zqboth51 in the sidecar\n'), linkTo: 'r' }]);
      const a = await ans(fx, ['r'], 'zqboth51');
      w5a5expect(a.state === 'answerable' ? a.source.via : a.state).toBe('entry');
    });

    w5a5it('answerableStage keeps an answerable candidate with its source, and drops the rest as unanswerable or unanswerable-untimed', async () => {
      const fx = await build([
        { key: 'good', ts: T - 3000, provenance: 'tool', text: 'zqgood51 output' },
        { key: 'null', ts: null, provenance: 'tool', text: 'zqnull53 output' },
        { key: 'cold', ts: T - 3000, provenance: 'tool', text: 'zqcold53 output', indexed: false },
      ]);
      const verdicts = await withReader(fx, async (db) => {
        const stage = D.answerableStage(db, IDX, (c) => ({ ...span(fx, ['good', 'null', 'cold']), factRaw: c.fact_raw as string }));
        const out: Record<string, W5a5Verdict> = {};
        for (const f of ['zqgood51 output', 'zqnull53 output', 'zqcold53 output']) out[f] = await stage({ id: f, kind: 'error', boundary_uuid: UUID(7000), fact_raw: f }, null);
        return out;
      });
      w5a5expect(verdicts['zqgood51 output']).toEqual({
        keep: true,
        candidate: { id: 'zqgood51 output', kind: 'error', boundary_uuid: UUID(7000), fact_raw: 'zqgood51 output', source: { via: 'entry', entryId: fx.entry.good, blobId: fx.blob.good, name: null, entryUuid: fx.uuid.good } },
      });
      w5a5expect(verdicts['zqnull53 output']).toEqual({ keep: false, reason: 'unanswerable-untimed' });
      w5a5expect(verdicts['zqcold53 output']).toEqual({ keep: false, reason: 'unanswerable' });
    });
  });

  w5a5describe('the same-millisecond count, W2-D34', () => {
    /** One fact, zqsame51, planted in every shape the count must tell apart. Expected: 4 (out, outVariant, outSide, outDual). */
    const SAME_ROWS: RowSpec[] = [
      { key: 'holdAfter', files: [1], ts: T, provenance: 'tool', text: 'zqsame51 in the holding copy' },
      { key: 'both', files: [1, 2], ts: T, provenance: 'tool', text: 'zqsame51 in both copies' },
      { key: 'out', files: [2], ts: T, provenance: 'tool', text: 'zqsame51 outside' },
      { key: 'outBefore', files: [2], ts: T - 1, provenance: 'tool', text: 'zqsame51 one ms before' },
      { key: 'outAfter', files: [2], ts: T + 1, provenance: 'tool', text: 'zqsame51 one ms after' },
      { key: 'outNull', files: [2], ts: null, provenance: 'tool', text: 'zqsame51 with no stamp' },
      { key: 'outEcho', files: [2], ts: T, provenance: 'recall-echo', text: 'zqsame51 echoed' },
      { key: 'outVariant', files: [2], ts: T, provenance: 'tool', text: 'no fact here a', variantText: 'zqsame51 in a variant' },
      { key: 'outSide', files: [2], ts: T, provenance: 'tool', text: 'no fact here b' },
      { key: 'outDual', files: [2], ts: T, provenance: 'tool', text: 'zqsame51 in a row and its sidecar' },
      { key: 'otherFamily', files: [3], ts: T, provenance: 'tool', text: 'zqsame51 in another family' },
    ];
    const SAME_SIDES: SideSpec[] = [
      { key: 'sSide', name: 'toolu_01SAME51.txt', bytes: Buffer.from('zqsame51 in a sidecar\n'), linkTo: 'outSide' },
      { key: 'sDual', name: 'toolu_01SAME52.txt', bytes: Buffer.from('zqsame51 in the dual sidecar\n'), linkTo: 'outDual' },
      { key: 'sLoose', name: 'toolu_01SAME53.txt', bytes: Buffer.from('zqsame51 unlinked\n'), linkTo: null },
    ];
    const CTX: W5a5Same = { tsMs: T, holdingFileId: 1, transcriptPks: [1] };

    w5a5it('counts the entries outside N holding copy, in the family, searchable, stamped exactly T_N, by row, variant or sidecar, each once', async () => {
      const fx = await build(SAME_ROWS, SAME_SIDES);
      await withReader(fx, (db) => {
        w5a5expect(D.asofSameMsHits(db, CTX, 'zqsame51')).toBe(4);
        w5a5expect(D.asofSameMsHits(db, CTX, 'zqabsent51')).toBe(0);
      });
    });

    w5a5it('familyScopeOf is recall.mjs\'s own family scope: a confirmed epoch\'s transcript that holds rows, never an unconfirmed epoch\'s or another family\'s (R6)', async () => {
      const home = w5a5MkTmp('w5a5-scope-');
      w5a5StoreMod.createStore(home);
      const dbFile = w5a5Lib.historyPaths(home).dbFile;
      const w = w5a5StoreMod.openWriter(dbFile) as unknown as W5a5Db;
      w.prepare("INSERT INTO sessions (session_pk, ccrc_id, generation, project, first_seen_ms) VALUES (1, 'fam-a', 'g1', 'demo', 1), (2, 'fam-b', 'g1', 'demo', 2)").run();
      const ep = w.prepare("INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, confirmed_ms) VALUES (?, ?, ?, 'startup', 'hook', ?)");
      ep.run(1, 1, UUID(9101), 1);
      ep.run(1, 2, UUID(9102), null);
      ep.run(2, 1, UUID(9103), 1);
      w.prepare('INSERT INTO transcripts (transcript_pk, cc_session_uuid) VALUES (1, ?), (2, ?), (3, ?)').run(UUID(9101), UUID(9102), UUID(9103));
      const bytes = Buffer.from(w5a5Lib.canonicalJson([{ type: 'text', text: 'scope' }]));
      const blobId = Number((w.prepare('INSERT INTO blobs (sha256, codec, z, raw_len) VALUES (?, ?, ?, ?) RETURNING blob_id')
        .get(w5a5Hash('sha256').update(bytes).digest(), w5a5StoreMod.CODEC, w5a5StoreMod.brotli(bytes), bytes.length) as { blob_id: number | bigint }).blob_id);
      const ent = w.prepare("INSERT INTO entries (uuid, transcript_pk, type, provenance, prov_version, struct_rank_ns, struct_file_id, blob_id, ts_ms) VALUES (?, ?, 'user', 'operator', 1, 0, 0, ?, ?)");
      for (const t of [1, 2, 3]) ent.run(UUID(9200 + t), t, blobId, T - 1000);
      w5a5StoreMod.closeWriter(w);
      const fx: Fx = { dbFile, entry: {}, blob: {}, uuid: {} };
      w5a5expect(await withReader(fx, (db) => D.familyScopeOf(db, { ccrc_id: 'fam-a', generation: 'g1' }))).toEqual([1]);
      // CONTROL: every transcript of the family's epochs, the second family rule R6 forbids, would also take the unconfirmed one.
      const naive = await withReader(fx, (db) => (db.prepare(`SELECT DISTINCT t.transcript_pk AS p FROM epochs e
        JOIN transcripts t ON t.cc_session_uuid = e.cc_session_uuid WHERE e.session_pk = 1 ORDER BY p`).all() as Array<{ p: number | bigint }>).map((r) => Number(r.p)));
      w5a5expect(naive).toEqual([1, 2]);
    });

    w5a5it('sameMsReport answers the count per admitted candidate, as a report', async () => {
      const fx = await build(SAME_ROWS, SAME_SIDES);
      const rep = await withReader(fx, (db) => D.sameMsReport(db, (c) => ({ ...CTX, factRaw: c.fact_raw as string }))({ id: 'q1', kind: 'error', boundary_uuid: UUID(7001), fact_raw: 'zqsame51' }));
      w5a5expect(rep).toEqual({ asof_same_ms_hits: 4 });
    });
  });

  w5a5describe('sampling, W2-D71', () => {
    const SEED = 'ab'.repeat(32);
    const L8 = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const BIG: W5a5Quotas = { target: 1000, caps: { family: 1000, boundary: 1000, kind_per_family: 1000 } };
    type Fam = W5a5FamRef & { admitted: number; calls: number; candidates: () => Promise<W5a5Cand[]> };
    const fam = (ccrc: string, cands: W5a5Cand[], o: { store?: string; gen?: string; admitted?: number } = {}): Fam => {
      const f: Fam = {
        store_id: o.store ?? 's1', ccrc_id: ccrc, generation: o.gen ?? 'g1', admitted: o.admitted ?? 1, calls: 0,
        candidates: async () => { f.calls += 1; return cands; },
      };
      return f;
    };
    const cand = (id: string, kind = 'sha', boundary = `b-${id}`): W5a5Cand => ({ id, kind, boundary_uuid: boundary });
    const recorder = (log: string[], drop: Record<string, Record<string, string>> = {}): Record<string, W5a5Stage> => Object.fromEntries(
      D.QUIZ_STAGES.map((n) => [n, async (c: W5a5Cand): Promise<W5a5Verdict> => {
        log.push(`${n}:${c.id}`);
        const reason = drop[n]?.[c.id];
        return reason === undefined ? { keep: true, candidate: c } : { keep: false, reason };
      }]));
    const ids = (r: W5a5Sampled): string[] => r.questions.map((q) => q.id);
    const fk = (f: W5a5FamRef): string => w5a5Gate.familyKey(f.store_id, f.ccrc_id, f.generation);

    w5a5it('the stage order and the quota words are fixed', () => {
      w5a5expect([...D.QUIZ_STAGES]).toEqual(['redaction', 'producer', 'admit-baseline', 'answerable', 'writer', 'admit-question']);
      w5a5expect([...D.QUOTA_SKIPS]).toEqual(['cap-family', 'cap-boundary', 'cap-kind']);
      w5a5expect(Object.isFrozen(D.QUIZ_STAGES) && Object.isFrozen(D.QUOTA_SKIPS)).toBe(true);
    });

    w5a5it('seededOrder sorts by key, then draws its order: a recorded vector for each substream, and input order never moves it', () => {
      w5a5expect(D.seededOrder(D.quizRng(SEED), L8, (x) => x)).toEqual(['f', 'a', 'g', 'b', 'd', 'h', 'e', 'c']);
      w5a5expect(D.seededOrder(D.quizRng(SEED), [...L8].reverse(), (x) => x)).toEqual(['f', 'a', 'g', 'b', 'd', 'h', 'e', 'c']);
      w5a5expect(D.seededOrder(D.pilotRng(SEED), L8, (x) => x)).toEqual(['h', 'b', 'f', 'e', 'c', 'g', 'd', 'a']);
      const rng = D.quizRng(SEED);
      D.seededOrder(rng, L8, (x) => x);
      w5a5expect(D.seededOrder(rng, ['x1', 'x2', 'x3', 'x4'], (x) => x), 'a second order continues the same stream').toEqual(['x4', 'x3', 'x1', 'x2']);
    });

    w5a5it('seededOrder refuses a key listed twice', () => {
      w5a5expect(() => D.seededOrder(D.quizRng(SEED), ['k1', 'k1'], (x) => x)).toThrow(/listed twice/);
    });

    w5a5it('drawSeedHex is 32 drawn bytes as 64 lowercase hex, and refuses a draw of another length', () => {
      w5a5expect(D.drawSeedHex(() => new Uint8Array(32).fill(0xab))).toBe('ab'.repeat(32));
      const a = D.drawSeedHex();
      w5a5expect(a).toMatch(/^[0-9a-f]{64}$/);
      w5a5expect(D.drawSeedHex()).not.toBe(a);
      w5a5expect(() => D.drawSeedHex(() => new Uint8Array(16))).toThrow(/32 bytes/);
    });

    w5a5it('families in seeded order, then the candidates of each family, all from one stream: a recorded vector', async () => {
      const lists: Record<string, W5a5Cand[]> = {
        'fam-c': [cand('c2'), cand('c1'), cand('c3')], 'fam-a': [cand('a1'), cand('a3'), cand('a2')], 'fam-b': [cand('b3'), cand('b1'), cand('b2')],
      };
      const fams = Object.entries(lists).map(([id, cs]) => fam(id, cs));
      const r = await D.sampleQuestions({ families: fams, rng: D.quizRng(SEED), quotas: BIG, stages: recorder([]) });
      w5a5expect(ids(r)).toEqual(['a2', 'a3', 'a1', 'b1', 'b2', 'b3', 'c1', 'c3', 'c2']);
      w5a5expect(r.families).toEqual(fams.map(fk).sort());
      const rev = Object.entries(lists).reverse().map(([id, cs]) => fam(id, [...cs].reverse()));
      const again = await D.sampleQuestions({ families: rev, rng: D.quizRng(SEED), quotas: BIG, stages: recorder([]) });
      w5a5expect(ids(again), 'the same seed and inputs in another order give the same list').toEqual(ids(r));
    });

    w5a5it('the stages run in QUIZ_STAGES order, whatever order the stages object lists them in', async () => {
      const log: string[] = [];
      const stages = Object.fromEntries(Object.entries(recorder(log)).reverse());
      await D.sampleQuestions({ families: [fam('fam-a', [cand('o1')])], rng: D.quizRng(SEED), quotas: BIG, stages });
      w5a5expect(log).toEqual(D.QUIZ_STAGES.map((n) => `${n}:o1`));
    });

    w5a5it('lazy: a candidate a stage drops reaches no later stage, and the drop is counted under that stage', async () => {
      const log: string[] = [];
      const r = await D.sampleQuestions({
        families: [fam('fam-a', [cand('c1'), cand('c2', 'path')])], rng: D.quizRng(SEED), quotas: BIG,
        stages: recorder(log, { 'admit-baseline': { c1: 'in-baseline' } }),
      });
      w5a5expect(log.filter((l) => l.endsWith(':c1'))).toEqual(['redaction:c1', 'producer:c1', 'admit-baseline:c1']);
      w5a5expect(r.drops['admit-baseline']).toEqual({ 'in-baseline': 1 });
      w5a5expect(ids(r)).toEqual(['c2']);
    });

    w5a5it('the family cap: five questions, the rest skipped before any stage', async () => {
      const kinds = ['sha', 'path', 'command', 'error'];
      const log: string[] = [];
      const r = await D.sampleQuestions({
        families: [fam('fam-a', Array.from({ length: 7 }, (_, i) => cand(`k${i}`, kinds[i % 4]!)))], rng: D.quizRng(SEED),
        quotas: { target: 1000, caps: { family: 5, boundary: 1000, kind_per_family: 1000 } }, stages: recorder(log),
      });
      w5a5expect(r.questions.length).toBe(5);
      w5a5expect(r.skips).toEqual({ 'cap-family': 2, 'cap-boundary': 0, 'cap-kind': 0 });
      w5a5expect(log.filter((l) => l.startsWith('redaction:')).length).toBe(5);
    });

    w5a5it('the boundary cap: three questions from one boundary', async () => {
      const kinds = ['sha', 'path', 'command', 'error', 'sha'];
      const r = await D.sampleQuestions({
        families: [fam('fam-a', kinds.map((k, i) => cand(`b${i}`, k, 'b-one')))], rng: D.quizRng(SEED),
        quotas: { target: 1000, caps: { family: 1000, boundary: 3, kind_per_family: 1000 } }, stages: recorder([]),
      });
      w5a5expect(r.questions.length).toBe(3);
      w5a5expect(r.skips).toEqual({ 'cap-family': 0, 'cap-boundary': 2, 'cap-kind': 0 });
    });

    w5a5it('the kind cap: two questions of one kind in a family', async () => {
      const r = await D.sampleQuestions({
        families: [fam('fam-a', [cand('s1'), cand('s2'), cand('s3'), cand('s4'), cand('p1', 'path')])], rng: D.quizRng(SEED),
        quotas: { target: 1000, caps: { family: 1000, boundary: 1000, kind_per_family: 2 } }, stages: recorder([]),
      });
      w5a5expect(r.questions.map((q) => q.kind).sort()).toEqual(['path', 'sha', 'sha']);
      w5a5expect(r.skips).toEqual({ 'cap-family': 0, 'cap-boundary': 0, 'cap-kind': 2 });
    });

    w5a5it('a cap counts admitted questions only: a candidate the writer drops does not use the family cap', async () => {
      w5a5expect(D.seededOrder(D.quizRng(SEED), ['d1', 'd2', 'd3'], (x) => x), 'CONTROL: d1 is drawn first').toEqual(['d1', 'd2', 'd3']);
      const r = await D.sampleQuestions({
        families: [fam('fam-a', [cand('d1'), cand('d2', 'path'), cand('d3', 'command')])], rng: D.quizRng(SEED),
        quotas: { target: 1000, caps: { family: 2, boundary: 1000, kind_per_family: 1000 } }, stages: recorder([], { writer: { d1: 'writer-leak' } }),
      });
      w5a5expect(ids(r)).toEqual(['d2', 'd3']);
      w5a5expect(r.drops.writer).toEqual({ 'writer-leak': 1 });
    });

    w5a5it('each question carries its rank, [family rank, candidate rank]; with candidateRng a family\'s ranks do not depend on what other families hold (R4)', async () => {
      const cr = (f: W5a5FamRef): W5a5Rng => D.familyRng(SEED, 'quiz-sample', f);
      const lists: Record<string, W5a5Cand[]> = {
        'fam-a': ['a1', 'a2', 'a3', 'a4'].map((n) => cand(n)), 'fam-b': ['b1', 'b2', 'b3', 'b4'].map((n) => cand(n)), 'fam-c': ['c1', 'c2', 'c3', 'c4'].map((n) => cand(n)),
      };
      const rankOf = (r: W5a5Sampled): Record<string, string> => Object.fromEntries(r.questions.map((q) => [q.id, JSON.stringify(q.rank)]));
      const whole = rankOf(await D.sampleQuestions({ families: Object.entries(lists).map(([id, cs]) => fam(id, cs)), rng: D.quizRng(SEED), quotas: BIG, stages: recorder([]), candidateRng: cr }));
      w5a5expect(Object.keys(whole)).toHaveLength(12);
      w5a5expect(new Set(Object.values(whole)).size, 'no two questions share a rank').toBe(12);
      for (const only of Object.keys(lists)) {
        // A node that holds one family walks the same global list, the others empty, and ranks its own as the whole walk does.
        const local = rankOf(await D.sampleQuestions({ families: Object.entries(lists).map(([id, cs]) => fam(id, id === only ? cs : [])), rng: D.quizRng(SEED), quotas: BIG, stages: recorder([]), candidateRng: cr }));
        w5a5expect(local, only).toEqual(Object.fromEntries(Object.entries(whole).filter(([id]) => id.startsWith(only.slice(-1)))));
      }
    });

    w5a5it('the quiz\'s keyed family order (W2-D71 as amended 2026-10-22; R10): families sorted by quizFamilyOrderKey, each question ranked [key, candidate rank], and two nodes\' outputs merged by rank are the one walk over both', async () => {
      const cr = (f: W5a5FamRef): W5a5Rng => D.familyRng(SEED, 'quiz-sample', f);
      const ko = (f: W5a5FamRef): string => D.quizFamilyOrderKey(SEED, f);
      // The key, recomputed from its definition: the 'quiz-sample' substream's seed hashed with familyKey.
      const sub = w5a5Hash('sha256').update(`${SEED}:quiz-sample`).digest('hex');
      const refA: W5a5FamRef = { store_id: 's1', ccrc_id: 'fam-a', generation: 'g1' };
      w5a5expect(ko(refA)).toBe(w5a5Hash('sha256').update(`${sub}:${fk(refA)}`).digest('hex'));
      w5a5expect(ko(refA)).toMatch(/^[0-9a-f]{64}$/);
      const lists: Record<string, W5a5Cand[]> = {
        'fam-a': ['a1', 'a2', 'a3'].map((n) => cand(n)), 'fam-b': ['b1', 'b2', 'b3'].map((n) => cand(n)),
        'fam-c': ['c1', 'c2', 'c3'].map((n) => cand(n)), 'fam-d': ['d1', 'd2', 'd3'].map((n) => cand(n)),
      };
      const walk = (held: string[], target: number): Promise<W5a5Sampled> => D.sampleQuestions({
        families: held.map((id) => fam(id, lists[id]!)), rng: D.quizRng(SEED), quotas: { ...BIG, target }, stages: recorder([]),
        candidateRng: cr, familyOrder: ko,
      });
      const all = await walk(['fam-a', 'fam-b', 'fam-c', 'fam-d'], 1000);
      // A recorded vector: the keys sort fam-a, fam-d, fam-b, fam-c; each family's candidates come from its own stream.
      w5a5expect(ids(all)).toEqual(['a3', 'a2', 'a1', 'd2', 'd1', 'd3', 'b1', 'b3', 'b2', 'c2', 'c1', 'c3']);
      w5a5expect(all.questions.map((q) => q.rank)).toEqual(['fam-a', 'fam-d', 'fam-b', 'fam-c'].flatMap((id) =>
        [0, 1, 2].map((ci) => [ko({ store_id: 's1', ccrc_id: id, generation: 'g1' }), ci])));
      const again = await walk(['fam-d', 'fam-c', 'fam-b', 'fam-a'], 1000);
      w5a5expect(ids(again), 'input order never moves the keyed order').toEqual(ids(all));
      // Two nodes, each holding the families the other's sit between in the key order, and no list of the other's.
      const cmp = (x: string | number, y: string | number): number => (x < y ? -1 : x > y ? 1 : 0);
      const byRank = (x: W5a5Cand, y: W5a5Cand): number => cmp(x.rank![0], y.rank![0]) || cmp(x.rank![1], y.rank![1]);
      for (const target of [1000, 5]) {
        const one = await walk(['fam-a', 'fam-b', 'fam-c', 'fam-d'], target);
        const nodeA = await walk(['fam-a', 'fam-b'], target);
        const nodeB = await walk(['fam-d', 'fam-c'], target);
        const merged = [...nodeA.questions, ...nodeB.questions].sort(byRank).slice(0, target);
        w5a5expect(merged.map((q) => [q.id, q.rank]), `target ${target}`).toEqual(one.questions.map((q) => [q.id, q.rank]));
        if (target === 5) {
          w5a5expect(ids(one)).toEqual(['a3', 'a2', 'a1', 'd2', 'd1']);
          w5a5expect([...nodeA.questions, ...nodeB.questions].slice(0, target).map((q) => q.id),
            'CONTROL: the nodes\' lists concatenated are not the walk; only the rank order merges them').toEqual(['a3', 'a2', 'a1', 'b1', 'b3']);
        }
      }
      await w5a5expect(D.sampleQuestions({ families: [fam('fam-a', [cand('x1')]), fam('fam-a', [cand('x2')])], rng: D.quizRng(SEED),
        quotas: BIG, stages: recorder([]), candidateRng: cr, familyOrder: ko })).rejects.toThrow(/listed twice/);
    });

    w5a5it('the target stops the draw: no further stage runs, and a family not reached is never mined', async () => {
      const log: string[] = [];
      const fams = [fam('fam-a', ['1', '2', '3', '4', '5'].map((n) => cand(`a${n}`))), fam('fam-b', ['1', '2', '3', '4', '5'].map((n) => cand(`b${n}`)))];
      const r = await D.sampleQuestions({ families: fams, rng: D.quizRng(SEED), quotas: { ...BIG, target: 3 }, stages: recorder(log) });
      w5a5expect(r.questions.length).toBe(3);
      w5a5expect(log.filter((l) => l.startsWith('writer:')).length).toBe(3);
      w5a5expect(fams[0]!.calls + fams[1]!.calls).toBe(1);
    });

    w5a5it('the same-millisecond report never gates: the list is the same with and without it, and each question carries its report', async () => {
      const make = (): Fam[] => [fam('fam-a', [cand('a1'), cand('a2', 'path')]), fam('fam-b', [cand('b1')])];
      const plain = await D.sampleQuestions({ families: make(), rng: D.quizRng(SEED), quotas: BIG, stages: recorder([]) });
      const withRep = await D.sampleQuestions({
        families: make(), rng: D.quizRng(SEED), quotas: BIG, stages: recorder([]), afterAdmit: async () => ({ asof_same_ms_hits: 7 }),
      });
      w5a5expect(ids(withRep)).toEqual(ids(plain));
      w5a5expect(plain.reports).toEqual({});
      w5a5expect(withRep.reports).toEqual(Object.fromEntries(ids(plain).map((id) => [id, { asof_same_ms_hits: 7 }])));
    });

    w5a5it('malformed sampler inputs are defects: a missing or unknown stage, a drop with no reason, a bad quota, a bad kind, a repeated id', async () => {
      const one = (): Fam[] => [fam('fam-a', [cand('x1')])];
      const stages = recorder([]);
      const noWriter = Object.fromEntries(Object.entries(stages).filter(([k]) => k !== 'writer'));
      await w5a5expect(D.sampleQuestions({ families: one(), rng: D.quizRng(SEED), quotas: BIG, stages: noWriter })).rejects.toThrow(/no 'writer' stage/);
      await w5a5expect(D.sampleQuestions({ families: one(), rng: D.quizRng(SEED), quotas: BIG, stages: { ...stages, judge: stages.writer! } })).rejects.toThrow(/'judge' is an unknown stage/);
      await w5a5expect(D.sampleQuestions({ families: one(), rng: D.quizRng(SEED), quotas: BIG, stages: recorder([], { producer: { x1: '' } }) })).rejects.toThrow(/without a reason word/);
      await w5a5expect(D.sampleQuestions({ families: one(), rng: D.quizRng(SEED), quotas: { ...BIG, target: 0 }, stages })).rejects.toThrow(/not a positive integer/);
      await w5a5expect(D.sampleQuestions({ families: one(), rng: D.quizRng(SEED), quotas: { ...BIG, caps: { ...BIG.caps, boundary: 0 } }, stages })).rejects.toThrow(/caps\.boundary=0 is not a positive integer/);
      await w5a5expect(D.sampleQuestions({ families: [fam('fam-a', [cand('y1', 'decision')])], rng: D.quizRng(SEED), quotas: BIG, stages })).rejects.toThrow(/has kind/);
      await w5a5expect(D.sampleQuestions({ families: [fam('fam-a', [cand('z1'), cand('z1', 'path')])], rng: D.quizRng(SEED), quotas: BIG, stages })).rejects.toThrow(/listed twice/);
    });

    w5a5it('the population drops families with no admitted boundary, pilot families, and every family of a control-assigned store and id', () => {
      const F = (store: string, ccrc: string, gen: string, admitted = 1): W5a5FamRef & { admitted: number } => ({ store_id: store, ccrc_id: ccrc, generation: gen, admitted });
      const a1 = F('s1', 'fam-a', 'g1', 2); const a2 = F('s1', 'fam-a', 'g2'); const b1 = F('s1', 'fam-b', 'g1'); const b2 = F('s1', 'fam-b', 'g2');
      const a3 = F('s2', 'fam-a', 'g1'); const c1 = F('s1', 'fam-c', 'g1'); const c2 = F('s1', 'fam-c', 'g2'); const d1 = F('s1', 'fam-d', 'g1', 0);
      const r = D.quizPopulation([a1, a2, b1, b2, a3, c1, c2, d1], {
        pilotFamilies: [c1],
        assignment: [{ ...a1, arm: 'control' }, { ...b1, arm: 'treatment' }, { ...a3, arm: 'treatment' }],
      });
      w5a5expect(r.families).toEqual([b1, b2, a3, c2]);
      w5a5expect(r.excluded).toEqual({ 'no-admitted-boundary': 1, pilot: 1, 'control-id': 2 });
      w5a5expect(() => D.quizPopulation([b1], { pilotFamilies: [], assignment: [{ ...b1, arm: 'holdout' }] })).toThrow(/not an assignment arm/);
    });

    w5a5it('the halt floor: fewer than 60 questions or fewer than 12 families halts, and exactly the floor does not', () => {
      const floor = { questions: 60, families: 12 };
      w5a5expect(D.quizFloor(60, 12, floor)).toEqual({ halt: false, short: [] });
      w5a5expect(D.quizFloor(59, 12, floor)).toEqual({ halt: true, short: ['questions'] });
      w5a5expect(D.quizFloor(60, 11, floor)).toEqual({ halt: true, short: ['families'] });
      w5a5expect(D.quizFloor(0, 0, floor)).toEqual({ halt: true, short: ['questions', 'families'] });
    });

    w5a5it('fidelity boundaries: at most one per family, in seeded family order, a dropped boundary counted, and a family not reached never read', async () => {
      type FFam = W5a5FamRef & { calls: number; boundaries: () => Promise<Array<{ boundary_uuid: string }>> };
      const ffam = (id: string): FFam => {
        const f: FFam = { store_id: 's1', ccrc_id: id, generation: 'g1', calls: 0, boundaries: async () => { f.calls += 1; return [{ boundary_uuid: `${id}-b1` }, { boundary_uuid: `${id}-b2` }]; } };
        return f;
      };
      const four = (): FFam[] => ['fam-a', 'fam-b', 'fam-c', 'fam-d'].map(ffam);
      const fams = four();
      const two = await D.sampleFidelityBoundaries({ families: fams, rng: D.pilotRng(SEED), n: 2, admitBoundary: async () => ({ keep: true }) });
      w5a5expect(two.boundaries.map((p) => p.family.ccrc_id)).toEqual(['fam-d', 'fam-c']);
      w5a5expect(fams.reduce((n, f) => n + f.calls, 0)).toBe(2);
      const all = await D.sampleFidelityBoundaries({
        families: four(), rng: D.pilotRng(SEED), n: 10,
        admitBoundary: async (b, f) => ((f as FFam).ccrc_id === 'fam-a' ? { keep: false, reason: 'payload-discarded' } : { keep: true }),
      });
      w5a5expect(all.boundaries.map((p) => p.family.ccrc_id).sort()).toEqual(['fam-b', 'fam-c', 'fam-d']);
      w5a5expect(all.drops).toEqual({ 'payload-discarded': 2 });
    });
  });
});
```

Predicted failure, written before the code: every case reds. Most fail with `TypeError: D.answerability is not a function`, or the same for `seededOrder`, `quizRng`, `QUIZ_STAGES` (as `undefined` spread), and the other new names. The store builder itself runs green: it calls only base exports. If a case reds in `build` instead, the fixture is wrong. Fix it before Step 4, never the expectation.

- [ ] **Step 3: Run the new describe and see it red.**

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-5a Task 5'
```

Expected: 36 failed, 0 passed in the selection (14 answerability cases, 3 count cases, 19 sampling cases), each on a missing export as predicted (the words case on `FACT_DROP_REASONS.slice(14, 16)` being empty). The filter selects the whole new describe: its title holds `W2-5a Task 5`.

- [ ] **Step 4: Write the code.** In `deploy/history-replay.mjs`:

(a) Extend Task 1's imports, each in its module's existing statement, names in code-unit order; add no `import` line:
- lib's statement gains `SEARCHABLE_PROVENANCE`, `entryIndexText` and `ftsPhrase`;
- the gate's gains `ASSIGNMENT_ARMS`, `FACT_KINDS`, `PILOT_SUBSTREAM`, `familyKey`, `randInt` and `substream`;
- recall.mjs's becomes `import { expandEntryBody, familiesOf as scopeFamiliesOf, transcriptsOf } from '../ccd/history/recall.mjs';`, and in the test file Task 1's `EXACT_NAMES` entry `'../ccd/history/recall.mjs': '{ expandEntryBody }',` becomes `'../ccd/history/recall.mjs': '{ expandEntryBody, familiesOf as scopeFamiliesOf, transcriptsOf }',`;
- `ftsTextOfBlob` and `randomBytes` are already imported (Task 1, R3).

(b) In `FACT_DROP_REASONS`, replace `  'duplicate', 'redact-fact', 'redact-leaf', 'result-unpaired', 'producer-other', 'producer-unknown', 'baseline-hit',` with:

```js
  'duplicate', 'redact-fact', 'redact-leaf', 'result-unpaired', 'producer-other', 'producer-unknown', 'baseline-hit',
  'unanswerable', 'unanswerable-untimed',
```

(c) Add this section directly above the comment line `// The entry guard stays the LAST block of this file`, after Task 4's section:

```js
// ── W2-5a Task 5: answerability, the same-millisecond count and sampling (W2-D70, W2-D34, W2-D71; D-5780) ──────────
// Answerability (W2-D70) asks whether boundary N's own store could answer a fact at all. Some source in leaf N's span
// holds F_raw verbatim in the text the index holds; that blob is indexed and unpruned; the index's own MATCH returns
// it; and (clause 4, D-5780) the source is stamped at or before T_N. Clause 4 removes what the as-of cut (W2-D34,
// W2-D35) hides: a NULL-ts row, and a sidecar with no entry. The same-millisecond count (W2-D34's residual) is
// reported per admitted question and decides nothing. Sampling (W2-D71) walks families, then each family's
// candidates, in one seeded order, skips by quota before any filter, and runs the filters lazily in QUIZ_STAGES'
// order. Every read here is on the read-only handle; nothing writes.

/** The filters a quiz candidate passes, in W2-D71's order. sampleQuestions runs them in exactly this order, lazily:
 *  a candidate a quota skips reaches none of them, and one a stage drops reaches no later stage. This task ships the
 *  `answerable` stage (answerableStage); the subcommand that samples hands in the rest. */
export const QUIZ_STAGES = Object.freeze(['redaction', 'producer', 'admit-baseline', 'answerable', 'writer', 'admit-question']);

/** What sampling counts when a quota, not a filter, passes a candidate over (W2-D71's caps). A skipped candidate
 *  reaches no stage. */
export const QUOTA_SKIPS = Object.freeze(['cap-family', 'cap-boundary', 'cap-kind']);

/** Why one source fails W2-D70, each word with the clause it belongs to. checkSource answers one of these, and W2-5b's
 *  re-check before an arm batch (W2-D78(iii)(b)) names the clause from it. */
export const SOURCE_FAILS = Object.freeze({
  'entry-absent': 1, provenance: 1, 'not-verbatim': 1,
  'blob-absent': 2, 'not-indexed': 2, pruned: 2,
  'no-match': 3,
  unlinked: 4, 'ts-null': 4, 'ts-after': 4,
});

const ANSWER_STMTS = new WeakMap();
/** The reads answerability makes, prepared once per handle. */
function answerStmts(db) {
  let s = ANSWER_STMTS.get(db);
  if (s !== undefined) return s;
  s = {
    entry: db.prepare('SELECT entry_id, uuid, ts_ms, provenance, blob_id FROM entries WHERE entry_id = ?'),
    // A sidecar is a source when it is linked to a searchable span row, and also when it is linked to nothing
    // (entry_id NULL): clauses 1 to 3 read such a sidecar as the spec did, and clause 4 removes it (D-5780), so the
    // removal is counted. A sidecar linked to any other row is never a source.
    sidecars: db.prepare(`SELECT name, blob_id, entry_id FROM sidecars WHERE transcript_pk = ?
      AND (entry_id IS NULL OR entry_id IN (SELECT value FROM json_each(?))) ORDER BY name, blob_id`),
    blob: db.prepare('SELECT z, raw_len, fts_indexed, pruned_ms FROM blobs WHERE blob_id = ?'),
    match: db.prepare('SELECT rowid FROM blobs_fts WHERE blobs_fts MATCH ? AND rowid = ?'),
  };
  ANSWER_STMTS.set(db, s);
  return s;
}

/** A blob's index text as the sweep writes it. indexBlob inserts entryIndexText over ftsTextOfBlob's text, and
 *  rederiveFts recomputes it the same way. A blob ftsTextOfBlob answers over-cap or undecodable gets no index row.
 *  The driver calls the sweep's own function, so deploy/ holds no second decode (W2-D74).
 *  @returns {Promise<{state: 'text', text: string} | {state: 'none'}>} */
async function indexTextOf(b, isSidecar, idx) {
  if (b.z === null) return { state: 'none' };
  const t = await ftsTextOfBlob(b.z, isSidecar, idx, Number(b.raw_len));
  if (t.undecodable === true || t.overCap === true) return { state: 'none' };
  return { state: 'text', text: entryIndexText(t.text, idx) };
}

/** @param {keyof typeof SOURCE_FAILS} why */
const sourceFail = (why) => ({ ok: false, clause: SOURCE_FAILS[why], why });

/**
 * One source against W2-D70's four clauses, cheapest first. The order is clause 1's provenance part, then clause 2,
 * clause 3, clause 1's verbatim part, and clause 4 last, so "passes 1 to 3 and fails 4" is measured. The answer names
 * the first clause that fails. The caller vouches that an entry source is a leaf-N span row; a sidecar source with a
 * null entryId is an unlinked sidecar.
 * @param {object} db the read-only handle
 * @param {object} idx the run's pair index
 * @param {{via: 'entry'|'sidecar', entryId: number|null, blobId: number, name: string|null}} source
 * @param {string} factRaw F_raw (W2-D61)
 * @param {number} tsMs T_N, boundary N's own ts_ms
 * @returns {Promise<{ok: true, entryUuid: string} | {ok: false, clause: number, why: string}>}
 */
export async function checkSource(db, idx, source, factRaw, tsMs) {
  if (typeof factRaw !== 'string' || factRaw === '') throw new TypeError('checkSource: factRaw is a non-empty string');
  if (!Number.isSafeInteger(tsMs)) throw new TypeError(`checkSource: tsMs=${String(tsMs)} is not an integer`);
  if (source.via !== 'entry' && source.via !== 'sidecar') throw new TypeError(`checkSource: via ${JSON.stringify(source.via)}`);
  if (source.via === 'entry' && source.entryId === null) throw new TypeError('checkSource: an entry source names its entry');
  const s = answerStmts(db);
  let row = null;
  if (source.entryId !== null) {
    row = s.entry.get(source.entryId) ?? null;
    if (row === null) return sourceFail('entry-absent');
    if (!SEARCHABLE_PROVENANCE.includes(row.provenance)) return sourceFail('provenance');
  }
  const b = s.blob.get(source.blobId);
  if (b === undefined) return sourceFail('blob-absent');
  if (Number(b.fts_indexed) !== 1) return sourceFail('not-indexed');
  if (b.pruned_ms !== null || b.z === null) return sourceFail('pruned');
  if (s.match.get(ftsPhrase(factRaw), source.blobId) === undefined) return sourceFail('no-match');
  const t = await indexTextOf(b, source.via === 'sidecar', idx);
  if (t.state !== 'text' || !t.text.includes(factRaw)) return sourceFail('not-verbatim');
  if (row === null) return sourceFail('unlinked');
  if (row.ts_ms === null) return sourceFail('ts-null');
  if (Number(row.ts_ms) > tsMs) return sourceFail('ts-after');
  return { ok: true, entryUuid: row.uuid };
}

/**
 * W2-D70: is F_raw answerable from leaf N's span? Sources are the span's rows in holding-copy file order, then the
 * span transcript's sidecars that are linked to a searchable span row or to nothing, by (name, blob_id). The first
 * source that passes all four clauses answers. With none, `untimed` says some source passed clauses 1 to 3 and only
 * clause 4 (D-5780) removed it, and `unanswerable` says none did. A span id missing from the store is a defect: the
 * caller read the span from this store.
 * @param {object} db
 * @param {object} idx
 * @param {{tsMs: number, transcriptPk: number, spanEntryIds: number[]}} ctx
 * @param {string} factRaw
 * @returns {Promise<{state: 'answerable', source: {via: 'entry'|'sidecar', entryId: number|null, blobId: number, name: string|null, entryUuid: string}} | {state: 'untimed'} | {state: 'unanswerable'}>}
 */
export async function answerability(db, idx, ctx, factRaw) {
  if (!Array.isArray(ctx.spanEntryIds)) throw new TypeError('answerability: spanEntryIds is an array');
  const s = answerStmts(db);
  const rows = ctx.spanEntryIds.map((id) => {
    const r = s.entry.get(id);
    if (r === undefined) throw new TypeError(`answerability: span entry ${String(id)} is not in the store`);
    return r;
  });
  const linkable = rows.filter((r) => SEARCHABLE_PROVENANCE.includes(r.provenance)).map((r) => Number(r.entry_id));
  const sources = [
    ...rows.map((r) => ({ via: 'entry', entryId: Number(r.entry_id), blobId: Number(r.blob_id), name: null })),
    ...s.sidecars.all(ctx.transcriptPk, JSON.stringify(linkable)).map((c) => ({
      via: 'sidecar', entryId: c.entry_id === null ? null : Number(c.entry_id), blobId: Number(c.blob_id), name: c.name,
    })),
  ];
  let untimed = false;
  for (const src of sources) {
    const v = await checkSource(db, idx, src, factRaw, ctx.tsMs);
    if (v.ok) return { state: 'answerable', source: { ...src, entryUuid: v.entryUuid } };
    if (v.clause === 4) untimed = true;
  }
  return { state: untimed ? 'untimed' : 'unanswerable' };
}

/**
 * The `answerable` stage (QUIZ_STAGES[3]). It keeps an answerable candidate with its `source`, which freeze reads as
 * `source_entry_uuid` (W2-D73), and drops the rest as `unanswerable`, or as `unanswerable-untimed` when only clause 4
 * (D-5780) removed every source: two FACT_DROP_REASONS words (R5), so what D-5780 costs is counted apart.
 * @param {object} db
 * @param {object} idx
 * @param {(candidate: object) => {tsMs: number, transcriptPk: number, spanEntryIds: number[], factRaw: string}} contextOf
 */
export function answerableStage(db, idx, contextOf) {
  return async (candidate) => {
    const c = contextOf(candidate);
    const a = await answerability(db, idx, c, c.factRaw);
    if (a.state === 'answerable') return { keep: true, candidate: { ...candidate, source: a.source } };
    return { keep: false, reason: a.state === 'untimed' ? 'unanswerable-untimed' : 'unanswerable' };
  };
}

/**
 * The transcripts the CLI searches for one family (R6): recall.mjs's own family scope, never a second family rule.
 * familiesOf with kind 'family' answers the family's row-life (a family a re-key merged answers the family it merged
 * into), and transcriptsOf its confirmed epochs' transcripts that hold rows. The same-millisecond count reads this.
 * @param {object} db
 * @param {{ccrc_id: string, generation: string}} f
 * @returns {number[]}
 */
export function familyScopeOf(db, f) {
  const fams = scopeFamiliesOf(db, { kind: 'family', id: f.ccrc_id, generation: f.generation, project: null, workdir: null, workdirReal: null });
  return transcriptsOf(db, fams.map((x) => x.sessionPk));
}

/** W2-D34's same-millisecond count. These are the entries holding an FTS hit for the phrase, by their own row, a variant
 *  or a linked sidecar, that the cut leaves visible outside N's holding copy at exactly T_N: stamped T_N, in the family's
 *  transcripts, searchable (a sidecar by its route, as grep shows it), and not a member of the holding file. Each entry is
 *  counted once. N's boundary and summary entries are members of that file, and a kept(N) member stamped T_N outside it
 *  is visible by its stamp anyway, so no cut code is needed. */
const SAME_MS_SQL = `WITH m(blob_id) AS (SELECT rowid FROM blobs_fts WHERE blobs_fts MATCH :q),
  hit(entry_id, via) AS (
    SELECT e.entry_id, 'row' FROM m JOIN entries e ON e.blob_id = m.blob_id
    UNION SELECT v.entry_id, 'row' FROM m JOIN entry_variants v ON v.blob_id = m.blob_id
    UNION SELECT s.entry_id, 'sidecar' FROM m JOIN sidecars s ON s.blob_id = m.blob_id)
  SELECT count(DISTINCT e.entry_id) AS n FROM hit h JOIN entries e ON e.entry_id = h.entry_id
  WHERE e.ts_ms = :t
    AND e.transcript_pk IN (SELECT value FROM json_each(:tpks))
    AND (h.via = 'sidecar' OR e.provenance IN (SELECT value FROM json_each(:provs)))
    AND NOT EXISTS (SELECT 1 FROM memberships mb WHERE mb.file_id = :hold AND mb.entry_id = e.entry_id)`;
const SAME_MS_STMTS = new WeakMap();

/**
 * `asof_same_ms_hits` for one admitted question (W2-D34). Reported, never gating: nothing in sampling reads it.
 * @param {object} db
 * @param {{tsMs: number, holdingFileId: number, transcriptPks: number[]}} ctx
 * @param {string} factRaw
 * @returns {number}
 */
export function asofSameMsHits(db, ctx, factRaw) {
  if (typeof factRaw !== 'string' || factRaw === '') throw new TypeError('asofSameMsHits: factRaw is a non-empty string');
  if (!Number.isSafeInteger(ctx.tsMs) || !Number.isSafeInteger(ctx.holdingFileId) || !Array.isArray(ctx.transcriptPks)) {
    throw new TypeError('asofSameMsHits: tsMs and holdingFileId are integers and transcriptPks an array');
  }
  let st = SAME_MS_STMTS.get(db);
  if (st === undefined) {
    st = db.prepare(SAME_MS_SQL);
    SAME_MS_STMTS.set(db, st);
  }
  const r = st.get({
    q: ftsPhrase(factRaw), t: ctx.tsMs, hold: ctx.holdingFileId,
    tpks: JSON.stringify(ctx.transcriptPks), provs: JSON.stringify(SEARCHABLE_PROVENANCE),
  });
  return Number(r.n);
}

/** sampleQuestions' `afterAdmit` for the quiz: each admitted question's report, keyed by its qid beside the frozen list,
 *  never in it (W2-D73 fixes the entry keys). */
export function sameMsReport(db, contextOf) {
  return async (candidate) => {
    const c = contextOf(candidate);
    return { asof_same_ms_hits: asofSameMsHits(db, c, c.factRaw) };
  };
}

/** Code-unit order (W2-D18's amendment). */
const cmpUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** @param {{store_id: string, ccrc_id: string, generation: string}} f */
const familyKeyOf = (f) => familyKey(f.store_id, f.ccrc_id, f.generation);

/**
 * A seeded order (W2-D18's amendment, W2-D71). `items` is sorted by `keyOf`, by code unit, and a key listed twice is
 * a defect. Then a Fisher–Yates order is drawn from `rng` by randInt, as handcheckSample draws: n − 1 draws for n items.
 * The same stream and the same items give the same order in any input order.
 * @template T
 * @param {{nextU32(): number}} rng
 * @param {readonly T[]} items
 * @param {(item: T) => string} keyOf
 * @returns {T[]}
 */
export function seededOrder(rng, items, keyOf) {
  const keyed = items.map((it) => {
    const k = keyOf(it);
    if (typeof k !== 'string') throw new TypeError('seededOrder: every key is a string');
    return /** @type {[string, T]} */ ([k, it]);
  });
  keyed.sort((a, b) => cmpUnit(a[0], b[0]));
  for (let i = 1; i < keyed.length; i += 1) {
    if (keyed[i - 1][0] === keyed[i][0]) throw new TypeError(`seededOrder: the key ${JSON.stringify(keyed[i][0])} is listed twice`);
  }
  const out = keyed.map(([, it]) => it);
  for (let s = 0; s < out.length - 1; s += 1) {
    const j = s + randInt(rng, out.length - s);
    [out[s], out[j]] = [out[j], out[s]];
  }
  return out;
}

/** A keyed family order (W2-D71 as amended 2026-10-22; R10): the families sorted by `keyOf`, by code unit, each with
 *  its key, which is its family rank. No draw. A key that is not a non-empty string, or one listed twice (one family
 *  given twice), is a defect.
 *  @template F  @param {readonly F[]} families  @param {(f: F) => string} keyOf  @returns {Array<[string, F]>} */
function keyedOrder(families, keyOf) {
  const pairs = families.map((f) => {
    const k = keyOf(f);
    if (typeof k !== 'string' || k === '') throw new TypeError('sampleQuestions: every family order key is a non-empty string');
    return /** @type {[string, F]} */ ([k, f]);
  });
  pairs.sort((x, y) => cmpUnit(x[0], y[0]));
  for (let i = 1; i < pairs.length; i += 1) {
    if (pairs[i - 1][0] === pairs[i][0]) throw new TypeError(`sampleQuestions: the family order key ${pairs[i][0]} is listed twice`);
  }
  return pairs;
}

/** The quiz's stream: the open record's seed, substream 'quiz-sample' (W2-D71). */
export function quizRng(recordSeedHex) {
  return substream(recordSeedHex, 'quiz-sample');
}

/** The pilot's stream: the pilot's own seed, never the record's, substream PILOT_SUBSTREAM (W2-D71, W2-D18). */
export function pilotRng(pilotSeedHex) {
  return substream(pilotSeedHex, PILOT_SUBSTREAM);
}

/** One family's own candidate stream: the walk's seed joined to the family's key, under the walk's label. A family's
 *  candidate order is then the same on whichever node holds it, whatever the other families hold, so every node's ranks
 *  are the global walk's and freeze merges them by rank alone (W2-D71; R4).
 *  @param {string} seedHex  @param {string} label 'quiz-sample' or PILOT_SUBSTREAM
 *  @param {{store_id: string, ccrc_id: string, generation: string}} family */
export function familyRng(seedHex, label, family) {
  return substream(`${seedHex}:${familyKeyOf(family)}`, label);
}

/** The quiz's per-family order key (W2-D71, as the coordinator amended it in place on 2026-10-22; R10): the
 *  'quiz-sample' substream's seed, sha256Hex(`<seed>:quiz-sample`) as the gate's substream derives it, hashed with the
 *  family's familyKey, as 64 lowercase hex. Families sorted by it, by code unit, come in one order on every node, and
 *  a node needs no list of the others' families, so each node's ranks are the walk over every node's (freeze merges by
 *  rank).
 *  @param {string} recordSeedHex  @param {{store_id: string, ccrc_id: string, generation: string}} family */
export function quizFamilyOrderKey(recordSeedHex, family) {
  if (typeof recordSeedHex !== 'string' || recordSeedHex === '') throw new TypeError('quizFamilyOrderKey: the seed is a non-empty string, passed in');
  return sha256Hex(`${sha256Hex(`${recordSeedHex}:quiz-sample`)}:${familyKeyOf(family)}`);
}

/** A fresh seed: 32 bytes from `draw` (crypto's randomBytes), as 64 lowercase hex. pilot-source records it in the pilot
 *  section (W2-D71). No flag ever takes a seed; a test injects `draw`. */
export function drawSeedHex(draw = randomBytes) {
  const b = draw(32);
  if (!(b instanceof Uint8Array) || b.length !== 32) throw new TypeError('drawSeedHex: the draw is 32 bytes');
  return Buffer.from(b).toString('hex');
}

/**
 * The quiz population (W2-D71, W2-D77). It keeps the families with at least one W2-D66-admitted boundary and drops,
 * counted: every pilot family, and every family whose (store_id, ccrc_id) holds a control-assigned family at any
 * generation. The input order is kept.
 * @template {{store_id: string, ccrc_id: string, generation: string, admitted: number}} F
 * @param {F[]} families
 * @param {{pilotFamilies: Array<{store_id: string, ccrc_id: string, generation: string}>, assignment: Array<{store_id: string, ccrc_id: string, generation: string, arm: string}>}} o
 * @returns {{families: F[], excluded: {'no-admitted-boundary': number, pilot: number, 'control-id': number}}}
 */
export function quizPopulation(families, { pilotFamilies, assignment }) {
  const pilot = new Set(pilotFamilies.map(familyKeyOf));
  const controlIds = new Set();
  for (const a of assignment) {
    if (!ASSIGNMENT_ARMS.includes(a.arm)) throw new TypeError(`quizPopulation: arm ${JSON.stringify(a.arm)} is not an assignment arm`);
    if (a.arm === 'control') controlIds.add(canonicalJson([a.store_id, a.ccrc_id]));
  }
  const kept = [];
  const excluded = { 'no-admitted-boundary': 0, pilot: 0, 'control-id': 0 };
  for (const f of families) {
    if (!Number.isSafeInteger(f.admitted) || f.admitted < 0) throw new TypeError(`quizPopulation: admitted=${String(f.admitted)} is not a count`);
    if (f.admitted === 0) excluded['no-admitted-boundary'] += 1;
    else if (pilot.has(familyKeyOf(f))) excluded.pilot += 1;
    else if (controlIds.has(canonicalJson([f.store_id, f.ccrc_id]))) excluded['control-id'] += 1;
    else kept.push(f);
  }
  return { families: kept, excluded };
}

/** @param {string} name @param {unknown} v */
function assertCount(name, v) {
  if (!Number.isSafeInteger(v) || /** @type {number} */ (v) < 1) throw new TypeError(`sampleQuestions: the quota ${name}=${String(v)} is not a positive integer`);
}

/**
 * W2-D71's draw. Families come in seeded order (by familyKey), and within each family its candidates in seeded order
 * (by id), from the one `rng`, or from `candidateRng(family)` when it is given (a walk spread over nodes). With
 * `familyOrder`, the families are not drawn: they are sorted by `familyOrder(family)`, by code unit (the quiz passes
 * quizFamilyOrderKey, W2-D71 as amended 2026-10-22, R10). Each question carries `rank: [family rank, candidate rank]`,
 * its place in the two orders; the family rank is the family's index in the drawn order, or its key under
 * `familyOrder`, so the ranks of nodes that each hold some families merge into the one walk. A candidate is first checked against the quotas: the target, then the per-family,
 * per-boundary and per-kind caps, which count admitted questions only. A candidate a cap skips is counted under
 * QUOTA_SKIPS and reaches no stage. The rest run QUIZ_STAGES in order, and the first stage that drops one ends its run;
 * the drop is counted under that stage and its reason. `afterAdmit` runs once per admitted question, and its answer is
 * stored in `reports` and never read here. A family is mined (`candidates()`) only when the draw reaches it. Malformed
 * inputs are defects (TypeError).
 * @param {{families: Array<{store_id: string, ccrc_id: string, generation: string, candidates: () => Promise<Array<{id: string, kind: string, boundary_uuid: string}>>}>, rng: {nextU32(): number}, quotas: {target: number, caps: {family: number, boundary: number, kind_per_family: number}}, stages: Record<string, Function>, afterAdmit?: Function, candidateRng?: Function, familyOrder?: (family: {store_id: string, ccrc_id: string, generation: string}) => string}} o
 */
export async function sampleQuestions({ families, rng, quotas, stages, afterAdmit, candidateRng, familyOrder }) {
  for (const name of QUIZ_STAGES) if (typeof stages[name] !== 'function') throw new TypeError(`sampleQuestions: no '${name}' stage`);
  for (const name of Object.keys(stages)) if (!QUIZ_STAGES.includes(name)) throw new TypeError(`sampleQuestions: '${name}' is an unknown stage`);
  assertCount('target', quotas.target);
  for (const k of ['family', 'boundary', 'kind_per_family']) assertCount(`caps.${k}`, quotas.caps?.[k]);
  const drops = Object.fromEntries(QUIZ_STAGES.map((n) => [n, {}]));
  const skips = Object.fromEntries(QUOTA_SKIPS.map((w) => [w, 0]));
  const questions = [];
  const reports = {};
  const taken = new Set();
  const ordered = familyOrder === undefined ? [...seededOrder(rng, families, familyKeyOf).entries()] : keyedOrder(families, familyOrder);
  for (const [fi, f] of ordered) {
    if (questions.length >= quotas.target) break;
    const candidates = await f.candidates();
    for (const c of candidates) {
      if (!FACT_KINDS.includes(c.kind)) throw new TypeError(`sampleQuestions: candidate ${JSON.stringify(c.id)} has kind ${JSON.stringify(c.kind)}`);
      if (typeof c.boundary_uuid !== 'string' || c.boundary_uuid === '') throw new TypeError(`sampleQuestions: candidate ${JSON.stringify(c.id)} names no boundary`);
    }
    let inFamily = 0;
    const inBoundary = new Map();
    const inKind = new Map();
    const order = seededOrder(candidateRng === undefined ? rng : candidateRng(f), candidates, (x) => x.id);
    for (const [ci, c] of order.entries()) {
      if (questions.length >= quotas.target) break;
      if (inFamily >= quotas.caps.family) { skips['cap-family'] += 1; continue; }
      if ((inBoundary.get(c.boundary_uuid) ?? 0) >= quotas.caps.boundary) { skips['cap-boundary'] += 1; continue; }
      if ((inKind.get(c.kind) ?? 0) >= quotas.caps.kind_per_family) { skips['cap-kind'] += 1; continue; }
      let cur = c;
      let dropped = null;
      for (const name of QUIZ_STAGES) {
        const v = await stages[name](cur, f);
        if (v.keep === true) { cur = v.candidate; continue; }
        if (typeof v.reason !== 'string' || v.reason === '') throw new TypeError(`sampleQuestions: the '${name}' stage dropped ${JSON.stringify(c.id)} without a reason word`);
        dropped = { stage: name, reason: v.reason };
        break;
      }
      if (dropped !== null) {
        drops[dropped.stage][dropped.reason] = (drops[dropped.stage][dropped.reason] ?? 0) + 1;
        continue;
      }
      inFamily += 1;
      inBoundary.set(c.boundary_uuid, (inBoundary.get(c.boundary_uuid) ?? 0) + 1);
      inKind.set(c.kind, (inKind.get(c.kind) ?? 0) + 1);
      questions.push({ ...cur, rank: [fi, ci] });
      taken.add(familyKeyOf(f));
      if (afterAdmit !== undefined) reports[c.id] = await afterAdmit(cur, f);
    }
  }
  return { questions, families: [...taken].sort(cmpUnit), drops, skips, reports };
}

/** W2-D71's halt floor: fewer questions or fewer families than `haltFloor` (part 1's `quiz.halt_floor`) halts W2 for a
 *  ruling before part 2. Exactly the floor does not. */
export function quizFloor(nQuestions, nFamilies, haltFloor) {
  const short = [];
  if (nQuestions < haltFloor.questions) short.push('questions');
  if (nFamilies < haltFloor.families) short.push('families');
  return { halt: short.length > 0, short };
}

/**
 * The fidelity pilot's boundaries (W2-D71: sourced like the quiz). Families come in seeded order, and within each its
 * boundaries in seeded order (by boundary_uuid), from the one `rng`. The first boundary `admitBoundary` keeps is taken,
 * at most one per family, until `n`. A dropped boundary is counted by its reason. A family is read (`boundaries()`)
 * only when the draw reaches it.
 */
export async function sampleFidelityBoundaries({ families, rng, n, admitBoundary }) {
  if (!Number.isSafeInteger(n) || n < 1) throw new TypeError(`sampleFidelityBoundaries: n=${String(n)} is not a positive integer`);
  const picked = [];
  const drops = {};
  for (const f of seededOrder(rng, families, familyKeyOf)) {
    if (picked.length >= n) break;
    for (const b of seededOrder(rng, await f.boundaries(), (x) => x.boundary_uuid)) {
      const v = await admitBoundary(b, f);
      if (v.keep === true) { picked.push({ family: f, boundary: b }); break; }
      if (typeof v.reason !== 'string' || v.reason === '') throw new TypeError('sampleFidelityBoundaries: a dropped boundary carries a reason word');
      drops[v.reason] = (drops[v.reason] ?? 0) + 1;
    }
  }
  return { boundaries: picked, drops };
}
```

- [ ] **Step 5: Run the describe green, then the whole file.**

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-5a Task 5'
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts
```

Expected:
- the first command: 36 passed;
- the second: every case passes, Tasks 1–4's and W2-4's included.

If the stage-object case reds with a log that matches `Object.keys` order, the loop reads `stages` keys rather than `QUIZ_STAGES`; fix the code. If Task 1's import pin reds, recall.mjs's `EXACT_NAMES` entry and its statement disagree: make them the one text Step 4(a) gives, in this commit.

- [ ] **Step 6: Measure every mutant red, then restore.** Copy the driver to `.superpowers/sdd/history-w2-5a/scratch/task5.orig.mjs` (gitignored; never `git stash`). Apply each mutant below with Edit to `deploy/history-replay.mjs`, and run:

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-5a Task 5'
```

Confirm that the named case(s) red, restore with `cp .superpowers/sdd/history-w2-5a/scratch/task5.orig.mjs deploy/history-replay.mjs`, and go to the next. Record each red case's name in the task's report.

| # | Mutation in `deploy/history-replay.mjs` | Must red |
|---|---|---|
| M1 | delete `if (!SEARCHABLE_PROVENANCE.includes(row.provenance)) return sourceFail('provenance');` | "clause 1: a harness row and an indexed recall-echo row …" (the echo row becomes answerable; the harness row reports clause 2) |
| M2 | delete `if (Number(b.fts_indexed) !== 1) return sourceFail('not-indexed');` | "clause 2: a blob marked unindexed …" |
| M3 | delete `if (b.pruned_ms !== null \|\| b.z === null) return sourceFail('pruned');` | "clause 2: … a pruned blob …" (it reports clause 1 `not-verbatim`) |
| M4 | delete the `s.match.get(ftsPhrase(factRaw), source.blobId)` line | "clause 3: a source the index MATCH does not return …" |
| M5 | `\|\| !t.text.includes(factRaw)` deleted | "clause 1: a phrase the MATCH finds …" |
| M6 | delete `if (row.ts_ms === null) return sourceFail('ts-null');` | "clause 4: a NULL-ts source …" and "clause 4: a sidecar linked to a NULL-ts span row …" |
| M7 | `Number(row.ts_ms) > tsMs` → `Number(row.ts_ms) >= tsMs` | "clause 4: a source stamped exactly T_N …" |
| M8 | delete `if (Number(row.ts_ms) > tsMs) return sourceFail('ts-after');` | the same case, its one-ms-after half |
| M9 | `if (row === null) return sourceFail('unlinked');` → `if (row === null) return { ok: true, entryUuid: null };` | "clause 4: an unlinked sidecar is untimed …" |
| M10 | in `answerStmts`' sidecars SQL, `(entry_id IS NULL OR entry_id IN (SELECT value FROM json_each(?)))` → `(entry_id IS NULL OR entry_id IS NOT NULL OR ? = '')` | "a sidecar linked to a row outside the span is never a source" (it answers `untimed`) |
| M11 | in `answerability`, move the `...s.sidecars.all(...)` spread before the `...rows.map(...)` spread | "sources are tried rows first …" |
| M12 | delete `if (v.clause === 4) untimed = true;` | every `untimed` expectation, and the stage case's `unanswerable-untimed` |
| M13 | in `answerableStage`, swap the two reason literals | "answerableStage keeps …" |
| M14 | `count(DISTINCT e.entry_id)` → `count(*)` | "counts the entries outside N holding copy …" (5) |
| M15 | delete the `AND NOT EXISTS (SELECT 1 FROM memberships …)` line, close the template literal after the previous line, and delete the `hold` key from the bound object (measured: an unbound or unknown named parameter is a different red) | the same (6) |
| M16 | `WHERE e.ts_ms = :t` → `WHERE e.ts_ms <= :t` | the same (5); the hand-picked fixture places one row at T_N − 1 |
| M17 | delete `AND e.transcript_pk IN (SELECT value FROM json_each(:tpks))` and its `tpks` key | the same (5) |
| M18 | delete the `UNION SELECT v.entry_id, 'row' …` line | the same (3) |
| M19 | delete the `UNION SELECT s.entry_id, 'sidecar' …` line | the same (3) |
| M20 | delete `AND (h.via = 'sidecar' OR e.provenance IN …)` and its `provs` key | the same (5) |
| M21 | in `seededOrder`, delete `keyed.sort((a, b) => cmpUnit(a[0], b[0]));` | "seededOrder sorts by key …" (the reversed input) and "families in seeded order …" (the reversed run) |
| M22 | `randInt(rng, out.length - s)` → `randInt(rng, out.length - s - 1)` | "seededOrder sorts by key …" (the vectors) |
| M23 | delete the duplicate-key loop in `seededOrder` | "seededOrder refuses a key listed twice" and the malformed-inputs case's repeated id |
| M24 | `substream(recordSeedHex, 'quiz-sample')` → `substream(recordSeedHex, PILOT_SUBSTREAM)` | "seededOrder sorts by key …" |
| M25 | `substream(pilotSeedHex, PILOT_SUBSTREAM)` → `substream(pilotSeedHex, 'quiz-sample')` | "seededOrder sorts by key …" and "fidelity boundaries …" |
| M26 | `const b = draw(32);` → `const b = draw(16);` | "drawSeedHex is 32 drawn bytes …" |
| M27 | in `sampleQuestions`, `seededOrder(candidateRng === undefined ? rng : candidateRng(f), candidates, (x) => x.id)` → `[...candidates].sort((a, b) => cmpUnit(a.id, b.id))` | "families in seeded order …" |
| M28 | `for (const name of QUIZ_STAGES) {` (the stage loop) → `for (const name of Object.keys(stages)) {` | "the stages run in QUIZ_STAGES order …" |
| M29 | in the stage loop, replace `dropped = { stage: name, reason: v.reason };` and the `break;` after it with `dropped ??= { stage: name, reason: v.reason };` | "lazy: a candidate a stage drops …" |
| M30 | `inFamily >= quotas.caps.family` → `inFamily > quotas.caps.family` | "the family cap …" |
| M31 | `>= quotas.caps.boundary` → `> quotas.caps.boundary` | "the boundary cap …" |
| M32 | `>= quotas.caps.kind_per_family` → `> quotas.caps.kind_per_family` | "the kind cap …" |
| M33 | move `inFamily += 1;` to directly after the three cap checks, before the stage loop | "a cap counts admitted questions only …" |
| M34 | delete the inner loop's `if (questions.length >= quotas.target) break;` | "the target stops the draw …" |
| M35 | delete the outer loop's `if (questions.length >= quotas.target) break;` | the same (the second family is mined) |
| M36 | replace `if (afterAdmit !== undefined) reports[c.id] = await afterAdmit(cur, f);` with `if (afterAdmit !== undefined) { reports[c.id] = await afterAdmit(cur, f); if (reports[c.id].asof_same_ms_hits > 0) questions.pop(); }` (measured: appending the `if` after the unbraced statement runs it with no `afterAdmit` and reds eleven cases, not the one) | "the same-millisecond report never gates …" |
| M37 | each of the six `TypeError` guards in `sampleQuestions` deleted in turn (missing stage, unknown stage, reason-less drop, target quota, kind, and the caps loop's quota, measured green until the malformed-inputs case gained its `caps.boundary` line) | "malformed sampler inputs are defects …", at the matching `rejects` |
| M38 | `controlIds.add(canonicalJson([a.store_id, a.ccrc_id]))` and its reader → keyed by `familyKeyOf(a)` / `familyKeyOf(f)` | "the population drops …" (`fam-a` g2 is kept) |
| M39 | the same keys → `a.ccrc_id` / `f.ccrc_id` | the same (the s2 `fam-a` is dropped) |
| M40 | `pilot.has(familyKeyOf(f))` → `pilotFamilies.some((p) => p.ccrc_id === f.ccrc_id)` | the same (`fam-c` g2 is dropped) |
| M41 | delete `if (f.admitted === 0) excluded['no-admitted-boundary'] += 1;` and make the next `else if` an `if` | the same |
| M42 | `nQuestions < haltFloor.questions` → `<=`; then, separately, `nFamilies < haltFloor.families` → `<=` | "the halt floor …" |
| M43 | in `sampleFidelityBoundaries`, delete the `break;` after `picked.push(...)` | "fidelity boundaries …" |
| M44 | `familyScopeOf`'s return → `db.prepare('SELECT DISTINCT t.transcript_pk AS p FROM epochs e JOIN transcripts t ON t.cc_session_uuid = e.cc_session_uuid JOIN sessions s ON s.session_pk = e.session_pk WHERE s.ccrc_id = ? ORDER BY p').all(f.ccrc_id).map((r) => Number(r.p))` | "familyScopeOf is recall.mjs's own family scope …" (`[1, 2]`) |
| M45 | `candidateRng === undefined ? rng : candidateRng(f)` → `rng` | "each question carries its rank …" (a family drawn after another family that holds candidates ranks its own differently alone; predicted red for at least one of the three) and "the quiz's keyed family order …" (the candidates come off the one quiz stream, so the recorded vector moves and node A's ranks are not the one walk's) |
| M46 | `questions.push({ ...cur, rank: [fi, ci] });` → `questions.push({ ...cur, rank: [fi, 0] });` | "each question carries its rank …" (ranks repeat) and "the quiz's keyed family order …" (`[key, 0]` where `[key, 1]` was expected) |
| M47 (R10) | in `keyedOrder`, delete `pairs.sort((x, y) => cmpUnit(x[0], y[0]));` | "the quiz's keyed family order …" (the families stay in input order: `a3, a2, a1, b1, b3, b2, …` where `a3, a2, a1, d2, …` was expected) |
| M48 (R10) | in `quizFamilyOrderKey`, `` sha256Hex(`${sha256Hex(`${recordSeedHex}:quiz-sample`)}:${familyKeyOf(family)}`) `` → `` sha256Hex(`${recordSeedHex}:${familyKeyOf(family)}`) `` | "the quiz's keyed family order …" (the recomputed key: the record seed hashed with `familyKey` directly is not the substream seed's) |
| M49 (R10) | delete the duplicate-key loop in `keyedOrder` | "the quiz's keyed family order …" (one family given twice resolves where `/listed twice/` was expected) |
| M50 (R10) | in `sampleQuestions`, `familyOrder === undefined ?` → `true ?` | "the quiz's keyed family order …" (the families are drawn from the quiz stream, and each rank's first member is a number, not the family's key) |

Then measure the pair the residual names: apply M4, and also replace `indexTextOf`'s body with a whole decode (`return { state: 'text', text: new TextDecoder().decode(zlib.brotliDecompressSync(b.z)) }`, with the import made for this run only). The sidecar-window case reds only with both applied. Record that, and restore.

- [ ] **Step 7: Run the neighbours that scan `deploy/` or the driver.**

```bash
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts
cd server && ./node_modules/.bin/vitest run test/citations.test.ts
cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts
```

Expected, all green:
- O13 finds no switch path and no recall-off writer in the new section;
- O14 finds no `VOCABS` name declared;
- citations finds no added `.mjs:N` citation (this section's comments cite none);
- the test file typechecks;
- the gate's own suite is unchanged, because this task only imports it.

`typecheck-tests` is a known load flake. Re-run it in isolation before calling a red a break.

- [ ] **Step 8: Run the whole history-replay file once more, in the foreground, with a timeout of at least 600000 ms.** It is the file this commit touches. Every task's cases must pass at this commit.

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts
```

- [ ] **Step 9: Check D-5780's entry, then the ledger refs.** The entry below is written into the plan's `## Deviations found` with the plan. This step checks it is there once and adds no second one:

```bash
grep -c '^- \*\*D-5780\*\* — `history-w2-answerable-timed`' docs/superpowers/plans/2026-10-22-ccrc-history-w2-5a-quiz-builder.md
grep -c 'D-5780' deploy/history-replay.mjs
git fetch origin main
cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts
```

Expected: 1, then at least 1 (the section's header comment cites it), then green. A count other than 1 for the entry stops the task: report it, and never add the entry from a task.

- [ ] **Step 10: Commit.**

```bash
git add deploy/history-replay.mjs server/test/history-replay.test.ts
CO_AUTHORED_BY='<the Co-Authored-By line the attribution reminder gives>'
git commit -m "feat(history-replay): answerability with its timed clause, the same-millisecond count and seeded sampling (W2-5a Task 5; W2-D70, W2-D34, W2-D71; D-5780)" -m "$CO_AUTHORED_BY"
```

**Deviations found entry:** D-5780's, in this plan's `## Deviations found` (Task 5 is the first task section that cites it).


**How the tests stay off the live fleet.**
- Every store is a hand-built `createStore` under a `mkTmp` HOME, written through `openWriter` and read through `openReader`.
- No case runs a sweep pass, a CLI verb or the shim, and none spawns a process: no `claude`, `ccrc` or `gh` is reached, so W2-4's stub and poisoned-`gh` contract is not needed.
- No roster, `~/.ccrc`, `~/.cc-sessions` or account home is read.
- The only fixture text that names a path is `tool-results/big51.txt`, a sidecar name.
- No key-shaped value is planted: the pair index is empty, and redaction is Task 4's.
- Fixture family ids are `fam-a` to `fam-d`, store ids `s1` and `s2`, and seeds `'ab'.repeat(32)`.


### Task 6: The question writer, the frozen lists, and the fidelity pilot's payloads and arithmetic

Tasks 1 to 5 leave the driver able to read a boundary, admit it (RP5), mine and redact its candidate facts, build Baseline B, test answerability and walk the candidates in seeded order. Nothing yet writes a question, and nothing freezes a list. This task adds the pieces Task 7 wires into `pilot-source`, `quiz-source` and `freeze`, and `sourceQuiz`, which composes Tasks 1 to 6 in W2-D71's order. It registers no subcommand.

- **The writer (W2-D72; D-5779).** There is one spawn per candidate, in writer mode (`--tools ""`), through W2-4's contract and nothing else: `launchRun` reached through `runBatch`, under `batchGate`, on a claimed `--out`. The steps:
  - `openWriter` refuses a writer model that is not an exact Opus id.
  - It admits the account from the roster (W2-D52). A gateway account is refused here, before any spawn (RP3-writer).
  - It builds the limits and budget gate (W2-D55) and runs W2-D56's preflight before the first spawn. The preflight compares against the values the caller hands it: step 0a's output before part 1, part 1's values after it.
  - Every ask runs the preflight again and is a batch of one. So the soft budget overshoots by at most one run.
- **The writer's input.** It is canonical `{v: 1, kind, fact, excerpt}`, built in this order:
  - the raw leaf, redacted whole first (W2-D54);
  - then windowed to 4,000 code points, centred on the raw fact's first occurrence;
  - for a tool_result, one line for its paired tool_use, redacted whole and capped at 2,000 code points;
  - 8 KiB of UTF-8 in all.
  Under `writer_input: 'leaf-span'`, leaf N's whole span, each leaf redacted whole, goes within the same budget.
- **The reply.** It goes through the gate's `parseQuestionLine` and the question through the gate's `admitFact`. `writer-malformed` and `writer-leak` are discarded and never retried.
- **The frozen lists (W2-D73).** Each is exactly the bytes of `canonicalJson`, with no trailing newline and entries sorted by qid.
  - `writeFrozenList` writes `<out>/quiz/frozen.json` (for `freeze`) or `<out>/pilot/frozen.json` (for `pilot-source`). It never replaces a list it finds with a different one.
  - `loadFrozenList` checks the sha256 before it parses a byte, so every consumer refuses `quiz-sha-mismatch` before any spawn.
- **The fidelity pilot's payloads and arithmetic** (spec §10.2, FE8).
  - Three stdins per fidelity boundary, all through Task 1's composer: the reconstructed payload, the empty-question run (which carries `ANSWER_PROTOCOL` as every composed stdin does, W2-D64) and a user-text run.
  - The original side's figures, read from the store's rows.
  - The arithmetic that nets each side of its own fixed overhead.
  - The spawns, the ±25% tolerance and the pass/fail verdict are W2-5b's (`fidelity`).
- **`sourceQuiz`, Tasks 1 to 6 composed (W2-D71).** One node's sourcing run over its open store: the admitted boundaries (Task 3), each family's candidates mined from its leaf spans and deduplicated (Tasks 1, 2), each given its qid as `id` (R4), then the stages in `QUIZ_STAGES` order (redaction and producer, Task 2; admission against B, built once per boundary, Task 4; answerability, Task 5; the writer and the question's own admission, here), the same-millisecond count over the CLI's family scope (Task 5), the baseline record, and every count. In quiz mode the walk is every family this node's store holds with an admitted boundary, less the pilot families and every control-held `(store_id, ccrc_id)` (W2-D71, W2-D77), never the census's active list, which feeds the assignment only (W2-D73; a quiz family need not be active or registry-resolvable, W2-D40); the families come in `quizFamilyOrderKey` order and each family's candidates from its own stream, so every question's `rank`, `[order key, candidate rank]`, is the walk over every node's families (R4, R10). In pilot mode the walk is this node's, after the fidelity boundaries. The writer is a parameter, Task 6's handle (R6).

RP1-writer and RP3-writer land here (W2 decisions document §2, W2-5a's Pins). Nothing here spawns a real model: every spawn reaches W2-4's recording stub in a fixture `HOME`.

**Files:**
- Modify: `deploy/history-replay.mjs`.
  - Task 1's import statement from `./history-gate.mjs`: merge in the names Step 4 lists, so there is still one statement per module. `isSyntheticModel` is already in lib's statement (Task 2). No module is added (R3).
  - `readStreamJson` (about :625 at cd622b2f6), and the `StreamFacts` typedef above it (about :623). One field is added, `firstCallUsage`, read from the `messages` map the function already builds. Nothing else in the function changes.
  - One new section, inserted directly above the comment line `// The entry guard stays the LAST block of this file`, after Task 5's section.
- Modify: `server/test/history-replay.test.ts`.
  - In W2-4 Task 4's case `an empty stream is no init, no result and no usage: zeros with usageSource none` (about :873 at cd622b2f6), the expected object gains `firstCallUsage: null`. This is the one W2-4 assertion this task re-expects, because the reader's answer gains a field.
  - Import lines directly after the file's last `import` line. Each binds only new `w6`-prefixed names.
  - One block appended at the end of the file, with the module-level `w6SourceBox`, which Task 7 reuses.
- Not edited: every other file. No new file is created: the stub, the fixture HOME and the roster helpers are W2-4's, already in the test file.

**Interfaces:**
- Consumes (W2-4, at cd622b2f6; names exact):
  - `readRoster(home) -> {json, roster}` and `admitAccount(json, roster, id, home) -> LaunchSpec`. The refusal is `account-refused` with `kind-codex`, `kind-external` or `provider-openai`.
  - `batchGate({out, home, accountId, budget, limits}) -> () => void` and `LIMITS_DEFAULTS`.
  - `wrapperSha(launch) -> string | null`, `measureClaudeVersion(launch, out, lang) -> Promise<{state:'value', version} | {state:'failed', …}>`, `readReleaseStamp(home)`, `codeShas()`, and `preflight(expected, {version, stamp, wrapperSha256, codeShas}, {allowCodeChange}) -> {ok: true, stamps} | {ok: false, word, detail}`. Here `expected` is `{claude_code_version, release_stamp, wrapper_sha256, code_shas}`, the shape `loadStep0a` answers.
  - `runBatch(jobs, {concurrency, gate, claim}) -> Promise<RunOutcome[]>`, with `RunJob` `{launch, mode, model, settingsMode, stdin, out, name, lang}` and `RunOutcome.facts: StreamFacts`. `claimOut` is used through the tests' `claimFor`.
  - `redactForSpawn({text, rawLen}, idx) -> {state:'text', text} | {state:'discard', why:'over-decode-cap'}` and `readStreamJson(text) -> StreamFacts`.
  - The module-private `requireClaim`, `refuseIfStopping`, `readPlain`, `writePlain`, `ensurePlainDir`, `shaOfPlain`, `badWord`, `sjResultText`, `SHA256_RE`, `OUT_JSON_CAP` and `SETTINGS_ARGV`. They are reachable because this section is in the same module.
  - Test side: `runDriver`, `claimFor`, `claimedBatch`, `plantStub`, `stubLog`, `STUB_STREAM`, `T5_STUB_LOG`, `T5_TOKEN`, `T5_BASE_KEYS`, `T5_RECALL_KEYS`, `T5_BASH_KEYS`, `T5_NEVER_KEYS`, `T5_NO_GATE`, `t5Argv`, `t5job`, `withoutDarwinAdded`, `FIXTURE_ACCOUNTS`, `writeRoster`, and the module-level imports `replay`, `DriverRefusal`, `sha256Hex`, `mkTmp`, `rosterFromJson`, `generateWrapperBody`, `t4Lib`.
- Consumes (W2-3's gate, at cd622b2f6): `WRITER_PROMPT`, `WRITER_PROMPT_SHA256`, `ANSWER_PROTOCOL`, `ANSWER_PROTOCOL_SHA256`, `WRITER_INPUTS` (`['excerpt','leaf-span']`), `FACT_KINDS`, `LABELLER`, `EXACT_MODEL_ID_RE`, `OPUS_MODEL_RE`, `parseQuestionLine(reply) -> {ok: true, question} | {ok: false, word: 'writer-malformed'}` and `admitFact(kind, F, baselineText, questionText, {repoRoots}) -> {admitted, hit: null | {where, variant}}`.
- Consumes (lib, at cd622b2f6): `canonicalJson`, `sha256Hex`, `isSyntheticModel`; and in tests `makePairIndex`, `redactField`, `REDACTED_MARK` and `BLOB_DECODE_MAX`.
- Consumes (earlier W2-5a tasks). Step 1 checks each name and stops if one is missing; it never defines one here:
  - Task 1's composer, `composePayload(parts, question) -> string`. This is reconstruction items 1 to 3 (W2-D75), and item 3 is the question followed by `ANSWER_PROTOCOL` (W2-D64). It must accept `''` as the question: W2-D64 says the empty-question run carries the protocol. `parts` is `{summary: string, kept: readonly string[]}`, already redacted.
  - Task 1's role tag, `renderToolUseLine(name, inputText) -> string`, which gives `[tool_use <name>] <input>` (W2-D75).
  - Task 2's mined candidate, the one candidate shape (R4), whose first twelve fields are the `WriterItem` below: `store_id`, `ccrc_id`, `generation`, `boundary_uuid`, `kind`, `fact` (F), `fact_raw` (F_raw), `source_entry_uuid`, `repo_roots`, `leaf: {text, rawLen}` (the raw leaf F_raw was mined from), `pair: {name, input: {text, rawLen}} | null` (a tool_result's paired tool_use), and `span: Array<{text, rawLen}>` (leaf N's span, in holding-copy order). Test side: Task 2's `w5a2Akia`, `w5a2Span`, `w5a2Use`, `w5a2Result`, `w5a2Mine` and `w5a2MinedOf` (R7).
  - Task 5's sampler, which runs the writer as its `writer` stage (R6: the writer as a parameter); `sourceQuiz` adapts `handle.ask(section, item)` into that stage.
  - For `sourceQuiz`: Task 1's `openReplayStore` (`rs`), `spanRowsOf`, `reconstructPayload`; Task 2's `mineBoundary`, `dedupeFamily`, `screenRedaction`, `screenProducer`, `screenBaseline`, `newDropCounts`, `rosterConfigDirs`; Task 3's `admitStoreBoundaries`; Task 4's `baselineOf`, `baselineRow`, `writeBaselineRecord`; Task 5's `answerableStage`, `sameMsReport`, `familyScopeOf`, `quizRng`, `pilotRng`, `familyRng`, `quizFamilyOrderKey` (R10), `quizPopulation`, `sampleQuestions` (with its `familyOrder` option), `sampleFidelityBoundaries` and the module-private `familyKeyOf`. Test side: Task 1's `w5a1H`, `w5a1Fx` and `w5a1BeforeAll`.
- Produces (`deploy/history-replay.mjs`):
  - `WRITER_LEAF_WINDOW = 4000`, `WRITER_PAIR_CAP = 2000`, `WRITER_EXCERPT_MAX_BYTES = 8192`;
  - `WRITER_SECTIONS = Object.freeze(['quiz','pilot'])`;
  - `FROZEN_LIST_KINDS = Object.freeze({quiz: 'ccrc-history-w2-quiz', pilot: 'ccrc-history-w2-pilot'})`, `FROZEN_LIST_FILE = 'frozen.json'`, and `FROZEN_ENTRY_KEYS`, the eleven entry keys sorted;
  - `FIDELITY_RUNS = Object.freeze(['payload','empty','user-text'])` and `FIDELITY_EMPTY_PARTS = Object.freeze({summary: '', kept: []})`;
  - `windowExcerpt({base, factRaw, firstWindow, pairLine}) -> {state:'text', excerpt} | {state:'discard', why:'writer-input-over-cap'}`. It is pure. A `factRaw` that does not occur in `base` is a `TypeError`;
  - `writerInputOf(item: WriterItem, writerInput: 'excerpt'|'leaf-span', idx) -> {state:'input', input:{v:1, kind, fact, excerpt}} | {state:'discard', why:'over-decode-cap'|'writer-input-over-cap'}`. It is pure;
  - `writerStdin(input) -> string`, exactly `` `${WRITER_PROMPT}\n\n${canonicalJson(input)}\n` ``;
  - `qidOf({store_id, ccrc_id, generation, boundary_uuid, kind, fact}) -> string`, which is `sha256Hex(canonicalJson([store_id, ccrc_id, generation, boundary_uuid, kind, fact])).slice(0, 16)` (W2-D73);
  - `openWriter({home, accountId, model, settingsMode, writerInput, claim, budget, limits, expected, allowCodeChange?, lang, idx}) -> Promise<WriterHandle>`. `WriterHandle` is `{launch, stamps(): string[], ask(section, item: WriterItem): Promise<WriterAnswer>}`. `WriterAnswer` is one of:
    - `{state:'question', qid, entry: FrozenEntry, run}`;
    - `{state:'discard', qid, why:'over-decode-cap'|'writer-input-over-cap'}`, with no spawn;
    - `{state:'discard', qid, why:'writer-malformed'|'writer-leak', run}`.
    `run` is `{code, signal, skipped, tokens, result}`, `result` false for a run that showed no result event. `sourceQuiz` takes the handle and calls `handle.ask(mode, candidate)` as its writer stage (R6);
  - `frozenListText(section, {writer_model, labeller}, entries: FrozenEntry[]) -> string`. It is pure. `FrozenEntry` is `{qid, store_id, ccrc_id, generation, boundary_uuid, kind, fact, fact_raw, question, source_entry_uuid, repo_roots}`;
  - `writeFrozenList(out, section, text) -> string`, the sha256 of the bytes on disk;
  - `loadFrozenList(p, sha256, section) -> object`, the parsed list;
  - `usageInputOf(body) -> number | null`, `userTextOf(body) -> string | null`, and `originalSideOf({epochRows, copyRows, summaryIndex}) -> {state:'measured', firstInput, postInput, userRows} | {state:'unmeasured', why}`;
  - `fidelityStdins(rs, boundaryEntryId, userRows) -> {state:'stdins', stdins:{payload, empty, 'user-text'}} | {state:'discard', why:'over-decode-cap' | a RECON_DISCARDS word}`. Its payload stdin is `reconstructPayload(rs, boundaryEntryId, '')`'s own text, so the summary and kept members come redacted from the one reconstruction and no caller hands it raw parts (W2-D54); W2-5b, which spawns the three, gets them only through it;
  - `fidelityFigures({original, runs}) -> {state:'measured', original_payload, replay_payload, original_overhead, replay_overhead, user_text_tokens} | {state:'unmeasured', why}`;
  - `StreamFacts.firstCallUsage: StreamUsage | null`, a new field of `readStreamJson`'s answer;
  - `'writer-input-over-cap'`, appended to `FACT_DROP_REASONS` after Task 5's words (R5). The writer's two discards stay the gate's `GATE_REASONS`; `over-decode-cap` is Task 1's `RECON_DISCARDS` word, which the writer stage counts under its stage;
  - `sourceQuiz({mode, rs, home, out, writer, seedHex, exclude: {pilotFamilies, assignment}, plan: {target?, n_fidelity?, n_usage?, caps}, configDirs, top?}) -> Promise<{entries: Array<FrozenEntry & {rank: [string | number, number]}>, fidelity: Array<{store_id, ccrc_id, generation, boundary_uuid}>, counts: object, asof_same_ms_hits: Record<qid, {asof_same_ms_hits}>}>`. It takes no family list: both modes walk the families this node's store holds with an admitted boundary, and quiz mode drops the excluded ones (`quizPopulation`, counted in `counts.population`), never reading the census's active list (R10). A quiz entry's `rank` is `[quizFamilyOrderKey, candidate rank]`; a pilot entry's is `[family index, candidate rank]` in the pilot's drawn order, and `pilot-source` strips it (one node, never merged). `top` passes to Baseline B as its test seam (no subcommand passes it);
  - module-private `refuseWriterModel(model)`: `args-invalid` unless `model` is an exact Opus id (the gate's `EXACT_MODEL_ID_RE` and `OPUS_MODEL_RE`). `openWriter` calls it before admission, and Task 7's `pilot-source` calls it before `prepareOut` makes `--out` (R10);
  - test side, module level: `W6SourceBox` and `w6SourceBox(prefix, cmd?)`, a HOME whose store the real sweep built from one family whose leaf holds one minable command fact (`cmd`, a plain build command by default), which Task 7's end-to-end walk reuses.

**Spec:** §10.2 (at cd622b2f6, about :2628):
- "Reconstruction" items 1 to 3;
- "**Fidelity pilot**": the original side net of "that session's fixed overhead, measured as the input tokens of its epoch's first call less that call's user text", and the replay side as "first-call input tokens (`input + cache_creation + cache_read`) … minus an empty-question run under the same flags";
- "Who sees what": the writer sees redacted text only, F and its span, never an arm's output;
- "How they run" (SE10): through the driver's spawn contract, `--tools ""`, the account allow-list, inputs on stdin and outputs under `--out`;
- the pins RP1 and RP3 (about :2752 and :2754), their writer halves.

**Decisions:**
- W2-D72: the writer spawn, its input, its model, `writer_input`, and its two discard words. D-5779 is cited bare; W2-3's plan defines it.
- W2-D73: the frozen list, `qid`, kind `'ccrc-history-w2-pilot'` written by `pilot-source`, and consumers recomputing the sha before any spawn.
- W2-D64: the empty-question run carries `ANSWER_PROTOCOL`. D-5776 is cited bare; W2-3's plan defines it.
- W2-D54: redact whole, then window.
- W2-D67: a span holding a secret reaches the writer's stub redacted; and (R10, F6) a fact whose F redaction masks never reaches the writer, whose input carries F.
- W2-D71 as amended in place on 2026-10-22 (R10): `sourceQuiz`'s quiz population and its keyed family order.
- W2-D52, W2-D55 and W2-D56: the writer goes through admission, the gate and the preflight.
- W2-D61: F_raw for the excerpt's centring, F for admission.

This task defines no D-number.

**Choices this task makes:**
- **The preflight runs before every writer batch, inside `openWriter` and `ask`.** W2-D56 is written "before every batch", and its wiring is assigned to W2-5b. W2-4's plan ("Not in this plan") puts `loadStep0a` and `preflight` into `pilot-source`, which is W2-5a's. A writer handle that runs them itself means no subcommand can spawn a writer un-preflighted.
  - The order inside each preflight is step 0a's: `wrapperSha` (so `wrapper-unmeasured` refuses before any spawn), then the gate, then `measureClaudeVersion` (a spawn that spends nothing), then `refuseIfStopping`, then `preflight`.
  - A measured `code-changed` under `allowCodeChange` becomes a stamp the handle reports (`stamps()`), never a silent pass.
- **One candidate per batch, concurrency 1.** W2-D71's filters run lazily in seeded order, and the writer is one of them, so the next candidate depends on this one's outcome. A batch of one keeps the order deterministic, and holds the soft budget's overshoot to one run (W2-D55's c = 1).
- **A writer model that is not an exact Opus id refuses `args-invalid` before admission.** The open-record validator enforces Opus at part 1 (W2-D25). `pilot-source` spawns writers before part 1 exists, so a wrong id would otherwise spend first and be refused later. The test is the gate's own pair, `EXACT_MODEL_ID_RE` and `OPUS_MODEL_RE`, so no second spelling exists. It is one module-private function, `refuseWriterModel`, which `openWriter` calls and Task 7's `pilot-source` calls again before `prepareOut`, so a refused model leaves no `--out` (R10); `frozenListText`'s own `TypeError` on the same pair guards a list's head, not an argv.
- **Quiz mode walks this node's own admitted families (R10, C1).** W2-D71's population is every family with a W2-D66-admitted boundary, less the pilot families and every control-held `(store_id, ccrc_id)` (W2-D77). The census's active, registry-ok list feeds only the assignment (W2-D73), and the headless arm resolves a family from its epochs, never the registry (W2-D40), so a quiz family need not be in it. `sourceQuiz` therefore takes no family list: it groups the store's admitted boundaries into families, `quizPopulation` drops the excluded ones (counted), and the rest are walked in `quizFamilyOrderKey` order with `familyRng` candidates. Each node orders its own families exactly as the order over every node would, so `freeze` merges by rank (Task 7).
- **The excerpt is measured in code points, and the budget in UTF-8 bytes of the excerpt.** W2-D72 says "4,000 characters", "2,000 characters" and "8 KiB in all". Characters are code points here, as W2-4's `cutToolResult` counts them, so a surrogate pair is never split. "8 KiB" is 8,192 bytes of the excerpt's UTF-8.
  - When the excerpt is over the budget, the leaf window shrinks around the same centre until it fits, and it never shrinks below the raw fact.
  - A raw fact that cannot fit at all is discarded as `writer-input-over-cap`. This drop word is new and counted. It fills a gap W2-D72 leaves (what to do when the budget cannot hold the fact), it is not a departure, and in practice no fact reaches it: commands and errors are at most 300 characters (W2-D65).
- **The window is centred on F_raw's first occurrence in the REDACTED leaf.** W2-D67 guarantees that F_raw still occurs verbatim there, so its absence is a defect (`TypeError`), never an empty excerpt.
- **Each ask pins its input bytes beside its stream** as `<out>/<section>/writer/<qid>.input.json`, written before the spawn. A resumed ask whose run.json exists is skipped by `runBatch` (W2-D53), which compares account, mode, model and settings mode but not stdin. A resume that would build on a question written from other input (a widened redaction set, a changed excerpt rule) therefore refuses `out-refused` `writer-input-changed <rel>` instead of reusing it. The file holds only the redacted input the stub was given, which is no more than its stream-json beside it.
- **A writer run that fails, or shows no result event, is `writer-malformed`** (W2-D72's two words, no stop and no new word; R6). A run with no `QUESTION:` line is a malformed reply. The answer carries `run` (`code`, `signal`, `skipped`, `tokens`, `result`), so `sourceQuiz` counts failed runs (a non-zero exit, a signal, no result event) apart from malformed replies, and Task 7's sourcing subcommands print one warning line when any run failed.
- **`sourceQuiz` builds B once per boundary, lazily.** A boundary's B is built the first time one of its candidates reaches `admit-baseline`, and every built or discarded B is a row of the baseline record. A B discard drops the candidate under its `RECON_DISCARDS` word, counted under the stage.
- **The question's source is answerability's.** The writer stage asks with `source_entry_uuid` set to the source answerability found (W2-D73: the first source that passes), which is the mined row or, for a sidecar, its linked row.
- **The frozen list is exactly `canonicalJson`'s bytes, with no trailing newline** (W2-D73: "exactly the bytes of"). W2-4's `step0a.json` and `probe.json` add `'\n'`; this list does not.
  - `writer_prompt_sha256` and `answer_protocol_sha256` are the gate's module constants, the texts this driver sent. `writer_model` and `labeller` are parameters.
  - Each entry's qid is recomputed. A list that holds a wrong qid, a repeated qid, an unknown kind or an extra key is a `TypeError`.
- **A frozen list, once written, is never replaced by a different one.** Writing the same bytes again is a no-op that answers the same sha. A different list over it refuses `out-refused`, and the remedy is a fresh `--out`. The sha that `freeze` or `pilot-source` printed must name the bytes that stay.
- **`loadFrozenList` hashes before it parses.** It then re-renders the list from its own fields and refuses `input-invalid` when the bytes are not that canonical rendering. So a hand-edited list whose sha was recomputed still refuses.
- **The original side's "user text" is measured by a third run.** The spec nets the epoch's first call of "that call's user text", and no tokenizer ships here. The user-text run sends the epoch's first-call operator text, redacted, as the question of an otherwise empty composition. So the user text's tokens are `R(user-text) − R(empty)`, measured by the same model on the same flags.
  - The original's fixed overhead is `first-call input − user-text tokens`, and its payload is `first post-boundary call input − that overhead`.
  - The replay side's payload is `R(payload) − R(empty)`.
  - The record keeps both overheads (§10.2: "The pilot records each difference").
- **Unmeasured is never zero.** A run whose first message carried no usage, an original row with no usage, an overhead below zero, or a payload at or below zero answers `unmeasured` with its own reason. It is never folded into 0. W2-5b treats an unmeasured boundary as a failed pilot (a halt), never as a pass.
- **`firstCallUsage` is the first message's own usage.** That is the first message the stream showed, by first-seen `message.id`, with the last usage its events carried. When that message carried none it is null, never a later message's usage.

- [ ] **Step 1: Confirm the earlier tasks' names before using them.** From the repository root:

```bash
node --no-warnings --input-type=module -e "const d = await import('./deploy/history-replay.mjs'); const g = await import('./deploy/history-gate.mjs'); const need = ['readRoster','admitAccount','batchGate','LIMITS_DEFAULTS','wrapperSha','measureClaudeVersion','readReleaseStamp','codeShas','preflight','runBatch','redactForSpawn','readStreamJson','claimOut','prepareOut','composePayload','renderToolUseLine','openReplayStore','spanRowsOf','reconstructPayload','mineBoundary','dedupeFamily','screenRedaction','screenProducer','screenBaseline','admitStoreBoundaries','baselineOf','writeBaselineRecord','answerableStage','sameMsReport','familyScopeOf','familyRng','quizFamilyOrderKey','quizPopulation','sampleQuestions','sampleFidelityBoundaries']; console.log(need.map((n) => n + ':' + typeof d[n]).join(' ')); console.log(d.composePayload({ summary: '', kept: [] }, '').endsWith(g.ANSWER_PROTOCOL), d.renderToolUseLine('Bash', 'ls')); console.log(['openWriter','qidOf','frozenListText','windowExcerpt','sourceQuiz'].map((n) => typeof d[n]).join(','), 'firstCallUsage' in d.readStreamJson(''))"
grep -c "from './history-gate.mjs';" deploy/history-replay.mjs
grep -c "^  'unanswerable', 'unanswerable-untimed',$" deploy/history-replay.mjs
grep -c '\bw6[A-Z][A-Za-z]*\b' server/test/history-replay.test.ts
```

Expected:
- The first command prints every name in `need` as `function` (and `LIMITS_DEFAULTS:object`). Next it prints `true [tool_use Bash] ls`. Then it prints `undefined,undefined,undefined,undefined,undefined false`. Importing the module runs nothing: the entry guard needs `process.argv[1]`, which `-e` leaves undefined.
- The driver imports the gate in one statement (count 1), Task 1's; Task 1 also repaired W2-4 Task 8's `t8Tree` to copy the real gate.
- `1`: Task 5's line of `FACT_DROP_REASONS`, which this task appends after.
- No `w6`-prefixed names exist yet (count 0). A `grep -c` that prints 0 exits 1, which is expected.

Any other answer is a gap in an earlier task: stop and report it. In particular:
- a `composePayload` that refuses `''` as the question, or whose parts are not `{summary, kept}`, changes `FIDELITY_EMPTY_PARTS` and every fidelity case below;
- a `renderToolUseLine` that takes the tool_use input object rather than its text changes `writerInputOf`'s pair line.
Never define any of these names here.

- [ ] **Step 2: Write the failing tests.** In `server/test/history-replay.test.ts`, in W2-4 Task 4's case `an empty stream is no init, no result and no usage: zeros with usageSource none`, replace

```ts
      permissionDenials: null, result: null, assistantMessages: 0, malformedLines: 0,
```

with

```ts
      permissionDenials: null, result: null, assistantMessages: 0, malformedLines: 0, firstCallUsage: null,
```

Directly after the file's last `import` line, insert:

```ts
import * as w6Gate from '../../deploy/history-gate.mjs';
import { createHash as w6Hash } from 'node:crypto';
```

Then append at the end of the file:

```ts
// ── W2-5a Task 6: the question writer, the frozen lists, the fidelity pilot (W2-D72, W2-D73, W2-D64; D-5779) ──────
// Live safety: every spawn reaches W2-4's recording stub at `$HOME/.local/bin/<id>` in a mkTmp fixture HOME, through
// spawnEnv's allow-list, with the poisoned gh first on PATH. gen-a goes through its real generated wrapper over the stub.
// Every --out is a prepareOut directory under that HOME, claimed with claimFor. Limits rows and the release stamp are
// fixture files. Only the sourceQuiz describe opens a store: the real sweep's store in a w6SourceBox fixture HOME, read
// through openReplayStore, whose pair index is pairIndexOf over that fixture HOME. The other fidelity functions take rows
// and streams as values, and their redaction runs over a pair index built with makePairIndex. Key-shaped values are
// assembled at runtime.

const W6_MODEL = 'claude-opus-9-1';                 // a synthetic exact Opus id (EXACT_MODEL_ID_RE and OPUS_MODEL_RE)
const W6_STAMP = 'v9.9.6';
const W6_CMD = 'npm run fixture-build --workspace pkg-a';   // 39 characters: below LABELLER.window, matched whole
const W6_CMD2 = 'npm run fixture-lint --workspace pkg-b';
const W6_ERR = 'Error: fixture deploy step three failed';
const W6_SECRET = ['m4p', 'x9q2', 'r7v1', 'k3z8', 't6w5', 'n2h9', 'b8c4', 'y1d6', 'f5g3', 'j7e'].join('');
const W6_IDX = t4Lib.makePairIndex([{ len: W6_SECRET.length, sha256: t4Lib.sha256Hex(W6_SECRET) }]);
/** An AKIA-shaped key, assembled here, so no key-shaped literal sits in the tree. `tail` is seven capitals. */
const w6Akia = (tail: string): string => ['AK', 'IA'].join('') + ['FIXTURE', 'W6', tail].join('');
const W6_INIT = { type: 'system', subtype: 'init', session_id: 'fixture-writer-session', model: W6_MODEL, tools: [],
  mcp_servers: [], plugins: [], skills: [], slash_commands: [] };
const W6_USAGE = { input_tokens: 40, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 5 };
/** A writer stream: the fixed init line (so the stub's `--version`, its first line, never moves), one assistant
 *  message and, unless `result` is false, a result event whose text is `reply`. */
function w6Reply(reply: string, opts: { result?: boolean } = {}): string {
  const events: object[] = [W6_INIT,
    { type: 'assistant', message: { id: 'msg-w6-1', role: 'assistant', content: [{ type: 'text', text: reply }], usage: W6_USAGE } }];
  if (opts.result !== false) {
    events.push({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, result: reply, permission_denials: [], usage: W6_USAGE });
  }
  return events.map((e) => JSON.stringify(e)).join('\n') + '\n';
}
const W6_GEN = '00000000-0000-4000-8000-0000000000c6';
const W6_BOUNDARY = '00000000-0000-4000-8000-0000000000b6';
const W6_SOURCE = '00000000-0000-4000-8000-0000000000e6';
const w6Field = (text: string): { text: string; rawLen: number } => ({ text, rawLen: Buffer.byteLength(text) });
type W6Item = {
  store_id: string; ccrc_id: string; generation: string; boundary_uuid: string; kind: string; fact: string; fact_raw: string;
  source_entry_uuid: string; repo_roots: string[]; leaf: { text: string; rawLen: number };
  pair: { name: string; input: { text: string; rawLen: number } } | null; span: Array<{ text: string; rawLen: number }>;
};
/** A command candidate whose leaf is its Bash command, in the writer's item fields of Task 2's candidate (R4). */
function w6Item(over: Partial<W6Item> = {}): W6Item {
  const fact = over.fact ?? W6_CMD;
  return {
    store_id: 'fixture-store-a', ccrc_id: 'fixture-ccrc-a', generation: W6_GEN, boundary_uuid: W6_BOUNDARY, kind: 'command',
    fact, fact_raw: fact, source_entry_uuid: W6_SOURCE, repo_roots: ['/home/u/tree'],
    leaf: w6Field(fact), pair: null, span: [w6Field(fact)], ...over,
  };
}
type W6Box = { home: string; out: string; claim: ReturnType<typeof claimFor> };
/** A fixture HOME: Task 3's twelve rows; a stub at every id's launcher; gen-a's real wrapper over the upstream stub and
 *  its secrets file; a fresh limits row for every id; a tagged release stamp; the writer stream; a claimed --out. */
function w6Box(prefix: string): W6Box {
  const home = mkTmp(prefix);
  writeRoster(home, FIXTURE_ACCOUNTS);
  const nowS = Math.floor(Date.now() / 1000);
  mkdirSync(join(home, '.cc-limits'), { recursive: true });
  for (const a of FIXTURE_ACCOUNTS as Array<{ id: string }>) {
    plantStub(home, a.id);
    writeFileSync(join(home, '.cc-limits', `${a.id}.json`),
      JSON.stringify({ five: 10, seven: 20, ts: nowS - 60, fiveResetAt: nowS + 3600, sevenResetAt: nowS + 86400 }));
  }
  const flat = rosterFromJson(JSON.parse(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8')));
  const genA = flat.accounts.find((a) => a.id === 'gen-a')!;
  writeFileSync(join(home, '.local', 'bin', 'gen-a'), generateWrapperBody(genA, flat.upstreamId), { mode: 0o700 });
  mkdirSync(join(home, '.cc-secrets'), { recursive: true, mode: 0o700 });
  writeFileSync(join(home, '.cc-secrets', 'gen-a.env'), `export CLAUDE_CODE_OAUTH_TOKEN=${T5_TOKEN}\n`, { mode: 0o600 });
  writeFileSync(join(home, '.ccrc', 'build.json'),
    JSON.stringify({ sha: 'fixture', ref: 'main', builtAt: '2026-10-22T00:00:00Z', dirty: false, version: W6_STAMP }));
  writeFileSync(join(home, STUB_STREAM), w6Reply('QUESTION: Which command rebuilt the fixture package before the release step?'));
  const out = replay.prepareOut(join(home, 'out'));
  return { home, out, claim: claimFor(out) };
}
/** What step 0a would have recorded for this box and account: the stub's version line, the stamp, the wrapper's sha
 *  (null for upstream) and the code shas measured now over this checkout. */
function w6Expected(home: string, id: string): Record<string, unknown> {
  const shas = replay.codeShas();
  if (shas.state !== 'measured') throw new Error(`fixture: codeShas is ${shas.state}`);
  return {
    claude_code_version: readFileSync(join(home, STUB_STREAM), 'utf8').split('\n')[0]!.trim(),
    release_stamp: W6_STAMP,
    wrapper_sha256: id === 'gen-a' ? sha256Hex(readFileSync(join(home, '.local', 'bin', 'gen-a'))) : null,
    code_shas: shas.files,
  };
}
function w6Open(b: W6Box, id: string, over: Record<string, unknown> = {}): ReturnType<typeof replay.openWriter> {
  return replay.openWriter({
    home: b.home, accountId: id, model: W6_MODEL, settingsMode: 'restricted', writerInput: 'excerpt', claim: b.claim,
    budget: 100_000, limits: replay.LIMITS_DEFAULTS, expected: w6Expected(b.home, id), lang: 'fixture.UTF-8', idx: W6_IDX, ...over,
  } as never);
}
/** The stub's print-mode runs: the writer spawns, not the `--version` calls. */
const w6Runs = (home: string) => (stubLog(home) ?? []).filter((e) => e.argv.includes('-p'));
const w6Excerpt = (r: unknown): string => {
  expect((r as { state: string }).state).toBe('input');
  return (r as { input: { excerpt: string } }).input.excerpt;
};
const w6Text = (r: unknown): string => {
  expect((r as { state: string }).state).toBe('text');
  return (r as { excerpt: string }).excerpt;
};
const W6_LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe('W2-5a Task 6: the writer input, W2-D72 and W2-D54', () => {
  it('excerpt: a short leaf is sent whole, as canonical v1 input with kind, fact and excerpt', () => {
    const r = replay.writerInputOf(w6Item(), 'excerpt', W6_IDX);
    expect(r).toEqual({ state: 'input', input: { v: 1, kind: 'command', fact: W6_CMD, excerpt: W6_CMD } });
  });

  it('excerpt: a long leaf is windowed to 4000 code points centred on the first occurrence of the raw fact', () => {
    const F = 'make fixture-target';
    const leaf = `${'a'.repeat(6000)}${F}${'b'.repeat(6000)}${F}${'c'.repeat(100)}`;
    const ex = w6Excerpt(replay.writerInputOf(w6Item({ kind: 'command', fact: F, fact_raw: F, leaf: w6Field(leaf) }), 'excerpt', W6_IDX));
    const start = 6000 + Math.floor(F.length / 2) - 2000;
    expect(ex).toBe(leaf.slice(start, start + 4000));
    expect(ex.indexOf(F)).toBe(6000 - start);
  });

  it('excerpt: the window is clamped at either end of the leaf and always holds the whole raw fact', () => {
    const F = 'make fixture-target';
    const head = `${'x'.repeat(10)}${F}${'y'.repeat(9000)}`;
    expect(w6Text(replay.windowExcerpt({ base: head, factRaw: F, firstWindow: 4000, pairLine: null }))).toBe(head.slice(0, 4000));
    const tail = `${'y'.repeat(9000)}${F}${'x'.repeat(10)}`;
    expect(w6Text(replay.windowExcerpt({ base: tail, factRaw: F, firstWindow: 4000, pairLine: null }))).toBe(tail.slice(tail.length - 4000));
  });

  it('excerpt: a paired tool_use is appended as one line, redacted whole and capped at 2000 code points', () => {
    const input = `${'p '.repeat(500)}${W6_SECRET} ${'q '.repeat(2000)}`;   // the secret sits inside the 2000 cap
    const item = w6Item({ kind: 'error', fact: W6_ERR, fact_raw: W6_ERR, leaf: w6Field(`${W6_ERR}\nmore output`),
      pair: { name: 'Bash', input: w6Field(input) } });
    const ex = w6Excerpt(replay.writerInputOf(item, 'excerpt', W6_IDX));
    const line = Array.from(replay.renderToolUseLine('Bash', t4Lib.redactField(input, W6_IDX))).slice(0, 2000).join('');
    expect(ex).toBe(`${W6_ERR}\nmore output\n${line}`);
    expect(ex).not.toContain(W6_SECRET.slice(0, 6));
    expect(Array.from(ex.slice(ex.lastIndexOf('\n') + 1)).length).toBe(2000);
  });

  it('excerpt: a window past 8 KiB of UTF-8 shrinks around the fact until it fits, never splitting a code point', () => {
    const F = 'make fixture-target';
    const cjk = `${'中'.repeat(6000)}${F}${'中'.repeat(6000)}`;
    const ex = w6Text(replay.windowExcerpt({ base: cjk, factRaw: F, firstWindow: 4000, pairLine: null }));
    expect(Buffer.byteLength(ex)).toBeLessThanOrEqual(replay.WRITER_EXCERPT_MAX_BYTES);
    expect(Buffer.byteLength(ex)).toBeGreaterThan(replay.WRITER_EXCERPT_MAX_BYTES - 4);
    expect(ex).toContain(F);
    expect(cjk.includes(ex)).toBe(true);
    const astral = String.fromCodePoint(0x1f600);
    const wide = `${astral.repeat(3000)}${F}${astral.repeat(3000)}`;
    const ex2 = w6Text(replay.windowExcerpt({ base: wide, factRaw: F, firstWindow: 4000, pairLine: null }));
    expect(Buffer.byteLength(ex2)).toBeLessThanOrEqual(8192);
    expect(ex2).toContain(F);
    expect(ex2).not.toMatch(W6_LONE_SURROGATE);
    expect(wide.includes(ex2)).toBe(true);
  });

  it('excerpt: a raw fact whose own bytes pass 8 KiB is discarded as writer-input-over-cap', () => {
    const F = '中'.repeat(3000);
    expect(replay.windowExcerpt({ base: F, factRaw: F, firstWindow: 4000, pairLine: null }))
      .toEqual({ state: 'discard', why: 'writer-input-over-cap' });
    expect(replay.writerInputOf(w6Item({ kind: 'error', fact: F, fact_raw: F, leaf: w6Field(F) }), 'excerpt', W6_IDX))
      .toEqual({ state: 'discard', why: 'writer-input-over-cap' });
    expect(replay.FACT_DROP_REASONS.slice(16, 17), 'R5: a fact drop, appended after Task 5\'s').toEqual(['writer-input-over-cap']);
  });

  it('a leaf or a paired input over the decode cap is discarded, never cut', () => {
    const over = { text: W6_CMD, rawLen: t4Lib.BLOB_DECODE_MAX + 1 };
    expect(replay.writerInputOf(w6Item({ leaf: over }), 'excerpt', W6_IDX)).toEqual({ state: 'discard', why: 'over-decode-cap' });
    expect(replay.writerInputOf(w6Item({ pair: { name: 'Bash', input: over } }), 'excerpt', W6_IDX))
      .toEqual({ state: 'discard', why: 'over-decode-cap' });
    expect(replay.writerInputOf(w6Item({ span: [over] }), 'leaf-span', W6_IDX)).toEqual({ state: 'discard', why: 'over-decode-cap' });
  });

  it('W2-D54 order: a secret straddling the window edge is redacted whole before the window, and no head of it survives', () => {
    const F = 'make fixture-target';
    // Spaced filler, so the secret is a run of its own and its (length, sha256) pair matches it whole.
    const leaf = `${'a '.repeat(1500)}${F}  ${'b '.repeat(989)}${W6_SECRET} ${'c '.repeat(1500)}`;
    const end = 3000 + Math.floor(F.length / 2) - 2000 + 4000;
    expect(leaf.indexOf(W6_SECRET), 'the fixture: the secret starts 10 code points before the window ends').toBe(end - 10);
    const ex = w6Excerpt(replay.writerInputOf(w6Item({ fact: F, fact_raw: F, leaf: w6Field(leaf) }), 'excerpt', W6_IDX));
    expect(ex).not.toContain(W6_SECRET.slice(0, 6));
    expect(ex).toContain(t4Lib.REDACTED_MARK);
    // CONTROL: window the raw leaf first and redact afterwards, and the head the window leaves matches no pair.
    const raw = w6Text(replay.windowExcerpt({ base: leaf, factRaw: F, firstWindow: 4000, pairLine: null }));
    expect(t4Lib.redactField(raw, W6_IDX)).toContain(W6_SECRET.slice(0, 10));
  });

  it('leaf-span: the whole span, each leaf redacted, joined by newlines and windowed to the 8 KiB budget', () => {
    const span = [w6Field('first leaf text'), w6Field(W6_CMD), w6Field(`third leaf ${W6_SECRET}`)];
    const ex = w6Excerpt(replay.writerInputOf(w6Item({ span }), 'leaf-span', W6_IDX));
    expect(ex).toBe(`first leaf text\n${W6_CMD}\nthird leaf ${t4Lib.REDACTED_MARK}`);
    const big = [w6Field('q'.repeat(5000)), w6Field(`${'r'.repeat(2000)}${W6_CMD}${'s'.repeat(2000)}`), w6Field('t'.repeat(5000))];
    const ex2 = w6Excerpt(replay.writerInputOf(w6Item({ span: big }), 'leaf-span', W6_IDX));
    expect(Buffer.byteLength(ex2)).toBe(8192);
    expect(ex2).toContain(W6_CMD);
  });

  it('a raw fact absent from its redacted leaf is a TypeError, never an empty excerpt', () => {
    expect(() => replay.writerInputOf(w6Item({ leaf: w6Field('some other command') }), 'excerpt', W6_IDX)).toThrow(TypeError);
    expect(() => replay.writerInputOf(w6Item(), 'whole-session' as never, W6_IDX)).toThrow(TypeError);
  });

  it('writerStdin is the writer prompt, a blank line, the canonical input and one newline', () => {
    const input = { v: 1, kind: 'command', fact: W6_CMD, excerpt: W6_CMD };
    expect(replay.writerStdin(input)).toBe(
      `${w6Gate.WRITER_PROMPT}\n\n{"excerpt":${JSON.stringify(W6_CMD)},"fact":${JSON.stringify(W6_CMD)},"kind":"command","v":1}\n`);
  });

  it('W2-D67 (R10, F6): a whitespace-split bearer token, mined by Task 2, is dropped redact-fact by the redaction stage, because the writer input carries F as it stands', () => {
    // The token is assembled at runtime; a newline splits it from its header in F_raw, and collapseWs joins them in F.
    const tok = ['zq', 'w5a6', 'bearer', 'value'].join('');
    const command = `curl -H "Authorization: Bearer\n${tok}" https://api.example.test/v1`;
    const sp = w5a2Span([{ provenance: 'model', body: [w5a2Use('b6', 'Bash', { command })] }]);
    const c = w5a2MinedOf(w5a2Mine(sp, { storeId: 'fixture-store-a', ccrcId: 'fixture-ccrc-a', generation: W6_GEN })).candidates.find((x) => x.kind === 'command')!;
    expect(c).toMatchObject({ fact_raw: command, leaf: { text: command } });
    const made = replay.writerInputOf(c as never, 'excerpt', W6_IDX) as { state: string; input: { fact: string; excerpt: string } };
    expect(made.state).toBe('input');
    expect(made.input.excerpt, 'CONTROL: the excerpt, redacted whole, keeps the split token (lib\'s bearer rule reads one line)').toContain(tok);
    expect(made.input.fact, 'CONTROL: the writer input carries F, the header and token joined, unredacted').toContain(`Bearer ${tok}`);
    expect(w5a2Drv.screenRedaction(c, W6_IDX), 'so the redaction stage, which runs before the writer stage, drops it').toBe('redact-fact');
  });
});

describe('W2-5a Task 6: the writer spawn, RP1-writer and RP3-writer', () => {
  it.each(['up-a', 'gen-a'])('RP1-writer %s: the writer call goes through W2-4 spawn in writer mode, with the composed input on stdin', async (id) => {
    const b = w6Box(`ccrc-w2-5a-t6-rp1-${id}-`);
    const w = await w6Open(b, id);
    const item = w6Item();
    const qid = replay.qidOf(item);
    const r = await w.ask('quiz', item);
    expect(r).toMatchObject({ state: 'question', qid, entry: { qid, question: 'Which command rebuilt the fixture package before the release step?' } });
    const runs = w6Runs(b.home);
    expect(runs, 'one writer spawn').toHaveLength(1);
    const l = runs[0]!;
    expect(l.argv).toEqual(t5Argv('writer', W6_MODEL, b.home));
    expect(l.argv).not.toContain('--allowedTools');
    const keys = withoutDarwinAdded(l.envKeys).filter((k) => !T5_BASH_KEYS.includes(k));
    expect(keys).toEqual(id === 'gen-a' ? [...T5_BASE_KEYS, 'CLAUDE_CODE_OAUTH_TOKEN'].sort() : [...T5_BASE_KEYS].sort());
    for (const k of [...T5_NEVER_KEYS, ...T5_RECALL_KEYS]) expect(l.envKeys, k).not.toContain(k);
    expect(l.env['PATH']).toBe(`${b.out}/poison-bin:${path.dirname(process.execPath)}:/usr/bin:/bin`);
    expect(l.env['CLAUDE_CONFIG_DIR']).toBe(join(b.home, id === 'gen-a' ? '.gen-a' : '.claude'));
    const input = `{"excerpt":${JSON.stringify(W6_CMD)},"fact":${JSON.stringify(W6_CMD)},"kind":"command","v":1}`;
    expect(l.stdin).toBe(`${w6Gate.WRITER_PROMPT}\n\n${input}\n`);
    const dir = join(b.out, 'quiz', 'writer');
    expect(readFileSync(join(dir, `${qid}.jsonl`), 'utf8')).toBe(readFileSync(join(b.home, STUB_STREAM), 'utf8'));
    expect(JSON.parse(readFileSync(join(dir, `${qid}.run.json`), 'utf8'))).toMatchObject({ mode: 'writer', model: W6_MODEL, account: id });
    expect(readFileSync(join(dir, `${qid}.input.json`), 'utf8')).toBe(`${input}\n`);
    expect(readFileSync(join(b.home, T5_STUB_LOG), 'utf8')).not.toContain(T5_TOKEN);
  }, 60_000);

  it.each([['cx-a', 'kind-codex'], ['ext-n', 'kind-external'], ['ext-a', 'kind-external'], ['gen-o', 'provider-openai']])(
    'RP3-writer %s: refused account-refused before any spawn, and the stub log stays absent', async (id, detail) => {
      const b = w6Box(`ccrc-w2-5a-t6-rp3-${id}-`);
      const err = await w6Open(b, id).then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(DriverRefusal);
      expect(err).toMatchObject({ word: 'account-refused', detail });
      expect(stubLog(b.home), 'no spawn, not even --version').toBeNull();
      expect(existsSync(join(b.out, 'quiz'))).toBe(false);
    }, 60_000);

  it('a writer model that is not an exact Opus id is refused before admission and any spawn', async () => {
    for (const model of ['opus', 'claude-opus-latest', 'claude-other-9-1']) {
      const b = w6Box('ccrc-w2-5a-t6-model-');
      const err = await w6Open(b, 'up-a', { model }).then(() => null, (e: unknown) => e);
      expect(err, model).toMatchObject({ word: 'args-invalid' });
      expect(stubLog(b.home), model).toBeNull();
    }
  }, 60_000);

  it('a stub question holding the 7-character SHA prefix is discarded as writer-leak, and a 6-character one is kept', async () => {
    const b = w6Box('ccrc-w2-5a-t6-leak-');
    const w = await w6Open(b, 'up-a');
    const sha = ['0a1b2c3', 'd4e5f60', '718293a', '4b5c6d7', 'e8f9012', '34567'].join('');
    const sha2 = ['9f8e7d6', 'c5b4a39', '2817f6e', '5d4c3b2', 'a190817', '26354'].join('');
    writeFileSync(join(b.home, STUB_STREAM), w6Reply(`QUESTION: Which commit, starting ${sha.slice(0, 7)}, landed the fixture merge?`));
    const leak = await w.ask('quiz', w6Item({ kind: 'sha', fact: sha, fact_raw: sha, leaf: w6Field(`merged at ${sha}`) }));
    expect(leak).toMatchObject({ state: 'discard', why: 'writer-leak' });
    // CONTROL: a 6-character prefix is under LABELLER.sha_admit_prefix, so the same shape of question is kept.
    writeFileSync(join(b.home, STUB_STREAM), w6Reply(`QUESTION: Which commit, starting ${sha2.slice(0, 6)}, landed the fixture merge?`));
    const kept = await w.ask('quiz', w6Item({ kind: 'sha', fact: sha2, fact_raw: sha2, leaf: w6Field(`merged at ${sha2}`) }));
    expect(kept).toMatchObject({ state: 'question' });
    expect(w6Runs(b.home)).toHaveLength(2);
  }, 60_000);

  it('a reply with no QUESTION line, or a run with no result event, is writer-malformed with no retry', async () => {
    const b = w6Box('ccrc-w2-5a-t6-malformed-');
    const w = await w6Open(b, 'up-a');
    writeFileSync(join(b.home, STUB_STREAM), w6Reply('I would ask about the build command.'));
    expect(await w.ask('quiz', w6Item())).toMatchObject({ state: 'discard', why: 'writer-malformed', run: { code: 0, skipped: false } });
    writeFileSync(join(b.home, STUB_STREAM), w6Reply('QUESTION: Which command linted the fixture package?', { result: false }));
    expect(await w.ask('quiz', w6Item({ fact: W6_CMD2, fact_raw: W6_CMD2, leaf: w6Field(W6_CMD2) })))
      .toMatchObject({ state: 'discard', why: 'writer-malformed' });
    expect(w6Runs(b.home), 'one spawn per ask, never a retry').toHaveLength(2);
  }, 60_000);

  it('W2-D67 (R7): an AKIA-shaped key in the leaf or in its paired tool_use, mined by Task 2 from leaf N\'s span, reaches the writer stub redacted, under both writer inputs', async () => {
    const key = w5a2Akia();
    const sp = w5a2Span([
      { provenance: 'model', body: [w5a2Use('k7', 'Bash', { command: `AWS_ACCESS_KEY_ID=${key} ./fixture-deploy.sh` })] },
      { provenance: 'tool', body: [w5a2Result('k7', `${W6_ERR}\nkey in env: ${key}\n`, true)] },
    ]);
    const mined = w5a2MinedOf(w5a2Mine(sp, { storeId: 'fixture-store-a', ccrcId: 'fixture-ccrc-a', generation: W6_GEN }));
    const err = mined.candidates.find((c) => c.kind === 'error')!;
    expect(err).toMatchObject({ fact_raw: W6_ERR, pair: { name: 'Bash' } });
    expect(err.leaf.text, 'CONTROL: the mined leaf holds the key').toContain(key);
    expect(err.pair!.input.text, 'CONTROL: so does its paired tool_use').toContain(key);
    expect(w5a2Drv.screenRedaction(err, W6_IDX), 'the screen keeps it: the fact is intact once the key is masked').toBeNull();
    for (const writerInput of ['excerpt', 'leaf-span']) {
      const b = w6Box(`ccrc-w2-5a-t6-akia-${writerInput}-`);
      writeFileSync(join(b.home, STUB_STREAM), w6Reply('QUESTION: What error did the fixture deploy step print?'));
      const w = await w6Open(b, 'up-a', { writerInput });
      expect(await w.ask('quiz', err as never), writerInput).toMatchObject({ state: 'question' });
      const stdin = w6Runs(b.home)[0]!.stdin;
      expect(stdin, writerInput).not.toContain(key);
      expect(stdin, writerInput).toContain(t4Lib.REDACTED_MARK);
      expect(stdin, writerInput).toContain(W6_ERR);
      expect(readFileSync(join(b.out, 'quiz', 'writer', `${replay.qidOf(err as never)}.input.json`), 'utf8'), writerInput).not.toContain(key);
    }
  }, 120_000);

  it('the preflight runs before every writer batch: a version that moves between two asks refuses before the second spawn', async () => {
    const b = w6Box('ccrc-w2-5a-t6-moved-');
    const w = await w6Open(b, 'up-a');
    expect(await w.ask('quiz', w6Item())).toMatchObject({ state: 'question' });
    const moved = readFileSync(join(b.home, STUB_STREAM), 'utf8').replace('fixture-writer-session', 'fixture-writer-moved');
    writeFileSync(join(b.home, STUB_STREAM), moved);
    const err = await w.ask('quiz', w6Item({ fact: W6_CMD2, fact_raw: W6_CMD2, leaf: w6Field(W6_CMD2) })).then(() => null, (e: unknown) => e);
    expect(err).toMatchObject({ word: 'claude-version-moved' });
    expect(w6Runs(b.home)).toHaveLength(1);
  }, 60_000);

  it('the limits gate stops the writer at open: limits-threshold, and the stub never runs', async () => {
    const b = w6Box('ccrc-w2-5a-t6-limits-');
    const nowS = Math.floor(Date.now() / 1000);
    writeFileSync(join(b.home, '.cc-limits', 'up-a.json'),
      JSON.stringify({ five: 90, seven: 20, ts: nowS - 60, fiveResetAt: nowS + 3600, sevenResetAt: nowS + 86400 }));
    const err = await w6Open(b, 'up-a').then(() => null, (e: unknown) => e);
    expect(err).toMatchObject({ word: 'limits-threshold' });
    expect(stubLog(b.home)).toBeNull();
  }, 60_000);

  it('W2-D55: the writer stops at its budget before the next writer batch: budget-exhausted, one stub run', async () => {
    const b = w6Box('ccrc-w2-5a-t6-budget-');
    const w = await w6Open(b, 'up-a', { budget: 1 });
    const first = await w.ask('quiz', w6Item());
    expect(first, 'CONTROL: the first ask ran, the ledger at 0').toMatchObject({ state: 'question', run: { skipped: false } });
    expect((first as { run: { tokens: number } }).run.tokens, 'CONTROL: the stub run spent past the budget').toBeGreaterThanOrEqual(1);
    const err = await w.ask('pilot', w6Item()).then(() => null, (e: unknown) => e);
    expect(err).toMatchObject({ word: 'budget-exhausted' });
    expect(w6Runs(b.home)).toHaveLength(1);
  }, 60_000);

  it('W2-D55, W2-D56: a limits row raised past the threshold between two asks stops the second before its spawn: limits-threshold', async () => {
    const b = w6Box('ccrc-w2-5a-t6-limits-ask-');
    const w = await w6Open(b, 'up-a');
    await w.ask('quiz', w6Item());
    expect(w6Runs(b.home), 'CONTROL: the first ask spawned under the fresh row').toHaveLength(1);
    const nowS = Math.floor(Date.now() / 1000);
    writeFileSync(join(b.home, '.cc-limits', 'up-a.json'),
      JSON.stringify({ five: 90, seven: 20, ts: nowS - 60, fiveResetAt: nowS + 3600, sevenResetAt: nowS + 86400 }));
    const err = await w.ask('pilot', w6Item()).then(() => null, (e: unknown) => e);
    expect(err).toMatchObject({ word: 'limits-threshold' });
    expect(w6Runs(b.home)).toHaveLength(1);
  }, 60_000);

  it('a resumed ask reuses the finished run with no spawn, and changed input for the same qid refuses out-refused', async () => {
    const b = w6Box('ccrc-w2-5a-t6-resume-');
    const w = await w6Open(b, 'up-a');
    const first = await w.ask('quiz', w6Item());
    const again = await w.ask('quiz', w6Item());
    expect(again).toMatchObject({ state: 'question', run: { skipped: true } });
    expect((again as { entry: unknown }).entry).toEqual((first as { entry: unknown }).entry);
    expect(w6Runs(b.home)).toHaveLength(1);
    const changed = w6Item({ leaf: w6Field(`cd pkg-a && ${W6_CMD}`) });
    expect(replay.qidOf(changed)).toBe(replay.qidOf(w6Item()));
    const err = await w.ask('quiz', changed).then(() => null, (e: unknown) => e);
    expect(err).toMatchObject({ word: 'out-refused' });
    expect((err as { detail: string }).detail).toMatch(/^writer-input-changed quiz\/writer\/[0-9a-f]{16}\.input\.json$/);
    expect(w6Runs(b.home)).toHaveLength(1);
  }, 60_000);
});

const W6_HEAD = { writer_model: W6_MODEL, labeller: { ...w6Gate.LABELLER, sha_min_prefix: 7 } };
/** A frozen entry for `fact`, its qid computed by qidOf (its type is inferred, so it is a FrozenEntry). */
function w6Entry(fact: string) {
  const six = { store_id: 'fixture-store-a', ccrc_id: 'fixture-ccrc-a', generation: W6_GEN, boundary_uuid: W6_BOUNDARY, kind: 'command', fact };
  return { qid: replay.qidOf(six), ...six, fact_raw: fact, question: `Which command ran as step ${fact.length}?`,
    source_entry_uuid: W6_SOURCE, repo_roots: ['/home/u/tree'] };
}

describe('W2-5a Task 6: the frozen lists, W2-D73', () => {
  it('qidOf is the first 16 hex of sha256 over the canonical six-tuple', () => {
    const six = ['fixture-store-a', 'fixture-ccrc-a', W6_GEN, W6_BOUNDARY, 'command', W6_CMD];
    expect(replay.qidOf(w6Item())).toBe(w6Hash('sha256').update(JSON.stringify(six)).digest('hex').slice(0, 16));
  });

  it('frozenListText: canonical bytes, entries sorted by qid, no trailing newline, byte-identical twice and in any input order', () => {
    const a = w6Entry(W6_CMD);
    const c = w6Entry(W6_CMD2);
    const text = replay.frozenListText('quiz', W6_HEAD, [a, c]);
    expect(replay.frozenListText('quiz', W6_HEAD, [c, a])).toBe(text);
    expect(replay.frozenListText('quiz', W6_HEAD, [a, c])).toBe(text);
    expect(text.endsWith('\n')).toBe(false);
    const doc = JSON.parse(text);
    expect(t4Lib.canonicalJson(doc)).toBe(text);
    expect(doc.entries.map((e: { qid: string }) => e.qid)).toEqual([a.qid as string, c.qid as string].sort());
    expect(Object.keys(doc.entries[0]).sort()).toEqual([...replay.FROZEN_ENTRY_KEYS]);
    expect([doc.kind, doc.version, doc.writer_model, doc.writer_prompt_sha256, doc.answer_protocol_sha256])
      .toEqual(['ccrc-history-w2-quiz', 1, W6_MODEL, w6Gate.WRITER_PROMPT_SHA256, w6Gate.ANSWER_PROTOCOL_SHA256]);
    expect(JSON.parse(replay.frozenListText('pilot', W6_HEAD, [a])).kind).toBe('ccrc-history-w2-pilot');
  });

  it('frozenListText refuses a wrong qid, an extra key, a repeated qid, an unknown kind and an aliased writer model', () => {
    const a = w6Entry(W6_CMD);
    expect(() => replay.frozenListText('quiz', W6_HEAD, [{ ...a, qid: '0'.repeat(16) }] as never)).toThrow(TypeError);
    expect(() => replay.frozenListText('quiz', W6_HEAD, [{ ...a, arm: 'x' }] as never)).toThrow(TypeError);
    expect(() => replay.frozenListText('quiz', W6_HEAD, [a, a] as never)).toThrow(TypeError);
    const decision = { ...a, kind: 'decision' };
    expect(() => replay.frozenListText('quiz', W6_HEAD, [decision] as never)).toThrow(TypeError);
    expect(() => replay.frozenListText('quiz', { ...W6_HEAD, writer_model: 'opus' }, [a] as never)).toThrow(TypeError);
    expect(() => replay.frozenListText('ab' as never, W6_HEAD, [a] as never)).toThrow(TypeError);
  });

  it('writeFrozenList writes quiz and pilot lists at 0600 and answers the sha of the bytes on disk', () => {
    const b = w6Box('ccrc-w2-5a-t6-write-');
    for (const section of ['quiz', 'pilot'] as const) {
      const text = replay.frozenListText(section, W6_HEAD, [w6Entry(W6_CMD)]);
      const sha = replay.writeFrozenList(b.out, section, text);
      const p = join(b.out, section, 'frozen.json');
      expect(readFileSync(p, 'utf8')).toBe(text);
      expect(statSync(p).mode & 0o777).toBe(0o600);
      expect(sha).toBe(sha256Hex(readFileSync(p)));
    }
  });

  it('writeFrozenList keeps a list it already wrote, and refuses a different list over it', () => {
    const b = w6Box('ccrc-w2-5a-t6-rewrite-');
    const text = replay.frozenListText('quiz', W6_HEAD, [w6Entry(W6_CMD)]);
    const sha = replay.writeFrozenList(b.out, 'quiz', text);
    expect(replay.writeFrozenList(b.out, 'quiz', text)).toBe(sha);
    const other = replay.frozenListText('quiz', W6_HEAD, [w6Entry(W6_CMD2)]);
    expect(() => replay.writeFrozenList(b.out, 'quiz', other)).toThrow(/holds another frozen list/);
    expect(readFileSync(join(b.out, 'quiz', 'frozen.json'), 'utf8')).toBe(text);
  });

  it('loadFrozenList: a one-byte edit refuses quiz-sha-mismatch before any parse, and a consumer that loads first never spawns', async () => {
    const b = w6Box('ccrc-w2-5a-t6-load-');
    const text = replay.frozenListText('quiz', W6_HEAD, [w6Entry(W6_CMD), w6Entry(W6_CMD2)]);
    const sha = replay.writeFrozenList(b.out, 'quiz', text);
    const p = join(b.out, 'quiz', 'frozen.json');
    expect(replay.loadFrozenList(p, sha, 'quiz').entries).toHaveLength(2);
    writeFileSync(p, text.replace('Which', 'Whick'));
    const { json, roster } = readRoster(b.home);
    const launch = admitAccount(json, roster, 'up-a', b.home);
    const consumer = async () => {
      replay.loadFrozenList(p, sha, 'quiz');
      return claimedBatch([t5job(b, launch, 'writer', 'quiz/consumer')], { gate: T5_NO_GATE });
    };
    await expect(consumer()).rejects.toMatchObject({ word: 'quiz-sha-mismatch' });
    expect(stubLog(b.home)).toBeNull();
  }, 60_000);

  it('loadFrozenList: bytes whose sha matches but are not the canonical list refuse input-invalid', () => {
    const text = replay.frozenListText('quiz', W6_HEAD, [w6Entry(W6_CMD)]);
    const dir = mkTmp('ccrc-w2-5a-t6-loose-');
    const loose = JSON.stringify(JSON.parse(text), null, 2);
    writeFileSync(join(dir, 'loose.json'), loose);
    expect(() => replay.loadFrozenList(join(dir, 'loose.json'), sha256Hex(loose), 'quiz')).toThrow(/frozen list/);
    let word = '';
    try { replay.loadFrozenList(join(dir, 'loose.json'), sha256Hex(loose), 'quiz'); } catch (e) { word = (e as { word: string }).word; }
    expect(word).toBe('input-invalid');
    // CONTROL: the canonical bytes of the same list load.
    writeFileSync(join(dir, 'tight.json'), text);
    expect(replay.loadFrozenList(join(dir, 'tight.json'), sha256Hex(text), 'quiz').kind).toBe('ccrc-history-w2-quiz');
    let pilotWord = '';
    try { replay.loadFrozenList(join(dir, 'tight.json'), sha256Hex(text), 'pilot'); } catch (e) { pilotWord = (e as { word: string }).word; }
    expect(pilotWord, 'a quiz list is not a pilot list').toBe('input-invalid');
  });
});

describe('W2-5a Task 6: the fidelity pilot payloads and overhead arithmetic', () => {
  const sj = (...events: object[]): string => events.map((e) => JSON.stringify(e)).join('\n') + '\n';
  const usage = (input: number, cc: number, cr: number, out = 3) =>
    ({ input_tokens: input, cache_creation_input_tokens: cc, cache_read_input_tokens: cr, output_tokens: out });
  const msg = (id: string, u: object | null) =>
    ({ type: 'assistant', message: { id, role: 'assistant', content: [{ type: 'text', text: 'ok' }], ...(u === null ? {} : { usage: u }) } });
  const RESULT = { type: 'result', subtype: 'success', is_error: false, num_turns: 2, result: 'ok', usage: usage(999, 999, 999) };
  const facts = (input: number, cc: number, cr: number) => replay.readStreamJson(sj(msg('m1', usage(input, cc, cr)), msg('m2', usage(1, 1, 1)), RESULT));

  it('readStreamJson firstCallUsage: the first message usage, counted once; null when the first message carried none', () => {
    expect(facts(10, 20, 30).firstCallUsage).toEqual({ input: 10, cacheCreation: 20, cacheRead: 30, output: 3 });
    const repeated = replay.readStreamJson(sj(msg('m1', usage(10, 20, 30)), msg('m1', usage(10, 20, 30)), msg('m2', usage(5, 5, 5))));
    expect(repeated.firstCallUsage).toEqual({ input: 10, cacheCreation: 20, cacheRead: 30, output: 3 });
    expect(replay.readStreamJson(sj(msg('m0', null), msg('m1', usage(10, 20, 30)), RESULT)).firstCallUsage).toBeNull();
    expect(replay.readStreamJson(sj(RESULT)).firstCallUsage).toBeNull();
  });

  it('usageInputOf and userTextOf read a stored row body, and an unreadable count is null, never 0', () => {
    expect(replay.usageInputOf({ message: { usage: usage(100, 200, 300) } })).toBe(600);
    expect(replay.usageInputOf({ message: { usage: { input_tokens: 7 } } }), 'absent cache counts are 0').toBe(7);
    expect(replay.usageInputOf({ message: { usage: { cache_read_input_tokens: 7 } } })).toBeNull();
    expect(replay.usageInputOf({ message: { usage: { input_tokens: -1 } } })).toBeNull();
    expect(replay.usageInputOf({ message: {} })).toBeNull();
    expect(replay.userTextOf({ message: { content: 'plain text' } })).toBe('plain text');
    expect(replay.userTextOf({ message: { content: [{ type: 'text', text: 'a' }, { type: 'tool_result', content: 'x' }, { type: 'text', text: 'b' }] } })).toBe('a\nb');
    expect(replay.userTextOf({ message: { content: [{ type: 'tool_result', content: 'x' }] } })).toBeNull();
  });

  const row = (type: string, provenance: string, model: string | null, body: object) =>
    ({ type, provenance, model, body, rawLen: Buffer.byteLength(JSON.stringify(body)) });
  const user = (provenance: string, text: string) => row('user', provenance, null, { type: 'user', message: { role: 'user', content: text } });
  const asst = (model: string, u: object) => row('assistant', 'model', model, { type: 'assistant', message: { role: 'assistant', usage: u, content: [] } });
  const EPOCH = [
    user('harness', 'harness notice text'),
    user('operator', 'please rebuild the fixture package'),
    asst('<synthetic>', usage(1, 0, 0)),
    asst('claude-fixture-1', usage(2000, 9000, 1000)),
    user('operator', 'a later prompt'),
  ];
  const COPY = [
    asst('claude-fixture-1', usage(5, 5, 5)),
    user('operator', 'before the boundary'),
    row('user', 'summary', null, { type: 'user', message: { role: 'user', content: 'the summary' } }),
    asst('<synthetic>', usage(1, 0, 0)),
    asst('claude-fixture-1', usage(1000, 4000, 25000)),
  ];

  it('originalSideOf: the first non-synthetic call of the epoch, the operator text before it, and the first non-synthetic call after the summary', () => {
    expect(replay.originalSideOf({ epochRows: EPOCH, copyRows: COPY, summaryIndex: 2 })).toEqual({
      state: 'measured', firstInput: 12000, postInput: 30000,
      userRows: [{ text: 'please rebuild the fixture package', rawLen: EPOCH[1]!.rawLen }],
    });
    expect(replay.originalSideOf({ epochRows: EPOCH.slice(0, 3), copyRows: COPY, summaryIndex: 2 }))
      .toEqual({ state: 'unmeasured', why: 'epoch-first-call-absent' });
    expect(replay.originalSideOf({ epochRows: [EPOCH[0]!, EPOCH[3]!], copyRows: COPY, summaryIndex: 2 }))
      .toEqual({ state: 'unmeasured', why: 'epoch-first-user-text-absent' });
    expect(replay.originalSideOf({ epochRows: EPOCH, copyRows: COPY.slice(0, 4), summaryIndex: 2 }))
      .toEqual({ state: 'unmeasured', why: 'post-boundary-call-absent' });
    const noUsage = [...COPY.slice(0, 4), row('assistant', 'model', 'claude-fixture-1', { message: { content: [] } })];
    expect(replay.originalSideOf({ epochRows: EPOCH, copyRows: noUsage, summaryIndex: 2 }))
      .toEqual({ state: 'unmeasured', why: 'post-boundary-usage-absent' });
  });

  it('fidelityFigures: each side net of its own fixed overhead, and unmeasured is never folded into zero', () => {
    const original = { state: 'measured', firstInput: 12000, postInput: 30000, userRows: [] };
    const runs = { payload: facts(1000, 0, 24000), empty: facts(9000, 0, 0), 'user-text': facts(9200, 0, 0) };
    expect(replay.fidelityFigures({ original, runs } as never)).toEqual({
      state: 'measured', original_payload: 18200, replay_payload: 16000, original_overhead: 11800, replay_overhead: 9000, user_text_tokens: 200,
    });
    const none = replay.readStreamJson(sj(RESULT));
    expect(replay.fidelityFigures({ original, runs: { ...runs, empty: none } } as never)).toEqual({ state: 'unmeasured', why: 'empty-first-call-absent' });
    expect(replay.fidelityFigures({ original, runs: { ...runs, 'user-text': facts(9000, 0, 0) } } as never))
      .toEqual({ state: 'unmeasured', why: 'user-text-nonpositive' });
    expect(replay.fidelityFigures({ original: { ...original, firstInput: 100 }, runs } as never))
      .toEqual({ state: 'unmeasured', why: 'original-overhead-negative' });
    expect(replay.fidelityFigures({ original: { ...original, postInput: 11800 }, runs } as never))
      .toEqual({ state: 'unmeasured', why: 'original-payload-nonpositive' });
    expect(replay.fidelityFigures({ original, runs: { ...runs, payload: facts(9000, 0, 0) } } as never))
      .toEqual({ state: 'unmeasured', why: 'replay-payload-nonpositive' });
    expect(replay.fidelityFigures({ original: { state: 'unmeasured', why: 'post-boundary-call-absent' }, runs } as never))
      .toEqual({ state: 'unmeasured', why: 'post-boundary-call-absent' });
  });
});

/** A HOME whose store the real sweep built from one family, as Task 1's fixture is built, for sourceQuiz end to end
 *  (here and in Task 7's --out walk). Leaf N's span holds one Bash command fact the kept list does not hold (`cmd`, a
 *  plain build command by default; the W2-D67 case passes a key-shaped one); Anthropic
 *  rows sit on both sides of the boundary (RP5); the summary row holds a sentinel only B carries (its part 1); and every
 *  row's cwd is a directory that exists, so B's files resolve and its ancestor walk stops at `top`. Nothing is spawned
 *  but the sweep, and no live store or home is read. */
type W6SourceBox = { box: w5a1H.HistoryBox; cwd: string; id: string; gen: string; cmd: string; sentinel: string; u: (i: number) => string };
const w6Indexed = (box: w5a1H.HistoryBox, uuid: string): boolean => {
  const db = w5a1H.openStoreRO(box);
  try {
    const r = db.prepare('SELECT b.fts_indexed AS f FROM entries e JOIN blobs b ON b.blob_id = e.blob_id WHERE e.uuid = ?').get(uuid) as { f: number } | undefined;
    return r !== undefined && Number(r.f) === 1;
  } finally {
    db.close();
  }
};
function w6SourceBox(prefix: string, cmd = 'npm run fixture-build --workspace pkg-a'): W6SourceBox {
  const box = w5a1H.makeHistoryBox(prefix);
  const cwd = join(box.home, 'tree', 'demo');
  mkdirSync(cwd, { recursive: true });
  const id = 'claude-a-w5a6';
  const gen = '0189abcd-1234-4678-9abc-0000000005a6';
  const u = (i: number): string => `a5a60001-0000-4000-8000-${String(i).padStart(12, '0')}`;
  const ts = (i: number): string => new Date(Date.UTC(2026, 9, 2, 10, 0, i)).toISOString();
  const sid = u(0);
  const sentinel = ['zq', 'w5a6', 'sentinel'].join('');
  const base = { sessionId: sid, cwd };
  const rows = [
    w5a1Fx.userRow({ ...base, uuid: u(1), ts: ts(1), text: 'please rebuild the fixture package' }),
    w5a1Fx.toolUseRow({ ...base, uuid: u(2), ts: ts(2), parentUuid: u(1), msgId: 'msg_w5a6_2', toolUseId: 'toolu_01W5A6', name: 'Bash', input: { command: cmd } }),
    w5a1Fx.toolResultRow({ ...base, uuid: u(3), ts: ts(3), parentUuid: u(2), toolUseId: 'toolu_01W5A6', content: 'built ok' }),
    w5a1Fx.assistantRow({ ...base, uuid: u(4), ts: ts(4), parentUuid: u(3), msgId: 'msg_w5a6_4', text: 'done with the build' }),
    w5a1Fx.boundaryRow({ ...base, uuid: u(5), ts: ts(5), parentUuid: u(4), trigger: 'manual', headUuid: u(4), anchorUuid: u(6), tailUuid: u(4), allUuids: [u(4)] }),
    w5a1Fx.summaryRow({ ...base, uuid: u(6), ts: ts(6), parentUuid: u(5), text: `<summary>\n1. Primary Request and Intent:\n   ${sentinel}\n</summary>` }),
    w5a1Fx.assistantRow({ ...base, uuid: u(7), ts: ts(7), parentUuid: u(6), msgId: 'msg_w5a6_7', text: 'continuing after the summary' }),
  ];
  w5a1H.seedFamily(box, { id, project: 'demo', generation: gen, uuid: sid, rows, workdir: cwd });
  // One more tick derives leaf N (as Task 1's fixture); more, if needed, until the command row's blob is indexed.
  for (let k = 0; k < 4 && (k === 0 || !w6Indexed(box, u(2))); k += 1) {
    const t = w5a1H.runSweep(box);
    if (t.code !== 0) throw new Error(`w6SourceBox: the sweep exited ${String(t.code)}: ${t.stderr}`);
  }
  if (!w6Indexed(box, u(2))) throw new Error('w6SourceBox: the command row was never indexed');
  return { box, cwd, id, gen, cmd, sentinel, u };
}

describe.skipIf(process.platform === 'darwin')('W2-5a Task 6: sourceQuiz, Tasks 1 to 6 composed (W2-D71)', () => {
  let sb: W6SourceBox;
  w5a1BeforeAll(() => { sb = w6SourceBox('ccrc-w5a6-source-'); }, 360_000);
  const OTHER_STORE = '00000000-0000-4000-8000-0000000005a6';
  type Asked = { section: string; item: Record<string, any> };
  type Sourced = { entries: Array<Record<string, any>>; fidelity: Array<Record<string, any>>; counts: Record<string, any>; asof_same_ms_hits: Record<string, unknown> };
  /** A writer handle as openWriter answers one, with no spawn: it records each ask and writes one question. */
  const fakeWriter = (asked: Asked[]) => ({
    ask: async (section: string, item: Record<string, any>) => {
      asked.push({ section, item });
      const qid = replay.qidOf(item as never) as string;
      return { state: 'question', qid, run: { code: 0, signal: null, skipped: false, tokens: 1, result: true },
        entry: { qid, store_id: item.store_id, ccrc_id: item.ccrc_id, generation: item.generation, boundary_uuid: item.boundary_uuid,
          kind: item.kind, fact: item.fact, fact_raw: item.fact_raw, question: 'Which command rebuilt the fixture package?',
          source_entry_uuid: item.source_entry_uuid, repo_roots: [...item.repo_roots] } };
    },
  });
  type Exclude = { pilotFamilies: Array<Record<string, string>>; assignment: Array<Record<string, string>> };
  async function source(mode: 'quiz' | 'pilot', asked: Asked[], exclude: Exclude = { pilotFamilies: [], assignment: [] }, box: W6SourceBox = sb): Promise<{ r: Sourced; out: string; storeId: string }> {
    const rs = replay.openReplayStore(box.box.home) as unknown as { storeId: string; close(): void };
    try {
      const out = replay.prepareOut(join(mkTmp('ccrc-w5a6-out-'), 'out'));
      const caps = { family: 5, boundary: 3, kind_per_family: 2 };
      // No family list in either mode: sourceQuiz walks the store's own admitted families (R10). The exclusions name
      // OTHER_STORE's families too, as an assignment over every node does; they exclude nothing here.
      const r = await replay.sourceQuiz({
        mode, rs, home: box.box.home, out, writer: fakeWriter(asked), seedHex: 'ab'.repeat(32),
        exclude: { pilotFamilies: [...exclude.pilotFamilies], assignment: [{ store_id: OTHER_STORE, ccrc_id: 'claude-a-elsewhere', generation: box.gen, arm: 'control' }, ...exclude.assignment] },
        plan: mode === 'quiz' ? { target: 5, caps } : { n_fidelity: 1, n_usage: 5, caps },
        configDirs: [], top: box.box.home,
      } as never) as unknown as Sourced;
      return { r, out, storeId: rs.storeId };
    } finally {
      rs.close();
    }
  }

  it('quiz mode: the leaf\'s command fact passes every stage to the writer in Task 2\'s candidate shape and comes back a ranked frozen entry; B is recorded by its counts only', async () => {
    const asked: Asked[] = [];
    const { r, out, storeId } = await source('quiz', asked);
    expect(r.entries).toHaveLength(1);
    const e = r.entries[0]!;
    expect(e).toMatchObject({ store_id: storeId, ccrc_id: sb.id, generation: sb.gen, boundary_uuid: sb.u(5), kind: 'command',
      fact: sb.cmd, fact_raw: sb.cmd, source_entry_uuid: sb.u(2) });
    expect(e.qid).toBe(replay.qidOf(e as never));
    expect(e.rank, 'the family\'s order key and its candidate rank (R10)').toEqual([replay.quizFamilyOrderKey('ab'.repeat(32), { store_id: storeId, ccrc_id: sb.id, generation: sb.gen }), 0]);
    expect(e.repo_roots).toContain(sb.cwd);
    expect(asked.map((a) => a.section)).toEqual(['quiz']);
    expect(asked[0]!.item).toMatchObject({ leaf: { text: sb.cmd }, pair: null, id: e.qid });
    expect((asked[0]!.item.span as Array<{ text: string }>).some((f) => f.text.includes(sb.cmd))).toBe(true);
    expect(r.asof_same_ms_hits).toEqual({ [e.qid]: { asof_same_ms_hits: 0 } });
    expect(r.counts.boundaries.admitted).toBe(1);
    const recText = readFileSync(join(out, 'quiz', 'baseline.json'), 'utf8');
    expect(JSON.parse(recText).boundaries.map((b: { state: string }) => b.state)).toEqual(['built']);
    expect(recText).not.toContain(sb.sentinel);
  }, 120_000);

  // The payload stdin has no parts argument: it is reconstructPayload's own text, so every part of it went through
  // Task 1's redaction (Task 1's W2-D54 cases plant a pair-index value in the summary, a user text and a tool_use input).
  it('fidelityStdins: the payload stdin is reconstructPayload\'s own text with an empty question, never parts handed in; the empty-question and user-text runs go through one composer, the user text redacted', () => {
    const rs = replay.openReplayStore(sb.box.home) as unknown as { db: { prepare(sql: string): { get(...a: unknown[]): unknown } }; close(): void };
    try {
      const idOf = (uuid: string): number => Number((rs.db.prepare('SELECT entry_id FROM entries WHERE uuid = ?').get(uuid) as { entry_id: number }).entry_id);
      const want = replay.reconstructPayload(rs as never, idOf(sb.u(5)), '') as { state: string; text: string };
      expect(want.state, 'CONTROL: the box\'s boundary reconstructs').toBe('payload');
      expect(want.text, 'CONTROL: the payload holds the summary').toContain(sb.sentinel);
      const k = w6Akia('QRSTUVW');
      const r = replay.fidelityStdins(rs as never, idOf(sb.u(5)), [w6Field(`rebuild with ${k}`)]);
      expect(r.state).toBe('stdins');
      const s = (r as { stdins: Record<string, string> }).stdins;
      expect(Object.keys(s).sort()).toEqual([...replay.FIDELITY_RUNS].sort());
      expect(s['payload']).toBe(want.text);
      expect(s['empty']).toBe(replay.composePayload(replay.FIDELITY_EMPTY_PARTS, ''));
      expect(s['user-text']).toBe(replay.composePayload(replay.FIDELITY_EMPTY_PARTS, `rebuild with ${t4Lib.REDACTED_MARK}`));
      expect(s['empty']).not.toContain(sb.sentinel);
      for (const v of Object.values(s)) {
        expect(v.endsWith(w6Gate.ANSWER_PROTOCOL)).toBe(true);
        expect(v).not.toContain(k);
      }
      expect(replay.fidelityStdins(rs as never, idOf(sb.u(5)), [{ text: 'x', rawLen: t4Lib.BLOB_DECODE_MAX + 1 }]))
        .toEqual({ state: 'discard', why: 'over-decode-cap' });
      expect(replay.fidelityStdins(rs as never, idOf(sb.u(1)), [w6Field('x')]), 'a row that is no boundary answers reconstruction\'s own word')
        .toEqual({ state: 'discard', why: 'boundary-absent' });
    } finally {
      rs.close();
    }
  }, 120_000);

  it('pilot mode: one fidelity boundary per family before the usage questions, on the pilot\'s own stream', async () => {
    const asked: Asked[] = [];
    const { r, storeId } = await source('pilot', asked);
    expect(r.fidelity).toEqual([{ store_id: storeId, ccrc_id: sb.id, generation: sb.gen, boundary_uuid: sb.u(5) }]);
    expect(r.entries.map((x) => x.fact)).toEqual([sb.cmd]);
    expect(asked.map((a) => a.section)).toEqual(['pilot']);
  }, 120_000);

  it('quiz mode walks this node\'s own admitted families, never a census list (R10, W2-D71, W2-D77): a family no census names is sourced; CONTROL: a pilot family and a control-held (store_id, ccrc_id) are not', async () => {
    // The box's family is in no census and no assignment as a quiz family: sourceQuiz is handed no family list at all.
    const free = await source('quiz', []);
    expect(free.r.entries.map((x) => [x.ccrc_id, x.fact])).toEqual([[sb.id, sb.cmd]]);
    expect(free.r.counts.population).toEqual({ 'no-admitted-boundary': 0, pilot: 0, 'control-id': 0 });
    const own = { store_id: free.storeId, ccrc_id: sb.id, generation: sb.gen };
    const asked: Asked[] = [];
    const pilot = await source('quiz', asked, { pilotFamilies: [own], assignment: [] });
    expect(pilot.r.entries, 'CONTROL: a pilot family is never quizzed').toEqual([]);
    expect(pilot.r.counts.population).toEqual({ 'no-admitted-boundary': 0, pilot: 1, 'control-id': 0 });
    // Another generation of the same (store_id, ccrc_id) assigned control excludes every generation of it (W2-D77).
    const control = await source('quiz', asked, { pilotFamilies: [], assignment: [{ ...own, generation: '00000000-0000-4000-8000-0000000005a7', arm: 'control' }] });
    expect(control.r.entries, 'CONTROL: a control-held id is never quizzed').toEqual([]);
    expect(control.r.counts.population).toEqual({ 'no-admitted-boundary': 0, pilot: 0, 'control-id': 1 });
    expect(asked, 'neither excluded family reached the writer').toEqual([]);
  }, 120_000);

  // The shipped stage, not Task 2's functions called directly: writerInputOf sends F as it stands, so sourceQuiz's
  // redaction stage is what keeps a masked F from the writer's stdin, input.json and the frozen lists (W2-D67, R10 F6).
  it('W2-D67 on the shipped path: a key-shaped command fact in the store is dropped redact-fact at sourceQuiz\'s redaction stage and never reaches the writer or --out; CONTROL: the plain box\'s command passes that stage', async () => {
    const key = w6Akia('KLMNOPQ');
    const kb = w6SourceBox('ccrc-w5a6-source-key-', `aws configure set aws_access_key_id ${key}`);
    expect(t4Lib.redactField(kb.cmd, W6_IDX), 'CONTROL: lib\'s shape layer masks the fact').not.toContain(key);
    const asked: Asked[] = [];
    const { r, out } = await source('quiz', asked, { pilotFamilies: [], assignment: [] }, kb);
    expect(r.counts.boundaries.admitted, 'CONTROL: the boundary is admitted, so its leaf is mined').toBe(1);
    expect(r.counts.drops.redaction).toEqual({ 'redact-fact': 1 });
    expect(r.entries).toEqual([]);
    expect(asked, 'the writer is never asked').toEqual([]);
    // sourceQuiz writes one file under --out, the baseline record; the frozen lists and the writer's input.json carry
    // only what the writer was asked, and it was asked nothing.
    const recText = readFileSync(join(out, 'quiz', 'baseline.json'), 'utf8');
    expect(JSON.parse(recText).boundaries, 'no B was built: the drop came before admission').toEqual([]);
    expect(recText).not.toContain(key.slice(4));
    // CONTROL: the plain box's command passes the redaction stage and reaches the writer.
    const plainAsked: Asked[] = [];
    const plain = await source('quiz', plainAsked);
    expect(plain.r.counts.drops.redaction).toEqual({});
    expect(plainAsked.map((a) => a.item.fact)).toEqual([sb.cmd]);
  }, 600_000);
});
```

If an earlier task has already imported `node:crypto`'s `createHash` under another name, keep this task's aliased line anyway (ES modules allow a second import declaration of one specifier). The `existsSync`, `statSync`, `mkdirSync`, `writeFileSync`, `readFileSync`, `join` and `path` bindings are the file's own (lines 11 to 12 at cd622b2f6).

- [ ] **Step 3: Run them and see them fail as predicted.** In the foreground, with a timeout of at least 600000 ms:

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-5a Task 6'
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'an empty stream is no init'
```

Predicted, before any driver change:
- Every `W2-5a Task 6` case fails but one, 42 failed and 1 passed (measured over a predicted 43 failed: the case `a raw fact absent from its redacted leaf is a TypeError` passes unguarded, because `replay.writerInputOf is not a function` is itself a `TypeError`). Each failure is `TypeError: replay.<name> is not a function` (`writerInputOf`, `windowExcerpt`, `writerStdin`, `openWriter`, `qidOf`, `frozenListText`, `usageInputOf`, `originalSideOf`, `fidelityStdins`, `fidelityFigures`, `sourceQuiz`), or `w6Box`'s first call to an absent export. The `sourceQuiz` describe's `beforeAll` builds its box (`w6SourceBox`) first, which proves the fixture: a throw there is the fixture's to fix.
- The `firstCallUsage` case fails on `expected undefined to deeply equal { input: 10, … }`.
- The re-expected W2-4 case fails with the diff `+ firstCallUsage: null`.
- No stub runs: no case reaches a spawn (the sourceQuiz box runs only the sweep).

- [ ] **Step 4: Write the code.** In `deploy/history-replay.mjs`, merge these names into Task 1's `./history-gate.mjs` import statement, keeping one statement per module and the names in code-unit order: `ANSWER_PROTOCOL_SHA256`, `EXACT_MODEL_ID_RE`, `OPUS_MODEL_RE`, `WRITER_INPUTS`, `WRITER_PROMPT`, `WRITER_PROMPT_SHA256` and `parseQuestionLine` (`FACT_KINDS` and `admitFact` are there already). Add no import line; the header sentence is Task 1's and names the gate (R3).

In `FACT_DROP_REASONS`, replace `  'unanswerable', 'unanswerable-untimed',` with:

```js
  'unanswerable', 'unanswerable-untimed',
  'writer-input-over-cap',
```

In `readStreamJson`'s typedef `StreamFacts` (the `@typedef {{ init: StreamInit|null, usage: StreamUsage, …` block), replace

```js
 *    text: string|null }|null, assistantMessages: number, malformedLines: number }} StreamFacts */
```

with

```js
 *    text: string|null }|null, assistantMessages: number, malformedLines: number, firstCallUsage: StreamUsage|null }} StreamFacts */
```

In `readStreamJson`, replace

```js
  return {
    init, usage, usageSource, toolPairs: [...pairs.values()], permissionDenials, result,
    assistantMessages: messages.size, malformedLines,
  };
}
```

with

```js
  // W2-5a Task 6: the FIRST call's usage, which the fidelity pilot's replay side reads (spec §10.2: "first-call input
  // tokens"). It is the first message the stream showed, by first-seen message id, with the last usage its events
  // carried. When that message carried none it is null, never a later message's usage.
  const firstKey = messages.keys().next();
  const firstCallUsage = firstKey.done ? null : messages.get(firstKey.value);
  return {
    init, usage, usageSource, toolPairs: [...pairs.values()], permissionDenials, result,
    assistantMessages: messages.size, malformedLines, firstCallUsage,
  };
}
```

Then insert, directly above the entry guard's comment block (`// The entry guard stays the LAST block of this file`) and after the previous W2-5a task's section:

```js
// ── W2-5a Task 6: the question writer, the frozen lists, and the fidelity pilot's payloads and arithmetic ─────────────
// (W2-D72, W2-D73, W2-D64, W2-D54, W2-D55, W2-D56; D-5779, D-5776)
// The writer (W2-D72) is one spawn per candidate, in writer mode (`--tools ""`), through W2-4's contract and nothing else.
// openWriter refuses a writer model that is not an exact Opus id, admits the account from the roster (W2-D52: a gateway
// account is refused here, before any spawn), builds the limits and budget gate (W2-D55) and runs W2-D56's preflight
// against the values it is handed (step 0a's output before part 1, part 1's after). Every ask runs that preflight again
// and is a batch of one under the gate, so the soft budget overshoots by at most one run. The input is canonical
// {v: 1, kind, fact, excerpt}. The excerpt is built in order: the raw leaf redacted WHOLE (W2-D54); then windowed to
// WRITER_LEAF_WINDOW code points centred on the raw fact's first occurrence; then, for a tool_result, one line for its
// paired tool_use, redacted whole and capped at WRITER_PAIR_CAP. Its UTF-8 bytes stay within WRITER_EXCERPT_MAX_BYTES,
// the leaf window shrinking around the fact until they do. Under 'leaf-span' the base is leaf N's whole span, each leaf
// redacted whole, within the same budget (D-5779 is void then). The reply goes through the gate's parseQuestionLine and
// the question through the gate's admitFact; `writer-malformed` and `writer-leak` are never retried. Each ask's input
// bytes are pinned beside its stream, so a resume never builds on a run made from other input.
// The frozen lists (W2-D73) are exactly canonicalJson's bytes, with no trailing newline and entries sorted by qid. freeze
// writes the quiz's and pilot-source the pilot's, through writeFrozenList, which never replaces a list it finds with a
// different one. Every consumer loads a list through loadFrozenList, which checks the sha before it parses a byte.
// The fidelity pilot (spec §10.2) has three stdins per boundary through Task 1's composer: the payload, the
// empty-question run (which carries ANSWER_PROTOCOL as every composed stdin does, W2-D64, D-5776) and the user-text run.
// The original side is read from the store's rows, and the arithmetic nets each side of its own fixed overhead. The
// spawns, the tolerance and the verdict are W2-5b's. Nothing here reads the environment, opens a store or names a switch.

/** The writer's leaf window, in code points (W2-D72). */
export const WRITER_LEAF_WINDOW = 4000;
/** The paired tool_use line's cap, in code points (W2-D72). */
export const WRITER_PAIR_CAP = 2000;
/** The excerpt's whole budget, in UTF-8 bytes: W2-D72's "8 KiB in all". */
export const WRITER_EXCERPT_MAX_BYTES = 8192;
/** Where a writer run and a frozen list belong: `<out>/quiz/…` and `<out>/pilot/…` (W2-D72, W2-D73). */
export const WRITER_SECTIONS = Object.freeze(['quiz', 'pilot']);
/** Each section's frozen-list kind (W2-D73). */
export const FROZEN_LIST_KINDS = Object.freeze({ quiz: 'ccrc-history-w2-quiz', pilot: 'ccrc-history-w2-pilot' });
/** A frozen list's file name under its section. */
export const FROZEN_LIST_FILE = 'frozen.json';
/** A frozen entry's keys, sorted as canonicalJson writes them (W2-D73). */
export const FROZEN_ENTRY_KEYS = Object.freeze(['boundary_uuid', 'ccrc_id', 'fact', 'fact_raw', 'generation', 'kind', 'qid',
  'question', 'repo_roots', 'source_entry_uuid', 'store_id']);
/** The three fidelity runs per boundary, by stdin (spec §10.2's fidelity pilot; the spawns are W2-5b's). */
export const FIDELITY_RUNS = Object.freeze(['payload', 'empty', 'user-text']);
/** Task 1's composer over no summary and no kept member: the empty-question run's and the user-text run's parts. */
export const FIDELITY_EMPTY_PARTS = Object.freeze({ summary: '', kept: Object.freeze([]) });

/** @typedef {{ text: string, rawLen: number }} StoredField */
/** @typedef {{ store_id: string, ccrc_id: string, generation: string, boundary_uuid: string, kind: string, fact: string,
 *    fact_raw: string, source_entry_uuid: string, repo_roots: string[], leaf: StoredField,
 *    pair: { name: string, input: StoredField } | null, span: StoredField[] }} WriterItem */
/** @typedef {{ qid: string, store_id: string, ccrc_id: string, generation: string, boundary_uuid: string, kind: string,
 *    fact: string, fact_raw: string, question: string, source_entry_uuid: string, repo_roots: string[] }} FrozenEntry */
/** @typedef {{ code: number|null, signal: string|null, skipped: boolean, tokens: number, result: boolean }} WriterRun */
/** @typedef {{ state: 'question', qid: string, entry: FrozenEntry, run: WriterRun }
 *    | { state: 'discard', qid: string, why: 'over-decode-cap' | 'writer-input-over-cap' }
 *    | { state: 'discard', qid: string, why: 'writer-malformed' | 'writer-leak', run: WriterRun }} WriterAnswer */

/** `length` code points of `cps` from `start`, joined. */
const cpSlice = (cps, start, length) => cps.slice(start, start + length).join('');

/** The excerpt around the raw fact (W2-D72). Pure. The window holds `firstWindow` code points (never fewer than the fact
 *  has), centred on the fact's FIRST occurrence and clamped to the text's ends, then `pairLine` on its own line. While
 *  the excerpt's UTF-8 is over WRITER_EXCERPT_MAX_BYTES the window shrinks around the same centre, never below the fact;
 *  a fact that cannot fit is `writer-input-over-cap`. A fact absent from `base` is a TypeError: W2-D67 discards such a
 *  candidate before the writer.
 *  @param {{ base: string, factRaw: string, firstWindow: number, pairLine: string | null }} p
 *  @returns {{ state: 'text', excerpt: string } | { state: 'discard', why: 'writer-input-over-cap' }} */
export function windowExcerpt({ base, factRaw, firstWindow, pairLine }) {
  const at = typeof factRaw === 'string' && factRaw !== '' ? base.indexOf(factRaw) : -1;
  if (at === -1) throw new TypeError('windowExcerpt: the raw fact does not occur in the redacted text it was mined from (W2-D67 discards that candidate first)');
  const cps = Array.from(base);
  const p = Array.from(base.slice(0, at)).length;
  const L = Array.from(factRaw).length;
  const tail = pairLine === null ? '' : `\n${pairLine}`;
  let w = Math.min(cps.length, Math.max(firstWindow, L));
  for (;;) {
    const start = Math.min(Math.max(0, p + Math.floor(L / 2) - Math.floor(w / 2)), cps.length - w);
    const excerpt = cpSlice(cps, start, w) + tail;
    const over = Buffer.byteLength(excerpt, 'utf8') - WRITER_EXCERPT_MAX_BYTES;
    if (over <= 0) return { state: 'text', excerpt };
    if (w === L) return { state: 'discard', why: 'writer-input-over-cap' };
    w = Math.max(L, w - Math.ceil(over / 4));   // a code point is at most 4 UTF-8 bytes: every step makes progress and keeps the fact
  }
}

/** The writer's input for one candidate (W2-D72), every field redacted whole BEFORE any window (W2-D54). Pure.
 *  @param {WriterItem} item  @param {string} writerInput 'excerpt' or 'leaf-span' (WRITER_INPUTS)
 *  @param {import('../ccd/history/lib.mjs').PairIndex} idx the run's pair index
 *  @returns {{ state: 'input', input: { v: 1, kind: string, fact: string, excerpt: string } }
 *    | { state: 'discard', why: 'over-decode-cap' | 'writer-input-over-cap' }} */
export function writerInputOf(item, writerInput, idx) {
  if (!WRITER_INPUTS.includes(writerInput)) throw new TypeError(`writerInputOf: writer_input ${JSON.stringify(writerInput)} is not one of ${WRITER_INPUTS.join(', ')}`);
  if (!FACT_KINDS.includes(item.kind)) throw new TypeError(`writerInputOf: kind ${JSON.stringify(item.kind)} is not one of ${FACT_KINDS.join(', ')}`);
  let base;
  let firstWindow;
  let pairLine = null;
  if (writerInput === 'excerpt') {
    const leaf = redactForSpawn(item.leaf, idx);
    if (leaf.state === 'discard') return { state: 'discard', why: leaf.why };
    base = leaf.text;
    firstWindow = WRITER_LEAF_WINDOW;
    if (item.pair !== null) {
      const input = redactForSpawn(item.pair.input, idx);
      if (input.state === 'discard') return { state: 'discard', why: input.why };
      pairLine = cpSlice(Array.from(renderToolUseLine(item.pair.name, input.text)), 0, WRITER_PAIR_CAP);
    }
  } else {
    const texts = [];
    for (const f of item.span) {
      const r = redactForSpawn(f, idx);
      if (r.state === 'discard') return { state: 'discard', why: r.why };
      texts.push(r.text);
    }
    base = texts.join('\n');
    firstWindow = Number.MAX_SAFE_INTEGER;
  }
  const w = windowExcerpt({ base, factRaw: item.fact_raw, firstWindow, pairLine });
  if (w.state === 'discard') return w;
  return { state: 'input', input: { v: 1, kind: item.kind, fact: item.fact, excerpt: w.excerpt } };
}

/** The writer's stdin: its prompt, a blank line, the canonical input, one newline. Input is never an argument. */
export function writerStdin(input) {
  return `${WRITER_PROMPT}\n\n${canonicalJson(input)}\n`;
}

/** W2-D73's qid: the first 16 hex of the sha256 of the canonical six-tuple. A missing field is a TypeError.
 *  @param {{ store_id: string, ccrc_id: string, generation: string, boundary_uuid: string, kind: string, fact: string }} e
 *  @returns {string} */
export function qidOf({ store_id, ccrc_id, generation, boundary_uuid, kind, fact }) {
  for (const [k, v] of Object.entries({ store_id, ccrc_id, generation, boundary_uuid, fact })) {
    if (typeof v !== 'string' || v === '') throw new TypeError(`qidOf: ${k} is a non-empty string, not ${JSON.stringify(v)}`);
  }
  if (!FACT_KINDS.includes(kind)) throw new TypeError(`qidOf: kind ${JSON.stringify(kind)} is not one of ${FACT_KINDS.join(', ')}`);
  return sha256Hex(canonicalJson([store_id, ccrc_id, generation, boundary_uuid, kind, fact])).slice(0, 16);
}

/** Pin one ask's input bytes beside its stream: written when absent, compared when present. Different bytes refuse
 *  `out-refused` (a resume never builds on a question written from other input); a path that is not a regular file
 *  refuses as every read under --out does (D-5986). */
function pinWriterInput(out, rel, text) {
  const read = readPlain(path.join(out, rel), OUT_JSON_CAP);
  if (read.state === 'absent') { writePlain(out, rel, text); return; }
  if (read.state === 'bad') refuse('out-refused', `${rel} ${badWord(read)}`);
  if (read.bytes.toString('utf8') !== text) refuse('out-refused', `writer-input-changed ${rel}`);
}

/** W2-D72, W2-D25: the writer is the exact Opus id, never an alias, refused `args-invalid` before any spawn. Before
 *  part 1 no validator has read it yet. One function, so the sourcing subcommands can ask it before prepareOut makes
 *  --out, and a refused model leaves no --out (R10); openWriter asks it again, for every other caller.
 *  @param {unknown} model */
function refuseWriterModel(model) {
  if (typeof model !== 'string' || !EXACT_MODEL_ID_RE.test(model) || !OPUS_MODEL_RE.test(model)) {
    refuse('args-invalid', `writer-model ${JSON.stringify(model)} is not an exact Opus model id`);
  }
}

/** Open the question writer (W2-D72) on a claimed --out. In order, before any spawn: the model (an exact Opus id, else
 *  `args-invalid`, refuseWriterModel), the roster and the account (W2-D52: `roster-invalid`, `account-refused`), the gate (W2-D55), then
 *  W2-D56's preflight: the wrapper's sha (`wrapper-unmeasured`), the gate, `--version` (a spawn that spends nothing),
 *  then `preflight` against `expected` (`claude-version-moved`, `tree-moved`, `wrapper-moved`, `code-changed` and the
 *  four unmeasured words). Each ask runs the preflight again, pins its input, and runs ONE writer-mode job through
 *  runBatch under the gate.
 *  @param {{ home: string, accountId: string, model: string, settingsMode: string, writerInput: string, claim: object,
 *    budget: number, limits: object, expected: object, allowCodeChange?: boolean, lang: string | undefined,
 *    idx: import('../ccd/history/lib.mjs').PairIndex }} o
 *  @returns {Promise<Readonly<{ launch: object, stamps: () => string[],
 *    ask: (section: string, item: WriterItem) => Promise<WriterAnswer> }>>} */
export async function openWriter(o) {
  if (o === null || typeof o !== 'object' || !Object.hasOwn(o, 'lang')) {
    throw new TypeError("openWriter: carries lang, the caller's LANG from main's env (undefined when unset)");
  }
  const { home, accountId, model, settingsMode, writerInput, claim, budget, limits, expected, lang, idx } = o;
  if (!WRITER_INPUTS.includes(writerInput)) throw new TypeError(`openWriter: writer_input ${JSON.stringify(writerInput)} is not one of ${WRITER_INPUTS.join(', ')}`);
  if (!SETTINGS_MODES.includes(settingsMode)) throw new TypeError(`openWriter: settings mode ${JSON.stringify(settingsMode)} is not one of ${SETTINGS_MODES.join(', ')}`);
  const { out } = requireClaim('openWriter', { claim }, []);
  refuseWriterModel(model);
  const { json, roster } = readRoster(home);
  const launch = admitAccount(json, roster, accountId, home);   // RP3-writer: every refusal here lands before any spawn
  const gate = batchGate({ out, home, accountId: launch.accountId, budget, limits });
  const stamps = new Set();
  const preflightNow = async () => {
    const wrapperSha256 = wrapperSha(launch);   // wrapper-unmeasured before any spawn
    gate();
    const version = await measureClaudeVersion(launch, out, lang);
    refuseIfStopping();
    const verdict = preflight(expected, { version, stamp: readReleaseStamp(home), wrapperSha256, codeShas: codeShas() },
      { allowCodeChange: o.allowCodeChange === true });
    if (!verdict.ok) refuse(verdict.word, verdict.detail);
    for (const s of verdict.stamps) stamps.add(s);
  };
  await preflightNow();
  /** @param {string} section  @param {WriterItem} item  @returns {Promise<WriterAnswer>} */
  const ask = async (section, item) => {
    if (!WRITER_SECTIONS.includes(section)) throw new TypeError(`ask: section ${JSON.stringify(section)} is not one of ${WRITER_SECTIONS.join(', ')}`);
    const qid = qidOf(item);
    const made = writerInputOf(item, writerInput, idx);
    if (made.state === 'discard') return { state: 'discard', qid, why: made.why };
    await preflightNow();
    const dir = `${section}/writer`;
    ensurePlainDir(out, dir);
    pinWriterInput(out, `${dir}/${qid}.input.json`, `${canonicalJson(made.input)}\n`);
    const job = { launch, mode: 'writer', model, settingsMode, stdin: writerStdin(made.input), out, name: `${dir}/${qid}`, lang };
    const [done] = await runBatch([job], { concurrency: 1, gate, claim });
    const run = { code: done.code, signal: done.signal, skipped: done.skipped, tokens: done.tokens, result: done.facts.result !== null };
    const parsed = parseQuestionLine(done.facts.result?.text ?? '');
    if (!parsed.ok) return { state: 'discard', qid, why: parsed.word, run };
    const leak = admitFact(item.kind, item.fact, '', parsed.question, { repoRoots: item.repo_roots });
    if (!leak.admitted) return { state: 'discard', qid, why: 'writer-leak', run };
    const entry = {
      qid, store_id: item.store_id, ccrc_id: item.ccrc_id, generation: item.generation, boundary_uuid: item.boundary_uuid,
      kind: item.kind, fact: item.fact, fact_raw: item.fact_raw, question: parsed.question,
      source_entry_uuid: item.source_entry_uuid, repo_roots: [...item.repo_roots],
    };
    return { state: 'question', qid, entry, run };
  };
  return Object.freeze({ launch, stamps: () => [...stamps].sort(), ask });
}

/** A frozen list's exact text (W2-D73): canonicalJson of the head and the entries sorted by qid, with no trailing
 *  newline. The prompt and protocol shas are the texts this driver sends. Pure. A wrong qid, a repeated one, an unknown
 *  kind, a key outside FROZEN_ENTRY_KEYS, or a writer model that is not an exact Opus id is a TypeError.
 *  @param {string} section 'quiz' or 'pilot'
 *  @param {{ writer_model: string, labeller: object }} head
 *  @param {FrozenEntry[]} entries
 *  @returns {string} */
export function frozenListText(section, head, entries) {
  if (!WRITER_SECTIONS.includes(section)) throw new TypeError(`frozenListText: section ${JSON.stringify(section)} is not one of ${WRITER_SECTIONS.join(', ')}`);
  const { writer_model, labeller } = head ?? {};
  if (typeof writer_model !== 'string' || !EXACT_MODEL_ID_RE.test(writer_model) || !OPUS_MODEL_RE.test(writer_model)) {
    throw new TypeError(`frozenListText: writer_model ${JSON.stringify(writer_model)} is not an exact Opus model id`);
  }
  if (labeller === null || typeof labeller !== 'object' || Array.isArray(labeller)) throw new TypeError('frozenListText: labeller is an object');
  if (!Array.isArray(entries)) throw new TypeError('frozenListText: entries is an array');
  const seen = new Set();
  for (const e of entries) {
    const keys = e !== null && typeof e === 'object' && !Array.isArray(e) ? Object.keys(e).sort().join(',') : '';
    if (keys !== FROZEN_ENTRY_KEYS.join(',')) throw new TypeError(`frozenListText: an entry's keys are ${keys}, not ${FROZEN_ENTRY_KEYS.join(',')}`);
    for (const k of ['fact_raw', 'question', 'source_entry_uuid']) {
      if (typeof e[k] !== 'string' || e[k] === '') throw new TypeError(`frozenListText: entry ${String(e.qid)} ${k} is a non-empty string`);
    }
    if (!Array.isArray(e.repo_roots) || !e.repo_roots.every((r) => typeof r === 'string' && r !== '')) {
      throw new TypeError(`frozenListText: entry ${String(e.qid)} repo_roots is a list of non-empty strings`);
    }
    if (e.qid !== qidOf(e)) throw new TypeError(`frozenListText: entry ${String(e.qid)} is not qidOf its own six fields`);
    if (seen.has(e.qid)) throw new TypeError(`frozenListText: qid ${e.qid} is repeated`);
    seen.add(e.qid);
  }
  const sorted = [...entries].sort((a, b) => (a.qid < b.qid ? -1 : a.qid > b.qid ? 1 : 0));
  return canonicalJson({
    kind: FROZEN_LIST_KINDS[section], version: 1, writer_model, writer_prompt_sha256: WRITER_PROMPT_SHA256,
    answer_protocol_sha256: ANSWER_PROTOCOL_SHA256, labeller, entries: sorted });
}

/** Write `<out>/<section>/frozen.json` (0600, tmp then rename, D-5986) and answer the sha256 of the bytes on disk. The
 *  same bytes again are a no-op with the same sha; a different list over one already there refuses `out-refused`: a
 *  frozen list is never replaced, and the remedy is a fresh --out.
 *  @param {string} out  @param {string} section  @param {string} text frozenListText's answer  @returns {string} */
export function writeFrozenList(out, section, text) {
  if (!WRITER_SECTIONS.includes(section)) throw new TypeError(`writeFrozenList: section ${JSON.stringify(section)} is not one of ${WRITER_SECTIONS.join(', ')}`);
  if (typeof text !== 'string' || text === '') throw new TypeError('writeFrozenList: text is frozenListText\'s answer');
  ensurePlainDir(out, section);
  const rel = `${section}/${FROZEN_LIST_FILE}`;
  const have = readPlain(path.join(out, rel), OUT_JSON_CAP);
  if (have.state === 'bad') refuse('out-refused', `${rel} ${badWord(have)}`);
  if (have.state === 'absent') writePlain(out, rel, text);
  else if (have.bytes.toString('utf8') !== text) refuse('out-refused', `${rel} holds another frozen list; a frozen list is never replaced (use a fresh --out)`);
  return shaOfPlain(out, rel);
}

/** A frozen list as a consumer reads it (W2-D73): its bytes' sha256 checked BEFORE they are parsed (`quiz-sha-mismatch`),
 *  then the bytes must be exactly the canonical list their own fields give (`input-invalid`). Read through readPlain
 *  (D-5986), so a FIFO or a link refuses and is never waited on or followed.
 *  @param {string} p  @param {string} sha256  @param {string} section  @returns {any} */
export function loadFrozenList(p, sha256, section) {
  if (!WRITER_SECTIONS.includes(section)) throw new TypeError(`loadFrozenList: section ${JSON.stringify(section)} is not one of ${WRITER_SECTIONS.join(', ')}`);
  if (typeof sha256 !== 'string' || !SHA256_RE.test(sha256)) refuse('args-invalid', 'a frozen list sha256 is 64 lowercase hex');
  const read = readPlain(path.resolve(p), OUT_JSON_CAP);
  if (read.state === 'absent') refuse('input-invalid', 'frozen list unreadable ENOENT');
  if (read.state === 'bad') refuse('input-invalid', `frozen list ${read.why === 'unreadable' ? `unreadable ${read.code}` : read.why}`);
  const got = sha256Hex(read.bytes);
  if (got !== sha256) refuse('quiz-sha-mismatch', `${section} frozen list: expected ${sha256}, measured ${got}`);
  const text = read.bytes.toString('utf8');
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    refuse('input-invalid', 'frozen list not-json');
  }
  let again;
  try {
    again = frozenListText(section, { writer_model: doc?.writer_model, labeller: doc?.labeller }, doc?.entries);
  } catch (e) {
    if (e instanceof TypeError) refuse('input-invalid', `frozen list shape: ${e.message}`);
    throw e;
  }
  if (again !== text) refuse('input-invalid', 'frozen list is not the canonical list its own fields give');
  return doc;
}

/** A stored assistant row's first-call input (spec §10.2: input + cache_creation + cache_read), or null when its usage
 *  cannot be read: an absent `input_tokens`, or any count that is not a non-negative safe integer. An absent cache count
 *  is 0. Never 0 for an unreadable row. */
export function usageInputOf(body) {
  const u = body?.message?.usage;
  if (u === null || typeof u !== 'object' || Array.isArray(u)) return null;
  const count = (v, required) => (v === undefined && !required ? 0 : Number.isSafeInteger(v) && v >= 0 ? v : null);
  const parts = [count(u.input_tokens, true), count(u.cache_creation_input_tokens, false), count(u.cache_read_input_tokens, false)];
  return parts.includes(null) ? null : parts.reduce((a, b) => a + b, 0);
}

/** A stored user row's text: a string content as it is, a block list as its text blocks joined by newlines, null when it
 *  holds none (the stream reader's own rule, sjResultText). */
export function userTextOf(body) {
  return sjResultText(body?.message?.content);
}

/** The fidelity pilot's original side, from the store's rows (each `{type, provenance, model, body, rawLen}`, in file
 *  order): the epoch's first call (the first assistant row whose model is not synthetic), the operator rows before it
 *  (their text is that call's user text), and the first non-synthetic assistant row after the summary row of N's holding
 *  copy. Every missing piece answers `unmeasured` with its own reason. Pure. */
export function originalSideOf({ epochRows, copyRows, summaryIndex }) {
  const isCall = (r) => r.type === 'assistant' && typeof r.model === 'string' && !isSyntheticModel(r.model);
  const firstAt = epochRows.findIndex(isCall);
  if (firstAt === -1) return { state: 'unmeasured', why: 'epoch-first-call-absent' };
  const firstInput = usageInputOf(epochRows[firstAt].body);
  if (firstInput === null) return { state: 'unmeasured', why: 'epoch-first-usage-absent' };
  const userRows = [];
  for (const r of epochRows.slice(0, firstAt)) {
    if (r.provenance !== 'operator') continue;
    const text = userTextOf(r.body);
    if (text !== null && text !== '') userRows.push({ text, rawLen: r.rawLen });
  }
  if (userRows.length === 0) return { state: 'unmeasured', why: 'epoch-first-user-text-absent' };
  const post = copyRows.slice(summaryIndex + 1).find(isCall);
  if (post === undefined) return { state: 'unmeasured', why: 'post-boundary-call-absent' };
  const postInput = usageInputOf(post.body);
  if (postInput === null) return { state: 'unmeasured', why: 'post-boundary-usage-absent' };
  return { state: 'measured', firstInput, postInput, userRows };
}

/** The fidelity pilot's three stdins for one boundary, all through Task 1's composer: the reconstructed payload with an
 *  empty question, which is reconstructPayload's own text, so its summary and kept members come redacted from the one
 *  reconstruction and are never handed in as raw parts (W2-D54, W2-D75); the empty-question run (no summary, no kept
 *  member); and the user-text run (the epoch's first-call operator text, redacted whole over the run's pair index, as
 *  the question). Every one carries ANSWER_PROTOCOL as item 3 (W2-D64). A user row over the decode cap is discarded
 *  (W2-D54), and a boundary reconstruction discards answers its own RECON_DISCARDS word.
 *  @param {ReplayStore} rs  @param {number} boundaryEntryId  @param {Array<{ text: string, rawLen: number }>} userRows */
export function fidelityStdins(rs, boundaryEntryId, userRows) {
  if (!Array.isArray(userRows) || userRows.length === 0) throw new TypeError("fidelityStdins: the user-text run needs originalSideOf's userRows");
  const texts = [];
  for (const r of userRows) {
    const t = redactForSpawn(r, rs.idx);
    if (t.state === 'discard') return { state: 'discard', why: t.why };
    texts.push(t.text);
  }
  const p = reconstructPayload(rs, boundaryEntryId, '');
  if (p.state !== 'payload') return p;
  return {
    state: 'stdins',
    stdins: Object.freeze({
      payload: p.text,
      empty: composePayload(FIDELITY_EMPTY_PARTS, ''),
      'user-text': composePayload(FIDELITY_EMPTY_PARTS, texts.join('\n')),
    }),
  };
}

/** The fidelity figures for one boundary (spec §10.2): each side net of its own fixed overhead. The replay side's
 *  overhead is the empty-question run's first-call input; the user text's tokens are the user-text run's less that; the
 *  original's overhead is its epoch's first-call input less those tokens. `runs` are the three runs' StreamFacts. Any
 *  piece that is missing or not positive answers `unmeasured` with its own reason, never a 0. Pure.
 *  @param {{ original: { state: string, why?: string, firstInput?: number, postInput?: number },
 *    runs: Record<string, StreamFacts> }} p */
export function fidelityFigures({ original, runs }) {
  if (original.state !== 'measured') return { state: 'unmeasured', why: original.why };
  const first = {};
  for (const k of FIDELITY_RUNS) {
    const u = runs[k]?.firstCallUsage;
    if (u === null || u === undefined) return { state: 'unmeasured', why: `${k}-first-call-absent` };
    first[k] = u.input + u.cacheCreation + u.cacheRead;
  }
  const userTextTokens = first['user-text'] - first.empty;
  if (userTextTokens <= 0) return { state: 'unmeasured', why: 'user-text-nonpositive' };
  const originalOverhead = original.firstInput - userTextTokens;
  if (originalOverhead < 0) return { state: 'unmeasured', why: 'original-overhead-negative' };
  const originalPayload = original.postInput - originalOverhead;
  if (originalPayload <= 0) return { state: 'unmeasured', why: 'original-payload-nonpositive' };
  const replayPayload = first.payload - first.empty;
  if (replayPayload <= 0) return { state: 'unmeasured', why: 'replay-payload-nonpositive' };
  return {
    state: 'measured', original_payload: originalPayload, replay_payload: replayPayload,
    original_overhead: originalOverhead, replay_overhead: first.empty, user_text_tokens: userTextTokens,
  };
}

// ── sourceQuiz: Tasks 1 to 6 composed, in W2-D71's lazy order ───────────────────────────────────────────────────
/** The epoch reads sourceQuiz adds: a transcript's session uuid, and N's epoch's cwd and cwd_real (mining's paths). */
const SOURCE_STMTS = new WeakMap();
function sourceStmts(db) {
  let s = SOURCE_STMTS.get(db);
  if (s !== undefined) return s;
  s = {
    transcript: db.prepare('SELECT cc_session_uuid FROM transcripts WHERE transcript_pk = ?'),
    epoch: db.prepare('SELECT cwd, cwd_real FROM epochs WHERE session_pk = ? AND seq = ?'),
  };
  SOURCE_STMTS.set(db, s);
  return s;
}

/** One node's sourcing run (W2-D71), Tasks 1 to 6 composed over the run's one open store (`rs`, R3):
 *  - the store's admitted boundaries (Task 3), grouped into this node's families; no family list is taken in either
 *    mode (R10);
 *  - quiz mode: every local admitted family, less every pilot family and every control-held (store_id, ccrc_id) at any
 *    generation (quizPopulation, W2-D71, W2-D77), never the census's active list, which feeds the assignment only
 *    (W2-D73; the headless arm resolves a family from its epochs, W2-D40). The families come in quizFamilyOrderKey
 *    order (the 'quiz-sample' substream seed hashed with familyKey, W2-D71 as amended 2026-10-22) and each family's
 *    candidates from its own stream (familyRng), so a question's `rank`, [order key, candidate rank], is the walk over
 *    every node's families and freeze merges the nodes in that order (R4, R10);
 *  - pilot mode: the walk is this node's families on the pilot's one stream, the fidelity boundaries first (at most
 *    one per family) and the usage questions after (W2-D71);
 *  - a family's candidates are mined from each admitted boundary's leaf span (Tasks 1, 2), deduplicated, and given
 *    their qid as `id` (W2-D73, R4);
 *  - the stages, in QUIZ_STAGES order: redaction and the producer (Task 2), admission against B (Task 4, built once per
 *    boundary, lazily), answerability (Task 5), the writer (`writer.ask`, this task's handle, R6) and the question's
 *    own admission;
 *  - per admitted question, the same-millisecond count over the CLI's family scope (Task 5), reported, never gating;
 *  - the baseline record under `<out>/<mode>/baseline.json`, every B built or discarded (Task 4).
 *  `top` is Baseline B's test seam; no subcommand passes it.
 *  @param {{ mode: 'quiz' | 'pilot', rs: ReplayStore, home: string, out: string,
 *    writer: { ask: (section: string, item: object) => Promise<WriterAnswer> }, seedHex: string,
 *    exclude: { pilotFamilies: Array<{store_id: string, ccrc_id: string, generation: string}>, assignment: Array<object> },
 *    plan: { target?: number, n_fidelity?: number, n_usage?: number, caps: { family: number, boundary: number, kind_per_family: number } },
 *    configDirs: readonly string[], top?: string }} input
 *  @returns {Promise<{ entries: Array<FrozenEntry & { rank: [string | number, number] }>, fidelity: Array<object>, counts: object,
 *    asof_same_ms_hits: Record<string, unknown> }>} */
export async function sourceQuiz({ mode, rs, home, out, writer, seedHex, exclude, plan, configDirs, top }) {
  if (!WRITER_SECTIONS.includes(mode)) throw new TypeError(`sourceQuiz: mode ${JSON.stringify(mode)} is not one of ${WRITER_SECTIONS.join(', ')}`);
  const storeId = rs.storeId;
  const admission = admitStoreBoundaries(rs);
  const local = new Map();
  for (const b of admission.boundaries) {
    if (!b.admitted) continue;
    const key = familyKeyOf({ store_id: storeId, ccrc_id: b.ccrc_id, generation: b.generation });
    if (!local.has(key)) local.set(key, { store_id: storeId, ccrc_id: b.ccrc_id, generation: b.generation, boundaries: [] });
    local.get(key).boundaries.push(b);
  }
  const counts = { boundaries: admission.counts, mined: newDropCounts(), discards: {}, writer: { questions: 0, failed_runs: 0, malformed_replies: 0, leaks: 0 } };
  const discard = (why) => { counts.discards[why] = (counts.discards[why] ?? 0) + 1; };
  const byBoundary = new Map();   // boundary_uuid -> { row, spanEntryIds }
  const baselines = new Map();    // boundary_uuid -> B
  const scopes = new Map();       // family key -> transcript pks
  const memo = new Map();         // leaf_key -> redacted leaf, for the run
  const s = sourceStmts(rs.db);
  const candidatesOf = (fam) => async () => {
    if (fam === undefined) return [];
    const mined = [];
    for (const b of fam.boundaries) {
      const span = spanRowsOf(rs, b.entry_id);
      if (span.state !== 'span') { discard(span.why); continue; }
      const t = s.transcript.get(b.transcript_pk);
      const ep = t === undefined ? null : epochOfUuid(rs.db, t.cc_session_uuid);
      const e = ep === null ? undefined : s.epoch.get(ep.session_pk, ep.seq);
      const m = mineBoundary({
        storeId, ccrcId: fam.ccrc_id, generation: fam.generation, boundaryUuid: b.uuid, boundaryTsMs: b.ts_ms, rows: span.rows,
        pick: (row) => expandEntryBody(rs, row), cwd: e?.cwd ?? null, cwdReal: e?.cwd_real ?? null, configDirs,
      });
      for (const [w, n] of Object.entries(m.counts)) counts.mined[w] += n;
      if (m.state !== 'mined') { discard(m.why); continue; }
      byBoundary.set(b.uuid, { row: b, spanEntryIds: span.rows.map((r) => Number(r.entry_id)) });
      mined.push(m);
    }
    return dedupeFamily(mined, counts.mined).map((c) => ({ ...c, id: qidOf(c) }));
  };
  const baselineFor = (c) => {
    if (!baselines.has(c.boundary_uuid)) {
      baselines.set(c.boundary_uuid, baselineOf(rs, byBoundary.get(c.boundary_uuid).row, { home, configDirs, budget: { bytes: 0 }, top }));
    }
    return baselines.get(c.boundary_uuid);
  };
  const keep = (c) => ({ keep: true, candidate: c });
  const drop = (reason) => ({ keep: false, reason });
  const stages = {
    redaction: async (c) => { const r = screenRedaction(c, rs.idx, memo); return r === null ? keep(c) : drop(r); },
    producer: async (c) => { const r = screenProducer(c); return r === null ? keep(c) : drop(r); },
    'admit-baseline': async (c) => {
      const b = baselineFor(c);
      if (b.state !== 'built') return drop(b.why);
      const r = screenBaseline(c, b.text);   // Task 2's one admission-against-B call (W2-D62)
      return r === null ? keep(c) : drop(r);
    },
    answerable: answerableStage(rs.db, rs.idx, (c) => {
      const b = byBoundary.get(c.boundary_uuid);
      return { tsMs: b.row.ts_ms, transcriptPk: b.row.transcript_pk, spanEntryIds: b.spanEntryIds, factRaw: c.fact_raw };
    }),
    writer: async (c) => {
      // The question's source is the one answerability found (W2-D73: the first source that passes).
      const a = await writer.ask(mode, { ...c, source_entry_uuid: c.source.entryUuid });
      if (a.run !== undefined && (a.run.code !== 0 || a.run.signal !== null || a.run.result === false)) counts.writer.failed_runs += 1;
      if (a.state === 'question' || a.why === 'writer-leak') return keep({ ...c, answer: a });
      if (a.why === 'writer-malformed') counts.writer.malformed_replies += 1;
      return drop(a.why);
    },
    'admit-question': async (c) => {
      if (c.answer.state === 'question') { counts.writer.questions += 1; return keep(c); }
      counts.writer.leaks += 1;
      return drop('writer-leak');
    },
  };
  const afterAdmit = sameMsReport(rs.db, (c) => {
    const b = byBoundary.get(c.boundary_uuid);
    const fk = familyKeyOf(c);
    if (!scopes.has(fk)) scopes.set(fk, familyScopeOf(rs.db, c));
    return { tsMs: b.row.ts_ms, holdingFileId: b.row.file_id, transcriptPks: scopes.get(fk), factRaw: c.fact_raw };
  });
  let rng;
  let candidateRng;
  let familyOrder;
  let walk;
  let fidelity = [];
  const own = [...local.values()];   // this node's admitted families, each with its admitted boundaries
  const walked = (f) => ({ store_id: f.store_id, ccrc_id: f.ccrc_id, generation: f.generation, admitted: f.boundaries.length, candidates: candidatesOf(f) });
  if (mode === 'quiz') {
    // W2-D71's population over this node (R10): every local admitted family less the exclusions, never a census list.
    rng = quizRng(seedHex);
    candidateRng = (f) => familyRng(seedHex, 'quiz-sample', f);
    familyOrder = (f) => quizFamilyOrderKey(seedHex, f);
    const pop = quizPopulation(own.map((f) => ({ ...f, admitted: f.boundaries.length })),
      { pilotFamilies: exclude.pilotFamilies, assignment: exclude.assignment });
    counts.population = pop.excluded;
    walk = pop.families.map(walked);
  } else {
    rng = pilotRng(seedHex);
    const picked = await sampleFidelityBoundaries({
      families: own.map((f) => ({ store_id: f.store_id, ccrc_id: f.ccrc_id, generation: f.generation,
        boundaries: async () => f.boundaries.map((b) => ({ boundary_uuid: b.uuid, entry_id: b.entry_id })) })),
      rng, n: plan.n_fidelity,
      admitBoundary: async (b) => {
        const p = reconstructPayload(rs, b.entry_id, '');
        return p.state === 'payload' ? { keep: true } : { keep: false, reason: p.why };
      },
    });
    counts.fidelity = picked.drops;
    fidelity = picked.boundaries.map((p) => ({ store_id: storeId, ccrc_id: p.family.ccrc_id, generation: p.family.generation, boundary_uuid: p.boundary.boundary_uuid }));
    walk = own.map(walked);
  }
  const target = mode === 'quiz' ? plan.target : plan.n_usage;
  const sampled = await sampleQuestions({ families: walk, rng, quotas: { target, caps: plan.caps }, stages, afterAdmit, candidateRng, familyOrder });
  counts.drops = sampled.drops;
  counts.skips = sampled.skips;
  writeBaselineRecord(out, mode, { storeId, rows: [...baselines.entries()].map(([u, b]) => baselineRow(u, b)) });
  return {
    entries: sampled.questions.map((q) => ({ ...q.answer.entry, rank: q.rank })),
    fidelity, counts, asof_same_ms_hits: sampled.reports,
  };
}
```

The section reads no environment variable, so W2-4 Task 5's scan (the entry guard's by-name projection is the driver's only `process.env` line) stays green. It calls no `spawn` of its own: every child goes through `runBatch` or `measureClaudeVersion`. It does not spell `node:sqlite`, `recall-off`, any switch name, `redactDisplayWindow`, `.credentials.json`, or either arm value, even in a comment. None of its names is one of O14's `VOCABS`, and it declares none of the gate's names again: `FACT_KINDS`, `WRITER_INPUTS` and the model tests are imported.

- [ ] **Step 5: Run them and see them pass, then the typecheck.** In the foreground, with a timeout of at least 600000 ms:

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-5a Task 6'
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'an empty stream is no init'
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts
cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit
```

Expected:
- The first filter is green, `43 passed` (on darwin, `38 passed | 5 skipped`):
  - 12 writer-input cases, the F6 bearer case (R10) among them;
  - 15 writer-spawn cases, two of them RP1-writer and four RP3-writer, and two of the gate before a later writer batch (W2-D55's budget, the limits row);
  - 7 frozen-list cases;
  - 4 fidelity cases;
  - 5 cases in the `sourceQuiz` describe (quiz mode, pilot mode, the store-backed `fidelityStdins` case, the quiz population case with its CONTROL, R10, and the W2-D67 redaction-stage case over a second box whose command is key-shaped).
  Each spawning case runs the stub one to three times in print mode, in well under a second; the sourceQuiz box runs the sweep a few times once, and the W2-D67 case's own box a few times more.
- The re-expected W2-4 case is green.
- The whole file is green: every earlier case plus these 43. That includes W2-4 Task 5's env scan, Task 1's import pin (unchanged: this task adds names to the gate's braces only, which `EXACT_NAMES` does not pin), and W2-4 Task 4's `redactDisplayWindow` scan.
- tsc prints nothing. A line that names only `agent/src/` or a module that is not installed comes from the worktree's install, not from this task.

- [ ] **Step 6: Measure every new guard red, then green.** From the repository root. Each block makes one exact replacement, which must match exactly once, runs one filter and shows it red, then restores the file with `cp`. The python body is a quoted heredoc.

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w2-5a/scratch"; mkdir -p "$SCRATCH"
mut() {   # mut <file> <old> <new>: one exact replacement, asserted to match once
  python3 - "$1" "$2" "$3" <<'EOF'
import sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
assert s.count(old) == 1, (p, old, s.count(old))
open(p, 'w').write(s.replace(old, new))
EOF
}
D=deploy/history-replay.mjs
cp "$D" "$SCRATCH/driver.t6.orig"
T() { (cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t "$1"); cp "$SCRATCH/driver.t6.orig" "$D"; }

# M1: the leaf is never redacted (W2-D54, W2-D67).
mut "$D" "    const leaf = redactForSpawn(item.leaf, idx);" "    const leaf = { state: 'text', text: item.leaf.text };"
T 'W2-D54 order|AKIA-shaped key in the leaf'
# Expected RED (predicted): 2 failed; the straddle case finds the secret's head, and the AKIA case (its excerpt run) finds the key in the stub's stdin.

# M2: the window is taken BEFORE redaction (W2-D54's order reversed).
mut "$D" "    const leaf = redactForSpawn(item.leaf, idx);" "    const leaf = redactForSpawn({ text: windowExcerpt({ base: item.leaf.text, factRaw: item.fact_raw, firstWindow: WRITER_LEAF_WINDOW, pairLine: null }).excerpt, rawLen: item.leaf.rawLen }, idx);"
T 'W2-D54 order'
# Expected RED (predicted): 1 failed; the excerpt holds the secret's first 10 characters, so `not.toContain(head)` fails.

# M3: the window starts at the fact instead of being centred on it.
mut "$D" "Math.max(0, p + Math.floor(L / 2) - Math.floor(w / 2))" "Math.max(0, p)"
T 'centred on the first occurrence'
# Expected RED (predicted): 1 failed; the excerpt starts at code point 6000, not 4009.

# M4: the LAST occurrence of the raw fact is the centre.
mut "$D" "base.indexOf(factRaw) : -1;" "base.lastIndexOf(factRaw) : -1;"
T 'centred on the first occurrence'
# Expected RED (predicted): 1 failed; the window lands on the second copy of the fact.

# M5: the paired tool_use line is not capped.
mut "$D" "      pairLine = cpSlice(Array.from(renderToolUseLine(item.pair.name, input.text)), 0, WRITER_PAIR_CAP);" "      pairLine = renderToolUseLine(item.pair.name, input.text);"
T 'capped at 2000 code points'
# Expected RED (predicted): 1 failed; the last line is longer than 2000 code points.

# M6: the paired tool_use input is not redacted.
mut "$D" "      const input = redactForSpawn(item.pair.input, idx);" "      const input = { state: 'text', text: item.pair.input.text };"
T 'capped at 2000 code points|AKIA-shaped key in the leaf'
# Expected RED (predicted): 2 failed; the pair line holds the pinned secret whole, and the excerpt run's stdin holds the key from the paired tool_use.

# M7: the 8 KiB budget is never enforced.
mut "$D" "    if (over <= 0) return { state: 'text', excerpt };" "    if (true) return { state: 'text', excerpt };"
T 'shrinks around the fact|own bytes pass 8 KiB|windowed to the 8 KiB budget'
# Expected RED (predicted): 3 failed; each excerpt's byte length is over 8192, and the over-cap fact answers text.

# M8: a fact that cannot fit is sent anyway.
mut "$D" "    if (w === L) return { state: 'discard', why: 'writer-input-over-cap' };" "    if (w === L) return { state: 'text', excerpt };"
T 'own bytes pass 8 KiB'
# Expected RED (predicted): 1 failed; it answers { state: 'text', … } instead of the discard.

# M9: the writer model's Opus test is dropped.
mut "$D" "  if (typeof model !== 'string' || !EXACT_MODEL_ID_RE.test(model) || !OPUS_MODEL_RE.test(model)) {" "  if (typeof model !== 'string' || !EXACT_MODEL_ID_RE.test(model)) {"
T 'not an exact Opus id'
# Expected RED (predicted): 1 failed; claude-other-9-1 opens and the --version spawn makes the stub log non-null.

# M10: admission is skipped (the writer always runs on the upstream account).
mut "$D" "  const launch = admitAccount(json, roster, accountId, home);   // RP3-writer" "  const launch = admitAccount(json, roster, 'up-a', home);   // RP3-writer"
T 'RP3-writer'
# Expected RED (measured 5 failed over a predicted 4): each refused account opens, and the stub logs a --version call; RP1-writer gen-a fails too, because admission is pinned to up-a and the generated account's wrapper and config dir are never used.

# M11: the writer spawns in box mode (an arm's tools).
mut "$D" "    const job = { launch, mode: 'writer', model," "    const job = { launch, mode: 'box', model,"
T 'RP1-writer'
# Expected RED (predicted): 2 failed; the argv carries `--tools Bash,Agent` and `--allowedTools`, and run.json's mode is box.

# M12: the question is never tested against the fact.
mut "$D" "    if (!leak.admitted) return { state: 'discard', qid, why: 'writer-leak', run };" "    if (false) return { state: 'discard', qid, why: 'writer-leak', run };"
T '7-character SHA prefix'
# Expected RED (predicted): 1 failed; the leaking question answers state question.

# M13: the reply is taken whole, with no QUESTION line required.
mut "$D" "    const parsed = parseQuestionLine(done.facts.result?.text ?? '');" "    const parsed = { ok: true, question: done.facts.result?.text ?? '', word: '' };"
T 'no QUESTION line'
# Expected RED (predicted): 1 failed; the first reply answers state question.

# M14: the preflight runs only at open.
mut "$D" "    if (made.state === 'discard') return { state: 'discard', qid, why: made.why };
    await preflightNow();" "    if (made.state === 'discard') return { state: 'discard', qid, why: made.why };"
T 'a version that moves between two asks'
# Expected RED (predicted): 1 failed; the second ask spawns, so the promise resolves and the stub runs twice.

# M15: changed input for a finished qid is reused silently.
mut "$D" "  if (read.bytes.toString('utf8') !== text) refuse('out-refused', \`writer-input-changed \${rel}\`);" ""
T 'changed input for the same qid'
# Expected RED (predicted): 1 failed; the changed ask resolves with the old question instead of refusing.

# M16: the frozen entries keep their input order.
mut "$D" "    answer_protocol_sha256: ANSWER_PROTOCOL_SHA256, labeller, entries: sorted });" "    answer_protocol_sha256: ANSWER_PROTOCOL_SHA256, labeller, entries: [...entries] });"
T 'in any input order'
# Expected RED (predicted): 1 failed; the two orders give different bytes.

# M17: an entry's qid is not recomputed.
mut "$D" "    if (e.qid !== qidOf(e)) throw new TypeError(\`frozenListText: entry \${String(e.qid)} is not qidOf its own six fields\`);" ""
T 'refuses a wrong qid'
# Expected RED (predicted): 1 failed; the entry with qid 0000000000000000 is accepted.

# M18: a trailing newline is written.
mut "$D" "    answer_protocol_sha256: ANSWER_PROTOCOL_SHA256, labeller, entries: sorted });" "    answer_protocol_sha256: ANSWER_PROTOCOL_SHA256, labeller, entries: sorted }) + '\n';"
T 'no trailing newline'
# Expected RED (predicted): 1 failed; the text ends with a newline, and canonicalJson of its parse differs from it.

# M19: a different list replaces the frozen one.
mut "$D" "  else if (have.bytes.toString('utf8') !== text) refuse('out-refused'," "  else if (false) refuse('out-refused',"
T 'refuses a different list over it'
# Expected RED (predicted): 1 failed; the second write does not throw.

# M20: the consumer parses before (and without) checking the sha.
mut "$D" "  if (got !== sha256) refuse('quiz-sha-mismatch'," "  if (false) refuse('quiz-sha-mismatch',"
T 'a one-byte edit refuses'
# Expected RED (predicted): 1 failed; the edited list loads (it is still canonical), the consumer spawns, and the stub log is not null.

# M21: a list that is not canonical is accepted.
mut "$D" "  if (again !== text) refuse('input-invalid', 'frozen list is not the canonical list its own fields give');" ""
T 'not the canonical list'
# Expected RED (predicted): 1 failed; the indented list loads.

# M22: the first call's usage is a later message's when the first carried none.
mut "$D" "  const firstCallUsage = firstKey.done ? null : messages.get(firstKey.value);" "  const firstCallUsage = [...messages.values()].find((u) => u !== null) ?? null;"
T 'firstCallUsage'
# Expected RED (predicted): 1 failed; the m0-without-usage stream answers m1's usage, not null.

# M23: the original side ignores the user text (overhead = the whole first call).
mut "$D" "  const originalOverhead = original.firstInput - userTextTokens;" "  const originalOverhead = original.firstInput;"
T 'each side net of its own fixed overhead'
# Expected RED (predicted): 1 failed; original_payload is 18000, not 18200.

# M24: the replay side is not netted of the empty-question run.
mut "$D" "  const replayPayload = first.payload - first.empty;" "  const replayPayload = first.payload;"
T 'each side net of its own fixed overhead'
# Expected RED (predicted): 1 failed; replay_payload is 25000, not 16000.

# M25: a run with no first-call usage is read as 0.
mut "$D" "    if (u === null || u === undefined) return { state: 'unmeasured', why: \`\${k}-first-call-absent\` };" "    if (u === null || u === undefined) { first[k] = 0; continue; }"
T 'each side net of its own fixed overhead'
# Expected RED (predicted): 1 failed; the empty-run case answers measured figures instead of empty-first-call-absent.

# M26: a synthetic row counts as the first call.
mut "$D" "  const isCall = (r) => r.type === 'assistant' && typeof r.model === 'string' && !isSyntheticModel(r.model);" "  const isCall = (r) => r.type === 'assistant' && typeof r.model === 'string';"
T 'the first non-synthetic call of the epoch'
# Expected RED (predicted): 1 failed; firstInput is 1 and the operator text before the synthetic row is the only user row.

# M27: every row before the first call is user text, harness included.
mut "$D" "    if (r.provenance !== 'operator') continue;" ""
T 'the first non-synthetic call of the epoch'
# Expected RED (predicted): 1 failed; userRows also holds the harness notice.

# M28: the empty-question run carries the payload.
mut "$D" "      empty: composePayload(FIDELITY_EMPTY_PARTS, '')," "      empty: p.text,"
T 'through one composer'
# Expected RED (predicted): 1 failed (on darwin, skipped); the empty run holds the summary text.

# M29: the user text reaches the composer unredacted.
mut "$D" "    const t = redactForSpawn(r, rs.idx);" "    const t = { state: 'text', text: r.text };"
T 'through one composer'
# Expected RED (predicted): 1 failed (on darwin, skipped); the user-text stdin holds the AKIA-shaped key.

# M30: the baseline record not written (W2-D68's counts, Task 4).
mut "$D" "  writeBaselineRecord(out, mode, { storeId, rows: [...baselines.entries()].map(([u, b]) => baselineRow(u, b)) });" ""
T 'sourceQuiz'
# Expected RED (predicted): 2 failed (on darwin, skipped); the quiz case and the W2-D67 shipped-path case each read no
# baseline.json (ENOENT).

# M31: the same-millisecond reports dropped.
mut "$D" "    fidelity, counts, asof_same_ms_hits: sampled.reports," "    fidelity, counts, asof_same_ms_hits: {},"
T 'sourceQuiz'
# Expected RED (predicted): 1 failed; the quiz case's report is {} instead of the qid's count.

# M32: the question's source left as the mined row instead of answerability's (W2-D73).
mut "$D" "      const a = await writer.ask(mode, { ...c, source_entry_uuid: c.source.entryUuid });" "      const a = await writer.ask(mode, { ...c, source_entry_uuid: 'unmeasured' });"
T 'sourceQuiz'
# Expected RED (predicted): 1 failed; the entry's source_entry_uuid is not the command row's.

# M33 (W2-D54): the payload stdin composed apart from reconstructPayload's redacted text.
mut "$D" "      payload: p.text," "      payload: composePayload(FIDELITY_EMPTY_PARTS, ''),"
T 'through one composer'
# Expected RED (predicted): 1 failed (on darwin, skipped); the payload stdin is not reconstructPayload's text.

# M34 (W2-D55): the writer's gate built without its budget.
mut "$D" "  const gate = batchGate({ out, home, accountId: launch.accountId, budget, limits });" "  const gate = batchGate({ out, home, accountId: launch.accountId, budget: Number.MAX_SAFE_INTEGER, limits });"
T 'stops at its budget before the next writer batch'
# Expected RED (predicted): 1 failed; the second ask spawns (2 stub runs) where budget-exhausted was expected.

# M35 (W2-D55): the writer's gate built on a threshold the caller never gave.
mut "$D" "  const gate = batchGate({ out, home, accountId: launch.accountId, budget, limits });" "  const gate = batchGate({ out, home, accountId: launch.accountId, budget, limits: { ...limits, threshold_pct: 100 } });"
T 'limits gate stops the writer at open|raised past the threshold between two asks'
# Expected RED (predicted): 2 failed; neither the open nor the second ask refuses limits-threshold at five 90.

# M36 (W2-D67, R10 F6): F not screened (Task 2's line, re-measured from the writer's side).
mut "$D" "  if (redactField(c.fact, idx) !== c.fact) return 'redact-fact';
" ""
T 'whitespace-split bearer token, mined by Task 2'
# Expected RED (predicted): 1 failed; screenRedaction answers null where redact-fact was expected, so the writer stage
# would be handed F with the token whole.

# M37 (R10 C1, W2-D77): quiz mode walks every local family, the exclusions ignored.
mut "$D" "    walk = pop.families.map(walked);" "    walk = own.map(walked);"
T 'never a census list'
# Expected RED (predicted, non-darwin): 1 failed; the pilot family is sourced (one entry where [] was expected), and the
# fake writer is asked.

# M38 (R10 C1): the quiz's keyed family order dropped, the families drawn as the pilot's are.
mut "$D" "    familyOrder = (f) => quizFamilyOrderKey(seedHex, f);" "    familyOrder = undefined;"
T 'quiz mode: the leaf'
# Expected RED (predicted, non-darwin): 1 failed; the entry's rank is [0, 0], not [the family's order key, 0].

# M39 (W2-D67, R10 F6): sourceQuiz's redaction stage keeps every candidate (the shipped path's screen gone).
mut "$D" "    redaction: async (c) => { const r = screenRedaction(c, rs.idx, memo); return r === null ? keep(c) : drop(r); }," "    redaction: async (c) => keep(c),"
T 'W2-D67 on the shipped path'
# Expected RED (predicted, non-darwin): 1 failed; counts.drops.redaction is {} where { 'redact-fact': 1 } was expected
# (the key-shaped candidate passes on to a later stage).

cmp "$D" "$SCRATCH/driver.t6.orig" && echo restored && rm -f "$SCRATCH/driver.t6.orig"
git diff --stat -- deploy/history-replay.mjs   # this task's section, the reader's field and the import names only
```

Each `T` restores the driver whatever the run showed. Then run Step 5's commands again: green.

- [ ] **Step 7: Run the neighbours that read the same files or the same names.** In the foreground, with a timeout of at least 600000 ms. If a file goes red, re-run it alone before calling it a break (CLAUDE.md's load flakes):

```bash
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history'
cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts
```

Expected: green.
- `single-definition -t 'ccrc history'` is green. O13's `ALL_MJS` and O14's `DECL_CORPUS` scans read `deploy/*.mjs`. This section declares no `VOCABS` name, spells no switch and no recall-off path, and imports `FACT_KINDS` rather than declaring it, so the gate stays its one declaring file under `deploy/`.
- `measure-history.test.ts` (the gate's suite, unchanged) is green. It pins the gate's purity and the sha literals of `WRITER_PROMPT` and `ANSWER_PROTOCOL`, which this task reads and never edits.
- `history-replay.test.ts` is green as a whole.

- [ ] **Step 8: Commit.**

```bash
git add deploy/history-replay.mjs server/test/history-replay.test.ts
CO_AUTHORED_BY='<the Co-Authored-By line the attribution reminder gives>'
git commit -m "feat(history-replay): the question writer through the writer-mode spawn, the frozen lists, the fidelity pilot's payloads and arithmetic, and sourceQuiz (W2-5a Task 6; W2-D72, W2-D73, W2-D71, W2-D64, W2-D54, W2-D55, W2-D56)" -m "$CO_AUTHORED_BY"
```

---


### Task 7: The record subcommands: pilot-source, quiz-source, freeze, power, open and verify, each re-checking the code it runs under

This task turns Tasks 1 to 6's pieces into the operator's acts before window start (W2 decisions §4, the protocol, and §5, acts 9 to 19). It adds six subcommands to `HANDLERS`, nine forms in all:
- **`pilot-source`** (§5 act 9, as amended in place: one pilot node, run once, R9; W2-D71, W2-D73, W2-D76, W2-D56). It spawns before part 1, under its own required `--budget`. It is preflighted against the one step 0a output it is given (`loadStep0a`, then Task 6's `openWriter`, which runs W2-4's `preflight` before every writer batch). It draws its own crypto seed and calls Task 6's `sourceQuiz` in pilot mode. It writes `<out>/pilot/frozen.json` (kind `ccrc-history-w2-pilot`) and `<out>/pilot-source.json`, the values part 1's `pilot` section copies, and prints that file's sha256 on stderr. Act 9's command line in the decisions document, `pilot-source --step0a <file> --step0a-sha256 <hex> --budget <N>`, is abbreviated: the subcommand also requires `--out <dir>`, `--account <id>` and `--writer-model <id>` (`SUBCOMMAND_FLAGS`; a missing one refuses `args-invalid`), and takes `--sha-min-prefix`, `--writer-input`, `--n-fidelity` and `--n-usage` as optional overrides of the open record's defaults. The full argv is `pilot-source --out <dir> --account <id> --budget <N> --writer-model <id> --step0a <file> --step0a-sha256 <hex>`, and the PR body's coordinator steps carry it.
- **`open --template`** (W2-D25). Prints a skeleton of both parts derived from the gate's `OPEN_RECORD_V1`. It writes no file and prints no sha.
- **`open --draft`** (§4 step 1; W2-D25, W2-D18, W2-D24).
  - It binds each node's step 0a output to its node with `label` and `store_id` (the coordinator's ruling recorded in W2-4's plan), and refuses a step 0a whose `flags_accepted` does not name exactly the contract's flags. That is the **`flags_accepted` parity pin** of the 2026-10-20 amendment, beside its test-side half.
  - It copies the pilot-source output into `pilot`, applies an operator overrides file to default fields only, draws the seed (or keeps the predecessor's on a supersede), measures `gate_code` (`codeShas()` and the release stamp), validates, and prints part 1.
- **`verify --registry`** (§5 act 11; W2-D20, W2-D84, D-5773's verify half). Read-only, on one node. For each family the census makes active, it reads `$REG/<id>.generation` through sweep.mjs's `readRegPresence` and reports `ok`, `registry-mismatch`, `registry-absent` or `unreadable`, never folding one into another.
- **`power`** (§5 act 12; W2-D21, as amended on 2026-10-20 after W2-3's review 664, F3 and F8). It reads every node's census and verify outputs through **the census assembler, which checks nodes only**. It reads `q18_settings` from the record and calls `q18Power` once per power level with rho = `rho_headline` and once with rho = 0, deriving `covered_days` from `lookback_days`. It prints the power output on stdout and its sha256 on stderr.
- **`quiz-source`** (§5 act 16; W2-D19, W2-D71, W2-D73, W2-D77). It runs after part 1 under part 1's `pilot_budget` and `limits`, preflighted against part 1. It derives the assignment from the census and verify inputs, then calls `sourceQuiz` in quiz mode over this node's own admitted families, with the control-held ids and the pilot families excluded; the census's active list feeds the assignment only and is never handed to `sourceQuiz` (W2-D71, W2-D73, W2-D40; R10). It writes `<out>/quiz/sourced.json`, which records `assignment_sha256`. Both sourcing subcommands open the store once (Task 1's `openReplayStore`) and pass it down (R3), and print one warning line when any writer run failed (R6).
- **`freeze`** (W2-D73). It requires exactly one sourced list per node the record names (a missing one refuses `input-invalid` `sourced node-missing <label>`, as `power`'s census assembler refuses `census node-missing`), and merges them in global rank order (each family's `quizFamilyOrderKey` by code unit, then the candidate rank: W2-D71 as amended 2026-10-22, R10), cuts at `quiz.target`, and writes `<out>/quiz/frozen.json` as exactly `canonicalJson(...)` of W2-D73's object. Beside it goes `<out>/quiz/frozen.meta.json`, which carries quiz-source's `assignment_sha256`. It prints the frozen list's sha256 on stderr.
- **`open --finalize`** (§4 step 5; W2-D73, W2-D25). From the same census and verify inputs it re-derives the assignment, and refuses `assignment-mismatch` against the one quiz-source recorded. It reads the power output, the frozen list with its meta, and a pilot-result file. It builds part 2, validates it against its draft and frozen list, and prints it.
- **`verify --section ab`** (§5 act 19; W2-D84). Read-only, on one node, after the control files are written. Every control family's file holds its generation, and no treatment family's file names its own. Each file's content is read as W2-D84 says, through `historyPaths`, `recallOffPath` and `readBounded`; the driver imports no `recallOffPresence` (R6), and the read writes nothing (R10). Unreadable files are reported, never folded. `status`'s `recall_off.seen_ms` is later than the newest write.

**W2-D24's re-check.** Every subcommand that takes `--record` calls `codeShas()` through one helper, `recheckCode`. It runs right after the record validates, before any other input is read and before any spawn. The callers are `quiz-source`, `freeze`, `power`, `open --finalize`, `verify --registry` and `verify --section ab`, W2-5a's six. `pilot-source` and `open --draft` run before part 1: `pilot-source` RECORDS `codeShas()` and the stamp after preflighting them against step 0a, and `open --draft` MEASURES `gate_code`.

**Two parity pins.** W2-D25's 2026-10-20 amendment and section 7 assign them to W2-5a, the first PR that loads both modules. One owner each (R3):
- `CODE_SHA_FILES` is `GATE_CODE_FILES`: Task 1's pin, titled `CODE_SHA_FILES parity`;
- `step0a`'s recorded `flags_accepted` keys equal the flag set of every spawn mode's argv (`contractFlags`), under both settings modes: this task's pin, titled `… flags_accepted parity`.

**Files:**
- Modify: `deploy/history-replay.mjs`.
  - (a) `@typedef ... FlagKind` (about :87 at cd622b2f6) gains `'list'`, and `@typedef ... Flags` (about :88) gains `string[]`.
  - (b) `FLAG_SPECS` (about :93) gains this task's flags, after `'settings-mode': 'string',`.
  - (c) `parseArgs` (about :117) collects a `list` flag's values in order instead of refusing the repeat.
  - (d) `step0aCommand` (about :2219) refuses a flag it never reads, as `probeCommand` already does. Before this task every driver flag was one `step0a` reads or ignores harmlessly; this task adds forty-two flags (forty-nine in all) `step0a` never reads.
  - (e) The import block: names added to Task 1's EXISTING statements of `../ccd/history/lib.mjs`, `../ccd/history/store.mjs` (`readBounded`), `../ccd/history/sweep.mjs` (`readRegPresence`) and `./history-gate.mjs`. No statement is added, and the header sentence is Task 1's (R3).
  - (f) One new section, `// ── W2-5a Task 7: the record subcommands`, directly above the comment line `// The entry guard stays the LAST block of this file`, after Task 6's section. It ends with this task's six `HANDLERS.set` lines.
  - (g) The last line of `recallOffPresence`'s JSDoc (W2-4's, about :2069), which says the lstat is the driver's one recall-off line, is reworded (Step 7): `controlFileOf` now reads a control file's content, so the lstat is the presence check's one line. Comment only; no code changes.
- Modify: `server/test/history-replay.test.ts`.
  - Re-pin W2-4 Task 1's FLAG_SPECS case, the `it` titled `FLAG_SPECS declares exactly the seven flags W2-4 uses, frozen` (about :178).
  - Re-pin W2-4 Task 9's registration-order line, `expect([...t9Driver.HANDLERS.keys()]).toEqual(['step0a', 'probe']);` (about :4765).
  - Re-pin W2-4 Task 7's structural case `the driver names recall-off on exactly one code line, an lstatSync of recallOffPath, and never spells the directory` (about :3838): the driver now names `recallOffPath(` on two code lines, W2-4's `lstatSync` presence check and `verify --section ab`'s `readBounded` content read (W2-D84, R6).
  - Widen `withHandler`'s `h` parameter type (W2-4 Task 1's describe, about :270) to carry `string[]`, as `Flags` now does.
  - In Task 1's `EXACT_NAMES`, the store.mjs entry becomes `'{ StoreError, openReader, readBounded, userVersion }'` and the sweep.mjs entry `'{ ftsTextOfBlob, readRegPresence }'`.
  - Append one describe, with its own import block (prefix `r7`), at the end of the file.
- Not edited: `deploy/history-gate.mjs`, `deploy/measure-history.py`, `ccd/**`, `shared/**`, the spec, README.md, `.github/**`, and every other test file. `single-definition.test.ts` and `measure-history.test.ts` are re-run, never edited.

**Interfaces:**
- Consumes (base, `deploy/history-gate.mjs`, W2-3; never edited):
  - `GATE_CODE_FILES`, `OPEN_RECORD_V1` (`{version, draft, final}` field specs: `{type, nullable, status, value?, fields?, items?, values?}`), `LABELLER`, `FACT_KINDS`, `SHA_MIN_PREFIXES`, `WRITER_INPUTS`, `RUBRIC_SHA256`, `WRITER_PROMPT_SHA256`, `ANSWER_PROTOCOL_SHA256` and `ACTIVE_LOOKBACK_MS` (tests only);
  - `familyKey(storeId, ccrcId, generation): string`;
  - `activeFamilies(storeId, census, {lookbackMs}): {active: FamilyRef[], excluded}`, which throws `TypeError` on a malformed census;
  - `assignArms(seedHex, FamilyRef[]): Array<FamilyRef & {arm}>`, sorted by canonicalJson;
  - `assignmentSha256(list): string`;
  - `buildWindows(familyReport): Window[]`, which needs a boolean `found`;
  - `windowTotals(windows): {windows, with_call, calls, turns, unmeasured}`;
  - `expectedWindows(families, plannedDays): Array<{key, n}>`;
  - `q18Power({families, plannedDays, seedHex, rho, power, sims, gridStep, B, x?}): {figure: number|null, procedure, points: Array<{p, share}>}`, whose `rho`, `power`, `sims` and `gridStep` are required;
  - `checkGateCode(gateCode, shas): {ok: true} | {ok: false, word: 'code-unmeasured', unmeasured} | {ok: false, word: 'code-changed', mismatched}`;
  - `recordSha256(record): string`, the sha256 of `canonicalJson(record) + '\n'`;
  - `validateOpenRecord(record, {draft, predecessor, frozen}): {ok: true} | {ok: false, errors: Array<{path, word}>}`;
  - `armOf` (tests only).
- Consumes (base, `ccd/history/lib.mjs`, W2-1 included): `EXIT`, `UUID_RE`, `idOk`, `canonicalJson`, `sha256Hex`, `historyPaths(home)` (`.dbFile`, `.reg`, `.recallOffDir`), `recallOffPath(home, id)`, `CONTROL_FILE_MAX`, `RECALL_OFF_META`, `recallOffStatusOf(meta: Map<string, string>): {seen_ms, files, unreadable}`.
- Consumes (base, `ccd/history/store.mjs`): `readBounded(path, max, follow): {state: 'value', value} | {state: 'absent'} | {state: 'over-cap'} | {state: 'unreadable'}`, the one bounded reader W2-D84 names. `verify --section ab` reads a control file with it at `CONTROL_FILE_MAX`, never following a link, and folds over-cap into unreadable, as sweep.mjs's reader folds it.
- Consumes (base, `ccd/history/sweep.mjs`, W2-1 Task 3): `readRegPresence(path): {state: 'value', value: string (trimmed)} | {state: 'absent'} | {state: 'unreadable'}`. Its `recallOffPresence` is never imported (R6).
- Consumes (W2-4, base):
  - `DRIVER_REASONS` words `args-invalid`, `input-invalid`, `input-sha-mismatch`, `record-invalid`, `record-sha-mismatch`, `quiz-sha-mismatch`, `assignment-mismatch`, `code-changed`, `code-unmeasured`, `tree-unmeasured`, and through `preflight` `claude-version-moved`, `version-unmeasured`, `tree-moved`, `wrapper-moved`;
  - `refuse`, `FLAG_SPECS`, `parseArgs`, `HANDLERS`, `prepareOut`, `insideGitTree`, `claimOut`, `readRoster`, `admitAccount`, `batchGate`, `LIMITS_DEFAULTS`, `spentSoFar`, `SPAWN_MODES`, `SETTINGS_MODES`, `spawnArgv`, `codeShas`, `CODE_SHA_FILES`, `TREE_ROOT`, `readReleaseStamp`, `wrapperSha`, `measureClaudeVersion`, `preflight`, `loadStep0a`, `STEP0A_KIND`;
  - module-private: `readPlain`, `badWord`, `writePlain`, `ensurePlainDir`, `shaOfPlain`, `refuseUnusableInputs`, `refuseColonInRealOut`, `refuseIfStopping`, `plainObject`, `SHA256_RE`, `OUT_JSON_CAP`, `OUT_STREAM_CAP`, `errCode`, `STEP0A_REQUIRED`.
- Consumes (Tasks 1 to 6 of this plan). Step 1 checks each name; a missing one stops the task.
  - **Task 6:**
    - `sourceQuiz(input): Promise<{entries: Array<FrozenEntry & {rank: [string | number, number]}>, fidelity: Array<FamilyRef & {boundary_uuid: string}>, counts: object, asof_same_ms_hits: Record<qid, object>}>`. `FrozenEntry` is W2-D73's eleven fields (`FROZEN_ENTRY_KEYS`). A quiz entry's `rank` is `[the family's quizFamilyOrderKey, candidate rank in the family's own seeded order]` (W2-D71, as amended by W2-3's review 664 F1 and in place on 2026-10-22; R4, R10). It is global across nodes, so two nodes' lists merge by rank alone: the key by code unit, then the candidate rank. A pilot entry's rank is its node's own and is stripped.
    - `input` is `{mode: 'quiz'|'pilot', rs, home, out, writer, seedHex, exclude: {pilotFamilies: FamilyRef[], assignment: Array<FamilyRef & {arm}>}, plan, configDirs}`: `rs` the run's one open store, `writer` Task 6's `openWriter` handle (R6). It carries no family list: both modes walk this node's own admitted families, quiz mode less the exclusions (R10).
    - The module-private `refuseWriterModel(model)`, which `pilotSourceCommand` calls before `prepareOut` (R10).
    - `openWriter({home, accountId, model, settingsMode, writerInput, claim, budget, limits, expected, lang, idx})`: the writer handle. It refuses a non-Opus model, admits the account, builds the gate (W2-D55) and runs W2-D56's preflight against `expected` before the first spawn and before every writer batch. In pilot mode `fidelity` holds up to `plan.n_fidelity` boundaries; in quiz mode it is `[]`.
    - `qidOf(entry)`, `frozenListText(section, {writer_model, labeller}, entries)`, `writeFrozenList(out, section, text)`, `loadFrozenList(p, sha256, section)`, `FROZEN_LIST_KINDS`, `FROZEN_LIST_FILE` and `FROZEN_ENTRY_KEYS`: the one frozen-list writer and reader (R3). Test side: `w6SourceBox(prefix)` and `w6Reply(reply)`.
  - **Task 1:** `openReplayStore(home)` (the store and its id, one open per run), the import statements this task extends, and the header. Also W2-4 Task 8's `t8Tree`, repaired to copy the real `deploy/history-gate.mjs`.
  - **Task 2:** `rosterConfigDirs(roster, home)`. **Task 4:** the open record's `quiz.baseline_files` default, which `pilot-source` records as `used.baseline_files` (Task 4's `BASELINE_FILES_ID is the open record default` case holds it equal to `BASELINE_FILES_ID`), and the `--out` sentinel walk this task re-runs end to end (R7).
  - **Task 5:** `drawSeedHex()` (the default `deps.seed` of `pilot-source` and `open --draft`), `quizFloor(nQuestions, nFamilies, haltFloor)` (`quizMetaReport`'s `below_floor` is its `halt`), and the module-private `familyKeyOf` and `cmpUnit` (`byFamilyKey`, and `mergeSourced`'s order-key compare, R10). One helper per job (W2-D12, R3): this task spells none of them again.
- Produces (`deploy/history-replay.mjs`, all exported unless marked private):
  - Kinds and paths: `PILOT_SOURCE_KIND = 'ccrc-history-w2-pilot-source'`, `PILOT_SOURCE_FILE = 'pilot-source.json'`, `PILOT_FROZEN_FILE` (`pilot/` + Task 6's `FROZEN_LIST_FILE`), `SOURCED_KIND = 'ccrc-history-w2-quiz-sourced'`, `SOURCED_FILE = 'quiz/sourced.json'`, `FROZEN_FILE` (`quiz/` + `FROZEN_LIST_FILE`), `QUIZ_META_KIND = 'ccrc-history-w2-quiz-meta'`, `QUIZ_META_FILE = 'quiz/frozen.meta.json'`, `VERIFY_REGISTRY_KIND = 'ccrc-history-w2-verify-registry'`, `VERIFY_AB_KIND = 'ccrc-history-w2-verify-ab'`, `POWER_KIND = 'ccrc-history-w2-power'`, `PILOT_RESULT_KIND = 'ccrc-history-w2-pilot-result'` (the shape `open --finalize` reads and W2-5b writes: `{kind, v: 1, fidelity, usage_extrapolation, step0b_sha256, settings_mode, absent_rate}`, W2-5b's producer contract, R8), `TEMPLATE_KIND = 'ccrc-history-w2-open-template'`. The frozen lists' kinds are Task 6's `FROZEN_LIST_KINDS`.
  - Word sets: `REGISTRY_STATES = ['ok','registry-mismatch','registry-absent','unreadable']`, `AB_STATES = ['ok','control-absent','control-mismatch','treatment-named','unreadable']`, `Q18_DECISIONS = ['keep','lengthen','add-nodes']`, `Q18_FIGURES` (which call each part 2 figure reads), `ACTIVE_RULE_TEXT`.
  - Pure functions:
    - `contractFlags(settingsMode): string[]`;
    - `familiesOf(items): FamilyRef[]`;
    - `mergeSourced(lists, target): entries`;
    - `assembleCensus(record, censusIn, verifyIn): {nodes, active, drops, kept}`;
    - `deriveAssignment(seedHex, assembled): {list, sha256}`;
    - `coveredDays(census, lookbackDays): number | null`;
    - `rhoHat(clusters): number | null`;
    - `powerReport(record, recordSha256, assembled): PowerOutput`;
    - `registryStateOf(read, generation): REGISTRY_STATES member`;
    - `verifyRegistryReport({recordSha256, storeId, censusSha256, lookbackMs, families})`;
    - `abStateOf(arm, generation, read): AB_STATES member`;
    - `verifyAbReport({recordSha256, storeId, families, newest, seen})`;
    - `sourcedReport({recordSha256, storeId, assignmentSha256, inputs, sourced, spend})`;
    - `quizMetaReport({recordSha256, frozenSha256, assignmentSha256, entries, floor, minFamilies, sourced})`, whose `short_of_min_families` is `n_families < minFamilies` (the record's `quiz.min_families`; R11);
    - `openTemplate()`;
    - `buildDraft({nodes, step0a, pilot, account, models: {arm, writer, judge}, gateCode, seedHex, nowMs, overrides?, supersedes?})`;
    - `buildFinal({draft, draftSha256, priorSha256?, assembled, assignment, power, powerSha256, frozen, pilotResult, spendBudget, window: {start, end}, decision, nowMs})`.
  - Measuring and acting:
    - `loadInput(label, path, sha256, words?, cap?): {path, sha256, value}`;
    - `recheckCode(record, root = TREE_ROOT): void`, which throws `code-unmeasured` or `code-changed`;
    - the commands `pilotSourceCommand(flags, driverEnv, deps?)`, `quizSourceCommand(flags, driverEnv, deps?)`, `freezeCommand`, `powerCommand`, `openCommand(flags, driverEnv, deps?)` and `verifyCommand`, registered as `pilot-source`, `quiz-source`, `freeze`, `power`, `open` and `verify`.
    - `deps` carries what a test injects: `{sourceQuiz, seed}` for the two sourcing commands, and `{seed, now}` for open. No CLI flag ever takes a seed (W2-D19).
  - Module-private: `SUBCOMMAND_FLAGS`, `DRAFT_INPUT`, `PRED_INPUT`, `NODE_INPUTS`, `checkFlags`, `pairedInputs`, `loadInputs`, `loadRecordInput`, `loadFrozen`, `subcommandHome`, `nodeStoreId` (one `openReplayStore`, closed at once), `requireNamedNode`, `printWithSha`, `schemaValues`, `applyOverrides`, `readOverrides`, `skeletonOf`, `skeletonField`, `copyJson`, `byFamilyKey`, `frozenEntryOf`, `pilotCaps`, `warnFailedRuns`, `controlFileOf`, `censusError`, `verifyError`, `sourcedError`, `entryError`, `quizMetaError`, `powerError`, `pilotSourceError`, `pilotResultError`, `newestPresenceWrite`, `presenceSeenMs`, `openDraft`, `openFinalize`, `verifyRegistry`, `verifyAb`, and the constants `DRAFT_SPEC`, `PILOT_DERIVED`, `INPUT_WORDS`, `RECORD_WORDS` and `Q18_DAY_MS`.

**Spec:** §10.2 "Pre-registration" (rev 3.6 `:2735` as amended; erratum E23 is W2-5b's to amend, not this task's), "The gate" and Q18's procedure, and §10.6. W2 decisions document:
- W2-D84 (this task's half: `verify --registry` and `verify --section ab`);
- W2-D24 (W2-5a's consumers) and W2-D6 (the pre-window remedy);
- W2-D73, W2-D71, W2-D76, W2-D77, W2-D19, W2-D20 (D-5773's `verify --registry` half);
- W2-D21, with its 2026-10-20 amendment;
- W2-D25, with its amendments, D-5791 included;
- W2-D18 (the seed), W2-D55 and W2-D56 (budget and preflight), W2-D57 (the printed sha, D-5983), W2-D29 and W2-D59;
- §4's part 1 and part 2 tables, §5's acts 7 to 19, and §7 (the `flags_accepted` and `CODE_SHA_FILES` parity residuals).

It ships one departure this plan defines, **D-6280** (`history-replay-spend-budget-operator-given`, Choices). It cites D-5773 (W2-D20's departure: this task builds its `verify --registry` half), D-5791 (the validator's q18 and binding refusals this task relies on), D-5774 (deploy-local words), D-5983, D-5985 and D-5986 (W2-4's printed sha, claim and type-checked reads), and D-5812, D-5813 and D-5815 (W2-4's `loadStep0a` shape-only rule, unusable inputs and required flags first).

**Re-anchored against cd622b2f6 (drift from the decisions document, written at bd363a76b):**

| The document says | The code at cd622b2f6 says | What this task does |
|---|---|---|
| W2-D21 (amended): `Q18_FIGURE_POWER` is "a module constant" holding 0.5 and 0.8 | `deploy/history-gate.mjs` declares it `const`, not exported, and this PR may not edit the gate | `Q18_FIGURES` spells the two levels once more in the driver, held equal by a behavioural parity case: the validator refuses a power list without either level, and accepts `[0.5, 0.8]` |
| W2-D20: drops are `registry-mismatch`, `registry-absent`, `unreadable` | the gate's `REGISTRY_DROP_REASONS` is module-private | `REGISTRY_STATES` adds `ok` to the three, held equal by a parity case: a final dropping a family for each non-`ok` state validates, and a drop reason `ok` is refused |
| W2-D21: Q18 reads "the census rows of the W2-D20 active list" | `buildWindows` throws on a row without a boolean `found`, and a census row has none (W2-3's guard against reading a census row as a family report) | `powerReport` builds each family report from its census row with `found: true`; the row exists, so the family was found |
| W2-D25: "Consumers take `--record PATH --record-sha256 HEX`" | `validateOpenRecord` needs `ctx.predecessor` for a superseding draft, and `ctx.draft` and `ctx.frozen` for any final, or it answers `field-missing` | `--supersedes` names the record a record supersedes, `--part1` a final's draft, and `--frozen` a final's frozen list; `open --finalize`'s optional prior final is `--prior-final` |
| W2-4's grammar: "each flag at most once" | `parseArgs` refuses a repeat | a `list` flag kind collects repeats in order; `--step0a`, `--census`, `--verify`, `--sourced`, `--node-label`, `--node-store-id` and their `-sha256` partners are lists, paired by position |
| W2-D29: "The driver does not read content" of a presence file; W2-D84: `verify --section ab` reads each control file's content "through historyPaths, recallOffPath and readBounded" | W2-4's pin: exactly one `recallOffPath(` code line in the driver (an `lstatSync`), and it never spells the directory | W2-D84 governs, and the driver imports no `recallOffPresence` (R6): `controlFileOf` reads content with `readBounded(recallOffPath(home, id), CONTROL_FILE_MAX, false)`, a second `recallOffPath(` code line, so W2-4's pin is re-pinned to two lines, the lstat and this read; single-definition's O13 counts the driver's `lstatSync(recallOffPath(` lines only, still one, and a `readBounded` line is no write. The newest write is the presence directory's mtime, one `lstatSync(historyPaths(home).recallOffDir)` |
| W2-D84: "`seen_ms` is later than the newest write" | nothing measures "the newest write" | the writer (W2-D28) writes a temp file and renames it inside the directory, so the directory's mtime moves on every write and every clear; `seen_ms > mtimeMs`, strictly |
| W2-D73: quiz-source records `assignment_sha256` "beside the frozen list" | the frozen list's bytes are fixed by W2-D73 and have no such field | `freeze` writes `quiz/frozen.meta.json` beside `quiz/frozen.json`, carrying quiz-source's `assignment_sha256`, the counts and the floor verdict |
| W2-D24: `--allow-code-change` stamps every output | W2-D6: before window start the remedy is a re-pilot and a superseding draft | no W2-5a subcommand declares the flag; each refuses `code-changed` |
| §4 part 2: `pilot_result` and `spend_budget` come from the pilot | the pilot's spawns and extrapolation are W2-5b's and do not exist | `open --finalize` reads a `PILOT_RESULT_KIND` file and takes `--spend-budget` (D-6280) |
| §5 act 9: pilot-source "on the node or nodes holding the pilot families" | part 1's `pilot` is one object with one seed and one frozen sha | One pilot node, and `pilot-source` runs once (R9; act 9 amended in place in the decisions document): `open --draft` takes exactly one pilot-source output |
| W2-4's two exact pins: FLAG_SPECS is "exactly the seven flags", HANDLERS is `['step0a', 'probe']` | both are W2-4's | both are re-pinned here, in the same commit as the flags and handlers |
| §2's "the census assembler that checks nodes only" | `assembleReports` (the window assembler) checks windows, row caps and script shas | `assembleCensus` checks store ids against the record's nodes (unlisted, duplicate, a node missing), each verify output's binding to its census, its look-back and its family list, and nothing else; no row cap, script sha or window |

**Choices this task makes:**
- **No `--allow-code-change` in W2-5a (W2-D6, W2-D24).** Every W2-5a consumer runs before window start, where W2-D6 rules that a code change is answered by a re-pilot and a superseding draft. The record and the frozen list are closed shapes with no place for a stamp, and the other outputs only feed those two. So the flag is not declared, and passing it is `args-invalid unknown flag`.
- **Every input is loaded one way (`loadInput`).** As `loadStep0a` does, it refuses a path inside a git tree and checks the sha256 of the bytes BEFORE they are parsed (W2-D25, W2-D59). A record answers `record-sha-mismatch` or `record-invalid`, a frozen list `quiz-sha-mismatch`, and every other input `input-sha-mismatch` or `input-invalid`. A record's first validator errors are joined into the detail as `<path> <word>; …`.
- **Stdout and stderr.**
  - `open --draft`, `open --finalize`, `power` and `verify` write no file: they print canonical JSON and one newline on stdout, and `sha256 <hex>` of exactly those bytes on stderr. For a record that equals `recordSha256` (W2-D25).
  - `pilot-source`, `quiz-source` and `freeze` write under `--out` (0600 through `writePlain`, after `prepareOut` and `claimOut`) and print only `sha256 <hex>` on stderr, stdout empty (W2-D57, D-5983).
  - `open --template` prints its skeleton and no sha: it is not a record.
- **The overrides file.** `open --draft --overrides PATH` takes one JSON object of part 1 values the operator changes when signing ("default" in §4's table). The rules:
  - a key at a `default` field replaces its value; arrays such as `q18_settings.power` and `freezes.surface` are replaced whole;
  - a key at a `fixed`, `measured`, `derived` or `operator` field is `args-invalid`, and so is an unknown key;
  - `labeller.sha_min_prefix`, `quiz.writer_input`, `quiz.baseline_files`, `pilot.n_fidelity` and `pilot.n_usage` come from the pilot-source output, because the validator ties them to what the pilot used (W2-D71, W2-D25), and overriding one is `args-invalid`;
  - `rubric_sha256` always follows `rubric_id`.
- **`active_rule.text`** has no schema value. `ACTIVE_RULE_TEXT` states W2-D20's rule in words and is the default; an override may replace it.
- **The pilot seed and the record seed are drawn by `randomBytes(32)`** (W2-D18, W2-D71), through `deps.seed`, whose default is Task 5's `drawSeedHex`. A test injects it, and no flag takes one (W2-D19). A superseding draft keeps its predecessor's seed (the validator's `seed-changed`).
- **Settings and budget come from where they were measured.** `pilot-source`'s writer runs under step 0a's `settings_mode` and the driver's `LIMITS_DEFAULTS` with the required `--budget` (W2-D55, before part 1). `quiz-source`'s runs under part 1's `settings_mode`, `limits`, `pilot_budget`, `writer_model` and `account` (W2-D55, from part 1 to part 2); it takes no `--account` or `--budget`.
- **Preflight (W2-D56), through Task 6's `openWriter`.** The sourcing subcommands open the writer before they source, and the handle preflights before its first spawn and before every writer batch:
  - `pilot-source` hands it step 0a's output as `expected`.
  - `quiz-source` hands it this node's part 1 step 0a entry for `claude_code_version` and `wrapper_sha256`, and `gate_code` for the stamp and the four shas.
  - Either refuses with the preflight's own word, before any writer spawn. The `--version` spawn is gated, logged by the stub as a run without `-p`, and spends nothing. `pilot-source` records step 0a's code shas and stamp, which its preflight held equal to what it measured.
- **The node.** `quiz-source`, `pilot-source` and both `verify` forms read the local store id with the run's one store open (Task 1's `openReplayStore`, W2-D51, R3). A store that cannot be opened refuses `store-unreadable` with the store's own word. The `--record` consumers among them refuse `input-invalid` unless that id names one of the record's nodes (W2-D84).
- **A failed writer run is counted, and warned once (R6).** `sourceQuiz` counts runs that exited non-zero, ended by a signal or showed no result event; when any did, the sourcing subcommand prints one `ccrc history-replay: warning: …` line on stderr before its sha line.
- **Quiz-source hands `sourceQuiz` no family list (R10, C1).** W2-D71's population is every family on the node with an admitted boundary, less the pilot families and every control-held `(store_id, ccrc_id)` (W2-D77). The census's active, registry-ok list (`assembled.kept`) feeds the assignment only (W2-D73): a quiz family need not be active or registry-resolvable, because the headless arm resolves its family from its epochs, never the registry (W2-D40). So `quiz-source` passes the exclusions, never `assembled.kept`, and `sourceQuiz` walks the store's own admitted families.
- **Freeze merges, it does not re-sample.** It requires exactly one sourced list per named node: W2-D71's population is the families on the named nodes, and each node's walk stops at the target on its own, so a merge missing a node would look full while it froze a subset, and the list would depend on which files the operator passed. A missing node refuses `sourced node-missing <label>`, a second list for one store `sourced store-id-duplicate`. Each node's quiz-source sources its own families in the GLOBAL order, each family's `quizFamilyOrderKey` (Task 6's `rank`, `[order key, candidate rank]`; W2-D71 as amended 2026-10-22), and stops at the target. The global lazy walk stops no later than any node's local walk, so the merged list sorted by rank (the key by code unit, then the candidate rank) and cut at `quiz.target` is the walk one node holding every store would make (Task 5's keyed-order case pins the merge). Two entries with one rank are `input-invalid`, and a quiz entry whose rank is not `[64 lowercase hex, a non-negative integer]` is `input-invalid` `entry rank`. `freeze` takes each node's keys as that node's `sourceQuiz` computed them, under the same `gate_code` it re-checks; it does not recompute them. `freeze` then sorts by qid (W2-D73).
- **`quiz.min_families` is reported, never a refusal (R11).** The signed default 20 is W2-D71's "at least 20 families". `freeze`'s meta carries `short_of_min_families`, true when the merged list's family count is below the record's `quiz.min_families`; nothing refuses on it, and the halt floor (60 questions, 12 families) stays the only family-count stop. At the signed defaults, target 100 with `caps.family` 5 already implies at least 20 families, so on a list that meets the target the flag matters only when a draft raises `caps.family`; a list short of the target can be short of families too, and the flag reports that beside `below_floor`. The freeze case `the meta reports short_of_min_families …` pins it (CONTROL: at `min_families` it is false), and mutant M44 drops it.
- **Refusals before `--out` (R10).** A refusal that needs no store and no spawn answers before `prepareOut` makes `--out`, so a refused run leaves no `--out` to clean. In `pilot-source` that is the argv checks and the writer model: `refuseWriterModel` (Task 6's, the one spelling of the Opus test) runs before `prepareOut`, and `openWriter` asks it again for every other caller. `quiz-source`'s writer model is the validated record's, which the validator already holds to an exact Opus id (W2-D25), so it refuses `record-invalid` before `--out` with no second call. `freeze` makes `--out` after every input is read and checked.
- **`verify --section ab` reads content (R10).** W2-D84 requires it: "each control file's content equals its generation … All reads go through historyPaths, recallOffPath and readBounded". W2-D29's "the driver does not read content" is about the presence check (W2-D78(ii)), which stays W2-4's one `lstatSync(recallOffPath(…))` line. `controlFileOf` is `readBounded(recallOffPath(home, id), CONTROL_FILE_MAX, false)` and writes nothing, so single-definition's O13 one-writer pin holds unchanged, and W2-4's recall-off line pin is re-pinned to the two code lines (Step 2).
- **The floor (W2-D71).** `freeze` writes the list whatever its size and records `below_floor` in its meta. `open --finalize` refuses a below-floor meta (`input-invalid`). A ruling to proceed lowers `quiz.halt_floor`, a signed default, in a superseding draft, and the quiz is sourced again under it. That re-sourcing is a stated cost.
- **What `power` prints (W2-D21).**
  - For each power level, a figure at rho = `rho_headline` and one at rho = 0, with each call's `points`. Then `headline`, `at_power_80` and `at_rho_0`, read through `Q18_FIGURES`.
  - `rho_hat`: the one-way ANOVA estimate of the intra-cluster correlation of "window has a call" over families with at least one window, reported unclipped, or null when fewer than two families have windows or the within-family degrees of freedom are zero. It is reported beside the figures, and Q18 is not run at it: the amendment names rho_headline and 0 only (R6).
  - `n_f` as `{per_family, per_node}` (§4's q18 lists per-node and per-family n_f; a node's is the sum over its kept families), `coverage` per node (`covered_days` and the census's `ticks`) and `pre_window_uptake` (per node and in total, with `card_consumed:main` labelled all-time).
  - The output holds no clock reading, so the same inputs print the same bytes.
- **`covered_days`.** It is `min(lookback_days, (as_of_ms − max(since_ms, ticks.first_ts_ms)) / 86,400,000)`. A census whose `as_of_ms − since_ms` is not `lookback_days` days is refused `since-mismatch`: the windows were counted over another span. A census with no tick in the look-back is refused `no-tick-coverage` rather than divided by 0.
- **`verify --registry` reports; it does not decide.** Its families are exactly the census's active list. `quiz-source`, `power` and `open --finalize` remove every non-`ok` family before the assignment (W2-D20) and list it in part 2's `registry_drops`. A verify output must name its census's sha and the record's look-back, or it is `input-invalid`.
- **`verify --section ab` exits 0 whatever it finds**, as W2-4's probe does: a finding is data, and `ok` is a field. Only a refusal is non-zero. A treatment family's file naming ANOTHER generation is `ok`, because W2-D84 refuses only a file naming the family's own.
- D-6280 (`history-replay-spend-budget-operator-given`): §4 lists part 2's `spend_budget` as derived, "the extrapolation for the frozen list × 1.25", approved by the operator. The extrapolation is W2-5b's usage pilot and has no shape yet. So `open --finalize` takes the approved figure as `--spend-budget N` and copies the pilot-result file's five fields as they stand; §5's act 17 already has the operator approve the spend budget. W2-5b, which defines the pilot-result's producer, tightens `open --finalize` to derive it and refuse a mismatch (carried, R8).

- [ ] **Step 1: Confirm the earlier tasks' names before using them.** From the repository root:

```bash
node --no-warnings --input-type=module -e "const d = await import('./deploy/history-replay.mjs'); console.log(['sourceQuiz','qidOf','openWriter','frozenListText','writeFrozenList','loadFrozenList','openReplayStore','drawSeedHex','quizFloor','rosterConfigDirs','loadStep0a','codeShas','readReleaseStamp','prepareOut','claimOut','spawnArgv','HANDLERS','FLAG_SPECS'].map((n) => n + ':' + typeof d[n]).join(' '))"
grep -n "from './history-gate.mjs'" deploy/history-replay.mjs
grep -n "from 'node:crypto'\|from '../ccd/history/store.mjs'\|from '../ccd/history/sweep.mjs'\|from '../ccd/history/lib.mjs'" deploy/history-replay.mjs
grep -c 'recallOffPath(' deploy/history-replay.mjs
grep -cE '^const (familyKeyOf|cmpUnit) = ' deploy/history-replay.mjs
for n in contractFlags familiesOf mergeSourced assembleCensus deriveAssignment coveredDays rhoHat powerReport registryStateOf verifyRegistryReport abStateOf verifyAbReport sourcedReport quizMetaReport openTemplate buildDraft buildFinal loadInput recheckCode checkFlags pairedInputs loadInputs loadRecordInput loadFrozen subcommandHome nodeStoreId requireNamedNode printWithSha schemaValues applyOverrides readOverrides skeletonOf skeletonField copyJson byFamilyKey frozenEntryOf pilotCaps warnFailedRuns controlFileOf newestPresenceWrite presenceSeenMs censusError verifyError sourcedError entryError quizMetaError powerError pilotSourceError pilotResultError openDraft openFinalize verifyRegistry verifyAb DRAFT_SPEC PILOT_DERIVED SUBCOMMAND_FLAGS DRAFT_INPUT PRED_INPUT NODE_INPUTS INPUT_WORDS RECORD_WORDS Q18_DAY_MS; do printf '%s:%s ' "$n" "$(grep -cE "^(export )?(async )?(function|const) $n\b" deploy/history-replay.mjs)"; done; echo
grep -n "T8_GATE_BYTES" server/test/history-replay.test.ts | head -3
grep -c '^function w6SourceBox(' server/test/history-replay.test.ts
```

Expected:
- the first line prints `function` for every name but `HANDLERS:object FLAG_SPECS:object`. Importing the module acts on nothing, because the entry guard holds `main`.
- the gate import exists (Task 1), and so do Task 1's statements of `node:crypto`, `store.mjs`, `sweep.mjs` and `lib.mjs`. A missing one is a gap in Task 1: stop and report.
- `recallOffPath(` counts 1: W2-4's `lstatSync` line. After this task it counts 2 (Step 7's `controlFileOf` read).
- `2`: Task 5's module-private `familyKeyOf` and `cmpUnit`, which this task's `byFamilyKey` reads.
- every name in the loop counts 0. A name an earlier task declared collides: stop and report it; never rename one task's name in another.
- `T8_GATE_BYTES` reads the gate's real bytes (Task 1's repair).
- `1`: Task 6's `w6SourceBox`, which Step 3's end-to-end walk reuses.

A `sourceQuiz`, `qidOf`, `openWriter` or frozen-list name that is missing or of another type is a gap in Task 6: stop and report it. Never define one here.

- [ ] **Step 2: Re-pin W2-4's two exact pins.** In `server/test/history-replay.test.ts`:

Replace the `it` that begins `  it('FLAG_SPECS declares exactly the seven flags W2-4 uses, frozen', () => {` (about :178), whole, through its closing `  });`, with:

```ts
  it('FLAG_SPECS declares exactly W2-4\'s seven flags and W2-5a Task 7\'s, frozen', () => {
    expect(Object.isFrozen(replay.FLAG_SPECS)).toBe(true);
    expect(replay.FLAG_SPECS).toEqual({ out: 'string', account: 'string', budget: 'int', 'writer-model': 'string',
      'judge-model': 'string', 'arm-model': 'string', 'settings-mode': 'string',
      // W2-5a Task 7 (W2-D25, W2-D73, W2-D84, W2-D21): a list flag repeats, one value per node, paired by position
      step0a: 'list', 'step0a-sha256': 'list', 'node-label': 'list', 'node-store-id': 'list',
      pilot: 'string', 'pilot-sha256': 'string', overrides: 'string',
      record: 'string', 'record-sha256': 'string', supersedes: 'string', 'supersedes-sha256': 'string',
      part1: 'string', 'part1-sha256': 'string', 'prior-final': 'string', 'prior-final-sha256': 'string',
      census: 'list', 'census-sha256': 'list', verify: 'list', 'verify-sha256': 'list', sourced: 'list', 'sourced-sha256': 'list',
      frozen: 'string', 'frozen-sha256': 'string', 'quiz-meta': 'string', 'quiz-meta-sha256': 'string',
      power: 'string', 'power-sha256': 'string', 'pilot-result': 'string', 'pilot-result-sha256': 'string',
      'sha-min-prefix': 'int', 'writer-input': 'string', 'n-fidelity': 'int', 'n-usage': 'int',
      'spend-budget': 'int', 'window-start': 'int', 'window-end': 'int', 'q18-decision': 'string',
      draft: 'bool', finalize: 'bool', template: 'bool', registry: 'bool', section: 'string' });
  });
```

Replace the line `    expect([...t9Driver.HANDLERS.keys()]).toEqual(['step0a', 'probe']);` (about :4765) and the comment line above it, `    // This PR's whole subcommand set, in registration order (Task 1's grammar cases use an unregistered name).`, with:

```ts
    // The driver's whole subcommand set, in registration order: W2-4's two, then W2-5a Task 7's six (Task 1's grammar
    // cases use an unregistered name).
    expect([...t9Driver.HANDLERS.keys()]).toEqual(['step0a', 'probe', 'pilot-source', 'quiz-source', 'freeze', 'power', 'open', 'verify']);
```

Replace W2-4 Task 7's structural case, from `    t7it('the driver names recall-off on exactly one code line, an lstatSync of recallOffPath, and never spells the directory', () => {` (about :3838) through `      t7expect(naming(code)).toEqual(['lstatSync(recallOffPath(home, id));']);`, with:

```ts
    t7it('the driver names recall-off on exactly two code lines, W2-4\'s lstatSync presence check and verify\'s readBounded content read (W2-D84, R6), and never spells the directory', () => {
      const code = t7fs.readFileSync(t7path.join(REPO, 'deploy', 'history-replay.mjs'), 'utf8').split('\n')
        .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l));
      const naming = (lines: string[]): string[] => lines.filter((l) => l.includes('recallOffPath(')).map((l) => l.trim());
      const spells = (lines: string[]): string[] => lines.filter((l) => /\/recall-off|'recall-off'|RECALL_OFF_DIR/.test(l));
      t7expect(naming(code)).toEqual(['lstatSync(recallOffPath(home, id));', 'const r = readBounded(recallOffPath(home, id), CONTROL_FILE_MAX, false);']);
```

(The rest of that case, its `spells` assertion and its CONTROL lines, stays as it is.) Then, in Task 1's `EXACT_NAMES`, replace `    '../ccd/history/store.mjs': '{ StoreError, openReader, userVersion }',` with `    '../ccd/history/store.mjs': '{ StoreError, openReader, readBounded, userVersion }',` and `    '../ccd/history/sweep.mjs': '{ ftsTextOfBlob }',` with `    '../ccd/history/sweep.mjs': '{ ftsTextOfBlob, readRegPresence }',`.

Then widen `withHandler`'s handler type in W2-4 Task 1's describe (about :270) to the driver's widened `Flags` (Step 5(a)). Replace the line

```ts
  const withHandler = async (sub: string, h: (flags: Record<string, string | number | boolean>, env: Record<string, string | undefined>) => Promise<number>,
```

with

```ts
  const withHandler = async (sub: string, h: (flags: Record<string, string | number | boolean | string[]>, env: Record<string, string | undefined>) => Promise<number>,
```

`replay.HANDLERS.set(sub, h)` type-checks only while `h` accepts every `Flags` value: under the server tsconfig's `strict` (`strictFunctionTypes`), a handler typed for the narrower record is not assignable to the map's value type once `Flags` carries `string[]`, and `typecheck-tests` goes red.

- [ ] **Step 3: Write the failing tests.** Append at the end of `server/test/history-replay.test.ts`. The tests are live-safe in three ways:
- **Fixture HOMEs only.** Every HOME is an `r7MkTmp` tree. It holds W2-4 Task 3's `up-a` row (`FIXTURE_ACCOUNTS[0]`), W2-4 Task 5's recording stub at `$HOME/.local/bin/up-a` (`plantStub`, which prints `STUB_STREAM`), a fresh limits row and a tagged `build.json`. Where a node's store is read, it also holds a store made by `store.mjs`'s `createStore` under that HOME with the case's store id, and the meta rows the case plants. Registry and presence files go under that HOME.
- **Spawning subcommands.** `pilot-source` and `quiz-source` run in-process. With `sourceQuiz` injected, the only child they start is the stub's `--version` (the writer handle's preflight). The one end-to-end case runs the real `sourceQuiz` over Task 6's `w6SourceBox` store, and the writer stub answers its one question (R7). Every spawned run gets W2-4's `spawnEnv` and its poisoned `gh`.
- **The rest run as the operator runs them.** That is `node --no-warnings` on the checkout's driver, or on a copied tree (`tree7`), with `scrubbedEnv` and the fixture HOME.

```ts

// ── W2-5a Task 7: the record subcommands (W2-D84's first half, W2-D24, W2-D73, W2-D21, W2-D19, W2-D20, W2-D25; D-5773) ──
// Every HOME is a fixture (W2-4's up-a row and recording stub, a fresh limits row, a tagged stamp, and where a node's
// store is read a createStore store with the case's store id and meta rows). pilot-source and quiz-source run
// in-process, with sourceQuiz injected or, in the one end-to-end walk, real over Task 6's w6SourceBox store; every other
// subcommand runs as the operator runs it, node --no-warnings on a driver with the scrubbed env. No case reads the live
// HOME, spawns a real model, or writes outside its own mkTmp trees.
import * as r7fs from 'node:fs';
import * as r7path from 'node:path';
import { spawnSync as r7SpawnSync } from 'node:child_process';
import * as r7Store from '../../ccd/history/store.mjs';
import { describe as r7describe, expect as r7expect, it as r7it, vi as r7vi } from 'vitest';
import * as r7drv from '../../deploy/history-replay.mjs';
import * as r7gate from '../../deploy/history-gate.mjs';
import { RECALL_OFF_KEYS as R7_KEYS, canonicalJson as r7Canon, historyPaths as r7Paths, sha256Hex as r7Sha } from '../../ccd/history/lib.mjs';
import { mkTmp as r7MkTmp } from './tmpHelpers.js';
import { REPO as R7_REPO, scrubbedEnv as r7Scrubbed } from './historyHelpers.js';

r7describe('W2-5a Task 7: the record subcommands', () => {
  type R7 = Record<string, any>;
  type Ref = { store_id: string; ccrc_id: string; generation: string };
  type Saved = { path: string; sha: string; value: R7 };
  const DAY = 86_400_000;
  const T0 = 1_800_000_000_000;
  const STORE_A = '00000000-0000-4000-8000-0000000000a7';
  const STORE_B = '00000000-0000-4000-8000-0000000000b7';
  const STORE_C = '00000000-0000-4000-8000-0000000000c7';
  const OPUS = 'claude-opus-9-1';
  const ARM = 'claude-arm-9-1';
  const STAMP = 'v9.9.7';
  const gen = (n: number): string => `0189abcd-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const hex = (label: string): string => r7Sha(`w2-5a task 7 fixture: ${label}`);
  const SEED = hex('seed');
  const SHAS = (root: string): Record<string, string> => (r7drv.codeShas(root) as { files: Record<string, string> }).files;
  const ROOT_SKIP = typeof process.getuid === 'function' && process.getuid() === 0;

  // ── fixtures ──────────────────────────────────────────────────────────────────────────────────────────────
  /** The first generation of `id` on `store` whose arm under SEED is `arm` (W2-D19), searched from n0, so the fixture
   *  holds whatever bit the seed gives. */
  const pick = (store: string, id: string, arm: string, n0: number): Ref => {
    for (let n = n0; ; n += 1) {
      const f = { store_id: store, ccrc_id: id, generation: gen(n) };
      if (r7gate.armOf(SEED, f) === arm) return f;
    }
  };
  const A_T1 = pick(STORE_A, 'a-t1', 'treatment', 100);
  const A_T2 = pick(STORE_A, 'a-t2', 'treatment', 200);
  const A_C1 = pick(STORE_A, 'a-c1', 'control', 300);
  const A_C2 = pick(STORE_A, 'a-c2', 'control', 400);
  const A_D: Ref = { store_id: STORE_A, ccrc_id: 'a-d', generation: gen(500) };   // registry-absent: dropped before the flip
  const B_T1 = pick(STORE_B, 'b-t1', 'treatment', 600);
  const B_C1 = pick(STORE_B, 'b-c1', 'control', 700);
  const PILOT_FAMILY: Ref = { store_id: STORE_A, ccrc_id: 'pilot-0', generation: gen(900) };
  /** [measured windows, windows with a read call] per family, as the census plants them. */
  const SHAPE: Record<string, [number, number]> = { 'a-t1': [3, 2], 'a-t2': [2, 0], 'a-c1': [2, 1], 'a-c2': [1, 1], 'a-d': [2, 2], 'b-t1': [2, 1], 'b-c1': [3, 0] };
  const keyOf = (f: Ref): string => r7gate.familyKey(f.store_id, f.ccrc_id, f.generation);

  /** Make `home` a fixture node: up-a (upstream) and its stub, a fresh limits row and a tagged stamp. */
  function node7(home: string): void {
    writeRoster(home, [FIXTURE_ACCOUNTS[0]!]);
    plantStub(home, 'up-a');
    const nowS = Math.floor(Date.now() / 1000);
    r7fs.mkdirSync(r7path.join(home, '.cc-limits'), { recursive: true });
    r7fs.writeFileSync(r7path.join(home, '.cc-limits', 'up-a.json'),
      JSON.stringify({ five: 10, seven: 20, ts: nowS - 60, fiveResetAt: nowS + 3600, sevenResetAt: nowS + 86400 }));
    r7fs.writeFileSync(r7path.join(home, '.ccrc', 'build.json'),
      JSON.stringify({ sha: 'fixture', ref: 'main', builtAt: '2026-10-22T00:00:00Z', dirty: false, version: STAMP }));
  }
  /** A fixture HOME (node7), and, with `store`, a store made by store.mjs's createStore with that store id, whose meta
   *  also holds `meta`: the store a node's subcommand opens through Task 1's openReplayStore. */
  function home7(store: string | null, meta: Array<[string, string]> = []): string {
    const home = r7MkTmp('ccrc-w2-5a-t7-home-');
    node7(home);
    if (store !== null) {
      r7Store.createStore(home, { storeId: store });
      const w = r7Store.openWriter(r7Paths(home).dbFile) as unknown as { prepare(sql: string): { run(...a: unknown[]): unknown } };
      try {
        const put = w.prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)');
        for (const [k, v] of meta) put.run(k, v);
      } finally {
        r7Store.closeWriter(w as never);
      }
    }
    return home;
  }
  /** What the stub answers to --version: the first line of the stream it prints (W2-4 Task 7's measureClaudeVersion). */
  const versionOf = (home: string): string => r7fs.readFileSync(r7path.join(home, STUB_STREAM), 'utf8').split('\n')[0]!.trim();

  /** A tree the driver runs from: the four gate_code files COPIED (the real gate, which the driver imports since W2-5a),
   *  every other ccd/history entry, the rest of ccd/ and shared/ symlinked to this checkout. `edit` appends one byte to a
   *  copied file; `drop` removes one (measure-history.py, which nothing imports), so codeShas() over this tree moves. */
  function tree7(opts: { edit?: string; drop?: string } = {}): string {
    const tree = r7MkTmp('ccrc-w2-5a-t7-tree-');
    for (const rel of r7drv.CODE_SHA_FILES as string[]) {
      r7fs.mkdirSync(r7path.join(tree, r7path.dirname(rel)), { recursive: true });
      r7fs.copyFileSync(r7path.join(R7_REPO, rel), r7path.join(tree, rel));
    }
    for (const n of r7fs.readdirSync(r7path.join(R7_REPO, 'ccd', 'history'))) {
      if (!r7fs.existsSync(r7path.join(tree, 'ccd', 'history', n))) r7fs.symlinkSync(r7path.join(R7_REPO, 'ccd', 'history', n), r7path.join(tree, 'ccd', 'history', n));
    }
    for (const n of r7fs.readdirSync(r7path.join(R7_REPO, 'ccd'))) {
      if (n !== 'history') r7fs.symlinkSync(r7path.join(R7_REPO, 'ccd', n), r7path.join(tree, 'ccd', n));
    }
    r7fs.symlinkSync(r7path.join(R7_REPO, 'shared'), r7path.join(tree, 'shared'));
    if (opts.edit !== undefined) r7fs.appendFileSync(r7path.join(tree, opts.edit), '\n');
    if (opts.drop !== undefined) r7fs.rmSync(r7path.join(tree, opts.drop));
    return tree;
  }
  /** The operator's run: node on the driver in `tree` (the checkout's when null), the scrubbed env, a fixture HOME
   *  (a fresh empty one when none is given), never the live one. */
  function run7(tree: string | null, home: string | null, args: string[]): { code: number | null; stdout: string; stderr: string } {
    const h = home ?? r7MkTmp('ccrc-w2-5a-t7-emptyhome-');
    const script = tree === null ? SCRIPT : r7path.join(tree, 'deploy', 'history-replay.mjs');
    const r = r7SpawnSync(process.execPath, ['--no-warnings', script, ...args],
      { cwd: h, env: { ...r7Scrubbed(process.env), HOME: h }, encoding: 'utf8', timeout: 120_000, killSignal: 'SIGKILL' });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  }
  /** Save a value as the operator does: canonical JSON and one newline, 0600, in a fresh directory outside any git tree. */
  function save7(value: R7, name = 'input.json'): Saved {
    const p = r7path.join(r7MkTmp('ccrc-w2-5a-t7-in-'), name);
    const text = r7Canon(value) + '\n';
    r7fs.writeFileSync(p, text, { mode: 0o600 });
    return { path: p, sha: r7Sha(text), value };
  }
  /** Bytes saved as they are (a frozen list has no trailing newline, W2-D73). */
  function saveText7(text: string, name: string): Saved {
    const p = r7path.join(r7MkTmp('ccrc-w2-5a-t7-in-'), name);
    r7fs.writeFileSync(p, text, { mode: 0o600 });
    return { path: p, sha: r7Sha(text), value: JSON.parse(text) };
  }
  const loaded = (s: Saved): R7 => ({ path: s.path, sha256: s.sha, value: s.value });
  /** `--<name> PATH --<name>-sha256 HEX`. */
  const inp = (name: string, s: Saved): string[] => [`--${name}`, s.path, `--${name}-sha256`, s.sha];
  const outDir = (): string => r7path.join(r7MkTmp('ccrc-w2-5a-t7-out-'), 'out');

  const FLAGS_OK = (mode: string): Record<string, boolean> => Object.fromEntries((r7drv.contractFlags(mode) as string[]).map((f) => [f, true]));
  /** W2-4's Step0aOutput for a node, measured under `root`'s code, HOME's stamp and HOME's stub. */
  const step0a7 = (root: string, home: string): R7 => ({
    kind: r7drv.STEP0A_KIND, v: 1, measured_ms: T0 - 40 * DAY, account: 'up-a', settings_mode: 'restricted',
    claude_code_version: versionOf(home), wrapper_sha256: null, flags_accepted: FLAGS_OK('restricted'),
    writer_init: { tools: [] }, judge_init: { tools: [] }, box_init: { tools: ['Bash', 'Agent'] },
    code_shas: SHAS(root), release_stamp: STAMP, budget: 100_000, spend: 600,
  });
  /** pilot-source's output, as this task writes it, measured under `root`'s code. */
  const pilot7 = (root: string): R7 => ({
    kind: r7drv.PILOT_SOURCE_KIND, v: 1, store_id: STORE_A, seed: hex('pilot seed'), n_fidelity: 5, n_usage: 5,
    families: [PILOT_FAMILY], fidelity: [{ ...PILOT_FAMILY, boundary_uuid: gen(901) }], frozen_sha256: hex('pilot frozen'), writer_model: OPUS,
    used: { labeller: { ...r7gate.LABELLER, path_forms: [...r7gate.LABELLER.path_forms] }, sha_min_prefix: 7, writer_input: 'excerpt', baseline_files: 'v1',
      writer_prompt_sha256: r7gate.WRITER_PROMPT_SHA256, answer_protocol_sha256: r7gate.ANSWER_PROTOCOL_SHA256 },
    code_shas: SHAS(root), release_stamp: STAMP, budget: 3_000_000, spend: 900_000, counts: {},
  });
  /** Part 1 over nodes A and B, through the driver's own buildDraft, the seed injected (W2-D19: no flag takes one).
   *  Q18 is kept cheap (sims 2, a 0.45 grid) and the floor low, so the five-question fixture quiz passes it. */
  function draft7(root: string, home: string, over: R7 = {}): R7 {
    const s0 = step0a7(root, home);
    return r7drv.buildDraft({
      nodes: [{ label: 'node-a', store_id: STORE_A }, { label: 'node-b', store_id: STORE_B }],
      step0a: [{ ...s0, label: 'node-a', store_id: STORE_A }, { ...s0, label: 'node-b', store_id: STORE_B }],
      pilot: pilot7(root), account: 'up-a', models: { arm: ARM, writer: OPUS, judge: OPUS },
      gateCode: { release_tag: STAMP, files: SHAS(root) }, seedHex: SEED, nowMs: T0 - 30 * DAY,
      overrides: { q18_settings: { sims: 2, grid_step: 0.45 }, quiz: { halt_floor: { questions: 4, families: 2 } }, ...over }, supersedes: null,
    }) as R7;
  }
  /** measure-history.py --census's report for one store at T0: a 14-day look-back, ticks from T0 - 7 d (so covered_days is
   *  7), and each family's SHAPE: `windows` measured windows (one copy, no turns, an inclusive end 1 s after the boundary),
   *  the first `withCall` of them holding one read call. */
  function census7(store: string, fams: Ref[], over: { since?: number; ticksFirst?: number | null; nTicks?: number; stale?: string } = {}): R7 {
    return {
      store_id: store, user_version: 2, script_sha256: hex('script'), counters: { 'card_consumed:main': 3 }, w2: null,
      census: {
        as_of_ms: T0, since_ms: over.since ?? T0 - 14 * DAY, row_cap: r7gate.ROW_CAP,
        ticks: { n: over.nTicks ?? 10, first_ts_ms: over.ticksFirst === undefined ? T0 - 7 * DAY : over.ticksFirst, last_ts_ms: T0 - 1000 },
        families: fams.map((f, i) => {
          const [windows, withCall] = SHAPE[f.ccrc_id]!;
          const at = (w: number): number => T0 - 6 * DAY + i * 1_000_000 + w * 10_000;
          return {
            ccrc_id: f.ccrc_id, generation: f.generation, session_pk: i + 1, merged_into: null, first_seen_ms: T0 - 20 * DAY + i,
            last_main_ts_ms: over.stale === f.ccrc_id ? T0 - 10 * DAY : T0 - 1000, merged_generations: [],
            calls: Array.from({ length: withCall }, (_, w) => [at(w) + 10, 0, 'grep']),
            boundaries: Array.from({ length: windows }, (_, w) => ({
              boundary_uuid: gen(5000 + i * 100 + w), ts_ms: at(w),
              copies: [{ file_id: 1, source_key: '', boundary_line: 1 + w * 10, after_count: 1, summary_line: null, next_boundary_line: null,
                next_boundary_ts_ms: null, last_ts_ms: at(w) + 1000, rows: [], models: [], truncated: false }],
            })),
          };
        }),
      },
    };
  }
  const FAMS_A = [A_T1, A_T2, A_C1, A_C2, A_D];
  const FAMS_B = [B_T1, B_C1];
  /** verify --registry's output for a census, every family ok but `states` (built by the driver's own report builder). */
  function verify7(recordSha: string, census: Saved, states: Record<string, string> = {}): R7 {
    const active = (r7gate.activeFamilies(census.value.store_id, census.value.census, { lookbackMs: r7gate.ACTIVE_LOOKBACK_MS }) as { active: Ref[] }).active;
    return r7drv.verifyRegistryReport({ recordSha256: recordSha, storeId: census.value.store_id, censusSha256: census.sha,
      lookbackMs: r7gate.ACTIVE_LOOKBACK_MS, families: active.map((f) => ({ ccrc_id: f.ccrc_id, generation: f.generation, state: states[f.ccrc_id] ?? 'ok' })) }) as R7;
  }
  /** A sourced entry's eleven frozen fields, its rank stripped (Task 6's frozenListText takes exactly FROZEN_ENTRY_KEYS). */
  const strip7 = (e: R7): R7 => Object.fromEntries((r7drv.FROZEN_ENTRY_KEYS as string[]).map((k) => [k, e[k]]));
  /** The frozen list's head as freeze and pilot-source write it: the record's writer and the labeller with its prefix. */
  const head7 = (prefix = 7): R7 => ({ writer_model: OPUS, labeller: { ...r7gate.LABELLER, sha_min_prefix: prefix } });
  /** A synthetic family order key: 64 hex digits, in code-unit order by `i` (Task 5's quizFamilyOrderKey is a sha256's
   *  hex; freeze compares keys, it never recomputes them). */
  const K7 = (i: number): string => String(i).repeat(64);
  /** One quiz entry on family `f`: W2-D73's eleven fields, its qid by Task 6's qidOf, and its global rank, `[order key,
   *  candidate rank]` (R10); a pilot entry's rank is its node's own, `[family index, candidate rank]`, and is stripped. */
  function entry7(f: Ref, n: number, rank: [string | number, number]): R7 {
    const fact = (0xabc0000 + n).toString(16);
    const e = { store_id: f.store_id, ccrc_id: f.ccrc_id, generation: f.generation, boundary_uuid: gen(8000 + n), kind: 'sha', fact, fact_raw: fact,
      question: `Which commit did fixture step ${n} record?`, source_entry_uuid: gen(9000 + n), repo_roots: ['/home/u/tree'] };
    return { ...e, qid: r7drv.qidOf(e) as string, rank };
  }
  /** Everything open --finalize reads, built through the driver's own builders (part 1, the census and verify outputs, the
   *  assembled census and its assignment, two nodes' sourced lists, the frozen list and its meta, the power output, a
   *  pilot result), and the part 2 buildFinal makes from them. */
  function chain7(home: string, draftOver: R7 = {}): R7 {
    const draft = draft7(R7_REPO, home, draftOver);
    const d = save7(draft, 'part1.json');
    const cA = save7(census7(STORE_A, FAMS_A), 'census-a.json');
    const cB = save7(census7(STORE_B, FAMS_B), 'census-b.json');
    const vA = save7(verify7(d.sha, cA, { 'a-d': 'registry-absent' }), 'verify-a.json');
    const vB = save7(verify7(d.sha, cB), 'verify-b.json');
    const assembled = r7drv.assembleCensus(draft, [cA, cB].map(loaded), [vA, vB].map(loaded)) as R7;
    const assignment = r7drv.deriveAssignment(SEED, assembled) as { list: R7[]; sha256: string };
    const inputs = (assembled.nodes as R7[]).map((n) => ({ store_id: n.store_id, census_sha256: n.census_sha256, verify_sha256: n.verify_sha256 }));
    const entriesA = [entry7(A_T1, 1, [K7(0), 0]), entry7(A_T1, 2, [K7(0), 1]), entry7(A_T2, 3, [K7(2), 0])];
    const entriesB = [entry7(B_T1, 4, [K7(1), 0]), entry7(B_T1, 5, [K7(1), 1])];
    const sA = save7(r7drv.sourcedReport({ recordSha256: d.sha, storeId: STORE_A, assignmentSha256: assignment.sha256, inputs, sourced: { entries: entriesA, counts: {} }, spend: 0 }) as R7, 'sourced-a.json');
    const sB = save7(r7drv.sourcedReport({ recordSha256: d.sha, storeId: STORE_B, assignmentSha256: assignment.sha256, inputs, sourced: { entries: entriesB, counts: {} }, spend: 0 }) as R7, 'sourced-b.json');
    const merged = r7drv.mergeSourced([entriesA, entriesB], draft.quiz.target) as R7[];
    const fz = saveText7(r7drv.frozenListText('quiz', head7(), merged.map(strip7)) as string, 'frozen.json');
    const meta = save7(r7drv.quizMetaReport({ recordSha256: d.sha, frozenSha256: fz.sha, assignmentSha256: assignment.sha256, entries: merged,
      floor: draft.quiz.halt_floor, minFamilies: draft.quiz.min_families, sourced: [sA, sB].map((s) => ({ store_id: s.value.store_id, sha256: s.sha })) }) as R7, 'frozen.meta.json');
    const power = save7(r7drv.powerReport(draft, d.sha, assembled) as R7, 'power.json');
    const pilotResult = save7({ kind: r7drv.PILOT_RESULT_KIND, v: 1, fidelity: [{ boundary_uuid: gen(901), pass: true }],
      usage_extrapolation: { tokens_per_question: 1000 }, step0b_sha256: hex('step0b'), settings_mode: 'restricted', absent_rate: { num: 0, den: 10 } }, 'pilot-result.json');
    const frozen = { sha256: fz.sha, list: fz.value, families: r7drv.familiesOf(fz.value.entries) };
    const final = r7drv.buildFinal({ draft, draftSha256: d.sha, priorSha256: null, assembled, assignment, power: power.value, powerSha256: power.sha,
      frozen, pilotResult: pilotResult.value, spendBudget: 30_000_000, window: { start: T0 + DAY, end: T0 + 15 * DAY }, decision: 'keep', nowMs: T0 }) as R7;
    return { draft, d, cA, cB, vA, vB, assembled, assignment, inputs, sA, sB, merged, fz, meta, power, pilotResult, frozen, final, f: save7(final, 'part2.json') };
  }
  /** The finalize argv over a chain, `over` replacing one input or (null) leaving one out. */
  function finalizeArgv(c: R7, over: Record<string, string[] | null> = {}): string[] {
    const parts: Record<string, string[] | null> = {
      record: inp('record', c.d), census: [...inp('census', c.cA), ...inp('census', c.cB)], verify: [...inp('verify', c.vA), ...inp('verify', c.vB)],
      power: inp('power', c.power), frozen: inp('frozen', c.fz), 'quiz-meta': inp('quiz-meta', c.meta), 'pilot-result': inp('pilot-result', c.pilotResult),
      rest: ['--spend-budget', '30000000', '--window-start', String(T0 + DAY), '--window-end', String(T0 + 15 * DAY), '--q18-decision', 'keep'], ...over,
    };
    return ['open', '--finalize', ...Object.values(parts).flatMap((v) => v ?? [])];
  }
  /** Every entry under `root`, with its mode, size, mtime and (for a file) its bytes' sha256. The store's own directory is
   *  summarised by its db file's bytes alone: a read-only open of a WAL store may leave SQLite's sidecars there, which
   *  are SQLite's, not the driver's writes. */
  function snapshot7(root: string): string[] {
    const out: string[] = [];
    const dbFile = r7Paths(root).dbFile;
    const walk = (dir: string, rel: string): void => {
      if (dir === r7path.dirname(dbFile)) {
        out.push(`${rel} db ${r7fs.existsSync(dbFile) ? r7Sha(r7fs.readFileSync(dbFile)) : 'absent'}`);
        return;
      }
      for (const n of r7fs.readdirSync(dir).sort()) {
        const p = r7path.join(dir, n);
        const r = rel === '' ? n : `${rel}/${n}`;
        const st = r7fs.lstatSync(p);
        out.push(`${r} ${st.mode} ${st.size} ${st.mtimeMs}${st.isFile() ? ` ${r7Sha(r7fs.readFileSync(p))}` : ''}`);
        if (st.isDirectory()) walk(p, r);
      }
    };
    walk(root, '');
    return out;
  }
  /** An in-process call, its stderr captured (the sha line) and its refusal, if any, answered as {word, detail}. */
  async function inProcess(fn: () => Promise<unknown>): Promise<{ code: unknown; stderr: string; refusal: { word: string; detail: string } | null }> {
    const lines: string[] = [];
    const spy = r7vi.spyOn(process.stderr, 'write').mockImplementation(((s: string | Uint8Array) => { lines.push(String(s)); return true; }) as typeof process.stderr.write);
    try {
      return { code: await fn(), stderr: lines.join(''), refusal: null };
    } catch (e) {
      if (e instanceof r7drv.DriverRefusal) return { code: null, stderr: lines.join(''), refusal: { word: (e as R7).word, detail: (e as R7).detail } };
      throw e;
    } finally {
      spy.mockRestore();
    }
  }
  const envOf = (home: string): R7 => ({ HOME: home, TMUX_PANE: undefined, LANG: undefined });
  const printRuns = (home: string): unknown[] => (stubLog(home) ?? []).filter((e) => e.argv.includes('-p'));

  // ── the grammar and the subcommand table ───────────────────────────────────────────────────────────────────
  r7describe('W2-5a Task 7: the grammar and the subcommand table', () => {
    r7it('a list flag collects every value in order, and a list flag beside its sha partner is paired by position', () => {
      const { flags } = r7drv.parseArgs(['power', '--census', '/c/a', '--census', '/c/b', '--census-sha256', 'h1', '--census-sha256', 'h2', '--record', '/r']);
      r7expect(flags).toEqual({ census: ['/c/a', '/c/b'], 'census-sha256': ['h1', 'h2'], record: '/r' });
    });

    r7it.each([
      [['pilot-source', '--record', '/r'], '--record is not a pilot-source flag'],
      [['quiz-source', '--account', 'up-a'], '--account is not a quiz-source flag'],
      [['freeze', '--census', '/c'], '--census is not a freeze flag'],
      [['power', '--out', '/o'], '--out is not a power flag'],
      [['open', '--draft', '--record', '/r'], '--record is not a open --draft flag'],
      [['open', '--finalize', '--account', 'up-a'], '--account is not a open --finalize flag'],
      [['open', '--template', '--out', '/o'], '--out is not a open --template flag'],
      [['verify', '--registry', '--frozen', '/f'], '--frozen is not a verify --registry flag'],
      [['verify', '--section', 'ab', '--census', '/c'], '--census is not a verify --section ab flag'],
      [['step0a', '--record', '/r'], '--record is not a step0a flag'],
    ])('each subcommand refuses a flag it never reads, before anything else: %j', (argv, detail) => {
      const r = run7(null, home7(null), argv as string[]);
      r7expect(r.code).toBe(2);
      r7expect(r.stderr).toBe(refusalLine('args-invalid', detail));
    });

    r7it('a required flag missing is named; an optional file flag without its sha, or a sha without its file, is refused', () => {
      const H = 'a'.repeat(64);
      const base = ['power', '--census', '/c', '--census-sha256', H, '--verify', '/v', '--verify-sha256', H];
      r7expect(run7(null, home7(null), [...base, '--record', '/r']).stderr).toBe(refusalLine('args-invalid', 'record-sha256-required'));
      const full = [...base, '--record', '/r', '--record-sha256', H];
      r7expect(run7(null, home7(null), [...full, '--supersedes', '/s']).stderr).toBe(refusalLine('args-invalid', '--supersedes and --supersedes-sha256 go together'));
      r7expect(run7(null, home7(null), [...full, '--supersedes-sha256', H]).stderr).toBe(refusalLine('args-invalid', '--supersedes and --supersedes-sha256 go together'));
    });

    r7it('open wants exactly one mode, and verify exactly one of --registry and --section ab', () => {
      r7expect(run7(null, null, ['open']).stderr).toBe(refusalLine('args-invalid', 'open wants exactly one of --draft, --finalize and --template'));
      r7expect(run7(null, null, ['open', '--draft', '--template']).stderr).toBe(refusalLine('args-invalid', 'open wants exactly one of --draft, --finalize and --template'));
      r7expect(run7(null, null, ['verify']).stderr).toBe(refusalLine('args-invalid', 'verify wants exactly one of --registry and --section'));
      r7expect(run7(null, null, ['verify', '--registry', '--section', 'ab']).stderr).toBe(refusalLine('args-invalid', 'verify wants exactly one of --registry and --section'));
      r7expect(run7(null, null, ['verify', '--section', 'quiz']).stderr).toBe(refusalLine('args-invalid', 'section "quiz": this build verifies ab only'));
    });

    r7it('no W2-5a subcommand takes --allow-code-change: before window start a code change is a superseding draft (W2-D6, W2-D24)', () => {
      for (const sub of [['quiz-source'], ['freeze'], ['power'], ['open', '--finalize'], ['verify', '--registry']]) {
        r7expect(run7(null, null, [...sub, '--allow-code-change']).stderr, sub.join(' ')).toBe(refusalLine('args-invalid', 'unknown flag "--allow-code-change"'));
      }
    });
  });

  // ── parity with the gate and with step 0a ──────────────────────────────────────────────────────────────────
  // CODE_SHA_FILES parity is Task 1's pin (R3); this describe holds the flags_accepted parity pin.
  r7describe('W2-5a Task 7: parity with the gate and with step 0a', () => {
    r7it.each(['restricted', 'fallback'])('step0a records every flag the contract carries, under %s: flags_accepted parity', (mode) => {
      const home = home7(null);
      const out = outDir();
      const r = run7(null, home, ['step0a', '--out', out, '--account', 'up-a', '--budget', '100000', '--writer-model', OPUS,
        '--judge-model', OPUS, '--arm-model', ARM, '--settings-mode', mode]);
      r7expect(r.code, r.stderr).toBe(0);
      const rec = JSON.parse(r7fs.readFileSync(r7path.join(out, r7drv.STEP0A_FILE), 'utf8'));
      r7expect(Object.keys(rec.flags_accepted).sort()).toEqual(r7drv.contractFlags(mode));
    });

    r7it('contractFlags is every flag token of every spawn mode\'s argv, and holds the arm-only tools flags', () => {
      for (const mode of ['restricted', 'fallback']) {
        const want = new Set<string>();
        for (const m of r7drv.SPAWN_MODES as string[]) for (const t of r7drv.spawnArgv({ mode: m, model: 'contract-model', settingsMode: mode, home: '/home/u' }) as string[]) if (t.startsWith('-')) want.add(t);
        r7expect(r7drv.contractFlags(mode)).toEqual([...want].sort());
      }
      r7expect(r7drv.contractFlags('restricted')).toEqual(r7expect.arrayContaining(['--allowedTools', '--restricted', '--tools', '--verbose']));
      r7expect(r7drv.contractFlags('fallback')).toEqual(r7expect.arrayContaining(['--setting-sources', '--settings']));
    });

    r7it('Q18_FIGURES reads exactly the two levels the validator requires in q18_settings.power (W2-D21, D-5791)', () => {
      const levels = [...new Set(Object.values(r7drv.Q18_FIGURES as Record<string, { power: number }>).map((f) => f.power))].sort();
      r7expect(levels).toEqual([0.5, 0.8]);
      const home = home7(null);
      const base = draft7(R7_REPO, home);
      const errs = (power: number[]): unknown[] => {
        const v = r7gate.validateOpenRecord({ ...base, q18_settings: { ...base.q18_settings, power } }, { draft: null, predecessor: null, frozen: null }) as R7;
        return v.ok ? [] : v.errors;
      };
      r7expect(errs([0.5, 0.8])).toEqual([]);
      for (const level of levels) r7expect(errs(levels.filter((l) => l !== level)), String(level)).toEqual([{ path: 'q18_settings.power', word: 'value-outside-set' }]);
    });

    r7it('REGISTRY_STATES is ok plus the validator\'s three drop reasons: each validates as a drop and ok does not (W2-D20)', () => {
      r7expect([...r7drv.REGISTRY_STATES]).toEqual(['ok', 'registry-mismatch', 'registry-absent', 'unreadable']);
      const c = chain7(home7(null));
      const ctx = { draft: c.draft, predecessor: null, frozen: { families: c.frozen.families, n_questions: c.merged.length } };
      for (const reason of r7drv.REGISTRY_STATES as string[]) {
        const final = { ...c.final, registry_drops: c.final.registry_drops.map((x: R7) => ({ ...x, reason })) };
        const v = r7gate.validateOpenRecord(final, ctx) as R7;
        if (reason === 'ok') r7expect(v.errors).toEqual([{ path: 'registry_drops[0].reason', word: 'value-outside-set' }]);
        else r7expect(v.ok, reason).toBe(true);
      }
    });
  });

  // ── the record and its inputs ──────────────────────────────────────────────────────────────────────────────
  r7describe('W2-5a Task 7: the record and its inputs', () => {
    const powerArgv = (d: Saved, extra: string[] = []): string[] => ['power', ...inp('record', d), '--census', '/nowhere/c', '--census-sha256', 'a'.repeat(64), '--verify', '/nowhere/v', '--verify-sha256', 'b'.repeat(64), ...extra];

    r7it('a record whose bytes are not its sha is record-sha-mismatch, checked before the bytes are parsed', () => {
      const d = saveText7('{"part":"draft"}\n', 'bad.json');
      r7fs.writeFileSync(d.path, 'not json at all');
      const got = r7Sha('not json at all');
      r7expect(run7(null, null, powerArgv(d)).stderr).toBe(refusalLine('record-sha-mismatch', `record: expected ${d.sha}, measured ${got}`));
    });

    r7it('a non-JSON input whose sha matches is input-invalid; a wrong sha on a non-JSON input is input-sha-mismatch', () => {
      const home = home7(null);
      const d = save7(draft7(R7_REPO, home), 'part1.json');
      const p = r7path.join(r7MkTmp('ccrc-w2-5a-t7-in-'), 'census.json');
      r7fs.writeFileSync(p, 'not json');
      const ok = ['power', ...inp('record', d), '--census', p, '--census-sha256', r7Sha('not json'), '--verify', p, '--verify-sha256', r7Sha('not json')];
      r7expect(run7(null, null, ok).stderr).toBe(refusalLine('input-invalid', 'census not-json'));
      const bad = ['power', ...inp('record', d), '--census', p, '--census-sha256', 'c'.repeat(64), '--verify', p, '--verify-sha256', r7Sha('not json')];
      r7expect(run7(null, null, bad).stderr).toBe(refusalLine('input-sha-mismatch', `census: expected ${'c'.repeat(64)}, measured ${r7Sha('not json')}`));
    });

    r7it('a record inside a git tree is record-invalid before a byte is read (W2-D25)', () => {
      const repo = r7MkTmp('ccrc-w2-5a-t7-git-');
      r7fs.mkdirSync(r7path.join(repo, '.git'));
      const p = r7path.join(repo, 'part1.json');
      r7fs.writeFileSync(p, '{}\n');
      r7expect(run7(null, null, ['power', '--record', p, '--record-sha256', r7Sha('{}\n'), '--census', '/c', '--census-sha256', 'a'.repeat(64), '--verify', '/v', '--verify-sha256', 'a'.repeat(64)]).stderr)
        .toBe(refusalLine('record-invalid', `record in-git-tree ${r7fs.realpathSync(repo)}`));
    });

    r7it('a final given where a draft is read, and a record the validator refuses, are record-invalid with every error', () => {
      const home = home7(null);
      const c = chain7(home);
      r7expect(run7(null, null, powerArgv(c.f)).stderr).toBe(refusalLine('record-invalid', 'record part "final", wanted draft'));
      const forged = save7({ ...c.draft, k: 11, row_cap: 1 }, 'forged.json');
      r7expect(run7(null, null, powerArgv(forged)).stderr).toBe(refusalLine('record-invalid', 'k constant-mismatch; row_cap constant-mismatch'));
    });

    r7it('a superseding draft is read only with its predecessor: --supersedes, whose sha must be the one it names', () => {
      const home = home7(null);
      const first = draft7(R7_REPO, home);
      const p1 = save7(first, 'part1-first.json');
      const second = { ...first, drafted_ms: first.drafted_ms + 1, supersedes: p1.sha, window_plan: { planned_days: 21 } };
      const p2 = save7(second, 'part1-second.json');
      r7expect(run7(null, null, powerArgv(p2)).stderr).toBe(refusalLine('args-invalid', 'supersedes-required: the record supersedes a draft; pass it as --supersedes'));
      // With it, the record validates and the next refusal is the absent census, read after the code re-check.
      r7expect(run7(null, null, powerArgv(p2, inp('supersedes', p1))).stderr).toBe(refusalLine('input-invalid', 'census unreadable ENOENT'));
    });

    r7it('a final is read with its draft (--part1) and its frozen list (--frozen), whose sha must be the record\'s quiz sha', () => {
      const home = home7(STORE_A);
      const c = chain7(home);
      const argv = (frozen: Saved): string[] => ['verify', '--section', 'ab', ...inp('record', c.f), ...inp('part1', c.d), ...inp('frozen', frozen)];
      const edited = saveText7(r7fs.readFileSync(c.fz.path, 'utf8').replace('fixture step 1', 'fixture step 7'), 'frozen-edited.json');
      r7expect(run7(null, home, argv(edited)).stderr).toBe(refusalLine('quiz-sha-mismatch', `frozen ${edited.sha} is not the record's quiz.sha256 ${c.fz.sha}`));
      r7expect(run7(null, home, ['verify', '--section', 'ab', ...inp('record', c.f), ...inp('frozen', c.fz)]).stderr).toBe(refusalLine('args-invalid', 'part1-required'));
    });
  });

  // ── W2-D24: every record subcommand re-checks the code it runs under ────────────────────────────────────────
  r7describe('W2-5a Task 7: the codeShas re-check on every record subcommand', () => {
    /** Each subcommand's argv over a valid record, with one input it would read next left unreadable, so a re-check that
     *  ran after that read would answer the input's word instead. */
    const rows: Array<[string, (c: R7) => string[]]> = [
      ['quiz-source', (c) => ['quiz-source', '--out', outDir(), ...inp('record', c.d), '--census', '/nowhere/c', '--census-sha256', c.cA.sha, ...inp('verify', c.vA)]],
      ['freeze', (c) => ['freeze', '--out', outDir(), ...inp('record', c.d), '--sourced', '/nowhere/s', '--sourced-sha256', c.sA.sha]],
      ['power', (c) => ['power', ...inp('record', c.d), '--census', '/nowhere/c', '--census-sha256', c.cA.sha, ...inp('verify', c.vA)]],
      ['open --finalize', (c) => finalizeArgv(c, { census: ['--census', '/nowhere/c', '--census-sha256', c.cA.sha] })],
      ['verify --registry', (c) => ['verify', '--registry', ...inp('record', c.d), '--census', '/nowhere/c', '--census-sha256', c.cA.sha]],
      ['verify --section ab', (c) => ['verify', '--section', 'ab', ...inp('record', c.f), ...inp('part1', c.d), ...inp('frozen', c.fz)]],
    ];
    r7it.each(rows)('code-changed before any other input is read, re-checks the code it runs under: %s', (_sub, argv) => {
      const home = home7(null);   // no store: verify ab's next read would refuse store-unreadable store-missing
      const c = chain7(home);
      const r = run7(tree7({ edit: 'deploy/measure-history.py' }), home, argv(c));
      r7expect(r.code).toBe(2);
      r7expect(r.stderr).toBe(refusalLine('code-changed', 'changed deploy/measure-history.py'));
      r7expect(printRuns(home)).toEqual([]);
    });
    r7it.each(rows)('code-unmeasured, never code-changed, for a gate_code file that cannot be read: %s', (_sub, argv) => {
      const home = home7(null);
      const c = chain7(home);
      r7expect(run7(tree7({ drop: 'deploy/measure-history.py' }), home, argv(c)).stderr)
        .toBe(refusalLine('code-unmeasured', 'deploy/measure-history.py is absent'));
    });
    r7it('CONTROL: under an unchanged copy of the tree, each row reaches the read it was built to fail', () => {
      const home = home7(null);
      const c = chain7(home);
      const tree = tree7();
      const want = ['input-invalid: census unreadable ENOENT', 'input-invalid: sourced unreadable ENOENT', 'input-invalid: census unreadable ENOENT',
        'input-invalid: census unreadable ENOENT', 'input-invalid: census unreadable ENOENT', 'store-unreadable: store-missing'];
      rows.forEach(([sub, argv], i) => r7expect(run7(tree, home, argv(c)).stderr, sub).toBe(`ccrc history-replay: ${want[i]}\n`));
    });
  });

  // ── open --template and open --draft ───────────────────────────────────────────────────────────────────────
  r7describe('W2-5a Task 7: open template and draft', () => {
    r7it('open --template prints a skeleton of both parts from OPEN_RECORD_V1: every fixed or default value, a placeholder elsewhere', () => {
      const r = run7(null, null, ['open', '--template']);
      r7expect(r.code, r.stderr).toBe(0);
      r7expect(r.stderr).toBe('');
      const t = JSON.parse(r.stdout);
      r7expect(r.stdout).toBe(r7Canon(t) + '\n');
      r7expect(t.kind).toBe(r7drv.TEMPLATE_KIND);
      const walk = (spec: R7, value: R7, at: string): void => {
        for (const [k, f] of Object.entries(spec) as Array<[string, R7]>) {
          const p = at === '' ? k : `${at}.${k}`;
          if (Object.hasOwn(f, 'value')) r7expect(value[k], p).toEqual(f.value);
          else if (f.fields) walk(f.fields, value[k], p);
          else if (f.type !== 'array' && !f.values) r7expect(value[k], p).toBe(`<${f.status} ${f.type}${f.nullable ? ' or null' : ''}>`);
        }
      };
      walk(r7gate.OPEN_RECORD_V1.draft, t.draft, '');
      walk(r7gate.OPEN_RECORD_V1.final, t.final, '');
      r7expect(t.draft.account).toBe('<operator string>');
      r7expect(t.final.part).toBe('final');
    });

    /** open --draft's argv over saved step 0a and pilot-source outputs: two nodes, one step 0a file bound to each. */
    const draftArgv = (s0: Saved, pilot: Saved, extra: string[] = []): string[] => ['open', '--draft',
      ...inp('step0a', s0), '--node-label', 'node-a', '--node-store-id', STORE_A, ...inp('step0a', s0), '--node-label', 'node-b', '--node-store-id', STORE_B,
      ...inp('pilot', pilot), '--account', 'up-a', '--arm-model', ARM, '--writer-model', OPUS, '--judge-model', OPUS, ...extra];

    r7it('open --draft prints part 1, validated, and its sha on stderr; each step 0a output bound to its node; gate_code measured', () => {
      const home = home7(null);
      const tree = tree7();
      const s0 = save7(step0a7(tree, home), 'step0a.json');
      const pilot = save7(pilot7(tree), 'pilot-source.json');
      const r = run7(tree, home, draftArgv(s0, pilot));
      r7expect(r.code, r.stderr).toBe(0);
      const rec = JSON.parse(r.stdout);
      r7expect(r.stdout).toBe(r7Canon(rec) + '\n');
      r7expect(r.stderr).toBe(`sha256 ${r7gate.recordSha256(rec)}\n`);
      r7expect(r7gate.validateOpenRecord(rec, { draft: null, predecessor: null, frozen: null })).toEqual({ ok: true });
      r7expect(rec.part).toBe('draft');
      r7expect(rec.supersedes).toBeNull();
      r7expect(rec.bootstrap.seed).toMatch(/^[0-9a-f]{64}$/);
      r7expect(rec.nodes).toEqual([{ label: 'node-a', store_id: STORE_A }, { label: 'node-b', store_id: STORE_B }]);
      r7expect(rec.step0a.map((s: R7) => [s.label, s.store_id])).toEqual([['node-a', STORE_A], ['node-b', STORE_B]]);
      r7expect(rec.gate_code).toEqual({ release_tag: STAMP, files: SHAS(tree) });
      r7expect(rec.pilot.seed).toBe(pilot.value.seed);
      r7expect(rec.pilot.tolerance).toBe(0.25);
      r7expect(rec.active_rule.text).toBe(r7drv.ACTIVE_RULE_TEXT);
      const again = JSON.parse(run7(tree, home, draftArgv(s0, pilot)).stdout);
      r7expect(again.bootstrap.seed, 'a fresh seed each run (W2-D18)').not.toBe(rec.bootstrap.seed);
    });

    r7it('buildDraft is deterministic with the seed and clock injected, and its record validates', () => {
      const home = home7(null);
      const a = draft7(R7_REPO, home);
      r7expect(r7Canon(draft7(R7_REPO, home))).toBe(r7Canon(a));
      r7expect(a.bootstrap.seed).toBe(SEED);
      r7expect(r7gate.validateOpenRecord(a, { draft: null, predecessor: null, frozen: null })).toEqual({ ok: true });
    });

    r7it('open --draft refuses a step 0a output whose flags_accepted does not name exactly the contract\'s flags (section 7 parity)', () => {
      const home = home7(null);
      const tree = tree7();
      const s = step0a7(tree, home);
      delete s.flags_accepted['--verbose'];
      s.flags_accepted['--extra-flag'] = true;
      const r = run7(tree, home, draftArgv(save7(s, 'step0a.json'), save7(pilot7(tree), 'pilot.json')));
      r7expect(r.stderr).toBe(refusalLine('input-invalid', 'step0a node-a flags-incomplete missing --verbose extra --extra-flag'));
      r7expect(r.stdout).toBe('');
    });

    r7it('a step 0a flag measured false is refused by the validator, for every node it binds, with no exception (W2-D25)', () => {
      const home = home7(null);
      const tree = tree7();
      const s = step0a7(tree, home);
      s.flags_accepted['--verbose'] = false;
      r7expect(run7(tree, home, draftArgv(save7(s, 'step0a.json'), save7(pilot7(tree), 'pilot.json'))).stderr)
        .toBe(refusalLine('record-invalid', 'step0a[0].flags_accepted.--verbose flag-rejected; step0a[1].flags_accepted.--verbose flag-rejected'));
    });

    r7it('the overrides file changes default fields only; the pilot-derived and the fixed, measured or operator fields are refused', () => {
      const home = home7(null);
      const tree = tree7();
      const s0 = save7(step0a7(tree, home), 'step0a.json');
      const pilot = save7(pilot7(tree), 'pilot.json');
      const over = (o: R7): string[] => ['--overrides', save7(o, 'overrides.json').path];
      const ok = run7(tree, home, draftArgv(s0, pilot, over({ window_plan: { planned_days: 21 }, rubric_id: 'v1-strict', pilot: { tolerance: 0.2 }, q18_settings: { power: [0.5, 0.8, 0.9] } })));
      r7expect(ok.code, ok.stderr).toBe(0);
      const rec = JSON.parse(ok.stdout);
      r7expect([rec.window_plan.planned_days, rec.rubric_id, rec.rubric_sha256, rec.pilot.tolerance, rec.q18_settings.power])
        .toEqual([21, 'v1-strict', r7gate.RUBRIC_SHA256['v1-strict'], 0.2, [0.5, 0.8, 0.9]]);
      for (const [o, detail] of [
        [{ k: 11 }, 'override k is fixed'],
        [{ labeller: { sha_min_prefix: 40 } }, 'override labeller.sha_min_prefix comes from the pilot-source output'],
        [{ quiz: { writer_input: 'leaf-span' } }, 'override quiz.writer_input comes from the pilot-source output'],
        [{ rubric_sha256: 'a'.repeat(64) }, 'override rubric_sha256 follows rubric_id'],
        [{ pilot: { seed: 'a'.repeat(64) } }, 'override pilot.seed is measured'],
        [{ nodes: [] }, 'override nodes is operator'],
        [{ q18_settings: { procedure: 'other' } }, 'override q18_settings.procedure is fixed'],
        [{ nope: 1 }, 'override nope is not a part 1 field'],
      ] as Array<[R7, string]>) {
        r7expect(run7(tree, home, draftArgv(s0, pilot, over(o))).stderr, detail).toBe(refusalLine('args-invalid', detail));
      }
    });

    r7it('a superseding draft keeps its predecessor\'s seed and names its sha, and validates against it', () => {
      const home = home7(null);
      const tree = tree7();
      const s0 = save7(step0a7(tree, home), 'step0a.json');
      const pilot = save7(pilot7(tree), 'pilot.json');
      const first = run7(tree, home, draftArgv(s0, pilot));
      const prior = saveText7(first.stdout, 'part1.json');
      const r = run7(tree, home, draftArgv(s0, pilot, inp('supersedes', prior)));
      r7expect(r.code, r.stderr).toBe(0);
      const rec = JSON.parse(r.stdout);
      r7expect(rec.bootstrap.seed).toBe(prior.value.bootstrap.seed);
      r7expect(rec.supersedes).toBe(prior.sha);
      r7expect(r7gate.validateOpenRecord(rec, { draft: null, predecessor: prior.value, frozen: null })).toEqual({ ok: true });
    });

    r7it('--step0a, --node-label and --node-store-id are given the same number of times', () => {
      const home = home7(null);
      const tree = tree7();
      const s0 = save7(step0a7(tree, home), 'step0a.json');
      const argv = draftArgv(s0, save7(pilot7(tree), 'pilot.json')).filter((t, i, a) => !(t === '--node-label' && a[i + 1] === 'node-b') && t !== 'node-b');
      r7expect(run7(tree, home, argv).stderr).toBe(refusalLine('args-invalid', '--step0a, --node-label and --node-store-id are given 2, 1 and 2 times'));
    });
  });

  // ── verify --registry ──────────────────────────────────────────────────────────────────────────────────────
  r7describe('W2-5a Task 7: verify registry', () => {
    /** HOME on node A with each family's registry generation planted as `plant` says. */
    function registryHome(plant: Record<string, string | 'dir' | null>): string {
      const home = home7(STORE_A);
      const reg = r7Paths(home).reg;
      r7fs.mkdirSync(reg, { recursive: true });
      for (const [id, v] of Object.entries(plant)) {
        const p = r7path.join(reg, `${id}.generation`);
        if (v === 'dir') r7fs.mkdirSync(p);
        else if (v !== null) r7fs.writeFileSync(p, v);
      }
      return home;
    }
    r7it('reports ok, registry-mismatch, registry-absent and unreadable, never one folded into another, and writes nothing (W2-D20, W2-D84)', () => {
      const home = registryHome({ 'a-t1': A_T1.generation, 'a-t2': `${A_T2.generation}\n`, 'a-c1': gen(399), 'a-c2': 'dir', 'a-d': null });
      const d = save7(draft7(R7_REPO, home), 'part1.json');
      const cA = save7(census7(STORE_A, FAMS_A), 'census-a.json');
      const before = snapshot7(home);
      const r = run7(null, home, ['verify', '--registry', ...inp('record', d), ...inp('census', cA)]);
      r7expect(r.code, r.stderr).toBe(0);
      r7expect(snapshot7(home), 'read-only: the HOME tree is byte-identical').toEqual(before);
      const out = JSON.parse(r.stdout);
      r7expect(r.stderr).toBe(`sha256 ${r7Sha(r.stdout)}\n`);
      r7expect(out).toEqual(verify7(d.sha, cA, { 'a-c1': 'registry-mismatch', 'a-c2': 'unreadable', 'a-d': 'registry-absent' }));
      const byId = Object.fromEntries(out.families.map((f: R7) => [f.ccrc_id, f.state]));
      r7expect(byId).toEqual({ 'a-t1': 'ok', 'a-t2': 'ok', 'a-c1': 'registry-mismatch', 'a-c2': 'unreadable', 'a-d': 'registry-absent' });
      r7expect(out.counts).toEqual({ ok: 2, 'registry-mismatch': 1, 'registry-absent': 1, unreadable: 1 });
    });
    r7it('registryStateOf keeps four answers apart: absent, unreadable, a value equal to the generation, and any other value', () => {
      r7expect(r7drv.registryStateOf({ state: 'absent' }, gen(1))).toBe('registry-absent');
      r7expect(r7drv.registryStateOf({ state: 'unreadable' }, gen(1))).toBe('unreadable');
      r7expect(r7drv.registryStateOf({ state: 'value', value: gen(1) }, gen(1))).toBe('ok');
      r7expect(r7drv.registryStateOf({ state: 'value', value: '' }, gen(1))).toBe('registry-mismatch');
    });
    r7it('refuses on a store the record does not name, and a census of another node\'s store', () => {
      const d = (home: string): Saved => save7(draft7(R7_REPO, home), 'part1.json');
      const other = home7(STORE_C);
      r7expect(run7(null, other, ['verify', '--registry', ...inp('record', d(other)), ...inp('census', save7(census7(STORE_C, FAMS_A)))]).stderr)
        .toBe(refusalLine('input-invalid', `store ${STORE_C} is not one of the record's nodes`));
      const a = home7(STORE_A);
      r7expect(run7(null, a, ['verify', '--registry', ...inp('record', d(a)), ...inp('census', save7(census7(STORE_B, FAMS_B)))]).stderr)
        .toBe(refusalLine('input-invalid', `census store-id ${STORE_B} is not this node's store ${STORE_A}`));
    });
  });

  // ── power ──────────────────────────────────────────────────────────────────────────────────────────────────
  r7describe('W2-5a Task 7: power', () => {
    const powerRun = (c: R7, census: Saved[] = [c.cA, c.cB], verify: Saved[] = [c.vA, c.vB]): ReturnType<typeof run7> =>
      run7(null, null, ['power', ...inp('record', c.d), ...census.flatMap((s) => inp('census', s)), ...verify.flatMap((s) => inp('verify', s))]);

    r7it('reads q18_settings: one q18Power call per power level at rho_headline and at 0, over the kept families, covered_days from lookback_days', () => {
      const c = chain7(home7(null));
      const r = powerRun(c);
      r7expect(r.code, r.stderr).toBe(0);
      r7expect(r.stderr).toBe(`sha256 ${r7Sha(r.stdout)}\n`);
      const out = JSON.parse(r.stdout);
      // The population: every active family but a-d (registry-absent), each with its census windows; ticks from T0 - 7 d.
      const kept = [A_T1, A_T2, A_C1, A_C2, B_T1, B_C1].map((f) => ({ key: keyOf(f), windows: SHAPE[f.ccrc_id]![0], covered_days: 7 }))
        .sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
      const s = c.draft.q18_settings;
      const want = s.power.flatMap((power: number) => [s.rho_headline, 0].map((rho) => {
        const q = r7gate.q18Power({ families: kept, plannedDays: 14, seedHex: SEED, rho, power, sims: 2, gridStep: 0.45, B: 10_000 }) as R7;
        return { power, rho, figure: q.figure, points: q.points };
      }));
      r7expect(out.figures).toEqual(want);
      r7expect([out.headline, out.at_power_80, out.at_rho_0]).toEqual([want[0].figure, want[2].figure, want[1].figure]);
      r7expect(out.n_f.per_family).toEqual(Object.fromEntries(kept.map((k) => [k.key, k.windows * 2])));
      r7expect(Object.keys(out.n_f.per_family)).not.toContain(keyOf(A_D));
      // §4's q18: per-node n_f too, each node's the sum over its kept families.
      const nfOf = (fs: Array<typeof A_T1>): number => fs.reduce((t, f) => t + SHAPE[f.ccrc_id]![0] * 2, 0);
      r7expect(out.n_f.per_node).toEqual({ [STORE_A]: nfOf([A_T1, A_T2, A_C1, A_C2]), [STORE_B]: nfOf([B_T1, B_C1]) });
      r7expect(out.coverage[STORE_A].covered_days).toBe(7);
      r7expect(out.pre_window_uptake.total).toEqual({ windows: 13, with_call: 5 });
      r7expect(out.pre_window_uptake.card_consumed_main_all_time).toEqual({ [STORE_A]: 3, [STORE_B]: 3 });
      r7expect(powerRun(c).stdout, 'the same inputs print the same bytes').toBe(r.stdout);
    });

    r7it('rhoHat: the one-way ANOVA estimate, hand-worked, and null below two clustered families', () => {
      r7expect(r7drv.rhoHat([{ windows: 2, with_call: 2 }, { windows: 2, with_call: 0 }])).toBe(1);
      r7expect(r7drv.rhoHat([{ windows: 2, with_call: 1 }, { windows: 2, with_call: 1 }])).toBe(-1);
      r7expect(r7drv.rhoHat([{ windows: 3, with_call: 1 }])).toBeNull();
      r7expect(r7drv.rhoHat([{ windows: 1, with_call: 1 }, { windows: 1, with_call: 0 }]), 'no within-family degree of freedom').toBeNull();
    });

    r7it('coveredDays: the look-back clipped to the tick coverage; null with no tick', () => {
      const c = (first: number | null, n = 10): R7 => ({ as_of_ms: T0, since_ms: T0 - 14 * DAY, ticks: { n, first_ts_ms: first, last_ts_ms: T0 - 1 } });
      r7expect(r7drv.coveredDays(c(T0 - 7 * DAY), 14)).toBe(7);
      r7expect(r7drv.coveredDays(c(T0 - 20 * DAY), 14)).toBe(14);
      r7expect(r7drv.coveredDays(c(null, 0), 14)).toBeNull();
    });

    r7it('refuses a census over another span than lookback_days, and one with no tick in its look-back', () => {
      const c = chain7(home7(null));
      const since = save7(census7(STORE_A, FAMS_A, { since: T0 - 13 * DAY }), 'census-a.json');
      const sinceVerify = save7(verify7(c.d.sha, since, { 'a-d': 'registry-absent' }));
      r7expect(powerRun(c, [since, c.cB], [sinceVerify, c.vB]).stderr)
        .toBe(refusalLine('input-invalid', `census ${STORE_A} since-mismatch: as_of - since is ${13 * DAY} ms, lookback_days is 14`));
      const none = save7(census7(STORE_A, FAMS_A, { nTicks: 0, ticksFirst: null }), 'census-a.json');
      r7expect(powerRun(c, [none, c.cB], [save7(verify7(c.d.sha, none)), c.vB]).stderr).toBe(refusalLine('input-invalid', `census ${STORE_A} no-tick-coverage`));
    });

    r7it('the census assembler checks nodes only: an unlisted store, a duplicate, a node missing, and each verify binding', () => {
      const c = chain7(home7(null));
      const cC = save7(census7(STORE_C, FAMS_B), 'census-c.json');
      r7expect(powerRun(c, [c.cA, c.cB, cC]).stderr).toBe(refusalLine('input-invalid', `census store-id-unlisted ${STORE_C}`));
      r7expect(powerRun(c, [c.cA, c.cA]).stderr).toBe(refusalLine('input-invalid', `census store-id-duplicate ${STORE_A}`));
      r7expect(powerRun(c, [c.cA], [c.vA]).stderr).toBe(refusalLine('input-invalid', 'census node-missing node-b'));
      r7expect(powerRun(c, [c.cA, c.cB], [c.vA]).stderr).toBe(refusalLine('input-invalid', 'verify node-missing node-b'));
      const rebound = save7({ ...c.vA.value, census_sha256: c.cB.sha });
      r7expect(powerRun(c, [c.cA, c.cB], [rebound, c.vB]).stderr).toBe(refusalLine('input-invalid', `verify census-mismatch ${STORE_A}`));
      const short = save7({ ...c.vA.value, families: c.vA.value.families.slice(1) });
      r7expect(powerRun(c, [c.cA, c.cB], [short, c.vB]).stderr).toBe(refusalLine('input-invalid', `verify families-mismatch ${STORE_A}`));
      const look = save7({ ...c.vA.value, lookback_ms: 1 });
      r7expect(powerRun(c, [c.cA, c.cB], [look, c.vB]).stderr).toBe(refusalLine('input-invalid', `verify lookback-mismatch ${STORE_A}`));
    });
  });

  // ── pilot-source and quiz-source (in-process, sourceQuiz injected) ─────────────────────────────────────────
  r7describe('W2-5a Task 7: pilot-source and quiz-source', () => {
    const PILOT_SEED = hex('pilot seed injected');
    const fakeSource = (calls: R7[], result: R7) => async (input: R7): Promise<R7> => { calls.push(input); return result; };

    r7it('pilot-source: preflighted against step 0a, its own seed, the pilot frozen list and its output, which part 1 accepts', async () => {
      const home = home7(STORE_A);
      const out = outDir();
      const s0 = save7(step0a7(R7_REPO, home), 'step0a.json');
      const usage = [entry7(PILOT_FAMILY, 31, [0, 0]), entry7(PILOT_FAMILY, 32, [0, 1])];
      const calls: R7[] = [];
      const { flags } = r7drv.parseArgs(['pilot-source', '--out', out, '--account', 'up-a', '--budget', '100000', '--writer-model', OPUS, ...inp('step0a', s0)]) as R7;
      const r = await inProcess(() => r7drv.pilotSourceCommand(flags as never, envOf(home) as never,
        { sourceQuiz: fakeSource(calls, { entries: usage, fidelity: [{ ...PILOT_FAMILY, boundary_uuid: gen(901) }], counts: { candidates: 7 } }), seed: () => PILOT_SEED } as never));
      r7expect(r.refusal).toBeNull();
      r7expect(r.code).toBe(0);
      r7expect(calls).toHaveLength(1);
      r7expect([calls[0]!.mode, calls[0]!.seedHex, calls[0]!.rs.storeId, Object.hasOwn(calls[0]!, 'families'), calls[0]!.writer.launch.accountId])
        .toEqual(['pilot', PILOT_SEED, STORE_A, false, 'up-a']);
      r7expect(calls[0]!.plan).toEqual({ n_fidelity: 5, n_usage: 5, caps: { family: 5, boundary: 3, kind_per_family: 2 } });
      r7expect(calls[0]!.exclude).toEqual({ pilotFamilies: [], assignment: [] });
      r7expect(printRuns(home), 'the writer handle preflighted with --version only: no writer spawn').toEqual([]);
      const frozenText = r7fs.readFileSync(r7path.join(out, r7drv.PILOT_FROZEN_FILE), 'utf8');
      r7expect(frozenText).toBe(r7drv.frozenListText('pilot', head7(), usage.map(strip7)));
      const bytes = r7fs.readFileSync(r7path.join(out, r7drv.PILOT_SOURCE_FILE));
      r7expect(r.stderr).toBe(`sha256 ${r7Sha(bytes)}\n`);
      const o = JSON.parse(bytes.toString('utf8'));
      r7expect(o).toMatchObject({ kind: r7drv.PILOT_SOURCE_KIND, v: 1, store_id: STORE_A, seed: PILOT_SEED, n_fidelity: 5, n_usage: 5,
        families: [PILOT_FAMILY], frozen_sha256: r7Sha(frozenText), writer_model: OPUS, code_shas: SHAS(R7_REPO), release_stamp: STAMP, budget: 100_000, spend: 0 });
      // The chain: part 1 built from this output validates (the validator ties pilot.used, code_shas and release_stamp to part 1).
      const s = step0a7(R7_REPO, home);
      const rec = r7drv.buildDraft({ nodes: [{ label: 'node-a', store_id: STORE_A }], step0a: [{ ...s, label: 'node-a', store_id: STORE_A }], pilot: o,
        account: 'up-a', models: { arm: ARM, writer: OPUS, judge: OPUS }, gateCode: { release_tag: STAMP, files: SHAS(R7_REPO) }, seedHex: SEED, nowMs: T0 });
      r7expect(r7gate.validateOpenRecord(rec, { draft: null, predecessor: null, frozen: null })).toEqual({ ok: true });
    });

    r7it('pilot-source refuses code-changed against step 0a, and an account other than step 0a\'s, before any writer spawn', async () => {
      const home = home7(STORE_A);
      const moved = step0a7(R7_REPO, home);
      moved.code_shas['deploy/measure-history.py'] = hex('another build');
      const calls: R7[] = [];
      const argv = (s0: Saved, account = 'up-a'): R7 => (r7drv.parseArgs(['pilot-source', '--out', outDir(), '--account', account, '--budget', '100000', '--writer-model', OPUS, ...inp('step0a', s0)]) as R7).flags;
      const deps = { sourceQuiz: fakeSource(calls, { entries: [], fidelity: [], counts: {} }), seed: () => PILOT_SEED };
      const r = await inProcess(() => r7drv.pilotSourceCommand(argv(save7(moved)) as never, envOf(home) as never, deps as never));
      r7expect(r.refusal).toEqual({ word: 'code-changed', detail: 'changed deploy/measure-history.py' });
      const other = await inProcess(() => r7drv.pilotSourceCommand(argv(save7(step0a7(R7_REPO, home)), 'gen-a') as never, envOf(home) as never, deps as never));
      r7expect(other.refusal).toEqual({ word: 'input-invalid', detail: 'step0a account up-a is not --account gen-a' });
      r7expect(calls).toEqual([]);
      r7expect(printRuns(home)).toEqual([]);
    });

    r7it('R10: a writer model that is not an exact Opus id refuses before prepareOut makes --out, so the refused run leaves no --out; CONTROL: an exact Opus id makes it', async () => {
      const home = home7(STORE_A);
      const s0 = save7(step0a7(R7_REPO, home), 'step0a.json');
      const calls: R7[] = [];
      const deps = { sourceQuiz: fakeSource(calls, { entries: [], fidelity: [], counts: {} }), seed: () => PILOT_SEED };
      const run = async (model: string): Promise<{ refusal: R7; made: boolean }> => {
        const out = outDir();
        const { flags } = r7drv.parseArgs(['pilot-source', '--out', out, '--account', 'up-a', '--budget', '100000', '--writer-model', model, ...inp('step0a', s0)]) as R7;
        const r = await inProcess(() => r7drv.pilotSourceCommand(flags as never, envOf(home) as never, deps as never));
        return { refusal: r.refusal, made: r7fs.existsSync(out) };
      };
      r7expect(await run('claude-other-9-1')).toEqual({ refusal: { word: 'args-invalid', detail: 'writer-model "claude-other-9-1" is not an exact Opus model id' }, made: false });
      r7expect(calls, 'nothing sourced').toEqual([]);
      r7expect(await run(OPUS), 'CONTROL: an exact Opus id passes, and prepareOut makes --out').toEqual({ refusal: null, made: true });
      r7expect(calls, 'CONTROL: the Opus run reached sourcing').toHaveLength(1);
      r7expect(printRuns(home), 'no writer spawn either way').toEqual([]);
    });

    const quizFlags = (c: R7, out: string): R7 => (r7drv.parseArgs(['quiz-source', '--out', out, ...inp('record', c.d),
      ...inp('census', c.cA), ...inp('census', c.cB), ...inp('verify', c.vA), ...inp('verify', c.vB)]) as R7).flags;

    r7it('quiz-source: the assignment from the census and verify inputs, control ids and pilot families excluded, sourced.json written', async () => {
      const home = home7(STORE_A);
      const c = chain7(home);
      const out = outDir();
      const calls: R7[] = [];
      const entries = [entry7(A_T1, 1, [K7(0), 0])];
      const r = await inProcess(() => r7drv.quizSourceCommand(quizFlags(c, out) as never, envOf(home) as never,
        { sourceQuiz: fakeSource(calls, { entries, fidelity: [], counts: { candidates: 3 } }) } as never));
      r7expect(r.refusal).toBeNull();
      r7expect(calls).toHaveLength(1);
      const input = calls[0]!;
      r7expect(input.exclude).toEqual({ pilotFamilies: [PILOT_FAMILY], assignment: c.assignment.list });
      r7expect((input.exclude.assignment as R7[]).filter((a) => a.arm === 'control').map((a) => a.ccrc_id)).toEqual(r7expect.arrayContaining(['a-c1', 'b-c1']));
      r7expect([input.mode, input.seedHex, input.rs.storeId, input.writer.launch.accountId]).toEqual(['quiz', SEED, STORE_A, 'up-a']);
      r7expect(input.plan).toEqual(c.draft.quiz);
      // R10 (C1): the census's kept list feeds the assignment only; sourceQuiz walks the store's own admitted families.
      r7expect(Object.hasOwn(input, 'families'), 'no family list: never assembled.kept (W2-D71, W2-D73)').toBe(false);
      r7expect((c.assembled.kept as R7[]).length, 'CONTROL: the census did make a kept list, which the assignment read').toBeGreaterThan(0);
      const bytes = r7fs.readFileSync(r7path.join(out, r7drv.SOURCED_FILE));
      r7expect(r.stderr).toBe(`sha256 ${r7Sha(bytes)}\n`);
      r7expect(JSON.parse(bytes.toString('utf8'))).toEqual(r7drv.sourcedReport({ recordSha256: c.d.sha, storeId: STORE_A,
        assignmentSha256: c.assignment.sha256, inputs: c.inputs, sourced: { entries, counts: { candidates: 3 } }, spend: 0 }));
      r7expect(c.assignment.list.map((a: R7) => a.ccrc_id), 'a-d was dropped by its registry state before the flip').not.toContain('a-d');
    });

    r7it('quiz-source is preflighted against part 1: tree-moved and claude-version-moved, before any writer spawn (W2-D56)', async () => {
      const home = home7(STORE_A);
      const c = chain7(home);
      const calls: R7[] = [];
      const deps = { sourceQuiz: fakeSource(calls, { entries: [], fidelity: [], counts: {} }) };
      const recorded = versionOf(home);
      r7fs.writeFileSync(r7path.join(home, STUB_STREAM), `{"type":"system","note":"another version"}\n` + r7fs.readFileSync(r7path.join(home, STUB_STREAM), 'utf8'));
      const v = await inProcess(() => r7drv.quizSourceCommand(quizFlags(c, outDir()) as never, envOf(home) as never, deps as never));
      r7expect(v.refusal).toEqual({ word: 'claude-version-moved', detail: `recorded ${recorded}, measured {"type":"system","note":"another version"}` });
      const home2 = home7(STORE_A);
      const c2 = chain7(home2);
      r7fs.writeFileSync(r7path.join(home2, '.ccrc', 'build.json'), JSON.stringify({ sha: 'fixture', ref: 'main', builtAt: '2026-10-22T00:00:00Z', dirty: false, version: 'v9.9.8' }));
      const t = await inProcess(() => r7drv.quizSourceCommand(quizFlags(c2, outDir()) as never, envOf(home2) as never, deps as never));
      r7expect(t.refusal).toEqual({ word: 'tree-moved', detail: `recorded ${STAMP}, measured v9.9.8` });
      r7expect(calls).toEqual([]);
      r7expect([...printRuns(home), ...printRuns(home2)]).toEqual([]);
    });

    // W2-D55's hand-offs: a sourceQuiz that asks the real writer handle twice, so the gate the subcommand built is what stops it.
    const writerItem7 = (n: number): R7 => {
      const e = strip7(entry7(A_T1, n, [0, 0]));
      const f = { text: e.fact_raw, rawLen: Buffer.byteLength(e.fact_raw) };
      return { ...e, leaf: f, pair: null, span: [f] };
    };
    const twoAsks7 = (calls: R7[], section: string) => async (input: R7): Promise<R7> => {
      calls.push(input);
      await input.writer.ask(section, writerItem7(1));
      await input.writer.ask(section, writerItem7(2));
      return { entries: [], fidelity: [], counts: {} };
    };
    const writerHome7 = (): string => {
      const home = home7(STORE_A);
      r7fs.writeFileSync(r7path.join(home, STUB_STREAM), w6Reply('QUESTION: Which commit did the fixture step record?'));
      return home;
    };

    r7it.skipIf(process.platform === 'darwin')('quiz-source hands part 1\'s pilot_budget and limits to the writer gate (W2-D55): a tight record budget stops the second writer batch, a low record threshold stops the writer at open', async () => {
      const run = async (draftOver: R7): Promise<{ refusal: R7; calls: number; runs: number }> => {
        const home = writerHome7();   // before chain7, so the draft's step 0a records this stub's version
        const c = chain7(home, draftOver);
        const calls: R7[] = [];
        const r = await inProcess(() => r7drv.quizSourceCommand(quizFlags(c, outDir()) as never, envOf(home) as never, { sourceQuiz: twoAsks7(calls, 'quiz') } as never));
        return { refusal: r.refusal, calls: calls.length, runs: printRuns(home).length };
      };
      r7expect(await run({}), 'CONTROL: under the record defaults both asks spawn').toEqual({ refusal: null, calls: 1, runs: 2 });
      const tight = await run({ pilot_budget: 1 });
      r7expect(tight.refusal).toMatchObject({ word: 'budget-exhausted' });
      r7expect(tight.runs, 'the first ask spent past the record budget; the second never spawned').toBe(1);
      const low = await run({ limits: { threshold_pct: 5 } });
      r7expect(low.refusal).toMatchObject({ word: 'limits-threshold' });
      r7expect([low.calls, low.runs], 'refused at open, before sourceQuiz and any writer spawn (the row reads five 10, under the default 70)').toEqual([0, 0]);
    }, 120_000);

    r7it.skipIf(process.platform === 'darwin')('pilot-source hands --budget to the writer gate (W2-D55): --budget 1 stops the second writer batch', async () => {
      const home = writerHome7();
      const s0 = save7(step0a7(R7_REPO, home), 'step0a.json');
      const { flags } = r7drv.parseArgs(['pilot-source', '--out', outDir(), '--account', 'up-a', '--budget', '1', '--writer-model', OPUS, ...inp('step0a', s0)]) as R7;
      const calls: R7[] = [];
      const r = await inProcess(() => r7drv.pilotSourceCommand(flags as never, envOf(home) as never, { sourceQuiz: twoAsks7(calls, 'pilot'), seed: () => PILOT_SEED } as never));
      r7expect(r.refusal).toMatchObject({ word: 'budget-exhausted' });
      r7expect([calls.length, printRuns(home).length]).toEqual([1, 1]);
    }, 120_000);

    r7it.skipIf(process.platform === 'darwin')('R7, W2-D68: a whole pilot-source run over a fixture store, the real sourceQuiz and the writer stub, leaves no B text anywhere under --out', async () => {
      const sb = w6SourceBox('ccrc-w2-5a-t7-walk-');
      const home = sb.box.home;
      node7(home);   // W2-4's up-a row (the roster pilot-source admits from), its stub, a limits row and a tagged stamp
      r7fs.writeFileSync(r7path.join(home, STUB_STREAM), w6Reply('QUESTION: Which command rebuilt the fixture package?'));
      const out = outDir();
      const s0 = save7(step0a7(R7_REPO, home), 'step0a.json');
      const { flags } = r7drv.parseArgs(['pilot-source', '--out', out, '--account', 'up-a', '--budget', '100000', '--writer-model', OPUS, ...inp('step0a', s0)]) as R7;
      // The real sourceQuiz; `top` keeps B's ancestor walk inside the fixture tree (Task 4's seam, no subcommand passes it).
      const r = await inProcess(() => r7drv.pilotSourceCommand(flags as never, envOf(home) as never,
        { sourceQuiz: (input: R7) => r7drv.sourceQuiz({ ...input, top: home } as never), seed: () => PILOT_SEED } as never));
      r7expect(r.refusal).toBeNull();
      r7expect(r.code).toBe(0);
      // CONTROL: B was built for the boundary (so its text existed in memory), and the run wrote what it writes.
      const rec = JSON.parse(r7fs.readFileSync(r7path.join(out, 'pilot', 'baseline.json'), 'utf8'));
      r7expect(rec.boundaries.map((b: R7) => b.state)).toEqual(['built']);
      r7expect(JSON.parse(r7fs.readFileSync(r7path.join(out, r7drv.PILOT_FROZEN_FILE), 'utf8')).entries.map((e: R7) => e.fact)).toEqual([sb.cmd]);
      r7expect(printRuns(home), 'one writer spawn, the stub').toHaveLength(1);
      // Task 4's walk over the whole --out: every file, read whole, holds nothing only B holds (the summary's sentinel).
      const walk = (dir: string): string[] => r7fs.readdirSync(dir, { withFileTypes: true })
        .flatMap((d) => (d.isDirectory() ? walk(r7path.join(dir, d.name)) : [r7path.join(dir, d.name)]));
      const files = walk(out);
      r7expect(files.length, 'CONTROL: the walk reads the run\'s files').toBeGreaterThan(3);
      for (const f of files) r7expect(r7fs.readFileSync(f, 'utf8').includes(sb.sentinel), f).toBe(false);
    }, 600_000);

    r7it('quiz-source refuses on a node the record does not name', async () => {
      const home = home7(STORE_C);
      const c = chain7(home);
      const r = await inProcess(() => r7drv.quizSourceCommand(quizFlags(c, outDir()) as never, envOf(home) as never, { sourceQuiz: async () => { throw new Error('never'); } } as never));
      r7expect(r.refusal).toEqual({ word: 'input-invalid', detail: `store ${STORE_C} is not one of the record's nodes` });
    });
  });

  // ── freeze ─────────────────────────────────────────────────────────────────────────────────────────────────
  r7describe('W2-5a Task 7: freeze', () => {
    const freezeRun = (c: R7, lists: Saved[], out = outDir()): ReturnType<typeof run7> & { out: string } =>
      ({ ...run7(null, null, ['freeze', '--out', out, ...inp('record', c.d), ...lists.flatMap((s) => inp('sourced', s))]), out });

    r7it('writes exactly W2-D73\'s bytes 0600, its sha on stderr, and the meta beside it with quiz-source\'s assignment sha', () => {
      const c = chain7(home7(null));
      const r = freezeRun(c, [c.sA, c.sB]);
      r7expect(r.code, r.stderr).toBe(0);
      r7expect(r.stdout).toBe('');
      const p = r7path.join(r.out, r7drv.FROZEN_FILE);
      const text = r7fs.readFileSync(p, 'utf8');
      r7expect(r7fs.statSync(p).mode & 0o777).toBe(0o600);
      const fields = r7drv.FROZEN_ENTRY_KEYS as string[];
      const entries = [...c.merged].map((e: R7) => Object.fromEntries(fields.map((k) => [k, e[k]]))).sort((x, y) => (x.qid < y.qid ? -1 : x.qid > y.qid ? 1 : 0));
      r7expect(text).toBe(r7Canon({ kind: 'ccrc-history-w2-quiz', version: 1, writer_model: OPUS, writer_prompt_sha256: r7gate.WRITER_PROMPT_SHA256,
        answer_protocol_sha256: r7gate.ANSWER_PROTOCOL_SHA256, labeller: { ...r7gate.LABELLER, sha_min_prefix: 7 }, entries }));
      r7expect(r.stderr).toBe(`sha256 ${r7Sha(text)}\n`);
      const meta = JSON.parse(r7fs.readFileSync(r7path.join(r.out, r7drv.QUIZ_META_FILE), 'utf8'));
      r7expect(meta).toMatchObject({ kind: r7drv.QUIZ_META_KIND, record_sha256: c.d.sha, frozen_sha256: r7Sha(text), assignment_sha256: c.assignment.sha256,
        n_questions: 5, n_families: 3, below_floor: false });
    });

    r7it('the same inputs give byte-identical output twice, in either order of the sourced lists', () => {
      const c = chain7(home7(null));
      const one = freezeRun(c, [c.sA, c.sB]);
      const two = freezeRun(c, [c.sB, c.sA]);
      r7expect(r7fs.readFileSync(r7path.join(two.out, r7drv.FROZEN_FILE))).toEqual(r7fs.readFileSync(r7path.join(one.out, r7drv.FROZEN_FILE)));
      r7expect(two.stderr).toBe(one.stderr);
    });

    r7it('the merge takes the lists in global rank order and cuts at quiz.target; a smaller list is below the floor', () => {
      const c = chain7(home7(null), { quiz: { target: 3, halt_floor: { questions: 4, families: 2 } } });
      const r = freezeRun(c, [c.sA, c.sB]);
      r7expect(r.code, r.stderr).toBe(0);
      const list = JSON.parse(r7fs.readFileSync(r7path.join(r.out, r7drv.FROZEN_FILE), 'utf8'));
      // ranks [K0,0] [K0,1] (a-t1), [K1,0] (b-t1) are the first three; [K1,1] (b-t1) and [K2,0] (a-t2) are cut. The
      // two nodes' lists interleave by key: the merge is the rank order, never a concatenation (R10).
      r7expect(list.entries.map((e: R7) => e.fact).sort()).toEqual(['abc0001', 'abc0002', 'abc0004']);
      const meta = JSON.parse(r7fs.readFileSync(r7path.join(r.out, r7drv.QUIZ_META_FILE), 'utf8'));
      r7expect([meta.n_questions, meta.n_families, meta.below_floor]).toEqual([3, 2, true]);
    });

    r7it('the meta reports short_of_min_families when the list meets quiz.target on fewer families than quiz.min_families, and freeze still writes it (R11); CONTROL: at min_families the flag is false', () => {
      // target 3 keeps a-t1's two entries and b-t1's first: the list meets the target on 2 families, at a halt floor of
      // 3 questions and 2 families, so below_floor is false and only min_families can call it short. (At the signed
      // defaults, target 100 over caps.family 5 needs 20 families; a target that small, or a raised caps.family, is what
      // lets a full list hold fewer.) chain7's own meta (3 families against the signed 20) is short too, and open
      // finalize's first case prints part 2 from it: nothing refuses on the flag.
      const floor = { questions: 3, families: 2 };
      const short = chain7(home7(null), { quiz: { target: 3, min_families: 3, halt_floor: floor } });
      const r = freezeRun(short, [short.sA, short.sB]);
      r7expect(r.code, r.stderr).toBe(0);   // a report, never a refusal (R11)
      const meta = JSON.parse(r7fs.readFileSync(r7path.join(r.out, r7drv.QUIZ_META_FILE), 'utf8'));
      r7expect([meta.n_questions, meta.n_families, meta.below_floor, meta.short_of_min_families]).toEqual([3, 2, false, true]);
      // CONTROL: the same list against min_families 2, its own family count, is not short (a `<=` reds here).
      const at = chain7(home7(null), { quiz: { target: 3, min_families: 2, halt_floor: floor } });
      const ctl = freezeRun(at, [at.sA, at.sB]);
      r7expect(ctl.code, ctl.stderr).toBe(0);
      const ctlMeta = JSON.parse(r7fs.readFileSync(r7path.join(ctl.out, r7drv.QUIZ_META_FILE), 'utf8'));
      r7expect([ctlMeta.n_questions, ctlMeta.n_families, ctlMeta.below_floor, ctlMeta.short_of_min_families], 'CONTROL: at min_families')
        .toEqual([3, 2, false, false]);
    });

    r7it('refuses a sourced list of another record, two lists whose assignments differ, a forged qid, and a duplicate rank', () => {
      const c = chain7(home7(null));
      const otherRecord = save7({ ...c.sA.value, record_sha256: hex('another draft') });
      r7expect(freezeRun(c, [otherRecord, c.sB]).stderr).toBe(refusalLine('input-invalid', `sourced record-mismatch ${STORE_A}`));
      const otherAssign = save7({ ...c.sB.value, assignment_sha256: hex('another assignment') });
      r7expect(freezeRun(c, [c.sA, otherAssign]).stderr).toBe(refusalLine('assignment-mismatch', `sourced lists disagree: ${c.assignment.sha256} and ${hex('another assignment')}`));
      const forged = save7({ ...c.sA.value, entries: [{ ...c.sA.value.entries[0], fact: 'abc9999' }, ...c.sA.value.entries.slice(1)] });
      r7expect(freezeRun(c, [forged, c.sB]).stderr).toBe(refusalLine('input-invalid', `sourced entry ${c.sA.value.entries[0].qid} qid-mismatch`));
      const dup = save7({ ...c.sB.value, entries: [{ ...c.sB.value.entries[0], rank: [K7(0), 0] }, c.sB.value.entries[1]] });
      r7expect(freezeRun(c, [c.sA, dup]).stderr).toBe(refusalLine('input-invalid', `sourced rank-duplicate ${K7(0)}:0`));
      // R10: a quiz entry's family rank is its order key, 64 lowercase hex; the old numeric family rank is refused.
      const numeric = save7({ ...c.sB.value, entries: [{ ...c.sB.value.entries[0], rank: [1, 0] }, c.sB.value.entries[1]] });
      r7expect(freezeRun(c, [c.sA, numeric]).stderr).toBe(refusalLine('input-invalid', 'sourced shape entry rank'));
    });

    r7it('refuses a run that lacks a named node\'s sourced list (W2-D71\'s population is the named nodes\' families); CONTROL: one list per named node freezes', () => {
      const c = chain7(home7(null));
      r7expect(freezeRun(c, [c.sA]).stderr).toBe(refusalLine('input-invalid', 'sourced node-missing node-b'));
      r7expect(freezeRun(c, [c.sB]).stderr).toBe(refusalLine('input-invalid', 'sourced node-missing node-a'));
      const both = freezeRun(c, [c.sA, c.sB]);
      r7expect(both.code, 'CONTROL: one list per named node freezes').toBe(0);
    });
  });

  // ── open --finalize ────────────────────────────────────────────────────────────────────────────────────────
  r7describe('W2-5a Task 7: open finalize', () => {
    r7it('prints part 2, validated against its draft and frozen list, with the assignment re-derived and the power figures copied', () => {
      const c = chain7(home7(null));
      const r = run7(null, null, finalizeArgv(c));
      r7expect(r.code, r.stderr).toBe(0);
      const rec = JSON.parse(r.stdout);
      r7expect(r.stderr).toBe(`sha256 ${r7gate.recordSha256(rec)}\n`);
      r7expect(r7gate.validateOpenRecord(rec, { draft: c.draft, predecessor: null, frozen: { families: c.frozen.families, n_questions: 5 } })).toEqual({ ok: true });
      r7expect(rec.supersedes).toBe(c.d.sha);
      r7expect(rec.assignment).toEqual(r7gate.assignArms(SEED, c.assembled.kept));
      r7expect(rec.assignment_sha256).toBe(c.assignment.sha256);
      r7expect(rec.registry_drops).toEqual([{ ...A_D, reason: 'registry-absent' }]);
      r7expect(rec.census).toEqual([{ store_id: STORE_A, census_ms: T0, census_sha256: c.cA.sha }, { store_id: STORE_B, census_ms: T0, census_sha256: c.cB.sha }]);
      r7expect(rec.q18).toEqual({ headline: c.power.value.headline, at_power_80: c.power.value.at_power_80, at_rho_0: c.power.value.at_rho_0,
        rho_hat: c.power.value.rho_hat, n_f: c.power.value.n_f, coverage: c.power.value.coverage, pre_window_uptake: c.power.value.pre_window_uptake,
        power_output_sha256: c.power.sha, decision: 'keep' });
      r7expect(rec.quiz).toMatchObject({ sha256: c.fz.sha, n_questions: 5, n_families: 3, families: c.frozen.families });
      r7expect([rec.window, rec.spend_budget, rec.amendments]).toEqual([{ start_ms: T0 + DAY, end_ms: T0 + 15 * DAY }, 30_000_000, []]);
      r7expect(r7Canon({ ...rec, finalized_ms: T0 })).toBe(r7Canon(c.final));
    });

    r7it('a census changed between quiz-source and open --finalize refuses assignment-mismatch (W2-D73)', () => {
      const c = chain7(home7(null));
      const moved = save7(census7(STORE_A, FAMS_A, { stale: 'a-t2' }), 'census-a.json');   // a-t2 leaves the active list
      const movedVerify = save7(verify7(c.d.sha, moved, { 'a-d': 'registry-absent' }));
      const r = run7(null, null, finalizeArgv(c, { census: [...inp('census', moved), ...inp('census', c.cB)], verify: [...inp('verify', movedVerify), ...inp('verify', c.vB)] }));
      const again = r7drv.deriveAssignment(SEED, r7drv.assembleCensus(c.draft, [moved, c.cB].map(loaded), [movedVerify, c.vB].map(loaded))) as R7;
      r7expect(r.stderr).toBe(refusalLine('assignment-mismatch', `quiz-source derived ${c.assignment.sha256}, the census and verify inputs give ${again.sha256}`));
    });

    r7it('refuses a power output of another record or other inputs, a frozen list other than freeze\'s, a below-floor quiz and a bogus decision', () => {
      const c = chain7(home7(null));
      const other = save7({ ...c.power.value, record_sha256: hex('another draft') });
      r7expect(run7(null, null, finalizeArgv(c, { power: inp('power', other) })).stderr).toBe(refusalLine('input-invalid', 'power record-mismatch'));
      const inputs = save7({ ...c.power.value, inputs: c.power.value.inputs.slice(1) });
      r7expect(run7(null, null, finalizeArgv(c, { power: inp('power', inputs) })).stderr).toBe(refusalLine('input-invalid', 'power inputs-mismatch'));
      const edited = saveText7(r7fs.readFileSync(c.fz.path, 'utf8').replace('fixture step 1', 'fixture step 7'), 'frozen.json');
      r7expect(run7(null, null, finalizeArgv(c, { frozen: inp('frozen', edited) })).stderr)
        .toBe(refusalLine('quiz-sha-mismatch', `quiz-meta names ${c.fz.sha}, the frozen list is ${edited.sha}`));
      const below = save7({ ...c.meta.value, below_floor: true });
      r7expect(run7(null, null, finalizeArgv(c, { 'quiz-meta': inp('quiz-meta', below) })).stderr)
        .toBe(refusalLine('input-invalid', 'quiz-meta below-floor: a ruling to proceed lowers quiz.halt_floor in a superseding draft'));
      r7expect(run7(null, null, finalizeArgv(c, { rest: ['--spend-budget', '1', '--window-start', String(T0 + DAY), '--window-end', String(T0 + 15 * DAY), '--q18-decision', 'maybe'] })).stderr)
        .toBe(refusalLine('args-invalid', 'q18-decision "maybe" is not one of keep, lengthen, add-nodes'));
    });

    r7it('a window shorter than planned_days is refused by the validator (W2-D25)', () => {
      const c = chain7(home7(null));
      const r = run7(null, null, finalizeArgv(c, { rest: ['--spend-budget', '1', '--window-start', String(T0 + DAY), '--window-end', String(T0 + 14 * DAY), '--q18-decision', 'keep'] }));
      r7expect(r.stderr).toBe(refusalLine('record-invalid', 'window window-length'));
    });
  });

  // ── verify --section ab ────────────────────────────────────────────────────────────────────────────────────
  r7describe('W2-5a Task 7: verify section ab', () => {
    /** Node A after the window-start acts: each control file `<generation>\n`, as the verb writes it (W2-D28), `plant`
     *  overriding one, and seen_ms as `seen` (null: no row). */
    function abHome(plant: Record<string, string | 'dir' | null> = {}, seen: string | null = String(Date.now() + 60_000)): { home: string; c: R7 } {
      const home = home7(STORE_A, seen === null ? [] : [[R7_KEYS.seen, seen]]);
      const c = chain7(home);
      const dir = r7Paths(home).recallOffDir;
      r7fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const want: Record<string, string | 'dir' | null> = {};
      for (const a of c.final.assignment as R7[]) if (a.store_id === STORE_A && a.arm === 'control') want[a.ccrc_id] = `${a.generation}\n`;
      for (const [id, v] of Object.entries({ ...want, ...plant })) {
        if (v === 'dir') r7fs.mkdirSync(r7path.join(dir, id));
        else if (v !== null) r7fs.writeFileSync(r7path.join(dir, id), v, { mode: 0o600 });
      }
      return { home, c };
    }
    const abRun = (home: string, c: R7): ReturnType<typeof run7> => run7(null, home, ['verify', '--section', 'ab', ...inp('record', c.f), ...inp('part1', c.d), ...inp('frozen', c.fz)]);
    const states = (r: ReturnType<typeof run7>): Record<string, string> => Object.fromEntries(JSON.parse(r.stdout).families.map((f: R7) => [f.ccrc_id, f.state]));

    r7it('every control file holds its generation, no treatment file names its own, and seen_ms follows the newest write: ok', () => {
      const { home, c } = abHome();
      const before = snapshot7(home);
      const r = abRun(home, c);
      r7expect(r.code, r.stderr).toBe(0);
      r7expect(snapshot7(home), 'read-only').toEqual(before);
      r7expect(r.stderr).toBe(`sha256 ${r7Sha(r.stdout)}\n`);
      const out = JSON.parse(r.stdout);
      r7expect(states(r)).toEqual({ 'a-t1': 'ok', 'a-t2': 'ok', 'a-c1': 'ok', 'a-c2': 'ok' });
      r7expect([out.seen_after_write, out.ok, out.newest_write.state]).toEqual([true, true, 'value']);
    });

    r7it.each([
      ['a control file absent', { 'a-c1': null }, 'a-c1', 'control-absent'],
      ['a control file naming another generation', { 'a-c1': `${gen(399)}\n` }, 'a-c1', 'control-mismatch'],
      ['a control file that is a directory', { 'a-c2': 'dir' }, 'a-c2', 'unreadable'],
      ['a treatment file naming its own generation', { 'a-t1': `${A_T1.generation}\n` }, 'a-t1', 'treatment-named'],
    ] as Array<[string, Record<string, string | 'dir' | null>, string, string]>)('%s is reported as itself, and ok is false', (_name, plant, id, state) => {
      const { home, c } = abHome(plant);
      const r = abRun(home, c);
      r7expect(r.code, r.stderr).toBe(0);
      r7expect(states(r)[id]).toBe(state);
      r7expect(JSON.parse(r.stdout).ok).toBe(false);
    });

    r7it('CONTROL: a treatment file naming another generation is ok, and a control file without its newline is ok', () => {
      const { home, c } = abHome({ 'a-t2': `${gen(299)}\n`, 'a-c2': A_C2.generation });
      r7expect(states(abRun(home, c))).toEqual({ 'a-t1': 'ok', 'a-t2': 'ok', 'a-c1': 'ok', 'a-c2': 'ok' });
    });

    r7it('seen_ms before the newest write, or no seen_ms at all, is reported and ok is false', () => {
      for (const seen of ['1', null]) {
        const { home, c } = abHome({}, seen);
        const out = JSON.parse(abRun(home, c).stdout);
        r7expect([out.seen_ms, out.seen_after_write, out.ok], String(seen)).toEqual([seen === null ? null : 1, false, false]);
      }
    });

    r7it('refuses on a store the record does not name (W2-D84)', () => {
      const home = home7(STORE_C);
      const c = chain7(home);
      r7expect(abRun(home, c).stderr).toBe(refusalLine('input-invalid', `store ${STORE_C} is not one of the record's nodes`));
    });

    r7it('abStateOf, function level: the five answers', () => {
      r7expect(r7drv.abStateOf('control', gen(1), { state: 'value', value: `${gen(1)}\n` })).toBe('ok');
      r7expect(r7drv.abStateOf('control', gen(1), { state: 'absent' })).toBe('control-absent');
      r7expect(r7drv.abStateOf('control', gen(1), { state: 'value', value: '' })).toBe('control-mismatch');
      r7expect(r7drv.abStateOf('treatment', gen(1), { state: 'value', value: gen(1) })).toBe('treatment-named');
      r7expect(r7drv.abStateOf('treatment', gen(1), { state: 'unreadable' })).toBe('unreadable');
      r7expect(r7drv.abStateOf('treatment', gen(1), { state: 'absent' })).toBe('ok');
    });
  });
});
```

- [ ] **Step 4: Run them and see them fail.** From the repository root, in the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-5a Task 7|FLAG_SPECS declares exactly|three box-mode spawns, one per taught spelling|names recall-off on exactly two code lines|imports exactly its fourteen modules')
```

The filter selects this task's describe, W2-4 Task 1's re-pinned FLAG_SPECS case, W2-4 Task 9's case that holds the re-pinned registration line, titled `three box-mode spawns, one per taught spelling, and a denial …` (about :4727 at cd622b2f6), W2-4 Task 7's re-pinned recall-off case and Task 1's import pin. Expected RED (predicted, written before the code):
- The re-pinned FLAG_SPECS case: `expected { out: 'string', …(6) } to deeply equal { out: 'string', …(48) }`.
- The probe case: `expected [ 'step0a', 'probe' ] to deeply equal [ 'step0a', 'probe', …(6) ]`.
- The recall-off case: one `recallOffPath(` code line where two are expected; the import pin: store.mjs and sweep.mjs bring in fewer names than `EXACT_NAMES` now pins.
- Every `r7` case that runs a new subcommand: `args-invalid: unknown subcommand "power"` (and so on) in place of its expected line.
- Every case that calls a new export: `TypeError: r7drv.contractFlags is not a function` (and the like).
- The step0a row of the allow-list case: exit 2 with `args-invalid: unknown flag "--record"`, not `--record is not a step0a flag`.
- The `flags_accepted` parity rows fail at `contractFlags`.
- `the HOME tree is byte-identical` cannot fail before the code: it never runs. It is a pin, measured by the mutants in Step 9.

- [ ] **Step 5: Extend the grammar.** In `deploy/history-replay.mjs`:

(a) Replace `/** @typedef {'string' | 'int' | 'bool'} FlagKind */` with `/** @typedef {'string' | 'int' | 'bool' | 'list'} FlagKind */`, and `/** @typedef {Record<string, string | number | boolean>} Flags */` with `/** @typedef {Record<string, string | number | boolean | string[]>} Flags */`.

(b) In `FLAG_SPECS`, directly after the line `  'settings-mode': 'string',`, insert:

```js
  // W2-5a Task 7 (W2-D25, W2-D73, W2-D84, W2-D21): the record subcommands' flags. A `list` flag repeats, one value per
  // node; its `-sha256` partner repeats with it and is paired by position (pairedInputs).
  step0a: 'list', 'step0a-sha256': 'list', 'node-label': 'list', 'node-store-id': 'list',
  pilot: 'string', 'pilot-sha256': 'string', overrides: 'string',
  record: 'string', 'record-sha256': 'string', supersedes: 'string', 'supersedes-sha256': 'string',
  part1: 'string', 'part1-sha256': 'string', 'prior-final': 'string', 'prior-final-sha256': 'string',
  census: 'list', 'census-sha256': 'list', verify: 'list', 'verify-sha256': 'list', sourced: 'list', 'sourced-sha256': 'list',
  frozen: 'string', 'frozen-sha256': 'string', 'quiz-meta': 'string', 'quiz-meta-sha256': 'string',
  power: 'string', 'power-sha256': 'string', 'pilot-result': 'string', 'pilot-result-sha256': 'string',
  'sha-min-prefix': 'int', 'writer-input': 'string', 'n-fidelity': 'int', 'n-usage': 'int',
  'spend-budget': 'int', 'window-start': 'int', 'window-end': 'int', 'q18-decision': 'string',
  draft: 'bool', finalize: 'bool', template: 'bool', registry: 'bool', section: 'string',
```

(c) In `parseArgs`, replace these two lines:

```js
    if (Object.hasOwn(flags, name)) refuse('args-invalid', `repeated flag --${name}`);
    const kind = specs[name];
```

with:

```js
    const kind = specs[name];
    if (kind !== 'list' && Object.hasOwn(flags, name)) refuse('args-invalid', `repeated flag --${name}`);
```

Then replace:

```js
    i += 1;
    if (kind === 'int') {
```

with:

```js
    i += 1;
    if (kind === 'list') {   // W2-5a Task 7: every value, in argv order
      flags[name] = [...(/** @type {string[]} */ (flags[name] ?? [])), value];
      continue;
    }
    if (kind === 'int') {
```

Also extend parseArgs' doc comment sentence `` `<sub> [--flag value | --bool]...`: the subcommand first, then flags, each at most once. `` to read `` `<sub> [--flag value | --bool]...`: the subcommand first, then flags, each at most once but a `list` flag, whose values are kept in order. ``

(d) In `step0aCommand`, insert as its first line, before the line that begins `  if (typeof env.HOME !== 'string'`:

```js
  // W2-5a Task 7: the driver's flags now include many step 0a never reads; one given is refused, never ignored (as the probe's).
  for (const k of Object.keys(flags)) if (!STEP0A_REQUIRED.includes(k) && k !== 'settings-mode') refuse('args-invalid', `--${k} is not a step0a flag`);
```

- [ ] **Step 6: Extend the import block.** Add each name to Task 1's EXISTING statement for its module, names in code-unit order, and never add a statement (R3); the header sentence is Task 1's and already names every module:
- `../ccd/history/lib.mjs`: `CONTROL_FILE_MAX`, `RECALL_OFF_META`, `idOk` and `recallOffStatusOf` (`UUID_RE`, `historyPaths` and `recallOffPath` are there already).
- `../ccd/history/store.mjs`: `readBounded`.
- `../ccd/history/sweep.mjs`: `readRegPresence`. Never its `recallOffPresence`, under any name (R6).
- `./history-gate.mjs`: `LABELLER`, `OPEN_RECORD_V1`, `RUBRIC_SHA256`, `SHA_MIN_PREFIXES`, `activeFamilies`, `assignArms`, `assignmentSha256`, `buildWindows`, `checkGateCode`, `expectedWindows`, `q18Power`, `recordSha256`, `validateOpenRecord` and `windowTotals` (the others this task reads are there already).

Step 2 already moved Task 1's `EXACT_NAMES` entries for store.mjs and sweep.mjs. Check from the repository root:

```bash
node --no-warnings --input-type=module -e "await import('./deploy/history-replay.mjs'); console.log('links')"
grep -c "recallOffPresence" deploy/history-replay.mjs
grep -c '^import ' deploy/history-replay.mjs
```

Expected: `links`; then the count of the driver's own `recallOffPresence` lines, unchanged by this step (no import names it); then `14`, Task 1's statements.

- [ ] **Step 7: Write the section.** In `deploy/history-replay.mjs`, directly above the comment line `// The entry guard stays the LAST block of this file` and after Task 6's section, insert:

```js
// ── W2-5a Task 7: the record subcommands (W2-D84's first half, W2-D24, W2-D73, W2-D21, W2-D19, W2-D20, W2-D25; D-5773) ──
// The operator's acts before window start (W2 decisions §4 and §5, acts 9 to 19), one subcommand each:
//   pilot-source         writer spawns before part 1, under its own --budget and LIMITS_DEFAULTS, preflighted against the
//                        one step 0a output it is given (W2-D56); its own crypto seed (W2-D71); `<out>/pilot/frozen.json`
//                        and `<out>/pilot-source.json`, the values part 1's pilot section copies (W2-D73, W2-D76);
//   open --template      a skeleton of both parts from the gate's OPEN_RECORD_V1 (W2-D25);
//   open --draft         each node's step 0a output bound to its node, the overrides on default fields only, the seed
//                        (W2-D18), gate_code measured, part 1 validated and printed (W2-D25);
//   verify --registry    one node's active families against their registry generations (W2-D20, D-5773);
//   power                Q18 over every node's census and verify outputs: one q18Power call per power level at
//                        rho_headline and at 0, covered_days from lookback_days (W2-D21, amended 2026-10-20);
//   quiz-source          writer spawns after part 1, under part 1's pilot_budget, limits, account and models, preflighted
//                        against part 1; the assignment derived from the census and verify inputs (W2-D19, W2-D71, W2-D77);
//   freeze               one sourced list per named node, merged in global rank order, cut at quiz.target, written as
//                        W2-D73's exact bytes, with quiz-source's assignment_sha256 in the meta beside it;
//   open --finalize      the assignment re-derived from the same inputs (assignment-mismatch), part 2 printed (W2-D73);
//   verify --section ab  one node's control and treatment files, and the presence record's seen_ms (W2-D84).
// W2-D24: every subcommand that takes --record re-checks the four gate_code files through codeShas() (recheckCode) right
// after the record validates, before any other input is read and before any spawn. None declares --allow-code-change:
// each runs before window start, where W2-D6's remedy for a code change is a re-pilot and a superseding draft, and
// neither the record nor the frozen list has a place for a stamp.
// Every input's sha256 is checked before its bytes are parsed, and a path inside a git tree is refused (W2-D25, as
// loadStep0a does). A record is validated with the context the validator requires: --supersedes names the record it
// supersedes, --part1 a final's draft, --frozen a final's frozen list.
// The record and every report print as canonical JSON and one newline on stdout, `sha256 <hex>` of those bytes on stderr
// (open, power, verify); a subcommand that writes under --out prints only that file's sha on stderr (D-5983).
// verify reads, never writes: the registry through sweep.mjs's readRegPresence, a presence file's content as W2-D84
// says, through historyPaths, recallOffPath and store.mjs's readBounded (controlFileOf; the driver imports no
// recallOffPresence, R6), the presence directory's mtime as the newest write (the writer renames into it, W2-D28), and
// seen_ms from the store's meta through lib's recallOffStatusOf, status's own reader.
// Every subcommand that reads this node's store opens it once, through Task 1's openReplayStore, and passes it down
// (R3); the sourcing subcommands open the question writer (Task 6's openWriter, which preflights) and hand both to
// Task 6's sourceQuiz.

export const PILOT_SOURCE_KIND = 'ccrc-history-w2-pilot-source';
export const PILOT_SOURCE_FILE = 'pilot-source.json';
/** Where Task 6's writeFrozenList puts each section's list. */
export const PILOT_FROZEN_FILE = `pilot/${FROZEN_LIST_FILE}`;
export const SOURCED_KIND = 'ccrc-history-w2-quiz-sourced';
export const SOURCED_FILE = 'quiz/sourced.json';
export const FROZEN_FILE = `quiz/${FROZEN_LIST_FILE}`;
export const QUIZ_META_KIND = 'ccrc-history-w2-quiz-meta';
export const QUIZ_META_FILE = 'quiz/frozen.meta.json';
export const VERIFY_REGISTRY_KIND = 'ccrc-history-w2-verify-registry';
export const VERIFY_AB_KIND = 'ccrc-history-w2-verify-ab';
export const POWER_KIND = 'ccrc-history-w2-power';
/** The pilot's result as open --finalize reads it; W2-5b's pilot writes it. */
export const PILOT_RESULT_KIND = 'ccrc-history-w2-pilot-result';
export const TEMPLATE_KIND = 'ccrc-history-w2-open-template';
/** verify --registry's answers (W2-D20): `ok`, and the gate's three drop reasons, which its validator holds in a
 *  module-private list; a parity case holds the two equal. */
export const REGISTRY_STATES = Object.freeze(['ok', 'registry-mismatch', 'registry-absent', 'unreadable']);
/** verify --section ab's answers per family (W2-D84). */
export const AB_STATES = Object.freeze(['ok', 'control-absent', 'control-mismatch', 'treatment-named', 'unreadable']);
/** The operator's Q18 decision (W2 decisions §5 act 12): keep the window, lengthen it, or name more nodes. */
export const Q18_DECISIONS = Object.freeze(['keep', 'lengthen', 'add-nodes']);
/** Which q18Power call each of part 2's q18 figures reads (W2-D21, D-5791). The gate's own Q18_FIGURE_POWER is
 *  module-private, so the two levels are spelled here once more, held equal to it by a parity case. */
export const Q18_FIGURES = Object.freeze({
  headline: Object.freeze({ power: 0.5, rho: 'headline' }),
  at_power_80: Object.freeze({ power: 0.8, rho: 'headline' }),
  at_rho_0: Object.freeze({ power: 0.5, rho: 'zero' }),
});
/** active_rule.text's default: W2-D20's rule in words (the schema gives the field no value). */
export const ACTIVE_RULE_TEXT = 'W2-D20: a family (store_id, ccrc_id, generation) is active iff its merged_into is null and its generation '
  + 'is a UUID, it is its id\'s newest unmerged family (first_seen_ms DESC, then session_pk DESC), and a main transcript of one '
  + 'of its confirmed epochs has an entry with ts_ms in [T0 - lookback_ms, T0), T0 being its node\'s census instant; a legacy '
  + 'family (an empty generation) is excluded, fixed (D-5773)';

const DRAFT_SPEC = OPEN_RECORD_V1.draft;
const Q18_DAY_MS = 86_400_000;
const INPUT_WORDS = Object.freeze({ sha: 'input-sha-mismatch', invalid: 'input-invalid' });
const RECORD_WORDS = Object.freeze({ sha: 'record-sha-mismatch', invalid: 'record-invalid' });
/** Part 1 fields that come from the pilot-source output (the validator ties them to what the pilot used, W2-D71): an
 *  override naming one is refused. rubric_sha256 is refused too: it follows rubric_id (buildDraft). */
const PILOT_DERIVED = Object.freeze(['labeller.sha_min_prefix', 'quiz.writer_input', 'quiz.baseline_files', 'pilot.n_fidelity', 'pilot.n_usage']);
const DRAFT_INPUT = Object.freeze(['record', 'record-sha256']);
const PRED_INPUT = Object.freeze(['supersedes', 'supersedes-sha256']);
const NODE_INPUTS = Object.freeze(['census', 'census-sha256', 'verify', 'verify-sha256']);
/** Each subcommand form's flags: a flag outside both lists is refused, a required one missing is refused. */
const SUBCOMMAND_FLAGS = Object.freeze({
  'pilot-source': { required: ['out', 'account', 'budget', 'writer-model', 'step0a', 'step0a-sha256'], optional: ['sha-min-prefix', 'writer-input', 'n-fidelity', 'n-usage'] },
  'quiz-source': { required: ['out', ...DRAFT_INPUT, ...NODE_INPUTS], optional: [...PRED_INPUT] },
  freeze: { required: ['out', ...DRAFT_INPUT, 'sourced', 'sourced-sha256'], optional: [...PRED_INPUT] },
  power: { required: [...DRAFT_INPUT, ...NODE_INPUTS], optional: [...PRED_INPUT] },
  'open --template': { required: ['template'], optional: [] },
  'open --draft': { required: ['draft', 'step0a', 'step0a-sha256', 'node-label', 'node-store-id', 'pilot', 'pilot-sha256', 'account', 'arm-model', 'writer-model', 'judge-model'],
    optional: ['overrides', ...PRED_INPUT] },
  'open --finalize': { required: ['finalize', ...DRAFT_INPUT, ...NODE_INPUTS, 'power', 'power-sha256', 'frozen', 'frozen-sha256', 'quiz-meta', 'quiz-meta-sha256',
    'pilot-result', 'pilot-result-sha256', 'spend-budget', 'window-start', 'window-end', 'q18-decision'], optional: [...PRED_INPUT, 'prior-final', 'prior-final-sha256'] },
  'verify --registry': { required: ['registry', ...DRAFT_INPUT, 'census', 'census-sha256'], optional: [...PRED_INPUT] },
  'verify --section ab': { required: ['section', ...DRAFT_INPUT, 'part1', 'part1-sha256', 'frozen', 'frozen-sha256'], optional: [...PRED_INPUT] },
});

const copyJson = (v) => JSON.parse(JSON.stringify(v));
/** Families in familyKey order, by code unit: Task 5's familyKeyOf and cmpUnit, never a second key helper (W2-D12, R3).
 *  Seeds come from Task 5's drawSeedHex and the halt floor from Task 5's quizFloor, never a copy here. */
const byFamilyKey = (a, b) => cmpUnit(familyKeyOf(a), familyKeyOf(b));

/** Unknown flags first, then required ones, then each sha flag given with its file flag and only with it. */
function checkFlags(form, flags) {
  const spec = SUBCOMMAND_FLAGS[form];
  const known = new Set([...spec.required, ...spec.optional]);
  for (const k of Object.keys(flags)) if (!known.has(k)) refuse('args-invalid', `--${k} is not a ${form} flag`);
  for (const k of spec.required) if (flags[k] === undefined) refuse('args-invalid', `${k}-required`);
  for (const k of known) {
    if (!k.endsWith('-sha256')) continue;
    const file = k.slice(0, -'-sha256'.length);
    if ((flags[k] === undefined) !== (flags[file] === undefined)) refuse('args-invalid', `--${file} and --${k} go together`);
  }
}

/** `--<name>` and `--<name>-sha256`, paired by position. */
function pairedInputs(flags, name) {
  const asList = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
  const paths = asList(flags[name]);
  const shas = asList(flags[`${name}-sha256`]);
  if (paths.length !== shas.length) refuse('args-invalid', `--${name} given ${paths.length} times, --${name}-sha256 ${shas.length}`);
  return paths.map((p, i) => [p, shas[i]]);
}

/** One JSON input: outside any git tree, its bytes' sha256 checked BEFORE they are parsed (W2-D25, W2-D59), as loadStep0a
 *  checks step 0a's. `words` names the two refusals (a record's, a frozen list's or any other input's).
 *  @param {string} label  @param {string} p  @param {string} sha256
 *  @returns {{path: string, sha256: string, value: any}} */
export function loadInput(label, p, sha256, words = INPUT_WORDS, cap = OUT_JSON_CAP) {
  if (typeof sha256 !== 'string' || !SHA256_RE.test(sha256)) refuse('args-invalid', `--${label}-sha256 is not 64 lowercase hex`);
  if (typeof p !== 'string' || p === '') refuse('args-invalid', `--${label} names no path`);
  const abs = path.resolve(p);
  const g = insideGitTree(path.dirname(abs));
  if (g.state === 'inside') refuse(words.invalid, `${label} in-git-tree ${g.at}`);
  if (g.state === 'unmeasured') refuse(words.invalid, `${label} git-unmeasured ${g.at} ${g.code}`);
  const read = readPlain(abs, cap);
  if (read.state === 'absent') refuse(words.invalid, `${label} unreadable ENOENT`);
  if (read.state === 'bad') refuse(words.invalid, read.why === 'unreadable' ? `${label} unreadable ${read.code}` : `${label} ${read.why}`);
  const got = sha256Hex(read.bytes);
  if (got !== sha256) refuse(words.sha, `${label}: expected ${sha256}, measured ${got}`);
  let value;
  try {
    value = JSON.parse(read.bytes.toString('utf8'));
  } catch {
    refuse(words.invalid, `${label} not-json`);
  }
  return { path: abs, sha256: got, value };
}
/** Every `--<name>` input, in argv order. A census can be large (raw rows over every family), so it reads to OUT_STREAM_CAP. */
function loadInputs(flags, name, cap = OUT_JSON_CAP) {
  return pairedInputs(flags, name).map(([p, h]) => loadInput(name, p, h, INPUT_WORDS, cap));
}

/** The quiz's frozen list (W2-D73) through Task 6's one reader, loadFrozenList (its sha checked before a byte is parsed,
 *  quiz-sha-mismatch; its bytes the canonical list their own fields give, input-invalid), after loadInput's git-tree
 *  rule (W2-D25); and its families. */
function loadFrozen(p, sha256) {
  if (typeof p !== 'string' || p === '') refuse('args-invalid', '--frozen names no path');
  const g = insideGitTree(path.dirname(path.resolve(p)));
  if (g.state === 'inside') refuse('input-invalid', `frozen in-git-tree ${g.at}`);
  if (g.state === 'unmeasured') refuse('input-invalid', `frozen git-unmeasured ${g.at} ${g.code}`);
  const list = loadFrozenList(p, sha256, 'quiz');
  return { sha256, list, families: familiesOf(list.entries) };
}

/** `--record` as `part`, validated with the context the validator requires (W2-D25, amended 2026-10-19): a draft that
 *  supersedes another is read only beside it (--supersedes); a final beside its draft (--part1) and its frozen list
 *  (--frozen, whose sha must be the record's quiz.sha256) and, when it supersedes a final, that final (--supersedes). */
function loadRecordInput(flags, part) {
  const rec = loadInput('record', flags.record, flags['record-sha256'], RECORD_WORDS);
  const r = rec.value;
  if (!plainObject(r) || r.part !== part) refuse('record-invalid', `record part ${JSON.stringify(r?.part)}, wanted ${part}`);
  const pred = flags.supersedes === undefined ? null : loadInput('supersedes', flags.supersedes, flags['supersedes-sha256'], RECORD_WORDS).value;
  let draft = null;
  let frozen = null;
  let fz = null;
  if (part === 'final') {
    if (flags.part1 === undefined) refuse('args-invalid', 'part1-required');
    draft = loadInput('part1', flags.part1, flags['part1-sha256'], RECORD_WORDS).value;
    fz = loadFrozen(flags.frozen, flags['frozen-sha256']);
    const want = plainObject(r.quiz) ? r.quiz.sha256 : undefined;
    if (fz.sha256 !== want) refuse('quiz-sha-mismatch', `frozen ${fz.sha256} is not the record's quiz.sha256 ${want}`);
    frozen = { families: fz.families, n_questions: fz.list.entries.length };
  } else if (r.supersedes !== null && pred === null) {
    refuse('args-invalid', 'supersedes-required: the record supersedes a draft; pass it as --supersedes');
  }
  const v = validateOpenRecord(r, { draft, predecessor: pred, frozen });
  if (!v.ok) refuse('record-invalid', v.errors.map((e) => `${e.path} ${e.word}`).join('; '));
  return { record: r, sha256: rec.sha256, frozen: fz };
}

/** W2-D24: the four gate_code files' installed bytes, measured now through codeShas(), against the record's gate_code.
 *  An unmeasured file is code-unmeasured, a measured change code-changed; no flag stamps either here (W2-D6). */
export function recheckCode(record, root = TREE_ROOT) {
  const shas = codeShas(root);
  if (shas.state !== 'measured') refuse('code-unmeasured', `${shas.path} is ${shas.cause}`);
  const c = checkGateCode(record.gate_code, shas.files);
  if (c.ok) return;
  if (c.word === 'code-unmeasured') refuse('code-unmeasured', `gate_code lacks ${c.unmeasured.join(' ')}`);
  refuse('code-changed', `changed ${c.mismatched.join(' ')}`);
}

function subcommandHome(env) {
  if (typeof env.HOME !== 'string' || !path.isAbsolute(env.HOME)) refuse('args-invalid', 'HOME is unset or not absolute');
  return path.resolve(env.HOME);
}
/** This node's store id, through Task 1's one store opener (openReplayStore, W2-D51, R3), closed at once: a store that
 *  cannot be opened refuses store-unreadable with the store's own word, so an absent store is never an unreadable one. */
function nodeStoreId(home) {
  const rs = openReplayStore(home);
  try {
    return rs.storeId;
  } finally {
    rs.close();
  }
}
/** W2-D84: a subcommand reading this node refuses unless its store is one of the record's nodes. */
function requireNamedNode(record, storeId) {
  if (!record.nodes.some((n) => n.store_id === storeId)) refuse('input-invalid', `store ${storeId} is not one of the record's nodes`);
}
/** A sourced entry as the frozen list takes it: its eleven W2-D73 fields, its rank left behind. */
const frozenEntryOf = (e) => Object.fromEntries(FROZEN_ENTRY_KEYS.map((k) => [k, e[k]]));
/** The pilot's caps: part 1's quiz caps as the open record's defaults give them (the pilot runs before part 1; W2-D71). */
const pilotCaps = () => Object.fromEntries(['family', 'boundary', 'kind_per_family'].map((k) => [k, DRAFT_SPEC.quiz.fields.caps.fields[k].value]));
/** One warning line when any writer run failed (R6): a non-zero exit, a signal or no result event. Each such run's
 *  candidate is counted writer-malformed, so a failing account would otherwise drain the population quietly. */
function warnFailedRuns(counts) {
  const n = counts?.writer?.failed_runs ?? 0;
  if (n > 0) process.stderr.write(`ccrc history-replay: warning: ${n} writer run(s) failed (a non-zero exit, a signal or no result event); each is counted writer-malformed\n`);
}
/** One control file's content, read as W2-D84 says: through historyPaths' recallOffPath and store.mjs's readBounded at
 *  CONTROL_FILE_MAX, never following a link. Three answers, never folded: value, absent, unreadable (over-cap included,
 *  as sweep.mjs's reader folds it). The driver imports no recallOffPresence (R6), and this reads, never writes, so
 *  O13's one-writer pin holds. W2-D84 requires the content; W2-D29's "the driver does not read content" is the
 *  presence check's (W2-D78(ii)), still W2-4's one lstat line (R10).
 *  @param {string} home  @param {string} id */
function controlFileOf(home, id) {
  const r = readBounded(recallOffPath(home, id), CONTROL_FILE_MAX, false);
  return r.state === 'value' ? { state: 'value', value: r.value } : r.state === 'absent' ? { state: 'absent' } : { state: 'unreadable' };
}

/** Canonical JSON and one newline on stdout, `sha256 <hex>` of exactly those bytes on stderr. For a record that is
 *  recordSha256 (W2-D25). */
function printWithSha(value) {
  const text = canonicalJson(value) + '\n';
  process.stdout.write(text);
  process.stderr.write(`sha256 ${sha256Hex(text)}\n`);
  return EXIT.OK;
}

// ── the contract's flags, the frozen list and its merge ─────────────────────────────────────────────────────
/** Every flag token of every spawn mode's argv under `settingsMode`: the set step 0a's `flags_accepted` must name
 *  exactly (W2-D25 amended 2026-10-20, section 7). The model and home are placeholders; neither is a flag.
 *  @param {string} settingsMode  @returns {string[]} */
export function contractFlags(settingsMode) {
  const flags = new Set();
  for (const mode of SPAWN_MODES) {
    for (const t of spawnArgv({ mode, model: 'contract-model', settingsMode, home: '/contract-home' })) if (t.startsWith('-')) flags.add(t);
  }
  return [...flags].sort();
}

/** The families a list of entries or boundaries names, each once, sorted by familyKey. Pure. */
export function familiesOf(items) {
  const seen = new Map();
  for (const e of items) {
    const f = { store_id: e.store_id, ccrc_id: e.ccrc_id, generation: e.generation };
    seen.set(familyKeyOf(f), f);
  }
  return [...seen.values()].sort(byFamilyKey);
}

/** Every node's sourced entries in global rank order (W2-D71 as amended 2026-10-22: families by their
 *  quizFamilyOrderKey, by code unit, then candidates by their rank in the family's own stream; R10), cut at the target.
 *  Each node walked that order over its own families and stopped at the target, so the merged walk is the one a node
 *  holding every store would make. Two entries with one rank refuse. */
export function mergeSourced(lists, target) {
  const byRank = (a, b) => cmpUnit(a.rank[0], b.rank[0]) || a.rank[1] - b.rank[1];
  const all = lists.flat().sort(byRank);
  for (let i = 1; i < all.length; i += 1) {
    if (byRank(all[i - 1], all[i]) === 0) refuse('input-invalid', `sourced rank-duplicate ${all[i].rank.join(':')}`);
  }
  return all.slice(0, target);
}

// ── the census assembler (checks nodes only), the assignment, and Q18 ────────────────────────────────────────
function censusError(o) {
  if (!plainObject(o)) return 'not-object';
  if (typeof o.store_id !== 'string' || !UUID_RE.test(o.store_id)) return 'store_id';
  if (!plainObject(o.counters)) return 'counters';
  const c = o.census;
  if (!plainObject(c)) return 'census';
  for (const k of ['as_of_ms', 'since_ms', 'row_cap']) if (!Number.isSafeInteger(c[k])) return `census.${k}`;
  if (!plainObject(c.ticks) || !Number.isSafeInteger(c.ticks.n) || c.ticks.n < 0) return 'census.ticks';
  for (const k of ['first_ts_ms', 'last_ts_ms']) if (c.ticks[k] !== null && !Number.isSafeInteger(c.ticks[k])) return `census.ticks.${k}`;
  if (!Array.isArray(c.families)) return 'census.families';
  return null;
}
function verifyError(o) {
  if (!plainObject(o) || o.kind !== VERIFY_REGISTRY_KIND || o.v !== 1) return 'kind';
  if (typeof o.store_id !== 'string') return 'store_id';
  if (typeof o.census_sha256 !== 'string' || !SHA256_RE.test(o.census_sha256)) return 'census_sha256';
  if (!Number.isSafeInteger(o.lookback_ms)) return 'lookback_ms';
  if (!Array.isArray(o.families) || !o.families.every((f) => plainObject(f) && typeof f.ccrc_id === 'string'
    && typeof f.generation === 'string' && REGISTRY_STATES.includes(f.state))) return 'families';
  return null;
}

/** The census assembler W2-D21 names, which checks NODES only: each census names a node's store, once, and every node
 *  has one; each verify output names a census by its sha, the record's look-back and exactly that census's active list
 *  (W2-D20). No window, row cap or script sha is checked here (assembleReports does that, after the window). Answers
 *  every node with its census and states, the active list, the registry drops and the families kept (W2-D20: drops
 *  removed before Q18 and before the flip). */
export function assembleCensus(record, censusIn, verifyIn) {
  const labels = new Map(record.nodes.map((n) => [n.store_id, n.label]));
  const nodes = new Map();
  for (const c of censusIn) {
    const bad = censusError(c.value);
    if (bad !== null) refuse('input-invalid', `census shape ${bad}`);
    const sid = c.value.store_id;
    if (!labels.has(sid)) refuse('input-invalid', `census store-id-unlisted ${sid}`);
    if (nodes.has(sid)) refuse('input-invalid', `census store-id-duplicate ${sid}`);
    let act;
    try {
      act = activeFamilies(sid, c.value.census, { lookbackMs: record.active_rule.lookback_ms });
    } catch (e) {
      if (!(e instanceof TypeError)) throw e;
      refuse('input-invalid', `census ${sid} ${e.message}`);
    }
    nodes.set(sid, { store_id: sid, label: labels.get(sid), census_sha256: c.sha256, report: c.value, active: act.active, verify_sha256: null, states: null });
  }
  for (const [sid, label] of labels) if (!nodes.has(sid)) refuse('input-invalid', `census node-missing ${label}`);
  for (const v of verifyIn) {
    const bad = verifyError(v.value);
    if (bad !== null) refuse('input-invalid', `verify shape ${bad}`);
    const node = nodes.get(v.value.store_id);
    if (node === undefined) refuse('input-invalid', `verify store-id-unlisted ${v.value.store_id}`);
    if (node.states !== null) refuse('input-invalid', `verify store-id-duplicate ${node.store_id}`);
    if (v.value.census_sha256 !== node.census_sha256) refuse('input-invalid', `verify census-mismatch ${node.store_id}`);
    if (v.value.lookback_ms !== record.active_rule.lookback_ms) refuse('input-invalid', `verify lookback-mismatch ${node.store_id}`);
    const want = node.active.map(familyKeyOf).join('\n');
    const got = v.value.families.map((f) => familyKey(node.store_id, f.ccrc_id, f.generation)).join('\n');
    if (got !== want) refuse('input-invalid', `verify families-mismatch ${node.store_id}`);
    node.verify_sha256 = v.sha256;
    node.states = v.value.families;
  }
  for (const node of nodes.values()) if (node.states === null) refuse('input-invalid', `verify node-missing ${node.label}`);
  const list = [...nodes.values()].sort((a, b) => (a.store_id < b.store_id ? -1 : a.store_id > b.store_id ? 1 : 0));
  const active = list.flatMap((n) => n.active).sort(byFamilyKey);
  const drops = list.flatMap((n) => n.states.filter((s) => s.state !== 'ok')
    .map((s) => ({ store_id: n.store_id, ccrc_id: s.ccrc_id, generation: s.generation, reason: s.state }))).sort(byFamilyKey);
  const dropped = new Set(drops.map(familyKeyOf));
  return { nodes: list, active, drops, kept: active.filter((f) => !dropped.has(familyKeyOf(f))) };
}

/** W2-D19's assignment over the kept families, and its sha. */
export function deriveAssignment(seedHex, assembled) {
  const list = assignArms(seedHex, assembled.kept);
  return { list, sha256: assignmentSha256(list) };
}

/** W2-D21's covered_days: the look-back clipped to the node's tick coverage, in days; null with no tick in it. Pure. */
export function coveredDays(census, lookbackDays) {
  const t = census.ticks;
  if (t.n === 0 || t.first_ts_ms === null) return null;
  const from = Math.max(census.since_ms, t.first_ts_ms);
  const days = (census.as_of_ms - from) / Q18_DAY_MS;
  return days > 0 ? Math.min(lookbackDays, days) : null;
}

/** rho_hat (W2-D21, reported beside the figures): the one-way ANOVA estimate of the intra-cluster correlation of "a
 *  window holds a read call", over families with at least one window. Unclipped; null with fewer than two such families,
 *  no within-family degree of freedom, or a zero denominator. Pure. */
export function rhoHat(clusters) {
  const cs = clusters.filter((c) => c.windows > 0);
  const m = cs.length;
  const n = cs.reduce((s, c) => s + c.windows, 0);
  if (m < 2 || n - m < 1) return null;
  const pbar = cs.reduce((s, c) => s + c.with_call, 0) / n;
  const ssb = cs.reduce((s, c) => s + c.windows * (c.with_call / c.windows - pbar) ** 2, 0);
  const ssw = cs.reduce((s, c) => s + c.with_call - (c.with_call * c.with_call) / c.windows, 0);
  const msb = ssb / (m - 1);
  const msw = ssw / (n - m);
  const n0 = (n - cs.reduce((s, c) => s + c.windows * c.windows, 0) / n) / (m - 1);
  const den = msb + (n0 - 1) * msw;
  return den === 0 ? null : (msb - msw) / den;
}

/** The power output (W2-D21, amended 2026-10-20 after W2-3's review 664, F3 and F8): q18_settings read from the
 *  record; one q18Power call per power level with rho = rho_headline and with rho = 0; covered_days from lookback_days;
 *  the population the flip uses (the kept families). It holds no clock reading, so the same inputs print the same bytes. */
export function powerReport(record, recordSha256, assembled) {
  const s = record.q18_settings;
  const plannedDays = record.window_plan.planned_days;
  const lookbackMs = s.lookback_days * Q18_DAY_MS;
  const kept = new Set(assembled.kept.map(familyKeyOf));
  const coverage = {};
  const perNode = {};
  const consumed = {};
  const fams = [];
  for (const node of assembled.nodes) {
    const c = node.report.census;
    if (c.as_of_ms - c.since_ms !== lookbackMs) {
      refuse('input-invalid', `census ${node.store_id} since-mismatch: as_of - since is ${c.as_of_ms - c.since_ms} ms, lookback_days is ${s.lookback_days}`);
    }
    const covered = coveredDays(c, s.lookback_days);
    if (covered === null) refuse('input-invalid', `census ${node.store_id} no-tick-coverage`);
    coverage[node.store_id] = { covered_days: covered, ticks: copyJson(c.ticks) };
    const per = { windows: 0, with_call: 0 };
    for (const row of c.families) {
      const key = familyKey(node.store_id, row.ccrc_id, row.generation);
      if (!kept.has(key)) continue;
      // A census row is a family the store holds: buildWindows reads it as a family report once `found` says so.
      const t = windowTotals(buildWindows({ ccrc_id: row.ccrc_id, generation: row.generation, found: true,
        merged_generations: row.merged_generations, calls: row.calls, boundaries: row.boundaries }));
      fams.push({ key, store_id: node.store_id, windows: t.windows, with_call: t.with_call, covered_days: covered });
      per.windows += t.windows;
      per.with_call += t.with_call;
    }
    perNode[node.store_id] = per;
    const n = node.report.counters['card_consumed:main'];
    consumed[node.store_id] = Number.isSafeInteger(n) ? n : 0;
  }
  fams.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const q18In = fams.map(({ key, windows, covered_days }) => ({ key, windows, covered_days }));
  const figures = [];
  for (const power of s.power) {
    for (const rho of [s.rho_headline, 0]) {
      const q = q18Power({ families: q18In, plannedDays, seedHex: record.bootstrap.seed, rho, power, sims: s.sims, gridStep: s.grid_step, B: record.bootstrap.B });
      figures.push({ power, rho, figure: q.figure, points: q.points });
    }
  }
  const figureOf = (f) => figures.find((x) => x.power === f.power && x.rho === (f.rho === 'zero' ? 0 : s.rho_headline))?.figure ?? null;
  const total = Object.values(perNode).reduce((t, p) => ({ windows: t.windows + p.windows, with_call: t.with_call + p.with_call }), { windows: 0, with_call: 0 });
  // §4's q18 carries n_f per family and per node: a node's n_f is the sum over its kept families.
  const expected = expectedWindows(q18In, plannedDays);
  const storeOfKey = new Map(fams.map((f) => [f.key, f.store_id]));
  const nfPerNode = Object.fromEntries(assembled.nodes.map((n) => [n.store_id, 0]));
  for (const x of expected) nfPerNode[storeOfKey.get(x.key)] += x.n;
  return {
    kind: POWER_KIND, v: 1, record_sha256: recordSha256,
    inputs: assembled.nodes.map((n) => ({ store_id: n.store_id, census_sha256: n.census_sha256, verify_sha256: n.verify_sha256 })),
    q18_settings: copyJson(s), planned_days: plannedDays, population: fams.length, registry_drops: assembled.drops.length, figures,
    headline: figureOf(Q18_FIGURES.headline), at_power_80: figureOf(Q18_FIGURES.at_power_80), at_rho_0: figureOf(Q18_FIGURES.at_rho_0),
    rho_hat: rhoHat(fams),
    n_f: { per_family: Object.fromEntries(expected.map((x) => [x.key, x.n])), per_node: nfPerNode },
    coverage,
    pre_window_uptake: { per_node: perNode, total, card_consumed_main_all_time: consumed },
  };
}

// ── the reports the subcommands write, as pure builders ───────────────────────────────────────────────────
/** A registry read against the census generation (W2-D20): four answers, never folded. Pure. */
export function registryStateOf(read, generation) {
  if (read.state === 'absent') return 'registry-absent';
  if (read.state !== 'value') return 'unreadable';
  return read.value === generation ? 'ok' : 'registry-mismatch';
}
export function verifyRegistryReport({ recordSha256, storeId, censusSha256, lookbackMs, families }) {
  const counts = Object.fromEntries(REGISTRY_STATES.map((s) => [s, families.filter((f) => f.state === s).length]));
  return { kind: VERIFY_REGISTRY_KIND, v: 1, record_sha256: recordSha256, store_id: storeId, census_sha256: censusSha256,
    lookback_ms: lookbackMs, families, counts };
}
/** One assigned family's presence file against its arm (W2-D84). A control file must hold its generation (trimmed, as
 *  decideRecallOff trims); a treatment file must not name its own (another generation is not this family's). Unreadable
 *  is its own answer, never absent. Pure. */
export function abStateOf(arm, generation, read) {
  if (read.state === 'unreadable') return 'unreadable';
  if (arm === 'control') {
    if (read.state === 'absent') return 'control-absent';
    return read.value.trim() === generation ? 'ok' : 'control-mismatch';
  }
  if (read.state === 'absent') return 'ok';
  return read.value.trim() === generation ? 'treatment-named' : 'ok';
}
export function verifyAbReport({ recordSha256, storeId, families, newest, seen }) {
  const seenAfter = seen !== null && (newest.state === 'absent' || (newest.state === 'value' && seen > newest.ms));
  const counts = Object.fromEntries(AB_STATES.map((s) => [s, families.filter((f) => f.state === s).length]));
  return { kind: VERIFY_AB_KIND, v: 1, record_sha256: recordSha256, store_id: storeId, families, counts,
    newest_write: newest, seen_ms: seen, seen_after_write: seenAfter, ok: seenAfter && families.every((f) => f.state === 'ok') };
}
export function sourcedReport({ recordSha256, storeId, assignmentSha256, inputs, sourced, spend }) {
  return { kind: SOURCED_KIND, v: 1, record_sha256: recordSha256, store_id: storeId, assignment_sha256: assignmentSha256,
    inputs, entries: sourced.entries, counts: sourced.counts, asof_same_ms_hits: sourced.asof_same_ms_hits ?? {}, spend };
}
/** The meta beside the frozen list: quiz-source's assignment_sha256 (W2-D73), the counts, the floor verdict (W2-D71),
 *  and whether the list names fewer families than the record's quiz.min_families (`minFamilies`, the signed default 20,
 *  W2-D71's "at least 20 families"). That flag is a report, never a refusal (R11): the halt floor stays the only
 *  family-count stop, and nothing reads the flag to decide. */
export function quizMetaReport({ recordSha256, frozenSha256, assignmentSha256, entries, floor, minFamilies, sourced }) {
  const families = familiesOf(entries);
  return { kind: QUIZ_META_KIND, v: 1, record_sha256: recordSha256, frozen_sha256: frozenSha256, assignment_sha256: assignmentSha256,
    n_questions: entries.length, n_families: families.length,
    below_floor: quizFloor(entries.length, families.length, floor).halt,
    short_of_min_families: families.length < minFamilies, sourced };
}

// ── the record: template, draft and final ──────────────────────────────────────────────────────────────────
function skeletonField(f) {
  if (Object.hasOwn(f, 'value')) return copyJson(f.value);
  if (f.fields) return skeletonOf(f.fields);
  if (f.type === 'array') return f.items ? [skeletonField(f.items)] : [];
  if (f.values) return { '<key>': skeletonField(f.values) };
  return `<${f.status} ${f.type}${f.nullable ? ' or null' : ''}>`;
}
function skeletonOf(spec) {
  return Object.fromEntries(Object.entries(spec).map(([k, f]) => [k, skeletonField(f)]));
}
/** open --template's skeleton: both parts, from OPEN_RECORD_V1, every fixed or default value filled. Pure. */
export function openTemplate() {
  return { kind: TEMPLATE_KIND, v: 1, draft: skeletonOf(OPEN_RECORD_V1.draft), final: skeletonOf(OPEN_RECORD_V1.final) };
}

/** The values a schema gives: a field's value when it has one, an object of its fields' values when it has fields (a key
 *  with no value left out), nothing otherwise. */
function schemaValues(spec) {
  const o = {};
  for (const [k, f] of Object.entries(spec)) {
    if (Object.hasOwn(f, 'value')) o[k] = copyJson(f.value);
    else if (f.fields) {
      const inner = schemaValues(f.fields);
      if (Object.keys(inner).length > 0) o[k] = inner;
    }
  }
  return o;
}
/** The operator's overrides, applied to `default` fields only (W2-D25: the values the operator confirms or changes when
 *  signing). An array is replaced whole; a fixed, measured, derived or operator field, an unknown key, and a field that
 *  comes from the pilot-source output are args-invalid. */
function applyOverrides(target, over, spec, prefix) {
  for (const [k, v] of Object.entries(over)) {
    const p = prefix === '' ? k : `${prefix}.${k}`;
    const f = spec[k];
    if (f === undefined) refuse('args-invalid', `override ${p} is not a part 1 field`);
    if (PILOT_DERIVED.includes(p)) refuse('args-invalid', `override ${p} comes from the pilot-source output`);
    if (p === 'rubric_sha256') refuse('args-invalid', 'override rubric_sha256 follows rubric_id');
    if (f.fields && !Object.hasOwn(f, 'value') && plainObject(v)) {
      if (!plainObject(target[k])) target[k] = {};
      applyOverrides(target[k], v, f.fields, p);
      continue;
    }
    if (f.status === 'default') {
      target[k] = copyJson(v);
      continue;
    }
    refuse('args-invalid', `override ${p} is ${f.status}`);
  }
}
function readOverrides(p) {
  const read = readPlain(path.resolve(p), OUT_JSON_CAP);
  if (read.state !== 'bytes') refuse('args-invalid', `overrides ${read.state === 'absent' ? 'absent' : badWord(read)}`);
  let o;
  try {
    o = JSON.parse(read.bytes.toString('utf8'));
  } catch {
    refuse('args-invalid', 'overrides not-json');
  }
  if (!plainObject(o)) refuse('args-invalid', 'overrides is not a JSON object');
  return o;
}

/** Part 1 (W2 decisions §4): the schema's fixed and default values, the overrides, then what the operator named, what
 *  step 0a and the pilot measured, the seed and gate_code. Pure: the caller draws the seed and reads the clock.
 *  @param {Record<string, any>} input  @returns {Record<string, any>} */
export function buildDraft({ nodes, step0a, pilot, account, models, gateCode, seedHex, nowMs, overrides = {}, supersedes = null }) {
  const d = schemaValues(DRAFT_SPEC);
  applyOverrides(d, overrides, DRAFT_SPEC, '');
  return {
    ...d,
    drafted_ms: nowMs, supersedes, nodes: copyJson(nodes), account,
    arm_model: models.arm, writer_model: models.writer, judge_model: models.judge,
    step0a: copyJson(step0a),
    bootstrap: { ...d.bootstrap, seed: seedHex },
    labeller: { ...d.labeller, sha_min_prefix: pilot.used.sha_min_prefix },
    rubric_sha256: Object.hasOwn(RUBRIC_SHA256, d.rubric_id) ? RUBRIC_SHA256[d.rubric_id] : d.rubric_sha256,
    quiz: { ...d.quiz, writer_input: pilot.used.writer_input, baseline_files: pilot.used.baseline_files },
    active_rule: { ...d.active_rule, text: d.active_rule.text ?? ACTIVE_RULE_TEXT },
    pilot: { seed: pilot.seed, n_fidelity: pilot.n_fidelity, n_usage: pilot.n_usage, tolerance: d.pilot.tolerance,
      families: copyJson(pilot.families), frozen_sha256: pilot.frozen_sha256, writer_model: pilot.writer_model, used: copyJson(pilot.used),
      code_shas: copyJson(pilot.code_shas), release_stamp: pilot.release_stamp, budget: pilot.budget, spend: pilot.spend },
    gate_code: copyJson(gateCode),
  };
}

/** Part 2 (W2 decisions §4): part 1 whole, then the census instants, the registry drops, the power figures, the pilot's
 *  result, the approved spend budget, the re-derived assignment, the frozen quiz and the window. Pure.
 *  @param {Record<string, any>} input  @returns {Record<string, any>} */
export function buildFinal({ draft, draftSha256, priorSha256 = null, assembled, assignment, power, powerSha256, frozen, pilotResult, spendBudget, window, decision, nowMs }) {
  return {
    ...copyJson(draft),
    part: 'final', supersedes: priorSha256 ?? draftSha256, finalized_ms: nowMs,
    census: assembled.nodes.map((n) => ({ store_id: n.store_id, census_ms: n.report.census.as_of_ms, census_sha256: n.census_sha256 })),
    registry_drops: copyJson(assembled.drops),
    q18: { headline: power.headline, at_power_80: power.at_power_80, at_rho_0: power.at_rho_0, rho_hat: power.rho_hat,
      n_f: copyJson(power.n_f), coverage: copyJson(power.coverage), pre_window_uptake: copyJson(power.pre_window_uptake),
      power_output_sha256: powerSha256, decision },
    pilot_result: { fidelity: copyJson(pilotResult.fidelity), usage_extrapolation: copyJson(pilotResult.usage_extrapolation),
      step0b_sha256: pilotResult.step0b_sha256, settings_mode: pilotResult.settings_mode, absent_rate: copyJson(pilotResult.absent_rate) },
    spend_budget: spendBudget,
    assignment: copyJson(assignment.list), assignment_sha256: assignment.sha256,
    quiz: { ...copyJson(draft.quiz), sha256: frozen.sha256, n_questions: frozen.list.entries.length, n_families: frozen.families.length, families: copyJson(frozen.families) },
    window: { start_ms: window.start, end_ms: window.end },
    amendments: [],
  };
}

// ── input shapes the subcommands read ──────────────────────────────────────────────────────────────────────
function entryError(e) {
  if (!plainObject(e)) return 'entry';
  for (const k of FROZEN_ENTRY_KEYS) if (!Object.hasOwn(e, k)) return `entry ${k}`;
  for (const k of ['qid', 'store_id', 'ccrc_id', 'generation', 'boundary_uuid', 'fact', 'fact_raw', 'question', 'source_entry_uuid']) {
    if (typeof e[k] !== 'string') return `entry ${k}`;
  }
  if (!FACT_KINDS.includes(e.kind)) return 'entry kind';
  if (!Array.isArray(e.repo_roots) || !e.repo_roots.every((r) => typeof r === 'string')) return 'entry repo_roots';
  // A quiz entry's rank is [its family's quizFamilyOrderKey, its candidate rank] (W2-D71 as amended 2026-10-22; R10).
  if (!Array.isArray(e.rank) || e.rank.length !== 2 || typeof e.rank[0] !== 'string' || !SHA256_RE.test(e.rank[0])
    || !Number.isSafeInteger(e.rank[1]) || e.rank[1] < 0) return 'entry rank';
  return null;
}
function sourcedError(o) {
  if (!plainObject(o) || o.kind !== SOURCED_KIND || o.v !== 1) return 'kind';
  for (const k of ['record_sha256', 'assignment_sha256']) if (typeof o[k] !== 'string' || !SHA256_RE.test(o[k])) return k;
  if (typeof o.store_id !== 'string') return 'store_id';
  if (!Array.isArray(o.entries)) return 'entries';
  for (const e of o.entries) { const bad = entryError(e); if (bad !== null) return bad; }
  return plainObject(o.counts) ? null : 'counts';
}
function quizMetaError(o) {
  if (!plainObject(o) || o.kind !== QUIZ_META_KIND || o.v !== 1) return 'kind';
  for (const k of ['record_sha256', 'frozen_sha256', 'assignment_sha256']) if (typeof o[k] !== 'string' || !SHA256_RE.test(o[k])) return k;
  if (!Number.isSafeInteger(o.n_questions) || !Number.isSafeInteger(o.n_families)) return 'counts';
  return typeof o.below_floor === 'boolean' ? null : 'below_floor';
}
function powerError(o) {
  if (!plainObject(o) || o.kind !== POWER_KIND || o.v !== 1) return 'kind';
  if (typeof o.record_sha256 !== 'string' || !SHA256_RE.test(o.record_sha256)) return 'record_sha256';
  if (!Array.isArray(o.inputs)) return 'inputs';
  for (const k of ['headline', 'at_power_80', 'at_rho_0', 'rho_hat']) if (o[k] !== null && typeof o[k] !== 'number') return k;
  for (const k of ['n_f', 'coverage', 'pre_window_uptake']) if (!plainObject(o[k])) return k;
  return null;
}
function pilotSourceError(o) {
  if (!plainObject(o) || o.kind !== PILOT_SOURCE_KIND || o.v !== 1) return 'kind';
  for (const k of ['seed', 'frozen_sha256']) if (typeof o[k] !== 'string' || !SHA256_RE.test(o[k])) return k;
  for (const k of ['n_fidelity', 'n_usage', 'budget', 'spend']) if (!Number.isSafeInteger(o[k])) return k;
  if (!Array.isArray(o.families)) return 'families';
  if (typeof o.writer_model !== 'string' || typeof o.release_stamp !== 'string') return 'writer_model';
  if (!plainObject(o.used) || !plainObject(o.code_shas)) return 'used';
  return null;
}
function pilotResultError(o) {
  if (!plainObject(o) || o.kind !== PILOT_RESULT_KIND || o.v !== 1) return 'kind';
  if (!Array.isArray(o.fidelity) || !o.fidelity.every(plainObject)) return 'fidelity';
  if (!plainObject(o.usage_extrapolation)) return 'usage_extrapolation';
  if (typeof o.step0b_sha256 !== 'string' || !SHA256_RE.test(o.step0b_sha256)) return 'step0b_sha256';
  if (!SETTINGS_MODES.includes(o.settings_mode)) return 'settings_mode';
  return plainObject(o.absent_rate) ? null : 'absent_rate';
}

// ── the subcommands ────────────────────────────────────────────────────────────────────────────────────────
// A handler that takes deps after its env names that parameter driverEnv, never env: W2-4 Task 5's env scan reads
// `, env,` on a code line as an env passed whole, and the value is still main's by-name projection.
/** `pilot-source` (W2 decisions §5 act 9, one pilot node, R9): before part 1, so its writer is preflighted against the
 *  one step 0a output it is given (Task 6's openWriter), under its own --budget and the driver's LIMITS_DEFAULTS (W2-D55,
 *  W2-D56). It records the code shas and the stamp the preflight held equal to step 0a's, which part 1's validator checks
 *  against gate_code (W2-D24). Its seed is its own (W2-D71), drawn by deps.seed. */
export async function pilotSourceCommand(flags, driverEnv, deps = { sourceQuiz, seed: drawSeedHex }) {
  checkFlags('pilot-source', flags);
  const home = subcommandHome(driverEnv);
  const pairs = pairedInputs(flags, 'step0a');
  if (pairs.length !== 1) refuse('args-invalid', 'pilot-source reads one step 0a output, this node\'s');
  const step0a = loadStep0a(pairs[0][0], pairs[0][1]);
  if (step0a.account !== flags.account) refuse('input-invalid', `step0a account ${step0a.account} is not --account ${flags.account}`);
  const shaMinPrefix = flags['sha-min-prefix'] ?? DRAFT_SPEC.labeller.fields.sha_min_prefix.value;
  if (!SHA_MIN_PREFIXES.includes(shaMinPrefix)) refuse('args-invalid', `sha-min-prefix ${shaMinPrefix} is not one of ${SHA_MIN_PREFIXES.join(', ')}`);
  const writerInput = flags['writer-input'] ?? DRAFT_SPEC.quiz.fields.writer_input.value;
  if (!WRITER_INPUTS.includes(writerInput)) refuse('args-invalid', `writer-input ${JSON.stringify(writerInput)} is not one of ${WRITER_INPUTS.join(', ')}`);
  const nFidelity = flags['n-fidelity'] ?? DRAFT_SPEC.pilot.fields.n_fidelity.value;
  const nUsage = flags['n-usage'] ?? DRAFT_SPEC.pilot.fields.n_usage.value;
  const baselineFiles = DRAFT_SPEC.quiz.fields.baseline_files.value;
  const writerModel = flags['writer-model'];
  refuseUnusableInputs(home, flags.out, [['writer-model', writerModel]]);
  refuseWriterModel(writerModel);   // R10: a refusal that needs no store and no spawn answers before --out exists
  const out = prepareOut(flags.out);
  refuseColonInRealOut(out);
  const claim = claimOut(out);
  try {
    const rs = openReplayStore(home);   // the run's one store open (R3)
    try {
      // The writer: the model, the account (W2-D52), the gate (W2-D55) and W2-D56's preflight against step 0a, before
      // any writer spawn and before every writer batch (Task 6's openWriter).
      const writer = await openWriter({ home, accountId: flags.account, model: writerModel, settingsMode: step0a.settings_mode, writerInput,
        claim, budget: flags.budget, limits: LIMITS_DEFAULTS, expected: step0a, lang: driverEnv.LANG, idx: rs.idx });
      const seedHex = deps.seed();
      const sourced = await deps.sourceQuiz({
        mode: 'pilot', rs, home, out, writer, seedHex, exclude: { pilotFamilies: [], assignment: [] },
        plan: { n_fidelity: nFidelity, n_usage: nUsage, caps: pilotCaps() }, configDirs: rosterConfigDirs(readRoster(home).roster, home),
      });
      warnFailedRuns(sourced.counts);
      const frozenSha = writeFrozenList(out, 'pilot', frozenListText('pilot',
        { writer_model: writerModel, labeller: { ...copyJson(LABELLER), sha_min_prefix: shaMinPrefix } }, sourced.entries.map(frozenEntryOf)));
      const output = {
        kind: PILOT_SOURCE_KIND, v: 1, store_id: rs.storeId, seed: seedHex, n_fidelity: nFidelity, n_usage: nUsage,
        families: familiesOf([...sourced.entries, ...sourced.fidelity]), fidelity: copyJson(sourced.fidelity),
        frozen_sha256: frozenSha, writer_model: writerModel,
        used: { labeller: copyJson(LABELLER), sha_min_prefix: shaMinPrefix, writer_input: writerInput, baseline_files: baselineFiles,
          writer_prompt_sha256: WRITER_PROMPT_SHA256, answer_protocol_sha256: ANSWER_PROTOCOL_SHA256 },
        code_shas: copyJson(step0a.code_shas), release_stamp: step0a.release_stamp, budget: flags.budget, spend: spentSoFar(out), counts: sourced.counts,
      };
      writePlain(out, PILOT_SOURCE_FILE, canonicalJson(output) + '\n');
      process.stderr.write(`sha256 ${shaOfPlain(out, PILOT_SOURCE_FILE)}\n`);   // D-5983: stderr; stdout stays empty
      return EXIT.OK;
    } finally {
      rs.close();
    }
  } finally {
    claim.release();
  }
}

/** `quiz-source` (W2 decisions §5 act 16): after part 1, under part 1's account, models, settings mode, limits and
 *  pilot_budget (W2-D55), preflighted against part 1 (W2-D56). The assignment comes from the census and verify inputs
 *  (W2-D19, W2-D73); control-held ids and pilot families are excluded from sourcing (W2-D77), which walks this node's
 *  own admitted families, never the census's kept list (W2-D71, R10). Its writer model is the validated record's, held
 *  to an exact Opus id by the validator, so no refusal here needs --out first. */
export async function quizSourceCommand(flags, driverEnv, deps = { sourceQuiz }) {
  checkFlags('quiz-source', flags);
  const home = subcommandHome(driverEnv);
  const rec = loadRecordInput(flags, 'draft');
  recheckCode(rec.record);   // W2-D24 (quiz-source)
  const assembled = assembleCensus(rec.record, loadInputs(flags, 'census', OUT_STREAM_CAP), loadInputs(flags, 'verify'));
  const assignment = deriveAssignment(rec.record.bootstrap.seed, assembled);
  const rs = openReplayStore(home);   // the run's one store open (R3)
  try {
    const storeId = rs.storeId;
    requireNamedNode(rec.record, storeId);
    const entry = rec.record.step0a.find((s) => s.store_id === storeId);   // the validator binds exactly one per node
    const writerModel = rec.record.writer_model;
    refuseUnusableInputs(home, flags.out, [['writer-model', writerModel]]);
    const out = prepareOut(flags.out);
    refuseColonInRealOut(out);
    const claim = claimOut(out);
    try {
      // The writer under part 1's account, models, settings mode, limits and pilot_budget (W2-D55), preflighted against
      // this node's part 1 step 0a entry and gate_code before every writer batch (Task 6's openWriter; W2-D56).
      const writer = await openWriter({ home, accountId: rec.record.account, model: writerModel, settingsMode: rec.record.settings_mode,
        writerInput: rec.record.quiz.writer_input, claim, budget: rec.record.pilot_budget, limits: rec.record.limits,
        expected: { claude_code_version: entry.claude_code_version, release_stamp: rec.record.gate_code.release_tag,
          wrapper_sha256: entry.wrapper_sha256, code_shas: rec.record.gate_code.files }, lang: driverEnv.LANG, idx: rs.idx });
      const sourced = await deps.sourceQuiz({
        // No family list (R10, C1): sourceQuiz walks this store's admitted families; assembled.kept fed the assignment only.
        mode: 'quiz', rs, home, out, writer, seedHex: rec.record.bootstrap.seed,
        exclude: { pilotFamilies: copyJson(rec.record.pilot.families), assignment: copyJson(assignment.list) },
        plan: copyJson(rec.record.quiz), configDirs: rosterConfigDirs(readRoster(home).roster, home),
      });
      warnFailedRuns(sourced.counts);
      const inputs = assembled.nodes.map((n) => ({ store_id: n.store_id, census_sha256: n.census_sha256, verify_sha256: n.verify_sha256 }));
      ensurePlainDir(out, 'quiz');
      writePlain(out, SOURCED_FILE, canonicalJson(sourcedReport({ recordSha256: rec.sha256, storeId, assignmentSha256: assignment.sha256,
        inputs, sourced, spend: spentSoFar(out) })) + '\n');
      process.stderr.write(`sha256 ${shaOfPlain(out, SOURCED_FILE)}\n`);
      return EXIT.OK;
    } finally {
      claim.release();
    }
  } finally {
    rs.close();
  }
}

/** `freeze --record <draft>` (W2-D73): every named node's sourced list, exactly one each (a node with none refuses
 *  `sourced node-missing`, as the census assembler's word), of this record and one assignment, merged in global rank
 *  order (each family's order key, then its candidate rank; R10) and cut at quiz.target; `<out>/quiz/frozen.json` as W2-D73's exact bytes, 0600, and its meta beside it. */
export async function freezeCommand(flags, env) {
  checkFlags('freeze', flags);
  const rec = loadRecordInput(flags, 'draft');
  recheckCode(rec.record);   // W2-D24 (freeze)
  const lists = loadInputs(flags, 'sourced');
  const stores = new Set();
  let assignmentSha = null;
  for (const l of lists) {
    const bad = sourcedError(l.value);
    if (bad !== null) refuse('input-invalid', `sourced shape ${bad}`);
    const s = l.value;
    if (s.record_sha256 !== rec.sha256) refuse('input-invalid', `sourced record-mismatch ${s.store_id}`);
    requireNamedNode(rec.record, s.store_id);
    if (stores.has(s.store_id)) refuse('input-invalid', `sourced store-id-duplicate ${s.store_id}`);
    stores.add(s.store_id);
    if (assignmentSha !== null && s.assignment_sha256 !== assignmentSha) refuse('assignment-mismatch', `sourced lists disagree: ${assignmentSha} and ${s.assignment_sha256}`);
    assignmentSha = s.assignment_sha256;
    for (const e of s.entries) {
      if (e.store_id !== s.store_id) refuse('input-invalid', `sourced entry ${e.qid} names another store`);
      if (qidOf(e) !== e.qid) refuse('input-invalid', `sourced entry ${e.qid} qid-mismatch`);
    }
  }
  // W2-D71's population is the families on the NAMED nodes: one list per node, or the merge freezes a subset.
  for (const n of rec.record.nodes) if (!stores.has(n.store_id)) refuse('input-invalid', `sourced node-missing ${n.label}`);
  const entries = mergeSourced(lists.map((l) => l.value.entries), rec.record.quiz.target);
  const text = frozenListText('quiz', { writer_model: rec.record.writer_model,
    labeller: { ...copyJson(LABELLER), sha_min_prefix: rec.record.labeller.sha_min_prefix } }, entries.map(frozenEntryOf));
  const out = prepareOut(flags.out);
  const claim = claimOut(out);
  try {
    const sha = writeFrozenList(out, 'quiz', text);   // Task 6's one writer: 0600, never replaced (W2-D73)
    writePlain(out, QUIZ_META_FILE, canonicalJson(quizMetaReport({ recordSha256: rec.sha256, frozenSha256: sha, assignmentSha256: assignmentSha,
      entries, floor: rec.record.quiz.halt_floor, minFamilies: rec.record.quiz.min_families,
      sourced: lists.map((l) => ({ store_id: l.value.store_id, sha256: l.sha256 })) })) + '\n');
    process.stderr.write(`sha256 ${sha}\n`);
    return EXIT.OK;
  } finally {
    claim.release();
  }
}

/** `power --record <draft>` (W2-D21, amended 2026-10-20): the census and verify outputs through the assembler that checks
 *  nodes only; prints to stdout, its sha on stderr. Reads no HOME and writes no file. */
export async function powerCommand(flags, env) {
  checkFlags('power', flags);
  const rec = loadRecordInput(flags, 'draft');
  recheckCode(rec.record);   // W2-D24 (power)
  const assembled = assembleCensus(rec.record, loadInputs(flags, 'census', OUT_STREAM_CAP), loadInputs(flags, 'verify'));
  return printWithSha(powerReport(rec.record, rec.sha256, assembled));
}

async function openDraft(flags, driverEnv, deps) {
  checkFlags('open --draft', flags);
  const home = subcommandHome(driverEnv);
  const pairs = pairedInputs(flags, 'step0a');
  const labels = flags['node-label'];
  const stores = flags['node-store-id'];
  if (labels.length !== pairs.length || stores.length !== pairs.length) {
    refuse('args-invalid', `--step0a, --node-label and --node-store-id are given ${pairs.length}, ${labels.length} and ${stores.length} times`);
  }
  const step0a = pairs.map(([p, h], i) => {
    const o = loadStep0a(p, h);
    const want = contractFlags(o.settings_mode);
    const have = Object.keys(o.flags_accepted).sort();
    const missing = want.filter((f) => !have.includes(f));
    const extra = have.filter((f) => !want.includes(f));
    if (missing.length + extra.length > 0) {
      refuse('input-invalid', `step0a ${labels[i]} flags-incomplete${missing.length > 0 ? ` missing ${missing.join(' ')}` : ''}${extra.length > 0 ? ` extra ${extra.join(' ')}` : ''}`);
    }
    return { ...o, label: labels[i], store_id: stores[i] };
  });
  const pilot = loadInput('pilot', flags.pilot, flags['pilot-sha256']).value;
  const pbad = pilotSourceError(pilot);
  if (pbad !== null) refuse('input-invalid', `pilot shape ${pbad}`);
  const overrides = flags.overrides === undefined ? {} : readOverrides(flags.overrides);
  const pred = flags.supersedes === undefined ? null : loadInput('supersedes', flags.supersedes, flags['supersedes-sha256'], RECORD_WORDS);
  if (pred !== null && !(plainObject(pred.value) && pred.value.part === 'draft' && plainObject(pred.value.bootstrap) && typeof pred.value.bootstrap.seed === 'string')) {
    refuse('record-invalid', 'supersedes is not a draft with a seed');
  }
  const shas = codeShas();
  if (shas.state !== 'measured') refuse('code-unmeasured', `${shas.path} is ${shas.cause}`);
  const stamp = readReleaseStamp(home);
  if (stamp.state !== 'value') refuse('tree-unmeasured', `stamp ${stamp.state}${stamp.code === undefined ? '' : ` ${stamp.code}`}`);
  const record = buildDraft({
    nodes: step0a.map((s) => ({ label: s.label, store_id: s.store_id })), step0a, pilot, account: flags.account,
    models: { arm: flags['arm-model'], writer: flags['writer-model'], judge: flags['judge-model'] },
    gateCode: { release_tag: stamp.tag, files: shas.files },
    seedHex: pred === null ? deps.seed() : pred.value.bootstrap.seed, nowMs: deps.now(), overrides,
    supersedes: pred === null ? null : pred.sha256,
  });
  const v = validateOpenRecord(record, { draft: null, predecessor: pred === null ? null : pred.value, frozen: null });
  if (!v.ok) refuse('record-invalid', v.errors.map((e) => `${e.path} ${e.word}`).join('; '));
  return printWithSha(record);
}

async function openFinalize(flags, driverEnv, deps) {
  checkFlags('open --finalize', flags);
  const rec = loadRecordInput(flags, 'draft');
  recheckCode(rec.record);   // W2-D24 (open --finalize)
  const assembled = assembleCensus(rec.record, loadInputs(flags, 'census', OUT_STREAM_CAP), loadInputs(flags, 'verify'));
  const assignment = deriveAssignment(rec.record.bootstrap.seed, assembled);
  const meta = loadInput('quiz-meta', flags['quiz-meta'], flags['quiz-meta-sha256']).value;
  const mbad = quizMetaError(meta);
  if (mbad !== null) refuse('input-invalid', `quiz-meta shape ${mbad}`);
  if (meta.record_sha256 !== rec.sha256) refuse('input-invalid', 'quiz-meta record-mismatch');
  const frozen = loadFrozen(flags.frozen, flags['frozen-sha256']);
  if (meta.frozen_sha256 !== frozen.sha256) refuse('quiz-sha-mismatch', `quiz-meta names ${meta.frozen_sha256}, the frozen list is ${frozen.sha256}`);
  if (meta.assignment_sha256 !== assignment.sha256) {
    refuse('assignment-mismatch', `quiz-source derived ${meta.assignment_sha256}, the census and verify inputs give ${assignment.sha256}`);
  }
  if (meta.below_floor) refuse('input-invalid', 'quiz-meta below-floor: a ruling to proceed lowers quiz.halt_floor in a superseding draft');
  const powerIn = loadInput('power', flags.power, flags['power-sha256']);
  const pwbad = powerError(powerIn.value);
  if (pwbad !== null) refuse('input-invalid', `power shape ${pwbad}`);
  if (powerIn.value.record_sha256 !== rec.sha256) refuse('input-invalid', 'power record-mismatch');
  const inputs = assembled.nodes.map((n) => ({ store_id: n.store_id, census_sha256: n.census_sha256, verify_sha256: n.verify_sha256 }));
  if (canonicalJson(powerIn.value.inputs) !== canonicalJson(inputs)) refuse('input-invalid', 'power inputs-mismatch');
  const pilotResult = loadInput('pilot-result', flags['pilot-result'], flags['pilot-result-sha256']).value;
  const prbad = pilotResultError(pilotResult);
  if (prbad !== null) refuse('input-invalid', `pilot-result shape ${prbad}`);
  const decision = flags['q18-decision'];
  if (!Q18_DECISIONS.includes(decision)) refuse('args-invalid', `q18-decision ${JSON.stringify(decision)} is not one of ${Q18_DECISIONS.join(', ')}`);
  const prior = flags['prior-final'] === undefined ? null : loadInput('prior-final', flags['prior-final'], flags['prior-final-sha256'], RECORD_WORDS);
  const final = buildFinal({
    draft: rec.record, draftSha256: rec.sha256, priorSha256: prior === null ? null : prior.sha256, assembled, assignment,
    power: powerIn.value, powerSha256: powerIn.sha256, frozen, pilotResult, spendBudget: flags['spend-budget'],
    window: { start: flags['window-start'], end: flags['window-end'] }, decision, nowMs: deps.now(),
  });
  const v = validateOpenRecord(final, { draft: rec.record, predecessor: prior === null ? null : prior.value,
    frozen: { families: frozen.families, n_questions: frozen.list.entries.length } });
  if (!v.ok) refuse('record-invalid', v.errors.map((e) => `${e.path} ${e.word}`).join('; '));
  return printWithSha(final);
}

/** `open --draft | --finalize | --template` (W2-D25): writes no file. */
export async function openCommand(flags, driverEnv, deps = { seed: drawSeedHex, now: () => Date.now() }) {
  const modes = ['draft', 'finalize', 'template'].filter((m) => flags[m] === true);
  if (modes.length !== 1) refuse('args-invalid', 'open wants exactly one of --draft, --finalize and --template');
  if (modes[0] === 'template') {
    checkFlags('open --template', flags);
    process.stdout.write(canonicalJson(openTemplate()) + '\n');
    return EXIT.OK;
  }
  return modes[0] === 'draft' ? openDraft(flags, driverEnv, deps) : openFinalize(flags, driverEnv, deps);
}

/** The presence directory's mtime: every write of the one writer renames into it (W2-D28), so it is the newest write. */
function newestPresenceWrite(home) {
  let st;
  try {
    st = lstatSync(historyPaths(home).recallOffDir);
  } catch (e) {
    return e?.code === 'ENOENT' ? { state: 'absent' } : { state: 'unmeasured', code: errCode(e) };
  }
  return st.isDirectory() ? { state: 'value', ms: st.mtimeMs } : { state: 'unmeasured', code: 'not-a-directory' };
}
/** status's recall_off.seen_ms, from the store's presence meta rows through lib's own reader (W2-D31), on the run's one
 *  open store. */
function presenceSeenMs(rs) {
  const rows = rs.db.prepare('SELECT k, v FROM meta WHERE substr(k, 1, ?) = ?').all(RECALL_OFF_META.length, RECALL_OFF_META);
  return recallOffStatusOf(new Map(rows.map((r) => [String(r.k), String(r.v)]))).seen_ms;
}

async function verifyRegistry(flags, env) {
  checkFlags('verify --registry', flags);
  const home = subcommandHome(env);
  const rec = loadRecordInput(flags, 'draft');
  recheckCode(rec.record);   // W2-D24 (verify --registry)
  const census = loadInputs(flags, 'census', OUT_STREAM_CAP);
  if (census.length !== 1) refuse('args-invalid', 'verify --registry reads one census, this node\'s');
  const c = census[0];
  const bad = censusError(c.value);
  if (bad !== null) refuse('input-invalid', `census shape ${bad}`);
  const storeId = nodeStoreId(home);
  requireNamedNode(rec.record, storeId);
  if (c.value.store_id !== storeId) refuse('input-invalid', `census store-id ${c.value.store_id} is not this node's store ${storeId}`);
  let act;
  try {
    act = activeFamilies(storeId, c.value.census, { lookbackMs: rec.record.active_rule.lookback_ms });
  } catch (e) {
    if (!(e instanceof TypeError)) throw e;
    refuse('input-invalid', `census ${storeId} ${e.message}`);
  }
  const reg = historyPaths(home).reg;
  const families = act.active.map((f) => {
    if (!idOk(f.ccrc_id)) refuse('input-invalid', `census family id ${JSON.stringify(f.ccrc_id)} is not a session id`);
    return { ccrc_id: f.ccrc_id, generation: f.generation, state: registryStateOf(readRegPresence(path.join(reg, `${f.ccrc_id}.generation`)), f.generation) };
  });
  return printWithSha(verifyRegistryReport({ recordSha256: rec.sha256, storeId, censusSha256: c.sha256, lookbackMs: rec.record.active_rule.lookback_ms, families }));
}

async function verifyAb(flags, env) {
  checkFlags('verify --section ab', flags);
  const home = subcommandHome(env);
  const rec = loadRecordInput(flags, 'final');
  recheckCode(rec.record);   // W2-D24 (verify --section ab)
  const rs = openReplayStore(home);   // the run's one store open (R3)
  try {
    const storeId = rs.storeId;
    requireNamedNode(rec.record, storeId);
    const families = rec.record.assignment.filter((a) => a.store_id === storeId).map((a) => {
      if (!idOk(a.ccrc_id)) refuse('input-invalid', `assignment family id ${JSON.stringify(a.ccrc_id)} is not a session id`);
      return { ccrc_id: a.ccrc_id, generation: a.generation, arm: a.arm, state: abStateOf(a.arm, a.generation, controlFileOf(home, a.ccrc_id)) };
    });
    const newest = newestPresenceWrite(home);
    const seen = presenceSeenMs(rs);
    return printWithSha(verifyAbReport({ recordSha256: rec.sha256, storeId, families, newest, seen }));
  } finally {
    rs.close();
  }
}

/** `verify --registry | --section ab` (W2-D84, this PR's half): read-only on one node; a finding is data, exit 0. */
export async function verifyCommand(flags, env) {
  const registry = flags.registry === true;
  if (registry === (flags.section !== undefined)) refuse('args-invalid', 'verify wants exactly one of --registry and --section');
  if (registry) return verifyRegistry(flags, env);
  if (flags.section !== 'ab') refuse('args-invalid', `section ${JSON.stringify(flags.section)}: this build verifies ab only`);
  return verifyAb(flags, env);
}

HANDLERS.set('pilot-source', (flags, env) => pilotSourceCommand(flags, env));
HANDLERS.set('quiz-source', (flags, env) => quizSourceCommand(flags, env));
HANDLERS.set('freeze', freezeCommand);
HANDLERS.set('power', powerCommand);
HANDLERS.set('open', (flags, env) => openCommand(flags, env));
HANDLERS.set('verify', verifyCommand);
```

Then, in W2-4's `recallOffPresence` JSDoc (about :2069 at cd622b2f6), replace the one line

```js
 *  The driver never opens the entry (W2-D29): this lstat line is its one recall-off line. */
```

with

```js
 *  It never opens the entry (W2-D29): this lstat line is the presence check's one recall-off line (W2-D78(ii)).
 *  verify --section ab's controlFileOf reads a control file's content, through readBounded (W2-D84). */
```

The line occurs once (`grep -c 'this lstat line is its one recall-off line' deploy/history-replay.mjs` prints 1 before, 0 after). Neither new line spells a `recallOffPath(` call or a `.mjs:` citation, so W2-4's re-pinned structural case (two code lines), single-definition's O13 and D-5893's ratchet read the file as before.

- [ ] **Step 8: Run them and see them pass, then the typecheck.** In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-5a Task 7|FLAG_SPECS declares exactly|three box-mode spawns, one per taught spelling|names recall-off on exactly two code lines|imports exactly its fourteen modules|no violation, and the entry guard')
(cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts)
```

Expected (predicted, not measured): green:
- every case of this task's describe, root or not (no case here needs a mode-000 file; `ROOT_SKIP` is declared for a worker who adds one, who then says so); on darwin the end-to-end walk is skipped;
- the three re-pinned W2-4 cases and Task 1's import pin;
- W2-4 Task 5's env scan over the driver (`no violation, and the entry guard…`): every handler that takes `deps` names its env parameter `driverEnv`, so no code line holds `, env,`;
- `typecheck-tests`, with `withHandler`'s `h` widened in Step 2 (without it, `replay.HANDLERS.set(sub, h)` is a type error once `Flags` carries `string[]`).

Record the measured pass count in the commit's task note.

A `typecheck-tests` red on an `r7drv.*` call's inferred JSDoc type is fixed with a cast at the call site, as W2-4's cases cast `codeShas`, and never by loosening the driver's JSDoc.

- [ ] **Step 9: Measure every guard red, then green.** From the repository root. Each block applies one exact replacement, which must match exactly once, runs one filter and shows it red, then restores the file with `cp`. The python body is a quoted heredoc. The "Expected RED" lines are predicted. Measure each one, and correct its line in this commit if the measurement differs.

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w2-5a/scratch"; mkdir -p "$SCRATCH"
mut() {   # mut <file> <old> <new>: one exact replacement, asserted to match once
  python3 - "$1" "$2" "$3" <<'EOF'
import sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
assert s.count(old) == 1, (p, old, s.count(old))
open(p, 'w').write(s.replace(old, new))
EOF
}
F=deploy/history-replay.mjs
cp "$F" "$SCRATCH/replay.t7.orig"
t() { (cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t "$1"); cp "$SCRATCH/replay.t7.orig" "$F"; }

# M1: a list flag keeps only its last value.
mut "$F" "      flags[name] = [...(/** @type {string[]} */ (flags[name] ?? [])), value];" "      flags[name] = [value];"
t 'a list flag collects every value'
# Expected RED: 1 failed. expected { census: [ '/c/b' ], … } to deeply equal { census: [ '/c/a', '/c/b' ], … }.

# M2: a subcommand ignores a flag it never reads.
mut "$F" "  for (const k of Object.keys(flags)) if (!known.has(k)) refuse('args-invalid', \`--\${k} is not a \${form} flag\`);" ""
t 'each subcommand refuses a flag it never reads'
# Expected RED: 9 failed (every row but step0a's). Each reaches a later refusal (a -required word, or exit 0 for open --template).

# M3: step0a ignores a flag it never reads.
mut "$F" "  for (const k of Object.keys(flags)) if (!STEP0A_REQUIRED.includes(k) && k !== 'settings-mode') refuse('args-invalid', \`--\${k} is not a step0a flag\`);" ""
t 'each subcommand refuses a flag it never reads'
# Expected RED: 1 failed, the step0a row: 'args-invalid: out-required' in place of '--record is not a step0a flag'.

# M4: open accepts two modes.
mut "$F" "  if (modes.length !== 1) refuse('args-invalid', 'open wants exactly one of" "  if (modes.length === 0) refuse('args-invalid', 'open wants exactly one of"
t 'open wants exactly one mode'
# Expected RED: 1 failed. '--draft --template' reaches open --draft's checkFlags: '--template is not a open --draft flag'.

# M6: a flag only the arm argv carries (step 0a never measures it).
mut "$F" "  if (mode === 'arm' || mode === 'box') argv.push('--tools', 'Bash,Agent'" "  if (mode === 'arm') argv.push('--permission-mode', 'default');
  if (mode === 'arm' || mode === 'box') argv.push('--tools', 'Bash,Agent'"
t 'step0a records every flag the contract carries'
# Expected RED: 2 failed (both settings modes). Step 0a's keys are one fewer than contractFlags: --permission-mode is in
# contractFlags (the arm argv) and not in step 0a's flags_accepted (no step 0a run carries it).
# M6c (CONTROL): the same flag on the arm AND the box argv: step 0a's box run carries it, so the pin stays green.
mut "$F" "  if (mode === 'arm' || mode === 'box') argv.push('--tools', 'Bash,Agent'" "  if (mode === 'arm' || mode === 'box') argv.push('--permission-mode', 'default');
  if (mode === 'arm' || mode === 'box') argv.push('--tools', 'Bash,Agent'"
t 'step0a records every flag the contract carries'
# Expected GREEN: 2 passed.

# M7: open --draft takes a step 0a whose flags_accepted is incomplete.
mut "$F" "    if (missing.length + extra.length > 0) {" "    if (false) {"
t 'flags_accepted does not name exactly'
# Expected RED: 1 failed. The record validates (no flag is false), so open --draft exits 0 with a record.

# M8: an input parsed before its sha is checked.
mut "$F" "  if (got !== sha256) refuse(words.sha, \`\${label}: expected \${sha256}, measured \${got}\`);
  let value;" "  let value;"
mut "$F" "  return { path: abs, sha256: got, value };" "  if (got !== sha256) refuse(words.sha, \`\${label}: expected \${sha256}, measured \${got}\`);
  return { path: abs, sha256: got, value };"
t 'record-sha-mismatch, checked before|wrong sha on a non-JSON input'
# Expected RED: 2 failed. 'record-invalid: record not-json' and 'input-invalid: census not-json' in place of the sha words.

# M9: an input inside a git tree is read.
mut "$F" "  if (g.state === 'inside') refuse(words.invalid, \`\${label} in-git-tree \${g.at}\`);" ""
t 'inside a git tree is record-invalid'
# Expected RED: 1 failed. 'record-sha-mismatch' or 'record-invalid: record part undefined' in place of 'record in-git-tree'.

# M10: each subcommand's re-check removed, one at a time (W2-D24).
for sub in 'quiz-source' 'freeze' 'power' 'open --finalize' 'verify --registry' 'verify --section ab'; do
  mut "$F" "  recheckCode(rec.record);   // W2-D24 ($sub)" ""
  t "re-checks the code it runs under: $sub|for a gate_code file that cannot be read: $sub"
  # Expected RED: 2 failed for that subcommand. Under the edited tree it reaches its next read: 'input-invalid: census
  # unreadable ENOENT' (sourced for freeze; 'store-unreadable: store-missing' for verify ab), in place of code-changed or
  # code-unmeasured.
done
# M10b: the re-check moved after the census read (power).
mut "$F" "  recheckCode(rec.record);   // W2-D24 (power)
  const assembled = assembleCensus(rec.record, loadInputs(flags, 'census', OUT_STREAM_CAP), loadInputs(flags, 'verify'));
  return printWithSha" "  const assembled = assembleCensus(rec.record, loadInputs(flags, 'census', OUT_STREAM_CAP), loadInputs(flags, 'verify'));
  recheckCode(rec.record);   // W2-D24 (power)
  return printWithSha"
t 're-checks the code it runs under: power'
# Expected RED: 1 failed. 'input-invalid: census unreadable ENOENT' in place of 'code-changed: changed deploy/measure-history.py'.

# M11: the assembler's node checks, each removed.
mut "$F" "    if (!labels.has(sid)) refuse('input-invalid', \`census store-id-unlisted \${sid}\`);" ""
t 'census assembler checks nodes only'
# Expected RED: 1 failed. The unlisted census passes, and the next answer is 'verify node-missing' or exit 0.
mut "$F" "    if (v.value.census_sha256 !== node.census_sha256) refuse('input-invalid', \`verify census-mismatch \${node.store_id}\`);" ""
t 'census assembler checks nodes only'
# Expected RED: 1 failed. A verify output bound to another census is accepted (exit 0 with figures).
mut "$F" "    if (got !== want) refuse('input-invalid', \`verify families-mismatch \${node.store_id}\`);" ""
t 'census assembler checks nodes only'
# Expected RED: 1 failed. A verify output missing a family is accepted, and that family is neither kept nor dropped.

# M12: registryStateOf folds unreadable into absent.
mut "$F" "  if (read.state !== 'value') return 'unreadable';
  return read.value === generation" "  if (read.state !== 'value') return 'registry-absent';
  return read.value === generation"
t 'W2-5a Task 7: verify registry'
# Expected RED: 2 failed. a-c2 reads registry-absent; registryStateOf({state: 'unreadable'}) is registry-absent.

# M13: power reads rho_headline twice (no rho 0 figure).
mut "$F" "    for (const rho of [s.rho_headline, 0]) {" "    for (const rho of [s.rho_headline, s.rho_headline]) {"
t 'reads q18_settings: one q18Power call'
# Expected RED: 1 failed. figures[1].rho is 0.3, not 0, and at_rho_0 is null (no figure at rho 0).

# M14: power ignores q18_settings.sims.
mut "$F" "rho, power, sims: s.sims, gridStep: s.grid_step" "rho, power, sims: s.sims + 1, gridStep: s.grid_step"
t 'reads q18_settings: one q18Power call'
# Expected RED: 1 failed. points' shares are over 3 simulations, not 2.

# M15: covered_days ignores the tick coverage.
mut "$F" "  const from = Math.max(census.since_ms, t.first_ts_ms);" "  const from = census.since_ms;"
t 'reads q18_settings: one q18Power call|coveredDays: the look-back clipped'
# Expected RED: 2 failed. covered_days 14, not 7, so n_f is windows × 1, not × 2.

# M16: a census over another span accepted.
mut "$F" "    if (c.as_of_ms - c.since_ms !== lookbackMs) {" "    if (false) {"
t 'over another span than lookback_days'
# Expected RED: 1 failed. power exits 0.

# M17: open --finalize skips the assignment re-derivation.
mut "$F" "  if (meta.assignment_sha256 !== assignment.sha256) {" "  if (false) {"
t 'changed between quiz-source and open --finalize'
# Expected RED: 1 failed. The next refusal is 'input-invalid: power inputs-mismatch'.

# M18: freeze concatenates in input order (no rank sort).
mut "$F" "  const all = lists.flat().sort(byRank);" "  const all = lists.flat();"
t 'W2-5a Task 7: freeze'
# Expected RED: 2 failed. The cut at target 3 keeps abc0001, abc0002 and abc0003; the duplicate rank goes unseen.
# R11's short_of_min_families case stays green: that cut and the ranked one both hold 2 families.

# M19: freeze accepts a forged qid.
mut "$F" "      if (qidOf(e) !== e.qid) refuse('input-invalid', \`sourced entry \${e.qid} qid-mismatch\`);" ""
t 'refuses a sourced list of another record'
# Expected RED: 1 failed. freeze exits 0 with the forged entry.

# M20: verify ab never reports a treatment file naming its own generation.
mut "$F" "  return read.value.trim() === generation ? 'treatment-named' : 'ok';" "  return 'ok';"
t 'W2-5a Task 7: verify section ab'
# Expected RED: 2 failed: the treatment-named row and abStateOf's function case.

# M21: a control file compared untrimmed.
mut "$F" "    return read.value.trim() === generation ? 'ok' : 'control-mismatch';" "    return read.value === generation ? 'ok' : 'control-mismatch';"
t 'W2-5a Task 7: verify section ab'
# Expected RED: at least 2 failed. Every control file the verb writes ends in a newline, so each reads control-mismatch.

# M22: seen_ms read without the newest write.
mut "$F" "  const seenAfter = seen !== null && (newest.state === 'absent' || (newest.state === 'value' && seen > newest.ms));" "  const seenAfter = seen !== null;"
t 'seen_ms before the newest write'
# Expected RED: 1 failed. seen '1' reads seen_after_write true.

# M23: verify runs on a store the record does not name.
mut "$F" "  if (!record.nodes.some((n) => n.store_id === storeId)) refuse(" "  if (false) refuse("
t 'refuses on a store the record does not name|refuses on a node the record does not name'
# Expected RED: 3 failed (verify registry, verify ab and quiz-source).

# M24: the template drops fixed and default values.
mut "$F" "  if (Object.hasOwn(f, 'value')) return copyJson(f.value);
  if (f.fields) return skeletonOf(f.fields);" "  if (f.fields) return skeletonOf(f.fields);"
t 'open --template prints a skeleton'
# Expected RED: 1 failed. t.draft.kind reads '<fixed string>'.

# M25: an override of a non-default field accepted.
mut "$F" "    refuse('args-invalid', \`override \${p} is \${f.status}\`);" "    target[k] = copyJson(v);"
t 'the overrides file changes default fields only'
# Expected RED: 1 failed. 'override k is fixed' is not answered; the validator refuses k constant-mismatch instead.

# M26: open --finalize takes a power output of another record.
mut "$F" "  if (powerIn.value.record_sha256 !== rec.sha256) refuse('input-invalid', 'power record-mismatch');" ""
t 'refuses a power output of another record'
# Expected RED: 1 failed. That run exits 0.

# M27: quiz-source excludes nothing.
mut "$F" "        exclude: { pilotFamilies: copyJson(rec.record.pilot.families), assignment: copyJson(assignment.list) }," "        exclude: { pilotFamilies: [], assignment: [] },"
t 'control ids and pilot families excluded'
# Expected RED: 1 failed. expected { pilotFamilies: [], assignment: [] } to deeply equal { pilotFamilies: [ …(1) ], assignment: [ …(6) ] }.

# M28: pilot-source's preflight stamps a code change instead of refusing it (Task 6's openWriter, W2-D6).
mut "$F" "expected: step0a, lang: driverEnv.LANG, idx: rs.idx });" "expected: step0a, allowCodeChange: true, lang: driverEnv.LANG, idx: rs.idx });"
t 'pilot-source refuses code-changed against step 0a'
# Expected RED: 1 failed. The fake sourceQuiz is called and pilot-source writes its output.

# M29: quiz-source's preflight reads the stamp it runs under, not part 1's.
mut "$F" "        expected: { claude_code_version: entry.claude_code_version, release_stamp: rec.record.gate_code.release_tag," "        expected: { claude_code_version: entry.claude_code_version, release_stamp: readReleaseStamp(home).tag,"
t 'quiz-source is preflighted against part 1'
# Expected RED: 1 failed. The tree-moved half finds no refusal; the fake sourceQuiz is called.

# M30: Q18_FIGURES reads another level than the validator's.
mut "$F" "  at_power_80: Object.freeze({ power: 0.8, rho: 'headline' })," "  at_power_80: Object.freeze({ power: 0.9, rho: 'headline' }),"
t 'Q18_FIGURES reads exactly the two levels'
# Expected RED: 1 failed. expected [ 0.5, 0.9 ] to deeply equal [ 0.5, 0.8 ].

# M31: REGISTRY_STATES drifts from the validator's drop reasons.
mut "$F" "export const REGISTRY_STATES = Object.freeze(['ok', 'registry-mismatch', 'registry-absent', 'unreadable']);" "export const REGISTRY_STATES = Object.freeze(['ok', 'registry-mismatch', 'registry-gone', 'unreadable']);"
t 'REGISTRY_STATES is ok plus'
# Expected RED: 1 failed. A drop reason 'registry-gone' is refused value-outside-set.

# M32: a final's frozen list not compared with the record's quiz sha.
mut "$F" "    if (fz.sha256 !== want) refuse('quiz-sha-mismatch'," "    if (false) refuse('quiz-sha-mismatch',"
t 'a final is read with its draft'
# Expected RED: 1 failed. The edited list's families and count are unchanged, so the record validates and verify reaches its store read.

# M33: content read through the driver's own lstat-only presence check.
mut "$F" "state: abStateOf(a.arm, a.generation, controlFileOf(home, a.ccrc_id))" "state: abStateOf(a.arm, a.generation, { state: recallOffPresence(home, [a.ccrc_id]).present.length > 0 ? 'value' : 'absent', value: '' })"
t 'W2-5a Task 7: verify section ab'
# Expected RED: at least 2 failed. A present control file reads value '' and so control-mismatch; the presence check is not
# a content read.

# M34: an unreadable control file folded into absent.
mut "$F" "  return r.state === 'value' ? { state: 'value', value: r.value } : r.state === 'absent' ? { state: 'absent' } : { state: 'unreadable' };" "  return r.state === 'value' ? { state: 'value', value: r.value } : { state: 'absent' };"
t 'a control file that is a directory'
# Expected RED: 1 failed. The directory reads control-absent, not unreadable.

# M35 (R7, W2-D68): B's text leaks into what a sourcing run writes.
mut "$F" "  counts.drops = sampled.drops;" "  counts.drops = sampled.drops;
  counts.b = [...baselines.values()].map((b) => b.text);"
t 'leaves no B text anywhere under --out'
# Expected RED (non-darwin): 1 failed. pilot-source.json carries the counts, and with them the summary's sentinel.

# M36 (W2-4 Task 5's env scan): a handler's env parameter spelled env before deps.
mut "$F" "async function openFinalize(flags, driverEnv, deps) {" "async function openFinalize(flags, env, deps) {"
t 'no violation, and the entry guard'
# Expected RED: 1 failed. envViolations(driverText) is [ 'async function openFinalize(flags, env, deps) {' ], not [].

# M37 (W2-D55): quiz-source's writer gate on a constant budget, not part 1's pilot_budget.
mut "$F" "claim, budget: rec.record.pilot_budget, limits: rec.record.limits," "claim, budget: 100_000, limits: rec.record.limits,"
t 'hands part 1.s pilot_budget and limits'
# Expected RED (non-darwin): 1 failed. The tight case's second ask spawns; no budget-exhausted.

# M38 (W2-D55): quiz-source's writer gate on the driver's defaults, not part 1's limits.
mut "$F" "claim, budget: rec.record.pilot_budget, limits: rec.record.limits," "claim, budget: rec.record.pilot_budget, limits: LIMITS_DEFAULTS,"
t 'hands part 1.s pilot_budget and limits'
# Expected RED (non-darwin): 1 failed. The low-threshold case passes the open (five 10 under 70) and spawns.

# M39 (W2-D55): pilot-source's writer gate on a constant budget, not --budget.
mut "$F" "claim, budget: flags.budget, limits: LIMITS_DEFAULTS," "claim, budget: 100_000, limits: LIMITS_DEFAULTS,"
t 'hands --budget to the writer gate'
# Expected RED (non-darwin): 1 failed. Both asks spawn; no budget-exhausted.

# M40 (R10, C1): quiz-source hands sourceQuiz the census's kept list again.
mut "$F" "        mode: 'quiz', rs, home, out, writer, seedHex: rec.record.bootstrap.seed," "        mode: 'quiz', rs, home, out, writer, seedHex: rec.record.bootstrap.seed, families: copyJson(assembled.kept),"
t 'control ids and pilot families excluded'
# Expected RED: 1 failed. Object.hasOwn(input, 'families') is true.

# M41 (R10): freeze merges by a numeric family rank, the rule before the order key.
mut "$F" "  const byRank = (a, b) => cmpUnit(a.rank[0], b.rank[0]) || a.rank[1] - b.rank[1];" "  const byRank = (a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1];"
t 'W2-5a Task 7: freeze'
# Expected RED: 6 failed, every freeze case. Two keys subtract to NaN, so only the candidate ranks compare: chain7's own
# mergeSourced call refuses `input-invalid sourced rank-duplicate <key>:0` (two families' first candidates tie), and every
# freeze case builds chain7, R11's short_of_min_families case (twice) included.

# M42 (R10): pilot-source asks the writer model only inside openWriter, after prepareOut made --out.
mut "$F" "  refuseWriterModel(writerModel);   // R10: a refusal that needs no store and no spawn answers before --out exists
" ""
t 'refuses before prepareOut makes --out'
# Expected RED: 1 failed. The refusal is the same args-invalid line (openWriter's own call), but made is true where false
# was expected.

# M43 (W2-D71): freeze merges whatever lists it is given, a named node's missing list unseen.
mut "$F" "  for (const n of rec.record.nodes) if (!stores.has(n.store_id)) refuse('input-invalid', \`sourced node-missing \${n.label}\`);
" ""
t 'lacks a named node'
# Expected RED: 1 failed. freeze exits 0 over node-a's list alone: stderr is its 'sha256 …' line where
# 'input-invalid: sourced node-missing node-b' was expected.

# M44 (R11): the meta drops short_of_min_families.
mut "$F" "    short_of_min_families: families.length < minFamilies, sourced };" "    sourced };"
t 'reports short_of_min_families'
# Expected RED: 1 failed. expected [ 3, 2, false, undefined ] to deeply equal [ 3, 2, false, true ]. No other case
# reads the flag: the first freeze case matches the meta with toMatchObject, and open --finalize never reads it.

cmp "$F" "$SCRATCH/replay.t7.orig" && echo restored
```

Then run Step 8's commands again: green (predicted).

- [ ] **Step 10: Run the neighbours that read the driver.** In the foreground, with a timeout of at least 600000 ms. If a file goes red, re-run it alone before calling it a break (CLAUDE.md's load flakes; `typecheck-tests` is one):

```bash
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'recall-off')
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'operator switches have readers only|every vocabulary is declared once')
(cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts -t 'W2-3 Task 9')
(cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts)
```

Expected: green (predicted):
- `history-replay`: every earlier task's cases, the three re-pinned W2-4 cases, and this task's.
  - W2-4 Task 7's structural pin, re-pinned in Step 2, reads two `recallOffPath(` code lines (W2-4's `lstatSync` and `controlFileOf`'s `readBounded`) and no line spelling the directory.
  - W2-4 Task 5's env scan still finds the entry guard's projection as the one `process.env` line, and no violation: the five handler declarations that take `deps` and `openCommand`'s dispatch spell `driverEnv`, never `, env,` (Step 8 runs it; M36 shows it red).
- `single-definition -t 'recall-off'`: `1 passed`.
  - O13's writer scan reads every line that names a recall-off needle: this task's are a `readBounded` read and an `lstatSync` of `recallOffDir`, and neither holds a write verb.
  - Its `lstatSync(recallOffPath(` count for the driver stays 1.
- `single-definition`'s O14 case: no name this task declares is a `VOCABS` name.
- `measure-history -t 'W2-3 Task 9'`: unchanged. This task never edits the gate.

- [ ] **Step 11: Commit.**

```bash
git add deploy/history-replay.mjs server/test/history-replay.test.ts
CO_AUTHORED_BY='<the Co-Authored-By line the attribution reminder gives>'
git commit -m "feat(history-replay): the record subcommands, pilot-source, quiz-source, freeze, power, open and verify, each re-checking the code it runs under (W2-5a Task 7; W2-D84, W2-D24, W2-D73, W2-D21, W2-D19, W2-D20, W2-D25, W2-D71; D-5773, D-6280)" -m "$CO_AUTHORED_BY"
```


### Task 8: the departures, the whole-PR checks and the PR

Tasks 1 to 7 ship W2-5a's code and pins. This task adds no code, no test and no guard. It measures what the PR holds against what W2-5a may hold:
- the departures this plan defines, each defined once;
- the file list, and the added lines (citations, shells, live reads, key-shaped literals, D-number ranges, hosts and home paths, private names);
- the carries W2-5a owes, each checked by content:
  - W2-1's R1: the driver's header no longer says it "never loads node:sqlite in any form";
  - decisions §7: the `CODE_SHA_FILES`/`GATE_CODE_FILES` parity pin and the `flags_accepted` parity pin;
  - W2-D33: the `keptOf` scan.

It then runs the whole-PR suites, one per tool call, writes the PR body and opens the PR.

**W2-5a never touches the spec.** It is not one of the PRs that hold the spec path (W2-D3: 5h-1, 5h-2, W2-1, W2-5b and W2-6). Three errata come from W2-5a's own decisions: E19 (§10.2's Answerability, W2-D70, D-5780), E20 (§10.2's "sees F and its span", W2-D72, D-5779) and E23 (§10.2's Pre-registration: the two-part record and its code hashes). All three are **amended in place by W2-5b**, as decisions §6's "Amended by" column says. Step 2 asserts that the PR's diff holds no spec path and that each of the three rev 3.6 sentences still stands on this branch, once, unchanged.

**The departures.** This plan defines five numbers in its `## Deviations found`, each naming the task that first cites it (R1):

| Number | Slug | Task |
|---|---|---|
| D-5780 | `history-w2-answerable-timed` (W2-D70, spec erratum E19, which W2-5b amends) | 5 |
| D-6277 | `history-replay-pointer-lines` | 1 |
| D-6278 | `history-replay-baseline-kept-not-a-stop` | 4 |
| D-6279 | `history-replay-baseline-object-leaves` | 4 |
| D-6280 | `history-replay-spend-budget-operator-given` | 7 |

D-5780 is the one number of the ledger's W2 block (the 19 numbers issued on 2026-10-19) whose "Defined in" names W2-5a; the other four were issued for this plan's planning departures. No other number in the W2 block names W2-5a:
- D-5773 (`verify --registry`'s half of W2-D20), D-5776 (the answer-field composer, W2-D64) and D-5779 (the writer spawn, W2-D72) all name W2-3 first, and W2-3's plan defines them;
- D-5766 (W2-D34's same-millisecond count) is W2-2a's, defined in W2-2a's plan in the same docs PR as this one (E11).

W2-5a cites those four bare. It also cites bare D-5774 (W2-3's plan; the driver's words stay deploy-local, W2-D12), D-5812 (W2-4's plan; step 0a's three inits are non-null, which `open --draft` copies) and D-6238 (W2-1's plan; `expandEntryBody`'s five states, each counted by its own reason, W2-D68).

The plan is on `main` before dispatch. Step 1 checks, for each of the five: there is exactly one entry, it carries its slug, the task it names is the first `### Task` section that cites the number, and no other plan on `origin/main` defines it.

A number the coordinator issues to this run during the build is defined in this plan's `## Deviations found`, in the commit that first cites it. The plan path is therefore the one path outside the two W2-5a files that this PR may edit (Step 3).

**Not this task's, never touched here:** W2-5b's errata (E2, E7, E8, E9, E10, E11, E19, E20, E21, E22, E23 and E24) and W2-6's (E25); the programme ledger; `single-definition.test.ts` and `lifecycle.test.ts`, which this task runs and never edits; every operator act in decisions §5.

**Files:** anchors measured at `cd622b2f6`, hints only, each re-anchored by its quoted content.
- Modify: none. This task changes no tracked file when every check is green. When a check finds a defect, the fix goes into the task that owns the code, as that task's correction commit (see **Commit**), never here.
- Read, no edit:
  - `deploy/history-replay.mjs`, for six things:
    - its header comment, lines 2 to about :22, whose sentence "Imports: node: built-ins, ../ccd/history/lib.mjs and ../shared/roster-json.mjs only. It never loads node:sqlite in any form" starts about :9 at `cd622b2f6`;
    - `export const DRIVER_REASONS` (about :45), 28 words at `cd622b2f6`;
    - `export const HANDLERS = new Map();` (about :106), with its `HANDLERS.set('step0a', …)` (about :2275) and `HANDLERS.set('probe', …)` (about :2427);
    - `export const CODE_SHA_FILES` (about :1888);
    - `export function recallOffPresence(home, ids)` (about :2070);
    - its one `lstatSync(recallOffPath(` line.
  - `deploy/history-gate.mjs`: its one import line, `import { EXIT, RECALL_OFF_META, UUID_RE, canonicalJson, isSyntheticModel, pickHoldingCopy, producerOf, sha256Hex } from '../ccd/history/lib.mjs';` (about :23), and `export const GATE_CODE_FILES` (about :145).
  - `ccd/history/sweep.mjs`: `export function recallOffPresence(home, id)` (about :813).
  - `server/test/single-definition.test.ts`: O13's case `'recall-off/<id>: exactly one writer, sweep.mjs'` (about :5274). It pins exactly one driver line holding `lstatSync(recallOffPath(` (about :5286), with the message `the replay driver's one recall-off line (W2-D78 (ii))`.
  - `server/test/lifecycle.test.ts`: the `history-replay-out` case, which imports `OUT_MARKER` from the driver in-process (about :1336).
  - `server/test/growth-check.test.ts`: `GROWTH_FILES` (about :57), nine files, none under `deploy/`.
  - `server/test/citations.test.ts`: `CITATION` (about :50), `/ccd:\d{3,5}\b|\.(?:ts|tsx|mjs|sh):\d+\b/g`.
  - `server/test/dtbd.test.ts`: `PATTERN` (about :18), the placeholder prefix and `'-[a-z0-9]'` joined at runtime, so the file never spells the token it scans for.
  - The spec's three sentences E19, E20 and E23 (about :2663, :2667 and :2735).
  - This plan's `## Deviations found`.
- Create (gitignored scratch, never committed): `.superpowers/sdd/history-w2-5a/pr-body.md`, `.superpowers/sdd/history-w2-5a/t8-dnum.mjs`, and the scratch copy `.superpowers/sdd/history-w2-5a/scratch/plan-control.md`, which Step 1 removes.
- Never edited by this task: anything. The PR as a whole never edits `ccd/**`, `shared/**`, the spec, `README.md`, `deploy/history-gate.mjs`, `deploy/measure-history.py`, `.github/**`, the ledger or any test file other than `server/test/history-replay.test.ts`.

**Interfaces:**
- Consumes (names Step 1 measures; this task defines none):
  - `deploy/history-replay.mjs`:
    - `DRIVER_REASONS: readonly string[]`;
    - `HANDLERS: Map<string, (flags, env) => Promise<number>>`, whose keys after Tasks 1 to 7 are `freeze`, `open`, `pilot-source`, `power`, `probe`, `quiz-source`, `step0a` and `verify` (W2-D84's first half; W2-D73; W2-D21; W2-4's two);
    - `CODE_SHA_FILES: readonly ['deploy/history-gate.mjs', 'deploy/measure-history.py', 'deploy/history-replay.mjs', 'ccd/history/lib.mjs']`;
    - `recallOffPresence(home: string, ids: string[])`, W2-4's export, unchanged;
    - exactly one line holding `lstatSync(recallOffPath(`.
  - `deploy/history-gate.mjs`: `GATE_CODE_FILES` (same four paths, same order), imported by the driver and never edited.
  - `ccd/history/sweep.mjs`: `recallOffPresence(home: string, id: string)`, which the driver never imports, under any name (R6): `verify --section ab` reads content through `readBounded` (W2-D84).
  - This plan's `## Deviations found`: the five entries above, plus one per number issued during the build.
- Produces: no code. It produces the PR body file, the PR, and the measured summary lines the body carries.

**Choices this task makes:**
- **No commit of its own.** Every check reads. A check that finds a defect sends the fix to the task that owns the code, as a commit named for that task. Two things are recorded in this plan in the commit that needs them, never in a separate Task 8 commit: a corrected prediction, and a number issued during the build.
- **The suites W2-5a's change can reach, and only those, are required.** W2-5a edits the driver and its test file, so these are required:
  - `history-replay`, whole, in one vitest process;
  - `lifecycle`, which imports the driver in-process, so the driver's new import graph runs in its worker (W2-1's residual: importing `cli.mjs` sets the importing process's umask to 0o077);
  - `single-definition`, which scans `deploy/*.mjs` (O13, O14's `DECL_CORPUS`);
  - `citations`, `topology-clean`, `dtbd`, `ci-pipeline` and `deviation-refs`, which read the tree;
  - `growth-check` under `GROWTH_CHECK=1`;
  - `docs-policy`, named by the coordinator's list. It is the native docs reader's policy suite and reads nothing W2-5a changes; it runs as a control;
  - both `tsc` projects.

  The gate's own suite, `measure-history.test.ts`, is required only if Step 3 shows the gate's import line moved or `lib.mjs` changed. It should not: the gate imports only `lib.mjs`, which W2-5a never edits, and that suite neither imports nor reads the driver.
- **Growth.** `deploy/history-replay.mjs` is not a `GROWTH_FILES` entry. The nine listed files are `ccd/ccd`, `ccd/ccrc`, `ccd/session-hook.sh`, `server/src/watch.ts`, `server/src/coord/store.ts`, `server/src/coord/routes.ts`, `server/src/server.ts`, `server/src/sessionws.ts` and `pwa/src/lib/api.ts` (D-5848, armed by the operator on 2026-10-21, D-6178). So growing the driver by hundreds of lines needs neither an exemption (`growth-exemptions.json`, D-6211) nor a waiver entry (`growth-waivers.json`, D-6223): both apply only to a listed file. The `L1_L2_NEW_FILE_DIRS` waiver does not apply either, because the PR creates no file. Step 3 measures that the PR touches no listed file, and Step 6 runs the check armed.
- **The added-line scans read only the two W2-5a files' added lines, the commit messages, the PR title and the PR body.** They print counts, never a matched token. A non-zero private-name count is judged by its line numbers only.

**Live safety.** This task runs suites and read-only greps. Every suite it runs drives the driver as W2-4's and Tasks 1 to 7's cases do:
- with `mkTmp` fixture HOMEs and `scrubbedEnv(process.env)`;
- spawns reach a recording node stub at `$HOME/.local/bin/<id>`, never a real Claude Code;
- `PATH` is `<out>/poison-bin:…`, with a poisoned `gh`;
- stores are fixture stores built in the case's temp tree.

Step 4's scans check the added test lines for two hazards: a live-HOME read, and a spawn of a bare `claude`, `ccd`, `ccrc`, `gh` or `sqlite3`. No step reads `~/.ccrc`, `~/.cc-sessions`, `~/.cc-limits` or any account home. No step runs `claude`, `ccd`, a `ccrc` verb, the history shim, `sweep.mjs`, `cli.mjs`, `deploy/history-gate.mjs` or `deploy/measure-history.py` against a live home. Step 1's `node -e` imports the driver to read three constants: the entry guard is false under `node -e` (no `argv[1]`), and the only side effect is `cli.mjs`'s `process.umask(0o077)` in that short-lived process. The fixture directories the suites create are removed by their own `afterEach`/`afterAll`. Step 8 checks that `git status --short` is empty.

- [ ] **Step 0: Check the base and the tree.** From the repository root:

```bash
git merge-base --is-ancestor cd622b2f6 HEAD && echo 'base holds W2-1' || echo 'STOP: W2-1 (#1105) is not on this base'
git status --short | wc -l
git log --oneline origin/main..HEAD | wc -l
```

Expected: `base holds W2-1`, then `0` (Tasks 1 to 7 committed, nothing staged), then the count of this branch's commits: 7, or more when a task added a correction commit. On `STOP`, report to the coordinator and run nothing else.

- [ ] **Step 1: The departures.** Write the checker as a quoted heredoc, so nothing in it expands:

```bash
mkdir -p .superpowers/sdd/history-w2-5a/scratch
cat > .superpowers/sdd/history-w2-5a/t8-dnum.mjs <<'EOF'
// Reads one plan file. For each number this plan defines, prints how often it is defined, its slug, the task its entry
// names and the first task section that cites it; then every number the plan defines. Reads only argv[2].
import { readFileSync } from 'node:fs';
const t = readFileSync(process.argv[2], 'utf8');
const lines = t.split('\n');
const dev = t.indexOf('\n## Deviations found');
const body = dev < 0 ? t : t.slice(0, dev);
const sections = body.split(/\n(?=### Task \d+:)/).filter((p) => /^### Task \d+:/.test(p));
for (const d of ['D-5780', 'D-6277', 'D-6278', 'D-6279', 'D-6280']) {
  const head = `- **${d}** — `;
  const defs = lines.filter((l) => l.startsWith(head));
  const m = defs.length === 1 ? defs[0].slice(head.length).match(/^`([^`]+)` \(Task (\d+);/) : null;
  const first = sections.find((p) => p.includes(d));
  console.log(d, 'defined', defs.length, 'slug', m ? m[1] : 'none', 'entry-task', m ? m[2] : 'none',
    'first-citing', first ? first.match(/^### Task (\d+):/)[1] : 'none');
}
const all = lines.map((l) => l.match(/^- \*\*(D-\d+)\*\* — /)).filter(Boolean).map((x) => x[1]);
console.log('plan-defines', all.join(' '));
EOF
PLAN=docs/superpowers/plans/2026-10-22-ccrc-history-w2-5a-quiz-builder.md
node .superpowers/sdd/history-w2-5a/t8-dnum.mjs "$PLAN"
```

Expected:
- `D-5780 defined 1 slug history-w2-answerable-timed entry-task 5 first-citing 5`;
- `D-6277 defined 1 slug history-replay-pointer-lines entry-task 1 first-citing 1`;
- `D-6278 defined 1 slug history-replay-baseline-kept-not-a-stop entry-task 4 first-citing 4`;
- `D-6279 defined 1 slug history-replay-baseline-object-leaves entry-task 4 first-citing 4`;
- `D-6280 defined 1 slug history-replay-spend-budget-operator-given entry-task 7 first-citing 7`;
- `plan-defines D-5780 D-6277 D-6278 D-6279 D-6280`, followed by every number the coordinator issued to this run during the build, each defined once.

Then the CONTROL: the same checker on a copy whose D-5780 entry is doubled must answer `defined 2` on its first line, so a second definition is visible. Then the cross-tree check: no other plan on `origin/main` defines any of the five, and the decisions document's block stands as §6 says.

```bash
PLAN=docs/superpowers/plans/2026-10-22-ccrc-history-w2-5a-quiz-builder.md
grep -E '^- \*\*D-5780\*\* — ' "$PLAN" > .superpowers/sdd/history-w2-5a/scratch/dup.txt
cat "$PLAN" .superpowers/sdd/history-w2-5a/scratch/dup.txt > .superpowers/sdd/history-w2-5a/scratch/plan-control.md
node .superpowers/sdd/history-w2-5a/t8-dnum.mjs .superpowers/sdd/history-w2-5a/scratch/plan-control.md | head -1
rm -r .superpowers/sdd/history-w2-5a/scratch
git fetch origin main
for d in D-5780 D-6277 D-6278 D-6279 D-6280; do git grep -l -F -e "- **$d** — " origin/main -- docs/superpowers/plans; done
for n in $(seq 5763 5781); do d="D-$n"
  printf '%s %s\n' "$d" "$(git grep -l -F -e "- **$d** — " origin/main -- docs/superpowers/plans | wc -l)"; done
```

Expected:
- `D-5780 defined 2 …` (the CONTROL);
- five lines, each `origin/main:docs/superpowers/plans/2026-10-22-ccrc-history-w2-5a-quiz-builder.md`;
- then nineteen lines, the W2 block of 19 numbers: `1` for every number except W2-2b's three (decisions §7 names them), which read `0` until W2-2b's plan merges, and then their path is that PR's plan, never this one. D-5765 and D-5766 read `1`: W2-2a's plan defines them, merged in the same docs PR as this one.

Two outcomes are findings to report to the coordinator, never something to fix here:
- a second path for any of the five, or any count above 1;
- a `first-citing` that differs from `entry-task`. The fix is the owning task's citation, or the entry's task number, whichever the coordinator rules.

- [ ] **Step 2: The spec is untouched, and W2-5b's three sentences stand.** From the repository root:

```bash
SPEC=docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md
git diff --name-only origin/main...HEAD -- "$SPEC" | wc -l
grep -cF '**Answerability.** F must occur in a span row with searchable provenance, within the sidecar FTS window.' "$SPEC"
grep -cF 'The question writer sees F and its span, and never either arm' "$SPEC"
grep -cF '**Pre-registration.** Before the live window starts, the W2 open record holds:' "$SPEC"
```

Expected: `0`, then `1`, `1` and `1`. These are E19, E20 and E23. W2-5b amends each in place (decisions §6); this PR states their new text only in its body's Decisions section.

- [ ] **Step 3: The file list, and what the PR's change can reach.** From the repository root:

```bash
PLAN=docs/superpowers/plans/2026-10-22-ccrc-history-w2-5a-quiz-builder.md
git diff --name-only origin/main...HEAD | grep -vxF -f <(printf '%s\n' deploy/history-replay.mjs server/test/history-replay.test.ts "$PLAN") || echo 'only W2-5a files'
git diff --name-only --diff-filter=A origin/main...HEAD | wc -l
git diff --name-only origin/main...HEAD -- ccd shared .github README.md deploy/history-gate.mjs deploy/measure-history.py docs/superpowers/specs docs/superpowers/programs | wc -l
git diff --name-only origin/main...HEAD | grep -cxF -f <(printf '%s\n' ccd/ccd ccd/ccrc ccd/session-hook.sh server/src/watch.ts server/src/coord/store.ts server/src/coord/routes.ts server/src/server.ts server/src/sessionws.ts pwa/src/lib/api.ts)
grep -nE "^import .* from '" deploy/history-gate.mjs | cut -d: -f1
git diff --stat origin/main...HEAD -- deploy/history-replay.mjs server/test/history-replay.test.ts | tail -1
```

Expected:
- `only W2-5a files`. The plan path is listed because a build-time number, or a corrected prediction, is recorded in it.
- `0`: no file is created (W2-D5).
- `0`: no never-touch path changed.
- `0`: no `GROWTH_FILES` entry is touched, so the armed growth check has nothing of this PR's to measure.
- one line number for the gate's single import line (about 23). With the gate unedited, `measure-history.test.ts` is not required.
- the two files' insertion and deletion totals, copied into the PR body's "How it was measured".

Any other path is a finding against the task that added it: report it, never revert it here.

- [ ] **Step 4: The carries, and the added lines.** From the repository root:

```bash
node -e '
const fs = require("fs");
const src = fs.readFileSync("deploy/history-replay.mjs", "utf8");
const head = []; for (const l of src.split("\n").slice(1)) { if (!l.startsWith("//")) break; head.push(l.replace(/^\/\/ ?/, "")); }
const h = head.join(" ");
console.log("old-sqlite-sentence", /never loads node:sqlite in any form/.test(h) ? 1 : 0);
console.log("old-imports-sentence", /lib\.mjs and \.\.\/shared\/roster-json\.mjs only\./.test(h) ? 1 : 0);
const specs = [...src.matchAll(/^import [^;]*? from \x27([^\x27]+)\x27;$/gm)].map((m) => m[1]).filter((s) => s.startsWith("."));
console.log("recall-off-reader-imports", [...src.matchAll(/^import [^;]*? from \x27[^\x27]+\x27;$/gm)].filter((m) => /\brecallOffPresence\b/.test(m[0])).length);
for (const s of specs) console.log("header-names", s, h.includes(s.replace(/^\.\.?\//, "")) ? 1 : 0);
console.log("recall-off-lstat-lines", src.split("\n").filter((l) => l.includes("lstatSync(recallOffPath(")).length);
console.log("own-recallOffPresence", (src.match(/^export function recallOffPresence\(home, ids\) \{$/gm) || []).length);
'
node -e "import('./deploy/history-replay.mjs').then((d) => { console.log('handlers', [...d.HANDLERS.keys()].sort().join(' ')); console.log('reasons', d.DRIVER_REASONS.length, d.DRIVER_REASONS.slice(28).join(' ') || '-'); console.log('code-files', JSON.stringify(d.CODE_SHA_FILES)); })"
grep -cE "^export function recallOffPresence\(home, id\) \{$" ccd/history/sweep.mjs
for p in GATE_CODE_FILES keptOf RP5 RP1-writer RP3-writer D-5780 'CODE_SHA_FILES parity' 'flags_accepted parity'; do printf '%s %s\n' "$p" "$(grep -cF -- "$p" server/test/history-replay.test.ts)"; done
grep -cF 'D-5780' deploy/history-replay.mjs
```

Expected:
- `old-sqlite-sentence 0` and `old-imports-sentence 0`: W2-1's R1 carry is done. A `1` is a finding against the task that first added a `../ccd/history/` import other than `lib.mjs`.
- one `header-names <spec> 1` line per relative import: `../ccd/history/lib.mjs`, `../shared/roster-json.mjs`, and each module Tasks 1 to 7 added (from `../ccd/history/`, `derive.mjs`, `recall.mjs`, `cli.mjs` and any other; and `./history-gate.mjs`). Each must read `1`: the header names every module the driver loads, and that `node:sqlite` arrives only through `store.mjs`.
- `recall-off-reader-imports 0`: no driver import binds a `recallOffPresence` (R6).
- `recall-off-lstat-lines 1`: single-definition's O13 case pins exactly one. W2-D84's `verify --section ab` reads content through `readBounded` (Task 7's `controlFileOf`), never through a second `lstatSync(recallOffPath(` line.
- `own-recallOffPresence 1`.
- `handlers freeze open pilot-source power probe quiz-source step0a verify`.
- `reasons 29 store-unreadable`: W2-5a adds exactly one driver word (Task 1, R5).
- `code-files ["deploy/history-gate.mjs","deploy/measure-history.py","deploy/history-replay.mjs","ccd/history/lib.mjs"]`.
- `1`: sweep's reader is unchanged.
- each of these at least `1` in the test file: `GATE_CODE_FILES`, `keptOf`, `RP5`, `RP1-writer`, `RP3-writer`, `D-5780`, `CODE_SHA_FILES parity` and `flags_accepted parity`. Every one was `0` at `cd622b2f6`, so together they show that both parity pins, the `keptOf` scan, RP5 and the writer pins landed. The last two are fragments of the two parity cases' titles (an `it` in Task 1's first describe and an `it.each` in Task 7's describe), as their owning task writes them, and Step 5 selects by them.
- `D-5780` at least `1` in the driver, at answerability's clause 4. The driver's comments cite D-6277, D-6278 and D-6279 too.

Then the added lines. The block prints counts only:

```bash
added() { git diff -U0 origin/main...HEAD -- deploy/history-replay.mjs server/test/history-replay.test.ts | grep '^+' | grep -v '^+++'; }
printf 'citations %s\n' "$(added | grep -cE 'ccd:[0-9]{3,5}\b|\.(ts|tsx|mjs|sh):[0-9]+\b')"
printf 'shells %s\n' "$(added | grep -cE 'shell: *true|execSync\(|[^.A-Za-z_]exec\(')"
printf 'driver-env %s\n' "$(git diff -U0 origin/main...HEAD -- deploy/history-replay.mjs | grep '^+' | grep -v '^+++' | grep -c 'process\.env')"
printf 'live-home %s\n' "$(added | grep -cE 'homedir\(|process\.env\.HOME')"
printf 'real-binaries %s\n' "$(added | grep -cE '(spawn|spawnSync|execFile|execFileSync)\( *.(claude|ccd|ccrc|gh|sqlite3).[,)]')"
printf 'key-literals %s\n' "$(added | grep -cE 'AKIA[0-9A-Z]{16}|sk-ant-[A-Za-z0-9_-]{10,}|gh[opsu]_[A-Za-z0-9]{20,}|xox[abp]-[0-9A-Za-z-]{10,}')"
printf 'sqlite-specifier %s\n' "$(git diff -U0 origin/main...HEAD -- deploy/history-replay.mjs | grep '^+' | grep -v '^+++' | grep -cE "(['\"\`])node:sqlite(['\"\`])")"
printf 'd-tbd %s\n' "$(git grep -I -c -E 'D-TB[D]-[a-z0-9]' | wc -l)"
printf 'd-ranges %s\n' "$({ added; git log --format=%B origin/main..HEAD; cat docs/superpowers/plans/2026-10-22-ccrc-history-w2-5a-quiz-builder.md; } | grep -cE 'D-[0-9]+ *(\.\.|–|-|to) *(D-)?[0-9]+')"
```

Expected: every count `0`.

| Count | What a non-zero means | Where the fix goes |
|---|---|---|
| `citations` | a numeric line citation was added (D-5893's ratchet) | the task that added it rewrites it as a symbol citation (`file.mjs#name`) |
| `shells` | a shell or a command string (CodeQL's `js/shell-command-injection-from-environment`) | the owning task |
| `driver-env` | a second `process.env` line in the driver | the owning task. W2-4's env scan pins the projection line as the only one |
| `live-home` and `real-binaries` | a test that could reach a live home or a real binary | the owning task, before any push |
| `key-literals` | a key-shaped literal | assemble it at runtime from parts |
| `sqlite-specifier` | a quoted `node:sqlite` in the driver (the count reads the driver's added lines only: the rule covers `deploy/history-*.mjs`, as W2-4's scan does, and the test file's added `node:sqlite` imports and its import-pin CONTROL string are legitimate) | the driver's header prose must not quote it, because W2-4's scan reds a quoted mention even in a comment |
| `d-tbd` | a concrete placeholder departure token (`dtbd.test.ts`'s pattern) | replace it with the issued number before any push |
| `d-ranges` | a D-number range | rewrite it as a list |

Then three quick focused runs over the carried pins, before the long suites. Each `-t` is regex-safe, and each selects the named cases:

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'spells a node:sqlite specifier'
```
```bash
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'recall-off/<id>: exactly one writer'
```
```bash
cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts -t 'declares history-replay-out'
```

Expected:
- the first: `2 passed`, plus skips. That is W2-4 Task 1's describe, retitled by Task 1, and its two cases: the CONTROL, and "no deploy/history-*.mjs spells a node:sqlite load". It stays green whatever the header now says, because the header names `node:sqlite` unquoted.
- the second: `1 passed`, the O13 case, with the driver's single `lstatSync(recallOffPath(` line.
- the third: `1 passed`. The case imports the driver, and with it each module Tasks 1 to 7 import, in the lifecycle worker.

A run that reports only skipped tests selected nothing, and its step is not green.

- [ ] **Step 5: The PR's own suite, whole, in one process.** From the repository root, in the foreground, with a Bash timeout of 600000 ms:

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts
```

Expected: `Test Files  1 passed (1)`, every case passed or skipped. The skips are the root-only cases (`process.getuid() === 0`) and the darwin-only rows. W2-4's pins are all among the passes: RP1-contract, RP2, RP3-admission, RP4, RP9, the limits parity over `rolloverCases`, step 0a and the probe. So are Tasks 1 to 7's:
- RP5, with the straddle and two-copy CONTROLs;
- RP1-writer and RP3-writer, where a refused account leaves the stub's log absent;
- W2-D61 to W2-D75's admission, Baseline B, answerability (D-5780's five pins) and freeze pins;
- the `keptOf` scan with its CONTROL;
- both parity pins;
- each `--record` subcommand's `codeShas()` re-check (W2-D24).

Copy the summary lines (`Test Files …`, `Tests …`, `Duration …`) as printed. Then run the two parity pins on their own. The filter's one metacharacter is a deliberate `|`, and the run must select at least one case for each fragment (each fragment is in a case title: Task 1's `CODE_SHA_FILES parity` `it` and Task 7's `flags_accepted parity` `it.each`):

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts --reporter=verbose -t 'CODE_SHA_FILES parity|flags_accepted parity'
```

Expected: every selected case passes, with at least one for each fragment. Copy the parity cases' titles from the verbose output into the PR body's Pins.

A red here is never re-run into green by changing a fixture's expectation. If the file is red under load, re-run it alone once, and report both results. Any red that remains is a finding against the task whose case it is.

- [ ] **Step 6: The whole-PR checks.** From the repository root, each in the foreground with a timeout of at least 600000 ms, **one tool call per line**: never two suites in one call, never a loop, never a background run. Re-run a red file alone before calling it a break (CLAUDE.md's load flakes).

```bash
git fetch origin main
```
```bash
cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts
```
```bash
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts
```
```bash
cd server && ./node_modules/.bin/vitest run test/docs-policy.test.ts
```
```bash
cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts
```
```bash
cd server && ./node_modules/.bin/vitest run test/citations.test.ts
```
```bash
cd server && GROWTH_CHECK=1 ./node_modules/.bin/vitest run test/growth-check.test.ts
```
```bash
cd server && ./node_modules/.bin/vitest run test/ci-pipeline.test.ts
```
```bash
cd server && ./node_modules/.bin/vitest run test/dtbd.test.ts
```
```bash
cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts
```
```bash
cd server && ./node_modules/.bin/tsc --noEmit
```
```bash
cd server && ./node_modules/.bin/tsc -p test/tsconfig.tests.json --noEmit
```

Expected:
- **`lifecycle`** green whole. Its `history-replay-out` case imports the driver in-process, so the driver's whole import graph, and any umask its imports set, runs in that worker. A red here belongs to the task that added the import, for example a module-level import of `cli.mjs` where a lazy import in the one function that needs `pairIndexOf` would do. `lifecycle.test.ts` is never edited.
- **`single-definition`** green: O13's switch scan, with no `/history-off`, `/headless-on` or similar spelling on a non-comment driver line; its recall-off case, with one driver line; and O14's `DECL_CORPUS`, where no `deploy/*.mjs` declares a `VOCABS` name (W2-D12, D-5774).
- **`docs-policy`** green (a control: it reads nothing W2-5a changes).
- **`topology-clean`** green. Its walk reads every tracked file, the new fixtures included, so a red names a host-shaped, address-shaped or id-shaped token: rewrite the fixture, never the scanner.
- **`citations`** green, both the ceiling and "the lines this branch adds hold no numeric line citation".
- **`growth-check`** green with its rows measured, not skipped: the run needs `origin/main`, fetched above. Every listed file's row reads delta 0 for this PR, `GROWTH_OVER` is empty, and no exemption or waiver is consulted (Choices).
- **`ci-pipeline`** green. The node-floor heredoc still lists exactly the history test files, because the PR adds none (W2-D5).
- **`dtbd`** green.
- **`deviation-refs`** green against `origin/main` without merging: no allocator-era number is defined in two plans across this branch and its base. A red names the number. Report it to the coordinator, and never renumber one.
- Both **`tsc`** runs print nothing. The test project types `history-replay.test.ts`'s new imports, including any aliased import of sweep's `recallOffPresence` (with `allowJs`).

Copy each `Test Files … | Tests …` line, and both `tsc` exits, into the PR body. If Step 3 showed the gate's import line moved, or `lib.mjs` changed, add one more line: `cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts`, which must be green.

- [ ] **Step 7: The private-name, host and home-path checks.** Write `.superpowers/sdd/history-w2-5a/pr-body.md` first (Step 9's text). Then, from the repository root, run the block below. It prints counts only:

```bash
TITLE='ccrc history wave W2-5a: reconstruction, admission, the quiz builder and the record subcommands'
BODY=.superpowers/sdd/history-w2-5a/pr-body.md
LIST="$(git rev-parse --path-format=absolute --git-common-dir)/info/ccrc-private-names"
{ git diff -U0 origin/main...HEAD | grep '^+' | grep -v '^+++'; git log --format=%B origin/main..HEAD; printf '%s\n' "$TITLE"; cat "$BODY"; } \
  | grep -c -i -w -F -f <(cut -f2 "$LIST" | grep -v '^#')
{ git diff -U0 origin/main...HEAD | grep '^+' | grep -v '^+++'; git log --format=%B origin/main..HEAD; printf '%s\n' "$TITLE"; cat "$BODY"; } \
  | grep -cE '([0-9]{1,3}\.){3}[0-9]{1,3}|\.ts\.net|/home/[^u/]|/home/u[A-Za-z0-9_-]|/Users/|/root/|/mnt/'
printf '%s\n' '/home/you/tree' '/home/u/tree' "'/home/u'" 'names(/home/u)' 'paths are /home/u fixtures' | grep -cE '/home/[^u/]|/home/u[A-Za-z0-9_-]'
```

Expected:
- `0`: no private name in any added line, message, the title or the body.
- `0`: no address, tailnet name or home path. Fixture paths are `/home/u/…`, and the tests also pass the bare fixture HOME `'/home/u'` (Tasks 2, 4 and 7) and name it in comments; the pattern admits `/home/u` followed by `/`, a quote, a space, `)` or the end of a line, and refuses any other home.
- `1`: the CONTROL. The home-path pattern sees the non-fixture home and admits the four fixture shapes.

A non-zero count is judged by its line numbers only, never by printing a token. Re-run the same pipeline with `grep -n -i -w -F -f <(cut -f2 "$LIST" | grep -v '^#') | cut -d: -f1`, or `grep -nE … | cut -d: -f1` for the second, then read those lines and rewrite each hit with a neutral stand-in before any push. A hit in a commit message needs a new commit history on this branch (an amended or reworded commit before the first push), which the worker asks the coordinator about first. After a push, GitHub keeps every revision.

- [ ] **Step 8: Confirm the tree holds only this PR's work.** Run `git status --short`. It must list nothing. Every task committed its work, the scratch sits under the ignored `.superpowers/`, and no fixture directory was left in the checkout (`runDriver`'s cwd is the fixture HOME). No step read or wrote a live `~/.ccrc`. No step ran `claude`, `ccd`, a `ccrc` verb, the shim, `sweep.mjs`, `cli.mjs`, `history-gate.mjs` or `measure-history.py` against a live home.

- [ ] **Step 9: Write the PR body.** Write `.superpowers/sdd/history-w2-5a/pr-body.md` with the text below, using the Write tool, never a shell heredoc. Then replace its four parenthesised lines:
- under `### Departures`: one line per number the coordinator issued to this run during the build, each as its `## Deviations found` entry states it (number, slug, task, one-line why), or the single line `None beyond these five.`;
- under `### Rulings made in the operator's place`: this plan's Decisions-table rulings, one line each, plus each ruling the coordinator made during the build, with its date. Each is the coordinator's, under the operator's directive of 2026-10-19;
- under `### Pins`: the two parity pins' case titles as their task wrote them;
- under `### Tests run`: Steps 4, 5 and 6's summary lines, as printed.

Every other line is final.

```markdown
## ccrc history wave W2-5a: reconstruction, admission, the quiz builder and the record subcommands

Spec: `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md` (rev 3.6, amended in place; **not edited here**): §10.2's replay eval (reconstruction, questions, answerability, the writer, pre-registration) and its pins RP1, RP3 and RP5.
Decisions: `docs/superpowers/plans/2026-10-19-ccrc-history-w2-decisions.md`, §2's "W2-5a (deploy)" entry with the coordinator's amendment of 2026-10-20, §3 G (W2-D61 and W2-D65 to W2-D75), the first half of W2-D84, W2-D21's `power`, and W2-D24's consumers. Plan: `docs/superpowers/plans/2026-10-22-ccrc-history-w2-5a-quiz-builder.md`.

W2's replay eval asks each arm questions about facts a compaction removed. This PR builds those questions from a node's store, on the deploy lane after W2-1 (#1105) and W2-4 (#826), and before W2-5b. It runs nothing against a live store, and it spawns only the question writer, through W2-4's contract.

### What ships

- **Reconstruction** through W2-1's exports (W2-D74, W2-D75): the summary row with its pointer lines removed (D-6277), kept(N) read from `boundaries.kept_blob_id` through `bodyOf`, and each member's body through `expandEntryBody`. `deploy/` holds no second decode. Each of `expandEntryBody`'s non-body states (D-6238) discards the boundary, counted by its own reason. One store open per run, one holding-copy reader, one span reader and one payload composer (R3, R4).
- **RP5 boundary admission** (W2-D66), on `pickHoldingCopy`'s copy, with the straddle and two-copy CONTROLs.
- **Fact mining** (W2-D61, W2-D65): sha, path, command and error facts from leaf N's span, paired by the sweep's own tool-use pairing, `F_raw` and `F` both kept. Decisions are not mined (W2-D60, D-5775).
- **The redaction discard** (W2-D67), through the exported `pairIndexOf`, applied before admission, to `F_raw` and to `F` alike: the writer's input carries `F`, and a header and its value split by a newline are masked only once `F` joins them (R10).
- **Baseline B** (W2-D68, W2-D69): in memory only and never written under `--out`. It reads `bodyOf` and never `keptOf`. A kept member after the summary is never part 3's stop (D-6278), and an object body's string leaves are its second rendering (D-6279); both only grow B. It discards fail closed, counted.
- **Answerability** (W2-D70), with clause 4: a non-null source `ts_ms` at or before the boundary's, and a non-null sidecar `entry_id` (**D-5780**). W2-D34's `asof_same_ms_hits` is counted and reported per admitted question, never gating (D-5766, W2-2a's).
- **Sampling** (W2-D71, as the coordinator amended it in place on 2026-10-22): the quiz population is every family on the node with an admitted boundary, less the pilot families and every control-held `(store_id, ccrc_id)` (W2-D77), never only the census's active list, which feeds the assignment. Families come in a per-family seeded key's order (the `'quiz-sample'` substream seed hashed with `familyKey`), each family's candidates on its own stream, so each node ranks its questions as the walk over every node does and `freeze` merges by rank. **The writer spawn** (W2-D72) runs through W2-4's writer mode with `--tools ""` (RP1-writer, RP3-writer) and the default excerpt (D-5779). `sourceQuiz` composes the pipeline in W2-D71's lazy order.
- **The frozen lists** (W2-D73): `freeze` writes `quiz/frozen.json`, and `pilot-source` writes the pilot list. Each prints its sha256 on stderr. Beside the quiz list, `quiz/frozen.meta.json` carries quiz-source's `assignment_sha256`, the counts, `below_floor` (the halt floor, the only family-count stop) and `short_of_min_families` (fewer families than `quiz.min_families`, reported and never a refusal, R11).
- The fidelity pilot's payload and overhead arithmetic. Its spawns are W2-5b's.
- **The subcommands:**
  - `pilot-source` (`--step0a`, `--step0a-sha256`, `--budget`, `loadStep0a` and `preflight`);
  - `quiz-source`, which derives the assignment (W2-D19, W2-D20) and sources this node's own admitted families, control ids and pilot families excluded;
  - `freeze`;
  - `power` (W2-D21; it reads `q18_settings`, calls `q18Power` once per power level with rho = `rho_headline` and with rho = 0, and derives `covered_days` from `lookback_days`; its census assembler checks store ids only);
  - `open --draft`, which binds each step 0a output to its node with `label` and `store_id` (D-5812's three inits non-null);
  - `open --finalize`, which re-derives the assignment and refuses `assignment-mismatch`, and takes part 2's `spend_budget` from the operator (D-6280);
  - `open --template`;
  - `verify --registry` (W2-D20, D-5773) and `verify --section ab` (W2-D84's first half).
- **`codeShas()` re-checked** before any spawn or computation in each of W2-5a's `--record` subcommands (W2-D24): `quiz-source`, `freeze`, `power`, `open --finalize`, `verify --registry` and `verify --section ab`. None takes `--allow-code-change`: before window start a code change is a re-pilot and a superseding draft (W2-D6).
- **The driver's header** now names every module it loads, and says that `node:sqlite` arrives only through `store.mjs` (W2-1's R1). The old sentence "never loads node:sqlite in any form" is gone.

Two files: `deploy/history-replay.mjs` and `server/test/history-replay.test.ts`, plus this wave's plan where a build-time number is defined. There is no new file (W2-D5), and no change to `ccd/**`, `shared/**`, the spec, README, `deploy/history-gate.mjs`, `deploy/measure-history.py` or `.github/**`. The driver is not a growth-check file, so its growth needs no exemption or waiver (D-6178, D-6223).

### Departures

Each is defined in the plan's `## Deviations found`:
- D-5780, `history-w2-answerable-timed` (Task 5; W2-D70): answerability adds a non-null source `ts_ms` at or before the boundary's `ts_ms`, and a non-null sidecar `entry_id` whose entry passes the same test, so every admitted fact's source is visible under W2-D34's cut. The count it removes is reported. Spec erratum E19, amended in place by W2-5b.
- D-6277, `history-replay-pointer-lines` (Task 1): every whole summary line naming a `.jsonl` path becomes `[pointer removed]`, wider than the spec's one transcript-pointer line, at no quiz cost, since B keeps the whole summary.
- D-6278, `history-replay-baseline-kept-not-a-stop` (Task 4): a kept(N) member after the summary row is part 2's, never part 3's stop.
- D-6279, `history-replay-baseline-object-leaves` (Task 4): B's second rendering of an object body is every string leaf. Both B readings only grow B, so admission rejects more facts, never fewer.
- D-6280, `history-replay-spend-budget-operator-given` (Task 7): `open --finalize` takes part 2's `spend_budget` from the operator; W2-5b, which defines the pilot result's producer, tightens it to derive it.

(the numbers issued to this run during the build, one line each in the same form, or "None beyond these five.")

Cited bare, defined elsewhere:
- D-5766 (W2-2a's, the as-of cut; this PR only counts its same-millisecond hits);
- D-5773, D-5774, D-5775, D-5776 and D-5779 (W2-3's plan);
- D-5812 (W2-4's plan);
- D-6238 (W2-1's plan).

### Spec errata: none in this PR

W2-5a does not hold the spec path (W2-D3). Its decisions change three rev 3.6 sentences, and W2-5b amends each in place (decisions §6): **E19** (§10.2 "Answerability", D-5780), **E20** (§10.2 "The question writer sees F and its span": the default excerpt, with `leaf-span` signable, D-5779) and **E23** (§10.2 "Pre-registration": the two-part record, the code hashes, the Q18 decision posted before arm data, the window tied to `planned_days`).

### Decisions this PR applies

- W2-D61, and W2-D65 to W2-D75, as the bullets above state them, W2-D71 with the coordinator's in-place amendment of 2026-10-22 (the per-family order key).
- W2-D84's first half: `verify --registry` and `--section ab`. `marker` and `verify --section pilot|quiz` are W2-5b's.
- W2-D21's `power`, with the coordinator's amendment of 2026-10-20 (W2-3 review 664).
- W2-D24: W2-5a's six `--record` consumers.
- W2-D33: the `keptOf` scan.
- W2-D3, W2-D4 and W2-D5: no spec edit, D-5780 defined once, and no new test file.

### Pins

- RP5, with the straddle and two-copy CONTROLs.
- RP1-writer and RP3-writer: the writer call goes through W2-4's writer mode, and a refused account leaves the stub's log absent.
- The `keptOf` scan, with its CONTROL.
- The admission, Baseline B, answerability and freeze pins W2-D61 to W2-D75 name, each with its mutant.
- The `CODE_SHA_FILES` / `GATE_CODE_FILES` parity pin and the `flags_accepted` parity pin, against W2-4's argv set (decisions §7). W2-5a is the first PR that loads both modules.
- Each new guard was measured red under its mutant, then green. The plan lists every mutant and the case it reds.

(the two parity pins' case titles, as written)

### Residuals, named

- **Baseline B over-rejects.** It takes the union of every rostered home's files (W2-D69), and its tails and windows have no token boundaries (W2-D62). Admission is biased against facts, never toward them.
- **B does not cover rows written after the first post-boundary assistant row** (W2-D68). The as-of cut hides those in the holding copy, and W2-D34 names what it does not hide.
- **Facts carried only by NULL-ts rows, or by sidecars with no entry, are never asked** (W2-D70, D-5780). The removed count is reported.
- **Same millisecond and clock steps outside the holding copy.** `asof_same_ms_hits` is counted and reported per admitted question, never gating. A backward clock step is not measurable (W2-D34).
- **The decision kind is not quizzed** (W2-D60, D-5775).
- **`bodyOf`'s null folds three conditions:** a tombstone, a body that is not JSON, and an over-cap or unmeasured body. W2-D68 reads all three as `kept-unreadable`. `keptOf` still folds too, and the `keptOf` scan is the guard (W2-1's residuals).
- **Importing `cli.mjs` sets the importing process's umask to 0o077** and loads the sweep's module graph, with `node:sqlite` through `store.mjs`. The driver sets umask 077 itself before any write, and the header says so.
- **The impure path's imports are not hashed** (`recall.mjs`, `derive.mjs`, `cli.mjs`, `store.mjs`). They are covered by the `release_tag` comparison and the `tree-moved` preflight (W2-D24).
- **Q18 is a Monte-Carlo estimate.** Its procedure, seed and inputs are recorded. A huge `q18_settings.sims` or `window_plan.planned_days` validates, and makes `power` run without practical end: the operator supersedes such a draft (decisions §7).
- **`verify --section ab` reads a control file itself**, through `readBounded(recallOffPath(...))`, as W2-D84 says, beside sweep.mjs's `recallOffPresence`: two readers of one file with one fold (over-cap as unreadable). The driver imports no `recallOffPresence` (R6).
- **A family's place and its candidate stream come from its own key**: the quiz's family order key is the `'quiz-sample'` substream seed hashed with `familyKey`, and its candidate stream is the walk seed joined to that key (`familyRng`), so each node's ranks are the global walk's; one stream over every family cannot be drawn on a node that holds only some of them. `freeze` compares the nodes' keys and does not recompute them; each was computed by the same code under the same re-checked `gate_code`.
- **Deduplication is pool-level, at the first site:** a fact whose first site a later filter drops is not retried at a later site (R6).
- **A below-floor quiz re-sources:** proceeding means a superseding draft that lowers `quiz.halt_floor`, and `quiz-source` runs again (R6).
- **A quiz short of `quiz.min_families` but above the halt floor proceeds:** the meta reports `short_of_min_families` and nothing refuses on it (R11). At the signed defaults a list that meets the target already holds at least 20 families, so on a full list it can only be true under a raised `caps.family`.
- **Carried to W2-5b (R8):** the parity pins between the driver and lib's cut once W2-2a has merged (the same-millisecond predicate against `asOfCut`, and `keptMembersOf(N)` against `asOfCut(N).keptUuids`); README's driver paragraph naming the `--no-warnings` shebang; the pilot-result file shape `{kind: 'ccrc-history-w2-pilot-result', v: 1, fidelity, usage_extrapolation, step0b_sha256, settings_mode, absent_rate}`, W2-5b's producer contract; `open --finalize` deriving `spend_budget` (D-6280); the stop-word classification (the four unmeasured words, `run-live`, `out-in-use`, `interrupted`, `out-refused` and `store-unreadable`), the arms, the judge, the marker and the report.

### How it was measured

- Every guard red-first on the unguarded code, then each named mutant red after the guard landed, then green again; each task's commit message records its counts.
- Every test drives the driver in a `mkTmp` fixture HOME with the scrubbed environment. Spawns reach a recording node stub, never a real Claude Code, with a poisoned `gh` first on `PATH`. Stores are fixture stores in the case's temp tree. No step read a live store or home, or spawned a real model.
- The added lines hold no numeric line citation, no shell, no new `process.env` read, no live-HOME read, no key-shaped literal, no placeholder D-number token and no D-number range (counts, all 0).
- The private-name check over every added line, every commit message, the title and this body printed 0.

### Rulings made in the operator's place

Each is the coordinator's, under the operator's directive of 2026-10-19, made while this plan was written (2026-10-22), and each is changeable by the operator:
- R1: the five departures above, with their issued numbers; D-5766 stays W2-2a's.
- R2: the PR touches the two files, and this plan only for build-time entries and corrected predictions; Task 8 has no commit.
- R3: one owner per shared piece (Task 1: the imports and their pin, the header, `--no-warnings`, `t8Tree`, the `keptOf` scan, the `CODE_SHA_FILES` parity pin, the one store open, holding-copy reader and kept-list reader; Task 7: the `flags_accepted` parity pin).
- R4: one set of names: Task 2's mined candidate is the one candidate shape; Task 1's composer and span reader; Task 6's global rank and `qidOf`.
- R5: two driver-local lists by stage, `RECON_DISCARDS` and `FACT_DROP_REASONS`, later tasks appending in place; `store-unreadable` the one new driver word (disjointness as amended by R10).
- R6: the readings the drafts chose, confirmed (among them: the writer as a parameter, the third fidelity run, `writer-malformed` split by failed runs with one warning line, the pilot list holding usage questions only, distinct entries over the CLI's family scope, no `recallOffPresence` import, the 5/5 pilot defaults from `OPEN_RECORD_V1`).
- R7: the pins owned across tasks (W2-D67's writer-stub pin in Task 6 on Task 2's fixtures; W2-D61's and W2-D74's B pins in Task 4; the `--out` walk over a whole stubbed run in Task 7).
- R8: the items carried to W2-5b (above).
- R9: one pilot node, `pilot-source` run once; §5's act 9 is amended in place in the decisions document.
- R10 (2026-10-22, the plan review's open points): the quiz population is every local admitted family less the exclusions, never the census's active list, in a per-family seeded key's order that `freeze` merges by (W2-D71 amended in place; no number); `screenRedaction` also drops a fact whose `F` redaction masks, as `redact-fact`; `verify --section ab` reads each control file's content, as W2-D84 requires, and writes nothing; R5 amended, so disjointness is pinned only for pairs that involve a drop list, `QUOTA_SKIPS` a report list; a refusal that needs no store and no spawn answers before `prepareOut` makes `--out`, pinned for the writer-model refusal.
- R11 (2026-10-22, the convergence review's conformance F2): `quiz.min_families` (the signed 20, W2-D71's "at least 20 families") is reported in `freeze`'s meta as `short_of_min_families`, never a refusal; the halt floor stays the only family-count stop.

(each ruling made during the build, one line each, with its date)

### Steps for the coordinator or the operator, never the worker

1. **The selection.** This PR changes no `.github/` file, so CI runs its selection. Check that the `select tests` summary lists `history-replay`, `lifecycle` (it imports the driver) and `single-definition` (it scans `deploy/`). If one is missing, dispatch a full run: `gh workflow run ci.yml --ref <this branch> -f mode=full`. `test-macos` is advisory, but a `history-replay` red there blocked a stable promotion once (#1032, D-6122), so read it.
2. **Rollout through the release lane only**, and only as part of W2's final release (W2-D6): every W2 PR merges, and that release is rolled onto the named nodes before part 1 of the open record is signed.
3. **The operator acts this PR's subcommands serve** (decisions §5), each on the named nodes after that rollout: step 9 `pilot-source` (act 9's line is abbreviated; the full argv is `pilot-source --out <dir> --account <id> --budget <N> --writer-model <id> --step0a <file> --step0a-sha256 <hex>`), step 10 `open --draft`, step 11 `verify --registry`, step 12 `power`, step 16 `quiz-source` and `freeze`, step 17 `open --finalize`, and step 19 `verify --section ab`.

### Tests run (foreground, on the worker's box)

(Steps 4, 5 and 6's summary lines, as printed)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Then re-run Step 7's block over the finished body. Both counts must be `0` again.

- [ ] **Step 10: Push, open the PR, and read its threads and checks.** Push the workspace branch, its own branch and never a separate feature branch. Then open the PR against `main`, ready for review (not a draft):

```bash
git push -u origin "$(git branch --show-current)"
gh pr create --base main --head "$(git branch --show-current)" \
  --title "ccrc history wave W2-5a: reconstruction, admission, the quiz builder and the record subcommands" \
  --body-file .superpowers/sdd/history-w2-5a/pr-body.md
read -r OWNER REPO < <(gh repo view --json owner,name -q '.owner.login + " " + .name')
PR=$(gh pr view --json number -q .number)
gh api graphql -F o="$OWNER" -F r="$REPO" -F n="$PR" -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){totalCount nodes{isResolved path line comments(first:1){nodes{author{login}}}}}}}}' \
  --jq '.data.repository.pullRequest.reviewThreads | "threads \(.totalCount) open \([.nodes[] | select(.isResolved | not)] | length) codeql-open \([.nodes[] | select((.isResolved | not) and (.comments.nodes[0].author.login == "github-advanced-security"))] | length)"'
gh pr checks "$PR"
```

Expected:
- the PR URL;
- `threads N open 0 codeql-open 0`;
- once CI settles, every required check green: `test (server)`, `test (agent)`, `test (pwa)`, `build-pwa`, the `node floor (22.16.0)` leg (which runs `history-replay.test.ts` on every PR) and the typecheck.

**Re-read the threads after every push.** A thread left open blocks the merge even while every check reads green. An open CodeQL thread (author `github-advanced-security`) is fixed at its cause, in the task that owns the line: an argv array, never a shell or a command string, and no environment value in a command. The worker never resolves a thread and never dismisses an alert. To list an open thread's place without its text:

```bash
gh api graphql -F o="$OWNER" -F r="$REPO" -F n="$PR" -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){nodes{isResolved path line comments(first:1){nodes{author{login}}}}}}}}' \
  --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved | not) | "\(.path) \(.line) \(.comments.nodes[0].author.login)"'
```

If the body must change after the PR is open, patch it over REST (`gh pr edit` fails on this box) and re-run Step 7 on the new file first:

```bash
gh api -X PATCH "repos/$OWNER/$REPO/pulls/$PR" -F "body=@.superpowers/sdd/history-w2-5a/pr-body.md" --jq .html_url
```

**Wave-done** needs all four: the PR open, its checks green, no open thread, and the branch tip equal to the PR head (`git rev-parse HEAD` against `gh pr view "$PR" --json headRefOid -q .headRefOid`). Merging, the merge queue, the rollout and every act in decisions §5 belong to the coordinator and the operator, never the worker.

**Mutants.** This task adds no guard, no test and no code path, so it has no mutant list. Its checks carry their own CONTROLs:
- Step 1's checker answers `defined 2` on a copy with the D-5780 entry doubled;
- Step 7's home-path pattern counts a non-fixture home and admits a fixture one;
- the three focused runs in Step 4 each select their named cases, so none passes vacuously.

Every guard this PR adds is in Tasks 1 to 7, each with its own mutant list.

**Commit:** none of its own. This task edits no tracked file. Two kinds of change may still be needed:
- **A fix a check calls for** goes into the task that owns the code, as a correction commit in that task's form, for example `fix(history-replay): <what> (W2-5a Task <N>; W2-D<n>)`. It is committed before Step 10's push, and Steps 3 to 7 are re-run after it.
- **A number issued during the build** is defined in this plan's `## Deviations found` by the commit that first cites it.


## Deviations found

Nine numbers are defined here. D-5780 is the W2 decisions document's (its block of 19, issued 2026-10-19); D-6277, D-6278, D-6279 and D-6280 were issued for the departures found while planning (R1); D-6301 and D-6302 were issued for the two departures Task 1's review found; D-6303 was issued for the one Task 2's review found; D-6304 was issued for the one Task 4's pre-review fix round found. A number issued during the build is appended below by the commit that first cites it.

- **D-5780** — `history-w2-answerable-timed` (Task 5; W2-D70, with spec erratum E19, which W2-5b amends in place): W2-D70's answerability gains a fourth clause. A source entry needs a non-null `ts_ms` at or before boundary N's own `ts_ms` (T_N). A sidecar source needs a non-null `entry_id` whose entry passes the same test. This departs from spec §10.2's "Answerability" bullet ("F must occur in a span row with searchable provenance, within the sidecar FTS window"), which reads no time and admits a sidecar however it is linked. The ground is the as-of cut (W2-D34, W2-D35). A NULL-ts row and a sidecar with a NULL `entry_id` are absent under it. A fact sourced only from one would be asked of a treatment arm whose own cut can never show it, and its miss would measure the cut, not recall. With clause 4, every admitted fact's source is visible under the cut: a leaf-N span row precedes the boundary, so the positional clause never hides it. Read with clause 1, the sidecar sources are those linked to a searchable span row and those linked to nothing in the span's transcript, so the unlinked ones reach clause 4 and are counted. What the clause removes is reported, never hidden: the `answerable` stage drops such a candidate as `unanswerable-untimed`, apart from `unanswerable`, and sampling counts each (decisions section 7: "Facts carried only by NULL-ts rows or by sidecars with no entry are never asked"). The spec sentence is amended by W2-5b (E19); this plan edits no spec. Pins: Task 5's clause-4 cases (a source stamped exactly T_N is answerable, one stamped one ms after is not, a NULL-ts row, an unlinked sidecar, a sidecar linked to a NULL-ts row) and the stage's two words; mutants M6 to M9, M12 and M13 of Task 5.
- **D-6277** — `history-replay-pointer-lines` (Task 1; W2-D75 item 1, spec §10.2 "Reconstruction"): every whole line of the summary row that names a path ending in `.jsonl` becomes `[pointer removed]`, where the spec says "its transcript-pointer line", one line. Neither the spec nor any code, fixture or lib helper in the tree defines that line, so the rule is the widest reading that still removes it: any whole line naming a `.jsonl` path (`/^.*\/\S*\.jsonl(?![A-Za-z0-9_]).*$/gm`). It removes more than the spec's text says, at no quiz cost: any fact on such a line is in B, which keeps the summary whole with its pointer (W2-D68 (1)), so it is never admitted. The fidelity pilot's token count moves by those lines only. Redaction runs first and the replacement after (W2-D54: whole, then any cut). Pins: Task 1's `removePointerLines` case and its item 1 case over the fixture store; mutant M2 of Task 1.
- **D-6278** — `history-replay-baseline-kept-not-a-stop` (Task 4; W2-D68 (3)): W2-D68 (3) stops B's part 3 at "the first operator-provenance or assistant row" after the summary. A kept(N) member there is part 2's row (W2-D68 itself pins "a post-summary kept member"), so Task 4 passes over it: it is never the stop, and the rows after it, the served card among them, stay in B. The departure only grows B, so admission rejects more facts, never fewer. Pins: Task 4's case 'a kept member after the summary is never the stop' with its CONTROL; mutant M9 of Task 4.
- **D-6279** — `history-replay-baseline-object-leaves` (Task 4; W2-D68's second rendering): W2-D68's second rendering is "its `ftsTextOf` string leaves". `ftsTextOf` answers `''` for an object body, and an attachment row's stored body is its `attachment` object, so the served card would enter B only as JSON, its quotes escaped. B takes every string leaf of an object body instead. This only grows B, so admission rejects more facts, never fewer. Pins: Task 4's case 'part 3 takes the rows after the summary', whose CONTROL is the card's JSON rendering; mutant M6 of Task 4.
- **D-6280** — `history-replay-spend-budget-operator-given` (Task 7; decisions §4 part 2, §5 act 17): `open --finalize` takes part 2's `spend_budget` from the operator (`--spend-budget N`) and copies the pilot-result file's fields as given, where §4 derives it from the pilot's extrapolation for the frozen list times 1.25. That extrapolation is W2-5b's usage pilot and has no shape at this base. §5's act 17 already has the operator approve the spend budget, so the figure the operator approves is the figure recorded. W2-5b, which defines the pilot result's producer, tightens `open --finalize` to derive it and refuse a mismatch (a ledger carry, R8). Pins: Task 7's `open --finalize` case that prints part 2 with `spend_budget` equal to the given flag, and `FLAG_SPECS`' `spend-budget` entry.
- **D-6301** — `history-replay-unknown-body-word-throws` (Task 1; D-6238, the Drifts row "Each word keeps its own discard; an unknown word throws"): Task 1's `entryBodyOf` turned every body state other than `body` and `unparseable` into `{ state: 'lost', word }`, so a word `expandEntryBody` gains later reached `SUMMARY_LOST[word]` or `MEMBER_LOST[word]` as `undefined` and `reconstructPayload` answered a discard with no word. The header's rule governs: `entryBodyOf` throws a `TypeError` naming the state unless both maps own it. A wordless discard would be counted under nothing, and the operator would read an unexplained shortfall. Pins: Task 1's D-6301 case (a stub `expandEntryBody` answering an unknown state throws through `entryBodyOf` and `reconstructPayload`, and a known body-less state keeps its own discard through the same stub); mutant F1 of the fix round.
- **D-6302** — `history-replay-unrenderable-body-discard` (Task 1; W2-D75 items 1 and 2): Task 1's `reconstructPayload` rendered a summary or kept-member body with `renderEntryText` and `JSON.stringify` unguarded, so a body nested past about 4,500 levels (which parses, far inside lib's `JSON_DEPTH_MAX`, and so reaches `expandEntryBody` as `body`) threw a `RangeError` that ended the run, where `recall.mjs`'s `expandEntryText` already catches the same error. The rendering is now guarded by `renderOrNull`, which catches `RangeError` only and rethrows anything else, and the boundary is discarded under one new `RECON_DISCARDS` word, `body-unrenderable`, appended after `leaf-absent`: a counted discard, never a refusal (R5). Pins: Task 1's D-6302 case (a 10,000-level nested kept member and summary row each discard `body-unrenderable`) and the `RECON_DISCARDS` case; mutants F2a, F2b and F2c of the fix round.
- **D-6303** — `history-replay-unrenderable-mined-body-discard` (Task 2; W2-D65, with D-6302): Task 2's `mineBoundary` rendered each mined row's body with `renderEntryText` unguarded, so a mined body nested past about 4,500 levels (which parses, far inside lib's `JSON_DEPTH_MAX`) threw a `RangeError` that ended the run. The rendering is now guarded by Task 1's `renderOrNull`, which catches `RangeError` only, and the boundary is discarded under the existing `RECON_DISCARDS` word `body-unrenderable`, as D-6302 rules for reconstruction; no word is added, and the word is kept last in the list. Pins: Task 2's D-6303 case (5,000 deep discards, CONTROL 4,000 deep mines), the list pin that `body-unrenderable` is last, and the unwrapped-render mutant of the fix round.
- **D-6304** — `history-replay-baseline-unrenderable-body-discard` (Task 4; W2-D68, with D-6302 and D-6303): Task 4's `baselineOf` rendered each stored body of parts 1 to 3 with `renderEntryText` unguarded, so a body nested past about 4,500 levels (which parses, far inside lib's `JSON_DEPTH_MAX`) threw a `RangeError` that ended B's build, and the run with it. The rendering is now guarded by Task 1's `renderOrNull`, which catches `RangeError` only, and B fails closed under the existing `RECON_DISCARDS` word `body-unrenderable`, as D-6302 and D-6303 rule; no word is added, and the word stays last in the list. The string leaves need no guard (`ftsTextOf` and the iterative leaf walk never throw). Pins: Task 4's D-6304 cases (a 5,000-deep summary row, kept member and post-summary row each discard `body-unrenderable`, CONTROL 4,000 deep builds); mutants MA (the `renderOrNull` wrap) and MB, MC and MD (each part's null check).
