# Spawn visibility — the dispatch window stops being invisible Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While a programme orchestrator spawns a child workspace, the console says so; the
children it owns nest under it with an `└─` bracket instead of scattering through the list;
and when a spawn never completes, the console says that too, instead of leaving a `planned`
run beside an unexplained workspace.

**Architecture:** One honest new fact (`runs.dispatchStartedAt`, additive, no state-machine
change) is written immediately before the `ws-add` that mints the workspace, and read by the
PWA to render the window the operator currently spends staring at three fault-shaped words.
The same slice gives the lifecycle journal the attribution it lacks (the `create` row learns
which run's dispatch caused it) and renders the run-board facts that already ship and are
merely unread.

**Tech Stack:** TypeScript ESM (fastify server, `node:sqlite`), React (pwa), vitest.

**Spec:** No standalone spec — §Design below is the decision record, argued from the
measured survey of the dispatch window (2026-08-25) whose findings are quoted inline.

## Design (the decision record)

**The measured gap.** From dispatch acceptance to a usable pane, the operator sees, in
order: nothing at all (the session id does not exist yet — the server learns it by registry
diff, `dispatch.ts:223-228`, so nothing *can* name the row); then a `dead` row qualified
**"never started"**, indistinguishable from an abandoned workspace; then **"unclaimed — a
live pane with no claim"** plus an `unstarted` chip; then up to `SPAWN_SETTLE_S`=240 s of a
row wearing that chip. Throughout, the run board sits on `planned`. Three fault-shaped words
for an entirely normal event, and a board that never moves.

**Why a new fact is required, and why it is not a new state.** `planned` is overloaded: it
means both "opened, nobody has dispatched" and "dispatch in flight". Inferring the difference
client-side (a `planned` run plus a `never-started` unheld row in the same project) is the
seam-level guessing the conventions forbid — *an adapter may not narrow a distinction it
received*. So one fact moves: `dispatchStartedAt INTEGER`. It is **not** a new `RunState`:
`RUN_STATES` and `RUN_TRANSITIONS` are untouched, and the coordinator skill's ten clauses —
pinned verbatim by `coordinator-skill.test.ts` — say nothing new.

**It is a measurement, never a mode flag, and so it is never cleared.** The column records
*when this run's dispatch began*. Success moves `state` to `dispatched`, which is what stops
the "dispatching" rendering; the timestamp stays as forensic material (`dispatchedAt -
dispatchStartedAt` is how long the spawn actually took). A re-dispatch after a failure
overwrites it, which is correct: that is the new attempt's start. One writer, one reader per
consumer — no second writer to drift.

**The wedge becomes visible.** `dispatch.ts:319-327` names the class this build is judged on:
"a run stuck in `planned` beside an unexplained new workspace is a state no verb names". With
the column, `planned` + a `dispatchStartedAt` older than the stall threshold IS that state,
rendered, for the first time.

**The stall threshold is its own constant, not a copy of the timeout.** The `ws-add` ceiling
(`CCD_VERB_TIMEOUT_MS['ws-add']` = 300 000 ms, `server/src/remote/runner.ts:72`) is a
*timeout*; the PWA needs a *rendering* threshold. Copying the timeout would put one policy
number in two places (`single-definition` forbids it) and would also be wrong — the render
should wait until the timeout has certainly elapsed. So `SPAWN_STALL_MS` is declared once in
`shared/api.ts`'s L0 constants block, documented as deliberately ≥ the ceiling and NOT the
timeout itself.

**Attribution, three lines.** `CCD_ARGV.wsAddWorker` passes no actor flags, so Build 9a's
journal records every dispatched spawn as *declared: nothing / unmeasured*. Threading
`sweepDec(state, 'run:<id> dispatch')` — exactly the gating `wsHold` already uses
(`capSupported(state, ACTOR_FLAGS_CAP)`) — makes the journal answer "the dispatch path did
this". Fixed at the source, in the same slice, so the board and the journal agree.

**Deliberately NOT in this slice:** per-phase spawn progress (worktree → seeded → pane →
claimed → settling). It needs `$REG/<id>.setup` to gain a server reader, a pre-pane age
anchor the fleet wire does not carry, and a new `SessionLifecycle` rung — an L0 change with
two implementations that must agree. Ship the window first; per-phase detail is a follow-on
if the operator wants more than "it is coming, 42 s in".

## Global Constraints

- `FLEET_PROTO` stays 1 — every wire change is ADDITIVE and absence-permits; no
  `RUN_STATES`/`RUN_TRANSITIONS`/`MailKind` change; no coordinator- or worker-skill clause
  moves (both corpora are pinned verbatim).
- One migration, appended as `MIGRATIONS[4]`; `COORD_SCHEMA_VERSION` derives
  (`= MIGRATIONS.length`) and is never hand-edited. Migrations already shipped are FROZEN.
- `coord.db` stays synchronous — never wrap `tx()` async.
- Suites: `./node_modules/.bin/vitest run <file>` from inside the package, FOREGROUND, never
  bare `npx vitest`; canonical `/mnt` cwd. Fixture HOMEs only.
- Every guard ships with a mutation-measured red, count stated in the commit body.
- Deviations are nominated prose-only in commit bodies; the orchestrator mints numbers
  through `POST /api/ledger/deviations` (the allocator is live — never hand-sweep).
- No ccd change is expected in this slice (Build 9a already accepts the actor flags Task 2
  passes). If a task finds it must touch `ccd/`, STOP and report — that changes the deploy
  ordering to AGENT-FIRST and is a decision for the orchestrator.

## Wave order

Task 1 (the fact) precedes everything. Task 2 (attribution + the ownership edge) is
server-side and must land before Task 4, which renders that edge. Tasks 3–5 (PWA) consume
Tasks 1–2's landed wire fields; 3 before 4 (4 reuses 3's elapsed-time helper), 5 independent.
Tree wins for anchors, this plan's SEMANTICS win for behavior.

