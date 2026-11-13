# Overlord W1a: `MAIL_PACE` total over the roles, with the Overlord's row Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `MAIL_PACE` has one row per `FleetRole`, the Overlord's among them, and the mail gate picks the row through
`roleOf`, so a role with no row is a compile error and the gate reads the same answer as every other reader of a role.

**Why:** W0-20 measured that the gate dominates the Overlord's delivery latency: each mail waited a p50 of 90 s from
send to nudge, under the worker's pace (60 s of quiet, then 120 s between nudges). The spec gives the Overlord its own
row, starting at the coordinator's pair (§6.4, C24). The mail-pace piece (#2528) built the table with today's two rows
and left the Overlord's row, totality and the move to `roleOf` to the role table; the role table (#2624) shipped the
vocabulary only. This piece finishes it.

**Architecture:** one L1 change in `server/src/coord/mailPace.ts` (the table and its row chooser) and one call site in
`server/src/watch.ts`. The chooser reads a `RoleReading`; an undecided reading takes the slower member's row. The one
behaviour change, a session with declared coordinator intent and no open run moving to the coordinator's pace, is a
commit of its own with its own test (carried constraint, `docs/superpowers/programs/overlord.md`). One pull request.

**Tech Stack:** TypeScript (ESM), vitest. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-09-overlord-design.md` §3.3.9 (C49: `MAIL_PACE` is an L1 record keyed by
role, total over `FLEET_ROLES`; an undecided reading takes the slower pace), §6.4 (C24), Table 11.1b; the results note
`docs/superpowers/plans/2026-11-11-overlord-w0-spike-results.md` (W0-20).

## What exists today

- `server/src/coord/mailPace.ts#MAIL_PACE` has two rows, `worker` `{ quietMs: 60_000, cooldownMs: 120_000 }` and
  `coordinator` `{ quietMs: 15_000, cooldownMs: 30_000 }`, `satisfies Readonly<Record<string, MailPace>>`.
  `MailPaceRole = keyof typeof MAIL_PACE`. `mailPaceRoleOf(sessionId, openCoordinators)` answers `coordinator` for the
  claimant of an open run and `worker` otherwise (D-8208: `worker` is the row every other session reads).
- Its one reader is `sweepMail` in `server/src/watch.ts`: `MAIL_PACE[mailPaceRoleOf(d.toId, coordinators)]`.
- `server/test/mail-pace.test.ts` pins the two rows (the characterization the mail-pace piece wrote) and the chooser.
- `shared/fleetRoles.ts#FleetRole` is `overlord | auditor | replay | worker | reviewer | coordinator | plain`.
  `server/src/roleOf.ts#roleOf(f: RoleFacts): RoleReading` answers `{ kind: 'role', role }` or
  `{ kind: 'undecided', between: 'worker-or-reviewer' | 'coordinator-or-plain' }` (`ROLE_AMBIGUITIES`).
  `RoleFacts` has `designation` (`'none'` until W1), `auditBody`, `replayBody`, `child`, `childRunKind`,
  `claimsOpenRun` and `declaredIntent` (each `yes | no | unmeasured`).
- Declared coordinator intent is derived by `server/src/coord/delegation-model.ts#deriveCoordinatorIntentByParent`.
  Measure, in Task 2 Step 1, which value of it (or of the intent store) the mail sweep can read without a new read.

## Global Constraints

- **Architecture (`CLAUDE.md`).** `mailPace.ts` stays L1: it imports `shared/fleetRoles.ts` (L0) and `roleOf`'s types
  only. The sweep (L4) gathers the facts and asks; it decides nothing. One table, one chooser: `mailPaceRoleOf` is
  replaced, not kept beside the new chooser. Characterization first: the two existing rows' values and the open-run
  claimant's row stay pinned, unedited. A guard ships with a test that goes red without it. No wire change.
- **SAFETY (`CLAUDE.md`).** No ccd change, no new verb.
- **Tests.** From `server/`: `ccrc test -- ./node_modules/.bin/vitest run test/<file>.test.ts`; each task's last run
  adds `ccrc test -- ./node_modules/.bin/tsc --noEmit` and
  `ccrc test -- ./node_modules/.bin/tsc -p test/tsconfig.tests.json --noEmit`.
