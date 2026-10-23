# Fleet disk retention: live scratch, orphan worktrees, loose temp entries and a disk alarm — Implementation Plan

> **For agentic workers:** nineteen PRs, Tasks DR-1 to DR-19, one task per PR. REQUIRED SUB-SKILL: superpowers:subagent-driven-development, with superpowers:test-driven-development for every red-first step. Routing is per task (**Routing** line). Band 1 is mechanical and may go to `handoff-run`; band 2 is spec-able and may go to `handoff-run` when the weekly pace says so, with the orchestrator reviewing the diff; band 3 is written and reviewed natively and never handed off. Hand off only tasks whose change is literal: workers have stalled on deep `ccd/ccd` edits. Workers do not edit §Deviations and decisions.

**Spec:** `docs/superpowers/specs/2026-10-23-fleet-disk-retention-design.md` (rev 0), implementing the operator's rulings of 2026-10-23 on #1119.

**Issue:** #1119.

**Base:** `origin/main` `a68c90f15`. Anchors are `≈:` hints into that commit and each names its function. Re-ground every anchor in Step 0, because #1132 and #1114 move `ccd/ccd`.

**Deploy class.** Waves 1 and 2's server and PWA tasks are SERVER. Agent tasks (DR-2, DR-12's node-file half, DR-14, DR-18) are AGENT and deploy first. ccd tasks (DR-6, DR-7 to DR-10, DR-13, DR-16, DR-17) are FLEET, deployed agent lane first like any `ccd` change. No task restarts a session, and each takes effect at the next ordinary release. No destructive arm is armed by any task.

## Gates

Open PRs measured at `a68c90f15` (`gh pr list --state open --json number,files`):

| PR | Holds | Tasks it gates |
|---|---|---|
| #1132 (path identity W3) | `ccd/ccd`, `CLAUDE.md`, `child-reclamation-contract.md` | **DR-7, DR-13, DR-16, DR-17 land after it** (they reuse `_ws_cwd_users`, `_ws_path_ident` and the `-ef` main-checkout rule, and edit the probe and collect regions). DR-15 and DR-19 rebase past its `CLAUDE.md` and contract edits. |
| #1114 (manual pin) | `ccd/ccd` | every ccd task rebases and runs `ccrc restamp` if it is still open |
| #1164 (update banner) | `pwa/src/fleet/BannerStack.tsx` | DR-5 rebases past it |
| #1162 (delegation) | `server/src/watch.ts` | DR-3, DR-4, DR-12, DR-15, DR-19 rebase past it |
| #1149 (release) | `shared/api.ts`, `CLAUDE.md` | DR-3, DR-12, DR-17 rebase past it |
| #1154 (history W2-2b) | `shared/lifecycle.ts` | DR-8, DR-10, DR-15, DR-19 rebase past it |

Consolidation: none of these tasks waits for W1b or W4. Each new tick follows today's `last*` clock pattern and each new marker joins `shared/switches.ts`, so W1b's schedule table and W4's `decideRetire` fold them as rows.

## Global constraints

- **Public repo.** Fixtures use neutral names (`project-a`, `lane-a`). Never write a host, a mount path of a deployment, an account or lane name, another project's name, an absolute home path or a private tracker id.
- **SAFETY.** FIXTURE HOMEs only (`makeCcdHarness`, `server/test/ccdWsHelpers.ts`). No test runs a verb against a live `$HOME`. Nobody runs `ws-collect`, `ws-orphan`, `ws-gc --prune` or the tmp sweep's live arm against a live box. Nobody touches tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*` out of band. Nobody creates an arming marker on a live box.
- **Account switching is never blocked.** No task's code runs on the swap path.
- **Shadow first.** Every destructive arm ships shadowed behind a marker with no writer in the tree. `single-definition.test.ts`'s no-writer pin covers each new marker.
- **Wire: additive only.** No `FLEET_PROTO` bump, no coord.db migration. Every new field has one reader.
- **`ccd/ccd` edits:** run `ccrc restamp` after any rebase, never stamp by hand. Run `bash -n ccd/ccd`.
- **Tests:** `./node_modules/.bin/vitest run <file> --maxWorkers=2`, one suite at a time, in the foreground, from the package directory. Re-run a known load flake alone before calling it a break. The new `/proc`-walking suites (DR-7, DR-8, DR-13, DR-16, DR-17) join CLAUDE.md's load-flake bullet if they show the walk's timeout shape.
- **Commits:** a characterization commit (green on the old code) before any behaviour commit that moves existing behaviour.

## Review focus

1. **No deletion the rules do not license.** Each arm acts only on its rule, re-asked nearest the act, and only once armed.
2. **One owner per class.** The live and test-run arms are `ccd-tmp-sweep`'s; the loose arm is `ws-collect`'s; the orphan lane reuses `ws-gc`'s rules. Flag any second probe, collector, mailer or notifier.
3. **Floors are box-measured.** No server argument lowers an age.
4. **Fail toward keeping.** Every unmeasured, truncated or ambiguous answer keeps the candidate and names why.

## Tasks

Waves: **1** DR-1 to DR-6 (see it), **2** DR-7 to DR-12 (live scratch), **3** DR-13 to DR-15 (loose `~/.cc-tmp`), **4** DR-16 to DR-19 (orphan worktrees).

| Task | Band | Lane | Depends on |
|---|---|---|---|
| DR-1 disk vocabulary and decider | 2 | SERVER (shared) | none |
| DR-2 agent `disk` op | 2 | AGENT | DR-1 |
| DR-3 health `disk` block | 2 | SERVER | DR-1, DR-2 |
| DR-4 disk notice | 2 | SERVER | DR-3 |
| DR-5 disk banner | 2 | PWA | DR-3 |
| DR-6 doctor measures the work filesystems | 2 | FLEET | DR-1 |
| DR-7 one holder probe: mappings, many paths, `ccd path-users` | 3 | FLEET | #1132 |
| DR-8 tmp-sweep live arm (shadow) and census | 3 | FLEET | DR-7 |
| DR-9 tmp-sweep output cap | 3 | FLEET | DR-8 |
| DR-10 tmp-sweep test-run arm | 3 | FLEET | DR-8 |
| DR-11 vitest's `tmpDir` in the run's signal arm | 1 | SERVER (tests) | none |
| DR-12 census read, receipts mail, budget notice | 2 | AGENT + SERVER | DR-3, DR-8 |
| DR-13 ccd loose collect | 3 | FLEET | DR-7, #1132 |
| DR-14 loose collect grants | 1 | AGENT + SERVER | DR-13 |
| DR-15 collect lane loose arm (shadow) | 3 | SERVER | DR-14 |
| DR-16 ccd orphan census and audit | 3 | FLEET | DR-7, #1132 |
| DR-17 ccd `ws-orphan` verb | 3 | FLEET | DR-16 |
| DR-18 orphan grants | 1 | AGENT + SERVER | DR-17 |
| DR-19 orphan-tree lane (shadow) | 3 | SERVER | DR-18 |

