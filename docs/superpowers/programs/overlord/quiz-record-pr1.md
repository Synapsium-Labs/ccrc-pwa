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
  resumed `arms` reads it rather than probing again: passed, the arms go on; failed, the week needs a fresh `--out`.
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

## An incident to report

While assembling Task 2's byte check, a shell `eval` of a badly built command string ran `deploy/history-replay.mjs`
with no arguments from inside this session's pane. Its first act refused it (`in-pane`, exit 2), before it parsed an
argument or touched a file, so nothing ran. The check was then made with a sed script file and no `eval`.
