# Deviation allocator removal, PR 2 (the dead code) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the retired deviation allocator: its two routes, its `ccrc-api` verbs, its watcher sweeps and lanes,
its store methods, its log, its seed reader and the decisions only they used.

**Architecture:** Pure removal, outside in. Task 1 removes the doors (routes, client verbs, gate rows, censuses,
CLAUDE.md's route list). Task 2 removes what only the doors and the sweeps used (watcher lanes, store and port
methods, `ledgerlog.ts`, `ledgerseed.ts`, allocator-only decisions in `ledger.ts`, shared constants). The
`ledger_floor` and `ledger_alloc` tables stay in `coord.db`'s schema: migrations only move forward.

**Tech Stack:** TypeScript, vitest, bash (`ccd/ccrc-api`).

**Spec:** `docs/superpowers/specs/2026-11-23-deviation-numbers-self-assigned-design.md` (item 4 and "Order"). Stacked on
PR 1 (`docs/superpowers/plans/2026-11-23-deviation-numbers-self-assigned-pr1.md`), which switched the allocator off.

## Global Constraints

- Kept, untouched in behaviour: `definitionsIn`, the fence reader, `crossTreeCollisions`, `LEDGER_ALLOCATOR_ERA`
  (the era `crossTreeCollisions` and `deviation-refs.test.ts` still use), `SELF_ASSIGNED_ERA`,
  `selfAssignedCollisions`, `nextDeviationNumbers`, `LEDGER_ALLOC_MAX` (the helper's count bound), the
  grandfathered sets, `server/scripts/next-deviation.ts`.
- `coord.db` migrations and the two tables' DDL stay; nothing reads or writes the tables after this PR. A schema test
  that asserts the tables exist stays.
- Removal follows CLAUDE.md's "characterization first when moving code" only where code moves; here code is deleted,
  so the tests that pinned it are deleted with it, and every census or ratchet that listed it is updated in the same
  commit (EXEMPT table, box-token census, single-definition, overlord lanes census, lane schedule, writers map).
- `D-N` comments in surviving source are history: never delete one from code that stays.
- No concrete `D-TBD-` placeholder; public repo.

## Review Focus

1. A census, ratchet or allow-list that still names a removed route, lane, method or file → the suite that owns it
   must fail before the edit and pass after (each Task's step 4 runs them).
2. `~/.ccrc/ledger-alloc.log` on a live box after upgrade → nothing reads it, nothing deletes it; the PR body says it
   may be removed by hand.
3. A `ccrc-api ledger …` call from an old skill copy on a box → the client answers its unknown-verb error, not a crash.
4. The backup and restore set (`ccrc backup`, coordination restore) naming the alloc log → if it does, drop it from
   the set with the reader; if not, nothing.
5. `GET /api/ledger` from the PWA → no PWA reader exists (measured 2026-11-24), so nothing on the console breaks.

---

### Task 1: The doors

**Files:** `server/src/coord/routes.ts` (both ledger routes), `server/src/auth/gate.ts` (their EXEMPT rows),
`ccd/ccrc-api` (`ledger.list`, `ledger.allocate` rows and help), `server/src/server.ts` (route lists naming
`/api/ledger`), `CLAUDE.md` (the box-token route list: drop `POST /api/ledger/deviations` and `GET /api/ledger`),
`README.md` (the `ledger list|allocate` verb line and any route table), and every census that lists them
(`box-token-census`, `auth-gate`, `coord-routes-single-file`, `overlord-other-lanes-census`, `ccrc-api*`, others
`git grep -l "api/ledger" server/test` names).

- [ ] **Step 1:** Change the censuses and route tests first so they expect the routes and verbs gone (a request to
  either path answers 404; `ccrc-api ledger list` exits with the client's unknown-verb answer).
- [ ] **Step 2:** Run them — expect FAIL.
- [ ] **Step 3:** Delete the routes, the gate rows, the client rows, the doc mentions.
- [ ] **Step 4:** Run every suite `git grep -l "api/ledger\|ledger\.list\|ledger\.allocate" server/test` lists, plus
  `test/auth-gate.test.ts test/box-token-census.test.ts test/typecheck-tests.test.ts` and `tsc --noEmit` — PASS
  (the `ccrc-api` client-stub suites need bash ≥ 4; on a macOS box run them under Homebrew bash or leave them to CI
  and say so).
- [ ] **Step 5:** Commit `refactor(ledger): the retired allocator's routes and client verbs are gone`.

### Task 2: What only the doors and sweeps used

**Files:** `server/src/watch.ts` (`sweepLedgerFloor`, `sweepLedgerReconcile`, their report latches and imports),
`server/src/laneSchedule.ts` (the `ledgerReconcile` and `ledgerFloor` lanes and their cadence constants),
`server/src/coord/store.ts` and `ports.ts` (allocation, floor, stale, issued and landed methods), `server/src/coord/ledgerlog.ts`
(delete), `server/src/coord/ledgerseed.ts` (delete), `server/src/coord/ledger.ts` (`decideAllocation`,
`floorFromScan`, `projectEra`, `unallocatedDefinitions`, `AllocationDecision`), `shared/api.ts` (`LEDGER_SEED_GAP`,
`LEDGER_STALE_MS`, the ledger wire types only the routes used), `shared/box-token.ts`, `shared/refusal.ts` and
`ClaimRefuseCode` (`not-seeded`), `server/src/coord/schema.ts` comments that describe a live writer,
`server/src/index.ts`'s stale `LedgerLog` comment, and the tests that pinned each.

- [ ] **Step 1:** Update the ratchets and censuses that enumerate lanes, writers, refusal codes and shared exports
  (lane-sweeps characterization, change-latch sites, writers map, claims-envelope, single-definition) to the
  post-removal sets; delete the unit tests of deleted code (`ledgerlog`, `ledgerseed`, `ledger-race`, `ledger-sweep`,
  `ledger-store`, `journal-log-first`'s ledger arm, `ledger.test.ts`'s cases for deleted functions).
- [ ] **Step 2:** Run the ratchets — expect FAIL.
- [ ] **Step 3:** Delete the code. A `coord.db` test asserting the tables exist stays green: the DDL is untouched.
- [ ] **Step 4:** Run `test/ledger.test.ts test/ledger-crosstree.test.ts test/deviation-refs.test.ts
  test/next-deviation.test.ts test/coord-db.test.ts test/typecheck-tests.test.ts` and every suite the ratchets live in,
  plus `git grep -n "sweepLedger\|ledgerFloor\|LEDGER_SEED_GAP\|LEDGER_STALE_MS\|allocateDeviations\|ledgerseed\|ledgerlog" -- server shared pwa ccd`
  returning only history comments; `tsc --noEmit` in server/ and pwa/ — PASS.
- [ ] **Step 5:** Commit `refactor(ledger): the allocator's store, log, seed and sweeps are gone`.

## Deviations found

(none yet)
