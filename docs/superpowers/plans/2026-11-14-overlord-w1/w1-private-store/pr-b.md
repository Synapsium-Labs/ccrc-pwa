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
  nudge keeps `resumeIfOwn: true`. Costs one extra capture per operator-nudge attempt.
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
