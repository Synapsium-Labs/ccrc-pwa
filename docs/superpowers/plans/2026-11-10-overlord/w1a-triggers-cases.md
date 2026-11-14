# Overlord W1a: the trigger table and the case lane, in shadow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** an L0 trigger table whose first rows are the stall arms, a `practice_cases` table with one writer, and a
lane that records a case, in shadow, when one signature occurs three times in 14 days or in two programmes.

**Why:** a failure that recurs on the fleet is learned again by each programme that meets it. The Overlord design turns
a recurrence into one record, a **case**, so a later wave can review it once (H37). This piece ships only the start: it
records cases and offers no review, sends no mail, pushes nothing and writes no feed row. Reviews, the practice door
and `practiceFor` are W4b's. The value now is a measured baseline of how often the fleet repeats itself, before any
remedy exists to be credited.

**Architecture:** the arm vocabulary moves to L0 so the L0 trigger table can derive from it; a pure L1 decider
(`casesDue`) reads observation rows the store already writes; an L3 store module holds the table's one writer, a
compare-and-set insert; an L4 pass on a `LANE_SCHEDULE` row wires them. Two pull requests: PR A is Tasks 1 to 3
(vocabulary and the decider; no schema, no runtime change), PR B is Tasks 4 to 6 (the read, the migration and store,
the lane).

**Tech Stack:** TypeScript (ESM), `node:sqlite` (`DatabaseSync`), vitest. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-09-overlord-design.md`: §9.7 (Table 9.7a's `trigger` row; "When it ships"),
§10.5 (Cases), §11.1 (Table 11.1a row `practice_cases`; Table 11.1b row "The trigger table"; Table 11.1c row "The
case lane"), §11.5 (an older server reads the newer database; ports for time), §11.7 (exhaustive tests of a
first-match decider, monotonicity, mutation floors), §14 (Table 14, W1a row), Table 13.1 row H37.

## What exists today

Read these before Task 1. Every symbol below is real at the branch point unless it says otherwise.

- **The stall watch's arms.** `server/src/coord/stall.ts#STALL_ARMS` is derived from the private `STALL_ARM_MAP`, a
  total Record of fourteen arms (`quiet`, `limit-cap`, `dialog-cap`, `coord-ball`, `orphan-d`, `restarted`,
  `orphan-e`, `failed`, `frozen`, `dead`, `coord-deaf`, `mail-stuck`, `marker-unreadable`, `coord-blocked`).
  `server/test/stall-vocabulary.test.ts` pins that list in order ("waves 1 and 2 have fourteen arms"). `stall.ts` is
  L1, and the same suite ("imports values only from shared/api.ts (L0) and stallWatchSays ...") pins its value imports
  to `../../../shared/api.js` and `../sessionReading.js` and refuses any `export ... from` re-export (`RE_EXPORT`).
- **Its observation rows.** Each rung the watch decides for a run worker is one `run_events` row with
  `fromState = toState` and `detail` = `stall:<arm>:<rung>:<key>` (sent) or `stall-shadow:<arm>:<rung>:<key>`
  (shadow). `stall.ts#stallDetail` writes the text, `stall.ts#parseStallDetail` reads it back and answers null for
  anything this build cannot name (a later build's arm included).
  `server/src/coord/store.ts#CoordStore.insertObservation` is the writer, deduped on `(runId, detail)`. One episode
  (one `key`) can write up to three rows, one per rung.
- **Run-less notices leave no such row.** A coordinator's notice and any other non-run session's are run-less
  (`coordinator-notices-are-run-less`, comment above `stall.ts#StallSessionInput`): a sent one is a mail row found by
  its subject, an operator push is latched in memory, and a run-less shadow rung records nothing at all.
- **The window read.** `CoordStore.stallObservationsSince(since)` returns every `run_events` row with `at >= since` as
  `StallObservationRow { at, detail }` (`server/src/coord/stallsettings.ts#StallObservationRow`), `at` proven by the
  store's private `persistedInt`, all-or-failure, never a throw. Its one source caller is the stall settings view
  (`coord/routes.ts`, through `stallNoticeCounts`); `stall-settings.test.ts` passes `stallNoticeCounts` literal
  `{ at, detail }` rows, and `test/typecheck-tests.test.ts` typechecks every server test.
  `server/test/stall-settings-store.test.ts` pins its window (M17c), its plan, `SEARCH run_events USING INDEX
  run_events_by_at (at>?)` (M17d), and its failure answers. `run_events` is never pruned (no `DELETE FROM run_events`
  in `server/src`). `coord.db` runs with `PRAGMA foreign_keys = ON` (`db.ts`), and `run_events.runId` references
  `runs(id)`.
- **A run's programme.** `CoordStore.run(id)` answers `RunReadResult`: `{ok:true, run}` with `run.program` (the slug,
  `shared/api.ts#RunSummary`), `{ok:true, run:null}` for no row, `{ok:false, kind:'run-unreadable'}`.
- **Migrations.** `server/src/coord/schema.ts#MIGRATIONS` holds 48 entries (the newest, 48, is `review_cap_lifts`,
  D-8125); `COORD_SCHEMA_VERSION = MIGRATIONS.length`. `server/src/coord/db.ts#openCoordDb` runs each entry in its own
  transaction with its `user_version` bump, refuses to start rather than open empty, and reads a higher `user_version`
  as-is (rule 3), so an older build skips tables it does not know. Each entry carries a "RE-MEASURE the slot" comment.
  `gone_since` (45) is the shape to copy for a new table. `server/test/coord-db.test.ts` pins 48 in three places
  (`COORD_SCHEMA_VERSION` twice, `MIGRATIONS.length` once) and tests each new table by its slot, found with
  `MIGRATIONS.findIndex(...)`, never a literal (the `dead_claimants` describe is the model).
