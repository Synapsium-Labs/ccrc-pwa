# Overlord W1, answer marks PR B: build notes

The build notes of PR B (Tasks 5 and 6) of `w1-delegation-marks.md` (#2871): the operator's two answer marks, `could-answer`
("The Overlord could answer this") and `unsure` ("I'm not sure of my answer"), on the asks the operator has (R21, spec §9.2.1,
C70), after PR A (#2879) put them on items. The coordinator folds these into the ledger; departures are by slug, and no number
is invented.

## What shipped

- `askMarkable` (L1, `server/src/coord/answerMarks.ts`): an ask that reached the operator stays theirs whoever answers it later
  (`reached-is-the-reach-stamp`). A `released` or `declined` ask, or a reached `answering` one, is markable while it is live or
  inside 48 hours of its `releasedAt`; an ask the operator answered, or a reached one its parent answered late, inside 48 hours
  of its `answeredAt`; a reached `stale` ask inside 48 hours of the time it went stale. An ask that never reached the operator
  is `not-shown`; any other state is `not-listed`.
- `askMarkTargets` and `askMarkRead` (L3, `answerMarkStore.ts`): the asks the operator has, newest change first, and one ask by
  id for the door, through one statement and one row rule (`door-and-list-one-read`). Each child's newest row is read once
  (`MAX(id) … GROUP BY childId`, review 2217 F5), the question's first line is taken in SQL (F6), and the portfolio's live-ask
  port answers for the newest row. The list keeps exactly the rows `askMarkable` calls markable, so a newest row past the window
  that is not live is read and not listed. `answer-marks.test.ts` pins that agreement over every state, live or not, newest or
  not, reached or not, in a real `coord.db`.
- `WaitingView` gains two optional lists, `asks` (live) and `asksCleared` (the rest), each row an `AskMarkRow` with both marks,
  through `answerMarksOf('ask', ids)` with the items' `unmeasured` arm. The `waiting` frame carries them too.
- The door's ask arm replaces `ask-marks-not-yet`: `POST /api/answer-marks` with `kind: 'ask'` records the same marks, frame and
  answer as the item arm, with no `await` between its read and its write.
- The console: a question row draws the two boxes when `askMarksFor` finds its session's live ask; Recently cleared joins the
  asks that are not live to its items by time, grouped by programme, each with how it reached the operator, its age and its
  boxes. `unknown-ask` and `ask-unreadable` have their sentences.

Nothing changes at merge but the boxes. No W1 code reads a mark beyond the waiting view.

## Which rows carry no box, and why (question 3)

| Row | Box | Why |
|---|---|---|
| A `do` or `secret` item | No | Not a question the Overlord could answer (Table 6.1a) |
| A root session's own question, a permission prompt | No | No `asks` row exists for it; the spec's Later list |
| A child's ask still `held` | No | The operator was never shown it; its parent may still answer |
| An ask its parent answered | No | It was the parent's answer, never the operator's |
| A question row whose ask is not live (its dialog has gone, or it shows a permission prompt) | No | The boxes would name another question than the row shows |
| A live ask | On its child's question row | Before the answer |
| A released or declined ask that is not live, inside 48 hours | On its Recently cleared row | After it |
| An ask the operator answered, inside 48 hours | On its Recently cleared row | After it |

## What a coordinator sees

The coordinator's box-token items read still carries no marks, and no box-token route reads the asks' marks. As PR A's door
comment and note say, a coordinator is kept from the marks only while sign-in is armed; the ask arm inherits that sentence. Dark,
the waiting view and its frame, ask lists included, are open to any local process.

`writers-map.test.ts` pins one more reader of the marks: `ledgersRoutes.ts#asksViewOf`, the waiting view's ask lists, which only
`waitingViewOf` calls. `FROM answer_marks` is still spelled in `answerMarkStore.ts` alone.

## Departures found

- **`ask-lists-split-live-and-cleared`**: Task 5 names one `asks` list whose rows carry `live`; the plan's architecture line and
  the brief name two optional lists. The view carries both, `asks` (live) and `asksCleared` (every other listed ask), as it carries
  `calls` and `callsCleared`, and every row still carries `live` (`true`, `false` or `'unmeasured'`). The split is decided in L1
  (`askListsView`).
- **`never-shown-ask-is-unknown`**: an ask the operator was never shown answers 404 `unknown-ask` at the door: one `held`, or one
  that moved on with no reach stamp (taken into `answering`, gone `stale`, or answered by its parent; review 2217 F3), where the plan had 409 `not-markable` with `not-shown`, as PR A's door answers `unknown-item` for an
  item never shown (D-8194's no-oracle rule; review 2196 F6). `askMarkable` keeps its `not-shown` reason for the agreement test.
  Table 11.6's `not-markable` row now names `unknown-ask`, for an ask that never reached the operator, beside `unknown-item`. No new refusal word: `unknown-ask` and
  `ask-unreadable` are the question lane's, and `codeOnly` stays empty.
- **`ask-reads-through-the-question-lane`**: the W3 Q3f census (`ask-digest.test.ts`) holds every question-store call outside
  `coord/questions.ts` at its one excluded row. So the door and the view read asks through two new readers there, `askForMark`
  and `markableAsks`, and their two ask-shaped `CoordStore` delegates, `askMarkRead` and `askMarkTargets`, join
  `QUESTION_STORE_METHODS` (32 to 34, `census-w3/questions.ts`). The coordinator ruled this the right home under D-7026 (mail
  21159).
- **`ask-live-in-l1`**: `askLiveOf` (the live rule from the port's answer and the ask's key) and `askListsView` join the L1
  file, so the store's read and the door ask one rule; `rowMarksView` is the one composition of a markable row's two marks, for
  items and asks. Their cases join the `askMarkable` mutant set (`AM-ASK-*`, 21 mutants since review 2217, floor 1).
- **`ask-read-failure-omits-the-lists`**: a read of the asks that throws answers `{ ok: false }`, and the view then carries
  neither list ("this server cannot mark an ask now"), never an empty one that would read as "none". Items still list; a failed
  mark read gives each ask row both marks `unmeasured`, as for items.
- **`ask-unreadable-at-the-door`**: an asks row the box cannot read (its id or run not a positive safe integer, as `askById`
  measures it) is 503 `ask-unreadable` with its detail, as `GET /api/asks` answers it, never an absent row. The list leaves such
  a row out (review 2217 F4). Whether a row is its child's newest is read by id alone, so no other row's value refuses it.
- **`one-live-ask-for-routes-and-frame`**: `waitingViewOf` takes the live-ask port, and `server.ts` builds it once for the
  ledger routes and the `waiting` frame, so the route and the frame list the same asks.
- **`ask-marks-not-yet-retired`**: the door's `ask-marks-not-yet` detail is gone; `isAnswerMarkKebab` admits the four `how`
  words for `mail-routes.test.ts`'s scan instead.
- **`cleared-ask-not-struck`**: a cleared ask is not struck through, because a lapsed or handed-over ask may still wait in its
  session; its row says how it reached the operator (`you answered it`, `its parent passed it to you`, `its parent did not
  answer in time`, `it came straight to you`) and when. A question blanked by the retention reads "A question (its text is no
  longer kept)".
- **`cleared-asks-in-no-programme`**: an ask with no run row has no programme. Grouped, its cleared rows are one group, "Not in a
  programme"; filtered to the sessions in no programme, the trail holds those asks alone.
- **`sentence-table-names-ask-words`**: `item-view.test.tsx`'s sentence-table pin lists `unknown-ask` and `ask-unreadable` as
  the two words the ledger door sends that are not ledger words.
- **`reached-is-the-reach-stamp`** (review 2217 F1, the coordinator's ruling): "a `released` or `declined` ask never leaves
  that state" was false for `released`. `takeAskForAnswer` takes `released` into `answering`, a lapsed ask's parent may answer it
  late (D-5289), and `staleAsk` moves `answering` to `stale` and overwrites `releasedAt`. The ruling: an ask that reached the
  operator stays one they were shown. The measured fact is `asks.reachedOperatorAt`, the push outbox's reach stamp
  (`pushOutboxStore.ts#stampReach`, its one writer, in the release's, the decline's and the released mint's own transaction,
  and never cleared): the cheapest source, a column already on the row the read selects, where the outbox row would be a join.
  `released` and `declined` still say it by their state, so an ask released by an instance with no outbox (a test's), or
  before migration 75 (no backfill), is listed as before while it stays released; once such an ask moves on it reads as never
  reached. A reached `answering` ask stays listed and live; a reached ask its parent answered is listed for 48 hours from the
  answer, with how it reached the operator (`lapsed`), not `answered`, which says the operator answered it; a reached `stale` ask
  for 48 hours from the time it went stale. The false sentence is corrected in `askMarkable`'s comment, in spec §9.2.1 (C70)
  and in `w1-delegation-marks.md`.
- **`door-and-list-one-read`** (review 2217 F4 to F6): the door reads one ask with the list's own statement and row rule
  (`answerMarkStore.ts#askMarkRead`, through `questions.ts#askForMark`), where it read `askById` and `currentAskFor`. So the door
  and the view never disagree, an unreadable row is left out of the list and answered 503 at the door, and an unreadable newest
  row never refuses its child's older ask. `portfolioStore.ts` is unchanged again (`NEWEST_ASK` is no longer exported).
- **`path-guard-w3-releases-pwa`** (the coordinator's ruling on this PR's first fast run): `consolidation-path-guard.test.ts`'s
  W3 guard drops its `pwa/` arm. That arm stood because W3 was the server halves only and the PWA halves were W7's, and
  consolidation W7 has landed (C7a to C7p, the last of them #1948 and #1952). This PR edits `coord/questions.ts` (its two
  readers, `ask-reads-through-the-question-lane`) beside Task 6's `pwa/` files, which the arm refused. The signing-path arm
  stays as it was: a W3-owned file beside the child's verifier, the server's signer or the session hook is still red. The
  CONTROL now expects a W3-owned file beside a `pwa/` path to pass.

## Growth

Measured against `origin/main` (merge base `649ac3f13`) with the growth check's own `netGrowth` over `growthFiles`:
`server/src/coord/store.ts` +1 and `server/src/server.ts` +1; every other listed file 0. No waiver.

## Red checks

Each was measured red, then restored from a saved copy:

- Task 5, the mutant set (`AM-ASK-1` to `-14`), every mutant killed, including the plan's three: live read by child alone
  without the ask's key, the window dropped for an ask that is not live, and the parent's answer accepted as the operator's.
- Task 5, by hand: the store's live read without the newest-row check (the dialog case); the store without the `askMarkable`
  filter (four cases); an empty list on a throw; the door's live read without the newest-row check; the door answering a
  never-shown ask `not-markable`; empty lists on a failed asks read; the view built with no live port.
- Task 6: `askMarksFor` ignoring `live` (the permission-prompt case, in the words and the screen suites); the trail keeping a
  live ask; the box sending `kind: 'item'` for an ask.
- `path-guard-w3-releases-pwa`: the W3 guard with its signing-path check removed reds its CONTROL.
- Review 2217: the mutant set's seven new mutants (the reach stamp ignored either way, the live read dropped for an answering
  ask or added for a stale one, the reach check dropped for an answering or a stale ask, the operator's answer read only by its
  stamp), every one killed; by hand, the store without `answering` among the open states, the list and the door without their
  readability check, the door answering a never-reached ask `not-markable`, and the live ask's boxes without their key (the PWA case where A's tick showed on B).
