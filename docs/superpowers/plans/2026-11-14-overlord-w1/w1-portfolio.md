# Overlord W1: portfolio and goals, the operator's rank and goals that say who ratified them Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the operator ranks the programmes, and the server measures how each is going.

- `portfolio_rank` holds the operator's order, written by one session-gated operator door.
- `portfolioFor`, an L1 reader that stores nothing, answers per programme, in rank order, what W1's rows can measure:
  - work in progress, and waves closed in 7 and 28 days;
  - wave cycle time (median and 85th percentile), and the age of the oldest open wave;
  - review rounds per wave, and how waves ended;
  - hours waiting on the operator;
  - what blocks the programme.
- Every goals version (the spec pin and each modification) records what it rests on in `ratifiedBy`. One L1 decider
  says whether that source ratifies it. In W1 the operator's act does, and so does the programme's own coordinator's
  write, shown as "ratified by the coordinator" (operator item 328).

**Why:** H38 (§5.6): the order between programmes is the operator's fact, and every measure is the server's. Nothing a
model or a session writes ever sets a priority or a date. §3.8: goals carry authority only when they are ratified, by
the operator or, for a version the programme's own coordinator wrote, by that coordinator (operator item 328).
Today every goal reads as not ratified, because no version records where it came from
(`server/src/continuity/cardFacts.ts`, slug goals-unratified). W1's board and home read both, and W3's answers need
ratified goals as their only goal evidence.

**Architecture:** two pull requests in lane P.

- **PR A, the rank and the measures (Tasks 1 to 3), ready to build.**
  - `shared/portfolio.ts` (L0) holds the class of service and the wire.
  - `server/src/coord/portfolio.ts` (C5, L1) holds `portfolioOrder` and `portfolioFor`, pure.
  - `server/src/coord/portfolioStore.ts` (C5, L3) holds the rank's one writer and the facts read.
  - The operator's two doors, the read and the rank, join `registerLedgerOperatorRoutes` in
    `server/src/coord/ledgersRoutes.ts`.
- **PR B, who ratified the goals (Tasks 4 and 5), after PR A.** Operator item 328 answered question 1: yes.
  - `ratifiedBy` and `ratifiedAt` on the pin and on each modification, and `doneWhenBy` naming the version that wrote
    the current definition of done.
  - One decider in `shared/ledgers.ts`, `goalRatification`, reads them.
  - The operator's ratify door joins the same registration. Its control sits in the console's Goals panel, wired by the
    programme screen.

**Tech Stack:** TypeScript (ESM), `node:sqlite`, Fastify, React (one control), vitest. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-09-overlord-design.md`:

- §5.6, H38:
  - `portfolio_rank`'s row and its one writer;
  - "a programme with no rank row reads as the bottom of `standard`" and "only the operator's rank door places a
    programme";
  - `portfolioFor`'s measures;
  - "the rank and `portfolioFor` ship in W1, answering what W1's rows measure";
  - Table 5.6a, the classes of service.
- §3.8: "Goals carry authority only when the operator ratified them … `ratifiedBy`: an item answer, a request, the
  operator's door, or `coordinator`". C19's `goals modify` paragraph (§6.3) gives the reference an item answer must meet.
- Table 11.1a, rows `portfolio_rank` and "`ratifiedBy` on each goals version". Table 11.1b, the row "`portfolioFor`;
  `homePlace`". Table 11.1e, its row "The rank door" and its caption.
- §3.5's board parts "Portfolio" and "Goals". Table 4a, row 4 (the portfolio strip, W1: the rank).
- Table 13.1, row H38 (`shape`, waves W1, W2, W5 and W6): a shape call ships with the piece that creates its table or
  door. Table 14, row W1: "the portfolio rank … and `portfolioFor`", and "`ratifiedBy` on goals".

The index is `docs/superpowers/plans/2026-11-14-overlord-w1.md` (#2814, on `main`). This plan builds on:

- its row "Portfolio and goals" (lane P, two pull requests);
- its question 24 (operator item 328), question 36 (portfolio PR A is ready now) and question 17 (the operator's doors
  and the identity port);
- its "Where lanes meet" bullets for `ledgersStore.ts` and `ledgersRoutes.ts`.

Revised in fix round 1 (review 2105). The coordinator's rulings are marked "(ruled)".

## Open questions

The index's questions this plan builds on come first. Each other question is one the spec leaves open or the tree
contradicts. The plan builds every recommendation unless the coordinator or the operator rules otherwise.

1. **Does a coordinator's own pin count as ratified?** (The index's question 24, operator item 328.) **Answered
   yes** by the operator on 2026-11-16: "A coordinator's pin counts, shown as ratified by the coordinator." This plan
   builds that answer.

   Every write records its source, so a coordinator's pin records `coordinator`. The decider has an explicit
   `coordinator` case (ruled, F3). It reads one constant, `COORDINATOR_SOURCE_RATIFIES`, which is `true`, so the case
   answers ratified, with the source `coordinator`. A version any other session wrote still needs the operator's ratify
   door: an item answer reads as not ratified until W3 (question 3), and W2's `request` source reads as §4.1 says.

   The answer reaches these sites. Each is tagged "(question 1)" where it appears.
   - The constant (Task 4): `true`.
   - The decider's test of the `coordinator` case, and the re-pin case (Task 4). A re-pin reads ratified again, by
     the coordinator, because the new text's source is the coordinator's own write.
   - The mutation floor of the `coordinator` case (Task 4).
   - The Goals panel (Task 5):
     - the word "Ratified by the coordinator", beside "Ratified by you";
     - the Ratify button does not show on a coordinator-written version, because its verdict is already ratified;
     - the panel's test checks both.
   - The card (Task 4): a coordinator's goals render as ratified, outside the untrusted block, with the source shown.
   - What a merge arms (Global Constraints): coordinator goals render as ratified from PR B's merge.

   Columns, writers, doors and the item arm are the same under either answer.
2. **The rank door ships in PR A, in `ledgersRoutes.ts`** (slug `rank-door-ships-with-its-table`; ruled, F5). The index
   puts the rank door in PR B, which also waits for designation A.
   - **Ruled:** PR A ships the table and its one writer together. H38 is a `shape` call, so the table and its door ship
     in one piece, and a table with no writer would stand in `writers-map.test.ts` with an empty writer list.
   - **Where it lives.** The door joins the programme ledgers' operator registration, not `coord/overlordRoutes.ts`.
     This departs from Table 11.1e's caption, which registers each context's Overlord doors from that context's routes
     file. It is the operator's door, and the spec says the operator's Overlord doors reuse the account gate and record
     the gate's own actor.
   - **The actor.** It departs from question 17's port half as well: the door records the session's device actor
     (below), not an actor through the `CallerIdentity` port. Adopting the port is gates A's work.
   - Both departures are on the spec-fixes list. Designation A stays out of both pull requests' "needs first".
3. **An item answer ratifies only from W3** (slug `item-ratifies-with-its-effect`). §6.3 lets a version rest on "an item
   of this programme that the operator answered and whose effect names this change". Effects arrive in W3 (§6.7), and a
   W1 item records only an answer in free text, which no code can match to a change.

   **Recommendation:** W1 records the source `item` on a modification that cites an item. The item's id stays in the
   row's own `itemId`, so it is never copied. W1 reads a cited item the operator answered as not ratified, with the
   reason `effect-unmeasured`. W3 replaces that one arm with the effect check, and every row W1 wrote is judged again
   then, because the verdict is computed at read time, never stored. In W1 only the operator's ratify door ratifies.

   "Answered" is one predicate, `itemAnswered` (ruled, F6): the item is `checking` or `done` and carries a `tickedAt`.
   That holds for a tick, for a confirm after a tick, and for a settle from `checking`. It fails for:
   - an `open` item, a returned one included: a return moves it back to `open`, keeping its old `tickedAt`;
   - a `done` item reached by `act` or by a settle from `open`, with no tick;
   - a `withdrawn` or `dismissed` item.
4. **The two operator doors and sign-in** (slugs `operator-ratify-door`, `rank-works-dark`; ruled, F4b).
   - **The ratify door confers authority, so it refuses dark.** `POST /api/programmes/:slug/goals/ratify` calls the
     account gate (`deps.gate`, `cap: null`), which refuses `auth-off` while sign-in is dark. It names the version with
     its stamp: the pin's `inShortAt`, or a modification id. A pin that changed since the operator read it is refused
     `goals-changed`, so the operator never ratifies text they were not shown. Its control is a "Ratify" button on the
     console's Goals panel (Task 5).
   - **The rank door confers none, so it works dark.** `POST /api/portfolio/rank` calls no account gate. Its actor is
     the session's device actor when sign-in is armed (`server/src/ccdargv.ts#deviceActor` over `deps.sessionAuth`),
     and `flag-off` while it is dark. That is the precedent of the `lane-arm` and `run-close` switches in
     `server/src/coord/routes.ts`. Armed, it sits behind the auth gate like every session-gated door.
   - **Correction:** fix round 0 justified a dark refusal "as question 17 says of every operator door". Question 17 is
     about the `CallerIdentity` port, and today's ledger operator doors (tick, act, decline, seen, dismiss) do not
     refuse dark. Only the two secret doors and now the ratify door do.
5. **Which version wrote the current definition of done** (slug `done-when-names-its-version`). The pin's `doneWhen`
   can be replaced later by a modification (`ledgersStore.ts#setDoneWhen`), and nothing records which one did.
   **Recommendation:** a column `programs.doneWhenBy`, `pin` or `mod:<id>`, written in the same statements that write
   `doneWhen`. NULL is a list written before the column, read as `unrecorded`, so not ratified. No second copy of the
   list.
6. **Class bands order the rank** (slug `rank-orders-within-class-bands`). §5.6 says an unranked programme reads as
   "the bottom of `standard`", which needs `standard` to be a place in the order, not only a label.
   **Recommendation:** the order is the classes in Table 5.6a's order (`expedite`, `fixed-date`, `standard`,
   `background`), then the position inside each class. Unranked programmes sit at the end of `standard`, oldest
   `createdAt` first, then by slug.
