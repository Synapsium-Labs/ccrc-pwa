# The push outbox, PR B: departures found while building

Plan: `docs/superpowers/plans/2026-11-14-overlord-w1/w1-push-outbox.md`, Tasks 4 to 6 (PR B, the sender and the move).
PR A's departures are in `departures.md` beside this note. Each departure is named by a plain-words slug; none carries a
D-number. The coordinator folds them into the plan's deviation ledger.

## Rulings carried from PR A's review (2119)

- **held-drain-insert-is-the-senders** (F6). `insertBoundRowInTx` takes the move's actor, `raise` by default. The held
  drain's insert (`pushOutboxStore.ts#reachHeldItem`) passes `sender`, so the row of `OUTBOX_TRANSITIONS` it is checked
  against is `{ null -> silent, sender }`.
- **local-refusal-is-unsendable** (F10). `SubscriptionVerdict` gains `unsendable`: web-push refused the send on this box
  before any request existed (a stored subscription with bad keys). `PushService.notify` tells it apart on the error path
  only, by asking web-push's own request builder (`generateRequestDetails`, which sends nothing) once more: a builder
  that throws is `unsendable`, anything else keeps today's `no-answer`. `outboxNextState` reads `unsendable` as it reads
  `refused-for-good`, so a row whose only answers are `unsendable` (or `gone`) seals `failed`; beside a `no-answer` it is
  still `unknown`, and beside a `refused` still `retrying` (never twice).
- **one-unreadable-row-never-blinds-the-drain** stands: the drain reads `rows` and the store logs each unreadable id. The
  boot pass also seals an unreadable row by id (`sealAtBoot(id, 'unknown')`, a compare-and-set on `sending`).

## Departures

- **send-row-takes-its-source**. The plan's `sendRow(id, settledOf)` re-reads the row's source, which the id alone does
  not name. `sendRow` takes `{ id, source, sourceId }`, and `NoticeOpts.bound` carries that target, the `pushDue` answer
  and the `settledOf` read, not `{ rowId, due }` alone.
- **claim-answers-what-the-attempt-needs**. `claimOutboxRow` returns, beside `claimSeq`, the row's `attempts`, `armedAt`
  and stored payload (one `UPDATE … RETURNING`), so a bound send needs no second read and `outboxNextState` gets its facts
  from the claim it answers. A claimed row whose payload cannot be read is sealed `failed` and logged.
- **question-outbox-takes-a-bound-write**. `QuestionOutbox.prepare` answers the store's `BoundWrite`
  (`{ prepared, due }`), and `sent` takes `(ev, askId, row)`, since the funnel's bound send needs the ask's id.
  `questionOutboxOf` lives in `notice.ts`, beside the funnel it records through.
- **reach-keeps-the-writers-names**. The ask mint takes the bound write as an overload of `insertAsk` (answering
  `{ id, row }`), and `releaseAsk` and `declineAsk` are overloaded the same way (answering the row or `false`), with each
  one's SQL still in its own method body, so `single-definition/writers-map.test.ts` names the same `asks` writers as
  before. The item raise gets a sibling, `raiseItemReached` (`{ id, row }`), since its SQL lives in `ledgersStore.ts`.
- **sender-ring-is-the-funnels**. `pushSender.ts` declares no ring: by its facts it is the funnel's (`notice.ts`), since
  every effect it has is reached through the deps it is handed, so the funnel's import of it points no edge outward
  (`rings/outward-edges.test.ts`). The plan had named it L4. Review 2150 F14 asked for L4; measured, `notice.ts` is L1
  by its facts and imports the sender at run time, and `OUTWARD_EDGE_EXEMPTIONS` is empty and may only shrink, so an L4
  header would add an outward edge. The coordinator's ruling: the departure stands; the sender's ring, with
  `notice.ts`'s, is a later wave's decision.
- **masker-from-the-push-service**. Until `index.ts` sets `Deps.masker`, the sender masks with the push service's own
  masker (`PushService.payloadMasker`, the shape-only one it is built with), not by importing `SHAPE_ONLY_MASKER`:
  `accounts/mask.ts` is ring L4, and the sender is the funnel's ring. The row and the push carry the same bytes either
  way, since `notify` masks with that same masker. A test double with no masker sends its payload unmasked, as before.
- **watcher-port-keeps-its-reach**. `WatcherCoordMember` gains only `itemById` (reached by `outboxSettledOf` from
  `watch.ts`): the sender's store members are reached from `pushSender.ts`, outside the census's scope, so the sender's
  `coord` is typed `object` and `portOf` checks the members at run time.
- **item-reach-is-a-callback**. `ledgersStore.ts` takes a `reach` callback (raise) and an `arm` callback
  (`setBlocking`), called inside its transaction, so it imports no outbox code (`pushOutboxStore.ts` already imports
  `operatorWasShown` from it). A raise reaches the operator when `operatorWasShown` says so at the raise, the hold's one
  rule, so an item held into the future is left to the held drain.
- **item-copy-in-one-place**. The item's push copy (`itemPushPayload`, built by `noticePayload`) and `WAITING_URL` move to
  `pushOutbox.ts`, so the route's unbound fallback, the raise, the arm and the three `ccrc` raisers build it from one
  place. `pushSender.ts#itemBoundOf` prepares it and asks `pushDue`.
