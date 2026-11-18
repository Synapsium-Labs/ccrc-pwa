# Private store B: the builder's departures

The builder's notes for PR B (Tasks 5 to 7) of `docs/superpowers/plans/2026-11-14-overlord-w1/w1-private-store.md`: the prompt
route's record-then-nudge, the boot pass, and `message` as a note key. Each departure is a plain-words slug, never a D-number
(cross-plan ruling X9). This is a new note rather than an append to `departures.md`, because the ledger guard refuses an edit
to an existing plan file outside a ledger branch; the coordinator folds it into the ledger.

## Departures

- **`boot-settlement-takes-the-id`** (Task 6). The plan types `bootSettlement`'s row as `Pick<OperatorMessageRow, 'state' |
  'settledBy'>`, but a measured citation read answers a set of cited ids, so the decider needs the row's `id` too.
- **`nudge-recovery-takes-a-session-id`** (Task 6). The plan types `nudgeRecovery`'s row as `Pick<OperatorMessageRow,
  'sessionId'>`, but the wire row carries no session. The pass reads it with `messageSessionOf` and passes `{sessionId}`;
  a row whose session cannot be read counts as unjudged.
- **`nudge-recovery-unmeasured-before-link`** (Task 6). An unmeasured designation answers `unjudged` even when a nudge mail
  exists, as the plan's sentence reads; the row is left for the next boot.
- **`operator-message-nudge-body-in-shared`** (Task 6). The nudge mail's body is `operatorMessageNudgeBody(id)` in
  `shared/operatorMessages.ts`, so the route (Task 5) and the boot pass say the same words.
- **`boot-pass-takes-coord-store`** (Task 6). `highestOperatorMessageMail` is a `CoordStore` method used through the pass's
  deps as an intersection with `WatcherCoordPort`, not a new `WatcherCoordMember`, so the port's member list is unchanged.
- **`message-fact-is-the-callers-designation`** (Task 7). A message key is `live` for any caller that is the designated session
  now, whatever session the row was recorded for, so a renewed body of the Overlord can still key a miss to a message the
  previous body was sent. The reading carries the row's session (never the text), but the fact does not compare it.
- **`handover-refuses-a-message-reference-in-l1`** (Task 7). `handoverVerdict` itself refuses a thread whose reference is a
  message as `reference-unknown` (after the caps, before the facts), rather than the door leaving the key unread, so the
  decider holds the rule and the mutation floor measures it.
- **`message-key-without-a-store-is-unmeasured`** (Task 7). `noteKeyReader`'s message port is optional: a server that gave it
  none reads a `message` key as `unmeasured` (the door's generic `unmeasured`), never `absent`.
- **`whole-mode-never-types`** (Task 5). The plan and the ruling pass `resumeIfOwn: 'whole'` for the operator-message branch, but
  that mode only presses Enter on a box that already renders the line and never types (an empty box answers `nothing-to-submit`),
  so the nudge would never have been typed. The branch reads the box once before `sendPrompt` (`readBoxText`, as the park probe
  does) and passes `'whole'` only when the box already holds exactly this delivery's line (`resumeRuleOf`, `coord/envelope.ts`).
  An empty box is typed into, and any other text, another message's line included, is a draft stashed as today. The generic
  nudge keeps `resumeIfOwn: true`. Costs one extra capture per operator-nudge attempt. Residual (review 2627 F-2): the parked-box
  probe in `mailPass` still compares the exact line, so a WRAPPED, unsubmitted operator line left by an `enter-ignored` park is
  never retried: it is re-held every 10 minutes and rejected `undeliverable` after 24 hours, and its row stays `queued` (not
  re-nudged, because `unnudged` needs `queuedAt IS NULL`) until the inbox lane lists it.
- **`watcher-port-gains-mark-acked`** (Task 5). `markAcked` joins `WatcherCoordMember` (`coord/ports.ts`): the branch acks through
  the existing delivery writer, and the watcher's port did not carry it.
- **`mail-nudge-census-reads-the-picker`** (Task 5). `single-definition/injected-prompts.test.ts` gains the reference
  `mailNudgeOf(<toId>, <origin>).line` as a `mail-nudge` row bound to `coord/envelope.ts`, because the lane's `sendPrompt` text is
  now the picker's line (the generic nudge's or the operator-message line, both opening with the same head).
- **`send-key-body-field-is-read-by-element`** (Task 5). The prompt act reads the body's key through a field constant (`SEND_KEY_FIELD`), so no
  identifier named like the pane typer appears; no census exception was needed (`send-key-field-is-composed-key` stands).
- **`prompt-route-unavailable-after-the-gate`** (Task 5). A designated-session prompt on a server with no private store or no
  coordination store answers `unavailable` (503) after the account gate and the body checks, so an unsigned caller still sees the
  gate's word, and a bad body still sees `bad-attachment` or `bad-request`.
- **`no-coord-reads-as-not-designated`** (Task 5). A server with no coordination store has no designation to read, so the route
  reads it as `not-designated` (`NO_DESIGNATION`): every prompt takes today's typing path, and an `overlordTerm` is
  `stale-designation`. (A store that exists and cannot be read is `unmeasured`.)
- **`overlord-mark-key-constant`** (Task 5). The mark's key `@overlord` is `OVERLORD_OPERATOR_MARK` in `shared/operatorMessages.ts`,
  so the renewal readings piece reads the same word; the act writes it with W1a's `putOperatorMark` inside the nudge's
  `coord.db` transaction (that writer swallows a failure into `ok: false`, which the act logs without rolling back).
- **`record-message-takes-a-recorded-actor`** (Task 5, the coordinator's ruling in the brief) and **`message-actor-stores-the-subject`**
  (Task 5, the builder's). `recordMessage` checks `isRecordedActor`, as `main`'s designation doors do, and takes the actor from
  the identity port (`identity.operator(gate.actor)`). `operator_messages` has one `actor` column and PR B adds no migration, so
  the row stores `actor.subject`, the same text `actorOf` rendered before; the strength and issuer are not stored. A test mints its
  actor through `attributionIdentity(...).operator(actorOf(...))`.
- **`writers-map-describe-shipped-in-a`**. The brief asks `writers-map` to gain the private store's describe; PR A shipped it
  (`PRIVATE_TABLES`), and PR B adds no SQL writer, so it is unchanged and green.
- **`tests-written-beside-the-code`**. The builders wrote some tests after the code rather than red first. The red evidence is the
  plan's by-hand mutants, each run against its named case and restored from a saved copy (listed in the pull request body).
- **`one-commit-per-task-where-files-allow`**. Tasks 5 and 6 share `messages.ts`, `shared/operatorMessages.ts`, the mutation sets and
  floors, and this file, so those shared hunks ride the Task 5 commit.

## Fix round 1

- **`deliver-at-ack-whenever-still-queued`** (review 2550 F3). `settleOperatorNudge` moves `deliver` on a first delivery, and on a
  replay when the row's state, read through the text-free `messageStateOf`, is still `recorded` or `queued`. A refused move stays
  logged. The boot pass also reads `queuedIds()` and, for each row whose nudge delivery is ACKED in `coord.db`
  (`CoordStore.hasAckedMailWithSubject`, beside `hasMailWithSubject`), moves `deliver`. The boot pass sends that move as actor
  `boot-pass` (see `boot-pass-may-deliver`).
- **`re-nudge-without-a-restart-carried`** (review 2550 F5, no change). A row left `recorded` after the route's `coord.db`
  transaction threw is re-nudged only by the next boot pass. A re-nudge of a recorded, unqueued row without a restart is carried
  to the inbox lane (a periodic sweep over `unnudged()`), where the row is listed anyway.
- **`rollback-notes-row`** (review 2550 F7). After a roll back to a build before this PR, one `continuity_notes` row whose kind is
  `miss`, or whose key kind is `message`, makes `notesOf` fail that identity's read whole (fail-closed, lossless: notes are append-only),
  so the Overlord's notes and the card's notes read `unmeasured` until roll forward. The plan's "Rollback and older builds" section
  names the older server, `operator-model.db`, the nudge mail, the mark and the backups, and not this row.
- **`boot-pass-survives-a-coord-throw`** (review 2550 F8). Each boot-pass row's coordination calls are wrapped as `bootPushOutbox`'s
  are: a throw is caught, printed as one `ccrc-server:` line (the id and the error's message, never a text), counted in `errors`,
  and the pass goes on with the next row. The summary line gains `delivered` and `errors`.
- **`note-key-carries-the-designation-fact`** (review 2550 N2). `KeyReading`'s message arm carries `callerDesignation`
  (`roleOf.ts#designationFactOf`'s word, `live`, `pending`, `none` or `unmeasured`), not a boolean computed in L3; `noteKeyFact`
  decides, and only `live` is the designated session.