- **Mutation floors.** `paceRoleOf` is a new L1 decider: it joins `MUTANT_SETS` and
  `server/test/sim/mutation-floors.json` (spec Table 11.7b).
- **Growth check.** `ccd/ccd`, `ccd/session-hook.sh`, `server/src/watch.ts`, `server/src/coord/store.ts` and
  `server/src/coord/routes.ts` (among the files `server/test/growthCheck.ts` lists) grow at most `GROWTH_LIMIT` (40)
  net lines a pull request. New code goes in a new module; growth past the limit needs a waiver file under
  `server/test/growth-waivers/`, whose D-number the coordinator issues.
- Cite code by symbol, never by line. Fixtures `lane-a-project-a`, `lane-b-project-a`. No private names.
- No D-number is invented; departures go in `docs/superpowers/plans/2026-11-10-overlord/w1a-overlord-pace/departures.md`.

## Review Focus

1. The two existing rows keep their values, and the claimant of an open run keeps the coordinator's pace.
2. An undecided reading takes the slower row, never the faster.
3. The intent change is its own commit, and its test is red on the commit before it.

---

### Task 1: The table is total over the roles

**Files:**
- Modify: `server/src/coord/mailPace.ts` (seven rows; `satisfies Readonly<Record<FleetRole, MailPace>>`; `paceRoleOf`)
- Modify: `server/test/mail-pace.test.ts`
- Modify: `server/test/sim/mutate.ts` (`MUTANT_SETS`), `server/test/sim/mutation-floors.json`

**Interfaces:**

```ts
export const MAIL_PACE = {
  overlord:    { quietMs: 15_000, cooldownMs: 30_000 },   // §6.4: starts at the coordinator's pair; M3 moves it
  coordinator: { quietMs: 15_000, cooldownMs: 30_000 },
  worker:      { quietMs: 60_000, cooldownMs: 120_000 },
  reviewer:    { quietMs: 60_000, cooldownMs: 120_000 },
  plain:       { quietMs: 60_000, cooldownMs: 120_000 },
  auditor:     { quietMs: 60_000, cooldownMs: 120_000 },
  replay:      { quietMs: 60_000, cooldownMs: 120_000 },
} as const satisfies Readonly<Record<FleetRole, MailPace>>;

/** The row a reading takes: the role itself, or for an undecided reading the member whose row is slower. */
export function paceRoleOf(r: RoleReading): FleetRole;
```

Each row keeps a comment that says why; the worker row's existing comment stays, and the four rows that copy it say
"the worker's pace: a session mid-thought" in one line.

- [ ] **Step 1: Characterize.** Run `test/mail-pace.test.ts` on the branch point. Expected: green. Its assertions on
  the `worker` and `coordinator` values stay unedited.
- [ ] **Step 2: Failing tests.** Every `FleetRole` has a row (`FLEET_ROLE_NAMES.every(r => r in MAIL_PACE)`); the
  overlord row equals the coordinator row; `paceRoleOf` over every `RoleReading` (seven roles and two undecided
  readings): an undecided reading answers the member with the larger `quietMs`, then the larger `cooldownMs`
  (`worker-or-reviewer` → `worker`, `coordinator-or-plain` → `plain`); monotonic: no reading answers a row faster than
  every member of its set.
- [ ] **Step 3: Run.** Expected: red.
- [ ] **Step 4: Implement.** `paceRoleOf` computes the slower member from the table, not from a hand list, so a changed
  row cannot leave it stale. Keep `mailPaceRoleOf` for this commit (its caller moves in Task 2).
- [ ] **Step 5: Run** `test/mail-pace.test.ts`, `test/rings/totality.test.ts`, both `tsc` runs. Expected: green.
- [ ] **Step 6: Floor.** Register `paceRoleOf` with mutants (pick the faster member; drop the `cooldownMs` tiebreak);
  run `test/sim/mutation-floors.test.ts`. Expected: green.
- [ ] **Step 7: Mutation (measured once).** Delete the `reviewer` row: `tsc` fails (TS1360). Revert.
- [ ] **Step 8: Commit.** `feat(mail-pace): MAIL_PACE is total over FLEET_ROLES, with the Overlord's row (W0-20, C24)`

