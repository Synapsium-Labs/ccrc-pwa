# The coordinator lifts the review-round cap: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:test-driven-development (red first, then green). One wave,
> one PR. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** when a work run hits its review-round cap, its coordinator can extend the cap itself, with a reason, when it
judges another round truly necessary. The operator no longer has to lift caps by hand, and still sees every lift.

**Architecture:** one pure decider and one pure reason check in `reviewcap.ts` (L1). One migration gives `review_cap` a
granted-rounds count and an ask-handled time, plus a journal table of coordinator lifts. Their SQL lives in a new
`reviewCapStore.ts` beside `ledgersStore.ts`, with one-line `CoordStore` delegates. One box-token, attribution-checked
coordinator door, `POST /api/runs/:id/review-rounds`, is registered from a new `reviewRoundsRoute.ts`, and `ccrc-api`
gets a `runs review-rounds` row. A box setting turns the door off fleet-wide. The run row's `reviewCap` carries the
grant and the latest coordinator lift, so the run board's band and the run page show it. The operator's lift
(`POST /api/coord/review-cap`) keeps its route, auth, body, answer and meaning: it removes the cap.

**Tech stack:** TypeScript, Fastify, `node:sqlite` (server); bash (`ccd/ccrc-api`, `ccd/ccrc`); React, `@ccrc/ui`,
vitest + jsdom, vitest browser mode (PWA).

**Note (D-8165):** the `CCRC_REVIEW_CAP_COORD_LIFT` switch this plan adds was retired the next day: the coordinator's lift is always on and
not configurable. This plan keeps its history; read every mention of the switch, of `coord-lift-off` and of the `coordination` settings family below as
retired. See `docs/superpowers/plans/2026-11-10-review-cap-always-on.md`.

**Ruling:** D-8125 (below). It builds on D-6795 (the cap), D-6909 (the cap on the run row), D-6910 (the read of the
ask) and D-6911 (where the operator's control lives). Anchors are symbol names on `origin/main` at `47007038c`,
2026-11-09. Re-ground each one by its symbol before editing.

## What was measured (2026-11-09)

- **The cap.** `REVIEW_ROUND_CAP = 3` and `reviewCapRefuses(rounds, lifted)` in `server/src/coord/reviewcap.ts`.
  `CoordStore.openRun`'s review arm counts `reviewRounds(reviews)` (review runs that name the work run, in any state)
  and refuses `cap-review-rounds` (409, `RUN_REFUSAL_STATUS`) with `by` = the count, unless
  `reviewCapLifted(reviews)` is true.
- **The ask.** The `cap-review-rounds` arm of `POST /api/runs` composes `composeReviewCapAsk` and, when
  `raiseReviewCapAsk` returns true (an `INSERT OR IGNORE` into `review_cap`, so once per work run, ever), pushes one
  notice `{ kind: 'run', sessionId: '', runId: work }` tagged `review-cap-<run>`. A second cap refusal on the same run
  raises nothing, even after a lift.
- **The operator's lift.** `POST /api/coord/review-cap` `{ run }` is session-gated, no box token ("no machine lane may
  lift a cap on its own work"), idempotent, and sets `review_cap.liftedAt` (`liftReviewCap`), which removes the cap for
  that run. It sends a `record-only` `kind: 'coord'` feed notice. `coord-pause-route.test.ts`'s `SESSION_ONLY` holds it;
  `auth-gate.test.ts` counts it.
- **Schema.** `review_cap (workRunId PK, askedAt, liftedAt)` is migration 30. `MIGRATIONS` has 47 entries today, so the
  next free slot is **48** (`user_version 47 -> 48`). Re-measure with
  `git show origin/main:server/src/coord/schema.ts | grep -c '^  // ── [0-9]*: user_version'` before the PR and before merge.
- **The run row.** `reviewCapStates(ids)` batch-reads counts and `review_cap` rows. `hydrateRun` fills
  `RunSummary.reviewCap` through `reviewCapStatus(kind, rounds, row)`. The PWA's one reader is `reviewCapOf`
  (`pwa/src/fleet/reviewCapWords.ts`), and `capWaiting` decides waiting as `askedAt !== null && liftedAt === null` on an
  open run.
- **Where the operator sees the ask.** `ReviewCapBand` ("Waiting on you", on `RunsScreen`), the Lift cap control in
  `RunDetailScreen`'s `Controls`, and the Mail record's door (`capDoorRun`). `/waiting` (`pwa/src/ledgers/WaitingScreen.tsx`)
  does NOT list review caps, and no `operator_items` row is ever written for one (see Deviations found).
- **How coordinators call coord routes.** Box token (`requireMailToken`) plus, on attributed lanes, `requireAttribution`
  (`attributionVerdict`: the `{byId, byUuid}` pair re-measured against the registry). Ownership on the ledger lanes is
  `claimsProgramme(byId, program)`, else 403 `not-your-programme` (`LEDGER_ROUTE_REFUSALS.notYourProgramme`). A worker
  never claims a run (`claimant-is-a-worker` on open). There is no server-signed coordinator session identity in the
  tree: `ccd/ccrc-api` says so in its `asks.answer` comment ("identity on this fleet is attribution, not authentication").
- **The client.** `ccd/ccrc-api`'s `ROUTES` table has fifty-eight rows, a scanned count (`ccrc-api.test.ts`), and the
  server-cap reader `_api_server_cap` (generated region). `ServerCap` (`shared/api.ts`) lists four words today.
- **Settings.** `CCRC_SETTINGS` and `BOX_SETTINGS_TABLE` in `ccd/ccrc`, mirrored by `BOX_SETTING_TABLE`,
  `BOX_SETTING_FAMILY_MAP` and `BOX_SETTING_VALUE_WORDS` in `shared/api.ts` ("All 93 of `CCRC_SETTINGS`"). A
  server-read setting follows D-8122's `CCRC_WAKE_PRESSURE_GATE`: `wakeGateConfigOf(env)` in `server/src/config.ts`,
  the server unit's `EnvironmentFile` being `~/.ccrc/ccrc.env`. The console card's family words are in
  `pwa/src/fleet/boxSettingsWords.ts`.
- **The skill.** `ccd/coordinator-skill/SKILL.md` (step 5, "Dispatch a review run") and
  `references/wave-lifecycle.md` (the `cap-review-rounds` row) say "do not retry ... the cap is theirs to lift".
  `coordinator-skill.test.ts` forbids the substring `review-cap` anywhere in skill text and lists
  `POST /api/coord/review-cap` and `GET /api/coord/review-cap/:id` as operator-dial doors a skill must not name. The
  operator's review-round cutoff (2 rounds, 3 for security) is not in the skill text today.
- **Growth.** `store.ts`, `routes.ts` and `pwa/src/lib/api.ts` are growth-checked at 40 net code lines
  (`GROWTH_LIMIT`, `server/test/growthCheck.ts`). Logic goes in `reviewcap.ts`, the new `reviewCapStore.ts` and the new
  `reviewRoundsRoute.ts`.
- **Overlap.** The runs rebuild waves (B5 to B8) edit `RunDetailScreen.tsx` and `pwa/src/fleet/runDetailWords.ts`.
  Re-measure open PRs touching those two files before Task 8 and rebase onto whichever lands first.

## Deviations found

- **D-8125 (2026-11-09)** — the operator ruled: "Lifting review caps is the MOST ANNOYING thing to do manually.
  COORDINATOR should be able to lift review caps when it truly judges this to be necessary." The author's calls, taken
  as the controller's chosen defaults: (1) the door is `POST /api/runs/:id/review-rounds`, box token plus registry
  attribution (`byId`/`byUuid`), and the caller must be the work run's claimant or hold an open claim on its programme
  (`claimsProgramme`), else 403 `not-your-programme`; `ccrc-api runs review-rounds` is its client row, gated on the server
  cap word `review-rounds-v1`. (2) A reason is required: one line, 16 to 300 characters after trimming, masked by
  `redactCommand` and cut whole by `cutWhole` before it is stored; the coordinator skill says when a lift is justified and
  when to stop. (3) A coordinator lift is allowed only while the cap refuses (rounds at or over the cap, no operator lift),
  else 409 `cap-not-reached`, and grants `REVIEW_ROUND_CAP` (3) more rounds, stored as `review_cap.granted`; the effective
  cap is `REVIEW_ROUND_CAP + granted`; there is no ceiling on the number of lifts; the operator's lift still removes the
  cap. (4) Every coordinator lift writes one `review_cap_lifts` row (who, run, reason, rounds used, cap before and after,
  the ask it closed), one `run_events` row on the work run, and one `record-only` feed notice; an open operator ask is
  closed by `review_cap.askHandledAt`, in the same transaction, and the next cap refusal reopens and re-pushes it. (5)
  `CCRC_REVIEW_CAP_COORD_LIFT` (`on` or `off`, default `on`) is a box setting in a new `coordination` family, roles
  server and both, read by the server at start; `off` refuses 409 `coord-lift-off`. (6) The run row's `reviewCap` carries
  `granted`, `askHandledAt` and `coordLift`; the band and the run page say "Cap lifted by its coordinator: <reason>". (7)
  The operator's push at a cap refusal is unchanged. Departures from the controller's brief, found while reading the
  code: the review-cap ask is not an operator item, so nothing is moved through `moveItemInTx` (closing the ask is
  `askHandledAt`, and a pin holds that a coordinator lift writes no `operator_items` row or state); and there is no
  server-signed coordinator identity to read, so the door uses the attribution every coordinator lane uses, never an
  unchecked body field.

The two departures, in full:

- **No operator item to close.** The brief said to close the operator's review-cap ask "through `moveItemInTx` (the
  only writer of `operator_items.state`)". Measured: the ask is `review_cap.askedAt`, a push notice, the run board's
  `ReviewCapBand` and the Mail door. `raiseItem` is never called for it and `/waiting` does not list it. Closing it is
  therefore a `review_cap` write, `askHandledAt`, read by `capWaiting`. `moveItemInTx` stays the only writer of
  `operator_items.state`, untouched, and Task 5 pins that a coordinator lift leaves `operator_items` and
  `operator_item_events` exactly as they were. If a later wave moves the cap's ask onto `/waiting` as an item, that wave
  closes it through `moveItemInTx` (`withdraw` by the coordinator actor) in the lift's transaction.
