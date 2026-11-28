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
| Migrations | 134, so this piece's was slot 135. Request record A (#3609) landed 135 first, so after one merge of main (below) this piece's is slot 136. |
| `LANE_SCHEDULE`'s `mono` rows | 66 (the plan said 46); 67 with the label lane. |
| Route counts (auth-gate) | 34 route files, 345 routes scanned, 342 HTTP, 222 gated, 120 exempt. Now 35 route files, 347 scanned, 344 HTTP, 224 gated, 120 exempt. |
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
- **Point a, the budget.** The lane asks whether each ref still exists. A message is asked through the private store's
  `messageFactsById`, which returns no text. A mail is asked through `mailOrigin`, the ruled mail reader, which reads the mail
  row with its subject and body: the adapter keeps only whether a row came back and discards the text at once, so no text reaches
  the lane, a log line or a table. The lane never picks a state that is proven absent, unmeasured or has no reader. An open card
  proven absent or with no reader holds no slot (`cardHoldsSlot`, `openSlotsHeld`); an unmeasured card keeps its slot until a
  read measures it. A read never closes or writes a card.
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
- `cross-context-pure-import`: two C6 files import from `labelQueue.ts` (C5, L1), each a pure function or a type, pointing
  inward, and no store is reached across the boundary:
  - `labelCards.ts` (C6, L1) imports `cardRefNeeds`, `refKey` and the type `LabelCardRow`;
  - `labelCardRoutes.ts` (C6, L4) imports `cardRefNeeds`, `cardShown`, `handOverOrder`, `readDraws`, `refKey` and the type
    `LabelCardRow`.

  The C5 store meets the doors' port by shape and imports nothing from C6 (F13). `labelQueue.ts`'s header says this.
- `door-port-as-built`: the plan's Task 5 port is `openCards`, `cardFacts` (a card with its row's mode and revision) and
  `close`. As built, `LabelCardStore` is `openCards`, `card`, `rowMode`, `record`, `pickedThisWeek` and `close`: the row's mode
  is read on its own because the read filters every open card by it and counts an unreadable row; the record is read because
  each card is rebuilt from it; `pickedThisWeek` feeds the read's answer. The row's revision is the catalogue constant, read
  in the handler.
- `departures-in-the-task-note`: the plan put departures under `plans/`; they are here, by the brief.
- `console-split`: call 1919.
- `file-edits-by-script`: the move commit's importer edits, one export and three agreed packet applications went through a
  script or `patch`, not the editor tools the brief names. Each was a verified exact replacement. In fix round 1, one edit, the
  new decider cases in `label-queue-refs.test.ts`, went through a script too. Everything else went through the editor tools.

## Mutation rows

