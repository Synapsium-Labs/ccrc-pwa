# program-leverage wave 2 — F2: dispatch-time skill preflight + synchronous deviation-floor seed — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dispatch measures whether the worker it just bound actually has the `ccrc-worker` skill
installed and says so on its own response, and a project's first deviation allocation seeds its own
floor instead of waiting up to an hour for a sweep.

**Architecture:** Two independent halves that share one discipline — *measure, never guess, and never
collapse two conditions into one value*. Half 1 adds an L0 three-valued vocabulary (`SkillState`), one
reader (`server/src/skillstate.ts`) over the existing `FleetIO.readFileMeasured` primitive, a
consumer-declared `configDir` port on `DispatchRunDeps`, an additive `skillState` field on the dispatch
response, and one `run_events` row. It never refuses a dispatch. Half 2 lifts the floor sweep's
document reader out of `FleetWatcher` into `server/src/coord/ledgerseed.ts` as a bounded free function
with a typed union result, and calls it from `POST /api/ledger/deviations` **after** the allocator has
already answered `not-seeded` — so `decideAllocation`'s deliberate `bad-count`-masks-`not-seeded`
ordering stays the single authority and no filesystem work happens for a request that could never be
served.

**Tech Stack:** TypeScript (ESM, `"type":"module"`), Node >= 22.13.0, vitest, fastify (L4 only),
`node:sqlite` via `CoordStore` (L3 only). Zero new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-28-program-leverage-design.md` §4 (on `origin/ws/brisk-meadow`
— fetch that ref to read it; it is not on `main`). Program ledger:
`docs/superpowers/programs/program-leverage.md`, same ref.

---

## Global Constraints

- **Commit on `ws/quiet-meadow`, this workspace's own branch — never a separate feature branch.** The
  done-fingerprint re-measures this branch's tip; work parked elsewhere wedges the close `stale-tip`
  forever.
- **TDD red-first, mutation-table discipline. Write each pin BEFORE the code or prose it pins.** This is
  wave 1's own D-1009 lesson: a pin authored after its subject has nothing to fail against, so its red
  was never measured. Every step below that adds a guard is preceded by a step that measures it RED.
- **Absence-permits: the skill preflight NEVER refuses a dispatch.** `DispatchOutcome` gains no refusal
  member, `sendDispatchOutcome`'s switch gains no case, and no early return is added.
- **No overloaded null at any new seam.** `absent` (a proven ENOENT) and `unmeasurable` (no path to
  read, or a read that failed for any other reason) are different answers and must stay different in
  the type, on the wire, in the run-event detail and in the prose.
- **Wire discipline: additive only.** `skillState` rides the dispatch route's HTTP 200 JSON body, not a
  `FleetMsg` — **do not bump `FLEET_PROTO`** (=1, `shared/api.ts`). One reader per field. An older peer
  omitting it is tolerated.
- **Zero new ccd verbs, zero new HTTP routes.** Both features ride surfaces that already exist.
  `EXEC_COMMANDS` is untouched.
- **Single-source-of-truth.** The runtime member list is DERIVED (`Object.keys(SKILL_STATE_MAP)`), never
  hand-typed; `server/test/single-definition.test.ts` text-scans `shared/`, `server/src`, `pwa/src`,
  `agent/src` and fails the build on a second copy.
- **Never spell `'absent' | 'unreadable'` (either ordering) outside `server/src/io.ts`.**
  `single-definition.test.ts` pins that pair to exactly that one file. `SkillState`'s members are
  `'present' | 'absent' | 'unmeasurable'`, which does not match the pair regex — keep it that way.
- **The coord ring.** No file under `server/src/coord/` outside `store.ts, rundefs.ts, routes.ts,
  db.ts, schema.ts` may `import … from './db.js'` or `'node:sqlite'`, or name a `coord.db`/`store.db`
  receiver. The new `coord/ledgerseed.ts` does neither.
- **Destructive-verb census.** `coordinator-skill.test.ts` counts `ws-reap`, `ws-rm` and `ws-gc` across
  `SKILL.md` + EVERY `.md` in `references/` and requires each exactly as many times as contract clause 3
  names it (once). **No new prose in this wave may name any of the three** — `ws-gc` matches as a
  substring, so `ws-gc --prune` counts too.
- **No `METHOD /api/path` spelling for a route that is not in `EXEMPT`.**
  `server/test/auth-passkey.test.ts` walks every `.md` under `ccd/coordinator-skill` and
  `ccd/worker-skill` and requires every harvested `METHOD /api/...` to be a key of `EXEMPT`
  (`server/src/auth/gate.ts`). `POST /api/ledger/deviations` and `GET /api/ledger` are already exempt;
  **this wave adds no new route spelling.**
- **No `curl` invocation inside a fenced block** in either skill corpus
  (`server/test/ccrc-api-closed.test.ts`, D-739).
- **Apostrophes.** The regime is INVERTED between the two files and both are pinned (D-104):
  `ccd/coordinator-skill/references/*.md` are measured at ZERO curly apostrophes and ZERO curly double
  quotes — every new byte there uses a STRAIGHT `'`. `ccd/coordinator-skill/SKILL.md`'s ten contract
  clauses use CURLY `’` (five occurrences, clauses 4/5/6/10) because `CONTRACT`'s literals are
  single-quoted; **this wave does not touch a clause.**
- **Role vocabulary only, in every byte this wave writes — including this plan.**
  `server/test/topology-clean.test.ts` scans `git ls-files` AND every blob `origin/main..HEAD`
  introduces (D-208) and bans the operator's username, the two real box names, the volume id, the
  GitHub handle and the old employer org. **No absolute `/home/<user>/…` path anywhere; use
  `cd "$(git rev-parse --show-toplevel)"`.**
- **Deviation refs are ledgered and bounded.** `server/test/deviation-refs.test.ts` requires the highest
  `D-<n>` token ANYWHERE in the tracked tree to equal the highest `D-<n>` DEFINED by a heading or bullet
  in a plan (`^(?:#{2,4} |- \*\*)D-(\d+)\b`). So: define every number you cite, and **never write the
  top of an unconsumed range with a `D-` prefix** — spell this program's block `D-999..1046`.
- **Fixture `D-` refs MUST be spelled SPLIT** — `` `D-${1200}` `` or `'D-' + '1200'`, never contiguous.
  `deviation-refs.test.ts` runs the REAL `floorFromScan` over the whole tracked tree; a contiguous
  fixture ref reds it and, because the floor only ever rises, would permanently poison the live seed on
  the fleet.
- **Never write a bare `D-TBD-…` into a diff** (`server/test/dtbd.test.ts`).
- **Deviations: this program's block is `D-999..1046`; `D-999..D-1011` are consumed by wave 1, so this
  wave starts at `D-1012`.** Every number cited below is defined in `## Deviations found`.
- **Suites run in the FOREGROUND, `timeout ≥ 600000`, cd'd into the package.** Single suite:
  `./node_modules/.bin/vitest run test/<file>` from inside `server/`. **Never bare `npx vitest`** — it
  resolves a global copy with no jsdom and falsely reports "no tests".
- **Do NOT deploy anything this wave.** This wave edits `ccd/coordinator-skill/references/`, so its
  close is **AGENT-FIRST** — but the deploy is the coordinator's act at wave close, not the worker's.

---

## File Structure

| File | Change | Responsibility after the change |
|---|---|---|
| `shared/api.ts` | Add one vocabulary block | L0: `SkillState`, `SKILL_STATE_MAP`, derived `SKILL_STATES`, `isSkillState` — the three words, defined once, for both lanes |
| `server/src/skillstate.ts` | **Create** | THE one skill-presence read: `readWorkerSkillState(io, configDir)`; owns the `MeasuredRead` → `SkillState` mapping and the `<configDir>/skills/<name>/SKILL.md` join |
| `server/src/coord/dispatch.ts` | Modify deps, outcome, the two binds, the tail | Declares the `configDir` port it needs; measures the preflight after the commit; carries `skillState` on the ok arm; writes one `run_events` row |
| `server/src/coord/routes.ts` | Modify `sendDispatchOutcome`, the dispatch call site, the allocator handler | Wires `configDirFor` into the port; sends `skillState` unconditionally; runs the inline floor seed on `not-seeded` and retries once |
| `server/src/coord/ledgerseed.ts` | **Create** | The floor measurement as a free, bounded, port-fed function with a typed union out — `readLedgerDocs` + `measureLedgerFloor` |
| `server/src/watch.ts` | Delete the private `readLedgerDocs`; rewire its two call sites | The watcher keeps its scheduling and loses its private copy of the walk |
| `ccd/coordinator-skill/references/wave-lifecycle.md` | Modify the §2 dispatch-response block | Documents `skillState`, corrects the "two fields" count, tells the coordinator to report `absent` before treating a wave as briefed |
| `ccd/coordinator-skill/references/peer-protocol.md` | Modify the allocator paragraph | Stops promising an hourly wait; states what each `not-seeded` detail now means |
| `server/test/skillstate.test.ts` | **Create** | The three-way mapping, measured |
| `server/test/dispatch-skillstate.test.ts` | **Create** | The preflight through `dispatchRun`: three-way, absence-permits, the run-event row, both arms |
| `server/test/ledgerseed.test.ts` | **Create** | The lifted reader and the bounded measurement, including the strictness that stops a partial scan seeding |
| `server/test/single-definition.test.ts` | Add one describe | `SkillState` is defined once and its list is derived |
| `server/test/coordinator-skill.test.ts` | Extend one describe | The reference documents `skillState` and all three of its words |
| `server/test/run-routes.test.ts` | Extend the dispatch describes; fix three exact-row assertions | The 200 body carries `skillState`; the run-event trail's new row is expected |
| `server/test/dispatch-adopt.test.ts` | Fix the deps literal | Supplies the new port |
| `server/test/coord-decide.test.ts` | Fix the deps literal + one exact-count assertion | Supplies the new port |
| `server/test/unattended-actor.test.ts` | Fix the deps literal | Supplies the new port |
| `server/test/ledger-routes.test.ts` | Add four tests | Fresh project self-seeds; unmeasurable still 409; measured-but-no-refs still 409; a traversing project name never walks |

**Ordering rationale.** Task 1 ships the vocabulary and the reader with nothing depending on them, so
its reds are pure. Task 2 consumes both and is where the dispatch response changes shape — every
`DispatchRunDeps` literal in the suite breaks in that task and is fixed there, not spread across two.
Task 3 documents what Task 2 shipped (the pin is written first, inside Task 3, and measured red against
the undocumented reference). Tasks 4 and 5 are the second feature and touch none of the first's files;
Task 4 lifts the reader with the watcher's behaviour held constant, so Task 5's route change is the
only place behaviour moves.

---

## Verified facts this plan is built on

Read at `f5dfd2d9` (this branch's tip at planning time) on 2026-08-28, in this worktree. Do not
re-derive them; DO re-check any that a step's expected output contradicts, and **believe the tree over
this table.**

| Fact | Evidence |
|---|---|
| `readFileMeasured` already gives the exact three-way | `server/src/io.ts` — `MeasuredRead = {ok:true;content} \| {ok:false;reason:ReadFailure}`, `ReadFailure = 'absent' \| 'unreadable'`; only a proven ENOENT answers `absent` |
| `readFile` folds every failure to one `null` and must NOT be used here | `server/src/io.ts` — the comment on the `readFile` member says so |
| The install destination is `<configDir>/skills/ccrc-worker/SKILL.md` | `ccd/install-worker-skill.sh` — `NAME=ccrc-worker`, `dest="$dir/skills/$NAME"`, `REQUIRED_FILES=(SKILL.md)`; asserted for every rostered account by `server/test/install-worker-skill.test.ts` |
| A rostered account whose config dir does not exist on a box is SKIPPED by the installer | `ccd/install-worker-skill.sh` — `[[ -d "$dir" ]] || continue`. So `absent` is an ordinary, expected answer, not an alarm |
| `configDirFor(cfg, wrapper)` is the ONE wrapper→directory join | `server/src/config.ts`; `single-definition.test.ts` requires the literal `configDirFor(` in `fleet.ts`, `server.ts`, `commands.ts`, `watch.ts`, `sessionws.ts` — an "at least these five" check, so a sixth caller is fine |
| `configDirFor` answers `undefined` for a wrapper the roster does not carry | `server/src/config.ts`; `sessionws.ts` rules that a deployment gap, not a read failure |
| `config.ts` imports `./coord/db.js` | `server/src/config.ts:4` — which is why `coord/dispatch.ts` must NOT value-import it (D-1015) |
| Every `server/src/coord/*.ts` imports `../config.js` TYPE-ONLY today | `close.ts:2`, `fingerprint.ts:5`, `dispatch.ts:3` — all `import type` |
| `DispatchRunDeps` already carries `io: FleetIO` and `cfg: CcrcConfig` | `server/src/coord/dispatch.ts:52-56` |
| The fresh-spawn arm's `winner.wrapper` is guaranteed measured | `dispatch.ts:313-322` refuses the whole dispatch when ANY same-project record has `measuredIdentity(r) === null`, and the candidate filter is same-project |
| The resume arm may have NO record at all, and that is TOLERATED | `dispatch.ts:437-443` — `record` may be `undefined` on a listable registry; the arm falls back to `run.workspace`/`run.branch` and proceeds by design |
| `dispatch.ts`'s `detail` is a MUTUALLY EXCLUSIVE ternary | `dispatch.ts:544-545` — `adopted ? … : clearError !== null ? … : undefined`. A fourth fact folded in is dropped whenever either earlier arm wins (D-1013) |
| `clearRefusedDetail`'s string has a READER | `dispatch.ts`'s own comment names `CoordStore.strandedClear` — so the detail's shape is not free to change |
| `sendDispatchOutcome` enumerates the 200 body FIELD BY FIELD | `server/src/coord/routes.ts:102-113`; `adopted`/`spawnState` are UNCONDITIONAL with a comment forbidding an L4 narrowing. The `_exhaustive: never` guard catches a new refusal member but NOT a new field on the ok arm |
| The one production `dispatchRun` call site | `server/src/coord/routes.ts:947`, inside `coordMutex.run(...)` |
| Every bare `dispatchRun`/`closeRun` call under `server/src` must sit inside `coordMutex.run` | `server/test/dispatch-mutex-gate.test.ts`; test files are outside its walk |
| `recordRunEvent` writes a NON-transition row (`fromState === toState === current`) and is NOT inside `CoordStore.dispatchRun`'s `tx()` | `server/src/coord/store.ts:469` |
| `pushNewRuns` pushes any run_event row whose run has a `sessionId`, tagged `run-<runId>-<toState>` | `server/src/watch.ts:1079-1095` — so a row written AFTER the commit carries `toState:'dispatched'` and reuses the transition row's own tag |
| `runEvents(runId)` returns `{at, fromState, toState, causedBy, detail}` ORDER BY id | `server/src/coord/store.ts:861` |
| `decideAllocation` checks `bad-count` BEFORE `not-seeded`, deliberately | `server/src/coord/ledger.ts:31-48`; pinned by `server/test/ledger.test.ts`'s "bad-count is refused even unseeded" |
| "Seeded" means one row in `ledger_floor` for that project | `server/src/coord/schema.ts` (`user_version 3→4`); read by `CoordStore.ledgerFloor`, written ONLY by `CoordStore.raiseLedgerFloor` |
| The floor only ever rises, by SQL not by discipline | `store.ts:2508-2515` — `ON CONFLICT(project) DO UPDATE … WHERE excluded.floor > ledger_floor.floor` |
| `floorFromScan` is pure, exported, and returns `null` for "no global D-ref found" | `server/src/coord/ledger.ts:87-101` |
| `readLedgerDocs` is a PRIVATE `FleetWatcher` method with two call sites | `server/src/watch.ts:1913` — `sweepLedgerFloor` (`['plans','specs']`) and `sweepLedgerReconcile` (`['plans']`) |
| The sweep is hourly, fire-and-forget, gated on an in-memory field set BEFORE the work | `watch.ts:90` (`LEDGER_FLOOR_SWEEP_MS = 3_600_000`), `:848`, `:1946-1949` |
| Only projects named by THIS tick's registry records are ever seeded, and an unlistable registry skips the sweep entirely | `watch.ts:1952`, `:640` |
| `registerCoordRoutes` has NO `FleetWatcher` | `server/src/coord/routes.ts:239-259`; `buildServer` never forwards one |
| The route already reaches the store's floor from L4 | `routes.ts:1900` — `GET /api/ledger` calls `deps.coord.ledgerFloor` |
| `not-seeded` must keep a PRODUCER literal in `coord/routes.ts` | `server/test/claims-envelope.test.ts:174-182` — every `CLAIM_REFUSE_CODES` member is checked for one |
| `coordinator-skill.test.ts`'s corpus is a `readdirSync` of `references/` | `:49-52` (commit `47c955b1`, D-1000/D-1003) — a new prose line is enrolled in every whole-corpus guard automatically |
| The dispatch-response describe pins ONLY `adopted`, `spawnState` and the ok-is-not-proof sentence | `coordinator-skill.test.ts:416-423` — a `skillState` row is invisible to it, so this wave must add its own pin |
| `wave-lifecycle.md` says the route "answers with **two fields** beyond the ones above" | `ccd/coordinator-skill/references/wave-lifecycle.md:71` — unpinned by any test (D-1014) |
| `wave-lifecycle.md` carries exactly ONE fenced `json` block containing `branchTip`, asserted `toHaveLength(1)` | `coordinator-skill.test.ts:666-682` — do not add a second |
| `single-definition.test.ts` does NOT scan `.md` or anything under `ccd/` | its `ROOTS` are `shared/`, `server/src`, `pwa/src`, `agent/src`, `.tsx?` only |
| `ioDoubles.ts` overrides `readFileMeasured` ONLY, and takes an arbitrary path predicate | `server/test/ioDoubles.ts:9,43,63` — `degradedReadIO` → `unreadable`, `absentReadIO` → `absent` |
| The fixture roster maps wrapper `claude` → suffix `.claude` | `server/test/helpers.ts:60` (`DEFAULT_TEST_ROSTER`); `testDeps(home)` seeds it and `loadConfig({CCRC_HOME: home})` |
| No fixture HOME creates a wrapper CONFIG DIR | `seedRoster` writes only `<home>/.ccrc/accounts.json` — the `present` case must `mkdirSync` it |
| A DIRECTORY in place of a file reads `{ok:false, reason:'unreadable'}` and needs no root guard | `server/test/io.test.ts:36` |
| `chmod 000` cases MUST carry `it.skipIf(process.getuid?.() === 0)` | D-116; `io.test.ts:44`, `hookstate.test.ts:276` |
| `HookStateRead` and `LivenessVerdict` are the tree's existing three-way precedents | `server/src/hookstate.ts:146`, `server/src/coord/claims.ts:147` (`'running' \| 'gone' \| 'unmeasurable'`) |
| The remote read path is already permitted under every roster config dir | `agent/src/whitelist.ts:48-54` — `underClaudeGlob`; the agent's `readWhole` sets `absent` only on a proven ENOENT and applies no size cap |
| A remote `forbidden` refusal arrives as `unreadable`, never `absent` | `server/src/remote/io.ts:40-53` — the correct polarity for this feature |
| Remote reads are bounded at 15 s PER REQUEST with no aggregate deadline | `server/src/remote/client.ts:68` (`DEFAULT_REQUEST_TIMEOUT_MS`) |
| The tree's bounded-loop idiom is a wall-clock budget with an injectable clock | `server/src/inject/send.ts:194,302,9` — `CLEAR_BUDGET_MS`, `const deadline = now() + …` checked BETWEEN iterations, `SendDeps.now?` injected so a test can prove the bound without spending it |
| `origin` carries exactly three heads and the graphify lane is NOT one of them | `git ls-remote --heads origin` → `main`, `docs/scope-throttle-visible`, `ws/brisk-meadow` (D-1012) |
| Highest `D-<n>` in `origin/main` is `D-1011` | `git grep -hoE 'D-1[0-9]{3}' origin/main` — the `1234` hit is a substring of the `D-123456` garbage fixture in `server/test/ledger.test.ts`. **Write it without the `D-` prefix, as here**: a standalone four-digit token in that shape IS a global ref to `floorFromScan`, and naming it above the high-water reds `deviation-refs.test.ts` (measured — this row did exactly that on its first draft) |

---

## Task 1: The vocabulary and the one skill-presence read

**Files:**
- Modify: `shared/api.ts` (append one vocabulary block near the other Build-8 vocabularies)
- Create: `server/src/skillstate.ts`
- Modify: `server/test/single-definition.test.ts` (add one describe)
- Test: `server/test/skillstate.test.ts` (create)

**Interfaces:**
- Consumes: `FleetIO`, `MeasuredRead`, `ReadFailure` from `server/src/io.ts`.
- Produces:
  - `type SkillState = 'present' | 'absent' | 'unmeasurable'` (`shared/api.ts`)
  - `const SKILL_STATE_MAP: Record<SkillState, string>` (`shared/api.ts`)
  - `const SKILL_STATES: readonly SkillState[]` — DERIVED via `Object.keys` (`shared/api.ts`)
  - `function isSkillState(v: unknown): v is SkillState` (`shared/api.ts`)
  - `const WORKER_SKILL_DIR = 'ccrc-worker'` (`server/src/skillstate.ts`)
  - `function workerSkillPath(configDir: string): string` (`server/src/skillstate.ts`)
  - `async function readWorkerSkillState(io: Pick<FleetIO,'readFileMeasured'>, configDir: string | undefined): Promise<SkillState>` (`server/src/skillstate.ts`)

- [ ] **Step 1: Write the single-definition pin FIRST (it must red before the type exists)**

Add this describe to `server/test/single-definition.test.ts`. Put it immediately AFTER the existing
`describe('Build 8 vocabularies …')` block so it sits with its own kind rather than at end-of-file —
the adjacent unmerged graphify lane also appends at EOF and would conflict there (D-1012).

```ts
describe('the skill-presence vocabulary is declared once and derived', () => {
  // Mutation table: delete any one of the three declarations in shared/api.ts,
  // or hand-type SKILL_STATES as a literal array, and exactly one assertion
  // below reds. The shape mirrors SPAWN_VERDICTS (Build 8): one type, one
  // presentational Record keyed BY the type (the compiler keeps it total), and
  // a runtime list DERIVED from that Record's keys.
  const api = readFileSync(path.join(ccrcRoot, 'shared/api.ts'), 'utf8');

  it('declares SkillState and SKILL_STATE_MAP in shared/api.ts and nowhere else', () => {
    expect(oneDefinition(/^\s*export type SkillState\b/m)).toEqual(['shared/api.ts']);
    expect(oneDefinition(/^\s*export const SKILL_STATE_MAP\b/m)).toEqual(['shared/api.ts']);
    expect(oneDefinition(/^\s*export const SKILL_STATES\b/m)).toEqual(['shared/api.ts']);
  });

  it('DERIVES the runtime list from the map rather than re-typing its members', () => {
    expect(api, 'SKILL_STATES is hand-typed as a literal array — derive it from SKILL_STATE_MAP')
      .not.toMatch(/SKILL_STATES[^=]*=\s*\[/);
    expect(api).toMatch(/SKILL_STATES[^=]*=\s*Object\.keys\(SKILL_STATE_MAP\)/);
  });

  it('carries no free-standing copy of the three members anywhere under the four roots', () => {
    // A second spelling is how a PWA badge or an agent-side probe silently
    // drifts from the wire. The Record in shared/api.ts is keyed by the type,
    // so it is not a copy and is not matched here.
    const LIST = /\[\s*'present',\s*'absent',\s*'unmeasurable'\s*\]/;
    const holders = ALL.filter((f) => LIST.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual([]);
  });

  it('does not respell the io.ts read-failure pair', () => {
    // single-definition already pins 'absent' | 'unreadable' to server/src/io.ts
    // alone. SkillState deliberately says `unmeasurable`, not `unreadable`, so
    // the two vocabularies cannot be confused at a seam.
    expect(api).not.toMatch(/'absent'\s*\|\s*'unreadable'|'unreadable'\s*\|\s*'absent'/);
  });
});
```

**Before writing it, confirm the three helpers it uses exist in that file with these exact names:**
`oneDefinition`, `ALL`, `rel`, `ccrcRoot`, and that `readFileSync`/`path` are already imported. If
`oneDefinition` has a different signature, match the file's own usage — copy the call shape from the
`SPAWN_VERDICT` block rather than the shape written here.

- [ ] **Step 2: Run it and record the RED**

```bash
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/single-definition.test.ts
```

Expected: FAIL — `expect(oneDefinition(/^\s*export type SkillState\b/m)).toEqual(['shared/api.ts'])`
receives `[]`. **Paste the failing assertion into the execution record; a pin whose red you did not see
is not a pin.**

- [ ] **Step 3: Write the failing reader test**

Create `server/test/skillstate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { localIO } from '../src/io.js';
import { absentReadIO, degradedReadIO } from './ioDoubles.js';
import { readWorkerSkillState, workerSkillPath } from '../src/skillstate.js';

const plant = (): string => {
  const configDir = mkTmp('ccrc-skillstate-');
  mkdirSync(path.join(configDir, 'skills', 'ccrc-worker'), { recursive: true });
  return configDir;
};

describe('readWorkerSkillState — three answers, and they never collapse', () => {
  it('answers present for an installed SKILL.md', async () => {
    const configDir = plant();
    writeFileSync(workerSkillPath(configDir), '---\nname: ccrc-worker\n---\n');
    expect(await readWorkerSkillState(localIO, configDir)).toBe('present');
  });

  it('answers absent when the installer never ran on this home', async () => {
    // A rostered account whose config dir exists but carries no skills/ tree is
    // the ordinary case: install-worker-skill.sh skips a home whose directory is
    // missing. Nothing is wrong; the brief just works degraded.
    const configDir = mkTmp('ccrc-skillstate-');
    expect(await readWorkerSkillState(localIO, configDir)).toBe('absent');
  });

  it('answers unmeasurable when the read FAILED rather than proved nothing is there', async () => {
    // The whole point of the field. `unreadable` covers EACCES, EISDIR, an
    // agent whitelist `forbidden`, a 15 s remote timeout and a dropped agent
    // socket — none of which is evidence the path is clear.
    const configDir = plant();
    const io = degradedReadIO((p) => p.endsWith(path.join('ccrc-worker', 'SKILL.md')));
    expect(await readWorkerSkillState(io, configDir)).toBe('unmeasurable');
  });

  it('answers unmeasurable when there is no config dir to read at all', async () => {
    // configDirFor answers undefined for a wrapper this box's roster does not
    // carry, and the resume arm can bind a session whose registry row is gone.
    // Neither of those measured a file, so neither may say `absent`.
    expect(await readWorkerSkillState(localIO, undefined)).toBe('unmeasurable');
  });

  it('still answers absent when the failure is a PROVEN ENOENT', async () => {
    const configDir = plant();
    const io = absentReadIO((p) => p.endsWith(path.join('ccrc-worker', 'SKILL.md')));
    expect(await readWorkerSkillState(io, configDir)).toBe('absent');
  });

  it('reads a DIRECTORY at the skill path as unmeasurable, on the real filesystem', async () => {
    // Root-safe real-fs twin of the degradedReadIO case (io.test.ts's own
    // EISDIR precedent) — no privilege dependence, so it is real under every
    // runner including a root one.
    const configDir = plant();
    mkdirSync(workerSkillPath(configDir), { recursive: true });
    expect(await readWorkerSkillState(localIO, configDir)).toBe('unmeasurable');
  });

  it('joins the path the installer actually writes to', async () => {
    // ccd/install-worker-skill.sh: NAME=ccrc-worker, dest="$dir/skills/$NAME",
    // REQUIRED_FILES=(SKILL.md). A drift here makes every dispatch report
    // `absent` on a correctly installed fleet.
    expect(workerSkillPath('/cfg')).toBe(path.join('/cfg', 'skills', 'ccrc-worker', 'SKILL.md'));
  });
});
```

- [ ] **Step 4: Run it and record the RED**

```bash
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/skillstate.test.ts
```

Expected: FAIL — `Failed to resolve import "../src/skillstate.js"`.

- [ ] **Step 5: Add the L0 vocabulary**

In `shared/api.ts`, beside the other Build-8 vocabularies (find `SPAWN_VERDICT_MAP` and put this after
its block, so the two read as one family):

```ts
/**
 * What a MEASUREMENT of one skill's presence in one config dir found.
 *
 *  - `present`      — the skill's `SKILL.md` was read.
 *  - `absent`       — a PROVEN ENOENT. The installer has not run on this home,
 *                     which is ordinary: `install-worker-skill.sh` skips a
 *                     rostered account whose config dir does not exist.
 *  - `unmeasurable` — no answer was obtained. Either there was no path to read
 *                     (the wrapper is not in this box's roster, or the session
 *                     has no registry row), or the read itself failed — EACCES,
 *                     EISDIR, an agent whitelist refusal, a remote timeout, a
 *                     dropped socket.
 *
 * `absent` and `unmeasurable` are DIFFERENT ANSWERS and this file is the reason
 * they stay different: `absent` is evidence about the fleet, `unmeasurable` is
 * an admission about the measurement. Folding them would claim an installation
 * fact nobody measured — the overloaded-null defect this codebase bans by name.
 *
 * Deliberately NOT spelled with `io.ts`'s `'absent' | 'unreadable'` pair: that
 * vocabulary describes ONE read's failure, this one describes a conclusion
 * drawn from a read that may never have happened. `single-definition.test.ts`
 * pins the pair to `server/src/io.ts` alone.
 */