- **`boot-nudge-writes-the-mark`** (review 2550 N3). `operatorModel/nudgeQueue.ts#queueOperatorNudge` queues the nudge mail and
  writes the `@overlord` mark in one `coord.db` transaction; the boot pass and the prompt route (`promptRecord.ts`) both call it.
- **`pending-body-is-renewing`** (review 2550 F1). `promptTargetVerdict` refuses a term-less prompt to a session that is the pending
  body of a designate or a rebind with `renewing` (409), reading the fact through `roleOf.ts#designationFactFrom` and
  `designationFactOf`, the way `identityOf` does, so there is no second copy of the rule.
- **`prompt-target-asked-again-in-the-slot`** (review 2550 F1, second window). `sendPrompt` takes an optional `recheck`, asked inside
  the session's queue slot before the first key; `stop` returns the new error word `target-moved` and types nothing. The route
  passes `promptRecheck` (in `promptRecord.ts`) and, on `target-moved`, asks the verdict again and records or refuses; a verdict that
  has flapped back to `type` by then answers `stale-designation`, never a late typing.
- **`generic-nudge-never-resumes-an-operator-line`** (review 2550 F2). The generic prefix resume in `sendPrompt` skips a box whose
  text carries `Operator message <id>:` (`shared/operatorMessages.ts#carriesOperatorMessageMarker`, built from the same head
  `operatorMessageNudgeBody` writes, tolerant of a wrap), so that line is a draft to a generic nudge, stashed and restored.
