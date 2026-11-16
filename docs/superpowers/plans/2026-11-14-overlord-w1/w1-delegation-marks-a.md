# Overlord W1, answer marks PR A: build notes

The build notes of PR A (Tasks 1 to 4) of `w1-delegation-marks.md` (#2871): the operator's two answer marks, `could-answer`
("The Overlord could answer this") and `unsure` ("I'm not sure of my answer"), on the `decide` and `value` items of Waiting on
you (R21, spec §9.2.1, C70). The coordinator folds these into the ledger; departures are by slug, and no number is invented.

## What shipped

- `shared/answerMarks.ts` (L0): the row kinds, the two marks, the wire view (`never`, `marked`, `withdrawn`, `unmeasured`) and
  `parseAnswerMarkWrite`. `ItemView` gains an optional `answerMarks`, whose absence means "this server cannot mark".
- `server/src/coord/answerMarks.ts` (L1): `itemMarkable`, `markViewOf` and `itemMarksView`, pure.
- Migration 79: `answer_marks`, append-only, and its index. `answerMarkStore.ts` (L3): `recordAnswerMark`, the one writer, and
  `answerMarksOf`, which skips and counts a mark this build does not know and answers a throw as `{ ok: false }`.
- `POST /api/answer-marks` in `registerLedgerOperatorRoutes`: session-gated, no box token, no step-up, no `ccrc-api` row; it
  works dark and records `flag-off`. `not-markable` (409) carries the reason; Table 11.6 gains its row.
- The console: `answerMarkWords.ts` (L1) and `AnswerMarkBox.tsx` (L4), drawn on item rows, cleared item rows and an item's page.

Nothing changes at merge but the boxes. No W1 code reads a mark beyond the waiting view.

## What each item answer carries (F13)

| Answer | Marks |
|---|---|
| `GET /api/waiting` and the `waiting` frame | One read for every listed item; each markable item carries both, `unmeasured` on a failed read |
| `GET /api/items/:id` | The item's marks while it is markable; none on an item past the window, withdrawn or dismissed |
| Tick, act, decline, dismiss and the secret's route | The item's marks read after the move: a dismissed or declined item, and a secret item, carry none |
| `GET /api/programmes/:slug/items` (the coordinator's box-token read) | None, ever: a coordinator never sees the operator's unsure marks |

## Departures found

- **`item-marks-view-in-l1`**: `itemMarksView` joins the L1 file. It composes `itemMarkable` and `markViewOf` for one item, so
  `viewOfItem` (L4) decides nothing about whether an item carries the field. Its cases join the `markViewOf` mutant set.
- **`mark-record-shape-in-l1`**: `markViewOf` takes a structural `MarkRecordLike` (`value`, `at`, `actor`) rather than the
  store's `AnswerMarkRecord` type, so the L1 file imports nothing from L3. The store passes its records as plain rows, as the
  plan says.
- **`view-of-item-takes-marks`**: `viewOfItem` takes its marks as a required last argument, `'none'` or the store's read, so
  each of its callers states what it carries (the table above). Its `secretOf` argument lost its default to allow that; every
  caller already passed one.
- **`parser-answers-a-detail`**: `parseAnswerMarkWrite` refuses with a detail in words, which the door sends as the
  `bad-request` detail, as `parseRankWrite` does.
- **`explainer-through-the-storage-port`**: the once-per-device explainer reads and writes its key through `lib/storage.ts`'s
  `readKey` and `writeKey`, the PWA's one owner of `localStorage` (`pwa-one-owner.test.ts`), which already answer a store that
  throws as "nothing stored" or "not written".
- **`settle-rule-as-fixed`**: Task 4 builds the settle rule in the plan's fix-round wording (F14): pending clears when the call
  resolves, the box keeps the door's answer as `settled`, shows the newer of `settled` and the view's mark by `at`, and drops
  `settled` once the view's mark is at least as new. A view of `never` or `unmeasured` loses to a settled record.
- **`migration-renumbers-at-landing`**: the migration is 79 by position on this branch, after sandbox A's 78. The renewal act
  takes 79 in its landing merge, so this one renumbers to 80 when that lands, on the coordinator's word.
- **`run-close-switch-word-remeasured`**: `run-close-switch.test.ts`'s count word read "twenty-three" while its reopen already
  replayed twenty-four migrations (54 to 77). With sandbox A's 78 and this 79 it replays twenty-six, and the word now says so.
- **`writers-map-call-sites-by-name`**: `writers-map.test.ts`'s call-site census, written for the portfolio's writer, takes the
  callee's name, so the answer marks' writer is pinned by route the same way, with a planted second call in the tick door.
- **`done-without-a-closing-time`**: a `done` item with no `closedAt` (a corrupt row; no writer makes one) is `past-window`,
  never markable. `itemsFor` lists no such row either.
- **`answer-mark-words-admitted`**: `mail-routes.test.ts` scans every quoted kebab word in `server/src/coord`, and the answer
  marks name theirs as literals (a mark's name, the four reasons, `ask-marks-not-yet`). `answerMarks.ts` exports
  `isAnswerMarkKebab`, derived from its own reason map and L0's name guard, and the scan admits it as it admits the other
  lanes' words, never through `NOT_CODES`. The fast run measured the miss first.
- **`mark-label-holds-box`**: each checkbox sits inside its own label, `.wl-mark-hit`, whose rule carries the tap floor, so the
  whole line toggles it; `control-census.test.ts` registers it as `SELECTOR .wl-mark-hit`. `.wl-marks` sets no colour of its
  own, so no rule of the sheet joins `contrast.test.ts`'s uncovered census.
- **`cleared-trail-current`**: `ClearedTrail` gains an optional `current` (default true), so the cleared rows' boxes are off on
  the device's saved copy, as the list's own acts are.

## Growth

Measured against `origin/main` with `GROWTH_CHECK=1`: `server/src/coord/schema.ts` +26, `server/src/coord/store.ts` +3,
`pwa/src/lib/api.ts` +6, `server/src/server.ts` 0, `shared/api.ts` 0. No waiver.

## Red checks

Each was measured red, then restored from a saved copy:

- Task 1: the mutant sets (`AM-ITEM-*`, `AM-VIEW-*`, `AM-PARSE-*`), every mutant killed, including the plan's four (ignore
  `heldUntil`, accept a `do` item, `>` at the window's edge, read `flag-off` as signed in).
- Task 2: insert when unchanged; key the newest record without `mark`; an empty map on a throw; a second `INSERT INTO
  answer_marks` in `ledgersStore.ts` (`writers-map`).
- Task 3: a `checkMailToken` call in the door (`box-token-census`); the gate's actor while dark; no `itemMarkable` in the door;
  `waitingViewOf` throwing on a failed mark read; the coordinator's read passing the marks (F13).
- The fix round: `'past-window'` dropped from `isAnswerMarkKebab`'s map (`mail-routes.test.ts`).
- Task 4: `pending` left set after a refusal; boxes drawn when `answerMarks` is absent; the view always winning over the
  settled answer (F14).