### Task DR-1: one disk vocabulary and its decider (D-TBD-disk-vocabulary; spec §2.5)

**Routing:** band 2. **Lane:** SERVER (`shared/` and server L1).

**Files:**
- Create `shared/disk.ts` (L0, imports nothing): `DISK_WORK_ROOTS` (label → template rows: `home`, `projects`, `worktrees`, `cc-tmp`, `claude-tmp`, `config-dirs`, `ccrc`, `registry`); `DISK_WARN_PCT = 85`, `DISK_CRITICAL_PCT = 92`, `DISK_CLEAR_MARGIN_PCT = 2`; `DISK_PRESSURE_AGES` (the spec §2.5.3 table as rows `{sweep, normalS, pressureS}`); types `DiskLevel = 'ok'|'warn'|'critical'|'unmeasured'`, `DiskFilesystem`, `DiskHealth`; `readDiskHealth(x: unknown): DiskHealth | null`.
- Create `server/src/disk.ts` (L1, pure): `diskLevelOf(fs)` (the larger of bytes-used and inodes-used percent), `diskVerdict(prev, measured, nowMs)` (hysteresis: a held level clears only `DISK_CLEAR_MARGIN_PCT` below its threshold; a change needs two consecutive measurements; a missing expected mount is `critical`; nothing measured is `unmeasured`).
- Modify `server/test/rings/shared-imports.test.ts` (the L0 import ring gains `shared/disk.ts`).
- Create `server/test/disk-verdict.test.ts`.

- [ ] **Step 0: Re-ground.** Read `readArchivedHeld` (`shared/api.ts` ≈:4199) as the reader's template, and CLAUDE.md's ring rules for `shared/*.ts`.
- [ ] **Step 1: Red.** "84.9% is ok, 85.0% warn, 92.0% critical"; "inodes at 93% with bytes at 40% is critical"; "critical at 91% stays critical, at 89.9% falls to warn"; "one measurement at critical after ok does not change the level; two do"; "a missing expected mount is critical"; "no filesystems is unmeasured, never ok"; "`readDiskHealth` answers null for absent, a string, a block missing `level`, and a filesystem with a negative size"; "every `DISK_PRESSURE_AGES` row has `pressureS ≤ normalS`, and the loose floor's `pressureS ≥ 86400`".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Expected red |
  |---|---|
  | `>` for `>=` at 85 | "85.0% warn" |
  | inodes ignored | "inodes at 93% … critical" |
  | hysteresis removed | "at 91% stays critical" |
  | debounce removed | "one measurement … does not change" |
  | empty measured read as `ok` | "never ok" |
  | loose pressure floor set to 43200 | "`pressureS ≥ 86400`" |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/disk-verdict.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/rings/shared-imports.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts --maxWorkers=2

### Task DR-2: the agent's `disk` op (D-TBD-agent-disk-op; spec §2.5)

**Routing:** band 2. **Lane:** AGENT.

**Files:**
- Modify `shared/agent-protocol.ts`: `DISK_OP = 'disk'`, the request (no fields) and reply types.
- Modify `agent/src/server.ts`: advertise `DISK_OP` in `ready.ops` (≈:1312-1319); `validateReq` (≈:864) accepts it with no fields; the switch (≈:528) dispatches it.
- Create `agent/src/disk.ts`: resolve `DISK_WORK_ROOTS` against HOME and the roster config dirs; `fs.promises.statfs` each under a 5 s deadline; `fs.promises.stat` for `dev`; parse `/proc/self/mountinfo` for each dev's mount point and type (a seam for tests); read `CCRC_WORK_MOUNTS` (space-separated) and answer each `mounted` by mountinfo; a root that is missing or times out goes to `missing` with its reason.
- Modify `deploy/ccrc-agent.env.example`: a commented `CCRC_WORK_MOUNTS=` line with neutral text.
- Create `agent/test/disk-op.test.ts`.

- [ ] **Step 0: Re-ground.** Read the `token-sync` op end to end as the template, and `statfsWithDeadline` (`ccd/history/sweep.mjs` ≈:128).
- [ ] **Step 1: Red.** "the op is in `ready.ops`"; "a request with any field is a bad request"; "two roots on one dev are one filesystem with both labels"; "a statfs that never answers lands in `missing` within the deadline"; "a missing root lands in `missing`, not as zero"; "`CCRC_WORK_MOUNTS` names a path that is not a mount point: `mounted: false`"; "no path from the request is ever statted" (the op takes none).
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.** Rows for: grouping by path instead of dev; the deadline removed; a missing root answered as zero; `mounted` read from `existsSync`.
- [ ] **Step 4: Verify.**

      cd agent && ./node_modules/.bin/vitest run test/disk-op.test.ts --maxWorkers=2
      cd agent && ./node_modules/.bin/vitest run --maxWorkers=2

### Task DR-3: the `disk` block in `/api/fleet/health` (D-TBD-health-disk-block; spec §2.5)

**Routing:** band 2. **Lane:** SERVER.

**Files:**
- Modify `server/src/io.ts` (`FleetIO` ≈:125): `statfsMeasured(): Promise<DiskMeasure | ReadFailure>`; the local adapter measures `DISK_WORK_ROOTS` with node's statfs; the remote adapter sends `DISK_OP` and maps an op missing from `ready.ops` to unmeasured (`readReadyOps`, `server/src/remote/client.ts` ≈:98).
- Modify `server/src/watch.ts`: `sweepDisk` every 60 s (`lastDiskSweep`), holding the verdict through `diskVerdict`; an accessor `disk()`.
- Modify `shared/api.ts` (`FleetHealth` ≈:3562): optional `disk?: DiskHealth`.
- Modify `server/src/server.ts` (the route ≈:1242-1303): spread `disk` only when present.
- Modify `server/test/fleet-health.test.ts`; create `server/test/disk-sweep.test.ts`.

