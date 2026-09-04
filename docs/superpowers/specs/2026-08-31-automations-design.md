# Automations — a runner that spawns a session at a time you choose — design

> **Operator ask, 2026-08-29.** "I want to add possibility to have automations here.
> Something like in Orca — a Runner that does something at a given time, full history
> of runs and logs too." The reference named on 2026-08-31 is
> [`stablyai/orca`](https://github.com/stablyai/orca) — an ADE for a fleet of parallel
> agents, i.e. this product's nearest neighbour. The act was chosen by the operator from
> four offered: **spawn a new session**.

> **Every `path:line` below was measured against `origin/main` at `592ec425`.** An earlier
> draft was measured against an ancestor and was off by one migration, one route count and
> a dozen line numbers — re-grep before trusting any citation on a later base. The rule that
> catches this is the repo's own: *source runs ahead of the plans, so measure `origin/main`,
> never the worktree.*

**Goal:** the operator can say, from a phone, *"every weekday at 09:00, start a session
in `ccrc-pwa` and give it this prompt"*, and afterwards read what happened on every
firing — including the ones that did not fire, and why.

**Non-goal:** a second coordinator. Orca separates **Automations** (scheduled headless
runs) from **Orchestration** (multi-agent DAG dispatch). ccrc already has the second one —
it is Build 7 (`programs`/`runs`/waves/mail). Automations sits **beside** that machinery
and never inside it. An automation opens no run row, claims no wave, sends no coordinator
mail, and holds no workspace. If this design starts dispatching, it is wrong.

**Non-goal:** repair. An automation may only **create**. It never touches an existing row —
no `ensure`, `start`, `enable`, `swap`, `stop`, rename, archive or hold. See §2; §13.3
makes it a red suite rather than a promise.

---

## 1. What was asked, what Orca ships, and what of it earns its place here

| Orca | ccrc's answer | § |
|---|---|---|
| `automations create\|list\|show\|edit\|run\|runs\|remove` | the same seven verbs, as routes | §10 |
| `--trigger` = preset \| cron \| RRULE | **a closed two-member cadence union.** No parser, no cron string, no RRULE | §4 |
| `--timezone` (IANA) | IANA zone per automation, validated at write time | §4 |
| `--time 09:00` | the wall-clock cadence's own field | §4 |
| `--prompt` | byte-capped and **refused**, never truncated | §9 |
| `--repo` (a fresh worktree per run) | **this is the act** — one `ws-add` per firing | §6 |
| `--workspace` / `--reuse-session` | out of scope for v1 | §14 |
| `--precheck '<shell command>'` | **structurally impossible**, and replaced by something sharper | §7 |
| `--missed-run-grace-minutes` | `graceMs`, per automation | §8 |
| `--disabled` | `state='paused'`; and a new automation **starts** paused | §7 |
| `--provider claude\|codex` | not a concept here; the roster places the work | §14 |
| run history: target, provider, precheck result, launch command, session handle | `automation_runs` + `automation_run_events` | §9 |
| UI: filter by state / last outcome / agent; search; **Rerun** | filters + *Run now* | §11 |
| `remove` deletes the automation **and its history** | **retire, never delete** — the history outlives it | §9 |

Three rows are where ccrc's constraints produce a *better* answer than a straight port:
`--trigger` (§4), `--precheck` (§7), and `remove` (§9). One row has no Orca counterpart at
all and is this design's own contribution: **an automation cannot be armed until the
operator has watched it run once** (§7).

## 2. The three rulings this feature must survive

This tree has rejected timer-driven work three times, in writing. A design that does not
name them is not finished.

1. **`ws-gc` on a timer** — `docs/superpowers/specs/2026-07-28-ccrc-workspace-lifecycle-design.md:251-254`:
   > "**A scheduled sweep.** `ws-gc` is a command. Running it on a timer is a decision to
   > make once the report has been read a few times and its judgement is trusted; wiring a
   > cron to a deleter that has never been observed is how a reclaimer becomes an incident."

2. **Deletion on a timer** — `docs/superpowers/specs/2026-07-29-ccrc-pr-lifecycle-design.md:14`:
   > "**Deletion is never automatic. Not on a timer, not after a grace window, not 'when we
   > are sure'.** A deferred deletion is an automatic deletion whose confirmation happened
   > before the facts did."

3. **The reconciler daemon** — `README.md:1730-1735`, and its spec at
   `docs/superpowers/specs/2026-08-12-swap-transcript-defect-family-design.md:892`
   ("**No reconciler daemon, no timer unit, no `ccd doctor` verb.**"):
   > "There is deliberately no reconciler daemon and no `ccd doctor`. The 2026-08-11
   > incident's stop was itself deliberate — an operator killing a runaway swap — and an
   > unattended process that tries to 'fix' a fleet row is exactly the kind of component
   > that could have fought that stop."

**Read together, all three object to the same thing: time as the sole authority for a
DESTRUCTIVE or CORRECTIVE act.** (1) and (2) are about a *deleter*; (3) is about a
*repairer* that would have fought a human's deliberate stop. None is a general objection
to a clock. Note that (3) also says "no **timer unit**" — a second, independent reason §3
lands the clock in-process rather than in systemd.

This tree has already established how to answer such a ruling, and established it as a
*satisfaction* rather than an override —
`docs/superpowers/specs/2026-08-11-artifact-lifecycle-policy.md:157`:

> "**This policy does not overrule that — it satisfies it.** The objection is to *time
> alone* as authority."

Automations satisfies all three, structurally rather than by promise:

- **It deletes nothing, and cannot.** The only fleet act is `ws-add`. `ws-rm` and `ws-gc`
  are `UNGRANTABLE_VERBS` — a whitelist prefix starting with either is a compile error
  **and** a boot refusal (`agent/src/whitelist.ts:253-254, 275-283, 551-565`) — and
  `ws-reap` is grantable only carrying `--expect`.
- **It repairs nothing, and cannot.** It never reads a session's state in order to decide
  that state is wrong. `ws-add` is the one act in this system with **no prior state to
  fight**: there is no row yet, so there is no human decision to overrule. §13.3 makes the
  lane's entire argv vocabulary `['ws-add']` a red suite.
- **Both halves are acts the operator already performs by hand, on the same phone.**
  `POST /api/projects/:project/workspaces` is the `+` already tapped on the fleet screen
  (`api.workspaceAdd`, `pwa/src/lib/api.ts:362-363`; its only caller is
  `pwa/src/screens/FleetScreen.tsx:143`), and `POST /api/sessions/:id/prompt` is what
  `StartProgramSheet` sends after its own create (`StartProgramSheet.tsx:373`, `:469`).
  **The one genuinely new joint is pairing them:** the workspace-add half carries no prompt
  today, and `StartProgramSheet` pairs a prompt with `POST /api/sessions` (a main-checkout
  `ccd start`/`enable`) rather than with a worktree. Automations composes the two halves the
  operator already drives separately — it invents neither.
- **Its failure mode costs the reversible thing.** The pr-lifecycle spec's own test
  applies: *"It destroys nothing — not the worktree, not the branch, not one gitignored
  byte. Every automatic failure mode costs disk, and disk is reversible."*
- **Ruling (1)'s own release condition is met, as a mechanism.** It says a timer becomes
  acceptable *"once the report has been read a few times and its judgement is trusted."*
  §7's arm gate is exactly that sentence in code: **no clock ever fires an automation the
  operator has not personally watched spawn at least once.**

**Where the objection genuinely binds, and is paid for in §7 and §8:** an unattended
spawner at 03:00 applies *pressure* — on accounts, on the disk floor, on the operator's
attention — that nobody consented to at 03:00. That is answered with a fail-shut
precondition ladder, a kill switch, a durable lease, and an auto-pause after repeated
failure. Not with a promise.

**Decision: Automations ships, and all three rulings stand unamended.** They forbid a
timer-driven deleter and a timer-driven repairer. This is neither.

## 3. The shape: one lane, one decision, one act

- **`shared/schedule.ts` (L0)** — *when*. Pure recurrence math, import-free (§4).
- **`server/src/auto/fire.ts` (L1)** — *whether, and what happens*. A `dispatchRun`-shaped
  decision: narrow injected deps in, a typed outcome union out; no `fastify`, `node:fs`,
  `node:sqlite`, or `reply`.
- **`server/src/watch.ts` (L4)** — *the clock ticking*. One lane, which decides nothing.

### Where the clock lives

`FleetWatcher` already owns the only recurring timer in the server process: one
`setInterval` at 2000 ms, `unref()`ed, re-entrancy-guarded (`server/src/watch.ts:563-575`).
Every periodic job rides it behind a `lastXSweep` watermark. This is doctrine and it is
mechanical: `server/test/lifecycle-sweep.test.ts:106` asserts `watch.ts` contains **exactly
one** `setInterval(`.

Three alternatives, and why each loses:

- **A systemd/launchd timer.** The server cannot install one — `systemctl` is in
  `FORBIDDEN_COMMANDS`, the server never SSHes the fleet host at runtime, and a `.timer`
  unit cannot read `coord.db` to know what is armed. Ruling (3) also refuses one by name.
- **A second `setInterval`.** Turns `lifecycle-sweep.test.ts:106` red, correctly.
- **A separate process.** `coord.db`'s concurrency model is *"one server process and
  `DatabaseSync` has no async surface — the in-transaction read **is** the CAS"*
  (`server/src/coord/schema.ts:471-481`). A second writer deletes that invariant.

**Decision: `sweepAutomations()` rides the existing tick behind `AUTOMATION_SWEEP_MS =
10_000`, `void`-dispatched with a `.catch()`, beside the two ledger dispatches and never
inside or beside `sweepMail`** (D9/D10: *"a second producer lands BESIDE the most
load-bearing loop on the box, never inside it"*).

**Consequence, stated loudly:** the finest granularity honoured is one minute, and a 10 s
lane means an automation nominally due at 09:00:00 takes its lease somewhere in
`[09:00:00, 09:00:10]` before `ws-add` even starts. Every run row therefore stores
`lateMs` rather than implying punctuality it does not have.

**`CoordMutex` is not needed and is not touched.** It is module-private
(`server/src/coord/routes.ts:65`, no `export`), and the question dissolves rather than
needing a workaround: this lane never calls `dispatchRun` or `closeRun` and opens no run
row, so it has nothing to serialise against the coordination routes. Its own concurrency is
handled one level down, by the lease CAS inside a single `tx()`.

## 4. The schedule vocabulary, and what a timezone costs

There is not one hit for `Intl.`, `TZ`, or `getTimezoneOffset` anywhere in `shared/`,
`server/src`, `pwa/src` or `agent/src` today. This feature introduces the tree's first
timezone concept, so the cost is argued rather than assumed.

**`shared/` may import nothing at runtime** — `shared/roster.ts:5-6` states it ("Pure and
import-free… it imports nothing — not even `node:*`"), and it is mechanically true because
`pwa/tsconfig.json:24` bundles `../shared` into the browser build. A cron library, an RRULE
library or a date library **cannot live there**.

But **`Intl` is a global, not an import.** `Intl.DateTimeFormat(…, {timeZone}).formatToParts()`
converts an epoch to wall-clock fields in any IANA zone with no dependency at all, and it is
present in both runtimes (measured here: Node v24.18.0, `Intl.supportedValuesOf('timeZone').length === 418`).

**Decision: the recurrence math is `shared/schedule.ts` — pure, import-free, `Intl` only —
so the server that computes `nextRunAt` and the PWA that previews "next fire" run the same
code.** No new dependency in any package, and single-source-of-truth is discharged: one
implementation, not a server copy and a browser copy that drift.

### The stored form: a closed union, not a cron string

**Decision: a two-member closed cadence union. No cron string, no RRULE, no parser.**

```ts
type Cadence =
  | { kind: 'wall-clock'; days: DayMask; hour: number; minute: number; tz: string }
  | { kind: 'interval';   everyMinutes: number }
  | { kind: 'unknown' }          // reader degrade; producers never write it
```

Orca's four presets become PWA chips over this: *hourly* → `interval 60`; *daily* →
`wall-clock` with all seven days; *weekdays* → `wall-clock` with Mon–Fri; *weekly* →
`wall-clock` with one day.

Why not a cron string, given Orca has one: a hand-rolled five-field cron parser (with
Vixie's dom/dow OR rule) would sit in **the one path that decides whether a workspace is
created, unattended**, for expressive power the closed union already covers. And a cron
string makes `* * * * *` spellable — a rate the interval floor must then police from
outside the parser rather than by construction. Every schedule the operator named is
expressible without it.

**The door is deliberately left open and costs nothing to walk through later:** `Cadence`
already carries `'unknown'`, and the spec is a small set of columns with one reader, so
adding a `'cron'` member later is one union member plus one arm and **needs no migration**.
See §15.

`interval` is in pure epoch minutes and has **no timezone at all** — "every 4 hours" means
every 4 hours, through a DST transition and out the other side. Only `wall-clock` carries a
zone, because only `wall-clock` names a time a human reads off a wall.

### DST, measured

Two hard cases, both measured against `Europe/Warsaw` on this machine. Both answers are
decisions.

**Spring forward — the gap.** 2027-03-28: local jumps 01:55 → 03:00.

| UTC | Warsaw |
|---|---|
| 00:55 | 01:55 |
| 01:00 | **03:00** |
| 01:05 | 03:05 |

An automation set for `02:30` has **no occurrence at all** that day.

> **Decision: fire at the first valid instant after the gap, and set `dstShifted` on the
> run row.** Skipping loses a firing once a year without telling anyone useful; the
> operator who wrote "weekdays at 02:30" wants the nightly job to run. `dstShifted` is why
> the history says *03:00, shifted* rather than reporting 03:00 as if it had been asked for.
>
> This is `systemd`'s `OnCalendar` behaviour, but **the box's own timers do not corroborate
> it and are not offered as if they did**: `ccrc-ddns.timer` is `OnCalendar=*:0/5` and
> `ccd-cap-scopes.timer` is `OnUnitActiveSec` — neither names a wall-clock hour, so neither
> can ever meet a spring-forward gap. The decision stands on its own reasoning.

**Autumn back — the fold.** 2026-10-25: local 02:25 happens **twice**.

| UTC | Warsaw |
|---|---|
| 00:25 | 02:25 |
| 00:55 | 02:55 |
| 01:25 | **02:25 again** |
| 01:55 | **02:55 again** |

> **Decision: fire once — the earlier of the two instants.** Enforced by searching forward
> from the last fired **local `(y,m,d,h,mi)` tuple**, never from the last fired epoch: the
> fold's second 02:25 is not strictly greater than the first *as a local tuple*, so it is
> never a candidate. This is the one place in the design where the obvious implementation
> (an epoch comparison) is the wrong one, and it fails silently — the second firing looks
> exactly like a correct one in the history.

**The algorithm is a local→epoch inversion over candidate local DAYS, not a minute walk.**
For each day the mask allows, form the nominal local tuple, probe the zone's offset a day
either side, and invert. Round-trip each candidate epoch back through `formatToParts` and
keep only those that render as the tuple asked for: a normal day yields one, **a fold yields
two — take the earlier**, and **a gap yields zero**.

**The gap answer is the transition instant, found by bisection — and this is the one part
that was measured wrong first.** A prototype run against the fixtures below returned *01:31*
for Warsaw's missing 02:30 because it scanned forward a minute at a time from the nominal
value, evaluating the offset at a **naive** number rather than a real instant, which near a
transition selects the pre-transition offset and lands *before* the gap. The correct answer
is structural: local time jumps straight over the requested wall clock, so the first valid
instant after the gap **is the transition itself**. Bisect the offset change across the local
day to the minute and return it. Verified: Warsaw 02:30 → **03:00**, Lord Howe 02:00 →
**02:30**, both with `dstShifted: true`.

**Two zones prove why the offset must be probed rather than assumed, and both were
measured, not asserted:**

| zone | January offset | July offset | what it breaks |
|---|---|---|---|
| `Pacific/Chatham` | **+825 min** (13:45) | **+765 min** (12:45) | any code that assumes a whole-hour offset |
| `Australia/Lord_Howe` | **+660 min** | **+630 min** | any code that assumes DST steps by an hour |

And Lord Howe's spring-forward is a **half-hour gap** — measured on 2026-10-04, local jumps
**01:45 → 02:30**, so local 02:00 and 02:15 do not exist that day. An implementation that
handles a gap by *"add one hour"* is correct in Warsaw and wrong here, and the failure is
invisible until someone schedules an automation in that zone. The inversion has no such
assumption: it asks the zone what the offset is on both sides and takes what it is told.

**Decision: an unknown or unsupported IANA zone is a loud, distinct condition, never a
silent UTC fallback.** Measured: `new Intl.DateTimeFormat('en-GB', {timeZone:'Not/AZone'})`
throws `RangeError`. `shared/schedule.ts` catches it and returns
`{unschedulable: 'unknown-timezone'}`, which lands in `automations.scheduleError` — a
column that exists so *paused*, *unschedulable* and *due at T* are three facts rather than
one nullable integer.

**A small-ICU Node is a real hazard and is detected, not assumed.** A Node built without
full ICU resolves every zone to UTC *without throwing*, which would silently fire every
wall-clock automation at the wrong hour. A boot-time assertion proves the running Node
resolves a non-UTC zone (compare a January and a July offset for a DST zone: they must
differ), so a small-ICU build fails CI rather than the operator's morning.

## 5. Schema

One new migration: `MIGRATIONS[6]`, `user_version 6 -> 7`. `MIGRATIONS[0..5]` are frozen —
all six are on `origin/main`, and `server/src/coord/db.ts:182-190` only executes
`MIGRATIONS[v]` for `v >= current`. `COORD_SCHEMA_VERSION = MIGRATIONS.length` derives.

**Slot 5 is already taken, and checking that is the whole discipline.** `MIGRATIONS[5]` is
D-792's `ALTER TABLE mail_deliveries ADD COLUMN lastGate/gateCount/gateSince/gateAt`
(`server/src/coord/schema.ts:638`) — the transient-gate-visibility work, which landed while
this design was being written. An "append" computed against a stale base would not have
appended: it would have **overwritten a shipped migration**, and `db.ts`'s
`for (let v = current; v < COORD_SCHEMA_VERSION; v++)` would then never run the automations
DDL at all on a live box. Re-count the banners on `origin/main` before writing the entry.

```sql
CREATE TABLE automations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  state          TEXT NOT NULL,     -- armed|paused|retired. Read through isAutomationState;
                                    -- 'unknown' is a READER degrade, never written.
  project        TEXT NOT NULL,
  prompt         TEXT NOT NULL,     -- <= AUTOMATION_PROMPT_MAX_BYTES, REFUSED not truncated

  -- The cadence, flattened. FOUR columns with ONE reader (hydrateAutomation), so a future
  -- 'cron' member is a member plus an arm and needs no migration.
  cadenceKind    TEXT NOT NULL,     -- wall-clock|interval
  cadenceDays    INTEGER,           -- 7-bit day mask; NULL iff kind='interval'
  cadenceMinute  INTEGER,           -- minutes past local midnight; NULL iff kind='interval'
  cadenceEvery   INTEGER,           -- epoch minutes; NULL iff kind='wall-clock'
  tz             TEXT,              -- IANA zone; NULL iff kind='interval' — an interval has
                                    -- no timezone, and a stored 'UTC' would be a lie

  graceMs        INTEGER NOT NULL,  -- how late a missed occurrence may still fire
  createdAt      INTEGER NOT NULL,
  updatedAt      INTEGER NOT NULL,

  -- §7's arm gate. NULL = never proved by a manual run, so the clock may not have it.
  provedAt       INTEGER,

  -- The three-way split that keeps 'not armed', 'cannot be scheduled' and 'due at T' from
  -- collapsing into one nullable integer. INVARIANT:
  --   state='armed' AND scheduleError IS NULL  <=>  nextRunAt IS NOT NULL
  nextRunAt      INTEGER,
  scheduleError  TEXT,              -- unknown-timezone|bad-cadence|no-future-occurrence
                                    -- |failure-ceiling. NULL when the schedule is fine.

  lastFireAt     INTEGER,           -- NULL = has NEVER fired. Distinct from 'fired and failed'
                                    -- (lastFireAt set + lastOutcome='failed').
  lastOutcome    TEXT,              -- NULL only while lastFireAt IS NULL
  lastRefusal    TEXT,              -- NULL unless lastOutcome IN ('refused','skipped','failed').
                                    -- Denormalised beside lastOutcome for one reason: the 44px
                                    -- list row renders the refusal SENTENCE inline (§11) and the
                                    -- list read must not join to automation_runs.

  -- The lease, in `claims`' shape (schema.ts:483-545): a soft bound renewed by measurement
  -- and a hard bound that is NEVER extended, so a runner that dies mid-spawn releases the
  -- schedule on its own instead of wedging it forever. DURABLE, not an in-memory Set: a
  -- spawn can outlive the process, and an in-memory claim would leave a 'firing' row that
  -- nothing ever resolves.
  leaseUntil     INTEGER,
  leaseHardUntil INTEGER,

  consecutiveFailures INTEGER NOT NULL DEFAULT 0,
  runsEvicted         INTEGER NOT NULL DEFAULT 0   -- §9: retention is a ceiling, and the
                                                   -- rows it dropped are a NUMBER, not a silence
);
-- provedAt is IN the index because it is a conjunct of the due predicate (§6 step 2): the
-- arm gate is a STORE invariant, not only a route arm, so a row the operator has never
-- watched run cannot be selected for firing even by a caller that bypassed the route.
CREATE INDEX automations_due        ON automations(state, provedAt, nextRunAt);
CREATE INDEX automations_by_project ON automations(project);

CREATE TABLE automation_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  automationId INTEGER NOT NULL REFERENCES automations(id),
  scheduledFor INTEGER NOT NULL,    -- the OCCURRENCE this run is for, not when it started
  startedAt    INTEGER NOT NULL,
  endedAt      INTEGER,             -- NULL = still in flight
  lateMs       INTEGER NOT NULL,    -- startedAt - scheduledFor
  outcome      TEXT NOT NULL,       -- running|ok|refused|failed|skipped|missed|lost
  refusal      TEXT,                -- NULL unless outcome IN ('refused','skipped','failed')
  trigger      TEXT NOT NULL,       -- schedule|manual|catchup
  dstShifted   INTEGER NOT NULL DEFAULT 0,
  adopted      INTEGER NOT NULL DEFAULT 0,   -- §6: this session was bound from a CUT-SHORT
                                             -- spawn. A tick with an asterisk, never a clean one.

  sessionId    TEXT,   -- the session this run created; all four NULL = none was created
  workspace    TEXT,
  branch       TEXT,
  wrapper      TEXT,
  homeScore    INTEGER, -- the account pressure forecast at fire time. NULL = UNMEASURED,
                        -- which is not 0 (limits.ts:40-47's ruling).
  spawnRc      INTEGER  -- ccd's rc. NULL = never measured (a cut-short exec), NOT 0.
);
CREATE INDEX automation_runs_by_automation ON automation_runs(automationId, id DESC);

CREATE TABLE automation_run_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  runId          INTEGER NOT NULL REFERENCES automation_runs(id),
  at             INTEGER NOT NULL,
  step           TEXT NOT NULL,    -- precheck|lease|spawn|identify|prompt|close
  ok             INTEGER NOT NULL,
  detail         TEXT NOT NULL DEFAULT '',
  truncatedBytes INTEGER NOT NULL DEFAULT 0   -- ALWAYS emitted, including 0, so 'nothing was
                                              -- cut' differs from 'an older server did not report'
);
CREATE INDEX automation_run_events_by_run ON automation_run_events(runId, id);

CREATE TABLE automations_state (
  id        INTEGER PRIMARY KEY CHECK (id = 1),
  paused    INTEGER NOT NULL,     -- the global kill switch. §7 argues why it is a ROW, not a FILE.
  updatedAt INTEGER NOT NULL
);
INSERT INTO automations_state (id, paused, updatedAt) VALUES (1, 0, 0);
```

History is ordered by each table's own `AUTOINCREMENT id`, never by a producer clock —
`at` is a clock and clocks move (`server/src/coord/schema.ts:205-216`).

## 6. The fire path

Every numbered step writes an `automation_run_events` row; that trail **is** the log.

1. **Gate the lane.** `if (!this.primed) return;` (restart-quiet,
   `server/src/watch.ts:461, 880-886`), then the interval gate, then
   `const store = this.deps.coord; if (!store) return;`.
2. **Read due rows.** `store.dueAutomations(now)` —
   `state='armed' AND provedAt IS NOT NULL AND scheduleError IS NULL AND nextRunAt <= now`,
   `ORDER BY id`, with `now` passed **in**. The store owns no policy and reads no clock
   (`server/src/coord/store.ts:1443`). **`provedAt IS NOT NULL` is a conjunct here, not only
   a route arm** — the arm gate (§7) has to be a store invariant, or a fixture that inserts
   an armed row bypasses it entirely.
3. **The pre-claim rungs.** `overlap` and `cap-concurrency` (§7 rungs 1 and 2) are checked
   **before** the claim, and this ordering is forced rather than stylistic: a rung that ran
   after the claim could never observe an overlap — this sweep would already hold the lease —
   and `overlap` would be a dead union member. Their run rows are opened **un-leased**, as
   `skipped`/`refused`, so the losing sweep still leaves a row.
4. **Claim the lease, advance `nextRunAt`, and open the run — ONE `tx()`, one store method.**
   `claimAndOpenRun` does all three, because two transactions have a gap with a real defect
   in it: a crash between a taken lease and an un-advanced `nextRunAt` leaves the occurrence
   still `<= now`, so when `leaseHardUntil` lapses (§8's whole point) **the same occurrence
   fires again** — precisely the repeat this design promises cannot happen. One transaction,
   using the un-wrapped `*Inner` forms because `tx()` does not nest. A crash now **loses** a
   firing; it never repeats one. This generalises `markDispatchStarted`'s rule — *a stamp
   that describes a window is written BEFORE the act it describes*
   (`server/src/coord/dispatch.ts:326`).
5. **The remaining preconditions** (§7 rungs 3-9). A refusal settles the run
   `outcome='refused'` with its code, releases the lease, and moves on. **No fleet act has
   happened.** Rung 2's count excludes this run's own row, which is already `running`.
6. **Spawn.**
   ```ts
   deps.runCcd(CCD_ARGV.wsAddAuto(project, sweepDec(deps.fleetState, `auto:${id} fire`)))
   ```
   between a BEFORE tolerant `readRegistry` and an AFTER intolerant `readRegistryMeasured`.
7. **Identify by registry diff.** The unique new row with `project === automation.project
   && workspace !== null`. `candidates.length !== 1` is `spawn-ambiguous`. **Never parse ccd's stdout
   line** — `dispatch.ts` refuses that explicitly, and the file contains exactly one mention
   of `wrapper`, in that refusal (`server/src/coord/dispatch.ts:254`). **And never recompute
   `<wrapper>-<project>`** — `cmd_swap` rewrites the registry's wrapper and keeps the id, so
   the formula is wrong for any swapped session; that is D-291's rule, and it lives in the
   PWA where the mistake was made (`pwa/src/fleet/StartProgramSheet.tsx:94-98`), not in
   `dispatch.ts`.
8. **The adoption gate**, verbatim from dispatch §1.5: on a non-zero `ws-add`, bind the
   candidate only if `cutShort(res) === true && winner.held === null`. `cutShort` returns
   `UNMEASURED` when the signal was never measured, and **only a literal `true` adopts**
   (`server/src/coord/dispatch.ts:400`). An adopted session sets `adopted = 1`.
9. **Prompt.** `sendPrompt` through the one process-wide `KeyedQueue`. **Never
   `replaceDraft`** (§13.6).
10. **Close.** Outcome, `endedAt`, `lateMs`; reset or increment `consecutiveFailures`; prune
   the ring and accumulate `runsEvicted` (§9); release the lease; emit.

### A manual run does not ride the sweep

**Decision: `POST /api/automations/:id/run` calls `fireAutomation` directly** — on any state
but `retired`, ignoring `state`, `provedAt` and `nextRunAt`, and running §7's rungs 3-9 but
not the due predicate. It is the only door that can fire an un-armed automation, which is
exactly what makes the arm gate (§7) reachable: a new automation is created `paused` with
`provedAt` NULL, so the sweep's due predicate excludes it by construction, and the operator's
tap is the only way it can ever run a first time.

**Consequence for the wiring, stated because it is easy to miss:** `auto/routes.ts` therefore
needs the **same `FireDeps` the sweep gets** — `runCcd`, `io`, `cfg`, `tmux`, `queue`,
`fleetState`, `coord` — passed in at `index.ts`. A route file that only received the store
could not run this route at all. `202` is returned once the preconditions pass and the run row
is open; the spawn continues after the response, and the operator watches the run detail.

### A new `CCD_ARGV` builder, and why the existing one is wrong

`CCD_ARGV.wsAddWorker(p, dec)` looks reusable — it is the only existing `ws-add` builder
that takes a dec — but it hardcodes **`--no-rc`**, and that flag is not cosmetic. Measured
in `ccd`: `--no-rc` sets `norc=1`, which stamps `_reg_set "$id" rc off` on the registry row
at creation (`ccd/ccd:3646, 3792`), and every later spawn *and resume* of that session reads
it:

```
rcflag=""
_rc_enabled && [[ "$(_reg_get "$id" rc)" != "off" ]] && rcflag="--remote-control '$id'"
```
(`ccd/ccd:11745`)

So the row **permanently loses `--remote-control`, whatever the box says** — the file's own
header states it: *"a row stamped `rc=off` (`ws-add --no-rc` — a dispatched worker, task
#37) spawns plain even on an `on` box"* (`ccd/ccd:7-8`). The flag is scoped by the
2026-08-13 ruling to **dispatched programme workers**, and ccd calls it *"the dispatch
path's spelling of 'this pane is a dispatched worker'"* (`ccd/ccd:11738-11740`).

An automation's session is one the operator opens from their phone and works in. Inheriting
`--no-rc` would silently opt every automation out of remote control, once, at birth, with no
later way to notice.

**Decision: a new builder, `wsAddAuto: (p, dec) => argv(['ws-add', p, ...decFlags(dec)])`.**

The cost is exactly **two** things, because **`['ws-add']` is already granted one-token in
the agent whitelist with trailing tokens unconstrained**:

- a `SAMPLES` entry (`whitelist-subset.test.ts:79` asserts `Object.keys(SAMPLES)` equals
  `Object.keys(CCD_ARGV)` exhaustively), and
- a token-for-token `EXPECTED` argv assertion (`:348-350`).

**`ccdargv-dec-parity.test.ts` needs no edit, and it is worth being precise about why**: it
derives dec-appending **verbs**, not builder keys — `decAppendingVerbs()` regexes `argv[0]`
out of each table entry that mentions `decFlags(` — and pins the result by exact equality at
`['ws-add','ws-archive','ws-hold','ws-release','ws-rename','ws-restore']`. `wsAddAuto` emits
`ws-add`, already a member with an existing `PROBES` entry, so the derived set is
byte-identical and `wsAddAuto` can never appear in it.

That is also the gap it leaves, so the plan closes it deliberately rather than claiming
coverage it does not have: the existing probe measures `wsAddWorker`'s token order, not
`wsAddAuto`'s — and the two differ exactly where it matters, the dec landing immediately
after the project with no `--no-rc` between. **Task 5 adds a second arm to that suite's own
`ws-add` case composing through `wsAddAuto`**, so the new builder's token order is crossed
against the real binary. Do not write "the derived probe set now contains `wsAddAuto`" — that
set holds verb strings and the assertion is unwritable.

**Zero new agent whitelist prefixes. Zero new ccd verbs. No `verbSupported` preflight** —
`ws-add` is in `UNGATED_BY_DECISION` (`server/test/verb-gate.test.ts:58-60`). **`ccd/` is
not touched, so this is NOT an agent-first deploy.**

### The three spawn words

`cutShort`'s tri-state is promoted to the wire rather than flattened, because the three
conditions have three different operator actions:

- **`spawn-refused`** — ccd refused and touched nothing. Nothing to clean up.
- **`spawn-cut-short`** — ccd was killed at the 300 s ceiling and **may have left a
  workspace only a human may clear**. The candidate ids it saw are in the step detail.
- **`spawn-unmeasured`** — the transport dropped and we cannot say which of the two happened.

This is not hypothetical, **but it is narrower than an earlier draft of this spec claimed —
and the correction matters, because this is the paragraph that justifies calling
orphan-manufacture the worst thing this feature could do.** The agent hard-clamps every exec
at 300 s (`MAX_EXEC_TIMEOUT_MS`, `agent/src/server.ts:61`). The ~900 s first-run settle is
**superseded**: ccd's wall-clock bound on the agent-reachable path is now
`SPAWN_SETTLE_S=240`, chosen precisely to fit under that ceiling, and ccd states that
exceeding it is *"a REPORT, not an orphan"* because the claim and the supervision now precede
the wait (`ccd/ccd:849-857`). The ~900 s figure — and the 1350 s one — describe the old
purely-iterative gate and `cmd_supervise`, which no automation drives.

What remains is real but small: **a kill can still land anywhere else in `cmd_ws_add`, under
the ceiling, and only a human may clear what the adoption gate declines to bind.** So the
word stays distinct, and the design names the condition rather than cleaning it up — cleanup
is repair, and repair is ruling (3).

### Why `sendPrompt` and not the mail lane

The mail lane is durable, retried, backed off, parked, and carries `mail-disabled` as a stop.
It is nonetheless not chosen, for three reasons:

- **An automation prompt has no correspondent.** `mail` rows carry `fromId`/`fromUuid` and
  the envelope carries an `ack:<deliveryId>` line. There is no session to ack to.
- **What lands is a nudge, not the prompt.** `renderMailNudge`
  (`server/src/coord/envelope.ts:166`) is genuinely self-sufficient — it names
  `~/.local/bin/ccrc-api` by explicit path and all three subcommands — but the session must
  still choose to follow it. The operator's mental model is "my prompt runs at 09:00", not
  "a fresh session is told to go fetch something".
- **`sendPrompt` returns exactly the vocabulary to record.** `not-alive | dialog-open |
  draft-present | draft-clear-failed | verify-failed | enter-ignored`
  (`server/src/inject/send.ts:18`) — six named conditions straight into a step row.

The idle gate exists to protect a human's half-typed draft, and this pane was created
ninety seconds ago by this call. `sendPrompt` still refuses on `draft-present` on its own,
so the protection survives without waiting `MAIL_QUIET_MS` for a draft that cannot exist.

**Decision: direct `sendPrompt`, never with `replaceDraft`, with a bounded retry ladder
across subsequent sweeps recorded as `prompt` steps.**

**Consequence, stated loudly:** this design owes a second hand-written retry/backoff/ceiling
that the mail lane would have given free, and it forfeits `mail-disabled` as a stop for
automations (the §7 kill switch replaces it). A spawn that succeeds and a prompt that never
lands is a real outcome with its own name — `outcome='failed'`, `refusal='prompt-refused'`,
**with the session id recorded**. The operator gets a live session with no prompt in it,
which is strictly better than a lie. See §15 for the signal that would flip this.

## 7. Preconditions — ccrc's honest `--precheck`

Orca's `--precheck` runs a shell command and records a skipped run on a non-zero exit.
**ccrc cannot do this and should not want to.** `EXEC_COMMANDS = ['tmux','ccd']` is closed;
every shell, `gh`, `git`, `systemctl` and `crontab` are in `FORBIDDEN_COMMANDS`, and
`agent/src/whitelist.ts:157-166` proves the sets disjoint with a conditional type that
collapses to `never` on overlap. A scheduler that could run an arbitrary shell command on
the fleet host would be a larger hole than everything this feature adds.

The honest equivalent is *sharper* than a shell probe, and the reason is worth stating
plainly: **a shell probe's exit code is one unnamed bit, while a named rung carrying a
measured value is what makes "why didn't it run at 07:00?" answerable from a phone.**

**The ladder is split by the claim (§6 steps 3-5), and the split is forced.** Rungs 1-2 run
*before* the lease is taken; rungs 3-9 run after.

| # | Precondition | Refusal | Fails shut? |
|---|---|---|---|
| **1** | **this automation is not already leased** | `overlap` | n/a (§8) |
| **2** | **in-flight automation runs `< AUTOMATION_MAX_CONCURRENT`** | `cap-concurrency`, **with the limit and the count** | n/a |
| — | *— the lease is claimed here (§6 step 4) —* | | |
| 3 | the registry directory is listable | `registry-unmeasurable` | **yes** |
| 4 | `automations_state.paused = 0` | `automations-paused` | n/a (local row) |
| 5 | `$REG/coordinator-paused` absent | `coordinator-paused` | **yes** — same `readdir` as (3) |
| 6 | the project is known to `cfg` | `unknown-project` | n/a |
| 7 | some account is placeable — `projectHome(roster, limits) !== null` | `no-placeable-account` | n/a |
| 8 | the placed account's measured pressure is below the ceiling | `account-pressed`, **carrying the ceiling and the score** | no — **unmeasured proceeds** |
| 9 | `consecutiveFailures < AUTOMATION_FAILURE_CEILING` | `failure-ceiling`, **and the automation auto-pauses** | n/a |

**Why rungs 1-2 must precede the claim.** An `overlap` rung *after* the claim could never
fire — this sweep would already hold the lease — so `overlap` would be a declared union
member that nothing emits, which the tree's both-directions refusal-code scan treats as a
defect. And the losing sweep needs somewhere to write `skipped`: its run row is opened
**un-leased**, outside the claim transaction, precisely so the row survives the claim it
lost. Rung 2 has the mirror problem — counted after the claim it would include this run's
own `running` row, so a ceiling of 2 would admit 1.

Five notes a reviewer should check:

- **(3) and (5) are one `readdir`, and the fail-shut collapse is deliberate**
  (`server/src/coord/dispatch.ts:223`, `server/src/watch.ts:2215`): a directory we cannot
  list is a pause we cannot rule out. They still record **different** codes. That is not a
  weakening of fail-shut — it is *"an adapter may not narrow a distinction it received"*
  applied at a seam where `io.readdir` already hands us `null` vs `[]`. At 07:05 on a phone,
  *"I paused the fleet last night"* and *"the fleet box is unreachable"* are different
  sentences with different fixes.
- **(7) cannot wedge a fresh box.** `projectHome` returns `null` **iff every home-able lane
  is disabled** — an unmeasured account is still placeable, falling back to the first in
  roster order (`server/src/limits.ts:72-84`). *Unknown is not unplaceable.*
- **(8) needs a seam that does not exist yet, and the plan opens it rather than copying a
  rule.** `ProjectedHome.score` is a non-nullable `number` (`shared/api.ts:2520-2523`) and
  `projectHome`'s all-unmeasured fallback returns a literal `score: 0`
  (`server/src/limits.ts:106`) — so *unmeasured* and *a measured zero* are already collapsed
  on the way out, and `homeScore: NULL` is unreachable through that function. The rule that
  separates them is `measured()`, which is **module-private** (`limits.ts:40`, no `export`).
  **Decision: export `measured` — one line, no second copy — and have rung 8 read
  `measured(limits[projected.wrapper])`: `null` is UNMEASURED, a number is the score.**
  Hand-copying its `five === null || seven === null` rule into `auto/` would be a second
  definition of a single-source-of-truth rule, which is the one thing
  `single-definition.test.ts` exists to prevent.
- **(8) is also this design's one deliberate departure from `projectHome`'s stated
  philosophy, and it is flagged as such.** `limits.ts:82-84` argues for the human path that
  *"a projection of 99 is precisely the warning the user needs, and inventing 'none
  available' here would describe an outcome ccd never produces."* That is right for a human
  tapping a button. It inverts for an unattended actor: **a spawn onto a spent account costs
  a real worktree on a real disk that a human must then clear, while a refusal costs a row.**
  An **unmeasured** lane proceeds and records `homeScore: NULL` — never `0`. §15 asks the
  operator to set the number, and to flip this if it starts refusing runs they wanted.
- **(2) and (9) carry their numbers.** *"A cap that refuses without saying what it is is
  indistinguishable from a bug"* (`server/src/coord/dispatch.ts:238-240`).

### The arm gate: no clock fires what the operator has not watched work

**Decision: a new automation is created `paused`. `POST /api/automations/:id/arm` refuses
`never-run-by-hand` until at least one MANUAL run of that exact automation has settled with
a session created. `provedAt` records when.**

This is §2's ruling (1) release condition — *"a decision to make once the report has been
read a few times and its judgement is trusted"* — turned into a mechanism rather than a
promise, and it catches the whole class of mistakes that only show up at 03:00: a wrong
project slug, a prompt that makes no sense to a fresh session, a disabled lane. It costs the
operator one extra tap, once, per automation.

### Why the global kill switch is a ROW and not a FILE

Every other kill switch here is a file on the fleet host — `$REG/coordinator-paused`,
`$REG/mail-disabled`, `$REG/<wrapper>-disabled`. This one deviates, mechanically:

**The server cannot write to `$REG`.** The agent's write whitelist is `$HOME/.cc-clips/` and
nothing else (`agent/src/whitelist.ts:79-81`), and `FleetIO` exposes `writeFileB64` with no
unlink (`server/src/io.ts:41-64`). `coordinator-paused` is phone-writable only because a
whitelisted **ccd verb** exists to do it, and a new ccd verb costs five coordinated edits
plus an agent-first deploy (`ccd/ccd:4713-4759`) against a standing "zero new ccd verbs"
posture.

The file shape exists so **ccd and the coordinator skill on the fleet host can read the
switch**. Nothing on the fleet host reads automation state. The row is the correct shape
here, and this does not weaken the file convention for anything that needs it.

**Note that rung (3) means the operator's existing fleet-wide pause already stops
automations too** — one switch they already know, already reachable from the phone. A
paused-by-the-fleet automation renders as *armed · held by the fleet pause*, never as armed
and silently idle.

## 8. Failure, lateness and overlap

### Overlap

**Decision: a DURABLE lease on the automation row — `leaseUntil` renewed by measurement,
`leaseHardUntil` never extended — copying `claims` (`server/src/coord/schema.ts:483-545`).
A due firing against a live lease records `outcome='skipped'`, `refusal='overlap'`.**

Not the `mailInFlight` in-memory `Set`: that shape is right for work that cannot outlive
the process, and a spawn can. An in-memory claim would leave a `running` row after a
restart that nothing ever resolves. The hard bound is what makes a dead runner's lock lapse
on its own; a run whose lease lapsed while `running` settles `outcome='lost'` — a record
written, nothing on the fleet touched.

**Skipped, not queued.** A queued backlog of spawns is exactly the 03:00 pressure §2
promised to prevent. Skipping is visible, bounded, and recoverable by *Run now*.

### Lateness and missed firings

**Decision: per-automation `graceMs` (Orca's `--missed-run-grace-minutes`). On the first
armed sweep after a restart, an occurrence within `graceMs` fires ONCE with
`trigger='catchup'` and its real `lateMs`. Beyond grace it records `outcome='missed'` and
advances.**

**Exactly one catch-up per automation per restart — never one per missed occurrence.** A
box off for a weekend must not wake and spawn ninety sessions.

**Where that bound is stored, because no column holds it and `primed` cannot serve.**
`sweepAutomations` returns early while `!primed`, so by the time it runs at all the priming
tick is already past — there is no "first armed sweep after a restart" flag to read.
**Decision: an in-memory `Set<number>` on the watcher.** An automation id enters it the first
time this process fires or records a late occurrence for it, and the catch-up arm is offered
only for an id not in the set. In-memory **deliberately**: the bound is per *restart*, so a
durable column would suppress a legitimate catch-up after the next boot. Without the set, an
`interval` automation whose period is shorter than `graceMs` yields one catch-up per
occurrence inside the window — exactly the ninety-session wake this rule forbids.

**A missed firing is a ROW**, with the `scheduledFor` it was for. A hole in a history is a
row, not a silence (`server/src/coord/schema.ts:398-420`); an operator told nothing would
reasonably believe it ran.

### Repeated failure

**Decision: `AUTOMATION_FAILURE_CEILING` consecutive non-`ok` outcomes moves the automation
to `state='paused'` with `scheduleError='failure-ceiling'`.** An automation failing
identically every hour forever is noise that trains the operator to ignore the feature.
`consecutiveFailures` resets on the first `ok`. **`skipped` does not count** — it is not a
failure of the automation, it is the lease working.

## 9. Logs, and what "full history" means

The tree has two *opposite* shipped retention precedents, each stating its reason:
`feed_events` prunes to `FEED_RETENTION = 2000` **in the same transaction as its insert**
and clamps its read limit to the same ceiling; `lifecycle_events` is **never pruned**
(~90 MB/year) on the rule *bound the producer, never the record*, and pays for it by
**reporting its growth**. Silently unbounded is already ruled out, and *retention is a
ceiling, not a schedule* — there is no time-based deletion anywhere in this tree, and this
design adds none.

**Decision: `automation_runs` is a PER-AUTOMATION ring of `AUTOMATION_RUN_RETENTION = 200`,
pruned in the same `tx()` as its insert, with the read clamp equal to the ceiling.** Scoped
per *parent*, so a five-minute automation cannot evict a weekly one's history.
`automation_run_events` is deleted with its run rows in that same transaction.

`lifecycle_events`' never-prune class is the more honest one for a record table and this
tree prefers it. It is rejected here on arithmetic alone: this producer is a **clock**, and
N automations at the interval floor is a rate no bounded producer argument covers, inside a
file every deploy `VACUUM INTO`s into ten backups. §15 carries the flip.

**But the eviction is not a silence.** Each prune accumulates into `automations.runsEvicted`
and the runs list renders a **gap row** — *"142 earlier runs are no longer kept"* — for the
same reason `lifecycle_gaps` exists: a hole in a history is a row. And
`automationStats()` joins `/api/fleet/health`, so the growth is reported the way
`lifecycleStats` already is.

**Decision: step `detail` is capped at `AUTOMATION_DETAIL_MAX_BYTES = 2048` UTF-8 bytes with
`truncatedBytes` ALWAYS emitted** — including `0`, so *nothing was cut* differs from *an
older server did not report*. ccd's stderr on a failed spawn is the largest text stored.

**Decision: the operator's `prompt` is REFUSED over `AUTOMATION_PROMPT_MAX_BYTES, never
truncated.** Operator prose is not machine output; `LC_REASON_MAX_BYTES` sets this policy
for exactly this reason.

### Delete means retire

Orca's `remove` deletes the automation *and its history*. This tree's rule is the opposite,
and here it is in its own words — `retireGeneration`'s docstring
(`server/src/coord/store.ts:2110-2112`):

> "RETIRE, NEVER DELETE. A retired generation's cursor and size are the evidence behind its
> gap row; destroying them would destroy the record of what was lost."

**Decision: delete is `state='retired'`. The runs survive.** A retired automation leaves the
default list and never fires again, but *"what did that thing do before I removed it?"*
stays answerable — which is the point of asking for a history.

## 10. Wire and routes

### Where the routes live

**Decision: a new file, `server/src/auto/routes.ts` — deliberately NOT `coord/routes.ts`.**

`/api/automations` is not one of the eight coordination prefixes
(`server/test/coord-routes-single-file.test.ts:20-21`). Keeping it out keeps the
coordinator-skill parity scan and the mail reject-code scan out of this diff.

**This creates a real hole the plan must close first.** `server/test/auth-gate.test.ts:80`
builds its route inventory from exactly two hard-coded files:

```ts
const ROUTES: ScannedRoute[] = [...scanRoutes('server.ts'), ...scanRoutes('coord/routes.ts')];
```

A third route file is **invisible** to the `401 no-session` sweep — the suite stays green
while unauthenticated callers could list, create and fire automations. The plan's route task
adds `auto/routes.ts` to `scanRoutes` and re-pins the counts **before** registering a single
route (today: `server.ts` 46, `coord/routes.ts` 22, `ROUTES.length` 68, HTTP 65,
`gated.length` 41).

`server/test/single-definition.test.ts`'s coord-ring handle scan has the same shape of hole:
it is directory-scoped to `server/src/coord` (`:397`), so a `node:sqlite` handle in
`server/src/auto/` would pass it silently. The plan extends it to the new directory.

### Gating

**Decision: session gate only. Nothing added to `EXEMPT`; no `x-ccrc-mail-token` on any
automations route.** The box token authenticates the *fleet host*, and every session on that
single-uid box holds it — so a schedule the fleet can write is a schedule any session can
install **for itself, standing and unattended**, which is strictly wider than the path `gh`
was refused for. A route the phone drives sits behind the session gate.

**Decision, written down as a non-goal rather than left unstated: a fleet-host session
cannot create, edit, arm or trigger an automation in v1.**

### The routes

| Method | Path | Purpose | Status map |
|---|---|---|---|
| `GET` | `/api/automations` | list | 200 |
| `POST` | `/api/automations` | create (always `paused`) | 201 / 400 / 409 `bad-schedule` / 413 |
| `GET` | `/api/automations/:id` | one, with its recent runs | 200 / 404 |
| `POST` | `/api/automations/:id` | edit | 200 / 404 / 400 / 409 / 413 |
| `POST` | `/api/automations/:id/arm` | arm — **refuses `never-run-by-hand`** | 200 / 404 / 409 |
| `POST` | `/api/automations/:id/state` | pause \| retire | 200 / 404 / 409 |
| `POST` | `/api/automations/:id/run` | *Run now* — `trigger='manual'` | 202 / 404 / 409 **with the refusal code** |
| `GET` | `/api/automations/:id/runs` | history, clamped to the ceiling | 200 / 404 |
| `GET` | `/api/automations/runs/:runId` | one run **and its steps** | 200 / 404 |
| `POST` | `/api/automations/pause` | the global kill switch | 200 |

`get`/`post` only. Retire is a state transition, not a verb (§9).

**Run-now constructs its dangerous fields as literals at the call site** and reads none off
the request body — the D-280 rule that makes *the phone can trigger; the phone can never
re-target* structural.

### The frame

**Decision: one additive frame, `{type:'automations', automations: AutomationSummary[]}`.**
`FLEET_PROTO` stays `1` — a bump is a deliberate kill-switch action, never a side effect of
shipping a feature, and an already-deployed PWA silently dropping an unknown frame *is* the
mechanism. Emitted from `tick()` beside `emitRuns()`, byte-diffed against a
`null`-initialised `lastAutomationsJson` (never `'[]'`, so the first measurement always
emits), with a `Bus` overload triple and a `/ws/fleet` cold start chained after `onCoord`.

**Run history is NOT on the frame** — it is a cold read. One automation's history is on
screen at a time; 200 rows × N automations on a 2 s byte-diff is a cost with no reader.

### Notifications — and the constraint that shapes them

**`NotifyEvent.sessionId` is `string`, non-nullable** (`shared/api.ts:2829`), and both the
presence gate and the default collapse tag key on it. **A run that created no session
therefore cannot raise a `NotifyEvent` at all** — a refused firing, a missed occurrence and
a `no-placeable-account` have no session id to carry, and widening that field is a narrowing
older clients cannot tolerate.

**Decision: only a run that produced a session notifies, and it reuses `kind:'run'` rather
than minting a seventh kind.** Everything else is visible where it belongs — on the
Automations screen, in the run history, and in `automationStats()`. The durable record is
`automation_runs`, which carries the code, the numbers, the stderr and the sentence —
strictly more than a feed row would.

### Vocabularies

Each is a union → a private `Record<Union, true>` map → a derived `Object.keys` list → an
exported `is<Enum>` guard, with a designated `'unknown'` that readers degrade to and
producers never write.

```
AutomationState    armed | paused | retired | unknown
AutomationOutcome  running | ok | refused | failed | skipped | missed | lost | unknown
AutomationRefusal  registry-unmeasurable | coordinator-paused | automations-paused
                 | unknown-project | no-placeable-account | account-pressed
                 | cap-concurrency | overlap | failure-ceiling
                 | spawn-refused | spawn-cut-short | spawn-unmeasured | spawn-ambiguous
                 | prompt-refused | unknown
AutomationStep     precheck | lease | spawn | identify | prompt | close | unknown
AutomationTrigger  schedule | manual | catchup | unknown
CadenceKind        wall-clock | interval | unknown
ScheduleError      unknown-timezone | bad-cadence | no-future-occurrence | failure-ceiling
                 | unknown
AutomationRouteRefusal
                   never-run-by-hand | bad-schedule | bad-transition | oversize | unknown
```

**Two vocabulary boundaries that are easy to get wrong, so they are stated rather than left
to be inferred:**

- **`AutomationRouteRefusal` is a separate union, and `never-run-by-hand` lives there — not
  in `AutomationRefusal`.** A route-level refusal is decided *before any run row exists*, so
  it can never be written to `automation_runs.refusal`, and adding it to `AutomationRefusal`
  would break the both-directions property that every declared member is emitted by some run.
  But it still needs a **sentence**: `never-run-by-hand` is the refusal the operator meets on
  every automation they create, and a `Record<AutomationRefusal, string>` table cannot hold a
  key outside its union — it would render an empty cell under `noUncheckedIndexedAccess`.
  Hence a second total table over this second union.
- **`ScheduleError` and `CadenceKind` have exactly ONE home: `shared/api.ts`.**
  `shared/schedule.ts` declares neither — two exported types of the same name in two `shared/`
  files both bundled into the PWA is the second-copy shape `single-definition.test.ts` exists
  to fail on, and an import ambiguity besides. The schedule module returns its own narrower
  union under a distinct name, `CadenceUnschedulable = 'unknown-timezone' | 'bad-cadence' |
  'no-future-occurrence'` — **`failure-ceiling` is deliberately not a member of it**, because
  §8's repeated-failure rule writes that, not the arithmetic.

`AutomationRefusal` is exactly the set of reasons a *run that was opened* did not produce a
session — which is what makes "every declared member is emitted somewhere, and every emitted
kebab token is declared" a testable property in both directions (the
`mail-routes.test.ts:355-489` shape).

**The word `Task` is avoided here, and the enforcement is weaker than it looks.** `TaskItem`/
`TaskProgress`/`tasks` belong to Claude Code's TodoWrite vocabulary, and the tree's guard is
**by name only** — `single-definition.test.ts:353` tests
`/\b(?:interface|type)\s+(?:RunTask|ProgramTask|CoordTask)\b/`, so an `AutomationTask` would
sail past it green. So this is a **convention** here, not a mechanism: the units are **run**
and **step**. (Adding `AutomationTask` to that regex is a one-line edit if the operator wants
it mechanical; it is not proposed, because the noun does not exist to be banned.)

Every refusal is a **sentence** in a `Record<AutomationRefusal, string>` table before it is
a code — the operator reads *"the fleet box could not be listed, so the pause could not be
ruled out"*, not `registry-unmeasurable`.

## 11. Surface

A new screen at `/automations`.

**The list answers three questions in one 44px row.** *Is this armed?* — state glyph +
word. *When does it next fire?* — the cadence in prose plus a relative countdown, computed
by `shared/schedule.ts`, the same code the server used. *Did last night's run work, and if
not why?* — last-outcome glyph + word + the refusal **sentence** inline, full detail one tap
down. Filters: state, last outcome (`ok` / failed / **never ran**), project. *Never ran* is
its own filter value because `lastFireAt IS NULL` is its own fact.

**The editor sheet.** Name, project, prompt (`≥16px` so iOS never zoom-jumps), and the
cadence picker: chips for *hourly / daily / weekdays / weekly*, a time field, and a timezone
defaulting to the phone's own `Intl.DateTimeFormat().resolvedOptions().timeZone`. Under it,
live: *"next fire: Mon 1 Sep, 09:00"*, recomputed locally on every change — the payoff for
the schedule module living in `shared/`. A new automation saves **paused**, with the arm
button explaining it wants one manual run first.

**The run detail.** The step trail in order, each with time, `ok`, detail, and a visible
marker when `truncatedBytes > 0`; the gap row when `runsEvicted > 0`; an `adopted` chip
reading *"ran — the spawn was cut short; check the pane"* rather than a clean tick. Where
the run produced a session, its id links through.

**Three empty states, never one.** "No answer yet" (the live half, until
`automationsFrameSeen` flips), "answered empty", and "the read failed" (`coldState !== 'ok'`)
render differently. An empty-state sentence is a positive claim.

The route joins the `data-view` OR in `app.tsx`, or the mobile layout leaves the fleet list
on screen and hides the new pane.

## 12. Ring assignment

| File | Ring | Action | Import block will contain |
|---|---|---|---|
| `shared/schedule.ts` | L0 | create | **nothing.** `Intl` is a global. |
| `shared/api.ts` | L0 | modify | unchanged (`import type { Hue }`) |
| `server/src/auto/schedulepolicy.ts` | L1 | create | `import type` only — the cadence and the clock as inputs |
| `server/src/auto/fire.ts` | L1 | create | `import type` for every port, **plus the same VALUE imports `dispatch.ts` carries** — `CCD_ARGV`/`sweepDec`, `readRegistry`/`readRegistryMeasured`/`measuredIdentity`, `cutShort`, `sendPrompt`, `measured`, the `shared/api.js` vocabularies. No `fastify`, `node:fs`, `node:sqlite`, `reply`. |
| `server/src/auto/routes.ts` | L4 | create | `fastify`, the L1 decisions, the store type, **and `FireDeps`** — *Run now* fires in-process (§6) |
| `server/src/ccdargv.ts` | L3 | modify | unchanged — one builder added to the table |
| `server/src/coord/schema.ts` | L3 | modify | unchanged |
| `server/src/coord/store.ts` | L3 | modify | unchanged |
| `server/src/watch.ts` | L4 | modify | + the L1 decisions |
| `server/src/server.ts` | L4 | modify | + `registerAutoRoutes` |
| `server/src/index.ts` | L5 | modify | wiring only |
| `pwa/src/screens/AutomationsScreen.tsx` | — | create | store, api, words |
| `pwa/src/auto/AutomationSheet.tsx` | — | create | `Sheet`, api, `shared/schedule.js` |
| `pwa/src/auto/autoWords.ts` | — | create | the L0 unions only |

`server/src/auto/fire.ts` is L1 **even though it causes side effects and holds value
imports**. What makes it L1 is not an empty import block — `dispatch.ts`, the file this
design names as its model, carries seven value imports at `:6-18` — but that every effect
goes through a **narrow injected port** and that the ordering (precondition → irreversible
fleet act → commit) is owned in one place. The L1 prohibition is specific and short:
no `fastify`, no `reply`, no `node:fs`, no `node:sqlite`. Everything else `dispatch.ts`
imports, `fire.ts` may import too — and must, since §13.3's scan requires `CCD_ARGV` to be
value-imported into `auto/` in order to have something to scan.

## 13. What must not change

1. **`server/src/watch.ts` still contains exactly ONE `setInterval(`.**
2. **`sweepMail` is untouched** — not edited, not wrapped, not called.
3. **The lane's entire argv vocabulary is `['ws-add']`.** No `ensure`, `start`, `enable`,
   `swap`, `stop`, rename, archive, hold. This is the sentence that squares the feature with
   ruling (3), so it is a red suite, not a scope note.
4. **`EXEC_COMMANDS` is still `['tmux','ccd']`, and the agent whitelist is byte-identical.**
   One `CCD_ARGV` builder is added; no new grant, no new verb, no new caps token.
5. **`FLEET_PROTO` and `FLEET_PROTO_MIN` are both still `1`.**
6. **No unattended lane ever passes `replaceDraft`.**
7. **`CoordStore` is still synchronous**, every new method included.
8. **`MIGRATIONS[0..5]` are byte-identical**, and `COORD_SCHEMA_VERSION` is still
   `MIGRATIONS.length`.
9. **The three ungated coordination doors are still exactly three.**
10. **`NotifyEvent.sessionId` stays non-nullable and gains no seventh kind.**
11. **No account name appears in any shipped source file.**
12. **`ccd/`, `session-hook.sh` and `ccd/coordinator-skill/` are untouched**, so this is a
    normal server deploy, not agent-first.

## 14. Out of scope for v1

- **Cron strings and RRULE as the stored form** (§4). The door is one union member wide and
  needs no migration.
- **Event triggers** (on PR merged, on idle, on limit reset).
- **`--reuse-session` / targeting an existing workspace.** Reuse means an unattended actor
  typing into a session a human may be mid-turn in — the hazard ruling (3) names. The only
  safe delivery into an occupied session is the idle-gated mail lane, which is a *different
  punctuality contract*, and one word cannot promise both.
- **Any act but spawn.** No program wave, no bare ccd verb (§13.3).
- **Automations that open a run or dispatch a wave.** That needs `CoordMutex`, which is
  unexported — a real change to Build 7's shape and a different decision.
- **Fleet-host sessions authoring automations** (§10).
- **Chained or multi-step automations, and conditions.** One automation, one act.
- **Per-automation model or wrapper choice.** The roster places the work.
- **Rerun of a specific past run.** *Run now* re-fires the automation as configured today,
  which is the honest operation.
- **Any systemd/launchd unit.**

## 15. Open, for the operator

Four numbers and two decisions worth a second opinion.

1. **`AUTOMATION_MAX_CONCURRENT` and `AUTOMATION_FAILURE_CEILING`.** Proposed **2** and
   **3**. Two is deliberately below `maxConcurrentWorkers` (3): automations compete with the
   coordinator for the same accounts and should lose.
2. **`AUTOMATION_PRESSURE_CEILING` (§7 rung 6).** Proposed **90**, against ccd's
   `SWAP_CEILING=98`. **This rung invents a refusal ccd never produces** — flip it off if
   `account-pressed` starts appearing on days the run was wanted.
3. **Default `graceMs`.** Proposed **30 minutes**, matching Orca's documented default.
4. **The arm gate (§7).** Recommended, and it is the mechanism that answers ruling (1). It
   is one column and one route arm to relax once the first manual run has become pure
   ceremony.
5. **Delivery (§6).** `sendPrompt` is chosen for punctuality and for its six typed refusals.
   **The signal that should flip it to the mail lane:** run rows routinely sitting with a
   spawned session and an unlanded prompt because fresh sessions are slow to settle.
6. **Retention (§9).** The per-automation ring is chosen on arithmetic. The flip to
   never-prune is cheap and self-contained — add a global daily fire ceiling, drop the prune
   and the gap row, and `automationStats()` becomes mandatory rather than supplementary.
7. **Should an automation's session be held** (`ws-hold --reason "auto:<id>"`) so
   `sweepNames` does not rename its branch away from `ws/<slug>` and its provenance is
   visible in the fleet list? It costs one already-granted argv — but it also adds a second
   verb to §13.3's vocabulary, which is the sentence that squares this feature with ruling
   (3). Recommended **no**, and the run history carries the provenance instead.