export type SkillState = 'present' | 'absent' | 'unmeasurable';

/** Presentational only, and keyed BY the type so the compiler keeps it total. */
export const SKILL_STATE_MAP: Record<SkillState, string> = {
  present: 'installed',
  absent: 'not installed',
  unmeasurable: 'could not be measured',
};

export const SKILL_STATES: readonly SkillState[] = Object.keys(SKILL_STATE_MAP) as SkillState[];

export function isSkillState(v: unknown): v is SkillState {
  return typeof v === 'string' && (SKILL_STATES as readonly string[]).includes(v);
}
```

Note the cast is on the CONSTANT (`Object.keys(...) as SkillState[]`) and on the widened list inside the
guard, never on the guard's `unknown` input — that is the house shape, and casting `v` would make the
guard a lie.

- [ ] **Step 6: Create the reader**

`server/src/skillstate.ts`:

```ts
import path from 'node:path';
import type { SkillState } from '../../shared/api.js';
import type { FleetIO } from './io.js';

/**
 * THE skill-presence read. One definition, on purpose (program-leverage fold
 * ruling, 2026-08-28): the adjacent graphify lane is building its own
 * skill-convergence machinery in bash, over every roster home, against a
 * version stamp — a different language, subject and output. The two cannot be
 * one function, so what they converge on is this file's VOCABULARY and its
 * absent-vs-unmeasurable distinction. If a second TypeScript caller ever needs
 * to ask whether a skill is installed, it calls THIS, and the `name` argument
 * grows a parameter rather than the join growing a second copy.
 *
 * Shaped after `readLiveStateMeasured` (`livestate.ts`): the CALLER supplies
 * the config dir, because turning a wrapper into a directory is
 * `configDirFor`'s single job and this file does not duplicate it.
 */

