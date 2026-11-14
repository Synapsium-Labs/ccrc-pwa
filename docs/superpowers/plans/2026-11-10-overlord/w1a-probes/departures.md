# W1a probes, PR A: departures found while carrying out the plan

A note for the programme's coordinator to fold into `w1a-probes.md`'s "Deviations found" and the index plan. Each
departure is named by its plain-words slug; the plan file itself is left unedited, and no number is taken here. PR A is
Tasks 1 to 3, all pure L1: no table, no door, no I/O. It grows neither `server/src/coord/store.ts` nor
`server/src/watch.ts`.

## Shapes the plan's interfaces did not fix

- **probe-round-says-short.** The plan types `probeRound` as returning `readonly ProbeQuestion[]`, and also says a thin
  snapshot "answers fewer, and says so". A bare array can only say so by its length. `probeRound` returns a
  `ProbeRound` instead: `{ kind, questions, skipped, short }`. `short` is true when the round asks fewer than its kind's
  least count, and `skipped` names each class it could not ask, with a reason. Task 7's "skipped, and the round says
  so" is the same `skipped` line.
- **spot-round-is-one-question.** `probeRound`'s `kind: 'spot'` composes a round of exactly one question (Task 6: "a
  `spot` round of one question"). `start` and `compaction` rounds ask three to five. What a spot round is drawn from
  (this generation's rows rather than the snapshot) is Task 6's to pass in.
- **probe-classes-carry-thread.** `PROBE_CLASSES` is Table 3.3.5a's eight classes in its order, then `thread`, C41's
  probe after every renewal (R19). This follows the coordinator's brief on item 195: the vocabulary carries the
  thread class now, so Task 7 adds one word to the coordinator's `probeSet` and no second list. The Overlord's set is
  every class, `thread` included, since C41 gives it the thread probe. In W1a `probeRound` asks no question of the
  classes whose rows are not on the card (`update`, `decision`, `contradiction`, `application`, `thread`): it skips
  each, giving a reason.

## Readings of the plan, where the card's rows differ from what it assumed

- **temporal-reads-timed-rows.** The plan's temporal example asks "Which of your runs moved last?", but a `CardRun`
  carries no time. The temporal question asks which row came last in a family of timed rows the card does carry: mail
  delivered to the session, items it raised, and its notes. A family qualifies with three rows or more and one newest,
  so a question offers at least three choices and has one right answer.
- **continuation-reads-note-text.** The plan grades `continuation` by a note's `next`, which the notes piece adds.
  `CardNote` today is `{ id, at, text }`, so a note's text stands in for its `next` until the notes piece widens it.
  The question offers the note's text beside two other notes' text, and is skipped with fewer than three notes of
  distinct text. When the notes piece lands, the continuation pool reads `next` and nothing else changes.
- **claim-decoys-from-own-paths.** For "Which of these paths do you hold a claim on?", the two decoys come from the
  session's own held paths, each held path's directory joined with another held path's file name, and then from its
  runs' plan paths. A decoy that is a held path, or lies under one, is never offered. With fewer than two decoys the
  question is not asked.
- **abstention-needs-both-item-reads.** The abstention question names an open item when the snapshot has one, or else
  an id that no item in the snapshot carries. It is asked only when both the ledger and the items raised were read.
  If either is unmeasured, "no ruling on record" cannot be shown, and the class is skipped rather than guessed.
- **grade-folds-every-answer.** `gradeProbe` trims and case-folds the answer, the expected value and the choices alike,
  so a path choice is folded too, not only ids. An answer outside the choices fails even when it equals `expected`.
  That makes a malformed question unpassable rather than silently passable.
- **empty-round-fails.** `roundVerdict([])` is `failed`. A round that asked nothing measured nothing, so it never moves
  a generation to `active`.

## The fitted ceiling

- **short-step-leaves-the-hard-cap.** The ceiling walks the depth buckets from the first step
  (`SPOT_PROBE_EVERY_TOKENS`) up to the hard cap. The first bucket short of `FIT_WINDOW` closed-book probes leaves it
  at `{ hardCap, fitted: false }`, the first bad bucket fits it at the depth below, and good buckets all the way up
  fit the hard cap. Stopping at a short bucket keeps a ceiling from fitting low before the deeper depths are measured.
  A low ceiling would renew sessions before those depths could ever fill.
- **no-good-depth-fits-zero.** A bad first bucket (fewer than 95% of the last 20 probes at 50k passing) fits the
  ceiling at 0, `fitted: true`. No depth was measured good, and the soft budget and least age still pace the renewals
  that follow.
- **failed-rounds-not-read.** Review 1912 F3's ruling (`probeRounds` counts FAILED rounds, 0 or 1) binds any reader of
  round counts. Neither grading nor the ceiling reads a round count, so nothing here depends on it.

## Guards

- `probeRound`, `gradeProbe` and `fittedCeiling` joined `MUTANT_SETS` (`server/test/sim/probeSets.ts`) with floor 1:
  11, 5 and 7 mutants, each killed by the cases `continuity-probes.test.ts` runs.
- The six new values (`PROBE_ROUND_MIN`, `PROBE_ROUND_MAX`, `SPOT_PROBE_EVERY_TOKENS`, `FIT_PASS_RATE`, `FIT_WINDOW`,
  `PROBE_NONE`) joined `single-definition/continuity-values.test.ts`'s names. `probes.ts` joined its deciders, and
  50,000 its figures. A second declaration and a spelled `50_000` in `probes.ts` were each measured red, then restored
  from a saved copy.
