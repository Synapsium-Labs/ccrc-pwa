# program-leverage wave 3 — F3: the per-project program-ready badge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before an operator starts a program on a project, the PWA tells them whether the four
program preconditions actually hold on this box — and when it cannot tell, it says *that* instead of
guessing.

**Architecture:** One L0 vocabulary block (four small closed unions plus two pure folds), one L3
measurement module (`server/src/readiness.ts`) built on ports it declares itself, one slow-clock
watcher sweep that caches the expensive fleet-wide half, and one additive `readiness` field on the
`GET /api/projects` row that the start-program sheet already reads. The expensive precondition — two
skill files per rostered HOME, an agent round trip each in remote mode — never runs on a request
path; the cheap per-project one (a single indexed `coord.db` SELECT) is composed at the route.

**Tech Stack:** TypeScript (ESM, `"type":"module"`), Node >= 22.13.0, vitest, fastify (L4 only),
`node:sqlite` via `CoordStore` (L3 only), React (PWA). Zero new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-28-program-leverage-design.md` §5 (on
`origin/ws/brisk-meadow` — fetch that ref; it is not on `main`). Program ledger:
`docs/superpowers/programs/program-leverage.md`, same ref.

---

## The seam, and why it is not either of the two the spec named

Spec §5 offers `GET /api/runs` "or the coord status emit" and hands the choice to this plan. Both
were measured and **both are structurally disqualified**; the operator ruled on the replacement
(2026-08-29, recorded as D-1023). The measurements:

| Candidate | Why it cannot carry this feature |
|---|---|
| `GET /api/runs` / `RunSummary` | `CoordStore.runs()` selects `FROM runs r JOIN programs p` (`server/src/coord/store.ts:819-836`) — a project with **no run has no row**, and "before a program starts" is precisely the case F3 exists for. `if (!deps.coord) return notConfigured(reply)` fires at `coord/routes.ts:1259` **before any body is built**, so precondition (4)'s arm could only be reconstructed from an HTTP status — a second reader. And `toRunSummary` is shared with `FleetWatcher.emitRuns`, which is `private emitRuns(): void` on a 2 s tick (`watch.ts:974`, `:534`), so a `RunSummary` field must be synchronous from `coord.db` alone — which three of the four preconditions are not. |
| the coord status emit | `CoordStatus` is `{pause, mail}` (`shared/api.ts:2404`), derived from `RegistryRead.names`. `emitCoord` is called at `watch.ts:640` **deliberately before** the `!registryRead.listed` fail-shut return at `:641-665`, and that placement is pinned by `fleetws.test.ts:843-869`. `records` — the only source of project names — is not bound until `:667`. The frame has **no project dimension in scope** on the very arm it exists to serve. |

**The seam this plan picks: `GET /api/projects`** (`server/src/server.ts:1515`,
`app.get('/api/projects', async () => listProjects(deps.io, deps.cfg))`). It is the read that already
enumerates projects — *including ones with no run* — it is already `async` and already fleet-I/O-bound
(`listProjects` does a `readdir` per candidate plus `readRegistry`, `server/src/lifecycle.ts:130-141`),
it carries **no `!deps.coord` guard**, so precondition (4)'s `not-configured` arm is genuinely
observable through it, and the /runs board already consumes it: `RunsScreen` mounts
`StartProgramSheet` unconditionally (`pwa/src/screens/RunsScreen.tsx:553`) and the sheet fetches
`api.projects` on open (`pwa/src/fleet/StartProgramSheet.tsx:242,272`).

**The badge renders in the start-program sheet only** (operator ruling, 2026-08-29). The /runs board
groups by PROGRAM slug (`runsByProgram` keys on `run.program`, `pwa/src/fleet/runWords.ts:296-304`)
and nothing constrains a program's runs to one project, so a group-header badge would be a program
badge wearing a project's answer. The sheet is the one surface that is genuinely project-keyed, and
it is where a program is actually started.

---

## Global Constraints

- **Commit on `ws/quiet-meadow`, this workspace's own branch — never a separate feature branch.** The
  done-fingerprint re-measures this branch's tip; work parked elsewhere wedges the close `stale-tip`
  forever.
- **TDD red-first, mutation-table discipline. Write each pin BEFORE the code or prose it pins.**
  Wave 1's D-1009 lesson: a pin authored after its subject has nothing to fail against. Every step
  below that adds a guard is preceded by a step that measures it RED.
- **Every "behaviour unchanged" claim needs a fixture that could witness the change.** Wave 2's own
  words: *a suite that cannot express a change cannot witness it.* Task 2 changes a shipped reader's
  shape; it does not get to claim the dispatch preflight is unaffected without a fixture that would
  go red if it were.
- **No overloaded null at any new seam.** Three distinct conditions, three distinct values, at every
  one of the new seams. In particular the `readiness` key itself is THREE-valued on the wire: **key
  absent** = this server does not measure readiness (an older build); **`null`** = it measures and has
  not swept yet; **an object** = measured. A reader that folds the first two together is a defect, not
  a shortcut.
- **`unmeasurable` is the word, never `unreadable`.** `single-definition.test.ts:1320-1327` pins the
  ordered pair `'absent' | 'unreadable'` to `server/src/io.ts` ALONE and scans as TEXT — naming
  io.ts's pair even inside a docstring reds the build (measured in wave 2). Say `ReadFailure`.
- **Never write `['present', 'absent', 'unmeasurable']` as a free-standing array literal** anywhere
  under `shared/`, `server/src`, `pwa/src`, `agent/src`. `single-definition.test.ts:1312-1318` reds on
  it, and its own comment names "a PWA badge" as the drift it exists to catch. The PWA badge in Task 6
  must derive its tables from the maps, never retype the words.
- **Wire discipline: additive only.** `readiness` rides the `GET /api/projects` JSON body. **Do not
  bump `FLEET_PROTO`** (=1, `shared/api.ts`) — it is not a `FleetMsg` and would not warrant a bump if
  it were. One reader per field. An older server omitting the key renders no badge, never a broken
  sheet.
- **Zero new ccd verbs, zero new HTTP routes, reads only.** `EXEC_COMMANDS` is untouched. Nothing in
  this wave writes to `coord.db`, the registry, or any HOME.
- **Single-source-of-truth.** Every new runtime member list is DERIVED (`Object.keys(X_MAP)`), never
  hand-typed. Extend the EXISTING `SkillState` block in `single-definition.test.ts` (`:1291-1329`);
  never add a parallel describe for the same family.
- **Place the new `single-definition` pin MID-FILE, inside the Build 8 vocabularies describe** — the
  adjacent graphify lane (`ws/ccrc-with-graphify-integration`, now `fd6ddfdd`) appends its own
  describe at EOF (measured), so an EOF append here is a needless conflict and a mid-file one is not.
- **The coord ring.** `server/src/readiness.ts` lives OUTSIDE `server/src/coord/` deliberately: it
  must not `import ... from './db.js'` or `'node:sqlite'`, and it reaches the floor through a
  consumer-declared port, the way wave 2's `configDir` port did (D-1015).
- **No new quoted kebab-case literal under `server/src/coord/`.** `mail-routes.test.ts:383-495` scans
  every `.ts` there and requires each such token to be a declared union member or allowlisted. This
  wave adds no file there; `'not-seeded'` and `'not-configured'` are reused words that already pass.
- **Role vocabulary only, in every byte this wave writes — including this plan.**
  `server/test/topology-clean.test.ts` scans `git ls-files` AND every blob `origin/main..HEAD`
  introduces (D-208) and bans the operator's username, the two real box names, the volume id, the
  GitHub handle and the old employer org. **No absolute home path anywhere; use
  `cd "$(git rev-parse --show-toplevel)"`.**
- **Deviation refs are ledgered and bounded.** `server/test/deviation-refs.test.ts` requires the
  highest `D-<n>` token anywhere in the tracked tree to equal the highest `D-<n>` DEFINED by a heading
  or bullet in a plan. Define every number you cite; **never write the top of an unconsumed range with
  a `D-` prefix** — spell this program's block `D-999..1046`.
- **Fixture `D-` refs MUST be spelled SPLIT** — `` `D-${1200}` `` or `'D-' + '1200'`, never
  contiguous. `deviation-refs.test.ts` runs the real `floorFromScan` over the tracked tree; a
  contiguous fixture ref reds it and would permanently poison the live seed on the fleet.
- **Never write a bare `D-TBD-...` into a diff** (`server/test/dtbd.test.ts`).
- **Deviations: this program's block is `D-999..1046`; `D-999..D-1022` are consumed by waves 1–2, so
  this wave starts at `D-1023`.** Every number cited below is defined in `## Deviations found`.
- **Suites run in the FOREGROUND, `timeout >= 600000`, cd'd into the package.** Single suite:
  `./node_modules/.bin/vitest run test/<file>` from inside `server/` or `pwa/`. **Never bare
  `npx vitest`** — it resolves a global copy with no jsdom and falsely reports "no tests".
- **This wave is NOT agent-first.** It touches no `ccd/`, no `session-hook.sh`, no skill corpus. The
  deploy is the coordinator's act at wave close regardless — **do not deploy anything.**

---

## File Structure

| File | Change | Responsibility after the change |
|---|---|---|
| `shared/api.ts` | Add one vocabulary block | L0: `FloorState`, `TokenState`, `CoordDbState`, `ReadyVerdict` + their maps/derived lists/guards; `ReadinessFacts`; `ProjectReadiness`; `ProjectRow`; the pure `readyVerdict` and `foldSkillStates` folds |
| `server/src/skillstate.ts` | Extend — grow the parameter its own docstring promised | THE skill-presence read, now for BOTH skills: `COORDINATOR_SKILL_DIR`, `skillPath(configDir, dir)`, `readSkillState(io, configDir, dir)`; `readWorkerSkillState` delegates and keeps its signature |
| `server/src/readiness.ts` | **Create** | L3: `measureFleetReadiness(deps)` — the fleet-wide half (both skills across every `homeAble` HOME, box token, coord DB) — and `projectReadiness(fleet, floor)`, the per-project compose. Declares its own ports; imports no fastify, no `node:sqlite`, no `coord/db.js` |
| `server/src/watch.ts` | Add one sweep + one accessor | `READINESS_SWEEP_MS` slow clock beside `sweepLedgerFloor`; caches `FleetReadiness`; `currentReadiness()` for the route |
| `server/src/lifecycle.ts` | Widen `listProjects`'s return type to the shared one | Stops declaring the projects wire shape inline; returns `ProjectRow[]` with `readiness` unset |
| `server/src/server.ts` | Modify the `/api/projects` handler | Reads the cached fleet half off the watcher exactly as `/api/fleet` reads `watcher?.currentPending()`, adds the per-project floor, composes one `readiness` per row |
| `pwa/src/fleet/readinessWords.ts` | **Create** | The badge's word/glyph tables, DERIVED from the shared maps — the two-cue rule (word AND glyph, never colour alone) |
| `pwa/src/fleet/StartProgramSheet.tsx` | Replace the local `Project` interface with the shared one; render the badge | The sheet reads `ProjectRow` and renders one compact badge per project row |
| `pwa/src/fleet/fleet.css` | Add the badge rules | Scoped under a painter so the contrast auditor grounds them; inert (no glow/animation/box-shadow) |
| `server/test/readiness.test.ts` | **Create** | The folds, the fleet measurement's arms per precondition, the per-project compose |
| `server/test/readiness-sweep.test.ts` | **Create** | The clock, the roster walk, the coord probe's three answers, the last-good-answer contract |
| `server/test/skillstate.test.ts` | Extend | The parameterised reader; the worker delegate's behaviour is unchanged AND a fixture that would witness it if it were not |
| `server/test/lifecycle.test.ts` | Extend | `GET /api/projects` carries `readiness`; `null` when unswept; a project with no run still answers |
| `server/test/single-definition.test.ts` | Extend the Build 8 describe (mid-file) | Four new vocabularies defined once, lists derived, no free-standing word arrays |
| `pwa/test/start-program.test.tsx` | Extend | The badge renders each verdict; an older server (key absent) renders nothing; `null` renders the pending arm |
| `pwa/test/fleet-css.test.ts` | Extend the inert-selector list | The new badge class is pinned inert |