- **Identity is attribution.** The brief said "identity from the server-signed session, never a body field". No such
  identity exists for coordinator calls: every coordinator write is box token plus `{byId, byUuid}` re-measured against
  the registry (`attributionVerdict`), which is freshness, not forgery-proofness. The door uses exactly that gate and
  then decides ownership from the server's own rows (`runs.claimedBy`, `claimsProgramme`), never from a body field it
  has not re-measured. A worker presenting its own pair is refused; a worker presenting its coordinator's pair (every
  `.uuid` is readable by the one UNIX user) is the known limit of every coordinator lane, recorded under Known limits.

## Global constraints

- `REVIEW_ROUND_CAP` stays 3. `cap-review-rounds`, its 409 and its `ask` body are unchanged.
- The operator's `POST /api/coord/review-cap` and `GET /api/coord/review-cap/:id` keep their auth (session-gated, no box
  token), bodies, answers and meaning. The box token never reaches either.
- Skill text never contains the substring `review-cap` (the forbid-mention case stays). The coordinator's door is named;
  the operator's is not.
- `moveItemInTx` is not edited, called or wrapped by this wave.
- Wire discipline: additive only. New `ReviewCapStatus` fields are required on the server type and optional at the
  PWA's one reader (`reviewCapOf`), because a `RunSummary` is cast, never revived. `FLEET_PROTO` is not bumped.
- Migration 48 adds two nullable columns (no NOT NULL, no CHECK, no default) and one new table, nothing else. Every
  earlier entry is frozen.
- The three growth-checked files stay within +40 net code lines each.
- Fixture HOMEs only, neutral names (`prog-a`, `lane-a`, `demo-w1`). No test reads a live coord.db or a live box.
- Public repo: no tracker ids, hosts, IPs, account or session names. Comments cite symbol names, never line numbers.
- Every commit cites D-8125 and carries the repository's attribution lines.

## Review focus (the pinned risks)