- **ccrc-raisers-take-item-reach**. The three `ccrc` raisers' deps gain `itemReach` (`ItemReachOf`, a type in
  `pushOutboxStore.ts`, so they import no sender code), built from `itemBoundOf` in `coord/routes.ts` and `watch.ts`, and
  carried through `runCloseLane.ts`'s deps.
- **arm-without-a-service-keeps-one-row**. With no push service the toggle's `pushDue` answers `silent`; `armInTx` then
  writes a `silent` row only when the item has none, and leaves an existing row as it is, so the toggle never writes a
  second row and never moves a row to `pending` that nothing can send.
- **no-clock-no-row**. A caller with no time ports (a narrow test's deps) sends with no row and no deadline timer, as it
  sends with no store: the store needs the clock for `at` and the push id needs `Entropy`. Every production funnel site
  carries `Deps.time`. `prepare` throws without time ports; every bound caller holds them.
- **claim-rereads-the-level** (review 2150 F2, replacing claim-blocking-is-the-arms). `SettledOf` answers the source as
  it stands at the claim, `{ settled, blocking }`: an ask always pushes; an item is settled unless `open` (a ticked one,
  `checking`, is the coordinator's, as `shared/ledgers.ts#waitingCount` counts it) and is at its level now. So a lowered
  or ticked item's retry is silenced (`level`, `settled`) through the existing `retrying -> silent` row, never pushed
  again.
- **held-drain-payload-fact**. The held drain asks `pushDue` with `payload: true` (an item always has its copy) so its
  answer is `level` or `older-build`, as the plan's tests name, and stores no payload.
- **release-door-answers-internal**. A decline whose bound write throws answers the door's existing `internal` refusal
  with the store's message as its detail.
- **lapse-warn-latched**. The lapse's `releaseAsk failed` warning is logged once per cause through a `changeLatch` that
  clears on the next won or lost release.
- **build-capture-pick-unchanged**. `BuildCaptureLaneDeps.coord` keeps its `Pick`; the lane's deps are the watcher's,
  whose store carries the outbox members at run time, and `NoticeDeps.coord` types them as optional.

## Task 6, step 3: what an older build does

Measured at `v0.0.1179`, an older release tag: it has no `coord/pushOutboxStore.ts`, and its `notice.ts` sends through
`PushService.notify` directly. Such a build never reads `push_outbox`, `push_outbox_meta` or the two
`reachedOperatorAt` columns (Table 11.5's "ignored" class). Rolled back to, it drops only the rows still `pending` or
`retrying`, the set a crash loses today; rolled forward again, the boot pass sends what is inside the horizon and fails
the rest.

## Review 2150's rulings

- **presence-is-its-own-fact** (F1). The bound write and the row ref carry `viewing`, the presence answer read once
  before the move, beside `due`. The funnel's record gate reads it, not `pushDue`'s first silent reason, so a viewed ask
  on a box with no push service writes no ring record and no feed row, as before the outbox.
- **held-stamp-at-held-until** (F3). The held drain stamps an item at its `heldUntil`, as the plan says (the code had
  used the pass's time).
- **superseded-retry-is-silent** (F4). `pushDue` gains the fact `superseded` and the silent word `superseded`: at the
  claim, an unbound row a newer row under the same tag replaced with an accepted push (`supersededUnbound`) is sealed
  silent and never sent. Bound rows and the other events pass `false`.
- **drain-applies-the-boot-horizon** (F6). The boot pass seals each row in its own `try`; the drain fails a due row past
  the horizon (`outboxBootVerdict`'s `fail-stale`) by the boot's own seal, so a row the boot pass could not seal is
  never sent stale.
- **unbound-insert-commits-alone** (F7). `insertUnboundRow` refuses inside an open transaction (`ok: false`), so the push
  is sent with no row and no rolled-back id is ever reused by the next insert.
- **item-raise-names-its-arms** (F9). The item route's blocking push takes its bound row, `held-at-raise` (sends
  nothing; the held drain stamps it) or `no-outbox` (today's unbound push).
- **held-drain-answers-every-due** (F10). The held drain switches over every `pushDue` answer (an unexpected one is
  logged once and leaves the item unstamped), and on a box with no push service the sender's latch is kept per store.
- F5, F8, F12 and F13 change a comment, two log sentences, two doc comments' places and one test; F11 is no change.
- **fix-round-after-the-word**. The first fast run's fix round, and this one, are commits after Task 6's word; the
  branch is never rebased.

## Found by the pull request's first fast run

- **overloads-count-once**. The W3 question census (`test/census-w3/questions.ts#coordStoreQuestionShapedMethods`) read
  each overload signature of `insertAsk`, `releaseAsk` and `declineAsk` as a method of its own. It now names an overloaded
  method once, so the closed list it partitions is unchanged.
- **lane-needs-the-store**. The `pushOutbox` lane returns at once on a watcher built without a store, as the timers lane
  beside it does (`watch.ts#sweepPushOutbox`). A watcher built from a narrow test's deps (no store, no time ports) used
  to log a lane failure each tick; `push-sender.test.ts` now goes red without the line.
