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
  (`server/src/continuity/probes.ts`, `server/test/sim/probeSets.ts`). After review 2039 (F1), the pool takes only threads
  whose `next` is not blank, as subjects and as decoys, so a blank answer never passes.
- **note-close-is-the-add-route.** `ccrc-api note close` is a row of its own on the same route as `note add`, its body
  `{"revises":<id>,"closes":true}`; the server tells them apart by the body. `note handover` is the plan's `handover`
  verb, in the `note` group, because every client row is `<group> <verb>`. The three POST rows take the `calls.record`
  fill's rule: the pane's pair is spliced into the body, and a body naming either key is refused, unsent. After review
  2039 (F7), the pair goes last, so a parser that keeps the later of two duplicate keys keeps the pane's. That covers a
  spelling of `byId` that the textual test misses.
- **notes-render-newest-first.** The card renders notes newest first and ranks them by recency, so trimming drops the
  oldest first and the left-out line counts them. The card piece had rendered them oldest first.
- **note-field-blocks.** Each note field rides an untrusted block of its own, `next` first (review 2039, F2). Each field is
  escaped to one line, as `oneLine` escapes it, so a newline cannot pose as another field's line (F9). Each block is capped
  at the field's cap times the widest escape (`NOTE_FIELD_CAP_BYTES`, 5,000 bytes), so a field at its cap is never cut,
  whether in four-byte text or escaped. The card piece's single 1,024-byte block lost `next` whole once `waitsOn` passed
  about 1,014 bytes. A block's pointer names the exact command that reads that note:
  `ccrc-api note list <session> --before <id + 1> --limit 1`.
- **note-list-pages.** `GET /api/sessions/:id/notes` and `ccrc-api note list` page (review 2039, F2). The query takes
  `before`, a note id (exclusive), and `limit` (default 20, at most 200, `NOTE_LIST_LIMIT`). The answer carries `more`.
  A page's notes stay within `NOTE_LIST_PAGE_BYTES` (the tool result cut less 4,000 bytes), and the first note is always
  included. The decider is `notesPage` (L1), with its own mutant set. Measured: 200 notes of 500 characters, in ASCII and
  in four-byte text, page through with every answer more than 1,000 bytes under the cut. Each note is read once, newest
  first.
- **thread-needs-a-next.** `noteVerdict` refuses `bad-request` in two cases (review 2039, F1 and a nit):
  - a thread whose `next` is blank after trimming;
  - a close that names no note in `revises`.

  A caution may have a blank `next`, because it names no next act. A close is checked against neither rule, since it takes
  the closed note's fields. `bad-request` joins `NoteVerdictRefusal`, with one detail covering both cases.
- **handover-body-cap.** A handover note's whole JSON is capped at `HANDOVER_MAX_BYTES` (16,384 bytes) and refused
  `note-too-long` above it (review 2039, F3). The field caps alone allowed a note of megabytes. Raising the door's body
  limit to 4 MiB makes a handover at every field cap parse. So it is refused `note-too-long`, never 413. The box token is
  checked before the body is read. With 200 threads, a thread can now carry about 80 bytes. The count caps still stand,
  but the byte cap binds first. The card renders the checkpoint as the tone, then the cautions, then the threads. Its
  pointer now says the full input is "stored on the handover row, which nothing reads back in W1a" (the coordinator
  ruled: no read door in W1a; the renewal act reads it later).
- **handover-resend-answers-stored-count.** A second handover for one generation answers `fresh: false` with the stored
  row's `dropped` count, never the refused attempt's (review 2039, F6). `putHandover` reads it back on the conflict.
- **refusal-detail-names-the-note.** The note door's refusal detail names the key only when the revised note, if any, is
  a live note of the caller's. Otherwise it reads `(note <revises>)` (review 2039, F5). That covers a missing note,
  another identity's note, and a closed or superseded one. Before this, closing another identity's note answered with
  what that note was keyed to, and closing a missing note labelled its id as a run.
- **revision-may-rekey.** A revision may change a note's key and kind (a run to a programme, a thread to a caution): it
  is a new note that supersedes the old one, and the plan is silent. A close keeps the closed note's key and kind.
- **one-programme-slug-grammar.** A programme key's slug is held to `shapeProgramSlug` (`shared/api.ts`), exactly (a slug
  it would trim is refused). It replaces the door's own looser `KEY_SLUG_RE`, under the consolidate rule (review 2039, a
  nit).