### Task 2: The gate asks `roleOf`, with today's facts only

**Files:**
- Modify: `server/src/coord/mailPace.ts` (delete `mailPaceRoleOf` and `MailPaceRole`)
- Modify: `server/src/roleOf.ts` (add `roleFactsOf(input: RoleFactInputs): RoleFacts`, pure: the one assembly of a
  session's facts from values a caller already holds; the launch-profile, generations and card pieces reuse it)
- Modify: `server/src/watch.ts` (`sweepMail` asks `paceRoleOf(roleOf(roleFactsOf(…)))`)
- Test: `server/test/mail-pace.test.ts`, the mail sweep's suites (measure: `grep -ln 'cooldown' server/test/*mail*`)

**The facts this task passes:** `designation: 'none'`, `auditBody: false`, `replayBody: false`, `child` from the
registry record the sweep already holds, `childRunKind` from the run the sweep already read or `'unmeasured'`,
`claimsOpenRun` from `coordinators` (`yes`/`no`; `unmeasured` when the run read failed), and
`declaredIntent: 'no'`. Passing `'no'` for intent keeps today's behaviour exactly; Task 3 changes it.

- [ ] **Step 1: Measure** what the sweep holds: the registry record's child mark, and whether a failed run read
  reaches this point. Write the result in the departures note.
- [ ] **Step 2: Failing test.** In the sweep's suite, a fixture where the claimant of an open run gets a 15 s quiet and
  a session with no run gets 60 s (today's behaviour through the new path), and a child of a review run gets 60 s.
- [ ] **Step 3: Run.** Expected: red only on the import of the removed name; then green once the call site moves.
- [ ] **Step 4: Implement** `roleFactsOf` (its input: the registry record's child mark, the run kind if read, the
  open-coordinator set or `unmeasured`, the intent answer or `unmeasured`; `designation`, `auditBody` and `replayBody`
  fixed until their waves), with an exhaustive test beside `roleOf`'s, then the call site. Delete `mailPaceRoleOf`; `grep -rn mailPaceRoleOf server shared` answers
  nothing.
- [ ] **Step 5: Run** the suites and both `tsc` runs. Expected: green.
- [ ] **Step 6: Commit.** `refactor(mail-pace): the mail gate picks its row through roleOf (behaviour unchanged)`

### Task 3: A session with declared intent and no open run takes the coordinator's pace

**Files:**
- Modify: `server/src/watch.ts` (pass `declaredIntent` from the measured intent, `unmeasured` on a failed read)
- Test: `server/test/mail-pace.test.ts` or the sweep's suite

- [ ] **Step 1: Failing test.** A session with declared coordinator intent and no open run gets the coordinator's
  15 s quiet; with the intent read failing, it gets 60 s (undecided between `coordinator` and `plain`, the slower).
- [ ] **Step 2: Run.** Expected: red (Task 2 passed `'no'`).
- [ ] **Step 3: Implement.** Read the intent the sweep can already reach (Task 2 Step 1's measurement). If none is in
  reach without a new store read, add one read on `CoordStore` and name it in the departures note.
- [ ] **Step 4: Run** the suites. Expected: green.
- [ ] **Step 5: Mutation.** Pass `'no'` again: the intent case goes red. Revert.
- [ ] **Step 6: Commit.** `feat(mail-pace): declared coordinator intent with no open run takes the coordinator's pace`

## Deviations found

None yet. Decisions this plan takes, by slug, for the coordinator to number:

- **pace-rows-for-every-role** — `auditor`, `replay`, `reviewer` and `plain` take the worker's values; `overlord` takes
  the coordinator's (§6.4). D-8208's "`worker` is every other session's row" ends here.
- **undecided-takes-the-slower-row** — `paceRoleOf` answers the member with the larger quiet, then the larger cooldown,
  computed from the table.

## Where things stand

**Needs before it starts:** nothing beyond `main`. It touches `server/src/watch.ts` (the mail sweep), which the peer-reply
piece's PR B also touches (a different function); whichever lands second merges `main` once.

**What depends on it:** W1's inbox and coalesced wake read the Overlord's row. M3 (lapses) may move the row's values.

**Open questions for the operator:** none.