7. **Which programmes the portfolio lists** (slug `portfolio-lists-live-programmes`). §5.6 says "per programme".
   **Recommendation:** a programme with an open run of any kind, and a ranked programme that closed a run in the last
   28 days. A ranked programme that is not listed keeps its row: the rank write never deletes what the console did not
   list (question 8).
8. **A rank write merges, and a stale one is refused** (slugs `rank-write-merges`, `rank-revision-row`,
   `stale-write-words`; ruled, F8 and F9).
   - **Merge, never delete unseen (ruled).** The console sends `seen`, the slugs it listed at `basedOn`, and `order`,
     its new order of some of them. The writer:
     - writes each slug in `order` with its class, date and position;
     - deletes the rows of slugs in `seen` that are absent from `order`, so they become unranked;
     - keeps every other ranked row, with its class and date. Inside each class band, the listed entries come first in
       the given order, then the kept rows in their old order, and the band is numbered again from 1.

     A ranked programme quiet for more than 28 days, such as a `fixed-date` one between waves, is not listed, so it
     cannot be dropped by a write that never showed it.
   - **One revision counter outside the rows.** A one-row table, `portfolio_rank_revision`, holds the revision with the
     act's `setAt` and `setBy`. It only rises, so a write that empties the rank cannot bring the counter back to a value
     a stale tab holds. It also records who cleared the rank.
   - **Stale writes.** The read answers the revision. A rank write whose `basedOn` is not the current revision is
     refused `rank-changed` (409). A `basedOn` that is not a non-negative safe integer is `bad-request`. The ratify door
     refuses a changed pin `goals-changed` (409).
   - **The two words.** Both go into `LEDGER_ROUTE_REFUSALS` (slug `ledger-words-before-the-vocabulary-group`). The
     index says a missing W1 word goes into the vocabulary piece's group, but that group is not on `main`, and
     `shared/refusal.ts` already keeps one object per door family, these two doors' family among them. Each word joins
     the vocabulary piece's Table 11.6 exception list when that test is on `main` (Task 3, Step 6).
9. **The console needs a read** (slug `portfolio-read-door`). The board composes `portfolioFor` in process, but the
   home's portfolio strip (Table 4a, home B) and the rank control need a read. **Recommendation:** `GET /api/portfolio`,
   session-gated, answering the rank revision and `portfolioFor`'s answer. It carries programme and item titles that
   sessions wrote, so it joins `MASKED_GET_ROUTES`.
