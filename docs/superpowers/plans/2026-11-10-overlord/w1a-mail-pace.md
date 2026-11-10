# Overlord W1a: one mail-pace table keyed by role (`MAIL_PACE`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to
> carry out this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The mail gate reads the two numbers it paces a session by (how long the session must have been idle, and
the gap between two nudges) from one L1 table keyed by role. Today's values do not change.

**Why:** The mail lane paces a session by four module constants and two ternaries on one boolean, "is this session
the claimant of an open run". A session that claims no run gets 60 s of idle and 120 s between nudges. The Overlord
claims no run, so it would get that pair, and the second hold of any two-minute burst would lapse however short its
turns were (H19). With a table keyed by role, the Overlord's row is one more row, not a third ternary.

**Architecture:** A new L1 module, `server/src/coord/mailPace.ts` (C5, as spec §11.1 places `MAIL_PACE`), holds the
table and the one decider of a session's row. `FleetWatcher.mailPass` (L4) reads both and keeps its two gates as
they are. A characterization test pins today's pace at each edge first, on the old code, and stays unchanged and
green through the switch. A single-definition pin then holds the table to one home. The Overlord's row, totality over
`FLEET_ROLES` and the move to `roleOf` belong to W1a's role-table plan, not this one, as the spec's W1a row says (§14).
`coord/delivery.ts` (the L1 mail delivery policy) was considered as the home and not used: its header keeps the
gate-only rungs in `watch.ts`, and the pace table's one reason to change is the role vocabulary.

**Tech Stack:** TypeScript (ES modules, NodeNext), vitest, the `server/` package only.

**Spec:** `docs/superpowers/specs/2026-11-09-overlord-design.md` (the Overlord, hardened edition): §6.4, the C24
bullet "A mail pace of its own" (H19); §1.2, the row "The mail gate's pace"; §3.3.9, C49 ("What a role does lives in
L1 records keyed by role: `MAIL_PACE` (§6.4) and the renewal triggers"); §11.1, the row "`renewalDue`, ...;
`MAIL_PACE` (C5)" (L1, W1a); §14, W1a ("the `MAIL_PACE` table"); §13, C24 and C49; §13.1 and Appendix A, H19.

## What exists today

All in `server/src/watch.ts` unless named otherwise.

- **The four constants**, module-private, none exported:
  - `server/src/watch.ts#MAIL_QUIET_MS` = `60_000`. Its docstring opens the mail lane's block ("The mail lane (the
    seventh; cadence `MAIL_SWEEP_MS`, ...)") and says the value is ccd's `COMPACT_QUIET` "taken rather than
    re-derived". It cites that constant by a line number of `ccd/ccd`, which is stale.
  - `server/src/watch.ts#MAIL_COOLDOWN_MS` = `120_000`.
  - `server/src/watch.ts#COORD_QUIET_MS` = `15_000` and `server/src/watch.ts#COORD_COOLDOWN_MS` = `30_000`, under one
    docstring that argues the coordinator pair (clause 7 of the coordinator skill mandates that it end its turn and
    wait).
- **The one reader** is `FleetWatcher`'s private `mailPass` (run by `sweepMail` through `runLane('mail', ...)`):
  - once per sweep: `const coordinators = new Set(store.openCoordinatorIds());`
  - once per delivery row: `const isCoordinator = coordinators.has(d.toId);`
  - the cooldown gate: `if (now - last < (isCoordinator ? COORD_COOLDOWN_MS : MAIL_COOLDOWN_MS)) { gated(d,
    'cooldown'); continue; }`, where `last` is `this.mailCooldown.get(d.toId) ?? 0`, stamped with the sweep's `now`
    after a landed send;
  - the quiet gate: `mailTurnIdle(live, mark, now, isCoordinator ? COORD_QUIET_MS : MAIL_QUIET_MS, mode)`.
- **How a coordinator is told apart:** `CoordStore.openCoordinatorIds()` (`server/src/coord/store.ts`, reached in
  `mailPass` through its `WatcherCoordPort`): the distinct `claimedBy` of every run whose state is not terminal.
  Nothing else. A session with declared coordinator intent but no open run, a worker, a reviewer and a plain session
  all read the worker pair.
