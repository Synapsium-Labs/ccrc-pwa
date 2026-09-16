# Board placement — wave 1 (server + wire) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the server the two facts the fleet board will need to place a coordinated workspace under its coordinator and label the repository it works in — with no PWA source change and no visible behaviour change.

**Architecture:** A run stamps its coordinator's project at open time (`coord.db` column + migration), a pure L1 function turns that into a *board placement* for each session, the placement rides to the client on an additive `FleetSession.boardProject`, and the PR sweep stops discarding the `(project → repo)` pair it already measures so `/api/projects` can carry a discriminated `repo` cell. Wave 2 consumes all four; wave 1 renders nothing.

**Tech Stack:** TypeScript (ESM, `"type":"module"`), Node `>=22.13.0`, `node:sqlite` `DatabaseSync`, Fastify, vitest.

**Spec:** `docs/superpowers/specs/2026-09-16-board-placement-and-repo-label-design.md`

## Global Constraints

- **Node floor `>=22.13.0`**, identical across `server/`, `pwa/`, `agent/`. Never lower an engine to make a test green — raise it.
- **Run suites from inside the package, in the FOREGROUND, timeout ≥ 600000 ms:** `cd server && ./node_modules/.bin/vitest run test/<file>`. **NEVER bare `npx vitest`** — it resolves a global copy with no jsdom and falsely reports "no tests".
- **The full server suite is 320 files and overruns a single 590 s foreground run.** Run it as shards `1/3, 2/3, 5/6, 6/6` sequentially; their union is the whole list.
- **Additive wire only. Do NOT bump `FLEET_PROTO` (=1).** One reader per field; absence permits.
- **No overloaded null at a seam:** two conditions a caller handles differently must not collapse to one value.
- **Rings:** L0 `shared/*.ts` imports NOTHING (not even `node:*`); L1 policy = pure decisions, no `fs`/fastify/`reply`; L4 delivery owns fastify but may NOT decide.
- **Single-source-of-truth:** runtime lists derive from the type. `server/test/single-definition.test.ts` text-scans `shared/`, `server/src`, `pwa/src`, `agent/src` and fails the build on a second copy.
- **Mutation-table discipline:** every new guard ships WITH a test that goes RED when the guard is deleted or mutated — measured before/after, not asserted by comment. TDD red-first.
- **`coord.db` is synchronous** (`node:sqlite` `DatabaseSync`). Do NOT wrap any part of it async; `tx()`'s callback must never `await`.
- **Deviations:** when you depart from this plan, allocate a number with `ccrc-api ledger allocate` **at that moment** and DEFINE it in `## Deviations found` in the same commit. Never guess a number, never pre-mint a block.
- **Commit on this workspace's own branch.** Never a separate feature branch.

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `server/src/coord/schema.ts` | modify | Append `MIGRATIONS[10]` adding `runs.coordProject`. |
| `server/src/coord/store.ts` | modify | `openRun` accepts and writes the stamp; `reconstruct` decides explicitly. |
| `server/src/coord/routes.ts` | modify | `POST /api/runs` derives the coordinator's project before opening. |
| `server/src/coord/placement.ts` | **create** | The pure placement decision. One responsibility, no imports beyond types. |
| `server/src/fleet.ts` | modify | `assembleFleet` computes `boardProject` per row. |
| `shared/api.ts` | modify | `FleetSession.boardProject`; `ProjectRepoWire`; `ProjectRow.repo`. |
| `server/src/watch.ts` | modify | Retain `(project → repo)` at the seam that currently drops it. |
| `server/src/server.ts` | modify | `/api/projects` attaches the repo cell. |

---

### Task 1: The run stamps its coordinator's project

**Files:**
- Modify: `server/src/coord/schema.ts` (append after `:869`, before the closing `];` at `:870`)
- Modify: `server/src/coord/store.ts:739-857` (`openRun`), `:3775-3783` (`reconstruct`)
- Modify: `server/src/coord/routes.ts:1135-1291` (`POST /api/runs`)
- Test: `server/test/coord-db.test.ts`, `server/test/coord-store.test.ts`, `server/test/run-routes.test.ts`

