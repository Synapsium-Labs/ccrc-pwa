# Overlord W1a: the mail-pace table becomes total over `FLEET_ROLES`, with the Overlord's own row Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to
> carry out this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status:** Draft, written and built in one run (1883). It follows the merged `w1a-mail-pace.md` (the table with
> today's two rows) and `w1a-roles.md` (`FLEET_ROLES`, `roleOf`). The programme mints the deviation numbers; every
> entry below is a plain-words slug until then.

**Goal:** `MAIL_PACE` has one row for every role in `FLEET_ROLES`, so a role with no row is a compile error. The
Overlord has a row of its own. The mail lane chooses a session's row through `roleOf`, the fleet's one role reader, and
`mailPaceRoleOf` retires. No session that exists today changes pace.

**Why:** The merged table is keyed by a local `MailPaceRole` (`'worker' | 'coordinator'`) and chosen by
`mailPaceRoleOf`, one boolean: is this session the claimant of an open run. Spec §6.4 (C24, H19) asks for the
Overlord's own row, and C49 asks that what a role does live in L1 records keyed by role, each total over
`FLEET_ROLES` and read through one `roleOf`. Without its own row, the Overlord, which claims no run, reads the worker
pair: 60 s of idle, then 120 s between nudges. W0-20 measured that pair as the whole of the Overlord's mail latency:
send to nudge p50 90.3 s, against at most 3.4 s from nudge to its first tool call
(`docs/superpowers/plans/2026-11-11-overlord-w0-spike-results.md`, W0-20).

**Architecture:** All in `server/src/coord/mailPace.ts` (L1, C5) and its one reader, `FleetWatcher.mailPass` in
`server/src/watch.ts` (L4). The table is typed `satisfies Readonly<Record<FleetRole, MailPace>>`. One L1 function
joins it: `mailPaceOf(reading)` answers a `RoleReading`'s row, and an undecided reading takes the slowest of its
members' rows, as spec §3.3.9 rules ("it takes the slower mail pace").

The lane's one line becomes
`mailPaceOf(roleOf(roleFactsOf(d.toId, { child: rec?.child ?? { kind: 'unreadable' }, childRunKind: 'unmeasured',
openCoordinators: coordinators, intentDeclared: 'unmeasured' })))`: it measures the recipient's `.child` mark (from the
registry record the pass already holds) and the claimants of open runs (the set the pass already builds), and hands
them to `roleFactsOf`, the one assembly of `RoleFacts` (`server/src/roleOf.ts`, run 1885's, merged in #2733). The run
kind and declared intent are not read on this path, so they are `unmeasured`. The role and the row are decided in L1.
No new I/O, no wire change, no new route.

**Tech Stack:** TypeScript (ES modules, NodeNext), vitest, the `server/` package only.

**Spec:** `docs/superpowers/specs/2026-11-09-overlord-design.md`: §6.4, C24's bullet "A mail pace of its own" (H19);
§3.3.9, C49 ("What a role does lives in L1 records keyed by role: `MAIL_PACE` (§6.4) and the renewal triggers ... Each
is total over the roles"; "An undecided answer is typed ... it takes the slower mail pace"), and Table 3.3.9a; §11.1,
the row "`renewalDue`, ...; `MAIL_PACE` (C5)"; §14, W1a ("total over `FLEET_ROLES`, with the Overlord's row, once the
role table lands"); §3.8, "As measured (W0b)", W0-20.

## What exists today

- **The table** (`server/src/coord/mailPace.ts`): `MailPace` (`quietMs`, `cooldownMs`); `MAIL_PACE` with two rows,
  `worker` (60 s, 120 s) and `coordinator` (15 s, 30 s), `as const satisfies Readonly<Record<string, MailPace>>`;
  `MailPaceRole = keyof typeof MAIL_PACE`; `mailPaceRoleOf(sessionId, openCoordinators)`, which answers
  `'coordinator'` iff the id is in the set. Its header says the Overlord's row, totality and the move to `roleOf` come
  with the role table.
- **The one reader** is `FleetWatcher.mailPass` (`server/src/watch.ts`). It builds
  `coordinators = new Set(store.openCoordinatorIds())` once per sweep, then for each delivery row reads
  `MAIL_PACE[mailPaceRoleOf(d.toId, coordinators)]` and applies `pace.cooldownMs` (the cooldown gate) and
  `pace.quietMs` (`mailTurnIdle`'s quiet). The registry record of the recipient, `rec`, is found just after the
  cooldown gate, from `records`, the tick's registry read. Each record carries `child: ChildMark`
  (`server/src/registry.ts`, `SessionRecord.child`: `none`, `child` with a run id, or `unreadable`).
- **The role table** (`shared/fleetRoles.ts`, L0, K): `FleetRole` is `overlord | auditor | replay | worker | reviewer
  | coordinator | plain`, in Table 3.3.9a's order. Its header says mail pace is not a column: it is an L1 record keyed
  by role, built by its own piece (this one).
- **The reader** (`server/src/roleOf.ts`, L1, C3): `roleOf(facts)` answers `{kind:'role', role}` or
  `{kind:'undecided', between}`, where `ROLE_AMBIGUITIES` is `worker-or-reviewer` and `coordinator-or-plain`. It tests,
  first match wins: a designation, an audit body, a replay body, the child mark (an unreadable mark, or a child whose
  run kind is not `work` or `review`, reads `worker-or-reviewer`), then a claim or declared intent (`coordinator`),
  then both measured `no` (`plain`), else `coordinator-or-plain`. `ROLE_FACTS_CHILD_AXIS` is the roles plan's constant
  for facts not read on a path: designation `none`, no audit or replay body, run kind, claim and intent `unmeasured`.
  `server/src/coord/stall.ts` already imports from `../roleOf.js`, so a `coord/` file reading it is not a new edge.
- **Tests.** `server/test/mail-pace.test.ts` pins the two rows, `mailPaceRoleOf`'s three answers and
  cooldown > quiet. `server/test/mail-sweep.test.ts`'s describe `"today's pace at each edge (MAIL_PACE
  characterization)"`, nested in `'sweepMail: the coordinator quiet window'`, pins the exact edges through the lane
  for three subjects (a claimant of an open run, a worker on another run, a plain session with no run). Its seeds take
  the store only. `server/test/single-definition/core-vocab.test.ts`'s describe `'one MAIL_PACE: ...'` pins one home,
  the retired constants, and "the mail lane chooses a row once, through mailPaceRoleOf" by reading
  `FleetWatcher.mailPass` through `sourceOfSymbol`.
- **Nothing designates an Overlord yet.** No reader of the designation exists before W1, so every caller of `roleOf`
  passes `designation: 'none'`, and no live session can read the Overlord's row until W1. No audit or replay lane
  exists either (§9.5), so no session reads those rows.
- **Measured on the fleet, 2026-11-13:** the open runs had 13 distinct claimants, and none carries a `.child` mark.
  This is the one fact the move from `mailPaceRoleOf` to `roleOf` could change (Task 3), so no session that exists
  today changes pace.

## Global Constraints

- **Test first.** Every task writes its test and runs it red (Task 1 runs green, as a characterization), then changes
  code.
- **One commit per task**, on the workspace's own branch (`ws/overlord-mail-pace-roles`), with the message the task
  gives.
- **Touch only the files a task names.** The claimed paths are this plan, `server/src/coord/mailPace.ts`,
  `server/src/watch.ts`, `server/test/mail-pace.test.ts`, `server/test/mail-sweep.test.ts` and
  `server/test/single-definition/core-vocab.test.ts`.
- **Run tests through `ccrc test`, one file at a time, from `server/`:**
  `ccrc test -- ./node_modules/.bin/vitest run test/<file>`. Never bare `npx vitest`.
- **Cite code by symbol or anchor** (`file.ts#name`), never by line number (`server/test/citations.test.ts`).
- **Public repository:** no private project, host, account or person's name, no home path. Fixtures use neutral names
  (`lane-a-project-a`).
- **No D-number is invented.** Departures are written as plain-words slugs and listed in the wave-done; the coordinator issues the numbers.
- **No session that exists today changes pace.** Task 1's cases stay unchanged and green from Task 1 to the end. The
  one change of answer, for a session no live session is (a child that claims an open run), is Task 3's own test.
- **Mutations are restored from a saved copy** (`cp` before, `cp` back after), never `git checkout`, and
  `git diff --stat` is read after each restore.

## Review Focus

1. **Totality is a compiler fact.** `satisfies Readonly<Record<FleetRole, MailPace>>` refuses a missing row (TS2741)
   and a stray one (TS2353). Task 2 Step 5 measures both with `tsc`; a looser `Record<string, MailPace>` would compile
   and is held by Task 3's type-level check in `mail-pace.test.ts`.
2. **Undecided takes the slower row, and that is decidable.** `mailPaceOf` picks, for an undecided reading, the
   member whose row is slowest. Task 2 pins that each ambiguity has a member at least as slow as every other member on
   both fields, so "slowest" never has to trade one field against the other. A future row that breaks this reds the
   test before it can pick an arbitrary member.
3. **The facts are what the lane measures, nothing more.** The lane hands `roleFactsOf` the child mark and the open
   claimants, with the run kind and intent `unmeasured`; Task 3's pin holds that call.
   Declared intent stays `unmeasured`: reading it would move a session with intent and no open run onto the
   coordinator row, which spec §6.4 calls a change of behaviour for a commit of its own. That commit is not in this
   plan (mail-lane-facts). A non-claimant therefore reads undecided `coordinator-or-plain` and takes `plain`'s
   row, today's 60 s and 120 s.
4. **The Overlord's row is unreachable today.** Task 2 pins that no combination of the facts the lane passes answers
   `overlord`, `auditor` or `replay`.
5. **The edges hold.** Task 1's exact-edge cases (now five subjects) are unchanged by Tasks 2 and 3.
6. **The Overlord's values.** 15 s and 30 s, its own literals (overlord-row). A reviewer checks the argument in
   the row's docstring against W0-20 and §6.4.

## Tasks

### Task 1: Widen the characterization to the child axis (test only)

The move to `roleOf` reads the child mark, which `mailPaceRoleOf` never read. Pin, on today's code, the pace of the
two child shapes that are not claimants, so the move is proven not to change them.

**Files:**
- Modify: `server/test/mail-sweep.test.ts`, the describe `"today's pace at each edge (MAIL_PACE characterization)"`.

**Interfaces:**
- Consumes: the file's `seedCoordinatorRun`, `seedWorkerRun`, `ID`, `NOW`, `CoordStore`, `path`, `writeFileSync`,
  and the `.cc-sessions` layout `seedRegistry` writes.
- Produces: nothing a source file reads.

- [ ] **Step 1: Write the test.** The seed type gains the fixture home: `seed: (c: CoordStore, home: string) => void`,
  and each `seed(coord)` call becomes `seed(coord, h.home)` (the three existing seeds ignore the second argument). Two
  subjects join `SUBJECTS`, both at the worker pair:

```ts
/** ID is a dispatched child: the worker of someone else's run, its `.child` mark naming that run. */
const seedChildWorker = (coord: CoordStore, home: string): void => {
  const r = coord.openRun({ program: 'program-leverage', title: 'Program leverage', project: 'demo',
    wave: 6, waveOf: 8, claimedBy: 'some-other-coordinator' }) as { id: number };
  coord.markDispatched(r.id, ID, 'demo', 'ws/demo', false, NOW);
  writeFileSync(path.join(home, '.cc-sessions', `${ID}.child`), `${r.id}\n`);
};
/** ID carries a `.child` mark that does not parse, and claims nothing. */
const seedUnreadableChild = (_coord: CoordStore, home: string): void => {
  writeFileSync(path.join(home, '.cc-sessions', `${ID}.child`), 'not-a-run-id\n');
};
// ...
{ who: 'a dispatched child on a work run', seed: seedChildWorker, quietMs: 60_000, cooldownMs: 120_000 },
{ who: 'a session whose child mark is unreadable', seed: seedUnreadableChild, quietMs: 60_000, cooldownMs: 120_000 },
```

  Each case already calls `seedRegistry` before `seed`, so the registry directory exists.
- [ ] **Step 2: Run it on the unchanged tree.** `ccrc test -- ./node_modules/.bin/vitest run test/mail-sweep.test.ts
  -t 'MAIL_PACE characterization'`. Expected: 20 passed (five subjects, four edges).
- [ ] **Step 3: Prove it bites.** Save `src/coord/mailPace.ts`; set the worker row's `quietMs` to `60_001`: the
  "delivered at exactly its quiet time" case goes red for the four subjects on the worker pair, the two new ones among
  them. Restore from the saved copy; `git diff --stat src` is empty.
- [ ] **Step 4: Commit.** `test(coord): the mail-pace characterization covers a dispatched child and an unreadable child mark`

### Task 2: `MAIL_PACE` total over `FLEET_ROLES`, the Overlord's row, and the two deciders (L1, C5)

**Files:**
- Modify: `server/src/coord/mailPace.ts`.
- Test: `server/test/mail-pace.test.ts` (rewritten).

**Interfaces:**
- Consumes: `FleetRole` (type) from `../../shared/fleetRoles.js`; `ROLE_AMBIGUITIES` and `RoleReading` from
  `../roleOf.js`.
- Produces:

```ts
export interface MailPace { readonly quietMs: number; readonly cooldownMs: number }
export const MAIL_PACE = {
  overlord: { quietMs: 15_000, cooldownMs: 30_000 },
  auditor: { quietMs: 60_000, cooldownMs: 120_000 },
  replay: { quietMs: 60_000, cooldownMs: 120_000 },
  worker: { quietMs: 60_000, cooldownMs: 120_000 },
  reviewer: { quietMs: 60_000, cooldownMs: 120_000 },
  coordinator: { quietMs: 15_000, cooldownMs: 30_000 },
  plain: { quietMs: 60_000, cooldownMs: 120_000 },
} as const satisfies Readonly<Record<FleetRole, MailPace>>;
/** A reading's row; an undecided reading takes the slowest member's row. */
export function mailPaceOf(reading: RoleReading): MailPace;
```

  `MailPaceRole` is deleted (the key is `FleetRole`). `mailPaceRoleOf` stays until Task 3 removes its one caller. The
  mail lane's facts are not this file's: they come from `roleFactsOf` (Task 3).

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect } from 'vitest';
import type { ChildMark } from '../../shared/api.js';
import { FLEET_ROLE_NAMES } from '../../shared/fleetRoles.js';
import { ROLE_AMBIGUITIES, roleFactsOf, roleOf, type RoleAmbiguity, type RoleFacts } from '../src/roleOf.js';
import { MAIL_PACE, mailPaceOf } from '../src/coord/mailPace.js';

const WORKER = { quietMs: 60_000, cooldownMs: 120_000 };
const COORDINATOR = { quietMs: 15_000, cooldownMs: 30_000 };
const CHILDREN: readonly ChildMark[] = [{ kind: 'none' }, { kind: 'child', runId: 7 }, { kind: 'unreadable' }];
const LANE_ID = 'lane-a-project-a';
/** The facts `FleetWatcher.mailPass` asks `roleFactsOf` for. */
const laneFacts = (child: ChildMark, claims: boolean): RoleFacts => roleFactsOf(LANE_ID, {
  child, childRunKind: 'unmeasured', openCoordinators: new Set(claims ? [LANE_ID] : ['lane-b-project-a']),
  intentDeclared: 'unmeasured',
});

describe('MAIL_PACE (Overlord spec §6.4, C24, C49 and H19)', () => {
  it('has a row for every role in FLEET_ROLES, in its order, and no other', () => {
    expect(Object.keys(MAIL_PACE)).toEqual([...FLEET_ROLE_NAMES]);
  });
  it("today's two rows keep their values; the Overlord's row starts at 15 s and 30 s", () => {
    expect(MAIL_PACE).toEqual({
      overlord: COORDINATOR, auditor: WORKER, replay: WORKER, worker: WORKER,
      reviewer: WORKER, coordinator: COORDINATOR, plain: WORKER,
    });
  });
  it('each row keeps the cooldown longer than the quiet time', () => {
    for (const p of Object.values(MAIL_PACE)) expect(p.cooldownMs).toBeGreaterThan(p.quietMs);
  });
});

describe('mailPaceOf: a reading picks its row', () => {
  it('a decided role reads its own row', () => {
    for (const role of FLEET_ROLE_NAMES) expect(mailPaceOf({ kind: 'role', role })).toBe(MAIL_PACE[role]);
  });
  it('each ambiguity has a member at least as slow as every other on both fields', () => {
    for (const a of Object.keys(ROLE_AMBIGUITIES) as RoleAmbiguity[]) {
      const rows = ROLE_AMBIGUITIES[a].map((r) => MAIL_PACE[r]);
      const slowest = rows.find((s) => rows.every((r) => s.quietMs >= r.quietMs && s.cooldownMs >= r.cooldownMs));
      expect(slowest, a).toBeDefined();
    }
  });
  it('an undecided reading takes the slower row (spec §3.3.9)', () => {
    expect(mailPaceOf({ kind: 'undecided', between: 'coordinator-or-plain' })).toEqual(WORKER);
    expect(mailPaceOf({ kind: 'undecided', between: 'worker-or-reviewer' })).toEqual(WORKER);
  });
});

describe("the mail lane's facts (roleFactsOf over the child mark and the claim), and today's answers", () => {
  it('a claimant with no child mark reads the coordinator row; a non-claimant the worker pair', () => {
    expect(mailPaceOf(roleOf(laneFacts({ kind: 'none' }, true)))).toEqual(COORDINATOR);
    expect(mailPaceOf(roleOf(laneFacts({ kind: 'none' }, false)))).toEqual(WORKER);
  });
  it('every child shape that claims nothing reads the worker pair', () => {
    for (const c of CHILDREN) expect(mailPaceOf(roleOf(laneFacts(c, false))), JSON.stringify(c)).toEqual(WORKER);
  });
  it("no fact the lane passes selects the Overlord's, an auditor's or a replay body's row", () => {
    for (const c of CHILDREN) for (const claim of [true, false]) {
      const r = roleOf(laneFacts(c, claim));
      if (r.kind === 'role') expect(['overlord', 'auditor', 'replay']).not.toContain(r.role);
    }
  });
  it('declared intent is not read: a non-claimant stays undecided, never a coordinator', () => {
    expect(roleOf(laneFacts({ kind: 'none' }, false))).toEqual({ kind: 'undecided', between: 'coordinator-or-plain' });
  });
});
```

- [ ] **Step 2: Run it.** `ccrc test -- ./node_modules/.bin/vitest run test/mail-pace.test.ts`. Expected: the file
  fails, because `mailPaceOf` is not exported.
- [ ] **Step 3: Implement.** The table above, each row with its docstring: the worker and coordinator rows keep
  theirs word for word; `plain` and `reviewer` say they read the worker pair for the worker row's reason; `auditor` and
  `replay` say they have no lane before §9.5 and take the worker pair until their lanes measure otherwise
  (auditor-replay-rows); `overlord` carries the argument of overlord-row. `mailPaceOf`: a decided role
  reads `MAIL_PACE[role]`; an undecided one reduces its members' rows to the one with the larger `quietMs`, then the
  larger `cooldownMs`. The header is rewritten: keyed by `FleetRole`, total, chosen through `roleOf`; the facts the
  lane passes and why intent is not read; the Overlord's row unreachable until W1's designation reader.
- [ ] **Step 4: Run it, and the rings.** `ccrc test -- ./node_modules/.bin/vitest run test/mail-pace.test.ts`, then
  the same for `test/rings/totality.test.ts`, `test/rings/outward-edges.test.ts` and `test/citations.test.ts`, then
  `ccrc test -- ./node_modules/.bin/tsc --noEmit -p .`. Expected: all pass.
- [ ] **Step 5: Mutations** (each from a saved copy, restored after). Delete the `replay` row: `tsc` reports TS2741
  (`replay` missing), and the keys case goes red. Add a row `operator: { ... }`: `tsc` reports TS2353. Make
  `mailPaceOf` take the faster member: the undecided case goes red. Drop the lane's absent-record fallback (`?? { kind:
  'none' }`): Task 5's lane test goes red. Pass `intentDeclared: false`: the "intent is not read" case goes
  red.
- [ ] **Step 6: Commit.** `feat(coord): MAIL_PACE is total over FLEET_ROLES, with the Overlord's own row; a reading picks its row`

### Task 3: The mail lane reads its row through `roleOf`; `mailPaceRoleOf` retires

**Files:**
- Modify: `server/src/watch.ts`, `FleetWatcher.mailPass`: the registry lookup `const rec = records.find(...)` moves
  above the pace line (a pure lookup, no gate moves), and the pace line becomes
  `const pace = mailPaceOf(roleOf(roleFactsOf(d.toId, { child: rec?.child ?? { kind: 'unreadable' }, childRunKind:
  'unmeasured', openCoordinators: coordinators, intentDeclared: 'unmeasured' })));`. The comment above it says which
  facts are read and that the row is decided in L1. The imports gain `mailPaceOf` from `./coord/mailPace.js` and
  `roleFactsOf` and `roleOf` from `./roleOf.js`, and drop `MAIL_PACE` and `mailPaceRoleOf`. The
  `mailPass` docstring's conjunct 5 says "its row of `MAIL_PACE`" in place of naming two rows.
- Modify: `server/src/coord/mailPace.ts`: delete `mailPaceRoleOf`.
- Modify: `server/test/single-definition/core-vocab.test.ts`: the describe `'one MAIL_PACE: ...'`.
- Modify: `server/test/mail-sweep.test.ts`: one new describe after the characterization, for the one change of
  answer.

**Interfaces:**
- Consumes: Task 2's exports; `roleOf` from `./roleOf.js`.
- Produces: no new export.

- [ ] **Step 1: Write the failing pins.** In `core-vocab.test.ts`, the case "the mail lane chooses a row once,
  through mailPaceRoleOf" becomes two:

```ts
it('the mail lane chooses a row once, through roleOf', () => {
  const code = stallCodeText(sourceOfSymbol(path.join(ccrcRoot, 'server', 'src', 'watch.ts'), 'FleetWatcher.mailPass'));
  expect(code.match(/\bmailPaceOf\(roleOf\(roleFactsOf\(d\.toId,\s*\{\s*child:[^,]+,\s*childRunKind:\s*'unmeasured',\s*openCoordinators:\s*coordinators,\s*intentDeclared:\s*'unmeasured'\s*\}\)\)\)/g)).toHaveLength(1);
  expect(code.match(/\broleOf\(/g)).toHaveLength(1);
});
it('the row is chosen in coord/mailPace.ts only: no other source indexes MAIL_PACE, and mailPaceRoleOf is gone', () => {
  const INDEX = /\bMAIL_PACE\s*(?:\[|\??\.\s*[A-Za-z_$])|\}\s*=\s*MAIL_PACE\b/; // brackets, a dot, ?. or a destructuring
  expect(ALL.filter((f) => INDEX.test(stallCodeText(readFileSync(f, 'utf8')))).map(rel)).toEqual(['server/src/coord/mailPace.ts']);
  expect(ALL.filter((f) => /\bmailPaceRoleOf\b/.test(readFileSync(f, 'utf8'))).map(rel)).toEqual([]);
});
```

  In `mail-pace.test.ts`, a type-level check that the table's keys are exactly `FleetRole`, which
  `typecheck-tests` compiles, and one case that references it:

```ts
type SameKeys<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const MAIL_PACE_IS_TOTAL: SameKeys<keyof typeof MAIL_PACE, FleetRole> = true;
```

  It holds totality even if the table's `satisfies` is ever loosened. A text pin over `mailPace.ts` was tried first
  and dropped: a literal source read of a `server/src` file with no ARCH-06 ceiling row reds
  `single-definition/advance-switches.test.ts`'s ratchet ("literal source pins ... may only shrink"), and
  `scan/symbols.ts` indexes functions, not `const` declarations (mail-pace-total-type-pin).

  In `mail-sweep.test.ts`, after the characterization describe and inside the same outer describe:

```ts
// The one answer the move to roleOf changes (Table 3.3.9a tests the child mark before the claim). Measured
// 2026-11-13: no claimant of an open run carries a `.child` mark, so no session that exists today is this subject.
describe('a child that claims an open run reads the worker pair (roleOf, Table 3.3.9a)', () => {
  it.each([
    ['a dispatched child', (home: string, runId: number) => `${runId}\n`],
    ['an unreadable child mark', (_home: string, _runId: number) => 'not-a-run-id\n'],
  ])('%s that claims an open run is held as not-quiet inside the worker quiet time', async (_who, mark) => {
    const h = harness({ panes: HAPPY_PANES });
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    seedRegistry(h.home, ID);
    seedHookState(h.home, ID);
    seedLiveState(h.home, { statusUpdatedAt: NOW - 15_000 });
    const r = coord.openRun({ program: 'program-leverage', title: 'Program leverage', project: 'demo',
      wave: 6, waveOf: 8, claimedBy: ID }) as { id: number };
    writeFileSync(path.join(h.home, '.cc-sessions', `${ID}.child`), mark(h.home, r.id));
    const d = queueTestDelivery(coord, ID, ENVELOPE);
    await w.sweepMail();
    expect(literalSends(h.calls)).toEqual([]);
    expect(deliveryRow(coord, d.id).lastGate).toBe('not-quiet');
  });
});
```

- [ ] **Step 2: Run them.** `ccrc test -- ./node_modules/.bin/vitest run test/single-definition/core-vocab.test.ts
  -t 'one MAIL_PACE'`: the two lane cases fail (the lane still calls `mailPaceRoleOf`). The type-level check
  already compiles, because Task 2 typed the table. `ccrc test --
  ./node_modules/.bin/vitest run test/mail-sweep.test.ts -t 'a child that claims'`: both cases fail (today's lane
  delivers at 15 s to any claimant).
- [ ] **Step 3: Implement** the `watch.ts` and `mailPace.ts` changes above.
- [ ] **Step 4: Run.** From `server/`, one file at a time through `ccrc test`: `test/mail-pace.test.ts`,
  `test/mail-sweep.test.ts` (the characterization's 20 cases unchanged and green),
  `test/single-definition/core-vocab.test.ts`, every other `test/single-definition/*.test.ts`, every
  `test/rings/*.test.ts`, every test that names `MAIL_PACE`, `mailPaceRoleOf` or `roleOf` (`git grep -l`),
  `test/turnidle.test.ts`, `test/dtbd.test.ts`, `test/anchors.test.ts`, `test/citations.test.ts`,
  `test/typecheck-tests.test.ts`, and `test/deviation-refs.test.ts` after `git fetch origin main`; then
  `ccrc test -- ./node_modules/.bin/tsc --noEmit -p .`.
- [ ] **Step 5: Mutations** (each from a saved copy, restored after). In `mailPass`, pass `{ kind: 'none' }` for the
  child: the two new `mail-sweep` cases go red (the child claimant reads the coordinator pair again). Pass `undefined`
  for the child: the claimant's characterization cases go red (an unmeasured child reads undecided, so the claimant
  takes the worker pair). Pass `false` for the claim: the claimant's characterization cases go red. Replace the pace
  line with `MAIL_PACE.worker`: the claimant's cases and the "chooses a row once" pin go red. Re-add an
  `export function mailPaceRoleOf` to `mailPace.ts`: the "gone" pin goes red. Loosen the `satisfies` to
  `Record<string, MailPace>` and delete the `replay` row: the test project's typecheck reds on
  `MAIL_PACE_IS_TOTAL`.
- [ ] **Step 6: Commit.** `refactor(coord): the mail lane reads its pace row through roleOf; mailPaceRoleOf retires`

### Task 4: The lane assembles no role facts of its own; `mailPaceOf` joins the mutation floors

The coordinator ruled (mail, 2026-11-13) that `roleFactsOf`, the one assembly of `RoleFacts`, is run 1885's (Task 0 of
`w1a-renewal-deciders.md`), and that no other run writes a second. Before #2733 merged, the lane spread `roleOf.ts`'s
`ROLE_FACTS_CHILD_AXIS` and overrode the child mark and the claim, which gives the same facts; the first version of
this branch, at review 1895, shipped that way. Task 5 moved it onto `roleFactsOf`.

**Files:**
- Create: `server/test/sim/mailPaceSets.ts` (`mailPaceOfCases`, written once, and `MAIL_PACE_MUTANT_SETS`, the
  mutants P1 to P4), run against the real module by `server/test/mail-pace.test.ts`.
- Modify (append-only, the coordinator's ruling): `server/test/sim/mutation-floors.test.ts` (spread
  `MAIL_PACE_MUTANT_SETS` into `MUTANT_SETS`) and `server/test/sim/mutation-floors.json`
  (`"server/src/coord/mailPace.ts#mailPaceOf": 1`), D-8217's rule for a new L1 decider. Each run adds only its own
  rows, and the second to land takes the union.

- [ ] **Step 1: The floor.** `test/sim/mutation-floors.test.ts`: every mutant of `mailPaceOf` killed, score 1. One
  mutant is left out as equivalent today (dropping `slower`'s `cooldownMs` tiebreak), because no ambiguity has two
  members with equal quiet times and different cooldowns.
- [ ] **Step 2: Commit.** `test(sim): mailPaceOf joins the mutation floors (D-8217), floor 1`

### Task 5: Fix round 18329: merge `main`, the lane onto `roleFactsOf`, and review 1895's carries

The merge queue dropped #2737 when another W1a piece's floor rows reached `main`, and #2733 put `roleFactsOf` on
`main`.

**Files:**
- Merge: `origin/main` once. The two floor files conflict only in appended rows, and the resolution is their union.
- Modify: `server/src/watch.ts` (the lane asks `roleFactsOf(d.toId, { child: rec?.child ?? { kind: 'unreadable' },
  childRunKind: 'unmeasured', openCoordinators: coordinators, intentDeclared: 'unmeasured' })`),
  `server/src/coord/mailPace.ts` (the header names `roleFactsOf`), `server/test/mail-pace.test.ts` (the lane's facts
  through `roleFactsOf`), `server/test/single-definition/core-vocab.test.ts` (the lane pin matches that call, with the
  run kind and intent `unmeasured`).
- F1: `server/test/mail-sweep.test.ts`, a lane test for a recipient missing from the registry. A claimant of an open
  run is nudged once and then drops out of the registry. A second mail 31 s later is held `cooldown`, because its
  child mark is unmeasured and it takes the worker pair, never the coordinator's 30 s.
- F3: `server/test/single-definition/core-vocab.test.ts`, the `MAIL_PACE` index pin sees a read by brackets, a dot,
  `?.` or a destructuring, with a CONTROL case for each and for an import and a type use.
- F4: this plan's Tasks 2 and 3 describe what the branch holds, not the retired `mailLaneRoleFacts`.

- [ ] **Step 1: Mutations.** The fallback set to `{ kind: 'none' }`: F1's case reds (`registry-absent`, not
  `cooldown`). A `MAIL_PACE.worker` read planted in `watch.ts`: F3's pin reds. `intentDeclared: false` in the lane:
  the "chooses a row once, through roleOf" pin reds. `openCoordinators` an empty set: the claimant's two "delivered"
  edges red. Restore each from a saved copy.
- [ ] **Step 2: Commit** each part on its own; F4 in a commit with a `Ledger-Edit` trailer, which is the head commit.

## Where this plan differs from the reference draft

Before its scope changed, run 1880 drafted a plan for this piece (`w1a-overlord-pace.md`, on its branch at
`fb8b4fb7a`). This plan takes from it the row values, the undecided-takes-the-slower rule and the mutation floor for
the new decider. It differs in three places:
- **The intent move is not here.** The draft's Task 3 moves a session with declared intent and no open run onto the
  coordinator row. This piece's brief rules that no session that exists today changes pace, so the lane passes
  intent `unmeasured` (mail-lane-facts), and the move waits for a commit that reads intent on this path.
- **No `roleFactsOf` here.** The draft added it to `roleOf.ts`; run 1885 owns it (Task 4).
- **The child mark is read.** The draft's facts read the child mark too, but did not name the one answer that changes:
  a child that claims an open run. This plan pins it with its own test and measured that no live session is one
  (mail-lane-child-claimant).

## Measured while building (2026-11-13)

- **Task 1:** 20 cases green on the old code; the worker row at `quietMs: 60_001` reds the four "delivered at exactly
  its quiet time" cases on the worker pair, the two child subjects among them.
- **Task 2:** 11 cases red first (exports missing), then green. Mutations, each red: delete the `replay` row (TS2741,
  TS7053; two cases), a stray `operator` row (TS2353; two cases), the faster member (three cases), no absent-record
  fallback (one), intent `no` (one), designation `live` (four), the Overlord's row at the worker pair (one).
- **Task 3:** the two lane pins and the two child-claimant cases red first, then green. Mutations, each red: the child
  passed as `none` (both child-claimant cases), as `undefined` (the claimant's two "delivered" edges), the claim
  passed as `false` (the same two), a fixed worker row (the "chooses a row once" pin and the same two edges),
  `mailPaceRoleOf` re-added (the "gone" pin), a second index of `MAIL_PACE` in `watch.ts` (the same pin), and a
  loosened `satisfies` with the `replay` row deleted (the test project's typecheck: TS2322 on `MAIL_PACE_IS_TOTAL`).
- **Suites:** `mail-pace`, `role-of`, `roll-target`, `session-role-view`, `stall-vocabulary`, `turnidle`, `anchors`,
  `citations`, `deviation-refs` (after `git fetch origin main`), every `single-definition/*` and every `rings/*` file
  green; the server typecheck and the test project's typecheck clean. `mail-sweep.test.ts` ran in five chunks (the
  whole file outran the test slice under load and its worker was killed): every case green but three. Two passed alone
  (a hibernated recipient's ensure, and a stash-failed park), so they were load. The third, "a DELIVERED row never
  parks as rejected on repeated replay failures", times out at its 20 s bound alone, and does so on the code before
  Task 3's switch too: ten sweeps at about 2 s each on this box. CI on a quiet runner is its arbiter. Measured on a clean `origin/main` (6d9c27d21) in scratch: the same timeout,
  so it is not this branch's.
- **Task 4:** the mutation floor for `mailPaceOf` (`"server/src/coord/mailPace.ts#mailPaceOf": 1`) passes, every mutant
  P1 to P4 killed; adding the equivalent tiebreak mutant reds it (`survived`), so the floor bites. The coordinator ruled
  (2026-11-13) that the floors file and the `MUTANT_SETS` spread are append-only: each run adds its own rows, and the
  second to land takes the union.
- **Task 5 (fix round 18329):** the merge of `origin/main` conflicted only in the two floor files' appended rows, and
  their union has 11 floors. F1's case reds when the fallback is `none` (`registry-absent`, not `cooldown`). F3's pin
  reds on a planted `MAIL_PACE.worker` read. The lane's pin reds on `intentDeclared: false`, and the claimant's two
  edges red on an empty `openCoordinators`. Then every review suite was green: `mail-pace`, `mail-sweep` in six chunks
  (all 176 cases, the replay-backoff case among them at a lower load), `role-of`, `roll-target`, `session-role-view`,
  `stall-vocabulary`, `turnidle`, `sim/mutation-floors`, every `rings/*` and `single-definition/*` file, `dtbd`,
  `anchors`, `citations`, `deviation-refs`, `growth-check`, `typecheck-tests`, and both type checks. One
  `advance-switches` case (D-6111's pin scan) timed out at 29 s under load and passed alone.

## Deviations found

Each is a plain-words slug; the coordinator issues the numbers.

- **overlord-row** — The Overlord's row is 15 s of quiet and 30 s of cooldown, written as its own literals with
  its own docstring, never a reference to the coordinator's row, so the lapse measure (M3) can move one without the
  other. The values are spec §6.4's starting point ("Its row starts at the coordinator's pair"), and W0-20 supports
  them: its gate waited p50 90.3 s under the worker pair, which a 30 s cooldown cuts to at most one cooldown plus a
  sweep; its turns from nudge to reply ran p50 6.3 s and max 20.1 s, all inside 30 s, so the cooldown does not cut
  into a turn's next mail; and a quiet time under the lane's 10 s sweep (`MAIL_SWEEP_MS`) would buy nothing.
- **auditor-replay-rows** — `auditor` and `replay` take the worker pair. Neither has a lane before §9.5, so no
  session reads them; their lanes size them when they land.
- **mail-pace-undecided-slowest** — `mailPaceOf` reads an undecided reading as the slowest member's row, the
  member that does less (spec §3.3.9). A test pins that each ambiguity has a member slowest on both fields.
- **mail-lane-facts** — The mail lane passes `designation: 'none'`, no audit or replay body, run kind
  `unmeasured` and declared intent `unmeasured`. It reads only the child mark and the claim, both already in the pass.
  Reading intent would move a session with declared intent and no open run onto the coordinator row; spec §6.4 rules
  that a change of behaviour for a commit of its own, and the brief rules that no session changes pace in this piece.
  So that move waits for the piece that reads intent on this path.
- **mail-lane-child-claimant** — A session with a `.child` mark (readable or not) that claims an open run now
  reads the worker pair, where `mailPaceRoleOf` gave it the coordinator pair: `roleOf` tests the child mark before the
  claim (Table 3.3.9a). Measured 2026-11-13: none of the 13 claimants of open runs carries a `.child` mark, so no
  session that exists today changes pace. Pinned by Task 3's own test.
- **mail-pace-total-type-pin** — The brief's "a role with no row is a compile error" is held twice: by the
  table's `satisfies` and by a type-level exact-key check in `mail-pace.test.ts`. A source-text pin was not used: a
  literal read of `mailPace.ts` reds the ARCH-06 ratchet (`single-definition/advance-switches.test.ts`), and
  `scan/symbols.ts` does not index a `const`.
- **mail-lane-no-assembly** — The lane assembles no role facts of its own: it hands its two measured facts to
  `roleFactsOf` (run 1885's, merged in #2733), never a builder of this piece (the coordinator's ruling of 2026-11-13).
  Until #2733 merged, it spread `ROLE_FACTS_CHILD_AXIS` with the same answers. The absent-record fallback
  (`?? { kind: 'unreadable' }`) sits in the lane, because `roleFactsOf` takes a measured `ChildMark`.
- **mail-lane-absent-recipient** — A recipient the registry does not list has no child fact. It is read as a
  mark that could not be measured (`unreadable`), which spec §3.3.9 reads as undecided, so it takes the worker pair.
  The cooldown gate still runs before the registry ladder, so such a row, if it claims an open run and was nudged in
  the last 120 s, is held `cooldown` up to 90 s longer before the ladder parks it.

## Where things stand

**Needed before it starts:** the merged `w1a-mail-pace.md` (#2528's table) and `w1a-roles.md` (#2624's role table).
Both are on `main`.

**What depends on it:** W1's designation reader passes `designation` to `roleOf`; then, and only then, a live
session reads the Overlord's row. The piece that reads declared intent on the mail path moves intent-only sessions
onto the coordinator row, as its own commit with its own test (spec §6.4). The audit and replay lanes (§9.5) size
their rows. The lapse measure (M3) moves the Overlord's row.

**Open questions, most important first:**
1. **The Overlord row's values.** Taken from spec §6.4 (15 s, 30 s), argued from W0-20 above. If the coordinator
   reads the brief's "not a copy of the coordinator's" as asking for different numbers, this is a one-row change.
2. **The child-claimant change.** Kept, because `roleOf`'s order is the spec's, and measured to touch no live
   session. The alternative, a mail-lane exception that puts the claim first, would give the fleet two readings of
   one role, which C49 exists to end.
