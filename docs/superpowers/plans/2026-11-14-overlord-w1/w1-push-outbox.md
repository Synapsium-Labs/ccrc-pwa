# Overlord W1: the push outbox, one sender for every push (`push-outbox-v1`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** every Web Push the server sends becomes a row of one table, `push_outbox`, and one sender drains it. The
sender holds the only `PushService.notify` call. It marks a row sent when the push service accepts it, retries a row
the service refused, and at boot sends again every row that no attempt claimed. An ask or an item that reaches the
operator gets a reach stamp, `reachedOperatorAt`, and its one outbox row, both in the transaction that raises or
releases it. A row whose level makes no push today gets its outbox row too, marked `silent`. One L1 decider, `pushDue`,
says whether a row pushes now or stays silent. Each row carries a random push id. The pushes the operator receives are
the same as today's, behind characterization tests written first, and the server advertises the change with its own
capability word, `push-outbox-v1`.

**Why:** today a push is a call that returns nothing. It is fire-and-forget, a crash between a row's write and its push
loses the push for good, and nothing records whether a row reached the operator. W3's holds delay pushes, so they need a
durable record of each push before they can be armed (§6.7, H18). The response record (W1's next piece in this lane)
needs a push id and a per-send verdict on each push (§4.3, C67).

**Architecture:** L0 vocabulary in a new `shared/push-outbox.ts`: the row states, `OUTBOX_TRANSITIONS` with the actor of
each move, the verdict words and the bounds. L1 deciders in a new `server/src/pushOutbox.ts`: `pushDue`, the verdict's
next state, the retry time and the boot pass's answer per row. L2: the sender's port, declared by the funnel. L3: the
table's functions in a new `server/src/coord/pushOutboxStore.ts`, with one-line `CoordStore` delegates, and a per-send
verdict from `PushService.notify`. L4: the sender in a new `server/src/pushSender.ts`, with a `LANE_SCHEDULE` row for
retries and a boot pass run once by the composition root. The funnel (`server/src/notice.ts`) hands every push to the
sender instead of sending it. Two pull requests.

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
recommendation unless the coordinator rules otherwise.

1. **Which pushes go through the outbox** (slug `every-push-rides-the-outbox`). Table 11.1a names the questions owner as
   the outbox's writer, which reads as asks and items only. §4.3 and C67 say the funnel mints a push id for each push
   and stores it on that push's outbox row, which reads as every push. **Recommendation:** every push. The funnel's
   one send (`server/src/notice.ts#sendPush`) becomes the sender's insert, so all 29 sites listed below move at once,
   and the sender holds the only `PushService.notify` call. Only asks and items are bound to a source row with a reach
   stamp. A second, unbound send path would be a parallel mechanism.
2. **The per-send verdict ships here, not in the response record** (slug `verdict-ships-with-the-outbox`). The index puts
   `PushService`'s per-send verdict in responses PR A. The sender cannot mark a row sent, or retry one, without it.
   **Recommendation:** this piece adds the verdict whole (each subscription accepted, refused, gone or unanswered, with
   the hash of its endpoint), and the response record reads it. The index row changes (below, "What the index should
   change").
3. **At most once across a crash** (slug `a-claimed-row-is-never-sent-again`). The spec says the sender "sends every
   unsent row again at boot". The brief says the boot pass must never push twice. The service worker shows a repeat
   with the same tag as a new alert (`renotify: Boolean(data.tag)`, `pwa/public/push-sw.js`), so a repeat is a second
   ping. **Recommendation:** a row is claimed in its own transaction before each attempt. At boot, a row no attempt
   claimed is sent. A row claimed with no verdict (the process died during the send) is sealed `unknown` and never
   sent again. The one gap is a death between the claim's commit and the send call, which run in the same synchronous
   step. "At least one push attempt" (I2) then reads "at least one claimed attempt".
4. **A held item's reach** (slug `item-held-until-is-a-hold`). The spec says an item "had no hold before". The tree has
   one: `operator_items.heldUntil`, set by the end-request, run-close-refusal and review-release raises, keeps an item
   off Waiting on you until it passes (`ledgersStore.ts#itemsFor`). Nothing happens at that time, because the list
   derives it on read. **Recommendation:** an item raised with no `heldUntil` is stamped at its raise. A held item is
   stamped, with its silent outbox row, by the sender's lane pass once `heldUntil` has passed while the item is still
   open, through the same one writer. All three raises are `soon` or `later`, so none pushes, before or after.
5. **Rollback below `push-outbox-v1`** (slug `rollback-refusal-ships-with-holds`). §11.5 says `ccrc rollback` below the
   word refuses unless forced. The refusal protects holds, and W1 has none. `ccrc rollback` (`ccd/ccrc#cmd_rollback`)
   reads no server, no `coord.db` and no capability word today. **Recommendation:** W1 advertises the word only. The
   refusal ships with the hold tier's arming in W3, the first state a rollback could lose. A rollback from this build
   loses at most the rows still unsent, which is no worse than today's crash.
6. **The ask's reach stamp beside `releasedAt`** (slug `reach-stamp-beside-released-at`). `asks.releasedAt` already
   records "the instant the operator's push was released" (`CoordStore.declineAsk`). In W1 the two are equal. In W3 an
   ask the coordinator releases may be held for the Overlord, so they part. **Recommendation:** a column of its own,
   written in the same statement as `releasedAt` in W1, with a test that pins the two equal until W3.
7. **The durable once-only marks of other sites** (slug `bound-rows-are-asks-and-items`). Seven other sites write a
   durable once-only mark before their push: the stall rungs' observation row, the drift stamp, the release mark, the
   digest claim, the review-cap ask, the park escalation and the stall notice. A crash between the mark and the push
   loses that push, today and after this piece. **Recommendation:** W1 binds asks and items only (I2's rows). Each other
   site keeps its mark and enqueues through the funnel after it, unchanged. Folding a mark and its outbox row into one
   transaction is a follow-up per site, listed in "Where things stand".

## What exists today

Measured on `main` at `416b8f942`.

- **One send.** `server/src/notice.ts#sendPush` holds the only `PushService.notify` call in `server/src`, and
  `server/test/notify-push.test.ts` pins it (`callers()` equals `{ 'notice.ts': 1 }`). The funnel's `raise` (behind
  `notify` and `notifyEach`) reaches it in modes `'push'` and `'record-always'`, after the presence gate
  (`Viewers.isVisible`, `server/src/viewer.ts`), the ring record and the guarded feed archive. A send there is not
  awaited and its rejection is not caught. `notifyPushOnly` reaches it with no gate, no ring and no archive, and logs a
  rejection under its caller's sentence.
- **`PushService.notify`** (`server/src/push.ts`) returns nothing. It returns early with no subscription, sends to every
  subscription at once with `TTL: 600`, prunes a 404 or 410 and swallows every other error. It masks every payload with
  `maskDeep` before it serialises it (`push-masker-pin.test.ts`). `index.ts` builds one (`push-composition-pin.test.ts`).
- **The service worker** shows a push under its tag with `renotify: Boolean(data.tag)`, so a second push with the same
  tag alerts again. Its tap handler replaces the notification under the same tag.
- **The 29 push sites today**, each ending in `sendPush`. "Default tag" is `${kind}-${sessionId}`. "Bound" marks the
  rows this piece binds to a source row.

| # | Site | Kind, mode | Tag | Durable row and its once-only guard |
|---|---|---|---|---|
| 1 | `FleetWatcher.tick`'s busy-to-idle edge | `done`, push | default | none; an in-memory edge |
| 2 | `FleetWatcher.pushNewMail` | `mail`, record-always (record-only for stall checks, nudges, timer mail and others) | `mail-<to>-<mailId>` | the mail row, written earlier; an in-memory watermark |
| 3 | `FleetWatcher.pushNewRuns` | `run`, record-always (record-only for `closing` and swept closes) | `run-<runId>-<state>` | `run_events`, written earlier; an in-memory watermark |
| 4, 5 | `FleetWatcher.pushSenderNotice`, `escalatePark` | `mail`, record-always | `mail-blocked-…`, `mail-parked-…`, `mail-revived-…` | the mail row; `markParkEscalated`'s compare-and-set |
| 6 | the brief-not-taken pass of `sweepMail` | `mail`, record-always | `briefNotTakenTag` | `queueStallNotice`'s row; its refusal of a repeat |
| 7, 8 | `FleetWatcher.applyStall`, `applyStallSession` with a run (the stall watch's operator rung) | `run` or `mail`, record-always | `stallPushRoute`'s tag | `recordStallObservation`, its own transaction; the push only when `recorded` |
| 9 | `applyStallSession`, run-less | as 7 | as 7 | none; the in-memory `stallLatch` |
| 10 | `FleetWatcher.announceMerged` | `merged`, push | `merged-<key>` | the feed archive; `hasNotice` and `dedupeKey` |
| 11 | `sweepLanding`'s deliver step | `queue`, record-always | the record's tag | the run and its mail; `hasMailWithSubject`, `hasNotice` |
| 12, 13 | `detectDialogs`' `raise` and its amendment | `ask`, push | default | none for a top-level session's dialog; the dialog-id edge |
| 14 | `pushRaised`, a `released` verdict (an ask minted released) **Bound** | `ask`, push | default | `CoordStore.insertAsk`, its own transaction |
| 15 | the question doors' sink: `released` after `declineAsk` **Bound**; `answeredLate`, `approvalRuled`, `approvalReleased` | `ask`, push | default | `declineAsk` (a compare-and-set, no transaction); the others none |
| 16 | `questions.lapseAsks`, `push-and-drop` after `releaseAsk` wins **Bound** | `ask`, push | default | `releaseAsk` (a compare-and-set); the push follows, outside it |
| 17 | `questions.lapseApprovals` | `ask`, push | default | `lapseApproval`, `staleApproval` |
| 18 | `digestBeat` | `coord`, record-always | the digest's tag | `claimDigestDay` |
| 19 | `DiskAlarmLane.raiseNotice` | `coord`, push (record-only for the clear) | `disk` | a file marker; `hasNotice` |
| 20 | `BuildCaptureLane.raiseFailure` | `coord`, push | `claude-build-capture` | `hasNotice` |
| 21 | `ledgersRoutes.ts#pushBlocking`, from the raise route and `POST /api/items/:id/blocking` **Bound** | `coord`, push | `item-<id>` | `raiseItem` and `setBlocking`, each its own transaction; the push follows |
| 22 | the run-open route's review-cap refusal (`coord/routes.ts`) | `run`, push | `review-cap-<work>` | `raiseReviewCapAsk`'s insert |
| 23 | the advance route's landing ejection (`@landing-ejection-ask`) | `run`, record-always | the ask's tag | the landing journal and its transaction |
| 24, 25 | `coord/driftLane.ts`, the summary and its items | `coord`, push and record-always | `DRIFT_LANE_TAGS.summary`, `drift-<key>` | `markDriftPushed`, in a transaction, before the notice |
| 26 | `coord/landedLane.ts#raiseLandedNotice` | `merged`, record-always or record-only by `landedNoticeModeOf` | `merged-<key>` | `hasNotice`, `dedupeKey` |
| 27 | `coord/delegationAdoptStep.ts`, through the watcher's sink | `coord`, push | default | none; in-memory `memory.raised` |
| 28 | `FleetWatcher.pushRelease`, through `notifyPushOnly` | no kind | the release tag | `markReleaseNotified`, in a transaction |
| 29 | `POST /api/notify` with `push: true` (`server.ts`), through `notifyPushOnly` | no kind | the decision's tag | none |

- **Asks.** `CoordStore.insertAsk` writes a row `held`, or `released` with `releasedAt` when the claimant rule released
  it at the mint, in one `tx` (`server/src/coord/tx.ts`). `releaseAsk` (the lapse) and `declineAsk` (the parent's
  release) are compare-and-sets on `state = 'held'` that set `releasedAt`, in no transaction of their own. The push a
  held ask defers is the in-memory hold's `ev` (`QuestionPush`), built by `askHoldPayload`; the restart re-seed
  (`questions.loadReseed`) rebuilds it from the dialog's next sighting. `questions.lapseAsks` pushes after a won
  `releaseAsk`, and also on some beaten paths that `decideAskLapse` answers `push-and-drop`.
- **Items.** `operator_items` rows are written by `ledgersStore.ts#raiseItemInTx`, inside `raiseItem`'s or
  `raiseItemWithMail`'s `tx`. `setBlocking` is a `tx` that answers whether the level moved. Only the raise route and the
  blocking route push, and only for `neededBy === 'blocking'`. The three `ccrc`-raised paths (`endRequest.ts`,
  `runCloseRefusals.ts`, `reviewRelease.ts`) raise `soon` or `later` with a `heldUntil`, and `itemsFor` leaves a held
  item out of Waiting on you until `heldUntil` passes.
- **Time and chance.** `server/src/time/ports.ts` declares `Clock`, `Scheduler` and `Entropy` (`hex(bytes)`). New
  Overlord code takes them from `Deps.time`, and `server/test/single-definition/time-ports.test.ts` holds its scope
  (`TIME_PORT_FAMILIES`, `TIME_PORT_FILES`).
- **Lanes.** `server/src/laneSchedule.ts#LANE_SCHEDULE`, pinned by `server/test/lane-schedule.test.ts`.
- **Capability words.** `shared/api.ts#SERVER_CAP_MAP` (nine words, `timers-v1` the newest). `health.test.ts` and
  `ccrc-api.test.ts` read `SERVER_CAPS`.
- **Contexts.** The architecture spec's C6 row names `push.ts` and `notice.ts` exactly
  (`docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md`), so a new file there needs its row.
- **Tests that pin the funnel today:** `notify-push.test.ts`, `notice.test.ts`, `feed-writers-pin.test.ts`,
  `push-copy.test.ts`, `finished-push.test.ts`, `push-masker-pin.test.ts`, `push-composition-pin.test.ts`,
  `secret-mask.test.ts`, `account-canary.test.ts`, `disk-notice.test.ts`, `landing-ejection-ask.test.ts`,
  `landed-lane.test.ts`, `drift-push.test.ts`, `update-notify.test.ts`, `ledgers-coordinator-routes.test.ts`,
  `review-cap-store.test.ts`.
- Migrations: `server/src/coord/schema.ts#MIGRATIONS`. The slot is measured at build time, never fixed here.

## Global Constraints

- **Architecture (`CLAUDE.md`).** Decide in L1, act in L4. `pushDue`, the verdict's next state, the retry time and the
  boot pass's answer are L1 deciders over facts. The sender gathers facts, asks them and writes what they answer.
- **One writer per fact.** `reachedOperatorAt` has one writer, `stampReach` in `pushOutboxStore.ts`, called only inside
  a raising or releasing transaction. `pushedAt` has one writer, `markOutboxVerdict`, called only by the sender. Each
  outbox move goes through `OUTBOX_TRANSITIONS`, and `server/test/single-definition/writers-map.test.ts` names each
  writer.
- **One sender.** After PR B, `server/src/pushSender.ts` holds the only `PushService.notify` call. The census in
  `notify-push.test.ts` moves to it. A push whose outbox row cannot be written (no `coord.db`, or the insert throws) is
  still sent, through the same sender function, with no row and no push id (C67), and the sender logs it once per cause.
- **Pushes stay today's** (I9). Every site keeps its kind, title, body, tag, actions, url, mode and presence rule. Task 1
  pins them before any move. The behaviour changes are named and nothing else changes: a refused send is retried, an
  unsent row is sent at boot, and a level raised while its row's send is in flight adds no second send.
- **Bound rows** are asks and items only (open question 7). A bound row has exactly one outbox row, held by a unique
  index on its source (I2).
- **Time and chance through ports.** The new modules read `Clock` and `Entropy` from `Deps.time`, and join
  `TIME_PORT_FILES` in the pull request that creates them. The push id is `entropy.hex(16)`. SQL never reads the clock.
- **Masked at rest.** A payload is masked with the composition root's masker before it is stored. `PushService` still
  masks at the send.
- **Tests.** From `server/`: `ccrc test -- ./node_modules/.bin/vitest run test/<file>.test.ts`. Each task's last run adds
  both `tsc` runs (`ccrc test -- npx tsc --noEmit -p tsconfig.json` and `-p test/tsconfig.tests.json`), and pwa's `tsc`
  when `shared/` changed.
- **Mutation floors.** Every new L1 decider (`pushDue`, `outboxNextState`, `outboxRetryAt`, `outboxBootVerdict`) joins
  `MUTANT_SETS` through a new `server/test/sim/pushOutboxSets.ts` and `server/test/sim/mutation-floors.json`, in PR A.
- **Growth check** (`server/test/growthCheck.ts#GROWTH_FILES`, 40 net lines a file a pull request): each PR states its
  estimate below, and the builder measures it before pushing.
- **No door, no client verb, no ccd change, no PWA change.** This piece adds no route, so no door census moves.
- Cite by symbol or `@anchor`. No private names: fixtures `lane-a-project-a`, `prog-a`. No D-number invented: the
  builder's departures go in `docs/superpowers/plans/2026-11-14-overlord-w1/w1-push-outbox/departures.md`.

## Review Focus

1. **I2.** An ask or item that reaches the operator has exactly one reach stamp and one outbox row, written in the
   transaction that moves it. No path writes a second, and a reach on a row that did not move writes none.
2. **Never twice.** A row is sent only from a claim, a claim is a compare-and-set from `pending` or `retrying`, and a
   retry follows only a verdict in which every subscription refused. A row claimed by a dead process is sealed
   `unknown` at boot and never sent again.
3. **Today's pushes.** The characterization suite of Task 1 is green on `main` and unchanged after the move, except its
   one seam. A push the presence gate suppressed today writes no unbound row and, for a bound row, a `silent` one.
4. **A failed write never costs the push.** With no `coord.db`, or an insert that throws, the push still goes, as today.
5. **One writer each.** `reachedOperatorAt` and `pushedAt` each have one writer. `PushService.notify` has one caller.

## The PR split

| PR | Tasks | What it ships | Needs first | Growth-checked files, estimate |
|---|---|---|---|---|
| A, the record and its rules | 1 to 3 | The characterization suite; the vocabulary and deciders; `push_outbox`, the reach stamps, their writers, and the per-send verdict. Nothing reachable: no caller writes a row yet | nothing: **ready to build** | `server/src/coord/schema.ts` about +30; `server/src/coord/store.ts` about +10 |
| B, the sender and the move | 4 to 6 | The sender with its lane row and boot pass; the funnel behind it; the raising transactions for asks and items; the held item's reach; the word `push-outbox-v1` | PR A | `server/src/coord/store.ts` about +18; `server/src/watch.ts` about +16; `shared/api.ts` about +6 |

**Order:** PR A at once; PR B once PR A has merged. The index lists one pull request. Two keep the move, which changes
every push in the server, apart from the record it moves onto, and PR A's characterization suite is green on `main`
before anything moves.

**Why the word comes last.** `push-outbox-v1` is added by Task 6, the last commit of PR B, once every site writes rows
and the sender drains them.

**States the next piece reads.** Responses PR A reads: the push id column; `PushSendVerdict` and its endpoint hashes;
the claim step, inside whose transaction it writes the response row `pending` before the send (C67). It adds the push
id to the payload. W3 reads `pushDue`, which gains `deferred`, and the re-arm move, which its repeat push uses.

---

### Task 1: Today's pushes, pinned (characterization)

**Files:**
- Create: `server/test/push-outbox-characterization.test.ts`
- Create: `server/test/pushSeam.ts` (the one seam: a recording `PushService.notify` double, and how a harness installs it)

The suite drives each of the 29 sites of "What exists today" through its own entry (a lane call, a route, a watcher
tick on fixture sessions), with a recording double at the bottom of the stack. For each it pins the payloads the double
received, in order: `title`, `body`, `sessionId`, `tag`, `url`, `actions`, and how many. Each site is also driven with
the session visible, and with no push service. Asks and items also pin the source row's state and `releasedAt` after
the push. Sites that existing tests already pin (for example `disk-notice.test.ts`, `drift-push.test.ts`) are driven
here again at the payload level, so one suite is the arbiter of the move.

- [ ] **Step 1: Write** the suite and the seam. Today the seam installs the double as `NoticeDeps.push`. **Step 2:
  Run** on `main`'s code: green. It is a characterization, so it is green first.
- [ ] **Step 3: Mutation.** Change `pushBlocking`'s tag to `item-x`: the item row goes red. Drop the presence gate in
  `raise`: the visible cases go red. Revert each.
- [ ] **Step 4: Commit.** `test(notice): pin every push the server sends today, at the payload (characterization)`

### Task 2: The vocabulary and the deciders (L0, L1)

**Files:**
- Create: `shared/push-outbox.ts` (L0, C6; imports nothing)
- Create: `server/src/pushOutbox.ts` (L1, C6: pure; the time is a fact)
- Create: `server/test/sim/pushOutboxSets.ts`; Modify: `server/test/sim/mutation-floors.json` and `MUTANT_SETS`
- Modify: the architecture spec's C6 row (`push.ts` becomes `push*.ts`, and `coord/pushOutbox*.ts` is added)
- Modify: `server/test/single-definition/time-ports.test.ts` (`TIME_PORT_FILES` gains the new `server/src` files)
- Test: `server/test/push-outbox-vocab.test.ts`, `server/test/push-outbox-decide.test.ts` (new)

**Interfaces:**

```ts
const OUTBOX_STATE_MAP = {
  pending: 'written and due; no attempt holds it',
  sending: 'claimed for one attempt; the verdict is not in',
  retrying: 'every subscription refused; due again at nextAttemptAt',
  sent: 'the push service accepted it for at least one subscription (pushedAt)',
  silent: 'no push by decision: the level, or the operator was looking',
  unsent: 'no subscription, so nothing to deliver',
  failed: 'refused until the retry horizon passed',
  unknown: 'an attempt with no verdict: never sent again',
} as const;
export type OutboxState = keyof typeof OUTBOX_STATE_MAP;
export const OUTBOX_STATES = Object.keys(OUTBOX_STATE_MAP) as OutboxState[];
export const TERMINAL_OUTBOX_STATES = ['sent', 'silent', 'unsent', 'failed', 'unknown'] as const satisfies readonly OutboxState[];

export type OutboxActor = 'raise' | 'funnel' | 'sender' | 'boot' | 'level-raised';
export const OUTBOX_TRANSITIONS: readonly { readonly from: OutboxState | null; readonly to: OutboxState; readonly actor: OutboxActor }[] = [
  { from: null, to: 'pending', actor: 'raise' }, { from: null, to: 'silent', actor: 'raise' },
  { from: null, to: 'sending', actor: 'funnel' },                    // an unbound push, claimed at its insert
  { from: 'pending', to: 'sending', actor: 'sender' }, { from: 'retrying', to: 'sending', actor: 'sender' },
  { from: 'pending', to: 'silent', actor: 'sender' },                // the level fell before the send
  { from: 'sending', to: 'sent', actor: 'sender' }, { from: 'sending', to: 'retrying', actor: 'sender' },
  { from: 'sending', to: 'unsent', actor: 'sender' }, { from: 'sending', to: 'failed', actor: 'sender' },
  { from: 'sending', to: 'unknown', actor: 'sender' }, { from: 'sending', to: 'unknown', actor: 'boot' },
  // a bound row's level raised: its one row is armed again, from any terminal state
  ...(['sent', 'silent', 'unsent', 'failed', 'unknown'] as const).map((from) => ({ from, to: 'pending' as const, actor: 'level-raised' as const })),
];
export function outboxMoveAllowed(from: OutboxState | null, to: OutboxState, actor: OutboxActor): boolean;

export type OutboxSource = 'ask' | 'item';
export type SubscriptionVerdict = 'accepted' | 'refused' | 'gone' | 'no-answer';
export type PushSendVerdict =
  | { readonly kind: 'no-subscription' }
  | { readonly kind: 'sent'; readonly subs: readonly { readonly endpointHash: string; readonly verdict: SubscriptionVerdict; readonly status: number | null }[] };

export const PUSH_ID_BYTES = 16;
export const OUTBOX_SEND_DEADLINE_MS = 30_000;       // a send that has not answered by then has no verdict
export const OUTBOX_RETRY_BASE_MS = 30_000;          // 30 s, doubling
export const OUTBOX_RETRY_HORIZON_MS = 600_000;      // the push's own TTL: past it, a refused row is failed
export const OUTBOX_KEEP_MS = 7 * 86_400_000;        // a terminal unbound row is purged after a week
```

```ts
export interface PushDueFacts {
  readonly event: 'reach' | 'level-raised' | 'boot';
  readonly source: OutboxSource | 'none';
  /** An item's level, read from its row; an ask always pushes today. */
  readonly blocking: boolean;
  /** The presence gate's answer for the notice's session; `'unmeasured'` at boot. A notice with no session is never viewed. */
  readonly viewing: boolean | 'unmeasured';
}
/** Total over its facts. W1 answers `now` or `silent`; W3 adds `deferred` and changes no answer W1 gives. */
export type PushDue = { readonly due: 'now' } | { readonly due: 'silent'; readonly why: 'level' | 'viewing' };
export function pushDue(f: PushDueFacts): PushDue;

/** What a claimed attempt's verdict moves the row to. `null` is a send that did not answer by its deadline. */
export function outboxNextState(v: PushSendVerdict | null, row: { readonly attempts: number; readonly createdAt: number }, now: number):
  | { readonly to: 'sent' | 'unsent' | 'failed' | 'unknown' }
  | { readonly to: 'retrying'; readonly nextAttemptAt: number };
export function outboxRetryAt(attempts: number, now: number): number;

/** The boot pass's answer for one row it finds non-terminal. */
export function outboxBootVerdict(row: { readonly state: 'pending' | 'sending' | 'retrying' }): 'send' | 'seal-unknown';
```

**`pushDue`'s rules, first match:** an item that is not blocking is `silent`, `level`; a notice being viewed (`viewing`
true) is `silent`, `viewing`; `level-raised` is `now`; everything else is `now`, `'unmeasured'` included, because a boot
pass has no viewers and an unsent row reaches the operator rather than nobody. Today's modes map onto it: the funnel
asks `pushDue` only for `'push'` and `'record-always'`, and `'record-only'` writes no row, as today.

**`outboxNextState`'s rules:** `no-subscription` is `unsent`. Any `accepted` subscription is `sent`. Otherwise any
`no-answer` is `unknown`, because the service may have taken it. A `null` verdict is `unknown`. Every subscription
`refused` or `gone` is `retrying` at `outboxRetryAt`, unless that time is past `createdAt + OUTBOX_RETRY_HORIZON_MS`,
then `failed`. `outboxRetryAt` doubles from `OUTBOX_RETRY_BASE_MS` per attempt and never passes the horizon.

- [ ] **Step 1: Failing tests:** `outboxMoveAllowed` over every pair and actor; the state map's keys equal
  `OUTBOX_STATES`, and `TERMINAL_OUTBOX_STATES` is exactly the states with no move out but `level-raised`; `pushDue`
  over the full product of its facts (3 events, 3 sources, 2 levels, 3 viewing answers) against a table written in the
  test; `outboxNextState` over each verdict shape, a mixed `accepted` and `refused`, a mixed `refused` and `no-answer`,
  `null`, and a retry just inside and just past the horizon; `outboxRetryAt` at attempts 1 to 6; `outboxBootVerdict`
  over its three states.
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run** these suites, `test/sim/mutation-floors.test.ts`,
  `test/rings/*.test.ts`, `test/single-definition/time-ports.test.ts`, both `tsc` runs and pwa's. Green. Register the
  floors.
- [ ] **Step 5: Mutation.** Let `pushDue` answer `now` for a non-blocking item: red. Let `outboxNextState` read
  `no-answer` as `retrying`: the never-twice case goes red. Let `outboxBootVerdict` answer `send` for `sending`: red.
  Drop the horizon check: red. Revert each.
- [ ] **Step 6: Commit.** `feat(notice): the push outbox's states, moves and deciders, with pushDue total (H18)`

### Task 3: The table, the reach stamps and the per-send verdict (L3)

**Files:**
- Modify: `server/src/coord/schema.ts` (one migration, at the slot measured at build time)
- Create: `server/src/coord/pushOutboxStore.ts` (L3, C6)
- Modify: `server/src/coord/store.ts` (one-line delegates)
- Modify: `server/src/push.ts` (`notify` answers `PushSendVerdict`)
- Modify: `server/test/single-definition/writers-map.test.ts` (`TABLES` gains `push_outbox`, and the reach stamp's writer)
- Test: `server/test/push-outbox-store.test.ts` (new), `server/test/push-verdict.test.ts` (new), `server/test/coord-db.test.ts`

**Schema:**

```sql
CREATE TABLE push_outbox (
  id             INTEGER PRIMARY KEY,
  pushId         TEXT NOT NULL UNIQUE,     -- entropy.hex(16): no restore can make one repeat
  sourceKind     TEXT,                     -- 'ask' | 'item' | NULL for an unbound push
  sourceId       INTEGER,
  payload        TEXT NOT NULL,            -- the masked PushPayload, as JSON
  tag            TEXT NOT NULL,
  state          TEXT NOT NULL,
  createdAt      INTEGER NOT NULL,
  claimedAt      INTEGER,
  attempts       INTEGER NOT NULL DEFAULT 0,
  nextAttemptAt  INTEGER,
  pushedAt       INTEGER,                  -- written by markOutboxVerdict alone, at the first accepted send
  verdict        TEXT,                     -- the last PushSendVerdict, as JSON
  silentWhy      TEXT,
  CHECK ((sourceKind IS NULL) = (sourceId IS NULL))
);
CREATE UNIQUE INDEX push_outbox_one_per_source ON push_outbox(sourceKind, sourceId) WHERE sourceKind IS NOT NULL;
CREATE INDEX push_outbox_due ON push_outbox(state, nextAttemptAt);
ALTER TABLE asks ADD COLUMN reachedOperatorAt INTEGER;
ALTER TABLE operator_items ADD COLUMN reachedOperatorAt INTEGER;
```

**Interfaces** (each move checks `outboxMoveAllowed` and is a compare-and-set on the `from` state):
- `insertBoundRowInTx(db, row: { source: OutboxSource; sourceId: number; pushId: string; payload: PushPayload; state: 'pending' | 'silent'; silentWhy: string | null; at: number }): number`, which opens no transaction, so it runs inside the caller's `tx`, and calls `stampReach` in the same statement group;
- `stampReach(db, source, id, at): { changed: boolean }`, the one writer of `reachedOperatorAt`: `WHERE reachedOperatorAt IS NULL`, so a row is stamped at most once;
- `insertUnboundRow(db, row): { ok: true; id } | { ok: false; detail }`, its own `tx`, written straight to `sending` (claimed at its insert);
- `claimOutboxRow(db, id, at): { changed: boolean }` (`pending` or `retrying` to `sending`, `attempts + 1`, `claimedAt`);
- `markOutboxVerdict(db, id, to, verdict, at, nextAttemptAt): { changed: boolean }` (from `sending` only; writes `pushedAt` only on the first `sent`);
- `rearmOutboxRow(db, source, sourceId, at): { changed: boolean }` (`level-raised`, from a terminal state only);
- `dueOutboxRows(db, now): OutboxRead` (`pending`, and `retrying` past `nextAttemptAt`, oldest first);
- `openOutboxRows(db): OutboxRead` (every non-terminal row, for the boot pass);
- `sealUnknown(db, id, at): { changed: boolean }` (the boot pass's `sending` to `unknown`);
- `heldItemsReached(db, now): ItemsRead` (open items with `heldUntil <= now` and no reach stamp);
- `purgeOutbox(db, before): { removed: number }` (terminal unbound rows older than `OUTBOX_KEEP_MS`; a bound row stays while its source row exists).

`OutboxRead` is `{ ok: true; rows } | { ok: false; detail }`, never an empty list for a failed read.

**The verdict.** `PushService.notify(payload): Promise<PushSendVerdict>`. No subscription answers `no-subscription`. Each
subscription answers `accepted` on a resolved send, `gone` on 404 or 410 (pruned, as today), `refused` on any other
`WebPushError` with its status, and `no-answer` on any other error. `endpointHash` is the hex SHA-256 of the endpoint,
so no endpoint is stored. It still never throws.

- [ ] **Step 1: Failing tests:** insert a bound row in a `tx` that then throws: neither the row nor the stamp lands; a
  second bound row for the same source is refused by the unique index; `stampReach` changes once and answers
  `changed: false` the second time; `claimOutboxRow` on a `sending` or terminal row changes nothing; `markOutboxVerdict`
  from a state other than `sending` changes nothing, and writes `pushedAt` only on `sent`; a second `sent` after a
  re-arm leaves `pushedAt` at the first; `rearmOutboxRow` on a `sending` row changes nothing; `dueOutboxRows` leaves out
  a `retrying` row before its time; `purgeOutbox` keeps bound rows; the migration's slot found by `findIndex`; the
  `CHECK` refuses a kind without an id. `PushService.notify` with no subscription, one accepted, a 404 (pruned), a 429,
  a network error, and three subscriptions mixed.
- [ ] **Step 2: Run.** Red. **Step 3: Implement** in `continuityStore.ts`'s prepared-statement shape. **Step 4: Run**
  these suites, `test/coord-db.test.ts`, `test/single-definition/writers-map.test.ts`, `test/push-masker-pin.test.ts`,
  `test/notify-push.test.ts`, `test/secret-mask.test.ts`, both `tsc` runs. Green. `notice.ts` still ignores the answer,
  so no caller changes.
- [ ] **Step 5: Mutation.** Drop `WHERE reachedOperatorAt IS NULL`: the stamped-twice case goes red. Drop the unique
  index: red. Let `notify` read a network error as `refused`: red. Revert each.
- [ ] **Step 6: Commit.** `feat(coord): push_outbox, the reach stamps on asks and items, and PushService's per-send verdict (H18, C67)`

**PR A ends here.**

### Task 4: The one sender, and the funnel behind it (L4)

**Files:**
- Create: `server/src/pushSender.ts` (L4, C6)
- Modify: `server/src/notice.ts` (`sendPush` hands the payload to the sender; `NoticeDeps.push` becomes the sender's port)
- Modify: `server/src/laneSchedule.ts` (the `pushOutbox` row, 30 s, `flight: 'skip'`)
- Modify: `server/src/watch.ts` (the lane's one call), `server/src/index.ts` (construct the sender; run its boot pass)
- Modify: `server/test/notify-push.test.ts` (`callers()` becomes `{ 'pushSender.ts': 1 }`), `server/test/pushSeam.ts`,
  `server/test/lane-schedule.test.ts`, and the tests that double `NoticeDeps.push` (their double only)
- Test: `server/test/push-sender.test.ts` (new)

**Interfaces:**

```ts
/** The port the funnel declares (L2, in notice.ts). */
export interface PushSenderPort {
  /** An unbound push: insert it claimed, send it now. With no store, or an insert that throws, send it with no row. */
  send(payload: PushPayload): void;
  /** A bound row its raising transaction wrote `pending`: claim it and send it now. */
  sendRow(id: number): void;
}
export function createPushSender(deps: { push: Pick<PushService, 'notify'> | undefined; coord: OutboxStorePort | undefined;
  time: TimePorts; masker: PayloadMasker }): PushSenderPort & { drain(now: number): Promise<void>; boot(now: number): void };
```

- **Send.** `send` mints the push id, masks the payload, inserts the row at `sending` and calls `notify` in the same
  synchronous step. `sendRow` claims, then calls `notify` in the same step. Each attempt races `OUTBOX_SEND_DEADLINE_MS`
  through the `Scheduler`, and its verdict (or `null`) goes through `outboxNextState` to `markOutboxVerdict`. Nothing is
  awaited by the caller, as today. A failed insert or claim logs once per cause (`ccrc-server: push outbox: …`) and,
  for `send`, sends the payload with no row.
- **Drain.** The lane row's pass: `dueOutboxRows`, and each row is claimed and sent as above. It also stamps held items
  that have reached the operator (Task 5) and runs `purgeOutbox`.
- **Boot.** `index.ts` calls `boot` once, before the server listens and before the watcher starts, so every `sending`
  row it finds belongs to a process that has died. `outboxBootVerdict` answers `seal-unknown` for those and `send` for
  `pending` and `retrying`, which the first drain then sends. A failed read logs and sends nothing at boot. The next
  drain reads again.
- **The funnel.** `raise` asks `pushDue` with `{ event: 'reach', source: 'none', blocking: true, viewing }` from the
  presence gate it already reads, and calls `send` on `now`. `notifyPushOnly` calls `send` with no gate, as today. The
  ring record, the archive and their order are unchanged.

- [ ] **Step 1: Failing tests:** a push with a store writes one row at `sending`, then `sent` with `pushedAt` and its
  verdict; with no subscription, `unsent`; three refusals then an accept, through drains at the backoff times; a refusal
  past the horizon ends `failed`; a send that never answers ends `unknown` at the deadline and is never claimed again;
  with no store, and with an insert that throws, the push is still sent once, with no row; `boot` on a store holding one
  row of each non-terminal state seals the `sending` one, and the next drain sends the other two once each; a second
  `boot` (a second restart) sends nothing. Task 1's suite with its seam moved to the sender: unchanged, green.
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run** these suites, Task 1's, every test in "What exists
  today"'s list, `test/lane-schedule.test.ts`, the watcher-quiet census, both `tsc` runs. Green.
- [ ] **Step 5: Mutation.** Let `boot` send `sending` rows: the second-restart case goes red. Let `send` skip the push
  when the insert throws: red. Move the claim after the `notify` call: the never-twice case goes red. Revert each.
- [ ] **Step 6: Commit.** `feat(notice): one sender drains the push outbox, with retries and a boot pass that never sends a claimed row again (H18)`

### Task 5: The raising transactions: asks and items

**Files:**
- Modify: `server/src/coord/store.ts` (`insertAsk`'s released mint, `releaseAsk` and `declineAsk` take the outbox row)
- Modify: `server/src/coord/questions.ts` (`hold`, `lapseAsks` and the release door pass the payload and push id in)
- Modify: `server/src/coord/ledgersStore.ts` (`raiseItemInTx`, `setBlocking`), `server/src/coord/ledgersRoutes.ts#pushBlocking`
- Modify: `server/src/watch.ts` (`pushRaised`'s `released` arm hands the row's id to the funnel)
- Test: `server/test/push-outbox-asks.test.ts`, `server/test/push-outbox-items.test.ts` (new)

**Asks.** The three moves that make an ask reach the operator take an optional outbox row: the mint at `released`
(`insertAsk` with a `releaseReason`), the lapse (`releaseAsk`) and the parent's release (`declineAsk`). Each writes the
row, `stampReach` and its own move in one `tx`, so `releaseAsk` and `declineAsk` gain the transaction they lack. The
payload is the hold's `ev`, read before the move. A beaten compare-and-set writes no row, and its push, if
`decideAskLapse` still answers `push-and-drop`, stays an unbound funnel push, as today (Task 1 pins it). The row's
state is `pushDue`'s answer, asked before the `tx` with `viewing` from the funnel's presence gate, which the questions
owner receives beside its push sink: `pending` on `now`, `silent` with its `why` otherwise. After the commit, the funnel
records the notice as today and calls `sendRow` for a `pending` row. `answeredLate`, `approvalRuled`, `approvalReleased`, every
approval push and a top-level session's dialog push stay unbound.

**Items.** `raiseItemInTx` writes the row's reach stamp and its one outbox row when `heldUntil` is null: `pending` when
blocking, `silent`, `level` otherwise. `pushBlocking` becomes the funnel call with that row's id. `setBlocking(true)`
that moved the level re-arms the row in its own `tx` (`level-raised`), then the funnel sends it. A held item gets its
stamp and its `silent` row from the drain, through `heldItemsReached`, in one `tx` per item.

- [ ] **Step 1: Failing tests:** a lapse that wins writes the ask's stamp, its row and its `released` state together,
  and a throw inside the `tx` lands none; a beaten lapse writes no row; a second lapse attempt on a released ask writes
  nothing; the stamp equals `releasedAt` on all three moves (open question 6); a viewed session's ask gets a `silent`
  row and no push; a blocking raise writes `pending` and pushes once; a `soon` raise writes `silent` and pushes nothing;
  a toggle to blocking re-arms and pushes once with the same push id and tag; a toggle while the row is `sending` adds
  nothing; an end-request item gets no stamp before `heldUntil`, and exactly one `silent` row after it while open, and
  none when it closed first. Task 1's suite: unchanged, green.
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run** these suites, Task 1's, `ledgers-coordinator-routes`,
  the ask and approval suites, both `tsc` runs. Green.
- [ ] **Step 5: Mutation.** Write the outbox row after the `tx` instead of inside it: the throw case goes red. Let a
  beaten lapse write a row: red. Let `heldItemsReached` read an item closed before `heldUntil`: red. Revert each.
- [ ] **Step 6: Commit.** `feat(coord): an ask or an item reaches the operator with its stamp and its one outbox row, in one transaction (I2)`

### Task 6: The word, and the record of what changed

**Files:**
- Modify: `shared/api.ts` (`ServerCap` and `SERVER_CAP_MAP` gain `push-outbox-v1`, beside its type)
- Modify: `server/test/health.test.ts`, `server/test/ccrc-api.test.ts` only if their counts are literal
- Modify: `README.md` (the notifications paragraph: pushes are recorded, retried and sent at boot)
- Create: `docs/superpowers/plans/2026-11-14-overlord-w1/w1-push-outbox/departures.md`

The word promises: every push the server sends has an outbox row or is logged as unwritable; an ask or an item that
reached the operator carries `reachedOperatorAt` and one outbox row written in the same transaction; a claimed row is
never sent again.

- [ ] **Step 1:** Add the word and its comment. **Step 2: Run** `test/health.test.ts`, `test/ccrc-api.test.ts`,
  `test/claimant-client-pin.test.ts`, both `tsc` runs and pwa's. Green.
- [ ] **Step 3:** Before the push, read the mail lane and `notice.ts` at the oldest version a box can roll back to
  (`ccrc versions` lists them, `git show <tag>:server/src/notice.ts`) and record in the departures note that an older
  build ignores `push_outbox` and the two columns, as Table 11.5's "ignored" class.
- [ ] **Step 4: Commit.** `feat(api): advertise push-outbox-v1 (H18)`

## Rollback below `push-outbox-v1`

An older server reads the newer database: the higher `user_version` is readable, and it never reads `push_outbox` or
`reachedOperatorAt`. Its pushes are today's. What a rollback loses is the rows still unsent at the moment it stops
this build, which is the same set a crash loses today. No hold exists in W1, so no row waits on a push that an older
build would drop. The refusal of §11.5 ships with the hold tier (open question 5). After a roll forward, the boot pass
sends the rows that were `pending` or `retrying` when this build last stopped. They are as old as the downtime, and
the plan accepts that: each is a push the operator would have had.

## Deviations found

None yet. **Spec departures**, for the spec's next correction:

- **verdict-ships-with-the-outbox** — the per-send verdict is this piece's, not responses PR A's (open question 2).
- **a-claimed-row-is-never-sent-again** — the boot pass sends rows no attempt claimed and seals a claimed row
  `unknown`, so "sends every unsent row again at boot" reads "every row no attempt claimed" (open question 3).
- **item-held-until-is-a-hold** — items already have a hold, `heldUntil`; the drain stamps their reach when it passes
  (open question 4).
- **rollback-refusal-ships-with-holds** — W1 advertises `push-outbox-v1` and refuses no rollback (open question 5).

Decisions this plan takes, by slug:

- **every-push-rides-the-outbox** — open question 1.
- **bound-rows-are-asks-and-items** — open question 7.
- **reach-stamp-beside-released-at** — open question 6.
- **pushed-at-on-the-outbox-row** — `pushedAt` is a column of the outbox row, read through the source, so the one fact
  has one place and one writer.
- **unbound-push-claimed-at-insert** — an unbound row is written straight to `sending`, so a crash right after it is
  `unknown` at boot, as today's lost push.
- **no-answer-is-never-retried** — a network error may hide an accepted push, so it reads `unknown`, never `retrying`.
- **retry-horizon-is-the-ttl** — refused rows retry for the push's own ten-minute lifetime, then `failed`.
- **rearm-skips-a-send-in-flight** — a level raised while the row is `sending` adds no second send.
- **payload-masked-at-rest** — the stored payload is masked before the insert.
- **boot-before-listen** — the boot pass runs before the server listens and the watcher starts, so it needs no process
  id to tell a dead attempt from a live one.
- **two-prs** — the index's one pull request becomes two (The PR split).

## Where things stand

**Needs before it starts:** nothing beyond `main`. PR B needs PR A.

**What depends on it:** responses PR A (the push id, the verdict and the claim step); W3's holds, the repeat push and the
attention budget (`pushDue` gains `deferred`); the readiness piece's "a dead Overlord's one push", which is an unbound
push through the same sender.

**What a merge arms:** nothing the operator sees changes, apart from three named effects: a push the service refused is
retried for ten minutes, a push unsent when the server stopped is sent at its next boot, and a blocking toggle during a
send in flight adds no second push. No Shadow lanes row is added.

**What the index should change:** the row reads "2 PRs, 6 tasks"; "`PushService`'s per-send verdict" moves from
responses PR A to this row; lane E's file list adds `server/src/pushSender.ts`, `server/src/pushOutbox.ts`,
`server/src/coord/pushOutboxStore.ts`, `shared/push-outbox.ts`, `server/src/coord/ledgersStore.ts`'s `raiseItemInTx` and
`setBlocking`, and the architecture spec's C6 row; and the piece plans live in
`docs/superpowers/plans/2026-11-14-overlord-w1/`, as the brief says, not beside the W1a plans.

**Later:** binding the other durable once-only marks (open question 7) to their outbox rows, one site per change: the
stall observation row first, then the drift stamp, the release mark, the digest claim, the review-cap ask and the park
escalation.

**Open questions for the coordinator:** the seven at the top, each with its recommendation.
