# Landing order, wave 4b — the conflict radar's console half Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship spec §5.3's console half for the operator.
- The server reads the conflict radar's `probe` file for every project the radar measures.
- Each fleet session whose current PR the radar measured carries `FleetSession.landing`: what the radar found for that PR's merge with the base, and its conflicts with the other bound heads.
- The PWA shows a read-only predicted-conflict chip beside the hot-files strip.
- Absence means unknown, and a prediction older than the radar's freshness window is never shown.

**Why:**
- Wave 3b ships the measurement, but nothing reads it except doctor and a person (wave 3b's plan, Design).
- Wave 3b's D-4329 and wave 4's D-7110 moved this half to this wave.
- Spec §10's stage 3 metric counts coordinator sync and order mails sent without a measured conflict. This wave gives the operator the reading. The coordinator's own read of it is still unplanned (D-7483), so this wave alone does not move that metric.

**Architecture:**
- **L1, a new `server/src/coord/radar.ts`.**
  - `parseProbe` checks the whole `probe` grammar from wave 3b's contract, its size and its freshness. Freshness goes through `shared/api.ts`'s `freshWithin`, wave 4c's D-7475.
  - `sessionLandingsOf` derives each matched session's `SessionLanding` from one measured doc and each row's current branch and PR, read through `fleet.ts`'s two exported derivations.
- **L3, `server/src/coord/lineageRead.ts`.**
  - Its private `readRegular` is exported.
  - A new `listRadarProjects` lists `$REG/landing` here, in the adapter, so the lane makes no registry listing of its own (the `advance-switches` census).
  - A new `readRadarProbe` beside it does three things: lstat (regular only), `statMeasured` (no larger than the cap), then read.
  - The file's header is amended: it now reads `probe` too.
- **L4, `server/src/watch.ts` and `server/src/laneSchedule.ts`.**
  - A new `landingRadar` lane, at a 60 s cadence, rebuilds the watcher's `landings` map.
  - A kept map is re-aged on every pass.
  - `assembleFleet` takes the map as an optional trailing parameter, passed only where a fleet frame is built: the watcher's tick and `server.ts`'s two calls. It drops an entry past the window at assembly too, so a live frame never carries a stale one.
  - `fleet.ts` exports the two derivations it already makes, `sessionBranchOf(r, statusline, headBranch)` and `sessionPrOf(r, prStates)`, so the lane and the assembly read one rule each (D-7484).
- **Wire, in `shared/api.ts`.**
  - `FleetSession.landing?: SessionLanding` is additive and optional.
  - `RADAR_PROBE_FRESH_S` is defined once there, so the server and the PWA age a landing by the same window.
  - `reviveFleetSession` keeps the field through a conditional spread.
- **PWA.**
  - A new L1 file, `pwa/src/fleet/conflictWords.ts`, holds `landingOf(s, nowMs)`, the one reader, which hides a stale landing. It also derives the summary and its words.
  - A new L4 file, `pwa/src/fleet/ConflictChip.tsx`, renders the chip.
  - `FleetScreen.tsx` mounts the chip beside `<HotFilesStrip />`.
- **Out of scope:**
  - `RunSummary.landing` (D-7477);
  - `main-health` (D-7478);
  - the coordinator's read of the radar (D-7483);
  - the landing line, the project-card line, and the pause and withdraw doors, which are stage 5;
  - any change to the radar, `ccd`, the hook or the skills.

**Tech Stack:** TypeScript (Node ≥ 22.16), React, vitest with jsdom, `@ccrc/ui`.

**Spec:** `docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md`:
- §5.3's last paragraph;
- §6's `pwa/src` row, for the chip only;
- §7's wire invariant ("Wire additive-only; `FLEET_PROTO` stays 1; one reader per field; absence means unknown");
- §9 (AGENT-FIRST);
- §10's stage 3 row.

**Other sources:**
- **Wave 3b's plan** (`docs/superpowers/plans/2026-10-27-landing-order-wave3b-conflict-radar.md`):
  - its Design section, the `probe` grammar, which is the contract;
  - D-4329, D-7382, D-7383, D-7390 and D-7393.
- **Wave 4's `lineageRead.ts`** and its regular-file rule (D-7433).
- **Wave 4c's** shared `freshWithin` (D-7475).
- **The ledger's Carried constraints:**
  - D-7393's null `id`;
  - "an interrupted tick reads as a running one";
  - the tail project the tick budget can skip.

**Prerequisite:**
- Wave 4c is merged. This wave imports its `freshWithin`.
- The one file this wave shares with wave 4c is `shared/api.ts`; the claim check at dispatch must see it free.

**Plan review.** Three Opus lenses (spec fidelity, executability, fail-closed) reviewed the first draft. A Sonnet refuter checked each serious finding. Two critical and eight important findings held. Each is answered in this plan:
- a kept map and a cached snapshot both age out;
- a landing is kept only while the session's current branch and PR match;
- the word "No predicted conflicts" needs every measured landing fully clean and no unbound fleet head;
- `parseProbe` checks the whole grammar;
- the lane row and its pins are spelled out;
- only the fleet-frame callers pass the map;
- the order with wave 4c is fixed;
- the coordinator-reader gap is named (D-7483).

A second Opus pass reviewed the rewrite. It found four important findings and four minor ones, all answered here:
- the landing directory is listed in the adapter (the `advance-switches` census);
- the branch and PR come from `fleet.ts`'s own exported derivations, so a held row and a merged PR are handled;
- both `server.ts` call sites have a case that goes red;
- the display's clock rule is named (`landingShown`);
- the PWA pins are named;
- the `why` words and `pairHeads` follow what the radar can write;
- the chip takes its tone from `chipTone`;
- the deadline's outcome is defined.

## What this does not claim

- **What the chip shows.** It is a prediction from the radar's last tick, of the heads the radar fetched then. It is shown while that tick is younger than `RADAR_PROBE_FRESH_S` (1200 s, four timer intervals), and its title gives the measured time.
- **Pushes and missed ticks.** A push after the tick is measured at the next one. A tick that was interrupted, or a project the tick budget skipped, leaves the last `probe` in place. That `probe` ages out of the window instead of being shown as current.
- **Trust.** Files under `$REG` are writable by every fleet session, so the chip is attribution-grade, like every other reading from there.
- **What reads it.** It is a display that decides nothing. No route, refusal, mail or landing reads `FleetSession.landing`.

## Global Constraints

- **Public repository.** Use neutral fixtures (`proj-a`, `ws/alpha`, `lane-a-proj-a-alpha`, `o/r`).
- **Absence means unknown, never "no conflict" (D-7481).**
  - The wire omits `landing` for every condition in which the radar does not speak for a session now:
    - no radar;
    - no `probe`;
    - a `probe` that is stale, unreadable, over the cap or malformed;
    - an unmeasured `probe`;
    - a head with no match (D-7479);
    - a session whose current branch or PR differs from the measured head's (D-7484);
    - an older server.
  - The reader's own result keeps these apart, for its warning line.
  - `landingOf(s, nowMs)` hides a landing older than the window, through `landingShown` (D-7481). A revived cache, the degraded arm of `GET /api/fleet` or the PWA's offline snapshot therefore never shows an old prediction.
- **"No predicted conflicts" is said only when every measured landing is clean** (D-7480). A landing is clean when all of these hold:
  - `base.state` is `'clean'`;
  - `paired` is true;
  - `conflicts` and `unmeasuredWith` are empty;
  - `cut.pairs`, `cut.heads` and `cut.unbound` are all false.

  Anything else, short of a conflict, reads "Conflicts partly measured".
- **No overloaded null at a seam.**
  - The reader's result keeps four reasons apart: `absent`, `unreadable` (every io fault, a non-regular file, over the cap, or a grammar fault), `stale` and `unmeasured`.
  - The doc's own `why` is never shown.
- **Wire discipline.**
  - `SessionLanding` is optional and additive, and `FLEET_PROTO` stays 1.
  - Every literal union it adds has a `Record<X, true>` map or an `is X` guard beside it (`rings/wire-totality`).
  - `reviveFleetSession` uses the conditional-spread idiom: a malformed `landing` revives as an absent key, never as a throw.
  - Skew tests run in both directions (consolidation spec §5.1 rule 1c):
    - an older cache;
    - a newer cache;
    - an older server's live frame.
- **Rings and contexts.**
  - `radar.ts` imports types, and `freshWithin` and `RADAR_PROBE_FRESH_S` from L0. It falls under `coord/**`, which is C5.
  - `lineageRead.ts` stays L3 by its header.
  - The two new PWA files take file rows in C5, beside `fleet/HotFilesStrip.tsx`, in the ring-context table of `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md`. Both rows go in this PR.
  - `conflictWords.ts` is L1: it imports types and the wire guards only, and never a `.tsx`, a store or `lib/api.ts`.
- **One owner.** Extend these; never add a second:
  - `readRegular` is the one regular-file reader;
  - `freshWithin` is the one freshness rule on the server; `landingShown` is the display's, for a reason D-7481 records;
  - `sessionBranchOf` and `sessionPrOf` are the one branch and PR derivations;
  - the lane is the one writer of `landings`;
  - `landingOf` is the one PWA reader.
- **Caps (D-7482).** Each constant is defined once:
  - `RADAR_PROBE_MAX_BYTES = 524288`, checked against `statMeasured`'s size before the read, and against the bytes after it;
  - `RADAR_PATH_MAX = 300` characters per shown path;
  - `RADAR_PROBE_FRESH_S = 1200`, which is doctor's `CCRC_LAND_PROBE_STALE_S`.
- **Growth.**
  - `watch.ts` and `server.ts` are growth-checked. This wave adds a new file under `server/src/coord/`, which waives the limit, but keep each file's growth small.
  - Run `growth-check` with `GROWTH_CHECK=1`.
- **PWA guards.** Each of these must pass:
  - `plain-words`: add `conflictWords.ts` and `ConflictChip.tsx` to its owned list.
  - `contrast`: the chip's colour rules sit under a self-grounded ancestor, or are registered.
  - `markup-census`, `literal-census` and `shape-census`.
  - `control-census`: a read-only `<span>` needs no tap answer.
  - `fleet-css`, `role-census` and `fixture-census`.
  - The W7 censuses: no new poll and no storage owner.
- **Server literal census.** The census over `server/src/coord/*.ts` string literals (`mail-routes.test.ts`'s `NOT_CODES`) gets a line for each new kebab literal in `radar.ts` and `lineageRead.ts`, or the literal belongs to a vocabulary.
- **How to run the suites.**
  - In the foreground, one file per process, with a timeout of at least 600000 ms.
  - Typechecks, and any run that names many files, go through `~/.local/bin/ccrc test -- <command>`.
  - In `pwa/`, use `./node_modules/.bin/vitest run test/<file>`.
- **Fixture HOMEs only.** The end-to-end case runs the shipped probe under `makeCcdHarness` and `ghContainedEnv(..., {systemd: true, tmux: true, net: true})`, as `ccd-land-lineage-accept.test.ts` does.
- **Every new guard has a measured red.**
- **Deviation numbers are issued, never chosen.** This plan's block is D-7477 to D-7484, and the plan defines all eight.

## Review Focus

1. **Nothing reads "no conflict" without a fresh, measured `probe` that matched the session's current PR.** Each of these gives no `landing`:
   - No `$REG/landing` directory.
   - A project directory with no `probe`.
   - A `probe` that is a symlink or a FIFO.
   - A `probe` over 512 KiB, measured by `statMeasured` before the read.
   - A `probe` with bad JSON, a `v` other than 1, or a foreign `project`.
   - An `at` older than 1200 s, or more than 60 s ahead.
   - `state: 'unmeasured'`.
   - Any grammar fault the Design lists.
   - A head whose `id` is `null`, or names another session.
   - A head whose `branch` is not the session's current branch, or whose `pr` is not the session's current PR number.
   - A kept map whose `at` has aged past the window.
   - A cached or offline row whose `at` has aged past the window, read through `landingOf`.
2. **A session's conflicts are its own, and a partial measurement reads as partial.**
   - A pair `{a, b}` is shown on both PRs, and on no third.
   - A pair the radar left `unmeasured` is listed as not measured.
   - A head outside `pairHeads` reads `paired: false`.
   - These all read "Conflicts partly measured", never "No predicted conflicts":
     - `pairsCut` or `headsCut`;
     - an unbound fleet head in the project (D-7479);
     - an unmeasured base merge.
3. **The field survives every path the fleet takes, inside its window.** The paths:
   - the live `fleet` frame;
   - the `/ws/fleet` cold frame;
   - `GET /api/fleet`;
   - `state-cache.json`;
   - the PWA's offline snapshot.

   An older cache, and an older server, read as absent.
4. **The lane costs little and fails alone.**
   - Each pass makes one listing, then one lstat, one stat and one read per project the radar measures and a fleet session names, at a 60 s cadence (`flight: 'skip'`).
   - A failed listing keeps the map, re-aged.
   - A pass that hits its deadline builds the map from the projects that answered; the others contribute nothing. It never keeps an old map unaged.
   - A failed read of one project costs only that project's sessions.
   - A lane failure never stops the tick.
5. **The chip is read-only and plain.**
   - It has no button.
   - It renders nothing when no session carries a fresh `landing`.
   - Its word carries the meaning, never its colour alone.
   - Its accessible name lists each conflict by PR number, base and path, and its title gives the measured time.

---

## Design

### What the server reads

Wave 3b's contract defines `$REG/landing/<project>/probe`, a single JSON line written by rename. It holds:
- `v: 1`, `project`, `at` (`%Y-%m-%dT%H:%M:%SZ`), `state` (`measured | unmeasured`), and `why`, which is present exactly when the doc is unmeasured;
- `base`, which is `{ref, sha}` when measured and `null` or `{ref, sha}` when unmeasured. `gh-failed` keeps its base (D-7382);
- `heads[{pr, head, branch, id | null, base: <answer>}]`, newest PR first, at most 100 entries, plus `headsCut`;
- `pairs[{a, b} + <answer>]` over `pairHeads`, with `a < b`. `pairHeads` holds at most 10 bound heads, so there are at most 45 pairs. The list comes with `pairsCut`.

An `<answer>` is one of:
- `{state: 'clean'}`;
- `{state: 'conflict', paths[], pathsCut}`;
- `{state: 'unmeasured', why}`.

Every `why`, the doc's and an answer's, is read as a non-empty string of at most 64 characters, never against a word list (the radar writes `rc-<n>` words), and is never shown.

`store`, `scratch` and `elapsedMs` are not read. Neither is `main-health` (D-7478). The lister ignores `.lp.*` names.

### `radar.ts` (L1)

**`parseProbe(content: string, project: string, nowMs: number): ProbeRead`**, where `ProbeRead = {ok: true, doc: ProbeDoc} | {ok: false, reason: 'unreadable' | 'stale' | 'unmeasured'}`.

The doc is **unreadable** if any of these holds:
- Its bytes exceed `RADAR_PROBE_MAX_BYTES`.
- It is not a JSON object, `v !== 1`, or `project` is foreign.
- `state` is not one of the two.
- A measured doc has a `why`, or lacks a `{ref, sha}` base with a 40-hex sha.
- An unmeasured doc has no `why`, or has a non-empty `heads` or `pairs`.
- `headsCut` or `pairsCut` is not a boolean.
- A `heads` entry lacks any of these: `pr` (a positive integer), `head` (40-hex), `branch` (a string), `id` (a string or `null`), and a well-formed `<answer>`.
- A `heads` `pr` repeats.
- `pairHeads` is not an array of distinct `pr` values, each from a head with a non-null `id`. Its length is not bounded by a constant, because the radar's `CCD_LAND_PROBE_PAIR_HEADS` knob has no upper bound.
- A pair breaks any of these: `a < b`, both in `pairHeads`, no duplicate pair, a well-formed `<answer>`.

It is **stale** when `freshWithin(at, RADAR_PROBE_FRESH_S, nowMs)` is false. It is **`unmeasured`** when `state` is `unmeasured`.

**`sessionLandingsOf(doc: ProbeDoc, rows: readonly {id: string; branch: string | null; pr: {number: number; open: boolean} | null}[], nowMs: number): Map<string, SessionLanding>`.** `rows` are the listed registry records of `doc.project`. Each carries the session's current branch, from `sessionBranchOf(r, this.statuslines.get(r.id), this.currentHeadBranches().get(r.id))`, the same derivation `assembleFleet` makes. It also carries its PR, from `sessionPrOf(r, this.prStates)`, with `open` meaning `phase === 'open'`. A row whose `.branch` file cannot be read still has a current branch when its worktree HEAD names one, so a held row is seen. It works in three steps.

1. **The matched heads.** A head is matched when all of these hold: its `id` is a non-empty string; no other head names that `id`; a row has that `id`; the head's `branch` equals the row's current branch; and, when the row has a PR, that PR is open and its number is the head's `pr` (D-7479, D-7484). So a merged PR, which keeps its number, matches nothing. Every other head, and every other row, gets no entry.
2. **`unbound`.** It is true for every landing of the doc when any head with a `null` `id` has a `branch` that some row's current branch equals. Such a head is a fleet head the radar left out of the pairs, so no other landing can claim to have been paired against it (D-7479).
3. **Each matched head's `SessionLanding`:**
   - `at`, `pr` and `head` come from the doc;
   - `baseRef` is `doc.base.ref`;
   - `base` is the head's base answer, each path cut to `RADAR_PATH_MAX` characters;
   - `paired` is whether `pairHeads` holds its `pr`;
   - `conflicts` holds each pair with its `pr` and `state: 'conflict'`, written as `{pr: <the other>, paths, pathsCut}`;
   - `unmeasuredWith` holds the other PR of each pair with its `pr` and `state: 'unmeasured'`;
   - `cut` is `{heads: doc.headsCut, pairs: doc.pairsCut, unbound}`.

### The wire (`shared/api.ts`, beside `FleetSession`)

```ts
/** Four timer intervals of the radar (doctor's CCRC_LAND_PROBE_STALE_S); both sides age a landing by it. */
export const RADAR_PROBE_FRESH_S = 1200;
export const LANDING_MERGE_STATES = ['clean', 'conflict', 'unmeasured'] as const;
export type LandingMergeState = (typeof LANDING_MERGE_STATES)[number];
export const isLandingMergeState = (v: unknown): v is LandingMergeState => /* membership */;
export interface LandingConflict { pr: number; paths: string[]; pathsCut: boolean }
export interface SessionLanding {
  at: string; pr: number; head: string; baseRef: string;
  base: { state: LandingMergeState; paths?: string[]; pathsCut?: boolean };
  paired: boolean; conflicts: LandingConflict[]; unmeasuredWith: number[];
  cut: { heads: boolean; pairs: boolean; unbound: boolean };
}
// on FleetSession:
landing?: SessionLanding;
```

`radar.ts` imports `RADAR_PROBE_FRESH_S` from here, so the window is defined once.

The doc block beside the type says three things:
- the field is ADDITIVE, so `FLEET_PROTO` is not bumped;
- absence deliberately collapses the conditions in the Global Constraints, and no reader may branch on which one applies;
- the live frame is cast, so the PWA reads the field only through `landingOf`, which also ages it.

`reviveSessionLanding(o, key): SessionLanding | undefined` checks every field and answers `undefined` for anything malformed. `reviveFleetSession` adds `...(landing === undefined ? {} : { landing })`.

### The lane (`watch.ts`, `laneSchedule.ts`)

**Its schedule row.** `laneSchedule.ts` gains:
- `export const LANDING_RADAR_SWEEP_MS = 60_000`, with a docstring saying the radar ticks every 5 min and a 60 s look keeps the chip within one tick of the file;
- `'landingRadar'` as a `LaneName` member;
- the row `{ name: 'landingRadar', cadenceMs: LANDING_RADAR_SWEEP_MS, derivedFrom: null, clock: 'mono', flight: 'skip', staleAfterMs: 5 * 60_000, warnKey: 'ccrc-server: the landing radar lane failed' }`.

`lane-schedule.test.ts`'s pin "31 of 31 are monotonic" becomes 32, in the same commit.

**Each pass, `sweepRadar(registryRead, nowMs)`:**
1. With no registry listing, re-age the kept map and return. Re-aging means dropping every entry whose `at` has left the window against `nowMs`.
2. List the landing directory with `listRadarProjects(io, registryDir)`, the adapter's one listing.
   - A proven absence sets `landings` to an empty map: there is no radar.
   - An unreadable listing re-ages the kept map, and warns only when the state changes.
3. For each listed name that a listed record's `project` names and that is not a `.lp.*` name, call `readRadarProbe(io, registryDir, project, nowMs)`. All of them run in one `Promise.all`, under one deadline of half the lane's cadence. A project that has not answered by the deadline contributes nothing, as a failed read would.
4. Build a new map from `sessionLandingsOf(doc, rows, nowMs)` for every `ok` doc. `rows` comes from the listed records of that project, with `this.prStates`' numbers.
   - A project whose read failed contributes nothing.
   - The lane writes one warning line per project, and only when that project's reason changes. It never includes the doc's `why` text.

**Where the map goes.**
- `assembleFleet(…, panePids, landings?)` reads `landings?.get(r.id)` through the conditional spread, and drops it when `freshWithin(at, RADAR_PROBE_FRESH_S, Date.now())` is false.
- Only three call sites pass the map:
  - the watcher's tick, as `this.landings`;
  - `server.ts`'s two calls, as `watcher?.currentLandings()`, a copy.
- The two calls in `coord/routes.ts` and the one in `turnverdict.ts` pass nothing, because they build no fleet frame. `registry-refused-census` is unchanged: it reads argument index 9.
- `stall-sweep.test.ts`'s source pin of the tick's call becomes `'this.usage, this.currentHeadBranches(), panePids, this.landings);'`.

### The PWA

**`conflictWords.ts` (L1).**
- `landingOf(s: FleetSession, nowMs: number): SessionLanding | null` is the one reader. It validates the field through `shared/api.ts`'s `reviveSessionLanding` and `lib/wire.ts`'s guard kit, and defines no guard of its own. It answers `null` when `landingShown(at, nowMs)` is false.
- `landingShown(at, nowMs)` lives in `shared/api.ts` beside `freshWithin`. It applies only the stale bound (`nowMs - Date.parse(at) <= RADAR_PROBE_FRESH_S * 1000`), with no ahead bound (D-7481). A phone's clock is not the fleet box's, and a device clock that is behind must not hide every live landing; the server has already refused a doc dated ahead.
- `conflictSummaryOf(sessions, nowMs): ConflictSummary | null`. It answers `null` when no session has a landing. Otherwise it answers `{measured, conflicted: ConflictLine[], partial: boolean, oldestAt: string}`:
  - `measured` is the number of sessions with a landing;
  - a `ConflictLine` is `{pr, against: {base: string} | {pr: number}, paths, pathsCut}`, and a pair is listed once, under its lower PR number;
  - `partial` is true when any landing is neither clean nor in conflict, or carries a cut.
- `conflictChipWord(summary)` is total over the summary:
  - `N predicted conflicts`, or `1 predicted conflict`, when `conflicted` is non-empty;
  - otherwise `Conflicts partly measured`, when `partial`;
  - otherwise `No predicted conflicts in N measured PRs`, or `… 1 measured PR`.
- `conflictChipSentence(summary, now)` is the accessible name and the title. It lists each line, for example `PR #12 conflicts with main in src/a.ts, src/b.ts` and `PRs #12 and #14 conflict in src/x.ts`. It adds `(list cut)` when a cut is set, `N not measured` when there are some, and `measured HH:MM` from `oldestAt`.

**`ConflictChip.tsx` (L4).**
- Its props are `{sessions: readonly FleetSession[]}`. It reads the clock with `useNow(30_000, sessions.some((s) => s.landing !== undefined))`, so it runs no timer while no session carries a landing (`fleet-screen.test.tsx`'s one-second-tick pin).
- It renders `null` for a `null` summary.
- Otherwise it renders `<Chip dot className={chipTone('conflict')} data-state={…} role="status" aria-label={sentence} title={sentence}>` with the word.
- `chipTones.ts` gains `'conflict'`, and its doc comment now covers a fleet-screen chip skinned in `fleet.css`. The attention or tertiary ink is chosen on `data-state` in the CSS.
- The CSS goes in `fleet.css`, under a self-grounded ancestor.

**`FleetScreen.tsx`** mounts `<ConflictChip sessions={sessions} />` directly beside `<HotFilesStrip />`, outside the runs line, as `fleet-css` pins.

### README

The radar section's sentence on who reads the files becomes: "Wave 4b's server reader and the fleet screen's predicted-conflict chip read `probe`; doctor and a person read the rest."

---

### Task 1: The parser, the derivation and the wire type

**Files:**
- Create: `server/src/coord/radar.ts`
- Modify: `shared/api.ts`
- Test: create `server/test/coord-radar.test.ts`; modify `server/test/fleetstate.test.ts` and `server/test/mail-routes.test.ts`

**Interfaces:**
- Consumes: `freshWithin` and `FRESH_FUTURE_SKEW_S` from `shared/api.ts` (wave 4c).
- Produces:
  - from `radar.ts`: `parseProbe`, `sessionLandingsOf`, `ProbeRead`, `ProbeDoc`, `RADAR_PROBE_MAX_BYTES`, `RADAR_PATH_MAX`;
  - from `shared/api.ts`: `RADAR_PROBE_FRESH_S`, `landingShown`, `SessionLanding`, `LandingConflict`, `LandingMergeState`, `LANDING_MERGE_STATES`, `isLandingMergeState`, `FleetSession.landing?`, `reviveSessionLanding`.

- [ ] **Step 1: The failing tests.**
  - `coord-radar.test.ts`, `parseProbe`:
    - every file case in Review Focus 1, and one case per grammar rule in the Design;
    - wave 3b's worked example, which reads;
    - the failed-fetch example, which answers `unmeasured`;
    - a `gh-failed` doc with its base, which answers `unmeasured`;
    - a doc of exactly 524288 bytes, which reads;
    - a doc of 524289 bytes, which is unreadable.
  - `coord-radar.test.ts`, `sessionLandingsOf`:
    - the worked example's three heads;
    - a null `id`, which gives no entry;
    - an `id` on two heads, which gives no entry;
    - a branch moved after the tick, which gives no entry;
    - a PR number that differs, which gives no entry;
    - a null-`id` head on a fleet branch, which sets `unbound` on every landing;
    - a pair shown on both of its PRs, and on no third;
    - an unmeasured pair, which lands in `unmeasuredWith`;
    - a head outside `pairHeads`, which reads `paired: false`;
    - a 400-character path, cut to 300;
    - each `cut` flag, carried through.
  - `fleetstate.test.ts`:
    - a cache with `landing` round-trips;
    - a cache without it revives with no key;
    - a malformed `landing` revives with no key, and the session is kept.
- [ ] **Step 2: Run the tests, and see them fail.**
- [ ] **Step 3: Implement** `radar.ts`, the wire types beside `FleetSession`, the reviver spread, and the `NOT_CODES` lines.
- [ ] **Step 4: Run the tests**, plus `rings/*`, `single-definition/*`, `reconstruction-drill`, `run-wire` and `mail-routes`, and see them pass.
- [ ] **Step 5: Mutations.**

  | # | Mutation | Expected red |
  |---|---|---|
  | P1 | the size cap is off by one | the 524289-byte case |
  | P2 | an `unmeasured` doc reads `ok` | the failed-fetch case |
  | P3 | a null `id` is matched to the first session | the null-`id` case |
  | P4 | the branch check is dropped | the branch-moved case |
  | P5 | `unbound` is never set | the null-`id` fleet-branch case |
  | P6 | a pair is shown on `a` only | the both-PRs case |
  | P7 | `pairHeads` is unchecked | the bad-`pairHeads` case |
  | P8 | the reviver spreads `landing: null` | the absent-key case |

- [ ] **Step 6: Commit:** `feat(coord): the radar's probe, parsed and derived per session (landing order wave 4b, Task 1)`.

### Task 2: The reader, the lane and the fleet frame

**Files:**
- Modify: `server/src/coord/lineageRead.ts`, `server/src/watch.ts`, `server/src/laneSchedule.ts`, `server/src/fleet.ts`, `server/src/server.ts`
- Test: create `server/test/radar-lane.test.ts`; modify `server/test/lane-schedule.test.ts`, `server/test/stall-sweep.test.ts`, `server/test/fleetws.test.ts` and `server/test/ccd-land-lineage-accept.test.ts`

**Interfaces:**
- Produces:
  - `readRegular`, exported;
  - `listRadarProjects(io, registryDir): Promise<{ ok: true; names: string[] } | { ok: false; reason: ReadFailure }>`;
  - `readRadarProbe(io, registryDir, project, nowMs, signal?): Promise<ProbeRead | { ok: false; reason: ReadFailure }>`;
  - `sessionBranchOf` and `sessionPrOf`, exported from `fleet.ts`, and `assembleFleet` calling them;
  - `FleetWatcher.currentLandings(): Map<string, SessionLanding>`;
  - `assembleFleet`'s new trailing `landings?` parameter.

- [ ] **Step 1: The failing tests.**
  - `radar-lane.test.ts`, over `ioDoubles.ts`:
    - every case in Review Focus 4;
    - every io answer in Review Focus 1, each giving no `landing`;
    - a good pass followed 1201 s later by an unreadable listing gives no `landing`;
    - a good pass followed 1201 s later by an unlisted registry gives no `landing`;
    - a `statMeasured` size over the cap makes no read at all;
    - a pass whose one project misses the deadline contributes nothing for it, and keeps the others;
    - a row with an unreadable `.branch` whose worktree HEAD is on a null-`id` head's branch sets `unbound`;
    - a merged PR with the same number gives no landing.
  - `fleetws.test.ts`: the cold frame and the broadcast carry the same `landing`.
  - On `divergence-sweep.test.ts`'s pattern: `GET /api/fleet` after a lane pass carries `landing`; a new `/ws/fleet` client before any broadcast gets a cold-assembled frame with `landing`.
  - `ccd-land-lineage-accept.test.ts`: the shipped probe in a fixture HOME produces a doc, and the assembled row of the bound session carries a `landing` that matches it.
  - `lane-schedule.test.ts` and `stall-sweep.test.ts`: the two pins, moved.
- [ ] **Step 2: Run the tests, and see them fail.**
- [ ] **Step 3: Implement** the export, the reader, the header amendment, the lane constant, row and member, the sweep, the accessor, the parameter, and the three call sites.
- [ ] **Step 4: Run the tests**, plus `registry-refused-census`, `single-definition/advance-switches`, `growth-check` (with `GROWTH_CHECK=1`), `coord-lineage`, `coord-fingerprint` (the `readRegular` export changes no wave 4 answer), `fleet-wire-route` and `divergence-sweep`, and see them pass.
- [ ] **Step 5: Mutations.**

  | # | Mutation | Expected red |
  |---|---|---|
  | L1 | a kept map is not re-aged | the 1201 s cases |
  | L2 | `readRadarProbe` follows a symlink | the symlink case |
  | L3 | the size pre-check is dropped | the no-read case |
  | L4 | one project's failure clears every project | the per-project case |
  | L5 | `assembleFleet` ignores `landings` | the frame cases |
  | L6 | `server.ts`'s `GET /api/fleet` call omits `currentLandings()` | the GET case |
  | L7 | the cold-assembly call omits it | the cold-frame case |
  | L8 | a deadline keeps the old map | the deadline case |

- [ ] **Step 6: Commit:** `feat(watch): the landing radar lane carries FleetSession.landing (landing order wave 4b, Task 2)`.

### Task 3: The chip

**Files:**
- Create: `pwa/src/fleet/conflictWords.ts`, `pwa/src/fleet/ConflictChip.tsx`
- Modify: `pwa/src/screens/FleetScreen.tsx`, `pwa/src/session/chipTones.ts`, `pwa/src/fleet/fleet.css`, and the ring-context table in `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md`
- Test: create `pwa/test/conflict-words.test.ts` and `pwa/test/conflict-chip.test.tsx`; modify `pwa/test/offline.test.ts`, `pwa/test/plain-words.test.ts`, `pwa/test/fleet-css.test.ts` and `pwa/test/contrast.test.ts` as they require

- [ ] **Step 1: The failing tests.**
  - `conflict-words.test.ts`:
    - `landingOf`: an absent key, a malformed one, a valid one, one 1201 s old and one 61 s ahead;
    - every word and sentence in the Design, including "Conflicts partly measured" for each cut, for an unmeasured base and for `unmeasuredWith`;
    - a pair listed once;
    - `null` when no session has a fresh landing.
  - `conflict-chip.test.tsx`:
    - it renders nothing with no landing;
    - it has the word, `role="status"` and the accessible name;
    - it has no button;
    - an older server, with no key, renders nothing;
    - a snapshot row with an old `at` renders nothing.
  - `offline.test.ts`:
    - the snapshot keeps `landing`;
    - no key stays no key;
    - a malformed one gives no key.
  - `fleet-css.test.ts`: the chip sits beside the strip, outside the runs line.
- [ ] **Step 2: Run the tests, and see them fail.**
- [ ] **Step 3: Implement** the files, the tone, the CSS, the mount and the two table rows.
- [ ] **Step 4: Run the tests and every PWA guard** named in the Global Constraints, plus `pwa/test/fleet-screen.test.tsx`, `server/test/rings/totality.test.ts`, `server/test/rings/pwa-one-owner.test.ts`, `server/test/census-w7/pwa.test.ts` and `pwa-rings`, and see them pass. `conflictSummaryOf` adds no `archivedAt` filter (`archivedChecks` stays 8). A new `fleet.css` rule that reads `--fs-meta` or `--fs-ui` is registered in `role-census`'s `APP_ROLE_RULES`. Then run `cd pwa && ./node_modules/.bin/tsc --noEmit` through `ccrc test`.
- [ ] **Step 5: Mutations.**

  | # | Mutation | Expected red |
  |---|---|---|
  | C1 | an absent `landing` reads as clean | the older-server case |
  | C2 | `landingOf` ignores `at` | the 1201 s case |
  | C3 | a pair is listed twice | the listed-once case |
  | C4 | the word ignores `cut` | the partly-measured cases |
  | C5 | the chip loses its accessible name | the name case |

- [ ] **Step 6: Commit:** `feat(pwa): the predicted-conflict chip beside the hot-files strip (landing order wave 4b, Task 3)`.

### Task 4: The README, the gate, the PR and the wave-done; then the deploy and the live read

- [ ] **Step 1: The README sentence**, as the Design gives it.
- [ ] **Step 2: The gate.**
  - Run every touched and new file whole.
  - Run the repo-wide guards:
    - `single-definition/*`, `single-definition-pin` and `rings/*`;
    - `growth-check` (with `GROWTH_CHECK=1`);
    - `citations`, `anchors` and `docs-parity`;
    - `deviation-refs` (after `git fetch origin main`);
    - `typecheck-tests`, on its own;
    - `topology-clean` and `box-token-census`.
  - Run the server, test and PWA `tsc` checks through `ccrc test`.
  - Run the full PWA suite through `ccrc test`, once, because the chip touches the fleet screen. Do not run the full server suite: the merge queue runs it.
- [ ] **Step 3: The PR and the wave-done.**
  - Title: `feat: the conflict radar's console half — FleetSession.landing and the predicted-conflict chip (landing order wave 4b)`.
  - The body repeats "What this does not claim".
  - Scan the body for private names before posting.
- [ ] **Step 4: The deploy and the live read.** These are the coordinator's, after the merge.
  - ccrc's updater carries the server and the PWA. The order of the two boxes does not matter, because this wave reads files wave 3b already writes.
  - Once a project has a conf, the coordinator reads, read-only:
    - `GET /api/fleet`'s `landing` for that project's bound sessions;
    - the chip.
  - The ledger records:
    - the release;
    - the rollout date, which starts §10's stage 3 clock for the operator's view;
    - the first fresh landing seen.

---

## Deviations found

Numbers are ISSUED, never chosen; a worker never calls the allocator (worker clause 11). The programme coordinator minted this plan's block, 7477–7484, before the plan landed.

- **D-7477** — `no-run-summary-landing` (Architecture): spec §5.3 also names `RunSummary.landing`. A run's landing is its session's, and the PWA already joins a run to its session by `sessionId`, so a second copy on the wire would be a second reader of one fact (CLAUDE.md, "Consolidate, don't duplicate"). Stage 5's landing line decides whether a run needs its own copy, and adds it then. This narrows operator-approved spec text, and the plan's hand-off says so.
- **D-7478** — `main-health-is-stage-5` (Scope): spec §5.3 names one reader, and the chip predicts conflicts. `main-health` is read by stage 5's `mainRedHold` (spec §5.5), so stage 5 adds its reader. Spec §5.3's "inherited-red investigations" removal therefore waits for stage 5.
- **D-7479** — `positive-match-and-unbound` (Design; wave 3b's D-7393): a head's `null` `id` can mean four things: no row, two rows, an unlisted registry, or a held row. The record does not say which. The reader matches only a non-empty `id` that one head names and a listed record of that project holds. Every other session reads as unknown. A `null`-`id` head on a fleet session's current branch marks every landing of the project `cut.unbound`, because no landing can claim it was paired against that head.
- **D-7480** — `one-chip-strict-clean` (Design): spec §5.3 places the chip "beside the hot-files strip", which is on the fleet screen only, so this wave ships one fleet-level chip. Its "No predicted conflicts" is scoped to a count of measured PRs. It is said only when every measured landing is fully clean, with no cut and no unbound head. A chip on each session's card belongs to a later wave.
- **D-7481** — `absence-collapses-and-ages` (Design): spec §7's "absence means unknown" is held on the wire by omitting `landing` whenever the radar does not speak for a session now, and the assembly drops an entry past the window. On the read side, `landingOf` hides a landing older than the window through `landingShown`, so a cache or an offline snapshot never shows an old prediction. `landingShown` is legitimately different from `freshWithin`: it reads a device clock that is not the fleet box's, so it applies the stale bound only, where `freshWithin` also refuses a doc dated ahead. The reader keeps four reasons apart for its warnings.
- **D-7482** — `reader-caps` (Design): the radar's `probe` has no byte cap of its own (wave 3b). The reader refuses anything over 512 KiB, measured by `statMeasured` before the read, so an oversized file is never read. Each shown path is cut to 300 characters. The largest real doc (100 heads, 45 pairs, 20 paths each) is far below the cap.
- **D-7483** — `coordinator-reader-unplanned` (Scope): spec §10's stage 3 metric counts coordinator sync and order mails sent without a measured conflict. This wave gives the operator the reading. A coordinator-skill sentence that reads `landing` before sending a sync or order mail is carried to a later skills wave. The operator should know that §10's two-week clock for stage 3 measures only the operator's view until then.
- **D-7484** — `current-branch-and-pr` (Design): the radar binds `id` from the registry it read at its tick, and a doc stays readable for up to 1200 s. So a landing is kept only while the session's current branch, by `fleet.ts`'s own derivation, equals the head's `branch`, and, when the session has a PR, while that PR is open and its number is the head's `pr`. Without this, a branch switch, a reused id or a merged PR would inherit another head's prediction. The two derivations are exported from `fleet.ts` rather than copied into the lane, so each keeps one owner.
