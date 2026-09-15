# Routing slice 3 — serviceability: the per-class window in swap and placement, rc 5, the Fable ceiling, and `degraded` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A session that carries a `class` in its routing record is placed and swapped by whether a lane can serve that class — measured, never guessed — with three answers (servable, measured-unservable, unmeasured) kept apart; a Fable-class session never lands on a lane whose Fable share is at the ceiling, and when no lane can serve the class ccd degrades one rung, stamps `degraded`, journals it, and restores the intended class at the next settle on a lane that can serve it. A session with no `class` (or `class: default`) sees byte-identical behaviour to today.

**Architecture:** ONE predicate in L0 (`shared/serviceability.ts`: `serviceability(cls, lane, nowS)` → `skipped | servable | unservable(ceiling|backend) | unmeasured(no-figure|stale)`) with a bash mirror in `ccd/ccd` (`_serviceable w class` → rc 0/1/2/3 and a word on stdout), driven over ONE fixture table in both languages (`server/test/fixtures/serviceability.ts`), the way `shared/poolrule.ts` / `_pool_ok` are. The per-class figure: for `fable`, the offline sweep's per-account Fable share estimate (`~/.cc-sessions/usage/sweep/latest.json` → `perAccount.<id>.fableShare.estimate`, a fraction of PRICED weekly usage, labelled a proxy) against `FABLE_SHARE_CEILING_PCT` (40, twinned in both languages and parity-pinned); for `opus`/`sonnet`/`haiku`, the lane's measured seven-day figure against the ceiling the swap predicate already refuses at (`SWAP_CEILING`, 98). The clause composes AFTER pool eligibility in both walks (`_ws_least_loaded`, `_swap_target`; `projectHome` on the server). `_swap_target` mints two codes: **rc 5** (nobody can say — the class window is unmeasured on every lane that could otherwise take the session; its own `uword`, `classwindow`) and **rc 6** (a destination on stdout, chosen one rung DOWN because every lane was measured-unservable at the intended class); the tick handles 6 before its `-ge 2` undecidable guard, stamps `degraded`, journals a `route` act with actor `ccd`, and dispatches. `_spawn_start` composes `--model` from the class SERVED: at every settle it re-measures the current lane for the intended class, clears a standing `degraded` when the lane can serve it (restoring the intended class), stamps one when it cannot, and leaves a standing stamp alone when the figure is unmeasured. Placement (`_ws_least_loaded project [class]`, `projectHome(…, cls, shares)`) applies the clause as a filter; no caller passes a class until slice 4 wires the argv, so today's placement is unchanged and the walk is exercised by the parity runner.

**Tech Stack:** bash (`ccd/ccd`; python3 for the one nested-JSON read — ccd already calls python3 in forty-one places), TypeScript (`shared/serviceability.ts`, `shared/models.ts`, `server/src/shares.ts`, `server/src/limits.ts`), vitest.

**Spec:** `docs/superpowers/specs/2026-09-14-effort-model-routing-design.md` — §5.4 (swap continuity and routing around limits: the three answers, rc 5, the Fable ceiling and its 40 default, where the per-class figure comes from, placement applies the same clause, pool first then serviceability), §5.1 (`degraded`), §7 slice 3, §8 rows 11 and 12, §9. Slices 0–2 are on this branch (slice 2 on PR pending merge); the record (`class`, `degraded`) and its validator are slice 1's.

## Global Constraints

