# W1a probes, PR A: departures found while carrying out the plan

A note for the programme's coordinator to fold into `w1a-probes.md`'s "Deviations found" and the index plan. Each
departure is named by its plain-words slug; the plan file itself is left unedited, and no number is taken here. PR A is
Tasks 1 to 3, all pure L1: no table, no door, no I/O. It grows neither `server/src/coord/store.ts` nor
`server/src/watch.ts`. Fix round 1 (review 1999) changed the entries marked "fix round 1" below.

## Shapes the plan's interfaces did not fix

- **probe-round-says-short.** The plan types `probeRound` as returning `readonly ProbeQuestion[]`, and also says a thin
  snapshot "answers fewer, and says so". A bare array can only say so by its length. `probeRound` returns a
  `ProbeRound` instead: `{ kind, questions, skipped, short, unmeasured }`. `short` is true when the round asks fewer
  than its kind's least count, and `skipped` names each class it could not ask, with a reason and an `unmeasured` mark.
  Task 7's "skipped, and the round says so" is the same `skipped` line.
- **probe-round-reads-snapshot-notes (fix round 1, F4a).** The plan's signature passes the notes beside the snapshot as
  a bare list, which cannot say a notes read failed. `probeRound(role, snapshot, entropy, kind)` reads the snapshot's
  own `notes` fact instead, so an unmeasured notes read is seen as one.
- **spot-round-is-one-question.** `probeRound`'s `kind: 'spot'` composes a round of exactly one question (Task 6: "a
  `spot` round of one question"). `start` and `compaction` rounds ask three to five. What a spot round is drawn from
  (this generation's rows rather than the snapshot) is Task 6's to pass in.
- **probe-classes-carry-thread.** `PROBE_CLASSES` is Table 3.3.5a's eight classes in its order, then `thread`, C41's
  probe after every renewal (R19). This follows the coordinator's brief on item 195: the vocabulary carries the
  thread class now, so Task 7 adds one word to the coordinator's `probeSet` and no second list. The Overlord's set is
  every class, `thread` included, since C41 gives it the thread probe; its row spells them out, with a comment on why
  (fix round 1, F10). In W1a `probeRound` asks no question of the classes whose rows are not on the card (`update`,
  `decision`, `contradiction`, `application`, `thread`): it skips each, giving a reason.
- **card-item-ever-ticked (fix round 1, F2a).** `CardItem` gains `everTicked: boolean`, true when the item's `tickedAt`
  is set. An item ticked and then returned to `open` keeps its answer, so `open` alone does not mean "no ruling". The
  field is required, so card PR B's gather does not compile until it fills it.

## Readings of the plan, where the card's rows differ from what it assumed

- **temporal-reads-timed-rows.** The plan's temporal example asks "Which of your runs moved last?", but a `CardRun`
  carries no time. The temporal question asks which row came last in a family of timed rows the card does carry: mail
  sent to the session, items it raised, and its notes. A family qualifies with three rows or more and one newest, so a
  question offers at least three choices and has one right answer.
- **mail-asked-as-sent (fix round 1, F1).** A delivery's `at` is when it was queued, which the card renders as "sent";
  an outstanding delivery may not have reached the session yet. The mail question asks "Which of these deliveries was
  sent last?".
- **continuation-reads-note-text.** The plan grades `continuation` by a note's `next`, which the notes piece adds.
  `CardNote` today is `{ id, at, text }`, so a note's text stands in for its `next` until the notes piece widens it.
  The question offers the note's text beside two other notes' text, and is skipped with fewer than three notes of
  distinct text. When the notes piece lands, the continuation pool reads `next` and nothing else changes.
- **claim-decoys-from-own-paths.** For "Which of these paths do you hold a claim on?", the two decoys come from the
  session's own held paths, each held path's directory joined with another held path's file name, and then from its
  runs' plan paths. A decoy that is a held path, or lies under one, is never offered. With fewer than two decoys the
  question is not asked.
- **decoys-fold-like-grading (fix round 1, F5).** Decoys are filtered and deduplicated by the same trim-and-case-fold
  that grading uses, so no decoy grades as the answer (held `a/x.ts` and `b/X.ts` never offer `a/X.ts`).
- **abstention-asks-only-real-unruled-items (fix round 1, F2b; replaces abstention-needs-both-item-reads).** The
  abstention question names a real item of the session's own record (the ledger's open items or the items it raised)
  that is `open` and was never ticked. It never names an id the snapshot does not hold: ids are global, so a
  fabricated one is likely a real, ruled item of another programme. With no such item the class is skipped, with its
  reason.