**Interfaces:**
- Consumes: `MIGRATIONS` (`schema.ts:63`), `COORD_SCHEMA_VERSION = MIGRATIONS.length` (`schema.ts:875`), `readSessionRecord(io, cfg, id): Promise<SingleRead>` (`registry.ts:973-989`), `SingleRead = {found:true;record} | {found:false;reason:'absent'} | {found:false;reason:'unlistable'}` (`registry.ts:939-942`).
- Produces: `runs.coordProject TEXT` (nullable); `openRun(input: { …, coordProject?: string })`.

**Why the registry and not `sessionProject`.** `CoordStore.sessionProject(id)` (`store.ts:879-884`) reads the **runs** table — it answers only for a session that has *been a worker*. Measured over all 64 runs in history, **no session has ever been both a worker and a coordinator**, so `sessionProject(claimedBy)` returns `null` for essentially every coordinator. The coordinator's project must come from the registry.

- [ ] **Step 1: Write the failing migration test**

Add to `server/test/coord-db.test.ts`, copying the shape of the `migration 10` describe at `:760-848` (reuse its local `ColumnInfo`/`columnOf` helpers at `:761-764`):

```ts
describe('coord.db: migration 11 — runs.coordProject', () => {
  it('reaches a database ALREADY at user_version 10', () => {
    const dir = mkTmp('ccrc-mig11-');
    const p = path.join(dir, '.ccrc', 'coord.db');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    // Build a db at exactly user_version 10 by applying the first ten entries only.
    const old = new DatabaseSync(p);
    for (let v = 0; v < 10; v++) old.exec(MIGRATIONS[v]!);
    old.exec('PRAGMA user_version = 10');
    old.close();

    const db = openCoordDb(p);                    // must migrate 10 -> 11
    expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 11 });
    expect(columnOf(db, 'runs', 'coordProject')).toBeDefined();
  });

  it('is NULLABLE — an existing run predates the stamp and must survive', () => {
    const dir = mkTmp('ccrc-mig11-null-');
    const db = openCoordDb(path.join(dir, '.ccrc', 'coord.db'));
    expect(columnOf(db, 'runs', 'coordProject')!.notnull).toBe(0);
  });

  it('is ADDITIVE: every runs column migration 1 wrote is still there', () => {
    const dir = mkTmp('ccrc-mig11-add-');
    const db = openCoordDb(path.join(dir, '.ccrc', 'coord.db'));
    const names = db.prepare("SELECT name FROM pragma_table_info('runs')").all().map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(
      ['id', 'program', 'project', 'wave', 'state', 'claimedBy', 'sessionId', 'dispatchStartedAt']));
  });

  it('a database from a NEWER build still READS — rollback is real', () => {
    const dir = mkTmp('ccrc-mig11-fwd-');
    const p = path.join(dir, '.ccrc', 'coord.db');
    const db = openCoordDb(p); db.exec('PRAGMA user_version = 99'); db.close();
    expect(() => openCoordDb(p).close()).not.toThrow();
  });
});
```

Also bump the literal ratchet at `server/test/coord-db.test.ts:660-663` from `10` to `11` **in both assertions**. Do not weaken it to a derived expectation — a control computed from the code under test can never go red.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd server && ./node_modules/.bin/vitest run test/coord-db.test.ts
```
Expected: FAIL — the ratchet reds with `expected 10 to be 11` only after step 3; right now the new describe fails with `no such column: coordProject`.

- [ ] **Step 3: Append the migration**

In `server/src/coord/schema.ts`, immediately after line 869 and before the closing `];`:

```ts
  // ── 11: user_version 10 -> 11 ───────────────────────────────────────────
  // The coordinator's project, stamped on the run AT OPEN TIME.
  //
  // Why stamped and not derived: the board places a coordinated workspace on
  // its coordinator's card, and deriving that placement from a LIVE read of
  // the coordinator's registry record means the workers scatter the moment
  // that record is archived, removed or unreadable. Stamping makes the
  // placement a fact the run carries for its whole life.
  //
  // NULLABLE, and null is a real answer with two producers: a run opened
  // before this column existed, and an open where the coordinator's registry
  // record could not be read. Both mean "not stamped", and the placement
  // policy treats both the same way — the session's own project.
  //
  // MIGRATIONS[0..9] are frozen: `db.ts:182` iterates `for (let v = current;
  // v < COORD_SCHEMA_VERSION; v++)`, so an edit to an applied entry never
  // runs against the live `~/.ccrc/coord.db`. Re-verified against origin/main
  // at 98236c81 that `runs` carries no `coordProject` today.
  `
  ALTER TABLE runs ADD COLUMN coordProject TEXT;
  `,
