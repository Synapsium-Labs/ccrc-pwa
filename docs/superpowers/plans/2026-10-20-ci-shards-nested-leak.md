# Nested vitest runs in ci-shards.test.ts check only what they started

**Scope:** one task, test-only. CI hygiene: nothing ccrc does changes.

## The problem

`server/test/ci-shards.test.ts` spawns four nested `vitest run`s: the real-report case under
`durationsFromVitestJson` and three under the `times` CLI. Each nested run loads the server config, so it carries
the suite's leak check, `proc-leak.globalsetup.mjs` (#172, D-5894). PR #985's run went red on one of them, not on
an assertion: the `times` CLI case "merges TWO separate report files" got a nested run whose own leak check named
eight processes that belonged to OTHER tests of the same shard (ccrc-codex-life's fake-systemd supervisors and a
`ccrc codex stop`).

## What was measured

- **How the check finds "processes a test started".** Not through the per-run temp root (`run-tmp.globalsetup.mjs`,
  #316), an env var or a cwd prefix. Setup records the members of its own process group (`ps -o pgid`); teardown
  names every member that is new, is not itself, and whose parent is neither itself nor a recorded member. The cwd
  in the report only describes a leak; it selects nothing.
- **How the nested run inherited it.** `execFileSync` without `detached` leaves the child in the caller's process
  group, which for a test is the whole shard's group: the parent vitest, its workers, and every child any test of
  the shard starts without `detached`. The nested run's baseline is that group at the moment it starts. Anything
  another test forks after that, whose parent is not in the baseline (a grandchild of a worker forked later, or an
  orphan reparented to init or a subreaper), is a "leak" of the nested run.
- **Reproduced deterministically.** A sibling `sh` in the suite's group waits until the nested run's fixture test
  is running, then forks an orphan that lives until the case says stop. In the old spawn shape the nested run exits
  1 with its one test passed, naming the orphan: `2 process(es) a test started outlived the run` (the orphan's
  subshell and its `sleep 0.1`).
- **Who else does this.** Only `ci-shards.test.ts`. `proc-leak.test.ts` and `run-tmp.test.ts` already start their
  nested runs `detached`.

## The fix

- **D-6112** is the rule below. `ci-shards.test.ts` gets one helper, `nestedVitest(args, cwd)`, and all four nested
  runs go through it. It spawns through `spawnGroup.ts`'s `spawnSyncGroup`, so the nested run leads a process group
  of its own and its check sees only what the nested run started. It throws on a non-zero exit with the output, as
  `execFileSync` did, returns stdout and stderr, and has a 60 s timeout, after which `spawnSyncGroup` ends the
  whole group.
- The leak check is not weakened, for real runs or for the nested ones. `proc-leak.globalsetup.mjs` is untouched.
  The nested run still fails on its own leaks. `spawnSyncGroup` also throws, and ends the group, when the nested
  run returns with members still in it. The parent shard's check still sees everything left in the parent's group.
- `spawnSyncGroup`'s stray error now carries the child's exit status and output. A nested run that leaks its own
  process prints its leak report (which test, which pid) on stderr; before, the thrown error dropped it and said
  only that something was left. `strays: 'end'` was the other way to surface it, and was not taken: it would end,
  silently, a stray the nested run's own check does not count (one no test started).

## Task 1: isolate the nested runs (D-6112)

**Files:** `server/test/ci-shards.test.ts`; `server/test/spawnGroup.ts` and `server/test/proc-leak.test.ts` (the
stray error's output); this plan.

**Steps:**
1. Red first: add the case "a nested vitest run checks only what it started (D-6112)", with `nestedVitest` in
   main's shape (a plain `spawnSync`, no `detached`). Run it alone. It is red, and the error names the sibling's
   orphan.
2. Switch `nestedVitest` to `spawnSyncGroup` and route the four existing nested runs through it.
3. Run the whole file. It is green.
4. Red first: in `proc-leak.test.ts`, a child that exits 4 with output and leaves a member in its group; the case
   asserts the stray error carries the status and both streams. Red on the bare message, green after.

**Red test:** the new case. It fails on `origin/main`'s spawn shape and passes after. The orphan is stopped through
the stop-file it watches, never by a PID (D-3533), and each wait is bounded, so a red leaves nothing behind
that outlives its own bound.

**Mutation table (in the PR body):** `detached` dropped from the helper (the old shape) makes the case red. The
same mutation plus the helper's status check removed is still red, because the case also reads the output for the
leak report. The sibling made to fork without waiting for the nested test, so the orphan is in the nested run's
baseline, makes the case pass even in the old shape. That row shows the handshake is what makes the red
deterministic. With the stop-file write removed, the parent run's own leak check names the orphan, which shows the
case cleans up after itself.

**Verify:** `ci-shards.test.ts` and `proc-leak.test.ts` (each alone, `--maxWorkers=2`); `tsc -p
server/test/tsconfig.tests.json`; and from `server/`, the doc suites: deviation-refs (after `git fetch -q origin
main`), dtbd, topology-clean, single-definition and docs-grammar.

**Routing:** native. Judgment about what the leak check may see; not spec-able as a literal change.

**Needs / Gates:** none.

## Global constraints

The behaviour of ccrc does not change. The leak check's contract (D-5894, D-3533) does not change. No open PR's
hunks are touched.

## Review focus

Whether anything a nested run starts can now go unchecked. It cannot: its own check covers its group, and
`spawnSyncGroup` covers what is still in that group after it returns.

## Deviations and decisions

- **D-6112 (2026-10-20)** — `nested-vitest-own-group` (#985): a test that spawns a nested `vitest run` starts it in
  a process group of its own (`spawnSyncGroup`), so the nested run's leak check (`proc-leak.globalsetup.mjs`,
  which watches its own group) sees only what the nested run started and never what other tests of the parent
  shard started while it ran. Measured cause: the process group, not the per-run temp root.
