# ccrc history CP-38: the RSS preload reads the sweep's own peak — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The test-only RSS preload reports the spawned process's OWN peak resident set, so every RSS bound it feeds measures the sweep or CLI it claims to measure, and never the test worker that spawned it.

**Architecture:** `process.resourceUsage().maxRSS` in a spawned child inherits, on Linux, the resident size of the parent at fork. The kernel carries the forked image's high-water mark across `exec`. So the preload has been printing max(the vitest worker's RSS at spawn, the child's own peak). Measured on the fleet box (Node 24, kernel 6.8): a child of a small parent reports maxRSS 44,160 KiB and VmHWM 44,556 KiB; a child of a parent holding 400 MiB reports maxRSS 414,484 KiB and VmHWM 44,476 KiB. `/proc/self/status`'s `VmHWM` is the new process's own peak.

The fix moves the measurement into one small pure function in a sibling fixture module, which the preload calls at exit. A new test file pins it: a guard through a real spawn from a parent holding a large buffer, and unit cases for the fallback. The consumers' bounds are unchanged; their comments' measured figures are re-measured.

**Tech Stack:** Node ESM test fixtures (`.mjs`), vitest, `node:child_process`.

**Spec:** `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md`: §10.1's test seams (history-test-seams-not-env), O20 (the sweep's peak RSS, 256 MiB on the floor interpreter) and DM47.

## Global Constraints

- **Test-only.** Nothing shipped changes: never edit `ccd/**`, `server/src/**`, `deploy/**`, `shared/**`, `agent/**`, `pwa/**`, the spec or the ledger. The ONE exception under `.github/**` is a single added line, `test/history-rss-preload.test.ts`, in `ci.yml`'s node floor (22.16.0) Test list. `ci-pipeline.test.ts` builds that list's expectation from every `history-*.test.ts` file, and `ci.yml`'s own comment there names this as the route. The edit makes this PR's CI run the full suite.
- **The output contract stays.** The preload still writes one line `history-test-maxrss-kib=<n>\n` on stderr at exit, with `<n>` an integer KiB, so every consumer's parser is unchanged. It adds one more line, `history-test-rss-source=<vmhwm|maxrss>\n`, which no consumer is required to read.
- **Linux reads its own peak.** `<n>` is `VmHWM` from `/proc/self/status`, in kB as the kernel prints it. Where that file is absent, unreadable, or has no parseable `VmHWM` line, `<n>` is `process.resourceUsage().maxRSS` and the source line says `maxrss`. The exit hook never throws and never prints 0 or a non-integer.
- **No new environment seam.** The preload stays a `--import` fixture. The fallback is tested through the pure function with an injected reader, never through an environment variable (§10.1).
- **Bounds unchanged.** `IX_RSS_BOUND_KIB`, `IX_LINE_RSS_BOUND_KIB`, DM47's bound and history-recall's bound keep their values. Only the comments' MEASURED figures are corrected, measured over predicted, each naming the Node version it was measured on. Tightening a bound, O20's included, is a Later decision, and O20's is the operator's.
- **D-numbers.** This wave was issued three numbers: D-6964, D-6965 and the one after them. This plan defines D-6964 and D-6965. The third is spare: a departure found while executing takes it, defined in "Deviations found" in the commit that first cites it. Never write any other undefined number.
  - Measured: the plan as first committed named the spare number in full without defining it, and `deviation-refs` red on it ("a tracked file names a global D-ref above the ledger high-water D-6965"). An issued but undefined number is described by count, so the line now does that. Nothing took the spare.
- **The fixture ring.** `history-lib.test.ts`'s `FIXTURE_RING` gives every `.mjs` file in `fixtures/history/` a ring, and a `preload-*.mjs` file may import only `node:*`.
  - `rss-peak.mjs` gets a ring that forbids every import.
  - One exact per-file static allowance, `{ 'preload-rss.mjs': ['./rss-peak.mjs'] }`, is added in the style of `LAZY_IMPORTS` (D-6965).
  - Both changes are pinned by mutants. No other fixture's ring changes.
