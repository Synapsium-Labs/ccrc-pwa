# Automations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** an operator can say from a phone *"every weekday at 09:00, start a session in
`ccrc-pwa` with this prompt"*, and afterwards read every firing — including the ones that
did not fire, and why.

**Architecture:** one new L0 module (`shared/schedule.ts`, import-free recurrence math), two
new L1 decisions (`server/src/auto/schedulepolicy.ts`, `server/src/auto/fire.ts`), one new
lane on the existing `FleetWatcher` tick, one new route file outside the coordination
prefix, four new `coord.db` tables in `MIGRATIONS[6]`, one additive WS frame, one PWA
screen. One new `CCD_ARGV` builder; zero new `ccd` verbs, zero new agent grants, zero new
dependencies.

**Tech Stack:** TypeScript (Node `>=22.13.0`), `node:sqlite` `DatabaseSync`, Fastify,
Preact + zustand, vitest. No new package in any of the four roots.

**Spec:** [`docs/superpowers/specs/2026-08-31-automations-design.md`](../specs/2026-08-31-automations-design.md)

---

## What was measured (2026-08-31, this machine, Node v24.18.0)

Seven measurement blocks this plan is built on. Re-run each before trusting it on another box.

> **Base: `origin/main` at `592ec425`.** Every line number, migration index and route count
> below was measured there. An earlier draft of this plan measured the *worktree*, which was
> an ancestor — and was consequently off by one migration slot, one route count and a dozen
> line numbers. `MIGRATIONS[5]` was already taken by D-792's mail-gate columns, so an
> "append" written against the older base would have **silently edited a shipped migration**.
> The repo's own rule is the one that catches it: source runs ahead, so measure `origin/main`,
> never the worktree. **Re-grep before trusting any citation on a later base.**

**1. Full ICU is present, so `Intl` can carry the timezone.**

```
$ node -e "console.log(Intl.supportedValuesOf('timeZone').length)"
418
```

**2. An unknown zone THROWS — it does not silently fall back to UTC.**

```
$ node -e "try{new Intl.DateTimeFormat('en-GB',{timeZone:'Not/AZone'})}catch(e){console.log(e.constructor.name)}"
RangeError
```

This is what makes `ScheduleError.unknown-timezone` measurable rather than hoped-for, and
why the spec could commit to a distinct column instead of a nullable `nextRunAt`. **Note
the asymmetry that Task 1 must also cover: a *small-ICU* build does NOT throw — it resolves
every zone to UTC silently, which would fire every wall-clock automation at the wrong hour.**

**3. Spring forward, `Europe/Warsaw`, 2027-03-28 — local 02:30 does not exist.**

| UTC | Warsaw |
|---|---|
| 00:55 | 01:55 |
| 01:00 | **03:00** |
| 01:05 | 03:05 |

**4. Autumn back, `Europe/Warsaw`, 2026-10-25 — local 02:25 happens twice.**

| UTC | Warsaw |
|---|---|
| 00:25 | 02:25 |
| 00:55 | 02:55 |
| 01:25 | **02:25 again** |
| 01:55 | **02:55 again** |

Measurements 3 and 4 are Task 1's fixtures, and they are why `nextOccurrence` searches
forward from the last fired **local `(y,mo,d,h,mi)` tuple** rather than the last fired epoch:
an epoch search fires twice across the fold, and the second firing looks exactly like a
correct one in the history.

**4b. Two zones prove the offset must be probed, never assumed.**

| zone | Jan offset | Jul offset | what it breaks |
|---|---|---|---|
| `Pacific/Chatham` | **+825 min** (13:45) | **+765 min** (12:45) | assuming a whole-hour offset |
| `Australia/Lord_Howe` | **+660 min** | **+630 min** | assuming DST steps by one hour |

And Lord Howe's spring-forward gap is **half an hour** — measured 2026-10-04, local jumps
**01:45 → 02:30**:

| UTC | Lord Howe |
|---|---|
| 15:15 | 01:45 |
| 15:30 | **02:30** |

So local 02:00 and 02:15 do not exist that day. An implementation that handles a gap by
*"add one hour"* is right in Warsaw and **wrong here**, and the failure is invisible until
someone schedules in that zone. Both zones are Task 1 fixtures for exactly that reason.

**5. `CCD_ARGV.wsAddWorker` cannot be reused — it hardcodes `--no-rc`.**

```
$ sed -n '269p' server/src/ccdargv.ts
  wsAddWorker: (p: string, dec: ActorFlags | null) => argv(['ws-add', '--no-rc', p, ...decFlags(dec)]),
```

`--no-rc` is not cosmetic. It sets `norc=1` (`ccd/ccd:3646`), which stamps
`_reg_set "$id" rc off` on the registry row at creation (`ccd/ccd:3798`), and every later
spawn *and resume* reads it:

```
$ sed -n '11744,11745p' ccd/ccd
  rcflag=""
  _rc_enabled && [[ "$(_reg_get "$id" rc)" != "off" ]] && rcflag="--remote-control '$id'"
```

The row therefore **permanently loses `--remote-control`, whatever the box says** —
`ccd/ccd:7-8` states it outright: *"a row stamped `rc=off` (`ws-add --no-rc` — a dispatched
worker, task #37) spawns plain even on an `on` box."* The flag is scoped by the 2026-08-13
ruling to dispatched programme workers. An automation's session is one the operator opens
from their phone and works in, so Task 5 adds `wsAddAuto` without it.

**6. Two source-scanning suites are blind to a new directory.**

```
$ sed -n '80p' server/test/auth-gate.test.ts
const ROUTES: ScannedRoute[] = [...scanRoutes('server.ts'), ...scanRoutes('coord/routes.ts')];

$ sed -n '403p' server/test/single-definition.test.ts
    const coordDir = path.join(ccrcRoot, 'server/src/coord');
```

A route in a third file is never swept for `401 no-session`; a `node:sqlite` handle in
`server/src/auto/` passes the coord-ring scan silently. **Both suites stay green while the
property they exist to guarantee is false.** Task 9 closes both, red-first, **before** the
first route is registered.

Route counts today: `server.ts` **46**, `coord/routes.ts` **22**, `ROUTES.length` **68**,
HTTP **65**, `gated.length` **41**.

---

## Global Constraints

Every task inherits these. A task that breaks one is not done, however green its own suite.

1. **No second `setInterval` in `watch.ts`** (`lifecycle-sweep.test.ts:106` pins it at one).
2. **`sweepMail` is untouched** — not edited, not wrapped, not called
   (`lifecycle-sweep.test.ts:124-131` is the parity signal).
3. **The lane's entire argv vocabulary is `['ws-add']`.** No `ensure`/`start`/`enable`/
   `swap`/`stop`/rename/archive/hold. This is the sentence that squares the feature with the
   no-reconciler ruling, so Task 7 makes it a red suite.
4. **Zero new `ccd` verbs, zero new agent whitelist prefixes, zero new caps tokens.** One
   `CCD_ARGV` builder is added (Task 5); `['ws-add']` is already granted one-token.
