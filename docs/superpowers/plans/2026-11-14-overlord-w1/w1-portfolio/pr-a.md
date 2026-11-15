# Portfolio PR A: build notes

What the build of Tasks 1 to 3 of `w1-portfolio.md` found, for the coordinator to fold into the programme ledger. Each
departure is a slug; the coordinator mints the numbers.

## Measured

- **Migration slot.** The portfolio's migration is entry 75. `main` took 74 for the anchor's seed row while this was built,
  so the branch merged `main` once and took 75 (the coordinator's ruling on ask 436). Two other open W1 pull requests also
  carry 75; whichever lands first keeps it, and each later one renumbers on the coordinator's word. The header,
  `coord-db.test.ts`' slot pins and `run-close-switch.test.ts`' count word follow the number.
- **Growth, net lines against the merge base:** `schema.ts` +26, `store.ts` +3, `server.ts` +3, `watch.ts` +6,
  `ledgersRoutes.ts` +37, `shared/refusal.ts` +3. `growth-check` armed is green.
- **Mutation floors:** `portfolioOrder` (6 mutants), `itemWaitMs` (7) and `portfolioFor` (19), every mutant killed, each
  floor 1. The plan's seven red checks are among them: P-ORDER-1, P-WAIT-1, P-WAIT-2, P-FOR-1, P-FOR-2, P-FOR-3 and P-FOR-4.
- **Task 2, Step 1.** The ask writers measure as "What exists today" says: `releaseAsk` and `declineAsk` move only `held`
  and set `releasedAt`; `staleAsk` takes `held` and `answering` and overwrites `releasedAt`; `takeAskForAnswer` takes
  `held` or `released`.
- **Table 11.6.** The vocabulary piece's refusal-table test is not on `main`. Its author confirms it reads only the
  Overlord-named refusal groups, so `rank-changed` in `LEDGER_ROUTE_REFUSALS` needs no exception-list entry.

## Departures found in the build

- **`rank-body-parser-in-shared`**: the rank door's body is read by `parseRankWrite` (and `isCalendarDate`) in
  `shared/portfolio.ts`, a pure parser beside the wire, so the door decides nothing and the console can check a write
  before it sends one. The plan lists the checks in the door. The route suite's refusal cases cover every arm.
- **`unknown-slug-inside-the-write`**: the "every `order` slug names a `programs` row" check (Task 3, item 4) runs
  inside `setPortfolioRank`'s transaction, before the revision check, and the door answers it `not-found`. The plan
  places it in the door. Inside the transaction no programme can vanish between the check and the write, and the store
  gains no new delegate.
- **`answering-or-unknown-ask-is-unmeasured`**: question 10 rules on `answered`, `released`, `declined` and `stale` asks.
  An ask in any other state that carries a `releasedAt` (an `answering` one the operator is mid-answer on, or a state word
  this build does not know) reached the operator and no live signal shows its end, so it counts in `asksUnmeasured`, as
  does an operator answer with no `answeredAt`.
- **`hold-rule-reads-raised-at`**: `operatorWasShown` now derives from `operatorShownAt`, so it needs `raisedAt` as well
  (its `Pick` widened). For an item never held it answers `raisedAt <= now` where it answered `true`; the two differ only
  for an item raised in the future, which no writer makes.
- **`live-ask-needs-a-waiting-hookstate`**: `FleetWatcher#liveAskKey` answers `null` for a hookstate that is not
  `waiting` even when it still carries an ask, as the plan's port text says ("the ask the child's newest hookstate is
  `waiting` on").

## The first CI run

The first fast run on the PR was red on three checks the brief's gate list did not name, each a census the build missed
(shallow), and each fixed in one round:

- `pwa/test/item-view.test.tsx`: every ledger route word needs a console sentence, so `rank-changed` gained one in
  `pwa/src/lib/refusalWords.ts#LEDGER_REFUSAL_TEXT`.
- `server/test/mail-routes.test.ts`: every quoted kebab word under `server/src/coord` must be declared. The writer's
  "no such programme" answer is now a field (`unknownSlug`), and its `rank-changed` reads `LEDGER_ROUTE_REFUSALS.rankChanged`.
- `server/test/token-shared.test.ts`: the portfolio's seven-day closed-waves window (`portfolio.ts#WEEK_MS`) is a new
  seven-day quantity; the coordinator ruled it in as a separate one (ask 437), the fifteenth holder. The push outbox adds
  its own holder on its branch; whichever lands second keeps both and sets the count to sixteen.