- **Fixtures.** Synthetic paths in the `/home/u` style only. No private name, host or absolute home path anywhere.

## Review Focus

1. **A `/proc` read that fails.** The file is absent (macOS), unreadable, or has no `VmHWM` line, or a malformed value. Expected: the `maxrss` fallback, an integer, no throw from the exit hook. **Task 1** (unit cases).
2. **Every consumer's spawn mode still parses.** `runSweep`'s `preloads` option, the `NODE_OPTIONS` `--import` lists of the D-4345 line cases, and history-recall's `cli(..., [RSS_PRELOAD])`. Expected: each prints the key once and its parser reads it. **Task 2** (each consumer run).
3. **The guard's CONTROL is real.** The parent must hold the allocation at spawn, or the guard measures nothing. Expected: the case asserts the parent's own RSS above 380 MiB before spawning (the allocation is 400 MiB), and its child's figure far below it. **Task 1**.
4. **Platform.** The darwin legs are advisory (CLAUDE.md). Expected: the spawn guard runs only where `/proc/self/status` exists and is skipped by name elsewhere; the unit cases run everywhere. **Task 1**.
5. **A bound that no longer constrains.** A consumer's figure may now sit far below its bound. Expected: the plan records the measured figures, and nothing changes a bound (Later). **Task 2**.

## Files

| Path | Change |
|---|---|
| `server/test/fixtures/history/rss-peak.mjs` | Create: the pure `ownPeakKiB(readStatus, fallbackKiB)` and the source word |
| `server/test/fixtures/history/preload-rss.mjs` | Modify: call `ownPeakKiB` at exit; print the key line and the source line; header comment |
| `server/test/history-rss-preload.test.ts` | Create: the spawn guard and the unit cases |
| `server/test/history-lib.test.ts` | Modify: `FIXTURE_RING` gives `rss-peak.mjs` a no-import ring, and adds the one exact per-file allowance for `preload-rss.mjs` (D-6965) |
| `.github/workflows/ci.yml` | Modify: ONE added line, `test/history-rss-preload.test.ts`, in the node floor (22.16.0) Test list |
| `server/test/history-ingest.test.ts` | Modify comments only: the measured figures beside `IX_RSS_BOUND_KIB`, `IX_LINE_RSS_BOUND_KIB` and the RSS cases (about :1083-:1100, :1233, :1267, :1294, :1768, :4941), measured over predicted |
| `server/test/history-recall.test.ts` | Modify comments only: the measured figure beside the expand RSS case ("a prototype page peaked at 201,720 KiB", about :3203-:3204) |
| `docs/superpowers/plans/2026-10-26-ccrc-history-cp38-rss-preload.md` | This plan. The first commit adds it byte for byte; Task 2's commit corrects it with the measured figures |

## Not in this plan

Changing any bound; a shared measurement for other packages; macOS's own peak (no `/proc`); the shipped sweep's memory; W2-5b2's files. The same inherited-maxRSS defect at sites that do NOT use the preload is named, not fixed:
- `history-replay.test.ts` about :2936 bounds a child's `peakMiB` below 160. It is W2-5b2's file, held by run 864.
- `history-lib.test.ts` about :7853 and :8277 bound a child's maxRSS below 512 MiB.
- `history-recall.test.ts`'s case "a --full page of an ESC-, backslash- and &-dense summary redacts one window, not one per shrink step" bounds the vitest worker's own maxRSS below 1 GiB.
Each goes into the PR's Residuals.

### Task 1: the measurement, pinned (D-6964)

**Files:** create `server/test/fixtures/history/rss-peak.mjs` and `server/test/history-rss-preload.test.ts`; modify `server/test/fixtures/history/preload-rss.mjs`, `server/test/history-lib.test.ts` (`FIXTURE_RING`, D-6965) and `.github/workflows/ci.yml` (the one node floor line).