10. **Hours waiting on the operator count only what truly waited on the operator** (slug
    `operator-wait-from-items-and-asks`; ruled, F1 and F13). All of it is over the last 28 days.

    **Items.**
    - An item waits while it is `open` and the operator has been shown it. "Shown" is one rule,
      `operatorShownAt` (Task 1 moves it to L1, and `operatorWasShown` derives from it).
    - The open spans come from the item's own events: a tick ends one, a return starts one, a close ends it. The
      coordinator's `checking` time is never the operator's.
    - An item closed inside its hold adds nothing.
    - An event act this build does not know makes the item's wait unmeasured: it counts in `itemsUnmeasured`, never as
      zero.

    **Asks.** An ask waits on the operator only once its push fired, at its `releasedAt`. Then:
    - **Answered by the operator.** It adds `releasedAt` to `answeredAt`, and only when `answeredBy` is the operator
      (`shared/api.ts#ASK_OPERATOR_PRINCIPAL`). A parent's late answer adds nothing.
    - **Still `released` or `declined`.** It adds up to now only while it is live. Live means two things: the row is
      its child's newest ask, and the watcher's newest hookstate for that child is `waiting` on an ask whose `askKey`
      is the row's. This is the same identity the question lane re-seeds by. Otherwise it reads unmeasured and counts
      in `asksUnmeasured`, never as an ever-growing wait.
    - **Why `declined` is treated like `released`.** The ruling says "a declined ask counts up to its decline", but the
      code moves only `held` to `declined` (`CoordStore#declineAsk`'s `WHERE`). So the decline is the moment the push
      fires, and the time before it was the parent's window. A declined ask is also terminal for ccrc's answer routes
      (`takeAskForAnswer` refuses it), so its end can only be read from the pane.
    - **`stale` asks.** They are not counted at all, and not in `asksUnmeasured`. `staleAsk` takes only `held` and
      `answering`, so most went stale before any push, and it overwrites `releasedAt` with the time the dialog went
      away. The one blind spot: an ask released, then taken by the operator (`answering`), then gone stale. Its release
      is overwritten and no row can show it.

    Intervals are clipped to the window and summed, never merged, so two items waiting at once count twice:
    programme-hours, as M30 measures them.

## What exists today

Measured on `main` at `2d5d4d4ef` (2026-11-15), and again in fix round 1.

- **No portfolio.** `git grep -i portfolio` finds nothing under `server/src`, `shared`, `pwa/src`, `agent/src` or `ccd`.
- **The goals.** The pin is four columns on `programs`: `specPath`, `inShort` and `inShortAt` (migration 37) and
  `doneWhen` (migration 53, D-8126). The modifications are `programme_modifications` (migration 37): `program`, `at`,
  `text`, `ruling`, `itemId`, `pr`, `mergedAt`. All of their SQL is in `server/src/coord/ledgersStore.ts`:
  - writers `setSpecPin`, `setDoneWhen` (called by `addModification` in one transaction), `addModification` and
    `markModificationsMerged`;
  - the reader `goalsFor`, answering `shared/ledgers.ts#GoalsView` with the stored list read back through
    `storedDoneWhen`.

  `CoordStore` keeps a one-line delegate for `setSpecPin`, `addModification` and `goalsFor` (`server/src/coord/store.ts`).
  `writers-map.test.ts`' `TABLES` names neither `programs` nor `programme_modifications`.
- **The goals doors** (`server/src/coord/ledgersRoutes.ts`):
  - `registerLedgerCoordinatorRoutes` holds `POST /api/programmes/:slug/spec`, `…/modifications` and
    `…/modifications/merged`: box-token lanes with attribution and `claimsProgramme`, in the order the file's header
    states;
  - `registerLedgerOperatorRoutes` holds `GET /api/programmes/:slug/goals`, a session or the box token (D-8126's A2),
    answering `goalsReadOf`;
  - the waiting frame and `GET /api/waiting` carry every pinned programme's `GoalsView` (`waitingViewOf`).
- **No `ratifiedBy` anywhere.** `server/src/continuity/cardFacts.ts` builds each programme's goals as
  `[inShort, ...doneWhen]`, every one `ratified: false`, under the comment that names the slug goals-unratified.
- **The console's Goals.** `pwa/src/ledgers/GoalsPanel.tsx` is props only: it fetches nothing, owns no route and takes no
  callback. `pwa/src/ledgers/ProgrammeScreen.tsx` owns the data (`useGoalsRead`) and renders the panel. The item actions
  live outside the panel (`pwa/src/ledgers/WaitingRoutes.tsx`). `pwa/src/lib/api.ts` already reads an older server's 404
  as "not available" on other calls.
- **The items' moves** (`shared/ledgers.ts#ITEM_TRANSITIONS`):
  - a tick moves `open` to `checking`;
  - only the coordinator's confirm reaches `done` from there;
  - a return moves `checking` back to `open`, keeping the old `tickedAt` (`ledgersStore.ts#moveItemInTx`);
  - `act` and `settle` can reach `done` with no `tickedAt`.

  Each move writes an `operator_item_events` row (`act`, `at`, `actor`), beside `raise`, `block` and `unblock` rows.
  `ledgersStore.ts#operatorWasShown` holds the hold rule: an item still held is not shown, nor one its coordinator
  settled inside the hold. No test names it.
- **The runs `portfolioFor` reads.** `runs` has `program`, `wave`, `kind` (`work`, `review` or `unknown`, read through
  `shared/api.ts#isRunKind`), `reviews` (the work run a review run reads), `state`, `openedAt`, `dispatchedAt`,
  `closedAt` and `closeDetail`. `TERMINAL_RUN_STATES` is `done` and `failed`.
  - `markDispatched` writes `dispatchedAt` before a run's state advances, so on `main` only a `planned` run lacks it.
  - A disaster rebuild (`CoordStore#reconstruct`) writes NULL for done and failed waves.
- **The programme reader already on `main`.** `server/src/coord/programmesRead.ts#readProgrammes` serves `GET
  /api/programmes` from one aggregate statement over the `RunsDb` port (`server/src/coord/runsPage.ts#RunsDb`).
  - It folds the waves with `shared/programmes.ts#WAVE_BUCKET` and `#programmeCurrentWave`.
  - Two rules are private to it. `wavesOf` picks the run that stands for a wave: the newest open group, else the newest,
    by `maxId` over group rows. `NEVER_STARTED_DETAIL` (`abandon:never-started`) is read by `endingOf`.
  - `endingOf` picks the newest group by `maxId` alone. That equals `wavesOf`' rule only because it runs when no run is
    open.
  - `server/test/programmes-read.test.ts` never puts an open run against a newer closed one, nor two open runs in one
    wave, so it does not yet characterize the open-first branch or its id tie-break.
- **Asks** (`asks`; `shared/api.ts#AskState`). A child's ask is minted `held`. Then:
  - it moves to `released` when its window lapses and the push fires (release sets `releasedAt`);
  - or to `declined` when its parent hands it over, also pushed and setting `releasedAt`, from `held` only;
  - or to `stale` from `held` or `answering` when its dialog goes away (`staleAsk`, which overwrites `releasedAt`).

  `takeAskForAnswer` takes only `held` or `released`. `answeredBy` is the principal that answered:
  `ASK_OPERATOR_PRINCIPAL` (`'operator'`) or the parent's id. A `released` row whose dialog clears with nobody answering
  never moves on (an open follow-up recorded in `server/src/coord/questions.ts`). The watcher keeps each session's newest
  hookstate (`FleetWatcher`'s private `hookStates`), and `server/src/askkey.ts#askKey` names an ask's identity.
- **A percentile.** `server/src/perf/stats.ts#percentile` (context K, L1) is nearest-rank and answers 0 for an empty
  series.
- **The operator's doors.**
  - `registerLedgerOperatorRoutes` takes `deps.gate`, the account gate
    (`server/src/accounts/gate.ts#createAccountGate`). It refuses `auth-off` while sign-in is dark, and a pass carries
    the actor (`server/src/accounts/audit.ts#AccountActor`, stored as `<label> <8 hex>`). Its deps also carry
    `authEnabled` and `sessionAuth`.
  - Their census is `LEDGER_OPERATOR_DOORS` in `server/test/box-token-census.test.ts`, checked against the file in both
    directions and, through `SESSION_ONLY_ALL`, against `CLAUDE.md`'s box-token bullet.
  - `server/test/auth-gate.test.ts` holds the route counts:
    - `scanRoutes('coord/ledgersRoutes.ts')` (20);
    - `ROUTES.length`, the sweep's route counts in its prose (checked by `digitsIn`), and the "scanned + static
      wildcard" comment;
    - the hand-kept `FLAG_AWARE` set ("exactly those nineteen"), whose sweep requires every other route's dark answer
      to equal its signed-in answer.

    `server/src/auth/gate.ts`' header names the route count too, and that test checks it.
- **The store.** `server/src/coord/schema.ts` holds 73 migrations (`COORD_SCHEMA_VERSION`, pinned at 73 by
  `server/test/coord-db.test.ts`). `server/test/run-close-switch.test.ts` drops every migration from 55 by hand.
- **Refusal words.** `shared/refusal.ts#LEDGER_ROUTE_REFUSALS` holds the ledger doors' words, and `REFUSAL_STATUS` is a
  `Record`, so a word without a status does not compile. `runs-unreadable` (503) is what `GET /api/programmes` answers
  when its statement throws. `not-configured` and `auth-off` are both 501.

## Global Constraints

- **Architecture (`CLAUDE.md`).**
  - `shared/portfolio.ts` is L0: it imports only types from `./api.js`. Each literal union carries its
    `Record<X, true>` map (`rings/wire-totality.test.ts`).
  - `server/src/coord/portfolio.ts` is L1: pure, no `fs`, no store, no clock. It imports `shared/` and
    `server/src/perf/stats.ts` (K) only. `now` is an argument.
  - `server/src/coord/portfolioStore.ts` is L3: SQL only, every function synchronous over the store's database. It
    keeps every distinction it reads (below).
  - The live-ask read is an L2 port, `LiveAskRead`, declared in `server/src/coord/ports.ts` beside the coordination
    ports. Its consumer is the facts read, and its adapter is a read-only accessor on `FleetWatcher`.
  - The doors are L4 and decide nothing. The order is `portfolioOrder`'s, the measures are `portfolioFor`'s, and the
    verdict is `goalRatification`'s.
  - No repository and no async wrapper over `CoordStore`. `CoordStore` gains one-line delegates only.
- **One writer each.**
  - `portfolio_rank` and `portfolio_rank_revision`: `portfolioStore.ts#setPortfolioRank`, called only by the rank door
    (a census pins both, Task 2).
  - The ratification columns, `ratifiedBy` and `ratifiedAt`:
    - on `programs`: `setSpecPin` (a re-pin records its own source) and the new `ratifyGoalsVersion`;
    - on `programme_modifications`: `addModification` (at insert) and `ratifyGoalsVersion`.

    These are the writers Table 11.1a names: "the goals doors, and the operator's answer that ratifies". A column
    census pins them (Task 4).
  - `doneWhenBy` is written only in the statements that write `doneWhen` (`setSpecPin`, `setDoneWhen`).
  - The verdict is never stored. `goalRatification` computes it at every read.
- **Consolidate, don't duplicate.**
  - `portfolioFor` reuses `WAVE_BUCKET` and `countsAsWave` (`shared/programmes.ts`), and `percentile` (`perf/stats.ts`,
    called only on a non-empty series).
  - `programmesRead.ts`' wave rule and never-started detail move to `shared/programmes.ts`, and the item hold rule
    moves to `shared/ledgers.ts` as `operatorShownAt`. Each move happens behind characterization tests (Task 1), so two
    readers cannot disagree on what a wave is or when the operator was shown an item.
- **Failure contracts. An unread fact never reads as zero.**
  - The facts read is one synchronous read of `coord.db`. A throw is the read door's `runs-unreadable` (503), as for
    `GET /api/programmes`, never an empty portfolio.
  - A run state outside `RUN_STATES` buckets as `working`, as `WAVE_BUCKET`'s readers do. A run kind outside
    `RunKind` reads `unknown` through `isRunKind`, and `countsAsWave` leaves it out.
  - A class word outside the vocabulary, read from a row an older or newer build wrote, reads as unranked (`standard`).
    The entry carries `rankUnreadable: true`, never a silent rank.
  - A measure with no data answers `null` with `n: 0`, never 0. A done wave with no `dispatchedAt` counts in
    `cycleUnmeasured`.
  - The live-ask port answers `unmeasured` when the watcher has read no hookstate for that child in this process. An
    ask it cannot judge counts in `asksUnmeasured`.
  - A `ratifiedBy` text the parser cannot read answers `unreadable`, and NULL answers `unrecorded`. Both are "not
    ratified", told apart on the wire. One reader, `ratificationOf`, takes an older server's absent field as `absent`,
    its own word (Task 4).
- **Wire: additive.** `GoalsView` gains optional fields, so an older console ignores them. `FLEET_PROTO` is not bumped.
  - An older server has no portfolio doors, so the console reads their 404 as "not available on this server" (home B's
    concern, stated in the index's changes).
  - Task 5's ratify call does the same for its own door.
- **What a merge arms.** Nothing a running session sees or does changes.
  - PR A: no rank row exists until the operator writes one, and no W1 reader but the board and the home reads the rank.
    The relay's priority (W2) and the order where work waits (W6) come later.
  - PR B (question 1): a version the programme's own coordinator wrote after the merge renders as ratified, "ratified
    by the coordinator", on the card and in every goals read. A row from before the merge holds no source and reads
    `unrecorded`, so it renders as today until its coordinator pins again or the operator ratifies it.
- **SAFETY (`CLAUDE.md`).** No ccd verb, no fleet act and no live `~/.ccrc`. Tests build `coord.db` in memory or in a
  fixture directory under the per-run temp root.
- **Tests.** Run from `server/` as `ccrc test -- ./node_modules/.bin/vitest run test/<file>.test.ts`, and from `pwa/`
  the same way for Task 5's control. Each task's last run adds both server `tsc` runs (`ccrc test -- npx tsc --noEmit -p
  tsconfig.json` and `-p test/tsconfig.tests.json`) and pwa's `tsc`, because `shared/` changes.
- **Growth check.** Every growth-checked file stays within 40 net lines in each pull request, with no waiver (the PR
  split below has the estimates). No touched file has a cap.
- **Mutation floors.** `portfolioOrder`, `portfolioFor`, `goalRatification` and `itemAnswered` each join
  `MUTANT_SETS` (`server/test/sim/mutation-floors.test.ts`) and `server/test/sim/mutation-floors.json` in the pull
  request that creates them.
- **Censuses** are named in each task. Every guard ships with the test that goes red without it.
- **Public repository.** No private names: fixtures use `prog-a`, `prog-b`, `lane-a-project-a` and the actor label
  `op-a`. Cite by symbol or `@anchor`. No D-number is invented: departures are slugs under "Deviations found", and the
  coordinator mints numbers.

## Review Focus

1. **The order is the operator's and nothing else writes it.** One writer, reached only through the rank door. No
   box-token route and no session path reach it, as the census proves in both directions. An unranked programme reads
   as the bottom of `standard`, the server writes no row, and a write never drops a programme the console did not list.
2. **Every measure is honest about what it did not see.** No measure folds "no data" into 0. A wait counts only time
   that truly waited on the operator. An unreadable row or an unjudgeable ask is reported, never dropped. A store
   failure is a refusal, never an empty answer.
3. **Ratification is computed, never asserted.** A version records only what it rests on. Only the operator's act reads
   as ratified in W1, and the ratify door refuses while sign-in is dark. An item reads "not ratified" until W3's effect
   check exists. A changed pin cannot be ratified blind.
4. **One wave rule and one hold rule.** `portfolioFor` and `GET /api/programmes` agree on what a wave is and how it
   ended. `portfolioFor` and the waiting list agree on when the operator was shown an item. Each agreement goes through
   one shared function, moved behind characterization tests.

## The PR split

| PR | Tasks | What it ships | Needs first | Growth-checked files, estimate (net lines) |
|---|---|---|---|---|
| A | 1 to 3 | The class vocabulary and the wire; the shared wave rule and hold rule; `portfolioOrder` and `portfolioFor`; `portfolio_rank` with its revision row and writer; the facts read with the live-ask port; `GET /api/portfolio` and `POST /api/portfolio/rank` | nothing: **ready to build** | `schema.ts` +28 (one migration with its comment); `store.ts` +3 (two delegates, one import); `server.ts` +3 (`MASKED_GET_ROUTES` and the live-ask dep); `watch.ts` +6 (the read-only accessor) |
| B | 4 and 5 | The ratification columns and their writers; `goalRatification` and `itemAnswered`; `GoalsView`'s sources and verdicts; the card's goals read; the ratify door; the Ratify control | PR A (operator item 328 answered question 1: yes) | `schema.ts` +18 (one migration); `store.ts` +1 (one delegate; two delegate signatures widened in place); `pwa/src/lib/api.ts` +8 (one call with its 404 arm); `shared/api.ts` 0 |

Each pull request merges `main` once before merge and re-measures its migration slot (the index's "Where lanes meet").

For scale, the files that are not growth-checked change by about this much:

| File | PR A | PR B |
|---|---|---|
| `shared/portfolio.ts` | +120, new | |
| `server/src/coord/portfolio.ts` | +230, new | |
| `server/src/coord/portfolioStore.ts` | +190, new | |
| `ledgersRoutes.ts` | +80 | +45 |
| `ledgersStore.ts` | −5 | +60 |
| `shared/ledgers.ts` | +15 | +80 |
| `programmesRead.ts` | −15 | |
| `shared/programmes.ts` | +25 | |
| `ProgrammeScreen.tsx` | | +25 |
| `GoalsPanel.tsx` | | +30 |

## Index changes

The index (#2814) should carry these. The coordinator passes them to the index's own fix round.

- **The "Portfolio and goals" row:**
  - what it ships: "A: the class vocabulary, `portfolio_rank` with its rank door and the operator's portfolio read, and
    `portfolioFor` (W1's rows). B: `ratifiedBy` on the pin and on `programme_modifications`, the decider, and the
    operator's ratify door with its Goals-panel control (question 24)";
  - "needs first": "A: nothing. B: PR A". Question 24 is answered by operator item 328. Designation A comes off it
    (question 2, ruled).
- **Figure W1:**
  - the edge from "designation A" to "portfolio B" is removed;
  - `PFB --> HMB` becomes `PFA --> HMB`: home B needs portfolio A for the rank and the measures;
  - `PFB --> HB` stays: the board's Goals part, "with each version's `ratifiedBy`" (§3.5), needs portfolio B.

  The rows for home B and for board and history B say the same.
- **Home B** draws the strip **and the rank control**: the strip's reorder, which writes through `POST
  /api/portfolio/rank` with `seen` and `order`. It reads a 404 from an older server as "no portfolio yet". No other
  lane owns that control today.
- **The board** composes `portfolioFor` from `portfolioFacts` with the same live-ask port, so board and history B passes
  that port.
- **Lane P's file list:**
  - `shared/portfolio.ts`, `server/src/coord/portfolio.ts` and `portfolioStore.ts`;
  - the two doors in `ledgersRoutes.ts`' operator registration, not `overlordRoutes.ts`. That file's handler list in
    "Where lanes meet" drops "portfolio B";
  - `shared/programmes.ts` (the shared wave rule) and `shared/ledgers.ts` (the hold rule);
  - `server/src/coord/ports.ts` (`LiveAskRead`) and `FleetWatcher`'s one accessor in `server/src/watch.ts`;
  - `pwa/src/ledgers/GoalsPanel.tsx` and `ProgrammeScreen.tsx`, and one call in `pwa/src/lib/api.ts`.
- **"Where lanes meet":**
  - `ledgersRoutes.ts`: lane P adds the portfolio read, the rank door and the ratify door to the operator registration,
    and stamps sources in the spec and modification doors;
  - `server/src/watch.ts` gains lane P's read-only accessor, beside lanes E, D and A's edits;
  - `shared/refusal.ts`: lane P adds `rank-changed` and `goals-changed` to `LEDGER_ROUTE_REFUSALS` (question 8).
- **The spec-fixes list gains:**
  - Table 11.6 lacks `rank-changed` and `goals-changed`;
  - §3.8 names "the operator's door" but no such door;
  - §5.6 does not say how classes order the rank (question 6), nor that a rank write merges (question 8);
  - §6.3's item arm needs W3's effects (question 3);
  - Table 11.1e's caption places the rank door in `coord/overlordRoutes.ts`, but it is an operator door in the ledger
    registration, recording the session's device actor until gates A's port (question 2).

---

### Task 1: The vocabulary, the two moved rules and the two deciders (L0, L1)

**Files:**
- Create: `shared/portfolio.ts` (L0)
- Modify: `shared/programmes.ts` (gains `waveRepresentative` and `NEVER_STARTED_DETAIL`, moved from
  `server/src/coord/programmesRead.ts`)
- Modify: `server/src/coord/programmesRead.ts`. `wavesOf` calls `waveRepresentative` through a small adapter over its
  group rows, `{ id: g.maxId, open: g.openIds !== null }`. This is faithful because every run in a group shares one
  state. `endingOf` reads the moved `NEVER_STARTED_DETAIL`, and its own newest-by-`maxId` pick stays.
- Modify: `shared/ledgers.ts` (gains `operatorShownAt`)
- Modify: `server/src/coord/ledgersStore.ts` (`operatorWasShown` becomes a one-line derivation from `operatorShownAt`)
- Create: `server/src/coord/portfolio.ts` (C5, L1: `portfolioOrder`, `itemWaitMs`, `portfolioFor`)
- Modify: `server/test/programmes-read.test.ts` (two characterization cases, Step 1)
- Create: `server/test/operator-shown.test.ts` (the hold rule's characterization, Step 1)
- Create: `server/test/portfolio.test.ts`
- Create: `server/test/sim/portfolioSets.ts`
- Modify: `server/test/sim/mutation-floors.test.ts` (`MUTANT_SETS`) and `server/test/sim/mutation-floors.json`
- Modify: `server/test/single-definition/time-ports.test.ts` (`TIME_PORT_FILES` gains `shared/portfolio.ts` and
  `server/src/coord/portfolio.ts`)
- Test: `server/test/rings/*.test.ts`, `server/test/ledgers-store.test.ts`, `server/test/ledgers-operator-routes.test.ts`

**Interfaces:**

```ts
// shared/portfolio.ts
export type ServiceClass = 'expedite' | 'fixed-date' | 'standard' | 'background';   // Table 5.6a, in band order
const SERVICE_CLASS_MAP: Record<ServiceClass, true>;
export const SERVICE_CLASSES: readonly ServiceClass[];                                // derived from the map
export const isServiceClass: (v: unknown) => v is ServiceClass;
export const PORTFOLIO_WINDOW_DAYS = 28;
export const RANK_ORDER_MAX = 200;                                                   // entries one write may carry
/** One stored row. `cls` is read through `isServiceClass`; a word it refuses arrives as `null` with `clsRaw` kept. */
export interface RankRow { program: string; position: number; cls: ServiceClass | null; clsRaw: string;
  fixedDate: string | null; setAt: number; setBy: string }
export interface PortfolioProgramme { slug: string; title: string; createdAt: number }
export interface PortfolioRun { id: number; program: string; wave: number; kind: RunKind; reviews: number | null;
  state: string; openedAt: number; dispatchedAt: number | null; closedAt: number | null; closeDetail: string | null }
export interface PortfolioItem { id: number; program: string; title: string; neededBy: string; state: string;
  raisedAt: number; heldUntil: number | null; tickedAt: number | null; closedAt: number | null;
  events: readonly { at: number; act: string }[] }                                   // oldest first
/** `live`: the facts read's verdict from the live-ask port, for a `released` or `declined` row that is its child's
 *  newest; `null` for every other row. */
export interface PortfolioAsk { id: number; program: string; state: string; releasedAt: number | null;
  answeredAt: number | null; answeredBy: string | null; live: boolean | 'unmeasured' | null }
export interface PortfolioFacts { programmes: readonly PortfolioProgramme[]; ranks: readonly RankRow[];
  revision: number; runs: readonly PortfolioRun[]; items: readonly PortfolioItem[]; asks: readonly PortfolioAsk[] }
export interface Measure { n: number; medianMs: number | null; p85Ms: number | null }
export interface PortfolioEntry {
  slug: string; title: string;                 // title: session-written, rendered as untrusted data
  rank: { position: number; cls: ServiceClass; fixedDate: string | null } | null;   // null: unranked
  cls: ServiceClass;                           // effective: the rank's, or 'standard' when unranked
  rankUnreadable?: true;                       // a stored row whose class word this build does not know
  wip: { working: number; waiting: number; queued: number };
  closedWaves: { days7: number; days28: number };
  cycle: Measure;                              // done waves: first dispatch to close
  cycleUnmeasured: number;                     // done waves with no dispatchedAt (a rebuilt database)
  /** The oldest started, still open wave's age. Null only when no wave is `working` or `waiting`: on `main` every run
   *  past `planned` has a `dispatchedAt`, and `wip.queued` counts the waves that have none. */
  oldestOpenMs: number | null;
  reviewRounds: { rounds: number; waves: number };   // review runs over done waves, both counts
  ended28: { done: number; failed: number; neverStarted: number };
  waitingOnOperatorMs28: number;               // programme-time, question 10
  itemsUnmeasured: number;                     // items whose events this build cannot fold
  asksUnmeasured: number;                      // asks that reached the operator and whose end no live signal shows
  blocking: { items: readonly { id: number; title: string }[]; asks: number };
}
export interface PortfolioView { at: number; revision: number; programmes: readonly PortfolioEntry[] }
```

```ts
// shared/programmes.ts, moved from programmesRead.ts
export const NEVER_STARTED_DETAIL = 'abandon:never-started';
/** Which of a wave's work runs stands for it: the newest open one, else the newest (highest id). */
export function waveRepresentative<T extends { readonly id: number; readonly open: boolean }>(runs: readonly T[]): T | null;
```

```ts
// shared/ledgers.ts, the hold rule moved from ledgersStore.ts
/** When the operator was first shown an item: its `heldUntil`, or its `raisedAt` when it was never held; null when its
 *  coordinator settled it inside the hold. `operatorWasShown(row, now)` is `shownAt !== null && shownAt <= now`. */
export function operatorShownAt(row: { raisedAt: number; heldUntil: number | null; closedAt: number | null }): number | null;
```

```ts
// server/src/coord/portfolio.ts
/** Classes in band order, the position inside a band; unranked at the end of `standard`, by createdAt then slug. */
export function portfolioOrder(ranks: readonly RankRow[], programmes: readonly PortfolioProgramme[]): readonly string[];
/** The item's operator wait inside [from, to]: its `open` spans from its events, after `operatorShownAt`; or
 *  'unmeasured' when an event's act is not an `ItemAct`, `raise`, `block` or `unblock`. */
export function itemWaitMs(item: PortfolioItem, from: number, to: number): number | 'unmeasured';
/** The listed programmes (question 7) in `portfolioOrder`, each with W1's measures. Pure; `now` is the caller's. */
export function portfolioFor(facts: PortfolioFacts, now: number): PortfolioView;
```

**The measures, per programme.** Waves are the programme's work runs grouped by `wave`. Each wave buckets by
`waveRepresentative`'s run through `WAVE_BUCKET`, as `GET /api/programmes` buckets it.
- **`wip`:** waves whose bucket is `working`, `waiting` or `queued`, one count each.
- **`closedWaves`:** `done` or `failed` waves whose representative closed in the last 7 and 28 days.
- **`cycle`:** over the programme's `done` waves, the representative's `closedAt` minus the wave's earliest
  `dispatchedAt`. A wave with no `dispatchedAt` is left out of `n` and counted in `cycleUnmeasured`. `medianMs` and
  `p85Ms` come from `percentile` (50 and 85). With `n` 0 both are `null`.
- **`oldestOpenMs`:** `now` minus the earliest `dispatchedAt` of a `working` or `waiting` wave, else `null`.
- **`reviewRounds`:** review runs (`kind = 'review'`) whose `reviews` names a work run of a `done` wave, with that
  count of done waves.
- **`ended28`:** waves closed in 28 days, by their bucket. `neverStarted` counts the `failed` ones whose `closeDetail`
  is `NEVER_STARTED_DETAIL`.
- **`waitingOnOperatorMs28`, `itemsUnmeasured`, `asksUnmeasured`:** question 10's rules.
- **`blocking.items`:** items in state `open` (not `checking`, which is the coordinator's turn) with `neededBy =
  'blocking'` that the operator has been shown at `now` (`operatorShownAt`). A held one is not listed.
- **`blocking.asks`:** asks whose `live` is `true`.
- **`revision`:** the facts' revision, 0 when the rank was never written.

- [ ] **Step 1: Characterize both moves on `main`, then move.**
  - Add two cases to `test/programmes-read.test.ts`:
    - a wave whose older work run is open (`working`) and whose newer one is closed (`failed`) buckets `working`: the
      open run wins;
    - a wave with two open work runs, an older `working` and a newer `planned`, buckets `queued`: the higher id wins.
  - Add `test/operator-shown.test.ts` over `operatorWasShown`:
    - a never-held item is shown;
    - a held item is not shown before `heldUntil` and is shown at it;
    - an item closed before `heldUntil` is never shown;
    - an item closed at or after it is shown.
  - Run both on `main`: green. Mutate `wavesOf`' open-first branch and its id tie-break, and `operatorWasShown`'s
    closed-inside-the-hold arm. Each mutation reds a case. Revert. Commit the tests on their own.
  - Then move the wave rule and `NEVER_STARTED_DETAIL` to `shared/programmes.ts`, and the hold rule to
    `shared/ledgers.ts` as `operatorShownAt`, with `operatorWasShown` deriving from it. Run both files and
    `test/ledgers-store.test.ts`, `test/ledgers-operator-routes.test.ts` unchanged: green. Commit:
    `refactor(programmes): the wave's representative run, the never-started detail and the item hold rule move to shared (Overlord W1, portfolio)`.
- [ ] **Step 2: Failing tests** in `test/portfolio.test.ts`, each over a hand-built `PortfolioFacts`:
  - **The order.** Two ranked `standard` programmes and one unranked come out ranked, ranked, unranked. An `expedite`
    row at position 9 comes before a `standard` row at position 1. Two unranked programmes come oldest first, and on
    equal `createdAt` by slug. A `background` row comes after every unranked programme.
  - **An unreadable class.** A row whose class word is `urgent` reads unranked, with `rankUnreadable: true`.
  - **The list.** A programme with only closed runs, older than 28 days and unranked, is not listed. The same programme
    ranked is not listed either. Ranked with a close 3 days ago, it is listed.
  - **The waves, as `GET /api/programmes` reads them.** A wave whose newer work run is `planned` while an older one is
    `working` counts as `queued`: the newer open run stands for it. A wave whose older run is `working` and whose newer
    one is `failed` counts as `working`. A review run never counts as a wave. A run of kind `unknown` never counts.
  - **The cycle.** Done waves of 2, 4 and 10 hours give a median of 4 and a p85 of 10, with `n` 3. No done wave gives
    `n` 0 and both `null`, never 0. A done wave with no dispatch is left out of `n` and counts one in
    `cycleUnmeasured`.
  - **Endings.** A `failed` wave closed `abandon:never-started` counts in `failed` and in `neverStarted`. One closed 29
    days ago counts in neither.
  - **Item waits.**
    - An item held until `t1` and ticked at `t2` adds `t2 − t1`.
    - An item ticked, returned at `t3`, ticked again at `t4` and confirmed adds its two open spans, never its
      `checking` time.
    - An open item adds up to `now`, and one raised 40 days ago and still open adds 28 days, clipped.
    - An item closed inside its hold adds nothing.
    - Two items waiting at once add twice.
    - An item with an event act `teleport` adds nothing and counts one in `itemsUnmeasured`.
  - **Ask waits (question 10, each case pinned):**
    - released and answered by the operator adds its span;
    - released and answered late by the parent adds nothing;
    - `released` and live adds up to `now`;
    - `released` and not live adds nothing and counts one in `asksUnmeasured`;
    - `released` with `live: 'unmeasured'` does the same;
    - `declined` and live adds up to `now`, from its `releasedAt`;
    - `declined` and not live counts unmeasured;
    - an ask answered from `held` (no `releasedAt`) adds nothing;
    - a `stale` ask adds nothing and is not in `asksUnmeasured`.
  - **Blocking.** An open, shown `blocking` item is listed by id and title. A held one is not. A `checking` one is not.
    A closed one is not. A live released ask counts in `blocking.asks`, and one that is not live does not.
  - **No clock.** The answer is a function of `facts` and `now` alone: the same input twice gives deep-equal output.
- [ ] **Step 3: Run.** Red.
- [ ] **Step 4: Implement** `shared/portfolio.ts` and `server/src/coord/portfolio.ts`, and add both files to
  `TIME_PORT_FILES`.
- [ ] **Step 5: Run** this suite, `test/programmes-read.test.ts`, `test/operator-shown.test.ts`,
  `test/rings/*.test.ts`, `test/single-definition/*.test.ts` and the three `tsc` runs. Green.
- [ ] **Step 6: Mutation sets.** `server/test/sim/portfolioSets.ts`, on the shape of `server/test/sim/cardMutants.ts`:
  one set each for `portfolioOrder`, `itemWaitMs` and `portfolioFor`, each running this suite's cases against the
  mutated module. Measure the floors with `test/sim/mutation-floors.test.ts` and record them in
  `mutation-floors.json`. Red check, each reverted:
  - put unranked programmes before ranked `standard` ones;
  - answer 0 for an empty cycle series;
  - count a review run as a wave;
  - drop the 28-day clip;
  - count `checking` time as operator wait;
  - count a parent's answer;
  - count a released ask that is not live up to `now`.
- [ ] **Step 7: Commit.** `feat(portfolio): the class of service, the order and portfolioFor, pure (Overlord W1)`

### Task 2: `portfolio_rank`, its one writer, the live-ask port and the facts read (L2, L3)

**Files:**
- Modify: `server/src/coord/schema.ts` (one migration: `portfolio_rank` and `portfolio_rank_revision`)
- Create: `server/src/coord/portfolioStore.ts` (`setPortfolioRank`, `portfolioFacts`)
- Modify: `server/src/coord/store.ts` (one-line delegates `setPortfolioRank` and `portfolioFacts`; one import)
- Modify: `server/src/coord/ports.ts` (`LiveAskRead`, a type)
- Modify: `server/src/watch.ts` (`FleetWatcher#liveAskKey`, a read-only accessor over `hookStates`)
- Modify: `server/test/coord-db.test.ts` (73 to the new count), `server/test/run-close-switch.test.ts` (its undo step
  drops both tables, and its count word moves by one)
- Modify: `server/test/single-definition/writers-map.test.ts`:
  - `TABLES` gains `portfolio_rank` and `portfolio_rank_revision`, each written only by
    `portfolioStore.ts#setPortfolioRank`;
  - a new case pins that `setPortfolioRank(` is called under `server/src` only by `CoordStore`'s delegate and
    `ledgersRoutes.ts`' rank door, with a planted control.
- Modify: `server/test/single-definition/time-ports.test.ts` (`TIME_PORT_FILES` gains `portfolioStore.ts`)
- Create: `server/test/portfolio-store.test.ts`, `server/test/watcher-live-ask.test.ts`
- Test: `server/test/rings/watcher-store-port.test.ts`, `server/test/rings/host-imports.test.ts`

**Schema:**

```sql
CREATE TABLE portfolio_rank (
  program   TEXT PRIMARY KEY,          -- a programs.slug; the door checks it exists
  position  INTEGER NOT NULL,          -- the place inside its class band, 1 first
  cls       TEXT NOT NULL,             -- ServiceClass; read through isServiceClass, never a cast
  fixedDate TEXT,                      -- YYYY-MM-DD, only on fixed-date
  setAt     INTEGER NOT NULL,          -- wall ms of the write that last placed this row
  setBy     TEXT NOT NULL              -- that write's actor: the session's device actor, or flag-off
);
CREATE TABLE portfolio_rank_revision (
  id       INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL,           -- only rises; 0 is "never written", which no row stores
  setAt    INTEGER NOT NULL,
  setBy    TEXT NOT NULL
);
```

The migration's comment states the slot to re-measure, as every migration does. It adds new tables and nothing on an
existing table, so an older build takes rule 3 and ignores them (Table 11.1a: "Ignores it").

**The writer.** `setPortfolioRank(db, write, actor, now)` takes `write = { basedOn, seen, order }` and runs in one
transaction.
1. It reads the revision row: absent is 0. If `basedOn` differs, it answers `{ ok: false, why: 'rank-changed',
   revision }` and writes nothing.
2. Otherwise it merges, as question 8 states:
   - it deletes the rows of slugs in `seen` that are absent from `order`;
   - it writes each `order` entry's class and date, with this act's `setAt` and `setBy`;
   - in each class band it numbers the `order` entries first, in the given order, then the kept rows, in their old
     position order.
3. It raises the revision row to `revision + 1`, with `setAt` and `setBy`, and answers `{ ok: true, revision }`.

**The live-ask port.**
- `LiveAskRead = (childId: string) => string | null | 'unmeasured'` answers the `askKey` of the ask the child's newest
  hookstate is `waiting` on, `null` when that hookstate shows no ask, and `unmeasured` when the watcher has read no
  hookstate for that child in this process.
- `FleetWatcher#liveAskKey` is its adapter, a pure read of `hookStates` through `askKey`. It stores nothing new.

**The facts read.** `portfolioFacts(db, now, terminalStatesSql, liveAsk)` reads, inside one read transaction:
- the programmes with an open run or a rank row (`programs.slug`, `title`, `createdAt`);
- their rank rows, and the revision;
- their runs, all of a listed programme's runs, with `kind` read through `isRunKind`;
- their operator items still `open` or `checking`, or closed in the window, each with its `operator_item_events`
  (`at`, `act`), oldest first;
- their asks, joined to `runs` for the programme, with a `releasedAt` in the window or still `released` or `declined`.

For each `released` or `declined` ask that is its child's newest row (`MAX(id)` per `childId`), it asks
`liveAsk(childId)`:
- the row's `askKey` answers `live: true`;
- any other key, or `null`, answers `false`;
- `unmeasured` answers `'unmeasured'`.

Every other row carries `live: null`. The 28-day listing rule and the window are `portfolioFor`'s, so the read only
bounds what it fetches. A class word that `isServiceClass` refuses is carried as `cls: null` with `clsRaw`. A throw is
not caught here: the door answers it.

- [ ] **Step 1: Measure** the ask writers in `server/src/coord/store.ts` again (`releaseAsk`, `declineAsk`, `staleAsk`,
  `takeAskForAnswer`, and the operator's answer route's `answeredBy`). If any differs from "What exists today", record
  it in the departures note before writing a test.
- [ ] **Step 2: Failing tests** (`test/portfolio-store.test.ts`, an in-memory `coord.db`):
  - a fresh database has both tables, no rank row and no revision row, and the facts read answers revision 0;
  - a write with `basedOn` 0 stores the order at revision 1, and a second with `basedOn` 1 at revision 2;
  - a write with a stale `basedOn` answers `rank-changed` with the current revision and changes no row;
  - a write that lists a programme in `seen` but not in `order` deletes its row;
  - a ranked programme absent from `seen` keeps its class, date and relative place, after the listed entries of its
    band;
  - a write that unranks every programme leaves the revision row at its next value, so a tab still holding an older
    revision is refused after any number of writes;
  - positions restart at 1 in each class band;
  - `setBy` and `setAt` are stored as given, on the rows placed and on the revision row;
  - a row whose `cls` was written as `urgent` (by hand, standing in for a newer build) reads `cls: null`, `clsRaw:
    'urgent'`;
  - the facts read lists a programme with an open run and no rank, and a ranked programme with no open run, and leaves
    out one with neither;
  - an ask on another programme's run is not in this programme's asks;
  - a newest `released` ask whose child's live key matches reads `live: true`, a mismatch `false`, an unmeasured port
    `'unmeasured'`, and an older `released` row of the same child `live: null`;
  - an item's events come back oldest first.

  In a new `test/watcher-live-ask.test.ts`: `liveAskKey` answers the key of a `waiting` hookstate's ask, `null` for a
  hookstate with no ask, and `unmeasured` for a child never read. It builds its watcher through
  `quietAtTestEnd(new FleetWatcher(...))` (`server/test/laneQuiet.ts`), as `watcher-quiet-census` requires.
- [ ] **Step 3: Run.** Red.
- [ ] **Step 4: Implement** the migration, the store file, the port type, the accessor and the delegates.
- [ ] **Step 5: Run** this suite, `test/coord-db.test.ts`, `test/run-close-switch.test.ts`,
  `test/single-definition/*.test.ts`, `test/rings/*.test.ts`, `test/ledgers-migration.test.ts`,
  `test/watcher-live-ask.test.ts`, `test/watcher-quiet-census.test.ts` and both server `tsc` runs. Green.
- [ ] **Step 6: Red check.** Each change below reds a case. Revert each.
  - Make the writer skip the `basedOn` check.
  - Make it delete a ranked row absent from `seen`.
  - Add a second `INSERT INTO portfolio_rank` in a function of `ledgersStore.ts`: `writers-map.test.ts` reds.
  - Call `setPortfolioRank` from another route file: the call census reds.
- [ ] **Step 7: Commit.** `feat(portfolio): portfolio_rank, its one writer, the live-ask port and the facts portfolioFor reads (Overlord W1)`

### Task 3: The operator's portfolio read and the rank door

**Files:**
- Modify: `server/src/coord/ledgersRoutes.ts` (`LedgerOperatorDeps` gains `liveAsk: LiveAskRead`;
  `registerLedgerOperatorRoutes` gains `GET /api/portfolio` and `POST /api/portfolio/rank`)
- Modify: `server/src/server.ts` (`MASKED_GET_ROUTES` gains `/api/portfolio`, with a comment line; the operator
  registration's deps pass the watcher's `liveAskKey`, or a reader answering `unmeasured` when no watcher runs)
- Modify: `shared/refusal.ts` (`LEDGER_ROUTE_REFUSALS` gains `rankChanged: 'rank-changed'`, with its 409 in
  `REFUSAL_STATUS`)
- Modify: `server/test/box-token-census.test.ts` (`LEDGER_OPERATOR_DOORS` gains both paths)
- Modify: `CLAUDE.md` (the box-token bullet's sentence on the programme ledgers' operator doors names both, which
  `SESSION_ONLY_ALL` checks)
- Modify: `server/test/auth-gate.test.ts`:
  - `scanRoutes('coord/ledgersRoutes.ts')` goes from 20 to 22;
  - `ROUTES.length` and the sweep's prose counts each rise by two, with the "scanned + static wildcard" comment and a
    dated comment line: the HTTP half and the gated count rise by two, and the exempt count stays;
  - `FLAG_AWARE` is unchanged (below).
- Modify: `server/src/auth/gate.ts` (its header's route count, by two, which `auth-gate.test.ts` checks)
- Create: `server/test/portfolio-routes.test.ts`

**The read.** `GET /api/portfolio`, session-gated (no box token, not EXEMPT).
1. `if (!coord)` answers `not-configured`.
2. It calls `coord.portfolioFacts(now, deps.liveAsk)`, then `portfolioFor`, and answers `{ ok: true, portfolio:
   PortfolioView }`.
3. A throw from the read answers `runs-unreadable` (503), with the error's message as `detail`.

**The rank door.** `POST /api/portfolio/rank`. It calls no account gate and works while sign-in is dark (question 4,
ruled). Its order:
1. `if (!coord)` answers `not-configured`. Dark and signed in, a bodiless request then reaches the same answers, so the
   door does not join `FLAG_AWARE`.
2. Its actor is `deps.authEnabled ? deviceActor(deps.sessionAuth(req).device) : 'flag-off'`.
3. The body's shape is `{ basedOn: number, seen: string[], order: { slug, cls, fixedDate? }[] }`. Each of these is
   `bad-request`:
   - `basedOn` that is not a non-negative safe integer;
   - `seen` or `order` longer than `RANK_ORDER_MAX`;
   - a slug twice in either list;
   - an `order` slug absent from `seen`;
   - a class that is not a `ServiceClass`;
   - `fixedDate` on a class other than `fixed-date`, or missing on `fixed-date`, or not a valid `YYYY-MM-DD` calendar
     date.
4. Every `order` slug names a `programs` row, else `not-found` with the slug.
5. `coord.setPortfolioRank({ basedOn, seen, order }, actor, deps.now())`. `rank-changed` answers 409 with the current
   revision.
6. It answers `{ ok: true, revision, portfolio }`, the new view, so the console that wrote it has the new order. It
   emits no frame: another tab sees the change at its next read and, holding an older revision, is refused until it
   reads again.

The door does no `await` between its read and its write, so the transaction's check is the whole guard.

- [ ] **Step 1: Failing tests** (`test/portfolio-routes.test.ts`, `buildServer` over an in-memory store):
  - Armed, with a fixture session:
    - the read answers the view in rank order, with an unranked programme last in `standard`;
    - the read without a session is 401, and with the box token alone it is still 401: it is the operator's read;
    - a valid order answers revision 1 and the view, with `setBy` the fixture session's device actor.
  - Dark: the rank door accepts the same order and records `setBy` `flag-off`.
  - Refusals:
    - a stale `basedOn` answers 409 `rank-changed`;
    - every shape refusal in item 3 is `bad-request`, a `basedOn` of `-1`, `1.5` or `"2"` among them;
    - an unknown slug is `not-found`.
  - Failures and masking:
    - a store whose facts read throws makes the read answer 503 `runs-unreadable`, never `{ programmes: [] }`;
    - with no live-ask reader wired, released asks count as unmeasured, never as live;
    - a programme title carrying a secret-shaped string comes back masked.
- [ ] **Step 2: Run.** Red.
- [ ] **Step 3: Implement** the two handlers, the dep, the word and the census edits.
- [ ] **Step 4: Run** this suite, `test/box-token-census.test.ts`, `test/auth-gate.test.ts`,
  `test/secret-mask.test.ts`, `test/ledgers-operator-routes.test.ts`, `test/refusal-status.test.ts`,
  `test/rings/*.test.ts` and the three `tsc` runs. Green. If `auth-gate.test.ts`' dark sweep names either door, the
  door's order differs from item 1 above: fix the order, never `FLAG_AWARE`.
- [ ] **Step 5: Red check.** Each change below reds a case. Revert each.
  - Register the rank door with a `checkMailToken` call: `box-token-census.test.ts` reds.
  - Store the gate's actor dark instead of `flag-off`: the dark case reds.
- [ ] **Step 6: Refusal table.** If the vocabulary piece's Table 11.6 test is on `main`, add `rank-changed` to its
  exception list with wave W1, in this pull request (the index's question 23). If it is not, say so in the pull
  request, so that piece measures the word.
- [ ] **Step 7: Commit.** `feat(portfolio): the operator's portfolio read and the rank door (Overlord W1)`

**PR A ends here.** Its body states:
- the rank door is an operator door in the ledger registration, works dark with actor `flag-off`, and no box-token
  route can reach it;
- question 2's ruling and its two recorded departures;
- the floors;
- that nothing changes at merge.

### Task 4: What each goals version rests on, and whether that ratifies it

**Files:**
- Modify: `server/src/coord/schema.ts` (one migration: `programs.ratifiedBy`, `programs.ratifiedAt`,
  `programs.doneWhenBy`, `programme_modifications.ratifiedBy`, `programme_modifications.ratifiedAt`)
- Modify: `shared/ledgers.ts`. Beside `GoalsView` it gains:
  - `RatifiedBy`, with its parser and printer;
  - `COORDINATOR_SOURCE_RATIFIES`, `itemAnswered`, `goalRatification` and `ratificationOf`;
  - `GoalsView`'s optional fields.
- Modify: `server/src/coord/ledgersStore.ts`:
  - `setSpecPin` and `setDoneWhen` write `doneWhenBy`, and `setSpecPin` writes the pin's source;
  - `addModification` writes the row's source;
  - `goalsFor` reads the sources and computes the verdicts, joining each cited item by the row's `itemId`.
- Modify: `server/src/coord/ledgersRoutes.ts` (the spec door passes `coordinator`; the modification door passes `item`
  when it cites an item, else `coordinator`)
- Modify: `server/src/coord/store.ts` (the `setSpecPin` and `addModification` delegates take the source, widened in
  place)
- Modify: `server/src/continuity/cardFacts.ts` (each goal's `ratified` from the view; the goals-unratified comment goes)
- Modify: `server/test/coord-db.test.ts`, `server/test/run-close-switch.test.ts` (its undo step drops the five columns)
- Modify: `server/test/single-definition/writers-map.test.ts`: a column census in the shape of its `coordinator_calls`
  case. Every `UPDATE` or `INSERT` naming `ratifiedBy`, `ratifiedAt` or `doneWhenBy` under `server/src` is in
  `ledgersStore.ts`' `setSpecPin`, `setDoneWhen`, `addModification` or `ratifyGoalsVersion`, with a planted control.
- Create: `server/test/goals-ratification.test.ts`
- Create: `server/test/sim/ratificationSets.ts`; modify `mutation-floors.test.ts` and `mutation-floors.json`
- Test: `server/test/ledgers-store.test.ts`, `server/test/ledgers-coordinator-routes.test.ts`,
  `server/test/continuity-card-facts.test.ts`, `server/test/ledgers-frame.test.ts`

**Interfaces:**

```ts
// shared/ledgers.ts, beside GoalsView
export type RatifiedBy =
  | { kind: 'coordinator' }                  // the programme's own coordinator wrote it
  | { kind: 'item' }                         // a modification that cites an item; the id is the row's itemId
  | { kind: 'operator' };                    // the operator's ratify door
// W2 adds { kind: 'request' }, with the row's requestId; the parser refuses it until then.
type RatifiedByKind = RatifiedBy['kind'];
const RATIFIED_BY_KIND_MAP: Record<RatifiedByKind, true>;
export const parseRatifiedBy: (raw: string | null) => RatifiedBy | 'unrecorded' | 'unreadable';
export const ratifiedByText: (r: RatifiedBy) => string;      // 'coordinator' | 'item' | 'operator'
/** (Question 1.) Whether a coordinator's own write ratifies. The one constant operator item 328 set: yes. */
export const COORDINATOR_SOURCE_RATIFIES = true;
/** Question 3's predicate: the operator ticked the item and it was not returned since. */
export const itemAnswered: (item: { state: string; tickedAt: number | null }) => boolean;
export type RatificationWhy = 'unrecorded' | 'unreadable' | 'source-does-not-ratify' | 'effect-unmeasured'
  | 'item-not-answered' | 'absent';
export type Ratification =
  | { ratified: true; source: RatifiedBy }
  | { ratified: false; why: RatificationWhy; source: RatifiedBy | null };
/** Pure, a switch over the source's kind with an exhaustive default. `item` is the cited item as the store read it,
 *  or null when the row cites no item of this programme. */
export function goalRatification(source: RatifiedBy | 'unrecorded' | 'unreadable',
  item: { program: string; state: string; tickedAt: number | null } | null, program: string): Ratification;
// GoalsView gains, all optional (absent from an older server):
//   pinRatification?: Ratification;   doneWhenRatification?: Ratification;
//   modifications[i].ratification?: Ratification;
/** The one reader of the optional fields: an absent one is { ratified: false, why: 'absent', source: null }. */
export const ratificationOf: (r: Ratification | undefined) => Ratification;
```

`goalRatification`'s cases:
- **`unrecorded` and `unreadable`** answer themselves, not ratified.
- **`coordinator`** (question 1): ratified when `COORDINATOR_SOURCE_RATIFIES`, which is `true`, else
  `source-does-not-ratify`.
- **`item`:**
  - a cited item that is missing or of another programme answers `unreadable`;
  - one `itemAnswered` refuses answers `item-not-answered`;
  - one it accepts answers `effect-unmeasured` in W1 (question 3). W3 replaces this arm with the effect check.
- **`operator`:** ratified.

**The writes.**
- `setSpecPin` gains a `source: RatifiedBy` argument. It writes `ratifiedBy` and `ratifiedAt = now` with the pin's text,
  so a re-pin replaces the pin's source with its own: new text is never ratified by an older act. When it writes
  `doneWhen` it writes `doneWhenBy = 'pin'`.
- `setDoneWhen` gains the modification id and writes `doneWhenBy = 'mod:<id>'` in the same statement as `doneWhen`.
- `addModification` gains `source` and writes it on the row.
- `goalsFor` reads the pin's and each row's source, and joins the cited item by `itemId`. It answers the pin's verdict,
  each modification's verdict, and the definition of done's verdict:
  - `doneWhenBy = 'pin'` takes the pin's;
  - `mod:<id>` takes that row's;
  - NULL answers `unrecorded`, and unreadable text answers `unreadable`.
- Rows from before the migration hold NULL and read `unrecorded`. Nothing is back-filled: a source nobody recorded is
  not guessed.

**The card.** `cardFacts.ts` takes the In short goal's `ratified` from `pinRatification` and each definition-of-done
line's from `doneWhenRatification`, through `ratificationOf`. A version the programme's own coordinator wrote renders
as ratified, outside the untrusted block, with "ratified by the coordinator" beside it (question 1). A version that
rests on an item, an older row and an absent field still render as not ratified, inside the untrusted block, as today.

- [ ] **Step 1: Failing tests** (`test/goals-ratification.test.ts` for the deciders, `test/ledgers-store.test.ts` and
  `test/ledgers-coordinator-routes.test.ts` for the writes, `test/continuity-card-facts.test.ts` for the card):
  - **The parser** reads each spelling back from the printer. It reads NULL as `unrecorded`, and `item:3`, `request`
    and `Operator` as `unreadable`.
  - **`itemAnswered`, one row per item state:**
    - `open`, never ticked: no;
    - `checking` after a tick: yes;
    - `done` by confirm after a tick: yes;
    - `done` by settle from `checking`: yes;
    - `done` by settle from `open`, no `tickedAt`: no;
    - `done` by `act`, no `tickedAt`: no;
    - `open` after a return, old `tickedAt` kept: no;
    - `withdrawn`: no;
    - `dismissed`: no.
  - **The item arm.** An item of another programme and a missing item read `unreadable`. A returned item reads
    `item-not-answered`. A ticked item reads `effect-unmeasured`, never ratified.
  - **(Question 1)** A coordinator's pin reads `{ ratified: true, source: { kind: 'coordinator' } }`.
  - **(Question 1)** A re-pin after an operator ratification reads ratified again, with the source `coordinator`,
    never `operator`: new text is never ratified by an older act.
  - **The definition of done.** A modification that carries a new definition of done moves its verdict to that row's.
  - **Older rows and older servers.** A row written before the migration (inserted with NULL) reads `unrecorded`.
    `ratificationOf(undefined)` reads `absent`.
  - **The wire.** The goals read and the waiting frame carry the new fields.
  - **(Question 1) The card** renders a goal as ratified only when its verdict is ratified: a coordinator's pin
    outside the untrusted block with "ratified by the coordinator", an item-sourced version inside it.
  - **The column census** sees a planted fifth writer and reds.
- [ ] **Step 2: Run.** Red.
- [ ] **Step 3: Implement.** **(Question 1.)** `COORDINATOR_SOURCE_RATIFIES` is `true`, as operator item 328 answered.
  The three cases tagged "(question 1)" above and Task 5's tagged words are written for that answer, and the floors
  are measured with it (Step 5).
- [ ] **Step 4: Run** these suites, `test/continuity-card-render.test.ts`, `test/ledgers-frame.test.ts`,
  `test/coord-db.test.ts`, `test/run-close-switch.test.ts`, `test/rings/*.test.ts`, `test/single-definition/*.test.ts`
  and the three `tsc` runs. Green.
- [ ] **Step 5: Mutation sets.** `server/test/sim/ratificationSets.ts`: one set for `goalRatification`, one for
  `itemAnswered`, with floors recorded. Red check, each reverted:
  - let the `item` arm answer ratified on a ticked item;
  - read `unreadable` as `operator`;
  - let `itemAnswered` accept an `open` item with a `tickedAt`;
  - (question 1) make the `coordinator` case ignore the constant and answer `source-does-not-ratify`: the
    coordinator's pin case reds.

  A re-pin that keeps the old source is not a mutant of a decider. It is caught by the re-pin case above, which runs in
  the full suite.
- [ ] **Step 6: Commit.** `feat(goals): every goals version records what it rests on, and one decider says whether that ratifies it (Overlord W1)`

### Task 5: The operator's ratify door and its control

**Files:**
- Modify: `server/src/coord/ledgersStore.ts` (`ratifyGoalsVersion`, the operator's arm of the columns' writers)
- Modify: `server/src/coord/store.ts` (its delegate)
- Modify: `server/src/coord/ledgersRoutes.ts` (`registerLedgerOperatorRoutes`: `POST /api/programmes/:slug/goals/ratify`)
- Modify: `shared/refusal.ts` (`LEDGER_ROUTE_REFUSALS` gains `goalsChanged: 'goals-changed'`, 409)
- Modify: `server/test/box-token-census.test.ts` (`LEDGER_OPERATOR_DOORS`), `CLAUDE.md` (the same bullet)
- Modify: `server/test/auth-gate.test.ts` (22 to 23, `ROUTES.length`, the sweep's prose counts and comments, by one)
  and `server/src/auth/gate.ts`' header count. `FLAG_AWARE` is unchanged (below).
- Modify: `pwa/src/lib/api.ts` (`ratifyGoals`, which reads a 404 as "not available on this server")
- Modify: `pwa/src/ledgers/GoalsPanel.tsx`. It stays props only: the verdict's words, and an optional `onRatify`
  callback prop, which renders a "Ratify" button on each unratified version when given.
- Modify: `pwa/src/ledgers/ProgrammeScreen.tsx`. `GoalsCard` passes `onRatify`. That calls `ratifyGoals` with the
  stamp the panel rendered, then makes `useGoalsRead` read again. On `goals-changed` the screen shows the notice and
  reads again. On "not available" it hides the button.
- Modify: `pwa/src/ledgers/ledgerWords.ts` (the words)
- Test: `server/test/goals-ratify-route.test.ts` (new), `pwa/test/goals-panel.test.tsx`,
  `pwa/test/programme-screen.test.tsx`, `pwa/test/ledger-words.test.ts`

**The door.** Its order:
1. `deps.gate(req, reply, { cap: null })`. It refuses `auth-off` while sign-in is dark (question 4, ruled), and a pass
   carries the actor.
2. `if (!coord)` answers `not-configured`. Dark, both answers are 501, so the door does not join `FLAG_AWARE`.
3. The body is `{ pin: { inShortAt: number } }` or `{ modification: number }`, else `bad-request`.
4. Inside one transaction (`ratifyGoalsVersion`):
   - a programme with no pin, or a modification id that is not this programme's, is `not-found`;
   - a pin whose `inShortAt` differs from the body's is `goals-changed`, with the stored stamp;
   - a version whose verdict already reads ratified answers `{ ok: true, changed: false }` and writes nothing. That
     tests the verdict through `goalRatification`, not the source;
   - otherwise it writes `ratifiedBy = 'operator'` and `ratifiedAt = now`.
5. On a change it emits the waiting frame (`deps.bus.emit('waiting')`, as the tick door does), so the Goals panel and
   the waiting list update. It answers `{ ok: true, changed, goals }`.

The coordinator is not mailed. A coordinator reads the verdict through its goals read (`ccrc-api goals show`), as it
reads every other goals change.

**The words.** The panel shows each version's verdict in words the operator reads without the plan:
- "Ratified by you";
- "Ratified by the coordinator" (question 1);
- "Not ratified: rests on item N's answer, which does not ratify goals yet";
- "Not ratified: item N has not been answered";
- "Not recorded", for a row older than this feature or from an older server.

An unratified pin or modification gets the "Ratify" button when the screen passes `onRatify`. A `goals-changed` answer
reloads the goals and says they changed since they were shown.

- [ ] **Step 1: Failing tests.** In `test/goals-ratify-route.test.ts` (`buildServer` with auth armed):
  - sign-in dark answers `auth-off`;
  - a valid pin ratification flips the goals read's verdict to ratified, with `operator`;
  - a stale `inShortAt` answers 409 `goals-changed` and writes nothing;
  - a second call answers `changed: false`;
  - another programme's modification id is `not-found`;
  - the box token alone is 401;
  - the frame is emitted once on a change and not on `changed: false`.

  In `pwa/test/goals-panel.test.tsx`: each verdict's words render, the question 1 word tagged as such; no button
  renders without `onRatify`; with it, the button calls it with the rendered stamp; a coordinator-written version
  shows "Ratified by the coordinator" and no button (question 1).

  In `pwa/test/programme-screen.test.tsx`: a ratify reads the goals again; a 409 reloads and shows the notice; a 404
  hides the button and says the server does not offer it.
- [ ] **Step 2: Run.** Red.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** these suites, `test/box-token-census.test.ts`, `test/auth-gate.test.ts`,
  `test/ledgers-operator-routes.test.ts`, `test/refusal-status.test.ts`, `test/rings/*.test.ts`, pwa's ledgers tests,
  and the three `tsc` runs. Green.
- [ ] **Step 5: Red check.** Each change below reds a case. Revert each.
  - Let the door skip the stamp check: the stale case reds.
  - Let its no-op test the source instead of the verdict: a case with an operator source over a re-pinned text reds.
- [ ] **Step 6: Refusal table.** `goals-changed` joins the vocabulary piece's Table 11.6 exception list, as in Task 3,
  Step 6.
- [ ] **Step 7: Commit.** `feat(goals): the operator's ratify door and the Ratify control (Overlord W1)`

**PR B ends here.** Its body states:
- question 1's answer as the operator gave it (item 328: "A coordinator's pin counts, shown as ratified by the
  coordinator"), and the constant it set, `true`;
- that an item answer does not ratify until W3 (question 3);
- that the ratify door refuses dark;
- what renders differently at merge: a version the programme's own coordinator writes from then on renders as
  ratified by the coordinator (question 1).

## Deviations found

These are the departures from the spec's text, and from the index, that this plan makes, by slug. The coordinator mints
the numbers.

- **`rank-door-ships-with-its-table`**: the index puts the rank door in PR B, after designation A. It ships in PR A,
  beside the table it writes, in the ledgers' operator registration. Two further departures follow (question 2, ruled):
  - from Table 11.1e's caption, which places each context's Overlord doors in that context's routes file;
  - from question 17's port half: it records the session's device actor until gates A adopts the port.
- **`item-ratifies-with-its-effect`**: §3.8 lists an item answer as a source. In W1 it is recorded and reads not
  ratified, because §6.3's effect check arrives in W3 (question 3).
- **`operator-ratify-door`**: §3.8 names "the operator's door" without one. It is `POST
  /api/programmes/:slug/goals/ratify`, with the version's stamp, refusing while sign-in is dark (question 4).
- **`rank-works-dark`**: the rank door confers no authority, so it calls no account gate and records `flag-off` while
  sign-in is dark, as the `lane-arm` and `run-close` switches do (question 4, ruled).
- **`done-when-names-its-version`**: a column `programs.doneWhenBy` records which version wrote the current definition
  of done (question 5).
- **`ratified-at-beside-ratified-by`**: each source carries the time it was recorded, `ratifiedAt`, which Table 11.1a
  does not list.
- **`verdict-computed-not-stored`**: `ratifiedBy` stores the source, and `goalRatification` decides at every read, so
  a later wave's rule judges the rows an earlier wave wrote again (questions 1 and 3).
- **`rank-orders-within-class-bands`**: the rank is ordered by class band, then by position inside the band (question
  6).
- **`portfolio-lists-live-programmes`**: the portfolio lists programmes with an open run, and ranked ones that closed a
  run in 28 days (question 7).
- **`rank-write-merges`**: a rank write deletes only the slugs the console listed and dropped, so a programme the
  console did not show keeps its place (question 8, ruled).
- **`rank-revision-row`**: a one-row `portfolio_rank_revision` table holds a counter that only rises, which Table
  11.1a does not list (question 8).
- **`stale-write-words`**: two new refusal words, `rank-changed` and `goals-changed`, that Table 11.6 lacks (question
  8).
- **`ledger-words-before-the-vocabulary-group`**: both words go into `LEDGER_ROUTE_REFUSALS`, the doors' own family,
  rather than the vocabulary piece's W1 group, which is not on `main` (question 8).
- **`portfolio-read-door`**: a session-gated `GET /api/portfolio`, which Table 11.1e does not list (question 9).
- **`operator-wait-from-items-and-asks`**: "hours waiting on the operator" is items and asks, summed as programme-time
  over 28 days. It counts only spans that truly waited on the operator, and an end no live signal shows is unmeasured
  (question 10, ruled).
- **`declined-ask-waits-from-its-decline`**: the ruling says a declined ask "counts up to its decline". The code moves
  only `held` to `declined` and fires the push there, so a declined ask waits from its decline, bounded by the same
  live signal as a released one (question 10).
- **`live-ask-port`**: the live signal for an open ask is the watcher's newest hookstate, reached through an L2 port
  and a read-only watcher accessor (Task 2).
- **`wave-rule-moves-to-shared`**: `programmesRead.ts`' wave rule and never-started detail move to
  `shared/programmes.ts`, behind two new characterization cases, so both readers use one rule (Task 1).
- **`hold-rule-moves-to-shared`**: `operatorWasShown`'s rule moves to `shared/ledgers.ts` as `operatorShownAt`, behind
  a new characterization test, so the waiting list and the portfolio agree on when the operator was shown an item
  (Task 1).

## Where things stand

**Agreed:**
- From the brief and the index:
  - lane P, two pull requests, PR A ready to build now (question 36);
  - the shape of the merged piece plans;
  - `ratifiedBy` built on question 24's answer.
- From the operator, item 328 (2026-11-16): a coordinator's pin counts, shown as ratified by the coordinator
  (question 1, the index's question 24). PR B builds that answer.
- From fix round 1 (review 2105, ruled):
  - waits count only what truly waited on the operator (F1);
  - an explicit `coordinator` case, with every dependent site tagged (F3);
  - ratify refuses dark, and rank works dark with `flag-off` (F4b);
  - the rank door stays in `ledgersRoutes.ts`, with both departures recorded (F5);
  - a rank write merges (F9).
  - Every other finding (F2, F4, F6 to F8, F10 to F14) was applied as the report directed.

**Waiting on the operator:** nothing. Question 1 was answered by item 328.

**Waiting on the coordinator:**
- Questions 3, 5 to 7, 9 and 10's unruled parts stand as recommendations.
- The declined-ask reading in question 10 corrects the ruling's premise and needs its confirmation.
- Question 2's index changes are listed under "Index changes".

**Needs before it starts:** PR A needs nothing beyond `main`. PR B needs PR A.

**What depends on it:**
- home B: the strip and its rank control, from PR A;
- board and history B: the Portfolio part from PR A (with the live-ask port), and the Goals part's `ratifiedBy` from
  PR B;
- W2: health, dates, edges and spend, which join `portfolioFor`;
- W3: the item arm's effect check, which replaces one decider case;
- W5: `portfolioFocus`;
- W6: scarcity admission and the weekly packet.

**Later:**
- The relay's priority from the rank (W2).
- The `request` source of `ratifiedBy`, with the "Changed that matters" rule (W2, §4.1).
- The rank as the first sort key where work waits (W6).
- The open follow-up that leaves a `released` ask `released` after its dialog clears. Once it moves such rows on, the
  live signal is still needed for a row read before the move.
