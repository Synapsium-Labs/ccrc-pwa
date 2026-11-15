# Probes follow-up: departures and decisions (review 2068's residuals)

The plan is `docs/superpowers/plans/2026-11-10-overlord/w1a-probes.md`; PR B's departures are in `departures-pr-b.md` beside
this note. This follow-up fixes what the second review of PR B (review 2068) left open, F1 to F7, and adds the note F8 asks
for. Each departure or decision is recorded by slug. No deviation number is taken here: the coordinator folds these into the
ledger.

## What each item became

| Item | Fix | Where | Pinned by |
|---|---|---|---|
| F1, the spot baseline after a compaction | A compaction round records the context only from a usage reading newer than the compaction's newest line; with none newer it records 0. A spot round reads the context under the same rule. | `ctxSinceCompaction` (probeSchedule.ts), `newestCompactionAt` (compactions.ts), the lane's `probeReadings` | the measured case (baseline 170k, about 45k after the compaction, the sidecar still at 171k: the next spot round opens at 50k, not 221k), in the schedule's cases and the lane's |
| F2, abstention answers | `maskedAway` applies only to a question with choices. An answer to an id or `none` question that carries a secret's shape is graded, and fails unless it is the expected answer. | `gradeAnswers` (probeDoor.ts) | the sim case that pinned the old `unmeasured`, now `fail`; mutant A13 rewritten for the new guard |
| F3, the POST side of the live generation | The answer door finds a round only in the session's live generation, as the read door does, and answers `probe-none-open` otherwise. | `probeRoundRows` (continuityStore.ts) | a route case: an older generation's round, and an ended generation's, are refused and left unanswered |
| F4, a stalled empty compaction try | A compaction round remembered as empty over the same snapshot no longer holds the spot branch: the schedule reads `compactionStalled` and runs the spot branch as if no compaction round were due. | `probeSchedule`, the lane | a lane case: an empty compaction round over a card naming nothing, then a spot round opens |
| F5, the spot empty-try key | The key carries the count of the rows the spot round is drawn from (this generation's notes and mail), so a new note or mail ends the skip. | `emptyTryKey` | a lane case: three notes arrive in the same 50k step, and the round opens at once |
| F6, a wrong answer inside a masked span | An answer that carries no mask placeholder is graded against the question as stored, so a wrong secret inside a masked span fails; an answer with the placeholder is graded masked, so a copied masked choice still passes. | `gradeAnswers` | a sim case and a route case with two real secret shapes |
| F7, one compaction, one round | The lane counts the compactions that BEGAN in its window, so a `pre` line before a round's `askedAt` and its `post` line after it open no second round. Stateless, so a restart with every memo cold counts the same. | `compactionsBegunSince` (compactions.ts), the lane's `probeReadings` | a lane case, the second pass run as a new process |
| F8, a note | `unmeasured-round-waits` now names the door's `unmeasured` path: a start round the door grades `unmeasured` parks the generation in `probing` until the renewal act's `deadline` feeder moves it. | the probeSchedule.ts header | none: a comment |

## Decisions, by slug

- **compaction-baseline-zero-without-a-newer-reading** (F1). The brief says to record the depth only from a reading newer
  than the compaction line, and 0 when none is newer. This build reads "none newer" as every case where no fresh reading is
  newer: a reading older than the line, a stale sidecar, no sidecar, or compaction lines that could not be read. So a
  compaction round now always records a number. This replaces the part of PR B's `spot-baseline-is-a-delta` ruling that said
  a compaction round whose depth could not be read leaves the baseline unmeasured: that case is now 0, which can open a spot
  round earlier and never later. A compaction round stored before this build with a null depth still leaves the baseline
  unmeasured, as before.
- **spot-reads-the-context-after-the-compaction** (F1). F1 names the compaction round's depth only. With that baseline at 0,
  a sidecar that still holds the depth from before the compaction would open a spot round at once, at the old depth. So the
  spot branch reads the context under the same rule: only from a reading newer than the compaction's newest line, and opens
  none until one comes (unmeasured, never a guess). With no compaction on record, any fresh reading counts, as before.
- **reading-time-from-the-sidecar-ts**. The reading's time is the sidecar's `ts` (the statusline hook's clock, epoch
  seconds) times 1000, compared against the line's `at` (epoch milliseconds). A reading must be strictly newer, so a reading
  in the same second as the line, whose `ts` rounds down, does not count. That errs towards 0.
- **newest-compaction-line**. "The compaction line" is the newest `pre` or `post` line of the main conversation, whichever
  is later (`newestCompactionAt`). A `refused` line is no compaction, and a line of another scope does not count, as in
  `compactionsSince`.
- **compactions-begun-since-by-difference** (F7). `compactionsBegunSince(lines, since)` is the count since one pairing window
  (`COMPACTION_PAIR_MS`) before `since`, less the count of the lines before `since` alone. A post that settles a pre from
  before `since` pairs in both counts, so it adds nothing. Under maximum matching each appended line adds at most one pair, so
  the difference never goes below zero and never falls as lines are appended. It lives beside `compactionsSince` in
  compactions.ts (L1), the lane passes it the window it owns (`compactionWindowStart`), and `renewalDue`'s compaction count
  (since the start report) is unchanged.
- **empty-tries-per-kind** (F4). The empty-try memo was one key per generation, so a stalled compaction try and a spot try
  would overwrite each other, re-trying and logging the compaction round every other pass. It is now one key per generation
  and round kind (`EmptyTries`, `Map<number, Map<ProbeRoundKind, string>>`), declared in the lane and named by watch.ts and
  the simulator. Still a memo, never durable: a restart tries once more.
- **compaction-stalled-is-read-before-the-schedule** (F4). The lane compares the remembered compaction key with this pass's
  compaction key (the compaction snapshot `roundSnapshotOf` would choose) before it asks the schedule, the same comparison it
  already made after. A stalled compaction round supersedes nothing: an open spot round stays open.
- **spot-key-after-its-facts** (F5). A spot try's key needs the rows it is drawn from, so for a spot round the lane reads its
  facts before it checks the memo. A start or compaction try is still checked by its snapshot before any read. The key adds
  the count of the notes and mail since the generation entered its state; the mail list is the newest `CARD_MAIL_MAX`, so once
  that many are counted a new one does not change the count, but such a composition is not empty.
- **raw-grading-when-nothing-was-copied** (F6). `gradeAnswers` now takes the stored questions, the answers as given and the
  masker, and masks inside: it decides per answer whether to grade it as stored (no placeholder) or masked (a placeholder),
  and records the answer masked. `gradableAsServed` still reads the masked question, so two choices that collapse once masked
  grade `unmeasured` whatever the answer: the session could not tell them apart in what it was served.

## Deciders added to the mutation floors

`ctxSinceCompaction` (probeSchedule.ts), `compactionsBegunSince` and `newestCompactionAt` (compactions.ts) are new L1 deciders,
each with its own set in `server/test/sim/probeDoorSets.ts` and a floor of 1 in `mutation-floors.json`. The sets of
`probeSchedule`, `emptyTryKey` and `gradeAnswers` gained mutants for the new rules (C27 to C31, E5 to E8, A15 to A18), and
the mutants whose text moved were rewritten (A2, A3, A5, A7, A12, A13, C10, C13, C24, E4).

## Measured growth

Recorded in the wave-done mail.
