# Overlord W1a, piece 1: one role vocabulary (`FLEET_ROLES`) and one reader (`roleOf`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to carry out this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status:** Draft, from the Overlord spec's hardened edition (rev 8 plus H1 to H39). Nothing here waits on D-8126
> (spec §14: W1a needs neither prerequisite). The programme mints the deviation numbers; every entry below is
> `D-TBD-<slug>`.

**Goal:** One L0 table names every role a fleet session can have, one L1 reader decides a session's role from
measured facts, first match wins, and today's `SessionRole` (`coordinator | child`) is computed through that reader
with today's answers pinned first, so nothing anyone sees changes.

**Why:** The tree has more than one answer to "what is this session". `SessionRole` calls every session that is not a
child a coordinator; the coordination store calls a session a coordinator only when it claims a non-terminal run; the
delegation lane counts declared intent; the stall watch has its own three words. The spec (C49, H1) asks for one
vocabulary of seven roles, read by one `roleOf`, so the roll lane, the card and the renewal lane later read one
answer, and each long-life fix (launch profile, card, compaction text, probes) becomes a column of one table instead
of a list per fix. This piece ships only what can exist before the Overlord does: the table with the columns whose
values exist today, `roleOf` proven over every input combination, `SessionRole` as a view of it, and the
single-definition pins. The `overlord`, `auditor` and `replay` rows are declared, but the facts that select them have
no reader before their waves, so `roleOf` never answers them in production yet.

**Architecture:** `shared/fleetRoles.ts` (L0, kernel K) holds `FleetRole`, `FleetRoleRow`, `FLEET_ROLES` and
`FLEET_ROLE_NAMES`. `server/src/roleOf.ts` (L1, C3 Session Conversation) holds `RoleFacts`, `RoleReading`, `roleOf`,
`sessionRoleOfReading` and the view `sessionRoleOf`, which moves there from `shared/api.ts`. No wire change, no
`FLEET_PROTO` bump, no new route, no new reader of any file.

