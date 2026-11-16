# A declined park stops counting once its recipient is back

- **D-8282 (2026-11-11)** — close a declined lifecycle park on its recipient's return: when the revive's recipient reads live and a lifecycle park (`recipient session is <dead lifecycle>`) on an open run gets no heir, `CoordStore.closeDeclinedParks` gives it one closing heir (a new delivery of the mail naming it in `revivedFrom`, born `rejected` with `MAIL_RECIPIENT_BACK_CLOSED_ERROR`, a deliberate-cancel member), so `unreadMail`, the MailStrip, the inbox and `runHealth.mailParked` stop counting it, and both rows stay in the history.

## Why

Spec 2026-10-20 §3 (#125) revives a lifecycle park once its recipient reads live, with an heir that retires the park
in every read (`HAS_HEIR_SQL`). The revive declines a park when it is from an earlier wave (`m.at < rr.dispatchedAt`,
or a run never dispatched), when it is a notice its owner re-sends (the `operator` voice, the stall heads, the
done-claim answers, the server's park notices), when the role moved to another session (D-7901), or when another copy
of the mail is live or acked. Each of those reasons is permanent: `dispatchedAt` only moves forward, and sender and
subject never change. A declined park got no heir and stayed an abandoned park, so the restarted session's run showed
`unreadMail: 1` for good, and so did its MailStrip and inbox. That is #125's symptom, reached through every park the
revive leaves behind.

## Change

- `coord/mailRevive.ts`: `LIFECYCLE_PARK_ERRORS`, the lifecycle park words alone (derived from `DEAD_LIFECYCLES`);
  `REVIVABLE_PARK_ERRORS` spreads it. A lifecycle park was written while its recipient read dead, so a recipient that
  reads live again is a later incarnation of the session. That is the incarnation evidence: a delivery row records no
  harness uuid, and the uuid rotates on `/clear` anyway.
- `coord/store.ts`: `reviveParkedDeliveries` mints its heirs, then calls `closeDeclinedParks(liveIds)` in the same
  transaction. Every lifecycle park on an open run (`ABANDONED_PARK_SQL`, the run joined) to a live recipient that
  still has no heir gets one closing heir: `queueDelivery` with the park as `revivedFrom` and the park's envelope
  verbatim, then `closeHeirDelivery`. The park row is never written. The result is `{revived, closed}`, never `void`.
- `MAIL_RECIPIENT_BACK_CLOSED_ERROR` (`'recipient came back, mail not re-sent'`) joins
  `DELIBERATE_CANCEL_ERRORS_SQL`, so the closing heir is never abandoned, revived or re-queued. The park is retired
  by `HAS_HEIR_SQL`, the fragment every reader already shares. No new predicate and no migration.
- `watch.ts`: the mail pass logs each closure once.

## Not closed, on purpose

- The 24 h ceiling reject, the replay-ceiling park and `recipient not in registry`: their recipient never had a dead
  incarnation. Spec §3.1 keeps the 24 h reject counting until its run closes, and the replay-ceiling park has its own
  ack door.
- The legacy `draft-present` / `enter-ignored` parks: they were written against a live recipient.
- Mail with no run (peer mail, the programme kickoff): the revive never reads it, and a kickoff parked at a chair
  that later came back is a wedge `coordKickoffPendingSince` must keep showing (D-1318).
- A closed run's parks: `ABANDONED_PARK_SQL` already retires them.

## Deviations found

- Migration 40's comment says `queueDelivery` is called with a parent only by `reviveParkedDeliveries`. It is now
  also called by `closeDeclinedParks`, inside the revive's transaction. The migration entry is frozen, so the comment
  is left as it is and recorded here.
- `mail-revive.test.ts`'s "a copy that is delivered and not acked is live" counted the mail's deliveries (2). The
  declined park now gains its closing heir, so the case asserts the closure and that the live copy is the only row
  not `rejected`.

## Tests

`server/test/mail-revive.test.ts`, describe "a park the revive declines is closed once its recipient is back
(D-8282)": the restarted session's earlier-wave park, a never-revived notice and the board's wire `unreadMail`, a
still-current park that keeps counting (recipient not live, or a park that is not a lifecycle park), a current park
revived and not closed, and the closing heir never revived or re-queued. The sweep case runs it through
`FleetWatcher.sweepMail` with a live registry row. `single-definition/core-vocab.test.ts` pins the fifth
deliberate-cancel member.
