# Portfolio PR A: build notes

What the build of Tasks 1 to 3 of `w1-portfolio.md` found, for the coordinator to fold into the programme ledger. Each
departure is a slug; the coordinator mints the numbers.

## Measured

- **Migration slot.** The portfolio's migration is entry 76. `main` took 74 for the anchor's seed row while this was built,
  so the branch first took 75 (the coordinator's ruling on ask 436); the push outbox then landed 75, and the landing merge
  renumbered this entry to 76 on the coordinator's word. The header, `coord-db.test.ts`' slot pins and
  `run-close-switch.test.ts`' count word follow the number.
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

## Fix round 1 (review 2130)

The coordinator ruled on the review's ten findings: F1, F2, F3, F4, F6, F7 and F9 are fixed here; F5, F8 and F10 are not
in this pull request (F10 goes to PR B's brief). The branch merged `main` once more, on the coordinator's word, keeping both
sides of the mutation floors files after the pool set's piece landed; the migration is still entry 75.

- **F1, `plan-fetch-text-contradicts-its-clip-rule`.** The plan's fetch text ("with a `releasedAt` in the window or still
  `released` or `declined`") never fetched an ask released before the window and answered or taken inside it, so the clip
  its question 10 rules on (and the L1 case pins) could not happen. The asks read now also fetches an ask answered in the
  window (`answeredAt >= from`) and one still `answering`. A store case releases an ask 29 days ago, answers it yesterday,
  and reads 27 days of operator wait.
- **F3, `asks-unmeasured-is-windowed`.** "Over the last 28 days" governs `asksUnmeasured`: a `released` or `declined` ask
  released before the window and shown not live (its live read names another ask or none, or it is not its child's newest
  row) is not counted, and an older row of that kind is not fetched at all. One inside the window that cannot be judged
  still counts, and so does one before it whose live read is itself unmeasured, since nothing shows it ended. Store and L1
  cases cover each side, with the window's first instant counted inside it.
- **F2.** The rank writer's census lists every `setPortfolioRank(` call under `server/src`, never deduplicated, by its
  enclosing symbol and the route whose handler holds it, and requires exactly the store's delegate and the
  `POST /api/portfolio/rank` handler. A planted control adds a second call to the goals read's handler (a box-token read in
  the same registration function) and is a second entry; the same plant in the real file reds the census (measured).
- **F4.** New cases: an `answering` ask with a `releasedAt`, an unknown state with one, an operator answer with no
  `answeredAt`, a live ask released 40 days ago, closes exactly 7 and 28 days ago (closed waves, ended waves and the
  listing), and an unknown slug with a stale `basedOn` (store and route: `not-found`, revision unmoved). `PORTFOLIO_FOR_SET`
  gains P-FOR-20 to P-FOR-27: one mutant per arm of `answering-or-unknown-ask-is-unmeasured`, the window rule and its
  unmeasured exception, and the three inclusive window edges. All killed; the floor stays 1.
- **F6.** `shared/ledgers.ts` holds the non-moving item-event acts (`raise`, `block`, `unblock`) in one
  `Record<ItemNonMove, true>` map; `isItemNonMove` reads it, `ItemEventAct` is `ItemAct | ItemNonMove`, and both the
  store's `ItemEventRow` and the portfolio's item fold use them.
- **F7.** `LiveAskRead` answers `{ kind: 'unmeasured' } | { kind: 'read'; key: string | null }`, so the compiler makes every
  caller handle the unmeasured case; `FleetWatcher#liveAskKey` and the server's dependency answer that shape.
- **F9.** The facts read takes no transaction, as `itemsFor` and `readProgrammes` do not.

## The landing merge

On the coordinator's word, after the push outbox (#2838), the vocabulary (#2840) and the history op (#2841) landed, the
branch merged `main` once more. The push outbox's migration is 75, so the portfolio's is now 76: the schema entry and its
header, `coord-db.test.ts` (the version pins, the `MIGRATIONS[75]` lines, and the slot pinned as the entry after the push
outbox's) and `run-close-switch.test.ts` (both tables dropped with the rest, "twenty-three" replayed). The seven-day census
keeps both new holders, the push outbox's `OUTBOX_KEEP_MS` as the fifteenth and the portfolio's `WEEK_MS` as the
sixteenth. The floors files, `writers-map` (its table list and expected writers), `time-ports` and `core-vocab`'s
`HANDLE_HOLDERS` keep both sides.