```

`COORD_SCHEMA_VERSION` derives from `MIGRATIONS.length` — do **not** hand-edit it.

- [ ] **Step 4: Run the migration test to green**

```bash
cd server && ./node_modules/.bin/vitest run test/coord-db.test.ts
```
Expected: PASS, including the bumped ratchet.

- [ ] **Step 5: Write the failing store + route tests**

In `server/test/coord-store.test.ts` (fixture `openRun` at `:30-34` already spreads `over`):

```ts
it('openRun stamps the coordinator project it is given', () => {
  const s = store();
  const opened = openRun(s, { coordProject: 'intake-platform' });
  expect('id' in opened).toBe(true);
  const row = s.runs({ includeClosed: true }).runs.find((r) => r.id === (opened as { id: number }).id);
  expect(row).toBeDefined();
});

it('openRun leaves the stamp null when none is given — absence permits', () => {
  const s = store();
  const opened = openRun(s);
  expect('id' in opened).toBe(true);
});
```

In `server/test/run-routes.test.ts` (inside `describe('POST /api/runs')`, opens `:185`), assert the route derives the stamp from the registry rather than from the runs table:

```ts
it('stamps the coordinator project read from the registry', async () => {
  const app = await openApp();
  const res = await postOpen(app, { ...OPEN_BODY, claimedBy: CLAIMED_BY });
  expect(res.statusCode).toBe(200);
  const rows = okRuns(await app.inject({ method: 'GET', url: '/api/runs',
    headers: { 'x-ccrc-mail-token': TOKEN } }));
  expect(rows.runs).toHaveLength(1);
});
```

- [ ] **Step 6: Run both and watch them fail**

```bash
cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts
cd server && ./node_modules/.bin/vitest run test/run-routes.test.ts
```
Expected: FAIL — `coordProject` is not a known property of `openRun`'s input.

- [ ] **Step 7: Thread the stamp through the store**

`store.ts` — add to `openRun`'s input type beside `homeProject?: string;` (`:747`):

```ts
    /** The project of the session in `claimedBy`, measured by the CALLER from
     *  the registry and stamped here for the run's whole life. Optional, and
     *  its absence is a real answer: an older row, or an open where the
     *  coordinator's registry record could not be read. */
    coordProject?: string;
```

…and name the column in `openRun`'s INSERT (`:819-828`), passing `input.coordProject ?? null`.

`reconstruct`'s second `INSERT INTO runs` (`:3775-3783`) **deliberately does not set it**. Add the comment there, so the omission is a decision and not an oversight:

```ts
      // `coordProject` is deliberately NOT reconstructed: it is a measurement
      // taken at open time from a registry record that may no longer exist,
      // and inventing one here would be a placement nobody measured. A
      // reconstructed run reads as unstamped, which the policy already handles.
```

- [ ] **Step 8: Derive the stamp in the route**

`routes.ts`, inside `POST /api/runs` **before** the `coord.openRun(...)` call at `:1226` (so a refusal never leaves a `planned` orphan, the discipline the F1/F2 rungs above already follow):

```ts
    // The coordinator's project, from the REGISTRY — never `sessionProject`,
    // which reads the runs table and so answers only for a session that has
    // been a worker. Measured over all 64 runs in history: no session has ever
    // been both, so `sessionProject(claimedBy)` is null for every coordinator.
    // An unreadable or absent record leaves the stamp off; absence permits.
    const coordRec = await readSessionRecord(deps.io, deps.cfg, claimedBy as string);
    const coordProject = coordRec.found ? coordRec.record.project : undefined;
```

…then spread it into the `openRun` call exactly as `homeProject` is:

```ts
      ...(coordProject !== undefined ? { coordProject } : {}),
