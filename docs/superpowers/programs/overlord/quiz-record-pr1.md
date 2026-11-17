# Overlord W1a, the replay quiz's record path, PR 1: task note

The note of PR 1 (Tasks 1 to 6) of `docs/superpowers/plans/2026-11-17-overlord-quiz-record.md`, run 2392. It records the
export set, the byte check, what the setup carries, the measurements and the departures, for the coordinator to fold into
the programme ledger. None has a D-number: departures are named by slug.

## Task 2: the export-only edit (the history coordinator's waiver, term 2)

The word `export ` goes in front of 31 existing top-level declarations of `deploy/history-replay.mjs`, each a function or a
constant, and nothing else changes (31 lines, 31 insertions and 31 deletions, no line added):

| Group | Declarations |
|---|---|
| The stop | `STOP_SIGNALS`, `onStopSignal`, `refuseIfStopping` |
| The arm path | `armJob`, `armAttemptsOf`, `armBatchPreflight`, `settleAnswers`, `preflightSpawn`, `writeArmManifest`, `armBatchCount` |
| The probes | `step0bCardOf`, `step0bRunOf`, `refuseSyntheticPresent`, `finishedOutcome`, `probeFindingOf` |
| The output helpers | `readPlain`, `writePlain`, `pinOutBytes`, `ensurePlainDir`, `lstatOrNull`, `shaOfPlain`, `OUT_JSON_CAP` |
| The refusals | `refuseUnusableInputs`, `refuseSpawnAdmission`, `refuseOpusModel`, `refuseWriterModel`, `refuseColonInRealOut` |
| The inputs | `subcommandHome`, `loadFrozen`, `frozenEntryOf`, `warnFailedRuns` |

No state is exported (waiver condition 2): `liveChildren` and `stopping` stay private, and `spawnGroup` and
`yieldToSignals` with them, because the module spawns only through the driver's registered spawn (`runBatch`,
`measureClaudeVersion`, `step0bMechanics`, `openWriter`, `openJudge`). `printWithSha` stays private too: nothing needs it.

The byte check (waiver condition 1), from the worktree root:

```bash
git show origin/main:deploy/history-replay.mjs > "$TMPDIR/main.mjs"
git diff -U0 origin/main -- deploy/history-replay.mjs | grep -E '^@@' \
  | sed -E 's/^@@ -[0-9,]+ \+([0-9]+).*/\1s\/^export \/\//' > "$TMPDIR/strip.sed"
wc -l < "$TMPDIR/strip.sed"                       # 31
sed -f "$TMPDIR/strip.sed" deploy/history-replay.mjs | cmp - "$TMPDIR/main.mjs" && echo identical
```

Output: `31`, then `identical`. `GATE_CODE_FILES`' other three members are untouched, and none of the four changed on
`main` between this branch's base and the time of the check.

## Task 3: what the setup carries (step 1's measurement)

Every value sourcing and the batches read, with W2's signed defaults from `OPEN_RECORD_V1.draft`:

- `sourceQuiz` reads the seed (`seed`), `plan.target` (`quiz.target`, `--target`, default 100), `plan.caps`
  (`quiz.caps`: family 5, boundary 3, kind per family 2), the exclusions (none: no pilot families, no assignment) and
  `shaMinPrefix` (`labeller.sha_min_prefix`, 7).
- `openWriter` reads the writer model, the settings mode, `writerInput` (`quiz.writer_input`, `excerpt`), the budget, the
  limits and the expected node.
- `batchGate` reads the budget and `limits.threshold_pct` (70) and `limits.max_age_ms` (3,600,000); `runBatch` reads
  `limits.concurrency` (2); the arm batches read `limits.batch_max` (10). The limits are `LIMITS_DEFAULTS`.
- The judge reads `rubric_id` (`v1`) and the judge model.

## Measurements

- Task 1's characterization file is green on `main`'s code (16 cases).
- The module's file: 26 cases, green. `lifecycle.test.ts`: 95, green.
- The guards, each measured red by a hand-applied mutation, restored from a saved copy and checked with `cmp` after every
  mutant (all 16 killed):

| Mutant | The test that went red |
|---|---|
| The stop handler not installed in main | the SIGINT case: the live arm run survives, the module dies by the signal |
| The no-comparison walk dropped; its PASS check dropped | the guard's planted-key and PASS cases |
| A `lift` key planted, with the guard kept; and with its call dropped | the report's exact-fields case; the forbidden-keys walk |
| The pane refusal dropped; the session refusal dropped | the in-pane and in-session case |
| `--settings-mode` given a default | the setup refusal case |
| A Fable arm model allowed | the model refusal case |
| `release-moved` dropped from `report`; the arms' release pin dropped | the mixed-releases case; the resumed-arms case |
| A failed step 0b not refused | the failing-probe case |
| The steer word folding `unmeasured` | the armed-words case |
| The judge's masking agreement dropped | the two-readings case |
| A zero answered count not refused | the zero-denominator case |
| The control arm run instead of the treatment arm | the treatment-only case |

