# Account pools — wave 4: the phone shows the pool, hides the crossing behind a disclosure, and never invents a rule — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach the PWA to render a project's pool, to strand loudly, and to make a cross-pool move an explicit, disclosed act — without ever inventing a pool rule the fleet has not stated.

**Architecture:** Two new pure modules under `pwa/src/lib/` (`accountPool`, the ONE reader of `RosterWire.pool`; `pools.ts`, which composes it with L0's `poolRule` and never re-derives the rule), one new sheet (`PoolSheet`), and additive cells/props on five existing components. Nothing about pools is persisted: the store's `pools` slot starts `null` on every load and the offline snapshot has no field for it, so a cached tag can never render as live policy. Every "unknown" — no frame, an older server, an `unreadable` or `malformed` tag — shows MORE, never less: all rows, no disclosure, one honest note.

**Tech Stack:** React 19 + TypeScript (strict, `noUncheckedIndexedAccess`), zustand, vitest + jsdom + @testing-library/react, plain CSS in `pwa/src/fleet/fleet.css`.

**Spec:** docs/superpowers/specs/2026-09-04-account-pools-design.md

**Base:** origin/main 2b15144e; branch ws/amber-summit

## Global Constraints

- Fixture HOMEs only — no test in this wave touches `$HOME`, `~/.cc-sessions`, `~/.cc-limits`, tmux or any `claude-session@*` unit. The PWA suite is pure jsdom.
- No account name, account label, pool name, host name or IP in any shipped source file. Pool names in tests are `pool-a` / `pool-b`; project names are `demo` / `quiet-basin`; account ids come from `pwa/test/rosterFixture.ts`'s existing `TEST_ROSTER`. `server/test/topology-clean.test.ts` and `server/test/single-definition.test.ts` scan `pwa/src`.
- `FLEET_PROTO` stays 1; the wire is additive-only. The `pools` frame is a NEW frame type, which an already-deployed PWA drops through `asFleetMsg` — that is why no bump is needed and none is made here.
- No overloaded null at a seam: `pool` absent (older server / frame not arrived) is a DIFFERENT fact from `{state:'untagged'}` (measured, nothing tagged) and from `{state:'unreadable'}`/`{state:'malformed'}` (nobody decides). Three renderings, never one.
- Agent-first deploy applies to changes under `ccd/`. **This wave touches no `ccd/` file**, so the ordinary server-lane deploy is the whole story and no deploy step appears in this plan.
- `EXEC_COMMANDS` stays `['tmux','ccd']`; no `gh` grant. Nothing in this wave adds an exec surface — the PWA speaks only to routes wave 3 shipped.
- L0 `shared/*.ts` imports nothing, not even `node:*`. This wave IMPORTS `shared/poolrule` and `shared/api`; it adds nothing to `shared/`.
- Mutation-table discipline: every guard below ships with a test measured RED before the guard exists and GREEN after. Each task's `**Mutation table:**` block names the exact mutation and the expected red.
- Deviation numbers come only from the ledger allocator. This plan defines none at plan time — `## Deviations found` says why, and names the two numbers other waves defined that this one rides on (D-1664, D-1683). A deviation found during execution is allocated in its own call at the moment it is found.
- **Two facts this wave CONSUMES from earlier waves, both of which the compiler reports immediately if they are missing:** wave 1 makes `RosterWire.pool: string | null` required and therefore adds `pool: null` to `pwa/test/rosterFixture.ts`'s `TEST_ROSTER`; wave 3 makes `FleetSession.stranded` required and therefore adds `stranded: null` to every PWA `FleetSession` fixture literal (`pwa/test/swap-sheet.test.tsx:29`, `project-card.test.tsx:15`, `session-line.test.tsx:16`, `groupFleet.test.ts:7`, `stores.test.ts:36`, and any other). Task 1 step 1 runs the typechecker before writing anything, so a missing one surfaces as a named TS error at the very start rather than four tasks in.

## Wave map

| Wave | Plan file |
|---|---|
| 1 | `docs/superpowers/plans/2026-09-05-account-pools-wave1-roster.md` |
| 2a | `docs/superpowers/plans/2026-09-05-account-pools-wave2a-ccd-tag-placement.md` |
| 2b | `docs/superpowers/plans/2026-09-05-account-pools-wave2b-ccd-swap-strand-crossing.md` |
| 3 | `docs/superpowers/plans/2026-09-05-account-pools-wave3-server.md` |
| **4 (this plan)** | `docs/superpowers/plans/2026-09-05-account-pools-wave4-pwa.md` |
| 5 | `docs/superpowers/plans/2026-09-05-account-pools-wave5-docs.md` |

**This wave CONSUMES, by exact name:**

- Wave 1, `shared/api.ts`: `RosterWire.pool: string | null` (required on the wire type); `PoolsEnforcement = 'enforced' | 'unavailable' | 'unknown'`; `ProjectPoolWire = {state:'tagged';name:string} | {state:'untagged'} | {state:'malformed'} | {state:'unreadable'}`; `ProjectPoolsWire = {listed:true;byProject:Record<string,ProjectPoolWire>;enforcement:PoolsEnforcement} | {listed:false;enforcement:PoolsEnforcement}`.
- Wave 1, `shared/poolrule.ts`: `poolRule(accountPool: string | null, projectPool: ProjectPoolWire): PoolVerdict`, where `PoolVerdict = {ok:true;why:'untagged-project'|'untagged-account'|'same-pool'} | {ok:false;reason:'pool-mismatch';accountPool:string;projectPool:string} | {ok:false;reason:'pool-undecidable';state:'unreadable'|'malformed'}`. Undecidable states are decided FIRST, before the account is looked at — Task 1 leans on exactly that ordering.
- Wave 2a, `pwa/src/session/journalWords.ts`: `ACT_WORD.rehome`. **ALREADY ADDED by wave 2a — this wave does NOT re-add it and does not touch that file.**
- Wave 3, `shared/api.ts`: `ProjectRow.pool?: ProjectPoolWire`; `ProjectRow.placement?: ProjectPlacement` (the `ProjectPlacement` type itself lives in `shared/api.ts`); `FleetMsg | { type: 'pools'; pools: ProjectPoolsWire }`; `FleetHealth.projectPools?: PoolsEnforcement`; an additive `pools?: ProjectPoolsWire` key on `GET /api/fleet`'s response literal (there is NO named response interface for that route — wave 3 lands the key on the literal, and this wave adds `pools?` to the PWA's inline `getJson<{ sessions; stale?; downSince? }>` generic in `pwa/src/lib/api.ts`; the `FleetState` name belongs to the server's remote-connection state and to this store, never to that wire); `FleetSession.stranded: {at:number;reason:string} | null`.
- Wave 3, routes: `POST /api/projects/:project/pool` body `{pool: string|null}` → 200 `{ok:true, pool:ProjectPoolWire, warning?:'unknown-pool'}` / 400 `bad-request` / 400 `bad-pool-name` / 501 `unsupported` / 502 `{ok:false,stderr}` (the existing `runCcdOr502` shape — no `error` code; `apiErrorText` prefers ccd's own stderr). `POST /api/sessions/:id/swap {wrapper, crossPool?}` → 409 `{ok:false,error:'pool-mismatch',accountPool,projectPool}` / 503 `{ok:false,error:'pool-unreadable',state}` / 501 `unsupported`. `POST /api/sessions {…, crossPool?}` with the same three refusals.

**This wave PRODUCES, by exact name:**

- `pwa/src/lib/accounts.ts`: `accountPool(roster, wrapper): string | null` — the ONLY reader of `RosterWire.pool`; `joinLabels(labels): string` (the shared punctuation, newly exported so the pooled and unpooled label lists cannot drift apart).
- `pwa/src/lib/pools.ts` (NEW): `PoolSide = 'eligible' | 'crossing' | 'unknown'`; `poolSide(accountPoolName, projectPool): PoolSide`; `splitByPool(roster, wrappers, projectPool): {eligible: string[]; crossing: string[]; unknown: boolean}`; `projectPoolOf(pools, project): ProjectPoolWire | null`; `poolOptions(roster): string[]`; `poolLabelList(roster, projectPool): string`.
- `pwa/src/lib/api.ts`: `setProjectPool(project, pool)`, `swap(id, wrapper, opts?)`, `createSession({…, crossPool?})`; `API_ERROR_TEXT` keys `pool-mismatch`, `pool-unreadable`, `bad-pool-name`.
- `pwa/src/stores/fleet.ts`: `FleetState.pools: ProjectPoolsWire | null`.
- `pwa/src/fleet/groupFleet.ts`: `FleetGroup.stranded: number`.
- `pwa/src/fleet/PoolSheet.tsx` (NEW): `PoolSheet`.
- `pwa/src/fleet/ProjectCard.tsx`: props `pools?: ProjectPoolsWire | null`, `onPool?: (project: string) => void`; exported `POOL_UNAVAILABLE_TEXT`.
- `pwa/src/fleet/SessionLine.tsx`: prop `projectPool?: ProjectPoolWire | null`.
- `pwa/src/fleet/SwapSheet.tsx`: `AccountRow` prop `poolChip?: string | null`.
- CSS classes: `.proj-card-pool`, `.proj-card-stranded`, `.sess-stranded`, `.acct-pool`, `.acct-disclosure`, `.pool-note`, `.pool-list`, `.pool-row`.

---

## Version skew, in this wave's terms (spec §5.11)

Design notes, not tasks — every one of these is a consequence of choices made above, and each names the
task that carries it.

| State | What this bundle does |
|---|---|
| **New PWA, new server, OLD fleet `ccd`** | `FleetHealth.projectPools` is `'unavailable'`. Hand-written tags still DISPLAY — the server can read the directory whatever `ccd` does with it — so the chip renders, DIMMED and inert, with `POOL_UNAVAILABLE_TEXT` in its title (Task 5), and the banner says the tag is not being enforced and names the remedy (Task 10). The tag route would 501, which is why the chip stops being a control rather than offering a tap that can only fail. `SwapSheet` still splits: the server's own 409 pre-check refuses a mismatch by the roster and the tag it reads, so a refusal is still a refusal — never a wrong placement. |
| **New PWA, OLD server** | No `pools` frame ever arrives, `FleetState.pools` stays `null`, `ProjectRow.pool` is absent and `FleetHealth.projectPools` is `undefined`. Every surface is byte-identical to the one that shipped: no chip (Task 5), no disclosure and no note change on `NewSessionSheet` (Task 8), all rows plus one honest note on `SwapSheet` (Task 7), no `data-offpool` and no strand cell (Task 9), no banner (Task 10). The `+`'s copy is unchanged because `poolLabelList(roster, null)` is `homeAbleLabelList(roster)` (Task 1, pinned). |
| **OLD PWA, new server** | Untouched by this wave, and named here because it is what the wire discipline buys: the deployed bundle drops the `pools` frame in its own `asFleetMsg`, keeps sending `{wrapper}` on every swap, and toasts the server's new 409 slug raw — legible, not silent. That is why `FLEET_PROTO` stays 1 and why `swap`/`createSession` strip `crossPool` unless it is literally `true` (Task 2). |
| **A pool a session is running outside of, mid-move** | `data-offpool` on the account cell (Task 9). This is the VISIBLE form of §5.5.4's timing: after a retag, a session whose `.home` was out of pool is re-seeded within one tick, but the session itself waits on `SWAP_COOLDOWN`/`SWAPBLOCK_COOLDOWN` — or on a program hold — before it moves. The marker is what keeps that wait from reading as "stuck". |
| **A pool with nothing in it** | `N stranded` on the card (Tasks 4, 5) and the strand cell on the row (Task 9), plus the `+`'s "nothing is in pool X" copy (Task 5) BEFORE a `ws-add` is even attempted. Ruling 6: stay in pool, make it loud. |

---

### Task 1: `accountPool`, and the one place the rule is composed

**Files:**
- Modify: `pwa/src/lib/accounts.ts:68-84` (extract `joinLabels` out of `homeAbleLabelList`, add `accountPool` beside `accountHue`)
- Create: `pwa/src/lib/pools.ts`
- Test: `pwa/test/accounts-pool.test.ts` (new)

**Interfaces:**
- Consumes: `RosterWire` (with wave 1's `pool: string | null`), `ProjectPoolWire`, `ProjectPoolsWire` from `../../../shared/api`; `poolRule` from `../../../shared/poolrule`; `entryFor` (module-private, `accounts.ts:36`).
- Produces:
  - `accountPool(roster: readonly RosterWire[], wrapper: string): string | null`
  - `joinLabels(labels: readonly string[]): string`
  - `type PoolSide = 'eligible' | 'crossing' | 'unknown'`
  - `poolSide(accountPoolName: string | null, projectPool: ProjectPoolWire | null): PoolSide`
  - `splitByPool(roster: readonly RosterWire[], wrappers: readonly string[], projectPool: ProjectPoolWire | null): { eligible: string[]; crossing: string[]; unknown: boolean }`
  - `projectPoolOf(pools: ProjectPoolsWire | null, project: string): ProjectPoolWire | null`
  - `poolOptions(roster: readonly RosterWire[]): string[]`
  - `poolLabelList(roster: readonly RosterWire[], projectPool: ProjectPoolWire | null): string`

**Spec:** §5.3 (the single `accountPool` reader), §5.2 and §5.10 (`splitByPool` composes `accountPool` + `poolRule`; unknown shows all rows), §5.9 (the project pool is DERIVED by project name, never carried per session).

**Mutation table:** §11 row 7, PWA half — "the same rule in L1 and in the PWA". Goes red when `splitByPool` drifts from `poolRule` (e.g. the crossing branch starts hiding an untagged account, or `unreadable` is folded into `untagged` so a mismatched account is hidden on a tag nobody could read), or when the `unknown` arm stops returning ALL wrappers. The PWA test package cannot import `server/test/fixtures`, so the full `POOL_RULE_CASES` run belongs to waves 1 and 2a; this suite pins the COMPOSITION over six hand-written cases plus a null project pool.

- [ ] **Step 1: Install and measure the starting point**

Run:

```bash
cd pwa && npm ci && ./node_modules/.bin/tsc --noEmit
```

Expected: clean exit 0. If it reports `Property 'pool' is missing` on `pwa/test/rosterFixture.ts` or `Property 'stranded' is missing` on a `FleetSession` literal in `pwa/test/`, an earlier wave landed its shared-type change without carrying the PWA fixtures with it — add the missing `pool: null` / `stranded: null` to the named fixture literal, re-run until clean, and commit that alone as `fix(pwa): the test fixtures answer the roster and registry fields their types now require` before starting Step 2.

- [ ] **Step 2: Write the failing test**

Create `pwa/test/accounts-pool.test.ts`:

```ts
// The PWA's two pool projections: the single reader of `RosterWire.pool`, and
// the split that composes it with L0's `poolRule`. There is no second copy of
// the rule here — every verdict below comes out of `shared/poolrule.ts`, and
// these cases exist to prove the COMPOSITION (which side a wrapper lands on,
// and what an undecidable tag does to the whole list) rather than the rule.
//
// The full `POOL_RULE_CASES` table has two consumers, bash and the L1 module;
// this package cannot import `server/test/fixtures`, so it pins the six shapes
// that reach a phone.
import { describe, it, expect } from 'vitest';
import type { ProjectPoolWire, RosterWire } from '../../shared/api';
import { accountPool, homeAbleLabelList } from '../src/lib/accounts';
import { poolLabelList, poolOptions, poolSide, projectPoolOf, splitByPool } from '../src/lib/pools';
import { TEST_ROSTER } from './rosterFixture';

/** `TEST_ROSTER` with pools hung on it by id — never a second hand-typed
 *  roster, so labels/hues/homeAble stay the fixture every other suite reads. */
const pooled = (byId: Record<string, string>): RosterWire[] =>
  TEST_ROSTER.map((a) => ({ ...a, pool: byId[a.id] ?? null }));

/** The wire an OLDER server sends: no `pool` key at all. Built by picking the
 *  fields off, the same idiom `accounts-screen.test.tsx` uses for its
 *  before-`hidden` payload. */
const olderWire: RosterWire[] =
  TEST_ROSTER.map(({ id, label, hue, homeAble, hidden }) => ({ id, label, hue, homeAble, hidden })) as RosterWire[];

const tagged = (name: string): ProjectPoolWire => ({ state: 'tagged', name });

describe('accountPool — the ONE reader of RosterWire.pool', () => {
  it('answers the string a tagged account carries', () => {
    expect(accountPool(pooled({ claude: 'pool-a' }), 'claude')).toBe('pool-a');
  });

  it('answers null for an account the roster carries with no pool', () => {
    expect(accountPool(pooled({ claude: 'pool-a' }), 'claude2')).toBeNull();
  });

  it('answers null when the key is absent altogether — an older server is untagged, not unknown', () => {
    // Absence-permits. A server built before wave 1 omits the field; reading
    // it as anything but "untagged" would let a build refuse a swap on
    // evidence it never received.
    expect(accountPool(olderWire, 'claude')).toBeNull();
  });

  it('answers null for a wrapper this roster does not have at all', () => {
    // A live session can report a wrapper the roster dropped (`rosterWrapperIds`'s
    // own docstring). Not being able to name its pool is not a mismatch.
    expect(accountPool(pooled({ claude: 'pool-a' }), 'claude-unrostered')).toBeNull();
  });
});

describe('poolSide — the rule, composed and never restated', () => {
  it('serves when the project is untagged', () => {
    expect(poolSide('pool-a', { state: 'untagged' })).toBe('eligible');
  });

  it('serves when the account is untagged', () => {
    expect(poolSide(null, tagged('pool-a'))).toBe('eligible');
  });

  it('serves when the two names agree', () => {
    expect(poolSide('pool-a', tagged('pool-a'))).toBe('eligible');
  });

  it('crosses when the two names differ', () => {
    expect(poolSide('pool-b', tagged('pool-a'))).toBe('crossing');
  });

  it('is unknown on an unreadable or malformed tag, for a TAGGED account too', () => {
    // Undecidable is decided FIRST — nobody decides, not even for an account
    // whose own pool is known. Folding either state into `crossing` would hide
    // a row on a tag nobody could read; folding it into `eligible` would claim
    // a rule the fleet never stated.
    expect(poolSide('pool-b', { state: 'unreadable' })).toBe('unknown');
    expect(poolSide('pool-b', { state: 'malformed' })).toBe('unknown');
  });

  it('is unknown when there is no project pool at all', () => {
    expect(poolSide('pool-b', null)).toBe('unknown');
  });
});

describe('splitByPool', () => {
  const roster = pooled({ claude: 'pool-a', claude2: 'pool-b', 'claude-corp': 'pool-a' });
  const all = ['claude', 'claude2', 'claude-corp', 'claude-dev0'];

  it('puts in-pool and untagged accounts on the eligible side and the rest on the crossing side', () => {
    // `claude-dev0` carries no pool: an untagged ACCOUNT serves a tagged
    // project, so it is eligible, not crossing.
    const split = splitByPool(roster, all, tagged('pool-a'));
    expect(split.eligible).toEqual(['claude', 'claude-corp', 'claude-dev0']);
    expect(split.crossing).toEqual(['claude2']);
    expect(split.unknown).toBe(false);
  });

  it('offers everything, with nothing crossing, when the project is untagged', () => {
    const split = splitByPool(roster, all, { state: 'untagged' });
    expect(split.eligible).toEqual(all);
    expect(split.crossing).toEqual([]);
    expect(split.unknown).toBe(false);
  });

  it('offers EVERYTHING and flags unknown when the project pool is null — hiding on unknown would be inventing a rule', () => {
    const split = splitByPool(roster, all, null);
    expect(split.eligible).toEqual(all);
    expect(split.crossing).toEqual([]);
    expect(split.unknown).toBe(true);
  });

  it('does the same on an unreadable and on a malformed tag', () => {
    for (const p of [{ state: 'unreadable' } as const, { state: 'malformed' } as const]) {
      const split = splitByPool(roster, all, p);
      expect(split.eligible, p.state).toEqual(all);
      expect(split.crossing, p.state).toEqual([]);
      expect(split.unknown, p.state).toBe(true);
    }
  });

  it('preserves the caller order it was handed and returns fresh arrays', () => {
    const wrappers = ['claude2', 'claude'];
    const split = splitByPool(roster, wrappers, tagged('pool-a'));
    expect(split.eligible).toEqual(['claude']);
    expect(split.crossing).toEqual(['claude2']);
    expect(split.eligible).not.toBe(wrappers);
  });
});

describe('projectPoolOf — the frame, read by project name', () => {
  it('is null when no frame has arrived', () => {
    expect(projectPoolOf(null, 'demo')).toBeNull();
  });

  it('reads a listed project out of the map', () => {
    expect(projectPoolOf(
      { listed: true, byProject: { demo: tagged('pool-a') }, enforcement: 'enforced' }, 'demo',
    )).toEqual(tagged('pool-a'));
  });

  it('reads a project the listing does not name as UNTAGGED — the directory was measured', () => {
    expect(projectPoolOf(
      { listed: true, byProject: { demo: tagged('pool-a') }, enforcement: 'enforced' }, 'quiet-basin',
    )).toEqual({ state: 'untagged' });
  });

  it('reads every project as UNREADABLE when the listing itself failed', () => {
    // `listed:false` is "present at the root and unlistable", never "nothing
    // is tagged" — the polarity §6 disclosed. Untagged here would silently
    // lift every constraint on the box.
    expect(projectPoolOf({ listed: false, enforcement: 'enforced' }, 'demo'))
      .toEqual({ state: 'unreadable' });
  });
});

describe('poolOptions — derived, never enumerated', () => {
  it('lists each distinct pool name once, in roster order', () => {
    expect(poolOptions(pooled({ claude: 'pool-a', claude2: 'pool-b', 'claude-corp': 'pool-a' })))
      .toEqual(['pool-a', 'pool-b']);
  });

  it('is empty for a roster with no pools at all', () => {
    expect(poolOptions(olderWire)).toEqual([]);
  });
});

describe('poolLabelList', () => {
  const roster = pooled({ claude: 'pool-a', claude2: 'pool-b', 'claude-corp': 'pool-a' });

  it('names only the HOME-ABLE accounts that can serve this pool, by label', () => {
    // `gpt` is homeAble:false and is never consulted for a placement fact —
    // the reason this list names accounts individually instead of saying
    // "all accounts" (homeAbleLabelList's own docstring).
    expect(poolLabelList(roster, tagged('pool-b'))).toBe('team·alt and team·d');
  });

  it('is byte-identical to homeAbleLabelList when nothing is known — so the untagged copy never moved', () => {
    expect(poolLabelList(roster, null)).toBe(homeAbleLabelList(roster));
    expect(poolLabelList(roster, { state: 'untagged' })).toBe(homeAbleLabelList(roster));
    expect(poolLabelList(roster, { state: 'unreadable' })).toBe(homeAbleLabelList(roster));
  });

  it('is empty when no home-able account is in the pool — the empty-pool strand, before it bites', () => {
    expect(poolLabelList(roster, tagged('pool-c'))).toBe('');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run:

```bash
cd pwa && ./node_modules/.bin/vitest run test/accounts-pool.test.ts
```

Expected: FAIL — `Failed to resolve import "../src/lib/pools"` and `"accountPool" is not exported by "../src/lib/accounts"`.

- [ ] **Step 4: Add `accountPool` and extract `joinLabels`**

In `pwa/src/lib/accounts.ts`, add after `accountHue` (currently ending at `:53`):

```ts
/** This account's POOL NAME, or `null` for an untagged account, an account
 *  this roster does not have, or a server built before pools existed (the key
 *  is simply absent on that wire, and absence-permits means untagged).
 *
 *  THE ONLY READER of `RosterWire.pool` in this app (spec §5.3). Every pool
 *  question the PWA asks — the swap split, the new-session split, the option
 *  list in `PoolSheet`, the off-pool marker on a row — goes through here, so
 *  "what pool is this account in" is answered in exactly one place and an
 *  older server's omission degrades once rather than five times.
 *
 *  `typeof p === 'string'`, never a truthiness test: the empty string is
 *  refused by `parseRoster` on the way in (`POOL_NAME_RE`), so it cannot be a
 *  real pool, and a bad JSON body that produced one must read as untagged
 *  rather than as a pool named "". */
export function accountPool(roster: readonly RosterWire[], wrapper: string): string | null {
  const p = entryFor(roster, wrapper)?.pool;
  return typeof p === 'string' ? p : null;
}
```

Then replace the body of `homeAbleLabelList` (`:81-84`) so the join is shared:

```ts
/** "team·max, team·alt and team·b" — the shared punctuation for every
 *  account-label list this app renders.
 *
 *  Exported, though it names no account fact of its own, because
 *  `poolLabelList` (`lib/pools.ts`, which cannot live here without an import
 *  cycle — it needs `poolSide`, which needs `accountPool`) renders the SAME
 *  sentence over a filtered set. Two copies of "comma, comma and last" is two
 *  places for one sentence's punctuation to drift, on two surfaces the
 *  operator reads side by side. */
export function joinLabels(labels: readonly string[]): string {
  return labels.length <= 1 ? labels.join('') : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}

export function homeAbleLabelList(roster: readonly RosterWire[]): string {
  return joinLabels(roster.filter((a) => a.homeAble).map((a) => a.label));
}
```

(Keep `homeAbleLabelList`'s existing docstring above it verbatim — it carries the "never claim all accounts" argument that `poolLabelList` inherits. Add one sentence to its end: `Its pool-aware sibling is` `poolLabelList` `(lib/pools.ts), which answers the same question for a TAGGED project.`)

- [ ] **Step 5: Create `pwa/src/lib/pools.ts`**

```ts
// The pool projections the phone renders — and the ONE place `poolRule` is
// composed with `accountPool`.
//
// There is no rule here. `shared/poolrule.ts` decides; this module only asks
// it the questions a screen has: which of these accounts may take this
// project, which of these projects may this account take, and what does the
// card say when nobody can decide. The spec's own words for why that split
// matters: "Two implementations of one rule drift; that is what they do."
//
// NOTHING IN THIS MODULE IS PERSISTED. `stores/fleet.ts`'s `pools` slot starts
// null on every load and the offline snapshot has no field for it, so
// `projectPoolOf` can never be asked about a tag that was true an hour ago.
import type { ProjectPoolWire, ProjectPoolsWire, RosterWire } from '../../../shared/api';
import { poolRule } from '../../../shared/poolrule';
import { accountPool, joinLabels } from './accounts';

/** Which side of the pool line one candidate falls on.
 *
 *  THREE values, because a caller handles each differently. `eligible` is
 *  offered plainly; `crossing` is hidden behind a disclosure and, when picked,
 *  travels with an explicit `crossPool` flag; `unknown` is offered plainly
 *  WITH a note saying so — hiding on unknown would be inventing a rule the
 *  fleet never stated, and flagging on unknown would accuse a project whose
 *  tag nobody could read. */
export type PoolSide = 'eligible' | 'crossing' | 'unknown';

/** `poolRule`, asked the screen's question.
 *
 *  `projectPool === null` — no `pools` frame has arrived, or the server
 *  predates the field — is the one condition the rule itself has no vocabulary
 *  for, so it is answered here and nowhere else. Every OTHER undecidable
 *  condition (`unreadable`, `malformed`) is the rule's own `pool-undecidable`,
 *  read off the verdict rather than re-listed. */
export function poolSide(
  accountPoolName: string | null,
  projectPool: ProjectPoolWire | null,
): PoolSide {
  if (projectPool === null) return 'unknown';
  const verdict = poolRule(accountPoolName, projectPool);
  if (verdict.ok) return 'eligible';
  return verdict.reason === 'pool-mismatch' ? 'crossing' : 'unknown';
}

/** Split swap/start targets into the ones this project's pool admits and the
 *  ones a deliberate crossing would be. `unknown` means nobody could decide:
 *  EVERY wrapper comes back eligible, `crossing` is empty, and the caller
 *  renders its note instead of a disclosure. */
export function splitByPool(
  roster: readonly RosterWire[],
  wrappers: readonly string[],
  projectPool: ProjectPoolWire | null,
): { eligible: string[]; crossing: string[]; unknown: boolean } {
  // ONE probe, with a deliberately untagged account, asks the RULE whether
  // anything can be decided against this tag at all — `poolRule` settles the
  // undecidable states before it ever looks at the account, so this never
  // re-lists `unreadable`/`malformed` here and cannot fall out of step with
  // the states wave 1 declares.
  if (poolSide(null, projectPool) === 'unknown') {
    return { eligible: [...wrappers], crossing: [], unknown: true };
  }
  const eligible: string[] = [];
  const crossing: string[] = [];
  for (const w of wrappers) {
    if (poolSide(accountPool(roster, w), projectPool) === 'crossing') crossing.push(w);
    else eligible.push(w);
  }
  return { eligible, crossing, unknown: false };
}

/** This project's pool, off the fleet-level `pools` frame (spec §5.9: DERIVED
 *  by project name, never carried per session and never revived).
 *
 *  `null` is "nobody has told this build anything" — no frame yet, or a server
 *  that does not send one. It is NOT `{state:'untagged'}`, which is a
 *  measurement, and the difference is the whole reason `ProjectCard` renders
 *  nothing for the first and a flagged chip for the second.
 *
 *  `listed:false` maps to `unreadable`, matching the server's own `poolFor`:
 *  the directory is present at the registry root and could not be listed, so
 *  no project's tag is known. Untagged here would silently lift every
 *  constraint on the box, which is the destructive direction. */
export function projectPoolOf(
  pools: ProjectPoolsWire | null,
  project: string,
): ProjectPoolWire | null {
  if (pools === null) return null;
  if (!pools.listed) return { state: 'unreadable' };
  return pools.byProject[project] ?? { state: 'untagged' };
}

/** The distinct pool names this roster actually carries, in roster order.
 *
 *  DERIVED AT RENDER, never a list in source: a pool name typed into a shipped
 *  file would be one operator's fleet baked into everybody's bundle, which
 *  `topology-clean` exists to prevent. Read through `accountPool` rather than
 *  `a.pool`, so this stays inside the single-reader rule. */
export function poolOptions(roster: readonly RosterWire[]): string[] {
  const out: string[] = [];
  for (const a of roster) {
    const p = accountPool(roster, a.id);
    if (p !== null && !out.includes(p)) out.push(p);
  }
  return out;
}

/** "team·alt and team·d" — the HOME-ABLE accounts that may serve this project,
 *  by label, for the "nothing is placeable" copy on `ProjectCard`'s `+`.
 *
 *  `homeAbleLabelList`'s pool-aware sibling, sharing its `joinLabels` so the
 *  two sentences punctuate identically, and inheriting its rule: name the
 *  accounts individually, never "all accounts" — an enabled `gpt` in the same
 *  list would make that claim false on its face.
 *
 *  An UNDECIDABLE or absent project pool admits everything, so this is
 *  byte-identical to `homeAbleLabelList` there: a card must not tell the
 *  operator a pool is empty on the strength of a tag nobody could read. */
export function poolLabelList(
  roster: readonly RosterWire[],
  projectPool: ProjectPoolWire | null,
): string {
  return joinLabels(
    roster
      .filter((a) => a.homeAble && poolSide(accountPool(roster, a.id), projectPool) !== 'crossing')
      .map((a) => a.label),
  );
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run:

```bash
cd pwa && ./node_modules/.bin/vitest run test/accounts-pool.test.ts && ./node_modules/.bin/tsc --noEmit
```

Expected: PASS, 22 tests; `tsc` exits 0.

- [ ] **Step 7: Prove the guard by mutation**

Run each mutation, confirm the named red, then revert it:

1. In `splitByPool`, delete the `poolSide(null, projectPool) === 'unknown'` early return. Expected red: `offers EVERYTHING and flags unknown when the project pool is null` — `TypeError` or `expected false to be true` on `split.unknown`, and `does the same on an unreadable and on a malformed tag` fails with `expected [] to equal [ 'claude', 'claude2', 'claude-corp', 'claude-dev0' ]`.
2. In `poolSide`, change the last line to `return 'crossing';` (folding `pool-undecidable` into a mismatch). Expected red: `is unknown on an unreadable or malformed tag, for a TAGGED account too` — `expected 'crossing' to be 'unknown'`.
3. In `projectPoolOf`, change the `!pools.listed` arm to `return { state: 'untagged' };`. Expected red: `reads every project as UNREADABLE when the listing itself failed` — `expected { state: 'untagged' } to deeply equal { state: 'unreadable' }`.
4. In `accountPool`, change `typeof p === 'string'` to `p ?? null`. Expected red: `tsc --noEmit` fails with `Type 'string | null | undefined' is not assignable to type 'string | null'` — the compiler is the mechanism for this one; keep the runtime test as the reader's explanation.
5. In `poolLabelList`, change `!== 'crossing'` to `=== 'eligible'`. Expected red: `is byte-identical to homeAbleLabelList when nothing is known` — `expected '' to be 'team·max, team·alt, team·b and team·d'`.

- [ ] **Step 8: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add pwa/src/lib/accounts.ts pwa/src/lib/pools.ts pwa/test/accounts-pool.test.ts
git commit -m "feat(pwa): one reader for an account's pool, one place the rule is composed"
```

---

### Task 2: the three calls and the three refusals

**Files:**
- Modify: `pwa/src/lib/api.ts:5` (type import), `:175-192` (`API_ERROR_TEXT`), `:433-440` (`projects`/`createSession`/`swap` and the new `setProjectPool`)
- Test: `pwa/test/api.test.ts` (extend)

**Interfaces:**
- Consumes: `ProjectPoolWire` from `../../../shared/api`; the routes wave 3 shipped.
- Produces:
  - `setProjectPool(project: string, pool: string | null): Promise<{ ok: true; pool: ProjectPoolWire; warning?: 'unknown-pool' }>`
  - `swap(id: string, wrapper: string, opts?: { crossPool?: boolean }): Promise<void>`
  - `createSession(b: { wrapper: string; project: string; workdir?: string; crossPool?: boolean }): Promise<void>`
  - `API_ERROR_TEXT` gains `pool-mismatch`, `pool-unreadable`, `bad-pool-name`.

**Spec:** §5.10 `api.ts` row; §5.4.2 (the tag route's four refusals); §5.6 (the swap/sessions 409/503/501).

**Mutation table:** no §11 row of its own — §11 row 26 pins the SHEET's use of `crossPool`, and this task pins the CLIENT's. Goes red when `swap`/`createSession` start sending a `crossPool` key on an ordinary call (the request stops being byte-identical to the one that shipped), or when the three new codes reach a toast as bare slugs. 501 already renders `UNSUPPORTED_VERB_TEXT` through the existing `unsupported` key (`api.ts:124`, `:176`) — nothing is added for it.

- [ ] **Step 1: Write the failing test**

Append to `pwa/test/api.test.ts`, at the end of the file:

```ts
// Account pools, wave 4. The three writes and the three refusals.
//
// The BYTE-IDENTITY assertions are the point of the first two: an ordinary
// swap and an ordinary start must send exactly the request they sent before
// pools existed, because an older server reading an unexpected key is the
// silent-success class this wire discipline exists to prevent. `archive(id,
// {force:false})` above is the same shape for the same reason.
describe('account pools', () => {
  const okPool = (pool: unknown, extra: Record<string, unknown> = {}): Response =>
    jsonResponse(200, { ok: true, pool, ...extra });

  it('setProjectPool posts the name and reads the MEASURED state back', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okPool({ state: 'tagged', name: 'pool-a' }));
    const api = createApi(fetchImpl as unknown as typeof fetch);

    const r = await api.setProjectPool('demo', 'pool-a');

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/projects/demo/pool');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ pool: 'pool-a' });
    expect(r.pool).toEqual({ state: 'tagged', name: 'pool-a' });
    expect(r.warning).toBeUndefined();
  });

  it('setProjectPool sends an explicit null to CLEAR, and carries the unknown-pool warning', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okPool({ state: 'untagged' }, { warning: 'unknown-pool' }));
    const api = createApi(fetchImpl as unknown as typeof fetch);

    const r = await api.setProjectPool('demo', null);

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ pool: null });
    expect(r.warning).toBe('unknown-pool');
  });

  it('setProjectPool percent-encodes the project segment', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okPool({ state: 'untagged' }));
    const api = createApi(fetchImpl as unknown as typeof fetch);
    await api.setProjectPool('a b', null);
    expect((fetchImpl.mock.calls[0] as [string, RequestInit])[0]).toBe('/api/projects/a%20b/pool');
  });

  it('swap(id, w) posts the byte-identical {wrapper} body it always did', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    const api = createApi(fetchImpl as unknown as typeof fetch);
    await api.swap('s1', 'claude2');
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ wrapper: 'claude2' });
  });

  it('swap(id, w, {crossPool:false}) is still the UNCROSSED call — never a body that says no', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    const api = createApi(fetchImpl as unknown as typeof fetch);
    await api.swap('s1', 'claude2', { crossPool: false });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ wrapper: 'claude2' });
  });

  it('swap(id, w, {crossPool:true}) declares the crossing on the wire', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    const api = createApi(fetchImpl as unknown as typeof fetch);
    await api.swap('s1', 'claude2', { crossPool: true });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ wrapper: 'claude2', crossPool: true });
  });

  it('createSession omits crossPool entirely unless it is true', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    const api = createApi(fetchImpl as unknown as typeof fetch);

    await api.createSession({ wrapper: 'claude', project: 'demo', workdir: '/w/demo' });
    expect(JSON.parse((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body as string))
      .toEqual({ wrapper: 'claude', project: 'demo', workdir: '/w/demo' });

    await api.createSession({ wrapper: 'claude', project: 'demo', workdir: '/w/demo', crossPool: false });
    expect(JSON.parse((fetchImpl.mock.calls[1] as [string, RequestInit])[1].body as string))
      .toEqual({ wrapper: 'claude', project: 'demo', workdir: '/w/demo' });

    await api.createSession({ wrapper: 'claude', project: 'demo', workdir: '/w/demo', crossPool: true });
    expect(JSON.parse((fetchImpl.mock.calls[2] as [string, RequestInit])[1].body as string))
      .toEqual({ wrapper: 'claude', project: 'demo', workdir: '/w/demo', crossPool: true });
  });

  it('turns the three pool refusals into sentences, not slugs', () => {
    // Each names what the box established and what would change it. A bare
    // `pool-mismatch` under a failed toast says nothing about the disclosure
    // that exists precisely to let the operator do it on purpose.
    expect(apiErrorText(asError(409, { ok: false, error: 'pool-mismatch', accountPool: 'pool-b', projectPool: 'pool-a' })))
      .toMatch(/different pool/i);
    expect(apiErrorText(asError(503, { error: 'pool-unreadable', state: 'unreadable' })))
      .toMatch(/could not be read/i);
    expect(apiErrorText(asError(400, { error: 'bad-pool-name' })))
      .toMatch(/lowercase/i);
  });

  it('still prefers ccd\'s own stderr over a pool sentence — a 502 says more than a code could', () => {
    expect(apiErrorText(asError(502, { ok: false, stderr: 'pool-mismatch: nothing was touched' })))
      .toBe('pool-mismatch: nothing was touched');
  });

  it('does not shadow any code the UPLOAD, KICKOFF or SEND translators own', () => {
    // The three new keys join a map two other translators consume the OUTPUT
    // of as a KEY. None of them owns these codes today; this asserts it in the
    // direction that breaks if one ever does.
    for (const code of ['pool-mismatch', 'pool-unreadable', 'bad-pool-name']) {
      expect(uploadErrorText(code), code).toBe(code);
      expect(kickoffErrorText(code), code).toBe(code);
      expect(sendErrorText(code), code).toBe(code);
    }
  });
});
```

The suite's existing `asError` helper is what these reuse; if it is defined below the insertion point, put this `describe` immediately after the block that defines it rather than at the very end of the file.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd pwa && ./node_modules/.bin/vitest run test/api.test.ts
```