- **status-words-list.** The status words the handover note drops are `HANDOVER_STATUS_WORDS` in `continuity/notes.ts`: done,
  merged, fixed, approved, complete, completed, finished, landed, shipped, resolved, passed, green, closed, released,
  accepted and verified, matched as whole words in any case. The spec names the rule, not the list. After review 2039
  (F8):
  - Matching runs on the text NFKC-folded, with its format characters (`\p{Cf}`) stripped. The stored text is that fold.
  - Each dropped word leaves a visible `[status word dropped]` (`STATUS_WORD_MARK`), so `not done` does not read as `not`.
  - No spacing is closed up on any line.

  Inflections (`merging`, `succeeded`) and look-alike scripts are still not matched. This is defence in depth: the
  checkpoint is fenced behind the card's one authority line.
- **no-claude-md-line.** The plan named `CLAUDE.md`'s box-token paragraph among the census files. The three doors are
  box-token machine lanes in `auth/gate.ts`'s EXEMPT table, which that paragraph does not enumerate (the card door and
  the start report are not in it either), and `box-token-census.test.ts` does not ask for them there. So `CLAUDE.md` is
  unchanged.

## Review 2039: what this round did not change

- **F4**, a generations read that fails whole: no change, because it is the documented all-or-failure rule, as the
  coordinator ruled.
- **F10**, migration slot 70: `origin/main` still had 69 entries when this round was pushed, so nothing was re-pinned. If
  this lands second, it merges `main` and pins its slot against the first lander's entry, not only "after card's".
- **F11 and F12**: carried to the renewal act's and probes PR B's briefs. They are not changed here.
- **Nits recorded, not built:**
  - Revisions grow the table without bound: a revision skips the cap, and there is no retention in W1a.
  - A programme key never reads `gone`: a finished programme reads `not-yours`.
  - The identity's live generation is found in two places (`routes.ts` and `cardFacts.ts`).
  - Identity equals session id in W1a only.

## Measured

- Migration slot: this is entry 71. Timers PR A (#2797) landed first, at `dc2a6826a`, and took entry 70
  (`continuity_timers`). This branch merged `main` once and moved the notes entry after it. The coordinator ruled the
  move (review 2039, F10). `coord-db.test.ts` pins the slot to the timers' entry plus one, and to 71. The sites moved:
  - `schema.ts`, the entry's header, its `user_version` sentence and its "must print 70" line;
  - `coord-db.test.ts`, the version pins and the comment chains;
  - `run-close-switch.test.ts`, the undo comment, the DROP list (`continuity_timers` too) and "eighteen";
  - `writers-map.test.ts`;
  - the store comment.

  Launch profiles PR B (#2794) also adds a migration. If it lands after this one, it takes 72.
- `server/src/coord/schema.ts` grows by 38 net lines over `main` with entry 71 (3,005 to 3,043). It was already in
  `GROWTH_FILES` (`server/test/growthCheck.ts`) on both sides, and 38 is under the 40 allowed.
- `server/src/coord/store.ts` grows by 9 net lines (the five one-line delegates and their import), under the 40 allowed.
- The partial unique index, measured: with it dropped, the store-level case of two revisions of one note goes red
  (`continuity-notes-route.test.ts`, "two revisions of one note").
- The door reads a generation's state only through `effectiveGeneration`. With the door reading `row.state` instead, the
  shadow-column case goes red ("a shadow walk at checkpointed is asked though `state` reads active").
- The card with 200 notes of 500 characters, in ASCII and in four-byte characters: every page is at most
  `CARD_PAGE_CHARS` code points and more than 1,000 bytes under `TOOL_RESULT_CUT_BYTES`, and the read records.
- Review 2039's fixes, each measured red and then restored from a saved copy:
  - the handover door without its body limit (413 instead of `note-too-long`);
  - the refusal detail naming the key;
  - `before` ignored;
  - the attempt's count answered in place of the stored one, at the door and at the store.

  Every mutant in the new sets is killed (`mutation-floors`, 44 sets):
  - the decider sets: N13 to N15, H14 to H18, K14 and K15, and P1 to P6 for `notesPage`;
  - the probe set: R21 (cautions taken) and R22 (a blank `next` taken);
  - the card's fence: M1, M7 and M2, retargeted to the per-field blocks.

  One door guard was dropped as unkillable: taking a close's key only from a live note. The verdict already refuses that
  close, and the detail no longer names the key.