/** The directory `install-worker-skill.sh` writes, under `<configDir>/skills/`. */
export const WORKER_SKILL_DIR = 'ccrc-worker';

/** The one file the installer's `REQUIRED_FILES` names. */
export function workerSkillPath(configDir: string): string {
  return path.join(configDir, 'skills', WORKER_SKILL_DIR, 'SKILL.md');
}

/**
 * `undefined` configDir is NOT a missing skill — it is a missing PATH, and the
 * two are different facts. It arrives two ways, both real: `configDirFor`
 * answers `undefined` for a wrapper this box's roster does not carry (a
 * deployment gap that a retry cannot heal), and the dispatch resume arm
 * tolerates a session whose registry row is absent from a listable registry, so
 * there is no wrapper to map at all. Neither read a file; neither may say
 * `absent`.
 *
 * Uses `readFileMeasured`, never `readFile` — the latter folds absent and
 * unreadable into one `null`, which is exactly the distinction this function
 * exists to carry.
 */
export async function readWorkerSkillState(
  io: Pick<FleetIO, 'readFileMeasured'>, configDir: string | undefined,
): Promise<SkillState> {
  if (configDir === undefined) return 'unmeasurable';
  const read = await io.readFileMeasured(workerSkillPath(configDir));
  if (read.ok) return 'present';
  return read.reason === 'absent' ? 'absent' : 'unmeasurable';
}
```

- [ ] **Step 7: Run both suites and verify GREEN**

```bash
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/skillstate.test.ts test/single-definition.test.ts
```

Expected: PASS, both files.

- [ ] **Step 8: Measure the mutation table**

Do these one at a time, run `test/skillstate.test.ts`, record the failing test name, then REVERT:

1. Change `read.reason === 'absent' ? 'absent' : 'unmeasurable'` to `'absent'` (collapse the pair).
   Expect: *answers unmeasurable when the read FAILED* and *reads a DIRECTORY at the skill path* fail.
2. Change the `configDir === undefined` guard to `return 'absent'`.
   Expect: *answers unmeasurable when there is no config dir* fails.
3. Change `workerSkillPath`'s join to `'skills'`/`'worker'`.
   Expect: *joins the path the installer actually writes to* and *answers present* fail.

Record all three in the execution record with their exact assertion text.

- [ ] **Step 9: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add shared/api.ts server/src/skillstate.ts server/test/skillstate.test.ts server/test/single-definition.test.ts
git commit -m "feat(wave2): SkillState is one vocabulary and one reader

Three answers that never collapse: present, absent (a proven ENOENT), and
unmeasurable (no path to read, or a read that failed). Derived member list,
one definition, pinned both ways."
```

---

## Task 2: Dispatch measures the preflight and says so

**Files:**
- Modify: `server/src/coord/dispatch.ts` (deps `:52-56`, outcome `:58-65`, locals `:214`, both binds
  `:376` and `:437-443`, the tail after `:546`)
- Modify: `server/src/coord/routes.ts` (`sendDispatchOutcome` `:102-113`, the call site `:947`)
- Test: `server/test/dispatch-skillstate.test.ts` (create)
- Modify: `server/test/run-routes.test.ts`, `server/test/dispatch-adopt.test.ts`,
  `server/test/coord-decide.test.ts`, `server/test/unattended-actor.test.ts`

**Interfaces:**
- Consumes: `readWorkerSkillState` and `SkillState` from Task 1.
- Produces:
  - `DispatchRunDeps` gains `configDir: (wrapper: string) => string | undefined` (REQUIRED).
  - `DispatchOutcome`'s ok arm gains `skillState: SkillState`.
  - The 200 body of `POST /api/runs/:id/dispatch` gains `skillState`, unconditionally.
  - One extra `run_events` row per successful dispatch, `detail: 'skill-preflight:<SkillState>'`.

- [ ] **Step 1: Write the failing preflight test**

Create `server/test/dispatch-skillstate.test.ts`. Copy the harness shape from
`server/test/dispatch-adopt.test.ts` — read that file's `harness()`/`seedRow()` first and match it
rather than inventing a second fixture spine.

```ts
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { testDeps } from './helpers.js';
import { localIO } from '../src/io.js';
import { degradedReadIO } from './ioDoubles.js';
import { configDirFor } from '../src/config.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { dispatchRun, type DispatchRunDeps } from '../src/coord/dispatch.js';
import type { CcdArgv, CcdResult } from '../src/exec.js';

const PROJECT = 'demo';
const NEW_ID = 'demo-quiet-basin';

// The registry-row field set every dispatch fixture writes; copied from
// dispatch-adopt.test.ts's seedRow deliberately (that suite owns the canonical
// copy — if it drifts, this one is wrong).
const seedRow = (home: string, id: string): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const put = (f: string, v: string): void => writeFileSync(path.join(reg, `${id}.${f}`), v);
  put('wrapper', 'claude'); put('project', PROJECT); put('workdir', `/w/${id}`);
  put('uuid', `u-${id}`); put('started', '1'); put('workspace', id);
  put('branch', `ws/${id}`); put('base', 'origin/main');
};

/** `installed` plants a real SKILL.md; `degraded` forces the read to fail. */
const harness = async (opts: { installed: boolean; degraded?: boolean } = { installed: true }) => {
  const home = mkTmp('ccrc-dispatch-skill-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });

  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const opened = coord.openRun({
    program: 'program-leverage', title: 'F2', project: PROJECT,
    wave: 1, waveOf: 8, claimedBy: 'ccrc-pwa-coordinator',
  });
  if (!('id' in opened)) throw new Error(`fixture openRun refused: ${JSON.stringify(opened)}`);

  const runCcd = async (argv: CcdArgv): Promise<CcdResult> => {
    if (argv[0] === 'ws-add') seedRow(home, NEW_ID);
    return { ok: true, stdout: '', stderr: '', killed: false, signal: null };
  };

  const base = testDeps(home, async () => ({ code: 0, stdout: '', stderr: '' }));
  const cfg = base.cfg;

  // The fixture roster maps wrapper `claude` to suffix `.claude`; nothing in the
  // fixture creates that directory, so `present` has to be planted by hand.
  if (opts.installed) {
    const dir = path.join(configDirFor(cfg, 'claude')!, 'skills', 'ccrc-worker');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: ccrc-worker\n---\n');
  }

  const io = opts.degraded === true
    ? degradedReadIO((p) => p.endsWith(path.join('ccrc-worker', 'SKILL.md')))
    : localIO;

  const deps: DispatchRunDeps = {
    ...base, io, coord, runCcd,
    configDir: (w: string) => configDirFor(cfg, w),
  } as DispatchRunDeps;

  return {
    coord, runId: opened.id,
    dispatch: () => dispatchRun(deps, opened.id, 'go', undefined),
    details: () => coord.runEvents(opened.id).map((e) => e.detail),
  };
};

describe('the dispatch preflight measures the worker skill and never refuses', () => {
  it('reports present when the installer has run on that home', async () => {
    const h = await harness({ installed: true });
    const out = await h.dispatch();
    expect(out).toMatchObject({ ok: true, skillState: 'present' });
  });

  it('reports absent, and STILL DISPATCHES, when the home has no skill', async () => {
    // Absence-permits. The brief still works, degraded — it carries the
    // branch-discipline sentence in its own text for exactly this case.
    const h = await harness({ installed: false });
    const out = await h.dispatch();
    expect(out).toMatchObject({ ok: true, skillState: 'absent', briefQueued: true });
  });

  it('reports unmeasurable, distinctly from absent, when the read FAILED', async () => {
    const h = await harness({ installed: true, degraded: true });
    const out = await h.dispatch();
    expect(out).toMatchObject({ ok: true, skillState: 'unmeasurable' });
  });

  it('records the measurement on the run trail, on every one of the three answers', async () => {
    for (const [opts, expected] of [
      [{ installed: true }, 'skill-preflight:present'],
      [{ installed: false }, 'skill-preflight:absent'],
      [{ installed: true, degraded: true }, 'skill-preflight:unmeasurable'],
    ] as const) {
      const h = await harness(opts);
      await h.dispatch();
      expect(h.details(), JSON.stringify(opts)).toContain(expected);
    }
  });

  it('writes the preflight row with the state the run already rests in', async () => {
    // The row is written AFTER the commit, so its toState is `dispatched` and
    // its push tag (`run-<id>-dispatched`) is the transition row's own. A row
    // written BEFORE the commit would carry `planned` and mint a second,
    // wrong-looking notification for a state the run has already left.
    const h = await harness({ installed: true });
    await h.dispatch();
    const rows = h.coord.runEvents(h.runId);
    const pre = rows.find((e) => e.detail?.startsWith('skill-preflight:'));
    expect(pre, 'no skill-preflight row was written').toBeDefined();
    expect(pre!.toState).toBe('dispatched');
    expect(pre!.fromState).toBe('dispatched');
  });

  it('answers unmeasurable when the wrapper is not in this box roster', async () => {
    // configDirFor's `undefined` is a deployment gap, not a read. A retry
    // cannot fix it and `absent` would claim a fact nobody measured.
    const h = await harness({ installed: true });
    // Rebuild deps with a port that maps nothing, the shape of an unrostered
    // wrapper on this box.
    const out = await h.dispatch();
    expect(out).toMatchObject({ ok: true });
    expect(['present', 'absent', 'unmeasurable']).toContain(
      (out as { skillState: string }).skillState);
  });
});
```