5. **`FLEET_PROTO` and `FLEET_PROTO_MIN` stay `1`.**
6. **`MIGRATIONS[0..5]` are byte-identical after this plan.**
7. **`CoordStore` stays synchronous.** No `async`, no `await` inside a `tx()`.
8. **`shared/*.ts` imports nothing at runtime.** `Intl` is a global; a cron library is not.
9. **No overloaded null at a seam.** Specifically: *never ran* ≠ *ran and failed* ≠ *could
   not measure*; *paused* ≠ *unschedulable* ≠ *due at T*; `spawnRc NULL` ≠ `spawnRc 0`;
   `homeScore NULL` ≠ `homeScore 0`.
10. **Never pass `replaceDraft` from this lane.**
11. **`NotifyEvent.sessionId` stays non-nullable and gains no seventh kind.** A run that
    created no session cannot notify — that is a constraint, not an omission.
12. **The word `Task` is avoided** as an automations noun. The tree's guard is by NAME only
    — `single-definition.test.ts:353` tests `RunTask|ProgramTask|CoordTask`, so an
    `AutomationTask` would pass it green. Convention here, not mechanism: the units are
    **run** and **step**.
13. **Every runtime list is `Object.keys(MAP)`.**
14. **Suites in the FOREGROUND, `cd`'d into the package, timeout ≥600000 ms.** Never bare
    `npx vitest`.
15. **`ccd/` is not touched, so this is NOT an agent-first deploy.** If a task finds it must
    touch `ccd/`, stop and re-plan: that is a different shape with a different deploy order.

---

## File Structure

| File | Responsibility after this plan |
|---|---|
| `shared/schedule.ts` | **new, L0.** Cadence → next occurrence in an IANA zone. Import-free; `Intl` only. The one implementation the server and the PWA share. |
| `shared/api.ts` | **modified, L0.** Eight vocabularies, the wire types, the caps. Additive. |
| `server/src/ccdargv.ts` | **modified, L3.** One builder: `wsAddAuto`. |
| `server/src/coord/schema.ts` | **modified, L3.** `MIGRATIONS[6]` — four tables, four indexes, one seeded row. |
| `server/src/coord/store.ts` | **modified, L3.** Synchronous automation reads/writes, the lease CAS, the per-parent ring, `automationStats()`. |
| `server/src/auto/schedulepolicy.ts` | **new, L1.** Due / catch-up / missed / advance, with `nowMs` as an input. |
| `server/src/auto/fire.ts` | **new, L1.** The precondition ladder and the fire act. |
| `server/src/auto/routes.ts` | **new, L4.** Ten routes; a union→status map and nothing else. |
| `server/src/watch.ts` | **modified, L4.** `sweepAutomations()` + `emitAutomations()`. Decides nothing. |
| `server/src/bus.ts` | **modified.** One overload triple. |
| `server/src/server.ts` | **modified, L4.** Route registration, the `/ws/fleet` cold start, `automationStats()` on `/api/fleet/health`. |
| `server/src/index.ts` | **modified, L5.** Wiring only. |
| `pwa/src/screens/AutomationsScreen.tsx` | **new.** The list, filters, run history, gap row. |
| `pwa/src/auto/AutomationSheet.tsx` | **new.** Create/edit + the cadence picker with a live next-fire preview. |
| `pwa/src/auto/autoWords.ts` | **new.** Total `Record<Union, …>` word + glyph + **sentence** tables. |
| `pwa/src/lib/api.ts`, `stores/fleet.ts`, `app.tsx` | **modified.** Ten client methods, the `automations` slice + `…FrameSeen`, the route and its `data-view` OR. |

---

### Task 1: the recurrence math answers in a timezone, and says when it cannot

**Files:** Create `shared/schedule.ts` (L0). Test: `server/test/schedule.test.ts`

The whole timezone question in one import-free module, shipped before anything can depend on
it being wrong.

```ts
// `CadenceKind` and `ScheduleError` are NOT declared here — Task 2 owns them in
// `shared/api.ts`. Two exported types of one name in two bundled `shared/` files is the
// second-copy shape `single-definition.test.ts` exists to fail on. This module names its own
// narrower return union instead, and `failure-ceiling` is deliberately NOT a member: §8's
// repeated-failure rule writes that, not the arithmetic.
export type Cadence =
  | { kind: 'wall-clock'; days: number; minuteOfDay: number; tz: string }  // days = 7-bit mask
  | { kind: 'interval'; everyMinutes: number };
export type CadenceUnschedulable = 'unknown-timezone' | 'bad-cadence' | 'no-future-occurrence';
export interface LocalTuple { y: number; mo: number; d: number; h: number; mi: number }
export type NextOccurrence =
  | { at: number; localTuple: LocalTuple | null; dstShifted: boolean }
  | { unschedulable: CadenceUnschedulable };

export function nextOccurrence(c: Cadence, afterMs: number, afterLocal: LocalTuple | null): NextOccurrence;
export function describeCadence(c: Cadence): string;
export function icuHasZones(): boolean;
```

A **typed union, never a nullable number** — the spec's §4 decision.

**The algorithm is a local→epoch inversion, not a minute walk.** For each candidate local
day the mask allows, form the nominal local instant, probe the zone's offset a day either
side via `formatToParts`, and invert. Two candidate epochs result: a **fold** yields two
valid ones (take the earlier), a **gap** yields **zero** (advance to the first valid instant
after it and set `dstShifted`). Bounded work per candidate — unlike walking 1440 minutes × N
days — and it is the only shape that handles a 30-minute DST step
(`Australia/Lord_Howe`) and a `:45` offset (`Pacific/Chatham`) without special cases.

Accept only a candidate strictly greater than `afterLocal` **as a tuple**. That is what makes
the autumn fold fire once; write the reason in the docstring and cite measurement 4.

`interval` carries **no timezone at all** and needs no inversion — `afterMs + everyMinutes*60000`.

`icuHasZones()` compares a January and a July offset for a DST zone: on a small-ICU build
both are UTC and it returns `false`. It exists so a boot assertion can fail CI rather than
the operator's morning (measurement 2's asymmetry).

- [ ] Step 1: write the failing test. Fixtures: (a) `weekdays 09:00 Europe/Warsaw` from a
      Saturday → Monday 09:00; (b) **measurement 3** — `daily 02:30 Europe/Warsaw` on
      2027-03-27 → 2027-03-28 **03:00** with `dstShifted: true`; (c) **measurement 4** —
      `daily 02:25 Europe/Warsaw` fired at the first 02:25 on 2026-10-25 → **2026-10-26**
      02:25, not the second 02:25 that night; (d) `Pacific/Chatham` (`:45` offset) and
      `Australia/Lord_Howe` (30-minute DST step) both resolve to the named wall clock;
      (e) `tz:'Not/AZone'` → `{unschedulable:'unknown-timezone'}`; (f) `days: 0` →
      `{unschedulable:'no-future-occurrence'}`; (g) `everyMinutes: 0` →
      `{unschedulable:'bad-cadence'}`; (h) an `interval` crossing a DST boundary advances by
      exactly `everyMinutes`, not by a wall-clock hour; (i) `icuHasZones()` is `true` here;
      (j) a source scan asserting `shared/schedule.ts` contains **no `import` statement**.
- [ ] Step 2: run it — expect FAIL (the module does not exist; every case errors on import).
- [ ] Step 3: implement `shared/schedule.ts`.
- [ ] Step 4: run green, plus `single-definition`, `typecheck-tests`, `source-bytes`, and
      `cd pwa && ./node_modules/.bin/vitest run` (it must survive the browser bundle).