- **Store modules beside the god file.** `server/src/coord/ledgersStore.ts` and `reviewCapStore.ts` hold SQL as
  functions over the store's `DatabaseSync`; `CoordStore` keeps one-line delegates. `store.ts` is under the growth
  check (40 net lines, `server/test/growthCheck.ts#GROWTH_LIMIT`). `persistedInt` is private to `store.ts`; its
  predicate is `shared/api.ts#isPositiveDecimalSafeInteger`.
- **One writer per table.** `server/test/single-definition/writers-map.test.ts` (the `TABLES` list and the describe
  "coord.db's recorded tables: every SQL write is a CoordStore method, by name, may only shrink") names each coord.db
  table's writers.
- **Lanes.** `server/src/laneSchedule.ts#LANE_SCHEDULE` is the one table of cadences (L0), `LaneName` its union. A row
  that follows another constant's cadence names it in `derivedFrom` (the `delegation` row follows
  `DIVERGENCE_SWEEP_MS`); `DRIFT_SWEEP_MS = 900_000` is the drift reconciler's. A row with a `warnKey` catches a
  rejected pass with that sentence; a row with `warnKey: null` hands it to the caller, whose `tick` catch is silent.
  `FleetWatcher.runLane(name, fn)` throttles, single-flights and catches. The closest model for this lane is
  `server/src/coord/untold.ts#untoldPass`, run by `FleetWatcher.sweepUntold` (`server/src/watch.ts`) and dispatched,
  never awaited, from `tick` beside `sweepRunStuck`. `server/src/coord/ports.ts#WatcherCoordMember` is the sorted
  list of store members the watcher's lanes reach; `server/test/rings/watcher-store-port.test.ts` reds on a reached
  member it lacks.
- **Rings and contexts.** `coord/**` is C5 in the architecture spec's context table. A file's ring is decided by
  `server/test/rings/ring.ts#serverRing` from its imports, or by a header such as `// L4 delivery:` when that is
  outward of what the imports say. `shared/*.ts` is L0 and may import only `./` siblings
  (`server/test/rings/shared-imports.test.ts`).
