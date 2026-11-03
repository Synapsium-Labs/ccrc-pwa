# A parked mail comes back with its recipient, and `unreadMail` counts it once (task note)

Task P1e of `2026-10-20-mail-and-run-truth-draft-never-blocks-rejected-m.md` (D-5914; spec
`2026-10-20-mail-and-run-truth-draft-never-blocks-rejected-m-design.md` §3), for #125. This note records Step 0's
measurements, the departures from the task text and the mutation table as run. The plan's own §Deviations is not edited
here; the one new number this task needed is defined below.

## What it does

- `server/src/coord/mailRevive.ts` (new, L1): the vocabulary of which parks come back (`REVIVABLE_PARK_ERRORS`:
  `recipient session is <lc>` for every `DEAD_LIFECYCLES` word, plus the two legacy live-recipient parks
  `draft-present` and `enter-ignored`), the subject heads never revived (`REVIVE_SKIPPED_SUBJECT_HEADS`: the stall
  lane's five notice prefixes and the server's own `mail parked:` / `mail rejected:` heads), and `revivable(row,
  reading)`, which is `listed && registryPresent && !lifecycleIsDead(sessionLifecycle(row))`.
- `server/src/coord/schema.ts`: migration 40 adds `mail_deliveries.revivedFrom INTEGER` (nullable) and the partial index
  `mail_deliveries_by_revived` (heirs only), which serves the heir lookup.