| # | Risk | Pinned in |
|---|---|---|
| R1 | A worker calls the door with its own pair | Task 5: 403 `not-your-programme`, nothing written |
| R2 | A coordinator lifts another programme's run | Task 5: 403 `not-your-programme`, nothing written |
| R3 | A lift with no reason, a blank one, a multi-line one, one under 16 or over 300 characters | Task 1 (pure), Task 5 (400 `bad-request`) |
| R4 | Repeated lifts: each +3, each recorded, none early | Task 2 (store), Task 5 (route: lift, 3 rounds, lift again; early second lift is `cap-not-reached`) |
| R5 | The setting off | Task 4 (config), Task 5 (409 `coord-lift-off`, nothing written, operator lift still works) |
| R6 | An older server (skew) | Task 6 (client refuses on a current cap file without `review-rounds-v1`; sends on a stale or absent one; a 404 is read by the skill), Task 2 (rollback onto a user_version 48 file reads the old rule safely), Task 8 (older server row without the new fields) |
| R7 | The operator's ask closed only by the `review_cap` write, never an `operator_items` write | Task 5 |
| R8 | A reason carrying a secret | Task 5 (stored masked, row masked on egress) |
| R9 | Two lifts racing at one cap | Task 2 (the second, inside the same transaction rule, is `cap-not-reached`) |

---

### Task 1: the pure core (reviewcap.ts)

**Files:**
- Modify: `server/src/coord/reviewcap.ts`
- Test: `server/test/review-cap.test.ts`

**Interfaces:**
- `export const effectiveReviewCap = (granted: number): number => REVIEW_ROUND_CAP + granted;`
- `export const reviewCapRefuses = (rounds: number, lifted: boolean, granted: number): boolean` — `!lifted && rounds >= effectiveReviewCap(granted)`. The third parameter is required (no default), so every caller is visited.
- `export const COORD_LIFT_REASON_MIN = 16; export const COORD_LIFT_REASON_MAX = 300;`
- `export function coordLiftReason(raw: unknown): { ok: true; reason: string } | { ok: false; detail: string }` — a string, trimmed, no `\n` or `\r`, at least `COORD_LIFT_REASON_MIN` characters, then `cutWhole(redactCommand(trimmed), COORD_LIFT_REASON_MAX)`; a result shorter than the minimum (a cut that dropped a token) is refused too.
- `export type CoordLiftRefusal = 'coord-lift-off' | 'run-closed' | 'not-found' | 'cap-not-reached';`
- `export function coordLiftVerdict(i: { kind: RunKind | 'unknown'; closed: boolean; rounds: number; granted: number; liftedAt: number | null; setting: 'on' | 'off' }): { ok: true; capBefore: number; capAfter: number } | { ok: false; refused: CoordLiftRefusal; detail: string }` — order: setting, kind (not `work` is `not-found`), closed, lifted or under the cap (`cap-not-reached`). Ownership is decided by the route (it needs the registry), not here.
- `export function coordLiftNotice(run: number, by: string, reason: string, capBefore: number, capAfter: number): { title: string; body: string }` — title `Review cap lifted by its coordinator`, body `Run <run>: <by> allowed <capAfter - capBefore> more review rounds (cap <capBefore> to <capAfter>). Why: <reason>`.
- `export const coordLiftEventDetail = (rounds: number, capBefore: number, capAfter: number, reason: string): string` — `coord-lift: rounds <rounds>, cap <capBefore> -> <capAfter>: <reason>`.

- [ ] **Step 1: Write the failing tests** in `review-cap.test.ts`:
  - `describe('effectiveReviewCap and reviewCapRefuses with a grant (D-8125)')`:
    - `expect(effectiveReviewCap(0)).toBe(3); expect(effectiveReviewCap(6)).toBe(9);`
    - `expect(reviewCapRefuses(3, false, 0)).toBe(true); expect(reviewCapRefuses(3, false, 3)).toBe(false); expect(reviewCapRefuses(6, false, 3)).toBe(true); expect(reviewCapRefuses(99, true, 0)).toBe(false);`
  - `describe('coordLiftReason')`:
    - `undefined`, `42`, `''`, `'   '`, `'too short'` are refused with a detail naming 16 and 300;
    - `'two real majors still open\nsecond line'` is refused (one line);
    - `'F1 and F3 are real majors and round 3 closed two of five'` passes unchanged;
    - a 400-character reason comes back at most 300 characters and never ends inside a token;
    - a reason with a `sk-` shaped key comes back with no 8-character slice of the key (the `secret-mask.test.ts` loop idiom).
  - `describe('coordLiftVerdict')`, one `it` per arm:
    - `setting: 'off'` refuses `coord-lift-off` even at the cap;
    - `kind: 'review'` and `kind: 'unknown'` refuse `not-found`;
    - `closed: true` refuses `run-closed`;
    - `rounds: 2, granted: 0` refuses `cap-not-reached`; `rounds: 5, granted: 3` too; `liftedAt: 1` refuses `cap-not-reached` at any rounds;
    - `rounds: 3, granted: 0` answers `{ ok: true, capBefore: 3, capAfter: 6 }`; `rounds: 6, granted: 3` answers `{ capBefore: 6, capAfter: 9 }`.
  - `coordLiftNotice` and `coordLiftEventDetail` words, exactly, for one fixture.
- [ ] **Step 2: Run, see them fail.** `cd server && ./node_modules/.bin/vitest run --maxWorkers=2 test/review-cap.test.ts`
- [ ] **Step 3: Implement** the interfaces above. Update `reviewCapRefuses`'s one caller in `openRun` to pass `0` for now (Task 2 passes the stored grant).
- [ ] **Step 4: Run green**, plus `test/run-routes.test.ts -t "review-round cap"`.
- [ ] **Step 5: Commit** `feat(review-cap): the coordinator lift's pure decider and reason check (D-8125)`.

### Task 2: migration 48 and the store (reviewCapStore.ts)