- **The quiet rule** is `server/src/turnidle.ts#mailTurnIdle(live, mark, now, quietMs, mode)` (L1, C3). It takes the
  threshold as an argument and is not changed here.
- **The gate words** `'cooldown'` and `'not-quiet'` are members of `MailGate` (`shared/api.ts#MailGate`). Unchanged.
- **Other mentions are prose only**, in comments: `server/src/askwindow.ts` (the ask grace's floor argument names
  `COORD_QUIET_MS` and `COORD_COOLDOWN_MS`), `server/src/laneSchedule.ts`, `server/src/coord/caps.ts`,
  `server/src/coord/delivery.ts` and `server/src/coord/store.ts` (`MAIL_QUIET_MS` or `MAIL_COOLDOWN_MS`).
- **Tests mirror the values** as local literals, because they had no import path: `server/test/mail-sweep.test.ts`
  (all four), `server/test/turnidle.test.ts` (`MAIL_QUIET_MS`, `COORD_QUIET_MS`),
  `server/test/deliverability-parity.test.ts`, `server/test/brief-landed.test.ts` and
  `server/test/lane-draft-never-blocks.test.ts` (`MAIL_QUIET_MS`). The comments over the mirrors in `mail-sweep`,
  `turnidle` and `deliverability-parity` say there is no import path. `server/test/coord-store.test.ts` names
  `MAIL_COOLDOWN_MS` in one historical comment, left as it is.
- **The nearest existing pin:** `mail-sweep.test.ts`'s describe `'sweepMail: the coordinator quiet window'` proves
  the coordinator pair applies to a claimant and not to a worker, with 1 s margins, but pins no exact edge and no
  plain session.
- **Role vocabularies today:** `shared/api.ts#SessionRole` (`'coordinator' | 'child'`, read by the roll lane),
  `server/src/coord/stall.ts#StallSessionRole` (`'worker' | 'coordinator' | 'other'`) and this lane's boolean.
  `FLEET_ROLES` and `roleOf` do not exist today.
- **Rings and contexts:** a file under `server/src/coord/` takes C5 from the `coord/**` row of the ring-context map
  (`docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md`), checked by
  `server/test/rings/totality.test.ts`. Its ring is decided from its imports by `server/test/rings/ring.ts`
  (`serverRing`): a file that declares values and imports no I/O is L1.
- **Single-definition scans** (`server/test/single-definition/helpers.ts`): `ALL` is every `.ts`/`.tsx` file under
  `shared/`, `server/src/`, `pwa/src/` and `agent/src/`, never a test file; `rel`, `ccrcRoot` and `stallCodeText`
  (comment lines dropped) are exported there. `core-vocab.test.ts` already imports all four, and `path`.