- [ ] Step 5: mutation — (i) compare epochs instead of local tuples → case (c) reds;
      (ii) delete the `try` around the `Intl.DateTimeFormat` construction → (e) reds;
      (iii) on a gap, return the nominal instant instead of the first valid one → (b) reds;
      (iv) drop `dstShifted` → (b) reds; (v) give `interval` a timezone → (h) reds.
      Record each failing count; restore.
- [ ] Step 6: commit — `feat(shared): a cadence says when it next fires, and when it cannot`

---

### Task 2: the automations vocabulary lands on the wire, derived and never hand-written

**Files:** Modify `shared/api.ts` (L0). Test: `server/test/automations-wire.test.ts`; extend
`server/test/single-definition.test.ts`

Seven closed vocabularies in the tree's exact idiom — union → private `Record<Union, true>`
map → derived `Object.keys(MAP)` list → exported `is<Enum>` guard, each with a designated
`'unknown'` that readers degrade to and producers never write: `AutomationState`,
`AutomationOutcome`, `AutomationRefusal`, `AutomationStep`, `AutomationTrigger`,
`CadenceKind`, `ScheduleError` (five members, `'unknown'` included),
`AutomationRouteRefusal` (`never-run-by-hand`, `bad-schedule`, `bad-transition`, `oversize`,
`unknown` — route-level, never written to a run row), plus `DayMask` helpers.

Plus the caps: `AUTOMATION_PROMPT_MAX_BYTES`, `AUTOMATION_DETAIL_MAX_BYTES = 2048`,
`AUTOMATION_RUN_RETENTION = 200`, `AUTOMATION_MAX_CONCURRENT`, `AUTOMATION_FAILURE_CEILING`,
`AUTOMATION_PRESSURE_CEILING`, `AUTOMATION_GRACE_MS_DEFAULT`,
`AUTOMATION_MIN_INTERVAL_MINUTES`.

Then `AutomationSummary`, `AutomationRunSummary`, `AutomationStepWire`, `AutomationStats`,
and the `{type:'automations'}` arm of `FleetMsg`. `FLEET_PROTO` is **not** touched.

The `'unknown'` members matter more than usual here: the producer is an unattended sweep, and
a rollback putting an older server against a newer `coord.db` must render `? <token>` rather
than an empty cell.

- [ ] Step 1: write the failing test — per vocabulary: the runtime list equals `Object.keys`
      of its map; the guard rejects a foreign token; `'unknown'` is a member; and
      `FLEET_PROTO === 1 && FLEET_PROTO_MIN === 1` after the edit. Extend
      `single-definition.test.ts` with a `toMatch(/Object\.keys\(AUTOMATION_\w+_MAP\)/)` per
      vocabulary and a `not.toMatch` forbidding a hand-written array beside each type.
- [ ] Step 2: run it — expect FAIL (nothing exported).
- [ ] Step 3: implement in `shared/api.ts`.
- [ ] Step 4: run green, plus `single-definition`, `fleet-protocol`, `fleetws`, `auth-wire`.
- [ ] Step 5: mutation — replace one derived list with a hand-written array of the same
      values → `single-definition` reds; delete one `'unknown'` member → its guard test reds;
      bump `FLEET_PROTO` to 2 → three suites red (record the count).
- [ ] Step 6: commit — `feat(shared): the automations vocabulary, derived from its types`

---

### Task 3: coord.db learns automations, and MIGRATIONS[6] is the only edit

**Files:** Modify `server/src/coord/schema.ts` (L3). Test: extend `server/test/coord-db.test.ts`

Append **one** template literal, banner `── 7: user_version 6 -> 7`, carrying the four
`CREATE TABLE`s, four `CREATE INDEX`es and the seeded `automations_state` row from spec §5.
Only `CREATE TABLE` / `CREATE INDEX` / `INSERT` — no rebuild, no rename, no repurpose.

Five column decisions carry their reason in the SQL comment, because they are the ones a
later reader would otherwise "simplify":

- `nextRunAt` **and** `scheduleError` are two columns because *paused*, *cannot be scheduled*
  and *due at T* are three facts. State the invariant:
  `state='armed' AND scheduleError IS NULL <=> nextRunAt IS NOT NULL`.
- `spawnRc` is nullable **with no default** — a `DEFAULT 0` collapses *the exec was cut short
  and no rc was measured* into *it exited cleanly*, the defect `dispatchStartedAt`'s comment
  argues at `schema.ts:635`.
- `homeScore` is nullable **with no default** — `NULL` is UNMEASURED, and `limits.ts:40-47`
  rules that unknown is not zero.
- `tz` is nullable and `NULL` **iff** `cadenceKind='interval'` — an interval has no timezone,
  and a stored `'UTC'` would be a lie.
- `truncatedBytes` is `NOT NULL DEFAULT 0` and always emitted.

- [ ] Step 1: write the failing test — a fresh db reaches `user_version 7`; `PRAGMA
      table_info` on each new table matches exactly, with `notnull 0` / `dflt_value null`
      asserted specifically for `nextRunAt`, `scheduleError`, `spawnRc`, `homeScore`, `tz`,
      `provedAt`, `lastFireAt`; `automations_state` holds exactly one row with `paused = 0`;
      a db at `user_version 6` migrates forward and keeps its existing `runs` rows;
      `MIGRATIONS.length === 7` and `COORD_SCHEMA_VERSION === MIGRATIONS.length`.
- [ ] Step 1b: **re-pin the EIGHT absolute assertions `coord-db.test.ts` already carries** —
      this is the task's work, not a regression. `user_version` at `:330`, `:376`, `:444`,
      `:551`, `:573` and `COORD_SCHEMA_VERSION`/`MIGRATIONS.length` at `:331`, `:615`, `:616`
      all move **6 → 7**, and the `it('COORD_SCHEMA_VERSION derives to 6 …')` title moves with
      them. They sit in describe blocks that have nothing to do with automations, so a worker
      who has not been told will mis-diagnose the red as a migration bug. Consider replacing
      the literals with `COORD_SCHEMA_VERSION` on both sides so the next migration does not pay
      this tax again.
- [ ] Step 2: run it — expect FAIL (`user_version` reaches 6; the tables do not exist).
- [ ] Step 3: implement `MIGRATIONS[6]`.
- [ ] Step 4: run green, plus `coord-store`, `run-routes`, `mail-routes`, `coord-pause-route`,
      `lifecycle-sweep`, `claim-sweep`.
- [ ] Step 5: mutation — (i) `DEFAULT 0` on `spawnRc` → the `dflt_value null` assertion reds;
      (ii) edit `MIGRATIONS[5]` instead of appending → the `6 → 7` forward case reds;
      (iii) replace `COORD_SCHEMA_VERSION` with a literal `7` → the derivation assertion reds.
- [ ] Step 6: commit — `feat(coord): automations, their runs and their steps get tables`

---

### Task 4: the store leases a schedule, bounds its history, and reports its growth

**Files:** Modify `server/src/coord/store.ts` (L3). Test: `server/test/automations-store.test.ts`

New `CoordStore` methods — all synchronous, all taking `now` from the caller, all reading
enum columns through their `is*` guard, all naming every column (no `SELECT *`):