**Rewrite that last test properly rather than shipping it as written** — it is a placeholder shape and
asserts nothing. Give `harness` an `unrostered?: boolean` option that sets
`configDir: () => undefined`, and assert `skillState === 'unmeasurable'` exactly. Do not leave a test
whose assertion is satisfied by all three answers.

- [ ] **Step 2: Run it and record the RED**

```bash
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/dispatch-skillstate.test.ts
```

Expected: FAIL — every test, on `skillState` being `undefined` in the outcome (and a TS error on
`configDir` not being a member of `DispatchRunDeps`).

- [ ] **Step 3: Declare the port and the field**

In `server/src/coord/dispatch.ts`, replace the deps interface (`:52-56`):

```ts
export interface DispatchRunDeps {
  coord: CoordStore;
  io: FleetIO; cfg: CcrcConfig; runCcd: Deps['runCcd']; fleetState?: FleetState;
  tmux: Tmux; queue: KeyedQueue;
  /**
   * A wrapper's config dir, or `undefined` when this box's roster does not
   * carry that wrapper — the CONSUMER-DECLARED port (L2) for the one join
   * `configDirFor` owns.
   *
   * Declared here rather than calling `configDirFor` directly, because
   * `server/src/config.ts` imports `./coord/db.js`: a value import would pull
   * the store's own module graph into a policy module that must not hold a
   * handle, and every other `coord/*.ts` imports that file TYPE-ONLY today
   * (D-1015). REQUIRED, not optional — an optional port that a caller forgets
   * to wire would report `unmeasurable` on a healthy fleet forever, and fail
   * quiet is the one failure this feature exists to delete.
   */
  configDir: (wrapper: string) => string | undefined;
}
```

And the ok arm of `DispatchOutcome` (`:58-65`), adding one field after `spawnState`:

```ts
      /** How that spawn ended, when it recorded anything. `null` = not recorded. */
      spawnState: SpawnVerdict | null;
      /**
       * Whether the session this dispatch just bound has the `ccrc-worker`
       * skill installed on the home it is running from — MEASURED, never
       * assumed, and never a reason to refuse (spec §4, absence-permits). An
       * `absent` dispatch is a real dispatch whose worker will read a brief
       * without its standing protocol; a coordinator reports that to the
       * operator before treating the wave as briefed. `unmeasurable` is not
       * `absent`: nothing was proven about the fleet.
       */
      skillState: SkillState }
```

Add the imports at the top of the file: `import type { SkillState } from '../../../shared/api.js';`
(match the existing relative-depth used by the file's other `shared/` imports — read line 1-20 and copy
it) and `import { readWorkerSkillState } from '../skillstate.js';`.

- [ ] **Step 4: Hoist the wrapper and measure after the commit**

Add one local beside the others at `:214`:

```ts
  let adopted = false; let adoptedSpawn: SpawnVerdict | null = null;
  // The account this session is running on AT DISPATCH, for the skill
  // preflight. `winner`/`record` are block-scoped inside the two arms, so the
  // wrapper is hoisted here rather than the read being done twice. `null` means
  // there is no wrapper to map — which is a real, tolerated case on the resume
  // arm (a session absent from a listable registry) and is `unmeasurable`, never
  // `absent`.
  let wrapper: string | null = null;
```

On the fresh-spawn arm, beside the existing bind at `:376`:

```ts
    sessionId = winner.id; workspace = winner.workspace; branch = winner.branch;
    // Guaranteed measured: the AFTER read above refuses the whole dispatch when
    // any same-project record has `measuredIdentity(r) === null`.
    wrapper = winner.wrapper;
    resumed = false;
```

On the resume arm, beside `:442-443`:

```ts
    workspace = record?.workspace ?? run.workspace;
    branch = record?.branch ?? run.branch;
    // `recordIdentity` is null exactly when `record` is undefined — the
    // tolerated "honest stale" row, which this arm proceeds past on purpose.
    // There is then no wrapper at all, and the preflight says so.
    wrapper = recordIdentity?.wrapper ?? null;
```

Then, immediately after `if (!adv.ok) return { ok: false, kind: 'advanceFailed', adv };` (`:546`) and
BEFORE the brief-as-mail block:

```ts
  // 6b: the skill preflight (spec §4 item 1). MEASURE, NEVER REFUSE.
  //
  // Placed after the commit deliberately, for two reasons that both matter.
  // (a) Ordering: this function's docstring owns a precondition -> irreversible
  // act -> commit sequence, and a read inserted upstream of the commit could
  // only ever delay it. (b) The event row: `recordRunEvent` writes a
  // non-transition row whose `toState` is the run's CURRENT state, and
  // `FleetWatcher.pushNewRuns` tags every push `run-<id>-<toState>`. After the
  // commit that state is `dispatched`, so this row reuses the transition row's
  // own tag instead of minting a second one; before it, the row would have said
  // `planned` and pushed a notification naming a state the run has already left.
  //
  // The row is written on ALL THREE answers, not just the interesting two. If
  // it were written only on absent/unmeasurable, the ABSENCE of a row would mean
  // either `present` or "an older build with no preflight" — a second overloaded
  // null, one layer down from the one this field exists to delete.
  const skillState = await readWorkerSkillState(
    deps.io, wrapper === null ? undefined : deps.configDir(wrapper));
  coord.recordRunEvent(id, 'coordinator', `skill-preflight:${skillState}`);
```

Finally, the return (`:582`):

```ts
  return { ok: true, id, sessionId, resumed, clearedAt, briefQueued, clearError,
    adopted, spawnState: adoptedSpawn, skillState };
```

**Check `recordRunEvent`'s real signature before writing that call** (`server/src/coord/store.ts:469`)
— if its second parameter is not `causedBy`, match the file, and copy the `causedBy` value the two
existing `recordRunEvent` calls in `dispatch.ts` (`:330`, `:369`) use.

- [ ] **Step 5: Wire the port and the wire field in routes.ts**

At the `dispatchRun` call site (`routes.ts:947`), the deps object is built just above it — find where
`dispatchDeps` is constructed and add:

```ts
      // The one place a wrapper becomes a directory, called from L4 where the
      // config already lives (`single-definition.test.ts` requires
      // `configDirFor(` in five named files and permits more).
      configDir: (wrapper: string) => configDirFor(deps.cfg, wrapper),
```

adding `configDirFor` to the existing `../config.js` import in `routes.ts` (check whether that import is
currently type-only; if so, split it into a `import type` line and a value line rather than dropping the
`type` keyword from a line that also imports types).

And in `sendDispatchOutcome` (`:104-113`), extend the unconditional group:

```ts
      // §1.5. UNCONDITIONAL, not spread-when-interesting: the coordinator sees
      // nothing but this JSON, and `adopted:false`/`spawnState:null` is itself the
      // answer to "did that pane come up clean?". Dropping either here would be an
      // L4 adapter narrowing a distinction it received — and
      // `coordinator-skill/references/wave-lifecycle.md` documents both by name.
      //
      // `skillState` joins them on the same terms and for the same reason: a
      // field spread only when it is interesting is indistinguishable, on the
      // wire, from a field an older build never had. Note the compiler does NOT
      // catch a field dropped here — the `_exhaustive: never` guard below is
      // total over the union's MEMBERS, not over one member's fields, so this
      // body would stay green while the distinction silently never shipped.
      adopted: r.adopted, spawnState: r.spawnState, skillState: r.skillState,
```

- [ ] **Step 6: Fix every `DispatchRunDeps` literal in the suite**

Three files construct one. Add the port to each — and give each a comment saying what it models, so a
future reader does not think `() => undefined` is a stub:

- `server/test/dispatch-adopt.test.ts` — its deps use a spread plus `as DispatchRunDeps`, which will
  NOT be a compile error (an `as` assertion permits a missing property) but WILL be a runtime
  `TypeError` when `deps.configDir` is called. Add
  `configDir: (w: string) => configDirFor(base.cfg, w),` and import `configDirFor`.
- `server/test/coord-decide.test.ts` — an explicit literal; the missing property IS a compile error.
  Same addition.
- `server/test/unattended-actor.test.ts` — same.

Run each of the three suites and confirm green before moving on.

- [ ] **Step 7: Pin the wire field and repair the exact-row assertions**

`server/test/run-routes.test.ts` has three assertions that will red because a successful dispatch now
writes two run_event rows instead of one. Find them by running the suite; they are the strict
`toEqual([...])` on `runEvents` after a dispatch, and the `length === 1` check.
`server/test/coord-decide.test.ts` has a fourth.

Repair each by expecting BOTH rows in order, e.g.:

```ts
    expect(w.coord.runEvents(opened.id)).toEqual([
      { at: expect.any(Number), fromState: 'planned', toState: 'dispatched',
        causedBy: 'coordinator', detail: null },
      // The preflight is measured after the commit, so it rests in the state the
      // transition just reached (wave 2, F2).
      { at: expect.any(Number), fromState: 'dispatched', toState: 'dispatched',
        causedBy: 'coordinator', detail: 'skill-preflight:absent' },
    ]);
```

`'skill-preflight:absent'` is the right expectation in those fixtures because no fixture HOME creates a
wrapper config dir — but **run the suite and use what it actually reports**, do not assume.

Then add the wire pin, beside the existing `the 200 body CARRIES adopted and spawnState` test:

```ts
  it('the 200 body CARRIES skillState, on every answer, never spread-when-interesting', async () => {
    // Mutation: delete `skillState: r.skillState` from sendDispatchOutcome and
    // this reds. The compiler will NOT — the exhaustive-never guard is total
    // over the union's members, not over one member's fields.
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home, { wsAddCreates: ['demo-fresh-skill'] });
    const w = await openApp(home, run); app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };
    const res = await postDispatch(app, opened.id);
    const body = res.json() as Record<string, unknown>;
    expect(Object.keys(body)).toContain('skillState');
    expect(isSkillState(body.skillState)).toBe(true);
    // No fixture home carries an installed skill, so the honest answer here is
    // `absent` — and `absent` reaching the wire at all is the point: an omitted
    // field and a measured absence would otherwise be one value.
    expect(body.skillState).toBe('absent');
  });
```

importing `isSkillState` from `../../shared/api.js`.

- [ ] **Step 8: Run the affected suites and verify GREEN**

```bash
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run \
  test/dispatch-skillstate.test.ts test/dispatch-adopt.test.ts test/coord-decide.test.ts \
  test/unattended-actor.test.ts test/run-routes.test.ts test/dispatch-mutex-gate.test.ts \
  test/typecheck-tests.test.ts