**Files:**
- Modify: `server/src/coord/schema.ts` (entry 48)
- Create: `server/src/coord/reviewCapStore.ts` (the SQL; `ledgersStore.ts`'s idiom: functions over `DatabaseSync`, `tx` from `./tx.js`)
- Modify: `server/src/coord/store.ts` (delegates; `openRun`'s review arm; `reviewCapStates`; `raiseReviewCapAsk`; remove `reviewCapLifted` in favour of `reviewCapGate`)
- Test: `server/test/coord-db.test.ts`, new `server/test/review-cap-store.test.ts`, `server/test/reconstruction-drill.test.ts`

**Migration 48** (comment block in the file's own form, naming D-8125, the writers and the re-measure recipe):

```sql
ALTER TABLE review_cap ADD COLUMN granted INTEGER;
ALTER TABLE review_cap ADD COLUMN askHandledAt INTEGER;
CREATE TABLE review_cap_lifts (
  id          INTEGER PRIMARY KEY,
  workRunId   INTEGER NOT NULL REFERENCES runs(id),
  at          INTEGER NOT NULL,
  byId        TEXT    NOT NULL,
  reason      TEXT    NOT NULL,
  rounds      INTEGER NOT NULL,
  capBefore   INTEGER NOT NULL,
  capAfter    INTEGER NOT NULL,
  closedAskAt INTEGER
);
CREATE INDEX review_cap_lifts_by_run ON review_cap_lifts(workRunId, id);
```

`granted` NULL reads as 0. `askHandledAt` is when a coordinator lift last closed the open ask; a re-raise clears it.

**Interfaces** (`reviewCapStore.ts`; `CoordStore` keeps one-line delegates of the same names):
- `reviewCapGate(db, workRunId): { liftedAt: number | null; granted: number }` — one row read; absent row is `{ null, 0 }`.
- `raiseReviewCapAsk(db, workRunId, now): boolean` — moves here from `store.ts`. True when it raised: an insert of a new row, OR an update of an existing row whose ask is not open (`askedAt IS NULL OR askHandledAt IS NOT NULL`), setting `askedAt = now, askHandledAt = NULL`. False when the ask is already open. So the ask is once per cap level, not once per run.
- `export type CoordLiftResult = { ok: true; rounds: number; capBefore: number; capAfter: number; closedAskAt: number | null; liftId: number } | { ok: false; refused: CoordLiftRefusal; detail: string }`
- `liftReviewCapByCoordinator(db, i: { workRunId: number; byId: string; reason: string; setting: 'on' | 'off'; now: number }): CoordLiftResult` — ONE `tx`: read the run (kind, state), `rounds` (the one round predicate, the count `reviewCapStates` uses) and `reviewCapGate`; ask `coordLiftVerdict`; on ok upsert `review_cap` with `granted = COALESCE(granted, 0) + REVIEW_ROUND_CAP` and, when the ask is open, `askHandledAt = now`; insert one `review_cap_lifts` row; write one `run_events` row (`fromState = toState` = the run's state, `causedBy = byId`, `detail = coordLiftEventDetail(...)`; the SQL of `recordRunEvent`, inside the same transaction). The decision is re-read inside the transaction, so two racing lifts at one cap cannot both pass.
- `coordLiftsOf(db, ids): Map<number, { count: number; last: CoordLiftRecord }>` — two statements for the batch (count grouped by run, and the max-id row per run), `healthFor`'s rule (D-1299).
- `reviewCapStates` gains `granted`, `askHandledAt` per row and reads `coordLiftsOf` once per batch.

- [ ] **Step 1: Write the failing tests.**
  - `coord-db.test.ts`: a fresh file reaches `user_version 48`; `PRAGMA table_info(review_cap)` lists `granted` and `askHandledAt` as nullable with no default; `review_cap_lifts` exists with its index; a file at 47 holding a `review_cap` row migrates with that row's `askedAt` and `liftedAt` intact and `granted` NULL.
  - `review-cap-store.test.ts` (fixture coord.db, a work run claimed by `lane-a` with N failed review runs naming it):
    - `reviewCapGate` on no row is `{ liftedAt: null, granted: 0 }`;
    - at 3 rounds, a lift answers `{ ok: true, rounds: 3, capBefore: 3, capAfter: 6 }`, `granted` is 3, one `review_cap_lifts` row with every field, one `run_events` row whose `detail` starts `coord-lift: rounds 3, cap 3 -> 6:` and whose `causedBy` is `lane-a`;
    - a second lift at 3 rounds is `cap-not-reached` and writes nothing (row counts in `review_cap_lifts` and `run_events` unchanged) (R9);
    - after three more rounds, a lift answers `capBefore: 6, capAfter: 9`, `granted` is 6, two lift rows (R4);
    - with `liftedAt` set by `liftReviewCap`, a lift is `cap-not-reached` and `granted` is unchanged;
    - `setting: 'off'` is `coord-lift-off` and writes nothing;
    - a closed work run is `run-closed`; a review run id is `not-found`;
    - with an open ask (`raiseReviewCapAsk` true), the lift sets `askHandledAt` and its row's `closedAskAt` is the ask's `askedAt`; with no ask raised, `askHandledAt` stays NULL and `closedAskAt` is NULL;
    - `raiseReviewCapAsk`: true once; false again while open; after a coordinator lift and three rounds, true again with a new `askedAt` and `askHandledAt` NULL (R4, the re-push);
    - the lift writes no `operator_items` or `operator_item_events` row (counts before and after equal) (R7).
  - `review-cap.test.ts` or the run-routes cap describe: `openRun`'s fourth review opens after a coordinator lift and the seventh is refused `cap-review-rounds` with `by: '6'`.
  - `reconstruction-drill.test.ts`: `review_cap_lifts` is named where `review_cap` is (coord.db only, unrecoverable from the registry), and its counted total bumps by one. Re-measure that test's own count words.
  - **Rollback (R6):** a test that opens a user_version 48 file through the older-build path (rule 3: warn, read as-is, migrate nothing) is out of reach of this tree; instead pin in `review-cap-store.test.ts` that a coordinator lift never writes `askedAt` to NULL and never writes `liftedAt`, so an older build reading the file sees a raised ask and no lift (its band shows the run as waiting, its open refuses at 3, the operator can lift). Record that in the migration's comment.
- [ ] **Step 2: Run, see them fail.** `cd server && ./node_modules/.bin/vitest run --maxWorkers=2 test/coord-db.test.ts test/review-cap-store.test.ts test/reconstruction-drill.test.ts`
- [ ] **Step 3: Implement.** `openRun` reads `this.reviewCapGate(reviews)` and calls `reviewCapRefuses(rounds, gate.liftedAt !== null, gate.granted)`. `reviewCapLifted` is removed and its test callers move to `reviewCapGate(...).liftedAt !== null`.
- [ ] **Step 4: Run green**, plus `test/run-routes.test.ts -t "review-round cap"`, `test/secret-mask.test.ts -t "review-cap"`, and `test/growth-check.test.ts` (store.ts net growth at or under 40).
- [ ] **Step 5: Commit** `feat(review-cap): granted rounds and the coordinator lift's journal, migration 48 (D-8125)`.

### Task 3: the wire (shared/api.ts, shared/refusal.ts)

**Files:**
- Modify: `shared/api.ts` (`ReviewCapStatus`, new `CoordLiftRecord`, new `ReviewRoundsLiftAnswer`, `ServerCap`/`SERVER_CAP_MAP`)
- Modify: `shared/refusal.ts` (a `REVIEW_ROUNDS_REFUSALS` table in `LEDGER_ROUTE_REFUSALS`' idiom, its `REFUSAL_STATUS` rows)
- Modify: `server/src/coord/reviewcap.ts` (`reviewCapStatus`)
- Test: `server/test/review-cap.test.ts`, `server/test/server-caps.test.ts`, `server/test/mail-routes.test.ts` (code census), `server/test/single-definition.test.ts` if it lists refusal tables

**Interfaces:**
- `export interface CoordLiftRecord { at: number; by: string; reason: string; rounds: number; capBefore: number; capAfter: number; count: number }` (`count` is how many coordinator lifts the run has had).
- `ReviewCapStatus` becomes `{ rounds; cap; askedAt; liftedAt; granted: number; askHandledAt: number | null; coordLift: CoordLiftRecord | null }`, where `cap` is now the EFFECTIVE cap (`effectiveReviewCap(granted)`). Doc comment: an older server sends neither new field, and `cap` is then 3.
- `export interface ReviewRoundsLiftAnswer { ok: true; run: number; rounds: number; capBefore: number; capAfter: number; closedAsk: boolean }`
- `ServerCap` gains `'review-rounds-v1'`, with its promise: this server answers `POST /api/runs/:id/review-rounds` (D-8125) as specified; added by the change that builds the door, cut after it.
- `REVIEW_ROUNDS_REFUSALS = { coordLiftOff: 'coord-lift-off', capNotReached: 'cap-not-reached' }`, both 409. `run-closed`, `not-found`, `bad-request`, `not-your-programme`, `run-unreadable` and `not-configured` are reused.
- `reviewCapStatus(kind, rounds, row)` takes the widened row and fills the new fields (`granted ?? 0`, `askHandledAt ?? null`, `coordLift ?? null`).

- [ ] **Step 1: Failing tests.** `reviewCapStatus` on a row with `granted: 3` answers `cap: 6`; with no row answers `granted: 0, askHandledAt: null, coordLift: null, cap: 3`; review run still `null`. `server-caps.test.ts`: `SERVER_CAPS` includes `review-rounds-v1` and the word matches the file grammar. The existing run-routes "GET /api/runs carries the cap's state" `toEqual`s gain the three fields (they fail until filled).
- [ ] **Step 2: Run, fail.** `test/review-cap.test.ts test/server-caps.test.ts test/run-routes.test.ts -t "cap"`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Green**, plus `test/mail-routes.test.ts` (every new code word is quoted where the census requires).
- [ ] **Step 5: Commit** `feat(review-cap): the run row carries the grant and the coordinator's lift (D-8125)`.

### Task 4: the box setting CCRC_REVIEW_CAP_COORD_LIFT

**Files:**
- Modify: `server/src/config.ts` (`ReviewCapCoordLift`, `reviewCapCoordLiftOf(env)`, `cfg.reviewCapCoordLift`)
- Modify: `ccd/ccrc` (`CCRC_SETTINGS`, `BOX_SETTINGS_TABLE` row `CCRC_REVIEW_CAP_COORD_LIFT:value:coordination:server,both:run`, the value-words row `CCRC_REVIEW_CAP_COORD_LIFT:on,off`, the family's check and says functions beside `_mg_ok`/`_mg_says`, and `cmd_settings`' snapshot line, as D-8122 added its four)
- Modify: `shared/api.ts` (`BoxSettingFamily` + `'coordination'`, `BOX_SETTING_TABLE` row, `BOX_SETTING_VALUE_WORDS` `['on', 'off']`, "All 94 of `CCRC_SETTINGS`")
- Modify: `pwa/src/fleet/boxSettingsWords.ts` (family label `Coordination`)
- Modify: `README.md` (the configuration table row and the box-settings paragraph), `deploy/ccrc.env.example` (commented row)
- Modify: `server/test/fixtures/box-settings/ok--*.json` (the row, by hand, in the verb's shape; Linux CI regenerates and re-checks)
- Test: `server/test/config.test.ts`, `box-settings-table.test.ts`, `ccrc-settings-census.test.ts`, `ccrc-settings-verb.test.ts`, `box-settings-read.test.ts`, `pwa/test/box-settings-card.test.tsx`

**Interfaces:** `export type ReviewCapCoordLift = 'on' | 'off'`; `reviewCapCoordLiftOf(env: NodeJS.ProcessEnv): ReviewCapCoordLift` — absent or empty is `on` and silent; `on`/`off` as given; anything else warns once (`ccrc-server: CCRC_REVIEW_CAP_COORD_LIFT=... is not one of on|off; it reads as on (the default).`) and reads `on`. `ccrc-api`'s `ccd/lib/ccrc-settings.sh` is not regenerated: no fleet sweep reads this key (state it in the `CCRC_SETTINGS` comment).

- [ ] **Step 1: Failing tests.** `config.test.ts`: `{}` is `on`; `{CCRC_REVIEW_CAP_COORD_LIFT: 'off'}` is `off`; `'OFF'` and `'0'` warn and read `on`. The table, census and card tests fail on the missing key and family (their existing equalities).
- [ ] **Step 2: Run, fail.** `cd server && ./node_modules/.bin/vitest run --maxWorkers=2 test/config.test.ts test/box-settings-table.test.ts test/ccrc-settings-census.test.ts test/ccrc-settings-verb.test.ts test/box-settings-read.test.ts`, and `cd pwa && ./node_modules/.bin/vitest run --maxWorkers=2 test/box-settings-card.test.tsx`
- [ ] **Step 3: Implement.** Re-measure every count word the census scans (93 to 94, the card's family count).
- [ ] **Step 4: Green.** Known Mac-only skips stay as they are; the corpus regeneration case is Linux-only.
- [ ] **Step 5: Commit** `feat(settings): CCRC_REVIEW_CAP_COORD_LIFT turns the coordinator's cap lift off fleet-wide (D-8125)`.

### Task 5: the coordinator's door, POST /api/runs/:id/review-rounds

**Files:**
- Create: `server/src/coord/reviewRoundsRoute.ts` (`registerReviewRoundsRoute(app, deps)`; deps are the route's: `coord`, `requireMailToken`, `requireAttribution`, `coordMutex`, `notice`, `setting`)
- Modify: `server/src/coord/routes.ts` (one registration call, passing the gates it already holds; growth under 40)
- Modify: `server/src/server.ts` only if a route list there must name it (re-measure)
- Test: new `server/test/review-rounds-route.test.ts`; census pins in `routes.test.ts`, `auth-gate.test.ts`, `coord-pause-route.test.ts`, `secret-mask.test.ts`, `mail-routes.test.ts`

**The handler, in order** (a cheaper refusal is never reached after an expensive one):
1. `notConfigured` without a store (501).
2. `requireMailToken(req, reply, 'POST /api/runs/:id/review-rounds')` (401).
3. Id `parseCanonicalPositiveSafeInteger`, body `{ byId: string, byUuid: string, reason }` shape, `coordLiftReason(reason)`: 400 `bad-request` with the detail (R3).
4. `requireAttribution(reply, byId, byUuid, 'byUuid')` (the verdict's own refusal and status).
5. `coord.run(id)`: unreadable is 503 `run-unreadable`; absent is 404 `not-found`.
6. Ownership: `run.claimedBy === byId || coord.claimsProgramme(byId, run.program)`, the throw mapped to 503 `run-unreadable` as `owns` does in `ledgersRoutes.ts`; otherwise 403 `not-your-programme`, detail `<byId> holds no open run of programme <program>` (R1, R2).
7. `coordMutex.run(() => coord.liftReviewCapByCoordinator({ workRunId: id, byId, reason, setting: deps.setting, now }))`; a refusal answers through `refuseRoute` with its word and detail (`coord-lift-off`, `run-closed`, `not-found`, `cap-not-reached`).
8. On ok: `notice({ kind: 'coord', sessionId: '', runId: id, ...coordLiftNotice(...) }, 'record-only', { degraded: 'lift recorded, feed archive degraded' })`, and answer 200 `ReviewRoundsLiftAnswer`.

The setting is read once at start (`cfg.reviewCapCoordLift`); the answer to `off` names it: `coordinator lifts are off on this box (CCRC_REVIEW_CAP_COORD_LIFT=off); the operator lifts the cap`.

- [ ] **Step 1: Failing tests** in `review-rounds-route.test.ts`. Fixture: `idGateFixture`'s `seedRow` for `lane-a` (claims `prog-a`'s work run), `lane-b` (claims `prog-b`), and `demo-w1` (the work run's bound worker); `capApp`/`round` from `run-routes.test.ts`'s cap describe, moved to a shared fixture file if both suites need them.
  - 401 with no box token; 501 with no store.
  - R3: no `reason`, `''`, a 10-character reason, a two-line reason, a 301-character reason with no whitespace (cut to under the minimum): 400 `bad-request`, nothing written.
  - Attribution: a stale `byUuid` for `lane-a` is refused by the attribution verdict, nothing written.
  - R1: `demo-w1` with its own fresh pair at the cap: 403 `not-your-programme`; `granted` 0, no lift row.
  - R2: `lane-b` with its fresh pair on `prog-a`'s run: 403 `not-your-programme`; nothing written.
  - Under the cap (2 rounds): 409 `cap-not-reached`.
  - At the cap (3 rounds, after the 4th open was refused and the operator's ask raised): 200 `{ ok: true, run, rounds: 3, capBefore: 3, capAfter: 6, closedAsk: true }`; `GET /api/runs` row `reviewCap` has `cap: 6, granted: 3`, `askHandledAt` a number and `coordLift` `{ by: 'lane-a', reason, rounds: 3, capBefore: 3, capAfter: 6, count: 1 }`; the feed has one `record-only` `kind: 'coord'` event titled `Review cap lifted by its coordinator` naming the run and the reason, and no new push; the 4th review open now answers 200.
  - R4: a second lift straight away is 409 `cap-not-reached`. After rounds 4 to 6, the 7th open is refused `cap-review-rounds` `by: '6'` and the operator's ask is pushed again (a second `Review cap reached` notice); a lift then answers `capBefore: 6, capAfter: 9`, `coordLift.count` 2, and two `coord-lift:` run events.
  - R5: an app built with `reviewCapCoordLift: 'off'`: 409 `coord-lift-off` naming the setting, nothing written; the operator's `POST /api/coord/review-cap` still answers 200 and the open succeeds.
  - Operator first: after the operator's lift, a coordinator lift is 409 `cap-not-reached`.
  - A closed work run: 409 `run-closed`.
  - R7: `operator_items` and `operator_item_events` row counts are equal before and after every lift above.
  - R8 (`secret-mask.test.ts`): a reason carrying a compatible key is stored with no 8-character slice of the key, and `GET /api/runs` sends none.
  - Census pins, re-measured counts: `routes.test.ts` lists `{ method: 'POST', routePath: '/api/runs/:id/review-rounds' }`; `auth-gate.test.ts` bumps its route counts with a comment line "N since `POST /api/runs/:id/review-rounds` (D-8125): a box-token machine lane, EXEMPT like the claim lanes, attribution checked"; `coord-pause-route.test.ts` names it in neither `UNGATED` nor `SESSION_ONLY`.
- [ ] **Step 2: Run, fail.** `cd server && ./node_modules/.bin/vitest run --maxWorkers=2 test/review-rounds-route.test.ts test/routes.test.ts test/auth-gate.test.ts test/coord-pause-route.test.ts test/secret-mask.test.ts test/mail-routes.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Green**, plus `test/run-routes.test.ts -t "review-round cap"` and `test/growth-check.test.ts`.
- [ ] **Step 5: Commit** `feat(review-cap): the coordinator's door extends a reached cap by three rounds, with a reason (D-8125)`.

### Task 6: the client row (ccd/ccrc-api)

**Files:**
- Modify: `ccd/ccrc-api` (`ROUTES` row, header and table count words, the server-cap refusal)
- Test: `server/test/ccrc-api.test.ts`, `server/test/ccrc-api-closed.test.ts`

**Interfaces:**
- `[runs.review-rounds]='POST|/api/runs/{id}/review-rounds|yes|-'`, with a comment: the coordinator's bounded cap extension (D-8125); the body rides `--json -` as `{"byId":…,"byUuid":…,"reason":"…"}`, the attribution pair the caller's own (`ccrc-api whoami`), as `claims.take` and `asks.answer` carry theirs; the operator's removal of the cap has no row here and never will.
- Before sending this row: when `_api_server_cap review-rounds-v1` can read a CURRENT cap file (`SERVER_CAPS_LEASE_S`) and the word is absent, refuse locally `no-review-rounds-door` with detail `this box's server predates the coordinator's review-rounds door; the cap is the operator's to lift`. A stale or absent file sends the request (the server's 404 is then the answer), the `questions-v1` rule (D-7328).
- "fifty-eight" becomes "fifty-nine" in both scanned places.

- [ ] **Step 1: Failing tests.** `ccrc-api.test.ts`: the count matches the table; `runs review-rounds 7 --json -` posts to `/api/runs/7/review-rounds` with the body unchanged; a current cap file with `questions-v1` only refuses `no-review-rounds-door` and sends nothing (the fixture server sees no request); a cap file older than the lease sends; no cap file sends. `ccrc-api-closed.test.ts`: the executable-corpus parity sees the skill's new call declared (fails until Task 7 too; land 6 and 7 together if the parity is one test).
- [ ] **Step 2: Run, fail.** `cd server && ./node_modules/.bin/vitest run --maxWorkers=2 test/ccrc-api.test.ts test/ccrc-api-closed.test.ts`
- [ ] **Step 3: Implement.** Run `shellcheck ccd/ccrc-api` if available.
- [ ] **Step 4: Green.**
- [ ] **Step 5: Commit** `feat(ccrc-api): runs review-rounds, the coordinator's cap extension (D-8125)`.

### Task 7: the coordinator skill

**Files:**
- Modify: `ccd/coordinator-skill/SKILL.md` (step 5's `cap-review-rounds` sentence)
- Modify: `ccd/coordinator-skill/references/wave-lifecycle.md` (the `cap-review-rounds` row, and a short "Extending a reached review cap" subsection beside it)
- Test: `server/test/coordinator-skill.test.ts`

**The text says, in the skill's own voice:**
- On `cap-review-rounds`, do not retry the open. Decide first whether another round is truly needed.
- **Extend only when all hold:** the last review left real, unresolved MAJOR findings (not minors, style or taste); the last round made measurable progress (fewer or narrower majors than the round before, so the work converges); and the next round has a named scope (the findings it must close).
- **Stop instead when:** the open findings are minors or style; the last two rounds churned on the same findings with no progress; the open finding is a known limit or needs the operator's ruling (raise a `decide` item instead); or the work is past the operator's review-round cutoff, 2 rounds, 3 for security work, unless you judge that this work must go on and say why in the reason.
- **How:** `"$API" runs review-rounds <work run id> --json -` with `{"byId":"<your id>","byUuid":"<your uuid>","reason":"<one line: which majors are open and real, and why they converge>"}` (16 to 300 characters). It allows three more rounds; at the next cap decide again. Every extension is recorded on the run and shown to the operator.
- **Refusals:** `coord-lift-off` (the operator has turned coordinator extensions off on this box) and `no-review-rounds-door` or a 404 (an older server): the cap is the operator's; rule on the findings you hold, or wait. `cap-not-reached`: the cap is not reached, or the operator already lifted it; open the review. `not-your-programme`: you do not claim this run's programme; do not retry.
- The text never contains `review-cap` (with a hyphen), never names `/api/coord/`, and never names the operator's door.

- [ ] **Step 1: Failing tests** in `coordinator-skill.test.ts`:
  - the skill names `runs review-rounds`, `coord-lift-off`, `cap-not-reached`, and the cutoff words `2 rounds` and `3 for security`;
  - the existing forbid-mention case (`review-cap`) stays and still passes; its comment and the operator-dial list entry for `POST /api/coord/review-cap` gain one line: the operator's removal stays unnamed; the coordinator's bounded extension is `POST /api/runs/:id/review-rounds` (D-8125);
  - the route census that every coord route is named or listed: `POST /api/runs/:id/review-rounds` is named.
- [ ] **Step 2: Run, fail.** `cd server && ./node_modules/.bin/vitest run --maxWorkers=2 test/coordinator-skill.test.ts test/ccrc-api-closed.test.ts`
- [ ] **Step 3: Write the text.**
- [ ] **Step 4: Green.**
- [ ] **Step 5: Commit** `docs(coordinator-skill): when a coordinator extends a reached review cap, and when it stops (D-8125)`.

### Task 8: the console shows it (PWA)

**Files:**
- Modify: `pwa/src/fleet/reviewCapWords.ts` (`capWaiting`, new `coordLiftLine`)
- Modify: `pwa/src/fleet/ReviewCapBand.tsx` (a `coordinator` row)
- Modify: `pwa/src/fleet/runDetailWords.ts` (`runFacts`: a `reviewCap` fact)
- Test: `pwa/test/review-cap-words.test.ts`, `pwa/test/review-cap-band.test.tsx`, `pwa/test/run-detail.test.tsx`, new `pwa/browser/review-cap-coord.browser.test.ts`

**Interfaces:**
- `capWaiting(run): 'waiting' | 'lifted' | 'coordinator' | null` — `waiting` only when `askedAt !== null && liftedAt === null && (askHandledAt ?? null) === null`; `lifted` when the operator lifted; `coordinator` when `coordLift` is set and the ask is handled or not raised; closed or unmeasured is `null`, as today. A row from an older server (no `askHandledAt`, no `coordLift`) reads exactly as before (R6).
- `coordLiftLine(cap: ReviewCapStatus): string | null` — `Cap lifted by its coordinator: <reason>` (the reason as the server sent it), or `null`.
- The band's `coordinator` row: `Run <id>: <coordLiftLine>`, with `<rounds> of <cap> rounds` after it; no button.
- The run page's fact: label `Review cap`; parts `<rounds> of <cap> rounds`, then `· Cap lifted by its coordinator: <reason>` (with `, <count> times` when `count > 1`) or `· Lifted by the operator`. Absent for a review run or an unmeasured cap. The Lift cap control stays keyed on `capWaiting(run) === 'waiting'`, so a coordinator-handled ask shows no operator control.

- [ ] **Step 1: Failing tests.**
  - `review-cap-words.test.ts`: an open ask handled by a coordinator is `coordinator`, not `waiting`; a re-raised ask (new `askedAt`, `askHandledAt` null) is `waiting` again; an older server row (`{ rounds, cap, askedAt, liftedAt }` only) answers as today; `coordLiftLine` words.
  - `review-cap-band.test.tsx`: the coordinator row renders the line and no Lift cap button.
  - `run-detail.test.tsx`: the `Review cap` fact for each of the three states and for `count: 2`; no Lift cap control when handled.
  - `review-cap-coord.browser.test.ts`: at 375, 1024 and 1440 pixels wide, the band row and the run page fact wrap without horizontal scroll and the reason is not truncated (the widths rule: phone, laptop, wide).
- [ ] **Step 2: Run, fail.** `cd pwa && ./node_modules/.bin/vitest run --maxWorkers=2 test/review-cap-words.test.ts test/review-cap-band.test.tsx test/run-detail.test.tsx`, then `CCRC_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/review-cap-coord.browser.test.ts browser/runs-widths.browser.test.ts`
- [ ] **Step 3: Implement.** Words in the console's idiom: sentence case, plain words, no raw state tokens.
- [ ] **Step 4: Green**, plus `pwa/test/refusal-literal-ratchet.test.ts` and the server pins that scan `pwa/src` (at least `docs-parity`, `continued-in-parity`, `ci-reach-census`, `child-reclaim-chip-source`, `collect-readers`, `fleet-health`, `ledgers-registry-ids`, `run-routes`, `stall-settings`; re-measure the list with `grep -l "pwa/src" server/test/*.test.ts`), at most twelve files a command.
- [ ] **Step 5: Commit** `feat(runs): the run board and the run page show a cap its coordinator lifted, and why (D-8125)`.

### Task 9: docs and the whole-branch pass

**Files:**
- Modify: `README.md` (the review cap paragraph: the coordinator's extension, the setting, the operator's lift unchanged; the route in the coordination API table with its auth)
- Modify: this plan's "As built" section (added at the end of the wave: figures, growth, any spare departure)

- [ ] **Step 1:** README text; run `server/test/docs-parity.test.ts` and `server/test/anchors.test.ts`.
- [ ] **Step 2:** Whole-branch checks: `cd server && npx tsc --noEmit`, `cd pwa && npx tsc --noEmit`, the touched suites again (twelve files a command, `--maxWorkers=2`), `test/growth-check.test.ts`. Known Mac-only failures (push-copy, mail-sweep, history-replay, agent deploy-verify D3b-e) are recorded, not fixed.
- [ ] **Step 3:** Re-measure the migration slot against `origin/main` and renumber if main moved.
- [ ] **Step 4: Commit** `docs(review-cap): the coordinator's extension in README, and the plan's as-built (D-8125)`.

## Known limits

- **Identity is attribution, not authentication.** A worker that reads its coordinator's `.uuid` and presents that pair
  passes the gate, as on every coordinator lane. The lift is still bounded (+3 a time, only at a reached cap) and
  recorded under the presented id, and the setting turns it off fleet-wide.
- **The operator is still pushed at every cap.** The refusal's push is unchanged, so an operator gets the notice and then
  sees it handled. Holding the push for a grace period while the coordinator decides is a follow-up, not built.
- **No ceiling on coordinator lifts.** Each lift needs a reached cap and a new reason, and is recorded; a total ceiling
  (for example, an operator lift needed after 12 rounds) is not built.
- **Skew, older PWA.** A cached console older than this server shows a coordinator-handled ask as waiting until it
  reloads; its Lift cap removes the cap, which is the operator's lift and harmless.
- **Skew, server rollback.** An older server on a user_version 48 file ignores `granted`, refuses at 3 rounds, raises no
  new notice (the row exists) and shows the run as waiting (its `askedAt` is set). The operator lifts as before.
- **The setting is read at server start.** Changing `CCRC_REVIEW_CAP_COORD_LIFT` in `ccrc.env` takes effect on the
  server's next restart, as D-8122's server-read settings do.
- **Settings are written in `~/.ccrc/ccrc.env`.** The console card shows the value; it does not write it.

## As built

- Eight code tasks and this docs task landed as separate commits on one branch; every task kept the plan's interfaces
  (`coordLiftVerdict`, migration 48, `registerReviewRoundsRoute`, `reviewCapCoordLiftOf`, `runs review-rounds`, the
  `review-rounds-v1` cap, `coordLiftLine`).
- Migration slot: re-measured against `origin/main` at the end of the wave (47 entries there, 48 here); no renumbering.
- Departures from the plan text: none beyond fixture typing in `server/test/review-cap.test.ts` (the `coordLiftVerdict`
  fixture is typed as the verdict input so the tests-inclusive typecheck is clean).
- Known limits are as listed above; the Mac-only failures (push-copy, mail-sweep, history-replay, agent deploy-verify
  D3b-e) are recorded, not fixed.