- **Source-text pins are ratcheted.** `server/test/single-definition/advance-switches.test.ts` ("literal source pins
  over every other server/src file may only shrink") counts every `toContain`, `toMatch`, `indexOf` or `match` with a
  literal on a `readFileSync` of a `server/src` file. A new pin on a new file reds; a test reads imports through
  `server/test/scan/symbols.ts#parsedFile` (`imports`: `specifier`, `kind`, `typeOnly`, `typeNames`) instead.
- **Quoted words with one home.** `server/test/single-definition/update-stall.test.ts` holds the quoted literal
  `'stall'` (the sent detail head) to one file, `stall.ts`. `server/test/mail-routes.test.ts` reds on any undeclared
  quoted kebab word under `server/src/coord`.
- **No D-TBD lands.** `server/test/dtbd.test.ts` reds on a concrete `D-TBD-` placeholder in any tracked file.
- **Does not exist today:** a trigger table, a signature type, `practice_cases`, a case lane, the `Clock` port of
  §11.5, and a property-test library (`server/package.json` has `vitest` only).
- **No door.** This piece adds no route, so the box-token census (`server/test/box-token-census.test.ts`) and the
  auth gate's EXEMPT table are untouched. `coord.db` snapshots (`VACUUM INTO`) carry the new table with no change.

## Global Constraints

- Test first: every test is written and seen red before its code. Each new guard names the mutation that turns its
  test red; measure it once before committing (make the mutation, run the suite, see red, revert).
- One commit per task, with the message the task gives.
- Touch only the files a task names.
- Run one suite from inside its package, in the foreground, timeout at least 600000 ms:
  `cd server && ./node_modules/.bin/vitest run test/<file>.test.ts`. Never bare `npx vitest`. Each task's last run
  also includes `./node_modules/.bin/tsc --noEmit` and `./node_modules/.bin/tsc -p test/tsconfig.tests.json --noEmit`
  inside `server`.
- Cite code by symbol (`file.ts#symbol`) or `@anchor`, never by line, in code comments and commit messages.
- Public repository: no private names. Fixtures use programmes `prog-a`, `prog-b`, `prog-c`, project `project-a` and
  claimants `coord-a`, `coord-b`.
- No D-number is invented. Each `D-TBD-<slug>` below is replaced with the number the programme's run mints before any
  commit that names it; `test/dtbd.test.ts` reds on a literal placeholder.
- No new quoted kebab word under `server/src/coord`. Every word this piece writes there is one word (`open`,
  `shadow`, `count`, `programmes`, `observations`, `cases`). If one becomes necessary, export a guard and add it as a
  new union in `mail-routes.test.ts`, never to `NOT_CODES`.
- Time is passed in. The decider takes `now: number` and the pass takes `now: () => number`; neither reads a clock.

## Review Focus

1. One stalled worker writes up to three rungs, live or shadow: it must not open a case alone. Task 3 ("three rungs of
   one episode", "a live and a shadow row of one episode").
2. The lane passes again over the same rows, every beat and after a restart: it opens nothing twice. Task 5 ("a stale
   reader is refused superseded"), Task 6 ("a second pass opens nothing more").
3. An older build, or a rollback from W4b, reads the newer `coord.db`: it boots by rule 3, skips a later column through
   the explicit column lists, and never re-opens what a later build's case holds. Task 5 (the entry's shape; "a row
   in a state this build cannot name still counts as newest").
4. A later build's stall arm, or any row this build cannot parse, is in the window: it changes nothing. Task 3 ("a row
   this build cannot read", the monotonicity property).
5. A store read or write fails mid-pass: a failed read opens nothing and warns; a failed write is warned by the lane's
   row, never swallowed; an unreadable run only lowers a count. Task 6 ("a failing store").

---

### Task 1: The stall arm vocabulary moves to L0

**Why first.** The trigger table is L0 (§9.7, Table 11.1b) and its first rows are the arms. An L0 file cannot import
`stall.ts`, so the arms' one definition moves to `shared/stall-watch.ts`, which already holds the watch's other L0
values. `stall.ts` re-exports, so no caller changes.

**Files:**
- Modify: `shared/stall-watch.ts` (add the arm map, `StallArm`, `STALL_ARMS`, `isStallArm`)
- Modify: `server/src/coord/stall.ts` (remove `STALL_ARM_MAP` and the private `isStallArm`; import and re-export)
- Test: `server/test/stall-vocabulary.test.ts`

**Interfaces:**
- Produces (L0, `shared/stall-watch.ts`): `export type StallArm = keyof typeof STALL_ARM_MAP;`
  `export const STALL_ARMS = Object.keys(STALL_ARM_MAP) as StallArm[];` (as today);
  `export function isStallArm(v: string): v is StallArm` (the `hasOwnProperty` form `stall.ts` uses today).
- `stall.ts` keeps exporting `StallArm` and `STALL_ARMS`; `STALL_ARM_WAVE` stays in `stall.ts`.

- [ ] **Step 1: Characterise.** Run `cd server && ./node_modules/.bin/vitest run test/stall-vocabulary.test.ts`
  on the branch point. Expected: green, including "waves 1 and 2 have fourteen arms". That pin is the
  characterisation; it must stay green, unedited, through Step 4.
- [ ] **Step 2: Write the failing test.** Add to `stall-vocabulary.test.ts`:

```ts
import { STALL_ARMS as L0_ARMS, isStallArm } from '../../shared/stall-watch.js';

it('the arms have one definition, in L0, and stall.ts re-exports the same list', () => {
  expect(L0_ARMS).toBe(STALL_ARMS);
  for (const a of STALL_ARMS) expect(isStallArm(a), a).toBe(true);
  for (const w of ['', 'limit-capp', 'constructor', 'toString']) expect(isStallArm(w), w).toBe(false);
});
```

- [ ] **Step 3: Run it.** Expected: red (the L0 file exports neither name yet).
- [ ] **Step 4: Move.** Cut `STALL_ARM_MAP` (keys and description strings unchanged), `StallArm`, `STALL_ARMS` and
  `isStallArm` into `shared/stall-watch.ts`, below its header; add to the header's "What lives here, once" list a line
  "the stall watch's arms (moved from `coord/stall.ts` so the L0 trigger table can derive from them)". In `stall.ts`,
  re-export by a local `export` with no `from`, because the suite's `RE_EXPORT` scan refuses `export ... from`:
  `import { STALL_ARMS, isStallArm } from '../../../shared/stall-watch.js';`,
  `import type { StallArm } from '../../../shared/stall-watch.js';`,
  `export { STALL_ARMS };` and `export type { StallArm };`.
  In the suite's "imports values only from shared/api.ts (L0) and stallWatchSays ..." test, add
  `'../../../shared/stall-watch.js'` to the allowed specifiers and name it in the title. That is the only edit to an
  existing assertion.
- [ ] **Step 5: Run.** `test/stall-vocabulary.test.ts`, `test/stall-settings.test.ts`, `test/mail-routes.test.ts`,
  `test/single-definition/update-stall.test.ts`, `test/rings/shared-imports.test.ts`, the two `tsc` runs, and
  `cd pwa && ./node_modules/.bin/tsc --noEmit` (pwa's tsconfig includes `../shared`). Expected: all green.
- [ ] **Step 6: Mutation.** Write `export { STALL_ARMS } from '../../../shared/stall-watch.js';` in `stall.ts`: the
  "imports values only" test goes red on its re-export assertion. Revert.
- [ ] **Step 7: Commit.**
  `refactor(stall): the fourteen arms move to L0 (shared/stall-watch.ts); stall.ts re-exports; arm list pinned first`

### Task 2: The L0 trigger table and the signature key

**Files:**
- Create: `shared/practice-triggers.ts` (L0, C5, per Table 11.1b; imports `./stall-watch.js` only)
- Test: `server/test/practice-triggers.test.ts` (create)
- Modify: `server/test/single-definition/vocabularies.test.ts` (one describe)

**Interfaces (Produces):**

```ts
/** The trigger kinds (spec §9.7). W1a: the stall arms. W1 adds refusal words, W2 health words, each as one row. */
const TRIGGER_KIND_TABLE = { 'stall-arm': 'a stall watch arm decided a rung for a run worker (W1a)' } as const;
export type TriggerKind = keyof typeof TRIGGER_KIND_TABLE;
export const TRIGGER_KINDS = Object.keys(TRIGGER_KIND_TABLE) as TriggerKind[];
/** A signature: one row of the trigger table. A union by kind, so W1's refusal row is one more arm. */
export type TriggerSignature = { readonly kind: 'stall-arm'; readonly key: StallArm };
export const TRIGGER_TABLE: readonly TriggerSignature[];           // STALL_ARMS.map((key) => ({ kind: 'stall-arm', key }))
export function signatureText(s: TriggerSignature): string;        // `${s.kind}:${s.key}`, the persisted form
export function parseSignature(text: string): TriggerSignature | null;  // the one reader; null for anything else
```

The kind word is `stall-arm`, not `stall`: the quoted `'stall'` has one home (D-8229).

- [ ] **Step 1: Write the failing test** (`server/test/practice-triggers.test.ts`):

```ts
describe('the trigger table (Overlord spec §9.7, W1a)', () => {
  it('is one row per stall arm, in the arms\' order, under one kind', () => {
    expect(TRIGGER_KINDS).toEqual(['stall-arm']);
    expect(TRIGGER_TABLE.map(signatureText)).toEqual(STALL_ARMS.map((a) => `stall-arm:${a}`));
  });
  it('reads back every signature it writes', () => {
    for (const s of TRIGGER_TABLE) expect(parseSignature(signatureText(s))).toEqual(s);
  });
  it('reads anything else as null, a later wave\'s kind included', () => {
    for (const t of ['', 'stall-arm', 'stall-arm:', 'stall-arm:limit-capp', 'stall-arm:quiet:1', 'stall:quiet',
      'refusal:capability-missing', 'constructor', 'stall-arm:constructor', 'stall-arm:toString']) {
      expect(parseSignature(t), t).toBeNull();
    }
  });
});
```

  And in `vocabularies.test.ts`, a describe "the trigger table has one definition (Overlord §9.7)": `export type
  TriggerSignature`, `export const TRIGGER_TABLE` and `export function parseSignature` each match in exactly one file
  of `ALL`, `shared/practice-triggers.ts`; and `parsedFile('shared/practice-triggers.ts').bindings`' `TRIGGER_TABLE`
  `init` matches `/\bSTALL_ARMS\b/` (derived, never a hand list).
- [ ] **Step 2: Run.** `cd server && ./node_modules/.bin/vitest run test/practice-triggers.test.ts
  test/single-definition/vocabularies.test.ts`. Expected: import failure, then the single-definition describe red.
- [ ] **Step 3: Implement** `shared/practice-triggers.ts` with the interfaces above. `parseSignature` splits at the
  first `:` (no colon is null), checks the kind with `TRIGGER_KINDS.includes` and the key with `isStallArm`. Header:
  "L0: the PWA may bundle this file; it imports only `./stall-watch.js`."
- [ ] **Step 4: Run** the two suites and `test/rings/shared-imports.test.ts`. Expected: green.
- [ ] **Step 5: Mutations.** Replace `isStallArm(key)` with `true`: "reads anything else as null" goes red. Hand-write
  `TRIGGER_TABLE` as a literal array: the single-definition describe goes red.
- [ ] **Step 6: Commit.**
  `feat(shared): the trigger table, one row per stall arm, and its typed signature (Overlord §9.7, W1a)`

### Task 3: The case decider (L1, pure)

**Files:**
- Create: `server/src/coord/practiceCases.ts` (L1 policy, C5; value imports `./stall.js` and
  `../../../shared/practice-triggers.js` only)
- Test: `server/test/practice-cases.test.ts` (create)

**Interfaces:**
- Consumes: `parseStallDetail` (`stall.ts`), `signatureText` (`shared/practice-triggers.ts`).
- Produces:

```ts
export const CASE_WINDOW_MS = 14 * 86_400_000;   // §10.5: three times in 14 days
export const CASE_MIN_OCCURRENCES = 3;
export const CASE_MIN_PROGRAMMES = 2;
export const CASE_MODE = 'shadow' as const;       // W1a: no review exists; W4b computes it from `practice-v1`
const CASE_CAUSE_TABLE = { count: 'three occurrences in the window', programmes: 'two programmes in the window' } as const;
export type CaseCause = keyof typeof CASE_CAUSE_TABLE;
export const CASE_CAUSES = Object.keys(CASE_CAUSE_TABLE) as CaseCause[];

/** L2 port, declared by this consumer: one observation row (the store's `StallObservationRow` satisfies it). */
export interface CaseObservationRow { readonly eventId: number; readonly runId: number; readonly at: number; readonly detail: string | null }
export interface CasesInput {
  readonly rows: readonly CaseObservationRow[];
  readonly programOf: ReadonlyMap<number, string>;        // runId to programme slug; a run absent here is not counted
  readonly newestCaseAt: ReadonlyMap<string, number>;     // signature text to its newest case's openedAt
  readonly now: number;
}
export interface CaseDue {
  readonly signature: string; readonly cause: CaseCause; readonly occurrences: number;
  readonly programmes: readonly string[]; readonly evidence: readonly number[]; readonly windowFrom: number;
}
export function caseWindowFrom(now: number): number;                              // now - CASE_WINDOW_MS
export function caseRunIds(rows: readonly CaseObservationRow[]): number[];        // runs of parseable rows, ascending
export function casesDue(input: CasesInput): CaseDue[];
```

**The rule, stated once.** An **occurrence** is one episode: the rows that parse to the same `(runId, arm, key)`,
whatever their rung or mode (live and shadow both record that the failure happened). Its time is its earliest row's
`at`, and its evidence id is that row's `eventId` (lowest `eventId` on a tie). It is **counted** for signature
`stall-arm:<arm>` when its run is in `programOf`, its time is `>= caseWindowFrom(now)`, and its time is `>` that
signature's `newestCaseAt` (a case consumes its evidence, §10.5). Then, per signature,
first match: no counted occurrence, none; counted `>= CASE_MIN_OCCURRENCES`, `count`; distinct programmes of the
counted occurrences `>= CASE_MIN_PROGRAMMES`, `programmes`; otherwise none. Output is sorted by signature text;
`programmes` and `evidence` ascending.

- [ ] **Step 1: Write the failing tests.** Helpers: `NOW = 1_800_000_000_000`, `FROM = NOW - CASE_WINDOW_MS`,
  `row(eventId, runId, at, arm, key = eventId, rung = 1, mode = 'shadow')` building `detail` with `stallDetail`, and
  `progs(runIds, slug)` = `new Map(runIds.map((r) => [r, slug]))`.

```ts
it('pins the spec\'s values', () => {
  expect([CASE_WINDOW_MS, CASE_MIN_OCCURRENCES, CASE_MIN_PROGRAMMES, CASE_MODE]).toEqual([1_209_600_000, 3, 2, 'shadow']);
  expect(CASE_CAUSES).toEqual(['count', 'programmes']);
});
it('three episodes of one arm in one programme open a count case', () => {
  const rows = [row(11, 1, FROM + 1, 'quiet'), row(12, 2, FROM + 2, 'quiet'), row(13, 3, NOW, 'quiet')];
  expect(casesDue({ rows, programOf: progs([1, 2, 3], 'prog-a'), newestCaseAt: new Map(), now: NOW })).toEqual([
    { signature: 'stall-arm:quiet', cause: 'count', occurrences: 3, programmes: ['prog-a'], evidence: [11, 12, 13], windowFrom: FROM },
  ]);
});
it('two episodes in two programmes open a programmes case', ...);           // runs 1 (prog-a), 2 (prog-b): 'programmes'
it('three rungs of one episode are one occurrence', ...);                    // rungs 1, 2, 3, same run and key: []
it('a live and a shadow row of one episode are one occurrence', ...);
it('the window\'s edge: at FROM counts, at FROM - 1 does not', ...);
it('a case consumes its evidence: only occurrences after the newest case count', ...);
it('a run missing from programOf is not counted', ...);
it('a row this build cannot read, or an arm a later build added, changes nothing', ...);  // 'stall:new-arm:1:5', null, 'x'
it('caseRunIds names each run of a parseable row once, ascending', ...);
```

  **The whole domain.** For every arm in `STALL_ARMS`, for `n` in 0..4 episodes and `p` in 1..max(1, min(n, 3))
  programmes: episode `i` is run `i + 1`, key `i`, rung 1, in `prog-${'abc'[i % p]}`, at `FROM + 1000 * (i + 1)`,
  except that episode 0, the earliest, is at one of {`FROM + 1000`, `FROM`, `FROM - 1`}; `newestCaseAt` for the
  arm's signature is one of {absent, `FROM - 5`, episode 0's time, `NOW`}. Each input also holds two episodes of a
  control arm (`quiet`, or `dead` when the arm is `quiet`; runs 10 and 11, `prog-a`, at `NOW`), which must neither
  open a case nor change the arm's. Compare `casesDue` with an oracle written in the test from the rule above,
  independently of the module: 14 arms x 10 `(n, p)` pairs x 3 x 4, 1,680 inputs.
  **Monotonicity**, over the same grid: removing any one row, deleting any run from `programOf`, or raising any
  signature's `newestCaseAt` never adds a signature to the output; adding a row that does not parse never changes it.
- [ ] **Step 2: Run** `cd server && ./node_modules/.bin/vitest run test/practice-cases.test.ts`. Expected: import
  failure (the module does not exist).
- [ ] **Step 3: Implement** `practiceCases.ts` to the interfaces. Header: "L1 policy: the case lane's decider (Overlord
  spec §10.5). No clock, no I/O, no store." No ambient `Date.now()`.
- [ ] **Step 4: Run.** Expected: green.
- [ ] **Step 5: Mutations, each red:** count rows instead of episodes ("three rungs of one episode"); `>=` to `>` on
  either threshold (the grid's `n = 3` and `p = 2` cells); drop the `programmes` rule (`p = 2` cells); `>= windowFrom`
  to `> windowFrom` (the edge test); ignore `newestCaseAt` ("a case consumes its evidence", the grid's `NOW` cells);
  `> newestCaseAt` to `>=` (the grid's "episode 0's time" cells); count a run absent from `programOf` ("a run
  missing"). If the simulator plan's mutation floors (`MUTANT_SETS`, `server/test/sim/mutation-floors.json`) are on
  the branch point, add `practiceCases.ts` there with these mutants and this suite, and its floor as measured; those
  two files are then this task's too.
- [ ] **Step 6: Commit.**
  `feat(coord): the case decider, 3 in 14 days or 2 programmes, tested over its whole domain (Overlord §10.5)`

---

### Task 4: The observation read names its event and its run

An intended behaviour change of a pinned read, so a commit of its own. It extends the one window read over
`run_events` rather than adding a second (D-8230).

**Files:**
- Modify: `server/src/coord/stallsettings.ts#StallObservationRow` (add `eventId`, `runId`) and the parameter type of
  `stallsettings.ts#stallNoticeCounts` (to `readonly Pick<StallObservationRow, 'at' | 'detail'>[]`, so
  `stall-settings.test.ts`'s literal `{ at, detail }` rows still typecheck; its body is unchanged)
- Modify: `server/src/coord/store.ts#CoordStore.stallObservationsSince` (select `id` and `runId`, each through
  `persistedInt`, all-or-failure as `at` is; update its docstring: it now also serves the case lane)
- Test: `server/test/stall-settings-store.test.ts`

**Interfaces:** `StallObservationRow { readonly eventId: number; readonly runId: number; readonly at: number;
readonly detail: string | null }`. It satisfies `CaseObservationRow` structurally.

- [ ] **Step 1: Change the pin first.** In M17c, the expected rows become:

```ts
[{ eventId: 2, runId: 1, at: SINCE, detail: 'stall:quiet:1:b' }, { eventId: 3, runId: 1, at: SINCE + 5, detail: null }]
```

  Add: "a runId that is not a positive safe integer refuses the whole read, naming the column and no value", in the
  shape of the existing `at` case: `s.db.exec('PRAGMA foreign_keys = OFF')` first (the column references `runs(id)`),
  then plant a row with `runId = 'abc'`; expected `{ ok: false, detail: 'run_events runId is not a positive safe
  integer' }`. Leave M17d (the plan) exactly as it is: the plan must not change.
- [ ] **Step 2: Run** `test/stall-settings-store.test.ts`. Expected: M17c and the new case red; M17d green.
- [ ] **Step 3: Implement.** SQL: `SELECT CAST(id AS TEXT) AS idText, CAST(runId AS TEXT) AS runIdText,
  CAST(at AS TEXT) AS atText, CAST(detail AS TEXT) AS detail FROM run_events WHERE at >= ?`. Column names for
  `persistedInt`: `run_events id`, `run_events runId`, `run_events at`.
- [ ] **Step 4: Run** that suite, `test/stall-settings.test.ts`, `test/stall-settings-route.test.ts`,
  `test/dead-coordinator-store.test.ts` and the two `tsc` runs. Expected: green, M17d still
  `['SEARCH run_events USING INDEX run_events_by_at (at>?)']`.
- [ ] **Step 5: Mutation.** Drop the `runId` proof (push `Number(r.runIdText)`): the new case goes red. Revert.
- [ ] **Step 6: Commit.**
  `feat(coord): the observation window read names each row's event and run; its plan unchanged (Overlord §10.5)`

### Task 5: `practice_cases`, its migration and its one writer

**Files:**
- Modify: `server/src/coord/schema.ts#MIGRATIONS` (append entry 49, which takes `user_version` from 48 to 49;
  re-measure before the PR and before merge, since other W1a pieces also add entries)
- Create: `server/src/coord/practiceCasesStore.ts` (header `// L3 adapter:`; C5; imports `node:sqlite` as a type,
  `isPositiveDecimalSafeInteger` from `../../../shared/api.js`, and `CASE_MODE` and types from `./practiceCases.js`)
- Modify: `server/src/coord/store.ts#CoordStore` (two one-line delegates)
- Test: `server/test/practice-cases-store.test.ts` (create); `server/test/coord-db.test.ts`;
  `server/test/single-definition/writers-map.test.ts`

**The migration** (comment block in `gone_since`'s shape: what it is; "A NEW TABLE AND AN INDEX, nothing on an
existing table: an older build opening a file at `user_version 49` takes rule 3 (it warns, reads as-is and migrates
nothing), never names this table, and boots"; the RE-MEASURE command, which must print 48 before the entry is
counted):

```sql
CREATE TABLE practice_cases (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  signature   TEXT NOT NULL,     -- a trigger signature's text (shared/practice-triggers.ts#signatureText)
  state       TEXT NOT NULL,     -- 'open'; W1a writes nothing else, W4b's review moves it
  mode        TEXT NOT NULL,     -- 'shadow' in W1a: recorded, no review offered
  cause       TEXT NOT NULL,     -- a CaseCause: 'count' | 'programmes'
  occurrences INTEGER NOT NULL,
  programmes  TEXT NOT NULL,     -- JSON array of programme slugs, ascending
  evidence    TEXT NOT NULL,     -- JSON array of run_events ids, ascending
  windowFrom  INTEGER NOT NULL,
  openedAt    INTEGER NOT NULL
);
CREATE INDEX practice_cases_by_signature ON practice_cases(signature, openedAt);
```

**Interfaces (Produces):**

```ts
export type PracticeCaseNewestRead = { ok: true; newest: Map<string, number> } | { ok: false; detail: string };
export type PracticeCaseOpen = { opened: true; id: number } | { opened: false; why: 'superseded' };
/** Each signature's newest openedAt, whatever its state: a later build's state word still consumes evidence. */
export function practiceCaseNewest(db: DatabaseSync): PracticeCaseNewestRead;
/** The table's one writer. Refuses, writing nothing, when a case for the signature is newer than `seenNewest`. */
export function openPracticeCase(db: DatabaseSync, due: CaseDue, seenNewest: number | null, at: number): PracticeCaseOpen;
// CoordStore: practiceCaseNewest(): PracticeCaseNewestRead; openPracticeCase(due, seenNewest, at): PracticeCaseOpen
```

`openPracticeCase` is one statement, the compare-and-set in its `WHERE`:
`INSERT INTO practice_cases (...) SELECT ?, 'open', ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM
practice_cases WHERE signature = ? AND openedAt > ?)`, with `seenNewest ?? -1` and `mode = CASE_MODE`.
`changes === 0` means `superseded`. A thrown statement throws (the pass's lane row warns it, Task 6).
`practiceCaseNewest` is `SELECT signature, CAST(MAX(openedAt) AS TEXT) AS newestText FROM practice_cases GROUP BY
signature`, each value proven by `isPositiveDecimalSafeInteger` (the store's `persistedInt` idiom: all-or-failure,
detail `practice_cases openedAt is not a positive safe integer`), and answers `{ok:false}` on a thrown statement.

- [ ] **Step 1: Write the failing tests.**
  - `coord-db.test.ts`: both `expect(COORD_SCHEMA_VERSION).toBe(48)` lines and `expect(MIGRATIONS.length).toBe(48)`
    become 49, each comment list gaining "and MIGRATIONS[48] (practice_cases, Overlord W1a)". New describe "coord.db:
    practice_cases, the case lane's table (Overlord §10.5)": `SLOT = MIGRATIONS.findIndex((m) => m.includes('CREATE
    TABLE practice_cases')) + 1`, `>= 49`; `pragma_table_info('practice_cases')` as `[name, type, notnull, pk]` equals
    the ten columns above (`['id', 'INTEGER', 0, 1]`, then each `NOT NULL` column with `1, 0`); the entry, `--`
    comments stripped and trimmed, matches `ENTRY` below; and "reaches a database already at the version before it
    and leaves every existing row as it was", copied from the `dead_claimants` describe.

```ts
const ENTRY = /^CREATE TABLE practice_cases \([^;]*\);\s*CREATE INDEX practice_cases_by_signature ON practice_cases\(signature, openedAt\);$/;
```

  - `practice-cases-store.test.ts` (temp store as `run-untold.test.ts` builds one):
    "opens one row with every field" (`{signature:'stall-arm:quiet', state:'open', mode:'shadow', cause:'count',
    occurrences:3, programmes:'["prog-a"]', evidence:'[11,12,13]', windowFrom: FROM, openedAt: NOW}`);
    "practiceCaseNewest answers each signature's newest openedAt";
    "a stale reader is refused superseded and writes nothing" (open at `NOW`, then open again with `seenNewest = null`);
    "a row in a state this build cannot name still counts as newest" (insert `state = 'reviewed'` by hand);
    "an openedAt that is not a positive safe integer refuses the whole read" (plant `openedAt = 'abc'`);
    "a thrown statement answers ok: false, never a throw" (`DROP TABLE practice_cases`).
  - `writers-map.test.ts`: add `'practice_cases'` to `TABLES` and
    `practice_cases: ['server/src/coord/practiceCasesStore.ts#openPracticeCase']` to the expected map.
- [ ] **Step 2: Run** `test/coord-db.test.ts test/practice-cases-store.test.ts
  test/single-definition/writers-map.test.ts`. Expected: version pins red at 48, the rest import or table failures.
- [ ] **Step 3: Implement** the migration, the module and the two delegates.
- [ ] **Step 4: Run** the three suites, `test/growth-check.test.ts` and the two `tsc` runs. Expected: green.
  `store.ts` grows by the delegates and their import only.
- [ ] **Step 5: Mutations, each red:** drop the `WHERE NOT EXISTS` ("a stale reader"); add `WHERE state = 'open'` to
  the newest read ("a row in a state this build cannot name"); write the table from a second function (writers-map).
- [ ] **Step 6: Commit.** `feat(coord): practice_cases, one writer and a compare-and-set open; an older build ignores
  the table (Overlord §10.5, W1a)`

### Task 6: The case lane, in shadow

**Files:**
- Create: `server/src/coord/casesLane.ts` (header `// L4 delivery: the case lane's one pass (Overlord spec §10.5),
  in shadow. It decides nothing: practiceCases.ts does.`; C5; value imports `./practiceCases.js` only)
- Modify: `server/src/laneSchedule.ts` (`'cases'` in `LaneName`, one row)
- Modify: `server/src/watch.ts` (`FleetWatcher.sweepCases`, and its dispatch in `tick` beside `sweepUntold`)
- Modify: `server/src/coord/ports.ts#WatcherCoordMember` (`'openPracticeCase'`, `'practiceCaseNewest'`,
  `'stallObservationsSince'`, each in its sorted place)
- Test: `server/test/cases-lane.test.ts` (create); `server/test/lane-schedule.test.ts`

**Interfaces:**

```ts
// casesLane.ts
/** The four store members the pass reaches, declared by this consumer, so a test can hand a small fake. */
export type CasesCoord = Pick<WatcherCoordPort, 'stallObservationsSince' | 'practiceCaseNewest' | 'run' | 'openPracticeCase'>;
export interface CasesPassDeps { readonly coord: CasesCoord; readonly now: () => number }
export interface CasesPassResult { readonly opened: number; readonly superseded: number; readonly unread: 'observations' | 'cases' | null }
/** One pass. A failed read is answered in `unread` and warned (`ccrc-server: cases: <which> read failed: <detail>`),
 *  and the next pass tries again. A thrown write rejects the pass, and the lane row's warnKey reports it. */
export async function casesPass(deps: CasesPassDeps): Promise<CasesPassResult>;
// laneSchedule.ts: one row, the drift reconciler's cadence by reference, no new constant
// { name: 'cases', cadenceMs: DRIFT_SWEEP_MS, clock: 'mono', flight: 'skip', warnKey: 'ccrc-server: the case lane failed',
//   derivedFrom: { name: 'DRIFT_SWEEP_MS', reason: 'a read-and-record pass over durable rows, as the drift reconciler is;
//   a case needs days of evidence, so the beat only bounds how late it is recorded' } }
// watch.ts
async sweepCases(): Promise<void>  // coord absent: return; else runLane('cases', () => casesPass({ coord, now: () => Date.now() }))
```

`now: () => Date.now()` is the watcher's ambient read, as `sweepRunStuck` passes it. If `Deps.time` (the time-ports
plan, its Task 5) is on the branch point, pass `() => this.deps.time.clock.wall()` instead.

The pass, in order: `now = deps.now()`; `coord.stallObservationsSince(caseWindowFrom(now))`;
`coord.practiceCaseNewest()`;
for each id of `caseRunIds(rows)`, `coord.run(id)`, keeping `run.program` when the read is ok and the run exists (any
other answer leaves the run out, which can only lower what is counted); `casesDue(...)`; for each due case,
`coord.openPracticeCase(due, newest.get(due.signature) ?? null, now)`.

- [ ] **Step 1: Write the failing tests** (`cases-lane.test.ts`, a real temp `CoordStore` built as `run-untold.test.ts`
  builds one; runs opened with `openRun` under `prog-a` (claimant `coord-a`) and `prog-b` (`coord-b`); observation
  rows planted as `stall-settings-store.test.ts`'s `event` helper plants them, `detail` from `stallDetail`, each
  episode its own run; `now` a fixed `T`, never `Date.now`):
  - "three episodes of one arm in 14 days open one shadow case, and nothing is mailed, pushed or fed": rows at
    `T - 3 h`, `T - 2 h`, `T - 1 h`; `{opened: 1, superseded: 0, unread: null}`; one row in `practice_cases` with
    `mode 'shadow'`, `state 'open'`, `openedAt T`; row counts of `mail`, `mail_deliveries` and `feed_events`
    unchanged.
  - "a second pass opens nothing more": the same rows, a second pass at `T`: `{opened: 0, superseded: 0, unread:
    null}`.
  - "a fourth episode after the case opens nothing until two more join it": after the first case, one episode at
    `T + 1 h` and a pass at `T + 1 h` opens nothing; two more at `T + 2 h` and `T + 3 h` and a pass at `T + 3 h`
    open a second case whose `evidence` is the three new rows' ids.
  - "two episodes in two programmes open a programmes case".
  - "a failing store": over a `CasesCoord` object delegating to the real store, (a) a
    `stallObservationsSince` answering `{ok: false, detail: 'x'}` gives `unread: 'observations'`, opens nothing and
    warns once (a `console.warn` spy, `/^ccrc-server: cases: /`); (b) a `practiceCaseNewest` answering `{ok: false}`
    gives `unread: 'cases'` and opens nothing; (c) a `run` answering `{ok: false, kind: 'run-unreadable', detail: 'x'}`
    for one of three runs opens nothing (two left); (d) an `openPracticeCase` that throws rejects the pass.
  - "the lane imports values from the decider alone": over `parsedFile('server/src/coord/casesLane.ts').imports`, the
    specifiers of the edges that bind a value (not `typeOnly`, not `type-query`, not every name in `typeNames`) equal
    `['./practiceCases.js']`. No `readFileSync` pin (the ARCH-06 ratchet).
  - `lane-schedule.test.ts`: `laneRow('cases')` matches `{ cadenceMs: DRIFT_SWEEP_MS, clock: 'mono', flight: 'skip',
    warnKey: 'ccrc-server: the case lane failed', derivedFrom: { name: 'DRIFT_SWEEP_MS' } }`.
- [ ] **Step 2: Run** `test/cases-lane.test.ts test/lane-schedule.test.ts`. Expected: import failure, then
  `LANE_SCHEDULE has no lane named cases`.
- [ ] **Step 3: Implement** the four changes. The `tick` line, never awaited, below `sweepUntold`'s:
  `void this.sweepCases().catch(() => { /* one bad sweep must not kill the poll */ });` with a one-line comment naming
  the lane and Table 11.1c's row for it.
- [ ] **Step 4: Run** `test/cases-lane.test.ts`, `test/lane-schedule.test.ts`,
  `test/lane-beats-characterization.test.ts`, `test/consolidation-census.test.ts`,
  `test/rings/watcher-store-port.test.ts`, `test/rings/totality.test.ts`,
  `test/single-definition/advance-switches.test.ts`, `test/growth-check.test.ts` and the two `tsc` runs. Expected:
  green. `totality` gives `casesLane.ts` L4 (by its header) and `practiceCasesStore.ts` L3, both C5. If a tick suite
  with a fake coord port now warns from this lane, give that fake the three members, never silence the warn.
- [ ] **Step 5: Mutations, each red:** import `insertSystemMailTx` from `./rundefsTx.js` into `casesLane.ts` (the
  import pin); pass `null` instead of the newest it read to `openPracticeCase` ("a fourth episode ... until two more
  join it" goes red: the store refuses the second case as `superseded`); count a run whose read failed ("a failing
  store" (c)); remove the row or set its `warnKey` to null (`lane-schedule`).
- [ ] **Step 6: Commit.**
  `feat(coord): the case lane, in shadow: a 15-minute pass records cases, offers no review (Overlord §10.5, W1a)`

---

## Deviations found

The programme's run (1774) minted these numbers on 2026-11-11. They are defined in the programme's index plan,
`docs/superpowers/plans/2026-11-10-overlord.md`; each entry here gives the whole decision, after its number and old slug.

- **D-8228, arm-vocabulary-to-l0** — The stall arms' one definition moves from `server/src/coord/stall.ts` (L1) to
  `shared/stall-watch.ts` (L0), because the spec's L0 trigger table must derive its first rows from them and L0 cannot
  import L1. `stall.ts` re-exports; `stall-vocabulary.test.ts`'s allowed imports gain `shared/stall-watch.js`.
- **D-8229, trigger-kind-stall-arm** — The kind word is `stall-arm`. The quoted `'stall'` is the sent detail head and has
  one home, `stall.ts` (`update-stall.test.ts`).
- **D-8230, one-observation-window-read** — The lane reads through `CoordStore.stallObservationsSince`, extended with
  `eventId` and `runId`, and resolves programmes through `CoordStore.run`. No second read of `run_events` is added.
- **D-8231, no-case-switch** — No operator switch in W1a. The lane writes only its own table and acts on nothing; shadow
  is structural (no review code exists, and the import pin keeps mail, push and feed out of the lane).
- **D-8241, case-read-looks-back-two-windows, correction** — the pass read `stallObservationsSince(caseWindowFrom(now))`.
  `casesDue` takes an episode's time from its earliest row in its input, so when an episode's first rung slid out of
  the 14-day window while a later rung stayed inside, the episode took the later rung's time; an episode a case had
  already consumed then counted again, and one that began more than 14 days ago counted as "in 14 days". The pass reads
  from `caseReadFrom(now)`, two windows back (`practiceCases.ts`), so every episode's earliest row is in the decider's
  input, and the decider still counts only episodes that began inside the window. The read is the same statement with
  a lower bound, so the M17d plan is unchanged. Residual: an episode whose rows span more than 14 days can still count
  again. One episode's rows can span that long when a shadow rung is re-sent live under the same key, or on the
  wave-1 ladder's late rungs (`2026-11-10-overlord/w1a-triggers-cases/departures.md`).

**Settled by the spec's later edition, so no longer deviations:** one occurrence is one episode
(one run, one arm, one key), live or shadow; "two programmes" is read inside the 14 days; a case consumes its
evidence; W1a counts run-bound occurrences only (§10.5). The lane is a `LANE_SCHEDULE` row on the drift reconciler's
cadence, reading durable rows (Table 11.1c).

## Where things stand

**Needs before it starts:** nothing beyond today's `main`; W1a needs neither of the spec's prerequisites (§14). Three
other W1a pieces touch what this one does, and the implementer checks the branch point for each: the migration slot
(other pieces add `coord.db` entries; Task 5 re-measures); `Deps.time` from the time-ports plan (Task 6 passes its
wall clock if present); `MUTANT_SETS` from the simulator plan (Task 3 registers `practiceCases.ts` if present, else
the simulator plan registers it when it lands, since §11.7 puts every new L1 decider under a mutation floor).

**What depends on it:** W1's refusal words and W2's health words, each one more row and one more `TriggerSignature`
arm; W4b's `practice_entries.trigger`, `practiceFor`, reviews and the practice door, which read `practice_cases`;
M31's recurrence baseline (§12). Nothing crosses the agent link or the capability file in this piece: W1a's
`continuity-v1` covers the wave, and W4b's `practice-v1` will gate reviews.

**Open questions for the operator, most important first:**

1. **How many cases may one signature have?** Settled: a case consumes its evidence (§10.5).
2. **Does "two programmes" mean within the 14 days?** Settled: yes (§10.5).
3. **Should every arm be a trigger?** `restarted` and `limit-cap` describe the fleet more than the work, and may open
   cases often. Recommend all fourteen now (the table stays total over the arms) and let the shadow counts decide
   whether W4b adds a column that excludes some.
4. **Should run-less stall notices count?** Settled: not in W1a (§10.5). Counting them needs the stall watch to record a
   run-less observation durably, with the session's programme, which is the stall watch's change, not this lane's.
5. **Where does the operator see shadow cases?** Recommend nowhere new in W1a; the table is read with `sqlite3` during
   the shadow period. W4b's review surface is the first reader.
6. **Is the L0 move worth it now?** Recommend yes: it is one mechanical commit, and W1's refusal words and W4b's
   `practice_entries.trigger` need the table at L0. The fallback, an L1 table in `server/src/coord/`, contradicts
   Table 11.1b and would move later anyway.
