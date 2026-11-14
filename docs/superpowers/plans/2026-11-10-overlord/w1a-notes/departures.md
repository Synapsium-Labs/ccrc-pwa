# W1a notes: departures from the plan

The notes piece of the Overlord's W1a (`docs/superpowers/plans/2026-11-10-overlord/w1a-notes.md`, Tasks 1 to 3). Each
entry is a departure from the plan's text, or a decision the plan left open, named by a plain-words slug. None carries a
D-number: the coordinator mints one for any it keeps, and folds these into the programme's ledger.

The plan's own decisions (`note-keys-in-w1a`, `handover-table`, `revision-by-unique-index`, `handover-only-when-asked`)
are built as written.

## Rulings from the brief that change the plan's text

- **unmeasured-key-is-unmeasured.** A key, a revised note or a handover reference the door could not read answers the
  generic `unmeasured` (502), never `note-key-unknown` or `reference-unknown`. The plan had `noteVerdict` answer
  `note-key-unknown` for an unreadable key ("the door says could not check"). The brief's null rule says that a key that
  cannot be read is `unmeasured`, never `reference-unknown`, and the note door follows the same rule so that one condition
  never has two words. Spec Table 13.2's `note-key-unknown` row ("or cannot be measured") now reads wider than the door:
  worth a line in the spec amendment.
- **notes-use-the-cards-authority-line.** A note sits behind the card's one authority line (`CARD_AUTHORITY_LINE`) and
  `CARD_TEXT_PREFACE`, not the plan's own sentence ("Notes are what a session wrote; authority comes only from rows."), as
  the brief rules: one line on authority per card.

## Decisions the plan left open

- **close-needs-no-live-key.** A close (`closes: true`) needs a live note of the caller's to close, but no live key: it
  takes the closed note's key and kind, and its own `key`, `kind`, `waitsOn` and `next` are not read. A note whose run
  closed would otherwise count against the cap of 200 forever.
- **revised-is-a-key-fact.** `noteVerdict`'s fourth argument is the revised note's `KeyFact` (or `not-revising`), not the
  plan's `boolean | null`: an unreadable revised note is then `unmeasured`, not folded into "not live" (the no-overloaded-null
  rule). `revisedNoteFact` (L1) decides it from what the door read.
- **handover-refs-are-live-and-yours.** A handover thread's reference must be a live row of the caller's, measured as a
  note's key is (`noteKeyFact`), not merely a row that exists. A handover lists open threads, and one key rule serves both.
- **unmeasured-count-refuses.** A new note when the live notes could not be counted refuses `unmeasured`, rather than skip
  the cap. A revision or a close needs no count.
- **key-fact-on-every-read.** `GET /api/sessions/:id/notes` and the card both carry each note's key as it is now (`live`,
  `gone`, `not-yours`, `unmeasured`), so a note keyed to a row that is gone is reported as such, never dropped (the brief's
  null rule). One reader, `noteKeyReader` (L3, `continuity/noteKeys.ts`), measures a key for the door and the card alike.
- **notes-get-masked-by-the-answer-hook.** The notes GET is masked by the one answer hook (`MASKED_GET_ROUTES` in
  `server.ts`), not inside its handler, so `secret-mask.test.ts` needed no change. The card's notes stay inside the card's
  own masking (masked once, whole, before hashing and paging), so a note never meets a second masker.
- **handover-found-by-place-in-line.** The card's checkpoint is the handover note of the generation that the identity's
  live one replaced, found by its place in the identity's line (`handoverBefore`: the newest row older than the live one),
  so no read of a state column is needed. When that generation wrote no note, the checkpoint is null and never an older
  note. It stays on the card until the next renewal.
- **card-note-carries-next.** `CardNote` carries `kind`, `key`, `keyFact`, `waitsOn` and `next` in place of one `text`, and
  `CardCheckpoint` carries the handover note (`{ at, handover }`) in place of `text`. The probes piece's continuation class
  now reads a note's `next`, as its slug `continuation-reads-note-text` said it would once this piece landed
  (`server/src/continuity/probes.ts`, `server/test/sim/probeSets.ts`).
- **note-close-is-the-add-route.** `ccrc-api note close` is a row of its own on the same route as `note add`, its body
  `{"revises":<id>,"closes":true}`; the server tells them apart by the body. `note handover` is the plan's `handover`
  verb, in the `note` group, because every client row is `<group> <verb>`. The three POST rows take the `calls.record`
  fill's rule: the pane's pair is spliced into the body, and a body naming either key is refused, unsent.
- **notes-render-newest-first.** The card renders notes newest first and ranks them by recency, so trimming drops the
  oldest first and the left-out line counts them. The card piece had rendered them oldest first.
- **status-words-list.** The status words the handover note drops are `HANDOVER_STATUS_WORDS` in `continuity/notes.ts`: done,
  merged, fixed, approved, complete, completed, finished, landed, shipped, resolved, passed, green, closed, released,
  accepted and verified, matched as whole words in any case. The spec names the rule, not the list.
- **no-claude-md-line.** The plan named `CLAUDE.md`'s box-token paragraph among the census files. The three doors are
  box-token machine lanes in `auth/gate.ts`'s EXEMPT table, which that paragraph does not enumerate (the card door and
  the start report are not in it either), and `box-token-census.test.ts` does not ask for them there. So `CLAUDE.md` is
  unchanged.

## Measured

- Migration slot: `origin/main` had 69 entries at `44f68ea36`, so this is entry 70. Launch profiles PR B (#2794) adds a
  migration too: whichever lands second merges `main` once, takes the next slot and re-counts.
- `server/src/coord/schema.ts` passes 3,000 lines with migration 70 (2,968 to 3,006), so `growth-check`'s census asked for it in
  `GROWTH_FILES` (`server/test/growthCheck.ts`), and it is listed there. Its growth here, 38 net lines, is under the 40 allowed.
- `server/src/coord/store.ts` grows by 9 net lines (the five one-line delegates and their import), under the 40 allowed.
- The partial unique index, measured: with it dropped, the store-level case of two revisions of one note goes red
  (`continuity-notes-route.test.ts`, "two revisions of one note").
- The door reads a generation's state only through `effectiveGeneration`. With the door reading `row.state` instead, the
  shadow-column case goes red ("a shadow walk at checkpointed is asked though `state` reads active").
- The card with 200 notes of 500 characters, in ASCII and in four-byte characters: every page is at most
  `CARD_PAGE_CHARS` code points and more than 1,000 bytes under `TOOL_RESULT_CUT_BYTES`, and the read records.