- **Byte-identical without a class.** A session with no routing record, or `class: default`, must produce the same `_swap_target` stdout and rc, the same `_ws_least_loaded` answer, the same `_spawn_start` argv and the same `projectHome` result as before this slice. Every existing suite over these functions is the pin (`ccd-auto-swap-pool`, `ccd-crosspool`, `ccd-default-pool`, `swap-route-pool`, `projected-home`, `ccd-route-spawn`, `ccd-spawn-split`); a new test asserts the no-class equality explicitly.
- **Three answers, never two** (spec §5.4): servable / measured-unservable / unmeasured are distinct in both languages and on every path; an absent sweep file, an absent row, a `null` estimate and a stale pass are all `unmeasured`, never `servable` and never `unservable`. A non-Anthropic lane cannot serve `fable` by its backend (`telemetry !== 'anthropic'`, the same predicate `generate.mjs` projects into `CCRC_ANTHROPIC_BACKEND`): that is `unservable` with `why: 'backend'`, a measurement of the roster, not a guess.
- **ccd never degrades on a fabricated fact:** `unmeasured` never degrades; on the swap path it is rc 5 (its own code, its own `uword`, never a reuse of 2/3/4), on the settle path a standing `degraded` stamp is left as it stands and no new one is written.
- **One rung, once:** degrade is `classBelow` / `_class_below` (fable→opus→sonnet→haiku, haiku→nothing), derived from `CLASSES` / `ROUTE_CLASSES` — never a third spelling of the four names (`single-definition.test.ts`'s walk rule).
- **The intended class stays in `class`; `degraded` is ccd's own stamp** (spec §5.1: written by ccd only — `cmd_route` already refuses it). `_spawn_start` composes `--model` from `degraded` when present, else `class`; `--settings`/`--effort` compose from the effort valid for the class SERVED (`_route_effort_for id <served>`).
- **Pool first, then serviceability**, in both walks and on the server; serviceability never widens pool eligibility.
- **`_swap_target` writes nothing.** The decision travels on rc and stdout (a command substitution loses variables); the caller stamps and journals. Every degrade and restore is a `route` lifecycle row (`_lc_done route … dec.actor ccd dec.reason … detail "degraded: <from> -> <to>"`) plus a `swap.log` line.
- **Twinned constants are parity-pinned:** `FABLE_SHARE_CEILING_PCT` (40) and `SHARE_FRESH_S` (28800) are spelled once in `shared/serviceability.ts` and once in `ccd/ccd`, harvested and compared by the parity test; `SEVEN_DAY_CEILING_PCT` (98) in shared is pinned equal to ccd's `SWAP_CEILING=` line. Rounding is `floor(estimate*100 + 0.5)` on both sides (Python's `round` is banker's; a twin must not disagree at .5).
- **The ceiling's number is the operator's** (spec §5.4: "set by slice 3 from the first week of measured Fable share; 40% is the default until then"): Task 7 READS the fleet's measured shares into the research note; the constant stays 40 unless the operator rules otherwise. Never edit a lane's settings or the live fleet's files.
- **L0 imports nothing from `node:` or the server;** `shared/serviceability.ts` may import `CLASSES`/`ModelClass` from `./models.js` (sibling values are already imported in `shared/roster.ts`).
- **Every commit that edits `ccd/ccd` re-stamps its provenance marker first** (`node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"` then `cd server && ./node_modules/.bin/vitest run test/ownership.test.ts`). Only `ccd/ccd` carries a marker.
- **AGENT-FIRST** for `ccd/`; **FIXTURE HOMEs only**; suites from inside the package, foreground, `timeout ≥ 600000`, never bare `npx vitest`; **D-numbers are issued** by the allocator (stdout ends `}http 201` on the same line); **no account names** in shipped source or fixtures (`claude`, `claude-a`, `gpt` are the test roster's).
- **Never touch the live fleet's tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*` units by hand.** Task 7's gate writes ONE routing field on the controller's own session, through the shipped verb, and only if the read it makes first says the lane can serve it.

---

## File structure

| File | Responsibility |
|---|---|
| `shared/serviceability.ts` (new) | `FABLE_SHARE_CEILING_PCT`, `SHARE_FRESH_S`, `SEVEN_DAY_CEILING_PCT`, `ShareReading`, `LaneFacts`, `Serviceability`, `serviceability()`, `classBelow()` |
| `server/src/shares.ts` (new) | `sweepLatestPath`, `parseSweepShares`, `readSharesMeasured` (absent / unreadable / malformed / reading), `shareFor` |
| `server/src/limits.ts` | `sevenOf(l)`; `projectHome(roster, limits, pool, cls?, shares?, nowS?)` applies the clause after pool eligibility |
| `ccd/ccd` | `FABLE_SHARE_CEILING_PCT`, `SHARE_FRESH_S`, `_class_below`, `_share_pct`, `_serviceable`, `_svc_gate`, `_route_degrade`, `_route_restore`; `_ws_least_loaded project [class]`; `_swap_target` two-pass loop, stay gates, rc 5/6; `_auto_swap_check` rc 6 arm and `5) uword=classwindow`; `_undecidable_cause classwindow`; `_spawn_start` composes the class served |
| `server/test/fixtures/serviceability.ts` (new) | the truth table both languages are driven over |
| tests | `serviceability.test.ts` (new, pure), `ccd-serviceable.test.ts` (new, parity + constants + ladder), `projected-home.test.ts` (class cases), `ccd-swap-target-class.test.ts` (new), `ccd-route-degrade.test.ts` (new), `single-definition.test.ts` (holders unchanged — measured) |
| `docs/superpowers/specs/2026-09-13-effort-model-orchestration-research.md` | §6 rows: the fleet's Fable shares at slice 3; the gate |

---

### Task 1: The predicate in L0, and the ladder

**Files:**
- Create: `shared/serviceability.ts`
- Modify: `shared/models.ts` (nothing — `CLASSES` is imported), `shared/models.mjs` / `shared/models.d.mts` (nothing)
- Test: `server/test/serviceability.test.ts` (new)

**Interfaces:**
- Consumes: `CLASSES`, `ModelClass` from `shared/models.ts`.
- Produces: `FABLE_SHARE_CEILING_PCT = 40`, `SHARE_FRESH_S = 28_800`, `SEVEN_DAY_CEILING_PCT = 98`, `interface ShareReading { estimatePct: number | null; finishedAtS: number }`, `interface LaneFacts { anthropic: boolean; seven: number | null; share: ShareReading | null }`, `type Serviceability` (five members below), `serviceability(cls: ModelClass | 'default', lane: LaneFacts, nowS: number): Serviceability`, `classBelow(cls: ModelClass): ModelClass | null`. Tasks 2, 3, 4 consume them.

- [ ] **Step 1: Write the failing test**

Create `server/test/serviceability.test.ts`:

```ts
// Routing spec 2026-09-14 §5.4 — the serviceability clause, in L0, pure. The
// bash twin (`_serviceable`, ccd/ccd) is driven over the same fixture table in
// `ccd-serviceable.test.ts`; this file pins the TypeScript side's own edges.
import { describe, it, expect } from 'vitest';
import {
  FABLE_SHARE_CEILING_PCT, SEVEN_DAY_CEILING_PCT, SHARE_FRESH_S,
  classBelow, serviceability, type LaneFacts,
} from '../../shared/serviceability.js';
import { CLASSES } from '../../shared/models.js';

const NOW = 1_800_000_000;
const lane = (o: Partial<LaneFacts> = {}): LaneFacts =>
  ({ anthropic: true, seven: 20, share: { estimatePct: 10, finishedAtS: NOW - 60 }, ...o });

describe('classBelow — one rung down the CLASSES ladder', () => {
  it('walks CLASSES in order and stops at the bottom', () => {
    expect(classBelow('fable')).toBe('opus');
    expect(classBelow('opus')).toBe('sonnet');
    expect(classBelow('sonnet')).toBe('haiku');
    expect(classBelow('haiku')).toBeNull();
    // derived, not respelled: every member maps to its predecessor or null
    for (let i = 0; i < CLASSES.length; i++) expect(classBelow(CLASSES[i]!)).toBe(i === 0 ? null : CLASSES[i - 1]);
  });
});

describe('serviceability — five answers', () => {
  it('class default is SKIPPED, whatever the lane says', () => {
    expect(serviceability('default', lane({ seven: 99, share: null }), NOW)).toEqual({ kind: 'skipped' });
  });

  it('fable: the share estimate against FABLE_SHARE_CEILING_PCT, at the ceiling is unservable', () => {
    expect(serviceability('fable', lane({ share: { estimatePct: FABLE_SHARE_CEILING_PCT - 1, finishedAtS: NOW } }), NOW))
      .toEqual({ kind: 'servable', figurePct: FABLE_SHARE_CEILING_PCT - 1 });
    expect(serviceability('fable', lane({ share: { estimatePct: FABLE_SHARE_CEILING_PCT, finishedAtS: NOW } }), NOW))
      .toEqual({ kind: 'unservable', why: 'ceiling', figurePct: FABLE_SHARE_CEILING_PCT, ceilingPct: FABLE_SHARE_CEILING_PCT });
  });

  it('fable: no reading, a null estimate, or a stale pass is UNMEASURED — never servable, never unservable', () => {
    expect(serviceability('fable', lane({ share: null }), NOW)).toEqual({ kind: 'unmeasured', why: 'no-figure' });
    expect(serviceability('fable', lane({ share: { estimatePct: null, finishedAtS: NOW } }), NOW)).toEqual({ kind: 'unmeasured', why: 'no-figure' });
    expect(serviceability('fable', lane({ share: { estimatePct: 5, finishedAtS: NOW - SHARE_FRESH_S - 1 } }), NOW)).toEqual({ kind: 'unmeasured', why: 'stale' });
    expect(serviceability('fable', lane({ share: { estimatePct: 5, finishedAtS: NOW - SHARE_FRESH_S } }), NOW)).toEqual({ kind: 'servable', figurePct: 5 });
  });

  it('fable on a lane whose backend is not Anthropic is unservable by BACKEND, before any figure is read', () => {
    expect(serviceability('fable', lane({ anthropic: false, share: { estimatePct: 0, finishedAtS: NOW } }), NOW))
      .toEqual({ kind: 'unservable', why: 'backend' });
  });

  it.each(['opus', 'sonnet', 'haiku'] as const)('%s: the seven-day figure against SEVEN_DAY_CEILING_PCT; null is unmeasured', (c) => {
    expect(serviceability(c, lane({ seven: SEVEN_DAY_CEILING_PCT - 1 }), NOW)).toEqual({ kind: 'servable', figurePct: SEVEN_DAY_CEILING_PCT - 1 });
    expect(serviceability(c, lane({ seven: SEVEN_DAY_CEILING_PCT }), NOW))
      .toEqual({ kind: 'unservable', why: 'ceiling', figurePct: SEVEN_DAY_CEILING_PCT, ceilingPct: SEVEN_DAY_CEILING_PCT });
    expect(serviceability(c, lane({ seven: null }), NOW)).toEqual({ kind: 'unmeasured', why: 'no-figure' });
    // the share is irrelevant to these classes
    expect(serviceability(c, lane({ seven: 10, share: null, anthropic: false }), NOW)).toEqual({ kind: 'servable', figurePct: 10 });
  });

  it('the constants are what the spec says until the operator moves them', () => {
    expect(FABLE_SHARE_CEILING_PCT).toBe(40);
    expect(SHARE_FRESH_S).toBe(28_800);
    expect(SEVEN_DAY_CEILING_PCT).toBe(98);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/serviceability.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `shared/serviceability.ts`:

```ts
// Routing spec 2026-09-14 §5.4 — the serviceability clause: may THIS lane run a
// session of THAT class right now? ONE definition, here in L0 (imports nothing
// but a sibling `shared/` value, like `roster.ts`), mirrored in bash by ccd's
// `_serviceable` and driven over one fixture table in both languages
// (`server/test/fixtures/serviceability.ts`), the way `poolrule.ts` / `_pool_ok`
// are — because two implementations of one rule drift, and a placement forecast
// the PWA shows must not disagree with the placement ccd makes.
//
// THREE ANSWERS, NEVER TWO, plus two edges: `servable` and `unservable` are
// MEASUREMENTS; `unmeasured` is the honest absence of one (no reading, no row,
// a null estimate, a pass older than SHARE_FRESH_S) and never degrades anything
// (§5.4: "ccd does not degrade on a fabricated fact"); `skipped` is `class:
// default` — the lane's own settings decide and the clause does not apply.
import { CLASSES, type ModelClass } from './models.js';

/** The Fable share ceiling, in percent of the account's PRICED weekly usage —
 *  the sweep's `fableShare.estimate` (a proxy, labelled as one wherever it is
 *  shown: spec §2, §5.4). 40 until the operator sets it from measured share.
 *  `ccd/ccd`'s `FABLE_SHARE_CEILING_PCT` is the bash twin, pinned equal by
 *  `ccd-serviceable.test.ts`. Placement refuses AT the ceiling, so a lane never
 *  reaches the point where the next Fable turn bills credits. */
export const FABLE_SHARE_CEILING_PCT = 40;

/** A sweep pass older than this measures nothing for placement: two 4-hourly
 *  passes. Bash twin `SHARE_FRESH_S`, pinned equal. */
export const SHARE_FRESH_S = 28_800;

/** The seven-day figure the swap predicate already refuses at — ccd's
 *  `SWAP_CEILING` (98), which `ccd-serviceable.test.ts` harvests and pins this
 *  equal to. Opus, Sonnet and Haiku serviceability is that same test on that
 *  same figure (§5.4: "Opus and Sonnet serviceability use the single
 *  seven_day figure"); it is spelled here so both languages agree on it. */
export const SEVEN_DAY_CEILING_PCT = 98;

/** One account's Fable share as the sweep last measured it. `estimatePct` is
 *  `floor(estimate * 100 + 0.5)` — NOT `Math.round`: the bash twin rounds in
 *  Python, whose `round` is banker's, and a twin that disagrees at .5 is a
 *  parity defect waiting for the one account that sits exactly there. */
export interface ShareReading { estimatePct: number | null; finishedAtS: number }

/** What the clause needs to know about a lane — read by the caller (server:
 *  `readLimits` + `readSharesMeasured`; ccd: `_limit_field` + `_share_pct`),
 *  never by this function, so it stays pure. `seven` is the lane's MEASURED
 *  seven-day percentage: `null` when nothing measured it OR its window rolled
 *  over (`AccountLimits.sevenRolledOver`, `_limit_field`'s retraction). */
export interface LaneFacts {
  anthropic: boolean;
  seven: number | null;
  share: ShareReading | null;
}

export type Serviceability =
  | { kind: 'skipped' }
  | { kind: 'servable'; figurePct: number }
  | { kind: 'unservable'; why: 'ceiling'; figurePct: number; ceilingPct: number }
  | { kind: 'unservable'; why: 'backend' }
  | { kind: 'unmeasured'; why: 'no-figure' | 'stale' };

/** One rung DOWN the ladder (§3 "the class ladder"): fable → opus → sonnet →
 *  haiku → nothing. DERIVED from `CLASSES` (ascending), never respelled —
 *  `single-definition.test.ts` admits a file to the four names only when it
 *  walks them. ccd's `_class_below` walks `ROUTE_CLASSES` (descending) for
 *  the same answer; `ccd-serviceable.test.ts` pins the two ladders equal. */
export function classBelow(cls: ModelClass): ModelClass | null {
  const i = CLASSES.indexOf(cls);
  return i > 0 ? CLASSES[i - 1]! : null;
}

export function serviceability(cls: ModelClass | 'default', lane: LaneFacts, nowS: number): Serviceability {
  if (cls === 'default') return { kind: 'skipped' };
  if (cls === 'fable') {
    // A backend that is not Anthropic has no Fable to serve. That is a fact of
    // the roster (`telemetry !== 'anthropic'`, the predicate `generate.mjs`
    // projects into CCRC_ANTHROPIC_BACKEND), so it is a measurement, decided
    // BEFORE any figure: a gpt lane's share estimate is 0 — "no Fable usage" —
    // and reading that as servable would place a Fable session where Fable
    // does not exist.
    if (!lane.anthropic) return { kind: 'unservable', why: 'backend' };
    if (lane.share === null || lane.share.estimatePct === null) return { kind: 'unmeasured', why: 'no-figure' };
    if (nowS - lane.share.finishedAtS > SHARE_FRESH_S) return { kind: 'unmeasured', why: 'stale' };
    return lane.share.estimatePct >= FABLE_SHARE_CEILING_PCT
      ? { kind: 'unservable', why: 'ceiling', figurePct: lane.share.estimatePct, ceilingPct: FABLE_SHARE_CEILING_PCT }
      : { kind: 'servable', figurePct: lane.share.estimatePct };
  }
  if (lane.seven === null) return { kind: 'unmeasured', why: 'no-figure' };
  return lane.seven >= SEVEN_DAY_CEILING_PCT
    ? { kind: 'unservable', why: 'ceiling', figurePct: lane.seven, ceilingPct: SEVEN_DAY_CEILING_PCT }
    : { kind: 'servable', figurePct: lane.seven };
}
```

- [ ] **Step 4: Run to verify it passes, plus the L0 and single-definition guards**

Run: `cd server && ./node_modules/.bin/vitest run test/serviceability.test.ts test/single-definition.test.ts test/typecheck-tests.test.ts`
Expected: PASS. If `single-definition` reds on a new holder of the four class names, the cause is a respelling — `classBelow` must walk `CLASSES`, and the test file above names the four words only through `classBelow`/`CLASSES` and the three-word `it.each` (which is not the four). Fix the code, never the scan.

- [ ] **Step 5: Mutation check, measured**

Change `>=` to `>` in the fable arm → "at the ceiling is unservable" reds. Restore. Change `classBelow` to return `CLASSES[i + 1]` → the ladder test reds. Restore. Note both in the commit body.

- [ ] **Step 6: Commit**

```bash
git add shared/serviceability.ts server/test/serviceability.test.ts
git commit -m "feat(routing): the serviceability clause in L0 — five answers, the Fable ceiling, the class ladder (routing slice 3, Task 1)"
```

---

### Task 2: The server reads the sweep's shares, and `projectHome` applies the clause

**Files:**
- Create: `server/src/shares.ts`
- Modify: `server/src/limits.ts` (`sevenOf`, `projectHome` signature and filter)
- Test: `server/test/shares.test.ts` (new), `server/test/projected-home.test.ts` (TS-side class cases; the bash side joins in Task 4)

**Interfaces:**
- Consumes: Task 1's `serviceability`, `ShareReading`, `LaneFacts`; `readFileMeasured` (`server/src/io.ts`); `AccountLimits` (`limits.ts`); the sweep's output at `<registryDir>/usage/sweep/latest.json` (`ccd/ccd-usage-sweep` writes `$REG/usage/sweep/latest.json`; `perAccount.<id>.fableShare.estimate` is a fraction or `null`; `finishedAt` is `%Y-%m-%dT%H:%M:%SZ`).
- Produces: `sweepLatestPath(registryDir)`, `type SharesRead = { kind: 'reading'; finishedAtS: number; byAccount: Record<string, number | null> } | { kind: 'absent' } | { kind: 'unreadable' } | { kind: 'malformed' }`, `parseSweepShares(content)`, `readSharesMeasured(io, registryDir)`, `shareFor(read, account): ShareReading | null`, `sevenOf(l)`, `projectHome(roster, limits, pool, cls = 'default', shares = { kind: 'absent' }, nowS = now)`.

- [ ] **Step 1: Write the failing tests**

Create `server/test/shares.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseSweepShares, shareFor, sweepLatestPath } from '../src/shares.js';

const ISO = '2026-09-15T12:00:00Z';
const ISO_S = Date.UTC(2026, 8, 15, 12, 0, 0) / 1000;
const body = (accounts: Record<string, number | null>): string => JSON.stringify({
  finishedAt: ISO,
  perAccount: Object.fromEntries(Object.entries(accounts).map(([a, e]) => [a, { fableShare: { estimate: e } }])),
});

describe('parseSweepShares', () => {
  it('reads finishedAt and each account\'s estimate as an integer percent, floor(x*100+0.5)', () => {
    const r = parseSweepShares(body({ claude: 0.405, 'claude-a': 0.0, gpt: null }));
    expect(r).toEqual({ kind: 'reading', finishedAtS: ISO_S, byAccount: { claude: 41, 'claude-a': 0, gpt: null } });
  });
  it('malformed: not JSON, not an object, no finishedAt, a finishedAt that does not parse, perAccount not an object', () => {
    for (const c of ['nope', '[]', '{}', '{"finishedAt":"yesterday","perAccount":{}}', '{"finishedAt":"2026-09-15T12:00:00Z","perAccount":3}']) {
      expect(parseSweepShares(c), c).toEqual({ kind: 'malformed' });
    }
  });
  it('an account row without fableShare, or with a non-numeric estimate, is a null estimate — a row, not a malformed file', () => {
    const r = parseSweepShares(JSON.stringify({ finishedAt: ISO, perAccount: { claude: {}, 'claude-a': { fableShare: { estimate: 'x' } } } }));
    expect(r).toEqual({ kind: 'reading', finishedAtS: ISO_S, byAccount: { claude: null, 'claude-a': null } });
  });
});

describe('shareFor', () => {
  it('null for a non-reading and for an account the pass did not see; a ShareReading otherwise', () => {
    expect(shareFor({ kind: 'absent' }, 'claude')).toBeNull();
    expect(shareFor({ kind: 'malformed' }, 'claude')).toBeNull();
    const r = parseSweepShares(body({ claude: 0.1 }));
    expect(shareFor(r, 'nobody')).toBeNull();
    expect(shareFor(r, 'claude')).toEqual({ estimatePct: 10, finishedAtS: ISO_S });
  });
  it('the path is the sweep\'s own, under the .cc-sessions read root', () => {
    expect(sweepLatestPath('/h/.cc-sessions')).toBe('/h/.cc-sessions/usage/sweep/latest.json');
  });
});
```

Append to `server/test/projected-home.test.ts` (TS side only in this task; Task 4 drives ccd over the same rows — write the cases into `fixtures/leastLoaded.ts` now so Task 4 adds no rows, only the bash run):

In `server/test/fixtures/leastLoaded.ts`'s `LeastLoadedCase` add two optional fields:

```ts
  /** Routing slice 3. The class the placement is for; absent means `default`
   *  (the clause is skipped — every pre-slice-3 case stays byte-identical). */
  cls?: 'fable' | 'opus' | 'sonnet' | 'haiku';
  /** The sweep's latest pass, seeded at `<HOME>/.cc-sessions/usage/sweep/latest.json`
   *  by the runner: per-account Fable share ESTIMATES (fractions) and the pass
   *  age in seconds. Absent means no file — `unmeasured` for fable on both sides. */
  sweep?: { ageS: number; estimates: Record<string, number | null> };
```

and four cases at the end of `leastLoadedCases`:

```ts
  {
    name: 'fable-under-ceiling-everywhere-ranks-as-untagged',
    files: { claude: lim(50, 60), 'claude-a': lim(10, 20), 'claude-b': lim(30, 30) },
    cls: 'fable', sweep: { ageS: 60, estimates: { claude: 0.1, 'claude-a': 0.2, 'claude-b': 0.3 } },
    expect: { wrapper: 'claude-a', score: 20 },
  },
  {
    name: 'fable-at-ceiling-is-skipped-even-when-emptiest',
    files: { claude: lim(50, 60), 'claude-a': lim(10, 20), 'claude-b': lim(30, 30) },
    cls: 'fable', sweep: { ageS: 60, estimates: { claude: 0.1, 'claude-a': 0.40, 'claude-b': 0.3 } },
    expect: { wrapper: 'claude-b', score: 30 },
  },
  {
    name: 'fable-unmeasured-stays-eligible-and-ranks-by-its-own-score',
    files: { claude: lim(50, 60), 'claude-a': lim(10, 20), 'claude-b': lim(30, 30) },
    cls: 'fable', sweep: { ageS: 60, estimates: { claude: 0.1, 'claude-b': 0.3 } },   // claude-a has no row
    expect: { wrapper: 'claude-a', score: 20 },
  },
  {
    name: 'fable-stale-pass-is-unmeasured-not-a-refusal',
    files: { claude: lim(50, 60), 'claude-a': lim(10, 20), 'claude-b': lim(30, 30) },
    cls: 'fable', sweep: { ageS: 28_801, estimates: { claude: 0.9, 'claude-a': 0.9, 'claude-b': 0.9 } },
    expect: { wrapper: 'claude-a', score: 20 },
  },
  {
    name: 'fable-at-ceiling-on-every-lane-places-nothing',
    files: { claude: lim(50, 60), 'claude-a': lim(10, 20), 'claude-b': lim(30, 30) },
    cls: 'fable', sweep: { ageS: 60, estimates: { claude: 0.5, 'claude-a': 0.6, 'claude-b': 0.7 } },
    expect: null,
  },
```

(`lim(five, seven)` is whatever helper the fixture file already uses to spell a fresh limits row — read it; if it has none, write the JSON the existing cases write, with a `ts` of now and reset instants in the future.) Note the case names carry no `D-` token.

In `projected-home.test.ts`'s runner, where each case is seeded: also seed the sweep file when `c.sweep` is set —

```ts
const seedSweep = (s: LeastLoadedCase['sweep']): void => {
  const dir = path.join(home, '.cc-sessions', 'usage', 'sweep');
  fs.rmSync(dir, { recursive: true, force: true });
  if (!s) return;
  fs.mkdirSync(dir, { recursive: true });
  const finishedAt = new Date((now() - s.ageS) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify({
    finishedAt,
    perAccount: Object.fromEntries(Object.entries(s.estimates).map(([a, e]) => [a, { fableShare: { estimate: e } }])),
  }));
};
```

and the TS side of the comparison becomes `projectHome(roster, limits, pool, c.cls ?? 'default', await readSharesMeasured(localIO, cfg.registryDir), now())`. The bash side call stays `_ws_least_loaded "<project>"` for now — Task 4 appends the class argument; until then the five new cases run on the TS side only (guard the bash comparison with `if (!c.cls)` in THIS task and remove that guard in Task 4).

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/shares.test.ts test/projected-home.test.ts`
Expected: FAIL — `shares.js` not found; the five class cases red on the TS side.

- [ ] **Step 3: Implement**

Create `server/src/shares.ts`:

```ts
import path from 'node:path';
import type { FleetIO } from './io.js';
import type { ShareReading } from '../../shared/serviceability.js';

/** `~/.cc-sessions/usage/sweep/latest.json` — what `ccd/ccd-usage-sweep`
 *  writes (`OUT_DIR="$REG/usage/sweep"`), under the agent's `.cc-sessions/`
 *  read root, so the remote adapter reads it with no whitelist change — the
 *  same reason `usage.ts` reads the sidecars from there. `~/.ccrc/usage-sweep.json`
 *  is the PASS census (started/finished/status per pass), not the data. */
export function sweepLatestPath(registryDir: string): string {
  return path.join(registryDir, 'usage', 'sweep', 'latest.json');
}

/** Four answers, never three (the `readUsageMeasured` shape): absent and
 *  unreadable come from `readFileMeasured` and are not narrowed; malformed is
 *  this reader's own. A `reading` carries every account the pass saw, each
 *  with an integer percent or null (the sweep writes `null` when the account
 *  had no priced usage to take a share of). */
export type SharesRead =
  | { kind: 'reading'; finishedAtS: number; byAccount: Record<string, number | null> }
  | { kind: 'absent' }
  | { kind: 'unreadable' }
  | { kind: 'malformed' };

const pct = (v: unknown): number | null =>
  (typeof v === 'number' && Number.isFinite(v) ? Math.floor(v * 100 + 0.5) : null);

/** Pure. `finishedAt` is the sweep's `%Y-%m-%dT%H:%M:%SZ`; a file without a
 *  parseable one is MALFORMED — a pass that cannot be aged cannot be called
 *  fresh, and `serviceability` would read a fresh 0 as servable. */
export function parseSweepShares(content: string): Extract<SharesRead, { kind: 'reading' | 'malformed' }> {
  let raw: unknown;
  try { raw = JSON.parse(content); } catch { return { kind: 'malformed' }; }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { kind: 'malformed' };
  const o = raw as Record<string, unknown>;
  const fin = typeof o['finishedAt'] === 'string' ? Date.parse(o['finishedAt']) : NaN;
  if (!Number.isFinite(fin)) return { kind: 'malformed' };
  const per = o['perAccount'];
  if (typeof per !== 'object' || per === null || Array.isArray(per)) return { kind: 'malformed' };
  const byAccount: Record<string, number | null> = {};
  for (const [account, row] of Object.entries(per as Record<string, unknown>)) {
    const fs = typeof row === 'object' && row !== null ? (row as Record<string, unknown>)['fableShare'] : undefined;
    const est = typeof fs === 'object' && fs !== null ? (fs as Record<string, unknown>)['estimate'] : undefined;
    byAccount[account] = pct(est);
  }
  return { kind: 'reading', finishedAtS: Math.floor(fin / 1000), byAccount };
}

export async function readSharesMeasured(io: FleetIO, registryDir: string): Promise<SharesRead> {
  const r = await io.readFileMeasured(sweepLatestPath(registryDir));
  if (!r.ok) return r.reason === 'absent' ? { kind: 'absent' } : { kind: 'unreadable' };
  return parseSweepShares(r.content);
}

/** The clause's input for ONE account: null unless the read is a reading that
 *  saw this account. (`serviceability` turns null into `unmeasured`.) */
export function shareFor(read: SharesRead, account: string): ShareReading | null {
  if (read.kind !== 'reading' || !(account in read.byAccount)) return null;
  return { estimatePct: read.byAccount[account] ?? null, finishedAtS: read.finishedAtS };
}
```

Check `readFileMeasured`'s failure shape in `server/src/io.ts` before writing the `!r.ok` arm — mirror `usage.ts`'s exact spelling.

In `server/src/limits.ts`:

```ts
import { serviceability, type ShareReading } from '../../shared/serviceability.js';
import type { ModelClass } from '../../shared/models.js';
import { shareFor, type SharesRead } from './shares.js';

/** The seven-day figure the serviceability clause reads — MEASURED or null,
 *  the `measured()` rule's seven-day half: a rolled-over window is null, not
 *  its inferred 0. ccd's `_limit_field w seven` is the twin (it retracts on
 *  rollover the same way). */
export const sevenOf = (l: AccountLimits | undefined): number | null =>
  (!l || l.seven === null || l.sevenRolledOver ? null : l.seven);
```

and `projectHome`:

```ts
export function projectHome(
  roster: Roster, limits: Record<string, AccountLimits>, pool: ProjectPoolWire,
  cls: ModelClass | 'default' = 'default', shares: SharesRead = { kind: 'absent' },
  nowS: number = Math.floor(Date.now() / 1000),
): ProjectedHome | null {
  const eligible = poolEligible(roster, pool).filter((a) => limits[a.id]?.disabled !== true);
  // POOL FIRST, THEN SERVICEABILITY (routing spec §5.4), and the clause is a
  // FILTER on eligibility exactly as `_pool_ok` is: a lane measured at the
  // class's ceiling drops out here, before scoring and before the condemned
  // tier; an UNMEASURED lane stays — unmeasured never becomes ineligible, the
  // rule the three unknown-handling sites share — and ranks by its own score.
  // `default` skips the clause, so every caller that passes no class gets the
  // pre-slice-3 answer byte for byte. ccd's `_ws_least_loaded project [class]`
  // is the twin; `projected-home.test.ts` drives both over one fixture table.
  const live = cls === 'default' ? eligible : eligible.filter((a) =>
    serviceability(cls, { anthropic: a.telemetry === 'anthropic', seven: sevenOf(limits[a.id]), share: shareFor(shares, a.id) }, nowS)
      .kind !== 'unservable');
  if (live.length === 0) return null;
  …the rest unchanged…
```

(`a.telemetry` is the roster's own field — `'anthropic' | 'codex' | 'none'`, `shared/roster.ts:169` — the same predicate `generate.mjs` uses for `CCRC_ANTHROPIC_BACKEND`.) `projectPlacement` passes through unchanged (it composes `projectHome` with the defaults; slice 4 gives it the class).

- [ ] **Step 4: Run to verify they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/shares.test.ts test/projected-home.test.ts test/projects-route-placement.test.ts test/accounts*.test.ts test/typecheck-tests.test.ts`
Expected: PASS (the pre-existing placement cases are byte-identical: the default arguments skip the clause).

- [ ] **Step 5: Mutation check, measured**

In `projectHome` change `.kind !== 'unservable'` to `.kind === 'servable'` → `fable-unmeasured-stays-eligible…` reds (unmeasured dropped). Restore. In `parseSweepShares` replace `Math.floor(v * 100 + 0.5)` with `Math.round(v * 100)` → the `0.405` case still passes in JS (`Math.round(40.5) = 41`); the DIFFERENCE is only visible against the bash twin, which Task 3's parity table pins at exactly `.5` — say so in the commit body rather than claiming a red here.

- [ ] **Step 6: Commit**

```bash
git add server/src/shares.ts server/src/limits.ts server/test/shares.test.ts server/test/projected-home.test.ts server/test/fixtures/leastLoaded.ts
git commit -m "feat(routing): the server reads the sweep's Fable shares and projectHome applies the serviceability clause after pool eligibility (routing slice 3, Task 2)"
```

---

### Task 3: The bash mirror — `_serviceable`, `_share_pct`, `_class_below`, the twinned constants, and the parity table

**Files:**
- Modify: `ccd/ccd` (constants beside `SWAP_CEILING=98` at ~:900; helpers beside `_limit_field`; re-stamp the marker)
- Create: `server/test/fixtures/serviceability.ts`, `server/test/ccd-serviceable.test.ts`

**Interfaces:**
- Consumes: `_limit_field w seven` (retracts rolled-over windows), `_is_anthropic_backend w`, `ROUTE_CLASSES` (`fable opus sonnet haiku default`), `$REG/usage/sweep/latest.json`.
- Produces (bash): `FABLE_SHARE_CEILING_PCT=40`, `SHARE_FRESH_S=28800`, `_class_below class` (stdout the rung below, nothing for haiku), `_share_pct w` (stdout integer percent; rc 0 figure / 1 no figure / 2 stale), `_serviceable w class` (rc 0 servable / 1 unservable / 2 unmeasured / 3 skipped; stdout the figure on 0 and 1, the why-word `backend` on a backend refusal, `no-figure`/`stale` on 2), `_svc_gate w class` (rc 0 keep-or-take / 1 unservable / 2 unmeasured; folds 3 into 0). Tasks 4–6 consume them.

- [ ] **Step 1: Write the failing tests**

Create `server/test/fixtures/serviceability.ts`:

```ts
// One truth table for the serviceability clause (routing spec §5.4), driven
// through BOTH spellings: `serviceability()` (shared/serviceability.ts) and
// ccd's `_serviceable` — the `POOL_RULE_CASES` idiom. Every row is a FILE
// LAYOUT (a limits row for the lane, a sweep pass) plus a class, so both sides
// read the same bytes and nothing here re-derives the rule.
export interface ServiceabilityCase {
  name: string;
  cls: 'default' | 'fable' | 'opus' | 'sonnet' | 'haiku';
  /** The lane under test — `claude` is Anthropic, `gpt` is codex in DEFAULT_TEST_ROSTER. */
  lane: 'claude' | 'gpt';
  /** `~/.cc-limits/<lane>.json` bytes, as a function of now; absent = no file. */
  limits?: (now: number) => string;
  /** The sweep pass: age in seconds and the lane's estimate (a fraction, or
   *  null, or ABSENT = no row for the lane); absent = no file at all. */
  sweep?: { ageS: number; estimate?: number | null };
  expect: 'skipped' | 'servable' | 'unservable' | 'unmeasured';
  /** The why-word both sides print/return on unservable and unmeasured. */
  why?: 'ceiling' | 'backend' | 'no-figure' | 'stale';
  /** The figure both sides agree on for servable/ceiling rows. */
  figurePct?: number;
}

const fresh = (five: number, seven: number) => (now: number): string =>
  JSON.stringify({ five, seven, ts: now, fiveResetAt: now + 10_000, sevenResetAt: now + 400_000 });
const rolled = (now: number): string =>
  JSON.stringify({ five: 10, seven: 50, ts: now - 700_000, fiveResetAt: now - 600_000, sevenResetAt: now - 100 });

export const SERVICEABILITY_CASES: readonly ServiceabilityCase[] = [
  { name: 'default is skipped whatever the lane says', cls: 'default', lane: 'claude', limits: fresh(99, 99), sweep: { ageS: 1, estimate: 0.99 }, expect: 'skipped' },
  { name: 'fable under the ceiling is servable with the figure', cls: 'fable', lane: 'claude', limits: fresh(10, 10), sweep: { ageS: 1, estimate: 0.39 }, expect: 'servable', figurePct: 39 },
  { name: 'fable AT the ceiling is unservable', cls: 'fable', lane: 'claude', limits: fresh(10, 10), sweep: { ageS: 1, estimate: 0.40 }, expect: 'unservable', why: 'ceiling', figurePct: 40 },
  { name: 'fable rounds floor(x*100+0.5): 0.395 is 40, unservable', cls: 'fable', lane: 'claude', limits: fresh(10, 10), sweep: { ageS: 1, estimate: 0.395 }, expect: 'unservable', why: 'ceiling', figurePct: 40 },
  { name: 'fable rounds floor(x*100+0.5): 0.394 is 39, servable', cls: 'fable', lane: 'claude', limits: fresh(10, 10), sweep: { ageS: 1, estimate: 0.394 }, expect: 'servable', figurePct: 39 },
  { name: 'fable with no sweep file is unmeasured (no-figure)', cls: 'fable', lane: 'claude', limits: fresh(10, 10), expect: 'unmeasured', why: 'no-figure' },
  { name: 'fable with no row for the lane is unmeasured (no-figure)', cls: 'fable', lane: 'claude', limits: fresh(10, 10), sweep: { ageS: 1 }, expect: 'unmeasured', why: 'no-figure' },
  { name: 'fable with a null estimate is unmeasured (no-figure)', cls: 'fable', lane: 'claude', limits: fresh(10, 10), sweep: { ageS: 1, estimate: null }, expect: 'unmeasured', why: 'no-figure' },
  { name: 'fable with a stale pass is unmeasured (stale), however low the estimate', cls: 'fable', lane: 'claude', limits: fresh(10, 10), sweep: { ageS: 28_801, estimate: 0.01 }, expect: 'unmeasured', why: 'stale' },
  { name: 'fable at exactly SHARE_FRESH_S is still fresh', cls: 'fable', lane: 'claude', limits: fresh(10, 10), sweep: { ageS: 28_800, estimate: 0.01 }, expect: 'servable', figurePct: 1 },
  { name: 'fable on a codex lane is unservable by backend before any figure', cls: 'fable', lane: 'gpt', limits: fresh(0, 0), sweep: { ageS: 1, estimate: 0 }, expect: 'unservable', why: 'backend' },
  { name: 'opus under the seven-day ceiling is servable', cls: 'opus', lane: 'claude', limits: fresh(50, 97), expect: 'servable', figurePct: 97 },
  { name: 'opus at the seven-day ceiling is unservable', cls: 'opus', lane: 'claude', limits: fresh(0, 98), expect: 'unservable', why: 'ceiling', figurePct: 98 },
  { name: 'sonnet with no limits file is unmeasured', cls: 'sonnet', lane: 'claude', expect: 'unmeasured', why: 'no-figure' },
  { name: 'haiku with a rolled-over seven-day window is unmeasured, not its inferred 0', cls: 'haiku', lane: 'claude', limits: rolled, expect: 'unmeasured', why: 'no-figure' },
  { name: 'opus on a codex lane reads its own seven-day figure (the backend refusal is fable only)', cls: 'opus', lane: 'gpt', limits: fresh(0, 12), expect: 'servable', figurePct: 12 },
];
```

Create `server/test/ccd-serviceable.test.ts`:

```ts
// The serviceability clause in bash, driven over the SAME table as the L0
// function (`fixtures/serviceability.ts`), plus the three things only a
// two-language pin can hold: the twinned constants, the ladder, and the
// rounding at .5.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeCcdHarness, seedAccountsSh, type CcdHarness } from './ccdWsHelpers.js';
import { SERVICEABILITY_CASES } from './fixtures/serviceability.js';
import { CLASSES } from '../../shared/models.js';
import {
  FABLE_SHARE_CEILING_PCT, SEVEN_DAY_CEILING_PCT, SHARE_FRESH_S, classBelow, serviceability,
} from '../../shared/serviceability.js';
import { readLimits, sevenOf } from '../src/limits.js';
import { readSharesMeasured, shareFor } from '../src/shares.js';
import { localIO } from '../src/io.js';
import { loadConfig } from '../src/config.js';
import { seedRoster } from './helpers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ccdSrc = fs.readFileSync(path.join(root, 'ccd/ccd'), 'utf8');
const bashConst = (name: string): number => {
  const m = new RegExp(`^${name}=(\\d+)`, 'm').exec(ccdSrc);
  if (!m) throw new Error(`ccd/ccd declares no ${name}= — the twin moved or was renamed`);
  return Number(m[1]);
};

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-serviceable-'); seedAccountsSh(h.home); seedRoster(h.home); });
afterEach(() => { h.cleanup(); });

const now = (): number => Math.floor(Date.now() / 1000);
const seedCase = (c: (typeof SERVICEABILITY_CASES)[number]): void => {
  const lim = path.join(h.home, '.cc-limits'); fs.mkdirSync(lim, { recursive: true });
  for (const f of fs.readdirSync(lim)) fs.rmSync(path.join(lim, f));
  if (c.limits) fs.writeFileSync(path.join(lim, `${c.lane}.json`), c.limits(now()));
  const sw = path.join(h.home, '.cc-sessions', 'usage', 'sweep'); fs.rmSync(sw, { recursive: true, force: true });
  if (c.sweep) {
    fs.mkdirSync(sw, { recursive: true });
    const finishedAt = new Date((now() - c.sweep.ageS) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const perAccount = 'estimate' in c.sweep ? { [c.lane]: { fableShare: { estimate: c.sweep.estimate } } } : {};
    fs.writeFileSync(path.join(sw, 'latest.json'), JSON.stringify({ finishedAt, perAccount }));
  }
};
const RC: Record<string, number> = { servable: 0, unservable: 1, unmeasured: 2, skipped: 3 };

describe('the twinned constants and the ladder', () => {
  it('FABLE_SHARE_CEILING_PCT, SHARE_FRESH_S are spelled equal in both languages; SEVEN_DAY_CEILING_PCT is ccd\'s SWAP_CEILING', () => {
    expect(bashConst('FABLE_SHARE_CEILING_PCT')).toBe(FABLE_SHARE_CEILING_PCT);
    expect(bashConst('SHARE_FRESH_S')).toBe(SHARE_FRESH_S);
    expect(bashConst('SWAP_CEILING')).toBe(SEVEN_DAY_CEILING_PCT);
  });
  it('_class_below walks ROUTE_CLASSES to the same answers classBelow walks CLASSES to', () => {
    for (const c of CLASSES) {
      expect(h.sh(`_class_below ${c}`)).toBe(classBelow(c) ?? '');
    }
    expect(h.sh('_class_below default')).toBe('');
  });
});

describe('_serviceable over SERVICEABILITY_CASES — four exit codes, and the L0 function agrees row by row', () => {
  it('guards the guard: the table covers every answer and both why-words of each', () => {
    expect(SERVICEABILITY_CASES.length).toBeGreaterThanOrEqual(14);
    for (const e of ['skipped', 'servable', 'unservable', 'unmeasured']) expect(SERVICEABILITY_CASES.some((c) => c.expect === e), e).toBe(true);
    for (const w of ['ceiling', 'backend', 'no-figure', 'stale']) expect(SERVICEABILITY_CASES.some((c) => c.why === w), w).toBe(true);
  });

  it.each(SERVICEABILITY_CASES.map((c) => [c.name, c] as const))('%s', async (_n, c) => {
    seedCase(c);
    const out = h.sh(`_serviceable ${c.lane} ${c.cls}; echo " rc=$?"`);
    const [word, rcTok] = out.trim().split(' rc=');
    expect(Number(rcTok)).toBe(RC[c.expect]);
    if (c.expect === 'servable' || (c.expect === 'unservable' && c.why === 'ceiling')) expect(Number(word)).toBe(c.figurePct);
    if (c.why === 'backend' || c.expect === 'unmeasured') expect(word).toBe(c.why);
    // the L0 side over the SAME bytes
    const cfg = loadConfig({ home: h.home });   // read helpers.ts/projected-home.test.ts for the exact loadConfig call the suite uses
    const limits = await readLimits(localIO, cfg, now());
    const shares = await readSharesMeasured(localIO, cfg.registryDir);
    const v = serviceability(c.cls, { anthropic: c.lane === 'claude', seven: sevenOf(limits[c.lane]), share: shareFor(shares, c.lane) }, now());
    expect(v.kind).toBe(c.expect);
    if ('why' in v) expect(v.why).toBe(c.why);
    if ('figurePct' in v && c.figurePct !== undefined) expect(v.figurePct).toBe(c.figurePct);
  });
});
```

(`loadConfig` and `localIO` are used the same way in `projected-home.test.ts` — copy its exact incantation, including any env it sets.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-serviceable.test.ts`
Expected: FAIL — `bash: _serviceable: command not found` (rc 127) and the constant harvest throws.

- [ ] **Step 3: Implement in `ccd/ccd`**

Beside `SWAP_CEILING=98` (~:900) add:

```bash
FABLE_SHARE_CEILING_PCT=40      # routing spec §5.4: the Fable share (percent of PRICED weekly usage, the sweep's
                                # estimate — a proxy) at which a lane stops taking Fable-class sessions. The TWIN of
                                # shared/serviceability.ts's FABLE_SHARE_CEILING_PCT; ccd-serviceable.test.ts pins
                                # them equal. 40 until the operator sets it from measured share.
SHARE_FRESH_S=28800             # a sweep pass older than this (two 4-hourly passes) measures nothing: unmeasured. Twin.
```

Directly after `_limit_field`'s definition add:

```bash
_class_below() {   # class -> stdout the class one rung DOWN (fable->opus->sonnet->haiku->nothing); nothing for haiku or an unknown word
  # DERIVED from ROUTE_CLASSES (descending), never a fourth spelling of the four names: one rung down is the NEXT word.
  # shared/serviceability.ts's classBelow walks CLASSES (ascending) to the same answers; ccd-serviceable.test.ts pins them.
  local prev="" x
  for x in ${ROUTE_CLASSES% default}; do
    [[ "$prev" == "$1" ]] && { printf '%s' "$x"; return 0; }
    prev="$x"
  done
  return 0
}

_share_pct() {   # wrapper -> stdout the sweep's Fable share for that account as an INTEGER percent; rc 0 figure | 1 no figure | 2 stale
  # The sweep (ccd-usage-sweep) writes $REG/usage/sweep/latest.json: `perAccount.<id>.fableShare.estimate` is a FRACTION of
  # the account's PRICED weekly usage (or null), `finishedAt` is %Y-%m-%dT%H:%M:%SZ. Nested JSON, so python3 (ccd's
  # existing JSON tool, forty-one sites) rather than the flat-file grep `_limit_json_num` uses. floor(x*100+0.5), NOT
  # Python's round(): that is banker's rounding and the TypeScript twin (server/src/shares.ts) would disagree at .5.
  local f="$REG/usage/sweep/latest.json"
  [[ -r "$f" ]] || return 1
  LC_ALL=C.UTF-8 python3 - "$f" "$1" "$SHARE_FRESH_S" <<'PY'
import calendar, json, sys, time
f, acct, fresh = sys.argv[1], sys.argv[2], int(sys.argv[3])
try:
    d = json.load(open(f))
    at = calendar.timegm(time.strptime(d["finishedAt"], "%Y-%m-%dT%H:%M:%SZ"))
    est = d["perAccount"][acct]["fableShare"]["estimate"]
except Exception:
    sys.exit(1)
if not isinstance(est, (int, float)) or isinstance(est, bool):
    sys.exit(1)
if time.time() - at > fresh:
    sys.exit(2)
print(int(est * 100 + 0.5))
PY
}

_serviceable() {   # wrapper class -> rc 0 servable | 1 unservable | 2 unmeasured | 3 skipped (class default/empty); stdout: the figure (0, or 1 at the ceiling), `backend` (1, fable on a non-Anthropic lane), `no-figure`/`stale` (2)
  # Routing spec §5.4, the bash twin of shared/serviceability.ts's serviceability(); one fixture table drives both
  # (server/test/fixtures/serviceability.ts). THREE ANSWERS, NEVER TWO: an absent file, an absent row, a null estimate
  # and a stale pass are all `unmeasured` — never servable (a fabricated fact) and never unservable (a fabricated
  # refusal). `fable` on a lane whose backend is not Anthropic is unservable by the ROSTER's own word, before any
  # figure is read — a codex lane's share estimate is 0 and reading that as "servable" would place Fable where there
  # is none. Other classes read the lane's seven-day figure through _limit_field, which already retracts a rolled-over
  # window, against SWAP_CEILING — the same test _avail makes, so a candidate _avail admits is servable for them.
  local w="$1" c="${2:-}" fig rc
  [[ -z "$c" || "$c" == default ]] && return 3
  if [[ "$c" == fable ]]; then
    _is_anthropic_backend "$w" || { printf 'backend'; return 1; }
    fig=$(_share_pct "$w"); rc=$?
    case "$rc" in 1) printf 'no-figure'; return 2 ;; 2) printf 'stale'; return 2 ;; esac
    printf '%s' "$fig"
    [[ "$fig" -ge "$FABLE_SHARE_CEILING_PCT" ]] && return 1
    return 0
  fi
  fig=$(_limit_field "$w" seven)
  [[ -z "$fig" ]] && { printf 'no-figure'; return 2; }
  printf '%s' "$fig"
  [[ "$fig" -ge "$SWAP_CEILING" ]] && return 1
  return 0
}

_svc_gate() {   # wrapper class -> rc 0 the lane may keep or take the class (servable, or no class to apply) | 1 unservable | 2 unmeasured
  # The shape every decision site needs: `skipped` folds into 0 because a session with no class has nothing to gate on.
  [[ -z "${2:-}" || "$2" == default ]] && return 0
  _serviceable "$1" "$2" >/dev/null
  case $? in 0) return 0 ;; 1) return 1 ;; *) return 2 ;; esac
}
```

Re-stamp the marker (Global Constraints), then `cd server && ./node_modules/.bin/vitest run test/ownership.test.ts`.

- [ ] **Step 4: Run to verify they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-serviceable.test.ts test/serviceability.test.ts test/single-definition.test.ts test/ownership.test.ts`
Expected: PASS. `single-definition`'s four-names walk: `_class_below` walks `${ROUTE_CLASSES% default}` and names none of the four — measured green, or the rationale comment in that test gains ccd's new walk site (it already admits `ccd/ccd` as a holder).

- [ ] **Step 5: Mutation check, measured**

Change `FABLE_SHARE_CEILING_PCT=40` to `41` in ccd → the constants test reds (and the AT-ceiling row). Restore. Replace `int(est * 100 + 0.5)` with `round(est * 100)` → the `0.395` row reds (Python gives 39 for 39.5; the table says 40). Restore. Change `_serviceable`'s `>=` to `>` → the AT-ceiling row reds. Restore. Re-stamp the marker after every revert that touched ccd/ccd.

- [ ] **Step 6: Commit**

```bash
git add ccd/ccd server/test/fixtures/serviceability.ts server/test/ccd-serviceable.test.ts
git commit -m "feat(routing): _serviceable — the clause in bash over one fixture table with the L0 twin, the twinned constants, the ladder (routing slice 3, Task 3)"
```

---

### Task 4: Placement applies the clause — `_ws_least_loaded project [class]`

**Files:**
- Modify: `ccd/ccd` (`_ws_least_loaded`, ~:4555; re-stamp the marker)
- Test: `server/test/projected-home.test.ts` (remove Task 2's `if (!c.cls)` guard; the bash side runs the five class cases)

**Interfaces:**
- Consumes: Task 3's `_serviceable`; the fixture cases Task 2 added.
- Produces: `_ws_least_loaded [project] [class]` — the second positional is the class; absent or `default` is today's walk byte for byte. No caller passes it in this slice (slice 4's `ws-add --route` will); the parity runner exercises it.

- [ ] **Step 1: Make the bash side run the class cases**

In `projected-home.test.ts`, the bash call becomes `_ws_least_loaded ${JSON.stringify(project)} ${c.cls ?? ''}` (read the runner's existing call and keep its project argument spelling; an empty second argument must read as `default`) and delete the `if (!c.cls)` guard Task 2 added.

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/projected-home.test.ts`
Expected: FAIL on `fable-at-ceiling-is-skipped-even-when-emptiest` and `fable-at-ceiling-on-every-lane-places-nothing` (bash ignores the class and places on `claude-a`).

- [ ] **Step 3: Implement**

In `_ws_least_loaded`, the first lines become:

```bash
_ws_least_loaded() {   # [project] [class] -> the home-able account with the most headroom, or "" if none is placeable
  local pps; pps=$(_project_pool_state "${1-}")
  local cls="${2:-}"
```

and inside the loop, directly after `_pool_ok "$w" "$pps" || continue`:

```bash
    # POOL FIRST, THEN SERVICEABILITY (routing spec §5.4), as a FILTER on
    # eligibility like _pool_ok: a lane measured at the class's ceiling drops out
    # here, before the condemned tier and before scoring; an UNMEASURED lane stays
    # — unmeasured never becomes ineligible — and ranks by its own score. `default`
    # (or no class) is today's walk byte for byte. projectHome (server/src/limits.ts)
    # is the twin; projected-home.test.ts drives both over one fixture table.
    if [[ -n "$cls" && "$cls" != default ]]; then
      _serviceable "$w" "$cls" >/dev/null
      [[ $? -eq 1 ]] && continue
    fi
```

Update the function's header comment where it enumerates the three `|| continue` filters. Re-stamp the marker.

- [ ] **Step 4: Run to verify it passes, plus every suite that calls the placement walk**

Run: `cd server && ./node_modules/.bin/vitest run test/projected-home.test.ts test/ccd-default-pool.test.ts test/ccd-project-pool.test.ts test/projects-route-placement.test.ts test/ccd-ws-add*.test.ts test/ownership.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutation check, measured**

Change `[[ $? -eq 1 ]] && continue` to `[[ $? -ne 0 ]] && continue` (unmeasured dropped) → `fable-unmeasured-stays-eligible…` reds on the bash side. Restore; re-stamp.

- [ ] **Step 6: Commit**

```bash
git add ccd/ccd server/test/projected-home.test.ts
git commit -m "feat(routing): _ws_least_loaded takes a class and applies the serviceability clause after the pool rule (routing slice 3, Task 4)"
```

---

### Task 5: The swap path — stay gates, the two-pass candidate loop, rc 5 and rc 6, the tick's arms, the strand sentence

**Files:**
- Modify: `ccd/ccd` (`_swap_target` ~:13228; `_auto_swap_check` at the `_swap_target` call ~:14031 and the `case "$strc"` ~:14084; `_undecidable_cause` ~:13696; new `_route_degrade`/`_route_restore` beside `_svc_gate`; re-stamp the marker)
- Test: `server/test/ccd-swap-target-class.test.ts` (new); the existing swap suites stay green

**Interfaces:**
- Consumes: `_route_peek id class` (pure, slice 1), `_svc_gate`, `_serviceable`, `_class_below`, `_lc_done route`, `_reg_set`.
- Produces: `_swap_target` rc **5** = nobody can say, the class window (`uword` `classwindow`); rc **6** = a destination on stdout chosen one rung DOWN (every candidate lane measured-unservable at the intended class); `_route_degrade id from to why` and `_route_restore id from to why` (stamp/clear `degraded`, one `route` journal row with `dec.actor ccd`, one `swap.log` line). Task 6 consumes the two helpers.

- [ ] **Step 1: Write the failing tests**

Create `server/test/ccd-swap-target-class.test.ts`:

```ts
// `_swap_target` with a class in the routing record (routing spec §5.4). The
// no-class rows pin byte-identity with today; the class rows pin the three
// answers, rc 5's own word, and rc 6's one-rung degrade — decided on stdout and
// rc only, because a command substitution loses variables (the caller stamps).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, seedAccountsSh, type CcdHarness } from './ccdWsHelpers.js';
import { eventsOf, decOf, NO_TMUX } from './lifecycleHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-swap-class-'); seedAccountsSh(h.home); });
afterEach(() => { h.cleanup(); });