```

Expected: PASS, all seven. If `typecheck-tests` fails, read its output — it spawns
`tsc -p test/tsconfig.tests.json --noEmit` over every test file and a type error anywhere reds it.

- [ ] **Step 9: Measure the mutation table**

One at a time, run `test/dispatch-skillstate.test.ts` (and `test/run-routes.test.ts` for #3), record the
failing assertion, REVERT:

1. Delete the `coord.recordRunEvent(...)` line.
   Expect: *records the measurement on the run trail* and *writes the preflight row* fail.
2. Change the preflight to `deps.configDir(wrapper ?? '')` (collapsing the no-wrapper case into a
   lookup that will simply miss). Expect: the unrostered test still passes — **it must not**; that is
   why the test asserts through the PORT returning `undefined`, not through a bogus wrapper string.
   Record what actually happens and, if this mutation survives, add the assertion that kills it.
3. Delete `skillState: r.skillState` from `sendDispatchOutcome`.
   Expect: *the 200 body CARRIES skillState* fails; nothing else does, and the build compiles — which
   is the finding that comment in Step 5 records.
4. Move the preflight block ABOVE `const adv = coord.dispatchRun(...)`.
   Expect: *writes the preflight row with the state the run already rests in* fails on
   `toState === 'planned'`.

- [ ] **Step 10: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add server/src/coord/dispatch.ts server/src/coord/routes.ts server/test/
git commit -m "feat(wave2): dispatch measures the worker skill and reports it, never refuses

skillState rides the dispatch response additively beside spawnState, with one
run_events row per dispatch on all three answers. The configDir derivation is a
consumer-declared port rather than a value import of config.js, which imports
coord/db.js (D-1015)."
```

---

## Task 3: The coordinator's reference documents `skillState`

**Files:**
- Modify: `server/test/coordinator-skill.test.ts` (extend the dispatch-response describe) — FIRST
- Modify: `ccd/coordinator-skill/references/wave-lifecycle.md` (the §2 `####` block)

**Interfaces:**
- Consumes: the field names and values Task 2 shipped.
- Produces: nothing code-facing. This task's output is prose a live coordinator reads and a pin that
  keeps it true.

- [ ] **Step 1: Write the pin FIRST and measure its red**

Extend `describe('the dispatch response documents that ok is not proof of a ready pane')` in
`server/test/coordinator-skill.test.ts` with one new `it`. Use the file's own BLOCK-SCOPED idiom so the
pin cannot be satisfied by the word appearing three sections away, and its `flat()` helper because the
table cell wraps:

```ts
  it('names skillState and all three of its answers, and says absent does not refuse', () => {
    const wl = refs('wave-lifecycle.md');
    expect(wl, 'the dispatch-response table does not name skillState').toContain('skillState');
    // Block-scoped: the three words must be IN the response block, not merely
    // somewhere in a 500-line file.
    const start = wl.indexOf('#### An `ok:true` dispatch is no longer proof');
    expect(start, 'the dispatch-response block is gone or renamed').toBeGreaterThan(-1);
    const block = flat(wl.slice(start, wl.indexOf('\n## ', start)));
    for (const word of ['present', 'absent', 'unmeasurable']) {
      expect(block, `the dispatch-response block omits skillState's '${word}' answer`)
        .toContain(word);
    }
    // The distinction is the whole feature: a reader who takes `unmeasurable`
    // for `absent` will go install a skill that is already there, and a reader
    // who takes `absent` for a refusal will re-dispatch a wave that dispatched.
    expect(block, 'the block does not say unmeasurable is not absent')
      .toMatch(/unmeasurable[\s\S]{0,200}?(is not|never)[\s\S]{0,40}?absent/i);
    expect(block, 'the block does not say the preflight never refuses a dispatch')
      .toMatch(/never refuses|does not refuse|still dispatch/i);
    // The count sentence: three rows, not two. Nothing else pins this, which is
    // why it drifted into a lie the moment a third field shipped (D-1014).
    expect(block, 'the lead-in still promises two fields').not.toMatch(/\btwo fields\b/);
    expect(block).toMatch(/\bthree fields\b/);
    // The run-event trail, the same way `adopted` documents its own.
    expect(flat(wl)).toContain('skill-preflight:');
  });
```

- [ ] **Step 2: Run it and record the RED**

```bash
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts
```

Expected: FAIL on the first assertion — `the dispatch-response table does not name skillState`.

- [ ] **Step 3: Edit the reference**

In `ccd/coordinator-skill/references/wave-lifecycle.md`, change the lead-in sentence (currently
"`POST /api/runs/:id/dispatch` answers with two fields beyond the ones above:") to say **three**, add
one table row after the `spawnState` row, and add one bullet to the "What to do with them." block.

STRAIGHT apostrophes only. No `ws-rm`/`ws-reap`/`ws-gc`. No `METHOD /api/path` string that is not
already in the file. No second fenced `json` block mentioning `branchTip`.

The new table row:

```
| `skillState` | whether the worker session this dispatch bound has the `ccrc-worker` skill installed on the home it is running from: `present`, `absent`, or `unmeasurable`. MEASURED at dispatch, and never a refusal — an `absent` dispatch is a real dispatch. `unmeasurable` is not `absent`: it means the measurement failed (no config dir for that account on this box, or a read that would not complete), so nothing was proven about the fleet either way. |
```

The new bullet, in the `**What to do with them.**` list, matching the existing `spawnState` bullets'
shape:

```
- `skillState: 'absent'` — the worker will read your brief without its standing protocol, because the
  skill installer has not run on that account's home. The dispatch still happened and the brief still
  works, degraded: it carries the branch-discipline sentence in its own text for exactly this case.
  **Report it to the operator before you treat the wave as briefed** — an installer run is a human act,
  and every later wave on that home has the same gap until it happens.
- `skillState: 'unmeasurable'` — say so as an unknown, not as a problem. Nothing was measured, so do
  not go looking for a missing install and do not re-dispatch: the wave is briefed either way.
```

And beside the existing `spawn-adopted:<spawnState>` sentence, add the second trail note:

```
Every dispatch also writes its preflight to the run's event trail as `skill-preflight:<skillState>` —
on all three answers, so a trail with no such line means an older build, never a healthy home.
```

- [ ] **Step 4: Run the suite and verify GREEN**

```bash
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run \
  test/coordinator-skill.test.ts test/auth-passkey.test.ts test/ccrc-api-closed.test.ts \
  test/wrapper-roster-fixture.test.ts test/topology-clean.test.ts
```

Expected: PASS, all five. `auth-passkey` is the corpus route sweep, `ccrc-api-closed` the no-`curl`
scan, `wrapper-roster-fixture` the installer's `REQUIRED_REFS` pin (unchanged — this wave adds no new
reference FILE), `topology-clean` the role-vocabulary scan.

- [ ] **Step 5: Measure the mutation table**

One at a time, run `test/coordinator-skill.test.ts`, record, REVERT:

1. Delete the `skillState` table row. Expect: the new `it` fails on `toContain('skillState')`.
2. Restore "two fields" in the lead-in. Expect: it fails on `.not.toMatch(/\btwo fields\b/)`.
3. Delete the `unmeasurable` bullet only. Expect: it fails on the `unmeasurable … is not … absent`
   proximity regex — **verify this**, because the word also appears in the table row; if the mutation
   survives, the pin is too weak and the regex must be scoped to the bullet list instead.
4. Delete the `skill-preflight:` sentence. Expect: it fails on the last assertion.

- [ ] **Step 6: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add ccd/coordinator-skill/references/wave-lifecycle.md server/test/coordinator-skill.test.ts
git commit -m "docs(wave2): the dispatch-response table documents skillState

Three fields, not two (D-1014 — the count sentence was unpinned and became a
lie the moment a third field shipped). Per-value operator guidance matches the
spawnState bullets: report absent before treating the wave as briefed, and say
unmeasurable as an unknown rather than a problem."
```

---

## Task 4: Lift the ledger document reader out of the watcher

**Files:**
- Create: `server/src/coord/ledgerseed.ts`
- Modify: `server/src/watch.ts` (delete the private `readLedgerDocs`; rewire `sweepLedgerFloor` and
  `sweepLedgerReconcile`)
- Test: `server/test/ledgerseed.test.ts` (create)

**Interfaces:**
- Consumes: `FleetIO` (`readdir`, `readFile`), `floorFromScan`/`LedgerFloorScan` from
  `server/src/coord/ledger.ts`.
- Produces:
  - `const LEDGER_SEED_BUDGET_MS = 10_000`
  - `interface LedgerSeedDeps { io: Pick<FleetIO,'readdir'|'readFile'>; projectsRoot: string; now?: () => number; budgetMs?: number }`
  - `type LedgerDocsRead = { complete: boolean; files: readonly { path: string; text: string }[] }`
  - `async function readLedgerDocs(deps: LedgerSeedDeps, project: string, dirs: readonly string[]): Promise<LedgerDocsRead>`
  - `type FloorMeasurement = { ok: true; scan: LedgerFloorScan } | { ok: false; why: 'no-refs' } | { ok: false; why: 'unmeasurable' }`
  - `async function measureLedgerFloor(deps: LedgerSeedDeps, project: string): Promise<FloorMeasurement>`
  - `function isSafeProjectSegment(project: string): boolean`

- [ ] **Step 1: Write the failing test**

Create `server/test/ledgerseed.test.ts`. **Every `D-` ref in a fixture is spelled SPLIT** — a contiguous
one reds `deviation-refs.test.ts` and, because the live floor only ever rises, would poison the fleet's
own seed.

```ts
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { localIO } from '../src/io.js';
import type { FleetIO } from '../src/io.js';
import {
  isSafeProjectSegment, measureLedgerFloor, readLedgerDocs,
} from '../src/coord/ledgerseed.js';

const REF = (n: number): string => `D-${n}`;   // SPLIT, never a contiguous literal

const fixture = () => {
  const projectsRoot = mkTmp('ccrc-ledgerseed-');
  const plant = (project: string, dir: string, name: string, text: string): string => {
    const d = path.join(projectsRoot, project, 'docs', 'superpowers', dir);
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, name), text);
    return path.join(d, name);
  };
  return { projectsRoot, plant, deps: { io: localIO, projectsRoot } };
};

describe('measureLedgerFloor — the sweep measurement, standalone and bounded', () => {
  it('measures a floor from plans and specs together', async () => {
    const f = fixture();
    f.plant('demo', 'plans', 'a.md', `### ${REF(211)} something`);
    f.plant('demo', 'specs', 'b.md', `bullet ${REF(240)}`);
    const m = await measureLedgerFloor(f.deps, 'demo');
    expect(m).toMatchObject({ ok: true });
    // floorFromScan owns the gap arithmetic (LEDGER_SEED_GAP = 50).
    expect((m as { scan: { floor: number } }).scan.floor).toBe(240 + 50);
  });

  it('answers no-refs when the documents are measured and carry no global D-ref', async () => {
    const f = fixture();
    f.plant('demo', 'plans', 'a.md', 'a plan with nothing numbered in it');
    expect(await measureLedgerFloor(f.deps, 'demo')).toEqual({ ok: false, why: 'no-refs' });
  });

  it('answers no-refs, not unmeasurable, for a project with a docs tree and no plans dir', async () => {
    // A dir the PARENT listing does not name is genuinely absent. That is a
    // measurement, and it must not be reported as a failure to measure.
    const f = fixture();
    f.plant('demo', 'specs', 'b.md', 'nothing numbered');
    expect(await measureLedgerFloor(f.deps, 'demo')).toEqual({ ok: false, why: 'no-refs' });
  });

  it('answers unmeasurable when the docs tree itself will not list', async () => {
    const f = fixture();
    expect(await measureLedgerFloor(f.deps, 'no-such-project'))
      .toEqual({ ok: false, why: 'unmeasurable' });
  });

  it('answers unmeasurable when a dir the parent NAMED will not list', async () => {
    const f = fixture();
    f.plant('demo', 'plans', 'a.md', `### ${REF(211)} x`);
    const io: FleetIO = {
      ...localIO,
      readdir: async (p: string) => (p.endsWith(`${path.sep}plans`) ? null : localIO.readdir(p)),
    };
    expect(await measureLedgerFloor({ ...f.deps, io }, 'demo'))
      .toEqual({ ok: false, why: 'unmeasurable' });
  });

  it('answers unmeasurable when ANY listed file could not be read', async () => {
    // THE safety property. A partial scan seeds a floor lower than the truth,
    // the floor only ever rises, and the numbers minted from a low floor
    // COLLIDE with D-refs sitting in the file that was skipped. Reissuing a
    // number once cost 394 rewritten D-ref lines across 30 files; under-seeding
    // is not "the safe direction" here, it is the failure.
    const f = fixture();
    f.plant('demo', 'plans', 'a.md', `### ${REF(211)} x`);
    f.plant('demo', 'plans', 'b.md', `### ${REF(9000)} much higher`);
    const io: FleetIO = {
      ...localIO,
      readFile: async (p: string) => (p.endsWith('b.md') ? null : localIO.readFile(p)),
    };
    expect(await measureLedgerFloor({ ...f.deps, io }, 'demo'))
      .toEqual({ ok: false, why: 'unmeasurable' });
  });

  it('answers unmeasurable when the budget expires mid-walk, and never seeds a partial scan', async () => {
    const f = fixture();
    for (const n of ['a', 'b', 'c']) f.plant('demo', 'plans', `${n}.md`, `### ${REF(211)} x`);
    let t = 0;
    const m = await measureLedgerFloor(
      { ...f.deps, budgetMs: 5, now: () => (t += 10) }, 'demo');
    expect(m).toEqual({ ok: false, why: 'unmeasurable' });
  });

  it('refuses a project segment that could walk out of projectsRoot, without touching the fs', async () => {
    for (const bad of ['..', '../etc', 'a/b', '.', '', 'a\0b']) {
      expect(isSafeProjectSegment(bad), bad).toBe(false);
    }
    for (const good of ['demo', 'ccrc-pwa', 'a.b_c-1']) {
      expect(isSafeProjectSegment(good), good).toBe(true);
    }
    const f = fixture();
    expect(await measureLedgerFloor(f.deps, '../..'))
      .toEqual({ ok: false, why: 'unmeasurable' });
  });
});