| Where | Mutants | Before | After |
|---|---|---|---|
| `quizSets.ts#QUIZ_WEEK_SET`, retargeted to `time/rules.ts` | W1 to W5 | 5/5 killed (main) | 5/5 killed |
| `labelQueueSets.ts`: `cardRowsOf`, `labelsNeeded`, `pickLabelCards`, `labelFor`, `cardShown`, `cardRefNeeds`, `stateDrawability`, `cardHoldsSlot` (with `openSlotsHeld`), `pickRowFactsOf`; `cardAnswerVerdict`, `cardView`, `cardFieldsOf` | 63 | none (new) | 63/63 killed, each set 1.0 |
| Store, by hand: the budget re-read dropped, the label written on not-sure, the newest record keyed by model, the close's compare dropped | 4 | none (new) | 4/4 killed |
| Doors, by hand: the gate dropped from the read, a verdict leaked onto a card, the revision check skipped | 3 | none (new) | 3/3 killed |
| Fix round 1, R1, the lane's budget closure, by hand: it reuses the pass's first counts (both); only the picked count; only the open count | 3 | both: survived the old case (review 4185's mutant 4b, all 11 lane cases green) | 3/3 killed: both by the two new race cases (ten picked, so fifteen in all), the picked count by the answered race, the open count by the other week's open race |
| Fix round 1, C1, the read's cap, by hand: the cap dropped at the read; the order made the store's (no sort); ties by id descending | 3 | the cap absent: the read drew all twenty | 3/3 killed: the cap by both sequences; no sort by the decider case and the rollback sequence; the tie order by the decider case, both sequences and the order-picked case |
| Fix round 1, C6, C7, R5, by hand: the read asks the store before its gate; a message read's unmeasured made absent (review 4185's mutant 5b); a throwing mail read made absent; the newest record keyed by host kind; keyed by line generation | 5 | unpinned by the old cases (review 4185's C6, C7 and R5; its mutant 5b survived all 14 door cases) | 5/5 killed, each by its new case |
| Fix round 1, C3: an unreadable waiting record counted absent; a bad inline part judged drawable | 2 | the code as it was | both cases red on the old code, green on the fix |

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
{ ok: true, cards: CardView[], open: number, heldBack: number, pickedThisWeek: number, week: 'YYYY-Www',
  skipped: { absent: number, unmeasured: number, noReader: number } }
```

- **`CardView`:** `{ id, row, question, fields: { name, quoted, text }[], answers, pickedAt, week }`.
- **`fields`:** in catalogue order. `text` is a string, or a list for a list of ids.
- **`answers`:** a yes-or-no row answers `['yes', 'no', 'not-sure']`. A choice row answers each `{ option }`, then `'none'`,
  then `'not-sure'`.
- **No model answer.** No card carries a verdict, probability, band or line.
- **`open`:** the cards `cardShown` shows. Skipped and held-back cards are counted in it.
- **At most ten cards.** The read draws the shown cards oldest pick week first, then by id, and stops after ten drawn
  (`LABEL_CARDS_PER_WEEK`). **`heldBack`** counts the shown cards past those, whose records were not read this time. A skipped
  card takes none of the ten. An answer for a held-back card is accepted like any other.

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

## The merge of main (#3609)

The request record's first part (#3609) merged with one coordination-database migration at slot 135, the slot this piece
was built at. On the coordinator's go, this branch took one merge of `main` at `1efcbe78cb` (a merge, no rebase). What it changed:

- **The migration moved to slot 136.** The schema keeps the request record's three tables at 135 and puts `label_cards` and
  `decision_labels` at 136, and the comment's re-measure line now expects 135 before this entry.
- **Files both sides touched**, each resolved to keep both:
  - `server/src/coord/schema.ts`: the two migrations, in order.
  - `server/test/coord-db.test.ts`: the version pins go to 136, and both comment lines name `MIGRATIONS[134]` and `[135]`.
  - `server/test/run-close-switch.test.ts`: the undo list drops both table sets and its prose names 136.
  - `server/test/limit-samples-store.test.ts`: the undo list drops both sets; limit samples now sits at `N-11`.
  - `server/test/sim/mutation-floors.test.ts`: both spreads (`LABEL_QUEUE_MUTANT_SETS`, `REQUEST_MUTANT_SETS`).
  - `server/test/single-definition/core-vocab.test.ts`: both handle holders.
  - `server/test/single-definition/writers-map.test.ts`: both sets of tables.
  - `server/test/mail-routes.test.ts` and `server/test/sim/mutation-floors.json`: merged without a conflict and keep both sides.
- **Re-run, each file alone, all green:**
  - the suites the merge touched: the coordination database, limit samples, the run-close switch, the handle holders, the
    writers map, the label store, doors and lane, the mail routes, the stamp census, the request store and the sqlite file;
  - the censuses: auth-gate, box-token, operator-message readers, vocabularies, time ports, row revisions and the rings
    directory;
  - the floors suite (429 of 429, locally) and the source type check.

## Fix round 1 (review 4185, the coordinator's call 1975)

- **R1:** the lane's case that says the budget is re-read inside the pick now races five states outside the outer pick's set,
  twice: once answered at once (the picked count binds) and once left open under another week's key (the open count binds).
  Each keeps the total at ten; a stale closure reaches fifteen (mutation rows).
- **C1:** the plan's sentence "the operator is never handed more than ten open cards" is kept at the read. The budget
  (`labelBudget`) is a pick-time cap: a hidden card holds no slot, so a row going off and back on, or a build rolled back across
  a revision, can bring twenty cards back, and the budget then reads zero (clamped, never negative), so nothing new is picked
  until fewer than ten are open. The read's cap is what keeps the plan's sentence: `handOverOrder` (oldest pick week first, then
  the card's id) and `readDraws` (the weekly constant, never a second number), and `heldBack` on the answer. The answer door is
  unchanged. The cap counts drawn cards: a card skipped as absent never closes, so if it took one of the ten it would hold the
  read short for good.
- **C3:** one word for a record this build cannot read. The store's one reader of a record's refs and inline part
  (`recordPartsOf`) serves the waiting arm, a card's rebuild and the labelled cases, and the lane counts an unreadable waiting
  record `unmeasured`, as the open-card arm and the read do.
- **C6, C7, R5:** the cases named in the mutation rows.
- **S2:** the lane, the store, the ports, the routes file and the shared vocabulary join the time-ports census by name.
- **S7:** the unattended quiz script's comment cites `server/src/time/rules.ts#utcIsoWeek`.
- **Words:** C5 (point a above and the two comments), S4 (`cross-context-pure-import`, `door-port-as-built`), S6 (the four
  counts in Step 0).

## Known limits

- **The readback rows' labels admit nothing yet** (review 4185, C2, a known limit by the coordinator's ruling). A label on the
  two readback rows is stored and lowers what the queue asks for, but admission rebuilds no case from a message or mail
  reference in this build, so those two rows admit nothing yet, and once such labels exist the decision lane says so on each
  pass. The labels are not lost: they are used when the decision model's state reads gain a message and a mail reader (ticket
  `decision-model-state-reads-for-message-and-mail`).
- **The budget is a pick-time cap.** It reads zero while ten or more shown cards hold slots, so the open count can pass ten
  only when hidden cards come back; the read's cap is what keeps the operator to ten cards at a time.
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
