# Overlord W1: portfolio and goals, the operator's rank and goals that say who ratified them Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the operator ranks the programmes, and the server measures how each is going. `portfolio_rank` holds the
operator's order, written by one session-gated operator door. `portfolioFor`, an L1 reader that stores nothing, answers
per programme, in rank order, what W1's rows can measure: work in progress, waves closed in 7 and 28 days, wave cycle
time (median and 85th percentile), the age of the oldest open wave, review rounds per wave, how waves ended, hours
waiting on the operator, and what blocks the programme. Every goals version (the spec pin and each modification) records
what it rests on in `ratifiedBy`, and one L1 decider says whether that source ratifies it. In W1 only the operator's act
does.

**Why:** H38 (§5.6): the order between programmes is the operator's fact, and every measure is the server's. Nothing a
model or a session writes ever sets a priority or a date. §3.8: goals carry authority only when the operator ratified
them. Today every goal reads as not ratified, because no version records where it came from
(`server/src/continuity/cardFacts.ts`, slug goals-unratified). W1's board and home read both, and W3's answers need
ratified goals as their only goal evidence.

**Architecture:** two pull requests in lane P.

- **PR A, the rank and the measures (Tasks 1 to 3), ready to build.** `shared/portfolio.ts` (L0) holds the class of
  service and the wire. `server/src/coord/portfolio.ts` (C5, L1) holds `portfolioOrder` and `portfolioFor`, pure.
  `server/src/coord/portfolioStore.ts` (C5, L3) holds the table's one writer and the facts read. The operator's two
  doors, the read and the rank, join `registerLedgerOperatorRoutes` in `server/src/coord/ledgersRoutes.ts`.
- **PR B, who ratified the goals (Tasks 4 and 5), after PR A and operator item 328.** `ratifiedBy` and `ratifiedAt` on
  the pin and on each modification, and `doneWhenBy` naming the version that wrote the current definition of done. One
  decider in `shared/ledgers.ts`, `goalRatification`, reads them. The operator's ratify door joins the same
  registration, with its control in the console's Goals panel.

**Tech Stack:** TypeScript (ESM), `node:sqlite`, Fastify, React (one control), vitest. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-09-overlord-design.md`:

- §5.6, H38: `portfolio_rank`'s row and its one writer; "a programme with no rank row reads as the bottom of
  `standard`"; `portfolioFor`'s measures; "the rank and `portfolioFor` ship in W1, answering what W1's rows measure";
  Table 5.6a, the classes of service.
- §3.8: "Goals carry authority only when the operator ratified them … `ratifiedBy`: an item answer, a request, the
  operator's door, or `coordinator`"; and C19's `goals modify` paragraph (§6.3), the reference an item answer must meet.
- Table 11.1a, rows `portfolio_rank` and "`ratifiedBy` on each goals version"; Table 11.1b, the row "`portfolioFor`;
  `homePlace`"; Table 11.1e's row "The rank door".
- §3.5's board part "Portfolio" and part "Goals"; Table 4a, row 4 (the portfolio strip, W1: the rank).
- Table 13.1, row H38 (`shape`, waves W1, W2, W5 and W6): a shape call ships with the piece that creates its table or
  door. Table 14, row W1: "the portfolio rank … and `portfolioFor`", and "`ratifiedBy` on goals".

The index is `docs/superpowers/plans/2026-11-14-overlord-w1.md` (#2814): its row "Portfolio and goals" (lane P, two
pull requests), its question 24 (operator item 328), question 36 (portfolio PR A is ready now) and question 17 (the
operator's doors keep the account gate), and its "Where lanes meet" bullets for `ledgersStore.ts` and
`ledgersRoutes.ts`.

## Open questions

The index's questions this plan builds on come first. Each other question is one the spec leaves open or the tree
contradicts. The plan builds every recommendation unless the coordinator or the operator rules otherwise.

1. **Does a coordinator's own pin count as ratified?** (The index's question 24, operator item 328, unanswered.)
   **Recommendation, built here:** no. Only the operator's own act ratifies. Every write records its source, so a
   coordinator's pin records `coordinator`, and the decider's `coordinator` row answers "not ratified". **If the operator
   answers yes,** one row of `RATIFYING_SOURCES` changes (Task 4, Step 3, marked) together with its test. No column, door
   or writer changes, and PR B's other work is the same either way. So PR B can be built now and merged once the item is
   answered.
2. **The rank door ships in PR A, beside its table** (slug `rank-door-ships-with-its-table`). The index puts the rank
   door in PR B, which also waits for designation A. **Recommendation:** PR A ships the table and its one writer
   together. H38 is a `shape` call, so the table and its door ship in one piece. A table with no writer would also
   stand in `writers-map.test.ts` with an empty writer list. The door is an operator door, reached through the
   programme ledgers' operator registration, never an Overlord route, so it needs nothing from designation A, and
   neither does PR B. PR B then needs PR A and item 328 only. If the coordinator rules otherwise, Task 3 moves to PR B
   whole, with no other change.
3. **An item answer ratifies only from W3** (slug `item-ratifies-with-its-effect`). §6.3 lets a version rest on "an item
   of this programme that the operator answered and whose effect names this change". Effects arrive in W3 (§6.7), and a
   W1 item records only an answer in free text, which no code can match to a change. **Recommendation:** W1 records the
   source `item:<id>` and reads it as not ratified, with the reason `effect-unmeasured`. W3 adds the effect check to the
   same decider row, and every row W1 wrote is judged again then, because the verdict is computed at read time, never
   stored. In W1 only the operator's ratify door ratifies.
4. **The operator's door that ratifies** (slug `operator-ratify-door`). §3.8 lists "the operator's door" as a source and
   Table 11.1a names "the operator's answer that ratifies", but no door is specified. **Recommendation:** `POST
   /api/programmes/:slug/goals/ratify`, session-gated behind the account gate (`auth-off` while sign-in is dark, as
   question 17 says of every operator door), naming the version with its stamp: the pin's `inShortAt`, or a modification
   id. A pin that changed since the operator read it is refused `goals-changed`, so the operator never ratifies text
   they were not shown. Its control is a "Ratify" button on the console's Goals panel (Task 5).
5. **Which version wrote the current definition of done** (slug `done-when-names-its-version`). The pin's `doneWhen`
   can be replaced later by a modification (`ledgersStore.ts#setDoneWhen`), and nothing records which one did.
   **Recommendation:** a column `programs.doneWhenBy`, `pin` or `mod:<id>`, written in the same statements that write
   `doneWhen`. NULL is a list written before the column, read as `unrecorded`, so not ratified. No second copy of the
   list.
6. **Class bands order the rank** (slug `rank-orders-within-class-bands`). §5.6 says an unranked programme reads as
   "the bottom of `standard`", which needs `standard` to be a place in the order, not only a label. **Recommendation:**
   the order is the classes in Table 5.6a's order (`expedite`, `fixed-date`, `standard`, `background`), then the
   position inside each class. Unranked programmes sit at the end of `standard`, oldest `createdAt` first, then by slug.
