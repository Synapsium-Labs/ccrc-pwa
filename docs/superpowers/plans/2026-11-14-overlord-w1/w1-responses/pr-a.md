# The response record, PR A: departures found while building

Plan: `docs/superpowers/plans/2026-11-14-overlord-w1/w1-responses.md`, Tasks 1 to 4 (PR A, the record of each push). Each
departure is named by a plain-words slug; none carries a D-number. The coordinator folds them into the plan's deviation
ledger. The brief named this note `w1-responses-a.md`; the plan's Global Constraints name
`w1-responses/<pr>.md`, and the plan governs (worker clause 6), so it is here.

## Departures

- **push-window-ships-with-the-landing**. The plan puts `PUSH_WINDOW_MS` in PR B (Task 5), but Task 2's landing sets
  `windowCapAt` 24 hours after the first acceptance, and its test asserts that. The constant is in
  `shared/responses.ts` from PR A; PR B adds the rest of its block beside it.
- **tag-and-actions-from-the-claimed-payload**. The plan types the outbox's response argument as
  `Omit<PushResponseInsert, 'pushId' | 'at'>`, which carries `tag` and `hasActions`. A bound send does not hold its payload
  before the claim (the claim's `RETURNING` answers it), so the argument is `PushResponseOf` (`label`, `carries`, `stamp`),
  and the store reads `tag` and `hasActions` from the payload being sent, inside the same transaction.
- **an-unbound-retry-reads-the-row-by-id**. A drain's retry of an unbound row has no label to hand (the outbox row does
  not store the notifier kind). Its claim passes no response argument, and `responseWritten` is then whether a push row
  already stands under that push id (the one the first attempt inserted), so the retry carries the id exactly when the
  row is there and inserts nothing.
- **the-receipts-body-is-one-transaction**. The plan's `insertReceipt` writes "in its own transaction with the read the
  verdict was decided on". The door's write is `receiveReceipts`, one transaction for the whole body: each receipt's row
  read, `receiptVerdict` (handed in by the door, so the store decides nothing), and the kept inserts. A row this build
  cannot read rolls the whole body back, so "a failed read is `unavailable`, with nothing written" holds for every
  receipt of the body. `insertReceipt` stays the one writer the census names.
- **a-repeat-receipt-is-dropped-as-repeat**. A receipt the verdict keeps but the unique index already holds is answered
  in the door's counts as `dropped.repeat`, beside the verdict's own words, so `kept` counts only rows written.
- **response-warnings-name-no-push-id**. A response write that throws is logged once per cause through the sender's
  latch; the detail names the cause and never the push id, so a standing failure logs once, not once per push.
- **characterization-pins-the-push-id-per-site** (retires `characterization-strips-the-push-id`, review 2214 F3). Each
  row of the characterization table carries a `row` flag, and `strict` asserts both ways: `pushId` as 32 lowercase hex on
  a site with a response row, and no `pushId` on one without. The rigs now carry the stamp (a local `installPush` adds
  `responseStamp`, so `pushSeam.ts` and the other suites that install it are unchanged), and the lane rigs of sites 20 and
  24 to 26 gain the clock and stamp `index.ts` gives every sink, so their pushes go through the outbox as in production.
  Measured, the sites with no row are the two `notifyPushOnly` ones (28, 29: no label) and three whose rigs have no
  coordination store (1, 10 and 12, and the project-suffix cases on the same rig), whose push is sent as before the
  record. Flipping site 2 to no-row, or site 28 to row, each goes red. Site 30 (the pool set B2's loss lane, which
  reached this branch at a later merge of main) gains the clock the watcher's deps give it, and is a row site; flipping
  it to no-row goes red.
- **adoption-sink-pinned-by-scan**. The plan asks for a test that drives the delegation adoption sink through the
  watcher's own path. That path needs the whole delegation lane (a durable journal, a census, a registry listing) to
  reach `notice`. The sink's one field is pinned instead by a scan of `server/src` for hand-built funnel deps literals
  that carry `push:` (`responses-sender.test.ts`), which reds when the field is dropped (measured), and the funnel case
  beside it proves a notice through those deps writes its row. Its limit (review 2214 F6): the scan reads one line at a
  time, so a funnel deps literal split across lines, or one whose `push:` comes on a later line, escapes it.
- **pwa-c6-glob-waits-for-pr-b**. Task 1 adds `responses/**` to the C6 row's PWA half, but `rings/totality` refuses a
  glob that matches no file, and PR A adds no console file. PR B adds the PWA half with its first console file.
- **mutation-run-is-python-only**. `mutation-run.py` mutates Python modules. `receiptVerdict`'s floor (1, 15 of 15
  killed) is measured by the in-tree runner (`server/test/sim/mutate.ts`) that `mutation-floors.test.ts` uses for every
  other decider.
