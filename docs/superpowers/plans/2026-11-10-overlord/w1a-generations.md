# Overlord W1a: `continuity_generations`, its one writer, and the generations lane in shadow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** every reported start of a long-lived session mints a generation row, the previous one ends with its outcome,
and each active generation carries the `renewalDue` answer of its last pass, all recorded by one lane that, in this
piece, takes no act on any session.

**Why:** "Every generation is a row of `continuity_generations`, which records why it was due, its model, lane and card
hash" (C36), and its one writer is the renewal lane (H12). Recording first, with nothing acting, gives the shadow
period its evidence: how often each trigger would have fired, for which roles, and how often a reading was blind. The
renewal-act piece arms the acts on the same lane.

**Architecture:** one table and its store module (every step a compare-and-set on `(identity, term, n, state)`); one L4
pass on a `LANE_SCHEDULE` row that reads `continuity_starts` from a cursor, asks `roleOf` and `generationStep` (mint,
end) and `renewalDue` (due columns), and writes through the store. The lane's arming row, `continuity`, is added to the
Shadow lanes card seeded `shadow`; in this piece `live` changes nothing (the renewal-act piece gives it meaning). One
pull request.

**Tech Stack:** TypeScript (ESM), `node:sqlite`, vitest. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-09-overlord-design.md` §3.3.1 (C36), §3.3.8 (each landing mints a generation),
§3.3.9 (keys: a coordinator's state is keyed by its session id, its term is its registry row's generation), §3.3.11
(H12: the row, one writer, `due` is two columns, every start mints, deadlines are durable columns), Table 11.1a row
`continuity_generations`, Table 11.1c rows "The renewal lane", §11.5 (observed time; an older server reads the newer
database).

## What exists today

- `continuity_starts` and `continuity/continuityStore.ts` (the start-report piece): one row per reported start, with
  `sessionId`, `uuid`, `source`, `model`, `rowIncarnation`, `receivedAt`; `startsSince(sinceId)`.
- The deciders (the renewal-deciders piece): `generationStep`, `renewalDue`, `RENEWAL_ROWS`, `observeTime`, and
  `shared/continuity.ts`'s vocabulary.
- `roleOf` and `roleFactsOf` (`server/src/roleOf.ts`, the latter from the renewal-deciders piece, Task 0).
- The context readings (the context-readings piece): `readUsageMeasured` with `ctxTokens`/`ctxWindow`/`stale`,
  `readCompactionsMeasured`, `compactionsSince`.
- The turn marker: `server/src/turnmark.ts#readTurnMarkMeasured` (`state`, `stopAt`, `turnAt`, `bg`, `lostBg`, …).
- The roll's "behind" test: the roll lane reads a session's process start against the completed-install record
  (`server/src/rollLane.ts`, `server/src/coord/rollTarget.ts`); measure its function in Task 3 Step 1.
- `LANE_SCHEDULE` (`server/src/laneSchedule.ts`) and the case lane (`server/src/coord/casesLane.ts`), the model of a
  lane that reads durable rows on a cadence and writes only its own table.
- `shared/lane-arm.ts#LANE_ARM_LANES` (D-8274).

## Global Constraints

- **Architecture (`CLAUDE.md`).** One writer per fact: the generations lane is the only writer of
  `continuity_generations` (named in `server/test/single-definition/writers-map.test.ts`); the lane's cursor is a
  column of its own row (`continuity_cursor`), written by the same lane. Decide in L1, act in L4: the lane gathers
  readings and calls the deciders; it makes no decision inline. Adapters keep every distinction: a reading that fails
  reaches `renewalDue` as `unmeasured` with its reason. Additive wire: nothing crosses the fleet frame. A guard ships
  with a test that goes red without it.
- **SAFETY (`CLAUDE.md`).** This piece acts on no session: no `CcdArgv`, no mail, no push. It writes only its own two
  tables. The server never places a session.
- **Shadow is structural.** The lane imports nothing that sends (no `ccdargv`, no mail store method, no push); an import
  pin in its test holds that, as the case lane's does.
