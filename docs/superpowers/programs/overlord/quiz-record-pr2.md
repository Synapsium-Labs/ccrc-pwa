# Overlord W1a quiz record, PR 2: notes for the ledger

Tasks 7 to 12 of `docs/superpowers/plans/2026-11-17-overlord-quiz-record.md` (run 2393): the record door, its confirmation,
the operator's verb, the censuses and the Shadow lanes card's quiz block. The coordinator folds these notes into the
programme ledger.

## What landed

| Task | What | Where |
|---|---|---|
| 7 | A recorded run is `pending` until the operator rules on it. One migration adds the run's state, the single-arm report's counts, its mode and the interval's method, and the ruling. `insertQuizRun` records `pending` with no baseline; `ruleQuizRun` is the one writer of `state`, `ruledAt`, `ruledBy` and `baseline`. `quizBaseline` reads confirmed rows only; `quizBaselineRead` carries the baseline's date; `quizRecordedAts` skips discarded rows | `server/src/continuity/quiz.ts`, `quizStore.ts`, `server/src/coord/schema.ts` |
| 8 | `quizRecordVerdict` (L1, the eleven first-match rules of §5) and the box-token record door, `POST /api/continuity/quiz-runs`, which measures the sha over the report's bytes. `QUIZ_RECORD_READY` is `true` | `quiz.ts`, `quizRoutes.ts` |
| 9 | The rule door, `POST /api/continuity/quiz-runs/:id/rule`: session-gated, behind the account gate's step-up | `quizRoutes.ts` |
| 10 | `ccrc quiz-record --report <file> --sha <hex>`: refuses in a session and in a pane, checks the file, builds the body with `jq --rawfile` and posts it through `ccrc-api quiz record` | `ccd/ccrc-quiz-record`, `ccd/ccrc`, `ccd/ccrc-api` |
| 11 | Every census of §8, and the weekly item's real steps | `auth/gate.ts`, `auth-gate.test.ts`, `box-token-census.test.ts`, `rings/fastify-l4.data.ts`, `README.md`, `CLAUDE.md`, `ccrc-api(-closed).test.ts`, `ccrc-cli.test.ts`, `quiz.ts#quizItemText` |
| 12 | `laneArmViewOf` takes the quiz reads and the view carries an optional `quizBaseline` block; the PWA shows the pending runs with Confirm and Discard (through the step-up flow) and the baseline line | `server/src/coord/laneArm.ts`, `server/src/coord/routes.ts`, `shared/lane-arm.ts`, `pwa/src/fleet/*` |

## Departures (by slug; no D-number was issued)

- **quiz-record-posts-through-the-client** (coordinator ruling, 2026-11-17): the verb reads no credential, no server address
  and runs no `curl`. It validates and packages the report, then posts the body through `ccrc-api`'s closed table, which gains
  one row, `quiz.record`. This reverses the plan's §5 and §8 lines ("no `ccd/ccrc-api` row"; `ccrc-api-closed` pins that no row
  appears). Why: CLAUDE.md's consolidate rule (no fifth hand copy of the address-and-credential read), and the door now
  records `pending` only, so a session that posts through the row records nothing that counts. The first attempt, a verb that
  read the credential itself as the plan said, was refused by the session hook's account arm; it was reported and not retried.
- **quiz-bootstrap-copy-in-lane-arm**: the frozen L0 copy of the bootstrap's `ci`, `method` and `B` lives in
  `shared/lane-arm.ts` (`QUIZ_BOOTSTRAP`), beside the card's quiz wire, rather than in a new `shared/` file;
  `continuity-quiz-route.test.ts` compares it with `deploy/history-gate.mjs#BOOTSTRAP`.
- **quiz-record-door-refuses-unknown-keys**: rule 3 also refuses any top-level key outside §4's field list, naming it, so a
  comparison figure (a lift, a delta, a verdict, a PASS) can never ride in. §5's rule 3 named `kind` and `v` only.
- **quiz-rule-verdict-is-l1**: the ruling's decision (only a pending run, a confirm asks the baseline rule, a discard is never
  a baseline) is its own L1 decider, `quizRuleVerdict`, with a mutant set and a floor; `ruleQuizRun` asks it in its
  transaction, as `insertQuizRun` used to ask `quizBaseline`.
- **lane-arm-quiz-view-is-l1**: the card block's reading (`laneArmQuizViewOf`) is an L1 decider with a mutant set and a floor:
  a failed baseline read is `unreadable`, never "not yet", and a failed pending read stays a failure.
- **verb-sha-is-lower-case**: the verb refuses a `--sha` that is not 64 lower-case hex, as the door does, rather than posting
  one the door would refuse.

Carried from the plan's §12 and kept: the-door-checks-the-sha, quiz-run-pending-until-confirmed, quiz-record-refuses-any-pane,
recorded-by-is-a-verb-trace, baseline-read-carries-its-date, single-arm-share-over-answered.

## Measurements

- **Mutant sets** (`server/test/sim/quizSets.ts`, each at floor 1, every mutant killed): `quizBaseline` gains Q6 (a pending
  or discarded row read as an earlier baseline); `quizRuleVerdict` V1 to V5; `quizRecordVerdict` D1 to D18 (D1 the sha
  comparison, D2 the answered floor, D3 and D4 the freshness bounds, the plan's three among them); `laneArmQuizViewOf` A1 to A4.
- **Door and verb guards**, mutated from a saved copy and restored: the rule door without its step-up reds
  `continuity-quiz-route.test.ts` (1 case); the record door without its token check reds it (2 cases); the verb without its
  `CLAUDECODE` refusal reds `ccrc-quiz-record.test.ts` (2 cases), and without its `TMUX_PANE` refusal (1 case).
- **Red first**: Task 7's store tests ran red against `main`'s sources (14 cases) and green on the branch; the doors' and the
  card's route tests were written before their code and ran red first.

## For PR 1's runbook

`ccrc quiz-record --report <WEEK>/single-report.json --sha <H_REPORT>` is unchanged as a command. If the runbook says the verb
reads the box token or the server's address itself, that line becomes: it posts through `ccrc-api`, and reads neither.
