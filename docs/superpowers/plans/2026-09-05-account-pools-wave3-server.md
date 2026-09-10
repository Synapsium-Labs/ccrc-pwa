# Account pools — wave 3: the server refuses, forecasts and relays; it never places — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the server one pure copy of the pool rule, one measured reader of `~/.cc-sessions/pools/`, a fail-shut `stranded` registry field, a per-project pool/placement on `GET /api/projects`, a change-guarded `pools` frame, a `projectPools` health arm, the `project-pool` tag route, and a `crossPool` override on swap/sessions — so the console refuses, forecasts and relays what `ccd` decides, and never places.

**Architecture:** Three rings, in this order. `server/src/poolrule.ts` (L1) is a pure relabelling of L0's `poolRule` against this box's roster — no clock, no `node:`, no `reply`. `server/src/pools.ts` (L3) turns the registry root listing plus one `pools/` listing into a four-state answer per project, using the parent listing to split "directory absent" from "directory unlistable" (`io.readdir` has no measured sibling). `server/src/server.ts` and `server/src/watch.ts` (L4) own fastify, timers and the sockets, and CALL `poolVerdict`/`poolFor` — they never re-derive the rule. Everything on the wire is additive; `FLEET_PROTO` stays 1.

**Tech Stack:** TypeScript (ESM, `"type":"module"`), Node >= 22.13.0, Fastify, vitest, `node:sqlite` (untouched here). Four packages, each run cd'd in: `server/`, `agent/`, `pwa/`, `shared/`.

**Spec:** docs/superpowers/specs/2026-09-04-account-pools-design.md

