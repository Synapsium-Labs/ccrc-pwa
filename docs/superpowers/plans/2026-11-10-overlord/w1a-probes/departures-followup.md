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

## Fix round 1 (review 2103, the coordinator's rulings)

- **stalled-compaction-baseline** (review 2103 F1, the ruling `compaction-baseline-zero-without-a-newer-reading` on this
  path too). A compaction round that composed empty writes no mark, so the baseline stayed at the earlier spot round's depth:
  a spot round at 150k, a stalled compaction, and a 60k reading after it opened nothing until 200k. While a stalled compaction
  is due, the baseline now counts only the marks asked after the compaction's newest line, and is 0 with none. It is not 0
  outright: the compaction stays due for as long as it is stalled, so a flat 0 would open a spot round after every answer.
  The first spot round after the compaction opens from 0, and the next one 50k past it.
- **compaction-in-flight** (review 2103 F2). A compaction round can open on a `pre` line alone, and a reading written while
  the compaction runs may still carry the old depth. An unmatched main `pre` younger than `COMPACTION_PAIR_MS`
  (`compactionInFlight`, compactions.ts, L1) is a compaction in flight: `ctxSinceCompaction` then answers null, so the round
  records 0 and no spot round opens. An in-flight answer that could not be read is null too. Whether the statusline rewrites
  the sidecar during a compaction was not measured; the rule holds either way.
- **journal-in-the-compactions-key** (review 2103 F2). The compactions memo was keyed on `.compactevents` alone, and the
  `post` line lands in the journal (`.compactions`). The key is now both stamps, through a second port (`journalStamp`).
  An absent journal is part of the key (`absent`), so a session with no compaction yet keeps its memo. A journal whose stamp
  could not be read keys nothing, so the compactions are read every pass, as for an unreadable events file.
- **placeholder-as-wildcard** (review 2103 F3). On a question with choices, an answer that carries a placeholder and matches
  no served choice counts as masked away only when, reading each placeholder as a wildcard, it is the whole of a stored
  choice (both folded, the rest of the answer matched literally). Otherwise it grades `fail`, so a placeholder on a wrong
  answer no longer turns a failed round into an unmeasured one.
- **empty-try-clear-per-kind** (review 2103 F4). A round that opens clears only its own kind's empty-try memo, so a
  remembered empty compaction try outlives a spot round, and the lane drops the memo of every generation that is no longer
  live, once per pass.
- **cross-box-clock-order** (review 2103 F5, recorded with no margin, as ruled). F7's window compares a compaction line's
  `at`, written on the fleet box, with a round's `askedAt`, taken on the server box after the pass's fleet reads. With the
  fleet clock ahead, or a `pre` written between those reads and the ask, a `pre` just before the ask can land at or after the
  window start and open the second round F7 removed. With the fleet clock behind, a compaction just after an ask can fall
  before the window start and be absorbed. A compaction whose `pre` came before the generation became `active` and whose
  `post` came after opens none. F1's comparison (the sidecar's `ts` against a line's `at`) is on the fleet box's one clock,
  and `compactionInFlight` compares a fleet-box `at` with the server's now, over a ten-minute window.
- **spot-key-reads-every-pass** (review 2103 F6, accepted as noted). A spot try that came out empty reads its notes and mail
  every pass, and a read that keeps failing logs every pass where the old memo skipped it.

## Deciders added to the mutation floors

`ctxSinceCompaction` (probeSchedule.ts), and `compactionsBegunSince`, `newestCompactionAt` and `compactionInFlight` (the
last added in fix round 1; compactions.ts) are new L1 deciders,
each with its own set in `server/test/sim/probeDoorSets.ts` and a floor of 1 in `mutation-floors.json`. The sets of
`probeSchedule`, `emptyTryKey` and `gradeAnswers` gained mutants for the new rules (C27 to C31, E5 to E8, A15 to A18), and
the mutants whose text moved were rewritten (A2, A3, A5, A7, A12, A13, C10, C13, C24, E4). Fix round 1 adds A19 to A25
(the wildcard), C32 to C35 (the stalled baseline, the in-flight reading) and X6 and X7 (in flight), and moves A7, A16 and
C30.

## Measured growth

Recorded in the wave-done mail.
