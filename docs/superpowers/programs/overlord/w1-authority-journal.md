# Authority journal B: the builder's departures

These are the builder's notes for PR B of the Overlord W1 authority journal plan
(`docs/superpowers/plans/2026-11-14-overlord-w1/w1-authority-journal.md`), Task 5: the witness tuple, the epoch and the verdict.
Each departure from the plan's text, or ruling added after the plan was written, is named by a plain-words slug, never a D-number, so
the coordinator can allocate numbers when it folds them into the plan.

## Departures

- `witness-carries-told-narrowings`: the tuple carries a `told` field, the operator's rung and the standing latches as of the tuple's
  epoch (latches sorted by cause, each cause once). A later Confirm can then keep a narrowing the operator was told took effect. The
  coordinator ruled this after the plan was written, so the plan's interface lacks the field.
- `privacy-empty-is-its-own-word`: the tuple's `privacy` is `WitnessHead | 'absent' | 'empty'`, and the port answers `empty` beside
  `absent`. The plan's port answers `absent` for an unwired journal, but a wired journal can hold no record, and folding the two into one
  value would be an overloaded null. A witness holding `empty` contradicts no head the server reads; a witness holding a head against a
  server reading `empty` is a `witness-heads` mismatch.
- `negative-term-reads-unmeasured`: an epoch term below zero (a journal shorter than the last Confirm says it was) answers `unmeasured`,
  never a clamped zero, because the epoch cannot then be measured as a count of records since the base. The verdict reads it as
  `unmeasured: journal`.
- `told-and-offer-answers-are-typed`: `currentWitnessTuple` answers `{kind: 'tuple'}` or `{kind: 'unmeasured', why}` instead of a null,
  and it parses its own tuple back before offering it, so a tuple the console would refuse is never sent.
- `rows-4-and-5-are-exclusive`: the plan's row 4 (base below) and row 5 (base above, or equal with a higher term) cannot both match, so
  a literal swap of the two is an equivalent mutant. The mutant set instead moves the term comparison ahead of the stale row, which the
  suite kills with a witness whose base is below the server's and whose terms are higher.
- `row-3-order`: when several server facts are unmeasured, the authority journal is named first (`journal`), then the privacy read
  (`privacy-head`), then an epoch that is unmeasured on its own (`journal`).
- `off-volume-ignores-boot`: `offVolumeHeld` takes the boot nonce but does not read it. A holder under this boot still holds a narrowing
  off the volume; only `witnessVerdict`'s `counts` asks whether a restore is ruled out.
- `witness-rungs-spelled-in-l0`: `shared/authorityWitness.ts` spells its own rung list, because L0 files import nothing. The server's L1
  witness file holds a compile-time mutual-assignability check against the ladder's `Rung`, and the suite checks the two runtime lists
  are equal and in the same order.