const ID = 'claude-demo';
const now = (): number => Math.floor(Date.now() / 1000);
const limits = (w: string, five: number, seven: number): void => {
  fs.mkdirSync(path.join(h.home, '.cc-limits'), { recursive: true });
  fs.writeFileSync(path.join(h.home, '.cc-limits', `${w}.json`),
    JSON.stringify({ five, seven, ts: now(), fiveResetAt: now() + 10_000, sevenResetAt: now() + 400_000 }));
};
const sweep = (estimates: Record<string, number | null>, ageS = 1): void => {
  const dir = path.join(h.home, '.cc-sessions', 'usage', 'sweep'); fs.mkdirSync(dir, { recursive: true });
  const finishedAt = new Date((now() - ageS) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify({ finishedAt,
    perAccount: Object.fromEntries(Object.entries(estimates).map(([a, e]) => [a, { fableShare: { estimate: e } }])) }));
};
const seedRow = (wrapper = 'claude', cls?: string): void => {
  h.sh(`_reg_set ${ID} wrapper ${wrapper}; _reg_set ${ID} home claude; _reg_set ${ID} project demo; _reg_set ${ID} uuid u${cls ? `; _reg_set ${ID} class ${cls}` : ''}`);
};
/** `_swap_target id cur home force hrc` → "stdout rc=N" */
const target = (cur: string, force = ''): string =>
  h.sh(`out=$(_swap_target ${ID} ${cur} claude '${force}' 0); echo "$out rc=$?"`).trim();