**The role key until `FLEET_ROLES` exists.** The key is `MailPaceRole = keyof typeof MAIL_PACE`, today
`'worker' | 'coordinator'`. Both words are members of the spec's `FLEET_ROLES`, so the role-table plan only widens
it. `'worker'` names the row every session that is not an open claimant reads today (the spec's "a worker's pace"),
plain sessions and reviewers included. The one decider of the key is `mailPaceRoleOf(sessionId, openCoordinators)`,
which answers `'coordinator'` iff the id is in the set built from `openCoordinatorIds()`: exactly today's
`isCoordinator`. The role-table plan makes two edits: `MAIL_PACE` becomes
`satisfies Readonly<Record<FleetRole, MailPace>>`, so a role with no row is a compile error, and `mailPaceRoleOf`
gives way to `roleOf`. Neither is in this plan.

## Global Constraints

- **Test first.** Every task writes its test, runs it red (Task 1 runs green, as a characterization), then changes
  code.
- **One commit per task**, on the workspace's own branch, with the message the task gives.
- **Touch only the files a task names.**
- **Run suites from inside `server/`, in the foreground, with a timeout of at least 600000 ms:**
  `./node_modules/.bin/vitest run <files>`, never bare `npx vitest`.
- **Cite code by symbol or anchor** (`file.ts#name`), never by line number. `server/test/citations.test.ts` reds on
  a numeric line citation a branch adds.
- **Public repository:** no private project, host, account or person's name, no home path. Fixtures use neutral
  names (`lane-a-project-a`).
- **No D-number is invented.** Departures found while working are written `D-TBD-<slug>` and reported.
- **No behaviour change.** Task 1's twelve cases and the existing `mail-sweep.test.ts` cases stay unchanged and green
  from Task 1 to the end.

## Review Focus

1. **The exact edges.** Quiet holds below exactly `quietMs` (`turnidle.ts#quietRule`, `now - moment < quietMs`) and
   cooldown holds below exactly `cooldownMs` (`now - last < cooldownMs`). A refactor that turns either comparison is
   caught only by Task 1's exact-edge cases, one per subject.
2. **Each gate reads its own field.** Swapping `quietMs` and `cooldownMs` between the two gates passes any test that
   sits well inside both windows. Task 3 Step 5 names the mutation and the Task 1 cases it turns red.
3. **The row is today's fact, nothing looser.** A claimant of a terminal run, a worker and a plain session read the
   worker row; declared coordinator intent alone does not move a session yet. Task 2's role case and the existing
   "does NOT give the narrow window to a session whose only claimed run is TERMINAL" hold it.
4. **One home.** No source keeps a copy of a retired constant, in code (Task 3's pin) or in prose (Task 4's case).
5. **The moved docstrings keep their arguments.** The worker row's "denial of service dressed as coordination" and
   the coordinator row's clause 7 argument move to `mailPace.ts` intact; a reviewer compares them with the deleted
   block in Task 3's diff.

## Tasks

### Task 1: Pin today's pace at each edge, through the lane (characterization, test only)

**Files:**
- Modify: `server/test/mail-sweep.test.ts`, inside `describe('sweepMail: the coordinator quiet window', ...)`, after
  its last case. Nesting reuses that describe's `seedCoordinatorRun` and `seedWorkerRun`.

**Interfaces:**
- Consumes: the file's own helpers `harness`, `store`, `primedWatcher`, `seedRegistry`, `seedHookState`,
  `seedLiveState`, `queueTestDelivery`, `deliveryRow`, `literalSends`, `advance`, the `CoordStore` import, and
  `HAPPY_PANES`, `NUDGE`, `ENVELOPE`, `ID`, `NOW`, `PAST_SWEEP_MS`.
- Produces: nothing a source file reads.

- [ ] **Step 1: Write the test.** Literal numbers on purpose: this is the characterization, and it must not move when a
  mirror or the table moves. Three subjects: a claimant of an open run, a worker on someone else's run, and a plain
  session with no run (the Overlord's case today).

```ts
describe("today's pace at each edge (MAIL_PACE characterization)", () => {
  // Literal, never the mirrors above: a value change is a behaviour change and must turn this red.
  const SUBJECTS = [
    { who: 'a claimant of an open run', seed: seedCoordinatorRun, quietMs: 15_000, cooldownMs: 30_000 },
    { who: 'a worker on another run', seed: seedWorkerRun, quietMs: 60_000, cooldownMs: 120_000 },
    { who: 'a plain session with no run', seed: (_c: CoordStore): void => {}, quietMs: 60_000, cooldownMs: 120_000 },
  ] as const;
  const IDLE_LONG = 61_000; // past every row's quiet time, so only the cooldown can hold the second nudge

  /** `ID`, gate-ready, its live word idle for `idleFor`, with `seed`'s run (or none). */
  const ready = async (seed: (c: CoordStore) => void, idleFor: number, panes: string[] = HAPPY_PANES) => {
    const h = harness({ panes });
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID);
    seedLiveState(h.home, { statusUpdatedAt: NOW - idleFor });
    seed(coord);
    return { h, coord, w };
  };
  /** One nudge lands at NOW; the clock moves on `after`, and a second mail is queued and swept. */
  const secondAfter = async (seed: (c: CoordStore) => void, after: number) => {
    const { h, coord, w } = await ready(seed, IDLE_LONG, [...HAPPY_PANES, ...HAPPY_PANES]);
    queueTestDelivery(coord, ID, ENVELOPE);
    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([NUDGE]);
    advance(after);
    seedLiveState(h.home, { statusUpdatedAt: Date.now() - IDLE_LONG });
    const d = queueTestDelivery(coord, ID, ENVELOPE);
    await w.sweepMail();
    return { h, coord, d };
  };

  it.each(SUBJECTS)('$who: held as not-quiet 1 ms short of its quiet time', async ({ seed, quietMs }) => {
    const { h, coord, w } = await ready(seed, quietMs - 1);
    const d = queueTestDelivery(coord, ID, ENVELOPE);
    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([]);
    expect(deliveryRow(coord, d.id).lastGate).toBe('not-quiet');
  });

  it.each(SUBJECTS)('$who: delivered at exactly its quiet time', async ({ seed, quietMs }) => {
    const { h, coord, w } = await ready(seed, quietMs);
    queueTestDelivery(coord, ID, ENVELOPE);
    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([NUDGE]);
  });

  it.each(SUBJECTS)('$who: held as cooldown 1 ms short of its cooldown', async ({ seed, cooldownMs }) => {
    expect(cooldownMs - 1).toBeGreaterThan(PAST_SWEEP_MS); // past the lane's own re-sweep gate
    const { h, coord, d } = await secondAfter(seed, cooldownMs - 1);
    expect(literalSends(h.calls)).toEqual([NUDGE]);
    expect(deliveryRow(coord, d.id).lastGate).toBe('cooldown');
  });

  it.each(SUBJECTS)('$who: delivered again at exactly its cooldown', async ({ seed, cooldownMs }) => {
    const { h } = await secondAfter(seed, cooldownMs);
    expect(literalSends(h.calls)).toEqual([NUDGE, NUDGE]);
  });
});
```

  The cooldown edges are two cases, not one, because the lane's own cadence (`MAIL_SWEEP_MS`, 10 s) refuses a sweep
  1 ms after the last one, so one harness cannot sweep at both. The hookstate seeded at `NOW` stays fresh across the
  advance (`HOOKSTATE_FRESH_MS` is 30 minutes).
- [ ] **Step 2: Run it on the unchanged tree.** From `server/`:
  `./node_modules/.bin/vitest run test/mail-sweep.test.ts -t 'MAIL_PACE characterization'`. Expected: 12 passed. It
  is green before any source change: that is the point. If an exact edge fails, the clock is not frozen at `NOW` at
  sweep time (the file fakes `Date` alone); find out why before widening a margin, and report a widening as a
  `D-TBD-<slug>`.
- [ ] **Step 3: Prove it bites.** Temporarily set `COORD_QUIET_MS = 16_000` in `watch.ts`: the claimant's "delivered at
  exactly" case goes red. Set `MAIL_COOLDOWN_MS = 119_999`: the worker's and the plain session's "held as cooldown"
  cases go red. Revert both, and confirm `git diff server/src` is empty.
- [ ] **Step 4: Commit.** `test(coord): pin the mail gate's two pace pairs at each edge, for a claimant, a worker and a
  plain session`

### Task 2: The `MAIL_PACE` table and its role decider (L1, C5)

**Files:**
- Create: `server/src/coord/mailPace.ts`. Ring L1 (it declares values and imports nothing); context C5 (the
  `coord/**` row). No ring-context map edit is needed.
- Test: `server/test/mail-pace.test.ts` (new).

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
/** One role's mail pace. Both are measured by the mail lane (`watch.ts`, `mailPass`). */
export interface MailPace {
  /** How long the session's main loop must have read idle before a nudge (`mailTurnIdle`'s `quietMs`). */
  readonly quietMs: number;
  /** No second nudge into one session inside this, from its last landed nudge. */
  readonly cooldownMs: number;
}
export const MAIL_PACE = {
  worker: { quietMs: 60_000, cooldownMs: 120_000 },
  coordinator: { quietMs: 15_000, cooldownMs: 30_000 },
} as const satisfies Readonly<Record<string, MailPace>>;
export type MailPaceRole = keyof typeof MAIL_PACE;
/** THE one choice of a session's pace row until `roleOf` exists: the claimant of an open run is a coordinator. */
export function mailPaceRoleOf(sessionId: string, openCoordinators: ReadonlySet<string>): MailPaceRole;
```

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect } from 'vitest';
import { MAIL_PACE, mailPaceRoleOf } from '../src/coord/mailPace.js';

describe('MAIL_PACE (Overlord spec §6.4, C24 and H19)', () => {
  it("holds today's two rows, and only them", () => {
    expect(MAIL_PACE).toEqual({
      worker: { quietMs: 60_000, cooldownMs: 120_000 },
      coordinator: { quietMs: 15_000, cooldownMs: 30_000 },
    });
  });
  it('a claimant of an open run reads the coordinator row; every other session the worker row', () => {
    const open = new Set(['lane-a-project-a']);
    expect(mailPaceRoleOf('lane-a-project-a', open)).toBe('coordinator');
    expect(mailPaceRoleOf('lane-b-project-a', open)).toBe('worker');
    expect(mailPaceRoleOf('lane-a-project-a', new Set())).toBe('worker');
  });
  it('each row keeps the cooldown longer than the quiet time', () => {
    for (const p of Object.values(MAIL_PACE)) expect(p.cooldownMs).toBeGreaterThan(p.quietMs);
  });
});
```

  The third case states the invariant both of today's rows hold and the docstrings argue (a cooldown spaces nudges
  that each already waited out the quiet). If the role-table plan gives the Overlord a row that breaks it, that plan
  says why.
- [ ] **Step 2: Run it.** From `server/`: `./node_modules/.bin/vitest run test/mail-pace.test.ts`. Expected: the file
  fails to load, because `../src/coord/mailPace.js` does not exist.
- [ ] **Step 3: Implement** the file above. Body of `mailPaceRoleOf`: `openCoordinators.has(sessionId) ? 'coordinator'
  : 'worker'`. Copy the rationale docstrings of `watch.ts`'s four constants onto the two rows (the worker row: ccd's
  `COMPACT_QUIET` argument, the `statusUpdatedAt` argument and "denial of service dressed as coordination"; the
  coordinator row: the clause 7 argument), edited only to name rows instead of constants, so no retired name appears
  in the new file. Cite ccd's constant by name, "`ccd/ccd`'s `COMPACT_QUIET`", never by line number:
  `server/test/citations.test.ts` reds on an added numeric line citation (D-5893's ratchet). The file header says:
  L1, pure, C5; keyed by `MailPaceRole` until `FLEET_ROLES` exists; the Overlord's row and `roleOf` arrive with
  W1a's role-table plan (spec §3.3.9, C49). Do not delete anything from `watch.ts` yet.
- [ ] **Step 4: Run it, and the ring checks.** From `server/`: `./node_modules/.bin/vitest run test/mail-pace.test.ts
  test/rings/totality.test.ts test/rings/outward-edges.test.ts test/citations.test.ts`. Expected: all pass.
- [ ] **Step 5: Mutations.** `return 'worker'` as the body: the role case goes red. Coordinator `quietMs: 16_000`: the
  rows case goes red. Worker `cooldownMs: 60_000`: the cooldown-longer case goes red (and the rows case). Revert.
- [ ] **Step 6: Commit.** `feat(coord): one mail-pace table keyed by role, today's two rows; nothing reads it yet`

### Task 3: The mail lane reads `MAIL_PACE`; the four constants retire

**Files:**
- Modify: `server/src/watch.ts`: delete `MAIL_QUIET_MS`, `MAIL_COOLDOWN_MS`, `COORD_QUIET_MS`, `COORD_COOLDOWN_MS` and
  their docstrings (copied in Task 2). Where the block stood, above `MAIL_WAKE_FLOOR_MS`, keep the block's opening
  sentence ("The mail lane (the seventh; cadence `MAIL_SWEEP_MS`, ...)") and add one line saying a session's quiet
  time and cooldown are its row of `MAIL_PACE` (`coord/mailPace.ts`). Neither line names a retired constant. In
  `mailPass`, replace `isCoordinator` and the two ternaries; add `MAIL_PACE` and `mailPaceRoleOf` to the imports.
- Modify: `server/test/single-definition/core-vocab.test.ts`: a new describe after `'Build 7 nouns'`.
- Test: Task 1's describe and the existing `'sweepMail: the coordinator quiet window'` describe, unchanged.

**Interfaces:**
- Consumes: `MAIL_PACE`, `mailPaceRoleOf` from `./coord/mailPace.js`.
- Produces: no new export. `watch.ts` reads, per delivery row:

```ts
const pace = MAIL_PACE[mailPaceRoleOf(d.toId, coordinators)];
if (now - last < pace.cooldownMs) { gated(d, 'cooldown'); continue; }
// ...
const turn = mailTurnIdle(live, mark, now, pace.quietMs, mode);
```

  The existing comment "THE ONE FACT THIS RUNG ADDS, read once per row" stays above `pace`, reworded to name it.

- [ ] **Step 1: Write the failing single-definition pin.**

```ts
describe('one MAIL_PACE: the mail gate pace has one home (Overlord spec §6.4)', () => {
  const RETIRED = /^\s*(?:export\s+)?const\s+(?:MAIL_QUIET_MS|MAIL_COOLDOWN_MS|COORD_QUIET_MS|COORD_COOLDOWN_MS)\s*=/m;
  it('MAIL_PACE is defined in exactly one file, server/src/coord/mailPace.ts', () => {
    const holders = ALL.filter((f) => /^\s*export\s+const\s+MAIL_PACE\b/m.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['server/src/coord/mailPace.ts']);
  });
  it('no source defines one of the four retired pace constants', () => {
    expect(ALL.filter((f) => RETIRED.test(readFileSync(f, 'utf8'))).map(rel)).toEqual([]);
  });
  it('the mail lane chooses a row once, through mailPaceRoleOf', () => {
    const code = stallCodeText(readFileSync(path.join(ccrcRoot, 'server', 'src', 'watch.ts'), 'utf8'));
    expect(code).toMatch(/import\s*\{[^}]*\bMAIL_PACE\b[^}]*\}\s*from\s*'\.\/coord\/mailPace\.js'/);
    expect(code.match(/\bmailPaceRoleOf\(/g)).toHaveLength(1);
  });
  it('CONTROL: the retired-definition scan catches a planted copy and passes an import', () => {
    expect(RETIRED.test('const COORD_QUIET_MS = 15_000;')).toBe(true);
    expect(RETIRED.test("import { MAIL_PACE } from './coord/mailPace.js';")).toBe(false);
  });
});
```

  `ALL`, `rel`, `ccrcRoot`, `stallCodeText`, `readFileSync` and `path` are already imported by the file.
- [ ] **Step 2: Run it.** From `server/`: `./node_modules/.bin/vitest run test/single-definition/core-vocab.test.ts
  -t 'one MAIL_PACE'`. Expected: the retired-constants case fails, naming `server/src/watch.ts`, and the import case
  fails. The first and the CONTROL pass.
- [ ] **Step 3: Implement** the `watch.ts` change above.
- [ ] **Step 4: Run.** From `server/`: `./node_modules/.bin/vitest run test/single-definition/core-vocab.test.ts
  test/mail-pace.test.ts test/mail-sweep.test.ts test/turnidle.test.ts test/rings/watcher-store-port.test.ts
  test/rings/outward-edges.test.ts test/citations.test.ts test/anchors.test.ts test/typecheck-tests.test.ts`, then
  `./node_modules/.bin/tsc --noEmit -p .`. Expected: all pass, Task 1's 12 cases unchanged. `typecheck-tests` is a
  known load flake: if it alone is red on a timeout, re-run it alone.
- [ ] **Step 5: Mutations.** Replace `mailPaceRoleOf(d.toId, coordinators)` with `'worker'`: the claimant's two
  "delivered" cases in Task 1 and the existing "delivers to a COORDINATOR inside MAIL_QUIET_MS" go red. With
  `'coordinator'`: the worker's and the plain session's two "held" cases in Task 1 and the existing "does NOT deliver
  to a WORKER in that same window" go red. Pass `pace.cooldownMs` to `mailTurnIdle`: all three "delivered at exactly
  its quiet time" cases go red. Re-add `const COORD_QUIET_MS = 15_000;` to `watch.ts`: the retired-constants case goes
  red. Revert each.
- [ ] **Step 6: Commit.** `refactor(coord): the mail gate reads its pace from MAIL_PACE; today's four constants
  retire, its two rows pinned first`

### Task 4: Comments name the table's rows, not the retired constants

**Files:**
- Modify (comments only): `server/src/askwindow.ts` (the `ASK_GRACE_MS` docstring's floor argument),
  `server/src/laneSchedule.ts`, `server/src/coord/caps.ts`, `server/src/coord/delivery.ts`,
  `server/src/coord/store.ts`, and any `watch.ts` comment still naming one (the `mailPass` gate docstring, conjunct 5,
  says "at least `MAIL_QUIET_MS` old (`COORD_QUIET_MS` for a coordinator)").
- Modify: `server/test/single-definition/core-vocab.test.ts`: Task 3's describe gains one case.
- Modify (comments only): the mirror comments in `server/test/mail-sweep.test.ts`, `server/test/turnidle.test.ts`
  and `server/test/deliverability-parity.test.ts`. Each says there is no import path to the real values; there is one
  now. Say instead that the literals mirror `MAIL_PACE`'s rows and stay literal on purpose, so that a value change
  reds the file. The literals themselves, in all five test files, stay.

**Interfaces:** none.

- [ ] **Step 1: Write the failing case.**

```ts
it('no source names a retired pace constant, in code or prose', () => {
  const NAMES = /\b(?:MAIL_QUIET_MS|MAIL_COOLDOWN_MS|COORD_QUIET_MS|COORD_COOLDOWN_MS)\b/;
  expect(ALL.filter((f) => NAMES.test(readFileSync(f, 'utf8'))).map(rel)).toEqual([]);
});
```

- [ ] **Step 2: Run it.** Same command as Task 3 Step 2. Expected: the new case fails, naming six files:
  `server/src/askwindow.ts`, `server/src/laneSchedule.ts`, `server/src/coord/caps.ts`, `server/src/coord/delivery.ts`,
  `server/src/coord/store.ts` and `server/src/watch.ts` (conjunct 5 of `mailPass`'s docstring). A seventh,
  `server/src/coord/mailPace.ts`, means Task 2 copied a retired name: fix it there.
- [ ] **Step 3: Edit the comments.** The replacement words are `MAIL_PACE.worker.quietMs` (60 s),
  `MAIL_PACE.worker.cooldownMs` (120 s), `MAIL_PACE.coordinator.quietMs` (15 s), `MAIL_PACE.coordinator.cooldownMs`
  (30 s), and `coord/mailPace.ts` for the file. Keep each argument; change only the name. Add no numeric line
  citation.
- [ ] **Step 4: Run it**, with `test/citations.test.ts` and `test/anchors.test.ts`. Expected: pass.
- [ ] **Step 5: Mutation.** Put `MAIL_QUIET_MS` back in one comment of `laneSchedule.ts`: the new case goes red,
  naming that file. Revert.
- [ ] **Step 6: Commit.** `docs(coord): comments name MAIL_PACE's rows, never the retired pace constants`

## Deviations found

The programme mints the real numbers when its run opens; until then each entry is named by slug.

- **D-TBD-mail-pace-key-worker** (naming): until `FLEET_ROLES` exists, the `'worker'` key is the row every session
  that is not an open claimant reads today, plain sessions and reviewers included, as the spec's "a worker's pace"
  says. Both keys are `FLEET_ROLES` members, so the role table only adds rows.

**Settled by the spec's later edition, so no longer deviations:** the table ships today's two
rows first, and becomes total over `FLEET_ROLES`, with the Overlord's row, once the role table lands (§14).

## Where things stand

**Before it starts:** the spec, `docs/superpowers/specs/2026-11-09-overlord-design.md`, is on `main`, so the file
header's citation resolves. Nothing else: this plan changes no behaviour and needs neither W0 nor a prerequisite.

**What depends on it:** W1a's role-table plan (`FLEET_ROLES`, `roleOf`) widens the key to `FleetRole`, adds the
Overlord's row and makes the table total. In that plan, keying by `roleOf` moves a session with declared coordinator
intent and no open run onto the coordinator row; spec §6.4 already rules that this is a change of behaviour, made as
a commit of its own with its own test (a case added to Task 1's describe, flipped from the worker pace). Should W1
start before that plan lands, the Overlord reads the worker row, as the spec says it would today.

**Open questions, most important first:**
1. **The Overlord row's values.** Settled: the spec starts the row at the coordinator pair (15 s, 30 s), and the
   lapse measure (M3) moves it (§6.4).
2. **The spec's two readings of the pace column.** Settled: §13's C49 row now agrees with §3.3.9. The pace is an
   L1 record keyed by role, never a column of `FLEET_ROLES`.
3. **The module's home** (for the operator). `coord/mailPace.ts` is a new file beside `coord/delivery.ts`, the L1
   mail delivery policy. Recommendation: keep the new file (see Architecture); the alternative is a section of
   `delivery.ts` with the same exports and the same tests.