- [ ] **Step 0: Re-ground.** Read how `archivedHeld` reaches the route (`watch.ts` ≈:2169, `server.ts` ≈:1256).
- [ ] **Step 1: Red.** "the block is absent before the first sweep"; "an older agent (no `disk` in ops) gives `level: 'unmeasured'`"; "a transport failure keeps the last verdict's level but marks the block unmeasured, never ok"; "remote and local adapters answer the same shape for the same fixture"; "`holders` is empty until DR-12 fills it".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.** Rows for: the block spread as `null`; an older agent read as ok; the sweep never run.
- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/fleet-health.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/disk-sweep.test.ts --maxWorkers=2

### Task DR-4: the disk notice (D-TBD-disk-alarm-notice; spec §2.5)

**Routing:** band 2. **Lane:** SERVER.

**Files:**
- Modify `server/src/disk.ts` (L1): `diskNotice(prev, next)` → `{mode: 'push'|'record-only', title, body, dedupeKey} | null`.
- Modify `server/src/watch.ts` (`sweepDisk`): send it through `notify` (`server/src/notice.ts`), `kind: 'coord'`, `sessionId: ''`.
- Create `server/test/disk-notice.test.ts`.

- [ ] **Step 0: Re-ground.** Read `notify`'s modes and `dedupeKey` (`notice.ts`), and the release push's mark-then-push (`watch.ts` ≈:2039-2086).
- [ ] **Step 1: Red.** "ok → warn pushes once"; "warn → critical pushes again"; "critical → warn → critical in one episode pushes once at each new level"; "a clear to ok is record-only"; "a restart with the same episode re-sends nothing" (the key read before the write); "the title names the percentage and free bytes; the body names the filesystem's labels, never an absolute path".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.** Rows for: no dedupe key; clear pushed; episode never reset.
- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/disk-notice.test.ts --maxWorkers=2

### Task DR-5: the disk banner (D-TBD-disk-banner; spec §2.5)

**Routing:** band 2 (the orchestrator checks it at every width and skin before it lands). **Lane:** PWA.

**Files:**
- Create `pwa/src/fleet/DiskBanner.tsx` and `pwa/src/fleet/diskWords.ts` (L1): `diskBannerShows(health)`, the one line from the server's level and figures.
- Modify `pwa/src/fleet/BannerStack.tsx`: `BannerId` gains `disk`, ranked after `fleet-host` in `BANNER_ORDER`.
- Modify `pwa/src/screens/FleetScreen.tsx` (≈:393): build the item from `useFleetHealth`.
- Create `pwa/test/disk-banner.test.tsx`.

- [ ] **Step 1: Red.** "hidden at ok and unmeasured"; "shown at warn and critical"; "the line names percent and free space, and 'sweeps in pressure mode' only when `pressure`"; "rank after fleet-host"; "renders at 360, 390, 1280 and 1920 wide × refined and instrument × dark and light with no overflow".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.** Rows for: shown at unmeasured; rank dropped; pressure text always on.
- [ ] **Step 4: Verify.** The per-width table in the PR body:

  | Width | Refined | Instrument |
  |---|---|---|
  | 360 | one line, wraps to two at most | as refined |
  | 390 | one line | one line |
  | 1280 | one line | one line |
  | 1920 | one line | one line |

      cd pwa && ./node_modules/.bin/vitest run test/disk-banner.test.tsx --maxWorkers=2
      cd pwa && ./node_modules/.bin/vitest run --maxWorkers=2

### Task DR-6: doctor measures every work filesystem (D-TBD-doctor-disk-work-fs; spec §2.5.2)

**Routing:** band 2. **Lane:** FLEET (`ccd/ccrc-doctor-checks`).