describe('no class: byte-identical to today', () => {
  it('a home under the ceiling stays; a blocked home moves to the least-loaded candidate', () => {
    limits('claude', 10, 10); limits('claude-a', 20, 20); limits('claude-b', 30, 30);
    seedRow('claude');
    expect(target('claude')).toBe(' rc=0');
    limits('claude', 99, 99);
    expect(target('claude')).toBe('claude-a rc=0');
    // the identical calls with class=default answer the same bytes
    h.sh(`_reg_set ${ID} class default`);
    limits('claude', 10, 10); expect(target('claude')).toBe(' rc=0');
    limits('claude', 99, 99); expect(target('claude')).toBe('claude-a rc=0');
  });
});

describe('class fable — the three answers on the swap path', () => {
  it('home servable at the class: stay (rc 0, no destination)', () => {
    limits('claude', 10, 10); limits('claude-a', 20, 20); seedRow('claude', 'fable'); sweep({ claude: 0.1, 'claude-a': 0.1 });
    expect(target('claude')).toBe(' rc=0');
  });

  it('home at the Fable ceiling: MUST LEAVE — the least-loaded servable candidate, rc 0', () => {
    limits('claude', 10, 10); limits('claude-a', 20, 20); limits('claude-b', 30, 30); seedRow('claude', 'fable');
    sweep({ claude: 0.45, 'claude-a': 0.5, 'claude-b': 0.2 });
    expect(target('claude')).toBe('claude-b rc=0');
  });

  it('home unmeasured for the class: rc 5, nothing on stdout, never a move and never a degrade', () => {
    limits('claude', 10, 10); limits('claude-a', 20, 20); seedRow('claude', 'fable'); sweep({ 'claude-a': 0.1 });   // no row for home
    expect(target('claude')).toBe(' rc=5');
  });

  it('every candidate MEASURED at the ceiling: rc 6 with the destination chosen one rung down (opus = the seven-day figure)', () => {
    limits('claude', 99, 99); limits('claude-a', 20, 20); limits('claude-b', 30, 30); seedRow('claude', 'fable');
    sweep({ claude: 0.5, 'claude-a': 0.5, 'claude-b': 0.6 });
    expect(target('claude')).toBe('claude-a rc=6');
  });

  it('no servable candidate and at least one UNMEASURED: rc 5 — nobody degrades on a fabricated fact', () => {
    limits('claude', 99, 99); limits('claude-a', 20, 20); limits('claude-b', 30, 30); seedRow('claude', 'fable');
    sweep({ claude: 0.5, 'claude-a': 0.5 });   // claude-b has no row
    expect(target('claude')).toBe(' rc=5');
  });

  it('on the degrade pass an unmeasured seven-day figure ranks LAST but stays eligible — the degrade was decided on measured refusals', () => {
    // claude-a has no limits file at all: _avail admits it (unknown is available), pass 1 refuses it at the Fable
    // ceiling (measured), pass 2 asks opus and reads no figure — eligible, ranked 100, so the measured claude-b wins.
    limits('claude', 99, 99); limits('claude-b', 30, 30); seedRow('claude', 'fable');
    sweep({ claude: 0.5, 'claude-a': 0.5, 'claude-b': 0.6 });
    expect(target('claude')).toBe('claude-b rc=6');
    // and when claude-a is the ONLY candidate left at the rung below (claude-b now refused by _avail before any
    // class question), it is taken rather than stranding the session
    limits('claude-b', 99, 99);
    expect(target('claude')).toBe('claude-a rc=6');
  });

  it('a candidate at the seven-day ceiling is refused by _avail before the class is even asked (rc unchanged from today)', () => {
    limits('claude', 99, 99); limits('claude-a', 99, 99); limits('claude-b', 30, 30); seedRow('claude', 'fable');
    sweep({ claude: 0.5, 'claude-a': 0.1, 'claude-b': 0.1 });
    expect(target('claude')).toBe('claude-b rc=0');
  });
});

