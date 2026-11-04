# A parked mail comes back with its recipient, and `unreadMail` counts it once (task note)

Task P1e of `2026-10-20-mail-and-run-truth-draft-never-blocks-rejected-m.md` (D-5914; spec
`2026-10-20-mail-and-run-truth-draft-never-blocks-rejected-m-design.md` §3), for #125. This note records Step 0's
measurements, the departures from the task text and the mutation table as run. The plan's own §Deviations is not edited
here; the one new number this task needed is defined below.

## What it does

- `server/src/coord/mailRevive.ts` (new, L1): the vocabulary of which parks come back (`REVIVABLE_PARK_ERRORS`:
  `recipient session is <lc>` for every `DEAD_LIFECYCLES` word, plus the two legacy live-recipient parks
  `draft-present` and `enter-ignored`), the sender never revived (`REVIVE_SKIPPED_SENDERS`: `operator`, the watcher's
  voice), the subject heads never revived (`REVIVE_SKIPPED_SUBJECT_HEADS`: the done-claim answers, the stall lane's five
  notice prefixes and the server's own `mail parked:` / `mail rejected:` heads), and `revivable(row, reading)`, which
  is `listed && registryPresent && !lifecycleIsDead(sessionLifecycle(row))`.
- `server/src/coord/schema.ts`: migration 40 adds `mail_deliveries.revivedFrom INTEGER` (nullable) and the partial index
  `mail_deliveries_by_revived` (heirs only), which serves the heir lookup.
- `server/src/coord/store.ts`: one `HAS_HEIR_SQL` fragment; `ABANDONED_PARK_SQL` and `runHealth`'s `parked` count each
  gain `AND NOT HAS_HEIR_SQL`; `reviveParkedDeliveries(liveIds)` composes `ABANDONED_PARK_SQL` (so the open-run clause
  and the no-heir clause are the read's own spelling) and adds the `undeliverable` code, the revivable `lastError` set,
  the current-wave bound (`m.at >= rr.dispatchedAt`), the kind bound (sender and subject), the role bound and the copy
  bound, and mints one heir per mail; it shares the heir loop body with `requeueAbandonedMail` through one extracted
  private helper, `queueHeir`. `queueDelivery` takes an optional `revivedFrom`, written at INSERT only.
- `server/src/watch.ts`: the mail pass's first act after its kill switch reads the tick's registry model, asks
  `revivable` of each row (with the input the session-dead rung builds, `lifecycleInputFor(rec, false, now)`), calls
  the revive, and tells each sender once (push tag `mail-revived-<parent id>`).
- `shared/api.ts`: `RunSummary.items` says it counts the work items the coordinator acked; `unreadMail` and
  `RunHealth.mailParked` say a revived park counts once, as its heir.

## Deviations found

- **D-7901 (2026-11-03)** — revive-lifecycle-parks, as built: a role-addressed park comes back only to the role holder,
  and the revive reads the recipient the way the park arm does. Six departures from Task P1e's text:
  - **The role bound (new).** A mail addressed to the `coordinator` role is revived only when its delivery's recipient
    is still the run's `claimedBy`; one addressed to the `worker` role only when it is still the run's `sessionId`. A
    displaced chair or a rebound worker that comes back is not the role any more: `reclaimProgram` and `bindSession`
    already handed the role's mail to its successor (`repointCoordinatorMail`, `requeueAbandonedMail`), and a revive
    to the corpse would deliver the same message to two sessions. Mail addressed to a literal session id is unaffected.
    Pinned by "a role-addressed park comes back only to the session that still holds the role".
  - **The copy bound (new).** The role bound does not cover a chair displaced and then reinstated: it is the role
    again, while its parked mail was re-queued to the successor in between. So a park is revived only while no other
    delivery of its mail is live or acked (every delivery reads `rejected`), and a sweep mints one heir per mail
    (`GROUP BY m.id`, as the re-queue does). Measured before the bound: the reinstated chair held two queued
    deliveries of one mail, or a queued heir of a message its successor had already acked. Any recipient's ack answers,
    because a mail has one addressee. Pinned by the four cases of "one mail, one live copy per role".
  - **The kind bound is on the sender as well as the subject (new).** The task text and the spec's parenthetical name
    subject heads, but every run-bound notice the server writes matches none of them: `checks:…`, `merged:…`,
    `dequeued:…`, `brief not taken by …` and `dispatch-abandoned`. All are `operator` mail, so `operator` is bounded
    whole, and a new notice in that voice is covered with no row. The `coordinator` voice carries the wave brief, which
    must come back, so its only other mail, the six done-claim answers, are named as heads, derived from
    `closeDecide.ts`'s table. `mail parked:` and `mail rejected:` stay in the list because the spec names them, though
    `tellParkedSender` writes them with no run and the select's join already leaves them out. Run-bound `operator` mail
    has no route from a person: the PWA's operator mail (the kickoff, the question nudges, the ledger answers) is
    run-less and never joins. Pinned by the three real-writer cases and the census of the `coordinator` voice.
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
- Known limit, from the same rule: a park the copy bound or the one-heir rule declines gets no heir, so nothing retires
  it. A chair reinstated over a repointed copy holds two rows of one message. Measured, as `[mailParked,
  mailOutstanding, the chair's mailbox]`: `[1, 1, 2]`, then `[1, 0, 1]` after the copy's ack, until the run closes. That
  is what a re-queue has always left (`requeueAbandonedMail`'s walk says so of `runHealth`), and no message is delivered
  twice. Retiring such a park needs a parent link on a re-queue's row, which would change what a corpse's mailbox
  shows, so it is left for #125's follow-up rather than folded in here.
- `sessionDeadError` and `parkNoticeSubject` now spell, once, the two strings the revive selects on (in
  `coord/delivery.ts`), so the park's writer and the revive's reader cannot drift.

## Step 0, measured

| Question | Answer |
|---|---|
| Where `sweepMail`'s delivery policy lives | `coord/delivery.ts` (ARCH-19): five deciders; the lifecycle park is `decideSessionDead`, writing `recipient session is <lc>` at `MAIL_MAX_ATTEMPTS` on a never-delivered row. The rung that calls it (`lifecycleIsDead(sessionLifecycle(lifecycleInputFor(rec, false, now)))`) is in `watch.ts`'s due loop |
| #853's park and ceiling (the plan's "#821") | a live recipient's park is now `queued` (`parkDelivery`); at 24 h parked it is rejected with `parked 24 h, never delivered: <reason>` (`parkExpiredError`). That reject is never revived |
| Legacy parks | before #853, a send refusal at the ceiling was rejected with the refusal word itself as `lastError` (`draft-present`, `enter-ignored`), measured at `9ff90740d^` |
| The migration slot | `git show origin/main:server/src/coord/schema.ts \| grep -c '^  // ── [0-9]*: user_version'` printed 37 at `31cdb4646`, so this was entry 38; two PRs took 38 and 39 first, and it printed 39 at `82e1bd180`, so this is entry 40 |
| `ABANDONED_PARK_SQL`'s readers | `git grep -n ABANDONED_PARK_SQL server/src`: `OUTSTANDING_OR_ABANDONED_SQL` (and through it `unreadMailCount`, `runHealth`'s run-less kickoff query, `outstandingMailFor`, `inboxFor`, `abandonedCount`, `mailForProgram`) and `requeueAbandonedMail`; this task adds `reviveParkedDeliveries`. One case each in `mail-revive.test.ts`: the `unreadMail` case, the MailStrip case, the inbox and programme case, and the two coordinator re-queue and repoint cases |
| Park counts that do not go through it | a walk of every `mail_deliveries` read and every `'rejected'` in `server/src` and `pwa/src`, not a grep of the name: `runHealth`'s statement (1) spells its own `parked` count, because it measures closed runs too, and is the only one. It takes `AND NOT HAS_HEIR_SQL`, with its own three cases. `unlandedBriefs` reads a mail's newest delivery, which is the heir. The ack door's `rejected` arm is the replay-ceiling park, never revived |

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
| the sender bound dropped | mail-revive | "nothing the watcher says for the operator comes back…" and "a checks notice on a run at merging…" |
| the done-claim heads dropped | mail-revive | "a done-claim answer, in the coordinator voice, does not come back…" |
| `STALL_CHECK_PREFIX` dropped from the heads | mail-revive | "a skipped head holds whoever the sender…" |
| the copy bound dropped | mail-revive | all four "one mail, one live copy per role" cases |
| the copy bound narrowed to outstanding copies | mail-revive | "a chair that comes back after the role acked the copy…" |
| the copy bound narrowed to acked copies | mail-revive | "a chair that comes back to a copy repointed to it…", "a copy that is delivered and not acked…" and "two parks of one mail…" |
| one heir per parent, not per mail | mail-revive | "two parks of one mail to one chair revive once…" |
| `AND NOT HAS_HEIR_SQL` dropped from `runHealth`'s `parked` | mail-revive | all three `runHealth.mailParked` cases |
| the role bound dropped (D-7901) | mail-revive | "a role-addressed park comes back only to the session that still holds the role" |
| the revive using its own lifecycle test | mail-revive | "the revive calls lifecycleIsDead, and server/src defines no other lifecycle-dead predicate" |
| an `UPDATE` of the parked row added | mail-hardening | "ONE statement writes a delivery row, in the one writer", and the new "the revive writes no delivery row but its heir" |
