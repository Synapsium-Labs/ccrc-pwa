# Wave 1f, Task 5: the gate, the mutation rows, the handoff

Plan: `docs/superpowers/plans/2026-11-25-landing-order-wave1f-known-limits.md`, Task 5.

## The gate

Each suite alone, `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/<suite>.test.ts`, on the fleet's
test box, after `git fetch origin main`, at the wave's last commit before this note.

From `server/`:

| Suite | Result |
|---|---|
| `conflict-sync-text` | 5/5 |
| `session-hook-sync-advisory` | 78/78 |
| `coordinator-skill` | 290/290 |
| `worker-skill` | 84/84 |
| `skill-size-ratchet` | 32/32 |
| `docs-parity` | 81/81 |
| `ci-pipeline` | 132/132 |
| `ci-merge-queue` | 7/7 |
| `oss-metadata` | 29/29 |
| `workflow-yaml-parses` | 23/23 |
| `queue-live` | 10/10 |
| `growth-caps` | 12/12 |
| `growth-check`, armed (`env GROWTH_CHECK=1`) | 100/100, none skipped |
| `ccd-harness-integrity` | 13/13 |
| `deviation-refs` | 35/35 |
| `citations` | 4/4 |
| `anchors` | 9/9 |
| `topology-clean` | 61/61 |
| the server typecheck (`tsc --noEmit`, which `ccrc test` ran in the local slice) | clean |

From `pwa/`: `browser-leg` 22/22.

**What did not run here.** The tests-inclusive typecheck guard (`typecheck-tests`) was tried once with
`ccrc test --local`, as the brief asked: 5 failed of 12, and the wrapper said "the test slice's memory cap killed a
process during this run (MemoryMax=6G, CCRC_TEST_SLICE_MEMORY_MAX; 5 OOM kill(s) in ccrctests.slice); exit 1". Its
`server/test/` case read status -1 (the kill); its `agent/test/` case reported missing Node types, because this
workspace has no `agent/node_modules` (nothing in this wave touches `agent/`). A direct
`tsc --noEmit -p test/tsconfig.tests.json` from `server/` was killed the same way (exit 137, one OOM kill). As a
narrower check, a throwaway project in the session's temp root that extends `test/tsconfig.tests.json` and lists only
the eight changed server suites (`tsc` follows their imports) typechecked clean; without Node's types named it had
reported 239 errors, so it does read those files. The pull request's own run is the arbiter for the whole guard.

No full suite ran locally.

## The mutation rows

All fourteen were measured (ten in the build, four in fix round 1), each red, restored from a saved copy with its sha256 checked, then green. They are recorded
in the task notes:

| Rows | Note |
|---|---|
| 1F-01 to 1F-04 | `wave1f-task-1.md` |
| 1F-05 to 1F-09 | `wave1f-task-3.md` |
| 1F-10 | `wave1f-task-4.md` (re-measured red on the case as fix round 1 left it, below) |
| 1F-11 to 1F-14 | this note, below (fix round 1, R6) |

### Rows 1F-11 to 1F-14 (fix round 1, R6)

Four text pins the wave added had no row. Each measured the same way as the others: the target saved, its sha256 taken,
the mutation applied, `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/conflict-sync-text.test.ts`
from `server/` on the test box (red), the saved copy restored and its sha256 checked, the suite again (green).

| Row | Mutation | Red assertion | sha256 restored | Green after |
|---|---|---|---|---|
| 1F-11 | README: "before the wave-done of the round the worker is in" back to "before the worker's wave-done of that round only" | case 3: `README.md lacks: before the wave-done of the round the worker is in`, 1 failed of 5 | `02fb8618…25f38`, matched | 5/5 |
| 1F-12 | run care: the tip line becomes `tip=<the branch tip>` | case 5: `lacks: tip=$(gh pr view <pr> --json headRefOid --jq .headRefOid)`, 1 failed of 5 | `a0d9cf48…26b6`, matched | 5/5 |
| 1F-13 | run care: "The probe's own exit status" loses "own" | case 5: ``lacks: The probe's own exit status is the `probe exit` line``, 1 failed of 5 | `a0d9cf48…26b6`, matched | 5/5 |
| 1F-14 | run care: "The paths are for the reader: the worker's own probe is what measures, so" becomes "The paths are for the reader, so" | case 5: `lacks: The paths are for the reader: the worker's own probe is what measures`, 1 failed of 5 | `a0d9cf48…26b6`, matched | 5/5 |

## Departures from the plan, by slug

- `mutation-hook-copy-local`: row 1F-04's suite has no hook-path override, so the row points the suite's `HOOK` at a
  mutated copy in the temp root and ran in the local slice, which can read it (the test box cannot). Task 1's note.
- `closure-anchor-blank-lines`: the closure anchor also skips blank lines before it looks for a deeper script line,
  because a block scalar runs on across them. Task 3's note.
- `plans-characterization-fixed-commit`: the characterization reads a fixed commit on `main`, not `HEAD`, so its
  recorded hash never goes stale. Task 4's note.
- `plans-read-filter-param` (fix round 1, R5): the plan read takes its exclusion filter as an argument
  (`readPlanBlobsAt(ref, keep)`, which `readPlansAt` calls with the legacy list), so the characterization case can
  pass a frozen copy of that list. It changes the reader's shape, not only the case. `wave1f-fix-round-1.md`.