describe('the tick spends rc 5 and rc 6', () => {
  it('rc 5 stands still with its OWN word: classwindow, never crosspool/project/pool', () => {
    limits('claude', 99, 99); limits('claude-a', 20, 20); seedRow('claude', 'fable'); sweep({ 'claude-a': 0.5 });
    // Drive the tick the way ccd-crosspool.test.ts drives its undecidable cases: a stubbed tmux whose pane text is a
    // rate-limit banner (hard-blocked), so the strand marker is written with the sentence. Copy that file's pane stub
    // and `_auto_swap_check ${ID}` invocation verbatim (its `PANE_PID`, `sessions/<pid>.json` and notify.sh planting).
    // Then:
    const log = fs.readFileSync(path.join(h.home, '.cc-sessions', 'swap.log'), 'utf8');
    expect(log).toContain(`tick-undecidable ${ID}: classwindow`);
    expect(fs.readFileSync(path.join(h.home, '.cc-sessions', `${ID}.stranded`), 'utf8'))
      .toContain('the per-class window for the session\'s class could not be measured');
    expect(log).not.toMatch(/auto-rescue|dispatch /);
  });

  it('rc 6 stamps `degraded`, journals a route row with actor ccd, and dispatches to the destination', () => {
    limits('claude', 99, 99); limits('claude-a', 20, 20); seedRow('claude', 'fable'); sweep({ claude: 0.5, 'claude-a': 0.5 });
    // same hard-blocked drive as above, with `_dispatch_swap` stubbed to log: `_dispatch_swap() { echo "dispatch $1 -> $2" >> "$REG/swap.log"; }`
    expect(h.reg(ID, 'degraded')).toBe('opus');
    const rows = eventsOf(h.home, 'route');
    expect(rows.length).toBe(1);
    expect(decOf(rows[0]!)).toMatchObject({ actor: 'ccd' });
    expect(String(rows[0]!['detail'])).toBe('degraded: ∅ -> opus');
    expect(fs.readFileSync(path.join(h.home, '.cc-sessions', 'swap.log'), 'utf8')).toMatch(/degrade claude-demo: fable -> opus/);
    expect(fs.readFileSync(path.join(h.home, '.cc-sessions', 'swap.log'), 'utf8')).toContain('dispatch claude-demo -> claude-a');
  });
});
```

Read `ccd-crosspool.test.ts`'s undecidable-word cases (`grep -n 'tick-undecidable' server/test/ccd-crosspool.test.ts`) and lift their pane/notify/session-json setup verbatim into a local helper; the two tick tests above depend on it. `h.reg(id, field)` and `eventsOf`/`decOf` exist (`ccdWsHelpers.ts`, `lifecycleHelpers.ts`).

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-swap-target-class.test.ts`
Expected: the no-class describe passes; every class case fails (today's `_swap_target` ignores the record).

- [ ] **Step 3: Implement in `ccd/ccd`**

(a) Beside `_svc_gate` add the two writers (the ONLY writers of `degraded`):

```bash
_route_degrade() {   # id from to why — stamp `degraded=<to>` and say so: one route journal row (actor ccd), one swap.log line
  local id="$1" from="$2" to="$3" why="$4" old
  old=$(_route_get "$id" degraded)
  [[ "$old" == "$to" ]] && return 0                          # standing already: nothing to write, nothing to say twice
  _reg_set "$id" degraded "$to" || return 1
  _lc_done route "$id" "" dec.actor ccd dec.reason "$why" detail "degraded: ${old:-∅} -> $to"
  echo "$(date '+%F %T') degrade $id: $from -> $to ($why)" >> "$REG/swap.log"
}

_route_restore() {   # id from to why — clear `degraded` (the intended class `to` is served again) and say so
  local id="$1" from="$2" to="$3" why="$4"
  [[ -e "$REG/$id.degraded" ]] || return 0
  rm -f -- "$REG/$id.degraded"
  _lc_done route "$id" "" dec.actor ccd dec.reason "$why" detail "degraded: $from -> ∅"
  echo "$(date '+%F %T') restore $id: $from -> $to ($why)" >> "$REG/swap.log"
}
```

(b) `_swap_target`: extend the header comment's rc list with `5 = NOBODY CAN SAY, the class window; 6 = a name, chosen one rung DOWN`. After the `local id=… obest_score=999 sc` line add:

```bash
  # THE CLASS DIMENSION (routing spec §5.4). Read PURE — `_route_peek` writes no
  # note and no floor marker; a decision function that may return before acting
  # must not leave a trail (slice 1, fix round 2). `default` and no record are
  # the same thing here: today's walk, byte for byte — every rc-2/3/4 pin in the
  # pool suites holds by construction because nothing below runs without `cls`.
  local cls src pass pcls unserv unmeas
  cls=$(_route_peek "$id" class); [[ "$cls" == default ]] && cls=""
```

The three stay shortcuts become gated (each is measured by `ccd-swap-target-class.test.ts`):

```bash
  if [[ "$hrc" -eq 0 && "$cur" == "$home" ]]; then
    if [[ -z "$force" ]] && _avail "$home"; then                                 # home is fine: stay — if it can serve the class
      _svc_gate "$home" "$cls"; src=$?
      [[ "$src" -eq 0 ]] && return 0
      [[ "$src" -eq 2 ]] && return 5                                             # unmeasured: nobody decides; the next tick tries again
    fi                                                                           # 1: home is at the class's ceiling — must leave; fall through
  else
    if [[ "$hrc" -eq 0 ]] && _account_ok "$home" && { [[ -n "$cross_home" ]] || _pool_ok "$home" "$pps"; } && _avail "$home"; then
      _svc_gate "$home" "$cls"; src=$?                                           # home recovered: go back — if it can serve the class
      [[ "$src" -eq 0 ]] && { echo "$home"; return 0; }
      [[ "$src" -eq 2 ]] && return 5
    fi
    if [[ -z "$force" ]] && _avail "$cur"; then                                  # cur still works, home down: stay put — if it can serve the class
      _svc_gate "$cur" "$cls"; src=$?
      [[ "$src" -eq 0 ]] && return 0
      [[ "$src" -eq 2 ]] && return 5
    fi
  fi
```

(keep every existing comment those lines carry — move them, do not delete them). The candidate loop is wrapped in two passes; the body is today's body plus one gate after `_avail "$cand" || continue`:

```bash
  # TWO PASSES, ONE BODY. Pass 1 ranks the candidates that can serve the
  # intended class. If it finds nothing and every refusal was MEASURED
  # (unserv > 0, unmeas == 0), pass 2 re-ranks one rung DOWN and answers rc 6 —
  # the caller stamps `degraded` and dispatches. If any refusal was UNMEASURED
  # and nothing was found, the answer is rc 5: nobody degrades on a fabricated
  # fact. No class: one pass, byte-identical to today.
  for pass in 1 2; do
    pcls="$cls"; [[ "$pass" -eq 2 ]] && pcls=$(_class_below "$cls")
    unserv=0; unmeas=0
    for cand in $(_pool_for "$id"); do
      …today's body up to and including `_avail "$cand" || continue`…
      if [[ -n "$pcls" ]]; then
        _serviceable "$cand" "$pcls" >/dev/null
        case $? in
          1) unserv=$((unserv + 1)); continue ;;
          # UNMEASURED BLOCKS ONLY THE INTENDED CLASS. On pass 1 an unmeasured
          # lane means nobody can say whether to degrade — rc 5 below. On pass 2
          # the degrade was ALREADY decided on measured refusals; what remains is
          # placement at the rung below, where the placement rule holds:
          # unmeasured never becomes ineligible, it ranks last (sc 100 below).
          2) [[ "$pass" -eq 1 ]] && { unmeas=$((unmeas + 1)); continue; } ;;
        esac
      fi
      …today's body from `sc=$(_limit_score "$cand")` to the end of the loop…
    done
    [[ -n "$best$obest" ]] && break                                              # found at this class
    [[ -z "$cls" ]] && break                                                     # no class: nothing more to try
    [[ "$unmeas" -gt 0 ]] && return 5                                            # a lane nobody measured: nobody decides
    [[ "$unserv" -eq 0 || "$pass" -eq 2 ]] && break                              # nothing to degrade from, or already degraded once
    [[ -z "$(_class_below "$cls")" ]] && break                                   # haiku has no rung below
  done
  if [[ -n "$best" ]]; then echo "$best"; elif [[ -n "$obest" ]]; then echo "$obest"; else return 1; fi
  [[ "$pass" -eq 2 ]] && return 6
  return 0
```

(`_pool_for`'s single `cat` per call becomes two on the degrade pass only — say so in the comment.) The `SWAP_CEILING` refusal in `_avail` still runs first, so the seven-day figure never reaches pass 2 as a class question for opus/sonnet/haiku — which is why one rung always resolves for a fable session and why `pass 2` re-asking `_serviceable … opus` is a formality that keeps the two passes one body.

(c) `_auto_swap_check`, at the call:

```bash
  target=$(_swap_target "$id" "$wrapper" "$home" "$hard_blocked" "$hrc"); strc=$?
  # rc 6 IS A DECISION, handled BEFORE the `-ge 2` undecidable guard (routing
  # spec §5.4): a destination chosen one rung DOWN because every lane was
  # measured-unservable at the intended class. The rung is re-derived here
  # (`_class_below` is deterministic and `_swap_target` writes nothing), the
  # stamp and the journal row are written by the ONE writer, and the move
  # proceeds exactly as an rc 0 move would.
  if [[ "$strc" -eq 6 ]]; then
    local icls; icls=$(_route_peek "$id" class)
    _route_degrade "$id" "$icls" "$(_class_below "$icls")" "unservable: $icls at or above the ceiling on every candidate lane"
    strc=0
  fi
  if [[ "$strc" -ge 2 ]]; then
```

and in the `case "$strc"`: `5) uword=classwindow ;;   # the class window — the sweep's share for fable, the seven-day figure otherwise — on the lanes that could take the session`.

(d) `_undecidable_cause`: `classwindow) printf '%s' "the per-class window for the session's class could not be measured on the lanes that could take it ($REG/usage/sweep/latest.json for fable, $LIMITS_DIR/<lane>.json otherwise), so no destination could be computed" ;;`

Re-stamp the marker.

- [ ] **Step 4: Run to verify they pass, plus every swap suite**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-swap-target-class.test.ts test/ccd-auto-swap-pool.test.ts test/ccd-crosspool.test.ts test/ccd-default-pool.test.ts test/swap-route-pool.test.ts test/ccd-backend-vs-placement.test.ts test/ownership.test.ts`
Expected: PASS — the no-class suites byte-identical (`ccd-crosspool` and `ccd-session-state` are load flakes: isolate before calling real).

- [ ] **Step 5: Mutation check, measured**

Collapse rc 5 into rc 1 (`[[ "$unmeas" -gt 0 ]] && return 1`) → "at least one UNMEASURED: rc 5" reds (spec §8 row 12's mutation). Restore. Delete the rc 6 arm in the tick → the rc 6 tick test reds (no stamp; the `-ge 2` guard strands it with `rc6`). Restore. Re-stamp after each.

- [ ] **Step 6: Commit**

```bash
git add ccd/ccd server/test/ccd-swap-target-class.test.ts
git commit -m "feat(routing): _swap_target routes by class — stay gates, two-pass ranking, rc 5 (classwindow) and rc 6 (one rung down); the tick stamps degraded (routing slice 3, Task 5)"
```

---

### Task 6: The settle composes the class served, restores the intended class, and never degrades on a fabricated fact

**Files:**
- Modify: `ccd/ccd` (`_spawn_start`'s routing block, ~:15112-15125; re-stamp the marker)
- Test: `server/test/ccd-route-degrade.test.ts` (new); `server/test/ccd-route-spawn.test.ts` stays green

**Interfaces:**
- Consumes: Task 3's `_serviceable`, `_class_below`; Task 5's `_route_degrade`/`_route_restore`; `_route_get id degraded`.
- Produces: at every settle (spawn, resume, swap relaunch) `--model` is the class SERVED; `degraded` is cleared when the lane can serve the intended class, stamped when it measures unservable, untouched when unmeasured.

- [ ] **Step 1: Write the failing tests**

Create `server/test/ccd-route-degrade.test.ts` (the harness, `RESUME_DIES`, `spawnBoth`, `composed`, `today` are `ccd-route-spawn.test.ts`'s — copy them; they are module-local there):

```ts
describe('_spawn_start composes the class SERVED (routing spec §5.4 last paragraph, §5.1 degraded)', () => {
  const limits = …; const sweep = …;   // as in ccd-swap-target-class.test.ts
  const expectModel = (line: string, model: string | null): void => {
    if (model === null) expect(line).not.toContain('--model');
    else expect(line).toContain(`--model ${model} `);
  };

  it('class fable on a lane at the Fable ceiling: --model opus on BOTH lines, degraded=opus stamped, one route row (actor ccd)', () => {
    seed('myid'); h.sh('_reg_set myid class fable'); sweep({ claude: 0.5 });
    const [p, r] = spawnBoth('myid');
    expectModel(p, 'opus'); expectModel(r, 'opus');
    expect(h.reg('myid', 'degraded')).toBe('opus');
    const rows = eventsOf(h.home, 'route'); expect(rows).toHaveLength(1);
    expect(String(rows[0]!['detail'])).toBe('degraded: ∅ -> opus');
  });

  it('a standing degraded=opus on a lane that can serve fable again: --model fable, the stamp cleared, a restore row', () => {
    seed('myid'); h.sh('_reg_set myid class fable; _reg_set myid degraded opus'); sweep({ claude: 0.1 });
    const [p] = spawnBoth('myid');
    expectModel(p, 'fable');
    expect(h.reg('myid', 'degraded')).toBeNull();
    expect(String(eventsOf(h.home, 'route')[0]!['detail'])).toBe('degraded: opus -> ∅');
  });

  it('a standing stamp with the lane UNMEASURED: the stamp stays (it was measured when written), --model opus, no new row', () => {
    seed('myid'); h.sh('_reg_set myid class fable; _reg_set myid degraded opus');   // no sweep file
    const [p] = spawnBoth('myid');
    expectModel(p, 'opus');
    expect(h.reg('myid', 'degraded')).toBe('opus');
    expect(eventsOf(h.home, 'route')).toHaveLength(0);
  });

  it('no stamp and the lane UNMEASURED: the intended class is composed and nothing is stamped', () => {
    seed('myid'); h.sh('_reg_set myid class fable');
    const [p] = spawnBoth('myid');
    expectModel(p, 'fable');
    expect(h.reg('myid', 'degraded')).toBeNull();
  });

  it('class opus on a lane whose seven-day figure is at the ceiling: --model sonnet, degraded=sonnet', () => {
    seed('myid'); h.sh('_reg_set myid class opus'); limits('claude', 10, 98);
    const [p] = spawnBoth('myid');
    expectModel(p, 'sonnet'); expect(h.reg('myid', 'degraded')).toBe('sonnet');
  });

  it('a degrade to haiku drops the effort the record names (haiku takes none) and journals the pair note, not --effort', () => {
    seed('myid'); h.sh('_reg_set myid class sonnet; _reg_set myid effort high'); limits('claude', 10, 98);
    const [p] = spawnBoth('myid');
    expectModel(p, 'haiku'); expect(p).not.toContain('--effort');
  });

  it('the same stamp twice writes one row: a second settle on the same unservable lane is silent', () => {
    seed('myid'); h.sh('_reg_set myid class fable'); sweep({ claude: 0.5 });
    spawnBoth('myid'); h.sh('rm -f "$HOME/pane-up"'); h.sh(`${RESUME_DIES} _spawn_start myid resume 2>/dev/null`);
    expect(eventsOf(h.home, 'route')).toHaveLength(1);
  });

  it('class default and no record: byte-identical to today, nothing read, nothing stamped', () => {
    seed('myid'); sweep({ claude: 0.9 }); limits('claude', 99, 99);
    const [p, r] = spawnBoth('myid');
    expect(p).toBe(today(`--resume '${UUID}'`)); expect(r).toBe(today(`--session-id '${UUID}'`));
    expect(h.reg('myid', 'degraded')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-route-degrade.test.ts`
Expected: FAIL — `--model fable` composed on the ceiling case, no stamp.

- [ ] **Step 3: Implement**

In `_spawn_start`'s routing block, replace

```bash
    rclass=$(_route_get "$id" class); reff=$(_route_effort_for "$id" "$rclass")
```

with

```bash
    rclass=$(_route_get "$id" class)
    # THE CLASS SERVED (routing spec §5.4, last paragraph; §5.1 `degraded`). The
    # intended class stays in `class`; THIS settle re-measures the lane it is
    # landing on and decides what to compose: servable → clear a standing stamp
    # (the intended class is restored the moment a lane can serve it); measured
    # unservable → stamp one rung down and compose that; UNMEASURED → compose
    # what stands (a standing stamp was measured when written; no stamp means
    # the intended class) and write nothing — nobody degrades on a fabricated
    # fact. `_route_degrade`/`_route_restore` are the only writers and write
    # once: a second settle on the same lane says nothing twice.
    local rdeg="" below srv
    if [[ -n "$rclass" && "$rclass" != default ]]; then
      rdeg=$(_route_get "$id" degraded)
      _serviceable "$wrapper" "$rclass" >/dev/null; srv=$?
      case "$srv" in
        0) [[ -n "$rdeg" ]] && _route_restore "$id" "$rdeg" "$rclass" "servable: $rclass on $wrapper at settle"; rdeg="" ;;
        1) below=$(_class_below "$rclass")
           if [[ -n "$below" ]]; then
             _route_degrade "$id" "$rclass" "$below" "unservable: $rclass at or above the ceiling on $wrapper at settle"
             rdeg="$below"
           fi ;;
      esac
      [[ -n "$rdeg" ]] && rclass="$rdeg"
    fi
    reff=$(_route_effort_for "$id" "$rclass")   # keyed on the class SERVED: a rung down to haiku takes no effort
```

Keep the existing `[[ -n "$rclass" && "$rclass" != default ]] && routeflags="--model $rclass"` line as it is — `rclass` now holds the class served. Re-stamp the marker.

- [ ] **Step 4: Run to verify they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-route-degrade.test.ts test/ccd-route-spawn.test.ts test/ccd-spawn-split.test.ts test/ccd-route-settle.test.ts test/ccd-redrive.test.ts test/ownership.test.ts`
Expected: PASS — `ccd-route-spawn`'s `class opus` case has no limits file, reads `unmeasured`, composes `opus` as before.

- [ ] **Step 5: Mutation check, measured**

Make the `2)` (unmeasured) path stamp anyway (add `2) below=$(_class_below "$rclass"); _route_degrade …` ) → "no stamp and the lane UNMEASURED" reds. Restore. Drop the `_route_restore` call → the restore case reds. Restore. Re-stamp after each.

- [ ] **Step 6: Commit**

```bash
git add ccd/ccd server/test/ccd-route-degrade.test.ts
git commit -m "feat(routing): the settle composes the class served — degraded stamped, restored, or left alone by what the lane measures (routing slice 3, Task 6)"
```

---

### Task 7: Read the fleet's Fable shares, ship agent-first, measure the gate

**Files:**
- Modify: `docs/superpowers/specs/2026-09-13-effort-model-orchestration-research.md` §6 (two rows)

- [ ] **Step 1: The full suites, in chunks**

From `server/`, foreground, `timeout 600000` each, `--maxWorkers=2`: `test/[a-c]*.test.ts`, `test/[d-l]*.test.ts`, `test/[m-r]*.test.ts`, `test/[s-z]*.test.ts`; then `cd agent && npm run test`; `cd pwa && npm run test`. Load flakes re-run in isolation. `git fetch origin main` then `test/deviation-refs.test.ts test/dtbd.test.ts`.

- [ ] **Step 2: The fleet's measured Fable shares (read-only)**

On the fleet host, read `~/.cc-sessions/usage/sweep/latest.json`'s `finishedAt` and every `perAccount.<id>.fableShare` (`estimate`, `sevenPct`, `unpricedClasses`) with `python3 -c`, printing account ids only (no labels, no identity). Record them as a research-note §6 row "Fable share by account at slice 3", with the sentence: the 40% default stands; the operator sets the ceiling from these figures (spec §5.4). If any Anthropic lane is at or above 40, say which and what slice 3 will now do for a `class: fable` session on it.

- [ ] **Step 3: Push and open the PR**

Push the branch; `gh pr create` against `main` with a hand-written body (what slice 3 ships, the two rc codes, the twinned constants, the gate), ending with the attribution line the session reminder specifies. Never merge, approve or request review — the operator's word merges it.

- [ ] **Step 4: Deploy, agent lane first**

`bash deploy/deploy.sh agent` (ccd), then `bash deploy/deploy.sh` (server: `readSharesMeasured`, `projectHome`). `/health` reports the shipped sha.

- [ ] **Step 5: Measure the gate — "a Fable session measured surviving a swap without touching credits"**

On the fleet host, read-only first: `ccd caps` still lists `route`; `_serviceable <this session's lane> fable` (via `bash -c 'source ~/.local/bin/ccd; …'` — read-only; if sourcing ccd is not how the suites do it on the box, read the share with the Step 2 python instead and apply the rule by hand). ONLY if the controller's own lane reads `servable` for `fable`: write `ccd route --session <own id> --set class=fable --actor operator --reason 'slice 3 gate'` on the controller's OWN session (the operator started it on Fable; `class=fable` composes what the lane already serves). If the lane reads `unservable` or `unmeasured`, do NOT write the field — a degrade would change the operator's own session's model without their word — and record the gate as PENDING with the reason. Then wait for the next NATURAL settle or swap (never force one) and read: the `route`/`swap` journal rows, `swap.log`, the new process's argv (`/proc/<pane pid>/cmdline` — ccd writes no argv to the unit journal), and the lane's `.cc-limits` row before and after (no credits: the `seven` figure moved by the turn, nothing else). Record in §6 with timestamps; PENDING is an honest row.

- [ ] **Step 6: Commit the rows**

```bash
git add docs/superpowers/specs/2026-09-13-effort-model-orchestration-research.md
git commit -m "docs(research): slice 3 — the fleet's Fable shares, the serviceability gate (routing slice 3, Task 7)"
```

---

## Deviations found

None at plan time. Numbers are issued by the allocator during execution and defined here in the same act.

## Carried to later slices

- **Placement's one-rung fallback and the stamp after mint** (spec §5.4 "Placement for fresh spawns applies the same clause"): `_ws_least_loaded project class` FILTERS in this slice; when every lane is unservable it places nothing (`""`, `null`). Slice 4, which passes the class on `ws-add --route`, adds the rung-down retry and stamps `degraded` on the minted row, and gives `projectPlacement`/the PWA's `+` the class.
- **The live `/model` lever** (slice 4, D-2811): a degrade today lands only at a relaunch; a running session stays on its class until its next settle.
- **The ceiling's number** is the operator's; Task 7 reports the measured shares and changes nothing.
- **`_pool_for` is read twice on a degrade pass** — one `cat` more, on the rare path; a later slice may hoist it if the tick's cost is ever measured to matter.
- Slice 2's parked rulings on the references (S2-R3..S2-R6) are this branch's, not this plan's; the slice that next touches `review-panel.md`/`routing-matrix.md` lands them.

## Self-review against the spec

- §5.4 three answers, never two: Task 1's union, Task 3's four exit codes, Task 5's rc 5 — and the fixture table covers every answer and every why-word (its "guards the guard" case). ✓
- §5.4 rc 5 with its own `uword` for `_undecidable_cause`'s sentence — Task 5 (`classwindow`); reusing 2/3/4 is refused by the test's `.toContain('classwindow')`. ✓
- §5.4 the Fable ceiling, 40 default, "set by slice 3 from the first week of measured share" — Task 1's constant, Task 7's measured row; the operator moves the number. ✓
- §5.4 where the per-class figure comes from (the sweep's per-account estimate, labelled a proxy; `seven_day` for the others) — Tasks 1–3. ✓
- §5.4 placement applies the same clause; the predicate defined once in `shared/` with a bash mirror and a parity test, pool first then serviceability — Tasks 1–4. ✓
- §5.4 last paragraph: relaunch after a swap passes `--model` from the fields (slice 1) and the intended class is restored at the next settle on a lane that can serve it — Task 6. ✓
- §5.1 `degraded` written by ccd only, journaled — Task 5's two writers, `cmd_route` already refuses it. ✓
- §8 row 11 (parity: change the bash mirror alone → the parity test) — Task 3's table runs both sides over the same bytes; row 12 (collapse unmeasured into unservable → the fixture with an absent bucket degrades) — Task 5's rc-5 test and Task 6's unmeasured cases. ✓
- Placeholder scan: every function, test and constant is spelled; the two tick tests name the file whose setup they copy (`ccd-crosspool.test.ts`) rather than restating 80 lines of pane stubs — a pointer to code in the tree, not a TBD. ✓
- Type consistency: `Serviceability`'s five members, `LaneFacts`, `ShareReading`, `SharesRead`, `sevenOf`, `shareFor`, `_serviceable`'s rc/stdout contract, `_svc_gate`, `_class_below`, `_route_degrade`/`_route_restore` are spelled identically across Tasks 1–6. ✓