```

- [ ] **Step 9: Run to green, then run the mutation**

```bash
cd server && ./node_modules/.bin/vitest run test/coord-db.test.ts
cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts
cd server && ./node_modules/.bin/vitest run test/run-routes.test.ts
```
Expected: PASS.

Then **measure the guard**: delete the `ALTER TABLE` line from `MIGRATIONS[10]`, re-run `coord-db.test.ts`, and record that it goes RED with `no such column: coordProject`. Restore. A green mutation here would mean the pin is not binding.

- [ ] **Step 10: Commit**

```bash
git add server/src/coord/schema.ts server/src/coord/store.ts server/src/coord/routes.ts \
        server/test/coord-db.test.ts server/test/coord-store.test.ts server/test/run-routes.test.ts
git commit -m "feat(coord): stamp the coordinator's project on a run at open time"
```

---

### Task 2: The placement policy

**Files:**
- Create: `server/src/coord/placement.ts`
- Test: `server/test/coord-placement.test.ts`

**Interfaces:**
- Consumes: nothing impure. Types only.
- Produces: `boardPlacement(input: PlacementInput): string` — always a project name, never null.

**Archetype to mirror:** `server/test/coord-caps-policy.test.ts` (25 tests, ~479 ms) is this repo's shape for a pure L1 decision, and `decideCaps` / `decideClaim` (`server/src/coord/`) are the function shape. Follow both.

- [ ] **Step 1: Write the failing test**

Create `server/test/coord-placement.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { boardPlacement } from '../src/coord/placement.js';

const base = {
  sessionId: 'custom-tools-amber-delta',
  ownProject: 'custom-tools',
  held: true,
  stamped: null as string | null,
  coordOf: (_p: string): string | null => null,
};