## Departures, by slug

- **single-arm-judge-masks-under-two-readings:** the driver's `maskingSnapshotsOf`, `maskingAgreementOf` and
  `refreshPairIndex` cannot be exported: `history-replay.test.ts` pins their exact unexported lines (K28), and waiver
  condition 4 keeps that file unchanged. The module's judge builds its jobs under the reading it opened and again under a
  fresh `pairIndexOf` reading, and refuses `input-invalid masking-snapshots-disagree judge` on any difference, never
  masking under the newer reading (K26). The arms and step 0b keep the driver's own agreement, through
  `armBatchPreflight` and `step0bCardOf`.
- **export-set-beyond-candidates:** §3's candidate list was not the whole need. Added, each a function or a constant:
  `writeArmManifest`, `armBatchCount`, `refuseSyntheticPresent`, `finishedOutcome`, `probeFindingOf`, `lstatOrNull`,
  `shaOfPlain`, `OUT_JSON_CAP`, `refuseWriterModel`, `refuseColonInRealOut`, `subcommandHome`, `loadFrozen`,
  `frozenEntryOf`, `warnFailedRuns`. Left private from the candidates: `yieldToSignals`, `spawnGroup`, `printWithSha`.
- **js-mutants-measured-by-saved-copy:** `mutation-run.py` builds mutants of Python modules only, and this module is
  JavaScript. Each mutant was applied to the module in place, its one test run, and the module restored from a saved
  copy and checked with `cmp`.
- **characterization-pins-the-pure-builders:** Task 1 pins the summary's and the judged tally's shapes through the
  driver's pure builders (`armsSummaryOf`, `judgeTallyOf`, `judgeMapOf`), which its writers call, rather than through a
  two-arm stub walk of `arms --section quiz`, which needs signed W2 records.
- **step0b-result-own-kind:** step 0b's result is written under the module's own kind at `quiz/step0b/<mode>.json`, and a
  resumed `arms` reads it rather than probing again: passed on the build this node runs, the arms go on (on another
  build it probes again, fix round 1's F4, unless every question is already settled, fix round 2's F4-b); failed, the
  week needs a fresh `--out`.
- **one-week-one-release-pin:** `arms` pins the release at `quiz/arms-release.json`, so a resumed `arms` on another release
  refuses `release-moved`; the plan named only `report`'s check.
- **module-local-words:** `in-session` and `release-moved` are the module's own words (`QUIZ_SINGLE_REASONS`), not
  `DRIVER_REASONS`, which would be an edit of a gate code file.
- **main-takes-deps:** the module's `main(argv, env, deps)` hands `deps` to the handler, so the SIGINT test can stand in the
  store reads in a child process; the entry guard passes none.
- **tasks-3-to-5-one-commit:** the module was written in one piece, so Tasks 3 to 5 are one commit, and their tests were
  written after it: their red was measured by mutation (above) rather than before the code.
- **notes-under-programs-overlord:** this note and the runbook are under `docs/superpowers/programs/overlord/`, by the
  coordinator's ruling (mail 23122, the operator's ruling of 2026-11-17), not beside the plan.

## Fix round 1 (review 2409, the coordinator's rulings)