Expected: FAIL — `api.setProjectPool is not a function`, and `expected 'pool-mismatch' to match /different pool/i`.

- [ ] **Step 3: Add the type import and the three sentences**

In `pwa/src/lib/api.ts:5`, add `ProjectPoolWire` to the existing type import list (alphabetical, between `PrView` and `ReapResult` is where the list's own ordering puts it — read the line and keep its order).

Then, inside `API_ERROR_TEXT` (`:175`), after the `registry-unmeasurable` entry:

```ts
  // Account pools (spec §5.6). Three codes, three different things the box
  // established — and NOT one sentence between them, because the remedies are
  // not the same: cross on purpose, fix a file on the fleet box, or type a
  // legal name. `unsupported` above already covers the 501 both pool routes
  // can answer with, so no fourth entry is added for it.
  //
  // None of these is a code `uploadErrorText`, `kickoffErrorText` or
  // `sendErrorText` owns — they consume this function's OUTPUT as a KEY, so a
  // sentence here for a code one of them owns would lose its wording. The
  // suite asserts that in both directions.
  'pool-mismatch': 'That account is in a different pool from this project. Open "show other pools" and confirm the crossing, or pick an account the project\'s pool admits.',
  'pool-unreadable': 'The project\'s pool tag could not be read on the fleet host, so nothing here can decide. Fix or clear its file under ~/.cc-sessions/pools/ and try again.',
  'bad-pool-name': 'A pool name starts with a lowercase letter and holds only lowercase letters, digits and hyphens.',
```

- [ ] **Step 4: Add the three calls**

In `pwa/src/lib/api.ts`, replace the `createSession` entry (`:434-435`) and the `swap` entry (`:440`), and add `setProjectPool` beside `workspaceAdd` (`:437-438`) so the two `/api/projects/:project/*` writes sit together:

```ts
    /** `crossPool` is STRIPPED unless it is literally `true`, so an ordinary
     *  start sends the byte-identical body it sent before pools existed —
     *  `archive`'s `{force:true}` rule, for `archive`'s reason: a key an older
     *  server does not know is the silent-success class, and a flag that only
     *  ever means "yes" never needs to travel saying "no". */
    createSession: ({ crossPool, ...rest }: {
      wrapper: string; project: string; workdir?: string; crossPool?: boolean;
    }) => post('/api/sessions', crossPool === true ? { ...rest, crossPool: true } : rest),
    ensure: (id: string) => post(`${sid(id)}/ensure`),
    workspaceAdd: (project: string): Promise<void> =>
      post(`/api/projects/${encodeURIComponent(project)}/workspaces`),
    /** `POST /api/projects/:project/pool` — tag the project into an account
     *  pool, or clear it with an explicit `null`.
     *
     *  `postJson`, not `post`: the route answers the pool it RE-READ off the
     *  fleet box after the write, not the value that was requested, and that
     *  measured state is the only thing `PoolSheet` may render before the next
     *  `pools` frame settles it. The shape is spelled inline over the shared
     *  `ProjectPoolWire`, the same way `projects` above composes `ProjectRow`.
     *
     *  `warning: 'unknown-pool'` is a WARNING and not a refusal (ruling O4):
     *  this server's roster copy can lag the fleet's, so a pool no account
     *  here carries may still be about to gain one. */
    setProjectPool: (project: string, pool: string | null) =>
      postJson<{ ok: true; pool: ProjectPoolWire; warning?: 'unknown-pool' }>(
        `/api/projects/${encodeURIComponent(project)}/pool`, { pool }),
    stop: (id: string) => post(`${sid(id)}/stop`),
    /** `{crossPool:true}` ONLY when it is true — `opts?.crossPool === false`
     *  and an absent `opts` both send the byte-identical `{wrapper}` body the
     *  route has always taken. Not a checkbox anywhere in the UI: it is what a
     *  pick made under `SwapSheet`'s "show other pools" disclosure sends, after
     *  a confirm sentence that names the crossing. */
    swap: (id: string, wrapper: string, opts?: { crossPool?: boolean }) =>
      post(`${sid(id)}/swap`, opts?.crossPool === true ? { wrapper, crossPool: true } : { wrapper }),
```

- [ ] **Step 5: Run the test to verify it passes**

Run:

```bash
cd pwa && ./node_modules/.bin/vitest run test/api.test.ts && ./node_modules/.bin/tsc --noEmit
```

Expected: PASS; `tsc` exits 0.

- [ ] **Step 6: Prove the guard by mutation**

1. In `swap`, change the ternary to `{ wrapper, crossPool: opts?.crossPool === true }`. Expected red: `swap(id, w) posts the byte-identical {wrapper} body it always did` — `expected { wrapper: 'claude2', crossPool: false } to deeply equal { wrapper: 'claude2' }`.
2. In `createSession`, change the body to plain `rest` regardless. Expected red: `createSession omits crossPool entirely unless it is true` — the third assertion fails, `expected {…} to deeply equal { …, crossPool: true }`.
3. Delete the `'pool-mismatch'` entry from `API_ERROR_TEXT`. Expected red: `turns the three pool refusals into sentences, not slugs` — `expected 'pool-mismatch' to match /different pool/i`.

- [ ] **Step 7: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add pwa/src/lib/api.ts pwa/test/api.test.ts
git commit -m "feat(pwa): the tag write, the declared crossing, and three refusals that read as sentences"
```

---

### Task 3: the `pools` slot — sticky, and never persisted

**Files:**
- Modify: `pwa/src/stores/fleet.ts:17-148` (`FleetState`), `:150-181` (`asFleetMsg`), `:216-232` (initial state), `:340-380` (the frame handler)
- Test: `pwa/test/stores.test.ts` (extend the `fleet store` describe)

**Interfaces:**
- Consumes: `ProjectPoolsWire`, and wave 3's `FleetMsg | { type: 'pools'; pools: ProjectPoolsWire }`.
- Produces: `FleetState.pools: ProjectPoolsWire | null` — `null` means no frame has arrived.

**Spec:** §5.10 `stores/fleet.ts` row; §5.4.1 ("not in the PWA offline snapshot"); §5.9 ("Nothing about pools is persisted").

**Mutation table:** no numbered §11 row; §10's "A cached tag renders as live policy → Nothing pooled is persisted; store slot null on load" is the guard. Goes red when the slot is hydrated from `loadFleetSnapshot()`, when `saveFleetSnapshot` grows a pools argument, or when `asFleetMsg` starts accepting a `pools` frame whose payload is not an object.

- [ ] **Step 1: Write the failing test**

Insert into `pwa/test/stores.test.ts`, inside the `describe('fleet store', …)` block, after the `describe('the `coord` frame', …)` block:

```ts
  // Account pools, wave 4. Additive on the same terms as `runs`/`coord` above:
  // an already-deployed PWA drops this frame in `asFleetMsg` and no
  // `FLEET_PROTO` bump is needed. What is NOT the same is persistence — this
  // one is deliberately excluded from the offline snapshot, because a cached
  // tag rendered as live policy would lie about what the fleet is enforcing
  // right now.
  describe('the `pools` frame', () => {
    const wire = { listed: true, byProject: { demo: { state: 'tagged', name: 'pool-a' } }, enforcement: 'enforced' };

    it('starts null and takes a well-formed frame', () => {
      const store = createFleetStore({ makeSocket });
      store.getState().connect();
      lastSocket().open();

      expect(store.getState().pools).toBeNull();
      lastSocket().message(JSON.stringify({ type: 'pools', pools: wire }));
      expect(store.getState().pools).toEqual(wire);
      store.getState().disconnect();
    });

    it('takes the listed:false arm too — an unlistable directory is a value, not a gap', () => {
      const store = createFleetStore({ makeSocket });
      store.getState().connect();
      lastSocket().open();
      lastSocket().message(JSON.stringify({ type: 'pools', pools: { listed: false, enforcement: 'enforced' } }));
      expect(store.getState().pools).toEqual({ listed: false, enforcement: 'enforced' });
      store.getState().disconnect();
    });

    it('drops a pools frame whose payload is missing or not an object — silently, never thrown', () => {
      const store = createFleetStore({ makeSocket });
      store.getState().connect();
      lastSocket().open();

      for (const bad of [{ type: 'pools' }, { type: 'pools', pools: null }, { type: 'pools', pools: 'enforced' }]) {
        expect(() => lastSocket().message(JSON.stringify(bad))).not.toThrow();
        expect(store.getState().pools).toBeNull();
      }
      store.getState().disconnect();
    });

    it('is NOT persisted, and a fresh store starts null even with a snapshot on disk', () => {
      // The offline snapshot is written on every `fleet` frame. Nothing pooled
      // may ride it: `FleetSnapshot` has no field for it, and this asserts
      // that in the two directions that matter — the bytes on disk, and what a
      // cold store reads back.
      const store = createFleetStore({ makeSocket });
      store.getState().connect();
      lastSocket().open();
      lastSocket().message(JSON.stringify({ type: 'pools', pools: wire }));
      lastSocket().message(JSON.stringify({ type: 'fleet', sessions: [fleetSession('s1', 'claude')] }));
      expect(store.getState().pools).toEqual(wire);
      store.getState().disconnect();

      const raw = window.localStorage.getItem('ccrc.fleet-snapshot.v1');
      expect(raw).not.toBeNull();
      expect(raw).not.toContain('pool');
      expect(Object.keys(JSON.parse(raw as string) as object).sort()).toEqual(['roster', 'savedAt', 'sessions']);

      const cold = createFleetStore({ makeSocket });
      expect(cold.getState().sessions.map((s) => s.id)).toEqual(['s1']);  // the snapshot DID hydrate
      expect(cold.getState().pools).toBeNull();                          // …and carried no policy with it
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd pwa && ./node_modules/.bin/vitest run test/stores.test.ts
```

Expected: FAIL — `expected undefined to be null` on `store.getState().pools` (the property does not exist yet).

- [ ] **Step 3: Add the slot, the parser arm and the handler**

In `pwa/src/stores/fleet.ts:4`, add `type ProjectPoolsWire` to the existing `shared/api` import list.

In `FleetState`, after `coordFrameSeen` (`:127`):

```ts
  /** Which pool each project is tagged into, off the fleet-level `pools` frame
   *  (spec §5.4.5). `null` means NO FRAME HAS ARRIVED — an older server, or a
   *  socket that has not spoken yet — and every surface renders NOTHING for
   *  it, never a "no pool" flag: absence is not a measurement.
   *
   *  DELIBERATELY NOT HYDRATED from `loadFleetSnapshot()` and deliberately not
   *  written by `saveFleetSnapshot` (spec §5.4.1: "Not persisted server-side …
   *  A cached tag rendered as live policy would lie"). `sessions` and `roster`
   *  survive a cold start because a stale session row reads as stale and a
   *  stale label is still that account's name; a stale POOL TAG is a claim
   *  about what the fleet is enforcing right now, which nothing on this device
   *  can stand behind. `FleetSnapshot` has no field for it, so the exclusion is
   *  structural rather than a line someone must remember not to add.
   *
   *  Sticky once it has arrived, like `runs`/`coord`: the watcher only re-emits
   *  when the value actually changes (`watch.ts`'s byte-equality guard), so
   *  holding the last value between emits is what makes it correct to read. */
  pools: ProjectPoolsWire | null;
```

In `asFleetMsg`, after the `coord` arm (`:170-172`):

```ts
  // Frame-level only, same depth as `coord` above — per-PROJECT tolerance (a
  // `state` word this build has never heard of) is the renderer's job, via
  // `projectPoolOf`/`ProjectCard`. A payload that is not an object at all is
  // dropped rather than coerced: an unreadable policy frame must leave the
  // last known one standing, never replace it with a shape nothing can read.
  if (t === 'pools' && typeof (m as { pools?: unknown }).pools === 'object' && (m as { pools?: unknown }).pools !== null) {
    return m as FleetMsg;
  }
```

In the returned initial state, after `coordFrameSeen: false,` (`:231`):

```ts
      // NOT `snapshot?.pools` — there is no such field, and there must not be
      // one. See the field's own docstring.
      pools: null,
```

In `onMessage`, after the `coord` branch (`:376-380`):

```ts
            } else if (msg.type === 'pools') {
              // No `poolsFrameSeen` twin: unlike `runs`/`coord`, the payload
              // itself is never an empty array whose emptiness could be
              // mistaken for silence — `null` and a `ProjectPoolsWire` are
              // already distinguishable, and `projectPoolOf` reads exactly
              // that distinction.
              set({ pools: msg.pools });
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
cd pwa && ./node_modules/.bin/vitest run test/stores.test.ts && ./node_modules/.bin/tsc --noEmit
```

Expected: PASS; `tsc` exits 0.

- [ ] **Step 5: Prove the guard by mutation**

1. Change the initial state to `pools: (snapshot as unknown as { pools?: ProjectPoolsWire }).pools ?? null` and have the `fleet` branch call `saveFleetSnapshot` with a third argument that a locally-widened `saveFleetSnapshot` writes. Expected red: `is NOT persisted, and a fresh store starts null even with a snapshot on disk` — `expected '{"savedAt":…,"pools":…}' not to contain 'pool'`. Revert both edits.
2. Delete the `typeof … === 'object'` half of the `asFleetMsg` arm. Expected red: `drops a pools frame whose payload is missing or not an object` — `expected 'enforced' to be null`.
3. Delete the `else if (msg.type === 'pools')` branch. Expected red: `starts null and takes a well-formed frame` — `expected null to deeply equal { listed: true, … }`.

- [ ] **Step 6: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add pwa/src/stores/fleet.ts pwa/test/stores.test.ts
git commit -m "feat(pwa): the pools frame lands in the store and nowhere on disk"
```

---

### Task 4: `groupFleet` counts the stranded

**Files:**
- Modify: `pwa/src/fleet/groupFleet.ts:5-74` (`FleetGroup`), `:106-114` (the push)
- Modify: `pwa/test/project-card.test.tsx:25-27` (the `grp()` builder gains the new required field)
- Test: `pwa/test/groupFleet.test.ts` (extend)

**Interfaces:**
- Consumes: wave 3's `FleetSession.stranded: { at: number; reason: string } | null`.
- Produces: `FleetGroup.stranded: number` — how many LIVE members carry a strand marker.

**Spec:** §5.8.3 ("`N stranded` on `ProjectCard` via a new `groupFleet` count").

**Mutation table:** no numbered §11 row (row 34 pins the marker on the ccd side; this is the count that renders it). Goes red when the count reads a truthiness test instead of a null test, when it counts archived members, or when the field is dropped.

- [ ] **Step 1: Write the failing test**

Append to `pwa/test/groupFleet.test.ts`, inside the top-level `describe('groupFleet', …)`:

```ts
  // Account pools, wave 4, spec §5.8.3. Ruling 6 made the silent strand loud;
  // this is the number the folded card wears so a fold cannot hide it.
  it('counts live members carrying a strand marker', () => {
    const g = groupFleet([
      s({ id: 'a', stranded: { at: 1, reason: 'no account in pool pool-a can take it' } }),
      s({ id: 'b' }),
      s({ id: 'c', stranded: { at: 2, reason: 'every candidate at ceiling' } }),
    ])[0]!;
    expect(g.stranded).toBe(2);
  });

  it('counts an UNREADABLE marker too — the fail-shut row is exactly the one to surface', () => {
    // `server/src/registry.ts` reads `.stranded` fail-shut: a present but
    // unreadable marker arrives as `{at: 0, reason: STRANDED_UNREADABLE}`.
    // `at === 0` is a real row, and a truthiness test on `at` would drop it.
    const g = groupFleet([s({ id: 'a', stranded: { at: 0, reason: 'registry field unreadable' } })])[0]!;
    expect(g.stranded).toBe(1);
  });

  it('is zero when nothing is stranded, and survives a server that predates the field', () => {
    // The live `fleet` frame is CAST, not revived (`stores/fleet.ts`'s
    // `asFleetMsg`), so a row from an older server lacks the key at runtime
    // however the type reads. The count must answer 0, not NaN and not a throw
    // — the same discipline `graphReadCount` carries for its own field.
    const older = { ...s({ id: 'a' }) } as Record<string, unknown>;
    delete older['stranded'];
    const g = groupFleet([older as unknown as FleetSession])[0]!;
    expect(g.stranded).toBe(0);
  });

  it('does not count archived members — an archived session is stopped, so its marker is stale', () => {
    const g = groupFleet([
      s({ id: 'a', bucket: 'archived', stranded: { at: 1, reason: 'nowhere to go' } }),
      s({ id: 'b', stranded: { at: 2, reason: 'nowhere to go' } }),
    ])[0]!;
    expect(g.stranded).toBe(1);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd pwa && ./node_modules/.bin/vitest run test/groupFleet.test.ts
```

Expected: FAIL — `expected undefined to be 2` (`FleetGroup` has no `stranded`).

- [ ] **Step 3: Add the field and the count**

In `pwa/src/fleet/groupFleet.ts`, add to `FleetGroup` after `pin` (`:50`):

```ts
  /** How many LIVE members carry a strand marker — ccd's `$REG/<id>.stranded`,
   *  written when a hard-blocked session's pool (or the whole roster) has
   *  nothing that can take it (spec §5.8). This is the LOUD count: ruling 6
   *  turned a silence that retried every five seconds forever into a marker, a
   *  log line and a banner, and this is the number the card wears so a fold
   *  cannot hide it.
   *
   *  Scoped to `sessions` for the reason `attention`/`busy` are, and for one
   *  more: an archived session is stopped, so a marker it still carries
   *  describes a rescue that no longer has anything to rescue. */
  stranded: number;
```

and in the `groups.push({…})` literal (`:106-114`), after `pin,`:

```ts
      // `(m.stranded ?? null) !== null`, never a truthiness test and never a
      // read of `m.stranded.at`. TWO reasons, both producible: the live `fleet`
      // frame is CAST, not revived (`stores/fleet.ts`'s `asFleetMsg`), so a row
      // from a server predating this field has no key at runtime whatever the
      // type says; and the registry's fail-shut arm answers `{at: 0, reason:
      // STRANDED_UNREADABLE}` for a marker it could see and not read — a REAL
      // strand whose date is unknown, which `at`-truthiness would drop in
      // exactly the direction that hides a stuck session.
      stranded: live.filter((m) => (m.stranded ?? null) !== null).length,
```

In `pwa/test/project-card.test.tsx:25-27`, add `stranded: 0` to the `grp()` builder's literal (the field is required on `FleetGroup`, so every construction must answer it):

```ts
const grp = (over: Partial<FleetGroup> = {}): FleetGroup => ({
  project: 'demo', sessions: [sess()], attention: false, busy: 0, unseen: 0, pin: 'claude',
  stranded: 0, archived: [], ...over,
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
cd pwa && ./node_modules/.bin/vitest run test/groupFleet.test.ts test/project-card.test.tsx && ./node_modules/.bin/tsc --noEmit
```

Expected: PASS on both files; `tsc` exits 0.

- [ ] **Step 5: Prove the guard by mutation**

1. Change the count to `live.filter((m) => m.stranded?.at).length`. Expected red: `counts an UNREADABLE marker too` — `expected 0 to be 1`.
2. Change `live` to `members`. Expected red: `does not count archived members` — `expected 2 to be 1`.
3. Change `(m.stranded ?? null) !== null` to `m.stranded !== null`. Expected red: `is zero when nothing is stranded, and survives a server that predates the field` — `expected 1 to be 0`.

- [ ] **Step 6: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add pwa/src/fleet/groupFleet.ts pwa/test/groupFleet.test.ts pwa/test/project-card.test.tsx
git commit -m "feat(pwa): a project group counts the sessions with nowhere in their pool to go"
```

---

### Task 5: the card says which pool, and how many are stranded

**Files:**
- Modify: `pwa/src/fleet/ProjectCard.tsx:15-25` (imports), `:70-131` (props), `:132-164` (`addLabel`), `:220-286` (the head)
- Modify: `pwa/src/screens/FleetScreen.tsx:60-65` (store read), `:471-483` (the `ProjectCard` call)
- Modify: `pwa/src/fleet/fleet.css:1532-1537` (beside `.proj-card-pin`)
- Test: `pwa/test/project-card.test.tsx` (extend), `pwa/test/fleet-css.test.ts` (extend)

**Interfaces:**
- Consumes: `projectPoolOf`, `poolLabelList` (Task 1); `FleetGroup.stranded` (Task 4); `ProjectPoolsWire`, `ProjectPoolWire`.
- Produces: `ProjectCard` props `pools?: ProjectPoolsWire | null` (default `null`) and `onPool?: (project: string) => void`; exported `POOL_UNAVAILABLE_TEXT = 'fleet ccd predates pools'`.

**Spec:** §5.10 `ProjectCard` row, in full — the name chip, the flagged **no pool** chip for a MEASURED `untagged`, distinct warning chips with distinct aria-labels for `malformed`/`unreadable` each carrying `~/.cc-sessions/pools/<project>`, dimmed under `enforcement: 'unavailable'`, NOTHING when the frame has not arrived; the `N stranded` cell; the tap that opens `PoolSheet`; the `addLabel` copy naming in-pool labels via `poolLabelList`.

**Mutation table:** §11 row 24 — "PWA never flags untagged on absence". Goes red the moment the card defaults `pool ?? {state:'untagged'}`: every project on a pre-upgrade server would wear the worklist flag. Also pinned here: `malformed` and `unreadable` have DISTINCT aria-labels and both carry the full path (a joined class would make one remedy stand for two), and the `unavailable` arm dims rather than offering a tap that can only 501.

- [ ] **Step 1: Write the failing test**

Append to `pwa/test/project-card.test.tsx`:

```ts
// Account pools, wave 4, spec §5.10 and §11 row 24. The card is the only place
// a project's pool is stated, so every one of the four states — plus the fifth
// condition, "nobody said" — has to render differently, and the fifth has to
// render as nothing at all.
describe('the pool chip', () => {
  const listed = (byProject: Record<string, ProjectPoolWire>, enforcement: PoolsEnforcement = 'enforced'):
    ProjectPoolsWire => ({ listed: true, byProject, enforcement });

  it('renders NOTHING when no pools frame has arrived — absence is not a measurement', () => {
    // The mutant this kills: `pool ?? {state:'untagged'}` in the card. On a
    // server that predates the field, that default flags every project on the
    // fleet as untagged worklist.
    render(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} roster={TEST_ROSTER} />);
    expect(screen.queryByText(/pool/i)).not.toBeInTheDocument();
    expect(screen.queryByText('no pool')).not.toBeInTheDocument();
  });

  it('names the pool a tagged project is in', () => {
    render(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} roster={TEST_ROSTER}
                        pools={listed({ demo: { state: 'tagged', name: 'pool-a' } })} />);
    expect(screen.getByLabelText('project pool pool-a')).toHaveTextContent('pool-a');
  });

  it('flags a MEASURED untagged project — ruling 3\'s worklist', () => {
    render(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} roster={TEST_ROSTER}
                        pools={listed({})} />);
    const chip = screen.getByText('no pool');
    expect(chip).toHaveAttribute('data-pool', 'untagged');
  });

  it('tells malformed from unreadable, in two aria-labels that each carry the full path', () => {
    // Two conditions with two remedies — rewrite the file, or fix its
    // permissions. One shared "bad tag" chip would send the operator to the
    // wrong one half the time, and the path is what makes either actionable
    // from a phone.
    const { rerender } = render(
      <ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} roster={TEST_ROSTER}
                   pools={listed({ demo: { state: 'malformed' } })} />);
    const bad = screen.getByText('pool malformed');
    expect(bad.getAttribute('aria-label')).toMatch(/malformed/i);
    expect(bad.getAttribute('aria-label')).toContain('~/.cc-sessions/pools/demo');

    rerender(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} roster={TEST_ROSTER}
                          pools={listed({ demo: { state: 'unreadable' } })} />);
    const unread = screen.getByText('pool unreadable');
    expect(unread.getAttribute('aria-label')).toMatch(/could not be read/i);
    expect(unread.getAttribute('aria-label')).toContain('~/.cc-sessions/pools/demo');
    expect(unread.getAttribute('aria-label')).not.toBe(bad.getAttribute('aria-label'));
  });

  it('reads every project as unreadable when the whole listing failed', () => {
    render(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} roster={TEST_ROSTER}
                        pools={{ listed: false, enforcement: 'enforced' }} />);
    expect(screen.getByText('pool unreadable')).toBeInTheDocument();
  });

  it('opens the sheet on a tap, and is a tappable button only when there is somewhere to go', () => {
    const onPool = vi.fn();
    const { rerender } = render(
      <ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} roster={TEST_ROSTER}
                   pools={listed({ demo: { state: 'tagged', name: 'pool-a' } })} onPool={onPool} />);
    fireEvent.click(screen.getByRole('button', { name: 'project pool pool-a' }));
    expect(onPool).toHaveBeenCalledWith('demo');

    // No handler: the chip still STATES the pool — it just is not a control.
    rerender(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} roster={TEST_ROSTER}
                          pools={listed({ demo: { state: 'tagged', name: 'pool-a' } })} />);
    expect(screen.queryByRole('button', { name: 'project pool pool-a' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('project pool pool-a')).toBeInTheDocument();
  });

  it('dims and stops being a control when the fleet ccd predates pools', () => {
    // `enforcement: 'unavailable'` means hand-written tags DISPLAY while
    // nothing on the fleet enforces them (§5.11). A tap could only ever 501, so
    // the chip states the fact instead of offering the dead control.
    const onPool = vi.fn();
    render(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} roster={TEST_ROSTER}
                        pools={listed({ demo: { state: 'tagged', name: 'pool-a' } }, 'unavailable')}
                        onPool={onPool} />);
    const chip = screen.getByLabelText('project pool pool-a');
    expect(chip).toHaveAttribute('data-dim', 'true');
    expect(chip).toHaveAttribute('title', POOL_UNAVAILABLE_TEXT);
    expect(screen.queryByRole('button', { name: 'project pool pool-a' })).not.toBeInTheDocument();
  });

  it('stays quiet under enforcement "unknown" — a chip that dims when nothing was checked stops being read', () => {
    render(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} roster={TEST_ROSTER}
                        pools={listed({ demo: { state: 'tagged', name: 'pool-a' } }, 'unknown')} />);
    expect(screen.getByLabelText('project pool pool-a')).not.toHaveAttribute('data-dim');
  });
});

describe('the stranded cell', () => {
  it('says how many members have nowhere in their pool to go, folded or not', () => {
    const { rerender } = render(
      <ProjectCard group={grp({ stranded: 2 })} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('2 stranded')).toBeInTheDocument();
    rerender(<ProjectCard group={grp({ stranded: 2 })} collapsed onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('2 stranded')).toBeInTheDocument();
  });

  it('renders nothing at zero', () => {
    render(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.queryByText(/stranded/)).not.toBeInTheDocument();
  });
});

describe('the + names in-pool accounts, never "all accounts"', () => {
  const pooled = (byId: Record<string, string>) =>
    TEST_ROSTER.map((a) => ({ ...a, pool: byId[a.id] ?? null }));

  it('leaves the untagged copy byte-identical', () => {
    // The sentence that shipped, unchanged where nothing is tagged — this is
    // the assertion that says the pool work did not quietly reword a control
    // it was only meant to sharpen.
    render(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} onAddWorkspace={() => {}}
                        projected={null} roster={TEST_ROSTER} />);
    expect(screen.getByLabelText('New workspace on demo — team·max, team·alt, team·b and team·d all disabled'))
      .toBeInTheDocument();
  });

  it('names only the accounts the project\'s pool admits', () => {
    render(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} onAddWorkspace={() => {}}
                        projected={null}
                        roster={pooled({ claude: 'pool-a', claude2: 'pool-b', 'claude-corp': 'pool-a' })}
                        pools={{ listed: true, byProject: { demo: { state: 'tagged', name: 'pool-b' } }, enforcement: 'enforced' }} />);
    const btn = screen.getByRole('button', { name: /New workspace on demo/ });
    expect(btn.getAttribute('aria-label')).toContain('team·alt and team·d');
    expect(btn.getAttribute('aria-label')).not.toContain('team·max');
  });

  it('says the pool is empty rather than listing nobody', () => {
    render(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} onAddWorkspace={() => {}}
                        projected={null}
                        roster={pooled({ claude: 'pool-a', claude2: 'pool-a', 'claude-corp': 'pool-a', 'claude-dev0': 'pool-a' })}
                        pools={{ listed: true, byProject: { demo: { state: 'tagged', name: 'pool-b' } }, enforcement: 'enforced' }} />);
    expect(screen.getByRole('button', { name: 'New workspace on demo — nothing is in pool pool-b' }))
      .toBeInTheDocument();
  });
});
```

Add to that file's imports at the top:

```ts
import type { PoolsEnforcement, ProjectPoolWire, ProjectPoolsWire } from '../../shared/api';
import { POOL_UNAVAILABLE_TEXT, ProjectCard } from '../src/fleet/ProjectCard';
```

(merge `POOL_UNAVAILABLE_TEXT` into the existing `NEST_BRACKET, ProjectCard` import at `:8`, and merge the type import into the existing `FleetSession, RunSummary` one at `:5`).

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd pwa && ./node_modules/.bin/vitest run test/project-card.test.tsx
```

Expected: FAIL — `"POOL_UNAVAILABLE_TEXT" is not exported by "../src/fleet/ProjectCard"`.

- [ ] **Step 3: Add the chip, the cell and the copy**

In `pwa/src/fleet/ProjectCard.tsx`, change the imports at `:17-18` to:

```ts
import type { FleetSession, ProjectedHome, ProjectPoolWire, ProjectPoolsWire, RosterWire, RunSummary } from '../../../shared/api';
import { accountColorVar, accountLabel } from '../lib/accounts';
import { poolLabelList, projectPoolOf } from '../lib/pools';
```

(`homeAbleLabelList` leaves this file — `poolLabelList` answers the same question for a tagged project and is byte-identical for an untagged one. It stays exported from `lib/accounts.ts` for `AccountsScreen`, which asks about the whole box rather than about one project.)

Add above `PendingSpawn` (`:47`):

```ts
/** What the chip says when the fleet host's `ccd` has no pool machinery yet
 *  (`enforcement: 'unavailable'`, spec §5.11). Hand-written tags still DISPLAY
 *  — the server can read the directory whatever `ccd` does with it — but
 *  nothing on the fleet is enforcing them, and the tag route would answer 501,
 *  so the chip states the fact and stops being a control.
 *
 *  Exported so the suite pins the sentence rather than a paraphrase of it. */
export const POOL_UNAVAILABLE_TEXT = 'fleet ccd predates pools';

/** The project's pool, as one chip. FIVE renderings for five conditions, and
 *  the fifth — "no frame has arrived" — is handled by the CALLER not rendering
 *  this at all, because a chip is a claim and absence is not one (§11 row 24).
 *
 *  `malformed` and `unreadable` are two chips, not one: rewrite the file and
 *  fix its permissions are different remedies, and each aria-label carries the
 *  full path so either is actionable from a phone with no shell. */
function PoolChip({ pool, project, dim, onTap }: {
  pool: ProjectPoolWire;
  project: string;
  dim: boolean;
  onTap: ((project: string) => void) | undefined;
}): ReactNode {
  const path = `~/.cc-sessions/pools/${project}`;
  const word =
    pool.state === 'tagged' ? pool.name
    : pool.state === 'untagged' ? 'no pool'
    : pool.state === 'malformed' ? 'pool malformed'
    : 'pool unreadable';
  const label =
    pool.state === 'tagged' ? `project pool ${pool.name}`
    : pool.state === 'untagged' ? 'no project pool — any account may serve this project'
    : pool.state === 'malformed' ? `project pool tag is malformed — rewrite ${path} as one pool name`
    : `project pool tag could not be read — check permissions on ${path}`;
  // A SPAN when there is nowhere to go: no handler, or a fleet whose ccd would
  // answer 501. `.sess-held`'s own door/cell split, for its own reason — a
  // control that cannot act is worse than a plain statement of the fact.
  if (dim || onTap === undefined) {
    return (
      <span
        className="proj-card-pool"
        data-pool={pool.state}
        data-dim={dim || undefined}
        aria-label={label}
        title={dim ? POOL_UNAVAILABLE_TEXT : label}
      >
        {word}
      </span>
    );
  }
  return (
    <button
      type="button"
      className="proj-card-pool"
      data-pool={pool.state}
      aria-label={label}
      title={label}
      onClick={() => onTap(project)}
    >
      {word}
    </button>
  );
}
```

Add to the props destructuring (`:70-83`), after `roster = []`:

```ts
  pools = null,
  onPool,
```

and to the props type (after the `roster?` entry at `:117`):

```ts
  /** The fleet-level pool frame (`stores/fleet.ts`'s `pools`), threaded down
   *  by `FleetScreen` exactly as `roster` and `runs` are. `null` — the DEFAULT
   *  — is "no frame has arrived", and this card then says nothing about pools
   *  at all: no chip, and the `+`'s copy is the one that shipped.
   *
   *  The WHOLE frame rather than a pre-resolved `pool` plus an `enforcement`,
   *  because those two are one measurement: a card handed them separately
   *  could render a name from one tick beside an enforcement word from
   *  another, and `projectPoolOf` is the single reader either way. */
  pools?: ProjectPoolsWire | null;
  /** Open the pool sheet for this project. Absent — a card rendered by a
   *  surface with no sheet, or by a test that is not about the tap — leaves
   *  the chip a plain statement rather than a control. */
  onPool?: (project: string) => void;
```

Replace the `homeAbleNames`/`addLabel` block (`:157-164`) with:

```ts
  // The project's pool, derived from the frame by name (spec §5.9: never
  // carried per session, never revived). `null` = nobody said.
  const pool = projectPoolOf(pools, group.project);
  const poolName = pool !== null && pool.state === 'tagged' ? pool.name : null;
  const poolDim = pools?.enforcement === 'unavailable';

  // Named accounts, never "all accounts" — and now never "all HOME-ABLE
  // accounts" either when a pool has narrowed the set. `poolLabelList` is
  // byte-identical to `homeAbleLabelList` for an untagged, absent or
  // undecidable pool, so the sentence that shipped is unchanged everywhere it
  // was already true; it only gets sharper where the fleet has actually said
  // something. An empty list under a NAMED pool is the empty-pool strand
  // (ruling 6) seen before it bites, and it gets its own sentence rather than
  // a name list gone missing mid-clause.
  const placeableNames = poolLabelList(roster, pool);
  const addLabel = projected
    ? `New workspace on ${group.project} — ${accountLabel(roster, projected.wrapper)}, ${headroom}% free`
    : projected === null
      ? poolName === null
        ? placeableNames === ''
          ? `New workspace on ${group.project} — all disabled`
          : `New workspace on ${group.project} — ${placeableNames} all disabled`
        : placeableNames === ''
          ? `New workspace on ${group.project} — nothing is in pool ${poolName}`
          : `New workspace on ${group.project} — nothing in pool ${poolName} is placeable, ${placeableNames} all disabled`
      : `New workspace on ${group.project}`;
```

In the head, add the stranded cell inside `.proj-card-toggle` immediately after the `.proj-card-pin` span (`:248`):

```ts
          {/* The loud cell (ruling 6). Inside the toggle, so it shows folded
              and unfolded alike: a strand is a session that will not move on
              its own until something changes, and a fold must not hide it any
              more than it may hide a pending dialog. A WORD, not a mark —
              `.proj-card-attn` already owns the mark, and two glyphs differing
              only in hue is the failure that rule exists for. */}
          {group.stranded > 0 && (
            <span className="proj-card-stranded">{group.stranded} stranded</span>
          )}
```

and add the chip as a SIBLING of the toggle, between it and the `+` (i.e. right after the `</button>` at `:266`):

```ts
        {/* Outside `.proj-card-toggle`, never inside it: `<button>`'s content
            model forbids an interactive descendant, and Safari/VoiceOver
            exposes a button's whole subtree as one element — the exact
            unreachable-on-iOS control `SessionLine`'s own note records. */}
        {pool !== null && (
          <PoolChip pool={pool} project={group.project} dim={poolDim} onTap={onPool} />
        )}
```

- [ ] **Step 4: Thread the frame through `FleetScreen`**

In `pwa/src/screens/FleetScreen.tsx`, after `const roster = useStore((s) => s.roster);` (`:65`):

```ts
  const pools = useStore((s) => s.pools);
```

and add to the `<ProjectCard …>` call (`:471-483`), after `roster={roster}`:

```ts
                pools={pools}
```

- [ ] **Step 5: Style the two cells**

In `pwa/src/fleet/fleet.css`, immediately after the `.proj-card-pin[data-mixed]` rule (`:1537`):

```css
/* The project's pool. Mono at the pin's scale, on the pin's ground, because
   the two answer the same kind of question about the same project — one names
   the account its sessions are pinned to, the other the pool that constrains
   which accounts those may be.

   A real control when it can act (`<button>`), a plain span when it cannot;
   both wear this class so the two forms are indistinguishable to the eye. The
   tap floor is `.sess-subagents`' negative-inset ::before overlay rather than
   padding: this chip is narrow and unshrinkable, so the overlay's arithmetic
   is what grows it instead of squeezing it. */
.proj-card-pool {
  position: relative;
  flex: none;
  padding: 0;
  background: none;
  border: 0;
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  white-space: nowrap;
  color: var(--ink-tertiary);
  cursor: pointer;
}
button.proj-card-pool::before {
  content: '';
  position: absolute;
  top: calc((var(--text-2xs) * var(--leading-tight) - var(--sp-6)) / 2);
  bottom: calc((var(--text-2xs) * var(--leading-tight) - var(--sp-6)) / 2);
  left: calc((100% - var(--tap-min)) / 2);
  right: calc((100% - var(--tap-min)) / 2);
}
/* An untagged project is the WORKLIST (ruling 3), not a fault: the attention
   ink says "there is something to do here" without claiming anything is
   broken. Both bad-tag states take the same ink for the same reason — the
   remedy is in the aria-label and the doctor, not in a second hue nobody can
   name in greyscale. */
.proj-card-pool[data-pool='untagged'],
.proj-card-pool[data-pool='malformed'],
.proj-card-pool[data-pool='unreadable'] {
  color: var(--status-attention-text);
}
/* Nothing on the fleet is enforcing these tags yet (§5.11). Half opacity is
   the whole cue plus the title; the chip is a span here, so there is no
   disabled control to explain. */
.proj-card-pool[data-dim] {
  opacity: 0.55;
  cursor: default;
}

/* The strand — ruling 6's loud cell on the card. Same attention ink as
   `.sess-acct-away`, which is an already-audited pair on this ground
   (--status-attention-text over --bg-surface: 10.09:1 dark, 5.92:1 light). */
.proj-card-stranded {
  flex: none;
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  white-space: nowrap;
  color: var(--status-attention-text);
}
```

- [ ] **Step 6: Pin the stylesheet**

Append to `pwa/test/fleet-css.test.ts`, at the end of the file:

```ts
describe('the pool chip and the strand are real cells, and the chip is a real target', () => {
  it('gives the tappable form the 44px overlay, not padding that would squeeze it', () => {
    // The chip is narrow and unshrinkable, so `.sess-held`'s padding formula
    // would be POSITIVE here and shrink the target instead of growing it —
    // `.sess-subagents`' negative-inset overlay is the one that fits.
    const rule = ruleFor('button.proj-card-pool::before');
    expect(rule).toContain('position: absolute');
    expect(norm(rule)).toContain('var(--tap-min)');
  });

  it('paints the worklist and both bad-tag states in the audited attention ink', () => {
    const sel = ".proj-card-pool[data-pool='untagged']";
    expect(declValue(ruleFor(sel), 'color')).toBe('var(--status-attention-text)');
    const group = selectorsOf(css, sel).map(normSel);
    for (const state of ['malformed', 'unreadable']) {
      expect(group).toContain(normSel(`.proj-card-pool[data-pool='${state}']`));
    }
  });

  it('dims, rather than recolours, when the fleet ccd predates pools', () => {
    // A third hue would be a fourth thing to name in greyscale. Opacity plus
    // the title is the whole cue.
    expect(ruleFor('.proj-card-pool[data-dim]')).toContain('opacity');
  });

  it('gives the strand cell the same audited pair `.sess-acct-away` already uses', () => {
    expect(declValue(ruleFor('.proj-card-stranded'), 'color')).toBe('var(--status-attention-text)');
  });
});
```

- [ ] **Step 7: Run the tests to verify they pass**

Run:

```bash
cd pwa && ./node_modules/.bin/vitest run test/project-card.test.tsx test/fleet-css.test.ts test/fleet-screen.test.tsx test/contrast.test.ts && ./node_modules/.bin/tsc --noEmit
```

Expected: PASS on all four; `tsc` exits 0. `contrast.test.ts` runs the real `design/contrast-check.mjs` gate over the edited stylesheet — a new colour pair that is not already audited fails here, which is why both new rules reuse `--status-attention-text` on the surface ground.

- [ ] **Step 8: Prove the guard by mutation**

1. In `ProjectCard`, change the chip's condition to `{(pool ?? { state: 'untagged' } as const) && …}` with the coalesced value passed to `PoolChip`. Expected red: `renders NOTHING when no pools frame has arrived` — `Found a label with the text of: no pool` / `expected element not to be in the document`.
2. In `PoolChip`, make `malformed` and `unreadable` share one label (`project pool tag is unusable — ${path}`). Expected red: `tells malformed from unreadable, in two aria-labels that each carry the full path` — `Unable to find an element with the text: pool malformed`.
3. Drop `${path}` from both bad-tag labels. Expected red: the same test — `expected 'project pool tag is malformed — rewrite it as one pool name' to contain '~/.cc-sessions/pools/demo'`.
4. In `PoolChip`, drop the `dim ||` from the span branch. Expected red: `dims and stops being a control when the fleet ccd predates pools` — `expected null not to be null` on the `queryByRole` assertion.
5. In `ProjectCard`, change `poolLabelList(roster, pool)` back to `homeAbleLabelList(roster)`. Expected red: `names only the accounts the project's pool admits` — `expected '…team·max, team·alt, team·b and team·d…' not to contain 'team·max'`.
6. Move the `{group.stranded > 0 && …}` cell into the `{collapsed && …}` branch beside `.proj-card-busy`. Expected red: `says how many members have nowhere in their pool to go, folded or not` — `Unable to find an element with the text: 2 stranded`.

- [ ] **Step 9: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add pwa/src/fleet/ProjectCard.tsx pwa/src/fleet/fleet.css pwa/src/screens/FleetScreen.tsx pwa/test/project-card.test.tsx pwa/test/fleet-css.test.ts
git commit -m "feat(pwa): the card states the project's pool, and says nothing when nobody has"
```

---

### Task 6: `PoolSheet` — the options come off the roster, never out of source

**Files:**
- Create: `pwa/src/fleet/PoolSheet.tsx`
- Modify: `pwa/src/screens/FleetScreen.tsx:117` (state), `:471-483` (`onPool`), `:531` (mount the sheet)
- Modify: `pwa/src/fleet/fleet.css` (after the `.proj-card-stranded` rule Task 5 added)
- Test: `pwa/test/pool-sheet.test.tsx` (new)

**Interfaces:**
- Consumes: `api.setProjectPool` (Task 2); `poolOptions`, `projectPoolOf` (Task 1); `FleetStore`.
- Produces: `PoolSheet({ project: string | null, open: boolean, onClose: () => void, fleet?: FleetStore })`.

**Spec:** §5.10 `PoolSheet` row — the `SwapSheet` shape; options are the DISTINCT `RosterWire[].pool` values plus "none", derived at render; posts `{pool}`; toasts `warning: 'unknown-pool'`; renders the measured `pool` from the 200 and settles on the next `pools` frame. §13: no free-text field.

**Mutation table:** §11 row 25 — "`PoolSheet` derives options". Goes red the moment a list is enumerated in source: a roster carrying `pool-a`, `pool-b`, `pool-a` must offer exactly `pool-a`, `pool-b`, `none`. Also pinned here: "none" posts an explicit `null` (not an empty string, which the route would refuse as `bad-pool-name`), and the 200's MEASURED pool is what the sheet then shows — never the value that was asked for.

- [ ] **Step 1: Write the failing test**

Create `pwa/test/pool-sheet.test.tsx`:

```tsx
// Tag a project into a pool from a phone (ruling 2). The options are DERIVED
// from the roster the box actually has: a free-text field would be the
// shortest path to a pool with no accounts in it, which is the empty-pool
// strand ruling 6 makes loud (spec §13). Creating a brand-new name stays a
// shell act, or a matter of tagging an account first.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { RosterWire } from '../../shared/api';
import { api } from '../src/lib/api';
import { PoolSheet } from '../src/fleet/PoolSheet';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { TEST_ROSTER } from './rosterFixture';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const fakeSocket = () => ({ close: () => {}, send: () => {} }) as never;

const pooled = (byId: Record<string, string>): RosterWire[] =>
  TEST_ROSTER.map((a) => ({ ...a, pool: byId[a.id] ?? null }));

const storeWith = (roster: RosterWire[]): FleetStore => {
  const store = createFleetStore({ makeSocket: fakeSocket });
  act(() => { store.setState({ conn: 'open', roster }); });
  return store;
};

describe('PoolSheet options', () => {
  it('offers each distinct roster pool ONCE, plus none — never a list from source', () => {
    // `claude` and `claude-corp` are both in pool-a; `claude2` is in pool-b.
    // Three tagged accounts, two options. A hand-written list would not even
    // notice the duplicate, and would name the operator's real pools in a file
    // this repo ships publicly.
    const store = storeWith(pooled({ claude: 'pool-a', claude2: 'pool-b', 'claude-corp': 'pool-a' }));
    render(<PoolSheet project="demo" open onClose={vi.fn()} fleet={store} />);
    expect(screen.getAllByRole('button', { name: /^pool / }).map((b) => b.textContent))
      .toEqual(['pool-a', 'pool-b']);
    expect(screen.getByRole('button', { name: /no pool/i })).toBeInTheDocument();
  });

  it('offers only "none" when no account carries a pool', () => {
    const store = storeWith(pooled({}));
    render(<PoolSheet project="demo" open onClose={vi.fn()} fleet={store} />);
    expect(screen.queryAllByRole('button', { name: /^pool / })).toHaveLength(0);
    expect(screen.getByRole('button', { name: /no pool/i })).toBeInTheDocument();
  });
});

describe('PoolSheet writes', () => {
  it('posts the chosen name and then shows the MEASURED state, not the asked-for one', async () => {
    // The route re-reads the marker through the agent and answers what it
    // found. Echoing the request back would make a write that landed and a
    // write that did not look identical on screen.
    const set = vi.spyOn(api, 'setProjectPool')
      .mockResolvedValue({ ok: true, pool: { state: 'tagged', name: 'pool-a' } });
    const store = storeWith(pooled({ claude: 'pool-a' }));
    render(<PoolSheet project="demo" open onClose={vi.fn()} fleet={store} />);

    fireEvent.click(screen.getByRole('button', { name: 'pool pool-a' }));
    expect(set).toHaveBeenCalledWith('demo', 'pool-a');
    expect(await screen.findByText(/demo is in pool pool-a/i)).toBeInTheDocument();
  });

  it('posts an explicit null for "no pool" — never an empty string the route would refuse', () => {
    const set = vi.spyOn(api, 'setProjectPool')
      .mockResolvedValue({ ok: true, pool: { state: 'untagged' } });
    const store = storeWith(pooled({ claude: 'pool-a' }));
    render(<PoolSheet project="demo" open onClose={vi.fn()} fleet={store} />);

    fireEvent.click(screen.getByRole('button', { name: /no pool/i }));
    expect(set).toHaveBeenCalledWith('demo', null);
  });

  it('toasts the unknown-pool warning — the empty pool, named before it strands', async () => {
    vi.spyOn(api, 'setProjectPool')
      .mockResolvedValue({ ok: true, pool: { state: 'tagged', name: 'pool-b' }, warning: 'unknown-pool' });
    const store = storeWith(pooled({ claude: 'pool-a', claude2: 'pool-b' }));
    render(<PoolSheet project="demo" open onClose={vi.fn()} fleet={store} />);

    fireEvent.click(screen.getByRole('button', { name: 'pool pool-b' }));
    expect(await screen.findByText(/no account on this box is in pool pool-b/i)).toBeInTheDocument();
  });

  it('toasts ccd\'s own sentence on a refusal, and shows no measured state', async () => {
    const { ApiError } = await import('../src/lib/api');
    vi.spyOn(api, 'setProjectPool')
      .mockRejectedValue(new ApiError(502, { ok: false, stderr: 'could not write the pool tag for demo — it is NOT tagged' }));
    const store = storeWith(pooled({ claude: 'pool-a' }));
    render(<PoolSheet project="demo" open onClose={vi.fn()} fleet={store} />);

    fireEvent.click(screen.getByRole('button', { name: 'pool pool-a' }));
    expect(await screen.findByText(/it is NOT tagged/)).toBeInTheDocument();
    expect(screen.queryByText(/demo is in pool pool-a/i)).not.toBeInTheDocument();
  });
});

describe('PoolSheet reads the frame until it has an answer of its own', () => {
  it('states the pool the frame says, before any write', () => {
    const store = storeWith(pooled({ claude: 'pool-a' }));
    act(() => {
      store.setState({ pools: { listed: true, byProject: { demo: { state: 'tagged', name: 'pool-a' } }, enforcement: 'enforced' } });
    });
    render(<PoolSheet project="demo" open onClose={vi.fn()} fleet={store} />);
    expect(screen.getByText(/demo is in pool pool-a/i)).toBeInTheDocument();
  });

  it('says nobody has said, when no frame has arrived', () => {
    const store = storeWith(pooled({ claude: 'pool-a' }));
    render(<PoolSheet project="demo" open onClose={vi.fn()} fleet={store} />);
    expect(screen.getByText(/has not said which pool/i)).toBeInTheDocument();
  });

  it('names the file when the tag is unreadable, so the remedy needs no shell to find', () => {
    const store = storeWith(pooled({ claude: 'pool-a' }));
    act(() => {
      store.setState({ pools: { listed: true, byProject: { demo: { state: 'unreadable' } }, enforcement: 'enforced' } });
    });
    render(<PoolSheet project="demo" open onClose={vi.fn()} fleet={store} />);
    expect(screen.getByText(/~\/\.cc-sessions\/pools\/demo/)).toBeInTheDocument();
  });

  it('forgets its own measured answer when the sheet closes — the frame is the durable one', async () => {
    vi.spyOn(api, 'setProjectPool')
      .mockResolvedValue({ ok: true, pool: { state: 'tagged', name: 'pool-a' } });
    const store = storeWith(pooled({ claude: 'pool-a' }));
    const { rerender } = render(<PoolSheet project="demo" open onClose={vi.fn()} fleet={store} />);
    fireEvent.click(screen.getByRole('button', { name: 'pool pool-a' }));
    expect(await screen.findByText(/demo is in pool pool-a/i)).toBeInTheDocument();

    rerender(<PoolSheet project="demo" open={false} onClose={vi.fn()} fleet={store} />);
    rerender(<PoolSheet project="demo" open onClose={vi.fn()} fleet={store} />);
    expect(screen.getByText(/has not said which pool/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd pwa && ./node_modules/.bin/vitest run test/pool-sheet.test.tsx
```

Expected: FAIL — `Failed to resolve import "../src/fleet/PoolSheet"`.

- [ ] **Step 3: Create the sheet**

`pwa/src/fleet/PoolSheet.tsx`:

```tsx
// Tag a project into an account pool, or clear its tag (ruling 2: from the
// phone, and by shell on the fleet box).
//
// The options are DERIVED from the roster this box has — `poolOptions`, one
// row per distinct name plus "no pool" — and there is deliberately NO
// free-text field (spec §13). A name no account carries is a pool that will
// strand every session it constrains, and the shortest path to one is a text
// input; creating a name is a shell act, or a matter of tagging an account
// into it first. The route still WARNS rather than refusing (ruling O4),
// because this server's roster copy can lag the fleet's.
//
// The sheet renders the pool the fleet-level `pools` frame reports until it
// has made a write of its own; from then until it closes, it renders the
// MEASURED state the route read back off the box. Never the value that was
// asked for — a write that landed and a write that quietly did not would look
// identical if it echoed intent.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { ProjectPoolWire } from '../../../shared/api';
import { Sheet } from '../components/Sheet';
import { toast } from '../components/Toast';
import { api, apiErrorText } from '../lib/api';
import { poolOptions, projectPoolOf } from '../lib/pools';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import './fleet.css';

export interface PoolSheetProps {
  /** `null` while no card has been tapped yet — the sheet renders nothing at
   *  all then. `FleetScreen` keeps the last project set after a close, the way
   *  it keeps `actionsSession`, so vaul still gets to play its exit. */
  project: string | null;
  open: boolean;
  onClose: () => void;
  /** Injectable for tests; defaults to the app-wide fleet store. */
  fleet?: FleetStore;
}

export function PoolSheet({ project, open, onClose, fleet = useFleetStore }: PoolSheetProps): ReactNode {
  const roster = fleet((s) => s.roster);
  const pools = fleet((s) => s.pools);
  /** The state the route READ BACK after this sheet's own write, or null while
   *  the frame is still the only source. Cleared on every open and on every
   *  change of subject: a 200 from one project must never describe another,
   *  and a reopened sheet asks the frame again rather than showing an answer
   *  that may be a tick old. */
  const [measured, setMeasured] = useState<ProjectPoolWire | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setMeasured(null); setSaving(false); }, [open, project]);

  const current = measured ?? projectPoolOf(pools, project ?? '');
  const options = poolOptions(roster);

  const set = (pool: string | null): void => {
    if (project === null || saving) return;
    setSaving(true);
    void api.setProjectPool(project, pool).then(
      (r) => {
        setMeasured(r.pool);
        if (r.warning === 'unknown-pool' && pool !== null) {
          // A WARNING, not a failure: the tag is written and the fleet's own
          // roster is the authority on who is in the pool. What the operator
          // needs to know is what happens next if nobody joins it.
          toast(`Tagged ${project}, but no account on this box is in pool ${pool} — sessions there will strand rather than cross.`, 'error');
        } else {
          toast(pool === null ? `${project} is no longer in a pool.` : `${project} is in pool ${pool}.`);
        }
      },
      (err: unknown) => { toast(`Couldn't set the pool — ${apiErrorText(err)}`, 'error'); },
    ).finally(() => { setSaving(false); });
  };

  if (project === null) return null;

  const path = `~/.cc-sessions/pools/${project}`;
  // Five conditions, five sentences. `null` is "nobody has said" and must not
  // read as "no pool": the first is an absent measurement, the second is a
  // measured absence, and only the second is a worklist item.
  const currentCopy =
    current === null
      ? `This box has not said which pool ${project} is in.`
      : current.state === 'tagged'
        ? `${project} is in pool ${current.name}.`
        : current.state === 'untagged'
          ? `${project} is in no pool — every account may serve it.`
          : current.state === 'malformed'
            ? `The pool tag for ${project} is malformed: ${path} holds something that is not a pool name.`
            : `The pool tag for ${project} could not be read: ${path}.`;

  return (
    <Sheet open={open} onClose={onClose} eyebrow="project pool" title="Which pool runs this project?">
      <p className="sheet-copy">
        {currentCopy}{' '}
        An account may serve a project when either side is untagged or the names agree.
      </p>
      <div className="pool-list">
        {options.map((name) => (
          <button
            key={name}
            type="button"
            className="pool-row"
            disabled={saving}
            aria-label={`pool ${name}`}
            onClick={() => set(name)}
          >
            {name}
          </button>
        ))}
        <button
          type="button"
          className="pool-row"
          data-none="true"
          disabled={saving}
          aria-label="no pool — every account may serve it"
          onClick={() => set(null)}
        >
          no pool
        </button>
      </div>
    </Sheet>
  );
}
```

- [ ] **Step 4: Open it from the card**

In `pwa/src/screens/FleetScreen.tsx`, add the import beside the other fleet sheets (`:10`):

```ts
import { PoolSheet } from '../fleet/PoolSheet';
```

state, beside `newOpen` (`:117`):

```ts
  // Kept after a close, the way `actionsSession` is, so vaul plays its exit
  // against a sheet that still knows its subject.
  const [poolProject, setPoolProject] = useState<string | null>(null);
  const [poolOpen, setPoolOpen] = useState(false);
```

the `ProjectCard` prop, beside `pools={pools}`:

```ts
                onPool={(p) => { setPoolProject(p); setPoolOpen(true); }}
```

and the mount, beside `<NewSessionSheet …>` (`:531`):

```tsx
      <PoolSheet
        project={poolProject}
        open={poolOpen}
        onClose={() => setPoolOpen(false)}
        fleet={store}
      />
```

- [ ] **Step 5: Style the rows**

In `pwa/src/fleet/fleet.css`, after the `.proj-card-stranded` rule:

```css
/* The pool picker's rows. `.acct-row`'s frame without its gauges: a pool has
   no limits to show and no "suggested" to earn — the fleet's own roster is
   the only thing that decides which names exist at all. */
.pool-list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}
.pool-row {
  display: flex;
  align-items: center;
  min-height: var(--tap-min);
  padding: 0 var(--sp-2);
  background: var(--bg-raised);
  border: 1px solid var(--edge-subtle);
  border-radius: var(--r-md);
  font-family: var(--font-mono);
  color: var(--ink-primary);
  text-align: left;
  cursor: pointer;
}
/* Clearing the tag is not one of the names — it is the absence of one, and it
   reads in the quieter ink the rest of this app gives to "nothing here". */
.pool-row[data-none] { color: var(--ink-secondary); }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run:

```bash
cd pwa && ./node_modules/.bin/vitest run test/pool-sheet.test.tsx test/fleet-screen.test.tsx test/contrast.test.ts && ./node_modules/.bin/tsc --noEmit
```

Expected: PASS on all three; `tsc` exits 0.

- [ ] **Step 7: Prove the guard by mutation**

1. In `PoolSheet`, replace `poolOptions(roster)` with a literal `['pool-a', 'pool-b']`. Expected red: `offers only "none" when no account carries a pool` — `expected length of [ …, … ] to be 0`. (And `server/test/topology-clean.test.ts` would red on the literal itself — run it to see the second mechanism fire.)
2. Change the "no pool" row's handler to `set('')`. Expected red: `posts an explicit null for "no pool"` — `expected "spy" to be called with [ 'demo', null ]`.
3. In `set`, replace `setMeasured(r.pool)` with `setMeasured(pool === null ? { state: 'untagged' } : { state: 'tagged', name: pool })`. Expected red: none from this suite as written — so ALSO change the first write test's mock to answer `{state:'untagged'}` and confirm it then reds with `Unable to find an element with the text: /demo is in no pool/`. Restore both. (This records that the echo-vs-measure distinction is only observable when the two differ, which is exactly the deploy-race the route re-reads for.)
4. Delete the `useEffect` reset. Expected red: `forgets its own measured answer when the sheet closes` — `Unable to find an element with the text: /has not said which pool/`.
5. Drop the `r.warning === 'unknown-pool'` branch. Expected red: `toasts the unknown-pool warning` — `Unable to find an element with the text: /no account on this box is in pool pool-b/`.

- [ ] **Step 8: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add pwa/src/fleet/PoolSheet.tsx pwa/src/fleet/fleet.css pwa/src/screens/FleetScreen.tsx pwa/test/pool-sheet.test.tsx
git commit -m "feat(pwa): tag a project from the card, with the pool names the roster already has"
```

---

### Task 7: `SwapSheet` hides the crossing behind a disclosure, and declares it on the wire

**Files:**
- Modify: `pwa/src/fleet/SwapSheet.tsx:8-19` (imports), `:116-165` (`AccountRow` gains a pool chip), `:220-332` (the split, the disclosure, the crossing confirm)
- Modify: `pwa/src/fleet/fleet.css` (after the `.pool-row[data-none]` rule Task 6 added)
- Test: `pwa/test/swap-sheet.test.tsx` (extend), `pwa/test/fleet-css.test.ts` (extend)

**Interfaces:**
- Consumes: `splitByPool`, `projectPoolOf` (Task 1); `accountPool` (Task 1); `api.swap(id, w, opts?)` (Task 2); `FleetState.pools` (Task 3).
- Produces: `AccountRow` prop `poolChip?: string | null` (default `undefined` — no chip, so every existing call site renders byte-identically).

**Spec:** §5.10 `SwapSheet` row, verbatim: eligible rows shown; a **show other pools (N)** disclosure reveals the crossing rows, each with a `pool · <name>` chip; picking one sets `cross`; the confirm sentence names the crossing; `api.swap(id, w, {crossPool: true})` only then — an eligible pick posts the byte-identical `{wrapper}` body. Unknown project pool → **all** rows, no disclosure, a one-line "pool not known from here" note.

**Mutation table:** §11 row 26 — all five assertions. Goes red when the split is removed (a mismatched account is offered plainly), when an ELIGIBLE pick starts sending `crossPool: true` (a crossing recorded that nobody asked for, and a `.crosspool` marker written on the box for it), or when a null project pool is treated as a pool (every row hidden on a fleet that never said anything).

- [ ] **Step 1: Write the failing test**

Append to `pwa/test/swap-sheet.test.tsx`:

```tsx
// Account pools, wave 4, spec §5.10 and §11 row 26. Ruling 4: mismatched
// accounts are hidden by DEFAULT and reachable ON PURPOSE, and a crossing that
// happens on purpose is declared on the wire so the fleet can record it.
describe('SwapSheet and the pool line', () => {
  const pooled = (byId: Record<string, string>) =>
    TEST_ROSTER.map((a) => ({ ...a, pool: byId[a.id] ?? null }));

  const poolStore = (
    sessions: FleetSession[], byId: Record<string, string>, pools: ProjectPoolsWire | null,
  ): FleetStore => {
    const store = createFleetStore({ makeSocket: fakeSocket });
    act(() => { store.setState({ conn: 'open', sessions, roster: pooled(byId), pools }); });
    return store;
  };

  // Typed, so a wrong `state` word is a compile error here rather than a
  // silent `unreadable` that would make half these assertions pass for the
  // wrong reason.
  const tagged = (project: string, name: string): ProjectPoolsWire =>
    ({ listed: true, byProject: { [project]: { state: 'tagged', name } }, enforcement: 'enforced' });

  // `claude` and `claude-corp` are pool-a; `claude2` is pool-b; `claude-dev0`
  // and `gpt` carry no pool. The session runs on `claude`, so the sheet's own
  // filter drops it and the targets are the other four; the project is pool-a,
  // so `claude2` (team·alt) is the one crossing.
  const POOLS = { claude: 'pool-a', claude2: 'pool-b', 'claude-corp': 'pool-a' };

  it('offers only the accounts the project pool admits, and counts the rest behind a disclosure', () => {
    const s = fleetSession({ wrapper: 'claude', home: 'claude', project: 'demo' });
    render(<SwapSheet session={s} open onClose={vi.fn()} fleet={poolStore([s], POOLS, tagged('demo', 'pool-a'))} />);

    expect(screen.getByRole('button', { name: /team·b/ })).toBeInTheDocument();      // claude-corp, in pool
    expect(screen.getByRole('button', { name: /team·d/ })).toBeInTheDocument();      // claude-dev0, untagged
    expect(screen.queryByRole('button', { name: /team·alt/ })).not.toBeInTheDocument(); // claude2, other pool
    expect(screen.getByRole('button', { name: 'show other pools (1)' })).toBeInTheDocument();
  });

  it('reveals the crossing rows with a pool chip when the disclosure is opened', () => {
    const s = fleetSession({ wrapper: 'claude', home: 'claude', project: 'demo' });
    render(<SwapSheet session={s} open onClose={vi.fn()} fleet={poolStore([s], POOLS, tagged('demo', 'pool-a'))} />);

    fireEvent.click(screen.getByRole('button', { name: 'show other pools (1)' }));
    const row = screen.getByRole('button', { name: /team·alt/ });
    expect(row).toBeInTheDocument();
    expect(row.textContent).toContain('pool · pool-b');
  });

  it('names the crossing in the confirm sentence and posts crossPool on the wire', async () => {
    const swap = vi.spyOn(api, 'swap').mockResolvedValue(undefined);
    const s = fleetSession({ wrapper: 'claude', home: 'claude', project: 'demo' });
    render(<SwapSheet session={s} open onClose={vi.fn()} fleet={poolStore([s], POOLS, tagged('demo', 'pool-a'))} />);

    fireEvent.click(screen.getByRole('button', { name: 'show other pools (1)' }));
    fireEvent.click(screen.getByRole('button', { name: /team·alt/ }));
    expect(await screen.findByText(/crosses pools/i)).toBeInTheDocument();
    expect(screen.getByText(/pool-b/)).toBeInTheDocument();
    expect(screen.getByText(/pool-a/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    expect(swap).toHaveBeenCalledWith(s.id, 'claude2', { crossPool: true });
  });

  it('an ELIGIBLE pick posts the byte-identical two-argument call', async () => {
    // The mutant this kills: passing `{crossPool: cross}` unconditionally. It
    // would write a `.crosspool` marker on the box for a move nobody declared,
    // and that marker exempts the session from the pool machinery until a
    // retag or a move — a silent, sticky consequence of a plain tap.
    const swap = vi.spyOn(api, 'swap').mockResolvedValue(undefined);
    const s = fleetSession({ wrapper: 'claude', home: 'claude', project: 'demo' });
    render(<SwapSheet session={s} open onClose={vi.fn()} fleet={poolStore([s], POOLS, tagged('demo', 'pool-a'))} />);

    fireEvent.click(screen.getByRole('button', { name: /team·b/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Move' }));
    expect(swap).toHaveBeenCalledWith(s.id, 'claude-corp');
    expect(swap.mock.calls[0]).toHaveLength(2);
  });

  it('offers EVERY account with no disclosure and one honest note when the pool is not known from here', () => {
    // Hiding on unknown would be inventing a rule. The note is the whole
    // difference between "these are the accounts" and "these are the accounts
    // this box could vouch for".
    const s = fleetSession({ wrapper: 'claude', home: 'claude', project: 'demo' });
    render(<SwapSheet session={s} open onClose={vi.fn()} fleet={poolStore([s], POOLS, null)} />);

    expect(screen.getByRole('button', { name: /team·alt/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /show other pools/ })).not.toBeInTheDocument();
    expect(screen.getByText(/pool is not known from here/i)).toBeInTheDocument();
  });

  it('says the same on an unreadable tag — nobody decides, so nothing is hidden', () => {
    const s = fleetSession({ wrapper: 'claude', home: 'claude', project: 'demo' });
    const pools = { listed: true, byProject: { demo: { state: 'unreadable' } }, enforcement: 'enforced' };
    render(<SwapSheet session={s} open onClose={vi.fn()} fleet={poolStore([s], POOLS, pools)} />);

    expect(screen.getByRole('button', { name: /team·alt/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /show other pools/ })).not.toBeInTheDocument();
    expect(screen.getByText(/pool is not known from here/i)).toBeInTheDocument();
  });

  it('shows no disclosure when every account is in the pool — a control for an empty set is noise', () => {
    const s = fleetSession({ wrapper: 'claude', home: 'claude', project: 'demo' });
    render(<SwapSheet session={s} open onClose={vi.fn()}
                      fleet={poolStore([s], { claude: 'pool-a' }, tagged('demo', 'pool-a'))} />);
    expect(screen.queryByRole('button', { name: /show other pools/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/pool is not known from here/i)).not.toBeInTheDocument();
  });
});
```

Add to that file's imports: `import { api } from '../src/lib/api';` (it is not imported today), and add `ProjectPoolsWire` to its existing `shared/api` type import (`:10`, currently `import type { FleetSession } from '../../shared/api';`). The inline `pools` object in the last two `it` blocks is contextually typed by `poolStore`'s parameter, so a wrong `state` word is a compile error there too.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd pwa && ./node_modules/.bin/vitest run test/swap-sheet.test.tsx
```

Expected: FAIL — `Unable to find an accessible element with the role "button" and name "show other pools (1)"`, and `expected "swap" to be called with [ …, 'claude2', { crossPool: true } ]`.

- [ ] **Step 3: Give `AccountRow` a pool chip**

In `pwa/src/fleet/SwapSheet.tsx`, add to `AccountRow`'s destructured props (`:116-121`) and its type (`:122-128`):

```ts
  poolChip,
```

```ts
  /** The account's POOL NAME, rendered as a `pool · <name>` chip. Passed only
   *  by the crossing rows under `SwapSheet`'s disclosure and
   *  `NewSessionSheet`'s, which is why it is optional and why every existing
   *  call site renders byte-identically without it: on an eligible row the
   *  pool is the project's own and saying it twice would be noise. `null` is
   *  accepted and renders nothing, so a caller mapping `accountPool` straight
   *  in does not have to filter. */
  poolChip?: string | null;
```

and render it inside the row, immediately after the `{suggested && …}` line (`:149`):

```tsx
      {poolChip != null && poolChip !== '' && (
        <span className="acct-pool">pool · {poolChip}</span>
      )}
```

- [ ] **Step 4: Split the picker and declare the crossing**

In `pwa/src/fleet/SwapSheet.tsx`, extend the imports (`:15-18`):

```ts
import { accountHue, accountLabel, accountPool, rosterWrapperIds } from '../lib/accounts';
import { api, apiErrorText } from '../lib/api';
import { projectPoolOf, splitByPool } from '../lib/pools';
```

Inside `SwapSheet`, after `const roster = fleet((s) => s.roster);` (`:227`):

```ts
  const pools = fleet((s) => s.pools);
  /** Whether the crossing rows are revealed. Reset with `target` below, on the
   *  same key: a disclosure opened for one session must not stand open over
   *  another's list. */
  const [showOther, setShowOther] = useState(false);
```

Change the reset effect (`:257`) to:

```ts
  useEffect(() => { setTarget(null); setShowOther(false); }, [open, session.id]);
```

Replace the `wrappers`/`suggested` pair (`:260-261`) with:

```ts
  const wrappers = pickableWrappers(roster, sessions, disabledWrappers).filter((w) => w !== session.wrapper);
  // The project's pool, off the fleet frame by name (spec §5.9). `null` — no
  // frame, or a server that predates it — comes back from `splitByPool` as
  // `unknown`, which offers EVERYTHING: hiding a row on a rule nobody stated
  // would be this sheet inventing policy.
  const projectPool = projectPoolOf(pools, session.project);
  const split = splitByPool(roster, wrappers, projectPool);
  // Ranked among the accounts actually offered by default. Suggesting a target
  // that sits behind a disclosure would recommend a crossing.
  const suggested = leastLoaded(sessions, split.eligible);
  const projectPoolName = projectPool !== null && projectPool.state === 'tagged' ? projectPool.name : null;
```

Replace `move` (`:263-273`) with:

```ts
  const move = (wrapper: string): void => {
    // THE FLAG IS THE PICK'S OWN, not a mode this sheet is in: only a wrapper
    // that `splitByPool` put on the crossing side travels with it. An eligible
    // pick makes the two-argument call the route has always taken, byte for
    // byte — a `crossPool` key it did not ask for would have ccd write a
    // `.crosspool` marker that exempts the session from the pool machinery
    // until a retag or a move (spec §5.7.2).
    const cross = split.crossing.includes(wrapper);
    void (async () => {
      try {
        await (cross
          ? api.swap(session.id, wrapper, { crossPool: true })
          : api.swap(session.id, wrapper));
        toast(`Moving ${session.project} to ${accountLabel(roster, wrapper)}…`);
      } catch (err) {
        toast(`Couldn't move — ${apiErrorText(err)}`, 'error');
      }
    })();
    onClose();
  };
```

After the `sheetCopy` block (`:302-311`), add:

```ts
  // The crossing, said at the moment of commitment. Both pool names, because
  // "this crosses pools" without them tells the reader nothing they can check.
  const targetPool = target === null ? null : accountPool(roster, target);
  const crossingClause =
    target !== null && split.crossing.includes(target) && targetPool !== null && projectPoolName !== null
      ? `This crosses pools on purpose: ${targetLabel} is in pool ${targetPool} and ${session.project} `
        + `is in pool ${projectPoolName}. ccrc records the crossing, and leaves the session alone until `
        + 'the project is retagged or it moves again. '
      : '';
```

In the render, replace the `<div className="acct-list">…</div>` block (`:321-332`) with:

```tsx
        <div className="acct-list">
          {split.eligible.map((w) => (
            <AccountRow
              key={w}
              wrapper={w}
              limits={limitsFor(sessions, w)}
              suggested={w === suggested}
              onPick={setTarget}
              roster={roster}
            />
          ))}
        </div>
        {split.unknown ? (
          <p className="pool-note">
            This project's pool is not known from here, so every account is offered.
          </p>
        ) : split.crossing.length > 0 ? (
          <>
            <button
              type="button"
              className="acct-disclosure"
              aria-expanded={showOther}
              onClick={() => setShowOther((o) => !o)}
            >
              show other pools ({split.crossing.length})
            </button>
            {showOther && (
              <div className="acct-list">
                {split.crossing.map((w) => (
                  <AccountRow
                    key={w}
                    wrapper={w}
                    limits={limitsFor(sessions, w)}
                    onPick={setTarget}
                    roster={roster}
                    poolChip={accountPool(roster, w)}
                  />
                ))}
              </div>
            )}
          </>
        ) : null}
```

and put `crossingClause` at the FRONT of the QuickConfirm's `consequence` (`:338`), before `The session restarts under …`:

```tsx
        consequence={crossingClause
          + `The session restarts under ${targetLabel}. Anyone attached is briefly `
```

- [ ] **Step 5: Style the chip, the disclosure and the note**

In `pwa/src/fleet/fleet.css`, after the `.pool-row[data-none]` rule:

```css
/* The crossing row's pool, said on the row itself: a reader who opened the
   disclosure is about to leave one pool for another and the row is where the
   other one has to be named. Tertiary ink, the register the rest of this
   sheet gives to machine facts beside a label. */
.acct-pool {
  flex: none;
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  white-space: nowrap;
  color: var(--ink-tertiary);
}
/* The disclosure itself — a quiet full-width control, never a primary button:
   revealing the crossings is not the action, it is the permission to see them. */
.acct-disclosure {
  min-height: var(--tap-min);
  padding: 0;
  background: none;
  border: 0;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--ink-secondary);
  text-align: left;
  cursor: pointer;
}
/* "Not known from here" — the note that replaces the disclosure when nobody
   could decide. One line, tertiary, no icon: it explains why the list is
   longer than usual, and it is not a warning about anything. */
.pool-note {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--ink-tertiary);
}
```

Append to `pwa/test/fleet-css.test.ts`, in the describe Task 5 added:

```ts
  it('makes the crossing disclosure a real target', () => {
    expect(ruleFor('.acct-disclosure')).toContain('min-height: var(--tap-min)');
  });

  it('keeps the unknown-pool note quiet — it explains a longer list, it does not warn', () => {
    expect(declValue(ruleFor('.pool-note'), 'color')).toBe('var(--ink-tertiary)');
  });
```

- [ ] **Step 6: Run the tests to verify they pass**

Run:

```bash
cd pwa && ./node_modules/.bin/vitest run test/swap-sheet.test.tsx test/fleet-css.test.ts test/contrast.test.ts test/tap-targets.test.tsx && ./node_modules/.bin/tsc --noEmit
```

Expected: PASS on all four; `tsc` exits 0.

- [ ] **Step 7: Prove the guard by mutation**

1. Render `wrappers` instead of `split.eligible` in the default list. Expected red: `offers only the accounts the project pool admits` — `expected null not to be null` on the `team·alt` `queryByRole`.
2. In `move`, replace the ternary with `api.swap(session.id, wrapper, { crossPool: cross })`. Expected red: `an ELIGIBLE pick posts the byte-identical two-argument call` — `expected [ 's1', 'claude-corp', { crossPool: false } ] to have a length of 2 but got 3`.
3. In `move`, set `const cross = true;`. Expected red: the same test — `expected "swap" to be called with [ 's1', 'claude-corp' ]`.
4. In `splitByPool`'s call here, pass `projectPool ?? { state: 'untagged' }`. Expected red: `offers EVERY account with no disclosure and one honest note when the pool is not known from here` — `Unable to find an element with the text: /pool is not known from here/i`. (This is the null-treated-as-a-pool mutant row 26 names.)
5. Delete `crossingClause` from the consequence. Expected red: `names the crossing in the confirm sentence and posts crossPool on the wire` — `Unable to find an element with the text: /crosses pools/i`.
6. Drop `poolChip={accountPool(roster, w)}` from the crossing rows. Expected red: `reveals the crossing rows with a pool chip when the disclosure is opened` — `expected '…team·alt…' to contain 'pool · pool-b'`.

- [ ] **Step 8: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add pwa/src/fleet/SwapSheet.tsx pwa/src/fleet/fleet.css pwa/test/swap-sheet.test.tsx pwa/test/fleet-css.test.ts
git commit -m "feat(pwa): a cross-pool move is disclosed, confirmed by name, and declared on the wire"
```

---

### Task 8: `NewSessionSheet` splits the PROJECTS, against the account already picked

**Files:**
- Modify: `pwa/src/fleet/NewSessionSheet.tsx:9-20` (imports), `:39-52` (state), `:109-125` (the filter and `start`), `:172-195` (step 2's list)
- Test: `pwa/test/new-session-sheet.test.tsx` (new)

**Interfaces:**
- Consumes: `accountPool`, `poolSide` (Task 1); `api.createSession({…, crossPool?})` (Task 2); wave 3's `ProjectRow.pool?`.
- Produces: nothing new for later waves.

**Spec:** §5.10 `NewSessionSheet` row — "Step 2 splits projects by `ProjectRow.pool` against `accountPool(roster, wrapper)`; mismatched under the same disclosure; `createSession({…, crossPool: true})` for those."

**Mutation table:** no numbered §11 row (row 26 is `SwapSheet`'s twin of this). Goes red when a mismatched project is offered plainly, when a matching one is sent with `crossPool: true`, or when a project whose `pool` key is ABSENT (an older server's `GET /api/projects`) is filed as a crossing — the direction that would hide most of the fleet's projects behind a disclosure the moment a server lags a bundle.

Note the direction: this sheet reads `ProjectRow.pool` from `GET /api/projects`, NOT the `pools` frame. The account is already chosen at step 2, so the question is "which projects may this account take", and the projects list is the thing being filtered.

- [ ] **Step 1: Write the failing test**

Create `pwa/test/new-session-sheet.test.tsx`:

```tsx
// Step 2 of the new-session sheet, after pools. The account is already picked,
// so the split runs the other way round from `SwapSheet`'s: which of these
// projects may THIS account take. Same disclosure, same rule, same wire flag.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ProjectRow, RosterWire } from '../../shared/api';
import { api } from '../src/lib/api';
import { NewSessionSheet } from '../src/fleet/NewSessionSheet';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { TEST_ROSTER } from './rosterFixture';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const fakeSocket = () => ({ close: () => {}, send: () => {} }) as never;

const pooled = (byId: Record<string, string>): RosterWire[] =>
  TEST_ROSTER.map((a) => ({ ...a, pool: byId[a.id] ?? null }));

const storeWith = (roster: RosterWire[]): FleetStore => {
  const store = createFleetStore({ makeSocket: fakeSocket });
  act(() => { store.setState({ conn: 'open', sessions: [], roster }); });
  return store;
};

const proj = (name: string, pool?: ProjectRow['pool']): ProjectRow =>
  ({ name, workdir: `/w/${name}`, ...(pool === undefined ? {} : { pool }) });

/** Open the sheet, land the project list, and pick `claude` (pool-a) at step 1. */
const openAtStepTwo = async (projects: ProjectRow[], byId: Record<string, string>): Promise<void> => {
  vi.spyOn(api, 'projects').mockResolvedValue({ roots: ['/w'], projects });
  vi.spyOn(api, 'accounts').mockResolvedValue({ accounts: [], projected: null, roster: pooled(byId) });
  render(<NewSessionSheet open onClose={vi.fn()} fleet={storeWith(pooled(byId))} />);
  fireEvent.click(await screen.findByRole('button', { name: /team·max/ }));
};

const POOLS = { claude: 'pool-a', claude2: 'pool-b' };

describe('NewSessionSheet step 2 and the pool line', () => {
  it('lists the projects this account may take, and counts the rest behind the disclosure', async () => {
    await openAtStepTwo([
      proj('demo', { state: 'tagged', name: 'pool-a' }),
      proj('quiet-basin', { state: 'tagged', name: 'pool-b' }),
      proj('acct-a-demo', { state: 'untagged' }),
    ], POOLS);

    expect(await screen.findByText('demo')).toBeInTheDocument();
    expect(screen.getByText('acct-a-demo')).toBeInTheDocument();
    expect(screen.queryByText('quiet-basin')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'show other pools (1)' })).toBeInTheDocument();
  });

  it('reveals the crossing projects with their pool named on the row', async () => {
    await openAtStepTwo([
      proj('demo', { state: 'tagged', name: 'pool-a' }),
      proj('quiet-basin', { state: 'tagged', name: 'pool-b' }),
    ], POOLS);

    fireEvent.click(await screen.findByRole('button', { name: 'show other pools (1)' }));
    const row = screen.getByRole('button', { name: /quiet-basin/ });
    expect(row.textContent).toContain('pool · pool-b');
  });

  it('sends crossPool only for a project behind the disclosure', async () => {
    const create = vi.spyOn(api, 'createSession').mockResolvedValue(undefined);
    await openAtStepTwo([
      proj('demo', { state: 'tagged', name: 'pool-a' }),
      proj('quiet-basin', { state: 'tagged', name: 'pool-b' }),
    ], POOLS);

    fireEvent.click(await screen.findByText('demo'));
    fireEvent.click(screen.getByRole('button', { name: /^Start demo/ }));
    expect(create).toHaveBeenCalledWith({ wrapper: 'claude', project: 'demo', workdir: '/w/demo' });

    fireEvent.click(screen.getByRole('button', { name: 'show other pools (1)' }));
    fireEvent.click(screen.getByText('quiet-basin'));
    fireEvent.click(screen.getByRole('button', { name: /^Start quiet-basin/ }));
    expect(create).toHaveBeenLastCalledWith(
      { wrapper: 'claude', project: 'quiet-basin', workdir: '/w/quiet-basin', crossPool: true });
  });

  it('offers a project whose pool key is ABSENT plainly — an older server hides nothing', async () => {
    // The direction that matters: `pool` undefined is a server that predates
    // the field, not a project in some other pool. Filing it as a crossing
    // would put most of the fleet behind a disclosure the day a bundle
    // outruns a server.
    await openAtStepTwo([proj('demo'), proj('quiet-basin')], POOLS);
    expect(await screen.findByText('demo')).toBeInTheDocument();
    expect(screen.getByText('quiet-basin')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /show other pools/ })).not.toBeInTheDocument();
  });

  it('offers an undecidable project plainly too, and says so once', async () => {
    await openAtStepTwo([proj('demo', { state: 'unreadable' })], POOLS);
    expect(await screen.findByText('demo')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /show other pools/ })).not.toBeInTheDocument();
  });

  it('still says nothing matched when the search empties BOTH lists', async () => {
    await openAtStepTwo([
      proj('demo', { state: 'tagged', name: 'pool-a' }),
      proj('quiet-basin', { state: 'tagged', name: 'pool-b' }),
    ], POOLS);
    fireEvent.change(await screen.findByLabelText('Search projects'), { target: { value: 'zzz' } });
    expect(screen.getByText('No project matches "zzz"')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd pwa && ./node_modules/.bin/vitest run test/new-session-sheet.test.tsx
```

Expected: FAIL — `Unable to find an accessible element with the role "button" and name "show other pools (1)"`, and `quiet-basin` present when it should not be.

- [ ] **Step 3: Split step 2**

In `pwa/src/fleet/NewSessionSheet.tsx`, extend the imports (`:15-19`):

```ts
import { accountLabel, accountPool } from '../lib/accounts';
import { poolSide } from '../lib/pools';
```

Add beside the other `useState`s (`:52`):

```ts
  /** Whether the crossing projects are revealed. Reset with the rest of the
   *  sheet's choices on close, below — and also whenever the ACCOUNT changes,
   *  since the split it discloses is computed against that account. */
  const [showOther, setShowOther] = useState(false);
```

Add `setShowOther(false);` to the close-reset effect (`:83-90`) and to the "change account" button's handler (`:151-154`).

Replace the `filtered` computation (`:109-111`) with:

```ts
  const needle = query.trim().toLowerCase();
  const matching =
    needle === '' ? ordered : ordered.filter((p) => p.name.toLowerCase().includes(needle));
  // The account is already chosen at step 2, so the split runs the other way
  // round from `SwapSheet`'s: which of these PROJECTS may this account take.
  // `p.pool ?? null` is the whole absence-permits half — a server predating the
  // field sends no key, `poolSide` answers `unknown`, and an unknown project
  // is offered plainly. Only a measured `pool-mismatch` goes behind the
  // disclosure.
  const wrapperPool = wrapper === null ? null : accountPool(roster, wrapper);
  const isCrossing = (p: ProjectRow): boolean => poolSide(wrapperPool, p.pool ?? null) === 'crossing';
  const inPool = matching.filter((p) => !isCrossing(p));
  const otherPool = matching.filter(isCrossing);
```

Replace `start`'s call (`:117`) with:

```ts
      // The flag is the PROJECT's own, exactly as `SwapSheet`'s is the target
      // account's: a project the account's pool admits makes the byte-identical
      // call this sheet always made.
      const body = { wrapper, project: project.name, workdir: project.workdir };
      await (isCrossing(project) ? api.createSession({ ...body, crossPool: true }) : api.createSession(body));
```

Replace step 2's list block (`:172-195`) with:

```tsx
            <div className="proj-list">
              {inPool.map((p) => (
                <ProjectRowButton key={p.workdir} row={p} selected={p.workdir === project?.workdir}
                                  pool={null} onPick={setProject} />
              ))}
              {otherPool.length > 0 && (
                <>
                  <button
                    type="button"
                    className="acct-disclosure"
                    aria-expanded={showOther}
                    onClick={() => setShowOther((o) => !o)}
                  >
                    show other pools ({otherPool.length})
                  </button>
                  {showOther && otherPool.map((p) => (
                    <ProjectRowButton key={p.workdir} row={p} selected={p.workdir === project?.workdir}
                                      pool={p.pool !== undefined && p.pool.state === 'tagged' ? p.pool.name : null}
                                      onPick={setProject} />
                  ))}
                </>
              )}
              {inPool.length === 0 && otherPool.length === 0 && (
                <p className="proj-none">No project matches "{query}"</p>
              )}
            </div>
```

and add the row component above `NewSessionSheet` (after the imports):

```tsx
/** One project row. Extracted from step 2's map so the in-pool list and the
 *  disclosed list render the SAME row rather than two copies that could drift
 *  — the only difference between them is the pool chip, which is exactly the
 *  fact the disclosure exists to state. */
function ProjectRowButton({ row, selected, pool, onPick }: {
  row: ProjectRow;
  selected: boolean;
  pool: string | null;
  onPick: (p: ProjectRow) => void;
}): ReactNode {
  return (
    <button
      type="button"
      className={selected ? 'proj-row proj-row--selected' : 'proj-row'}
      onClick={() => onPick(row)}
    >
      <span className="proj-glyph" aria-hidden="true">{selected ? '❯' : ''}</span>
      <span className="proj-name">{row.name}</span>
      {pool !== null && <span className="acct-pool">pool · {pool}</span>}
      <span className="proj-dir">{row.workdir}</span>
    </button>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
cd pwa && ./node_modules/.bin/vitest run test/new-session-sheet.test.tsx test/fleet-screen.test.tsx && ./node_modules/.bin/tsc --noEmit
```

Expected: PASS on both; `tsc` exits 0.

- [ ] **Step 5: Prove the guard by mutation**

1. Change `isCrossing` to `poolSide(wrapperPool, p.pool ?? { state: 'untagged' }) === 'crossing'`. Expected red: none — this mutant is BEHAVIOURALLY IDENTICAL (both answer `eligible` for the absent key), which is why the honest form is the one that names the condition. Instead mutate to `p.pool === undefined ? true : poolSide(...) === 'crossing'` and confirm `offers a project whose pool key is ABSENT plainly` reds with `Unable to find an element with the text: demo`.
2. Change `start` to always send `{ ...body, crossPool: true }`. Expected red: `sends crossPool only for a project behind the disclosure` — `expected "createSession" to be called with [ { wrapper: 'claude', project: 'demo', workdir: '/w/demo' } ]`.
3. Render `matching` instead of `inPool` in the first list. Expected red: `lists the projects this account may take` — `expected null not to be null` on the `quiet-basin` query.

- [ ] **Step 6: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add pwa/src/fleet/NewSessionSheet.tsx pwa/test/new-session-sheet.test.tsx
git commit -m "feat(pwa): starting a session offers the projects this account's pool admits"
```

---

### Task 9: the row says stranded, and says when it is running off-pool

**Files:**
- Modify: `pwa/src/fleet/SessionLine.tsx:22-33` (imports), `:78-107` (props), `:140-152` (beside `swapNote`), `:222-232` (`away`), `:417-431` (beside `.sess-swapblocked`), `:495-513` (`.sess-acct`)
- Modify: `pwa/src/fleet/ProjectCard.tsx:200-212` and `:328-333` (pass the project pool to both `SessionLine` call sites)
- Modify: `pwa/src/fleet/fleet.css:1246-1254` (join the ink-tertiary cells), `:819-847` (join the achromatic group)
- Test: `pwa/test/session-line.test.tsx` (extend), `pwa/test/fleet-css.test.ts` (extend)

**Interfaces:**
- Consumes: wave 3's `FleetSession.stranded`; `accountPool` (Task 1); `projectPoolOf` (Task 1, called in `ProjectCard`).
- Produces: `SessionLine` prop `projectPool?: ProjectPoolWire | null` (default `null` — a line rendered standalone says nothing about pools).

**Spec:** §5.8.3 (`.sess-stranded` beside `.sess-swapblocked`, reason verbatim in `title`, suppressed on a dead row like `away`); §5.10 `SessionLine` row (`data-offpool` on `.sess-acct` when both pools are known and differ, aria "running on X (pool A), project is pool B").

**Mutation table:** no numbered §11 row for the PWA half; §11 row 39/40 pin the server and wire sides. Goes red when the strand cell reads a truthiness test on the marker (the fail-shut `{at:0}` row disappears), when it renders on a dead row, or when `data-offpool` fires on a pool only one side knows — which would accuse a session of being off-pool on a project nobody has tagged.

- [ ] **Step 1: Write the failing test**

Append to `pwa/test/session-line.test.tsx`:

```tsx
// Account pools, wave 4. Two cells, two different facts: the STRAND is "this
// session has nowhere to go and is not moving on its own" (ruling 6), and
// OFF-POOL is "it is running where the project's pool does not want it, and it
// will move when its cooldown gate opens or its hold clears" (ruling 5). One
// is stuck; the other is in transit. Rendering them as one cell would lose the
// difference the operator acts on.
describe('the strand cell', () => {
  it('renders the reason verbatim and repeats it in the title', () => {
    render(<SessionLine session={s({ stranded: { at: 1, reason: 'no account in pool pool-a can take it' } })}
                        onOpen={() => {}} onActions={() => {}} />);
    const cell = screen.getByText('stranded — no account in pool pool-a can take it');
    expect(cell).toHaveAttribute('title', 'no account in pool pool-a can take it');
  });

  it('keeps the marker when the reason is missing or unreadable — presence is the durable fact', () => {
    // The registry reads `.stranded` fail-shut, so a marker it could see and
    // not read arrives with `at: 0` and a stand-in reason. Dropping the half it
    // does not have and keeping the half it does is `.sess-swapblocked`'s own
    // contract, restated.
    const { rerender } = render(
      <SessionLine session={s({ stranded: { at: 0, reason: '' } })} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('stranded')).toBeInTheDocument();

    rerender(<SessionLine session={s({ stranded: { at: 0, reason: 'registry field unreadable' } })}
                          onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('stranded — registry field unreadable')).toBeInTheDocument();
  });

  it('is silent on a dead row, exactly as `away` is', () => {
    // Nothing is running, so "stranded" would describe a rescue with nothing
    // left to rescue.
    render(<SessionLine session={s({ status: 'dead', bucket: 'dead', stranded: { at: 1, reason: 'nowhere' } })}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(screen.queryByText(/stranded/)).not.toBeInTheDocument();
  });

  it('is silent with no marker, and on a server that predates the field', () => {
    render(<SessionLine session={s()} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.queryByText(/stranded/)).not.toBeInTheDocument();

    const older = { ...s() } as Record<string, unknown>;
    delete older['stranded'];
    cleanup();
    render(<SessionLine session={older as unknown as FleetSession} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.queryByText(/stranded/)).not.toBeInTheDocument();
  });
});

describe('the off-pool marker', () => {
  const pooled = (byId: Record<string, string>) =>
    TEST_ROSTER.map((a) => ({ ...a, pool: byId[a.id] ?? null }));

  it('marks the account cell when both pools are known and differ', () => {
    render(<SessionLine session={s({ wrapper: 'claude2', home: 'claude2' })}
                        roster={pooled({ claude2: 'pool-b' })}
                        projectPool={{ state: 'tagged', name: 'pool-a' }}
                        onOpen={() => {}} onActions={() => {}} />);
    const acct = screen.getByLabelText('running on team·alt (pool pool-b), project is pool pool-a');
    expect(acct).toHaveAttribute('data-offpool', 'true');
  });

  it('says nothing when only one side is known — an untagged account is not off-pool', () => {
    const { rerender } = render(
      <SessionLine session={s({ wrapper: 'claude2', home: 'claude2' })}
                   roster={pooled({})} projectPool={{ state: 'tagged', name: 'pool-a' }}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('team·alt').closest('.sess-acct')).not.toHaveAttribute('data-offpool');

    // …and the mirror: the account is tagged, the project is not.
    rerender(<SessionLine session={s({ wrapper: 'claude2', home: 'claude2' })}
                          roster={pooled({ claude2: 'pool-b' })} projectPool={{ state: 'untagged' }}
                          onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('team·alt').closest('.sess-acct')).not.toHaveAttribute('data-offpool');
  });

  it('says nothing when the names agree, and nothing at all with no projectPool', () => {
    const { rerender } = render(
      <SessionLine session={s({ wrapper: 'claude2', home: 'claude2' })}
                   roster={pooled({ claude2: 'pool-a' })} projectPool={{ state: 'tagged', name: 'pool-a' }}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('team·alt').closest('.sess-acct')).not.toHaveAttribute('data-offpool');

    rerender(<SessionLine session={s({ wrapper: 'claude2', home: 'claude2' })}
                          roster={pooled({ claude2: 'pool-b' })}
                          onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('team·alt').closest('.sess-acct')).not.toHaveAttribute('data-offpool');
  });

  it('is silent on a dead row', () => {
    render(<SessionLine session={s({ wrapper: 'claude2', home: 'claude2', status: 'dead', bucket: 'dead' })}
                        roster={pooled({ claude2: 'pool-b' })}
                        projectPool={{ state: 'tagged', name: 'pool-a' }}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('team·alt').closest('.sess-acct')).not.toHaveAttribute('data-offpool');
  });

  it('outranks the away arrow\'s aria sentence, and leaves the arrow itself alone', () => {
    // A session can be BOTH away from its pin and off-pool — a retag is
    // exactly how that happens. One element, one accessible name: off-pool is
    // the sharper fact and already names the account it is running on, so it
    // is the sentence that wins. `data-away` and the ↗ are untouched.
    render(<SessionLine session={s({ wrapper: 'claude2', home: 'claude' })}
                        roster={pooled({ claude2: 'pool-b' })}
                        projectPool={{ state: 'tagged', name: 'pool-a' }}
                        onOpen={() => {}} onActions={() => {}} />);
    const acct = screen.getByLabelText('running on team·alt (pool pool-b), project is pool pool-a');
    expect(acct).toHaveAttribute('data-away', 'true');
    expect(acct).toHaveAttribute('data-offpool', 'true');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd pwa && ./node_modules/.bin/vitest run test/session-line.test.tsx
```

Expected: FAIL — `Unable to find an element with the text: stranded — no account in pool pool-a can take it`.

- [ ] **Step 3: Add the two facts to the row**

In `pwa/src/fleet/SessionLine.tsx`, extend the imports (`:22-26`):

```ts
import {
  graphReadCount, substrateFault, unmeasuredFields,
  type FleetSession, type ProjectPoolWire, type RosterWire, type SessionBucket,
} from '../../../shared/api';
import { accountColorVar, accountLabel, accountPool } from '../lib/accounts';
```

Add to the destructured props (`:78-85`) and the props type (after `roster?`):

```ts
  projectPool = null,
```

```ts
  /** This session's PROJECT's pool, derived by `ProjectCard` off the
   *  fleet-level `pools` frame (spec §5.9: never carried per session, never
   *  revived, so there is nothing to persist and nothing to keep in step).
   *  `null` — the DEFAULT — is "nobody said", and the row then makes no pool
   *  claim at all: a line rendered standalone, or under a server that sends no
   *  frame, is byte-identical to the one that shipped. */
  projectPool?: ProjectPoolWire | null;
```

Add after `swapNote` (`:152`):

```ts
  // The strand (ruling 6). `?? null` and a type check on the KEY, the same
  // one-level-deeper guard `swapBlocked` above carries and for its reason: the
  // fleet frame is cast, not revived, so a row from a server predating this
  // field has no key at runtime. The marker's PRESENCE is the durable fact and
  // must outlive a reason this build could not read — `at` is deliberately not
  // consulted, because the registry's fail-shut arm answers `at: 0` for a
  // marker it could see and not read, and that is a REAL strand.
  const stranded = session.stranded ?? null;
  const strandReason =
    typeof stranded?.reason === 'string' && stranded.reason !== '' ? stranded.reason : null;
  const strandNote =
    stranded === null ? null
    : strandReason === null ? 'stranded'
    : `stranded — ${strandReason}`;
```

Add after `away` (`:228`):

```ts
  // Running where the project's pool does not want it — the visible state of a
  // session waiting on a `lastswap`/`swapblocked` gate or on a program hold
  // after a retag (spec §5.5.4's timing). BOTH sides must be known: an
  // untagged account serves any project and an untagged project takes any
  // account, so a marker on a half-known pair would accuse a session of
  // something the rule does not say. Built as the SENTENCE, in one expression,
  // so the flag and the words can never disagree about which condition they
  // are describing.
  const acctPool = accountPool(roster, session.wrapper);
  const projPoolName = projectPool !== null && projectPool.state === 'tagged' ? projectPool.name : null;
  const offPoolLabel =
    !dead && acctPool !== null && projPoolName !== null && acctPool !== projPoolName
      ? `running on ${accountLabel(roster, session.wrapper)} (pool ${acctPool}), project is pool ${projPoolName}`
      : null;
```

Add the cell immediately after the `.sess-swapblocked` block (`:426`):

```tsx
          {/* The strand (spec §5.8.3). Beside the swap refusal because they are
              neighbours in kind — both are durable registry markers about a
              move that did not happen — and distinct because their remedies
              are not the same: one is a refusal to leave, the other is nowhere
              to go. Suppressed on a dead row like `away` below: nothing is
              running, so there is no rescue left to be waiting for. THE REASON
              STRING IS THE DISPLAY, verbatim, never parsed. */}
          {!dead && strandNote !== null && (
            <span className="sess-stranded" data-stranded="true" title={strandReason ?? strandNote}>
              {strandNote}
            </span>
          )}
```

Change the `.sess-acct` span's `data-away` line and its `aria-label` block (`:498-503`):

```tsx
            data-away={away || undefined}
            data-offpool={offPoolLabel !== null || undefined}
            aria-label={
              offPoolLabel ?? (away
                ? `running on ${accountLabel(roster, session.wrapper)}, pinned to ${accountLabel(roster, session.home)}`
                : undefined)
            }
```

- [ ] **Step 4: Hand the row its project's pool**

In `pwa/src/fleet/ProjectCard.tsx`, add `projectPool={pool}` to BOTH `SessionLine` call sites — inside `rowBody` (`:202-209`) and in the archived list (`:331`). `pool` is the value Task 5 already computes.

- [ ] **Step 5: Style it as a meta cell, and neutralise it on the selected slab**

In `pwa/src/fleet/fleet.css`, add `.sess-stranded` to the shared ink-tertiary rule (`:1246-1248`) — but as its OWN rule directly below it, because the strand takes the attention ink rather than tertiary:

```css
/* The strand is the LOUD cell (ruling 6): a session that will not move on its
   own until an account frees up, a lane is enabled, or the project is
   untagged. Same shape as `.sess-held`/`.sess-swapblocked` above — mono,
   nowrap, ellipsised, with the full reason in `title` — and the same audited
   attention pair `.sess-acct-away` uses. Setting a colour here is what takes
   it out of `.sess-meta`'s inheritance, so it MUST also be named in
   `.sess-line--active`'s achromatic group above; see that rule's comment for
   the ratios that cost. */
.sess-stranded {
  font-family: var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--status-attention-text);
}
```

and add one line to the achromatic group (`:832-836`), after `.sess-line--active .sess-swapblocked,`:

```css
.sess-line--active .sess-stranded,
```

- [ ] **Step 6: Pin the stylesheet membership**

In `pwa/test/fleet-css.test.ts`, add `'.sess-stranded'` to the `for (const cell of [...])` list inside `strips every status and account hue from the slab` (`:343-376`) — that test's own opening comment already names a STRANDED cell as the case it exists to catch, so this is the guard closing on the thing it was written for. Add a line to its comment block:

```
                        // …and `.sess-stranded`, which is the cell that
                        // comment was written in anticipation of: it takes
                        // --status-attention-text of its own, so it strands on
                        // the selected slab exactly as `.sess-warn` would.
```

- [ ] **Step 7: Run the tests to verify they pass**

Run:

```bash
cd pwa && ./node_modules/.bin/vitest run test/session-line.test.tsx test/project-card.test.tsx test/fleet-css.test.ts test/contrast.test.ts && ./node_modules/.bin/tsc --noEmit
```

Expected: PASS on all four; `tsc` exits 0.

- [ ] **Step 8: Prove the guard by mutation**

1. Change `strandReason` to read `stranded?.at ? … : null` and gate the cell on `stranded?.at`. Expected red: `keeps the marker when the reason is missing or unreadable` — `Unable to find an element with the text: stranded`.
2. Drop the `!dead &&` from the cell. Expected red: `is silent on a dead row, exactly as \`away\` is` — `expected null not to be null`.
3. Change `offPoolLabel`'s guard to `acctPool !== projPoolName` alone. Expected red: `says nothing when only one side is known` — `expected element not to have attribute data-offpool`.
4. Swap the aria precedence to `away ? … : offPoolLabel ?? undefined`. Expected red: `outranks the away arrow's aria sentence` — `Unable to find a label with the text of: running on team·alt (pool pool-b), project is pool pool-a`.
5. Delete `.sess-line--active .sess-stranded,` from the achromatic group. Expected red: `strips every status and account hue from the slab` — `expected [ … ] to include '.sess-line--active .sess-stranded'`.

- [ ] **Step 9: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add pwa/src/fleet/SessionLine.tsx pwa/src/fleet/ProjectCard.tsx pwa/src/fleet/fleet.css pwa/test/session-line.test.tsx pwa/test/fleet-css.test.ts
git commit -m "feat(pwa): the row says stranded, and says when it is running outside its project's pool"
```

---

### Task 10: the banner arms when the fleet host cannot enforce a tag at all

**Files:**
- Modify: `pwa/src/fleet/FleetHostBanner.tsx:1-16` (the header census), `:51-68` (a third arm)
- Test: `pwa/test/fleet-host-banner.test.tsx` (extend)

**Interfaces:**
- Consumes: wave 3's `FleetHealth.projectPools?: PoolsEnforcement`.
- Produces: nothing for later waves.

**Spec:** §5.10 `FleetHostBanner` row — "An arm on `health.projectPools === 'unavailable'`: 'the fleet host's ccd does not honour project pools yet — redeploy the agent lane'. Silent on `unknown`."

**Mutation table:** §11 row 23, the banner half. Goes red the moment the arm fires on `'unknown'` — an older agent reports nothing, and a banner that fires when nothing was checked stops being read by the time something IS wrong. That is the identical three-state rule `roster` next door already carries, and this test file already pins it for that field; the two now stand or fall together.

- [ ] **Step 1: Write the failing test**

Append to `pwa/test/fleet-host-banner.test.tsx`, inside the existing `describe('FleetHostBanner', …)`:

```tsx
  it('warns when the host is UP but its ccd cannot honour a project pool at all', async () => {
    vi.spyOn(api, 'fleetHealth').mockResolvedValue(
      health({ connected: true, downSince: null, projectPools: 'unavailable' }));
    render(<FleetHostBanner />);
    expect(await screen.findByText(/does not honour project pools/i)).toBeInTheDocument();
    expect(screen.getByText(/redeploy the agent lane/i)).toBeInTheDocument();
    // No action button, for `roster`'s reason next door: the fix is a deploy on
    // the other box, which this app can neither do nor should offer.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('stays silent when pools are enforced, and when nobody could tell', async () => {
    // `unknown` is the three-state's whole point, exactly as it is for
    // `roster`: local mode has no second box and an older agent reports no
    // verb list. A banner that fires when nothing was checked is one nobody
    // reads by the time something is wrong.
    for (const projectPools of ['enforced', 'unknown'] as const) {
      vi.spyOn(api, 'fleetHealth').mockResolvedValue(
        health({ connected: true, downSince: null, projectPools }));
      render(<FleetHostBanner />);
      await act(async () => {});
      expect(screen.queryByText(/project pools/i), projectPools).not.toBeInTheDocument();
      cleanup();
    }
  });

  it('a divergent roster outranks it — one is silent damage, the other is a feature not yet arrived', async () => {
    vi.spyOn(api, 'fleetHealth').mockResolvedValue(
      health({ connected: true, downSince: null, roster: 'divergent', projectPools: 'unavailable' }));
    render(<FleetHostBanner />);
    expect(await screen.findByText(/different account rosters/i)).toBeInTheDocument();
    expect(screen.queryByText(/project pools/i)).not.toBeInTheDocument();
  });

  it('an unreachable host outranks it too — nothing can be redeployed until the box is back', async () => {
    vi.spyOn(api, 'fleetHealth').mockResolvedValue(health({ projectPools: 'unavailable' }));
    render(<FleetHostBanner />);
    expect(await screen.findByText(/unreachable/i)).toBeInTheDocument();
    expect(screen.queryByText(/project pools/i)).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd pwa && ./node_modules/.bin/vitest run test/fleet-host-banner.test.tsx
```

Expected: FAIL — `Unable to find an element with the text: /does not honour project pools/i`.

- [ ] **Step 3: Add the third arm**

In `pwa/src/fleet/FleetHostBanner.tsx`, add to the header census after the ROSTER DIVERGENT bullet (`:11-16`):

```
//  - POOLS UNAVAILABLE (amber): the host is up, and its `ccd` has no
//    `project-pool` verb — so a tag this app can read and display is a tag
//    nothing on the fleet is enforcing (spec §5.11). No action button, for the
//    roster arm's reason: the fix is an agent-lane deploy. `'unknown'` renders
//    nothing, same three-state rule, same argument.
```

and add the arm immediately after the roster block (`:66`):

```tsx
  // Ranked BELOW the roster warning and above nothing: a divergent roster is
  // silent damage happening now (sessions attributed to the wrong account, a
  // swap ccd rejects), while an unenforced pool is a feature that has not
  // arrived on the other box yet. Both are true of a host that is UP, so
  // ranking them is what keeps two banners off one screen.
  if (health && health.mode === 'remote' && health.connected && health.projectPools === 'unavailable') {
    return (
      <div className="fleet-host-banner fleet-host-banner--warn" role="status">
        <span className="fleet-host-banner-msg">
          The fleet host's ccd does not honour project pools yet, so a tag shown here is not being
          enforced. Redeploy the agent lane.
        </span>
      </div>
    );
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
cd pwa && ./node_modules/.bin/vitest run test/fleet-host-banner.test.tsx && ./node_modules/.bin/tsc --noEmit
```

Expected: PASS; `tsc` exits 0.

- [ ] **Step 5: Prove the guard by mutation**

1. Change the condition to `health.projectPools !== 'enforced'`. Expected red: `stays silent when pools are enforced, and when nobody could tell` — `expected element not to be in the document` on the `unknown` iteration.
2. Move the arm ABOVE the roster block. Expected red: `a divergent roster outranks it` — `Unable to find an element with the text: /different account rosters/i`.
3. Drop the `health.connected` clause. Expected red: `an unreachable host outranks it too` — `Unable to find an element with the text: /unreachable/i`.

- [ ] **Step 6: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add pwa/src/fleet/FleetHostBanner.tsx pwa/test/fleet-host-banner.test.tsx
git commit -m "feat(pwa): say so when the fleet host can display a pool tag but not enforce it"
```

---

### Task 11: Whole-branch gate

**Files:** none — this task writes no code. It measures the branch.

**Interfaces:**
- Consumes: everything Tasks 1–10 produced.
- Produces: the evidence that the wave is done.

**Spec:** the brief's whole-branch rule. Wave 4 touches no `ccd/` file and no `agent/` file, so there is **no agent-first deploy step**: the ordinary server-lane deploy (`bash deploy/deploy.sh`, coordinates from `~/.ccrc/deploy.env`, gated on `/health` reporting the shipped sha) carries the built PWA, and it happens after the branch merges rather than inside this plan.

**Mutation table:** none of its own. This is where the two cross-package scans that read `pwa/src` run — `single-definition.test.ts` (no second copy of a roster, no second enumeration of a set the type already carries) and `topology-clean.test.ts` (no operator pool name, account label, host or IP anywhere in the tree, docs included).

- [ ] **Step 1: The whole PWA suite, in the foreground**

Run:

```bash
cd pwa && npm run test
```

Expected: PASS, every file. Run it in the FOREGROUND with a timeout of at least 600000 ms — backgrounding hides a hang, and this suite is load-sensitive. A failure in a file this wave did not touch is re-run IN ISOLATION before it is called a real break.

- [ ] **Step 2: Typecheck and build**

Run:

```bash
cd pwa && ./node_modules/.bin/tsc --noEmit && npm run build
```

Expected: both exit 0. `npm run build` is `tsc --noEmit && vite build`; the second half is what proves the new modules actually bundle — `shared/poolrule` is imported by relative path from `pwa/src/lib/pools.ts`, and a path that typechecks under `moduleResolution: bundler` and does not resolve at bundle time would only show here.

- [ ] **Step 3: The design gate, standalone**

Run:

```bash
cd pwa && node design/contrast-check.mjs
```

Expected: exit 0. `contrast.test.ts` already ran it inside step 1; this is the same gate run the way the docs quote it, so a failure reads with the auditor's own output rather than through a test's assertion.

- [ ] **Step 4: The two scans that read `pwa/src`, plus the ledger guards**

Run:

```bash
cd server && npm ci
git fetch origin main
cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts test/topology-clean.test.ts test/dtbd.test.ts
```

Expected: PASS on all four suites. `deviation-refs` compares this branch's `D-N` definitions against `origin/main`'s WITHOUT merging, so a number two branches each took shows up here rather than at the merge that would otherwise decide it. `topology-clean` reads the whole tree including `docs/` — the fixture names this plan uses (`pool-a`, `pool-b`, `demo`, `quiet-basin`, `acct-a-demo`) and the `TEST_ROSTER` ids are what keeps it green.

- [ ] **Step 5: The server suite, because wave 3's routes are what this wave calls**

Run:

```bash
cd server && npm run test
```

Expected: PASS. This wave changed nothing under `server/src`, so a red here is either a wave-3 regression this branch inherited or one of the known load flakes (`ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`) — re-run the named file IN ISOLATION before calling it a break, and treat CI on the quiet box as the arbiter.

- [ ] **Step 6: Read the diff**

Run:

```bash
cd "$(git rev-parse --show-toplevel)" && git diff origin/main --stat && git log --oneline origin/main..HEAD
```

Expected: ten commits, one per task; the changed files are exactly those named in Tasks 1–10 and nothing else. Confirm by eye that no file under `ccd/`, `agent/`, `server/src` or `shared/` appears — every one of those belongs to another wave, and a stray edit here is a wave boundary crossed.

- [ ] **Step 7: Commit (only if steps 1–6 produced a fixup)**

If any step above required a correction, commit it alone:

```bash
cd "$(git rev-parse --show-toplevel)"
git add -A
git commit -m "fix(pwa): the whole-branch gate's own findings"
```

If nothing needed fixing, this step produces no commit and the wave is done.

---

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

No number is defined in this wave at plan time: none of the spec's §12 defects is PWA-side, and the
plan-time refinements the PWA rides on are defined where they were decided — **D-1664** (the rule lives in
`shared/poolrule.ts`, so `splitByPool` composes it and this wave tests the composition, not the table) in
wave 1, and **D-1683** (the cold-start `pools` frame the store's `null` slot waits for) in wave 3. A
deviation found while executing this plan is allocated in its own call at the moment it is found.