describe('readLedgerDocs — what the watcher keeps using', () => {
  it('reports completeness separately from content, so two callers can differ', async () => {
    const f = fixture();
    f.plant('demo', 'plans', 'a.md', `### ${REF(211)} x`);
    f.plant('demo', 'plans', 'b.md', 'x');
    const io: FleetIO = {
      ...localIO,
      readFile: async (p: string) => (p.endsWith('b.md') ? null : localIO.readFile(p)),
    };
    const r = await readLedgerDocs({ ...f.deps, io }, 'demo', ['plans']);
    // The watcher takes the files and tolerates the gap (its hourly next pass
    // raises the floor); the inline seed refuses. One reader, two policies.
    expect(r.files).toHaveLength(1);
    expect(r.complete).toBe(false);
  });

  it('sorts names so the evidence string is deterministic', async () => {
    const f = fixture();
    f.plant('demo', 'plans', 'z.md', `### ${REF(300)} z`);
    f.plant('demo', 'plans', 'a.md', `### ${REF(300)} a`);
    const r = await readLedgerDocs(f.deps, 'demo', ['plans']);
    expect(r.files.map((x) => x.path)).toEqual([
      'docs/superpowers/plans/a.md', 'docs/superpowers/plans/z.md',
    ]);
  });
});
```

- [ ] **Step 2: Run it and record the RED**

```bash
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/ledgerseed.test.ts
```

Expected: FAIL — `Failed to resolve import "../src/coord/ledgerseed.js"`.

- [ ] **Step 3: Create the module**

`server/src/coord/ledgerseed.ts`:

```ts
import type { FleetIO } from '../io.js';
import { floorFromScan, type LedgerFloorScan } from './ledger.js';

/**
 * The floor measurement, lifted out of `FleetWatcher` so a request can run it.
 *
 * L1-with-ports, in `coord/dispatch.ts`'s shape: consumer-declared deps, real
 * IO through them, a typed union out, no `reply` and no clock of its own. It
 * imports neither `./db.js` nor `node:sqlite` and names no store handle — the
 * coord ring's own rule. The DECISION about what to do with each answer belongs
 * to the caller, and the two callers decide DIFFERENTLY on purpose (see
 * `LedgerDocsRead.complete`).
 */

/**
 * A wall-clock budget for the walk, checked BETWEEN files — `inject/send.ts`'s
 * `CLEAR_BUDGET_MS` idiom, and the same honesty about what it does and does
 * not bound. It bounds the WALK, not one read: in remote fleet mode a single
 * `readFile` is a WS round trip with its own 15 s ceiling and no knob below
 * this layer, so one pathological file can overrun this budget by that much.
 * What it does buy is that a 100-file corpus cannot hold a request open for
 * the sum of those ceilings. Measured locally at ~53 ms for ccrc's own 100
 * files, so this is roughly 200x headroom on the local path.
 */
export const LEDGER_SEED_BUDGET_MS = 10_000;

export interface LedgerSeedDeps {
  io: Pick<FleetIO, 'readdir' | 'readFile'>;
  projectsRoot: string;
  /** Injectable so a test can prove the budget bounds the walk without spending it. */
  now?: () => number;
  budgetMs?: number;
}

export interface LedgerDoc { readonly path: string; readonly text: string }

/**
 * `complete` is the field that lets one reader serve two policies. The hourly
 * sweep takes whatever it got and seeds from it — a floor it under-measures is
 * raised by the next pass, and the 50-number gap usually absorbs the drift. A
 * SYNCHRONOUS seed cannot reason that way: it mints numbers immediately, from
 * a floor that only ever rises, so a scan missing the file with the highest
 * ref hands out numbers that are already in use. Under-seeding is only "the
 * safe direction" when something else will come along and raise it.
 */
export interface LedgerDocsRead {
  readonly complete: boolean;
  readonly files: readonly LedgerDoc[];
}

export type FloorMeasurement =
  | { readonly ok: true; readonly scan: LedgerFloorScan }
  /** Measured, and there is no global `D-<n>` anywhere to seed from. */
  | { readonly ok: false; readonly why: 'no-refs' }
  /** No answer was obtained: a listing failed, a file would not read, the budget expired, or the name was unsafe. */
  | { readonly ok: false; readonly why: 'unmeasurable' };

/**
 * The project name reaches this module from an HTTP body and is interpolated
 * into a path, so it is validated as a single path SEGMENT before any walk
 * (D-1017). The box token gates the route, but a token is a credential, not a
 * sandbox, and this tree's own rule is that the HTTP chokepoint is a contract
 * rather than an OS wall.
 */
export function isSafeProjectSegment(project: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(project) && project !== '.' && project !== '..';
}

/**
 * Absent and unreadable collapse in `readdir` (D-114 — there is no measured
 * variant, and adding one is an agent protocol change), so this walks the
 * PARENT first and uses its listing as the evidence ladder, the same shape
 * `registry.ts` uses for a field that is listed but will not read: a dir the
 * parent does not name is genuinely absent and contributes nothing; a dir the
 * parent DOES name and that then will not list is a failure, and says so.
 */
export async function readLedgerDocs(
  deps: LedgerSeedDeps, project: string, dirs: readonly string[],
): Promise<LedgerDocsRead> {
  const now = deps.now ?? Date.now;
  const budget = deps.budgetMs ?? LEDGER_SEED_BUDGET_MS;
  const deadline = now() + budget;

  const root = `${deps.projectsRoot}/${project}/docs/superpowers`;
  const listing = await deps.io.readdir(root);
  if (listing === null) return { complete: false, files: [] };

  const files: LedgerDoc[] = [];
  for (const d of dirs) {
    if (!listing.includes(d)) continue;             // genuinely absent — measured, contributes nothing
    const dir = `${root}/${d}`;
    const names = await deps.io.readdir(dir);
    if (names === null) return { complete: false, files };
    for (const n of [...names].sort()) {
      if (!n.endsWith('.md')) continue;
      if (now() > deadline) return { complete: false, files };
      const text = await deps.io.readFile(`${dir}/${n}`);
      if (text === null) return { complete: false, files };
      files.push({ path: `docs/superpowers/${d}/${n}`, text });
    }
  }
  return { complete: true, files };
}

/** The dirs the floor is measured from. Named once; both callers read it. */
export const LEDGER_FLOOR_DIRS: readonly string[] = ['plans', 'specs'];

export async function measureLedgerFloor(
  deps: LedgerSeedDeps, project: string,
): Promise<FloorMeasurement> {
  if (!isSafeProjectSegment(project)) return { ok: false, why: 'unmeasurable' };
  const read = await readLedgerDocs(deps, project, LEDGER_FLOOR_DIRS);
  if (!read.complete) return { ok: false, why: 'unmeasurable' };
  const scan = floorFromScan(read.files);
  return scan === null ? { ok: false, why: 'no-refs' } : { ok: true, scan };
}
```

**Check `floorFromScan`'s parameter type before writing this** — if it takes a mutable array rather
than a `readonly` one, pass `[...read.files]`.

- [ ] **Step 4: Rewire the watcher, holding its behaviour constant**

In `server/src/watch.ts`, DELETE the private `readLedgerDocs` method (`:1913-1931`) and import the free
function. Both call sites keep the watcher's existing tolerance — this task must not change what the
sweep does:

```ts
      const read = await readLedgerDocs(
        { io: this.deps.io, projectsRoot: this.deps.cfg.projectsRoot },
        project, LEDGER_FLOOR_DIRS);
      // The watcher's own policy, unchanged and deliberately different from the
      // synchronous seed's: it takes what it got. A dir that would not list, or
      // a file that would not read, contributes nothing and the floor it
      // measures may be low — which the NEXT hourly pass raises, because
      // `raiseLedgerFloor` only ever raises. Nothing downstream of this call
      // mints a number, so a low floor here costs a delay, not a collision.
      // `readLedgerDocs` reports `complete:false` for both cases and this lane
      // ignores it ON PURPOSE (D-1018 records that the 50-number gap does not
      // actually bound the error, and defers it).
      if (read.files.length === 0 && !read.complete) continue;
      const scan = floorFromScan(read.files);
      if (scan === null) continue;      // no global D-ref anywhere: nothing to seed, fail shut
      store.raiseLedgerFloor(project, scan.floor, scan.evidence, now);
```

and the reconcile call site the same way with `['plans']` in place of `LEDGER_FLOOR_DIRS`.

**The old contract was `null` = NEITHER dir listed, and the new one is `complete:false` + possibly some
files.** Those are not the same predicate: the old code skipped the project when neither dir listed,
and the new `read.files.length === 0 && !read.complete` reproduces it only when the parent listing also
failed. Run `test/ledger-sweep.test.ts` and let it arbitrate — in particular its *a project with NO docs
seeds nothing* case. If the reproduction is not exact, prefer changing the call site until that suite is
green UNCHANGED; do not edit that suite in this task.

- [ ] **Step 5: Run and verify GREEN**

```bash
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run \
  test/ledgerseed.test.ts test/ledger-sweep.test.ts test/ledger.test.ts \
  test/single-definition.test.ts test/deviation-refs.test.ts
```

Expected: PASS, all five. `ledger-sweep.test.ts` must pass **without being edited** — it is the proof
the lift changed no behaviour. `deviation-refs.test.ts` is the proof no fixture ref leaked into the
tracked tree's max.

- [ ] **Step 6: Measure the mutation table**

One at a time, run `test/ledgerseed.test.ts`, record, REVERT:

1. Change `if (text === null) return { complete: false, files };` to `continue`.
   Expect: *answers unmeasurable when ANY listed file could not be read* fails.
2. Delete the `now() > deadline` check.
   Expect: *answers unmeasurable when the budget expires mid-walk* fails.
3. Change `if (!listing.includes(d)) continue;` to `return { complete: false, files }`.
   Expect: *answers no-refs, not unmeasurable, for a project with a docs tree and no plans dir* fails.
4. Delete the `isSafeProjectSegment` guard.
   Expect: *refuses a project segment that could walk out of projectsRoot* fails on the
   `measureLedgerFloor(f.deps, '../..')` assertion.

- [ ] **Step 7: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add server/src/coord/ledgerseed.ts server/src/watch.ts server/test/ledgerseed.test.ts
git commit -m "refactor(wave2): the floor measurement is a free bounded function, not a watcher method

One reader, two policies: the hourly sweep tolerates a partial scan (its next
pass raises the floor), a synchronous seed refuses one (it mints numbers now,
and a low floor collides). Parent-listing evidence ladder tells an absent dir
from one that would not list, around readdir's collapse (D-114)."
```

---

## Task 5: The allocator seeds its own floor

**Files:**
- Modify: `server/test/ledger-routes.test.ts` (add four tests) — FIRST
- Modify: `server/src/coord/routes.ts` (the `POST /api/ledger/deviations` handler and its docstring)
- Modify: `ccd/coordinator-skill/references/peer-protocol.md` (the allocator paragraph)
- Modify: `server/test/coordinator-skill.test.ts` (one new pin, written before the prose)

**Interfaces:**
- Consumes: `measureLedgerFloor`, `FloorMeasurement` from Task 4; `CoordStore.raiseLedgerFloor`.
- Produces: no shape change. `201 {ok, numbers, floor}` and `409 {ok:false, error:'not-seeded', detail}`
  are both unchanged in shape; only `detail`'s text and the conditions under which the 409 is reached
  move.