**Tech Stack:** TypeScript, vitest. One suite: `cd server && ./node_modules/.bin/vitest run test/<file>.test.ts`.
Typechecks: `cd server && ./node_modules/.bin/tsc --noEmit` (src and `shared/`), `cd server &&
./node_modules/.bin/tsc -p test/tsconfig.tests.json` (the server tests, as `typecheck-tests.test.ts` runs it),
`cd pwa && ./node_modules/.bin/tsc --noEmit` and `cd agent && ./node_modules/.bin/tsc --noEmit` (both include all of
`shared/`; pwa's has `verbatimModuleSyntax`, so a type import must be `import type`).

**Spec:** `docs/superpowers/specs/2026-11-09-overlord-design.md`:
- §3.3.9, call C49: "One table", "One reader", and Table 3.3.9a (the roles, in the order `roleOf` tests them);
- §3.6, call H1: "One role vocabulary (C49)", the vocabulary only (the launch profile is another W1a piece);
- §3.2 and §3.6 H4: "`roleOf` reads a pending row as `overlord`"; §9.5: the auditor and replay rows;
- §11.1, the inventory rows for `FLEET_ROLES` and `roleOf` ("Where a fact is unmeasured `roleOf` answers a typed
  undecided reading, never a guess") and for `MAIL_PACE` and the renewal triggers (L1 records keyed by role);
- §14, the W1a row: "The one role table and its launch profiles". This piece is the table; the profiles follow.

## What exists today

Measured in the tree at `681cea9a1` (`origin/main`, 2026-11-09). Cited by symbol.

| Reading | Where | What it decides |
|---|---|---|
| `SessionRole = 'coordinator' \| 'child'`, `SESSION_ROLE_MAP`, `SESSION_ROLES`, `isSessionRole` | `shared/api.ts#SessionRole` | The wire's two words |
| `sessionRoleOf(child: ChildMark): SessionRole` | `shared/api.ts#sessionRoleOf` | `none` is `coordinator`; `child` and `unreadable` are `child` |
| `ChildMark` (`none`, `child` with `runId`, `unreadable`) | `shared/api.ts#ChildMark` | The registry's three-way reading of `$REG/<id>.child` |
| `FleetSession.role`, computed as `role: sessionRoleOf(r.child)` | `server/src/fleet.ts#assembleFleetWithPanePids` | The badge and the card's role cell (D-8142); the PWA's one reader is `pwa/src/fleet/sessionFacts.ts#coordinatorRole` |
| `reviveSessionRole` | `shared/api.ts#reviveFleetSession` | Absent or null revives `null` ("does not say") |
| `rollTargetVerdict(targets, role)` | `server/src/coord/rollTarget.ts#rollTargetVerdict` | The roll lane takes only `coordinator`; `null` skips `role-unknown` |
| `stallCoordBlockedInner` calls `sessionRoleOf(input.child)` after refusing `unlisted` | `server/src/coord/stall.ts#stallCoordBlockedInner` | A child is never a blocked coordinator |
| `StallSessionRole = 'worker' \| 'coordinator' \| 'other'` | `server/src/coord/stall.ts#StallSessionRole` | Which stall arms judge a subject: chosen by the lane's subject loop in `server/src/watch.ts` (a run's worker, a run's claimant, any other row) |
| `openCoordinatorIds()` | `server/src/coord/store.ts#openCoordinatorIds` | `claimedBy` of every non-terminal run; the mail gate's `isCoordinator` |
| `programmeCoordinator`, `claimsProgramme` | `server/src/coord/store.ts#claimsProgramme` | A programme's coordinator; throws on an unreadable run series |
| `claimant-is-a-worker` | `server/src/coord/openRun.ts` (`claimantWorker` arm) | A dispatched worker may not claim a run |
| `deriveCoordinatorIntentByParent`, `declareCoordinatorIntent` | `server/src/coord/delegation-model.ts#deriveCoordinatorIntentByParent` | Declared intent, per (session id, incarnation), in the delegation checkpoint |
| `RunKind = 'work' \| 'review' \| 'unknown'`, `RUN_KINDS` | `shared/api.ts#RunKind` | `unknown` is never written; it is a newer build's word |
| `WORKER_KICKOFF_PREFIX`, `REVIEWER_KICKOFF_PREFIX`, `kickoffPrefixFor(kind)` | `server/src/coord/dispatch.ts#kickoffPrefixFor` | Which skill a child's brief invokes, by run kind |
| `_hook_role_card` | `ccd/session-hook.sh#_hook_role_card` | Bash: a row with no `.child`, no hold and no card-off switch is told it is its project's coordinator and to load the coordinator skill (D-8142) |
| `MAIL_QUIET_MS` 60 s, `MAIL_COOLDOWN_MS` 120 s, `COORD_QUIET_MS` 15 s, `COORD_COOLDOWN_MS` 30 s | `server/src/watch.ts` | Mail pace, keyed on "claims an open run", not on a role |

Does not exist today: `FleetRole`, `FLEET_ROLES`, `roleOf`, the designation row, the audit and replay lanes, launch
profiles, compaction instructions, probes, `renewalDue`, `MAIL_PACE`.

Existing pins this piece keeps green with no assertion changed: `server/test/fleet.test.ts` ("assembleFleet: the
session role (D-5301)"), `server/test/roll-target.test.ts` (Task 4 changes its import only),
`server/test/stall-coord-blocked.test.ts`, and the D-5301 block of `server/test/single-definition/ask-digest.test.ts`
(Task 4 moves one holder path and the titles that name it).

## Global Constraints

- Test first: every new test is run and seen red (or, for a characterization, green on today's code) before the code.
- One commit per task, on the workspace branch; Task 4 is two commits, a move then a re-derivation (CLAUDE.md's
  characterization rule).
- Touch only the files a task names.
- Run suites from inside the package, in the foreground, timeout at least 600000 ms; never bare `npx vitest`.
- Every new guard names the mutation that turns it red, and that mutation is measured red, then reverted.
- `shared/*.ts` imports only `./` siblings, and here only by `import type` (`server/test/rings/shared-imports.test.ts`).
- No wire change: no new `FleetSession` field, no `FLEET_PROTO` bump.
- Cite code by symbol or `#@anchor`, never by line number.
- Public repository: no private names; fixtures use neutral values (`lane-a`, `project-a`, run ids such as `7`).
- No D-numbers invented: new entries are `D-TBD-<slug>` until the programme mints them.

## Review Focus

1. **An unreadable `.child` marker stays a child.** It must never read as a coordinator, so the roll lane never takes
   it. Pinned by Task 1 (today) and Task 3's row "an unreadable marker is undecided between worker and reviewer",
   with Task 3's view assertion mapping that ambiguity to `child`.
2. **An unmeasured claim or intent is never folded into `plain` or `coordinator`.** Task 3's row "an unmeasured claim
   is never read as no" and the combination bucket for rule 7.
3. **A child of a run kind this build cannot name** (`unknown`, a newer build's word) stays a child, undecided
   between worker and reviewer. Task 3's row "a child of a run whose kind this build cannot name is undecided".
4. **A row missing a column, or a column added with a row left unfilled, does not compile.** Task 2's
   `@ts-expect-error` case, checked by the test typecheck.
5. **An older snapshot whose `role` is absent still revives `null`, and the roll lane skips it `role-unknown`.**
   Nothing here touches `reviveSessionRole`; `server/test/fleet.test.ts` and `server/test/roll-target.test.ts` stay
   green through Task 4.

---

### Task 1: Pin today's `SessionRole` answers

**Files:**
- Test (create): `server/test/session-role-view.test.ts`

**Interfaces:**
- Consumes: `sessionRoleOf`, `ChildMark` (`shared/api.ts`); `rollTargetVerdict` (`server/src/coord/rollTarget.ts`).
- Produces: nothing in `src`.

- [ ] **Step 1: Write the characterization test.** It must pass on today's code.

```ts
import { describe, expect, it } from 'vitest';
import { sessionRoleOf, type ChildMark } from '../../shared/api.js';
import { rollTargetVerdict } from '../src/coord/rollTarget.js';

const MARKS: readonly [ChildMark, 'coordinator' | 'child'][] = [
  [{ kind: 'none' }, 'coordinator'],
  [{ kind: 'child', runId: 7 }, 'child'],
  [{ kind: 'child', runId: 9_999_999_999 }, 'child'],
  [{ kind: 'unreadable' }, 'child'],
];

describe('SessionRole today (characterization, before the role vocabulary)', () => {
  it('no .child is a coordinator; a child and an unreadable marker are children', () => {
    for (const [mark, want] of MARKS) expect(sessionRoleOf(mark)).toBe(want);
  });
  it('the roll lane takes exactly the coordinator answer', () => {
    for (const [mark, want] of MARKS) {
      expect(rollTargetVerdict('coordinators', sessionRoleOf(mark)))
        .toEqual(want === 'coordinator' ? { take: true } : { take: false, skip: 'not-coordinator' });
    }
  });
});
```

- [ ] **Step 2: Run it.** `cd server && ./node_modules/.bin/vitest run test/session-role-view.test.ts`. Expect PASS
  (it pins today). Also run `test/fleet.test.ts`, `test/roll-target.test.ts` and `test/stall-coord-blocked.test.ts`
  and record that they pass; they are the rest of the characterization.
- [ ] **Step 3: Commit.**
  `test(roles): pin today's SessionRole answers before the role vocabulary`

### Task 2: The L0 table, `FLEET_ROLES`

**Files:**
- Create: `shared/fleetRoles.ts`. Ring L0 (one `import type` of a sibling; no runtime import). Context K.
- Test (create): `server/test/fleet-roles.test.ts`

The spec's columns (§3.3.9, C49) are long-lived, launch profile, card renderer, compaction instructions and probe
set. Mail pace and the renewal triggers are not columns: they are L1 records keyed by role (§3.3.9, §11.1), built by
their own pieces.

| Column | Ships here | Why |
|---|---|---|
| long-lived | `longLived: boolean` | Table 3.3.9a gives every value: `overlord` and `coordinator` yes, the rest no |
| today's view (not in the spec) | `sessionRole: SessionRole` | `SessionRole` becomes a column read with one definition (D-TBD-session-role-column) |
| launch profile | typed `null` | No profile exists; W1a's launch-profile piece composes them (§3.6, H1) |
| card renderer | typed `null` | Today's role card is bash in the hook; the card door piece (§3.3.3) brings renderers |
| compaction instructions | typed `null` | No text exists (a bare `/compact`); waits on history W3-1 (§14, C51) |
| probe set | typed `null` | W1a's probe piece (§3.3.5, C52) |

A `null` column is declared on `FleetRoleRow`, and every row says `null`. The piece that brings its values widens the
type, and the compiler then refuses every row until it is filled. Nothing reads a `null` column.

**Interfaces:**
- Consumes: `import type { SessionRole } from './api.js'`.
- Produces:

```ts
export type FleetRole = 'overlord' | 'auditor' | 'replay' | 'worker' | 'reviewer' | 'coordinator' | 'plain';
export interface FleetRoleRow {
  readonly longLived: boolean;
  /** Today's two-word view (`SessionRole`). */
  readonly sessionRole: SessionRole;
  /** Typed and absent until their pieces land. */
  readonly launchProfile: null;
  readonly cardRenderer: null;
  readonly compactInstructions: null;
  readonly probeSet: null;
}
/** Keys in Table 3.3.9a's order. */
export const FLEET_ROLES: Readonly<Record<FleetRole, FleetRoleRow>>;
export const FLEET_ROLE_NAMES: readonly FleetRole[]; // = Object.keys(FLEET_ROLES) as FleetRole[]
```

Values: `overlord` {longLived true, sessionRole 'coordinator'}; `auditor` {false, 'child'}; `replay` {false, 'child'};
`worker` {false, 'child'}; `reviewer` {false, 'child'}; `coordinator` {true, 'coordinator'}; `plain` {false,
'coordinator'}. Every deferred column `null`. The `auditor` and `replay` view values wait on the operator's question 2
under "Where things stand"; build them as written.

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, expect, it } from 'vitest';
import { FLEET_ROLES, FLEET_ROLE_NAMES, type FleetRoleRow } from '../../shared/fleetRoles.js';

describe('FLEET_ROLES (Overlord spec §3.3.9, C49)', () => {
  it("names the seven roles in Table 3.3.9a's order", () => {
    expect(FLEET_ROLE_NAMES).toEqual(['overlord', 'auditor', 'replay', 'worker', 'reviewer', 'coordinator', 'plain']);
  });
  it('long-lived is the table: overlord and coordinator only', () => {
    expect(FLEET_ROLE_NAMES.filter((r) => FLEET_ROLES[r].longLived)).toEqual(['overlord', 'coordinator']);
  });
  it("today's view: worker, reviewer, auditor and replay are children; the rest coordinators", () => {
    expect(FLEET_ROLE_NAMES.filter((r) => FLEET_ROLES[r].sessionRole === 'child'))
      .toEqual(['auditor', 'replay', 'worker', 'reviewer']);
  });
  it('every column that waits for a later piece is null on every row', () => {
    for (const r of FLEET_ROLE_NAMES) {
      const { launchProfile, cardRenderer, compactInstructions, probeSet } = FLEET_ROLES[r];
      expect([launchProfile, cardRenderer, compactInstructions, probeSet]).toEqual([null, null, null, null]);
    }
  });
  it('a row must carry every column (a compile-time pin, read by the test typecheck)', () => {
    // @ts-expect-error a row with no sessionRole is not a FleetRoleRow
    const partial: FleetRoleRow = { longLived: false, launchProfile: null, cardRenderer: null, compactInstructions: null, probeSet: null };
    expect(partial.longLived).toBe(false);
  });
});
```

- [ ] **Step 2: Run it.** `cd server && ./node_modules/.bin/vitest run test/fleet-roles.test.ts`. Expect a failure to
  resolve `../../shared/fleetRoles.js`.
- [ ] **Step 3: Implement** `shared/fleetRoles.ts` as the interface above. Follow `SESSION_ROLE_MAP`'s idiom
  (`shared/api.ts#SessionRole`): the union first, the `Record` typed against it, so a missing row is TS2741 and a
  stray one TS2353. Put a header comment naming spec §3.3.9 and each deferred column's owning piece.
- [ ] **Step 4: Run it**, `test/rings/shared-imports.test.ts`, and all four typechecks. Expect PASS.
- [ ] **Step 5: Commit.**
  `feat(roles): one L0 role table, FLEET_ROLES; seven rows, four columns typed and absent`

**Guards and their mutations:** flip `coordinator.longLived` to `false`: "long-lived is the table" goes red. Change
`reviewer.sessionRole` to `'coordinator'`: "today's view" goes red, and Task 3's view assertions too. Delete the
`@ts-expect-error` line: the test typecheck goes red (TS2741).

### Task 3: The reader, `roleOf`

**Files:**
- Create: `server/src/roleOf.ts`. Ring L1 (runtime import of `shared/fleetRoles.ts` only; no I/O). Context C3.
- Modify: `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md`, the C3 row inside the
  `ring-context-map` block: add `` `roleOf.ts` `` to its `server/src` cell. Without it
  `server/test/rings/totality.test.ts` reds the file as unmapped (a top-level file takes no directory row; `coord/**`
  would make it C5, which the spec does not want).
- Test (create): `server/test/role-of.test.ts`

**Interfaces:**
- Consumes: `FLEET_ROLES`, `FleetRole` (`shared/fleetRoles.ts`); `ChildMark`, `RunKind`, `RUN_KINDS`, `SessionRole`
  (`shared/api.ts`, type-only except `RUN_KINDS` in the test).
- Produces:

```ts
export type RoleFactWord = 'yes' | 'no' | 'unmeasured';
export interface RoleFacts {
  /** §3.1: the designation naming this session. No reader before W1, so callers pass 'none'. */
  readonly designation: 'none' | 'pending' | 'live';
  /** §9.5: a row the audit lane wrote for this session. No lane before its wave: false. */
  readonly auditBody: boolean;
  /** §9.5: a row the replay lane wrote for this session. No lane before its wave: false. */
  readonly replayBody: boolean;
  readonly child: ChildMark;
  /** The kind of the run `child.runId` names; 'unmeasured' when not read. Read only when child.kind is 'child'. */
  readonly childRunKind: RunKind | 'unmeasured';
  /** `claimedBy` on a run that is not terminal (`openCoordinatorIds`' question). */
  readonly claimsOpenRun: RoleFactWord;
  /** Declared coordinator intent on the current incarnation (`deriveCoordinatorIntentByParent`'s question). */
  readonly declaredIntent: RoleFactWord;
}
export const ROLE_AMBIGUITIES: {
  readonly 'worker-or-reviewer': readonly ['worker', 'reviewer'];
  readonly 'coordinator-or-plain': readonly ['coordinator', 'plain'];
};
export type RoleAmbiguity = keyof typeof ROLE_AMBIGUITIES;
export type RoleReading =
  | { readonly kind: 'role'; readonly role: FleetRole }
  | { readonly kind: 'undecided'; readonly between: RoleAmbiguity };
export function roleOf(f: RoleFacts): RoleReading;
/** The view: the role's `sessionRole` column; an undecided reading reads its first member's (all members agree). */
export function sessionRoleOfReading(r: RoleReading): SessionRole;
```

The decision, first match wins (Table 3.3.9a, plus §11.1's typed undecided reading for the cases the table does not
name, D-TBD-role-undecided):
1. `designation` is `pending` or `live`: `overlord`.
2. `auditBody`: `auditor`. 3. `replayBody`: `replay`.
4. `child.kind` is `unreadable`: undecided `worker-or-reviewer`.
5. `child.kind` is `child`: `work` is `worker`, `review` is `reviewer`, `unknown` or `unmeasured` is undecided
   `worker-or-reviewer`.
6. `claimsOpenRun` or `declaredIntent` is `yes`: `coordinator`.
7. Both are `no`: `plain`. Otherwise (a `no` and an `unmeasured`, or two `unmeasured`): undecided
   `coordinator-or-plain`. An unmeasured fact is never read as `no`.

- [ ] **Step 1: Write the failing test.** Three parts: literal rows from the spec, every combination, and the view.

```ts
import { describe, expect, it } from 'vitest';
import { RUN_KINDS, type ChildMark } from '../../shared/api.js';
import { FLEET_ROLES, type FleetRole } from '../../shared/fleetRoles.js';
import { ROLE_AMBIGUITIES, roleOf, sessionRoleOfReading, type RoleFacts, type RoleReading } from '../src/roleOf.js';

const BASE: RoleFacts = { designation: 'none', auditBody: false, replayBody: false, child: { kind: 'none' },
  childRunKind: 'unmeasured', claimsOpenRun: 'no', declaredIntent: 'no' };
const role = (r: FleetRole): RoleReading => ({ kind: 'role', role: r });
const CHILD7: ChildMark = { kind: 'child', runId: 7 };

describe('roleOf: Table 3.3.9a, first match wins', () => {
  it.each<[string, Partial<RoleFacts>, RoleReading]>([
    ['a pending designation is the Overlord, whatever else holds', { designation: 'pending', child: CHILD7, childRunKind: 'work', claimsOpenRun: 'yes' }, role('overlord')],
    ['a live designation is the Overlord', { designation: 'live' }, role('overlord')],
    ['an audit row is the auditor, before a replay row', { auditBody: true, replayBody: true }, role('auditor')],
    ['a replay row is a replay body', { replayBody: true }, role('replay')],
    ['a child of a work run is a worker, even claiming', { child: CHILD7, childRunKind: 'work', claimsOpenRun: 'yes', declaredIntent: 'yes' }, role('worker')],
    ['a child of a review run is a reviewer', { child: CHILD7, childRunKind: 'review' }, role('reviewer')],
    ["a child of a run whose kind this build cannot name is undecided", { child: CHILD7, childRunKind: 'unknown' }, { kind: 'undecided', between: 'worker-or-reviewer' }],
    ['an unreadable marker is undecided between worker and reviewer', { child: { kind: 'unreadable' }, childRunKind: 'work' }, { kind: 'undecided', between: 'worker-or-reviewer' }],
    ['a claim on an open run is a coordinator', { claimsOpenRun: 'yes', declaredIntent: 'unmeasured' }, role('coordinator')],
    ['declared intent is a coordinator', { claimsOpenRun: 'unmeasured', declaredIntent: 'yes' }, role('coordinator')],
    ['neither is plain', {}, role('plain')],
    ['an unmeasured claim is never read as no', { claimsOpenRun: 'unmeasured' }, { kind: 'undecided', between: 'coordinator-or-plain' }],
  ])('%s', (_name, over, want) => { expect(roleOf({ ...BASE, ...over })).toEqual(want); });
});
```

  The combination part enumerates `designation` (3) x `auditBody` (2) x `replayBody` (2) x `child` (none, child 7,
  unreadable) x `childRunKind` (`...RUN_KINDS, 'unmeasured'`) x `claimsOpenRun` (3) x `declaredIntent` (3), 1,296
  cases. For each case it asserts every rule as an implication: when that rule's condition holds and no earlier
  rule's does, the answer is that rule's. Write the seven implications out; never call a helper that recomputes the
  answer as one chain. It also asserts:
  - the case count is 1,296;
  - with `child.kind` `none`, changing `childRunKind` never changes the answer;
  - every answer's `role` is a key of `FLEET_ROLES`, and every `between` a key of `ROLE_AMBIGUITIES`.

  A third `describe` pins the view: `sessionRoleOfReading` of each role is its `FLEET_ROLES[r].sessionRole`, and for
  each ambiguity every member's `sessionRole` is the same (so the view is total without a guess).

- [ ] **Step 2: Run it.** `cd server && ./node_modules/.bin/vitest run test/role-of.test.ts`. Expect a failure to
  resolve `../src/roleOf.js`.
- [ ] **Step 3: Implement** `server/src/roleOf.ts` to the interface and decision list above. `ROLE_AMBIGUITIES` is
  `as const satisfies Record<string, readonly FleetRole[]>`. Its header says it is L1 policy in C3. Then run
  `test/rings/totality.test.ts`: expect it red, naming `roleOf.ts` unmapped. Add the spec row; run it again: green.
- [ ] **Step 4: Run** `test/role-of.test.ts`, `test/rings/totality.test.ts`, `test/rings/outward-edges.test.ts`, the
  server typecheck and the test typecheck. Expect PASS.
- [ ] **Step 5: Commit.**
  `feat(roles): roleOf reads a session's role from measured facts, first match wins; unmeasured is never folded`

**Guards and their mutations:**
- Move rule 6 above rule 5: "a child of a work run is a worker, even claiming" goes red.
- Drop rule 1: "a pending designation is the Overlord, whatever else holds" goes red.
- Read `unmeasured` as `no` in rule 7: "an unmeasured claim is never read as no" goes red, and so does the
  combination bucket for it.
- Treat `unreadable` as `worker`: "an unreadable marker is undecided" goes red.
- Add a member to an ambiguity whose `sessionRole` differs: the view's "members agree" assertion goes red.

### Task 4: `SessionRole` becomes a view of `roleOf`

Two commits: a move that changes only imports, then the re-derivation that changes no answer.

**Files:**
- Modify: `shared/api.ts`: delete `sessionRoleOf` and its doc comment (`shared/api.ts#sessionRoleOf`; the comment
  moves with it). Keep `SessionRole`, `SESSION_ROLE_MAP`, `SESSION_ROLES`, `isSessionRole` and `reviveSessionRole`
  where they are: they are the wire's vocabulary and its reviver. Point the doc comment on `FleetSession.role`
  ("`sessionRoleOf(child)` above, the one derivation") at `server/src/roleOf.ts#sessionRoleOf`.
- Modify: `server/src/roleOf.ts`: gains `sessionRoleOf`.
- Modify (import only): `server/src/fleet.ts` (its `shared/api.js` import), `server/src/coord/stall.ts` (its
  `shared/api.js` import of `sessionRoleOf`), `server/src/coord/rollTarget.ts` (the two doc comments that name
  `sessionRoleOf` cite `server/src/roleOf.ts#sessionRoleOf`).
- Modify (import only): `server/test/session-role-view.test.ts`, `server/test/roll-target.test.ts`.
- Modify: `server/test/single-definition/ask-digest.test.ts`, the D-5301 block: the `sessionRoleOf` holder becomes
  `['server/src/roleOf.ts']`, and the block's comment, `describe` title and that `it` title stop saying it lives in
  `shared/api.ts`. The other three holders stay `['shared/api.ts']`. The fleet.ts pin (`role: sessionRoleOf(r.child)`)
  is unchanged.

**Interfaces:**
- Produces, in `server/src/roleOf.ts`:

```ts
/** What the fleet frame measures for the role today: the `.child` axis only. The designation and the lanes have no
 *  reader before their waves; claim and intent are not read on this path, so they are 'unmeasured'. */
export const ROLE_FACTS_CHILD_AXIS: Omit<RoleFacts, 'child'>;
export const sessionRoleOf: (child: ChildMark) => SessionRole;
```

- [ ] **Step 1 (move, commit a):** cut `sessionRoleOf` verbatim (the ternary) from `shared/api.ts` into
  `server/src/roleOf.ts`, and change only the import paths listed above and the holder path in `ask-digest.test.ts`.
  Run `test/session-role-view.test.ts`, `test/fleet.test.ts`, `test/roll-target.test.ts`,
  `test/stall-coord-blocked.test.ts`, `test/single-definition/ask-digest.test.ts`, and all four typechecks. Expect
  PASS with no assertion changed. Commit:
  `refactor(roles): sessionRoleOf moves beside roleOf; imports only, today's answers pinned`
- [ ] **Step 2 (re-derive, write the failing test first):** add to `server/test/role-of.test.ts`, importing
  `ROLE_FACTS_CHILD_AXIS` and `sessionRoleOf` from `../src/roleOf.js`:

```ts
it('SessionRole is a view: sessionRoleOf is the column of roleOf over the child axis', () => {
  expect(ROLE_FACTS_CHILD_AXIS).toEqual({ designation: 'none', auditBody: false, replayBody: false,
    childRunKind: 'unmeasured', claimsOpenRun: 'unmeasured', declaredIntent: 'unmeasured' });
  for (const child of [{ kind: 'none' }, { kind: 'child', runId: 7 }, { kind: 'unreadable' }] as const) {
    expect(sessionRoleOf(child)).toBe(sessionRoleOfReading(roleOf({ ...ROLE_FACTS_CHILD_AXIS, child })));
  }
  expect(roleOf({ ...ROLE_FACTS_CHILD_AXIS, child: { kind: 'none' } }))
    .toEqual({ kind: 'undecided', between: 'coordinator-or-plain' });
});
```

  Run it. Expect red on the first assertion. Vitest's transform can read a missing named export as `undefined`
  instead of failing the import, and `{ ...undefined, child }` would then give today's answers, so the constant's
  value is asserted first.
- [ ] **Step 3:** add `ROLE_FACTS_CHILD_AXIS` and redefine
  `sessionRoleOf = (child) => sessionRoleOfReading(roleOf({ ...ROLE_FACTS_CHILD_AXIS, child }))`.
- [ ] **Step 4:** run the same five suites as Step 1 plus `test/role-of.test.ts`. Expect PASS, with the
  characterization untouched. Commit:
  `refactor(roles): SessionRole is a view of roleOf; the child axis only, every answer as before`

**Guard and its mutation:** revert `sessionRoleOf` to the old ternary and no behaviour test goes red (the answers are
equal by design). Task 5's pins on the old spelling and on "goes through roleOf" are what go red; Task 5 measures it.

### Task 5: Single-definition pins

**Files:**
- Modify: `server/test/single-definition/ask-digest.test.ts`. Add a new `describe` directly after the D-5301 block,
  so the role's pins sit together. It uses the file's existing imports (`ALL`, `ccrcRoot`, `rel`, `stallCode`,
  `stallCodeText` from `./helpers.js`; `readFileSync`; `path`) and its `holders` idiom (code lines only).

- [ ] **Step 1: Write the pins.**

```ts
describe('one role vocabulary and one reader (Overlord spec C49)', () => {
  const holders = (re: RegExp): string[] => ALL.filter((f) => re.test(stallCode(f))).map(rel).sort();
  it('CONTROL: the patterns see a definition and pass over a comment', () => {
    expect(/\bFLEET_ROLES\s*[:=]/.test('export const FLEET_ROLES: Readonly<Record<FleetRole, FleetRoleRow>> = {')).toBe(true);
    expect(/\bfunction\s+roleOf\b/.test('export function roleOf(f: RoleFacts): RoleReading {')).toBe(true);
    expect(stallCodeText('// export function roleOf(f) {}\nconst x = 1;')).not.toMatch(/\bfunction\s+roleOf\b/);
  });
  it('FLEET_ROLES and FleetRole are defined in shared/fleetRoles.ts only', () => {
    expect(holders(/\bFLEET_ROLES\s*[:=]/)).toEqual(['shared/fleetRoles.ts']);
    expect(holders(/\btype\s+FleetRole\s*=/)).toEqual(['shared/fleetRoles.ts']);
  });
  it('FLEET_ROLE_NAMES is derived from the table, never hand-kept', () => {
    const src = readFileSync(path.join(ccrcRoot, 'shared/fleetRoles.ts'), 'utf8');
    expect(src).toMatch(/FLEET_ROLE_NAMES: readonly FleetRole\[\] =\s*\n?\s*Object\.keys\(FLEET_ROLES\)/);
  });
  it('roleOf and sessionRoleOfReading are defined in server/src/roleOf.ts only, and sessionRoleOf goes through roleOf', () => {
    expect(holders(/\bfunction\s+roleOf\b|\broleOf\s*=/)).toEqual(['server/src/roleOf.ts']);
    expect(holders(/\bfunction\s+sessionRoleOfReading\b|\bsessionRoleOfReading\s*=/)).toEqual(['server/src/roleOf.ts']);
    expect(stallCode(path.join(ccrcRoot, 'server/src/roleOf.ts'))).toMatch(/\bsessionRoleOf\s*=[^;]*\broleOf\(/);
  });
  it("the old two-word derivation is spelled nowhere", () => {
    expect(holders(/kind\s*===\s*'none'\s*\?\s*'coordinator'/)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it** on the finished tree: expect PASS.
  `cd server && ./node_modules/.bin/vitest run test/single-definition/ask-digest.test.ts`
- [ ] **Step 3: Measure each mutation below**, one at a time in the working tree: run the file, see the named pin
  red, revert, and record the result in the commit body. Nothing of a mutation is committed.
- [ ] **Step 4: Commit.**
  `test(roles): FLEET_ROLES and roleOf are defined once; SessionRole's old derivation is spelled nowhere`

**Guards and their mutations:** copy `FLEET_ROLES`'s definition into any `server/src` file: the holder pin goes red.
Replace `Object.keys(FLEET_ROLES)` with a literal list: the derivation pin goes red. Restore `sessionRoleOf`'s old
ternary body: "goes through roleOf" and "the old two-word derivation" go red.

## Deviations found

The programme mints the real numbers when its run opens; until then each entry is named `D-TBD-<slug>`.

- **D-TBD-role-undecided.** §11.1 asks for "a typed undecided reading, never a guess" but names neither its shape nor
  its cases, and Table 3.3.9a names no answer for an unreadable child marker, a child whose run kind is `unknown` or
  unread, or a non-child whose claim or intent read is unmeasured. Today `SessionRole` calls the first two a child.
  `roleOf` answers one of two named ambiguities (`worker-or-reviewer`, `coordinator-or-plain`), never a null (the
  rule against an overloaded null at a seam). Each ambiguity's members share one view value, so `SessionRole` stays
  total.
- **D-TBD-session-role-column.** `FLEET_ROLES` gains a `sessionRole` column, not in the spec's list, so the view is a
  column read and has one definition. Its type is an `import type` of the sibling `shared/api.ts`; the spec says an
  L0 table "imports nothing", and the tree's L0 rule (`server/test/rings/shared-imports.test.ts`) allows `./`
  siblings only, which this is.
- **D-TBD-role-columns-deferred.** Four of the spec's five columns ship typed `null`; Task 2's column table says which
  piece fills each and why.
- **D-TBD-sessionroleof-moves.** `sessionRoleOf` moves from `shared/api.ts` (L0) to `server/src/roleOf.ts` (L1, C3),
  because an L0 file cannot call the L1 reader. No PWA or agent file imports it (measured).
- **D-TBD-child-axis-facts.** The fleet frame still measures only `.child` for `FleetSession.role`. Claim and intent
  are passed as `unmeasured`, not read, so `FleetSession.role` keeps its two words and its D-5301 contract. No wire
  field is added; the renewal lane builds full facts server-side when it lands.
- **D-TBD-run-relations-not-roles.** `StallSessionRole` (`server/src/coord/stall.ts`), `stuckCause`'s `role`
  (`server/src/coord/runStuck.ts`) and `RequeueRole` (`server/src/coord/store.ts`) stay. Each names a session's
  relation to one run that a lane is judging, not what the session is. That is a recorded "legitimately different"
  reason; they are not views of `roleOf`.
- **D-TBD-hook-role-card.** `ccd/session-hook.sh#_hook_role_card` keeps reading `.child` existence itself. It runs in
  another process and language and cannot call `roleOf`; the card door piece replaces it.

## Where things stand

**Needed before it starts:**
- The spec merged at `docs/superpowers/specs/2026-11-09-overlord-design.md`, and the programme's W1a run open, so the
  `D-TBD` entries get numbers.
- The files claimed by the peer protocol (§3.3.9, last bullet): `shared/api.ts`, `server/src/fleet.ts`,
  `server/src/coord/stall.ts`, `server/src/coord/rollTarget.ts`, the architecture spec's context table and
  `server/test/single-definition/ask-digest.test.ts`.
- Nothing from W0. Figure 8 orders W1a after W0, but this piece reads no W0 measurement.

**What depends on it:** W1a's launch-profile, card-door, probe and compaction-instruction pieces (each fills one
`null` column); `MAIL_PACE` and the renewal trigger table (both `Record<FleetRole, ...>` in L1); W1's designation
reader, which feeds `designation`, and the audit and replay lanes (§9.5), which feed `auditBody` and `replayBody`.

**Open questions for the operator, most important first:**
1. **The Overlord's view is `coordinator`, so the roll lane would take it.** Unreachable before W1, because the
   designation has no reader. Recommendation: W1's "one `overlord` hold in the roll lane's table" (C4) lands in the
   same pull request as the designation reader.
2. **What is today's view of `auditor` and `replay`?** The spec does not say whether their sessions carry `.child`.
   Recommendation: `child`, so the roll lane never takes a server-launched body and the hook never tells it to
   coordinate. Unreachable until their waves either way.
3. **Is `plain` still a role after D-8142?** Since 2026-11-09 every session the operator creates is told from its
   first turn that it is its project's coordinator, yet `roleOf` reads one with no claim and no declared intent as
   `plain`. Its view stays `coordinator` ("rolled as today", Table 3.3.9a). Recommendation: no change in this piece;
   the card door piece decides what `plain` is told, as a behaviour change of its own.
4. **A wire field for the full role?** Recommendation: no, until a PWA reader needs it. Then it is additive, with a
   reviver and an `isFleetRole` guard beside the table.