**Interfaces:**
- Produces: `ownPeakKiB(readStatus: () => string, fallbackKiB: () => number) -> { kib: number, source: 'vmhwm' | 'maxrss' }`. `readStatus` returns `/proc/self/status`'s text or throws. The result is `vmhwm` when a line matching `/^VmHWM:\s+(\d+)\s+kB$/m` parses to a safe positive integer. Otherwise it is `maxrss`: the fallback's value truncated to an integer, at least 1, and 1 when it is not finite (never NaN).
- The preload: `process.once('exit', () => { const r = ownPeakKiB(() => readFileSync('/proc/self/status', 'utf8'), () => process.resourceUsage().maxRSS); process.stderr.write(\`history-test-maxrss-kib=${r.kib}\nhistory-test-rss-source=${r.source}\n\`); })`. The whole body sits in a `try`, and its `catch` writes nothing rather than throwing.

- [ ] **Step 1: the failing guard.** In `history-rss-preload.test.ts`:
  - **The spawn guard,** run only where `/proc/self/status` exists, and otherwise skipped by its title.
    - Hold `const ballast = Buffer.alloc(400 * 1024 * 1024, 1)` in the test.
    - CONTROL: `process.memoryUsage().rss` exceeds 380 MiB.
    - Then `spawnSync(process.execPath, ['--import', pathToFileURL(PRELOAD).href, '-e', '0'], { encoding: 'utf8' })`.
    - Parse the key line. Expect it below 200 MiB (a bare Node child measures about 45 MiB) and the source `vmhwm`.
    - Keep `ballast` referenced after the spawn.
  - **The unit cases** on `ownPeakKiB`. Each loads the module with `await import('./fixtures/history/rss-peak.mjs')` inside the case, never as a static import, so the spawn guard's red is seen while the module does not yet exist:
    - a real-looking status text gives `vmhwm` with its number;
    - a reader that throws gives `maxrss`;
    - text with no `VmHWM` line gives `maxrss`;
    - `VmHWM:  abc kB` gives `maxrss`;
    - `VmHWM: 0 kB` gives `maxrss`;
    - a fallback of 12.7 gives 12, a fallback of 0 gives 1, and a fallback of NaN gives 1.
- [ ] **Step 2: run it red.** `./node_modules/.bin/vitest run test/history-rss-preload.test.ts`. Predicted:
  - The spawn guard reds at the bound (`expected <about 409,600 or more> to be less than 204800`), because today's preload prints maxRSS.
  - Each unit case reds at its dynamic import of the missing module.
  - Measured (Node 24, this box): 7 failed. The guard red `expected 416612 to be less than 204800`, the parent at 480,940 KiB. Each unit case red `Cannot find module` on `rss-peak.mjs`.
- [ ] **Step 3: the fix.** Create `rss-peak.mjs` and wire the preload as in Interfaces. Its header comment says why maxRSS is wrong on Linux, citing D-6964. Then add the ring and the one allowance to `history-lib.test.ts`'s `FIXTURE_RING` (D-6965), and the one line to `ci.yml`'s node floor Test list. Before the ring edit, run `history-lib.test.ts -t` on its fixture-ring case: it reds on `rss-peak.mjs has no ring` and on the forbidden import. After it, the case is green.
  - Measured: before the ring edit the case reds once, on `preload-rss.mjs: expected [ './rss-peak.mjs' ] to deeply equal []`. The loop reaches `preload-rss.mjs` before `rss-peak.mjs` and stops at the first failure, so `rss-peak.mjs has no ring` is never printed. Both are the ring's red.
- [ ] **Step 4: run it green**, and record the guard's printed figure.
  - Measured: 7 passed; the child printed 48,700 KiB (source `vmhwm`) with the parent at 481,100 KiB. A bare Node child measures about 47 MiB, not 45.
