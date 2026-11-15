# The push outbox, PR A: departures found while building

Plan: `docs/superpowers/plans/2026-11-14-overlord-w1/w1-push-outbox.md`, Tasks 1 to 3 (PR A, the record and its rules).
Each departure is named by a plain-words slug; none carries a D-number. The coordinator folds them into the plan's
deviation ledger.

- **migration-slot-74** — the `push_outbox` migration takes entry 74 (`user_version 73 -> 74`), the next free slot on
  `origin/main` at build time. Another W1 piece that lands first takes it, and this one renumbers on the coordinator's
  word.
- **tag-null-without-payload** — the plan's schema has `tag TEXT NOT NULL`, but the same plan writes a bound row with a
  null payload when there is no push service or no payload (F4). Such a row has no tag to store. `tag` is nullable, and
  NULL means exactly one thing: the row was written with no payload. Every row written with a payload stores its tag.
- **held-items-read-in-the-outbox-store** — Task 3 lists `heldItemsReached` among `pushOutboxStore.ts`'s functions and
  tests it, while Task 5's file list puts it in `ledgersStore.ts`. It is built in `pushOutboxStore.ts` with Task 3, and
  it asks the hold's one rule, `ledgersStore.ts#operatorWasShown`, rather than restating it in SQL. Its rows carry the
  item's id, `heldUntil` and `neededBy`, which is what the held drain needs.
- **claim-answers-a-union** — the plan types `claimOutboxRow` as `{ changed: boolean; claimSeq: number }`. A lost claim
  has no claim number, so it answers `{ changed: false }` with none, and a won claim `{ changed: true; claimSeq }` (no
  overloaded number at a seam). The claim is one `UPDATE … RETURNING claimSeq` statement.
- **held-is-silent-whatever-the-source** — `pushDue`'s rule 5 reads "on `held`, a blocking item is `silent`,
  `older-build`". After rules 1 to 4 only a blocking item or a non-item can reach it, and only items are held, so the
  rule is written as "on `held`, `silent` `older-build`", which keeps the held drain always silent (F9) and stays total.
- **push-due-event-table** — `pushDue` reads its `event` fact through a table total over the four events (whether the
  event is the held drain, and whether it asks presence) instead of comparing `f.event` to a literal. The hook-events
  scan (`single-definition/hook-events.test.ts`) reads any `.event === '<literal>'` as a hook-event comparison, and this
  fact is not a hook event; the table keeps the scan's meaning with no exemption, and W3's `deferred` extends it by a row.
- **pushOutboxStore-holds-the-handle** — `pushOutboxStore.ts` names `node:sqlite` by `import type`, so it joins
  `core-vocab.test.ts`'s coord handle holders beside `ledgersStore.ts` and the other moved stores, a file the plan did
  not list.
- **actor-and-source-maps** — `OutboxActor` and `OutboxSource` each gain a `Record<X, true>` map and a derived list
  (`OUTBOX_ACTORS`, `OUTBOX_SOURCES`), which `rings/wire-totality.test.ts` asks of every exported literal union in
  `shared/`.
- **arm-clears-the-claim-time** — the arm resets `claimedAt`, `silentWhy` and `settledAt` beside the plan's `attempts`
  and `nextAttemptAt`, so a re-armed row reads as a fresh `pending` row. It keeps `pushId`, `claimSeq`, `pushedAt` and
  the last `verdict`.
- **outbox-reads-are-strict** — a stored row whose state, source, verdict or silence word this build does not know, or
  whose payload does not parse, makes the read answer `ok: false` rather than fold into a known row.
- **red-first-by-mutation** — Task 2's and Task 3's modules were written beside their tests rather than strictly after a
  red run. Every case was then shown to bite by mutation: the seven decider sets kill every mutant (registered in
  `mutation-floors.json` at 1), and Task 3's four named mutations each turned their case red (recorded in the PR body).
