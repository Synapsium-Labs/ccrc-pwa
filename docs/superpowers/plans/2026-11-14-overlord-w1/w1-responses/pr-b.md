# The response record, PR B: departures found while building

Plan: `docs/superpowers/plans/2026-11-14-overlord-w1/w1-responses.md`, Tasks 5 to 9 (PR B: the seal, the other messages and
the controls). Each departure is named by a plain-words slug; none carries a D-number. The coordinator folds them into the
plan's deviation ledger.

## Departures

- **migration-written-at-its-position**. The brief asked for migration 84 positionally, behind portfolio B's 83. On this
  branch `main` has 82 entries and portfolio B has not landed, so `response_settings` is entry 83, at its position; it is
  renumbered at the landing on the coordinator's word, as PR A's was.
- **owner-facts-in-the-lane**. The plan puts `ownerFactsOf` in `responsesStore.ts`. The owners' reads it must go through
  (`askById`, `askForCorrection`, `approvalById`, `callById`, `itemHistory`, `itemById`) are `CoordStore` methods, not
  module functions a store module can call with the handle, so `ownerFactsOf` is in `server/src/responses/lane.ts` (L4),
  which gathers through the watcher's port. It reads, decides nothing, and answers `{ ok: false }` on any throw, refusal
  or unknown word.
- **lane-on-the-watcher-port**. The lane takes `WatcherCoordPort`, never a port of its own (the ruling of 2026-10-30: one
  port, one member list); the port gains the lane's eleven members in their sorted places.
- **a-gone-owner-seals-reader**. Rule 2 lets a `gone` owner read `settled-elsewhere` "only when the row's own record says
  it closed". No W1 row records that, so a `gone` owner always seals `unmeasured`, `reader`.
- **settle-time-from-the-owners-moves**. "When it settles", in `responseWindowEnd`: an item at its earliest settling move
  (every item act but `return`, which reopens it) at or after the window's start; an ask at its `answeredAt` when
  answered, by anyone. An ask that went `stale` or `unknown` records no time, so its window ends at its cap.
- **push-window-starts-at-delivery**. A push's acts and receipts are counted from its delivery (its insert while
  pending). An operator act between the insert and the delivery settled the row before the push reached anyone, so it
  reads `settled-elsewhere`, not `acted`.
- **elsewhere-figure-counts-handled-rows**. `responsesFor`'s `elsewhere` counts the rows the operator marked "I handled
  this elsewhere" (C69); a `settled-elsewhere` seal counts in no figure and stays out of `measured`, with
  `not-actionable` and `unmeasured` rows whose why is `reader`, `ask-ended` or `no-verdict` ("delivered rows with a
  verdict").
- **median-from-sealed-acts**. `medianActMs` reads the seal's `actedAt`; a handled row the seal did not call `acted` has
  no act time and is not in the median.
- **responses-for-has-no-store-reader**. `responsesFor` ships total and tested with no reader in W1 (question 13); no
  store read of its rows ships either, so nothing is dead code. W3 adds the read with its route.
- **digest-window-is-one-window-on**. A digest line's window ends at the next digest: this digest's end plus one window
  length (`2 * toMs - fromMs`), whenever the beat ran.
- **claim-digest-day-in-one-tx**. `claimDigestDay` now runs in one transaction with or without its callback; a throw from
  the callback is logged once per cause and the claim stands.
- **retention-feed-row-through-notice**. The retention door records a change as a record-only feed row through the
  server's `notice` sink, naming the actor (`deviceActor` when armed, `flag-off` dark), passed on the one registration
  line beside the account gate; `server.ts` keeps its one line.
- **retention-out-of-bounds-reads-unreadable**. A stored retention outside `[14, 3650]`, a missing row or a failed read is
  unreadable: the lane deletes nothing that pass and the door asks the step-up for any change.
- **waiting-row-write-logged-once-per-cause**. A Waiting on you row or a digest line whose insert throws is caught inside
  the move it rides and logged once per cause (`responsesStore.ts#warnResponseWriteOnce`), so the move commits.
- **wire-types-in-shared**. The read's row (`ResponseRowBrief`) and the retention answer (`ResponseRetentionView`) are
  declared in `shared/responses.ts` and named by the server and the console alike.
- **i18-predicate-left-for-sequence-b**. Sequence and monitor B has not merged (`server/src/coord/invariants.ts` is not on
  `main`), so I18's predicate and its gatherer row are left for sequence B, as that plan says (question 15).
- **doors-outside-the-box-token-census**. The brief asked for the doors' census rows. The plan's Task 8 puts the handled,
  read and retention doors where PR A put the receipts door: session-gated, not EXEMPT, no box token, so outside
  `box-token-census.test.ts` and `CLAUDE.md`'s box-token paragraph. Their rows are in `auth-gate.test.ts`
  (`responses/routes.ts` reads 5, the totals) and `auth/gate.ts`'s count, and `secret-mask.test.ts`'s `EXEMPT` reasons for
  the two `GET`s. No refusal word is new, so Table 11.6 is untouched.

The console (Task 9):

- **responsesfor-takes-a-string**. `api.responsesFor` takes the query's `ref` string; `responseWords.ts#refParam` builds
  `item:<id>` or `digest:<key>` from a typed ref.
- **opened-per-ref-set**. `useOpenedReceipt` keeps the refs it has posted for the mount, so a re-render posts nothing and
  moving to another day's digest posts only that day's lines, once.
- **digest-body-split-at-50**. The digest page posts its decision lines in bodies of at most `RECEIPTS_MAX_PER_BODY`.
- **control-off-on-saved-copy**. The item page shows "I handled this elsewhere" only on a current item, never on a saved
  copy.
- **handled-refusal-sentence**. A refused mark rolls back to the button and shows one line, "Could not mark this. Try
  again.", beside it.

## Measured

- Growth (`server/test/growthCheck.ts#netGrowth`, against the merge base with `origin/main`): `server/src/coord/schema.ts`
  +5 (the plan's measured +5), `server/src/coord/store.ts` +16 (the plan's estimate about +14: eleven delegates, the
  stamp on `reachHeldItem`, and `claimDigestDay`'s transaction and callback), `server/src/watch.ts` +10,
  `server/src/server.ts` 0 (the registration line gains the gate, the notice sink and the actor), `pwa/src/lib/api.ts` +6.
  `growth-check.test.ts` armed: green.
- Mutation floors (the in-tree runner, `server/test/sim/mutate.ts`): `responseOutcome` 1 (32 of 32), `responseWindowEnd`
  1 (9 of 9), `responseSealDue` 1 (7 of 7), `responsesFor` 1 (13 of 13), `retentionChangeGate` 1 (4 of 4). One
  equivalent mutant (a digest line's window ends at its cap whatever its owner) was removed with the redundant line.
- Hand mutations, each red then restored from a saved copy: Task 6's three (a row on every reach call, which needed the
  case of an item reached with no stamp source and armed later, since the unique index also holds a repeat; `armInTx`'s
  insert dropped; the digest rows written on a lost claim); Task 7's three (`sealedAt IS NULL` dropped, which needed a
  direct store case, since the lane never re-reads a sealed row; an unreadable setting falling back to the default; the
  deleter in two transactions); Task 8's three (the handled door writing `outcome`, the bounds dropped, the gate compared
  the wrong way).
- The auth gate's counts move past responses A's: 249 routes, 246 HTTP, 151 gated, and `gate.ts`'s docstring names 246.
  Portfolio B lands first at 246 / 243, so the landing merge adds its one route to each.
