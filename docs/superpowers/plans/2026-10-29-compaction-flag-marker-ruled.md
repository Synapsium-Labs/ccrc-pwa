# W7 C7h: the compaction flag's marker-only row

- **D-7361 (2026-10-29)** — compaction flag: a marker-only summary carries the flag though `foldsAway` leaves it unfolded.

**D-7361.** Task C7h of `docs/superpowers/plans/2026-10-27-consolidation-w7-pwa.md` (D-7186) names two sources for `ChatEvent`'s `compaction: true`: Claude Code's `isCompactSummary` marker, and the recap pattern the PWA folds by today. The same task's parity row asks that no event `foldsAway` leaves unfolded carries the flag. The two rules disagree on one kind of row: a record Claude Code marks `isCompactSummary` whose text does not open with the recap sentence. The server's compaction fixtures hold one such row (`compactCardFixtures.summary` with a summary in other words). The transcript fixtures hold none, and every summary Claude Code writes in practice opens with the sentence, so the two sources agree on real transcripts.

The build keeps both sources, as the task's Files list and D-7186's definition say. The parity row in `server/test/w7-compaction-parity.test.ts` holds the half that protects today's PWA: every row `foldsAway` folds carries the flag. Its converse holds with exactly one named exception, the marker-only row, listed by source in the test.

This departure changes nothing a viewer sees now. No PWA reads the flag yet, and an old PWA ignores the key (the skew row). When C7i makes the PWA fold on the flag, a marker-only summary will fold where today it renders as text. That change belongs to C7i, and its PR names it.

The plan file is not edited, because merged plans are append-only. This note is the record.
