# Overlord W2, label queue PR A: the task note

Run 4163, wave 254, ticket `w2-label-queue-a`. Plan: `docs/superpowers/plans/2026-11-16-overlord-w2/w2-label-queue.md`, Tasks 1
to 5 (Task 6, the console section, split off by the coordinator's call 1919; ticket `w2-label-queue-a-console`). This note is
what the ledger should learn; no plan, spec or ledger text is edited here.

## In short

- Server and shared only. The week's move, the vocabulary, the deciders, one migration with its store and `LabelledCases`, the
  weekly lane, and the two doors with every census.
- **The two doors answer at merge**, behind the account gate. No console draws the cards yet, and with no row in shadow (every
  row ships `off`) the read answers an empty list and the lane writes and logs nothing.
- Cards are drawn only when their state resolves. A message ref is read by id, a mail ref by its row. A goals-version ref has no
  reader in this build. A card that does not resolve is skipped and counted under one of three words: `absent`, `unmeasured`,
  `no-reader`.

## Step 0: measured on main `9ccb5f19c2`

| Question | Answer on main |
|---|---|
| Decision model B | Merged. `lineCounts` is exported from `server/src/coord/decisionLines.ts`, and `admitLine` calls it, so there is no move (F14). |
| `LabelledCases`, `DecisionStateReads` | In `server/src/coord/decisionModelPort.ts`. `index.ts` passed an empty labels source (`noLabelsYet`). Its `inlineStateReads` resolves only inline fields and `programme` refs. |
| The row's mode reader | No `decisionRowOf`. The store's `decisionRowRead` (row or `unreadable`) and `decisionRowSideOf` are the owners; this piece reads `decisionRowRead` (point 2). |
| `quizWeek`'s importers | Five: `quiz.ts` itself (the status mail's key), `quizLane.ts`, `continuity-quiz-lane.test.ts`, `history-quiz-unattended.test.ts`, `sim/quizSets.ts`. The plan named three (point 1). |
| Migrations | 134, so this piece's is slot 135. Request record A (#3609) also holds 135: whoever lands second renumbers after one merge of main, on the coordinator's go. |
| `LANE_SCHEDULE`'s `mono` rows | 66 (the plan said 46); 67 with the label lane. |
| Route counts (auth-gate) | 34 route files, 345 routes, 342 HTTP, 120 exempt. Now 35, 347, 344, 120. |
| Card rows | `scope.widens`, `relay.method`, `readback.omits`, `readback.adds` (LQ3, derived from the catalogue). |
| Which card rows resolve today | `relay.method` only (inline). `readback.*` cite a message and a mail. `scope.widens` cites a message and a goals version. |

## The coordinator's eight points, as built

1. **The week's move.** Characterization first: `continuity-quiz-lane` green on main against `quizWeek`. Then one move commit:
   `utcIsoWeek` in `server/src/time/rules.ts`, body unchanged, `quizWeek` deleted. It changes imports, the moved test's names,
   and the mutant set's module and suite. The floor keeps its key (`quiz-week-floor-keeps-its-key`); all five mutants are still
   killed.
2. **The row's mode.** Read through `decisionModelStore.ts#decisionRowRead`; no second reader. The record verdict reader
   (`verdictOf`) is exported from the decision-model store, so there is one.
3. **The gap.** Ruled in call 1913; built as ruled, see below.
4. **"The newest record."** The newest by the store's own order (`id`) among the records of the row's current revision, whatever
   host, model or line generation. No new index. Two records of one state from two hosts pin it (`label-queue-store`).
5. **The floors file.** Twelve new floors at 1; none lowered, no key changed.
6. **The operator-message census.** `GET /api/labels` joins `OPERATOR_MESSAGE_DOORS` beside the chat's thread.
7. **No row in shadow.** Pinned in the lane test (no write, no log line) and the doors' test (empty list).
8. **Harness-neutral.** Everything here is server-owned: a lane, two HTTP doors and coord.db tables. Nothing relies on a
   surface only one agent harness has.

## The gap (call 1913), and point a

- **Readers.** Two thin reads, each answering resolved, absent or unmeasured, never folded, with no SQL outside the owner:
  - a message: the private store's `messageById`, called inside the label read's handler only;
  - a mail: the coordination store's `mailOrigin`.

  The decision model's own `inlineStateReads` keeps `unresolvable` for message and mail refs.
- **Goals version.** No reader, no parse and no spelling here (ticket `label-card-goals-version-reader`). Its cards count under
  `no-reader`.
- **Counts.** All three words are counted on the read's answer (`skipped`) and in the lane's one log line a pass.
- **Point a, the budget.** The lane asks whether each ref still exists through facts reads that return no text: the private
  store's `messageFactsById`, and `mailOrigin`. It never picks a state that is proven absent, unmeasured or has no reader. An
  open card proven absent or with no reader holds no slot (`cardHoldsSlot`, `openSlotsHeld`). A read never closes or writes a
  card.
- **Point b.** A secret-shaped value in a mail body is masked on the card (`label-card-routes`, the masker control).

## Departures, by slug

- `quiz-week-floor-keeps-its-key`: as the plan says (LQ1).
- `card-options-from-the-record`: `cardAnswerVerdict` and `cardView` take a choice row's options. They come from the record's
  `programme` ref field (`cardOptionsOf`), because the catalogue has none. No W2 card row is a choice row.
- `cards-skip-unresolved-states`: point 3. Three skip words in L0 (`LABEL_SKIP_WORDS`), and `skipped` on the read's answer.
- `goals-version-no-reader`: no goals-version reader in this PR.
- `lane-checks-ref-existence`: point a.
- `labels-needed-via-next-candidate`: `nextCandidate` is factored out of `labelsNeeded` and also gives the lane its marking.
  `pickRowFactsOf` marks a case through `lineCounts` itself, so the rule is written once.
