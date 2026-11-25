# A Do item's tick may carry a note — task note

Programme `overlord`. A small independent PR off `main`. The departure is named by slug, `D-8931`: no
number was issued to this session, so the placeholder stands in the source comments until one is, and `dtbd.test.ts`
is red until then, as it is built to be.

## What was measured

On a fleet, on 2026-11-22, the operator could not finish a Do item from the console.

- A Do item on the Waiting on you list could only be ticked with Mark done, and the tick could carry nothing. The
  console said "Nothing to fill in" (`pwa/src/ledgers/ItemView.tsx`, the Do arm of the panel), and the route refused any
  text with `bad-request`, "a do item takes no answer" (`POST /api/items/:id/tick`, `server/src/coord/ledgersRoutes.ts`).
- Coordinators write Do items whose steps ask for a note: who did each step, by role, and when. A tick that arrives
  with none is sent back, which is what clause 20 tells a coordinator to do with a result that does not hold.
- So one item was ticked three times and another twice, and each came back with "this tick included no note". The
  tick's mail also said "no answer: this item takes none", which told the coordinator a note was impossible while its
  item asked for one.

## What shipped

- **The route** (`server/src/coord/ledgersRoutes.ts`, the tick door). For kind `do`, `answer` is optional. Absent,
  `null`, or a text that is empty once trimmed is a tick with no note, as before, and is never refused. A text of 1 to
  `ANSWER_MAX` characters is the note, trimmed. A value that is not a text, or a text longer than `ANSWER_MAX` (counted
  before the trim, as the decide and value answers are), is refused `bad-request`, the existing word. `optionalText`,
  beside `text`, reads it and tells the three apart. Nothing else about the tick changed: the secret refusal, the
  action refusal, the hold, the open check, the coordinator, the duplicate guard and the one transaction.
- **One path for the note.** From the route on, the note is the tick's `answer`: `tickPlan` builds the mail from it and
  `tickWithMail` stores it on the item in the mail's transaction, as for a decide or value answer. No second writer,
  no new column, no new wire field. The coordinator reads it in the tick's mail ("The operator's answer: …") and in the
  item's `answer` on `ccrc-api items list`. The stored answer is the newest tick's: a later tick with no note clears it.
- **The mail's line for no answer** (`server/src/coord/ledgersMail.ts`). Only a Do item's tick can carry no answer, so
  the line now says "no answer: the operator ticked it with no note (a do item's note is optional)". The old line,
  "this item takes none", is no longer true.
- **The console** (`pwa/src/ledgers/ItemView.tsx`). An open Do item of a live programme draws "Note to the coordinator
  (optional)" with the `Field` the decide note uses, bounded at `ANSWER_MAX`, with a hint: some items ask for one, and
  the coordinator checks the result itself. Mark done is on with the field empty and sends no body; with a note it sends
  the note, trimmed. The character count shows once a note is typed, and a note past the limit is not sent. A Do item
  being checked, closed, or of an ended programme draws no field.
- **The coordinator's reference** (`ccd/coordinator-skill/references/decision-procedure.md`). One passage under "What
  only the operator decides": a Do item's tick may carry the operator's note, where to read it, and that a coordinator
  that needs one asks for it in the item's steps. No pinned clause of `SKILL.md` was touched: none says a Do tick
  carries nothing, and clause 20 stands as written.

## What already tolerated a Do item with an answer

Read, and left unchanged:

- `ItemView.answer` is `string | null` for every kind, and `itemViewOf` is its one builder, for the coordinator's list,
  the operator's routes and the `waiting` frame.
- The console renders no item's stored answer, for any kind. The history line of a tick is "You marked it done".
- The saved copy on the device (`pwa/src/lib/offline.ts`) rewrites a secret item's answer only.
- The continuity card's item facts carry no answer, and its reader of the operator's rulings selects tick mail by its
  subject.
- The tracker inbound lane (`server/src/linear/inboundPolicy.ts#answeredMail`) already forwards any item's answer text,
  or says the item closed without one.
- The answer marks (`server/src/coord/answerMarks.ts`) decide a row's boxes by its kind and never read `answer`, so a
  task with a note still carries `couldAnswer` alone and no `unsure`: a note says what was done and answers no question.
  Only the comments there and in `shared/answerMarks.ts` changed, to say so.

## Tests

- `server/test/ledgers-operator-routes.test.ts`: a Do tick with a note stores it, mails it and shows it on the
  coordinator's list; absent, `null`, empty and spaces-only are a tick with no note; exactly `ANSWER_MAX` is taken; one
  character more, and a value that is no text, are `bad-request` with nothing written; a sent-back item ticked again
  with a note, then with none; a note changes no refusal (an item with an action, a held item, an item already ticked,
  whose stored note stands, and an ended programme), and a task ticked with a note still carries no `unsure` box.
- `pwa/test/item-view.test.tsx` and `pwa/test/waiting-routes.test.tsx`: the field and its hint, the empty and
  spaces-only field sending no answer, the typed note sent trimmed, the count and the limit, no field while checking or
  after the programme ended, and the note reaching `api.tickItem`.
- Every guard was removed in turn and the suite went red each time: seven server mutants (the cap, the type check, the
  blank note, the trim, the note dropped at the route, the old refusal, the old mail line) and eight console mutants
  (the note never sent, a blank note sent, an over-limit note sent, the field removed, the hint removed, the count
  hidden, the field shown while checking, the bound on the field).

## Deviations found

- **D-8931.** A Do item's tick may carry an optional note as its `answer`. It departs from the programme
  ledgers design (spec 2026-10-31, and plan 2026-11-01's PL4, whose route refused an answer on a Do item), where only
  `decide` and `value` items carry an answer.

## Known limits

- The operator cannot read back the note they sent: the console draws no item's stored answer, for any kind. A row in
  the history for it would need the tick's event to carry the answer, which is a change to every kind, so it is left
  for its own change.
- A sent-back item's page, opened again, draws an empty field (a page left open keeps what was typed). The earlier note
  is still stored until the next tick, but the console does not draw it, so a tick with the field left empty sends no
  note and clears the stored one. An operator who was sent back for something else types the note again.
- The field is one line, as the decide note is. A longer account still fits (2,000 characters), without line breaks.
- A console newer than its server (a cached page after a rollback) sends a note the older route refuses with
  `bad-request`; the sentence shown is the general one for an answer the server did not accept.