**The nesting requirement arrived mid-execution** (operator, 2026-08-25, while Task 1 was in
flight) and was folded in rather than deferred: Task 2 gained the `claimedBy` wire field it
needs, and Task 4 — originally a loose "pending line on the project card" — became the
nesting task, which subsumes it (the pending line is now a pending CHILD). Tasks 1, 3 and 5
are unchanged.

---

### Task 1: `dispatchStartedAt` — the column, the writer, the wire

**Files:**
- Modify: `server/src/coord/schema.ts` (append `MIGRATIONS[4]`), `server/src/coord/store.ts`
  (`RunRow`/`hydrateRun`, and a `markDispatchStarted` writer), `server/src/coord/dispatch.ts`
  (call it immediately before the `ws-add`), `shared/api.ts` (`RunSummary` + `SPAWN_STALL_MS`)
- Test: `server/test/coord-db.test.ts` (migration), `server/test/run-routes.test.ts` or
  `server/test/dispatch-*.test.ts` (the writer — pick the suite that already drives
  `dispatchRun` end-to-end with a fixture runner; read both first)

**Interfaces:**
- Produces: `runs.dispatchStartedAt INTEGER` (nullable); `RunSummary.dispatchStartedAt:
  number | null`; `CoordStore.markDispatchStarted(runId: number, at: number): void`;
  `SPAWN_STALL_MS` (L0).
- Consumes: `MIGRATIONS` (`schema.ts`), `toRunSummary` (`store.ts:62`, a spread — a new
  `RunRow` field reaches the wire automatically once `hydrateRun` reads it).

- [x] **Step 1: read before writing.** `schema.ts`'s `MIGRATIONS` tail (the three existing
  entries and their FROZEN notes, esp. the Build 9b entry's shape), `store.ts`'s `RunRow`
  type + `hydrateRun` + `toRunSummary` (`:62-65`), the `runs` DDL (`schema.ts:65-86`), and
  `dispatch.ts:226-250` (the BEFORE read, the `wsAddWorker` call at `:243`).