- **stray-field-name-not-echoed**. `parseReceiptBody` refuses a field beyond the known ones with a detail that names
  the object, never the field, since the key is the sender's text.
- **digest-kinds-as-typed-map**. `DigestRowKind` is imported by type; `DIGEST_KEY_ROW_KINDS` is a map typed by it, and
  `responses-vocab.test.ts` pins it equal to `shared/api.ts#DIGEST_ROW_KINDS`.
- **path-guard-releases-notice**. `server/test/consolidation-path-guard.test.ts` (D-5855) reds a diff that touches
  `pwa/` beside a file consolidation W1a owned, and its list named `server/src/notice.ts`. This PR edits both (Task 3
  gives a funnel push its label and stamp in `notice.ts`; Task 4's worker is `pwa/public/push-sw.js`). Consolidation W7
  is on `main`, so the guard's window is over, and `notice.ts` is the push funnel other streams edit. On the
  coordinator's ruling the owned list keeps `shared/switches.ts` and the commit check, and drops `notice.ts`; its fixture
  controls moved onto `switches.ts` and pin `notice.ts` beside `pwa/` as green (both mutations measured red).
- **silence-lands-on-the-response-row** (review 2214 F1). The plan names two landers of a push's verdict on its response
  row, `markOutboxVerdict` and `sealAtBoot`. There is a third terminal move: `silenceOutboxRow`, `retrying -> silent`,
  when the source re-read says settled. That row was claimed, so its response row stands `pending`. `silenceOutboxRow`
  now runs in `inTx` and lands `{ accepted: [], terminal: true, answered: true }` through `landResponse`, which removes
  the never-delivered row. A `pending -> silent` row was never claimed and has no response row. `responses-sender.test.ts`
  drives `retrying -> silent`, and goes red without the landing.
- **a-receipt-keeps-its-row** (review 2214 F2, the coordinator's ruling). A row that holds any receipt is never removed:
  a receipt is evidence the push reached a device, so removing it would make the record say the push never existed. The
  removal applies only to a never-delivered, terminal, answered row with no receipt. A row with a receipt takes its
  terminal move unchanged and keeps its receipts. `responses-sender.test.ts` drives the reviewer's sequence (`unknown`, a
  real `shown`, a re-arm, then `failed`, `unsent` or a boot seal), and each ending goes red without the guard.
- **removal-is-one-statement** (review 2214 F5). The ruling asked for a SAVEPOINT around the removal's two DELETEs. Once a
  row holding a receipt is never removed, the receipts DELETE has nothing left to delete, so the removal is one statement
  (`DELETE … WHERE … AND NOT EXISTS (SELECT 1 FROM response_receipts …)`). One statement cannot leave receipts gone with
  the row kept, and nothing deletes a receipt any more, so `writers-map` names only `insertReceipt` for `response_receipts`.
- **unavailable-answers-a-fixed-sentence** (review 2214 F4). The door's `unavailable` answer is one fixed sentence
  (`responses/routes.ts#UNAVAILABLE_DETAIL`). The cause, a row id or a stored word, goes to the server's log only, once:
  the reader logs a failed or unreadable read, and the store logs a failed write.
- **receipt-drop-words-in-l0**. The receipts door's drop words (`receiptVerdict`'s five, and `repeat`) cross the wire as
  the answer's `dropped` keys, so they are declared once in `shared/responses.ts` (`RECEIPT_DROPS`, `isReceiptDrop`), and
  `mail-routes.test.ts`'s kebab census admits them through that guard. The push row's delivery word is the typed
  constant `PUSH_RESPONSE_DELIVERY`, bound as a parameter, not a literal in the store's SQL.

## Measured

- Growth (`server/test/growthCheck.ts#netGrowth`, against the merge base with `origin/main`): `server/src/coord/schema.ts`
  +24 (the plan's measured +24), `server/src/coord/store.ts` +4, `server/src/server.ts` +2, `server/src/watch.ts` 0 (one
  field on an existing line), `pwa/src/lib/api.ts` 0. `growth-check.test.ts` armed: green.
- Migration: 82, the coordinator's word at the landing merge: the renewal act (#2852) took 79, answer marks A (#2879)
  80 and authority journal A (#2895) 81. The auth gate's counts move past answer marks A's: 245 routes, 242 HTTP, 147 gated, and `gate.ts`'s docstring
  names 242.
- Hand mutations: Task 1, rule 5's `delivered` test dropped and a console `shown` let through, each red; rules 1 and 2
  swapped, no change. Task 2, all five of the plan's and the three partial indexes folded into one, each red. Task 3,
  all five of the plan's, each red. Task 4, the receipt awaited before `openApp` and the push id dropped from
  `replace()`, each red; the door skipping `receiptVerdict`, red.