- [ ] **Step 5: mutants, each measured red and restored byte for byte (`cmp`):**
  - M1: the preload prints `process.resourceUsage().maxRSS` again. The spawn guard reds.
  - M2: `ownPeakKiB` drops its `catch`, so a throwing reader throws. The throwing-reader case reds.
  - M3: the positive check is dropped, so `VmHWM: 0 kB` answers `vmhwm` 0. Its case reds.
  - M4: the allowance is removed from `FIXTURE_RING`. The fixture-ring case reds on the forbidden import.
  - M5: `rss-peak.mjs` gains an import (`import 'node:fs';`). Under its no-import ring, the fixture-ring case reds.
  - Measured, each restored by `cp` from a saved copy and `cmp` silent: M1 `expected 417084 to be less than 204800`; M2 reds the throwing-reader case and the fallback-values case (2 failed); M3 `expected { kib: +0, source: 'vmhwm' } to deeply equal { kib: 55, source: 'maxrss' }`; M4 `preload-rss.mjs: expected [ './rss-peak.mjs' ] to deeply equal []`; M5 `rss-peak.mjs: expected [ 'node:fs' ] to deeply equal []`.
- [ ] **Step 6: commit.** `test(history): the RSS preload reads the process's own peak, not the spawning worker's (CP-38 Task 1; D-6964, D-6965)`.

### Task 2: every consumer re-measured

**Files:** comments in `server/test/history-ingest.test.ts` and `server/test/history-recall.test.ts`; this plan's "Measured" section.