7. **Which programmes the portfolio lists** (slug `portfolio-lists-live-programmes`). §5.6 says "per programme".
   **Recommendation:** a programme with an open run of any kind, and a ranked programme that closed a run in the last
   28 days. A rank row outlives its programme's last wave harmlessly: it is still stored, and the next whole-order write
   drops it.
8. **A stale write** (slugs `rank-revision-column`, `stale-write-words`). Two console tabs can each send an order.
   **Recommendation:** `portfolio_rank` carries a `revision`, the same on every row of one write and one more than the
   last. The read answers it, and a rank write that names an older `basedOn` is refused `rank-changed` (409). The ratify
   door refuses a changed pin `goals-changed` (409). Both are new words (Task 3 and Task 5).
9. **The console needs a read** (slug `portfolio-read-door`). The board composes `portfolioFor` in process, but the home's
   portfolio strip (Table 4a, home B) and the rank control need a read. **Recommendation:** `GET /api/portfolio`,
   session-gated, answering the rank revision and `portfolioFor`'s answer. It carries programme and item titles that
   sessions wrote, so it joins `MASKED_GET_ROUTES`.
10. **Hours waiting on the operator** (slug `operator-wait-from-items-and-asks`). **Recommendation:** over the last 28
    days, the time each of the programme's operator items waited from the moment the operator was shown it
    (`ledgersStore.ts#operatorWasShown`'s rule) to its tick or close, plus the time each ask on one of its runs waited
    for the operator. An ask waits from its `releasedAt` (the push fired, on `released` or `declined`) to its
    `answeredAt`, or up to now while it is still `released` or `declined`. A `stale` ask is left out: its `releasedAt`
    is when it went away, so its wait cannot be measured, and the entry counts it in `asksUnmeasured` rather than as
    zero. Open items count up to now. Intervals are clipped to the window and summed, never merged, so two items
    waiting at once count twice: programme-hours, as M30 measures them.

## What exists today

Measured on `main` at `2d5d4d4ef` (2026-11-15).

- **No portfolio.** `git grep -i portfolio` finds nothing under `server/src`, `shared`, `pwa/src`, `agent/src` or `ccd`.
- **The goals.** The pin is four columns on `programs`: `specPath`, `inShort` and `inShortAt` (migration 37) and
  `doneWhen` (migration 53, D-8126). The modifications are `programme_modifications` (migration 37): `program`, `at`,
  `text`, `ruling`, `itemId`, `pr`, `mergedAt`. All of their SQL is in `server/src/coord/ledgersStore.ts`:
  - writers `setSpecPin`, `setDoneWhen` (called by `addModification` in one transaction), `addModification` and
    `markModificationsMerged`;
  - the reader `goalsFor`, answering `shared/ledgers.ts#GoalsView` with the stored list read back through
    `storedDoneWhen`.

  `CoordStore` keeps a one-line delegate for each (`server/src/coord/store.ts`).
- **The goals doors** (`server/src/coord/ledgersRoutes.ts`):
  - `registerLedgerCoordinatorRoutes` holds `POST /api/programmes/:slug/spec`, `…/modifications` and
    `…/modifications/merged`: box-token lanes with attribution and `claimsProgramme`, in the order the file's header
    states;
  - `registerLedgerOperatorRoutes` holds `GET /api/programmes/:slug/goals`, a session or the box token (D-8126's A2),
    answering `goalsReadOf`;
  - the waiting frame and `GET /api/waiting` carry every pinned programme's `GoalsView` (`waitingViewOf`).
- **No `ratifiedBy` anywhere.** `server/src/continuity/cardFacts.ts` builds each programme's goals as
  `[inShort, ...doneWhen]`, every one `ratified: false`, under the comment that names the slug goals-unratified.
- **The runs `portfolioFor` reads.** `runs` has `program`, `wave`, `kind` (`work`, `review` or `unknown`;
  `shared/api.ts#RunKind`), `reviews` (the work run a review run reads), `state`, `openedAt`, `dispatchedAt`,
  `closedAt` and `closeDetail`. `TERMINAL_RUN_STATES` is `done` and `failed`.
- **The programme reader already on `main`.** `server/src/coord/programmesRead.ts#readProgrammes` serves `GET
  /api/programmes` from one aggregate statement over the `RunsDb` port (`server/src/coord/runsPage.ts#RunsDb`). It
  folds the waves with `shared/programmes.ts#WAVE_BUCKET` and `#programmeCurrentWave`. Two of its rules are private to
  it: which work run stands for a wave (`wavesOf`: the newest open one, else the newest) and the never-started close
  detail (`NEVER_STARTED_DETAIL`, `abandon:never-started`).
- **Items and asks.** `operator_items` has `program`, `neededBy` (`blocking`, `soon` or `later`), `raisedAt`,
  `heldUntil`, `tickedAt`, `closedAt` and `state`. `ledgersStore.ts#operatorWasShown` says when the operator was shown
  one. `asks` has `runId`, `state` (`shared/api.ts#AskState`), `releasedAt`, `answeredBy` and `answeredAt`.
- **A percentile.** `server/src/perf/stats.ts#percentile` (context K, L1) is nearest-rank and answers 0 for an empty
  series.
- **The operator's doors.** `registerLedgerOperatorRoutes` takes `deps.gate`, the account gate
  (`server/src/accounts/gate.ts#createAccountGate`). It refuses `auth-off` while sign-in is dark, and a pass carries the
  actor (`server/src/accounts/audit.ts#AccountActor`, stored as `<label> <8 hex>`). Their census is
  `LEDGER_OPERATOR_DOORS` in `server/test/box-token-census.test.ts`, checked against the file in both directions and,
  through `SESSION_ONLY_ALL`, against `CLAUDE.md`'s box-token bullet. `server/test/auth-gate.test.ts` counts
  `scanRoutes('coord/ledgersRoutes.ts')` at 20, beside the whole surface's counts.
- **The store.** `server/src/coord/schema.ts` holds 73 migrations (`COORD_SCHEMA_VERSION`, pinned at 73 by
  `server/test/coord-db.test.ts`). `server/test/run-close-switch.test.ts` drops every migration from 55 by hand.
- **Refusal words.** `shared/refusal.ts#LEDGER_ROUTE_REFUSALS` holds the ledger doors' words. `runs-unreadable` (503) is
  the word `GET /api/programmes` answers when its statement throws.

## Global Constraints

- **Architecture (`CLAUDE.md`).**
  - `shared/portfolio.ts` is L0: it imports nothing but `./api.js` and `./programmes.js` types. Each literal union
    carries its `Record<X, true>` map (`rings/wire-totality.test.ts`).
  - `server/src/coord/portfolio.ts` is L1: pure, no `fs`, no store, no clock. It imports `shared/` and
    `server/src/perf/stats.ts` (K) only. `now` is an argument.
  - `server/src/coord/portfolioStore.ts` is L3: SQL only, every function synchronous over the store's database. It keeps
    every distinction it reads (below).
  - The doors are L4 and decide nothing. The order is `portfolioOrder`'s, the measures are `portfolioFor`'s, and the
    verdict is `goalRatification`'s.
  - No repository and no async wrapper over `CoordStore`. `CoordStore` gains one-line delegates only.
- **One writer each.**
  - `portfolio_rank`: `portfolioStore.ts#setPortfolioRank`, called only by the rank door.
  - The ratification columns: on `programs`, `setSpecPin` (a re-pin records its own source) and the new
    `ratifyGoalsVersion`; on `programme_modifications`, `addModification` (at insert) and `ratifyGoalsVersion`. These are
    the writers Table 11.1a names: "the goals doors, and the operator's answer that ratifies".
  - `doneWhenBy` is written only in the statements that write `doneWhen` (`setSpecPin`, `setDoneWhen`).
  - The verdict is never stored. `goalRatification` computes it at every read.
- **Consolidate, don't duplicate.** `portfolioFor` reuses `WAVE_BUCKET` and `countsAsWave` (`shared/programmes.ts`),
  `percentile` (`perf/stats.ts`, called only on a non-empty series) and `operatorWasShown`. `programmesRead.ts`'s
  private wave rule and never-started detail move to `shared/programmes.ts`, a move behind `programmes-read.test.ts`
  (Task 1), so the two readers cannot disagree on what a wave is.
- **Failure contracts. An unread fact never reads as zero.**
  - The facts read is one synchronous read of `coord.db`. A throw is the read door's `runs-unreadable` (503), as for
    `GET /api/programmes`, never an empty portfolio.
  - A run state outside `RUN_STATES` buckets as `working`, as `WAVE_BUCKET`'s readers do.
  - A class word outside the vocabulary, read from a row an older or newer build wrote, reads as unranked (`standard`),
    and the entry carries `rankUnreadable: true`, never a silent rank.
  - A measure with no data answers `null` with `n: 0`, never 0.
  - A `ratifiedBy` text the parser cannot read answers `unreadable`, and NULL answers `unrecorded`. Both are "not
    ratified", told apart on the wire. Absent fields from an older server are read by one reader each (below) as "not
    ratified".
- **Wire: additive.** `GoalsView` gains optional fields, so an older console ignores them. `FLEET_PROTO` is not bumped.
  An older server has no portfolio doors, so the console reads their 404 as "no route" (home B's concern, stated in the
  index's changes).
- **What a merge arms.** Nothing a running session sees or does changes.
  - PR A: no rank row exists until the operator writes one, and no W1 reader but the board and the home reads the rank.
    The relay's priority (W2) and the order where work waits (W6) come later.
  - PR B: no version is ratified until the operator ratifies one, so the card and every goals read render as today,
    with the source shown beside each goal.
- **SAFETY (`CLAUDE.md`).** No ccd verb, no fleet act and no live `~/.ccrc`. Tests build `coord.db` in memory or in a
  fixture directory under the per-run temp root.
- **Tests.** Run from `server/` as `ccrc test -- ./node_modules/.bin/vitest run test/<file>.test.ts`, and from `pwa/`
  the same way for Task 5's control. Each task's last run adds both server `tsc` runs (`ccrc test -- npx tsc --noEmit -p
  tsconfig.json` and `-p test/tsconfig.tests.json`) and pwa's `tsc`, because `shared/` changes.
- **Growth check.** Every growth-checked file stays within 40 net lines in each pull request, with no waiver (the PR
  split below has the estimates). No touched file has a cap.
- **Mutation floors.** `portfolioOrder`, `portfolioFor` and `goalRatification` each join `MUTANT_SETS`
  (`server/test/sim/mutation-floors.test.ts`) and `server/test/sim/mutation-floors.json` in the pull request that
  creates them.
- **Censuses** are named in each task. Every guard ships with the test that goes red without it.
- **Public repository.** No private names: fixtures use `prog-a`, `prog-b`, `lane-a-project-a` and the actor label
  `op-a`. Cite by symbol or `@anchor`. No D-number is invented: departures are slugs under "Deviations found", and the
  coordinator mints numbers.

## Review Focus

1. **The order is the operator's and nothing else writes it.** One writer, behind the account gate. No box-token route
   and no session path reach it (the census proves it in both directions). An unranked programme reads as the bottom of
   `standard`, and the server writes no row.
2. **Every measure is honest about what it did not see.** No measure folds "no data" into 0. An unreadable row is
   reported, never dropped, and a store failure is a refusal, never an empty answer.
3. **Ratification is computed, never asserted.** A version records only what it rests on. Only the operator's act reads
   as ratified in W1. An item reads "not ratified" until W3's effect check exists. A changed pin cannot be ratified
   blind.
4. **One wave rule.** `portfolioFor` and `GET /api/programmes` agree on what a wave is and how it ended, through one
   shared function.

## The PR split

| PR | Tasks | What it ships | Needs first | Growth-checked files, estimate (net lines) |
|---|---|---|---|---|
| A | 1 to 3 | The class vocabulary and the wire; the shared wave rule; `portfolioOrder` and `portfolioFor`; `portfolio_rank` and its writer; the facts read; `GET /api/portfolio` and `POST /api/portfolio/rank` | nothing: **ready to build** | `schema.ts` +24 (one migration with its comment); `store.ts` +4 (three delegates, one import); `server.ts` +2 (`MASKED_GET_ROUTES`) |
| B | 4 and 5 | The ratification columns and their writers; `goalRatification`; `GoalsView`'s sources and verdicts; the card's goals read; the ratify door; the Goals panel's Ratify control | PR A, and operator item 328 answered (question 1) | `schema.ts` +18 (one migration); `store.ts` +3 (one delegate, one widened signature); `pwa/src/lib/api.ts` +6 (one call); `shared/api.ts` 0 |

Each pull request merges `main` once before merge and re-measures its migration slot (the index's "Where lanes meet").
For scale, the files that are not growth-checked change by about: `shared/portfolio.ts` +110 new;
`server/src/coord/portfolio.ts` +190 new; `server/src/coord/portfolioStore.ts` +150 new; `ledgersRoutes.ts` +70 in
PR A and +45 in PR B; `ledgersStore.ts` +60 in PR B; `shared/ledgers.ts` +70 in PR B; `programmesRead.ts` −15 and
`shared/programmes.ts` +25 in PR A.

## Index changes

The index (#2814) should carry these. The coordinator passes them to the index's own fix round.

- The "Portfolio and goals" row: "A: the class vocabulary, `portfolio_rank` with its rank door and the operator's
  portfolio read, and `portfolioFor` (W1's rows). B: `ratifiedBy` on the pin and on `programme_modifications`, the
  decider, and the operator's ratify door with its Goals-panel control (question 24)". "Needs first": "A: nothing. B:
  PR A, and the operator's answer to question 24 (waits on item)". Designation A comes off it (question 2).
- Figure W1: the edge from "designation A" to "portfolio B" is removed.
- Home B and the board need **portfolio A** for the rank and the measures. The board's Goals part, "with each version's
  `ratifiedBy`" (§3.5), still needs **portfolio B**. So home B's "needs first" names portfolio A, and board and history
  B's names portfolio B, for the Goals part, as today.
- Home B draws the strip **and the rank control** (the strip's reorder, which writes through `POST
  /api/portfolio/rank`), and reads a 404 from an older server as "no portfolio yet". No other lane owns that control
  today.
- Lane P's file list: `shared/portfolio.ts`, `server/src/coord/portfolio.ts` and `portfolioStore.ts`, the two doors in
  `ledgersRoutes.ts`' operator registration (not `overlordRoutes.ts`, whose handler list should drop "portfolio B"),
  `shared/programmes.ts` (the shared wave rule), `pwa/src/ledgers/GoalsPanel.tsx` and one call in `pwa/src/lib/api.ts`.
- "Where lanes meet", `ledgersRoutes.ts`: lane P adds the portfolio read, the rank door and the ratify door to the
  operator registration, and stamps sources in the spec and modification doors.
- The spec-fixes list gains: Table 11.6 lacks `rank-changed` and `goals-changed`; §3.8 names "the operator's door" but
  no such door; §5.6 does not say how classes order the rank (question 6); and §6.3's item arm needs W3's effects
  (question 3).

---

### Task 1: The vocabulary, the shared wave rule and the two deciders (L0, L1)

**Files:**
- Create: `shared/portfolio.ts` (L0)
- Modify: `shared/programmes.ts` (gains `waveRepresentative` and `NEVER_STARTED_DETAIL`, moved from
  `server/src/coord/programmesRead.ts`)
- Modify: `server/src/coord/programmesRead.ts` (its `wavesOf` and `endingOf` call the moved pair; nothing else changes)
- Create: `server/src/coord/portfolio.ts` (C5, L1: `portfolioOrder`, `portfolioFor`)
- Create: `server/test/portfolio.test.ts`
- Create: `server/test/sim/portfolioSets.ts`
- Modify: `server/test/sim/mutation-floors.test.ts` (`MUTANT_SETS`) and `server/test/sim/mutation-floors.json`
- Modify: `server/test/single-definition/time-ports.test.ts` (`TIME_PORT_FILES` gains `shared/portfolio.ts` and
  `server/src/coord/portfolio.ts`)
- Test: `server/test/programmes-read.test.ts` (unchanged, the move's characterization), `server/test/rings/*.test.ts`

**Interfaces:**

```ts
// shared/portfolio.ts
export type ServiceClass = 'expedite' | 'fixed-date' | 'standard' | 'background';   // Table 5.6a, in band order
const SERVICE_CLASS_MAP: Record<ServiceClass, true>;
export const SERVICE_CLASSES: readonly ServiceClass[];                                // derived from the map
export const isServiceClass: (v: unknown) => v is ServiceClass;
export const PORTFOLIO_WINDOW_DAYS = 28;
export const RANK_ORDER_MAX = 200;                                                   // entries one write may carry
/** One stored row. `cls` is read through `isServiceClass`; a word it refuses arrives as `null` with `raw` kept. */
export interface RankRow { program: string; position: number; cls: ServiceClass | null; clsRaw: string;
  fixedDate: string | null; setAt: number; setBy: string; revision: number }
export interface PortfolioProgramme { slug: string; title: string; createdAt: number }
export interface PortfolioRun { id: number; program: string; wave: number; kind: string; reviews: number | null;
  state: string; openedAt: number; dispatchedAt: number | null; closedAt: number | null; closeDetail: string | null }
export interface PortfolioItem { id: number; program: string; title: string; neededBy: string; state: string;
  raisedAt: number; heldUntil: number | null; tickedAt: number | null; closedAt: number | null }
export interface PortfolioAsk { id: number; program: string; state: string; releasedAt: number | null;
  answeredAt: number | null; answeredBy: string | null }
export interface PortfolioFacts { programmes: readonly PortfolioProgramme[]; ranks: readonly RankRow[];
  runs: readonly PortfolioRun[]; items: readonly PortfolioItem[]; asks: readonly PortfolioAsk[] }
export interface Measure { n: number; medianMs: number | null; p85Ms: number | null }
export interface PortfolioEntry {
  slug: string; title: string;                 // title: session-written, rendered as untrusted data
  rank: { position: number; cls: ServiceClass; fixedDate: string | null } | null;   // null: unranked
  cls: ServiceClass;                           // effective: the rank's, or 'standard' when unranked
  rankUnreadable?: true;                       // a stored row whose class word this build does not know
  wip: { working: number; waiting: number; queued: number };
  closedWaves: { days7: number; days28: number };
  cycle: Measure;                              // done waves: first dispatch to close
  oldestOpenMs: number | null;                 // the oldest started, still open wave's age
  reviewRounds: { rounds: number; waves: number };   // review runs over done waves, both counts
  ended28: { done: number; failed: number; neverStarted: number };
  waitingOnOperatorMs28: number;               // programme-time, question 10
  asksUnmeasured: number;                      // stale asks in the window, whose wait no row records
  blocking: { items: readonly { id: number; title: string }[]; asks: number };
}
export interface PortfolioView { at: number; revision: number; programmes: readonly PortfolioEntry[] }
```

```ts
// shared/programmes.ts, moved from programmesRead.ts
export const NEVER_STARTED_DETAIL = 'abandon:never-started';
/** Which of a wave's work runs stands for it: the newest open one, else the newest. */
export function waveRepresentative<T extends { readonly id: number; readonly open: boolean }>(runs: readonly T[]): T | null;
```

```ts
// server/src/coord/portfolio.ts
/** Classes in band order, the position inside a band; unranked at the end of `standard`, by createdAt then slug. */
export function portfolioOrder(ranks: readonly RankRow[], programmes: readonly PortfolioProgramme[]): readonly string[];
/** The listed programmes (question 7) in `portfolioOrder`, each with W1's measures. Pure; `now` is the caller's. */
export function portfolioFor(facts: PortfolioFacts, now: number): PortfolioView;
```

The measures, per programme. Waves are the programme's work runs grouped by `wave`, each bucketed by
`waveRepresentative`'s run through `WAVE_BUCKET`, as `GET /api/programmes` buckets them:
- **`wip`:** waves whose bucket is `working`, `waiting` or `queued`, one count each.
- **`closedWaves`:** `done` or `failed` waves whose representative closed in the last 7 and 28 days.
- **`cycle`:** over the programme's `done` waves, the representative's `closedAt` minus the wave's earliest
  `dispatchedAt`. A wave with no `dispatchedAt` is left out. `medianMs` and `p85Ms` come from `percentile` (50 and 85).
  With `n` 0 both are `null`.
- **`oldestOpenMs`:** `now` minus the earliest `dispatchedAt` of a `working` or `waiting` wave, else `null`.
- **`reviewRounds`:** review runs (`kind = 'review'`) whose `reviews` names a work run of a `done` wave, with that
  count of done waves.
- **`ended28`:** waves closed in 28 days by their bucket. `neverStarted` counts the `failed` ones whose
  `closeDetail` is `NEVER_STARTED_DETAIL`.
- **`waitingOnOperatorMs28`:** question 10's sum.
- **`blocking`:** open items with `neededBy = 'blocking'` (id and title), and the count of asks on the programme's runs
  in state `released` or `declined` (pushed to the operator and not yet answered).
- **`revision`:** the highest `revision` of the rank rows, 0 when none.

- [ ] **Step 1: The move's characterization.** Run `test/programmes-read.test.ts` on `main`: green. Move `wavesOf`'s
  newest-open-else-newest choice into `waveRepresentative` and `NEVER_STARTED_DETAIL` into `shared/programmes.ts`.
  Rerun it unchanged: green. Commit on its own: `refactor(programmes): the wave's representative run and the
  never-started detail move to shared/programmes.ts (Overlord W1, portfolio)`.
- [ ] **Step 2: Failing tests** in `test/portfolio.test.ts`, each over a hand-built `PortfolioFacts`:
  - **The order.** Two ranked `standard` programmes and one unranked come out ranked, ranked, unranked. An `expedite`
    row at position 9 comes before a `standard` row at position 1. Two unranked programmes come oldest first, and on
    equal `createdAt` by slug. A `background` row comes after every unranked programme.
  - **An unreadable class.** A row whose class word is `urgent` reads unranked, with `rankUnreadable: true`.
  - **The list.** A programme with only closed runs, older than 28 days and unranked, is not listed. The same
    programme ranked is not listed either. Ranked with a close 3 days ago, it is listed.
  - **The waves.** A wave whose newest work run is `planned` while an older one is `working` counts as `working`, as
    in `GET /api/programmes`. A review run never counts as a wave.
  - **The cycle.** Done waves of 2, 4 and 10 hours give a median of 4 and a p85 of 10, with `n` 3. No done wave gives
    `n` 0 and both `null`, never 0. A done wave with no dispatch is left out of `n`.
  - **Endings.** A `failed` wave closed `abandon:never-started` counts in `failed` and in `neverStarted`. One closed
    29 days ago counts in neither.
  - **Waiting.** An item held until `t1` and ticked at `t2` adds `t2 − t1`. An open item adds up to `now`. One raised
    40 days ago and still open adds 28 days, clipped. Two items waiting at once add twice. An ask released and answered
    adds its span, an ask still `declined` adds up to now, an ask never released adds nothing, and a `stale` one adds
    nothing and counts one in `asksUnmeasured`.
  - **Blocking.** An open `blocking` item is listed by id and title. A closed one is not.
  - **No clock.** The answer is a function of `facts` and `now` alone: the same input twice gives deep-equal output.
- [ ] **Step 3: Run.** Red.
- [ ] **Step 4: Implement** `shared/portfolio.ts` and `server/src/coord/portfolio.ts`, and add both files to
  `TIME_PORT_FILES`.
- [ ] **Step 5: Run** this suite, `test/programmes-read.test.ts`, `test/rings/*.test.ts`,
  `test/single-definition/*.test.ts` and the three `tsc` runs. Green.
- [ ] **Step 6: Mutation sets.** `server/test/sim/portfolioSets.ts`, on the shape of `server/test/sim/cardMutants.ts`:
  one set for `portfolioOrder` and one for `portfolioFor`, each running this suite's cases against the mutated module.
  Measure the floors with `test/sim/mutation-floors.test.ts` and record them in `mutation-floors.json`. Red check, each
  reverted:
  - put unranked programmes before ranked `standard` ones;
  - answer 0 for an empty cycle series;
  - count a review run as a wave;
  - drop the 28-day clip.
- [ ] **Step 7: Commit.** `feat(portfolio): the class of service, the order and portfolioFor, pure (Overlord W1)`

### Task 2: `portfolio_rank`, its one writer and the facts read (L3)

**Files:**
- Modify: `server/src/coord/schema.ts` (one migration: `portfolio_rank`)
- Create: `server/src/coord/portfolioStore.ts` (`setPortfolioRank`, `rankRows`, `portfolioFacts`)
- Modify: `server/src/coord/store.ts` (one-line delegates: `setPortfolioRank`, `portfolioFacts`; one import)
- Modify: `server/test/coord-db.test.ts` (73 to the new count), `server/test/run-close-switch.test.ts` (its undo step
  drops `portfolio_rank`, and its count word moves by one)
- Modify: `server/test/single-definition/writers-map.test.ts` (`TABLES` gains `portfolio_rank`; its writer is
  `portfolioStore.ts#setPortfolioRank`)
- Modify: `server/test/single-definition/time-ports.test.ts` (`TIME_PORT_FILES` gains `portfolioStore.ts`)
- Create: `server/test/portfolio-store.test.ts`

**Schema:**

```sql
CREATE TABLE portfolio_rank (
  program   TEXT PRIMARY KEY,          -- a programs.slug; the door checks it exists
  position  INTEGER NOT NULL,          -- the place inside its class band, 1 first
  cls       TEXT NOT NULL,             -- ServiceClass; read through isServiceClass, never a cast
  fixedDate TEXT,                      -- YYYY-MM-DD, only on fixed-date
  setAt     INTEGER NOT NULL,          -- wall ms of the write
  setBy     TEXT NOT NULL,             -- the account gate's actor, '<label> <8 hex>'
  revision  INTEGER NOT NULL           -- the same on every row of one write
);
```

The migration's comment states the slot to re-measure, as every migration does: new table, nothing on an existing
table, so an older build takes rule 3 and ignores it (Table 11.1a: "Ignores it").

**The writer.** `setPortfolioRank(db, order, actor, now, basedOn)` runs in one transaction. It reads the current
revision. If `basedOn` differs, it answers `{ ok: false, why: 'rank-changed', revision }` and writes nothing. Otherwise
it deletes every row, inserts the order with positions numbered inside each class from 1, stamps every row with
`revision + 1`, and answers `{ ok: true, revision }`. The whole order is one write, so two positions can never collide
and a dropped programme leaves no row.

**The facts read.** `portfolioFacts(db, now, terminalStatesSql)` reads, inside one read transaction:
- the programmes with an open run or a rank row (`programs.slug`, `title`, `createdAt`);
- their rank rows;
- their runs (all of a listed programme's runs, columns as in `PortfolioRun`);
- their operator items still open or closed in the window;
- their asks (joined to `runs` for the programme) with a `releasedAt` in the window, or still `released` or
  `declined`. Step 1 measures `server/src/coord/store.ts`'s ask writers again: on `main` the release, the decline and
  the stale mark each set `releasedAt`.

The 28-day listing rule and the window are `portfolioFor`'s, so the read only bounds what it fetches. A class word that
`isServiceClass` refuses is carried as `cls: null` with `clsRaw`. A throw is not caught here: the door answers it.

- [ ] **Step 1: Failing tests** (`test/portfolio-store.test.ts`, an in-memory `coord.db`):
  - a fresh database has the table and no row;
  - a write with `basedOn` 0 stores the order at revision 1, and a second with `basedOn` 1 at revision 2;
  - a write with a stale `basedOn` answers `rank-changed` with the current revision and changes no row;
  - a write that leaves a programme out deletes its row;
  - positions restart at 1 in each class band;
  - `setBy` and `setAt` are stored as given;
  - a row whose `cls` was written as `urgent` (by hand, standing in for a newer build) reads `cls: null`, `clsRaw:
    'urgent'`;
  - the facts read lists a programme with an open run and no rank, and a ranked programme with no open run, and leaves
    out one with neither;
  - an ask on another programme's run is not in this programme's asks.
- [ ] **Step 2: Run.** Red.
- [ ] **Step 3: Implement** the migration, the store file and the delegates.
- [ ] **Step 4: Run** this suite, `test/coord-db.test.ts`, `test/run-close-switch.test.ts`,
  `test/single-definition/*.test.ts`, `test/rings/*.test.ts`, `test/ledgers-migration.test.ts` and both server `tsc`
  runs. Green.
- [ ] **Step 5: Red check.** Make the writer skip the `basedOn` check: a case reds. Revert. Add a second `INSERT INTO
  portfolio_rank` in a function of `ledgersStore.ts`: `writers-map.test.ts` reds. Revert.
- [ ] **Step 6: Commit.** `feat(portfolio): portfolio_rank, its one writer, and the facts portfolioFor reads (Overlord W1)`

### Task 3: The operator's portfolio read and the rank door

**Files:**
- Modify: `server/src/coord/ledgersRoutes.ts` (`registerLedgerOperatorRoutes`: `GET /api/portfolio` and `POST
  /api/portfolio/rank`)
- Modify: `shared/refusal.ts` (`LEDGER_ROUTE_REFUSALS` gains `rankChanged: 'rank-changed'`, with its 409 beside the
  other statuses)
- Modify: `server/src/server.ts` (`MASKED_GET_ROUTES` gains `/api/portfolio`, with a comment line)
- Modify: `server/test/box-token-census.test.ts` (`LEDGER_OPERATOR_DOORS` gains both paths)
- Modify: `CLAUDE.md` (the box-token bullet's sentence on the programme ledgers' operator doors names both, which
  `SESSION_ONLY_ALL` checks)
- Modify: `server/test/auth-gate.test.ts` (`scanRoutes('coord/ledgersRoutes.ts')` 20 to 22, and the whole surface's
  counts with their dated comment: the HTTP half and the gated count each rise by two, the exempt count stays)
- Modify: `server/test/secret-mask.test.ts` only if its census needs a line beyond `MASKED_GET_ROUTES` (measure)
- Create: `server/test/portfolio-routes.test.ts`

**The read.** `GET /api/portfolio`, session-gated (no box token, not EXEMPT). It calls `coord.portfolioFacts`, then
`portfolioFor`, and answers `{ ok: true, portfolio: PortfolioView }`. A throw from the read answers `runs-unreadable`
(503) with the error's message as `detail`.

**The rank door.** `POST /api/portfolio/rank`. Its order:
1. `deps.gate(req, reply, { cap: null })`. It refuses `auth-off` while sign-in is dark, and a pass carries the actor.
2. The body's shape: `{ basedOn: number, order: { slug, cls, fixedDate? }[] }`. Each of these is `bad-request`:
   - more than `RANK_ORDER_MAX` entries;
   - a slug twice;
   - a class that is not a `ServiceClass`;
   - `fixedDate` on a class other than `fixed-date`, or missing on `fixed-date`, or not a valid `YYYY-MM-DD` calendar
     date.
3. Every slug names a `programs` row, else `not-found` with the slug.
4. `coord.setPortfolioRank(order, String(actor), deps.now(), basedOn)`. `rank-changed` answers 409 with the current
   revision.
5. It answers `{ ok: true, revision, portfolio }`, the new view, so the console that wrote it has the new order. It
   emits no frame: another tab sees the change at its next read.

The door does no `await` between its read and its write, so the transaction's check is the whole guard.

- [ ] **Step 1: Failing tests** (`test/portfolio-routes.test.ts`, `buildServer` over an in-memory store, auth armed with
  a fixture session):
  - the read answers the view in rank order, and an unranked programme last in `standard`;
  - the read without a session is 401, and with the box token alone it is still 401: it is the operator's read;
  - the rank door with sign-in dark answers `auth-off`;
  - a valid order answers revision 1 and the view, with `setBy` the fixture actor;
  - a stale `basedOn` answers 409 `rank-changed`, and a second identical stale write is refused the same way;
  - every shape refusal in item 2 is `bad-request`, and an unknown slug is `not-found`;
  - a store whose facts read throws makes the read answer 503 `runs-unreadable`, never `{ programmes: [] }`;
  - a programme title carrying a secret-shaped string comes back masked.
- [ ] **Step 2: Run.** Red.
- [ ] **Step 3: Implement** the two handlers, the word and the census edits.
- [ ] **Step 4: Run** this suite, `test/box-token-census.test.ts`, `test/auth-gate.test.ts`,
  `test/secret-mask.test.ts`, `test/ledgers-operator-routes.test.ts`, `test/refusal-status.test.ts` (every declared
  word has its status), `test/rings/*.test.ts` and the three `tsc` runs. Green.
- [ ] **Step 5: Red check.** Register the rank door with a `checkMailToken` call: `box-token-census.test.ts` reds.
  Revert. Drop the gate call: the `auth-off` case reds. Revert.
- [ ] **Step 6: Refusal table.** If the vocabulary piece's Table 11.6 test is on `main`, add `rank-changed` to its
  exception list with wave W1, in this pull request (the index's question 23). If it is not, say so in the pull
  request, so that piece measures the word.
- [ ] **Step 7: Commit.** `feat(portfolio): the operator's portfolio read and the rank door (Overlord W1)`

**PR A ends here.** Its body states: the rank door is an operator door in the ledger registration and no box-token
route can reach it; question 2's move of the door into PR A; the floors; and that nothing changes at merge.

### Task 4: Who each goals version rests on, and whether that ratifies it

**Files:**
- Modify: `server/src/coord/schema.ts` (one migration: `programs.ratifiedBy`, `programs.ratifiedAt`,
  `programs.doneWhenBy`, `programme_modifications.ratifiedBy`, `programme_modifications.ratifiedAt`)
- Modify: `shared/ledgers.ts` (beside `GoalsView`: `RatifiedBy`, its parser and printer, `RATIFYING_SOURCES`,
  `goalRatification`, and `GoalsView`'s optional fields)
- Modify: `server/src/coord/ledgersStore.ts` (`setSpecPin` and `setDoneWhen` write `doneWhenBy`, and `setSpecPin`
  writes the pin's source; `addModification` writes the row's source; `goalsFor` reads the sources and computes the
  verdicts, joining each cited item)
- Modify: `server/src/coord/ledgersRoutes.ts` (the spec door passes `coordinator`; the modification door passes
  `item:<id>` when it cites an item, else `coordinator`)
- Modify: `server/src/coord/store.ts` (the widened `addModification` and `setSpecPin` delegates)
- Modify: `server/src/continuity/cardFacts.ts` (each goal's `ratified` from the view; the goals-unratified comment goes)
- Modify: `server/test/coord-db.test.ts`, `server/test/run-close-switch.test.ts` (its undo step drops the five columns)
- Create: `server/test/goals-ratification.test.ts`
- Create: `server/test/sim/ratificationSets.ts`; modify `mutation-floors.test.ts` and `mutation-floors.json`
- Test: `server/test/ledgers-store.test.ts`, `server/test/ledgers-coordinator-routes.test.ts`,
  `server/test/continuity-card-facts.test.ts`, `server/test/ledgers-frame.test.ts`

**Interfaces:**

```ts
// shared/ledgers.ts, beside GoalsView
export type RatifiedBy =
  | { kind: 'coordinator' }                  // the programme's own coordinator wrote it
  | { kind: 'item'; itemId: number }         // a modification that cites an item of this programme
  | { kind: 'operator' };                    // the operator's ratify door
// W2 adds { kind: 'request'; requestId: number }; the parser refuses it until then.
type RatifiedByKind = RatifiedBy['kind'];
const RATIFIED_BY_KIND_MAP: Record<RatifiedByKind, true>;
export const parseRatifiedBy: (raw: string | null) => RatifiedBy | 'unrecorded' | 'unreadable';
export const ratifiedByText: (r: RatifiedBy) => string;      // 'coordinator' | 'item:<id>' | 'operator'
/** Question 1: whether each source can ratify. ONE row changes if operator item 328 answers differently. */
export const RATIFYING_SOURCES: Readonly<Record<RatifiedByKind, boolean>>;  // coordinator: false, item: true, operator: true
export type Ratification =
  | { ratified: true; source: RatifiedBy }
  | { ratified: false; why: 'unrecorded' | 'unreadable' | 'source-does-not-ratify' | 'effect-unmeasured' | 'item-not-answered';
      source: RatifiedBy | null };
/** Pure. `item` is the cited item as the store read it, or null when it names no item of this programme. */
export function goalRatification(source: RatifiedBy | 'unrecorded' | 'unreadable',
  item: { program: string; state: string; tickedAt: number | null } | null, program: string): Ratification;
// GoalsView gains, all optional (absent from an older server, read by `ratificationOf` below as not ratified):
//   pinRatification?: Ratification;   doneWhenRatification?: Ratification;
//   modifications[i].ratification?: Ratification;
export const ratificationOf: (r: Ratification | undefined) => Ratification;   // the one reader of the optional fields
```

`goalRatification`'s rows, first match:
1. `unrecorded` and `unreadable` answer themselves, not ratified.
2. `RATIFYING_SOURCES[kind]` false: `source-does-not-ratify` (`coordinator`, under question 1's recommendation).
3. `item`: a cited item that is missing or of another programme answers `unreadable`. One the operator has not ticked
   (no `tickedAt`, or not `done`) answers `item-not-answered`. One the operator ticked answers `effect-unmeasured`
   in W1 (question 3). W3 replaces this last arm with the effect check. So `RATIFYING_SOURCES.item` is `true`, and the
   W1 arm still never answers ratified.
4. `operator`: ratified.

**The writes.**
- `setSpecPin` gains a `source: RatifiedBy` argument. It writes `ratifiedBy` and `ratifiedAt = now` with the pin's text,
  so a re-pin replaces the pin's source with its own: new text is never ratified by an older act. When it writes
  `doneWhen` it writes `doneWhenBy = 'pin'`.
- `setDoneWhen` gains the modification id and writes `doneWhenBy = 'mod:<id>'` in the same statement as `doneWhen`.
- `addModification` gains `source` and writes it on the row.
- `goalsFor` reads the pin's and each row's source, and joins the cited item. It answers the pin's verdict, each
  modification's verdict, and the definition of done's verdict: `doneWhenBy = 'pin'` takes the pin's, `mod:<id>` takes
  that row's, and NULL or unreadable text answers `unrecorded` or `unreadable`.
- Rows from before the migration hold NULL and read `unrecorded`. Nothing is back-filled: a source nobody recorded is
  not guessed.

**The card.** `cardFacts.ts` takes the In short goal's `ratified` from `pinRatification` and each definition-of-done
line's from `doneWhenRatification`, through `ratificationOf`. Until the operator ratifies a version, every goal still
renders as not ratified, inside the untrusted block, as today.

- [ ] **Step 1: Failing tests** (`test/goals-ratification.test.ts` for the decider, `test/ledgers-store.test.ts` and
  `test/ledgers-coordinator-routes.test.ts` for the writes):
  - The parser reads each spelling back from the printer. It reads NULL as `unrecorded`, and `item:`, `item:0`,
    `request:3` and `Operator` as `unreadable`.
  - Each decider row answers as listed. **Marked for question 1:** a `coordinator` source answers
    `source-does-not-ratify`.
  - A coordinator's pin reads `{ ratified: false, why: 'source-does-not-ratify' }`.
  - A re-pin after an operator ratification reads not ratified again.
  - A modification citing an open item reads `item-not-answered`. After the operator ticks it, it reads
    `effect-unmeasured`, never ratified.
  - A modification that carries a new definition of done moves the definition of done's verdict to that row's.
  - A row written before the migration (inserted with NULL) reads `unrecorded`.
  - The goals read and the waiting frame carry the new fields. `ratificationOf(undefined)` reads `unrecorded`.
  - The card renders a goal as ratified only when its verdict is ratified.
- [ ] **Step 2: Run.** Red.
- [ ] **Step 3: Implement.** **(Question 1.)** `RATIFYING_SOURCES.coordinator` is `false`. If operator item 328
  answers that a coordinator's own pin counts, set it to `true` and change the one marked case. Nothing else in this
  plan changes.
- [ ] **Step 4: Run** these suites, `test/continuity-card-facts.test.ts`, `test/continuity-card-render.test.ts`,
  `test/ledgers-frame.test.ts`, `test/coord-db.test.ts`, `test/run-close-switch.test.ts`, `test/rings/*.test.ts`,
  `test/single-definition/*.test.ts` and the three `tsc` runs. Green.
- [ ] **Step 5: Mutation set.** `server/test/sim/ratificationSets.ts`: one set for `goalRatification`, with floors
  recorded. Red check, each reverted:
  - let the `item` arm answer ratified on a ticked item;
  - read `unreadable` as `operator`;
  - let a re-pin keep the old source.
- [ ] **Step 6: Commit.** `feat(goals): every goals version records what it rests on, and one decider says whether that ratifies it (Overlord W1)`

### Task 5: The operator's ratify door and its control

**Files:**
- Modify: `server/src/coord/ledgersStore.ts` (`ratifyGoalsVersion`, the operator's arm of the one writer)
- Modify: `server/src/coord/store.ts` (its delegate)
- Modify: `server/src/coord/ledgersRoutes.ts` (`registerLedgerOperatorRoutes`: `POST /api/programmes/:slug/goals/ratify`)
- Modify: `shared/refusal.ts` (`LEDGER_ROUTE_REFUSALS` gains `goalsChanged: 'goals-changed'`, 409)
- Modify: `server/test/box-token-census.test.ts` (`LEDGER_OPERATOR_DOORS`), `CLAUDE.md` (the same bullet),
  `server/test/auth-gate.test.ts` (22 to 23, and the surface's counts)
- Modify: `pwa/src/lib/api.ts` (`ratifyGoals`), `pwa/src/ledgers/GoalsPanel.tsx` (the Ratify control and the "not
  ratified" word beside each unratified version), `pwa/src/ledgers/ledgerWords.ts` (the words)
- Test: `server/test/goals-ratify-route.test.ts` (new), `pwa/test/goals-panel.test.tsx`, `pwa/test/ledger-words.test.ts`

**The door.** Its order:
1. `deps.gate(req, reply, { cap: null })`. It refuses `auth-off`, and a pass carries the actor.
2. The body: `{ pin: { inShortAt: number } }` or `{ modification: number }`, else `bad-request`.
3. Inside one transaction (`ratifyGoalsVersion`):
   - a programme with no pin, or a modification id that is not this programme's, is `not-found`;
   - a pin whose `inShortAt` differs from the body's is `goals-changed`, with the stored stamp;
   - a version already ratified by the operator answers `{ ok: true, changed: false }` and writes nothing;
   - otherwise it writes `ratifiedBy = 'operator'` and `ratifiedAt = now`.
4. On a change it emits the waiting frame (`deps.bus.emit('waiting')`, as the tick door does), so the Goals panel and
   the waiting list update, and answers `{ ok: true, changed, goals }`.

The coordinator is not mailed. A coordinator reads the verdict through its goals read (`ccrc-api goals show`), as it reads
every other goals change.

**The control.** The Goals panel shows each version's verdict in words: "ratified by you", "not ratified: written by
the coordinator", "not ratified: rests on item N, which W3 checks", and "not recorded" for an older row. An unratified
pin or modification gets a "Ratify" button that sends the stamp the panel rendered. A `goals-changed` answer reloads
the panel and says that the goals changed since they were shown.

- [ ] **Step 1: Failing tests** (`test/goals-ratify-route.test.ts`, `buildServer` with auth armed):
  - sign-in dark answers `auth-off`;
  - a valid pin ratification flips the goals read's verdict to ratified, with `operator`;
  - a stale `inShortAt` answers 409 `goals-changed` and writes nothing;
  - a second call answers `changed: false`;
  - another programme's modification id is `not-found`;
  - the box token alone is 401;
  - the frame is emitted once on a change and not on `changed: false`.

  In `pwa/test/goals-panel.test.tsx`: each verdict's words render; the button sends the rendered stamp; a 409
  reloads and shows the notice.
- [ ] **Step 2: Run.** Red.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** these suites, `test/box-token-census.test.ts`, `test/auth-gate.test.ts`,
  `test/ledgers-operator-routes.test.ts`, `test/refusal-status.test.ts`, `test/rings/*.test.ts`, pwa's ledgers tests, and
  the three `tsc` runs. Green.
- [ ] **Step 5: Red check.** Let the door skip the stamp check: the stale case reds. Revert.
- [ ] **Step 6: Refusal table.** `goals-changed` joins the vocabulary piece's Table 11.6 exception list, as in Task 3,
  Step 6.
- [ ] **Step 7: Commit.** `feat(goals): the operator's ratify door and the Goals panel's Ratify control (Overlord W1)`

**PR B ends here.** Its body states: question 1's answer as the operator gave it, and the one row it set; that an item
answer does not ratify until W3 (question 3); and that nothing renders differently at merge.

## Deviations found

These are the departures from the spec's text that this plan makes, by slug. The coordinator mints the numbers.

- **`rank-door-ships-with-its-table`**: the index puts the rank door in PR B, after designation A. It ships in PR A,
  beside the table it writes, in the ledgers' operator registration (question 2).
- **`item-ratifies-with-its-effect`**: §3.8 lists an item answer as a source. In W1 it is recorded and reads not
  ratified, because §6.3's effect check arrives in W3 (question 3).
- **`operator-ratify-door`**: §3.8 names "the operator's door" without one. It is `POST
  /api/programmes/:slug/goals/ratify`, with the version's stamp (question 4).
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
- **`rank-revision-column`**: `portfolio_rank` carries `revision`, which Table 11.1a does not list (question 8).
- **`stale-write-words`**: two new refusal words, `rank-changed` and `goals-changed`, that Table 11.6 lacks (question
  8).
- **`portfolio-read-door`**: a session-gated `GET /api/portfolio`, which Table 11.1e does not list (question 9).
- **`operator-wait-from-items-and-asks`**: "hours waiting on the operator" is items and asks, summed as programme-time
  over 28 days (question 10).
- **`wave-rule-moves-to-shared`**: `programmesRead.ts`'s private wave rule and never-started detail move to
  `shared/programmes.ts`, so both readers use one rule (Task 1).

## Where things stand

**Agreed:** from the brief and the index:
- lane P, two pull requests, PR A ready to build now (question 36);
- the shape of the merged piece plans;
- `ratifiedBy` built on question 24's recommendation, with the one task marked that changes if the answer differs.

**Waiting on the operator:** question 1, the index's question 24 (operator item 328). PR B is built on the
recommendation, and it merges once the item is answered.

**Waiting on the coordinator:** questions 2 to 10 stand as recommendations. Question 2 changes the index's row and
Figure W1, and the list under "Index changes" carries them.

**Needs before it starts:** PR A needs nothing beyond `main`. PR B needs PR A, and operator item 328's answer before
merge.

**What depends on it:**
- home B: the strip and its rank control, from PR A;
- board and history B: the Portfolio part from PR A, and the Goals part's `ratifiedBy` from PR B;
- W2: health, dates, edges and spend, which join `portfolioFor`;
- W3: the item arm's effect check, which replaces one decider row;
- W5: `portfolioFocus`;
- W6: scarcity admission and the weekly packet.

**Later:**
- The relay's priority from the rank (W2).
- The `request` source of `ratifiedBy`, with the "Changed that matters" rule (W2, §4.1).
- The rank as the first sort key where work waits (W6).