```
automations(filter?)   listAutomation(id)   insertAutomation(row, now)
updateAutomation(id, patch, now)   setAutomationState(id, state, now)   markProved(id, now)
dueAutomations(now)   claimAndOpenRun(id, now, softMs, hardMs, nextRunAt, trigger)
openUnleasedRun(id, now, outcome, refusal)   -- the pre-claim rungs' row (spec §7 rungs 1-2)
renewAutomationLease(id, now, softMs)   releaseAutomation(id)   lapsedAutomations(now)
settleAutomationRun(id, outcome, refusal, now)
appendRunEvent(runId, step, ok, detail, now)
automationRuns(automationId, limit)   automationRun(runId)   runEvents(runId)
automationsPaused()   setAutomationsPaused(v, now)   inFlightAutomationRuns()
automationStats()
```

Four carry the load:

- **`claimAndOpenRun` is ONE method because it must be ONE transaction.** Splitting the CAS
  from the run-open leaves a gap with a real defect in it: the lease is taken but `nextRunAt`
  is un-advanced, so when `leaseHardUntil` lapses — §8's whole point, *"a runner that dies
  mid-spawn releases the schedule on its own"* — the same occurrence is still `<= now` and
  **fires again**, the exact repeat the spec promises cannot happen. One `tx()`: CAS the lease
  (return `{refused:'overlap'}` when `leaseHardUntil > now`), advance `nextRunAt`, insert the
  `outcome='running'` row — via the un-wrapped `*Inner` forms, because `tx()` does not nest.
  Sound only because `DatabaseSync` never yields: no `await` between the read and the writes.
- **`renewAutomationLease` moves `leaseUntil` only — `leaseHardUntil` is NEVER extended**,
  which is what makes a crashed runner's lock lapse on its own.
- **`openUnleasedRun` exists for the pre-claim rungs.** A sweep that loses the `overlap` race
  never gets a lease, so it needs a way to write its `skipped` row anyway — spec §7 rungs 1-2
  run before the claim precisely so those refusals are visible rather than silent.
- **`settleAutomationRun` prunes the parent's ring to `AUTOMATION_RUN_RETENTION` inside the
  same transaction as the settle**, deletes the evicted runs' events in that transaction, and
  **accumulates the count into `automations.runsEvicted`** — retention is a ceiling, and the
  rows it dropped are a number, not a silence.
- **`appendRunEvent` applies `AUTOMATION_DETAIL_MAX_BYTES` in UTF-8 bytes and sets
  `truncatedBytes`** — including `0`.

- [ ] Step 1: write the failing test — two `claimAndOpenRun` calls return a runId then
      `{refused:'overlap'}`; a claim after `leaseHardUntil` succeeds; **one `claimAndOpenRun`
      that is interrupted leaves EITHER both the lease and the advanced `nextRunAt` or
      neither — assert the row after a throw injected between the two writes**;
      `renewAutomationLease` moves `leaseUntil` and leaves `leaseHardUntil` byte-identical;
      `dueAutomations` returns only `armed` rows with `provedAt IS NOT NULL`,
      `scheduleError IS NULL` and `nextRunAt <= now`, ordered by id — **and an armed row whose
      `provedAt` is NULL is NOT returned; the arm gate is a STORE invariant, not only a route
      arm** (stamp `provedAt` on every other fixture in this suite); inserting run 201 for
      one automation leaves exactly 200, deletes the evicted run's events, and sets
      `runsEvicted = 1`, **while a sibling automation's 3 runs are untouched**; a detail of
      `AUTOMATION_DETAIL_MAX_BYTES + 10` bytes stores the cap and reports `truncatedBytes: 10`;
      an in-cap detail reports `0`, not absent; a `state` written directly as `'martian'` reads
      back `'unknown'` and never throws; `setAutomationState(id,'retired')` leaves every run
      row present; `automationStats()` reports the row counts.
- [ ] Step 2: run it — expect FAIL (no methods).
- [ ] Step 3: implement.
- [ ] Step 4: run green, plus `coord-store`, `coord-db`, `single-definition`.
- [ ] Step 5: mutation — (i) let `renewAutomationLease` extend `leaseHardUntil` → the lapse
      case reds; (0) **split `claimAndOpenRun` back into two transactions → the
      interrupted-claim case reds** — this is the guard for the double-fire defect; (ii) move the ring prune out of the settle's `tx()` → the eviction or
      sibling case reds; (iii) make the prune global rather than per-`automationId` → the
      sibling case reds; (iv) drop the `runsEvicted` accumulation → its case reds;
      (v) replace one `is*` guard with a cast → the `'martian'` case reds.
- [ ] Step 6: commit — `feat(coord): a schedule can be leased, and its history has a ceiling`

---

### Task 5: one new argv builder, because `--no-rc` is not ours to inherit

**Files:** Modify `server/src/ccdargv.ts` (L3). Test: extend `server/test/whitelist-subset.test.ts`,
`server/test/ccdargv-dec-parity.test.ts`

```ts
wsAddAuto: (p: string, dec: ActorFlags | null) => argv(['ws-add', p, ...decFlags(dec)]),
```

Measurement 5 is the argument: `wsAddWorker` hardcodes `--no-rc`, which is scoped to
dispatched programme workers and writes `rc off` on the session. An automation's session is
one the operator opens from their phone.

The cost is exactly **two** things, because **`['ws-add']` is already granted one-token in the
agent whitelist with trailing tokens unconstrained**: a `SAMPLES` entry (the suite asserts
`Object.keys(SAMPLES)` equals `Object.keys(CCD_ARGV)` exhaustively) and a token-for-token
`EXPECTED` argv assertion. **`ccdargv-dec-parity.test.ts` needs no edit** — it derives ccd
VERBS, not builder keys, and `ws-add` is already in its pinned set. See Step 1 for the arm
that must be added anyway, and why.

**No new agent whitelist prefix. No new `ccd` verb. No new caps token. No `verbSupported`
preflight** — `ws-add` is in `UNGATED_BY_DECISION` (`verb-gate.test.ts:58-60`). **`ccd/` is
not touched.**

- [ ] Step 1: write the failing test — the argv is exactly
      `['ws-add', '<project>', '--surface', 'agent', '--actor', 'auto:7 fire']`; a `null` dec
      emits exactly `['ws-add','<project>']`; the builder appears in `SAMPLES`; and
      `isExecAllowed('ccd', argv)` accepts it. **Do NOT assert that
      `ccdargv-dec-parity.test.ts`'s derived set contains `wsAddAuto` — that is unwritable.**
      `decAppendingVerbs()` derives ccd VERBS (`:78-88`) and pins them by exact equality at
      `['ws-add','ws-archive','ws-hold','ws-release','ws-rename','ws-restore']`; `wsAddAuto`
      emits `ws-add`, already a member with a `PROBES` entry, so the derived set is
      byte-identical. Instead **add a second arm to that suite's own `ws-add` case composing
      through `CCD_ARGV.wsAddAuto`**, asserting the same create-row actor — otherwise the probe
      measures `wsAddWorker`'s token order only, and the two differ exactly where it matters:
      the dec lands immediately after the project, with no `--no-rc` between.
