# Overlord W1, answer marks PR C: build notes

The build notes of answer marks C (#2900), after PR A (#2879) put the two marks on `decide` and `value` items and PR B (#2892)
on the asks the operator has (R21, spec §9.2.1, C70). The operator's direction of 2026-11-16: "I should still get the checkbox
about Overlord handling it for tasks that come to me, if I believe that that should be the case." The coordinator folds these
into the ledger; departures are by slug, and no number is invented.

## What shipped

- `itemMarkable` (L1, `server/src/coord/answerMarks.ts`) takes the mark. One table, `ITEM_MARKS`, says which boxes each kind
  carries: a question (`decide`, `value`) both, a task (`do`) `could-answer` alone, a `secret` item none. A kind this build
  does not know, or an inherited key such as `toString`, carries none. The hold rule, the open states and the 48-hour Recently
  cleared window are unchanged and shared by every kind that carries a box.
- `itemMarksView` gives a task `{ couldAnswer }` alone, its `unsure` key absent, even when an `unsure` record stands or the
  read failed. `rowMarksView` and the ask rows still carry both marks (`BothMarksView`).
- `POST /api/answer-marks` asks `itemMarkable` for the mark it was sent: `could-answer` on a shown `do` item is recorded;
  `unsure` on one is `not-markable` with detail `no-box`. A `do` item the operator was never shown answers `unknown-item` for
  either mark, so the door is no oracle.
- The console: `answerMarksOf` reads `couldAnswer` alone on a `do` item and drops any `unsure` the field carries; every other
  row, an ask among them, still needs both, so a question missing one fails closed. The box reads "The Overlord could handle
  this" on a task (`answerMarkLabel`; a task is handled, a question is answered). The tick, the settle by record id, the
  rollback and the disabled saved copy are the same component. The explainer names tasks.
- Spec delta: C70's heading and "Which rows", a "mark on a task" bullet under "What `could-answer` feeds" (acting still needs
  the operator's arming, §7.5), the Refusals bullet's `no-box`, Table 11.6's `not-markable` row, the §13 C70 row and the §4
  Waiting on you bullet.

Nothing is migrated: `answer_marks` already takes any kind of row and either mark. No session can write a mark, the
coordinator's box-token items read still carries none (pinned with a marked `do` item now), and no decider of authority reads
one.

## Departures

- `no-box-covers-unsure-on-a-task`: `unsure` on a `do` item answers the existing reason `no-box` ("the item carries no box for
  this mark") rather than a new reason word, so the refusal vocabulary and the code scan's words are unchanged. The spec's
  Refusals bullet and Table 11.6 say so.
- `item-view-type-comment-unchanged`: `shared/ledgers.ts` (`ItemView.answerMarks`) is held by another wave's claim, so this PR
  does not touch it. Its type is still `AnswerMarksView`, whose `unsure` is now optional (the ask rows use `BothMarksView`, which
  requires it), so the wire type is right; its doc comment still says "on a `decide` or `value` item". The next PR that holds
  that file should add "and `couldAnswer` alone on a `do` item".
- `reader-drops-unsure-on-a-task`: the console's one reader ignores an `unsure` that a `do` item's field carries, rather than
  drawing a box the door would refuse. An older console reads a `do` item's `{ couldAnswer }` as unsupported and draws no box:
  additive, failing closed.

## Mutants

`AM-ITEM-2` and `AM-ITEM-4` now name the table's `do` and `secret` rows. New: `AM-ITEM-12` to `AM-ITEM-17` (a task back to no
box, the mark ignored either way, an unknown kind read as boxed, `unsure` on a secret, `unsure` off a value item) and
`AM-VIEW-12` to `AM-VIEW-14` (a task given `unsure`, a task given no field, `unsure` kept as `never`). Every mutant is killed;
the floors stay at 1. By hand, from a saved copy: the door asking `could-answer` whatever it was sent reds the routes suite,
and the console's reader without its task arm, or the task label on `unsure`, reds the words and box suites.
