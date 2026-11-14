# Probes, PR B: departures from the plan (Tasks 4 to 6)

The plan is `docs/superpowers/plans/2026-11-10-overlord/w1a-probes.md`. This note records, by slug, each place PR B departs from the
plan's text or settles something the plan left open. No deviation number is taken here: the coordinator folds these into the
ledger.

## Rulings that bind

- **spot-mail-waits-on-the-renewal-act** (the coordinator's ruling on this PR's ask). Task 6 says a spot round queues one system
  mail. The brief says nothing here acts on a session, and the lane's import pin allows nothing that sends. The coordinator
  ruled (ask 415): no mail in this PR. The lane decides a spot probe is due and records the round, in shadow and live alike, so
  the counts show what would be sent; the door, the table and the reader are built in full, so a session can answer a round it
  was asked by hand. The renewal-act piece adds the mail, beside the act that sends the ask-handover mail, when it lifts the
  continuity gate, since it owns the lane's acts. The lane still
  imports nothing that sends, and its import pin grows by four modules, none of which sends (`shared/continuity-card.js`,
  `./card.js`, `./probes.js`, `./probeSchedule.js`).

## The table and the door (Task 4)

- **probe-table-columns**. `continuity_probes` carries the plan's columns and three more: `qid` (the question's id inside its
  round, what the door serves, unique per round), `roundUnmeasured` (the round was short because a read its composition needed
  had failed; `roundVerdict` needs it, so a round is never graded `failed` for the server's read, review 1999 F4b) and a
  foreign key from `generationId` to `continuity_generations`. Two indexes key the lane's read (by generation) and the door's
  (by session).
- **continuity-reads-table**. The plan says the card and notes GETs stamp the caller's last read time and names no storage.
  `continuity_reads` keeps one row per session and door (`card`, `notes`), the newest time, with one writer
  (`stampContinuityRead`). A stamp that fails is logged and the read is still served: the answer then reads `unmeasured`,
  which claims nothing.
- **one-writer-per-fact**. The plan says the probe door writes `continuity_probes`, and Task 5 says the lane opens rounds
  through `openRound`. Both hold: the lane writes a round's questions (`openRound`) and the door writes its answers
  (`answerRound`), each fact with one writer. `writers-map.test.ts` pins both.
- **one-open-round-per-generation**. `openRound` refuses (`open`) while the generation has a round with no answer, compared
  and set in the same transaction, so two passes never open two rounds.
- **probe-door-serves-the-live-generation** (review 2063 F7). The GET serves only an open round of the session's live
  generation (its newest that has not ended). A round left open by an earlier generation is not served; the lane reads rounds
  per generation, so answering one would change nothing.
- **probe-door-pages-like-the-card**. The GET takes `page` and answers one page per call, split by the card's own pager
  (`cardPages`), so a round with long choices stays under the measured tool result cut. Each question and its choices are one
  untrusted block, the choices as JSON strings, so a newline inside one never reads as another choice (review 1999 F11).
- **mask-at-the-door** (notes review 2039 F12). Every question, choice and expected answer is masked once with the card's
  masker before it is served or graded, and so is the answer, so an answer copied from a masked choice and one given whole from
  memory both pass, and no secret goes out. The answer is stored masked.
- **ungradable-question-is-unmeasured** (review 2063 F1 and F6, the coordinator's ruling). Masking runs per text, so two
  choices that differ only inside a secret collapse to one served text, and a restart between the GET and the POST can change
  what the masker catches. A question whose masked choices are not fold-distinct, or whose masked expected answer is not exactly
  one masked choice, grades `unmeasured`, and so does an answer that carries the mask placeholder and matches no masked choice.
  `ProbeGrade` gains `unmeasured` (the door's word, never the session's), and `roundVerdict` reads a round with such a question
  `unmeasured`; a wrong answer elsewhere in the round still fails it.
- **missing-answer-fails**. A question left out of the answer list grades `fail`. An answer id the round does not ask, an id
  given twice, or an answer longer than 2,000 characters is `bad-request`.
- **probe-refusal-statuses**. `probe-none-open` and `probe-closed` are both 409: a state of the world, as `note-not-asked`.
  Another session's round answers `probe-none-open`, never a word that says it exists.
- **probe-vocabulary-in-shared**. `ProbeRoundKind`, `ProbeGrade` (`pass`, `fail`, `unmeasured`) and `BookState` are declared once in `shared/continuity.ts`,
  each derived from one map with one guard, so the store reads every stored word through a guard. `probes.ts` keeps its
  `ProbeKind` name as an alias of `ProbeRoundKind`.
- **claude-md-names-no-continuity-lane**. The plan lists `CLAUDE.md`'s box-token paragraph among the census files. That
  paragraph names none of the continuity routes (the start report, the card door, the note door), and no census reads it for
  them, so it is left as it is; the README's auth paragraph names the probe door beside the note door.

## The lane (Tasks 5 and 6)

- **snapshot-read-back**. A start or compaction round is drawn from the snapshot the generation was carded with, read back by
  `snapshotFactsOf` (beside `snapshotFactsJson`). A fact whose stored shape this build does not read, such as an item from
  before `everTicked` existed, reads `unmeasured`, never a guess: an item read as never ticked would let an abstention probe ask
  about one that carries a ruling.
- **round-opens-in-the-card-read-pass**. The probes run after the card read in the same pass, so the pass that moves a
  generation to `probing` also opens its first round.
- **unmeasured-round-waits**. A round graded `unmeasured` feeds nothing, and no new round is opened over the same frozen
  snapshot, which would be short again. The generation waits in `probing` for the renewal act's deadline. So does a start
  round nobody answers: nothing announces a round yet. That wait depends on a `deadline` feeder the renewal act brings, and
  none is in the tree in this PR (review 2063 F3b; the coordinator carries it to the renewal act).
- **an-empty-round-is-not-opened**. A composition with no question opens no round (the store refuses an empty one) and the pass
  logs it. So `empty-round-fails` from PR A never reaches a generation: a coordinator always has an open run to ask about.
- **empty-try-is-remembered** (review 2063 F4). An empty try is remembered per generation by `emptyTryKey`: a start or
  compaction round's kind and snapshot, a spot round's 50k step. Until the key changes the lane neither draws the round again
  nor logs it. The memo is the caller's (`emptyTries`, beside `retried`), never durable state, so a restart tries once more.
- **compaction-round-reads-the-newest-snapshot** (review 2063 F2, the coordinator's ruling over the plan's "the same
  snapshot"). A compaction round is drawn from the newest snapshot the conversation read (`cardReadOfStart`'s read,
  `roundSnapshotOf`), or the carded one when it has read none since. A row that moved hours before the ask is then asked as it
  now stands. When that read fails, no round opens and the pass names the failure. A start round still reads the carded
  snapshot.
- **spot-round-yields-to-compaction** (review 2063 F3a). An open spot round never blocks a compaction round. The compaction
  round supersedes it: in the same transaction that opens the compaction round, `openRound` closes every question of the spot
  round with no answer, grade `unmeasured` and book `unmeasured`. So the superseded round reads `unmeasured`, never `failed`,
  and a late answer to it is `probe-closed`. An open start or compaction round still blocks every round.
- **compaction-round-window**. "A compaction counted since the last round" counts from the newest start or compaction round's
  ask, or from the time the generation entered its state, whichever is later.
- **probe-failed-reads-compaction-rounds**. `probe-failed` reads true when the newest graded compaction round failed and so did
  the one before it, which was opened only after the card was read again. A spot round is not counted: its question is about
  rows the card does not carry, so a re-read cannot fix it. A newest round graded `unmeasured` leaves the input unmeasured.
- **spot-baseline-is-a-delta** (review 2063 F5, the coordinator's ruling). The next spot round opens once the context is
  50k past the baseline, as the plan says, not at the next 50k bucket. The baseline is the depth the newest spot or compaction
  round opened at, so a compaction resets it to the depth just after the compaction. A compaction round now records that depth
  in `depthTokens` (the column was a spot round's only). With no spot or compaction round yet, the baseline is zero. A newest
  compaction round whose depth could not be read leaves the baseline unmeasured, and no spot round opens until the next mark.
- **spot-rows-since-entered**. A spot round is drawn from the notes the generation wrote and the mail it was sent since it
  entered its state (the plan's `enteredAt`). Every other fact reads as an empty list in that scope, and the round's
  `modelClass` is the generation's model's family class.

## Carried, not here

- **fitted-ceiling-rulings-go-to-the-reader** (review 2063 F8, the coordinator's ruling). `fittedCeiling` has no caller in
  this PR. Three rules wait for the piece that wires the reader:
  - a probe at or past the hard cap must not count in the straddling bucket (review 1999/2001);
  - rows that tie on `at` need a tie-break by row id, since `SpotProbe` carries none;
  - a spot row graded `unmeasured` (a superseded round, or a question the door could not grade) must be dropped before it is
    counted, since `fittedCeiling` reads any grade but `pass` as a miss.

## Measured growth

Recorded in the wave-done mail.