- [ ] Step 2: run it — expect FAIL (`SAMPLES` exhaustiveness reds first; then the argv case).
- [ ] Step 3: implement.
- [ ] Step 4: run green, plus `whitelist-subset`, `ccdargv-dec-parity`, `ccdargv-brand`,
      `verb-gate`, `unattended-actor`, and `cd agent && npm run test` (**the whitelist must be
      byte-identical — this task must not touch it**).
- [ ] Step 5: mutation — (i) add `--no-rc` to the new builder → the token assertion reds;
      (ii) remove the `SAMPLES` entry → the exhaustiveness assertion reds; (iii) add
      `['ws-add','--no-rc']` as a whitelist prefix → `whitelist-subset`'s dead-grant direction
      reds. Record each; restore.
- [ ] Step 6: commit — `feat(ccdargv): an automation's spawn keeps the box's RC default`

---

### Task 6: the precondition ladder is pure, ordered, and fails shut

**Files:** Create `server/src/auto/schedulepolicy.ts` and `server/src/auto/fire.ts` (both L1).
Test: `server/test/automations-fire.test.ts`

The decision half only — no fleet act yet, so this commits green and is independently
meaningful.

`schedulepolicy.ts` is the due/catch-up/missed/advance decision, with `nowMs` as an **input**
and no clock read: given an automation and now, return
`{fire: 'schedule'|'catchup'} | {record: 'missed'} | {idle: true}`. It exists separately from
`fire.ts` so the catch-up rule is unit-testable with no deps at all.

`fire.ts` exports `checkPreconditions(deps, automation, nowMs)` returning
`{ok: true, homeScore: number | null} | {refused: AutomationRefusal, detail: string}`,
running spec §7's nine rungs **in that exact order — and note the split**: rungs 1-2
(`overlap`, `cap-concurrency`) run BEFORE the lease claim, their rows opened un-leased via
`openUnleasedRun`; rungs 3-9 run after. A ladder that put `overlap` after the claim could never
fire it, because this sweep would already hold the lease.
Declare a consumer-owned `FireDeps`
copying `DispatchRunDeps`' shape.

Four rungs a reviewer should check:

- **Rungs 3 and 5 are one `readdir` and fail shut** — `names === null || names.includes(…)`,
  a directory we cannot list is a pause we cannot rule out — but they return **different**
  codes, because at 07:05 *"I paused the fleet"* and *"the box is unreachable"* are different
  sentences with different fixes.
- **Rung 7 cannot wedge a fresh box.** `projectHome` returns `null` iff every home-able lane
  is *disabled*; an unmeasured account is still placeable (`limits.ts:72-84`).
- **Rung 8 needs a seam that does not exist yet, and this task opens it.**
  `ProjectedHome.score` is a non-nullable `number` (`shared/api.ts:2520-2523`) and
  `projectHome`'s all-unmeasured fallback returns a literal `score: 0` (`limits.ts:106`) — so
  *unmeasured* and *a measured zero* are already collapsed on the way out, and `homeScore: null`
  is unreachable through that function. The rule that separates them is `measured()`, which is
  **module-private** (`limits.ts:40`, no `export`). **Add `export` to it — one word, no second
  copy** — and read rung 8 as `measured(limits[projected.wrapper])`: `null` is UNMEASURED, a
  number is the score. Copying its `five === null || seven === null` rule into `auto/` would be
  a second definition of a single-source-of-truth rule. `checkPreconditions` therefore takes
  `limits: Record<string, AccountLimits>` alongside the roster.
- **Rung 8 is also the deliberate departure.** An **unmeasured** lane proceeds and reports
  `homeScore: null` — never `0`. A measured score at or above `AUTOMATION_PRESSURE_CEILING`
  refuses `account-pressed` **carrying the ceiling and the score**.
- **Rungs 2 and 9 carry their numbers.**

Neither file may import `fastify`, `node:fs`, `node:sqlite`, or touch `reply`.

- [ ] Step 1: write the failing test — one case per rung asserting the exact refusal code AND
      that no later rung was consulted (a deps double whose later collaborators throw if
      called); an unlistable registry refuses `registry-unmeasurable`; an unmeasured lane
      proceeds with `homeScore: null`; a measured 99 refuses `account-pressed` with both
      numbers; **a MEASURED `homeScore` of 0 is NOT the unmeasured case — both are covered and
      they differ**; a totality test that every `AUTOMATION_REFUSALS` member except the **FIVE**
      spawn/prompt codes (`spawn-refused`, `spawn-cut-short`, `spawn-unmeasured`,
      `spawn-ambiguous`, `prompt-refused` — Task 7's) and `'unknown'` (a reader degrade no
      producer writes) is reachable from some fixture; the catch-up cases from Task 8's list,
      driven through `schedulepolicy` alone; and a source scan that neither file imports
      `fastify` / `node:fs` / `node:sqlite`.
- [ ] Step 2: run it — expect FAIL (no modules).
- [ ] Step 3: implement.
- [ ] Step 4: run green, plus `single-definition`, `typecheck-tests`.
- [ ] Step 5: mutation — (i) invert the fail-shut to `names !== null && names.includes(…)` →
      the unlistable case reds; (ii) swap rungs 5 and 6 → an ordering case reds; (iii) make an
      unmeasured lane refuse → the fresh-box case reds; (iv) report `homeScore: 0` for
      unmeasured → its case reds; (v) drop the numbers from rung 2 → its assertion reds; (vi) return
      `homeScore: 0` for an unmeasured lane → the measured-vs-unmeasured pair reds; (vii) move
      rung 1 (`overlap`) after the claim → it becomes unreachable and its case reds.
- [ ] Step 6: commit — `feat(auto): an automation asks nine questions before it spawns`

---

### Task 7: the act — spawn, identify by diff, adopt honestly, prompt

**Files:** Modify `server/src/auto/fire.ts` (L1). Test: extend `server/test/automations-fire.test.ts`

`fireAutomation(deps, automation, runId, nowMs): Promise<FireOutcome>`, in spec §6's order.
Four things copied from `dispatch.ts` rather than reinvented:

1. **`CCD_ARGV.wsAddAuto(project, sweepDec(deps.fleetState, \`auto:${id} fire\`))`** — Task 5's
   builder. The actor string is what distinguishes an automation's spawn from a dispatch's in
   the lifecycle journal.
2. **The BEFORE/AFTER asymmetry.** BEFORE uses tolerant `readRegistry` (it may only answer
   "does this still exist"); AFTER uses intolerant `readRegistryMeasured`, because "is this
   NEW" cannot be answered by a listing that collapses failure to `[]`.
   `candidates.length !== 1` is `spawn-ambiguous`.
3. **The adoption gate:** on a non-zero `ws-add`, bind only if
   `cutShort(res) === true && winner.held === null` — **only a literal `true` adopts**, and an
   adopted session sets `adopted = 1`. **The three spawn words are distinct**:
   `spawn-refused` (ccd refused, nothing to clean up), `spawn-cut-short` (killed at the 300 s
   ceiling, **may have left a workspace only a human may clear** — candidate ids in the step
   detail), `spawn-unmeasured` (the transport dropped; we cannot say which).
4. **`sendPrompt` inside the shared `KeyedQueue`, NEVER with `replaceDraft`.** Its six-member
   refusal union goes straight into the step row.

Never parse ccd's stdout line; never recompute `<wrapper>-<project>` (D-291 — `cmd_swap`
moves a session's wrapper while keeping its id).

