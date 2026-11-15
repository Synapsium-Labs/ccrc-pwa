# Overlord W1: the push outbox, one sender for every push (`push-outbox-v1`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** every Web Push the server sends becomes a row of one table, `push_outbox`, and one sender drains it. The
sender holds the only `PushService.notify` call. It marks a row sent when the push service accepts it, and retries a
row the service refused. At boot it sends again every row that no attempt claimed. An ask or an item that reaches the
operator gets a reach stamp, `reachedOperatorAt`, and its one outbox row, both in the transaction that raises or
releases it. A row whose level makes no push today gets its outbox row too, marked `silent`. One L1 decider, `pushDue`,
says whether a row pushes now or stays silent. Each row carries a random push id. Characterization tests are written
first, and the pushes the operator receives stay the same as today's. The server advertises the change with its own
capability word, `push-outbox-v1`.

**Why:** today a push is a call that returns nothing. It is fire-and-forget, a crash between a row's write and its push
loses the push for good, and nothing records whether a row reached the operator. W3's holds delay pushes, so they need a
durable record of each push before they can be armed (§6.7, H18). The response record (W1's next piece in this lane)
needs a push id and a per-send verdict on each push (§4.3, C67).

**Architecture:** L0 vocabulary in a new `shared/push-outbox.ts`: the row states, `OUTBOX_TRANSITIONS` with the actor of
each move, the verdict words and the bounds. L1 deciders in a new `server/src/pushOutbox.ts`: the one payload builder,
`pushDue`, the verdict's next state, the retry time and the boot pass's answer per row. L3: the table's functions in a
new `server/src/coord/pushOutboxStore.ts`, with one-line `CoordStore` delegates, and a per-send verdict from
`PushService.notify`. L4: the sender in a new `server/src/pushSender.ts`. It wraps `Deps.push` and is derived, in one
place, from the deps object every funnel site already passes. It has a `LANE_SCHEDULE` row for retries and a boot pass
that the composition root runs once, right after the store opens. The funnel (`server/src/notice.ts`) hands every push
to the sender instead of sending it. Two pull requests.

**Tech Stack:** TypeScript (ESM), `node:sqlite`, Fastify, vitest.

**Spec:** `docs/superpowers/specs/2026-11-09-overlord-design.md` §6.7 ("Pushes go through an outbox", "Older builds
fail towards the operator", "The invariants this section serves"), §6.1 C31 (the reach stamp on asks and items), §4.2
(`pushDue` beside `pushAdmission`), §4.3 and C67 (the push id stored on the outbox row, the per-send verdict, a row that
could not be written), Table 11.1a (the push outbox row), Table 11.1c (the outbox sender), Table 11.1d
(`push-outbox-v1`), §11.5 ("Holds wait for their safety net"), Table 11.5, I2 and I9 (§11.7), Table 13.1's H18 (`shape`,
W1 for the outbox), §14's W1 row ("the push outbox and its capability word `push-outbox-v1`"). The W1 index is
`docs/superpowers/plans/2026-11-14-overlord-w1.md` (row "Push outbox", lane E). This plan builds on the index's open
question 28 (`push-due-ships-total`).

## Open questions

Each is a place where the spec is unclear, does not match the tree, or leaves a choice to the plan. The plan builds the
recommendation unless the coordinator rules otherwise. Rulings so far are marked.

1. **Which pushes go through the outbox** (slug `every-push-rides-the-outbox`). Table 11.1a names the questions owner as
   the outbox's writer, which reads as asks and items only. §4.3 and C67 say the funnel mints a push id for each push
   and stores it on that push's outbox row, which reads as every push. **Recommendation:** every push. The funnel's
   one send (`server/src/notice.ts#sendPush`) becomes the sender's insert, so every site listed below moves at once,
   and the sender holds the only `PushService.notify` call. Only asks and items are bound to a source row with a reach
   stamp. A second, unbound send path would be a parallel mechanism.
2. **The per-send verdict ships here, not in the response record** (slug `verdict-ships-with-the-outbox`). The index puts
   `PushService`'s per-send verdict in responses PR A. The sender cannot mark a row sent, or retry one, without it.
   **Recommendation:** this piece adds the verdict whole (each subscription accepted, refused, gone or unanswered, with
   the hash of its endpoint), and the response record reads it.
3. **At most once across a crash** (slug `a-claimed-row-is-never-sent-again`). The spec says the sender "sends every
   unsent row again at boot". The brief says the boot pass must never push twice. The service worker shows a repeat
   with the same tag as a new alert (`renotify: Boolean(data.tag)`, `pwa/public/push-sw.js`), so a repeat is a second
   ping. **Recommendation:** a row is claimed in its own transaction before each attempt. At boot, a row no attempt
   claimed is sent. A row claimed with no verdict (the process died while the send was in flight) is sealed `unknown`,
   and that attempt is never retried. The gap is the whole send in flight: `notify` loads the subscription store and
   then waits on the network, and a death anywhere in that window leaves the attempt `unknown`, whether or not the
   service took it. I2 holds as worded, and "at least one push attempt" reads "at least one claimed attempt".
4. **A held item's reach** (slug `item-held-until-is-a-hold`). The spec says an item "had no hold before". The tree has
   one: `operator_items.heldUntil`, set by the end-request, run-close-refusal and review-release raises, keeps an item
   off Waiting on you until it passes (`ledgersStore.ts#itemsFor`, `operatorWasShown`). Nothing happens at that time,
   because the list derives it on read. **Recommendation:** an item raised with no `heldUntil` is stamped at its raise.
   A held item is stamped at `heldUntil` by the sender's lane pass, once `operatorWasShown` holds for it, through the
   same one writer, with its outbox row decided by `pushDue` from the item's current level. All three raises are `soon`
   or `later` at the raise, but the level can change during the hold (question 8).
5. **Rollback below `push-outbox-v1`** (slug `rollback-refusal-ships-with-holds`). **Ruled (fix round 1, R1, reversing
   index review F8): the refusal ships with W3's hold arming, not here.** The spec's reason for §11.5's "a rollback below
   it refuses unless forced" is the hold tier: "the hold tier can be armed only when every build the box keeps and can
   roll back to carries that word" (§6.7, §11.5). W1 arms no holds. In W1 an older build drops only rows still `pending`
   or `retrying` (at most about ten minutes of retries), which is the set a crash loses today. It ignores `push_outbox`
   and the two columns (Table 11.5's "ignored" class). The obligation W3 inherits, recorded here so W3's plan finds it:
   `ccd/ccrc#cmd_rollback` reads no server capability word today. A release records none (`build.json` carries `sha`,
   `ref`, `builtAt`, `dirty` and `version` only). `CCRC_CAP_WORDS` names what an install's `ccrc` can do, never a
   server word, and "a version number is never a capability" (decision 13). So W3's refusal first needs each build to
   carry its server words, or the shared floor check the index gives the pool-set piece. The coordinator records this
   on the index row and Table 11.1d's line.
6. **The ask's reach stamp beside `releasedAt`** (slug `reach-stamp-beside-released-at`). `asks.releasedAt` already
   records "the instant the operator's push was released" (`CoordStore.declineAsk`). In W1 the two are equal. In W3 an
   ask the coordinator releases may be held for the Overlord, so they part. **Recommendation:** a column of its own. Its
   one writer is `stampReach`, called in the same transaction as the move that writes `releasedAt`, with the same `now`.
   A test pins the two equal until W3.
7. **The durable once-only marks of other sites** (slug `bound-rows-are-asks-and-items`). Seven other sites write a
   durable once-only mark before their push: the stall rungs' observation row, the drift stamp, the release mark, the
   digest claim, the review-cap ask, the park escalation and the stall notice. A crash between the mark and the push
   loses that push, today and after this piece. **Recommendation:** W1 binds asks and items only (I2's rows). Each other
   site keeps its mark and enqueues through the funnel after it, unchanged. Folding a mark and its outbox row into one
   transaction is a follow-up per site, listed in "Where things stand".
8. **A toggle to blocking on an item with no outbox row** (slug `rearm-is-an-upsert`). **Ruled (fix round 1, 3).** Today
   the blocking route pushes on every move to blocking, whatever `heldUntil` says. Two kinds of item have no outbox row
   when that happens: one open before PR B's migration, and a held item toggled inside its hold. **Ruling:** the toggle
   arms the row whatever its state, inside `setBlocking`'s transaction, and writes the row and the reach stamp when
   none exists. The held drain asks `pushDue` with the item's current level.

## What exists today

Measured on `main` at `416b8f942`.

- **One send.** `server/src/notice.ts#sendPush` holds the only `PushService.notify` call in `server/src`, and
  `server/test/notify-push.test.ts` pins it (`callers()` equals `{ 'notice.ts': 1 }`). The funnel's `raise` (behind
  `notify` and `notifyEach`) reaches it in modes `'push'` and `'record-always'`, after the presence gate
  (`Viewers.isVisible`, `server/src/viewer.ts`), the ring record and the guarded feed archive. There it sends with the
  default tag `${kind}-${sessionId}` unless `opts.tag` names one, and adds `actions` and `url` when given. A send there
  is not awaited and its rejection is not caught. `notifyPushOnly` reaches it with no gate, no ring and no archive, and
  logs a rejection under its caller's `failed` sentence (`notice.test.ts`, `notify-push.test.ts` and `push-copy.test.ts`
  pin that sentence).
- **The deps the funnel reads.** `NoticeDeps.push` is `Pick<PushService, 'notify'>`. `Deps.push` (`server/src/deps.ts`)
  is the whole `PushService`: `server.ts` reads `publicKey`, `subscribe` and `unsubscribe` from it, and
  `FleetWatcher.pushRelease` refuses `no-push-service` when it is absent (D-3296). Every funnel deps object is built
  from `Deps`, at these sites: `FleetWatcher.pushOne` (`notify(this.deps, …)`), the two `noticeSink(this.deps)` sinks in
  `watch.ts` (the reclaim and landed lanes' ports), the delegation adoption sink in `watch.ts`, `pushRelease`
  (`notifyPushOnly({ push: sender }, …)`, which passes the push service alone), `server.ts`'s `noticeSink(deps)` and its
  `notifyPushOnly(deps, …)` for `POST /api/notify`, `DiskAlarmLane.raiseNotice` and `BuildCaptureLane.raiseFailure`.
  `index.ts` builds `deps` before the masker exists and sets `deps.masker` and `push?.setMasker(masker)` later
  (`push-composition-pin.test.ts` pins that wiring). About forty test files double `push.notify`, and
  `test/feedWriterFixture.ts` assigns a `Promise<void>` fake to `NoticeDeps.push`.
- **Who builds today's payload.** The default tag and the `url` and `actions` fields are added in the funnel's `raise`.
  The " · <project>" title suffix, used only when more than one project is active, is added in `FleetWatcher.pushOne`.
  The hold's `ev` (`QuestionPush`) carries `kind`, `sessionId`, `project`, `title`, `body` and `actions`, with no tag and
  no url. For an ask minted released, `ev` is built after `insertAsk`. An item's copy (kind `coord`, title
  "Waiting on you", the item's title as body, tag `item-<id>`, `url: WAITING_URL`) is built in `pushBlocking`, and the id
  exists only inside `raiseItemInTx`.
- **`PushService.notify`** (`server/src/push.ts`) returns nothing. It returns early with no subscription, sends to every
  subscription at once in one `Promise.all` with `TTL: 600` and no request timeout, prunes a 404 or 410, and swallows
  every other error. It can still reject, because pruning writes the subscription store. It masks every payload with
  `maskDeep` before it serialises it (`push-masker-pin.test.ts`). `index.ts` builds one (`push-composition-pin.test.ts`).
  web-push takes a per-request `timeout` option, which nothing passes today.
- **The service worker** shows a push under its tag with `renotify: Boolean(data.tag)`, so a second push with the same
  tag alerts again. Its tap handler replaces the notification under the same tag.
- **The push sites today.** Each ends in `sendPush`. "Bound" marks the sites this piece binds to a source row.

| # | Site, its entry points | Kind, mode | Tag | Durable row and its once-only guard |
|---|---|---|---|---|
| 1 | `FleetWatcher.tick`'s busy-to-idle edge | `done`, push | default | none; an in-memory edge |
| 2 | `FleetWatcher.pushNewMail` | `mail`, record-always (record-only for stall checks, nudges, timer mail and others) | `mail-<to>-<mailId>` | the mail row, written earlier; an in-memory watermark |
| 3 | `FleetWatcher.pushNewRuns` | `run`, record-always (record-only for `closing` and swept closes) | `run-<runId>-<state>` | `run_events`, written earlier; an in-memory watermark |
| 4, 5 | `FleetWatcher.pushSenderNotice`; `escalatePark` | `mail`, record-always | `mail-blocked-…`, `mail-parked-…`, `mail-revived-…` | the mail row; `markParkEscalated`'s compare-and-set |
| 6 | the brief-not-taken pass of `sweepMail` | `mail`, record-always | `briefNotTakenTag` | `queueStallNotice`'s row; its refusal of a repeat |
| 7, 8 | `FleetWatcher.applyStall`; `applyStallSession` with a run (the stall watch's operator rung) | `run` or `mail`, record-always | `stallPushRoute`'s tag | `recordStallObservation`, its own transaction; the push only when `recorded` |
| 9 | `applyStallSession`, run-less | as 7 | as 7 | none; the in-memory `stallLatch` |
| 10 | `FleetWatcher.announceMerged` | `merged`, push | `merged-<key>` | the feed archive; `hasNotice` and `dedupeKey` |
| 11 | `sweepLanding`'s deliver step | `queue`, record-always | the record's tag | the run and its mail; `hasMailWithSubject`, `hasNotice` |
| 12 | `detectDialogs`' `raise` | `ask`, push | default | none for a top-level session's dialog; the dialog-id edge |
| 13 | `detectDialogs`' held amendment, the "with coordinator" replacement push | `ask`, push | default, replacing the earlier one | the ask row from `hold`; `actionlessAsks` |
| 14 | `pushRaised`, a `released` verdict (an ask minted released) **Bound** | `ask`, push | default | `CoordStore.insertAsk`, its own transaction |
| 15 | the question doors' sink, four entries: `released` after `declineAsk` **Bound**; `answeredLate`; `approvalRuled`; `approvalReleased` | `ask`, push | default | `declineAsk` (a compare-and-set, no transaction); the others none |
| 16 | `questions.lapseAsks`, `push-and-drop` after `releaseAsk` wins **Bound** | `ask`, push | default | `releaseAsk` (a compare-and-set); the push follows, outside it |
| 17 | `questions.lapseApprovals` | `ask`, push | default | `lapseApproval`, `staleApproval` |
| 18 | `digestBeat` | `coord`, record-always | the digest's tag | `claimDigestDay` |
| 19 | `DiskAlarmLane.raiseNotice` | `coord`, push (record-only for the clear) | `disk` | a file marker; `hasNotice` |
| 20 | `BuildCaptureLane.raiseFailure` | `coord`, push | `claude-build-capture` | `hasNotice` |
| 21 | `ledgersRoutes.ts#pushBlocking`, from the raise route and `POST /api/items/:id/blocking` **Bound** | `coord`, push | `item-<id>` | `raiseItem` and `setBlocking`, each its own transaction; the push follows |
| 22 | the run-open route's review-cap refusal (`coord/routes.ts`) | `run`, push | `review-cap-<work>` | `raiseReviewCapAsk`'s insert |
| 23 | the advance route's landing ejection (`@landing-ejection-ask`) | `run`, record-always | the ask's tag | the landing journal and its transaction |
| 24, 25 | `coord/driftLane.ts`, the summary and its items | `coord`, push and record-always | `DRIFT_LANE_TAGS.summary`, `drift-<key>` | `markDriftPushed`, in a transaction, before the notice |
| 26 | `coord/landedLane.ts#raiseLandedNotice`, from `landedPass` and from `coord/close.ts`'s land-on-close | `merged`, record-always or record-only by `landedNoticeModeOf` | `merged-<key>` | `hasNotice`, `dedupeKey` |
| 27 | `coord/delegationAdoptStep.ts`, through the watcher's sink | `coord`, push | default | none; in-memory `memory.raised` |
| 28 | `FleetWatcher.pushRelease`, through `notifyPushOnly` | no kind | the release tag | `markReleaseNotified`, in a transaction |
| 29 | `POST /api/notify` with `push: true` (`server.ts`), through `notifyPushOnly` | no kind | the decision's tag | none |

  The funnel's other callers never push, and Task 1 pins that they stay so: every `notifyEach` caller
  (`runCloseLane.ts`, `runCloseRefusals.ts`, `endDeadCoordinator.ts`, which pass no push service), and every
  `'record-only'` writer.
- **Asks.** `CoordStore.insertAsk` writes a row `held`, or `released` with `releasedAt` when the claimant rule released
  it at the mint, in one `tx` (`server/src/coord/tx.ts`). `releaseAsk` (the lapse) and `declineAsk` (the parent's
  release) are compare-and-sets on `state = 'held'` that set `releasedAt`, in no transaction of their own, and no caller
  holds one around them. `questions.lapseAsks` pushes after a won `releaseAsk` (`decideAskLapse` answers `push-and-drop`
  for `release-won`), and also on some beaten paths. The release door calls `declineAsk` and then
  `questions.released(childId)`, which deletes the hold as it reads it and answers null when no in-memory hold exists:
  after a restart, or when the instance has no watcher (then the door only warns and pushes nothing).
  `server/test/single-definition/ask-digest.test.ts` counts the `hold(` calls.
- **Items.** `operator_items` rows are written by `ledgersStore.ts#raiseItemInTx`, inside `raiseItem`'s or
  `raiseItemWithMail`'s `tx`. `raiseItemWithMail` passes a `queue(id)` callback into the transaction. `setBlocking` is a
  `tx` that answers whether the level moved. Only the raise route and the blocking route push: the raise when
  `neededBy === 'blocking'`, the toggle on every move to blocking, with no `heldUntil` check. The three `ccrc`-raised
  paths (`endRequest.ts`, `runCloseRefusals.ts`, `reviewRelease.ts`) raise `soon` or `later` with a `heldUntil`.
  `itemsFor` leaves a held item out of Waiting on you until `heldUntil` passes, and `operatorWasShown` says whether one
  was ever shown.
- **The feed archive** keeps 2,000 rows and passes bodies through `redactCommand` (`CoordStore.recordFeedEvent`).
- **Time and chance.** `server/src/time/ports.ts` declares `Clock`, `Scheduler` (its `after` answers a `Cancel`) and
  `Entropy` (`hex(bytes)`). New Overlord code takes them from `Deps.time`, and
  `server/test/single-definition/time-ports.test.ts` holds its scope (`TIME_PORT_FAMILIES`, `TIME_PORT_FILES`).
- **Lanes.** `server/src/laneSchedule.ts#LANE_SCHEDULE`, whose `LaneRow` names a `LaneName`, `cadenceMs`,
  `derivedFrom`, `clock`, `flight` and `warnKey`, with an optional `staleAfterMs` for a `skip` row.
  `server/test/lane-schedule.test.ts` pins every row on the monotonic clock and counts them.
- **The boot order.** `index.ts` opens `coord.db`, builds `CoordStore` and replays the landing journal before anything
  else, then connects the fleet link, builds the masker, builds the server and starts the watcher. An inventory run on
  the link's connect can reach `pushRelease` before `watcher.start()`.
- **Latches.** `changeLatch` is the "log once per cause, clear on success" helper (`FleetWatcher`'s
  `releasePushFailure`).
- **Capability words.** `shared/api.ts#SERVER_CAP_MAP` (nine words, `timers-v1` the newest). `health.test.ts` and
  `ccrc-api.test.ts` read `SERVER_CAPS`, not a literal count.
- **Migrations.** `server/src/coord/schema.ts#MIGRATIONS`, its slot measured at build time.
  `server/test/run-close-switch.test.ts` undoes the migrations after 53 by hand and reopens the database ("replays all
  nineteen"), so each new migration adds its undo step and the count there.
- **Contexts.** The architecture spec's C6 row names `push.ts` and `notice.ts` exactly
  (`docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md`), so a new file there needs its row.
- **Tests that pin the funnel today:** `notify-push.test.ts`, `notice.test.ts`, `feed-writers-pin.test.ts`,
  `push-copy.test.ts` (the release push's copy, its one send and its "not retried" sentence), `finished-push.test.ts`,
  `push-masker-pin.test.ts`, `push-composition-pin.test.ts`, `secret-mask.test.ts`, `disk-notice.test.ts`,
  `landing-ejection-ask.test.ts`, `landed-lane.test.ts`, `drift-push.test.ts`, `ledgers-coordinator-routes.test.ts`,
  `review-cap-store.test.ts`. `update-notify.test.ts` tests only `releaseToNotify`, and `account-canary.test.ts` calls
  `PushService` directly, so neither pins the funnel.

## Global Constraints

- **Architecture (`CLAUDE.md`).** Decide in L1, act in L4. The payload builder, `pushDue`, the verdict's next state, the
  retry time and the boot pass's answer are L1 deciders over facts. The sender gathers facts, asks them and writes what
  they answer.
- **One writer per fact.** `reachedOperatorAt` has one writer, `stampReach` in `pushOutboxStore.ts`, called only inside
  a raising, releasing or arming transaction. `pushedAt` has one writer, `markOutboxVerdict`, called only by the
  sender. Each outbox move goes through `OUTBOX_TRANSITIONS`, and `server/test/single-definition/writers-map.test.ts`
  names each writer: `TABLES` gains `push_outbox`, and the `asks` and `operator_items` writer lists gain
  `pushOutboxStore.ts#stampReach`.
- **One sender, wrapped around `Deps.push`.** `Deps.push` stays the whole `PushService`. The sender is derived from the
  deps object a funnel site already passes, by `pushSender.ts#senderFor`, so every `buildServer` and `FleetWatcher`
  harness pushes as today. After PR B, `pushSender.ts` holds the only `PushService.notify` call, and the census in
  `notify-push.test.ts` moves to it.
- **One owner for a payload.** `pushOutbox.ts#noticePayload` builds every push's payload: title (with the project suffix),
  body, `sessionId`, tag (the default, or the caller's), `url` and `actions`. `pushOne` and `raise` call it, and so do
  the bound callers before their transaction. `senderFor(deps).prepare(payload)` masks it with the deps' masker and
  mints its push id. A stored payload is the masked bytes the push carries, so the ring record, the stored row and the
  push say the same thing.
- **Pushes stay today's** (I9). Every site keeps its kind, title, body, tag, actions, url, mode and presence rule. Task 1
  pins them before any move, byte for byte. The behaviour changes are named, and nothing else changes: a send that
  every subscription refused is retried, and a row unsent when the server stopped is sent at its next boot.
- **Bound rows** are asks and items only (open question 7). A bound row has exactly one outbox row, held by a unique
  index on its source (I2). Once a `pending` bound row has committed, no fallback sends an unbound push for the same
  event.
- **No push service, no rows.** With `Deps.push` absent (no VAPID keys, every test box), nothing is written and nothing
  is sent, as today. With a push service and no outbox store (a test's narrow `coord` double), the push is sent with no
  row and no warning. With a store whose write throws, the push is still sent with no row and no push id (C67), and the
  sender logs once per cause through a `changeLatch` that clears on the next successful write.
- **Time and chance through ports.** The new modules read `Clock`, `Scheduler` and `Entropy` from `Deps.time`, and join
  `TIME_PORT_FILES` in the pull request that creates them. The push id is `entropy.hex(16)`. SQL never reads the clock.
- **Text at rest is short-lived.** A row's payload is nulled when the row reaches a terminal state. A re-arm rebuilds it
  from the source row.
- **One concern per file** (the large-file programme, #2769; index review F6). Every new wire type (`PushSendVerdict`,
  the states, the bounds) lives in the new `shared/push-outbox.ts`. `shared/api.ts` gains only `push-outbox-v1`'s row in
  `ServerCap` and `SERVER_CAP_MAP`.
- **Shared files, by row** (index review F13). In `server/src/coord/ledgersRoutes.ts`, this piece touches
  `pushBlocking` and its one call line in each of the raise route (`POST /api/programmes/:slug/items`) and the blocking
  route (`POST /api/items/:id/blocking`), and no other handler. The goals doors belong to the portfolio piece and the
  gate rows to the gates piece. In `server/src/coord/ledgersStore.ts` it touches `raiseItemInTx`, `setBlocking` and the
  new `heldItemsReached` read only. It does not touch `pwa/src/lib/api.ts`.
- **The push id has one owner, this piece:** its column, its minting through `Entropy`, and its uniqueness. The
  response record reads it from the outbox row and puts it in the payload.
- **Tests.** From `server/`: `ccrc test -- ./node_modules/.bin/vitest run test/<file>.test.ts`. Each task's last run adds
  both `tsc` runs (`ccrc test -- npx tsc --noEmit -p tsconfig.json` and `-p test/tsconfig.tests.json`),
  `test/typecheck-tests.test.ts`, and pwa's `tsc` when `shared/` changed.
- **Mutation floors.** Every new L1 decider (`noticePayload`, `pushDue`, `outboxNextState`, `outboxRetryAt`,
  `outboxBootVerdict`) joins `MUTANT_SETS` through a new `server/test/sim/pushOutboxSets.ts` and
  `server/test/sim/mutation-floors.json`, in PR A.
- **Growth check** (`server/test/growthCheck.ts#GROWTH_FILES`, 40 net lines a file a pull request): each PR states its
  estimate below, and the builder measures it before pushing.
- **No door, no client verb, no ccd change, no PWA change.** This piece adds no route, so no door census moves.
- Cite by symbol or `@anchor`. No private names: fixtures `lane-a-project-a`, `prog-a`. No D-number invented: the
  builder's departures go in `docs/superpowers/plans/2026-11-14-overlord-w1/w1-push-outbox/departures.md`.

## Review Focus

1. **I2.** An ask or item that reaches the operator has exactly one reach stamp and one outbox row, written in the
   transaction that moves it. No path writes a second, and a reach on a row that did not move writes none.
2. **Never twice.** A row is sent only from a claim. A claim is a compare-and-set from `pending` or `retrying`. A verdict
   lands only on the attempt it answers (`claimSeq`). A retry follows only a verdict in which every subscription
   refused for a reason that can pass. A row claimed by a dead process is sealed `unknown` at boot, and that attempt is
   never retried.
3. **Today's pushes.** Task 1's characterization suite is green on `main` and unchanged after the move, except its one
   seam. A push the presence gate suppressed today writes no unbound row and, for a bound row, a `silent` one.
4. **A failed write never costs the push.** With no outbox store, or an insert that throws, the push still goes, as
   today. The caller's failure sentence still prints on a rejected send.
5. **One writer each.** `reachedOperatorAt` and `pushedAt` each have one writer. `PushService.notify` has one caller.
   `noticePayload` builds every payload.

## The PR split

| PR | Tasks | What it ships | Needs first | Growth-checked files, estimate |
|---|---|---|---|---|
| A, the record and its rules | 1 to 3 | The characterization suite; the vocabulary and deciders, the payload builder among them; `push_outbox`, the reach stamps, their writers, and the per-send verdict. Nothing reachable: no caller writes a row yet | nothing: **ready to build** | `server/src/coord/schema.ts` about +34; `server/src/coord/store.ts` about +12; `server/src/watch.ts` about +4 (`pushOne` calls the builder) |
| B, the sender and the move | 4 to 6 | The sender with its lane row and boot pass; every funnel site behind it; the raising transactions for asks and items; the held item's reach; the word `push-outbox-v1` | PR A | `server/src/coord/store.ts` about +22; `server/src/watch.ts` about +18; `server/src/server.ts` about +2; `shared/api.ts` about +6 |

**Order:** PR A at once; PR B once PR A has merged. The index lists one pull request. Two keep the move, which changes
every push in the server, apart from the record it moves onto, and PR A's characterization suite is green on `main`
before anything moves.

**Why the word comes last.** `push-outbox-v1` is added by Task 6, the last commit of PR B, once every site writes rows
and the sender drains them.

**States the next piece reads.** Responses PR A reads: the push id column; `PushSendVerdict` and its endpoint hashes;
the claim step, inside whose transaction it writes the response row `pending` before the send (C67). It adds the push
id to the payload. W3 reads `pushDue`, which gains `deferred`, and the arming move, which its repeat push uses. W3's
hold arming also inherits the rollback refusal (open question 5).

---

### Task 1: Today's pushes, pinned (characterization)

**Files:**
- Create: `server/test/push-outbox-characterization.test.ts`
- Create: `server/test/pushSeam.ts` (the one seam: a recording `PushService.notify` double, and how a harness installs it)

The suite drives each site of "What exists today" through each of its entry points (a lane call, a route, a watcher tick
on fixture sessions), with a recording double at the bottom of the stack. For each it pins the exact payloads the double
received, in order: `title`, `body`, `sessionId`, `tag`, `url`, `actions`, and how many. Each site is driven again with
the session visible, and with no push service. An ask is also driven with two active projects, so the title suffix is
pinned. Asks and items also pin the source row's state and `releasedAt` after the push. The release push pins its
`failed` sentence on a rejected send. Every `notifyEach` caller and every `'record-only'` writer is pinned as sending
nothing. Sites that existing tests already pin (for example `disk-notice.test.ts`, `drift-push.test.ts`) are driven here
again at the payload level, so one suite is the arbiter of the move.

- [ ] **Step 1: Write** the suite and the seam. Today the seam installs the double as `Deps.push`. **Step 2: Run** on
  `main`'s code: green. It is a characterization, so it is green first.
- [ ] **Step 3: Mutation.** Change `pushBlocking`'s tag to `item-x`: the item row goes red. Drop the presence gate in
  `raise`: the visible cases go red. Drop the project suffix in `pushOne`: the two-project case goes red. Revert each.
- [ ] **Step 4: Commit.** `test(notice): pin every push the server sends today, at the payload (characterization)`

### Task 2: The vocabulary, the payload builder and the deciders (L0, L1)

**Files:**
- Create: `shared/push-outbox.ts` (L0, C6; imports nothing)
- Create: `server/src/pushOutbox.ts` (L1, C6: pure; the time is a fact)
- Modify: `server/src/watch.ts` (`FleetWatcher.pushOne` passes its title through `noticePayload`'s project rule) and
  `server/src/notice.ts` (`raise` builds its payload with `noticePayload`), a move that changes no byte (Task 1 is the
  arbiter)
- Create: `server/test/sim/pushOutboxSets.ts`; Modify: `server/test/sim/mutation-floors.json` and `MUTANT_SETS`
- Modify: the architecture spec's C6 row (`push.ts` becomes `push*.ts`, and `coord/pushOutbox*.ts` is added)
- Modify: `server/test/single-definition/time-ports.test.ts` (`TIME_PORT_FILES` gains the new `server/src` files)
- Test: `server/test/push-outbox-vocab.test.ts`, `server/test/push-outbox-decide.test.ts` (new)

**Interfaces:**

```ts
const OUTBOX_STATE_MAP = {
  pending: 'written and due; no attempt holds it',
  sending: 'claimed for one attempt; the verdict is not in',
  retrying: 'every subscription refused for a reason that can pass; due again at nextAttemptAt',
  sent: 'the push service accepted it for at least one subscription (pushedAt)',
  silent: 'no push by decision: the level, the operator looking, the source settled, or no payload',
  unsent: 'no subscription left to deliver to',
  failed: 'refused for good, or past the retry horizon',
  unknown: 'an attempt with no verdict: that attempt is never retried',
} as const;
export type OutboxState = keyof typeof OUTBOX_STATE_MAP;
export const OUTBOX_STATES = Object.keys(OUTBOX_STATE_MAP) as OutboxState[];
export const TERMINAL_OUTBOX_STATES = ['sent', 'silent', 'unsent', 'failed', 'unknown'] as const satisfies readonly OutboxState[];

export type OutboxActor = 'raise' | 'sender' | 'boot' | 'arm';
export const OUTBOX_TRANSITIONS: readonly { readonly from: OutboxState | null; readonly to: OutboxState; readonly actor: OutboxActor }[] = [
  { from: null, to: 'pending', actor: 'raise' }, { from: null, to: 'silent', actor: 'raise' },
  { from: null, to: 'sending', actor: 'sender' },                    // an unbound push, claimed at its insert
  { from: 'pending', to: 'sending', actor: 'sender' }, { from: 'retrying', to: 'sending', actor: 'sender' },
  { from: 'pending', to: 'silent', actor: 'sender' }, { from: 'retrying', to: 'silent', actor: 'sender' }, // the source re-read
  { from: 'sending', to: 'sent', actor: 'sender' }, { from: 'sending', to: 'retrying', actor: 'sender' },
  { from: 'sending', to: 'unsent', actor: 'sender' }, { from: 'sending', to: 'failed', actor: 'sender' },
  { from: 'sending', to: 'unknown', actor: 'sender' }, { from: 'sending', to: 'unknown', actor: 'boot' },
  { from: 'pending', to: 'failed', actor: 'boot' }, { from: 'retrying', to: 'failed', actor: 'boot' }, // stale after a restore
  // a bound row armed again (a toggle to blocking), from every state; `null` is the upsert's insert
  ...OUTBOX_STATES.map((from) => ({ from, to: 'pending' as const, actor: 'arm' as const })),
  { from: null, to: 'pending', actor: 'arm' },
];
export function outboxMoveAllowed(from: OutboxState | null, to: OutboxState, actor: OutboxActor): boolean;

export type OutboxSource = 'ask' | 'item';
export type SubscriptionVerdict = 'accepted' | 'refused' | 'refused-for-good' | 'gone' | 'no-answer';
export type PushSendVerdict =
  | { readonly kind: 'no-subscription' }
  | { readonly kind: 'sent'; readonly subs: readonly { readonly endpointHash: string; readonly verdict: SubscriptionVerdict; readonly status: number | null }[] };

export const PUSH_ID_BYTES = 16;
export const OUTBOX_SUB_TIMEOUT_MS = 20_000;         // web-push's per-request timeout, below the deadline
export const OUTBOX_SEND_DEADLINE_MS = 30_000;       // a send that has not answered by then has no verdict
export const OUTBOX_RETRY_BASE_MS = 30_000;          // 30 s, doubling
export const OUTBOX_RETRY_HORIZON_MS = 600_000;      // the push's own TTL, from armedAt
export const OUTBOX_KEEP_MS = 7 * 86_400_000;        // a terminal unbound row is purged a week after settledAt
```

```ts
/** The one payload builder: today's `pushOne` title rule and `raise`'s tag, url and actions, byte for byte. */
export function noticePayload(e: { readonly kind: string; readonly sessionId: string; readonly project: string;
  readonly title: string; readonly body: string }, opts: { readonly tag?: string; readonly url?: string;
  readonly actions?: PushPayload['actions'] }, activeProjects: ReadonlySet<string>): PushPayload;

export type PushSilentWhy = 'level' | 'viewing' | 'settled' | 'no-payload';
export interface PushDueFacts {
  readonly event: 'reach' | 'arm' | 'claim';      // claim: the re-read before each bound row's attempt
  readonly source: OutboxSource | 'none';
  readonly blocking: boolean;                     // an item's current level; an ask always pushes today
  readonly viewing: boolean;                      // the presence gate's one answer; a notice with no session is never viewed
  readonly settled: boolean;                      // the source row was answered, withdrawn or closed
  readonly payload: boolean;                      // a payload exists (a handover with no in-memory hold has none)
}
/** Total over its facts. W1 answers `now` or `silent`; W3 adds `deferred` and changes no answer W1 gives. */
export type PushDue = { readonly due: 'now' } | { readonly due: 'silent'; readonly why: PushSilentWhy };
export function pushDue(f: PushDueFacts): PushDue;

/** What a claimed attempt's verdict moves the row to. `null` is a send that did not answer by its deadline, or rejected. */
export function outboxNextState(v: PushSendVerdict | null, row: { readonly attempts: number; readonly armedAt: number }, now: number):
  | { readonly to: 'sent' | 'unsent' | 'failed' | 'unknown' }
  | { readonly to: 'retrying'; readonly nextAttemptAt: number };
/** The next attempt's time, or null when it would fall past armedAt + OUTBOX_RETRY_HORIZON_MS. */
export function outboxRetryAt(attempts: number, armedAt: number, now: number): number | null;

/** The boot pass's answer for one row it finds non-terminal. */
export function outboxBootVerdict(row: { readonly state: 'pending' | 'sending' | 'retrying'; readonly armedAt: number }, now: number):
  'send' | 'seal-unknown' | 'fail-stale';
```

**`pushDue`'s rules, first match:** no payload is `silent`, `no-payload`; a settled source is `silent`, `settled`; an
item that is not blocking is `silent`, `level`; a notice being viewed is `silent`, `viewing`, except on a `claim`
(presence was decided once, at the reach or the arm, and is not asked again); everything else is `now`. The funnel
asks `pushDue` only in modes `'push'` and `'record-always'`, and `'record-only'` writes no row, as today.

**`outboxNextState`'s rules:** `no-subscription` is `unsent`. Any `accepted` subscription is `sent`. Otherwise any
`no-answer` (a reset or a timeout after the request was written) is `unknown`, because the service may have taken it.
A `null` verdict is `unknown`. Every subscription `gone` is `unsent`, because the dead ones are pruned and nothing is
left to deliver to. Any `refused-for-good` (400, 403, 413) with no `refused` is `failed`. Otherwise, where some
subscription answered `refused` (429, any 5xx, or an error raised before the request left the box: `ENOTFOUND`,
`ECONNREFUSED`, `EAI_AGAIN`, `ENETUNREACH`), the row is `retrying` at `outboxRetryAt`, or `failed` when that answers
null. `outboxRetryAt` doubles from `OUTBOX_RETRY_BASE_MS` per attempt. The first retry lands 30 to 60 s after the
refusal, depending on the lane's beat.

**`outboxBootVerdict`'s rules:** `sending` is `seal-unknown`; `pending` or `retrying` whose `armedAt` is past the horizon
is `fail-stale`, so a `coord.db` restored from an older snapshot never re-sends its old rows; otherwise `send`.

- [ ] **Step 1: Failing tests:** `outboxMoveAllowed` over every pair and actor; the state map's keys equal
  `OUTBOX_STATES`, and `TERMINAL_OUTBOX_STATES` is exactly the states whose only move out is `arm`; `noticePayload`
  against Task 1's pinned payloads, one or two active projects, an empty project, a caller's tag and the default;
  `pushDue` over the full product of its facts against a table written in the test; `outboxNextState` over each verdict
  shape, all `gone`, a mixed `accepted` and `refused`, a mixed `refused` and `no-answer`, `refused-for-good` beside
  `refused`, `null`, and a retry just inside and just past the horizon; `outboxRetryAt` at attempts 1 to 6, and null past
  the horizon; `outboxBootVerdict` over its three states and both sides of the horizon.
- [ ] **Step 2: Run.** Red. **Step 3: Implement**, and move `pushOne`'s and `raise`'s payload code onto `noticePayload`.
  **Step 4: Run** these suites, Task 1's (unchanged, green), `test/sim/mutation-floors.test.ts`, `test/rings/*.test.ts`,
  `test/single-definition/time-ports.test.ts`, both `tsc` runs and pwa's. Green. Register the floors.
- [ ] **Step 5: Mutation.** Let `pushDue` answer `now` for a non-blocking item: red. Let it ask presence on a `claim`: red.
  Let `outboxNextState` read `no-answer` as `retrying`: the never-twice case goes red. Read all `gone` as `retrying`: red.
  Let `outboxBootVerdict` answer `send` for `sending`: red. Drop the horizon: red. Revert each.
- [ ] **Step 6: Commit.** `feat(notice): one payload builder, and the push outbox's states, moves and deciders, with pushDue total (H18)`

### Task 3: The table, the reach stamps and the per-send verdict (L3)

**Files:**
- Modify: `server/src/coord/schema.ts` (one migration, at the slot measured at build time)
- Create: `server/src/coord/pushOutboxStore.ts` (L3, C6)
- Modify: `server/src/coord/store.ts` (one-line delegates)
- Modify: `server/src/push.ts` (`notify` answers `PushSendVerdict`; a per-request `timeout`)
- Modify: `server/src/notice.ts` (`NoticeDeps.push` widens to `{ notify(p: PushPayload): Promise<unknown> }`, so every
  double that answers `void` still types)
- Modify: `server/test/single-definition/writers-map.test.ts` (`TABLES` gains `push_outbox`; the `asks` and
  `operator_items` lists gain `stampReach`; the gap text that names the tables without a writer pin)
- Modify: `server/test/run-close-switch.test.ts` (the new migration's undo step, and "all nineteen" becomes twenty)
- Test: `server/test/push-outbox-store.test.ts` (new), `server/test/push-verdict.test.ts` (new), `server/test/coord-db.test.ts`

**Schema:**

```sql
CREATE TABLE push_outbox (
  id             INTEGER PRIMARY KEY,
  pushId         TEXT NOT NULL UNIQUE,     -- entropy.hex(16): no restore can make one repeat; kept across a re-arm
  sourceKind     TEXT,                     -- 'ask' | 'item' | NULL for an unbound push
  sourceId       INTEGER,
  payload        TEXT,                     -- the masked PushPayload as JSON; NULL once the row is terminal
  tag            TEXT NOT NULL,
  state          TEXT NOT NULL,
  createdAt      INTEGER NOT NULL,
  armedAt        INTEGER NOT NULL,         -- the insert, or the latest arm: the retry horizon's start
  claimSeq       INTEGER NOT NULL DEFAULT 0, -- every claim adds one, never reset: a verdict names the claim it answers
  attempts       INTEGER NOT NULL DEFAULT 0, -- claims since the last arm: the backoff's count
  claimedAt      INTEGER,
  nextAttemptAt  INTEGER,
  pushedAt       INTEGER,                  -- written by markOutboxVerdict alone, at the first accepted send
  verdict        TEXT,                     -- the last PushSendVerdict, as JSON
  silentWhy      TEXT,                     -- a PushSilentWhy
  settledAt      INTEGER,                  -- when the row last reached a terminal state
  CHECK ((sourceKind IS NULL) = (sourceId IS NULL))
);
CREATE UNIQUE INDEX push_outbox_one_per_source ON push_outbox(sourceKind, sourceId) WHERE sourceKind IS NOT NULL;
CREATE INDEX push_outbox_due ON push_outbox(state, nextAttemptAt);
CREATE TABLE push_outbox_meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL); -- 'firstBootAt', written once by the boot pass
ALTER TABLE asks ADD COLUMN reachedOperatorAt INTEGER;
ALTER TABLE operator_items ADD COLUMN reachedOperatorAt INTEGER;
```

**Backfill:** none. A row raised before this migration has no stamp and no outbox row, and responses B reads a null
stamp as unmeasured, never as "not reached". I2 covers rows that reach the operator after PR B ships. A blocking toggle
on an older item writes both (Task 5). The held drain stamps only items whose `heldUntil` falls at or after
`firstBootAt`.

**Interfaces** (each move checks `outboxMoveAllowed` and is a compare-and-set on its `from` state):
- `insertBoundRowInTx(db, row: { source: OutboxSource; sourceId: number; pushId: string; payload: PushPayload | null; state: 'pending' | 'silent'; silentWhy: PushSilentWhy | null; at: number }): number`, which opens no transaction, so it runs inside the caller's `tx`;
- `stampReach(db, source, id, at): { changed: boolean }`, the one writer of `reachedOperatorAt`: `WHERE reachedOperatorAt IS NULL`, so a row is stamped at most once. It opens no transaction and is called inside the move's;
- `armBoundRowInTx(db, source, sourceId, row: { pushId: string; payload: PushPayload; at: number }): { inserted: boolean }`, the upsert: an existing row moves to `pending` from any state, keeps its `pushId`, takes the new payload, resets `attempts` and `nextAttemptAt`, and sets `armedAt`; no row inserts one with the given `pushId`;
- `insertUnboundRow(db, row): { ok: true; id; claimSeq } | { ok: false; detail }`, its own `tx`, written straight to `sending` (claimed at its insert);
- `claimOutboxRow(db, id, at): { changed: boolean; claimSeq: number }` (`pending` or `retrying` to `sending`, `attempts + 1`, `claimSeq + 1`, `claimedAt`);
- `silenceOutboxRow(db, id, why, at): { changed: boolean }` (`pending` or `retrying` to `silent`, after the source re-read);
- `markOutboxVerdict(db, id, claimSeq, to, verdict, at, nextAttemptAt): { changed: boolean }` (`WHERE state = 'sending' AND claimSeq = ?`; writes `pushedAt` only on the first `sent`; nulls `payload` and sets `settledAt` on a terminal move);
- `dueOutboxRows(db, now): OutboxRead` (`pending`, and `retrying` past `nextAttemptAt`, oldest first);
- `openOutboxRows(db): OutboxRead` (every non-terminal row, for the boot pass);
- `sealAtBoot(db, id, to: 'unknown' | 'failed', at): { changed: boolean }`;
- `heldItemsReached(db, now, firstBootAt): ItemsRead` (items with `heldUntil` in `[firstBootAt, now]`, no stamp, and `operatorWasShown` true at `now`, whether still open or closed after `heldUntil`);
- `purgeOutbox(db, before): { removed: number }` (terminal unbound rows whose `settledAt` is older than `OUTBOX_KEEP_MS`; a bound row stays while its source row exists).

`OutboxRead` is `{ ok: true; rows } | { ok: false; detail }`, never an empty list for a failed read.

**The verdict.** `PushService.notify(payload): Promise<PushSendVerdict>`. Each send passes
`{ TTL: 600, timeout: OUTBOX_SUB_TIMEOUT_MS }`. No subscription answers `no-subscription`. Each subscription answers
`accepted` on a resolved send, `gone` on 404 or 410 (pruned, as today), `refused-for-good` on 400, 403 or 413, `refused`
on any other `WebPushError` and on an error raised before the request left the box, and `no-answer` on a reset or
timeout after it was written. `endpointHash` is the hex SHA-256 of the endpoint, so no endpoint is stored. A failed
prune write still rejects, as today. The sender reads a rejection as a `null` verdict.

- [ ] **Step 1: Failing tests:** insert a bound row in a `tx` that then throws: neither the row nor the stamp lands; a
  second bound row for the same source is refused by the unique index; `stampReach` changes once and answers
  `changed: false` the second time; `armBoundRowInTx` on a `sent`, a `sending` and a `silent` row moves each to
  `pending` with the same `pushId`, `attempts` 0 and a new `armedAt`, and with no row inserts one; `claimOutboxRow` on a
  `sending` or terminal row changes nothing; `markOutboxVerdict` with a stale `claimSeq` changes nothing; a terminal
  verdict nulls `payload` and sets `settledAt`; a second `sent` after a re-arm leaves `pushedAt` at the first;
  `heldItemsReached` leaves out an item closed before `heldUntil`, keeps one closed after it, and leaves out one whose
  `heldUntil` is before `firstBootAt`; `purgeOutbox` keeps bound rows; the migration's slot found by `findIndex`; the
  `CHECK` refuses a kind without an id. `PushService.notify` with no subscription, one accepted, a 404 (pruned), a 429,
  a 403, `ECONNREFUSED`, a reset after the write, a subscription that hangs past its timeout beside one that accepts
  (the verdict is `sent`), and three subscriptions mixed.
- [ ] **Step 2: Run.** Red. **Step 3: Implement** in `continuityStore.ts`'s prepared-statement shape. **Step 4: Run**
  these suites, `test/coord-db.test.ts`, `test/run-close-switch.test.ts`, `test/single-definition/writers-map.test.ts`,
  `test/push-masker-pin.test.ts`, `test/notify-push.test.ts`, `test/secret-mask.test.ts`, `test/typecheck-tests.test.ts`,
  both `tsc` runs. Green. The funnel still ignores the answer, so no caller's behaviour changes.
- [ ] **Step 5: Mutation.** Drop `WHERE reachedOperatorAt IS NULL`: the stamped-twice case goes red. Drop the unique
  index: red. Drop `claimSeq = ?` from the verdict write: the stale-claim case goes red. Let `notify` read
  `ECONNREFUSED` as `no-answer`: red. Revert each.
- [ ] **Step 6: Commit.** `feat(coord): push_outbox, the reach stamps on asks and items, and PushService's per-send verdict (H18, C67)`

**PR A ends here.**

### Task 4: The one sender, and every funnel site behind it (L4)

**Files:**
- Create: `server/src/pushSender.ts` (L4, C6)
- Modify: `server/src/notice.ts` (`sendPush` calls `senderFor(deps).send`; `NoticeDeps` gains the optional `coord`
  outbox port, `time` and `masker` the sender reads)
- Modify: `server/src/deps.ts` (no new field: `Deps` already carries `push`, `coord`, `time` and `masker`; the funnel's
  deps type is widened to accept it)
- Modify: `server/src/watch.ts`: `FleetWatcher.pushOne`, the two `noticeSink(this.deps)` sinks, the delegation adoption
  sink and `pushRelease`, which passes `this.deps` instead of `{ push: sender }`; and the lane's one call
- Modify: `server/src/server.ts` (`noticeSink(deps)` and the `POST /api/notify` call already pass `deps`; no change
  unless the type widening needs one), `server/src/coord/diskAlarmLane.ts`, `server/src/coord/buildCaptureLane.ts`
  (each passes the deps it holds, which must carry `coord`, `time` and `masker`)
- Modify: `server/src/laneSchedule.ts` (the `pushOutbox` row), `server/src/index.ts` (the boot pass)
- Modify: `server/test/notify-push.test.ts` (`callers()` becomes `{ 'pushSender.ts': 1 }`), `server/test/pushSeam.ts`,
  `server/test/lane-schedule.test.ts` (the monotonic count, and a row-pin case like the timers row's),
  `server/test/push-composition-pin.test.ts` (the boot call), and `push-copy.test.ts`'s release-push docstring line
- Test: `server/test/push-sender.test.ts` (new)

**Interfaces:**

```ts
export interface SenderDeps {
  readonly push?: Pick<PushService, 'notify'> | undefined;
  readonly coord?: Partial<OutboxStorePort> | undefined;   // a narrow test double without the port sends with no row
  readonly time?: TimePorts | undefined;
  readonly masker?: PayloadMasker | undefined;             // read at each call, so index.ts's late masker holds
}
export interface PushSender {
  /** Mask the payload and mint its push id. No I/O, so a caller may run it inside its transaction. */
  prepare(payload: PushPayload): { readonly payload: PushPayload; readonly pushId: string };
  /** An unbound push: insert it claimed, send it now. `failed` is the caller's sentence for a rejected send. */
  send(payload: PushPayload, opts?: { readonly failed?: string }): void;
  /** A bound row its raising or arming transaction wrote `pending`: re-read its source, claim it, send it now. */
  sendRow(id: number): void;
  drain(now: number): Promise<void>;
}
/** One sender per PushService instance (a WeakMap), so every deps object built from one Deps shares it. */
export function senderFor(deps: SenderDeps): PushSender;
/** Run once by index.ts, synchronously, right after the store opens and the landing replay passes. */
export function bootPushOutbox(coord: OutboxStorePort, clock: Clock): void;
```

- **No push service.** `senderFor` with no `push` answers a sender whose every method does nothing, and writes no row.
- **Send.** `send` prepares the payload, inserts the row at `sending` and calls `notify`. `sendRow` re-reads the source
  (an ask still released or declined and not answered; an item still open), asks `pushDue` with `event: 'claim'`,
  silences the row on `silent`, and otherwise claims it and calls `notify`. A lost claim (`changed: false`, the drain
  won) is normal: it neither logs nor sends anything else. Each attempt starts one `Scheduler.after(OUTBOX_SEND_DEADLINE_MS)`
  timer and cancels it when the verdict lands. Its verdict, a `null` from the deadline, or a `null` from a rejection
  goes through `outboxNextState` to `markOutboxVerdict` with that attempt's `claimSeq`, so a late answer from an older
  attempt changes nothing. A rejection never escapes as an unhandled rejection. It prints the caller's `failed`
  sentence when one was given, exactly as today. A failed insert or claim logs once per cause through a `changeLatch`
  and, for `send`, sends the payload with no row.
- **Drain.** The lane row's pass: `dueOutboxRows`, each row through `sendRow`'s re-read and claim, all sent in parallel,
  so one hung send does not hold the others. It also stamps held items that have reached the operator (Task 5) and runs
  `purgeOutbox`.
- **The lane row.** `{ name: 'pushOutbox', cadenceMs: 30_000, derivedFrom: null, clock: 'mono', flight: 'skip',
  staleAfterMs: 2 * OUTBOX_SEND_DEADLINE_MS, warnKey: 'ccrc-server: the push outbox lane failed' }`, with `'pushOutbox'`
  added to `LaneName`.
- **Boot.** `index.ts` calls `bootPushOutbox` synchronously right after `new CoordStore` and the landing replay, before
  the fleet link connects, the server listens or the watcher starts. So nothing can push before it, and every
  `sending` row it finds belongs to a process that has died. It writes `firstBootAt` if absent, then applies
  `outboxBootVerdict` per row: `seal-unknown`, `fail-stale`, or left for the first drain to send. A failed read logs and
  seals nothing, and the next drain reads again.
- **The funnel.** `raise` builds the payload with `noticePayload`, asks `pushDue` with
  `{ event: 'reach', source: 'none', blocking: true, viewing, settled: false, payload: true }` from the presence gate it
  already reads, and calls `send` on `now`. `notifyPushOnly` calls `send` with its caller's `failed` sentence and no
  gate, as today. The ring record, the archive and their order are unchanged.
- **The release push and D-3295.** D-3295 says the release push goes out "at most once" and "is not retried". After
  this task it is still shown at most once. A rejected send is `unknown` and not retried, and its `failed` sentence
  ("it is not retried") stays true and pinned. A send that every subscription refused is retried within the ten-minute
  horizon: no device took it, so no device can show it twice. `pushRelease`'s docstring says so.

- [ ] **Step 1: Failing tests:** a push with a store writes one row at `sending`, then `sent` with `pushedAt` and its
  verdict; with no subscription, `unsent`; three refusals then an accept, through drains at the backoff times (allowing
  for the 30 to 60 s first retry); a refusal past the horizon ends `failed`; a send that never answers ends `unknown` at
  the deadline and its timer is cancelled on a verdict; an attempt sealed `unknown`, then a re-arm and a second claim,
  then the first attempt's late `refused`: the second attempt's row is unchanged; a rejected send prints the caller's
  sentence once and leaves no unhandled rejection; with no push service, no row and no send; with no store, and with an
  insert that throws, the push is still sent once, with no row; a lost `sendRow` claim sends nothing; `bootPushOutbox` on
  a store holding a `sending`, a fresh `pending`, a fresh `retrying` and a stale `pending` row seals the first, fails the
  last, and the next drain sends the other two once each; a second boot sends nothing; the composition pin shows the
  boot before `connectFleet`. Task 1's suite with its seam unchanged: green.
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run** these suites, Task 1's, every test in "What exists
  today"'s list, `test/lane-schedule.test.ts`, the watcher-quiet census, `test/typecheck-tests.test.ts`, both `tsc`
  runs. Green.
- [ ] **Step 5: Mutation.** Let the boot pass send `sending` rows: the second-boot case goes red. Let `send` skip the
  push when the insert throws: red. Drop the `claimSeq` compare: the late-verdict case goes red. Swallow the `failed`
  sentence: red. Revert each.
- [ ] **Step 6: Commit.** `feat(notice): one sender drains the push outbox, with retries and a boot pass that never retries a claimed attempt (H18)`

### Task 5: The raising transactions: asks and items

**Files:**
- Modify: `server/src/coord/store.ts` (`insertAsk`'s released mint, `releaseAsk` and `declineAsk` take the outbox row)
- Modify: `server/src/coord/questions.ts` (`hold`, `lapseAsks` and the release door pass the prepared payload in; the
  release door reads the hold without deleting it; no new `hold(` call, since `ask-digest.test.ts` counts them)
- Modify: `server/src/coord/ledgersStore.ts` (`raiseItemInTx`, `setBlocking`, `heldItemsReached`),
  `server/src/coord/ledgersRoutes.ts#pushBlocking`
- Modify: `server/src/watch.ts` (`pushRaised`'s `released` arm hands the row's id to the funnel; the questions owner
  receives the active-projects snapshot and the presence read beside its push sink)
- Test: `server/test/push-outbox-asks.test.ts`, `server/test/push-outbox-items.test.ts` (new)

**Asks.** Three moves make an ask reach the operator: the mint at `released` (`insertAsk` with a `releaseReason`), the
lapse (`releaseAsk`) and the parent's release (`declineAsk`). Each takes an optional bound row, and writes the row,
`stampReach` (with the move's own `now`) and the move in one `tx`. So `releaseAsk` and `declineAsk` gain the transaction
they lack.
- **The payload.** It comes from `noticePayload` over the hold's `ev`, with the active-projects snapshot, prepared by
  `senderFor(deps).prepare` before the `tx`. For the minted-released ask, `ev` is built from the same inputs before the
  insert. Its text is today's, byte for byte (Task 1).
- **The state.** It is `pushDue`'s answer, asked once before the `tx` with `viewing` from the presence gate: `pending`
  on `now`, otherwise `silent` with its `why`. The funnel is then told that answer for its record gate. It never reads
  presence a second time, and it calls `sendRow` for a `pending` row.
- **The handover door.** The release door reads the hold's `ev` without deleting it. It deletes the hold only after
  `declineAsk`'s compare-and-set wins. When no in-memory hold exists (after a restart, or with no watcher), the move
  still writes the stamp and a `silent` row, `no-payload`. Today such a handover pushes nothing, and this keeps it so.
- **Beaten moves.** A beaten compare-and-set writes no row. If `decideAskLapse` still answers `push-and-drop`, its push
  stays an unbound funnel push, as today (Task 1 pins it). No unbound push follows a move that committed a `pending`
  bound row.
- **Unbound ask pushes.** `answeredLate`, `approvalRuled`, `approvalReleased`, every approval push, the held
  amendment's replacement push and a top-level session's dialog push stay unbound.

**Items.**
- **The raise.** `raiseItemInTx` takes a `(id) => { payload; pushId }` callback, as `raiseItemWithMail` takes
  `queue(id)`. The callback builds the payload with `noticePayload` from `pushBlocking`'s copy (kind `coord`, title
  "Waiting on you", the item's title, tag `item-<id>`, `url: WAITING_URL`) and prepares it. When `heldUntil` is null,
  `raiseItemInTx` writes the stamp and the row: `pending` when blocking, `silent`, `level` otherwise. `pushBlocking`
  becomes the funnel call with that row's id.
- **The toggle.** `setBlocking(true)`, when it moved the level, calls `armBoundRowInTx` inside its own transaction,
  whatever the row's state, and stamps the reach if absent. That covers an item open before PR B and a held item toggled
  inside its hold, both of which push today. Then the funnel calls `sendRow`.
- **A held item.** It gets its stamp at `heldUntil`, and its row, from the drain through `heldItemsReached`, in one `tx`
  per item. The row's state is `pushDue`'s answer for the item's current level: `pending` if it became blocking during
  the hold and was never toggled (a toggle would already have written the row), otherwise `silent`, `level`.

- [ ] **Step 1: Failing tests:** a lapse that wins writes the ask's stamp, its row and its `released` state together,
  and a throw inside the `tx` lands none; a beaten lapse writes no row; a second lapse attempt on a released ask writes
  nothing; the stamp equals `releasedAt` on all three moves (open question 6); the stored payload of a minted-released
  ask, a lapsed ask with two active projects and a blocking item equals the payload today's push carries, byte for byte;
  a viewed session's ask gets a `silent` row and no push; the handover door keeps the hold when `declineAsk` loses, and
  with no in-memory hold writes a `silent` `no-payload` row and pushes nothing; a blocking raise writes `pending` and
  pushes once; a `soon` raise writes `silent` and pushes nothing; a toggle to blocking re-arms and pushes once with the
  same push id and tag; a toggle while the row is `sending` arms it, and the in-flight verdict is dropped; a toggle on an
  item with no row (raised before the migration, and held) writes the row and the stamp and pushes once; a crash
  between `setBlocking`'s level and its arm cannot happen (one `tx`); an end-request item gets no stamp before
  `heldUntil`, one stamp at `heldUntil` and one `silent` row after it while open, none when it closed first, and a
  `pending` row when it became blocking inside the hold; a bound row whose ask was answered before the drain claims it
  goes `silent`, `settled`. Task 1's suite: unchanged, green.
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run** these suites, Task 1's,
  `ledgers-coordinator-routes`, the ask and approval suites, `test/single-definition/ask-digest.test.ts`, both `tsc`
  runs. Green.
- [ ] **Step 5: Mutation.** Write the outbox row after the `tx` instead of inside it: the throw case goes red. Let a
  beaten lapse write a row: red. Delete the hold before `declineAsk`: the lost-race case goes red. Arm only from a
  terminal state: the in-flight and no-row toggle cases go red. Let `heldItemsReached` read an item closed before
  `heldUntil`: red. Revert each.
- [ ] **Step 6: Commit.** `feat(coord): an ask or an item reaches the operator with its stamp and its one outbox row, in one transaction (I2)`

### Task 6: The word, and the record of what changed

**Files:**
- Modify: `shared/api.ts` (`ServerCap` and `SERVER_CAP_MAP` gain `push-outbox-v1`, beside its type)
- Modify: `README.md` (the notifications paragraph: pushes are recorded, retried and sent at boot)
- Create: `docs/superpowers/plans/2026-11-14-overlord-w1/w1-push-outbox/departures.md`

The word promises: every push the server sends has an outbox row, or is logged as unwritable; an ask or an item that
reached the operator after this build shipped carries `reachedOperatorAt` and one outbox row written in the same
transaction; a claimed attempt is never retried.

- [ ] **Step 1:** Add the word and its comment. **Step 2: Run** `test/health.test.ts`, `test/ccrc-api.test.ts`,
  `test/claimant-client-pin.test.ts`, both `tsc` runs and pwa's. Green.
- [ ] **Step 3:** Before the push, read the mail lane and `notice.ts` at the oldest version a box can roll back to
  (`ccrc versions` lists them, `git show <tag>:server/src/notice.ts`). Record in the departures note that an older build
  ignores `push_outbox`, `push_outbox_meta` and the two columns, as Table 11.5's "ignored" class.
- [ ] **Step 4: Commit.** `feat(api): advertise push-outbox-v1 (H18)`

## Rollback below `push-outbox-v1`

An older server reads the newer database: the higher `user_version` is readable, and it never reads `push_outbox`,
`push_outbox_meta` or `reachedOperatorAt`. Its pushes are today's. A rollback loses the rows still unsent at the moment
it stops this build, which is the same set a crash loses today. No hold exists in W1, so no row waits on a push that an
older build would drop. That is why the refusal of §11.5 ships with the hold tier (open question 5). After a roll
forward, the boot pass sends the rows that were `pending` or `retrying` when this build last stopped, if they are
inside the retry horizon. It fails the older ones.

## Deviations found

None yet. **Spec departures**, for the spec's next correction:

- **verdict-ships-with-the-outbox** — the per-send verdict is this piece's, not responses PR A's (open question 2).
- **a-claimed-row-is-never-sent-again** — the boot pass sends rows no attempt claimed, and seals a claimed attempt
  `unknown`. So "sends every unsent row again at boot" reads "every row no attempt claimed, inside the retry horizon"
  (open question 3).
- **item-held-until-is-a-hold** — items already have a hold, `heldUntil`. The drain stamps their reach at it (open
  question 4).
- **rollback-refusal-ships-with-holds** — W1 advertises `push-outbox-v1` and refuses no rollback. The refusal, and the
  record of each build's server words it first needs, ship with W3's hold arming (open question 5, ruled R1).
- **silent-is-its-own-state** — the spec says a silent row is "marked sent at once". Here it is `silent`, a terminal
  state of its own with its reason, so `sent` always means the push service accepted it.

Decisions this plan takes, by slug:

- **every-push-rides-the-outbox** — open question 1.
- **bound-rows-are-asks-and-items** — open question 7.
- **reach-stamp-beside-released-at** — open question 6.
- **rearm-is-an-upsert** — open question 8 (ruled).
- **sender-wraps-deps-push** — `Deps.push` stays the whole `PushService`, and `senderFor` derives one sender per
  service from the deps each funnel site already passes (fix round 1, 1).
- **one-payload-builder** — `noticePayload` is the one owner of a push's text, and the sender's `prepare` masks it
  (fix round 1, 2).
- **pushed-at-on-the-outbox-row** — `pushedAt` is a column of the outbox row, read through the source, so the one fact
  has one place and one writer.
- **claim-seq-ties-the-verdict** — `claimSeq` never resets, and a verdict lands only on the claim it answers. `attempts`
  resets at each arm, for the backoff.
- **horizon-from-armed-at** — a re-arm resets `attempts` and `nextAttemptAt`, keeps the push id, and starts the horizon
  again.
- **unbound-push-claimed-at-insert** — an unbound row is written straight to `sending`, so a crash right after it is
  `unknown` at boot, as today's lost push.
- **no-answer-is-never-retried** — a reset or timeout after the request was written may hide an accepted push, so it
  reads `unknown`. An error raised before the request left the box reads `refused` and is retried.
- **retry-horizon-is-the-ttl** — refused rows retry for the push's own ten-minute lifetime from `armedAt`, then `failed`.
- **all-gone-is-unsent** and **permanent-refusal-fails** — no retry when nothing is left to deliver to, or the refusal
  cannot pass.
- **payload-nulled-when-terminal** — a row's text lives only while it may still be sent.
- **stale-rows-fail-at-boot** — a `pending` or `retrying` row past the horizon at boot is `failed`, so a restored snapshot
  never re-sends.
- **re-read-before-claim** — a bound row's source is read again before each attempt, and a settled source silences it.
- **presence-read-once** — a bound row's presence is asked once, before its transaction, and the funnel uses that answer.
- **handover-reads-before-it-deletes** — the release door deletes the hold only after its compare-and-set wins.
- **boot-after-the-store-opens** — the boot pass runs synchronously right after the store opens, before anything can
  push, so it needs no process id to tell a dead attempt from a live one.
- **no-push-service-no-rows** — with no push service nothing is written, as nothing is sent today.
- **release-push-shown-at-most-once** — D-3295's "at most once" holds as shown at most once, and a refusal by every
  subscription is retried.
- **no-backfill** — rows raised before the migration get no stamp, until an event on them writes one.
- **wire-types-in-a-sibling** — every new wire type is in `shared/push-outbox.ts`, and `shared/api.ts` gains only the
  word's row (index review F6).
- **two-prs** — the index's one pull request becomes two (The PR split).

## Where things stand

**Needs before it starts:** nothing beyond `main`. PR B needs PR A.

**Changed after review 2083 (fix round 1):**
- R1: the rollback refusal goes back to W3. `ccd/ccrc` and `deploy/` leave this piece.
- 1: the sender wraps `Deps.push`, and every funnel deps site is named.
- 2: one payload builder, masked by the sender's `prepare`, pinned byte for byte.
- 3: arming is an upsert inside `setBlocking`, and the held drain reads the current level.
- 4 to 10:
  - `claimSeq` ties each verdict to its attempt, and the deadline timer is cancelled.
  - `send` keeps the caller's sentence.
  - A re-arm resets the horizon.
  - The handover door reads before it deletes.
  - `NoticeDeps.push` is widened.
  - `run-close-switch.test.ts` gains the new migration's undo step.
  - Each subscription has a timeout, and an error raised before the send is retried.
- 11 to 20 and the nits:
  - A terminal row's payload is nulled, and stale rows fail at boot.
  - The source is re-read before each claim.
  - `heldItemsReached` follows `operatorWasShown`, stamps at `heldUntil`, and the backfill rule is stated.
  - `stampReach` is the one writer.
  - The boot runs after the store opens.
  - The lane row is given in full.
  - No push service means no rows.
  - The site table names its entry points and the callers that never push.
  - The verdict mapping and `outboxRetryAt`'s null are defined.
  - `silentWhy` is typed, the actors are renamed, `unknown`'s wording is fixed, and `silent` is listed as a departure.
- From the index review, F6 and F13 stand: the wire types are in a sibling, and the shared rows are named.

**What depends on it:** responses PR A (the push id, the verdict and the claim step); W3's holds, the repeat push and the
attention budget (`pushDue` gains `deferred`); W3's hold arming, which carries the rollback refusal; the readiness
piece's "a dead Overlord's one push", which is an unbound push through the same sender.

**What a merge arms:** nothing the operator sees changes, apart from two named effects. A push that every subscription
refused for a reason that can pass is retried for ten minutes. A push unsent when the server stopped is sent at its
next boot, if it is still inside that horizon. No Shadow lanes row is added.

**What the index should change:**
- The row reads "2 PRs, 6 tasks".
- "`PushService`'s per-send verdict" moves from responses PR A to this row.
- The rollback refusal below `push-outbox-v1` moves to W3's hold arming, with the obligation in open question 5.
- Lane E's file list adds:
  - the new files: `server/src/pushSender.ts`, `server/src/pushOutbox.ts`, `server/src/coord/pushOutboxStore.ts` and
    `shared/push-outbox.ts`;
  - the funnel deps sites: `server/src/deps.ts`, `server/src/server.ts`, `server/src/coord/diskAlarmLane.ts`,
    `server/src/coord/buildCaptureLane.ts`, and `server/src/watch.ts`'s `pushOne`, `pushRelease`, its two
    `noticeSink(this.deps)` sinks and the delegation sink;
  - `ledgersStore.ts`'s `raiseItemInTx`, `setBlocking` and `heldItemsReached`;
  - `server/test/run-close-switch.test.ts`;
  - the architecture spec's C6 row.
- The index names `docs/superpowers/plans/2026-11-14-overlord-w1/` as the piece plans' directory.

**Later:**
- Binding the other durable once-only marks (open question 7) to their outbox rows, one site per change: the stall
  observation row first, then the drift stamp, the release mark, the digest claim, the review-cap ask and the park
  escalation.
- The rollback refusal, with W3's holds.

**Open questions for the coordinator:** the eight at the top. Questions 5 and 8 are ruled, and each of the others carries
its recommendation.