**Ordering rationale.** Task 1 ships the vocabulary and the pure folds with nothing depending on
them, so its reds are pure. Task 2 changes a SHIPPED reader and is the only task that can regress
wave 2's dispatch preflight, so it is isolated and carries its own witness fixture. Task 3 consumes
both and is pure-with-ports, so it is fully testable without a server. Task 4 puts it on a clock.
Task 5 is the only task that changes a wire response. Task 6 is the only task that touches the PWA.
Task 7 verifies the whole branch.

---

## Verified facts this plan is built on

Read at `4e2a04f5` (this branch's tip at planning time) on 2026-08-29, in this worktree. Do not
re-derive them; DO re-check any that a step's expected output contradicts, and **believe the tree
over this table.**

| Fact | Evidence |
|---|---|
| `GET /api/projects` is a one-line handler with no coord guard and no token gate | `server/src/server.ts:1515` — `app.get('/api/projects', async () => listProjects(deps.io, deps.cfg))` |
| It is NOT in the auth `EXEMPT` table, so when `CCRC_AUTH` is armed it needs a live session — which the PWA has and the cookieless coordinator does not | `server/src/auth/gate.ts:167-200`; the badge is deliberately a PWA-only affordance |
| `buildServer` receives the watcher, and the established idiom for reading a swept value off it is `watcher?.currentX()` with `undefined` meaning "no watcher, or not swept yet" | `server/src/server.ts:241`, `:1018`, `:1045` (`watcher?.lifecycleHealth() ?? undefined`) |
| `listProjects` returns `{roots, projects}` with the row shape declared INLINE, and the PWA declares its own local `interface Project` — the shape has no single definition today | `server/src/lifecycle.ts:125-128`; `pwa/src/fleet/StartProgramSheet.tsx:50` (D-1028) |
| `StartProgramSheet` is mounted unconditionally by the board and fetches projects on open | `pwa/src/screens/RunsScreen.tsx:553`; `StartProgramSheet.tsx:242` (`loadProjects = api.projects`), `:272` (`setList(r.projects)`) |
| `readWorkerSkillState`'s own docstring PRE-AUTHORISES exactly this extension | `server/src/skillstate.ts:16-19` — "it calls THIS and `WORKER_SKILL_DIR` grows a parameter; it does not grow a second join" |
| The worker installer requires `SKILL.md` alone; the coordinator installer additionally requires five refs | `ccd/install-worker-skill.sh` (`REQUIRED_FILES=(SKILL.md)`); `ccd/install-coordinator-skill.sh:70-78` (`REQUIRED_REFS=(...)`) — the narrowing is D-1027 |
| The coordinator skill installs to `<configDir>/skills/ccrc-coordinator/` | `ccd/install-coordinator-skill.sh`; nothing under `server/src`, `shared` or `agent/src` names that string today |
| `configDirFor(cfg, wrapper)` is the ONE wrapper-to-directory join and answers `undefined` for a wrapper the roster does not carry | `server/src/config.ts:186-189` |
| `Roster` carries `homeAble` — the accounts that actually have a HOME on this box — in declaration order | `shared/roster.ts:127-153`; `AccountDef.homeAble` at `:71-111` |
| Each `readFileMeasured` is ONE agent round trip in remote mode, capped at 15 s, with no batch op in the protocol | `server/src/remote/io.ts:41`; `server/src/remote/client.ts:68` (`DEFAULT_REQUEST_TIMEOUT_MS`) |
| A remote `forbidden` refusal arrives as `unreadable`, never `absent` — the correct polarity | `server/src/remote/io.ts:40-53` |
| `CoordStore.ledgerFloor(project)` is a single indexed SELECT, returns `null` for "no row", and THROWS if the read fails — there is no result type at that seam | `server/src/coord/store.ts:2565-2571`; `ledger_floor` DDL at `server/src/coord/schema.ts:571-576` |
| Measuring "seeded" needs NO filesystem or agent I/O; `measureLedgerFloor` (which does) hard-codes `SEED_POLICY` with no parameter to override | `server/src/coord/ledgerseed.ts:210-218`, `:32` — calling it from a board read is the D-1021 defect shape |
| The box token is read ONCE at the composition root and lands on `Deps.mailToken`, whose runtime state space is only `string \| null` | `server/src/index.ts:52`; `server/src/server.ts:217` |
| `readMailToken` returns `null` ONLY for ENOENT; every other errno, an empty file, and the unedited placeholder THROW uncaught and kill the boot | `server/src/coord/token.ts:135-155` — so the boot measurement has no `unmeasurable` arm (D-1025) |
| `deps.coord` is constructed unconditionally at the root, and `openCoordDb` refuses to start rather than open empty — so `!deps.coord` is unreachable in the shipped process | `server/src/index.ts:66`; `server/src/coord/db.ts:139-151`, `:191-228`, `:9-13` (D-1024) |
| A coord.db read that throws AFTER boot is real and is currently swallowed to `console.warn` in two places, recorded nowhere | `server/src/watch.ts:974-987`; `server/src/server.ts:1226-1240` |
| The slow-sweep idiom is `if (this.lastX !== 0 && now - this.lastX < X_MS) return;` — first run measures immediately | `server/src/watch.ts:1615-1616` (divergence), `:1918-1920` (ledger floor) |
| Slow sweeps are `void`-dispatched from `tick()` with `.catch(() => {})`, never awaited | `server/src/watch.ts:849-850` |
| `single-definition.test.ts` scans `shared/`, `server/src`, `pwa/src`, `agent/src`, `.tsx?` only — not `.md`, not `ccd/` | its `ROOTS`, `:32-37` |
| The `SkillState` block already lives mid-file inside the Build 8 vocabularies describe, on a reusable `oneDefinition(decl, name)` helper | `server/test/single-definition.test.ts:1188-1191`, `:1291-1329` |
| The graphify lane appends its describe at EOF of the same file and touches no other file this wave edits | `git diff origin/main...origin/ws/ccrc-with-graphify-integration -- server/test/single-definition.test.ts` (measured 2026-08-29; tip `fd6ddfdd`, not the brief's `92bf6b76` — D-1029) |
| The board's badge idiom is a `<span>` with a class, a `data-*` for the raw token and a `title=` for the sentence, obeying a two-cue rule (word AND glyph) | `pwa/src/screens/RunsScreen.tsx:176-180` (`.sess-spawn`), `:184-188` (`.run-resumed`); tables at `pwa/src/fleet/runWords.ts:12-30`, `pwa/src/fleet/coordWords.ts:22-32` |
| A new coloured CSS rule that sets `color` and paints no ground lands in the contrast auditor's UNCOVERED census, and a selector that names a painter landing there is a hard FAILURE | `pwa/test/contrast.test.ts:889-903`; `pwa/design/audit.mjs:519-544` |
| `pwa/test/fleet-css.test.ts:567-579` pins inertness against a HAND-MAINTAINED selector list — a new class is unpinned until added there | that file |
| The PWA imports `shared/api.ts` by relative path | `pwa/src/fleet/StartProgramSheet.tsx:38` (`from '../../../shared/api'`) |
| Highest `D-<n>` defined in the tracked tree is `D-1022`; the `1234` hit is a substring of the `D-123456` garbage fixture in `server/test/ledger.test.ts` | `git grep -hoE 'D-1[0-9]{3}' HEAD` |

---

## Task 1: The vocabulary and the two pure folds

**Files:**
- Modify: `shared/api.ts` (append the block beside the existing `SkillState` block, ~`:1207`)
- Modify: `server/test/single-definition.test.ts:1291-1329` (extend the Build 8 describe, mid-file)
- Test: `server/test/readiness.test.ts` (**create** — the folds only, this task)

**Interfaces:**
- Consumes: `SkillState`, `SKILL_STATE_MAP`, `SKILL_STATES`, `isSkillState` (`shared/api.ts:1191-1207`,
  wave 2).
- Produces: `FloorState`, `TokenState`, `CoordDbState`, `ReadyVerdict` and their `*_MAP` /
  `*_STATES` / `is*` trios; `ReadinessFacts`; `ProjectReadiness`; `ProjectRow`;
  `foldSkillStates(states: readonly SkillState[]): SkillState`;
  `readyVerdict(f: ReadinessFacts): ReadyVerdict`.

- [ ] **Step 1: Write the failing single-definition pin FIRST (D-1009's lesson)**

Inside the existing `describe('Build 8 vocabularies — one definition each, all derived from their map')`
in `server/test/single-definition.test.ts`, immediately after the `SkillState` `it(...)` blocks
(~`:1310`), add:

```ts
  // program-leverage wave 3 (F3). Four readiness vocabularies join this family
  // on the same terms as `SkillState` did: defined once, list DERIVED from the
  // map, no free-standing array of the words anywhere the PWA badge could
  // retype them.
  it('defines the four readiness vocabularies exactly once, in shared/', () => {
    oneDefinition(/^\s*export type FloorState\b/m, 'FloorState');
    oneDefinition(/^\s*export const FLOOR_STATE_MAP\b/m, 'FLOOR_STATE_MAP');
    oneDefinition(/^\s*export type TokenState\b/m, 'TokenState');
    oneDefinition(/^\s*export const TOKEN_STATE_MAP\b/m, 'TOKEN_STATE_MAP');
    oneDefinition(/^\s*export type CoordDbState\b/m, 'CoordDbState');
    oneDefinition(/^\s*export const COORD_DB_STATE_MAP\b/m, 'COORD_DB_STATE_MAP');
    oneDefinition(/^\s*export type ReadyVerdict\b/m, 'ReadyVerdict');
    oneDefinition(/^\s*export const READY_VERDICT_MAP\b/m, 'READY_VERDICT_MAP');
  });

  it('DERIVES every readiness member list from its map', () => {
    const api = readFileSync(join(ROOT, 'shared/api.ts'), 'utf8');
    for (const [list, map] of [
      ['FLOOR_STATES', 'FLOOR_STATE_MAP'], ['TOKEN_STATES', 'TOKEN_STATE_MAP'],
      ['COORD_DB_STATES', 'COORD_DB_STATE_MAP'], ['READY_VERDICTS', 'READY_VERDICT_MAP'],
    ] as const) {
      expect(api, `${list} is not derived from ${map}`).toMatch(
        new RegExp(`export const ${list}[^=]*=\\s*\\n?\\s*Object\\.keys\\(${map}\\)`));
      expect(api, `${list} is hand-typed as a literal array — derive it from ${map}`)
        .not.toMatch(new RegExp(`${list}[^=]*=\\s*\\[`));
    }
  });

  it('the readiness verdict is DERIVED in one place, never recomputed by a consumer', () => {
    // `readyVerdict` is L0 and pure so the PWA renders the server's answer
    // rather than folding five fields a second time. A second fold is how the
    // badge and the board come to disagree about the same box.
    oneDefinition(/^\s*export function readyVerdict\b/m, 'readyVerdict');
    oneDefinition(/^\s*export function foldSkillStates\b/m, 'foldSkillStates');
  });
```

- [ ] **Step 2: Run it and record the RED**

```bash
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/single-definition.test.ts
```
Expected: FAIL. Copy the first failing assertion VERBATIM into the execution record — it should read
`FloorState: expected [] to deeply equal [ 'shared/api.ts' ]`.

- [ ] **Step 3: Write the failing fold tests**

Create `server/test/readiness.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  foldSkillStates, readyVerdict, FLOOR_STATES, TOKEN_STATES, COORD_DB_STATES, READY_VERDICTS,
  isFloorState, isTokenState, isCoordDbState, isReadyVerdict,
} from '../../shared/api.js';

const OK = { worker: 'present', coordinator: 'present', floor: 'seeded',
  boxToken: 'configured', coordDb: 'available' } as const;

describe('foldSkillStates — every rostered HOME, folded honestly', () => {
  it('is present only when every home is present', () => {
    expect(foldSkillStates(['present', 'present'])).toBe('present');
  });
  it('a PROVEN absence anywhere dominates — one home without the skill is not installed', () => {
    expect(foldSkillStates(['present', 'absent'])).toBe('absent');
  });
  it('absent OUTRANKS unmeasurable — a proven failure is not downgraded to an unknown', () => {
    expect(foldSkillStates(['unmeasurable', 'absent'])).toBe('absent');
  });
  it('unmeasurable wins over present — one home we could not read is not a clean bill', () => {
    expect(foldSkillStates(['present', 'unmeasurable'])).toBe('unmeasurable');
  });
  it('NO homes at all is unmeasurable, never a vacuous present', () => {
    // A roster with zero homeAble accounts measured nothing. Saying "present"
    // would be vacuously true and operationally a lie.
    expect(foldSkillStates([])).toBe('unmeasurable');
  });
});

describe('readyVerdict — three-valued, because a boolean would collapse blocked with unknown', () => {
  it('all five preconditions ok reads ready', () => {
    expect(readyVerdict(OK)).toBe('ready');
  });
  it('a proven-missing precondition reads blocked', () => {
    expect(readyVerdict({ ...OK, worker: 'absent' })).toBe('blocked');
    expect(readyVerdict({ ...OK, floor: 'not-seeded' })).toBe('blocked');
    expect(readyVerdict({ ...OK, boxToken: 'absent' })).toBe('blocked');
    expect(readyVerdict({ ...OK, coordDb: 'not-configured' })).toBe('blocked');
    expect(readyVerdict({ ...OK, coordDb: 'degraded' })).toBe('blocked');
  });
  it('an unmeasurable precondition reads unknown — NOT blocked', () => {
    expect(readyVerdict({ ...OK, coordinator: 'unmeasurable' })).toBe('unknown');
    expect(readyVerdict({ ...OK, floor: 'unmeasurable' })).toBe('unknown');
    expect(readyVerdict({ ...OK, boxToken: 'unmeasurable' })).toBe('unknown');
  });
  it('blocked OUTRANKS unknown — a proven failure is reportable even when something else is unknown', () => {
    expect(readyVerdict({ ...OK, worker: 'absent', floor: 'unmeasurable' })).toBe('blocked');
  });
});

describe('the derived lists and guards', () => {
  it('each list has exactly its members, derived from its map', () => {
    expect([...FLOOR_STATES]).toEqual(['seeded', 'not-seeded', 'unmeasurable']);
    expect([...TOKEN_STATES]).toEqual(['configured', 'absent', 'unmeasurable']);
    expect([...COORD_DB_STATES]).toEqual(['available', 'degraded', 'not-configured']);
    expect([...READY_VERDICTS]).toEqual(['ready', 'blocked', 'unknown']);
  });
  it('each guard accepts its own members and refuses a neighbour vocabulary word', () => {
    expect(isFloorState('seeded')).toBe(true);
    expect(isFloorState('present')).toBe(false);
    expect(isTokenState('configured')).toBe(true);
    expect(isTokenState('seeded')).toBe(false);
    expect(isCoordDbState('available')).toBe(true);
    expect(isCoordDbState('configured')).toBe(false);
    expect(isReadyVerdict('ready')).toBe(true);
    expect(isReadyVerdict('available')).toBe(false);
  });
});
```

- [ ] **Step 4: Run it and record the RED**

```bash
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/readiness.test.ts
```
Expected: FAIL — `Error: Failed to resolve import` / `does not provide an export named 'foldSkillStates'`.
Record the verbatim text.

- [ ] **Step 5: Write the vocabulary block**

In `shared/api.ts`, immediately after `isSkillState` (`:1207`):

```ts
/**
 * program-leverage wave 3 (F3) — the program-ready preconditions, as four
 * small closed vocabularies plus the pure folds that turn them into one word.
 *
 * Each is three-valued for the SAME reason `SkillState` is: absence of
 * evidence is not evidence of absence, and a badge that cannot tell the two
 * apart tells an operator to go fix something that may be fine. The third
 * member is never a synonym for the second.
 *
 * `SkillState` is REUSED for both skills rather than copied — this block adds
 * no fifth word for a question wave 2 already gave a vocabulary.
 */
export type FloorState = 'seeded' | 'not-seeded' | 'unmeasurable';

/** Presentational only, and keyed BY the type so the compiler keeps it total. */
export const FLOOR_STATE_MAP: Record<FloorState, string> = {
  seeded: 'deviation floor seeded',
  'not-seeded': 'no deviation floor yet',
  unmeasurable: 'could not be measured',
};

export const FLOOR_STATES: readonly FloorState[] =
  Object.keys(FLOOR_STATE_MAP) as FloorState[];

export function isFloorState(v: unknown): v is FloorState {
  return typeof v === 'string' && (FLOOR_STATES as readonly string[]).includes(v);
}

/** `absent` is a PROVEN ENOENT on the token path; `unmeasurable` is any other
 *  read failure. The boot read (`coord/token.ts`) cannot produce the third
 *  member at all — it throws and the server never starts — which is why the
 *  readiness sweep re-measures the path rather than reporting `deps.mailToken`
 *  (D-1025). */
export type TokenState = 'configured' | 'absent' | 'unmeasurable';

export const TOKEN_STATE_MAP: Record<TokenState, string> = {
  configured: 'box token configured',
  absent: 'no box token on this box',
  unmeasurable: 'could not be measured',
};

export const TOKEN_STATES: readonly TokenState[] =
  Object.keys(TOKEN_STATE_MAP) as TokenState[];

export function isTokenState(v: unknown): v is TokenState {
  return typeof v === 'string' && (TOKEN_STATES as readonly string[]).includes(v);
}

/** Three conditions, three words, and NO `unmeasurable` member on purpose:
 *  every one of these is proven. `available` = a trivial read answered;
 *  `degraded` = the store is there and a read THREW (a full disk, another
 *  connection holding the write lock — the two causes `server.ts`'s own
 *  swallow site names); `not-configured` = there is no store at all. The
 *  shipped process cannot reach the third (D-1024) — the boot refuses rather
 *  than opening empty — and it is carried anyway because a build that omitted
 *  the arm could never report the day that changes. */
export type CoordDbState = 'available' | 'degraded' | 'not-configured';

export const COORD_DB_STATE_MAP: Record<CoordDbState, string> = {
  available: 'coordination database available',
  degraded: 'coordination database not answering',
  'not-configured': 'no coordination database',
};

export const COORD_DB_STATES: readonly CoordDbState[] =
  Object.keys(COORD_DB_STATE_MAP) as CoordDbState[];

export function isCoordDbState(v: unknown): v is CoordDbState {
  return typeof v === 'string' && (COORD_DB_STATES as readonly string[]).includes(v);
}

/** The aggregate. NOT a boolean, deliberately: `ready:false` would fold "we
 *  proved a precondition missing" into "we could not tell", which is the exact
 *  overloaded value this wave exists to refuse. `blocked` outranks `unknown` —
 *  a proven failure is worth reporting even while something else is unknown. */
export type ReadyVerdict = 'ready' | 'blocked' | 'unknown';

export const READY_VERDICT_MAP: Record<ReadyVerdict, string> = {
  ready: 'program-ready',
  blocked: 'not ready',
  unknown: 'readiness unknown',
};

export const READY_VERDICTS: readonly ReadyVerdict[] =
  Object.keys(READY_VERDICT_MAP) as ReadyVerdict[];

export function isReadyVerdict(v: unknown): v is ReadyVerdict {
  return typeof v === 'string' && (READY_VERDICTS as readonly string[]).includes(v);
}

/** The five measured preconditions, without the derived verdict or the stamp. */
export interface ReadinessFacts {
  readonly worker: SkillState;
  readonly coordinator: SkillState;
  readonly floor: FloorState;
  readonly boxToken: TokenState;
  readonly coordDb: CoordDbState;
}

/** One project's answer, as the wire carries it. */
export interface ProjectReadiness extends ReadinessFacts {
  readonly verdict: ReadyVerdict;
  /** When the fleet-wide half was swept. */
  readonly at: number;
}

/**
 * One row of `GET /api/projects`.
 *
 * `readiness` is THREE-VALUED and each value is a different fact:
 *   - the key ABSENT: this server does not measure readiness (an older build);
 *   - `null`: it measures and has not swept yet;
 *   - an object: measured.
 * A reader that folds the first two together has thrown away the distinction
 * between "upgrade the server" and "wait two seconds".
 */
export interface ProjectRow {
  name: string;
  workdir: string;
  readiness?: ProjectReadiness | null;
}

/** Fold one skill's answer across every rostered HOME. A proven absence
 *  anywhere dominates; an unreadable home downgrades a clean sweep to an
 *  unknown; measuring NOTHING is an unknown, never a vacuous `present`. */
export function foldSkillStates(states: readonly SkillState[]): SkillState {
  if (states.length === 0) return 'unmeasurable';
  if (states.includes('absent')) return 'absent';
  if (states.includes('unmeasurable')) return 'unmeasurable';
  return 'present';
}

/** The ONE derivation of the aggregate verdict. L0 and pure so the PWA renders
 *  the server's answer instead of folding the five fields a second time. */
export function readyVerdict(f: ReadinessFacts): ReadyVerdict {
  const cells: readonly ('ok' | 'blocked' | 'unknown')[] = [
    f.worker === 'present' ? 'ok' : f.worker === 'absent' ? 'blocked' : 'unknown',
    f.coordinator === 'present' ? 'ok' : f.coordinator === 'absent' ? 'blocked' : 'unknown',
    f.floor === 'seeded' ? 'ok' : f.floor === 'not-seeded' ? 'blocked' : 'unknown',
    f.boxToken === 'configured' ? 'ok' : f.boxToken === 'absent' ? 'blocked' : 'unknown',
    f.coordDb === 'available' ? 'ok' : 'blocked',
  ];
  if (cells.includes('blocked')) return 'blocked';
  if (cells.includes('unknown')) return 'unknown';
  return 'ready';
}
```

- [ ] **Step 6: Run both suites to GREEN**

```bash
cd "$(git rev-parse --show-toplevel)/server" \
  && ./node_modules/.bin/vitest run test/readiness.test.ts test/single-definition.test.ts
```
Expected: PASS, both files.

- [ ] **Step 7: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add shared/api.ts server/test/readiness.test.ts server/test/single-definition.test.ts
git commit -m "feat(wave3): the readiness vocabularies and the two pure folds"
```

---

## Task 2: `skillstate.ts` grows the parameter its docstring promised

**Files:**
- Modify: `server/src/skillstate.ts` (the export block)
- Test: `server/test/skillstate.test.ts` (extend)

**Interfaces:**
- Consumes: `SkillState`, `FleetIO.readFileMeasured`.
- Produces: `WORKER_SKILL_DIR` (unchanged export), `COORDINATOR_SKILL_DIR`,
  `skillPath(configDir: string, skillDir: string): string`,
  `readSkillState(io: Pick<FleetIO,'readFileMeasured'>, configDir: string | undefined, skillDir: string): Promise<SkillState>`.
  `readWorkerSkillState(io, configDir)` keeps its exact signature and semantics and delegates;
  `workerSkillPath(configDir)` keeps its signature and delegates to `skillPath`.

- [ ] **Step 1: Write the failing tests, INCLUDING the witness for "the worker read is unchanged"**

Append to `server/test/skillstate.test.ts` (add `COORDINATOR_SKILL_DIR`, `readSkillState` and
`skillPath` to that file's existing import from `../src/skillstate.js`, plus `mkdirSync` /
`writeFileSync` / `join` if not already imported):

```ts
describe('the reader is parameterised by skill dir (wave 3) and the worker arm did not move', () => {
  it('reads the coordinator skill from its own directory', async () => {
    const home = mkTmp('skillstate-coord-');
    mkdirSync(join(home, 'skills', COORDINATOR_SKILL_DIR), { recursive: true });
    writeFileSync(join(home, 'skills', COORDINATOR_SKILL_DIR, 'SKILL.md'), '# coordinator\n');
    expect(await readSkillState(localIO, home, COORDINATOR_SKILL_DIR)).toBe('present');
    // The WORKER skill is NOT there — and the two must not answer for each other.
    expect(await readSkillState(localIO, home, WORKER_SKILL_DIR)).toBe('absent');
  });

  it('joins <configDir>/skills/<dir>/SKILL.md and nothing else', () => {
    expect(skillPath('/cfg', COORDINATOR_SKILL_DIR)).toBe('/cfg/skills/ccrc-coordinator/SKILL.md');
    expect(skillPath('/cfg', WORKER_SKILL_DIR)).toBe('/cfg/skills/ccrc-worker/SKILL.md');
  });

  // THE WITNESS (wave 2's lesson: a suite that cannot express a change cannot
  // witness it). "readWorkerSkillState is unchanged" is a claim about which
  // PATH it reads, and the old suite only ever asserted its RESULT on a home
  // where one skill existed. This fixture puts BOTH skills in play, so a
  // delegate wired to the wrong dir returns the wrong answer instead of
  // coincidentally the right one.
  it('readWorkerSkillState still reads the WORKER path when the coordinator skill exists', async () => {
    const home = mkTmp('skillstate-both-');
    mkdirSync(join(home, 'skills', COORDINATOR_SKILL_DIR), { recursive: true });
    writeFileSync(join(home, 'skills', COORDINATOR_SKILL_DIR, 'SKILL.md'), '# coordinator\n');
    // worker dir deliberately absent
    expect(await readWorkerSkillState(localIO, home)).toBe('absent');
    mkdirSync(join(home, 'skills', WORKER_SKILL_DIR), { recursive: true });
    writeFileSync(join(home, 'skills', WORKER_SKILL_DIR, 'SKILL.md'), '# worker\n');
    expect(await readWorkerSkillState(localIO, home)).toBe('present');
  });

  it('an undefined configDir is unmeasurable for EVERY skill dir, not just the worker', async () => {
    expect(await readSkillState(localIO, undefined, COORDINATOR_SKILL_DIR)).toBe('unmeasurable');
    expect(await readSkillState(localIO, undefined, WORKER_SKILL_DIR)).toBe('unmeasurable');
  });

  it('a read that fails for any reason other than a proven absence is unmeasurable', async () => {
    expect(await readSkillState(degradedReadIO, '/cfg', COORDINATOR_SKILL_DIR)).toBe('unmeasurable');
    expect(await readSkillState(absentReadIO, '/cfg', COORDINATOR_SKILL_DIR)).toBe('absent');
  });
});
```

- [ ] **Step 2: Run it and record the RED**

```bash
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/skillstate.test.ts
```
Expected: FAIL — `does not provide an export named 'readSkillState'`. Record verbatim.

- [ ] **Step 3: Grow the parameter**

Replace `server/src/skillstate.ts`'s export block (keep the file's existing header docstring, and
extend its "grows a parameter" paragraph to record that the day arrived):

```ts
/** The directory `ccd/install-worker-skill.sh` writes, under `<configDir>/skills/`. */
export const WORKER_SKILL_DIR = 'ccrc-worker';

/** The directory `ccd/install-coordinator-skill.sh` writes, same parent.
 *
 *  NOTE the deliberate narrowing (D-1027): that installer requires FIVE
 *  reference files beside `SKILL.md` and refuses the install without them, so
 *  "SKILL.md is readable" is WIDER than the installer's own definition of
 *  installed — a home whose refs were removed reads `present` here. The
 *  narrower read is chosen on cost (each ref is another agent round trip in
 *  remote mode) and because the ref-level verdict is the doctor lane's job,
 *  not this one's. `skillPath` takes the dir as a parameter precisely so a
 *  later caller can widen it without a second join. */
export const COORDINATOR_SKILL_DIR = 'ccrc-coordinator';

/** The ONE join. `WORKER_SKILL_DIR` grew a parameter exactly as this file's
 *  header promised it would; there is still no second `path.join` here. */
export function skillPath(configDir: string, skillDir: string): string {
  return path.join(configDir, 'skills', skillDir, 'SKILL.md');
}

/** Kept for the caller that predates the parameter. Same signature, same path. */
export function workerSkillPath(configDir: string): string {
  return skillPath(configDir, WORKER_SKILL_DIR);
}

export async function readSkillState(
  io: Pick<FleetIO, 'readFileMeasured'>, configDir: string | undefined, skillDir: string,
): Promise<SkillState> {
  if (configDir === undefined) return 'unmeasurable';
  const read = await io.readFileMeasured(skillPath(configDir, skillDir));
  if (read.ok) return 'present';
  return read.reason === 'absent' ? 'absent' : 'unmeasurable';
}

export async function readWorkerSkillState(
  io: Pick<FleetIO, 'readFileMeasured'>, configDir: string | undefined,
): Promise<SkillState> {
  return readSkillState(io, configDir, WORKER_SKILL_DIR);
}
```

- [ ] **Step 4: Run the skillstate suite AND wave 2's dispatch preflight suite**

```bash
cd "$(git rev-parse --show-toplevel)/server" \
  && ./node_modules/.bin/vitest run test/skillstate.test.ts test/dispatch-skillstate.test.ts
```
Expected: PASS, both. `dispatch-skillstate` going red here means the delegate changed behaviour.

- [ ] **Step 5: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add server/src/skillstate.ts server/test/skillstate.test.ts
git commit -m "refactor(wave3): the skill read takes the skill dir, as its docstring promised"
```

---

## Task 3: `server/src/readiness.ts` — the measurement

**Files:**
- Create: `server/src/readiness.ts`
- Test: `server/test/readiness.test.ts` (extend Task 1's file)

**Interfaces:**
- Consumes: `readSkillState`, `WORKER_SKILL_DIR`, `COORDINATOR_SKILL_DIR` (Task 2);
  `foldSkillStates`, `readyVerdict`, `ProjectReadiness`, `FloorState`, `TokenState`, `CoordDbState`
  (Task 1).
- Produces: `ReadinessHome`; `ReadinessDeps`; `FleetReadiness`;
  `measureFleetReadiness(deps: ReadinessDeps): Promise<FleetReadiness>`;
  `projectReadiness(fleet: FleetReadiness, floor: FloorState): ProjectReadiness`.

- [ ] **Step 1: Write the failing tests**

Append to `server/test/readiness.test.ts`:

```ts
import { measureFleetReadiness, projectReadiness } from '../src/readiness.js';
import { WORKER_SKILL_DIR, COORDINATOR_SKILL_DIR } from '../src/skillstate.js';

/** A ports double. Every port is explicit so a test says exactly which of the
 *  four preconditions it is exercising and leaves the others clean. */
const deps = (over: Partial<Parameters<typeof measureFleetReadiness>[0]> = {}) => ({
  io: { readFileMeasured: async () => ({ ok: true, content: 'x' }) as const },
  homes: [{ wrapper: 'claude', configDir: '/cfg-a' }],
  mailTokenPath: '/tok',
  coordProbe: () => 'available' as const,
  now: () => 1_700_000_000_000,
  ...over,
});

describe('measureFleetReadiness — the fleet-wide half', () => {
  it('reads BOTH skills in EVERY home, then the token, and nothing else', async () => {
    const seen: string[] = [];
    const io = { readFileMeasured: async (p: string) => {
      seen.push(p); return { ok: true, content: 'x' } as const; } };
    await measureFleetReadiness(deps({
      io, homes: [{ wrapper: 'a', configDir: '/a' }, { wrapper: 'b', configDir: '/b' }],
    }));
    expect(seen).toEqual([
      `/a/skills/${WORKER_SKILL_DIR}/SKILL.md`, `/a/skills/${COORDINATOR_SKILL_DIR}/SKILL.md`,
      `/b/skills/${WORKER_SKILL_DIR}/SKILL.md`, `/b/skills/${COORDINATOR_SKILL_DIR}/SKILL.md`,
      '/tok',
    ]);
  });

  it('folds a home that is missing the worker skill into a proven absence', async () => {
    const io = { readFileMeasured: async (p: string) =>
      (p.includes(WORKER_SKILL_DIR)
        ? { ok: false, reason: 'absent' } : { ok: true, content: 'x' }) as const };
    const r = await measureFleetReadiness(deps({ io }));
    expect(r.worker).toBe('absent');
    expect(r.coordinator).toBe('present');
  });

  it('a home whose read FAILED is unmeasurable, never absent', async () => {
    const io = { readFileMeasured: async () => ({ ok: false, reason: 'unreadable' }) as const };
    const r = await measureFleetReadiness(deps({ io }));
    expect(r.worker).toBe('unmeasurable');
    expect(r.coordinator).toBe('unmeasurable');
  });

  it('a wrapper with no config dir is unmeasurable for that home, not absent', async () => {
    const r = await measureFleetReadiness(deps({ homes: [{ wrapper: 'ghost', configDir: undefined }] }));
    expect(r.worker).toBe('unmeasurable');
  });

  it('the box token is RE-MEASURED at the path, so all three arms are reachable', async () => {
    const present = { readFileMeasured: async () => ({ ok: true, content: 'tok' }) as const };
    const gone = { readFileMeasured: async () => ({ ok: false, reason: 'absent' }) as const };
    const broken = { readFileMeasured: async () => ({ ok: false, reason: 'unreadable' }) as const };
    expect((await measureFleetReadiness(deps({ io: present }))).boxToken).toBe('configured');
    expect((await measureFleetReadiness(deps({ io: gone }))).boxToken).toBe('absent');
    expect((await measureFleetReadiness(deps({ io: broken }))).boxToken).toBe('unmeasurable');
  });

  it('the token VALUE never leaves the measurement — only its measurability', async () => {
    const io = { readFileMeasured: async () => ({ ok: true, content: 'super-secret-value' }) as const };
    const r = await measureFleetReadiness(deps({ io }));
    expect(JSON.stringify(r)).not.toContain('super-secret-value');
  });

  it('carries the coord probe verbatim — it does not re-decide it', async () => {
    for (const s of ['available', 'degraded', 'not-configured'] as const) {
      expect((await measureFleetReadiness(deps({ coordProbe: () => s }))).coordDb).toBe(s);
    }
  });

  it('stamps the sweep time from the injected clock', async () => {
    expect((await measureFleetReadiness(deps())).at).toBe(1_700_000_000_000);
  });
});

describe('projectReadiness — the per-project compose', () => {
  const fleet = { worker: 'present', coordinator: 'present', boxToken: 'configured',
    coordDb: 'available', at: 7 } as const;

  it('joins the project floor to the fleet half and derives the verdict once', () => {
    expect(projectReadiness(fleet, 'seeded')).toEqual({
      worker: 'present', coordinator: 'present', floor: 'seeded',
      boxToken: 'configured', coordDb: 'available', verdict: 'ready', at: 7 });
  });

  it('an unseeded floor blocks; an unmeasurable one is only unknown', () => {
    expect(projectReadiness(fleet, 'not-seeded').verdict).toBe('blocked');
    expect(projectReadiness(fleet, 'unmeasurable').verdict).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run it and record the RED**

```bash
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/readiness.test.ts
```
Expected: FAIL — `Cannot find module '../src/readiness.js'`. Record verbatim.

- [ ] **Step 3: Write the module**

Create `server/src/readiness.ts`:

```ts
import type { FleetIO } from './io.js';
import type {
  CoordDbState, FloorState, ProjectReadiness, SkillState, TokenState,
} from '../../shared/api.js';
import { foldSkillStates, readyVerdict } from '../../shared/api.js';
import { COORDINATOR_SKILL_DIR, WORKER_SKILL_DIR, readSkillState } from './skillstate.js';

/**
 * The program-ready measurement (program-leverage wave 3, F3).
 *
 * Lives OUTSIDE `server/src/coord/` on purpose: it must not import
 * `coord/db.js` or `node:sqlite`, and the one coord fact it needs — whether a
 * project's deviation floor row exists — arrives as a PORT its consumer
 * declares, the way wave 2's `configDir` port did (D-1015).
 *
 * Split in two because the two halves have different clocks. The FLEET-WIDE
 * half (both skills in every rostered HOME, the box token, the coordination
 * database) costs `2 * homes + 1` `readFileMeasured` calls — in remote fleet
 * mode that is one agent round trip each, 15 s ceiling apiece, with no batch
 * op in the protocol — so it belongs on a slow sweep and never on a request.
 * The PER-PROJECT half is one indexed SELECT and is composed at the route.
 */

/** One rostered HOME, already resolved. `configDir` is `undefined` for a
 *  wrapper this box's roster does not carry — a missing PATH, which is not a
 *  missing skill, and `readSkillState` keeps them apart. */
export interface ReadinessHome {
  readonly wrapper: string;
  readonly configDir: string | undefined;
}

export interface ReadinessDeps {
  readonly io: Pick<FleetIO, 'readFileMeasured'>;
  readonly homes: readonly ReadinessHome[];
  /** `cfg.mailTokenPath` — re-measured rather than reported from
   *  `deps.mailToken`, because that boot read has only two outcomes: a string,
   *  or a process that never started (D-1025). Re-measuring here is what makes
   *  `unmeasurable` a reachable answer instead of a decorative one, and it also
   *  catches a token removed or made unreadable AFTER boot, which the boot
   *  snapshot never could. */
  readonly mailTokenPath: string;
  /** Whether the coordination database answers. A closure, not a store handle:
   *  this module may not import `node:sqlite`, and the probe's own failure mode
   *  is the consumer's to catch. */
  readonly coordProbe: () => CoordDbState;
  readonly now?: () => number;
}

export interface FleetReadiness {
  readonly worker: SkillState;
  readonly coordinator: SkillState;
  readonly boxToken: TokenState;
  readonly coordDb: CoordDbState;
  readonly at: number;
}

export async function measureFleetReadiness(deps: ReadinessDeps): Promise<FleetReadiness> {
  const now = deps.now ?? Date.now;
  const worker: SkillState[] = [];
  const coordinator: SkillState[] = [];
  // SERIAL, not Promise.all: in remote mode each of these is an agent round
  // trip on one socket, and firing 2N at once buys nothing while making a
  // wedged agent's timeouts overlap into one unreadable stall.
  for (const home of deps.homes) {
    worker.push(await readSkillState(deps.io, home.configDir, WORKER_SKILL_DIR));
    coordinator.push(await readSkillState(deps.io, home.configDir, COORDINATOR_SKILL_DIR));
  }
  const token = await deps.io.readFileMeasured(deps.mailTokenPath);
  // Measurability only. The CONTENT is a shared box secret and is never
  // carried, logged or returned — `configured` is the whole answer.
  const boxToken: TokenState = token.ok
    ? 'configured' : token.reason === 'absent' ? 'absent' : 'unmeasurable';
  return {
    worker: foldSkillStates(worker),
    coordinator: foldSkillStates(coordinator),
    boxToken,
    coordDb: deps.coordProbe(),
    at: now(),
  };
}

/** Join one project's floor to the swept fleet half. The verdict is DERIVED
 *  here and nowhere else, so the badge renders an answer rather than folding
 *  five fields a second time. */
export function projectReadiness(fleet: FleetReadiness, floor: FloorState): ProjectReadiness {
  const facts = {
    worker: fleet.worker, coordinator: fleet.coordinator, floor,
    boxToken: fleet.boxToken, coordDb: fleet.coordDb,
  };
  return { ...facts, verdict: readyVerdict(facts), at: fleet.at };
}
```

- [ ] **Step 4: Run to GREEN**

```bash
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/readiness.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add server/src/readiness.ts server/test/readiness.test.ts
git commit -m "feat(wave3): the readiness measurement, ports-in and values-out"
```

---

## Task 4: The watcher sweeps it on a slow clock

**Files:**
- Modify: `server/src/watch.ts` (constant beside `LEDGER_FLOOR_SWEEP_MS:91`; two fields beside
  `lastLedgerFloor`; dispatch beside `:849`; the sweep method beside `sweepLedgerFloor:1918`;
  `currentReadiness()` beside the other `currentX()` accessors)
- Test: `server/test/readiness-sweep.test.ts` (**create**)

**Interfaces:**
- Consumes: `measureFleetReadiness`, `FleetReadiness` (Task 3); `configDirFor`
  (`server/src/config.ts:186`).
- Produces: `FleetWatcher.sweepReadiness(): Promise<void>`;
  `FleetWatcher.currentReadiness(): FleetReadiness | undefined` — `undefined` until the first sweep
  completes, exactly like `currentPending()` / `lifecycleHealth()`.

- [ ] **Step 1: Write the failing test**

Create `server/test/readiness-sweep.test.ts`. Build the watcher with the suite's existing helper
(`testDeps(home)` + `new FleetWatcher(deps, bus)`, the shape `ledger-sweep.test.ts` already uses),
an `io` double that records every path it is asked for, and an injectable clock. Each `it` below is
its own case:

```ts
  it('has not swept yet, so it answers undefined — not a fabricated clean bill', () => {
    expect(makeWatcher().currentReadiness()).toBeUndefined();
  });

  it('sweeps on the FIRST call rather than waiting out the interval', async () => {
    // the `lastX !== 0` idiom (watch.ts:1615, :1920): a restart must not leave
    // the badge blank for ten minutes.
    const w = makeWatcher();
    await w.sweepReadiness();
    expect(w.currentReadiness()?.worker).toBe('present');
  });

  it('does not re-sweep inside the interval', async () => {
    const w = makeWatcher();
    await w.sweepReadiness();
    const first = reads.length;
    await w.sweepReadiness();
    expect(reads.length).toBe(first);
  });

  it('re-sweeps once the interval has passed', async () => {
    const w = makeWatcher();
    await w.sweepReadiness();
    const first = reads.length;
    clock.advance(READINESS_SWEEP_MS + 1);
    await w.sweepReadiness();
    expect(reads.length).toBeGreaterThan(first);
  });

  it('walks every homeAble roster account and no others', async () => {
    // non-homeAble accounts have no HOME on this box; asking about them would
    // manufacture an `unmeasurable` that means nothing.
    const w = makeWatcher();
    await w.sweepReadiness();
    expect(configDirsAsked).toEqual(homeAbleConfigDirs);
  });

  it('a coord.db read that THROWS is reported degraded, not swallowed', async () => {
    const w = makeWatcher({ coord: { ledgerFloor() { throw new Error('SQLITE_BUSY'); } } });
    await w.sweepReadiness();
    expect(w.currentReadiness()?.coordDb).toBe('degraded');
  });

  it('no coord store at all is not-configured, which is a different word', async () => {
    const w = makeWatcher({ coord: undefined });
    await w.sweepReadiness();
    expect(w.currentReadiness()?.coordDb).toBe('not-configured');
  });

  it('the probe uses a project name no real project can have', async () => {
    const asked: string[] = [];
    const w = makeWatcher({ coord: { ledgerFloor(p: string) { asked.push(p); return null; } } });
    await w.sweepReadiness();
    expect(asked).toHaveLength(1);
    expect(isSafeProjectSegment(asked[0])).toBe(false);
  });

  it('a later failing sweep says so honestly rather than keeping a stale clean bill', async () => {
    const w = makeWatcher();
    await w.sweepReadiness();
    expect(w.currentReadiness()?.worker).toBe('present');
    io.failEverything();
    clock.advance(READINESS_SWEEP_MS + 1);
    await w.sweepReadiness();
    expect(w.currentReadiness()?.worker).toBe('unmeasurable');
  });
```

- [ ] **Step 2: Run it and record the RED**

```bash
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/readiness-sweep.test.ts
```
Expected: FAIL — `w.sweepReadiness is not a function`. Record verbatim.

- [ ] **Step 3: Implement the sweep**

In `server/src/watch.ts`, beside `LEDGER_FLOOR_SWEEP_MS`:

```ts
/** Ten minutes. Slower than the divergence sweep (60 s) because the answer
 *  changes only when someone installs a skill or edits a token, and faster
 *  than the ledger floor's hour because an operator waiting to start a program
 *  is watching this one. */
const READINESS_SWEEP_MS = 600_000;

/** The name the coord probe asks about. `isSafeProjectSegment` REJECTS it
 *  (a leading space), so it can never collide with a real project's row. */
const READINESS_PROBE_PROJECT = ' readiness-probe';
```

fields beside `lastLedgerFloor`:

```ts
  private lastReadinessSweep = 0;
  private readiness: FleetReadiness | undefined;
```

the accessor, beside the other `currentX()` methods:

```ts
  /** `undefined` until the first sweep lands — the same contract as
   *  `currentPending()`. The route turns that into `readiness: null` on the
   *  wire, which is NOT the same as omitting the key (an older server). */
  currentReadiness(): FleetReadiness | undefined { return this.readiness; }
```

the sweep, beside `sweepLedgerFloor`:

```ts
  async sweepReadiness(): Promise<void> {
    const now = this.now();
    if (this.lastReadinessSweep !== 0 && now - this.lastReadinessSweep < READINESS_SWEEP_MS) return;
    this.lastReadinessSweep = now;
    const cfg = this.deps.cfg;
    const homes = cfg.roster.homeAble.map((a) => ({
      wrapper: a.id, configDir: configDirFor(cfg, a.id),
    }));
    this.readiness = await measureFleetReadiness({
      io: this.deps.io,
      homes,
      mailTokenPath: cfg.mailTokenPath,
      // A REAL read, not a null-check: `deps.coord` being present proves a
      // handle exists, not that it answers. `ledgerFloor` on a name no project
      // can have is the cheapest statement that exercises the path — null on a
      // healthy store, a throw on a sick one, which is exactly the distinction
      // `degraded` carries. The two existing sites that learn this
      // (`emitRuns` here, the cold start in `server.ts`) both drop it on the
      // floor; this one records it.
      coordProbe: () => {
        const coord = this.deps.coord;
        if (!coord) return 'not-configured';
        try { coord.ledgerFloor(READINESS_PROBE_PROJECT); return 'available'; }
        catch { return 'degraded'; }
      },
      now: () => now,
    });
  }
```

and the dispatch from `tick()`, beside the other two, never awaited:

```ts
      void this.sweepReadiness().catch(() => { /* one bad sweep must not kill the poll */ });
```

- [ ] **Step 4: Run to GREEN, then the neighbouring watcher suites**

```bash
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run \
  test/readiness-sweep.test.ts test/ledger-sweep.test.ts test/fleetws.test.ts
```
Expected: PASS, all three. `fleetws` carries the frame-order pin — it must not move.

- [ ] **Step 5: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add server/src/watch.ts server/test/readiness-sweep.test.ts
git commit -m "feat(wave3): the watcher sweeps readiness on a ten-minute clock"
```

---

## Task 5: `GET /api/projects` carries it

**Files:**
- Modify: `server/src/lifecycle.ts:125-128` (return `ProjectRow[]`)
- Modify: `server/src/server.ts:1515` (the handler)
- Test: `server/test/lifecycle.test.ts` (extend the `listProjects` and route describes)

**Interfaces:**
- Consumes: `ProjectRow`, `FloorState` (Task 1); `projectReadiness` (Task 3);
  `watcher.currentReadiness()` (Task 4).
- Produces: the wire contract — `{roots: string[], projects: ProjectRow[]}`, each row carrying
  `readiness` as an object, or `null`, or (on a server without this feature) no key at all.

- [ ] **Step 1: Write the failing tests**

```ts
  it('carries a per-project readiness once the watcher has swept', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    const row = res.json().projects.find((p: ProjectRow) => p.name === 'demo');
    expect(row.readiness).toMatchObject({ verdict: 'ready', floor: 'seeded' });
  });

  it('carries readiness: null — not an absent key — before the first sweep', async () => {
    const res = await appWithUnsweptWatcher.inject({ method: 'GET', url: '/api/projects' });
    const row = res.json().projects[0];
    expect(row).toHaveProperty('readiness');
    expect(row.readiness).toBeNull();
  });

  it('a project with NO run still gets an answer — this is the case the feature exists for', async () => {
    // nothing in coord.db names `fresh`; it has never had a run.
    const row = (await app.inject({ method: 'GET', url: '/api/projects' }))
      .json().projects.find((p: ProjectRow) => p.name === 'fresh');
    expect(row.readiness.floor).toBe('not-seeded');
    expect(row.readiness.verdict).toBe('blocked');
  });

  it('a floor read that THROWS is unmeasurable for that project and does not fail the request', async () => {
    const res = await appWithThrowingFloor.inject({ method: 'GET', url: '/api/projects' });
    expect(res.statusCode).toBe(200);
    expect(res.json().projects[0].readiness.floor).toBe('unmeasurable');
    expect(res.json().projects[0].readiness.verdict).toBe('unknown');
  });

  it('one project throwing does not blank the others', async () => {
    const rows = (await appWithOneThrowingProject.inject({ method: 'GET', url: '/api/projects' }))
      .json().projects;
    expect(rows.map((r: ProjectRow) => r.readiness?.floor)).toEqual(['unmeasurable', 'seeded']);
  });

  it('the box token VALUE is not on the wire', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(res.body).not.toContain(BOX_TOKEN_FIXTURE_VALUE);
  });

  it('listProjects itself still returns rows with NO readiness key — the route composes it', async () => {
    // `listProjects` is the fleet read; readiness is the route's join. Keeping
    // them apart is what lets the route answer while the watcher is unswept.
    const out = await listProjects(localIO, cfg);
    expect(out.projects.every((p) => !('readiness' in p))).toBe(true);
  });
```

- [ ] **Step 2: Run it and record the RED**

```bash
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/lifecycle.test.ts
```
Expected: FAIL — `expected undefined to match object { verdict: 'ready', floor: 'seeded' }`.

- [ ] **Step 3: Widen the type, then compose at the route**

`server/src/lifecycle.ts` — import `ProjectRow` and use it, so the projects wire shape stops being
declared inline (D-1028):

```ts
export async function listProjects(
  io: FleetIO,
  cfg: CcrcConfig,
): Promise<{ roots: string[]; projects: ProjectRow[] }> {
```
The body is unchanged — it never sets `readiness`, and the last test above pins that. The internal
`byWorkdir` map's value type widens to `ProjectRow` with it.

`server/src/server.ts:1515`:

```ts
  // The readiness join (program-leverage wave 3, F3). Read ONCE off the
  // watcher, exactly the way `/api/fleet` reads `watcher?.currentPending()` —
  // the expensive half is swept on a ten-minute clock and this handler must
  // not re-measure it. THREE outcomes reach the wire and they are three
  // different facts: no key (a build without this feature), `null` (this build,
  // not swept yet), an object (measured).
  app.get('/api/projects', async () => {
    const listed = await listProjects(deps.io, deps.cfg);
    const fleet = watcher?.currentReadiness();
    if (fleet === undefined) {
      return { ...listed, projects: listed.projects.map((p) => ({ ...p, readiness: null })) };
    }
    const coord = deps.coord;
    return {
      ...listed,
      projects: listed.projects.map((p) => {
        // Caught PER PROJECT: one unreadable row must not blank the rest, and
        // a failed read is `unmeasurable` — never `not-seeded`, which would
        // send an operator to seed a floor that may already exist.
        let floor: FloorState;
        try {
          floor = coord === undefined ? 'unmeasurable'
            : coord.ledgerFloor(p.name) === null ? 'not-seeded' : 'seeded';
        } catch { floor = 'unmeasurable'; }
        return { ...p, readiness: projectReadiness(fleet, floor) };
      }),
    };
  });
```

- [ ] **Step 4: Run to GREEN**

```bash
cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run \
  test/lifecycle.test.ts test/workspaces-route.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add server/src/lifecycle.ts server/src/server.ts server/test/lifecycle.test.ts
git commit -m "feat(wave3): GET /api/projects carries a per-project readiness"
```

---

## Task 6: The badge

**Files:**
- Create: `pwa/src/fleet/readinessWords.ts`
- Modify: `pwa/src/fleet/StartProgramSheet.tsx:50` (drop the local `Project`), `:233`, `:256`,
  `:258` (the renames), and the project row render
- Modify: `pwa/src/fleet/fleet.css`
- Test: `pwa/test/start-program.test.tsx`, `pwa/test/fleet-css.test.ts`

**Interfaces:**
- Consumes: `ProjectRow`, `ProjectReadiness`, `READY_VERDICT_MAP`, `FLOOR_STATE_MAP`,
  `TOKEN_STATE_MAP`, `COORD_DB_STATE_MAP`, `SKILL_STATE_MAP` (Task 1 / wave 2).
- Produces: `READY_GLYPH`, `readinessWord(r)`, `missingPreconditions(r): string[]`.

- [ ] **Step 1: Write the failing tests**

```tsx
  it('renders program-ready with a word AND a glyph, never colour alone', async () => {
    renderSheet({ projects: [row('demo', ready())] });
    expect(await screen.findByText(/program-ready/)).toBeTruthy();
    expect(document.querySelector('.proj-ready[data-verdict="ready"]')).toBeTruthy();
  });

  it('names the missing preconditions when blocked', async () => {
    renderSheet({ projects: [row('demo', { ...ready(), worker: 'absent', verdict: 'blocked' })] });
    const el = await screen.findByText(/not ready/);
    expect(el.getAttribute('title')).toContain('not installed');
  });

  it('says unknown — not "not ready" — when a precondition could not be measured', async () => {
    renderSheet({ projects: [row('demo', { ...ready(), floor: 'unmeasurable', verdict: 'unknown' })] });
    expect(await screen.findByText(/readiness unknown/)).toBeTruthy();
  });

  it('an OLDER SERVER omitting the key renders NO badge and no broken row', async () => {
    const raw = { name: 'demo', workdir: '/w/demo' } as Record<string, unknown>;
    renderSheet({ projects: [raw as unknown as ProjectRow] });
    expect(await screen.findByText('demo')).toBeTruthy();
    expect(document.querySelector('.proj-ready')).toBeNull();
  });

  it('readiness: null renders the pending arm — a DIFFERENT arm from the absent key', async () => {
    renderSheet({ projects: [{ name: 'demo', workdir: '/w/demo', readiness: null }] });
    expect(document.querySelector('.proj-ready[data-verdict="pending"]')).toBeTruthy();
  });
```

Add `.proj-ready` to `pwa/test/fleet-css.test.ts:567-579`'s inert-selector array in the same step.

- [ ] **Step 2: Run and record the RED**

```bash
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run test/start-program.test.tsx
```
Expected: FAIL — `Unable to find an element with the text: /program-ready/`.

- [ ] **Step 3: Write the words module, DERIVED from the shared maps**

`pwa/src/fleet/readinessWords.ts`:

```ts
import type { ProjectReadiness, ReadyVerdict } from '../../../shared/api';
import {
  COORD_DB_STATE_MAP, FLOOR_STATE_MAP, READY_VERDICT_MAP, SKILL_STATE_MAP, TOKEN_STATE_MAP,
} from '../../../shared/api';

/** The two-cue rule: a word AND a glyph, never colour alone. Keyed BY the type,
 *  like every other table on this board, so a new verdict is a compile error
 *  here rather than a silently unlabelled badge. */
export const READY_GLYPH: Record<ReadyVerdict, string> = {
  ready: '*', blocked: '!', unknown: '?',
};

export function readinessWord(r: ProjectReadiness): string {
  return READY_VERDICT_MAP[r.verdict];
}

/** The sentence behind the badge: every precondition that is NOT ok, said in
 *  its own vocabulary's words. Never a hand-typed list of the members — the
 *  maps are the single definition, and a free-standing array of those words is
 *  a `single-definition` red by design. */
export function missingPreconditions(r: ProjectReadiness): string[] {
  const out: string[] = [];
  if (r.worker !== 'present') out.push(`worker skill ${SKILL_STATE_MAP[r.worker]}`);
  if (r.coordinator !== 'present') out.push(`coordinator skill ${SKILL_STATE_MAP[r.coordinator]}`);
  if (r.floor !== 'seeded') out.push(FLOOR_STATE_MAP[r.floor]);
  if (r.boxToken !== 'configured') out.push(TOKEN_STATE_MAP[r.boxToken]);
  if (r.coordDb !== 'available') out.push(COORD_DB_STATE_MAP[r.coordDb]);
  return out;
}
```

Pick the two glyphs to match the board's existing set — read `pwa/src/fleet/runWords.ts:12-30` and
`coordWords.ts:22-32` and reuse their characters rather than inventing a third alphabet.

- [ ] **Step 4: Render it**

In `StartProgramSheet.tsx`, delete the local `interface Project` (`:50`), import `ProjectRow` from
`'../../../shared/api'`, and rename its three uses (`:233`, `:256`, `:258`). Then, in the project
row, beside the project name:

```tsx
{/* THREE arms, because the wire has three (shared/api.ts's ProjectRow):
    key absent -> this server does not measure readiness, render nothing;
    null -> it does and has not swept, say so; object -> the answer. */}
{p.readiness === undefined ? null : p.readiness === null ? (
  <span className="proj-ready" data-verdict="pending" title="measuring program readiness">
    ... checking
  </span>
) : (
  <span className="proj-ready" data-verdict={p.readiness.verdict}
    title={p.readiness.verdict === 'ready' ? 'all program preconditions hold'
      : missingPreconditions(p.readiness).join('; ')}>
    {READY_GLYPH[p.readiness.verdict]} {readinessWord(p.readiness)}
  </span>
)}
```

- [ ] **Step 5: CSS, scoped under a painter so the contrast auditor grounds it**

Read `fleet.css` around the sheet's project list and find the selector that actually sets
`background` on a project row; scope the badge under THAT, not under a guessed class name. The rules
themselves:

```css
/* Scoped under the row, which paints its own ground — an unscoped coloured
 * rule lands in the auditor's UNCOVERED census (pwa/design/audit.mjs:519-544).
 * Inert by contract: no glow, no animation, no box-shadow (fleet-css.test.ts). */
<the painting selector> .proj-ready { font-family: var(--font-mono); flex: none; color: var(--ink-tertiary); }
<the painting selector> .proj-ready[data-verdict='ready'] { color: var(--status-live-text); }
<the painting selector> .proj-ready[data-verdict='blocked'] { color: var(--status-dead-text); }
```

- [ ] **Step 6: Run the PWA suites and the type build**

```bash
cd "$(git rev-parse --show-toplevel)/pwa" && ./node_modules/.bin/vitest run \
  test/start-program.test.tsx test/fleet-css.test.ts test/contrast.test.ts && npm run build
```
Expected: PASS, and `Type Errors no errors`.

- [ ] **Step 7: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add pwa/src/fleet/readinessWords.ts pwa/src/fleet/StartProgramSheet.tsx pwa/src/fleet/fleet.css \
  pwa/test/start-program.test.tsx pwa/test/fleet-css.test.ts
git commit -m "feat(wave3): the start-program sheet says whether a project is program-ready"
```

---

## Task 7: Whole-branch verification and the handoff

- [ ] **Step 1: Run the mutation table.** Apply each mutation ALONE, run the named suite, copy the
  FIRST failing assertion VERBATIM into the execution record, revert before the next. Wave 2's review
  minor was that 14 of 19 rows recorded counts instead of assertion text — **counts alone do not meet
  this plan's own bar.** The spec requires at least one row per precondition; rows 3.1, 3.2, 4.1 and
  5.1 are those four.

| # | Mutation | Suite |
|---|---|---|
| 1.1 | `foldSkillStates` returns `'present'` for `[]` | `readiness` |
| 1.2 | `foldSkillStates` checks `unmeasurable` before `absent` | `readiness` |
| 1.3 | `readyVerdict` returns `unknown` when a cell is `blocked` | `readiness` |
| 1.4 | `READY_VERDICTS` hand-typed as an array literal | `single-definition` |
| 2.1 | `readWorkerSkillState` delegates with `COORDINATOR_SKILL_DIR` | `skillstate`, `dispatch-skillstate` |
| 3.1 | **precondition (1)** — delete the coordinator read from `measureFleetReadiness` | `readiness` |
| 3.2 | **precondition (3)** — report a boolean from the boot token instead of re-measuring the path | `readiness` |
| 3.3 | the token's `unreadable` arm answers `absent` | `readiness` |
| 3.4 | `measureFleetReadiness` returns the token content | `readiness` |
| 4.1 | **precondition (4)** — `coordProbe` returns `available` whenever `coord` is set | `readiness-sweep` |
| 4.2 | delete the first-run `!== 0` guard (never sweeps on boot) | `readiness-sweep` |
| 4.3 | delete the interval check (sweeps every tick — 2N agent round trips per 2 s) | `readiness-sweep` |
| 4.4 | the probe asks about a name `isSafeProjectSegment` accepts | `readiness-sweep` |
| 5.1 | **precondition (2)** — delete the floor read; hard-code `'seeded'` | `lifecycle` |
| 5.2 | a throwing floor answers `not-seeded` instead of `unmeasurable` | `lifecycle` |
| 5.3 | the per-project `try` moved outside the loop (one bad row blanks all) | `lifecycle` |
| 5.4 | unswept watcher omits the key instead of sending `null` | `lifecycle`, `start-program` |
| 6.1 | the badge renders for `readiness === undefined` | `start-program` |
| 6.2 | the badge folds `null` and `undefined` into one arm | `start-program` |
| 6.3 | `missingPreconditions` hand-types the member words | `single-definition` |

- [ ] **Step 2: Run all three suites in full, FOREGROUND, timeout >= 600000**

```bash
cd "$(git rev-parse --show-toplevel)/server" && npm run test
cd "$(git rev-parse --show-toplevel)/agent"  && npm run test
cd "$(git rev-parse --show-toplevel)/pwa"    && npm run test
```
Re-run any of the known load flakes (`ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`,
`ccd-session-state`) IN ISOLATION before calling one a real break.

- [ ] **Step 3: Write the execution record** into this plan — the reds measured before the code, the
  mutation table with verbatim assertion text, the suite totals, and every deviation consumed.

- [ ] **Step 4: Push, open the PR, and wait for CI green on the tip.**

- [ ] **Step 5: Measure the fingerprint ONCE, after the last push, and mail it ONCE.**

```bash
cd "$(git rev-parse --show-toplevel)" && git rev-parse HEAD
```
`branchTip` = that sha, `handoffCommit` = the same sha, `prNumber` = the PR, `prPhase` = one of the
eight enum words, READ not invented. Then **stop pushing** (worker clause 9).

---

## Deviations found

### D-1023 (spec finding, measured before planning) — both seams §5 names are structurally disqualified

Spec §5 offers `GET /api/runs` "or the coord status emit" and delegates the choice. Neither can carry
the feature: the runs body cannot speak about a project with no run (`runs r JOIN programs p`,
`store.ts:819-836`), cannot express precondition (4) (`!deps.coord` 501s at `routes.ts:1259` before a
body exists), and its shape is shared with a synchronous 2 s emitter; the coord frame has no project
names in scope at its emit point, which is deliberately above the registry fail-shut and pinned
(`fleetws.test.ts:843-869`). Put to the operator with the measurements; ruling: ship on
`GET /api/projects`, badge in the start-program sheet only. Recorded rather than silently re-scoped.

### D-1024 (spec finding) — precondition (4) has no reachable `false` in the shipped process

`deps.coord` is constructed unconditionally (`index.ts:66`) and `openCoordDb` refuses to start rather
than open empty (`db.ts:139-151`, `:191-228`), so `!deps.coord` fires only for a caller that builds
`Deps` another way — i.e. `testDeps`. A field hard-wired to `available` would have been vacuous. The
real runtime failure the spec did not name is a coord.db read that THROWS after boot, which today is
swallowed to `console.warn` at `watch.ts:974-987` and `server.ts:1226-1240` and recorded nowhere.
`CoordDbState` therefore carries `degraded` as its second arm and keeps `not-configured` as a third
that the shipped process cannot reach — a build that omitted it could never report the day that
changes. The sweep's probe is a real read for the same reason: a handle existing is not a handle
answering.

### D-1025 (spec finding) — precondition (3)'s `unmeasurable` arm does not exist at boot

`readMailToken` returns `null` only for ENOENT and throws uncaught for every other errno, an empty
file, or the unedited placeholder (`token.ts:135-155`), so a server that could not measure its token
never started. Reporting `deps.mailToken` would have shipped a two-state answer wearing a three-state
type. The sweep re-measures `cfg.mailTokenPath` with `readFileMeasured`, which makes the third arm
real and additionally catches a token removed or made unreadable after boot. Only measurability
crosses the boundary; the value never does, and two tests assert it.

### D-1026 (design finding) — the aggregate cannot be a boolean

The approved wire sketch carried `ready: false`. A boolean folds "we proved a precondition missing"
into "we could not tell", which is the exact overloaded value this wave's own constraint forbids.
Shipped as `ReadyVerdict = 'ready' | 'blocked' | 'unknown'`, with `blocked` outranking `unknown` so a
proven failure is still reported while something else is unmeasurable. Flagged to the coordinator in
the wave-done mail, since it changes the shape the operator saw.

### D-1027 (deliberate narrowing, recorded not hidden) — "installed" is wider than "SKILL.md is readable"

`ccd/install-coordinator-skill.sh:70-78` requires five reference files beside `SKILL.md` and refuses
the install without them; this measurement reads `SKILL.md` alone, so a home whose refs were deleted
reads `present`. Chosen on cost — each ref is another agent round trip in remote mode, five per home
on top of two — and because the ref-level verdict belongs to the doctor lane the graphify branch owns
(the fold ruling: converge on the vocabulary, not the code). `skillPath` takes the dir as a parameter
so a later caller can widen it without a second join.

### D-1028 (drift found while picking the seam) — the projects wire shape had no single definition

`listProjects`'s row type was declared inline at `lifecycle.ts:125-128` and again as a local
`interface Project` at `StartProgramSheet.tsx:50`. Adding `readiness` to hand-kept copies is how a
field ends up meaning two things; `ProjectRow` in `shared/api.ts` is now the one definition and every
side imports it.

**This entry was WRONG when first written, and the correction is the interesting half.** It claimed
"both sides", and there were THREE: `pwa/src/lib/api.ts`'s `getJson<{roots, projects: {name,
workdir}[]}>` generic — sitting two lines under a comment that says *"a field added in Stage 2a is
exactly the kind of addition that lands in two of three copies. The generic is the contract now."*
`readiness` was precisely that field. Nothing failed, because the twin still typechecks: `readiness`
is optional, so the narrower type is assignable and the runtime JSON carries the field regardless —
the declared contract simply went on denying a field the server had already started sending. Found in
self-review with the PR already open, not by any test, which is why `single-definition.test.ts` now
scans the four roots for an inline twin of the row and requires zero holders (measured: restoring the
twin reds it, `an inline twin of the projects row — import ProjectRow from shared/api instead:
expected [ 'pwa/src/lib/api.ts' ] to deeply equal []`).

### D-1029 (drift in the brief, re-measured) — the graphify tip has moved

The wave-3 brief names `ws/ccrc-with-graphify-integration` at `92bf6b76`; `git ls-remote` reads
`fd6ddfdd` (two later commits, a Darwin-lane fold). The fold conclusion is unchanged — the only file
both lanes touch is `server/test/single-definition.test.ts`, where graphify appends at EOF, so this
wave's pin goes mid-file inside the existing Build 8 describe and the merge stays clean by
construction.

### D-1033 (defect I shipped, found in self-review with the PR open) — the badge's third grid column re-flowed the row when the badge was absent

`.proj-row` was `grid-template-columns: 14px 1fr`, with `.proj-name` and `.proj-dir` AUTO-PLACED into
column 2 on successive rows. Widening the track to `14px 1fr auto` for the badge broke that in the one
case the badge is not rendered — a server too old to send `readiness` renders no span at all, leaving
column 3 empty, so auto-placement puts `.proj-dir` at row 1 column 3, beside the name instead of under
it. Every test stayed green: jsdom does not lay out a grid, and the three PWA suites assert on classes
and text, not geometry.

Fixed by pinning `.proj-name` and `.proj-dir` to `grid-column: 2` explicitly, so the layout no longer
depends on whether a conditional child rendered, and pinned by a `fleet-css` assertion over all three
columns (measured: removing `.proj-dir`'s pin reds it, `expected 'font: var(--weight-regular)var(--text…'
to contain 'grid-column: 2'`). The general lesson, and the reason this is a deviation rather than a
quiet fix: **a conditionally-rendered grid child changes the placement of its siblings**, and no suite
in this repo can see it.

### D-1030 (defect I nearly shipped, found by mutation) — scoping under a painter in ANOTHER stylesheet grounds nothing

This plan's Task 6 said to scope the badge under a painter so the contrast auditor could resolve its
ground. I did — `.sheet-panel`, which sets `background: var(--bg-sheet)` — and `contrast.test.ts` went
green. It was green for the wrong reason. `audit()` classified all three badge rules as
**`uncovered`**: the auditor's descendant route only grounds a rule against painters in the SAME
stylesheet, and `.sheet-panel` lives in `components/primitives.css` while the badge lives in
`fleet.css`. The rules' contrast was never measured, and the census entry looked identical to a rule
nobody had thought about.

Found by mutating an invented token (`--status-live-text`, which does not exist) into the `ready` arm:
`audit.mjs:224` throws on an unknown custom property, and the suite stayed **GREEN, 0 red**. Fixed with
three `INHERITED_GROUNDS` entries — base rule plus both coloured arms, registered separately for the
reason the `.auth-block-sub` entry already states: grounding only the base would leave half the badge
measured while the report looked covered. After the fix `audit()` reports 6 measured pairs, 0 problems,
and the same mutation reds 4. The `.sess-spawn` entry is the precedent; this one differs in that its
selector DOES name an ancestor, which is exactly why it looked safe.

### D-1031 (pre-existing, measured, NOT introduced here) — the `lastX !== 0` first-run guard is inert

Mutation 4.2 deleted the `!== 0` conjunct from the sweep's interval guard and **survived: 0 red**. It is
not a missing test — the conjunct cannot matter. With `lastReadinessSweep` at `0` and any real epoch
clock, `now - 0` is ~1.7e12, which already exceeds any interval this tree uses, so the first call falls
through on the arithmetic alone. The same is true of the two ledger lanes and the divergence lane that
spell the idiom identically, so this is a property of the existing tree rather than something this wave
introduced, and fixing three other lanes is outside this wave's scope.

Kept for symmetry with those neighbours and because it states the intent readably. What changed is the
prose: the sweep's comment and the test that claims "sweeps on the FIRST call" both used to cite the
`!== 0` idiom as the thing enforcing it, which was false. Both now say what actually enforces it.

### D-1032 (defect I shipped, caught by the whole-branch run) — `as const` in the wrong place typechecks under vitest and not under tsc

Four `FleetIO` doubles in `readiness.test.ts` were written as `{ readFileMeasured: async () => ({...}) }
as const`, and one as `(cond ? {...} : {...}) as const`. Every one of their tests PASSED — vitest
transforms with esbuild, which strips types without checking them — and `typecheck-tests.test.ts` then
failed the whole-branch run with `Type 'boolean' is not assignable to type 'true'` and TS1355 (a const
assertion cannot be applied to a ternary). `as const` on the outer object does not reach the inner
return. Fixed by giving the doubles a named `ReadDouble = Pick<FleetIO, 'readFileMeasured'>`
annotation, which contextually types the literal instead. Recorded because the lesson generalises: in
this repo a green single-suite run is not a typecheck, and the tests-inclusive project is a separate
gate that only the full run reaches.

---

## Notes for the coordinator

- **Not agent-first.** No `ccd/`, no `session-hook.sh`, no skill corpus. Server + PWA only.
- **The badge is PWA-only by construction.** `GET /api/projects` is not in the auth `EXEMPT` table,
  so with `CCRC_AUTH` armed it needs a live session cookie — which the PWA has and the cookieless
  coordinator does not. That is the right posture for an operator affordance, and it is why no skill
  reference documents this field.
- **D-1026 changes the shape the operator approved** (`ready: false` became a three-valued
  `verdict`). Called out here so the ledger carries it.
- Deviations consumed: **D-1023..D-1033**. Block `D-999..1046`; `1034+` free after this wave.

## Self-review

**Spec coverage.** §5's four preconditions each get a measurement, a false arm, an unmeasurable arm
where one is reachable, and a mutation row (3.1, 5.1, 3.2, 4.1). "Computed server-side from reads the
server already owns" — every read is an existing primitive on an existing path; no new ccd verb, no
new route. "Additively on an existing read the /runs board already consumes" — `GET /api/projects`,
consumed by the sheet the board mounts unconditionally. "Compact per-project badge" — Task 6. The two
seams §5 *suggested* are not used, and D-1023 records the measurement and the ruling.

**Placeholder scan.** No TBD, no "add error handling", no "similar to Task N". Three steps ask the
implementer to read the tree rather than trust this plan — Task 6's painting selector, Task 6's glyph
characters, and Task 4's watcher-construction helper. Each names the file to read and why; they are
read-the-tree instructions with stated reasons, not placeholders.

**Type consistency.** `readSkillState(io, configDir, skillDir)` is spelled identically in Tasks 2, 3
and the mutation table. `projectReadiness(fleet, floor)` matches its use in Task 5.
`currentReadiness()` matches Tasks 4 and 5. `ProjectRow.readiness?: ProjectReadiness | null` is the
same three-valued shape in Tasks 1, 5 and 6. `FleetReadiness` (no `floor`) and `ProjectReadiness`
(with `floor` and `verdict`) are kept distinct everywhere they appear.


---

## Execution record (measured, 2026-08-29)

Every red below was OBSERVED, not predicted. Mutations were applied ONE AT A TIME by a driver script
that patches, runs the named suite, captures the first failing assertion verbatim, and reverts before
the next — so no two mutations were ever live together.

**Suite results, whole branch, after the graphify merge (the numbers that stand).** `server` 239 files
/ **5969 passed** / 56 skipped; `agent` **281 passed** (18 files); `pwa` 75 files / **1983 passed**,
`Type Errors no errors`. All three run in the foreground, cd'd into the package. No load flake needed
re-running in isolation on any pass.

(Before that merge, on this wave's own tree: `server` 235 files / 5901 passed / 54 skipped; `agent`
280; `pwa` 1982.)

Two earlier full runs failed, both correctly: the first on `typecheck-tests` (real type errors no
single suite could see — D-1032) and on `deviation-refs` (D-1030 and D-1031 were cited in code before
this section defined them). The `deploy: FAILED — $CCRC_BOX is not set` lines in the server output are
`deploy-coordinates.test.ts`'s own expected stdout, asserting deploy.sh refuses rather than guessing a
target; they are not failures.

### Reds measured before the code that answers them

| Pin | Suite | Failing assertion, verbatim |
|---|---|---|
| The four vocabularies are defined once | `single-definition` | `FloorState: expected [] to deeply equal [ 'shared/api.ts' ]` (3 red) |
| The two pure folds | `readiness` | `TypeError: foldSkillStates is not a function` (11 red) |
| The parameterised skill read | `skillstate` | `TypeError: skillPath is not a function` (5 red) |
| The measurement module | `readiness` | `Cannot find module '../src/readiness.js'` |
| The sweep and its accessor | `readiness-sweep` | `TypeError: f.watcher.sweepReadiness is not a function` (12 red) |
| The route join | `lifecycle` | `expected undefined to deeply equal { worker: 'present', …(6) }` (6 red) |
| The badge | `start-program` | `Unable to find an element with the text: /program-ready/` (4 red) |

### Mutation table

Every row carries the FIRST failing assertion verbatim — wave 2's review minor was that 14 of 19 rows
recorded only counts, and this plan's own Task 7 set that bar.

| # | Mutation | Suite | red | First failing assertion, verbatim |
|---|---|---|---|---|
| 1.1 | `foldSkillStates` answers `present` for `[]` | `readiness` | 1 | `AssertionError: expected 'present' to be 'unmeasurable' // Object.is equality` |
| 1.2 | `unmeasurable` checked before `absent` | `readiness` | 1 | `AssertionError: expected 'unmeasurable' to be 'absent' // Object.is equality` |
| 1.3 | `readyVerdict` lets `unknown` outrank `blocked` | `readiness` | 1 | `AssertionError: expected 'unknown' to be 'blocked' // Object.is equality` |
| 1.4 | `READY_VERDICTS` hand-typed as an array literal | `single-definition` | 1 | `AssertionError: READY_VERDICTS is not derived from READY_VERDICT_MAP: expected '// Shared API types — single source o…' to match /export const READY_VERDICTS[^=]*=\s*…/` |
| 2.1 | `readWorkerSkillState` delegates to the COORDINATOR dir | `skillstate`, `dispatch-skillstate` | 8 | `AssertionError: expected { ok: true, id: 1, …(8) } to match object { ok: true, skillState: 'present' }` |
| 3.1 | **P1** — delete the coordinator read | `readiness` | 3 | `AssertionError: expected [ …(3) ] to deeply equal [ …(5) ]` |
| 3.2 | **P3** — box token as a two-state boot-style read | `readiness` | 1 | `AssertionError: expected 'absent' to be 'unmeasurable' // Object.is equality` |
| 3.3 | **P3** — token failure polarity swapped | `readiness` | 1 | `AssertionError: expected 'unmeasurable' to be 'absent' // Object.is equality` |
| 3.4 | the token VALUE rides along on the result | `readiness` | 1 | `AssertionError: expected '{"worker":"present","coordinator":"pr…' not to contain 'not-a-real-secret-value'` |
| 4.1 | **P4** — probe answers `available` whenever a handle exists | `readiness-sweep` | 2 | `AssertionError: expected 'available' to be 'degraded' // Object.is equality` |
| 4.2 | delete the first-run `!== 0` conjunct | `readiness-sweep` | **0** | **SURVIVED — see D-1031** |
| 4.3 | delete the interval check (sweeps every tick) | `readiness-sweep` | 1 | `AssertionError: expected 18 to be 9 // Object.is equality` |
| 4.4 | probe asks a name `isSafeProjectSegment` ACCEPTS | `readiness-sweep` | 1 | `AssertionError: expected true to be false // Object.is equality` |
| 5.1 | **P2** — delete the floor read, hard-code `seeded` | `lifecycle` | 4 | `AssertionError: expected 'seeded' to be 'not-seeded' // Object.is equality` |
| 5.2 | a throwing floor answers `not-seeded` | `lifecycle` | 2 | `AssertionError: expected 'not-seeded' to be 'unmeasurable' // Object.is equality` |
| 5.3 | remove the per-project catch | `lifecycle` | 2 | `AssertionError: expected 500 to be 200 // Object.is equality` |
| 5.4 | unswept watcher OMITS the key instead of sending `null` | `lifecycle` | 2 | `AssertionError: expected [ { name: 'MekWarLive', …(1) }, …(3) ] to deeply equal [ { name: 'MekWarLive', …(2) }, …(3) ]` |
| 6.1 | the badge renders for an ABSENT key | `start-program` | 38 | `TypeError: Cannot read properties of undefined (reading 'verdict')` |
| 6.2 | the badge folds `null` and `undefined` into one arm | `start-program` | 1 | `AssertionError: expected null to be truthy` |
| 6.3 | `missingPreconditions` hand-types the member words | `single-definition` | 1 | `AssertionError: expected [ 'pwa/src/fleet/readinessWords.ts' ] to deeply equal []` |
| 6.4 | an unknown custom property in the badge's `ready` arm | `contrast` | 4 | `FAIL ------ (audit) DARK fleet.css .sheet-panel .proj-ready[data-verdict='ready']: unknown custom property --status-live-text` |

**Mutation 6.4 is the one that mattered most, and it is recorded twice on purpose.** Run BEFORE
D-1030's fix it reported **0 red** — the badge's colour rules were not measured at all. The row above
is the post-fix measurement. A mutation that passes is not always a strong pin; sometimes it is a
missing one.

### Two of the driver's own mutations were WRONG, and are recorded rather than hidden

- **5.3 as first written was malformed.** Replacing `try {` with `if (true) {` left a dangling
  `} catch {`, so the run reported `Error: Transform failed with 1 error:` — a syntax failure, not a
  measurement. A mutation that does not compile proves nothing about the pin. Re-done as an actual
  removal of the try/catch: 2 red, `expected 500 to be 200`.
- **4.2 is a correct mutation with a real result**, not a bad anchor: the conjunct it deletes cannot
  change behaviour under any real clock. That is D-1031, and the fix was to the prose that claimed
  otherwise, not to the code.

### What the whole-branch run caught that no single suite did

`typecheck-tests.test.ts` failed on four test doubles that every one of their own tests had passed
(D-1032). vitest transforms with esbuild and does not typecheck, so a green single-suite run says
nothing about the tests-inclusive project. Worth carrying: run the full suite before believing a
green file.

### Deviations consumed

**D-1023 .. D-1033.** All eleven are defined above; none was invented, and the block (`D-999..1046`, this
program's) is not exceeded. `deviation-refs` measures the tracked-tree maximum and the plan-defined
maximum as equal at **D-1033**.