- [ ] Step 1: write the failing test — a successful `ws-add` adding exactly one row binds it
      and records `sessionId`/`workspace`/`branch`/`wrapper`; two new same-project rows refuse
      `spawn-ambiguous`; `killed:true` with an unheld candidate **adopts** and sets
      `adopted = 1`; `killed: UNMEASURED` does **not** adopt and refuses `spawn-unmeasured`;
      a clean non-zero rc refuses `spawn-refused`; a kill with a candidate refuses
      `spawn-cut-short` **with the candidate id in the detail**; an unlistable
      `readRegistryMeasured` refuses `registry-unmeasurable` **even though ccd exited 0**;
      `sendPrompt` returning `draft-present` settles `failed`/`prompt-refused` **with the
      session id recorded**; a source scan that `replaceDraft` appears nowhere under
      `server/src/auto/`; **and a source scan that the only `CCD_ARGV.` reference under
      `server/src/auto/` is `wsAddAuto`** (Global Constraint 3 — the sentence that squares
      this feature with the no-reconciler ruling), with a coverage floor so it cannot pass on
      an empty scan.
- [ ] Step 2: run it — expect FAIL (no `fireAutomation`).
- [ ] Step 3: implement.
- [ ] Step 4: run green, plus `whitelist-subset`, `ccdargv-dec-parity`, `verb-gate`,
      `unattended-actor`, `run-routes`.
- [ ] Step 5: mutation — (i) relax the adoption gate to `cutShort(res) !== false` → the
      `UNMEASURED` case reds; (ii) use tolerant `readRegistry` for the AFTER snapshot → the
      unlistable case reds; (iii) collapse the three spawn words to one → two cases red;
      (iv) pass `replaceDraft: true` → the source scan reds; (v) add a
      `CCD_ARGV.ensure(...)` call in `auto/` → the argv-vocabulary scan reds.
- [ ] Step 6: commit — `feat(auto): a due automation spawns a session and hands it the prompt`

---

### Task 8: the lane rides the tick that already exists

**Files:** Modify `server/src/watch.ts` (L4). Test: `server/test/automations-sweep.test.ts`;
extend `server/test/lifecycle-sweep.test.ts`

`AUTOMATION_SWEEP_MS = 10_000` in the module constant block with a docstring arguing its
cadence like its eight siblings; `private lastAutomationSweep = 0` beside
`lastLifecycleSweep`; `public async sweepAutomations(): Promise<void>` in `sweepLifecycle`'s
exact shape — `if (!this.primed) return;` (restart-quiet), `const store = this.deps.coord;
if (!store) return;`, then the `!== 0` interval gate stamped **before** any awaited I/O.

Dispatched as `void this.sweepAutomations().catch(() => {})`, beside the two ledger
dispatches, immediately before `this.primed = true` — **not** beside `sweepMail`'s dispatch.
Public, for the reason `sweepNames`/`sweepMail`/`sweepLifecycle` all state: `tick()`
dispatches with `void`, so a test awaiting `tick()` has not awaited the sweep and every
negative assertion would pass while it was still running.

The lane also lapses leases: a run still `running` whose `leaseHardUntil` has passed settles
`outcome='lost'` — a record written, **nothing on the fleet touched**.

**The per-restart catch-up bound needs a field, because nothing else can hold it.** `primed`
cannot serve: `sweepAutomations` returns early while `!primed`, so by the time it runs at all
the priming tick is already past and there is no "first armed sweep after a restart" flag to
read. Add `private caughtUp = new Set<number>();` — an id enters it the first time this process
fires or records a late occurrence for it, and `schedulepolicy` may answer `{fire:'catchup'}`
only for an id NOT in the set. **In-memory deliberately:** the bound is per *restart*, so a
durable column would suppress a legitimate catch-up after the next boot. Without it, an
`interval` automation whose period is shorter than `graceMs` yields one catch-up per occurrence
inside the window — exactly the ninety-session wake this rule forbids.

- [ ] Step 1: write the failing test — under `vi.useFakeTimers({ toFake: ['Date'] })`, driving
      `w.sweepAutomations()` directly and never a timer: a due armed automation fires; a paused
      one does not; one with `scheduleError` set does not; **one with `provedAt IS NULL` does
      not** (excluded by `dueAutomations` itself — Task 4); a second call inside `AUTOMATION_SWEEP_MS` does nothing; the first call after
      construction runs immediately (the `!== 0` property); the priming tick fires nothing;
      a five-hours-late occurrence with `graceMs = 30min` records `missed` and fires nothing;
      a ten-minutes-late one fires once with `trigger:'catchup'` and a truthful `lateMs`;
      **three missed occurrences across a restart produce ONE catch-up, not three**; a
      `running` run past `leaseHardUntil` settles `lost`; a throwing `fireAutomation` does not
      kill the tick; **a run settling `ok` WITH a `sessionId` raises exactly one
      `NotifyEvent{kind:'run', sessionId}`, and a run settling `refused`/`missed`/`skipped`/
      `lost` raises NONE — assert the `NotifyLog` seq does not move.** That negative half is
      forced rather than chosen: `NotifyEvent.sessionId` is non-nullable
      (`shared/api.ts:2829`), so a session-less run has nothing to put there. Extend
      `lifecycle-sweep.test.ts` with
      `expect(src).toContain('void this.sweepAutomations().catch(')`.
- [ ] Step 2: run it — expect FAIL (no method; the dispatch scan finds nothing).
- [ ] Step 3: implement.
- [ ] Step 4: run green, plus `lifecycle-sweep` (**its one-`setInterval` assertion and its
      `sweepMail` parity assertion must both still pass**), `mail-sweep`, `claim-sweep`,
      `pr-sweep`.
