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
- **characterization-strips-the-push-id**. The characterization rigs now carry the stamp (a local `installPush` that adds
  `responseStamp`, so `pushSeam.ts` and the other suites that install it are unchanged). `strict` asserts each payload's
  `pushId`, where present, is 32 lowercase hex, and compares the rest unchanged; whether a push has a row is asserted per
  case in `responses-sender.test.ts` (row and id together, no row and no id together).
- **adoption-sink-pinned-by-scan**. The plan asks for a test that drives the delegation adoption sink through the
  watcher's own path. That path needs the whole delegation lane (a durable journal, a census, a registry listing) to
  reach `notice`. The sink's one field is pinned instead by a scan of `server/src` for hand-built funnel deps literals
  that carry `push:` (`responses-sender.test.ts`), which reds when the field is dropped (measured), and the funnel case
  beside it proves a notice through those deps writes its row.
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
- **receipt-drop-words-in-l0**. The receipts door's drop words (`receiptVerdict`'s five, and `repeat`) cross the wire as
  the answer's `dropped` keys, so they are declared once in `shared/responses.ts` (`RECEIPT_DROPS`, `isReceiptDrop`), and
  `mail-routes.test.ts`'s kebab census admits them through that guard. The push row's delivery word is the typed
  constant `PUSH_RESPONSE_DELIVERY`, bound as a parameter, not a literal in the store's SQL.

## Measured

- Growth (`server/test/growthCheck.ts#netGrowth`, against the merge base with `origin/main`): `server/src/coord/schema.ts`
  +24 (the plan's measured +24), `server/src/coord/store.ts` +4, `server/src/server.ts` +2, `server/src/watch.ts` 0 (one
  field on an existing line), `pwa/src/lib/api.ts` 0. `growth-check.test.ts` armed: green.
- Migration: 81, the coordinator's word at the landing merge: the renewal act (#2852) took 79 and answer marks A (#2879)
  took 80. The auth gate's counts move past answer marks A's: 245 routes, 242 HTTP, 147 gated, and `gate.ts`'s docstring
  names 242.
- Hand mutations: Task 1, rule 5's `delivered` test dropped and a console `shown` let through, each red; rules 1 and 2
  swapped, no change. Task 2, all five of the plan's and the three partial indexes folded into one, each red. Task 3,
  all five of the plan's, each red. Task 4, the receipt awaited before `openApp` and the push id dropped from
  `replace()`, each red; the door skipping `receiptVerdict`, red.