**Base:** origin/main `db580771` (#67, the C1 carry); branch `ws/clear-meadow`.
Written against `2b15144e` on `ws/amber-summit` — both were re-pointed at execution, and the branch
matters as much as the sha: `ws/amber-summit` is the COORDINATOR's workspace, and a worker committing
there would leave its own branch tip unmoved and wedge every close with `stale-tip`.

> **EVERY `:NNN` IN THIS PLAN IS A SNAPSHOT OF A 2026-09-04 TREE. NAVIGATE BY SYMBOL.**
> Re-measured file by file at execution, against `db580771`:
>
> | file | drift | verdict |
> |---|---|---|
> | `shared/api.ts` | **+13 to +134**, growing with position in the file | every citation stale; grep the symbol |
> | `server/src/ccdargv.ts` | 0 early, **+35** at `POOLS_CAP` (its own docstring grew) | mixed; grep |
> | `server/src/fleet.ts` | **+8** (its one citation) | stale |
> | `server/src/server.ts` | **+1**, and **+2** at the roster emission | near-exact; still verify |
> | `registry.ts`, `io.ts`, `remote/io.ts`, `limits.ts`, `lifecycle.ts`, `fleetstate.ts`, `coord/mirrorplan.ts`, `pwa/src/lib/api.ts`, `watch.ts`, `auth/gate.ts`, `auth-gate.test.ts` | **0** | EXACT — do not "correct" these |
>
> No cited symbol is missing on `db580771`, and no anchor is ambiguous once the surrounding prose is
> read — the numbers are wrong, the names are not. Two anchors whose bare form recurs tree-wide and
> must be taken WITH their file: `const read = async (io = localIO) =>` (twice in `registry.test.ts`,
> :1007 and :1142) and `const collect = (ws: WebSocket` (`fleetws.test.ts:53` and `sessionws.test.ts:62`).
> Per the coordinator's ruling 3 the forty numbers are NOT patched — a patched number goes stale
> again on the next merge, and correcting one implies the other hundred were audited. Locate by
> symbol; where a step below cites a line this pass actually touched, it is corrected in place.

## Global Constraints

- Fixture HOMEs only. Never run any `ccd` verb against the live `$HOME`; never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or any `claude-session@*` unit. `mkTmp` (`server/test/tmpHelpers.ts`) and `makeCcdHarness` (`server/test/ccdWsHelpers.ts`) are the two doors.
- No account name, account label, pool name, host name or IP that belongs to any real fleet appears in any source file, test or document. Fixture names only: pools `pool-a`, `pool-b`; projects `demo`, `quiet-basin`, `acct-a-demo`; accounts `claude`, `claude-a`, `claude-b` (label `team·b`), `gpt`, `claude-d` (`server/test/helpers.ts:60`, `DEFAULT_TEST_ROSTER`).
- Wire discipline is ADDITIVE-ONLY: `FLEET_PROTO` stays 1 and `FLEET_PROTO_MIN` stays 1 (`shared/api.ts:2876-2877`). A new frame type, a new optional field and a new required-with-`| null` field are all additive; a bump is not.
- No overloaded null at a seam: two conditions a caller handles differently must not collapse to one value. `unreadable` is never folded into `untagged`; `absent` is never folded into `unlistable`.
- Every change under `ccd/` is AGENT-FIRST at deploy time. **This wave touches no file under `ccd/`** — it consumes what waves 2a/2b shipped there — so it carries no deploy step of its own.
- `EXEC_COMMANDS` stays `['tmux','ccd']`. No `gh` grant, ever. The server writes nothing on the fleet box.
- L0 (`shared/*.ts`) imports nothing, not even `node:*` — the PWA bundles those files.
- Mutation-table discipline: every guard ships WITH a test measured RED before and GREEN after. Each test step below names the exact mutation and the exact expected red.
- Deviation numbers come only from `POST /api/ledger/deviations`, allocated and defined in one act. This plan's plan-time numbers, D-1679–D-1684, were minted in ONE call and defined in `## Deviations found` at plan commit; `LEDGER:` lines and inline references inside the tasks REFERENCE them. A deviation found during execution is allocated in its own call at the moment it is found.

## Wave map

| Wave | Plan |
|---|---|
| 1 | `docs/superpowers/plans/2026-09-05-account-pools-wave1-roster.md` — roster field, mirrors, generator, `RosterWire`, `shared/poolrule.ts`, the fixture table |
| 2a | `docs/superpowers/plans/2026-09-05-account-pools-wave2a-ccd-tag-placement.md` — `ccd project-pool`, `_project_pool_state`, `_pool_ok`, `_ws_least_loaded [project]`, the agent grant, the two `CCD_ARGV` entries, `POOLS_CAP`, `POOLS_DIR_NAME`, `rehome`, the doctor check |
| 2b | `docs/superpowers/plans/2026-09-05-account-pools-wave2b-ccd-swap-strand-crossing.md` — the auto-swap tick, the strand, the crossing marker, `--cross-pool` on the four manual verbs |
| **3** | **this plan** |
| 4 | `docs/superpowers/plans/2026-09-05-account-pools-wave4-pwa.md` — PWA |
| 5 | `docs/superpowers/plans/2026-09-05-account-pools-wave5-docs.md` — README, CLAUDE.md, comment corrections |

**This wave CONSUMES (must already be on the branch):**

- From wave 1 — `shared/roster.ts`: `POOL_NAME_RE` (`/^[a-z][a-z0-9-]{0,31}$/`), `AccountDef.pool: string | null` (required on the type, `null` = untagged), `'pool'` in `ACCOUNT_KEYS`. `shared/api.ts`: `PoolsEnforcement`, `ProjectPoolWire`, `ProjectPoolsWire`, `RosterWire.pool` (and its emission at `server/src/server.ts:1186`, which wave 1 must have landed or `tsc` is already red). `shared/poolrule.ts`: `poolRule(accountPool: string | null, projectPool: ProjectPoolWire): PoolVerdict` and the `PoolVerdict` union. `server/test/fixtures/poolRule.ts`: `PoolRuleCase`, `POOL_RULE_CASES`, `POOLED_TEST_ROSTER`.
- From wave 2a — `server/src/pools.ts` existing with ONLY `export const POOLS_DIR_NAME = 'pools';` (this wave fills the module), `CCD_ARGV.projectPoolSet` / `CCD_ARGV.projectPoolClear`, `export const POOLS_CAP = 'pools-v1'` beside `ACTOR_FLAGS_CAP` (`server/src/ccdargv.ts:346`), the `project-pool` verb in `ccd caps`, and the agent grant `['project-pool','--project']`.
- From wave 2a (the OTHER half of that wave, in `ccd/ccd`) — `_project_pool_state`, `_pool_ok`, `_acct_pool`, `POOLS_DIR`, and `_ws_least_loaded [project]` (optional positional; zero-arg unchanged). **Task 4 is a BUILD dependency on these**: it drives the bash side of `server/test/fixtures/leastLoaded.ts` through the real `ccd`, and is red without them.
- From wave 2b — `_strand_mark`/`_strand_clear` and `$REG/<id>.stranded` on the fleet box. A RUNTIME dependency only: Task 3 reads that file's shape and seeds it by hand in fixtures, so this wave builds and passes without wave 2b — but the field stays permanently null on a real fleet until 2b ships.

**This wave PRODUCES (later waves rely on these exact names):**

- `server/src/poolrule.ts` (L1): `RosterVerdict`, `poolVerdict(roster, wrapper, pool)`, `poolEligible(roster, pool)`, `poolUndecidable(pool)`, `poolRostered(roster, name)`; re-export of `ProjectPlacement`.
- `server/src/pools.ts` (L3): `ProjectPoolsRead`, `readProjectPools(io, cfg, rootNames)`, `poolFor(read, project)`, `poolsEnforcement(ccdVerbs)`, `poolsWire(read, enforcement)`.
- `server/src/limits.ts`: `projectHome(roster, limits, pool)` (third argument REQUIRED), `projectPlacement(roster, limits, pool)`.
- `server/src/registry.ts`: `SessionRecord.stranded`, `STRANDED_NO_REASON`, `STRANDED_UNREADABLE`.
- `shared/api.ts`: `ProjectPlacement`, `FleetSession.stranded`, `reviveStranded`, `ProjectRow.pool?`, `ProjectRow.placement?`, `FleetMsg | { type: 'pools'; pools: ProjectPoolsWire }`, `FleetHealth.projectPools?`.
- `server/src/ccdargv.ts`: `CCD_ARGV.swapCross`, `CCD_ARGV.startCross`, `CCD_ARGV.enableCross`.
- Routes: `POST /api/projects/:project/pool`; `crossPool?: boolean` on `POST /api/sessions/:id/swap` and `POST /api/sessions`; `pools?: ProjectPoolsWire` on `GET /api/fleet`.
- Wave 4 (PWA) consumes: `ProjectPoolWire`/`ProjectPoolsWire`/`PoolsEnforcement`/`ProjectPlacement` from `shared/api.ts`, the `pools` frame, `ProjectRow.pool`/`.placement`, `FleetSession.stranded`, `FleetHealth.projectPools`, and the three route shapes above.

---

### Task 1 — DONE 2026-09-08 (5/5 mutations red)
### Task 1: `server/src/poolrule.ts` — the server's L1 mirror of the rule

**Files:**
- Create: `server/src/poolrule.ts`
- Modify: `shared/api.ts` (add `ProjectPlacement` beside `ProjectedHome`, `:2565-2569`)
- Test: `server/test/pools.test.ts` (create)

**Interfaces:**
- Consumes: `poolRule(accountPool: string | null, projectPool: ProjectPoolWire): PoolVerdict` and `PoolVerdict` from `shared/poolrule.js` (wave 1); `ProjectPoolWire` from `shared/api.js` (wave 1); `Roster`, `AccountDef` types from `shared/roster.js`; `POOL_RULE_CASES`, `PoolRuleCase`, `POOLED_TEST_ROSTER` from `server/test/fixtures/poolRule.js` (wave 1).
- Produces:
  ```ts
  // shared/api.ts (L0)
  export type ProjectPlacement =
    | { kind: 'projected'; wrapper: string; score: number }
    | { kind: 'none'; pool: string | null }
    | { kind: 'unmeasurable' };

  // server/src/poolrule.ts (L1)
  export type RosterVerdict = PoolVerdict | { ok: true; why: 'account-not-in-roster' };
  export function poolVerdict(roster: Roster, wrapper: string, pool: ProjectPoolWire): RosterVerdict;
  export function poolEligible(roster: Roster, pool: ProjectPoolWire): AccountDef[];
  export function poolUndecidable(pool: ProjectPoolWire): boolean;
  export function poolRostered(roster: Roster, name: string): boolean;
  export type { ProjectPlacement };   // re-export, so the type is one hop from the rule
  ```

**Spec:** §5.2 (the rule, spelled once per language), §5.6 (the server's mirror), §8 (ring placement — L1, purity-scanned), §11 rows 7 (L1 half) and 8.

**Mutation table:**
- Row 7 (L1 half) — `pools.test.ts` drives `poolVerdict` over `POOL_RULE_CASES`. Goes RED when the rule drifts from L0's, when a fixture class is deleted (the floor assertions), or when the `account-not-in-roster` relabel swallows an undecidable answer.
- Row 8 — the purity scan. Goes RED when `server/src/poolrule.ts` grows a clock, a `node:` import, a `reply`/fastify reference, a store reference, or a SECOND value import.

**Note on `ProjectPlacement`'s home:** the spec's §5.6 code block declares it in `poolrule.ts`. It is DECLARED in `shared/api.ts` instead and re-exported here, because the PWA (wave 4) renders `ProjectRow.placement` and cannot import from `server/src`. The brief already requires the move; this task does it, and the re-export keeps a reader who looks for it beside the rule from finding nothing.

- [ ] **Step 1: Write the failing test**

Create `server/test/pools.test.ts`:

```ts
// The server's half of "the rule, spelled once per language" (spec §5.2). L0's
// `poolRule` is the rule; this file proves the SERVER's relabelling of it —
// against a roster, with the not-in-roster pass-through — still answers the
// shared fixture table exactly, and that the module holding it stays L1-pure.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRoster } from '../../shared/roster.js';
import { poolEligible, poolRostered, poolUndecidable, poolVerdict } from '../src/poolrule.js';
import { POOL_RULE_CASES, POOLED_TEST_ROSTER, type PoolRuleCase } from './fixtures/poolRule.js';

/** A one-account roster carrying exactly the case's account pool. The key is
 *  OMITTED for `null`: `parseAccount` refuses a literal `null` in JSON and
 *  reads an absent key as untagged, so this is the only spelling that round
 *  trips (wave 1, spec §5.3). */
const rosterWith = (pool: string | null) => parseRoster({
  version: 1,
  accounts: [{
    id: 'a', label: 'A', configDirSuffix: '.a', exec: { kind: 'upstream' },
    homeAble: true, hue: 'cyan', telemetry: 'anthropic',
    ...(pool === null ? {} : { pool }),
  }],
});

/** The fixture's three-word answer space, read off a `RosterVerdict`. */
const word = (v: ReturnType<typeof poolVerdict>): PoolRuleCase['expect'] =>
  v.ok ? 'serve' : v.reason === 'pool-mismatch' ? 'mismatch' : 'undecidable';

describe('poolVerdict answers the shared fixture table', () => {
  it('the table is not vacuous — a floor, and every class represented', () => {
    // ANTI-VACUITY FIRST: `it.each([])` reports green, which is the one failure
    // mode that makes a table-driven suite worse than none.
    expect(POOL_RULE_CASES.length).toBeGreaterThanOrEqual(10);
    for (const cls of ['serve', 'mismatch', 'undecidable'] as const) {
      expect(POOL_RULE_CASES.filter((c) => c.expect === cls).length, cls).toBeGreaterThan(0);
    }
    for (const state of ['tagged', 'untagged', 'malformed', 'unreadable'] as const) {
      expect(POOL_RULE_CASES.filter((c) => c.project.state === state).length, state).toBeGreaterThan(0);
    }
  });

  it.each(POOL_RULE_CASES.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(word(poolVerdict(rosterWith(c.accountPool), 'a', c.project))).toBe(c.expect);
  });
});

describe('poolVerdict and the roster', () => {
  const r = parseRoster(POOLED_TEST_ROSTER);

  it('passes a wrapper this roster does not have through as account-not-in-roster', () => {
    // ccd's `_is_valid_wrapper` is the authority, and the PWA already offers
    // live non-roster wrappers (spec §5.6). Refusing here would 409 a swap ccd
    // would have carried out.
    expect(poolVerdict(r, 'nobody', { state: 'tagged', name: 'pool-a' }))
      .toEqual({ ok: true, why: 'account-not-in-roster' });
  });

  it('still refuses to decide an unreadable tag for a wrapper it does not have', () => {
    // PRECEDENCE. "If pool(p) cannot be read, NOBODY decides" (spec §5.2) —
    // the relabel above must touch the ok arm only, or an unreadable tag plus
    // an unknown wrapper would permit the very placement 503 exists to stop.
    expect(poolVerdict(r, 'nobody', { state: 'unreadable' }))
      .toEqual({ ok: false, reason: 'pool-undecidable', state: 'unreadable' });
    expect(poolVerdict(r, 'nobody', { state: 'malformed' }))
      .toEqual({ ok: false, reason: 'pool-undecidable', state: 'malformed' });
  });

  it('names the two pools on a mismatch, so the 409 can render both sides', () => {
    expect(poolVerdict(r, 'claude-b', { state: 'tagged', name: 'pool-a' }))
      .toEqual({ ok: false, reason: 'pool-mismatch', accountPool: 'pool-b', projectPool: 'pool-a' });
  });
});

describe('poolEligible', () => {
  const r = parseRoster(POOLED_TEST_ROSTER);
  const ids = (pool: Parameters<typeof poolEligible>[1]): string[] =>
    poolEligible(r, pool).map((a) => a.id);

  it('keeps in-pool AND untagged home-able accounts for a tagged project', () => {
    // An untagged account is unconstrained — tagging only tightens (ruling 3).
    expect(ids({ state: 'tagged', name: 'pool-a' })).toEqual(['claude', 'claude-a', 'claude-d']);
    expect(ids({ state: 'tagged', name: 'pool-b' })).toEqual(['claude-b', 'claude-d']);
  });

  it('keeps every home-able account for an untagged project, and gpt is never home-able', () => {
    expect(ids({ state: 'untagged' })).toEqual(['claude', 'claude-a', 'claude-b', 'claude-d']);
  });

  it('is EMPTY when nobody can decide — an undecidable tag places nothing', () => {
    expect(ids({ state: 'unreadable' })).toEqual([]);
    expect(ids({ state: 'malformed' })).toEqual([]);
  });
});

describe('poolUndecidable and poolRostered', () => {
  const r = parseRoster(POOLED_TEST_ROSTER);

  it('undecidable is the two states in which nobody decides, derived from the rule', () => {
    expect(poolUndecidable({ state: 'unreadable' })).toBe(true);
    expect(poolUndecidable({ state: 'malformed' })).toBe(true);
    expect(poolUndecidable({ state: 'untagged' })).toBe(false);
    expect(poolUndecidable({ state: 'tagged', name: 'pool-a' })).toBe(false);
  });

  it('poolRostered walks EVERY account, not just the home-able ones', () => {
    // ccd's own warning walks `CCRC_ACCOUNTS` (spec §5.4.2), which includes the
    // non-home-able lane; a home-able-only test would warn `unknown-pool` for a
    // pool whose only member is that lane.
    expect(poolRostered(r, 'pool-a')).toBe(true);
    expect(poolRostered(r, 'pool-b')).toBe(true);
    expect(poolRostered(r, 'pool-c')).toBe(false);
  });
});

// The purity scan, copied from `coord-caps-policy.test.ts:124-172` with ONE
// deliberate difference, stated rather than smuggled: that file demands EVERY
// import line be `import type`, and this module has exactly one value import —
// `poolRule` from `shared/poolrule.js`, itself L0 and importing nothing. That
// import is the whole point (the rule is spelled once), so the assertion below
// pins it EXACTLY: one value import, and it must be that one.
describe('poolrule.ts is the pure L1 module its own docstring says it is', () => {
  const SRC = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'poolrule.ts'),
    'utf8');

  /** Comments blanked, positions preserved — without it this module's own
   *  docstring, which NAMES `reply` while promising not to use it, reds every
   *  assertion below. */
  const code = (): string => SRC
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));

  it('the scan is over real code, not an empty string', () => {
    expect(code()).toContain('export function poolVerdict');
    expect(code().replace(/\s/g, '').length).toBeGreaterThan(400);
  });

  it('has no clock', () => {
    expect(code(), 'poolrule.ts reads the clock — the decision is no longer pure')
      .not.toMatch(/\bDate\s*\.\s*now\s*\(|\bnew\s+Date\s*\(|performance\s*\.\s*now/);
  });

  it('has no fs and no other node builtin', () => {
    expect(code(), 'poolrule.ts imports a node builtin').not.toMatch(/from\s+'node:/);
    expect(code(), 'poolrule.ts reaches for a filesystem').not.toMatch(/\bfs\s*\.|require\s*\(/);
  });

  it('has no fastify, no reply, no store, no io', () => {
    expect(code(), 'poolrule.ts names a reply — an L1 decision does not answer HTTP')
      .not.toMatch(/\breply\b|\bFastify|\bapp\s*\./);
    expect(code(), 'poolrule.ts reaches a store or the fs facade')
      .not.toMatch(/CoordStore|\bstore\s*\.|FleetIO/);
  });

  it('takes exactly ONE value import, and it is L0 poolRule', () => {
    const imports = [...code().matchAll(/^\s*import\b[^\n]*/gm)].map((m) => m[0]!.trim());
    expect(imports.length, 'no imports found — the scan is over nothing').toBeGreaterThan(0);
    const values = imports.filter((l) => !/^import\s+type\b/.test(l));
    expect(values, 'poolrule.ts takes a value import that is not the L0 rule')
      .toEqual(["import { poolRule } from '../../shared/poolrule.js';"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/pools.test.ts`
Expected: FAIL — `Error: Failed to load url ../src/poolrule.js` (the module does not exist), reported as an unhandled import error for the whole file.

- [ ] **Step 3: Write minimal implementation**

Add to `shared/api.ts`, immediately after the `ProjectedHome` interface (`:2565-2569`, which ends `}` before the `RosterWire` docstring):

```ts
/**
 * Where a new workspace for ONE PROJECT would land, once that project's pool
 * tag is applied (`GET /api/projects`'s `placement`). `ProjectedHome` above is
 * the same forecast for an UNTAGGED project and stays exactly what it was.
 *
 * THREE MEMBERS, and `unmeasurable` is a VALUE, not a null (spec §5.6): a
 * project whose tag could not be read has no forecast, and saying `none` there
 * would claim a measurement — "nothing can take this project" — that nobody
 * made. `none` carries the pool it was looking in (`null` for an untagged
 * project) so a renderer can say WHICH pool is empty without re-deriving it.
 */
export type ProjectPlacement =
  | { kind: 'projected'; wrapper: string; score: number }
  | { kind: 'none'; pool: string | null }
  | { kind: 'unmeasurable' };
```

Create `server/src/poolrule.ts`:

```ts
import { poolRule } from '../../shared/poolrule.js';
import type { PoolVerdict } from '../../shared/poolrule.js';
import type { ProjectPlacement, ProjectPoolWire } from '../../shared/api.js';
import type { AccountDef, Roster } from '../../shared/roster.js';

/**
 * THE SERVER'S MIRROR of the pool rule (spec §5.6), ring L1: pure decisions,
 * type-only imports plus the ONE value import of L0's `poolRule` — which is
 * the point of the file. The rule is spelled once per LANGUAGE, not once per
 * module: `shared/poolrule.ts` holds the TypeScript spelling and both this
 * module and the PWA consume it, so a "second copy" here would be a third
 * spelling of a two-spelling rule.
 *
 * What this module adds that L0 cannot: a ROSTER. L0 takes an account's pool;
 * the server takes a wrapper NAME and has to look it up, and the lookup can
 * miss. `pools.test.ts` purity-scans this file (no clock, no `node:`, no
 * `reply`, no store, no `FleetIO`) the way `coord-caps-policy.test.ts` scans
 * `caps.ts`.
 *
 * The server REFUSES and FORECASTS; it never places (spec §5.1). Every verdict
 * below is a pre-check the box will re-take for itself.
 */

/**
 * L0's verdict plus the one answer only a roster-holder can give.
 *
 * `account-not-in-roster` is an `ok` member on purpose: `ccd`'s
 * `_is_valid_wrapper` is the authority on what a wrapper is, and the PWA
 * already offers live wrappers this box's `accounts.json` does not name (spec
 * §5.6). Refusing an account we merely cannot see would 409 a swap the fleet
 * would have carried out — the server inventing a policy instead of mirroring
 * one.
 */
export type RosterVerdict = PoolVerdict | { ok: true; why: 'account-not-in-roster' };

/**
 * May `wrapper` serve a project whose tag reads `pool`?
 *
 * EVERY ANSWER COMES OUT OF `poolRule`, including the not-in-roster one: the
 * miss is handled by asking the rule with a `null` account pool and then
 * RELABELLING only its `ok` arm. That is what keeps the precedence intact —
 * an `unreadable`/`malformed` tag is undecidable for everyone, roster member
 * or not, so it must still answer `pool-undecidable` here (spec §5.2's "nobody
 * decides"). A `null` account pool can never produce `pool-mismatch`, so the
 * relabel provably cannot swallow a refusal.
 */
export function poolVerdict(roster: Roster, wrapper: string, pool: ProjectPoolWire): RosterVerdict {
  const account = roster.byId.get(wrapper);
  if (account !== undefined) return poolRule(account.pool, pool);
  const v = poolRule(null, pool);
  return v.ok ? { ok: true, why: 'account-not-in-roster' } : v;
}

/**
 * The home-able accounts that may serve a project with this tag, in roster
 * declaration order — `_ws_least_loaded`'s candidate set, pool-filtered.
 *
 * EMPTY for an undecidable tag, and that is not the same fact as "every lane
 * is disabled": callers must ask {@link poolUndecidable} first if they need to
 * tell the two apart (`projectPlacement` in `limits.ts` does).
 */
export function poolEligible(roster: Roster, pool: ProjectPoolWire): AccountDef[] {
  return roster.homeAble.filter((a) => poolRule(a.pool, pool).ok);
}

/**
 * Are we in the state where NOBODY decides — `unreadable` or `malformed`?
 *
 * DERIVED FROM THE RULE, not from a second list of state tokens: an untagged
 * account is the most permissive input there is, so `poolRule(null, pool)`
 * refuses exactly when the tag itself is undecidable. A hand-written
 * `state === 'unreadable' || state === 'malformed'` here would be the second
 * copy that drifts the day a fifth state is added.
 */
export function poolUndecidable(pool: ProjectPoolWire): boolean {
  return !poolRule(null, pool).ok;
}

/**
 * Does ANY rostered account carry this pool name?
 *
 * EVERY account, not just the home-able ones — `ccd`'s own stderr warning
 * walks `CCRC_ACCOUNTS` (spec §5.4.2), and a pool whose only member is the
 * non-home-able lane is a real pool. Drives the tag route's
 * `warning: 'unknown-pool'`, which is a WARNING and not a refusal because this
 * box's roster copy can lag the fleet's (spec §3.3, O4).
 */
export function poolRostered(roster: Roster, name: string): boolean {
  return roster.accounts.some((a) => a.pool === name);
}

/** Re-exported so a reader who looks for the placement type beside the rule
 *  finds it. DECLARED in `shared/api.ts`, because the PWA renders it. */
export type { ProjectPlacement };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/pools.test.ts`
Expected: PASS — all describes green.

- [ ] **Step 5: Measure the mutations**

Run each mutation, confirm the named RED, then revert it before the next.

1. In `poolVerdict`, change `const v = poolRule(null, pool); return v.ok ? … : v;` to `return { ok: true, why: 'account-not-in-roster' };`
   Expected RED: `poolVerdict and the roster > still refuses to decide an unreadable tag for a wrapper it does not have` — `expected { ok: true, why: 'account-not-in-roster' } to deeply equal { ok: false, reason: 'pool-undecidable', … }`.
2. In `poolEligible`, drop the filter: `return [...roster.homeAble];`
   Expected RED: `poolEligible > keeps in-pool AND untagged home-able accounts for a tagged project` — `expected [ 'claude', 'claude-a', 'claude-b', 'claude-d' ] to deeply equal [ 'claude', 'claude-a', 'claude-d' ]`.
3. In `poolRostered`, change `roster.accounts` to `roster.homeAble`.
   Expected RED: nothing, on THIS roster (both pools have home-able members) — so ALSO add a case: `expect(poolRostered(parseRoster({ version: 1, accounts: [{ id: 'gpt', label: 'gpt', configDirSuffix: '.claude-gpt', exec: { kind: 'external' }, homeAble: false, hue: 'magenta', telemetry: 'none', pool: 'pool-b' }, { id: 'claude', label: 'claude', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' }] }), 'pool-b')).toBe(true);` to the `poolRostered` test, re-run the mutation, and confirm it reds with `expected false to be true`. Keep the added case.
4. Add `const now = Date.now();` to `poolVerdict`.
   Expected RED: `poolrule.ts is the pure L1 module … > has no clock`.
5. Change the `poolRule` import to `import { poolRule } from '../../shared/poolrule.js'; import { localIO } from './io.js';` and reference `localIO` once.
   Expected RED: `takes exactly ONE value import, and it is L0 poolRule` — the array contains two entries.

- [ ] **Step 6: Commit**

```bash
git add shared/api.ts server/src/poolrule.ts server/test/pools.test.ts
git commit -m "feat(pools): the server mirrors the rule in L1 and never re-derives it"
```

---

### Task 2 — DONE 2026-09-08 (6/6 plan mutations red; row 20a 4 red + 1 documented no-op, D-2017)
### Task 2: `server/src/pools.ts` — the measured reader, four states in, four states out

**Files:**
- Modify: `server/src/pools.ts` (wave 2a left it holding only `POOLS_DIR_NAME`)
- Test: `server/test/project-pools-read.test.ts` (create)

**Interfaces:**
- Consumes: `POOLS_DIR_NAME` (wave 2a); `FleetIO`, `MeasuredRead` from `./io.js`; `CcrcConfig` from `./config.js`; `POOL_NAME_RE` from `shared/roster.js` (wave 1); `ProjectPoolWire`, `ProjectPoolsWire`, `PoolsEnforcement` from `shared/api.js` (wave 1); `CCD_ARGV` from `./ccdargv.js`.
- Produces:
  ```ts
  export type ProjectPoolsRead =
    | { listed: false }
    | { listed: true; tags: Map<string, ProjectPoolWire> };
  export async function readProjectPools(
    io: FleetIO, cfg: CcrcConfig, rootNames: readonly string[] | null,
  ): Promise<ProjectPoolsRead>;
  export function poolFor(read: ProjectPoolsRead, project: string): ProjectPoolWire;
  export function poolsEnforcement(ccdVerbs: readonly string[] | null): PoolsEnforcement;
  export function poolsWire(read: ProjectPoolsRead, enforcement: PoolsEnforcement): ProjectPoolsWire;
  ```

**Spec:** §5.4.4 (the algorithm, verbatim), §5.4.5 (wire), §3.7 (`readdir` has no measured sibling), §8 (L3 — may not narrow), §11 row 20.

**Mutation table:**
- Row 20 — `project-pools-read.test.ts`. Goes RED when the `rootNames.includes(POOLS_DIR_NAME)` gate is deleted (absent directory would answer `unreadable` instead of `untagged`), when the null-`readdir` arm returns an empty map instead of `{listed:false}` (unlistable would answer `untagged` — the tag silently lifted), when the dot-leading skip is removed, or when a mid-read `absent` is treated as anything but a skip.
- Row 20a (coordinator ruling 1) — `project-pools-read.test.ts`'s `a tag padded to 64 bytes is malformed, and 63 still strips to a name`. Goes RED three separate ways, which is why it is one case and not three: DELETE the cap entirely and the 64-byte tag strips back to `pool-a` (`tagged`, disagreeing with `ccd`); WEAKEN it to `> 64` and the same case answers `tagged` while the 65-byte input a looser test would have used still passes (D-2010 — the mutant a `> 64`-shaped test cannot see); MOVE it below the strip and the padding is gone before it is measured, so the length check reads 6. The 63-byte half is the anti-mutant: a cap written `>= 63`, or one applied to the STRIPPED value, takes that arm to `malformed` and reds too. **The `\0` arm is NOT pinned and cannot be** — measured, and recorded as D-2017 rather than dressed up: delete `.includes('\0')` and all 14 cases stay green, because `POOL_NAME_RE` is anchored and its class excludes `\0`, so every NUL-bearing content is already `malformed` by the grammar. Four mutations measured red for this row (delete the cap, `> 64`, `>= 63`, cap below the strip); the fifth is a documented no-op with a void condition, not a row.

**LEDGER:** `io.readdir` is still the one read in `server/src/io.ts` with no measured sibling (`:96`, `string[] | null`), so this reader resolves the absent/unlistable collapse OUT OF BAND, using the registry root listing the caller already holds. One residual is accepted and disclosed rather than closed: a regular file (or an EACCES directory) at `$REG/pools` answers `{listed:false}`, which makes EVERY project read `unreadable` — the correct polarity (nobody decides, nothing crosses) but a fleet-wide one, and the only shape of `pools/` trouble that cannot be attributed to a single project (D-1680 — plan-time, no spec label).

- [ ] **Step 1: Write the failing test**

Create `server/test/project-pools-read.test.ts`:

```ts
// Spec §5.4.4. `io.readdir` answers `string[] | null` and folds "the directory
// is not there" into "the directory would not list" (`io.ts:96` — the one read
// with no measured sibling). This reader splits them ONE LEVEL UP, off the
// registry root listing the caller already took, the same trick `readLimits`
// plays for `-disabled` markers. Getting that split wrong in the permissive
// direction silently LIFTS every project's pool constraint, which is the whole
// class of defect this feature exists inside.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { localIO } from '../src/io.js';
import { CCD_ARGV } from '../src/ccdargv.js';
import {
  POOLS_DIR_NAME, poolFor, poolsEnforcement, poolsWire, readProjectPools,
} from '../src/pools.js';
import { absentReadIO, degradedReadIO } from './ioDoubles.js';
import { seedRoster } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

let home: string;
let reg: string;
let pools: string;

beforeEach(() => {
  home = mkTmp('ccrc-pools-read-');
  seedRoster(home);
  reg = path.join(home, '.cc-sessions');
  pools = path.join(reg, POOLS_DIR_NAME);
  mkdirSync(reg, { recursive: true });
});

afterEach(() => { rmSync(home, { recursive: true, force: true }); });

const cfg = () => loadConfig({ CCRC_HOME: home });
const rootNames = async (): Promise<string[] | null> => localIO.readdir(reg);
const tag = (project: string, bytes: string): void => {
  mkdirSync(pools, { recursive: true });
  writeFileSync(path.join(pools, project), bytes);
};

describe('readProjectPools — absent, unlistable and the four per-entry states', () => {
  it('a null ROOT listing is listed:false — the registry itself could not be read', async () => {
    const read = await readProjectPools(localIO, cfg(), null);
    expect(read).toEqual({ listed: false });
    expect(poolFor(read, 'demo')).toEqual({ state: 'unreadable' });
  });

  it('a root listing WITHOUT pools/ is a MEASURED absence — every project untagged', async () => {
    // Ruling 3: nothing strands on rollout. Nobody has tagged anything, and
    // that is a positive answer, not a failure to look.
    const read = await readProjectPools(localIO, cfg(), await rootNames());
    expect(read).toEqual({ listed: true, tags: new Map() });
    expect(poolFor(read, 'demo')).toEqual({ state: 'untagged' });
  });

  it('pools/ present at the root but unlistable is listed:false — never a fleet of untagged projects', async () => {
    // A REGULAR FILE planted where the directory belongs: `localIO.readdir`
    // answers null for it, exactly as it does for EACCES and exactly as
    // `remote/io.ts` answers for a whitelist refusal (`remote/io.ts:104-112`).
    // The permissive reading — an empty map — would lift every tag on the box.
    writeFileSync(pools, 'not a directory');
    const read = await readProjectPools(localIO, cfg(), await rootNames());
    expect(read).toEqual({ listed: false });
    expect(poolFor(read, 'demo')).toEqual({ state: 'unreadable' });
  });

  it('reads a tag, strips a trailing newline, and refuses a leading space', async () => {
    // `printf '%s'` is the verb's writer, `echo` is the 2am writer (ruling 2),
    // so trailing whitespace is stripped — TRAILING ONLY. A leading space is
    // malformed on both sides or the two readers disagree.
    //
    // AGREEMENT IS DECIDED ONE LINE EARLIER THAN THIS COMMENT USED TO SAY.
    // It read "byte for byte with `_project_pool_state`'s
    // `v=${v%"${v##*[![:space:]]}"}`", and that quote is still VERBATIM
    // correct — what stopped being true is its SUFFICIENCY. Wave 2a inserted a
    // 64-byte read cap ABOVE the strip (`grep -n "read -r -d '' -n 64" ccd/ccd`,
    // D-1850), and the strip cannot see it: a valid name padded with 58+ bytes
    // of trailing whitespace is `malformed` to `ccd` and would strip back to a
    // clean tag here. The cap is mirrored below, and the padded case is one of
    // the cases in this describe.
    tag('demo', 'pool-a');
    tag('quiet-basin', 'pool-b\n');
    tag('acct-a-demo', ' pool-a');
    const read = await readProjectPools(localIO, cfg(), await rootNames());
    expect(poolFor(read, 'demo')).toEqual({ state: 'tagged', name: 'pool-a' });
    expect(poolFor(read, 'quiet-basin')).toEqual({ state: 'tagged', name: 'pool-b' });
    expect(poolFor(read, 'acct-a-demo')).toEqual({ state: 'malformed' });
  });

  it('a tag padded to 64 bytes is malformed, and 63 still strips to a name', async () => {
    // RULING 1's case, and the one that decides the CAP rather than the strip.
    // `ccd`'s `IFS= read -r -d '' -n 64` succeeds AT 64 characters, so 64 is
    // already `malformed` there (measured: 63 -> rc 1, 64 -> rc 0). The pair
    // below is deliberately one byte apart, because a cap written `> 64`
    // passes the 64 case, strips it, and answers `tagged` — agreeing with
    // `ccd` on 65 and disagreeing on exactly the boundary (D-2010).
    tag('demo', 'pool-a' + ' '.repeat(58));        // 6 + 58 = 64
    tag('quiet-basin', 'pool-b' + ' '.repeat(57)); // 6 + 57 = 63
    // THE NUL, AND WHAT THIS ASSERTION DOES NOT MEASURE — said here because a
    // green expectation that cannot fail is worse than no expectation at all,
    // and this one cannot. `ccd` needs the NUL arm: `read -d ''` STOPS at the
    // delimiter, so `pool-a\0junk` would otherwise yield the valid prefix
    // `pool-a` and place on a pool the file does not name. The SERVER cannot
    // reach that state — it holds the whole string — and `POOL_NAME_RE`
    // (`/^[a-z][a-z0-9-]{0,31}$/`, anchored, and its class excludes `\0`) already
    // answers `malformed` for every NUL-bearing content. `\s` does not include
    // `\0` either, so the strip cannot remove one. MEASURED: delete
    // `.includes('\0')` from the mirror and this whole file stays green.
    // The arm is kept because ruling 1 requires it and because it states the
    // parity at the site, but it is a DOCUMENTED NO-OP, not a pinned guard —
    // the same treatment C1's M19 got rather than a case written to look red.
    // VOID (i.e. it becomes load-bearing, and this comment becomes wrong) if
    // `POOL_NAME_RE` ever admits a NUL, or if the cap is ever applied to the
    // STRIPPED value, or if this reader ever stops holding the whole string.
    tag('acct-a-demo', 'pool-a\0pool-b');
    const read = await readProjectPools(localIO, cfg(), await rootNames());
    expect(poolFor(read, 'demo')).toEqual({ state: 'malformed' });
    expect(poolFor(read, 'quiet-basin')).toEqual({ state: 'tagged', name: 'pool-b' });
    expect(poolFor(read, 'acct-a-demo'),
      'malformed — but by the name grammar, not by the cap: see above').toEqual({ state: 'malformed' });
  });

  it('two tokens, uppercase and an empty file are all malformed — never untagged', async () => {
    tag('demo', 'pool a');
    tag('quiet-basin', 'Pool-A');
    tag('acct-a-demo', '');
    const read = await readProjectPools(localIO, cfg(), await rootNames());
    for (const p of ['demo', 'quiet-basin', 'acct-a-demo']) {
      expect(poolFor(read, p), p).toEqual({ state: 'malformed' });
    }
  });

  it('an entry whose bytes never came back is unreadable, and only that entry', async () => {
    tag('demo', 'pool-a');
    tag('quiet-basin', 'pool-b');
    const io = degradedReadIO((p) => p.endsWith(`${POOLS_DIR_NAME}/quiet-basin`));
    const read = await readProjectPools(io, cfg(), await rootNames());
    expect(poolFor(read, 'demo')).toEqual({ state: 'tagged', name: 'pool-a' });
    expect(poolFor(read, 'quiet-basin')).toEqual({ state: 'unreadable' });
  });

  it('an entry that vanished between the listing and its own read is a SKIP — absence is untag', async () => {
    // The `--clear` that landed mid-read. A proven ENOENT is a proven untag,
    // which is exactly what `readFileMeasured` exists to be able to say.
    tag('demo', 'pool-a');
    const io = absentReadIO((p) => p.endsWith(`${POOLS_DIR_NAME}/demo`));
    const read = await readProjectPools(io, cfg(), await rootNames());
    expect(read.listed && read.tags.has('demo')).toBe(false);
    expect(poolFor(read, 'demo')).toEqual({ state: 'untagged' });
  });

  it('skips dot-leading entries — the disclosed tmp leak is not a project', async () => {
    // `$REG/pools/.<project>.$BASHPID.tmp` after a SIGKILL between write and
    // rename. No project may lead with a dot (`_ws_project_valid`), so the
    // skip is exact.
    tag('demo', 'pool-a');
    tag('.demo.4242.tmp', 'pool-b');
    const read = await readProjectPools(localIO, cfg(), await rootNames());
    expect(read.listed && [...read.tags.keys()]).toEqual(['demo']);
  });

  it('poolFor answers untagged for a project with no entry, on a listed read', async () => {
    tag('demo', 'pool-a');
    const read = await readProjectPools(localIO, cfg(), await rootNames());
    expect(poolFor(read, 'quiet-basin')).toEqual({ state: 'untagged' });
  });
});

describe('L3 may not narrow — four states in, four states out', () => {
  it('every state a marker can be in survives to the wire', async () => {
    tag('demo', 'pool-a');            // tagged
    tag('quiet-basin', 'Pool A');     // malformed
    tag('acct-a-demo', 'pool-b');     // -> made unreadable below
    const io = degradedReadIO((p) => p.endsWith(`${POOLS_DIR_NAME}/acct-a-demo`));
    const read = await readProjectPools(io, cfg(), await rootNames());
    expect([
      poolFor(read, 'demo').state,
      poolFor(read, 'quiet-basin').state,
      poolFor(read, 'acct-a-demo').state,
      poolFor(read, 'nothing-here').state,
    ]).toEqual(['tagged', 'malformed', 'unreadable', 'untagged']);
  });
});

describe('poolsEnforcement — the three-state shape lifecycleState uses', () => {
  it('null caps is unknown, never unavailable', () => {
    // `lifecycleState`'s own ruling (`coord/mirrorplan.ts:207`): `unavailable`
    // is a MEASURED absence an operator may act on; a null list is no evidence,
    // and a reader must stay silent on it.
    expect(poolsEnforcement(null)).toBe('unknown');
  });

  it('the verb present is enforced, the verb absent is unavailable', () => {
    const verb = CCD_ARGV.projectPoolClear('demo')[0]!;
    expect(poolsEnforcement([verb, 'swap'])).toBe('enforced');
    expect(poolsEnforcement(['swap', 'start'])).toBe('unavailable');
  });
});

describe('poolsWire', () => {
  it('carries the map as a plain object when listed, and the enforcement either way', async () => {
    tag('demo', 'pool-a');
    const read = await readProjectPools(localIO, cfg(), await rootNames());
    expect(poolsWire(read, 'enforced')).toEqual({
      listed: true, byProject: { demo: { state: 'tagged', name: 'pool-a' } }, enforcement: 'enforced',
    });
    expect(poolsWire({ listed: false }, 'unknown')).toEqual({ listed: false, enforcement: 'unknown' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/project-pools-read.test.ts`
Expected: FAIL — `SyntaxError: The requested module '../src/pools.js' does not provide an export named 'readProjectPools'` (wave 2a's `pools.ts` exports only `POOLS_DIR_NAME`).

- [ ] **Step 3: Write minimal implementation**

Replace the body of `server/src/pools.ts`, keeping wave 2a's `POOLS_DIR_NAME` declaration exactly as it is and adding below it:

```ts
import path from 'node:path';
import type { CcrcConfig } from './config.js';
import type { FleetIO } from './io.js';
import { CCD_ARGV } from './ccdargv.js';
import { POOL_NAME_RE } from '../../shared/roster.js';
import type { PoolsEnforcement, ProjectPoolWire, ProjectPoolsWire } from '../../shared/api.js';

// (wave 2a's `export const POOLS_DIR_NAME = 'pools';` stays exactly where it is)

/**
 * One sweep of `$REG/pools/`, ring L3 (spec §5.4.4).
 *
 * `listed: false` is the `io.readdir` COLLAPSE itself and nothing else: the
 * registry root would not list, or `pools` is at the root but would not list
 * (a regular file planted there, an EACCES, a remote `forbidden`). It is NOT
 * "there are no tags" — that is `listed: true` with an empty map, and the
 * difference is the whole reason this type exists. `poolFor` reads the first
 * as `unreadable` (nobody decides) and the second as `untagged`
 * (unconstrained); folding them would silently LIFT every constraint on the
 * box the moment a listing dropped.
 */
export type ProjectPoolsRead =
  | { listed: false }
  | { listed: true; tags: Map<string, ProjectPoolWire> };

/**
 * The verb whose PRESENCE in `ccd caps` is the evidence that the deployed ccd
 * honours pools (spec §5.11: "the verb and every reader ship in one `ccd`
 * inode, so the verb's presence in `ccdVerbs` IS the evidence").
 *
 * READ OFF THE BUILDER rather than spelled a second time here — `ccdargv.ts`
 * is where ccd verb names live, and a capability token copied into two files
 * is the drift shape `single-definition.test.ts` exists for. The probe argv is
 * built and its verb taken; it is never run.
 */
const PROJECT_POOL_VERB: string = CCD_ARGV.projectPoolClear('')[0] ?? '';

/**
 * Read every project's pool tag in one pass.
 *
 * `rootNames` is the registry root listing the CALLER already took — the
 * watcher's `registryRead.names` (`watch.ts:702`'s own source), or the route's
 * own `io.readdir(cfg.registryDir)`. It is a PARAMETER rather than a read of
 * our own because it is what splits "the directory is not there" from "the
 * directory would not list": `io.readdir` cannot say (`io.ts:96` — the one
 * read in that file with no measured sibling), and the parent listing can.
 *
 * Cost: ZERO extra root readdirs for a caller that has a listing, then one
 * `pools/` readdir and one measured read per tagged project.
 */
export async function readProjectPools(
  io: FleetIO, cfg: CcrcConfig, rootNames: readonly string[] | null,
): Promise<ProjectPoolsRead> {
  if (rootNames === null) return { listed: false };
  if (!rootNames.includes(POOLS_DIR_NAME)) return { listed: true, tags: new Map() };
  const dir = path.join(cfg.registryDir, POOLS_DIR_NAME);
  const names = await io.readdir(dir);
  if (names === null) return { listed: false };
  const tags = new Map<string, ProjectPoolWire>();
  for (const name of names) {
    // Dot-leading is ccd's private namespace and the disclosed tmp-leak shape
    // (`$REG/pools/.<p>.$BASHPID.tmp`). Exact, since no project may lead with
    // a dot (`_ws_project_valid`).
    if (name.startsWith('.')) continue;
    const read = await io.readFileMeasured(path.join(dir, name));
    if (!read.ok) {
      // A PROVEN ENOENT is a proven untag — the `--clear` (or the `rm`) that
      // landed between the listing and this read. Anything else is the file
      // being there and this box not being able to read it, which is a state
      // of its own and must never read as absence (D-114's rule).
      if (read.reason === 'absent') continue;
      tags.set(name, { state: 'unreadable' });
      continue;
    }
    // THE CAP COMES FIRST, exactly as it does on the other side, and the
    // COMPARISON IS `>=`, NOT `>` (D-2010 — this line said `> 64` for one
    // commit). `ccd` reads the tag with `IFS= read -r -d '' -n 64`
    // (`grep -n "read -r -d '' -n 64" ccd/ccd`) and answers `malformed` when
    // that read SUCCEEDS. `read -n 64` succeeds when it gets its 64 characters
    // OR meets the NUL; it fails only at EOF before either. So a 64-byte file
    // is ALREADY malformed there — measured, not reasoned: 63 bytes rc 1,
    // 64 bytes rc 0, 65 bytes rc 0. `> 64` would pass a 64-byte tag straight
    // to the strip and answer `tagged` for the one input the cap exists to
    // catch. `ccd`'s own comment names the same boundary from the other end:
    // "a tag padded with 58+ characters of trailing whitespace", and
    // `pool-a` + 58 spaces is exactly 64.
    //
    // BYTES vs UTF-16 UNITS, said once so nobody re-derives it: `.length`
    // counts UTF-16 code units and `read -n` counts characters in the shell's
    // locale, so the two agree only for ASCII. That is sufficient here because
    // anything non-ASCII fails `POOL_NAME_RE` below and is `malformed` on both
    // sides regardless of which side's cap it trips — the boundary only ever
    // decides an all-ASCII input, where the three units coincide.
    if (read.content.length >= 64 || read.content.includes('\0')) {
      tags.set(name, { state: 'malformed' });
      continue;
    }
    // TRAILING whitespace only: `echo pool-a > …` is a legal writer (ruling 2),
    // a leading space is not. The quote this comment used to carry —
    // `v=${v%"${v##*[![:space:]]}"}` — is still verbatim at `ccd`'s strip, but
    // it is no longer the whole rule (D-1850); the cap above is the rest of it.
    const value = read.content.replace(/\s+$/, '');
    tags.set(name, POOL_NAME_RE.test(value)
      ? { state: 'tagged', name: value }
      : { state: 'malformed' });
  }
  return { listed: true, tags };
}

/** One project's answer. `unreadable` for a collapsed listing: nobody
 *  decides, and the caller answers 503 / `unmeasurable` rather than placing. */
export function poolFor(read: ProjectPoolsRead, project: string): ProjectPoolWire {
  if (!read.listed) return { state: 'unreadable' };
  return read.tags.get(project) ?? { state: 'untagged' };
}

/**
 * Does the deployed ccd honour project pools? The `lifecycleState` three-state
 * shape (`coord/mirrorplan.ts:207`), for its reasons: `unavailable` is a
 * MEASURED absence — ccd answered `caps` and the verb was not there, so an
 * operator may act on it (redeploy the agent lane) — while `null` is NO
 * EVIDENCE (local mode before `readLocalCcdCaps` ran, an agent too old to send
 * a list), and a reader must stay silent on `unknown`.
 */
export function poolsEnforcement(ccdVerbs: readonly string[] | null): PoolsEnforcement {
  if (ccdVerbs === null) return 'unknown';
  return ccdVerbs.includes(PROJECT_POOL_VERB) ? 'enforced' : 'unavailable';
}

/** The read, on the wire. The Map becomes a plain object; nothing narrows. */
export function poolsWire(read: ProjectPoolsRead, enforcement: PoolsEnforcement): ProjectPoolsWire {
  return read.listed
    ? { listed: true, byProject: Object.fromEntries(read.tags), enforcement }
    : { listed: false, enforcement };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/project-pools-read.test.ts`
Expected: PASS — all describes green.

- [ ] **Step 5: Measure the mutations**

1. Delete the `if (!rootNames.includes(POOLS_DIR_NAME)) return { listed: true, tags: new Map() };` line.
   Expected RED: `a root listing WITHOUT pools/ is a MEASURED absence — every project untagged` — `expected { listed: false } to deeply equal { listed: true, tags: Map(0) {} }`.
2. Change `if (names === null) return { listed: false };` to `if (names === null) return { listed: true, tags: new Map() };`
   Expected RED: `pools/ present at the root but unlistable is listed:false — never a fleet of untagged projects` — `expected { state: 'untagged' } to deeply equal { state: 'unreadable' }`.
3. Delete `if (name.startsWith('.')) continue;`
   Expected RED: `skips dot-leading entries — the disclosed tmp leak is not a project` — `expected [ '.demo.4242.tmp', 'demo' ] to deeply equal [ 'demo' ]`.
4. Change `if (read.reason === 'absent') continue;` to `if (read.reason === 'absent') { tags.set(name, { state: 'unreadable' }); continue; }`
   Expected RED: `an entry that vanished between the listing and its own read is a SKIP — absence is untag`.
5. Change the trailing-whitespace strip to `read.content.trim()`.
   Expected RED: `reads a tag, strips a trailing newline, and refuses a leading space` — `expected { state: 'tagged', name: 'pool-a' } to deeply equal { state: 'malformed' }`.
6. In `poolsEnforcement`, change `if (ccdVerbs === null) return 'unknown';` to `return 'unavailable';`
   Expected RED: `null caps is unknown, never unavailable`.

- [ ] **Step 6: Commit**

```bash
git add server/src/pools.ts server/test/project-pools-read.test.ts
git commit -m "feat(pools): the server reads the project tags off the listing it already took"
```

---

### Task 3 — DONE 2026-09-08 (5/5 mutations red)
### Task 3: `stranded` — fail-shut on the registry, additive on the wire

**Files:**
- Modify: `server/src/registry.ts` (`SessionRecord` `:26-28`; the constants beside `SWAP_BLOCKED_NO_REASON` `:308`; `buildRecord`'s `Promise.all` `:510-525`; the listing probes beside `substrateListed` `:590`; the returned literal beside `swapBlocked` `:753`)
- Modify: `shared/api.ts` (`FleetSession.stranded` after `swapBlocked` `:181`; `reviveStranded` beside `reviveSubstrate` `:1875-1888`; the literal in `reviveFleetSession` beside `swapBlocked: reviveSwapBlocked(o, 'swapBlocked')` `:2087`)
- Modify: `server/src/fleet.ts` (`:473-475`, beside the `swapBlocked` seconds→MS conversion)
- Modify: every complete `FleetSession` / `SessionRecord` literal in `server/test/` and `pwa/test/` (mechanical — see step 5)
- Test: `server/test/registry.test.ts` (add cases), `server/test/fleetstate.test.ts` (add cases), `server/test/fleet-lifecycle.test.ts` (add one case)

**Interfaces:**
- Consumes: `fieldMeasured` (`registry.ts:359`), `packedStamp` (`registry.ts:380`), `MeasuredRead` (`io.ts:43`), `reviveSwapBlocked`'s contract (`shared/api.ts:1868-1873`).
- Produces:
  ```ts
  // server/src/registry.ts
  export const STRANDED_NO_REASON = '<strand recorded no reason>';
  export const STRANDED_UNREADABLE = '<strand marker unreadable>';
  interface SessionRecord { …; stranded: { at: number; reason: string } | null; }

  // shared/api.ts
  interface FleetSession { …; readonly stranded: { readonly at: number; readonly reason: string } | null; }
  // (private) const reviveStranded = (o: RawObj, k: string) => { at: number; reason: string } | null;
  ```

**Spec:** §5.8.1 (the marker), §5.8.3 (server half), §5.9 (wire discipline), §6 (the `.stranded` seam row), §11 rows 39 and 40.

**Mutation table:**
- Row 39 — `registry.test.ts`. Goes RED when the read uses `field()` instead of `fieldMeasured` (unreadable would collapse into absent and answer `null` — "not stranded" over a flagged row), when the `strandedListed` rung returns `null`, or when the field-count assertion is not moved (22 → 23).
- Row 40 — `fleetstate.test.ts`. Goes RED when `reviveStranded` tolerates a malformed value (`{at}` with no `reason`, or a numeric `reason`) instead of rejecting the session, or when an ABSENT key rejects instead of degrading to `null`.

- [ ] **Step 1: Write the failing test**

Append to `server/test/registry.test.ts`, inside the same describe that holds the stamp cases (the one whose `read` helper is at `:1007-1008`), and import `STRANDED_NO_REASON`, `STRANDED_UNREADABLE` from `../src/registry.js` and `absentField`, `unreadableField` from `./ioDoubles.js` at the top of the file (`unreadableField` is already imported):

```ts
  it('reads a strand marker, splitting epoch from reason', () => {
    seed(reg, 'demo-quiet-basin', {
      stranded: '1785299000 claude:pool=pool-b claude-a:limit',
    });
    return read().then((r) => {
      expect(r.stranded).toEqual({
        at: 1785299000, reason: 'claude:pool=pool-b claude-a:limit',
      });
    });
  });

  it('gives a strand with no reason a sentence, never an empty display string', async () => {
    // The same ruling as SWAP_BLOCKED_NO_REASON and for the same reason: the
    // reason string IS the display on the fleet card, and `reason: ''` renders
    // as a cell visible enough to alarm and empty enough to ignore.
    seed(reg, 'demo-quiet-basin', { stranded: '1785299000' });
    expect((await read()).stranded).toEqual({ at: 1785299000, reason: STRANDED_NO_REASON });
    seed(reg, 'demo-quiet-basin', { stranded: '1785299000    ' });
    expect((await read()).stranded).toEqual({ at: 1785299000, reason: STRANDED_NO_REASON });
  });

  it('a LISTED but unreadable strand marker fails SHUT — never null', async () => {
    // "Not stranded" over a flagged row is the destructive direction (spec
    // §5.8.3): the cell is the loud one, and a misread that blanks it teaches
    // the operator that the fleet is fine while a session waits on nobody.
    seed(reg, 'demo-quiet-basin', { stranded: '1785299000 nowhere' });
    const r = await read(unreadableField('demo-quiet-basin', 'stranded'));
    expect(r.stranded).toEqual({ at: 0, reason: STRANDED_UNREADABLE });
  });

  it('an unreadable read for a marker that is NOT in the listing is null, not a fabricated strand', async () => {
    // The other half of the same ladder, and the reason presence comes from the
    // LISTING: a dropped agent-WS round trip on a session that has no
    // `.stranded` at all must not mint one.
    const r = await read(unreadableField('demo-quiet-basin', 'stranded'));
    expect(r.stranded).toBeNull();
  });

  it('a marker cleared between the listing and its own read is null — a proven ENOENT is a proven clear', async () => {
    // `_strand_clear` runs on EVERY healthy tick (spec §5.5.4 step 3), so this
    // race is routine, not exotic — D-113's argument for `.substrate`, applied
    // to a marker that is removed far more often.
    seed(reg, 'demo-quiet-basin', { stranded: '1785299000 nowhere' });
    const r = await read(absentField('demo-quiet-basin', 'stranded'));
    expect(r.stranded).toBeNull();
  });

  it('a session with no strand marker reads null', async () => {
    expect((await read()).stranded).toBeNull();
  });
```

Change the field-count assertion at `server/test/registry.test.ts:621`:

```ts
    // 17 + D3's four stamps (stopped, supervised, swapblocked, spawn) + the
    // substrate marker (D-310 (was D-B8-14)) + the strand marker (account
    // pools, wave 3) — the number is pinned rather than derived because it IS
    // the remote-mode cost: one round trip each, per session, per 2-second tick.
    expect(fieldReads).toHaveLength(23);
```

Append to `server/test/fleetstate.test.ts`, inside the same describe as the revival cases:

```ts
  it('revives `stranded` — absent degrades to null, and the CACHE STILL REVIVES', async () => {
    // Every state-cache.json on disk the day this ships lacks the key, and a
    // rejection here would empty degraded mode at exactly the moment it is the
    // only data there is.
    const cachePath = path.join(tmpDir(), 'state-cache.json');
    writeRaw(cachePath, [v1Session('claude-quiet-basin')]);
    const snap = await loadSnapshot(cachePath);
    expect(snap, 'an older cache must still revive').not.toBeNull();
    const s = snap?.sessions[0];
    expect(s?.stranded).toBeNull();
    // Present as a KEY, not merely undefined — `undefined !== null`.
    expect(Object.keys(s ?? {})).toEqual(expect.arrayContaining(['stranded']));
  });

  it('round-trips a populated stranded axis', async () => {
    const cachePath = path.join(tmpDir(), 'state-cache.json');
    const populated: FleetSession = {
      ...session('claude-quiet-basin'),
      stranded: { at: 1785299000000, reason: 'claude:pool=pool-b claude-a:limit' },
    };
    await saveSnapshot([populated], cachePath);
    expect((await loadSnapshot(cachePath))?.sessions[0]).toEqual(populated);
  });

  it('rejects a malformed stranded rather than laundering it into null', async () => {
    // `reviveSwapBlocked`'s contract exactly: the reason is free text ccd wrote
    // and it IS the display, so there is no vocabulary to degrade onto — and
    // null would read "no strand recorded" over a row a supervisor flagged.
    const cachePath = path.join(tmpDir(), 'state-cache.json');
    for (const bad of [
      { stranded: 'nowhere' },
      { stranded: { at: 1785299000000 } },                  // no `reason`
      { stranded: { at: 1785299000000, reason: 7 } },
      { stranded: { reason: 'nowhere' } },                  // no `at`
    ]) {
      writeRaw(cachePath, [{ ...v1Session('claude-quiet-basin'), ...bad }]);
      expect(await loadSnapshot(cachePath), JSON.stringify(bad)).toBeNull();
    }
  });
```

Append to `server/test/fleet-lifecycle.test.ts`, beside its `swapBlocked` cases (`:93-115`), using this file's own `one(fields, alive)` helper (`:41-45`) and its `NOW_SEC` constant (`:20`) — add no new helper:

```ts
  it('carries the strand marker onto the wire in epoch MS, with its reason verbatim', async () => {
    // Seconds on disk (registry-native, the `swapblocked` shape), MS on the
    // wire — the conversion happens at THIS seam only, like `stoppedBy` and
    // `swapBlocked` beside it. The reason is `_strand_why`'s sentence and it IS
    // the display, so it rides untouched.
    const s = await one({ stranded: `${NOW_SEC - 300} claude:pool=pool-b claude-a:limit` }, false);
    expect(s.stranded).toEqual({
      at: (NOW_SEC - 300) * 1000, reason: 'claude:pool=pool-b claude-a:limit',
    });
  });

  it('leaves stranded null for a row with no marker, and never undefined', async () => {
    const s = await one({ started: '1' }, true);
    expect(s.stranded).toBeNull();
    expect(Object.keys(s)).toEqual(expect.arrayContaining(['stranded']));
  });

  it('a LISTED but unreadable strand marker reaches the wire at 0 with the sentence, never as null', async () => {
    // The fail-shut arm, end to end: `at: 0` is the "listed but unreadable"
    // degrade and renderers show the text without fabricating a 1970 stamp.
    const { cfg, tmux } = fixture({ stranded: `${NOW_SEC - 300} nowhere` }, false);
    const blind = degradedReadIO((p) => p.endsWith(`${ID}.stranded`));
    const fleet = await assembleFleet(blind, cfg, tmux, NOW_SEC);
    expect(fleet.find((s) => s.id === ID)!.stranded)
      .toEqual({ at: 0, reason: STRANDED_UNREADABLE });
  });
```

Add `STRANDED_UNREADABLE` to this file's existing `../src/registry.js` import (it already imports `SUBSTRATE_UNREADABLE` from there).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/registry.test.ts test/fleetstate.test.ts test/fleet-lifecycle.test.ts`
Expected: FAIL — `registry.test.ts`: `SyntaxError: The requested module '../src/registry.js' does not provide an export named 'STRANDED_NO_REASON'`. After stubbing that away it would fail as `expected undefined to deeply equal { at: 1785299000, reason: … }`, and `expected 22 to be 23` on the field-count case.

- [ ] **Step 3: Write minimal implementation**

`server/src/registry.ts` — add to `SessionRecord`, immediately after the `swapBlocked` field (`:188`):

```ts
  /**
   * `$REG/<id>.stranded` — the supervisor's record that this session is
   * hard-blocked and NO account in its pool can take it (spec §5.8, ruling 6).
   * `<epoch-seconds> <reason>`, the `swapblocked` shape, written by
   * `_strand_mark` and removed by `_strand_clear`.
   *
   * AN AXIS, NOT A STATE: the row keeps whatever `status`/`bucket` said; this
   * says the swapper has nowhere to move it to. Distinct from `swapBlocked`,
   * which records a REFUSAL of a swap that was attempted — a strand is the
   * absence of any candidate to attempt.
   *
   * FAIL-SHUT, and read through `fieldMeasured` for it: `at: 0` with
   * {@link STRANDED_UNREADABLE} when the marker is LISTED and its bytes did
   * not come back. "Not stranded" over a flagged row is the destructive
   * direction — this cell is the loud one ruling 6 exists to produce.
   */
  stranded: { at: number; reason: string } | null;
```

Add the two constants immediately after `SWAP_BLOCKED_NO_REASON` (`:308`):

```ts
/**
 * The reason a strand carries when `$REG/<id>.stranded` records an epoch and
 * nothing after it. Same ruling as `SWAP_BLOCKED_NO_REASON`: `_strand_mark`
 * always writes a reason (`_strand_why` synthesizes one), so the only ways in
 * are the residual empty-field routes `BranchEvidence`'s `'empty'` rung sets
 * out — and a strand cell with nothing in its tooltip is visible enough to
 * alarm and empty enough to ignore.
 */
export const STRANDED_NO_REASON = '<strand recorded no reason>';

/**
 * The reason a strand carries when the marker is LISTED in the registry
 * directory but its bytes could not be read. `SUBSTRATE_UNREADABLE`'s ruling
 * applied to ruling 6's marker: presence comes from the LISTING, never from a
 * non-null read, because "no strand recorded" is what every surface renders as
 * a healthy fleet.
 */
export const STRANDED_UNREADABLE = '<strand marker unreadable>';
```

In `buildRecord`'s destructuring and `Promise.all` (`:510-525`) add `strandedRead` as the 23rd read, beside `substrateRead`:

```ts
    fieldMeasured(io, cfg.registryDir, id, 'substrate'),
    fieldMeasured(io, cfg.registryDir, id, 'stranded'),
```
(and `substrateRead, strandedRead] = await Promise.all([` in the destructuring list).

Beside `substrateListed` (`:590`):

```ts
  const strandedListed = names.includes(`${id}.stranded`);
```

In the returned literal, immediately after the `swapBlocked` entry (`:753-755`):

```ts
    // `.substrate`'s ladder, with `swapBlocked`'s empty-reason ruling: presence
    // from the LISTING (a strand blanked by a dropped read re-enables nothing,
    // but it does hide the one cell ruling 6 exists to show), a measured
    // `absent` reads null DIRECTLY — `_strand_clear` removes this marker on
    // every healthy tick, so a marker listed at the top of a read and cleared
    // before its own field read is the ORDINARY recovery, not a fault (D-113's
    // argument, applied to a marker that moves far more often than
    // `.substrate`) — and a stampless file keeps its whole text at `at: 0`
    // rather than losing the one sentence a maintainer could act on.
    stranded: strandedRead.ok
      ? (strandedRead.content === ''
          ? { at: 0, reason: STRANDED_NO_REASON }
          : (() => {
              const p = packedStamp(strandedRead.content);
              return p === null
                ? { at: 0, reason: strandedRead.content }
                : { at: p.at, reason: p.rest === '' ? STRANDED_NO_REASON : p.rest };
            })())
      : (strandedRead.reason === 'absent' ? null : (strandedListed ? { at: 0, reason: STRANDED_UNREADABLE } : null)),
```

`shared/api.ts` — add to `FleetSession` immediately after `swapBlocked` (`:181`):

```ts
  /** The supervisor's standing "nowhere to move this" record —
   *  `$REG/<id>.stranded`, written by `_strand_mark` when the pane is
   *  hard-blocked and no account in the project's pool can take it (spec §5.8,
   *  ruling 6). Epoch MS (converted from the registry's seconds in `fleet.ts`,
   *  like `swapBlocked`) and the reason VERBATIM — the reason is the display on
   *  every surface, never parsed. Null when no strand stands.
   *
   *  AN AXIS, NOT A STATE, on `substrate`'s terms: a new FIELD beside
   *  `status`/`bucket`/`lifecycle`, never a member of any of them. `at: 0` is
   *  the "marker listed but unreadable" degrade from the registry read;
   *  renderers show the text without fabricating a 1970 timestamp.
   *
   *  `reviveFleetSession` below: absent → null (an older snapshot predates the
   *  axis), present-but-malformed → reject the WHOLE session — the
   *  `swapBlocked` contract, because free text has no vocabulary to degrade
   *  onto and "no strand recorded" over a flagged row is the direction that
   *  makes the loud cell silent. */
  readonly stranded: { readonly at: number; readonly reason: string } | null;
```

Add the reviver immediately after `reviveSubstrate` (`:1888`):

```ts
/** `reviveSwapBlocked`'s contract exactly, for the same reason: the reason is
 *  free prose the supervisor wrote and it IS the display, so a malformed value
 *  has no vocabulary to degrade onto. Absent → null (an older snapshot
 *  predates the axis); present-but-malformed rejects the session. */
const reviveStranded = (o: RawObj, k: string): { at: number; reason: string } | null => {
  const v = o[k];
  if (v === undefined || v === null) return null;
  const s = asObj(v, k);
  return { at: reqNum(s, 'at'), reason: reqStr(s, 'reason') };
};
```

Add to `reviveFleetSession`'s literal, immediately after `swapBlocked: reviveSwapBlocked(o, 'swapBlocked'),` (`:2087`):

```ts
      stranded: reviveStranded(o, 'stranded'),
```

`server/src/fleet.ts` — add immediately after the `swapBlocked` conversion (`:473-475`):

```ts
      // Same seconds→MS conversion, at THIS seam only, like `stoppedBy`,
      // `swapBlocked` and `substrate`. An unreadable marker's fail-shut
      // `{at: 0}` rides through as 0 — not a real 1970 stamp.
      stranded: r.stranded === null
        ? null
        : { at: r.stranded.at * 1000, reason: r.stranded.reason },
```

- [ ] **Step 4: Run the three suites**

Run: `cd server && ./node_modules/.bin/vitest run test/registry.test.ts test/fleetstate.test.ts test/fleet-lifecycle.test.ts`
Expected: PASS for the new cases; `fleetstate.test.ts`'s and `fleet-health.test.ts`'s complete-`FleetSession` fixtures are still missing the key, which step 5 closes (vitest itself is green — the gap is a TYPE gap, which step 5 measures).

- [ ] **Step 5: Close the type gap — every complete literal answers**

`FleetSession.stranded` and `SessionRecord.stranded` are REQUIRED (`| null`), so every hand-written complete literal is now a compile error. That is the point: a new field must be a compile error until every path computes it.

Run the typecheckers first, to see the whole list:

```bash
cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
cd pwa && ./node_modules/.bin/tsc --noEmit
```

Expected FAIL, e.g. `server/test/fleet-health.test.ts(44,7): error TS2739: Type '{ … }' is missing the following properties from type 'FleetSession': stranded` and the same for ~25 files under `pwa/test/`.

Then find every site and fix it mechanically:

```bash
grep -rn "swapBlocked: null" server/test pwa/test --include=*.ts --include=*.tsx
```

In each hit that is part of a complete `FleetSession` or `SessionRecord` literal, insert `stranded: null,` immediately after `swapBlocked: null,`. (`server/test/hold-gate.test.ts:232` is a `SessionRecord` literal, not a `FleetSession` one; it takes the same insertion.) Do not touch assertion lines such as `expect(s?.swapBlocked).toBeNull()`.

Re-run both typecheckers:

```bash
cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
cd pwa && ./node_modules/.bin/tsc --noEmit
```
Expected: PASS / no output.

- [ ] **Step 6: Measure the mutations**

1. In `buildRecord`, change `fieldMeasured(io, cfg.registryDir, id, 'stranded')` to `field(io, cfg.registryDir, id, 'stranded')` and adapt the arm to `packedStamp(strandedRaw)`.
   Expected RED: `a LISTED but unreadable strand marker fails SHUT — never null` — `expected null to deeply equal { at: 0, reason: '<strand marker unreadable>' }`.
2. Change `(strandedListed ? { at: 0, reason: STRANDED_UNREADABLE } : null)` to `null`.
   Expected RED: same case, same message.
3. Change `(strandedRead.reason === 'absent' ? null : …)` to drop the absent arm (`strandedListed ? … : null` only).
   Expected RED: `a marker cleared between the listing and its own read is null` — `expected { at: 0, reason: '<strand marker unreadable>' } to be null`.
4. In `reviveStranded`, change `reqStr(s, 'reason')` to `optStr(s, 'reason') ?? ''`.
   Expected RED: `rejects a malformed stranded rather than laundering it into null` — `expected [FleetSession] to be null` for `{ stranded: { at: …, reason: 7 } }`.
5. Revert the field-count assertion to `22`.
   Expected RED: `costs exactly one readdir plus the one id's 22 field reads` — `expected 23 to be 22`.

- [ ] **Step 7: Commit**

```bash
git add server/src/registry.ts server/src/fleet.ts shared/api.ts \
        server/test/registry.test.ts server/test/fleetstate.test.ts \
        server/test/fleet-lifecycle.test.ts server/test/fleet-health.test.ts \
        server/test/hold-gate.test.ts pwa/test
git commit -m "feat(pools): a strand is a fail-shut axis on the row, never a blank"
```

---

### Task 4 — DONE 2026-09-08 (3/3 mutations red)
### Task 4: `projectHome` takes the pool, `projectPlacement` forecasts per project, and one fixture drives both languages

**Files:**
- Modify: `server/src/limits.ts` (`projectHome` `:96-108`; `projectPlacement` added after it — here, beside the function it composes, and NOT in `poolrule.ts`: D-1682)
- Modify: `server/src/server.ts:1185` (the one production caller)
- Modify: `server/test/fixtures/leastLoaded.ts` (`LeastLoadedCase` `:14-32`; four new cases)
- Test: `server/test/projected-home.test.ts`

**Interfaces:**
- Consumes: `poolEligible`, `poolUndecidable` (Task 1); `readProjectPools`, `poolFor` (Task 2); `ProjectPlacement` from `shared/api.js` (Task 1); wave 2a's `_ws_least_loaded [project]`, `_project_pool_state`, `_pool_ok` in `ccd/ccd`; wave 1's `_ccrc_pool` emission in `generateAccountsSh`.
- Produces:
  ```ts
  export function projectHome(
    roster: Roster, limits: Record<string, AccountLimits>, pool: ProjectPoolWire,
  ): ProjectedHome | null;
  export function projectPlacement(
    roster: Roster, limits: Record<string, AccountLimits>, pool: ProjectPoolWire,
  ): ProjectPlacement;
  ```
  `server/test/fixtures/leastLoaded.ts`: `LeastLoadedCase` gains `pools?: Record<string, string>` and `project?: { name: string; tag: string | null }`.

**Spec:** §5.5.2 (placement), §5.6 (`projectHome` gains the third argument; `projected` is re-documented as the untagged forecast; `unmeasurable` is a VALUE), §11 row 28.

**Mutation table:**
- Row 28 — `projected-home.test.ts` over `leastLoadedCases`. Goes RED when either side drops the pool filter (the TS side names the cheapest out-of-pool account; the bash side does too and the two still agree — so the fixture's `expect` is what catches it, which is why the four new cases each name an account the UNFILTERED rule would NOT pick), and when `projectPlacement` collapses `unmeasurable` into `none`.

**Note on the third argument:** it is REQUIRED, not defaulted. A default of `{state:'untagged'}` would let a caller that forgot the pool silently receive the unconstrained forecast — which names an out-of-pool account, the one wrong answer this function can give. `GET /api/accounts` therefore says `{ state: 'untagged' }` out loud, which is exactly what its `projected` field now means (spec §5.6).

**Note on `projectPlacement`'s home:** the spec's §5.6 code block lists it in `poolrule.ts`. It lives in `limits.ts` instead, beside `projectHome`, because it COMPOSES `projectHome` — and `poolrule.ts` is L1, purity-scanned by Task 1, so a value import of an L3 module there is exactly the ring violation the scan exists to catch. The spec's own ring table already says `limits.ts` "composes `poolEligible`; decides nothing new" (§8), and this is that composition. The TYPE is in `shared/api.ts` where the PWA can reach it.

- [ ] **Step 1: Write the failing test — the fixture first**

In `server/test/fixtures/leastLoaded.ts`, extend `LeastLoadedCase` (after `disabled?`, `:23-27`):

```ts
  /** Per-account pool tags for this case, keyed by account id. Absent or
   *  missing for an account means UNTAGGED — today's roster, and today's
   *  behaviour: an untagged account serves any project (ruling 3). The runner
   *  projects this into BOTH `accounts.json` (the server's roster) and
   *  `accounts.sh` (`_ccrc_pool`, ccd's), so the two sides read one fact. */
  pools?: Record<string, string>;
  /** The project this placement is for, and the tag on it. Absent means the
   *  ZERO-ARG call both sides already make — `_ws_least_loaded` with no
   *  positional and `projectHome` with `{state:'untagged'}` — which is why
   *  every pre-pool case above stays byte-identical. `tag: null` writes no
   *  marker: a named but untagged project. */
  project?: { name: string; tag: string | null };
```

Add four cases at the end of the returned array (before the closing `];`):

```ts
    {
      name: 'pool-filters-cheapest',
      files: { claude: fresh(80, 40), 'claude-a': fresh(5, 3), 'claude-b': fresh(90, 95), 'claude-d': fresh(60, 60) },
      pools: { claude: 'pool-b', 'claude-a': 'pool-b', 'claude-b': 'pool-a', 'claude-d': 'pool-a' },
      project: { name: 'demo', tag: 'pool-a' },
      expect: { wrapper: 'claude-d', score: 60 },
      why: 'the cheapest account on the box is in the other pool — both sides must skip it '
        + 'and take the cheapest IN-pool account, not the cheapest account',
    },
    {
      name: 'untagged-account-serves-tagged-project',
      files: { claude: fresh(1, 1), 'claude-a': fresh(20, 20), 'claude-b': fresh(30, 30), 'claude-d': fresh(40, 40) },
      pools: { claude: 'pool-b' },
      project: { name: 'demo', tag: 'pool-a' },
      expect: { wrapper: 'claude-a', score: 20 },
      why: 'an untagged account is UNCONSTRAINED and serves a tagged project (ruling 3) — '
        + 'only the one account tagged into the other pool is skipped',
    },
    {
      name: 'tagged-account-serves-untagged-project',
      files: { claude: fresh(80, 40), 'claude-a': fresh(5, 3), 'claude-b': fresh(90, 95), 'claude-d': fresh(60, 60) },
      pools: { 'claude-a': 'pool-b' },
      project: { name: 'demo', tag: null },
      expect: { wrapper: 'claude-a', score: 5 },
      why: 'tagging only tightens: an untagged PROJECT constrains nobody, so the tagged '
        + 'account still wins on price',
    },
    {
      name: 'pool-empty-all-disabled',
      files: { claude: fresh(50, 40), 'claude-a': fresh(5, 3), 'claude-b': fresh(90, 95), 'claude-d': fresh(60, 60) },
      pools: { claude: 'pool-a', 'claude-a': 'pool-b', 'claude-b': 'pool-b', 'claude-d': 'pool-b' },
      disabled: ['claude'],
      project: { name: 'demo', tag: 'pool-a' },
      expect: null,
      why: 'the pool has exactly one member and it is declared off: nothing is placeable '
        + 'and both sides must admit it rather than cross (ruling 6)',
    },
```

In `server/test/projected-home.test.ts`, replace the pairing describe's body so both sides read the case's pool dimension. Add the imports:

```ts
import { poolFor, readProjectPools, POOLS_DIR_NAME } from '../src/pools.js';
import { projectPlacement } from '../src/limits.js';
import { DEFAULT_TEST_ROSTER } from './helpers.js';
import type { ProjectPoolWire } from '../../shared/api.js';
```

and the two helpers plus the rewritten runner:

```ts
/** DEFAULT_TEST_ROSTER with the case's pool tags applied. Built HERE and not in
 *  the fixture file: the fixture is the cross-language contract and imports
 *  nothing, exactly as it expresses `now` as a parameter for the same reason. */
const rosterWithPools = (pools: Record<string, string> | undefined): unknown => ({
  ...DEFAULT_TEST_ROSTER,
  accounts: DEFAULT_TEST_ROSTER.accounts.map((a) =>
    pools?.[a.id] !== undefined ? { ...a, pool: pools[a.id] } : a),
});

/** The case's project tag, on disk where BOTH readers look. */
const seedPoolTag = (project: string, tag: string): void => {
  const dir = path.join(home, '.cc-sessions', POOLS_DIR_NAME);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, project), tag);
};

describe('projectHome agrees with ccd _ws_least_loaded', () => {
  it.each(leastLoadedCases(now()).map((c) => [c.name, c] as const))(
    '%s',
    async (_name, c) => {
      // BOTH projections of the case's roster into the one fixture home, so the
      // comparison below is of two RULES and not of two rosters.
      const roster = rosterWithPools(c.pools);
      seedRoster(home, roster);
      seedAccountsSh(home, roster);
      seed(c.files);
      seedDisabled(c.disabled ?? []);
      if (c.project?.tag != null) seedPoolTag(c.project.name, c.project.tag);

      const cfg = loadConfig({ CCRC_HOME: home });
      // The tag reaches the TS side through the real reader, not a literal —
      // so this case exercises `readProjectPools` against the same bytes ccd's
      // `_project_pool_state` is about to read.
      const read = await readProjectPools(localIO, cfg, await localIO.readdir(cfg.registryDir));
      const pool: ProjectPoolWire = c.project === undefined
        ? { state: 'untagged' }
        : poolFor(read, c.project.name);
      const projected = projectHome(cfg.roster, await readLimits(localIO, cfg), pool);
      // The bash positional stays OPTIONAL: a case with no `project` calls
      // `_ws_least_loaded` with no argument, exactly as every pre-pool case
      // always has.
      const bash = sh(`_ws_least_loaded ${c.project?.name ?? ''}`);

      if (c.expect === null) {
        expect(projected, c.why).toBeNull();
        expect(bash, `ccd disagrees: ${c.why}`).toBe('');
        return;
      }
      expect(projected, c.why).toEqual(c.expect);
      expect(bash, `ccd disagrees: ${c.why}`).toBe(c.expect.wrapper);
      expect(shellScore(c.expect.wrapper), `score drift: ${c.why}`).toBe(c.expect.score);
    },
  );
});
```

Add a `projectPlacement` describe at the end of the file:

```ts
describe('projectPlacement — unmeasurable is a VALUE, not a null', () => {
  const L = (five: number | null, seven: number | null): AccountLimits =>
    // `authDead` joined `AccountLimits` in #66, AFTER this plan's block was
    // written — a required member, so the plan's literal no longer typechecks.
    // `false` is the right value here: this describe is about the POOL
    // dimension and a condemned lane would change which account wins for a
    // reason that has nothing to do with it.
    ({ five, seven, ts: 1, fiveResetAt: null, sevenResetAt: null,
       fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false });

  it('forecasts the in-pool account for a tagged project', () => {
    const cfg = loadConfig({ CCRC_HOME: home });
    expect(projectPlacement(cfg.roster, { claude: L(5, 5), 'claude-a': L(9, 9) }, { state: 'untagged' }))
      .toEqual({ kind: 'projected', wrapper: 'claude', score: 5 });
  });

  it('answers unmeasurable — never `none` — when the tag could not be read', () => {
    // `none` would claim a measurement: "nothing can take this project". An
    // unreadable tag means nobody looked, and the chip has to say so (spec
    // §5.6, §7's "Unreadable tag" walkthrough).
    const cfg = loadConfig({ CCRC_HOME: home });
    for (const state of ['unreadable', 'malformed'] as const) {
      expect(projectPlacement(cfg.roster, { claude: L(5, 5) }, { state }), state)
        .toEqual({ kind: 'unmeasurable' });
    }
  });

  it('answers none WITH the pool it was looking in, so a renderer need not re-derive it', () => {
    seedRoster(home, rosterWithPools({ claude: 'pool-a', 'claude-a': 'pool-a', 'claude-b': 'pool-a', 'claude-d': 'pool-a' }));
    const cfg = loadConfig({ CCRC_HOME: home });
    const off = { ...L(1, 1), disabled: true };
    expect(projectPlacement(cfg.roster, { claude: off, 'claude-a': off, 'claude-b': off, 'claude-d': off },
      { state: 'tagged', name: 'pool-b' })).toEqual({ kind: 'none', pool: 'pool-b' });
    expect(projectPlacement(cfg.roster, { claude: off, 'claude-a': off, 'claude-b': off, 'claude-d': off },
      { state: 'untagged' })).toEqual({ kind: 'none', pool: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/projected-home.test.ts`
Expected: FAIL — `SyntaxError: The requested module '../src/limits.js' does not provide an export named 'projectPlacement'`, and once that is stubbed, `TS2554: Expected 2 arguments, but got 3` on the `projectHome` call plus `pool-filters-cheapest` → `expected { wrapper: 'claude-a', score: 5 } to deeply equal { wrapper: 'claude-d', score: 60 }`.

- [ ] **Step 3: Write minimal implementation**

`server/src/limits.ts` — add the imports:

```ts
import { poolEligible, poolUndecidable } from './poolrule.js';
import type { ProjectPlacement, ProjectPoolWire } from '../../shared/api.js';
```

Change `projectHome`'s signature and first line (`:96-97`):

```ts
export function projectHome(
  roster: Roster, limits: Record<string, AccountLimits>, pool: ProjectPoolWire,
): ProjectedHome | null {
  const live = poolEligible(roster, pool).filter((a) => limits[a.id]?.disabled !== true);
```

and add to its docstring, before the closing `Kept honest against the bash by shared fixtures` line:

```
 * THE POOL IS AN ARGUMENT, REQUIRED (account pools, spec §5.6). `poolEligible`
 * replaces the bare `roster.homeAble`, mirroring `_ws_least_loaded`'s
 * `_pool_ok "$w" "$pps" || continue` inside the loop — the FILTER moves, the
 * scoring does not. An undecidable tag makes `poolEligible` empty and this
 * function `null`, which is NOT the same fact as "every lane is disabled";
 * `projectPlacement` below is what tells those two apart for the wire.
 *
 * Not defaulted: a default would let a caller that forgot the pool receive the
 * unconstrained forecast, which names an out-of-pool account — the one wrong
 * answer this function can give. `GET /api/accounts`'s global `projected` says
 * `{state:'untagged'}` out loud, and that is what that field now MEANS.
```

Add after `projectHome`:

```ts
/**
 * The same forecast, per PROJECT, with its three answers kept apart (spec
 * §5.6).
 *
 * `unmeasurable` is a VALUE, not a null and not a `none`: an unreadable or
 * malformed tag means nobody decided, so there is no forecast to give, and
 * `none` there would claim the measurement "nothing can take this project".
 * `none` carries the pool it was looking in so a renderer can name it without
 * re-deriving the tag.
 *
 * COMPOSES `projectHome`; decides nothing new. The pool DECISION is
 * `poolrule.ts`'s (L1) and is reached through `poolUndecidable`/`poolEligible`
 * rather than by testing state tokens here.
 */
export function projectPlacement(
  roster: Roster, limits: Record<string, AccountLimits>, pool: ProjectPoolWire,
): ProjectPlacement {
  if (poolUndecidable(pool)) return { kind: 'unmeasurable' };
  const home = projectHome(roster, limits, pool);
  if (home === null) return { kind: 'none', pool: pool.state === 'tagged' ? pool.name : null };
  return { kind: 'projected', wrapper: home.wrapper, score: home.score };
}
```

`server/src/server.ts:1185` — say what the global forecast means:

```ts
      // THE UNTAGGED FORECAST, said out loud (account pools, spec §5.6): this
      // field answers "where would a new workspace land on a project with no
      // pool tag", which is what it has always meant and is now the only thing
      // it can mean. Per-project placement rides `ProjectRow.placement` on
      // `GET /api/projects`.
      projected: projectHome(deps.cfg.roster, limits, { state: 'untagged' }),
```

Update the remaining two-argument calls inside `server/test/projected-home.test.ts`'s `projectHome edge cases` and `projectHome ranks unmeasured below measured` describes: add `, { state: 'untagged' }` to each. Their expectations do not move — an untagged project constrains nobody, so every pre-pool assertion holds byte for byte.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/projected-home.test.ts`
Expected: PASS — 17 pairing cases (13 existing + 4 new) plus the edge-case and `projectPlacement` describes.

If the four new cases fail on the BASH side only (`ccd disagrees`), wave 2a's `_ws_least_loaded [project]` / `_project_pool_state` are not on this branch — stop and rebase onto them rather than weakening the fixture.

- [ ] **Step 5: Measure the mutations**

1. In `projectHome`, change `poolEligible(roster, pool)` back to `roster.homeAble`.
   Expected RED: `pool-filters-cheapest` — `expected { wrapper: 'claude-a', score: 5 } to deeply equal { wrapper: 'claude-d', score: 60 }`; and `pool-empty-all-disabled` — `expected { wrapper: 'claude-a', score: 5 } to be null`.
2. In `projectPlacement`, delete the `poolUndecidable` guard.
   Expected RED: `answers unmeasurable — never 'none' — when the tag could not be read` — `expected { kind: 'none', pool: null } to deeply equal { kind: 'unmeasurable' }`.
3. In the runner, change `sh(\`_ws_least_loaded ${c.project?.name ?? ''}\`)` to `sh('_ws_least_loaded')`.
   Expected RED: `pool-filters-cheapest` — `ccd disagrees` with `expected 'claude-a' to be 'claude-d'`. (This is the guard that the fixture really drives BOTH sides; it must not be left mutated.)

- [ ] **Step 6: Commit**

```bash
git add server/src/limits.ts server/src/server.ts \
        server/test/fixtures/leastLoaded.ts server/test/projected-home.test.ts
git commit -m "feat(pools): the forecast takes the project's pool, and one fixture keeps both languages honest"
```

---

### Task 5 — DONE 2026-09-08 (3/3 mutations red)
### Task 5: `GET /api/projects` composes `pool` and `placement`; `listProjects` stays pool-free

**Files:**
- Modify: `shared/api.ts` (`ProjectRow` `:1367-1371`)
- Modify: `server/src/server.ts` (`app.get('/api/projects'` `:1667-1691`)
- Test: `server/test/projects-route-placement.test.ts` (create), `server/test/lifecycle.test.ts` (add to the readiness describe)

**Interfaces:**
- Consumes: `readProjectPools`, `poolFor` (Task 2); `projectPlacement` (Task 4); `readLimits` (`limits.ts:110`); `listProjects` (`lifecycle.ts:126`); `ProjectPlacement`, `ProjectPoolWire` (Task 1).
- Produces:
  ```ts
  export interface ProjectRow {
    name: string;
    workdir: string;
    readiness?: ProjectReadiness | null;
    pool?: ProjectPoolWire;
    placement?: ProjectPlacement;
  }
  ```

**Spec:** §5.4.4 (callers — `GET /api/projects` with its own root readdir, composing per row exactly as it composes `readiness`; `listProjects` stays pool-free), §5.4.5 (`ProjectRow.pool?` beside `readiness?`), §5.6 (`placement` per project), §11 rows 21 and 48.

**Mutation table:**
- Row 21 — `lifecycle.test.ts`'s new pair plus its existing `listProjects itself still returns rows with NO readiness key` case, widened. Goes RED when the composition is moved into `listProjects` (the fleet read would grow a policy read) or dropped from either arm of the route.
- Row 48 — `projects-route-placement.test.ts`. Goes RED when `unmeasurable` is collapsed into `none`, when the global `projected` is given a project, or when `pool`/`placement` are composed on only one of the route's two arms.

**Cost, stated:** this route now takes one `io.readdir(cfg.registryDir)` of its own, plus `readProjectPools` (one `pools/` readdir and one read per tagged project) and one `readLimits` (one `.cc-limits` readdir, one registry readdir, one read per account). It is a screen-open read, not a 2-second tick — the tick's own pool read (Task 7) rides `registryRead.names` and costs no extra root readdir at all.

- [ ] **Step 1: Write the failing test**

Create `server/test/projects-route-placement.test.ts`:

```ts
// Spec §5.6, §11 row 48. `GET /api/accounts`'s `projected` is the forecast for
// an UNTAGGED project and stays global; the per-project answer rides
// `ProjectRow.placement`, and its third member — `unmeasurable` — is a VALUE.
// Collapsing it into `none` would tell an operator that nothing can take a
// project when in fact nobody looked.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { ccdRunner } from '../src/lifecycle.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { POOLS_DIR_NAME } from '../src/pools.js';
import { DEFAULT_TEST_ROSTER, seedRoster } from './helpers.js';
import { degradedReadIO } from './ioDoubles.js';
import { mkTmp } from './tmpHelpers.js';
import type { FleetIO } from '../src/io.js';
import type { ProjectPlacement, ProjectPoolWire } from '../../shared/api.js';

let home: string;
let projectsRoot: string;
let app: FastifyInstance | undefined;

const POOLED = {
  ...DEFAULT_TEST_ROSTER,
  accounts: DEFAULT_TEST_ROSTER.accounts.map((a) =>
    a.id === 'claude' ? { ...a, pool: 'pool-a' }
    : a.id === 'claude-a' ? { ...a, pool: 'pool-b' }
    : a.id === 'claude-b' ? { ...a, pool: 'pool-b' }
    : a.id === 'claude-d' ? { ...a, pool: 'pool-b' } : a),
};

const dead: Runner = async () => ({ code: 1, stdout: '', stderr: '' });

const open = async (io: FleetIO = localIO): Promise<FastifyInstance> => {
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: projectsRoot });
  const a = await buildServer({
    cfg, runCcd: ccdRunner(dead, cfg), tmux: new Tmux(dead), io, queue: new KeyedQueue(),
  });
  await a.ready();
  return a;
};

const rows = async (a: FastifyInstance): Promise<Record<string, { pool: ProjectPoolWire; placement: ProjectPlacement }>> => {
  const res = await a.inject({ method: 'GET', url: '/api/projects' });
  expect(res.statusCode).toBe(200);
  return Object.fromEntries((res.json().projects as Array<{ name: string; pool: ProjectPoolWire; placement: ProjectPlacement }>)
    .map((p) => [p.name, { pool: p.pool, placement: p.placement }]));
};

const tag = (project: string, bytes: string): void => {
  const dir = path.join(home, '.cc-sessions', POOLS_DIR_NAME);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, project), bytes);
};

const limits = (w: string, five: number, seven: number): void => {
  const dir = path.join(home, '.cc-limits');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${w}.json`), JSON.stringify({
    five, seven, ts: Math.floor(Date.now() / 1000) - 60,
    fiveResetAt: Math.floor(Date.now() / 1000) + 9000,
    sevenResetAt: Math.floor(Date.now() / 1000) + 400000,
  }));
};

beforeEach(() => {
  home = mkTmp('ccrc-projects-pool-');
  seedRoster(home, POOLED);
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  projectsRoot = mkTmp('ccrc-projects-root-');
  mkdirSync(path.join(projectsRoot, 'demo'));
  mkdirSync(path.join(projectsRoot, 'quiet-basin'));
  limits('claude', 70, 70);
  limits('claude-a', 10, 10);
  limits('claude-b', 20, 20);
  limits('claude-d', 30, 30);
});

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
  rmSync(home, { recursive: true, force: true });
  rmSync(projectsRoot, { recursive: true, force: true });
});