- **unmeasured-is-never-empty (fix round 1, F4a).** A fact that was not read is never taken for an empty list. A class
  that could not ask because a read failed is skipped with `unmeasured: true` and a reason naming each failed read by
  its own `what`. A round that is short with such a skip is `unmeasured`.
- **grade-folds-every-answer.** `gradeProbe` trims and case-folds the answer, the expected value and the choices alike,
  so a path choice is folded too, not only ids. An answer outside the choices fails even when it equals `expected`.
  That makes a malformed question unpassable rather than silently passable. The decoys fold the same way (above).
- **unmeasured-round-is-its-own-verdict (fix round 1, F4b).** `roundVerdict(grades, unmeasured)` answers `passed`,
  `failed` or `unmeasured`. A wrong answer fails the round whatever else holds, since it is the session's. Otherwise a
  round that failed reads made short is `unmeasured`, never `failed`. Recording it unmeasured, never as a failed probe
  event, is PR B's.
- **empty-round-fails.** A measured `roundVerdict([], false)` is `failed`. A round that asked nothing measured nothing,
  so it never moves a generation to `active`.

## The fitted ceiling

- **no-depth-holds-is-its-own-answer (fix round 1, F3; replaces no-good-depth-fits-zero).** `fittedCeiling` answers
  `{ kind: 'ceiling', tokens, fitted }` or `{ kind: 'no-depth-holds' }`. A bad first bucket answers the second, and no
  number stands for it. How a consumer maps it is the piece that wires the ceiling.
- **bad-depth-caps-the-ceiling (fix round 1, F7; replaces short-step-leaves-the-hard-cap).** The ceiling never sits
  above a depth measured bad. Walking up the buckets, the first bad one caps the tokens at the depth below it. A
  bucket short of `FIT_WINDOW` probes does not stop the walk; it only makes the answer `fitted: false`. This reads the
  plan's second clause ("with any bucket short ... it is the hard cap, not fitted") narrowly: shortness unfits, and
  only a measured bad depth moves the tokens. Review 1999's case (20 good at 50k, 19 at 100k, 20 of 20 failing at
  150k) now answers 100k, not fitted, where it used to answer the hard cap.
- **ceiling-walks-below-the-cap (fix round 1, F6).** The walk examines the buckets that start below the hard cap. The
  bucket starting at the cap would only be probed past the `hard-cap` renewal row, so a class good all the way fits
  the hard cap. A cap at or below the first step examines no bucket, and answers the cap, not fitted.
- **spot-probes-carry-time (fix round 1, F8).** `SpotProbe` carries `at`, and `fittedCeiling` orders by it before
  taking the last `FIT_WINDOW` of a bucket, so a reader may hand the rows in any order.
- **failed-rounds-not-read.** Review 1912 F3's ruling (`probeRounds` counts FAILED rounds, 0 or 1) binds any reader of
  round counts. Neither grading nor the ceiling reads a round count, so nothing here depends on it.

## Guards

- `probeRound`, `gradeProbe` and `fittedCeiling` joined `MUTANT_SETS` (`server/test/sim/probeSets.ts`) with floor 1:
  16, 7 and 11 mutants after fix round 1, each killed by the cases `continuity-probes.test.ts` runs. The added mutants
  cover each finding of review 1999: the mail word, a ticked or closed item asked, a decoy left unfolded, a failed read
  taken for empty, a skip left unmarked, every short round called unmeasured, unmeasured ignored or hiding a fail, no
  depth holds turned into zero, the caller's order trusted, the bucket at the cap required, fitted with nothing
  examined, and a short bucket below a bad one left fitted.
- The six new values (`PROBE_ROUND_MIN`, `PROBE_ROUND_MAX`, `SPOT_PROBE_EVERY_TOKENS`, `FIT_PASS_RATE`, `FIT_WINDOW`,
  `PROBE_NONE`) joined `single-definition/continuity-values.test.ts`'s names. `probes.ts` joined its deciders, and
  50,000 its figures. A second declaration and a spelled `50_000` in `probes.ts` were each measured red, then restored
  from a saved copy.