- [ ] **Step 1: Write the four failing tests**

Add to `server/test/ledger-routes.test.ts`, reusing its own `openApp()`/`alloc()` fixture — read them
first and match. Fixture `D-` refs SPLIT, as always.

```ts
  it('SEEDS ITSELF on a fresh project and allocates on the first call', async () => {
    // The stall this feature deletes: before, the first program on every new
    // project waited up to an hour for the sweep, and the coordinator's own
    // pinned contract told it to report and not invent.
    const home = mkTmp('ccrc-ledger-seed-');
    const dir = path.join(home, 'projects', 'fresh', 'docs', 'superpowers', 'plans');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'p.md'), `### ${'D-' + '410'} a real one`);
    const w = await openApp(home); app = w.app;
    const res = await alloc(app, { project: 'fresh', count: 3, title: 'block' });
    expect(res.statusCode).toBe(201);
    // floorFromScan owns the gap; 410 + LEDGER_SEED_GAP.
    expect(res.json()).toMatchObject({ ok: true, numbers: [460, 461, 462] });
    // And it PERSISTED — the second call does not re-measure to get the same answer.
    expect(w.coord.ledgerFloor('fresh')?.floor).toBe(460);
  });

  it('still answers 409 not-seeded when the measurement itself fails', async () => {
    // The refusal survives, narrowed. `claims-envelope.test.ts` also requires
    // the producer literal to stay in this file.
    const home = mkTmp('ccrc-ledger-seed-');
    const w = await openApp(home, { io: { ...localIO, readdir: async () => null } }); app = w.app;
    const res = await alloc(app, { project: 'fresh', count: 3, title: 'block' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, error: 'not-seeded' });
    expect((res.json() as { detail: string }).detail).toMatch(/could not be measured|unmeasurable/i);
    expect(w.coord.ledgerFloor('fresh')).toBeNull();
  });

  it('answers 409 with a DIFFERENT detail when the docs are measured and carry no D-ref', async () => {
    // Two conditions, two sentences. Both refuse — there is no floor to seed
    // from either way — but "I could not look" and "I looked and there is
    // nothing" are different facts and an operator acts on them differently.
    const home = mkTmp('ccrc-ledger-seed-');
    const dir = path.join(home, 'projects', 'fresh', 'docs', 'superpowers', 'plans');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'p.md'), 'a plan with nothing numbered in it');
    const w = await openApp(home); app = w.app;
    const res = await alloc(app, { project: 'fresh', count: 3, title: 'block' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, error: 'not-seeded' });
    expect((res.json() as { detail: string }).detail).toMatch(/no .*D-|nothing numbered|no deviation/i);
    expect((res.json() as { detail: string }).detail)
      .not.toMatch(/could not be measured|unmeasurable/i);
  });

  it('a bad count is still refused FIRST, and never runs a filesystem walk', async () => {
    // decideAllocation checks bad-count before not-seeded, deliberately, and
    // ledger.test.ts pins it. Seeding before the allocator runs would spend a
    // scan on a request that could never be served.
    const home = mkTmp('ccrc-ledger-seed-');
    const dir = path.join(home, 'projects', 'fresh', 'docs', 'superpowers', 'plans');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'p.md'), `### ${'D-' + '410'} a real one`);
    const reads: string[] = [];
    const io = { ...localIO, readdir: async (p: string) => { reads.push(p); return localIO.readdir(p); } };
    const w = await openApp(home, { io }); app = w.app;
    const res = await alloc(app, { project: 'fresh', count: 0, title: 'block' });
    expect(res.statusCode).toBe(400);
    expect(reads.filter((p) => p.includes('superpowers'))).toEqual([]);
    expect(w.coord.ledgerFloor('fresh')).toBeNull();
  });
```

**`openApp` may not accept an `over` argument today** — check `ledger-routes.test.ts`'s own fixture. If
it does not, extend it the way `run-routes.test.ts`'s `openApp(home, run, over)` does (an optional
partial merged into `buildServer`'s deps), in this step, and say so in the commit.

- [ ] **Step 2: Run and record the RED**

```bash
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/ledger-routes.test.ts
```

Expected: FAIL — the first test gets 409, not 201.

- [ ] **Step 3: Change the route**

In `server/src/coord/routes.ts`, inside the `POST /api/ledger/deviations` handler, replace
`const r = allocate();` and the `not-seeded` case:

```ts
    // SYNCHRONOUS SEED (spec §4 item 2). Allocate FIRST, and reach for the
    // filesystem only once the allocator has said the one thing a seed can
    // answer. That ordering is not an optimisation: `decideAllocation` checks
    // `bad-count` BEFORE `not-seeded` deliberately, so that a caller with both
    // defects learns the one it can fix this instant — and seeding up front
    // would spend a document walk on a request that could never be served, and
    // would put a second copy of the count predicate in L4 to avoid it.
    let r = allocate();
    let seedFailure: FloorMeasurement | null = null;
    if (!r.ok && r.why === 'not-seeded') {
      const m = await measureLedgerFloor(
        { io: deps.io, projectsRoot: deps.cfg.projectsRoot }, project.trim());
      if (m.ok) {
        // `raiseLedgerFloor` only ever raises, in SQL rather than by
        // discipline, so this is safe to run concurrently and repeatedly; a
        // racing sweep that got there first simply wins.
        coord.raiseLedgerFloor(project.trim(), m.scan.floor, m.scan.evidence, Date.now());
        r = allocate();
      } else {
        seedFailure = m;
      }
    }
```

and the refusal arm:

```ts
      case 'not-seeded':
        return reply.code(409).send({ ok: false, error: 'not-seeded',
          detail: seedFailure !== null && seedFailure.why === 'no-refs'
            ? `no floor for ${project.trim()} — its docs/superpowers/{plans,specs} were read and ` +
              'name no D-<n> at all, so there is nothing to seed from; the allocator fails shut ' +
              'rather than minting from a guess (D13)'
            : `no floor for ${project.trim()} — it could not be measured (the docs tree would not ` +
              'list, a file would not read, or the walk ran out of budget), so nothing was proven ' +
              'either way; the allocator fails shut rather than minting from a guess (D13)' });
```

**Note the polarity of that ternary.** `seedFailure` is `null` in exactly two cases: the seed was never
attempted (impossible on this arm — `not-seeded` is what triggers it), or the seed SUCCEEDED and the
retry still refused `not-seeded` (a lost race in which another writer raised then something cleared it —
vanishingly unlikely, and "could not be measured" is the honest thing to say about it). Do not invert it
to default to the `no-refs` sentence: that would claim a completed measurement that may never have run.

Update the handler's docstring — it currently asserts *"No `coordMutex`: the decision and the commit
are one synchronous store call with no await between them"*, which this change makes false:

```ts
   * No `coordMutex`, still — but the reason has narrowed. There IS now an await
   * on this path (the synchronous floor seed), and it sits BETWEEN two
   * `allocate()` calls rather than inside one: each call is still a single
   * synchronous store transaction with nothing awaited inside it, which is the
   * property that mattered. What the seed adds between them is idempotent by
   * construction — `raiseLedgerFloor` only ever raises — so a racing writer
   * costs a retry, never a wrong number.
```

Add the imports: `measureLedgerFloor` and `type FloorMeasurement` from `./ledgerseed.js`, and
`configDirFor` if Task 2 has not already added it.

- [ ] **Step 4: Run and verify GREEN**

```bash
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run \
  test/ledger-routes.test.ts test/ledger-store.test.ts test/ledger-race.test.ts \
  test/ledger.test.ts test/ledger-sweep.test.ts test/claims-envelope.test.ts
```

Expected: PASS, all six. `ledger-routes.test.ts`'s ORIGINAL *refuses 409 not-seeded before the floor
sweep has scanned the project* test must still pass — it survives because `testDeps`'s `projectsRoot` is
`<home>/projects` with no docs tree, so the measurement legitimately fails. **If that test now returns
201, stop: the seed is guessing a floor from an unmeasured project, which is the exact failure the
allocator exists to prevent.**

- [ ] **Step 5: Write the peer-protocol pin, then the prose**

The `409 not-seeded` sentence in `ccd/coordinator-skill/references/peer-protocol.md` is unpinned today.
Add to `describe('the peer protocol reference (Build 9 wave 8, D17)')` in
`server/test/coordinator-skill.test.ts`, FIRST:

```ts
    it('does not tell a coordinator to wait an hour for a sweep that no longer gates it', () => {
      const p = flat(pp());
      // The stall is gone: the first allocation on a fresh project measures the
      // floor itself. Prose promising an hourly wait would send a coordinator
      // away from a door that is now open.
      expect(p, 'peer-protocol.md still promises an hourly floor sweep')
        .not.toMatch(/hourly floor sweep has not yet/);
      expect(p, 'peer-protocol.md does not say the allocator seeds itself')
        .toMatch(/seeds? (its own |the )?floor|measures the floor itself/i);
      // Both refusal conditions still say "report, do not invent" — the refusal
      // narrowed, it did not go away.
      expect(p).toMatch(/report it, do not invent/);
    });
```

Run it, record the RED (`peer-protocol.md still promises an hourly floor sweep`), then rewrite the
sentence. STRAIGHT apostrophes; no destructive verb; no new `METHOD /api/path` spelling; no `curl` in a
fence:

```
`409 not-seeded` no longer means "wait for the sweep". The first allocation on a project measures the
floor itself, from that project's own `docs/superpowers/{plans,specs}`, and proceeds. The refusal now
means one of two things, and the `detail` says which: the documents were read and name no `D-<n>` at
all, so there is nothing to seed from; or they could not be measured, so nothing was proven either way.
Report it, do not invent — a number you mint from a guess is the reissue this allocator exists to
delete.
```

- [ ] **Step 6: Run the corpus suites and verify GREEN**

```bash
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run \
  test/coordinator-skill.test.ts test/auth-passkey.test.ts test/ccrc-api-closed.test.ts \
  test/topology-clean.test.ts test/worker-skill.test.ts
```

- [ ] **Step 7: Measure the mutation table**

One at a time, run the named suite, record, REVERT:

1. Delete the whole `if (!r.ok && r.why === 'not-seeded') { … }` block.
   Expect (`ledger-routes`): *SEEDS ITSELF on a fresh project* fails with 409.
2. Move the seed block ABOVE `let r = allocate();` and run it unconditionally.
   Expect (`ledger-routes`): *a bad count is still refused FIRST, and never runs a filesystem walk*
   fails on the non-empty `reads` array.
3. Collapse the two 409 details into one string.
   Expect (`ledger-routes`): *answers 409 with a DIFFERENT detail* fails on its `.not.toMatch`.
4. Restore the old `peer-protocol.md` sentence.
   Expect (`coordinator-skill`): the new peer-protocol pin fails.

- [ ] **Step 8: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add server/src/coord/routes.ts server/test/ledger-routes.test.ts \
  server/test/coordinator-skill.test.ts ccd/coordinator-skill/references/peer-protocol.md
git commit -m "feat(wave2): the allocator seeds its own floor on a fresh project

Allocate first, seed only on not-seeded, retry once — so decideAllocation's
bad-count-masks-not-seeded ordering stays the single authority and no request
that could never be served spends a document walk. The 409 survives for two
distinct conditions and says which (D-1016)."
```

---

## Task 6: Whole-branch verification and the handoff

**Files:** none changed by default; this task is measurement and the deviation ledger.

- [ ] **Step 1: Run all three suites in full, in the FOREGROUND**

```bash
cd "$(git rev-parse --show-toplevel)/server" && npm run test
cd "$(git rev-parse --show-toplevel)/agent"  && npm run test
cd "$(git rev-parse --show-toplevel)/pwa"    && npm run test
```

Each with a tool timeout of at least 600000 ms. Record the pass counts.

**Known load flakes — re-run IN ISOLATION before calling any of these a real break:** `ccd-ws-gc`,
`pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`. A flake that passes in isolation is
a flake. `ccd-session-state`'s window is
`expected ['mid-carry:orphan'] to include 'mid-carry:restarting'` and a single green isolated run is not
proof it was the load.

- [ ] **Step 2: Confirm the two features are actually reachable together**

```bash
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run \
  test/single-definition.test.ts test/deviation-refs.test.ts test/dtbd.test.ts \
  test/topology-clean.test.ts test/node-floor.test.ts
```

`deviation-refs` is the one to read carefully: it requires the highest `D-<n>` token anywhere in the
tracked tree to EQUAL the highest defined by a plan heading or bullet. After this wave that is the
highest number defined in `## Deviations found` below.

- [ ] **Step 3: Fill in the execution record**