- [x] **Step 2: red-first — the migration.** In `coord-db.test.ts`, beside its existing
  migration pins: a fresh database has `dispatchStartedAt` on `runs` (read `pragma
  table_info(runs)`), it is nullable with no default, and `COORD_SCHEMA_VERSION` derives to
  5. Run the suite; expect RED.

- [x] **Step 3: red-first — the writer.** In the dispatch suite: a fresh-spawn dispatch
  stamps `dispatchStartedAt` **before** the `ws-add` call — assert it by having the fixture
  runner READ the row when it is invoked (the runner is a test double; capture
  `coord.run(id).dispatchStartedAt` at call time), not merely after the fact. That ordering
  is the whole point: a timestamp written after the spawn returns would be invisible during
  exactly the window it exists to describe. Also: it is NOT cleared when the dispatch
  succeeds (assert it survives on the `dispatched` row), and a second dispatch attempt
  overwrites it with the later time. Expect RED.

- [x] **Step 4: implement.**
  - `schema.ts`: append `MIGRATIONS[4]` = `ALTER TABLE runs ADD COLUMN dispatchStartedAt
    INTEGER;` with a comment block in the file's voice: what the column means (when THIS
    run's dispatch began), that it is a measurement never cleared, that `state` is what stops
    the rendering, and that `planned` + a stale value IS the wedge `dispatch.ts:319-327`
    names. State that migrations 1–3 are frozen and this one is additive.
  - `store.ts`: add `dispatchStartedAt: number | null` to `RunRow`, read it in `hydrateRun`
    (match the neighbouring nullable-integer fields' exact idiom), and add:

```ts
  /** Stamped immediately BEFORE the `ws-add` that mints a fresh workspace —
   *  the one moment the run knows a dispatch is in flight and the session id
   *  does not exist yet. A MEASUREMENT, not a mode flag: nothing clears it,
   *  `state` moving to `dispatched` is what ends the "dispatching" render,
   *  and `dispatchedAt - dispatchStartedAt` is then how long the spawn took.
   *  A retry overwrites it with the new attempt's start, which is the honest
   *  answer to "when did the dispatch that is running now begin". */
  markDispatchStarted(runId: number, at: number): void {
    this.db.prepare('UPDATE runs SET dispatchStartedAt = ? WHERE id = ?').run(at, runId);
  }
```

  (match the class's existing statement/`tx` idiom — read a neighbouring single-statement
  writer first and follow it exactly.)
  - `dispatch.ts`: call `deps.coord.markDispatchStarted(run.id, Date.now())` on the line
    before `const res = await deps.runCcd(argv);`, with a one-line comment saying why it is
    before and not after. **The fresh-spawn arm ONLY** — the wave N>=2 resume arm (D-1,
    `CCD_ARGV.ensure`) does not stamp, and the `else` branch says so in a comment.
  - `shared/api.ts`: add `dispatchStartedAt: number | null` to `RunSummary` (docstring: what
    it measures, that absence means no FRESH-SPAWN dispatch has started — **two named
    conditions, and both must be written down: nobody dispatched this run, OR every dispatch
    was a resume**, since the writer is scoped to the `ws-add`; that `state`, not this field,
    answers "was it dispatched"; that the `dispatchedAt - dispatchStartedAt` arithmetic is
    therefore available for a fresh spawn and not a resume; and that a
    `planned` run carrying one older than `SPAWN_STALL_MS` is a dispatch that never
    completed), and declare in the L0 constants block:

```ts
/** How long a `planned` run may carry a `dispatchStartedAt` before the
 *  console calls the dispatch stalled. Deliberately >= the `ws-add` verb
 *  ceiling (`CCD_VERB_TIMEOUT_MS`, server-side) rather than a copy of it:
 *  that number is a TIMEOUT — what the runner enforces — and this one is a
 *  RENDERING threshold, which must not fire until the timeout has certainly
 *  elapsed. Two different questions, so two different names; neither is
 *  derived from the other, and `single-definition` sees one of each. */
export const SPAWN_STALL_MS = 360_000;
```

- [x] **Step 5: green.** Run the two suites above plus `test/coord-store.test.ts`,
  `test/single-definition.test.ts`, `test/typecheck-tests.test.ts` (isolate it if it reds
  under load — D-224), `test/topology-clean.test.ts`.

- [x] **Step 6: mutation ceremonies, each planted alone, measured, reverted:**
  1. Move the `markDispatchStarted` call to AFTER `await deps.runCcd(argv)` → the ordering
     test reds (state the count).
  2. Clear the column in the dispatch tx (`dispatchStartedAt = NULL`) → the survives-success
     test reds.
  3. Drop the column from `MIGRATIONS[4]` → the migration pin reds.

- [x] **Step 7: commit** with measured counts in the body.

- [x] **Step 8 (review fix round):** the two must-fixes off Task 1's review.
  1. The NULL docstring was false on the resume path in all three copies (`shared/api.ts`,
     `store.ts`'s `hydrateRun`, `MIGRATIONS[4]`) — Step 4 above dictated the wording while
     §Design scoped the writer to the `ws-add`, so NULL silently carried a second condition.
     **Resolved by fixing the WORDS, not the writer** — the scope stays fresh-spawn-only —
     plus a pin in `run-routes.test.ts` that a resumed dispatch leaves it null, so widening
     the scope costs a test. Step 4's own text is corrected above so a re-execution cannot
     reproduce it.
  2. `SPAWN_STALL_MS >= CCD_VERB_TIMEOUT_MS['ws-add']` lived only in prose across two files.
     **Mechanized here rather than deferred to Task 3** (whose ceremony pins only the
     single-definition half): `remote-runner.test.ts` measures the budget through the
     existing `createRunner` seam the per-verb table already uses and asserts the floor — no
     new export, and it pins the number that actually reaches the wire.

### Task 2: the journal learns who spawned the worker — and the wire learns who owns the run

**Files:**
- Modify: `server/src/ccdargv.ts` (`wsAddWorker` takes a dec), `server/src/coord/dispatch.ts`
  (pass one), `shared/api.ts` (`RunSummary.claimedBy`), `server/src/coord/store.ts`
  (`RunRowDb` + `hydrateRun` carry it)
- Test: the suite pinning `wsAddWorker`'s argv (`run-routes.test.ts` per Task 2 of the
  per-worker-RC plan) and `whitelist-subset.test.ts` (exhaustive over `keyof typeof CCD_ARGV`);
  plus the runs-route/store suite for the new wire field

**Interfaces:**
- Consumes: `decFlags` (`ccdargv.ts:103`), `sweepDec` (`:163`, already gates on
  `capSupported(state, ACTOR_FLAGS_CAP)`), the `wsHold` precedent (`:260`).
- Produces: `wsAddWorker(p: string, dec: ActorFlags | null)`.

- [x] **Step 1: read the precedent.** `ccdargv.ts:60-110` (the dec doc block), `:163-170`
  (`sweepDec`), `:238-262` (`wsArchive`/`wsRestore`/`wsHold`'s exact flag placement), and how
  `dispatch.ts` already obtains the fleet state it passes to `sweepDec` for its `ws-hold`
  call (`dispatch.ts:425-432`) — reuse THAT value; do not measure a second one.

- [x] **Step 2: red-first.** Extend the argv pin: a fresh-spawn dispatch on a
  caps-supporting fixture composes `['ws-add','--no-rc',<project>, ...decFlags]` with the
  dec's reason naming this run (`run:<id> dispatch`), and on a fixture whose caps do NOT
  support actor flags composes exactly `['ws-add','--no-rc',<project>]` — the absence-permits
  half, which is what keeps an older ccd working. Expect RED.

- [x] **Step 3: implement.** `wsAddWorker: (p: string, dec: ActorFlags | null) => argv(['ws-add', '--no-rc', p, ...decFlags(dec)])`,
  and at the call site pass `sweepDec(<the same fleet state ws-hold uses>, \`run:${run.id} dispatch\`)`.
  Keep `--no-rc` in its leading position (ccd's parse contract) — the dec flags go last, as
  every other builder places them.

- [x] **Step 4: green + mutation.** Run the argv suite, `whitelist-subset.test.ts`,
  `test/verb-gate.test.ts`, `typecheck-tests`. Mutation: drop the `...decFlags(dec)` spread →
  the caps-supporting pin reds; revert, state the count.

- [x] **Step 5: the ownership edge reaches the wire.** `runs.claimedBy` — the one
  coordinator's session id, the column `resolveCoordinator` and the `claimed-by-another`
  refusal already turn on (`schema.ts:75`) — is read server-side ONLY: `RunRow extends
  RunSummary` adds nothing but `prLineage`, and `shared/api.ts` has no `claimedBy` at all, so
  the PWA cannot see which session owns a run. Task 4 renders exactly that edge (a worker
  nests under the coordinator that dispatched it), so the field ships here, where its
  neighbours are.
  - Red-first: pin that `GET /api/runs` and the `runs` frame both carry `claimedBy` for a run
    opened by a known coordinator, and that it is `null`-safe for a row that somehow lacks
    one (absence permits — an older database row, a hand-inserted fixture).
  - Implement: add `claimedBy: string | null` to `RunSummary` with a docstring saying what it
    is (the ONE coordinator's tmux-derived session id, fixed at `POST /api/runs`, never
    rewritten by any route — which is why a fresh coordinator in a different workspace gets
    `claimed-by-another` forever) and that the PWA reads it as the programme-ownership edge;
    add it to `RunRowDb` and `hydrateRun` following the neighbouring TEXT-nullable columns'
    exact idiom. `toRunSummary` is a spread, so nothing there changes.
  - Green: the runs-route suite, `coord-store.test.ts`, `typecheck-tests`,
    `single-definition.test.ts`.
  - Mutation: drop `claimedBy` from `hydrateRun`'s SELECT/mapping → the wire pin reds; state
    the count.

- [x] **Step 6: commit** (one commit for both halves is fine — they are one sentence about
  attribution: who caused the spawn, and who owns the run — but say both in the body).

### Task 3: the run board renders the window — and the wedge

**Files:**
- Modify: `pwa/src/screens/RunsScreen.tsx` (`RunRow`, ~`:98-141`)
- Test: `pwa/test/` — the runs-screen suite (find it; if none exists for `RunRow`, create
  `pwa/test/runs-dispatching.test.tsx` following the nearest screen suite's harness)

**Interfaces:**
- Consumes: `RunSummary.dispatchStartedAt`, `SPAWN_STALL_MS` (Task 1, landed).
- Produces: an exported elapsed-time helper Task 4 reuses — put it where the PWA's other
  small pure helpers live (read the neighbours; do NOT invent a new directory).

- [ ] **Step 1: read** `RunsScreen.tsx:90-145` in full (the glyph/state/label/tally/when
  cells, `data-inert` at `:140-141`) and one existing pwa screen test for the harness idiom.

- [ ] **Step 2: red-first.** Three cases on a `planned` run row:
  - `dispatchStartedAt === null` → renders exactly as today (the no-regression pin; assert
    the "dispatching" text is ABSENT).
  - `dispatchStartedAt` set, age < `SPAWN_STALL_MS` → renders a dispatching affordance with
    the elapsed time (e.g. `⟳ dispatching… 0:42`), and the row is no longer `data-inert`
    where that would suppress the affordance — read `:140-141` and keep inertness for
    NAVIGATION (there is still no session to open) while letting the text render.
  - `dispatchStartedAt` set, age ≥ `SPAWN_STALL_MS` → renders the wedge: *dispatch never
    completed — a workspace may exist*, distinctly from the in-flight case (assert both
    directions: the stalled text present, the "dispatching" text absent).
  Freeze time in the test (the suite's existing fake-timer idiom) so the boundary is exact,
  and pin the boundary at `SPAWN_STALL_MS` itself, not a rounded neighbour.

- [ ] **Step 3: implement** the three branches in `RunRow`, reading `SPAWN_STALL_MS` from
  `shared/api.js` (never a local literal). Keep the existing cells' text byte-identical for
  every other state — this task adds a branch, it does not restyle the board.

- [ ] **Step 4: green.** The new suite plus the full `pwa` package
  (`cd pwa && ./node_modules/.bin/vitest run`) — it is fast, and a screen edit can move
  unrelated snapshots.

- [ ] **Step 5: mutation.** Replace `SPAWN_STALL_MS` with a hardcoded literal that differs →
  the boundary test reds; revert, count stated. Then: delete the stalled branch → the wedge
  test reds.

- [ ] **Step 6: commit.**

### Task 4: children nest under the programme that owns them

**Operator requirement, verbatim (2026-08-25):** *"I'd like to basically see nesting via L
bracket under the programme owner for any child workspaces"*, sketched as:

```
MAIN OPERATOR
└─ child 1
└─ child 2
└─ child 3
```

The edge is `run.claimedBy` (the coordinator's session id — the parent) → `run.sessionId`
(the worker's session id — the child), read off the `runs` frame, which is **active-only by
construction** (`watch.ts:931,963-976`) so the tree shows the programme structure that is
live right now and forgets it when the programme closes. A dispatch still in flight (Task 1's
`planned` + `dispatchStartedAt`) has no `sessionId` yet and renders as a pending child of the
same parent — which is the whole point: the operator watches the child appear under the
coordinator that asked for it.

**Files:**
- Modify: `pwa/src/fleet/ProjectCard.tsx` (the row list), `pwa/src/fleet/sortFleet.ts` (or a
  new sibling helper — read it first and follow its shape), `pwa/src/screens/FleetScreen.tsx`
  (pass the runs data down if it does not already)
- Test: the fleet-screen/project-card suite (extend) plus a unit suite for the grouping
  helper

**Interfaces:**
- Consumes: `RunSummary.claimedBy` + `.sessionId` + `.state` + `.dispatchStartedAt`
  (Tasks 1–2, landed), `FleetSession.id`, Task 3's elapsed-time helper.
- Produces: a PURE grouping helper (name it in the file's own idiom) taking
  `(sessions, runs)` and returning the display order with a depth per row — the component
  renders, it does not decide.

- [ ] **Step 1: establish whether the runs data is in hand.** `RunsScreen` consumes the
  `runs` frame; determine whether `FleetScreen`/`ProjectCard` can read the same store value
  (find the store/hook that holds frames). If it can, this task is PWA-only as scoped. If the
  runs frame is NOT available to the fleet tree, wire it through the existing store — still
  no server change — and say so in the commit body.

- [ ] **Step 2: red-first — the grouping helper, as a pure unit suite.** These five rules ARE
  the task; each gets its own test, and each is a rule a reviewer can reject on its own:
  1. **The happy shape.** Coordinator `C` owns two active runs naming workers `W1`, `W2`
     (both sessions present in the same project): the order is `C`, `W1`, `W2`, with depth
     `0, 1, 1`, and `W1`/`W2` appear exactly once — never also at top level.
  2. **Deterministic child order.** Children sort by the run's `wave` ascending, then run
     `id` ascending — NOT by the top-level session sort. Two children from the same wave keep
     run-id order. (State it in the helper's docstring: the tree is programme order, not
     status order, because a child's position is a fact about the programme, not about how
     busy it is.)
  3. **An orphan is never bracketed.** A child whose parent session is absent from this
     project's list (a coordinator on another project, archived, or simply not measured)
     renders at TOP level, depth 0, exactly as today. Absence permits: no dangling `└─`
     pointing at nothing.
  4. **One level only, and the tie-break is stated.** A session that is BOTH a child of one
     run and the parent of another renders at TOP level with its own children beneath it —
     never nested itself. Rationale to put in the docstring: nesting it would either hide its
     children or demand a second level, and the operator asked for one bracket, not a tree.
     Pin this with a three-session fixture.
  5. **The pending child.** A run with `state === 'planned'` and a non-null
     `dispatchStartedAt` renders as a child of its `claimedBy` with no session id — after the
     settled children, carrying the elapsed time (`⟳ spawning a worker · <program> · 0:42`
     via Task 3's helper). It disappears the moment the run reaches `dispatched` (by then the
     real session row is its own child, and two rows for one spawn is worse than none). If
     the parent is absent, the pending line renders at top level rather than vanishing — the
     operator still needs to know a spawn is happening.
  Run the unit suite; expect RED (no helper yet).

- [ ] **Step 3: red-first — the rendering.** In the card suite: a nested row renders the `└─`
  bracket and its indent; a top-level row renders neither (assert BOTH directions — a bracket
  that is always present is not a bracket). The pending child is NOT tappable and carries no
  session id. Every existing row affordance (tap target, chips, the held string) is unchanged
  on a nested row — nesting changes position and prefix, nothing else.

- [ ] **Step 4: implement.** The helper is pure and lives beside `sortFleet`; the component
  maps over its output and renders depth as the bracket + indent. Top-level ordering keeps
  today's `sortFleet` result exactly — a child is REMOVED from that order and re-inserted
  under its parent, never re-sorting the parents. Use the same `└─` character in one place
  (a named constant, not a literal repeated per branch).

- [ ] **Step 5: green.** The two new suites plus the whole `pwa` package.

- [ ] **Step 6: mutation ceremonies, each planted alone, measured, reverted:**
  1. Drop the "remove from top level" step (children rendered under the parent AND in the
     ordinary list) → the appears-exactly-once test reds.
  2. Let an orphan keep its bracket → rule 3's test reds.
  3. Nest a session that is itself a parent → rule 4's test reds.
  4. Drop the `state === 'planned'` half of the pending condition → the
     disappears-once-dispatched test reds.

- [ ] **Step 7: commit.**

### Task 5: render the facts that already ship

**Files:**
- Modify: `pwa/src/screens/RunsScreen.tsx` (RunRow already receives the whole
  `FleetSession`, `:316`), `pwa/src/fleet/SessionLine.tsx` (`.sess-held`, `:414-418`)
- Test: the runs-screen and fleet-line suites (extend)

- [ ] **Step 1: red-first, three small pins.**
  - `RunRow` renders the linked session's `spawnState` when it is not `null` (today the row
    reads only `unmeasured` off a `FleetSession` it already holds).
  - A wave-N≥2 row renders `resumed`/`clearedAt` — `RunSummary.resumed` has shipped since
    Build 4 and nothing in `pwa/src` has ever rendered it.
  - `.sess-held` becomes a tap target that navigates to the runs screen (the hold string
    already names the run: `program:<slug> wave:N/M run:<id>`, `rundefs.ts:90-93`). Parse the
    run id from the hold string in ONE place with a pinned helper — a regex inlined in a
    component is the second copy this repo forbids — and when the string does not match,
    render exactly today's non-interactive text (absence permits; never a dead tap).

- [ ] **Step 2: implement, keeping every existing rendering byte-identical** where the new
  data is absent.

- [ ] **Step 3: green + mutation.** Full `pwa` suite. Mutation: make the hold-parse helper
  return a run id for a non-matching string → the never-a-dead-tap test reds; revert, count.

- [ ] **Step 4: commit.**

## Deviations found

(minted through `POST /api/ledger/deviations` at close — executors nominate prose-only)