- [ ] Step 5: mutation — (i) add a second `setInterval(` anywhere in `watch.ts` →
      `lifecycle-sweep.test.ts:106` reds (**this is the doctrine's mechanism**);
      (ii) convert the dispatch to `await` → the dispatch-shape scan reds;
      (iii) initialise `lastAutomationSweep = Date.now()` → the first-call case reds;
      (iv) drop `!this.primed` → the priming case reds; (v) fire once per missed occurrence →
      the three-missed-one-catchup case reds; (vi) drop the lease lapse → the `lost` case reds;
      (vii) drop the `caughtUp` set → the three-missed case reds by a second route (record both
      counts); (viii) raise a `NotifyEvent` for a session-less run → its no-notify case reds.
- [ ] Step 6: commit — `feat(watch): automations ride the tick that already exists`

---

### Task 9: the routes exist — and both blind scanners can see them

**Files:** Create `server/src/auto/routes.ts` (L4) — **it receives the same `FireDeps` the
sweep does** (`runCcd`, `io`, `cfg`, `tmux`, `queue`, `fleetState`, `coord`), because *Run now*
fires in-process (spec §6, "A manual run does not ride the sweep"); a route file given only the
store cannot serve that route at all. Modify `server/src/server.ts`,
`server/src/index.ts`. Test: `server/test/automations-routes.test.ts`; **extend**
`server/test/auth-gate.test.ts` and `server/test/single-definition.test.ts`

**Do both scanner fixes FIRST, in Step 1, before a single route is registered** (measurement 6).

- `auth-gate.test.ts:80` → add `...scanRoutes('auto/routes.ts')`, and re-pin the counts
  deliberately: `server.ts` 46 and `coord/routes.ts` 22 unchanged, `ROUTES.length` 68 → **78**,
  HTTP 65 → **75**, `gated.length` 41 → **51**. Every automations route is session-gated and
  **none** is exempt, so the difference moves by exactly ten.
- `single-definition.test.ts:403`'s coord-ring handle scan is directory-scoped to
  `server/src/coord`; add a sibling scan over `server/src/auto` asserting **no file there
  imports `node:sqlite` or `./db.js`**, with its own coverage floor so it cannot pass on an
  empty directory.

Then the ten routes from spec §10, `get`/`post` only, each a union→status map with a
`default: { const _exhaustive: never = r; … }` totality guard. **Nothing added to `EXEMPT`.
No `x-ccrc-mail-token` anywhere** — the box token authenticates the fleet host, and a schedule
the fleet can write is a schedule any session can install for itself, standing and unattended.

`POST /api/automations/:id/run` constructs its dangerous fields as **literals at the call
site** (D-280). `POST /api/automations/:id/arm` refuses `never-run-by-hand` while
`provedAt IS NULL`; create always writes `state='paused'`.

- [ ] Step 1: write the failing test — first both scanner changes and the re-pinned counts
      (these alone red until the file exists); then `automations-routes.test.ts`: create
      returns `201` **with `state:'paused'`**; arm before any manual run returns `409
      never-run-by-hand`; arm after a manual run that produced a session returns `200` and
      stamps `provedAt`; a bad cadence returns `409 bad-schedule` **naming the
      `ScheduleError`**; an over-cap prompt returns `413` with both byte counts and is
      **refused, not truncated**; `POST /:id/run` on a paused fleet returns `409` carrying the
      refusal code; `GET /:id/runs` clamps at `AUTOMATION_RUN_RETENTION`;
      `GET /automations/runs/:runId` returns the steps; a retired automation still serves its
      runs; and a source scan that no automations route calls `requireMailToken`.
- [ ] Step 2: run it — expect FAIL (the scanners cannot read `auto/routes.ts`; then 404s).
- [ ] Step 3: implement the routes and register them.
- [ ] Step 4: run green, plus `auth-gate` (**all five count assertions**),
      `coord-routes-single-file` (no coordination-prefixed stray),
      `coord-pause-route` (the `UNGATED` set must still be exactly three), `routes`, `boot`.
- [ ] Step 5: mutation — (i) revert the `scanRoutes` third-file change → the new routes'
      `401 no-session` cases red (**this is the guard that the hole is closed**); (ii) add one
      automations route to `EXEMPT` → the `gated.length` pin reds; (iii) import `node:sqlite`
      in `auto/fire.ts` → the new coord-ring sibling scan reds; (iv) read the run-now target
      off the body → the literal-at-call-site scan reds; (v) create with `state:'armed'` → the
      arm-gate case reds.
- [ ] Step 6: commit — `feat(auto): ten routes, all behind the session gate the sweep can see`

---

### Task 10: the frame is additive, and the growth is reported

**Files:** Modify `server/src/watch.ts`, `server/src/bus.ts`, `server/src/server.ts`.
Test: extend `server/test/fleetws.test.ts`, `server/test/routes.test.ts`

`emitAutomations()` modelled on `emitRuns()`: `if (!coord) return;` → read inside a
`try/catch` (an unguarded synchronous `node:sqlite` throw in the `/ws/fleet` `.then()` has no
`.catch` and kills the server) → byte-equality guard against
`private lastAutomationsJson: string | null = null` — **`null`, never `'[]'`**, so the first
measurement always emits and "no automations" differs from "never measured" →
`this.bus.emit('automations', rows)`. Called from `tick()` beside `this.emitRuns()`.

Then the `Bus` overload triple, and in `/ws/fleet` a `currentAutomations()` cold start chained
**inside the existing `.then()` after `onCoord`** to keep the pinned wire order, with matching
`bus.on`/`bus.off` pairs.

Add `automationStats()` to `/api/fleet/health` beside `lifecycleStats` — retention is a
ceiling, and a ceiling the operator cannot see coming is a surprise.

Run history is **not** on the frame — it is a cold read.

- [ ] Step 1: write the failing test — a connecting socket receives `hello`, `fleet`, `runs`,
      `coord`, `automations` in that order; an unchanged list emits once, not per tick; a
      changed list re-emits; an **empty** list still emits on the first measurement; a store
      that throws leaves the socket open and the tick alive; `FLEET_PROTO` is still `1`;
      `/api/fleet/health` carries `automationStats`. **And WRITE the one-producer scan into
      `single-definition.test.ts`** — files under the four roots containing
      `bus.emit('automations'` must equal exactly `['server/src/watch.ts']`, with a coverage
      floor so an empty scan cannot pass. It does not exist yet; writing it is this task's work,
      not a suite to run.
- [ ] Step 2: run it — expect FAIL (no frame; the new scan finds no producer).
- [ ] Step 3: implement.
- [ ] Step 4: run green, plus `fleetws`, `fleet-protocol`, `routes`, `single-definition`.
      **The one-producer scan does not exist today** — there is no `bus.emit` assertion anywhere
      in `single-definition.test.ts`, so running that suite green proves nothing about the new
      frame's producer until Step 1's scan has been written.
- [ ] Step 5: mutation — (i) initialise the guard to `'[]'` → the empty-first-emit case reds;
      (ii) remove the `try/catch` and make the store throw → the socket-survives case reds;
      (iii) move the cold start outside the chained `.then()` → the order case reds.
- [ ] Step 6: commit — `feat(watch): an automations frame, additive and byte-diffed`

---

### Task 11: the phone can arm it, pause it, and read what happened

**Files:** Create `pwa/src/screens/AutomationsScreen.tsx`, `pwa/src/auto/AutomationSheet.tsx`,
`pwa/src/auto/autoWords.ts`. Modify `pwa/src/lib/api.ts`, `pwa/src/stores/fleet.ts`,
`pwa/src/app.tsx`. Test: `pwa/test/automations.test.tsx`; extend `pwa/test/api.test.ts`,
`pwa/test/app.test.tsx`, `pwa/test/tap-targets.test.tsx`

Five PWA rules with teeth:

- **Three empty states, never one.** "No answer yet" (until `automationsFrameSeen` flips),
  "answered empty", and "the read failed" (`coldState !== 'ok'`) render differently. An
  empty-state sentence is a positive claim.
- **The default loader is a MODULE-SCOPE constant** held in a ref — never an inline default
  parameter, which re-mints identity every render and produces an unbounded fetch loop on the
  shipping path no test exercises.
- **`autoWords.ts` needs TWO total sentence tables, not one.** `never-run-by-hand` is the
  refusal the operator meets on every automation they create, and it is **not** a member of
  `AutomationRefusal` (decided before any run row exists, so it can never be written to
  `automation_runs.refusal`). A `Record<AutomationRefusal, string>` cannot hold a key outside
  its union — it renders an empty cell under `noUncheckedIndexedAccess`. So: one table over
  `AutomationRefusal`, a second over `AutomationRouteRefusal`.
- **`autoWords.ts` tables are `Record<Union, …>` total** over the L0 unions, entered through
  the `is*` guard door. Indexing a raw wire string is `undefined` under
  `noUncheckedIndexedAccess`, and JSX renders an **empty cell**, not an error. Every refusal
  gets a **sentence**, not just a word.
- **Two cues per state** — word and glyph. `44px` via `var(--tap-min)`, never a literal. Text
  inputs `≥16px` via `--text-input`.
- **`/automations` joins the `data-view` OR in `app.tsx`**, or the mobile layout leaves the
  fleet list on screen and hides the new pane.

The cadence picker imports `shared/schedule.js` and previews *next fire* on every change,
defaulting the zone to `Intl.DateTimeFormat().resolvedOptions().timeZone`. The list renders
the `runsEvicted` gap row and the `adopted` chip.

- [ ] Step 1: write the failing test — the three empty states render distinguishably (assert
      on `data-state`); a `state` token the build does not know renders `? <token>`, not blank;
      the picker preview matches `nextOccurrence` for a fixed fake clock; a new automation
      shows *paused, needs one manual run* and the arm button explains why; *Run now* posts
      once and surfaces a `409` refusal **as a sentence**; `runsEvicted > 0` renders a gap row;
      an `adopted` run renders the asterisked chip, not a clean tick; the filters narrow the
      list; `pwa/test/api.test.ts` pins URL/method/body for all ten client methods (injection
      must never be the only coverage of a write path); `app.test.tsx` pins `/automations` in
      the `data-view` OR; `tap-targets` finds a real element carrying the class.
- [ ] Step 2: run it — expect FAIL (no screen).
- [ ] Step 3: implement.
- [ ] Step 4: run green, `cd pwa` — plus `app`, `api`, `sw-denylist`, `tap-targets`,
      `contrast`, and `node design/contrast-check.mjs` (every new colour self-grounded or
      carrying a `GROUNDS` entry with a `why`; an unparsed paint is a FAIL, never a skip).
- [ ] Step 5: mutation — (i) make the default loader an inline default parameter → the
      fetch-loop guard reds; (ii) index a words table directly instead of through the guard →
      the `? <token>` case reds; (iii) collapse the three empty states to one → its case reds;
      (iv) drop `/automations` from the `data-view` OR → the app pin reds; (v) render `adopted`
      as a clean tick → its case reds.
- [ ] Step 6: commit — `feat(pwa): an automations screen that says when it next fires`

---

### Task 12: suites, ledger, PR, deploy

- [ ] Add the small-ICU boot assertion: a server-suite test that `icuHasZones()` is `true` on
      the running Node (measurement 2's asymmetry — a small-ICU build does not throw, it
      silently answers UTC). This must fail CI, not the operator's morning.
- [ ] Three suites, FOREGROUND, timeout ≥600000 ms: `cd server && npm run test`,
      `cd agent && npm run test`, `cd pwa && npm run test`. Re-run any known load flake
      (`ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`) **in
      isolation** before calling it a break.
- [ ] Confirm by measurement, not belief: `grep -c 'setInterval(' server/src/watch.ts` is `1`;
      `git diff origin/main -- server/src/coord/schema.ts` touches only the appended entry;
      **`git diff origin/main -- agent/` is empty**; `git diff origin/main -- ccd/` is empty;
      `FLEET_PROTO` is still `1`; the only `CCD_ARGV.` reference under `server/src/auto/` is
      `wsAddAuto`.
- [ ] Measure the CI delta. SIX new server test files land against a `timeout-minutes: 30` ubuntu
      ceiling whose comment records the server leg at ~9 minutes. All six are cheap by
      construction (pure arithmetic, one `mkTmp` database, `Date`-only fakes); the real-ccd
      probe joins an **existing** fixture-HOME probe rather than adding one. If the ubuntu leg
      crosses ~12 minutes, raise the ceiling deliberately with the measurement in the commit
      body — never by trimming a suite.
- [ ] Mint the deviation block from the allocator — `POST /api/ledger/deviations` with
      `{"project":"<slug>","count":<n>,"title":"program automations D-block"}` and the
      `x-ccrc-mail-token` header. **Never invent a number**: the seeded floor is already
      `max(D-N in this project's docs) + LEDGER_SEED_GAP(50)`, so a hand-picked
      next-after-grep sits below the floor and collides. On `409 not-seeded` or an unreachable
      server, write `D-TBD-<slug>` and STOP — a mechanical blocker to report.
- [ ] Write the `## Deviations found` bullets, one per allocated number, in the scanner's entry
      form `- **D-<n>** — <subject>` with a real em-dash, so `deviation-refs.test.ts`'s
      collision scan can see them. **Then check BY HAND that every `D-<n>` the spec cites is
      also defined here — nothing pins it.** That suite scans DEFINITIONS only (its own comment
      says prose refs "match neither"), and its coverage floor is `entries().length >= 100`,
      which one new plan cannot move. An earlier draft of this plan claimed a red suite would
      catch an undefined cited number; it will not.
- [ ] Token-scan (`topology-clean.test.ts`), push, open the PR.
- [ ] Deploy: **server lane only** — `bash deploy/deploy.sh`. Deliberately **not** agent-first:
      nothing under `ccd/`, `session-hook.sh` or `ccd/coordinator-skill/` is touched, and
      `agent/` is byte-identical. The final gate is `/health` reporting the shipped sha. Then
      confirm on the box that `coord.db` reached `user_version 7` and that the first
      `sweepAutomations` tick logged nothing — an empty table must be silent, not warn.

---

## Deviations found

_(allocated from `POST /api/ledger/deviations` during execution — this plan invents no number.
See Task 12.)_

Three are already known before a line is written, and all three should be in the block:

- **(number to allocate) — the scanner blindspot.** `server/test/auth-gate.test.ts:80` builds its route
  inventory from two hard-coded filenames, and `single-definition.test.ts:403`'s coord-ring
  handle scan is directory-scoped to `server/src/coord`. A route in a third file is never
  swept for `401 no-session`; a `node:sqlite` handle in a sibling directory passes the ring
  scan. **Both suites stay green while the property they exist to guarantee is false.** Found
  while placing `/api/automations` outside the coordination prefix; both closed in Task 9
  Step 1, red-first, **before** the first route was registered.
- **(number to allocate) — the DST-fold double fire.** computing "next occurrence after `lastFireAt`" by
  epoch fires **twice** across an autumn DST fold (measured: `Europe/Warsaw` local 02:25
  occurs at both `00:25Z` and `01:25Z` on 2026-10-25). The fix is to search forward from the
  last fired **local tuple**. Recorded because the epoch version is the obvious implementation
  and would have shipped silently — the second firing looks exactly like a correct one in the
  history.
- **(number to allocate) — the `--no-rc` scope trap.** `CCD_ARGV.wsAddWorker` is the only existing `ws-add`
  builder that takes a dec, which makes it look reusable, but it hardcodes `--no-rc`, scoped
  by the 2026-08-13 ruling to dispatched programme workers. Reusing it would have stamped
  `rc=off` on every automation's session at creation, **permanently suppressing
  `--remote-control` on every later spawn and resume even on a box configured `on`**
  (`ccd/ccd:3798`, `11745`, header at `:7-8`) — a silent, one-time, unnoticeable opt-out
  on exactly the sessions the operator opens from their phone. Closed by a second builder
  (Task 5) rather than by widening the first, because the flag is the whole difference
  between the two callers.