- **F1:** `openOut` writes the module's marker only into a directory `prepareOut` has just made. An existing directory
  must already hold the module's own marker, so any other, a W2 run's `--out` (the driver's marker alone) above all,
  refuses `out-refused` before anything is written. A case runs `arms`, `judge` and `report` against a W2-marked
  `--out` and checks each refusal and the directory's bytes, unchanged.
- **F2:** Task 6's walk now drives the driver's own writers: the real writer handle pins `quiz/writer/<qid>.input.json`,
  and `writeBaselineRecord` writes `quiz/baseline.json`. The required kinds include `ccrc-history-w2-baseline`, and all
  three readers refuse both files.
- **F3:** `--budget` is one week's total. The judge's cap is `--budget` less the spend the week's ledger records outside
  the judge's rows (`judgeCapOf`), so a resumed judge neither counts its own rows twice nor starts on a fresh budget. A
  cap at or under nothing refuses `budget-exhausted` before any spawn. The gate runs before every spawn, so the ledger
  can end at most two whole runs (the batch's concurrency) past a stop, and the arms' and the judge's overshoots do not
  stack: the judge refuses once the arms' spend has reached `--budget`. The header and the runbook say this, that the
  70% limits stop still bounds each account, and that the source phase's writer spend lands in `<OUT>`.
- **F4:** a resumed `arms` reuses a passed step 0b result only when every build it probed is the fresh expected node's.
  On any other build it probes again, before the next arm, and refuses `pilot-failed` on a failed probe. Each round
  runs under its own names, because the driver's `runBatch` reuses a finished run of the same name rather than
  spawning it again, and the result records its `round` (the names carry the build too since fix round 2, F4-a).
- **F5:** `report` recomputes the summary's `counts` and `answers` from the answer records (`summaryTallyOf`, which
  `singleSummaryOf` now uses too) and refuses `input-invalid arms-summary-mismatch` before it scores.
- **F6:** `arms` refuses `out-refused` on a `--out` holding this setup's `setup.json`.
- **Residual, for whoever resumes W2, beside skip condition 3:** the driver's `checkOut` still accepts a single-arm
  `--out`, which holds the driver's marker too, so a W2 subcommand pointed at a weekly `<WEEK>` would adopt it. The fix is
  in `deploy/history-replay.mjs`, a `GATE_CODE_FILES` member outside the waiver, so it is not made here.
- The driver's bytes are unchanged by the round: the waiver's strip-and-`cmp` above prints `31`, then `identical`.
- Mutants, each applied to a copy of the module and restored from it with `cmp`, all 7 killed: the marker written into
  any existing directory (F1), the setup `--out` check dropped (F6), the judge given the whole budget, and the cap's
  refusal dropped (F3), a passed step 0b always reused, and a re-probe under the round-0 names (F4), and the report's
  recompute dropped (F5).
- Departures, by slug: **judge-cap-is-the-weeks-remainder** (the driver's own judge takes the whole budget again),
  **step0b-reprobe-rounds** (the `<mode>.r<k>` run names).

## Fix round 2 (review 2422, the coordinator's rulings)

- **F4-a:** every step 0b round, round 0 included, runs under `quiz/step0b/<mode>.<build>.r<k>/<run>`
  (`step0bRoundName`). The build is the review's `v<version>`, folded to the run-name alphabet by `buildTokenOf`, since a
  `--version` line such as `2.1.293 (Claude Code)` carries spaces and brackets: lower case, any other run of characters
  one `-`, at most 24 characters, then 8 hex of the whole line's sha256, so two lines that fold alike still name apart
  (`v2.1.293-claude-code-<8 hex>`). A probe stopped part-way on one build and resumed on another so runs fresh probes,
  and never stamps the first build's finished runs as the second's. The case stops a re-probe after its turn-bound run
  on one build (the limits row raised from the recheck stand-in), resumes on a third, and checks a fresh turn-bound run
  and that every run the result names carries the third build's token; it is red on `c14d4d970`.
- **F4-b:** `arms` measures the questions' states before step 0b. With every question settled, a passed result is
  reused whatever build it probed: nothing runs on the new build, and the summary's step 0b sha stays true. A failed
  result still refuses `pilot-failed`.
- **F3-a:** the header, `judgeCapOf`'s doc, the runbook and the F3 bullet above say the gate runs before every spawn,
  so the ledger can end at most two whole runs (the batch's concurrency) past a stop, and that the arms' and the judge's
  overshoots do not stack.
- **F1-a:** `openOut` first refuses `out-refused` on a `--out` with an ancestor holding the driver's marker, up to the
  filesystem root, as spelled and through `realpath` (`refuseDriverAncestor`), before `prepareOut` makes anything. A
  `<WEEK>` therefore never nests in a W2 run's `--out`, nor in the setup's `<OUT>`. Cases: a week nested in a W2 out, and
  one reached through a symlink into a W2 out's subdirectory, each refused for `arms`, `judge` and `report`, with the W2
  out's bytes unchanged.
- **The review's note:** the runbook says a directory left holding only the driver's marker, by a stop between
  `prepareOut` and the module's marker, is refused for good and is removed by hand.
- The driver's bytes are unchanged by the round: the waiver's strip-and-`cmp` above prints `31`, then `identical`.
- Measured red: the round's five new cases fail against `c14d4d970`'s module (F4-a on `expected 2 to be 3`, build C's
  turn-bound run reused from build B). Mutants, each applied to a copy of the module and restored from it with `cmp`, all
  4 killed: the ancestor walk dropped (F1-a, both cases), the realpath chain dropped (the symlink case), `reprobe`
  always true (F4-b), and the round names without the build (F4-a, both naming cases).
- Departures, by slug: **step0b-names-carry-the-build** (`buildTokenOf`'s fold and hash, where the review wrote
  `v<version>`); **step0b-reprobe-rounds** now covers round 0 too (no round runs under the driver's `step0bRunName`).

## An incident to report

While assembling Task 2's byte check, a shell `eval` of a badly built command string ran `deploy/history-replay.mjs`
with no arguments from inside this session's pane. Its first act refused it (`in-pane`, exit 2), before it parsed an
argument or touched a file, so nothing ran. The check was then made with a sed script file and no `eval`.
