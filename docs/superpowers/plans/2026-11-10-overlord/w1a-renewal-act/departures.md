# Overlord W1a renewal act: departures

Departures are recorded by slug, with no D-numbers: the coordinator mints one for any it keeps.

## rulings-rows (Task 3, measured)

A ruling is the operator's decision, sent to a coordinator. The checkpoint carries a coordinator's last ten, verbatim.
This is what was measured in the code, door by door.

**Rows that carry a ruling (both are system mail from `operator` to the coordinator's own session id, riding no run):**

1. **An item's tick.** `tickNow` in `server/src/coord/ledgersRoutes.ts` queues, in the tick's own transaction, mail of kind
   `answer` whose subject is `itemMailSubject(item)` (`done: item <id>: <title>`) and whose body is `itemMailBody`: it names
   the item and carries "The operator's answer: <answer>" (or says the item takes no answer). The answer is inside the body
   and is not a column anywhere else (`operator_item_events` stores no answer for a tick), so the body is the ruling's text.
   The record keeps the whole body as stored, never a re-parse of it, because reading the answer back out would need a
   second hand-typed copy of the body's wording.
2. **A digest correction.** `correctDigestRow` in `server/src/coord/digest.ts` (`POST /api/digest/correct`) queues mail of
   kind `finding` whose subject is `digestCorrectionSubject(rowKind, id)` (`Operator correction on ask|approval|call <id>`)
   and whose body is the operator's sentence, trimmed, verbatim. It goes to the row's coordinator (the held-for claimant or
   the call's maker), never the child.

**How the two are selected.** By the subject, through two predicates that sit beside their builders and derive from them:
`isTickMailSubject` (`ledgersMail.ts`, from the same head constant `itemMailSubject` uses) and `isDigestCorrectionSubject`
(`digest.ts`, from `digestCorrectionSubject` itself, so `Operator correction on` still has one holder). The read is
`mail.fromId = 'operator'`, `mail.toId = <the coordinator's session id>`, `mail.runId IS NULL`, newest first, with the
predicates applied row by row until the cap is reached. The mail kind is not selected on: the stall watch raises
`operator` mail of the kinds a stall notice carries, so a kind alone would not isolate rulings, while the subject does.

**Doors that send the coordinator no ruling (and so have no row here):**

- `POST /api/questions/session-<id>/answer` (the operator's answer door) presses the answer into the child's pane and
  settles the ask row; it queues no mail to the coordinator. A coordinator's own `rule` on an ask or approval is the
  coordinator's decision, not the operator's. The digest line it later appears on is what the correction door answers.
- The ask and approval nudges (`askNudgeSubject`, `approvalNudgeSubject`, kind `question`) are the watcher waking a parent
  before the operator's phone is asked: not rulings.
- `operator`-sender mail of kind `status`: stall checks and stall notices, landing notices (`dequeued`, `merged`),
  the program kickoff, a dead-dispatch abandon, a review release, a run-close refusal, an end request and its ended notice
  (to the asker), the tmp sweep and child-reclaim notices, `untold` notices. All are raised by the watcher or by a lane
  on the operator's behalf, or tell a session something happened; none is the operator deciding something for the
  coordinator.
- `POST /api/items/:id/act` and `decline` mail the asker of an end request, not the coordinator.

**Excluded by construction:** mail not from `operator` (a session cannot speak as the role), mail addressed to anyone but
the coordinator, mail on a run (`runId` not null), and any `operator` mail whose subject neither predicate names.

## outcome-from-the-start (Task 3, measured)

The card's checkpoint reads the checkpoint of the generation that ended last for the identity, and only when that
generation's `outcome` is `renewed`. `startOutcome` in `server/src/continuity/generationStart.ts` writes `renewed` on the
generation a start ends when that generation was `clearing`, that is, when a renewal's `renew` act asked for the start;
every other ending is `crashed`, `swapped`, `woken`, `woken-elsewhere`, `unmeasured` or `cleared`. So a crash, a swap or a
wake shows no checkpoint (the notes still ride the card by their own fact), and only a planned renewal hands the successor
its checkpoint. The outcome is written when the successor is minted, so `checkpointBefore` reads it from the predecessor's
own row and no state column.
