# ccrc history wave W2-5b1: the arms and the judge, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Ship the arm and judge machinery of W2's replay eval in ONE PR on `main`. It is the first of the two serial PRs the coordinator split the deploy lane's W2-5b into (S1): W2-5b1 ships `marker`, `verify --section pilot|quiz`, `arms --section pilot|quiz` and `judge --section pilot|quiz`; W2-5b2, "the pilot and the verdict", ships the rest. It runs after W2-5a (#1134) and W2-2a (#1126) merged and after W2-2b (the headless seam, building as run 809) merges. It turns W2-4's driver core, W2-5a's reconstruction and record subcommands, W2-2a's as-of cut and W2-2b's seam into the acts the operator runs at the pilot and during the window (decisions §5, acts 13, 14, 18, 19 and 21). Nothing here runs a real model: every spawn in the tests reaches W2-4's recording stub. Task by task:
- **Task 1 (W2-D42, W2-D50, W2-D80, W2-D59, W2-D55, W2-D24, W2-D6, W2-D25, W2-D90; S2's C9 and C22, Q3, Q5, Q7, Q11, Q13, Q23, Q24, Q26; D-6467).** The pieces every later task shares, owned once (W2-5a's R3 carried): every import name W2-5b1 needs from lib, recall.mjs (`asOfCutOf`) and the gate, with D-5814's pin re-pinned for recall.mjs; the arm words by position, `CONTROL_ARM = RECALL_ARMS[0]` and `TREATMENT_ARM = RECALL_ARMS[1]`, the two quoted `'control'` sites rewritten, the arm-word scan and the set-parity pin with the gate's `ASSIGNMENT_ARMS`; the stop/refusal partition of `DRIVER_REASONS` (`DRIVER_STOPS`, 16 words; `DRIVER_REFUSALS`, 13); `readStreamJson`'s `parentToolUseId` and per-message list with both usage readings, and `spendTokens` charging the larger (Q7, D-6467); `run.json`'s two usage fields; `spawnEnv` refusing an unreal arm value, and RP1-arm on the stub; `--allow-code-change` in `FLAG_SPECS`, `codeRecheckVerdict` under `recheckCode`, `refuseOutOfRangeValues` widened to part 2's fields with the one batch-shape row set `batchShapeChecks` (R4; its floor `RECALL_ARMS.length`, R28), the one version-move row set `versionMoveChecks` and the one range refusal `refuseRangeRows` (R30), and `loadFinalRecord`, the one part 2 loader.
- **Task 2 (W2-D75, W2-D78 (iii), W2-D38, W2-D35 as amended, W2-D70; Q20, Q21, Q22; the ledger's R8 carry; D-6468).** The as-of pieces: the card line (`cardOf`: lib's `cardLine` over leaf N's node and a depth-1 parent lib's `asOfHiddenNodesSql` does not hide under `asOfCutOf(N)`, display prefixes over the family's whole node-id set); the two payloads (`armPayloads`: `plain`, W2-5a's `reconstructPayload` text byte for byte, and `carded`, the card line, one blank line, then that text); the per-question re-check (`recheckQuestion`, `recheckBatch`: clauses (a), (b) and (c), refusing `quiz-unanswerable` naming every failing qid and its clause); `mineStoredBoundary`, factored out of `sourceQuiz` unchanged; `LEAF_OF_BOUNDARY_SQL`; `card-unrenderable` in `RECON_DISCARDS`; the parity pins C1 and C2.
- **Task 3 (W2-D84's second half, W2-D76, W2-D78 (i), W2-D24, W2-D44, W2-D27; Q16, Q23; D-5781).** `marker --section pilot|quiz|ab --node-label <label>`, printing one node's exact text on stdout and its sha on stderr, writing nothing; `verify --section pilot|quiz`, reading the marker once and reporting each of eight states apart, with D-6284's over-hide counted per node under a stated all-visible cut, its ids capped at 1,000 beside the total (R10, R29); and the driver's one read of the marker (`readHeadlessOn`) with `requireListed`, W2-D78 (i)'s `family-unlisted`.
- **Task 4 (W2-D78, W2-D80, W2-D56, W2-D55, W2-D64, W2-D82, W2-D50, W2-D77, W2-D90; Q2, Q3, Q4, Q5, Q14, Q25, Q26, Q30, Q31; D-6469).** The arm engine, `arms --section pilot|quiz`, and the readers the judge shares (R8, R26): `loadArmRun`, `armNodeOf`, `readArmAnswers`, and `refuseSpawnAdmission` and `preflightSpawn` factored out of W2-5a's writer code; `readArmAnswers`' refusals and the pilot's settings-mode check pinned red-first (R31), and W2-D56's `expected` read through Task 1's version-move rows (R30). Both arms of each question side by side, `floor(limits.batch_max / 2)` questions per batch in frozen qid order, the batches looping in one invocation; the per-batch preflight composed once (W2-D78 (i), (ii), (iii), the payloads, a payload discard refused, then the wrapper, `batchGate` with this node's spend share and W2-D56 against part 1's step 0a entry or the node's newest `version-move` amendment); attempts per run name, one re-run per arm, `run-failed` excluded from both arms, a stop that never consumes the re-run; the per-batch manifest, one answer record per (qid, arm) and the summary.
- **Task 5 (W2-D79, W2-D54, W2-D80, W2-D81, W2-D18, W2-D52, W2-D55, W2-D56; Q2, Q5, Q18, Q23, Q31; D-6470).** The judge, `judge --section pilot|quiz`: one blinded judge-mode spawn per non-correct (qid, arm) of a settled question (a run-failed arm settles its question, R14), correctness re-derived and held to the answer record; the canonical input, every string masked as a value before the reply and the answer field are each capped at 16 KiB; positional ids from the `'judge-order'` shuffle over every (qid, arm) pair of the section's frozen list, the map in its own pinned file; one retry with identical stdin, then `judge-failed`; every `error` field a judge run carries recorded on its attempt (Q31); the same pre-`--out` refusals `arms` makes (D-5813's unusable inputs, the Opus model, D-6309's ranges); RP1-judge and RP3-judge.
- **Task 6 (R21, R22).** The arms-then-judge walk over one `--out` (one test commit), then the departures, the whole-PR checks and the PR.

Sessions see no change in behaviour: no hook, unit, timer, store, schema, wire or `ccd/**` file changes, and the driver opens every store read-only and never writes the headless-on marker or a recall-off file. Running any subcommand on a real node is the operator's (decisions §5), after W2's final release is rolled out (W2-D6), never the worker's.

**Architecture:** One L4 operator script and its test file. Ring membership is a property of a file's imports.

*`deploy/history-replay.mjs`* (L4: it owns `fs`, `child_process`, `process` and the clock) stays a standalone ES module whose entry guard is its last block. Every new section goes directly above the comment line `// The entry guard stays the LAST block of this file`, after the previous task's section and below W2-5a's `HANDLERS.set(` block, and each section that adds a subcommand ends with its own `HANDLERS.set` line. No module statement is added: the driver still loads W2-5a's fourteen modules, and every name W2-5b1 adds goes inside the braces of an existing statement (D-5814 as W2-5a widened it). Task 1 adds the names it knows; a later task that needs another adds it in its own commit, and for `recall.mjs` (the one pinned module W2-5b1 touches) updates `EXACT_NAMES` in the same commit.

Inside the file the decisions stay pure functions over values, and the measuring functions call them:
- **Pure:** `driverWordClass`, `usageTokens`, `spendTokens`, `codeRecheckVerdict`, `batchShapeChecks`, `versionMoveChecks`, `part2RangeChecks`, `prependCard`, `headlessPairsOf`, `headlessTextOf`, `abCommandsOf`, `headlessStateOf`, `unlistedOf`, `verifyHeadlessReport`, `armRunName`, `answerRel`, `armsSummaryRel`, `spendShareOf`, `questionStateOf`, `questionCountsOf`, `streamEventsOf`, `errorFieldsOf`, `uptakeOf`, `armAnswerOf`, `expectedForNode`, `armsSummaryOf`, `capUtf8Bytes`, `judgeInputOf`, `judgeStdin`, `judgeMapOf`, `judgeMapText`, `judgeItemsOf`, `judgeJobsOf`.
- **Measuring or acting:** `loadFinalRecord`, `recheckCode`, `armCut`, `cardOf`, `armPayloads`, `mineStoredBoundary`, `recheckQuestion`, `recheckBatch`, `readHeadlessOn`, `requireListed`, `overHideOf`, `loadArmRun`, `armNodeOf`, `readArmAnswers`, `refuseSpawnAdmission`, `preflightSpawn`, `openJudge`, and the three handlers `markerCommand`, `armsCommand` and `judgeCommand`, registered after W2-5a's `verify`; `verifyCommand` gains the `pilot|quiz` dispatch.

The arm batch, in order, composed once by Task 4: the record and `gate_code` (`loadArmRun`: Task 1's `loadFinalRecord` for the quiz, part 1 and `recheckCode` then the pilot list for the pilot) → the store, the named node, this node's questions and its spend share (`armNodeOf`) → every refusal that needs no store and no spawn, before `prepareOut` makes `--out` (W2-5a's R10) → per batch: W2-D78 (i) (Task 3's `requireListed`), (ii) (W2-4's `refuseRecallOff`), (iii) (Task 2's `recheckBatch`, then `armPayloads` per question, a discard refused, D-6469) → `preflightSpawn` (the wrapper, `batchGate`, `--version` and W2-D56's `preflight`) → the manifest → the spawns → the answer records once a question settles → the summary. Then the judge, per node, in that node's `--out` (Q2): `loadArmRun`, the unusable inputs and the judge model, `armNodeOf`, the ranges and `refuseSpawnAdmission`, each before `prepareOut` as in `arms` → the pinned map → `readArmAnswers` → the non-correct (qid, arm) items → the inputs → the judge batches with `preflightSpawn` before each → `judged.json`. Every refusal is still W2-4's `DriverRefusal(word, detail)` with a word in `DRIVER_REASONS`; W2-5b1 adds no word to it (R11). Every per-arm value is keyed by `RECALL_ARMS`' members at run time, so the driver never spells an arm word (W2-D42).

*`server/test/history-replay.test.ts`* gains, per task, describes titled `W2-5b1 Task <N>: …` (R9), each with its own prefixed import group (`w5b1`, `b1t2`, the r7-scoped import of Task 3, `w5b4`, `w5b5`). Tasks 1 and 3 each nest one describe inside W2-5a Task 7's outer `r7describe`, in task order after `verify section ab`, to reuse its signed fixtures (`chain7`, `tree7`, `save7`, `home7`, `run7`, `snapshot7`); every other describe is appended at the end of the file, Task 6's walk last. In-place edits of earlier cases: W2-4's `FLAG_SPECS` pin (+`allow-code-change`), W2-4 Task 4's three stream cases, `T5_RECALL`, D-5814's recall.mjs entry and W2-4 Task 9's probe spend (Task 1); W2-5a Task 7's `--allow-code-change` case (Task 1) and its `verify --section quiz` line (Task 3); W2-4 Task 9's `HANDLERS` key line, which gains `'marker'`, `'arms'` and `'judge'` (Tasks 3, 4 and 5). A W2-5a case is edited in place in exactly three spots, each licensed by R27 because Q23 and the new `verify` sections force it, and each named in its task's commit and in the PR body: Task 1 Step 2(f) (the `--allow-code-change` assertion), Task 3 Step 2 (the `verify --section quiz` line) and Task 2's count literal (`'card-unrenderable': 0`, added only if Task 2 Step 5 finds a W2-5a case pinning the whole count object; none does at `c34f82830`, measured). No W2-5a W2-D24 re-check case is edited: each owning task adds its own rows under W2-5a's titles (R23, as R27 narrows it).

**Tech Stack:**
- Node `>=22.16.0` ES modules (`.mjs`), the driver's shebang and every spawn of it under `--no-warnings` (W2-5a). `node:sqlite` only through `store.mjs`'s `openReader` (read-only, `query_only`).
- `ccd/history/lib.mjs` as W2-2a and W2-2b merged it (`RECALL_ARMS`, `HEADLESS_LIST_MAX_BYTES`, `parseHeadlessList`, `formatHeadlessList`, `cardLine`, `displayPrefixes`, `asOfBinds`, `asOfHiddenNodesSql`, `asOfVisibleEntriesSql`), `recall.mjs`'s `asOfCutOf`, `store.mjs`'s `readBounded`, `deploy/history-gate.mjs` as W2-3 shipped it (`classifyRun`, `questionOutcome`, `QUESTION_OUTCOMES`, `parseAnswerField`, `labelCorrect`, `parseLabelLine`, `RUBRICS`, `RUBRIC_IDS`), W2-4's driver core (`runBatch`, `launchRun`, `spawnArgv`, `spawnEnv`, `admitAccount`, `batchGate`, `preflight`, `preflightFiles`, `codeShas`, `prepareOut`, `claimOut`, `readStreamJson`) and W2-5a's pieces (`reconstructPayload`, `screenRedaction`, `answerability`, `openReplayStore`, `loadRecordInput`, `refuseWriterAdmission`, `openWriter`, `rosterConfigDirs`, `maskValue`, `seededOrder`).
- vitest 4 in `server/`: in-process for exported functions over hand-built stores (`createStore` under `mkTmp`), spawned `node --no-warnings` for subcommands that run as the operator runs them, W2-4's recording stub for every Claude Code spawn, and W2-5a's `w6SourceBox` (the real sweep in a `historyHelpers` box) for Task 4's one end-to-end case.

**Spec:** `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md`, rev 3.6, as amended in place by W2-1. **W2-5b1 amends none of it** and never holds the spec path (W2-D3, S1). The errata W2-5b owes (decisions §6: E2, E7, E8, E9, E10, E11 and E19 to E24) are all W2-5b2's, two of them from decisions this PR implements: E21 (§10.2's as-of seam: the pilot marker lists the pilot pairs, D-5781) and E22 (§10.2's item 3 and "Scoring"; D-5776, D-5777, D-5778). Line numbers are hints measured at `c34f82830`; re-anchor by content:
- §8.2 the headless-on marker (about :1525; erratum E9's sentence); §8.6 "The card line" (about :1830), its grammar `CARD_LINE_PATTERN`;
- §10.2 "Wave 2: the replay eval" (about :2628): "Who sees what" (about :2665), "Two arms" (about :2670) with "the card line, which the driver prepends to the treatment prompt" (about :2694), "The as-of seam" (about :2695), "Account and budget" (about :2698), "Scoring" (about :2716-2721);
- the pins this PR builds: RP1-arm, RP1-judge and RP3-judge (RP1 about :2752, RP3 about :2754), the W2-D78 refusals with the stub's log absent, the W2-D84 round trip, and the arm-word scan (W2-D42).

**Ledger:** `docs/superpowers/programs/ccrc-history.md`: the W2-5b row ("after W2-2b, W2-3 and W2-5a; merges before open-record part 1"); "Carried constraints", both bullets "For W2-5b's plan" (W2-5a's R8: the two parity pins, which Task 2 lands; the `--no-warnings` README sentence, the pilot-result shape and `open --finalize`'s budget, which are W2-5b2's; and from W2-2a and W2-2b: the card parent through lib's widened rule, which Task 2 lands; the R8 ref-survival decider, moot here by S2; the arm-word parity, Task 1's; D-6284's over-hide, Task 3's per node by Q16); and "Later" (the validator's range checks and lib's `redactField` R-3, both staying there by S2). The ledger is the coordinator's file; no task edits it.

**Rulings while planning.** The coordinator ruled S1, S2 and Q1 to Q31 (answering the W2-5b scoping study) and R1 to R26 (answering the task drafts' questions), each in the operator's place under the directive of 2026-10-19, and issued D-6467, D-6468, D-6469 and D-6470 for the four departures found while planning (R3). After the plan review it ruled R27 to R32 (2026-10-22), in the operator's place under the same directive: R27 narrows R23 to W2-5a's W2-D24 re-check cases and licenses three in-place edits; R28 pins the batch floor; R29 sets `OVER_HIDE_IDS_MAX`; R30 gives the version-move ranges one spelling; R31 asks red-first cases for three more refusals; R32 makes the walk's and the end-to-end case's fixture assumptions predictions. The Decisions table names the ones this PR implements. A ruling here is the operator's to change. R1 to R32 are this plan's; an R-number of another document keeps its owner beside it: W2-5a's R3, R5, R8, R9 and R10 ("the ledger's R8 carry" is W2-5a's R8), and "R8's ref rule" or "R8's decider", recall.mjs's private ref-survival decider.

**Authority:** `docs/superpowers/plans/2026-10-19-ccrc-history-w2-decisions.md` (the W2 decisions document): §2's "W2-5b (deploy)" entry, split (not changed) by S1, whose Ships, Pins and Decisions this PR divides with W2-5b2 as the scoping study's section C divides them; W2-D42, W2-D50, W2-D54, W2-D55, W2-D56, W2-D59, W2-D64, W2-D75, W2-D76, W2-D78, W2-D79, W2-D80, W2-D82, W2-D84, W2-D24, W2-D6, W2-D18 and the decisions they cite; §5's acts 13, 14, 18, 19 and 21; §7's residuals (the unclassified stop words, C6's spend under-count). Then the spec, then the merged code at the base. The document was written at `bd363a76b` and amended in place since: every line it cites is a hint, and "Drifts since the decisions document" below lists what moved and what that changes. Where this plan and that document differ, the document wins and the worker reports the difference, except where a ruling (S, Q, R) or a departure below says otherwise. Re-read the merged code before editing it: a plan text is never ground truth. W2-5b1 defines no decisions-document number.

**Base:** `main` after W2-2b merges, which holds W2-5a (#1134, `c34f82830`), W2-2a (#1126), W2-1 (#1105), W2-3 (#856) and W2-4 (#826). Anchors are measured at `c34f82830`; W2-2b's plan edits neither of this PR's two files, so the anchors in them hold on the dispatch base, and the lib, recall.mjs and `single-definition.test.ts` anchors below are re-measured there. Task 1's Step 0 runs `git merge-base --is-ancestor c34f82830 HEAD` and checks that lib exports W2-2b's names and its two refusal words, and stops before any edit if either fails. Measured anchors (hints; re-anchor each by its quoted content):
- `deploy/history-replay.mjs` (5,801 lines): the header's `Imports:` sentence (about :9-12) and its "Never spelled here" sentence (about :24-26); the lib, recall.mjs and gate import statements (about :36, :39, :42-43); `DRIVER_REASONS` (about :69, 29 words, the last `store-unreadable`); `FLAG_SPECS` (about :110, 49 flags); `HANDLERS` (about :135); `readStreamJson` (about :684), `spendTokens` (about :769); the spawn contract's comment (about :1086), `spawnEnv` (about :1168); `launchRun`'s run record line (about :1743); `RECON_DISCARDS` (about :2630, its last word `body-unrenderable`); `composePayload` (about :2666), `replayStmts`' span statement (about :2706), `reconstructPayload` (about :2858); `SOURCE_FAILS`' comment (about :3690); `quizPopulation`'s `'control'` (about :4013); `pinWriterInput` and `refuseWriterModel` (about :4294, :4305); `openWriter` and its `preflightNow` (about :4322, :4335); `sourceQuiz` (about :4593); `SUBCOMMAND_FLAGS` (about :4811); `loadFrozen` (about :4884); `recheckCode` (about :4921); `abStateOf`'s `'control'` (about :5196); `refuseOutOfRangeValues` (about :5405), `refuseWriterAdmission` (about :5435); `verifyCommand` and its ab-only refusal (about :5781, :5785); the `HANDLERS.set(` block (about :5789-5794); the entry-guard comment (about :5796);
- `server/test/history-replay.test.ts` (10,678 lines, 411 `it`s): the `FLAG_SPECS declares exactly …` case (about :199), W2-4 Task 4's stream cases (about :886, :907, :945), `T5_RECALL` (about :1156), D-5814's `EXACT_NAMES` (about :3051-3065), W2-4 Task 9's probe spend line (about :4813) and `HANDLERS` key line (about :4824), W2-5a Task 7's outer `r7describe` (about :8934), its `verify --section quiz` refusal line (about :9249), its `--allow-code-change` case (about :9252), its `codeShas` re-check describe (about :9376), the close of `verify section ab` (about :10500);
- `deploy/history-gate.mjs` (2,577 lines, never edited): `SUBSTREAMS` (about :59, last `'judge-order'`), `ASSIGNMENT_ARMS` (about :70, `['treatment', 'control']`), `GATE_CODE_FILES` (about :145), `RUBRIC_HEAD` (about :1463), `RUBRICS` and `parseLabelLine` (about :1474-1502), `classifyRun` (about :1564), `questionOutcome` (about :1583), `handcheckSample` (about :1607, iterating `ASSIGNMENT_ARMS`' order), the amendment rules (about :2564-2566);
- `ccd/history/lib.mjs` (never edited): `asOfHiddenNodesSql` (about :4515), `cardLine` (about :8940), and W2-2b's `RECALL_ARMS`, `HEADLESS_LIST_MAX_BYTES`, `parseHeadlessList`, `formatHeadlessList`, `headlessMarkerOf`; `historyPaths(home).headlessOn`; `ccd/history/recall.mjs`: `asOfCutOf` (about :505);
- `server/test/single-definition.test.ts` (never edited): O13's switch describe (about :5111) and its recall-off case (about :5273), the symbolic write scan (about :5517), O14 (about :5319), W2-2a's as-of definers (about :8453), W2-2b's appended describe; `server/test/lifecycle.test.ts` imports the driver in-process for `OUT_MARKER` (about :1336).

**The split (S1).** W2-5b ships as two serial PRs on the deploy lane. This plan is the first. **W2-5b2, "the pilot and the verdict"**, dispatches after W2-5b1 merges, its plan drafted while this one builds and anchored on this PR's head. It carries: `step0b` (W2-D57, W2-D58; Q11, Q26), recording `error_max_turns` and every `error` field, with `turnBoundHeld` counting main-thread messages through `facts.messages` (R1); `fidelity` in box mode with no marker, checked against part 1's pilot (W2-D76; Q8, Q9); the usage pilot through this PR's `arms` and `judge`, and its extrapolation (W2-D55; Q6); `pilot-result`, the producer of the shape W2-5a reads (W2-5a's R8), what a failed pilot is (Q10), and the pilot's measured relation between the two spend readings (Q7); `open --finalize` deriving `spend_budget` and refusing a mismatch (D-6280) or a failed pilot without `--accept-failed-pilot` (Q27); `open --amend` with its detail schemas (W2-D90; Q12, Q13), whose `version-move` entry this PR's version preflight already reads; W2-D56's rule that after a version re-pilot both arms of every question with only one arm done are re-run on the new version (the scoping study's C19 and its Task 8), read from this PR's per-batch manifests (Q14), which name the version each run was spawned under; `handcheck --sheet` and the label reader (W2-D81; Q19); `report`, which gathers every node's files with their shas and calls `decideGate` (W2-D85, W2-D89; Q15, Q17, Q28; S2's C15 and C21), with RP6-e2e and RP7-e2e; README's driver paragraph naming the `--no-warnings` shebang; and the spec errata. Q29 lets W2-6 run beside W2-5b2 if its plan shows the two line-disjoint.

**PR:** see "The PR" at the end of this header.

## Global Constraints

- **One PR, deploy lane.** Executed in task order, one commit per task: Tasks 1 to 5 each commit their code and tests, and Task 6 commits its one test, the arms-then-judge walk (R21). W2-5b1 dispatches only after W2-2b merged (S1, W2-D2) and when no running worker claims either of its files (W2-D3).
- **Exactly two files, both modified.** `deploy/history-replay.mjs` and `server/test/history-replay.test.ts`. No new file of any kind (W2-D5): no test file, no helper, no `.d.mts`, so `ci.yml`'s node-floor heredoc is unchanged. The plan file is the one other path a commit may touch, and only to define a number issued during the build or to correct a prediction (S1 as R25 reads it). A worker who finds another file unavoidable stops and mails the coordinator.
- **Never touched:** `ccd/**`, `shared/**`, the spec, `README.md`, `CLAUDE.md`, `deploy/history-gate.mjs`, `deploy/measure-history.py`, `.github/**`, the programme ledger, the decisions document, and every other test file. `single-definition.test.ts`, `lifecycle.test.ts`, `measure-history.test.ts`, `citations.test.ts`, `dtbd.test.ts`, `growth-check.test.ts`, `topology-clean.test.ts`, `ci-pipeline.test.ts`, `docs-policy.test.ts` and `deviation-refs.test.ts` are re-run, never edited. A mutant applied in place is restored byte for byte (`cmp`) before the next step.
- **The gate's order stands (S2's C9).** `ASSIGNMENT_ARMS` stays `['treatment', 'control']`, because `handcheckSample` iterates it; the parity with `RECALL_ARMS` is a set-equality pin in the test file, and no import is added to the gate.
- **No schema change, read-only stores.** No table, column, index or `SCHEMA_ADDED` entry (W2-D10); every store read opens through `openReader` (W2-D51); no `deploy/history-*.mjs` spells a `node:sqlite` specifier, in code or in a comment.
- **Must-holds (the scoping study's section C, W2-5b1):**
  - no arm spawn unless every batch family is listed in this store's headless-on (W2-D78 (i)), no `recall-off/<id>` for any batch family (ii), each question re-checked (iii) and its payload reconstructed (D-6469), W2-D56 against part 1's step 0a entry or the node's newest `version-move` amendment, and `batchGate` passes; each W2-D78 refusal and each refusal before `--out` with the stub's log absent, and a W2-D56 refusal (its check is the `--version` spawn) with only the `--version` line logged and no `-p` run;
  - RP1-arm: the arm env's exact seven keys, with the ARM value from `RECALL_ARMS` and ASOF the boundary's uuid (W2-D50);
  - the control payload byte-identical to W2-5a's composer output; the treatment payload the card line, one blank line, then the control payload (Q20);
  - the card never names a parent hidden under `asOfCut(N)` (CONTROL: a parent with a leaf formed after N);
  - no driver line spells an arm word, and `RECALL_ARMS` and `ASSIGNMENT_ARMS` are equal sets (W2-D42, S2's C9);
  - the judge's stdin, input files and file names carry no arm token; a correct answer never reaches the judge; malformed twice is `judge-failed` (W2-D79);
  - every `DRIVER_REASONS` word is classified exactly once as a stop or a refusal; a question with no recorded run is `not-run`; a stop never consumes the re-run (W2-D80, Q24);
  - `marker` writes nothing and round-trips through `parseHeadlessList` (W2-D84);
  - no driver line spells `/headless-on`, and none pairs a write verb with `.headlessOn` (O13); exactly one driver code line names `.headlessOn`, the bounded no-follow read;
  - every `--record` consumer (`marker`, `verify --section pilot|quiz`, `arms`, `judge`) re-checks `gate_code` before any other input (W2-D24);
  - a data case after `--out` never exits INTERNAL (D-6309's rule), and a refusal that needs no store and no spawn answers before `prepareOut` makes `--out` (W2-5a's R10).
- **`--allow-code-change` (Q23, R13).** Declared once in `FLAG_SPECS`; listed only on the quiz forms of `arms` and `judge`; accepted at or after `window.start_ms` only (`args-invalid` before it, and on a part 1); a measured change becomes the `code-changed` stamp on every output; an unmeasured file stays `code-unmeasured`. `marker`, `verify` and the pilot forms take none.
- **Never a shell.** Every child is spawned with an argv array through W2-4's `launchRun`/`runBatch`; never `exec`, `execSync`, `shell: true` or a command string. A CodeQL `js/shell-command-injection-from-environment` thread blocks the merge.
- **The environment.** `main(argv, env)` keeps W2-4's by-name projection `{HOME, TMUX_PANE, LANG}`; no new `process.env` line. Test-only seams (`deps.timeoutMs`, `deps.now`, injected readers) are parameters, never flags.
- **Single definition (W2-D12).** Each new name is declared once in the driver: one arm-word source (`RECALL_ARMS`, indexed on exactly two code lines), one stop/refusal partition, one usage charge (`spendTokens`), one part 2 loader (`loadFinalRecord`) and one arm-run loader over it (`loadArmRun`), one range check (`refuseOutOfRangeValues`, with `part2RangeChecks`, the one batch-shape row set `batchShapeChecks`, the one version-move row set `versionMoveChecks`, which Task 4's `expectedForNode` reads too (R30), and the one range refusal over a row set, `refuseRangeRows`), one leaf-of-boundary rule (`LEAF_OF_BOUNDARY_SQL`), one cut call (`armCut`), one prepared node-rule statement (`armStmts`' `hidden`, which Task 3's over-hide count reuses), one card builder (`cardOf`), one payload pair (`armPayloads`), one mining composition (`mineStoredBoundary`), one marker read (`readHeadlessOn`), one no-spawn admission (`refuseSpawnAdmission`) and one spawn preflight (`preflightSpawn`) for the writer, the arms and the judge (R26), one answer reader (`readArmAnswers`), one Opus-model refusal (`refuseOpusModel`) and one `--out` byte pin (`pinOutBytes`). lib's as-of statements, `cardLine`, `displayPrefixes`, `parseHeadlessList` and `formatHeadlessList` are imported, never re-spelled; recall.mjs's private R8 decider is never composed (S2's C8).
- **Vocabularies.** `DRIVER_REASONS` gains no word (R11). `RECON_DISCARDS` gains `card-unrenderable`, directly before `body-unrenderable`, which stays last (Task 2). `CARD_PARENTS`, `MARKER_SECTIONS`, `HEADLESS_ON_STATES` and `JUDGE_OUTCOMES` are driver-local report lists, the last pinned disjoint from `DRIVER_REASONS` and `GATE_REASONS` (S2's C21 as W2-5a's R5 pinned its drop lists).
- **No overloaded null.** `verify`'s eight headless-on states stay apart; `unanswerable` and `unanswerable-untimed` stay apart; a stop and a refusal are told apart in every summary; `answer_field` is the value, `UNKNOWN` or `null` (none given); `resultUsage` is `null` when the stream has no result usage, never zeros.
- **Live safety.**
  - Every test builds its `HOME` with `mkTmp` and writes its own roster, limits row, secrets file and stub Claude Code at `$HOME/.local/bin/<id>`; every spawned run gets W2-4's `spawnEnv` with the poisoned `gh` first on its `PATH`. A refused account, and every W2-D78 or pre-`--out` refusal, is asserted by the stub's log being absent.
  - Stores are hand-built (`createStore` under the fixture HOME, written through `openWriter`, read through `openReplayStore`) or built by the real sweep in W2-5a's `w6SourceBox`. No case runs `cli.mjs`, the shim, `ccd`, `ccrc`, `claude`, `deploy/history-gate.mjs` or `deploy/measure-history.py`, and none reads `~/.ccrc`, `~/.cc-sessions`, `~/.cc-limits` or an account home. The headless-on marker is written only into fixture HOMEs, by the test.
  - Key-shaped values are assembled at runtime from parts; non-ASCII fixtures are built with `String.fromCharCode`. No live pid but `process.pid` or 1. Never kill a process by pattern; a timeout kills only the run's own process group (D-5984).
  - A case that needs an unreadable file (mode 000) is skipped when `process.getuid() === 0`. Each task removes the fixture directories its runs create.
- **Running tests.** From `server/`, `./node_modules/.bin/vitest run test/history-replay.test.ts -t '<regex>'`, in the foreground, timeout at least 600000 ms, one suite per tool call, never bare `npx vitest`. Each `-t` filter is regex-safe and selects at least one test; a run that reports only skipped tests selected nothing and is not green. CLAUDE.md's load flakes are re-run alone before a red is called a break.
- **Red-first.** Every new guard is watched red on the unguarded code (the prediction written before the run), then each named mutant is measured red, then green again; every refusal a task adds has its own red-first case, CONTROL and mutant, `readArmAnswers`' and `loadArmRun`'s pilot settings-mode check included (R31). The one exception is the stream re-read that `armAttemptsOf` (Task 4) and `judgeAttemptOf` (Task 5) make of a run W2-4's `launchRun` has just written or `finishedOutcome` has just measured: its `run-stream-changed` refusal is defence behind those checks, which no single-process case reaches without racing the batch, and each task names it as unpinned. A red at a CONTROL is the fixture's to fix, never the guard's to weaken.
- **Fixture assumptions are predictions (R32).** Every count and outcome this plan writes is a prediction the worker measures, and so is every fixture assumption no planning step measured: Task 6's walk fixtures (the stub HOME, the store, the four canned arm streams and what the judge makes of them) and Task 4's end-to-end case on W2-5a's `w6SourceBox` store (its uuids, its command fact, the boundary that reconstructs). If one does not hold, the worker fixes the fixture, never the guard, and records the measured value over the predicted one in a `docs(plan): … (W2-5b1 Task <N>)` commit under the task whose prediction it was (R25). Scratch goes under `.superpowers/sdd/history-w2-5b1/` (gitignored), never `git stash`.
- **One mutant per tool call.** A mutant step's block (Tasks 1, 3, 4 and 5) is a preamble (the scratch path, `mut`, the file variable, the `cp` of the original and the run helper) and one `mut` and filter per mutant. It is never run whole: a tool call that times out kills the shell before the helper's `cp` restores the file, and the next step would run on a mutant. Run the preamble once, `cp` of the original included; then each mutant as its own tool call, which repeats the preamble's definitions without its `cp` of the original, applies that one mutant, runs its one filter, and ends with `cmp` of the file against the copy, which must print nothing. After a call that timed out or was cut off, restore with `cp` from the copy and `cmp` before anything else. The block's closing `cmp` and `rm` run in a last call of their own.
- **Every commit green.** Each task leaves every suite green at its own commit, the whole of `history-replay.test.ts` included. No step depends on a later task.
- **Citations and growth.** No added code or test line cites `file.mjs:N`, `file.ts:N` or `ccd:NNNN` (`citations.test.ts`, D-5893): cite symbols. `growth-check.test.ts`'s `GROWTH_FILES` (D-6178) lists neither file, so the driver's growth needs no exemption (D-6211) and no waiver (D-6223).
- **Commits.** One per task, in task order, each subject `feat(history-replay): … (W2-5b1 Task <N>; W2-D…)` (Task 6's `test(history-replay): …`), each message ending with the Co-Authored-By line the worker's session's attribution reminder gives, passed as the last `-m` from `CO_AUTHORED_BY`, set in the same command as its `git commit`. A task that edits a W2-5a case in place (R27: Tasks 1 and 3 always, Task 2 only if its Step 5 made the edit) passes one more `-m` between the subject and that line, naming the case and the edit. A fix round's commit names the task that owns the code it changes, `fix(history-replay): … (W2-5b1 Task <N>; …)`, and defines the number it first cites. A corrected prediction is `docs(plan): … (W2-5b1 Task <N>)`, touching only this plan, under the task whose prediction it was (R25).
- **Public repo.** No host, user, account, wrapper, lane, pool, session or person name, no private project name, no IP address, no absolute home path, no private ticket id and no docserver URL, in plan text, fixtures, comments, commits or the PR body. Fixture paths are `mkTmp` paths or synthetic (`/home/u/tree`, `/home/u/.claude`); account ids are W2-4's synthetic `up-a`, `gen-a`, `gen-o`, `cx-a`, `ext-n`, `ext-a`; model ids are synthetic. Task 6 Step 9 counts private names over every added line, every commit message, the PR title and body and this plan; it must print 0.
- **Node floor.** `>=22.16.0`, identical in `server/`, `agent/` and `pwa/`; no task changes it.
- **macOS.** `test-macos` is advisory, but a `history-replay` red there once blocked a stable promotion (D-6122): paths come from `mkTmp`, nothing assumes `/proc`, and the describes that run the sweep (W2-5a's `w6SourceBox`) or spawn Task 4's arm stub skip on darwin (`skipIf(process.platform === 'darwin')`): Task 4's two stub describes, Task 5's two cases on Task 4's arm-stub HOME (the `--allow-code-change` case and the spend-share case; measured, Task 5's own text governs) and Task 6's walk. A describe whose spawns reach W2-4's recording stub, with `withoutDarwinAdded` dropping the one key macOS adds, runs everywhere, as W2-4's RP1-contract and W2-5a's writer-spawn describes do: Task 1's stream and RP1-arm describes and Task 5's spawn and subcommand describes. Task 4's choice to skip its stub describes is its own.
- **D-numbers.**
  - W2-5b1 defines no number of the decisions document (W2-D4) and no number of W2-5b2's.
  - It defines four, issued by the coordinator while planning (R3), each in "Deviations found" at the end of this plan and first cited in its task: D-6467 (Task 1), D-6468 (Task 2), D-6469 (Task 4) and D-6470 (Task 5).
  - Earlier numbers are cited bare, never defined here: D-5765, D-5766, D-5767, D-5768, D-5769, D-5774, D-5776, D-5777, D-5778, D-5780, D-5781, D-5813, D-5814, D-5848, D-5893, D-5983, D-5984, D-5985, D-5986, D-6122, D-6178, D-6211, D-6223, D-6238, D-6280, D-6281, D-6282, D-6283, D-6284, D-6301, D-6302, D-6303, D-6305, D-6306, D-6307, D-6308, D-6309 and D-6311 (each measured defined in a plan at `c34f82830`).
  - A departure found while executing takes the next unused number from the run's block named in the brief and is defined in "Deviations found" in the commit that first cites it; otherwise it is reported, never invented. Never write a number that was not issued, and never write a range. A number issued and left unused is named in the wave-done report, never in the PR.
  - Before the PR: `git fetch origin main`, then `cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts`.
- **Peers.** Before the first edit of each file, read `GET /api/claims?project=ccrc-pwa`.

## Decisions

Every S, Q and R row is the coordinator's ruling in the operator's place under the directive of 2026-10-19.

| # | Decision | Status | Task(s) |
|---|---|---|---|
| W2-D6 | **The build freeze.** `tree-moved` in every arm and judge batch's preflight; no `--allow-code-change` before window start (the remedy there is a re-pilot). | coordinator ruling (W2 decisions document) | 1, 4, 5 |
| W2-D18 | **Seeds.** A sort by stated key before every seeded draw: familyKey order for the marker's pairs; (qid, arm) by code unit before the `'judge-order'` shuffle (as amended 2026-10-20). | coordinator ruling | 3, 5 |
| W2-D24 | **`gate_code` re-check** in each of this PR's `--record` consumers, right after the record validates: `marker`, `verify --section pilot|quiz`, `arms` and `judge` (both sections); `--allow-code-change` answered as a stamp after window start (Q23). | coordinator ruling | 1, 3, 4, 5 |
| W2-D25 | **The final's chain** through W2-5a's `loadRecordInput` and the validator, then the part 2 ranges (S2's C22). | coordinator ruling | 1 |
| W2-D27 | **The generation always printed** in `marker --section ab`'s `recall-off` lines. | coordinator ruling | 3 |
| W2-D35 (as amended), W2-D38 | **lib's as-of decision, never a second copy:** the card parent through `asOfHiddenNodesSql` under `asOfCutOf(N)` (D-6282, D-6283, D-6284); clause (c) through `asOfVisibleEntriesSql`; the over-hide count through the same prepared node-rule statement under a stated all-visible cut. | coordinator ruling | 2, 3 |
| W2-D42 | **ARM values.** The driver imports `RECALL_ARMS` and never spells its words; the arm-word scan of the driver lands here. | coordinator ruling | 1 (2 to 5 keep it green) |
| W2-D44 | **The marker's read:** one path, no link followed, bounded at `HEADLESS_LIST_MAX_BYTES`. | coordinator ruling | 3 |
| W2-D50 | **The arm env.** RP1-arm asserts the exact seven keys with the real ARM and ASOF values; `spawnEnv` refuses an unreal value before any spawn. The judge gets the allow-list with no `CCRC_RECALL_*`. | spec-decides | 1, 4, 5 |
| W2-D52, W2-D53 | **Admission and resume:** `cx-a`, `ext-n`, `ext-a` and `gen-o` refused before any spawn; a finished run is reused, never respawned. | coordinator ruling | 4, 5 |
| W2-D54 | **Spawned text:** every judge input string masked as a value before any cut; the card line holds no stored field and is not redacted (R5). | coordinator ruling | 2, 5 |
| W2-D55 | **The limits stop and the budget in force:** part 1's `pilot_budget` for `--section pilot`, this node's share of `spend_budget` for `--section quiz` (Q5); the charge is the larger usage reading (Q7, D-6467). | coordinator ruling (values: open-record defaults) | 1, 4, 5 |
| W2-D56, W2-D90 | **Preflights before every batch**, against part 1's step 0a entry for this node, its `claude_code_version` replaced by the node's newest `version-move` amendment (last in array order); `open --amend` itself, and the re-run of both arms of every half-done question on the new version (the scoping study's C19), are W2-5b2's. | coordinator ruling | 1, 4, 5 |
| W2-D59, W2-D80 | **Driver words and failed runs.** No `DRIVER_REASONS` word added; every word classified once (16 stops: W2-D80's seven, §7's eight, `store-unreadable`; 13 refusals, W2-D78's three among them, R2); `not-run` emergent; one re-run per infrastructure failure, then `run-failed`, excluded from both arms. | coordinator ruling | 1, 4 |
| W2-D63 | **`labelCorrect`**, the gate's one definition, for the answer record and for the judge's re-derivation. | coordinator ruling | 4, 5 |
| W2-D64 | **The answer protocol's half here:** the absent ANSWER line per (qid, arm) and the absent rate per arm as `{num, den}`; the halt is W2-5b2's pilot result and the gate's. | open-record default (`absent_rate_max`) | 4 |
| W2-D70 | **Answerability**, clause (b) of the re-check, through W2-5a's `answerability`. | coordinator ruling | 2 |
| W2-D75 | **The card line** (W2-D75's last item): lib's `cardLine` over leaf N, its parent only when visible under the cut at N, with its CONTROL. | coordinator ruling | 2 |
| W2-D76 | **The pilot marker** lists exactly the pilot pairs (`marker --section pilot`, D-5781); `arms --section pilot` runs under part 1. | open-record default | 3, 4 |
| W2-D77 | **The two sections:** the pilot from part 1's pilot list, the quiz from part 2's frozen list, this node's questions only. | open-record default | 4 |
| W2-D78 | **Preflights before every arm batch:** (i) `family-unlisted` (Task 3's `requireListed`), (ii) `family-recall-off` (W2-4's), (iii) `quiz-unanswerable` naming qid and clause (Task 2's `recheckBatch`, D-6468) and a payload that no longer reconstructs (D-6469), each before any spawn with the stub's log absent. | coordinator ruling | 2, 3, 4 |
| W2-D79, W2-D81 | **The judge:** one spawn per non-correct (qid, arm); the canonical input, redacted then capped at 16 KiB (the answer field too, D-6470); no arm token in stdin or names; the `'judge-order'` shuffle; the last LABEL line; one retry with identical stdin; `judge-failed`, which W2-5b2's sheet lists. | open-record default (the rubric id) | 5 |
| W2-D82 | **Quiz uptake facts** per run: Bash `isHistoryCommand` calls paired with a non-error result, `via_agent` from `parentToolUseId`; the `is_error` reading is the pilot's (W2-5b2). | coordinator ruling | 1, 4 |
| W2-D84 | **`marker` and `verify --section pilot|quiz`** (the second half): one node per call, writing nothing; each mismatch kind reported; its three pins. | coordinator ruling | 3 |
| S1 | **Two serial PRs.** This one: Tasks 1 to 5 of the scoping study plus its whole-PR task; `marker`, `verify --section pilot|quiz`, `arms`, `judge`; the two files, and this plan for build-time numbers or corrected predictions (as R25 reads it); no README, no spec. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | all |
| S2 | **Carries outside the files.** C8 (R8's decider into lib) moot; C9 a set-equality pin, the gate untouched; C21 report words driver-local; C22 the driver-side range check extended to `spend_budget` and every part 2 field a consumer reads, before `--out`; C23 a named residual. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1, 2, 5, 6 |
| Q1, Q2 | **Separate subcommands sharing one `--out`**, each spending and resuming on its own; arms and judge per node, in that node's `--out`. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 4, 5 |
| Q3 | **The batch shape:** both arms side by side at concurrency 2, 5 questions per 10-job batch in frozen qid order, the preflight before each batch (the record's values, R4). | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1, 4 |
| Q4 | **Attempts:** run names per attempt; a driver timeout is `infra-failed`; one re-run as attempt 2 (per arm, R14). | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 4 |
| Q5 | **The per-node spend share,** ceil(spend_budget × node questions / all questions), in BigInt, printed and enforced by the node's ledger. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 4, 5 |
| Q7 | **The fail-closed charge:** max(result usage, the sum of every assistant message's usage, subagent messages included), both recorded, in every spawn mode (D-6467). | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1 |
| Q11 | **A subagent's tool calls** attributed by `parent_tool_use_id` (the reader's half; step 0b's list is W2-5b2's). | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1 |
| Q13 | **The `version-move` detail** `{claude_code_version, repilot_sha256}` with `node_label_ref` required, read and range-checked here. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1, 4 |
| Q14 | **A per-batch manifest** with the preflight's measured version and the batch's run names. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 4 |
| Q16 | **D-6284's over-hide** measured per node, read-only, in `verify --section quiz`, binds stated (R10, R24). | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 3 |
| Q18 | **Positional judge ids** from the `'judge-order'` shuffle; the id map in its own file. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 5 |
| Q20 | **The card:** display prefixes over the family's whole node-id set; the card line, one blank line, then the payload. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 2 |
| Q21 | **W2-D78 (iii)'s depth:** the one `screenRedaction`; any answerable source; the frozen `source_entry_uuid` visible under `asOfCutOf`, `asof-invalid` there being clause (c) (D-6468). | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 2 |
| Q22 | **The parity pins:** C1 on T_N, the holding file and the counted entries; C2 on a readable kept list, with the divergence CONTROL. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 2 |
| Q23 | **`--allow-code-change`:** none for the pilot forms, `marker` and `verify`; arms, judge (and W2-5b2's report) after window start only, stamping every output. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1, 3, 4, 5 |
| Q24 | **`not-run` emergent,** and the stop/refusal partition pinned, each word once. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1, 4 |
| Q25 | **A fresh `--out` per phase and per node;** an `--out` holding `pilot-source.json` refused (R24). | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 4 |
| Q26 | **Arms read part 2's `pilot_result.settings_mode`,** range-checked against `SETTINGS_MODES`. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1, 4 |
| Q30 | **The batch summary** prints the stop word and the not-run count; nothing is retried automatically. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 4 |
| Q31 | **Every `error` field** each run carries is recorded: on each arm attempt (Task 4) and on each judge attempt (Task 5); `authentication_failed` stays unmeasured, a named residual. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 4, 5 |
| R1 | **`assistantMessages` and `turnBoundHeld` unchanged here;** W2-5b2's step 0b counts main-thread messages through `facts.messages`. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1 |
| R2 | **W2-D78's three words** (`family-unlisted`, `family-recall-off`, `quiz-unanswerable`) are refusals, not stops. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1 |
| R3 | **The four planning departures,** issued as D-6467, D-6468, D-6469 and D-6470. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1, 2, 4, 5 |
| R4 | **The batch-shape rows stay,** spelled once (`batchShapeChecks`: `limits.batch_max` in [`RECALL_ARMS.length`, `BATCH_MAX`], `limits.concurrency` in [1, `CONCURRENCY_MAX`]); `arms` reads the record's values bounded by them, never the constants in their place. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1, 4 |
| R5 | **The card line is not redacted:** lib's grammar over two node ids and a constant, no stored field. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 2 |
| R6 | **The re-mine's config dirs** are `rosterConfigDirs(readRoster(home).roster, home)`, as `quiz-source` mined. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 2, 4 |
| R7 | **No family-moved check in clause (a);** W2-D78 (i) checks the family. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 2 |
| R8 | **The owning task's names win:** Task 1's `CONTROL_ARM`, `TREATMENT_ARM` and `loadFinalRecord`; Task 2's `recheckBatch` and `armPayloads`; Task 3's `requireListed`; Task 4's `loadArmRun`, `armNodeOf`, `readArmAnswers` and answer record. Every consumer adopts them, and every Step 0 or Step 1 probe checks them. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | all |
| R9 | **Describes titled `W2-5b1 Task <N>: …`**; nesting inside W2-5a Task 7's `r7describe`, in task order, to reuse its fixtures. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | all |
| R10 | **The over-hide count:** whole store, composite, binds stated; the hidden leaf ids capped at `OVER_HIDE_IDS_MAX`, the total always given. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 3 |
| R11 | **No new `DRIVER_REASONS` word.** A store with no family of the section refuses `input-invalid`; `formatHeadlessList`'s `TypeError` and `RangeError` refuse `record-invalid`. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 3 |
| R12 | **A pilot family sits on a node the record names** (W2-D84's node rule); the plan states it. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 3 |
| R13 | **`verify` takes no `--allow-code-change`** (Q23 as written). | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 3 |
| R14 | **Re-runs are per arm;** a question is `run-failed` if either arm is. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 4 |
| R15 | **After `interrupted`, the summary is printed, not written** (D-5984). | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 4 |
| R16 | **The answer record keeps the raw reply** under the 0700 `--out`; redaction happens at each spawn and at the sheet (W2-D54); a PR-body residual beside W2-4's raw stream files. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 4, 5 |
| R17 | **The spend-share line on stderr stays,** and the summary records the share. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 4 |
| R18 | **The judge map covers every frozen pair of the section;** ids are global across nodes. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 5 |
| R19 | **A failed judge run is a malformed attempt:** one retry, then `judge-failed`; the attempt keeps code, signal and result. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 5 |
| R20 | **`judge` refuses `input-invalid` `arms-unsettled`** until every (qid, arm) of this node's section is answered or run-failed (run-failed read per question, as R14 and W2-D80 settle it: either arm run-failed settles both). | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 5 |
| R21 | **The arms-then-judge walk** (Task 4's real arms, then the judge over one stubbed `--out`) is Task 6's. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 6 |
| R22 | **Task 6's census** reads titles by the `W2-5b1 Task <N>:` prefix, tolerant of a zero row for a fragment. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 6 |
| R23 | **Each owning task adds its own W2-D24 `it.each`** under W2-5a's titles; no W2-5a W2-D24 re-check case is edited (as R27 narrows it; R27 licenses three other in-place edits). | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 3, 4, 5 |
| R24 | **Q16 lives in Task 3's `verify --section quiz`, Q25 in Task 4's `arms`.** | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 3, 4 |
| R25 | **Plan-text commits** are allowed for build-time numbers and corrected predictions, under the task whose prediction it was. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | all |
| R26 | **Task 4 factors `refuseSpawnAdmission` and `preflightSpawn`** out of W2-5a's writer code, keeping W2-5a's behaviour and pins byte for byte, and Task 5 consumes them; `ArmAnswer` carries `reply` (the answered attempt's raw result text) and `correct`. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 4, 5 |
| R27 | **R23 narrowed.** R23 forbids editing W2-5a's W2-D24 re-check cases only. Three in-place edits of W2-5a cases are licensed, because Q23 and the new `verify` sections force them: Task 1 Step 2(f) (the `--allow-code-change` assertion), Task 3 Step 2 (the `verify --section quiz` line) and Task 2's count literal (`'card-unrenderable': 0`, only if Step 5 finds one to edit). Each is named in its commit and in the PR body. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1, 2, 3, 6 |
| R28 | **The batch floor.** `limits.batch_max`'s floor is `RECALL_ARMS.length` (2), so a batch holds both arms of a question: the red row at 1, the CONTROL at 2, mutant M-R6 (Task 1); Task 4's `batch_max` 1 row and M25 read the same floor. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1, 4 |
| R29 | **The over-hide id cap.** `OVER_HIDE_IDS_MAX = 1000`, pinned as the literal; the total is always given beside the capped ids (mutants M25, M26 of Task 3). | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 3 |
| R30 | **One spelling of the version-move ranges.** Task 1 factors `versionMoveChecks` (the label and version rows) and `refuseRangeRows` (the `record-invalid` `<path> out-of-range` refusal) out of its range check; Task 4's `expectedForNode` reads both and never re-spells them (W2-D12). Its pure test stays, pinned against the one definition by a scan and by mutants M32 and M33. | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 1, 4 |
| R31 | **Red-first for every guard.** `readArmAnswers`' refusals (an unreadable file, a wrong kind) and `loadArmRun`'s pilot-only settings-mode check each get a red-first case, a CONTROL and a mutant (M34, M35 and M37, and M36, of Task 4). | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 4 |
| R32 | **Unmeasured fixture assumptions are predictions:** Task 6's walk fixtures and Task 4's end-to-end case on `w6SourceBox`. If one does not hold, the worker fixes the fixture, never the guard, and records measured over predicted (R25). | the coordinator's ruling in the operator's place under the directive of 2026-10-19 | 4, 6 |

## Review Focus

These five inputs follow from the decisions and the rulings (R27 to R32 after the plan review included), would bite the operator or the eval, and are each pinned by the named task's tests. The reviewer probes beyond the pins.

1. **An arm spawned when it must not be.** A batch family missing from headless-on, listed at another generation, or a marker naming another store, absent, a directory, a link, over 64 KiB or malformed; a `recall-off/<id>` for a batch family; a frozen question whose source was pruned or tombstoned, whose F a newly learned pair masks, whose source is hidden by the cut at N though its stamp alone would show it, or whose boundary no copy holds; a payload that no longer reconstructs; a version that moved, with and without a `version-move` amendment for this node; a record past its window under `--allow-code-change`, and before it. Expected: `family-unlisted` (fail closed on every non-value marker state, pairs compared by id AND generation), `family-recall-off`, `quiz-unanswerable` naming every failing qid and its clause (or `<qid> payload <word>`, D-6469), `claude-version-moved` or a pass against the amendment's version, each before any spawn with the stub's log absent (a W2-D56 refusal after `--out` leaves only the `--version` line). **Task 3** (`requireListed`, `unlistedOf`), **Task 2** (the clause cases with their CONTROLs, D-6468's re-mine reading), **Task 4** (the preflight's composition and order, its `it.each` of refusals before `--out`, W2-D78 per batch and before that batch's `--version` (M38), the payload-discard refusal, the version-move CONTROLs; `expectedForNode` reading Task 1's `versionMoveChecks` and `refuseRangeRows`, never a second spelling, R30, mutants M32 and M33; the pilot's part 1 settings mode out of range, `record-invalid` before `--out`, R31, M36) and **Task 1** (`loadFinalRecord`'s order, `spawnEnv`'s refusals, mutants M-E1 to M-E4, M-L1, M-C1 to M-C3, M-R3).
2. **A treatment that differs from control by more than the card, or a card that leaks the future.** The control payload against W2-5a's composer over the same parts; a parent with a leaf formed after N; a parent visible only at a later boundary; a leaf with two depth-1 parents or none; an id lib's grammar refuses; display prefixes over the whole family against the visible set; a kept list that is NULL, tombstoned, an object or mixed. Expected: `plain` byte-identical; `carded` exactly the card line, one blank line, then `plain`; no hidden parent named (`hidden`), `several` and `none` name none, `card-unrenderable` and `leaf-absent` are discards, never throws; C1 and C2 equal lib's cut, the unreadable kept list a named divergence that never reaches an arm. Also: no driver line spells an arm word, and `[CONTROL_ARM, TREATMENT_ARM]` is pinned to their meaning. **Task 2** (mutants T2-M1, T2-M2, T2-M3, T2-M11), **Task 4** (the end-to-end case on `w6SourceBox`), **Task 1** (M-A1, M-A2).
3. **Spend and attempts that mislead the budget or the score.** A stream whose result usage omits an Agent subagent's messages; a driver timeout; a second infrastructure failure on one arm while the other answered; a `limits-*` or `budget-exhausted` stop mid-batch, then a resume; a word added to `DRIVER_REASONS` with no class; a tampered `run.json` `code`; a share computed on large budgets; a `batch_max` that cannot hold both arms (1, against the floor `RECALL_ARMS.length`, R28). Expected: the charge is the larger reading and both are in `run.json` (W2-4's probe spend re-pinned from 15 to 60, D-6467); `infra-failed`, re-run as `a2`, never `a3`; `run-failed` excludes the question from both arms; a stopped attempt keeps its number; the partition pin reds; `out-refused` `run-json-invalid`, never INTERNAL; the share exact in BigInt; `record-invalid` before `--out`, and `batch_max` 2 admitted (the CONTROL). **Task 1** (mutants M-S2 to M-S4, M-P1, M-P2, M-R6), **Task 4** (the attempt, stop and share cases), **Task 5** (the judge's spawn gate under this node's share, mutant J30).
4. **A judge that is not blind, or sees what it must not.** A correct answer whose record says otherwise, and the reverse; a SHA answer at the 7-character prefix; a key-shaped value in the question, the reply or its ANSWER line; a secret straddling the 16 KiB edge; a 20,000-byte ANSWER line; a reply that is malformed once, twice, or a run that exits non-zero after printing a LABEL line; a resume after an amended record; a stop after a malformed first attempt; a question one arm of which is run-failed while the other's record still reads `rerun` or `not-run`; an answer file that is a link, a directory, not JSON, or another kind or section. Expected: a correct answer never reaches the judge, a disagreement refuses `out-refused` `answer-record-mismatch`; every string masked before the cap and no head of a straddling secret survives; the answer field cut at the same cap (D-6470); no arm token in any stdin, input file, run name or `judged.json` (the map file the one place arms live); malformed twice `judge-failed`, a failed run a malformed attempt; a finished `jNNNN` run never read as another pair's; a stop never consumes the retry; the half-run-failed question excluded from both arms, never `arms-unsettled`; `readArmAnswers` refuses `out-refused` for the unreadable file and the wrong kind, never follows the link, and reads the same record directly (R31). **Task 4** (mutants M31, M34, M35, M37), **Task 5** (mutants J1, J2, J3, J4, J7, J10, J11, J13, J17, J18, J19, J23, J25), **Task 6** (the walk: the answer records reach the judge through `readArmAnswers`).
5. **A marker that is wrong, or a driver that writes or misreads it.** A record whose pairs exceed 1,000 or 64 KiB, or an id the formatter refuses; a node with no family of the section; a marker that differs by a comment, an order or a final newline; a marker holding an invalid UTF-8 byte; a code change under `marker` or `verify`; a store whose hidden leaves outnumber the id cap. Expected: `record-invalid` for both formatter errors, never INTERNAL; `input-invalid` for a node with no family, never a bare store line; `bytes-differ` apart from `pairs-differ`, `malformed` for the invalid byte, never `ok`; the HOME tree, the store and a planted marker byte-identical after every section; one driver code line names `.headlessOn`, none spells the marker path, none pairs a write verb with it; `code-changed` before anything is printed; the hidden ids capped at `OVER_HIDE_IDS_MAX` (1,000, R29) with the total always given. **Task 3** (mutants M1 to M5, M8 to M10, M14, M15, M22 to M26, and its O13 pin beside `single-definition.test.ts`' own).

Beyond the five: the PR edits a W2-5a case in place only where R27 licenses it (Task 1 Step 2(f), Task 3 Step 2, and Task 2's count literal if Step 5 made it), each named in its commit and in the PR body's "In-place edits of earlier cases"; every other W2-5a case, its W2-D24 re-check rows above all, is byte-identical to the base. The reviewer reads `git diff c34f82830 -- server/test/history-replay.test.ts` for a removed or changed line outside those spots and W2-4's re-pins the header lists.

## File Structure

| Path | Action | Responsibility | Ring | Task(s) |
|---|---|---|---|---|
| `deploy/history-replay.mjs` | modify | **Task 1:** the header's `Imports:` and "Never spelled here" sentences; names added inside the lib, recall.mjs and gate import statements; `CONTROL_ARM`, `TREATMENT_ARM`, `DRIVER_STOPS`, `DRIVER_REFUSALS`, `driverWordClass` (after `refuse`); `FLAG_SPECS`' `allow-code-change`; `ToolPair` and `StreamFacts` (`parentToolUseId`, `resultUsage`, `assistantUsage`, `messages`), `usageTokens`, `spendTokens`; the spawn contract's comment; `spawnEnv`'s arm-value refusal; `run.json`'s `usage_result_tokens` and `usage_assistant_tokens`; the two `'control'` sites rewritten; `codeRecheckVerdict` under `recheckCode`; `refuseOutOfRangeValues`' `budgetField`, `quotas: null` and `part2`, its refusal through `refuseRangeRows`; `positiveInt`, `refuseRangeRows`, `VERSION_MOVE_KIND`, `batchShapeChecks`, `versionMoveChecks` (R30), `part2RangeChecks`, `loadFinalRecord`. **Task 2:** `card-unrenderable` in `RECON_DISCARDS`; `LEAF_OF_BOUNDARY_SQL` (read by `replayStmts`' span statement); `SOURCE_FAILS`' comment; `sourceQuiz`'s mining through `mineStoredBoundary`; `CARD_PARENTS`, `ARM_STMTS`/`armStmts`, `armCut`, `cardOf`, `prependCard`, `armPayloads`, `mineStoredBoundary`, `recheckQuestion`, `recheckBatch`. **Task 3:** five `SUBCOMMAND_FLAGS` forms; `verifyCommand`'s `pilot|quiz` dispatch; `MARKER_SECTIONS`, `VERIFY_HEADLESS_KIND`, `HEADLESS_ON_STATES`, `ALL_VISIBLE_CUT`, `OVER_HIDE_IDS_MAX`, `headlessPairsOf`, `headlessTextOf`, `abCommandsOf`, `readHeadlessOn`, `headlessStateOf`, `unlistedOf`, `requireListed`, `overHideOf`, `verifyHeadlessReport`, `markerCommand`, `verifyHeadless` and its private helpers; `HANDLERS.set('marker', …)`. **Task 4:** `QUESTION_OUTCOMES` in the gate statement; the two `arms` forms; `loadFrozen`'s `section`; `refuseOutOfRangeValues`' `batch`; `refuseWriterAdmission` split, its no-store half `refuseSpawnAdmission`; `openWriter`'s preflight through `preflightSpawn`; `ARM_SECTIONS`, `ARM_ATTEMPTS_MAX`, the three `*_KIND` constants, `loadArmRun`, `armNodeOf`, `readArmAnswers`, the path, pure and module-private functions of the engine, `armsCommand`; `HANDLERS.set('arms', …)`. **Task 5:** `pinWriterInput` → `pinOutBytes`, `refuseWriterModel` → `refuseOpusModel` (the writer's words unchanged); the two `judge` forms; the `JUDGE_*` constants, `capUtf8Bytes`, `judgeInputOf`, `judgeStdin`, `judgeMapOf`, `judgeMapText`, `judgeItemsOf`, `judgeJobsOf`, `openJudge`, `judgeCommand`; `HANDLERS.set('judge', …)`. Every block above the entry guard; no top-level await outside it. | L4 (operator script) | 1–5 |
| `server/test/history-replay.test.ts` | modify | **Task 1:** five appended describes and the module-level `W5B1_SRC`, `w5b1CodeLines`, `w5b1ArmWordLines`, `W5B1_U`, `w5b1SubStream`; one describe nested in W2-5a Task 7's `r7describe` (`loadFinalRecord`); in place: the `FLAG_SPECS` pin, W2-4 Task 4's three stream cases, `T5_RECALL`, D-5814's recall.mjs entry (+`asOfCutOf`), W2-4 Task 9's probe spend (`3 * 20`), W2-5a Task 7's `--allow-code-change` case (R27). **Task 2:** one appended outer describe (`b1t2`) over hand-built stores; in place, only if Step 5 finds a W2-5a case pinning the whole count object, `'card-unrenderable': 0` in it (R27; none at `c34f82830`). **Task 3:** one describe nested in `r7describe` after Task 1's, one import line; in place: the `HANDLERS` key line (+`'marker'`) and W2-5a Task 7's `verify --section quiz` line (R27). **Task 4:** three appended describes (`w5b4`: pure parts; `arms` on the stub; one end-to-end case on `w6SourceBox`); the `HANDLERS` key line (+`'arms'`). **Task 5:** four appended describes (`w5b5`) and their fixtures; the `HANDLERS` key line (+`'judge'`). **Task 6:** one appended describe, the arms-then-judge walk. | test | 1–6 |

## Drifts since the decisions document

The decisions document was written at `bd363a76b`; the base is `c34f82830` (plus W2-2b's merge). Each row: what the document (or the scoping study) says, what the code at the base says, and what that changes here.

| Document says | Code at `c34f82830` | Effect | Task |
|---|---|---|---|
| The driver's comment (about :1086) and header (about :24-26): "this file never spells one" | `'control'` is spelled in `quizPopulation` (about :4013) and `abStateOf` (about :5196); W2-D42's scan would be red at the base | Both rewritten to `CONTROL_ARM`; the comment and the header sentence reworded | 1 |
| W2-D50: `CCRC_RECALL_ARM` is a value from `RECALL_ARMS`; RP1-contract used parameter values | `T5_RECALL` holds `fixture-arm-value` and `fixture-asof-uuid`; `spawnEnv` takes any non-empty string | `spawnEnv` refuses an unreal session, arm or ASOF as a `TypeError` before any spawn; `T5_RECALL` becomes real-shaped; RP1-contract's assertions are unchanged | 1 |
| §7's C6: W2-5b's pilot measures whether result usage includes Agent-subagent spend before any arm batch, and charges it if missing | Spend reads the result usage, else the assistant sum | `spendTokens` charges the larger reading in every spawn mode, both recorded; W2-4 Task 9's probe spend re-pinned from `3 * 5` to `3 * 20` (D-6467) | 1 |
| W2-D82, W2-D58, Q11: `via_agent` and a subagent's tool list | `readStreamJson` (about :684) keeps no `parent_tool_use_id` | Every tool pair and message carries `parentToolUseId`; `assistantMessages` keeps W2-4's meaning (R1) | 1 |
| W2-5a Task 7's case: no W2-5a subcommand takes `--allow-code-change` (`unknown flag`) | `FLAG_SPECS` has no such flag | Declared once (Task 1); the case re-pinned to `checkFlags`' `--allow-code-change is not a <form> flag` | 1 |
| S2's C22: the driver-side range check extends to every part 2 field a W2-5b consumer reads | `refuseOutOfRangeValues` hardcodes `pilot_budget` and always checks quiz quotas; the validator types `spend_budget`, `limits`, `pilot_result.settings_mode` and amendment details without ranging them, and `batchGate`, `runBatch` and `spawnArgv` throw on bad values | `budgetField`, `quotas: null`, `part2RangeChecks` and the one batch-shape row set `batchShapeChecks` (R4; Task 4's `batch` asks it on part 1), all before `--out` | 1, 4 |
| W2-D90 / Q13: the version preflight reads the newest version-move amendment for the node | The validator types `node_label_ref` as a nullable string and checks only `repilot_sha256` in the detail (about :2564-2566) | A `version-move` whose `node_label_ref` names no node or whose detail lacks a version refuses `record-invalid` before `--out`; newest is last in array order (append-only) | 1, 4 |
| The scoping study: the test's `EXACT_NAMES` pins the driver's lib and gate imports | `EXACT_NAMES` (about :3060) pins only `node:child_process`, `node:crypto` and the `ccd/history` modules beyond lib (D-5814 as W2-5a widened it) | Only the recall.mjs entry changes (+`asOfCutOf`); Task 1 adds a subset pin that the W2-5b1 lib, recall.mjs and gate names are imported and exported | 1 |
| W2-D78 (iii)(a): "redaction no longer leaves F_raw unchanged" | W2-5a's one screen is `screenRedaction` (F_raw, F, `repo_roots`, F_raw in its leaf); a frozen entry carries no leaf | (a) re-mines boundary N's candidate through `mineStoredBoundary`, so a question also refuses on F, a repo root or its leaf, and a source pruned after the freeze refuses at (a) with the mining word (D-6468) | 2 |
| W2-D78 (iii) names three clauses | At arm time `armPayloads` can answer a `RECON_DISCARDS` word for a question that passed them | A fourth clause: `quiz-unanswerable` `<qid> payload <word>` before any spawn of the batch (D-6469) | 4 |
| `SOURCE_FAILS`' comment (about :3690): W2-5b's (iii)(b) "names the clause from it" | `answerability` folds a question's sources to `answerable`, `untimed` or `unanswerable` | (b) names answerability's word (`unanswerable`, `unanswerable-untimed`, or `boundary-untimed`); the comment is reworded | 2 |
| W2-D75: "`lib.cardLine({leaf, parent})` over boundary N's leaf"; "leaf N's parent", singular | `cardLine` takes display prefixes and throws a `TypeError` on anything else; `node_children`' key admits several depth-1 parents in a damaged store | `displayPrefixes` over the family's whole node-id set (Q20); a throw on store data is `card-unrenderable`; several parents name none (`several`) | 2 |
| W2-D38: the driver defines "as of N" by the same kept(N) membership | `asOfCutOf` reads kept(N) through derive's `keptOf` (NULL, a tombstone or a non-list is empty; a mixed list keeps its strings); the driver discards `kept-absent` and `kept-unreadable` | C2 pins the readable case equal and the divergence as a CONTROL; harmless because `armPayloads` discards before any arm | 2 |
| W2-5a's R8: the same-millisecond count had no lib predicate | Its T_N and holding file come from admission's row | C1 pins both equal to `asOfCutOf`'s `tsCut` and `holdingFileId`, and the counted set to lib's visible set at T_N outside the holding file | 2 |
| The scoping study: "leaf N's node" (span statement hint about :2717) | `replayStmts`' span statement (about :2706) spells the depth-0 leaf rule inline | `LEAF_OF_BOUNDARY_SQL`, one spelling for the span reader and the card, pinned by a scan | 2 |
| W2-D84: `marker` "prints per node", `--record <final\|draft>` for every section | One stdout carries one node's bytes; part 2 holds part 1 whole, and the pilot marker is written before part 2 exists (W2-D76) | One node per call (`--node-label`, exactly once); `--section pilot` reads part 1 only (a final is `record-invalid`); `quiz` and `ab` read part 2 with `--part1` and `--frozen` | 3 |
| W2-D84: "the headless-on bytes' sha equals the marker's" | `readBounded` answers text decoded with replacement (D-5768); a byte reader would be a second read path (W2-D44, O13) | The sha is taken over the text as read: equal to the bytes' sha for valid UTF-8, and an invalid byte reads as U+FFFD, which is `malformed`, never `ok` | 3 |
| W2-D78 (i): parsed with lib's `parseHeadlessList` | lib's `headlessMarkerOf` folds `unreadable` and `over-cap` into `headless-malformed` | The driver reads with `readBounded` and parses itself (`readHeadlessOn`), so `verify` reports each state apart; the preflight fails closed on every non-value state | 3 |
| The W2-2b plan: `marker` handles `formatHeadlessList`'s `RangeError` | It also throws `TypeError` for a grammar fault | Both map to `record-invalid` (R11; D-6309's word for a record the gate signs and the driver cannot run) | 3 |
| The ledger: "W2-5b's report measures D-6284's over-hide on the live store" | `report` cannot read another node's store (Q16); `asOfEntrySql` never shows a NULL-ts row (D-5766) | `verify --section quiz` counts it per node over every leaf, binds stated, through Task 2's prepared node-rule statement; the count includes leaves whose boundary or summary row is untimed, and the ids are capped (R10) | 3 |
| The scoping study E18: `verify` answers "this build verifies ab only" (about :5785) | The same | That branch becomes the `pilot|quiz` dispatch; W2-5a's case re-pins its line to `section "judge": verify reads ab, pilot or quiz` | 3 |
| W2-D80: `classifyRun(streamEvents, exitCode)` | `classifyRun(events, exitCode, {spawned, stopped})`; `readStreamJson` keeps no event list | `streamEventsOf` parses a recorded run's stream; every recorded run is classified with `{spawned: true, stopped: false}`, because a stopped or unspawned run writes no `run.json` (Q24) | 4 |
| W2-D78's pin: each refusal leaves the stub's log absent | The stub logs every invocation, `--version` included, and W2-D56's version check is a spawn | W2-D78 and every pre-`--out` refusal leave the log absent; a W2-D56 refusal after `--out` leaves only the `--version` line | 4 |
| W2-5a's `refuseWriterAdmission` is the pre-`--out` check (D-6307, D-6311); `openWriter` owns the spawn preflight | Its `preflightFiles` call takes no `allowCodeChange`, and `openWriter`'s `preflightNow` is a closure | Its no-store, no-spawn half is factored as `refuseSpawnAdmission` (with `allowCodeChange`), and `preflightNow`'s body as `preflightSpawn`; W2-5a's behaviour and pins are unchanged (R26) | 4 |
| W2-5a's `loadFrozen` reads the quiz's list | It hardcodes `'quiz'` (about :4884-4889) | A `section` parameter, default `'quiz'` | 4 |
| W2-4's `finishedOutcome` is the resume read | It does not check `run.json`'s `code`; `classifyRun` throws on a non-integer one | `out-refused` `run-json-invalid <name>` first (D-6309's rule) | 4 |
| W2-4's run timeout | `RUN_TIMEOUT_MS` is 30 minutes; a `RunJob` accepts `timeoutMs` | A test seam (`deps.timeoutMs`), no flag | 4 |
| W2-D24's consumer list: "arm, judge and pilot batches" | No subcommand had those names (Q1) | `arms --section pilot|quiz` and `judge --section pilot|quiz`; the pilot forms take no `--allow-code-change` (Q23) | 4, 5 |
| The scoping study C17: `authentication_failed` verified by step 0b | No step-0b run fails authentication by design | Every run's `error` fields are recorded (Q31), each arm attempt's (Task 4) and each judge attempt's (Task 5); the spelling stays a named residual | 4, 5 |
| W2-D79, Q18: positional ids from the shuffle over "the items sorted by (qid, arm)" | Q2 runs the judge per node; ids over one node's items would repeat across nodes | The map is drawn over every (qid, arm) pair of the section's frozen list, byte-identical on every node; a node judges its subset in that order (R18) | 5 |
| W2-D79's `answer_field` for `UNKNOWN` or no ANSWER line; W2-D79 caps the reply only | The gate's `RUBRIC_HEAD` (about :1463) says `null` when it gave none | `null` for none, `UNKNOWN` (the protocol's spelling) for unknown, else the value, cut at the reply's cap (D-6470) | 5 |
| W2-D80's re-run is an arm's; W2-D79 retries only a malformed reply | W2-5a's writer (D-6305) treats a non-zero exit, a signal or no result as malformed | A failed judge run is a malformed attempt: it uses the one retry (R19) | 5 |
| `openWriter` owns the one Opus-model refusal and the one `--out` byte pin | `refuseWriterModel` and `pinWriterInput` (about :4294, :4305) are writer-named | Generalised into `refuseOpusModel(flag, model)` and `pinOutBytes(out, rel, text, what)`, the writer's words byte for byte | 5 |
| Spec §10.2 RP1 lists the allow-listed spellings for arms, writer and judge | `spawnArgv`'s judge mode carries `--tools ""` and no `--allowedTools`, as RP1-writer pins | RP1-judge asserts the writer-shape argv | 5 |
| §2's W2-5b entry: Files include README and the spec; Ships include `step0b`, `fidelity`, the pilots, the hand-check, `open --amend`, `report`, README and the errata | S1 splits W2-5b | Task 6 asserts the PR's diff holds neither README nor the spec, and that E21's and E22's rev 3.6 sentences stand once each | 6 |
| The brief: run `single-definition` for "the env and import scans that read deploy/" | Its env allow-list (about :5464) and W2-2a's seam-name holders (about :8476) read `ccd/history/*.mjs` only; the driver's own env scan and import pin are in `history-replay.test.ts` | Task 6 runs the deploy-reading single-definition cases, then the whole file | 6 |
| Line hints in the brief and the scoping study (`T:4822`, `DRV:2717`, the `HANDLERS.set` block) | The `HANDLERS` key line is about :4824; the span statement about :2706; `HANDLERS.set(` about :5789-5794; `spendTokens` about :769 | Every edit anchored by quoted content; each task reports what it found | all |

## Not in this plan

- **W2-5b2 (deploy), "the pilot and the verdict":** `step0b` (with `turnBoundHeld`'s main-thread count, R1), `fidelity`, `pilot-result`, `open --amend`, W2-D56's re-run of both arms of every half-done question on the new version after a version re-pilot (the scoping study's C19, read from this PR's per-batch manifests, Q14; until then see the PR body's residual), `handcheck --sheet` and the label reader, `report` (with RP6-e2e and RP7-e2e), the edit of `open --finalize` (D-6280's derived `spend_budget`, Q27's `--accept-failed-pilot`), the usage pilot's extrapolation (Q6), the pilot's measured relation between the two spend readings (Q7), README's driver paragraph with the `--no-warnings` shebang, and the spec errata E2, E7, E8, E9, E10, E11 and E19 to E24 (E21 and E22 included).
- **W2-6 (deploy):** `deploy/history-counters.mjs`, its single-definition pin, README line and E25 (Q29 may let it run beside W2-5b2).
- **The gate validator's range checks** (review 795 F1) and **R8's ref-survival decider moved into lib** (S2's C8): both stay in the ledger's "Later". W2-5b1 touches neither the gate nor lib; its range check is the driver-side one (S2's C22).
- **lib's `redactField` glued-prefix limit (R-3)**, a residual named in the PR body (S2's C23); **a `.py` read-instant field** (S2's C15), a W2-3 follow-up.
- **The rollout.** Through the release lane only, as part of W2's final release rolled onto every named node before part 1 (W2-D6). The coordinator's or the operator's, never the worker's.
- **The window and its operator acts** (decisions §4 and §5): writing headless-on from `marker`, `verify`, the pilot, the `recall-off` writes, the arm and judge batches, the hand-check and the verdict. None is the worker's, and no step runs a subcommand on a real node or account.
- **The ledger and the decisions document:** the coordinator's.

## The PR

**PR:** One PR against `main`, on this workspace's own branch, executed in task order, with one commit per task:
1. `feat(history-replay): the arm words by position, the stop/refusal partition, the stream's subagent attribution and the larger-reading charge, and the part 2 loader (W2-5b1 Task 1; W2-D42, W2-D50, W2-D80, W2-D24, W2-D90; S2, Q7, Q23, Q24; D-6467)`;
2. `feat(history-replay): the card line, the two payloads and the per-question re-check, with the parity pins against lib's cut (W2-5b1 Task 2; W2-D75, W2-D78(iii), W2-D38; D-6468)`;
3. `feat(history-replay): marker, verify --section pilot|quiz and the headless-on reader the arm preflight asks (W2-5b1 Task 3; W2-D84, W2-D76, W2-D78, W2-D24; D-5781)`;
4. `feat(history-replay): the arm engine, arms --section pilot|quiz, both arms per question in batches, preflighted before every batch (W2-5b1 Task 4; W2-D78, W2-D80, W2-D56, W2-D55, W2-D64, W2-D82; D-6469)`;
5. `feat(history-replay): the judge, one blinded judge-mode spawn per non-correct answer, retried once, then judge-failed (W2-5b1 Task 5; W2-D79, W2-D54, W2-D80, W2-D18, W2-D55, W2-D56; D-6470)`;
6. `test(history-replay): the arms-then-judge walk over one --out (W2-5b1 Task 6; W2-D79, W2-D80; R21)`.

A fix one of Task 6's checks calls for is a correction commit under the owning task's number, before the push, and a number issued during the build is defined in this plan's "Deviations found" by the commit that first cites it. Task 1 goes first: every later task reads its imports, constants, partition, stream facts and loader. Task 2 needs Task 1; Task 3 needs Tasks 1 and 2 (`CONTROL_ARM`, `armStmts`); Task 4 composes Tasks 1 to 3; Task 5 needs Tasks 1 and 4; Task 6 runs last. Every task leaves every suite green at its commit. This PR changes no `.github/` file, so CI runs its selection; the PR body asks the coordinator to check that the `select tests` summary lists `history-replay`, `lifecycle` and `single-definition`. The PR is opened by Task 6 Step 12, only after its Steps 0 to 11 (the base, the walk, the departures, the spec and README untouched, the file list, the carries and must-holds by content and by title, the whole file in one process, the whole-PR checks, the private-name, host and home-path counts of 0, a clean tree and the body), ready for review (not a draft), titled **"ccrc history wave W2-5b1: the arms and the judge"**, with the body Task 6 Step 11 gives.

The plan's `## Deviations found` comes at its end, after Task 6. It holds one entry per number this plan defines (the four planning departures, and any number issued during the build), each naming the first task section that cites it; it is empty of anything else.

---

### Task 1: the imports and their pin; the arm words by position; the stop/refusal partition; the stream's subagent attribution and the fail-closed charge; part 2 for W2-5b's consumers; RP1-arm

This task owns every piece the later W2-5b1 tasks share, so none of them spells it again (S1; scope.md B, Task 1):
- **the imports.** Every name W2-5b1 consumes from W2-2a's and W2-2b's lib, from recall.mjs (W2-2a's `asOfCutOf`) and from the gate goes into the driver's existing import statements now, and the one pinned list that names any of them, D-5814's `EXACT_NAMES` entry for `../ccd/history/recall.mjs`, is re-pinned in the same commit. A later W2-5b1 task that needs another name adds it inside the braces (and, for a pinned module, to `EXACT_NAMES`) in its own commit. No module is added: the driver still loads W2-5a's fourteen.
- **the arm words (W2-D42; S2's C9).** `CONTROL_ARM` and `TREATMENT_ARM` are `RECALL_ARMS[0]` and `RECALL_ARMS[1]`, the only two places the driver indexes lib's arm vocabulary. The two quoted spellings at the base (`quizPopulation`, `abStateOf`) are rewritten to them, the spawn contract's comment that said "this file never spells one" while two lines did is made true, and the arm-word scan W2-D42 asks of W2-5b lands beside the set-parity pin of the gate's `ASSIGNMENT_ARMS` with `RECALL_ARMS`. The gate's order is not touched (`handcheckSample` reads it), and no import is added to the gate.
- **the stop/refusal partition (W2-D80 as amended, decisions §7; C6, Q24).** `DRIVER_STOPS` and `DRIVER_REFUSALS` classify every `DRIVER_REASONS` word exactly once, pinned so that a word added to `DRIVER_REASONS` without a class reds. `not-run` stays emergent (Q24): a refused or stopped run writes no `run.json`.
- **the stream reader (W2-D82, W2-D58; Q7, Q11; C14).** `readStreamJson` gains `parentToolUseId` on every tool pair and a per-message list (`messages`: id, parent, usage), plus both usage readings, `resultUsage` and `assistantUsage` (every assistant message, subagent messages included). `spendTokens` charges the larger of the two (Q7), and each run's `run.json` records both beside the charge.
- **part 2 for W2-5b's consumers (W2-D24, W2-D25, W2-D90; S2's C22, Q23).** `loadFinalRecord` is the one loader `arms --section quiz` and `judge --section quiz` (Tasks 4 and 5) and W2-5b2's `report` call: the final with its chain (W2-5a's `loadRecordInput`), then W2-D24's re-check, first, before any other input, then every part 2 field the consumer reads in range, all before `--out` exists. `--allow-code-change` joins `FLAG_SPECS` and is taken at or after `window.start_ms` only, answered as a stamp (`stamps: ['code-changed']`) for the consumer to write into every output; before window start it is `args-invalid`.
- **RP1-arm (W2-D50).** `spawnEnv` refuses, as a `TypeError` before any spawn, an arm value the seam would refuse: a session id lib's `idOk` refuses, an arm outside `RECALL_ARMS`, an ASOF that is not a lowercase UUID. RP1-arm asserts the exact seven keys with the real values on the stub, for both arms and both launch kinds.

**Decisions:**
- W2-D42 (the driver imports `RECALL_ARMS` and never spells its words; W2-5b's scan);
- W2-D50 (the arm env's seven keys; RP1-arm with the real values);
- W2-D80 as amended, W2-D59 and decisions §7's residual "The unmeasured stop words are not yet classified" (the stops; C6);
- W2-D55 and decisions §7's C6 under W2-4's spend residuals (the charge), as Q7 rules it;
- W2-D82 and W2-D58 (what `parentToolUseId` is for: `via_agent`, a subagent's tool list; their consumers are Task 4 and W2-5b2);
- W2-D24 and W2-D6 (the re-check first; the flag after window start only), as Q23 rules it;
- W2-D25 and W2-D90 (the final's chain, through the validator; the version-move amendment's fields), with Q13's `node_label_ref` required;
- S2's C9 (the set-parity pin) and C22 (D-6309's driver-side range check, extended), Q3 and Q26 (the part 2 values the arm engine reads), Q24;
- R1 (`assistantMessages` unchanged), R2 (W2-D78's three words are refusals) and R4 (the batch-shape rows, spelled once);
- R27 (Step 2(f)'s in-place edit of W2-5a Task 7's `--allow-code-change` assertion, licensed and named in the commit), R28 (the batch floor `RECALL_ARMS.length`: the red row at 1, the CONTROL at 2, mutant M-R6) and R30 (the version-move rows spelled once, `versionMoveChecks`, refused through `refuseRangeRows`, which Task 4's `expectedForNode` reads).

It cites D-5814 (W2-4's import pin, as W2-5a widened it), D-6309 (W2-5a's range rule), D-5984, D-5985 and D-5986 (the stop words W2-4's fix rounds added) and D-5769 (W2-2b's two refusal words), each bare. It ships one departure found while planning, **D-6467** (`history-w2-5b1-spend-charge-larger-reading`; Choices), issued by the coordinator (R3) and defined in "Deviations found".

**Files:**
- Modify: `deploy/history-replay.mjs`:
  - the header's four lines from `// Imports: node: built-ins (node:crypto's randomBytes draws the W2 seeds); ../ccd/history/lib.mjs; the W2-1 exports` to `// its recall-off reader (W2-D29); ./history-gate.mjs, the pure gate (W2-D11); and ../shared/roster-json.mjs.` (about :9-12 at c34f82830) are reworded;
  - the header's two lines `// Never spelled here: the recall arm words, which reach a spawn as parameters (W2-D50), and the headless marker's` and `// path, which W2-5b reaches through lib's historyPaths.` (about :25-26) are reworded;
  - three import statements gain names: the lib line `import { CONTROL_FILE_MAX, EXIT, RECALL_OFF_META, …, toolUsesOf } from '../ccd/history/lib.mjs';` (about :36), the recall line `import { expandEntryBody, familiesOf as scopeFamiliesOf, transcriptsOf } from '../ccd/history/recall.mjs';` (about :39) and the gate line `import { ANSWER_PROTOCOL, …, windowTotals } from './history-gate.mjs';` (about :42);
  - a new block directly after `refuse`'s body (`  throw new DriverRefusal(word, detail);` and its `}`, about :99-101) and before `// ── the argument grammar` (about :103): the arm constants and the partition;
  - `FLAG_SPECS`' last line `  draft: 'bool', finalize: 'bool', template: 'bool', registry: 'bool', section: 'string',` (about :129) is followed by the new flag;
  - the `ToolPair` and `StreamFacts` typedefs (about :676-679), five spots inside `readStreamJson` (about :684-765) and `spendTokens` with its doc comment (about :766-772);
  - the spawn contract's comment line `// input. Arm values arrive as parameters: this file never spells one (W2-5b's scan pins that).` (about :1086);
  - `spawnEnv`'s doc line ` *  the account's CLAUDE_CONFIG_DIR, and in arm mode only the three CCRC_RECALL_* values passed in. Pure.` (about :1164) and the line `  child.CCRC_RECALL_SESSION = r.session;` (about :1187);
  - `launchRun`'s run record line `    code: res.code, signal: res.signal, ms, cwd, stream_sha256: sha256Hex(stream), tokens, unknown_options: unknownOptions,` (about :1743);
  - `quizPopulation`'s line `    if (a.arm === 'control') controlIds.add(canonicalJson([a.store_id, a.ccrc_id]));` (about :4013) and `abStateOf`'s line `  if (arm === 'control') {` (about :5196);
  - `recheckCode` with its doc comment (about :4919-4928) becomes `codeRecheckVerdict` and a `recheckCode` over it;
  - `refuseOutOfRangeValues`' `@param` lines and body (about :5403-5418);
  - a new section directly above the comment line `// The entry guard stays the LAST block of this file: a module-level declaration below it would still be uninitialised` (about :5796), after `HANDLERS.set('verify', verifyCommand);`.
- Modify: `server/test/history-replay.test.ts`:
  - W2-4 Task 1's `FLAG_SPECS declares exactly …` case (about :199-214);
  - W2-4 Task 4's stream cases: the tool-pair line of `the rest of the stream: …` (about :886), the empty-stream object (about :907-910) and the tool-pair line of `a tool_result in content blocks …` (about :945);
  - `T5_RECALL` (about :1156);
  - D-5814's comment and its `'../ccd/history/recall.mjs'` entry (about :3051-3065);
  - W2-4 Task 9's probe case, its spend line `    expect(doc.spend, 'the ledger under --out counts the three runs').toBe(3 * 5);` (about :4813);
  - W2-5a Task 7's case `no W2-5a subcommand takes --allow-code-change …` (about :9252-9256);
  - one nested describe appended inside W2-5a Task 7's outer `r7describe`, after `verify section ab`'s describe closes (about :10500), so it reuses `chain7`, `tree7` and `save7`;
  - one import group and five describes appended at the end of the file (about :10678).
- Not edited: `ccd/**` (W2-2a's and W2-2b's exports are consumed as they merged), `shared/**`, `deploy/history-gate.mjs` (imported only; S2's C9 adds no import to it), `deploy/measure-history.py`, `.github/**`, README.md and the spec. `single-definition.test.ts` (O13, O14), `lifecycle.test.ts`, `history-lib.test.ts` and the other neighbours are re-run unedited (Step 7).

**Interfaces:**
- Consumes (on `main` once W2-2b merges; Step 0 stops if any is missing):
  - `ccd/history/lib.mjs`, W2-2b: `RECALL_ARMS: readonly ['control', 'treatment']` (frozen); `HEADLESS_LIST_MAX_BYTES: 65536`; `parseHeadlessList(text: string): { ok: true, storeId, pairs: readonly { ccrcId, generation }[] } | { ok: false, rc: 2, reason: 'headless-malformed' }`; `formatHeadlessList({ storeId, pairs }): string` (throws `TypeError` for a grammar fault and `RangeError` past either bound); `headlessMarkerOf(read: BoundedRead): HeadlessList | ScopeRefusal<'headless-unarmed' | 'headless-malformed'>`. The env path's words, each `REASONS[w] === 2`: `headless-unarmed`, `headless-in-pane`, `headless-unlisted` and `asof-invalid` (at the base) and `headless-malformed` and `headless-arm-unknown` (W2-2b, D-5769). This task imports four of the five names and reads only `RECALL_ARMS`; Task 3 reads the marker names. `headlessMarkerOf` is not imported: no task calls it, because it folds `unreadable` and `over-cap` into one word and W2-D84 forbids that fold (Task 3's Interfaces), so Step 0 only probes that lib exports it.
  - `ccd/history/lib.mjs`, W2-2a (at the base): `cardLine({ leaf, parent = null })`, `displayPrefixes(ids)`, `asOfBinds(cut)`, `asOfHiddenNodesSql()`, `asOfVisibleEntriesSql()`; `ccd/history/recall.mjs`: `asOfCutOf(rc, asof)`. Imported here for Task 2 (W2-5a's R3 precedent); not called in this task.
  - `deploy/history-gate.mjs` (W2-3): `RUBRICS`, `parseAnswerField(finalText)`, `labelCorrect(kind, F, answerValue, opts)`, `parseLabelLine(reply)`, `classifyRun(events, exitCode, { spawned, stopped })`, `questionOutcome(attempts)`, imported for Tasks 4 and 5; and, read by this task's tests only, `ASSIGNMENT_ARMS` (`['treatment', 'control']`), `AMENDMENT_KINDS` and `GATE_CODE_FILES`. The driver already imports `ASSIGNMENT_ARMS`, `checkGateCode` and `GATE_CODE_FILES`.
  - The driver's own: `DRIVER_REASONS` (29 words at c34f82830), `loadRecordInput(flags, part)` (module-private: the record's sha checked before a byte is parsed, then its draft, frozen list and predecessor, and `validateOpenRecord`), `codeShas(root)`, `TREE_ROOT`, `SETTINGS_MODES`, `BATCH_MAX`, `CONCURRENCY_MAX`, `LIMITS_DEFAULTS`, `launchRun`, `spawnEnv`, `idOk` and `UUID_RE` (imported from lib), `plainObject`.
- Produces (`deploy/history-replay.mjs`, exported unless marked):
  - `CONTROL_ARM === RECALL_ARMS[0]` and `TREATMENT_ARM === RECALL_ARMS[1]`.
  - `DRIVER_STOPS: readonly string[]` (16 words, frozen, in `DRIVER_REASONS` order) and `DRIVER_REFUSALS: readonly string[]` (13 words, frozen, in `DRIVER_REASONS` order); `driverWordClass(word: string): 'stop' | 'refusal'`, pure, a `TypeError` for a word outside both.
  - `readStreamJson(text)`'s `StreamFacts` gains `resultUsage: StreamUsage | null` (the result event's usage), `assistantUsage: StreamUsage` (every assistant message's last usage, summed once per message, subagent messages included; zeros when none) and `messages: { id: string | null, parentToolUseId: string | null, usage: StreamUsage | null }[]` (first-seen order; the parent its first event named). Each `ToolPair` gains `parentToolUseId: string | null`, the `parent_tool_use_id` of the assistant event that carried the tool_use. `usage`, `usageSource`, `assistantMessages`, `firstCallUsage` and the rest are W2-4's and W2-5a's, unchanged.
  - `usageTokens(u: StreamUsage | null): number` (input + cache_creation + cache_read + output; null is 0). `spendTokens(facts): number` is `max(usageTokens(facts.resultUsage), usageTokens(facts.assistantUsage))`.
  - Each `<name>.run.json` gains `usage_result_tokens: number | null` and `usage_assistant_tokens: number`, beside `tokens` (the charge). `kind` and `v: 1` are unchanged: additive.
  - `spawnEnv` in arm mode throws `TypeError` for `recall.session` that `idOk` refuses, `recall.arm` not in `RECALL_ARMS`, or `recall.asof` that `UUID_RE` refuses, before it builds anything.
  - `FLAG_SPECS['allow-code-change'] === 'bool'`. No `SUBCOMMAND_FLAGS` form lists it yet (Tasks 4 and 5 add it to the quiz forms of `arms` and `judge`), so every W2-5a form refuses it through `checkFlags`.
  - `codeRecheckVerdict(record, shas, { allowCodeChange = false, nowMs = null } = {})`, pure: `{ ok: true, stamps: [] | ['code-changed'] } | { ok: false, word: 'args-invalid' | 'code-unmeasured' | 'code-changed', detail: string }`. `recheckCode(record, root = TREE_ROOT, opts = {}): string[]` refuses on `ok: false` and answers the stamps; W2-5a's six calls pass no `opts` and ignore the answer.
  - `refuseOutOfRangeValues({ budget, budgetField = 'pilot_budget', limits, quotas, part2 = null })`: `quotas: null` skips the quiz-quota rows; `part2`, a final, adds `part2RangeChecks`' rows. W2-5a's two callers are unchanged.
  - `VERSION_MOVE_KIND = 'version-move'` (one of the gate's `AMENDMENT_KINDS`, pinned).
  - `loadFinalRecord(flags, { nowMs, root = TREE_ROOT }): { record, sha256, frozen: { sha256, list, families }, stamps: string[] }`. Its refusals: every refusal `loadRecordInput(flags, 'final')` makes, then `args-invalid`, `code-unmeasured` or `code-changed` (the re-check), then `record-invalid` `<path> out-of-range[; …]`. It writes nothing and takes no `--out`.
  - Module-private: `positiveInt(v)`, `refuseRangeRows(checks: Array<[string, boolean]>): void` (D-6309's refusal over a row set: `record-invalid`, each failing path as `<path> out-of-range`, joined by `; `; `refuseOutOfRangeValues` ends in it, and Task 4's `expectedForNode` calls it, R30), `batchShapeChecks(limits): Array<[string, boolean]>` (the one spelling of the arm batch's shape, R4, R28; Task 4's `arms` also asks it on part 1), `versionMoveChecks(r): Array<[string, boolean]>` (each `version-move` amendment's `node_label_ref` and `detail.claude_code_version` rows, in array order: the one spelling of those two ranges, read by `part2RangeChecks` and by Task 4's `expectedForNode`, R30), `part2RangeChecks(r): Array<[string, boolean]>`.
- Produces (test side): the describes `W2-5b1 Task 1: the arm words …`, `… every driver word is a stop or a refusal …`, `… the stream reader …`, `… RP1-arm …` and `… the gate_code re-check verdict and the part 2 ranges, pure`, appended at the end; the nested `W2-5b1 Task 1: loadFinalRecord …` inside W2-5a Task 7's describe; the module-level `w5b1`-prefixed bindings, `W5B1_SRC`, `W5B1_U` and `w5b1SubStream`, which later W2-5b1 tasks may reuse.

**Choices this task makes:**
- **The partition (Q24).** A stop is a word whose remedy is to clear a state outside the run's inputs and run the same command again: W2-D80's seven (`limits-threshold`, `limits-stale`, `budget-exhausted`, `claude-version-moved`, `tree-moved`, `wrapper-moved`, `code-changed`), decisions §7's eight (`code-unmeasured`, `version-unmeasured`, `tree-unmeasured`, `wrapper-unmeasured`, `run-live`, `out-in-use`, `interrupted`, `out-refused`) and `store-unreadable` (W2-5a's PR body, carried to W2-5b; scope.md C6). The other thirteen are refusals, W2-D78's three included (`family-unlisted`, `family-recall-off`, `quiz-unanswerable`; R2): W2-D80 does not list them as stops, and their remedy is an operator act on the marker, a control file or a frozen question ("never dropped silently"), not a wait. A question a W2-D78 refusal keeps from spawning is still `not-run` by the emergent rule, and consumes no re-run, because nothing ran.
- **Both lists are spelled, neither derived.** Deriving `DRIVER_REFUSALS` as "the rest" would classify a new word silently. With both spelled, a word added to `DRIVER_REASONS` reds the "exactly once" pin until its owner classifies it (Q24).
- **The arm-word scan.** A code line (a line whose trimmed text does not open a comment) spells an arm word when it holds one as a whole string literal (any of the three quotes), as an object key or as a member name. A longer word (`control-absent`, `controlIds`, `CONTROL_ARM`) is not one. Trailing comments on a code line are read too, so prose there names an arm without quoting it. The pattern is built from `RECALL_ARMS`, so the test file names the words through lib as well.
- **Set parity, not order (S2's C9).** `ASSIGNMENT_ARMS` is `['treatment', 'control']` and `RECALL_ARMS` `['control', 'treatment']`; `handcheckSample` iterates the gate's order. The pin holds the two as equal sets of two. A second pin holds `[CONTROL_ARM, TREATMENT_ARM]` to the words W2 means by them, so a reorder of `RECALL_ARMS` cannot swap the driver's control and treatment unseen.
- **`spawnEnv` refuses unreal arm values.** W2-D50's `CCRC_RECALL_ARM` is "a value from `RECALL_ARMS`". An arm run on any other value would be refused by the CLI (`headless-arm-unknown`, `asof-invalid`) after a model was paid for. So the refusal moves before the spawn, as a `TypeError` (a defect in the caller: Task 4's engine builds the values from the frozen list and the arm constants, never from input text). W2-4's `T5_RECALL` fixture takes real-shaped values in the same commit; RP1-contract's assertions are unchanged.
- **The charge is the larger reading (Q7).** Whether the result event's usage includes an Agent subagent's spend is unmeasured (decisions §7, C6), and arm and box runs carry `--tools Bash,Agent`. The charge does not wait for the pilot's measurement: it is `max(result usage, sum of every assistant message's usage)`, for every spawn mode, through the one `spendTokens` every charge site already calls (`launchRun` and `settleLeftover`). Both readings are recorded in `run.json`, so W2-5b2's pilot result can report the measured relation. The cost: a stream whose messages sum past its result usage is charged more than W2-4 charged it, an over-count, the budget's safe direction (W2-D55). W2-4's probe fixture is one (four messages of 5 against a result of 5): its pinned spend moves from 15 to 60. **D-6467:** decisions §7's C6 says W2-5b's pilot "measures it before any arm batch and, if it is missing, charges it"; Q7 charges unconditionally, in every spawn mode, before any measurement (R3).
- **`usage` keeps W2-4's meaning.** `usage` and `usageSource` stay "the result event's, else the messages' sum". No reader but `spendTokens` used `usage` for money, and `spendTokens` no longer reads it, so the field stays for the readers that report it.
- **`assistantMessages` is not narrowed.** It still counts every message, a subagent's included, as at the base. Its one reader, `turnBoundHeld`, is step 0b's (W2-5b2), which counts main-thread messages through `facts.messages` (R1).
- **A message's parent is its first event's.** Claude Code repeats `parent_tool_use_id` on every event of a message. A value that is not a string reads null, as every field this reader takes does (`sjString`). A tool pair's parent is that of the assistant event that carried the tool_use.
- **The re-check first, then the ranges.** `loadFinalRecord` re-checks the code right after the record validates (W2-5a's order for its six consumers), before any other input and before the range check, so a moved tree answers `code-changed` even beside an out-of-range value. Every refusal it makes needs no store and no spawn, so a consumer calls it before `prepareOut` (W2-5a's R10).
- **`--allow-code-change` after window start only (Q23).** The flag on a record with no `window` (a part 1), or with the clock before `window.start_ms`, is `args-invalid` whether or not the code moved: W2-D6's remedy before window start is a re-pilot and a superseding part 2. At or after window start a measured change becomes the stamp; an unmeasured file stays `code-unmeasured` (W2-D24 as amended). The clock is the caller's `nowMs` (Task 4 passes `Date.now()`), so the cases pin the boundary exactly.
- **The part 2 ranges (S2's C22).** The validator types these and does not range them, and each would throw after `--out` or answer wrongly:
  - `spend_budget` (W2-D55; `batchGate` throws on a non-positive budget);
  - `limits.batch_max` in [`RECALL_ARMS.length`, `BATCH_MAX`] (a batch holds both arms of at least one question: the floor is 2, R28, pinned by the red row at 1 and the CONTROL at 2) and `limits.concurrency` in [1, `CONCURRENCY_MAX`] (`runBatch` throws past either, Q3), spelled once as `batchShapeChecks`, which Task 4's `arms` also asks on part 1 (R4: the record's values are read, bounded by these, never replaced by the constants);
  - `quiz.n_questions` positive (a part 2 count kept in range; Q5's per-node share does not divide by it but by the frozen list's entry count, which `nodeQuestions` holds non-empty, Task 4's `armNodeOf`, so the summary's `n_all` and the printed share line name that one divisor);
  - `pilot_result.settings_mode` a `SETTINGS_MODES` word (Q26: the arms run under it; `spawnArgv` throws on another);
  - each `version-move` amendment's `node_label_ref`, one of the record's node labels (Q13 requires it), and its `detail.claude_code_version`, a non-empty string (W2-D56's preflight compares the measured `--version` with it), spelled once as `versionMoveChecks`, which Task 4's `expectedForNode` reads through `refuseRangeRows` rather than spelling the two rows again (R30, W2-D12).
  `window` is not ranged here: the validator holds it to `planned_days` (W2-D25), so both ends are safe integers in order. `limits.threshold_pct` and `limits.max_age_ms` keep D-6309's rows. A later task that reads another part 2 field adds its row to `part2RangeChecks` in the same commit.

**Residuals, named:**
- The arm-word scan misses a word built at run time (`'con' + 'trol'`, `String.fromCharCode`), a template literal that interpolates part of it, and a word read from a file. A comment line is not read.
- The `RECALL_ARMS[` scan counts code lines that index the vocabulary with brackets; a destructuring (`const [a] = RECALL_ARMS`) is not seen.
- A non-string `parent_tool_use_id` reads as the main thread (`sjString`'s fold).
- `turnBoundHeld` counts subagent messages as turns until W2-5b2's step 0b reads `facts.messages` (R1).
- `assistantUsage` is each message's last usage; a message billed but still in flight when the run was killed is missing from both readings (W2-4's residual, unchanged).

- [ ] **Step 0: Check the base.** From the repository root, before any edit:

```bash
git merge-base --is-ancestor c34f82830 HEAD && echo 'base holds W2-5a' || echo 'STOP: W2-5a (#1134) is not on this base'
node --no-warnings --input-type=module -e "
const l = await import('./ccd/history/lib.mjs'); const r = await import('./ccd/history/recall.mjs'); const g = await import('./deploy/history-gate.mjs');
const lib = ['RECALL_ARMS', 'HEADLESS_LIST_MAX_BYTES', 'parseHeadlessList', 'formatHeadlessList', 'headlessMarkerOf', 'cardLine', 'displayPrefixes', 'asOfBinds', 'asOfHiddenNodesSql', 'asOfVisibleEntriesSql'];
const gate = ['RUBRICS', 'classifyRun', 'labelCorrect', 'parseAnswerField', 'parseLabelLine', 'questionOutcome', 'ASSIGNMENT_ARMS', 'AMENDMENT_KINDS'];
const words = ['headless-unarmed', 'headless-in-pane', 'headless-unlisted', 'asof-invalid', 'headless-malformed', 'headless-arm-unknown'];
const miss = [...lib.filter((n) => l[n] === undefined), ...(r.asOfCutOf === undefined ? ['asOfCutOf'] : []), ...gate.filter((n) => g[n] === undefined), ...words.filter((w) => l.REASONS[w] !== 2)];
const arms = JSON.stringify(l.RECALL_ARMS) === JSON.stringify(['control', 'treatment']) && Object.isFrozen(l.RECALL_ARMS);
console.log(miss.length === 0 && arms ? 'W2-2b on this base' : 'STOP: missing ' + miss.join(' ') + (arms ? '' : ' RECALL_ARMS-shape'));"
```

Expected: `base holds W2-5a` and `W2-2b on this base`. On either `STOP`, make no edit and report to the coordinator: W2-5b1 waits for W2-2b merged (S1, W2-D2), and the import statements below would fail to link.

- [ ] **Step 1: Confirm the anchors.** From the repository root:

```bash
python3 - <<'EOF'
D, T = 'deploy/history-replay.mjs', 'server/test/history-replay.test.ts'
checks = [
  (D, "// Imports: node: built-ins (node:crypto's randomBytes draws the W2 seeds); ../ccd/history/lib.mjs; the W2-1 exports\n"),
  (D, "// Never spelled here: the recall arm words, which reach a spawn as parameters (W2-D50), and the headless marker's\n// path, which W2-5b reaches through lib's historyPaths.\n"),
  (D, "import { CONTROL_FILE_MAX, EXIT, RECALL_OFF_META, SCHEMA_ADDED, SEARCHABLE_PROVENANCE, UUID_RE, backendOf, blobOverDecodeCap, canonicalJson, entryIndexText, ftsPhrase, ftsTextOf, historyPaths, idOk, isHistoryCommand, isSyntheticModel, producerOf, producerOfCopy, recallOffPath, recallOffStatusOf, redactField, redactFinalJson, renderEntryText, sha256Hex, summaryRowFor, toolResultIdsOf, toolUsesOf } from '../ccd/history/lib.mjs';\n"),
  (D, "import { expandEntryBody, familiesOf as scopeFamiliesOf, transcriptsOf } from '../ccd/history/recall.mjs';\n"),
  (D, "import { ANSWER_PROTOCOL, ANSWER_PROTOCOL_SHA256, ASSIGNMENT_ARMS, EXACT_MODEL_ID_RE, FACT_KINDS, GATE_CODE_FILES, LABELLER, OPEN_RECORD_V1, OPUS_MODEL_RE, PILOT_SUBSTREAM, RUBRIC_SHA256, SHA_MIN_PREFIXES, WRITER_INPUTS, WRITER_PROMPT, WRITER_PROMPT_SHA256, activeFamilies, admitFact, assignArms, assignmentSha256, buildWindows, checkGateCode, collapseWs, expectedWindows, familyKey, parseQuestionLine, q18Power, randInt, recordSha256, substream, validateOpenRecord, windowTotals } from './history-gate.mjs';\n"),
  (D, "  throw new DriverRefusal(word, detail);\n}\n"),
  (D, "  draft: 'bool', finalize: 'bool', template: 'bool', registry: 'bool', section: 'string',\n"),
  (D, "/** @typedef {{ id: string, name: string, input: unknown, result: string|null, isError: boolean|null }} ToolPair */\n"),
  (D, "  const pairs = new Map();      // tool_use id -> its pair, in first-seen order\n"),
  (D, "      const msg = ev.message;\n      const key = typeof msg.id === 'string' ? msg.id : Symbol('a message without an id');\n"),
  (D, "          pairs.set(b.id, { id: b.id, name: b.name, input: b.input ?? null, result: null, isError: null });\n"),
  (D, "  let usage = { input: 0, cacheCreation: 0, cacheRead: 0, output: 0 };\n  let usageSource = 'none';\n"),
  (D, "    assistantMessages: messages.size, malformedLines, firstCallUsage,\n  };\n}\n"),
  (D, "export function spendTokens(facts) {\n  const u = facts.usage;\n"),
  (D, "// input. Arm values arrive as parameters: this file never spells one (W2-5b's scan pins that).\n"),
  (D, " *  the account's CLAUDE_CONFIG_DIR, and in arm mode only the three CCRC_RECALL_* values passed in. Pure.\n"),
  (D, "  child.CCRC_RECALL_SESSION = r.session;\n"),
  (D, "    code: res.code, signal: res.signal, ms, cwd, stream_sha256: sha256Hex(stream), tokens, unknown_options: unknownOptions,\n"),
  (D, "    if (a.arm === 'control') controlIds.add(canonicalJson([a.store_id, a.ccrc_id]));\n"),
  (D, "  if (arm === 'control') {\n"),
  (D, "export function recheckCode(record, root = TREE_ROOT) {\n"),
  (D, "export function refuseOutOfRangeValues({ budget, limits, quotas }) {\n"),
  (D, "HANDLERS.set('verify', verifyCommand);\n"),
  (T, "  it('FLAG_SPECS declares exactly W2-4\\'s seven flags and W2-5a Task 7\\'s, frozen', () => {\n"),
  (T, "      draft: 'bool', finalize: 'bool', template: 'bool', registry: 'bool', section: 'string' });\n"),
  (T, "    expect(f.toolPairs).toEqual([{ id: 'toolu_1', name: 'Bash', input: { command: 'true' }, result: 'ok', isError: false }]);\n"),
  (T, "      permissionDenials: null, result: null, assistantMessages: 0, malformedLines: 0, firstCallUsage: null,\n"),
  (T, "    expect(f.toolPairs).toEqual([{ id: 'toolu_3', name: 'Agent', input: { prompt: 'look' }, result: 'one\\ntwo', isError: null }]);\n"),
  (T, "const T5_RECALL = { session: 'fixture-recall-session', arm: 'fixture-arm-value', asof: 'fixture-asof-uuid' };\n"),
  (T, "  // driver and the gate. The other ccd/history modules ride the release tag (W2-D24).\n"),
  (T, "    '../ccd/history/recall.mjs': '{ expandEntryBody, familiesOf as scopeFamiliesOf, transcriptsOf }',\n"),
  (T, "    expect(doc.spend, 'the ledger under --out counts the three runs').toBe(3 * 5);\n"),
  (T, "        r7expect(run7(null, null, [...sub, '--allow-code-change']).stderr, sub.join(' ')).toBe(refusalLine('args-invalid', 'unknown flag \"--allow-code-change\"'));\n"),
  (T, "      r7expect(r7drv.abStateOf('treatment', gen(1), { state: 'absent' })).toBe('ok');\n    });\n  });\n});\n"),
]
for p, s in checks:
    print(open(p).read().count(s), p, s.splitlines()[0][:72])
EOF
grep -cE "\b(CONTROL_ARM|TREATMENT_ARM|DRIVER_STOPS|DRIVER_REFUSALS|driverWordClass|usageTokens|codeRecheckVerdict|loadFinalRecord|VERSION_MOVE_KIND|batchShapeChecks|versionMoveChecks|refuseRangeRows|part2RangeChecks|positiveInt|parentToolUseId)\b" deploy/history-replay.mjs
grep -c "allow-code-change" deploy/history-replay.mjs
```

Expected (measured at c34f82830): every row prints `1`, the name count prints `0` (no name this task adds is taken), and the flag count prints `3` (three comment mentions: `DRIVER_REASONS`' doc, `preflight`'s doc and the W2-5a subcommands' comment; no flag). On any other count, stop and report the anchor that moved.

- [ ] **Step 2: Write the failing tests.** Nine edits to `server/test/history-replay.test.ts`, all before any driver edit.

(a) W2-4 Task 1's `FLAG_SPECS` case: replace

```ts
  it('FLAG_SPECS declares exactly W2-4\'s seven flags and W2-5a Task 7\'s, frozen', () => {
```

with

```ts
  it('FLAG_SPECS declares exactly W2-4\'s seven flags, W2-5a Task 7\'s and W2-5b1 Task 1\'s, frozen', () => {
```

and replace its last line

```ts
      draft: 'bool', finalize: 'bool', template: 'bool', registry: 'bool', section: 'string' });
```

with

```ts
      draft: 'bool', finalize: 'bool', template: 'bool', registry: 'bool', section: 'string',
      // W2-5b1 Task 1 (W2-D24, Q23): a part 2 consumer's stamp, taken at or after window start only
      'allow-code-change': 'bool' });
```

(b) W2-4 Task 4's stream cases. Replace

```ts
    expect(f.toolPairs).toEqual([{ id: 'toolu_1', name: 'Bash', input: { command: 'true' }, result: 'ok', isError: false }]);
```

with

```ts
    expect(f.toolPairs).toEqual([{ id: 'toolu_1', name: 'Bash', input: { command: 'true' }, result: 'ok', isError: false, parentToolUseId: null }]);
```

replace

```ts
      permissionDenials: null, result: null, assistantMessages: 0, malformedLines: 0, firstCallUsage: null,
```

with

```ts
      permissionDenials: null, result: null, assistantMessages: 0, malformedLines: 0, firstCallUsage: null,
      resultUsage: null, assistantUsage: { input: 0, cacheCreation: 0, cacheRead: 0, output: 0 }, messages: [],
```

and replace

```ts
    expect(f.toolPairs).toEqual([{ id: 'toolu_3', name: 'Agent', input: { prompt: 'look' }, result: 'one\ntwo', isError: null }]);
```

with

```ts
    expect(f.toolPairs).toEqual([{ id: 'toolu_3', name: 'Agent', input: { prompt: 'look' }, result: 'one\ntwo', isError: null, parentToolUseId: null }]);
```

(c) `T5_RECALL`: replace

```ts
const T5_RECALL = { session: 'fixture-recall-session', arm: 'fixture-arm-value', asof: 'fixture-asof-uuid' };
```

with

```ts
/** W2-5b1 Task 1: spawnEnv takes only values the seam takes (W2-D50, W2-D42), so the contract's fixture is real-shaped:
 *  a session id idOk takes, a RECALL_ARMS word (through lib, never spelled here) and a lowercase UUID. */
const T5_RECALL = { session: 'fixture-recall-session', arm: t4Lib.RECALL_ARMS[1] as string, asof: '0189abcd-0000-4000-8000-0000000005b1' };
```

(d) D-5814's pin: replace

```ts
  // driver and the gate. The other ccd/history modules ride the release tag (W2-D24).
```

with

```ts
  // driver and the gate. The other ccd/history modules ride the release tag (W2-D24). W2-5b1 Task 1 adds asOfCutOf to
  // recall.mjs's names (W2-2a's cut, which the card's parent and W2-D78(iii) read); lib's and the gate's names are not
  // pinned here, and W2-5b1 Task 1's own case holds the names that PR consumes from them.
```

and replace

```ts
    '../ccd/history/recall.mjs': '{ expandEntryBody, familiesOf as scopeFamiliesOf, transcriptsOf }',
```

with

```ts
    '../ccd/history/recall.mjs': '{ asOfCutOf, expandEntryBody, familiesOf as scopeFamiliesOf, transcriptsOf }',
```

(e) W2-4 Task 9's probe case: replace

```ts
    expect(doc.spend, 'the ledger under --out counts the three runs').toBe(3 * 5);
```

with

```ts
    // W2-5b1 Task 1 (Q7): each run is charged the larger reading, its four messages' 4 x 5 against its result's 5.
    expect(doc.spend, 'the ledger under --out counts the three runs').toBe(3 * 20);
```

(f) W2-5a Task 7's `--allow-code-change` case, one of the three in-place edits of a W2-5a case R27 licenses (Q23 declares the flag, so the grammar's answer moves); the commit names it (Step 8): replace

```ts
        r7expect(run7(null, null, [...sub, '--allow-code-change']).stderr, sub.join(' ')).toBe(refusalLine('args-invalid', 'unknown flag "--allow-code-change"'));
```

with

```ts
        // W2-5b1 Task 1 declares the flag for W2-5b's part 2 consumers (Q23): each W2-5a form now refuses it as a flag it
        // never reads (checkFlags), where the grammar refused it as unknown before. Edited in place under R27.
        r7expect(run7(null, null, [...sub, '--allow-code-change']).stderr, sub.join(' ')).toBe(refusalLine('args-invalid', `--allow-code-change is not a ${sub.join(' ')} flag`));
```

(g) The nested loader describe. Replace the four closing lines of W2-5a Task 7's outer describe

```ts
      r7expect(r7drv.abStateOf('treatment', gen(1), { state: 'absent' })).toBe('ok');
    });
  });
});
```

with

```ts
      r7expect(r7drv.abStateOf('treatment', gen(1), { state: 'absent' })).toBe('ok');
    });
  });

  // ── W2-5b1 Task 1: part 2 for W2-5b's consumers (W2-D24, W2-D25, W2-D90; S2 C22, Q23) ────────────────────────────
  // In-process over chain7's final, so the validator's chain is the real one. A moved tree is tree7's. No case spawns.
  r7describe('W2-5b1 Task 1: loadFinalRecord, the part 2 loader every W2-5b consumer shares', () => {
    /** A part 2 consumer's flags for the saved final `rec`, over chain7's draft and frozen list. */
    const flagsOf = (c: R7, rec: Saved, extra: R7 = {}): R7 => ({ record: rec.path, 'record-sha256': rec.sha, part1: c.d.path,
      'part1-sha256': c.d.sha, frozen: c.fz.path, 'frozen-sha256': c.fz.sha, ...extra });
    const START = T0 + DAY;   // chain7's window.start_ms
    const AFTER = T0 + 2 * DAY;
    const load = (flags: R7, o: { nowMs: number; root?: string }): R7 => r7drv.loadFinalRecord(flags as never, o) as R7;
    const refusalOf = (fn: () => unknown): [string, string] | null => {
      try { fn(); return null; } catch (e) {
        if (e instanceof r7drv.DriverRefusal) return [(e as R7).word, (e as R7).detail];
        throw e;
      }
    };
    /** chain7's final superseded after window start by one that appends `amendment`, its detail_sha256 computed (W2-D90). */
    const amended7 = (c: R7, amendment: R7): Saved => save7({ ...c.final, finalized_ms: AFTER, supersedes: c.f.sha,
      amendments: [{ ...amendment, detail_sha256: r7Sha(r7Canon(amendment.detail)) }] }, 'part2-amended.json');
    const MOVE = (over: R7 = {}): R7 => ({ kind: 'version-move', node_label_ref: 'node-a', at_ms: AFTER,
      detail: { claude_code_version: '9.9.8 (Claude Code)', repilot_sha256: hex('repilot') }, ...over });
    const BEFORE = `--allow-code-change before window start ${START}: before it a code change is a re-pilot and a superseding part 2 (W2-D6, W2-D24)`;

    r7it('CONTROL: chain7\'s final loads with its draft and frozen list, re-checked against the tree it runs under, with no stamp', () => {
      const c = chain7(home7(null));
      const got = load(flagsOf(c, c.f), { nowMs: T0 });
      r7expect([got.sha256, got.stamps, r7Canon(got.record)]).toEqual([c.f.sha, [], r7Canon(c.final)]);
      r7expect(got.frozen.sha256).toBe(c.fz.sha);
    });

    r7it('a moved tree refuses code-changed; --allow-code-change at or after window start loads it stamped, before it is args-invalid; an unmeasured file is never stamped (W2-D24, Q23)', () => {
      const c = chain7(home7(null));
      const moved = tree7({ edit: 'deploy/measure-history.py' });
      const flag = flagsOf(c, c.f, { 'allow-code-change': true });
      r7expect(refusalOf(() => load(flagsOf(c, c.f), { nowMs: AFTER, root: moved }))).toEqual(['code-changed', 'changed deploy/measure-history.py']);
      r7expect(load(flag, { nowMs: AFTER, root: moved }).stamps).toEqual(['code-changed']);
      r7expect(load(flag, { nowMs: START, root: moved }).stamps, 'at window start exactly').toEqual(['code-changed']);
      r7expect(refusalOf(() => load(flag, { nowMs: START - 1, root: moved }))).toEqual(['args-invalid', BEFORE]);
      r7expect(refusalOf(() => load(flag, { nowMs: START - 1 })), 'before window start, with the code unmoved too').toEqual(['args-invalid', BEFORE]);
      r7expect(refusalOf(() => load(flag, { nowMs: AFTER, root: tree7({ drop: 'deploy/measure-history.py' }) })))
        .toEqual(['code-unmeasured', 'deploy/measure-history.py is absent']);
    });

    r7it('the re-check comes first: a moved tree beside an out-of-range spend_budget answers code-changed (W2-D24, S2 C22)', () => {
      const c = chain7(home7(null));
      const bad = save7({ ...c.final, spend_budget: 0 }, 'part2.json');
      r7expect(refusalOf(() => load(flagsOf(c, bad), { nowMs: T0, root: tree7({ edit: 'deploy/measure-history.py' }) })))
        .toEqual(['code-changed', 'changed deploy/measure-history.py']);
      r7expect(refusalOf(() => load(flagsOf(c, bad), { nowMs: T0 })), 'CONTROL: under the unmoved tree the range check answers')
        .toEqual(['record-invalid', 'spend_budget out-of-range']);
    });

    r7it.each([
      ['a zero spend_budget', (f: R7): R7 => ({ ...f, spend_budget: 0 }), 'spend_budget out-of-range'],
      ['a negative spend_budget', (f: R7): R7 => ({ ...f, spend_budget: -5 }), 'spend_budget out-of-range'],
      ['a settings mode that is not a SETTINGS_MODES word', (f: R7): R7 => ({ ...f, pilot_result: { ...f.pilot_result, settings_mode: 'open' } }), 'pilot_result.settings_mode out-of-range'],
    ] as Array<[string, (f: R7) => R7, string]>)('a signed final with %s refuses record-invalid, naming the field, before any --out (S2 C22, D-6309\'s rule)', (_what, edit, detail) => {
      const c = chain7(home7(null));
      const rec = save7(edit(c.final), 'part2.json');
      r7expect(r7gate.validateOpenRecord(rec.value, { draft: c.draft, predecessor: null, frozen: { families: c.frozen.families, n_questions: 5 } }),
        'CONTROL: the gate signs it').toEqual({ ok: true });
      r7expect(refusalOf(() => load(flagsOf(c, rec), { nowMs: T0 }))).toEqual(['record-invalid', detail]);
    });

    r7it('a version-move amendment names a node by its label and carries a non-empty Claude Code version; CONTROL: a well-formed one, and a freeze exception, load (W2-D90, Q13, S2 C22)', () => {
      const c = chain7(home7(null));
      const flags = (s: Saved): R7 => flagsOf(c, s, { supersedes: c.f.path, 'supersedes-sha256': c.f.sha });
      r7expect(load(flags(amended7(c, MOVE())), { nowMs: AFTER }).record.amendments).toHaveLength(1);
      r7expect(refusalOf(() => load(flags(amended7(c, MOVE({ node_label_ref: 'node-z' }))), { nowMs: AFTER })))
        .toEqual(['record-invalid', 'amendments[0].node_label_ref out-of-range']);
      r7expect(refusalOf(() => load(flags(amended7(c, MOVE({ node_label_ref: null }))), { nowMs: AFTER })))
        .toEqual(['record-invalid', 'amendments[0].node_label_ref out-of-range']);
      r7expect(refusalOf(() => load(flags(amended7(c, MOVE({ detail: { claude_code_version: '', repilot_sha256: hex('repilot') } }))), { nowMs: AFTER })))
        .toEqual(['record-invalid', 'amendments[0].detail.claude_code_version out-of-range']);
      const exception = { kind: 'freeze-exception', node_label_ref: null, at_ms: AFTER, detail: { surface: 'ccd/history/lib.mjs', ruling: 'fixture ruling' } };
      r7expect(load(flags(amended7(c, exception)), { nowMs: AFTER }).record.amendments[0].kind, 'another kind is not ranged').toBe('freeze-exception');
    });
  });
});
```

(h) At the end of the file, after the last describe (`W2-5a fix wave: the review's minors`), append the import group and the module-level fixtures:

```ts
// ── W2-5b1 Task 1: w5b1-prefixed bindings, so none collides with a binding above. Pure cases read the driver in
// process; RP1-arm and the run case spawn W2-4's recording stub in a t5Box fixture HOME (W2-4 Task 5's harness).
import * as w5b1Fs from 'node:fs';
import * as w5b1Path from 'node:path';
import * as w5b1Lib from '../../ccd/history/lib.mjs';
import * as w5b1Recall from '../../ccd/history/recall.mjs';
import * as w5b1Gate from '../../deploy/history-gate.mjs';
import * as w5b1Drv from '../../deploy/history-replay.mjs';

const W5B1_SRC = w5b1Path.join(REPO, 'deploy', 'history-replay.mjs');
const w5b1IsComment = (t: string): boolean => t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
/** The driver's code lines with their 1-based numbers: a line whose trimmed text opens a comment is not one. */
const w5b1CodeLines = (text: string): Array<[number, string]> =>
  text.split('\n').map((l, i): [number, string] => [i + 1, l]).filter(([, l]) => !w5b1IsComment(l.trim()));
/** W2-D42's scan: each code line that spells an arm word as a whole string literal (any quote), an object key or a member
 *  name. A longer word (`control-absent`, `controlIds`, `CONTROL_ARM`) is not an arm word. */
const w5b1ArmWordLines = (text: string, arms: readonly string[]): string[] => {
  const w = arms.join('|');
  const res = [
    new RegExp('([\'"`])(?:' + w + ')\\1'),
    new RegExp('(?<![\\w$.-])(?:' + w + ')(?![\\w$-])\\s*:'),
    new RegExp('\\.(?:' + w + ')(?![\\w$-])'),
  ];
  return w5b1CodeLines(text).filter(([, l]) => res.some((re) => re.test(l))).map(([n, l]) => `${n}: ${l.trim()}`);
};
/** A stream usage object in Claude Code's field names. */
const W5B1_U = (input: number, cc: number, cr: number, out: number): Record<string, number> =>
  ({ input_tokens: input, cache_creation_input_tokens: cc, cache_read_input_tokens: cr, output_tokens: out });
/** A main thread that calls Agent once; the subagent's one message makes one Bash call; the result event's usage counts
 *  the main thread only, the shape C6 fears. Main messages: 15 and 25 tokens; the subagent's: 300; the result's
 *  default: 40, so the messages sum to 340. `result` null leaves the result event out. */
const w5b1SubStream = (result: Record<string, number> | null = W5B1_U(30, 0, 0, 10)): string => [
  { type: 'system', subtype: 'init', session_id: 'fixture-session-id', model: 'fixture-model', tools: ['Bash', 'Agent'], mcp_servers: [], plugins: [], skills: [], slash_commands: [] },
  { type: 'assistant', parent_tool_use_id: null, message: { id: 'msg-main-1', content: [{ type: 'tool_use', id: 'toolu-agent', name: 'Agent', input: { prompt: 'look' } }], usage: W5B1_U(10, 0, 0, 5) } },
  { type: 'assistant', parent_tool_use_id: 'toolu-agent', message: { id: 'msg-sub-1', content: [{ type: 'tool_use', id: 'toolu-bash', name: 'Bash', input: { command: 'ccrc history status --json' } }], usage: W5B1_U(100, 50, 100, 50) } },
  { type: 'user', parent_tool_use_id: 'toolu-agent', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu-bash', content: '{}', is_error: false }] } },
  { type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'toolu-agent', content: [{ type: 'text', text: 'found it' }] }] } },
  { type: 'assistant', parent_tool_use_id: null, message: { id: 'msg-main-2', content: [{ type: 'text', text: 'ANSWER: x' }], usage: W5B1_U(20, 0, 0, 5) } },
  ...(result === null ? [] : [{ type: 'result', subtype: 'success', is_error: false, num_turns: 2, result: 'ANSWER: x', permission_denials: [], usage: result }]),
].map((e) => JSON.stringify(e)).join('\n') + '\n';
```

(i) After them, append five describes:

```ts
describe('W2-5b1 Task 1: the arm words come from RECALL_ARMS by position, and the driver spells none (W2-D42; S2 C9)', () => {
  const ARMS = w5b1Lib.RECALL_ARMS as readonly string[];

  it('CONTROL: the scan sees an arm word as a literal in each quote, an object key and a member name, and not a longer word or a comment', () => {
    const [c, t] = [ARMS[0]!, ARMS[1]!];
    const seen = [`if (a.arm === '${c}') x();`, `const k = "${t}";`, 'const k = `' + c + '`;', `const n = { ${t}: 1 };`, `const v = counts.${c};`];
    for (const l of seen) expect(w5b1ArmWordLines(l, ARMS), l).toEqual([`1: ${l}`]);
    const unseen = [`return '${c}-absent';`, `const ${c}Ids = new Set();`, 'if (arm === CONTROL_ARM) x();', `// the ${c} arm's file`, ` * the ${t} arm`];
    for (const l of unseen) expect(w5b1ArmWordLines(l, ARMS), l).toEqual([]);
  });

  it('deploy/history-replay.mjs spells no arm word on a code line (W2-D42)', () => {
    expect(w5b1ArmWordLines(w5b1Fs.readFileSync(W5B1_SRC, 'utf8'), ARMS)).toEqual([]);
  });

  it('CONTROL_ARM and TREATMENT_ARM are RECALL_ARMS[0] and [1], the words W2 means by them, and the driver indexes RECALL_ARMS on those two lines only', () => {
    expect([w5b1Drv.CONTROL_ARM, w5b1Drv.TREATMENT_ARM]).toEqual([ARMS[0], ARMS[1]]);
    expect([w5b1Drv.CONTROL_ARM, w5b1Drv.TREATMENT_ARM], 'a reorder of RECALL_ARMS would swap them').toEqual(['control', 'treatment']);
    const indexing = w5b1CodeLines(w5b1Fs.readFileSync(W5B1_SRC, 'utf8')).filter(([, l]) => /\bRECALL_ARMS\s*\[/.test(l)).map(([, l]) => l.trim());
    expect(indexing).toEqual(['export const CONTROL_ARM = RECALL_ARMS[0];', 'export const TREATMENT_ARM = RECALL_ARMS[1];']);
  });

  it('the gate\'s ASSIGNMENT_ARMS and lib\'s RECALL_ARMS hold the same two words as a set; the gate keeps its own order (S2 C9)', () => {
    const asSet = (l: readonly string[]): string[] => [...new Set(l)].sort();
    expect([ARMS.length, (w5b1Gate.ASSIGNMENT_ARMS as readonly string[]).length]).toEqual([2, 2]);
    expect(asSet(w5b1Gate.ASSIGNMENT_ARMS as readonly string[])).toEqual(asSet(ARMS));
    // CONTROL: the comparison is a set's, so order never reds and a renamed word does.
    expect(asSet([...ARMS].reverse())).toEqual(asSet(ARMS));
    expect(asSet([ARMS[0]!, 'placebo'])).not.toEqual(asSet(ARMS));
  });

  it('the names W2-5b1 consumes from lib, recall.mjs and the gate are in the driver\'s import braces, and each module exports them (W2-2a, W2-2b, W2-3)', () => {
    const text = w5b1Fs.readFileSync(W5B1_SRC, 'utf8');
    const braces = (spec: string): string[] => {
      const tail = ` } from '${spec}';`;
      const line = text.split('\n').find((l) => l.startsWith('import { ') && l.endsWith(tail));
      return line === undefined ? [] : line.slice('import { '.length, -tail.length).split(', ');
    };
    const want: Array<[string, Record<string, unknown>, string[]]> = [
      ['../ccd/history/lib.mjs', w5b1Lib as unknown as Record<string, unknown>, ['HEADLESS_LIST_MAX_BYTES', 'RECALL_ARMS', 'asOfBinds', 'asOfHiddenNodesSql',
        'asOfVisibleEntriesSql', 'cardLine', 'displayPrefixes', 'formatHeadlessList', 'parseHeadlessList']],
      ['../ccd/history/recall.mjs', w5b1Recall as unknown as Record<string, unknown>, ['asOfCutOf']],
      ['./history-gate.mjs', w5b1Gate as unknown as Record<string, unknown>, ['RUBRICS', 'classifyRun', 'labelCorrect', 'parseAnswerField', 'parseLabelLine', 'questionOutcome']],
    ];
    for (const [spec, mod, names] of want) {
      expect(names.filter((n) => !braces(spec).includes(n)), `${spec}: not imported`).toEqual([]);
      expect(names.filter((n) => mod[n] === undefined), `${spec}: not exported`).toEqual([]);
    }
  });
});

describe('W2-5b1 Task 1: every driver word is a stop or a refusal, exactly once (W2-D80 as amended, decisions section 7; Q24)', () => {
  const STOPS = ['claude-version-moved', 'tree-moved', 'wrapper-moved', 'code-changed', 'limits-threshold', 'limits-stale', 'budget-exhausted',
    'out-refused', 'code-unmeasured', 'version-unmeasured', 'tree-unmeasured', 'wrapper-unmeasured', 'run-live', 'out-in-use', 'interrupted', 'store-unreadable'];
  /** Each word of `reasons` not in exactly one of the two lists, then each listed word that is not in `reasons`. */
  const misclassified = (reasons: readonly string[], stops: readonly string[], refusals: readonly string[]): string[] => {
    const all = [...stops, ...refusals];
    return [...reasons.filter((w) => all.filter((x) => x === w).length !== 1), ...all.filter((w) => !reasons.includes(w))];
  };

  it('CONTROL: the check names a word in neither list, a word in both, and a listed word that is no driver word', () => {
    const R = ['w-a', 'w-b', 'w-c'];
    expect(misclassified(R, ['w-a'], ['w-b', 'w-c'])).toEqual([]);
    expect(misclassified(R, ['w-a'], ['w-b'])).toEqual(['w-c']);
    expect(misclassified(R, ['w-a', 'w-b'], ['w-b', 'w-c'])).toEqual(['w-b']);
    expect(misclassified(R, ['w-a', 'w-z'], ['w-b', 'w-c'])).toEqual(['w-z']);
  });

  it('DRIVER_STOPS is W2-D80\'s seven, section 7\'s eight and W2-5a\'s store-unreadable; both lists frozen, in DRIVER_REASONS order', () => {
    expect(Object.isFrozen(w5b1Drv.DRIVER_STOPS) && Object.isFrozen(w5b1Drv.DRIVER_REFUSALS)).toBe(true);
    expect([...w5b1Drv.DRIVER_STOPS]).toEqual(w5b1Drv.DRIVER_REASONS.filter((w) => STOPS.includes(w)));
    expect([...w5b1Drv.DRIVER_STOPS].sort()).toEqual([...STOPS].sort());
    expect([...w5b1Drv.DRIVER_REFUSALS]).toEqual(w5b1Drv.DRIVER_REASONS.filter((w) => !STOPS.includes(w)));
  });

  it('each DRIVER_REASONS word is classified exactly once, and the lists hold no other word (Q24)', () => {
    expect(misclassified(w5b1Drv.DRIVER_REASONS, w5b1Drv.DRIVER_STOPS, w5b1Drv.DRIVER_REFUSALS)).toEqual([]);
  });

  it('driverWordClass answers each word\'s class and refuses a word outside DRIVER_REASONS', () => {
    for (const w of w5b1Drv.DRIVER_REASONS) expect(w5b1Drv.driverWordClass(w), w).toBe(STOPS.includes(w) ? 'stop' : 'refusal');
    expect(() => w5b1Drv.driverWordClass('bad-args')).toThrow(/not a DRIVER_REASONS word/);
    expect(() => w5b1Drv.driverWordClass('')).toThrow(TypeError);
  });
});

describe('W2-5b1 Task 1: the stream reader attributes each message and tool pair, and spend is charged fail-closed (W2-D82, W2-D58, Q7)', () => {
  t5afterEach(() => { t5vi.unstubAllEnvs(); });

  it('each tool pair and each message names the Agent tool_use it ran under, or null on the main thread', () => {
    const f = w5b1Drv.readStreamJson(w5b1SubStream());
    expect(f.toolPairs).toEqual([
      { id: 'toolu-agent', name: 'Agent', input: { prompt: 'look' }, result: 'found it', isError: null, parentToolUseId: null },
      { id: 'toolu-bash', name: 'Bash', input: { command: 'ccrc history status --json' }, result: '{}', isError: false, parentToolUseId: 'toolu-agent' },
    ]);
    expect(f.messages).toEqual([
      { id: 'msg-main-1', parentToolUseId: null, usage: { input: 10, cacheCreation: 0, cacheRead: 0, output: 5 } },
      { id: 'msg-sub-1', parentToolUseId: 'toolu-agent', usage: { input: 100, cacheCreation: 50, cacheRead: 100, output: 50 } },
      { id: 'msg-main-2', parentToolUseId: null, usage: { input: 20, cacheCreation: 0, cacheRead: 0, output: 5 } },
    ]);
    expect(f.assistantMessages, 'W2-4\'s count is unchanged: every message, the subagent\'s included').toBe(3);
  });

  it('both readings are kept, W2-4\'s usage stays the result\'s, and spend charges the larger (Q7); CONTROL: a larger result usage is charged as it is', () => {
    const f = w5b1Drv.readStreamJson(w5b1SubStream());
    expect(f.resultUsage).toEqual({ input: 30, cacheCreation: 0, cacheRead: 0, output: 10 });
    expect(f.assistantUsage).toEqual({ input: 130, cacheCreation: 50, cacheRead: 100, output: 60 });
    expect([f.usageSource, f.usage]).toEqual(['result', f.resultUsage]);
    expect([w5b1Drv.usageTokens(f.resultUsage), w5b1Drv.usageTokens(f.assistantUsage), w5b1Drv.spendTokens(f)]).toEqual([40, 340, 340]);
    expect(w5b1Drv.spendTokens(w5b1Drv.readStreamJson(w5b1SubStream(W5B1_U(990, 0, 0, 10)))), 'the larger reading, never the sum').toBe(1000);
    const none = w5b1Drv.readStreamJson(w5b1SubStream(null));
    expect([none.resultUsage, none.usageSource, w5b1Drv.spendTokens(none)]).toEqual([null, 'assistant', 340]);
    expect(w5b1Drv.usageTokens(null)).toBe(0);
  });

  it('a parent_tool_use_id that is not a string reads null, and a message with no id keeps its parent', () => {
    const s = [
      { type: 'assistant', parent_tool_use_id: 7, message: { id: 'msg-odd', content: [{ type: 'tool_use', id: 'toolu-odd', name: 'Bash', input: {} }] } },
      { type: 'assistant', parent_tool_use_id: 'toolu-agent', message: { usage: W5B1_U(1, 0, 0, 1) } },
    ].map((e) => JSON.stringify(e)).join('\n') + '\n';
    const f = w5b1Drv.readStreamJson(s);
    expect(f.toolPairs[0]!.parentToolUseId).toBeNull();
    expect(f.messages).toEqual([
      { id: 'msg-odd', parentToolUseId: null, usage: null },
      { id: null, parentToolUseId: 'toolu-agent', usage: { input: 1, cacheCreation: 0, cacheRead: 0, output: 1 } },
    ]);
    expect([f.resultUsage, w5b1Drv.spendTokens(f)]).toEqual([null, 2]);
  });

  it('a run on the stub is charged the larger reading, and its run.json records both beside the charge (Q7)', async () => {
    const b = t5Box('ccrc-replay-w5b1-q7-');
    t5fs.writeFileSync(t5path.join(b.home, STUB_STREAM), w5b1SubStream());
    const o = await claimedRun(t5job(b, b.up, 'box', 'q7-run'));
    const run = JSON.parse(t5fs.readFileSync(t5path.join(b.out, 'q7-run.run.json'), 'utf8'));
    expect([o.tokens, run.tokens, run.usage_result_tokens, run.usage_assistant_tokens]).toEqual([340, 340, 40, 340]);
    t5fs.writeFileSync(t5path.join(b.home, STUB_STREAM), w5b1SubStream(null));
    await claimedRun(t5job(b, b.up, 'box', 'q7-noresult'));
    const bare = JSON.parse(t5fs.readFileSync(t5path.join(b.out, 'q7-noresult.run.json'), 'utf8'));
    expect([bare.tokens, bare.usage_result_tokens, bare.usage_assistant_tokens]).toEqual([340, null, 340]);
    expect(t5drv.spentSoFar(b.out)).toBe(680);
  }, 60_000);
});

describe('W2-5b1 Task 1: RP1-arm, the arm env with real values (W2-D50, W2-D42)', () => {
  t5afterEach(() => { t5vi.unstubAllEnvs(); });
  const SESSION = 'up-a-fixture-family';
  const ASOF = '0189abcd-0000-4000-8000-0000000005b2';

  it.each([0, 1])('upstream, RECALL_ARMS[%i]: exactly the seven keys, each the real value, none of the ambient ones', async (i) => {
    const arm = w5b1Lib.RECALL_ARMS[i] as string;
    const b = t5Box(`ccrc-replay-w5b1-rp1-${i}-`);
    t5Ambient();
    await claimedRun(t5job(b, b.up, 'arm', `rp1-arm-${i}`, { recall: { session: SESSION, arm, asof: ASOF } }));
    const log = stubLog(b.home);
    expect(log, 'the stub ran once').toHaveLength(1);
    const l = log![0]!;
    const keys = withoutDarwinAdded(l.envKeys);
    expect(keys).toEqual(['CCRC_RECALL_ARM', 'CCRC_RECALL_ASOF', 'CCRC_RECALL_SESSION', 'CLAUDE_CONFIG_DIR', 'HOME', 'LANG', 'PATH']);
    expect(Object.fromEntries(keys.map((k) => [k, l.env[k]]))).toEqual({
      CCRC_RECALL_ARM: arm, CCRC_RECALL_ASOF: ASOF, CCRC_RECALL_SESSION: SESSION, CLAUDE_CONFIG_DIR: t5path.join(b.home, '.claude'),
      HOME: b.home, LANG: 'fixture.UTF-8', PATH: `${b.out}/poison-bin:${t5path.dirname(process.execPath)}:/usr/bin:/bin`,
    });
    for (const k of T5_NEVER_KEYS) expect(l.envKeys, k).not.toContain(k);
  }, 60_000);

  it('generated: the same three seam values reach the stub through the wrapper, and CLAUDE_CODE_OAUTH_TOKEN by name only', async () => {
    const arm = w5b1Lib.RECALL_ARMS[1] as string;
    const b = t5Box('ccrc-replay-w5b1-rp1-gen-');
    t5Ambient();
    await claimedRun(t5job(b, b.gen, 'arm', 'rp1-arm-gen', { recall: { session: SESSION, arm, asof: ASOF } }));
    const l = stubLog(b.home)![0]!;
    expect(withoutDarwinAdded(l.envKeys).filter((k) => !T5_BASH_KEYS.includes(k))).toEqual([...T5_BASE_KEYS, ...T5_RECALL_KEYS, 'CLAUDE_CODE_OAUTH_TOKEN'].sort());
    expect([l.env['CCRC_RECALL_SESSION'], l.env['CCRC_RECALL_ARM'], l.env['CCRC_RECALL_ASOF']]).toEqual([SESSION, arm, ASOF]);
    for (const k of T5_NEVER_KEYS) expect(l.envKeys, k).not.toContain(k);
    expect(t5fs.readFileSync(t5path.join(b.home, T5_STUB_LOG), 'utf8')).not.toContain(T5_TOKEN);
  }, 60_000);

  it('a value the seam would refuse is a TypeError before any spawn, with the stub log absent; CONTROL: the real values spawn once', async () => {
    const arm = w5b1Lib.RECALL_ARMS[1] as string;
    const bad: Array<[string, { session: string; arm: string; asof: string }, RegExp]> = [
      ['an arm outside RECALL_ARMS', { session: SESSION, arm: 'fixture-arm-value', asof: ASOF }, /recall\.arm "fixture-arm-value" is not one of RECALL_ARMS/],
      ['an ASOF that is not a lowercase UUID', { session: SESSION, arm, asof: ASOF.toUpperCase() }, /recall\.asof ".*" is not a lowercase UUID/],
      ['a session id idOk refuses', { session: '../up-a', arm, asof: ASOF }, /recall\.session "\.\.\/up-a" is not a session id/],
    ];
    for (const [what, recall, re] of bad) {
      const b = t5Box('ccrc-replay-w5b1-rp1-bad-');
      t5typeError(await t5caught(() => claimedRun(t5job(b, b.up, 'arm', 'rp1-arm-bad', { recall }))), re);
      expect(stubLog(b.home), `${what}: the stub never ran`).toBeNull();
    }
    const ok = t5Box('ccrc-replay-w5b1-rp1-ok-');
    await claimedRun(t5job(ok, ok.up, 'arm', 'rp1-arm-ok', { recall: { session: SESSION, arm, asof: ASOF } }));
    expect(stubLog(ok.home)).toHaveLength(1);
  }, 120_000);
});

describe('W2-5b1 Task 1: the gate_code re-check verdict and the part 2 ranges, pure', () => {
  type Verdict = { ok: true; stamps: string[] } | { ok: false; word: string; detail: string };
  const V = w5b1Drv.codeRecheckVerdict as unknown as (r: object, s: object, o?: { allowCodeChange?: boolean; nowMs?: number | null }) => Verdict;
  const FILES: Record<string, string> = Object.fromEntries((w5b1Gate.GATE_CODE_FILES as readonly string[]).map((f, i) => [f, 'abcd'[i]!.repeat(64)]));
  const START = 1_800_086_400_000;
  const rec = (window: object | null = { start_ms: START, end_ms: START + 14 * 86_400_000 }): Record<string, unknown> =>
    ({ gate_code: { release_tag: 'v9.9.7', files: FILES }, ...(window === null ? {} : { window }) });
  const measured = (over: Record<string, string> = {}): object => ({ state: 'measured', files: { ...FILES, ...over } });
  const MOVED = measured({ 'deploy/measure-history.py': 'e'.repeat(64) });
  const BEFORE = `--allow-code-change before window start ${START}: before it a code change is a re-pilot and a superseding part 2 (W2-D6, W2-D24)`;
  const NO_WINDOW = '--allow-code-change is taken only by a part 2 consumer, after window start (W2-D6, W2-D24)';
  const LIM = w5b1Drv.LIMITS_DEFAULTS as Record<string, number>;
  const P2 = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    nodes: [{ label: 'node-a', store_id: '00000000-0000-4000-8000-0000000005b1' }], limits: { ...LIM },
    quiz: { n_questions: 5 }, pilot_result: { settings_mode: 'restricted' }, amendments: [], ...over,
  });
  /** refuseOutOfRangeValues as a part 2 consumer calls it: its line, or null when it passes. */
  const range = (p: Record<string, unknown>, budget: unknown = 30_000_000): string | null => {
    try {
      w5b1Drv.refuseOutOfRangeValues({ budget, budgetField: 'spend_budget', limits: p['limits'], quotas: null, part2: p } as never);
      return null;
    } catch (e) {
      if (e instanceof w5b1Drv.DriverRefusal) return `${e.word}: ${e.detail}`;
      throw e;
    }
  };
  const move = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ kind: w5b1Drv.VERSION_MOVE_KIND, node_label_ref: 'node-a', at_ms: 1,
    detail: { claude_code_version: '9.9.8 (Claude Code)', repilot_sha256: 'f'.repeat(64) }, ...over });

  it('unchanged code is ok with no stamp, with or without the flag after window start', () => {
    expect(V(rec(), measured())).toEqual({ ok: true, stamps: [] });
    expect(V(rec(), measured(), { allowCodeChange: true, nowMs: START })).toEqual({ ok: true, stamps: [] });
  });

  it('a measured change is code-changed without the flag, and the stamp with it at or after window start', () => {
    expect(V(rec(), MOVED)).toEqual({ ok: false, word: 'code-changed', detail: 'changed deploy/measure-history.py' });
    expect(V(rec(), MOVED, { allowCodeChange: true, nowMs: START })).toEqual({ ok: true, stamps: ['code-changed'] });
    expect(V(rec(), MOVED, { allowCodeChange: true, nowMs: START + 1 })).toEqual({ ok: true, stamps: ['code-changed'] });
  });

  it('the flag before window start, or on a record with no window, is args-invalid, whether or not the code moved (Q23, W2-D6)', () => {
    for (const shas of [measured(), MOVED]) {
      expect(V(rec(), shas, { allowCodeChange: true, nowMs: START - 1 })).toEqual({ ok: false, word: 'args-invalid', detail: BEFORE });
      expect(V(rec(null), shas, { allowCodeChange: true, nowMs: START })).toEqual({ ok: false, word: 'args-invalid', detail: NO_WINDOW });
    }
    expect(() => V(rec(), MOVED, { allowCodeChange: true, nowMs: null }), 'a caller that takes the flag passes its clock').toThrow(TypeError);
  });

  it('an unmeasured file, on either side, is code-unmeasured whatever the flag says (W2-D24 as amended)', () => {
    const opts = { allowCodeChange: true, nowMs: START };
    expect(V(rec(), { state: 'unmeasured', path: 'deploy/measure-history.py', cause: 'absent' }, opts))
      .toEqual({ ok: false, word: 'code-unmeasured', detail: 'deploy/measure-history.py is absent' });
    const lacking = { ...rec(), gate_code: { release_tag: 'v9.9.7', files: Object.fromEntries(Object.entries(FILES).filter(([k]) => k !== 'ccd/history/lib.mjs')) } };
    expect(V(lacking, MOVED, opts)).toEqual({ ok: false, word: 'code-unmeasured', detail: 'gate_code lacks ccd/history/lib.mjs' });
  });

  it('refuseOutOfRangeValues with part2 names each part 2 field a W2-5b consumer reads that is out of range, in order (S2 C22)', () => {
    expect(range(P2()), 'CONTROL: the defaults pass').toBeNull();
    expect(range(P2({ limits: { ...LIM, batch_max: w5b1Drv.BATCH_MAX, concurrency: w5b1Drv.CONCURRENCY_MAX } })), 'CONTROL: the runner caps pass').toBeNull();
    expect(range(P2({ limits: { ...LIM, batch_max: 2, concurrency: 1 } })), 'CONTROL (R28): the floors pass, batch_max 2 (a batch holds both arms of one question)').toBeNull();
    expect(range(P2({ limits: { ...LIM, batch_max: 1 } })), 'a batch that cannot hold both arms (R4, R28: the floor is RECALL_ARMS.length)').toBe('record-invalid: limits.batch_max out-of-range');
    expect(range(P2(), 0)).toBe('record-invalid: spend_budget out-of-range');
    expect(range(P2({ limits: { ...LIM, batch_max: w5b1Drv.BATCH_MAX + 1 } }))).toBe('record-invalid: limits.batch_max out-of-range');
    expect(range(P2({ limits: { ...LIM, concurrency: w5b1Drv.CONCURRENCY_MAX + 1 } }))).toBe('record-invalid: limits.concurrency out-of-range');
    expect(range(P2({ limits: { ...LIM, concurrency: 0 } }))).toBe('record-invalid: limits.concurrency out-of-range');
    expect(range(P2({ quiz: { n_questions: 0 } }))).toBe('record-invalid: quiz.n_questions out-of-range');
    expect(range(P2({ pilot_result: { settings_mode: 'open' } }))).toBe('record-invalid: pilot_result.settings_mode out-of-range');
    expect(range({ nodes: [], limits: { threshold_pct: 101, max_age_ms: 0, batch_max: 0, concurrency: 3 }, quiz: {}, pilot_result: {}, amendments: [] }, -1))
      .toBe('record-invalid: spend_budget out-of-range; limits.threshold_pct out-of-range; limits.max_age_ms out-of-range; limits.batch_max out-of-range; '
        + 'limits.concurrency out-of-range; quiz.n_questions out-of-range; pilot_result.settings_mode out-of-range');
  });

  it('a version-move amendment needs a node label of the record and a non-empty Claude Code version; another kind is not ranged (W2-D90, Q13, S2 C22)', () => {
    expect(range(P2({ amendments: [move()] }))).toBeNull();
    expect(range(P2({ amendments: [move(), move({ node_label_ref: 'node-z' })] }))).toBe('record-invalid: amendments[1].node_label_ref out-of-range');
    expect(range(P2({ amendments: [move({ node_label_ref: null, detail: { claude_code_version: '', repilot_sha256: 'f'.repeat(64) } })] })))
      .toBe('record-invalid: amendments[0].node_label_ref out-of-range; amendments[0].detail.claude_code_version out-of-range');
    expect(range(P2({ amendments: [{ kind: 'forced-act', node_label_ref: null, at_ms: 1, detail: { act: 'fixture-act', at_ms: 1 } }] }))).toBeNull();
    expect(w5b1Gate.AMENDMENT_KINDS as readonly string[]).toContain(w5b1Drv.VERSION_MOVE_KIND);
  });

  it('W2-5a\'s two callers are unchanged: the budget is pilot_budget by default, and the quotas are checked unless null', () => {
    const good = { budget: 100_000, limits: LIM, quotas: { target: 100, caps: { family: 5, boundary: 3, kind_per_family: 2 } } };
    expect(() => w5b1Drv.refuseOutOfRangeValues({ ...good, budget: 0 } as never)).toThrow(/record-invalid: pilot_budget out-of-range$/);
    expect(() => w5b1Drv.refuseOutOfRangeValues({ ...good, quotas: { target: 0, caps: good.quotas.caps } } as never)).toThrow(/record-invalid: quiz.target out-of-range$/);
    expect(() => w5b1Drv.refuseOutOfRangeValues({ ...good, quotas: null } as never)).not.toThrow();
  });
});
```

Every JavaScript export whose inferred type is narrower than a case's argument is cast through `unknown` or `never`, as W2-5a's cases do, so `typecheck-tests` stays green.

- [ ] **Step 3: Run the new and changed cases; they fail (predicted).** In the foreground, with a timeout of at least 600000 ms:

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-5b1 Task 1|FLAG_SPECS declares exactly|the rest of the stream|an empty stream is no init|a tool_result in content blocks|imports exactly its fourteen modules|three box-mode spawns|no W2-5a subcommand takes|RP1-contract on the stub'
```

Expected RED (predicted; nothing in the driver has changed yet):
- `FLAG_SPECS declares exactly …`: `allow-code-change` is missing.
- The three W2-4 stream cases: each tool pair and the empty-stream object lack the new fields.
- `imports exactly its fourteen modules …`: `../ccd/history/recall.mjs brings in { expandEntryBody, familiesOf as scopeFamiliesOf, transcriptsOf }`.
- `three box-mode spawns …`: `15` against `60`.
- `no W2-5a subcommand takes --allow-code-change …`: `unknown flag "--allow-code-change"` against `--allow-code-change is not a quiz-source flag`.
- Arm words: `spells no arm word` lists exactly the two lines, `if (a.arm === 'control') controlIds.add(…)` and `if (arm === 'control') {`; `CONTROL_ARM and TREATMENT_ARM …` reads `[undefined, undefined]`; `the names W2-5b1 consumes …` fails at its first module, listing lib's nine names as not imported.
- The partition describe: `DRIVER_STOPS` is undefined (three cases red: a `TypeError` on spreading it, or `driverWordClass is not a function`).
- The stream describe: the pairs lack `parentToolUseId`, `messages` is undefined, `spendTokens` answers `40` against `340`, and the stub run's `run.json` has no `usage_*` fields (`o.tokens` 40).
- RP1-arm: the refused-values case reds at its first row (the stub ran: `t5caught` answered null).
- The pure verdict and range describe: `codeRecheckVerdict is not a function` (four cases); the range cases red with `quiz.target out-of-range; …` (W2-5a's function reads `quotas: null` as quotas and ignores `budgetField` and `part2`); `VERSION_MOVE_KIND` is undefined; the W2-5a callers' case reds on its `quotas: null` row.
- The nested loader describe: `loadFinalRecord is not a function` (seven cases).
- Green at the base, as predicted: the arm-word scan's CONTROL and the partition's CONTROL (pure test helpers); the set-parity case (lib and the gate already agree as sets; its red is its own CONTROL lines); RP1-arm's two value cases and its generated case (the base already passes the values through; their red is mutant M-E4's); RP1-contract with the real-shaped `T5_RECALL` (the base takes any string); the W2-5a callers' first two rows.

Read the RED list against this; a case red for another reason is the fixture's to fix before Step 4.

- [ ] **Step 4: Edit the driver.** Each replacement matches exactly once (Step 1 counted the anchors).

(a) The header. Replace

```js
// Imports: node: built-ins (node:crypto's randomBytes draws the W2 seeds); ../ccd/history/lib.mjs; the W2-1 exports
// the quiz reads, from ../ccd/history/store.mjs, ../ccd/history/derive.mjs, ../ccd/history/recall.mjs and
// ../ccd/history/cli.mjs (W2-D33, W2-D74); the index text and the registry read from ../ccd/history/sweep.mjs, never
// its recall-off reader (W2-D29); ./history-gate.mjs, the pure gate (W2-D11); and ../shared/roster-json.mjs.
```

with

```js
// Imports: node: built-ins (node:crypto's randomBytes draws the W2 seeds); ../ccd/history/lib.mjs, with the as-of cut's
// statements and the card line (W2-2a; W2-D35, W2-D75) and the headless seam's arm words and marker grammar (W2-2b;
// W2-D42, W2-D44); the W2-1 exports the quiz reads, from ../ccd/history/store.mjs, ../ccd/history/derive.mjs,
// ../ccd/history/recall.mjs (with W2-2a's asOfCutOf) and ../ccd/history/cli.mjs (W2-D33, W2-D74); the index text and the
// registry read from ../ccd/history/sweep.mjs, never its recall-off reader (W2-D29); ./history-gate.mjs, the pure gate
// (W2-D11); and ../shared/roster-json.mjs.
```

and replace

```js
// Never spelled here: the recall arm words, which reach a spawn as parameters (W2-D50), and the headless marker's
// path, which W2-5b reaches through lib's historyPaths.
```

with

```js
// Never spelled here: the recall arm words (W2-D42), which this file takes by position from lib's RECALL_ARMS
// (CONTROL_ARM, TREATMENT_ARM) and which reach a spawn as parameters (W2-D50); and the headless marker's path, which
// W2-5b reaches through lib's historyPaths (O13). history-replay.test.ts scans this file for an arm word.
```

(b) The three import lines. Replace the lib line (Step 1's row 3) with

```js
import { CONTROL_FILE_MAX, EXIT, HEADLESS_LIST_MAX_BYTES, RECALL_ARMS, RECALL_OFF_META, SCHEMA_ADDED, SEARCHABLE_PROVENANCE, UUID_RE, asOfBinds, asOfHiddenNodesSql, asOfVisibleEntriesSql, backendOf, blobOverDecodeCap, canonicalJson, cardLine, displayPrefixes, entryIndexText, formatHeadlessList, ftsPhrase, ftsTextOf, historyPaths, idOk, isHistoryCommand, isSyntheticModel, parseHeadlessList, producerOf, producerOfCopy, recallOffPath, recallOffStatusOf, redactField, redactFinalJson, renderEntryText, sha256Hex, summaryRowFor, toolResultIdsOf, toolUsesOf } from '../ccd/history/lib.mjs';
```

the recall line with

```js
import { asOfCutOf, expandEntryBody, familiesOf as scopeFamiliesOf, transcriptsOf } from '../ccd/history/recall.mjs';
```

and the gate line (Step 1's row 5) with

```js
import { ANSWER_PROTOCOL, ANSWER_PROTOCOL_SHA256, ASSIGNMENT_ARMS, EXACT_MODEL_ID_RE, FACT_KINDS, GATE_CODE_FILES, LABELLER, OPEN_RECORD_V1, OPUS_MODEL_RE, PILOT_SUBSTREAM, RUBRICS, RUBRIC_SHA256, SHA_MIN_PREFIXES, WRITER_INPUTS, WRITER_PROMPT, WRITER_PROMPT_SHA256, activeFamilies, admitFact, assignArms, assignmentSha256, buildWindows, checkGateCode, classifyRun, collapseWs, expectedWindows, familyKey, labelCorrect, parseAnswerField, parseLabelLine, parseQuestionLine, q18Power, questionOutcome, randInt, recordSha256, substream, validateOpenRecord, windowTotals } from './history-gate.mjs';
```

Each list keeps the base's order (code-unit order).

(c) After `refuse`. Replace

```js
  throw new DriverRefusal(word, detail);
}
```

with

```js
  throw new DriverRefusal(word, detail);
}

// ── W2-5b1 Task 1: the arm words by position (W2-D42, W2-D50; S2's C9) ──────────────────────────────────────────
/** The two recall arms, by position in lib's RECALL_ARMS (W2-2b), the arm vocabulary's one declaration. This file spells
 *  no arm word: history-replay.test.ts scans it, holds these two to the words W2 means by them, and holds RECALL_ARMS to
 *  the gate's ASSIGNMENT_ARMS as a set (the gate's order is its own: handcheckSample reads it). These two lines are the
 *  only places the driver indexes RECALL_ARMS. */
export const CONTROL_ARM = RECALL_ARMS[0];
export const TREATMENT_ARM = RECALL_ARMS[1];

// ── W2-5b1 Task 1: the stop/refusal partition of DRIVER_REASONS (W2-D80 as amended, decisions §7; Q24) ─────────────
/** The driver words that are STOPS: a question not spawned, or cut off, because of one is `not-run`. It never consumes its
 *  re-run and is resumed after the stop clears (W2-D80). W2-D80's seven (the limits and budget stops and the moved and
 *  changed four), decisions §7's eight (W2-4's four unmeasured words, its three later words and `out-refused`, which can
 *  land mid-batch), and W2-5a's `store-unreadable`. In DRIVER_REASONS order. `not-run` stays emergent (Q24): a stopped
 *  or refused run writes no run.json. */
export const DRIVER_STOPS = Object.freeze([
  'claude-version-moved', 'tree-moved', 'wrapper-moved', 'code-changed',
  'limits-threshold', 'limits-stale', 'budget-exhausted',
  'out-refused',
  'code-unmeasured', 'version-unmeasured', 'tree-unmeasured', 'wrapper-unmeasured',
  'run-live', 'out-in-use', 'interrupted',
  'store-unreadable',
]);
/** Every other driver word is a REFUSAL: its remedy is a changed input, flag, account or record, or an operator act on
 *  the marker, a control file or a frozen question (W2-D78's three), never a wait. In DRIVER_REASONS order. Both lists
 *  are spelled, so a word added to DRIVER_REASONS reds history-replay.test.ts's "exactly once" pin until it is classified. */
export const DRIVER_REFUSALS = Object.freeze([
  'family-unlisted', 'family-recall-off',
  'quiz-unanswerable', 'quiz-sha-mismatch',
  'record-invalid', 'record-sha-mismatch', 'input-sha-mismatch',
  'assignment-mismatch',
  'args-invalid', 'in-pane', 'roster-invalid', 'account-refused', 'input-invalid',
]);
/** A driver word's class, for the batch summary and the operator's line (Q24, Q30). Pure.
 *  @param {string} word  @returns {'stop' | 'refusal'} */
export function driverWordClass(word) {
  if (DRIVER_STOPS.includes(word)) return 'stop';
  if (DRIVER_REFUSALS.includes(word)) return 'refusal';
  throw new TypeError(`driverWordClass: ${JSON.stringify(word)} is not a DRIVER_REASONS word`);
}
```

(d) `FLAG_SPECS`. Replace

```js
  draft: 'bool', finalize: 'bool', template: 'bool', registry: 'bool', section: 'string',
```

with

```js
  draft: 'bool', finalize: 'bool', template: 'bool', registry: 'bool', section: 'string',
  // W2-5b1 Task 1 (W2-D24, Q23): a part 2 consumer's stamp, taken at or after window start only (loadFinalRecord). No W2-5a
  // form lists it, so each refuses it through checkFlags.
  'allow-code-change': 'bool',
```

(e) The stream reader's types. Replace

```js
/** @typedef {{ id: string, name: string, input: unknown, result: string|null, isError: boolean|null }} ToolPair */
/** @typedef {{ init: StreamInit|null, usage: StreamUsage, usageSource: 'result'|'assistant'|'none', toolPairs: ToolPair[],
 *    permissionDenials: unknown[]|null, result: { subtype: string|null, isError: boolean|null, numTurns: number|null,
 *    text: string|null }|null, assistantMessages: number, malformedLines: number, firstCallUsage: StreamUsage|null }} StreamFacts */
```

with

```js
/** @typedef {{ id: string, name: string, input: unknown, result: string|null, isError: boolean|null,
 *    parentToolUseId: string|null }} ToolPair */
/** @typedef {{ id: string|null, parentToolUseId: string|null, usage: StreamUsage|null }} StreamMessage */
/** @typedef {{ init: StreamInit|null, usage: StreamUsage, usageSource: 'result'|'assistant'|'none', toolPairs: ToolPair[],
 *    permissionDenials: unknown[]|null, result: { subtype: string|null, isError: boolean|null, numTurns: number|null,
 *    text: string|null }|null, assistantMessages: number, malformedLines: number, firstCallUsage: StreamUsage|null,
 *    resultUsage: StreamUsage|null, assistantUsage: StreamUsage, messages: StreamMessage[] }} StreamFacts */
```

(f) Inside `readStreamJson`, five replacements. Replace

```js
  const pairs = new Map();      // tool_use id -> its pair, in first-seen order
```

with

```js
  const pairs = new Map();      // tool_use id -> its pair, in first-seen order
  const parents = new Map();    // message key -> the parent_tool_use_id its first event carried (W2-5b1 Task 1)
```

replace

```js
      const msg = ev.message;
      const key = typeof msg.id === 'string' ? msg.id : Symbol('a message without an id');
```

with

```js
      const msg = ev.message;
      // W2-5b1 Task 1 (W2-D82, W2-D58, Q7, Q11): the event's parent_tool_use_id, the Agent tool_use a subagent's events
      // name; null on the main thread, and for a value that is not a string, as every field here reads.
      const parent = sjString(ev.parent_tool_use_id);
      const key = typeof msg.id === 'string' ? msg.id : Symbol('a message without an id');
      if (!parents.has(key)) parents.set(key, parent);
```

replace

```js
          pairs.set(b.id, { id: b.id, name: b.name, input: b.input ?? null, result: null, isError: null });
```

with

```js
          pairs.set(b.id, { id: b.id, name: b.name, input: b.input ?? null, result: null, isError: null, parentToolUseId: parent });
```

replace

```js
  let usage = { input: 0, cacheCreation: 0, cacheRead: 0, output: 0 };
  let usageSource = 'none';
  if (resultUsage !== null) {
    usage = resultUsage;
    usageSource = 'result';
  } else {
    for (const u of messages.values()) {
      if (u === null) continue;
      usageSource = 'assistant';
      usage = {
        input: usage.input + u.input, cacheCreation: usage.cacheCreation + u.cacheCreation,
        cacheRead: usage.cacheRead + u.cacheRead, output: usage.output + u.output,
      };
    }
  }
```

with

```js
  // W2-5b1 Task 1 (Q7): every assistant message's usage, summed once per message, subagent messages included. `usage`
  // stays W2-4's reading (the result event's, else this sum); spend charges the larger of the two (spendTokens).
  let assistantUsage = { input: 0, cacheCreation: 0, cacheRead: 0, output: 0 };
  let messageUsageSeen = false;
  for (const u of messages.values()) {
    if (u === null) continue;
    messageUsageSeen = true;
    assistantUsage = {
      input: assistantUsage.input + u.input, cacheCreation: assistantUsage.cacheCreation + u.cacheCreation,
      cacheRead: assistantUsage.cacheRead + u.cacheRead, output: assistantUsage.output + u.output,
    };
  }
  let usage = { input: 0, cacheCreation: 0, cacheRead: 0, output: 0 };
  let usageSource = 'none';
  if (resultUsage !== null) {
    usage = resultUsage;
    usageSource = 'result';
  } else if (messageUsageSeen) {
    usage = { ...assistantUsage };
    usageSource = 'assistant';
  }
```

and replace

```js
    assistantMessages: messages.size, malformedLines, firstCallUsage,
  };
}
```

with

```js
    assistantMessages: messages.size, malformedLines, firstCallUsage,
    resultUsage, assistantUsage,
    // W2-5b1 Task 1: each message in first-seen order, with the parent its first event named and its last usage.
    messages: [...messages.keys()].map((k) => ({
      id: typeof k === 'string' ? k : null, parentToolUseId: parents.get(k) ?? null, usage: messages.get(k) ?? null,
    })),
  };
}
```

(g) `spendTokens`. Replace

```js
/** One spawn's spend in token-equivalents (W2-D55): input + cache_creation + cache_read + output.
 *  @param {StreamFacts} facts
 *  @returns {number} */
export function spendTokens(facts) {
  const u = facts.usage;
  return u.input + u.cacheCreation + u.cacheRead + u.output;
}
```

with

```js
/** A usage's token-equivalents (W2-D55): input + cache_creation + cache_read + output; a null usage is 0.
 *  @param {StreamUsage|null} u  @returns {number} */
export function usageTokens(u) {
  return u === null ? 0 : u.input + u.cacheCreation + u.cacheRead + u.output;
}

/** One spawn's spend in token-equivalents (W2-D55), charged fail-closed (Q7; decisions §7's C6): the larger of the result
 *  event's usage and the sum of every assistant message's usage, subagent messages included, so an Agent subagent's
 *  spend that the result usage leaves out is still charged, whatever the pilot later measures. Every charge site calls
 *  this (launchRun and settleLeftover). An over-count is the budget's safe direction.
 *  @param {StreamFacts} facts
 *  @returns {number} */
export function spendTokens(facts) {
  return Math.max(usageTokens(facts.resultUsage), usageTokens(facts.assistantUsage));
}
```

(h) The spawn contract's comment. Replace

```js
// input. Arm values arrive as parameters: this file never spells one (W2-5b's scan pins that).
```

with

```js
// input. Arm values arrive as parameters, each a word taken by position from lib's RECALL_ARMS (CONTROL_ARM, TREATMENT_ARM):
// this file spells no arm word, and history-replay.test.ts's arm-word scan pins that (W2-D42).
```

(i) `spawnEnv`. Replace

```js
 *  the account's CLAUDE_CONFIG_DIR, and in arm mode only the three CCRC_RECALL_* values passed in. Pure.
```

with

```js
 *  the account's CLAUDE_CONFIG_DIR, and in arm mode only the three CCRC_RECALL_* values passed in, each one the seam takes
 *  (W2-5b1 Task 1: a session id lib's idOk takes, a RECALL_ARMS word, a lowercase UUID; any other is a TypeError). Pure.
```

and replace

```js
  child.CCRC_RECALL_SESSION = r.session;
```

with

```js
  // W2-5b1 Task 1 (W2-D50, W2-D42; RP1-arm): no arm run starts on a value the CLI would refuse (headless-arm-unknown,
  // asof-invalid) after a model was paid for. A caller that builds one has a defect, so it is a TypeError.
  if (!idOk(r.session)) throw new TypeError(`spawnEnv: recall.session ${JSON.stringify(r.session)} is not a session id`);
  if (!RECALL_ARMS.includes(r.arm)) throw new TypeError(`spawnEnv: recall.arm ${JSON.stringify(r.arm)} is not one of RECALL_ARMS`);
  if (!UUID_RE.test(r.asof)) throw new TypeError(`spawnEnv: recall.asof ${JSON.stringify(r.asof)} is not a lowercase UUID`);
  child.CCRC_RECALL_SESSION = r.session;
```

(j) `launchRun`'s run record. Replace

```js
    code: res.code, signal: res.signal, ms, cwd, stream_sha256: sha256Hex(stream), tokens, unknown_options: unknownOptions,
```

with

```js
    code: res.code, signal: res.signal, ms, cwd, stream_sha256: sha256Hex(stream), tokens,
    // W2-5b1 Task 1 (Q7): both readings the charge took the larger of, beside it.
    usage_result_tokens: facts.resultUsage === null ? null : usageTokens(facts.resultUsage), usage_assistant_tokens: usageTokens(facts.assistantUsage),
    unknown_options: unknownOptions,
```

(k) The two arm spellings. Replace

```js
    if (a.arm === 'control') controlIds.add(canonicalJson([a.store_id, a.ccrc_id]));
```

with

```js
    if (a.arm === CONTROL_ARM) controlIds.add(canonicalJson([a.store_id, a.ccrc_id]));
```

and replace

```js
  if (arm === 'control') {
```

with

```js
  if (arm === CONTROL_ARM) {
```

(l) `recheckCode`. Replace

```js
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
```

with

```js
/** W2-D24's re-check as a verdict, pure: `shas` (codeShas' answer) against the record's gate_code. An unmeasured file, on
 *  either side, is `code-unmeasured` whatever the flag says (W2-D24 as amended); a measured change is `code-changed`, or,
 *  with `allowCodeChange`, the stamp `code-changed` (W2-D24's one exception). The flag is taken at or after the record's
 *  `window.start_ms` only (Q23): before it, W2-D6's remedy for a code change is a re-pilot and a superseding part 2, so the
 *  flag is `args-invalid` there whether or not the code moved, and on a record with no window (a part 1) always. A caller
 *  that passes the flag passes its clock (`nowMs`, a safe integer; anything else is a TypeError).
 *  @param {{gate_code: unknown, window?: unknown}} record
 *  @param {{state: 'measured', files: Record<string, string>} | {state: 'unmeasured', path: string, cause: string}} shas
 *  @param {{allowCodeChange?: boolean, nowMs?: number | null}} [opts]
 *  @returns {{ok: true, stamps: string[]} | {ok: false, word: string, detail: string}} */
export function codeRecheckVerdict(record, shas, { allowCodeChange = false, nowMs = null } = {}) {
  if (allowCodeChange) {
    const start = plainObject(record.window) ? record.window.start_ms : undefined;
    if (!Number.isSafeInteger(start)) {
      return { ok: false, word: 'args-invalid', detail: '--allow-code-change is taken only by a part 2 consumer, after window start (W2-D6, W2-D24)' };
    }
    if (!Number.isSafeInteger(nowMs)) throw new TypeError(`codeRecheckVerdict: nowMs ${String(nowMs)} is not a clock reading`);
    if (nowMs < start) {
      return { ok: false, word: 'args-invalid', detail: `--allow-code-change before window start ${start}: before it a code change is a re-pilot and a superseding part 2 (W2-D6, W2-D24)` };
    }
  }
  if (shas.state !== 'measured') return { ok: false, word: 'code-unmeasured', detail: `${shas.path} is ${shas.cause}` };
  const c = checkGateCode(record.gate_code, shas.files);
  if (c.ok) return { ok: true, stamps: [] };
  if (c.word === 'code-unmeasured') return { ok: false, word: 'code-unmeasured', detail: `gate_code lacks ${c.unmeasured.join(' ')}` };
  if (allowCodeChange) return { ok: true, stamps: ['code-changed'] };
  return { ok: false, word: 'code-changed', detail: `changed ${c.mismatched.join(' ')}` };
}

/** W2-D24: the four gate_code files' installed bytes, measured now through codeShas(), against the record's gate_code,
 *  refusing on codeRecheckVerdict's refusal and answering its stamps. W2-5a's consumers pass no opts (no flag before
 *  window start, W2-D6); W2-5b's part 2 consumers reach it through loadFinalRecord. */
export function recheckCode(record, root = TREE_ROOT, opts = {}) {
  const v = codeRecheckVerdict(record, codeShas(root), opts);
  if (!v.ok) refuse(v.word, v.detail);
  return v.stamps;
}
```

(m) `refuseOutOfRangeValues`. Replace its last two `@param` lines and its body,

```js
 *  @param {{ budget: unknown, limits: { threshold_pct?: unknown, max_age_ms?: unknown } | undefined,
 *    quotas: { target: unknown, caps: { family?: unknown, boundary?: unknown, kind_per_family?: unknown } | undefined } }} o */
export function refuseOutOfRangeValues({ budget, limits, quotas }) {
  const positive = (v) => Number.isSafeInteger(v) && /** @type {number} */ (v) >= 1;
  const checks = [
    ['pilot_budget', positive(budget)],
    ['limits.threshold_pct', positive(limits?.threshold_pct) && /** @type {number} */ (limits?.threshold_pct) <= 100],
    ['limits.max_age_ms', positive(limits?.max_age_ms)],
    ['quiz.target', positive(quotas?.target)],
    ['quiz.caps.family', positive(quotas?.caps?.family)],
    ['quiz.caps.boundary', positive(quotas?.caps?.boundary)],
    ['quiz.caps.kind_per_family', positive(quotas?.caps?.kind_per_family)],
  ];
```

with

```js
 *  W2-5b1 Task 1 (S2's C22): `budgetField` names the budget's field (`spend_budget` for a part 2 consumer); `quotas: null`
 *  skips the quiz-quota rows (a part 2 consumer samples nothing); `part2`, a final, adds part2RangeChecks' rows.
 *  @param {{ budget: unknown, budgetField?: string, limits: { threshold_pct?: unknown, max_age_ms?: unknown } | undefined,
 *    quotas: { target: unknown, caps: { family?: unknown, boundary?: unknown, kind_per_family?: unknown } | undefined } | null,
 *    part2?: any }} o */
export function refuseOutOfRangeValues({ budget, budgetField = 'pilot_budget', limits, quotas, part2 = null }) {
  const checks = [
    [budgetField, positiveInt(budget)],
    ['limits.threshold_pct', positiveInt(limits?.threshold_pct) && /** @type {number} */ (limits?.threshold_pct) <= 100],
    ['limits.max_age_ms', positiveInt(limits?.max_age_ms)],
    ...(quotas === null ? [] : [
      ['quiz.target', positiveInt(quotas?.target)],
      ['quiz.caps.family', positiveInt(quotas?.caps?.family)],
      ['quiz.caps.boundary', positiveInt(quotas?.caps?.boundary)],
      ['quiz.caps.kind_per_family', positiveInt(quotas?.caps?.kind_per_family)],
    ]),
    ...(part2 === null ? [] : part2RangeChecks(part2)),
  ];
```

Then replace the two lines after it (R30: the refusal is factored, so Task 4's `expectedForNode` refuses through the same function, never a second spelling),

```js
  const bad = checks.filter(([, ok]) => !ok).map(([name]) => `${name} out-of-range`);
  if (bad.length > 0) refuse('record-invalid', bad.join('; '));
```

with

```js
  refuseRangeRows(checks);
```

The refusal's word and detail are unchanged byte for byte, so W2-5a's range cases and this task's pure range cases read the same lines. Then insert, directly above that function's doc comment (`/** D-6309: the record's budget, limits and quiz quotas, in range, asked before prepareOut makes --out. The`):

```js
/** A positive safe integer: D-6309's range for every count and bound the record carries. */
const positiveInt = (v) => Number.isSafeInteger(v) && /** @type {number} */ (v) >= 1;

/** D-6309's refusal over [path, inRange] rows: `record-invalid`, naming each failing path as `<path> out-of-range`,
 *  joined by `; `, in row order; nothing when every row is in range. The one spelling of that refusal, for
 *  refuseOutOfRangeValues and for W2-5b1 Task 4's expectedForNode (R30, W2-D12).
 *  @param {Array<[string, boolean]>} checks */
function refuseRangeRows(checks) {
  const bad = checks.filter(([, ok]) => !ok).map(([name]) => `${name} out-of-range`);
  if (bad.length > 0) refuse('record-invalid', bad.join('; '));
}
```

(n) The new section. Replace

```js
HANDLERS.set('verify', verifyCommand);
```

with

```js
HANDLERS.set('verify', verifyCommand);

// ── W2-5b1 Task 1: part 2 for W2-5b's consumers (W2-D24, W2-D25, W2-D90; S2's C22, Q23) ────────────────────────────────
/** The amendment kind whose detail W2-D56's version preflight reads (W2-D90): one of the gate's AMENDMENT_KINDS, held
 *  there by history-replay.test.ts. */
export const VERSION_MOVE_KIND = 'version-move';

/** The arm batch's shape (Q3, R4), one spelling for part2RangeChecks and for `arms` on part 1 (W2-5b1 Task 4's `batch`):
 *  limits.batch_max holds both arms of at least one question (RECALL_ARMS.length) and at most BATCH_MAX spawns (runBatch
 *  throws past it), and limits.concurrency is runBatch's 1 to CONCURRENCY_MAX. The record's values are read, bounded by
 *  these, never replaced by the constants. Pure.
 *  @param {any} limits  @returns {Array<[string, boolean]>} */
function batchShapeChecks(limits) {
  return [
    ['limits.batch_max', positiveInt(limits?.batch_max) && limits.batch_max >= RECALL_ARMS.length && limits.batch_max <= BATCH_MAX],
    ['limits.concurrency', positiveInt(limits?.concurrency) && limits.concurrency <= CONCURRENCY_MAX],
  ];
}

/** Each version-move amendment's node label (Q13 requires it: one of the record's node labels) and Claude Code version
 *  (W2-D56 compares the measured --version with it: a non-empty string), as [path, inRange], in array order; another
 *  kind adds no row. The one spelling of these two ranges (R30, W2-D12): part2RangeChecks reads it for a part 2
 *  consumer, and W2-5b1 Task 4's expectedForNode reads it through refuseRangeRows. Pure.
 *  @param {any} r  @returns {Array<[string, boolean]>} */
function versionMoveChecks(r) {
  const labels = new Set((Array.isArray(r?.nodes) ? r.nodes : []).map((n) => n?.label));
  /** @type {Array<[string, boolean]>} */
  const checks = [];
  (Array.isArray(r?.amendments) ? r.amendments : []).forEach((a, i) => {
    if (a?.kind !== VERSION_MOVE_KIND) return;
    checks.push([`amendments[${i}].node_label_ref`, typeof a.node_label_ref === 'string' && labels.has(a.node_label_ref)]);
    const v = a.detail?.claude_code_version;
    checks.push([`amendments[${i}].detail.claude_code_version`, typeof v === 'string' && v !== '']);
  });
  return checks;
}

/** The part 2 fields a W2-5b consumer reads that the gate's validator types but does not range (S2's C22, D-6309's rule),
 *  each as [path, inRange]: the arm batch's shape (batchShapeChecks); the question count (a count kept in range; Q5's per-node
 *  share divides by the frozen list's entry count instead, which nodeQuestions holds non-empty); the settings mode the arms run under (Q26; spawnArgv
 *  throws on another word); and each version-move amendment's rows (versionMoveChecks, R30). The window is not here: the
 *  validator holds it to planned_days. A later task that reads another part 2 field adds its row here in the same commit. Pure.
 *  @param {any} r  @returns {Array<[string, boolean]>} */
function part2RangeChecks(r) {
  /** @type {Array<[string, boolean]>} */
  const checks = [
    ...batchShapeChecks(r?.limits),
    ['quiz.n_questions', positiveInt(r?.quiz?.n_questions)],
    ['pilot_result.settings_mode', SETTINGS_MODES.includes(r?.pilot_result?.settings_mode)],
    ...versionMoveChecks(r),
  ];
  return checks;
}

/** W2-5b's part 2 consumers' one loader (`arms --section quiz` and `judge --section quiz`, Tasks 4 and 5; W2-5b2's
 *  `report`). The final through loadRecordInput (W2-D25: its sha before a byte is parsed, its draft, its frozen list, and
 *  the final it supersedes when it is amended, the validator holding the chain); then W2-D24's re-check, first, before any
 *  other input is read and before any spawn, with --allow-code-change taken at or after window start only and answered as
 *  stamps the consumer writes into every output (Q23); then every part 2 field the consumer reads, in range (S2's C22). It
 *  writes nothing and takes no --out, so a consumer calls it before prepareOut (W2-5a's R10, D-6309's rule).
 *  @param {Flags} flags  @param {{nowMs: number, root?: string}} o
 *  @returns {{record: any, sha256: string, frozen: any, stamps: string[]}} */
export function loadFinalRecord(flags, { nowMs, root = TREE_ROOT }) {
  const rec = loadRecordInput(flags, 'final');
  const stamps = recheckCode(rec.record, root, { allowCodeChange: flags['allow-code-change'] === true, nowMs });
  const r = rec.record;
  refuseOutOfRangeValues({ budget: r.spend_budget, budgetField: 'spend_budget', limits: r.limits, quotas: null, part2: r });
  return { ...rec, stamps };
}
```

- [ ] **Step 5: The whole file green.** In the foreground, with a timeout of at least 600000 ms:

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-5b1 Task 1'
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts
```

Expected (predicted): the first, 31 passed (five in the arm-word describe, four in the partition, four in the stream describe, four in RP1-arm, seven in the pure describe and seven in the nested loader describe); measured 32 passed, the 31 plus W2-4 Task 1's `FLAG_SPECS declares exactly …` case, whose edited title also names `W2-5b1 Task 1`. The second, the whole file green, the cases Step 3 named included. A W2-4 or W2-5a case other than the probe's whose pinned spend moves is a canned stream whose messages sum past its result usage: re-pin it with the probe's Q7 sentence and name it in the report (measured at c34f82830: the T5, T6, T8, W6 and leftover fixtures each carry one message equal to the result's usage, or a result alone, so none is predicted). If the `amended7` CONTROL does not load, the validator refused the fixture: fix the fixture (its `supersedes`, `finalized_ms` or `detail_sha256`), never the loader.

- [ ] **Step 6: Measure every new guard red, then green.** From the repository root. Each block makes one exact replacement, asserted to match once, runs one filter, shows it red, and restores the file. Run the block one mutant per tool call (Global Constraints' "One mutant per tool call"); a mutant of two `mut` lines is one call.

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w2-5b1/scratch"; mkdir -p "$SCRATCH"
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

# M-A1 (W2-D42): an arm word spelled again.
mut deploy/history-replay.mjs '    if (a.arm === CONTROL_ARM) controlIds' "    if (a.arm === 'control') controlIds"
R 'spells no arm word on a code line'
# Expected RED (predicted): 1 failed, the one quizPopulation line listed.

# M-A2: the positions swapped.
mut deploy/history-replay.mjs 'export const CONTROL_ARM = RECALL_ARMS[0];' 'export const CONTROL_ARM = RECALL_ARMS[1];'
mut deploy/history-replay.mjs 'export const TREATMENT_ARM = RECALL_ARMS[1];' 'export const TREATMENT_ARM = RECALL_ARMS[0];'
R 'CONTROL_ARM and TREATMENT_ARM|the population drops'
# Expected RED (predicted): 2 failed: the positional case, and W2-5a's quizPopulation case (control-id counts the treatment ids).

# M-A3: a third place that indexes the vocabulary.
mut deploy/history-replay.mjs '  if (arm === CONTROL_ARM) {' '  if (arm === RECALL_ARMS[0]) {'
R 'indexes RECALL_ARMS on those two lines only'
# Expected RED (predicted): 1 failed, three indexing lines against two.

# M-P1 (Q24): a stop left unclassified.
mut deploy/history-replay.mjs "  'out-refused',
  'code-unmeasured', 'version-unmeasured', 'tree-unmeasured', 'wrapper-unmeasured',
  'run-live', 'out-in-use', 'interrupted',
  'store-unreadable',
]);" "  'code-unmeasured', 'version-unmeasured', 'tree-unmeasured', 'wrapper-unmeasured',
  'run-live', 'out-in-use', 'interrupted',
  'store-unreadable',
]);"
R 'a stop or a refusal'
# Expected RED (predicted): 3 failed | 1 passed (the CONTROL): the exact list, "classified exactly once" (['out-refused']), and driverWordClass (a TypeError for out-refused).

# M-P2 (Q24): a word classified twice.
mut deploy/history-replay.mjs 'export const DRIVER_STOPS = Object.freeze([
' "export const DRIVER_STOPS = Object.freeze([
  'family-unlisted',
"
R 'a stop or a refusal'
# Expected RED (predicted): 3 failed | 1 passed: the exact list, "classified exactly once" (['family-unlisted']), driverWordClass ('stop' against 'refusal').

# M-P3: an unknown word read as a refusal.
mut deploy/history-replay.mjs '  throw new TypeError(`driverWordClass: ${JSON.stringify(word)} is not a DRIVER_REASONS word`);' "  return 'refusal';"
R 'driverWordClass answers'
# Expected RED (predicted): 1 failed.

# M-S1 (W2-D82): a tool pair's parent dropped.
mut deploy/history-replay.mjs 'isError: null, parentToolUseId: parent });' 'isError: null, parentToolUseId: null });'
R 'names the Agent tool_use it ran under'
# Expected RED (predicted): 1 failed, toolu-bash's parentToolUseId null against 'toolu-agent'.

# M-S2 (Q7): W2-4's charge rule back.
mut deploy/history-replay.mjs '  return Math.max(usageTokens(facts.resultUsage), usageTokens(facts.assistantUsage));' '  return usageTokens(facts.resultUsage ?? facts.assistantUsage);'
R 'charges the larger|charged the larger reading|three box-mode spawns'
# Expected RED (predicted): 3 failed: the pure case (40 against 340), the stub run (tokens 40), and the probe (15 against 60).

# M-S3 (Q7): the subagent's messages left out of the sum.
mut deploy/history-replay.mjs '  for (const u of messages.values()) {
    if (u === null) continue;
    messageUsageSeen = true;' '  for (const [k, u] of messages) {
    if (u === null || parents.get(k) !== null) continue;
    messageUsageSeen = true;'
R 'charges the larger|charged the larger reading'
# Expected RED (predicted): 2 failed: assistantUsage { input: 30, … } and spend 40.

# M-S4 (Q7): one reading not recorded.
mut deploy/history-replay.mjs ', usage_assistant_tokens: usageTokens(facts.assistantUsage),' ','
R 'charged the larger reading'
# Expected RED (predicted): 1 failed, usage_assistant_tokens undefined.

# M-E1 to M-E3 (W2-D50, W2-D42): each spawnEnv check removed in turn.
mut deploy/history-replay.mjs '  if (!RECALL_ARMS.includes(r.arm)) throw' '  if (false) throw'
R 'the seam would refuse'
# Expected RED (predicted): 1 failed, its first row: the stub ran.
mut deploy/history-replay.mjs '  if (!UUID_RE.test(r.asof)) throw' '  if (false) throw'
R 'the seam would refuse'
# Expected RED (predicted): 1 failed, its second row.
mut deploy/history-replay.mjs '  if (!idOk(r.session)) throw' '  if (false) throw'
R 'the seam would refuse'
# Expected RED (predicted): 1 failed, its third row.

# M-E4 (RP1-arm): the arm env carries another value.
mut deploy/history-replay.mjs '  child.CCRC_RECALL_ARM = r.arm;' '  child.CCRC_RECALL_ARM = r.session;'
R 'RP1-arm|RP1-contract on the stub'
# Expected RED (predicted): 4 failed, the rest passed: RP1-arm's two upstream cases and its generated case, and
# RP1-contract's `upstream, arm` case; RP1-arm's refused-values case (its CONTROL spawns) and RP1-contract's other modes pass.

# M-F1 (Q23): the flag not declared.
mut deploy/history-replay.mjs "  'allow-code-change': 'bool',
" ''
R 'FLAG_SPECS declares exactly|no W2-5a subcommand takes'
# Expected RED (predicted): 2 failed: the FLAG_SPECS pin, and the W2-5a case ('unknown flag').

# M-C1 (Q23, W2-D6): the flag taken before window start.
mut deploy/history-replay.mjs '    if (nowMs < start) {' '    if (nowMs < start && false) {'
R 'before window start|loads it stamped'
# Expected RED (predicted): 2 failed | 1 passed: the pure case and the loader case; W2-5a's flag case stays green.

# M-C2 (W2-D24 as amended): an unmeasured gate_code entry stamped.
mut deploy/history-replay.mjs "  if (c.word === 'code-unmeasured') return" "  if (allowCodeChange) return { ok: true, stamps: ['code-changed'] };
  if (c.word === 'code-unmeasured') return"
R 'whatever the flag says'
# Expected RED (predicted): 1 failed, the 'gate_code lacks' row stamped.

# M-C3 (Q23): window start itself refused.
mut deploy/history-replay.mjs '    if (nowMs < start) {' '    if (nowMs <= start) {'
R 'at or after window start'
# Expected RED (predicted): 2 failed: the pure stamp case at START and the loader's "at window start exactly". (The
# unselected "unchanged code" case reds too, at START; the filter leaves it out.)

# M-R1 (S2 C22): the budget named as part 1's.
mut deploy/history-replay.mjs '    [budgetField, positiveInt(budget)],' "    ['pilot_budget', positiveInt(budget)],"
R 'S2 C22'
# Expected RED (predicted): 4 failed | 3 passed: the pure range case, the loader's two spend_budget rows and the
# re-check-first CONTROL; the loader's settings-mode row and the two amendment cases pass.

# M-R2: the settings mode not ranged.
mut deploy/history-replay.mjs "    ['pilot_result.settings_mode', SETTINGS_MODES.includes(r?.pilot_result?.settings_mode)],
" ''
R 'S2 C22'
# Expected RED (predicted): 2 failed | 5 passed: the pure range case and the loader's settings-mode row.

# M-R3 (Q13): the version move's label not checked.
mut deploy/history-replay.mjs '    checks.push([`amendments[${i}].node_label_ref`, typeof a.node_label_ref === '"'"'string'"'"' && labels.has(a.node_label_ref)]);
' ''
R 'version-move amendment'
# Expected RED (predicted): 2 failed: the pure amendment case and the loader's.

# M-R4 (Q3): no upper bound on concurrency.
mut deploy/history-replay.mjs '    ['"'"'limits.concurrency'"'"', positiveInt(limits?.concurrency) && limits.concurrency <= CONCURRENCY_MAX],' '    ['"'"'limits.concurrency'"'"', positiveInt(limits?.concurrency)],'
R 'refuseOutOfRangeValues with part2'
# Expected RED (predicted): 1 failed, CONCURRENCY_MAX + 1 passing.

# M-R6 (R4, R28): a batch_max that cannot hold both arms admitted (the floor RECALL_ARMS.length dropped).
mut deploy/history-replay.mjs 'positiveInt(limits?.batch_max) && limits.batch_max >= RECALL_ARMS.length && ' 'positiveInt(limits?.batch_max) && '
R 'refuseOutOfRangeValues with part2'
# Expected RED (predicted): 1 failed, the batch_max 1 row passing; the CONTROL at 2 stays green either way.

# M-R5: the quiz quotas read for a part 2 consumer.
mut deploy/history-replay.mjs '    ...(quotas === null ? [] : [' '    ...([' 
R "chain7's final loads|callers are unchanged"
# Expected RED (predicted): 2 failed: the loader CONTROL (quiz.target out-of-range) and the W2-5a callers' quotas: null row.

# M-L1 (W2-D24): the range check before the re-check.
mut deploy/history-replay.mjs '  const stamps = recheckCode(rec.record, root, { allowCodeChange: flags['"'"'allow-code-change'"'"'] === true, nowMs });
  const r = rec.record;
  refuseOutOfRangeValues({ budget: r.spend_budget, budgetField: '"'"'spend_budget'"'"', limits: r.limits, quotas: null, part2: r });' '  const r = rec.record;
  refuseOutOfRangeValues({ budget: r.spend_budget, budgetField: '"'"'spend_budget'"'"', limits: r.limits, quotas: null, part2: r });
  const stamps = recheckCode(rec.record, root, { allowCodeChange: flags['"'"'allow-code-change'"'"'] === true, nowMs });'
R 'the re-check comes first'
# Expected RED (predicted): 1 failed, record-invalid against code-changed.

# M-N1 (D-5814): a consumed name dropped from an import.
mut deploy/history-replay.mjs 'import { asOfCutOf, expandEntryBody,' 'import { expandEntryBody,'
R 'imports exactly its fourteen modules|W2-5b1 consumes'
# Expected RED (predicted): 2 failed: D-5814's exact names and the consumed-names case (['asOfCutOf']).

cmp deploy/history-replay.mjs "$SCRATCH/replay.t1.orig" && cmp server/test/history-replay.test.ts "$SCRATCH/test.t1.orig" && echo restored && rm -f "$SCRATCH/replay.t1.orig" "$SCRATCH/test.t1.orig"
git status --short   # only this task's two paths
```

Then re-run `-t 'W2-5b1 Task 1'` on the restored tree. Expected green (predicted): 31 passed (measured 32, the `FLAG_SPECS` case counted). Which guard each mutant pins:

| Mutant | Guard |
|---|---|
| M-A1 | W2-D42's arm-word scan |
| M-A2 | the positional meaning of the two constants (and W2-5a's population through them) |
| M-A3 | one place indexes RECALL_ARMS |
| M-P1, M-P2 | Q24: each word classified exactly once |
| M-P3 | driverWordClass refuses a word outside DRIVER_REASONS |
| M-S1 | W2-D82's attribution of a tool pair |
| M-S2 | Q7's larger reading, at every charge site |
| M-S3 | subagent messages in the sum |
| M-S4 | both readings recorded |
| M-E1, M-E2, M-E3 | W2-D50: no spawn on a value the seam refuses |
| M-E4 | RP1-arm's real values |
| M-F1 | the flag declared, and W2-5a's forms refusing it |
| M-C1, M-C3 | Q23: the flag at or after window start only, the boundary included |
| M-C2 | W2-D24 as amended: an unmeasured file is never stamped |
| M-R1 | the part 2 budget named as itself |
| M-R2, M-R4 | S2's C22 rows (Q26, Q3) |
| M-R3 | Q13's required label, in `versionMoveChecks` (Task 4's M33 drops the same row and reds `expectedForNode`'s pure case: R30) |
| M-R6 | R4, R28: a batch holds both arms of at least one question (the red row at 1, the CONTROL at 2) |
| M-R5 | a part 2 consumer reads no quiz quotas |
| M-L1 | W2-D24's re-check first |
| M-N1 | D-5814 and the consumed-names pin |

The set-parity case's red comes from its own CONTROL lines: the gate is never edited (S2's C9).

- [ ] **Step 7: Run the neighbours that read these files.** In the foreground, with a timeout of at least 600000 ms. A red file is re-run alone before it is called a break (CLAUDE.md's load flakes; `typecheck-tests` is one).

```bash
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'O13|O14'
cd server && ./node_modules/.bin/vitest run test/history-lib.test.ts -t 'W2-2b Task 1'
cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts
cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts
cd server && ./node_modules/.bin/vitest run test/citations.test.ts
```

Expected (predicted), each green:
- `single-definition` O13: no driver line spells `/headless-on` or pairs a write verb with `.headlessOn` (this task names the marker nowhere); O14: the driver declares no VOCABS name (`RECALL_ARMS` and `HEADLESS_LIST_MAX_BYTES` are imported, `CONTROL_ARM` and `TREATMENT_ARM` are not VOCABS names).
- `history-lib -t 'W2-2b Task 1'`: W2-2b's pins hold, untouched.
- `lifecycle`: it imports the driver in-process for `OUT_MARKER`; the new imports link.
- `typecheck-tests`: the new cases cast each JavaScript export through `unknown` or `never` where its JSDoc type is narrower.
- `topology-clean`: the fixtures name roster fixture ids, `node-a`, synthetic UUIDs and `mkTmp` paths only.
- `citations`: no added code or test line cites `file.mjs:N`; the "about :N" hints are in this plan.

CI selects this PR's tests from its traced map; a change to `deploy/history-replay.mjs` selects `history-replay.test.ts`.

- [ ] **Step 8: Commit.** Only this task's two paths:

```bash
git add deploy/history-replay.mjs server/test/history-replay.test.ts
CO_AUTHORED_BY='<the Co-Authored-By line the attribution reminder gives>'
git commit -m "feat(history-replay): the arm words by position, the stop/refusal partition, the stream's subagent attribution and the larger-reading charge, and the part 2 loader (W2-5b1 Task 1; W2-D42, W2-D50, W2-D80, W2-D24, W2-D90; S2, Q7, Q23, Q24; D-6467)" \
  -m "In place (R27): W2-5a Task 7's case 'no W2-5a subcommand takes --allow-code-change' now expects checkFlags' '--allow-code-change is not a <form> flag' line, because Q23 declares the flag; no W2-5a W2-D24 re-check case is edited." \
  -m "$CO_AUTHORED_BY"
```

**Not in this task:**
- The card line and W2-D78(iii)'s as-of check (Task 2) call the W2-2a names imported here; the marker reader and `verify --section pilot|quiz` (Task 3) call the W2-2b names; the arm engine (Task 4) builds each job's `recall` from `CONTROL_ARM`, `TREATMENT_ARM`, the question's family and its `boundary_uuid`, reads `parentToolUseId` for `via_agent`, prints `driverWordClass`'s answer as the stop's kind in its batch summary (`reportArmsStop`), and loads its record through its own `loadArmRun`, which calls `loadFinalRecord` for `--section quiz` and, for the pilot, W2-5a's `loadRecordInput(flags, 'draft')` and `recheckCode`, with no flag; the judge (Task 5) calls `loadArmRun` too. Each adds `allow-code-change` to its quiz form's `SUBCOMMAND_FLAGS` entry and writes `stamps` into every output.
- "A stop never consumes the re-run" is pinned where attempts are recorded (Task 4), over the gate's `classifyRun` and `questionOutcome`.
- W2-D56's `expected` for a node (Task 4's `expectedForNode`) reads this task's `versionMoveChecks` through `refuseRangeRows` and spells neither row again (R30); Task 4's scan and mutants M32 and M33 pin that.
- The pilot's measured relation between the two usage readings (Q7) is W2-5b2's `pilot-result`.

### Task 2: The as-of pieces: the card line, the two payloads and the per-question re-check, with the parity pins against lib's cut (W2-D75, W2-D78(iii), W2-D38; Q20, Q21, Q22)

This task gives the arm engine (Task 4) the three things it reads from boundary N's store before any arm spawns, and it ties the two places where W2-5a decided "as of N" by itself to lib's own cut. Every as-of decision here is lib's (W2-D38), never a second spelling:
- the cut at boundary N is recall.mjs's `asOfCutOf`, called on one driver line (`armCut`);
- whether a node is hidden is lib's `asOfHiddenNodesSql` (W2-D35 as amended; D-6282, D-6283 and D-6284, cited bare), and whether an entry is visible is lib's `asOfVisibleEntriesSql`, each bound with lib's `asOfBinds`;
- R8's ref rule (recall.mjs's private decider) answers another question, whether `describe` drops a node's refs. Ruling S2 makes C8 moot for W2-5b, so nothing here composes it, and the scan in Step 2 pins that no driver code line names it.

It ships:
- **The card line (W2-D75; spec §8.6 "Shape"; ruling Q20).** `cardOf` builds lib's `cardLine` over leaf N's node and its depth-1 parent:
  - leaf N's node is the depth-0 node whose `boundary_entry_id` is N. Its one spelling is `LEAF_OF_BOUNDARY_SQL`, which `spanRowsOf` now reads too;
  - the parent is named only when `asOfHiddenNodesSql` under the cut at N does not return it. A parent with a leaf formed after N answers exit 3 under the arm's own cut, so the card never names it (W2-D75's CONTROL);
  - a leaf with several depth-1 parents names none. That is a damaged store's shape, so the card fails closed;
  - both ids print as lib's `displayPrefixes` over the family's whole node-id set (Q20), as the sweep's card does, so a prefix stays unique inside the arm's narrower scope;
  - `CARD_PARENTS` names where the parent stands: `shown`, `none`, `hidden` or `several`.
- **The two payloads (Q20; spec §10.2 "Two arms": "the card line, which the driver prepends to the treatment prompt").**
  - `armPayloads` answers `plain`, W2-5a's `reconstructPayload` text byte for byte, and `carded`, which `prependCard` makes: the card line, one blank line, then that same text.
  - Task 4 hands each arm its payload by Task 1's positional arm constants. Nothing here spells an arm word (W2-D42).
- **The re-check before every arm batch (W2-D78(iii); ruling Q21).** `recheckQuestion` checks one frozen question, clauses in order, and names the first that fails:
  - (a) the one redaction screen, `screenRedaction` (F_raw, F, the repo roots, and F_raw inside its leaf), over the question's candidate. A frozen entry carries no leaf, so the candidate is re-mined from the store through `mineStoredBoundary`, the composition `sourceQuiz` mines with, factored out of it here;
  - (b) W2-D70 over leaf N's span, any source (`answerability`);
  - (c) the frozen `source_entry_uuid` visible under the cut at `boundary_uuid`. An `asof-invalid` there is clause (c).

  `recheckBatch` runs it over a batch in batch order. When any question fails, it refuses `quiz-unanswerable` and names every failing qid and its clause. A frozen question is never dropped silently.
- **The parity pins C1 and C2 (the ledger's R8 carry; ruling Q22).**
  - C1: the same-millisecond count's T_N and holding file (W2-5a's admission row) equal `asOfCutOf`'s `tsCut` and `holdingFileId`. The entries it counts are exactly the ones lib's cut shows at T_N outside that file.
  - C2: the driver's kept(N) members equal `asOfCutOf(N).keptUuids` as sets on a readable kept list. A CONTROL names the divergence on an unreadable one: the driver discards N (`kept-absent`, `kept-unreadable`), while `asOfCutOf` keeps `[]` or the string members (derive.mjs's `keptOf`). The divergence never reaches an arm, because `armPayloads` discards first.

Store data never throws here. A failure on data is a `RECON_DISCARDS` word or a clause: D-6309's rule says a data case after `--out` never exits INTERNAL. That is why `card-unrenderable` joins `RECON_DISCARDS`: it covers a node id the store holds that lib's grammar refuses. A caller's defect is a `TypeError`: a cut of another boundary, or a question of another store.

**Decisions:**
- W2-D75 (the card line, its parent rule, and W2-D75's CONTROL); `card.mjs`'s `predict` is not used;
- W2-D78(iii), all three clauses, with Q21's depth;
- W2-D35 as amended, W2-D36 and W2-D38 (lib's own node and entry statements, consumed and never re-spelled);
- W2-D34's residual count, tied to lib by C1, and W2-D33 and W2-D68 (2) (the kept-list divergence, pinned by C2);
- W2-D70 (clause (b)), W2-D67 and W2-D65 (clause (a): the screen and the re-mine);
- W2-D54: the card line holds no stored field, only node ids and lib's constant (Choices);
- W2-D59: no `DRIVER_REASONS` word is added; `quiz-unanswerable` is W2-D59's own;
- rulings S2 (C8 moot), Q20, Q21 and Q22; R5 (the card is not redacted), R6 (the re-mine's config dirs), R7 (no family check in (a)) and R27 (Step 5's count literal, if one is needed, is a licensed in-place edit of a W2-5a case, named in the commit).

It cites D-5765 (the store half's `asof-invalid`), D-5766 (the cut), D-5780 (clause 4), D-6281 (the boundaries row's transcript), D-6282, D-6283, D-6284, D-6302, D-6306 (kept in `sourceQuiz`'s refactor), D-6309 (the rule) and D-5814 (the import pin), each bare. It ships one departure found while planning, **D-6468** (`history-w2-recheck-one-screen`), issued by the coordinator (R3). W2-D78(iii)(a) reads "redaction no longer leaves F_raw unchanged". Q21 rules the one `screenRedaction`, so a question can also refuse on F, a repo root, or F_raw inside its leaf. Because the leaf is re-mined, a source pruned or tombstoned after the freeze refuses at (a) with the mining word, not at (b). Its entry is in "Deviations found".

**Files:**
- Modify: `deploy/history-replay.mjs`:
  - `RECON_DISCARDS`' doc comment, whose third and fourth lines end `is kept LAST: an appending task` / `inserts before it. Counts, never refusals, and never a DRIVER_REASONS or GATE_REASONS word. */` (about :2627-2628 at c34f82830), gains one clause; the list's last line `  'body-unrenderable',` (about :2640) is preceded by `  'card-unrenderable',`;
  - `LEAF_OF_BOUNDARY_SQL` goes directly above the doc comment `/** The statements reconstruction reads with, prepared once per open. They read no body: bodies are read only through` (about :2689), and `replayStmts`' span statement line `      WHERE s.node_id = (SELECT node_id FROM nodes WHERE boundary_entry_id = ? AND depth = 0 ORDER BY node_id LIMIT 1)` (about :2706) reads it;
  - `SOURCE_FAILS`' doc comment `/** Why one source fails W2-D70, each word with the clause it belongs to. checkSource answers one of these, and W2-5b's` / ` *  re-check before an arm batch (W2-D78(iii)(b)) names the clause from it. */` (about :3690-3691) is reworded;
  - in `sourceQuiz`, the line `  const s = sourceStmts(rs.db);` (about :4612) goes, and the mining lines from `      const span = spanRowsOf(rs, b.entry_id);` to `      byBoundary.set(b.uuid, { row: b, spanEntryIds: span.rows.map((r) => Number(r.entry_id)) });` (about :4617-4629) call `mineStoredBoundary`;
  - a new section goes directly above the comment line `// The entry guard stays the LAST block of this file: a module-level declaration below it would still be uninitialised` (about :5796 at c34f82830; below Task 1's section and the `HANDLERS.set` lines).
- Modify: `server/test/history-replay.test.ts`: one import block (prefix `b1t2`) and one outer describe, appended at the end of the file (about :10678 at c34f82830, after Task 1's appended describes). In place, only if Step 5 finds a W2-5a case that pins the whole admission or discard count object as a literal: `'card-unrenderable': 0` added to it (R27). None does at c34f82830 (measured: W2-5a's count case derives its zero object from `RECON_DISCARDS`, and its literal discard counts, `{ 'body-unrenderable': 1 }` and `{ 'kept-absent': 2, 'post-over-cap': 1 }`, name only the words they count), so none is predicted.
- Not edited: `ccd/**` (lib's and recall.mjs's as-of exports are consumed as W2-2a and W2-2b merged them), `shared/**`, `deploy/history-gate.mjs`, `deploy/measure-history.py`, `.github/**`, README.md and the spec. `single-definition.test.ts` (O13, O14 and the W2-D33 block), `citations.test.ts`, `typecheck-tests.test.ts` and `lifecycle.test.ts` are re-run unedited (Step 7). No file is created.

**Interfaces:**
- Consumes (Task 1 of this plan, merged into its import statements; this task adds none):
  - `../ccd/history/lib.mjs`: `asOfBinds(cut): { asof_ts, asof_file, asof_line, asof_boundary, asof_summary, asof_kept }`; `asOfHiddenNodesSql(): string` (binds `asOfBinds(cut)` plus `:asof_nodes`, a JSON array; column `node_id`); `asOfVisibleEntriesSql(): string` (binds `asOfBinds(cut)` plus `:asof_entries`; column `entry_id`); `displayPrefixes(ids: string[]): Map<string, string>`; `cardLine({ leaf, parent = null }): string`, which throws a `TypeError` for any line `CARD_LINE_RE` refuses;
  - `../ccd/history/recall.mjs`: `asOfCutOf(rc, asof): { ok: true, cut: { asof, tsCut, boundaryEntryId, summaryEntryId, keptUuids, holdingFileId, boundaryLine } } | { ok: false, rc: 2, reason: 'asof-invalid' }`. It reads `rc.db` only, and reads kept(N) through derive.mjs's `keptOf`.
- Consumes (W2-5a, merged at c34f82830): `reconstructPayload(rs, boundaryEntryId, question)`, `composePayload(parts, question)`, `spanRowsOf(rs, boundaryEntryId)`, `boundaryCopyOf`, `keptMembersOf`, `mineBoundary(input)` (`MinedBoundary | DiscardedBoundary`), `screenRedaction(c, idx, memo = null)`, `answerability(db, idx, { tsMs, transcriptPk, spanEntryIds }, factRaw)` (`answerable`, `untimed` or `unanswerable`), `admitStoreBoundaries(rs)` (each row's `ts_ms` and `file_id`), `asofSameMsHits`, `familyScopeOf`, `openReplayStore`, `qidOf`, the module-private `reconDiscard`, `sourceStmts` and `replayStmts`, derive.mjs's `epochOfUuid`, recall.mjs's `expandEntryBody`, and `refuse`.
- Produces (`deploy/history-replay.mjs`, exported unless marked):
  - `'card-unrenderable'` in `RECON_DISCARDS`, at index 35, directly before `'body-unrenderable'`, which stays last;
  - `CARD_PARENTS = Object.freeze(['shown', 'none', 'hidden', 'several'])`;
  - `armCut(rs, boundaryUuid)`: `asOfCutOf(rs, boundaryUuid)`, answered unchanged; the driver's one call;
  - `cardOf(rs, boundaryEntryId, cut): { state: 'card', line: string, leafId: string, parentId: string | null, parent: CARD_PARENTS word } | { state: 'discard', why: 'leaf-absent' | 'card-unrenderable' }`, a `TypeError` when `cut.boundaryEntryId` is not `boundaryEntryId`;
  - `prependCard(line, payload): string`: `` `${line}\n\n${payload}` ``. Pure;
  - `armPayloads(rs, boundaryEntryId, question, cut): { state: 'payloads', plain: string, carded: string, card, counts } | { state: 'discard', why: RECON_DISCARDS word }`;
  - `mineStoredBoundary(rs, b: { entry_id, uuid, ts_ms, transcript_pk }, family: { ccrc_id, generation }, configDirs): { state: 'mined', mined: MinedBoundary, spanEntryIds: number[] } | { state: 'discard', why }`. `sourceQuiz` and the re-check both call it;
  - `recheckQuestion(rs, entry: FrozenEntry, { configDirs }): Promise<{ ok: true, boundaryEntryId: number, cut } | { ok: false, clause: 'a' | 'b' | 'c', why: string }>`;
  - `recheckBatch(rs, entries, { configDirs }): Promise<Map<qid, { ok: true, boundaryEntryId, cut }>>`. It refuses `quiz-unanswerable`, detail `<qid> clause (<a|b|c>) <why>` per failing question, joined by `; `, in batch order;
  - module-private: `LEAF_OF_BOUNDARY_SQL`, `ARM_STMTS`, `armStmts`.
- For Task 4 (the arm engine), the order per batch:
  1. `recheckBatch(rs, thisNodesBatch, { configDirs: rosterConfigDirs(readRoster(home).roster, home) })`, the dirs `quiz-source` mined with (R6);
  2. then `armPayloads(rs, v.boundaryEntryId, entry.question, v.cut)` per question, with the verdict's cut;
  3. a payload discard is answered before any spawn: Task 4 refuses `quiz-unanswerable` `<qid> payload <word>`.

**Spec:** §8.6 "The card line" (about :1830 at c34f82830), its grammar `CARD_LINE_PATTERN`; §10.2 "Two arms" (about :2692-2694): "the card line, which the driver prepends to the treatment prompt. The driver composes it from the store". W2-5b1 never edits the spec.

**Drifts against the decisions document, the scoping study and the code, measured at c34f82830:**

| Document says | Code at c34f82830 | Effect here |
|---|---|---|
| W2-D78(iii)(a): "redaction no longer leaves F_raw unchanged" | W2-5a's one screen is `screenRedaction` (F_raw, F, `repo_roots`, F_raw in its leaf; W2-D67 as W2-5a's R10 widened it), and `FROZEN_ENTRY_KEYS` carries no leaf | Q21 rules the one screen; (a) re-mines boundary N's candidate through `mineStoredBoundary`, factored out of `sourceQuiz` (D-6468) |
| `SOURCE_FAILS`' comment (about :3690): W2-5b's (iii)(b) "names the clause from it" | `answerability` folds a question's sources into `answerable`, `untimed` or `unanswerable`; Q21's (b) is "any answerable source" | (b) names answerability's word (`unanswerable`, `unanswerable-untimed`); the comment is reworded so it no longer promises a W2-D70 clause number |
| W2-D75: "`lib.cardLine({leaf, parent})` over boundary N's leaf" | `cardLine` takes display prefixes (`L`/`N` plus 6 to 20 lowercase hex) and throws on anything else | `displayPrefixes` over the family's whole node-id set (Q20); a `TypeError` on store data becomes `card-unrenderable` |
| W2-D75: "leaf N's parent", singular | `node_children`' key is `(node_id, child_id)`, so a leaf can have several depth-1 parents in a damaged store | several names none (`CARD_PARENTS`' `several`) |
| recall.mjs's `asOfCutOf` comment: "Only tests call it in W2-2a; W2-2b's env path sets rc.scope.cut from it" | It reads `rc.db` only | The driver passes its `ReplayStore` as `rc`, through `armCut` alone |
| W2-D38: the driver defines "as of N" by the same kept(N) membership | `asOfCutOf` reads kept(N) through `keptOf`, which folds NULL, a tombstone and a non-list to an empty set and keeps a mixed list's strings; the driver discards `kept-absent` and `kept-unreadable` (W2-D33, W2-D68) | C2 pins the readable case equal and the divergence as a CONTROL; `armPayloads` discards before any arm |
| W2-5a (R8): the same-millisecond count was computed with no lib predicate | Its T_N and holding file come from admission's row (`admitStoreBoundaries`), not from a cut | C1 pins both equal to `asOfCutOf`'s, and the counted set equal to lib's |
| scope.md B Task 2: "leaf N's node" | `replayStmts`' span statement (about :2706) spells the leaf rule inline | `LEAF_OF_BOUNDARY_SQL`, one spelling for the span reader and the card, pinned by the scan |

**Choices this task makes:**
- **The parent is the depth-1 node above leaf N, judged by lib alone.** `asOfHiddenNodesSql` is bound with the cut at N and the parent's id. Its node rule hides a parent when any leaf under it is hidden, whenever the parent was formed. It also applies the amended arms: a leaf's summary row, its stored summary blob, and a leafless condensed descendant. So no rule is spelled here. A leaf with no depth-1 parent names none (`none`).
- **Display prefixes over the family's whole node-id set** (`nodes.session_pk` of leaf N's node, plus the leaf and the parent, as `planCardPrediction` does with `card.mjs`'s family list), never over the ids the cut shows (Q20). A whole-family prefix is at least as long as the visible-set one, so it is unique in either scope. The card is never redacted: it holds two node ids and lib's constant command, and no stored field (W2-D54 governs stored fields; R5).
- **The plain payload is not touched.** `armPayloads` calls W2-5a's `reconstructPayload` once and never edits `composePayload`. The carded payload is built from the plain one, so the two can differ only in the card line and its blank line.
- **The cut is computed once per question.** `recheckQuestion` answers its cut, and `armPayloads` takes it. `cardOf` refuses a cut of another boundary as a defect.
- **(a) matches the re-mined candidate on kind, F and F_raw**, the first in mining order, the site dedupe kept (W2-D65). A boundary the store no longer holds is `boundary-absent`, and a frozen `boundary_uuid` that is not a lowercase UUID is `boundary-uuid-invalid`, checked first: it becomes the arm's `CCRC_RECALL_ASOF`, which Task 1's `spawnEnv` refuses as a `TypeError`, so a bad one is refused here, before any spawn, as data. A span or mining discard keeps its own `RECON_DISCARDS` word (`leaf-absent`, `span-tombstone`, and so on). A fact the boundary no longer yields is `fact-unmined`. The re-mine takes the roster's config dirs, as `quiz-source` did (R6). Clause (a) does not check that boundary N's family is still the frozen entry's: W2-D78 (i) checks the family (R7).
- **(b) uses boundary N's own `ts_ms`**, as `sourceQuiz` did. A NULL one is `boundary-untimed`: admission drops such a boundary, so only a changed store reaches it, and `checkSource` would otherwise throw.
- **(c) checks the frozen `source_entry_uuid`**: for a sidecar source, that is its linked row (W2-D73). A sidecar follows its entry (W2-D35), so the entry's visibility is the sidecar's. `asOfCutOf`'s own `asof-invalid` is (c)'s word (Q21). A uuid the store does not hold is `source-absent`.
- **Every question of a failing batch is named.** The detail lists each failing qid and its clause in batch order, so the operator rules on all of them at once. A batch holds at most 5 questions (Q3), so the line stays short.
- **`mineStoredBoundary` is `sourceQuiz`'s own mining, moved, not changed.** It keeps D-6306: a whole-boundary discard is counted once, and its partial site drops are not merged. The scan pins `mineBoundary` to one caller.

**Residuals, named:**
- (a) re-mines under the roster at re-check time. A frozen path fact that a config dir added after the freeze now covers refuses `fact-unmined`, which the operator rules on.
- C2's divergence stands. lib keeps `[]` (or a mixed list's strings) where the driver discards. It is harmless because `armPayloads` discards first. A lib change that makes `keptOf` fail closed reds the CONTROL, by design.
- The same-millisecond count still has its own SQL. C1 is what ties it to lib.

- [ ] **Step 1: Confirm Task 1's state and the anchors.** From the repository root:

```bash
git log --oneline -1 --grep='W2-5b1 Task 1'
for n in asOfBinds asOfHiddenNodesSql asOfVisibleEntriesSql cardLine displayPrefixes; do printf '%s ' "$n"; grep -cE "^import \{[^}]*\b$n\b[^}]*\} from '\.\./ccd/history/lib\.mjs';$" deploy/history-replay.mjs; done
grep -cE "^import \{[^}]*\basOfCutOf\b[^}]*\} from '\.\./ccd/history/recall\.mjs';$" deploy/history-replay.mjs
grep -c "^  'body-unrenderable',$" deploy/history-replay.mjs
grep -c '^/\*\* The statements reconstruction reads with, prepared once per open' deploy/history-replay.mjs
grep -c 'WHERE s.node_id = (SELECT node_id FROM nodes WHERE boundary_entry_id = ? AND depth = 0 ORDER BY node_id LIMIT 1)' deploy/history-replay.mjs
grep -c 're-check before an arm batch (W2-D78(iii)(b)) names the clause from it' deploy/history-replay.mjs
grep -c '^  const s = sourceStmts(rs.db);$' deploy/history-replay.mjs
grep -c '^      const span = spanRowsOf(rs, b.entry_id);$' deploy/history-replay.mjs
grep -c '^// The entry guard stays the LAST block of this file' deploy/history-replay.mjs
grep -cE '\b(armCut|cardOf|prependCard|armPayloads|mineStoredBoundary|recheckQuestion|recheckBatch|CARD_PARENTS|LEAF_OF_BOUNDARY_SQL)\b' deploy/history-replay.mjs
grep -c 'b1t2' server/test/history-replay.test.ts
```

Expected:
- Task 1's commit;
- `1` for each of the five lib names, and `1` for `asOfCutOf`;
- `1` for each of the seven anchors;
- `0` for the new names, and `0` for the prefix.

If a lib or recall.mjs name is missing, Task 1 did not import it. Add it inside that module's existing statement, in its code-unit order, and never add a second statement (W2-5a's R3 rule). For recall.mjs, also set `EXACT_NAMES['../ccd/history/recall.mjs']` in the import pin to the statement's braces, in this commit. Report the substitution. Before the first edit of each file, read `GET /api/claims?project=ccrc-pwa`.

- [ ] **Step 2: Write the failing tests.** Append at the end of `server/test/history-replay.test.ts`. This task's five describes nest inside one outer describe titled `W2-5b1 Task 2: the as-of pieces`; R9's prefix is met through that title, which vitest's full name of every case carries, so `-t 'W2-5b1 Task 2'` and Task 6's census by prefix (R22) select every case here:

```ts
// ── W2-5b1 Task 2: the as-of pieces (W2-D75, W2-D78(iii), W2-D38; rulings Q20, Q21, Q22) ─────────────────────────────
import { createHash as b1t2Hash } from 'node:crypto';
import { readFileSync as b1t2Read } from 'node:fs';
import { join as b1t2Join } from 'node:path';
import type { DatabaseSync as B1t2Db } from 'node:sqlite';
import { describe as b1t2describe, expect as b1t2expect, it as b1t2it } from 'vitest';
import * as b1t2Drv from '../../deploy/history-replay.mjs';
import * as b1t2LibMod from '../../ccd/history/lib.mjs';
import * as b1t2Gate from '../../deploy/history-gate.mjs';
import * as b1t2StoreMod from '../../ccd/history/store.mjs';
import * as b1t2SweepMod from '../../ccd/history/sweep.mjs';
import { mkTmp as b1t2MkTmp } from './tmpHelpers.js';
import { REPO as B1T2_REPO } from './historyHelpers.js';

type B1t2Cut = { asof: string; tsCut: number; boundaryEntryId: number; summaryEntryId: number | null; keptUuids: readonly string[]; holdingFileId: number; boundaryLine: number };
type B1t2Rs = { db: B1t2Db; storeId: string; idx: unknown; close(): void };
type B1t2Discard = { state: 'discard'; why: string };
type B1t2Card = { state: 'card'; line: string; leafId: string; parentId: string | null; parent: string };
type B1t2Entry = { boundary_uuid: string; ccrc_id: string; fact: string; fact_raw: string; generation: string; kind: string; qid: string;
  question: string; repo_roots: string[]; source_entry_uuid: string; store_id: string };
type B1t2Verdict = { ok: true; boundaryEntryId: number; cut: B1t2Cut } | { ok: false; clause: 'a' | 'b' | 'c'; why: string };
/** The exports this task adds, and the W2-5a ones it reads, typed for the test: the driver is JavaScript. */
interface B1t2Api {
  RECON_DISCARDS: readonly string[];
  DRIVER_REASONS: readonly string[];
  CARD_PARENTS: readonly string[];
  openReplayStore(home: string): B1t2Rs;
  admitStoreBoundaries(rs: B1t2Rs): { boundaries: Array<{ uuid: string; entry_id: number; ts_ms: number | null; file_id: number | null }> };
  boundaryCopyOf(rs: B1t2Rs, boundaryEntryId: number): { state: 'copy'; boundary: { kept_blob_id: number | null } } | B1t2Discard;
  keptMembersOf(rs: B1t2Rs, boundary: { kept_blob_id: number | null }): { state: 'kept'; uuids: string[] } | B1t2Discard;
  reconstructPayload(rs: B1t2Rs, boundaryEntryId: number, question: string): { state: 'payload'; text: string } | B1t2Discard;
  composePayload(parts: { summary: string; kept: readonly string[] }, question: string): string;
  familyScopeOf(db: B1t2Db, f: { ccrc_id: string; generation: string }): number[];
  asofSameMsHits(db: B1t2Db, ctx: { tsMs: number; holdingFileId: number; transcriptPks: number[] }, factRaw: string): number;
  answerability(db: B1t2Db, idx: unknown, ctx: { tsMs: number; transcriptPk: number; spanEntryIds: number[] }, factRaw: string): Promise<{ state: string }>;
  qidOf(e: { store_id: string; ccrc_id: string; generation: string; boundary_uuid: string; kind: string; fact: string }): string;
  armCut(rs: B1t2Rs, boundaryUuid: string): { ok: true; cut: B1t2Cut } | { ok: false; rc: number; reason: string };
  cardOf(rs: B1t2Rs, boundaryEntryId: number, cut: B1t2Cut): B1t2Card | B1t2Discard;
  prependCard(line: string, payload: string): string;
  armPayloads(rs: B1t2Rs, boundaryEntryId: number, question: string, cut: B1t2Cut):
    { state: 'payloads'; plain: string; carded: string; card: B1t2Card; counts: Record<string, number> } | B1t2Discard;
  recheckQuestion(rs: B1t2Rs, entry: B1t2Entry, ctx: { configDirs: readonly string[] }): Promise<B1t2Verdict>;
  recheckBatch(rs: B1t2Rs, entries: B1t2Entry[], ctx: { configDirs: readonly string[] }): Promise<Map<string, Extract<B1t2Verdict, { ok: true }>>>;
}
const B1T2 = b1t2Drv as unknown as B1t2Api;
const b1t2Lib = b1t2LibMod as unknown as {
  INDEXED_PROVENANCE: readonly string[];
  CARD_LINE_RE: RegExp;
  asOfBinds(cut: B1t2Cut): Record<string, string | number | null>;
  asOfHiddenNodesSql(): string;
  asOfVisibleEntriesSql(): string;
  displayPrefixes(ids: string[]): Map<string, string>;
  cardLine(o: { leaf: string; parent: string | null }): string;
  canonicalJson(v: unknown): string;
  sha256Hex(s: string): string;
  historyPaths(home: string): { dbFile: string };
  makePairIndex(pairs: Array<{ len: number; sha256: string }>): unknown;
  redactField(text: string, idx: unknown): string;
};
const b1t2Store = b1t2StoreMod as unknown as {
  createStore(home: string): void; openWriter(p: string): B1t2Db; closeWriter(db: B1t2Db): void; createFtsTables(db: B1t2Db): void;
  brotli(b: Buffer): Buffer; CODEC: string;
};
const b1t2Sweep = b1t2SweepMod as unknown as {
  ftsTextOfBlob(z: Uint8Array, isSidecar: boolean, idx: unknown, rawLen: number): Promise<{ text: string | null; overCap?: boolean }>;
  indexBlob(db: B1t2Db, blobId: number, text: string, idx: unknown, overCap?: boolean): void;
};

const B1T2_T = 1_760_000_000_000;              // T_N: boundary N's own ts_ms
const B1T2_T2 = B1T2_T + 60_000;               // T_N2: the next boundary's
const B1T2_UUID = (n: number): string => `b1720000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const B1T2_CC = B1T2_UUID(0xcc1);              // the family's one epoch's session uuid
const B1T2_GEN = B1T2_UUID(0x6e1);
const B1T2_FAM = 'fam-a';
const B1T2_MODEL = 'claude-fixture-4';
/** A value the store learns as a redaction pair after the freeze, assembled at runtime. */
const B1T2_VALUE = ['zq', 'b1t2', 'widened', 'pkg01'].join('');
const B1T2_CMD = `npm run fixture-card --workspace ${B1T2_VALUE}`;
const B1T2_SHA = '9c0ffee1';
const B1T2_PHRASE = 'zqsame52 marker';
const B1T2_QUESTION = 'Which npm command built the fixture card?';
const B1T2_DIRS = ['/home/u/.claude'];
const B1T2_ELL = String.fromCharCode(0x2026);
const B1T2_DOT = String.fromCharCode(0xb7);
/** The family's node ids: LN (N's leaf) and L2 (N2's) share a 9-character prefix; P is their depth-1 parent, formed after
 *  N; Q is a childless condensed node whose id shares 11 characters with P's. */
const B1T2_IDS = { LN: 'La1b2c3d4e5f6a7b8c9d0', L2: 'La1b2c3d4ff0011223344', P: 'N0f1e2d3c4b5a69788796', Q: 'N0f1e2d3c4b0000000000' };
/** A leaf id lib's card grammar refuses (uppercase hex): a damaged store's shape. */
const B1T2_BAD_LEAF = 'LA1B2C3D4E5F6A7B8C9D0';
const b1t2Text = (text: string): unknown[] => [{ type: 'text', text }];
/** p1 carries the span source's own command on purpose: a second blob holding the phrase is what once hid an unindexed
 *  source from the (b) case, because a rowid bound as a JS number is not applied by FTS5 (D-6479). */
const b1t2Bash = (id: string): unknown[] => [{ type: 'tool_use', id, name: 'Bash', input: { command: B1T2_CMD } }];
type B1t2RowSpec = { key: string; type: string; provenance: string; ts: number; body: unknown; files: number[]; model?: string; summary?: boolean };
/** Transcript 1's rows, in order. File 2 is the live copy and holds both boundaries; file 1 is a retired copy that also
 *  holds N, and alone holds the three same-millisecond rows outside N's holding copy. p1 sits after N in the holding copy,
 *  stamped before T_N (a backward clock step). Leaf N's span is a1 and r1; leaf N2's is a2. */
const B1T2_ROWS: B1t2RowSpec[] = [
  { key: 'u1', type: 'user', provenance: 'operator', ts: B1T2_T - 50_000, body: b1t2Text('build the fixture card'), files: [1, 2] },
  { key: 'a1', type: 'assistant', provenance: 'model', model: B1T2_MODEL, ts: B1T2_T - 40_000,
    body: [{ type: 'text', text: `at commit ${B1T2_SHA} now` }, { type: 'tool_use', id: 'toolu_b1t2a1', name: 'Bash', input: { command: B1T2_CMD } }], files: [1, 2] },
  { key: 'r1', type: 'user', provenance: 'tool', ts: B1T2_T - 30_000, body: [{ type: 'tool_result', tool_use_id: 'toolu_b1t2a1', content: 'card build ok' }], files: [1, 2] },
  { key: 'mIn', type: 'assistant', provenance: 'model', model: B1T2_MODEL, ts: B1T2_T, body: b1t2Text(`noted ${B1T2_PHRASE} inside`), files: [2] },
  { key: 'bn', type: 'system', provenance: 'harness', ts: B1T2_T, body: b1t2Text('compact boundary one'), files: [1, 2] },
  { key: 'sn', type: 'user', provenance: 'summary', summary: true, ts: B1T2_T + 10, body: b1t2Text('Summary: the fixture card build ran.'), files: [2] },
  { key: 'p1', type: 'assistant', provenance: 'model', model: B1T2_MODEL, ts: B1T2_T - 500, body: b1t2Bash('toolu_b1t2p1'), files: [2] },
  { key: 'mOutBefore', type: 'assistant', provenance: 'model', model: B1T2_MODEL, ts: B1T2_T - 1, body: b1t2Text(`noted ${B1T2_PHRASE} before`), files: [1] },
  { key: 'mOut', type: 'assistant', provenance: 'model', model: B1T2_MODEL, ts: B1T2_T, body: b1t2Text(`noted ${B1T2_PHRASE} at`), files: [1] },
  { key: 'mOutAfter', type: 'assistant', provenance: 'model', model: B1T2_MODEL, ts: B1T2_T + 1, body: b1t2Text(`noted ${B1T2_PHRASE} after`), files: [1] },
  { key: 'a2', type: 'assistant', provenance: 'model', model: B1T2_MODEL, ts: B1T2_T + 30_000, body: b1t2Text('second stretch of work'), files: [2] },
  { key: 'b2', type: 'system', provenance: 'harness', ts: B1T2_T2, body: b1t2Text('compact boundary two'), files: [2] },
  { key: 's2', type: 'user', provenance: 'summary', summary: true, ts: B1T2_T2 + 10, body: b1t2Text('Summary: the second stretch.'), files: [2] },
];
type B1t2Opts = {
  kept?: 'list' | 'null' | 'tombstone' | 'object' | 'mixed'; learn?: string[]; prune?: string[]; unindex?: string[];
  retime?: Record<string, number>; uncopy?: boolean; twoParents?: boolean; noParent?: boolean; noLeaf?: boolean; badLeaf?: boolean;
};
type B1t2Fx = { home: string; entry: Record<string, number>; blob: Record<string, number>; uuid: Record<string, string>; leaf: string };

/** A store made by store.mjs's createStore under a fresh mkTmp HOME, written through openWriter and closed: one family
 *  (fam-a, one confirmed epoch with cwd /home/u/tree), transcript 1 with B1T2_ROWS, both boundaries, their leaves, P and
 *  Q. Every row of an indexed provenance is indexed through the sweep's own functions under an empty pair index, as the
 *  freeze saw it. The options make the store changes each case reads:
 *  - `kept`: N's kept list is the default list (r1 twice and an unstored uuid), NULL, a tombstone, a JSON object, or a
 *    list holding a non-string;
 *  - `learn`: redaction pairs the store learned after the freeze (redact_hashes rows, which pairIndexOf reads);
 *  - `prune`, `unindex`, `retime`: a row's blob pruned, its index row deleted, or its ts_ms moved;
 *  - `uncopy`: no copy holds N; `noLeaf`: N has no leaf node; `badLeaf`: N's leaf id is B1T2_BAD_LEAF;
 *  - `noParent`: P has no children; `twoParents`: Q is also L2's depth-1 parent. */
async function b1t2Plant(o: B1t2Opts = {}): Promise<B1t2Fx> {
  const home = b1t2MkTmp('b1t2-store-');
  b1t2Store.createStore(home);
  const w = b1t2Store.openWriter(b1t2Lib.historyPaths(home).dbFile);
  b1t2Store.createFtsTables(w);
  const idx0 = b1t2Lib.makePairIndex([]);
  const fx: B1t2Fx = { home, entry: {}, blob: {}, uuid: {}, leaf: o.badLeaf === true ? B1T2_BAD_LEAF : B1T2_IDS.LN };
  w.prepare("INSERT INTO sessions (session_pk, ccrc_id, generation, project, first_seen_ms) VALUES (1, ?, ?, 'demo', 1)").run(B1T2_FAM, B1T2_GEN);
  w.prepare("INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, cwd, confirmed_ms) VALUES (1, 1, ?, 'startup', 'hook', '/home/u/tree', 1)").run(B1T2_CC);
  w.prepare('INSERT INTO transcripts (transcript_pk, cc_session_uuid) VALUES (1, ?)').run(B1T2_CC);
  const file = w.prepare("INSERT INTO ingest_files (file_id, dev, ino, source_key, transcript_pk, status, parser_version) VALUES (?, 1, ?, ?, 1, 'live', 1)");
  file.run(1, 7201, 'retired-fixture');
  file.run(2, 7202, '');
  const blobOf = (bytes: Buffer): number => Number((w.prepare('INSERT INTO blobs (sha256, codec, z, raw_len) VALUES (?, ?, ?, ?) RETURNING blob_id')
    .get(b1t2Hash('sha256').update(bytes).digest(), b1t2Store.CODEC, b1t2Store.brotli(bytes), bytes.length) as { blob_id: number | bigint }).blob_id);
  const ent = w.prepare(`INSERT INTO entries (uuid, transcript_pk, type, model, provenance, prov_version, struct_rank_ns, struct_file_id, blob_id, ts_ms,
      is_compact_summary) VALUES (?, 1, ?, ?, ?, 1, ?, 2, ?, ?, ?) RETURNING entry_id`);
  const member = w.prepare('INSERT INTO memberships (file_id, entry_id, line) VALUES (?, ?, ?)');
  const lines: Record<number, number> = { 1: 0, 2: 0 };
  for (const [i, r] of B1T2_ROWS.entries()) {
    const bytes = Buffer.from(b1t2Lib.canonicalJson(r.body));
    const blobId = blobOf(bytes);
    const uuid = B1T2_UUID(i + 1);
    const id = Number((ent.get(uuid, r.type, r.model ?? null, r.provenance, i, blobId, o.retime?.[r.key] ?? r.ts, r.summary === true ? 1 : 0) as { entry_id: number | bigint }).entry_id);
    for (const f of r.files) {
      lines[f] = lines[f]! + 1;
      if (!(o.uncopy === true && r.key === 'bn')) member.run(f, id, lines[f]!);
    }
    fx.entry[r.key] = id;
    fx.blob[r.key] = blobId;
    fx.uuid[r.key] = uuid;
    if (b1t2Lib.INDEXED_PROVENANCE.includes(r.provenance)) {
      const z = (w.prepare('SELECT z FROM blobs WHERE blob_id = ?').get(blobId) as { z: Uint8Array }).z;
      const t = await b1t2Sweep.ftsTextOfBlob(z, false, idx0, bytes.length);
      b1t2Sweep.indexBlob(w, blobId, t.text ?? '', idx0, t.overCap === true);
    }
  }
  const keptBodies: Record<string, unknown> = {
    list: [fx.uuid.r1, B1T2_UUID(0x999), fx.uuid.r1], tombstone: [fx.uuid.r1, 'tombstoned'], object: { kept: fx.uuid.r1 }, mixed: [fx.uuid.r1, 5],
  };
  const kept = o.kept ?? 'list';
  let keptId: number | null = null;
  if (kept !== 'null') {
    keptId = blobOf(Buffer.from(JSON.stringify(keptBodies[kept])));
    if (kept === 'tombstone') w.prepare('UPDATE blobs SET z = NULL, pruned_ms = 1 WHERE blob_id = ?').run(keptId);
  }
  const bnd = w.prepare('INSERT INTO boundaries (entry_id, transcript_pk, ord, anchor_uuid, kept_blob_id) VALUES (?, 1, ?, ?, ?)');
  bnd.run(fx.entry.bn!, 1, fx.uuid.sn!, keptId);
  bnd.run(fx.entry.b2!, 2, fx.uuid.s2!, null);
  const node = w.prepare(`INSERT INTO nodes (node_id, session_pk, epoch_seq, transcript_pk, kind, depth, status, summary_blob_id, boundary_entry_id,
      parser_version, created_ms) VALUES (?, 1, 1, 1, ?, ?, 'final', ?, ?, 1, ?)`);
  if (o.noLeaf !== true) node.run(fx.leaf, 'native_leaf', 0, fx.blob.sn!, fx.entry.bn!, B1T2_T + 100);
  node.run(B1T2_IDS.L2, 'native_leaf', 0, fx.blob.s2!, fx.entry.b2!, B1T2_T2 + 100);
  node.run(B1T2_IDS.P, 'condensed', 1, null, null, B1T2_T2 + 200);   // formed after N: its second leaf is N2's
  node.run(B1T2_IDS.Q, 'condensed', 1, null, null, 1);
  const source = w.prepare('INSERT INTO node_sources (node_id, entry_id, ord) VALUES (?, ?, ?)');
  if (o.noLeaf !== true) {
    source.run(fx.leaf, fx.entry.a1!, 0);
    source.run(fx.leaf, fx.entry.r1!, 1);
  }
  source.run(B1T2_IDS.L2, fx.entry.a2!, 0);
  const child = w.prepare('INSERT INTO node_children (node_id, child_id, ord) VALUES (?, ?, ?)');
  if (o.noParent !== true) {
    if (o.noLeaf !== true) child.run(B1T2_IDS.P, fx.leaf, 0);
    child.run(B1T2_IDS.P, B1T2_IDS.L2, 1);
  }
  if (o.twoParents === true) child.run(B1T2_IDS.Q, B1T2_IDS.L2, 0);
  for (const v of o.learn ?? []) {
    w.prepare('INSERT INTO redact_hashes (len, sha256, first_seen_ms) VALUES (?, ?, 1)').run(v.length, Buffer.from(b1t2Lib.sha256Hex(v), 'hex'));
  }
  for (const k of o.prune ?? []) w.prepare('UPDATE blobs SET z = NULL, pruned_ms = ? WHERE blob_id = ?').run(B1T2_T, fx.blob[k]!);
  for (const k of o.unindex ?? []) w.prepare('DELETE FROM blobs_fts WHERE rowid = ?').run(fx.blob[k]!);
  b1t2Store.closeWriter(w);
  return fx;
}
/** The driver's own store opener (W2-5a's openReplayStore: read-only, the pair index from the store and the HOME). */
async function b1t2With<R>(fx: B1t2Fx, fn: (rs: B1t2Rs) => Promise<R> | R): Promise<R> {
  const rs = B1T2.openReplayStore(fx.home);
  try { return await fn(rs); } finally { rs.close(); }
}
function b1t2CutAt(rs: B1t2Rs, uuid: string): B1t2Cut {
  const c = B1T2.armCut(rs, uuid);
  if (!c.ok) throw new Error(`fixture: no cut at ${uuid}: ${c.reason}`);
  return c.cut;
}
/** The frozen entry W2-5a's sourcing would write for the command fact at N (W2-D73's keys), with `over` applied. */
function b1t2Entry(fx: B1t2Fx, storeId: string, over: Partial<B1t2Entry> = {}): B1t2Entry {
  const key = { store_id: storeId, ccrc_id: B1T2_FAM, generation: B1T2_GEN, boundary_uuid: fx.uuid.bn!, kind: 'command', fact: B1T2_CMD, ...over };
  return { fact_raw: B1T2_CMD, question: B1T2_QUESTION, repo_roots: ['/home/u/tree'], source_entry_uuid: fx.uuid.a1!, ...key, qid: B1T2.qidOf(key), ...over } as B1t2Entry;
}
/** §8.6's grammar, written out here, not built from lib's constants. */
const b1t2Line = (leaf: string, parent: string | null): string =>
  `History: node ${leaf}${B1T2_ELL} (this compaction)${parent === null ? '' : ` ${B1T2_DOT} parent ${parent}${B1T2_ELL}`} ${B1T2_DOT} ~/.local/bin/ccrc history describe ${leaf}`;
const B1T2_LINE_N = b1t2Line('La1b2c3d4e', null);
const B1T2_LINE_N2 = b1t2Line('La1b2c3d4f', 'N0f1e2d3c4b5');
const b1t2Nums = (rows: unknown, col: string): number[] => (rows as Array<Record<string, number>>).map((r) => Number(r[col])).sort((a, b) => a - b);

b1t2describe('W2-5b1 Task 2: the as-of pieces', () => {
  b1t2describe('the card line (W2-D75, Q20)', () => {
    b1t2it('at N the card names leaf N and no parent: P has a leaf, N2, formed after N, so lib hides it (CONTROL: lib\'s own statement hides P)', async () => {
      const fx = await b1t2Plant();
      await b1t2With(fx, (rs) => {
        const cut = b1t2CutAt(rs, fx.uuid.bn!);
        b1t2expect(B1T2.cardOf(rs, fx.entry.bn!, cut)).toEqual({ state: 'card', line: B1T2_LINE_N, leafId: B1T2_IDS.LN, parentId: null, parent: 'hidden' });
        const hidden = rs.db.prepare(b1t2Lib.asOfHiddenNodesSql()).all({ ...b1t2Lib.asOfBinds(cut), asof_nodes: JSON.stringify([B1T2_IDS.P]) });
        b1t2expect((hidden as Array<{ node_id: string }>).map((r) => r.node_id), 'CONTROL: lib hides P under the cut at N').toEqual([B1T2_IDS.P]);
      });
    });

    b1t2it('at N2 the card names P: every leaf under it is visible under the cut at N2 (CONTROL for the case above)', async () => {
      const fx = await b1t2Plant();
      await b1t2With(fx, (rs) => {
        const card = B1T2.cardOf(rs, fx.entry.b2!, b1t2CutAt(rs, fx.uuid.b2!));
        b1t2expect(card).toEqual({ state: 'card', line: B1T2_LINE_N2, leafId: B1T2_IDS.L2, parentId: B1T2_IDS.P, parent: 'shown' });
        b1t2expect(b1t2Lib.CARD_LINE_RE.test((card as B1t2Card).line), 'lib\'s grammar takes the line').toBe(true);
      });
    });

    b1t2it('display prefixes run over the family\'s whole node-id set (Q20), so the leaf\'s is longer than over the card\'s own ids', async () => {
      const whole = b1t2Lib.displayPrefixes([B1T2_IDS.LN, B1T2_IDS.L2, B1T2_IDS.P, B1T2_IDS.Q]);
      b1t2expect([whole.get(B1T2_IDS.LN), whole.get(B1T2_IDS.P)]).toEqual(['La1b2c3d4e', 'N0f1e2d3c4b5']);
      b1t2expect(b1t2Lib.displayPrefixes([B1T2_IDS.LN, B1T2_IDS.P]).get(B1T2_IDS.LN), 'CONTROL: over the card\'s two ids alone').toBe('La1b2c3');
      const fx = await b1t2Plant();
      await b1t2With(fx, (rs) => {
        const card = B1T2.cardOf(rs, fx.entry.bn!, b1t2CutAt(rs, fx.uuid.bn!)) as B1t2Card;
        b1t2expect(card.line.startsWith(`History: node La1b2c3d4e${B1T2_ELL} `)).toBe(true);
      });
    });

    b1t2it('a leaf with two depth-1 parents names none (several), and one with none names none (none); CARD_PARENTS holds the four words', async () => {
      b1t2expect(Object.isFrozen(B1T2.CARD_PARENTS) && [...B1T2.CARD_PARENTS]).toEqual(['shown', 'none', 'hidden', 'several']);
      const two = await b1t2Plant({ twoParents: true });
      await b1t2With(two, (rs) => {
        b1t2expect(B1T2.cardOf(rs, two.entry.b2!, b1t2CutAt(rs, two.uuid.b2!)))
          .toEqual({ state: 'card', line: b1t2Line('La1b2c3d4f', null), leafId: B1T2_IDS.L2, parentId: null, parent: 'several' });
      });
      const none = await b1t2Plant({ noParent: true });
      await b1t2With(none, (rs) => {
        b1t2expect(B1T2.cardOf(rs, none.entry.bn!, b1t2CutAt(rs, none.uuid.bn!)))
          .toEqual({ state: 'card', line: B1T2_LINE_N, leafId: B1T2_IDS.LN, parentId: null, parent: 'none' });
      });
    });

    b1t2it('store data never throws (D-6309\'s rule): no leaf for N is leaf-absent, and a leaf id lib\'s grammar refuses is card-unrenderable (CONTROL: lib\'s cardLine throws on it)', async () => {
      b1t2expect(() => b1t2Lib.cardLine({ leaf: 'LA1B2C3', parent: null })).toThrow(TypeError);
      const noLeaf = await b1t2Plant({ noLeaf: true });
      await b1t2With(noLeaf, (rs) => {
        const cut = b1t2CutAt(rs, noLeaf.uuid.bn!);
        b1t2expect(B1T2.cardOf(rs, noLeaf.entry.bn!, cut)).toEqual({ state: 'discard', why: 'leaf-absent' });
        b1t2expect(B1T2.armPayloads(rs, noLeaf.entry.bn!, B1T2_QUESTION, cut)).toEqual({ state: 'discard', why: 'leaf-absent' });
      });
      const bad = await b1t2Plant({ badLeaf: true });
      await b1t2With(bad, (rs) => {
        b1t2expect(B1T2.cardOf(rs, bad.entry.bn!, b1t2CutAt(rs, bad.uuid.bn!))).toEqual({ state: 'discard', why: 'card-unrenderable' });
      });
    });

    b1t2it('a cut of another boundary is the caller\'s defect: a TypeError, never a discard', async () => {
      const fx = await b1t2Plant();
      await b1t2With(fx, (rs) => {
        b1t2expect(() => B1T2.cardOf(rs, fx.entry.bn!, b1t2CutAt(rs, fx.uuid.b2!))).toThrow(TypeError);
      });
    });
  });

  b1t2describe('the payloads (Q20; spec 10.2 Two arms)', () => {
    b1t2it('the plain payload is W2-5a\'s composer output byte for byte, and the carded one is the card line, one blank line, then that same text', async () => {
      const fx = await b1t2Plant();
      await b1t2With(fx, (rs) => {
        const cut = b1t2CutAt(rs, fx.uuid.bn!);
        const want = B1T2.composePayload({ summary: 'Summary: the fixture card build ran.', kept: ['[tool_result] card build ok'] }, B1T2_QUESTION);
        b1t2expect(B1T2.reconstructPayload(rs, fx.entry.bn!, B1T2_QUESTION), 'CONTROL: W2-5a\'s reconstruction').toMatchObject({ state: 'payload', text: want });
        const p = B1T2.armPayloads(rs, fx.entry.bn!, B1T2_QUESTION, cut);
        if (p.state !== 'payloads') throw new Error(`fixture: payloads discarded ${p.why}`);
        b1t2expect(p.plain).toBe(want);
        b1t2expect(p.carded).toBe(`${B1T2_LINE_N}\n\n${want}`);
        b1t2expect(p.card).toEqual(B1T2.cardOf(rs, fx.entry.bn!, cut));
        b1t2expect(B1T2.prependCard('line', 'payload')).toBe('line\n\npayload');
      });
    });

    b1t2it('no line of the plain payload is a card line; the carded payload\'s first line is one, and its second is empty', async () => {
      const fx = await b1t2Plant();
      await b1t2With(fx, (rs) => {
        const p = B1T2.armPayloads(rs, fx.entry.bn!, B1T2_QUESTION, b1t2CutAt(rs, fx.uuid.bn!));
        if (p.state !== 'payloads') throw new Error(`fixture: payloads discarded ${p.why}`);
        b1t2expect(p.plain.split('\n').filter((l) => b1t2Lib.CARD_LINE_RE.test(l))).toEqual([]);
        const [first, second] = p.carded.split('\n');
        b1t2expect([b1t2Lib.CARD_LINE_RE.test(first!), second]).toEqual([true, '']);
      });
    });
  });

  b1t2describe('the re-check before every arm batch (W2-D78(iii), Q21)', () => {
    b1t2it('CONTROL: a question re-checks clean on the store it was sourced from, and its verdict carries the cut the payloads take', async () => {
      const fx = await b1t2Plant();
      await b1t2With(fx, async (rs) => {
        const v = await B1T2.recheckQuestion(rs, b1t2Entry(fx, rs.storeId), { configDirs: B1T2_DIRS });
        b1t2expect(v).toEqual({ ok: true, boundaryEntryId: fx.entry.bn, cut: b1t2CutAt(rs, fx.uuid.bn!) });
        if (!v.ok) return;
        b1t2expect(B1T2.armPayloads(rs, v.boundaryEntryId, B1T2_QUESTION, v.cut).state).toBe('payloads');
      });
    });

    b1t2it('(a): a pair the store learned after the freeze masks F_raw, so the question fails redact-fact (CONTROL: that pair masks the command)', async () => {
      const pair = { len: B1T2_VALUE.length, sha256: b1t2Lib.sha256Hex(B1T2_VALUE) };
      b1t2expect(b1t2Lib.redactField(B1T2_CMD, b1t2Lib.makePairIndex([pair])), 'CONTROL').not.toContain(B1T2_VALUE);
      const fx = await b1t2Plant({ learn: [B1T2_VALUE] });
      await b1t2With(fx, async (rs) => {
        b1t2expect(await B1T2.recheckQuestion(rs, b1t2Entry(fx, rs.storeId), { configDirs: B1T2_DIRS })).toEqual({ ok: false, clause: 'a', why: 'redact-fact' });
      });
    });

    b1t2it('(a) comes first: a source pruned after the freeze fails the re-mine, span-tombstone, though (b) fails too (CONTROL: answerability alone answers unanswerable)', async () => {
      const fx = await b1t2Plant({ prune: ['a1'] });
      await b1t2With(fx, async (rs) => {
        b1t2expect(await B1T2.recheckQuestion(rs, b1t2Entry(fx, rs.storeId), { configDirs: B1T2_DIRS })).toEqual({ ok: false, clause: 'a', why: 'span-tombstone' });
        const a = await B1T2.answerability(rs.db, rs.idx, { tsMs: B1T2_T, transcriptPk: 1, spanEntryIds: [fx.entry.a1!, fx.entry.r1!] }, B1T2_CMD);
        b1t2expect(a.state, 'CONTROL').toBe('unanswerable');
      });
    });

    b1t2it('(a): a frozen fact boundary N no longer yields is fact-unmined, and a boundary uuid the store does not hold is boundary-absent', async () => {
      const fx = await b1t2Plant();
      const gone = 'npm run fixture-gone --workspace pkg-z';
      await b1t2With(fx, async (rs) => {
        b1t2expect(await B1T2.recheckQuestion(rs, b1t2Entry(fx, rs.storeId, { fact: gone, fact_raw: gone }), { configDirs: B1T2_DIRS }))
          .toEqual({ ok: false, clause: 'a', why: 'fact-unmined' });
        b1t2expect(await B1T2.recheckQuestion(rs, b1t2Entry(fx, rs.storeId, { boundary_uuid: B1T2_UUID(0x997) }), { configDirs: B1T2_DIRS }))
          .toEqual({ ok: false, clause: 'a', why: 'boundary-absent' });
        // W2-D50: a frozen uuid that is not a lowercase UUID is data, refused here, never spawnEnv's TypeError after --out.
        b1t2expect(await B1T2.recheckQuestion(rs, b1t2Entry(fx, rs.storeId, { boundary_uuid: B1T2_UUID(0xabc).toUpperCase() }), { configDirs: B1T2_DIRS }))
          .toEqual({ ok: false, clause: 'a', why: 'boundary-uuid-invalid' });
      });
    });

    b1t2it('(b): the source\'s index row gone is unanswerable, and its stamp moved past T_N is unanswerable-untimed (W2-D70, D-5780)', async () => {
      const unindexed = await b1t2Plant({ unindex: ['a1'] });
      await b1t2With(unindexed, async (rs) => {
        b1t2expect(await B1T2.recheckQuestion(rs, b1t2Entry(unindexed, rs.storeId), { configDirs: B1T2_DIRS })).toEqual({ ok: false, clause: 'b', why: 'unanswerable' });
      });
      const late = await b1t2Plant({ retime: { a1: B1T2_T + 5 } });
      await b1t2With(late, async (rs) => {
        b1t2expect(await B1T2.recheckQuestion(rs, b1t2Entry(late, rs.storeId), { configDirs: B1T2_DIRS })).toEqual({ ok: false, clause: 'b', why: 'unanswerable-untimed' });
      });
    });

    b1t2it('(c): a frozen source in N\'s holding copy after N, stamped before T_N, is hidden by lib\'s cut (source-hidden; CONTROL: its stamp alone would show it)', async () => {
      const fx = await b1t2Plant();
      await b1t2With(fx, async (rs) => {
        const cut = b1t2CutAt(rs, fx.uuid.bn!);
        const p1 = rs.db.prepare('SELECT e.ts_ms AS ts, m.line AS line FROM entries e JOIN memberships m ON m.entry_id = e.entry_id AND m.file_id = ? WHERE e.entry_id = ?')
          .get(cut.holdingFileId, fx.entry.p1!) as { ts: number; line: number };
        b1t2expect(p1.ts, 'CONTROL: stamped before T_N').toBeLessThan(cut.tsCut);
        b1t2expect(p1.line, 'CONTROL: after N in N\'s holding copy').toBeGreaterThan(cut.boundaryLine);
        b1t2expect(await B1T2.recheckQuestion(rs, b1t2Entry(fx, rs.storeId, { source_entry_uuid: fx.uuid.p1! }), { configDirs: B1T2_DIRS }))
          .toEqual({ ok: false, clause: 'c', why: 'source-hidden' });
      });
    });

    b1t2it('(c): no copy holds N, so asOfCutOf answers asof-invalid, which is clause (c); a source uuid the store does not hold is source-absent', async () => {
      const uncopied = await b1t2Plant({ uncopy: true });
      await b1t2With(uncopied, async (rs) => {
        b1t2expect(B1T2.armCut(rs, uncopied.uuid.bn!), 'CONTROL: the store half refuses').toMatchObject({ ok: false, reason: 'asof-invalid' });
        b1t2expect(await B1T2.recheckQuestion(rs, b1t2Entry(uncopied, rs.storeId), { configDirs: B1T2_DIRS })).toEqual({ ok: false, clause: 'c', why: 'asof-invalid' });
      });
      const fx = await b1t2Plant();
      await b1t2With(fx, async (rs) => {
        b1t2expect(await B1T2.recheckQuestion(rs, b1t2Entry(fx, rs.storeId, { source_entry_uuid: B1T2_UUID(0x998) }), { configDirs: B1T2_DIRS }))
          .toEqual({ ok: false, clause: 'c', why: 'source-absent' });
      });
    });

    b1t2it('recheckBatch refuses quiz-unanswerable naming every failing qid and its clause, in batch order; a clean batch answers each qid\'s verdict', async () => {
      const fx = await b1t2Plant();
      await b1t2With(fx, async (rs) => {
        const gone = 'npm run fixture-gone --workspace pkg-z';
        const good = b1t2Entry(fx, rs.storeId);
        const sha = b1t2Entry(fx, rs.storeId, { kind: 'sha', fact: B1T2_SHA, fact_raw: B1T2_SHA });
        const unmined = b1t2Entry(fx, rs.storeId, { fact: gone, fact_raw: gone });
        const shaHidden = b1t2Entry(fx, rs.storeId, { kind: 'sha', fact: B1T2_SHA, fact_raw: B1T2_SHA, source_entry_uuid: fx.uuid.p1! });
        await b1t2expect(B1T2.recheckBatch(rs, [good, unmined, shaHidden], { configDirs: B1T2_DIRS })).rejects.toMatchObject({
          word: 'quiz-unanswerable', detail: `${unmined.qid} clause (a) fact-unmined; ${shaHidden.qid} clause (c) source-hidden`,
        });
        const clean = await B1T2.recheckBatch(rs, [good, sha], { configDirs: B1T2_DIRS });
        const cut = b1t2CutAt(rs, fx.uuid.bn!);
        b1t2expect([...clean.entries()]).toEqual([[good.qid, { ok: true, boundaryEntryId: fx.entry.bn, cut }], [sha.qid, { ok: true, boundaryEntryId: fx.entry.bn, cut }]]);
      });
    });

    b1t2it('a question of another store is the caller\'s defect: a TypeError, never a refusal', async () => {
      const fx = await b1t2Plant();
      await b1t2With(fx, async (rs) => {
        await b1t2expect(B1T2.recheckQuestion(rs, b1t2Entry(fx, 'another-store'), { configDirs: B1T2_DIRS })).rejects.toThrow(TypeError);
      });
    });
  });

  b1t2describe('the parity pins against lib\'s cut (the ledger\'s R8 carry, Q22)', () => {
    b1t2it('C1: the same-millisecond count reads asOfCutOf\'s T_N and holding file, and counts exactly the entries lib\'s cut shows at T_N outside that file', async () => {
      const fx = await b1t2Plant();
      await b1t2With(fx, (rs) => {
        const row = B1T2.admitStoreBoundaries(rs).boundaries.find((b) => b.uuid === fx.uuid.bn)!;
        const cut = b1t2CutAt(rs, fx.uuid.bn!);
        b1t2expect({ tsMs: row.ts_ms, holdingFileId: row.file_id }).toEqual({ tsMs: cut.tsCut, holdingFileId: cut.holdingFileId });
        b1t2expect(cut, 'CONTROL: T_N is N\'s own stamp, and the live file 2 holds N beside the retired file 1').toMatchObject({ tsCut: B1T2_T, holdingFileId: 2 });
        const planted = ['mIn', 'mOutBefore', 'mOut', 'mOutAfter'].map((k) => fx.entry[k]!);
        const shown = b1t2Nums(rs.db.prepare(b1t2Lib.asOfVisibleEntriesSql()).all({ ...b1t2Lib.asOfBinds(cut), asof_entries: JSON.stringify(planted) }), 'entry_id');
        b1t2expect(shown, 'CONTROL: lib shows the hits stamped at or before T_N, before N in the holding copy or in another copy, and hides the one after')
          .toEqual([fx.entry.mIn!, fx.entry.mOutBefore!, fx.entry.mOut!].sort((a, b) => a - b));
        const sameMsOutside = b1t2Nums(rs.db.prepare(`SELECT e.entry_id AS entry_id FROM entries e WHERE e.entry_id IN (SELECT value FROM json_each(?))
            AND e.ts_ms = ? AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.file_id = ? AND m.entry_id = e.entry_id)`)
          .all(JSON.stringify(planted), cut.tsCut, cut.holdingFileId), 'entry_id');
        const lib = sameMsOutside.filter((id) => shown.includes(id));
        b1t2expect(lib).toEqual([fx.entry.mOut]);
        const scope = B1T2.familyScopeOf(rs.db, { ccrc_id: B1T2_FAM, generation: B1T2_GEN });
        b1t2expect(B1T2.asofSameMsHits(rs.db, { tsMs: row.ts_ms!, holdingFileId: row.file_id!, transcriptPks: scope }, B1T2_PHRASE)).toBe(lib.length);
      });
    });

    b1t2it('C2: on a readable kept list the driver\'s kept(N) members are the set asOfCutOf keeps', async () => {
      const fx = await b1t2Plant();
      await b1t2With(fx, (rs) => {
        const copy = B1T2.boundaryCopyOf(rs, fx.entry.bn!);
        if (copy.state !== 'copy') throw new Error(`fixture: N answered ${copy.why}`);
        const k = B1T2.keptMembersOf(rs, copy.boundary);
        if (k.state !== 'kept') throw new Error(`fixture: kept(N) answered ${k.why}`);
        b1t2expect(k.uuids, 'CONTROL: the stored list repeats r1 and names a uuid the store does not hold').toEqual([fx.uuid.r1, B1T2_UUID(0x999)]);
        b1t2expect([...k.uuids].sort()).toEqual([...b1t2CutAt(rs, fx.uuid.bn!).keptUuids]);
      });
    });

    b1t2it.each([
      ['null', 'kept-absent', false], ['tombstone', 'kept-unreadable', false], ['object', 'kept-unreadable', false], ['mixed', 'kept-unreadable', true],
    ] as Array<[NonNullable<B1t2Opts['kept']>, string, boolean]>)('C2 CONTROL: a kept list that is %s: the driver discards N as %s while asOfCutOf keeps the strings it can read, and the payloads never reach an arm', async (kept, word, keepsR1) => {
      const fx = await b1t2Plant({ kept });
      await b1t2With(fx, (rs) => {
        const copy = B1T2.boundaryCopyOf(rs, fx.entry.bn!);
        if (copy.state !== 'copy') throw new Error(`fixture: N answered ${copy.why}`);
        b1t2expect(B1T2.keptMembersOf(rs, copy.boundary)).toEqual({ state: 'discard', why: word });
        const cut = b1t2CutAt(rs, fx.uuid.bn!);
        b1t2expect([...cut.keptUuids]).toEqual(keepsR1 ? [fx.uuid.r1] : []);
        b1t2expect(B1T2.armPayloads(rs, fx.entry.bn!, B1T2_QUESTION, cut)).toEqual({ state: 'discard', why: word });
      });
    });
  });

  b1t2describe('one spelling each (W2-D38, W2-D12, S2)', () => {
    b1t2it('RECON_DISCARDS gains card-unrenderable directly before body-unrenderable, which stays last, and it is no DRIVER_REASONS or GATE_REASONS word (W2-5a R5)', () => {
      b1t2expect(B1T2.RECON_DISCARDS.slice(35)).toEqual(['card-unrenderable', 'body-unrenderable']);
      b1t2expect(new Set(B1T2.RECON_DISCARDS).size).toBe(B1T2.RECON_DISCARDS.length);
      b1t2expect(B1T2.DRIVER_REASONS.includes('card-unrenderable') || (b1t2Gate.GATE_REASONS as readonly string[]).includes('card-unrenderable')).toBe(false);
    });

    b1t2it('the driver calls asOfCutOf, cardLine, displayPrefixes, lib\'s node and entry statements and mineBoundary on one code line each, spells leaf N\'s node rule once, and never splices asOfEntrySql, composes R8 or reads card.mjs', () => {
      const code = b1t2Read(b1t2Join(B1T2_REPO, 'deploy', 'history-replay.mjs'), 'utf8').split('\n').filter((l) => !/^\s*(?:\/\/|\*|\/\*)/.test(l));
      const lines = (re: RegExp): string[] => code.filter((l) => re.test(l));
      for (const re of [/\basOfCutOf\(/, /\bcardLine\(/, /\bdisplayPrefixes\(/, /\basOfHiddenNodesSql\(\)/, /\basOfVisibleEntriesSql\(\)/,
        /(?<!function )\bmineBoundary\(/, /boundary_entry_id = \? AND depth = 0/]) {
        b1t2expect(lines(re), String(re)).toHaveLength(1);
      }
      b1t2expect(lines(/\basOfEntrySql\b|\bcutHidesASource\b|\blineageEntries\b|card\.mjs/)).toEqual([]);
    });
  });
});
```

- [ ] **Step 3: Run them and see them fail (predicted).** In the foreground, with a timeout of at least 600000 ms:

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-5b1 Task 2: the as-of pieces'
```

Expected: 25 selected, 24 failed and 1 passed, and no collection error (measured at Task 2: the case "a cut of another boundary is the caller's defect" expects a `TypeError`, and `B1T2.cardOf is not a function` is one, so it passes vacuously on the unguarded code; T2-M22 below measures its guard). `b1t2Plant` uses only lib, store.mjs and sweep.mjs, so the fixture builds. Each case fails at its first new export:
- `armCut`, `cardOf`, `armPayloads`, `recheckQuestion`, `recheckBatch` and `prependCard` throw `TypeError: … is not a function`;
- the `CARD_PARENTS` case reads `undefined`;
- the `RECON_DISCARDS` case reads `['body-unrenderable']`;
- the scan finds 0 lines for `asOfCutOf(`, `cardLine(`, `displayPrefixes(` and the two lib statements, and 1 for each of the other two patterns.

A case that fails for any other reason is the fixture's to fix before Step 4.

- [ ] **Step 4: Edit the driver.** Each replacement matches exactly once (Step 1 counted the anchors).

(a) In `RECON_DISCARDS`' doc comment, replace

```js
 *  (D-6302, a body that parses and cannot be rendered; mining discards with it too, D-6303) is kept LAST: an appending task
 *  inserts before it. Counts, never refusals, and never a DRIVER_REASONS or GATE_REASONS word. */
```

with

```js
 *  (D-6302, a body that parses and cannot be rendered; mining discards with it too, D-6303) is kept LAST: an appending task
 *  inserts before it, as W2-5b1 Task 2 inserts `card-unrenderable` (a node id the store holds that lib's card grammar
 *  refuses). Counts, never refusals, and never a DRIVER_REASONS or GATE_REASONS word. */
```

and in the list, replace

```js
  'body-unrenderable',
]);
```

with

```js
  'card-unrenderable',
  'body-unrenderable',
]);
```

(b) Directly above `/** The statements reconstruction reads with, prepared once per open. They read no body: bodies are read only through`, insert

```js
/** Leaf N's node id, for boundary N's entry id (one `?`): the depth-0 node whose boundary_entry_id is N, the lowest id if
 *  several are (derivation writes one). The span reader and the card (W2-5b1 Task 2) read leaf N through this one text. */
const LEAF_OF_BOUNDARY_SQL = 'SELECT node_id FROM nodes WHERE boundary_entry_id = ? AND depth = 0 ORDER BY node_id LIMIT 1';

```

and in `replayStmts`' span statement, replace

```js
      WHERE s.node_id = (SELECT node_id FROM nodes WHERE boundary_entry_id = ? AND depth = 0 ORDER BY node_id LIMIT 1)
```

with

```js
      WHERE s.node_id = (${LEAF_OF_BOUNDARY_SQL})
```

(c) Replace `SOURCE_FAILS`' doc comment

```js
/** Why one source fails W2-D70, each word with the clause it belongs to. checkSource answers one of these, and W2-5b's
 *  re-check before an arm batch (W2-D78(iii)(b)) names the clause from it. */
```

with

```js
/** Why one source fails W2-D70, each word with the clause it belongs to. checkSource answers one of these. W2-5b1's
 *  re-check before an arm batch (W2-D78(iii)(b), ruling Q21: any answerable source) reads answerability, which folds a
 *  question's sources to answerable, untimed or unanswerable, and names that word, not a clause number. */
```

(d) In `sourceQuiz`, delete the line `  const s = sourceStmts(rs.db);` and replace

```js
      const span = spanRowsOf(rs, b.entry_id);
      if (span.state !== 'span') { discard(span.why); continue; }
      const t = s.transcript.get(b.transcript_pk);
      const ep = t === undefined ? null : epochOfUuid(rs.db, t.cc_session_uuid);
      const e = ep === null ? undefined : s.epoch.get(ep.session_pk, ep.seq);
      const m = mineBoundary({
        storeId, ccrcId: fam.ccrc_id, generation: fam.generation, boundaryUuid: b.uuid, boundaryTsMs: b.ts_ms, rows: span.rows,
        pick: (row) => expandEntryBody(rs, row), cwd: e?.cwd ?? null, cwdReal: e?.cwd_real ?? null, configDirs,
      });
      // D-6306: a boundary discarded whole is counted once, under counts.discards; its partial site drops are not merged.
      if (m.state !== 'mined') { discard(m.why); continue; }
      for (const [w, n] of Object.entries(m.counts)) counts.mined[w] += n;
      byBoundary.set(b.uuid, { row: b, spanEntryIds: span.rows.map((r) => Number(r.entry_id)) });
```

with

```js
      const got = mineStoredBoundary(rs, b, fam, configDirs);
      // D-6306: a boundary discarded whole is counted once, under counts.discards; its partial site drops are not merged.
      if (got.state !== 'mined') { discard(got.why); continue; }
      const m = got.mined;
      for (const [w, n] of Object.entries(m.counts)) counts.mined[w] += n;
      byBoundary.set(b.uuid, { row: b, spanEntryIds: got.spanEntryIds });
```

Then check that `sourceQuiz` names no `s.` statement any more (`grep -n 's\.transcript\|s\.epoch' deploy/history-replay.mjs` lists only `mineStoredBoundary`'s two lines after (e)).

(e) Directly above `// The entry guard stays the LAST block of this file: a module-level declaration below it would still be uninitialised`, insert

```js
// ── W2-5b1 Task 2: the as-of pieces: the card line, the two payloads and the re-check (W2-D75, W2-D78(iii), W2-D38) ──
// Every as-of decision here is lib's own (W2-D38), never a second spelling: the cut at boundary N is recall.mjs's
// asOfCutOf over this run's read-only handle, called on one line (armCut); a node is hidden by lib's asOfHiddenNodesSql
// (W2-D35 as amended: D-6282, D-6283, D-6284), and an entry is visible by lib's asOfVisibleEntriesSql, each bound with
// lib's asOfBinds. R8's ref rule answers another question (does describe drop a node's refs) and is never composed here
// (ruling S2).
// The card line (W2-D75; spec §8.6): lib's cardLine over leaf N's node (LEAF_OF_BOUNDARY_SQL, the node spanRowsOf reads)
// and its depth-1 parent, named only when lib does not hide it under the cut at N, so the card never names a node that
// answers exit 3 under the arm's own cut. A leaf with several depth-1 parents names none (fail closed). Both print as
// lib's displayPrefixes over the family's whole node-id set (ruling Q20), as the sweep's card does.
// The payloads (ruling Q20; spec §10.2 "Two arms": the driver prepends the card): the plain payload is W2-5a's
// reconstructPayload text, byte for byte; the carded one is the card line, one blank line, then that same text.
// The re-check before every arm batch (W2-D78(iii), ruling Q21), each question in batch order, its first failing clause
// named: (a) the one redaction screen, screenRedaction, over the question's candidate re-mined from the store through
// mineStoredBoundary (sourceQuiz's own mining: a frozen entry carries no leaf); (b) W2-D70 over leaf N's span, any
// source (answerability); (c) the frozen source_entry_uuid visible under the cut at boundary_uuid, the cut's own
// asof-invalid included. A batch with any failure refuses quiz-unanswerable, naming every failing qid and its clause: a
// frozen question is never dropped silently.
// A failure on store data is a RECON_DISCARDS word or a clause, never a throw (D-6309's rule: a data case after --out
// never exits INTERNAL); a caller's defect (a cut of another boundary, a question of another store) is a TypeError.

/** Where the card's parent stands (W2-D75): named (`shown`), no depth-1 parent (`none`), hidden under the cut at N
 *  (`hidden`), or several depth-1 parents, a damaged store's shape, so none is named (`several`). A report word, never a
 *  refusal. */
export const CARD_PARENTS = Object.freeze(['shown', 'none', 'hidden', 'several']);

const ARM_STMTS = new WeakMap();
/** The reads this section makes, prepared once per handle: lib's node and entry statements, and the boundary, entry and
 *  node reads the card and the re-check add. The boundary's transcript is the boundaries row's (D-6281). */
function armStmts(db) {
  let s = ARM_STMTS.get(db);
  if (s !== undefined) return s;
  s = {
    boundary: db.prepare(`SELECT b.entry_id AS entry_id, e.uuid AS uuid, e.ts_ms AS ts_ms, b.transcript_pk AS transcript_pk
      FROM boundaries b JOIN entries e ON e.entry_id = b.entry_id WHERE e.uuid = ?`),
    entryId: db.prepare('SELECT entry_id FROM entries WHERE uuid = ?'),
    leaf: db.prepare(`SELECT node_id, session_pk FROM nodes WHERE node_id = (${LEAF_OF_BOUNDARY_SQL})`),
    parents: db.prepare(`SELECT c.node_id AS node_id FROM node_children c JOIN nodes p ON p.node_id = c.node_id
      WHERE c.child_id = ? AND p.depth = 1 ORDER BY c.node_id`),
    family: db.prepare('SELECT node_id FROM nodes WHERE session_pk = ? ORDER BY node_id'),
    hidden: db.prepare(asOfHiddenNodesSql()),
    visible: db.prepare(asOfVisibleEntriesSql()),
  };
  ARM_STMTS.set(db, s);
  return s;
}

/** The cut at boundary N (W2-D38): recall.mjs's asOfCutOf over this run's read-only handle (it reads `rc.db` only),
 *  answered unchanged: `{ ok: true, cut }`, or `{ ok: false, rc, reason: 'asof-invalid' }` (D-5765's store half). The
 *  driver's one call.
 *  @param {ReplayStore} rs  @param {string} boundaryUuid */
export function armCut(rs, boundaryUuid) {
  return asOfCutOf(rs, boundaryUuid);
}

/** Boundary N's card line (W2-D75; spec §8.6), under `cut`, the cut at N: lib's cardLine over leaf N's node and its
 *  depth-1 parent, the parent only when lib's asOfHiddenNodesSql does not hide it (CARD_PARENTS says where it stands),
 *  both as displayPrefixes over the family's whole node-id set (ruling Q20). No leaf node for N is `leaf-absent`; an id
 *  lib's grammar refuses is `card-unrenderable`. A cut of another boundary is the caller's defect.
 *  @param {ReplayStore} rs  @param {number} boundaryEntryId  @param {{ boundaryEntryId: number }} cut
 *  @returns {{ state: 'card', line: string, leafId: string, parentId: string | null, parent: string }
 *    | { state: 'discard', why: 'leaf-absent' | 'card-unrenderable' }} */
export function cardOf(rs, boundaryEntryId, cut) {
  if (cut.boundaryEntryId !== Number(boundaryEntryId)) {
    throw new TypeError(`cardOf: the cut is boundary entry ${String(cut.boundaryEntryId)}'s, not ${String(boundaryEntryId)}'s`);
  }
  const s = armStmts(rs.db);
  const leaf = s.leaf.get(boundaryEntryId);
  if (leaf === undefined) return reconDiscard('leaf-absent');
  const parents = s.parents.all(leaf.node_id).map((r) => String(r.node_id));
  let parent = 'none';
  let parentId = null;
  if (parents.length > 1) parent = 'several';
  else if (parents.length === 1) {
    const hidden = s.hidden.all({ ...asOfBinds(cut), asof_nodes: JSON.stringify(parents) }).length > 0;
    parent = hidden ? 'hidden' : 'shown';
    if (!hidden) parentId = parents[0];
  }
  const family = s.family.all(leaf.session_pk).map((r) => String(r.node_id));
  const shown = displayPrefixes([...family, String(leaf.node_id), ...(parentId === null ? [] : [parentId])]);
  let line;
  try {
    line = cardLine({ leaf: shown.get(String(leaf.node_id)), parent: parentId === null ? null : shown.get(parentId) });
  } catch (e) {
    if (e instanceof TypeError) return reconDiscard('card-unrenderable');
    throw e;
  }
  return { state: 'card', line, leafId: String(leaf.node_id), parentId, parent };
}

/** The carded payload (ruling Q20; spec §10.2 "Two arms"): the card line, one blank line, then the plain payload,
 *  unchanged. Pure.
 *  @param {string} line  @param {string} payload  @returns {string} */
export function prependCard(line, payload) {
  return `${line}\n\n${payload}`;
}

/** Boundary N's two payloads for one question (W2-D75; ruling Q20): `plain`, W2-5a's reconstructPayload text unchanged,
 *  and `carded`, prependCard over the card line and `plain`. A reconstruction or card discard answers its RECON_DISCARDS
 *  word, which the arm engine answers before any spawn. `cut` is the cut at N: armCut's, or recheckQuestion's verdict's.
 *  @param {ReplayStore} rs  @param {number} boundaryEntryId  @param {string} question  @param {{ boundaryEntryId: number }} cut */
export function armPayloads(rs, boundaryEntryId, question, cut) {
  const p = reconstructPayload(rs, boundaryEntryId, question);
  if (p.state !== 'payload') return p;
  const card = cardOf(rs, boundaryEntryId, cut);
  if (card.state !== 'card') return card;
  return { state: 'payloads', plain: p.text, carded: prependCard(card.line, p.text), card, counts: p.counts };
}

/** Boundary N's candidates mined from the store (W2-D65): leaf N's span (spanRowsOf), N's epoch's cwd and cwd_real (the
 *  path facts' base, through derive.mjs's epochOfUuid), and mineBoundary over expand's own body pick (W2-D74). The one
 *  composition sourceQuiz and the arm-batch re-check share. A span or mining discard answers its RECON_DISCARDS word.
 *  @param {ReplayStore} rs
 *  @param {{ entry_id: number, uuid: string, ts_ms: number | null, transcript_pk: number }} b  boundary N
 *  @param {{ ccrc_id: string, generation: string }} family
 *  @param {readonly string[]} configDirs  the roster's config dirs (rosterConfigDirs)
 *  @returns {{ state: 'mined', mined: MinedBoundary, spanEntryIds: number[] } | { state: 'discard', why: string }} */
export function mineStoredBoundary(rs, b, family, configDirs) {
  const span = spanRowsOf(rs, b.entry_id);
  if (span.state !== 'span') return span;
  const s = sourceStmts(rs.db);
  const t = s.transcript.get(b.transcript_pk);
  const ep = t === undefined ? null : epochOfUuid(rs.db, t.cc_session_uuid);
  const e = ep === null ? undefined : s.epoch.get(ep.session_pk, ep.seq);
  const m = mineBoundary({
    storeId: rs.storeId, ccrcId: family.ccrc_id, generation: family.generation, boundaryUuid: b.uuid, boundaryTsMs: b.ts_ms,
    rows: span.rows, pick: (row) => expandEntryBody(rs, row), cwd: e?.cwd ?? null, cwdReal: e?.cwd_real ?? null, configDirs,
  });
  if (m.state !== 'mined') return reconDiscard(m.why);
  return { state: 'mined', mined: m, spanEntryIds: span.rows.map((r) => Number(r.entry_id)) };
}

/** W2-D78(iii) for one frozen question (ruling Q21), its clauses in order, the first that fails answered:
 *  (a) boundary N's candidate, re-mined (mineStoredBoundary) and matched on kind, F and F_raw, passes screenRedaction
 *      under the run's pair index: `why` is the screen's word, a span or mining discard's word, `boundary-uuid-invalid`
 *      (a frozen uuid that is not a lowercase UUID), `boundary-absent` or `fact-unmined`;
 *  (b) some source in leaf N's span passes W2-D70's four clauses at N's own ts_ms (answerability): `unanswerable`,
 *      `unanswerable-untimed` (clause 4 alone, D-5780) or `boundary-untimed`;
 *  (c) the frozen source_entry_uuid is visible under the cut at boundary_uuid (armCut, then lib's asOfVisibleEntriesSql;
 *      a sidecar source is its linked row, W2-D35): the cut's own `asof-invalid`, `source-absent` or `source-hidden`.
 *  A clean question answers N's entry id and the cut, which armPayloads takes. A question of another store is a defect.
 *  @param {ReplayStore} rs  @param {FrozenEntry} entry  @param {{ configDirs: readonly string[] }} ctx
 *  @returns {Promise<{ ok: true, boundaryEntryId: number, cut: object } | { ok: false, clause: 'a' | 'b' | 'c', why: string }>} */
export async function recheckQuestion(rs, entry, { configDirs }) {
  if (entry.store_id !== rs.storeId) {
    throw new TypeError(`recheckQuestion: question ${String(entry.qid)} is store ${String(entry.store_id)}'s, not this store's`);
  }
  const s = armStmts(rs.db);
  const fail = (clause, why) => ({ ok: false, clause, why });
  // W2-D50: boundary N's uuid becomes the arm's CCRC_RECALL_ASOF, which spawnEnv refuses as a defect unless UUID_RE
  // holds; a frozen uuid that is not one is data, answered here before any spawn, never a TypeError after --out.
  if (typeof entry.boundary_uuid !== 'string' || !UUID_RE.test(entry.boundary_uuid)) return fail('a', 'boundary-uuid-invalid');
  const row = s.boundary.get(entry.boundary_uuid);
  if (row === undefined) return fail('a', 'boundary-absent');
  const b = { entry_id: Number(row.entry_id), uuid: row.uuid, ts_ms: row.ts_ms === null ? null : Number(row.ts_ms), transcript_pk: Number(row.transcript_pk) };
  const got = mineStoredBoundary(rs, b, entry, configDirs);
  if (got.state !== 'mined') return fail('a', got.why);
  const c = got.mined.candidates.find((x) => x.kind === entry.kind && x.fact === entry.fact && x.fact_raw === entry.fact_raw);
  if (c === undefined) return fail('a', 'fact-unmined');
  const screened = screenRedaction(c, rs.idx);
  if (screened !== null) return fail('a', screened);
  if (b.ts_ms === null) return fail('b', 'boundary-untimed');
  const a = await answerability(rs.db, rs.idx, { tsMs: b.ts_ms, transcriptPk: b.transcript_pk, spanEntryIds: got.spanEntryIds }, entry.fact_raw);
  if (a.state !== 'answerable') return fail('b', a.state === 'untimed' ? 'unanswerable-untimed' : 'unanswerable');
  const cut = armCut(rs, entry.boundary_uuid);
  if (!cut.ok) return fail('c', cut.reason);
  const src = s.entryId.get(entry.source_entry_uuid);
  if (src === undefined) return fail('c', 'source-absent');
  const visible = s.visible.all({ ...asOfBinds(cut.cut), asof_entries: JSON.stringify([Number(src.entry_id)]) });
  if (visible.length === 0) return fail('c', 'source-hidden');
  return { ok: true, boundaryEntryId: b.entry_id, cut: cut.cut };
}

/** W2-D78(iii) over one batch's questions, in batch order (ruling Q21). Every question is re-checked; when any fails, the
 *  batch refuses quiz-unanswerable before any spawn, naming each failing qid and its clause (`<qid> clause (<a|b|c>)
 *  <why>`, joined by `; `). A clean batch answers each question's verdict by qid. It reads only, and spawns nothing.
 *  @param {ReplayStore} rs  @param {readonly FrozenEntry[]} entries  @param {{ configDirs: readonly string[] }} ctx
 *  @returns {Promise<Map<string, { ok: true, boundaryEntryId: number, cut: object }>>} */
export async function recheckBatch(rs, entries, ctx) {
  const passed = new Map();
  const failed = [];
  for (const e of entries) {
    const v = await recheckQuestion(rs, e, ctx);
    if (v.ok) passed.set(e.qid, v);
    else failed.push(`${e.qid} clause (${v.clause}) ${v.why}`);
  }
  if (failed.length > 0) refuse('quiz-unanswerable', failed.join('; '));
  return passed;
}

```

No import statement changes here: Task 1's statements already hold `asOfBinds`, `asOfHiddenNodesSql`, `asOfVisibleEntriesSql`, `cardLine`, `displayPrefixes` and `asOfCutOf` (Step 1). The section's comments put no arm word in quotes or backticks, and no code line names the headless marker (O13).

- [ ] **Step 5: Run them and see them pass, then run the whole file.** In the foreground, with a timeout of at least 600000 ms:

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-5b1 Task 2: the as-of pieces'
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts
```

Expected:
- the first command: 25 passed once D-6479's fix is in (measured: with the p1 fixture sharing the span source's command, as written above, the (b) case's unindexed source stayed answerable on W2-5a's code, because a rowid bound as a JS number is not applied by FTS5, so the statement answered any row the phrase matches; D-6479 fixes the lookup and adds its own describe, so the first command then selects 29 cases, 29 passed);
- the second: every case passes, W2-5a's `sourceQuiz` describe included. That describe runs the refactored mining over a real sweep's store, so D-6306's discard count and the `sha-short` drop are re-measured.

Two corrections are allowed. Each changes the test file in this task's commit, and the prediction it corrects is recorded in this plan's text by a separate `docs(plan): … (W2-5b1 Task 2)` commit touching only this plan (R25):
- If the payload case reds only on the expected summary or kept rendering, read `reconstructPayload`'s text for the fixture and correct the two literals (`'Summary: the fixture card build ran.'`, `'[tool_result] card build ok'`). Never touch the composer.
- If a W2-5a case pins the full admission or discard count object literally, add `'card-unrenderable': 0` to it. This is the one in-place edit of a W2-5a case R27 licenses for this task: record the case's title for Step 9's commit and the PR body, and edit nothing else in it.

- [ ] **Step 6: Measure every new guard red, then green.** Copy the driver to `.superpowers/sdd/history-w2-5b1/scratch/task2.orig.mjs` (gitignored; never `git stash`). Apply each mutant below with Edit to `deploy/history-replay.mjs`: one exact replacement, which must match once. Then run its filter in the foreground:

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-5b1 Task 2: the as-of pieces'
```

Confirm that the named case(s) red, and record each red case's name in the task's report. Then restore with `cp .superpowers/sdd/history-w2-5b1/scratch/task2.orig.mjs deploy/history-replay.mjs`, check it with `cmp`, and go to the next.

| # | Mutation in `deploy/history-replay.mjs` | Must red |
|---|---|---|
| T2-M1 | in `cardOf`, `    parent = hidden ? 'hidden' : 'shown';` + `    if (!hidden) parentId = parents[0];` → `    parent = 'shown';` + `    parentId = parents[0];` (W2-D75's CONTROL) | "at N the card names leaf N and no parent …" (measured: and the first payload case, which builds the card at N) |
| T2-M2 | `displayPrefixes([...family, String(leaf.node_id), …])` → `displayPrefixes([String(leaf.node_id), …])` (the card's own ids only) | "at N …", "at N2 …", "display prefixes run over the family's whole node-id set …" (measured 5 red: those three, "a leaf with two depth-1 parents …" and the first payload case) |
| T2-M3 | `  if (parents.length > 1) parent = 'several';` + `  else if (parents.length === 1) {` → `  if (parents.length >= 1) {` | "a leaf with two depth-1 parents names none …" |
| T2-M4 | delete `  if (leaf === undefined) return reconDiscard('leaf-absent');` | "store data never throws …" (a `TypeError` escapes) |
| T2-M5 | the `let line; try { … } catch (e) { … }` block → `  const line = cardLine({ leaf: shown.get(String(leaf.node_id)), parent: parentId === null ? null : shown.get(parentId) });` | "store data never throws …" (its card-unrenderable half) |
| T2-M6 | in `prependCard`, `` `${line}\n\n${payload}` `` → `` `${line}\n${payload}` `` | both payload cases |
| T2-M7 | in `armPayloads`, `plain: p.text,` → `plain: prependCard(card.line, p.text),` | both payload cases |
| T2-M8 | delete `  const screened = screenRedaction(c, rs.idx);` and `  if (screened !== null) return fail('a', screened);` | "(a): a pair the store learned after the freeze …" (answers clause (b) or ok) |
| T2-M9 | `  if (got.state !== 'mined') return fail('a', got.why);` → `  if (got.state !== 'mined') return fail('b', 'unanswerable');` | "(a) comes first: a source pruned after the freeze …" |
| T2-M10 | delete `  if (a.state !== 'answerable') return fail('b', a.state === 'untimed' ? 'unanswerable-untimed' : 'unanswerable');` | "(b): the source's index row gone …" (both halves answer ok) |
| T2-M11 | `s.visible.all({ ...asOfBinds(cut.cut), asof_entries` → `s.visible.all({ ...asOfBinds({ ...cut.cut, holdingFileId: -1 }), asof_entries` (a cut with no positional hide; W2-D78's "cut mutant" CONTROL) | "(c): a frozen source in N's holding copy after N …", and the batch case |
| T2-M12 | `  if (!cut.ok) return fail('c', cut.reason);` → `  if (!cut.ok) return { ok: true, boundaryEntryId: b.entry_id, cut: null };` | "(c): no copy holds N …" |
| T2-M13 | in `recheckBatch`, the line `else failed.push(…);` → `else refuse('quiz-unanswerable', …);` with the same template literal as its argument (the first failure only) | "recheckBatch refuses quiz-unanswerable naming every failing qid …" |
| T2-M14 | `  if (failed.length > 0) refuse('quiz-unanswerable', failed.join('; '));` → `  void failed;` (a silent drop) | the same |
| T2-M15 | delete the `if (entry.store_id !== rs.storeId) { … }` block | "a question of another store is the caller's defect …" |
| T2-M16 | `x.kind === entry.kind && x.fact === entry.fact && x.fact_raw === entry.fact_raw` → `x.kind === entry.kind` | "(a): a frozen fact boundary N no longer yields is fact-unmined …", and the batch case |
| T2-M17 | delete the line `  'card-unrenderable',` from `RECON_DISCARDS` | "RECON_DISCARDS gains card-unrenderable …" |
| T2-M18 | insert `function b1t2Second(i) { return mineBoundary(i); }` directly above `export function mineStoredBoundary(` | "the driver calls asOfCutOf, cardLine, …" |
| T2-M19 | insert `function b1t2Splice() { return asOfEntrySql('e'); }` directly above `export function armCut(` | the same |
| T2-M20 | in `replayStmts`, `WHERE s.node_id = (${LEAF_OF_BOUNDARY_SQL})` → `WHERE s.node_id = (SELECT node_id FROM nodes WHERE boundary_entry_id = ? AND depth = 0 ORDER BY node_id LIMIT 1)` | the same |
| T2-M21 | delete `  if (typeof entry.boundary_uuid !== 'string' \|\| !UUID_RE.test(entry.boundary_uuid)) return fail('a', 'boundary-uuid-invalid');` (W2-D50's ASOF reaches spawnEnv unchecked) | "(a): a frozen fact boundary N no longer yields is fact-unmined …" (answers `boundary-absent`) |
| P-M1 | in `SAME_MS_SQL`, `  WHERE e.ts_ms = :t` → `  WHERE e.ts_ms <= :t` | "C1: the same-millisecond count …" (counts 2: mOutBefore and mOut) |
| P-M2 | delete `SAME_MS_SQL`'s `    AND NOT EXISTS (SELECT 1 FROM memberships mb WHERE mb.file_id = :hold AND mb.entry_id = e.entry_id)` line, closing the template literal after the line before it, and delete `hold: ctx.holdingFileId,` from the bound object (W2-5a's M15 shape) | "C1 …" (counts 2: mIn and mOut) |
| P-M3 | in `boundaryCopyOf`, `  const holding = holdingCopyOf(rs.db, { entry_id: boundary.entry_id, transcript_pk: boundary.transcript_pk });` → `  const holding = rs.db.prepare('SELECT min(file_id) AS file_id FROM memberships WHERE entry_id = ?').get(boundary.entry_id);` (the first copy, never lib's pick) | "C1 …" (admission's file 1 against the cut's file 2) |
| P-M4 | in `admissionStmts`' `boundaries: db.prepare(` line (anchor on the unique prefix `boundaries: db.prepare(\`SELECT b.entry_id AS entry_id, e.uuid AS uuid, e.ts_ms AS ts_ms,`: `e.ts_ms AS ts_ms` alone matches 4 times after this task, 3 at the base), `e.ts_ms AS ts_ms` → `(SELECT max(x.ts_ms) FROM entries x WHERE x.transcript_pk = b.transcript_pk) AS ts_ms` | "C1 …" (T_N is the transcript's newest stamp) |
| K-M1 | in `keptMembersOf`, `uuids: [...new Set(v)] };` → `uuids: [...new Set(v)].slice(1) };` | "C2: on a readable kept list …" |
| K-M2 | in `keptMembersOf`, `  if (!Array.isArray(v) \|\| !v.every((x) => typeof x === 'string')) return reconDiscard('kept-unreadable');` → `  if (!Array.isArray(v)) return { state: 'kept', uuids: [] };` (the fold W2-D33 forbids) | "C2 CONTROL: a kept list that is tombstone …", "… object …" and "… mixed …" |

P-M1 to P-M4 and K-M1 to K-M2 also red W2-5a cases. That is expected: the parity pins must red on the same faults.

Measured at Task 2 (the Task 2 filter): every row above reds the case(s) it names, `cmp` printing nothing after each restore. Differences from the table: T2-M1 and T2-M2 also red the payload case (above); T2-M3 to T2-M5, T2-M8 to T2-M10 and T2-M12 to T2-M21 red exactly the case named; T2-M6 and T2-M7 red both payload cases; T2-M11 reds the (c) case and the batch case; T2-M16 the fact-unmined case and the batch case. P-M1 and P-M2 counted 2 against 1; P-M3 reds nine cases of the filter, C1 among them (the cut's holding file 2 against admission's file 1); P-M4 read T_N 1760000060010 (the transcript's newest stamp) against 1760000000000; K-M1 reds "C2: on a readable kept list …" and the first payload case (the kept rendering); K-M2 reds the tombstone, object and mixed C2 CONTROLs (3), not the null one. One mutant is added, T2-M22: in `cardOf`, delete the `if (cut.boundaryEntryId !== Number(boundaryEntryId)) { throw new TypeError(…); }` block; it reds "a cut of another boundary is the caller's defect …".

- [ ] **Step 7: Run the neighbours that read these files.** In the foreground, with a timeout of at least 600000 ms. A red file is re-run alone before it is called a break (CLAUDE.md's load flakes):

```bash
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts
cd server && ./node_modules/.bin/vitest run test/citations.test.ts
cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts
```

Expected, all green:
- O13 finds no switch path, no marker path and no recall-off writer in the new section;
- O14 finds no `VOCABS` name declared. `CARD_PARENTS` is a driver-local report list;
- the W2-D33 block finds no `keptOf` on a driver code line. The section's comments name it, and the block reads code lines only;
- citations finds no added `.mjs:N` citation;
- the test file typechecks;
- `lifecycle.test.ts` still imports the driver.

- [ ] **Step 8: The whole history-replay file once more, in the foreground, with a timeout of at least 600000 ms.** Every task's cases must pass at this commit:

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts
```

- [ ] **Step 9: Commit.** Only this task's two paths:

```bash
git add deploy/history-replay.mjs server/test/history-replay.test.ts
CO_AUTHORED_BY='<the Co-Authored-By line the attribution reminder gives>'
git commit -m "feat(history-replay): the card line, the two payloads and the per-question re-check, with the parity pins against lib's cut (W2-5b1 Task 2; W2-D75, W2-D78(iii), W2-D38; D-6468)" -m "$CO_AUTHORED_BY"
```

If Step 5 made the count-literal edit, the commit carries one more `-m` before `"$CO_AUTHORED_BY"`, naming it (R27): `-m "In place (R27): 'card-unrenderable': 0 added to W2-5a's case '<its title>', which pins the whole count object; no W2-5a W2-D24 re-check case is edited."`. With no such edit, the command above stands, and the PR body says none was needed.

**Deviations found:** D-6468 is defined in this plan's `## Deviations found`; this task section is the first that cites it.

**How the tests stay off the live fleet.**
- Every store is a hand-built `createStore` under a `mkTmp` HOME, written through `openWriter` and read through the driver's own `openReplayStore`. The per-case fixture removal (`removeTmpFixturesEachTest`, already armed at the top of the file) removes each one.
- No case runs a sweep pass, a CLI verb or the shim, and none spawns a process. No `claude`, `ccrc` or `gh` is reached, so W2-4's stub and poisoned-`gh` contract is not needed here. Task 4 pins the stub's log absent for the refusal this task's `recheckBatch` makes.
- No roster, `~/.ccrc`, `~/.cc-sessions` or account home is read. `pairIndexOf` reads the fixture HOME's (absent) secret files and the store's own `redact_hashes`.
- The only paths are synthetic: `/home/u/tree` and `/home/u/.claude`. The learned redaction value is assembled at runtime. The card's ellipsis and middle dot are `String.fromCharCode(0x2026)` and `String.fromCharCode(0xb7)`. The family id is `fam-a`, and model ids are synthetic.
- The describes need no darwin skip: nothing here spawns or runs the sweep.

### Task 3: marker, verify --section pilot|quiz, and the headless-on reader the arm preflight asks (W2-D84, W2-D76, W2-D78 (i), W2-D24; D-5781)

This task ships W2-D84's second half: the `marker` subcommand and `verify`'s headless-on sections. It also ships the one reader of the headless-on marker in the driver, which Task 4's arm preflight asks for W2-D78 (i). It adds one subcommand to `HANDLERS` (four forms in all) and no flag:
- **`marker --record <draft|final> --section pilot|quiz|ab --node-label <label>`** (W2-D84, W2-D76; D-5781). It prints one node's text on stdout and `sha256 <hex>` of exactly those bytes on stderr. It reads the record and nothing else, opens no store, spawns nothing and writes nothing:
  - `pilot`, from part 1: the headless-on marker listing exactly part 1's `pilot.families` on that node's store. D-5781 (W2-3's number, defined in the W2-3 plan's "Deviations found") rules that during the pilot the marker lists the pilot families, not the quiz's. W2-5b2 amends erratum E21 in place, citing it (S1). This task ships the subcommand.
  - `quiz`, from part 2: the marker listing exactly part 2's `quiz.families` on that node's store.
  - `ab`, from part 2: one `ccrc history recall-off <id> --generation <G>` line per control family on that node's store. The generation is always printed, because the W2 flow writes no legacy control file (W2-D27).
- **`verify --section pilot|quiz`** (W2-D84). It runs read-only on a node and refuses unless the local store is one of the record's nodes. It reads the marker's bytes once and compares their sha256 with the sha256 of the text `marker` prints for this store. It reports every other answer as its own state, never folded. `--section quiz` also counts the leaves lib's node rule hides under a stated all-visible cut: D-6284's over-hide on this node, measured read-only (Q16; the ledger's W2-2a carry).
- **`requireListed(home, storeId, families)`**, W2-D78 (i)'s refusal. It reads the marker through the same reader, parses it with lib's `parseHeadlessList`, and refuses `family-unlisted` unless the marker's store line is this store and every (ccrc_id, generation) of the batch is a listed pair. Task 4 composes it into the arm batch's preflight, where its refusal is pinned with the stub's log absent.

**W2-D24's re-check.** `marker` and `verify --section pilot|quiz` are on W2-D24's list of W2-5b's `--record` consumers. Each calls `recheckCode` (W2-5a Task 7's) right after the record validates, before it computes or reads anything else. Neither declares `--allow-code-change`: Q23 grants it only to arms, judge and report.

**No `--out`.** Neither subcommand writes, so W2-5a's R10 order (a refusal that needs no store and no spawn answers before `--out`) has nothing to order. `marker` opens no store at all. `verify` opens one, through W2-5a's `openReplayStore`, and maps a store failure to `store-unreadable` (W2-5a's `storeRefusal`), never to an internal error (D-6309's rule for data cases).

**Files:**
- Modify: `deploy/history-replay.mjs`.
  - (a) `SUBCOMMAND_FLAGS` (about :4811 at c34f82830) gains five forms, directly after the line that begins `  'verify --section ab': {` (about :4822): `marker --section pilot`, `marker --section quiz`, `marker --section ab`, `verify --section pilot` and `verify --section quiz`.
  - (b) `verifyCommand` (about :5781): its doc comment (about :5780) and its ab-only line, `  if (flags.section !== 'ab') refuse('args-invalid', \`section ${JSON.stringify(flags.section)}: this build verifies ab only\`);` (about :5785), are replaced. The ab and `--registry` branches stay as they are.
  - (c) The lib import statement (`from '../ccd/history/lib.mjs'`, about :37) is Task 1's. Step 1 checks that it holds every name this task reads. A name it lacks is added to that one statement in code-unit order (Step 6). lib.mjs has no `EXACT_NAMES` entry (D-5814), so no pin moves.
  - (d) One new section, `// ── W2-5b1 Task 3: marker, verify --section pilot|quiz, and the headless-on reader`, goes directly above the comment line `// The entry guard stays the LAST block of this file` (about :5796) and after Task 2's section. It ends with `HANDLERS.set('marker', markerCommand);`.
- Modify: `server/test/history-replay.test.ts`.
  - Re-pin W2-4 Task 9's registration line, `    expect([...t9Driver.HANDLERS.keys()]).toEqual(['step0a', 'probe', 'pilot-source', 'quiz-source', 'freeze', 'power', 'open', 'verify']);` (about :4824), and the two comment lines above it.
  - Re-pin one line of W2-5a Task 7's case `open wants exactly one mode, and verify exactly one of --registry and --section ab` (about :9244), an in-place edit of a W2-5a case that R27 licenses (the new `verify` sections retire its `ab only` answer) and Step 11's commit names: `    r7expect(run7(null, null, ['verify', '--section', 'quiz']).stderr).toBe(refusalLine('args-invalid', 'section "quiz": this build verifies ab only'));` (about :9249).
  - Add one import statement directly after `import { REPO as R7_REPO, scrubbedEnv as r7Scrubbed } from './historyHelpers.js';` (about :8932).
  - Add one nested describe, `W2-5b1 Task 3: marker and verify section pilot and quiz`, inside W2-5a Task 7's outer describe (`r7describe('W2-5a Task 7: the record subcommands', () => {`, about :8934). It goes directly before that describe's closing `});` (about :10502), after `W2-5a Task 7: verify section ab` and after Task 1's nested `W2-5b1 Task 1: loadFinalRecord, …` (R9, in task order). It nests so that it can use W2-5a's signed fixtures (`chain7`'s draft, final and frozen list; `home7`, `run7`, `tree7`, `snapshot7`).
- Not edited: `ccd/**`, `shared/**`, `deploy/history-gate.mjs`, `deploy/measure-history.py`, `.github/**`, README.md, the spec, and every other test file. `single-definition.test.ts` (O13 and O14) and `typecheck-tests.test.ts` are re-run, never edited. This task creates no file.

**Interfaces:**
- Consumes (W2-2b, `ccd/history/lib.mjs`, merged before W2-5b1 dispatches; never edited):
  - `HEADLESS_LIST_MAX_BYTES` (65,536).
  - `parseHeadlessList(text: string): { ok: true, storeId: string, pairs: readonly { ccrcId: string, generation: string }[] } | { ok: false, rc: 2, reason: 'headless-malformed' }`. The answer is frozen. Pairs are in file order with duplicates kept, `generation` is `''` for `-`, and zero pairs parse ok.
  - `formatHeadlessList({ storeId, pairs }): string`. It is the one producer of marker text. It throws `TypeError` for a grammar fault (a store id that is not a lowercase UUID, an id `idOk` refuses or spelled `store`, a bad generation) and `RangeError` for a bound (more than 1,000 pairs, or more than 65,536 bytes). For every list it accepts, `parseHeadlessList(formatHeadlessList(x))` deep-equals `{ ok: true, ...x }`.
  - Not consumed: `headlessMarkerOf`. It folds `unreadable` and `over-cap` into one word, and W2-D84 forbids folding them ("unreadable files are reported, never folded").
- Consumes (W2-2a, lib): `asOfHiddenNodesSql(): string`, which binds asOfBinds' six names plus `:asof_nodes`, a JSON array of node ids, and answers the hidden ids in column `node_id`. Also `asOfBinds(cut): { asof_ts, asof_file, asof_line, asof_boundary, asof_summary, asof_kept }`. W2-D35 as amended, including D-6282, D-6283 and D-6284, is the one node rule. It is never re-spelled (C7, ruling 7894).
- Consumes (base lib and store): `historyPaths(home).headlessOn`, `sha256Hex`, `idOk`, `UUID_RE`, `EXIT`, and store.mjs's `readBounded(path, max, follow): {state: 'value', value} | {state: 'absent'} | {state: 'over-cap'} | {state: 'unreadable'}`. `readBounded` makes one `O_NOFOLLOW` open when `follow` is false and checks the type on the descriptor. A directory, a link (`ELOOP`) or a FIFO is `unreadable`, and a size over `max` is `over-cap`.
- Consumes (W2-5a, base): `refuse`, `DriverRefusal`, `HANDLERS`, `SUBCOMMAND_FLAGS`, `DRAFT_INPUT`, `PRED_INPUT`, `checkFlags(form, flags)`, `loadRecordInput(flags, part)` (the record validated, a final read beside `--part1` and `--frozen`), `recheckCode(record)`, `subcommandHome(env)`, `openReplayStore(home)` (`{db, storeId, close, …}`), `requireNamedNode(record, storeId)`, `printWithSha(value)`, `byFamilyKey` (familyKey order, by code unit), `storeRefusal(e)`, `verifyRegistry`, `verifyAb`, `verifyCommand`.
- Consumes (Task 1 of this plan, by its names, R8): the lib import names above (Task 1 owns the statement) and `CONTROL_ARM`, Task 1's control constant (`RECALL_ARMS[0]`). Task 1's arm-word scan must stay green: no line this task adds quotes either arm word.
- Consumes (Task 2 of this plan): the module-private `armStmts(db)` and its `hidden` statement, lib's `asOfHiddenNodesSql` prepared once per handle, so the driver still names that statement on one code line (Task 2's scan).
- Produces (`deploy/history-replay.mjs`, exported unless marked private):
  - `MARKER_SECTIONS = ['pilot', 'quiz', 'ab']` (frozen).
  - `VERIFY_HEADLESS_KIND = 'ccrc-history-w2-verify-headless'`.
  - `HEADLESS_ON_STATES = ['ok', 'absent', 'unreadable', 'over-cap', 'malformed', 'store-other', 'pairs-differ', 'bytes-differ']` (frozen).
  - `ALL_VISIBLE_CUT`: frozen, `{ asof: 'all-visible', tsCut: Number.MAX_SAFE_INTEGER, boundaryEntryId: -1, summaryEntryId: null, keptUuids: [], holdingFileId: -1, boundaryLine: -1 }`.
  - `headlessPairsOf(record, section: 'pilot' | 'quiz', storeId): Array<{ ccrcId, generation }>`, in familyKey order. It refuses `input-invalid` when the store holds no family of the section.
  - `headlessTextOf(record, section, storeId): string`, which is `formatHeadlessList`'s text. Its `TypeError` and `RangeError` become `record-invalid`.
  - `abCommandsOf(record, storeId): string`: one line per control family on the store, in familyKey order, or `''` when the store has none.
  - `readHeadlessOn(home): {state: 'value', text, list} | {state: 'malformed', text} | {state: 'absent'} | {state: 'over-cap'} | {state: 'unreadable'}`. This is the driver's one read of the marker.
  - `headlessStateOf(read, expected: string, storeId): { state: HEADLESS_ON_STATES member, sha256: string | null, missing: string[], extra: string[] }`. Pure.
  - `unlistedOf(read, storeId, families): string | null`. Pure; it answers why the batch is unlisted, or null.
  - `requireListed(home, storeId, families: Array<{store_id, ccrc_id, generation}>): void`. It throws `family-unlisted`. This is W2-D78 (i), which Task 4 calls before every arm batch.
  - `OVER_HIDE_IDS_MAX = 1000` (R29, pinned as that literal); `overHideOf(db, max = OVER_HIDE_IDS_MAX): { cut: 'all-visible', binds, leaves: number, hidden: number, hidden_ids: string[], hidden_ids_max: number }`: `hidden` is always the total, `hidden_ids` the first `max` hidden ids sorted (R10, R29). An SQLite failure is `store-unreadable`.
  - `verifyHeadlessReport({ recordSha256, storeId, section, expectedSha256, found, overHide })`.
  - `markerCommand(flags): Promise<number>`, registered as `marker`.
  - Module-private: `markerLine`, `familyMarkerLine`, `printTextWithSha`, `verifyHeadless(section, flags, env)`.

**Spec and decisions:** W2-D84 whole (this task's half: `marker`, `verify --section pilot|quiz`; its three pins); W2-D76 (the pilot marker, D-5781); W2-D78 (i); W2-D24 (W2-5b's consumers `marker` and `verify --section pilot|quiz`); W2-D44 (the marker grammar and its read: a path, no follow, bounded); W2-D35 as amended (D-6282, D-6283, D-6284; the over-hide count); W2-D27 (no legacy control file, so `--generation` always); W2-D18 (a stated sort key, familyKey by code unit). Rulings: S1 (this PR's files), Q16 (the over-hide count, per node, in `verify --section quiz`, stated binds), Q23 (no `--allow-code-change` here), R9, R10, R11, R12, R13, R23 and R24; R27 (Step 2's `verify --section quiz` line is a licensed in-place edit of a W2-5a case, named in the commit) and R29 (`OVER_HIDE_IDS_MAX` is 1,000, the total always given). Spec §8.2 (the marker, as erratum E9 will state it) and §10.2's headless-on sentence (erratum E21, D-5781). This task amends neither: S1 gives the errata to W2-5b2. Cited bare, never defined: D-5766, D-5768, D-5781, D-5814, D-6282, D-6283, D-6284, D-6309. This task defines no number.

**Re-anchored against c34f82830 (drifts from the documents):**

| The document says | The code or the ruling at c34f82830 says | What this task does |
|---|---|---|
| W2-D84: `marker … prints per node` | One stdout can carry only one node's exact bytes, and the operator writes each node's marker on that node | `marker` prints one node per call, `--node-label` (W2-5a's list flag, given exactly once). Stdout is that node's exact bytes, so `> file` writes the marker. |
| W2-D84: `--record <final\|draft>` for every section | Part 2 holds part 1 whole, so a final also carries `pilot`. The pilot runs, and its marker is written, before part 2 exists (W2-D76). | `--section pilot` reads part 1 (a final is `record-invalid` `record part "final", wanted draft`); `quiz` and `ab` read part 2, beside `--part1` and `--frozen`, as `verify --section ab` does |
| W2-D84: "the headless-on bytes' sha equals the marker's" | `readBounded` answers text decoded with replacement (D-5768), and a second byte reader of the marker would be a second read path (W2-D44, O13) | The sha is taken over the text as read. For a marker that is valid UTF-8 it equals the bytes' sha. A marker holding an invalid byte reads with U+FFFD, which `formatHeadlessList`'s text never holds, so it is never `ok` and is `malformed` (D-5768's fatal-decode rule). So the comparison answers exactly what a byte comparison answers. |
| W2-D78 (i): "parsed with lib's `parseHeadlessList`" | lib's `headlessMarkerOf` folds `unreadable` and `over-cap` into `headless-malformed` | The driver reads with `readBounded` and parses with `parseHeadlessList` itself (`readHeadlessOn`), so `verify` reports each answer apart. Every non-value answer is `family-unlisted` in the preflight, which fails closed. |
| The W2-2b plan ("Not in this plan"): `marker` "handles its `RangeError`" | `formatHeadlessList` also throws `TypeError` for a grammar fault, such as an id spelled `store` | Both are `record-invalid`, D-6309's word for a record the gate signs and the driver cannot run. Any other throw stays a defect. |
| The ledger: "W2-5b's report measures D-6284's over-hide on the live store" | `report` cannot read another node's store (Q16) | `verify --section quiz` counts it per node, read-only, over every leaf of this store, and W2-5b2's report gathers the counts |
| Q16: "stated all-visible binds" | `asOfEntrySql` never shows a row with a NULL `ts_ms`, under any binds (D-5766) | `ALL_VISIBLE_CUT` shows every timed row (no holding copy, no exempt boundary or summary, no kept member). The count is D-6284's over-hide plus any leaf whose boundary or summary row is untimed. The output states the binds, and the PR body names the composition. |
| scope.md E18: `verify` answers "this build verifies ab only" | The same, at about :5785 | That line becomes the dispatch to the new sections, and W2-5a's case re-pins its line (`section "judge": verify reads ab, pilot or quiz`) |
| scope.md B: HANDLERS pin "T:4822" | The line is at about :4824 at c34f82830 | Re-anchored by content |

**Choices this task makes:**
- **One node per call.** `--node-label` is required and given exactly once, and it must name a node of the record. `marker` reads no HOME and no store: it prints what the record says for any named node. `verify` is the on-node check (W2-D84). A pilot family on a store that no node names has no marker (the validator leaves `pilot.families` unbound), and that store fails `verify`'s node rule. Stated, not changed (W2-D84, R12): the operator keeps the pilot node among the record's nodes.
- **The pairs, in one order.** The section's families on the node's store, sorted by `byFamilyKey` (familyKey by code unit, W2-D18's stated key), so `marker` and `verify` compute one text from one record. `quiz.families` is part 2's, and the validator holds it equal to the frozen list's families.
- **No family, no marker (R11).** A store holding no family of the section refuses `input-invalid` (`<section> lists no family on store <id>: that node has no headless-on marker`). It is never printed as a bare store line, which the seam would read as `headless-unlisted` for every arm. `ab` on a store with no control family prints nothing: no control file is owed there.
- **`ab`'s lines.** Control families only, by Task 1's constant, never a quoted arm word. Each id is re-checked with `idOk` and each generation with `UUID_RE` before a shell line is printed (`record-invalid` otherwise), so a pasted line holds only `[A-Za-z0-9._-]`, the UUID and fixed words.
- **The one read (W2-D44, O13).** `readHeadlessOn` is the only code line in the driver that names `.headlessOn`: `readBounded(historyPaths(home).headlessOn, HEADLESS_LIST_MAX_BYTES, false)`. It never follows a link, never reads past 65,536 bytes, and never writes. No driver line, comment or code, spells the marker's path text (the O13 holders scan's needle is the path with its leading slash). A test pins all three: the one line, the absent spelling, and no write verb paired with the field.
- **`verify`'s states, never folded.** These are `absent`, `unreadable` (a directory, a link, any other failure), `over-cap`, `malformed` (`parseHeadlessList` refuses it), `store-other` (a store line naming another store), `pairs-differ` (a pair missing or extra; `missing` in the expected order, `extra` by code unit), `bytes-differ` (the same pairs in other bytes: a comment, another order, a duplicate, no final newline) and `ok`. `ok` is the sha comparison alone. `verify` exits 0 whatever it finds, as `verify --section ab` does: a finding is data.
- **W2-D78 (i) fails closed.** Every non-value answer is `family-unlisted` `headless-on <state>`. A store line naming another store is `headless-on names store <x>, not this store <y>`. A batch pair that is not listed, compared by id AND generation, gives `not listed for store <y>: <id> <generation>, …`. A family whose `store_id` is not this store's is never listed.
- **The over-hide count (Q16).** It runs over every leaf (`kind <> 'condensed'`) of this store, bound as one JSON array to lib's `asOfHiddenNodesSql` with `asOfBinds(ALL_VISIBLE_CUT)`. It reports the leaves, the hidden count (always the total), the first `OVER_HIDE_IDS_MAX` (1,000, R29) hidden ids sorted with that cap, and the binds themselves, and nothing gates on it (R10). The statement is Task 2's prepared `armStmts(db).hidden`, so lib's node rule is still named on one driver code line. `--section pilot` reports `over_hide: null`. The cost is one statement over the store's leaves, which is a stated cost of an operator act.
- **No new flag.** `FLAG_SPECS` already holds `section`, `node-label` and every record flag (W2-5a Task 7), so W2-4's `FLAG_SPECS` pin does not move in this task.

- [ ] **Step 1: Confirm the earlier names before using them.** From the repository root:

```bash
grep -n "^import .* from '../ccd/history/lib.mjs';" deploy/history-replay.mjs | tr ',' '\n' | grep -cwE 'HEADLESS_LIST_MAX_BYTES|asOfBinds|asOfHiddenNodesSql|formatHeadlessList|historyPaths|idOk|parseHeadlessList|sha256Hex|UUID_RE'
grep -cE '^export const (CONTROL_ARM|TREATMENT_ARM) = RECALL_ARMS\[[01]\];$' deploy/history-replay.mjs
grep -c '^function armStmts(db) {$' deploy/history-replay.mjs
grep -cE "^(export )?(async )?(function|const) (checkFlags|loadRecordInput|recheckCode|subcommandHome|openReplayStore|requireNamedNode|printWithSha|byFamilyKey|storeRefusal|SUBCOMMAND_FLAGS|DRAFT_INPUT|PRED_INPUT|verifyCommand|verifyAb)\b" deploy/history-replay.mjs
grep -cE "^(export )?(async )?(function|const) (MARKER_SECTIONS|VERIFY_HEADLESS_KIND|HEADLESS_ON_STATES|ALL_VISIBLE_CUT|OVER_HIDE_IDS_MAX|markerLine|familyMarkerLine|headlessPairsOf|headlessTextOf|abCommandsOf|readHeadlessOn|headlessStateOf|unlistedOf|requireListed|overHideOf|verifyHeadlessReport|printTextWithSha|markerCommand|verifyHeadless)\b" deploy/history-replay.mjs
grep -c '\.headlessOn' deploy/history-replay.mjs
grep -c '/headless-on' deploy/history-replay.mjs
grep -c "HANDLERS.set('verify', verifyCommand);" deploy/history-replay.mjs
node --no-warnings --input-type=module -e "const l = await import('./ccd/history/lib.mjs'); console.log(['parseHeadlessList','formatHeadlessList','asOfHiddenNodesSql','asOfBinds'].map((n) => n + ':' + typeof l[n]).join(' '), l.HEADLESS_LIST_MAX_BYTES)"
```

Expected:
- `9`: Task 1's lib statement names every one. A smaller count names a gap that Step 6 fills, in that one statement. Never add a second statement.
- `2`, then `1`: Task 1's `CONTROL_ARM` and `TREATMENT_ARM`, then Task 2's `armStmts` (R8). A missing name is a gap in its owning task: stop and report it.
- `14`: W2-5a's names this task reads. A missing one stops the task: report it.
- `0`: no name this task declares exists yet. A collision stops the task: report it, and never rename another task's name.
- `0` and `0`: the driver names neither the field nor the path yet.
- `1`: W2-5a's registration line, which this task's `HANDLERS.set('marker', …)` follows.
- `parseHeadlessList:function formatHeadlessList:function asOfHiddenNodesSql:function asOfBinds:function 65536`: W2-2b and W2-2a are merged. Anything else means W2-2b has not landed, and this task stops (W2-D2).

- [ ] **Step 2: Re-pin the two existing lines, and add the test import.** In `server/test/history-replay.test.ts`:

Replace the three lines

```ts
    // The driver's whole subcommand set, in registration order: W2-4's two, then W2-5a Task 7's six (Task 1's grammar
    // cases use an unregistered name).
    expect([...t9Driver.HANDLERS.keys()]).toEqual(['step0a', 'probe', 'pilot-source', 'quiz-source', 'freeze', 'power', 'open', 'verify']);
```

(about :4822 to :4824) with

```ts
    // The driver's whole subcommand set, in registration order: W2-4's two, W2-5a Task 7's six, then W2-5b1's, in task
    // order (Task 1's grammar cases use an unregistered name).
    expect([...t9Driver.HANDLERS.keys()]).toEqual(['step0a', 'probe', 'pilot-source', 'quiz-source', 'freeze', 'power', 'open', 'verify', 'marker']);
```

Replace the line (W2-5a Task 7's, edited in place under R27: `verify` now reads `quiz`, so this line's answer cannot stand)

```ts
      r7expect(run7(null, null, ['verify', '--section', 'quiz']).stderr).toBe(refusalLine('args-invalid', 'section "quiz": this build verifies ab only'));
```

(about :9249) with

```ts
      // W2-5b1 Task 3: verify reads ab, pilot and quiz; any other section is refused before its flags are read (edited in place, R27).
      r7expect(run7(null, null, ['verify', '--section', 'judge']).stderr).toBe(refusalLine('args-invalid', 'section "judge": verify reads ab, pilot or quiz'));
```

Directly after the line `import { REPO as R7_REPO, scrubbedEnv as r7Scrubbed } from './historyHelpers.js';` (about :8932), add:

```ts
import { HEADLESS_LIST_MAX_BYTES as W5B3_MAX, asOfBinds as w5b3Binds, formatHeadlessList as w5b3Format, parseHeadlessList as w5b3Parse } from '../../ccd/history/lib.mjs';
```

- [ ] **Step 3: Write the failing tests.** Insert this describe directly before the `});` that closes `r7describe('W2-5a Task 7: the record subcommands', () => {` (about :10502). That `});` follows the last lines of Task 1's nested describe (R9, task order): `      r7expect(load(flags(amended7(c, exception)), { nowMs: AFTER }).record.amendments[0].kind, 'another kind is not ranged').toBe('freeze-exception');`, then `    });` and `  });`. The cases are live-safe:
- Every HOME is an `r7MkTmp` tree from `home7`, and every record is W2-5a's `chain7`, signed with this checkout's code shas.
- The marker file is planted by the test at `historyPaths(home).headlessOn` (the test file is not in O13's `.mjs` corpus).
- `marker` and `verify` spawn nothing. Each runs as the operator runs it, `node --no-warnings` with the scrubbed env (`run7`).
- `requireListed` and `headlessTextOf` run in-process: neither spawns nor writes.

```ts

  // ── W2-5b1 Task 3: marker, verify --section pilot|quiz, and the headless-on reader (W2-D84, W2-D76, W2-D78 (i), W2-D24; D-5781) ──
  // Nested in W2-5a Task 7's describe for its signed fixtures (chain7's draft, final and frozen list; home7, run7, tree7,
  // snapshot7). The marker is planted by the test at historyPaths(home).headlessOn. marker and verify spawn nothing; the
  // arm preflight's reader (requireListed) is called in-process here, and with the stub's log in Task 4.
  r7describe('W2-5b1 Task 3: marker and verify section pilot and quiz', () => {
    type Found = { state: string; sha256: string | null; missing: string[]; extra: string[] };
    type Plant = { text: string } | { dir: true } | { link: true } | null;
    type Refusal = { word: string; detail: string } | null;
    const markerPath = (home: string): string => r7Paths(home).headlessOn;
    /** marker's argv over a chain: pilot reads part 1; quiz and ab read part 2 beside its draft and frozen list (W2-D84). */
    const markerArgv = (c: R7, section: string, label: string): string[] => (section === 'pilot'
      ? ['marker', '--section', section, ...inp('record', c.d), '--node-label', label]
      : ['marker', '--section', section, ...inp('record', c.f), ...inp('part1', c.d), ...inp('frozen', c.fz), '--node-label', label]);
    const verifyArgv = (c: R7, section: string): string[] => (section === 'pilot'
      ? ['verify', '--section', section, ...inp('record', c.d)]
      : ['verify', '--section', section, ...inp('record', c.f), ...inp('part1', c.d), ...inp('frozen', c.fz)]);
    /** One marker pair line (W2-D44): `<ccrc_id> <generation>`. */
    const line = (f: Ref): string => `${f.ccrc_id} ${f.generation}\n`;
    const PILOT_A = `store ${STORE_A}\n${line(PILOT_FAMILY)}`;
    const QUIZ_A = `store ${STORE_A}\n${line(A_T1)}${line(A_T2)}`;
    const QUIZ_B = `store ${STORE_B}\n${line(B_T1)}`;
    const AB_A = `ccrc history recall-off a-c1 --generation ${A_C1.generation}\nccrc history recall-off a-c2 --generation ${A_C2.generation}\n`;
    const AB_B = `ccrc history recall-off b-c1 --generation ${B_C1.generation}\n`;
    /** Put `what` where the marker lives: its text, a directory, a link to a file holding QUIZ_A, or nothing. */
    function plant(home: string, what: Plant): void {
      const p = markerPath(home);
      r7fs.mkdirSync(r7path.dirname(p), { recursive: true });
      r7fs.rmSync(p, { recursive: true, force: true });
      if (what === null) return;
      if ('dir' in what) { r7fs.mkdirSync(p); return; }
      if ('link' in what) {
        const target = r7path.join(r7MkTmp('ccrc-w2-5b1-t3-link-'), 'marker');
        r7fs.writeFileSync(target, QUIZ_A, { mode: 0o600 });
        r7fs.symlinkSync(target, p);
        return;
      }
      r7fs.writeFileSync(p, what.text, { mode: 0o600 });
    }
    const found = (r: { stdout: string }): Found => JSON.parse(r.stdout).found as Found;
    /** A synchronous call's refusal as {word, detail}; null when it returns. Any other throw fails the case. */
    function refusalOf(fn: () => unknown): Refusal {
      try {
        fn();
        return null;
      } catch (e) {
        if (e instanceof r7drv.DriverRefusal) return { word: (e as R7).word, detail: (e as R7).detail };
        throw e;
      }
    }
    /** Three leaves and a condensed node over the first, in `home`'s store (home7's). L000001: its boundary stamped at
     *  1,000 and no stored summary, so it is shown under the all-visible cut (CONTROL), unless `storedOnTimed` gives it
     *  a stored summary. L000002: stamped at 2,000, with a stored summary blob and no copy holding its boundary, so its
     *  read-time pick is NULL and D-6284 hides it. L000003: its boundary's ts_ms is NULL, which no cut ever shows. */
    function plantLeaves(home: string, storedOnTimed = false): void {
      const w = r7Store.openWriter(r7Paths(home).dbFile) as unknown as { exec: (sql: string) => void; prepare: (sql: string) => { run: (...a: unknown[]) => unknown } };
      try {
        w.exec('BEGIN');
        w.prepare("INSERT INTO blobs (blob_id, sha256, codec, z, raw_len) VALUES (1, ?, 'br5', ?, 1)").run(Buffer.alloc(32, 0xb3), Buffer.from([0]));
        w.prepare("INSERT INTO sessions (session_pk, ccrc_id, generation, project, first_seen_ms) VALUES (1, 'a-t1', ?, 'demo', 1)").run(A_T1.generation);
        w.prepare('INSERT INTO transcripts (transcript_pk, cc_session_uuid) VALUES (1, ?)').run(gen(7000));
        const entry = w.prepare("INSERT INTO entries (entry_id, uuid, transcript_pk, type, provenance, prov_version, struct_rank_ns, struct_file_id, blob_id, ts_ms) VALUES (?, ?, 1, 'system', 'harness', 1, 0, 0, 1, ?)");
        const boundary = w.prepare('INSERT INTO boundaries (entry_id, transcript_pk, ord) VALUES (?, 1, ?)');
        ([[1, 1_000], [2, 2_000], [3, null]] as Array<[number, number | null]>).forEach(([id, ts]) => { entry.run(id, gen(7000 + id), ts); boundary.run(id, id); });
        const node = w.prepare("INSERT INTO nodes (node_id, session_pk, epoch_seq, transcript_pk, kind, depth, status, summary_blob_id, boundary_entry_id, parser_version, created_ms) VALUES (?, 1, 1, 1, ?, ?, 'ok', ?, ?, 1, 1)");
        node.run('L000001', 'native_leaf', 0, storedOnTimed ? 1 : null, 1);
        node.run('L000002', 'native_leaf', 0, 1, 2);
        node.run('L000003', 'raw_leaf', 0, null, 3);
        node.run('N000001', 'condensed', 1, null, null);
        w.prepare('INSERT INTO node_children (node_id, child_id, ord) VALUES (?, ?, 1)').run('N000001', 'L000001');
        w.exec('COMMIT');
      } finally {
        r7Store.closeWriter(w as never);
      }
    }

    r7it('marker prints one node\'s exact text on stdout and its sha256 on stderr, with no store on the box: pilot from part 1, quiz from part 2, ab as recall-off commands with --generation (W2-D84, W2-D76, D-5781)', () => {
      const home = home7(null);
      const c = chain7(home);
      for (const [section, label, want] of [
        ['pilot', 'node-a', PILOT_A], ['quiz', 'node-a', QUIZ_A], ['quiz', 'node-b', QUIZ_B], ['ab', 'node-a', AB_A], ['ab', 'node-b', AB_B],
      ] as Array<[string, string, string]>) {
        const r = run7(null, home, markerArgv(c, section, label));
        r7expect([r.code, r.stdout, r.stderr], `${section} ${label}`).toEqual([0, want, `sha256 ${r7Sha(want)}\n`]);
      }
    });

    r7it('the W2-D84 round trip: marker\'s text parses to exactly its pairs and formats back to the same bytes; planted as printed, verify reads ok and requireListed lists every pair', () => {
      const home = home7(STORE_A);
      const c = chain7(home);
      for (const [section, text, fams] of [['pilot', PILOT_A, [PILOT_FAMILY]], ['quiz', QUIZ_A, [A_T1, A_T2]]] as Array<[string, string, Ref[]]>) {
        const r = run7(null, home, markerArgv(c, section, 'node-a'));
        r7expect([r.code, r.stdout], section).toEqual([0, text]);
        const parsed = w5b3Parse(r.stdout);
        r7expect(parsed, section).toEqual({ ok: true, storeId: STORE_A, pairs: fams.map((f) => ({ ccrcId: f.ccrc_id, generation: f.generation })) });
        r7expect(w5b3Format(parsed as never), section).toBe(r.stdout);
        plant(home, { text: r.stdout });
        const v = run7(null, home, verifyArgv(c, section));
        r7expect(v.code, v.stderr).toBe(0);
        r7expect(v.stderr).toBe(`sha256 ${r7Sha(v.stdout)}\n`);
        const out = JSON.parse(v.stdout);
        r7expect([out.kind, out.v, out.section, out.store_id, out.record_sha256, out.expected_sha256, out.found, out.ok], section).toEqual([
          r7drv.VERIFY_HEADLESS_KIND, 1, section, STORE_A, section === 'pilot' ? c.d.sha : c.f.sha, r7Sha(text),
          { state: 'ok', sha256: r7Sha(text), missing: [], extra: [] }, true]);
        r7expect(refusalOf(() => r7drv.requireListed(home, STORE_A, fams)), section).toBeNull();
      }
    });

    r7it('marker and verify write nothing: the HOME tree, the store and a planted marker are byte-identical after every section (W2-D84)', () => {
      const home = home7(STORE_A);
      const c = chain7(home);
      plant(home, { text: PILOT_A });
      const before = snapshot7(home);
      r7expect(before.some((l) => l.startsWith('.ccrc/history/headless-on ')), 'CONTROL: the snapshot lists the marker').toBe(true);
      for (const argv of [markerArgv(c, 'pilot', 'node-a'), markerArgv(c, 'quiz', 'node-b'), markerArgv(c, 'ab', 'node-a'), verifyArgv(c, 'pilot'), verifyArgv(c, 'quiz')]) {
        r7expect(run7(null, home, argv).code, argv.slice(0, 3).join(' ')).toBe(0);
      }
      r7expect(snapshot7(home)).toEqual(before);
    });

    r7it.each([
      ['absent', null, 'absent'],
      ['a directory', { dir: true }, 'unreadable'],
      ['a link to the right text, never followed', { link: true }, 'unreadable'],
      ['one byte over the 65,536-byte bound', { text: '#'.repeat(W5B3_MAX + 1) }, 'over-cap'],
      ['a space before the store line', { text: ` ${QUIZ_A}` }, 'malformed'],
      ['the right pairs under another store line', { text: QUIZ_A.replace(STORE_A, STORE_B) }, 'store-other'],
      ['a pair missing and one extra', { text: `store ${STORE_A}\n${line(A_T1)}zz-extra ${gen(1)}\n` }, 'pairs-differ'],
      ['the same pairs after a comment', { text: `# written by hand\n${QUIZ_A}` }, 'bytes-differ'],
      ['the same pairs in another order', { text: `store ${STORE_A}\n${line(A_T2)}${line(A_T1)}` }, 'bytes-differ'],
      ['the same pairs without the final newline', { text: QUIZ_A.slice(0, -1) }, 'bytes-differ'],
    ] as Array<[string, Plant, string]>)('verify --section quiz reports %s as itself, never folded, and ok is false (W2-D84)', (_name, what, state) => {
      const home = home7(STORE_A);
      const c = chain7(home);
      plant(home, what);
      const r = run7(null, home, verifyArgv(c, 'quiz'));
      r7expect(r.code, r.stderr).toBe(0);
      const f = found(r);
      r7expect(f.state).toBe(state);
      r7expect(r7drv.HEADLESS_ON_STATES).toContain(state);
      r7expect(JSON.parse(r.stdout).ok).toBe(false);
      r7expect(f.sha256, 'the sha256 of the text read, or null when none was read')
        .toBe(what !== null && 'text' in what && state !== 'over-cap' ? r7Sha(what.text) : null);
      r7expect([f.missing, f.extra]).toEqual(state === 'pairs-differ' ? [[`a-t2 ${A_T2.generation}`], [`zz-extra ${gen(1)}`]] : [[], []]);
    });

    r7it('verify --section pilot reads part 1 and holds the marker to the pilot pairs; the quiz text there is pairs-differ, and over_hide is the quiz section\'s alone', () => {
      const home = home7(STORE_A);
      const c = chain7(home);
      plant(home, { text: PILOT_A });
      const ok = run7(null, home, verifyArgv(c, 'pilot'));
      r7expect([found(ok).state, JSON.parse(ok.stdout).over_hide]).toEqual(['ok', null]);
      plant(home, { text: QUIZ_A });
      const f = found(run7(null, home, verifyArgv(c, 'pilot')));
      r7expect([f.state, f.missing, f.extra]).toEqual(['pairs-differ', [`pilot-0 ${PILOT_FAMILY.generation}`], [`a-t1 ${A_T1.generation}`, `a-t2 ${A_T2.generation}`]]);
    });

    r7it('marker and verify refuse, each with its word: no section or an unknown one, a flag the form never reads, no label or two, a label the record does not name, the wrong part, a node holding no family of the section, a store the record does not name', () => {
      const home = home7(STORE_A);
      const c = chain7(home);
      const err = (argv: string[], h: string | null = null): string => run7(null, h, argv).stderr;
      r7expect(err(['marker', ...inp('record', c.d)])).toBe(refusalLine('args-invalid', 'section-required'));
      r7expect(err(['marker', '--section', 'judge'])).toBe(refusalLine('args-invalid', 'section "judge": marker prints pilot, quiz, ab'));
      r7expect(err(['verify', '--section', 'judge'])).toBe(refusalLine('args-invalid', 'section "judge": verify reads ab, pilot or quiz'));
      r7expect(err(['marker', '--section', 'quiz', '--census', '/c'])).toBe(refusalLine('args-invalid', '--census is not a marker --section quiz flag'));
      r7expect(err(['marker', '--section', 'ab', '--out', '/o'])).toBe(refusalLine('args-invalid', '--out is not a marker --section ab flag'));
      r7expect(err(['verify', '--section', 'pilot', ...inp('frozen', c.fz)])).toBe(refusalLine('args-invalid', '--frozen is not a verify --section pilot flag'));
      r7expect(err(['marker', '--section', 'pilot', ...inp('record', c.d)])).toBe(refusalLine('args-invalid', 'node-label-required'));
      r7expect(err([...markerArgv(c, 'pilot', 'node-a'), '--node-label', 'node-b'])).toBe(refusalLine('args-invalid', 'marker prints one node: --node-label given 2 times'));
      r7expect(err(markerArgv(c, 'quiz', 'node-x'))).toBe(refusalLine('args-invalid', 'node-label "node-x" names no node of the record'));
      r7expect(err(['marker', '--section', 'pilot', ...inp('record', c.f), '--node-label', 'node-a'])).toBe(refusalLine('record-invalid', 'record part "final", wanted draft'));
      const none = `pilot lists no family on store ${STORE_B}: that node has no headless-on marker`;
      r7expect(err(markerArgv(c, 'pilot', 'node-b'))).toBe(refusalLine('input-invalid', none));
      r7expect(err(verifyArgv(c, 'pilot'), home7(STORE_B))).toBe(refusalLine('input-invalid', none));
      r7expect(err(verifyArgv(c, 'quiz'), home7(STORE_C))).toBe(refusalLine('input-invalid', `store ${STORE_C} is not one of the record's nodes`));
    });

    r7it('marker and verify take no --allow-code-change: Q23 grants it to arms, judge and report only', () => {
      const home = home7(STORE_A);
      const c = chain7(home);
      for (const [form, argv] of [['marker --section quiz', markerArgv(c, 'quiz', 'node-a')], ['verify --section quiz', verifyArgv(c, 'quiz')]] as Array<[string, string[]]>) {
        r7expect(run7(null, home, [...argv, '--allow-code-change']).stderr, form)
          .toBe(refusalLine('args-invalid', `--allow-code-change is not a ${form} flag`));   // Task 1 declared it; no form here lists it
      }
    });

    // W2-D24: every --record consumer re-checks the code it runs under, right after the record validates (R23: W2-5a's titles,
    // this task's own rows).
    const rows: Array<[string, (c: R7) => string[]]> = [
      ['marker --section pilot', (c) => markerArgv(c, 'pilot', 'node-a')],
      ['marker --section quiz', (c) => markerArgv(c, 'quiz', 'node-a')],
      ['marker --section ab', (c) => markerArgv(c, 'ab', 'node-a')],
      ['verify --section pilot', (c) => verifyArgv(c, 'pilot')],
      ['verify --section quiz', (c) => verifyArgv(c, 'quiz')],
    ];
    r7it.each(rows)('code-changed before any other input is read, re-checks the code it runs under: %s', (_sub, argv) => {
      const home = home7(null);   // no store: verify's next read would refuse store-unreadable store-missing
      const c = chain7(home);
      const r = run7(tree7({ edit: 'deploy/measure-history.py' }), home, argv(c));
      r7expect([r.code, r.stdout, r.stderr]).toEqual([2, '', refusalLine('code-changed', 'changed deploy/measure-history.py')]);
    });
    r7it.each(rows)('code-unmeasured, never code-changed, for a gate_code file that cannot be read: %s', (_sub, argv) => {
      const home = home7(null);
      const c = chain7(home);
      r7expect(run7(tree7({ drop: 'deploy/measure-history.py' }), home, argv(c)).stderr).toBe(refusalLine('code-unmeasured', 'deploy/measure-history.py is absent'));
    });
    r7it('CONTROL: under an unchanged copy of the tree, marker prints and verify reaches the store it was built to miss', () => {
      const home = home7(null);
      const c = chain7(home);
      const tree = tree7();
      for (const [sub, argv] of rows) {
        const r = run7(tree, home, argv(c));
        if (sub.startsWith('marker')) r7expect([r.code, r.stderr], sub).toEqual([0, `sha256 ${r7Sha(r.stdout)}\n`]);
        else r7expect(r.stderr, sub).toBe(refusalLine('store-unreadable', 'store-missing'));
      }
    });

    r7it('a family list no marker can carry is record-invalid, never an internal error: RangeError past either bound, TypeError for a grammar fault', () => {
      const fam = (i: number, id = `fam-${String(i).padStart(4, '0')}`): Ref => ({ store_id: STORE_A, ccrc_id: id, generation: gen(10_000 + i) });
      const rec = (families: Ref[]): R7 => ({ pilot: { families }, quiz: { families } });
      const text = (families: Ref[], section: 'pilot' | 'quiz'): Refusal => refusalOf(() => r7drv.headlessTextOf(rec(families), section, STORE_A));
      r7expect(text(Array.from({ length: 1000 }, (_, i) => fam(i)), 'quiz'), 'CONTROL: 1,000 pairs').toBeNull();
      const many = text(Array.from({ length: 1001 }, (_, i) => fam(i)), 'quiz');
      r7expect(many?.word).toBe('record-invalid');
      r7expect(many?.detail).toMatch(new RegExp(`^quiz marker for store ${STORE_A} cannot be formatted: RangeError: `));
      // 224-character ids (SPOOL_ID_MAX): 262 bytes a line, so 200 fit and 300 pass 65,536 bytes before 1,000 pairs.
      const long = Array.from({ length: 300 }, (_, i) => fam(i, `${'x'.repeat(220)}${String(i).padStart(4, '0')}`));
      r7expect(text(long.slice(0, 200), 'pilot'), 'CONTROL: 200 long ids fit').toBeNull();
      r7expect(text(long, 'pilot')?.detail).toMatch(new RegExp(`^pilot marker for store ${STORE_A} cannot be formatted: RangeError: `));
      const named = text([fam(1, 'store')], 'quiz');
      r7expect(named?.word).toBe('record-invalid');
      r7expect(named?.detail).toMatch(new RegExp(`^quiz marker for store ${STORE_A} cannot be formatted: TypeError: `));
    });

    r7it('W2-D78 (i), the arm preflight\'s reader: requireListed passes a batch whose every pair is on this store\'s marker, and refuses family-unlisted otherwise, naming why', () => {
      const home = home7(null);
      const listed = (store: string, fams: Ref[]): Refusal => refusalOf(() => r7drv.requireListed(home, store, fams));
      r7expect(listed(STORE_A, [A_T1])).toEqual({ word: 'family-unlisted', detail: 'headless-on absent' });
      plant(home, { text: QUIZ_A });
      r7expect(listed(STORE_A, [A_T1, A_T2]), 'CONTROL: every pair listed').toBeNull();
      r7expect(listed(STORE_A, [A_T1, A_C1, A_C2])).toEqual({ word: 'family-unlisted', detail: `not listed for store ${STORE_A}: a-c1 ${A_C1.generation}, a-c2 ${A_C2.generation}` });
      r7expect(listed(STORE_A, [{ ...A_T2, generation: gen(1) }]), 'the generation is part of the pair')
        .toEqual({ word: 'family-unlisted', detail: `not listed for store ${STORE_A}: a-t2 ${gen(1)}` });
      r7expect(listed(STORE_B, [{ ...A_T1, store_id: STORE_B }]), 'the store line')
        .toEqual({ word: 'family-unlisted', detail: `headless-on names store ${STORE_A}, not this store ${STORE_B}` });
      plant(home, { text: `store ${STORE_A}\n` });
      r7expect(listed(STORE_A, [A_T1]), 'zero pairs list nothing').toEqual({ word: 'family-unlisted', detail: `not listed for store ${STORE_A}: a-t1 ${A_T1.generation}` });
      for (const [what, p] of [['malformed', { text: ` ${QUIZ_A}` }], ['over-cap', { text: '#'.repeat(W5B3_MAX + 1) }], ['unreadable', { dir: true }], ['unreadable', { link: true }]] as Array<[string, Plant]>) {
        plant(home, p);
        r7expect(listed(STORE_A, [A_T1]), `${what} ${JSON.stringify(p)}`).toEqual({ word: 'family-unlisted', detail: `headless-on ${what}` });
      }
    });

    r7it('O13: the driver names the marker\'s field on one code line, readHeadlessOn\'s bounded read; no line spells its path text; no code line pairs a write verb with it', () => {
      const text = r7fs.readFileSync(r7path.join(R7_REPO, 'deploy', 'history-replay.mjs'), 'utf8');
      const code = text.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l));
      // single-definition.test.ts' O13 verb list, restated (that one is closed over its describe).
      const VERB = /\b(?:writeFile|appendFile|rename|unlink|rm|rmdir|mkdir|copyFile|cp|symlink|link|truncate|open)(?:Sync)?\s*\(/;
      const pairsWrite = (l: string): boolean => { const m = VERB.exec(l); return m !== null && /\.headlessOn\b/.test(l.slice(m.index + m[0].length)); };
      r7expect(pairsWrite('rmSync(historyPaths(home).headlessOn, { force: true });'), 'CONTROL: a write').toBe(true);
      r7expect(pairsWrite('writeFileSync(P.headlessOn, text);'), 'CONTROL: a write').toBe(true);
      r7expect(pairsWrite('const read = readBounded(historyPaths(home).headlessOn, HEADLESS_LIST_MAX_BYTES, false);'), 'CONTROL: the read').toBe(false);
      r7expect(code.filter((l) => l.includes('.headlessOn')).map((l) => l.trim()))
        .toEqual(['const read = readBounded(historyPaths(home).headlessOn, HEADLESS_LIST_MAX_BYTES, false);']);
      r7expect(text.split('\n').filter((l) => l.includes('/headless-on')), 'comment or code').toEqual([]);
      r7expect(code.filter(pairsWrite)).toEqual([]);
    });

    r7it('verify --section quiz counts the leaves lib\'s node rule hides under the stated all-visible cut: D-6284\'s over-hide on this node, read-only (Q16)', () => {
      const home = home7(STORE_A);
      const c = chain7(home);
      plantLeaves(home);
      plant(home, { text: QUIZ_A });
      const before = snapshot7(home);
      const r = run7(null, home, verifyArgv(c, 'quiz'));
      r7expect(r.code, r.stderr).toBe(0);
      r7expect(snapshot7(home), 'read-only').toEqual(before);
      const out = JSON.parse(r.stdout);
      r7expect(out.over_hide).toEqual({ cut: 'all-visible', binds: w5b3Binds(r7drv.ALL_VISIBLE_CUT as never), leaves: 3, hidden: 2, hidden_ids: ['L000002', 'L000003'],
        hidden_ids_max: r7drv.OVER_HIDE_IDS_MAX });
      // The stated binds: every timed row shown; no holding copy, no exempt boundary or summary, no kept member.
      r7expect(out.over_hide.binds).toEqual({ asof_ts: Number.MAX_SAFE_INTEGER, asof_file: -1, asof_line: -1, asof_boundary: -1, asof_summary: null, asof_kept: '[]' });
      r7expect(out.found.state, 'CONTROL: the marker half is unchanged by the count').toBe('ok');
    });

    r7it('CONTROL: a stored summary on the timed leaf hides it too (lib\'s D-6284 arm, not a copy), a store with no leaf counts nothing, and the ids are capped at 1,000 with the total always given (R10, R29)', () => {
      const home = home7(STORE_A);
      const c = chain7(home);
      plant(home, { text: QUIZ_A });
      r7expect(JSON.parse(run7(null, home, verifyArgv(c, 'quiz')).stdout).over_hide).toMatchObject({ leaves: 0, hidden: 0, hidden_ids: [] });
      plantLeaves(home, true);
      r7expect(JSON.parse(run7(null, home, verifyArgv(c, 'quiz')).stdout).over_hide).toMatchObject({ leaves: 3, hidden: 3, hidden_ids: ['L000001', 'L000002', 'L000003'] });
      const rs = r7drv.openReplayStore(home) as R7;
      try {
        r7expect(r7drv.overHideOf(rs.db, 1), 'the ids are capped; the count is the total').toMatchObject({ leaves: 3, hidden: 3, hidden_ids: ['L000001'], hidden_ids_max: 1 });
        r7expect(r7drv.overHideOf(rs.db, 3), 'CONTROL (R29): at the cap every hidden id is listed beside the same total').toMatchObject({ hidden: 3, hidden_ids: ['L000001', 'L000002', 'L000003'], hidden_ids_max: 3 });
        r7expect(r7drv.OVER_HIDE_IDS_MAX, 'R29: the default cap is 1,000 ids').toBe(1000);
      } finally {
        rs.close();
      }
    });
  });
```

- [ ] **Step 4: Run them and see them fail.** In the foreground, with a timeout of at least 600000 ms:

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-5b1 Task 3|three box-mode spawns, one per taught spelling|open wants exactly one mode'
```

The filter selects this task's describe, W2-4 Task 9's case that holds the re-pinned registration line (`three box-mode spawns, one per taught spelling, and a denial …`, about :4785), and W2-5a Task 7's re-pinned case. Expected RED (predicted, written before the code):
- Every case that runs `marker`: exit 2, `args-invalid: unknown subcommand "marker"`.
- Every case that runs `verify --section pilot` or `quiz`: `args-invalid: section "quiz": this build verifies ab only` (or `"pilot"`).
- The format, `requireListed` and over-hide cases: `TypeError: r7drv.headlessTextOf is not a function`, `r7drv.requireListed is not a function`, and `expected undefined` for `ALL_VISIBLE_CUT`.
- The O13 case: no code line names `.headlessOn` where one is expected.
- The `--allow-code-change` case fails at its marker half (`unknown subcommand "marker"`); its verify half would fail too (`this build verifies ab only`, answered before the form's flags are read).
- The registration case: `expected [ 'step0a', …(7) ] to deeply equal [ 'step0a', …(8) ]`.
- `open wants exactly one mode`: `section "judge": this build verifies ab only` in place of `section "judge": verify reads ab, pilot or quiz`.

- [ ] **Step 5: The forms and the dispatch.** In `deploy/history-replay.mjs`:

(a) Directly after the line that begins `  'verify --section ab': { required: ['section', ...DRAFT_INPUT, 'part1', 'part1-sha256', 'frozen', 'frozen-sha256'], optional: [...PRED_INPUT] },` (about :4822), insert:

```js
  // W2-5b1 Task 3 (W2-D84): marker prints one node (--node-label, once); pilot reads part 1, quiz and ab read part 2.
  'marker --section pilot': { required: ['section', ...DRAFT_INPUT, 'node-label'], optional: [...PRED_INPUT] },
  'marker --section quiz': { required: ['section', ...DRAFT_INPUT, 'part1', 'part1-sha256', 'frozen', 'frozen-sha256', 'node-label'], optional: [...PRED_INPUT] },
  'marker --section ab': { required: ['section', ...DRAFT_INPUT, 'part1', 'part1-sha256', 'frozen', 'frozen-sha256', 'node-label'], optional: [...PRED_INPUT] },
  'verify --section pilot': { required: ['section', ...DRAFT_INPUT], optional: [...PRED_INPUT] },
  'verify --section quiz': { required: ['section', ...DRAFT_INPUT, 'part1', 'part1-sha256', 'frozen', 'frozen-sha256'], optional: [...PRED_INPUT] },
```

(b) Replace `verifyCommand`'s doc comment and body, from `/** \`verify --registry | --section ab\` (W2-D84, this PR's half): read-only on one node; a finding is data, exit 0. */` (about :5780) through the function's closing `}`, with:

```js
/** `verify --registry | --section ab | --section pilot | --section quiz` (W2-D84): read-only on one node; a finding is
 *  data, exit 0. --registry and --section ab are W2-5a Task 7's; pilot and quiz are W2-5b1 Task 3's (verifyHeadless). */
export async function verifyCommand(flags, env) {
  const registry = flags.registry === true;
  if (registry === (flags.section !== undefined)) refuse('args-invalid', 'verify wants exactly one of --registry and --section');
  if (registry) return verifyRegistry(flags, env);
  if (flags.section === 'ab') return verifyAb(flags, env);
  if (flags.section === 'pilot' || flags.section === 'quiz') return verifyHeadless(flags.section, flags, env);
  return refuse('args-invalid', `section ${JSON.stringify(flags.section)}: verify reads ab, pilot or quiz`);
}
```

`verifyHeadless` takes the section first, so no line holds `, env,` (W2-4 Task 5's env scan reads `[{,]\s*env\s*[,}]` as passing an env whole).

- [ ] **Step 6: The import names.** If Step 1's first count was below 9, add each missing name (`HEADLESS_LIST_MAX_BYTES`, `asOfBinds`, `asOfHiddenNodesSql`, `formatHeadlessList`, `parseHeadlessList`) to the EXISTING `from '../ccd/history/lib.mjs'` statement, in code-unit order. Never add a statement (Task 1 owns the import block, and the header's `Imports:` sentence already names lib.mjs). No pin names lib.mjs's names (D-5814's `EXACT_NAMES` covers the other ccd/history modules only). If the count was 9, this step changes nothing.

- [ ] **Step 7: Write the section.** In `deploy/history-replay.mjs`, directly above the comment line `// The entry guard stays the LAST block of this file` and after Task 2's section, insert the following.

```js
// ── W2-5b1 Task 3: marker, verify --section pilot|quiz, and the headless-on reader (W2-D84, W2-D76, W2-D78 (i), W2-D24; D-5781) ──
// marker --record <draft|final> --section pilot|quiz|ab --node-label <label> prints ONE node's text, writing nothing
// (W2-D84). It reads the record and nothing else: no HOME, no store, no spawn.
//   pilot  the headless-on marker listing exactly part 1's pilot.families on that node's store (W2-D76, D-5781);
//   quiz   the headless-on marker listing exactly part 2's quiz.families on that node's store;
//   ab     one `ccrc history recall-off <id> --generation <G>` line per control family on that node's store; the
//          generation is always printed, because the W2 flow writes no legacy control file (W2-D27).
// Its text goes to stdout, so `> file` holds the marker's exact bytes, and `sha256 <hex>` of those bytes goes to
// stderr. The marker text is lib's formatHeadlessList, the one producer of it, over the pairs in familyKey order.
// Its TypeError (a grammar fault) and RangeError (a bound: for long ids 65,536 bytes binds before 1,000 pairs) are
// record-invalid, the word D-6309 gives a record the gate signs and the driver cannot run. A store holding no family
// of the section has no marker (input-invalid).
// verify --section pilot|quiz runs read-only on a node (W2-D84): the local store is one of the record's nodes, the
// marker is read once (readHeadlessOn), and the sha256 of what was read is held to the sha256 of the text marker
// prints for this store. Every other answer is its own state, never folded (HEADLESS_ON_STATES). --section quiz also
// counts the leaves lib's node rule hides under the stated all-visible cut (ALL_VISIBLE_CUT): D-6284's over-hide on
// this node (Q16). The arm preflight's W2-D78 (i) is requireListed, over the same reader; Task 4 composes it.
// W2-D24: both re-check the code they run under right after the record validates. Neither declares
// --allow-code-change (Q23 grants it to arms, judge and report only). Neither has --out.
// O13 and W2-D44: the marker is reached only as historyPaths(home).headlessOn, on readHeadlessOn's one line, a read
// through store.mjs's readBounded at HEADLESS_LIST_MAX_BYTES that never follows a link. No line spells the marker's
// path text, and no line pairs a write verb with that field; history-replay.test.ts pins all three.

/** marker's sections (W2-D84). */
export const MARKER_SECTIONS = Object.freeze(['pilot', 'quiz', 'ab']);
export const VERIFY_HEADLESS_KIND = 'ccrc-history-w2-verify-headless';
/** verify --section pilot|quiz's answers for the marker, never folded (W2-D84: "each mismatch kind is reported").
 *  `absent`, `unreadable` (a directory, a link, any other failure) and `over-cap` are readBounded's own; `malformed` is
 *  parseHeadlessList's refusal; `store-other` a store line naming another store; `pairs-differ` a pair missing or extra;
 *  `bytes-differ` the same pairs in other bytes (a comment, another order, a duplicate, no final newline). */
export const HEADLESS_ON_STATES = Object.freeze(['ok', 'absent', 'unreadable', 'over-cap', 'malformed', 'store-other', 'pairs-differ', 'bytes-differ']);
/** The stated all-visible cut of Q16, as lib's asOfBinds turns it into binds: every timed row is shown (ts_ms at most
 *  Number.MAX_SAFE_INTEGER), no copy's later rows are hidden (file -1 holds nothing), no boundary or summary is exempt
 *  (entry -1, null), and no kept member is added. A NULL ts_ms is never shown under any cut (D-5766), so the count is
 *  D-6284's over-hide plus any leaf whose boundary or summary row is untimed. */
export const ALL_VISIBLE_CUT = Object.freeze({ asof: 'all-visible', tsCut: Number.MAX_SAFE_INTEGER, boundaryEntryId: -1, summaryEntryId: null,
  keptUuids: Object.freeze([]), holdingFileId: -1, boundaryLine: -1 });
/** R10: the most hidden leaf ids verify --section quiz lists; the count beside them is always the total. */
export const OVER_HIDE_IDS_MAX = 1000;

/** One marker pair as its line reads (W2-D44): `<ccrc_id> <generation>`, `-` for the legacy one. */
const markerLine = (p) => `${p.ccrcId} ${p.generation === '' ? '-' : p.generation}`;
/** @param {{ccrc_id: string, generation: string}} f */
const familyMarkerLine = (f) => markerLine({ ccrcId: f.ccrc_id, generation: f.generation });

/** The pairs a section's marker lists on one store, in familyKey order by code unit (byFamilyKey): part 1's
 *  pilot.families for the pilot (W2-D76, D-5781), part 2's quiz.families (the frozen list's, validator-held) for the
 *  quiz. A store holding none has no marker: input-invalid, never a bare store line the seam reads as unlisted.
 *  @param {any} record  @param {'pilot' | 'quiz'} section  @param {string} storeId
 *  @returns {Array<{ccrcId: string, generation: string}>} */
export function headlessPairsOf(record, section, storeId) {
  const families = section === 'pilot' ? record.pilot.families : record.quiz.families;
  const pairs = families.filter((f) => f.store_id === storeId).sort(byFamilyKey).map((f) => ({ ccrcId: f.ccrc_id, generation: f.generation }));
  if (pairs.length === 0) refuse('input-invalid', `${section} lists no family on store ${storeId}: that node has no headless-on marker`);
  return pairs;
}
/** The marker text for one store: lib's formatHeadlessList, its errors as record-invalid (D-6309's word).
 *  @param {any} record  @param {'pilot' | 'quiz'} section  @param {string} storeId  @returns {string} */
export function headlessTextOf(record, section, storeId) {
  const pairs = headlessPairsOf(record, section, storeId);
  try {
    return formatHeadlessList({ storeId, pairs });
  } catch (e) {
    if (!(e instanceof TypeError) && !(e instanceof RangeError)) throw e;
    return refuse('record-invalid', `${section} marker for store ${storeId} cannot be formatted: ${e.name}: ${e.message}`);
  }
}
/** ab's lines for one store: each control family's command with its generation (W2-D27), in familyKey order, or ''.
 *  An id idOk refuses, or a generation that is not a UUID, is never printed as a shell line.
 *  @param {any} record  @param {string} storeId  @returns {string} */
export function abCommandsOf(record, storeId) {
  return record.assignment.filter((a) => a.store_id === storeId && a.arm === CONTROL_ARM).sort(byFamilyKey).map((a) => {
    if (!idOk(a.ccrc_id) || !UUID_RE.test(a.generation)) refuse('record-invalid', `ab family ${JSON.stringify(a.ccrc_id)} ${JSON.stringify(a.generation)} cannot be printed as a command`);
    return `ccrc history recall-off ${a.ccrc_id} --generation ${a.generation}\n`;
  }).join('');
}

/** The headless-on marker's one read in this file (W2-D44, W2-D84, W2-D78 (i)): store.mjs's readBounded at the
 *  marker's bound, never following a link, then lib's parseHeadlessList. Five answers, none folded into another:
 *  value (with the text and the parsed list), malformed (with the text), absent, over-cap and unreadable.
 *  @param {string} home */
export function readHeadlessOn(home) {
  const read = readBounded(historyPaths(home).headlessOn, HEADLESS_LIST_MAX_BYTES, false);
  if (read.state === 'absent' || read.state === 'over-cap') return { state: read.state };
  if (read.state !== 'value') return { state: 'unreadable' };
  const list = parseHeadlessList(read.value);
  return list.ok ? { state: 'value', text: read.value, list } : { state: 'malformed', text: read.value };
}
/** The marker against the text marker prints for this store (W2-D84), pure. `ok` is the sha256 comparison alone. The
 *  sha256 is the text's as read: for a marker that is valid UTF-8 that is its bytes' sha256; one holding an invalid
 *  byte reads with U+FFFD (D-5768), which formatHeadlessList's text never holds, so it is malformed and never ok.
 *  @param {ReturnType<typeof readHeadlessOn>} read  @param {string} expected  @param {string} storeId */
export function headlessStateOf(read, expected, storeId) {
  const sha = read.text === undefined ? null : sha256Hex(read.text);
  const none = { sha256: sha, missing: [], extra: [] };
  if (read.state !== 'value') return { state: read.state, ...none };
  if (sha === sha256Hex(expected)) return { state: 'ok', ...none };
  if (read.list.storeId !== storeId) return { state: 'store-other', ...none };
  const want = parseHeadlessList(expected);
  if (!want.ok) throw new TypeError('headlessStateOf: the expected text does not parse; formatHeadlessList never prints such a text');
  const wanted = want.pairs.map(markerLine);
  const got = new Set(read.list.pairs.map(markerLine));
  const missing = wanted.filter((l) => !got.has(l));
  const extra = [...got].filter((l) => !wanted.includes(l)).sort();
  return { state: missing.length + extra.length > 0 ? 'pairs-differ' : 'bytes-differ', sha256: sha, missing, extra };
}

/** W2-D78 (i), pure: why a batch is unlisted, or null. Fail closed: every answer but a parsed value is unlisted; the
 *  store line must be this store; each (ccrc_id, generation) must be a listed pair, by id AND generation.
 *  @param {ReturnType<typeof readHeadlessOn>} read  @param {string} storeId
 *  @param {Array<{store_id: string, ccrc_id: string, generation: string}>} families  @returns {string | null} */
export function unlistedOf(read, storeId, families) {
  if (read.state !== 'value') return `headless-on ${read.state}`;
  if (read.list.storeId !== storeId) return `headless-on names store ${read.list.storeId}, not this store ${storeId}`;
  const listed = new Set(read.list.pairs.map(markerLine));
  const missing = families.filter((f) => f.store_id !== storeId || !listed.has(familyMarkerLine(f)));
  return missing.length === 0 ? null : `not listed for store ${storeId}: ${missing.map(familyMarkerLine).join(', ')}`;
}
/** W2-D78 (i), the arm preflight's read: refuses family-unlisted unless every batch pair is on this store's marker.
 *  Read-only, before any spawn; Task 4 calls it before every arm batch.
 *  @param {string} home  @param {string} storeId  @param {Array<{store_id: string, ccrc_id: string, generation: string}>} families */
export function requireListed(home, storeId, families) {
  const why = unlistedOf(readHeadlessOn(home), storeId, families);
  if (why !== null) refuse('family-unlisted', why);
}

/** D-6284's over-hide on this node (Q16, R10): every leaf of the store, bound as one JSON array to lib's node rule
 *  (asOfHiddenNodesSql, through Task 2's prepared armStmts statement, so the rule is named on one line) under
 *  asOfBinds(ALL_VISIBLE_CUT). The total is always given; the ids listed are the first `max`, sorted. Read-only; nothing
 *  gates on it. An SQLite failure is store-unreadable (storeRefusal), never an internal error.
 *  @param {{prepare: (sql: string) => {all: (...a: any[]) => any[]}}} db  @param {number} [max] */
export function overHideOf(db, max = OVER_HIDE_IDS_MAX) {
  try {
    const ids = db.prepare("SELECT node_id FROM nodes WHERE kind <> 'condensed' ORDER BY node_id").all().map((r) => String(r.node_id));
    const binds = asOfBinds(ALL_VISIBLE_CUT);
    const hidden = ids.length === 0 ? [] : armStmts(db).hidden.all({ ...binds, asof_nodes: JSON.stringify(ids) }).map((r) => String(r.node_id)).sort();
    return { cut: 'all-visible', binds, leaves: ids.length, hidden: hidden.length, hidden_ids: hidden.slice(0, max), hidden_ids_max: max };
  } catch (e) {
    return storeRefusal(e);
  }
}

export function verifyHeadlessReport({ recordSha256, storeId, section, expectedSha256, found, overHide }) {
  return { kind: VERIFY_HEADLESS_KIND, v: 1, record_sha256: recordSha256, store_id: storeId, section, expected_sha256: expectedSha256,
    found, ok: found.state === 'ok', over_hide: overHide };
}

/** Text on stdout as it is, `sha256 <hex>` of exactly those bytes on stderr (W2-D84: the content plus its sha256). */
function printTextWithSha(text) {
  process.stdout.write(text);
  process.stderr.write(`sha256 ${sha256Hex(text)}\n`);
  return EXIT.OK;
}

/** `marker --record <draft|final> --section pilot|quiz|ab --node-label <label>` (W2-D84). The section is checked before
 *  its form's flags; the record validates, then the code it runs under (W2-D24); then the node is looked up by label.
 *  @param {Flags} flags  @returns {Promise<number>} */
export async function markerCommand(flags) {
  const section = flags.section;
  if (section === undefined) refuse('args-invalid', 'section-required');
  if (typeof section !== 'string' || !MARKER_SECTIONS.includes(section)) refuse('args-invalid', `section ${JSON.stringify(section)}: marker prints ${MARKER_SECTIONS.join(', ')}`);
  checkFlags(`marker --section ${section}`, flags);
  const labels = /** @type {string[]} */ (flags['node-label']);
  if (labels.length !== 1) refuse('args-invalid', `marker prints one node: --node-label given ${labels.length} times`);
  const rec = loadRecordInput(flags, section === 'pilot' ? 'draft' : 'final');
  recheckCode(rec.record);   // W2-D24 (marker)
  const node = rec.record.nodes.find((n) => n.label === labels[0]);
  if (node === undefined) refuse('args-invalid', `node-label ${JSON.stringify(labels[0])} names no node of the record`);
  return printTextWithSha(section === 'ab' ? abCommandsOf(rec.record, node.store_id) : headlessTextOf(rec.record, section, node.store_id));
}

/** `verify --section pilot|quiz` (W2-D84), read-only on this node: the record validates, then the code (W2-D24), then
 *  the run's one store open (W2-5a's R3) names this node, which must be one of the record's. */
async function verifyHeadless(section, flags, env) {
  checkFlags(`verify --section ${section}`, flags);
  const home = subcommandHome(env);
  const rec = loadRecordInput(flags, section === 'pilot' ? 'draft' : 'final');
  recheckCode(rec.record);   // W2-D24 (verify --section pilot|quiz)
  const rs = openReplayStore(home);
  try {
    const storeId = rs.storeId;
    requireNamedNode(rec.record, storeId);
    const expected = headlessTextOf(rec.record, section, storeId);
    const found = headlessStateOf(readHeadlessOn(home), expected, storeId);
    const overHide = section === 'quiz' ? overHideOf(rs.db) : null;
    return printWithSha(verifyHeadlessReport({ recordSha256: rec.sha256, storeId, section, expectedSha256: sha256Hex(expected), found, overHide }));
  } finally {
    rs.close();
  }
}

HANDLERS.set('marker', markerCommand);
```

- [ ] **Step 8: Run them and see them pass, then the typecheck.** In the foreground, with a timeout of at least 600000 ms, one suite per tool call:

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-5b1 Task 3|three box-mode spawns, one per taught spelling|open wants exactly one mode'
```

```bash
cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
```

Expected (predicted): green. That covers every case of this task's describe (32 tests: 12 single cases, the CONTROL among them, plus the 10-row state table and the two 5-row code tables), the registration case and W2-5a's re-pinned case. `typecheck-tests` is green: the test-side lib names are W2-2b's declared ones (`lib.d.mts`), and each `r7drv.*` call whose JSDoc type is inferred too narrowly is cast at the call site, never by loosening the driver's JSDoc. Record the measured pass count in the commit's task note.

- [ ] **Step 9: Measure every guard red, then green.** From the repository root. Each block applies one exact replacement, which must match exactly once, runs one filter and shows it red, then restores the file with `cp`. The python body is a quoted heredoc. The "Expected RED" lines are predicted. Measure each one; if a measurement differs, record the corrected prediction in a separate `docs(plan): … (W2-5b1 Task 3)` commit touching only this plan (R25). Run the block one mutant per tool call (Global Constraints' "One mutant per tool call").

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w2-5b1/scratch"; mkdir -p "$SCRATCH"
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
cp "$F" "$SCRATCH/replay.t3.orig"
t() { (cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t "$1"); cp "$SCRATCH/replay.t3.orig" "$F"; }

# M1 (W2-D84): ok decided by the parsed pairs, not the bytes' sha.
mut "$F" "  if (sha === sha256Hex(expected)) return { state: 'ok', ...none };" "  if (read.list.storeId === storeId && read.list.pairs.map(markerLine).join() === parseHeadlessList(expected).pairs.map(markerLine).join()) return { state: 'ok', ...none };"
t 'as itself, never folded'
# Expected RED: 2 failed (the comment row and the no-final-newline row read ok); the order row stays bytes-differ.

# M2 (W2-D84): the store line not checked.
mut "$F" "  if (read.list.storeId !== storeId) return { state: 'store-other', ...none };" ""
t 'as itself, never folded'
# Expected RED: 1 failed, the store-other row: 'bytes-differ' (the same pairs).

# M3 (W2-D84): every difference read as pairs-differ.
mut "$F" "  return { state: missing.length + extra.length > 0 ? 'pairs-differ' : 'bytes-differ', sha256: sha, missing, extra };" "  return { state: 'pairs-differ', sha256: sha, missing, extra };"
t 'as itself, never folded'
# Expected RED: 3 failed, the three bytes-differ rows.

# M4 (W2-D84, never folded): over-cap read as unreadable.
mut "$F" "  if (read.state === 'absent' || read.state === 'over-cap') return { state: read.state };" "  if (read.state === 'absent') return { state: read.state };"
t 'as itself, never folded|requireListed passes a batch'
# Expected RED: 2 failed: the over-cap row ('unreadable') and the requireListed case ('headless-on unreadable' for over-cap).

# M5 (W2-D84, never folded): unreadable read as absent.
mut "$F" "  if (read.state !== 'value') return { state: 'unreadable' };" "  if (read.state !== 'value') return { state: 'absent' };"
t 'as itself, never folded|requireListed passes a batch'
# Expected RED: 3 failed: the directory and link rows ('absent'), and the requireListed case.

# M6 (W2-D44): the marker read through a link.
mut "$F" "readBounded(historyPaths(home).headlessOn, HEADLESS_LIST_MAX_BYTES, false)" "readBounded(historyPaths(home).headlessOn, HEADLESS_LIST_MAX_BYTES, true)"
t 'as itself, never folded|requireListed passes a batch|O13: the driver names'
# Expected RED: 3 failed: the link row reads 'ok'; the requireListed case (the link reads as listed: null where
# 'headless-on unreadable' was expected); the O13 line pin.

# M7 (W2-D44): the bound doubled.
mut "$F" "historyPaths(home).headlessOn, HEADLESS_LIST_MAX_BYTES, false)" "historyPaths(home).headlessOn, 2 * HEADLESS_LIST_MAX_BYTES, false)"
t 'as itself, never folded|requireListed passes a batch|O13: the driver names'
# Expected RED: 3 failed: the over-cap row reads 'malformed' (the parser's own bound); the requireListed case
# ('headless-on malformed'); the O13 line pin.

# M8: formatHeadlessList's TypeError escapes.
mut "$F" "    if (!(e instanceof TypeError) && !(e instanceof RangeError)) throw e;" "    if (!(e instanceof RangeError)) throw e;"
t 'a family list no marker can carry'
# Expected RED: 1 failed, a TypeError thrown through refusalOf where a record-invalid refusal was expected.

# M9: neither error mapped.
mut "$F" "    if (!(e instanceof TypeError) && !(e instanceof RangeError)) throw e;" "    throw e;"
t 'a family list no marker can carry'
# Expected RED: 1 failed, a RangeError thrown through refusalOf.

# M10: a store holding no family prints a bare store line.
mut "$F" "  if (pairs.length === 0) refuse(" "  if (false) refuse("
t 'marker and verify refuse, each with its word'
# Expected RED: 1 failed. marker --section pilot --node-label node-b exits 0 with 'store <STORE_B>\n'.

# M11 (W2-D78 (i)): the generation left out of the pair.
mut "$F" "  const missing = families.filter((f) => f.store_id !== storeId || !listed.has(familyMarkerLine(f)));" "  const missing = families.filter((f) => f.store_id !== storeId || !read.list.pairs.some((p) => p.ccrcId === f.ccrc_id));"
t 'requireListed passes a batch'
# Expected RED: 1 failed, 'the generation is part of the pair': null.

# M12 (W2-D78 (i)): the store line not checked.
mut "$F" "  if (read.list.storeId !== storeId) return \`headless-on names" "  if (false) return \`headless-on names"
t 'requireListed passes a batch'
# Expected RED: 1 failed, 'the store line': null.

# M13 (W2-D78 (i)): an unread marker lists everything.
mut "$F" "  if (read.state !== 'value') return \`headless-on \${read.state}\`;" "  if (read.state !== 'value') return null;"
t 'requireListed passes a batch'
# Expected RED: 1 failed, the absent marker: null where 'headless-on absent' was expected.

# M14 (W2-D24): marker skips the code re-check.
mut "$F" "  recheckCode(rec.record);   // W2-D24 (marker)" ""
t 'Task 3: marker and verify section pilot and quiz (code-changed before|code-unmeasured, never)'
# Expected RED: 6 failed, the three marker rows of each table (exit 0 with the marker text).

# M15 (W2-D24): verify skips the code re-check.
mut "$F" "  recheckCode(rec.record);   // W2-D24 (verify --section pilot|quiz)" ""
t 'Task 3: marker and verify section pilot and quiz (code-changed before|code-unmeasured, never)'
# Expected RED: 4 failed, the two verify rows of each table ('store-unreadable: store-missing').

# M16 (W2-D84): verify on a store the record does not name.
mut "$F" "    requireNamedNode(rec.record, storeId);
    const expected = headlessTextOf(" "    const expected = headlessTextOf("
t 'marker and verify refuse, each with its word'
# Expected RED: 1 failed. On STORE_C, 'quiz lists no family on store …' in place of 'store … is not one of the record's nodes'.

# M17: ab prints every assigned family, not only the control ones.
mut "$F" "a.store_id === storeId && a.arm === CONTROL_ARM" "a.store_id === storeId"
t 'exact text on stdout'
# Expected RED: 1 failed, the ab rows carry the treatment families' lines.

# M18 (W2-D27, the W2-1 plan's rule): ab without --generation.
mut "$F" "ccrc history recall-off \${a.ccrc_id} --generation \${a.generation}" "ccrc history recall-off \${a.ccrc_id}"
t 'exact text on stdout'
# Expected RED: 1 failed.

# M19 (Q16): the count binds every node, condensed ones included.
mut "$F" "FROM nodes WHERE kind <> 'condensed' ORDER BY node_id" "FROM nodes ORDER BY node_id"
t 'counts the leaves|a stored summary on the timed leaf'
# Expected RED: 2 failed, leaves 4 where 3 was expected (the empty-store half of the CONTROL stays 0).

# M20 (Q16): a cut that is not all-visible.
mut "$F" "tsCut: Number.MAX_SAFE_INTEGER" "tsCut: 0"
t 'counts the leaves|a stored summary on the timed leaf'
# Expected RED: 1 failed, hidden 3 (L000001 too) and asof_ts 0; the CONTROL, which hides all three anyway, stays green.

# M21 (Q16): no count.
mut "$F" "    const overHide = section === 'quiz' ? overHideOf(rs.db) : null;" "    const overHide = null;"
t 'counts the leaves|a stored summary on the timed leaf'
# Expected RED: 2 failed, over_hide null.

# M22 (O13): a second line naming the marker's field, a writer, never called.
mut "$F" "export function requireListed(home, storeId, families) {" "function dropMarker(home) { rmSync(historyPaths(home).headlessOn, { force: true }); }
export function requireListed(home, storeId, families) {"
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'pairs a write verb with a switch symbol')
t 'O13: the driver names'
# Expected RED: single-definition's symbolic O13 case, 1 failed (deploy/history-replay.mjs: the rmSync line); this
# file's O13 case, 1 failed (two .headlessOn code lines, and one paired with a write verb).

# M23 (W2-D84): marker writes its text beside the cwd.
mut "$F" "function printTextWithSha(text) {
  process.stdout.write(text);" "function printTextWithSha(text) {
  writeFileSync('marker.out', text);
  process.stdout.write(text);"
t 'write nothing'
# Expected RED: 1 failed, the HOME tree (run7's cwd) gains marker.out.

# M24 (R10): the hidden ids uncapped.
mut "$F" "hidden_ids: hidden.slice(0, max), hidden_ids_max: max" "hidden_ids: hidden, hidden_ids_max: max"
t 'a stored summary on the timed leaf'
# Expected RED: 1 failed, the capped call lists all three ids.

# M25 (R29): the cap is not the ruled 1,000.
mut "$F" "export const OVER_HIDE_IDS_MAX = 1000;" "export const OVER_HIDE_IDS_MAX = 100;"
t 'a stored summary on the timed leaf|counts the leaves lib'
# Expected RED: 1 failed, the R29 row: 100 against 1000. The verify case reads hidden_ids_max through the export, so it
# stays green: the literal row is the pin.

# M26 (R29): the total folded to the listed ids, so a capped list hides how many were hidden.
mut "$F" "leaves: ids.length, hidden: hidden.length," "leaves: ids.length, hidden: Math.min(hidden.length, max),"
t 'a stored summary on the timed leaf'
# Expected RED: 1 failed, the capped call's hidden 1 against 3; the CONTROL at the cap (3) reads 3 either way.

cmp "$F" "$SCRATCH/replay.t3.orig" && echo restored
```

Each `t` restores the driver after its run. M22 runs the single-definition case before `t` restores, so the driver is mutated for both runs. The final `cmp` must print `restored`.

- [ ] **Step 10: Run the neighbours that read the driver.** In the foreground, with a timeout of at least 600000 ms, one suite per tool call. If a file goes red, re-run it alone before calling it a break (CLAUDE.md's load flakes; `typecheck-tests` is one):

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts
```

```bash
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'operator switches have readers only|pairs a write verb with a switch symbol|recall-off|every vocabulary is declared once'
```

```bash
cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
```

Expected: green (predicted):
- `history-replay`: every earlier task's cases, the two re-pinned lines, and this task's. W2-4 Task 7's recall-off line pin still reads two `recallOffPath(` code lines (W2-4's lstat and W2-5a's `controlFileOf`) and no line spelling the directory: `abCommandsOf`'s line spells `history recall-off ` with a space before it and no slash or quote. W2-4 Task 5's env scan finds no `, env,` (`verifyHeadless` takes the section first). Task 1's arm-word scan finds no quoted arm word in this task's lines.
- `single-definition`:
  - O13's holders scan (its needle is the marker's path with a slash) finds no driver line.
  - Its symbolic scan finds `.headlessOn` on one driver line, a `readBounded` read with no write verb.
  - Its recall-off case still counts one driver `lstatSync(recallOffPath(` line, and `abCommandsOf`'s line holds no write verb.
  - O14: no name this task declares is a `VOCABS` name.
- `typecheck-tests`: green.

- [ ] **Step 11: Commit.**

```bash
git add deploy/history-replay.mjs server/test/history-replay.test.ts
CO_AUTHORED_BY='<the Co-Authored-By line the attribution reminder gives>'
git commit -m "feat(history-replay): marker, verify --section pilot|quiz and the headless-on reader the arm preflight asks (W2-5b1 Task 3; W2-D84, W2-D76, W2-D78, W2-D24; D-5781)" \
  -m "In place (R27): one line of W2-5a Task 7's case 'open wants exactly one mode, and verify exactly one of --registry and --section ab': verify --section quiz is now a verify section, so the line asks --section judge and expects 'verify reads ab, pilot or quiz'; no W2-5a W2-D24 re-check case is edited." \
  -m "$CO_AUTHORED_BY"
```

### Task 4: The arm engine: `arms --section pilot|quiz`, both arms of each question in batches, preflighted before every batch, with the one re-run, the manifests, the answer records and the summary

This task turns Tasks 1 to 3's pieces into the operator's arm batches (W2 decisions §5, act 14's usage pilot and act 21). It adds one subcommand, `arms`, in two forms, and registers it in `HANDLERS`. It also owns the readers Task 5's judge shares with it (R8, R26): `loadArmRun`, `armNodeOf` and `readArmAnswers`, and `refuseSpawnAdmission` and `preflightSpawn`, factored out of W2-5a's writer code with its behaviour and pins unchanged:
- **`arms --section pilot`** runs after part 1 on the one pilot node (R9 of W2-5a), in a fresh `--out` (Q25). It reads the pilot frozen list that `pilot-source` wrote, whose sha must be part 1's `pilot.frozen_sha256`. It runs under part 1's `pilot_budget`, `limits`, `account`, `arm_model` and `settings_mode` (W2-D55: "from part 1 to part 2").
- **`arms --section quiz`** runs after part 2 on each named node, in that node's own `--out` (Q2). It reads part 2 with its `--part1` and its frozen list (Task 1's `loadFinalRecord`, through `loadArmRun`), and runs only the questions whose `store_id` is this node's store. Its budget is this node's share of `spend_budget` (Q5), and its settings mode is part 2's `pilot_result.settings_mode` (Q26).

Both forms share one engine:
- **The batch shape (Q3).** Both arms of a question run side by side, at the record's `limits.concurrency` (default 2). A batch holds `floor(limits.batch_max / RECALL_ARMS.length)` questions (5 per 10-job batch by default), in frozen qid order. Batches loop inside one invocation, and the per-batch preflight runs before each.
- **The preflight, composed once (`armBatchPreflight`).** Before every batch, in this order:
  - W2-D78 (i) through Task 3's `requireListed` (`family-unlisted`) and (ii) through W2-4's `refuseRecallOff` (`family-recall-off`);
  - (iii) through Task 2's `recheckBatch` (`quiz-unanswerable`, naming each failing qid and its clause), then each question's two payloads through Task 2's `armPayloads` (`plain` for the control arm, `carded` for the treatment arm), a payload that no longer reconstructs refused `quiz-unanswerable` `<qid> payload <word>` (D-6469);
  - `preflightSpawn` (R26): the wrapper's sha (`wrapper-unmeasured`), then `batchGate` with the record's limits and the budget in force (W2-D55);
  - then the one spawn the preflight makes, `--version`, and W2-D56's `preflight`. Its `expected` is part 1's step 0a entry for this node, with `claude_code_version` replaced by the node's newest `version-move` amendment when part 2 carries one (W2-D56, W2-D90, Q13).
- **Before `--out` (W2-5a's R10, D-6307, D-6311, D-6309's rule).** Every refusal that needs no spawn answers before `prepareOut` makes `--out`:
  - the record and `gate_code`, then the frozen list and the settings mode (`loadArmRun`: Task 1's `loadFinalRecord` for the quiz; part 1, `recheckCode` and the pilot list for the pilot; W2-D24 first);
  - the store open and the named node, this node's questions, the share, the `expected` reading (`armNodeOf`);
  - the ranges with the batch shape (`refuseOutOfRangeValues` with `batch`: Task 1's `batchShapeChecks`, R4), then `refuseSpawnAdmission` (R26): the roster, the account, the wrapper, the limits row and `preflightFiles`;
  - W2-D78 (i) and (ii) over every question of this node.
  
  Each is asked again before every batch, which is the authority.
- **Attempts (Q4, W2-D80).** A run's attempt is in its name, `<section>/arms/<qid>/<arm>.a<n>`. A recorded run (its `run.json` written by W2-4's `launchRun`) is classified by the gate's `classifyRun` over its stream's events, with `{spawned: true, stopped: false}`. A driver timeout has no result event, so it is `infra-failed`. An arm's outcome is the gate's `questionOutcome` over its recorded attempts. A first infrastructure failure is re-run once as attempt 2, in a later batch, per arm (R14); a second makes the arm `run-failed`. A question is `run-failed` when either arm is, and is then excluded from both arms (W2-D80), so no further run of it is spawned.
- **A stop never consumes the re-run (W2-D80, Q24).** A stop writes no `run.json` (W2-4), so a stopped attempt is never an attempt: it keeps its number and is resumed. A question with no recorded run is `not-run`, the emergent rule.
- **What is written under `--out`.**
  - The per-batch manifest (Q14): `<section>/arms/batches/<NNNN>.json`, written after the preflight and before the batch spawns, with the version the preflight measured, the stamps, and the batch's run names with each stdin's sha.
  - One answer record per `(qid, arm)` once the question settles (W2-D82, W2-D64): `<section>/answers/<qid>.<arm>.json`, with the answer field, `labelCorrect`, `absent`, the raw reply (R16), the uptake facts with `via_agent` from Task 1's `parentToolUseId`, and every `error` field each attempt carried (Q31). `readArmAnswers` reads them back for the judge.
  - The summary (Q30): `<section>/arms/summary.json`, rewritten after the last batch and on every refusal once `--out` is claimed, except after `interrupted` (R15). It carries the counts, the per-arm rates (the absent rate as `{num, den}`, W2-D64), the budget in force and, on a stop, its word, its kind from Task 1's `DRIVER_STOPS` partition (C6, Q24) and its detail.
- **What is printed.** One stderr line names the stop and the not-run count, and nothing is retried automatically (Q30). On success the subcommand prints `sha256 <hex>` of the summary on stderr, and stdout stays empty (D-5983). The quiz form first prints its spend share on stderr, `spend share <s> = ceil(<B> x <n> / <N>)` (Q5, R17); the summary records the share too.

The arm words are never spelled: every per-arm value is keyed by `RECALL_ARMS`' members at run time (W2-D42; Task 1's scan holds it). The subcommand never reads or writes headless-on itself (Task 3's reader does; O13).

**Files:**
- Modify: `deploy/history-replay.mjs`.
  - (a) The gate's import statement (Task 1's, about :43 at c34f82830): `QUESTION_OUTCOMES` is added, in code-unit order (Task 1 imported `classifyRun`, `labelCorrect`, `parseAnswerField` and `questionOutcome`; Step 1 measures them). No statement is added (Task 1 owns the import block and its header sentence; the gate's names are not in Task 1's `EXACT_NAMES` pin).
  - (b) `const SUBCOMMAND_FLAGS = Object.freeze({` (about :4811): two forms, `'arms --section pilot'` and `'arms --section quiz'`, inserted as the last two entries, directly before the `});` that closes the object. That is after Tasks 1 to 3's entries, if any.
  - (c) `function loadFrozen(p, sha256) {` (about :4884) gains a `section = 'quiz'` parameter, passed to `loadFrozenList` in place of the literal `'quiz'` (about :4889). Its two W2-5a callers keep the default.
  - (d) `export function refuseOutOfRangeValues({` (about :5405, as Task 1 left it): its destructured parameter gains `batch = false`, which adds Task 1's `batchShapeChecks(limits)` rows before the `part2` rows (R4: `arms` on part 1 asks the batch shape too). Its JSDoc gains one sentence.
  - (e) `function refuseWriterAdmission({ home, accountId, budget, limits, quotas, expected }) {` (about :5435): its body after the range check becomes `refuseSpawnAdmission`, a function of its own directly below it, which also takes `allowCodeChange = false` and passes `{ allowCodeChange }` to `preflightFiles` (R26). The writer passes none, so its words and order are unchanged; `arms` and `judge` pass theirs, so a measured change after window start under `--allow-code-change` is a stamp before `--out`, as the batch preflight makes it.
  - (f) `openWriter`'s `preflightNow` (about :4335): its body becomes one call of `preflightSpawn`, declared in this task's section (R26), whose order, words and stamps are `preflightNow`'s, byte for byte.
  - (Step 6) One new section, `// ── W2-5b1 Task 4: the arm engine`, directly above the comment line `// The entry guard stays the LAST block of this file` (about :5796), after Task 3's section. It ends with `HANDLERS.set('arms', …)`.
- Modify: `server/test/history-replay.test.ts`.
  - Re-pin W2-4 Task 9's registration-order line, `expect([...t9Driver.HANDLERS.keys()]).toEqual([...])` (about :4824 at c34f82830, inside the `it` titled `three box-mode spawns, one per taught spelling, and a denial for one spelling is recorded for that one only; exit 0`). The array Task 3 left gains `'arms'` at its end.
  - Append three describes with their own import block (prefix `w5b4`) at the end of the file: the pure parts; `arms` on the stub; and one end-to-end case over W2-5a Task 6's swept `w6SourceBox`. The two that spawn this task's arm stub skip on darwin, as the sweep's describes do (this task's own choice; W2-4's RP1-contract and W2-5a's writer-spawn describes run everywhere, Global Constraints' macOS bullet).
- Not edited: `deploy/history-gate.mjs`, `deploy/measure-history.py`, `ccd/**`, `shared/**`, the spec, `README.md`, `.github/**`, and every other test file. `single-definition.test.ts` and `measure-history.test.ts` are re-run, never edited.

**Interfaces:**
- Consumes (base, `deploy/history-gate.mjs`, W2-3; never edited):
  - `classifyRun(events: unknown[], exitCode: number | null, ctx: {spawned: boolean, stopped: boolean}): 'answered' | 'infra-failed' | 'not-run'`, which throws `TypeError` on an exit code that is neither an integer nor null;
  - `questionOutcome(attempts: RunClass[]): 'answered' | 'rerun' | 'run-failed' | 'not-run'`;
  - `QUESTION_OUTCOMES`;
  - `parseAnswerField(finalText: string): {state: 'value', value: string} | {state: 'unknown'} | {state: 'absent'}`;
  - `labelCorrect(kind, F, answerValue, {repoRoots, shaMinPrefix}): boolean`;
  - `recordSha256`, `assignmentSha256` and `LABELLER` (tests only).
- Consumes (base, `ccd/history/lib.mjs`): `isHistoryCommand(command): boolean`, `canonicalJson`, `sha256Hex`, `recallOffPath` (through `refuseRecallOff`); tests also use `historyPaths(home).headlessOn` and `formatHeadlessList` (W2-2b).
- Consumes (W2-4 and W2-5a, base):
  - `runBatch(jobs, {gate, claim, concurrency})`, `launchRun`'s file order (a stopped run writes no `run.json`), the module-private `finishedOutcome(job)` (a recorded run's `{code, signal, tokens, streamPath, facts}`, or null), `readPlain`, `lstatOrNull`, `ensurePlainDir`, `writePlain`, `shaOfPlain`, `errCode`, `plainObject`, `OUT_STREAM_CAP`;
  - `prepareOut`, `refuseColonInRealOut`, `claimOut`, `readRoster`, `admitAccount`, `batchGate`, `spentSoFar`, `wrapperSha`, `measureClaudeVersion`, `refuseIfStopping`, `readReleaseStamp`, `codeShas`, `preflight`, `refuseRecallOff`, `refuseUnusableInputs`, `SETTINGS_MODES`, `BATCH_MAX`, `CONCURRENCY_MAX`, `DriverRefusal`, `refuse`, `HANDLERS`, `EXIT`;
  - W2-5a: `checkFlags`, `subcommandHome`, `requireNamedNode`, `openReplayStore` (`{db, storeId, idx, close}`), `loadFrozen`, `familiesOf`, `refuseWriterAdmission`, `refuseOutOfRangeValues`, `PILOT_SOURCE_FILE`, `DRAFT_INPUT`, `PRED_INPUT`; tests also use `buildDraft`, `buildFinal`, `frozenListText`, `qidOf`, `contractFlags`, `reconstructPayload`, `STEP0A_KIND` and `PILOT_SOURCE_KIND`.
- Consumes (Tasks 1 to 3 of this plan, by their owners' names, R8). Step 1 checks each name and shape. A name that is missing, or whose shape differs, is a gap in its owning task: stop and report it, never define it here.
  - **Task 1:** lib's `RECALL_ARMS` in the import block, `CONTROL_ARM` and `TREATMENT_ARM`; `ToolPair.parentToolUseId: string | null` on `readStreamJson`'s pairs; `DRIVER_STOPS: readonly string[]`, the stop half of `DRIVER_REASONS`' partition (C6, Q24), and `driverWordClass(word): 'stop' | 'refusal'` over it, which `reportArmsStop` calls; `FLAG_SPECS['allow-code-change'] === 'bool'`; `loadFinalRecord(flags, {nowMs, root}): {record, sha256, frozen, stamps}` (the final with its chain, W2-D24's re-check first with Q23's stamp after window start, then the part 2 ranges, all before `--out`); `recheckCode(record)`, which answers the stamps; `refuseOutOfRangeValues`' `budgetField` and `quotas: null`; the module-private `batchShapeChecks(limits)` (R4, R28: its floor is `RECALL_ARMS.length`), `versionMoveChecks(r)` and `refuseRangeRows(checks)` (R30: `expectedForNode` reads the version-move ranges through these two, never a second spelling); `VERSION_MOVE_KIND`.
  - **Task 2:** `recheckBatch(rs, entries, {configDirs}): Promise<Map<qid, {ok: true, boundaryEntryId, cut}>>`, refusing `quiz-unanswerable` `<qid> clause (<a|b|c>) <why>` for every failing question; `armPayloads(rs, boundaryEntryId, question, cut): {state: 'payloads', plain, carded, card, counts} | {state: 'discard', why}`: `plain` byte-identical to `reconstructPayload`'s text, `carded` the card line, one blank line, then `plain` (Q20).
  - **Task 3:** `requireListed(home, storeId, families: Array<{store_id, ccrc_id, generation}>): void`, W2-D78 (i): one bounded read of headless-on, the store line equal to `storeId`, and every `(ccrc_id, generation)` listed, else `family-unlisted`.
- Produces (`deploy/history-replay.mjs`, all exported unless marked private):
  - Constants: `ARM_SECTIONS = ['pilot', 'quiz']`, `ARM_ATTEMPTS_MAX = 2`, `ARM_BATCH_KIND = 'ccrc-history-w2-arm-batch'`, `ANSWER_KIND = 'ccrc-history-w2-answer'`, `ARMS_SUMMARY_KIND = 'ccrc-history-w2-arms-summary'`.
  - The arm run's readers, which Task 5's judge shares (R8, R26):
    - `loadArmRun(flags, section, {nowMs}): ArmRun`, `ArmRun = {section, record, recordSha256, frozen: {sha256, list: {entries}}, settingsMode, allowCodeChange: boolean, codeStamps: string[]}`: for `quiz` Task 1's `loadFinalRecord` (settings mode part 2's `pilot_result.settings_mode`, Q26); for `pilot` part 1 through W2-5a's `loadRecordInput(flags, 'draft')`, `recheckCode` (no flag, Q23) and the pilot frozen list, then part 1's `settings_mode`, a `SETTINGS_MODES` word or `record-invalid` `settings_mode out-of-range` (the validator types it without ranging it; pinned red-first with a CONTROL and a mutant, R31). It reads no store, spawns nothing and writes nothing;
    - `armNodeOf(run, storeId): ArmNode`, `ArmNode = {questions, nAll, account, expected, budget: number, limits, settingsMode}`: `requireNamedNode`, this node's questions in frozen qid order, the budget in force (part 1's `pilot_budget`, or this node's share of `spend_budget`, Q5) and W2-D56's `expected` (`expectedForNode`);
    - `readArmAnswers(out, section): ArmAnswer[]`, `ArmAnswer = {qid, arm, outcome, reply, correct}`: each answer record this `--out` holds for the section, `outcome` its `arm_state`, `reply` the answered attempt's raw result text, `correct` its `labelCorrect` flag; a file it cannot read (a link, never followed, a directory, an unreadable file: `<rel>/<name> <readPlain's word>`), bytes that are not JSON, or one that is not an answer record of the section under its own name, refuses `out-refused` (each pinned red-first with a CONTROL and a mutant, R31);
    - module-private `refuseSpawnAdmission({home, accountId, limits, expected, allowCodeChange})` (`refuseWriterAdmission`'s no-store half) and `preflightSpawn({launch, home, out, lang, gate, expected, allowCodeChange}): Promise<{version: string, stamps: string[]}>` (`openWriter`'s `preflightNow`).
  - Paths, pure: `armRunName(section, qid, arm, attempt): string` (`<section>/arms/<qid>/<arm>.a<attempt>`), `answerRel(section, qid, arm): string` (`<section>/answers/<qid>.<arm>.json`), `armsSummaryRel(section): string` (`<section>/arms/summary.json`). Each throws `TypeError` for a section outside `ARM_SECTIONS` or an arm outside `RECALL_ARMS`, and `armRunName` also for an attempt outside 1 to `ARM_ATTEMPTS_MAX`.
  - Pure functions:
    - `spendShareOf(budget, nNode, nAll): number`, `ceil(budget × nNode / nAll)` in BigInt (Q5);
    - `questionStateOf(armStates): QuestionOutcome`;
    - `questionCountsOf(states): {questions, answered, run_failed, rerun_owed, not_run}`;
    - `streamEventsOf(text): object[]`;
    - `errorFieldsOf(events): string[]`;
    - `uptakeOf(toolPairs): {calls, via_agent, errored}`;
    - `armAnswerOf(entry, facts, shaMinPrefix): {answer_field, correct, absent, reply, uptake}`;
    - `expectedForNode(record, storeId): {expected: {claude_code_version, release_stamp, wrapper_sha256, code_shas}, from: string}`, which refuses `input-invalid` for a store that names no node, and `record-invalid` for a version-move whose `node_label_ref` names no node or whose detail has no version, through Task 1's `versionMoveChecks` and `refuseRangeRows` (R30), so its refusal is `loadFinalRecord`'s, word and detail;
    - `armsSummaryOf({section, recordSha256, storeId, budget, spend, batches, stop, stamps, questions}): ArmsSummary`.
  - The command: `armsCommand(flags, driverEnv, deps = { recheck: recheckBatch, payloads: armPayloads, now: () => Date.now() })`, registered as `arms`. A test injects `deps.recheck`, `deps.payloads`, `deps.now` and `deps.timeoutMs` (a run timeout shorter than W2-4's 30 minutes); no flag takes any of them.
  - Module-private:
    - `ARM_BATCH_FILE_RE`, `QUESTION_COUNT_KEYS`, `armBatchDir`;
    - `loadPilotFrozen`, `nodeQuestions`;
    - `armJob`, `armAttemptsOf`, `answeredAttempt`, `questionArmsOf`;
    - `armBatchPreflight`, `armBatchCount`, `writeArmManifest`;
    - `answerRecordOf`, `settleAnswers`, `writeArmsSummary`, `reportArmsStop`;
    - `armSectionOk`, `armOk`.
  - Files under `--out` (W2-5b1 Task 5 reads the answer records; W2-5b2 reads all three):
    - the manifest `{kind: ARM_BATCH_KIND, v: 1, section, record_sha256, store_id, batch, claude_code_version, stamps, preflight_ms, runs: [{name, qid, arm, attempt, stdin_sha256}]}`;
    - the answer record `{kind: ANSWER_KIND, v: 1, section, record_sha256, store_id, qid, arm, ccrc_id, generation, boundary_uuid, fact_kind, question_state, arm_state, attempts: [{name, class, code, signal, tokens, error_fields}], run, answer_field, correct, absent, reply, uptake, stamps}`. `run`, `answer_field`, `correct`, `absent`, `reply` and `uptake` are null for an arm with no answered attempt;
    - the summary `{kind: ARMS_SUMMARY_KIND, v: 1, section, record_sha256, store_id, budget: {in_force, spend_budget, n_node, n_all}, spend, batches, stop: null | {word, kind: 'stop' | 'refusal', detail}, stamps, counts, arms: {<arm>: {answered, value, unknown, absent, correct, uptake_questions, uptake_calls, via_agent, errored}}, absent_rate: {<arm>: {num, den}}, questions: [{qid, state}]}`.

**Spec:** §10.2 "Two arms" (about :2670 at c34f82830), "Account and budget" (about :2698), "Scoring" (about :2716-2721); the pins RP1-arm and the W2-D78 refusals. W2-5b1 never edits the spec. W2 decisions document:
- W2-D78 (all three clauses, and the pins: each refusal leaves the stub's log absent);
- W2-D80 (failed runs, the stop rule, its 2026-10-19 note and 2026-10-20 amendment classifying the eight further stop words) and §7's matching residual;
- W2-D56 (preflights before every batch; the version-move amendment), W2-D90 (the amendment shape read here; `open --amend` is W2-5b2's);
- W2-D55 (the limits stop and the budget in force: part 1's `pilot_budget`, part 2's `spend_budget`), W2-D50 (the arm env), W2-D42 (the arm words);
- W2-D64 (the answer field and the absent rate per arm), W2-D82 (uptake, `via_agent`, the `is_error` reading the pilot measures);
- W2-D76 and W2-D77 (the pilot and quiz sections), W2-D24 (the re-check, through `loadArmRun`), W2-D6 (`tree-moved` in every batch's preflight);
- §5 acts 14 and 21.

Rulings: S1, Q2, Q3, Q4, Q5, Q14, Q20 (the payload shape, Task 2's, asserted end to end here), Q23, Q24, Q25, Q26, Q30, Q31; R4, R6, R8, R14, R15, R16, R17, R23, R24 and R26; R28 (the `batch_max` 1 row and M25 read Task 1's floor), R30 (`expectedForNode` reads Task 1's version-move rows), R31 (`readArmAnswers`' refusals and the pilot settings-mode check, red-first) and R32 (the end-to-end case's `w6SourceBox` assumptions are predictions).

It cites D-5983 (the printed sha), D-5984 (nothing written after the signal handler has run), D-5985 (the claim), D-5986 (the plain I/O under `--out`), D-6307, D-6309 and D-6311 (refusals before `--out`, and the range check), W2-5a's numbers, each cited bare.

**Re-anchored against c34f82830 (drift from the documents):**

| The document says | The code at c34f82830 says | What this task does |
|---|---|---|
| W2-D80: `classifyRun(streamEvents, exitCode)` | `classifyRun(events, exitCode, {spawned, stopped})`; `readStreamJson` keeps no event list | `streamEventsOf` parses a recorded run's stream into its events; every recorded run is classified with `{spawned: true, stopped: false}`, because a stopped or unspawned run writes no `run.json` (Q24's emergent `not-run`) |
| W2-D78's pin: "each refusal leaves the stub's log absent" | W2-4's recording stub logs every invocation, `--version` included; W2-D56's version check is a spawn | a W2-D78 refusal, and every refusal before `--out`, leaves the log absent; a W2-D56 refusal after `--out` leaves the `--version` line and no `-p` run (W2-5a's `w6Runs` reading) |
| W2-5a's `refuseWriterAdmission` is the pre-`--out` check of the writer subcommands; `openWriter` owns the spawn preflight | its `preflightFiles` call takes no `allowCodeChange`, its range check covers no batch shape, and `preflightNow` is a closure | (d), (e), (f): `refuseOutOfRangeValues`' `batch` (Task 1's `batchShapeChecks`), so a `batch_max` below 2 or above `BATCH_MAX`, or a `concurrency` above `CONCURRENCY_MAX`, refuses `record-invalid` before `--out` instead of a `TypeError` in `runBatch`; `refuseSpawnAdmission` with `allowCodeChange`, so `--allow-code-change` after window start is stamped, not refused, before `--out`; `preflightSpawn`, one spelling for the writer, the arms and the judge (R26) |
| W2-5a's `loadFrozen` reads "the quiz's frozen list" | it hardcodes `'quiz'` | (c): a `section` parameter, so the pilot list reads through the same git-tree rule and reader |
| `finishedOutcome` is W2-4's resume read | it checks a `run.json`'s kind, name, account, mode, model, settings mode and stream sha, not its `code` | `armAttemptsOf` refuses `out-refused` `run-json-invalid <name>` for a `code` that is neither an integer nor null, before `classifyRun` would throw (D-6309's rule: a data case after `--out` never exits 1) |
| W2-4's run timeout | `RUN_TIMEOUT_MS` is 30 minutes; a `RunJob` may carry `timeoutMs` | `deps.timeoutMs` reaches each `armJob`, so the Q4 case kills a run in seconds; no flag takes it |
| scope.md E2: the driver spells `'control'` at two sites | Task 1 rewrites both | this task adds no arm word: `RECALL_ARMS` keys every per-arm value |

**Choices (each the plan's reading of a ruling, measured by this task's cases):**
- **Re-run per arm.** Q4's "a question is re-run once as attempt 2" is read as W2-D80's "each [infrastructure failure] is re-run once": only the arm that failed is re-run, and an arm that answered keeps its answer. A question is `run-failed` when either arm is (W2-D80: "excluded from both arms"), and its other arm's owed re-run is then never spawned. R14 rules it. W2-D56's other re-run, both arms of every question with only one arm done on the new version after a version re-pilot, is W2-5b2's (the scoping study's C19), read from this task's manifests (Q14); until it ships, a resume after a `version-move` amendment spawns the missing arm only, a residual the PR body names.
- **The summary on every refusal after `--out` (R15).** Q30 asks for the stop word and the not-run count. The summary and the stderr line are written for every `DriverRefusal` once `--out` is claimed, with `kind` from Task 1's `DRIVER_STOPS`: `stop` (resumable once its cause clears) or `refusal` (an operator ruling; the W2-D78 words among them). The only exception is `interrupted`. After the signal handler has run, nothing more is written (D-5984), and only the line is printed.
- **Answer records are written once.** A settled question's runs never change, so its two records are written when it first settles, and a record already there is left as it is (a non-file there refuses `out-refused`).
- **A payload that no longer reconstructs refuses.** At arm time Task 2's `armPayloads` can answer a discard (a summary or kept member pruned since the freeze, `leaf-absent`, `card-unrenderable`). The batch refuses `quiz-unanswerable` `<qid> payload <word>` after `recheckBatch` and before any spawn of the batch, never dropping the question (W2-D78: "A frozen question is never dropped silently"). W2-D78 (iii) names three clauses and this is a fourth: **D-6469** (`history-w2-arm-payload-discard-refuses`), issued by the coordinator (R3) and defined in "Deviations found".
- **The spend-share line.** D-5983 says a subcommand writing under `--out` prints only its file's sha. Q5 says the share is printed, so the quiz form prints one line before it, and the summary records the share too (R17).
- **The record's batch shape (R4).** A batch holds `floor(limits.batch_max / RECALL_ARMS.length)` questions and runs at `limits.concurrency`: the signed values, bounded by Task 1's `batchShapeChecks` before `--out`, never replaced by `BATCH_MAX` or `CONCURRENCY_MAX`. Q3's "5 questions per 10-job batch" is what the default `batch_max` of 10 gives.
- **The raw reply (R16).** The answer record keeps the arm's raw reply under the 0700 `--out`, beside W2-4's raw stream files; redaction happens at each spawn (Task 5's judge) and at W2-5b2's sheet (W2-D54). The PR body names it as a residual.
- **One spelling of the version-move ranges (R30).** `expectedForNode` asks Task 1's `versionMoveChecks` through `refuseRangeRows`, so a version-move with no node label or no version refuses with `loadFinalRecord`'s word and detail, and its own loop only picks this node's newest move. Behaviour beside the old draft: another node's malformed move refuses here too, as it already does in `loadFinalRecord` first. A scan and mutants M32 and M33 pin it.
- **One loader, one admission, one preflight (R26).** `loadArmRun`, `armNodeOf`, `refuseSpawnAdmission` and `preflightSpawn` are this task's, and Task 5's judge calls them; `refuseWriterAdmission` and `openWriter` call the last two, so W2-5a's writer keeps its words, order and pins.

- [ ] **Step 1: Confirm the earlier tasks' names before using them.** From the repository root:

```bash
node --no-warnings --input-type=module -e "const d = await import('./deploy/history-replay.mjs'); console.log(['loadFinalRecord','recheckCode','driverWordClass','recheckBatch','armPayloads','requireListed','readStreamJson','refuseOutOfRangeValues','openReplayStore','reconstructPayload','rosterConfigDirs','prepareOut','frozenListText','qidOf','buildDraft','buildFinal','familiesOf'].map((n) => n + ':' + typeof d[n]).join(' ')); console.log('DRIVER_STOPS', Array.isArray(d.DRIVER_STOPS), 'allow-code-change', d.FLAG_SPECS['allow-code-change'], 'arms', JSON.stringify([d.CONTROL_ARM, d.TREATMENT_ARM]), d.VERSION_MOVE_KIND); console.log(JSON.stringify(d.readStreamJson(JSON.stringify({ type: 'assistant', parent_tool_use_id: 'toolu_p', message: { id: 'm', content: [{ type: 'tool_use', id: 't', name: 'Bash', input: { command: 'x' } }] } })).toolPairs))"
grep -c '^function batchShapeChecks(limits) {$' deploy/history-replay.mjs
grep -cE '^function (versionMoveChecks\(r\)|refuseRangeRows\(checks\)) \{$' deploy/history-replay.mjs
grep -n "from './history-gate.mjs'" deploy/history-replay.mjs | tr ',' '\n' | grep -cE ' (classifyRun|labelCorrect|parseAnswerField|questionOutcome)\b'
for n in ARM_SECTIONS ARM_ATTEMPTS_MAX ARM_BATCH_KIND ANSWER_KIND ARMS_SUMMARY_KIND armRunName answerRel armsSummaryRel spendShareOf questionStateOf questionCountsOf streamEventsOf errorFieldsOf uptakeOf armAnswerOf expectedForNode armsSummaryOf armsCommand loadArmRun armNodeOf readArmAnswers refuseSpawnAdmission preflightSpawn loadPilotFrozen nodeQuestions armJob armAttemptsOf answeredAttempt questionArmsOf armBatchPreflight armBatchCount writeArmManifest answerRecordOf settleAnswers writeArmsSummary reportArmsStop; do printf '%s:%s ' "$n" "$(grep -cE "^(export )?(async )?(function|const) $n\b" deploy/history-replay.mjs)"; done; echo
grep -n "HANDLERS.keys()" server/test/history-replay.test.ts
grep -c '^function w6SourceBox(' server/test/history-replay.test.ts
```

Expected (R8: every name is its owner's):
- the first line prints `function` for every name. A missing `loadFinalRecord`, `recheckCode` or `driverWordClass` is a gap in Task 1, a missing `recheckBatch` or `armPayloads` a gap in Task 2, a missing `requireListed` a gap in Task 3: stop and report it;
- the second line prints `DRIVER_STOPS true allow-code-change bool arms ["control","treatment"] version-move` (Task 1);
- the third line prints one pair whose `parentToolUseId` is `"toolu_p"` (Task 1's reader takes the event's `parent_tool_use_id`);
- `1`: Task 1's `batchShapeChecks`;
- `2`: Task 1's `versionMoveChecks` and `refuseRangeRows`, which `expectedForNode` reads (R30); a missing one is a gap in Task 1;
- `4`: the four gate names Task 1 imported; this task adds `QUESTION_OUTCOMES` in Step 5;
- every name in the loop counts 0. A collision with an earlier task's name is reported, never renamed here;
- one `HANDLERS.keys()` line, the array Task 3 left;
- `1`: W2-5a Task 6's `w6SourceBox`, which Step 3's end-to-end case reuses.

- [ ] **Step 2: Re-pin the registration line.** In `server/test/history-replay.test.ts`, inside the `it` titled `three box-mode spawns, one per taught spelling, and a denial for one spelling is recorded for that one only; exit 0`, the line `expect([...t9Driver.HANDLERS.keys()]).toEqual([...]);` keeps the array Task 3 left and gains `'arms'` as its last member. With Task 3 having appended `'marker'` to W2-5a's array, it reads:

```ts
    expect([...t9Driver.HANDLERS.keys()]).toEqual(['step0a', 'probe', 'pilot-source', 'quiz-source', 'freeze', 'power', 'open', 'verify', 'marker', 'arms']);
```

If Task 3 left another array, use that array with `'arms'` appended, and say so in the commit's task note.

- [ ] **Step 3: Write the failing tests.** Append at the end of `server/test/history-replay.test.ts`:

```ts
// ── W2-5b1 Task 4: the arm engine, `arms --section pilot|quiz` (W2-D78, W2-D80, W2-D56, W2-D55, W2-D64, W2-D82) ──
// Every HOME is a fixture: up-a (upstream) with the arm stub below, a fresh limits row, a tagged stamp, a store made by
// store.mjs's createStore (or, in the end-to-end describe, W2-5a Task 6's swept w6SourceBox), and headless-on written from lib's
// formatHeadlessList. `arms` runs in-process with Task 2's question re-check and payload injected (Task 2 pins its own),
// except the end-to-end case, which runs them for real. No case spawns a real model, reads the live HOME, or writes
// outside its own mkTmp trees. The test may spell the arm words; the driver never does (W2-D42).
import { describe as w5b4Describe, expect as w5b4Expect, it as w5b4It, vi as w5b4Vi, beforeAll as w5b4BeforeAll } from 'vitest';
import * as w5b4Drv from '../../deploy/history-replay.mjs';
import * as w5b4Gate from '../../deploy/history-gate.mjs';
import * as w5b4Lib from '../../ccd/history/lib.mjs';
import { createStore as w5b4CreateStore } from '../../ccd/history/store.mjs';
import { mkTmp as w5b4MkTmp } from './tmpHelpers.js';
import { REPO as W5B4_REPO } from './historyHelpers.js';

type W5b4R = Record<string, any>;
type W5b4Ref = { store_id: string; ccrc_id: string; generation: string };
type W5b4Saved = { path: string; sha: string; value: W5b4R };
type W5b4Result = { code: unknown; stdout: string; stderr: string; refusal: { word: string; detail: string } | null };
const D4 = w5b4Drv as unknown as W5b4R;
const W5B4_DAY = 86_400_000;
const W5B4_T0 = 1_800_000_000_000;
const W5B4_STORE_A = '00000000-0000-4000-8000-0000000004a1';
const W5B4_STORE_B = '00000000-0000-4000-8000-0000000004b1';
const W5B4_OPUS = 'claude-opus-9-1';
const W5B4_ARM_MODEL = 'claude-arm-9-1';
const W5B4_STAMP = 'v9.9.8';
const W5B4_LANG = 'fixture.UTF-8';
const w5b4Gen = (n: number): string => `0189abcd-0000-4000-8000-${String(n).padStart(12, '0')}`;
const w5b4Hex = (label: string): string => w5b4Lib.sha256Hex(`w2-5b1 task 4 fixture: ${label}`) as string;
const W5B4_SEED = w5b4Hex('seed');
/** The arm values in W2-2b's frozen order, positionally. */
const W5B4_ARMS: string[] = [...(w5b4Lib.RECALL_ARMS as readonly string[])];
const W5B4_CONTROL = W5B4_ARMS[0]!;
const W5B4_TREATMENT = W5B4_ARMS[1]!;
const W5B4_PILOT: W5b4Ref = { store_id: W5B4_STORE_A, ccrc_id: 'pilot-4', generation: w5b4Gen(940) };
const W5B4_HEAD = { writer_model: W5B4_OPUS, labeller: { ...w5b4Gate.LABELLER, sha_min_prefix: 7 } };
/** The stub's per-key controls live here: `<asof>.<arm>[.<k>]<ext>`, k the key's k-th -p run (1-based). */
const W5B4_ARM_DIR = 'stub-arm';

/** W2-4's recording stub, reshaped for arm runs: the same log line (so stubLog reads it), and for an arm run (a -p run
 *  with CCRC_RECALL_ARM set) a per-(ASOF, ARM) choice of stream, exit code, sleep, and three acts taken before it exits
 *  (rewrite the limits row, create a path, remove a path). `--version` prints STUB_STREAM, as W2-4's stub does. */
const W5B4_ARM_STUB = `#!/usr/bin/env node
(async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const start = Date.now();
  const home = path.resolve(path.dirname(process.argv[1]), '..', '..');
  const at = (f) => path.join(home, f);
  const opt = (f) => { try { return fs.readFileSync(at(f), 'utf8'); } catch { return null; } };
  const argv = process.argv.slice(2);
  const print = argv.includes('-p');
  const stdin = print ? fs.readFileSync(0, 'utf8') : '';
  const arm = process.env.CCRC_RECALL_ARM;
  const key = print && typeof arm === 'string' ? process.env.CCRC_RECALL_ASOF + '.' + arm : null;
  const dir = ${JSON.stringify(W5B4_ARM_DIR)};
  let k = 0;
  if (key !== null) {
    fs.mkdirSync(at(dir), { recursive: true });
    fs.appendFileSync(at(dir + '/' + key + '.count'), 'x');
    k = fs.statSync(at(dir + '/' + key + '.count')).size;
  }
  const per = (ext) => (key === null ? null : (opt(dir + '/' + key + '.' + k + ext) ?? opt(dir + '/' + key + ext)));
  const sleep = Number(per('.sleep') ?? '0');
  if (sleep > 0) await new Promise((r) => setTimeout(r, sleep));
  const limits = per('.limits');
  if (limits !== null) fs.writeFileSync(at('.cc-limits/up-a.json'), limits);
  const touch = per('.touch');
  if (touch !== null) { fs.mkdirSync(path.dirname(touch), { recursive: true }); fs.writeFileSync(touch, ''); }
  const rm = per('.rm');
  if (rm !== null) fs.rmSync(rm, { force: true });
  const env = {};
  for (const [n, v] of Object.entries(process.env)) if (n !== 'CLAUDE_CODE_OAUTH_TOKEN') env[n] = v;
  fs.appendFileSync(at(${JSON.stringify(T5_STUB_LOG)}), JSON.stringify({ argv, envKeys: Object.keys(process.env).sort(), env,
    cwd: process.cwd(), cwdMode: fs.statSync(process.cwd()).mode & 0o777, cwdEntries: fs.readdirSync(process.cwd()), stdin,
    start, end: Date.now() }) + '\\n');
  process.stdout.write(per('.jsonl') ?? opt(${JSON.stringify(STUB_STREAM)}) ?? '');
  process.exitCode = Number(per('.exit') ?? '0');
})();
`;

const w5b4LimitsRow = (pct: number): string => {
  const nowS = Math.floor(Date.now() / 1000);
  return JSON.stringify({ five: pct, seven: pct, ts: nowS - 60, fiveResetAt: nowS + 3600, sevenResetAt: nowS + 86400 });
};
function w5b4Limits(home: string, pct: number): void {
  mkdirSync(join(home, '.cc-limits'), { recursive: true });
  writeFileSync(join(home, '.cc-limits', 'up-a.json'), w5b4LimitsRow(pct));
}
/** Make `home` a fixture node: up-a and the arm stub, a fresh limits row at 10%, a tagged stamp. */
function w5b4Node(home: string): void {
  writeRoster(home, [FIXTURE_ACCOUNTS[0]!]);
  const bin = join(home, '.local', 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'up-a'), W5B4_ARM_STUB, { mode: 0o700 });
  if (!existsSync(join(home, STUB_STREAM))) writeFileSync(join(home, STUB_STREAM), T5_STREAM);
  w5b4Limits(home, 10);
  writeFileSync(join(home, '.ccrc', 'build.json'), JSON.stringify({ sha: 'fixture', ref: 'main', builtAt: '2026-10-22T00:00:00Z', dirty: false, version: W5B4_STAMP }));
}
/** A fixture node with a createStore store of id `store` (none when null). */
function w5b4Home(store: string | null = W5B4_STORE_A): string {
  const home = w5b4MkTmp('ccrc-w5b4-home-');
  w5b4Node(home);
  if (store !== null) w5b4CreateStore(home, { storeId: store });
  return home;
}
/** headless-on as the operator writes it from `marker` (W2-D84): lib's formatHeadlessList. */
function w5b4Marker(home: string, storeId: string, refs: W5b4Ref[]): void {
  const p = w5b4Lib.historyPaths(home).headlessOn as string;
  mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  const text = w5b4Lib.formatHeadlessList({ storeId, pairs: refs.map((r) => ({ ccrcId: r.ccrc_id, generation: r.generation })) }) as string;
  writeFileSync(p, text, { mode: 0o600 });
}
/** One stub control for the runs of (question, arm): every run of that key, or only its k-th. */
function w5b4Act(home: string, q: W5b4R, arm: string, ext: string, text: string, k: number | null = null): void {
  const dir = join(home, W5B4_ARM_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${q.boundary_uuid as string}.${arm}${k === null ? '' : `.${k}`}${ext}`), text);
}
/** A stream-json an arm run prints: init, one Bash tool pair per call (with the event's parent_tool_use_id), an optional
 *  event carrying an `error` field, and a result whose usage sums to T5_TOKENS (none when `result` is false). */
function w5b4Stream(o: { text?: string; calls?: Array<{ command: string; isError?: boolean; parent?: string }>; error?: string; result?: boolean }): string {
  const ev: object[] = [{ type: 'system', subtype: 'init', session_id: 'fixture-arm-session', model: W5B4_ARM_MODEL, tools: ['Bash', 'Agent'],
    mcp_servers: [], plugins: [], skills: [], slash_commands: [] }];
  (o.calls ?? []).forEach((c, i) => {
    const id = `toolu_w5b4_${i}`;
    ev.push({ type: 'assistant', parent_tool_use_id: c.parent ?? null, message: { id: `msg-w5b4-${i}`, usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: 'tool_use', id, name: 'Bash', input: { command: c.command } }] } });
    ev.push({ type: 'user', parent_tool_use_id: c.parent ?? null, message: { content: [{ type: 'tool_result', tool_use_id: id,
      content: c.isError === true ? 'exit 8' : 'ok', is_error: c.isError === true }] } });
  });
  if (o.error !== undefined) ev.push({ type: 'assistant', error: o.error, message: { id: 'msg-w5b4-error', content: [{ type: 'text', text: 'x' }] } });
  if (o.result !== false) {
    ev.push({ type: 'result', subtype: 'success', is_error: false, num_turns: 2, result: o.text ?? '', permission_denials: [],
      usage: { input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 30, output_tokens: 5 } });
  }
  return ev.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

const w5b4Shas = (): Record<string, string> => (D4.codeShas(W5B4_REPO) as { files: Record<string, string> }).files;
/** What the stub answers to --version: STUB_STREAM's first line (W2-4 Task 7's measureClaudeVersion). */
const w5b4Version = (home: string): string => readFileSync(join(home, STUB_STREAM), 'utf8').split('\n')[0]!.trim();
/** One frozen entry on family `f` (W2-D73's eleven fields, its qid by W2-5a Task 6's qidOf): a sha fact of 7 hex digits. */
function w5b4Entry(f: W5b4Ref, n: number): W5b4R {
  const fact = (0xbd40000 + n).toString(16);
  const e = { store_id: f.store_id, ccrc_id: f.ccrc_id, generation: f.generation, boundary_uuid: w5b4Gen(8400 + n), kind: 'sha', fact,
    fact_raw: fact, question: `Which commit did arm fixture step ${n} record?`, source_entry_uuid: w5b4Gen(9400 + n), repo_roots: ['/home/u/tree'] };
  return { ...e, qid: D4.qidOf(e) as string };
}
/** Part 1 through the driver's own buildDraft (W2-5a), every node's step 0a measured under `shas`, HOME's stub and stamp. */
function w5b4Draft(home: string, o: { stores?: string[]; pilotFamilies?: W5b4Ref[]; pilotFrozenSha?: string; over?: W5b4R; shas?: Record<string, string> } = {}): W5b4R {
  const stores = o.stores ?? [W5B4_STORE_A];
  const shas = o.shas ?? w5b4Shas();
  const s0 = { kind: D4.STEP0A_KIND, v: 1, measured_ms: W5B4_T0 - 40 * W5B4_DAY, account: 'up-a', settings_mode: 'restricted',
    claude_code_version: w5b4Version(home), wrapper_sha256: null,
    flags_accepted: Object.fromEntries((D4.contractFlags('restricted') as string[]).map((f) => [f, true])),
    writer_init: { tools: [] }, judge_init: { tools: [] }, box_init: { tools: ['Bash', 'Agent'] },
    code_shas: shas, release_stamp: W5B4_STAMP, budget: 100_000, spend: 600 };
  const pilot = { kind: D4.PILOT_SOURCE_KIND, v: 1, store_id: stores[0], seed: w5b4Hex('pilot seed'), n_fidelity: 5, n_usage: 5,
    families: o.pilotFamilies ?? [W5B4_PILOT], fidelity: [], frozen_sha256: o.pilotFrozenSha ?? w5b4Hex('pilot frozen'), writer_model: W5B4_OPUS,
    used: { labeller: { ...w5b4Gate.LABELLER, path_forms: [...w5b4Gate.LABELLER.path_forms] }, sha_min_prefix: 7, writer_input: 'excerpt',
      baseline_files: 'v1', writer_prompt_sha256: w5b4Gate.WRITER_PROMPT_SHA256, answer_protocol_sha256: w5b4Gate.ANSWER_PROTOCOL_SHA256 },
    code_shas: shas, release_stamp: W5B4_STAMP, budget: 3_000_000, spend: 900_000, counts: {} };
  return D4.buildDraft({ nodes: stores.map((s, i) => ({ label: `node-${i}`, store_id: s })),
    step0a: stores.map((s, i) => ({ ...s0, label: `node-${i}`, store_id: s })), pilot, account: 'up-a',
    models: { arm: W5B4_ARM_MODEL, writer: W5B4_OPUS, judge: W5B4_OPUS }, gateCode: { release_tag: W5B4_STAMP, files: shas },
    seedHex: W5B4_SEED, nowMs: W5B4_T0 - 30 * W5B4_DAY, overrides: o.over ?? {}, supersedes: null }) as W5b4R;
}
/** Saved as the operator saves a record: canonical JSON and one newline, 0600, outside any git tree. */
function w5b4Save(value: unknown, name: string): W5b4Saved {
  const p = join(w5b4MkTmp('ccrc-w5b4-in-'), name);
  const text = `${w5b4Lib.canonicalJson(value) as string}\n`;
  writeFileSync(p, text, { mode: 0o600 });
  return { path: p, sha: w5b4Lib.sha256Hex(text) as string, value: value as W5b4R };
}
/** A frozen list's bytes saved as they are (W2-D73: no trailing newline). */
function w5b4SaveText(text: string, name: string): W5b4Saved {
  const p = join(w5b4MkTmp('ccrc-w5b4-in-'), name);
  writeFileSync(p, text, { mode: 0o600 });
  return { path: p, sha: w5b4Lib.sha256Hex(text) as string, value: JSON.parse(text) as W5b4R };
}
const w5b4Inp = (name: string, s: W5b4Saved): string[] => [`--${name}`, s.path, `--${name}-sha256`, s.sha];
const w5b4Out = (): string => join(w5b4MkTmp('ccrc-w5b4-out-'), 'out');
/** The pilot section: `n` usage questions on `family`, the pilot frozen list, part 1 naming its sha, headless-on listing
 *  the family (unless `marker` is false), and the argv. `entries` is the list as the driver reads it, in qid order. */
function w5b4Pilot(home: string, o: { n?: number; over?: W5b4R; shas?: Record<string, string>; stores?: string[]; family?: W5b4Ref;
  frozenSha?: string; marker?: boolean } = {}) {
  const family = o.family ?? W5B4_PILOT;
  const made = Array.from({ length: o.n ?? 2 }, (_, i) => w5b4Entry(family, i + 1));
  const fz = w5b4SaveText(D4.frozenListText('pilot', W5B4_HEAD, made) as string, 'pilot-frozen.json');
  const draft = w5b4Draft(home, { stores: o.stores, pilotFamilies: [family], pilotFrozenSha: o.frozenSha ?? fz.sha, over: o.over, shas: o.shas });
  const d = w5b4Save(draft, 'part1.json');
  if (o.marker !== false) w5b4Marker(home, W5B4_STORE_A, [family]);
  const out = w5b4Out();
  return { entries: fz.value.entries as W5b4R[], fz, draft, d, out,
    argv: ['arms', '--section', 'pilot', '--out', out, ...w5b4Inp('record', d), ...w5b4Inp('frozen', fz)] };
}
/** The quiz section over two nodes: three questions on node A's family, two on node B's; part 1, the quiz frozen list,
 *  and part 2 through the driver's own buildFinal (an empty assignment, no registry drop), with `spendBudget` and the
 *  pilot result's settings mode; headless-on on node A listing A's family. */
function w5b4Quiz(home: string, o: { over?: W5b4R; shas?: Record<string, string>; spendBudget?: number; settingsMode?: string } = {}) {
  const famA: W5b4Ref = { store_id: W5B4_STORE_A, ccrc_id: 'quiz-a', generation: w5b4Gen(410) };
  const famB: W5b4Ref = { store_id: W5B4_STORE_B, ccrc_id: 'quiz-b', generation: w5b4Gen(420) };
  const made = [w5b4Entry(famA, 11), w5b4Entry(famA, 12), w5b4Entry(famA, 13), w5b4Entry(famB, 14), w5b4Entry(famB, 15)];
  const draft = w5b4Draft(home, { stores: [W5B4_STORE_A, W5B4_STORE_B], over: o.over, shas: o.shas });
  const d = w5b4Save(draft, 'part1.json');
  const fz = w5b4SaveText(D4.frozenListText('quiz', W5B4_HEAD, made) as string, 'frozen.json');
  const final = D4.buildFinal({ draft, draftSha256: d.sha,
    assembled: { nodes: [W5B4_STORE_A, W5B4_STORE_B].map((s) => ({ store_id: s, census_sha256: w5b4Hex(`census ${s}`), report: { census: { as_of_ms: W5B4_T0 } } })), drops: [] },
    assignment: { list: [], sha256: w5b4Gate.assignmentSha256([]) },
    power: { headline: null, at_power_80: null, at_rho_0: null, rho_hat: null, n_f: {}, coverage: {}, pre_window_uptake: {} }, powerSha256: w5b4Hex('power'),
    frozen: { sha256: fz.sha, list: fz.value, families: D4.familiesOf(fz.value.entries) },
    pilotResult: { fidelity: [], usage_extrapolation: {}, step0b_sha256: w5b4Hex('step0b'), settings_mode: o.settingsMode ?? 'restricted', absent_rate: { num: 0, den: 10 } },
    spendBudget: o.spendBudget ?? 1_000_000, window: { start: W5B4_T0 + W5B4_DAY, end: W5B4_T0 + 15 * W5B4_DAY }, decision: 'keep', nowMs: W5B4_T0 }) as W5b4R;
  const f = w5b4Save(final, 'part2.json');
  w5b4Marker(home, W5B4_STORE_A, [famA]);
  const out = w5b4Out();
  const entries = fz.value.entries as W5b4R[];
  return { entries, mine: entries.filter((e) => e.store_id === W5B4_STORE_A), famA, draft, d, fz, final, f, out,
    argv: (rec: W5b4Saved = f, extra: string[] = []): string[] =>
      ['arms', '--section', 'quiz', '--out', out, ...w5b4Inp('record', rec), ...w5b4Inp('part1', d), ...w5b4Inp('frozen', fz), ...extra] };
}
/** A version-move amendment (W2-D90, Q13's detail) for node `label`. */
function w5b4Move(label: string, version: string, i: number): W5b4R {
  const detail = { claude_code_version: version, repilot_sha256: w5b4Hex(`repilot ${i}`) };
  return { kind: 'version-move', node_label_ref: label, at_ms: W5B4_T0 + W5B4_DAY + i,
    detail_sha256: w5b4Lib.sha256Hex(w5b4Lib.canonicalJson(detail)) as string, detail };
}
/** Part 2 superseded after window start, appending `amendments` (W2-D90: only amendments, finalized_ms and supersedes move). */
function w5b4Amend(fx: { final: W5b4R }, amendments: W5b4R[]): W5b4Saved {
  return w5b4Save({ ...fx.final, supersedes: w5b4Gate.recordSha256(fx.final), finalized_ms: W5B4_T0 + W5B4_DAY + 3_600_000, amendments }, 'part2-amended.json');
}

/** Task 2's recheckBatch and armPayloads, stood in with their shapes: every question passes (its verdict's cut carries
 *  its qid), and each payload names its qid and the arm it goes to (plain to the control arm, carded to the treatment). */
const W5B4_FAKE: W5b4R = {
  recheck: async (_rs: unknown, es: W5b4R[]): Promise<Map<string, W5b4R>> =>
    new Map(es.map((e) => [e.qid as string, { ok: true, boundaryEntryId: 0, cut: { qid: e.qid } }])),
  payloads: (_rs: unknown, _id: number, _question: string, cut: W5b4R): W5b4R => ({ state: 'payloads',
    plain: `fixture payload ${cut.qid as string} ${W5B4_CONTROL}\n`, carded: `fixture payload ${cut.qid as string} ${W5B4_TREATMENT}\n` }),
  now: (): number => W5B4_T0 + 2 * W5B4_DAY,
};
/** `arms` in-process, as main runs it (parseArgs, then the handler) with W5B4_FAKE's deps under `deps`: stdout and stderr
 *  captured, a refusal answered as {word, detail}; any other throw is the case's failure (D-6309's rule). */
async function w5b4Arms(home: string, argv: string[], deps: W5b4R = {}): Promise<W5b4Result> {
  const err: string[] = [];
  const out: string[] = [];
  const e1 = w5b4Vi.spyOn(process.stderr, 'write').mockImplementation(((s: string | Uint8Array) => { err.push(String(s)); return true; }) as typeof process.stderr.write);
  const o1 = w5b4Vi.spyOn(process.stdout, 'write').mockImplementation(((s: string | Uint8Array) => { out.push(String(s)); return true; }) as typeof process.stdout.write);
  try {
    const { flags } = D4.parseArgs(argv) as { flags: W5b4R };
    const code = await D4.armsCommand(flags, { HOME: home, TMUX_PANE: undefined, LANG: W5B4_LANG }, { ...W5B4_FAKE, ...deps });
    return { code, stdout: out.join(''), stderr: err.join(''), refusal: null };
  } catch (e) {
    if (e instanceof w5b4Drv.DriverRefusal) return { code: null, stdout: out.join(''), stderr: err.join(''), refusal: { word: (e as W5b4R).word, detail: (e as W5b4R).detail } };
    throw e;
  } finally {
    e1.mockRestore();
    o1.mockRestore();
  }
}
const w5b4Runs = (home: string): W5b4R[] => ((stubLog(home) ?? []) as unknown as W5b4R[]).filter((e) => e.argv.includes('-p'));
const w5b4Versions = (home: string): number => ((stubLog(home) ?? []) as unknown as W5b4R[]).filter((e) => e.argv[0] === '--version').length;
const w5b4Json = (p: string): W5b4R => JSON.parse(readFileSync(p, 'utf8')) as W5b4R;
const w5b4Manifests = (out: string, section: string): W5b4R[] => {
  const dir = join(out, section, 'arms', 'batches');
  return existsSync(dir) ? readdirSync(dir).sort().map((n) => w5b4Json(join(dir, n))) : [];
};
const w5b4Answer = (out: string, section: string, q: W5b4R, arm: string): W5b4R => w5b4Json(join(out, section, 'answers', `${q.qid as string}.${arm}.json`));
const w5b4Summary = (out: string, section: string): W5b4R => w5b4Json(join(out, section, 'arms', 'summary.json'));
const w5b4Names = (section: string, es: W5b4R[], attempt = 1): string[] =>
  es.flatMap((e) => W5B4_ARMS.map((arm) => `${section}/arms/${e.qid as string}/${arm}.a${attempt}`));
const w5b4Stop = (section: string, kind: string, word: string, notRun: number, rerun: number): string =>
  `ccrc history-replay: arms ${section} ${kind} ${word}: ${notRun} question(s) not run, ${rerun} owing a re-run; nothing is retried\n`;

w5b4Describe('W2-5b1 Task 4: the arm engine, pure parts', () => {
  w5b4It('spendShareOf is ceil(budget x n / N) in integers, exact past 2^53 products (Q5)', () => {
    w5b4Expect(D4.spendShareOf(1_000_001, 3, 5)).toBe(600_001);
    w5b4Expect(D4.spendShareOf(1_000_000, 3, 5), 'CONTROL: an exact division adds nothing').toBe(600_000);
    w5b4Expect(D4.spendShareOf(100, 3, 5)).toBe(60);
    w5b4Expect(D4.spendShareOf(7, 5, 5), 'the whole list is the whole budget').toBe(7);
    w5b4Expect(D4.spendShareOf(Number.MAX_SAFE_INTEGER, 2, 3), 'exact where a float product rounds').toBe(6_004_799_503_160_661);
    for (const bad of [[0, 1, 1], [5, 0, 1], [5, 2, 1], [5, 1, 0], [1.5, 1, 1]]) {
      w5b4Expect(() => D4.spendShareOf(...bad), JSON.stringify(bad)).toThrow(TypeError);
    }
  });

  w5b4It('questionStateOf: a run-failed arm fails the question, two answered arms answer it, an owed re-run is rerun, else not-run (W2-D80)', () => {
    const rows: Array<[string[], string]> = [
      [['answered', 'answered'], 'answered'],
      [['answered', 'run-failed'], 'run-failed'],
      [['run-failed', 'rerun'], 'run-failed'],
      [['answered', 'rerun'], 'rerun'],
      [['rerun', 'not-run'], 'rerun'],
      [['answered', 'not-run'], 'not-run'],
      [['not-run', 'not-run'], 'not-run'],
    ];
    for (const [arms, want] of rows) w5b4Expect(D4.questionStateOf(arms), arms.join(' ')).toBe(want);
    w5b4Expect(() => D4.questionStateOf(['answered', 'infra-failed']), 'a run class is not an outcome').toThrow(TypeError);
    w5b4Expect(() => D4.questionStateOf([]), 'no arm is no question').toThrow(TypeError);
    w5b4Expect(D4.questionCountsOf(['answered', 'run-failed', 'rerun', 'not-run', 'not-run'])).toEqual({ questions: 5, answered: 1, run_failed: 1, rerun_owed: 1, not_run: 2 });
  });

  w5b4It('uptakeOf counts a paired, non-error history Bash call, and via_agent for one inside a subagent (W2-D82)', () => {
    const pair = (o: W5b4R): W5b4R => ({ id: 't', name: 'Bash', input: { command: 'ccrc history grep x' }, result: 'ok', isError: false, parentToolUseId: null, ...o });
    w5b4Expect(D4.uptakeOf([
      pair({}),
      pair({ parentToolUseId: 'toolu_agent' }),
      pair({ input: { command: '"$HOME/.local/bin/ccrc" history show y' }, result: null, isError: false }),
      pair({ isError: true, result: 'exit 8' }),
      pair({ result: null, isError: null }),
      pair({ input: { command: 'ls -la' } }),
      pair({ name: 'Read', input: { command: 'ccrc history grep x' } }),
      pair({ input: 'ccrc history grep x' }),
    ])).toEqual({ calls: 3, via_agent: 1, errored: 1 });
    w5b4Expect(D4.uptakeOf([]), 'CONTROL: no pair, no call').toEqual({ calls: 0, via_agent: 0, errored: 0 });
  });

  w5b4It('armAnswerOf: the last ANSWER line, labelCorrect on a value only, unknown and absent kept apart (W2-D64)', () => {
    const e = w5b4Entry(W5B4_PILOT, 1);
    const facts = (text: string | null, toolPairs: W5b4R[] = []): W5b4R => ({ result: text === null ? null : { text }, toolPairs });
    w5b4Expect(D4.armAnswerOf(e, facts(`ANSWER: deadbee\nthen\nANSWER: ${e.fact as string}`), 7)).toEqual({
      answer_field: { state: 'value', value: e.fact }, correct: true, absent: false, reply: `ANSWER: deadbee\nthen\nANSWER: ${e.fact as string}`,
      uptake: { calls: 0, via_agent: 0, errored: 0 } });
    w5b4Expect(D4.armAnswerOf(e, facts(`ANSWER: ${e.fact as string} or abc1234`), 7).correct, 'a hedged pair is not correct').toBe(false);
    w5b4Expect(D4.armAnswerOf(e, facts('ANSWER: UNKNOWN'), 7)).toMatchObject({ answer_field: { state: 'unknown' }, correct: false, absent: false });
    w5b4Expect(D4.armAnswerOf(e, facts(`The commit is ${e.fact as string}.`), 7), 'F in the reply without the line is absent').toMatchObject({ answer_field: { state: 'absent' }, correct: false, absent: true });
    w5b4Expect(D4.armAnswerOf(e, facts(null), 7)).toMatchObject({ answer_field: { state: 'absent' }, correct: false, absent: true, reply: null });
  });

  w5b4It('expectedForNode: part 1\'s step 0a entry, or the node\'s newest version-move amendment (W2-D56, W2-D90)', () => {
    const home = w5b4MkTmp('ccrc-w5b4-pure-');
    writeFileSync(join(home, STUB_STREAM), T5_STREAM);
    const draft = w5b4Draft(home, { stores: [W5B4_STORE_A, W5B4_STORE_B] });
    const plain = D4.expectedForNode(draft, W5B4_STORE_A);
    w5b4Expect(plain).toEqual({ from: 'step0a', expected: { claude_code_version: w5b4Version(home), release_stamp: W5B4_STAMP,
      wrapper_sha256: null, code_shas: draft.gate_code.files } });
    const final = { ...draft, amendments: [w5b4Move('node-0', 'v-a', 1), w5b4Move('node-1', 'v-b', 2), w5b4Move('node-0', 'v-c', 3)] };
    w5b4Expect(D4.expectedForNode(final, W5B4_STORE_A)).toMatchObject({ from: 'amendments[2]', expected: { claude_code_version: 'v-c' } });
    w5b4Expect(D4.expectedForNode(final, W5B4_STORE_B)).toMatchObject({ from: 'amendments[1]', expected: { claude_code_version: 'v-b' } });
    const other = { ...draft, amendments: [w5b4Move('node-1', 'v-b', 2), { kind: 'freeze-exception', node_label_ref: null, at_ms: 1, detail_sha256: w5b4Hex('d'), detail: {} }] };
    w5b4Expect(D4.expectedForNode(other, W5B4_STORE_A), 'CONTROL: another node\'s move and another kind leave node A\'s step 0a version').toMatchObject({ from: 'step0a' });
    const refusal = (rec: W5b4R, store: string): unknown => { try { D4.expectedForNode(rec, store); return null; } catch (e) { return [(e as W5b4R).word, (e as W5b4R).detail]; } };
    w5b4Expect(refusal({ ...draft, amendments: [w5b4Move('node-9', 'v', 1)] }, W5B4_STORE_A)).toEqual(['record-invalid', 'amendments[0].node_label_ref out-of-range']);
    w5b4Expect(refusal({ ...draft, amendments: [{ ...w5b4Move('node-0', 'v', 1), detail: { repilot_sha256: w5b4Hex('r') } }] }, W5B4_STORE_A))
      .toEqual(['record-invalid', 'amendments[0].detail.claude_code_version out-of-range']);
    w5b4Expect(refusal(draft, '00000000-0000-4000-8000-0000000004c1')).toEqual(['input-invalid', 'store 00000000-0000-4000-8000-0000000004c1 is not one of the record\'s nodes']);
    w5b4Expect(refusal({ ...draft, amendments: [w5b4Move('node-0', 'v-a', 1), { ...w5b4Move('node-1', 'v', 2), detail: { repilot_sha256: w5b4Hex('r') } }] }, W5B4_STORE_A),
      'another node\'s move with no version is refused too: the record is out of range whatever node asks (R30, as loadFinalRecord reads it)')
      .toEqual(['record-invalid', 'amendments[1].detail.claude_code_version out-of-range']);
    // R30 (W2-D12): the version-move ranges are spelled once, in Task 1's versionMoveChecks, and refused once, through
    // refuseRangeRows; expectedForNode reads both. A code line is one whose trimmed text does not open a comment.
    const code = readFileSync(join(W5B4_REPO, 'deploy', 'history-replay.mjs'), 'utf8').split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l));
    w5b4Expect(code.filter((l) => l.includes('.node_label_ref') && l.includes('labels.has(')).length, 'R30: the label range on one code line').toBe(1);
    w5b4Expect(code.filter((l) => l.includes('out-of-range') && /node_label_ref|claude_code_version/.test(l)), 'R30: no second refusal of either row').toEqual([]);
    w5b4Expect(code.filter((l) => l.includes('versionMoveChecks(')).length, 'R30: defined once, read by part2RangeChecks and expectedForNode').toBe(3);
  });

  w5b4It('armsSummaryOf: the counts, the per-arm rates over answered questions only, and the stop (Q30, W2-D64)', () => {
    const ans = (state: string, correct: boolean, calls: number): W5b4R => ({ answer_field: state === 'value' ? { state, value: 'x' } : { state }, correct,
      absent: state === 'absent', reply: 'r', uptake: { calls, via_agent: calls > 1 ? 1 : 0, errored: 0 } });
    const q = (qid: string, state: string, c: W5b4R | null, t: W5b4R | null): W5b4R => ({ qid, state, arms: [{ arm: W5B4_CONTROL, answer: c }, { arm: W5B4_TREATMENT, answer: t }] });
    const s = D4.armsSummaryOf({ section: 'quiz', recordSha256: w5b4Hex('rec'), storeId: W5B4_STORE_A, budget: { in_force: 60, spend_budget: 100, n_node: 3, n_all: 5 },
      spend: 130, batches: 2, stop: { word: 'budget-exhausted', kind: 'stop', detail: 'spent 130 of 60' }, stamps: new Set(['code-changed']),
      questions: [q('q1', 'answered', ans('unknown', false, 0), ans('value', true, 2)), q('q2', 'answered', ans('absent', false, 0), ans('value', false, 1)),
        q('q3', 'run-failed', ans('value', true, 1), null), q('q4', 'not-run', null, null)] });
    w5b4Expect(s).toEqual({ kind: D4.ARMS_SUMMARY_KIND, v: 1, section: 'quiz', record_sha256: w5b4Hex('rec'), store_id: W5B4_STORE_A,
      budget: { in_force: 60, spend_budget: 100, n_node: 3, n_all: 5 }, spend: 130, batches: 2,
      stop: { word: 'budget-exhausted', kind: 'stop', detail: 'spent 130 of 60' }, stamps: ['code-changed'],
      counts: { questions: 4, answered: 2, run_failed: 1, rerun_owed: 0, not_run: 1 },
      arms: {
        [W5B4_CONTROL]: { answered: 2, value: 0, unknown: 1, absent: 1, correct: 0, uptake_questions: 0, uptake_calls: 0, via_agent: 0, errored: 0 },
        [W5B4_TREATMENT]: { answered: 2, value: 2, unknown: 0, absent: 0, correct: 1, uptake_questions: 2, uptake_calls: 3, via_agent: 1, errored: 0 },
      },
      absent_rate: { [W5B4_CONTROL]: { num: 1, den: 2 }, [W5B4_TREATMENT]: { num: 0, den: 2 } },
      questions: [{ qid: 'q1', state: 'answered' }, { qid: 'q2', state: 'answered' }, { qid: 'q3', state: 'run-failed' }, { qid: 'q4', state: 'not-run' }] });
  });

  w5b4It('armRunName, answerRel and armsSummaryRel carry the section, the attempt and a RECALL_ARMS member only (Q4)', () => {
    w5b4Expect(D4.armRunName('quiz', '0123456789abcdef', W5B4_TREATMENT, 2)).toBe(`quiz/arms/0123456789abcdef/${W5B4_TREATMENT}.a2`);
    w5b4Expect(D4.answerRel('pilot', '0123456789abcdef', W5B4_CONTROL)).toBe(`pilot/answers/0123456789abcdef.${W5B4_CONTROL}.json`);
    w5b4Expect(D4.armsSummaryRel('pilot')).toBe('pilot/arms/summary.json');
    w5b4Expect(() => D4.armRunName('quiz', '0123456789abcdef', 'placebo', 1)).toThrow(TypeError);
    w5b4Expect(() => D4.armRunName('quiz', '0123456789abcdef', W5B4_CONTROL, 3)).toThrow(TypeError);
    w5b4Expect(() => D4.armRunName('ab', '0123456789abcdef', W5B4_CONTROL, 1)).toThrow(TypeError);
    w5b4Expect(() => D4.answerRel('quiz', '0123456789abcdef', 'placebo')).toThrow(TypeError);
  });

  w5b4It('streamEventsOf keeps every JSON object line, and errorFieldsOf every error field a run carried, once each (Q31)', () => {
    const text = [JSON.stringify({ type: 'assistant', error: 'fixture_b' }), 'not json', '[1]', '', JSON.stringify({ type: 'assistant', error: 'fixture_a' }),
      JSON.stringify({ type: 'assistant', error: 'fixture_b' }), JSON.stringify({ type: 'result', error: 7 })].join('\n');
    const events = D4.streamEventsOf(text) as W5b4R[];
    w5b4Expect(events.map((e) => e.type)).toEqual(['assistant', 'assistant', 'assistant', 'result']);
    w5b4Expect(D4.errorFieldsOf(events)).toEqual(['fixture_a', 'fixture_b']);
    w5b4Expect(D4.errorFieldsOf(D4.streamEventsOf(T5_STREAM)), 'CONTROL: a clean stream carries none').toEqual([]);
  });

  w5b4It('readArmAnswers refuses out-refused for an answer file it cannot read and for one that is not this section\'s answer record; CONTROL: the same record read directly (R26, R31)', () => {
    const out = w5b4MkTmp('ccrc-w5b4-answers-');
    const dir = join(out, 'pilot', 'answers');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const q = w5b4Entry(W5B4_PILOT, 1);
    const name = `${q.qid as string}.${W5B4_CONTROL}.json`;
    const at = join(dir, name);
    const record = { kind: D4.ANSWER_KIND, v: 1, section: 'pilot', qid: q.qid, arm: W5B4_CONTROL, arm_state: 'answered', reply: 'ANSWER: UNKNOWN', correct: false };
    const kept = join(out, 'kept.json');
    writeFileSync(kept, `${w5b4Lib.canonicalJson(record) as string}\n`, { mode: 0o600 });
    const put = (text: string): void => { rmSync(at, { recursive: true, force: true }); writeFileSync(at, text, { mode: 0o600 }); };
    const read = (): unknown => {
      try {
        return D4.readArmAnswers(out, 'pilot');
      } catch (e) {
        if (e instanceof w5b4Drv.DriverRefusal) return [(e as W5b4R).word, (e as W5b4R).detail];
        throw e;
      }
    };
    w5b4Expect(D4.readArmAnswers(join(out, 'none'), 'pilot'), 'no answers directory is no record').toEqual([]);
    copyFileSync(kept, at);
    w5b4Expect(read(), 'CONTROL: the record itself reads').toEqual([{ qid: q.qid, arm: W5B4_CONTROL, outcome: 'answered', reply: 'ANSWER: UNKNOWN', correct: false }]);
    rmSync(at);
    symlinkSync(kept, at);
    w5b4Expect(read(), 'a link to that same record is never followed (D-5986)').toEqual(['out-refused', `pilot/answers/${name} not-regular`]);
    rmSync(at);
    mkdirSync(at);
    w5b4Expect(read(), 'a directory where a record belongs').toEqual(['out-refused', `pilot/answers/${name} not-regular`]);
    put('not json');
    w5b4Expect(read(), 'bytes that are not JSON').toEqual(['out-refused', `pilot/answers/${name} is not JSON`]);
    put(`${w5b4Lib.canonicalJson({ ...record, kind: D4.ARMS_SUMMARY_KIND }) as string}\n`);
    w5b4Expect(read(), 'another kind').toEqual(['out-refused', `pilot/answers/${name} is not an answer record`]);
    put(`${w5b4Lib.canonicalJson({ ...record, section: 'quiz' }) as string}\n`);
    w5b4Expect(read(), 'another section').toEqual(['out-refused', `pilot/answers/${name} is not an answer record`]);
    put(`${w5b4Lib.canonicalJson({ ...record, arm: W5B4_TREATMENT }) as string}\n`);
    w5b4Expect(read(), 'a record under another (qid, arm)\'s name').toEqual(['out-refused', `pilot/answers/${name} is not an answer record`]);
    put(`${w5b4Lib.canonicalJson(record) as string}\n`);
    w5b4Expect(read(), 'CONTROL: written back, it reads again').toHaveLength(1);
  });
});

w5b4Describe.skipIf(process.platform === 'darwin')('W2-5b1 Task 4: arms on the stub', () => {
  w5b4It('RP1-arm: both arms of each question, the exact env with the real ARM values, one manifest and the summary sha (W2-D50, W2-D42, Q14)', async () => {
    const home = w5b4Home();
    const fx = w5b4Pilot(home, { n: 2 });
    const r = await w5b4Arms(home, fx.argv);
    w5b4Expect(r.refusal).toBeNull();
    w5b4Expect(r.code).toBe(0);
    w5b4Expect(r.stdout, 'stdout stays empty (D-5983)').toBe('');
    w5b4Expect(r.stderr).toBe(`sha256 ${w5b4Lib.sha256Hex(readFileSync(join(fx.out, 'pilot', 'arms', 'summary.json'))) as string}\n`);
    const runs = w5b4Runs(home);
    w5b4Expect(runs).toHaveLength(4);
    for (const run of runs) {
      w5b4Expect(withoutDarwinAdded(run.envKeys as string[]), 'RP1-arm: exactly the seven keys').toEqual([...T5_BASE_KEYS, ...T5_RECALL_KEYS].sort());
      for (const k of T5_NEVER_KEYS) w5b4Expect(run.env[k], k).toBeUndefined();
      w5b4Expect(run.argv).toEqual(t5Argv('arm', W5B4_ARM_MODEL, home));
      w5b4Expect(run.env.HOME).toBe(home);
      w5b4Expect(run.env.CLAUDE_CONFIG_DIR).toBe(join(home, '.claude'));
      w5b4Expect(run.env.LANG).toBe(W5B4_LANG);
      w5b4Expect((run.env.PATH as string).split(':')[0]!.endsWith('/poison-bin'), 'the poisoned gh first').toBe(true);
    }
    const seen = runs.map((x) => [x.env.CCRC_RECALL_SESSION, x.env.CCRC_RECALL_ASOF, x.env.CCRC_RECALL_ARM, x.stdin].join('|')).sort();
    const want = fx.entries.flatMap((e) => W5B4_ARMS.map((arm) => [e.ccrc_id, e.boundary_uuid, arm, `fixture payload ${e.qid as string} ${arm}\n`].join('|'))).sort();
    w5b4Expect(seen, 'SESSION is the family id, ASOF its boundary, ARM each RECALL_ARMS member once per question').toEqual(want);
    const m = w5b4Manifests(fx.out, 'pilot');
    w5b4Expect(m).toHaveLength(1);
    w5b4Expect(m[0]).toMatchObject({ kind: D4.ARM_BATCH_KIND, v: 1, section: 'pilot', record_sha256: fx.d.sha, store_id: W5B4_STORE_A, batch: 1,
      claude_code_version: w5b4Version(home), stamps: [] });
    w5b4Expect((m[0]!.runs as W5b4R[]).map((x) => x.name), 'frozen qid order, each question\'s arms side by side').toEqual(w5b4Names('pilot', fx.entries));
    w5b4Expect(m[0]!.runs[0]).toEqual({ name: w5b4Names('pilot', fx.entries)[0], qid: fx.entries[0]!.qid, arm: W5B4_CONTROL, attempt: 1,
      stdin_sha256: w5b4Lib.sha256Hex(`fixture payload ${fx.entries[0]!.qid as string} ${W5B4_CONTROL}\n`) });
    w5b4Expect(w5b4Summary(fx.out, 'pilot')).toMatchObject({ kind: D4.ARMS_SUMMARY_KIND, section: 'pilot', record_sha256: fx.d.sha, store_id: W5B4_STORE_A,
      batches: 1, stop: null, stamps: [], spend: 4 * T5_TOKENS, budget: { in_force: fx.draft.pilot_budget, spend_budget: null, n_node: 2, n_all: 2 },
      counts: { questions: 2, answered: 2, run_failed: 0, rerun_owed: 0, not_run: 0 } });
  }, 120_000);

  w5b4It('answer records per (qid, arm): the answer field, labelCorrect, uptake with via_agent, absent, every error field, and the per-arm rates (W2-D82, W2-D64, Q31)', async () => {
    const home = w5b4Home();
    const fx = w5b4Pilot(home, { n: 2 });
    const [q1, q2] = fx.entries as [W5b4R, W5b4R];
    w5b4Act(home, q1, W5B4_TREATMENT, '.jsonl', w5b4Stream({ text: `I checked the history.\nANSWER: ${q1.fact as string}`,
      calls: [{ command: 'ccrc history grep fixture --json', parent: 'toolu_agent_w5b4' }, { command: 'ls -la' }] }));
    w5b4Act(home, q1, W5B4_CONTROL, '.jsonl', w5b4Stream({ text: 'ANSWER: UNKNOWN', calls: [{ command: '~/.local/bin/ccrc history grep fixture', isError: true }] }));
    w5b4Act(home, q2, W5B4_TREATMENT, '.jsonl', w5b4Stream({ text: 'ANSWER: abc1234 or def5678', error: 'fixture_error_field' }));
    const r = await w5b4Arms(home, fx.argv);
    w5b4Expect(r.code).toBe(0);
    const t1 = `pilot/arms/${q1.qid as string}/${W5B4_TREATMENT}.a1`;
    w5b4Expect(w5b4Answer(fx.out, 'pilot', q1, W5B4_TREATMENT)).toEqual({ kind: D4.ANSWER_KIND, v: 1, section: 'pilot', record_sha256: fx.d.sha,
      store_id: W5B4_STORE_A, qid: q1.qid, arm: W5B4_TREATMENT, ccrc_id: q1.ccrc_id, generation: q1.generation, boundary_uuid: q1.boundary_uuid,
      fact_kind: 'sha', question_state: 'answered', arm_state: 'answered',
      attempts: [{ name: t1, class: 'answered', code: 0, signal: null, tokens: T5_TOKENS, error_fields: [] }],
      run: t1, answer_field: { state: 'value', value: q1.fact }, correct: true, absent: false,
      reply: `I checked the history.\nANSWER: ${q1.fact as string}`, uptake: { calls: 1, via_agent: 1, errored: 0 }, stamps: [] });
    w5b4Expect(w5b4Answer(fx.out, 'pilot', q1, W5B4_CONTROL), 'the exit-8 call is errored, never a call (W2-D82)').toMatchObject({
      answer_field: { state: 'unknown' }, correct: false, absent: false, uptake: { calls: 0, via_agent: 0, errored: 1 } });
    w5b4Expect(w5b4Answer(fx.out, 'pilot', q2, W5B4_TREATMENT), 'a hedged pair is a value, not correct').toMatchObject({
      answer_field: { state: 'value', value: 'abc1234 or def5678' }, correct: false, absent: false });
    w5b4Expect(w5b4Answer(fx.out, 'pilot', q2, W5B4_TREATMENT).attempts[0].error_fields, 'Q31: an error field is recorded').toEqual(['fixture_error_field']);
    w5b4Expect(w5b4Answer(fx.out, 'pilot', q2, W5B4_CONTROL), 'the default stream has no ANSWER line').toMatchObject({
      answer_field: { state: 'absent' }, correct: false, absent: true, reply: 'ok' });
    const read = D4.readArmAnswers(fx.out, 'pilot') as W5b4R[];
    w5b4Expect(read, 'readArmAnswers: one row per (qid, arm), projected from the records (R26)').toHaveLength(4);
    w5b4Expect(read).toContainEqual({ qid: q1.qid, arm: W5B4_TREATMENT, outcome: 'answered', reply: `I checked the history.\nANSWER: ${q1.fact as string}`, correct: true });
    const s = w5b4Summary(fx.out, 'pilot');
    w5b4Expect(s.arms).toEqual({
      [W5B4_CONTROL]: { answered: 2, value: 0, unknown: 1, absent: 1, correct: 0, uptake_questions: 0, uptake_calls: 0, via_agent: 0, errored: 1 },
      [W5B4_TREATMENT]: { answered: 2, value: 2, unknown: 0, absent: 0, correct: 1, uptake_questions: 1, uptake_calls: 1, via_agent: 1, errored: 0 },
    });
    w5b4Expect(s.absent_rate).toEqual({ [W5B4_CONTROL]: { num: 1, den: 2 }, [W5B4_TREATMENT]: { num: 0, den: 2 } });
  }, 120_000);

  w5b4It('batches: limits.batch_max / 2 questions each, both arms side by side, in frozen qid order, the preflight before each (Q3)', async () => {
    const home = w5b4Home();
    const fx = w5b4Pilot(home, { n: 7 });
    w5b4Expect((await w5b4Arms(home, fx.argv)).code).toBe(0);
    w5b4Expect(w5b4Manifests(fx.out, 'pilot').map((m) => (m.runs as W5b4R[]).map((x) => x.name)))
      .toEqual([w5b4Names('pilot', fx.entries.slice(0, 5)), w5b4Names('pilot', fx.entries.slice(5))]);
    w5b4Expect(w5b4Runs(home)).toHaveLength(14);
    w5b4Expect(w5b4Versions(home), 'one --version per batch').toBe(2);
    const home2 = w5b4Home();
    const fx2 = w5b4Pilot(home2, { n: 5, over: { limits: { batch_max: 4 } } });
    w5b4Expect((await w5b4Arms(home2, fx2.argv)).code).toBe(0);
    w5b4Expect(w5b4Manifests(fx2.out, 'pilot').map((m) => (m.runs as W5b4R[]).map((x) => x.name)), 'CONTROL: batch_max 4 holds two questions')
      .toEqual([w5b4Names('pilot', fx2.entries.slice(0, 2)), w5b4Names('pilot', fx2.entries.slice(2, 4)), w5b4Names('pilot', fx2.entries.slice(4))]);
  }, 180_000);

  type W5b4Before = [string, string, RegExp, () => { home: string; argv: string[]; out: string }];
  const pilotIn = (home: string, o: Parameters<typeof w5b4Pilot>[1] = {}): { home: string; argv: string[]; out: string } => {
    const fx = w5b4Pilot(home, o);
    return { home, argv: fx.argv, out: fx.out };
  };
  const BEFORE_OUT: W5b4Before[] = [
    ['code-changed is asked first, before the frozen list is read (W2-D24)', 'code-changed', /measure-history\.py/, () => {
      const home = w5b4Home();
      const fx = w5b4Pilot(home, { shas: { ...w5b4Shas(), 'deploy/measure-history.py': w5b4Hex('moved') } });
      return { home, out: fx.out, argv: fx.argv.map((a) => (a === fx.fz.path ? join(home, 'no-such-frozen.json') : a)) };
    }],
    ['a pilot list that is not part 1\'s', 'quiz-sha-mismatch', /is not the record's pilot\.frozen_sha256/, () => pilotIn(w5b4Home(), { frozenSha: w5b4Hex('another list') })],
    ['no store on the node', 'store-unreadable', /./, () => pilotIn(w5b4Home(null))],
    ['a store the record does not name', 'input-invalid', /^store 00000000-0000-4000-8000-0000000004b1 is not one of the record's nodes$/, () => pilotIn(w5b4Home(W5B4_STORE_B))],
    ['a pilot question on another node\'s store', 'input-invalid', /^pilot question [0-9a-f]{16} is on store 00000000-0000-4000-8000-0000000004b1, not this node's/,
      () => pilotIn(w5b4Home(), { stores: [W5B4_STORE_A, W5B4_STORE_B], family: { ...W5B4_PILOT, store_id: W5B4_STORE_B } })],
    ['a batch_max that cannot hold both arms (R28)', 'record-invalid', /^limits\.batch_max out-of-range$/, () => pilotIn(w5b4Home(), { over: { limits: { batch_max: 1 } } })],
    ['a concurrency past CONCURRENCY_MAX', 'record-invalid', /^limits\.concurrency out-of-range$/, () => pilotIn(w5b4Home(), { over: { limits: { concurrency: 3 } } })],
    ['the record\'s account is hidden in the roster (W2-D52)', 'account-refused', /^hidden$/, () => {
      const home = w5b4Home();
      // The roster needs exactly one upstream account (shared/roster-json.mjs), so up-a stays, marked hidden.
      writeRoster(home, [fixtureAccount('up-a', { kind: 'upstream' }, { configDirSuffix: '.claude', homeAble: true, telemetry: 'anthropic', hidden: true })]);
      return pilotIn(home);
    }],
    ['the limits row at the threshold', 'limits-threshold', /^five 90 seven 90 at or over 70$/, () => {
      const home = w5b4Home();
      w5b4Limits(home, 90);
      return pilotIn(home);
    }],
    ['the installed stamp moved (W2-D6)', 'tree-moved', /^recorded v9\.9\.8, measured v0\.0\.1$/, () => {
      const home = w5b4Home();
      writeFileSync(join(home, '.ccrc', 'build.json'), JSON.stringify({ sha: 'fixture', ref: 'main', builtAt: '2026-10-22T00:00:00Z', dirty: false, version: 'v0.0.1' }));
      return pilotIn(home);
    }],
    ['W2-D78 (i): no headless-on', 'family-unlisted', /./, () => pilotIn(w5b4Home(), { marker: false })],
    ['W2-D78 (i): headless-on names another store', 'family-unlisted', /./, () => {
      const home = w5b4Home();
      const fx = pilotIn(home);
      w5b4Marker(home, W5B4_STORE_B, [W5B4_PILOT]);
      return fx;
    }],
    ['W2-D78 (i): headless-on lists another generation', 'family-unlisted', /./, () => {
      const home = w5b4Home();
      const fx = pilotIn(home);
      w5b4Marker(home, W5B4_STORE_A, [{ ...W5B4_PILOT, generation: w5b4Gen(941) }]);
      return fx;
    }],
    ['W2-D78 (ii), family-recall-off: a recall-off entry for the family', 'family-recall-off', /^present pilot-4$/, () => {
      const home = w5b4Home();
      const p = w5b4Lib.recallOffPath(home, 'pilot-4') as string;
      mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
      writeFileSync(p, '');
      return pilotIn(home);
    }],
  ];
  w5b4It.each(BEFORE_OUT)('refuses before --out, with the stub log absent: %s', async (_label, word, detail, setup) => {
    const { home, argv, out } = setup();
    const r = await w5b4Arms(home, argv);
    w5b4Expect(r.refusal?.word).toBe(word);
    w5b4Expect(r.refusal?.detail).toMatch(detail);
    w5b4Expect(existsSync(out), 'no --out is made').toBe(false);
    w5b4Expect(stubLog(home), 'no spawn, not even --version').toBeNull();
  }, 60_000);

  // W2-D24 (R23): arms re-checks the code it runs under before any other input, under W2-5a's title; the record is
  // signed with a code sha this tree does not have, and the input read next is unreadable (pilot) or the store absent (quiz).
  const W5B4_MOVED = (): Record<string, string> => ({ ...w5b4Shas(), 'deploy/measure-history.py': w5b4Hex('moved') });
  w5b4It.each([
    ['arms --section pilot', (home: string): { out: string; argv: string[] } => {
      const fx = w5b4Pilot(home, { shas: W5B4_MOVED() });
      return { out: fx.out, argv: fx.argv.map((a) => (a === fx.fz.path ? join(home, 'no-such-frozen.json') : a)) };
    }],
    ['arms --section quiz', (home: string): { out: string; argv: string[] } => {
      const fx = w5b4Quiz(home, { shas: W5B4_MOVED() });
      return { out: fx.out, argv: fx.argv() };
    }],
  ] as Array<[string, (home: string) => { out: string; argv: string[] }]>)('code-changed before any other input is read, re-checks the code it runs under: %s', async (_sub, setup) => {
    const home = w5b4Home(null);   // no store: a re-check after the store open would answer store-unreadable
    const { out, argv } = setup(home);
    const r = await w5b4Arms(home, argv);
    w5b4Expect(r.refusal).toEqual({ word: 'code-changed', detail: 'changed deploy/measure-history.py' });
    w5b4Expect(existsSync(out), 'no --out').toBe(false);
    w5b4Expect(stubLog(home), 'no spawn').toBeNull();
  }, 60_000);

  w5b4It('an --out holding pilot-source.json is refused, and the same --out without it runs (Q25)', async () => {
    const home = w5b4Home();
    const fx = w5b4Pilot(home, { n: 1 });
    const out = D4.prepareOut(fx.out) as string;
    writeFileSync(join(out, 'pilot-source.json'), '{}\n', { mode: 0o600 });
    const r = await w5b4Arms(home, fx.argv);
    w5b4Expect(r.refusal).toEqual({ word: 'out-refused', detail: 'pilot-source.json is here: arms run on a fresh --out, never pilot-source\'s' });
    w5b4Expect(stubLog(home)).toBeNull();
    w5b4Expect(existsSync(join(out, 'pilot'))).toBe(false);
    rmSync(join(out, 'pilot-source.json'));
    w5b4Expect((await w5b4Arms(home, fx.argv)).code, 'CONTROL: without it').toBe(0);
  }, 60_000);

  w5b4It('W2-D78 (iii) before every batch: an unanswerable question refuses its batch, the earlier batch ran, the summary names it (Q30)', async () => {
    const home = w5b4Home();
    const fx = w5b4Pilot(home, { n: 6 });
    const last = fx.entries[5]!;
    const r = await w5b4Arms(home, fx.argv, { recheck: async (rs: unknown, es: W5b4R[]): Promise<Map<string, W5b4R>> => {
      if (es.some((e) => e.qid === last.qid)) D4.refuse('quiz-unanswerable', `${last.qid as string} clause (b) unanswerable`);
      return W5B4_FAKE.recheck(rs, es);
    } });
    w5b4Expect(r.refusal).toEqual({ word: 'quiz-unanswerable', detail: `${last.qid as string} clause (b) unanswerable` });
    w5b4Expect(w5b4Runs(home), 'batch 1 ran, batch 2 spawned nothing').toHaveLength(10);
    w5b4Expect(w5b4Versions(home), 'batch 2 refused before its --version').toBe(1);
    w5b4Expect(r.stderr).toBe(w5b4Stop('pilot', 'refusal', 'quiz-unanswerable', 1, 0));
    const s = w5b4Summary(fx.out, 'pilot');
    w5b4Expect(s.stop).toEqual({ word: 'quiz-unanswerable', kind: 'refusal', detail: `${last.qid as string} clause (b) unanswerable` });
    w5b4Expect(s.counts).toEqual({ questions: 6, answered: 5, run_failed: 0, rerun_owed: 0, not_run: 1 });
    w5b4Expect(readdirSync(join(fx.out, 'pilot', 'answers')).sort(), 'the five settled questions have their records')
      .toEqual(fx.entries.slice(0, 5).flatMap((e) => W5B4_ARMS.map((arm) => `${e.qid as string}.${arm}.json`)).sort());
  }, 120_000);

  w5b4It('W2-D78 (iii): a payload that no longer reconstructs refuses quiz-unanswerable, never a dropped question (D-6469)', async () => {
    const home = w5b4Home();
    const fx = w5b4Pilot(home, { n: 2 });
    const gone = fx.entries[1]!;
    const r = await w5b4Arms(home, fx.argv, { payloads: (rs: unknown, id: number, question: string, cut: W5b4R): W5b4R =>
      (cut.qid === gone.qid ? { state: 'discard', why: 'summary-absent' } : W5B4_FAKE.payloads(rs, id, question, cut)) });
    w5b4Expect(r.refusal).toEqual({ word: 'quiz-unanswerable', detail: `${gone.qid as string} payload summary-absent` });
    w5b4Expect(stubLog(home), 'the batch spawned nothing').toBeNull();
    w5b4Expect(w5b4Summary(fx.out, 'pilot').counts).toEqual({ questions: 2, answered: 0, run_failed: 0, rerun_owed: 0, not_run: 2 });
  }, 60_000);

  w5b4It('W2-D78 (i) and (ii) before every batch: headless-on removed, or a recall-off entry written, during a batch refuses the next', async () => {
    const home = w5b4Home();
    const fx = w5b4Pilot(home, { n: 6 });
    w5b4Act(home, fx.entries[0]!, W5B4_CONTROL, '.touch', w5b4Lib.recallOffPath(home, 'pilot-4') as string, 1);
    const r = await w5b4Arms(home, fx.argv);
    w5b4Expect(r.refusal).toEqual({ word: 'family-recall-off', detail: 'present pilot-4' });
    w5b4Expect(w5b4Runs(home)).toHaveLength(10);
    w5b4Expect(w5b4Versions(home), 'batch 2 refused before its --version').toBe(1);
    w5b4Expect(w5b4Summary(fx.out, 'pilot').stop).toMatchObject({ word: 'family-recall-off', kind: 'refusal' });
    const home2 = w5b4Home();
    const fx2 = w5b4Pilot(home2, { n: 6 });
    w5b4Act(home2, fx2.entries[0]!, W5B4_CONTROL, '.rm', w5b4Lib.historyPaths(home2).headlessOn as string, 1);
    const r2 = await w5b4Arms(home2, fx2.argv);
    w5b4Expect(r2.refusal?.word).toBe('family-unlisted');
    w5b4Expect(w5b4Runs(home2)).toHaveLength(10);
    w5b4Expect(w5b4Versions(home2), 'batch 2 refused before its --version').toBe(1);
  }, 180_000);

  w5b4It('a driver timeout is infra-failed and re-run once as attempt 2 in a later batch; a second infra failure is run-failed in both arms (Q4, W2-D80)', async () => {
    const home = w5b4Home();
    const fx = w5b4Pilot(home, { n: 2 });
    const [q1, q2] = fx.entries as [W5b4R, W5b4R];
    w5b4Act(home, q1, W5B4_CONTROL, '.sleep', '30000', 1);
    w5b4Act(home, q2, W5B4_CONTROL, '.jsonl', w5b4Stream({ text: 'x', result: false }));
    w5b4Act(home, q2, W5B4_CONTROL, '.exit', '1');
    const r = await w5b4Arms(home, fx.argv, { timeoutMs: 1500 });
    w5b4Expect(r.refusal).toBeNull();
    const name = (q: W5b4R, arm: string, n: number): string => `pilot/arms/${q.qid as string}/${arm}.a${n}`;
    const c1 = w5b4Answer(fx.out, 'pilot', q1, W5B4_CONTROL);
    w5b4Expect((c1.attempts as W5b4R[]).map((t) => [t.name, t.class, t.code, t.signal])).toEqual([
      [name(q1, W5B4_CONTROL, 1), 'infra-failed', null, 'SIGTERM'], [name(q1, W5B4_CONTROL, 2), 'answered', 0, null]]);
    w5b4Expect(c1).toMatchObject({ question_state: 'answered', arm_state: 'answered', run: name(q1, W5B4_CONTROL, 2) });
    const c2 = w5b4Answer(fx.out, 'pilot', q2, W5B4_CONTROL);
    w5b4Expect((c2.attempts as W5b4R[]).map((t) => [t.class, t.code])).toEqual([['infra-failed', 1], ['infra-failed', 1]]);
    w5b4Expect(c2).toMatchObject({ question_state: 'run-failed', arm_state: 'run-failed', run: null, answer_field: null, correct: null, uptake: null });
    w5b4Expect(w5b4Answer(fx.out, 'pilot', q2, W5B4_TREATMENT), 'the answered arm of a run-failed question is recorded and excluded')
      .toMatchObject({ question_state: 'run-failed', arm_state: 'answered', run: name(q2, W5B4_TREATMENT, 1) });
    w5b4Expect(w5b4Manifests(fx.out, 'pilot').map((m) => (m.runs as W5b4R[]).map((x) => x.name)), 'each re-run in a later batch')
      .toEqual([w5b4Names('pilot', fx.entries), [name(q1, W5B4_CONTROL, 2), name(q2, W5B4_CONTROL, 2)]]);
    w5b4Expect(existsSync(join(fx.out, `${name(q2, W5B4_CONTROL, 3)}.run.json`)), 'never a third attempt').toBe(false);
    const s = w5b4Summary(fx.out, 'pilot');
    w5b4Expect(s.counts).toEqual({ questions: 2, answered: 1, run_failed: 1, rerun_owed: 0, not_run: 0 });
    w5b4Expect(s.arms[W5B4_TREATMENT].answered, 'q2 is excluded from both arms').toBe(1);
  }, 180_000);

  w5b4It('a stop never consumes the re-run: the limits stop before the re-run batch, then the resume spawns attempt 2 (W2-D80, Q24, Q30)', async () => {
    const home = w5b4Home();
    const fx = w5b4Pilot(home, { n: 1 });
    const q = fx.entries[0]!;
    w5b4Act(home, q, W5B4_CONTROL, '.jsonl', w5b4Stream({ text: 'x', result: false }), 1);
    w5b4Act(home, q, W5B4_CONTROL, '.exit', '1', 1);
    w5b4Act(home, q, W5B4_CONTROL, '.limits', w5b4LimitsRow(90), 1);
    const r = await w5b4Arms(home, fx.argv);
    w5b4Expect(r.refusal?.word).toBe('limits-threshold');
    w5b4Expect(r.stderr).toBe(w5b4Stop('pilot', 'stop', 'limits-threshold', 0, 1));
    w5b4Expect(w5b4Summary(fx.out, 'pilot')).toMatchObject({ stop: { word: 'limits-threshold', kind: 'stop' },
      counts: { questions: 1, answered: 0, run_failed: 0, rerun_owed: 1, not_run: 0 } });
    w5b4Limits(home, 10);
    const again = await w5b4Arms(home, fx.argv);
    w5b4Expect(again.refusal).toBeNull();
    const c = w5b4Answer(fx.out, 'pilot', q, W5B4_CONTROL);
    w5b4Expect((c.attempts as W5b4R[]).map((t) => [t.name, t.class])).toEqual([
      [`pilot/arms/${q.qid as string}/${W5B4_CONTROL}.a1`, 'infra-failed'], [`pilot/arms/${q.qid as string}/${W5B4_CONTROL}.a2`, 'answered']]);
    w5b4Expect(w5b4Manifests(fx.out, 'pilot').map((m) => (m.runs as W5b4R[]).map((x) => x.name)), 'the stopped batch wrote no manifest')
      .toEqual([w5b4Names('pilot', [q]), [`pilot/arms/${q.qid as string}/${W5B4_CONTROL}.a2`]]);
    w5b4Expect(w5b4Summary(fx.out, 'pilot')).toMatchObject({ stop: null, counts: { answered: 1, rerun_owed: 0 } });
  }, 120_000);

  w5b4It('quiz: the per-node spend share is printed, and the node ledger enforces it; a mid-batch stop is summarised (Q5, Q30)', async () => {
    const home = w5b4Home();
    const fx = w5b4Quiz(home, { spendBudget: 1_000_001 });
    const r = await w5b4Arms(home, fx.argv());
    w5b4Expect(r.refusal).toBeNull();
    const summary = join(fx.out, 'quiz', 'arms', 'summary.json');
    w5b4Expect(r.stderr).toBe(`ccrc history-replay: spend share 600001 = ceil(1000001 x 3 / 5)\nsha256 ${w5b4Lib.sha256Hex(readFileSync(summary)) as string}\n`);
    w5b4Expect(w5b4Json(summary).budget).toEqual({ in_force: 600_001, spend_budget: 1_000_001, n_node: 3, n_all: 5 });
    w5b4Expect(w5b4Runs(home).map((x) => x.env.CCRC_RECALL_SESSION), 'only this node\'s questions').toEqual(Array(6).fill('quiz-a'));
    w5b4Expect(w5b4Runs(home)[0]!.argv, 'CONTROL for Q26: a restricted pilot result').toEqual(t5Argv('arm', W5B4_ARM_MODEL, home));
    const home2 = w5b4Home();
    const fx2 = w5b4Quiz(home2, { spendBudget: 100, over: { limits: { concurrency: 1 } } });
    const r2 = await w5b4Arms(home2, fx2.argv());
    w5b4Expect(r2.refusal).toEqual({ word: 'budget-exhausted', detail: 'spent 65 of 60' });
    w5b4Expect(w5b4Runs(home2), 'the share, 60, stops the second spawn').toHaveLength(1);
    w5b4Expect(r2.stderr).toBe(`ccrc history-replay: spend share 60 = ceil(100 x 3 / 5)\n${w5b4Stop('quiz', 'stop', 'budget-exhausted', 3, 0)}`);
    w5b4Expect(w5b4Summary(fx2.out, 'quiz')).toMatchObject({ stop: { word: 'budget-exhausted', kind: 'stop', detail: 'spent 65 of 60' },
      counts: { questions: 3, answered: 0, run_failed: 0, rerun_owed: 0, not_run: 3 } });
  }, 120_000);

  w5b4It('quiz: the arms run under part 2\'s pilot_result.settings_mode (Q26)', async () => {
    const home = w5b4Home();
    const fx = w5b4Quiz(home, { settingsMode: 'fallback' });
    w5b4Expect((await w5b4Arms(home, fx.argv())).code).toBe(0);
    for (const run of w5b4Runs(home)) {
      w5b4Expect(run.argv).toEqual(['--setting-sources', 'project,local', '--settings', '{"disableAllHooks":true}', ...t5Argv('arm', W5B4_ARM_MODEL, home).slice(1)]);
    }
  }, 120_000);

  w5b4It('pilot: part 1\'s settings mode is ranged before --out, and a SETTINGS_MODES word runs under it (Q26, R31)', async () => {
    // Part 1 re-saved with its settings mode, and every step 0a entry's with it (the validator holds the two equal).
    const pilotWith = (mode: string): { home: string; argv: string[]; out: string } => {
      const home = w5b4Home();
      const fx = w5b4Pilot(home);
      const d = w5b4Save({ ...fx.draft, settings_mode: mode, step0a: (fx.draft.step0a as W5b4R[]).map((x) => ({ ...x, settings_mode: mode })) }, 'part1-mode.json');
      return { home, out: fx.out, argv: fx.argv.map((a) => (a === fx.d.path ? d.path : a === fx.d.sha ? d.sha : a)) };
    };
    const bad = pilotWith('open');
    const r = await w5b4Arms(bad.home, bad.argv);
    w5b4Expect(r.refusal).toEqual({ word: 'record-invalid', detail: 'settings_mode out-of-range' });
    w5b4Expect(existsSync(bad.out), 'no --out is made').toBe(false);
    w5b4Expect(stubLog(bad.home), 'no spawn, not even --version').toBeNull();
    const good = pilotWith('fallback');
    const ok = await w5b4Arms(good.home, good.argv);
    w5b4Expect(ok.refusal, 'CONTROL: another SETTINGS_MODES word is admitted').toBeNull();
    w5b4Expect(w5b4Runs(good.home).length, 'CONTROL: both arms ran').toBe(4);
    for (const run of w5b4Runs(good.home)) w5b4Expect((run.argv as string[]).slice(0, 2), 'under part 1\'s mode').toEqual(['--setting-sources', 'project,local']);
  }, 120_000);

  w5b4It('quiz: the version preflight reads this node\'s newest version-move amendment, and no other node\'s (W2-D56, W2-D90)', async () => {
    const moved = async (amendments: (home: string) => W5b4R[]): Promise<{ home: string; r: W5b4Result; out: string }> => {
      const home = w5b4Home();
      const fx = w5b4Quiz(home);
      const r = await w5b4Arms(home, fx.argv(w5b4Amend(fx, amendments(home)), w5b4Inp('supersedes', fx.f)));
      return { home, r, out: fx.out };
    };
    const a = await moved(() => [w5b4Move('node-0', 'fixture-version-moved', 1)]);
    w5b4Expect(a.r.refusal).toEqual({ word: 'claude-version-moved', detail: `recorded fixture-version-moved, measured ${w5b4Version(a.home)}` });
    w5b4Expect(w5b4Runs(a.home), 'no arm run').toHaveLength(0);
    w5b4Expect(w5b4Versions(a.home), 'the one --version the preflight asks').toBe(1);
    const b = await moved(() => [w5b4Move('node-1', 'fixture-version-moved', 1)]);
    w5b4Expect(b.r.refusal, 'CONTROL: node B\'s move leaves node A on part 1\'s version').toBeNull();
    const c = await moved((home) => [w5b4Move('node-0', 'fixture-version-moved', 1), w5b4Move('node-0', w5b4Version(home), 2)]);
    w5b4Expect(c.r.refusal, 'CONTROL: the newest move names the measured version').toBeNull();
    const d = await moved(() => [w5b4Move('node-9', 'fixture-version-moved', 1)]);
    w5b4Expect(d.r.refusal).toEqual({ word: 'record-invalid', detail: 'amendments[0].node_label_ref out-of-range' });
    w5b4Expect(existsSync(d.out), 'refused before --out').toBe(false);
  }, 180_000);

  w5b4It('quiz: --allow-code-change after window start stamps the manifest, every answer and the summary; without it, code-changed before --out (Q23, W2-D24)', async () => {
    const shas = { ...w5b4Shas(), 'deploy/measure-history.py': w5b4Hex('moved') };
    const home = w5b4Home();
    const fx = w5b4Quiz(home, { shas });
    const plain = await w5b4Arms(home, fx.argv());
    w5b4Expect(plain.refusal?.word).toBe('code-changed');
    w5b4Expect(existsSync(fx.out)).toBe(false);
    const r = await w5b4Arms(home, fx.argv(fx.f, ['--allow-code-change']));
    w5b4Expect(r.refusal).toBeNull();
    w5b4Expect(w5b4Manifests(fx.out, 'quiz')[0]!.stamps).toEqual(['code-changed']);
    w5b4Expect(w5b4Summary(fx.out, 'quiz').stamps).toEqual(['code-changed']);
    for (const q of fx.mine) for (const arm of W5B4_ARMS) w5b4Expect(w5b4Answer(fx.out, 'quiz', q, arm).stamps).toEqual(['code-changed']);
    const home2 = w5b4Home();
    const fx2 = w5b4Quiz(home2, { shas });
    const early = await w5b4Arms(home2, fx2.argv(fx2.f, ['--allow-code-change']), { now: () => W5B4_T0 });
    w5b4Expect(early.refusal?.word, 'before window start the flag is refused (Task 1\'s rule)').toBe('args-invalid');
    w5b4Expect(stubLog(home2)).toBeNull();
  }, 120_000);

  w5b4It('a data case after --out refuses, never a defect: a run.json with no exit code, an answer path that is a directory (D-6309\'s rule)', async () => {
    const home = w5b4Home();
    const fx = w5b4Pilot(home, { n: 1 });
    const q = fx.entries[0]!;
    w5b4Expect((await w5b4Arms(home, fx.argv)).code).toBe(0);
    const rj = join(fx.out, 'pilot', 'arms', q.qid as string, `${W5B4_CONTROL}.a1.run.json`);
    writeFileSync(rj, `${w5b4Lib.canonicalJson({ ...w5b4Json(rj), code: 'x' }) as string}\n`, { mode: 0o600 });
    const r = await w5b4Arms(home, fx.argv);
    w5b4Expect(r.refusal).toEqual({ word: 'out-refused', detail: `run-json-invalid pilot/arms/${q.qid as string}/${W5B4_CONTROL}.a1` });
    w5b4Expect(r.stderr).toBe('ccrc history-replay: arms pilot stop out-refused: not-run count unmeasured; nothing is retried\n');
    const home2 = w5b4Home();
    const fx2 = w5b4Pilot(home2, { n: 1 });
    const q2 = fx2.entries[0]!;
    w5b4Expect((await w5b4Arms(home2, fx2.argv)).code).toBe(0);
    const ap = join(fx2.out, 'pilot', 'answers', `${q2.qid as string}.${W5B4_CONTROL}.json`);
    rmSync(ap);
    mkdirSync(ap);
    const r2 = await w5b4Arms(home2, fx2.argv);
    w5b4Expect(r2.refusal).toEqual({ word: 'out-refused', detail: `pilot/answers/${q2.qid as string}.${W5B4_CONTROL}.json is not a regular file` });
    w5b4Expect(r2.stderr).toBe(w5b4Stop('pilot', 'stop', 'out-refused', 0, 0));
  }, 120_000);

  w5b4It('arms takes only its form\'s flags, and --section is pilot or quiz', async () => {
    const home = w5b4Home();
    const said = async (argv: string[]): Promise<unknown> => (await w5b4Arms(home, argv)).refusal;
    w5b4Expect(await said(['arms'])).toEqual({ word: 'args-invalid', detail: 'arms wants --section pilot or --section quiz, not null' });
    w5b4Expect(await said(['arms', '--section', 'ab'])).toEqual({ word: 'args-invalid', detail: 'arms wants --section pilot or --section quiz, not "ab"' });
    w5b4Expect(await said(['arms', '--section', 'pilot', '--allow-code-change'])).toEqual({ word: 'args-invalid', detail: '--allow-code-change is not a arms --section pilot flag' });
    w5b4Expect(await said(['arms', '--section', 'quiz', '--account', 'up-a'])).toEqual({ word: 'args-invalid', detail: '--account is not a arms --section quiz flag' });
    w5b4Expect(await said(['arms', '--section', 'pilot', '--out', '/o'])).toEqual({ word: 'args-invalid', detail: 'record-required' });
    w5b4Expect(stubLog(home)).toBeNull();
  });
});

w5b4Describe.skipIf(process.platform === 'darwin')('W2-5b1 Task 4: arms end to end over a swept store', () => {
  let sb: W6SourceBox;
  w5b4BeforeAll(() => { sb = w6SourceBox('ccrc-w5b4-e2e-'); }, 360_000);

  w5b4It('RP1-arm on a real store: the control stdin is W2-5a\'s payload byte for byte, the treatment one card line, a blank line and that payload (Q20, W2-D50)', async () => {
    const home = sb.box.home;
    w5b4Node(home);
    const rs0 = D4.openReplayStore(home) as W5b4R;
    const storeId = rs0.storeId as string;
    rs0.close();
    const fam: W5b4Ref = { store_id: storeId, ccrc_id: sb.id, generation: sb.gen };
    const e = { ...fam, boundary_uuid: sb.u(5), kind: 'command', fact: sb.cmd, fact_raw: sb.cmd, question: 'Which command rebuilt the fixture package?',
      source_entry_uuid: sb.u(2), repo_roots: [sb.cwd] };
    const entry = { ...e, qid: D4.qidOf(e) as string };
    const fz = w5b4SaveText(D4.frozenListText('pilot', W5B4_HEAD, [entry]) as string, 'pilot-frozen.json');
    const d = w5b4Save(w5b4Draft(home, { stores: [storeId], pilotFamilies: [fam], pilotFrozenSha: fz.sha }), 'part1.json');
    w5b4Marker(home, storeId, [fam]);
    const out = w5b4Out();
    const r = await w5b4Arms(home, ['arms', '--section', 'pilot', '--out', out, ...w5b4Inp('record', d), ...w5b4Inp('frozen', fz)],
      { recheck: D4.recheckBatch, payloads: D4.armPayloads });
    w5b4Expect(r.refusal).toBeNull();
    const runs = w5b4Runs(home);
    w5b4Expect(runs).toHaveLength(2);
    for (const run of runs) {
      w5b4Expect(run.envKeys).toEqual([...T5_BASE_KEYS, ...T5_RECALL_KEYS].sort());
      w5b4Expect([run.env.CCRC_RECALL_SESSION, run.env.CCRC_RECALL_ASOF]).toEqual([sb.id, sb.u(5)]);
    }
    w5b4Expect(runs.map((x) => x.env.CCRC_RECALL_ARM).sort()).toEqual([...W5B4_ARMS].sort());
    const rs = D4.openReplayStore(home) as W5b4R;
    try {
      const id = Number((rs.db.prepare('SELECT entry_id FROM entries WHERE uuid = ?').get(sb.u(5)) as { entry_id: number }).entry_id);
      const want = D4.reconstructPayload(rs, id, entry.question) as { state: string; text: string };
      w5b4Expect(want.state, 'CONTROL: the boundary reconstructs').toBe('payload');
      const byArm = Object.fromEntries(runs.map((x) => [x.env.CCRC_RECALL_ARM as string, x.stdin as string]));
      w5b4Expect(byArm[W5B4_CONTROL], 'the control payload is W2-5a\'s composer\'s, byte for byte').toBe(want.text);
      const t = byArm[W5B4_TREATMENT]!;
      w5b4Expect(t.endsWith(`\n\n${want.text}`)).toBe(true);
      const card = t.slice(0, t.length - want.text.length - 2);
      w5b4Expect(card.length, 'a card line').toBeGreaterThan(0);
      w5b4Expect(card.includes('\n'), 'one line').toBe(false);
    } finally {
      rs.close();
    }
  }, 360_000);
});
```

The tests are live-safe in three ways:
- every HOME is a `mkTmp` fixture whose stub logs inside it;
- the end-to-end case's HOME is `w6SourceBox`'s, a swept fixture;
- the stub's acts write only inside its own HOME (the limits row, a recall-off entry, headless-on), each path built by lib's `historyPaths` and `recallOffPath` over that HOME.

- [ ] **Step 4: Run them and see them fail.** In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-5b1 Task 4|three box-mode spawns, one per taught spelling')
```

The filter selects this task's three describes and W2-4 Task 9's case that holds the re-pinned registration line. Expected RED (predicted, written before the code):
- **The registration case:** `expected [ 'step0a', …(8) ] to deeply equal [ 'step0a', …(9) ]`.
- **Every pure case:** `TypeError: D4.spendShareOf is not a function`, and the like for `questionStateOf`, `uptakeOf`, `armAnswerOf`, `expectedForNode` (its R30 scan is never reached), `armsSummaryOf`, `armRunName`, `streamEventsOf` and `readArmAnswers` (R31: its first row, the absent directory, throws before any refusal row; the CONTROL, the record read directly, is never reached).
- **Every stub case:** `w5b4Arms` answers `{ word: 'args-invalid', detail: 'unknown subcommand "arms"' }` where `null` or another refusal is expected. The `BEFORE_OUT` rows fail on the word (`args-invalid` for `code-changed` and so on). Their `--out` and stub-log assertions are never reached. The pilot settings-mode case (R31) fails at its first expectation, `args-invalid` where `record-invalid` `settings_mode out-of-range` is expected.
- **The end-to-end case:** the same `args-invalid` (darwin skips it). Past that, its fixture assumptions on `w6SourceBox` (the boundary `sb.u(5)` reconstructs, the source `sb.u(2)`, the command fact `sb.cmd`, the family `sb.id` at `sb.gen`) are predictions no planning step measured (R32): if Step 7 shows one does not hold, fix the fixture, never a guard, and record the measured value in this plan (R25). Measured at Step 7: every one of them held (the boundary `sb.u(5)` reconstructs, the source `sb.u(2)`, the command fact `sb.cmd`, the family `sb.id` at `sb.gen`), and the case passed on its first run.

- [ ] **Step 5: Extend the shared pieces.** In `deploy/history-replay.mjs`:

(a) The gate's import statement (Task 1's): add `QUESTION_OUTCOMES`, and each of `classifyRun`, `labelCorrect`, `parseAnswerField` and `questionOutcome` that Step 1 did not list, keeping the statement's code-unit order. No statement is added.

(b) In `SUBCOMMAND_FLAGS`, directly before the `});` that closes `const SUBCOMMAND_FLAGS = Object.freeze({`, add:

```js
  // W2-5b1 Task 4 (Q2, Q23): the pilot form reads part 1 and the pilot frozen list and takes no --allow-code-change (a
  // pilot act's remedy for a code change is a re-pilot, W2-D6); the quiz form reads part 2 with its part 1 and frozen list.
  'arms --section pilot': { required: ['section', 'out', ...DRAFT_INPUT, 'frozen', 'frozen-sha256'], optional: [...PRED_INPUT] },
  'arms --section quiz': { required: ['section', 'out', ...DRAFT_INPUT, 'part1', 'part1-sha256', 'frozen', 'frozen-sha256'], optional: [...PRED_INPUT, 'allow-code-change'] },
```

(c) Replace

```js
function loadFrozen(p, sha256) {
```

with

```js
function loadFrozen(p, sha256, section = 'quiz') {
```

and, inside it, `  const list = loadFrozenList(p, sha256, 'quiz');` with `  const list = loadFrozenList(p, sha256, section);`. Its JSDoc's first words, "The quiz's frozen list", become "A frozen list (the quiz's by default; W2-5b1 Task 4 reads the pilot's)".

(d) In `refuseOutOfRangeValues` (as Task 1 left it), replace

```js
export function refuseOutOfRangeValues({ budget, budgetField = 'pilot_budget', limits, quotas, part2 = null }) {
```

with

```js
export function refuseOutOfRangeValues({ budget, budgetField = 'pilot_budget', limits, quotas, part2 = null, batch = false }) {
```

and

```js
    ...(part2 === null ? [] : part2RangeChecks(part2)),
```

with

```js
    // W2-5b1 Task 4 (R4): the arm batch's shape, asked by `arms` on either part (part 2 also carries it through part2).
    ...(batch ? batchShapeChecks(limits) : []),
    ...(part2 === null ? [] : part2RangeChecks(part2)),
```

Its JSDoc's ` *    part2?: any }} o */` becomes ` *    part2?: any, batch?: boolean }} o */`, and the line above it gains one sentence: "`batch` adds batchShapeChecks' rows (W2-5b1 Task 4)."

(e) Replace `refuseWriterAdmission`'s definition, which reads exactly

```js
function refuseWriterAdmission({ home, accountId, budget, limits, quotas, expected }) {
  refuseOutOfRangeValues({ budget, limits, quotas });
  const { json, roster } = readRoster(home);
  const launch = admitAccount(json, roster, accountId, home);
  const wrapperSha256 = wrapperSha(launch);
  refuseOnLimits(home, accountId, { thresholdPct: limits.threshold_pct, maxAgeMs: limits.max_age_ms }, Date.now());
  const verdict = preflightFiles(expected, { stamp: readReleaseStamp(home), wrapperSha256, codeShas: codeShas() });
  if (!verdict.ok) refuse(verdict.word, verdict.detail);
}
```

with

```js
function refuseWriterAdmission({ home, accountId, budget, limits, quotas, expected }) {
  refuseOutOfRangeValues({ budget, limits, quotas });
  refuseSpawnAdmission({ home, accountId, limits, expected });
}

/** refuseWriterAdmission's no-store, no-spawn half (D-6307, D-6311), factored by W2-5b1 Task 4 so the writer, `arms` and
 *  `judge` ask one spelling (R26): the roster (`roster-invalid`), the account (`account-refused`), the wrapper's sha
 *  (`wrapper-unmeasured`), the limits row at open, then preflightFiles against `expected`, in that order. `allowCodeChange`
 *  (`arms` and `judge` after window start under --allow-code-change, Q23) lets preflightFiles answer a measured code change
 *  as a stamp, as the batch preflight does; the writer passes none, so its words and order are unchanged. Writes nothing.
 *  @param {{ home: string, accountId: string, limits: { threshold_pct: number, max_age_ms: number }, expected: object,
 *    allowCodeChange?: boolean }} o */
function refuseSpawnAdmission({ home, accountId, limits, expected, allowCodeChange = false }) {
  const { json, roster } = readRoster(home);
  const launch = admitAccount(json, roster, accountId, home);
  const wrapperSha256 = wrapperSha(launch);
  refuseOnLimits(home, accountId, { thresholdPct: limits.threshold_pct, maxAgeMs: limits.max_age_ms }, Date.now());
  const verdict = preflightFiles(expected, { stamp: readReleaseStamp(home), wrapperSha256, codeShas: codeShas() }, { allowCodeChange });
  if (!verdict.ok) refuse(verdict.word, verdict.detail);
}
```

The doc comment above `refuseWriterAdmission` stays. Its two W2-5a callers pass the same arguments as before, and `preflightFiles` with `{ allowCodeChange: false }` answers exactly what it answered with no options, so their cases (re-run in Step 9) are unchanged.

(f) In `openWriter`, replace its `preflightNow`, which reads exactly

```js
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
```

with

```js
  const preflightNow = async () => {
    // W2-5b1 Task 4 (R26): the one spawn preflight the writer, the arms and the judge share.
    const pre = await preflightSpawn({ launch, home, out, lang, gate, expected, allowCodeChange: o.allowCodeChange === true });
    for (const s of pre.stamps) stamps.add(s);
  };
```

`preflightSpawn` is declared in Step 6's section; a function declaration is hoisted, and `openWriter` calls it at run time only.


- [ ] **Step 6: Write the section.** In `deploy/history-replay.mjs`, directly above the comment line `// The entry guard stays the LAST block of this file`, after Task 3's section, insert:

```js
// ── W2-5b1 Task 4: the arm engine, `arms --section pilot|quiz` (W2-D78, W2-D80, W2-D56, W2-D55, W2-D64, W2-D82; S1, Q2 to Q5, Q14, Q23 to Q26, Q30, Q31) ──
// One subcommand, run per node in that node's own --out (Q2):
//   arms --section pilot   after part 1, on the pilot node, over the pilot frozen list's usage questions, under part 1's
//                          pilot_budget, limits, account, arm_model and settings_mode (W2-D55, W2-D76);
//   arms --section quiz    after part 2, on each named node, over the quiz questions on this node's store, under this
//                          node's share of spend_budget (Q5) and part 2's pilot_result.settings_mode (Q26).
// Both arms of each question run side by side, at the record's limits.concurrency, limits.batch_max / 2 questions per
// batch, in frozen qid order (Q3); batches loop inside one invocation, and armBatchPreflight, W2-D78's and W2-D56's checks
// composed once, runs before each. A run's attempt is in its name (`<section>/arms/<qid>/<arm>.a<n>`, Q4). A recorded run
// (its run.json written, W2-4) is classified by the gate's classifyRun over its stream's events, spawned and not stopped
// (a driver timeout has no result event: infra-failed); an arm's outcome is the gate's questionOutcome over its recorded
// attempts, and a question's is questionStateOf over its arms. A stop writes no run.json, so a stopped attempt is never an
// attempt: it keeps its number and is resumed, never consuming the re-run (W2-D80, Q24). Each batch writes a manifest
// before it spawns (Q14); each settled question writes one answer record per arm (W2-D82, W2-D64); the summary is
// rewritten after the last batch and on any refusal once --out is claimed, with the stop's word, its kind (Task 1's
// DRIVER_STOPS partition) and the not-run count, and one stderr line says so (Q30). Nothing is retried automatically.
// Every refusal that needs no spawn answers before prepareOut makes --out (W2-5a's R10, D-6307, D-6311, D-6309's rule).
// The run's loader, node values and answer reader (loadArmRun, armNodeOf, readArmAnswers), the no-spawn admission
// (refuseSpawnAdmission) and the spawn preflight (preflightSpawn) are shared with W2-5b1 Task 5's judge (R8, R26).
// The arm words are never spelled here: every per-arm value is keyed by RECALL_ARMS' members at run time (W2-D42).

/** The two sections an arm batch runs over (W2-D76, W2-D77). */
export const ARM_SECTIONS = Object.freeze(['pilot', 'quiz']);
/** W2-D80: one run and one re-run; a second infrastructure failure makes the arm run-failed. */
export const ARM_ATTEMPTS_MAX = 2;
/** The per-batch manifest (Q14), the per-(qid, arm) answer record (W2-D82) and the summary (Q30). */
export const ARM_BATCH_KIND = 'ccrc-history-w2-arm-batch';
export const ANSWER_KIND = 'ccrc-history-w2-answer';
export const ARMS_SUMMARY_KIND = 'ccrc-history-w2-arms-summary';
const ARM_BATCH_FILE_RE = /^[0-9]{4}\.json$/;
/** questionCountsOf's key for each of the gate's QUESTION_OUTCOMES. */
const QUESTION_COUNT_KEYS = Object.freeze({ answered: 'answered', 'run-failed': 'run_failed', rerun: 'rerun_owed', 'not-run': 'not_run' });

function armSectionOk(who, section) {
  if (!ARM_SECTIONS.includes(section)) throw new TypeError(`${who}: section ${JSON.stringify(section)} is not one of ${ARM_SECTIONS.join(', ')}`);
}
function armOk(who, arm) {
  if (!RECALL_ARMS.includes(arm)) throw new TypeError(`${who}: ${JSON.stringify(arm)} is not a RECALL_ARMS member`);
}
/** One arm run's name under --out (Q4): the attempt is part of it, so a re-run never overwrites the run it re-runs.
 *  @param {string} section  @param {string} qid  @param {string} arm  @param {number} attempt  @returns {string} */
export function armRunName(section, qid, arm, attempt) {
  armSectionOk('armRunName', section);
  armOk('armRunName', arm);
  if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > ARM_ATTEMPTS_MAX) throw new TypeError(`armRunName: attempt ${String(attempt)} is not 1 to ${ARM_ATTEMPTS_MAX}`);
  return `${section}/arms/${qid}/${arm}.a${attempt}`;
}
/** One (qid, arm)'s answer record under --out (W2-D82).  @returns {string} */
export function answerRel(section, qid, arm) {
  armSectionOk('answerRel', section);
  armOk('answerRel', arm);
  return `${section}/answers/${qid}.${arm}.json`;
}
/** The section's summary under --out (Q30).  @returns {string} */
export function armsSummaryRel(section) {
  armSectionOk('armsSummaryRel', section);
  return `${section}/arms/summary.json`;
}
const armBatchDir = (section) => `${section}/arms/batches`;

// ── pure ──
/** Q5: this node's share of part 2's spend_budget, ceil(budget × nNode / nAll), in integers (BigInt), so the share is
 *  exact for any safe budget. The share is at most the budget, so it is a safe integer. Pure.
 *  @param {number} budget  @param {number} nNode this node's questions  @param {number} nAll the frozen list's  @returns {number} */
export function spendShareOf(budget, nNode, nAll) {
  for (const [k, v] of [['budget', budget], ['nNode', nNode], ['nAll', nAll]]) {
    if (!Number.isSafeInteger(v) || v < 1) throw new TypeError(`spendShareOf: ${k} ${String(v)} is not a positive safe integer`);
  }
  if (nNode > nAll) throw new TypeError(`spendShareOf: ${nNode} questions of ${nAll}`);
  return Number((BigInt(budget) * BigInt(nNode) + BigInt(nAll) - 1n) / BigInt(nAll));
}

/** W2-D80: a question's state from its arms' outcomes (each the gate's questionOutcome over that arm's attempts). A
 *  run-failed arm fails the question, which is then excluded from both arms; both arms answered answer it; an owed re-run
 *  leaves it `rerun`; anything else is `not-run` (Q24's emergent rule). Pure.
 *  @param {readonly string[]} armStates  @returns {'answered' | 'rerun' | 'run-failed' | 'not-run'} */
export function questionStateOf(armStates) {
  if (!Array.isArray(armStates) || armStates.length === 0) throw new TypeError('questionStateOf: one outcome per arm');
  for (const s of armStates) if (!QUESTION_OUTCOMES.includes(s)) throw new TypeError(`questionStateOf: ${String(s)} is not a question outcome`);
  if (armStates.includes('run-failed')) return 'run-failed';
  if (armStates.every((s) => s === 'answered')) return 'answered';
  return armStates.includes('rerun') ? 'rerun' : 'not-run';
}

/** The summary's counts over questionStateOf's answers (Q30). Pure.
 *  @param {readonly string[]} states  @returns {{questions: number, answered: number, run_failed: number, rerun_owed: number, not_run: number}} */
export function questionCountsOf(states) {
  const c = { questions: states.length, answered: 0, run_failed: 0, rerun_owed: 0, not_run: 0 };
  for (const s of states) {
    const k = QUESTION_COUNT_KEYS[s];
    if (k === undefined) throw new TypeError(`questionCountsOf: ${String(s)} is not a question outcome`);
    c[k] += 1;
  }
  return c;
}

/** A recorded run's stream as the parsed events classifyRun reads: every line that is a JSON object, in order; any other
 *  line is skipped (readStreamJson counts it). Never throws. Pure.  @param {string} text  @returns {object[]} */
export function streamEventsOf(text) {
  const events = [];
  for (const line of String(text).split('\n')) {
    if (line.trim() === '') continue;
    try {
      const ev = JSON.parse(line);
      if (plainObject(ev)) events.push(ev);
    } catch {
      // not an event: readStreamJson's malformedLines
    }
  }
  return events;
}

/** Q31: every string `error` field the run's events carried, once each, sorted. Pure.  @param {object[]} events  @returns {string[]} */
export function errorFieldsOf(events) {
  return [...new Set(events.filter((e) => typeof e.error === 'string').map((e) => e.error))].sort();
}

/** W2-D82: an uptake call is a Bash tool_use whose command lib's isHistoryCommand reads as `ccrc history`, paired by id
 *  with a tool_result that is not is_error. One inside an Agent subagent (Task 1's parentToolUseId) counts, and is also
 *  counted as via_agent. A history call whose result is is_error is `errored` (the control arm's exit 8, which the pilot
 *  measures, W2-D82), never a call. A tool_use with no tool_result paired is neither. Pure.
 *  @param {ReadonlyArray<{name: string, input: unknown, result: string | null, isError: boolean | null, parentToolUseId: string | null}>} toolPairs
 *  @returns {{calls: number, via_agent: number, errored: number}} */
export function uptakeOf(toolPairs) {
  let calls = 0;
  let viaAgent = 0;
  let errored = 0;
  for (const p of toolPairs) {
    if (p.name !== 'Bash' || !plainObject(p.input) || typeof p.input.command !== 'string' || !isHistoryCommand(p.input.command)) continue;
    if (p.result === null && p.isError === null) continue;   // no tool_result paired by id
    if (p.isError === true) { errored += 1; continue; }
    calls += 1;
    if (typeof p.parentToolUseId === 'string') viaAgent += 1;
  }
  return { calls, via_agent: viaAgent, errored };
}

/** One answered run's answer (W2-D64): the gate's parseAnswerField over the result text, labelCorrect on a `value` only
 *  (W2-D63), the absent state kept apart for the absent rate, the reply as the run gave it (the judge redacts it, W2-D79),
 *  and uptakeOf. Pure.
 *  @param {{kind: string, fact: string, repo_roots: string[]}} entry  @param {{result: {text: string | null} | null, toolPairs: object[]}} facts
 *  @param {7 | 40} shaMinPrefix */
export function armAnswerOf(entry, facts, shaMinPrefix) {
  const reply = facts.result === null ? null : facts.result.text;
  const answerField = parseAnswerField(reply ?? '');
  const correct = answerField.state === 'value'
    && labelCorrect(entry.kind, entry.fact, answerField.value, { repoRoots: entry.repo_roots, shaMinPrefix });
  return { answer_field: answerField, correct, absent: answerField.state === 'absent', reply, uptake: uptakeOf(facts.toolPairs) };
}

/** W2-D56's `expected` for this node: part 1's step 0a entry for its store (version, wrapper) and gate_code (stamp, code
 *  shas), with the version replaced by the node's newest version-move amendment when part 2 carries one (W2-D90; Q13's
 *  detail `{claude_code_version, repilot_sha256}`, node_label_ref required). Amendments are append-only, so the newest
 *  is the last in array order. A version-move naming no node, or whose detail holds no version, is a record the gate
 *  should not have signed: record-invalid, before --out, through W2-5b1 Task 1's versionMoveChecks and refuseRangeRows,
 *  the one spelling of those two ranges (R30, W2-D12), never a second one here. Pure.
 *  @param {Record<string, any>} record  @param {string} storeId */
export function expectedForNode(record, storeId) {
  const node = record.nodes.find((n) => n.store_id === storeId);
  const entry = record.step0a.find((s) => s.store_id === storeId);
  if (node === undefined || entry === undefined) refuse('input-invalid', `store ${storeId} is not one of the record's nodes`);
  refuseRangeRows(versionMoveChecks(record));   // R30: Task 1's one spelling of the version-move ranges (W2-D12)
  let version = entry.claude_code_version;
  let from = 'step0a';
  (record.amendments ?? []).forEach((a, i) => {
    if (a.kind !== VERSION_MOVE_KIND || a.node_label_ref !== node.label) return;
    version = a.detail.claude_code_version;
    from = `amendments[${i}]`;
  });
  return { expected: { claude_code_version: version, release_stamp: record.gate_code.release_tag, wrapper_sha256: entry.wrapper_sha256,
    code_shas: record.gate_code.files }, from };
}

/** The summary (Q30, W2-D64): the counts over every question, and per arm over the answered questions only (a run-failed
 *  question is excluded from both arms, W2-D80): the answer states, the correct count and uptake (W2-D82); the absent
 *  rate per arm as an exact {num, den}. Pure.
 *  @param {{section: string, recordSha256: string, storeId: string, budget: object, spend: number, batches: number,
 *    stop: {word: string, kind: string, detail: string} | null, stamps: Iterable<string>,
 *    questions: Array<{qid: string, state: string, arms: Array<{arm: string, answer: object | null}>}>}} o */
export function armsSummaryOf({ section, recordSha256, storeId, budget, spend, batches, stop, stamps, questions }) {
  const zero = () => ({ answered: 0, value: 0, unknown: 0, absent: 0, correct: 0, uptake_questions: 0, uptake_calls: 0, via_agent: 0, errored: 0 });
  const arms = Object.fromEntries(RECALL_ARMS.map((arm) => [arm, zero()]));
  for (const q of questions) {
    if (q.state !== 'answered') continue;
    for (const a of q.arms) {
      const s = arms[a.arm];
      s.answered += 1;
      s[a.answer.answer_field.state] += 1;
      if (a.answer.correct) s.correct += 1;
      if (a.answer.uptake.calls > 0) s.uptake_questions += 1;
      s.uptake_calls += a.answer.uptake.calls;
      s.via_agent += a.answer.uptake.via_agent;
      s.errored += a.answer.uptake.errored;
    }
  }
  return {
    kind: ARMS_SUMMARY_KIND, v: 1, section, record_sha256: recordSha256, store_id: storeId, budget, spend, batches, stop,
    stamps: [...stamps].sort(), counts: questionCountsOf(questions.map((q) => q.state)), arms,
    absent_rate: Object.fromEntries(RECALL_ARMS.map((arm) => [arm, { num: arms[arm].absent, den: arms[arm].answered }])),
    questions: questions.map((q) => ({ qid: q.qid, state: q.state })),
  };
}

// ── measuring and acting ──
/** The pilot frozen list (W2-D73) through W2-5a's loadFrozen (the git-tree rule, its sha before a byte is parsed, the
 *  canonical bytes), and its sha must be part 1's pilot.frozen_sha256 (W2-D76). */
function loadPilotFrozen(flags, record) {
  const fz = loadFrozen(flags.frozen, flags['frozen-sha256'], 'pilot');
  if (fz.sha256 !== record.pilot.frozen_sha256) refuse('quiz-sha-mismatch', `frozen ${fz.sha256} is not the record's pilot.frozen_sha256 ${record.pilot.frozen_sha256}`);
  return fz;
}
/** This node's questions, in the frozen list's qid order (Q3). The pilot runs on its one node, so a pilot question on
 *  another store refuses; a node with no question has no arm batch to run. */
function nodeQuestions(section, entries, storeId) {
  const other = entries.find((e) => e.store_id !== storeId);
  if (section === 'pilot' && other !== undefined) refuse('input-invalid', `pilot question ${other.qid} is on store ${other.store_id}, not this node's ${storeId}`);
  const mine = entries.filter((e) => e.store_id === storeId);
  if (mine.length === 0) refuse('input-invalid', `the ${section} list holds no question on store ${storeId}`);
  return mine;
}
/** The arm run's inputs (R8, R26: the one loader `arms` and `judge` share), each refusal before any store, spawn or --out:
 *  quiz, Task 1's loadFinalRecord (the chain, W2-D24's re-check first with Q23's stamp after window start, the part 2
 *  ranges), the settings mode part 2's pilot_result.settings_mode (Q26); pilot, part 1 through loadRecordInput, its
 *  gate_code re-checked (recheckCode; the pilot forms take no --allow-code-change, Q23), then the pilot frozen list
 *  against part 1's pilot.frozen_sha256, the settings mode part 1's. Reads no store, spawns nothing, writes nothing.
 *  @param {Flags} flags  @param {'pilot' | 'quiz'} section  @param {{ nowMs: number }} o */
export function loadArmRun(flags, section, { nowMs }) {
  armSectionOk('loadArmRun', section);
  if (section === 'pilot') {
    const rec = loadRecordInput(flags, 'draft');
    const codeStamps = recheckCode(rec.record);   // W2-D24 (arms and judge --section pilot)
    const fz = loadPilotFrozen(flags, rec.record);
    if (!SETTINGS_MODES.includes(rec.record.settings_mode)) refuse('record-invalid', 'settings_mode out-of-range');
    return { section, record: rec.record, recordSha256: rec.sha256, frozen: fz, settingsMode: rec.record.settings_mode, allowCodeChange: false, codeStamps };
  }
  const rec = loadFinalRecord(flags, { nowMs });   // W2-D24 (arms and judge --section quiz)
  return { section, record: rec.record, recordSha256: rec.sha256, frozen: rec.frozen,
    settingsMode: rec.record.pilot_result.settings_mode,
    allowCodeChange: flags['allow-code-change'] === true, codeStamps: rec.stamps };
}

/** This node's values for an arm run (R26; Q2, Q5, W2-D56): the node named in the record (W2-D84's rule), this node's
 *  questions in frozen qid order, the budget in force (part 1's pilot_budget, or this node's share of spend_budget, Q5),
 *  W2-D56's expected values (expectedForNode), the account, the limits and the settings mode. Refuses before --out. */
export function armNodeOf(run, storeId) {
  const r = run.record;
  requireNamedNode(r, storeId);
  const questions = nodeQuestions(run.section, run.frozen.list.entries, storeId);
  const nAll = run.frozen.list.entries.length;
  const budget = run.section === 'pilot' ? r.pilot_budget : spendShareOf(r.spend_budget, questions.length, nAll);
  const { expected } = expectedForNode(r, storeId);
  return { questions, nAll, account: r.account, expected, budget, limits: r.limits, settingsMode: run.settingsMode };
}
/** One arm run (W2-D50): the family's id as CCRC_RECALL_SESSION, the arm, and boundary N as CCRC_RECALL_ASOF. */
function armJob(ctx, q, arm, attempt, stdin) {
  const job = { launch: ctx.launch, mode: 'arm', model: ctx.model, settingsMode: ctx.settingsMode,
    recall: { session: q.ccrc_id, arm, asof: q.boundary_uuid }, stdin, out: ctx.out, name: armRunName(ctx.section, q.qid, arm, attempt), lang: ctx.lang };
  return ctx.timeoutMs === undefined ? job : { ...job, timeoutMs: ctx.timeoutMs };
}
/** One arm's recorded attempts, each classified (W2-D80), its outcome and the attempt it owes next (null when settled).
 *  A recorded run is W2-4's finishedOutcome, which refuses a run recorded for another account, model or settings mode,
 *  or a changed stream; its exit code must be an integer or null, or classifyRun would throw (D-6309's rule). */
function armAttemptsOf(ctx, q, arm) {
  const attempts = [];
  for (let n = 1; n <= ARM_ATTEMPTS_MAX; n += 1) {
    const job = armJob(ctx, q, arm, n, '');
    const done = finishedOutcome(job);
    if (done === null) break;
    if (!(done.code === null || Number.isInteger(done.code))) refuse('out-refused', `run-json-invalid ${job.name}`);
    const read = readPlain(done.streamPath, OUT_STREAM_CAP);
    if (read.state !== 'bytes') refuse('out-refused', `run-stream-changed ${job.name}`);
    const events = streamEventsOf(read.bytes.toString('utf8'));
    const cls = classifyRun(events, done.code, { spawned: true, stopped: false });
    attempts.push({ name: job.name, class: cls, code: done.code, signal: done.signal ?? null, tokens: done.tokens, errorFields: errorFieldsOf(events), facts: done.facts });
    if (cls === 'answered') break;
  }
  const state = questionOutcome(attempts.map((t) => t.class));
  return { attempts, state, next: state === 'not-run' || state === 'rerun' ? attempts.length + 1 : null };
}
const answeredAttempt = (a) => a.attempts.find((t) => t.class === 'answered') ?? null;
/** One question's arms, its state, and the (arm, attempt) jobs it owes; a settled question owes none (a run-failed one
 *  is excluded from both arms, so its other arm's owed re-run is never spawned, W2-D80). */
function questionArmsOf(ctx, q) {
  const arms = RECALL_ARMS.map((arm) => ({ arm, ...armAttemptsOf(ctx, q, arm) }));
  const state = questionStateOf(arms.map((a) => a.state));
  const settled = state === 'answered' || state === 'run-failed';
  return { q, arms, state, next: settled ? [] : arms.filter((a) => a.next !== null).map((a) => ({ arm: a.arm, attempt: a.next })) };
}

/** W2-D78 and W2-D56 before one arm batch, composed once. Read-only first:
 *  (i) every batch family listed in headless-on for this store (Task 3's requireListed: family-unlisted);
 *  (ii) no batch family with a recall-off entry (W2-4's refuseRecallOff: family-recall-off);
 *  (iii) the batch's questions re-checked (Task 2's recheckBatch: quiz-unanswerable naming each failing qid and clause,
 *        over the roster's config dirs, R6), then each question's two payloads (Task 2's armPayloads, with the verdict's
 *        cut: plain to the control arm, carded to the treatment arm); a payload that no longer reconstructs refuses
 *        quiz-unanswerable `<qid> payload <word>`, never dropping the question (D-6469);
 *  then preflightSpawn (R26): the wrapper's sha, the gate (W2-D55: the budget, then the limits row), and the one spawn,
 *  `--version`, with W2-D56's preflight against ctx.expected. Answers each pending (qid, arm)'s stdin and the version. */
async function armBatchPreflight(ctx, pending) {
  const qs = pending.map((s) => s.q);
  requireListed(ctx.home, ctx.storeId, familiesOf(qs));   // W2-D78 (i)
  refuseRecallOff(ctx.home, [...new Set(qs.map((q) => q.ccrc_id))]);   // W2-D78 (ii)
  const verdicts = await ctx.deps.recheck(ctx.rs, qs, { configDirs: ctx.configDirs });   // W2-D78 (iii)
  const stdins = new Map();
  for (const s of pending) {
    const v = verdicts.get(s.q.qid);
    const p = ctx.deps.payloads(ctx.rs, v.boundaryEntryId, s.q.question, v.cut);
    if (p.state !== 'payloads') refuse('quiz-unanswerable', `${s.q.qid} payload ${p.why}`);   // D-6469
    const byArm = new Map([[CONTROL_ARM, p.plain], [TREATMENT_ARM, p.carded]]);
    for (const { arm } of s.next) stdins.set(`${s.q.qid} ${arm}`, byArm.get(arm));
  }
  const pre = await preflightSpawn({ launch: ctx.launch, home: ctx.home, out: ctx.out, lang: ctx.lang, gate: ctx.gate,
    expected: ctx.expected, allowCodeChange: ctx.allowCodeChange });
  for (const st of pre.stamps) ctx.stamps.add(st);
  return { stdins, version: pre.version };
}

/** W2-D56's preflight before a spawn batch, the one spelling the writer (`openWriter`), the arms (armBatchPreflight) and
 *  the judge (`openJudge`) share (R26), in W2-D56's order: the wrapper's sha (`wrapper-unmeasured` before any spawn), the
 *  gate (W2-D55), the one `--version` spawn, the stop check, then `preflight` against `expected` (`claude-version-moved`,
 *  `tree-moved`, `wrapper-moved`, `code-changed` and the four unmeasured words; a measured code change is a stamp under
 *  `allowCodeChange`). Answers the measured version and the stamps.
 *  @returns {Promise<{ version: string, stamps: string[] }>} */
async function preflightSpawn({ launch, home, out, lang, gate, expected, allowCodeChange = false }) {
  const wrapperSha256 = wrapperSha(launch);   // wrapper-unmeasured before any spawn
  gate();
  const version = await measureClaudeVersion(launch, out, lang);
  refuseIfStopping();
  const verdict = preflight(expected, { version, stamp: readReleaseStamp(home), wrapperSha256, codeShas: codeShas() }, { allowCodeChange });
  if (!verdict.ok) refuse(verdict.word, verdict.detail);
  return { version: version.version, stamps: verdict.stamps };
}
/** How many batch manifests the section holds (Q14): 0 before its first. */
function armBatchCount(ctx) {
  const rel = armBatchDir(ctx.section);
  const st = lstatOrNull(ctx.out, rel);
  if (st === null) return 0;
  if (!st.isDirectory()) refuse('out-refused', `${rel} is not a directory`);
  let names;
  try {
    names = readdirSync(path.join(ctx.out, rel));
  } catch (e) {
    refuse('out-refused', `${rel} unreadable ${errCode(e)}`);
  }
  return names.filter((n) => ARM_BATCH_FILE_RE.test(n)).length;
}
/** Q14: the batch's manifest, written after its preflight and before its first spawn, never replaced: the version the
 *  preflight measured, the stamps in force, and each planned run with its stdin's sha. A run's version is the last
 *  manifest that names it (a recorded run is never planned again). */
function writeArmManifest(ctx, version, planned) {
  const n = armBatchCount(ctx) + 1;
  ensurePlainDir(ctx.out, armBatchDir(ctx.section));
  const rel = `${armBatchDir(ctx.section)}/${String(n).padStart(4, '0')}.json`;
  if (lstatOrNull(ctx.out, rel) !== null) refuse('out-refused', `${rel} already exists`);
  writePlain(ctx.out, rel, canonicalJson({
    kind: ARM_BATCH_KIND, v: 1, section: ctx.section, record_sha256: ctx.recordSha256, store_id: ctx.storeId, batch: n,
    claude_code_version: version, stamps: [...ctx.stamps].sort(), preflight_ms: Date.now(),
    runs: planned.map((p) => ({ name: p.job.name, qid: p.qid, arm: p.arm, attempt: p.attempt, stdin_sha256: sha256Hex(p.job.stdin) })),
  }) + '\n');
}
/** One (qid, arm)'s answer record (W2-D82, W2-D64, Q31), for a settled question. */
function answerRecordOf(ctx, s, a) {
  const q = s.q;
  const won = answeredAttempt(a);
  const ans = won === null ? null : armAnswerOf(q, won.facts, ctx.shaMinPrefix);
  return {
    kind: ANSWER_KIND, v: 1, section: ctx.section, record_sha256: ctx.recordSha256, store_id: q.store_id,
    qid: q.qid, arm: a.arm, ccrc_id: q.ccrc_id, generation: q.generation, boundary_uuid: q.boundary_uuid, fact_kind: q.kind,
    question_state: s.state, arm_state: a.state,
    attempts: a.attempts.map((t) => ({ name: t.name, class: t.class, code: t.code, signal: t.signal, tokens: t.tokens, error_fields: t.errorFields })),
    run: won === null ? null : won.name,
    answer_field: ans === null ? null : ans.answer_field, correct: ans === null ? null : ans.correct,
    absent: ans === null ? null : ans.absent, reply: ans === null ? null : ans.reply, uptake: ans === null ? null : ans.uptake,
    stamps: [...ctx.stamps].sort(),
  };
}
/** Every settled question's two records, written once: a settled question's runs never change, so a record already there
 *  is left as it is; anything there that is not a regular file refuses out-refused (D-5986). */
function settleAnswers(ctx, states) {
  for (const s of states) {
    if (s.state !== 'answered' && s.state !== 'run-failed') continue;
    ensurePlainDir(ctx.out, `${ctx.section}/answers`);
    for (const a of s.arms) {
      const rel = answerRel(ctx.section, s.q.qid, a.arm);
      const have = lstatOrNull(ctx.out, rel);
      if (have !== null) {
        if (!have.isFile()) refuse('out-refused', `${rel} is not a regular file`);
        continue;
      }
      writePlain(ctx.out, rel, canonicalJson(answerRecordOf(ctx, s, a)) + '\n');
    }
  }
}
/** A section's answer records under --out, as the judge reads them (R8, R26; W2-5b2 reads the same files): each
 *  `<section>/answers/<qid>.<arm>.json` settleAnswers wrote, projected as {qid, arm, outcome, reply, correct}: `outcome`
 *  the record's arm_state, `reply` the answered attempt's raw result text (the judge redacts it, W2-D54), `correct` its
 *  labelCorrect flag. No directory is no record. A file it cannot read, or one that is not this section's answer record
 *  under its own name, refuses out-refused (D-5986, D-6309's rule).
 *  @param {string} out  @param {'pilot' | 'quiz'} section */
export function readArmAnswers(out, section) {
  armSectionOk('readArmAnswers', section);
  const rel = `${section}/answers`;
  const st = lstatOrNull(out, rel);
  if (st === null) return [];
  if (!st.isDirectory()) refuse('out-refused', `${rel} is not a directory`);
  let names;
  try {
    names = readdirSync(path.join(out, rel)).sort();
  } catch (e) {
    refuse('out-refused', `${rel} unreadable ${errCode(e)}`);
  }
  return names.map((n) => {
    const read = readPlain(path.join(out, rel, n), OUT_JSON_CAP);
    if (read.state !== 'bytes') refuse('out-refused', `${rel}/${n} ${read.state === 'bad' ? badWord(read) : read.state}`);
    let r;
    try {
      r = JSON.parse(read.bytes.toString('utf8'));
    } catch {
      refuse('out-refused', `${rel}/${n} is not JSON`);
    }
    if (!plainObject(r) || r.kind !== ANSWER_KIND || r.section !== section || `${r.qid}.${r.arm}.json` !== n) refuse('out-refused', `${rel}/${n} is not an answer record`);
    return { qid: r.qid, arm: r.arm, outcome: r.arm_state, reply: r.reply, correct: r.correct };
  });
}
/** The summary (Q30), rewritten whole; answers its path under --out. */
function writeArmsSummary(ctx, states, stop) {
  const questions = states.map((s) => ({ qid: s.q.qid, state: s.state, arms: s.arms.map((a) => {
    const won = answeredAttempt(a);
    return { arm: a.arm, answer: won === null ? null : armAnswerOf(s.q, won.facts, ctx.shaMinPrefix) };
  }) }));
  const summary = armsSummaryOf({ section: ctx.section, recordSha256: ctx.recordSha256, storeId: ctx.storeId, budget: ctx.budget,
    spend: spentSoFar(ctx.out), batches: armBatchCount(ctx), stop, stamps: ctx.stamps, questions });
  const rel = armsSummaryRel(ctx.section);
  ensurePlainDir(ctx.out, `${ctx.section}/arms`);
  writePlain(ctx.out, rel, canonicalJson(summary) + '\n');
  return rel;
}
/** Q30: a refusal once --out is claimed. The line names the word, its kind (Task 1's driverWordClass over the DRIVER_STOPS
 *  partition, so a word with no class is a defect, never a guess: a stop is resumed once its cause
 *  clears; any other word is a refusal the operator rules on) and the not-run count; the settled answers and the summary
 *  are written, except after `interrupted` (D-5984: nothing more after the signal handler has run). A second refusal while
 *  measuring leaves the counts unmeasured and the summary unwritten; the first refusal stands. */
function reportArmsStop(ctx, questions, e) {
  const kind = driverWordClass(e.word);
  let counted = 'not-run count unmeasured';
  try {
    const states = questions.map((q) => questionArmsOf(ctx, q));
    const c = questionCountsOf(states.map((s) => s.state));
    counted = `${c.not_run} question(s) not run, ${c.rerun_owed} owing a re-run`;
    if (e.word !== 'interrupted') {
      settleAnswers(ctx, states);
      writeArmsSummary(ctx, states, { word: e.word, kind, detail: e.detail });
    }
  } catch (e2) {
    if (!(e2 instanceof DriverRefusal)) throw e2;
  }
  process.stderr.write(`ccrc history-replay: arms ${ctx.section} ${kind} ${e.word}: ${counted}; nothing is retried\n`);
}

// A handler that takes deps after its env names that parameter driverEnv, never env (W2-4 Task 5's env scan).
/** `arms --section pilot|quiz` (W2 decisions §5 acts 14 and 21; W2-D78, W2-D80, W2-D56, W2-D55). In order: the section and
 *  its form's flags; HOME; loadArmRun (the record, its gate_code re-checked first, W2-D24; Q23's --allow-code-change, quiz
 *  only, after window start; the frozen list, the pilot's against part 1; the settings mode, Q26); the unusable inputs;
 *  the store, once (W2-5a's R3), and armNodeOf (this node named in the record, its questions, the budget in force, Q5,
 *  W2-D56's expected); the ranges with the batch shape (R4) and refuseSpawnAdmission (roster, account, wrapper, limits
 *  row, preflightFiles; R26); W2-D78 (i) and (ii) over every question; all before prepareOut. Then `--out` (fresh of
 *  pilot-source's output, Q25), the claim, the account, the gate, and the batch loop. Exit 0 with every question settled
 *  and `sha256 <hex>` of the summary on stderr, stdout empty (D-5983); a refusal exits 2 after reportArmsStop's line. */
export async function armsCommand(flags, driverEnv, deps = { recheck: recheckBatch, payloads: armPayloads, now: () => Date.now() }) {
  const section = flags.section;
  if (!ARM_SECTIONS.includes(section)) refuse('args-invalid', `arms wants --section pilot or --section quiz, not ${JSON.stringify(section ?? null)}`);
  checkFlags(`arms --section ${section}`, flags);
  const home = subcommandHome(driverEnv);
  const run = loadArmRun(flags, section, { nowMs: deps.now() });   // W2-D24 (arms): gate_code before any other input
  const record = run.record;
  refuseUnusableInputs(home, flags.out, [['arm-model', record.arm_model]]);
  const rs = openReplayStore(home);
  try {
    const storeId = rs.storeId;
    const node = armNodeOf(run, storeId);
    const { questions, budget, nAll } = node;
    refuseOutOfRangeValues({ budget, budgetField: section === 'pilot' ? 'pilot_budget' : 'spend_budget', limits: node.limits, quotas: null, batch: true });
    refuseSpawnAdmission({ home, accountId: node.account, limits: node.limits, expected: node.expected, allowCodeChange: run.allowCodeChange });   // arms: W2-5a's R10, D-6307, D-6311
    requireListed(home, storeId, familiesOf(questions));
    refuseRecallOff(home, [...new Set(questions.map((q) => q.ccrc_id))]);
    if (section === 'quiz') process.stderr.write(`ccrc history-replay: spend share ${budget} = ceil(${record.spend_budget} x ${questions.length} / ${nAll})\n`);
    const out = prepareOut(flags.out);
    refuseColonInRealOut(out);
    if (lstatOrNull(out, PILOT_SOURCE_FILE) !== null) refuse('out-refused', `${PILOT_SOURCE_FILE} is here: arms run on a fresh --out, never pilot-source's`);
    const claim = claimOut(out);
    try {
      const { json, roster } = readRoster(home);
      const launch = admitAccount(json, roster, node.account, home);
      const gate = batchGate({ out, home, accountId: launch.accountId, budget, limits: node.limits });
      const ctx = {
        section, home, out, rs, storeId, launch, gate, expected: node.expected, allowCodeChange: run.allowCodeChange, deps,
        configDirs: rosterConfigDirs(roster, home), model: record.arm_model, settingsMode: node.settingsMode,
        lang: driverEnv.LANG, timeoutMs: deps.timeoutMs, recordSha256: run.recordSha256, shaMinPrefix: record.labeller.sha_min_prefix,
        budget: { in_force: budget, spend_budget: section === 'quiz' ? record.spend_budget : null, n_node: questions.length, n_all: nAll },
        stamps: new Set(run.codeStamps),
      };
      const perBatch = Math.floor(node.limits.batch_max / RECALL_ARMS.length);
      let states;
      try {
        for (;;) {
          states = questions.map((q) => questionArmsOf(ctx, q));
          settleAnswers(ctx, states);
          const pending = states.filter((s) => s.next.length > 0).slice(0, perBatch);
          if (pending.length === 0) break;
          const pre = await armBatchPreflight(ctx, pending);
          const planned = pending.flatMap((s) => s.next.map(({ arm, attempt }) => ({ qid: s.q.qid, arm, attempt,
            job: armJob(ctx, s.q, arm, attempt, pre.stdins.get(`${s.q.qid} ${arm}`)) })));
          writeArmManifest(ctx, pre.version, planned);
          await runBatch(planned.map((p) => p.job), { gate, claim, concurrency: record.limits.concurrency });
        }
      } catch (e) {
        if (e instanceof DriverRefusal) reportArmsStop(ctx, questions, e);
        throw e;
      }
      const rel = writeArmsSummary(ctx, states, null);
      process.stderr.write(`sha256 ${shaOfPlain(out, rel)}\n`);
      return EXIT.OK;
    } finally {
      claim.release();
    }
  } finally {
    rs.close();
  }
}

HANDLERS.set('arms', (flags, env) => armsCommand(flags, env));
```

- [ ] **Step 7: Run them and see them pass, then the typecheck.** In the foreground, with a timeout of at least 600000 ms:

```bash
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-5b1 Task 4|three box-mode spawns, one per taught spelling|no violation, and the entry guard')
(cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts)
```

Expected (predicted, not measured): green.
- Every case of the three describes passes. On darwin the two spawning describes are skipped, and the pure one runs.
- So does the re-pinned registration case.
- W2-5a's writer and record-subcommand cases are green unchanged: `refuseWriterAdmission` and `openWriter` reach `refuseSpawnAdmission` and `preflightSpawn` with the arguments they used (R26).
- W2-4 Task 5's env scan (`no violation, and the entry guard…`) still finds no `, env,` on a code line: `armsCommand` names its parameter `driverEnv`, and `HANDLERS.set('arms', (flags, env) => …)` is W2-5a's spelling of the same line shape.
- `typecheck-tests` is green. A red on a `D4.*` call's inferred type is fixed with a cast at the call site, never by loosening the driver's JSDoc.

Record the measured pass count in the commit's task note.

- [ ] **Step 8: Measure every guard red, then green.** From the repository root. Each block applies one exact replacement, which must match exactly once, runs one filter and shows it red, then restores the file with `cp`. The python body is a quoted heredoc. The "Expected RED" lines are predicted: measure each one; if a measurement differs, record the corrected prediction in a separate `docs(plan): … (W2-5b1 Task 4)` commit touching only this plan (R25). Run the block one mutant per tool call (Global Constraints' "One mutant per tool call"). No mutant may make the loop spin: each one below either refuses, throws or settles every question.

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w2-5b1/t4"; mkdir -p "$SCRATCH"
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
cp "$F" "$SCRATCH/replay.t4.orig"
t() { (cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t "$1"); cp "$SCRATCH/replay.t4.orig" "$F"; cmp "$F" "$SCRATCH/replay.t4.orig"; }

# M1 (W2-D78 (i) per batch): the batch preflight skips the marker.
mut "$F" "  requireListed(ctx.home, ctx.storeId, familiesOf(qs));   // W2-D78 (i)" ""
t 'headless-on removed, or a recall-off entry written'
# Expected RED: 1 failed: the removed marker's second batch runs (r2.refusal is null, 12 runs).

# M2 (W2-D78 (ii) per batch): the batch preflight skips recall-off.
mut "$F" "  refuseRecallOff(ctx.home, [...new Set(qs.map((q) => q.ccrc_id))]);   // W2-D78 (ii)" ""
t 'headless-on removed, or a recall-off entry written'
# Expected RED: 1 failed: the recall-off case's refusal is null and the stub ran 12 times.

# M3 (W2-D78 (iii)): no re-check: every question passes with a verdict of its own.
mut "$F" "  const verdicts = await ctx.deps.recheck(ctx.rs, qs, { configDirs: ctx.configDirs });   // W2-D78 (iii)" "  const verdicts = new Map(qs.map((q) => [q.qid, { ok: true, boundaryEntryId: 0, cut: { qid: q.qid } }]));   // W2-D78 (iii)"
t 'an unanswerable question refuses its batch'
# Expected RED: 1 failed: the refusal is null and the stub ran 12 times.

# M4 (D-6469): a discarded payload is skipped instead of refused.
mut "$F" "    if (p.state !== 'payloads') refuse('quiz-unanswerable', \`\${s.q.qid} payload \${p.why}\`);   // D-6469" "    if (p.state !== 'payloads') continue;"
t 'a payload that no longer reconstructs'
# Expected RED: 1 failed: the job's stdin is undefined, and the manifest write hashes it first (writeArmManifest's
# sha256Hex(p.job.stdin)), so the error is the TypeError 'The "data" argument must be of type string or an instance of
# Buffer, TypedArray, or DataView. Received undefined' (a defect, rethrown by w5b4Arms), never the quiz-unanswerable
# refusal. Measured, over the predicted launchRun message (R25).

# M5 (before --out, W2-D78 (i)): the pre-check over every question removed.
mut "$F" "    requireListed(home, storeId, familiesOf(questions));" ""
t 'refuses before --out, with the stub log absent'
# Expected RED: 3 failed, the three family-unlisted rows: the batch preflight still refuses family-unlisted, but --out
# exists ("no --out is made": expected true to be false).

# M6 (before --out, W2-D78 (ii)): the pre-check removed.
mut "$F" "    refuseRecallOff(home, [...new Set(questions.map((q) => q.ccrc_id))]);" ""
t 'refuses before --out, with the stub log absent'
# Expected RED: 1 failed, the recall-off row, on --out existing.

# M7 (W2-D56, W2-D90): the version ignores the amendment.
mut "$F" "    version = a.detail.claude_code_version;
    from = \`amendments[\${i}]\`;" "    from = \`amendments[\${i}]\`;"
t "newest version-move amendment|the version preflight reads"
# Expected RED: 2 failed: the pure case (from amendments[2] but version unchanged) and the stub case (a.r.refusal null).

# M8: an amendment for any node moves this node's version.
mut "$F" "    if (a.kind !== VERSION_MOVE_KIND || a.node_label_ref !== node.label) return;" "    if (a.kind !== VERSION_MOVE_KIND) return;"
t "newest version-move amendment|the version preflight reads"
# Expected RED: 2 failed: the pure case's node B reads v-c; the stub case's CONTROL (node B's move) refuses claude-version-moved.

# M9: the oldest amendment wins.
mut "$F" "  (record.amendments ?? []).forEach((a, i) => {" "  [...(record.amendments ?? [])].reverse().forEach((a, i) => {"
t "newest version-move amendment|the version preflight reads"
# Expected RED: 2 failed: the pure case reads v-a for node A; the stub case's newest-move CONTROL refuses claude-version-moved.

# M10 (Q5): floor, not ceil.
mut "$F" "  return Number((BigInt(budget) * BigInt(nNode) + BigInt(nAll) - 1n) / BigInt(nAll));" "  return Number((BigInt(budget) * BigInt(nNode)) / BigInt(nAll));"
t 'spendShareOf is ceil|the per-node spend share'
# Expected RED: 2 failed: 600000 where 600001 is expected (pure), and the stub case's spend-share line and budget.

# M11 (Q5): the whole budget, not the share.
mut "$F" "  const budget = run.section === 'pilot' ? r.pilot_budget : spendShareOf(r.spend_budget, questions.length, nAll);" "  const budget = run.section === 'pilot' ? r.pilot_budget : r.spend_budget;"
t 'the per-node spend share'
# Expected RED: 1 failed: "spend share 1000001 = …" in the line, and the enforcement half answers "spent 130 of 100" with 2 runs.

# M12 (Q3): batch_max jobs read as batch_max questions.
mut "$F" "      const perBatch = Math.floor(node.limits.batch_max / RECALL_ARMS.length);" "      const perBatch = node.limits.batch_max;"
t 'batches: limits.batch_max / 2 questions each'
# Expected RED: 1 failed: 7 questions are 14 jobs, so runBatch throws "TypeError: runBatch: a batch is at most 10 jobs".

# M13 (Q3): not in frozen qid order.
mut "$F" "          const pending = states.filter((s) => s.next.length > 0).slice(0, perBatch);" "          const pending = states.filter((s) => s.next.length > 0).reverse().slice(0, perBatch);"
t 'batches: limits.batch_max / 2 questions each'
# Expected RED: 1 failed: batch 1 holds the last five questions.

# M14 (W2-D80, Q4): any infrastructure failure fails the arm at once.
mut "$F" "  const state = questionOutcome(attempts.map((t) => t.class));" "  const state = attempts.some((t) => t.class === 'infra-failed') ? 'run-failed' : questionOutcome(attempts.map((t) => t.class));"
t 'a driver timeout is infra-failed|a stop never consumes the re-run'
# Expected RED: 2 failed: q1 is run-failed after one timeout (no a2), and the limits case settles at once, with no stop.

# M15 (W2-D80): a run-failed arm does not fail its question.
mut "$F" "  if (armStates.includes('run-failed')) return 'run-failed';" ""
t 'questionStateOf|a driver timeout is infra-failed'
# Expected RED: 2 failed: ['answered','run-failed'] reads not-run; q2 is not-run in the summary and has no answer record.

# M16 (Q4): a timed-out run is read as a stopped one.
mut "$F" "    const cls = classifyRun(events, done.code, { spawned: true, stopped: false });" "    const cls = classifyRun(events, done.code, { spawned: true, stopped: done.signal !== null });"
t 'a driver timeout is infra-failed'
# Expected RED: 1 failed: q1 control's first attempt is not-run where infra-failed is expected.

# M17 (W2-D82): an errored history call counted as a call.
mut "$F" "    if (p.isError === true) { errored += 1; continue; }" "    if (p.isError === true) errored += 1;"
t 'uptakeOf counts|answer records per'
# Expected RED: 2 failed: calls 4 where 3 is expected (pure); the control's uptake {calls: 1, …, errored: 1}.

# M18 (W2-D82): via_agent never counted.
mut "$F" "    if (typeof p.parentToolUseId === 'string') viaAgent += 1;" ""
t 'uptakeOf counts|answer records per'
# Expected RED: 2 failed: via_agent 0 where 1 is expected.

# M19 (W2-D64, W2-D63): any value is correct.
mut "$F" "    && labelCorrect(entry.kind, entry.fact, answerField.value, { repoRoots: entry.repo_roots, shaMinPrefix });" "    && answerField.value !== '';"
t 'armAnswerOf|answer records per'
# Expected RED: 2 failed: the hedged pair reads correct.

# M20 (D-6309's rule): a run.json's exit code unchecked.
mut "$F" "    if (!(done.code === null || Number.isInteger(done.code))) refuse('out-refused', \`run-json-invalid \${job.name}\`);" ""
t 'a data case after --out refuses'
# Expected RED: 1 failed: "TypeError: classifyRun: exitCode must be an integer or null", a defect, rethrown by w5b4Arms.

# M21 (Q25): pilot-source's --out accepted.
mut "$F" "    if (lstatOrNull(out, PILOT_SOURCE_FILE) !== null) refuse('out-refused', \`\${PILOT_SOURCE_FILE} is here: arms run on a fresh --out, never pilot-source's\`);" ""
t 'an --out holding pilot-source.json'
# Expected RED: 1 failed: the refusal is null and the stub ran.

# M22 (W2-D24 first): the pilot list read before the code re-check.
mut "$F" "    const codeStamps = recheckCode(rec.record);   // W2-D24 (arms and judge --section pilot)
    const fz = loadPilotFrozen(flags, rec.record);" "    const fz = loadPilotFrozen(flags, rec.record);
    const codeStamps = recheckCode(rec.record);   // W2-D24 (arms and judge --section pilot)"
t 'refuses before --out, with the stub log absent|code-changed before any other input is read'
# Expected RED: 2 failed, the code-changed row and the W2-D24 `arms --section pilot` row: input-invalid "frozen list
# unreadable ENOENT" where code-changed is expected.

# M23 (Q26): part 1's settings mode in the quiz.
mut "$F" "    settingsMode: rec.record.pilot_result.settings_mode," "    settingsMode: rec.record.settings_mode,"
t 'pilot_result.settings_mode'
# Expected RED: 1 failed: the argv starts with --restricted.

# M24 (Q30): no summary or line on a refusal.
mut "$F" "        if (e instanceof DriverRefusal) reportArmsStop(ctx, questions, e);" ""
t 'an unanswerable question refuses its batch|a stop never consumes the re-run|the per-node spend share|a data case after --out'
# Expected RED: 4 failed (the filter's four cases): stderr lacks the stop line, and the summary carries no stop (in the
# limits case, the summary is absent and its read throws ENOENT).

# M25 (D-6309's rule, R4, R28, batch shape): batch_max 1 admitted (Task 1's floor, RECALL_ARMS.length).
mut "$F" "positiveInt(limits?.batch_max) && limits.batch_max >= RECALL_ARMS.length && " "positiveInt(limits?.batch_max) && "
t 'refuses before --out, with the stub log absent'
# Expected RED: 1 failed, the batch_max row: no refusal (perBatch 0 settles nothing, and the summary is written with every
# question not-run), so r.refusal is undefined and --out exists.

# M26 (R4): arms does not ask the batch shape.
mut "$F" "limits: node.limits, quotas: null, batch: true });" "limits: node.limits, quotas: null });"
t 'refuses before --out, with the stub log absent'
# Expected RED: 2 failed: the batch_max row (as M25) and the concurrency row ("TypeError: runBatch: concurrency must be 1 to 2"
# after --out, a defect).

# M27 (Q23): preflightFiles refuses an allowed code change before --out.
mut "$F" "  const verdict = preflightFiles(expected, { stamp: readReleaseStamp(home), wrapperSha256, codeShas: codeShas() }, { allowCodeChange });" "  const verdict = preflightFiles(expected, { stamp: readReleaseStamp(home), wrapperSha256, codeShas: codeShas() });"
t 'after window start stamps the manifest'
# Expected RED: 1 failed: the flagged run refuses code-changed.

# M28 (Q14): the manifest records no version.
mut "$F" "    claude_code_version: version, stamps: [...ctx.stamps].sort(), preflight_ms: Date.now()," "    claude_code_version: null, stamps: [...ctx.stamps].sort(), preflight_ms: Date.now(),"
t 'RP1-arm: both arms of each question'
# Expected RED: 1 failed: claude_code_version null.

# M29 (W2-D50): ASOF is the source entry, not boundary N.
mut "$F" "    recall: { session: q.ccrc_id, arm, asof: q.boundary_uuid }, stdin, out: ctx.out, name: armRunName(ctx.section, q.qid, arm, attempt), lang: ctx.lang };" "    recall: { session: q.ccrc_id, arm, asof: q.source_entry_uuid }, stdin, out: ctx.out, name: armRunName(ctx.section, q.qid, arm, attempt), lang: ctx.lang };"
t 'RP1-arm'
# Expected RED: 1 failed on the stub (the seen/want env lists differ); on a non-darwin box the end-to-end case also reds
# (ASOF is not boundary N's uuid). Task 2's recheck is not involved.

# M30 (Q31): error fields not recorded.
mut "$F" "  return [...new Set(events.filter((e) => typeof e.error === 'string').map((e) => e.error))].sort();" "  return [];"
t 'errorFieldsOf|answer records per'
# Expected RED: 2 failed.

# M31 (R26): readArmAnswers drops the reply.
mut "$F" "    return { qid: r.qid, arm: r.arm, outcome: r.arm_state, reply: r.reply, correct: r.correct };" "    return { qid: r.qid, arm: r.arm, outcome: r.arm_state, reply: null, correct: r.correct };"
t 'answer records per'
# Expected RED: 1 failed, the readArmAnswers row's reply null.

# M32 (R30): expectedForNode spells a version-move range again instead of reading Task 1's versionMoveChecks.
mut "$F" "  refuseRangeRows(versionMoveChecks(record));   // R30: Task 1's one spelling of the version-move ranges (W2-D12)" "  (record.amendments ?? []).forEach((a, i) => { if (a.kind === VERSION_MOVE_KIND && !record.nodes.some((n) => n.label === a.node_label_ref)) refuse('record-invalid', \`amendments[\${i}].node_label_ref out-of-range\`); });"
t 'expectedForNode: part 1'
# Expected RED: 1 failed, the pure case at its first detail row (null where amendments[0].detail.claude_code_version
# out-of-range was expected); its R30 scan would red too (a second refusal line, and versionMoveChecks( on 2 lines, not 3).

# M33 (R30): Task 1's label row dropped; expectedForNode, which reads it, stops refusing an unnamed label with it.
mut "$F" '    checks.push([`amendments[${i}].node_label_ref`, typeof a.node_label_ref === '"'"'string'"'"' && labels.has(a.node_label_ref)]);
' ''
t 'expectedForNode: part 1|the version preflight reads'
# Expected RED: 2 failed: the pure case's node-9 row refuses nothing (and its scan counts 0 label lines), and the stub
# case's node-9 row runs (d.r.refusal null) where record-invalid before --out was expected.

# M34 (R31): readArmAnswers' unreadable-file refusal removed.
mut "$F" "    if (read.state !== 'bytes') refuse('out-refused', \`\${rel}/\${n} \${read.state === 'bad' ? badWord(read) : read.state}\`);" ""
t 'readArmAnswers refuses out-refused'
# Expected RED: 1 failed, at the link row: the missing bytes throw inside the JSON parse's try and are refused out-refused
# `<rel>/<name> is not JSON` where `not-regular` was expected; the CONTROL row before it stays green.

# M35 (R31): readArmAnswers takes any kind.
mut "$F" "    if (!plainObject(r) || r.kind !== ANSWER_KIND || r.section !== section" "    if (!plainObject(r) || r.section !== section"
t 'readArmAnswers refuses out-refused'
# Expected RED: 1 failed, at the another-kind row: the summary-kinded file is read as a row where out-refused was expected.

# M36 (R31): the pilot's part 1 settings mode not ranged.
mut "$F" "    if (!SETTINGS_MODES.includes(rec.record.settings_mode)) refuse('record-invalid', 'settings_mode out-of-range');" ""
t 'settings mode is ranged before --out'
# Expected RED: 1 failed: no record-invalid; the run makes --out and reaches spawnArgv's TypeError on the settings mode
# "open" (a defect, rethrown by w5b4Arms). The fallback CONTROL is not reached in that run; it is green on the restored file.

# M37 (R31, D-5986): readArmAnswers follows a link.
mut "$F" "    const read = readPlain(path.join(out, rel, n), OUT_JSON_CAP);" "    const read = readPlain(path.join(out, rel, n), OUT_JSON_CAP, true);"
t 'readArmAnswers refuses out-refused'
# Expected RED: 1 failed, at the link row: the linked record is read as a row; the directory row would still refuse.

# M38 (W2-D78 "before any spawn", per batch): (i) and (ii) moved below the batch's --version spawn.
mut "$F" "  requireListed(ctx.home, ctx.storeId, familiesOf(qs));   // W2-D78 (i)
  refuseRecallOff(ctx.home, [...new Set(qs.map((q) => q.ccrc_id))]);   // W2-D78 (ii)
" ""
mut "$F" "    expected: ctx.expected, allowCodeChange: ctx.allowCodeChange });
  for (const st of pre.stamps)" "    expected: ctx.expected, allowCodeChange: ctx.allowCodeChange });
  requireListed(ctx.home, ctx.storeId, familiesOf(qs));   // W2-D78 (i)
  refuseRecallOff(ctx.home, [...new Set(qs.map((q) => q.ccrc_id))]);   // W2-D78 (ii)
  for (const st of pre.stamps)"
t 'headless-on removed, or a recall-off entry written'
# Expected RED: 1 failed: the refusal word and the 10 print-mode runs are unchanged, but batch 2 spawned its --version
# before refusing (2 --version lines where 1 was expected).
```

Then run Step 7's commands again: green (predicted).

Two pins have no mutant of this task's own:
- **The stop half of "a stop never consumes the re-run".** A stopped run writes no `run.json`. That is W2-4 `launchRun`'s order, pinned by W2-4's resume cases. This task's half is the attempt numbering, and M14 shows it red here.
- **The `interrupted` branch of `reportArmsStop`.** No case sends a signal mid-batch. W2-4's D-5984 cases pin that nothing is written after the handler has run. The branch only stops this task's own writes, and the plan says so in its JSDoc.

One refusal has no case of its own, by design (Global Constraints' Red-first names the exception): `armAttemptsOf`'s `out-refused` `run-stream-changed <name>`. It re-reads the stream `finishedOutcome` has just read and matched against its recorded sha, in the same synchronous stretch, so no case can reach it. It is defence behind that check, which W2-4's resume cases pin, and it stays unpinned here.

- [ ] **Step 9: Run the neighbours that read the driver.** In the foreground, with a timeout of at least 600000 ms. If a file goes red, re-run it alone before calling it a break (CLAUDE.md's load flakes; `typecheck-tests` is one):

```bash
(cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'recall-off|operator switches have readers only|every vocabulary is declared once')
(cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts)
(cd server && ./node_modules/.bin/vitest run test/citations.test.ts)
```

Expected: green (predicted).
- **`history-replay`:** every earlier task's cases, the re-pinned registration case and this task's.
  - W2-5a Task 6's writer cases and Task 7's pilot-source and quiz-source cases are unchanged by (d), (e) and (f): the writer passes no `batch` and no `allowCodeChange`, and `preflightSpawn` is `preflightNow`'s body (R26).
  - Task 1's arm-word scan finds no arm word in the driver: this task keys every per-arm value by `RECALL_ARMS`.
  - Task 1's partition pin still classifies every `DRIVER_REASONS` word once: this task adds no word.
  - Task 1's import pin is unchanged: the gate's names are not in `EXACT_NAMES`.
- **`single-definition`:** O13's scans read no new recall-off or headless-on line. This task calls `refuseRecallOff` and Task 3's `requireListed` and spells neither path, `/headless-on` nor `.headlessOn`. O14 finds no `VOCABS` name declared in the driver.
- **`typecheck-tests`:** green.
- **`citations`:** no added code or test line cites `file.mjs:N` (D-5893).

- [ ] **Step 10: Commit.**

```bash
git add deploy/history-replay.mjs server/test/history-replay.test.ts
CO_AUTHORED_BY='<the Co-Authored-By line the attribution reminder gives>'
git commit -m "feat(history-replay): the arm engine, arms --section pilot|quiz, both arms per question in batches, preflighted before every batch (W2-5b1 Task 4; W2-D78, W2-D80, W2-D56, W2-D55, W2-D64, W2-D82; D-6469)" -m "$CO_AUTHORED_BY"
```

The departure this task first cites, D-6469 (R3), is defined in this plan's "Deviations found".

### Task 5: The judge: one blinded judge-mode spawn per non-correct (qid, arm), retried once, then judge-failed (W2-D79, W2-D54, W2-D80, W2-D18; Q18)

Tasks 1 to 4 leave the driver able to run both arms of every question of a section on this node, under the W2-D78 and W2-D56 preflights, and to record one answer per (qid, arm) under `--out` (Task 4). Nothing yet labels a wrong answer. This task adds `judge --section pilot|quiz`, the judge half of the decisions document's acts 14 (the usage pilot's judge, Q6) and 21 ("the arm batches, and then the judge batches"). It runs on each node, in that node's `--out`, after the section's arm batches (Q2).

- **Who reaches the judge (W2-D79, W2-D80).** Every question of this node's in the section must be settled first, as Task 4 settles it (R14): both arms `answered`, or either arm `run-failed`. Task 4 writes both arms' records when a question settles, so the other arm of a run-failed question can read `rerun` or `not-run`: its owed attempt is never spawned, and it is settled with its question (R20's run-failed read per question). A missing record, or a `rerun` or `not-run` arm in a question with no `run-failed` arm, refuses `input-invalid` `arms-unsettled`, before any spawn. Then:
  - a question either of whose arms is `run-failed` leaves the judge in both arms (W2-D80: "excluded from both arms");
  - a correct answer never reaches the judge. Correctness is re-derived here from the arm's own reply, through the gate's `parseAnswerField` and `labelCorrect` (the one definition, W2-D63), and held to the record's `correct` flag: a disagreement refuses `out-refused` (`answer-record-mismatch`), never a silent pick of either;
  - every other answer is judged: a wrong value, `UNKNOWN`, a reply with no `ANSWER:` line, an empty reply.
- **The input (W2-D79, W2-D54).** Canonical `{v: 1, kind, question, expected, answer_field, reply}`. `expected` is F, the frozen entry's `fact`. `answer_field` is the reply's last `ANSWER:` line as `parseAnswerField` reads it: its value, the protocol's own `UNKNOWN`, or `null` when there is none (the gate's `RUBRIC_HEAD` wording). Every string field is masked as a VALUE by W2-5a's `maskValue` (lib's `redactFinalJson`, `redactField` whole first) before anything serialises it (D-6308's rule), and only then are the reply and the answer field each cut to `JUDGE_REPLY_MAX_BYTES` (16,384) bytes of UTF-8, in whole code points (the field's cut is D-6470). The stdin is the signed rubric (`RUBRICS[rubric_id]`), a blank line, the canonical input and one newline, the writer's shape (`writerStdin`).
- **Blinding (W2-D79, Q18).** No arm token reaches an input or any file name. Each item is named by a positional id, `j0001` onward, from the seeded `'judge-order'` shuffle (W2-D18: the record's `bootstrap.seed`, substream `'judge-order'`, W2-5a's `seededOrder`) over every (qid, arm) pair of the section's frozen list, sorted by (qid, arm) by code unit (W2-D79 as amended 2026-10-20). The id-to-(qid, arm) map is its own file, `<section>/judge.map.json`, pinned under `--out` (a resume that would map an id to another pair refuses). Runs are `<section>/judge/<id>-<attempt>`; inputs are pinned as `<section>/judge/<id>.input.json`. The output, `<section>/judged.json`, names ids only.
- **The spawn (W2-D79; RP1-judge, RP3-judge).** `openJudge` mirrors W2-5a's `openWriter`: the model is an exact Opus id (`args-invalid` otherwise, before admission), the account is admitted from the roster (W2-D52; `cx-a`, `ext-n`, `ext-a` and `gen-o` refused before any spawn), the gate is `batchGate` (W2-D55), and W2-D56's preflight runs at open and before every batch (Task 4's `preflightSpawn`); before `--out` exists, `judge` makes every refusal `arms` makes there: D-5813's unusable inputs (`refuseUnusableInputs`: a HOME or `--out` holding `:`, a judge model that is not a model id), the Opus check (`refuseOpusModel`, asked again at open), D-6309's ranges over the budget in force and the limits (`refuseOutOfRangeValues`: part 1's `pilot_budget` is ranged by no loader), and Task 4's `refuseSpawnAdmission`, the no-spawn half. Jobs run through `runBatch` in judge mode (`--tools ""`), at most `BATCH_MAX` (10) per batch and `CONCURRENCY_MAX` (2) at once.
- **Malformed, retried once, then judge-failed (W2-D79, W2-D81).** A reply with no `^LABEL:[ \t]*(uncertain|fabricated)\s*$` line (the gate's `parseLabelLine`), or a run that failed (a non-zero exit, a signal, no result event: D-6305's rule for the writer, applied to the judge), is a malformed attempt. It is spawned once more, with byte-identical stdin, in a later batch; a second malformed attempt makes the item `judge-failed`, which W2-5b2's hand-check sheet always lists. A labelled attempt is never spawned again.
- **A stop never consumes the retry (W2-D80's rule; D-5984).** A `limits-*`, `budget-exhausted`, moved, unmeasured or `interrupted` stop throws before its run's `run.json` is written, so a resume spawns that same attempt again under the same name, and a finished attempt is skipped (W2-D53). `judged.json` is written only when every item is settled, and is a function of the finished runs alone.
- **Every `error` field is recorded (Q31).** Each judge attempt carries `error_fields`, every string `error` field its run's stream printed, once each, sorted, read through Task 4's `streamEventsOf` and `errorFieldsOf`, as each arm attempt does. A judge run refused for authentication is where the unmeasured `authentication_failed` spelling may first appear.

RP1-judge and RP3-judge land here (decisions §2, W2-5b's Pins), with three of W2-D79's pins: the stdin carries no arm token, malformed twice gives `judge-failed`, and a correct answer never reaches the judge. (W2-D79's fourth pin, a confident wrong value of another kind under `v1`, is the rubric's text and W2-3's.) Nothing here spawns a real model: every spawn reaches W2-4's recording stub in a fixture `HOME`.

**Files:**
- Modify: `deploy/history-replay.mjs`.
  - Task 1's `./history-gate.mjs` import statement (about :43 at c34f82830) and lib's (about :37): merge in whichever of `RUBRICS`, `RUBRIC_IDS`, `labelCorrect`, `parseAnswerField` and `parseLabelLine` (gate) and `RECALL_ARMS` (lib) Step 1 finds missing, keeping one statement per module, the names in code-unit order. `RUBRIC_SHA256`, `FACT_KINDS`, `substream` and `canonicalJson` are there at c34f82830. Add no import line; the header's `Imports:` sentence is Task 1's (W2-5a's R3, carried).
  - `pinWriterInput` (about :4294 at c34f82830, anchored by `function pinWriterInput(out, rel, text) {`): its body becomes `pinOutBytes`, one function both roles call; the writer's words (`writer-input-changed <rel>`) are unchanged.
  - `refuseWriterModel` (about :4305, anchored by `function refuseWriterModel(model) {`): its body becomes `refuseOpusModel(flag, model)`; the writer's words (`writer-model "<id>" is not an exact Opus model id`) are unchanged.
  - `SUBCOMMAND_FLAGS` (about :4811, anchored by `const SUBCOMMAND_FLAGS = Object.freeze({`): two forms, `'judge --section pilot'` and `'judge --section quiz'`, directly after Task 4's two `arms` forms, each repeating its `arms` form's lists (the judge reads exactly what the arms read, through Task 4's `loadArmRun`), the quiz form alone listing `allow-code-change`.
  - One new section, directly after Task 4's section (which ends with `HANDLERS.set('arms', …)`) and above the comment `// The entry guard stays the LAST block of this file` (about :5796), ending with its registration, `HANDLERS.set('judge', (flags, env) => judgeCommand(flags, env));`.
- Modify: `server/test/history-replay.test.ts`.
  - W2-4 Task 9's case `three box-mode spawns, one per taught spelling, …` (about :4785; its pin about :4824, anchored by `expect([...t9Driver.HANDLERS.keys()]).toEqual([`): the array gains `'judge'` as its last element, after Task 4's `'arms'`.
  - One block appended at the end of the file: its own three `w5b5`-prefixed import lines, its module-level fixtures and four describes.
- Not edited: every other file. No file is created. The stub, the fixture HOME (`w6Box`), the writer-stream builder (`w6Reply`) and the account rows are W2-4's and W2-5a's, already module-level in the test file.

**Interfaces:**
- Consumes (W2-4 and W2-5a, at c34f82830; names exact):
  - `readRoster(home) -> {json, roster}`, `admitAccount(json, roster, id, home) -> LaunchSpec` (`account-refused` with `kind-codex`, `kind-external` or `provider-openai`), `batchGate({out, home, accountId, budget, limits}) -> () => void`, `LIMITS_DEFAULTS`, `runBatch(jobs, {gate, claim, concurrency?}) -> Promise<RunOutcome[]>` (`RunOutcome` is `{name, skipped, code, signal, ms, cwd, streamPath, facts: StreamFacts, tokens, unknownOptions}`), `BATCH_MAX`, `SETTINGS_MODES`, `prepareOut`, `claimOut`, `spentSoFar(out)`, `openReplayStore(home) -> {storeId, idx, close(), …}` (W2-5a Task 1), `maskValue(value, idx)` (D-6308), `seededOrder(rng, items, keyOf)` (W2-5a Task 5), `qidOf`.
  - Module-private: `requireClaim`, `refuse`, `plainObject`, `cmpUnit`, `readPlain`, `writePlain`, `ensurePlainDir`, `shaOfPlain`, `badWord`, `OUT_JSON_CAP`, `OUT_STREAM_CAP`, `checkFlags`, `subcommandHome`, `refuseUnusableInputs` (D-5813), `refuseOutOfRangeValues` (D-6309, as Task 1 widened it), `refuseColonInRealOut`, `pinWriterInput`, `refuseWriterModel`. They are reachable because this section is in the same module.
  - Test side: `runDriver`, `claimFor`, `plantStub`, `stubLog`, `T5Log`, `STUB_STREAM`, `T5_STUB_LOG`, `T5_STUB_SLEEP`, `T5_TOKEN`, `T5_BASE_KEYS`, `T5_RECALL_KEYS`, `T5_BASH_KEYS`, `T5_NEVER_KEYS`, `T5_STUB_SOURCE`, `t5Argv`, `withoutDarwinAdded`, `refusalLine`, `W6Box`, `w6Box`, `w6Expected`, `w6Runs`, `w6Reply`, `w6Akia`, `w6PlantPrintExit`, `W6_PRINT_EXIT`, `W6_MODEL`, `W6_CMD`, `W6_CMD2`, `W6_ERR`, `W6_GEN`, `W6_BOUNDARY`, `W6_SOURCE`, `W6_SECRET`, `W6_IDX`, `W6_LONE_SURROGATE`, `t4Lib`, and the module-level imports `replay`, `DriverRefusal`, `sha256Hex`, `mkTmp`, `vi`.
- Consumes (W2-3's gate, at c34f82830): `RUBRICS` (`{v1, 'v1-strict'}` texts), `RUBRIC_IDS` (`['v1','v1-strict']`), `RUBRIC_SHA256`, `FACT_KINDS`, `GATE_REASONS`, `parseLabelLine(reply) -> {ok: true, label: 'uncertain'|'fabricated'} | {ok: false}`, `parseAnswerField(text) -> {state:'value', value} | {state:'unknown'} | {state:'absent'}`, `labelCorrect(kind, F, value, {repoRoots, shaMinPrefix}) -> boolean`, `substream(seedHex, label)`, `randInt` (test side), `EXACT_MODEL_ID_RE`, `OPUS_MODEL_RE`.
- Consumes (lib, W2-2b's): `RECALL_ARMS` (`['control','treatment']` as values; never spelled in the driver, W2-D42), `canonicalJson`, `EXIT`; test side `REDACTED_MARK`, `redactField`.
- Consumes (Task 1): the import statements and their pin (D-5814), the arm-word scan of the driver (W2-D42) and the `ASSIGNMENT_ARMS`/`RECALL_ARMS` set parity, which this task's code must keep green; the stop/refusal partition of `DRIVER_REASONS` (this task adds no word).
- Consumes (Task 4, by its names, R8 and R26). Step 1 checks each name and stops if one is missing or differently shaped; it never defines one here:
  - `ARM_SECTIONS`, exported, `Object.freeze(['pilot','quiz'])`;
  - the two `arms` forms of `SUBCOMMAND_FLAGS` (`'arms --section pilot'` and `'arms --section quiz'`, the latter alone listing `allow-code-change`), whose lists this task's two `judge` forms repeat;
  - `loadArmRun(flags, section, {nowMs}) -> ArmRun`, exported: for `quiz` Task 1's `loadFinalRecord` (the chain, `recheckCode` first or, after window start under `--allow-code-change`, its stamp, Q23, then the part 2 ranges, S2's C22); for `pilot` part 1, `recheckCode` and the pilot frozen list. It reads no store, spawns nothing and writes nothing. `ArmRun` is `{section, record, recordSha256: string, frozen: {sha256: string, list: {entries: FrozenEntry[]}}, settingsMode, allowCodeChange: boolean, codeStamps: string[]}`; this task reads `record.bootstrap.seed`, `record.judge_model`, `record.rubric_id` and `record.labeller.sha_min_prefix`;
  - `armNodeOf(run, storeId) -> ArmNode`, exported: `requireNamedNode`, then this node's `{questions, nAll, account: string, expected: {claude_code_version, release_stamp, wrapper_sha256, code_shas}, budget: number, limits: {threshold_pct, max_age_ms, …}, settingsMode: string}` (W2-D56's values, the newest version-move amendment's version when there is one; the budget in force, `pilot_budget` or this node's share of `spend_budget`, Q5; the settings mode, Q26);
  - `refuseSpawnAdmission({home, accountId, limits, expected, allowCodeChange})`, module-private: the no-store, no-spawn half of W2-5a's `refuseWriterAdmission` (roster, account, wrapper sha, the limits row at open, `preflightFiles`; D-6307, D-6311);
  - `preflightSpawn({launch, home, out, lang, gate, expected, allowCodeChange}) -> Promise<{version, stamps}>`, module-private: W2-D56's preflight as W2-5a's `openWriter` runs it (`wrapperSha`, the gate, `measureClaudeVersion`, `refuseIfStopping`, `preflight`), refusing on a mismatch and answering the measured version and the code-change stamps;
  - `readArmAnswers(out, section) -> ArmAnswer[]`, exported: every (qid, arm) answer record this node's `--out` holds for the section, refusing `out-refused` on one it cannot read. `ArmAnswer` is `{qid: string, arm: string, outcome: string, reply: string|null, correct: boolean|null}`: `outcome` the record's `arm_state`, `reply` the answered attempt's raw result text (R16; null when not answered), and `correct` `labelCorrect` over its ANSWER field (null when not answered). Task 4 writes records only for settled questions, both arms at once, so an unsettled question has none; `outcome` is `answered` or `run-failed`, except the other arm of a run-failed question, whose record keeps its own `rerun` or `not-run` because its owed attempt is never spawned (R14);
  - `streamEventsOf(text) -> object[]` and `errorFieldsOf(events) -> string[]`, exported, pure: a recorded run's stream as its events, and every string `error` field among them, once each, sorted (Q31).
- Produces (`deploy/history-replay.mjs`):
  - `JUDGE_REPLY_MAX_BYTES = 16384`; `JUDGE_INPUT_KEYS = Object.freeze(['answer_field','expected','kind','question','reply','v'])`; `JUDGE_ATTEMPTS = 2`; `JUDGE_OUTCOMES = Object.freeze(['judged','judge-failed'])`; `JUDGE_ID_RE` (`/^j[0-9]{4,}$/`); `JUDGE_DIR = 'judge'`; `JUDGE_MAP_FILE = 'judge.map.json'`; `JUDGED_FILE = 'judged.json'`; `JUDGE_MAP_KIND = 'ccrc-history-w2-judge-map'`; `JUDGED_KIND = 'ccrc-history-w2-judged'`;
  - `capUtf8Bytes(text, maxBytes) -> string`, pure: the longest whole-code-point prefix whose UTF-8 is at most `maxBytes`;
  - `judgeInputOf(entry: FrozenEntry, reply: string|null, idx) -> {v: 1, kind, question, expected, answer_field: string|null, reply}`, pure; the reply and the answer field each cut at `JUDGE_REPLY_MAX_BYTES` after masking (D-6470);
  - `judgeStdin(rubricId, input) -> string`, exactly `` `${RUBRICS[rubricId]}\n\n${canonicalJson(input)}\n` ``; a rubric id outside `RUBRIC_IDS` is a `TypeError`;
  - `judgeMapOf(seedHex, entries: Array<{qid}>, arms) -> Array<{id, qid, arm}>`, pure, in id order;
  - `judgeMapText(section, frozenSha256, map) -> string`, `canonicalJson({kind: JUDGE_MAP_KIND, v: 1, section, frozen_sha256, items})` and one newline;
  - `judgeItemsOf({entries, answers, arms, shaMinPrefix}) -> {items: Array<{qid, arm, entry, reply: string}>, excluded: {correct: number, run_failed_questions: number}}`; it refuses (`out-refused`, `input-invalid`) and never throws a `TypeError` on data;
  - `judgeJobsOf({items, map, idx}) -> Array<{id, input}>`, pure, in id order;
  - `openJudge({home, accountId, model, settingsMode, rubricId, claim, budget, limits, expected, allowCodeChange?, lang}) -> Promise<{launch, stamps(): string[], judge(section, jobs): Promise<JudgedItem[]>}>`. `JudgedItem` is `{id, outcome: 'judged'|'judge-failed', label: 'uncertain'|'fabricated'|null, attempts: Array<{run, code, signal, skipped, tokens, result: boolean, label: 'uncertain'|'fabricated'|null, error_fields: string[]}>}` (`error_fields`: Q31);
  - `judgeCommand(flags, driverEnv, deps = {loadArmRun, armNodeOf, readArmAnswers, now: () => Date.now()}) -> Promise<number>`, registered as `judge`; `deps.now` is the clock `loadArmRun` gets (Q23's window test), a test seam and never a flag;
  - module-private `pinOutBytes(out, rel, text, what)` (refuses `out-refused` `<what>-changed <rel>`), `refuseOpusModel(flag, model)`, `answerFieldOf`, `JUDGE_PAIR_SEP`, `judgePairKey`, `judgeAttemptOf`;
  - the files under `--out`: `<section>/judge.map.json` (every (qid, arm) of the section's frozen list, identical bytes on every node), `<section>/judge/<id>.input.json`, `<section>/judge/<id>-<attempt>.{jsonl,run.json}`, and `<section>/judged.json`: `{kind: JUDGED_KIND, v: 1, section, store_id, record_sha256, frozen_sha256, map_sha256, judge_model, rubric_id, rubric_sha256, settings_mode, reply_max_bytes, items: JudgedItem[], counts: {judged, judge_failed, uncertain, fabricated, excluded_correct, excluded_run_failed_questions}, budget, spend, stamps}`. W2-5b2's hand-check sheet and report read the two section files (Q18, Q19).

**Spec:** §10.2 (at c34f82830, about :2628): "Who sees what" (about :2665: "the judge see[s] redacted text only"; "How they run", SE10: the driver's spawn contract, `--tools ""`, the account allow-list, inputs on stdin, outputs only under `--out`), "Scoring" (about :2716: `uncertain` and `fabricated` "judged by an `opus` judge with a rubric, with 20% hand-checked"), and the pins RP1 and RP3 (about :2752 and :2754), their judge halves. W2-5b1 amends none of it; E22's single-ANSWER-field and widened-`uncertain` errata are W2-5b2's (D-5776, D-5777, D-5778, W2-3's).

**Decisions:**
- W2-D79: the spawn, the canonical input, the 16 KiB cap, no arm token in inputs or file names, the `'judge-order'` shuffle over items sorted by (qid, arm), the last LABEL line, one retry with identical input, `judge-failed`; the rubric signed by `rubric_id` (D-5778 cited bare; W2-3's).
- W2-D54: every field redacted whole before any cut; `redactDisplayWindow` never used.
- W2-D80: a run-failed question excluded from both arms, and settled in both, whatever its other arm's own record reads (R14); a stop never consumes a re-run (applied to the judge's retry).
- W2-D81: `judge-failed` items reach the hand-check sheet (W2-5b2's).
- W2-D18 as amended: a seeded draw over a list sorted by a stated key.
- W2-D50, W2-D51, W2-D52, W2-D55, W2-D56: the judge goes through the allow-list env (no `CCRC_RECALL_*`), judge mode, admission, the gate and the preflight before every batch.
- W2-D24: `judge` is one of W2-5b's `--record` consumers; its re-check is Task 4's loader, called first.
- W2-D53: resume skips finished runs.
- Q2 (per node, in that node's `--out`), Q5 (the node's budget share, through `armNodeOf`), Q18 (positional ids; the map in its own file), Q23 (`--allow-code-change` after window start, through `loadArmRun`; the stamps in `judged.json`), Q31 (every `error` field on each judge attempt), S1 (W2-5b1's subcommand); R14, R16 (the record's raw reply, redacted here), R18, R19, R20, R23 and R26.
- D-5813 and D-6309's rule, cited bare: the unusable inputs and the ranges refused before `--out`, as `arms` refuses them, so no data case reaches `batchGate`'s or `spawnEnv`'s `TypeError` after `--out`.

**Choices this task makes:**
- **The map covers every (qid, arm) pair of the section's frozen list, not only the judged ones.** Q2 runs the judge on each node, and ids drawn over one node's judged items would repeat across nodes (`j0001` on every node), so W2-5b2's sheet and report could not merge them. A shuffle over the whole frozen list's pairs, drawn from the record's seed, is the same on every node, so each id names one pair globally and every node writes byte-identical maps; a node judges its own non-correct items in that order, under their global ids, with gaps. A uniform shuffle restricted to a subset is uniform on the subset, so the arms still mix across batches (W2-D79). The map is pinned under `--out`, so a resume never reads a finished `j0007` run as another pair's (R18).
- **The judge refuses until this node's arms are settled (R20).** Act 21 runs the judge after the arm batches; a judged file built over a partial set would read as complete. `arms-unsettled` is `input-invalid` (the input is not yet what the judge consumes), with the count of unsettled pairs and the first qid, and nothing is spawned; the remedy is to finish `arms`. Settledness is the question's, as Task 4 decides it (R14, W2-D80): a question either arm of which is `run-failed` is settled in both, so its other arm's `rerun` or `not-run` record never refuses, because `arms` will never spawn that arm again and a refusal there could never clear. R20's "answered or run-failed" is read so: `run-failed` per question.
- **The same refusals before `--out` as `arms` (W2-5a's R10, D-5813, D-6309's rule).** `judge` reads the same record, so it refuses what `arms` refuses before `prepareOut`: a HOME or `--out` holding `:` and a judge model that is not a model id (`refuseUnusableInputs`), a judge model that is not an exact Opus id (`refuseOpusModel`, which `openJudge` asks again at open), and the budget in force and the limits out of range (`refuseOutOfRangeValues`, with `pilot_budget` for the pilot, which no loader ranges, and the node's share of `spend_budget` for the quiz). Without them a bad value would reach `batchGate`'s or `spawnEnv`'s `TypeError` after `--out` exists. The judge asks no batch shape: it runs at `BATCH_MAX` and `runBatch`'s default concurrency, never the record's.
- **Correctness is re-derived, and held to the record.** The judge parses the reply's ANSWER field and calls the gate's `labelCorrect` itself, so a mis-set flag in an answer record can never send a correct answer to the judge, nor keep a wrong one from it: a disagreement refuses `out-refused` `answer-record-mismatch <qid>`. An answer record for a qid outside this node's frozen entries or an arm outside `RECALL_ARMS`, or a pair recorded twice, refuses the same way. Each is a refusal, never a `TypeError`, because it is data under `--out` (D-6309's rule: a data case after `--out` never exits INTERNAL).
- **`answer_field` is its own field, cut at the same cap.** The ANSWER line is the reply's last line, so a head cut of a long reply drops it; carrying it as its own field keeps it in front of the judge. W2-D79 caps the reply only, but a model can put a long dump on its ANSWER line, so the field is cut at the same 16 KiB after masking and the judge's stdin stays bounded: **D-6470** (`history-w2-judge-answer-field-cap`), issued by the coordinator (R3) and defined in "Deviations found".
- **Every string is masked, not only the reply.** `question` and `expected` passed the writer's screens, but `maskValue` adds the final belt (D-6308); masking all four strings as values keeps "the judge sees redacted text only" true by construction. A field the belt masks is shown masked, the fail-closed direction.
- **A failed judge run is a malformed attempt.** A non-zero exit, a signal or no result event yields no label, whatever the run printed (D-6305's rule for the writer). W2-D80's infrastructure re-run is the arms' (`classifyRun` reads arm runs); for the judge, the one retry W2-D79 grants covers both shapes, and a second failure is `judge-failed`, which the operator labels (W2-D81). The attempt record keeps `code`, `signal` and `result`, so a failing account is visible apart from a malformed reply (R19).
- **Attempts run in passes.** Pass 1 spawns attempt 1 of every job; pass 2 spawns attempt 2 of every malformed one ("in a later batch"). Each pass is cut into batches of `BATCH_MAX`, the preflight before each. The retry's stdin is the same string, built from the pinned input, so it is byte-identical.
- **`judge` always opens the judge, even with no job.** The preflight is one `--version` call and spends nothing, and a `judged.json` is then always written under a preflighted tree.
- **`UNKNOWN` is the protocol's own spelling** (`ANSWER_PROTOCOL`: "`ANSWER: UNKNOWN`"), whatever case the reply used; `null` is "gave none".

**Not in this task:** the hand-check sheet and the label reader (W2-5b2, Q18, Q19); `report` and agreement by arm (W2-5b2); the usage pilot's extrapolation (W2-5b2 reads the judge's spend from the ledger); a walk that runs Task 4's real `arms` and then `judge` over one stubbed `--out` (Task 6's, R21; here Task 4's three readers are injected, except that the W2-D24 rows, the `--allow-code-change` case and the spend-share case read Task 4's fixture records through its real `loadArmRun`, the last two with its real `armNodeOf` too); the reply text that can reveal the arm (W2-D79's residual, reported split by arm in W2-5b2); lib's `redactField` glued-prefix limit (S2's C23, a named residual in the PR body).

- [ ] **Step 1: Confirm the earlier tasks' names before using them.** From the repository root:

```bash
node --no-warnings --input-type=module -e "const d = await import('./deploy/history-replay.mjs'); const need = ['loadArmRun','armNodeOf','readArmAnswers','streamEventsOf','errorFieldsOf','maskValue','seededOrder','runBatch','batchGate','readRoster','admitAccount','openReplayStore','prepareOut','claimOut','spentSoFar','qidOf','parseArgs']; console.log(need.map((n) => n + ':' + typeof d[n]).join(' ')); console.log(JSON.stringify(d.ARM_SECTIONS), Object.keys(d.LIMITS_DEFAULTS).length > 0); console.log(['judgeInputOf','judgeMapOf','openJudge','judgeCommand'].map((n) => typeof d[n]).join(','), d.HANDLERS.has('arms'), d.HANDLERS.has('judge'))"
grep -cE "^(export )?(async )?function (refuseSpawnAdmission|preflightSpawn)\(" deploy/history-replay.mjs
grep -E "^import .* from '(\.\./ccd/history/lib|\./history-gate)\.mjs';$" deploy/history-replay.mjs | grep -oE "\b(RECALL_ARMS|RUBRICS|RUBRIC_IDS|labelCorrect|parseAnswerField|parseLabelLine)\b" | sort -u
grep -cE "^  'arms --section (pilot|quiz)': \{" deploy/history-replay.mjs
grep -c "^HANDLERS.set('arms', " deploy/history-replay.mjs
grep -c '^function w5b4Pilot(' server/test/history-replay.test.ts
grep -c '\bw5b5[A-Z][A-Za-z]*\b' server/test/history-replay.test.ts
```

Expected (R8: every name is its owner's):
- The first command prints every name in `need` as `function`. Next it prints `["pilot","quiz"] true`. Then it prints `undefined,undefined,undefined,undefined true false`. Importing the module runs nothing: the entry guard needs `process.argv[1]`.
- `2`: Task 4's `refuseSpawnAdmission` and `preflightSpawn`.
- The import names Task 1 already merged (`RECALL_ARMS`, `RUBRICS`, `labelCorrect`, `parseAnswerField`, `parseLabelLine`); Step 4 merges `RUBRIC_IDS` and any other that is absent.
- `2` and `1`: Task 4's two `arms` forms and its registration.
- `1`: Task 4's `w5b4Pilot`, whose fixtures this task's W2-D24 rows reuse.
- No `w5b5`-prefixed names exist yet (count 0). A `grep -c` that prints 0 exits 1, which is expected.

Any other answer is a gap in an earlier task: stop and report it. In particular, an `ArmAnswer` that does not carry the answered attempt's reply text (`reply`) or its `correct` flag changes `judgeItemsOf` and every case of the second describe; an `ArmRun` that does not carry `frozen.list.entries` or `codeStamps`, or an `ArmNode` that does not carry `account`, `expected`, `budget`, `limits` and `settingsMode`, changes `judgeCommand`. Never define any of these names here.

- [ ] **Step 2: Write the failing tests.** In `server/test/history-replay.test.ts`, in W2-4 Task 9's case `three box-mode spawns, one per taught spelling, and a denial for one spelling is recorded for that one only; exit 0`, the line that begins `    expect([...t9Driver.HANDLERS.keys()]).toEqual([` gains `'judge'` as the array's last element. At Task 4's head it reads, in full:

```ts
    expect([...t9Driver.HANDLERS.keys()]).toEqual(['step0a', 'probe', 'pilot-source', 'quiz-source', 'freeze', 'power', 'open', 'verify', 'marker', 'arms', 'judge']);
```

(Re-anchor by content: keep exactly the names Task 4 left there and append `'judge'`; the comment above it stays as Task 3 left it.)

Then append this block at the end of the file:

```ts
// ── W2-5b1 Task 5: the judge (W2-D79, W2-D54, W2-D80, W2-D18; Q18, Q2) ──────────────────────────────────────────
// Live safety: every spawn reaches W2-4's recording stub at `$HOME/.local/bin/<id>` in a mkTmp fixture HOME (W2-5a Task
// 6's w6Box), through spawnEnv's allow-list, with the poisoned gh first on PATH; nothing spawns a real model. The
// subcommand cases open a createStore store in that HOME and inject Task 4's three readers (the record, the node, the
// answers), except the W2-D24 rows and the --allow-code-change case, which read Task 4's fixture records (mkTmp files)
// through its real loader; no case reads a real record or the live HOME. Key-shaped values are assembled at runtime, and non-ASCII
// ones are built with String.fromCharCode. Arm values are RECALL_ARMS' own, never spelled here.
import * as w5b5Lib from '../../ccd/history/lib.mjs';
import * as w5b5Gate from '../../deploy/history-gate.mjs';
import { createStore as w5b5CreateStore } from '../../ccd/history/store.mjs';

type W5b5Entry = {
  qid: string; store_id: string; ccrc_id: string; generation: string; boundary_uuid: string; kind: string; fact: string;
  fact_raw: string; question: string; source_entry_uuid: string; repo_roots: string[];
};
type W5b5Answer = { qid: string; arm: string; outcome: string; reply: string | null; correct: boolean | null };
type W5b5Input = { v: number; kind: string; question: string; expected: string; answer_field: string | null; reply: string };
type W5b5Attempt = { run: string; code: number | null; signal: string | null; skipped: boolean; tokens: number; result: boolean; label: string | null; error_fields: string[] };
type W5b5Item = { id: string; outcome: string; label: string | null; attempts: W5b5Attempt[] };
type W5b5Job = { id: string; input: W5b5Input };
type W5b5MapRow = { id: string; qid: string; arm: string };
type W5b5Judge = { launch: unknown; stamps(): string[]; judge(section: string, jobs: W5b5Job[]): Promise<W5b5Item[]> };
type W5b5Picked = { items: Array<{ qid: string; arm: string; entry: W5b5Entry; reply: string }>; excluded: { correct: number; run_failed_questions: number } };
/** The driver's judge surface, typed once here, so no case needs its own cast. */
type W5b5Drv = {
  JUDGE_REPLY_MAX_BYTES: number; JUDGE_INPUT_KEYS: readonly string[]; JUDGE_ATTEMPTS: number; JUDGE_OUTCOMES: readonly string[];
  JUDGE_ID_RE: RegExp; JUDGED_KIND: string; JUDGE_MAP_KIND: string; ARM_SECTIONS: readonly string[];
  FLAG_SPECS: Record<string, string>;
  DRIVER_REASONS: readonly string[]; HANDLERS: Map<string, unknown>; LIMITS_DEFAULTS: Record<string, number>;
  capUtf8Bytes(text: string, maxBytes: number): string;
  maskValue(value: unknown, idx: unknown): unknown;
  judgeInputOf(entry: W5b5Entry, reply: string | null, idx: unknown): W5b5Input;
  judgeStdin(rubricId: string, input: W5b5Input): string;
  judgeMapOf(seedHex: string, entries: ReadonlyArray<{ qid: string }>, arms: readonly string[]): W5b5MapRow[];
  judgeMapText(section: string, frozenSha256: string, map: W5b5MapRow[]): string;
  judgeItemsOf(o: { entries: W5b5Entry[]; answers: W5b5Answer[]; arms: readonly string[]; shaMinPrefix: number }): W5b5Picked;
  judgeJobsOf(o: { items: W5b5Picked['items']; map: W5b5MapRow[]; idx: unknown }): W5b5Job[];
  openJudge(o: Record<string, unknown>): Promise<W5b5Judge>;
  judgeCommand(flags: Record<string, unknown>, env: Record<string, unknown>, deps?: Record<string, unknown>): Promise<number>;
  refuse(word: string, detail: string): never;
};
const W5B5 = replay as unknown as W5b5Drv;
const W5B5_ARMS = w5b5Lib.RECALL_ARMS as unknown as readonly string[];
const [W5B5_ARM0, W5B5_ARM1] = W5B5_ARMS as unknown as [string, string];
const W5B5_STORE = '00000000-0000-4000-8000-0000000005b5';
const W5B5_OTHER_STORE = '00000000-0000-4000-8000-0000000005b6';
const W5B5_SEED = sha256Hex('w2-5b1 task 5 fixture: seed');
/** The (qid, arm) key's separator, a NUL built at runtime (no escape in the file, Global Constraints), as the driver's is. */
const W5B5_NUL = String.fromCharCode(0);
/** Judge streams: W2-5a's writer stream builder, so the init line (the stub's --version) never moves. */
const W5B5_LABELLED = w6Reply('The answer names one other command, with no hedge.\nLABEL: fabricated');
const W5B5_MALFORMED = w6Reply('I cannot tell which of the two labels fits this answer.');
/** A stream the variant stub prints once, to the first print-mode run that takes it (w5b5PlantOnce). */
const W5B5_ONCE = 'stub-stream-once.jsonl';
const W5B5_ENV = (home: string): Record<string, unknown> => ({ HOME: home, TMUX_PANE: undefined, LANG: 'fixture.UTF-8' });

/** A frozen entry (W2-D73's fields) on `storeId`, its qid computed by qidOf. No question names an arm. */
function w5b5Entry(fact: string, storeId: string = W5B5_STORE, kind = 'command'): W5b5Entry {
  const six = { store_id: storeId, ccrc_id: 'fixture-ccrc-a', generation: W6_GEN, boundary_uuid: W6_BOUNDARY, kind, fact };
  return { qid: replay.qidOf(six as never) as string, ...six, fact_raw: fact,
    question: `Which command rebuilt step ${fact.length} of the fixture package?`, source_entry_uuid: W6_SOURCE, repo_roots: ['/home/u/tree'] };
}
const w5b5Answer = (qid: string, arm: string, outcome: string, reply: string | null, correct: boolean | null): W5b5Answer =>
  ({ qid, arm, outcome, reply, correct });
/** `n` jobs with positional ids j0001.., each a wrong answer to its own command question. */
function w5b5Jobs(n: number): W5b5Job[] {
  return Array.from({ length: n }, (_, k) => ({
    id: `j${String(k + 1).padStart(4, '0')}`,
    input: W5B5.judgeInputOf(w5b5Entry(`npm run fixture-step-${k} --workspace pkg-a`), `ANSWER: npm run other-${k}`, W6_IDX),
  }));
}
function w5b5Open(b: W6Box, id: string, over: Record<string, unknown> = {}): Promise<W5b5Judge> {
  return W5B5.openJudge({
    home: b.home, accountId: id, model: W6_MODEL, settingsMode: 'restricted', rubricId: 'v1', claim: b.claim, budget: 100_000,
    limits: W5B5.LIMITS_DEFAULTS, expected: w6Expected(b.home, id), lang: 'fixture.UTF-8', ...over,
  });
}
/** The recording stub with one more setting: in print mode only, a W5B5_ONCE stream is taken (renamed away, so exactly
 *  one run gets it) and printed instead of STUB_STREAM. Its --version calls never take it. The shared stub is untouched. */
function w5b5PlantOnce(home: string, id: string): void {
  const tail = `process.stdout.write(opt(${JSON.stringify(STUB_STREAM)}) ?? '');`;
  expect(T5_STUB_SOURCE.split(tail)).toHaveLength(2);
  const once = [
    'let once = null;',
    "if (process.argv.slice(2).includes('-p')) {",
    `  const taken = at(${JSON.stringify(W5B5_ONCE)} + '.' + process.pid);`,
    `  try { fs.renameSync(at(${JSON.stringify(W5B5_ONCE)}), taken); once = fs.readFileSync(taken, 'utf8'); } catch { once = null; }`,
    '}',
    `process.stdout.write(once ?? opt(${JSON.stringify(STUB_STREAM)}) ?? '');`,
  ].join('\n  ');
  writeFileSync(join(home, '.local', 'bin', id), T5_STUB_SOURCE.replace(tail, once), { mode: 0o700 });
}
/** The judge order spelled independently of the driver: (qid, arm) pairs sorted by code unit, then Fisher-Yates over
 *  the gate's own stream for `label`, by randInt, as W2-D18 and W2-D79 state it. */
function w5b5Order(seed: string, pairs: Array<[string, string]>, label = 'judge-order'): Array<[string, string]> {
  const key = ([q, a]: [string, string]): string => `${q}${W5B5_NUL}${a}`;
  const out = [...pairs].sort((x, y) => (key(x) < key(y) ? -1 : key(x) > key(y) ? 1 : 0));
  const rng = w5b5Gate.substream(seed, label);
  for (let s = 0; s < out.length - 1; s += 1) {
    const j = s + w5b5Gate.randInt(rng, out.length - s);
    [out[s], out[j]] = [out[j]!, out[s]!];
  }
  return out;
}
/** Every path under `root`, relative, sorted. */
function w5b5Files(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const n of readdirSync(dir)) {
      const r = rel === '' ? n : `${rel}/${n}`;
      out.push(r);
      if (lstatSync(join(dir, n)).isDirectory()) walk(join(dir, n), r);
    }
  };
  walk(root, '');
  return out.sort();
}
/** An in-process call, its stderr captured and its refusal, if any, answered as {word, detail}. */
async function w5b5InProcess(fn: () => Promise<unknown>): Promise<{ code: unknown; stderr: string; refusal: { word: string; detail: string } | null }> {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stderr, 'write').mockImplementation(((s: string | Uint8Array) => { lines.push(String(s)); return true; }) as typeof process.stderr.write);
  try {
    return { code: await fn(), stderr: lines.join(''), refusal: null };
  } catch (e) {
    if (e instanceof DriverRefusal) return { code: null, stderr: lines.join(''), refusal: { word: e.word, detail: e.detail } };
    throw e;
  } finally {
    spy.mockRestore();
  }
}
/** Flags that pass `judge --section <section>`'s grammar (its form repeats the arms form's lists), each input a placeholder:
 *  the injected loaders never read them. */
function w5b5Flags(out: string, section: string): Record<string, unknown> {
  const sha = 'a'.repeat(64);
  const input = '/home/u/fixture-input.json';
  const part1 = section === 'quiz' ? { part1: input, 'part1-sha256': sha } : {};
  return { record: input, 'record-sha256': sha, ...part1, frozen: input, 'frozen-sha256': sha, out, section };
}
/** Task 4's ArmRun, as the judge reads it: the record's four judge fields, the section's frozen list, no stamps. */
function w5b5Run(entries: W5b5Entry[], over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    record: { judge_model: W6_MODEL, rubric_id: 'v1', bootstrap: { seed: W5B5_SEED }, labeller: { sha_min_prefix: 7 } },
    recordSha256: sha256Hex('w2-5b1 task 5 fixture: record'),
    frozen: { sha256: sha256Hex('w2-5b1 task 5 fixture: frozen'), list: { entries } },
    allowCodeChange: false, codeStamps: [], ...over,
  };
}
/** Task 4's ArmNode for up-a on a w6Box HOME. */
function w5b5NodeOf(home: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return { account: 'up-a', expected: w6Expected(home, 'up-a'), budget: 100_000, limits: W5B5.LIMITS_DEFAULTS, settingsMode: 'restricted', ...over };
}
const w5b5Deps = (run: unknown, node: unknown, answers: unknown[]): Record<string, unknown> =>
  ({ loadArmRun: () => run, armNodeOf: () => node, readArmAnswers: () => answers, now: () => Date.now() });
/** A w6Box HOME (roster, stubs, limits rows, stamp, a claimed --out the command never uses) and, with `store`, a store
 *  made by createStore with W5B5_STORE as its id: the node the subcommand opens. */
function w5b5Home(prefix: string, store = true): W6Box {
  const b = w6Box(prefix);
  if (store) w5b5CreateStore(b.home, { storeId: W5B5_STORE });
  return b;
}

describe('W2-5b1 Task 5: the judge input, W2-D79 and W2-D54', () => {
  it('the input is canonical v1 with kind, question, expected, answer_field and reply, and the stdin is the signed rubric, a blank line and that input', () => {
    const e = w5b5Entry(W6_CMD);
    const reply = `I think it was the lint step.\nANSWER: ${W6_CMD2}`;
    const input = W5B5.judgeInputOf(e, reply, W6_IDX);
    expect(input).toEqual({ v: 1, kind: 'command', question: e.question, expected: W6_CMD, answer_field: W6_CMD2, reply });
    expect(W5B5.JUDGE_INPUT_KEYS).toEqual(['answer_field', 'expected', 'kind', 'question', 'reply', 'v']);
    expect(Object.keys(input).sort()).toEqual([...W5B5.JUDGE_INPUT_KEYS]);
    for (const id of ['v1', 'v1-strict'] as const) {
      expect(W5B5.judgeStdin(id, input), id).toBe(`${w5b5Gate.RUBRICS[id]}\n\n${w5b5Lib.canonicalJson(input)}\n`);
    }
    expect(() => W5B5.judgeStdin('v2', input)).toThrow(TypeError);
  });

  it('answer_field is the ANSWER line as parseAnswerField reads it: the value, UNKNOWN, or null when there is none', () => {
    const e = w5b5Entry(W6_CMD);
    const field = (reply: string): string | null => W5B5.judgeInputOf(e, reply, W6_IDX).answer_field;
    expect(field(`Thinking it over.\nANSWER: \`${W6_CMD2}\``)).toBe(W6_CMD2);
    expect(field('ANSWER: unknown')).toBe('UNKNOWN');
    expect(field('ANSWER: UNKNOWN')).toBe('UNKNOWN');
    expect(field('I do not remember which command it was.')).toBeNull();
    expect(field(`ANSWER: ${W6_CMD}\nANSWER: ${W6_CMD2}`), 'the last ANSWER line').toBe(W6_CMD2);
  });

  it('the reply is redacted, then capped at 16 KiB of UTF-8, never splitting a code point; answer_field is carried beside it, cut at the same cap (D-6470)', () => {
    expect(W5B5.JUDGE_REPLY_MAX_BYTES).toBe(16384);
    const e = w5b5Entry(W6_CMD);
    const han = `${String.fromCharCode(0x4e2d)} `;   // three UTF-8 bytes and a space
    const reply = `${han.repeat(5500)}\nANSWER: ${W6_CMD2}`;
    expect(W5B5.maskValue(reply, W6_IDX), 'CONTROL: the fixture holds nothing to redact').toBe(reply);
    const input = W5B5.judgeInputOf(e, reply, W6_IDX);
    expect(Buffer.byteLength(input.reply)).toBeLessThanOrEqual(16384);
    expect(Buffer.byteLength(input.reply)).toBeGreaterThan(16384 - 4);
    expect(reply.startsWith(input.reply)).toBe(true);
    expect(input.answer_field, 'the ANSWER line past the cut reaches the judge in its own field').toBe(W6_CMD2);
    const smile = `${String.fromCharCode(0xd83d, 0xde00)} `;   // four UTF-8 bytes and a space
    const wide = W5B5.judgeInputOf(e, smile.repeat(4000), W6_IDX).reply;
    expect(Buffer.byteLength(wide)).toBeLessThanOrEqual(16384);
    expect(Buffer.byteLength(wide)).toBeGreaterThan(16384 - 5);
    expect(wide).not.toMatch(W6_LONE_SURROGATE);
    const short = 'A short reply.\nANSWER: UNKNOWN';
    expect(W5B5.judgeInputOf(e, short, W6_IDX).reply, 'CONTROL: a reply under the cap is whole').toBe(short);
    const longField = `npm run ${'x'.repeat(20_000)}`;
    const capped = W5B5.judgeInputOf(e, `ANSWER: ${longField}`, W6_IDX).answer_field!;
    expect(Buffer.byteLength(capped), 'D-6470: a 20,000-byte ANSWER value is cut at the same cap').toBe(16384);
    expect(longField.startsWith(capped)).toBe(true);
  });

  it('W2-D54 order: a secret straddling the 16 KiB edge is redacted whole before the cap, and no head of it survives', () => {
    // Spaced filler, so the secret is a run of its own and its (length, sha256) pair matches it whole.
    const reply = `${'a '.repeat(8187)}${W6_SECRET} tail\nANSWER: ${W6_CMD2}`;
    expect(Buffer.byteLength(reply.slice(0, reply.indexOf(W6_SECRET))), 'the fixture: the secret starts 10 bytes before the cut').toBe(16374);
    const input = W5B5.judgeInputOf(w5b5Entry(W6_CMD), reply, W6_IDX);
    expect(input.reply).not.toContain(W6_SECRET.slice(0, 6));
    expect(input.reply).toContain(t4Lib.REDACTED_MARK);
    // CONTROL: cut the raw reply first and redact afterwards, and the head the cut leaves matches no pair.
    expect(t4Lib.redactField(W5B5.capUtf8Bytes(reply, 16384), W6_IDX)).toContain(W6_SECRET.slice(0, 10));
  });

  it('a key-shaped value in the question, the reply or its ANSWER line reaches the input redacted', () => {
    const key = w6Akia('JUDGEKY');
    const e = { ...w5b5Entry(W6_CMD), question: `Which command ran after the key ${key} was exported?` };
    const input = W5B5.judgeInputOf(e, `It read the key from ${key} first.\nANSWER: ${key}`, W6_IDX);
    expect(w5b5Lib.canonicalJson(input)).not.toContain(key);
    expect(input.question).toContain(t4Lib.REDACTED_MARK);
    expect(input.reply).toContain(t4Lib.REDACTED_MARK);
    expect(input.answer_field).toContain(t4Lib.REDACTED_MARK);
  });

  it('a reply of null is judged as the empty string, with no answer_field', () => {
    expect(W5B5.judgeInputOf(w5b5Entry(W6_CMD), null, W6_IDX)).toMatchObject({ reply: '', answer_field: null });
  });
});

describe('W2-5b1 Task 5: who reaches the judge, and the judge order', () => {
  const arms = W5B5_ARMS;
  const pickOf = (entries: W5b5Entry[], answers: W5b5Answer[]): W5b5Picked =>
    W5B5.judgeItemsOf({ entries, answers, arms, shaMinPrefix: 7 });
  const refusalOf = (fn: () => unknown): unknown => { try { fn(); return null; } catch (e) { return e; } };

  it('a correct answer never reaches the judge; UNKNOWN, a missing ANSWER line and a wrong value do', () => {
    const e1 = w5b5Entry(W6_CMD);
    const e2 = w5b5Entry(W6_CMD2);
    const right = `It was this one.\nANSWER: ${W6_CMD}`;
    expect(w5b5Gate.labelCorrect('command', W6_CMD, W6_CMD, { repoRoots: ['/home/u/tree'], shaMinPrefix: 7 }), 'CONTROL: the gate scores it correct').toBe(true);
    const answers = [
      w5b5Answer(e1.qid, W5B5_ARM0, 'answered', right, true),
      w5b5Answer(e1.qid, W5B5_ARM1, 'answered', `ANSWER: ${W6_CMD2}`, false),
      w5b5Answer(e2.qid, W5B5_ARM0, 'answered', 'ANSWER: UNKNOWN', false),
      w5b5Answer(e2.qid, W5B5_ARM1, 'answered', 'I do not remember the command.', false),
    ];
    const r = pickOf([e1, e2], answers);
    const got = r.items.map((i) => JSON.stringify([i.qid, i.arm, i.reply])).sort();
    const want = [[e1.qid, W5B5_ARM1, `ANSWER: ${W6_CMD2}`], [e2.qid, W5B5_ARM0, 'ANSWER: UNKNOWN'], [e2.qid, W5B5_ARM1, 'I do not remember the command.']]
      .map((x) => JSON.stringify(x)).sort();
    expect(got).toEqual(want);
    expect(r.excluded).toEqual({ correct: 1, run_failed_questions: 0 });
  });

  it('W2-D80: a run-failed question leaves the judge in both arms', () => {
    const e1 = w5b5Entry(W6_CMD);
    const e2 = w5b5Entry(W6_CMD2);
    const r = pickOf([e1, e2], [
      w5b5Answer(e1.qid, W5B5_ARM0, 'answered', `ANSWER: ${W6_ERR}`, false),
      w5b5Answer(e1.qid, W5B5_ARM1, 'run-failed', null, null),
      w5b5Answer(e2.qid, W5B5_ARM0, 'answered', `ANSWER: ${W6_ERR}`, false),
      w5b5Answer(e2.qid, W5B5_ARM1, 'answered', `ANSWER: ${W6_ERR}`, false),
    ]);
    expect(r.items.map((i) => i.qid), 'CONTROL: the other question is judged in both arms').toEqual([e2.qid, e2.qid]);
    expect(r.excluded).toEqual({ correct: 0, run_failed_questions: 1 });
  });

  it('an unsettled pair refuses input-invalid arms-unsettled, never a TypeError', () => {
    const e = w5b5Entry(W6_CMD);
    const done = w5b5Answer(e.qid, W5B5_ARM0, 'answered', `ANSWER: ${W6_ERR}`, false);
    for (const [label, other] of [['rerun', [w5b5Answer(e.qid, W5B5_ARM1, 'rerun', null, null)]],
      ['not-run', [w5b5Answer(e.qid, W5B5_ARM1, 'not-run', null, null)]], ['no record', []]] as Array<[string, W5b5Answer[]]>) {
      const err = refusalOf(() => pickOf([e], [done, ...other]));
      expect(err, label).toBeInstanceOf(DriverRefusal);
      expect(err, label).toMatchObject({ word: 'input-invalid' });
      expect((err as DriverRefusal).detail, label).toMatch(/^arms-unsettled 1 \(first [0-9a-f]{16}\)/);
    }
    expect(refusalOf(() => pickOf([e], [done, w5b5Answer(e.qid, W5B5_ARM1, 'answered', `ANSWER: ${W6_ERR}`, false)])), 'CONTROL: settled').toBeNull();
  });

  it('W2-D80, R14: a run-failed arm settles its question, so the other arm\'s rerun or not-run record is excluded with it and refuses nothing', () => {
    // Task 4 writes both records when either arm is run-failed, and never spawns the other arm's owed attempt again.
    const e1 = w5b5Entry(W6_CMD);
    const e2 = w5b5Entry(W6_CMD2);
    const wrong = (e: W5b5Entry): W5b5Answer[] => [W5B5_ARM0, W5B5_ARM1].map((a) => w5b5Answer(e.qid, a, 'answered', `ANSWER: ${W6_ERR}`, false));
    for (const other of ['rerun', 'not-run']) {
      const r = pickOf([e1, e2], [w5b5Answer(e1.qid, W5B5_ARM0, other, null, null), w5b5Answer(e1.qid, W5B5_ARM1, 'run-failed', null, null), ...wrong(e2)]);
      expect(r.excluded, other).toEqual({ correct: 0, run_failed_questions: 1 });
      expect(r.items.map((i) => i.qid), `${other}: the other question is judged in both arms`).toEqual([e2.qid, e2.qid]);
    }
    const err = refusalOf(() => pickOf([e1], [w5b5Answer(e1.qid, W5B5_ARM1, 'run-failed', null, null)]));
    expect(err, 'CONTROL: a missing record still refuses, a run-failed arm beside it or not').toMatchObject({ word: 'input-invalid' });
  });

  it('an answer record that disagrees with its own reply, names an unknown question or arm, or is recorded twice refuses out-refused', () => {
    const e = w5b5Entry(W6_CMD);
    const wrong = w5b5Answer(e.qid, W5B5_ARM1, 'answered', `ANSWER: ${W6_ERR}`, false);
    const cases: Array<[string, W5b5Answer[], RegExp]> = [
      ['a correct reply flagged wrong', [w5b5Answer(e.qid, W5B5_ARM0, 'answered', `ANSWER: ${W6_CMD}`, false), wrong], /^answer-record-mismatch [0-9a-f]{16}$/],
      ['a wrong reply flagged correct', [w5b5Answer(e.qid, W5B5_ARM0, 'answered', `ANSWER: ${W6_ERR}`, true), wrong], /^answer-record-mismatch [0-9a-f]{16}$/],
      ['an unknown question', [w5b5Answer('0'.repeat(16), W5B5_ARM0, 'answered', 'x', false), wrong], /^answer-record-unknown /],
      ['an unknown arm', [w5b5Answer(e.qid, 'fixture-arm', 'answered', 'x', false), wrong], /^answer-record-unknown /],
      ['a pair recorded twice', [wrong, wrong], /^answer-record-duplicate [0-9a-f]{16}$/],
    ];
    for (const [label, answers, detail] of cases) {
      const err = refusalOf(() => pickOf([e], answers));
      expect(err, label).toBeInstanceOf(DriverRefusal);
      expect(err, label).toMatchObject({ word: 'out-refused' });
      expect((err as DriverRefusal).detail, label).toMatch(detail);
    }
  });

  it('the judge order is the judge-order substream over every qid and arm pair sorted by code unit, with positional ids from j0001', () => {
    const es = [W6_CMD, W6_CMD2, W6_ERR].map((f) => w5b5Entry(f));
    const map = W5B5.judgeMapOf(W5B5_SEED, es, arms);
    const pairs = es.flatMap((e) => arms.map((a): [string, string] => [e.qid, a]));
    expect(map.map((m) => [m.qid, m.arm])).toEqual(w5b5Order(W5B5_SEED, pairs));
    expect(map.map((m) => m.id)).toEqual(['j0001', 'j0002', 'j0003', 'j0004', 'j0005', 'j0006']);
    expect(map.every((m) => Object.keys(m).sort().join(',') === 'arm,id,qid' && W5B5.JUDGE_ID_RE.test(m.id))).toBe(true);
    expect(w5b5Order(W5B5_SEED, pairs, 'handcheck'), 'CONTROL: another label draws another order').not.toEqual(w5b5Order(W5B5_SEED, pairs));
    const text = W5B5.judgeMapText('quiz', 'f'.repeat(64), map);
    expect(JSON.parse(text)).toEqual({ kind: W5B5.JUDGE_MAP_KIND, v: 1, section: 'quiz', frozen_sha256: 'f'.repeat(64), items: map });
    expect(text).toBe(`${w5b5Lib.canonicalJson(JSON.parse(text))}\n`);
  });

  it('the order is the same in any input order, mixes the arms across batches, and moves with the seed', () => {
    const es = Array.from({ length: 10 }, (_, k) => w5b5Entry(`npm run fixture-step-${k} --workspace pkg-a`));
    const a = W5B5.judgeMapOf(W5B5_SEED, es, arms);
    expect(W5B5.judgeMapOf(W5B5_SEED, [...es].reverse(), [...arms].reverse())).toEqual(a);
    expect(new Set(a.slice(0, 10).map((m) => m.arm)).size, 'both arms in the first batch of ten').toBe(2);
    const sorted = [...a].sort((x, y) => (`${x.qid}${W5B5_NUL}${x.arm}` < `${y.qid}${W5B5_NUL}${y.arm}` ? -1 : 1));
    expect(a.map((m) => m.qid + m.arm), 'CONTROL: a real shuffle, not the sorted list').not.toEqual(sorted.map((m) => m.qid + m.arm));
    expect(W5B5.judgeMapOf(sha256Hex('w2-5b1 task 5 fixture: another seed'), es, arms).map((m) => m.qid + m.arm)).not.toEqual(a.map((m) => m.qid + m.arm));
  });

  it('ids widen past 9999 pairs and keep one width', () => {
    const es = Array.from({ length: 5000 }, (_, k) => ({ qid: k.toString(16).padStart(16, '0') }));
    const map = W5B5.judgeMapOf(W5B5_SEED, es, arms);
    expect(map).toHaveLength(10000);
    expect([map[0]!.id, map[9999]!.id]).toEqual(['j00001', 'j10000']);
    expect(map.every((m) => /^j[0-9]{5}$/.test(m.id) && W5B5.JUDGE_ID_RE.test(m.id))).toBe(true);
    expect(W5B5.judgeMapOf(W5B5_SEED, es.slice(0, 4999), arms)[0]!.id, 'CONTROL: 9998 pairs keep four digits').toBe('j0001');
  });
});

describe('W2-5b1 Task 5: the judge spawn, RP1-judge and RP3-judge', () => {
  it.each(['up-a', 'gen-a'])('RP1-judge %s: the judge call goes through W2-4 spawn in judge mode, with the rubric and the canonical input on stdin', async (id) => {
    const b = w6Box(`ccrc-w2-5b1-t5-rp1-${id}-`);
    writeFileSync(join(b.home, STUB_STREAM), W5B5_LABELLED);
    const j = await w5b5Open(b, id);
    const [job] = w5b5Jobs(1);
    const [item] = await j.judge('quiz', [job!]);
    expect(item).toEqual({ id: 'j0001', outcome: 'judged', label: 'fabricated', attempts: [
      { run: 'quiz/judge/j0001-1', code: 0, signal: null, skipped: false, tokens: 45, result: true, label: 'fabricated', error_fields: [] }] });
    const runs = w6Runs(b.home);
    expect(runs, 'one judge spawn').toHaveLength(1);
    const l = runs[0]!;
    expect(l.argv).toEqual(t5Argv('judge', W6_MODEL, b.home));
    expect(l.argv).not.toContain('--allowedTools');
    const keys = withoutDarwinAdded(l.envKeys).filter((k) => !T5_BASH_KEYS.includes(k));
    expect(keys).toEqual(id === 'gen-a' ? [...T5_BASE_KEYS, 'CLAUDE_CODE_OAUTH_TOKEN'].sort() : [...T5_BASE_KEYS].sort());
    for (const k of [...T5_NEVER_KEYS, ...T5_RECALL_KEYS]) expect(l.envKeys, k).not.toContain(k);
    expect(l.env['PATH']).toBe(`${b.out}/poison-bin:${path.dirname(process.execPath)}:/usr/bin:/bin`);
    expect(l.env['CLAUDE_CONFIG_DIR']).toBe(join(b.home, id === 'gen-a' ? '.gen-a' : '.claude'));
    expect(l.stdin).toBe(`${w5b5Gate.RUBRICS.v1}\n\n${w5b5Lib.canonicalJson(job!.input)}\n`);
    const dir = join(b.out, 'quiz', 'judge');
    expect(readFileSync(join(dir, 'j0001-1.jsonl'), 'utf8')).toBe(W5B5_LABELLED);
    expect(JSON.parse(readFileSync(join(dir, 'j0001-1.run.json'), 'utf8'))).toMatchObject({ mode: 'judge', model: W6_MODEL, account: id });
    expect(readFileSync(join(dir, 'j0001.input.json'), 'utf8')).toBe(`${w5b5Lib.canonicalJson(job!.input)}\n`);
    expect(readFileSync(join(b.home, T5_STUB_LOG), 'utf8')).not.toContain(T5_TOKEN);
  }, 60_000);

  it.each([['cx-a', 'kind-codex'], ['ext-n', 'kind-external'], ['ext-a', 'kind-external'], ['gen-o', 'provider-openai']])(
    'RP3-judge %s: refused account-refused before any spawn, and the stub log stays absent', async (id, detail) => {
      const b = w6Box(`ccrc-w2-5b1-t5-rp3-${id}-`);
      const err = await w5b5Open(b, id).then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(DriverRefusal);
      expect(err).toMatchObject({ word: 'account-refused', detail });
      expect(stubLog(b.home), 'no spawn, not even --version').toBeNull();
      expect(existsSync(join(b.out, 'quiz'))).toBe(false);
    }, 60_000);

  it('a judge model that is not an exact Opus id refuses args-invalid before admission and any spawn', async () => {
    for (const model of ['opus', 'claude-opus-latest', 'claude-other-9-1']) {
      const b = w6Box('ccrc-w2-5b1-t5-model-');
      const err = await w5b5Open(b, 'up-a', { model }).then(() => null, (e: unknown) => e);
      expect(err, model).toMatchObject({ word: 'args-invalid', detail: `judge-model ${JSON.stringify(model)} is not an exact Opus model id` });
      expect(stubLog(b.home), model).toBeNull();
    }
    const refused = w6Box('ccrc-w2-5b1-t5-model-refused-');
    const err = await w5b5Open(refused, 'cx-a', { model: 'opus' }).then(() => null, (e: unknown) => e);
    expect(err, 'the model refusal comes first: a refused account with a bad model is args-invalid').toMatchObject({ word: 'args-invalid' });
    expect(stubLog(refused.home)).toBeNull();
  }, 60_000);

  it('the last LABEL line is the label, and a labelled reply is never retried', async () => {
    const b = w6Box('ccrc-w2-5b1-t5-last-');
    writeFileSync(join(b.home, STUB_STREAM), w6Reply('LABEL: fabricated\nOn reflection the one value is hedged.\nLABEL: uncertain'));
    const j = await w5b5Open(b, 'up-a');
    const [item] = await j.judge('quiz', w5b5Jobs(1));
    expect(item).toMatchObject({ outcome: 'judged', label: 'uncertain' });
    expect(item!.attempts).toHaveLength(1);
    expect(w6Runs(b.home)).toHaveLength(1);
  }, 60_000);

  it('W2-D79: a reply malformed twice is judge-failed, after two spawns with identical stdin', async () => {
    const b = w6Box('ccrc-w2-5b1-t5-failed-');
    writeFileSync(join(b.home, STUB_STREAM), W5B5_MALFORMED);
    const j = await w5b5Open(b, 'up-a');
    const [job] = w5b5Jobs(1);
    const [item] = await j.judge('quiz', [job!]);
    expect(item).toMatchObject({ id: 'j0001', outcome: 'judge-failed', label: null, attempts: [
      { run: 'quiz/judge/j0001-1', code: 0, result: true, label: null }, { run: 'quiz/judge/j0001-2', code: 0, result: true, label: null }] });
    expect(W5B5.JUDGE_ATTEMPTS).toBe(2);
    const runs = w6Runs(b.home);
    expect(runs, 'one spawn, then its one retry').toHaveLength(2);
    expect(runs[0]!.stdin).toBe(`${w5b5Gate.RUBRICS.v1}\n\n${w5b5Lib.canonicalJson(job!.input)}\n`);
    expect(runs[1]!.stdin, 'identical input').toBe(runs[0]!.stdin);
  }, 60_000);

  it('CONTROL: malformed once, then labelled on the retry with identical stdin', async () => {
    const b = w6Box('ccrc-w2-5b1-t5-retry-');
    w5b5PlantOnce(b.home, 'up-a');
    writeFileSync(join(b.home, STUB_STREAM), W5B5_LABELLED);
    writeFileSync(join(b.home, W5B5_ONCE), W5B5_MALFORMED);
    const j = await w5b5Open(b, 'up-a');
    expect(existsSync(join(b.home, W5B5_ONCE)), 'CONTROL: the --version call leaves the once-stream for the first print run').toBe(true);
    const [item] = await j.judge('quiz', w5b5Jobs(1));
    expect(item).toMatchObject({ outcome: 'judged', label: 'fabricated', attempts: [
      { run: 'quiz/judge/j0001-1', label: null }, { run: 'quiz/judge/j0001-2', label: 'fabricated' }] });
    const runs = w6Runs(b.home);
    expect(runs).toHaveLength(2);
    expect(runs[1]!.stdin).toBe(runs[0]!.stdin);
    expect(existsSync(join(b.home, W5B5_ONCE)), 'the first print run took it').toBe(false);
  }, 60_000);

  it('a run that exits non-zero, or shows no result event, is a malformed attempt even when it printed a LABEL line', async () => {
    const b = w6Box('ccrc-w2-5b1-t5-runfail-');
    w6PlantPrintExit(b.home, 'up-a');
    writeFileSync(join(b.home, STUB_STREAM), W5B5_LABELLED);
    const j = await w5b5Open(b, 'up-a');
    writeFileSync(join(b.home, W6_PRINT_EXIT), '0');
    const [ok] = await j.judge('quiz', w5b5Jobs(1));
    expect(ok, 'CONTROL: exit 0 is judged on its first attempt').toMatchObject({ outcome: 'judged', label: 'fabricated', attempts: [{ code: 0 }] });
    writeFileSync(join(b.home, W6_PRINT_EXIT), '3');
    const [exited] = await j.judge('pilot', w5b5Jobs(1));
    expect(exited).toMatchObject({ outcome: 'judge-failed', label: null, attempts: [
      { run: 'pilot/judge/j0001-1', code: 3, result: true, label: null }, { run: 'pilot/judge/j0001-2', code: 3, result: true, label: null }] });
    writeFileSync(join(b.home, W6_PRINT_EXIT), '0');
    writeFileSync(join(b.home, STUB_STREAM), w6Reply('LABEL: fabricated', { result: false }));
    const [silent] = await j.judge('quiz', w5b5Jobs(2).slice(1));
    expect(silent).toMatchObject({ id: 'j0002', outcome: 'judge-failed', attempts: [
      { code: 0, result: false, label: null }, { code: 0, result: false, label: null }] });
  }, 60_000);

  it('Q31: every error field a judge run carries is recorded on its attempt, and a clean run records none', async () => {
    const b = w6Box('ccrc-w2-5b1-t5-errors-');
    const head = JSON.stringify({ type: 'result' }).slice(0, -1);   // the result line's opening, `{"type":"result"`
    expect(W5B5_LABELLED.split(head), 'the fixture: one result line').toHaveLength(2);
    const errorEvent = JSON.stringify({ type: 'assistant', error: 'fixture_error_field', message: { id: 'msg-w5b5-error', content: [{ type: 'text', text: 'x' }] } });
    writeFileSync(join(b.home, STUB_STREAM), W5B5_LABELLED.replace(head, `${errorEvent}\n${head}`));
    const j = await w5b5Open(b, 'up-a');
    const [item] = await j.judge('quiz', w5b5Jobs(1));
    expect(item).toMatchObject({ outcome: 'judged', label: 'fabricated', attempts: [{ error_fields: ['fixture_error_field'] }] });
    writeFileSync(join(b.home, STUB_STREAM), W5B5_LABELLED);
    const [clean] = await j.judge('pilot', w5b5Jobs(1));
    expect(clean!.attempts.map((a) => a.error_fields), 'CONTROL: a clean run records none').toEqual([[]]);
  }, 60_000);

  it('no arm token reaches the judge stdin, an input file, a run name or any file name under the section', async () => {
    const b = w6Box('ccrc-w2-5b1-t5-blind-');
    writeFileSync(join(b.home, STUB_STREAM), W5B5_LABELLED);
    const es = [W6_CMD, W6_CMD2].map((f) => w5b5Entry(f));
    const answers = es.flatMap((e) => [W5B5_ARM0, W5B5_ARM1].map((a) => w5b5Answer(e.qid, a, 'answered', `ANSWER: ${W6_ERR}`, false)));
    const picked = W5B5.judgeItemsOf({ entries: es, answers, arms: W5B5_ARMS, shaMinPrefix: 7 });
    const map = W5B5.judgeMapOf(W5B5_SEED, es, W5B5_ARMS);
    const jobs = W5B5.judgeJobsOf({ items: picked.items, map, idx: W6_IDX });
    expect(jobs, 'CONTROL: both arms of both questions are judged').toHaveLength(4);
    const j = await w5b5Open(b, 'up-a');
    await j.judge('quiz', jobs);
    for (const a of W5B5_ARMS) expect(w5b5Gate.RUBRICS.v1, 'CONTROL: the rubric names no arm').not.toContain(a);
    const runs = w6Runs(b.home);
    expect(runs).toHaveLength(4);
    for (const r of runs) for (const a of W5B5_ARMS) expect(r.stdin, a).not.toContain(a);
    const files = w5b5Files(join(b.out, 'quiz'));
    expect(files.length, 'CONTROL: the walk saw every run').toBeGreaterThanOrEqual(13);
    for (const f of files) for (const a of W5B5_ARMS) expect(f, a).not.toContain(a);
    for (const f of files.filter((x) => x.endsWith('.input.json'))) {
      for (const a of W5B5_ARMS) expect(readFileSync(join(b.out, 'quiz', f), 'utf8'), `${f} ${a}`).not.toContain(a);
    }
    const text = W5B5.judgeMapText('quiz', 'f'.repeat(64), map);
    for (const a of W5B5_ARMS) expect(text, 'CONTROL: the map file is where the arms live').toContain(a);
  }, 60_000);

  it('batches of at most ten at most two at once, and the preflight before every batch', async () => {
    const b = w6Box('ccrc-w2-5b1-t5-batches-');
    writeFileSync(join(b.home, STUB_STREAM), W5B5_LABELLED);
    writeFileSync(join(b.home, T5_STUB_SLEEP), '1500');   // D-6480: W2-4's concurrency case margin, so the pair overlaps under load
    const j = await w5b5Open(b, 'up-a');
    const items = await j.judge('quiz', w5b5Jobs(12));
    expect(items.every((i) => i.outcome === 'judged')).toBe(true);
    const log = stubLog(b.home)!;
    // V: a --version preflight (at open, then before each batch); P: a print-mode judge run.
    expect(log.map((e) => (e.argv.includes('-p') ? 'P' : 'V')).join('')).toBe(`VV${'P'.repeat(10)}VPP`);
    const prints = log.filter((e) => e.argv.includes('-p'));
    // D-6480: the depth when a run starts (W2-4's own measure, the most stubs alive at once): the runs whose interval holds
    // that instant, itself included. A count of every run that overlaps a run at any time reads 3 for a run that straddles
    // two others one after the other.
    const depth = (r: T5Log): number => prints.filter((s) => s.start <= r.start && r.start < s.end).length;
    expect(Math.max(...prints.map(depth)), 'two at once, never three').toBe(2);
  }, 120_000);

  it('a stop never consumes the retry: a budget stop after a malformed first attempt, and a resume that judges on the second', async () => {
    const b = w6Box('ccrc-w2-5b1-t5-stop-');
    writeFileSync(join(b.home, STUB_STREAM), W5B5_MALFORMED);
    const jobs = w5b5Jobs(1);
    const first = await w5b5Open(b, 'up-a', { budget: 1 });
    const err = await first.judge('quiz', jobs).then(() => null, (e: unknown) => e);
    expect(err).toMatchObject({ word: 'budget-exhausted' });
    expect(w6Runs(b.home), 'attempt 1 ran and was charged; attempt 2 never spawned').toHaveLength(1);
    expect(existsSync(join(b.out, 'quiz', 'judge', 'j0001-2.run.json'))).toBe(false);
    writeFileSync(join(b.home, STUB_STREAM), W5B5_LABELLED);
    const again = await w5b5Open(b, 'up-a', { budget: 100_000 });
    const [item] = await again.judge('quiz', jobs);
    expect(item).toMatchObject({ outcome: 'judged', label: 'fabricated', attempts: [
      { run: 'quiz/judge/j0001-1', skipped: true, label: null }, { run: 'quiz/judge/j0001-2', skipped: false, label: 'fabricated' }] });
    expect(w6Runs(b.home)).toHaveLength(2);
  }, 60_000);

  it('a resumed judge reuses finished runs with no spawn, and changed input for the same id refuses out-refused', async () => {
    const b = w6Box('ccrc-w2-5b1-t5-resume-');
    writeFileSync(join(b.home, STUB_STREAM), W5B5_LABELLED);
    const j = await w5b5Open(b, 'up-a');
    const jobs = w5b5Jobs(1);
    await j.judge('quiz', jobs);
    const [again] = await j.judge('quiz', jobs);
    expect(again).toMatchObject({ outcome: 'judged', label: 'fabricated', attempts: [{ skipped: true }] });
    expect(w6Runs(b.home)).toHaveLength(1);
    const changed = [{ id: 'j0001', input: { ...jobs[0]!.input, reply: 'ANSWER: npm run changed' } }];
    const err = await j.judge('quiz', changed).then(() => null, (e: unknown) => e);
    expect(err).toMatchObject({ word: 'out-refused', detail: 'judge-input-changed quiz/judge/j0001.input.json' });
    expect(w6Runs(b.home)).toHaveLength(1);
  }, 60_000);
});

describe('W2-5b1 Task 5: the judge subcommand', () => {
  it('judge takes only its form\'s flags, and --section is pilot or quiz', () => {
    const home = mkTmp('ccrc-w2-5b1-t5-grammar-');
    const out = join(home, 'judge-out');
    const said = (argv: string[]): [unknown, string] => { const r = runDriver(home, argv); return [r.code, r.stderr]; };
    expect(said(['judge', '--section', 'quiz', '--n-usage', '5'])).toEqual([2, refusalLine('args-invalid', '--n-usage is not a judge --section quiz flag')]);
    expect(said(['judge', '--section', 'pilot', '--out', out, '--allow-code-change'])).toEqual([2, refusalLine('args-invalid', '--allow-code-change is not a judge --section pilot flag')]);
    expect(said(['judge', '--section', 'ab', '--out', out])).toEqual([2, refusalLine('args-invalid', 'judge wants --section pilot or --section quiz, not "ab"')]);
    expect(said(['judge', '--out', out])).toEqual([2, refusalLine('args-invalid', 'judge wants --section pilot or --section quiz, not null')]);
    expect(existsSync(out)).toBe(false);
  });

  it('the record is loaded first: a code-changed refusal leaves no --out, opens no store and spawns nothing', async () => {
    const b = w5b5Home('ccrc-w2-5b1-t5-first-', false);
    const out = join(b.home, 'judge-out');
    let nodeAsked = false;
    const deps = {
      loadArmRun: () => W5B5.refuse('code-changed', 'changed deploy/history-gate.mjs'),
      armNodeOf: () => { nodeAsked = true; return w5b5NodeOf(b.home); },
      readArmAnswers: () => [],
      now: () => Date.now(),
    };
    const r = await w5b5InProcess(() => W5B5.judgeCommand(w5b5Flags(out, 'quiz'), W5B5_ENV(b.home), deps));
    expect(r.refusal).toEqual({ word: 'code-changed', detail: 'changed deploy/history-gate.mjs' });
    expect(nodeAsked).toBe(false);
    expect(existsSync(out)).toBe(false);
    expect(stubLog(b.home)).toBeNull();
    // CONTROL: past the loader, this HOME (which has no store) refuses at the store open, before --out.
    const c = await w5b5InProcess(() => W5B5.judgeCommand(w5b5Flags(out, 'quiz'), W5B5_ENV(b.home),
      w5b5Deps(w5b5Run([w5b5Entry(W6_CMD)]), w5b5NodeOf(b.home), [])));
    expect(c.refusal?.word).toBe('store-unreadable');
    expect(existsSync(out)).toBe(false);
  }, 60_000);

  // W2-D24 (R23): judge re-checks the code it runs under before any other input, under W2-5a's title, through Task 4's real
  // loader over Task 4's fixtures: the record is signed with a code sha this tree does not have, and the input read next
  // is unreadable (pilot) or the store absent (quiz).
  const W5B5_MOVED = (): Record<string, string> => ({ ...w5b4Shas(), 'deploy/measure-history.py': w5b4Hex('moved') });
  it.each([
    ['judge --section pilot', (home: string): { out: string; argv: string[] } => {
      const fx = w5b4Pilot(home, { shas: W5B5_MOVED() });
      return { out: fx.out, argv: ['judge', ...fx.argv.slice(1).map((a) => (a === fx.fz.path ? join(home, 'no-such-frozen.json') : a))] };
    }],
    ['judge --section quiz', (home: string): { out: string; argv: string[] } => {
      const fx = w5b4Quiz(home, { shas: W5B5_MOVED() });
      return { out: fx.out, argv: ['judge', ...fx.argv().slice(1)] };
    }],
  ] as Array<[string, (home: string) => { out: string; argv: string[] }]>)('code-changed before any other input is read, re-checks the code it runs under: %s', async (_sub, setup) => {
    const home = w5b4Home(null);   // no store: a re-check after the store open would answer store-unreadable
    const { out, argv } = setup(home);
    const flags = (replay.parseArgs(argv) as { flags: Record<string, unknown> }).flags;
    const r = await w5b5InProcess(() => W5B5.judgeCommand(flags, W5B5_ENV(home)));
    expect(r.refusal).toEqual({ word: 'code-changed', detail: 'changed deploy/measure-history.py' });
    expect(existsSync(out), 'no --out').toBe(false);
    expect(stubLog(home), 'no spawn').toBeNull();
  }, 60_000);

  it.each([
    ['account-refused', (h: string): Record<string, unknown> => ({ account: 'cx-a', expected: w6Expected(h, 'cx-a') })],
    ['limits-threshold', (h: string): Record<string, unknown> => {
      const nowS = Math.floor(Date.now() / 1000);
      writeFileSync(join(h, '.cc-limits', 'up-a.json'), JSON.stringify({ five: 90, seven: 20, ts: nowS - 60, fiveResetAt: nowS + 3600, sevenResetAt: nowS + 86400 }));
      return {};
    }],
    ['tree-moved', (h: string): Record<string, unknown> => ({ expected: { ...w6Expected(h, 'up-a'), release_stamp: 'v0.0.1' } })],
  ] as Array<[string, (h: string) => Record<string, unknown>]>)('%s: a refusal that needs no store and no spawn answers before --out', async (word, over) => {
    const b = w5b5Home(`ccrc-w2-5b1-t5-pre-${word}-`);
    const out = join(b.home, 'judge-out');
    const node = w5b5NodeOf(b.home, over(b.home));
    const r = await w5b5InProcess(() => W5B5.judgeCommand(w5b5Flags(out, 'quiz'), W5B5_ENV(b.home), w5b5Deps(w5b5Run([w5b5Entry(W6_CMD)]), node, [])));
    expect(r.refusal?.word).toBe(word);
    expect(existsSync(out), 'no --out').toBe(false);
    expect(stubLog(b.home), 'no spawn, not even --version').toBeNull();
  }, 60_000);

  it('an --out holding \':\', a judge model that is not an exact Opus id, or a budget or limits out of range refuses before --out, in either section (D-5813, D-6309)', async () => {
    const b = w5b5Home('ccrc-w2-5b1-t5-pre-inputs-');
    const run = w5b5Run([w5b5Entry(W6_CMD)]);
    const colon = join(b.home, 'judge:out');
    const c = await w5b5InProcess(() => W5B5.judgeCommand(w5b5Flags(colon, 'quiz'), W5B5_ENV(b.home), w5b5Deps(run, w5b5NodeOf(b.home), [])));
    expect(c.refusal).toEqual({ word: 'args-invalid', detail: "out contains ':'" });
    expect(existsSync(colon), 'no --out').toBe(false);
    const out = join(b.home, 'judge-out');
    const notOpus = w5b5Run([w5b5Entry(W6_CMD)], { record: { ...(run['record'] as Record<string, unknown>), judge_model: 'claude-other-9-1' } });
    const m = await w5b5InProcess(() => W5B5.judgeCommand(w5b5Flags(out, 'quiz'), W5B5_ENV(b.home), w5b5Deps(notOpus, w5b5NodeOf(b.home), [])));
    expect(m.refusal, 'the judge model').toMatchObject({ word: 'args-invalid' });
    expect(existsSync(out), 'the judge model: no --out').toBe(false);
    for (const [section, field] of [['pilot', 'pilot_budget'], ['quiz', 'spend_budget']] as const) {
      const node = w5b5NodeOf(b.home, { budget: 0, limits: { ...W5B5.LIMITS_DEFAULTS, threshold_pct: 101 } });
      const r = await w5b5InProcess(() => W5B5.judgeCommand(w5b5Flags(out, section), W5B5_ENV(b.home), w5b5Deps(run, node, [])));
      expect(r.refusal, section).toEqual({ word: 'record-invalid', detail: `${field} out-of-range; limits.threshold_pct out-of-range` });
      expect(existsSync(out), `${section}: no --out`).toBe(false);
    }
    expect(stubLog(b.home), 'no spawn, not even --version').toBeNull();
  }, 60_000);

  // Q23 through Task 4's real loader and node reader on Task 4's quiz fixture (its arm-stub HOME, so darwin skips it as
  // Task 4's stub cases are skipped); the answers are injected, every one correct, so the judge opens, spawns only its
  // --version preflight and judges nothing. The clock is deps.now: W5B4_T0's window starts after the real one.
  it.skipIf(process.platform === 'darwin')('quiz: --allow-code-change after window start stamps judged.json; without it, code-changed before --out, and before window start args-invalid (Q23, W2-D24)', async () => {
    const home = w5b4Home();
    const fx = w5b4Quiz(home, { shas: W5B5_MOVED() });
    const right = fx.mine.flatMap((q) => W5B5_ARMS.map((a) => w5b5Answer(q.qid as string, a, 'answered', `ANSWER: ${q.fact as string}`, true)));
    const deps = (nowMs: number): Record<string, unknown> =>
      ({ loadArmRun: replay.loadArmRun, armNodeOf: replay.armNodeOf, readArmAnswers: () => right, now: () => nowMs });
    const flagsOf = (extra: string[]): Record<string, unknown> =>
      (replay.parseArgs(['judge', ...fx.argv(fx.f, extra).slice(1)]) as { flags: Record<string, unknown> }).flags;
    const after = W5B4_T0 + 2 * W5B4_DAY;
    const plain = await w5b5InProcess(() => W5B5.judgeCommand(flagsOf([]), W5B5_ENV(home), deps(after)));
    expect(plain.refusal?.word, 'without the flag').toBe('code-changed');
    const early = await w5b5InProcess(() => W5B5.judgeCommand(flagsOf(['--allow-code-change']), W5B5_ENV(home), deps(W5B4_T0)));
    expect(early.refusal?.word, 'before window start the flag is refused (Task 1\'s rule)').toBe('args-invalid');
    expect(existsSync(fx.out), 'neither made --out').toBe(false);
    expect(stubLog(home), 'neither spawned').toBeNull();
    const r = await w5b5InProcess(() => W5B5.judgeCommand(flagsOf(['--allow-code-change']), W5B5_ENV(home), deps(after)));
    expect(r.refusal).toBeNull();
    expect(r.code).toBe(0);
    const judged = JSON.parse(readFileSync(join(fx.out, 'quiz', 'judged.json'), 'utf8')) as Record<string, any>;
    expect(judged.stamps, 'Q23: the measured change is a stamp on the output').toEqual(['code-changed']);
    expect(judged.items, 'every answer correct: nothing judged').toEqual([]);
    expect(judged.counts.excluded_correct).toBe(2 * fx.mine.length);
  }, 120_000);

  // Q5 on the judge's spawn gate, through Task 4's real loader and node reader on Task 4's quiz fixture (darwin skips it, as
  // above): spend_budget 100 over this node's 3 of 5 questions is a share of 60. One answer is non-correct, so one judge
  // run spawns and is charged T5_TOKENS (65: the arm stub's default STUB_STREAM, whose reply carries no LABEL line, so the
  // attempt is malformed); the re-run's preflight gate then refuses. Part 2's whole spend_budget, 100, would let it spawn.
  it.skipIf(process.platform === 'darwin')('quiz: the judge spends under this node\'s spend share, and budget-exhausted stops its re-run (Q5, W2-D55)', async () => {
    const home = w5b4Home();
    const fx = w5b4Quiz(home, { spendBudget: 100 });
    const wrong = fx.mine[0]!;
    const answers = [
      w5b5Answer(wrong.qid as string, W5B5_ARM0, 'answered', 'ANSWER: UNKNOWN', false),
      w5b5Answer(wrong.qid as string, W5B5_ARM1, 'answered', `ANSWER: ${wrong.fact as string}`, true),
      ...fx.mine.slice(1).flatMap((q) => W5B5_ARMS.map((a) => w5b5Answer(q.qid as string, a, 'answered', `ANSWER: ${q.fact as string}`, true))),
    ];
    const flagsOf = (): Record<string, unknown> => (replay.parseArgs(['judge', ...fx.argv().slice(1)]) as { flags: Record<string, unknown> }).flags;
    const r = await w5b5InProcess(() => W5B5.judgeCommand(flagsOf(), W5B5_ENV(home),
      { loadArmRun: replay.loadArmRun, armNodeOf: replay.armNodeOf, readArmAnswers: () => answers, now: () => W5B4_T0 + 2 * W5B4_DAY }));
    expect(r.refusal).toEqual({ word: 'budget-exhausted', detail: 'spent 65 of 60' });
    expect(w5b4Runs(home), 'attempt 1 ran and was charged; the re-run never spawned').toHaveLength(1);
    expect(existsSync(join(fx.out, 'quiz', 'judged.json')), 'a stop writes no judged.json').toBe(false);
  }, 120_000);

  it('end to end on the stub: judged.json, the map file and the sha line, each node judging only its own non-correct answers', async () => {
    const b = w5b5Home('ccrc-w2-5b1-t5-e2e-');
    writeFileSync(join(b.home, STUB_STREAM), W5B5_LABELLED);
    const [e1, e2, e3] = [W6_CMD, W6_CMD2, 'npm run fixture-test --workspace pkg-c'].map((f) => w5b5Entry(f)) as [W5b5Entry, W5b5Entry, W5b5Entry];
    const far = w5b5Entry('npm run fixture-docs --workspace pkg-d', W5B5_OTHER_STORE);
    const answers = [
      w5b5Answer(e1.qid, W5B5_ARM0, 'answered', `ANSWER: ${e1.fact}`, true),
      w5b5Answer(e1.qid, W5B5_ARM1, 'answered', `ANSWER: ${W6_ERR}`, false),
      w5b5Answer(e2.qid, W5B5_ARM0, 'answered', 'ANSWER: UNKNOWN', false),
      w5b5Answer(e2.qid, W5B5_ARM1, 'run-failed', null, null),
      w5b5Answer(e3.qid, W5B5_ARM0, 'answered', 'I would guess a lint command.', false),
      w5b5Answer(e3.qid, W5B5_ARM1, 'answered', `ANSWER: ${e3.fact}`, true),
    ];
    const out = join(b.home, 'judge-out');
    const r = await w5b5InProcess(() => W5B5.judgeCommand(w5b5Flags(out, 'quiz'), W5B5_ENV(b.home),
      w5b5Deps(w5b5Run([e1, e2, e3, far]), w5b5NodeOf(b.home), answers)));
    expect(r.refusal).toBeNull();
    expect(r.code).toBe(0);
    const judgedText = readFileSync(join(out, 'quiz', 'judged.json'), 'utf8');
    expect(r.stderr, 'only the sha line, of the bytes on disk (D-5983)').toBe(`sha256 ${sha256Hex(judgedText)}\n`);
    const mapText = readFileSync(join(out, 'quiz', 'judge.map.json'), 'utf8');
    const map = JSON.parse(mapText) as { items: W5b5MapRow[] };
    expect(map.items, 'every pair of the frozen list, the other node\'s included').toEqual(W5B5.judgeMapOf(W5B5_SEED, [e1, e2, e3, far], W5B5_ARMS));
    expect(map.items).toHaveLength(8);
    const idOf = (q: string, a: string): string => map.items.find((m) => m.qid === q && m.arm === a)!.id;
    const judged = JSON.parse(judgedText) as Record<string, any>;
    expect(judged.items.map((i: W5b5Item) => i.id)).toEqual([idOf(e1.qid, W5B5_ARM1), idOf(e3.qid, W5B5_ARM0)].sort());
    expect(judged).toMatchObject({
      kind: W5B5.JUDGED_KIND, v: 1, section: 'quiz', store_id: W5B5_STORE, judge_model: W6_MODEL, rubric_id: 'v1',
      rubric_sha256: w5b5Gate.RUBRIC_SHA256.v1, settings_mode: 'restricted', reply_max_bytes: 16384, map_sha256: sha256Hex(mapText),
      counts: { judged: 2, judge_failed: 0, uncertain: 0, fabricated: 2, excluded_correct: 2, excluded_run_failed_questions: 1 },
      budget: 100_000, stamps: [],
    });
    expect(judged.spend, 'two judge runs charged, 45 each').toBe(90);
    for (const a of W5B5_ARMS) {
      expect(judgedText, `judged.json names ids only (${a})`).not.toContain(a);
      expect(mapText, 'CONTROL: the map names both arms').toContain(a);
    }
    const runs = w6Runs(b.home);
    expect(runs).toHaveLength(2);
    for (const run of runs) for (const a of W5B5_ARMS) expect(run.stdin, a).not.toContain(a);
    expect(runs.map((run) => run.stdin.includes(e1.question) || run.stdin.includes(e3.question))).toEqual([true, true]);
  }, 120_000);

  it('a judge map that changed under --out refuses out-refused before any spawn; the same inputs resume', async () => {
    const b = w5b5Home('ccrc-w2-5b1-t5-map-');
    writeFileSync(join(b.home, STUB_STREAM), W5B5_LABELLED);
    const e1 = w5b5Entry(W6_CMD);
    const e2 = w5b5Entry(W6_CMD2);
    const wrong = (e: W5b5Entry): W5b5Answer[] => [W5B5_ARM0, W5B5_ARM1].map((a) => w5b5Answer(e.qid, a, 'answered', `ANSWER: ${W6_ERR}`, false));
    const out = join(b.home, 'judge-out');
    const call = (entries: W5b5Entry[], answers: W5b5Answer[]) => w5b5InProcess(() =>
      W5B5.judgeCommand(w5b5Flags(out, 'quiz'), W5B5_ENV(b.home), w5b5Deps(w5b5Run(entries), w5b5NodeOf(b.home), answers)));
    expect((await call([e1], wrong(e1))).code).toBe(0);
    expect(w6Runs(b.home)).toHaveLength(2);
    const same = await call([e1], wrong(e1));
    expect(same.code, 'CONTROL: the same inputs resume').toBe(0);
    expect(w6Runs(b.home), 'CONTROL: and spawn nothing').toHaveLength(2);
    const moved = await call([e1, e2], [...wrong(e1), ...wrong(e2)]);
    expect(moved.refusal).toEqual({ word: 'out-refused', detail: 'judge-map-changed quiz/judge.map.json' });
    expect(w6Runs(b.home)).toHaveLength(2);
  }, 120_000);

  it('JUDGE_OUTCOMES are driver-local report words, disjoint from DRIVER_REASONS and GATE_REASONS', () => {
    expect(W5B5.JUDGE_OUTCOMES).toEqual(['judged', 'judge-failed']);
    expect(Object.isFrozen(W5B5.JUDGE_OUTCOMES)).toBe(true);
    for (const w of W5B5.JUDGE_OUTCOMES) {
      expect(W5B5.DRIVER_REASONS, w).not.toContain(w);
      expect(w5b5Gate.GATE_REASONS as readonly string[], w).not.toContain(w);
    }
    expect([...W5B5.HANDLERS.keys()].slice(-2), 'judge is registered right after arms').toEqual(['arms', 'judge']);
  });
});
```

The two spend literals, RP1-judge's `tokens: 45` and the end-to-end case's `spend: 90` (two runs), are `w6Reply`'s usage, `W6_USAGE`: input 40, cache 0 and 0, output 5. W2-4's reader charges the result event's usage, and Task 1's C6 charge (Q7: the larger of the result usage and the sum of every assistant message's usage, subagents included) gives the same 45 for this stream, whose one assistant message carries the same usage. A measured figure other than 45 per run is Task 1's charge rule speaking: re-predict both literals from `spendTokens(readStreamJson(W5B5_LABELLED))`, record the change in this plan, and never edit the reader here.

- [ ] **Step 3: Run them and see them fail as predicted.** In the foreground, with a timeout of at least 600000 ms:

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-5b1 Task 5'
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'three box-mode spawns, one per taught spelling'
```

Predicted, before any driver change:
- Every `W2-5b1 Task 5` case fails: 43 failed, 0 passed (6 input cases, 8 who-and-order cases, 16 spawn cases counting RP1-judge's 2 and RP3-judge's 4, and 13 subcommand cases counting the before-`--out` set's 3, the before-`--out` inputs case, the two W2-D24 rows, the `--allow-code-change` case and the spend-share case); on darwin 41 failed and 2 skipped, the `--allow-code-change` and spend-share cases, which run on Task 4's arm-stub HOME. Each failure is `TypeError: W5B5.<name> is not a function` (`judgeInputOf`, `judgeStdin`, `capUtf8Bytes`, `judgeMapOf`, `judgeItemsOf`, `judgeJobsOf`, `openJudge` through `w5b5Open`, `judgeCommand` through `w5b5InProcess`, which rethrows a non-refusal), or `expected undefined to …` (`JUDGE_REPLY_MAX_BYTES`, `JUDGE_OUTCOMES`), or, for the grammar case, the two W2-D24 rows, the `--allow-code-change` case and the spend-share case (each of the last four parses a `judge` argv first), the unregistered subcommand's own `args-invalid` line (`unknown subcommand "judge"`) where the form's refusal, `code-changed` or `budget-exhausted` was expected. A case that expects a refusal (`input-invalid`, `out-refused`, `account-refused`) fails on the `TypeError`'s class, never by passing.
- The W2-4 Task 9 case fails with the diff `+ "judge"` at the end of the `HANDLERS` keys.
- No stub runs: no case reaches a spawn (each fails at its first call into an absent export).

A case that fails another way is the fixture's to fix before any code is written: in particular `w5b5PlantOnce`'s `toHaveLength(2)` (the stub's stdout line moved) and `w5b5Home`'s `createStore`.

- [ ] **Step 4: Write the code.** In `deploy/history-replay.mjs`:

(a) Merge into Task 1's `./history-gate.mjs` statement whichever of `RUBRICS`, `RUBRIC_IDS`, `labelCorrect`, `parseAnswerField` and `parseLabelLine` Step 1 found missing, and into lib's statement `RECALL_ARMS` if missing, keeping one statement per module and the names in code-unit order. Add no import line.

(b) Replace `pinWriterInput`'s definition, which reads exactly

```js
function pinWriterInput(out, rel, text) {
  const read = readPlain(path.join(out, rel), OUT_JSON_CAP);
  if (read.state === 'absent') { writePlain(out, rel, text); return; }
  if (read.state === 'bad') refuse('out-refused', `${rel} ${badWord(read)}`);
  if (read.bytes.toString('utf8') !== text) refuse('out-refused', `writer-input-changed ${rel}`);
}
```

with

```js
function pinWriterInput(out, rel, text) {
  pinOutBytes(out, rel, text, 'writer-input');
}

/** Pin bytes under --out (W2-5a's writer input, W2-5b1's judge input and judge map): written when absent, compared when
 *  present. Different bytes refuse `out-refused` `<what>-changed <rel>` (a resume never builds on a run made from other
 *  input, nor reads an id as another pair); a path that is not a regular file refuses as every read under --out does
 *  (D-5986). One function, so the three pins are one spelling.
 *  @param {string} out  @param {string} rel  @param {string} text  @param {string} what */
function pinOutBytes(out, rel, text, what) {
  const read = readPlain(path.join(out, rel), OUT_JSON_CAP);
  if (read.state === 'absent') { writePlain(out, rel, text); return; }
  if (read.state === 'bad') refuse('out-refused', `${rel} ${badWord(read)}`);
  if (read.bytes.toString('utf8') !== text) refuse('out-refused', `${what}-changed ${rel}`);
}
```

The doc comment above `pinWriterInput` stays as it is.

(c) Replace `refuseWriterModel`'s definition, which reads exactly

```js
function refuseWriterModel(model) {
  if (typeof model !== 'string' || !EXACT_MODEL_ID_RE.test(model) || !OPUS_MODEL_RE.test(model)) {
    refuse('args-invalid', `writer-model ${JSON.stringify(model)} is not an exact Opus model id`);
  }
}
```

with

```js
function refuseWriterModel(model) {
  refuseOpusModel('writer-model', model);
}

/** W2-D72, W2-D79, W2-D25: the writer and the judge are each an exact Opus id, never an alias (the gate's
 *  EXACT_MODEL_ID_RE and OPUS_MODEL_RE), refused `args-invalid` under the flag that names the role, before admission and
 *  any spawn. One function, so the writer's check and the judge's are one spelling.
 *  @param {string} flag  @param {unknown} model */
function refuseOpusModel(flag, model) {
  if (typeof model !== 'string' || !EXACT_MODEL_ID_RE.test(model) || !OPUS_MODEL_RE.test(model)) {
    refuse('args-invalid', `${flag} ${JSON.stringify(model)} is not an exact Opus model id`);
  }
}
```

(d) In `SUBCOMMAND_FLAGS`, directly after Task 4's two `arms` forms, add:

```js
  // W2-5b1 Task 5 (Q2, Q23): the judge reads exactly what arms reads (Task 4's loadArmRun), and no flag of its own.
  'judge --section pilot': { required: ['section', 'out', ...DRAFT_INPUT, 'frozen', 'frozen-sha256'], optional: [...PRED_INPUT] },
  'judge --section quiz': { required: ['section', 'out', ...DRAFT_INPUT, 'part1', 'part1-sha256', 'frozen', 'frozen-sha256'], optional: [...PRED_INPUT, 'allow-code-change'] },
```

(e) Directly after Task 4's section (after its `HANDLERS.set('arms', …);` line), above the comment `// The entry guard stays the LAST block of this file`, insert:

```js
// ── W2-5b1 Task 5: the judge (W2-D79, W2-D54, W2-D80, W2-D18; Q18, Q2) ───────────────────────────────────────────
// One judge-mode spawn (`--tools ""`) per non-correct (qid, arm) of this node, through W2-4's contract and nothing else:
// launchRun reached through runBatch, under batchGate, on a claimed --out, after W2-D56's preflight before every batch
// (RP1-judge, RP3-judge). Its input is canonical {v: 1, kind, question, expected, answer_field, reply}, every string masked
// as a VALUE before anything serialises it (W2-D54, D-6308), the reply then cut to JUDGE_REPLY_MAX_BYTES of UTF-8. No arm
// token reaches an input or a file name: an item is named by its positional id in the 'judge-order' shuffle over every
// (qid, arm) pair of the section's frozen list, sorted by (qid, arm) by code unit (W2-D18, W2-D79, Q18), the same map on
// every node, and the id-to-(qid, arm) map is its own file, <section>/judge.map.json. A correct answer (labelCorrect over
// the reply's ANSWER field, re-derived here and held to the arm's record) never reaches the judge, nor does either arm of
// a run-failed question (W2-D80). A reply with no LABEL line, or a run that failed (a non-zero exit, a signal, no result
// event: D-6305's rule for the writer), is a malformed attempt, retried once with identical input in a later batch, then
// judge-failed (W2-D79, W2-D81). A stop throws before its run is recorded, so it never consumes the retry: a resume runs
// that attempt again under the same name (W2-D80's rule; D-5984). This file never spells an arm word: the arms are
// RECALL_ARMS' values, passed in (W2-D42).

/** W2-D79: the most UTF-8 bytes of an arm's redacted reply the judge's input carries (16 KiB). */
export const JUDGE_REPLY_MAX_BYTES = 16 * 1024;
/** W2-D79's canonical judge input, its keys in canonicalJson's order. */
export const JUDGE_INPUT_KEYS = Object.freeze(['answer_field', 'expected', 'kind', 'question', 'reply', 'v']);
/** W2-D79: a malformed reply is retried once with identical input, so an item is spawned at most twice. */
export const JUDGE_ATTEMPTS = 2;
/** A judged item's outcome (W2-D79, W2-D81): driver-local report words, never refusals and never the gate's, pinned
 *  disjoint from DRIVER_REASONS and GATE_REASONS as W2-5a pinned its drop lists. */
export const JUDGE_OUTCOMES = Object.freeze(['judged', 'judge-failed']);
const JUDGE_ID_MIN_DIGITS = 4;
/** Q18: a positional judge id, `j` and at least JUDGE_ID_MIN_DIGITS digits, one width in a map. */
export const JUDGE_ID_RE = new RegExp(`^j[0-9]{${JUDGE_ID_MIN_DIGITS},}$`);
/** Under --out: a section's judge runs and pinned inputs (<section>/judge/<id>-<attempt>, <section>/judge/<id>.input.json),
 *  its map (<section>/judge.map.json) and its output (<section>/judged.json). */
export const JUDGE_DIR = 'judge';
export const JUDGE_MAP_FILE = 'judge.map.json';
export const JUDGED_FILE = 'judged.json';
export const JUDGE_MAP_KIND = 'ccrc-history-w2-judge-map';
export const JUDGED_KIND = 'ccrc-history-w2-judged';

/** @typedef {{ run: string, code: number|null, signal: string|null, skipped: boolean, tokens: number, result: boolean,
 *    label: 'uncertain'|'fabricated'|null, error_fields: string[] }} JudgeAttempt */
/** @typedef {{ id: string, outcome: 'judged'|'judge-failed', label: 'uncertain'|'fabricated'|null,
 *    attempts: JudgeAttempt[] }} JudgedItem */
/** @typedef {{ v: 1, kind: string, question: string, expected: string, answer_field: string|null, reply: string }} JudgeInput */

/** The longest prefix of `text`, in whole code points, whose UTF-8 is at most `maxBytes`: a surrogate pair is never split.
 *  Pure.
 *  @param {string} text  @param {number} maxBytes  @returns {string} */
export function capUtf8Bytes(text, maxBytes) {
  if (typeof text !== 'string') throw new TypeError('capUtf8Bytes: text is a string');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new TypeError('capUtf8Bytes: maxBytes is a non-negative integer');
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  let bytes = 0;
  let end = 0;
  for (const ch of text) {
    const n = Buffer.byteLength(ch, 'utf8');
    if (bytes + n > maxBytes) break;
    bytes += n;
    end += ch.length;
  }
  return text.slice(0, end);
}

/** The ANSWER field as the judge is shown it (the gate's RUBRIC_HEAD: "null when it gave none"): a value as parsed, the
 *  protocol's own `UNKNOWN` for an unknown, null for no ANSWER line. */
const answerFieldOf = (a) => (a.state === 'value' ? a.value : a.state === 'unknown' ? 'UNKNOWN' : null);

/** The (qid, arm) key's separator: a NUL, built at runtime, so this file holds no escape an agent's write could decode
 *  into a raw byte (a qid is 16 hex digits, so no qid holds it). */
const JUDGE_PAIR_SEP = String.fromCharCode(0);
/** The one (qid, arm) key every judge list sorts and looks up by: the qid, JUDGE_PAIR_SEP, the arm, so code-unit order
 *  over keys is (qid, arm) order. */
const judgePairKey = (qid, arm) => `${qid}${JUDGE_PAIR_SEP}${arm}`;

/** The judge's input for one answer (W2-D79), every string masked as a value (W2-D54, D-6308) and only then the reply cut
 *  to JUDGE_REPLY_MAX_BYTES; answer_field is read from the RAW reply (the field labelCorrect scored), masked whole, then cut
 *  at the same cap, so the judge's stdin is bounded (D-6470). Pure.
 *  @param {{ kind: string, question: string, fact: string }} entry  @param {string|null} reply
 *  @param {import('../ccd/history/lib.mjs').PairIndex} idx  @returns {JudgeInput} */
export function judgeInputOf(entry, reply, idx) {
  if (!FACT_KINDS.includes(entry?.kind)) throw new TypeError(`judgeInputOf: kind ${JSON.stringify(entry?.kind)} is not one of ${FACT_KINDS.join(', ')}`);
  if (reply !== null && typeof reply !== 'string') throw new TypeError('judgeInputOf: reply is a string or null');
  const text = reply ?? '';
  const field = answerFieldOf(parseAnswerField(text));
  return {
    v: 1, kind: entry.kind,
    question: /** @type {string} */ (maskValue(entry.question, idx)),
    expected: /** @type {string} */ (maskValue(entry.fact, idx)),
    answer_field: field === null ? null : capUtf8Bytes(/** @type {string} */ (maskValue(field, idx)), JUDGE_REPLY_MAX_BYTES),   // D-6470
    reply: capUtf8Bytes(/** @type {string} */ (maskValue(text, idx)), JUDGE_REPLY_MAX_BYTES),
  };
}

/** The judge's stdin: the signed rubric, a blank line, the canonical input, one newline (the writer's shape). Pure.
 *  @param {string} rubricId  @param {JudgeInput} input  @returns {string} */
export function judgeStdin(rubricId, input) {
  if (!RUBRIC_IDS.includes(rubricId)) throw new TypeError(`judgeStdin: rubric ${JSON.stringify(rubricId)} is not one of ${RUBRIC_IDS.join(', ')}`);
  return `${RUBRICS[rubricId]}\n\n${canonicalJson(input)}\n`;
}

/** Q18, W2-D79, W2-D18: the judge map, every (qid, arm) pair of the section's frozen list sorted by (qid, arm) by code unit
 *  and drawn into order on the record seed's 'judge-order' substream (W2-5a's seededOrder), each named by its position,
 *  `j` and the 1-based position at one width (at least JUDGE_ID_MIN_DIGITS). The same list and seed give the same map on
 *  every node, so an id names one pair across nodes. Pure.
 *  @param {string} seedHex  @param {ReadonlyArray<{ qid: string }>} entries  @param {readonly string[]} arms
 *  @returns {Array<{ id: string, qid: string, arm: string }>} */
export function judgeMapOf(seedHex, entries, arms) {
  const pairs = [];
  for (const e of entries) for (const arm of arms) pairs.push({ qid: e.qid, arm });
  const order = seededOrder(substream(seedHex, 'judge-order'), pairs, (p) => judgePairKey(p.qid, p.arm));
  const width = Math.max(JUDGE_ID_MIN_DIGITS, String(order.length).length);
  return order.map((p, k) => ({ id: `j${String(k + 1).padStart(width, '0')}`, qid: p.qid, arm: p.arm }));
}

/** The map file's exact text: canonicalJson of {kind, v, section, frozen_sha256, items} and one newline. Pure. */
export function judgeMapText(section, frozenSha256, map) {
  const items = map.map(({ id, qid, arm }) => ({ id, qid, arm }));
  return `${canonicalJson({ kind: JUDGE_MAP_KIND, v: 1, section, frozen_sha256: frozenSha256, items })}\n`;
}

/** Who reaches the judge (W2-D79, W2-D80), over this node's frozen entries and the arm answers its --out holds. Every
 *  answer record must name one of these qids and an arm, once (else `out-refused`); every question must be settled as
 *  Task 4 settles it (R14): every arm recorded, and either some arm run-failed or every arm answered (else `input-invalid`
 *  arms-unsettled, one per unsettled pair: the arm batches come first). A question either of whose arms is run-failed is
 *  settled and excluded in both, whatever the other arm's own record reads (`rerun` or `not-run`: arms never spawns it
 *  again, so refusing it would never clear); an answer is correct by labelCorrect over its own reply's ANSWER field, which
 *  must equal the record's flag (else `out-refused` answer-record-mismatch), and a correct one never reaches the judge.
 *  Every refusal here is data under --out, never a TypeError (D-6309's rule).
 *  @param {{ entries: Array<{ qid: string, kind: string, fact: string, repo_roots: string[] }>,
 *    answers: Array<{ qid: string, arm: string, outcome: string, reply: string|null, correct: boolean|null }>,
 *    arms: readonly string[], shaMinPrefix: number }} o */
export function judgeItemsOf({ entries, answers, arms, shaMinPrefix }) {
  const byQid = new Map(entries.map((e) => [e.qid, e]));
  const seen = new Map();
  for (const a of answers) {
    if (!plainObject(a) || !byQid.has(a.qid) || !arms.includes(a.arm)) refuse('out-refused', `answer-record-unknown ${typeof a?.qid === 'string' ? a.qid : 'without a qid'}`);
    const key = judgePairKey(a.qid, a.arm);
    if (seen.has(key)) refuse('out-refused', `answer-record-duplicate ${a.qid}`);
    seen.set(key, a);
  }
  const unsettled = [];
  for (const e of entries) {
    const own = arms.map((arm) => seen.get(judgePairKey(e.qid, arm)));
    const failed = own.some((a) => a !== undefined && a.outcome === 'run-failed');   // R14: either arm run-failed settles the question
    for (const a of own) if (a === undefined || (!failed && a.outcome !== 'answered')) unsettled.push(e.qid);
  }
  if (unsettled.length > 0) refuse('input-invalid', `arms-unsettled ${unsettled.length} (first ${[...unsettled].sort(cmpUnit)[0]}): finish the arm batches first`);
  const items = [];
  const excluded = { correct: 0, run_failed_questions: 0 };
  for (const e of [...entries].sort((x, y) => cmpUnit(x.qid, y.qid))) {
    const own = arms.map((arm) => seen.get(judgePairKey(e.qid, arm)));
    if (own.some((a) => a.outcome === 'run-failed')) { excluded.run_failed_questions += 1; continue; }   // W2-D80: excluded from both arms
    for (const a of own) {
      if (a.reply !== null && typeof a.reply !== 'string') refuse('out-refused', `answer-record-invalid ${e.qid}`);
      const parsed = parseAnswerField(a.reply ?? '');
      const correct = parsed.state === 'value' && labelCorrect(e.kind, e.fact, parsed.value, { repoRoots: e.repo_roots, shaMinPrefix });
      if (a.correct !== correct) refuse('out-refused', `answer-record-mismatch ${e.qid}`);
      if (correct) { excluded.correct += 1; continue; }   // W2-D79: a correct answer never reaches the judge
      items.push({ qid: e.qid, arm: a.arm, entry: e, reply: a.reply ?? '' });
    }
  }
  return { items, excluded };
}

/** The judge's jobs: each item's input under its map id, in id order (the shuffle's order). Pure. A pair the map lacks is
 *  a defect: the map and the items come from the same frozen list.
 *  @param {{ items: Array<{ qid: string, arm: string, entry: object, reply: string }>,
 *    map: Array<{ id: string, qid: string, arm: string }>, idx: import('../ccd/history/lib.mjs').PairIndex }} o
 *  @returns {Array<{ id: string, input: JudgeInput }>} */
export function judgeJobsOf({ items, map, idx }) {
  const idOf = new Map(map.map((m) => [judgePairKey(m.qid, m.arm), m.id]));
  return items.map((it) => {
    const id = idOf.get(judgePairKey(it.qid, it.arm));
    if (id === undefined) throw new TypeError(`judgeJobsOf: ${it.qid} has no id in the judge map`);
    return { id, input: judgeInputOf(it.entry, it.reply, idx) };
  }).sort((a, b) => cmpUnit(a.id, b.id));
}

/** One judge run as its attempt (W2-D79): a run that failed (a non-zero exit, a signal, no result event) yields no label,
 *  whatever it printed (D-6305's rule for the writer, applied to the judge); otherwise the reply's last LABEL line. Every
 *  `error` field the run's stream carried is recorded, as each arm attempt records them (Q31, Task 4's streamEventsOf and
 *  errorFieldsOf); a stream it cannot read refuses `out-refused`, a data case under --out (D-6309's rule).
 *  @returns {JudgeAttempt} */
function judgeAttemptOf(d) {
  const failed = d.code !== 0 || d.signal !== null || d.facts.result === null;
  const parsed = failed ? { ok: false } : parseLabelLine(d.facts.result?.text ?? '');
  const read = readPlain(d.streamPath, OUT_STREAM_CAP);
  if (read.state !== 'bytes') refuse('out-refused', `run-stream-changed ${d.name}`);
  return { run: d.name, code: d.code, signal: d.signal, skipped: d.skipped, tokens: d.tokens, result: d.facts.result !== null,
    label: parsed.ok ? parsed.label : null, error_fields: errorFieldsOf(streamEventsOf(read.bytes.toString('utf8'))) };
}

/** Open the judge (W2-D79) on a claimed --out. In order, before any spawn: the settings mode and the rubric id (TypeErrors:
 *  the record's validator signed both), the model (an exact Opus id, else `args-invalid`, refuseOpusModel), the roster and
 *  the account (W2-D52: `roster-invalid`, `account-refused`; RP3-judge), the gate (W2-D55), then W2-D56's preflight
 *  (Task 4's preflightSpawn). `judge(section, jobs)` pins each job's input beside its runs, then runs attempt 1 of every
 *  job and attempt 2 of every malformed one, each pass in batches of at most BATCH_MAX at CONCURRENCY_MAX (runBatch's
 *  default), the preflight before each batch.
 *  @param {{ home: string, accountId: string, model: string, settingsMode: string, rubricId: string, claim: object,
 *    budget: number, limits: object, expected: object, allowCodeChange?: boolean, lang: string | undefined }} o
 *  @returns {Promise<Readonly<{ launch: object, stamps: () => string[],
 *    judge: (section: string, jobs: Array<{ id: string, input: JudgeInput }>) => Promise<JudgedItem[]> }>>} */
export async function openJudge(o) {
  if (o === null || typeof o !== 'object' || !Object.hasOwn(o, 'lang')) {
    throw new TypeError("openJudge: carries lang, the caller's LANG from main's env (undefined when unset)");
  }
  const { home, accountId, model, settingsMode, rubricId, claim, budget, limits, expected, lang } = o;
  if (!SETTINGS_MODES.includes(settingsMode)) throw new TypeError(`openJudge: settings mode ${JSON.stringify(settingsMode)} is not one of ${SETTINGS_MODES.join(', ')}`);
  if (!RUBRIC_IDS.includes(rubricId)) throw new TypeError(`openJudge: rubric ${JSON.stringify(rubricId)} is not one of ${RUBRIC_IDS.join(', ')}`);
  const { out } = requireClaim('openJudge', { claim }, []);
  refuseOpusModel('judge-model', model);
  const { json, roster } = readRoster(home);
  const launch = admitAccount(json, roster, accountId, home);   // RP3-judge: every refusal here lands before any spawn
  const gate = batchGate({ out, home, accountId: launch.accountId, budget, limits });
  const stamps = new Set();
  const preflightNow = async () => {
    const pre = await preflightSpawn({ launch, home, out, lang, gate, expected, allowCodeChange: o.allowCodeChange === true });
    for (const s of pre.stamps) stamps.add(s);
  };
  await preflightNow();
  /** @param {string} section  @param {Array<{ id: string, input: JudgeInput }>} jobs  @returns {Promise<JudgedItem[]>} */
  const judge = async (section, jobs) => {
    if (!ARM_SECTIONS.includes(section)) throw new TypeError(`judge: section ${JSON.stringify(section)} is not one of ${ARM_SECTIONS.join(', ')}`);
    const ids = new Set();
    for (const j of jobs) {
      if (!plainObject(j) || typeof j.id !== 'string' || !JUDGE_ID_RE.test(j.id) || ids.has(j.id)) {
        throw new TypeError(`judge: job id ${JSON.stringify(j?.id)} is not a fresh judge id`);
      }
      ids.add(j.id);
    }
    const dir = `${section}/${JUDGE_DIR}`;
    ensurePlainDir(out, dir);
    for (const j of jobs) pinOutBytes(out, `${dir}/${j.id}.input.json`, `${canonicalJson(j.input)}\n`, 'judge-input');
    /** @type {Map<string, JudgeAttempt[]>} */
    const attempts = new Map(jobs.map((j) => [j.id, []]));
    for (let attempt = 1; attempt <= JUDGE_ATTEMPTS; attempt += 1) {
      // W2-D79: attempt 1 of every job, then attempt 2 of every malformed one, never of a labelled one
      const due = jobs.filter((j) => {
        const a = attempts.get(j.id);
        return a.length === attempt - 1 && a.every((x) => x.label === null);
      });
      for (let i = 0; i < due.length; i += BATCH_MAX) {
        const batch = due.slice(i, i + BATCH_MAX);
        await preflightNow();   // W2-D56: before every judge batch
        const runs = batch.map((j) => ({ launch, mode: 'judge', model, settingsMode, stdin: judgeStdin(rubricId, j.input), out, name: `${dir}/${j.id}-${attempt}`, lang }));
        const done = await runBatch(runs, { gate, claim });
        done.forEach((d, k) => attempts.get(batch[k].id).push(judgeAttemptOf(d)));
      }
    }
    return jobs.map((j) => {
      const a = attempts.get(j.id);
      const label = a[a.length - 1].label;
      return { id: j.id, outcome: label === null ? 'judge-failed' : 'judged', label, attempts: a };
    });
  };
  return Object.freeze({ launch, stamps: () => [...stamps].sort(), judge });
}

/** `judge --section pilot|quiz` (W2 decisions §5 acts 14 and 21; W2-D79; Q2): on this node, in this node's --out, after
 *  the section's arm batches. In order: the section, then its form's flags (`judge --section pilot|quiz`); Task 4's loader, which
 *  re-checks gate_code before any other input (W2-D24) and answers the section's record, frozen list and code-change
 *  stamps, under deps.now's clock (Q23's window); the unusable inputs and the judge model (D-5813, refuseOpusModel); the run's
 *  one store open (W2-5a's R3), for this node's id and the run's pair index; Task 4's node values (the account, W2-D56's
 *  expected values, the budget in force, Q5, the limits and the settings mode); the ranges of the budget in force and the
 *  limits (D-6309's rule) and the refusals that need no store and no spawn, before --out exists (W2-5a's R10, D-6307,
 *  D-6311), as `arms` makes them; then --out, its claim, the map (pinned), the arm answers, the items, the jobs and the
 *  judge. Writes <section>/judged.json and prints only `sha256 <hex>` of it on stderr (D-5983).
 *  @param {Flags} flags  @param {DriverEnv} driverEnv
 *  @param {{ loadArmRun: typeof loadArmRun, armNodeOf: typeof armNodeOf, readArmAnswers: typeof readArmAnswers, now: () => number }} [deps] */
export async function judgeCommand(flags, driverEnv, deps = { loadArmRun, armNodeOf, readArmAnswers, now: () => Date.now() }) {
  const section = flags.section;
  if (!ARM_SECTIONS.includes(section)) refuse('args-invalid', `judge wants --section pilot or --section quiz, not ${JSON.stringify(section ?? null)}`);
  checkFlags(`judge --section ${section}`, flags);
  const home = subcommandHome(driverEnv);
  const run = deps.loadArmRun(flags, section, { nowMs: deps.now() });   // W2-D24 (judge): gate_code before any other input, the store or a spawn
  refuseUnusableInputs(home, flags.out, [['judge-model', run.record.judge_model]]);   // D-5813: HOME, --out and the model id, before --out
  refuseOpusModel('judge-model', run.record.judge_model);   // R10: before --out; openJudge asks it again at open
  const rs = openReplayStore(home);   // the run's one store open (W2-5a's R3): this node's id and the run's pair index
  try {
    const node = deps.armNodeOf(run, rs.storeId);
    refuseOutOfRangeValues({ budget: node.budget, budgetField: section === 'pilot' ? 'pilot_budget' : 'spend_budget', limits: node.limits, quotas: null });   // D-6309's rule: batchGate throws on either
    refuseSpawnAdmission({ home, accountId: node.account, limits: node.limits, expected: node.expected, allowCodeChange: run.allowCodeChange === true });   // judge: W2-5a's R10, D-6307, D-6311, before --out exists
    const out = prepareOut(flags.out);
    refuseColonInRealOut(out);
    const claim = claimOut(out);
    try {
      const r = run.record;
      const map = judgeMapOf(r.bootstrap.seed, run.frozen.list.entries, RECALL_ARMS);
      ensurePlainDir(out, section);
      const mapRel = `${section}/${JUDGE_MAP_FILE}`;
      pinOutBytes(out, mapRel, judgeMapText(section, run.frozen.sha256, map), 'judge-map');
      const own = run.frozen.list.entries.filter((e) => e.store_id === rs.storeId);   // Q2: this node's questions only
      const picked = judgeItemsOf({ entries: own, answers: deps.readArmAnswers(out, section), arms: RECALL_ARMS, shaMinPrefix: r.labeller.sha_min_prefix });
      const jobs = judgeJobsOf({ items: picked.items, map, idx: rs.idx });
      const judge = await openJudge({ home, accountId: node.account, model: r.judge_model, settingsMode: node.settingsMode, rubricId: r.rubric_id,
        claim, budget: node.budget, limits: node.limits, expected: node.expected, allowCodeChange: run.allowCodeChange === true, lang: driverEnv.LANG });
      const items = await judge.judge(section, jobs);
      const count = (pred) => items.filter(pred).length;
      const output = {
        kind: JUDGED_KIND, v: 1, section, store_id: rs.storeId, record_sha256: run.recordSha256, frozen_sha256: run.frozen.sha256,
        map_sha256: shaOfPlain(out, mapRel), judge_model: r.judge_model, rubric_id: r.rubric_id, rubric_sha256: RUBRIC_SHA256[r.rubric_id],
        settings_mode: node.settingsMode, reply_max_bytes: JUDGE_REPLY_MAX_BYTES, items,
        counts: {
          judged: count((i) => i.outcome === 'judged'), judge_failed: count((i) => i.outcome === 'judge-failed'),
          uncertain: count((i) => i.label === 'uncertain'), fabricated: count((i) => i.label === 'fabricated'),
          excluded_correct: picked.excluded.correct, excluded_run_failed_questions: picked.excluded.run_failed_questions,
        },
        budget: node.budget, spend: spentSoFar(out), stamps: [...new Set([...run.codeStamps, ...judge.stamps()])].sort(),
      };
      const rel = `${section}/${JUDGED_FILE}`;
      writePlain(out, rel, canonicalJson(output) + '\n');
      process.stderr.write(`sha256 ${shaOfPlain(out, rel)}\n`);   // D-5983: stderr; stdout stays empty
      return EXIT.OK;
    } finally {
      claim.release();
    }
  } finally {
    rs.close();
  }
}

HANDLERS.set('judge', (flags, env) => judgeCommand(flags, env));
```

- [ ] **Step 5: Run them and see them pass, then the typecheck.** In the foreground, with a timeout of at least 600000 ms:

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-5b1 Task 5'
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'three box-mode spawns, one per taught spelling'
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-5a Task 6: the writer spawn'
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts
cd server && node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit
printf 'nul %s\n' "$(cat deploy/history-replay.mjs server/test/history-replay.test.ts | tr -dc '\000' | wc -c)"
git diff --numstat -- deploy/history-replay.mjs server/test/history-replay.test.ts
```

Expected:
- The first filter is green, `43 passed`. On darwin it is `41 passed | 2 skipped`: only the `--allow-code-change` and spend-share cases, which run on Task 4's arm-stub HOME, are skipped, as Task 4's stub cases are; every other spawn reaches W2-4's recording stub as W2-5a's writer cases do, and `withoutDarwinAdded` drops the one key macOS adds. Each spawning case runs the stub one to fourteen times, the batch case about 14 s measured with its 1500 ms sleeps (D-6480); the order case over 10,000 pairs runs well under a second.
- The W2-4 Task 9 case is green with `'judge'` last.
- W2-5a's writer-spawn describe is green unchanged: `pinOutBytes` and `refuseOpusModel` keep the writer's two details word for word (`writer-input-changed quiz/writer/<qid>.input.json`; `writer-model "opus" is not an exact Opus model id`).
- The whole file is green: every earlier case plus these 43, including Task 1's arm-word scan of the driver (this section spells no arm word: the arms reach it as `RECALL_ARMS`' values), Task 1's import pin (`EXACT_NAMES` does not pin the gate's or lib's braces), W2-4 Task 5's env scan (`judgeCommand`'s env parameter is `driverEnv`; its registration line passes `(flags, env)`, as every other line there does) and W2-4 Task 4's `redactDisplayWindow` scan.
- tsc prints nothing. A line that names only `agent/src/` or a module that is not installed comes from the worktree's install, not from this task.
- `nul 0`, and both `--numstat` rows show two numbers, never `-\t-`: neither file holds a raw NUL byte, so git reads both as text and Task 6's added-line scans read every line of them. The (qid, arm) key's separator is built at runtime (`JUDGE_PAIR_SEP`, `W5B5_NUL`), never written as an escape an agent's file write could decode (Task 6 Step 5's `escapes` count).

- [ ] **Step 6: Measure every new guard red, then green.** From the repository root. Each block makes one exact replacement, which must match exactly once, runs one filter and shows it red, then restores the file with `cp`. The python body is a quoted heredoc. Run the block one mutant per tool call (Global Constraints' "One mutant per tool call").

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w2-5b1/scratch"; mkdir -p "$SCRATCH"
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
cp "$D" "$SCRATCH/driver.t5.orig"
T() { (cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t "$1"); cp "$SCRATCH/driver.t5.orig" "$D"; }

# J1: no retry (W2-D79's one retry dropped).
mut "$D" "export const JUDGE_ATTEMPTS = 2;" "export const JUDGE_ATTEMPTS = 1;"
T 'labelled on the retry|a stop never consumes the retry|malformed twice is judge-failed'
# Expected RED (predicted): 3 failed; the retry case is judge-failed after one spawn, the stop case spawns no second attempt, and the malformed-twice case sees one spawn and JUDGE_ATTEMPTS 1.

# J2: the retry's input is not identical.
mut "$D" "stdin: judgeStdin(rubricId, j.input)," "stdin: judgeStdin(rubricId, j.input) + (attempt > 1 ? ' ' : ''),"
T 'malformed twice is judge-failed|labelled on the retry'
# Expected RED (predicted): 2 failed, each on `expect(runs[1]!.stdin).toBe(runs[0]!.stdin)`.

# J3: a correct answer reaches the judge.
mut "$D" "      if (correct) { excluded.correct += 1; continue; }" "      if (correct) { excluded.correct += 1; }"
T 'a correct answer never reaches the judge|end to end on the stub'
# Expected RED (predicted): 2 failed; the correct pair is among the items, and the end-to-end case spawns four runs, not two.

# J4: correctness taken from the record, never re-derived.
mut "$D" "      const correct = parsed.state === 'value' && labelCorrect(e.kind, e.fact, parsed.value, { repoRoots: e.repo_roots, shaMinPrefix });" "      const correct = a.correct === true;"
T 'disagrees with its own reply'
# Expected RED (predicted): 1 failed; the two mismatch rows refuse nothing.

# J5: a run-failed question still reaches the judge.
mut "$D" "    if (own.some((a) => a.outcome === 'run-failed')) {" "    if (false) {"
T 'run-failed question leaves the judge|end to end on the stub'
# Expected RED (predicted): 2 failed; the run-failed record reaches the correctness check and refuses answer-record-mismatch (its correct flag is null).

# J6: unsettled pairs pass.
mut "$D" "  if (unsettled.length > 0) refuse(" "  if (false) refuse("
T 'an unsettled pair refuses'
# Expected RED (predicted): 1 failed, at its first row: the rerun record reaches the correctness check and refuses out-refused answer-record-mismatch, not input-invalid (the missing row would be a TypeError reading .outcome of undefined).

# J7: the arm reaches the judge's input.
mut "$D" "    return { id, input: judgeInputOf(it.entry, it.reply, idx) };" "    return { id, input: { ...judgeInputOf(it.entry, it.reply, idx), arm: it.arm } };"
T 'no arm token reaches|end to end on the stub'
# Expected RED (predicted): 2 failed; every stdin and input file holds an arm value.

# J8: the shuffle's sort key puts the arm first.
mut "$D" "(p) => judgePairKey(p.qid, p.arm)" "(p) => judgePairKey(p.arm, p.qid)"
T 'the judge order is the judge-order substream'
# Expected RED (predicted): 1 failed; the map differs from the independent (qid, arm) order.

# J9: another substream.
mut "$D" "substream(seedHex, 'judge-order')" "substream(seedHex, 'handcheck')"
T 'the judge order is the judge-order substream'
# Expected RED (predicted): 1 failed; the map is the handcheck stream's order.

# J10: the reply is cut before it is redacted (W2-D54's order reversed).
mut "$D" "    reply: capUtf8Bytes(/** @type {string} */ (maskValue(text, idx)), JUDGE_REPLY_MAX_BYTES)," "    reply: /** @type {string} */ (maskValue(capUtf8Bytes(text, JUDGE_REPLY_MAX_BYTES), idx)),"
T 'straddling the 16 KiB edge'
# Expected RED (predicted): 1 failed; the reply holds the secret's first ten characters.

# J11: the cap counts UTF-16 code units, not UTF-8 bytes.
mut "$D" "  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;" "  return text.slice(0, maxBytes);"
T 'capped at 16 KiB of UTF-8'
# Expected RED (predicted): 1 failed; the CJK reply's head is 16384 code units, about 32 KiB of UTF-8.

# J12: the preflight once per pass, not before every batch.
mut "$D" "        await preflightNow();   // W2-D56: before every judge batch" "        if (i === 0) await preflightNow();   // W2-D56: before every judge batch"
T 'the preflight before every batch'
# Expected RED (predicted): 1 failed; the log reads VVPPPPPPPPPPPP, with no V before the second batch.

# J13: a failed run's LABEL line is taken.
mut "$D" "  const failed = d.code !== 0 || d.signal !== null || d.facts.result === null;" "  const failed = d.facts.result === null;"
T 'exits non-zero, or shows no result event'
# Expected RED (predicted): 1 failed; the exit-3 job is judged on its first attempt.

# J14: no model check.
mut "$D" "  refuseOpusModel('judge-model', model);" "  // the judge model is not checked"
T 'not an exact Opus id'
# Expected RED (predicted): 1 failed; 'opus' on up-a opens and spawns --version, and cx-a with 'opus' is account-refused.

# J15: the store opens before the record is loaded.
mut "$D" "  const run = deps.loadArmRun(flags, section, { nowMs: deps.now() });   // W2-D24 (judge)" "  openReplayStore(home).close(); const run = deps.loadArmRun(flags, section, { nowMs: deps.now() });   // W2-D24 (judge)"
T 'the record is loaded first'
# Expected RED (predicted): 1 failed; the storeless HOME answers store-unreadable, not code-changed.

# J16: the no-store, no-spawn refusals after --out is made.
mut "$D" "    refuseSpawnAdmission({ home, accountId: node.account, limits: node.limits, expected: node.expected, allowCodeChange: run.allowCodeChange === true });   // judge:" "    prepareOut(flags.out); refuseSpawnAdmission({ home, accountId: node.account, limits: node.limits, expected: node.expected, allowCodeChange: run.allowCodeChange === true });   // judge:"
T 'answers before --out'
# Expected RED (predicted): 3 failed; each leaves an --out behind.

# J17: a labelled reply is retried too.
mut "$D" "        return a.length === attempt - 1 && a.every((x) => x.label === null);" "        return a.length === attempt - 1;"
T 'a labelled reply is never retried'
# Expected RED (predicted): 1 failed; two spawns and two attempts.

# J18: the map is written over, never pinned.
mut "$D" "      pinOutBytes(out, mapRel, judgeMapText(section, run.frozen.sha256, map), 'judge-map');" "      writePlain(out, mapRel, judgeMapText(section, run.frozen.sha256, map));"
T 'judge map that changed'
# Expected RED (measured over predicted): 1 failed; the changed list is still refused out-refused, but as `judge-input-changed quiz/judge/j0001.input.json` (the re-mapped id's pinned input differs) where `judge-map-changed quiz/judge.map.json` was expected.

# J19: no cross-check of the record's flag.
mut "$D" "      if (a.correct !== correct) refuse(" "      if (false) refuse("
T 'disagrees with its own reply'
# Expected RED (predicted): 1 failed; the two mismatch rows refuse nothing.

# J20: the id width never grows.
mut "$D" "  const width = Math.max(JUDGE_ID_MIN_DIGITS, String(order.length).length);" "  const width = JUDGE_ID_MIN_DIGITS;"
T 'ids widen past 9999 pairs'
# Expected RED (predicted): 1 failed; the first id is j0001, not j00001.

# J21: inputs are never pinned.
mut "$D" "    for (const j of jobs) pinOutBytes(" "    for (const j of []) pinOutBytes("
T 'changed input for the same id refuses'
# Expected RED (predicted): 1 failed; the changed input is skipped as finished, with no refusal (and RP1-judge's input file is absent; it is not in this filter).

# J22: UNKNOWN is shown as no answer.
mut "$D" "a.state === 'unknown' ? 'UNKNOWN' : null" "a.state === 'unknown' ? null : null"
T 'answer_field is the ANSWER line'
# Expected RED (predicted): 1 failed, at the first UNKNOWN expectation.

# J23 (D-6470): the answer field is carried uncut.
mut "$D" "    answer_field: field === null ? null : capUtf8Bytes(/** @type {string} */ (maskValue(field, idx)), JUDGE_REPLY_MAX_BYTES),   // D-6470" "    answer_field: field === null ? null : /** @type {string} */ (maskValue(field, idx)),"
T 'capped at 16 KiB of UTF-8'
# Expected RED (predicted): 1 failed; the 20,000-byte ANSWER value reaches the input whole.

# J24 (Q31): a judge attempt's error fields are not recorded.
mut "$D" "    label: parsed.ok ? parsed.label : null, error_fields: errorFieldsOf(streamEventsOf(read.bytes.toString('utf8'))) };" "    label: parsed.ok ? parsed.label : null, error_fields: [] };"
T 'Q31: every error field a judge run carries'
# Expected RED (predicted): 1 failed; the attempt's error_fields is [] where ['fixture_error_field'] was expected.

# J25 (W2-D80, R14): settledness read per pair again, so a run-failed arm no longer settles its question.
mut "$D" "    for (const a of own) if (a === undefined || (!failed && a.outcome !== 'answered')) unsettled.push(e.qid);" "    for (const a of own) if (a === undefined || (a.outcome !== 'answered' && a.outcome !== 'run-failed')) unsettled.push(e.qid);"
T 'a run-failed arm settles its question'
# Expected RED (predicted): 1 failed, at its rerun row: input-invalid arms-unsettled where the question was excluded.

# J26 (D-5813): the judge's unusable inputs are not refused before --out.
mut "$D" "  refuseUnusableInputs(home, flags.out, [['judge-model', run.record.judge_model]]);   // D-5813" "  // the unusable inputs are not refused   // D-5813"
T 'refuses before --out, in either section'
# Expected RED (predicted): 1 failed, at `no --out`: refuseColonInRealOut answers the same args-invalid line, but after
# prepareOut has made the ':' --out.

# J27 (D-6309's rule): the budget in force and the limits are not ranged before --out.
mut "$D" "    refuseOutOfRangeValues({ budget: node.budget, budgetField: section === 'pilot' ? 'pilot_budget' : 'spend_budget', limits: node.limits, quotas: null });" "    void node.budget;"
T 'refuses before --out, in either section'
# Expected RED (predicted): 1 failed, at its pilot row: --out is made, and judgeItemsOf refuses input-invalid
# arms-unsettled (no answers are injected) where record-invalid was expected.

# J28 (W2-D79, R10): the judge model is checked only at open, after --out.
mut "$D" "  refuseOpusModel('judge-model', run.record.judge_model);   // R10" "  void run.record.judge_model;   // R10"
T 'refuses before --out, in either section'
# Expected RED (predicted): 1 failed, at the judge-model row: --out is made, and judgeItemsOf refuses input-invalid
# where args-invalid was expected.

# J29 (Q23): the judge's no-spawn admission drops --allow-code-change.
mut "$D" "    refuseSpawnAdmission({ home, accountId: node.account, limits: node.limits, expected: node.expected, allowCodeChange: run.allowCodeChange === true });   // judge:" "    refuseSpawnAdmission({ home, accountId: node.account, limits: node.limits, expected: node.expected, allowCodeChange: false });   // judge:"
T 'stamps judged.json'
# Expected RED (predicted): 1 failed on a non-darwin box (darwin skips the case): refuseSpawnAdmission's preflightFiles
# refuses code-changed before --out where judged.json was expected.

# J30 (Q5, W2-D55): the judge's spawn gate is not bounded by this node's share.
mut "$D" "        claim, budget: node.budget, limits: node.limits," "        claim, budget: Number.MAX_SAFE_INTEGER, limits: node.limits,"
T 'the judge spends under this node'
# Expected RED (predicted): 1 failed on a non-darwin box (darwin skips the case): the re-run spawns (two judge runs) and the
# item ends judge-failed with exit 0, where budget-exhausted `spent 65 of 60` was expected. judged.json's own `budget`
# field still reads node.budget, so the end-to-end case stays green: only this case pins the gate's argument.

cmp "$D" "$SCRATCH/driver.t5.orig" && echo restored && rm -f "$SCRATCH/driver.t5.orig"
git diff --stat -- deploy/history-replay.mjs   # this task's section, the two refactored helpers and the two flag forms only
```

Each `T` restores the driver whatever the run showed. Then run Step 5's commands again: green.

One refusal this task adds has no case, CONTROL or mutant of its own, by design (Global Constraints' Red-first names the exception): `judgeAttemptOf`'s `out-refused` `run-stream-changed <name>`. It re-reads a stream that W2-4's `launchRun` has just renamed into place (a fresh run) or that `finishedOutcome` has just read and matched against its recorded sha (a resumed run). No single-process case reaches it without a write racing the batch, and the judge's print runs take no stub act that could make that write. It is defence behind those two checks, which W2-4's resume cases pin, and it stays unpinned here.

- [ ] **Step 7: Run the neighbours that read the same files or the same names.** In the foreground, with a timeout of at least 600000 ms. If a file goes red, re-run it alone before calling it a break (CLAUDE.md's load flakes):

```bash
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'ccrc history'
cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts
cd server && ./node_modules/.bin/vitest run test/citations.test.ts
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts
```

Expected: green.
- `single-definition -t 'ccrc history'`: O13's scans read `deploy/*.mjs`; this section spells no `/headless-on`, pairs no write verb with `.headlessOn`, declares no O14 `VOCABS` name (the `JUDGE_*` names are driver-local) and imports `RUBRICS`, `parseLabelLine` and the rest rather than declaring them.
- `measure-history.test.ts` (the gate's suite, unchanged) pins `RUBRICS`' sha literals and `parseLabelLine`, which this task reads and never edits.
- `citations.test.ts`: no added line cites `file.mjs:N` or `file.ts:N`; this task cites symbols.
- `history-replay.test.ts` is green as a whole.

- [ ] **Step 8: Commit.**

```bash
git add deploy/history-replay.mjs server/test/history-replay.test.ts
CO_AUTHORED_BY='<the Co-Authored-By line the attribution reminder gives>'
git commit -m "feat(history-replay): the judge, one blinded judge-mode spawn per non-correct answer, retried once, then judge-failed (W2-5b1 Task 5; W2-D79, W2-D54, W2-D80, W2-D18, W2-D55, W2-D56; D-6470)" -m "$CO_AUTHORED_BY"
```

### Task 6: the departures, the whole-PR checks and the PR

Tasks 1 to 5 ship W2-5b1's code and pins. This task adds no driver code and no guard. It adds one test, the arms-then-judge walk over one `--out` (R21): Task 4's real `arms`, then Task 5's `judge` with every loader real, committed on its own. Then it measures what the PR holds against what W2-5b1 may hold (S1):
- the departures this plan defines, each defined once, in the task that first cites it, and none of them a number of the W2 decisions document;
- the file list: the two files, and this plan only for a build-time number or a corrected prediction; no README, no spec, no gate, no `ccd/**`, `shared/**` or `.github/**` path, and no new file (W2-D5);
- the carries and must-holds W2-5b1 owes, each checked by content in the driver and by title in the test file (scope.md C's must-holds for W2-5b1; S2's C9 and C22);
- the added lines (citations, shells, live reads, key-shaped literals, placeholder departure tokens, D-number ranges, hosts and home paths, private names).

It then runs the PR's own suite whole, the whole-PR checks one per tool call, writes the PR body and opens the PR.

**W2-5b1 never touches the spec or README (S1).** W2-5b is split in two serial PRs. The spec errata for W2-2a, W2-2b, W2-5a and W2-5b (decisions §6: E2, E7, E8, E9, E10, E11, E19, E20, E21, E22, E23 and E24) and README's driver paragraph (the ledger's carry from W2-5a's R8, naming the `--no-warnings` shebang) are all W2-5b2's. Two errata come from decisions this PR implements: **E21** (§10.2's as-of seam bullet: during the pilot headless-on lists the pilot pairs, D-5781, W2-D76) and **E22** (§10.2's item 3 and "Scoring": the single ANSWER field, the widened `uncertain`, the signed rubric ids, `judge-failed`, D-5776, D-5777 and D-5778). Step 3 asserts that the PR's diff holds neither the spec path nor README, and that the rev 3.6 sentences E21 and E22 change still stand once each, unchanged.

**The departures.** W2-5b1 defines no number of the W2 decisions document: the W2 block's nineteen are defined by the plans §6's "Defined in" names, and this plan cites the ones it needs bare. It defines only:
- the four numbers the coordinator issued, before dispatch, for the departures found while this plan was written (R3): D-6467, D-6468, D-6469 and D-6470, each in `## Deviations found` and named in the header's Decisions table;
- each number issued to this run from the run's block during the build, defined in `## Deviations found` by the commit that first cites it.

Step 2 does not take the list from this task's text. It derives the list from `## Deviations found` itself and checks every number it finds, one by one: there is exactly one entry, it carries a slug, the task its entry names first is the first `### Task` section that cites it, the decisions document never names it, and no other plan on `origin/main` defines it. It also checks every number the PR cites bare: each has a definition in some plan on `origin/main`. No step writes a D-number range or loops over one; every loop runs over a list read from a file.

A number issued to this run and left unused is never written into the plan, a commit message or the PR body: the worker names it in the wave-done report to the coordinator, who reconciles the ledger.

**Not this task's, never touched here:** W2-5b2's subcommands (`step0b`, `fidelity`, `pilot-result`, `open --amend`, `handcheck`, `report`) and its edit of `open --finalize`; W2-5b2's errata and README paragraph; W2-6's (E25); the programme ledger and the decisions document; `single-definition.test.ts`, `lifecycle.test.ts`, `growth-check.test.ts`, `citations.test.ts`, `dtbd.test.ts`, `ci-pipeline.test.ts`, `deviation-refs.test.ts`, `docs-policy.test.ts` and `topology-clean.test.ts`, which this task runs and never edits; every operator act in decisions §5.

**Files:** anchors measured at `c34f82830`, hints only; each is re-anchored by its quoted content, and a moved anchor is reported as a drift.
- Modify: `server/test/history-replay.test.ts`: one describe appended at the end of the file, the arms-then-judge walk (Step 1). Nothing else when every check is green. When a check finds a defect, the fix goes into the task that owns the code, as that task's correction commit (see **Commit**), never here.
- Read, no edit:
  - `deploy/history-replay.mjs` (5,801 lines at `c34f82830`, plus Tasks 1 to 5):
    - its header comment, lines 2 to about :31, whose sentence "Never spelled here: the recall arm words, which reach a spawn as parameters (W2-D50), and the headless marker's path, which W2-5b reaches through lib's historyPaths." starts about :24;
    - its fourteen module statements (about :32 to :45), one per module;
    - `export const DRIVER_REASONS = Object.freeze([` (about :69), 29 words at `c34f82830`, the last `'store-unreadable'`;
    - `export const FLAG_SPECS` (about :110), 49 flags at `c34f82830`;
    - `export const HANDLERS = new Map();` (about :135);
    - `export const CODE_SHA_FILES = GATE_CODE_FILES;` (about :1963);
    - its one `lstatSync(recallOffPath(home, id));` line (about :2166);
    - the two arm-word sites Task 1 rewrites: `if (a.arm === 'control') controlIds.add(...)` in `quizPopulation` (about :4013) and `if (arm === 'control') {` in `abStateOf` (about :5196);
    - `export async function verifyCommand(flags, env)` (about :5781), whose refusal `this build verifies ab only` (about :5785) Task 3 replaces;
    - the entry guard `if (process.argv[1] && import.meta.url === ...` (about :5799), still the last block.
  - `deploy/history-gate.mjs` (never edited): its one import line, `import { EXIT, RECALL_OFF_META, UUID_RE, canonicalJson, isSyntheticModel, pickHoldingCopy, producerOf, sha256Hex } from '../ccd/history/lib.mjs';` (about :23); `export const SUBSTREAMS` (about :59), whose last word is `'judge-order'`; `export const ASSIGNMENT_ARMS = Object.freeze(['treatment', 'control']);` (about :70); `export const GATE_CODE_FILES` (about :145).
  - `ccd/history/lib.mjs` as W2-2b leaves it on `main`: `RECALL_ARMS`, `HEADLESS_LIST_MAX_BYTES`, `parseHeadlessList`, `formatHeadlessList` and `headlessMarkerOf` (the W2-2b plan's Task 1), and `historyPaths(home).headlessOn`.
  - `server/test/history-replay.test.ts` (10,678 lines at `c34f82830`, plus Tasks 1 to 5): the `FLAG_SPECS declares exactly` case (about :199), `EXPECTED_IMPORTS` (about :3057, D-5814), the `HANDLERS` key line (about :4824), the `CODE_SHA_FILES parity` case (about :5579), the `verify --section quiz` refusal case expecting `this build verifies ab only` (about :9249), and W2-5a Task 7's describe `the codeShas re-check on every record subcommand` (about :9376) with its two `it.each(rows)` titles, `code-changed before any other input is read, re-checks the code it runs under: %s` and `code-unmeasured, never code-changed, for a gate_code file that cannot be read: %s`.
  - `server/test/single-definition.test.ts` (8,496 lines at `c34f82830`, plus W2-2b's appended describe): the scans that read `deploy/` (`ALL_MJS` or `DECL_CORPUS`): O13's switch describe (about :5111) and its case `recall-off/<id>: exactly one writer, sweep.mjs` (about :5273), which pins exactly one driver line holding `lstatSync(recallOffPath(`; O14's describe (about :5319); the symbolic write scan, `no line of any .mjs under ccd/, deploy/ or shared/ pairs a write verb with a switch symbol` (about :5517); W2-1's `the deploy lane exports are each defined once` (about :8363); W2-2a's `the as-of cut is defined once, in lib.mjs` (about :8453); and W2-2b's appended `the headless marker and the arm words are defined once, in lib.mjs, and read one way`, whose definers case reads `ALL_MJS`. The env allow-list (about :5464) and W2-2a's seam-name holders (about :8476) read `ccd/history/*.mjs` only, not `deploy/`: the driver's own env scan and import pin are in `history-replay.test.ts`.
  - `server/test/lifecycle.test.ts`: the case `declares history-replay-out` (about :1326), which imports `OUT_MARKER` from the driver in-process (about :1336).
  - `server/test/growth-check.test.ts`: `const GROWTH_FILES = [` (about :57), nine files, none under `deploy/`.
  - `server/test/citations.test.ts`: `CITATION` (about :51), `/ccd:\d{3,5}\b|\.(?:ts|tsx|mjs|sh):\d+\b/g`.
  - `server/test/dtbd.test.ts`: `PATTERN` (about :18), the placeholder prefix and `'-[a-z0-9]'` joined at runtime, so the file never spells the token it scans for.
  - `.github/workflows/ci.yml`: the node-floor heredoc's `test/history-replay.test.ts` line (about :934), unchanged.
  - The spec's E21 and E22 sentences and the card sentence (about :2694, :2695, :2719 and :2721).
  - This plan's `## Deviations found`, and the decisions document (read whole by Step 2's checker).
- Create (gitignored scratch, never committed): `.superpowers/sdd/history-w2-5b1/t6-dnum.mjs`, `.superpowers/sdd/history-w2-5b1/t6-carries.mjs`, `.superpowers/sdd/history-w2-5b1/t6-live.mjs`, `.superpowers/sdd/history-w2-5b1/titles.txt`, `.superpowers/sdd/history-w2-5b1/pr-body.md`, and the scratch copy `.superpowers/sdd/history-w2-5b1/scratch/plan-control.md`, which Step 2 removes.
- Never edited by this task: anything. The PR as a whole never edits `ccd/**`, `shared/**`, the spec, `README.md`, `CLAUDE.md`, `deploy/history-gate.mjs`, `deploy/measure-history.py`, `.github/**`, the ledger, the decisions document, or any test file other than `server/test/history-replay.test.ts`.

**Interfaces:**
- Consumes (names the checks measure; this task defines none):
  - `deploy/history-replay.mjs`:
    - `HANDLERS: Map<string, (flags: Flags, env: DriverEnv) => Promise<number>>`, whose keys after Tasks 1 to 5 are W2-4's and W2-5a's eight (`step0a`, `probe`, `pilot-source`, `quiz-source`, `freeze`, `power`, `open`, `verify`) plus `marker` (Task 3), `arms` (Task 4) and `judge` (Task 5) (S1, Q1);
    - `DRIVER_REASONS: readonly string[]`, 29 words at `c34f82830`, plus any word Tasks 1 to 5 declare in their Interfaces, each placed once in Task 1's stop/refusal partition (C6, Q24);
    - `FLAG_SPECS: Readonly<Record<string, FlagKind>>`, 49 flags at `c34f82830`, plus the flags Tasks 1 to 5 declare;
    - `CODE_SHA_FILES`, which is the gate's `GATE_CODE_FILES` itself (`===`), unchanged: `['deploy/history-gate.mjs', 'deploy/measure-history.py', 'deploy/history-replay.mjs', 'ccd/history/lib.mjs']`;
    - exactly one line holding `lstatSync(recallOffPath(` (W2-D78 (ii), O13's recall-off case);
    - the code lines naming `.headlessOn`, each the marker's one bounded read, `readBounded(<expr>.headlessOn, HEADLESS_LIST_MAX_BYTES, false)` (W2-D84, W2-D78 (i); the shape W2-2b's single-definition describe allows in `ccd/history`);
    - no quoted arm word on any line (W2-D42), no `/headless-on` on any line, and no line pairing a write verb with a switch symbol (O13).
  - `deploy/history-gate.mjs`: `ASSIGNMENT_ARMS` (`['treatment', 'control']`, order unchanged: `handcheckSample` iterates it, S2's C9), `GATE_CODE_FILES`.
  - `ccd/history/lib.mjs`: `RECALL_ARMS` (`['control', 'treatment']`), `HEADLESS_LIST_MAX_BYTES` (65,536).
  - The test file's titles after Tasks 1 to 5, each W2-5b1 describe titled `W2-5b1 Task <N>: …` as W2-5a's were `W2-5a Task <N>: …`.
  - This plan's `## Deviations found`: one em-dash entry `- **D-<n>** — \`<slug>\` (Task <N>…` per number it defines.
- Produces: one test describe, `W2-5b1 Task 6: the arms-then-judge walk over one --out (R21)`, over Task 4's test fixtures (`w5b4Node`, `w5b4Pilot`, `w5b4Act`, `w5b4Stream`, `w5b4Arms`, `w5b4Runs`) and Task 5's (`W5B5_LABELLED`, `w5b5InProcess`, `W5B5_ENV`); the PR body file, the PR, and the measured summary lines the body carries.

**Decisions:** R27 (the PR body names the three in-place edits of W2-5a cases it licenses, and Step 11 lists the ones the build made), R32 (the walk's fixtures are predictions), W2-D3 (no spec path in this PR: the errata are W2-5b2's under S1), W2-D4 (each number defined once, in the plan of the first PR that ships it; deviation-refs), W2-D5 (no new file; the node-floor heredoc unchanged), W2-D6 (rollout only with W2's final release; nothing runs on a real node before), W2-D24 (each of this PR's `--record` consumers re-checks `codeShas()` first), and the decisions Tasks 1 to 5 apply, as the PR body states them.

**Choices this task makes:**
- **One commit, the walk (R21).** Every other step reads. A check that finds a defect sends the fix to the task that owns the code, as a commit named for that task. Two things are recorded in this plan in the commit that needs them: a corrected prediction, and a number issued during the build (S1 as R25 reads it: the plan is edited for those only).
- **The departures list is read, never typed.** Step 2's checker reads `## Deviations found` and checks each number it finds. Its CONTROL is a scratch copy with a synthetic entry built at runtime and appended twice, which must read `defined 2`. Measured at planning time on W2-5a's plan at `c34f82830`, the same checker printed `plan-defines 18`, each with `defined 1` and `agree 1`, and `in-decisions 1` for D-5780 alone, the W2 block's one number among them: so `in-decisions` sees a number the decisions document names. The bare-citation loop read clean over W2-5a's plan at `c34f82830`: every number it cites has a definition in some plan.
- **The suites W2-5b1's change can reach are required.** W2-5b1 edits the driver and its test file:
  - `history-replay`, whole, in one vitest process;
  - `lifecycle`, which imports the driver in-process (its `history-replay-out` case), so the driver's import graph, with the names Task 1 adds, loads in its worker;
  - `single-definition`, for the scans that read `deploy/` (above): O13's path needle and recall-off case, the symbolic write scan, O14's `DECL_CORPUS`, and the definers scans of W2-1, W2-2a and W2-2b, which red if the driver declares a lib name it should import (`asOfCut`, `asOfHiddenNodesSql`, `parseHeadlessList`, `formatHeadlessList`, `headlessMarkerOf` and the rest);
  - `citations`, `topology-clean`, `dtbd`, `ci-pipeline` and `deviation-refs`, which read the tree;
  - `growth-check` under `GROWTH_CHECK=1`;
  - `docs-policy`, named by the coordinator's list. It reads nothing W2-5b1 changes and runs as a control;
  - both `tsc` projects.

  The gate's own suite, `measure-history.test.ts`, is required only if Step 4 shows the gate's import line moved or `lib.mjs` changed in this PR. Neither should: W2-5b1 never edits the gate or lib, and that suite neither imports nor reads the driver.
- **Growth.** `deploy/history-replay.mjs` is not a `GROWTH_FILES` entry: the nine listed files are `ccd/ccd`, `ccd/ccrc`, `ccd/session-hook.sh`, `server/src/watch.ts`, `server/src/coord/store.ts`, `server/src/coord/routes.ts`, `server/src/server.ts`, `server/src/sessionws.ts` and `pwa/src/lib/api.ts` (D-5848, armed by the operator on 2026-10-21, D-6178). So growing the driver by about 1,650 lines (scope.md C) needs no exemption (`growth-exemptions.json`, D-6211) and no waiver entry (`growth-waivers.json`, D-6223). The `L1_L2_NEW_FILE_DIRS` waiver does not apply either: the PR creates no file. Step 4 derives the list from the test file and measures that the PR touches none of it; Step 8 runs the check armed.
- **Titles are read by their prefix (R22).** Step 6's census selects every W2-5b1 describe by `W2-5b1 Task <N>:`, and reads a must-hold whose fragment no title carries case by case.
- **Must-holds are checked twice: by content in the driver, by title in the tests.** Step 5 reads the driver's text for each must-hold that a text can show (the arm words, `/headless-on`, the write-verb pairing, the one recall-off line, the marker's one read, no re-declared import, the module list, the handlers, the reasons, the set parity). Step 6 lists every test title and counts, per must-hold, the W2-5b1 titles that name it. A must-hold with no title is read case by case; a pin found under other words has its title recorded in the PR body, and a pin that does not exist is a finding against the owning task, reported to the coordinator, never added here.
- **The added-line scans read only the PR's added lines, its commit messages, the PR title, the PR body and this plan.** They print counts, never a matched token. A non-zero private-name count is judged by its line numbers only.

**Live safety.** This task runs suites and read-only greps. Every suite it runs drives the driver as W2-4's, W2-5a's and Tasks 1 to 5's cases do:
- with `mkTmp` fixture HOMEs and the scrubbed environment;
- spawns reach a recording node stub at `$HOME/.local/bin/<id>`, never a real Claude Code; arm and judge runs included;
- `PATH` is `<out>/poison-bin:…`, with a poisoned `gh`;
- stores are fixture stores built in the case's temp tree;
- no live pid but `process.pid` or 1.

Step 5's added-line scans check the test lines for two hazards: a live-HOME read, and a spawn of a bare `claude`, `ccd`, `ccrc`, `gh` or `sqlite3`. No step reads `~/.ccrc`, `~/.cc-sessions`, `~/.cc-limits` or any account home. No step runs `claude`, `ccd`, a `ccrc` verb, the history shim, `sweep.mjs`, `cli.mjs`, `deploy/history-gate.mjs` or `deploy/measure-history.py` against a live home, and no step runs a driver subcommand outside a suite. Step 5's `t6-live.mjs` imports the driver, the gate and lib to read constants: the driver's entry guard is false (its `argv[1]` is the script), and the only side effect is `cli.mjs`'s `process.umask(0o077)` in that short-lived process. The fixture directories the suites create are removed by their own `afterEach`/`afterAll`. Step 10 checks that `git status --short` is empty.

- [ ] **Step 0: Check the base, W2-2b, and the tree.** From the repository root:

```bash
git fetch origin main
git merge-base --is-ancestor c34f82830 HEAD && echo 'base holds W2-5a' || echo 'STOP: W2-5a (#1134) is not on this base'
W2B=$(git log --format=%H -1 --grep='^ccrc history wave W2-2b' origin/main)
test -n "$W2B" && git merge-base --is-ancestor "$W2B" HEAD && echo 'base holds W2-2b' || echo 'STOP: W2-2b is not merged under this branch'
git log --format='%h %s' -1 "$W2B"
git show origin/main:ccd/history/lib.mjs | grep -cE '^export (const|function) (RECALL_ARMS|HEADLESS_LIST_MAX_BYTES|parseHeadlessList|formatHeadlessList|headlessMarkerOf)\b'
PLAN=docs/superpowers/plans/2026-10-22-ccrc-history-w2-5b1-arms-and-judge.md
git cat-file -e "origin/main:$PLAN" && echo 'plan on main' || echo 'STOP: the plan is not on main'
git status --short | wc -l
git log --oneline --no-merges origin/main..HEAD | wc -l
MB=$(git merge-base origin/main HEAD)
git diff --name-only "$MB" origin/main | grep -xF -f <(git diff --name-only "$MB" HEAD) || echo 'main moved no path of this PR'
```

Expected:
- `base holds W2-5a`;
- `base holds W2-2b`, then W2-2b's squash subject (`ccrc history wave W2-2b: the headless seam (#<n>)`), whose number the PR body's opening line names;
- `5`: lib exports the five W2-2b names this PR imports;
- `plan on main`;
- `0` (Tasks 1 to 5 committed, nothing staged);
- the count of this branch's own commits: 5 (Tasks 1 to 5), or more when a task added a correction commit; Step 1 adds the sixth;
- `main moved no path of this PR`. A listed path is another PR's edit of one of ours (W2-6 is the only other deploy-lane PR, and it waits for W2-5b, W2-D2): merge `origin/main` (never a rebase), keep both sides, and run Steps 2 to 10 on the merge.

On any `STOP`, report to the coordinator and run nothing else.

- [ ] **Step 1: The arms-then-judge walk (R21).** Append at the end of `server/test/history-replay.test.ts`, after Task 5's block:

```ts
// ── W2-5b1 Task 6: the arms-then-judge walk over one --out (R21) ─────────────────────────────────────────────────
// Task 4's real `arms --section pilot` on the arm stub (Task 2's re-check and payloads stood in, as Task 4's stub cases
// stand them in), then `judge --section pilot` over the same --out with every loader real: Task 4's loadArmRun,
// armNodeOf and readArmAnswers. The --version line and every judge run print one labelled stream (W5B5_LABELLED, written
// before part 1 measures the version); each arm run prints its own. Every HOME is a mkTmp fixture; nothing spawns a model.
describe.skipIf(process.platform === 'darwin')('W2-5b1 Task 6: the arms-then-judge walk over one --out (R21)', () => {
  it('arms then judge: the answer records reach the judge through readArmAnswers, a correct answer never does, and judged.json names ids only (W2-D79, W2-D80, Q2)', async () => {
    const home = w5b4MkTmp('ccrc-w5b6-walk-');
    writeFileSync(join(home, STUB_STREAM), W5B5_LABELLED);   // before w5b4Node, so --version and part 1's step 0a read it
    w5b4Node(home);
    w5b4CreateStore(home, { storeId: W5B4_STORE_A });
    const fx = w5b4Pilot(home, { n: 2 });
    const [q1, q2] = fx.entries as [W5b4R, W5b4R];
    w5b4Act(home, q1, W5B4_CONTROL, '.jsonl', w5b4Stream({ text: 'ANSWER: UNKNOWN' }));
    w5b4Act(home, q1, W5B4_TREATMENT, '.jsonl', w5b4Stream({ text: `ANSWER: ${q1.fact as string}` }));
    w5b4Act(home, q2, W5B4_CONTROL, '.jsonl', w5b4Stream({ text: 'ANSWER: deadbee' }));
    w5b4Act(home, q2, W5B4_TREATMENT, '.jsonl', w5b4Stream({ text: 'I do not remember the commit.' }));
    const arms = await w5b4Arms(home, fx.argv);
    expect([arms.refusal, arms.code]).toEqual([null, 0]);
    expect(D4.readArmAnswers(fx.out, 'pilot'), 'one record per (qid, arm)').toHaveLength(4);
    const flags = (D4.parseArgs(['judge', ...fx.argv.slice(1)]) as { flags: Record<string, unknown> }).flags;
    const r = await w5b5InProcess(() => W5B5.judgeCommand(flags, W5B5_ENV(home)));
    expect(r.refusal).toBeNull();
    expect(r.code).toBe(0);
    const judgedText = readFileSync(join(fx.out, 'pilot', 'judged.json'), 'utf8');
    expect(r.stderr, 'only the sha line (D-5983)').toBe(`sha256 ${sha256Hex(judgedText)}\n`);
    const map = JSON.parse(readFileSync(join(fx.out, 'pilot', 'judge.map.json'), 'utf8')) as { items: W5b5MapRow[] };
    expect(map.items).toEqual(W5B5.judgeMapOf((fx.draft.bootstrap as W5b4R).seed as string, fx.entries as unknown as W5b5Entry[], W5B5_ARMS));
    const idOf = (q: W5b4R, a: string): string => map.items.find((m) => m.qid === q.qid && m.arm === a)!.id;
    const judged = JSON.parse(judgedText) as Record<string, any>;
    expect(judged.items.map((i: W5b5Item) => i.id)).toEqual([idOf(q1, W5B4_CONTROL), idOf(q2, W5B4_CONTROL), idOf(q2, W5B4_TREATMENT)].sort());
    expect(judged.counts).toEqual({ judged: 3, judge_failed: 0, uncertain: 0, fabricated: 3, excluded_correct: 1, excluded_run_failed_questions: 0 });
    const judgeRuns = w5b4Runs(home).filter((x) => x.env.CCRC_RECALL_ARM === undefined);
    expect(judgeRuns, 'one judge spawn per non-correct answer').toHaveLength(3);
    for (const run of judgeRuns) for (const a of W5B5_ARMS) expect(run.stdin as string, a).not.toContain(a);
    for (const a of W5B5_ARMS) expect(judgedText, a).not.toContain(a);
  }, 180_000);
});
```

Run it, in the foreground, with a timeout of at least 600000 ms:

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-5b1 Task 6'
```

Expected (predicted): `1 passed` (skipped on darwin). It adds no guard: it walks Tasks 4 and 5's code end to end, so it is green at once. Its fixtures are predictions no planning step measured (R32): `W5B5_LABELLED` written before `w5b4Node` so `--version` and part 1's step 0a read it, the store `w5b4CreateStore` makes beside `w5b4Pilot`'s, the four canned arm streams (q1's treatment correct, the other three not), and what follows from them, three judge runs, `fabricated: 3`, `excluded_correct: 1`. If one does not hold, fix the fixture, never a guard or the code under it, and record the measured value over the predicted one in a `docs(plan): … (W2-5b1 Task 6)` commit touching only this plan (R25). Its two mutants show that it reads the seam between them. Each is one exact replacement, asserted to match once, then restored with `cp`:

```bash
SCRATCH="$PWD/.superpowers/sdd/history-w2-5b1/scratch"; mkdir -p "$SCRATCH"
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
cp "$F" "$SCRATCH/replay.t6.orig"
t() { (cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t "$1"); cp "$SCRATCH/replay.t6.orig" "$F"; }

# W1 (R26): readArmAnswers drops the reply.
mut "$F" "    return { qid: r.qid, arm: r.arm, outcome: r.arm_state, reply: r.reply, correct: r.correct };" "    return { qid: r.qid, arm: r.arm, outcome: r.arm_state, reply: null, correct: r.correct };"
t 'W2-5b1 Task 6'
# Expected RED (predicted): 1 failed; the judge re-derives q1's treatment answer from no reply and refuses out-refused
# answer-record-mismatch.

# W2 (W2-D79): a correct answer reaches the judge.
mut "$F" "      if (correct) { excluded.correct += 1; continue; }" "      if (correct) { excluded.correct += 1; }"
t 'W2-5b1 Task 6'
# Expected RED (predicted): 1 failed; four judge runs and four judged items.

cmp "$F" "$SCRATCH/replay.t6.orig" && echo restored && rm -f "$SCRATCH/replay.t6.orig"
```

Then the whole file, in the foreground, with a timeout of at least 600000 ms, and the commit of the one test:

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts
```

```bash
git add server/test/history-replay.test.ts
CO_AUTHORED_BY='<the Co-Authored-By line the attribution reminder gives>'
git commit -m "test(history-replay): the arms-then-judge walk over one --out (W2-5b1 Task 6; W2-D79, W2-D80; R21)" -m "$CO_AUTHORED_BY"
```

- [ ] **Step 2: The departures.** Write the checker as a quoted heredoc, so nothing in it expands:

```bash
mkdir -p .superpowers/sdd/history-w2-5b1/scratch
cat > .superpowers/sdd/history-w2-5b1/t6-dnum.mjs <<'EOF'
// Reads one plan file (argv[2]) and the W2 decisions document (argv[3]). For every number the plan's "## Deviations
// found" entries define, prints how often it is defined, its slug, the first task its entry names, the first task
// section that cites it, whether the two agree, and whether the decisions document names it. Reads only its arguments.
import { readFileSync } from 'node:fs';
const t = readFileSync(process.argv[2], 'utf8');
const dec = readFileSync(process.argv[3], 'utf8');
const lines = t.split('\n');
const at = t.indexOf('\n## Deviations found');
const body = at < 0 ? t : t.slice(0, at);
const sections = body.split(/\n(?=### Task \d+:)/).filter((p) => /^### Task \d+:/.test(p));
const ENTRY = /^- \*\*(D-\d+)\*\* — `([^`]+)` \(Tasks? (\d+)/;
const hits = lines.map((l) => ENTRY.exec(l)).filter(Boolean);
const defined = [...new Set(hits.map((m) => m[1]))];
console.log('deviations-section', at < 0 ? 0 : 1);
console.log('plan-defines', defined.length, defined.join(' ') || '-');
for (const d of defined) {
  const mine = hits.filter((m) => m[1] === d);
  const cites = new RegExp(`(^|[^0-9A-Za-z-])${d}(?![0-9])`, 'm');
  const first = sections.find((p) => cites.test(p));
  const firstTask = first ? /^### Task (\d+):/.exec(first)[1] : 'none';
  console.log(d, 'defined', mine.length, 'slug', mine[0][2], 'entry-task', mine[0][3], 'first-citing', firstTask,
    'agree', mine[0][3] === firstTask ? 1 : 0, 'in-decisions', cites.test(dec) ? 1 : 0);
}
EOF
PLAN=docs/superpowers/plans/2026-10-22-ccrc-history-w2-5b1-arms-and-judge.md
DEC=docs/superpowers/plans/2026-10-19-ccrc-history-w2-decisions.md
node .superpowers/sdd/history-w2-5b1/t6-dnum.mjs "$PLAN" "$DEC"
```

Expected:
- `deviations-section 1`;
- `plan-defines 4 D-6467 D-6468 D-6469 D-6470`, followed by every number issued to this run during the build (the count grows by one for each), each in the order its entry stands;
- one line per number, each `defined 1`, with its slug, `agree 1` and `in-decisions 0`: D-6467 `entry-task 1 first-citing 1`, D-6468 `2 2`, D-6469 `4 4` and D-6470 `5 5`.

Then the CONTROL: the same checker on a copy that ends with a synthetic entry, built at runtime and appended twice, must count it twice. The synthetic number is assembled from parts at runtime, so no tracked file spells it:

```bash
PLAN=docs/superpowers/plans/2026-10-22-ccrc-history-w2-5b1-arms-and-judge.md
DEC=docs/superpowers/plans/2026-10-19-ccrc-history-w2-decisions.md
node -e 'const fs=require("fs");const e="- **D-"+"1** — `t6-control` (Task 6; CONTROL)\n";fs.writeFileSync(process.argv[2], fs.readFileSync(process.argv[1],"utf8")+"\n"+e+e);' "$PLAN" .superpowers/sdd/history-w2-5b1/scratch/plan-control.md
node .superpowers/sdd/history-w2-5b1/t6-dnum.mjs .superpowers/sdd/history-w2-5b1/scratch/plan-control.md "$DEC" | grep -c "^D-$((0+1)) defined 2 "
rm -r .superpowers/sdd/history-w2-5b1/scratch
```

Expected: `1`.

Then the cross-tree checks: no other plan on `origin/main` defines a number this plan defines, and every number the PR cites bare is defined in some plan on `origin/main`. Both loops run over lists read from files, never over a range:

```bash
git fetch origin main
PLAN=docs/superpowers/plans/2026-10-22-ccrc-history-w2-5b1-arms-and-judge.md
DEC=docs/superpowers/plans/2026-10-19-ccrc-history-w2-decisions.md
DEFINED="$(node .superpowers/sdd/history-w2-5b1/t6-dnum.mjs "$PLAN" "$DEC" | sed -n 's/^plan-defines [0-9]* //p')"
for d in $DEFINED; do
  [ "$d" = - ] && continue
  git grep -l -F -e "- **$d** — " origin/main -- docs/superpowers/plans | grep -vxF "origin/main:$PLAN"
done; echo 'defined-elsewhere scan done'
CITED="$({ git diff -U0 origin/main...HEAD | grep '^+' | grep -v '^+++'; git log --format=%B origin/main..HEAD; cat "$PLAN"; } | grep -oE 'D-[0-9]+' | sort -u)"
printf 'cited %s\n' "$(printf '%s\n' $CITED | grep -c .)"
for d in $CITED; do
  case " $DEFINED " in *" $d "*) continue;; esac
  printf '%s %s\n' "$d" "$(git grep -l -E -e "^(- \*\*$d(\*\*| \()|### $d([^0-9]|$))" origin/main -- docs/superpowers/plans | wc -l)"
done | awk '$2 == 0'; echo 'bare-citation scan done'
d="D-$(date +%s)"; printf 'control %s\n' "$(git grep -l -E -e "^(- \*\*$d(\*\*| \()|### $d([^0-9]|$))" origin/main -- docs/superpowers/plans | wc -l)"
```

Expected:
- `defined-elsewhere scan done`, with no line before it. A planning-time number (D-6467, D-6468, D-6469, D-6470) is defined by this plan on `main` only; a build-time number is on no plan on `main` yet.
- `cited <c>`, the count of distinct numbers the PR and its plan cite; copy it into the PR body.
- `bare-citation scan done`, with no line before it: every number cited bare (D-5765 and D-5766 from W2-2a's plan, D-5767, D-5768 and D-5769 from W2-2b's, D-5774, D-5776, D-5777, D-5778 and D-5781 from W2-3's, D-5813, D-5814 and D-5984 from W2-4's, D-6280, D-6307, D-6309 and D-6311 from W2-5a's, D-6282, D-6283 and D-6284 from W2-2a's, D-5893, D-6178, D-6211 and D-6223, and any other a task cites) has a definition in some plan, in the em-dash, dated or heading form.
- `control 0`: the lookup answers 0 for a number no plan defines, so a printed `0` above is real.

Then the placeholder tokens. A concrete placeholder departure token anywhere in the tree, the commit messages or the plan means a departure was never resolved into a number:

```bash
PLAN=docs/superpowers/plans/2026-10-22-ccrc-history-w2-5b1-arms-and-judge.md
printf 'd-tbd-files %s\n' "$(git grep -I -l -E 'D-TB[D]-[a-z0-9]' | wc -l)"
printf 'd-tbd-messages %s\n' "$(git log --format=%B origin/main..HEAD | grep -cE 'D-TB[D]-[a-z0-9]')"
```

Expected: `d-tbd-files 0` and `d-tbd-messages 0`.

Three outcomes are findings to report to the coordinator, never something to fix here:
- a `defined` count above 1, or a second path for any number this plan defines;
- an `agree 0` (the fix is the owning task's citation, or the entry's task number, whichever the coordinator rules), or an `in-decisions 1` (this PR would define a decisions-document number, against W2-D4 and S1);
- a bare-cited number printed with `0`, or a placeholder token: the coordinator issues the number, and the commit that first cites it defines it.

- [ ] **Step 3: The spec and README are untouched, and E21's and E22's sentences stand.** From the repository root:

```bash
SPEC=docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md
git diff --name-only origin/main...HEAD -- "$SPEC" README.md | wc -l
sed -n 3p "$SPEC" | grep -c 'rev 3.6'
grep -cF "listing the quiz's families from the W2 open record (§8.2), and removes it after." "$SPEC"
grep -cF '  - `uncertain`: the answer states it does not know;' "$SPEC"
grep -cF 'Stated uncertainty versus fabrication is judged by an `opus` judge with a rubric, with 20% hand-checked.' "$SPEC"
grep -cF 'the card line, which the driver prepends to the treatment prompt.' "$SPEC"
```

Expected: `0`, then `1`, `1`, `1`, `1` and `1`. The first three sentences are E21's and E22's rev 3.6 text, which W2-5b2 amends in place (decisions §6, S1); this PR states their new reading only in its body. The last is the sentence the treatment payload implements (W2-D75, Q20): the card line, one blank line, then the control payload.

- [ ] **Step 4: The file list, growth, and what the PR's change can reach.** From the repository root:

```bash
PLAN=docs/superpowers/plans/2026-10-22-ccrc-history-w2-5b1-arms-and-judge.md
git diff --name-only origin/main...HEAD | grep -vxF -f <(printf '%s\n' deploy/history-replay.mjs server/test/history-replay.test.ts "$PLAN") || echo 'only W2-5b1 files'
git diff --name-only --diff-filter=A origin/main...HEAD | wc -l
git diff --name-only origin/main...HEAD -- ccd shared .github README.md CLAUDE.md deploy/history-gate.mjs deploy/measure-history.py docs/superpowers/specs docs/superpowers/programs docs/superpowers/plans/2026-10-19-ccrc-history-w2-decisions.md server/test/single-definition.test.ts server/test/lifecycle.test.ts server/test/growth-exemptions.json server/test/growth-waivers.json | wc -l
sed -n '/^const GROWTH_FILES = \[/,/^\] as const;/p' server/test/growth-check.test.ts | grep -oE "'[^']+'" | tr -d "'" > .superpowers/sdd/history-w2-5b1/growth-files.txt
wc -l < .superpowers/sdd/history-w2-5b1/growth-files.txt
grep -cxF deploy/history-replay.mjs .superpowers/sdd/history-w2-5b1/growth-files.txt
git diff --name-only origin/main...HEAD | grep -cxF -f .superpowers/sdd/history-w2-5b1/growth-files.txt
grep -nE "^import .* from '" deploy/history-gate.mjs | cut -d: -f1
git diff --stat origin/main...HEAD -- deploy/history-replay.mjs server/test/history-replay.test.ts | tail -1
```

Expected:
- `only W2-5b1 files`. The plan path is listed because a build-time number, or a corrected prediction, is recorded in it.
- `0`: no file is created (W2-D5).
- `0`: no never-touch path changed.
- `9`, then `0`, then `0`: the growth list has nine files, `deploy/history-replay.mjs` is not one of them, and the PR touches none of them, so the armed growth check has nothing of this PR's to measure.
- one line number for the gate's single import line (about 23). With the gate and lib unedited, `measure-history.test.ts` is not required.
- the two files' insertion and deletion totals, copied into the PR body's "How it was measured".

Any other path is a finding against the task that added it: report it, never revert it here.

- [ ] **Step 5: The carries and must-holds by content, and the added lines.** Write the two readers as quoted heredocs:

```bash
cat > .superpowers/sdd/history-w2-5b1/t6-carries.mjs <<'EOF'
// Reads deploy/history-replay.mjs as text, never imports it, and prints counts and names only.
import { readFileSync } from 'node:fs';
const src = readFileSync('deploy/history-replay.mjs', 'utf8');
const lines = src.split('\n');
const isComment = (l) => /^\s*(\/\/|\/?\*)/.test(l);
// W2-D42: an arm word in quotes of any kind, on any line, comments included (W2-2b's ARM_WORD), and how many of those
// lines are code lines, the lines Task 1's own scan reads (a comment line is report-only here).
const ARM_WORD = /(['"`])(?:control|treatment)\1/;
const armHits = lines.filter((l) => ARM_WORD.test(l));
console.log('arm-word-lines', armHits.length, 'on-code-lines', armHits.filter((l) => !isComment(l)).length);
// O13: the marker's path text, on any line.
console.log('headless-on-path-lines', lines.filter((l) => l.includes('/headless-on')).length);
// O13's symbolic arm: single-definition's VERB and switch symbols, on any line (stricter than its code-only scan).
const VERB = /\b(?:writeFile|appendFile|rename|unlink|rm|rmdir|mkdir|copyFile|cp|symlink|link|truncate|open)(?:Sync)?\s*\(/;
const SYM = /SWITCHES\.|\.(?:off|cap|maxGb|steerOff|steerLivePrefix|steerOnDir|headlessOn)\b/;
const pairs = (l) => { const m = VERB.exec(l); return m !== null && SYM.test(l.slice(m.index + m[0].length)); };
console.log('switch-write-lines', lines.filter(pairs).length);
// W2-D84, W2-D78 (i): every code line naming the marker's path is its one bounded read (W2-2b's ONE_READ).
const ONE_READ = /\breadBounded\([^,]*\.headlessOn, (?:[A-Za-z_$][\w$]*\.)?HEADLESS_LIST_MAX_BYTES, false\)/;
const named = lines.filter((l) => !isComment(l) && /\.headlessOn\b/.test(l));
console.log('headlessOn-code-lines', named.length, 'not-the-one-read', named.filter((l) => !ONE_READ.test(l)).length);
console.log('recall-off-lstat-lines', lines.filter((l) => l.includes('lstatSync(recallOffPath(')).length);
console.log('ab-only-message', src.includes('this build verifies ab only') ? 1 : 0);
// W2-D12: the names this PR imports are declared by their owners, never again here.
const IMPORTED = ['RECALL_ARMS', 'HEADLESS_LIST_MAX_BYTES', 'parseHeadlessList', 'formatHeadlessList', 'headlessMarkerOf', 'cardLine',
  'displayPrefixes', 'asOfCut', 'asOfBinds', 'asOfHiddenNodesSql', 'asOfVisibleEntriesSql', 'asOfCutOf', 'isHistoryCommand',
  'ASSIGNMENT_ARMS', 'classifyRun', 'questionOutcome', 'RUBRICS', 'RUBRIC_SHA256', 'parseLabelLine', 'parseAnswerField', 'labelCorrect',
  'handcheckSample', 'decideGate'];
const defines = (n) => new RegExp(`^\\s*(?:export\\s+)?(?:(?:async\\s+)?function\\*?\\s+${n}\\s*\\(|(?:const|let|var)\\s+${n}\\s*=)`);
const redefined = IMPORTED.filter((n) => lines.some((l) => defines(n).test(l)));
console.log('redefined', redefined.length, redefined.join(' ') || '-');
const mods = [...src.matchAll(/^import [^;]*? from '([^']+)';$/gm)].map((m) => m[1]);
console.log('modules', mods.length, mods.join(' '));
console.log('env-code-lines', lines.filter((l) => !isComment(l) && l.includes('process.env')).length);
EOF
cat > .superpowers/sdd/history-w2-5b1/t6-live.mjs <<'EOF'
// Imports the driver, the gate and lib from the repository root (the cwd) to read constants. The driver's entry guard
// is false here (argv[1] is this script); importing it runs cli.mjs's umask in this process and nothing else.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const at = (p) => import(pathToFileURL(path.resolve(p)).href);
const [d, g, l] = await Promise.all([at('deploy/history-replay.mjs'), at('deploy/history-gate.mjs'), at('ccd/history/lib.mjs')]);
console.log('handlers', [...d.HANDLERS.keys()].sort().join(' '));
console.log('reasons', d.DRIVER_REASONS.length, d.DRIVER_REASONS.slice(29).join(' ') || '-');
console.log('code-files', JSON.stringify(d.CODE_SHA_FILES), d.CODE_SHA_FILES === g.GATE_CODE_FILES ? 'same' : 'copy');
console.log('flags', Object.keys(d.FLAG_SPECS).length);
const a = [...g.ASSIGNMENT_ARMS].sort().join(' ');
const r = [...l.RECALL_ARMS].sort().join(' ');
console.log('arm-sets', a === r ? 'equal' : 'differ', 'gate-order', g.ASSIGNMENT_ARMS.join(' '));
console.log('marker-bound', l.HEADLESS_LIST_MAX_BYTES, 'judge-substream', g.SUBSTREAMS.includes('judge-order') ? 1 : 0);
EOF
node .superpowers/sdd/history-w2-5b1/t6-carries.mjs
git show origin/main:deploy/history-replay.mjs | grep -oE "^import .* from '[^']+';$" | sed -E "s/.* from '([^']+)';$/\1/" | tr '\n' ' '; echo
node --no-warnings .superpowers/sdd/history-w2-5b1/t6-live.mjs
```

Expected, from `t6-carries.mjs` (the base's own figures, measured at planning time at `c34f82830`, in brackets):
- `arm-word-lines 0 on-code-lines 0` (`2` and `2` at the base: `quizPopulation` and `abStateOf`). W2-D42's scan is Task 1's, over code lines, as a quoted word, an object key or a member name; this reader is a second, report-only reading, stricter on comments and looser on keys. A hit on a code line is a finding against the task whose line it is (Task 1's pin should have red on it). A hit on a comment line only, which Task 1's scan does not read by design (its residual), is reported to the coordinator, never a finding against the owning task.
- `headless-on-path-lines 0` (0).
- `switch-write-lines 0` (0). This reads comment lines too, so it is stricter than O13's scan: a comment that trips it is reworded by its owning task.
- `headlessOn-code-lines <m> not-the-one-read 0`, with `m` at least 1 (0 and 0 at the base): Task 3's marker reader is the one read, at `HEADLESS_LIST_MAX_BYTES` with no link followed, and no code line opens, stats or tests the marker's path any other way.
- `recall-off-lstat-lines 1` (1): O13's recall-off case pins exactly one.
- `ab-only-message 0` (1): `verify --section pilot|quiz` is served (Task 3).
- `redefined 0 -` (0): no imported name is declared in the driver; single-definition's definers scans red on a second declaration of the lib ones too.
- `modules 14`, then the fourteen specifiers in the base's order (`node:fs node:os node:path node:child_process node:url node:crypto ../ccd/history/lib.mjs ../ccd/history/store.mjs ../ccd/history/derive.mjs ../ccd/history/recall.mjs ../ccd/history/cli.mjs ../ccd/history/sweep.mjs ./history-gate.mjs ../shared/roster-json.mjs`), the same list as the line `git show` prints for `origin/main`. W2-5b1 adds names inside braces, never a module (D-5814's pin takes the names); a new module is a finding against Task 1 unless its Interfaces name it.
- `env-code-lines 1` (1): the entry guard's by-name projection stays the driver's one `process.env` line.

From `t6-live.mjs`:
- `handlers arms freeze judge marker open pilot-source power probe quiz-source step0a verify` (S1, Q1);
- `reasons 29 -`: no task adds a driver word (R11);
- `code-files ["deploy/history-gate.mjs","deploy/measure-history.py","deploy/history-replay.mjs","ccd/history/lib.mjs"] same`;
- `flags 50`: 49 at the base plus Task 1's `allow-code-change`; copy it into the PR body;
- `arm-sets equal gate-order treatment control`: S2's C9, set equality, with the gate's order unchanged because `handcheckSample` iterates it;
- `marker-bound 65536 judge-substream 1`.

Then the added lines. The block prints counts only:

```bash
added() { git diff -U0 origin/main...HEAD -- deploy/history-replay.mjs server/test/history-replay.test.ts | grep '^+' | grep -v '^+++'; }
PLAN=docs/superpowers/plans/2026-10-22-ccrc-history-w2-5b1-arms-and-judge.md
printf 'citations %s\n' "$(added | grep -cE 'ccd:[0-9]{3,5}\b|\.(ts|tsx|mjs|sh):[0-9]+\b')"
printf 'shells %s\n' "$(added | grep -cE 'shell: *true|execSync\(|[^.A-Za-z_]exec\(')"
printf 'driver-env %s\n' "$(git diff -U0 origin/main...HEAD -- deploy/history-replay.mjs | grep '^+' | grep -v '^+++' | grep -c 'process\.env')"
printf 'live-home %s\n' "$(added | grep -cE 'homedir\(|process\.env\.HOME')"
printf 'real-binaries %s\n' "$(added | grep -cE '(spawn|spawnSync|execFile|execFileSync)\( *.(claude|ccd|ccrc|gh|sqlite3).[,)]')"
printf 'key-literals %s\n' "$(added | grep -cE 'AKIA[0-9A-Z]{16}|sk-ant-[A-Za-z0-9_-]{10,}|gh[opsu]_[A-Za-z0-9]{20,}|xox[abp]-[0-9A-Za-z-]{10,}')"
printf 'sqlite-specifier %s\n' "$(git diff -U0 origin/main...HEAD -- deploy/history-replay.mjs | grep '^+' | grep -v '^+++' | grep -cE "(['\"\`])node:sqlite(['\"\`])")"
printf 'escapes %s\n' "$(added | grep -cF '\u')"
printf 'd-ranges %s\n' "$({ added; git log --format=%B origin/main..HEAD; cat "$PLAN"; } | grep -cE 'D-[0-9]+ *(\.\.|–|-|to) *(D-)?[0-9]+')"
```

Expected: every count `0`.

| Count | What a non-zero means | Where the fix goes |
|---|---|---|
| `citations` | a numeric line citation was added (D-5893's ratchet) | the task that added it rewrites it as a symbol citation (`file.mjs#name`) |
| `shells` | a shell or a command string (CodeQL's `js/shell-command-injection-from-environment`) | the owning task |
| `driver-env` | a second `process.env` line in the driver | the owning task; W2-4's env scan pins the projection line as the only one |
| `live-home` and `real-binaries` | a test that could reach a live home or a real binary; every arm and judge spawn goes to the stub | the owning task, before any push |
| `key-literals` | a key-shaped literal | assemble it at runtime from parts |
| `sqlite-specifier` | a quoted `node:sqlite` in the driver | the driver's prose must not quote it: W2-4's scan reds a quoted mention even in a comment |
| `escapes` | a backslash-u escape in an added line; non-ASCII fixtures are built with `String.fromCharCode` (an agent's file write decodes such escapes, so the file would not hold what the plan says) | the owning task |
| `d-ranges` | a D-number range | rewrite it as a list |

Then quick focused runs over the scans that read `deploy/`, before the long suites. Each `-t` is regex-safe, and each selects the named cases:

```bash
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'recall-off/<id>: exactly one writer'
```
```bash
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'headless-on: named on a code line only'
```
```bash
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'pairs a write verb with a switch symbol'
```
```bash
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'the headless marker and the arm words are defined once'
```
```bash
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'the as-of cut is defined once'
```
```bash
cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts -t 'declares history-replay-out'
```

Expected:
- the first: `1 passed`, plus skips: O13's recall-off case, with the driver's single `lstatSync(recallOffPath(` line;
- the second: `1 passed`: O13's `headless-on` row, whose holders stay `['ccd/history/lib.mjs']`, so no driver code line spells the path;
- the third: `1 passed`: the symbolic write scan over every `.mjs` under `ccd/`, `deploy/` and `shared/`;
- the fourth: `4 passed`: W2-2b's describe, whose definers case reads `deploy/` too, so the driver declares none of `parseHeadlessList`, `formatHeadlessList` and `headlessMarkerOf`;
- the fifth: `2 passed`: W2-2a's definers, which read `deploy/`, so the driver declares no `asOfCut`, `asOfBinds` or as-of statement;
- the sixth: `1 passed`. The case imports the driver, and with it every name Tasks 1 to 5 import, in the lifecycle worker.

A run that reports only skipped tests selected nothing, and its step is not green.

- [ ] **Step 6: The must-holds by title.** List every test title once, then count, per must-hold, the W2-5b1 titles that name it. From the repository root, in the foreground, with a Bash timeout of 600000 ms:

```bash
cd server && ./node_modules/.bin/vitest list test/history-replay.test.ts > ../.superpowers/sdd/history-w2-5b1/titles.txt
```

Then, from the repository root:

```bash
T=.superpowers/sdd/history-w2-5b1/titles.txt
printf 'titles %s w2-5b1 %s\n' "$(grep -c . "$T")" "$(grep -cF 'W2-5b1 Task' "$T")"
while IFS='|' read -r row frag; do
  printf '%s %s\n' "$row" "$(grep -F 'W2-5b1 Task' "$T" | grep -cF -- "$frag")"
done <<'EOF'
H1|family-unlisted
H2|recall-off
H3|quiz-unanswerable
H4|version-move
H5|spend share
H6|no spawn
H7|RP1-arm
H8|byte for byte
H9|card line
H10|parent
H11|arm word
H12|ASSIGNMENT_ARMS
H13|arm token
H14|never reaches the judge
H15|judge-failed
H16|RP1-judge
H17|RP3-judge
H18|classified exactly once
H19|not-run
H20|round trip
H21|O13
H22|verify --section
H23|code-changed before any other input is read
H24|before --out
H25|D-6309
EOF
```

Expected: `titles <t> w2-5b1 <u>`, with `u` at least 1, then each row `H<n> <count>` with count at least 1. The rows are scope.md C's must-holds for W2-5b1, by the task that owns each pin (the plan's File Structure governs where it differs):

| Row | Must-hold | Decision or ruling | Task |
|---|---|---|---|
| H1 | no arm spawn unless every (ccrc_id, generation) in the batch is listed in headless-on for this store | W2-D78 (i), W2-D44 | 4 (Task 3's reader) |
| H2 | no arm spawn for a family with a `recall-off/<id>` entry | W2-D78 (ii) | 4 |
| H3 | each question re-checked (redaction, answerability, the frozen source visible under `asOfCutOf`), refused naming its qid and clause; the cut-mutant CONTROL; a payload that no longer reconstructs refused | W2-D78 (iii), Q21, D-6468, D-6469 | 2, 4 |
| H4 | the version preflight against part 1, or the newest version-move amendment, on a hand-built amended record | W2-D56, W2-D90's read | 4 |
| H5 | `batchGate` with the record's limits and the node's spend share (`budget-exhausted`) | W2-D55, Q5 | 4, 5 |
| H6 | each W2-D78 refusal and each refusal before `--out` with the stub's log absent (a W2-D56 refusal leaves only the `--version` line) | W2-D78's pins | 4 |
| H7 | RP1-arm: the exact env keys, with real ARM values from `RECALL_ARMS` | W2-D50, W2-D42 | 4 |
| H8, H9 | the control payload byte-identical to W2-5a's composer; the treatment payload is the card line, one blank line, then the control payload | W2-D75, Q20 | 2 |
| H10 | the card never names a parent hidden under `asOfCut(N)`; the CONTROL, a parent formed after N | W2-D75, W2-D35 (D-6282, D-6283, D-6284) | 2 |
| H11, H12 | the driver never spells an arm word; its sets equal the gate's `ASSIGNMENT_ARMS` | W2-D42, S2 (C9) | 1 |
| H13, H14, H15 | judge stdin and names carry no arm token; a correct answer never reaches the judge; malformed twice is `judge-failed` | W2-D79 | 5 |
| H16, H17 | RP1-judge and RP3-judge | W2-D79, W2-D50 | 5 |
| H18 | every `DRIVER_REASONS` word classified once, stop or refusal | W2-D80, W2-D59, Q24 (C6) | 1 |
| H19 | a stop never consumes the re-run: the question is `not-run` | W2-D80, Q4 | 1, 4 |
| H20, H21 | `marker` writes nothing and round-trips; no driver line spells `/headless-on` or pairs a write verb with `.headlessOn` | W2-D84, O13 | 3 |
| H22 | `verify --section pilot|quiz`: the headless-on bytes' sha against the marker's | W2-D84 | 3 |
| H23 | every `--record` consumer of this PR re-checks `gate_code` before any other input | W2-D24, R23 | 3, 4, 5 |
| H24 | a refusal that needs no store and no spawn answers before `--out` is made | W2-5a's R10 | 1, 3, 4, 5 |
| H25 | a data case after `--out` never exits INTERNAL; part 2's `spend_budget` and every part-2 field a consumer reads are range-checked before `--out` | D-6309's rule, S2 (C22), R4 | 1, 3, 4, 5 |

A row that reads `0` is not yet a finding (R22): read the owning task's cases for the pin. If it is there under other words, copy its title into the PR body's Pins and say so. If no case pins it, report the row to the coordinator as a finding against the owning task; this task never adds a case.

Then the re-check rows, verbose. The filter has no metacharacter but `-`:

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts --reporter=verbose -t 'code-changed before any other input is read'
```

Expected: every selected case passes, W2-5a's six rows and this PR's nine (R23), each title ending in its form: `marker --section pilot`, `marker --section quiz`, `marker --section ab`, `verify --section pilot`, `verify --section quiz` (Task 3), `arms --section pilot`, `arms --section quiz` (Task 4; skipped on darwin), `judge --section pilot` and `judge --section quiz` (Task 5): W2-D24's list for W2-5b, the part this PR ships. A consumer with no row is a finding against its task. Copy the selected titles into the PR body's Pins.

- [ ] **Step 7: The PR's own suite, whole, in one process.** From the repository root, in the foreground, with a Bash timeout of 600000 ms:

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts
```

Expected: `Test Files  1 passed (1)`, every case passed or skipped. The skips are the root-only cases (`process.getuid() === 0`) and the darwin-only rows; at `c34f82830`, on a non-root Linux box, W2-5a's final tip measured `773 passed (773)`, so the count here is that plus Tasks 1 to 6's cases, less any W2-5a case a task re-pinned in place. Among the passes: W2-4's pins (RP1-contract, RP2, RP3-admission, RP4, RP9, the limits parity, step 0a and the probe), W2-5a's (RP5, RP1-writer, RP3-writer, both parity pins, each `--record` re-check), and Tasks 1 to 5's must-holds (Step 6's table). Copy the summary lines (`Test Files …`, `Tests …`, `Duration …`) as printed.

Then the parity pins W2-5a carried, and the W2-5b1 describes, on their own:

```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'CODE_SHA_FILES parity|flags_accepted parity'
```
```bash
cd server && ./node_modules/.bin/vitest run test/history-replay.test.ts -t 'W2-5b1 Task'
```

Expected: every selected case passes; the first selects at least one case for each fragment (the `|` is the filter's one deliberate metacharacter), and the second selects the `w2-5b1` count Step 6 printed, less the root-only and darwin-only skips.

A red here is never re-run into green by changing a fixture's expectation. If the file is red under load, re-run it alone once, and report both results. Any red that remains is a finding against the task whose case it is.

- [ ] **Step 8: The whole-PR checks.** From the repository root, each in the foreground with a timeout of at least 600000 ms, **one tool call per block**: never two suites in one call, never a loop, never a background run. Re-run a red file alone before calling it a break (CLAUDE.md's load flakes).

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
- **`lifecycle`** green whole. Its `history-replay-out` case imports the driver in-process, so the driver's whole import graph runs in that worker. A red there belongs to the task that added the import. `lifecycle.test.ts` is never edited.
- **`single-definition`** green whole: every scan that reads `deploy/` (Step 5's focused runs), O14's `DECL_CORPUS` (no `deploy/*.mjs` declares a `VOCABS` name, `RECALL_ARMS` and the two marker bounds included: W2-D12, D-5774), and the rest of the file, which this PR cannot reach.
- **`docs-policy`** green (a control: it reads nothing W2-5b1 changes).
- **`topology-clean`** green. Its walk reads every tracked file, the new fixtures included, so a red names a host-shaped, address-shaped or id-shaped token: rewrite the fixture, never the scanner.
- **`citations`** green, both the ceiling and "the lines this branch adds hold no numeric line citation".
- **`growth-check`** green with its rows measured, not skipped: the run needs `origin/main`, fetched above. Every listed file's row reads delta 0 for this PR, `GROWTH_OVER` is empty, and no exemption or waiver is consulted (Choices).
- **`ci-pipeline`** green. The node-floor heredoc still lists exactly the history test files, because the PR adds none (W2-D5).
- **`dtbd`** green.
- **`deviation-refs`** green against `origin/main` without merging: no allocator-era number is defined in two plans across this branch and its base. A red names the number. Report it to the coordinator, and never renumber one.
- Both **`tsc`** runs print nothing. The test project types `history-replay.test.ts`'s new imports from lib, through W2-2b's `lib.d.mts` declarations, and from the gate and the driver with `allowJs`.

Copy each `Test Files … | Tests …` line, and both `tsc` exits, into the PR body. If Step 4 showed the gate's import line moved, or `lib.mjs` changed in this PR, add one more block, `cd server && ./node_modules/.bin/vitest run test/measure-history.test.ts`, which must be green.

- [ ] **Step 9: The private-name, host and home-path checks.** Write `.superpowers/sdd/history-w2-5b1/pr-body.md` first (Step 11's text). Then, from the repository root, run the block below. It prints counts only:

```bash
TITLE='ccrc history wave W2-5b1: the arms and the judge'
BODY=.superpowers/sdd/history-w2-5b1/pr-body.md
PLAN=docs/superpowers/plans/2026-10-22-ccrc-history-w2-5b1-arms-and-judge.md
LIST="$(git rev-parse --path-format=absolute --git-common-dir)/info/ccrc-private-names"
test -s "$LIST" && echo 'list present' || echo 'LIST MISSING'
cut -f2 "$LIST" | grep -v '^#' | head -1 | grep -c -i -w -F -f <(cut -f2 "$LIST" | grep -v '^#')
corpus() { git diff -U0 origin/main...HEAD | grep '^+' | grep -v '^+++'; git log --format=%B origin/main..HEAD; printf '%s\n' "$TITLE"; cat "$BODY" "$PLAN"; }
corpus | grep -c -i -w -F -f <(cut -f2 "$LIST" | grep -v '^#')
prtext() { git diff -U0 origin/main...HEAD -- deploy/history-replay.mjs server/test/history-replay.test.ts | grep '^+' | grep -v '^+++'; git log --format=%B origin/main..HEAD; printf '%s\n' "$TITLE"; cat "$BODY"; }
prtext | grep -cE '([0-9]{1,3}\.){3}[0-9]{1,3}|\.ts\.net|/home/[^u/]|/home/u[A-Za-z0-9_-]|/Users/|/root/|/mnt/'
printf '%s\n' '/home/you/tree' '/home/u/tree' "'/home/u'" 'names(/home/u)' 'paths are /home/u fixtures' | grep -cE '/home/[^u/]|/home/u[A-Za-z0-9_-]'
```

Expected:
- `list present`;
- `1`: the CONTROL. The list's own first name is found by the same pattern, so the list is read and the match is live;
- `0`: no private name in any added line, message, the title, the body or the plan;
- `0`: no address, tailnet name or home path in the two files' added lines, the messages, the title or the body. The plan is left out of this count on purpose: this step's own pattern and CONTROL, which the plan prints, would match it. Fixture paths are `/home/u/…`, and the tests also pass the bare fixture HOME `'/home/u'`; the pattern admits `/home/u` followed by `/`, a quote, a space, `)` or the end of a line, and refuses any other home;
- `1`: the home-path CONTROL. The pattern sees the non-fixture home and admits the four fixture shapes.

A non-zero count is judged by its line numbers only, never by printing a token. Re-run the same pipeline with `grep -n -i -w -F -f <(cut -f2 "$LIST" | grep -v '^#') | cut -d: -f1`, or `grep -nE … | cut -d: -f1` for the second, then read those lines and rewrite each hit with a neutral stand-in before any push. A hit in a commit message needs a new commit history on this branch (an amended or reworded commit before the first push), which the worker asks the coordinator about first. A hit in the plan (on `main` already) is reported to the coordinator. After a push, GitHub keeps every revision.

- [ ] **Step 10: Confirm the tree holds only this PR's work.** Run `git status --short`. It must list nothing. Every task committed its work, the scratch sits under the ignored `.superpowers/`, and no fixture directory was left in the checkout. No step read or wrote a live `~/.ccrc`. No step ran `claude`, `ccd`, a `ccrc` verb, the shim, `sweep.mjs`, `cli.mjs`, `history-gate.mjs` or `measure-history.py` against a live home.

- [ ] **Step 11: Write the PR body.** Write `.superpowers/sdd/history-w2-5b1/pr-body.md` with the text below, using the Write tool, never a shell heredoc. Then replace its six parenthesised lines with what the steps measured:
- under `### In-place edits of earlier cases (R27)`: Task 2's line, either the case's title Task 2 Step 5 edited (from Task 2's commit message) or `Task 2: none needed (no W2-5a case pins the whole count object)`;
- under `### Departures`: one line per number Step 2's checker printed, each as its `## Deviations found` entry states it (number, slug, task, one-line why), or the single line `None.`;
- under `Cited bare`: Step 2's bare-cited numbers, grouped by the plan that defines each;
- under `### Rulings made in the operator's place`: each ruling the coordinator made while this plan was reviewed or during the build, one line each, with its date, or `None beyond S1, S2 and the Q rulings above.`;
- under `### Must-holds and their pins`: the case titles Step 6 counted or found, one per row, and Step 6's re-check rows;
- under `### Tests run`: Steps 5, 7 and 8's summary lines, as printed.

Every other line is final.

```markdown
## ccrc history wave W2-5b1: the arms and the judge

Spec: `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md` (rev 3.6, amended in place by W2-1; **not edited here**): §10.2's replay eval ("Two arms", the as-of seam, "Account and budget", "Scoring") and its pins RP1 (arm, judge) and RP3 (judge).
Decisions: `docs/superpowers/plans/2026-10-19-ccrc-history-w2-decisions.md`, §2's "W2-5b (deploy)" entry as the coordinator split it (S1: this PR, then W2-5b2), and W2-D6, W2-D18, W2-D24, W2-D42, W2-D50, W2-D54, W2-D55, W2-D56, W2-D59, W2-D64, W2-D75, W2-D76, W2-D78, W2-D79, W2-D80, W2-D82 and W2-D84. Rulings: S1, S2 and Q1 to Q31 of the coordinator's W2-5b rulings, the ones this PR takes listed below. Plan: `docs/superpowers/plans/2026-10-22-ccrc-history-w2-5b1-arms-and-judge.md`.

W2's replay eval asks each frozen question of two arms, control and treatment, that differ only in the recall arm and the card line, and has a judge label every answer that is not correct. This PR is the first of W2-5b's two serial PRs on the deploy lane, after W2-5a (#1134) and W2-2b (the headless seam). It ships the machinery: the marker, the headless-on half of `verify`, the arm engine and the judge. The pilot, the amendments, the hand-check and the verdict are W2-5b2's. Every spawn in the tests goes to a recording stub; nothing here runs against a live store or a real model.

### What ships

- **The foundations (Task 1).** The driver never spells an arm word: the two sites that did are positional constants from lib's `RECALL_ARMS`, and its arm set equals the gate's `ASSIGNMENT_ARMS` as a set, the gate's order unchanged (W2-D42; S2, C9). Every `DRIVER_REASONS` word is classified once, as a stop or a refusal, so a question a stop leaves unspawned or cuts off is `not-run` and never consumes its re-run (W2-D80, W2-D59; the decisions document's §7 residual; Q24). The stream reader records `parent_tool_use_id`, so a tool call inside an Agent subagent is attributed (`via_agent`), and spend charges fail closed: the larger of the result event's usage and the sum of every assistant message's usage, subagent messages included, both recorded (the C6 under-count; Q7). Part 2 is loaded with its chain and range-checked before `--out` is made, `spend_budget` and every part-2 field a consumer reads included (D-6309's rule; S2, C22). `--allow-code-change` is accepted by `arms` and `judge` after window start only, and stamps every output (W2-D24, W2-D6; Q23).
- **The payloads (Task 2).** The control payload is W2-5a's `composePayload` output, byte for byte. The treatment payload is the card line, one blank line, then the control payload (W2-D75; Q20). The card is lib's `cardLine` over boundary N's leaf, with display prefixes over the family's whole node-id set, and names leaf N's parent only when lib's `asOfHiddenNodesSql`, bound under `asOfCutOf(N)`, does not hide it, so the card never names a node the arm's own cut answers exit 3 for (W2-D35 as amended, D-6282, D-6283 and D-6284, never a second copy). W2-D78 (iii)'s re-check: the one redaction screen (F_raw, F and the leaf), answerability over leaf N's span, and the frozen source entry visible under `asOfCutOf(boundary_uuid)` (Q21). The two parity pins W2-5a carried, the driver's same-millisecond predicate and its kept(N) members against lib's cut, with the unreadable-kept-list CONTROL (Q22).
- **`marker --section pilot --record <draft>` and `marker --section quiz|ab --record <final>` (Task 3; W2-D84, W2-D76, D-5781).** It prints per node and writes nothing. For `pilot` and `quiz`: the exact headless-on text from lib's `formatHeadlessList`, with its store line, and its sha256; a list the formatter refuses (over 64 KiB or 1,000 pairs) is a refusal, never INTERNAL. For `ab`: one `ccrc history recall-off <id> --generation <G>` line per control family. The round trip `parseHeadlessList(formatHeadlessList(x))` is pinned, and the fixture HOME's history directory is byte-identical after a run.
- **`verify --section pilot|quiz` (Task 3; W2-D84's second half).** Read-only: the headless-on bytes, read once through `readBounded(historyPaths(home).headlessOn, HEADLESS_LIST_MAX_BYTES, false)` with no link followed, against the marker's sha; each mismatch kind reported. No driver line spells the marker's path or pairs a write verb with it (O13).
- **`arms --section pilot|quiz` (Task 4).** Part 1 for the pilot, part 2 for the quiz. Before every batch, read-only and before any spawn: (i) every (ccrc_id, generation) in the batch is listed in headless-on for this store, parsed with lib's `parseHeadlessList`, or `family-unlisted`; (ii) no `recall-off/<id>` for any batch family, or `family-recall-off` (W2-4's one `lstat` line); (iii) each question re-checked, or `quiz-unanswerable` naming the qid and the clause (W2-D78), and each payload reconstructed, or `quiz-unanswerable` `<qid> payload <word>` (D-6469); the version, release stamp, wrapper and code shas against part 1, the version against the newest version-move amendment when there is one (W2-D56, W2-D6); and `batchGate` with the record's limits and this node's spend share, ceil(spend_budget × node questions / all questions), printed (W2-D55; Q5). Each refusal leaves the stub's log absent. Both arms of a question run side by side, at the record's concurrency (2), `batch_max / 2` questions per batch (five per 10-job batch) in frozen qid order, the batches looping inside one invocation with the preflight before each (Q3). Each spawn carries RP1-arm's exact env, with the ARM value from `RECALL_ARMS` and ASOF the boundary's uuid (W2-D50). Run names are per attempt; a driver timeout is `infra-failed`; a question is re-run once as attempt 2, and a second failure is `run-failed` (W2-D80; Q4). A per-batch manifest records the preflight's measured version and the batch's run names (Q14), and each (qid, arm) answer record carries the answer field, `labelCorrect`'s verdict, the uptake facts with `via_agent` (W2-D82) and whether the ANSWER line was absent (W2-D64); each attempt records every `error` field its run printed (Q31). The batch summary prints the stop word and the not-run count, and nothing is retried automatically (Q30). Arms run per node, in that node's `--out` (Q2), and read part 2's `pilot_result.settings_mode` (Q26).
- **`judge --section pilot|quiz` (Task 5; W2-D79, W2-D54, W2-D18).** One spawn per non-correct (qid, arm), through W2-4's judge mode (RP1-judge, RP3-judge). Its stdin is canonical `{v: 1, kind, question, expected, answer_field, reply}`, the reply and the answer field each redacted whole and then capped at 16 KiB (the field's cap, D-6470). The items are sorted by (qid, arm) and shuffled on the `'judge-order'` substream; each gets a positional id (`judge/j0001` …), and the id-to-(qid, arm) map lives in its own file, so no stdin and no file name carries an arm token (Q18). A correct answer never reaches the judge. A malformed reply, or a failed run, is retried once with identical input; malformed twice is `judge-failed`. Each judge attempt records every `error` field its run printed, as each arm attempt does, so every run's are recorded (Q31). A question either arm of which is run-failed is settled and excluded from both arms, even while its other arm's record still reads `rerun` or `not-run` (W2-D80, R14). The judge makes the refusals `arms` makes before `--out`: an unusable HOME or `--out`, a judge model that is not an exact Opus id, a budget or limits out of range (D-5813, D-6309's rule). The arms' answer records reach it through Task 4's `readArmAnswers`, and Task 6's walk runs the two over one `--out`.
- **W2-D24's re-check** before any other input is read, in each of this PR's `--record` consumers: `marker`, `verify --section pilot|quiz`, `arms` and `judge`.

Two files: `deploy/history-replay.mjs` and `server/test/history-replay.test.ts`, plus this wave's plan where a build-time number or a corrected prediction is recorded. There is no new file (W2-D5), and no change to `ccd/**`, `shared/**`, the spec, README, `deploy/history-gate.mjs`, `deploy/measure-history.py` or `.github/**`. The driver is not a growth-check file, so its growth needs no exemption or waiver (D-6178, D-6223).

### In-place edits of earlier cases (R27)

W2-5a's cases are edited in place in only the spots the coordinator's R27 licenses, because Q23 and the new `verify` sections force them, each named in its task's commit:
- Task 1: W2-5a Task 7's `no W2-5a subcommand takes --allow-code-change` now expects `checkFlags`' `--allow-code-change is not a <form> flag` line, where the grammar answered `unknown flag` before Q23 declared the flag.
- Task 3: one line of W2-5a Task 7's `open wants exactly one mode, and verify exactly one of --registry and --section ab`: `verify --section quiz` is now a section `verify` reads, so the line asks `--section judge` and expects `verify reads ab, pilot or quiz`.
(Task 2: the W2-5a case `'card-unrenderable': 0` was added to, by its title, or "Task 2: none needed (no W2-5a case pins the whole count object)")

No W2-5a W2-D24 re-check case is edited: each of this PR's `--record` consumers adds its own rows under W2-5a's titles (R23). W2-4's re-pins (the `FLAG_SPECS` pin, three stream cases, `T5_RECALL`, D-5814's recall.mjs entry, the probe spend and the `HANDLERS` key line) are listed in the plan's header.

### What W2-5b2 carries (S1)

- `step0b`: the turn bound, counting main-thread messages through the reader's `messages` (R1), persistence, the arm init and W2-D58's treatment-arm assertions (W2-D57; Q11), recording `error_max_turns` (W2-D57's amendment) and the settings-mode halt (Q26).
- `fidelity`, in box mode with no marker, checked against part 1's pilot (W2-D76; Q8, Q9); the usage pilot through this PR's arms and judge, and its extrapolation (W2-D55; Q6); `pilot-result`, the producer of the shape W2-5a reads (W2-5a's R8), and what a failed pilot is (Q10); the pilot's measured relation between the two spend readings (Q7).
- `open --finalize` deriving `spend_budget` and refusing a mismatch (D-6280), and refusing a failed pilot without `--accept-failed-pilot` (Q27); `open --amend` with its detail schemas (W2-D90; Q12, Q13), whose version-move entry this PR's version preflight already reads (pinned on a hand-built amended record).
- W2-D56's half-done re-run: after a version re-pilot, both arms of every question with only one arm done are re-run on the new version (the scoping study's C19 and its Task 8), found through this PR's per-batch manifests, which record each batch's measured version and run names (Q14).
- `handcheck --sheet` and the label reader (W2-D81; Q19).
- `report`, which gathers every node's files with their shas and calls `decideGate` (W2-D85, W2-D89; Q15, Q17, Q28, S2's C15 and C21), with RP6-e2e and RP7-e2e.
- README's driver paragraph, naming the `--no-warnings` shebang, and the spec errata E2, E7, E8, E9, E10, E11 and E19 to E24, each citing its number (decisions §6).
- Q29: W2-6 may run beside W2-5b2 if its plan shows the two are line-disjoint.

### Departures

Each is defined in the plan's `## Deviations found`:

(one line per number Step 2 printed, in the form: number, slug, task, one-line why; or "None.")

Cited bare, defined elsewhere:

(Step 2's bare-cited numbers, grouped by the plan that defines each)

### Spec errata: none in this PR

W2-5b1 does not hold the spec path (W2-D3, S1). Two errata come from decisions it implements, and W2-5b2 amends each in place: **E21** (§10.2's as-of seam: during the pilot, headless-on lists the pilot pairs, D-5781) and **E22** (§10.2's item 3 and "Scoring": the single ANSWER field, a 7-character SHA prefix scored correct, the widened `uncertain`, the signed rubric ids, `judge-failed` to the operator, a run-failed question excluded from both arms; D-5776, D-5777 and D-5778).

### Decisions this PR applies

- W2-D42 (the arm words never spelled; `RECALL_ARMS` imported) and W2-D50 (RP1-arm's exact env with real values).
- W2-D75's card line, with W2-D35's widened visibility rule (D-6282, D-6283, D-6284).
- W2-D76's marker for the pilot, and W2-D84's second half: `marker` and `verify --section pilot|quiz`.
- W2-D78 (i) and (iii), wired beside W2-4's (ii); W2-D56 and W2-D55 before every arm batch; W2-D6's `tree-moved`.
- W2-D79 (the judge), W2-D54 (every spawned field redacted whole before any cut) and W2-D18 (the sort before the `'judge-order'` shuffle).
- W2-D80 (failed runs; every stop word classified, the decisions document's §7 residual), W2-D59 (driver-local words), W2-D64 (the absent ANSWER line recorded per arm; the halt is W2-5b2's pilot and the gate's), W2-D82 (the uptake facts per run, with `via_agent`; the reading of the control's exit 8 is the pilot's).
- W2-D24: this PR's `--record` consumers.
- W2-D3, W2-D4 and W2-D5: no spec edit, no decisions-document number defined, and no new test file.

### Rulings made in the operator's place

Each is the coordinator's, under the operator's directive of 2026-10-19, made while W2-5b was planned (2026-10-22), and each is changeable by the operator:
- S1: W2-5b ships as two serial PRs; this one takes `marker`, `verify --section pilot|quiz`, `arms` and `judge`, and no README or spec line.
- S2: C8 (R8's ref-survival decider into lib) is moot here, because the card's parent is W2-D35's node rule, already lib's; it stays in the ledger's "Later". C9 is a set-equality pin, the gate untouched. C22: the driver-side range check extends to `spend_budget` and every part-2 field this PR's consumers read, before `--out`; the validator change stays in "Later". C23 is a residual (below). C15 and C21 are W2-5b2's.
- Q1 (separate subcommands sharing one `--out`, each spending and resuming on its own), Q2 (arms and judge per node), Q3 (the batch shape), Q4 (attempts and timeouts), Q5 (the per-node spend share), Q7 (the fail-closed charge), Q14 (the per-batch manifest), Q16 (D-6284's over-hide measured per node, read-only, in `verify --section quiz`), Q18 (positional judge ids and their map file), Q20 (the card's prefixes and its join), Q21 (W2-D78 (iii)'s depth), Q22 (the parity pins' form), Q23 (`--allow-code-change` after window start only), Q24 (the stop/refusal partition), Q25 (a fresh `--out` per phase and per node; an `--out` holding `pilot-source.json` refused), Q26 (arms read `pilot_result.settings_mode`), Q30 (the batch summary) and Q31 (every `error` field recorded); Q11 and Q13's reading halves.
- R1 to R26, the rulings on the drafts of this plan, each listed in the plan's Decisions table; among them R4 (the batch shape read from the record, bounded), R14 (re-runs per arm), R16 (the raw reply kept under `--out`), R18 (the judge map over every frozen pair), R21 (the arms-then-judge walk) and R26 (one admission, one preflight and one set of arm readers for the writer, the arms and the judge).
- R27 to R32, made after the plan's review (2026-10-22): R27 (R23 narrowed to W2-5a's W2-D24 re-check cases; the three in-place edits above licensed), R28 (`limits.batch_max`'s floor is `RECALL_ARMS.length`, 2, so a batch holds both arms of a question), R29 (`OVER_HIDE_IDS_MAX` is 1,000, the total always given), R30 (one spelling of the version-move ranges, which W2-D56's per-node `expected` reads), R31 (red-first cases for `readArmAnswers`' refusals and the pilot's settings-mode check) and R32 (the walk's and the end-to-end case's fixture assumptions are predictions, measured by the build).

(each ruling made while this plan was reviewed or during the build, one line each, with its date)

### Must-holds and their pins

- No arm spawn unless the family is listed for this store (W2-D78 (i)), with no recall-off entry (ii), with each question re-checked (iii), with W2-D56 passing against part 1 or the newest version move, and with the gate passing; each W2-D78 refusal and each refusal before `--out` with the stub's log absent, and a W2-D56 refusal with only the `--version` line logged and no `-p` run.
- RP1-arm's exact env keys, with real ARM values.
- The control payload byte-identical to W2-5a's composer; the treatment payload the card line, one blank line, then the control payload.
- The card never names a parent hidden under `asOfCut(N)`; the CONTROL is a parent formed after N.
- The driver never spells an arm word (W2-D42's scan), and its arm set equals the gate's `ASSIGNMENT_ARMS`.
- Judge stdin and file names carry no arm token; a correct answer never reaches the judge; malformed twice is `judge-failed`; RP1-judge and RP3-judge.
- Every `DRIVER_REASONS` word classified once; a question with no recorded run is `not-run`; a stop never consumes the re-run.
- `marker` writes nothing and round-trips; no driver line spells `/headless-on` or pairs a write verb with `.headlessOn` (O13).
- Every `--record` consumer re-checks `gate_code` first.
- A refusal that needs no store and no spawn answers before `--out` is made; a data case after `--out` never exits INTERNAL.
- Each new guard was measured red under its mutant, then green. The plan lists every mutant and the case it reds.

(the case titles Step 6 counted or found, one per must-hold, and the re-check rows)

### Residuals, named

- **lib's `redactField` and its glued-prefix limit (R-3)** stand. The judge's stdin carries the redacted reply, so that limit reaches the judge too (S2, C23; the ledger's "Later").
- **The raw reply is kept under `--out`** in each answer record (mode 0700), beside W2-4's raw stream files; it is redacted at each spawn and at W2-5b2's sheet (W2-D54, R16).
- **The reply can reveal the arm** (the control's exit-8 line, the skill's stop line). Judge agreement and hand-check agreement are reported by arm (W2-D79; the report is W2-5b2's).
- **The `authentication_failed` spelling is unmeasured** until a run prints one; every `error` field is recorded, so the first one is seen (Q31).
- **The charge rule over-charges rather than under-charges** when the two readings disagree; both are recorded, and W2-5b2's pilot reports their measured relation (Q7).
- **The budget is a soft stop**: up to c whole runs (c = 2) past a node's share (W2-D55). The share is of a budget W2-5b2's `open --finalize` derives; until then part 2 carries the operator's (D-6280).
- **The version-move amendment is read here and written by W2-5b2's `open --amend`.** The read is pinned on a hand-built amended record.
- **A half-done question across a version move.** W2-D56 re-runs both arms of a question with only one arm done on the new version, and that rule is W2-5b2's (C19). Until it ships, `arms` resumed after a `version-move` amendment spawns only the missing arm, on the new version, so that question's two arms ran under two versions. The per-batch manifests (Q14) record the version each run was spawned under, so W2-5b2 finds every such question; nothing runs on a real node before W2's final release (W2-D6).
- **`arms` reads part 2's `pilot_result`**, whose producer is W2-5b2's `pilot-result`. Until W2-5b2 merges, these subcommands run only on fixture records, and nothing runs on a real node before W2's final release (W2-D6).
- **The card's parent is decided by W2-D35's node rule**; whether a `describe` of that parent drops a tool_use ref under the cut is R8's rule, which the CLI applies at read time and which stays in recall.mjs (S2, C8).
- **O13's known width**: a marker path held in a variable and read on a later line is not seen by the scans.
- **Same millisecond and clock steps outside the holding copy** remain as the decisions document's §7 states; the cut is lib's, and this PR adds no second spelling.

### How it was measured

- Every guard red-first on the unguarded code, then each named mutant red after the guard landed, then green again; each task's commit message records its counts.
- Every test drives the driver in a `mkTmp` fixture HOME with the scrubbed environment. Arm, judge and every other spawn reach a recording node stub, never a real Claude Code, with a poisoned `gh` first on `PATH`. Stores are fixture stores in the case's temp tree. No step read a live store or home, or spawned a real model. One walk runs the real `arms` and then the real `judge` over one `--out` (R21).
- The driver was read as text for its must-holds (no quoted arm word, no `/headless-on`, no write verb paired with a switch, one recall-off line, the marker's one bounded read, no re-declared import, the module list unchanged), and the arm sets were compared live against the gate's and lib's.
- The added lines hold no numeric line citation, no shell, no new `process.env` read, no live-HOME read, no key-shaped literal, no backslash-u escape, no placeholder departure token and no D-number range (counts, all 0).
- The private-name check over every added line, every commit message, the title, this body and the plan printed 0.

### Steps for the coordinator or the operator, never the worker

1. **The selection.** This PR changes no `.github/` file, so CI runs its selection. Check that the `select tests` summary lists `history-replay`, `lifecycle` (it imports the driver) and `single-definition` (it scans `deploy/`). If one is missing, dispatch a full run: `gh workflow run ci.yml --ref <this branch> -f mode=full`. `test-macos` is advisory, but a `history-replay` red there blocked a stable promotion once (#1032, D-6122), so read it.
2. **Rollout through the release lane only**, and only as part of W2's final release (W2-D6): every W2 PR merges, W2-5b2 included, and that release is rolled onto the named nodes before part 1 of the open record is signed.
3. **The operator acts this PR's subcommands serve** (decisions §5), each on the named nodes after that rollout: act 13 (`marker --section pilot`, `verify --section pilot`), act 14's usage pilot (`arms` and `judge`, `--section pilot`), acts 18 and 19 (`marker --section ab`, `marker --section quiz`, `verify --section quiz`), and act 21 (the arm and judge batches).

### Tests run (foreground, on the worker's box)

(Steps 5, 7 and 8's summary lines, as printed)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Then re-run Step 9's block over the finished body. Both counts must be `0` again, and the two CONTROLs `1`.

- [ ] **Step 12: Push, open the PR, and read its threads and checks.** Push the workspace branch, its own branch and never a separate feature branch. Then open the PR against `main`, ready for review (not a draft):

```bash
git push -u origin "$(git branch --show-current)"
gh pr create --base main --head "$(git branch --show-current)" \
  --title "ccrc history wave W2-5b1: the arms and the judge" \
  --body-file .superpowers/sdd/history-w2-5b1/pr-body.md
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

**Re-read the threads after every push.** A thread left open blocks the merge even while every check reads green. An open CodeQL thread (author `github-advanced-security`) is fixed at its cause, in the task that owns the line: an argv array, never a shell or a command string, and no environment value in a command. The arm and judge spawns are where such a thread would land: both go through W2-4's `launchRun`/`runBatch` with an argv array. The worker never resolves a thread and never dismisses an alert. To list an open thread's place without its text:

```bash
gh api graphql -F o="$OWNER" -F r="$REPO" -F n="$PR" -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){nodes{isResolved path line comments(first:1){nodes{author{login}}}}}}}}' \
  --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved | not) | "\(.path) \(.line) \(.comments.nodes[0].author.login)"'
```

If the body must change after the PR is open, patch it over REST (`gh pr edit` fails on this box) and re-run Step 9 on the new file first:

```bash
gh api -X PATCH "repos/$OWNER/$REPO/pulls/$PR" -F "body=@.superpowers/sdd/history-w2-5b1/pr-body.md" --jq .html_url
```

**Wave-done** needs all four: the PR open, its checks green, no open thread, and the branch tip equal to the PR head (`git rev-parse HEAD` against `gh pr view "$PR" --json headRefOid -q .headRefOid`). The wave-done report also names any number issued to this run and left unused (never written in the PR). Merging, the merge queue, the rollout and every act in decisions §5 belong to the coordinator and the operator, never the worker.

**Mutants.** This task adds no guard and no code path. Its walk has two mutants (Step 1: W1, W2), and its checks carry their own CONTROLs:
- Step 2's checker answers `defined 2` for a synthetic entry appended twice, and its bare-citation lookup answers `0` for a number no plan defines; at planning time, on W2-5a's plan, it printed `in-decisions 1` for that plan's one W2-block number, D-5780;
- Step 5's carries reader printed the base's own non-zero figures at planning time (`arm-word-lines 2 on-code-lines 2`, `recall-off-lstat-lines 1`, `ab-only-message 1`), so a zero after Tasks 1 to 5 is their change, not a blind pattern;
- Step 9's list CONTROL finds the list's own first name, and its home-path pattern counts a non-fixture home and admits the fixture ones;
- the focused runs in Steps 5, 6 and 7 each select their named cases, so none passes vacuously.

Every guard this PR adds is in Tasks 1 to 5, each with its own mutant list.

**Commit:** one, Step 1's walk (`test(history-replay): …`). Two kinds of change may still be needed:
- **A fix a check calls for** goes into the task that owns the code, as a correction commit in that task's form, `fix(history-replay): <what> (W2-5b1 Task <N>; W2-D<n>)`, defining in this plan's `## Deviations found` any number it first cites. It is committed before Step 12's push, and Steps 4 to 9 are re-run after it.
- **A corrected prediction**, a figure in this plan that a step measured otherwise, is recorded in this plan by a commit named for the task whose prediction it was, `docs(plan): <what> (W2-5b1 Task <N>)`, touching only this plan's text.

## Deviations found

Six numbers are defined here. D-6467, D-6468, D-6469 and D-6470 were issued by the coordinator for the departures found while this plan was drafted (R3), before dispatch. D-6479 was issued from run 828's block during the build, for the departure Task 2's re-check found, and is appended below by the commit that first cites it. D-6480 was issued from the same block, for the departure Task 5's review fix round found in the batch case's concurrency measure, and is appended below by the commit that first cites it.

- **D-6467** — `history-w2-5b1-spend-charge-larger-reading` (Task 1; decisions §7's C6 under W2-4's spend residuals, W2-D55, Q7): every spawn's charge, in every spawn mode (writer, judge, box and arm), is the larger of the result event's usage and the sum of every assistant message's usage, subagent messages included, through the one `spendTokens` every charge site calls (`launchRun` and `settleLeftover`), charged unconditionally. This departs from decisions §7's C6, which has W2-5b's pilot measure whether the result usage includes an Agent subagent's spend before any arm batch and charge it only if it is missing. The measurement C6 waits for is W2-5b2's pilot, which runs this PR's arms, so the arms would spend before the charge rule was known; an over-count is the budget's safe direction (W2-D55), and writer and judge runs carry `--tools ""`, so their two readings normally agree and one rule at the existing charge sites stays one spelling. Both readings are recorded in each `run.json` (`usage_result_tokens`, `usage_assistant_tokens`), so W2-5b2's pilot result reports their measured relation. W2-4 Task 9's pinned probe spend moves from 15 to 60 (four messages of 5 against a result of 5, three runs). Pins: Task 1's stream cases ("both readings are kept, W2-4's usage stays the result's, and spend charges the larger" and "a run on the stub is charged the larger reading, and its run.json records both beside the charge") and W2-4 Task 9's re-pinned probe spend; mutants M-S2, M-S3 and M-S4 of Task 1.
- **D-6468** — `history-w2-recheck-one-screen` (Task 2; W2-D78 (iii)(a), W2-D67, W2-D65, Q21): clause (a) of the re-check before every arm batch runs the one `screenRedaction` (F_raw, F, the repo roots, and F_raw inside its leaf) over boundary N's candidate, re-mined from the store through `mineStoredBoundary` (sourcing's own mining, factored out of `sourceQuiz` unchanged), where W2-D78 (iii)(a) reads "redaction no longer leaves F_raw unchanged". So a frozen question also refuses on F, on a repo root or on its leaf, and a source pruned or tombstoned after the freeze refuses at (a) with the mining word (`span-tombstone` and the like, `fact-unmined`, `boundary-absent`), not at (b). W2-5a's screen is that one function (W2-D67 as W2-5a's R10 widened it), and a frozen entry carries no leaf, so a check of F_raw alone would be a second, narrower spelling of the screen; the re-mine re-checks each question exactly as sourcing admitted it, under the roster's config dirs (R6). Pins: Task 2's clause (a) cases ("a pair the store learned after the freeze masks F_raw", "(a) comes first: a source pruned after the freeze fails the re-mine", "a frozen fact boundary N no longer yields is fact-unmined, and a boundary uuid the store does not hold is boundary-absent") and the batch case; mutants T2-M8, T2-M9 and T2-M16 of Task 2.
- **D-6469** — `history-w2-arm-payload-discard-refuses` (Task 4; W2-D78 (iii)): a fourth clause of W2-D78 (iii). A question that passes `recheckBatch` but whose arm-time payload no longer reconstructs (`armPayloads` answers a `RECON_DISCARDS` word: a summary or kept member pruned since the freeze, `leaf-absent`, `card-unrenderable`) refuses the batch `quiz-unanswerable` `<qid> payload <word>` before any spawn of the batch, where W2-D78 (iii) names three clauses. W2-D78 says a frozen question is never dropped silently, and neither arm can be asked without its payload; counting the question `not-run` would hide it, and folding the payload into clause (c) would compose the payloads twice. The refusal sits where the payloads are composed, in the batch preflight, and the operator rules on the question as on any W2-D78 refusal. Pins: Task 4's case "W2-D78 (iii): a payload that no longer reconstructs refuses quiz-unanswerable, never a dropped question" (the stub's log absent); mutant M4 of Task 4.
- **D-6470** — `history-w2-judge-answer-field-cap` (Task 5; W2-D79, W2-D54): the judge input's `answer_field` is cut at the same `JUDGE_REPLY_MAX_BYTES` (16 KiB of UTF-8, in whole code points, after masking) as the reply, beyond W2-D79's letter, which caps the reply only. A model can put a long dump on its ANSWER line, and an uncut field would leave the judge's stdin unbounded; masking still runs first, so the order W2-D54 sets (redact whole, then cut) holds for both fields. Pins: Task 5's case "the reply is redacted, then capped at 16 KiB of UTF-8, never splitting a code point; answer_field is carried beside it, cut at the same cap (D-6470)"; mutant J23 of Task 5.
- **D-6479** — `history-w2-answerability-fts-rowid-fail-closed` (Task 2; W2-D70 clause 3, W2-D78 (iii)(b), D-6468): `checkSource`'s clause 3 now decides on the matched rowid itself. Its statement binds the blob id through `CAST(? AS INTEGER)`, and `checkSource` answers `no-match` unless the rowid that came back equals the source's blob id. This departs from W2-5b1's scope, which reuses W2-5a's `checkSource` and `answerStmts`' `match` statement unchanged: it edits both. The measured cause: node:sqlite binds a JS number as REAL (`typeof(?)` answers `real`), and FTS5 then ignores the `rowid = ?` constraint for any rowid, so `SELECT rowid FROM blobs_fts WHERE blobs_fts MATCH ? AND rowid = ?` answered whichever row the phrase matched, for a never-inserted rowid and for a present row that does not match, on plain, contentless and contentless_delete tables alike. W2-5a's `=== undefined` test therefore never fired while any blob in the store held the phrase, so a source whose own index row was gone, or whose own blob lacked the phrase, stayed answerable whenever another blob held it (a command run twice, for one). Measured at Task 2 (and again for this fix) on node v24.14.1 with `SELECT sqlite_version()` 3.51.2: rowid 3 (never inserted) and rowid 9 (present, non-matching) both answered row 7 on all three table shapes; a BigInt bind (9n) and `CAST(? AS INTEGER)` answered undefined. Unmeasured on the 22.16 floor (no other node on the box); the fix holds whatever SQLite does, because the clause compares the returned rowid, and the compare alone (with the old statement) keeps the pins green, measured. The change is fail-closed only: it can turn an answerable verdict into unanswerable, never the reverse, and every W2-5a answerability case passes unedited. Only the driver's lookup has the `MATCH ? AND rowid = ?` shape; the sweep's FTS lookup returns every matching rowid and nothing under `ccd/**` changes. A quiz frozen before this fix would need re-checking; none has been frozen. Pins (Task 2's describe "answerability's clause 3 decides on the matched rowid (D-6479)"): the CONTROL (the source's own live row, answerable), the index row gone while p1 holds the phrase (`no-match`, clause 3, `unanswerable`), the source's own live blob lacking the phrase while p1 holds it, and the arm-time re-check naming clause (b) and `quiz-unanswerable`; the p1 fixture shares the span source's command again, so the existing (b) case measures the fixed behaviour. Mutant D-M1 (the old statement and the old `=== undefined` test) reds the four cases.

- **D-6480** — `history-w2-judge-batch-depth-measure` (Task 5; W2-D79, W2-D55): Task 5's case "batches of at most ten at most two at once, and the preflight before every batch" measured concurrency as the number of runs that overlap a run at any time, and read `toBe(2)` off the maximum. That reads 3 when one run straddles two others in turn (A ends, C starts, B still alive), though never more than two stubs are alive at once. Measured at the build: it failed 2 of 3 whole-file runs under load (`two at once, never three: expected 3 to be 2`) and passed alone. This departs from Task 5's test block as written: the case now measures the depth at each run's start (`s.start <= r.start && r.start < s.end`, itself included), W2-4's own measure in its concurrency case, which equals the most stubs alive at once and so still reds a real three-at-once; the stub's sleep is raised from 150 ms to 1500 ms, W2-4's concurrency case margin, so the lower bound (two overlap) holds under load, and the case's timeout from 60 s to 120 s. A fixture fix: the guard is unchanged. Pins: mutant J31 (`concurrency: 1` in the judge's `runBatch` call) reds the lower bound, measured `expected 1 to be 2`; mutant J32 (`concurrency: 3`) reds the case, measured as `TypeError: runBatch: concurrency must be 1 to 2`, because `runBatch` refuses a width above `CONCURRENCY_MAX` before any spawn, so the depth assertion's upper bound cannot be reached through the driver and `runBatch`'s own bound is what holds it.