- `server/src/coord/store.ts`: one `HAS_HEIR_SQL` fragment; `ABANDONED_PARK_SQL` gains `AND NOT HAS_HEIR_SQL`;
  `reviveParkedDeliveries(liveIds)` composes `ABANDONED_PARK_SQL` (so the open-run clause and the no-heir clause are the
  read's own spelling) and adds the `undeliverable` code, the revivable `lastError` set, the current-wave bound
  (`m.at >= rr.dispatchedAt`), the kind bound and the role bound; it shares the heir loop body with
  `requeueAbandonedMail` through one extracted private helper, `queueHeir`. `queueDelivery` takes an optional
  `revivedFrom`, written at INSERT only.
- `server/src/watch.ts`: the mail pass's first act after its kill switch reads the tick's registry model, asks
  `revivable` of each row (with the input the session-dead rung builds, `lifecycleInputFor(rec, false, now)`), calls
  the revive, and tells each sender once (push tag `mail-revived-<parent id>`).
- `shared/api.ts`: `RunSummary.items` says it counts the work items the coordinator acked; `unreadMail` says a revived
  park counts once, as its heir.

## Deviations found

- **D-7901 (2026-11-03)** — revive-lifecycle-parks, as built: a role-addressed park comes back only to the role holder,
  and the revive reads the recipient the way the park arm does. Four departures from Task P1e's text:
  - **The role bound (new).** A mail addressed to the `coordinator` role is revived only when its delivery's recipient
    is still the run's `claimedBy`; one addressed to the `worker` role only when it is still the run's `sessionId`. A
    displaced chair or a rebound worker that comes back is not the role any more: `reclaimProgram` and `bindSession`
    already handed the role's mail to its successor (`repointCoordinatorMail`, `requeueAbandonedMail`), and a revive
    to the corpse would deliver the same message to two sessions. Mail addressed to a literal session id is unaffected.
    Pinned by "a role-addressed park comes back only to the session that still holds the role".
  - **`revivable(row, reading)`'s `row` is the recipient's registry row** (as a `LifecycleInput`), and `reading` is
    `{listed, registryPresent}`. The park's own facts (its `lastError`, subject, run and wave) are relational and are
    bounded in the store's SQL, from the L1 vocabulary above, so no bound is spelled twice.
  - **The pane is read as the park arm reads it: not alive** (`lifecycleInputFor(rec, false, now)`). That makes the
    park and the revive exact complements on the same facts: a supervised recipient whose heartbeat is fresh reads
    `restarting` (live) and is revived; an unheartbeated one reads `orphan` (dead) and waits. The cost, recorded as a
    known limit: a recipient running unsupervised (a live pane with no supervisor heartbeat) is not revived until it is
    supervised again, though its heir would deliver. No tmux read is added per sweep.
  - **`reviveParkedDeliveries(liveIds)` takes no `now`**, because the current-wave bound is the run's own
    `dispatchedAt` and nothing else in the select is timed, and it answers `{revived: RevivedDelivery[]}` (each the
    parent id, the heir id, the mail id and the recipient) rather than bare ids, so the sweep tells the sender without
    a second read. It is still typed and never `void`.
- A re-queue's heir (`requeueAbandonedMail`) names no parent: the corpse's park stays visible on the corpse's own
  mailbox exactly as before. Only a revive retires its parent.
- `sessionDeadError` and `parkNoticeSubject` now spell, once, the two strings the revive selects on (in
  `coord/delivery.ts`), so the park's writer and the revive's reader cannot drift.

## Step 0, measured

| Question | Answer |
|---|---|
| Where `sweepMail`'s delivery policy lives | `coord/delivery.ts` (ARCH-19): five deciders; the lifecycle park is `decideSessionDead`, writing `recipient session is <lc>` at `MAIL_MAX_ATTEMPTS` on a never-delivered row. The rung that calls it (`lifecycleIsDead(sessionLifecycle(lifecycleInputFor(rec, false, now)))`) is in `watch.ts`'s due loop |
| #853's park and ceiling (the plan's "#821") | a live recipient's park is now `queued` (`parkDelivery`); at 24 h parked it is rejected with `parked 24 h, never delivered: <reason>` (`parkExpiredError`). That reject is never revived |
| Legacy parks | before #853, a send refusal at the ceiling was rejected with the refusal word itself as `lastError` (`draft-present`, `enter-ignored`), measured at `9ff90740d^` |
| The migration slot | `git show origin/main:server/src/coord/schema.ts \| grep -c '^  // ── [0-9]*: user_version'` printed 37 at `31cdb4646`, so this was entry 38; two PRs took 38 and 39 first, and it printed 39 at `82e1bd180`, so this is entry 40 |
| `ABANDONED_PARK_SQL`'s readers | `git grep -n ABANDONED_PARK_SQL server/src`: `OUTSTANDING_OR_ABANDONED_SQL` (and through it `unreadMailCount`, `runHealth`, `outstandingMailFor`, `inboxFor`, `abandonedCount`, `mailForProgram`) and `requeueAbandonedMail`; this task adds `reviveParkedDeliveries`. One case each in `mail-revive.test.ts`: the `unreadMail` case, the MailStrip case, the inbox and programme case, and the two coordinator re-queue and repoint cases |

## Mutation table, run

Each row was applied to the source, its suite run, and the source restored.

| Mutant | Suite | Red |
|---|---|---|
| `NOT HAS_HEIR_SQL` dropped from `ABANDONED_PARK_SQL` | mail-revive | "`unreadMail`: 1 before, 1 after the revive (the heir), 0 after the heir's ack", the MailStrip and inbox cases |
| the dedupe dropped (the same fragment, which the revive composes) | mail-revive | "two sweeps revive once" |
| the heir clause keyed on `mailId`/`toId` instead of `revivedFrom` | mail-revive | "a revived heir repointed to a new coordinator: the parent stays retired" |
| the open-run filter dropped | mail-revive | "a closed run's park is never revived" |
| the current-wave bound dropped | mail-revive | "a park created before the run's dispatchedAt is never revived" |
| the kind bound dropped | mail-revive | "a stall nudge and a server system notice are never revived" |
| the role bound dropped (D-7901) | mail-revive | "a role-addressed park comes back only to the session that still holds the role" |
| the revive using its own lifecycle test | mail-revive | "the revive calls lifecycleIsDead, and server/src defines no other lifecycle-dead predicate" |
| an `UPDATE` of the parked row added | mail-hardening | "ONE statement writes a delivery row, in the one writer", and the new "the revive writes no delivery row but its heir" |