- **`whole-mode-compares-up-to-whitespace`** (review 2550 F4). `resumeRuleOf` compares the box and the line with `squash`, now in
  `shared/whitespace.ts` (moved out of `send.ts` so the L1 decider can use it without importing an adapter; `send.ts` imports it).
  The parked-box probe in `mailPass` still compares the exact line, as before; a wrapped box there stays parked until it changes.
- **`prompt-body-verdict-is-l1`** (review 2550 F6). `operatorModel/promptBody.ts#promptBodyVerdict` decides the attachments, text
  and send-key checks and their order; `promptRecord.ts` acts on it. It lives in a file of its own because `messages.ts` was
  already near the growth limit; the send key is passed in beside the body because `sendKey` is a pane typer's reserved name.
- **`operator-nudge-extracted`** (review 2550 N1). `operatorModel/operatorNudge.ts#operatorNudgeFor` returns the line, the message
  id and the resume rule for one delivery; `mailPass` holds its cap by that extraction. The `sendPrompt` text argument keeps the
  spelling `mailNudgeOf(d.toId, origin).line` that the injected-prompts census binds to `coord/envelope.ts`.
- **`boot-pass-may-deliver`** (review 2550 F3, the coordinator's ruling). `MESSAGE_EVENT_ACTORS.deliver` is `['mail-lane', 'boot-pass']`
  and the `boot-pass` actor's description gains "deliver, for a queued row whose nudge is acked". The boot pass sends `deliver` as
  itself, so the move is attributed to the act that made it. Table 1's actor column in the plan is one word wider than written.

## Fix round 2

- **`self-ack-settles-at-the-ack`** (review 2627 F-1). A session that acks its own operator-message nudge, before the lane types it
  or while the lane's send is in flight (the lane's `markDelivered` is then refused as terminal), settles the row at that ack:
  `POST /api/mail/:id/ack` calls `operatorModel/nudgeLane.ts#settleAckedOperatorNudge` after an ack that landed, and it moves
  `deliver` while the row is still `recorded` or `queued`, sent as actor `mail-lane` (the ack route is the mail lane's ack). Any
  other mail is left alone, and the route's answer never changes. An ack before the lane typed the line moves the row to
  `delivered` although no nudge was typed; the session read the message's id from its inbox, which is the delivery.
- **`ack-route-lines-under-item-436`** (review 2627 F-1). `server/src/coord/routes.ts` is held by run 1850. Under the operator's
  ruling on item 436 (Overlord PRs edit the files run 1850 holds now, and run 1850 merges them later), this PR adds exactly two
  insertions there and changes nothing else: the import `import { settleAckedOperatorNudge } from '../operatorModel/nudgeLane.js';`
  after `planFactsOf`'s import, and, in `POST /api/mail/:id/ack` right after `const acked = coord.markAcked(id, Date.now());`, one
  comment line and `if (acked.ok) settleAckedOperatorNudge({ coord, operatorModel: deps.operatorModel, now: Date.now(), warn: (l) =>
  console.warn(l) }, delivery.mailId);`. Removing the call reds the self-ack case (measured).
- **`recheck-pinned-inside-the-slot`** (review 2627 F-3). A case holds the session's queue slot, flips the re-ask while the call
  waits, and releases it: the answer is `target-moved` and nothing is typed. Moving the re-ask before the slot is granted turns
  it red (measured by hand).
- **`unreadable-box-may-retype-a-copy`** (review 2627 F-4, residual, unchanged since round 0). When the box read before
  `sendPrompt` fails but `sendPrompt`'s own capture succeeds, an old copy of this delivery's line is stashed, the line typed and
  submitted, and the copy restored as a draft, which a later human Enter would send again (it names the id only).
- **`generic-resume-guard-has-no-decider`** (review 2627 F-5, residual). The F2 guard lives in `sendPrompt`, not in a decider, so it
  has no mutation-set entry; one route case pins it. `carriesOperatorMessageMarker` has no direct unit case, and a wrap inside the
  id's digits would miss it.
