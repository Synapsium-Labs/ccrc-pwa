# Fleet disk retention: live scratch, orphan worktrees, loose temp entries and a disk alarm — Implementation Plan

> **For agentic workers:** thirty-one PRs, Tasks DR-1 to DR-31, one task per PR. REQUIRED SUB-SKILL: superpowers:subagent-driven-development, with superpowers:test-driven-development for every red-first step. Routing is per task (**Routing** line). Band 1 is mechanical and may go to `handoff-run`; band 2 is spec-able and may go to `handoff-run` when the weekly pace says so, with the orchestrator reviewing the diff; band 3 is written and reviewed natively and never handed off. Hand off only tasks whose change is literal: workers have stalled on deep `ccd/ccd` edits. Workers do not edit §Deviations and decisions.

**Spec:** `docs/superpowers/specs/2026-10-23-fleet-disk-retention-design.md` (rev 3), implementing the operator's rulings of 2026-10-23 on #1119, their answers to rev 0's questions, and lifecycle-exit rulings G1 to G4 (posted on #1167 and #1119).

**Issue:** #1119.

**Base:** `origin/main` `a68c90f15`, re-checked at `bd895fbe4` for rev 1 (every cited file byte-unchanged). Anchors are `≈:` hints into that commit and each names its function. Re-ground every anchor in Step 0, because #1132 and #1114 move `ccd/ccd`.

**Deploy class.** Waves 1 and 2's server and PWA tasks are SERVER. Agent tasks (DR-2, DR-12's node-file half, DR-14, DR-18) are AGENT and deploy first. ccd tasks (DR-6, DR-7 to DR-10, DR-13, DR-16, DR-17, DR-20, DR-22, DR-25, DR-26, DR-28, DR-30, and DR-24's spawn half) are FLEET, deployed agent lane first like any `ccd` change. No task restarts a session, and each takes effect at the next ordinary release. No destructive arm is armed by any task.

## Gates

Open PRs measured at `a68c90f15` (`gh pr list --state open --json number,files`):

| PR | Holds | Tasks it gates |
|---|---|---|
| #1132 (path identity W3) | `ccd/ccd`, `CLAUDE.md`, `child-reclamation-contract.md` | **DR-7, DR-13, DR-16, DR-17 land after it** (they reuse `_ws_cwd_users`, `_ws_path_ident` and the `-ef` main-checkout rule, and edit the probe and collect regions). DR-15 and DR-19 rebase past its `CLAUDE.md` and contract edits. |
| #1114 (manual pin) | `ccd/ccd` | every ccd task rebases and runs `ccrc restamp` if it is still open |
| #1164 (update banner) | `pwa/src/fleet/BannerStack.tsx` | DR-5 rebases past it |
| #1162 (delegation) | `server/src/watch.ts` | DR-3, DR-4, DR-12, DR-15, DR-19 rebase past it |
| #1149 (release) | `shared/api.ts`, `CLAUDE.md` | DR-3, DR-12, DR-17 rebase past it |
| #1154 (history W2-2b) | `shared/lifecycle.ts` | DR-8, DR-10, DR-15, DR-19, DR-27, DR-29 rebase past it |
| #840 P4-4 to P4-6 (planned, no PR yet) | the reclaim ladder (HEAD, rung 6, rung 8) | DR-20 rebases after them if they open first; otherwise they rebase after DR-20. DR-16's rung 7 calls P4-5's stale-lock helper once it lands |

Wave 5 also edits `ccd/ccd` regions #1132 moves (the ladder, the expire evals, the spawn lines), so DR-20, DR-22, DR-24, DR-26 and DR-28 land after #1132 too.

Consolidation: none of these tasks waits for W1b or W4. Each new tick follows today's `last*` clock pattern and each new marker joins `shared/switches.ts`, so W1b's schedule table and W4's `decideRetire` fold them as rows.

## Global constraints

- **Public repo.** Fixtures use neutral names (`project-a`, `lane-a`). Never write a host, a mount path of a deployment, an account or lane name, another project's name, an absolute home path or a private tracker id.
- **SAFETY.** FIXTURE HOMEs only (`makeCcdHarness`, `server/test/ccdWsHelpers.ts`). No test runs a verb against a live `$HOME`. Nobody runs `ws-collect`, `ws-orphan`, `ws-reclaim`, `ws-expire`, `ws-archive`, `ws-gc --prune` or the tmp sweep's live arm against a live box. Nobody touches tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*` out of band. Nobody creates an arming marker on a live box.
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
5. **Wave 5 is lossless.** Every new exit ends in the existing pin, re-proved before the tail. A child that coordinated is never taken. A widened verb binds its new input into the token, and is never sent to a ccd without the capability.

## Tasks

Waves: **1** DR-1 to DR-6 (see it), **2** DR-7 to DR-12 (live scratch), **3** DR-13 to DR-15 (loose `~/.cc-tmp`), **4** DR-16 to DR-19 (orphan worktrees), **5** DR-20 to DR-31 (lifecycle exits).

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
| DR-12 census read, receipts mail, budget notice-then-enforce mail | 2 | AGENT + SERVER | DR-3, DR-8 |
| DR-13 ccd loose collect | 3 | FLEET | DR-7, #1132 |
| DR-14 loose collect grants | 1 | AGENT + SERVER | DR-13 |
| DR-15 collect lane loose arm (shadow) | 3 | SERVER | DR-14 |
| DR-16 ccd orphan census and audit | 3 | FLEET | DR-7, #1132 |
| DR-17 ccd `ws-orphan` verb | 3 | FLEET | DR-16 |
| DR-18 orphan grants | 1 | AGENT + SERVER | DR-17 |
| DR-19 orphan-tree lane (shadow) | 3 | SERVER | DR-18 |
| DR-20 rung 9 rescues a nested repository (ccd) | 3 | FLEET | #1132; P4-4..6 coordination |
| DR-21 rescue words and shadow rows (server) | 2 | SERVER | DR-20 |
| DR-22 orphan rung 11 rescue; census sees nested trees (G4, ccd) | 3 | FLEET | DR-17, DR-20 |
| DR-23 orphan lane takes trees inside coordinators (G4) | 2 | SERVER | DR-19, DR-22 |
| DR-24 test temp never inside a work tree; `CCRC_SESSION_TMPDIR` | 2 | FLEET + SERVER | #1132 |
| DR-25 skill clauses: temp and long output | 3 | FLEET (skills) | DR-24 |
| DR-26 `ws-reclaim --stale` (ccd) | 3 | FLEET | #1132, DR-20 |
| DR-27 child reclaim's stale arm (shadow) and coordinator mail | 3 | SERVER | DR-26 |
| DR-28 `ws-expire --child-of` (ccd) | 3 | FLEET | #1132 |
| DR-29 expiry lane's child arm (shadow) | 3 | SERVER | DR-28 |
| DR-30 `ws-archive --if-no-pane`, reason `stale` (ccd) | 2 | FLEET | none |
| DR-31 stale-archive arm (shadow) | 3 | SERVER | DR-30 |

### Task DR-1: one disk vocabulary and its decider (D-6613; spec §2.5)

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

### Task DR-2: the agent's `disk` op (D-6614; spec §2.5)

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

### Task DR-3: the `disk` block in `/api/fleet/health` (D-6615; spec §2.5)

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

### Task DR-4: the disk notice (D-6616; spec §2.5)

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

### Task DR-5: the disk banner (D-6617; spec §2.5)

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

### Task DR-6: doctor measures every work filesystem (D-6618; spec §2.5.2)

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

### Task DR-7: one holder probe — file mappings, many paths, `ccd path-users` (D-6619; spec §2.6.1) — GATED: after #1132

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

### Task DR-8: the tmp sweep's live arm and its enforcing size budget, in shadow, and its census (D-6620; spec §2.1, §2.1.1, §2.5.1)

**Routing:** band 3. **Lane:** FLEET (`ccd/ccd-tmp-sweep`).

**Files:**
- Modify `ccd/ccd-tmp-sweep`:
  - roots: the existing one, `/tmp/claude-<uid>` when it differs, and each witnessed child leaf's `claude-<uid>` when present (validated: a directory owned by this uid whose physical path is where it should be);
  - after today's pass, under the same lock: the live arm over units classified live; candidates are the direct children of `scratchpad/` and `tasks/`; the uuid → id map from `$REG/*.uuid`; the untouched rule (mtime, ctime, regular-file atime unless `noatime`); holders through `ccd path-users --json`; quarantine at `<root>/.ccd-tmp-quarantine/<uuid>/<ns>.<name>` and deletion a pass ≥ 24 h later after a fresh holder ask;
  - `_ts_pressure` (statfs twin of L0) and the pressure ages;
  - **the size budget (spec §2.1.1):**
    - per session, sum `scratchpad/` and `tasks/` across every root and unit of its uuid, child leaf included, with quarantine excluded;
    - over `CCD_TMP_BUDGET_GB` (20), record `overSince`, and `enforceAt` = `overSince` + 24 h, or `overSince` itself under `_ts_pressure`;
    - at or after `enforceAt`, still over: rank top-level entries oldest-first by newest touch, and take each that is untouched 48 h, unheld and has its git work rescued, through the same quarantine, until under `CCD_TMP_BUDGET_TARGET_GB` (15);
    - an entry holding a repository with work on no remote is rescued through `ccd`'s `_ws_nested_rescue` once DR-20 has landed, and is kept as `git-work-unrescued` until then;
    - the episode ends under 15 GiB;
    - both knobs can only be raised;
  - shadow unless `~/.ccrc/tmp-sweep-live-arm` exists (the budget's removals included; its census fields are written either way);
  - the census `~/.ccrc/tmp-sweep.json`, written to a temp file and renamed;
  - the summary line gains the live arm's counts.
- Modify `shared/lifecycle.ts`: `claude-tmp-session-dirs`' collector and bound; a new `tmp-sweep-census` row.
- Modify `server/test/tmp-sweep.test.ts` (characterization) and create `server/test/tmp-sweep-live.test.ts`; extend `server/test/disk-twins.test.ts` and `server/test/lifecycle.test.ts`.
- Modify `README.md` (the tmp sweep's section).

- [ ] **Step 0: Re-ground.** Both scratch locations were observed on a fleet host (spec §1.3: `/tmp/claude-<uid>` and a child leaf's `~/.cc-tmp/<id>/claude-<uid>`), and the operator ruled the second is swept too (spec §9.1 Q7). Build fixtures for both. No command is run on a live box by this task.
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
  - "the pause file stops the live arm as it stops today's";
  - budget (sparse fixture files, with the two knobs raised in a test-only way so a fixture stays small):
    - "over budget, first sighting: `overSince` and `enforceAt` are recorded, and nothing is moved (notice only)";
    - "still over 24 h later: the oldest unheld entries untouched for 48 h are moved oldest-first until the session is under 15 GiB, and no further";
    - "an entry touched within 48 h is never moved even while the session stays over; the census reads `over-unremovable` and lists it with why";
    - "a held entry is skipped, and the next-oldest is taken";
    - "under a fake `df` at 93%: `enforceAt` equals `overSince` (no grace), and entries move on the first sighting";
    - "a child leaf's scratch counts toward its session";
    - "quarantined bytes do not count";
    - "an entry holding a repository with an unpushed commit is kept as `git-work-unrescued` (before DR-20)";
    - "under 15 GiB the episode ends; over 20 GiB again starts a new one";
    - "shadow: would-remove (budget) rows, nothing moved".
- [ ] **Step 3: Green.**
- [ ] **Step 4: Mutation table, RUN.** Rows for: mtime-only rule; top-level-only walk; atime on directories; deleting without quarantine; grace removed; shadow marker ignored; unmapped units swept; pressure applied without the measurement; budget newest-first instead of oldest-first; the 48 h floor dropped; the target of 15 GiB read as 20; the 24 h grace skipped without pressure; quarantined bytes counted.
- [ ] **Step 5: Verify.**

      cd server && ./node_modules/.bin/vitest run test/tmp-sweep.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/tmp-sweep-live.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/disk-twins.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/macos-platform.test.ts --maxWorkers=2

### Task DR-9: the tmp sweep caps finished task output (D-6621; spec §2.1, #1119 item 1)

**Routing:** band 3 (it rewrites a live session's file). **Lane:** FLEET.

**Files:**
- Modify `ccd/ccd-tmp-sweep`: on the live arm, a `tasks/*.output` regular file over 1 GiB, unheld, mtime older than 1 h, is rewritten as its first 64 MiB, one marker line (`[ccd-tmp-sweep: <n> bytes cut at <ts>]`) and its last 64 MiB, written to a temp file in the same directory and renamed over; census kind `output-capped`.
- Create `server/test/tmp-sweep-output-cap.test.ts` (sparse fixture files, scaled thresholds through test-only knobs that can only raise the cap).

- [ ] **Step 1: Red.** "a 1.5 GiB finished output becomes head + marker + tail"; "a held output is untouched"; "an output written 10 minutes ago is untouched"; "a 900 MiB output is untouched"; "shadow lists it and changes nothing"; "a failed rename leaves the original byte-identical".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.** Rows for: truncate in place; the holder ask dropped; the quiet hour dropped.
- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/tmp-sweep-output-cap.test.ts --maxWorkers=2

### Task DR-10: the tmp sweep collects dead test-run roots (D-6622; spec §2.2)

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

### Task DR-11: vitest's own `tmpDir` joins the run's signal arm (D-6623; spec §2.2)

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

### Task DR-12: the census is read, sessions are told, and the budget's notice-then-enforce mail (D-6624; spec §2.1, §2.1.1)

**Routing:** band 2. **Lane:** AGENT + SERVER (the `NODE_FILES` key is the agent's admission set: deploy the agent first).

**Files:**
- Modify `shared/agent-protocol.ts` (`NODE_FILES` ≈:170): `tmpSweep: 'tmp-sweep.json'`. The inventory's `MEASURED_FILE_KEYS` leaves it out (it has its own reader).
- Create `server/src/tmpSweep.ts` (L1): `parseTmpSweepCensus` (one reader, `null` for malformed), `tmpSweepReceipts(census, mailed)` (one mail per session per pass, non-shadow rows only), `tmpSweepBudget(census, noticed)` (one notice per over-budget episode, keyed on the session's `overSince`), and the mail words. The notice names the total, the five largest entries and `enforceAt`; at critical pressure it says enforcement has begun. Receipts list `budget` rows and the entries the budget kept, with why.
- Modify `server/src/watch.ts`: `sweepTmpSweepCensus` every 5 min reads the file through `FleetIO`, queues system mail from `operator` (`queueSystemMail`, `coord/rundefsTx.ts` ≈:61) deduplicated by `hasMailWithSubject`, sends the budget notice to the session and, for a run's worker, its coordinator (`resolveCoordinator`); fills `disk.holders` with the five largest sessions.
- Create `server/test/tmp-sweep-mail.test.ts`; modify `server/test/fleet-health.test.ts`.

- [ ] **Step 1: Red.** "two passes' rows for one session send two mails, a re-read sends none"; "shadow rows send no mail"; "a row whose id has no registry row sends nothing and logs once"; "over budget, first sighting: one notice to the session and its coordinator naming `enforceAt`, and no receipt"; "the same episode on later passes sends no second notice"; "a new `overSince` (a new episode) sends a new notice"; "a critical-pressure census: the notice says enforcement has begun"; "budget removals arrive as receipt rows with their quarantine paths, and kept entries with why"; "the coordinator copy goes to a worker's run's coordinator, and a coordinating session gets no copy"; "a malformed census is unmeasured, and `holders` is empty"; "the body names the quarantine path and the time to move it back".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.** Rows for: no dedupe; shadow mailed; a notice per pass rather than per episode; the coordinator always copied; `enforceAt` left out of the body.
- [ ] **Step 4: Verify.**

      cd agent && ./node_modules/.bin/vitest run --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/tmp-sweep-mail.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/fleet-health.test.ts --maxWorkers=2

### Task DR-13: ccd collects loose `~/.cc-tmp` entries (D-6625; spec §2.4) — GATED: after #1132

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

### Task DR-14: grants for the loose collect (D-6626; spec §5)

**Routing:** band 1. **Lane:** AGENT + SERVER (agent first).

**Files:**
- Modify `agent/src/whitelist.ts` (`EXEC_WHITELIST.ccd` ≈:423-632): `['ws-audit','--collect-census']`, `['ws-audit','--loose-hex']`. The verb rides `['ws-collect','--expect']`.
- Modify `server/src/ccdargv.ts` (≈:553-562): `wsCollectCensus`, `wsCollectLooseAudit(hex)`, `wsCollectLoose(token, hex, dec)`; `COLLECT_LOOSE_CAP = 'collect-loose-v1'` and its `CCD_CAN` row.
- Modify `server/test/whitelist-subset.test.ts` and the argv suite.

- [ ] **Step 1: Red** in the argv suite and `whitelist-subset`. **Step 2: Green.** **Step 3: Verify.**

      cd agent && ./node_modules/.bin/vitest run --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/whitelist-subset.test.ts --maxWorkers=2

### Task DR-15: the collect lane's loose arm, in shadow (D-6627; reverses D-5888; spec §2.4)

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

### Task DR-16: ccd's orphan census and audit (D-6628; spec §2.3) — GATED: after #1132

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

### Task DR-17: ccd's `ws-orphan` verb (D-6629; spec §2.3, §2.6.2)

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

### Task DR-18: grants for the orphan lane (D-6630; spec §5)

**Routing:** band 1. **Lane:** AGENT + SERVER (agent first).

**Files:**
- Modify `agent/src/whitelist.ts`: `['ws-audit','--orphans']`, `['ws-audit','--orphan-hex']`, `['ws-orphan','--expect']`; `REQUIRED_VERB_FLAG` gains `'ws-orphan': '--expect'`. `UNGRANTABLE_VERBS` is unchanged.
- Modify `server/src/ccdargv.ts`: `wsOrphanCensus`, `wsOrphanAudit(hex)`, `wsOrphan(token, hex, rescue, dec)`; `ORPHAN_CAP = 'orphan-v1'` and its `CCD_CAN` row.
- Modify `server/test/whitelist-subset.test.ts`, the argv suite, and the `test/types/bypasses/g*` fixture set if a lost flag needs a new one.

- [ ] **Step 1: Red** (a grant without its required flag fails the type and the boot audit). **Step 2: Green.** **Step 3: Verify.**

      cd agent && ./node_modules/.bin/vitest run --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/whitelist-subset.test.ts --maxWorkers=2

### Task DR-19: the orphan-tree lane, in shadow (D-6631; resolves policy Open Q6; spec §2.3)

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

### Task DR-20: ccd's rung 9 rescues a nested repository into the attic (D-6632; spec §2.7.1) — GATED: after #1132; coordinate with #840 P4-4 to P4-6

**Routing:** band 3 (the shared reclaim and expiry ladder, and the pin). **Lane:** FLEET.

**Files:**
- Modify `ccd/ccd`:
  - rung 9 of `_ws_reclaim_ladder` (≈:30929-30991): a failing `_ws_reclaim_foreign_clean` (≈:30563) marks the repository rescuable when `$REG/nested-rescue-live` exists. Without it, `containment-unproven` as today. Read the marker at the audit and again inside the lock, and bind `nestedRescue=<pathhex>:<HEAD|->:<status digest>` into `REAP_CHILDDIGEST` (≈:31010);
  - the audit document gains `nestedRescue: {wouldRescue, rescue}`;
  - the pin (`_ws_reclaim_pin_contained` ≈:32198): for each rescuable repository, step (1a) stops refusing and calls a new `_ws_nested_rescue`. It makes a scratch-index WIP commit inside the nested repository (`_ws_wip_commit`'s shape, untracked non-ignored files included), runs a contained `git -C <main> fetch --no-tags --no-write-fetch-head <N> '+refs/*:refs/ccrc/attic/<id>/nested/<pathhex>/refs/*'`, writes the WIP as `…/wip`, measures the bytes the fetch added, and refuses `nested-rescue-too-large` above `WS_NESTED_RESCUE_MAX_MB` (512, raise-only). It then re-proves that every rescued sha resolves (`nested-rescue-failed` otherwise);
  - the tombstone's `containment.rescued` (≈:32343-32366);
  - caps `nested-rescue-v1`;
  - for DR-8's budget (spec §2.1.1, ruling (3)): a box-local entry, `ccd scratch-rescue --session <id> <path>`, that runs `_ws_nested_rescue` into the session's project attic under `refs/ccrc/attic/<id>/scratch/<namehex>/`. It sits behind the privileged direct-entry check, is added to `FORBIDDEN_CCD_VERBS` (`server/src/coord/approvalguard.ts`), and is called only by `ccd-tmp-sweep`.
- Modify `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md` (the rung-9 row ≈:400 and ≈:484-492) and `docs/superpowers/programs/child-reclamation-contract.md` (§3 ≈:160).
- Create `server/test/ccd-nested-rescue.test.ts`. Its fixture builds a child tree holding a fixture repository with two unpushed commits, an untracked file and no remote.

- [ ] **Step 0: Re-ground** on post-#1132 `main`. If P4-4 to P4-6 have opened PRs, rebase after them. Read rung 9, the pin's step (1a), `_ws_wip_commit` and the tombstone writer. Confirm the tail's `--force` removal takes foreign checkouts with the tree (≈:34219).
- [ ] **Step 1: Characterize** (green on main): the fixture answers `containment-unproven` at the reclaim audit and at the expire audit.
- [ ] **Step 2: Red.**
  - "without the marker: `containment-unproven` and `wouldRescue` names the path";
  - "with the marker: a token; the reclaim pins, fetches both commits and the WIP into `refs/ccrc/attic/<id>/nested/<hex>/`, and the tree is gone; each rescued sha resolves; the tombstone lists the rescue";
  - "a commit made in the nested repository between the audit and the act gives `state-changed`";
  - "over the size bound: `nested-rescue-too-large`, nothing removed";
  - "a fetch that fails: `nested-rescue-failed`, nothing removed";
  - "a leaf link and a shared row still answer `containment-unproven` under the marker";
  - "the expiry ladder rescues the same fixture".
- [ ] **Step 3: Green.** Run `ccrc restamp`.
- [ ] **Step 4: Mutation table, RUN.** Rows for: the marker ignored; the WIP skipped (the untracked file lost); the re-prove skipped; the rescue bound out of the token; the size bound lowered; rescue applied to a leaf-link refusal.
- [ ] **Step 5: Verify.**

      bash -n ccd/ccd
      cd server && ./node_modules/.bin/vitest run test/ccd-nested-rescue.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-ladder.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-ladder.test.ts --maxWorkers=2

### Task DR-21: the server knows the rescue words and shows the shadow (D-6633; spec §2.7.1)

**Routing:** band 2. **Lane:** SERVER.

**Files:**
- Modify `server/src/coord/childReclaim.ts` (`CHILD_RECLAIM_TOKEN_KIND` ≈:78-93) and `server/src/archivedExpiry.ts` (`EXPIRE_TOKEN_KIND` ≈:41-61): `nested-rescue-too-large` terminal, `nested-rescue-failed` retry.
- Modify `server/src/wsaudit.ts` (`SENTENCES`): both sentences.
- Modify both lanes' audit parsers to read `nestedRescue` and record one "would rescue a nested repository" feed row per child and token while the marker is absent.
- Modify `shared/switches.ts`: `NESTED_RESCUE_LIVE_MARKER` and its row (owner C4, no writer).
- Create `server/test/nested-rescue-words.test.ts`; modify `server/test/switches.test.ts` and `server/test/single-definition.test.ts`.

- [ ] **Step 1: Red.** Each word's kind on both lanes; the sentences; one shadow row per child and token; the marker has no writer. **Step 2: Green.** **Step 3: Mutation table, RUN** (a word classed retry/terminal the wrong way round; a shadow row per pass). **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/nested-rescue-words.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/switches.test.ts --maxWorkers=2

### Task DR-22: the orphan ladder's nested-checkout rung rescues, and its census sees nested trees (D-6634; spec §2.7.1, §2.7.5)

**Routing:** band 3. **Lane:** FLEET.

**Files:**
- Modify `ccd/ccd` (DR-16's `_ws_orphan_ladder` and census, DR-17's `cmd_ws_orphan`):
  - rung 11 under `$REG/nested-rescue-live`: a same-repository nested checkout is pinned under `refs/ccrc/attic/orphan/<sha16>/nested/<pathhex>/`, and a foreign one goes through DR-20's `_ws_nested_rescue`. The document carries a rescue token;
  - the verb, on that token, rescues, removes each rescued nested directory with `_ws_leaf_remove` after a holder ask, then runs `git worktree remove` without `--force`;
  - the census's `claude` and `superpowers` classes cover `<checkout>/.claude/worktrees/*` and `<checkout>/.superpowers/worktrees/*` for every checkout of the repository. Rung 4 lets a containing row pass and names it `inside: <id>`; a row whose workdir is the tree, or lies inside it, still refuses `registered`.
- Extend `server/test/ccd-orphan-audit.test.ts` and `server/test/ccd-ws-orphan-verb.test.ts`.

- [ ] **Step 1: Red.** "a tree inside a registered workspace is classed `claude` with `inside`"; "a row whose workdir is inside the tree still refuses"; "nested foreign repository without the marker: `nested-checkout`; with it: rescued, then the tree is removed and git saw no `--force`"; "a holder in the nested directory stops the act".
- [ ] **Step 2: Green.** Run `ccrc restamp`. **Step 3: Mutation table, RUN** (the containing-row pass widened to an inside row; `--force` used instead of removing the rescued directory). **Step 4: Verify.**

      bash -n ccd/ccd
      cd server && ./node_modules/.bin/vitest run test/ccd-orphan-audit.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccd-ws-orphan-verb.test.ts --maxWorkers=2

### Task DR-23: the orphan lane takes trees nested inside coordinators (D-6635; spec §2.7.5)

**Routing:** band 2. **Lane:** SERVER.

**Files:**
- Modify `server/src/orphanTreeLane.ts`: a census row with `inside: <id>` is a candidate only when that id is a run's `claimedBy` (`childReclaimCoordinatorClaims` or `openCoordinatorIds`). Otherwise it reports "goes with its workspace". The rescue token is used only under `orphan-tree-rescue-live`.
- Extend `server/test/orphan-tree-lane.test.ts`.

- [ ] **Step 1: Red.** Inside a coordinator: a candidate. Inside a worker: reported only. The claim read unreadable: not a candidate. **Step 2: Green.** **Step 3: Verify.**

      cd server && ./node_modules/.bin/vitest run test/orphan-tree-lane.test.ts --maxWorkers=2

### Task DR-24: test temp never lands inside a work tree (D-6636; spec §2.7.2)

**Routing:** band 2. **Lane:** FLEET (the spawn export) + SERVER (test harness), one PR. Either may deploy first: the harness falls back to `/tmp` when the variable is absent.

**Files:**
- Modify `server/test/run-tmp.globalsetup.mjs` (`setup` ≈:331-367): resolve `os.tmpdir()` physically, and walk up for a `.git`. Inside a work tree, build the run parent under `CCRC_SESSION_TMPDIR` when it is set and outside every tree, else under `/tmp`, and print `ccrc-test: TMPDIR <…> is inside a work tree; the run's temp moved to <…>`. Update the header's "WHAT THIS DOES NOT DO".
- Modify `ccd/ccd` (`_spawn_start` ≈:23486, beside the `tmpenv` splice ≈:23822): export `CCRC_SESSION_TMPDIR` in both spawn lines, set to the child's `~/.cc-tmp/<id>` or the spawn's own `TMPDIR`.
- Modify `server/test/run-tmp.test.ts` and the spawn suites that pin the launch statement (`ccd-spawn-child-settings.test.ts`, `ccd-spawn-account-settings.test.ts`), reading the fragment from ccd's composer as #1132 does.

- [ ] **Step 1: Red.** A run with `TMPDIR=<fixture tree>/.tmp-step0` builds its parent under `CCRC_SESSION_TMPDIR`, or under `/tmp` without it, and nothing is created inside the tree. A run outside any tree is unchanged. The spawn line exports the variable for a child and for a plain session.
- [ ] **Step 2: Green.** Run `ccrc restamp`. **Step 3: Mutation table, RUN** (the walk stops at the first directory; the export dropped from one spawn line). **Step 4: Verify.**

      bash -n ccd/ccd
      cd server && ./node_modules/.bin/vitest run test/run-tmp.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccd-spawn-child-settings.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccd-spawn-account-settings.test.ts --maxWorkers=2

### Task DR-25: the skills say where temp and long output go (D-6637; spec §2.7.2, §10)

**Routing:** band 3 (pinned skill clauses). **Lane:** FLEET (skills ride `ccrc update`'s install spine).

**Files:**
- Modify `ccd/coordinator-skill/SKILL.md` and `ccd/worker-skill/SKILL.md`. Each gains one clause: a workflow script, a brief or a test step never sets `TMPDIR` to, or writes scratch inside, a work tree; it uses the session's `TMPDIR` (`CCRC_SESSION_TMPDIR`); long command output goes to a file there, or through `tail`.
- Modify `server/test/coordinator-skill.test.ts` and `server/test/worker-skill.test.ts`: the clause counts and the verbatim pins. Update CLAUDE.md's "seventeen clauses" sentences.

- [ ] **Step 1: Red** (the new verbatim pins). **Step 2: Green.** **Step 3: Verify.**

      cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/worker-skill.test.ts --maxWorkers=2

### Task DR-26: ccd's reclaim takes a stale child (D-6638; spec §2.7.3)

**Routing:** band 3. **Lane:** FLEET.

**Files:**
- Modify `ccd/ccd` (`_ws_reclaim_eval` ≈:30656, rung 4 ≈:30720-30722, `cmd_ws_reclaim`):
  - `--stale held|run-absent|review|terminal` and `--hold-digest <sha256>`;
  - under `--stale held`, rung 4 passes only a hold whose content's sha256 equals the digest;
  - on every stale word, a new rung after rung 4, `_ws_reclaim_stale_idle`: the newest of the current uuid's transcript mtime (`_transcript_path`), `.lastend`, `.spawn`, `.woke` and `.supervised`, and `#{window_activity}` of a live pane, must be older than `WS_STALE_IDLE_S` (604800, raise-only). Otherwise `not-idle`; unmeasured stays unmeasured;
  - the binding gains `stale=`, `holdDigest=` and `idleAt=`;
  - caps `reclaim-stale-v1`. The flags are accepted on the audit (`ws-audit --session <id> --reclaim --stale …`) and on the verb.
- Create `server/test/ccd-reclaim-stale.test.ts`.

- [ ] **Step 1: Characterize** (green on main): a held child refuses `held`.
- [ ] **Step 2: Red.** "`--stale held` with the digest of the current hold, idle 8 days: a token, then the normal pin and tail"; "a changed hold: `held`"; "a transcript touched yesterday: `not-idle`"; "a live pane active 2 days ago: `not-idle`"; "no evidence at all: unmeasured"; "without `--stale`, everything as today"; "the token changes when the hold changes".
- [ ] **Step 3: Green.** Run `ccrc restamp`. **Step 4: Mutation table, RUN** (the digest ignored; the idle rung skipped; mtime of the wrong uuid; the bound lowered). **Step 5: Verify.**

      bash -n ccd/ccd
      cd server && ./node_modules/.bin/vitest run test/ccd-reclaim-stale.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-verb.test.ts --maxWorkers=2

### Task DR-27: child reclaim's stale arm, in shadow, and the coordinator mail (D-6639; spec §2.7.3)

**Routing:** band 3 (the reclaim decider). **Lane:** SERVER.

**Files:**
- Modify `server/src/childReclaimSweep.ts`:
  - the input gains `idle: {runAt, mailAt, statusAt} | 'unmeasured'`;
  - after the verdict answers `held`, `minting-run-absent`, `review-report-live`, `review-report-stale` or `terminal-refusal`, a stale step answers `stale-eligible` with that word when every idle input is older than `CHILD_STALE_IDLE_MS` (7 days). `coordinating` never reaches it;
  - a terminal child is re-asked at most once per `CHILD_STALE_IDLE_MS` of idleness;
  - the `CHILD_RECLAIM_SKIP` sentences of the stale-eligible words say when they lapse.
- Modify `shared/api.ts` (the L0 kept-word table ≈:4076-4081): the kept words that now lapse say so; no word is removed.
- Modify `server/src/watch.ts` (the sweep's input ≈:4228-4471): compose `idle` from `run_events`, the mail store and `statusUpdatedAt`; pass `--stale` and the hold digest through `CCD_ARGV.wsReclaimAudit`/`wsReclaim` (`server/src/ccdargv.ts` ≈:526-538, new optional arguments) only when `ccdCan` sees `reclaim-stale-v1`; shadow unless `$REG/child-stale-reclaim-live`.
- Modify `server/src/coord/childReclaim.ts`: after a stale-arm `done`, queue system mail from `operator` to `resolveCoordinator(runId)`, kind `status`, naming the attic refs from the tombstone; a run-absent child writes a `kind:'coord'` feed row instead.
- Modify `shared/switches.ts` (`CHILD_STALE_RECLAIM_LIVE_MARKER`), `shared/lifecycle.ts` (`child-workspaces`), and the contract (R32, R34, R41) and the reclamation spec (§5.9 ≈:1021).
- Create `server/test/child-reclaim-stale.test.ts`; modify `server/test/child-reclaim-sweep-policy.test.ts`, `server/test/switches.test.ts`, `server/test/single-definition.test.ts`, `server/test/lifecycle.test.ts`.

- [ ] **Step 0: Re-ground.** The verdict order (≈:616-710), the terminal set from the mirror (`watch.ts` ≈:4413), `recordChildReclaimKeptFeed`, and `queueSystemMail`.
- [ ] **Step 1: Red.** Each word at 6 days: kept; at 8 days: `stale-eligible`. A hand hold (text outside the programme grammar) at 8 days: `stale-eligible`, and the mail quotes the hold's text (spec §9.1 item 10). A review child whose reviewed run is open, at 8 days: `stale-eligible` (item 16). `coordinating` at 30 days: kept. Any idle input unmeasured: kept. Shadow: "child would be reclaimed (stale)" once. Armed: the reclaim argv carries `--stale` and the digest. The mail names the refs. A run-absent child: a feed row and no mail. A terminal child is asked again after 7 more idle days and not before. A box without the capability is never sent the flag.
- [ ] **Step 2: Green.** **Step 3: Mutation table, RUN** (`coordinating` let through; the ceiling `>=` 0; the capability ignored; the mail sent in shadow). **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/child-reclaim-stale.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/child-reclaim-sweep-policy.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/child-reclaim-sweep.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/child-reclaim-prose.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts --maxWorkers=2

### Task DR-28: ccd's expiry accepts an archived child (D-6640; spec §2.7.4)

**Routing:** band 3. **Lane:** FLEET.

**Files:**
- Modify `ccd/ccd`: `cmd_ws_expire` (≈:35303-35340) and the expire audit accept `--child-of <run>`. `_ws_expire_not_child` (≈:34870-34879) passes only when the marker parses as a run id equal to it; an unreadable marker still refuses `child`. `_WS_LADDER_BIND` (≈:35165) gains `childOf=`. Both evals and both resumes apply it. Caps `expire-child-v1`.
- Modify `CLAUDE.md` (the `ws-expire` SAFETY line, spec §2.7.6) and `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md` (≈:326-330, ≈:360, ≈:433-434).
- Create `server/test/ccd-ws-expire-child.test.ts`.

- [ ] **Step 1: Red.** "without `--child-of`: `child`"; "a matching marker, archived 8 days, no pane: expired through the shared tail, and the child's temp root is gone"; "a mismatched marker: `child`"; "an unreadable marker: `child`"; "archived 6 days: `not-expired`"; "a crash at `children` resumes with the binding".
- [ ] **Step 2: Green.** Run `ccrc restamp`. **Step 3: Mutation table, RUN** (the marker compare dropped; `childOf` left out of the binding). **Step 4: Verify.**

      bash -n ccd/ccd
      cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-child.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-audit.test.ts --maxWorkers=2

### Task DR-29: the expiry lane's child arm, in shadow (D-6641; spec §2.7.4)

**Routing:** band 3. **Lane:** SERVER.

**Files:**
- Modify `server/src/archivedExpiry.ts` (`archivedExpiryVerdict` ≈:387): a `child` mark is eligible under `$REG/expire-child-live` and still skips without it, with a "would be expired (child)" observation. An `unreadable` mark always skips. The header's "never a child" sentence changes.
- Modify `server/src/coord/expireArchived.ts` and `server/src/ccdargv.ts` (≈:542-547): the audit and verb carry `--child-of` only with `expire-child-v1`.
- Modify `shared/switches.ts` (`EXPIRE_CHILD_LIVE_MARKER`), `shared/lifecycle.ts` (`archived-workspaces`), and the policy's row 4.
- Create `server/test/archived-expiry-child.test.ts`; modify `server/test/archived-expiry-policy.test.ts`, `server/test/switches.test.ts`, `server/test/single-definition.test.ts`.

- [ ] **Step 1: Red.** An archived child past `expiresAt`: shadow row without the marker, act with it. `unreadable`: skip. An open run, `coordinating` or `review-open`: skip, as for anyone. No capability: never sent the flag. **Step 2: Green.** **Step 3: Mutation table, RUN.** **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/archived-expiry-child.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/archived-expiry-policy.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/archived-expiry-lane.test.ts --maxWorkers=2

### Task DR-30: `ws-archive --if-no-pane` and the `stale` reason (D-6642; spec §2.7.5)

**Routing:** band 2 (a small refusal added to an existing verb). **Lane:** FLEET.

**Files:**
- Modify `ccd/ccd` (`cmd_ws_archive` ≈:9988-10172): `--if-no-pane` refuses `live` before the manifest when a tmux session for the id exists or the unit answers anything other than `inactive`/`failed`. `--reason stale` writes `.archivedreason` `stale`. Caps `archive-if-no-pane-v1`.
- Modify `shared/api.ts` if `.archivedreason`'s words are a closed L0 vocabulary (Step 0).
- Create `server/test/ccd-ws-archive-if-no-pane.test.ts`.

- [ ] **Step 1: Red.** No pane: archived, reason `stale`. A pane up: `live`, nothing written. An active unit: `live`. Without the flag: as today. **Step 2: Green.** Run `ccrc restamp`. **Step 3: Verify.**

      bash -n ccd/ccd
      cd server && ./node_modules/.bin/vitest run test/ccd-ws-archive-if-no-pane.test.ts --maxWorkers=2

### Task DR-31: the stale-archive arm, in shadow (D-6643; spec §2.7.5)

**Routing:** band 3. **Lane:** SERVER.

**Files:**
- Modify `server/src/archivedExpiry.ts` (L1): `staleArchiveVerdict(row, facts, nowMs)` with spec §2.7.5's rules, `STALE_ARCHIVE_AFTER_MS` (14 days), and two pane-absent sightings at least an hour apart.
- Create `server/src/coord/staleArchive.ts` (L3): `ccdCan('archive-if-no-pane-v1')`, the switches nearest the argv (`reclaim-paused`, `stale-archive-live`), presence (`visible` defers), then `CCD_ARGV.wsArchive(id, {ifNoPane: true, reason: 'stale'})`.
- Modify `server/src/watch.ts`: `sweepStaleArchive` hourly (`lastStaleArchiveSweep`), at most one act per pass, on the `KeyedQueue` key; the facts from the registry, the lifecycle mirror (`lifecycle_events`, the newest `spawn`/`start`/`supervise`), the transcript's mtime through `FleetIO`, and the claim reads; a `kind:'coord'` feed row per act or would-act.
- Modify `server/src/ccdargv.ts` (`wsArchive` ≈:516): the optional flags.
- Modify `shared/switches.ts` (`STALE_ARCHIVE_LIVE_MARKER`) and the policy's row 4.
- Create `server/test/stale-archive.test.ts`; modify `server/test/switches.test.ts` and `server/test/single-definition.test.ts`.

- [ ] **Step 1: Red.** A never-claimant workspace with no pane for 15 days, seen twice: archived (armed), would-archive (shadow). 13 days: kept. A viewer, a hold, a child marker, any past claim or a main checkout: kept. No evidence: kept. Hibernated 15 days: archived. A pane back at the act: ccd's `live`, recorded and nothing else. **Step 2: Green.** **Step 3: Mutation table, RUN** (one sighting; current claims only; evidence missing read as old; the viewer ignored). **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/stale-archive.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/switches.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts --maxWorkers=2

## Operator acts

None is required to build or land any task. Each of these is the operator's, whenever they choose:

- **Arm the live arm** (`~/.ccrc/tmp-sweep-live-arm`) after a week of DR-8's shadow rows.
- **Arm the loose arm** (`$REG/collect-loose-live`) after its shadow rows, with the collect lane live.
- **Arm the orphan lane** (`$REG/orphan-tree-live`), then, a week after it runs live, the rescue arm (`$REG/orphan-tree-rescue-live`, ruled §9.1 Q1).
- **List the work mounts** (the work volume's mount point and every bind target) in the fleet agent's `CCRC_WORK_MOUNTS`. Then **delete the box-local disk guard** (its script, service and timer) once a warn crossing and a missing-mount fixture have reached the banner and the push (ruled §9.1 Q5).
- **Wave 5's arms, in this order:** `$REG/nested-rescue-live` (it turns most terminal children into ordinary reclaims), then `$REG/child-stale-reclaim-live`, `$REG/expire-child-live` and `$REG/stale-archive-live`, each after a week of its shadow rows. `expire-lane-live` was armed on 2026-10-23, and `collect-lane-live` was already present.

## Rollback

- **Server and PWA tasks:** a revert. Every new block is optional; an older PWA ignores it.
- **Agent tasks:** `ccrc rollback`. A server asking an absent op or grant reads unmeasured or skips by capability.
- **ccd and tmp-sweep tasks:** `ccrc rollback`, fleet lane. A quarantine left by a rolled-back tmp sweep is plain directories under `.ccd-tmp-quarantine/`; the older sweep's dead arm collects them with their unit. A loose record left behind is read by no older ccd and harms nothing; its slot sits in `.ccd-quarantine` for the operator.
- **Wave 5's ccd flags:** an older ccd rejects `--stale`, `--child-of` and `--if-no-pane` as usage errors, and the server never sends them without the capability. Attic refs a rescue wrote stay and harm nothing.
- **Arms:** removing a marker returns its arm to shadow at the next pass.

## Deviations and decisions

### Issued for this work

One contiguous block of thirty-one, D-6613 to D-6643, issued by the allocator (`POST /api/ledger/deviations`) and defined here in the same commit.

- **D-6613** (DR-1): `shared/disk.ts` holds the work-root table, 85/92 with a 2-point clear, the pressure-age table and `readDiskHealth`; `diskVerdict` takes the larger of bytes and inodes, needs two measurements to change level, and reads nothing measured as `unmeasured`.
- **D-6614** (DR-2): the agent's `disk` op takes no arguments, statfs's its own table under a 5 s deadline, groups by `st_dev`, and answers `CCRC_WORK_MOUNTS`' mount points.
- **D-6615** (DR-3): `FleetHealth.disk`, optional, absent before the first sweep, `unmeasured` with an older agent.
- **D-6616** (DR-4): one push per rise to warn or critical per episode, a recorded clear, keyed `disk:<dev>:<level>:<episode>`.
- **D-6617** (DR-5): banner id `disk`, ranked after `fleet-host`, at warn and critical.
- **D-6618** (DR-6): `_check_disk` prints one line per work filesystem; its bash thresholds are pinned equal to L0's.
- **D-6619** (DR-7): `_ws_path_users` counts file mappings and answers many paths in one walk; `ccd path-users` is its read-only entry.
- **D-6620** (DR-8): the live arm, its roots, the untouched rule with regular-file atime, the 24 h quarantine, the census and the box-measured pressure ages; shadow until `~/.ccrc/tmp-sweep-live-arm`. **The size budget enforces** (operator ruling 2026-10-23 (3)). Over 20 GiB of `scratchpad/` + `tasks/` per session, child leaf included and quarantine excluded, the sweep records `overSince`. After a 24 h grace (none at 92% pressure), if the session is still over, it moves the oldest top-level entries that are untouched 48 h, unheld and have their git work rescued, oldest-first, through the same quarantine, until the session is under 15 GiB. An entry touched within 48 h is never taken. Git work on no remote is kept until DR-20's rescue helper lands.
- **D-6621** (DR-9): a finished `.output` over 1 GiB keeps 64 MiB at each end with a marker, by rename.
- **D-6622** (DR-10): a `ccrc-testrun-*` root with no listener, 6 h ctime-quiet and unheld is removed by the tmp sweep.
- **D-6623** (DR-11): the run's signal arm removes vitest's own `tmpDir`.
- **D-6624** (DR-12): the census is a node file; the server mails receipts from the `operator` role. The budget is **notice-then-enforce**: one notice per over-budget episode (keyed on `overSince`) to the session and a worker's coordinator, naming the 24 h `enforceAt` (or saying enforcement has begun at critical pressure). Budget removals and the entries the budget kept come in the receipt mail.
- **D-6625** (DR-13): the census, the loose audit with a 48 h floor (24 h under pressure, never below 86400 s), the loose verb with its own lock and record family; R38 and R59 amended.
- **D-6626** (DR-14): two `ws-audit` grant prefixes and three argv builders.
- **D-6627** (DR-15): loose names join the collect population, rule (e) exempts them, and they are shadow until `collect-loose-live`. **Reverses D-5888.**
- **D-6628** (DR-16): the census by location and the fourteen-rung ladder that `ws-gc --prune` shares; HEAD must be reachable from `--remotes`, not only `origin/HEAD`.
- **D-6629** (DR-17): `ws-orphan`, never `--force`, `branch -d` for `ccd-root` only, the attic-pin rescue on a rescue token; forbidden to sessions.
- **D-6630** (DR-18): three grant prefixes and the required `--expect`.
- **D-6631** (DR-19): the lane, its licence and pacing, two markers, the feed rows; resolves policy Open Q6 with option (a).
- **D-6632** (DR-20): under `nested-rescue-live`, rung 9 classes a nested repository with work on no remote as rescuable. The pin WIP-commits it, fetches its refs and the WIP into `refs/ccrc/attic/<id>/nested/<pathhex>/`, re-proves each sha and bounds the bytes at 512 MiB. Then the ladder proceeds. Both lanes get it, and the token binds it. Reverses the 2026-09-22 spec's "reap, and note" refusal for nested repositories only.
- **D-6633** (DR-21): `nested-rescue-too-large` is terminal and `nested-rescue-failed` is retry on both lanes; shadow rows name what would be rescued.
- **D-6634** (DR-22): orphan rung 11 rescues; the census sees `.claude/worktrees` and `.superpowers/worktrees` of every checkout, and a containing row passes rung 4 as `inside`.
- **D-6635** (DR-23): a nested tree is a candidate only inside a coordinator's workspace. A containing row that is no workspace (registry `workspace` null: a plain session or the main checkout, the same `workspace !== null` test 2.7.5 uses for G1) is no nesting, because a main checkout has no reclaim or expiry exit; the server reads the row itself (`isWorkspace`), so no ccd change is needed, and a row it cannot read keeps the tree. Ruled (orchestrator): the departure from 2.7.5 read literally is accepted, and the spec text now says so; the server reads the `.workspace` marker measured, and an unreadable marker keeps the tree.
- **D-6636** (DR-24): the suite moves a run parent out of any work tree; every spawn exports `CCRC_SESSION_TMPDIR`.
- **D-6637** (DR-25): one clause each in the coordinator and worker skills, on temp placement and long output.
- **D-6638** (DR-26): `ws-reclaim --stale <word> [--hold-digest]`; a hold passes only by digest; a box-measured 7-day idle rung; the token binds both.
- **D-6639** (DR-27): kept children (`held`, `minting-run-absent`, review, terminal) become `stale-eligible` after 7 idle days on the server's facts; `coordinating` never does. Shadow until `child-stale-reclaim-live`. The coordinator is mailed the attic refs. Amends R32, R34 and R41, and supersedes D-5942's "nothing reclaims it before that".
- **D-6640** (DR-28): `ws-expire --child-of` expires an archived child whose marker names that run, through the shared tail; the binding carries `childOf`.
- **D-6641** (DR-29): the expiry lane stops skipping a readable child mark under `expire-child-live`.
- **D-6642** (DR-30): `ws-archive --if-no-pane` refuses `live`; the reason word `stale`.
- **D-6643** (DR-31): a workspace that is not a child and was never a claimant, with no pane for 14 days, is archived, one per pass, shadow until `stale-archive-live`.
- **D-6766** — (DR-12; allocated by the orchestrator) the census session row carries `top`, the session's five largest entries as `[{name, bytes}]`, written by `ccd-tmp-sweep` and read by DR-12's notice; optional on the wire, absent reads `[]`. `kept` is bounded to the first fifty with a `keptMore` count.
- **D-6858** — (DR-13; allocated by the orchestrator) the loose arm's rows rung reads a standing regular file against the registry by spelling: a row at or through the file, as written or under the root's physical path, holds it; an unreadable row is `unmeasured`. A file is no workdir, so the shared directory rung is not asked of it (#1393).
- **D-6859** — (DR-15; allocated by the orchestrator) the collect lane offers loose ids only while none is in flight, and at most one across the act and the learning audits, because ccd's loose audit and act share one non-waiting lock; witnessed ids still fill the learning cap (#1393).

### Decisions recorded while planning

- **Mail goes through the server, never from the box.** A box script has no sender identity (`POST /api/mail` needs a registry row and its uuid).
- **One holder probe.** The tmp sweep asks ccd's probe through `ccd path-users`, rather than growing `_ts_holder`; `_ts_holder` stays for the dead arm and is characterized only.
- **Pressure is box-measured.** No server argument lowers a floor.
- **The orphan lane's `--remotes` rule differs from `ws-gc`'s `origin/HEAD` ancestry** on purpose: the ruling asks for HEAD on a remote, and a tree on a pushed feature branch passes it while `origin/HEAD` ancestry would not.
- **Nested rescue goes into attic refs, not a bundle file** (spec §2.7.1): one record, one namespace, no new artifact class.
- **Idle for a stale child is measured on both sides.** The server knows runs and mail, and the box knows the pane and the transcript. Either can refuse.
- **No new verb in wave 5.** Three existing server verbs gain one flag each, behind a capability.
- **The `.tmp-step0` source is an agent-authored workflow prompt**, traced read-only on a fleet host. So the fix is in the suite, the spawn environment and the skills, not in Claude Code.

## Out of scope

- #1119 item 3 (work inside transcript directories): a follow-up issue (spec §10). The skill text for long output now rides DR-25.
- Transcript dedupe (#317, #840 P4-7 to P4-9).
- Settings switches for the new arms; a PWA card beyond the banner line.

## Review log

**rev 0 (2026-10-23).** Written with the spec's rev 0 against `origin/main` `a68c90f15` and the 32 open PRs measured that day.

**rev 1 (2026-10-23).** The operator's answers to the spec's §9 and rulings G1 to G4. DR-8's Step 0 became a re-ground, because both scratch locations were observed. Wave 5 added DR-20 to DR-31. #840 P4-4 to P4-6 were confirmed not on `main` and added to the Gates.

**rev 2 (2026-10-23).** Every spec question is ruled (spec §9.1, items 10 to 16). DR-27's red cases name the hand-hold and review-child rulings; nothing else in the tasks changes.

**rev 3 (2026-10-23).** Operator ruling (3): the size budget enforces. DR-8 gains the budget's rule and its red cases, DR-12's notice becomes notice-then-enforce, and both definitions (D-6620, D-6624) say so. DR-20's rescue helper is reused for git work in scratch once it lands.