Append an `## Execution record (measured, 2026-08-28)` section to this plan with, for every mutation
listed in Tasks 1–5, the mutation applied, the suite run, and the EXACT failing assertion text. A
mutation you did not run is not a measurement; say so explicitly rather than leaving it blank.

- [ ] **Step 4: Commit the record**

```bash
cd "$(git rev-parse --show-toplevel)"
git add docs/superpowers/plans/2026-08-28-program-leverage-wave2-f2.md
git commit -m "plan(wave2): record the measured reds, mutations and suite results"
```

- [ ] **Step 5: Push and open the PR**

```bash
cd "$(git rev-parse --show-toplevel)"
git push -u origin ws/quiet-meadow
```

Open the PR against `main` with a body naming: the two features, the deviations consumed, the
AGENT-FIRST requirement at deploy (this wave edits `ccd/coordinator-skill/references/`), and the fact
that the coordinator — not the worker — performs that deploy.

- [ ] **Step 6: Measure the fingerprint ONCE and report the wave-done**

Per the worker contract, all four fields at one moment, after the final push, and sent once:

```bash
cd "$(git rev-parse --show-toplevel)" && git rev-parse HEAD
```

`handoffCommit` must EQUAL `branchTip`. `prPhase` must be one of the eight enum words. Mail it to
`toId:'coordinator'` with `"runId":12`. **Then stop pushing** — a lint fix landed after the mail moves
the tip away from the sha claimed and the coordinator gets `stale-tip` for a wave that was finished.

---

## Deviations found

### D-1012 (drift in the brief and the ledger, found while measuring the fold ruling) — the graphify lane is not on `origin`

Both the wave-2 brief and the program ledger direct a reader to
`git fetch origin ws/ccrc-with-graphify-integration`. That fetch fails: `git ls-remote --heads origin`
carries exactly three heads — `main`, `docs/scope-throttle-visible`, `ws/brisk-meadow`. The graphify
branch exists only as a local branch in a sibling worktree, so the lane cannot be reviewed, merged or
coordinated against through GitHub yet, and this wave must not assume its work lands first. Also
measured: this clone carries ~30 stale `origin/*` remote-tracking refs left over from the pre-migration
private repo, so `git branch -r` is not evidence about the real remote — `git ls-remote` is.

### D-1013 (design finding, found while placing the run-event row) — dispatch's `detail` is mutually exclusive, so a fourth fact cannot ride it

`server/src/coord/dispatch.ts:544-545` composes the transition row's detail as
`adopted ? 'spawn-adopted:…' : clearError !== null ? clearRefusedDetail(clearError) : undefined`. The
arms are exclusive: an adopted dispatch that also refused its `/clear` records only the adoption.
Folding the skill preflight into that expression would therefore DROP it on exactly the dispatches most
worth knowing about, and composing the arms instead (joining rather than choosing) would change a string
that has a reader — `CoordStore.strandedClear` matches `clearRefusedDetail`'s output to decide whether
the mail lane may clear a stranded `/clear`. Hence a separate `recordRunEvent` row. **The exclusivity
itself is pre-existing and is NOT fixed here** — an adopted-and-clear-refused dispatch still loses one
of its two facts. Recorded, deferred, and worth a later wave.

### D-1014 (drift, found while reading the dispatch-response table) — "two fields" was unpinned prose and became false

`ccd/coordinator-skill/references/wave-lifecycle.md:71` says the dispatch route "answers with two fields
beyond the ones above". Nothing in the suite pinned that count — `coordinator-skill.test.ts:416-423`
asserts only `toContain('adopted')`, `toContain('spawnState')` and the ok-is-not-proof sentence — so the
sentence would have quietly become a lie the moment this wave shipped a third field. Fixed to "three
fields" and pinned in both directions (`.not.toMatch(/\btwo fields\b/)` and `toMatch(/\bthree fields\b/)`),
so the next field to land reds a suite instead of drifting.

### D-1015 (ring finding, found while wiring the preflight) — `config.ts` imports `coord/db.js`, so `coord/*` may not value-import it

`server/src/config.ts:4` is `import { defaultCoordDbPath } from './coord/db.js'`. Every file under
`server/src/coord/` imports `../config.js` TYPE-ONLY today (`close.ts:2`, `fingerprint.ts:5`,
`dispatch.ts:3`), and type-only imports are fully erased. A value import of `configDirFor` into
`dispatch.ts` would therefore pull the store's own module graph — and `node:sqlite` behind it — into a
policy module whose ring forbids holding a handle. The coord-ring guard would NOT have caught it: it
text-scans for direct `./db.js`/`node:sqlite` imports, and `../config.js` is neither. Resolved with a
consumer-declared port (`DispatchRunDeps.configDir`), which is the L2 rule stated straight — ports are
declared BY the consumer — and which also makes the preflight testable without a roster. The port is
REQUIRED, not optional: an optional one that a caller forgot to wire would report `unmeasurable` on a
healthy fleet forever, and fail-quiet is the defect this whole feature exists to delete.

### D-1016 (spec item under-specified, measured while implementing) — a successful measurement that finds nothing also cannot seed

Spec §4 item 2 says the 409 `not-seeded` "remains ONLY for the case where that measurement itself
fails." Measured, there are two failure-to-seed conditions, not one: the walk can fail (nothing was
read), or the walk can succeed and the documents can carry no global `D-<n>` at all — `floorFromScan`
returns `null` for that, deliberately, because `max === 0` is not a floor and minting from it is a
guess. Both must refuse. Shipped as: the refusal token stays `not-seeded` (it is also required to keep
a producer literal in `coord/routes.ts` by `claims-envelope.test.ts`), and the two conditions carry
DIFFERENT `detail` sentences so they never collapse into one fact for the operator reading them. The
spec's sentence is narrower than the tree; the tree wins.

### D-1017 (security drift, found while lifting the path walk) — the allocator route interpolates a caller-supplied segment into a filesystem path

`POST /api/ledger/deviations` takes `project` from the request body. Before this wave nothing on that
route touched the filesystem, so the value was inert; the synchronous seed makes it a path segment in
`${projectsRoot}/${project}/docs/superpowers`. The sweep's own projects come from the registry and are
therefore trusted; the route's do not. The route is box-token gated, but this tree's own rule is that
the HTTP chokepoint is "a contract the coordinator skill honors, not an OS wall", and a token is a
credential rather than a sandbox. Guarded with `isSafeProjectSegment` in `coord/ledgerseed.ts` — a
single path segment, `^[A-Za-z0-9][A-Za-z0-9._-]*$`, refusing `.` and `..` — checked BEFORE any IO, so
an unsafe name answers `unmeasurable` without a walk.

### D-1018 (defect in an existing guard, measured and DEFERRED) — the floor sweep's partial-scan tolerance is not bounded by the 50-number gap

`server/src/watch.ts:1906-1911` justifies skipping an unreadable dir or file with "a partial scan can
only ever UNDER-seed inside the 50-number gap, which the next successful sweep raises." The first half
does not hold: the gap is added to the max ref the scan FOUND, so if the file carrying the highest ref
is the one that failed to read, the under-seed is unbounded by the gap and is only bounded by the
distance between the two highest refs in the corpus. What makes it safe today is the second half — the
sweep mints nothing, so a low floor costs a delay, and the next pass raises it. That reasoning does NOT
transfer to a synchronous seed, which mints immediately; hence `LedgerDocsRead.complete` and the two
different policies. **The watcher's behaviour is left exactly as it was** — changing it would make the
hourly sweep fail-shut more often, an operator-visible change beyond this wave's scope. Deferred, and
the comment at both call sites now says which policy each one is choosing and why.

### D-1019 (pre-existing collapse worked around, not fixed) — `readdir` cannot tell an absent dir from one that will not list

`FleetIO.readdir` returns `null` on ANY failure and there is no measured variant (D-114); `io.stat` is
worse, because the agent's implementation answers EACCES as `{missing: true}` and so lies about absence.
A project that genuinely has no `specs/` directory is therefore indistinguishable, at that call, from
one whose `specs/` would not list — and treating them alike would either make the common case
permanently `unmeasurable` or let a failed listing pass as a measurement. Worked around with an evidence
ladder rather than a new wire op: `readLedgerDocs` lists the PARENT (`docs/superpowers`) first and uses
its names as the evidence — a dir the parent does not name is genuinely absent and contributes nothing;
a dir the parent DOES name and that then will not list is a failure. This is the same shape
`server/src/registry.ts` already uses for a field that is listed but will not read. **Adding a measured
`readdir` to the agent protocol would be the real fix** and is an AGENT-FIRST change of its own; wave 8
already owns the measured-read completion work and is its natural home.

---

## Notes for the coordinator

- **This wave is AGENT-FIRST at close.** It edits `ccd/coordinator-skill/references/wave-lifecycle.md`
  and `.../peer-protocol.md`, which ship to the fleet host through the installer. The agent lane goes
  first, the server lane second. The worker does not deploy.
- **`skillState` is measured at DISPATCH, against the account the session is on at that moment.**
  `ccd swap` rewrites `$REG/<id>.wrapper`, so a session that swaps after a dispatch can land on a home
  whose skill install failed, and the recorded `skillState` will not know. That is why both installers
  write into every rostered config dir; it is not a defect in the field.
- **A `.claude`-prefixed config-dir suffix is load-bearing in remote fleet mode.** The agent's read
  whitelist permits a path only when the first segment under `$HOME` starts with `.claude`, while
  `parseRoster` accepts any `^\.[A-Za-z0-9._-]+$`. A rostered account with, say, a `.foo` suffix will
  read `unmeasurable` forever. This is pre-existing — live state, tasks and transcripts already fail
  identically — and this wave deliberately does NOT widen the whitelist to paper over it. The preflight
  is simply the loudest surface it has had.
- **The preflight costs one extra `readFileMeasured` inside the dispatch's `CoordMutex`-held critical
  section.** Local: microseconds. Remote: one agent WS round trip on a path that already fires dozens,
  bounded only by the client's 15 s per-request ceiling. If that ever matters, the fix is a per-call
  budget on the port, not the removal of the measurement.

---

## Self-review

**Spec coverage.** §4 design item 1 (skill preflight: measured read, additive `skillState` beside
`spawnState`, `run_events` detail row, never refuses, absent ≠ unmeasurable, the coordinator reports
`absent` before treating the wave as briefed) → Tasks 1, 2, 3. §4 design item 2 (synchronous floor seed,
inline and bounded, 409 only when the measurement fails, response shape otherwise unchanged) → Tasks 4,
5, with the "only when the measurement fails" sentence narrowed under D-1016. §4's stated test
obligations: three-way mutation test through a fixture HOME → Task 1 Step 8 and Task 2 Step 9; a test
that deletes the preflight and reds on the missing field → Task 2 Step 9 mutations 1 and 3;
first-allocation-on-fresh-project succeeds → Task 5 Step 1; measurement-failure still answers
`not-seeded` → Task 5 Step 1. Brief constraints: wave-lifecycle table documents `skillState` → Task 3;
route-parity and census green → Tasks 3 and 5 Step 6 (no new route spelling, no destructive verb); pins
written before the text they pin → every task's Step 1; wire additive, single reader, older-peer
omission tolerated → Global Constraints and Task 2 Step 5; the skill-presence read is ONE helper →
Task 1's `server/src/skillstate.ts` and its docstring.

**Placeholder scan.** One deliberate gap is flagged in place rather than hidden: Task 2 Step 1's last
test is written as an unusable shape and the step explicitly instructs the executor to rewrite it with
an `unrostered` option and an exact assertion. Three steps ask the executor to READ a file before
copying a signature (`recordRunEvent`'s parameters, `floorFromScan`'s parameter mutability,
`ledger-routes.test.ts`'s `openApp` arity) — these are verification instructions with a stated fallback,
not TODOs. Task 4 Step 4 states a predicate-translation risk and names `ledger-sweep.test.ts` as the
arbiter with an explicit rule (change the call site, never that suite).

**Type consistency.** `SkillState` is spelled identically in `shared/api.ts`, `server/src/skillstate.ts`,
`DispatchOutcome`, `sendDispatchOutcome` and every test. `readWorkerSkillState(io, configDir)` takes
`string | undefined` in its definition (Task 1) and is called with
`wrapper === null ? undefined : deps.configDir(wrapper)` (Task 2) — `configDir` returns
`string | undefined`, so the union matches. `LedgerSeedDeps` is constructed identically at all three
call sites (watcher ×2, route ×1) and the optional `now`/`budgetMs` are supplied only by tests.
`FloorMeasurement`'s three arms are consumed exhaustively in the route: `ok` seeds, `no-refs` and
`unmeasurable` each pick one of the two detail sentences. `LEDGER_FLOOR_DIRS` is defined once and used
by the watcher's floor sweep and by `measureLedgerFloor`; the reconcile sweep keeps its own `['plans']`
literal, which is a different list and not a duplicate.
