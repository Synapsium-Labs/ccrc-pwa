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
- **quiz-record-door-refuses-unknown-keys**: rule 3 also refuses any TOP-LEVEL key outside §4's field list, naming it, so a
  comparison figure (a lift, a delta, a verdict, a PASS) can never ride in at the top level. §5's rule 3 named `kind` and `v`
  only. The nested objects (`counts`, `share`, `interval`) still take extra keys; nothing from them is stored but the mapped
  columns, so no figure rides in that way either (review 2442 F8).
- **quiz-rule-verdict-is-l1**: the ruling's decision (only a pending run, a confirm asks the baseline rule, a discard is never
  a baseline) is its own L1 decider, `quizRuleVerdict`, with a mutant set and a floor; `ruleQuizRun` asks it in its
  transaction, as `insertQuizRun` used to ask `quizBaseline`.
- **lane-arm-quiz-view-is-l1**: the card block's reading (`laneArmQuizViewOf`) is an L1 decider with a mutant set and a floor:
  a failed baseline read is `unreadable`, never "not yet", and a failed pending read stays a failure.
- **verb-sha-is-lower-case**: the verb refuses a `--sha` that is not 64 lower-case hex, as the door does, rather than posting
  one the door would refuse.
- **quiz-card-dates-are-utc** (coordinator ruling on review 2442 F10): the plan says the PWA renders the card's dates "in the
  console's time zone", but Settings stores no console zone (the only zone a Settings row stores is the renewal backstop's).
  The card renders them in UTC, labelled (`2026-11-24 UTC`), the zone the quiz week is keyed in (quiz-week-is-utc), so a
  run's date and the weekly item's week always agree and nobody reads it as local time.
- **quiz-pending-never-holds-the-week** (coordinator ruling on review 2442 F2, replacing review 2121 F2's pin): a pending run
  no longer holds the week's reminder. Only a confirmed run closes the week; while the week has only pending rows the item is
  raised and says a recorded run waits for a Confirm or Discard on the Shadow lanes card; a discarded run counts for nothing.
  Why: a session holding the box token could post one well-formed pending run a week and keep the reminder silent until the
  operator happened to open Settings.

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
- **Migration slot**: 96. Done tests A (#2964) landed 92, the programme's phases (#2974) 93, forecasts A (#2987) 94 and the
  Linear hierarchy's wave 4 (#2982) 95, so this PR moved under the standing renumber license each time; the shared
  `decision-model-records` case is untouched. The coordinator named 98 (95 to 97 queued for gates A, handoffs and decision
  model B), but `MIGRATIONS` is positional and cannot skip a slot, so the entry takes 96 by position and whoever lands second
  renumbers.
- **Fix round 1** (first CI on 39b5420c0 red, all three my own): the pwa test stubbed `baseline: null` where the answer is
  typed boolean; the record-door test's header cases needed a `Record<string, string>` type for the tests-inclusive
  typecheck; and `mail-routes.test.ts`'s kebab-token scan refused the card's `'not-yet'`, now declared once in L0 as
  `LANE_ARM_QUIZ_STATES` with its guard (the scan reds without it). The full tests-inclusive typecheck is killed by the
  local test slice's memory cap, so the changed test files were typechecked through a narrow config extending
  `test/tsconfig.tests.json`, which reds on the original header error.
- **The contract with PR 1** (#2988, merged before this push): `continuity-quiz-route.test.ts` runs PR 1's `singleReportOf` on
  a ten-question fixture, writes it as PR 1's `report` subcommand does (`canonicalJson` and a newline), posts it through the
  record door and reads the row back field for field; it also pins the kind and the field list equal. Dropping `inputs` from
  the door's field list reds both cases.
- **Fix round 1 after review 2442** (rulings 23897, F10 ruled 23899): F1 each pending run on the card names its run id, when
  it was recorded, the first 12 hex of its report sha and the verb's trace, and the verb prints the same id and prefix; the
  runbook and the weekly item say to match the prefix before Confirm and discard a run you did not record. F2 as the departure
  above. F3 the card sorts pending runs by id, and the record door refuses a sixth pending run with its own word,
  `quiz-pending-full` (409, `shared/refusal.ts#QUIZ_RECORD_REFUSALS`), counting the pending rows other than one with the
  report's sha so a resend still answers its row. F4 `inputs.frozen_sha256` must equal the top level's. F5 a case and a
  mutant each for the interval's `ci`, the `kind`, the share's numerator alone and an extra key in `inputs` (D19 to D25 with
  F3's cap and its bound; L8 to L10 for F2). F6 the arm and pilot words are named constants, compared with history's own
  beside the settings modes, and the contract runs in both modes. F7 the body limit is six times the verb's 64 KiB plus 4 KiB,
  which `jq`'s worst escaping always fits. F8 as the departure above. F9 the verb treats a set-but-empty `CLAUDECODE` as a
  session. F10 as the departure above. Each new case was measured red against its guard and green with it.
- **A second absorption** (the coordinator's word, after the first CI on 761f1ff5e): other lanes A (#2996) landed a census
  that places every write door in one class, and the record door had none. Main was merged once more and the door took a
  `launch-profile` row in `overlord-other-lanes-census.test.ts`'s `NOT_REFUSED` (box token only; a session holding the token
  could post a pending run, but only the operator's session-gated Confirm makes it count). The census reds without it.

## For PR 1's runbook

`ccrc quiz-record --report <WEEK>/single-report.json --sha <H_REPORT>` is unchanged as a command. If the runbook says the verb
reads the box token or the server's address itself, that line becomes: it posts through `ccrc-api`, and reads neither.