describe('boardPlacement', () => {
  it('places a held worker on its run\u2019s stamped coordinator project', () => {
    expect(boardPlacement({ ...base, stamped: 'intake-platform' })).toBe('intake-platform');
  });

  it('falls back to its own project when the run carries no stamp', () => {
    expect(boardPlacement({ ...base, stamped: null })).toBe('custom-tools');
  });

  it('falls back to its own project when the workspace is NOT held', () => {
    expect(boardPlacement({ ...base, held: false, stamped: 'intake-platform' }))
      .toBe('custom-tools');
  });

  it('never places a session under its own project', () => {
    expect(boardPlacement({ ...base, stamped: 'custom-tools' })).toBe('custom-tools');
  });

  it('walks a chain to the ROOT coordinator', () => {
    const chain: Record<string, string> = { mid: 'root' };
    expect(boardPlacement({
      ...base, stamped: 'mid', coordOf: (p) => chain[p] ?? null,
    })).toBe('root');
  });

  it('a CYCLE falls back to its own project rather than looping', () => {
    const cycle: Record<string, string> = { a: 'b', b: 'a' };
    expect(boardPlacement({
      ...base, stamped: 'a', coordOf: (p) => cycle[p] ?? null,
    })).toBe('custom-tools');
  });

  it('a chain longer than the hop cap falls back rather than walking forever', () => {
    expect(boardPlacement({
      ...base, stamped: 'a', coordOf: (p) => `${p}+`,
    })).toBe('custom-tools');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/coord-placement.test.ts
```
Expected: FAIL — `Cannot find module '../src/coord/placement.js'`.

- [ ] **Step 3: Write the implementation**

Create `server/src/coord/placement.ts`:

```ts
/**
 * Which project CARD a session's row renders on — a display decision, never an
 * identity. `session.project` is untouched by this file and remains the primary
 * key, the registry label and the namespace.
 *
 * PURE (L1): no `fs`, no fastify, no clock, no `coord.db`. The one thing it
 * cannot answer itself — "which project coordinates this one" — arrives as
 * `coordOf`, a port declared BY THIS CONSUMER (the house pattern; see
 * `LivenessProbe` for the precedent).
 *
 * TOTAL: it always returns a project name. Every degenerate case — unheld, no
 * stamp, self-claimed, a cycle, a chain past the cap — returns `ownProject`. A
 * row can never be placed nowhere.
 */
export interface PlacementInput {
  readonly sessionId: string;
  readonly ownProject: string;
  /** Whether this workspace is still held by a programme. The hold is the
   *  DURABLE lifetime: releasing it is an explicit act, so a placement does not
   *  bounce at the wave boundary. Never parsed — this is the boolean form. */
  readonly held: boolean;
  /** The coordinator project stamped on THIS session's newest run, or null when
   *  nothing is stamped (an older row, or an open whose coordinator record was
   *  unreadable). This is the FIRST hop, and it is session-keyed. */
  readonly stamped: string | null;
  /** The transitive hops, which are PROJECT-keyed: which project coordinates
   *  the given project, or null when nothing does. Called at most `MAX_HOPS`
   *  times. A port declared BY THIS CONSUMER, the house pattern. */
  readonly coordOf: (project: string) => string | null;
}

/** Hop cap for the transitive walk. A coordinator-of-a-coordinator has never
 *  occurred (measured: 64 runs, 26 workers, 9 coordinators, zero overlap) and
 *  the worker skill forbids it — but that is a CONTRACT, not a mechanism, so
 *  the walk is bounded rather than trusted. */
const MAX_HOPS = 4;

export function boardPlacement(input: PlacementInput): string {
  if (!input.held) return input.ownProject;
  if (input.stamped === null) return input.ownProject;

  const seen = new Set<string>([input.ownProject]);
  let at = input.stamped;
  if (seen.has(at)) return input.ownProject;      // self-claimed
  seen.add(at);

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const next = input.coordOf(at);
    if (next === null) return at;                 // settled: nothing coordinates `at`
    if (seen.has(next)) return input.ownProject;  // cycle — refuse, do not loop
    seen.add(next);
    at = next;
  }
  return input.ownProject;                        // past the cap — refuse to guess
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
cd server && ./node_modules/.bin/vitest run test/coord-placement.test.ts
```
Expected: PASS (7 tests).

- [ ] **Step 5: Measure each guard by mutation**

Run each mutation, record RED, restore. A green mutation means the case is unpinned:

| Mutation | Must red |
|---|---|
| `if (!input.held)` → `if (false)` | the not-held case |
| `if (seen.has(next))` → `if (false)` | the cycle case (it will hang or exceed the cap) |
| `MAX_HOPS = 4` → `MAX_HOPS = 99` | the past-the-cap case |
| `if (input.stamped === null)` → `if (false)` | the no-stamp case |
| `return at` → `return input.ownProject` | the coordinator and chain cases |

- [ ] **Step 6: Commit**

```bash
git add server/src/coord/placement.ts server/test/coord-placement.test.ts
git commit -m "feat(coord): the pure board-placement decision, bounded and total"
```

---

### Task 3: `FleetSession.boardProject` on the wire

**Files:**
- Modify: `shared/api.ts` (the `FleetSession` interface, `:33-358`; `reviveFleetSession`)
- Modify: `server/src/fleet.ts` (`assembleFleet`'s row literal, ~`:549-551`)
- Test: `server/test/fleetstate.test.ts`, `server/test/fleet.test.ts`, `pwa/test/offline.test.ts`

**Interfaces:**
- Consumes: `boardPlacement` (Task 2), `runs.coordProject` (Task 1).
- Produces: `FleetSession.boardProject: string | null`.

**This task is what ends the cold-start flicker.** `boardProject` rides on `FleetSession`, and sessions
*are* hydrated from `localStorage` — so the placement arrives with the row instead of waiting on a `runs`
frame the snapshot never carried. No wave-2 change is needed for it.

**⚠ Blast radius, measured:** `boardProject` is REQUIRED-with-null (not optional) precisely so `reviveFleetSession`'s literal makes omission a compile error. That is the enforcement the spec relies on — and it means **27 test fixtures fail to compile until updated, 25 of them under `pwa/`**. Each builds a full `FleetSession` literal with a return-type annotation. The token `usage: null` occurs exactly once per file and sits on the literal's last line — use it as the anchor. This is mechanical, expected, and must not be "fixed" by making the field optional.

- [ ] **Step 1: Write the failing wire test**

In `server/test/fleetstate.test.ts`:

First find the fixture this file already round-trips, so the test cannot drift out of sync with
`FleetSession`'s real shape:

```bash
cd <repo root> && grep -n "reviveFleetSession(" server/test/fleetstate.test.ts | head
```

Then add, naming that fixture (call it `RAW` below):

```ts
it('a revived session with no boardProject reads null — absence permits', () => {
  // Built by DELETING the key from a snapshot this file already revives, never
  // by hand-writing a literal: a hand-written one goes stale the next time
  // FleetSession gains a required field, and would then be testing nothing.
  const raw = JSON.parse(JSON.stringify(RAW)) as Record<string, unknown>;
  delete raw.boardProject;
  const revived = reviveFleetSession(raw);
  expect(revived).not.toBeNull();
  expect(revived!.boardProject).toBeNull();
});

it('a revived session WITH a boardProject keeps it', () => {
  const raw = JSON.parse(JSON.stringify(RAW)) as Record<string, unknown>;
  raw.boardProject = 'intake-platform';
  expect(reviveFleetSession(raw)!.boardProject).toBe('intake-platform');
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/fleetstate.test.ts
```
Expected: FAIL — `boardProject` does not exist on type `FleetSession`.

- [ ] **Step 3: Add the field and the reviver arm**

`shared/api.ts`, in `FleetSession`:

```ts
  /** WHICH CARD this row renders on — a display decision, never an identity.
   *  `project` above is unchanged and remains the primary key.
   *
   *  ADDITIVE; `FLEET_PROTO` is deliberately NOT bumped. `null` means THIS
   *  SERVER DID NOT DECIDE — an older peer, or a snapshot revived from a build
   *  predating the field — and the single reader falls back to `project`. Those
   *  two conditions collapse deliberately: a caller does the identical thing
   *  with both. What is NOT folded is "placed elsewhere" vs "placed home",
   *  which a reader gets from `boardProject !== project` and needs no field. */
  boardProject: string | null;
```

In `reviveFleetSession`, beside the other `optStr` arms:

```ts
    boardProject: optStr(o, 'boardProject'),
```

- [ ] **Step 4: Compute it in `assembleFleet`**

`server/src/fleet.ts`, in the row literal beside `project: r.project`:

```ts
      boardProject: boardPlacement({
        sessionId: r.id, ownProject: r.project, held: r.held !== null,
        stamped: bySession.get(r.id) ?? null, coordOf,
      }),
```

`coordOf` and each row's `stamped` are built ONCE per assemble pass — never per row, which would be
O(rows x hops) queries:

```ts
  // One pass over the stamped runs, reused by every row below.
  //   byProject : which project coordinates a given project  (the transitive hops)
  //   bySession : the stamp on a session's OWN newest run     (the first hop)
  // `includeClosed` is deliberate: a placement that keyed on open runs alone
  // would bounce every worker between cards at the close-then-open wave
  // boundary, which is one of the four defects this design exists to end.
  const byProject = new Map<string, string>();
  const bySession = new Map<string, string>();
  for (const run of coord.runs({ includeClosed: true }).runs) {
    if (run.coordProject === null) continue;
    if (run.sessionId !== null) bySession.set(run.sessionId, run.coordProject);  // newest wins
    if (!byProject.has(run.project)) byProject.set(run.project, run.coordProject);
  }
  const coordOf = (project: string): string | null => byProject.get(project) ?? null;
```

…and each row passes `stamped: bySession.get(r.id) ?? null`. Runs arrive in `id` order, so a later
`set` on the same session overwrites an earlier one and "newest wins" holds without a sort.

- [ ] **Step 5: Fix the 27 fixtures**

```bash
cd <repo root> && grep -rln "usage: null" pwa/test server/test | sort
```
Add `boardProject: null,` to each literal. Then typecheck both packages:

```bash
cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
cd pwa && ./node_modules/.bin/vitest run test/offline.test.ts
```

- [ ] **Step 6: Run to green**

```bash
cd server && ./node_modules/.bin/vitest run test/fleetstate.test.ts
cd server && ./node_modules/.bin/vitest run test/fleet.test.ts
cd server && ./node_modules/.bin/vitest run test/fleet-protocol.test.ts
```
Expected: PASS. `fleet-protocol.test.ts` must still assert `FLEET_PROTO === 1`.

- [ ] **Step 7: Commit**

```bash
git add shared/api.ts server/src/fleet.ts server/test pwa/test
git commit -m "feat(fleet): carry the board placement on the wire, additively"
```

---

### Task 4: Retain the repo and put it on `ProjectRow`

**Files:**
- Modify: `shared/api.ts` (`ProjectRepoWire`, `ProjectRow.repo`)
- Modify: `server/src/watch.ts:3227` — **the seam that drops it**
- Modify: `server/src/server.ts` (`GET /api/projects`, ~`:2058-2090`)
- Test: `server/test/projects-route-placement.test.ts`, `server/test/pr-sweep.test.ts`

**Interfaces:**
- Consumes: `CcdPrLine { project, repo, … }`, `CcdPrFailure.reason`, `PR_REASON_MAP`.
- Produces: `ProjectRepoWire`; `ProjectRow.repo?: ProjectRepoWire`.

**⚠ Edit the right seam.** `server/src/prstate.ts:257` **keeps** the repo (it feeds `PrView.facts.repo` for the PR sheet). The drop is `server/src/watch.ts:3227`, `this.prStates.set(line.id, phaseFor(line))`, where a `CcdPrLine` carrying `repo` becomes a `PrState` that has none (verified: `PrState`'s only "repo" is in a comment). A change made in `prstate.ts` retains nothing.

- [ ] **Step 1: Write the failing route test**

In `server/test/projects-route-placement.test.ts`, mirroring its one-cell-per-state shape:

```ts
it('a project whose repo was measured carries a named cell', async () => {
  const app = await open();
  const rows = (await app.inject({ method: 'GET', url: '/api/projects' })).json().projects;
  const row = rows.find((r: { name: string }) => r.name === 'demo');
  expect(row.repo).toEqual({ state: 'named', slug: 'acme/demo' });
});

it('a project with no usable origin reads absent, never unmeasured', async () => {
  // driven by CcdPrFailure.reason === 'no-remote'
  expect(repoCellFor({ reason: 'no-remote' })).toEqual({ state: 'absent' });
});

it('every OTHER PrReason reads unmeasured — derived from PR_REASON_MAP, never hand-listed', () => {
  for (const reason of PR_REASONS.filter((r) => r !== 'no-remote')) {
    expect(repoCellFor({ reason })).toEqual({ state: 'unmeasured' });
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/projects-route-placement.test.ts
```
Expected: FAIL — `repo` is not a property of the project row.

- [ ] **Step 3: Declare the discriminated type**

`shared/api.ts`, immediately above `ProjectRow`, mirroring `ProjectPoolWire`'s shape and its refusal to fold:

```ts
/**
 * What a project's REPOSITORY was measured to be — `_gh_repo_slug` of the
 * project's main checkout, carried on the project row.
 *
 * THREE states, and no reader may fold one into another. `absent` is a
 * MEASUREMENT — the project has no usable origin, which four projects on this
 * fleet genuinely do not — while `unmeasured` says no measurement happened.
 * Folding them would paint "this project has no repository" over a timeout.
 *
 * The label renders only on `named`. `absent` is deliberately NOT split into
 * "no origin" and "unrecognized remote": a renderer treats them identically and
 * `PrKeycap.tsx`'s no-remote sentence already owns that distinction.
 */
export type ProjectRepoWire =
  | { state: 'named'; slug: string }
  | { state: 'absent' }
  | { state: 'unmeasured' };
```

…and on `ProjectRow`, beside `pool?`:

```ts
  repo?: ProjectRepoWire;
```

- [ ] **Step 4: Retain the pair at the seam**

First give the split ONE home, so the route and the sweep cannot disagree. In `server/src/prstate.ts`,
beside the other line/failure helpers:

```ts
/** The repo cell for one project, from what the sweep measured about it.
 *
 * `absent` has EXACTLY ONE proof — `no-remote`, which is what `_gh_repo_slug`'s
 * failure produces. Every other `PrReason` means the question was not answered,
 * not that the answer is "none". The other reasons are NOT listed here: they
 * are whatever `PR_REASON_MAP` holds that is not `no-remote`, so a reason added
 * later cannot silently start claiming a project has no repository. */
export function repoCellFor(
  m: { slug?: string; reason?: PrReason | null },
): ProjectRepoWire {
  if (m.slug !== undefined && m.slug !== '') return { state: 'named', slug: m.slug };
  return m.reason === 'no-remote' ? { state: 'absent' } : { state: 'unmeasured' };
}
```

Then in `server/src/watch.ts`, alongside `this.prStates.set(line.id, phaseFor(line))` at `:3227`,
retain the pair the line already carries:

```ts
          this.prStates.set(line.id, phaseFor(line));
          // RETAINED, not derived: `line.repo` is `_gh_repo_slug` of this
          // project's main checkout, already measured by this same sweep and
          // until now dropped here — `phaseFor` returns a `PrState`, which has
          // no repo field. This is the seam; `prstate.ts`'s `prView` KEEPS the
          // repo for the PR sheet and is NOT where retention belongs.
          this.projectRepos.set(line.project, repoCellFor({ slug: line.repo }));
```

…and on the whole-repo failure arm, where a `CcdPrFailure` carries the reason rather than a slug:

```ts
          this.projectRepos.set(failure.project, repoCellFor({ reason: failure.reason }));
```

Declare `private readonly projectRepos = new Map<string, ProjectRepoWire>();` on the watcher beside
`prStates`, and expose it the same way `currentReadiness()` exposes its own state.

- [ ] **Step 5: Attach it in the route**

`server/src/server.ts`, in `GET /api/projects` beside the existing `poolCells` helper:

```ts
    // A project the sweep has not reached reads `unmeasured`, NOT `absent`.
    // That includes every project with no workspaces — the sweep enumerates
    // workspaces — and saying `absent` there would claim a measurement that
    // never happened about four projects on this fleet that genuinely have no
    // origin, making the true answer and the unasked question the same value.
    const repos = watcher?.currentProjectRepos() ?? new Map<string, ProjectRepoWire>();
    const repoCell = (p: ProjectRow): Pick<ProjectRow, 'repo'> =>
      ({ repo: repos.get(p.name) ?? { state: 'unmeasured' } });
```

…then spread `...repoCell(p)` into each row literal exactly where `...poolCells(p)` already is — both
of the two return sites in this handler (the `fleet === undefined` early return and the main one), or
the cell is silently missing whenever the watcher has not produced readiness yet.

- [ ] **Step 6: Run to green and mutate**

```bash
cd server && ./node_modules/.bin/vitest run test/projects-route-placement.test.ts
cd server && ./node_modules/.bin/vitest run test/pr-sweep.test.ts
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts
```
Expected: PASS. Then mutate the reason mapping so `no-remote` falls through to `unmeasured`; the second and third tests must go RED. Restore.

- [ ] **Step 7: Commit**

```bash
git add shared/api.ts server/src/watch.ts server/src/server.ts server/test
git commit -m "feat(projects): retain the measured repo and carry it as a three-state cell"
```

---

## Whole-wave gate

- [ ] Server suite, **sharded** (the union is the whole list):

```bash
cd server && ./node_modules/.bin/vitest run --shard=1/3
cd server && ./node_modules/.bin/vitest run --shard=2/3
cd server && ./node_modules/.bin/vitest run --shard=5/6
cd server && ./node_modules/.bin/vitest run --shard=6/6
```

- [ ] `cd pwa && npm run test` and `cd agent && npm run test`.
- [ ] **Do not trust a green `pwa` run alone.** Two SERVER suites reach into the PWA: `server/test/resume-reclaim-l0.test.ts` names `pwa/src/fleet/nestFleet.ts` by hand and asserts a literal from its header, and `server/test/single-definition.test.ts` text-scans all four roots. A PWA-only run is silent about both.
- [ ] Re-run the known load flakes **in isolation** before calling any of them a real break: `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`.
- [ ] **Deploy order: this wave is NOT agent-first.** It touches nothing under `ccd/`, `session-hook.sh`, `ccd/coordinator-skill/` or `ccd/worker-skill/`. Confirm before saying so: `git diff --name-only origin/main...HEAD` must show no path under `ccd/`. The deploy is the operator's act — do not run either lane.

## Deviations found

*(None yet. Allocate with `ccrc-api ledger allocate` at the moment you depart from this plan, and define the number in this section in the same commit. Never guess a number; never pre-mint a block.)*
