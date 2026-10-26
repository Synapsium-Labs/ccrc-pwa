# Consolidation wave, W8: the kernel tail — the launchd job generated from its `.timer`, the doctor reading cadences from unit files, one bounded update spawner in `shared/spawn.mjs`, the `localcaps` and account-op audits, one journal epoch floor with `appendThenApply`, and one NDJSON framer for the lifecycle mirror and the collect-lane journal — Implementation Plan

> **For agentic workers:** one PR per task, in the order of §Landing order, each dispatched only when its row in §Gates is all green. To execute a task, REQUIRED SUB-SKILL: superpowers:subagent-driven-development, with superpowers:test-driven-development for every red-first step. Steps use checkbox (`- [ ]`) syntax. Workers do not edit this plan (the ledger guard, `.github/ci/ledger-guard.mjs`, refuses a feature branch that modifies an existing file under `docs/superpowers/plans/`). A departure found while executing is written `D-TBD-<slug>` in a NEW per-task note, `docs/superpowers/plans/2026-10-26-consolidation-w8-journals-spawn-launchd/<task>.md`, and named in the task's report; the coordinator enters it.

**Spec:** `docs/superpowers/specs/2026-10-19-ccrc-consolidation-wave-design.md` (rev 2.2, approved by the operator 2026-10-19). §5.1 (the rules every wave follows), §5.11 (W8), K11 (its box half), K17, §3.19 and §7 bind every task. Read them before Step 0.

**Status:** rev 1 (2026-10-26; the review's seven findings applied, §Review log). **Operator ruling 2026-10-26:** the architecture refactor goes first. The consolidation waves W3, W7 and W8 go ahead of coordinator-first round 2 and of the feature programmes not yet started (skins, Settings, the Accounts-connect PWA, the Claude Code binary lifecycle's W2 and W3); those rebase onto the refactored code. Feature PRs already in review may land first. Where a wave was written to wait for one of those programmes, it no longer waits, and it still must not break any live behaviour those programmes shipped. For W8 that changes spec §5.11's "Waits for": **CB W2/W3 are paused, so W8 does not wait for them** (they rebase onto `shared/spawn.mjs`), and **#740 has merged** (`6aec1c7e9`, 2026-10-20), so nothing in §5.11's list holds W8 any more. O3 (a), O9 (a) (a series lands standalone when its first commit is a characterization pin and its exit is counted) and O2 (b) (no ccd logic moves to TS) still bind.

**Inputs.** The W0 plan (`2026-10-19-consolidation-w0-pins.md`), the W1a plan (`2026-10-19-consolidation-w1a-switches-notify.md`) and the W1b plan (`2026-10-20-consolidation-w1b-schedule-listing-redactor.md`), whose Global constraints, Review focus and characterization discipline this plan extends. The census module `server/test/consolidationCensus.ts` (C0b). The scan parser `server/test/scan/parse.ts` (C0f; every new scanner here goes through it). The ring rules in `server/test/rings/` (C0l, C0n, C0p and ARCH-04 stage 4's `totality.test.ts`). The tickets ARCH-69 (#804) and ARCH-73 (#808).

**Base:** `origin/main` `ccba6f9b6`. Every count below was measured on that tree. Code is cited by file and symbol (`ccrc#_exp_ddns_units`, `store.ts#setIntent`), never by line number: lines move, and the citations ratchet refuses new numeric citations in code. Step 0 of each task re-grounds every symbol and every count on the tree it starts from, and **the census query's answer governs, not this plan's number**.

**Deploy class.**
- **C8a and C8b are agent-lane changes** (`ccd/ccrc`, `ccd/ccrc-doctor-checks`): they reach a box through the next ordinary release, AGENT-FIRST. Neither edits `ccd/ccd`, so the launcher's install-time stamp line (`ccd/ccd` line 2, a placeholder `ccd-entry-install.py` fills) is never touched and nothing is restamped. Neither edits the byte-identical platform layer (the region `macos-platform.test.ts` holds equal between `ccd/ccd` and `ccd/ccrc`).
- **C8c is an agent-lane change** (`agent/src/server.ts` and the new `shared/spawn.mjs`), AGENT-FIRST: the fleet node first, then the server.
- **C8d, C8f and C8g are server lane only.** C8e's lane depends on OA-C8a (agent lane if the agent's account-op body moves).
- No task bumps `FLEET_PROTO`, changes a wire frame, migrates `coord.db`, edits any `pwa/` file, restarts a session or changes what a launcher runs.

**Names.** Tasks are **C8-0** (the census split, a precursor) and **C8a** to **C8g**. Operator acts are **OA-C8a** to **OA-C8c**. They are W8's own, so they cannot collide with the names other waves' plans take.

**Goal, PR by PR.**