- **Tests.** From `server/`: `ccrc test -- ./node_modules/.bin/vitest run test/<file>.test.ts`; the last run adds both
  `tsc` runs. **Growth check:** `server/src/coord/store.ts` grows at most 40 net lines (delegates only).
- **Time.** The lane takes `Deps.time`; state deadlines are wall-clock columns (they fail towards the operator), the
  least age and the hold-off are observed-time columns (their expiry permits a renewal, §11.5). The lane keeps no timer
  handle: it is a `LANE_SCHEDULE` row (the carried constraint "a kept `Cancel` is a scheduler").
- **Migration slots** re-measured before merge; tests find slots by `findIndex`. Cite by symbol or `@anchor`. No private
  names. No D-number invented; departures go in
  `docs/superpowers/plans/2026-11-10-overlord/w1a-generations/departures.md`.

## Review Focus

1. Mint and end are one transaction: no instant exists with two non-ended generations for one identity, and a
   resent start mints nothing (the start's id is on the row, unique).
2. A compaction start mints nothing; a fork's start (if any arrives) mints nothing and ends nothing; a child's start
   (if any arrives) mints nothing; an undecided role mints nothing and is counted.
3. A pass after a restart resumes from the cursor and the stored columns, never from memory.
4. Shadow writes only the two tables, by an import pin that goes red if the lane gains a sending import.

---

### Task 1: The table and its store

**Files:**
- Modify: `server/src/coord/schema.ts` (one migration: `continuity_generations`, `continuity_cursor`, and the lane-arm
  seed row `continuity`, `shadow`)
- Modify: `server/src/continuity/continuityStore.ts` (the generation functions)
- Modify: `server/src/coord/store.ts` (delegates)
- Modify: `shared/lane-arm.ts` (`CONTINUITY_LANE` in `LANE_ARM_LANES`, card words: "Renew long-lived sessions"; one
  append-only row, shared with the launch-profiles piece: see the index's "Where lanes meet")
- Modify: `pwa/src/fleet/ShadowLanesSection.tsx` (its `Record<LaneArmLane, …>` needs the new lane's entry, or the PWA
  does not compile; one append-only entry)
- Modify: `server/test/single-definition/writers-map.test.ts`
- Test: `server/test/continuity-generations-store.test.ts` (new), `server/test/coord-db.test.ts`, the lane-arm suites,
  the Shadow lanes card's suite (measure: `grep -ln 'ShadowLanesSection' pwa/test`) and pwa's `tsc`

**Schema:**

```sql
CREATE TABLE continuity_generations (
  id          INTEGER PRIMARY KEY,
  identity    TEXT NOT NULL,          -- a coordinator's session id; 'overlord' from W1
  sessionId   TEXT NOT NULL,
  role        TEXT NOT NULL,          -- a FleetRole word
  term        INTEGER NOT NULL,       -- 1 in W1a; the designation's term from W1
  rowIncarnation TEXT,                -- the registry row's incarnation at the start (continuity_starts), or null
  n           INTEGER NOT NULL,
  state       TEXT NOT NULL,          -- a GenerationState word
  enteredAt   INTEGER NOT NULL,       -- wall ms
  deadlineAt  INTEGER,                -- wall ms; set from STATE_DEADLINE_S by the write that enters a state with a
                                      -- deadline (mint for carded, a step for the others); null in active, degraded, ended
  dueSince    INTEGER, dueWhy TEXT, dueClass TEXT,
  blind       TEXT,                   -- JSON array of RenewalTrigger words the last pass could not read
  model TEXT, lane TEXT, host TEXT,
  cardHash TEXT, snapshotId TEXT,     -- the card piece writes through this store's functions
  attempts    INTEGER NOT NULL DEFAULT 0,
  outcome     TEXT,                   -- a GenerationOutcome word, set when ended
  resumed     INTEGER NOT NULL,       -- the start resumed the old conversation
  startId     INTEGER NOT NULL UNIQUE REFERENCES continuity_starts(id),
  observed    TEXT NOT NULL,          -- JSON Observed (least age and hold-off read it)
  holdOffUntilObservedMs INTEGER,
  UNIQUE (identity, term, n)
);
CREATE UNIQUE INDEX continuity_generations_live ON continuity_generations(identity) WHERE state <> 'ended';
CREATE TABLE continuity_cursor (lane TEXT PRIMARY KEY, lastStartId INTEGER NOT NULL);
```

**Interfaces:** `mintGeneration(input): { ok: true; id } | { ok: false; kind: 'superseded' | 'write-failed' }` (ends the
live row of the identity with its outcome and inserts `n + 1` at `carded`, in one transaction; `superseded` when the
live row is not the `(term, n, state)` the caller read); `stepGeneration(id, expect: {term, n, state}, next):
{ changed: boolean }`; `setDue(id, expect, due): { changed }`; `liveGenerations(): GenRow[] | { ok: false }`;
`advanceCursor(lane, from, to): { changed }`. Every write is a compare-and-set.

- [ ] **Step 1: Failing tests:** mint ends the old row (`outcome` set) and inserts the next in one transaction (a forced
  failure leaves both unchanged); a second live row for one identity is refused by the partial unique index; a stale
  `expect` answers `superseded` / `changed: false`; a start id minted twice answers `superseded`; a mint at `carded`
  sets `deadlineAt` to `enteredAt + STATE_DEADLINE_S.carded × 1000`, a step into `probing` sets its own, a step into
  `active` clears it; the migration's slot, the seed row `continuity` = `shadow`; the Shadow lanes card lists the new
  lane.
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run** this suite, `test/coord-db.test.ts`,
  `test/single-definition/writers-map.test.ts`, the lane-arm suites. Green.
- [ ] **Step 5: Mutation.** Drop the partial unique index: the two-live-rows case goes red. Revert.
- [ ] **Step 6: Commit.** `feat(continuity): continuity_generations, compare-and-set writes, and the continuity lane-arm row`

### Task 2: The pass mints and ends from the starts

**Files:**
- Create: `server/src/continuity/generationsLane.ts` (L4: `generationsPass(deps, now)`)
- Modify: `server/src/laneSchedule.ts` (row `generations`, 30 s, reading durable rows)
- Modify: `server/src/index.ts` (wire it with `Deps.time` and the store)
- Test: `server/test/continuity-generations-lane.test.ts` (new)

The pass reads starts after the cursor (at most 200), and for each: skip `source: compact` and `source: fork` (a
fork is another conversation in the same pane, never this identity's next life); read the session's
registry record and gather facts with `roleFactsOf`; skip a role that is not long-lived, and an undecided reading
(counted, logged once a pass); mint with outcome by source (`clear`/`startup` after a renewal the lane asked for:
`renewed` — none in this piece; a start with no renewal in flight: `crashed` if the old row was `active` and the
row incarnation did not change, `swapped` if the start's account differs from the row's `lane`, else `woken`);
`resumed` from `source: resume`; `observed` from `observeTime(null, clock.mono(), proc)`. Then advance the cursor to the
last id read, in the same transaction as the last mint.

- [ ] **Step 1: Failing tests** (an in-memory `coord.db`, the fake time ports, a fake registry): a coordinator's
  `startup` mints n=1 at `carded`; its `clear` mints n=2 and ends n=1; a `compact` start mints nothing; a `fork` start
  mints nothing and leaves n=2 live; a worker's
  start mints nothing; an unmeasured claim read (undecided `coordinator-or-plain`) mints nothing and is counted; a
  restart of the lane re-reads from the cursor and mints nothing twice; 201 starts take two passes.
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run.** Green.
- [ ] **Step 5: Mutation.** Mint on `compact`: red. Mint on `fork`: red. Revert each.
- [ ] **Step 6: Commit.** `feat(continuity): the generations lane mints a generation at every start of a long-lived session`

### Task 3: The pass records `renewalDue` on every live generation

**Files:**
- Modify: `server/src/continuity/generationsLane.ts` (`gatherRenewalInputs`, L4 reads only, and the due write)
- Test: `server/test/continuity-generations-lane.test.ts`

For each live generation in `active` or `degraded`: read the usage sidecar (context, window, stale), the compactions
since the generation's `enteredAt`, the turn marker (idle), the roll's behind test, the start row (resumed, class), and
for a coordinator the wave-boundary fact (its newest run open and its previous closed, from `CoordStore`); pass every
input the Overlord's rows need and W1a cannot read as `unmeasured` with the reason `"W1"`; call `renewalDue`; write
`dueSince`/`dueWhy`/`dueClass` when it becomes due, clear them when it no longer is, and always write `blind`. Nothing
else happens: no state changes, no act.

- [ ] **Step 1: Measure** the roll lane's behind test (its function and inputs) and the wave-boundary read (which
  `CoordStore` reads answer "the coordinator's newest run is open and the one before is closed"); record both in the
  departures note.
- [ ] **Step 2: Failing tests:** a coordinator at 260k tokens on a 1M window is due `hard-cap`; the same with a stale
  sidecar is not due and lists `hard-cap` in `blind`; two compactions since `enteredAt` make it due `two-compactions`;
  a due generation that falls back under the threshold is cleared; the lane imports no sending module (an import pin:
  the file's value imports are within an allowed list).
- [ ] **Step 3: Run.** Red. **Step 4: Implement.** **Step 5: Run.** Green.
- [ ] **Step 6: Mutation.** Read a stale sidecar as measured: the stale case goes red. Revert.
- [ ] **Step 7: Commit.** `feat(continuity): the generations lane records renewalDue and its blind rows on each pass (shadow)`

### Task 4: The simulator runs the lane

**Files:**
- Modify: `server/test/sim/generationDay.ts` (from the renewal-deciders piece: drive `generationsPass` on the fake
  clock with a real in-memory `coord.db`, in place of the in-memory row)
- Test: `server/test/sim/generation-day.test.ts`

- [ ] **Step 1:** Swap the scenario's row for the lane and the store; keep G1 to G5; add **G6**: after a server crash
  at any step, the next pass leaves exactly one live generation per identity. Note in the scenario's header that the
  pass is synchronous, so the simulator's "async lane runs after the timers" limit does not apply to it.
- [ ] **Step 2: Run** with the CI seeds. Green. **Step 3: Mutation:** advance the cursor before the mint's transaction
  commits: G6 goes red. Revert.
- [ ] **Step 4: Commit.** `test(sim): the generation day runs the real generations lane and store`

## Deviations found

None yet. Decisions this plan takes, by slug:

- **generations-record-before-they-act** — the lane ships recording only; its `continuity` row on the Shadow lanes card
  gains meaning in the renewal-act piece.
- **outcome-from-the-start** — an unplanned start's outcome is read from the start (`crashed`, `swapped`, `woken`), and
  `renewed` is written only for a start the lane asked for.
- **overlord-inputs-unmeasured-until-w1** — the Overlord's rows read `unmeasured` (reason `W1`) in W1a, so they appear
  in `blind` and never fire.
- **fork-is-not-a-generation** — a `fork` start mints nothing and ends nothing; the hook does not report one, and the
  lane skips one that arrives.
- **deadline-set-on-entry** — the write that enters a state with a deadline sets `deadlineAt` from `STATE_DEADLINE_S`
  in the same compare-and-set; nothing else writes it.
- **shadow-week-counts-new-starts-only** — rows are minted only at a reported start, so a long-lived session already
  running when this piece merges has no row until its next start; and in shadow, probes are announced only by the
  live-only first prompt, so most shadow `probing` rows time out to `degraded`. The arming item (the renewal-act piece)
  says both, so its counts are read for what they are.
- **lane-cursor-row** — the lane's position in `continuity_starts` is its own row, `continuity_cursor`, written with the
  last mint of a pass.

## Where things stand

**Needs before it starts:** the start-report piece (`continuity_starts`), the renewal-deciders piece, the
context-readings piece.

**What depends on it:** the card piece (it writes `cardHash` through this store), the probes piece (the probing state),
the notes piece (the handover note on the row), the renewal-act piece (it arms the lane's acts).

**States W1's face may read** (read-only facts for the Overlord's face in the PWA, a W1 screen): a generation's `state`
(`draining` to `probing` is "a renewal in progress", `degraded` is "degraded"), `dueSince`/`dueWhy`, and `n`. This
piece adds no read door for them; W1's board reads the rows.

**Open questions for the operator:** none in this piece. The shadow counts are the evidence the renewal-act piece's
arming question will cite.