describe('GET /api/projects — pool and placement per row', () => {
  it('an untagged project is untagged, and its placement is the unconstrained forecast', async () => {
    app = await open();
    expect((await rows(app)).demo).toEqual({
      pool: { state: 'untagged' },
      placement: { kind: 'projected', wrapper: 'claude-a', score: 10 },
    });
  });

  it('a tagged project forecasts the cheapest account IN ITS POOL, not the cheapest account', async () => {
    // `claude-a` at 10 is cheapest on the box and is in pool-b; pool-a's only
    // member is `claude` at 70. A row that named claude-a would be forecasting
    // a placement ccd would refuse.
    tag('demo', 'pool-a');
    app = await open();
    expect((await rows(app)).demo).toEqual({
      pool: { state: 'tagged', name: 'pool-a' },
      placement: { kind: 'projected', wrapper: 'claude', score: 70 },
    });
  });

  it('a pool with no member forecasts NONE, naming the pool', async () => {
    tag('demo', 'pool-c');
    app = await open();
    expect((await rows(app)).demo).toEqual({
      pool: { state: 'tagged', name: 'pool-c' },
      placement: { kind: 'none', pool: 'pool-c' },
    });
  });

  it('a malformed tag is malformed and UNMEASURABLE, never none and never untagged', async () => {
    tag('demo', 'Pool A');
    app = await open();
    expect((await rows(app)).demo).toEqual({
      pool: { state: 'malformed' },
      placement: { kind: 'unmeasurable' },
    });
  });

  it('an unreadable tag is unreadable and UNMEASURABLE, and only that project is affected', async () => {
    tag('demo', 'pool-a');
    tag('quiet-basin', 'pool-a');
    app = await open(degradedReadIO((p) => p.endsWith(`${POOLS_DIR_NAME}/demo`)));
    const r = await rows(app);
    expect(r.demo).toEqual({ pool: { state: 'unreadable' }, placement: { kind: 'unmeasurable' } });
    expect(r['quiet-basin']).toEqual({
      pool: { state: 'tagged', name: 'pool-a' },
      placement: { kind: 'projected', wrapper: 'claude', score: 70 },
    });
  });

  it('the global `projected` on GET /api/accounts is still the UNTAGGED forecast, whatever is tagged', async () => {
    // The two fields are different questions and this pins that they stay so:
    // tagging every project must not move the accounts screen's `+` forecast.
    tag('demo', 'pool-a');
    tag('quiet-basin', 'pool-a');
    app = await open();
    const res = await app.inject({ method: 'GET', url: '/api/accounts' });
    expect(res.json().projected).toEqual({ wrapper: 'claude-a', score: 10 });
  });
});
```

Add to `server/test/lifecycle.test.ts`, inside `describe('GET /api/projects — the program-ready readiness', …)`:

```ts
  it('composes pool and placement on the UNSWEPT arm too — both arms, or the chip flickers', async () => {
    // The route has two returns (`fleet === undefined` and the composed one)
    // and they are the same row. A composition on one arm only would make the
    // chip appear the moment the first readiness sweep landed and not before.
    const { app } = await makeApp({ unswept: true });
    const row = (await app.inject({ method: 'GET', url: '/api/projects' })).json().projects[0];
    expect(row.readiness).toBeNull();
    expect(row.pool).toEqual({ state: 'untagged' });
    expect(row.placement.kind).toBe('projected');
    await app.close();
  });

  it('listProjects itself still returns rows with NO pool and NO placement key — the route composes them', async () => {
    // Same split as `readiness` above it: `listProjects` is the fleet read and
    // the pool is policy. Keeping them apart is what lets the fleet read stay
    // testable with no registry policy on disk at all.
    const { cfg, app } = await makeApp();
    const out = await listProjects(localIO, cfg);
    expect(out.projects.length).toBeGreaterThan(0);
    expect(out.projects.every((p) => !('pool' in p) && !('placement' in p))).toBe(true);
    await app.close();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/projects-route-placement.test.ts test/lifecycle.test.ts`
Expected: FAIL — `expected undefined to deeply equal { state: 'untagged' }` on every `projects-route-placement` case, and `expected undefined to deeply equal { state: 'untagged' }` on the new lifecycle case.

- [ ] **Step 3: Write minimal implementation**

`shared/api.ts` — add to `ProjectRow` (`:1367-1371`) and extend its docstring:

```ts
/**
 * One row of `GET /api/projects`.
 *
 * `readiness` is THREE-VALUED and each value is a different fact:
 *   - the key ABSENT: this server does not measure readiness (an older build);
 *   - `null`: it measures, and has not swept yet;
 *   - an object: measured.
 * A reader that folds the first two together has thrown away the difference
 * between "upgrade the server" and "wait two seconds".
 *
 * `pool` and `placement` follow the same absence rule with one fewer rung: the
 * key ABSENT means an older server that does not read project pools, and a
 * reader must render NOTHING for it — never `{state:'untagged'}`, which would
 * flag every project on the box as un-tagged worklist the day before the
 * feature ships (account pools, spec §5.4.5, §5.9). There is no `null` rung:
 * this build measures on every request, and its four states already contain
 * "we could not read it".
 */
export interface ProjectRow {
  name: string;
  workdir: string;
  readiness?: ProjectReadiness | null;
  pool?: ProjectPoolWire;
  placement?: ProjectPlacement;
}
```

`server/src/server.ts` — rewrite the `/api/projects` handler body (`:1667-1691`), keeping every existing comment above it:

```ts
  app.get('/api/projects', async () => {
    const listed = await listProjects(deps.io, deps.cfg);
    // The pool half, composed HERE and never inside `listProjects`: that is the
    // fleet read (a readdir of the projects root unioned with registry
    // workdirs) and this is policy off the registry, exactly the split
    // `readiness` already draws. One root readdir feeds `readProjectPools`,
    // which needs the PARENT listing to tell an absent `pools/` from an
    // unlistable one (`pools.ts`, spec §5.4.4).
    const rootNames = await deps.io.readdir(deps.cfg.registryDir);
    const poolsRead = await readProjectPools(deps.io, deps.cfg, rootNames);
    const limits = await readLimits(deps.io, deps.cfg);
    const poolCells = (p: ProjectRow): Pick<ProjectRow, 'pool' | 'placement'> => {
      const pool = poolFor(poolsRead, p.name);
      return { pool, placement: projectPlacement(deps.cfg.roster, limits, pool) };
    };
    const fleet = watcher?.currentReadiness();
    if (fleet === undefined) {
      return { ...listed, projects: listed.projects.map((p) => ({ ...p, readiness: null, ...poolCells(p) })) };
    }
    const coord = deps.coord;
    return {
      ...listed,
      projects: listed.projects.map((p) => {
        // Caught PER PROJECT: one unreadable row must not blank the rest.
        // `ledgerFloor` has no result type — a sick store throws — and a
        // failed read is `unmeasurable`, never `not-seeded`, which would send
        // an operator to seed a floor that may already exist.
        let floor: FloorState;
        try {
          floor = coord === undefined
            ? 'unmeasurable'
            : coord.ledgerFloor(p.name) === null ? 'not-seeded' : 'seeded';
        } catch {
          floor = 'unmeasurable';
        }
        return { ...p, readiness: projectReadiness(fleet, floor), ...poolCells(p) };
      }),
    };
  });
```

Add the imports at the top of `server/src/server.ts`: `import { poolFor, readProjectPools } from './pools.js';`, `projectPlacement` onto the existing `./limits.js` import, and `ProjectRow` onto the existing `../../shared/api.js` type import.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/projects-route-placement.test.ts test/lifecycle.test.ts`
Expected: PASS.

- [ ] **Step 5: Measure the mutations**

1. Move `...poolCells(p)` out of the `fleet === undefined` arm only.
   Expected RED: `composes pool and placement on the UNSWEPT arm too` — `expected undefined to deeply equal { state: 'untagged' }`.
2. In `poolCells`, replace `projectPlacement(...)` with `{ kind: 'none', pool: null }` for the undecidable states (i.e. delete `projectPlacement`'s guard through this path by hard-coding).
   Expected RED: `a malformed tag is malformed and UNMEASURABLE, never none and never untagged`.
3. Add `pool: poolFor(poolsRead, rec.project)` to `listProjects` in `server/src/lifecycle.ts` (requires threading it in — do the minimal hack).
   Expected RED: `listProjects itself still returns rows with NO pool and NO placement key`.

- [ ] **Step 6: Commit**

```bash
git add shared/api.ts server/src/server.ts \
        server/test/projects-route-placement.test.ts server/test/lifecycle.test.ts
git commit -m "feat(pools): every project row carries its tag and the forecast inside that tag"
```

---

### Task 6 — DONE 2026-09-08 (3/3 mutations red)
### Task 6: `GET /api/fleet` carries `pools` for first paint; `/api/fleet/health` carries `projectPools`

**Files:**
- Modify: `shared/api.ts` (`FleetHealth` `:2301-2330`)
- Modify: `server/src/server.ts` (`app.get('/api/fleet'` `:1016-1023`; `app.get('/api/fleet/health'` `:1040-1081`, BOTH arms)
- Test: `server/test/fleet-health.test.ts`

**Interfaces:**
- Consumes: `readProjectPools`, `poolsWire`, `poolsEnforcement` (Task 2); `deps.fleetState?.ccdVerbs` (`fleetstate.ts:25`).
- Produces: `FleetHealth.projectPools?: PoolsEnforcement`; `GET /api/fleet` response gains `pools?: ProjectPoolsWire`.

**Spec:** §5.4.4 (`GET /api/fleet` for first paint, additive `pools?`), §5.4.5 (`FleetHealth.projectPools?` on `/api/fleet/health` — health is where the PWA already reads skew), §5.11 (the skew table's "New server, old `ccd`" row), §11 row 23 (the `fleet-health` cases; the banner is wave 4).

**Mutation table:**
- Row 23 — `fleet-health.test.ts`. Goes RED when the derivation folds a state (a null caps list answering `unavailable`, which would arm wave 4's banner on every local-mode box) or when the block appears on only one of the handler's two arms.

**A note on the name `FleetState.pools`:** the brief spells this field `FleetState.pools?`, but `GET /api/fleet` has no named response interface — the server returns a literal and the PWA types it inline (`pwa/src/lib/api.ts:421`, `getJson<{ sessions; stale?; downSince? }>`), while `FleetState` in `server/src/fleetstate.ts:25` is the REMOTE-CONNECTION state (`ccdVerbs`, `rosterFp`, `build`) and is not on the wire at all. The field lands as an additive key on that route's literal; wave 4 adds `pools?: ProjectPoolsWire` to the PWA's inline generic. No new interface is minted for one optional key.

**The degraded arm carries NOTHING, deliberately:** when the fleet host is unreachable `GET /api/fleet` serves the cached snapshot, and nothing about pools is persisted (spec §5.4.1, §5.9). A cached tag rendered as live policy would lie, so that arm omits the key and the PWA stays silent.

- [ ] **Step 1: Write the failing test**

Add to `server/test/fleet-health.test.ts`, in `describe('GET /api/fleet/health', …)`:

```ts
  it('local mode with no measured caps says projectPools: unknown — never unavailable', async () => {
    // `unavailable` is a MEASURED absence an operator acts on (redeploy the
    // agent lane). No caps list is no evidence, and wave 4's banner arms on
    // `unavailable` only — so folding these two would put a "redeploy the
    // fleet host" banner on every dev box.
    const app = await buildServer(testDeps());
    const res = await app.inject({ method: 'GET', url: '/api/fleet/health' });
    expect(res.json().projectPools).toBe('unknown');
    await app.close();
  });

  it('a fleet host advertising project-pool is enforced; one that is not is unavailable', async () => {
    const verb = CCD_ARGV.projectPoolClear('demo')[0]!;
    for (const [verbs, expected] of [
      [[verb, 'swap'], 'enforced'],
      [['swap', 'start'], 'unavailable'],
      [null, 'unknown'],
    ] as const) {
      const app = await buildServer(remoteDeps({}, {
        connected: true, downSince: null, ccdVerbs: verbs === null ? null : [...verbs],
        rosterFp: null, build: null,
      }));
      const res = await app.inject({ method: 'GET', url: '/api/fleet/health' });
      expect(res.json().projectPools, JSON.stringify(verbs)).toBe(expected);
      await app.close();
    }
  });
```

and in `describe('GET /api/fleet — degraded mode', …)`:

```ts
  it('a live assemble carries the measured pools for first paint', async () => {
    const home = mkTmp('ccrc-fleet-pools-');
    seedRoster(home);
    mkdirSync(path.join(home, '.cc-sessions', 'pools'), { recursive: true });
    writeFileSync(path.join(home, '.cc-sessions', 'pools', 'demo'), 'pool-a');
    const app = await buildServer(testDeps(home));
    const res = await app.inject({ method: 'GET', url: '/api/fleet' });
    expect(res.json().pools).toEqual({
      listed: true, byProject: { demo: { state: 'tagged', name: 'pool-a' } }, enforcement: 'unknown',
    });
    await app.close();
  });

  it('the DEGRADED arm carries no pools key at all — a cached tag is not live policy', async () => {
    // Nothing pooled is persisted (spec §5.4.1). Serving the last snapshot must
    // not come with a pool answer this process could not take, so the key is
    // ABSENT and the PWA renders nothing rather than a stale chip.
    const cachePath = path.join(mkTmp('ccrc-fleet-pools-cache-'), 'state-cache.json');
    await saveSnapshot([session('demo')], cachePath);
    const app = await buildServer(remoteDeps({}, {
      connected: false, downSince: 1785300000000, ccdVerbs: null, rosterFp: null, build: null,
    }, cachePath));
    const res = await app.inject({ method: 'GET', url: '/api/fleet' });
    expect(res.json().stale).toBe(true);
    expect(Object.keys(res.json())).not.toContain('pools');
    await app.close();
  });
```

Add `import { CCD_ARGV } from '../src/ccdargv.js';` to the file's imports. The local-mode exact-shape assertion at `:68` gains the new key:

```ts
    expect(res.json()).toEqual({ mode: 'local', connected: true, downSince: null, roster: 'unknown', build: 'unknown', projectPools: 'unknown' });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/fleet-health.test.ts`
Expected: FAIL — `expected undefined to be 'unknown'` on the two health cases, `expected undefined to deeply equal { listed: true, … }` on the fleet case, and the exact-shape case reporting the missing `projectPools` key.

- [ ] **Step 3: Write minimal implementation**

`shared/api.ts` — add to `FleetHealth`, after the `build` field's docstring block:

```ts
  /**
   * Whether the fleet host's deployed `ccd` HONOURS project pools — the verb
   * `ccd project-pool` present in its `caps` list (account pools, spec §5.11).
   * One `ccd` inode ships the verb and every reader, so the verb's presence IS
   * the evidence that placement, the auto-swapper and the manual verbs apply
   * the rule.
   *
   * Same three-state rule as `roster` and `build`, with its own remedy:
   * `'unavailable'` means tags will DISPLAY and nothing on the fleet will
   * enforce them — redeploy the agent lane; `'unknown'` means nobody could
   * tell, and a reader must stay SILENT on it (the banner arms on
   * `'unavailable'` only).
   *
   * Optional for the same absence-permits reason the two above are.
   */
  projectPools?: PoolsEnforcement;
```

`server/src/server.ts` — `GET /api/fleet` (`:1016`):

```ts
  app.get('/api/fleet', async () => {
    if (deps.cfg.fleetMode === 'remote' && deps.fleetState && !deps.fleetState.connected) {
      const snap = await loadSnapshot(stateCachePath);
      // NO `pools` KEY on this arm, deliberately: nothing about pools is
      // persisted (spec §5.4.1), so there is nothing measured to serve, and a
      // cached tag rendered as live policy would lie. Absence reads as
      // "unknown" on the PWA, which is the truth here.
      if (snap) return { sessions: snap.sessions, stale: true, downSince: deps.fleetState.downSince };
    }
    // FIRST PAINT (spec §5.4.4). The `pools` frame is emitted ON CHANGE from
    // the watcher tick, so a client connecting into a quiet fleet would
    // otherwise see no tags until one moved; this is where it gets the
    // measured answer, off its own root listing.
    const rootNames = await deps.io.readdir(deps.cfg.registryDir);
    const poolsRead = await readProjectPools(deps.io, deps.cfg, rootNames);
    return {
      sessions: await assembleFleet(deps.io, deps.cfg, deps.tmux, undefined, watcher?.currentPending(), watcher?.currentStatuslines(), watcher?.currentTaskProgress(), watcher?.currentPrStates(), watcher?.currentHookStates()),
      pools: poolsWire(poolsRead, poolsEnforcement(deps.fleetState?.ccdVerbs ?? null)),
    };
  });
```

`GET /api/fleet/health` — add to BOTH returns:

```ts
        projectPools: poolsEnforcement(deps.fleetState?.ccdVerbs ?? null),
```

(in the remote arm beside `build:`, and in the local arm beside `roster: 'unknown', build: 'unknown',` — local mode measures its own ccd at boot through `readLocalCcdCaps`, so `unknown` there is "not measured yet", not "local mode cannot tell".)

Add `poolsEnforcement`, `poolsWire` to the `./pools.js` import added in Task 5, and `PoolsEnforcement` to the shared type import.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/fleet-health.test.ts test/fleetws.test.ts`
Expected: PASS. (`fleetws.test.ts` is run alongside because `GET /api/fleet` now returns a second key; its `GET /api/fleet returns assembled sessions` case reads `body.sessions` and is unaffected.)

- [ ] **Step 5: Measure the mutations**

1. In `poolsEnforcement`'s call site, pass `deps.fleetState?.ccdVerbs ?? []` instead of `?? null`.
   Expected RED: `local mode with no measured caps says projectPools: unknown — never unavailable` — `expected 'unavailable' to be 'unknown'`.
2. Delete `projectPools` from the local-mode return only.
   Expected RED: the exact-shape case at `:68` — `expected { mode: 'local', … } to deeply equal { …, projectPools: 'unknown' }`.
3. Add `pools: poolsWire({ listed: true, tags: new Map() }, 'unknown')` to the degraded arm.
   Expected RED: `the DEGRADED arm carries no pools key at all`.

- [ ] **Step 6: Commit**

```bash
git add shared/api.ts server/src/server.ts server/test/fleet-health.test.ts
git commit -m "feat(pools): first paint carries the tags, health carries whether the fleet enforces them"
```

---

### Task 7 — DONE 2026-09-08 (4/4 mutations red)
### Task 7: the `pools` frame — additive, change-only, off the tick's own listing

**Files:**
- Modify: `shared/api.ts` (`FleetMsg` `:2634-2650`, after the `divergence` member)
- Modify: `server/src/bus.ts` (the three overload blocks)
- Modify: `server/src/watch.ts` (a `lastPoolsJson`/`pools` pair beside `lastCoordJson`/`coord` `:545-548`; `currentPools()` beside `currentCoord()` `:650`; `emitPools` beside `emitCoord` `:1063`; the call beside `this.emitCoord(...)` `:702`)
- Modify: `server/src/server.ts` (`/ws/fleet` — `onPools`, the cold start after `coord` `:1254-1255` — the cold start itself is D-1683, an addition to spec §5.4.5's change-only frame — and the `bus.on`/`bus.off` pairs `:1260-1267`)
- Test: `server/test/fleetws.test.ts`

**Interfaces:**
- Consumes: `readProjectPools`, `poolsWire`, `poolsEnforcement` (Task 2); `registryRead.names` (`registry.ts:784-786`, `RegistryRead.names`); the `emitCoord` byte-equality idiom (`watch.ts:1063-1073`).
- Produces:
  ```ts
  // shared/api.ts
  | { type: 'pools'; pools: ProjectPoolsWire }
  // server/src/watch.ts
  currentPools(): ProjectPoolsWire | null;
  ```

**Spec:** §5.4.4 (the watcher tick, with `registryRead.names` — zero extra root readdirs), §5.4.5 (the frame is FLEET-LEVEL and must not ride `FleetSession`, or `reviveFleetSession` becomes a second producer; emitted with a byte-equality change guard), §5.9, §11 row 22.

**Mutation table:**
- Row 22 — `fleetws.test.ts`'s new `pools` describe. Goes RED when the byte-equality guard is deleted (two identical ticks emit two frames), when the frame stops being emitted on a change, or when `FLEET_PROTO` is bumped.

**A frame in the stream is churn, and this task absorbs it once:** `collect` in `fleetws.test.ts` gains a DEFAULT drop for `pools` — the inverse of `dropDivergence`'s opt-in, because this frame arrives on every cold start and every registry-listing change, and an opt-out would need ten edits today and would silently break the eleventh test somebody writes tomorrow. The one describe that is ABOUT the frame opts back in.

- [ ] **Step 1: Write the failing test**

In `server/test/fleetws.test.ts`, change `collect` (`:53-69`):

```ts
const collect = (ws: WebSocket, opts: { dropDivergence?: boolean; keepPools?: boolean } = {}) => {
  const queue: unknown[] = [];
  const waiters: Array<(m: unknown) => void> = [];
  ws.on('message', (d) => {
    const m: unknown = JSON.parse(String(d));
    if (opts.dropDivergence === true && (m as { type?: unknown }).type === 'divergence') return;
    // DROPPED BY DEFAULT, the inverse of `dropDivergence` above and stated
    // rather than assumed: the `pools` frame rides the cold start and every
    // registry-listing change, so every case in this file that is about
    // `fleet`/`runs`/`coord` ordering would otherwise have to opt out. The one
    // describe that is about this frame passes `keepPools`.
    if (opts.keepPools !== true && (m as { type?: unknown }).type === 'pools') return;
    const w = waiters.shift();
    if (w) w(m);
    else queue.push(m);
  });
  // …unchanged
};
```

Add a describe beside `describe('the `coord` frame', …)`:

```ts
  // Account pools, spec §5.4.5 / §11 row 22 — the `{type:'pools'}` frame. A
  // FLEET-LEVEL fact: a project's tag is not a property of any session, and
  // riding it on `FleetSession` would make `reviveFleetSession` a second
  // producer of it (the `divergence` frame's own argument).
  describe('the `pools` frame', () => {
    const connect = async (over: Partial<Deps> = {}, opts: { tick?: boolean } = {}) => {
      const deps = { ...testDeps(home), ...over };
      const bus = new Bus();
      const watcher = new FleetWatcher(deps, bus);
      app = await buildServer(deps, bus, watcher);
      if (opts.tick !== false) await watcher.tick();
      await app.listen({ host: '127.0.0.1', port: 0 });
      const addr = app.server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/fleet`);
      const next = collect(ws, { dropDivergence: opts.tick !== false, keepPools: true });
      await new Promise<void>((resolve, reject) => { ws.on('open', () => resolve()); ws.on('error', reject); });
      return { ws, next, watcher, bus };
    };

    const tag = (project: string, bytes: string) => {
      mkdirSync(path.join(home, '.cc-sessions', 'pools'), { recursive: true });
      writeFileSync(path.join(home, '.cc-sessions', 'pools', project), bytes);
    };

    it('cold-starts after coord, carrying the measured tags', async () => {
      tag('demo', 'pool-a');
      const { ws, next } = await connect();
      expect((await next()).type).toBe('hello');
      expect((await next()).type).toBe('fleet');
      expect((await next()).type).toBe('coord');
      const frame = await next();
      expect(frame.type).toBe('pools');
      expect(frame.pools).toEqual({
        listed: true, byProject: { demo: { state: 'tagged', name: 'pool-a' } }, enforcement: 'unknown',
      });
      ws.close();
    });

    it('sends NOTHING before the first tick — never a fabricated empty map', async () => {
      // `currentPools()` is null until a tick measured. A cold start that
      // invented `{listed:true, byProject:{}}` would tell the phone that
      // nothing on the fleet is tagged, off a box this process never read.
      const { ws, next, bus } = await connect({}, { tick: false });
      expect((await next()).type).toBe('hello');
      expect((await next()).type).toBe('fleet');
      bus.emit('notice', { message: 'unrelated' });
      expect(await next()).toEqual({ type: 'notice', message: 'unrelated' });
      ws.close();
    });

    it('re-emits only on CHANGE, byte-equality guarded like coord', async () => {
      const { ws, next, watcher, bus } = await connect();
      expect((await next()).type).toBe('hello');
      expect((await next()).type).toBe('fleet');
      expect((await next()).type).toBe('coord');
      expect((await next()).type).toBe('pools');

      await watcher.tick();                       // nothing moved
      bus.emit('notice', { message: 'unrelated' });
      expect(await next()).toEqual({ type: 'notice', message: 'unrelated' });

      tag('demo', 'pool-b');                      // now it moved
      await watcher.tick();
      const frame = await next();
      expect(frame.type).toBe('pools');
      expect(frame.pools.byProject.demo).toEqual({ state: 'tagged', name: 'pool-b' });
      ws.close();
    });

    it('says listed:false when the registry root cannot be listed — the tick that fails shut still reports', async () => {
      // The emitter sits BESIDE `emitCoord`, above the `!listed` early return,
      // for `emitCoord`'s own reason: placed below it the chips would freeze on
      // their last value while the box could not be read at all.
      let listable = true;
      const flaky: FleetIO = { ...localIO, readdir: async (p) => (listable ? localIO.readdir(p) : null) };
      const { ws, next, watcher } = await connect({ io: flaky });
      expect((await next()).type).toBe('hello');
      expect((await next()).type).toBe('fleet');
      expect((await next()).type).toBe('coord');
      expect((await next()).type).toBe('pools');

      listable = false;
      await watcher.tick();
      const coordFrame = await next();
      expect(coordFrame.type).toBe('coord');
      const frame = await next();
      expect(frame.type).toBe('pools');
      expect(frame.pools).toEqual({ listed: false, enforcement: 'unknown' });
      ws.close();
    });

    it('an old client still shrugs, and FLEET_PROTO is untouched', async () => {
      const { ws, next } = await connect();
      expect((await next()).type).toBe('hello');
      expect((await next()).type).toBe('fleet');
      expect((await next()).type).toBe('coord');
      const frame = await next();
      expect(Object.keys(frame).sort()).toEqual(['pools', 'type']);
      expect(FLEET_PROTO).toBe(1);
      expect(FLEET_PROTO_MIN).toBe(1);
      ws.close();
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/fleetws.test.ts`
Expected: FAIL — `the pools frame > cold-starts after coord, carrying the measured tags`: `Error: timed out waiting for ws message` (no fourth frame is ever sent).

- [ ] **Step 3: Write minimal implementation**

`shared/api.ts` — add to `FleetMsg`, after the `divergence` member (`:2650`):

```ts
  /** Account pools, spec §5.4.5. Additive on the same terms as
   *  `runs`/`coord`/`divergence` above — an already-deployed PWA drops an
   *  unknown frame type silently, so NO `FLEET_PROTO` bump. FLEET-LEVEL, not
   *  row-level: a project's tag is a fact about a PROJECT, so it cannot ride on
   *  a `FleetSession` — and keeping it off `FleetSession` is what keeps
   *  `reviveFleetSession` from becoming a second producer of it. The PWA
   *  derives a session's project pool from this frame by `s.project`. */
  | { type: 'pools'; pools: ProjectPoolsWire };
```

`server/src/bus.ts` — add one line to each of the three overload blocks, and name the event in the class docstring:

```ts
  override emit(event: 'pools', pools: ProjectPoolsWire): boolean;
  override on(event: 'pools', listener: (pools: ProjectPoolsWire) => void): this;
  override off(event: 'pools', listener: (pools: ProjectPoolsWire) => void): this;
```
(plus `ProjectPoolsWire` on the existing `../../shared/api.js` type import).

`server/src/watch.ts` — beside `lastCoordJson`/`coord` (`:545-548`):

```ts
  /** `emitPools`'s byte-equality guard and last measured value — `lastCoordJson`
   *  and `coord`'s idiom, for their reasons. `null` until a tick has measured,
   *  and `currentPools()` sends NOTHING while it is: a fabricated empty map
   *  would claim this process had looked at the fleet host's registry. */
  private lastPoolsJson: string | null = null;
  private pools: ProjectPoolsWire | null = null;
```

beside `currentCoord()` (`:650`):

```ts
  /** The last measured project-pool sweep, or null if none has been taken yet
   *  — same reasoning as `currentCoord()`'s null. */
  currentPools(): ProjectPoolsWire | null {
    return this.pools;
  }
```

beside `emitCoord` (`:1063`):

```ts
  /** The `{type:'pools'}` frame (account pools, spec §5.4.5). Derived from the
   *  SAME registry listing this tick already performed — carried out of
   *  `readRegistryMeasured` on `RegistryRead.names` rather than taken again,
   *  exactly as `emitCoord` above does, so the two cannot disagree on the ticks
   *  that matter and the tick costs no extra root readdir.
   *
   *  `null` names is an UNLISTABLE registry, and rides the wire as
   *  `listed: false` — every project `unreadable`, nobody decides.
   *
   *  Byte-equality guarded like `emitCoord`. It DOES touch io (one `pools/`
   *  readdir and one read per tagged project), so it is async and awaited by
   *  the caller before the fail-shut return, for `emitCoord`'s own reason. */
  private async emitPools(names: readonly string[] | null): Promise<void> {
    const read = await readProjectPools(this.deps.io, this.deps.cfg, names);
    const wire = poolsWire(read, poolsEnforcement(this.deps.fleetState?.ccdVerbs ?? null));
    const json = JSON.stringify(wire);
    if (json === this.lastPoolsJson) return;
    this.lastPoolsJson = json;
    this.pools = wire;
    this.bus.emit('pools', wire);
  }
```

in `tick()`, immediately after `this.emitCoord(...)` (`:702`) and BEFORE the `if (!registryRead.listed)` return:

```ts
      // BEFORE the fail-shut return and on BOTH arms, `emitCoord`'s reason one
      // line up: an unlistable registry is exactly the state in which nobody
      // may decide a pool, so it must reach the wire on the tick it happens
      // rather than leave the chips frozen on their last value.
      await this.emitPools(registryRead.listed ? registryRead.names : null);
```

`server/src/server.ts` — in `/ws/fleet`:

```ts
    const onPools = (pools: ProjectPoolsWire) =>
      socket.send(JSON.stringify({ type: 'pools', pools } satisfies FleetMsg));
```
chained after the `coord` cold start (`:1254-1255`):

```ts
      // Chained AFTER `coord`, so the wire order is hello, fleet, runs, coord,
      // pools. A `null` current value sends NOTHING, `coord`'s rule verbatim:
      // this process has never measured, and an invented empty map would tell
      // the phone that nothing on the fleet is tagged.
      const poolsNow = watcher?.currentPools();
      if (poolsNow) onPools(poolsNow);
```
and `bus.on('pools', onPools);` / `bus.off('pools', onPools);` beside the `divergence` pair.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/fleetws.test.ts`
Expected: PASS — the whole file, including the untouched `coord`/`runs` ordering cases (they drop `pools` by default).

- [ ] **Step 5: Measure the mutations**

1. Delete `if (json === this.lastPoolsJson) return;`
   Expected RED: `re-emits only on CHANGE, byte-equality guarded like coord` — `expected { type: 'pools', … } to deeply equal { type: 'notice', message: 'unrelated' }`.
2. Move the `await this.emitPools(...)` call below the `if (!registryRead.listed) { … return; }` block.
   Expected RED: `says listed:false when the registry root cannot be listed` — `Error: timed out waiting for ws message`.
3. Change `FLEET_PROTO` to 2 in `shared/api.ts`.
   Expected RED: `an old client still shrugs, and FLEET_PROTO is untouched` — `expected 2 to be 1`; and `fleetws.test.ts`'s existing hello assertion.
4. Change the cold start to `onPools(poolsNow ?? { listed: true, byProject: {}, enforcement: 'unknown' })`.
   Expected RED: `sends NOTHING before the first tick — never a fabricated empty map`.

- [ ] **Step 6: Commit**

```bash
git add shared/api.ts server/src/bus.ts server/src/watch.ts server/src/server.ts \
        server/test/fleetws.test.ts
git commit -m "feat(pools): the tick relays the tags on change, off the listing it already took"
```

---

### Task 8 — DONE 2026-09-09 (2/2 mutations red)
### Task 8: `swapCross`, `startCross`, `enableCross` — a LEADING flag, enumerated

**Files:**
- Modify: `server/src/ccdargv.ts` (`CCD_ARGV` `:180-314`; the three entries beside `swap` `:223` and `start`/`enable` `:181-186`)
- Test: `server/test/whitelist-subset.test.ts` (`SAMPLES` `:18`, `EXPECTED` `:310`)

**Interfaces:**
- Consumes: `argv(...)` (the `CcdArgv` brand mint, `ccdargv.ts`); wave 2b's `--cross-pool` flag on `cmd_swap`/`cmd_start`/`cmd_enable`.
- Produces:
  ```ts
  swapCross:   (id: string, w: string) => CcdArgv;                        // ['swap','--cross-pool',id,w]
  startCross:  (w: string, p: string, wd?: string) => CcdArgv;            // ['start','--cross-pool',w,p,…wd]
  enableCross: (w: string, p: string, wd?: string) => CcdArgv;            // ['enable','--cross-pool',w,p,…wd]
  ```

**Spec:** §5.6 (builders with a LEADING `--cross-pool`), §5.7.1, §11 row 16.

**Mutation table:**
- Row 16 — `whitelist-subset.test.ts` layers 2 and 3 plus the token-for-token table. Goes RED when a builder is deleted (its `SAMPLES`/`EXPECTED` key becomes a `tsc` error through `Record<keyof typeof CCD_ARGV, …>`), when a sample is omitted (same), or when the flag moves to the trailing position.

- [ ] **Step 1: Write the failing test**

In `server/test/whitelist-subset.test.ts`, add to `SAMPLES` (beside `swap`, `start`, `enable`):

```ts
  /** The deliberate crossing. Three separate ENTRIES rather than an option on
   *  the three above, `start`/`enable`'s own rule (`ccdargv.ts:180`): a route
   *  picks the entry, so both spellings are enumerated here and neither can
   *  drift out of the agent's list. */
  swapCross: ['demo-quiet-basin', 'claude-b'],
  startCross: ['claude', 'demo'],
  enableCross: ['claude', 'demo'],
```

and to `EXPECTED`:

```ts
  // LEADING flag, before the positionals — the token order is
  // parse-load-bearing and it is the SAFE direction under version skew (spec
  // §5.6): a TRAILING `--cross-pool` on an old ccd's `start w p wd` is a
  // silently ignored fourth positional, while a leading one is refused by
  // `_is_valid_wrapper` on every ccd that has ever shipped. Loud beats silent.
  swapCross: ['swap', '--cross-pool', 'demo-quiet-basin', 'claude-b'],
  startCross: ['start', '--cross-pool', 'claude', 'demo'],
  enableCross: ['enable', '--cross-pool', 'claude', 'demo'],
```

Add one case at the end of the token-for-token describe:

```ts
  it('the cross-pool builders carry the workdir AFTER the positionals, flag still leading', () => {
    expect(CCD_ARGV.startCross('claude', 'demo', '/w'))
      .toEqual(['start', '--cross-pool', 'claude', 'demo', '/w']);
    expect(CCD_ARGV.enableCross('claude', 'demo', '/w'))
      .toEqual(['enable', '--cross-pool', 'claude', 'demo', '/w']);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/whitelist-subset.test.ts test/typecheck-tests.test.ts`
Expected: FAIL — `typecheck-tests.test.ts`: `test/whitelist-subset.test.ts(…): error TS2353: Object literal may only specify known properties, and 'swapCross' does not exist in type 'Record<"start" | "enable" | …, unknown[]>'`; and the new case: `TypeError: CCD_ARGV.startCross is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `server/src/ccdargv.ts`, add immediately after `swap` (`:223`):

```ts
  /** THE DELIBERATE CROSSING (account pools, spec §5.7). A SEPARATE ENTRY, not
   *  a parameter of `swap` above — `start`/`enable`'s rule, for its reason: a
   *  route picks the entry, so both spellings are enumerated by
   *  `whitelist-subset.test.ts` and neither can drift out of the agent's list.
   *
   *  THE FLAG LEADS, and the position is the safety property, not a style
   *  choice. A trailing `--cross-pool` on an old ccd's `start <w> <p> <wd>`
   *  binds as a silently-ignored fourth positional and `runCcdOr502` renders
   *  its exit 0 as `200 {ok:true}` — the silent-success class this file already
   *  paid for once with `stop --surface`. A LEADING one is refused by
   *  `_is_valid_wrapper` on every ccd that has ever shipped, so the wrong guess
   *  costs a loud 502. `capSupported(state, POOLS_CAP)` at the call site is the
   *  gate that should stop it reaching an old box at all; this is the second
   *  lock. */
  swapCross: (id: string, w: string) => argv(['swap', '--cross-pool', id, w]),
```

and immediately after `enable` (`:186`):

```ts
  /** `start`/`enable` with the crossing declared — see `swapCross` below for
   *  why the flag leads and why these are separate entries. */
  startCross:  (w: string, p: string, wd?: string) => argv(['start', '--cross-pool', w, p, ...(wd ? [wd] : [])]),
  enableCross: (w: string, p: string, wd?: string) => argv(['enable', '--cross-pool', w, p, ...(wd ? [wd] : [])]),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/whitelist-subset.test.ts test/verb-gate.test.ts test/typecheck-tests.test.ts`
Expected: PASS. (`verb-gate.test.ts` is run because `VERB_OF` builds every entry — the three new ones emit `swap`/`start`/`enable`, all already in `UNGATED_BY_DECISION`, so the exemption list is unchanged and still non-rotten.)

- [ ] **Step 5: Measure the mutations**

1. Move the flag to the end: `argv(['swap', id, w, '--cross-pool'])`.
   Expected RED: `swapCross builds the exact argv, token for token` — `expected [ 'swap', 'demo-quiet-basin', 'claude-b', '--cross-pool' ] to deeply equal [ 'swap', '--cross-pool', 'demo-quiet-basin', 'claude-b' ]`.
2. Delete the `startCross` entry.
   Expected RED: `typecheck-tests.test.ts` — `error TS2741: Property 'startCross' is missing in type … but required in type 'Record<keyof typeof CCD_ARGV, unknown[]>'` reported the other way round, plus `has a sample for every CCD_ARGV entry`.

- [ ] **Step 6: Commit**

```bash
git add server/src/ccdargv.ts server/test/whitelist-subset.test.ts
git commit -m "feat(pools): a crossing is its own argv, and the flag leads so an old box refuses loudly"
```

---

### Task 9 — DONE 2026-09-09 (5/5 mutations red)
### Task 9: `POST /api/projects/:project/pool` — the tag route, gated on the verb, answering a MEASURED state

**Files:**
- Modify: `server/src/server.ts` (register beside `app.post('/api/projects/:project/workspaces'` `:1714`)
- Modify: `server/src/auth/gate.ts:8` (the prose route count)
- Test: `server/test/project-pool-route.test.ts` (create), `server/test/verb-gate.test.ts` (`NEW_GENERATION` `:270`), `server/test/auth-gate.test.ts` (`:195`, `:204`, and the two prose counts at `:705`, `:769`)

**Interfaces:**
- Consumes: `CCD_ARGV.projectPoolSet` / `.projectPoolClear` (wave 2a); `verbSupported` (`ccdargv.ts:322`); `POOL_NAME_RE` (wave 1); `readProjectPools`, `poolFor` (Task 2); `poolRostered` (Task 1); `deps.runCcd`.
- Produces: `POST /api/projects/:project/pool`, body `{ pool: string | null }`, answering
  `400 { ok:false, error:'bad-request' }` | `400 { ok:false, error:'bad-pool-name' }` |
  `501 { ok:false, error:'unsupported' }` | `502 { ok:false, stderr }` |
  `200 { ok:true, pool: ProjectPoolWire, warning?: 'unknown-pool' }`.

**Spec:** §5.4.2 (the ROUTE paragraph in full), §5.11 (no capability token — the verb's presence IS the evidence), §11 rows 18, 19, 27.

**Mutation table:**
- Row 18 — `verb-gate.test.ts`'s named pin gains `project-pool`, plus `project-pool-route.test.ts`'s 501 case. Goes RED when the literal `verbSupported(` leaves the handler, or when `project-pool` is added to `UNGATED_BY_DECISION` to silence it.
- Row 19 — `project-pool-route.test.ts`'s two 200 cases. Goes RED when the route echoes what was REQUESTED instead of re-reading the marker.
- Row 27 — `auth-gate.test.ts`'s two hard literals, each +1. Goes RED when the route is registered without them.

**Not exempt, no box token:** the route is absent from `auth/gate.ts`'s `EXEMPT` table, so with `CCRC_AUTH` armed it sits behind the session gate like `/workspaces` and `/swap`, and open dark otherwise. It carries no box token: this is FLEET CONTROL, not a coordination write, and the box-token census (`box-token-census.test.ts`) counts lanes by their `checkMailToken` call — a route with none is not a lane and the census arithmetic (`ALL_LANES.length === COORD_LANES.length + 1`) does not move.

**LEDGER:** `isSafeProjectSegment` refuses a leading `-`/`_` that `_ws_project_valid` accepts, so the two grammars disagree — and this route deliberately does NOT reach for either. The `:project` param goes to `ccd` unvalidated exactly as `POST /api/projects/:project/workspaces` sends it, because `_ws_project_valid` on the box is the authority; and the server's own reader never joins a request-supplied name into a path — `poolFor` is a Map lookup against names that came back from a LISTING, so a `..` or a slash can only ever miss. Recorded for alignment, not fixed here (D-1679 — spec §12 P-16).

**MEASURE, do not copy, the three counts.** `server/test/auth-gate.test.ts:195` reads `46`, `:204` reads `71`, and `server/src/auth/gate.ts:8` says "all 68 routes" — read each at implementation time and add one. `auth-gate.test.ts` also says "all 68 HTTP routes" in prose at `:705` and `:769`; those are the HTTP half (`71 - 3` websockets) and move to 69.

- [ ] **Step 1: Write the failing test**

Create `server/test/project-pool-route.test.ts`:

```ts
// Spec §5.4.2. The route's whole contract is that it ANSWERS A MEASURED STATE:
// unlike `$REG/coordinator-paused`, this file IS under the agent's read roots,
// so the truthful answer is available before the 200 leaves — and echoing what
// was requested would report a tag the box may have refused to write.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { ccdRunner } from '../src/lifecycle.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { CCD_ARGV } from '../src/ccdargv.js';
import { POOLS_DIR_NAME } from '../src/pools.js';
import { DEFAULT_TEST_ROSTER, seedRoster } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

let home: string;
let app: FastifyInstance | undefined;

const VERB = CCD_ARGV.projectPoolClear('demo')[0]!;

const POOLED = {
  ...DEFAULT_TEST_ROSTER,
  accounts: DEFAULT_TEST_ROSTER.accounts.map((a) => (a.id === 'claude' ? { ...a, pool: 'pool-a' } : a)),
};

const poolsDir = (): string => path.join(home, '.cc-sessions', POOLS_DIR_NAME);

/** A runner that RECORDS the argv and optionally acts on the marker, so the
 *  route's 200 is measured against a filesystem the "verb" actually changed. */
const runnerThat = (
  act: (argv: string[]) => void = () => {}, code = 0,
): { run: Runner; calls: string[][] } => {
  const calls: string[][] = [];
  return {
    calls,
    run: async (_cmd, args) => {
      calls.push([...args]);
      act([...args]);
      return code === 0
        ? { code: 0, stdout: '', stderr: '' }
        : { code, stdout: '', stderr: `ccd: pool tag for demo is malformed: ${poolsDir()}/demo` };
    },
  };
};

const open = async (
  run: Runner, over: Partial<Deps> = {},
): Promise<FastifyInstance> => {
  const cfg = loadConfig({ CCRC_HOME: home });
  const a = await buildServer({
    cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue(), ...over,
  } as Deps);
  await a.ready();
  return a;
};

const post = async (a: FastifyInstance, project: string, body: unknown) =>
  a.inject({ method: 'POST', url: `/api/projects/${project}/pool`, payload: body as never });

beforeEach(() => {
  home = mkTmp('ccrc-pool-route-');
  seedRoster(home, POOLED);
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
});

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
  rmSync(home, { recursive: true, force: true });
});

describe('POST /api/projects/:project/pool — refusals', () => {
  it('400 bad-request when `pool` is neither a string nor null', async () => {
    const { run, calls } = runnerThat();
    app = await open(run);
    for (const body of [{}, { pool: 7 }, { pool: true }, { pool: ['pool-a'] }]) {
      const res = await post(app, 'demo', body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json()).toEqual({ ok: false, error: 'bad-request' });
    }
    expect(calls, 'a refused body must not reach ccd').toEqual([]);
  });

  it('400 bad-pool-name for a string the grammar refuses, and ccd is never called', async () => {
    // The grammar is `POOL_NAME_RE`, imported from `shared/roster.ts` — the one
    // TypeScript spelling, pinned against ccd's one bash literal by
    // `pool-name-parity.test.ts`.
    const { run, calls } = runnerThat();
    app = await open(run);
    for (const pool of ['', 'Pool-A', 'pool a', '1pool', 'pool_a', '-pool', 'a'.repeat(33)]) {
      const res = await post(app, 'demo', { pool });
      expect(res.statusCode, pool).toBe(400);
      expect(res.json()).toEqual({ ok: false, error: 'bad-pool-name' });
    }
    expect(calls).toEqual([]);
  });

  it('501 unsupported when the deployed ccd does not have the verb', async () => {
    // Refuse on MEASURED absence, permit on none — `verbSupported`'s rule. The
    // verb is new and skew-exposed, so it must never join
    // `UNGATED_BY_DECISION`.
    const { run, calls } = runnerThat();
    app = await open(run, {
      fleetState: { connected: true, downSince: null, ccdVerbs: ['swap', 'start'], rosterFp: null, build: null },
    });
    const res = await post(app, 'demo', { pool: 'pool-a' });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({ ok: false, error: 'unsupported' });
    expect(calls).toEqual([]);
  });

  it('proceeds when ccdVerbs is null — an absent list is no evidence', async () => {
    const { run, calls } = runnerThat();
    app = await open(run);
    expect((await post(app, 'demo', { pool: 'pool-a' })).statusCode).toBe(200);
    expect(calls).toEqual([[VERB, '--project', 'demo', '--pool', 'pool-a']]);
  });

  it('502 with ccd\'s own sentence when the box refuses', async () => {
    const { run } = runnerThat(() => {}, 1);
    app = await open(run);
    const res = await post(app, 'demo', { pool: 'pool-a' });
    expect(res.statusCode).toBe(502);
    expect(res.json().ok).toBe(false);
    expect(res.json().stderr).toContain('pool tag for demo is malformed');
  });
});

describe('POST /api/projects/:project/pool — the measured 200', () => {
  it('answers untagged when the verb wrote nothing — never the requested value', async () => {
    // THE POINT OF THE ROUTE. A runner that exits 0 and writes nothing is a
    // stand-in for every way the box can decline; the answer must be what the
    // marker SAYS, not what the caller asked for.
    const { run } = runnerThat();
    app = await open(run);
    const res = await post(app, 'demo', { pool: 'pool-a' });
    expect(res.statusCode).toBe(200);
    expect(res.json().pool).toEqual({ state: 'untagged' });
  });

  it('answers tagged, with the bytes the verb actually wrote', async () => {
    const { run } = runnerThat(() => {
      mkdirSync(poolsDir(), { recursive: true });
      writeFileSync(path.join(poolsDir(), 'demo'), 'pool-a');
    });
    app = await open(run);
    const res = await post(app, 'demo', { pool: 'pool-a' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, pool: { state: 'tagged', name: 'pool-a' } });
  });

  it('answers malformed when the bytes on disk do not match the grammar', async () => {
    const { run } = runnerThat(() => {
      mkdirSync(poolsDir(), { recursive: true });
      writeFileSync(path.join(poolsDir(), 'demo'), 'pool a');
    });
    app = await open(run);
    expect((await post(app, 'demo', { pool: 'pool-a' })).json().pool).toEqual({ state: 'malformed' });
  });

  it('warns unknown-pool when this box\'s roster has no account in that pool', async () => {
    // A WARNING, not a refusal (O4): the server's roster copy can lag the
    // fleet's, and the pool may be about to gain an account.
    const { run } = runnerThat(() => {
      mkdirSync(poolsDir(), { recursive: true });
      writeFileSync(path.join(poolsDir(), 'demo'), 'pool-b');
    });
    app = await open(run);
    const res = await post(app, 'demo', { pool: 'pool-b' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, pool: { state: 'tagged', name: 'pool-b' }, warning: 'unknown-pool' });
  });

  it('does NOT warn for a pool the roster carries', async () => {
    const { run } = runnerThat(() => {
      mkdirSync(poolsDir(), { recursive: true });
      writeFileSync(path.join(poolsDir(), 'demo'), 'pool-a');
    });
    app = await open(run);
    expect(Object.keys((await post(app, 'demo', { pool: 'pool-a' })).json())).not.toContain('warning');
  });

  it('clears with the --clear entry, and never warns on a clear', async () => {
    mkdirSync(poolsDir(), { recursive: true });
    writeFileSync(path.join(poolsDir(), 'demo'), 'pool-b');
    const { run, calls } = runnerThat(() => { rmSync(path.join(poolsDir(), 'demo')); });
    app = await open(run);
    const res = await post(app, 'demo', { pool: null });
    expect(calls).toEqual([[VERB, '--project', 'demo', '--clear']]);
    expect(res.json()).toEqual({ ok: true, pool: { state: 'untagged' } });
  });
});
```

In `server/test/verb-gate.test.ts`, extend the named pin (`:268-277`):

```ts
    // `project-pool` joins the six: it is the newest skew-exposed verb, and
    // `verbSupported`'s permit-on-no-evidence default means a route that forgets
    // the gate sends it to a box that answers `die "usage: ..."` -> 502 "the tag
    // failed", which reads as a broken feature rather than an old fleet host.
    const NEW_GENERATION = ['pr-state', 'pr-open', 'ws-archive', 'ws-restore', 'ws-audit', 'ws-reap', 'project-pool'];
```

In `server/test/auth-gate.test.ts`, bump the two literals by one and the two prose counts (measure first):

```ts
    expect(scanRoutes('server.ts').length).toBe(47);
    …
    expect(ROUTES.length).toBe(72);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/project-pool-route.test.ts test/verb-gate.test.ts test/auth-gate.test.ts`
Expected: FAIL — `project-pool-route.test.ts`: every case `expected 404 to be 400` (the route is not registered); `verb-gate.test.ts`: `project-pool has no call site at all` — `expected 0 to be greater than 0`; `auth-gate.test.ts`: `expected 46 to be 47`.

- [ ] **Step 3: Write minimal implementation**

`server/src/server.ts` — register immediately after `app.post('/api/projects/:project/workspaces'` (`:1714-1717`):

```ts
  /**
   * The project's pool tag (account pools, spec §5.4.2). `{ pool: string }`
   * tags, `{ pool: null }` clears.
   *
   * THE TERNARY PICKS THE ENTRY, not a verb interpolated into an array —
   * `start`/`enable`'s rule (`ccdargv.ts:180`), so both spellings are
   * enumerated by `whitelist-subset.test.ts`.
   *
   * `:project` GOES THROUGH UNVALIDATED, exactly as `/workspaces` above sends
   * it: `_ws_project_valid` on the box is the grammar and the authority, and
   * this server's own reader never joins a request-supplied name into a path
   * (`poolFor` is a Map lookup against names a LISTING returned), so nothing
   * here can escape `pools/`. `isSafeProjectSegment`'s stricter grammar
   * deliberately does not enter — it refuses a leading `-`/`_` that ccd
   * accepts, and applying it would make some taggable projects untaggable from
   * the phone.
   *
   * THE 200 IS MEASURED, NOT ECHOED. Unlike `$REG/coordinator-paused`, this
   * file IS under the agent's read roots, so the truthful answer is available
   * before the reply leaves — and `requested` would report a tag the box may
   * have declined to write. The re-read is a fresh `readdir` + one read, on a
   * route a human taps.
   *
   * NOT in `auth/gate.ts`'s EXEMPT table — session-gated when armed, open dark,
   * like `/workspaces` and `/swap`. NO BOX TOKEN: this is fleet control, not a
   * coordination write.
   */
  app.post('/api/projects/:project/pool', async (req, reply) => {
    const { project } = req.params as { project: string };
    const body = (req.body ?? {}) as { pool?: unknown };
    if (body.pool !== null && typeof body.pool !== 'string') {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    if (body.pool !== null && !POOL_NAME_RE.test(body.pool)) {
      return reply.code(400).send({ ok: false, error: 'bad-pool-name' });
    }
    const argv = body.pool === null
      ? CCD_ARGV.projectPoolClear(project)
      : CCD_ARGV.projectPoolSet(project, body.pool);
    if (!verbSupported(deps.fleetState, argv)) {
      return reply.code(501).send({ ok: false, error: 'unsupported' });
    }
    const res = await deps.runCcd(argv);
    if (!res.ok) return reply.code(502).send({ ok: false, stderr: res.stderr });
    const rootNames = await deps.io.readdir(deps.cfg.registryDir);
    const measured = poolFor(await readProjectPools(deps.io, deps.cfg, rootNames), project);
    // A WARNING, never a refusal (O4): this box's `accounts.json` is one of two
    // hand-owned copies and can lag the fleet's, so "no account carries that
    // name" is a thing worth saying and not a thing worth blocking on.
    const warn = body.pool !== null && !poolRostered(deps.cfg.roster, body.pool);
    return { ok: true, pool: measured, ...(warn ? { warning: 'unknown-pool' as const } : {}) };
  });
```

Add `POOL_NAME_RE` to the existing `../../shared/roster.js` import and `poolRostered` to the `./poolrule.js` import.

`server/src/auth/gate.ts:8` — bump the prose count to the number you measured:

```ts
 * THE GATE. One `onRequest` hook stands in front of all 69 routes, the static
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/project-pool-route.test.ts test/verb-gate.test.ts test/auth-gate.test.ts test/box-token-census.test.ts`
Expected: PASS. (`box-token-census.test.ts` is run to confirm the arithmetic did NOT move — a route with no `checkMailToken` is not a lane.)

- [ ] **Step 5: Measure the mutations**

1. Delete the `if (!verbSupported(...))` block.
   Expected RED: `verb-gate.test.ts > gates every verb this branch added, at every one of its call sites` — the site list for `project-pool` is non-empty and ungated; and `project-pool-route.test.ts > 501 unsupported when the deployed ccd does not have the verb` — `expected 200 to be 501`.
2. Add `'project-pool'` to `UNGATED_BY_DECISION` and re-apply mutation 1.
   Expected RED: `verb-gate.test.ts` STILL red on the named pin — that is the point of the named list.
3. Replace the measured re-read with `pool: body.pool === null ? { state: 'untagged' } : { state: 'tagged', name: body.pool }`.
   Expected RED: `answers untagged when the verb wrote nothing — never the requested value`.
4. Change the `warn` condition to `body.pool !== null`.
   Expected RED: `does NOT warn for a pool the roster carries`.
5. Revert `auth-gate.test.ts:195` to `46`.
   Expected RED: `found both files, and EXACTLY the route count the surface has` — `expected 47 to be 46`.

- [ ] **Step 6: Commit**

```bash
git add server/src/server.ts server/src/auth/gate.ts \
        server/test/project-pool-route.test.ts server/test/verb-gate.test.ts server/test/auth-gate.test.ts
git commit -m "feat(pools): the tag route asks the box and then reads the file, never its own request"
```

---

### Task 10 — DONE 2026-09-09 (5/5 mutations red)
### Task 10: the 409, the 503 and the `crossPool` override on swap and sessions

**Files:**
- Modify: `server/src/server.ts` (`knownId` `:1398-1401`; `app.post('/api/sessions'` `:1694-1712`; `app.post('/api/sessions/:id/swap'` `:1850-1857`)
- Test: `server/test/swap-route-pool.test.ts` (create), `server/test/lifecycle.test.ts` (the two existing swap cases stay byte-identical — verify)

**Interfaces:**
- Consumes: `poolVerdict` (Task 1); `readProjectPools`, `poolFor` (Task 2); `CCD_ARGV.swapCross`/`.startCross`/`.enableCross` (Task 8); `POOLS_CAP`, `capSupported` (wave 2a / `ccdargv.ts:369`); `readSessionRecord` (`registry.ts` — reading one id's row through `/stop`'s 404/503 ladder, in place of the spec's flat 404 over `readRegistry`, is D-1684).
- Produces: `crossPool?: boolean` on both bodies; `409 { ok:false, error:'pool-mismatch', accountPool, projectPool }`; `503 { ok:false, error:'pool-unreadable', state }`; `501 { ok:false, error:'unsupported' }`; and on swap, `404 { ok:false, error:'unknown-session' }` / `503 { ok:false, error:'registry-unmeasurable' }`.
  ```ts
  const knownId = async (id: string, names?: readonly string[] | null): Promise<boolean>;
  ```

**Spec:** §5.6 (Routes), §5.5.5 (`cmd_start`'s creation-only guard, which the sessions route mirrors), §11 row 46.

**Mutation table:**
- Row 46 — `swap-route-pool.test.ts`. Goes RED when the verdict branch is removed (a mismatch would reach ccd), when `verbSupported` is used for the capability instead of `capSupported` (a `--cross-pool` argv would go to a box with no evidence it parses the flag — the silent-success class), or when a REVIVAL is refused instead of passing through.

**Cost, stated:** a plain swap now takes one `readSessionRecord` (~23 measured field reads for ONE id — not the fleet) plus one registry-root readdir, one `pools/` readdir and one read per tagged project, before the argv is built. `POST /api/sessions` takes the readdir set only. Both are human-tapped controls, not tick lanes, and the freshness is the point: the 409 decides on the same bytes `cmd_swap` is about to read (spec §5.6).

**No fast path, deliberately.** A short-circuit that skipped the record read while `pools/` is empty would make the 404 ladder appear only once something is tagged — one route with two behaviours depending on unrelated state. One path, always.

**LEDGER:** `SessionRecord.project` falls back to the session id when the `.project` field is unmeasured (`registry.ts:675`, `project ?? id`), so on a degraded row this pre-check consults the tag of a project NAMED LIKE THE ID rather than the one ccd will consult (ccd reads an empty `$project` and `_project_pool_state` answers `untagged`). Reachable only where a project is tagged whose name equals a live session id — the `acct-a-demo` collision shape, one level up. The polarity is a REFUSAL the operator can override with `--cross-pool`, never a wrong placement, so it is disclosed rather than closed; closing it needs a measured `project` field, which `SessionRecord` does not carry today (D-1681 — plan-time, no spec label).

- [ ] **Step 1: Write the failing test**

Create `server/test/swap-route-pool.test.ts`:

```ts
// Spec §5.6 / §11 row 46. The server REFUSES; it never places. These cases pin
// both halves of that: a mismatch is a 409 with a slug and ccd is NEVER called,
// and a deliberate crossing is gated on MEASURED evidence that the box parses
// the flag — because a `--cross-pool` that an old ccd mis-binds is the
// silent-success class, not a loud failure.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO, type FleetIO } from '../src/io.js';
import { ccdRunner } from '../src/lifecycle.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { CCD_ARGV, POOLS_CAP } from '../src/ccdargv.js';
import { POOLS_DIR_NAME } from '../src/pools.js';
import { DEFAULT_TEST_ROSTER, seedRoster } from './helpers.js';
import { degradedReadIO } from './ioDoubles.js';
import { mkTmp } from './tmpHelpers.js';

let home: string;
let app: FastifyInstance | undefined;
let calls: string[][];

const ID = 'claude-demo';

const POOLED = {
  ...DEFAULT_TEST_ROSTER,
  accounts: DEFAULT_TEST_ROSTER.accounts.map((a) =>
    a.id === 'claude' ? { ...a, pool: 'pool-a' }
    : a.id === 'claude-b' ? { ...a, pool: 'pool-b' } : a),
};

const seedField = (id: string, field: string, value: string): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  writeFileSync(path.join(reg, `${id}.${field}`), value);
};

const seedSession = (id: string, wrapper: string, project: string): void => {
  seedField(id, 'wrapper', wrapper);
  seedField(id, 'project', project);
  seedField(id, 'workdir', `/data/projects/${project}`);
  seedField(id, 'uuid', 'a'.repeat(36));
};

const tag = (project: string, bytes: string): void => {
  const dir = path.join(home, '.cc-sessions', POOLS_DIR_NAME);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, project), bytes);
};

const open = async (
  opts: { ccdVerbs?: string[] | null; io?: FleetIO } = {},
): Promise<FastifyInstance> => {
  calls = [];
  const run: Runner = async (_cmd, args) => { calls.push([...args]); return { code: 0, stdout: '', stderr: '' }; };
  const cfg = loadConfig({ CCRC_HOME: home });
  const a = await buildServer({
    cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: opts.io ?? localIO, queue: new KeyedQueue(),
    ...(opts.ccdVerbs !== undefined
      ? { fleetState: { connected: true, downSince: null, ccdVerbs: opts.ccdVerbs, rosterFp: null, build: null } }
      : {}),
  } as Deps);
  await a.ready();
  return a;
};

beforeEach(() => {
  home = mkTmp('ccrc-swap-pool-');
  seedRoster(home, POOLED);
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  seedSession(ID, 'claude', 'demo');
});

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
  rmSync(home, { recursive: true, force: true });
});

describe('POST /api/sessions/:id/swap — the pool pre-check', () => {
  it('passes an in-pool target straight through, argv unchanged', async () => {
    tag('demo', 'pool-a');
    app = await open();
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/swap`, payload: { wrapper: 'claude' } });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([['swap', ID, 'claude']]);
  });

  it('passes an UNTAGGED account through to a tagged project — an untagged account is unconstrained', async () => {
    tag('demo', 'pool-a');
    app = await open();
    expect((await app.inject({ method: 'POST', url: `/api/sessions/${ID}/swap`, payload: { wrapper: 'claude-d' } })).statusCode).toBe(200);
    expect(calls).toEqual([['swap', ID, 'claude-d']]);
  });

  it('409s a mismatch, names both pools, and NEVER calls ccd', async () => {
    tag('demo', 'pool-a');
    app = await open();
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/swap`, payload: { wrapper: 'claude-b' } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'pool-mismatch', accountPool: 'pool-b', projectPool: 'pool-a' });
    expect(calls, 'the server refuses; it must not also ask the box').toEqual([]);
  });

  it('503s an undecidable tag with the state, and never calls ccd', async () => {
    // NOBODY DECIDES (spec §5.2). Not a 409 — a 409 says "this account is
    // wrong", and nothing here knows that.
    tag('demo', 'Pool A');
    app = await open();
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/swap`, payload: { wrapper: 'claude-b' } });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, error: 'pool-unreadable', state: 'malformed' });
    expect(calls).toEqual([]);
  });

  it('503s `unreadable` when the marker is there and its bytes did not come back', async () => {
    tag('demo', 'pool-a');
    app = await open({ io: degradedReadIO((p) => p.endsWith(`${POOLS_DIR_NAME}/demo`)) });
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/swap`, payload: { wrapper: 'claude-b' } });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, error: 'pool-unreadable', state: 'unreadable' });
  });

  it('404s an id the registry does not list, and 503s a registry it could not list', async () => {
    app = await open();
    const missing = await app.inject({ method: 'POST', url: '/api/sessions/claude-nothing/swap', payload: { wrapper: 'claude' } });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ ok: false, error: 'unknown-session' });
    await app.close();
    app = await open({ io: { ...localIO, readdir: async () => null } });
    const unlistable = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/swap`, payload: { wrapper: 'claude' } });
    expect(unlistable.statusCode).toBe(503);
    expect(unlistable.json()).toEqual({ ok: false, error: 'registry-unmeasurable' });
  });
});

describe('POST /api/sessions/:id/swap — the deliberate crossing', () => {
  it('501s crossPool when the box has not advertised pools-v1 — REFUSE on no evidence', async () => {
    // `capSupported`, not `verbSupported`: for a FLAG a wrong guess is a silent
    // success (an old ccd binds `--cross-pool` somewhere harmless and exits 0,
    // which `runCcdOr502` renders as `200 {ok:true}`), so the no-evidence
    // default is refuse.
    tag('demo', 'pool-a');
    for (const verbs of [null, ['swap']] as const) {
      app = await open({ ccdVerbs: verbs === null ? null : [...verbs] });
      const res = await app.inject({
        method: 'POST', url: `/api/sessions/${ID}/swap`, payload: { wrapper: 'claude-b', crossPool: true },
      });
      expect(res.statusCode, JSON.stringify(verbs)).toBe(501);
      expect(res.json()).toEqual({ ok: false, error: 'unsupported' });
      expect(calls).toEqual([]);
      await app.close();
      app = undefined;
    }
  });

  it('builds the swapCross argv when the box advertises pools-v1', async () => {
    tag('demo', 'pool-a');
    app = await open({ ccdVerbs: ['swap', POOLS_CAP] });
    const res = await app.inject({
      method: 'POST', url: `/api/sessions/${ID}/swap`, payload: { wrapper: 'claude-b', crossPool: true },
    });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([CCD_ARGV.swapCross(ID, 'claude-b') as unknown as string[]]);
  });

  it('crossPool:false is not a crossing — it takes the ordinary verdict', async () => {
    tag('demo', 'pool-a');
    app = await open({ ccdVerbs: ['swap', POOLS_CAP] });
    const res = await app.inject({
      method: 'POST', url: `/api/sessions/${ID}/swap`, payload: { wrapper: 'claude-b', crossPool: false },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('POST /api/sessions — creation-only, revival passes through', () => {
  it('409s a mismatched CREATION', async () => {
    tag('quiet-basin', 'pool-a');
    app = await open();
    const res = await app.inject({
      method: 'POST', url: '/api/sessions', payload: { wrapper: 'claude-b', project: 'quiet-basin' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'pool-mismatch', accountPool: 'pool-b', projectPool: 'pool-a' });
    expect(calls).toEqual([]);
  });

  it('passes a REVIVAL through unchecked — the registry wins, and ruling 5 moves it', async () => {
    // `cmd_start`'s own fix (spec §5.5.5): at the two-argument form the registry
    // overrides the wrapper argument, so refusing here would refuse a REVIVE of
    // a session that is already running wrong-pool — and the auto-swapper is
    // what moves it, at the next boundary.
    tag('demo', 'pool-a');
    seedSession('claude-b-demo', 'claude-b', 'demo');
    app = await open();
    const res = await app.inject({
      method: 'POST', url: '/api/sessions', payload: { wrapper: 'claude-b', project: 'demo' },
    });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([['enable', 'claude-b', 'demo']]);
  });

  it('501s a crossPool creation on a box with no pools-v1, and builds enableCross/startCross with it', async () => {
    tag('quiet-basin', 'pool-a');
    app = await open({ ccdVerbs: ['enable'] });
    expect((await app.inject({
      method: 'POST', url: '/api/sessions', payload: { wrapper: 'claude-b', project: 'quiet-basin', crossPool: true },
    })).statusCode).toBe(501);
    await app.close();

    app = await open({ ccdVerbs: ['enable', 'start', POOLS_CAP] });
    await app.inject({
      method: 'POST', url: '/api/sessions', payload: { wrapper: 'claude-b', project: 'quiet-basin', crossPool: true },
    });
    await app.inject({
      method: 'POST', url: '/api/sessions',
      payload: { wrapper: 'claude-b', project: 'quiet-basin', crossPool: true, enable: false, workdir: '/w' },
    });
    expect(calls).toEqual([
      ['enable', '--cross-pool', 'claude-b', 'quiet-basin'],
      ['start', '--cross-pool', 'claude-b', 'quiet-basin', '/w'],
    ]);
  });

  it('503s an undecidable tag on creation', async () => {
    tag('quiet-basin', 'pool a');
    app = await open();
    const res = await app.inject({
      method: 'POST', url: '/api/sessions', payload: { wrapper: 'claude', project: 'quiet-basin' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, error: 'pool-unreadable', state: 'malformed' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/swap-route-pool.test.ts`
Expected: FAIL — `409s a mismatch, names both pools, and NEVER calls ccd`: `expected 200 to be 409`; `404s an id the registry does not list`: `expected 200 to be 404`.

- [ ] **Step 3: Write minimal implementation**

`server/src/server.ts` — widen `knownId` (`:1398-1401`) so a caller that already holds the listing does not take a second one:

```ts
  const knownId = async (id: string, names?: readonly string[] | null): Promise<boolean> => {
    // `names` PASSED IN by a caller that already listed (the sessions route,
    // which needs the same listing for `readProjectPools`): one readdir, one
    // membership test, and the two answers cannot disagree. `undefined` — every
    // other caller — takes its own, exactly as before.
    const listed = names === undefined ? await deps.io.readdir(deps.cfg.registryDir) : names;
    return listed !== null && listed.includes(`${id}.uuid`);
  };
```

Add one shared helper beside `runCcdOr502` (`:1645`):

```ts
  /**
   * The pool pre-check every placement route makes (account pools, spec §5.6).
   * Returns `null` when the caller may proceed, or a REPLY that has already
   * been sent. The routes call `poolVerdict` through this and never re-derive
   * the rule — L4 owns fastify and does not DECIDE.
   *
   * 409 is "this account is wrong for this project", overridable with
   * `crossPool`. 503 is "nobody can decide", which is NOT overridable here:
   * the tag is unreadable or malformed, and `ccd` refuses it too.
   */
  const refusePool = (
    reply: FastifyReply, wrapper: string, pool: ProjectPoolWire,
  ): FastifyReply | null => {
    const v = poolVerdict(deps.cfg.roster, wrapper, pool);
    if (v.ok) return null;
    return v.reason === 'pool-mismatch'
      ? reply.code(409).send({ ok: false, error: 'pool-mismatch', accountPool: v.accountPool, projectPool: v.projectPool })
      : reply.code(503).send({ ok: false, error: 'pool-unreadable', state: v.state });
  };
```

`POST /api/sessions` (`:1694`):

```ts
  app.post('/api/sessions', async (req, reply) => {
    const body = (req.body ?? {}) as { wrapper?: unknown; project?: unknown; workdir?: unknown; enable?: unknown; crossPool?: unknown };
    if (typeof body.wrapper !== 'string' || body.wrapper.length === 0
      || typeof body.project !== 'string' || body.project.length === 0) {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    const workdir = typeof body.workdir === 'string' && body.workdir.length > 0 ? body.workdir : undefined;
    // ONE registry listing, two questions: is this a revival, and what is this
    // project's tag. CREATION-ONLY, mirroring `cmd_start`'s own guard placement
    // (spec §5.5.5): the two-argument form is a revival path as well as a
    // creation path, and on a revival THE REGISTRY WINS over the wrapper
    // argument — so refusing here would refuse a revive of a session already
    // running wrong-pool, which ruling 5's auto path is what moves.
    const rootNames = await deps.io.readdir(deps.cfg.registryDir);
    const revival = await knownId(`${body.wrapper}-${body.project}`, rootNames);
    if (!revival) {
      if (body.crossPool === true) {
        // REFUSE ON NO EVIDENCE — `capSupported`, never `verbSupported`. A flag
        // an old ccd mis-binds exits 0 and records nothing, which
        // `runCcdOr502` renders as success.
        if (!capSupported(deps.fleetState, POOLS_CAP)) {
          return reply.code(501).send({ ok: false, error: 'unsupported' });
        }
        return runCcdOr502(reply, body.enable === false
          ? CCD_ARGV.startCross(body.wrapper, body.project, workdir)
          : CCD_ARGV.enableCross(body.wrapper, body.project, workdir));
      }
      const pool = poolFor(await readProjectPools(deps.io, deps.cfg, rootNames), body.project);
      const refused = refusePool(reply, body.wrapper, pool);
      if (refused) return refused;
    }
    // enable = start + systemd enable. The ternary picks the ENTRY rather than
    // interpolating a verb into an array, so both spellings are enumerated by
    // whitelist-subset.test.ts and neither can drift out of the agent's list.
    return runCcdOr502(reply, body.enable === false
      ? CCD_ARGV.start(body.wrapper, body.project, workdir)
      : CCD_ARGV.enable(body.wrapper, body.project, workdir));
  });
```

`POST /api/sessions/:id/swap` (`:1850`):

```ts
  app.post('/api/sessions/:id/swap', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { wrapper?: unknown; crossPool?: unknown };
    if (typeof body.wrapper !== 'string' || body.wrapper.length === 0) {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    if (body.crossPool === true) {
      // The declared crossing skips the verdict entirely — that IS the
      // override. It does not skip the SKEW gate: `capSupported` refuses on no
      // evidence, for the reason spelled out on `CCD_ARGV.swapCross`. An
      // undecidable tag still stops the swap, one box over: `cmd_swap`'s own
      // guard dies on it with or without the flag, and that reaches the caller
      // as a 502 carrying ccd's sentence.
      if (!capSupported(deps.fleetState, POOLS_CAP)) {
        return reply.code(501).send({ ok: false, error: 'unsupported' });
      }
      return runCcdOr502(reply, CCD_ARGV.swapCross(id, body.wrapper));
    }
    // The row, for its `project` — read at REQUEST TIME so the 409 decides on
    // the same freshness `cmd_swap` will. `readSessionRecord` is one id's ~23
    // field reads, not the fleet's; the ladder is `/stop`'s, because an
    // unlistable registry proves nothing about THIS id and 404 would be a lie.
    const read = await readSessionRecord(deps.io, deps.cfg, id);
    if (!read.found) {
      return reply.code(read.reason === 'unlistable' ? 503 : 404)
        .send({ ok: false, error: read.reason === 'unlistable' ? 'registry-unmeasurable' : 'unknown-session' });
    }
    const rootNames = await deps.io.readdir(deps.cfg.registryDir);
    const pool = poolFor(await readProjectPools(deps.io, deps.cfg, rootNames), read.record.project);
    const refused = refusePool(reply, body.wrapper, pool);
    if (refused) return refused;
    return runCcdOr502(reply, CCD_ARGV.swap(id, body.wrapper));
  });
```

Add `capSupported`, `POOLS_CAP` to the existing `./ccdargv.js` import, `poolVerdict` to the `./poolrule.js` import, and `ProjectPoolWire` to the shared type import.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/swap-route-pool.test.ts test/lifecycle.test.ts`
Expected: PASS. `lifecycle.test.ts`'s two existing swap cases stay byte-identical: `seedDefault` seeds a complete identity triple for `claude2-MekWarLive` with `project: 'MekWarLive'`, no `pools/` exists, so `poolFor` answers `untagged` and `poolVerdict` answers ok.

- [ ] **Step 5: Measure the mutations**

1. In `refusePool`, `return null;` unconditionally.
   Expected RED: `409s a mismatch, names both pools, and NEVER calls ccd` — `expected 200 to be 409`.
2. In `refusePool`, answer 409 for both arms (`reply.code(409)…` for undecidable too).
   Expected RED: `503s an undecidable tag with the state, and never calls ccd` — `expected 409 to be 503`.
3. In both routes, swap `capSupported(deps.fleetState, POOLS_CAP)` for `verbSupported(deps.fleetState, CCD_ARGV.swapCross(id, body.wrapper))`.
   Expected RED: `501s crossPool when the box has not advertised pools-v1 — REFUSE on no evidence` — `expected 200 to be 501` for `ccdVerbs: ['swap']`.
4. In the sessions route, delete the `if (!revival)` guard so the check always runs.
   Expected RED: `passes a REVIVAL through unchecked` — `expected 409 to be 200`.
5. In the swap route, replace the `read.reason === 'unlistable' ? 503 : 404` ladder with a flat `404`.
   Expected RED: `404s an id the registry does not list, and 503s a registry it could not list` — `expected 404 to be 503`.

- [ ] **Step 6: Commit**

```bash
git add server/src/server.ts server/test/swap-route-pool.test.ts
git commit -m "feat(pools): the server refuses a crossing with a slug, and a declared one carries its own flag"
```

---

### Task 11 — DONE 2026-09-10 (1/1 mutation red, after the pin was re-aimed — D-2383)
### Task 11: the remote-mode isolation pin — the server never reads its OWN box

**Files:**
- Test: `server/test/project-pools-read.test.ts` (add one describe)

**Interfaces:**
- Consumes: `makeFixture`, `bootAgent`, `connectToAgent` from `server/test/remoteHelpers.ts`; `readProjectPools`, `poolFor` (Task 2).
- Produces: nothing shipped — this is the pin.

**Spec:** §5.1 (the role matrix — the server reads the fleet box's registry THROUGH the agent, and writes nothing there), §5.4.4 (a remote `forbidden` reply maps to `unreadable`, never `absent`, so a whitelist regression shows as every project unreadable and NOT as a fleet of untagged projects), §11 row 17 (server half; the agent half — `checkPath('<home>/.cc-sessions/pools/demo','write') === null` — is wave 2a's).

**Mutation table:**
- Row 17 (server half). Goes RED the moment a `localIO` shortcut is introduced into `readProjectPools` — the planted tag on the SERVER's own box would become visible, which on the live fleet means the console enforcing a policy file no `ccd` anywhere ever reads.

- [ ] **Step 1: Write the failing test**

Append to `server/test/project-pools-read.test.ts`:

```ts
// §11 row 17, server half. Under `CCRC_FLEET=remote` — the live server's
// standing config — every registry read crosses the agent to the FLEET box.
// A `pools/` on the SERVER box is not policy; it is a directory nobody's `ccd`
// reads, and a reader that fell back to local fs would enforce it anyway.
describe('remote mode reads the FLEET box, never the server box', () => {
  let agent: Awaited<ReturnType<typeof bootAgent>> | undefined;
  let fleet: ReturnType<typeof connectToAgent> | undefined;
  let fixture: ReturnType<typeof makeFixture> | undefined;
  let serverHome: string;

  beforeEach(async () => {
    serverHome = mkTmp('ccrc-pools-serverbox-');
    seedRoster(serverHome);
    // The tag the server box must NOT see: a complete, well-formed marker on
    // this process's own disk, at exactly the path `cfg.registryDir` names.
    mkdirSync(path.join(serverHome, '.cc-sessions', POOLS_DIR_NAME), { recursive: true });
    writeFileSync(path.join(serverHome, '.cc-sessions', POOLS_DIR_NAME, 'demo'), 'pool-a');
    fixture = makeFixture();
    agent = await bootAgent(fixture);
    fleet = connectToAgent(agent.port);
    await vi.waitFor(() => expect(fleet!.state.connected).toBe(true), { timeout: 3000 });
  });

  afterEach(async () => {
    await fleet?.close();
    fleet = undefined;
    if (agent) await agent.close();
    agent = undefined;
    if (fixture) {
      rmSync(fixture.home, { recursive: true, force: true });
      rmSync(fixture.projectsRoot, { recursive: true, force: true });
    }
    fixture = undefined;
    rmSync(serverHome, { recursive: true, force: true });
  });

  it('a pools/ planted on the SERVER box is invisible, and reads unreadable — never tagged, never untagged', async () => {
    const cfg = loadConfig({ CCRC_HOME: serverHome, CCRC_FLEET: 'remote' });
    const io = fleet!.io;
    const read = await readProjectPools(io, cfg, await io.readdir(cfg.registryDir));
    // The path is outside the agent's read roots (its home is the FIXTURE's),
    // so the listing is refused -> null -> `listed:false`. UNREADABLE, not
    // untagged: a whitelist regression must refuse to decide, not silently lift
    // every constraint on the fleet.
    expect(read).toEqual({ listed: false });
    expect(poolFor(read, 'demo')).toEqual({ state: 'unreadable' });
    expect(poolFor(read, 'demo')).not.toEqual({ state: 'tagged', name: 'pool-a' });
  });

  it('the FLEET box\'s own pools/ IS what a remote read answers', async () => {
    // The other direction, so the case above cannot pass by the reader being
    // broken outright: a tag on the agent's home reads back correctly.
    const dir = path.join(fixture!.home, '.cc-sessions', POOLS_DIR_NAME);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'quiet-basin'), 'pool-b');
    const cfg = loadConfig({ CCRC_HOME: fixture!.home, CCRC_FLEET: 'remote' });
    const io = fleet!.io;
    const read = await readProjectPools(io, cfg, await io.readdir(cfg.registryDir));
    expect(poolFor(read, 'quiet-basin')).toEqual({ state: 'tagged', name: 'pool-b' });
  });
});
```

Add to the file's imports: `import { vi } from 'vitest';` (extend the existing import), and
`import { bootAgent, connectToAgent, makeFixture } from './remoteHelpers.js';`

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/project-pools-read.test.ts`
Expected: PASS on the first run — the reader is already correct, and this pin exists to keep it so. To prove the pin is not vacuous, run step 3 FIRST and confirm the red.

- [ ] **Step 3: Measure the mutation (before claiming the pin)**

In `readProjectPools`, add a local shortcut: `import { localIO } from './io.js';` and change the two reads to `localIO.readdir(...)` / `localIO.readFileMeasured(...)`.
Expected RED: `a pools/ planted on the SERVER box is invisible, and reads unreadable` — `expected { listed: true, tags: Map(1) { 'demo' => { state: 'tagged', name: 'pool-a' } } } to deeply equal { listed: false }`.
Then REVERT the mutation and re-run: PASS, with the second case (`the FLEET box's own pools/ IS what a remote read answers`) green in both directions.

- [ ] **Step 4: Commit**

```bash
git add server/test/project-pools-read.test.ts
git commit -m "test(pools): the reader crosses the agent, so a tag on the server box is not policy"
```

---

### Task 12 — DONE 2026-09-10 (the gate ran; one load finding, D-2409)
### Task 12: Whole-branch gate

**Files:** none — this task changes nothing and proves everything.

**Interfaces:**
- Consumes: every task above.
- Produces: a measured green branch, ready for the wave's PR.

**Spec:** the brief's whole-branch step; `CLAUDE.md`'s "Build / test / deploy".

**No deploy step:** this wave touches no file under `ccd/`, `session-hook.sh` or `ccd/coordinator-skill/`, so the AGENT-FIRST rule does not bind it. Waves 2a and 2b carry that ordering; this wave ships on the ordinary server lane behind them.

- [ ] **Step 1: Run the three package suites, in the foreground**

```bash
cd server && npm run test
cd agent  && npm run test
cd pwa    && npm run test
```
Expected: PASS. Each suite runs in the FOREGROUND with a timeout of at least 600000 ms — backgrounding hides a hang and these suites are load-sensitive.

Known load flakes, per `CLAUDE.md`: `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`. Re-run any of these IN ISOLATION before calling it a real break, e.g. `cd server && ./node_modules/.bin/vitest run test/ccd-session-state.test.ts`. A single green isolated run of `ccd-session-state` is not proof it was the load (0/6 on an idle box, 2/4 under load) — CI on the quiet box is the arbiter.

- [ ] **Step 2: Typecheck every tree, including the test directories**

```bash
cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
cd pwa    && ./node_modules/.bin/tsc --noEmit
cd agent  && npm run build
```
Expected: PASS / no output. `server/tsconfig.json`'s `include` does not cover `test/`, which is why `typecheck-tests.test.ts` spawns its own tests-inclusive project; `pwa/tsconfig.json` DOES include `test`, and nothing in any vitest suite runs it, so it is invoked by hand here.

- [ ] **Step 3: Deviation numbers — measured against `origin/main`, without merging**

```bash
git fetch origin main
cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts
```
Expected: PASS. This compares THIS branch's `D-N` definitions against `origin/main`'s without merging, and reds on any allocator-era number defined in two plans — the parallel-branch collision, caught before the merge that would otherwise decide it.

- [ ] **Step 4: The tree-wide scanners**

```bash
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts test/topology-clean.test.ts test/dtbd.test.ts
```
Expected: PASS. `topology-clean` scans the whole tree INCLUDING docs — if it reds, a fixture name in this plan or in a new test is too close to a real one; use `pool-a`/`pool-b` and `DEFAULT_TEST_ROSTER`'s ids and nothing else.

- [ ] **Step 5: The suites this wave touched, one more time, together**

```bash
cd server && ./node_modules/.bin/vitest run \
  test/pools.test.ts test/project-pools-read.test.ts test/project-pool-route.test.ts \
  test/swap-route-pool.test.ts test/projects-route-placement.test.ts test/projected-home.test.ts \
  test/registry.test.ts test/fleetstate.test.ts test/fleet-lifecycle.test.ts test/fleet-health.test.ts \
  test/fleetws.test.ts test/lifecycle.test.ts test/verb-gate.test.ts test/auth-gate.test.ts \
  test/whitelist-subset.test.ts test/box-token-census.test.ts test/node-floor.test.ts
```
Expected: PASS. `node-floor.test.ts` is in the list because this wave adds no dependency and must not have moved the engines floor; if its absolute assertion (3) is red while (1–2) are green, RAISE the engines — never lower them to make it green.

- [ ] **Step 6: Report, do not commit**

There is nothing to commit for this task. Report the measured result: which suites ran, which flakes re-ran clean in isolation, and the three route-count literals as MEASURED (`auth-gate.test.ts:195`, `:204`, `auth/gate.ts:8`), so the orchestrator can allocate the wave's deviation numbers against a green tree.

## Deviations found

**Allocated and defined in one act, from the live allocator, on 2026-09-05.**
`~/.local/bin/ccrc-api ledger allocate --json -` with `project: ccrc-pwa`, `count: 26` and `byId`
filled from this pane (`ccrc-pwa-amber-summit`) answered **D-1663**–**D-1688** and moved the floor to
**1689**. The block covers all six account-pools wave plans; each number is defined in exactly ONE of
them, and this section holds the ones that belong to this wave. Where a task carries a `LEDGER:` line, it
states the same finding in that task's words and REFERENCES the number; it does not define it. A
plan-time refinement with no `LEDGER:` line is defined here alone, names the task it shapes, and is
referenced inline where that task was decided. Every deviation
FOUND during execution is allocated in its own call at the moment it is found, never taken from a gap
in this block.

The spec's `P-<n>` labels (§12) were provisional and are cited here only as provenance — a `P-` label
is never a ledger number.

- **D-1679** (Task 9) — `isSafeProjectSegment` refuses a leading `-`/`_` that `_ws_project_valid` accepts,
  so the two project grammars disagree; not on this design's path — the tag route passes `:project` to
  `ccd` unvalidated as `/workspaces` does, and `poolFor` is a Map lookup against names a LISTING returned,
  so no request-supplied name is ever joined into a path — recorded for alignment. (spec §12 P-16)
- **D-1680** (Task 2) — `io.readdir` is still the one read in `server/src/io.ts` with no measured sibling
  (`:96`), so `readProjectPools` resolves the absent/unlistable collapse OUT OF BAND from the registry root
  listing the caller already holds. One residual is disclosed rather than closed: a regular file or an
  EACCES directory at `$REG/pools` answers `{listed:false}`, which makes EVERY project read `unreadable` —
  the correct polarity (nobody decides, nothing crosses) but fleet-wide, and the only `pools/` failure
  that cannot be attributed to a single project.
- **D-1681** (Task 10) — `SessionRecord.project` falls back to the session id when the `.project` field is
  unmeasured (`registry.ts:675`, `project ?? id`), so on a degraded row the swap pre-check consults the tag
  of a project NAMED LIKE THE ID rather than the one `ccd` will consult (which reads an empty `$project`
  and answers `untagged`). Reachable only where a tagged project's name equals a live session id — the
  `acct-a-demo` collision shape one level up — and the polarity is a refusal the operator can override
  with `--cross-pool`, never a wrong placement. Disclosed; closing it needs a measured `project` field.
- **D-1682** (Task 4) — plan-time refinement of spec §5.6/§8: `projectPlacement` lives in
  `server/src/limits.ts` beside `projectHome`, not in `poolrule.ts`, because it COMPOSES `projectHome` and
  a value import of an L3 module into the L1 module is exactly what the purity scan (§11 row 8) exists to
  red. The `ProjectPlacement` TYPE is declared in `shared/api.ts` (the PWA renders it) and re-exported
  from `poolrule.ts`.
- **D-1683** (Task 7) — plan-time addition to spec §5.4.5: the `pools` frame is change-only AND cold-starts
  on connect from `FleetWatcher.currentPools()` (the `coord` idiom), because the PWA store is
  WebSocket-only and a change-only frame would never reach a client connecting into a quiet fleet; a
  `null` current value sends nothing rather than a fabricated empty map. `GET /api/fleet`'s additive
  `pools?` is kept as the spec's first-paint carrier.
- **D-1684** (Task 10) — plan-time refinement of spec §5.6: the swap route reads the row through
  `readSessionRecord` with `/stop`'s 404/503 ladder (`unknown-session` / `registry-unmeasurable`) rather
  than the spec's flat 404 over `readRegistry` — one id's field reads instead of the fleet's, and an
  unlistable registry no longer lies with 404. `crossPool: true` skips the verdict AND the 503, as the
  spec's own else-structure reads; an undecidable tag is then refused by `cmd_swap`'s guard one box over
  and reaches the caller as a 502 carrying `ccd`'s sentence.

### Carry triage — what wave 3 takes from wave 2b, and what it does not

The brief listed five carries plus two W3 items and asked which are taken. Answered once, here,
rather than a decision per task. **Every "not taken" below is a scope answer, not a judgement that
the finding is wrong** — four of the five are `ccd/` behaviour and plan:21 makes this wave
server-only.

| Carry | Taken? | Why |
|---|---|---|
| **I-2** — §5.8.4's deploy-window mechanism | **TAKEN** (coordinator ruling D) | The code half shipped in 2b and states the correction at the assignment itself; the SPEC still asserted the mechanism I-2 falsified, and the mitigation row still listed it. Docs-only, no `ccd/` file. Both corrected, and `git grep I-2` over the spec is no longer empty — it was, which is why nobody had noticed for four days. |
| **W3-2** — the ornamental absence assertions | **TAKEN** | `server/test/ccd-auto-swap-pool.test.ts` is a `server/test/` file, so plan:21 permits it. See the row below for what was actually unfalsifiable. |
| **D-1916** — `cmd_project_pool`'s census walks `CCRC_ACCOUNTS`, placement walks `CCRC_HOME_ABLE` | not taken | A behaviour hunk in `cmd_project_pool`. `ccd/`, and its own red-first test. Wave 5. |
| **D-1917** — `_strand_mark`'s banner names a pool, its census names `_pool_for` | not taken | `ccd/`; and the banner string is asserted VERBATIM, so rewording it is a test change in the same commit. Wave 5. |
| **D-1919** — `_sanitize_anthropic`'s warning never reaches `carry_rc` | not taken | `ccd/`, and it is #61's exposure rather than this program's. Wave 5, or #61's owner. |
| **D-1918** — README has no account-pools section | not taken **here, and it needs an owner** | Docs-only, so plan:21 does not forbid it — but the README is the canonical system overview for the WHOLE product, and a pools section written before the server half exists would document a half-feature. It belongs at the end of the program, not inside a wave. Flagged to the coordinator rather than silently dropped. |
| **W3-1** | n/a | The brief's W3-1 has no referent in any plan or spec (`git grep 'W3-1'` over `docs/` is empty; so is `W3-2`, which is why both are quoted from the brief rather than cited). Reported to the coordinator; not invented here. |
| **D-1957** — the `ccd:NNNN` citation sweep | not taken | Explicitly a `ccd/` sweep, and its own count drifts under it. **A count with no ref is not a measurement**, so: `git show <ref>:ccd/ccd \| grep -c 'ccd:[0-9]'` (lines) and `\| grep -o 'ccd:[0-9]\+' \| wc -l` (occurrences) give **143/154** as recorded, **146/157** at `cf1c8005` (the figure mailed to the coordinator, correct for the ref it was taken at) and **149/160** at `db580771` — C1 added three. Three refs, three answers, one sweep: that is the argument for doing it as one deliberate pass at a named ref, not in pieces. |

**W3-2, measured rather than accepted.** The case is
`server/test/ccd-auto-swap-pool.test.ts`'s overflow-lane case; the assertions are `:564`, `:566`,
`:570` and `:571`. The tick DISPATCHES — it never runs `cmd_swap` — so `:570`
(`h.reg(ID,'crosspool')` is null) and `:571` (`swapLog()` has no `cross-pool`) assert the absence of
two artifacts that only `cmd_swap` writes: **unfalsifiable in this fixture, by construction, whatever
the tick decides.** `:566` (`.not.toContain('--cross-pool')`) IS load-bearing — `_svc_run_detached`
records the whole argv — and it is the one the brief mislabelled; `:562-563`'s `toMatch` is the
SEARCH the brief meant, and a trailing flag would leave it green, which is exactly why `:566` has to
exist beside it. Fix is Option A: a sibling case that runs `cmd_swap` for real against the same
fixture, where both artifacts are writable and their absence therefore means something.

### Found during execution

Allocated in their own calls at the moment they were found, never taken from a gap in the plan-time
block above.

- **D-2008 (2026-09-08)** (Task 2, Task 7) — DISCLOSED, NOT CLOSED: capping the VERDICT does not
  bound the TRANSFER. Task 2 now mirrors `ccd`'s 64-byte read cap so the two readers cut at the same
  byte (coordinator ruling 1), but the cap is applied to `read.content` — i.e. AFTER the whole file
  has been read. On `CCRC_FLEET=remote` that read is the agent's `readWhole` (`agent/src/fileops.ts`,
  `grep -n 'readWhole' agent/src/fileops.ts`), which is uncapped, so the bytes still cross the fleet
  WebSocket in full; on `local` it is `localIO.readFileMeasured`, a bare `readFile(p,'utf8')`, equally
  uncapped. Task 7 then puts that read on the WATCHER TICK — one whole-file read per tagged project
  per tick. This is D-1850's own hazard restated in TypeScript on a faster loop, and D-1850's argument
  names a non-adversarial constructor: `ln -s ~/.cc-sessions/swap.log pools/<p>` is a tag that grows
  on every swap append. A 100 MB tag is then read whole, per tick, per project.
  **Why it is not closed here:** a bounded read is a NEW agent op — a new frame, a new whitelist
  entry, a new failure contract on both sides — and this wave's Global Constraint is that the server
  adds no agent surface. It is stated in the source at the read, not only here.
  **Spec drift this does NOT fix, flagged for wave 5:** §5.4.4's algorithm block, its step 4, and the
  "every reader strips trailing whitespace" sentence all predate the cap and describe a reader that no
  longer exists on either side. Wave 5 corrects the spec; this wave does not edit it.
- **D-2009 (2026-09-08)** (no task — REPORTED, NOT TAKEN; `ccd`, so out of this wave's scope by
  plan:21) — **D-2000 is wider than the tag, and this half needs no project to be tagged.**
  `_project_pool_state`'s first statement is the empty-argument short-circuit
  (`[[ -n "${1-}" ]] || { echo untagged; return 0; }`, `ccd/ccd:1148`), and it precedes that
  function's own anomaly checks: `$REG` not a searchable directory (`:1167`), `$POOLS_DIR` a dangling
  symlink / a regular file / unsearchable (`:1177-1180`). Every one of those answers `unreadable`,
  which is what makes the three `prc -eq 2` refusals fire (`:13703` `cmd_start`, `:14952` `cmd_swap`,
  `:15198` `cmd_prefer` — each `die "pool tag for $project is $pps … nothing was touched"`).
  But all three feed `_project_pool_state` from `project=$(_reg_get "$id" project)`, and `_reg_get`
  folds unreadable to `""` — so **the condition that would trigger the registry-unreadable arm is the
  same condition that empties its argument.** An unsearchable `$REG` makes every `.project` read
  fail, every call takes the `:1148` arm, and `:1167` — the guard written for "a registry you cannot
  enter tells you nothing about a field" — cannot fire at any of its three call sites. It is dead in
  the exact state it was written for.
  **Why this changes D-2000's reachability argument, not its ordering.** D-2000 was deferred on the
  measurement that it is inert while no project is tagged, which is correct for the TAG-level effect:
  with `$POOLS_DIR` absent, a readable `.project` answers `untagged` too, so the placement outcome is
  unchanged. This arm is different — it is a REFUSAL that does not happen, and it is reachable today,
  tags or no tags. **Blast radius measured honestly and it is small:** on an unsearchable `$REG` the
  rest of each verb (`_reg_set`, the journal writes) fails too, so what is lost is a clean
  "nothing was touched" refusal, not a proven bad placement. Not a reason to re-order; a reason the
  ledger should not record "inert" as the whole of it.
  Reported to the coordinator (mail 315) under its own invitation to challenge ruling C. See D-2000.
- **D-2010 (2026-09-08)** (Task 2) — **the mirrored cap was off by one, in my own pre-flight commit,
  at exactly the boundary the ruling exists to align.** Ruling 1 said mirror `ccd`'s 64-byte cap; I
  wrote `read.content.length > 64`. Measured in a shell rather than reasoned about:
  `IFS= read -r -d '' -n 64 v < f` returns **1** for a 63-byte file, **0** for a 64-byte file and
  **0** for a 65-byte file — `read -n N` succeeds when it gets its N characters or meets the
  delimiter, and fails only at EOF before either. So `ccd` calls a 64-byte tag `malformed`, and
  `> 64` passed it to the strip and answered `tagged`. `ccd`'s own comment names the same boundary
  from the other end — "a tag padded with 58+ characters of trailing whitespace" — and `pool-a`
  plus 58 spaces is 64 bytes exactly, i.e. the ruling's own worked example is the input the first
  version got wrong. Fixed to `>= 64`. The reason this survived writing is worth more than the fix:
  a mirror is only as good as the SIDE-BY-SIDE, and I had quoted `ccd`'s expression without running
  it. Row 20a's 63/64 pair is one byte apart on purpose — a case built on a 65-byte input passes
  under both spellings and cannot see this mutant at all.
- **D-2017 (2026-09-08)** (Task 2) — **ruling 1's NUL half is a no-op on the server side, and the
  first version of its test case hid that.** The ruling said "treat an embedded NUL the same", and
  the mirror does: `read.content.includes('\0')` answers `malformed`. But `POOL_NAME_RE` is
  `/^[a-z][a-z0-9-]{0,31}$/` — anchored, no `m` flag, and its character class excludes `\0` — and
  JS `\s` does not include `\0` either, so the strip cannot remove one. No NUL-bearing content can
  reach `tagged` by any path. **Measured: delete `.includes('\0')` and all 14 cases stay green.**
  The case I first wrote asserted `malformed` for `pool-a\0pool-b` and read as if it pinned the arm;
  it was passing on the grammar. That is the ornamental-assertion class again, and the three prior
  instances I OPENED rather than recalled are `ccd-auto-swap-pool.test.ts`'s own D-1921 ("could not
  have failed") and D-1955 ("left all 39 cases GREEN. Measured."), plus W3-2's `:570`/`:571` in that
  same file. Written, again, by the session doing the triage of the previous one — which is the part
  worth recording: knowing the class by name did not stop me writing one.
  **Why the arm stays anyway.** It is not dead weight on the OTHER side of the mirror: `ccd`'s
  `read -r -d '' -n 64` STOPS at the delimiter, so without its NUL handling `pool-a\0junk` yields the
  valid prefix `pool-a` and places on a pool the file does not name — the "partial read leaving a
  valid prefix" hazard `ccd`'s own comment parks. The server holds the whole string and cannot reach
  that state, so the arm here states the parity at the site rather than enforcing anything. Kept,
  labelled at the assertion, with the VOID condition written out: it becomes load-bearing if
  `POOL_NAME_RE` ever admits a NUL, if the cap is ever applied to the STRIPPED value, or if this
  reader ever stops holding the whole string. Same treatment as C1's M19 — document the no-op, never
  write a case that cannot fail.

- **D-2382 (2026-09-10)** (Task 11) — **the snippet's second case could not run: no roster on the
  fixture home.** Task 11's step 1 gives the describe verbatim and its step 2 says *"Expected: PASS on
  the first run"*. Measured, it does not: `makeFixture()` builds `.cc-sessions`, `.cc-limits`,
  `.cc-clips` and `.claude` and no `.ccrc/accounts.json`, while `seedRoster` is called only on
  `serverHome` — so `the FLEET box's own pools/ IS what a remote read answers` threw
  `RosterError: no account roster at <fixture>/.ccrc/accounts.json` at `config.ts:218`. One line
  (`seedRoster(fixture.home)`) fixes it, and it plants no `pools/`, so what the pin measures is
  untouched. Booked rather than silently repaired because **a plan that states its own expected
  result is making a claim, and this one was never run.**
- **D-2383 (2026-09-10)** (Task 11) — **the pin as specified could not see the mutation it names, and
  a live control is what proved it.** Step 3 says to plant a `localIO` shortcut in `readProjectPools`
  and expect `a pools/ planted on the SERVER box is invisible` to go RED. Measured: with the shortcut
  planted it **PASSED**, while three sibling cases went red — so the mutation was applied and
  reachable, and the new case simply was not sensitive to it (a green mutation with a live control,
  which is what makes this a finding rather than an ambiguity). The cause is upstream of the mutation:
  the snippet passed `await io.readdir(cfg.registryDir)` as `rootNames`, the agent refuses that path
  (it is outside its read roots), and `readProjectPools` returns `{listed:false}` at its FIRST guard —
  never reaching either read a `localIO` shortcut corrupts. **The case asserted `{listed:false}` and
  got it from the test's own refused listing, not from the reader crossing the agent.** Re-aimed by
  supplying `[POOLS_DIR_NAME]`, which clears both early guards and puts the reader's own reads under
  the assertion. Re-measured both directions: RED with the shortcut —
  `expected { listed: true, tags: Map{ …(1) } } to deeply equal { listed: false }`, which is the exact
  message step 3 predicted and never got — and GREEN 16/16 with it reverted. The row this pins,
  §11 row 17 server half, is now a mechanism rather than a request.

- **D-2409 (2026-09-10)** (Task 12) — **`boot.test.ts` is load-sensitive and is NOT on `CLAUDE.md`'s
  known-flake list, so the gate's own instruction cannot classify it.** Task 12 step 1 names five
  suites to re-run in isolation before calling a break; `boot.test.ts` is not among them, and it is
  the only suite that failed the whole-branch run. Its failures are timing assertions against a
  3000 ms budget — `expected 5819 to be less than 3000` in the full run, `expected 3129 to be less
  than 3000` in isolation — and **isolation did NOT clear it**, which by the list's own rule would
  make it a real break. It is not. The control settles it: the identical suite on **unmodified
  `origin/main` (`29e634b3`), same box, same minute, fails identically** (1 of 3). The box was at
  **load average 43.66 on 16 cores**, with eight other sessions running `tsc`/`vitest`/`esbuild`; the
  `pwa` suite in the same window went 2191/2192 on one run and 2173/2192 on the next, the second's 19
  failures every one `Test timed out in 5000 ms` across 12 files. **Two lessons, and the second is the
  one worth carrying: (a) `boot.test.ts` belongs on the flake list; (b) "re-run in isolation" is not a
  sufficient test for a load flake when the box stays loaded — the sufficient test is the SAME suite
  on an UNMODIFIED ref at the same moment**, which distinguishes "this branch broke it" from "this box
  cannot meet a timing budget right now" and costs one worktree.

- **D-2421 (2026-09-10)** (wave 4 / run 35 close) — **Opening a PR moves two claimed fingerprint fields
  with no commit anywhere, and clause 9 names only commits.** Worker clause 9 says a done-claim is
  measured once and sent once, and that after `wave-done` you stop pushing because "a new commit under
  your own claim makes it stale". Both parties reasoned in commits all morning; the coordinator even
  warned that a PR DESCRIPTION is not a commit, which was true and irrelevant. Measured: the
  coordinator accepted a fingerprint carrying `prNumber 67 / prPhase merged`, `ccd pr-state --session
  ccrc-pwa-clear-meadow` answered `67 / merged` at that moment, and one `gh pr create` later — no
  commit, the branch tip unmoved at `7ca2b97a` — the same probe answered **`81 / open`**.
  `prNumber`/`prPhase` are re-measured against the branch's NEWEST PR, so opening one falsifies an
  accepted claim from outside the vocabulary clause 9 uses to warn about staleness: against
  `prVerdict` (`server/src/coord/fingerprint.ts`), `claimed 'merged'` against `measured 'open'` hits
  `if (claimed === 'merged' && measured !== 'merged') return 'regressed'`, and re-verification would
  have refused `pr-regressed`. **The remedy is ORDERING, and the worker skill already implies it** —
  work, push, open the PR, THEN mail `wave-done`. This wave inverted it because the C1 rescue lane was
  measured and claimed before wave 3's own PR existed, and the inversion is what exposed the seam.
  Worth one sentence in `ccd/worker-skill/SKILL.md`'s "Reporting a wave-done": *measure the fingerprint
  after the PR exists, never before.* Coordinator ruled no second fingerprint is sent:
  `awaiting-review -> merging -> closing` re-measures at CLOSE time, by which point the honest pair is
  `81 / merged`, which `prVerdict` passes and which cannot go stale again.

- **D-2422 (2026-09-10)** (the #81 merge) — **A comment measured correctly on one parent can be FALSE on
  the merge, and no guard in this tree can see it.** The whole review apparatus — mutation tables,
  census pins, the citation sweep — measures a claim against the tree it was written on. A merge
  produces a tree neither author ever ran. Concrete instance, and it is the sharpest possible one
  because the falsified sentence was itself the CORRECTED half of a #78 sweep: `origin/main`'s
  `server/test/ccd-crosspool.test.ts` asserts that ``git grep -c stranded server/src/registry.ts`` is
  **0 on this tree, so the banner is what carries it until that reader lands**. This merge lands that
  reader — account-pools wave 3 makes `SessionRecord.stranded` a real fail-shut field with 12
  `stranded` lines in `registry.ts`, and `fleet.ts` carries its `reason` onto `FleetSession.stranded`.
  So the newer, swept, more-careful side is the one the merge breaks, and taking "main's side because
  main is newer" would have shipped it. Rewritten to the post-merge truth, including what is STILL
  true: nothing under `pwa/src` reads `FleetSession.stranded` — every `stranded` hit there is
  `strandedAccount`, the transcript axis, a different field. **The rule this yields: in a merge, the
  side to distrust is not the older one, it is whichever side made a claim ABOUT THE OTHER SIDE'S
  ABSENCE.**

- **D-2423 (2026-09-10)** (the #81 merge) — **D-2177's census is wrong by one route, and the correction
  found a second unqueued pane-destroying write.** `server/src/server.ts`, the ask-preemption plan
  (`docs/superpowers/plans/2026-09-09-ask-preemption-lane.md:45`), its spec (`:457`) and
  `server/test/lifecycle.test.ts:293` all call `cmd_swap` "the one live-pane-destroying operation that
  was NOT routed through the per-session `KeyedQueue`". Measured on the merged tree: `POST
  /api/sessions/:id/stop` reaches `cmd_stop`, which ends in `_ws_unsupervise` + `tmux kill-session`,
  through `runCcdOr502` with no queue — that much D-2177's own author had already found. What nobody
  measured is `POST /api/sessions/:id/archive`: `cmd_ws_archive` ends in the **same two-line pair**
  (`grep -n '^cmd_ws_archive()' ccd/ccd`, whose own header calls the pane "its one cost"), and it too
  returns straight through `runCcdOr502`. The queued routes are swap, pr-open, forget and
  workspace/reap; `/restore` is unqueued but `cmd_ws_restore` kills no pane, so the honest census is
  **two** gaps, not one and not three. Both are named at every site now. Neither is closed here — that
  is the ask lane's call, not this merge's.

- **D-2424 (2026-09-10)** (the #81 merge) — **The merge made an existing mutation-table guard able to
  pass vacuously, by adding awaited work in front of the thing it was timing.**
  `server/test/lifecycle.test.ts`'s D-2177 case held the queue slot, slept **20 ms**, and asserted the
  swap had not reached ccd — with its premise stated in the comment: "an unserialized swap has nothing
  async blocking it before its ccd call, so this is ample time for it to have run if it bypassed the
  queue." That was true when written. It is false after this merge: wave 3's swap route awaits
  `readSessionRecord`, a registry `readdir` and `readProjectPools` BEFORE the queued call, so a mutant
  that deleted `queue.run` could still be inside those reads at the 20 ms mark on a loaded box, and the
  case would report green while proving nothing. **A timing assertion is a claim about the code in
  front of it, and a merge can add code in front of it.** Fixed by removing the clock: the test now
  waits until the route has ENQUEUED (observed through a recording `KeyedQueue`), which is the same
  property with nothing to out-race. MEASURED RED under a queue bypass: `Error: the swap route never
  enqueued`; GREEN 50/50 restored.

- **D-2425 (2026-09-10)** (the #81 merge) — **The merge minted an invariant neither parent had, and until
  it was pinned it lived only in a comment.** On `ws/clear-meadow` the swap route's `crossPool` arm
  returned `runCcdOr502(reply, CCD_ARGV.swapCross(...))` outside any queue; on `origin/main` there was
  no `crossPool` arm and the ordinary swap went straight into `sendDeps.queue.run` (D-2177). Composing
  them required a decision no reviewer of either PR ever made: **both arms behind ONE queued call**,
  with every refusal — the 501, the 404/503 ladder, the pool verdict — hoisted in front of it. That is
  a new guard, so by this repo's own doctrine it ships with a test that reds when it is deleted.
  `server/test/swap-route-pool.test.ts` now pins it WITHOUT a timeout, by observing the enqueue.
  MEASURED RED with the `crossPool` arm reverted to a direct `runCcdOr502`: `Error: waitFor timed out:
  the swap route to enqueue`; GREEN 14/14 restored. **A conflict resolution is authorship, not
  arbitration — the decisions it makes have no PR of their own and no reviewer unless the resolver
  gives them one.**

- **D-2426 (2026-09-10)** (the #81 merge) — **Two counts in ONE sentence composed differently, and a
  naive union of both would have been wrong.** `server/test/auth-gate.test.ts` reads "the assertion
  that covers all 69, not the 24 exempt" on this branch and "all 71, not the 27 exempt" on
  `origin/main`. Measured on the merged tree the pair is **72 / 27**: the WHOLE moved because both
  parents added routes, while the EXEMPT half took `origin/main`'s number unchanged, because this
  branch's one new route (`POST /api/projects/:project/pool`) is deliberately NOT exempt and
  `origin/main`'s three ask-lane routes all are. Same for the totals — `ROUTES.length` is **75** (47 +
  28), a number NEITHER parent's literal carries, so that assertion could not be resolved by choosing a
  side at all. `server/src/auth/gate.ts`'s docstring must read **72** or this file's own F7/D-1302
  self-check reds with "gate.ts claims a route count this tree does not derive". **The lesson is not
  the arithmetic, it is that "compose both sides" is itself a claim that needs measuring per quantity,
  not per conflict.**

- **D-2427 (2026-09-10)** (the #81 merge) — **Five unpinned prose censuses inside `auth-gate.test.ts` were
  false on the merge and NOTHING reds on them — inside the very file whose F7/D-1223 scan exists to
  stop exactly this.** That scan covers four "claim lines" by needle; these five sit outside all four
  and outside the three conflicts, so the suite stays green while they lie: `59 scanned + the static
  wildcard` (derived value 75, and 59 was stale for several waves before this merge); the exempt-class
  breakdown `25 = /health + the 13 box-token lanes … + the FIVE exempt-BUT-authenticated GETs`
  (measured: **28 = … 15 box-token lanes … SIX**, the ask lane's two POSTs joining the box-token class
  and its GET joining D-149's); `a toEqual listing 25 keys` (28); `71 scanned − 3 websockets − 24
  exempt-and-scanned = 44` (**75 − 3 − 27 = 45**); and `44 since the caps pair` (45). All five
  corrected against the merged tree. **A census pin protects the sentences it names and advertises
  safety for the ones it does not** — the file that documents this defect class was shipping five
  instances of it.

- **D-2428 (2026-09-10)** (the #81 merge) — **#78's citation sweep left the same false spatial claim
  standing in `ccd/ccd` itself, inside the census block a pin scans, where the pin is structurally
  blind to it.** `ccd/ccd:1846` reads "the same shape `ccd-pool-ok.test.ts` already carries for the
  `_pool_ok` header **one function away**". Measured: `_pool_ok()` is at `ccd/ccd:1549` and `_reg_get()`
  at `1809`, with six function definitions in between (`_id`, `_tmux`, `_session_probe`,
  `_session_verdict`, `_alive`, `_reg_set`). The sweep corrected the copy in
  `server/test/ccd-reg-get-census.test.ts` to "in the same file" and did not correct this one — and
  `ccd-reg-get-census.test.ts`'s cardinal scan cannot catch it, because that scan only sees DIGITS, so
  a false SPATIAL citation in the block it guards can never red. **FIXED IN THIS ROUND after the
  coordinator reversed the initial C1 deferral:** `ccd/ccd` now says "earlier in this file", and the
  two residual adjacency claims found in the same pass say "earlier"/"later" rather than invent a
  distance. The generated marker was restamped and `ownership.test.ts` plus the ccd census/behaviour
  suites passed. This is a source edit, not a deployment; D-2000 still blocks wave 3's deploy, whose
  eventual lane remains agent-first.

- **D-2429 (2026-09-10)** (the #81 merge) — **This branch's `ccd/ccd` was strictly OLDER than a fix that
  is merged AND deployed on the live fleet, so a per-file merge decision could have reverted production
  behaviour.** The probe that settled it, run twice independently: `_pane_auto_continue_armed` 0 on
  this branch vs 5 on `main`, `_transcript_stalled_pair` 0 vs 4, `_resume_env` 0 vs 4 — i.e. all of
  #73, whose post-swap resume landing was measured live on the fleet (53 landings, 0 fallback
  keystrokes) the same day. Of the 42 lines this branch's `ccd/ccd` had that `main` lacked, **39 were
  comments and were exactly the false citations #78 swept**, and the other 3 were the PRE-#73 spawn
  lines without `_resume_env`. So the side with MORE unique content was the side with NOTHING worth
  keeping. **`ccd/ccd` takes `main`'s side wholesale, and the argument is a measurement of what each
  side uniquely contains — never a diff size, a date, or which branch "owns" the file.**

- **D-2430 (2026-09-10)** (the #81 merge) — **A merge resolution is measured against a ref that keeps
  moving, and the completeness pass is what noticed.** The 37-conflict resolution was measured against
  `origin/main` at `cc0d744d`. By the time it was verified, `main` was at `878ee3ce` — two commits
  nobody in the resolution had seen (#80's ask instance guard, #72's MemoryHigh removal), touching
  three of the same source files plus `ccd/ccd`. Nothing in the merge machinery says so: `git merge`
  pins `MERGE_HEAD` at the ref you started from and reports success against it, and the PR's own
  `mergeable` field would have said `CONFLICTING` afterwards with no explanation of why the resolution
  you just verified was not enough. Taken as a SECOND merge commit rather than by re-opening a verified
  resolution, and checked rather than trusted (`ccd/ccd` `cmp`-identical to `main`'s; `registry.ts`
  keeps both `stranded` and #80's `updatedAt` argument; `watch.ts` keeps both the `pools` emitter and
  `sweepAsks`). **A conflict measurement has a shelf life, and it is shorter than a careful
  resolution.**

- **D-2431 (2026-09-10)** (the #81 merge) — **Taking THIS branch's side in
  `ccd-reg-get-census.test.ts` would have redded the suite, because its anchors do not exist in the
  merged `ccd/ccd` at all.** The case slices `ccd/ccd`'s `_reg_get` header on
  `block.indexOf('It has moved four times in five rounds')` and
  `block.indexOf('converted the three verb readers')`. Both measure **-1** against the merged tree
  (`/bin/grep -n -F`, no hit) — #78 replaced that history with "It has moved six times". The first
  fails `expect(history, 'the dated history clause could not be found').toBeGreaterThan(-1)`
  immediately; worse, the second would make `block.indexOf('\n', -1)` resolve to the block's FIRST
  newline, so `outsideHistory` would carry the whole dated list and the cardinal scan would report
  every historical figure as a stale census. **A test that reads another file by literal is a
  cross-file coupling with no type and no compiler** — when the file it reads takes the other side of a
  merge, the test must follow it or the suite goes red for a reason the diff does not show.

- **D-2432 (2026-09-10)** (the #81 merge) — **Main's own hunk left a dangling antecedent two lines
  outside its own conflict, and three of this branch's stale cardinals were corrected in passing.**
  `server/test/ccd-reg-get-census.test.ts`'s docstring ended "that pin is why the `_pool_ok` census
  never went stale through **the same five rounds**" — a phrase pointing at "the five review rounds
  that touched it", which `origin/main`'s rewrite of the paragraph ABOVE deleted. Unconflicted text,
  byte-identical on both parents, and false the moment the merge landed: the merged `ccd/ccd` counts
  SIX moves. Rewritten to stand on its own. Corrected in the same pass, each measured against the
  merged `ccd/ccd`: "Four sites carry `&& ! _pool_untaggable`" (**five** —
  `/bin/grep -cF '&& ! _pool_untaggable' ccd/ccd`); "`_undecidable_cause` interpolates `$POOLS_DIR`
  into ONE of its **five** operator-facing sentences" (**six** arms — home, wrapper, crosspool,
  project, pool, `*` — the cardinal having been true for exactly one commit, between round 4 creating
  the function and round 5 adding the `wrapper` arm); and "the half left open is the one with **135**
  call sites" (133 across 109 non-comment lines, and the durable form names the census that holds it
  rather than restating a number). **A merge is where one branch's stale prose meets the other
  branch's corrected prose, and the conflict markers show you only the sentences that happen to
  collide.**

- **D-2445 (2026-09-10)** (the #81 merge) — **When one parent deletes a use and the other parent adds
  adjacent machinery, a union merge can keep an import whose last caller is gone.** Wave 3 imported
  `readSessionRecord` into `watch.ts` for a second registry read in `emitPools`; main deleted that
  second read while hardening the live-session path. The merge correctly kept main's deletion and
  wave 3's pools imports, but a keep-both resolution could have retained `readSessionRecord` with no
  call site: green under this tree's TypeScript settings, and one `noUnusedLocals` switch away from a
  build failure. Measured on `d7c11dd7`: the token appears exactly once in `watch.ts`, inside the
  historical comment that explains the deletion, while the import names only `measuredIdentity`,
  `readRegistry` and `readRegistryMeasured`. **For a deletion/addition overlap, the merge question is
  not "does each parent's text survive?"; it is "does every retained import still have a caller in the
  composed tree?"** This is a review rule rather than new runtime machinery, so the measured caller
  census is the mechanism and no ornamental source guard was added.
