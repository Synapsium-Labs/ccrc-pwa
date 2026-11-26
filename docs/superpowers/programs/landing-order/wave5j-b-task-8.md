# Wave 5j-b, Task 8: the writer journals the doors, parses before it appends, and tells the coordinators

Plan: `docs/superpowers/plans/2026-11-25-landing-order-wave5j-doors.md`, Task 8, with section 11's C4, C6 and C7
(D-9045, D-9049, D-9050). Base: `origin/main` at `31d5d9ae26`.

## What changed

- `server/src/coord/store.ts`
  - `landingHistory` and `landingHistoryOf` answer the journal's text too (`''` when absent).
  - `writeLandingAuthority` is generic over its command and answers `LandingAuthorityWriteOf<C>`; its body stays in the
    method (the census suites find the writer by that name), and each return passes through one local `answer` cast over
    the three answer shapes (`LandingAnyWrite`).
  - Decide: an `unchanged` pause stops with `changed: false, seq: null`; every built record, of every kind, passes
    `landingAppendParses(hist.text, record, line)` before the append, where `line` is the adapter's exact bytes
    (`JSON.stringify(record)` and LF); a miss stops `landing-record-unparseable`, appends nothing and fences nothing.
  - Apply: a pause reads its flag back; a withdrawal reads its entry back and queues its notices in the same transaction
    (`queueLandingDoorNoticesTx`); entry and order are as before, with `released`.
  - The JSDoc is rewritten for the four kinds and the parse before the append (C4). Task 7's interim throws are gone.
- `server/src/coord/landingDoorsTx.ts`: `landingAppendParses`, the one exported pure check (C6), and
  `queueLandingDoorNoticesTx`, which queues each notice through `queueRunlessNoticeTx` (subject
  `<word>:#<pr>:<sha256 of the identity>`, kind `status`, from `operator`), throws on a `duplicate`, and answers one
  `LandingNoticeOutcome` per recipient of the decision, the entry's first.
- `server/src/coord/landingWrites.ts`: a notice carries the `entryId` it is about, so an outcome names its entry.
- `server/src/coord/landingWritesAct.ts`: three overload signatures over one body; its `write` port is the store's
  generic method type.

## Tests

- `landing-journal-store.test.ts`, a new block: the one `withdraw` record at the answer's seq; the entry's notice and one
  `landing-held` per direct dependant, from `operator`, the dependant waiting and the head `null`; a fault in the second
  mail insert (a trigger) rolls everything back, `landing-db-apply` with `mayApply`, and the replay then applies the
  withdrawal and sends no mail; `unrecorded`; a dependant whose run row's `claimedBy` is a BLOB answers `unreadable` and
  gets no mail while the withdrawal applies; a control-character actor handed to the writer directly is refused
  `landing-record-unparseable` with the journal's bytes, the rows and the fence unchanged; the pure check refuses an
  `order` with a duplicate `after` and a text that leaves the record out (with a CONTROL that passes); a COMMIT fault
  after the append fences every entrance, for a withdrawal and for a pause, and replay clears it, applies the door and
  queues no mail; a pause beside a standing `mainRedHold`; a repeated pause and a resume.
- `landing-control.test.ts`: the two M14 rows again with the pause written by `writeLandingAuthority`.
- `landing-entry-store.test.ts`, the brief's two carries from review run 3806: a withdrawn row bound to run A re-pins at
  run B's verified pin of its pull request, under run B, with a witness and its detail cleared; and the comment above
  `it.each(['landed'])` now says the withdrawn row has cases of its own, because a run-less one is kept and a run-bound
  one re-pins. The carry's mutation row is measured in Task 10's note.
- `landing-writes-act.test.ts` (new): the three answer shapes and their feed events, none for an unchanged pause or a
  refusal, and the port called once with the command and the time.
- No case was inverted.

## Measured

- Red first: the eleven new journal-store cases and the two M14 twins failed before the store change (the store's interim
  throw answered `landing-db-unavailable`). The carry case and the act cases passed at once: the re-pin rule shipped in
  5j-a, and the act's body was already shape-agnostic; their teeth are the mutation rows in Task 10's note.
- Green, each alone: `landing-journal-store` 90, `landing-entry-census` 40, and the rest in the commit's gate run.
- One fixture fault on the way: the COMMIT-fault case first read the pin time after arming the one-shot fault, so the
  read's own COMMIT took it. The case now reads the pin time first and says so.