| After | The operator sees | Underneath |
|---|---|---|
| `main` | nothing | 1 launchd cadence literal (`_exp_ddns_units`' `StartInterval` 300) that restates `deploy/systemd/ccrc-ddns.timer`; 12 candidate cadence restatements in 6 doctor checks; 2 bounded update-spawn bodies held equal by `update-spawn-twin-bodies.test.ts`; 11 process-spawn call sites in 10 files with no census; 2 byte-twin `maxEpoch` readers; 3 hand-written MAX(file, db) floors and 3 hand-written append-before-apply orderings in `store.ts` (4 with `setCollectLane`); 2 hand-rolled NDJSON framers in the lifecycle mirror and the collect-lane journal |
| C8-0 | nothing | three empty per-chain census modules under `server/test/census-w8/`, re-exported from `consolidationCensus.ts` in one tail hunk; no query, no production byte |
| C8a | nothing (OA-C8c (a): `ccrc expose` refuses to place the ddns job on a tree whose `.timer` cannot be read) | `ccrc#_timer_period_s` reads a shipped `.timer`; the ddns job's `StartInterval` comes from it; launchd cadence literals 1 → 0 |
| C8b | nothing (a WARN only on a tree whose `.timer` cannot be read, OA-C8c) | the doctor reads each cadence from the unit file; restated cadences 12 → 0 (or Step 0's base → 0); the codex staleness pin becomes a derived-bound row |
| C8c | nothing | `shared/spawn.mjs#boundedSpawn`; update-spawn bodies 2 → 1; `update-spawn-twin-bodies.test.ts` removed, its token-sync row kept in the spawn kernel's pin |
| C8d | nothing | `localcaps.ts` audited: folded or kept, the reason recorded in the spawn census |
| C8e | nothing (OA-C8a may make the local account arm fall back to the child alone on a non-`ESRCH` kill error, as the agent's does) | `accounts/ops.ts` audited: kept against `exec.ts`; the account-op twin with `agent/src/accountop.ts` folded, pinned or recorded, as OA-C8a rules |
| C8f | nothing | `server/src/journalKernel.ts`: `maxJournalEpoch` (2 → 1), `journalFloor` (3 → 0 hand-written), `appendThenApply` (3 → 0 hand-written orderings, `setCollectLane` audited) |
| C8g | nothing | `journalKernel.ts#splitJournalRecords`; hand-rolled NDJSON framers in the two journals 2 → 1; cursor, gap and generation policies stay with each journal, recorded as legitimately different |

---

## Gates: what each task waits for, stated honestly

Measured on 2026-10-26 at `ccba6f9b6` with `gh pr list -R Synapsium-Labs/ccrc-pwa --state open --json number,title,files,isDraft` (30 open PRs).

- **W0 has landed what W8 needs.** The census module (C0b), the scan parser (C0f), the ring rules stages 1 to 4 and the growth check are on `main`. No W0 later slice is planned for W8's files; each task's Step 0 lists the literal source-text pins over the text it moves and re-points each in its own named commit.
- **W8 waits for no other wave.** Spec §5.11: "These can run in parallel with any wave after W0". It shares no file with W1a's or W1b's series (`watch.ts`, `shared/switches.ts`, `coord/routes.ts`, `server.ts`), so the one-`watch.ts`-series rule does not reach it. It shares `server/test/consolidationCensus.ts`'s tail with every wave (W3's plan, #1589, appends there too), so W8 touches that tail **once**: C8-0 lands three empty per-chain census modules and their three re-export lines in one hunk, measured against every live diff on the file, and after it no W8 task edits `consolidationCensus.ts` or `consolidation-census.test.ts`. Each chain then owns its files outright (§Landing order, "Who creates what"), so no two W8 PRs that may be open at once create or append to the same file.
- **CB W2/W3 no longer gate C8c** (operator ruling 2026-10-26). They rebase onto `shared/spawn.mjs`. Their plans name no edit to `update/spawn.ts` or `makeUpdateSpawn` today (measured: `grep -i spawn` over the W2 and W3 plans finds only `ccd/ccd`'s `_spawn_start`), so the rebase is expected to be a no-op for them.
- **CB W1's shipped pieces must keep working:** the Claude Code version lexicon (#726, #744) and the build guard (#878: `FORBIDDEN_CCD_VERBS`, `FORBIDDEN_PATTERNS`, `childDenyRules`, the hook's `build` arm). No task here edits their files; each Acceptance check lists `git diff --name-only` against them.
- **Rule 6** (spec §5.1): before every commit, each task lists the open PRs holding each file it edits and keeps its hunks line-disjoint from theirs, or waits. On `ccba6f9b6`:
  - **#1578** (settings, wave 29) holds `ccd/ccrc`, `ccd/ccrc-doctor-checks` and `server/test/ccrc-doctor-codex.test.ts`. C8a and C8b edit all three; they take turns after it or are line-disjoint, measured at Step 0.
  - **#1404** (the disk-retention library) holds `ccd/ccrc`. C8a measures its hunk against it.
  - **#1573** holds `server/src/coord/store.ts`. C8f edits `store.ts#allocateDeviations`, `#setAccountPools`, `#setIntent` and `#setCollectLane`; Step 0 measures disjointness.
  - **#1217** holds `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md`, whose ring-context table C8f gains one K file row in. The row is appended inside the K row's cell; Step 0 measures disjointness.
- **OA-C8a** gates C8e's fold or pin commits only (its audit commit lands without it). **OA-C8c** gates **every C8a and C8b commit that makes a consumer read a timer**, not only the failure-arm commits: the moment `_exp_ddns_units` or a doctor check reads the file, a tree whose file cannot be read behaves differently from today (an empty `<integer></integer>` in the plist, an empty operand in `$(( ))` or `-gt`), so the moves are not behaviour-neutral on a broken tree until the failure arm exists. Each of those tasks lands its failure-arm commit, red-first, **before** its move commits, and both wait for the ruling. Before OA-C8c a C8a or C8b branch may carry only its characterization and its pure helpers (Steps 0 to 3), and the PR does not land. **OA-C8b** gates nothing; it is a notice.

| Task | Waits for | Rule 6 today | OA | Other |
|---|---|---|---|---|
| C8-0 census split | — | #1589 and every open PR on `consolidationCensus.ts`'s tail, measured at Step 0 | — | — |
| C8a ddns job from its timer | C8-0 | #1578, #1404 (`ccd/ccrc`) | OA-C8c (the failure-arm commit and the move commits; the PR lands after it) | — |
| C8b doctor reads unit files | C8a (its reader) | #1578 (`ccd/ccrc-doctor-checks`, `ccrc-doctor-codex.test.ts`) | OA-C8c (the failure-arm commits and the move commits; the PR lands after it) | — |
| C8c spawn kernel | C8-0 | none on `update/spawn.ts`, `agent/src/server.ts`, `agent/src/tokensync.ts`, `shared/` | — | — |
| C8d localcaps audit | C8c (it audits against `boundedSpawn`) | none on `localcaps.ts` | — | — |
| C8e account-op audit | C8d (it modifies the `spawners.data.ts` C8d creates) | none on `accounts/ops.ts`, `agent/src/accountop.ts` | OA-C8a (fold or pin commits) | — |
| C8f epoch floor, `appendThenApply` | C8-0 | #1573 (`store.ts`); #1217 (the 08-10 spec) | — | — |
| C8g NDJSON framer | C8f (same kernel file) | none on `mirrorplan.ts`, `collectLane.ts`'s parser | — | — |

## In flight, and what it fences off

| In flight | Files it changes that this plan would otherwise touch | Tasks it gates |
|---|---|---|
| #1578 (settings, wave 29) | `ccd/ccrc`, `ccd/ccrc-doctor-checks`, `server/test/ccrc-doctor-codex.test.ts` | C8a, C8b (rule 6) |
| #1404 (disk-retention library) | `ccd/ccrc` | C8a (rule 6) |
| #1573 (ARCH-60 follow-up) | `server/src/coord/store.ts` | C8f (rule 6) |
| #1217 (registry read cost) | the 08-10 spec | C8f's context-table row (rule 6) |
| CB W2/W3 (paused, unbuilt) | none of W8's files by their plans' text | none; they rebase onto C8c |
| W3 (#1589, a plan) and W7 (planned in parallel) | none of W8's files but `consolidationCensus.ts`'s tail | C8-0 only (rule 6 on the tail); after C8-0 no W8 task touches the tail |

No open PR measured at `ccba6f9b6` holds `server/src/update/spawn.ts`, `agent/src/server.ts`, `agent/src/accountop.ts`, `server/src/accounts/ops.ts`, `server/src/localcaps.ts`, `server/src/coord/ledgerlog.ts`, `server/src/coord/pooledgelog.ts`, `server/src/coord/updateintentlog.ts`, `server/src/coord/collectLaneJournal.ts`, `server/src/collectLane.ts`, `server/src/coord/mirror.ts`, `server/src/coord/mirrorplan.ts`, `deploy/systemd/ccrc-ddns.timer`, `server/test/update-spawn-twin-bodies.test.ts`, `server/test/consolidationCensus.ts` or any file under `server/test/single-definition/`. Each task re-reads every list at Step 0.

## Landing order

```
        ┌── C8a (timer reader; ddns job; 1 → 0; OA-C8c) ── C8b (doctor reads units; 12 → 0; OA-C8c)
C8-0 ───┼── C8c (shared/spawn.mjs; 2 → 1) ── C8d (localcaps audit) ── C8e (account-op audit; OA-C8a)
        └── C8f (epoch floor + appendThenApply) ── C8g (NDJSON framer; 2 → 1)
```

C8-0 lands first. After it the three chains are independent and may run in parallel; within a chain, order is fixed, and **C8d lands strictly before C8e** (spec K17's "audited one at a time", and C8e modifies the file C8d creates). No file is created by one chain and edited by another:

**Who creates what.**

| File | Created by | Modified by (same chain, later only) |
|---|---|---|
| `server/test/census-w8/cadence.ts`, `spawn.ts`, `journal.ts` (empty modules) and their re-export lines in `consolidationCensus.ts` | C8-0 | the cadence chain fills `cadence.ts` (C8a, C8b), the spawn chain `spawn.ts` (C8c, C8d, C8e), the journal chain `journal.ts` (C8f, C8g) |
| `server/test/census-w8/cadence.test.ts` (the cadence queries' fixture and real-tree rows) | C8a | C8b |
| `server/test/census-w8/spawn.test.ts` | C8c | C8d, C8e |
| `server/test/census-w8/journal.test.ts` | C8f | C8g |
| `server/test/single-definition/kernel-tail-cadence.test.ts` (ARCH-69's ratchets) | C8a | C8b |
| `server/test/single-definition/kernel-tail-spawn.test.ts` (ARCH-73's spawn ratchets) | C8c | C8d, C8e |
| `server/test/single-definition/kernel-tail-journal.test.ts` (ARCH-73's journal ratchets) | C8f | C8g |
| `server/test/single-definition/spawners.data.ts` | C8d | C8e |
| `server/src/journalKernel.ts`, `server/test/journal-kernel.test.ts` | C8f | C8g |

A chain's first task that finds its census module already non-empty, or its area file already present, stops and reports: another chain has broken the table.

## Global constraints

The W0 plan's §Global constraints (public repository, SAFETY, no root runner, characterization discipline, counts measured, band routing, branch discipline) and the W1a and W1b plans' (each PR's first commit is a characterization pin, behaviour commits are their own, no `pwa/` file, wire discipline, counted exits) bind this plan, with these additions:

- **Public repository.** No host, IP, account, lane, session or private product name in any commit, fixture, branch, PR body or comment. Fixtures use neutral ids (`lane-a`, `project-a`). No tracker id: cite ARCH-NN, `#n` and D-numbers only.
- **Commands.** Prefix every git and test command with `env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_COMMON_DIR -u GIT_OBJECT_DIRECTORY` (a polluted `GIT_DIR` once wrote test commits into the real repository). Work in a fresh worktree under `~/projects/wt.noindex/`. Run vitest with `--maxWorkers=2`, in the foreground, one suite at a time for the load-sensitive ones. The tests-inclusive typecheck is `cd server && ./node_modules/.bin/tsc -p test/tsconfig.tests.json`.
- **SAFETY.** No task runs a `ccd` verb, `launchctl` or `systemctl` against a live box or the live `$HOME`. Darwin arms are exercised forced (`OSTYPE=darwin…`) under a fixture HOME with the harness's stubbed `launchctl` (`stubLaunchctl`), whose guard (`_svc_launchctl`) refuses the system binary under a sandbox HOME.
- **`ccd/ccd` is not edited.** Its line 2 is an install-time placeholder, never restamped. ARCH-69's reader lives in `ccd/ccrc` outside the platform layer, so `macos-platform.test.ts`'s byte-identical region is unaffected. **No new function outside the platform layer is named `_svc_*` or `_plat_*`:** `macos-platform.test.ts`'s row "holds every _plat_/_svc_ definition INSIDE the sentinels, in both files" refuses any `^(?:_plat_|_svc_)[a-z0-9_]+\(\)` definition below the END sentinel, which is why `_svc_gate` was renamed `_class_gate`. The reader is `_timer_period_s`; the doctor's helpers are `_dr_*`.
- **The rings.** `shared/spawn.mjs` imports nothing: the `.mjs` carve-out (the 08-10 spec, L0; `server/test/rings/mjs-node.data.ts#MJS_CARVE_OUT`) allows only `node:crypto`, `node:fs` and `node:url`, so `node:child_process` and `node:os` reach it as **injected host functions** from each package's own L3 wrapper (D-TBD-w8-spawn-kernel). Nor does it import a `.ts` sibling (no `shared/*.mjs` does): the wire constants the body uses (`UPDATE_SPAWN_DRAIN_MS`, `UPDATE_SPAWN_TIMEOUT_MS`, both in `shared/agent-protocol.ts`) reach it as **options** each wrapper passes from `agent-protocol`, and the `.mjs` defines no copy of either. Its `.d.mts` may `import type` from `agent-protocol.js`, as `shared/roster-json.d.mts` does from `roster.js`. `server/src/journalKernel.ts` imports nothing and makes no I/O (ring L1), and joins the K row of the 08-10 spec's ring-context table in the PR that creates it (`server/test/rings/totality.test.ts`). No new literal union lands in `shared/*.ts`, so `wire-totality` gains no row.
- **The delegation journal stays separate** (spec K17, §3.19: authority vs projection). No `delegation-*.ts` file imports `journalKernel.ts`; C8g's ratchet pins that.
- **New guards go in the chain's own area file; new queries in the chain's own census module.** Per §Landing order's "Who creates what": the cadence chain's ratchets in `single-definition/kernel-tail-cadence.test.ts`, the spawn chain's in `kernel-tail-spawn.test.ts`, the journal chain's in `kernel-tail-journal.test.ts`; each chain's census queries in `server/test/census-w8/<chain>.ts` (reachable from `consolidationCensus.ts` through C8-0's re-export, so "every count comes from a named census query" still holds), held against a fixture tree and the real tree in `server/test/census-w8/<chain>.test.ts`, the same two ways `consolidation-census.test.ts` holds its own. Each query goes through the scan parser (`server/test/scan/parse.ts`) where it reads code.
- **Growth.** `coord/store.ts` and `ccd/ccrc` are on the growth check's list. A task that grows one names its measured net delta in the PR body and, if the check is armed for that file, adds one waiver file under `server/test/growth-waivers/` (one file per waiver, the existing JSON shape).
- **Deviation ledger.** This plan defines unnumbered `D-TBD-<slug>` entries only (§Deviations and decisions). The controller issues their numbers through the allocator and replaces each slug in this plan's ledger PR and in any code comment that cites it; until then `server/test/dtbd.test.ts` is red by design on a branch that carries one. A worker never calls the allocator.

## Review focus (the failure modes most likely to bite)

1. **A cadence that changed on the way through a parser** (C8a, C8b). `OnCalendar=*:0/5` is 300 s, `OnUnitActiveSec=15min` is 900 s, `60min` and `1h` are 3600 s. A **cadence line** is exactly an `OnUnitActiveSec=` or an `OnCalendar=` line; every other key (`OnBootSec=`, `OnActiveSec=`, `AccuracySec=`, `Persistent=`, `RandomizedDelaySec=`, `Unit=`, the `[Unit]` and `[Install]` keys) is ignored, never refused, because 13 of the 14 shipped timers carry `OnBootSec=` or `OnActiveSec=` and `AccuracySec=` beside their period. The reader accepts exactly the spellings the shipped `.timer` files use (Step 0 lists them by census over whatever the directory holds, 14 files at base) and answers unmeasured for anything else; it never guesses a unit. Each consumer's verdict at its boundary (one second inside, one second past) is pinned byte for byte before any move.
2. **Two sources for one cadence** (C8b). The doctor reads the **shipped tree's** unit file (`$BOX_TREE_DIR/deploy/systemd/<timer>`), the file `_inst_units` and `deploy.sh` copy from. It does not read the installed copy for cadence: on macOS no timer is installed (`_inst_units_darwin` places none), and a second reader would be a second source. The installed copy's **mtime** stays the pool-sync and update-sync graces' evidence, as today.
3. **A spawn body that changed while moving** (C8c). The `.mjs` body loses its TypeScript annotations, gains an injected host and reads its drain deadline from `opts.drainMs` where it read the imported `UPDATE_SPAWN_DRAIN_MS`; nothing else moves. The two packages' existing spawn suites, run unchanged, are the characterization; a mutant that drops the drain deadline, the group kill or the `128 + signo` arm reds both packages' suites.
4. **A third twin folded in by accident** (C8c, C8e). `agent/src/tokensync.ts`'s body is its own by D-4390 (stdin piped, an explicit env, SIGTERM before SIGKILL) and stays so. The account-op bodies move only as OA-C8a rules.
5. **An audit that folds a difference away** (C8d, C8e). `localcaps.ts` sends SIGTERM then SIGKILL after `KILL_GRACE_MS`, drops stderr and answers its own reason words; `boundedSpawn` sends SIGKILL at once and keeps stderr. Folding either way is a behaviour change. The audit's table names every option per spawner, and "kept" is a legitimate outcome with its reason recorded.
6. **The journal moved after the row** (C8f). Every caller of `appendThenApply` appends **before** its database write, inside the same `tx()`: a failure after the append leaves the journal ahead (a skipped number, never a reissued one). A mutant that applies first is red in each caller's row.
7. **An error that changed type at the seam** (C8f). `setIntent` maps a journal read fault to `journal-unreadable` and a write fault to `journal-unwritable`; `setCollectLane` reports the phase it failed in (`append`, `update`, `commit`) and rethrows a `decide`-phase error as itself; `allocateDeviations` and `setAccountPools` let a journal error propagate. `appendThenApply` rethrows the original error and exposes the phase; each caller keeps its own mapping.
8. **A lenient reader made strict, or the reverse** (C8f, C8g). `PoolEdgeLog.maxEpoch` and `UpdateIntentLog.maxEpoch` count a torn tail through their regex and throw on a file that yields no epoch; `LedgerLog.maxAllocated` parses first, salvages per project, and answers `null` for an existing file with no number; `parseCollectLaneJournal` refuses a torn, blank or non-increasing file as `malformed`. The shared helpers frame and floor; each reader keeps its own leniency.
9. **A blank line read two ways** (C8g). `frameRead` drops a blank line and still steps its cursor over it; `parseCollectLaneJournal` refuses a blank record as `malformed`. `splitJournalRecords` keeps blanks and reports the tail; each caller decides.
10. **A byte cursor computed in characters** (C8g). `frameRead`'s `nextCursor` is `Buffer.byteLength`, never `String.length`; a multibyte row is a characterization row.

## Tasks

### Task C8-0: the census split, so three chains never share a file (a precursor; no D-number: it moves no code and adds no query)

**Routing:** band 1 (three empty modules and one three-line hunk). **Lane:** none (test tree only). **Needs:** nothing; rule 6 on `consolidationCensus.ts`'s tail against #1589 and every other open PR holding it.

**Files:**
- Create `server/test/census-w8/cadence.ts`, `server/test/census-w8/spawn.ts` and `server/test/census-w8/journal.ts`: a header comment each (which chain fills it, which tasks, and that its fixture rows live in the sibling `<chain>.test.ts` the chain's first task creates), then `export {};`. No query.
- Modify `server/test/consolidationCensus.ts` (tail), **one hunk**: a comment naming W8's split and three lines, `export * from './census-w8/cadence.js';`, `… spawn.js`, `… journal.js`.

- [ ] **Step 0:** list every open PR holding `consolidationCensus.ts` (`gh pr list … --json number,files`), measure the tail hunk against each; confirm `server/test/census-w8/` does not exist and that `tsconfig.tests.json`'s `./**/*.ts` and vitest's `test/**/*.test.ts` reach it; confirm `.github/ci/testmap.mjs` needs no entry for a directory with no test file yet.
- [ ] **Step 1:** the one commit. `cd server && ./node_modules/.bin/tsc -p test/tsconfig.tests.json`; `vitest run test/consolidation-census.test.ts --maxWorkers=2` (unchanged, green).

**Exit (GATES):** the three modules exist and are empty; `consolidationCensus.ts` re-exports them; zero production bytes. **Rollback:** `git revert`, before any chain has filled a module.

### Task C8a: the launchd job's cadence comes from its `.timer` (D-TBD-w8-timer-cadence-reader; ARCH-69 (#804), first half; spec K11's box half)

**Routing:** band 2 for the reader and the move (a pure bash reader and one literal replaced; no verdict changes on a shipped tree); the failure-arm commit is band 3, native. **Lane:** agent (`ccd/ccrc`). **Needs:** C8-0; rule 6 against #1578 and #1404; **OA-C8c for the failure-arm commit and the move commit, so the PR lands only after the ruling** (§Gates).

**Measured on `ccba6f9b6`.** Fourteen `.timer` files ship under `deploy/systemd/`. On macOS, `ccrc install` places **no** timer job (`_inst_units_darwin`; update design decision 17), so exactly one launchd job carries a cadence: `ccrc expose`'s ddns job, written by `ccrc#_exp_ddns_units`' Darwin arm with the literal `<key>StartInterval</key><integer>300</integer>` inside the `cat > "$gen" <<PL` heredoc, which restates `ccrc-ddns.timer`'s `OnCalendar=*:0/5`. The other generated plists (`ccrc#_inst_plist_server`'s server and agent jobs, the platform layer's `_svc_write_session_plist` session jobs) are services with no timer, so ARCH-69's "plists generated from the `.timer` files" is, measured, this one job (D-TBD-w8-timer-cadence-reader). `server/test/ccrc-expose.test.ts` already asserts the `StartInterval` line in its Darwin case. The shipped timers' keys, measured: 13 of 14 carry `OnBootSec=` or `OnActiveSec=` and `AccuracySec=` beside one `OnUnitActiveSec=` (spelled `60s`, `2min`, `15min`, `60min`, `1h`, `4h`); `ccrc-ddns.timer` carries `OnCalendar=*:0/5` and `Persistent=true`. The binary-lifecycle programme's planned `ccrc-claude-install.timer` (its W1 plan, task CB1d) adds `OnUnitActiveSec=30min`, `RandomizedDelaySec=5min` and `Persistent=true`.

**Files:**
- Modify `ccd/ccrc`: add `_timer_period_s <timer-file>` **outside the platform layer** (after `# ── END PLATFORM LAYER`), pure bash (no `date`, no GNU-only call). **Not `_svc_timer_period_s`:** a `_svc_`/`_plat_` definition below the END sentinel reds `macos-platform.test.ts` ("holds every _plat_/_svc_ definition INSIDE the sentinels"), the reason `_svc_gate` became `_class_gate`. It reads the file and prints the period in whole seconds, rc 0, from its one **cadence line**, which is exactly an `OnUnitActiveSec=<n><unit>` line (units `s`, `min`, `h`, as the shipped files spell them) or an `OnCalendar=*:0/<n>` line (every `<n>` minutes). Every other key is ignored, never refused (`OnBootSec=`, `OnActiveSec=`, `AccuracySec=`, `Persistent=`, `RandomizedDelaySec=`, `Unit=`, `Description=`, `WantedBy=`, section headers, comments, blanks). rc 1 with a one-line why on stderr, and nothing on stdout, for a missing or unreadable file, no cadence line, two cadence lines (two `OnUnitActiveSec=`, two `OnCalendar=`, or one of each), or a cadence line in any other spelling. It never prints the path's contents.
- `_exp_ddns_units`' Darwin arm: **before** the heredoc, `period=$(_timer_period_s "$tree/deploy/systemd/$CCRC_DDNS_UNIT.timer")` into a `local`, refusing on rc 1 before any file is written (the failure-arm commit, OA-C8c); the heredoc then writes `<key>StartInterval</key><integer>$period</integer>` (the move commit). No `$(…)` inside the heredoc, so an unreadable timer can never yield `<integer></integer>`, with or without `plutil` on the box. `$tree` is the tree its Linux arm copies from. Every other byte of the plist is unchanged. Its header comment's "`OnCalendar=*:0/5` becomes 300 seconds" becomes "the period `_timer_period_s` reads from the shipped timer".
- Create `server/test/timer-period.test.ts`.
- Modify `server/test/ccrc-expose.test.ts`: the characterization rows below (the Darwin case's existing assertion stays) and the failure-arm row.
- Modify `server/test/census-w8/cadence.ts` (C8-0's module): `launchdCadenceLiterals()`, every `<key>StartInterval</key>` or `<key>StartCalendarInterval</key>` in `ccd/ccrc` and `ccd/ccd` whose value is not `<integer>$<name></integer>` where `<name>` is a `local` assigned, in the same function, from `$(_timer_period_s …)` (a literal, an inline `$(…)` or a variable from anywhere else all count); and `timerSpellings()`, every distinct value of an `OnUnitActiveSec=` or `OnCalendar=` line in `deploy/systemd/*.timer` (those two keys only, every file the directory holds at run time).
- Create `server/test/census-w8/cadence.test.ts`: both queries held against a fixture tree (a literal, an inline `$(…)`, a foreign variable and the accepted shape; a timer with `OnBootSec=`, `AccuracySec=`, `RandomizedDelaySec=` and `Persistent=` lines, which `timerSpellings()` does not list) and on the real tree (the ddns literal found at base; the shipped spellings listed).
- Create `server/test/single-definition/kernel-tail-cadence.test.ts` with the ARCH-69 block, last commit: `launchdCadenceLiterals()` is empty, and every value `timerSpellings()` lists is one `_timer_period_s` answers rc 0 for (read over the directory at run time, so a new shipped timer such as CB1d's is covered the day it lands).

- [ ] **Step 0: Re-ground** `_exp_ddns_units`, the plist writers, the platform layer's end marker and every shipped timer's lines by census, not by this plan: list, per file, its cadence line and every other key, and confirm the reader's ignore list covers each other key. Confirm no other launchd job carries a cadence, and that no `_timer_` function exists in `ccd/ccrc` or `ccd/ccd`. Rule 6 against #1578 and #1404 on `ccd/ccrc`. Record whether the growth check is armed for `ccd/ccrc`.
- [ ] **Step 1: Characterization commit.** Forced Darwin, fixture HOME, stubbed `launchctl`: `ccrc expose duckdns`'s generated `app.ccrc.ccrc-ddns.plist`, **whole file, byte for byte**, plus its `plutil -lint` call and the bootstrap sequence the stub records. Green on the old code.
- [ ] **Step 2: Red.** `timer-period.test.ts`, sourcing `ccd/ccrc`: `OnUnitActiveSec=60s` → 60; `=2min` → 120; `=15min` → 900; `=30min` → 1800; `=60min` → 3600; `=1h` → 3600; `=4h` → 14400; `OnCalendar=*:0/5` → 300; and for every shipped file the directory holds, the answer the file means. **Ignored keys, each rc 0 with the cadence line's answer:** `OnBootSec=45s` plus `OnUnitActiveSec=60s` → 60; `OnActiveSec=2min` plus `OnUnitActiveSec=2min` → 120; `AccuracySec=1min` beside `OnUnitActiveSec=15min` → 900; `OnCalendar=*:0/5` plus `Persistent=true` → 300; CB1d's shape, `OnUnitActiveSec=30min` plus `RandomizedDelaySec=5min` plus `Persistent=true` → 1800; a commented `#OnUnitActiveSec=5min` beside `OnUnitActiveSec=15min` → 900. Refusals, each rc 1 with its why and empty stdout: absent file; a directory; a file with only `OnBootSec=` and `AccuracySec=` (no cadence line); two `OnUnitActiveSec=` lines; `OnUnitActiveSec=` plus `OnCalendar=`; `OnUnitActiveSec=15m` (a spelling no shipped file uses); `OnUnitActiveSec=60` (no unit); `OnUnitActiveSec=1.5h`; `OnCalendar=daily`. Red (no function).
- [ ] **Step 3: Green** (the reader alone; no consumer calls it). `macos-platform.test.ts` green.
- [ ] **Step 4: Failure-arm commit (after OA-C8c), red-first, before the move.** `_exp_ddns_units` computes `period` before the heredoc and, on rc 1, refuses to place the job before writing any plist, with a sentence that names the unit (never its contents), as its existing invalid-plist refusal does; the heredoc still writes the literal 300. The row "an unreadable `ccrc-ddns.timer` places no job, writes no plist and says why" fails before the commit, with and without `plutil` on `PATH`; Step 1's whole-file row runs unchanged. The PR body lists the before (a job placed with 300) and after rows and cites OA-C8c.
- [ ] **Step 5: Move commit.** The heredoc writes `<integer>$period</integer>`. Behaviour-neutral on every tree now: a tree whose timer cannot be read already refused at Step 4. Step 1's whole-file row runs unchanged.
- [ ] **Step 6: Ratchet commit.**
- [ ] **Step 7: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `min` read as 1 s | timer-period | "`OnUnitActiveSec=15min` is 900" |
  | `*:0/5` read as 5 s | timer-period, ccrc-expose | "`OnCalendar=*:0/5` is 300"; the whole-file row |
  | an unknown unit answered as seconds | timer-period | "`15m` is refused" |
  | `OnBootSec=` counted as a cadence line | timer-period | "`OnBootSec=45s` plus `OnUnitActiveSec=60s` is 60" |
  | `RandomizedDelaySec=` refused | timer-period | CB1d's shape is 1800 |
  | `OnUnitActiveSec=` plus `OnCalendar=` answered with the first | timer-period | "one of each is refused" |
  | the ddns arm keeps `<integer>300</integer>` | single-definition (kernel-tail-cadence) | "no launchd cadence literal" |
  | the heredoc calls `$(_timer_period_s …)` inline | single-definition (kernel-tail-cadence) | "no launchd cadence literal" (an inline `$(…)` counts) |
  | the refusal moved after the heredoc | ccrc-expose | "places no job, writes no plist" |
  | the reader named `_svc_timer_period_s` | macos-platform | "sits outside the platform-block sentinels" |
  | the reader moved inside the platform layer of `ccd/ccrc` only | macos-platform | the two platform layers differ |
  | a new shipped timer spelled `OnUnitActiveSec=10m` | single-definition (kernel-tail-cadence) | "every shipped spelling is one the reader reads" |

- [ ] **Step 8: Verify.**

      cd server && ./node_modules/.bin/vitest run test/timer-period.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccrc-expose.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/macos-platform.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/timer-first-run.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/census-w8/cadence.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/single-definition/kernel-tail-cadence.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/consolidation-census.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/tsc -p test/tsconfig.tests.json

**Exit (GATES):** `launchdCadenceLiterals()` 1 → 0, pinned; every shipped timer spelling readable, pinned over the directory; the ddns plist byte-identical on the shipped tree; an unreadable timer refused before any write; `ccd/ccd` and both platform layers unchanged. **Must not change:** the ddns job's bytes on a shipped tree, label, `RunAtLoad`, `ProcessType`, the token staying in the 0600 exposure file, the Linux arm, any session or server plist. **Rollback:** `git revert`, through the next release.

### Task C8b: the doctor reads every cadence from the unit file (D-TBD-w8-doctor-reads-units; ARCH-69 (#804), second half; spec K11, §5.11's first gate)

**Routing:** band 2 for the helpers and the move commits; the failure-arm commits are band 3, native (they add a WARN arm to six checks). **Lane:** agent (`ccd/ccrc-doctor-checks`). **Needs:** C8a; rule 6 against #1578; **OA-C8c for the failure-arm commits and the move commits, so the PR lands only after the ruling** (§Gates).

**Measured on `ccba6f9b6`: 12 candidate sites in 6 checks** (non-comment lines of `ccd/ccrc-doctor-checks` whose number or duration word is derived from a shipped timer's cadence):

| Check | Site | Today | Derivation |
|---|---|---|---|
| `_check_pool-sync` | `pool_sync_grace=$((2 * 60))` | 120 s | 2 × `ccd-pool-sync.timer`'s `OnUnitActiveSec=60s` (its comment says "two of the timer's own periods") |
| `_check_pool-sync` | the not-yet-synced WARN, "fires every 60s" | sentence | 1 × period |
| `_check_pool-sync` | its remedy, "(up to ~60s)" | sentence | 1 × period |
| `_check_pool-sync` | the `pool-sync-malformed` remedy, "(every 60s)" | sentence | 1 × period |
| `_check_update-sync` | `update_sync_grace=$((2 * 60))` | 120 s | 2 × `ccd-update-sync.timer`'s 60 s |
| `_check_update-sync` | the not-yet-synced WARN, "fires every 60s" | sentence | 1 × period |
| `_check_update-sync` | its remedy, "(up to ~60s)" | sentence | 1 × period |
| `_check_graphify` (the census arm) | `[ "$age" -gt 2700 ]` | 2700 s | 3 × `ccd-graph-sweep.timer`'s 15 min |
| `_check_models` | `[ "$age" -gt 10800 ]` | 10800 s | 3 × `ccrc-models.timer`'s 60 min (its comment argues the 3 h floor from the timer) |
| `_check_codex` (`_dr_codex_usage`) | `_DR_CODEX_USAGE_STALE_S=2700` | 2700 s | 3 × `ccrc-codex-usage@.timer`'s 15 min (`ccrc-doctor-codex.test.ts` ties it today) |
| `_check_codex` (`_dr_codex_usage`) | `_DR_CODEX_USAGE_STALE_DIRECT_S=3600` | 3600 s | 3 × 15 min + `ccgpt-usage.py`'s `BRIDGE_FRESH_S` (900) |
| `_check_scope-sweep` | `stale=${CCRC_SCOPE_SWEEP_STALE_S:-300}` (the literal twice on one line) | 300 s | 5 × `ccd-scope-sweep.timer`'s 60 s **if** Step 0 shows it was derived; otherwise a call-bound setting (`ccrc-settings-census.test.ts` classes `CCRC_SCOPE_SWEEP_STALE_S` `call-bound`), kept and reported |

The spec's §5.11 gate says "14 → 0"; that matches the number of shipped `.timer` files, not this query (OA-C8b). The gate is this census's measured base → 0. Every derived bound above equals today's value on the shipped units, so no verdict changes.

**Files:**
- Modify `ccd/ccrc-doctor-checks`:
  - `_dr_timer_period_s <unit>`: prints `_timer_period_s "$BOX_TREE_DIR/deploy/systemd/<unit>"`'s answer (the shipped tree, Review focus 2) and caches it per doctor run. It carries the file's existing **loaded guard**: if `${BOX_TREE_DIR:-}` is empty or `declare -F _timer_period_s` fails, it answers rc 3 and prints nothing, and the calling check FAILs with the existing sentence shape, "this is a bug in ccrc, not a fact about your box — <check> reads <unit>'s cadence through _timer_period_s and BOX_TREE_DIR, both declared once in ccrc itself, and this check table was sourced by something that is not ccrc". rc 1 (the file cannot be read) is OA-C8c's arm, Step 4.
  - `_dr_cycles_s <unit> <k>`: k × period, rc and stdout passed through from `_dr_timer_period_s`; it prints nothing on a nonzero rc, and **every caller tests the rc before any `$(( ))` or `-gt`**, so an empty operand never reaches arithmetic.
  - **Nothing runs at source time.** `_DR_CODEX_USAGE_STALE_S=2700` and `_DR_CODEX_USAGE_STALE_DIRECT_S=3600` are top-level assignments today, so they run whenever the table is sourced, and many rows source `CHECKS_SRC` without `ccrc`, under `set -u`, with no `BOX_TREE_DIR` (`ccrc-doctor-codex.test.ts`'s "sourced without ccrc, the rows FAIL naming the bug", which calls `_dr_codex_usage_box`, is one). The two globals are **removed**; both bounds are computed lazily inside `_dr_codex_usage`, after its existing guards (so the "sourced without ccrc" rows' sentences stay byte-equal): `bound=$(_dr_cycles_s ccrc-codex-usage@.timer 3)`, and for a direct lane that plus a named `_DR_CODEX_BRIDGE_FRESH_S=900` (a bridge constant, not a cadence, so it may stay a top-level literal; the existing pin to `ccgpt-usage.py#BRIDGE_FRESH_S` keeps it). No other new top-level statement calls a function.
  - Each site in the table reads them: the graces become `_dr_cycles_s ccd-pool-sync.timer 2` and its update-sync twin; the three "three cycles" bounds become `_dr_cycles_s <timer> 3`; the sentences say the period through `_bt_age` or `$((p))s` so each prints today's words on the shipped units ("every 60s", "up to ~60s"). One site per commit.
- Modify `server/test/ccrc-doctorFixture.ts` only if Step 0 measures that the fixture's shipped tree (`$BOX_TREE_DIR`) lacks `deploy/systemd/`: it then copies the repository's `deploy/systemd/*.timer` into it, and a seam lets a row substitute one file.
- Modify `server/test/ccrc-doctor-codex.test.ts`: the "staleness thresholds" pin, which reads the constants and checks them against the timer's text, becomes a behaviour row: a fixture tree whose `ccrc-codex-usage@.timer` reads `OnUnitActiveSec=20min` moves the litellm bound to 3600 s and the direct bound to 4500 s. This is the "doctor's cadence pin goes away" of ARCH-69, in its own named commit.
- Modify `server/test/census-w8/cadence.ts`: `doctorRestatedCadences()`, two arms: (1) the named sites above by check and token; (2) a structural arm over non-comment lines: a `_dr_warn`/`_dr_fail`/`_dr_pass` sentence containing `every <n>(s|min|h)` or `up to ~<n>`, and an integer literal ≥ 60 compared with `age` (`-gt`, `-lt`, `-ge`) or assigned to a name containing `grace`, `stale` or `bound`, outside `_dr_timer_period_s` and `_dr_cycles_s`. Display arithmetic (`/ 60`, `/ 3600` for minutes and hours) is not a cadence and is not matched; Step 0 names each excluded line. And `doctorSourceTimeCalls()`: every line of `ccd/ccrc-doctor-checks` outside any function body (not a comment) that calls a `_dr_*`, `_box_*` or `_timer_*` function. (A bare `$(` is not the shape: the table's head resolves `CCRC_HERE` through `$(cd … && pwd)` at source time today, and that calls none of them.)
- Modify `server/test/census-w8/cadence.test.ts`: both queries' fixture and real-tree rows.
- Modify `server/test/single-definition/kernel-tail-cadence.test.ts`, last commit: `doctorRestatedCadences()` is empty (or lists only the scope-sweep default, reported, if Step 0 classes it call-bound); `doctorSourceTimeCalls()` is empty.

- [ ] **Step 0: Re-ground** every site by census on the tree after C8a and #1578; classify the scope-sweep default (`git log -S'SCOPE_SWEEP_STALE_S'` for its origin); record the base count; measure whether the fixture tree has `deploy/systemd/`; list the doctor suites that cover each check (`ccrc-doctor-core`, `-codex`, `-exposure`, `-fleet`, `-graphify`, `doctor-box-token`, the install fixture's closing doctor run). **List every test that sources `CHECKS_SRC` without `CCRC_SRC`** (`grep -l CHECKS_SRC server/test/*.ts`, then each `source`/`.` line read for which files it loads) and, for each, which moved site its rows reach; each such row is in Step 1 and runs unchanged at every commit. Record `doctorSourceTimeCalls()` at base (expected 0: the two codex assignments are literals and the `CCRC_HERE` resolution calls no helper; the census governs). Rule 6 against #1578.
- [ ] **Step 1: Characterization commit.** Per site, on the shipped units, driven through the check: the verdict and its sentence byte for byte **one second inside and one second past** each bound (pool-sync and update-sync: a timer file installed 119 s and 120 s ago; graph-sweep: a census 2700 s and 2701 s old; models: a catalogue `fetchedAt` 3 h − 60 s and 3 h + 60 s old, as `ccrc-doctor-exposure.test.ts` does; codex litellm and direct: rows 2700/2701 s and 3600/3601 s old; scope-sweep: a record 300/301 s old). Plus `ccrc install`'s closing doctor run ends green on a fresh fixture box (D-139: "a fresh install ends green"). Plus, for every Step 0 row that sources the table without `ccrc`, its output byte for byte. Green on the old code.
- [ ] **Step 2: Red.** `_dr_cycles_s ccd-graph-sweep.timer 3` answers 2700, `ccrc-models.timer 3` 10800, `ccd-pool-sync.timer 2` 120; a call per doctor run reads each file once (a counting stub); with `BOX_TREE_DIR` unset, or `_timer_period_s` undeclared (the table sourced alone), rc 3 and empty stdout, and the calling check's FAIL names the bug; with the file absent, rc 1 and empty stdout. Red (no helper).
- [ ] **Step 3: Green** (the helpers; no check calls them yet).
- [ ] **Step 4: Failure-arm commits (after OA-C8c), red-first, one check per commit, before that check's move.** In each check, the bound is computed through `_dr_cycles_s` into a local **before** any comparison, and on rc 1 the check prints a WARN naming the unit and saying its cadence could not be read from the shipped unit file, so the bound is unmeasured, and records no other verdict for that bound (it never falls back to a literal); on rc 3 it FAILs naming the bug. In this commit the check still compares against today's literal, so on a shipped tree nothing changes. Red-first per check: "an unreadable `<timer>` makes `<check>` WARN unmeasured, never compare against a literal or an empty operand". The PR body lists before and after rows and cites OA-C8c.
- [ ] **Step 5: The move commits**, one site per commit: the literal gives way to the computed local. Each runs Step 1's rows unchanged; behaviour-neutral on every tree, because Step 4 already answered the unreadable case.
- [ ] **Step 6: The codex pin's commit** (the derived-bound row above).
- [ ] **Step 7: Ratchet commit.**
- [ ] **Step 8: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `pool_sync_grace` back to `$((2 * 60))` | single-definition (kernel-tail-cadence) | "no restated cadence in the doctor" |
  | `_dr_cycles_s` multiplies by k − 1 | Step 1's graph-sweep row | the 2701 s row warns no longer |
  | the doctor reads the installed unit for cadence | Step 1's models row under forced Darwin | the row's cadence is unmeasured (no installed timer on Darwin) |
  | a new WARN sentence "the timer fires every 15 min" | single-definition (kernel-tail-cadence) | the structural arm |
  | the codex direct bound drops the bridge window | ccrc-doctor-codex (derived-bound row) | "a direct row one missed poll old reads stale" |
  | `_DR_CODEX_USAGE_STALE_S=$(_dr_cycles_s ccrc-codex-usage@.timer 3)` at top level | ccrc-doctor-codex "sourced without ccrc"; kernel-tail-cadence | the row's sentence; "nothing runs at source time" |
  | the loaded guard dropped from `_dr_timer_period_s` | Step 2's unset-`BOX_TREE_DIR` row | "FAIL names the bug" |
  | a check compares before testing `_dr_cycles_s`' rc | Step 4's row for that check | "never an empty operand" |
  | the failure arm falls back to 2700 | Step 4's graph-sweep row | "an unreadable timer is unmeasured, never a literal" |

- [ ] **Step 9: Verify** each doctor suite Step 0 names, one at a time, `ccrc-settings-census.test.ts`, `census-w8/cadence.test.ts`, `kernel-tail-cadence.test.ts`, `consolidation-census.test.ts`, `timer-period.test.ts`, then `tsc -p test/tsconfig.tests.json`.

**Exit (GATES):** `doctorRestatedCadences()` from Step 0's base (12 by this plan's reading) → 0, pinned (the scope-sweep default reported by name if it is call-bound); `doctorSourceTimeCalls()` 0, pinned; every doctor verdict and sentence unchanged at every boundary on the shipped units, and every sourced-without-ccrc row unchanged; the codex constant-to-timer pin replaced by a derived-bound row. **Must not change:** any check's verdict, sentence or remedy on a shipped tree; `CCRC_SCOPE_SWEEP_STALE_S`'s override; the graces' mtime evidence; any check's skip arms; any existing "this is a bug in ccrc" sentence. **Rollback:** `git revert`, through the next release.

### Task C8c: one bounded update spawner, `shared/spawn.mjs` (D-TBD-w8-spawn-kernel; ARCH-73 (#808), its spawn half; spec K17 "Process spawn")

**Routing:** **band 3, native**: the body runs `ccrc update --detach` from the wire's `update` op and from the server's own node, and kills a process group. Two reviewers. **Lane:** agent, AGENT-FIRST. **Needs:** C8-0.

**Measured on `ccba6f9b6`.** `server/src/update/spawn.ts#boundedUpdateSpawn` and `agent/src/server.ts#makeUpdateSpawn` carry one body between `// ── BEGIN bounded-spawn body` and `// ── END bounded-spawn body`, held equal line for line by `server/test/update-spawn-twin-bodies.test.ts`; each declares its own `UPDATE_SPAWN_MAX_BUFFER` (1 MiB), and each body reads `UPDATE_SPAWN_DRAIN_MS` imported from `shared/agent-protocol.ts`, a `.ts` file the `.mjs` cannot import. The pin's second describe holds D-4390: `agent/src/tokensync.ts`'s spawn is its own body, not a third twin; it also asserts that `agent/src/server.ts` "still carries exactly one pair" of sentinels and reads `region(agent/src/server.ts)` for the twins' `stdio: ['ignore', 'pipe', 'pipe']`, both of which the agent move makes false, so it cannot move unchanged. `agent/src/tokensync.ts`'s header cites the pin by file name. The body needs `spawn` (`node:child_process`) and `os.constants.signals` (`node:os`), which the `.mjs` carve-out does not allow, so the shared module takes them injected. `update/spawn.ts` stays separate from `exec.ts` (spec K17, §3.19: a process-group runner vs the `CcdArgv` ACL runner).

**Files:**
- Create `shared/spawn.mjs` (imports nothing, neither a `node:` builtin nor a `.ts` sibling): `boundedSpawn(host, file, args, { env, timeoutMs, drainMs })` → `Promise<UpdateSpawnResult>`, the body moved verbatim but for its type annotations, with `spawn` and `signals` read from `host` (`{ spawn, signals }`) and the drain deadline read from **`drainMs`** where the body reads the imported `UPDATE_SPAWN_DRAIN_MS` today. All three options are required (no default inside the `.mjs`): the body has no copy of `UPDATE_SPAWN_DRAIN_MS` or `UPDATE_SPAWN_TIMEOUT_MS`, which stay single-defined in `shared/agent-protocol.ts`. `UPDATE_SPAWN_MAX_BUFFER` (a local capture cap, not a wire constant) is defined here once. `process.kill`, `setTimeout`, `clearTimeout` and `Buffer` stay globals, as in `shared/mark.mjs`. No bounded-spawn sentinel is carried into it.
- Create `shared/spawn.d.mts` (the types: `import type { UpdateSpawnResult } from './agent-protocol.js'`, as `shared/roster-json.d.mts` imports from `roster.js`; the `SpawnHost` shape; the options with `drainMs: number`).
- Modify `server/src/update/spawn.ts`: `boundedUpdateSpawn` keeps its signature and defaults and becomes `boundedSpawn({ spawn, signals: os.constants.signals }, file, args, { env, timeoutMs, drainMs: UPDATE_SPAWN_DRAIN_MS })`, the constant from its existing `agent-protocol` import; its sentinels and its own `UPDATE_SPAWN_MAX_BUFFER` go; its header says "a thin wrapper over `shared/spawn.mjs#boundedSpawn`" where it says "the twin of the agent's `makeUpdateSpawn`", and keeps the "separate from `exec.ts`" paragraph.
- Modify `agent/src/server.ts`: `makeUpdateSpawn(env)` returns `(file, args, timeoutMs) => boundedSpawn({ spawn, signals: osConstants.signals }, file, args, { env, timeoutMs, drainMs: UPDATE_SPAWN_DRAIN_MS })`, the constant from its existing `agent-protocol` import; its sentinels and its own `UPDATE_SPAWN_MAX_BUFFER` go; its doc comment stays.
- Modify `agent/src/tokensync.ts`: **one comment line only**, its header's "`server/test/update-spawn-twin-bodies.test.ts` holds that this file carries no twin sentinel" becomes "`server/test/spawn-kernel.test.ts` holds that this file carries no bounded-spawn sentinel and calls no `boundedSpawn`" (in Step 6's commit, so the header never cites a deleted file). No code byte of it changes; `git diff -U0 origin/main...HEAD -- agent/src/tokensync.ts` shows that one line.
- Create `server/test/spawn-kernel.test.ts`: `shared/spawn.mjs` imports nothing; both wrappers call `boundedSpawn` and carry no `spawn(file, [...args]` of their own; **both wrappers pass `drainMs: UPDATE_SPAWN_DRAIN_MS` imported from `agent-protocol`** (a literal, a local constant or a missing option is red); and, from Step 6, the D-4390 rows (below).
- Delete `server/test/update-spawn-twin-bodies.test.ts` (Step 6).
- Modify `server/test/census-w8/spawn.ts` (C8-0's module): `updateSpawnBodies()`, every file outside `shared/spawn.mjs` with a `spawn(` call whose options carry `detached: true` and `stdio: ['ignore', 'pipe', 'pipe']` and whose body sends `process.kill(-child.pid, 'SIGKILL')`; and `spawnKernelWireLiterals()`, every definition in `shared/spawn.mjs` of a name containing `DRAIN` or `TIMEOUT`, and every numeric literal passed to `setTimeout` there (a drain or a bound redefined in the `.mjs` is a second definition of a wire constant).
- Create `server/test/census-w8/spawn.test.ts`: both queries on a fixture tree (a wrapper with the body, a thin wrapper, an `.mjs` with `const DRAIN_MS = 2000`, one with `setTimeout(f, 2000)`, one with `setTimeout(f, drainMs)`) and on the real tree (2 bodies at base; 0 literals).
- Create `server/test/single-definition/kernel-tail-spawn.test.ts`: `updateSpawnBodies()` is empty; `spawnKernelWireLiterals()` is empty; `UPDATE_SPAWN_MAX_BUFFER` is defined once (`shared/spawn.mjs`).

- [ ] **Step 0: Re-ground** both bodies, the sentinels, every suite that exercises either spawner (server: `update-spawn.test.ts`, `update-spawn-deadline.test.ts`, `update-local-spawn-throw.test.ts`, `whitelist-subset.test.ts`; agent: `update-spawn.test.ts`, `update-spawn-deadline.test.ts`, `update-killed-arms.test.ts`, `update-busy-writer.test.ts`, `update-op.test.ts`), and every literal source-text pin over either file, `agent/src/tokensync.ts` included (its D-4390 rows). List every name from `shared/agent-protocol.ts` the body reads (at `ccba6f9b6`: `UPDATE_SPAWN_DRAIN_MS` in the body, `UPDATE_SPAWN_TIMEOUT_MS` as the server wrapper's default, the `UpdateSpawnResult` type); each becomes an option or a type import, never an `.mjs` definition. Confirm no `shared/*.mjs` imports a `.ts` sibling. Confirm the agent build emits `dist/shared/spawn.mjs` (`agent/tsconfig.json` includes `../shared/**/*.mjs`) and the release tarball carries `shared/`.
- [ ] **Step 1: Characterization commit.** One table run against **both** wrappers through their public signatures, real child processes under a fixture HOME: exit 0 with stdout; exit 3 with stderr; stdout over 1 MiB → `stdout: null`; a parent past the bound → `killed: true`, its whole group gone (a grandchild in the group is dead); a grandchild that left the group (`setsid`) holding a pipe → the answer within `timeoutMs + UPDATE_SPAWN_DRAIN_MS`, `stdout: null`; a parent ended by a signal not ours → `128 + signo`; an absent launcher → code 1, `could not start the launcher (ENOENT)`, `pid: null`; nothing resolves twice. Green on `main` (it extends what the existing suites assert, row for row; Step 0 records which rows are new).
- [ ] **Step 2: Red.** `spawn-kernel.test.ts`'s import, call and `drainMs` rows, and `shared/spawn.mjs`'s own unit rows (a stub host; `drainMs: 50` bounds the setsid row at `timeoutMs + 50`). Red (no module).
- [ ] **Step 3: Green:** `shared/spawn.mjs` and its `.d.mts`. Neither wrapper calls it yet; the twin pin is green.
- [ ] **Step 4: Move commit, the server wrapper.** It runs Step 1's table and both packages' spawn suites unchanged. The twin pin's equality describe ("the agent's region equals the server's") now reads a server region that is gone, so it is red on this commit only, and Step 5 follows it at once (the W1b plan's order: each move followed by its pin's commit).
- [ ] **Step 5: Pin commit, named "the update-spawn twin pin's equality half goes: one of its two bodies is now shared/spawn.mjs".** It deletes that describe only; the D-4390 describe stays byte-identical in the old file, and Step 1's two-wrapper table holds the behaviour equal.
- [ ] **Step 6: Move commit, the agent wrapper, then the D-4390 re-point in its own named commit, "D-4390's rows read shared/spawn.mjs: tokensync.ts and server.ts carry no sentinel".** The agent move leaves `agent/src/server.ts` with no sentinel and no body, so D-4390's "server.ts still carries exactly one pair" and its `region(agent/src/server.ts)` stdio read are red on the move commit only. The re-point commit moves the D-4390 describe into `spawn-kernel.test.ts` and deletes `update-spawn-twin-bodies.test.ts`:
  - **re-pointed:** `agent/src/tokensync.ts`, `agent/src/server.ts`, `server/src/update/spawn.ts` and `shared/spawn.mjs` each carry **0** bounded-spawn sentinels (was: tokensync 0, server.ts exactly one pair); "the twins pipe no stdin" reads `shared/spawn.mjs#boundedSpawn`'s source (`sourceOfSymbol`) for `stdio: ['ignore', 'pipe', 'pipe']` (was: `region(agent/src/server.ts)`); and `agent/src/tokensync.ts` calls no `boundedSpawn`;
  - **byte-equal:** every tokensync assertion (`stdio: ['pipe', 'pipe', 'pipe'], env: childEnv`, `signalGroup('SIGTERM')`, `signalGroup('SIGKILL')`, TERM before KILL), and the describe's D-4390 comment, but for its "The twins stay two" sentence, which becomes "the update spawner is one body, `shared/spawn.mjs`";
  - the same commit carries `tokensync.ts`'s one header-comment line (above).
- [ ] **Step 7: Ratchet commit.**
- [ ] **Step 8: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `armDrain` restarts an armed deadline | update-spawn-deadline (both packages) | "the answer within timeout + drain" |
  | the kill signals the parent alone | Step 1's group row | "a grandchild in the group is dead" |
  | `128 + signo` dropped | Step 1, update-killed-arms | the signal row |
  | `shared/spawn.mjs` imports `node:child_process` | rings/mjs-node | "no builtin beyond the carve-out" |
  | `shared/spawn.mjs` imports `./agent-protocol.ts` for the drain | spawn-kernel | "imports nothing" |
  | `shared/spawn.mjs` defines `const UPDATE_SPAWN_DRAIN_MS = 2_000` | single-definition (kernel-tail-spawn) | "the kernel defines no drain or bound" |
  | the agent wrapper passes `drainMs: 2000` | spawn-kernel | "both wrappers pass the protocol constant" |
  | the server wrapper omits `drainMs` | spawn-kernel; Step 1's setsid row | the option row; "the answer within timeout + drain" |
  | `tokensync.ts` calls `boundedSpawn` | spawn-kernel | the D-4390 row |
  | a sentinel pair left in `agent/src/server.ts` | spawn-kernel | "server.ts carries 0 sentinels" |
  | a second `spawn(file, [...args]` with `detached` in `agent/src` | single-definition (kernel-tail-spawn) | "one bounded update spawner" |

- [ ] **Step 9: Verify** every suite Step 0 names, one at a time, in both packages; `spawn-kernel.test.ts`, `census-w8/spawn.test.ts`, `kernel-tail-spawn.test.ts`, `rings/mjs-node.test.ts`; `cd server && ./node_modules/.bin/tsc -p test/tsconfig.tests.json`; `cd agent && ./node_modules/.bin/tsc --noEmit` and `npm run build`, then confirm `agent/dist/shared/spawn.mjs` exists.

**Exit (GATES):** update-spawn implementations 2 → 1 (`shared/spawn.mjs`), pinned by `updateSpawnBodies()`; `update-spawn-twin-bodies.test.ts` removed; `UPDATE_SPAWN_MAX_BUFFER` definitions 2 → 1; `UPDATE_SPAWN_DRAIN_MS` and `UPDATE_SPAWN_TIMEOUT_MS` still defined once (`agent-protocol.ts`), the kernel defining neither, pinned; the D-4390 rows kept, re-pointed in their own commit, the tokensync assertions byte-equal. **Must not change:** `UpdateSpawnResult`'s shape and every answer in Step 1's table; `boundedUpdateSpawn`'s and `makeUpdateSpawn`'s signatures and defaults; the update op's wire; `exec.ts`'s `Runner`; `tokensync.ts`'s code (one header-comment line changes, above). **Rollback:** `git revert`; the agent half reaches the fleet node through the next release, AGENT-FIRST.

### Task C8d: `localcaps.ts`, audited (D-TBD-w8-localcaps-audit; ARCH-73 (#808); spec K17 "Audited one at a time")

**Routing:** band 2 for the audit and the census; a fold, if the audit allows one, is band 3. **Lane:** server. **Needs:** C8c; it lands **before** C8e (C8e modifies the `spawners.data.ts` this task creates).

**Measured on `ccba6f9b6`.** `localcaps.ts#execCapped` spawns `ccd caps` `detached`, stdout piped and capped by hand, stderr ignored; at `LOCAL_CAPS_TIMEOUT_MS` (10 s) it sends SIGTERM to the group, then SIGKILL after `KILL_GRACE_MS` (2 s), and answers its own reason words (`could not spawn: …`, `timed out after <n>ms`, `spawn error: …`). `exec.ts#realRunner` has no timeout and no group kill (by design: it serves tmux and ccd at unbounded verb cadence). `shared/spawn.mjs#boundedSpawn` kills with SIGKILL at once, keeps stderr and has a drain deadline. **Expected verdict: kept** (it needs options `exec.ts` lacks, and folding it onto `boundedSpawn` changes its kill and its answers); the audit decides.

**Files:**
- Modify `server/test/census-w8/spawn.ts`: `processSpawnSites()`, every `spawn(`, `execFile(`, `spawnSync(`, `execFileSync(`, `execSync(` and `fork(` call in `server/src`, `agent/src` and `shared/` (11 sites in 10 files at `ccba6f9b6`).
- Create `server/test/single-definition/spawners.data.ts`: `PROCESS_SPAWNERS`, one row per site (`file#symbol`), each with its reason in the `EntrySet` shape (`server/test/rings/exemptions.ts`): `exec.ts#realRunner` (C2's ACL runner), `shared/spawn.mjs#boundedSpawn` (the update spawner), the two `pty.ts` (tmux attach), `update/converge.ts`'s call (it calls the injected spawner, not `child_process`: Step 0 confirms, and the query excludes it if so), `tokensync.ts` (D-4390), the agent's exec op (its whitelist), the account-op pair (C8e), and `localcaps.ts#execCapped` with this audit's verdict.
- Modify `server/test/census-w8/spawn.test.ts`: `processSpawnSites()`' fixture rows (each call shape counted, a comment and an import passed over) and its real-tree list.
- Modify `server/test/single-definition/kernel-tail-spawn.test.ts`: `processSpawnSites()` equals `PROCESS_SPAWNERS`' keys in both directions (a new spawner needs a row and a reason; a stale row is red), and the set may only shrink.
- If the audit shows a fold is possible with no output change: modify `server/src/localcaps.ts` in its own commits, Step 1's rows unchanged.

- [ ] **Step 0: The audit table** in the PR body: one column per spawner (`execCapped`, `realRunner`, `boundedSpawn`), one row per option (detached group, stdio per stream, env, timeout, kill signals and grace, output cap, drain, answer words, caller's no-evidence reading of each failure). The verdict follows from the table: fold onto `exec.ts` only if no row differs; fold onto `boundedSpawn` only if every differing row is unobservable to `readLocalCcdCaps`' callers (`null` on every failure). Otherwise kept, with the differing rows as the reason.
- [ ] **Step 1: Characterization commit.** `readLocalCcdCaps`: caps parsed on success; `null` on a nonzero exit, a timeout (a `sleep` past the bound, its group gone after the grace), a spawn error and output past the cap. Green on `main` (extends `localcaps.test.ts`).
- [ ] **Step 2: Census and allowlist commit;** then the fold commits only if the verdict is "fold".
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | a new `spawn(` in `server/src` with no row | single-definition (kernel-tail-spawn) | "every spawner has a reason" |
  | `PROCESS_SPAWNERS` keeps a row whose site is gone | single-definition (kernel-tail-spawn) | "no stale spawner row" |
  | (if folded) the timeout kills with SIGKILL at once | Step 1's timeout row | the group's grace |

- [ ] **Step 4: Verify** `localcaps.test.ts`, `boot.test.ts`, `lifecycle.test.ts`, `readme-holds.test.ts`, `update-inventory.test.ts`, `census-w8/spawn.test.ts`, `kernel-tail-spawn.test.ts`, `consolidation-census.test.ts`, one at a time; `tsc -p test/tsconfig.tests.json`.

**Exit (GATES):** `localcaps.ts` folded or kept per its audit, the verdict and its reason in `PROCESS_SPAWNERS`; `processSpawnSites()` equal to the allowlist, may only shrink. **Must not change:** `readLocalCcdCaps`' answers, its 10 s bound, its group kill. **Rollback:** `git revert`.

### Task C8e: `accounts/ops.ts`, audited, and the account-op twin it has in the agent (D-TBD-w8-account-op-audit; ARCH-73 (#808); spec K17 "Audited one at a time") — fold or pin GATED on OA-C8a

**Routing:** band 3, native: the local arm spawns `ccrc account` subs with a secret on stdin (D-5513) and is on the operator's account-management path. Two reviewers. **Lane:** server; agent too if OA-C8a (a). **Needs:** C8d (landed: it creates `spawners.data.ts`, and spec K17 audits one at a time); OA-C8a for any commit after the audit.

**Measured on `ccba6f9b6`.** `accounts/ops.ts#localAccountOps` spawns the launcher `detached` with stdin piped (the secret, never argv), an explicit `{HOME, PATH, LANG}`, stdout capped at `ACCOUNT_OP_OUTPUT_MAX_BYTES`, stderr drained and dropped, SIGTERM to the group at the sub's bound, SIGKILL after `ACCOUNT_OP_KILL_GRACE_MS`, then `ACCOUNT_OP_DRAIN_MS`. `exec.ts` has none of stdin, an explicit env, a bound or a group kill, so **against `exec.ts` it is kept**. The audit finds what spec K17 did not list: `agent/src/accountop.ts#makeAccountOpSpawn` is the same algorithm (its own header calls it modelled on the token-sync port), spelled a second time, with **one measured difference**: on a kill that throws other than `ESRCH`, the agent falls back to `child.kill(s)`, and the local arm does nothing. Nothing pins the two equal. The spec's "`shared/spawn.mjs` for the update-spawn twin only" does not cover this pair, so what happens to it is OA-C8a's.

**Files (audit commit, always):**
- The audit table in the PR body: `localAccountOps`, `makeAccountOpSpawn`, `realRunner` and `boundedSpawn`, one row per option, as C8d's.
- Modify `server/test/single-definition/spawners.data.ts`: the two account-op rows' reasons name this audit's verdict.
- Create `server/test/account-op-twins.test.ts`, the characterization: one table driven through **both** arms with real child processes under a fixture HOME (stdin bytes reach the child exactly, no newline added; the child's environment is exactly the three names; stdout past the cap → `too-large` and the group killed; a sub past its bound → `timeout`, TERM then KILL after the grace, the KILL never cancelled; a launcher that cannot start → `not-started`; a signal not ours → `128 + signo`). Green on `main`. The non-`ESRCH` kill error is the one row the two arms answer differently; it is recorded per arm.

**Files (after OA-C8a):**
- **(a), fold:** `shared/spawn.mjs#boundedStdinSpawn(host, file, argv, stdin, { env, timeoutMs, killGraceMs, maxOutputBytes, drainMs })`, the agent's body; `localAccountOps` and `makeAccountOpSpawn` call it. Behaviour commit first, red-first: the local arm's non-`ESRCH` row changes to the agent's (it falls back to the child alone); then the moves; `updateSpawnBodies()`' sibling `accountSpawnBodies()` (in `server/test/census-w8/spawn.ts`, its rows in `census-w8/spawn.test.ts`) ratchets 2 → 1 in `kernel-tail-spawn.test.ts`.
- **(b), pin:** sentinels around both bodies and a twin pin in `update-spawn-twin-bodies`' old shape (a new file, `server/test/account-op-twin-bodies.test.ts`), with the divergent arm made equal in a behaviour commit first.
- **(c), record only:** nothing beyond the audit commit; the rows name "two bodies, unpinned, by OA-C8a (c)".

- [ ] **Step 0: Re-ground** both bodies and their suites (`account-ops.test.ts`, `single-definition/ask-digest.test.ts`'s rows over `localAccountOps`, `agent/test/account-op.test.ts`); confirm the SAFETY account rules' pins (`ACCOUNT_DENY_RULES`, the hook's account arm, `must-allow.json`) do not read either file. Write the audit table.
- [ ] **Step 1: Characterization commit** (above). Green on `main`.
- [ ] **Step 2: Audit commit** (rows and reasons). **Stop here until OA-C8a.**
- [ ] **Step 3 (after OA-C8a):** the ruled commits, behaviour commit first where the ruling has one, citing OA-C8a.
- [ ] **Step 4: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | stdin gains a trailing newline | account-op-twins (both arms) | "stdin reaches the child exactly" |
  | `process.env` passed to the child | account-op-twins | "exactly three names" |
  | the KILL cancelled on the leader's exit | account-op-twins | "the KILL is never cancelled" |
  | (a) the local arm keeps its no-fallback kill | account-op-twins, the after-row | the non-`ESRCH` row |
  | (a) a second stdin-piped group spawner in `server/src` | single-definition (kernel-tail-spawn) | "one account-op spawner" |

- [ ] **Step 5: Verify** every suite Step 0 names, one at a time, in both packages, and `kernel-tail-spawn.test.ts`, `census-w8/spawn.test.ts`; `tsc -p test/tsconfig.tests.json`; for (a) also `cd agent && ./node_modules/.bin/tsc --noEmit`.

**Exit (GATES):** `accounts/ops.ts` kept against `exec.ts`, its verdict recorded; the account-op pair folded (2 → 1), pinned or recorded, as OA-C8a rules. **Must not change:** the secret's path (stdin only, D-5513), the child's environment, the bounds table (`ACCOUNT_SUB_TIMEOUT_MS`), any `AccountOpResult` but the one ruled row; account switching and the auto-swap (untouched files). **Rollback:** `git revert`; (a)'s agent half through the next release.

### Task C8f: one epoch floor and one `appendThenApply` for the log-first journals (D-TBD-w8-journal-floor; ARCH-73 (#808), its journal half; spec K17 "Journal-to-db mirrors", third bullet)

**Routing:** **band 3, native**: the floor is what keeps a deviation number, a pool epoch and an update epoch from ever being reissued, and `setCollectLane` is the collector switch's one writer. Two reviewers, one reading only Review focus 6 to 8. **Lane:** server. **Needs:** C8-0; rule 6 against #1573 and #1217.

**Measured on `ccba6f9b6`.**
- `PoolEdgeLog.maxEpoch` (`coord/pooledgelog.ts`) and `UpdateIntentLog.maxEpoch` (`coord/updateintentlog.ts`) are one body (read the file; `ENOENT` → `null`; any other error throws; a regex `"epoch":(\d+)` over every non-empty line; a file that yields no epoch throws), differing only in the first words of the thrown message (`pool-edges journal exists at …`, `update-intent journal exists at …`). `LedgerLog.maxAllocated` (`coord/ledgerlog.ts`) is a different reader on purpose: it parses each line first, filters by project and salvages a torn line per project; and it answers `null` for an existing file with no number, where the other two throw (OA-C8b reports this; it is not changed here).
- `store.ts` writes the MAX(file, db) floor by hand three times: `allocateDeviations` (MAX, then `decideAllocation`), `setAccountPools` (MAX + 1) and `setIntent` (MAX + 1).
- It orders "append the journal, then write the row, in one `tx()`" by hand four times: those three and `setCollectLane` (its journal `CollectLaneJournal`, appended before the `UPDATE`, with a phase answer: a throw at or after the append is `failed` with its phase and errno word; a throw before it propagates).

**Files:**
- Create `server/src/journalKernel.ts` (imports nothing; L1; context K): `maxJournalEpoch(text: string, what: string): number` (the shared regex body; throws with `` `${what} journal exists at ${path}` ``… exactly as each caller's sentence reads today, the caller passing its words and path), `journalFloor(dbMax: number | null, fileMax: number | null): number | null` (MAX with `null` meaning "nothing recorded"), and `appendThenApply<D, R, S>(step, phase?)`: `step.decide()` answers `{ go: D }` or `{ stop: S }`; on `go` it calls `step.append(d)` and then `step.apply(d)`, sets `phase.at` to `'append'`, `'apply'` and `'done'` as it passes each, and rethrows any error unchanged. It opens no transaction: each caller calls it inside its own `tx()`.
- Modify `server/src/coord/pooledgelog.ts` and `server/src/coord/updateintentlog.ts`: `maxEpoch` reads the file (I/O stays in the L3 adapter) and hands the text to `maxJournalEpoch`, one file per commit.
- Modify `server/src/coord/store.ts`: `setAccountPools`, `setIntent` and `allocateDeviations` call `journalFloor` and `appendThenApply`, one method per commit, each keeping its own error mapping (`IntentJournalFault` stays `setIntent`'s). `setCollectLane` moves last, **only if** its Step 1 rows (every refusal, `unchanged`, each `failed` phase, the decide-phase rethrow, the post-commit re-reads) run unchanged with `phase` read from `appendThenApply`; otherwise it is kept and reported by name, its reason "a phase answer `appendThenApply` would have to grow a fifth arm for" (D-TBD-w8-journal-floor).
- Modify `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md`: `journalKernel.ts` joins the K row's `server/src` cell of the ring-context table (rule 6 against #1217).
- Modify `server/test/census-w8/journal.ts` (C8-0's module): `epochFloorReaders()` (a `/"epoch":\(\\d\+\)/` regex in `server/src` outside `journalKernel.ts`), `journalFloorSites()` (a `Math.max(dbMax, fileMax)` or `fileMax === null ? dbMax` shape in `server/src` outside `journalKernel.ts`), `appendBeforeApplySites()` (inside a `tx(` callback in `store.ts`, a call to `log.append`, `journal.appendGeneration` or a `*Log` parameter's `append` followed by a `this.db.prepare(` write, outside `appendThenApply`).
- Create `server/test/census-w8/journal.test.ts`: the three queries' fixture rows (each shape counted; the kernel's own lines, a comment and a read-only `tx()` passed over) and their real-tree lists (2, 3 and 3 or 4 at base).
- Create `server/test/single-definition/kernel-tail-journal.test.ts`: `epochFloorReaders()` is empty; `journalFloorSites()` is empty; `appendBeforeApplySites()` is empty or lists only `setCollectLane`, reported; `journalKernel.ts` imports nothing.
- Create `server/test/journal-kernel.test.ts`.

- [ ] **Step 0: Re-ground** the four store methods, the three readers and their suites (`pooledgelog.test.ts`, `pool-edges-store.test.ts`, `update-store-intent.test.ts`, `update-intent-cross-side.test.ts`, `ledgerlog.test.ts`, `ledger-store.test.ts`, `ledger-race.test.ts`, `collect-lane-store.test.ts`, `collect-lane-journal-undo.test.ts`, `collect-lane-writers.test.ts`); count by census. Rule 6 against #1573 (`store.ts`) and #1217 (the spec). Record `store.ts`'s line count at base (an observation; it shrinks).
- [ ] **Step 1: Characterization commit.** Per method, with a recording journal fake that logs `maxEpoch`/`append` calls into the same ordered list as the store's statements (`DatabaseSync` traced through a wrapper the fixture already uses, or a `PRAGMA`-free row read after each step):
  - the order: floor read, decide, journal append, row write, in one transaction;
  - the floor: file ahead of the db (the next number is past the file), db ahead of the file, both empty (`setAccountPools` and `setIntent` → 1; `allocateDeviations` → the seeded floor), a torn last line counted;
  - an append that throws → no row changed, the transaction rolled back, each method's answer (`journal-unwritable` for `setIntent`; the error itself for the other two; `failed` phase `append` for `setCollectLane`);
  - a row write that throws after the append → the journal one entry ahead, the row unchanged (the "skipped, never reissued" direction);
  - a `maxEpoch` that throws → `journal-unreadable` for `setIntent`, the error itself for `setAccountPools`;
  - the two `maxEpoch` sentences byte for byte; `maxAllocated`'s `null` on an existing empty file (recorded, not changed).
  Green on `main`.
- [ ] **Step 2: Red.** `journal-kernel.test.ts`: `maxJournalEpoch` over empty text throws; over `{"epoch":3}\n{"epoch":7` answers 7 (a torn tail counts); `journalFloor(null, null)` is `null`, `(4, null)` 4, `(4, 9)` 9; `appendThenApply` calls append before apply, never apply after an append that threw, returns `stop` without calling either, rethrows the original error, and leaves `phase.at` at the step that threw. Red (no module).
- [ ] **Step 3: Green**, then the move commits, one reader or method per commit, `setCollectLane` last; each runs Step 1's rows unchanged.
- [ ] **Step 4: Ratchet commit** (with the spec's context row in the same PR).
- [ ] **Step 5: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `appendThenApply` applies before it appends | Step 1's order rows (each method) | "the journal is written before the row" |
  | `journalFloor` ignores the file | Step 1's file-ahead rows | "the next number is past the file" |
  | `maxJournalEpoch` answers `null` for no epoch | pooledgelog, update-store-intent | "a file with no epoch throws" |
  | `setIntent` lets a journal fault escape as a throw | Step 1's `journal-unwritable` row | the mapped answer |
  | `setCollectLane`'s phase read as `apply` for a commit failure | Step 1's `failed` phase rows | "phase commit" |
  | `LedgerLog.maxAllocated` routed through `maxJournalEpoch` | ledgerlog (salvage per project) | "a torn line for another project does not count" |
  | `journalKernel.ts` imports `node:fs` | single-definition (kernel-tail-journal), rings | "the kernel imports nothing" |

- [ ] **Step 6: Verify** every suite Step 0 names, one at a time; `rings/totality.test.ts`, `rings/outward-edges.test.ts`, `census-w8/journal.test.ts`, `kernel-tail-journal.test.ts`, `consolidation-census.test.ts`, `deviation-refs.test.ts`; `tsc -p test/tsconfig.tests.json`.

**Exit (GATES):** byte-twin epoch readers 2 → 1 (`maxJournalEpoch`); hand-written MAX(file, db) floors 3 → 0; hand-written append-before-apply orderings in `store.ts` 3 → 0, with `setCollectLane` moved or reported by name; `journalKernel.ts` mapped to K, ring L1. **OBSERVATION:** `store.ts` lines at base and tip. **Must not change:** any number the allocator, the pool epoch or the update epoch issues; any answer word (`journal-unreadable`, `journal-unwritable`, `failed` and its phases, `multi-pool-not-supported`, `empty-patch`); the three journals' file formats and paths; the delegation journal (no file of it edited). **Rollback:** `git revert` per commit, newest first; no stored data changes.

### Task C8g: one NDJSON framer for the lifecycle mirror and the collect-lane journal; their cursor, gap and generation policies stay their own (D-TBD-w8-journal-frame; ARCH-73 (#808); spec K17 "Journal-to-db mirrors", first and second bullets)

**Routing:** band 2 (two pure framers onto one pure helper, every policy kept). **Lane:** server. **Needs:** C8f (the kernel file).

**Measured on `ccba6f9b6`, the audit the spec's sentence needs.** Spec K17 says the lifecycle mirror (`coord/mirror.ts`, `coord/mirrorplan.ts`, `coord/journalparse.ts`) and the collect-lane generation journal (`coord/collectLaneJournal.ts`, `collectLane.ts#parseCollectLaneJournal`) "share one cursor, gap and generation helper". Read side by side:
- **Framing is the same job:** each splits NDJSON text into its complete lines and a tail after the last newline (`mirrorplan.ts#frameRead`: `lastIndexOf('\n')`, `split('\n')`; `parseCollectLaneJournal`: `split('\n')` and a popped empty last element).
- **The cursor is the mirror's alone.** It reads `[cursor, size)` of a fleet-box file over FleetIO and advances a byte cursor; the collect-lane journal is read whole on the server box, bounded at `COLLECT_LANE_JOURNAL_MAX_BYTES`, and has no cursor.
- **"Gap" means two different facts.** The mirror records `shrank`, `rotated-away` and unorderable names as `lifecycle_gaps` rows and reads on; the collect-lane journal's equivalent is `mismatch` (journal ahead of or behind the row), which arms nothing until an operator writes (spec 2026-10-12 §5.2).
- **"Generation" means two different things.** The mirror's is a rotation file name ordered by `compareGenerations` (L0); the collect-lane's is a positive integer that must strictly rise, the proof that `coord.db` did not move backward.
- **Their tolerance is opposite on purpose.** The mirror drops a blank line and leaves a partial tail unconsumed for the next read; the collect-lane parser refuses a blank, a torn or a non-increasing record as `malformed`, and nothing rebuilds it.

So one helper is real (framing) and the rest is legitimately different: a projection's incremental read with recorded gaps vs a proof file read whole (D-TBD-w8-journal-frame). The delegation journal stays separate (authority, spec §3.19).

**Files:**
- Modify `server/src/journalKernel.ts`: `splitJournalRecords(text)` → `{ complete: string, records: readonly string[], tail: string }`: `complete` is the text through the last `\n` (empty when none), `records` its lines in order **with blanks kept**, `tail` what follows the last `\n`.
- Modify `server/src/coord/mirrorplan.ts#frameRead`: uses it; drops blank records itself; `nextCursor` is `cursor + Buffer.byteLength(complete, 'utf8')` as today; the shrink test is unchanged.
- Modify `server/src/collectLane.ts#parseCollectLaneJournal`: uses it; `records` plus a non-empty `tail` as the last record; a blank record stays `malformed` `blank`; numbering of `record` unchanged.
- Modify `server/test/census-w8/journal.ts`: `journalFramers()`, a `lastIndexOf('\n')` or a `split('\n')` over journal text in `coord/mirrorplan.ts`, `coord/journalparse.ts`, `collectLane.ts#parseCollectLaneJournal` and `coord/collectLaneJournal.ts`, outside `journalKernel.ts`.
- Modify `server/test/census-w8/journal.test.ts`: `journalFramers()`' fixture and real-tree rows.
- Modify `server/test/single-definition/kernel-tail-journal.test.ts`: `journalFramers()` is empty; no `coord/delegation-*.ts` file imports `journalKernel.ts`.
- Modify `server/test/journal-kernel.test.ts`: the framer's rows.

- [ ] **Step 0: Re-ground** both framers, every caller, and the suites (`mirrorplan.test.ts`, `journalparse.test.ts`, `lifecycle-replay.test.ts`, `lifecycle-mirror.test.ts`, `collect-lane-journal.test.ts`, `collect-lane-control.test.ts`); confirm `journalparse.ts` frames nothing itself (it parses one line); count by census; confirm the audit above on the tree, and if Step 0 finds a cursor, gap or generation step the two really share, name it in the PR body with its rows before writing any code.
- [ ] **Step 1: Characterization commit.** `frameRead`: a payload ending without a newline (cursor stops at the last complete line); a blank line dropped and stepped over; a multibyte line (`nextCursor` in bytes); a shrink below the cursor and above it (`size < lastSize`). `parseCollectLaneJournal`: empty → `empty`; a blank record; a file with no final newline (its last record read); a torn last record (`json`); a non-increasing generation (`order`) with its record number. Green on `main`.
- [ ] **Step 2: Red.** `splitJournalRecords('')` → all empty; `'a\n\nb'` → records `['a', '']`, tail `'b'`; `'a\n'` → records `['a']`, tail `''`; a multibyte `complete` round-trips. Red (no function).
- [ ] **Step 3: Green**, then two move commits (`frameRead`, then `parseCollectLaneJournal`); each runs Step 1's rows unchanged.
- [ ] **Step 4: Ratchet commit.**
- [ ] **Step 5: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `splitJournalRecords` drops blanks | collect-lane-journal | "a blank record is malformed" |
  | `frameRead` counts `complete.length` | Step 1's multibyte row | "the cursor is in bytes" |
  | the tail treated as a complete line in `frameRead` | Step 1's no-newline row | "a partial line is not consumed" |
  | the tail dropped in `parseCollectLaneJournal` | Step 1's no-final-newline row | its last record read |
  | `delegation-journal.ts` imports the kernel | single-definition (kernel-tail-journal) | "the delegation journal stays separate" |

- [ ] **Step 6: Verify** every suite Step 0 names, one at a time; `census-w8/journal.test.ts`, `kernel-tail-journal.test.ts`, `consolidation-census.test.ts`; `tsc -p test/tsconfig.tests.json`.

**Exit (GATES):** hand-rolled NDJSON framers in the two journals 2 → 1 (`splitJournalRecords`), pinned; the delegation journal imports nothing from the kernel, pinned. **OBSERVATION:** the cursor, gap and generation policies, recorded per journal as legitimately different (D-TBD-w8-journal-frame). **Must not change:** any `FramedRead`, any `CollectLaneJournalRead`, any gap row, any `record` number, the read caps. **Rollback:** `git revert`.

## Operator acts in this wave

- **OA-C8a (before C8e's fold or pin commits): the account-op twin.** C8e's audit finds `accounts/ops.ts#localAccountOps` and `agent/src/accountop.ts#makeAccountOpSpawn` to be one algorithm in two bodies, unpinned, differing in one arm (a kill error other than `ESRCH`: the agent falls back to the child alone, the local arm does nothing). Spec K17 says `shared/spawn.mjs` is "for the update-spawn twin only", so widening it is the operator's. Options: **(a)** fold both into `shared/spawn.mjs#boundedStdinSpawn`, the local arm taking the agent's fallback in a behaviour commit (recommended: it is the update twin's case again, and the fallback is the safer direction); **(b)** keep two bodies and pin them equal, the divergent arm made equal first; **(c)** keep both unpinned and record it. The ask shows C8e's audit table and the one differing row. Nothing on a box is touched; C8e lands its audit commit and stops until the ruling.
- **OA-C8b (a notice, gates nothing): the spec's counts this plan re-measured.** The doctor's restated cadences are 12 candidate sites in 6 checks by a defined query, not 14 (14 is the number of shipped `.timer` files); exactly one launchd job carries a cadence (the ddns job), because macOS installs no timer job; the update-spawn bodies need injected host functions, because `shared/*.mjs` may not import `node:child_process` or `node:os`; `localcaps.ts` is expected to stay (it needs a SIGTERM grace and its own answer words); an account-op twin exists that the spec did not list (OA-C8a); `LedgerLog.maxAllocated` answers `null` for an existing file with no number where the two epoch readers throw, which this wave records and does not change; the lifecycle mirror and the collect-lane journal share framing only. The operator may ask for any of these to be done differently.
- **OA-C8c (before C8a's and C8b's failure-arm and move commits, so before either PR lands): what a shipped `.timer` that cannot be read does.** The old code never read the files, so the failure arm is new, and a move without it is not behaviour-neutral on a broken tree (an empty `<integer></integer>` in the ddns plist, which `plutil` refuses where present and launchd is handed where not; an empty operand in a doctor comparison). Each task lands its failure arm, red-first, before its moves. Options: **(a)** `ccrc expose` refuses to place the ddns job, and each doctor check whose cadence cannot be read prints a WARN naming the unit and computes no verdict from a bound it does not have (recommended: a release tree always ships the files, so this fires only on a broken tree, and it never falls back to a literal); **(b)** the same, but the doctor FAILs instead of WARNs; **(c)** keep a literal fallback beside the reader (not recommended: it is the second source the ticket removes; under (c) the failure-arm commits fall back instead of refusing, and `launchdCadenceLiterals()` and `doctorRestatedCadences()` keep the fallbacks, reported by name, so the exits read "1 → 1" and "12 → 12").
- **Arming nothing.** W8 changes no lane's arming and no switch's meaning.
- **The wave's deploys** follow the standing rule: from a fresh `origin/main` worktree as a detached unit, verified from its log, AGENT-FIRST for C8a, C8b, C8c and (by OA-C8a (a)) C8e; no session restarts.

## Acceptance

Every PR body carries: the census lists at base and tip (this plan's queries and C0b's); the mutation table's red lines; the rule 6 disjointness check (each edited file, each open PR holding it, the hunks); the first commit's name as the characterization pin; `env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_COMMON_DIR -u GIT_OBJECT_DIRECTORY git diff --stat origin/main...HEAD`; `git diff --name-only origin/main...HEAD -- pwa ccd/ccd` printing nothing; and `git diff --name-only origin/main...HEAD` showing none of CB W1's files (`shared/claudeVersion.ts`, `server/src/coord/approvalguard.ts`, the session hook's build arm). C8a and C8b also print `git diff --name-only origin/main...HEAD -- ccd` as `ccd/ccrc` and/or `ccd/ccrc-doctor-checks` only, and cite OA-C8c's ruling. C8c also prints `git diff -U0 origin/main...HEAD -- agent/src/tokensync.ts` as its one header-comment line. After C8-0, no W8 PR's `git diff --name-only` lists `server/test/consolidationCensus.ts` or `server/test/consolidation-census.test.ts`, and none lists a file §Landing order's "Who creates what" gives to another chain. C8c, C8e and C8f carry both reviewers' verdicts. Each behaviour commit lists its before/after rows and cites its OA. C8d and C8e carry their audit tables.

## Rollback

Each task is a revert of its PR, newest first. No stored data changes and no wire frame changes, so any revert leaves the fleet as it was before that PR. The agent-lane reverts (C8a, C8b, C8c, and C8e by (a)) reach the fleet node through the next release, AGENT-FIRST. The behaviour commits revert alone. The ratchet pins revert with the commits that landed them.

## Deviations and decisions

### Unnumbered, defined here

The controller issues each entry's number and replaces its slug in a ledger PR; until then `dtbd.test.ts` is red on this branch by design. A departure found while executing goes in a per-task note under `docs/superpowers/plans/2026-10-26-consolidation-w8-journals-spawn-launchd/`.

- **D-TBD-w8-timer-cadence-reader** — `timer-cadence-reader` (Task C8a; ARCH-69): `ccrc#_timer_period_s` reads a shipped `.timer`'s period from its one cadence line (exactly `OnUnitActiveSec=` or `OnCalendar=`; every other key ignored), in exactly the spellings the shipped files use, and refuses any other spelling, no cadence line or two; the ddns launchd job's `StartInterval` is generated from it, byte-identical on the shipped tree.
  - **Departs from ARCH-69's "launchd plists generated from the `.timer` files":** measured, one launchd job carries a cadence, because `ccrc install` places no timer job on macOS (update design decision 17); the session and server plists carry none. Installing the other timers on macOS is new behaviour and out of scope.
  - **Decides:** the reader lives in `ccd/ccrc` outside the platform layer, so `ccd/ccd` and the byte-identical region are untouched, and is named `_timer_period_s`, not `_svc_*` (`macos-platform.test.ts` refuses a `_svc_`/`_plat_` definition outside the sentinels); the period is computed into a local before the plist heredoc, never inline; a new failure arm (the timer unreadable) is a behaviour commit under OA-C8c that lands before the move.
- **D-TBD-w8-doctor-reads-units** — `doctor-reads-units` (Task C8b; ARCH-69): every doctor bound and sentence derived from a timer's cadence is computed from the shipped unit file as k × period (`_dr_cycles_s`); verdicts unchanged on the shipped units; the codex constant-to-timer pin becomes a derived-bound row.
  - **Departs from spec §5.11's "14 → 0":** the measured base is this plan's census query (12 candidate sites in 6 checks at `ccba6f9b6`), and Step 0's answer governs.
  - **Decides:** the doctor reads the shipped tree's unit (`$BOX_TREE_DIR/deploy/systemd/`), never the installed copy, for cadence: one source on both platforms. Nothing is read at source time: the codex bounds are computed inside `_dr_codex_usage`, and `_dr_timer_period_s` carries the table's loaded guard, so a table sourced without `ccrc` FAILs naming the bug as today. The codex direct bound keeps a named bridge constant (`BRIDGE_FRESH_S`, not a cadence). The scope-sweep default is derived only if its history shows it came from the timer; otherwise it is a call-bound setting, kept and reported.
- **D-TBD-w8-spawn-kernel** — `spawn-kernel` (Task C8c; ARCH-73): `shared/spawn.mjs#boundedSpawn` is the one bounded update spawner; `update/spawn.ts` and the agent's `makeUpdateSpawn` are thin wrappers; `update-spawn-twin-bodies.test.ts` is removed and its D-4390 row kept in `spawn-kernel.test.ts`.
  - **Departs from spec K17's "one `shared/spawn.mjs` that both packages import" as a plain import:** the `.mjs` carve-out allows no `node:child_process` or `node:os`, so `spawn` and the signal table are injected by each package's L3 wrapper; the carve-out is not widened. Nor may the `.mjs` import `shared/agent-protocol.ts`, so the drain deadline and the bound arrive as options (`drainMs`, `timeoutMs`) each wrapper passes from `agent-protocol`; the kernel defines neither.
  - **Decides:** D-4390's rows are re-pointed, not carried unchanged (they asserted the agent's sentinel pair and read its region), in their own named commit; `agent/src/tokensync.ts` gets one header-comment edit so it cites the pin's new file.
- **D-TBD-w8-localcaps-audit** — `localcaps-audit` (Task C8d; ARCH-73): `localcaps.ts` is audited against `exec.ts` and `boundedSpawn`, and folded only if no difference is observable; every process spawner in `server/src`, `agent/src` and `shared/` has a row and a reason in `PROCESS_SPAWNERS`, a set that may only shrink.
- **D-TBD-w8-account-op-audit** — `account-op-audit` (Task C8e; ARCH-73): `accounts/ops.ts` is kept against `exec.ts`; its twin `agent/src/accountop.ts#makeAccountOpSpawn` is folded, pinned or recorded as OA-C8a rules.
  - **Departs from spec K17's list:** the twin was not in the spec's inventory; its one divergent arm (the non-`ESRCH` kill fallback) is named and ruled, never folded silently.
- **D-TBD-w8-journal-floor** — `journal-floor` (Task C8f; ARCH-73): `journalKernel.ts` holds `maxJournalEpoch` (the two byte-twin epoch readers), `journalFloor` (MAX(file, db)) and `appendThenApply` (journal first, row second, inside the caller's `tx()`, the original error rethrown and the phase exposed); each caller keeps its error mapping.
  - **Decides:** `LedgerLog.maxAllocated` stays its own reader (per project, with a salvage arm); its `null` on an existing file with no number is reported (OA-C8b), not changed. `setCollectLane` moves onto `appendThenApply` only if its phase answer runs unchanged; otherwise it is kept and reported by name. The kernel is a K file at the top of `server/src`, mapped in the 08-10 spec's ring-context table.
- **D-TBD-w8-journal-frame** — `journal-frame` (Task C8g; ARCH-73): `splitJournalRecords` is the one NDJSON framer of the lifecycle mirror and the collect-lane journal; each keeps its blank-line and tail policy.
  - **Departs from spec K17's "share one cursor, gap and generation helper":** measured, only framing is shared. The cursor is the mirror's alone; its gaps (`shrank`, `rotated-away`, unorderable) and the collect-lane `mismatch` are different facts; its generation is a rotation file name and the collect-lane's a strictly rising integer. Legitimately different: a projection read incrementally with recorded gaps vs a proof file read whole and refused when torn.

## Out of scope

Installing timer jobs on macOS; the session and server plists' bytes; `ccd/ccd` and its platform layer (`_launchd_class` into the platform block is ARCH-74, K18); the server's `LANE_SCHEDULE` (ARCH-68, W1b); `exec.ts`'s `Runner` and `CcdArgv` (C2); `agent/src/tokensync.ts`'s body (D-4390); the delegation journal; any change to a journal's file format, path or leniency; `LedgerLog.maxAllocated`'s empty-file answer; any `pwa/` file.

## Review log

**rev 0 (2026-10-26).** Written from the spec's rev 2.2 and measured on `origin/main` `ccba6f9b6`, after the operator's ruling of 2026-10-26 put W3, W7 and W8 ahead of coordinator-first round 2 and the unstarted feature programmes. Re-measured against the spec: #740 has merged; CB W2/W3 are paused and name no edit to the update spawners; one launchd job carries a cadence; the doctor's restated cadences are 12 candidate sites by a defined query; `shared/spawn.mjs` needs injected host functions; an account-op twin exists; the two journals share framing only. OA-C8b lists each.

**rev 1 (2026-10-26).** The review's seven findings, each re-measured on `origin/main` `ce7b94dab` and applied:
1. *(high)* C8a's reader was `_svc_timer_period_s` below the END sentinel, which `macos-platform.test.ts` ("holds every _plat_/_svc_ definition INSIDE the sentinels") refuses (the `_svc_gate` → `_class_gate` precedent). Renamed `_timer_period_s` throughout: C8a, C8b's `_dr_timer_period_s`, `launchdCadenceLiterals()`, the mutation table (a new row for the old name) and D-TBD-w8-timer-cadence-reader. Global constraints now forbid a `_svc_`/`_plat_` name outside the layer.
2. *(high)* C8c's D-4390 rows could not move unchanged: they assert `agent/src/server.ts` "still carries exactly one pair" and read `region(agent/src/server.ts)`. They are re-pointed in their own named commit (0 sentinels in tokensync.ts, server.ts, update/spawn.ts and the `.mjs`; "the twins pipe no stdin" reads `shared/spawn.mjs`; the tokensync assertions byte-equal), and `tokensync.ts`'s header gets a one-line comment edit to cite `spawn-kernel.test.ts`. The move and pin commits are ordered so each transient red is on the named pin only and fixed by the next commit.
3. *(high)* The moved body reads `UPDATE_SPAWN_DRAIN_MS` from `shared/agent-protocol.ts`, which a `.mjs` cannot import. `boundedSpawn` takes `drainMs` (and `timeoutMs`) as required options; each wrapper passes the protocol constant; `spawn-kernel.test.ts` asserts both do, and `spawnKernelWireLiterals()` pins that the `.mjs` defines no drain or bound.
4. *(high)* `kernel-tail.test.ts` and `spawners.data.ts` were created in one task and modified in tasks that could land first, and six tasks across three parallel chains appended to `consolidationCensus.ts`'s tail. Now: a C8-0 precursor lands three empty per-chain census modules (`server/test/census-w8/`) and their re-exports in one tail hunk; each chain owns its census module, its census test file and its own area file (`kernel-tail-cadence`, `-spawn`, `-journal`); C8d lands strictly before C8e. §Landing order's "Who creates what" table is the rule.
5. *(medium)* The move commits had an unruled failure arm (an empty `<integer></integer>`; an empty operand in `$(( ))` or `-gt`). OA-C8c now gates C8a's and C8b's move commits too, and each lands its failure arm, red-first, before its moves. `_exp_ddns_units` computes the period into a local before the heredoc and refuses before writing; the census accepts only `<integer>$period</integer>` from that local.
6. *(medium)* `_DR_CODEX_USAGE_STALE_S` and `_DR_CODEX_USAGE_STALE_DIRECT_S` are top-level and would have read files at source time in rows that source the table without `ccrc`. Both bounds are computed lazily inside `_dr_codex_usage` after its existing guards; `_dr_timer_period_s` carries the loaded-guard pattern (`declare -F` and `${BOX_TREE_DIR:-}`, FAIL "this is a bug in ccrc"); Step 0 lists every test that sources `CHECKS_SRC` without `CCRC_SRC`; `doctorSourceTimeCalls()` pins that nothing new runs at source time.
7. *(medium)* The cadence line was underspecified and "the 14 shipped files" was hard-coded. A cadence line is exactly `OnUnitActiveSec=` or `OnCalendar=`; every other key is ignored and Step 0 lists them; `timerSpellings()` collects only those two keys over whatever the directory holds; Step 2 gains rows for `OnBootSec`/`OnActiveSec`/`AccuracySec`/`Persistent` beside a period, CB1d's `30min` plus `RandomizedDelaySec=5min`, the shipped `60min`, and the two-key and one-of-each refusals.