- `label-budget-one-rule`: `labelBudget` is the one budget rule, for the pick and the lane's re-read inside the transaction.
- `unreadable-row`:
  - in the lane, its cards hold their slots (doubt keeps the cap) and the row is skipped and logged;
  - on the read, its cards are counted `unmeasured`;
  - on an answer, it refuses 503 `write-failed` with the detail "the row cannot be read".
- `label-lane-quiet-until-asked`: the lane logs one line only when a non-off row has a waiting state, it picked a card, or a
  row's read failed.
- `cross-context-pure-import`: `labelCards.ts` (C6, L1) imports `cardRefNeeds` and `refKey` from `labelQueue.ts` (C5, L1).
  These are pure functions over the decision model's ref vocabulary, and no store is reached across the boundary. The C5 store
  meets the doors' port by shape and imports nothing from C6 (F13).
- `departures-in-the-task-note`: the plan put departures under `plans/`; they are here, by the brief.
- `console-split`: call 1919.
- `file-edits-by-script`: the move commit's importer edits, one export and three agreed packet applications went through a
  script or `patch`, not the editor tools the brief names. Each was a verified exact replacement. Everything after that went
  through the editor tools.

## Mutation rows

| Where | Mutants | Before | After |
|---|---|---|---|
| `quizSets.ts#QUIZ_WEEK_SET`, retargeted to `time/rules.ts` | W1 to W5 | 5/5 killed (main) | 5/5 killed |
| `labelQueueSets.ts`: `cardRowsOf`, `labelsNeeded`, `pickLabelCards`, `labelFor`, `cardShown`, `cardRefNeeds`, `stateDrawability`, `cardHoldsSlot` (with `openSlotsHeld`), `pickRowFactsOf`; `cardAnswerVerdict`, `cardView`, `cardFieldsOf` | 63 | none (new) | 63/63 killed, each set 1.0 |
| Store, by hand: the budget re-read dropped, the label written on not-sure, the newest record keyed by model, the close's compare dropped | 4 | none (new) | 4/4 killed |
| Doors, by hand: the gate dropped from the read, a verdict leaked onto a card, the revision check skipped | 3 | none (new) | 3/3 killed |

## What PR B reads

- `MeasuredLabels`, in `server/src/coord/labelQueuePorts.ts`. It answers labels for a row and revision, and a throw makes that
  row unmeasured for the lane.
- `index.ts`'s `labelMeasured`, an empty source. PR B replaces it with `labelSources.ts`'s composed adapter.
- `labelFor` already ranks `outcome` over `operator-answer` and `overturn`.
- `decision_labels` stores only `label-queue` labels.

## What the console piece reads

Both doors are session-gated, behind the account gate (`{ cap: null }`, no step-up), with no box token.

**`GET /api/labels`** answers `LabelCardsAnswer` (`shared/labelQueue.ts`):

```
{ ok: true, cards: CardView[], open: number, pickedThisWeek: number, week: 'YYYY-Www',
  skipped: { absent: number, unmeasured: number, noReader: number } }
```

- **`CardView`:** `{ id, row, question, fields: { name, quoted, text }[], answers, pickedAt, week }`.
- **`fields`:** in catalogue order. `text` is a string, or a list for a list of ids.
- **`answers`:** a yes-or-no row answers `['yes', 'no', 'not-sure']`. A choice row answers each `{ option }`, then `'none'`,
  then `'not-sure'`.
- **No model answer.** No card carries a verdict, probability, band or line.
- **`open`:** the cards `cardShown` shows. Skipped cards are counted in it.

**`POST /api/labels/:id`**, body `{ answer }`. `answer` is `'yes'`, `'no'`, `'none'`, `'not-sure'` or `{ option }`. It answers
200 `{ ok: true, changed }`, where `changed` is false when the card was already closed.

| Word | Status | Door | When |
|---|---|---|---|
| `auth-off` | 501 | both | sign-in is off |
| `insecure-origin` | 403 | both | a plain-HTTP origin off loopback |
| `unauthenticated` | 401 | both | no live session |
| `unavailable` | 503 | both | the label store is not wired |
| `bad-request` | 400 | POST | an id that is not a positive integer, or an answer the row does not allow |
| `not-found` | 404 | POST | no such card |
| `row-changed` | 409 | POST | the row is off or changed revision, or moved again after the one re-read |
| `write-failed` | 503 | POST | the close threw, or the row cannot be read |

An older server has neither door, so the console should read a 404 on the GET as "no label cards here".

## Known limits

- **An unmeasured card holds its slot.** It holds one of the ten until a facts read measures it, so at most ten can be held. A
  read that answers again frees them, and so does the operator's answer or the row going off.
- **An absent card stays open in the table.** A picked card whose message or mail later disappears holds no slot and is
  skipped by the read, but it stays an open row. Nothing closes it; W2 adds no purge (LQ13's bound, about 520 rows a year).
- **`scope.widens` gets no cards** until a goals-version reader exists.
- **`readback.*` cards show no `doneTest`.** The decision model keeps no inline fields for private-state rows, so it is lost
  when the record is written.
- **No private store means no message cards.** While the private store is absent or cannot be read, every message card is
  `unmeasured`.
- **The tests' type check was not run whole.** The project-wide check over `test/` was killed twice by the shared test slice's
  6G cap. The touched test files were checked through a narrow config instead, and the source type check is clean. CI's type
  check rules.