**Files:**
- Modify `ccd/ccrc-doctor-checks` (`_check_disk` ≈:2279-2343): resolve the roots (its bash twin of `DISK_WORK_ROOTS`; config dirs from `~/.ccrc/accounts.sh`'s `_ccrc_cfg_dir`), group by `df -P` mount point, one line per filesystem from `df -Pk` and `df -Pi`; FAIL at ≥ 92% bytes or inodes or < 2 GiB, WARN at ≥ 85% or < 10 GiB.
- Create `server/test/disk-twins.test.ts`: reads the bash constants in `ccd/ccrc-doctor-checks` (and, after DR-8 and DR-13, `ccd/ccd-tmp-sweep` and `ccd/ccd`) and requires them equal to L0's.
- Modify `server/test/ccrc-doctor.test.ts`.

- [ ] **Step 1: Characterize** (green on main): today's three verdicts on `$HOME`.
- [ ] **Step 2: Red.** "two roots on one filesystem print one line naming both"; "a work root on a second filesystem at 93% is FAIL even when `$HOME` is at 10%"; "inodes at 90% are WARN"; "an unreadable `df` line is WARN, never PASS"; "the bash thresholds equal L0's".
- [ ] **Step 3: Green.**
- [ ] **Step 4: Mutation table, RUN.** Rows for: `$HOME` only; inodes ignored; a twin constant edited.
- [ ] **Step 5: Verify.**

      cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/disk-twins.test.ts --maxWorkers=2

### Task DR-7: one holder probe — file mappings, many paths, `ccd path-users` (D-TBD-path-users-maps-many; spec §2.6.1) — GATED: after #1132

**Routing:** band 3 (every destructive verb asks this probe). **Lane:** FLEET.

**Files:**
- Modify `ccd/ccd` (`_ws_path_users` ≈:32753-33024): the python walk also reads `/proc/<pid>/map_files/` link targets, and falls back to `/proc/<pid>/maps`' path column when `map_files` cannot be listed; it accepts a list of paths and answers each in one walk (`_ws_path_users_many`); `_ws_path_users` becomes its one-path caller. Bound unchanged (`WS_PATH_USERS_SCAN_S`).
- Modify `ccd/ccd`: a read-only entry `path-users [--json] <path>…` (no lock, no write), caps `path-users-v1` (≈:8868).
- Modify `ccd/contexts.tsv` for the new functions.
- Create `server/test/ccd-path-users-many.test.ts`; modify the probe's existing suites only where a fixture's process table must now list `maps`.

- [ ] **Step 0: Re-ground** on post-#1132 `main`. List every caller of `_ws_path_users` and confirm none treats "more holders" as permission.
- [ ] **Step 1: Characterize** (green on main): one path, a cwd, an fd, a `TMPDIR` holder, and nobody, through the fake process table seam (`_ws_path_users_proc_root`).
- [ ] **Step 2: Red.** "a process that only maps a file under the path holds it"; "`maps` is read when `map_files` cannot be listed"; "three paths, one walk: each verdict is its own" (counted by the seam); "`ccd path-users --json` prints one row per path with pids and why"; "the walk past its bound answers unmeasured for every path"; "the entry writes nothing under `$REG`".
- [ ] **Step 3: Green.** Run `ccrc restamp`.
- [ ] **Step 4: Mutation table, RUN.** Rows for: mappings dropped; the fallback dropped; one path's holder leaking to another; unmeasured answered as nobody.
- [ ] **Step 5: Verify.**

      bash -n ccd/ccd
      cd server && ./node_modules/.bin/vitest run test/ccd-path-users-many.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccd-ws-collect-reprove.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccd-contexts.test.ts --maxWorkers=2

### Task DR-8: the tmp sweep's live arm, in shadow, and its census (D-TBD-tmp-sweep-live-arm; spec §2.1, §2.5.1)

**Routing:** band 3. **Lane:** FLEET (`ccd/ccd-tmp-sweep`).

**Files:**
- Modify `ccd/ccd-tmp-sweep`:
  - roots: the existing one, `/tmp/claude-<uid>` when it differs, and each witnessed child leaf's `claude-<uid>` when present (validated: a directory owned by this uid whose physical path is where it should be);
  - after today's pass, under the same lock: the live arm over units classified live; candidates are the direct children of `scratchpad/` and `tasks/`; the uuid → id map from `$REG/*.uuid`; the untouched rule (mtime, ctime, regular-file atime unless `noatime`); holders through `ccd path-users --json`; quarantine at `<root>/.ccd-tmp-quarantine/<uuid>/<ns>.<name>` and deletion a pass ≥ 24 h later after a fresh holder ask;
  - `_ts_pressure` (statfs twin of L0) and the pressure ages;
  - shadow unless `~/.ccrc/tmp-sweep-live-arm` exists;
  - the census `~/.ccrc/tmp-sweep.json`, written to a temp file and renamed;
  - the summary line gains the live arm's counts.
- Modify `shared/lifecycle.ts`: `claude-tmp-session-dirs`' collector and bound; a new `tmp-sweep-census` row.
- Modify `server/test/tmp-sweep.test.ts` (characterization) and create `server/test/tmp-sweep-live.test.ts`; extend `server/test/disk-twins.test.ts` and `server/test/lifecycle.test.ts`.
- Modify `README.md` (the tmp sweep's section).

- [ ] **Step 0: Measure, read-only.** On a fixture, then from the fleet's own read-only evidence that the operator or a doctor line already reports: where Claude Code's scratch sits for a child with `TMPDIR` set (spec §1.3). Record the answer in §Decisions. No command is run on a live box by this task.
- [ ] **Step 1: Characterize** (green on main): today's whole `tmp-sweep.test.ts`, untouched.
- [ ] **Step 2: Red.**
  - "a live unit's `scratchpad/<old>` is listed as would-move in shadow and stays";
  - "armed, it moves to the quarantine; a pass 24 h later deletes it";
  - "a quarantined entry held at the second pass stays";
  - "a file 1 day old deep under an old directory keeps the directory";
  - "a regular file read 2 days ago (atime) keeps it; on a `noatime` fixture atime is not read and the census says so";
  - "an entry held by a mapping keeps it" (through `ccd path-users`);
  - "`scratchpad/` itself, `tasks/` itself and the unit are never candidates";
  - "a live unit whose uuid no row holds is `live-unmapped`, untouched";
  - "`ccd path-users` failing keeps every candidate";
  - "the census has `seq` rising across passes and keeps 1,000 rows";
  - "under a fake `df` at 93%, the ages are the pressure ages";
  - "the pause file stops the live arm as it stops today's".
- [ ] **Step 3: Green.**
- [ ] **Step 4: Mutation table, RUN.** Rows for: mtime-only rule; top-level-only walk; atime on directories; deleting without quarantine; grace removed; shadow marker ignored; unmapped units swept; pressure applied without the measurement.
- [ ] **Step 5: Verify.**

      cd server && ./node_modules/.bin/vitest run test/tmp-sweep.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/tmp-sweep-live.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/disk-twins.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/macos-platform.test.ts --maxWorkers=2

### Task DR-9: the tmp sweep caps finished task output (D-TBD-tmp-sweep-output-cap; spec §2.1, #1119 item 1)

**Routing:** band 3 (it rewrites a live session's file). **Lane:** FLEET.

**Files:**
- Modify `ccd/ccd-tmp-sweep`: on the live arm, a `tasks/*.output` regular file over 1 GiB, unheld, mtime older than 1 h, is rewritten as its first 64 MiB, one marker line (`[ccd-tmp-sweep: <n> bytes cut at <ts>]`) and its last 64 MiB, written to a temp file in the same directory and renamed over; census kind `output-capped`.
- Create `server/test/tmp-sweep-output-cap.test.ts` (sparse fixture files, scaled thresholds through test-only knobs that can only raise the cap).

- [ ] **Step 1: Red.** "a 1.5 GiB finished output becomes head + marker + tail"; "a held output is untouched"; "an output written 10 minutes ago is untouched"; "a 900 MiB output is untouched"; "shadow lists it and changes nothing"; "a failed rename leaves the original byte-identical".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.** Rows for: truncate in place; the holder ask dropped; the quiet hour dropped.
- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/tmp-sweep-output-cap.test.ts --maxWorkers=2

### Task DR-10: the tmp sweep collects dead test-run roots (D-TBD-tmp-sweep-test-runs; spec §2.2)

**Routing:** band 3. **Lane:** FLEET.

**Files:**
- Modify `ccd/ccd-tmp-sweep`: the test-run arm over the box's `TMPDIR` and each witnessed live child leaf: entries matching `^ccrc-testrun-[A-Za-z0-9]{6}(\.dead)?$`, `live.sock` not bound in `/proc/net/unix` (a seam for tests), newest ctime older than 6 h (1 h under pressure), unheld; rename to `.dead`, then `rm -rf --one-file-system`; the live arm's switch and shadow rows.
- Modify `shared/lifecycle.ts` (`server-test-run-dirs`' collector).
- Create `server/test/tmp-sweep-test-runs.test.ts`.

- [ ] **Step 0: Re-ground.** Read `run-tmp.globalsetup.mjs`' liveness (D-4499) and `condemn`.
- [ ] **Step 1: Red.** "a dead run root 7 h quiet goes"; "a run whose socket listens stays"; "5 h quiet stays"; "a held one stays"; "a name that only looks close (`ccrc-testrun-abc`, `ccrc-testrun-abcdefg`) is untouched"; "a leaf with no row is not this arm's".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.** Rows for: unanchored name match; the socket check dropped; mtime for ctime.
- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/tmp-sweep-test-runs.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts --maxWorkers=2

### Task DR-11: vitest's own `tmpDir` joins the run's signal arm (D-TBD-vitest-tmpdir-arm; spec §2.2)

**Routing:** band 1 (the 2026-10-08 plan's dropped Task 5, written there in full). **Lane:** SERVER (tests only).

**Files:**
- Modify `server/test/run-tmp.globalsetup.mjs` (`setup(project)` ≈:331-367, `armSignals` ≈:247-259): pass `project.tmpDir` to the arm, which removes it (lstat; a directory owned by this uid) on a signal. Update the "WHAT THIS DOES NOT DO" header (≈:59-61).
- Modify `server/test/run-tmp.test.ts`: T5a and T5d assert an empty base after a signal.

- [ ] **Step 1: Red.** T5a and T5d with a `tmpDir` planted.
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.** Rows for: the tmpDir not passed; a symbolic link at the tmpDir followed.
- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/run-tmp.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccrc-uninstall.test.ts -t 'numeric-PID' --maxWorkers=2

### Task DR-12: the census is read, sessions are told, and the budget notice (D-TBD-tmp-sweep-mail-budget; spec §2.1)

**Routing:** band 2. **Lane:** AGENT + SERVER (the `NODE_FILES` key is the agent's admission set: deploy the agent first).

**Files:**
- Modify `shared/agent-protocol.ts` (`NODE_FILES` ≈:170): `tmpSweep: 'tmp-sweep.json'`. The inventory's `MEASURED_FILE_KEYS` leaves it out (it has its own reader).
- Create `server/src/tmpSweep.ts` (L1): `parseTmpSweepCensus` (one reader, `null` for malformed), `tmpSweepReceipts(census, mailed)` (one mail per session per pass, non-shadow rows only), `tmpSweepBudget(census, prevBands)` (band = ⌊bytes / 20 GiB⌋, re-arm below 18 GiB), and the mail words.
- Modify `server/src/watch.ts`: `sweepTmpSweepCensus` every 5 min reads the file through `FleetIO`, queues system mail from `operator` (`queueSystemMail`, `coord/rundefsTx.ts` ≈:61) deduplicated by `hasMailWithSubject`, sends the budget notice to the session and, for a run's worker, its coordinator (`resolveCoordinator`); fills `disk.holders` with the five largest sessions.
- Create `server/test/tmp-sweep-mail.test.ts`; modify `server/test/fleet-health.test.ts`.

- [ ] **Step 1: Red.** "two passes' rows for one session send two mails, a re-read sends none"; "shadow rows send no mail"; "a row whose id has no registry row sends nothing and logs once"; "19 GiB sends nothing, 21 GiB one notice, 41 GiB a second, 17 GiB re-arms"; "the coordinator copy goes only to a worker of an open run"; "a malformed census is unmeasured, and `holders` is empty"; "the body names the quarantine path and the time to move it back".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.** Rows for: no dedupe; shadow mailed; re-arm at 20 GiB (flapping); the coordinator always copied.
- [ ] **Step 4: Verify.**

      cd agent && ./node_modules/.bin/vitest run --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/tmp-sweep-mail.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/fleet-health.test.ts --maxWorkers=2

### Task DR-13: ccd collects loose `~/.cc-tmp` entries (D-TBD-collect-loose-ccd; spec §2.4) — GATED: after #1132

**Routing:** band 3. **Lane:** FLEET.

**Files:**
- Modify `ccd/ccd` (the `COLLECT-BEGIN`/`COLLECT-END` region ≈:35652-37978, `cmd_ws_audit` ≈:13136):
  - `ws-audit --collect-census`: the classes of spec §2.4, bounded at 1,024, names as hex;
  - `ws-audit --loose-hex <hex> --collect`: re-class, lstat type and uid, the idle walk with `max(172800, WS_COLLECT_LOOSE_FLOOR_S)` (24 h under `_disk_pressure`, never lower), `ccd path-users`, the row and checkout questions, pause last; token `mode=collect-loose`;
  - `ws-collect --expect <tok> --loose-hex <hex>`: `$REG/.collect-loose.lock`, recompute, record in `$REG/tmpquarantine-loose/`, move, re-prove, put back on doubt, remove (a file is unlinked); resume from the loose record family;
  - `_disk_pressure <path>` (statfs twin of L0);
  - caps `collect-loose-v1`; the privileged direct-entry check covers both new forms.
- Modify `docs/superpowers/programs/child-reclamation-contract.md`: R38 and R59 name the loose arm.
- Create `server/test/ccd-ws-collect-loose.test.ts`; extend `server/test/disk-twins.test.ts`.

- [ ] **Step 0: Re-ground** on post-#1132 `main`: the collect region, `_ws_collect_prelock`, `_ws_collect_qdir`, `_ws_leaf_remove`, and how resume finds a record.
- [ ] **Step 1: Characterize** (green on main): an unwitnessed leaf answers `not-witnessed` to today's audit and verb.
- [ ] **Step 2: Red.**
  - census: "a witnessed leaf is `witnessed`; a `.child` row's name is `registered`; `.ccd-quarantine` is `quarantine`; a symbolic link and a FIFO are `refused`; a 47 h-old file and a 49 h-old directory are `loose`"; "names `-rf`, `.hidden` and one with a space survive hex both ways";
  - audit: "a 49 h-quiet unheld loose directory mints a token"; "47 h answers `changed-recently`"; "a new file deep inside resets it"; "a holder by mapping answers `in-use`"; "a registry row whose workdir is inside it holds it"; "pause answers `paused`";
  - verb: "the entry is quarantined, re-proved and removed"; "removed and recreated under the same name between audit and verb: `state-changed`"; "a holder appearing after the move puts it back"; "a killed verb resumes from the loose record";
  - "under pressure the floor is 24 h, and never below 86400 s".
- [ ] **Step 3: Green.** Run `ccrc restamp`.
- [ ] **Step 4: Mutation table, RUN.** Rows for: the token without `ino`; mtime for ctime; the floor lowered to 0 under pressure; a link taken; the put-back dropped; raw names in argv.
- [ ] **Step 5: Verify.**

      bash -n ccd/ccd
      cd server && ./node_modules/.bin/vitest run test/ccd-ws-collect-loose.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccd-ws-collect-verb.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/collect-audit-budget.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/disk-twins.test.ts --maxWorkers=2

### Task DR-14: grants for the loose collect (D-TBD-collect-loose-grants; spec §5)

**Routing:** band 1. **Lane:** AGENT + SERVER (agent first).

**Files:**
- Modify `agent/src/whitelist.ts` (`EXEC_WHITELIST.ccd` ≈:423-632): `['ws-audit','--collect-census']`, `['ws-audit','--loose-hex']`. The verb rides `['ws-collect','--expect']`.
- Modify `server/src/ccdargv.ts` (≈:553-562): `wsCollectCensus`, `wsCollectLooseAudit(hex)`, `wsCollectLoose(token, hex, dec)`; `COLLECT_LOOSE_CAP = 'collect-loose-v1'` and its `CCD_CAN` row.
- Modify `server/test/whitelist-subset.test.ts` and the argv suite.

- [ ] **Step 1: Red** in the argv suite and `whitelist-subset`. **Step 2: Green.** **Step 3: Verify.**

      cd agent && ./node_modules/.bin/vitest run --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/whitelist-subset.test.ts --maxWorkers=2

### Task DR-15: the collect lane's loose arm, in shadow (D-TBD-collect-loose-lane; reverses D-5888; spec §2.4)

**Routing:** band 3. **Lane:** SERVER.

**Files:**
- Modify `server/src/collectLane.ts` (`collectPopulation` ≈:418-458, feed words ≈:1422-1488): the census's `loose` names and the loose record family join the population; loose candidates carry their hex; the feed gains "temp entry collected" and "temp entry would be collected".
- Modify `server/src/coord/collectTempRoot.ts` (`collectOpenRunHold` ≈:612-626): rule (e) does not apply to a loose entry; the executor asks the census once per pass and the loose audit and verb per candidate; shadow unless `$REG/collect-loose-live` and the lane is effectively live.
- Modify `shared/switches.ts`: `COLLECT_LOOSE_LIVE_MARKER` and its row (no writer).
- Modify `shared/lifecycle.ts`: the `child-tmp-roots` comment; the new `cc-tmp-loose-entries` row.
- Modify `docs/superpowers/specs/2026-08-11-artifact-lifecycle-policy.md`: a row for loose entries; ruling 4's text points to the loose arm.
- Modify `README.md` (the collector's section, "Before arming it").
- Create `server/test/collect-lane-loose.test.ts`; modify `server/test/lifecycle.test.ts` (the `child-tmp-roots` pin's "must not claim loose entries" comment and a new row pin) and `server/test/single-definition.test.ts` (the marker has no writer).

- [ ] **Step 1: Characterize** (green on main): the lane's population and the open-run hold on a witnessed leaf.
- [ ] **Step 2: Red.** "a loose census name joins the population"; "a truncated census adds no loose name and records why"; "a loose candidate under a live lane without the loose marker is would-collect"; "with both, the second unchanged observation acts"; "rule (e) never holds a loose entry; it still holds a witnessed leaf with no run"; "the lane-off switch stops loose acts too"; "`ccdCan` without `collect-loose-v1` skips loose names".
- [ ] **Step 3: Green.**
- [ ] **Step 4: Mutation table, RUN.** Rows for: loose acts without their marker; rule (e) applied to loose; a single observation licensing; the capability ignored.
- [ ] **Step 5: Verify.**

      cd server && ./node_modules/.bin/vitest run test/collect-lane-loose.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/collect-lane-pass.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/collect-lane-prose.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/switches.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts --maxWorkers=2

### Task DR-16: ccd's orphan census and audit (D-TBD-orphan-census-audit; spec §2.3) — GATED: after #1132

**Routing:** band 3 (it mints the token a destructive verb trusts). **Lane:** FLEET.

**Files:**
- Modify `ccd/ccd` (`_ws_gc_scan` ≈:15581, `_ws_gc_row` ≈:15491, `_ws_gc_prune_row` ≈:15911, `cmd_ws_audit` ≈:13136):
  - `ws-audit --orphans`: the census of spec §2.3, classes `ccd-root`/`claude`/`superpowers`/`other`, plus `not-a-worktree` directories; bounded at 4,096 rows and 60 s;
  - `ws-audit --orphan-hex <hex>`: the fourteen-rung ladder of spec §2.3 as one function, `_ws_orphan_ladder`, that `_ws_gc_prune_row` also calls for its shared rungs (dirty, HEAD, ignored secrets, nested checkouts), so the operator's verb and the lane cannot drift; the token and the rescue token;
  - the idle walk (newest ctime; 30 s, 2,000,000 entries) with 7 days, 3 under `_disk_pressure`.
- Modify `ccd/contexts.tsv`.
- Create `server/test/ccd-orphan-audit.test.ts`; modify `server/test/ccd-ws-gc.test.ts` only where the shared rungs move (characterized first).

- [ ] **Step 0: Re-ground** on post-#1132 `main`: `_ws_cwd_users`, `_ws_path_ident`, the `-ef` refusals, `_ws_reclaim_foreign_clean`'s `--not --remotes` call (≈:30608) and its stderr rule. D-5945's stale-lock helper is not on `main` at `a68c90f15`: rung 7 refuses any `index.lock` until it lands, then calls it.
- [ ] **Step 1: Characterize** (green on main): `ws-gc --prune`'s refusals and its one removal on the existing fixtures.
- [ ] **Step 2: Red.** One case per rung, each red when its rung is deleted: a stanza-less directory; an `other` tree; the main checkout under another spelling; a registry workdir through a link; a locked tree; an untracked file; a rebase in progress; an `index.lock`; a commit on no remote (`head-not-on-remote`, and a rescue token in the document); a secret-shaped ignored file; a nested checkout; a mapping holder; a 6-day ctime; pause. Plus: "a passing tree mints a token, and the same tree twice mints the same one"; "census classes for all three locations and `other`"; "a census past its bound is `truncated`"; "`ws-gc --prune` still refuses and removes exactly as characterized".
- [ ] **Step 3: Green.** Run `ccrc restamp`.
- [ ] **Step 4: Mutation table, RUN.** One row per rung deleted, plus: `--remotes` replaced by `origin/HEAD` ancestry; the rescue token minted for a dirty tree.
- [ ] **Step 5: Verify.**

      bash -n ccd/ccd
      cd server && ./node_modules/.bin/vitest run test/ccd-orphan-audit.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccd-ws-gc.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccd-contexts.test.ts --maxWorkers=2

### Task DR-17: ccd's `ws-orphan` verb (D-TBD-orphan-verb; spec §2.3, §2.6.2)

**Routing:** band 3. **Lane:** FLEET.

**Files:**
- Modify `ccd/ccd`: `cmd_ws_orphan` (the eight steps of spec §2.3), the dispatch line, the privileged direct-entry check (≈:27-29), caps `orphan-v1`; `_lc_intent`/`_lc_done`/`_lc_fail` with verb `ws-orphan`; the rescue pin under `refs/ccrc/attic/orphan/<sha16>/` in `_ws_attic_pin`'s shape.
- Modify `server/src/coord/approvalguard.ts` (`FORBIDDEN_CCD_VERBS` ≈:124): `ws-orphan`.
- Modify `CLAUDE.md` (SAFETY): the `ws-orphan` line of spec §2.6.2.
- Modify `shared/api.ts` if the lifecycle journal's verb vocabulary is closed for `ws-orphan` (Step 0).
- Create `server/test/ccd-ws-orphan-verb.test.ts`; modify the approval-guard suite.

- [ ] **Step 0: Re-ground.** Whether `_lc_*`'s verb field is a closed vocabulary; the attic pin's shape.
- [ ] **Step 1: Red.** "a token from the audit removes a clean `claude` tree, and its branch stays"; "a `ccd-root` tree's branch is deleted with `-d`, and kept (`branch-kept`) when checked out elsewhere"; "a file added between audit and verb answers `state-changed`"; "a holder appearing after the recompute stops the act"; "a contended lock answers `locked-elsewhere`"; "`--rescue` without a rescue token refuses"; "`--rescue` pins HEAD and the reflog shas, then removes; a failed pin removes nothing"; "the argv git receives never contains `--force`" (a shim records it); "the journal has intent then done"; "a session's prompt naming `ccd ws-orphan` is forbidden".
- [ ] **Step 2: Green.** Run `ccrc restamp`.
- [ ] **Step 3: Mutation table, RUN.** Rows for: `--force` added; the recompute skipped; the last holder ask dropped; `-D` for `-d`; the pin after the removal.
- [ ] **Step 4: Verify.**

      bash -n ccd/ccd
      cd server && ./node_modules/.bin/vitest run test/ccd-ws-orphan-verb.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/approvalguard.test.ts --maxWorkers=2

### Task DR-18: grants for the orphan lane (D-TBD-orphan-grants; spec §5)

**Routing:** band 1. **Lane:** AGENT + SERVER (agent first).

**Files:**
- Modify `agent/src/whitelist.ts`: `['ws-audit','--orphans']`, `['ws-audit','--orphan-hex']`, `['ws-orphan','--expect']`; `REQUIRED_VERB_FLAG` gains `'ws-orphan': '--expect'`. `UNGRANTABLE_VERBS` is unchanged.
- Modify `server/src/ccdargv.ts`: `wsOrphanCensus`, `wsOrphanAudit(hex)`, `wsOrphan(token, hex, rescue, dec)`; `ORPHAN_CAP = 'orphan-v1'` and its `CCD_CAN` row.
- Modify `server/test/whitelist-subset.test.ts`, the argv suite, and the `test/types/bypasses/g*` fixture set if a lost flag needs a new one.

- [ ] **Step 1: Red** (a grant without its required flag fails the type and the boot audit). **Step 2: Green.** **Step 3: Verify.**

      cd agent && ./node_modules/.bin/vitest run --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/whitelist-subset.test.ts --maxWorkers=2

### Task DR-19: the orphan-tree lane, in shadow (D-TBD-orphan-lane; resolves policy Open Q6; spec §2.3)

**Routing:** band 3. **Lane:** SERVER.

**Files:**
- Create `server/src/orphanTreeLane.ts` (L1): population from the census, the licence (two unchanged tokens ≥ 1 h apart), pacing (2 audits per pass, 4 under pressure; one act per pass fleet-wide), the outcome key, the feed words.
- Create `server/src/coord/collectOrphanTree.ts` (L3): `ccdCan`, the switches nearest the argv (`reclaim-paused`, `orphan-tree-live`, `orphan-tree-rescue-live`), the audit, the act.
- Modify `server/src/watch.ts`: `sweepOrphanTrees` (`lastOrphanTreeSweep`; census every 6 h, hourly under pressure), on the `KeyedQueue` key; feed rows through `notify(…, 'record-only')`, `kind: 'coord'`; `disk.orphanTrees`.
- Modify `shared/switches.ts`: `ORPHAN_TREE_LIVE_MARKER`, `ORPHAN_TREE_RESCUE_LIVE_MARKER`, their rows (no writer).
- Modify `shared/lifecycle.ts`: `ccd-orphan-worktrees` and `agent-worktrees` rows.
- Modify `docs/superpowers/specs/2026-08-11-artifact-lifecycle-policy.md`: rows 5 and 6 name the lane; Tier C's foreign-worktree line moves to Tier B; Open Question 6 RESOLVED 2026-10-23, option (a).
- Modify `README.md`: an orphan-worktree section beside the collector's.
- Create `server/test/orphan-tree-lane.test.ts`; modify `server/test/lifecycle.test.ts`, `server/test/switches.test.ts`, `server/test/single-definition.test.ts`, `server/test/fleet-health.test.ts`.

- [ ] **Step 0: Re-ground.** Read `collectLane.ts`' licence and pacing and `watch.ts`' `collectPass` (≈:5011) as the template; reuse its `KeyedQueue` key.
- [ ] **Step 1: Red.** "shadow: a passing tree is 'would be removed' and no verb runs"; "armed: the second unchanged audit an hour later acts; a changed token restarts the licence"; "at most one act per pass across every project"; "a `head-not-on-remote` tree is 'left' without the rescue marker, and rescued and removed with it"; "`reclaim-paused` stops audits and acts"; "a box without `orphan-v1` is skipped"; "one feed row per change of outcome, none per repeat"; "`disk.orphanTrees` counts by class and outcome".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.** Rows for: shadow ignored; one observation licensing; two acts per pass; rescue without its marker; the pause ignored; a feed row per pass.
- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/orphan-tree-lane.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/switches.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/fleet-health.test.ts --maxWorkers=2

## Operator acts

None is required to build or land any task. Each of these is the operator's, whenever they choose:

- **Answer spec §9's questions.** Q1 decides whether DR-17's rescue arm is ever armed; the rest confirm defaults.
- **Arm the live arm** (`~/.ccrc/tmp-sweep-live-arm`) after a week of DR-8's shadow rows.
- **Arm the loose arm** (`$REG/collect-loose-live`) after its shadow rows, with the collect lane live.
- **Arm the orphan lane** (`$REG/orphan-tree-live`), then, if Q1 is yes, the rescue arm (`$REG/orphan-tree-rescue-live`).
- **List the work mounts** in the fleet agent's `CCRC_WORK_MOUNTS`, then **retire the box-local disk guard** (its timer and service) once a warn crossing has reached the banner and the push.

## Rollback

- **Server and PWA tasks:** a revert. Every new block is optional; an older PWA ignores it.
- **Agent tasks:** `ccrc rollback`. A server asking an absent op or grant reads unmeasured or skips by capability.
- **ccd and tmp-sweep tasks:** `ccrc rollback`, fleet lane. A quarantine left by a rolled-back tmp sweep is plain directories under `.ccd-tmp-quarantine/`; the older sweep's dead arm collects them with their unit. A loose record left behind is read by no older ccd and harms nothing; its slot sits in `.ccd-quarantine` for the operator.
- **Arms:** removing a marker returns its arm to shadow at the next pass.

## Deviations and decisions

### To be issued for this work

The allocator (`POST /api/ledger/deviations`) is box-token gated and was not reached while planning, so each entry below is `D-TBD-<slug>` until a block is issued. The coordinator allocates one block of nineteen before the first task starts, and replaces each placeholder in one commit before any task PR cites it.

- **D-TBD-disk-vocabulary** (DR-1): `shared/disk.ts` holds the work-root table, 85/92 with a 2-point clear, the pressure-age table and `readDiskHealth`; `diskVerdict` takes the larger of bytes and inodes, needs two measurements to change level, and reads nothing measured as `unmeasured`.
- **D-TBD-agent-disk-op** (DR-2): the agent's `disk` op takes no arguments, statfs's its own table under a 5 s deadline, groups by `st_dev`, and answers `CCRC_WORK_MOUNTS`' mount points.
- **D-TBD-health-disk-block** (DR-3): `FleetHealth.disk`, optional, absent before the first sweep, `unmeasured` with an older agent.
- **D-TBD-disk-alarm-notice** (DR-4): one push per rise to warn or critical per episode, a recorded clear, keyed `disk:<dev>:<level>:<episode>`.
- **D-TBD-disk-banner** (DR-5): banner id `disk`, ranked after `fleet-host`, at warn and critical.
- **D-TBD-doctor-disk-work-fs** (DR-6): `_check_disk` prints one line per work filesystem; its bash thresholds are pinned equal to L0's.
- **D-TBD-path-users-maps-many** (DR-7): `_ws_path_users` counts file mappings and answers many paths in one walk; `ccd path-users` is its read-only entry.
- **D-TBD-tmp-sweep-live-arm** (DR-8): the live arm, its roots, the untouched rule with regular-file atime, the 24 h quarantine, the census and the box-measured pressure ages; shadow until `~/.ccrc/tmp-sweep-live-arm`.
- **D-TBD-tmp-sweep-output-cap** (DR-9): a finished `.output` over 1 GiB keeps 64 MiB at each end with a marker, by rename.
- **D-TBD-tmp-sweep-test-runs** (DR-10): a `ccrc-testrun-*` root with no listener, 6 h ctime-quiet and unheld is removed by the tmp sweep.
- **D-TBD-vitest-tmpdir-arm** (DR-11): the run's signal arm removes vitest's own `tmpDir`.
- **D-TBD-tmp-sweep-mail-budget** (DR-12): the census is a node file; the server mails receipts from the `operator` role and the 20 GiB band notice to the session and a worker's coordinator.
- **D-TBD-collect-loose-ccd** (DR-13): the census, the loose audit with a 48 h floor (24 h under pressure, never below 86400 s), the loose verb with its own lock and record family; R38 and R59 amended.
- **D-TBD-collect-loose-grants** (DR-14): two `ws-audit` grant prefixes and three argv builders.
- **D-TBD-collect-loose-lane** (DR-15): loose names join the collect population, rule (e) exempts them, and they are shadow until `collect-loose-live`. **Reverses D-5888.**
- **D-TBD-orphan-census-audit** (DR-16): the census by location and the fourteen-rung ladder that `ws-gc --prune` shares; HEAD must be reachable from `--remotes`, not only `origin/HEAD`.
- **D-TBD-orphan-verb** (DR-17): `ws-orphan`, never `--force`, `branch -d` for `ccd-root` only, the attic-pin rescue on a rescue token; forbidden to sessions.
- **D-TBD-orphan-grants** (DR-18): three grant prefixes and the required `--expect`.
- **D-TBD-orphan-lane** (DR-19): the lane, its licence and pacing, two markers, the feed rows; resolves policy Open Q6 with option (a).

### Decisions recorded while planning

- **Mail goes through the server, never from the box.** A box script has no sender identity (`POST /api/mail` needs a registry row and its uuid).
- **One holder probe.** The tmp sweep asks ccd's probe through `ccd path-users`, rather than growing `_ts_holder`; `_ts_holder` stays for the dead arm and is characterized only.
- **Pressure is box-measured.** No server argument lowers a floor.
- **The orphan lane's `--remotes` rule is stricter than `ws-gc`'s `origin/HEAD` ancestry** on purpose: the ruling asks for HEAD on a remote, and a tree on a pushed feature branch passes it while `origin/HEAD` ancestry would not.

## Out of scope

- #1119 item 3 (work inside transcript directories) and the skill text for long output: follow-up issues (spec §10).
- Transcript dedupe (#317, #840 P4-7 to P4-9).
- Settings switches for the new arms; a PWA card beyond the banner line.

## Review log

**rev 0 (2026-10-23).** Written with the spec's rev 0 against `origin/main` `a68c90f15` and the 32 open PRs measured that day.
