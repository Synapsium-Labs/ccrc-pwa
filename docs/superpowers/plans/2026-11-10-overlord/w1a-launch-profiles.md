# Overlord W1a: one launch profile per role, applied at every launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `FLEET_ROLES.launchProfile` holds each role's launch switches; ccd applies the row a session's route names at
every spawn (a first start, a resume, a fresh start, a wake); a server lane writes that route field from `roleOf`,
in shadow until the operator arms it; and a doctor check lists the auto-memory directories that exist today.

**Why:** a long life needs switches set per session, never typed and never in the account's shared settings (spec
§3.3.7, H14; §3.3.4, C39; §3.6, H1). W0 measured that each switch holds at launch: `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`
keeps project memory out before and after a swap (W0-09), and `CLAUDE_CODE_AUTO_COMPACT_WINDOW` sets the auto-compact
window per session (W0-14). W0b measured that every account carries non-empty project memory and none sets
`autoMemoryEnabled` (W0-09): auto memory is on everywhere, so turning it off changes every session the lane reaches.
That is why the lane ships in shadow and its arming waits for the operator's item (Task 8).

**Architecture:** the profile is data in L0 (`shared/fleetRoles.ts`); a checked-in JSON projection of it is the file ccd
reads (`ccd/lib/launch-profiles.json`, held equal to the L0 table by a test); the route record gains three fields,
`profile`, `automem` and `compactwindow`, which name the row, the memory choice and Claude Code's own auto-compact
window in tokens (computed per session, because it depends on the session's window); ccd's spawn composes the row into the one
`--settings` and the environment beside the fleet pins; an L4 lane writes the route through the existing `routeSet`
`CcdArgv`. The server composes (it picks the row), ccd renders (it applies it), and neither holds a second copy of the
data. Two pull requests: **PR A** (Tasks 1 to 4, the table, the file and ccd) changes no session until a route names a
profile; **PR B** (Tasks 5 to 8, the lane, the Settings row, the doctor check and the operator item).

**Tech Stack:** TypeScript (ESM), bash (`ccd/ccd`, `ccd/ccrc-doctor-checks`), `jq`, vitest with `makeCcdHarness`.

**Spec:** `docs/superpowers/specs/2026-11-09-overlord-design.md` §3.3.4 (C39: the window lowered, idle compaction off,
both from the launch profile), §3.3.7 (H14: auto memory off for every role; for `plain` off by default on a fleet host
with a Settings row; the doctor check that lists, never deletes), §3.6 (H1: one profile per role, composed by the
server, applied at every launch, rendered by ccd into the session's one settings file and its environment), Table
11.1b (`FLEET_ROLES`), Table 11.1d (auto memory for `plain`, a row of `SWITCHES`).

## What exists today

- `shared/fleetRoles.ts#FLEET_ROLES` has a `launchProfile: null` column on every row (D-8209); `FleetRoleRow` types it
  `null`. The file imports only `SessionRole` (type) from `./api.js`.
- `ccd/ccd#_spawn_start(id, mode)` composes `$launchflags` from `_child_spawn_compose`, `_browser_spawn_compose`,
  `_account_spawn_compose` and `_fleet_spawn_compose`, merged into ONE `--settings` value (D-5391) by
  `SETTINGS_UNION_JQ`. `FLEET_SPAWN_PINS` is `{"autoContinueAtUsageLimit":false,"crossSessionInbound":"refuse",
  "idleCompaction":true}`. Environment on the spawn line: `CCRC_SESSION_GENERATION`, `COLORTERM`, `resenv`
  (`_resume_env`), `adjenv`, `routeenv` (`CLAUDE_CODE_SUBAGENT_MODEL` from the route's `subagent`), `tmpenv`,
  `sesstmpenv`.
- `ccd/ccd#ROUTE_FIELDS=(class effort subagent workflow compact browser degraded inert)`, validated by `_route_valid`,
  read by `_route_get`. `cmd_route --session <id> --set <field>=<value> [--apply]`. `_auto_compact_check` reads
  `compact` (`COMPACT_THRESHOLD=50` by default).
- The server writes the route through `server/src/ccdargv.ts#routeSet(id, fields, dec)` (behind `ROUTE_CAP`).
- `ccd/lib/` holds files ccd and the hook load at run time (`roster-card.jq`, `ccrc-settings.sh`, …), installed beside
  the registry (`$HOME/.cc-sessions/lib` is the hook's fallback for `roster-card.jq`; measure the install step in Task 3).
- `shared/switches.ts#SWITCHES`: rows `{ storage, default, owner, meaning, writer }`; a setting row stores in
  `coord.db` and is written by its Settings door in `server/src/coord/routes.ts`.
- `shared/lane-arm.ts#LANE_ARM_LANES` (D-8274): a lane is live only when its stored choice is exactly `live`.
- `ccd/ccrc-doctor-checks` holds the `_check_*` functions in one ordered list; none looks at auto memory.
- No launch profile exists anywhere (`grep -rn 'launch.profile' ccd server/src` finds nothing).

## Global Constraints

- **Architecture (`CLAUDE.md`).** `shared/fleetRoles.ts` stays L0: data and types only, no import but the kernel's
  types. The JSON file is a projection of it, never edited by hand without the test going red. ccd renders and decides
  nothing about roles; the server decides the row and never writes a file on the fleet box (it writes the route through
  `routeSet`). The lane is L4: the choice of row is an L1 function (`profileFor`). One writer per route field: the
  lane. Consolidate: the profile merges through `SETTINGS_UNION_JQ` beside the fleet pins, not through a second merge.
  Characterization first: a spawn whose route names no profile is byte-identical to today's. Every guard ships with a
  test that goes red without it. No wire field is added to the fleet frame.
- **Arming is split by what it moves.** Arming the `launch-profile` lane moves auto memory (and the Overlord's fork and
  agent-view switches) only. The compaction columns (the route's `compact`, `compactwindow`, and the profile's
  `idleCompaction: false`) are written and applied only while the `continuity` row is also `live`, so nothing about
  compaction changes while renewal is shadow (C39: compaction is lowered so that renewal fires first).
- **SAFETY (`CLAUDE.md`).** No new ccd verb: `profile`, `automem` and `compactwindow` are route fields of `cmd_route`. The server never
  places a session. ccd tests use fixture HOMEs (`makeCcdHarness`), never the live `$HOME`. The doctor check reads
  directory listings only, never a file's contents, and deletes nothing.
- **Tests.** From `server/`: `ccrc test -- ./node_modules/.bin/vitest run test/<file>.test.ts`; the last run adds both
  `tsc` runs through `ccrc test --`. ccd suites are load-sensitive: re-run a red one alone first.
- **Growth check.** `ccd/ccd` grows at most 40 net lines a pull request (`server/test/growthCheck.ts#GROWTH_LIMIT`):
  the composer is one new function; if it cannot fit, ask the coordinator for a waiver number before pushing.
- **Mutation floors.** `profileFor` is a new L1 decider: `MUTANT_SETS` and `server/test/sim/mutation-floors.json`.
- **Time.** The lane takes `Deps.time`; its module sits in `server/src/continuity/`, inside the ambient-time scan.
- **Migration slot** (PR B's lane-arm seed) re-measured before merge. Cite by symbol or `@anchor`. No private names:
  fixtures `lane-a-project-a`. No D-number invented; departures go in
  `docs/superpowers/plans/2026-11-10-overlord/w1a-launch-profiles/departures.md`.

## Review Focus

1. No profile, no change: a route without `profile` spawns exactly as today, flags and environment byte for byte.
2. An unknown or unreadable profile never half-applies: ccd spawns as today and warns.
3. The lane in shadow writes no route; armed, it writes only a field whose value differs, and only through `routeSet`.
4. Auto memory: the switch for `plain` defaults off as the spec says, and nothing turns memory off on any session until
   the operator arms the lane (Task 8's item).
5. Compaction never moves before renewal is live: with `continuity` in shadow, the lane leaves `compact` and
   `compactwindow` alone and ccd applies no compaction setting from the profile.

---

### Task 1: The profile is a column of the role table

**Files:**
- Modify: `shared/fleetRoles.ts` (`LaunchProfile`, the column filled on every row)
- Modify: `server/test/fleet-roles.test.ts` (its "every column that waits for a later piece is null on every row")
- Assumes: card PR A's commit that lays `FLEET_ROLES` out one column per line and splits
  `server/test/fleet-roles.test.ts`'s null-columns case one column per line, and its C3 row `continuity/**`; this
  piece edits only its own column's lines in both files

**Interfaces:**

```ts
export interface LaunchProfile {
  /** Environment set on the spawn line. Values are literals; nothing here is a secret. */
  readonly env: Readonly<Record<string, string>>;
  /** Claude Code settings merged into the one `--settings` value after the fleet pins, so a profile pin wins. */
  readonly settings: Readonly<Record<string, boolean | string | number>>;
  /** Auto memory: `off` sets CLAUDE_CODE_DISABLE_AUTO_MEMORY=1; `switch` lets the Settings row decide (plain only). */
  readonly autoMemory: 'off' | 'switch';
  /** Long-lived roles' compaction columns (C39), applied by ccd only when the route carries `compactwindow`, which
   *  the lane writes only while `continuity` is live. `settings` here merges after `settings` above. */
  readonly compaction: {
    readonly settings: Readonly<Record<string, boolean>>;
    /** The auto-compact point sits this many points of the window above the hard cap. */
    readonly aboveHardCapPts: number;
  } | null;
}
```

Rows: `overlord` and `coordinator` take `autoMemory: 'off'` and `compaction: { settings: { idleCompaction: false },
aboveHardCapPts: 10 }`; `overlord` also takes `env: { CLAUDE_CODE_FORK_SUBAGENT: '0',
CLAUDE_CODE_DISABLE_AGENT_VIEW: '1' }` (H14; its tool surface, door process and pinned sources are W1's). `worker`,
`reviewer`, `auditor` and `replay` take `autoMemory: 'off'` and nothing else. `plain` takes `autoMemory: 'switch'`.
Every row's own `settings` is empty except where a later wave adds one.

- [ ] **Step 1: Failing test.** Replace the role table suite's "every deferred column is null" assertion for
  `launchProfile` only (the other null columns stay asserted null): every row has a profile; only `overlord` and
  `coordinator` have `compaction`; only `plain` has `autoMemory: 'switch'`; every env key matches
  `^CLAUDE_CODE_[A-Z_]+$`.
- [ ] **Step 2: Run.** Expected: red. **Step 3: Implement.** **Step 4: Run** the suite,
  `test/rings/shared-imports.test.ts`, `test/rings/wire-totality.test.ts`, both `tsc` runs and
  `cd ../pwa && ccrc test -- ./node_modules/.bin/tsc --noEmit` (pwa bundles `shared/`). Expected: green.
- [ ] **Step 5: Commit.** `feat(roles): each role's launch profile is a column of FLEET_ROLES (H1, H14, C39)`

### Task 2: ccd's copy is a projection the tests hold equal

**Files:**
- Create: `ccd/lib/launch-profiles.json` (`{ "<role>": { env, settings, autoMemory, compactionSettings } }`, keys
  sorted; `compactionSettings` is `compaction.settings` or `{}`)
- Create: `server/test/launch-profiles-file.test.ts`

- [ ] **Step 1: Failing test.** Project `FLEET_ROLES` to `{ role: { env, settings, autoMemory, compactionSettings } }`
  with sorted keys and
  compare to the parsed file; on a mismatch, print the expected JSON so a worker can paste it. Also: the file has no
  key a profile lacks.
- [ ] **Step 2: Run.** Expected: red (no file). **Step 3:** Write the file from the printed text. **Step 4: Run.** Green.
- [ ] **Step 5: Mutation.** Change one value in the file: red. Revert.
- [ ] **Step 6: Commit.** `feat(ccd): ccd/lib/launch-profiles.json, the role table's launch columns, held equal by a test`

### Task 3: ccd applies the row the route names

**Files:**
- Modify: `ccd/ccd` (`ROUTE_FIELDS` gains `profile`, `automem` and `compactwindow`; `_route_valid` accepts a role word
  for `profile`, `on|off` for `automem` and an integer from 100000 to 1000000 for `compactwindow`;
  `_profile_spawn_compose id launchflags` sets `PROFILE_SPAWN_FLAGS` and `PROFILE_SPAWN_ENV`; `_spawn_start` calls it
  after `_fleet_spawn_compose` and adds `PROFILE_SPAWN_ENV` to both spawn lines; `_route_any` skips the three fields
  as it skips `browser` (D-8121), so a row that names only these fields is still a row with no routing record:
  `_route_seed_default` still seeds it, `routeapplied` is not written empty and `_route_apply_pending` does not read
  it per tick (m-B9))
- Modify, the route vocabulary, so the server can write the fields and read them back (each a one-line, append-only
  row, in the same pull request as ccd's list, so a snapshot carrying a new field never meets a server that refuses
  it): `shared/api.ts` (`ROUTE_WRITABLE_FIELDS` and `parseRouteFields`'s accepted fields, in the route region),
  `server/src/ccdargv.ts` (`routeSet`'s filter follows the list), `server/src/registry.ts` (its route read follows the
  list), the PWA's route display if it enumerates fields (measure: `grep -rn 'ROUTE_WRITABLE_FIELDS' pwa/src`)
- Modify: the installer that ships `ccd/lib/*` (measure it in Step 1), if it lists files by name
- Test: `server/test/ccd-launch-profile.test.ts` (new), `server/test/ccd-route-verb.test.ts`,
  `server/test/ccd-route-fields.test.ts` (its pin of `ROUTE_FIELDS` grows by the three fields, in order),
  `server/test/single-definition/update-stall.test.ts` (it guards the list), the registry's route-read suite (measure)

**Rules of the composer:** no `profile` on the route: compose nothing. A `profile` whose row is missing, a file that is
absent or does not parse: compose nothing and print `ccd: warn: <id>: launch profile <word> unreadable — spawning
without it`. Otherwise merge `settings` into the one `--settings` after the fleet pins (the fleet merge's own code path
and its quote refusal), and build `env` as `KEY=value` words. Auto memory: `off` adds
`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`; `switch` adds it only when the route's `automem` is `off`. Compaction: only when
the route carries `compactwindow`, merge the row's `compactionSettings` after `settings` and add
`CLAUDE_CODE_AUTO_COMPACT_WINDOW=<compactwindow>` (W0-14: set per session by this variable, 100k to 1M); without
`compactwindow`, apply neither.

- [ ] **Step 1: Measure** how `ccd/lib` reaches a box (the installer's file list or a directory copy) and where ccd
  finds it at run time; write both in the departures note.
- [ ] **Step 2: Failing tests** (fixture HOME, the spawn-argv harness the browser and fleet compose suites use):
  no `profile`: argv and environment identical to a recording taken on the branch point (characterization, written
  first, green on the old code); `profile=coordinator`: the `--settings` value has `"idleCompaction":false`, the env has
  `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`; `profile=plain` with `automem=on`: no memory variable; with `automem=off`: the
  variable; `profile=coordinator` with no `compactwindow`: no `idleCompaction` key from the profile and no window
  variable; with `compactwindow=350000`: `"idleCompaction":false` and `CLAUDE_CODE_AUTO_COMPACT_WINDOW=350000`;
  `compactwindow=50` refused by `_route_valid`; `profile=bogus`: refused by `_route_valid` at `cmd_route`; a file deleted
  after the route was set: spawn as today plus the warning; the same holds for `resume` and `fresh` spawns; the server
  side: `routeSet(id, {profile, automem, compactwindow})` builds its argv and the registry reads the three fields back;
  a snapshot carrying them parses.
- [ ] **Step 3: Run.** Expected: red except the characterization. **Step 4: Implement.** **Step 5: Run** the new suite,
  `test/ccd-route-verb.test.ts` and the spawn compose suites (measure: `grep -ln '_fleet_spawn_compose' server/test`).
  Expected: green.
- [ ] **Step 6: Mutation.** Merge the profile before the fleet pins: `idleCompaction` reads `true`; red. Apply the
  compaction settings without `compactwindow`: the "no `compactwindow`" case goes red. Count `profile` in
  `_route_any`: the case "a row naming only `profile` is still seeded by `_route_seed_default`" goes red (add that
  case to Step 2). Revert each.
- [ ] **Step 7: Commit.** `feat(ccd): the spawn applies the launch profile the route names (route fields profile, automem)`

### Task 4: ccd's compact threshold for a long-lived role

**Files:**
- Create: `server/src/continuity/launchProfile.ts` (L1: `compactThresholdFor(profile, windowTokens):
  { readonly pct: number; readonly windowTokens: number } | null`, importing `hardCapTokens` from
  `server/src/continuity/renewalDue.ts`, the renewal-deciders piece's one definition)
- Test: `server/test/continuity-launch-profile.test.ts` (new)

The hard cap is `hardCapTokens(windowTokens)` (Table 3.3.11b; never a second copy of `min(250_000, windowTokens / 2)`,
which `single-definition` holds to one definition); the threshold in percent of the window is
`ceil(100 * hardCap / windowTokens) + aboveHardCapPts`, capped at 95, and Claude Code's own window is the same figure
in tokens, `ceil(pct * windowTokens / 100)`, clamped to the variable's range (100,000 to 1,000,000). On a 1M window
that is 25 + 10 = 35%, 350,000 tokens; on a 200k window, 50 + 10 = 60%, 120,000 tokens. A null `compaction` or an
unmeasured window answers `null` (leave the route).

- [ ] **Step 1: Failing test** (the two examples, a 400k window, `null` cases, never above 95, the clamp at both ends,
  monotonic in the window; `single-definition` stays green with no second copy of the cap).
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run.** Green. Register the floor (mutants: `ceil` to
  `floor`; drop the 95 cap; answer a number for an unmeasured window; add the points twice).
- [ ] **Step 5: Commit.** `feat(continuity): the auto-compact threshold of a long-lived role, from its window`

**PR A ends here.**

### Task 5: The profile lane, in shadow

**Files:**
- Create: `server/src/continuity/profileLane.ts` (L4 pass) and `server/src/continuity/profileFor.ts` (L1)
- Modify: `server/src/laneSchedule.ts` (`LANE_SCHEDULE` row `launchProfile`, the usage lane's cadence)
- Modify: `server/src/coord/schema.ts` (migration: the lane-arm seed row `launch-profile`, `shadow`)
- Modify: `shared/lane-arm.ts` (`LAUNCH_PROFILE_LANE` in `LANE_ARM_LANES`, its card words; one append-only row,
  shared with the generations piece: see the index's "Where lanes meet")
- Modify: `pwa/src/fleet/ShadowLanesSection.tsx` (its `Record<LaneArmLane, …>` needs the new lane's entry, or the PWA
  does not compile; one append-only entry)
- Modify: `server/src/index.ts` (wire the pass with `Deps.time`)
- Test: `server/test/continuity-profile-lane.test.ts` (new), `server/test/coord-db.test.ts`, the lane-arm suites, the
  Shadow lanes card's suite (measure: `grep -ln 'ShadowLanesSection' pwa/test`) and pwa's `tsc`

**Interfaces:**

```ts
/** The route a session's launch should carry: its role's profile word, the memory choice, the compact threshold. */
export function profileFor(reading: RoleReading, plainAutoMemory: 'on' | 'off', windowTokens: number | null,
  continuityLive: boolean):
  { readonly profile: FleetRole; readonly automem: 'on' | 'off';
    /** Both `null` (leave the route alone) unless `continuityLive` and the role has `compaction`. */
    readonly compact: number | null; readonly compactwindow: number | null };
```

An undecided reading takes the member that does less (C49): `worker-or-reviewer` → `worker`, `coordinator-or-plain` →
`plain`. `automem` is `off` for every role but `plain`, where it is the Settings row's value.

The pass, for each registry row: gather facts with `roleFactsOf` (the renewal-deciders piece, Task 0), read the session's route and its usage reading (`ctxWindow`, the
context-readings piece), ask `profileFor`, and diff against the route. In `shadow` it counts the writes it would make
and logs them once a pass with `console.warn('ccrc-server: …')`; `live`, it sends one `routeSet` per changed session,
behind `ROUTE_CAP`, at most `PROFILE_WRITES_PER_PASS` (5) a pass. A route that could not be read is skipped and
counted, never written blind.

- [ ] **Step 1: Failing tests.** `profileFor` exhaustive over the nine readings × two memory values × three windows ×
  `continuityLive` (with it false, `compact` and `compactwindow` are `null` for every role);
  the pass with a fake `FleetIO`: shadow writes nothing; live writes only differing fields; a failed route read writes
  nothing for that row; at most five writes a pass.
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run** the new suite, the lane-arm suites,
  `test/coord-db.test.ts`, `test/laneSchedule*.test.ts` (measure), `test/rings/*.test.ts`,
  `test/single-definition/time-ports.test.ts`. Expected: green. Register `profileFor`'s floor (mutants: ignore the
  memory value; give `plain` the long-lived profile; answer a profile for an undecided reading).
- [ ] **Step 5: Mutation.** Let `coordinator-or-plain` take `coordinator`: red. Ignore `continuityLive`: the shadow
  compaction case goes red. Revert each.
- [ ] **Step 6: Commit.** `feat(continuity): the launch-profile lane writes each session's profile route (shadow)`

### Task 6: Auto memory for `plain`, a Settings row

**Files:**
- Modify: `shared/switches.ts` (row `plain-auto-memory`: setting storage, default `off`, owner `C3`, writer
  `POST /api/coord/plain-auto-memory`)
- Modify: `server/src/coord/routes.ts` (the session-gated door, the shape of `POST /api/coord/roll-idle`;
  growth-checked, and shared by lanes: see the index's "Where lanes meet")
- Modify: `server/test/box-token-census.test.ts`'s `SESSION_ONLY` and `CLAUDE.md`'s sentence that lists the
  session-gated coordination writes (the census reads it in both directions)
- Modify: the PWA Settings screen that holds "Roll idle sessions" (measure: `grep -rln 'Roll idle sessions' pwa/src`;
  one row; shared with the renewal hand-offs piece's row: see the index)
- Test: `server/test/plain-auto-memory-route.test.ts` (new), `server/test/box-token-census.test.ts`, the PWA settings
  suite

- [ ] **Step 1: Failing tests.** The door answers 200 for `on`/`off` and 400 otherwise; without a session it is
  refused when the auth gate is armed; the lane reads the stored value.
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run** the suites. Green.
- [ ] **Step 5: Commit.** `feat(settings): auto memory for plain sessions, a Settings row (default off, H14)`

### Task 7: The doctor lists auto-memory directories

**Files:**
- Modify: `ccd/ccrc-doctor-checks` (`_check_auto-memory`, in the ordered list after the account checks: for each
  rostered home, list `projects/*/memory/` directories that hold a file; `WARN` naming the count and the first three
  paths relative to the home; `OK` when none; never reads a file, never deletes)
- Test: the doctor suite (measure: `grep -ln '_check_box-settings' server/test`)

- [ ] **Step 1: Failing tests** (fixture homes): none → OK; one non-empty → WARN with its relative path; an empty
  directory → OK; a symlinked directory is listed once.
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run.** Green.
- [ ] **Step 5: Commit.** `feat(doctor): list auto-memory directories in every rostered home (H14; lists, never deletes)`

### Task 8: The operator item on auto memory (W0-09)

**Files:**
- Create: `docs/superpowers/plans/2026-11-10-overlord/w1a-launch-profiles/auto-memory-item.md` (the item's text)

- [ ] **Step 1:** Write the item for the coordinator to raise: what W0b measured (every account holds 8 to 14 non-empty
  project-memory directories, most shared across accounts by link; none sets `autoMemoryEnabled`); what arming the
  `launch-profile` lane does (from each session's next launch, auto memory is off for every role but `plain`, and for
  `plain` per the Settings row; the Overlord's fork and agent-view switches, from W1); what it does not do (deletes
  nothing, the doctor lists what exists; and it moves no compaction setting: the lowered window, Claude Code's own
  auto-compact window and idle compaction off follow only once the `continuity` row is also live); and the
  options: arm now; arm for long-lived roles only first (a one-line change to `profileFor`, recorded as a departure);
  keep shadow. Recommend: arm once the replay baseline is recorded, because a memory nobody reviews is loaded as the
  session's own (§3.8). **The interim rule** (ruling R9): the coordinator raises this item only after the replay
  quiz's baseline run is recorded; until the replay-quiz piece's `baseline-missing` refusal ships, that rule is what
  keeps an early arm from forfeiting the baseline, and the item says so.
- [ ] **Step 2: Commit.** `docs(plans): the auto-memory item for the operator (W0-09)`

**PR B ends here.** The coordinator raises the item; the lane stays `shadow` until the operator answers.

## Deviations found

None yet. Decisions this plan takes, by slug:

- **launch-profile-rides-the-route** — the server picks a profile by writing route fields `profile` and `automem`
  through `routeSet`; ccd reads the row from `ccd/lib/launch-profiles.json`, a projection of `FLEET_ROLES` held equal by
  a test. The server writes no file on the fleet box.
- **forks-off-for-the-overlord-only** — forks and agent view are switched off in the `overlord` profile only; H14's
  reason (a second body of the one Overlord) does not bind coordinators.
- **profile-lane-ships-in-shadow** — the lane is a Shadow lanes row, `launch-profile`, seeded `shadow`, because arming
  it turns auto memory off on the fleet's next launches.
- **compact-threshold-from-the-window** — the route's `compact` and `compactwindow` are computed per session from the
  measured window (the hard cap through `hardCapTokens`), and left alone while the window is unmeasured.
- **compact-window-per-session** — Claude Code's own auto-compact window (`CLAUDE_CODE_AUTO_COMPACT_WINDOW`) rides the
  route field `compactwindow`, since a literal in the profile file cannot follow each session's window.
- **compaction-follows-continuity** — the profile's compaction columns are written and applied only while `continuity`
  is live, so arming the profile lane for auto memory moves no compaction setting, and no `/compact` text either: the
  compaction piece keys the role's text on `compactwindow` (its `compaction-text-follows-continuity`, ruling R8).
- **profile-fields-outside-route-any** — `profile`, `automem` and `compactwindow` are skipped by `_route_any`, as
  `browser` is (D-8121), so a profile-only row keeps today's routing record and seed (m-B9).
- **arm-item-after-the-baseline** — the auto-memory item is raised only after the replay baseline is recorded; until
  the replay-quiz piece's refusal ships, that interim rule is the guard (the coordinator's ruling on R9).

## Where things stand

**Needs before it starts:** PR A needs the renewal-deciders piece's PR A (`hardCapTokens`, Task 4's import). PR B needs
the context-readings piece (`ctxWindow`), the renewal-deciders piece (`roleFactsOf`) and the generations piece (the
`continuity` lane-arm row it reads).

**What depends on it:** the compaction piece (the role's text rides the same route field); W1's `overlord` profile
(the tool surface, the door process, pinned sources, the hook registration and the bypass acceptance: the results
note's Proposals 3 to 5), and W1's sandbox check, whose no-mods check stays required because a pinned launch over a
plugin is unmeasured (W0-19).

**Open questions for the operator, most important first:**

1. **Arm the profile lane, turning auto memory off fleet-wide?** Task 8's item.
2. **Forks for coordinators.** Recommend leaving them on; the spec's reason is the Overlord's alone.