- [ ] **Step 1: before and after.**
  - For each consumer case, record the printed peak at the dispatch base (before Task 1, by checking out the base's preload in scratch, never committing it) and after Task 1, on this box's Node.
  - The cases are:
    - O20's pass (:1233);
    - the D-4345 line case (:1267) and the D-4419 line case (:1294);
    - DM47 (:1768);
    - CP-39's walk-cap (:4941);
    - history-recall's expand case (:3254).
  - Use `-t` filters that each select at least one test, and are regex-safe.
- [ ] **Step 2: correct the comments' measured figures**, measured over predicted, naming the Node version. Change no bound and no assertion.
- [ ] **Step 3: record a "Measured" table in this plan.** It holds each case, its figure before and after, its bound, and the Node version.
  - Also note what the node floor CI leg (22.16.0) prints after the PR's CI runs. The PR body gives the CI figure.
- [ ] **Step 4: the suites,** foreground, one per call, from `server/`:
  - `history-rss-preload`, `history-ingest`, `history-recall` and `history-lib`, whole;
  - `ci-pipeline`;
  - `./node_modules/.bin/tsc -p test/tsconfig.tests.json --noEmit`;
  - `citations`, `anchors`, and `deviation-refs` (after `git fetch origin main`).
- [ ] **Step 5: commit.** `test(history): the RSS consumers' measured figures, re-measured with the preload's own peak (CP-38 Task 2; D-6964)`.

### Task 3: the PR

- [ ] Open it against `main`, titled **"ccrc history CP-38: the RSS preload reads the sweep's own peak"**, with the body below and the "Measured" table filled in.
  - Run the private-name scan over the added lines, the commit messages and the body; it must print 0.
  - Read the threads with `gh api graphql`.
  - Send wave-done once CI is green with no open thread and the branch tip is the PR head.

## The PR

```
## ccrc history CP-38: the RSS preload reads the sweep's own peak

### Summary
On Linux, a spawned child's `process.resourceUsage().maxRSS` inherits the parent's resident size at fork, so the test-only RSS preload reported max(the test worker, the sweep). It now reports `/proc/self/status`'s VmHWM, the process's own peak, and falls back to maxRSS where there is no /proc (D-6964).

### Measured
<Task 2's table, and the node floor (22.16.0) leg's figure from this PR's CI>

### Departures
- D-6964, the preload's own-peak figure, and D-6965, the fixture ring's one allowance (both defined in the plan).

### Residuals named
- Bounds unchanged; a consumer whose figure is now far under its bound is a Later decision (O20's is the operator's).
- macOS (no /proc) keeps maxRSS.
- Sites that bound a child's maxRSS without the preload keep the inherited figure: history-replay's child `peakMiB` (W2-5b2's file) and history-lib's two 512 MiB child bounds.

### Tests run
<the suites, with counts>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

## Measured

Each consumer case was run once alone per side on Node v24.14.1 (Linux 6.8): "Before" with the dispatch base's preload (`3a0bd0ad1`, inherited `maxRSS`), "After" with Task 1's (`VmHWM`, the process's own peak).

| Case | Before (KiB) | After (KiB) | Bound (KiB) | Node |
|---|---|---|---|---|
| O20's pass (`history-ingest`) | 299,488 | 314,756 | 524,288 | v24.14.1 |
| D-4345 heaviest structured line | 315,656 | 331,912 | 524,288 | v24.14.1 |
| D-4419 U+008F line | 363,324 | 364,268 | 524,288 | v24.14.1 |
| DM47 64 MiB sidecar | 230,940 | 227,648 | 524,288 | v24.14.1 |
| CP-39 walk-cap | 319,320 | 311,052 | 524,288 | v24.14.1 |
| history-recall expand | 276,416 | 276,744 | 1,048,576 | v24.14.1 |

On this run the two sides differ by a few percent either way, which is run-to-run noise: the vitest worker was not the larger of the two here. No measured consumer case had a worker larger than its sweep; the spawn guard's ballast is the one demonstration.

The node floor (22.16.0) leg, from this PR's CI (run 40284966953), own peak:

| Case | This PR (KiB) | main's merge queue at 3a0bd0ad1 / 98fd13dad, inherited maxRSS (KiB) | Bound (KiB) |
|---|---|---|---|
| O20's pass | 209,928 | 215,644 / 216,844 | 262,144 |
| D-4345 line | 305,408 | 307,896 / 305,952 | 524,288 |
| D-4419 line | 251,884 | 252,108 / 252,952 | 524,288 |
| DM47 | 229,008 | 229,332 / 223,248 | 262,144 |
| CP-39 walk-cap | **272,028 (red)** | **271,508 / 271,180 (red)** | 262,144 |

## Deviations found

- **D-6964** — `history-test-rss-own-peak` (Task 1; spec §10.1, O20, DM47): the RSS preload's figure is the process's own peak (`VmHWM`) where `/proc/self/status` exists, not `process.resourceUsage().maxRSS`. On Linux, maxRSS carries the spawning parent's resident size across fork and exec, so a consumer's figure was max(the test worker at spawn, the sweep's own peak) rather than the sweep's; the spawn guard measures that (a parent at 480,720 KiB: the child read 416,940 KiB with the inherited figure and 47,936 KiB with VmHWM, Node 24.14.1). This contradicted the preload's own header ("never the test runner's"). It did not change the node floor's red: CP-39's walk-cap case reads 272,028 KiB with the own-peak preload (22.16.0, CI run 40284966953) and 271,508 / 271,180 KiB with the inherited one on main (3a0bd0ad1, 98fd13dad), against 262,144 KiB, so the sweep's own peak there is over the bound. The same walk-cap case read 219,376 KiB at fa25c9ee6 with the inherited figure (a CI re-run of the node floor job on 2026-10-26), and the difference is not diagnosed here. No consumer case measured here had a worker larger than its sweep. Without `/proc` the figure stays maxRSS, named by the source line.
- **D-6965** — `history-fixture-ring-rss-peak` (Task 1; D-6964): `history-lib.test.ts`'s `FIXTURE_RING` lets a `preload-*.mjs` fixture import only `node:*`. CP-38 needs one exception: `preload-rss.mjs` imports `./rss-peak.mjs`, a fixture with no imports of its own, so the measurement is a pure, testable function. The widening is one exact per-file allowance, `{ 'preload-rss.mjs': ['./rss-peak.mjs'] }`, in the style of `LAZY_IMPORTS`, with `rss-peak.mjs` given a ring that forbids every import. Every other fixture's ring is unchanged. Pinned by mutants M4 and M5.
