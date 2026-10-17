# Centralised update management, wave 18: the ccd harness contains ssh, scp, curl and the user bus, a census finds every raw spawn of the scripts, and the curl front's R23 items close: Implementation Plan

The coordinator cut wave 18 on 2026-10-15 at 22:11 UTC (programme ledger, "the cut to completion": waves 15 to 19 re-scoped, row 18 of the waves table). It is test containment, and tests only: the `makeCcdHarness` containment parity that wave 9's plan deferred (`2026-10-02-centralised-update-w9-stable-readiness.md:98`: "makeCcdHarness/ghContainedEnv (ccdWsHelpers.ts) still inherit the real XDG_RUNTIME_DIR, DBUS_SESSION_BUS_ADDRESS, ssh, scp and curl; this wave contains the ccd/ccrc builders only"), R14(b)'s raw-spawn census, and R23(a), (b) and (d). Run 517 carries it, with deviation block 5247 to 5266. A plan workflow drafted it from `main` at `256b25ecb7b1989e8a0e053df1416ba7e4eba8c9`: a scout measured what is still open, then a drafter prototyped every task red-first in an isolated worktree, measured the mutation rows, and ran 282 test files before and after the change. The drafter's session died at 22:09 UTC (its pane's memory cap, while its vitest batches ran), and a first finisher's at 22:35 (a fleet-wide out-of-memory kill, while it ran the final guard batch). A second finisher wrote this file from their worktree, evidence and transcripts, without re-running anything heavy. Every row and count marked *(prototype)* was run through the real files with vitest at `256b25ecb`, on a loaded Linux box (load 15 to 30 on 16 cores), and every mutation was restored with `cp` + `cmp`. Rows marked *(to be measured by the worker)* never ran. The finisher ran no vitest at all: the session slice's memory read 22.8 to 25.8 GB from 22:50 to 23:14 UTC, above the 21 GB bar the brief sets, so `topology-clean`, `dtbd` and `deviation-refs` on the tree with this plan in it are *(to be measured by the worker)*. Its file is `docs/superpowers/plans/2026-10-16-centralised-update-w18-test-containment.md`.

**`main` moved while the plan was finished:** it reads `0a06ebb9a` at 22:57 UTC on 2026-10-16. The four commits since `256b25ecb` are UI and docs; `git diff --stat 256b25ecb 0a06ebb9a -- server ccd agent shared deploy` prints nothing (measured), so the before/after comparison stands against the new `main`. The worker builds on `origin/main` as it finds it.

**Revised after three attack passes** (from 23:45 UTC on 2026-10-16 to about 00:40 on 2026-10-17), by a reviser that ran no vitest: the session slice still read above the 21 GB bar. Every line the reviser changed or added that no prototype ran is marked *(revised, unmeasured)*. *(prototype)* stays only on outputs the prototype measured. Where a mutation is unchanged but its expected set moved, the prototype's figure is given in brackets as the earlier shape's. What the reviser measured itself is marked *(reviser, measured)*. That covers `git`, `grep`, `gh` and `ccrc-api` reads, and one more kind of run: the revised census, run standalone. That run used node 24's type stripping with a minimal `describe`/`it`/`expect` shim, not vitest, over the prototype tree and over `git archive 256b25ecb`, with its mutation rows applied in a scratch copy. The reads found: `main` still reads `0a06ebb9a` at 23:59 UTC and changes nothing under `server`, `ccd`, `agent`, `shared` or `deploy` since `256b25ecb`; the live claims are the same twelve as at 22:57; of the open PRs only #435 touches a file this wave writes (`ccdWsHelpers.ts`); and `server/` pins vitest 4.1.10. What changed:
- The user bus now follows `systemd` in `ghContainedEnv`, not an opt-in `bus` flag. A caller's own pair stands when both values name paths under HOME, and the bus readers outside `ccd/ccd` are named (D-5248).
- The stub door is a named helper, `stubContainedTool`. `ccd-pool-sync`'s own runners ask `net`, because its module-level harness loses the creation-time plant after the first test, and an `afterEach` reds any test that reached the curl poison (D-5249).
- The census reads every spawn spelling a file's imports make (aliases, namespaces, `exec`, node-pty). It resolves script names through a directory binding, a namespace import and a `for … of` list, and reads more spellings of a bare env. It counts the SLICED class in a list of its own, and a fixture corpus is its standing mutation pin (D-5250, D-5251).
- `projected-home` gets one builder and an `assertNoRealTool` row.
- The before phase runs on the untouched tip before the first edit (Task 0), with spies that log any reach of a real `ssh`, `scp`, `curl` or user bus.
- Every batch uses `--maxWorkers=2`, because vitest 4 rejects `--poolOptions`. The vitest TMPDIR is short.
- The three heavy importers are CI's to arbitrate (D-5252), and #435 is named.

**What was measured as still open at `256b25ecb`** (the scout ran `h.sh()` in a scratch checkout): under `makeCcdHarness`, `gh`, `tmux`, `systemctl`, `systemd-run` and `launchctl` resolve to poisons in `<home>/.local/bin`, but `ssh`, `scp` and `curl` resolve to `/usr/bin`, and `XDG_RUNTIME_DIR` and `DBUS_SESSION_BUS_ADDRESS` are the operator's real `/run/user/<uid>` pair. The wave-9 deferral held in full; no wave between 2026-10-02 and 2026-10-16 closed any part of it. `ccd/ccd` calls none of the three tools and reads the bus pair in one place (`ccd/ccd:1639-1642`, the defaulting block), where only the poisoned managers consume it. So the gap is structural, not a live leak: the edit that adds a `curl` to `ccd`, or drops a manager poison, would have reached the live machine with nothing red. Other scripts a harness snippet can run read the pair too (D-5248), and nothing measured whether a test on the base reached a real tool and tolerated the failure: Task 0's spies measure that.

One line per task:
- **Task 0.** Claims, the before phase on the untouched tip with the reach spies (Task 6 Steps 1 and 2), and the plan's own commit, so every D-number a later commit cites is defined first.
- **Task 1.** W18-a (D-5247, D-5248, D-5249): `ghContainedEnv` gains an opt-in `net` flag (the `ssh`, `scp` and `curl` poisons, `plantPoison`'s create-if-absent ones), and its `systemd` option now also SETS the fixture `XDG_RUNTIME_DIR` and `DBUS_SESSION_BUS_ADDRESS` under HOME, after the caller's env, unless the caller's own pair is under HOME. `stubContainedTool` is the named door for a functional stub. `makeCcdHarness` asks `net` at creation and on every `sh()`, and `CcdHarness` gains `env(extra?)`, the one expression `sh()` spawns with. `containedTools.ts` exports `insideOf` and `busUnder`. Nine new rows, H18-1 to H18-9.
- **Task 2.** W18-a's stub users (D-5249): `ccd-pool-sync.test.ts` and `pool-accounts-route.test.ts` write their curl stubs through `stubContainedTool` (into `harnessBin`, replacing the poison) instead of into `<home>/bin`, where they lost to the poison on PATH order (4 reds, measured). `ccd-pool-sync`'s three own runners ask `net`, its `afterEach` reds a test that reached the curl poison, and one new row pins the plant after a cleanup.
- **Task 3.** W18-b, R14(b) (D-5250, D-5251, D-5253): a new `server/test/raw-spawn-census.test.ts` reads every spawn in `server/test` and `agent/test`. A spawn that EXECUTES the ccd or ccrc script with a bare env (none, `process.env`, or the parent's env spread with no builder after it) is a hit; one that runs text SLICED from a script with a bare env is counted on its own list. The seven hits the prototype found in unclaimed files are fixed (`projected-home`, `ccrc-memory`, `runbook-holds`); the one in a claimed file (`ccrc-doctor.test.ts`) and every sliced one are on reasoned lists pinned both ways. `ccrc-containment.test.ts`'s header and census comment stop calling the scan residue.
- **Task 4.** W18-c, R23(a): `containedTools.ts`'s two "a closed stdin is an empty config" sentences say "under dash" and name bash's hang. Prose only.
- **Task 5.** W18-d and W18-e, R23(b) and (d): the two fail-closed rows assert the refusal log holds ONLY the refusal record; a new `refusedCfg` row feeds a LEADING blank line.
- **Task 6.** The importer census (D-5252): every test file that reaches `ccdWsHelpers.ts`, run on the base (in Task 0) and on the wave, the per-file counts compared, and the reach logs read.
- **Task 7.** The gate and the PR.

**Live effect.** None. Deploy class "none (tests)": no shipped file changes (`ccd/`, `server/src`, `agent/src`, `shared/`, `deploy/`, `pwa/src` are untouched), so a merge releases a build byte-identical in behaviour, and nothing moves on either box beyond the ordinary patch-per-merge prerelease.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ] `) syntax for tracking.

**Goal:**
- every spawn through `makeCcdHarness`'s env, and every spawn a harness user builds on its own `ghContainedEnv(h.home, …)`, finds the poison for `ssh`, `scp` and `curl`. The creation-time plant lives in the same `harnessBin`; `ccd-pool-sync`, the one module-level harness whose HOME is removed after every test, asks `net` at its own sites. No `systemd` caller of `ghContainedEnv` hands a spawn the operator's user bus. A red suite says so the moment an edit re-opens either;
- every spawn of the real `ccd/ccd` or `ccd/ccrc`, or of text sliced from them, in either test tree gets a contained env, or is named, counted and reasoned in one of two lists that red when they go stale;
- the curl front's prose is true under both shells, and its fail-closed rows pin exactly what they claim.

**Architecture:**
- No ring changes. No shipped source changes. Only `server/test` changes.
- **`server/test/ccdWsHelpers.ts`** *(revised, unmeasured)*: imports `CONTAINED_TOOLS`, `busUnder` and `plantPoison` from `./containedTools.js` (that file imports only `node:*`, so there is no cycle); `ContainOpts` gains `net`; a module-level `NET_TOOLS`; an exported `stubContainedTool`; the early return tests three flags; the bus pair follows `systemd`, spread after the caller's env unless `busUnder` keeps the caller's; `CcdHarness.env`; `makeCcdHarness` asks `{ systemd, tmux, net }` at its two sites, and `sh` is built from `env`.
- **`server/test/containedTools.ts`**: `insideOf` and `busUnder` exported, and `assertNoRealTool` reads `insideOf` (Task 1, *revised, unmeasured*); two comment lines become four (Task 4).
- **`server/test/ccd-harness-containment.test.ts`**: one new describe, H18-1 to H18-9.
- **`server/test/ccd-pool-sync.test.ts`**: five stub sites go through `stubContainedTool`; its three own runners ask `net`; the `afterEach` reads the curl poison's record before the cleanup; one new row. **`server/test/pool-accounts-route.test.ts`**: `syncInto` goes through `stubContainedTool` and asks `net`.
- NEW **`server/test/raw-spawn-census.test.ts`** (seven rows). Its name does not start with `ccd` (`ccd-workspaces.test.ts`'s scan reads `^ccd.*\.ts$`), and it never spells the ccd script's path as two quoted adjacent segments (`single-definition.test.ts`'s `NAMES_CCD` allows exactly one file to).
- **`server/test/projected-home.test.ts`** (one builder, `phEnv`, and a row), **`ccrc-memory.test.ts`**, **`runbook-holds.test.ts`**: their bare spawns get a builder.
- **`server/test/ccrc-containment.test.ts`**: one new row, two assertions tightened, three comment edits.

**Tech Stack:**
- vitest 4.1.10 in `server/`; TypeScript on node `>=22.13.0`; no new dependency. A batch's worker cap is `--maxWorkers`, a vitest 4 top-level option (`server/vitest.config.ts:24-28`).
- The poisons are `#!/bin/sh` `printf`/`exit 97` scripts (`plantPoison`), which run under dash and under macOS's bash-as-sh alike.
- `assertNoRealTool(env, home)` (`containedTools.ts`) requires every `CONTAINED_TOOLS` name to resolve inside HOME and `XDG_RUNTIME_DIR` and `DBUS_SESSION_BUS_ADDRESS` to be SET and to name paths under HOME.

**D-refs this plan cites as they stand:**
- wave 9's R10d and R9-F8 (the ccrc builders' structural containment: `CONTAINED_TOOLS`, `plantPoison`, `assertNoRealTool`, `ccrcContainedEnv`);
- wave 13's curl front (`loopbackCurlFront`) and its fix round 1 (review 294 F1, F2), whose rows Task 5 edits.

## Not in this wave

Reviewers: do not raise these.

- **The second ring (D-5253), narrower since the revision.** Three groups keep part of their reach after this wave, by design. None is seen by the census, because they are builder calls, not bare envs. Each is that builder file's own pin, for a later wave (Reading 3).
  - About 79 files and 155 call sites use `ghContainedEnv` directly, without `makeCcdHarness`. 98 of those sites pass `process.env` with `{ systemd: true, tmux: true }`. They get the fixture bus from this wave, because the bus follows `systemd`, but they keep the real `ssh`, `scp` and `curl`: five of those files run a functional curl from outside `harnessBin`, or the real one against a loopback listener, and `net` for every `systemd` caller measured 91 reds in three of them (D-5247).
  - About 35 spawns in 10 `ccrc-*` files have builders that are `ghContainedEnv(process.env)` with no `systemd`. They keep the real bus and the real network tools.
  - A harness user's own `ghContainedEnv` on a HOME that is not the harness's (a second `mkTmp`) has no creation-time plant.
- **A text pin of the two harness sites in `ccd-workspaces.test.ts`'s scan.** The scout considered a `net: true` clause in that scan (`:1428-1499`). It would demand the flag at 107 bash-spawn sites in 56 `ccd*.ts` files. The behaviour rows H18-1 to H18-6 red on removing `net` from either site (rows T1-1, T1-2) or on losing the bus (T1-3, T1-4), which is what a text pin would hold.
- **Fixing the hits in claimed files, and the sliced class.** `ccrc-doctor.test.ts` (claim 1499, run 360) is on `ALLOWED` (Task 3). Every bare SLICED spawn, `ccrc-install.test.ts`'s `_inst_installed` harness among them (the spawn R14(b) named), is listed in `SLICED_ALLOWED` with its reason and count, not fixed (D-5251).
- **Routing the second ring's direct curl stubs through `stubContainedTool`** (`ccrc-api.test.ts`, claimed; `ccrc-token-sync.test.ts`). They ask no `net`, so no poison of this wave's displaces them (D-5249).
- **Other inherited variables:** `TMUX`, `TMUX_PANE`, `SSH_AUTH_SOCK`, `CLAUDE_CONFIG_DIR` and `GIT_CONFIG_GLOBAL`/`SYSTEM` still pass through `inheritedEnv()`. Among them, `ccd/ccd` reads only `SSH_CONNECTION` (informational, `:4550`) and `GIT_CONFIG_GLOBAL`, a residual `gitEnvStrip.ts` already states.
- **R23(c) and (e).** They are the docs PR's (ledger row "docs PR").
- **Making `sweepFixture.ts`'s Darwin helper cases plain `it`.** Wave 16's Reading 9 named wave 18 as a possible home, but it is not in R14 or R23 and the brief's items do not name it. The coordinator may scope it later.

## Global Constraints

- **Tests only.** No file under `ccd/`, `server/src`, `agent/src`, `shared/`, `deploy/`, `pwa/src`, `install.sh` or `.github/` changes. The scope check prints nothing:

      git diff --stat origin/main...HEAD -- ccd shared server/src agent/src pwa deploy install.sh .github README.md CLAUDE.md \
        server/test/ccrc-doctor.test.ts server/test/ccrc-install.test.ts server/test/ccrc-update.test.ts \
        server/test/ccrc-cli.test.ts server/test/install-census.test.ts server/test/ccrc-api.test.ts \
        server/test/session-hook.test.ts server/test/historyHelpers.ts server/test/macos-platform.test.ts \
        docs/superpowers/specs docs/superpowers/programs

  `git diff --stat origin/main...HEAD` lists exactly File structure's New and Changed files, plus any file a reserve D-number added to the claim set (Task 3 Step 3).
- **Claims (ccrc-worker clause 11).**
  - Before the first edit, claim exactly these paths in one all-or-nothing call: `server/test/ccdWsHelpers.ts`, `server/test/ccd-harness-containment.test.ts`, `server/test/ccd-pool-sync.test.ts`, `server/test/pool-accounts-route.test.ts`, `server/test/raw-spawn-census.test.ts`, `server/test/projected-home.test.ts`, `server/test/ccrc-memory.test.ts`, `server/test/runbook-holds.test.ts`, `server/test/containedTools.ts`, `server/test/ccrc-containment.test.ts`, and this plan's file. A 409 stops the wave: mail the holder through the response's `mailHint`, and the coordinator.
  - Live at 23:59 UTC on 2026-10-16 *(reviser, measured; `ccrc-api claims list --project ccrc-pwa`, a read)*: 1495, 1496, 1497, 1518 (run 468), and 1498 to 1504 and 1512 (run 360). This is the same set as at 22:57, and none of them names a file this wave writes. Claims 1477 (run 484) and 1478 (run 300), which were live at the brief, are no longer listed.
  - **Run-only files: never edit these.** This means every path a live claim names, in particular:
    - `server/test/ccrc-doctor.test.ts`, `ccrc-update.test.ts`, `install-census.test.ts`, `ccrc-install.test.ts` and `ccrc-cli.test.ts` (claim 1499);
    - `ccrc-api.test.ts` (1500);
    - `session-hook.test.ts` and `lifecycle.test.ts` (1495);
    - `historyHelpers.ts` (1518);
    - `history-ingest.test.ts` (1497).

    Also run-only, by this plan's choice: `sweepFixture.ts`, `ccd-supervised-start.test.ts`, `macos-platform.test.ts` (claimed at the brief), `single-definition.test.ts`, `ccd-workspaces.test.ts`, `ccrcContainment.ts` and `gitEnvStrip.ts`. None of them needs an edit: Task 6's census measured them green after the prototype's change.
  - **Open PRs, unclaimed:** #435 (run 308, session continuity W4b, awaiting review, its claim lapsed) changes `server/test/ccdWsHelpers.ts` in one hunk at `:659` (`BOUNDED`), disjoint from this wave's. It also changes `ccrc-doctor.test.ts`, the file `ALLOWED` counts in. An attack pass measured a three-way merge of the prototype's `ccdWsHelpers.ts`, the base and #435's version: rc 0, with no conflict markers. It also ran the prototype census over every open PR head (#448, #435, #425, #410, #397, #444, #441) and found no new bare hit. Task 7 Step 1 says what to re-run if #435 lands first.
  - Re-read the claims, and `gh pr list --state open` with `gh pr view <n> --json files` (reads), before the first edit, before each task's edit step, and before the push. If a new claim names a file this wave writes, stop and mail the coordinator. If an open PR newly touches a file in File structure, name it in the wave-done.
- **Anchors.** Every anchor is measured at `256b25ecb` and quoted. Step 1 of each task re-measures its anchors by their QUOTED TEXT (`grep -nF`) on the tip being built, after `git fetch origin main`. The quote wins over the number. Find code with graphify first (`graphify query "…"` over `graphify-out/`), then confirm with `grep -nF`. The diffs marked *(revised, unmeasured)* were hand-revised from the prototype's: their hunk offsets are approximate, and their quoted context lines are the anchors.
  - Before any edit that moves lines, run `git grep -nE '(ccdWsHelpers|containedTools|ccrc-containment\.test|ccd-pool-sync\.test)\.ts:[0-9]' -- server agent ccd shared deploy`.
  - The prototype found seven citations into `ccdWsHelpers.ts`: `ccd-update-sync.test.ts:159`, `ccd-ws-gc.test.ts:1049`, and `ccrc-account.test.ts:77`, `:175`, `:182`, `:630`, `:740`. All of them were already stale at the base (they name lines the base holds other text at; measured), and none is machine-checked. This wave does not chase them (Reading 5).
- **Scratch.**
  - Before the first task, set `SCRATCH=<this session's scratchpad directory>/w18` and run `mkdir -p "$SCRATCH/good" "$SCRATCH/res/before" "$SCRATCH/res/after"`. Results, `.good` copies and logs go there. Never put them under the checkout or the work volume.
  - **The vitest TMPDIR is a SHORT directory:** `T=$(mktemp -d /tmp/w18.XXXXXX)`, and `TMPDIR="$T/<phase>-<batch>"` (or `"$T/one"`) on every vitest call *(revised, unmeasured)*. A scratchpad path runs to about 120 characters, and a TMPDIR that long is what made five rows red in both of the prototype's phases: `ccd-entry-install` refuses a shebang over 127 bytes (Task 6 Step 4).
  - A tmp reaper on a long-lived box may remove files older than 12 hours, so re-create `$T` for each phase.
  - Every subagent brief carries the same values.
- **Memory.** The box's session slice runs near its cap. This wave's drafter and its first finisher both died of it while vitest batches ran. So:
  - Run one vitest file per call unless a step names a batch.
  - Every batch carries `--pool=forks --maxWorkers=2`. vitest 4 removed `poolOptions`: the CLI rejects `--poolOptions.forks.maxForks` before any test runs (`CACError: Unknown option --poolOptions`, exit 1, measured by an attack pass), and `server/vitest.config.ts:24-28` says the same.
  - Before each batch, read the slice's `memory.current`. Above 21 GB, wait: re-read once a minute (a Monitor until-loop, never a foreground `sleep`) for at most 30 minutes. If it is still above the bar, stop the batch work, and use the fallback the step names (CI, Task 7 Steps 4 and 5). The wave-done says which batches did not run, with the readings.
  - Never run two vitest commands at once.
- **Fixture HOMEs only.**
  - Every case that runs or sources `ccd/ccd` or `ccd/ccrc` runs on a `mkTmp` HOME, with its env built by `ghContainedEnv` (`makeCcdHarness`) or `ccrcContainedEnv`. The census (Task 3) makes that a red suite for every new spawn.
  - Never run real `tmux`, `systemctl --user` against the live manager, `launchctl`, or a `claude-session@*` unit.
  - Never run `ccd` verbs against the live HOME, `ccrc update`/`rollback`/`rollout`/`install`, or `deploy.sh`.
  - Never read `~/.cc-secrets` or `~/.ccrc/mail.token`.
  - **Writes through `gh` and `ccrc-api` are the worker protocol's only:** acking the brief; this wave's claims and their release; mail to the coordinator; `gh pr create`/`gh pr edit` for this wave's PR; and `gh workflow run ci.yml --ref <this branch> -f mode=full` in Task 7. Never `gh pr merge`, never another branch's PR, and never a ledger POST (the D-numbers are issued).
  - Never `pkill`, `killall` or `pgrep -f`.
- **The importer census is a gate** (Task 6). A change to `ccdWsHelpers.ts` moves every file that reaches it. What says nothing moved is the per-file before/after comparison over the whole set, not the touched suites alone. The reach logs are what say nothing reached a real tool.
- **Mutation-table discipline.** Every guard ships with a case that reds when the guard is removed or mutated, and the red is measured.
  - Before each mutation: `cp <file> "$SCRATCH/<row>-<name>.good"`. Never `git checkout --`, never a bare `git stash`.
  - Apply the mutation, run the named command, restore with `cp`, check with `cmp`, and confirm `git status --porcelain` shows only this wave's files.
  - A row is done only with a measured red set and the assertion that fired. Each row lists its full expected set; a measured set that differs is reported, never accepted silently. A spawn timeout is "code -1", a suite hang "killed by timeout(1)", never "red".
  - When a mutant puts a quote inside a TypeScript string, escape the quote: the scout's first unescaped single quote inside a `containedTools.ts` string broke the TS transform, not the row.
- **D-numbers.**
  - This plan defines D-5247 to D-5253, in order, from the block issued to run 517 (5247 to 5266), in `## Deviations found`.
  - **The worker's reserve is numbers 5254 to 5258.** Take them in order, and define each in `## Deviations found` in the commit that first cites it. Numbers 5259 to 5266 are not used by this plan or the worker; they stay with the coordinator.
  - Never write a number outside the block, and write an unspent one bare, without its `D-`. Never call the allocator. Never land a `D-TBD-` spelling. A code comment that a departure governs names its number.
- **Suites.**
  - Run each file in the foreground, inside `server/`, with a timeout of at least 600000 ms: `TMPDIR="$T/one" ./node_modules/.bin/vitest run test/<file>.test.ts [-t "<pattern>"]`. Never bare `npx vitest`.
  - Known load flakes (CLAUDE.md's list) are re-run IN ISOLATION before a red is called a break. Task 6 records three reds seen in both phases that pass in isolation with the default TMPDIR, and two one-phase reds that pass in isolation.
- **No residue in tracked text:** no hostname, username, account or lane name, absolute home path, mount path, docserver URL or org name. Run `topology-clean.test.ts` after the `git add` of each new or changed file.
- **Commits.** Commit on the workspace branch only, at least once per task: `docs(update): …` for the plan (Task 0 Step 3, before any commit that cites its numbers), and `test(update): …` for every other task. Never a separate feature branch. Author and committer are the noreply identity. Send the wave-done in the same turn as the push, and never end a turn to wait on CI.

## Review Focus

1. **The harness is contained for every `CONTAINED_TOOLS` name and for the bus, structurally** (Task 1).
   - Both `makeCcdHarness` sites ask `{ systemd: true, tmux: true, net: true }`: the creation call and `env()` (every `sh()`). Rows T1-1 and T1-2 drop `net` from each site alone, and each reds a different row.
   - A test that spawns with its OWN `ghContainedEnv(h.home, …)` gets the net poisons only because the creation-time plant sits in the same `harnessBin`, and only while that HOME survives. About 45 harness-user files carry such sites (about 77 of them), all asking `systemd` *(reviser, measured: 43 files and 76 sites by `grep -cE 'ghContainedEnv\('` over the files that call `makeCcdHarness(`; an attack pass counted 46 and 79 over every file that names it)*. The one file whose harness outlives its HOME, `ccd-pool-sync`, asks `net` at its sites (Task 2). Is there another?
   - The bus pair follows `systemd`, so it reaches every one of those own-env sites and the second ring's 98 `systemd` sites too. It is spread AFTER the caller's env, so `h.sh(snippet, { XDG_RUNTIME_DIR: '/run/user/0' })` still sees the fixture (H18-6). A caller's pair stands only when BOTH values name paths under HOME (`busUnder`, H18-8). It is SET, never deleted: `ccd/ccd:1640` turns an absent `XDG_RUNTIME_DIR` back into the real `/run/user/$(id -u)` (D-5248).
   - `net` stays opt-in in `ghContainedEnv` (H18-7). Is any path left where a harness spawn finds a real `ssh`, `scp` or `curl`?
   - `CcdHarness.env` is a new interface member. Every implementer was found by `grep -n "CcdHarness\b"`, and `tsc -p test/tsconfig.tests.json --noEmit` exits 0 *(prototype)*. `makePrHarness` and the fixture helpers wrap `makeCcdHarness` rather than implement the interface.
2. **No stub that a test relies on is silently displaced** (Task 2, Risk notes). Every functional net-tool stub this wave touches goes through `stubContainedTool`, so an opt-out is greppable. In `ccd-pool-sync`, where most rows assert only an absence (a refusal writes nothing), the `afterEach` reds any test the curl poison answered. Is a green `ccd-pool-sync` row now proof its stub answered?
3. **The census decides by rule, per call, and cannot pass vacuously** (Task 3).
   - A SPAWN is every spawn spelling the file's imports make. EXECUTES keys on the argument text naming a script: a literal path, a path-only binding, a join onto a binding of the scripts' directory, an import or namespace member, or a `for … of` variable. SLICED keys on a binding derived from a read of a script (D-5251).
   - BARE is R14(b)'s three shapes, in more spellings: a cast, a spread options object, `Object.assign`, a parameter's default, and the parent's env spread after a builder. A builder call after the parent's env, a member such as `b.env`, a parameter with no default and a helper-function call are not BARE (D-5253).
   - Its first row pins `ROOTS` literally and asserts more than 5 sources per tree, the harness's `CCD` export, and more than 100 executing spawns. Its fourth row forces every program a script-naming spawn uses into `RUNNERS` or `READERS`.
   - Its last row runs the census on a fixture corpus whose every line names the verdict it must get. So each detector branch has a standing mutation pin (T3-1a to T3-1n), not a scratch module deleted after one run.
   - `ALLOWED` and `SLICED_ALLOWED` are pinned both ways (T3-2, T3-3, T3-3s), and every reason is non-empty.
4. **The prose of Task 4 is true on both shells** (measured, below). Task 5's two rows now fail on a second record (row T5-1), and the old `toContain` stays green on the same mutant (row T5-1c).
5. **The importer census and the reach logs** (Tasks 0 and 6). The prototype measured 282 files, 12389 passing before and 12400 after, the delta exactly its eleven new tests, and explained its one-phase reds. The revised wave adds fifteen *(revised, unmeasured)*. The before log names every test that reached a real tool or the real bus at the base, and the after log should hold none from a harness HOME.

## Risk notes

- **A test that silently relied on a real tool.** The harness change poisons `ssh`, `scp` and `curl` for every `makeCcdHarness` user. On the prototype's 282-file set, the only tests whose counts moved were the four Task 2 relocates *(prototype)*. That is not proof that nothing reached a real tool: a test that reached one and tolerated the failure (an `rc != 0` check, an "unmeasured" sentence) is green in both phases, and the comparison cannot see the bus at all. Task 0 measures the reach directly. Spies on vitest's own PATH sit after `harnessBin` and before `/usr/bin`, and log `HOME | tool | argv` before exec'ing the real binary. A `BASH_ENV` logger records every bash that starts with a real or absent `XDG_RUNTIME_DIR`.
  - How a future reach is found: the poison exits 97 and records its argv at `$HOME/<tool>-poison`, so a test that needs a real tool reds on its first call rather than passing on the network. H18-2's `assertNoRealTool(h.env(), h.home)` reds when any `CONTAINED_TOOLS` name stops resolving inside HOME, and `ccd-pool-sync`'s `afterEach` reds a test the curl poison answered.
- **The bus now follows `systemd` for every caller** *(revised, unmeasured)*. That is about 175 sites, where the prototype's opt-in `bus` reached only two. By grep, no test outside 11 files names either variable *(reviser, measured)*. Of those 11:
  - `ccd-tmux-anchor` and `macos-platform` pass the same fixture pair under HOME, which `busUnder` keeps.
  - `ccd-version` assigns its own pair after `ghContainedEnv` returns.
  - `scope-sweep`, `measure-continuity-stage6` and `installTreeFixture` do not go through `ghContainedEnv`.
  - No test asserts a real `/run/user` value through it.

  One reader matters: `ccd/ccrc-doctor-checks:7583` reads the scope-sweep verdict record under `${XDG_RUNTIME_DIR:-/run/user/$(id -u)}`. So a test that passed because the operator's live record existed would turn red under the fixture bus, and that red is a finding, not a regression (Task 1 Step 3's fallback). Task 6's after phase is the whole-set measurement, and Task 1 Step 3 runs the most exposed files first.
- **Silent coverage loss in stub users.** A displaced stub can leave a row green: a `ccd-pool-sync` row that asserts only that nothing was written passes just as well on the poison's 97. The prototype's T1-7 measured the old reason it held, which was that the pool files' own runners did not ask `net` and the creation plant was gone after the first test. The revision makes the runners ask `net`, so the poison is now present at every test. The new `afterEach` therefore reds a test the poison answered, and Task 2 Step 3 reads each relocated row for a side effect besides.
- **The rejected wider shape.** `net` and `bus` for every `systemd: true` caller of `ghContainedEnv` (H3) measured 116 reds in five files before Task 2's relocation, and 91 in three after: `ccd-update-sync` 37, `ccrc-api` 53 (real loopback curl), `ccrc-token-sync` 1 *(prototype)*. Every one of those reds was a curl red (the first assertion: "unmeasured — curl exited 97"); the bus never ran on its own. So `net` stays opt-in (D-5247), and the bus alone is the revised shape (D-5248).
- **The heavy files.** `ccrc-install`, `ccrc-update` and `ccrc-doctor` reach `ccdWsHelpers.ts`, but each runs past 590 s whole, so the prototype left them out (D-5252). None uses `makeCcdHarness`'s env: their spawns go through `ccrcContainedEnv`, `installTreeFixture` or literal envs. They do reach `ghContainedEnv`, whose early return gained a clause and whose `systemd` arm now sets the bus. Their before and after is CI's (Task 7 Step 4).
- **Darwin.** `ccd/ccd` skips the bus-defaulting block on darwin (`ccd/ccd:1639`, `[ "$CCD_OS" != darwin ]`), and `ccd/ccrc`'s `_box_units` skips its pair there too (`:3339`), so the fixture pair is inert. `macos-platform.test.ts:1043-1044` already sets the same fixture values.
  - The poisons are `#!/bin/sh` and run under macOS's bash-as-sh. macOS ships `/usr/bin/ssh`, `scp` and `curl`, so the poisons shadow real binaries exactly as on Linux.
  - `assertNoRealTool` and `busUnder` resolve `/var` to `/private/var` through the realpath of HOME (`insideOf`).
  - Nothing here was run on a Mac. `test-macos` runs only on the daily, dispatched and stable-gate full runs, advisory and flaky by ruling. A `ccdWsHelpers.ts` change selects nearly every server test there too, where spawns are several times slower. R23(a) is itself a macOS fact (Task 4).
- **CI selection.** A change to `ccdWsHelpers.ts` makes the PR's selection run nearly every server test (about 235 importers, 278 by transitive reach), so the PR's `test (server)` is close to a full run. The census reads every file under both trees. Whether `select-tests.mjs`'s READ rule traces that walk is not measured here, so a later PR that edits a test file may or may not be selected to run the census. Task 7 Step 7 reads the summary.
- **A count pinned in a file another run edits.** `ALLOWED` and `SLICED_ALLOWED` pin exact counts in `ccrc-doctor.test.ts` and `ccrc-install.test.ts`, and run 360's open fix round (claim 1499) is editing both. If run 360's PR lands after this wave and adds, moves or fixes a bare script spawn there, it reds on this census (Reading 4).
- **Line moves.** `ccdWsHelpers.ts` grows by about 45 lines at `:340` and below. `containedTools.ts` grows by about 18 lines near `:182`, below Task 4's anchors. `ccrc-containment.test.ts` grows by 2 at `:281`, `ccd-pool-sync.test.ts` changes near its top and at its five stub sites, and `ccrc-memory.test.ts` grows by 14 near its top. No machine-checked corpus cites those files (Anchors).

## Deviations found

These are departures from the brief, the ledger, or what shipped text at `256b25ecb` documents.

- **D-5247** — *The `ssh`, `scp` and `curl` poisons are an opt-in `net` flag of `ghContainedEnv` that `makeCcdHarness` asks for, not containment for every `ghContainedEnv` caller.*
  - **The brief:** "the ccd harness (makeCcdHarness, ghContainedEnv, harnessBin) gets the same structural containment the ccrc builders have".
  - **Measured:** `net` and `bus` together for every `systemd: true` caller red 116 tests in five files at `256b25ecb` (91 in three after Task 2's relocation). Those suites run a functional curl from a directory of their own, or the real one against a loopback listener *(prototype)*. Every red was a curl red. So `net` keeps the opt-in shape `systemd` and `tmux` already have, and the harness asks; the bus is decided separately (D-5248). The 79 direct `ghContainedEnv` files keep their reach to the network tools (Not in this wave; D-5253).
  - **The shape:** `plantPoison` is create-if-absent, so a stub a test writes into `harnessBin()` first replaces the poison and is kept (H18-5). That is the idiom `harnessBin`'s own docstring names, and `stubContainedTool` is now its one door (D-5249).
- **D-5248** — *The user bus follows `systemd`: every caller that asks for the manager poisons gets the pair SET to two paths under HOME that do not exist (`<home>/no-runtime-dir`, `unix:path=<home>/no-bus`), after its env, never unset; a caller's own pair stands only when both values name paths under HOME* (revised; the prototype measured an opt-in `bus` flag asked by the harness alone).
  - **The brief:** "no real XDG_RUNTIME_DIR or DBUS_SESSION_BUS_ADDRESS reaches a ccd spawn (a fixture value or unset, whichever ccd's code paths tolerate — MEASURE which paths read them)".
  - **Measured readers** *(reviser, measured by grep over `ccd/` at `256b25ecb`)*:
    - `ccd/ccd` reads the pair in one place, `:1640-1641`: `: "${XDG_RUNTIME_DIR:=/run/user/$(id -u)}"` and its DBUS twin. Its only consumers are the poisoned `systemctl --user` and `systemd-run`.
    - `ccd/ccrc` defaults the same pair in seven places: `:3342`, `:5812`, `:10904`, `:15322`, `:20552`, `:21225` and `:23073`. `ccd/ccrc-doctor-checks` does so at `:914-915`.
    - `ccd/ccrc-doctor-checks:7583` reads the scope-sweep verdict record under `${XDG_RUNTIME_DIR:-/run/user/$(id -u)}`: under a real bus, that is the operator's live file.
    - `ccd/ccd-scope-sweep:140-142` refuses unless `$XDG_RUNTIME_DIR` is a directory, and then WRITES `$XDG_RUNTIME_DIR/ccd-scope-sweep.state`.
  - **Why set, not unset:** unset, every defaulting line turns the variable back into the real path, and `ccd`'s default forks `id`. On a stripped PATH that prints `id: command not found`, which `ccd-version.test.ts:53-68` works around. A fixture value is exported unchanged. `ccrcContainedEnv` sets the same pair the same way (`ccrcContainment.ts:20-37`).
  - **Why `systemd`, not a flag:** the managers are what read the bus, and every one of the prototype's 91 wide-shape reds was a curl red, so nothing measured argues for keeping the bus opt-in. Tying it to `systemd` closes the bus for the harness users' own-env sites (about 77) and the second ring's 98 `systemd` sites in one move. It is *(revised, unmeasured)*: Task 1 Step 3 and Task 6's after phase measure it.
  - **The fallback:** if a red is a test that needs the real bus for a reason the wave accepts, revert to the prototype's opt-in `bus` flag (Task 1 Step 3 names it). Record that under a reserve number, with the reds.
  - **Why the in-HOME exception:** a future harness test of a runtime-dir consumer (`ccd-scope-sweep`, the doctor's record) must be able to hand it a real fixture directory. A forced `no-runtime-dir` would send it down the refusal path silently. `busUnder` is exactly the condition `assertNoRealTool` refuses the negation of. H18-6 pins that a real pair is still overridden, and H18-8 pins that a half-inside pair is overridden too.
- **D-5249** — *A functional stub of a contained tool goes through one named door, `stubContainedTool(home, name, body)`, which writes into `harnessBin(home)` (replacing the poison) and refuses a name outside `CONTAINED_TOOLS`. The two pool files route their curl stubs through it, `ccd-pool-sync`'s own runners ask `net`, and its `afterEach` reds a test the curl poison answered* (revised; the prototype relocated the raw writes).
  - **The brief:** "with an explicit, named opt-in stub for any test that needs one".
  - **Measured** *(prototype)*: with Task 1 alone, four rows red: `ccd-pool-sync`'s "writes the projection from a 200", and `pool-accounts-route`'s three C1 and W1 writer-output rows. A stub in `<home>/bin` loses to the poison in `<home>/.local/bin`, which `ghContainedEnv` prepends. With the stub in `harnessBin`, all four pass.
  - **Why `ccd-pool-sync` asks `net` itself** *(attack, measured by reading; revised, unmeasured)*:
    - Its harness is module-level (`:7`), and `afterEach(() => h.cleanup())` (`:8`) removes HOME, so the creation-time plant is gone for every test after the first. Its three runners (`:81`, `:374`, `:390` at the base) asked `{ systemd: true, tmux: true }` and re-created `harnessBin` without the net poisons.
    - So only the first test, "writes the projection from a 200", ever met the poison, and the prototype's victim set was a test-order artefact.
    - With `net` at the runners, every non-stub curl path gets the poison back. A stub written first is kept, by create-if-absent.
  - **Why the `afterEach`:** most of that file's rows assert an absence (a refusal writes nothing), which a poisoned curl satisfies too. Reading the poison's record before the cleanup turns a displaced stub, or a curl that ran with no stub, into a red.
  - **Not routed:** the second ring's existing direct writes of a curl into `harnessBin` (`ccrc-api.test.ts:431`, `:462`, claimed; `ccrc-token-sync.test.ts:97`). Their runners ask no `net`, so nothing of this wave's displaces them.
  - **Why no `except` list:** relocation through the named door uses the idiom `harnessBin`'s docstring already names, and `net: { except: […] }` would be a second door to the same place.
- **D-5250** — *R14(b)'s census is a new file over BOTH test trees, keyed per call on a spawn EXECUTING a script file. A SPAWN is every spelling the file's imports make. Its only `ALLOWED` entry is the one hit in a claimed file the prototype measured, and any hit the revised spellings add is fixed or listed by the rule in Task 3 Step 3.*
  - **The ledger** (R14(b)): "a census scan for raw `ccd/ccrc` spawns (no `env`, `env: process.env`, `{...process.env, HOME: dir}`)".
  - **Measured** *(prototype)*: a lexical "names the script and has no env" rule hits 129 bash spawns that run no script (`command -v`, flock holders, `sort -V`), plus source-text reads (`git show`, `git ls-files`, `readFileSync`). So the census keys on EXECUTION: the argument text names a script, and the program is a runner (`'bash'`, `BASH`, `DEADLINE_BIN`, `DOCTOR_DEADLINE_BIN`), never a reader (`'git'`). On the prototype's bare-name rule it counted 1183 spawns, 173 that execute a script in 73 files, none in `agent/test`.
  - **The spellings the prototype missed** *(attack, measured by grep and by a standalone run of the prototype census)*:
    - node-pty `pty.spawn` (8 files; five spawns run the ccrc script: `ccrc-expose.test.ts:184`, `ccrc-passwd.test.ts:112` and `:643`, `ccrc-account.test.ts:1029`, `ccrc-install.test.ts:5999`);
    - six `import * as <ns> from 'node:child_process'` namespaces;
    - four aliased imports (`spawnSync as spawnSyncT6`, `execFileSync as t14execFile`/`t15execFile`, `spawnSync as libGrepSpawn`);
    - `exec`;
    - a path built in two steps (`updateRealBox.ts`'s `CCRC_SRC = path.join(CCD_DIR, 'ccrc')`, in both trees);
    - a namespace member (`import * as X from './ccdWsHelpers.js'`, four files);
    - a `for … of` variable.

    None of those is a bare hit today: each passes a helper-built env. The revised census reads them all. It counts 1215 spawns, 181 that execute a script in 75 files, none in `agent/test`, and 24 that run sliced text, at `256b25ecb` and on the prototype tree alike *(reviser, measured standalone)*. On the prototype tree it finds no `ALLOWED` hit beyond `ccrc-doctor.test.ts:8375`.
  - **The hits at `256b25ecb`** *(prototype)*: `projected-home.test.ts:47` and `:658`; `ccrc-memory.test.ts:18`, `:405`, `:932` and `:960`; `runbook-holds.test.ts:152` (all fixed); and `ccrc-doctor.test.ts:8375` (claim 1499: allow-listed).
    - That last spawn sources `ccrc` and calls `_box_role`, which reads only the preset `BOX_UNITS` array (`ccd/ccrc:3378-3379`). Measured under `env -i`, with HOME a path that does not exist and PATH an empty directory, `BOX_UNITS=(active inactive); _box_role` printed `server (inferred from the units below, not declared — no box records its own role yet)` with rc 0, so no tool runs *(prototype)*. The scout's reading that it reaches the real bus is refuted.
  - **The fix in each file** uses the builder its neighbours use:
    - `ghContainedEnv(…, { systemd, tmux, net })` for `projected-home`'s two `source CCD` helpers, through one `phEnv` and an `assertNoRealTool` row;
    - `ccrcContainedEnv(home, process.env, { managers: true, curl: 'poison' })` plus an `assertNoRealTool` for `ccrc-memory` and `runbook-holds`, whose stub PATHs now prepend to the CONTAINED PATH, never the parent's.
- **D-5251** — *A spawn that runs text SLICED from a script executes no script file, so it is not an `ALLOWED` hit. Its class is still ENUMERATED: a bare one is listed in `SLICED_ALLOWED` with its reason and exact count, pinned both ways. `ccrc-install.test.ts`'s `_inst_installed` harness, the spawn R14(b) said the census "also covers", is one entry, and its own row pins that it is classified sliced* (revised; the prototype declared the class out of scope and pinned only that one spawn).
  - **Why:** the census cannot decide such a spawn's reach from its argument text, because the slice may or may not call a contained tool. A list makes a new one a decision rather than a pass. The R14(b) spawn was already refuted as harmless: it reads `CCRC_UPDATE_VERIFIED` and `CCRC_UPDATE_SPINE` from the inherited env, and runs no contained tool.
  - **The members** *(reviser, measured standalone)*: 12 bare sliced spawns in 6 files, the same at `256b25ecb` and on the prototype tree.
    - `ccrc-doctor.test.ts:9737` (`_exp_env_write` with `_ccrc_die` and `_upd_redact`; `{ ...process.env, HOME: home }`);
    - `ccrc-install.test.ts:6641` (`_ver_newer`) and `:6830` (`_inst_installed`), both with no env;
    - `continued-in-parity.test.ts:431` (ccd's jq program, handed in the env);
    - `deploy-env-guard.test.ts:268` (`_box_env_value`, no env);
    - `macos-platform.test.ts:430`, `:516`, `:769`, `:1038` and `:1370` (the platform block);
    - `update-semver.test.ts:65` and `:68` (`_ver_newer`, no env).

    By reading, none of these runs a contained tool except against a stub: `:1038`'s payload refuses unless `systemctl` is the stub, and its bus is a fixture under HOME.
  - **Listed, not fixed:** three of the six files are claimed or run-only (`ccrc-doctor`, `ccrc-install`, `macos-platform`), and the other three (`continued-in-parity`, `deploy-env-guard`, `update-semver`) run version arithmetic, a key read or jq. The brief allows a named, reasoned list, and fixing a slice's env is that file's wave (Reading 7).
  - **One refinement the standalone run forced:** the first form of `slicedAt` skipped every binding whose NAME was a script name somewhere in the file. Script names are per file, so that hid `ccrc-doctor`'s `const src = readFileSync(CCRC_SRC)` at `:9722`. And an object-literal key (`harness({ run: hang })`) read as a use of an earlier sliced `run`, which made `update-killed-arms.test.ts:288` (a `mkfifo`) a false member. Both are fixed in the file below.
  - **Departs from** the scout's proposal to admit such spawns only when the slice names none of `CONTAINED_TOOLS`. The census keeps its rule to what the argument text proves.
- **D-5252** — *The local before/after importer run covers 282 files: the 278 `server/test` files that reach `ccdWsHelpers.ts`, minus `ccrc-install`, `ccrc-update` and `ccrc-doctor`, plus seven touched or guard files. It runs before on the untouched tip (Task 0), not by swapping base files into the workspace. The three heavy files are CI's to arbitrate. Not "175".*
  - **The brief:** "175 test files import ccdWsHelpers.ts, so the plan must census which of them a changed env or PATH could move, run every one before and after".
  - **Measured** *(prototype)*: 235 files carry an import of `ccdWsHelpers` at `256b25ecb` (124 import `makeCcdHarness`; 13 of them are helper modules), and 278 `.test.ts` files reach it transitively (188 of them reach `makeCcdHarness`). None is in `agent/test`, `shared` or `pwa`. The brief's 175 does not reproduce.
  - **The three heavy files** each run past 590 s whole on this box. No `-t` partition exists for `ccrc-doctor` or `ccrc-install` in any plan. They are under claim 1499 (run-only), and none spawns through `makeCcdHarness`'s env.
  - Their BEFORE is `main`'s latest trusted full suite (the daily `test (server)` or a dispatched full run at or after `256b25ecb`). Their AFTER is this PR's `test (server)`, whose `select tests` summary must list them, or a `mode=full` dispatch on the branch (Task 7 Step 4). CLAUDE.md makes CI the arbiter for a file it ran.
  - **Why Task 0:** an attack pass found that the prototype's before phase overwrote the wave's committed files in place with base copies, for an hour of batches, with no copy of the wave's versions. A session that died mid-phase would have left base content in nine files for the next commit to take.
- **D-5253** — *The census's BARE is exactly R14(b)'s three shapes, in every spelling the revised reader knows. Any builder call after the parent's env, an env member, a parameter with no default, and a helper-function call are outside it. The "second ring" (thin builders) is a named non-goal.*
  - **Why:** a stricter "must be `ccrcContainedEnv`" rule would hit about 35 spawns in 10 `ccrc-*` files whose own builders are `ghContainedEnv(process.env)` with at most a `gh` poison, and the allow-list would become the wave. Those builders are their own files' pins (Not in this wave).
  - **Measured limit** (row T3-7): reverting `ccrc-memory`'s `memEnv` to `({ ...process.env, HOME: home, ...extra })` is NOT seen by the census, because every spawn there passes `memEnv(…)`, a call. The file's own `assertNoRealTool(memEnv(), home)` row is what reds *(prototype)*. `projected-home`'s `phEnv` is the second such builder, with its own row (T3-9). The census header says so, and the fixture corpus pins `memEnv()` as not a hit.

## File structure

- **New:** `server/test/raw-spawn-census.test.ts`; this plan.
- **Changed:** `server/test/ccdWsHelpers.ts`, `server/test/ccd-harness-containment.test.ts`, `server/test/ccd-pool-sync.test.ts`, `server/test/pool-accounts-route.test.ts`, `server/test/projected-home.test.ts`, `server/test/ccrc-memory.test.ts`, `server/test/runbook-holds.test.ts`, `server/test/containedTools.ts`, `server/test/ccrc-containment.test.ts`.
- **Run only:** everything else (Global Constraints).

The prototype's diff at `256b25ecb`: `9 files changed, 181 insertions(+), 52 deletions(-)` plus the new census (measured, `git diff --stat`). The revised wave's is larger, and the worker records it.

## Tasks

### Task 0: Claims, the before phase on the untouched tip, and the plan's own commit (D-5252)

- [ ] **Step 1: Claims and open PRs** (Global Constraints). Claim the set. Read `gh pr list --state open` and `gh pr view <n> --json files` for every PR that touches a file in File structure. At 23:59 UTC on 2026-10-16 that was #435 alone, on `ccdWsHelpers.ts` *(reviser, measured)*.
- [ ] **Step 2: The before phase, before any edit.** Run Task 6 Step 1 (the set) and Task 6 Step 2 (the before batches, with the reach spies) on the workspace tree exactly as fetched from `origin/main`. Nothing is swapped in place. Record the load and memory at each batch.
- [ ] **Step 3: The plan's own commit.** Copy this file to `docs/superpowers/plans/2026-10-16-centralised-update-w18-test-containment.md`, `git add` it, run `topology-clean`, and commit `docs(update): plan for centralised update wave 18, the harness's net and bus containment and the raw-spawn census (D-5247..D-5253)`. Every D-5247 to D-5253 citation that Tasks 1 to 5 add then lands after its definition. `topology-clean`, `dtbd` and `deviation-refs` read docs, so their after-phase counts may differ from the before phase by this file; the worker says so if they do.

### Task 1: W18-a — the harness plants ssh, scp and curl, the fixture bus rides systemd, a named stub door, and the env it spawns with (D-5247, D-5248, D-5249)

**Files:** `server/test/ccdWsHelpers.ts`, `server/test/containedTools.ts`, `server/test/ccd-harness-containment.test.ts`.

- [ ] **Step 1: Re-measure the anchors on the tip** (`grep -nF`):
  - `ccdWsHelpers.ts`:
    - `import { inheritedEnv } from './gitEnvStrip.js';` (`:14`);
    - `export function harnessBin(home: string): string {` (`:295`);
    - `tmux?: boolean;`, closing `ContainOpts` (`:342`);
    - `` if (!opts.systemd && !opts.tmux) return { ...env, PATH: `${bin}:${env['PATH'] ?? ''}` }; `` (`:357`);
    - the final `` return { ...env, PATH: `${bin}:${env['PATH'] ?? ''}` }; `` (`:417`);
    - `export interface CcdHarness {` (`:508`);
    - `ghContainedEnv(home, {}, { systemd: true, tmux: true });` (`:558`);
    - the `sh: (snippet, env = {}) =>` member (`:597`).
  - `containedTools.ts`:
    - `export const CONTAINED_TOOLS` (`:44`);
    - `export function plantPoison` (`:49`);
    - `function busPath(name: string, value: string): string | null {` (`:177`);
    - `export function assertNoRealTool` (`:188`), and its `const homes = [path.resolve(home), fs.realpathSync(home)];` (`:189`).
  - The gap itself needs no separate probe: Step 2's red-first run is it. At the base, H18-3 reads `/usr/bin/ssh` (and `scp`, `curl`) for `command -v`, and H18-6 reads the real `/run/user/<uid>` pair.

- [ ] **Step 2: Write the rows first** *(revised, unmeasured: the prototype ran H18-1 to H18-7 in their earlier form; H18-5 now uses the helper, H18-7 is rewritten for the bus that follows `systemd`, and H18-8 and H18-9 are new)*. Append to `server/test/ccd-harness-containment.test.ts`, and add the imports beside the existing ones:

````diff
diff --git a/server/test/ccd-harness-containment.test.ts b/server/test/ccd-harness-containment.test.ts
--- a/server/test/ccd-harness-containment.test.ts
+++ b/server/test/ccd-harness-containment.test.ts
@@ -16,7 +16,9 @@ import {
-  makeCcdHarness, harnessBin, ghContainedEnv, WS_ADD, SCAN_LOOKBACK_LINES, type ContainOpts, type CcdHarness,
+  makeCcdHarness, harnessBin, ghContainedEnv, stubContainedTool, WS_ADD, SCAN_LOOKBACK_LINES, type ContainOpts,
+  type CcdHarness,
 } from './ccdWsHelpers.js';
 import { mkTmp } from './tmpHelpers.js';
+import { CONTAINED_TOOLS, assertNoRealTool } from './containedTools.js';
 
 let h: CcdHarness;
 beforeEach(() => { h = makeCcdHarness('ccrc-ccd-contain-'); });
@@ -283,3 +285,101 @@ describe('ghContainedEnv contains gh always, systemd only when asked', () => {
     }
   });
 });
+
+// ── WAVE 18 (centralised update management; D-5247, D-5248, D-5249): ssh, scp, curl and the user bus ──────────────
+// Wave 9 (R10d) made the ccrc builders' containment structural and left this harness's half as residue: every
+// `sh()` still inherited the operator's real `XDG_RUNTIME_DIR` and `DBUS_SESSION_BUS_ADDRESS`, and found the host's
+// own `ssh`, `scp` and `curl` on the PATH tail (measured at the wave's base: `/usr/bin/…` for all three, and the
+// real `/run/user/<uid>` pair). `ccd/ccd` calls none of the three tools and reads the bus only through the
+// poisoned managers, so it was a structural gap, not a live leak: the edit that adds a curl to ccd, or drops a
+// manager poison, would have reached the live machine with nothing red. These rows are what is red now.
+//
+// The harness ASKS for the network poisons (`net`); `ghContainedEnv` plants none for a caller that does not, because
+// suites run a functional curl outside `harnessBin` (unconditional, it measured 91 reds in three files). The bus
+// rides `systemd`: the managers are what read it. A functional stub goes through `stubContainedTool`.
+describe('the harness contains ssh, scp, curl and the user bus too (wave 18)', () => {
+  const BUS = (home: string): string =>
+    `${path.join(home, 'no-runtime-dir')}|unix:path=${path.join(home, 'no-bus')}`;
+  const PROBE = 'echo "$XDG_RUNTIME_DIR|$DBUS_SESSION_BUS_ADDRESS"';
+  const NET = ['ssh', 'scp', 'curl'] as const;
+
+  it('H18-1 makeCcdHarness plants every CONTAINED_TOOLS poison at creation, before any env() or sh()', () => {
+    // The creation-time plant is what a test that spawns with its OWN ghContainedEnv(h.home, …) inherits: it
+    // prepends the same harnessBin, so the poisons are already there (while that HOME lives).
+    const planted = fs.readdirSync(harnessBin(h.home)).filter((n) => (CONTAINED_TOOLS as readonly string[]).includes(n));
+    expect(planted.sort()).toEqual([...CONTAINED_TOOLS].sort());
+  });
+
+  it('H18-2 the env every sh() spawns with passes assertNoRealTool, whatever PATH the caller adds', () => {
+    expect(() => assertNoRealTool(h.env(), h.home)).not.toThrow();
+    expect(() => assertNoRealTool(h.env({ PATH: '/usr/bin:/bin' }), h.home)).not.toThrow();
+  });
+
+  it.each(NET)('H18-3 %s resolves to harnessBin, records its argv, and refuses with 97', (t) => {
+    expect(h.sh(`command -v ${t}`)).toBe(path.join(harnessBin(h.home), t));
+    expect(h.sh(`${t} -o x example.invalid 2>/dev/null; echo rc=$?`)).toBe('rc=97');
+    expect(fs.readFileSync(path.join(h.home, `${t}-poison`), 'utf8')).toBe('-o x example.invalid\n');
+  });
+
+  it('H18-4 every sh() re-plants a poison that is gone (a module-level harness after cleanup is that case)', () => {
+    fs.rmSync(path.join(harnessBin(h.home), 'ssh'), { force: true });
+    expect(h.sh('command -v ssh')).toBe(path.join(harnessBin(h.home), 'ssh'));
+  });
+
+  it('H18-5 a stub written through stubContainedTool REPLACES the curl poison and is kept across sh() calls', () => {
+    stubContainedTool(h.home, 'curl', '#!/bin/sh\necho "stub: $*" >> "$HOME/curl.argv"\nexit 0\n');
+    expect(h.sh('curl -s http://127.0.0.1:9/; echo rc=$?')).toBe('rc=0');
+    expect(h.sh('curl -s http://127.0.0.1:9/; echo rc=$?')).toBe('rc=0');
+    expect(fs.readFileSync(path.join(h.home, 'curl.argv'), 'utf8')).toBe('stub: -s http://127.0.0.1:9/\n'.repeat(2));
+    expect(fs.existsSync(path.join(h.home, 'curl-poison')), 'the poison ran').toBe(false);
+  });
+
+  it('H18-6 inside sh() the user bus is the fixture pair under HOME, even when the caller names the real one', () => {
+    expect(h.sh(PROBE)).toBe(BUS(h.home));
+    expect(h.sh(PROBE, { XDG_RUNTIME_DIR: '/run/user/0', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/0/bus' }))
+      .toBe(BUS(h.home));
+  });
+
+  it('H18-7 ghContainedEnv plants the net poisons only for a caller that ASKS, and the fixture bus for every systemd caller', () => {
+    // Three homes, one per option set: a poison is create-if-absent, so a shared harnessBin would carry one case's
+    // plant into the next.
+    const [a, b, c] = ['ccrc-contain-tmux-only-', 'ccrc-contain-managers-', 'ccrc-contain-net-'].map((p) => mkTmp(p));
+    const real = { PATH: '/usr/bin:/bin', XDG_RUNTIME_DIR: '/run/user/0', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/0/bus' };
+    const tmuxOnly = ghContainedEnv(a!, real, { tmux: true });
+    for (const t of NET) expect(fs.existsSync(path.join(harnessBin(a!), t)), t).toBe(false);
+    expect(tmuxOnly['XDG_RUNTIME_DIR'], 'no systemd, no bus').toBe('/run/user/0');
+    const managers = ghContainedEnv(b!, real, { systemd: true, tmux: true });
+    for (const t of NET) expect(fs.existsSync(path.join(harnessBin(b!), t)), t).toBe(false);
+    expect(`${managers['XDG_RUNTIME_DIR']}|${managers['DBUS_SESSION_BUS_ADDRESS']}`, 'the bus rides systemd').toBe(BUS(b!));
+    const net = ghContainedEnv(c!, real, { net: true });
+    for (const t of NET) expect(fs.existsSync(path.join(harnessBin(c!), t)), t).toBe(true);
+    expect(fs.existsSync(path.join(harnessBin(c!), 'systemctl')), 'net is not systemd').toBe(false);
+    expect(net['XDG_RUNTIME_DIR'], 'net is not the bus').toBe('/run/user/0');
+  });
+
+  it('H18-8 a bus pair the caller points under HOME stands; a pair only half under HOME does not', () => {
+    const own = {
+      XDG_RUNTIME_DIR: path.join(h.home, 'xdg'),
+      DBUS_SESSION_BUS_ADDRESS: `unix:path=${path.join(h.home, 'xdg', 'bus')}`,
+    };
+    expect(h.sh(PROBE, own)).toBe(`${own.XDG_RUNTIME_DIR}|${own.DBUS_SESSION_BUS_ADDRESS}`);
+    expect(h.sh(PROBE, { ...own, DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/0/bus' })).toBe(BUS(h.home));
+  });
+
+  it('H18-9 stubContainedTool is the one named door: it writes into harnessBin and refuses a name it does not contain', () => {
+    expect(() => stubContainedTool(h.home, 'git' as never, '#!/bin/sh\n')).toThrow(/not a contained tool/);
+    const p = stubContainedTool(h.home, 'ssh', '#!/bin/sh\necho stub-ssh\n');
+    expect(p).toBe(path.join(harnessBin(h.home), 'ssh'));
+    expect(h.sh('ssh')).toBe('stub-ssh');
+  });
+});
````

  Run: `TMPDIR="$T/one" ./node_modules/.bin/vitest run test/ccd-harness-containment.test.ts`.
  Expected red-first *(revised, unmeasured)*: all 11 new tests red, and the 14 existing tests green. H18-5 and H18-9 red by a TypeError, because `stubContainedTool` is not exported yet. H18-8 reds by its half-under-HOME case. The prototype's red-first, on its seven rows: 8 of 9 red, and H18-5 green, because a raw write into `harnessBin` already worked at the base *(prototype)*.

- [ ] **Step 3: The change** *(revised, unmeasured; hand-revised from the prototype's diff: `bus` is no longer a flag, the pair follows `systemd` and yields to a caller's pair under HOME, and `stubContainedTool` is new)*. `server/test/containedTools.ts`, first:

````diff
diff --git a/server/test/containedTools.ts b/server/test/containedTools.ts
--- a/server/test/containedTools.ts
+++ b/server/test/containedTools.ts
@@ -176,6 +176,26 @@ export function loopbackCurlFront(realCurl: string): string {
 /** Where a bus env var points, as a path: the `path=` of a `unix:` address, or the bare value (XDG_RUNTIME_DIR). */
 function busPath(name: string, value: string): string | null {
   if (name === 'XDG_RUNTIME_DIR') return value;
   const m = /^unix:(?:[^,]*,)*path=([^,]+)/.exec(value);
   return m ? m[1]! : null;
 }
 
+/** The one "inside the fixture HOME" predicate: the path itself or under it, for HOME as given or its realpath
+ *  (macOS's `/var` is `/private/var`). `assertNoRealTool` and `busUnder` both read it (wave 18). */
+export function insideOf(home: string): (p: string) => boolean {
+  const homes = [path.resolve(home), fs.realpathSync(home)];
+  return (p) => homes.some((h) => p === h || p.startsWith(h + path.sep));
+}
+
+/** True when BOTH bus variables are set and name paths inside `home`: a fixture bus the test made itself, which
+ *  `ghContainedEnv` keeps (wave 18, D-5248). Exactly the condition `assertNoRealTool` refuses the negation of. */
+export function busUnder(env: NodeJS.ProcessEnv, home: string): boolean {
+  const inside = insideOf(home);
+  return (['XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS'] as const).every((name) => {
+    const v = env[name];
+    const p = v === undefined || v === '' ? null : busPath(name, v);
+    return p !== null && inside(path.resolve(p));
+  });
+}
+
 /** THROWS unless, under `env`, every CONTAINED_TOOLS name resolves to NOTHING or to a file whose REALPATH is inside
@@ -188,8 +208,7 @@ function busPath(name: string, value: string): string | null {
 export function assertNoRealTool(env: NodeJS.ProcessEnv, home: string): void {
-  const homes = [path.resolve(home), fs.realpathSync(home)];
-  const inside = (p: string): boolean => homes.some((h) => p === h || p.startsWith(h + path.sep));
+  const inside = insideOf(home);
   for (const name of ['XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS']) {
````

  Then `server/test/ccdWsHelpers.ts`:

````diff
diff --git a/server/test/ccdWsHelpers.ts b/server/test/ccdWsHelpers.ts
--- a/server/test/ccdWsHelpers.ts
+++ b/server/test/ccdWsHelpers.ts
@@ -12,6 +12,7 @@ import { parseRoster } from '../../shared/roster.js';
 import { generateAccountsSh } from '../../shared/generate.mjs';
 import { asManagerCalls } from './platformFixtures.js';
 import { inheritedEnv } from './gitEnvStrip.js';
+import { CONTAINED_TOOLS, busUnder, plantPoison } from './containedTools.js';
 
 /** The home-able ids of the test roster — the set ccd reads as `CCRC_HOME_ABLE`
  *  out of the roster `seedAccountsSh` writes below. Derived, not hand-typed,
@@ -340,8 +341,35 @@ export interface ContainOpts {
    *  Same create-if-absent shape as systemd, for the same displaceability
    *  reason, and a bash FUNCTION stub still wins over both. */
   tmux?: boolean;
+  /** Plant the `ssh`, `scp` and `curl` poisons (wave 18, D-5247), `plantPoison`'s create-if-absent ones, so a stub
+   *  written through `stubContainedTool` replaces the poison and is kept. `makeCcdHarness` asks. OPT-IN for the reason
+   *  `systemd` is: suites run a FUNCTIONAL curl from a directory of their own or the real one against a loopback
+   *  listener, and a poison here outranks both. Measured with it on for every `systemd: true` caller: 91 reds in
+   *  ccd-update-sync, ccrc-api and ccrc-token-sync (116 before two files moved their stub here). */
+  net?: boolean;
 }
 
+/** The ssh, scp and curl poisons `net` plants: the three CONTAINED_TOOLS names the other options do not cover. */
+const NET_TOOLS = ['ssh', 'scp', 'curl'] as const;
+
+/** THE named door for a test that needs a FUNCTIONAL contained tool under the harness, a curl stub above all (wave
+ *  18, D-5249): writes `body` as `<harnessBin(home)>/<name>`, REPLACING the poison `net` (or `systemd`, `tmux`)
+ *  plants there. A poison is create-if-absent, so every later plant keeps the stub. Refuses a name outside
+ *  CONTAINED_TOOLS, so the call site names the tool it takes over. Returns the stub's path. */
+export function stubContainedTool(home: string, name: (typeof CONTAINED_TOOLS)[number], body: string): string {
+  if (!(CONTAINED_TOOLS as readonly string[]).includes(name)) {
+    throw new Error(`stubContainedTool: ${String(name)} is not a contained tool`);
+  }
+  const p = path.join(harnessBin(home), name);
+  fs.writeFileSync(p, body, { mode: 0o755 });
+  fs.chmodSync(p, 0o755); // the mode above applies only when the file is created, and a poison may already be there
+  return p;
+}
+
 export function ghContainedEnv(
   home: string, env: NodeJS.ProcessEnv = {}, opts: ContainOpts = {},
 ): NodeJS.ProcessEnv {
@@ -354,7 +382,7 @@ export function ghContainedEnv(
   // consumer it hurts, because the damage shows up as a wrong ANSWER in a file
   // that never mentioned systemd (see the header). Opt-in makes the widening
   // land at the call site, where the reviewer of that call site can see it.
-  if (!opts.systemd && !opts.tmux) return { ...env, PATH: `${bin}:${env['PATH'] ?? ''}` };
+  if (!opts.systemd && !opts.tmux && !opts.net) return { ...env, PATH: `${bin}:${env['PATH'] ?? ''}` };
   // THE SECOND STRUCTURAL BOUNDARY for the ccd runners, and the reason it is a
   // poison rather than an absence: `_have_systemctl` is `command -v systemctl`,
   // so REMOVING systemctl would send every ccd test down `_supervised_start`'s
@@ -411,10 +439,20 @@ export function ghContainedEnv(
       + '[ "$rc" = 0 ] || echo "ccd tests must never reach the real user manager" >&2\nexit "$rc"\n',
       { mode: 0o755 });
   }
+  if (opts.net) for (const n of NET_TOOLS) plantPoison(bin, n);
+  // The user bus rides the manager poisons (wave 18, D-5248): the managers are what read it, and ccd's
+  // `: "${XDG_RUNTIME_DIR:=/run/user/$(id -u)}"` would turn an absence back into the real one, so it is SET, after
+  // the caller's env, to two paths under HOME that do not exist. A caller's own pair stands only when BOTH name a
+  // path under HOME (`busUnder`, the rule `assertNoRealTool` applies): a fixture runtime dir a test made itself.
+  const bus = opts.systemd && !busUnder(env, home) ? {
+    XDG_RUNTIME_DIR: path.join(home, 'no-runtime-dir'),
+    DBUS_SESSION_BUS_ADDRESS: `unix:path=${path.join(home, 'no-bus')}`,
+  } : {};
   // Prepended to whatever the caller passed, never the other way round: a
   // snippet that supplies its own PATH must not be able to displace the poison,
   // which is the difference between structural and advisory.
-  return { ...env, PATH: `${bin}:${env['PATH'] ?? ''}` };
+  return { ...env, ...bus, PATH: `${bin}:${env['PATH'] ?? ''}` };
 }
 
 /** The one reader every append-only call log in this file goes through: absent
@@ -507,6 +545,8 @@ export const FIXTURE_MOUNTINFO = '.fixture-mountinfo';
 
 export interface CcdHarness {
   home: string;
+  /** The env `sh(snippet, extra)` spawns with, built the same way (wave 18): what `assertNoRealTool` reads. */
+  env(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
   sh(snippet: string, env?: NodeJS.ProcessEnv): string;
   reg(id: string, field: string): string | null;
   calls(): string[];
@@ -554,8 +594,11 @@ export function makeCcdHarness(prefix: string): CcdHarness {
   // harness runs ccd, so it asks for the systemd boundary too, here and on
   // every `sh()` below: that is what makes "every test that can reach
   // `_supervised_start` is contained" a property of the harness rather than a
-  // rule each ccd test file remembers.
-  ghContainedEnv(home, {}, { systemd: true, tmux: true });
+  // rule each ccd test file remembers. Since wave 18 it asks for ssh, scp and
+  // curl (`net`) too, and the fixture user bus rides `systemd` (D-5248), so every
+  // CONTAINED_TOOLS name is planted here, at creation.
+  ghContainedEnv(home, {}, { systemd: true, tmux: true, net: true });
 
   const gitEnv = (): NodeJS.ProcessEnv => ({
     ...inheritedEnv(), HOME: home,
@@ -582,25 +625,32 @@ export function makeCcdHarness(prefix: string): CcdHarness {
     return main;
   };
 
+  // `cwd: home` is part of the isolation, not a convenience. Without it the
+  // snippet inherits vitest's cwd — `infra/ccrc/server` — so any ccd path that
+  // resolves a RELATIVE path writes into the repository. Measured: the hostile
+  // -CDPATH ws-add case makes `$common` two lines long, and `mkdir -p
+  // "$common/info"` then created 74 directories under `server/`, two of them
+  // holding a real `.git/info/exclude`. `git status` cannot see them (the tree
+  // walk skips a component named `.git`, and empty dirs are unreported), so
+  // the suite littered the checkout invisibly and `git add -A` would have
+  // committed newline-bearing paths. HOME is only the ONLY boundary this file
+  // claims if the process starts inside it.
+  //
+  // `env` is the ONE expression `sh` spawns with (wave 18), exposed so a test can
+  // hand it to `assertNoRealTool`. `CCD_MOUNTINFO` sits BEFORE `...extra` so a
+  // snippet can override it: see `FIXTURE_MOUNTINFO` for why the host's table
+  // never decides a verdict. A bus pair outside HOME cannot override the fixture's.
+  const env = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv =>
+    ghContainedEnv(home, { ...inheritedEnv(), HOME: home,
+      CCD_MOUNTINFO: path.join(home, FIXTURE_MOUNTINFO), ...extra }, { systemd: true, tmux: true, net: true });
+  const sh = (snippet: string, extra: NodeJS.ProcessEnv = {}): string =>
+    execFileSync('bash', ['-c', `source "${CCD}"; ${snippet}`],
+      { encoding: 'utf8', cwd: home, env: env(extra) }).trim();
+
   return {
     home,
-    // `cwd: home` is part of the isolation, not a convenience. Without it the
-    // snippet inherits vitest's cwd — `infra/ccrc/server` — so any ccd path that
-    // resolves a RELATIVE path writes into the repository. Measured: the hostile
-    // -CDPATH ws-add case makes `$common` two lines long, and `mkdir -p
-    // "$common/info"` then created 74 directories under `server/`, two of them
-    // holding a real `.git/info/exclude`. `git status` cannot see them (the tree
-    // walk skips a component named `.git`, and empty dirs are unreported), so
-    // the suite littered the checkout invisibly and `git add -A` would have
-    // committed newline-bearing paths. HOME is only the ONLY boundary this file
-    // claims if the process starts inside it.
-    sh: (snippet, env = {}) =>
-      execFileSync('bash', ['-c', `source "${CCD}"; ${snippet}`],
-        { encoding: 'utf8', cwd: home,
-          // `CCD_MOUNTINFO` sits BEFORE `...env` so a snippet can override it:
-          // see `FIXTURE_MOUNTINFO` for why the host's table never decides a verdict.
-          env: ghContainedEnv(home, { ...inheritedEnv(), HOME: home,
-            CCD_MOUNTINFO: path.join(home, FIXTURE_MOUNTINFO), ...env }, { systemd: true, tmux: true }) }).trim(),
+    env,
+    sh,
     reg: (id, field) => {
       const p = path.join(home, '.cc-sessions', `${id}.${field}`);
       return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : null;
````

  **The prototype's shape, kept as the measured fallback (D-5248).** `ContainOpts` also had `bus?: boolean`. The bus block read `const bus = opts.bus ? { … } : {};`, with no `busUnder`. The early return tested `!opts.bus` too. Both harness sites asked `{ systemd: true, tmux: true, net: true, bus: true }`. Every *(prototype)* count in Steps 3 and 4 and in Task 6 was measured on that shape.

  Run the file again. Expected *(revised, unmeasured)*: 25 of 25. Then, one file per call, the pinning files. Their *(prototype)* counts, from Task 6's after-phase, are: `ccd-workspaces` (81), `ccd-tmux-anchor` (35), `ccrc-containment` (95 before Task 5, 96 after), `ccd-version` (9), `ccd-lifecycle-emit` (59) and `ccd-lifecycle-gen` (17).
  
  Then, one per call, the files most exposed to the bus now following `systemd`: `macos-platform` (102, 11 skipped), `ccd-supervised-start` (25, 4 skipped), `ccd-update-sync` (45), `ccrc-token-sync` (93), `ccrc-api` (103), `ccd-svc-real-home`, `ccd-archive` and `ccrc-containment` *(prototype counts, on the earlier shape)*.
  
  Then `node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit; echo "exit $?"` (exit 0, *prototype*, on the earlier final tree).
  
  **If a red appears that the bus causes** (the failing assertion reads the bus, or a record under it):
  - Read it. A test that passed because it reached the operator's runtime dir is a finding for the wave-done, not a regression. The scope-sweep verdict record `ccrc-doctor-checks:7583` reads is one such path. If the file is unclaimed, give it a fixture runtime dir under HOME, which `busUnder` keeps (a reserve number). If it is claimed, report it.
  - A test that needs the real bus for a reason the wave accepts takes the fallback above, recorded under a reserve number.

- [ ] **Step 4: Mutation rows** *(revised, unmeasured)*. Each is one edit, run against `ccd-harness-containment.test.ts` (25 tests) unless named. Where the prototype measured the same mutation on its earlier rows, its result is in brackets.

  | row | mutation | expected red set |
  |---|---|---|
  | T1-1 | the creation site asks `{ systemd, tmux }` (drops `net`) | H18-1 only. [prototype: H18-1 only, 1 of 23: "expected [ Array(5) ] to deeply equal [ 'curl', 'gh', 'launchctl', …(5) ]"] |
  | T1-2 | `env()` asks `{ systemd, tmux }` (drops `net`) | H18-4 only: H18-3 stays green, because the creation site planted the poison. [prototype: H18-4 only, 1 of 23: "expected '/usr/bin/ssh' to be '<home>/.local/bin/ssh'"] |
  | T1-3 | the bus keyed on a flag nobody sets (`opts.systemd && false`) | H18-2 ("assertNoRealTool: XDG_RUNTIME_…"), H18-6, H18-7 (its managers case), H18-8 (its half case) |
  | T1-4 | `return { ...bus, ...env, PATH … }` (the caller's env wins) | H18-2 (the inherited real pair wins), H18-6, H18-7 (managers case), H18-8 (half case). [prototype, as `bus`: H18-2, H18-6, H18-7, 3 of 23] |
  | T1-5 | `busUnder` dropped (the fixture always forced) | H18-8, its own-pair case only |
  | T1-6 | `busUnder` reads `.some` (one variable under HOME is enough) | H18-8, its half case only |
  | T1-7 | the early return tests `systemd` and `tmux` only | H18-7, its net case ("ssh: expected false to be true"). [prototype: H18-7, 1 of 23] |
  | T1-8 | `for (const n of NET_TOOLS)` without `if (opts.net)` | H18-7, its tmux-only and managers cases ("ssh: expected true to be false"). [prototype: H18-7, 1 of 23] |
  | T1-9 | `net` removes a present file before planting (overwrites a stub) | H18-5, H18-9, and, run over `ccd-pool-sync` and `pool-accounts-route` too: every `ccd-pool-sync` test that writes a stub (by its assertion or by the `afterEach` guard), and `pool-accounts-route`'s three `syncInto` rows. [prototype, before the pool runners asked `net`: H18-5 only, 1 of 94: "expected 'rc=97' to be 'rc=0'"] |
  | T1-10 | `NET_TOOLS = ['ssh', 'curl']` (drops `scp`) | H18-1, H18-2, H18-3 scp, H18-7 (net case) ("assertNoRealTool: scp resolved…"; "expected '/usr/bin/scp' to be …"). [prototype: the same 4 of 23] |
  | T1-11 | the rejected H3 shape: `net` planted for every `systemd` caller (`if (opts.net \|\| opts.systemd)`), run on `ccd-update-sync`, `ccrc-api`, `ccd-pool-sync`, `pool-accounts-route` and `ccrc-token-sync` | `ccd-update-sync` 37, `ccrc-api` 53, `ccrc-token-sync` 1; the two pool files 0 (D-5247). [prototype, with `bus` on as well: 91 of 312, first assertion "ccd-update-sync: unmeasured — curl exited 97"] |
  | T1-12 | the bus keyed on `opts.systemd \|\| opts.tmux` | H18-7, its tmux-only case ("no systemd, no bus") |
  | T1-13 | `stubContainedTool`'s refusal removed | H18-9 ("expected [Function] to throw") |

- [ ] **Step 5: Commit** `test(update): the ccd harness poisons ssh, scp and curl, the user bus under HOME rides systemd, and one door for a functional stub (wave 18, D-5247, D-5248, D-5249)`.

### Task 2: W18-a — the pool files' curl stubs go through the named door, and ccd-pool-sync's runners ask net (D-5249)

**Files:** `server/test/ccd-pool-sync.test.ts`, `server/test/pool-accounts-route.test.ts`.

- [ ] **Step 1: Red-first, with Task 1 in place and these files at the base.**
  - Anchors in `ccd-pool-sync.test.ts`:
    - `const h = makeCcdHarness('pool-sync');` (`:7`) and `afterEach(() => h.cleanup());` (`:8`);
    - `function stubCurl(body: string, status = '200'): string {` (`:36`);
    - its five `const bin = path.join(h.home, 'bin');` lines (`:37`, `:416`, `:430`, `:441`, `:571`);
    - the four `chmodSync(path.join(bin, 'curl'), 0o755);` lines (`:420`, `:434`, `:444`, `:578`);
    - the three runners' `{ systemd: true, tmux: true });` (`:82`, `:375`, `:391`).
  - Anchors in `pool-accounts-route.test.ts`: `const syncInto = (home: string, body: string): void => {` (`:399`), and its `{ systemd: true, tmux: true });` (`:421`).
  - Run `ccd-pool-sync` then `pool-accounts-route`, one per call. Expected *(prototype, on the earlier shape; the bus change does not touch these)*: 4 red:
    - "writes the projection from a 200";
    - "the LIVE writer's fresh output reads as current, not stale";
    - "the writer's own output, with an ALREADY-ELAPSED lease, reads as stale — the exact regression C1 found";
    - "a declared-only account (no central edge) now appears, and a centrally-tagged one still shows the central value".

- [ ] **Step 2: The change** *(revised, unmeasured; hand-revised from the prototype's relocation diff)*:

````diff
diff --git a/server/test/ccd-pool-sync.test.ts b/server/test/ccd-pool-sync.test.ts
--- a/server/test/ccd-pool-sync.test.ts
+++ b/server/test/ccd-pool-sync.test.ts
@@ -1,8 +1,16 @@
 import { describe, it, expect, beforeEach, afterEach } from 'vitest';
-import { makeCcdHarness, ghContainedEnv } from './ccdWsHelpers.js';
-import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync, readdirSync } from 'node:fs';
+import { makeCcdHarness, ghContainedEnv, stubContainedTool } from './ccdWsHelpers.js';
+import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
 import { execFileSync, spawnSync } from 'node:child_process';
 import path from 'node:path';
 
 const h = makeCcdHarness('pool-sync');
-afterEach(() => h.cleanup());
+// Wave 18 (D-5249): every curl here is a stub or the poison. A test the poison answered had its stub displaced, or
+// ran a curl with none, and its assertions can stay green on the poison's 97 (a row that asserts only an absence
+// does). So the poison's record is read before the cleanup, the cleanup runs, and a record is red.
+afterEach(() => {
+  const ran = existsSync(path.join(h.home, 'curl-poison'));
+  h.cleanup();
+  expect(ran, 'the curl poison ran: a curl stub was displaced, or a curl ran with no stub').toBe(false);
+});
 
@@ -34,13 +42,9 @@ for a in "$@"; do
 done
 `;
 function stubCurl(body: string, status = '200'): string {
-  const bin = path.join(h.home, 'bin');
-  mkdirSync(bin, { recursive: true });
-  const p = path.join(bin, 'curl');
-  writeFileSync(p,
-    CURL_STUB_HEAD + `printf '%s' '${body}' > "$outfile"\nprintf '%s' '${status}'\n`,
-    'utf8');
-  chmodSync(p, 0o755);
-  return bin;
+  // Through the named door (wave 18, D-5249): INTO harnessBin, where the stub REPLACES the curl poison.
+  return path.dirname(stubContainedTool(h.home, 'curl',
+    CURL_STUB_HEAD + `printf '%s' '${body}' > "$outfile"\nprintf '%s' '${status}'\n`));
 }
@@ -57,9 +61,14 @@ const curlArgv = (): string => readFileSync(path.join(h.home, 'curl.argv'), 'utf
 /** CONTAINMENT, and it is `ccd-workspaces.test.ts`'s source scan that requires
  *  it of every bash call site in a ccd test file — not a judgement per call
  *  site about what the child "could" reach. `ghContainedEnv` PREPENDS its own
- *  bin, so the `gh` poison cannot be displaced by the stub PATH built below;
- *  `$HOME/bin` (the curl stub) stays second and still wins for `curl`, which
- *  the poison directory does not hold. `ccd-account-auth.test.ts` is the
+ *  bin, so the `gh` poison cannot be displaced by the stub PATH built below.
+ *  The curl stub is written INTO that bin (`stubContainedTool`), where it
+ *  REPLACES the curl poison (D-5249): a stub in a directory of its own would
+ *  lose to the poison on ordering, which is how "writes the projection from a
+ *  200" went red. Each runner asks `net` itself: this file's harness is
+ *  module-level and the cleanup removes its HOME after every test, so the plant
+ *  `makeCcdHarness` made at creation is gone after the first. `ccd-account-auth.test.ts` is the
  *  precedent — the other sibling executable, contained the same way at every
  *  one of its call sites.
  *
@@ -80,6 +89,6 @@
 const run = (bin: string): { rc: number; out: string } => {
   const env = ghContainedEnv(h.home, { ...process.env, HOME: h.home, PATH: `${bin}:${process.env.PATH}` },
-    { systemd: true, tmux: true });
+    { systemd: true, tmux: true, net: true });
@@ -373,6 +382,6 @@
     const env = ghContainedEnv(h.home, { ...process.env, HOME: h.home },
-      { systemd: true, tmux: true });
+      { systemd: true, tmux: true, net: true });
@@ -389,6 +398,6 @@
     const env = ghContainedEnv(h.home, { ...process.env, CCRC_POOL_SYNC_TIMEOUT: undefined, ...extra, HOME: h.home, PATH: `${bin}:${process.env.PATH}` },
-      { systemd: true, tmux: true });
+      { systemd: true, tmux: true, net: true });
@@ -413,9 +422,6 @@ describe('ccd-pool-sync', () => {
     const body = JSON.stringify({ epoch: 1, issuedAt: 1, leaseUntil: 9999999999, accounts: {}, pad: 'x'.repeat(1_100_000) });
-    const bin = path.join(h.home, 'bin');
-    mkdirSync(bin, { recursive: true });
     writeFileSync(path.join(h.home, 'oversized-body.json'), body, 'utf8');
-    writeFileSync(path.join(bin, 'curl'), `${CURL_STUB_HEAD}cat "$HOME/oversized-body.json" > "$outfile"\nprintf '200'\n`, 'utf8');
-    chmodSync(path.join(bin, 'curl'), 0o755);
+    const bin = path.dirname(stubContainedTool(h.home, 'curl', `${CURL_STUB_HEAD}cat "$HOME/oversized-body.json" > "$outfile"\nprintf '200'\n`));
     const r = runFull(bin);
@@ -427,9 +433,6 @@ describe('ccd-pool-sync', () => {
     const body = JSON.stringify({ epoch: 5, issuedAt: 1, leaseUntil: 9999999999, accounts: {}, pad: 'x'.repeat(900_000) });
-    const bin = path.join(h.home, 'bin');
-    mkdirSync(bin, { recursive: true });
     writeFileSync(path.join(h.home, 'oversized-body.json'), body, 'utf8');
-    writeFileSync(path.join(bin, 'curl'), `${CURL_STUB_HEAD}cat "$HOME/oversized-body.json" > "$outfile"\nprintf '200'\n`, 'utf8');
-    chmodSync(path.join(bin, 'curl'), 0o755);
+    const bin = path.dirname(stubContainedTool(h.home, 'curl', `${CURL_STUB_HEAD}cat "$HOME/oversized-body.json" > "$outfile"\nprintf '200'\n`));
     const r = runFull(bin);
@@ -440,7 +443,4 @@ describe('ccd-pool-sync', () => {
   it('names curl 63 (the size bound fired) as its own sentence', () => {
-    const bin = path.join(h.home, 'bin');
-    mkdirSync(bin, { recursive: true });
-    writeFileSync(path.join(bin, 'curl'), `${CURL_STUB_HEAD}exit 63\n`, 'utf8');
-    chmodSync(path.join(bin, 'curl'), 0o755);
+    const bin = path.dirname(stubContainedTool(h.home, 'curl', `${CURL_STUB_HEAD}exit 63\n`));
     const r = runFull(bin);
@@ -570,12 +570,8 @@ describe('ccd-pool-sync', () => {
     const body = JSON.stringify({ epoch: 1, issuedAt: 1, leaseUntil: 9999999999, accounts });
-    const bin = path.join(h.home, 'bin');
-    mkdirSync(bin, { recursive: true });
     const bodyFile = path.join(h.home, 'oversized-body.json');
     writeFileSync(bodyFile, body, 'utf8');
-    writeFileSync(path.join(bin, 'curl'),
-      `${CURL_STUB_HEAD}cat "$HOME/oversized-body.json" > "$outfile"\nprintf '200'\n`,
-      'utf8');
-    chmodSync(path.join(bin, 'curl'), 0o755);
+    const bin = path.dirname(stubContainedTool(h.home, 'curl',
+      `${CURL_STUB_HEAD}cat "$HOME/oversized-body.json" > "$outfile"\nprintf '200'\n`));
     expect(run(bin).rc).not.toBe(0);
````

  And one new row, last in `describe('ccd-pool-sync', …)`:

````ts
  it('a curl with no stub is the poison, even after a cleanup removed the creation-time plant (wave 18, D-5249)', () => {
    // This file's harness is module-level, and the afterEach cleanup removes its HOME: the plant makeCcdHarness
    // made at creation is gone for every test after the first. The runner's own `net: true` plants it again.
    h.cleanup();
    seedConfig();
    const bin = path.join(h.home, 'no-stub-bin');
    mkdirSync(bin, { recursive: true });
    expect(run(bin).rc).not.toBe(0);
    expect(existsSync(path.join(h.home, 'curl-poison')), 'the poison answered the curl').toBe(true);
    rmSync(path.join(h.home, 'curl-poison')); // meant to run here: the afterEach guard reads this record
  });
````

````diff
diff --git a/server/test/pool-accounts-route.test.ts b/server/test/pool-accounts-route.test.ts
--- a/server/test/pool-accounts-route.test.ts
+++ b/server/test/pool-accounts-route.test.ts
@@ -28,7 +28,7 @@ import { ACCOUNT_ID_RE } from '../../shared/roster.js';
 import { seedRoster } from './helpers.js';
 import { mkTmp } from './tmpHelpers.js';
 import { execFileSync } from 'node:child_process';
-import { CCD, ghContainedEnv, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
+import { CCD, ghContainedEnv, makeCcdHarness, stubContainedTool, type CcdHarness } from './ccdWsHelpers.js';
 import { POOLS_DIR_NAME } from '../src/pools.js';
 
 const TOKEN = 'f'.repeat(64);
@@ -397,10 +397,11 @@ const CCD_POOL_SYNC = path.join(repoRootForSync, 'ccd', 'ccd-pool-sync');
  *  status to stdout, as a real curl does. The body rides in a data file the
  *  stub `cat`s, not a quoting chain, so a JSON body with quotes is safe. */
 const syncInto = (home: string, body: string): void => {
-  const bin = path.join(home, 'bin');
-  mkdirSync(bin, { recursive: true });
+  // Through the named door (wave 18, D-5249): INTO harnessBin, where the stub REPLACES the curl poison
+  // `makeCcdHarness` plants; a stub in a directory of its own loses to that poison on ordering.
   writeFileSync(path.join(home, 'curl-body.json'), body, 'utf8');
-  writeFileSync(path.join(bin, 'curl'), [
+  const bin = path.dirname(stubContainedTool(home, 'curl', [
     '#!/usr/bin/env bash',
@@ -412,7 +413,7 @@ const syncInto = (home: string, body: string): void => {
     "printf '200'",
     '',
-  ].join('\n'), { mode: 0o755 });
+  ].join('\n')));
   mkdirSync(path.join(home, '.ccrc'), { recursive: true });
@@ -419,5 +420,5 @@ const syncInto = (home: string, body: string): void => {
   const env = ghContainedEnv(
     home, { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH ?? ''}` },
-    { systemd: true, tmux: true });
+    { systemd: true, tmux: true, net: true });
   execFileSync('bash', [CCD_POOL_SYNC], { encoding: 'utf8', env });
````

  `mkdirSync` stays imported in both files: `seedConfig` and `syncInto` use it. Drop any import the change leaves unused (`tsc -p test/tsconfig.tests.json` reports it). The three runner sites keep `ghContainedEnv` inside `ccd-workspaces.test.ts`'s twelve-line window, so they stay inline, not behind a helper.
  
  Run both files. Expected *(revised, unmeasured)*: `ccd-pool-sync` 41 of 41 and `pool-accounts-route` 31 of 31. On the prototype's raw relocation they were 40 of 40 and 31 of 31 *(prototype)*. If the `afterEach` guard reds an existing test that runs a curl with no stub, that test reached the host's curl at the base (the before reach log names it). Give it a stub through `stubContainedTool`, or remove the record with a comment saying why the poison is the expected answer, and list it in the wave-done.

- [ ] **Step 3: The coverage check** (Risk notes). For each relocated stub, confirm by reading that the row asserts a side effect of the stub, not only an absence: `curlArgv()`, the written projection, the status the stub prints, or the guard. A row that asserts only an absence is now held by the `afterEach` guard; list each one in the wave-done. *(to be measured by the worker)*

- [ ] **Step 4: Mutation rows** *(revised, unmeasured)*. Each site is reverted alone, and its test is run alone with `-t`, so no set depends on order:

  | row | mutation | expected red set |
  |---|---|---|
  | T2-1 | `stubCurl` reverted to writing `<home>/bin/curl` (as at the base) | every `ccd-pool-sync` test that calls `stubCurl`, by its own positive assertion or by the `afterEach` guard (the poison now answers every one of them); the worker lists the set |
  | T2-2a…d | each of the four inline sites (the 1 MiB refusal, the just-under-the-cap read, curl 63, the 65536-byte document) reverted alone | that one test, by its assertion or by the guard |
  | T2-3 | `syncInto` reverted to `<home>/bin` | `pool-accounts-route`'s three C1/W1 rows (Step 1's set). [prototype, as the red-first: the same three] |
  | T2-4 | `run()`'s `net: true` dropped | the new row only ("the poison answered the curl: expected false to be true"). The host's curl runs against `example.invalid`, which does not resolve, so nothing is contacted |
  | T2-5 | T2-1 with the `afterEach` guard removed (the control) | only the stub tests that assert a positive side effect: the absence-only rows go green, which is what the guard exists for |

- [ ] **Step 5: Commit** `test(update): the pool-sync curl stubs go through stubContainedTool, and ccd-pool-sync's runners ask net (wave 18, D-5249)`.

### Task 3: W18-b — the raw-spawn census, and the hits it finds (R14(b); D-5250, D-5251, D-5253)

**Files:** NEW `server/test/raw-spawn-census.test.ts`; `server/test/projected-home.test.ts`, `server/test/ccrc-memory.test.ts`, `server/test/runbook-holds.test.ts`, `server/test/ccrc-containment.test.ts` (comments).

- [ ] **Step 1: Re-measure the hits' anchors** (`grep -nF`):
  - `projected-home.test.ts`: `{ encoding: 'utf8', env: { ...process.env, HOME: home } }).trim();` (`:48`), `{ encoding: 'utf8', env: { ...process.env, HOME: h } }).trim();` (`:659`), and `afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });` (`:66`);
  - `ccrc-memory.test.ts`: `{ env: { ...process.env, HOME: home, ...extraEnv }, encoding: 'utf8' });` (`:19`), and its three `{ env: { ...process.env, HOME: home }, encoding: 'utf8' }` spawns (`:408`, `:935`, `:963`);
  - `runbook-holds.test.ts`: `let env: NodeJS.ProcessEnv = { ...process.env, HOME: home };` (`:143`);
  - `ccrc-doctor.test.ts`: `describe('_box_role never asserts a state it did not measure'` (`:8373`);
  - the sliced spawns D-5251 names: `ccrc-install.test.ts`'s `const fn = /^_ver_newer\(\) \{` and `['-c', harness]`, `ccrc-doctor.test.ts`'s `const redact = /^_upd_redact\(\) \{`, and `macos-platform.test.ts`'s `execFileSync('bash', ['-c', `${platformBlock(ccd)}`.

- [ ] **Step 2: Write the census** *(revised; measured standalone by the reviser, not under vitest: 7 of 7 on the prototype tree; the prototype's own file was 362 lines and five rows, measured green under vitest)*. Kept from the prototype's measured file: `mask`, `closeOf`, `partsOf`, `bindingsOf`, `PATHLIKE`, `SCRIPT_PATH`, `READS`, `RUNNERS`, `READERS` and `ALLOWED`. New: the spawn family read from each file's imports, directory bindings, namespace members and `for … of` names, the SLICED class and its list, the wider bare-env reading, and the fixture corpus. The whole new file:

````ts
// raw-spawn-census.test.ts — every spawn of the real ccd or ccrc script in server/test and agent/test hands it a
// CONTAINED env, or is named here with its reason (centralised update management, wave 18, R14(b); D-5250, D-5251).
//
// WHY. HOME is the only isolation boundary ccd and ccrc have, and the second boundary — no real gh, systemctl,
// systemd-run, launchctl, tmux, curl, ssh or scp, and no real user bus — is what `ghContainedEnv` (with its options)
// and `ccrcContainedEnv` build. A spawn that skips both inherits all of it from vitest. Wave 9's census
// (`ccrc-containment.test.ts`, 3c) reads five builder files for two shapes; it cannot see a spawn in any other file,
// and review 265 (F5) named the three shapes it misses. This file is that census, over both test trees.
//
// THE RULE, decided per call, never per file:
//   * A SPAWN is a call of a spawn-family function as the file's imports spell it: `spawnSync`, `spawn`,
//     `execFileSync`, `execFile` and `execSync` by their bare names; `exec` and every `as` alias when imported from
//     child_process; `<ns>.<member>` for a namespace or default import of child_process; and node-pty's `spawn` by
//     any of those spellings (comments, strings and regex literals skipped; the call's extent found by matching its
//     parentheses). A member call on anything else (`re.exec(…)`) is never one.
//   * It EXECUTES a script when its argument text names one: a literal path ending in the scripts' directory and
//     name; an identifier bound to one in that file (a `const`/`let` whose initialiser names the path, or joins a
//     script name onto a binding of the scripts' directory, and READS nothing); one imported under that name, or
//     reached as `<ns>.<name>` through a namespace import, from a module that exports one; or a `for … of` variable
//     over a list naming one, inside that loop's body.
//   * It runs SLICED text when it executes no script file but its argument text names a binding derived from a READ
//     of a script (its text read, then sliced, matched or handed to a helper). Those are counted on their own
//     (D-5251): a BARE one is listed in `SLICED_ALLOWED` with its reason and exact count.
//   * Its env is BARE when it has no `env` at all, `env: process.env` (a trailing `as`/`satisfies` cast ignored), or
//     an object literal or `Object.assign` that takes the parent's env with no builder call AFTER it — directly,
//     through the binding an identifier names, through a spread options object, or through a parameter's default.
//     Anything else (a builder call after the parent's env, a member such as `b.env`, an env built from scratch, a
//     parameter with no default, a helper function's return) is not one of the three shapes, and is the builder's
//     own file's to pin.
//   * The PROGRAM (the first argument; for `exec`/`execSync`, the command line's first word) of every script-naming
//     spawn is a runner, a reader or the script itself, or the census reds until it is placed.
//   * A BARE spawn that EXECUTES a script is a HIT. Every hit is fixed, or listed in `ALLOWED` with its reason and its
//     exact count. Both lists are pinned both ways: an unlisted hit reds, and so does a listed file whose count no
//     longer matches (a stale entry).
//
// What this does NOT see (by design, D-5253): a builder that is itself thin (a `ghContainedEnv(process.env)` with no
// net poisons), which is the builder file's own pin; and an env a helper function CALL returns, in this file or
// another (`memEnv()` in `ccrc-memory.test.ts` and `phEnv()` in `projected-home.test.ts`: each file's own
// `assertNoRealTool` row is what pins it). The fixture corpus at the end decides every spelling above on inline
// sources, so a detector that stops seeing one reds there, not only when a real file regresses.
//
// The script names are built from fragments below, never written as two quoted adjacent segments:
// `single-definition.test.ts`'s scan allows exactly one file to spell the ccd script's path that way.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(__dirname, '..', '..');
const ROOTS = ['server/test', 'agent/test'] as const;
const SELF = 'server/test/raw-spawn-census.test.ts';

/** Files whose BARE spawns of a script are known and reasoned, with their exact count. Claimed files cannot be edited
 *  by this wave; each entry says what it reaches and when it is to be fixed. */
const ALLOWED = new Map<string, { count: number; reason: string }>([
  ['server/test/ccrc-doctor.test.ts', {
    count: 1,
    reason: '`_box_role never asserts a state it did not measure`: sources ccrc and calls `_box_role`, which reads only '
      + 'the preset BOX_UNITS array, with HOME a path that does not exist; no tool runs. The file is under another '
      + 'run\'s claim in wave 18: fix it (ccrcContainedEnv) in the first wave that may write the file.',
  }],
]);

/** Files whose BARE spawns of text SLICED from a script are known and reasoned, with their exact count (D-5251). A
 *  slice runs whatever its functions call, so each reason names the functions and what they reach. */
const SLICED_ALLOWED = new Map<string, { count: number; reason: string }>([
  ['server/test/ccrc-doctor.test.ts', {
    count: 1,
    reason: '`_exp_env_write` with PROG=, _upd_redact and _ccrc_die, sliced from ccrc and run once per exposure arm with '
      + 'the parent\'s env and a fixture HOME; it writes the exposure file under that HOME. Under another run\'s claim in '
      + 'wave 18: give it ccrcContainedEnv in the first wave that may write the file.',
  }],
  ['server/test/ccrc-install.test.ts', {
    count: 2,
    reason: '`_ver_newer` (version arithmetic) and the `_inst_installed` harness R14(b) named (it reads '
      + 'CCRC_UPDATE_VERIFIED and CCRC_UPDATE_SPINE from the inherited env and writes BOX_INSTALLED_FILE under a fixture '
      + 'HOME), each sliced from ccrc and run with no env. Under another run\'s claim in wave 18: give each a builder in '
      + 'the first wave that may write the file.',
  }],
  ['server/test/continued-in-parity.test.ts', {
    count: 1,
    reason: 'ccd\'s CONTINUED_IN_JQ program, sliced from ccd and handed in the env (P) to every jq binary the box has, '
      + 'over fixture files with `tail`; jq and tail are the only tools it runs.',
  }],
  ['server/test/deploy-env-guard.test.ts', {
    count: 1,
    reason: '`_box_env_value`, sliced from ccrc and run with no env against a fixture env file: it reads one key and '
      + 'calls no contained tool.',
  }],
  ['server/test/macos-platform.test.ts', {
    count: 5,
    reason: 'ccd\'s platform block (`platformBlock(ccd)`) run on its own: `runBlock` and the forced-Darwin `darwinBlock` '
      + '(clock and stat arms), `swap` (`_plat_ln_swap`, ln and mv on a stub PATH), the manager payload (its own '
      + 'containment preamble refuses unless systemctl is the stub, and its bus is a fixture under HOME), and the '
      + 'Darwin-only `inBlock`. Run-only in wave 18 by choice: give each a builder in a later wave.',
  }],
  ['server/test/update-semver.test.ts', {
    count: 2,
    reason: '`_ver_newer`, sliced from ccrc and run with no env over a fixture list of tags: version arithmetic, no '
      + 'tool beyond the shell.',
  }],
]);

const D = 'ccd';
const NAMES = `(?:${D}|ccrc)`;
const Q = `['"\`]`;
/** A script path in source text: path segments `…, <D>, <name>)`, or a literal ending `<D>/<name>` and a quote. */
const SCRIPT_PATH = new RegExp(`${Q}${D}${Q}\\s*,\\s*${Q}${NAMES}${Q}\\s*\\)|\\b${D}/${NAMES}${Q}`);
/** The scripts' DIRECTORY in an initialiser's text: a join/resolve whose last segment is `<D>`, or a literal ending
 *  `/<D>` (`updateRealBox.ts` builds `CCRC_SRC` as `join(CCD_DIR, 'ccrc')`). */
const SCRIPT_DIR = new RegExp(`${Q}${D}${Q}\\s*\\)\\s*$|/${D}${Q}\\s*$`);
const READS = /\b(?:readFileSync|readFile|read|execFileSync|spawnSync|execSync|spawn)\s*\(/;
/** A READ of a file's text: what makes a binding SLICED when it also names a script (D-5251). */
const READS_TEXT = /\b(?:readFileSync|readFile|read)\s*\(/;
/** A binding that can only BE a path: a `join`/`resolve` call, a template, another name, or an arrow returning one.
 *  Read on the masked code (strings blanked), so it judges shape, never content. */
const PATHLIKE = new RegExp('^(?:(?:path\\.)?(?:join|resolve)\\s*\\(|`|[A-Za-z_$][\\w$]*\\s*$'
  + '|\\([^)]*\\)\\s*(?::\\s*[\\w.]+\\s*)?=>\\s*(?:(?:path\\.)?(?:join|resolve)\\s*\\(|`))');
const IDENT = /^[A-Za-z_$][\w$]*$/;
/** A name as a regex: `$` escaped, and a dotted name (`ns.CCD`) matched across optional spaces around its dots. */
const pat = (name: string): string => name.split('.').map((x) => x.replace(/\$/g, '\\$')).join('\\s*\\.\\s*');
const word = (name: string): RegExp => new RegExp(`(?<![\\w$.])${pat(name)}(?![\\w$])`);
/** A script named as a segment under a directory binding: `join(<dir>, '<name>')`. */
const under = (dir: string): RegExp => new RegExp(`\\(\\s*${pat(dir)}\\s*,\\s*${Q}${NAMES}${Q}\\s*\\)`);
/** The identifiers a stretch of code USES: a member name (`.x`) and an object-literal key (`{ x: …`) are not uses
 *  (`harness({ run: hang })` names no binding called `run`). */
function idents(code: string): string[] {
  const out = new Set<string>();
  for (const m of code.matchAll(/(?<![\w$.])[A-Za-z_$][\w$]*/g)) {
    let j = m.index! - 1;
    while (j >= 0 && /\s/.test(code[j]!)) j--;
    let k = m.index! + m[0].length;
    while (k < code.length && /\s/.test(code[k]!)) k++;
    if ((code[j] === '{' || code[j] === ',') && code[k] === ':' && code[k + 1] !== ':') continue;
    out.add(m[0]);
  }
  return [...out];
}

/** `src` with comments blanked (`text`), and with string, template-literal text and regex bodies blanked as well
 *  (`code`): same length, same line breaks, so an offset means the same place in all three. */
function mask(src: string): { text: string; code: string } {
  const text = src.split('');
  const code = src.split('');
  const blank = (i: number, both: boolean): void => {
    if (src[i] === '\n') return;
    code[i] = ' ';
    if (both) text[i] = ' ';
  };
  const stack: number[] = []; // template nesting: brace depth at each `${`
  let i = 0;
  let depth = 0;
  let prev = ''; // last non-space code character
  const scanString = (quote: string): void => {
    i++;
    while (i < src.length && src[i] !== quote) {
      if (src[i] === '\\') { blank(i, false); i++; }
      if (i < src.length) blank(i, false);
      i++;
    }
    i++;
  };
  const scanTemplate = (): void => {
    // Called at the char after a backtick, or after the `}` that closes a `${`.
    while (i < src.length) {
      if (src[i] === '\\') { blank(i, false); blank(i + 1, false); i += 2; continue; }
      if (src[i] === '`') { i++; return; }
      if (src[i] === '$' && src[i + 1] === '{') { stack.push(depth); depth++; i += 2; return; }
      blank(i, false);
      i++;
    }
  };
  while (i < src.length) {
    const c = src[i]!;
    const n = src[i + 1];
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') { blank(i, true); i++; } continue; }
    if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      for (; i < stop; i++) blank(i, true);
      continue;
    }
    if (c === '\'' || c === '"') { scanString(c); prev = c; continue; }
    if (c === '`') { i++; scanTemplate(); prev = '`'; continue; }
    if (c === '/' && (prev === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prev))) {
      i++;
      let cls = false;
      while (i < src.length && src[i] !== '\n' && (cls || src[i] !== '/')) {
        if (src[i] === '\\') { blank(i, false); i++; } else if (src[i] === '[') cls = true; else if (src[i] === ']') cls = false;
        if (i < src.length) blank(i, false);
        i++;
      }
      i++;
      prev = '/';
      continue;
    }
    if (c === '{') depth++;
    if (c === '}') {
      depth--;
      if (stack.length > 0 && depth === stack[stack.length - 1]) { stack.pop(); i++; scanTemplate(); prev = '`'; continue; }
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return { text: text.join(''), code: code.join('') };
}

/** The index of the bracket that closes the one at `open`, read on `code`. */
function closeOf(code: string, open: number): number {
  let d = 0;
  for (let i = open; i < code.length; i++) {
    const c = code[i]!;
    if (c === '(' || c === '[' || c === '{') d++;
    else if (c === ')' || c === ']' || c === '}') { d--; if (d === 0) return i; }
  }
  return code.length - 1;
}

/** The top-level comma-separated parts of the bracketed span [open, close] of `code`, as [start, end) offsets. */
function partsOf(code: string, open: number, close: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let d = 0;
  let start = open + 1;
  for (let i = open + 1; i < close; i++) {
    const c = code[i]!;
    if (c === '(' || c === '[' || c === '{') d++;
    else if (c === ')' || c === ']' || c === '}') d--;
    else if (c === ',' && d === 0) { out.push([start, i]); start = i + 1; }
  }
  if (code.slice(start, close).trim() !== '') out.push([start, close]);
  return out;
}

interface Src { rel: string; raw: string; text: string; code: string }
interface Binding { name: string; at: number; init: [number, number] }

/** Every `const|let|var <name> [: type] = <init>` in a file, the initialiser running to a depth-0 `;` or line end. */
function bindingsOf(s: Src): Binding[] {
  const out: Binding[] = [];
  for (const m of s.code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;\n]*)?=(?!=|>)/g)) {
    let i = m.index! + m[0].length;
    let d = 0;
    const start = i;
    for (; i < s.code.length; i++) {
      const c = s.code[i]!;
      if (c === '(' || c === '[' || c === '{') d++;
      else if (c === ')' || c === ']' || c === '}') { if (d === 0) break; d--; }
      else if (d === 0 && (c === ';' || (c === '\n' && !/[=,(&|?:+]\s*$/.test(s.code.slice(start, i))
        && !/^\s*[.?:&|+]/.test(s.code.slice(i + 1, i + 40))))) break;
    }
    out.push({ name: m[1]!, at: m.index!, init: [start, i] });
  }
  return out;
}
const nearest = (bs: Binding[], name: string, at: number): Binding | undefined =>
  bs.filter((x) => x.name === name && x.at < at).pop();

const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
  return /\.(?:ts|mts|mjs|js)$/.test(e.name) ? [p] : [];
});
const toSrc = (rel: string, raw: string): Src => ({ rel, raw, ...mask(raw) });
const SOURCES: Src[] = ROOTS.flatMap((r) => walk(path.join(REPO, r)))
  .map((p) => path.relative(REPO, p))
  .filter((rel) => rel !== SELF)
  .map((rel) => toSrc(rel, fs.readFileSync(path.join(REPO, rel), 'utf8')));
const lineOf = (s: Src, at: number): number => s.raw.slice(0, at).split('\n').length;

interface Paths { scripts: Set<string>; dirs: Set<string> }
interface Names extends Paths { scoped: Array<{ name: string; from: number; to: number }> }

/** The identifiers a file binds to a script path or to the scripts' directory, closed over aliases within the file,
 *  and the `for … of` variables over a list naming a script, each with its loop body's extent. */
function namesOf(s: Src, imported: Paths): Names {
  const scripts = new Set(imported.scripts);
  const dirs = new Set(imported.dirs);
  const bs = bindingsOf(s);
  for (let changed = true; changed;) {
    changed = false;
    for (const b of bs) {
      if (scripts.has(b.name) || dirs.has(b.name)) continue;
      const text = s.text.slice(...b.init).trim();
      const code = s.code.slice(...b.init).trim();
      if (READS.test(code) || !PATHLIKE.test(code)) continue;
      if (SCRIPT_PATH.test(text) || [...scripts].some((n) => word(n).test(code))
        || [...dirs].some((d) => under(d).test(text))) {
        scripts.add(b.name);
        changed = true;
      } else if (SCRIPT_DIR.test(text) || [...dirs].some((d) => new RegExp(`^${pat(d)}$`).test(code))) {
        dirs.add(b.name);
        changed = true;
      }
    }
  }
  const scoped: Names['scoped'] = [];
  for (const m of s.code.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s+of\s+/g)) {
    const head = s.code.indexOf('(', m.index!);
    const headEnd = closeOf(s.code, head);
    let [a, b] = [m.index! + m[0].length, headEnd];
    const iterName = s.code.slice(a, b).trim();
    if (IDENT.test(iterName)) {
      const bind = nearest(bs, iterName, m.index!);
      if (!bind) continue;
      [a, b] = bind.init;
    }
    const iterCode = s.code.slice(a, b).trim();
    if (!iterCode.startsWith('[')) continue;
    if (!SCRIPT_PATH.test(s.text.slice(a, b)) && ![...scripts].some((n) => word(n).test(iterCode))) continue;
    let from = headEnd + 1;
    while (from < s.code.length && /\s/.test(s.code[from]!)) from++;
    let to = from;
    if (s.code[from] === '{') to = closeOf(s.code, from);
    else {
      for (let d = 0; to < s.code.length; to++) {
        const c = s.code[to]!;
        if (c === '(' || c === '[' || c === '{') d++;
        else if (c === ')' || c === ']' || c === '}') d--;
        else if (c === ';' && d === 0) break;
      }
    }
    scoped.push({ name: m[1]!, from, to });
  }
  return { scripts, dirs, scoped };
}

/** Every module's exported script and directory names (its own bindings only). */
function exportsOf(srcs: Src[]): Map<string, Paths> {
  const out = new Map<string, Paths>();
  for (const s of srcs) {
    const own = namesOf(s, { scripts: new Set(), dirs: new Set() });
    const ex = [...s.code.matchAll(/\bexport\s+(?:const|let)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]!);
    const p: Paths = { scripts: new Set(ex.filter((n) => own.scripts.has(n))), dirs: new Set(ex.filter((n) => own.dirs.has(n))) };
    if (p.scripts.size + p.dirs.size > 0) out.set(s.rel, p);
  }
  return out;
}

/** The script and directory names a file imports: by name (an `as` alias kept), or as `<ns>.<name>` through a
 *  namespace import. */
function importsOf(s: Src, exported: Map<string, Paths>): Paths {
  const out: Paths = { scripts: new Set(), dirs: new Set() };
  const target = (spec: string): string =>
    path.relative(REPO, path.resolve(REPO, path.dirname(s.rel), spec)).replace(/\.js$/, '.ts');
  for (const m of s.text.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const ex = exported.get(target(m[2]!));
    if (!ex) continue;
    for (const spec of m[1]!.split(',')) {
      const [orig, alias] = spec.replace(/\btype\s+/, '').trim().split(/\s+as\s+/);
      const o = (orig ?? '').trim();
      const as = (alias ?? o).trim();
      if (ex.scripts.has(o)) out.scripts.add(as);
      if (ex.dirs.has(o)) out.dirs.add(as);
    }
  }
  for (const m of s.text.matchAll(/import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s+from\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const ex = exported.get(target(m[2]!));
    if (!ex) continue;
    for (const n of ex.scripts) out.scripts.add(`${m[1]}.${n}`);
    for (const n of ex.dirs) out.dirs.add(`${m[1]}.${n}`);
  }
  return out;
}

const FAMILY = ['spawnSync', 'spawn', 'execFileSync', 'execFile', 'execSync', 'exec'] as const;
/** Their first argument is a command LINE, not a program. */
const SHELL = new Set<string>(['execSync', 'exec']);
const CP = String.raw`['"](?:node:)?child_process['"]`;
/** The spellings that call a spawn in a file, each mapped to the member it is: the bare names (`exec` only when
 *  imported), every `as` alias of a child_process import, `<ns>.<member>` for a namespace or default import of
 *  child_process, and node-pty's `spawn` by any of those spellings. */
function calleesOf(s: Src): Map<string, string> {
  const out = new Map<string, string>(FAMILY.filter((f) => f !== 'exec').map((f) => [f, f]));
  const named = (list: string, keep: (orig: string) => string | null): void => {
    for (const spec of list.split(',')) {
      const [orig, alias] = spec.replace(/\btype\s+/, '').trim().split(/\s+as\s+/);
      const o = (orig ?? '').trim();
      const k = keep(o);
      if (k) out.set((alias ?? o).trim(), k);
    }
  };
  for (const m of s.text.matchAll(new RegExp(String.raw`import\s*\{([^}]*)\}\s*from\s*${CP}`, 'g'))) {
    named(m[1]!, (o) => ((FAMILY as readonly string[]).includes(o) ? o : null));
  }
  for (const m of s.text.matchAll(new RegExp(String.raw`import\s+(?:\*\s*as\s+)?([A-Za-z_$][\w$]*)\s+from\s*${CP}`, 'g'))) {
    for (const f of FAMILY) out.set(`${m[1]}.${f}`, f);
  }
  for (const m of s.text.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]node-pty['"]/g)) {
    named(m[1]!, (o) => (o === 'spawn' ? 'pty.spawn' : null));
  }
  for (const m of s.text.matchAll(/import\s+(?:\*\s*as\s+)?([A-Za-z_$][\w$]*)\s+from\s*['"]node-pty['"]/g)) {
    out.set(`${m[1]}.spawn`, 'pty.spawn');
  }
  return out;
}
const spawnRe = (callees: Map<string, string>): RegExp => new RegExp(
  `(?<![\\w$.])(${[...callees.keys()].sort((a, b) => b.length - a.length).map(pat).join('|')})\\s*\\(`, 'g');

/** The program a spawn runs: its first argument's text, or for a command line the line's first word (`'bash'`) or
 *  the name it interpolates first (`${CCRC}`). */
function programOf(s: Src, open: number, close: number, member: string): string {
  const first = partsOf(s.code, open, close)[0];
  if (!first) return '';
  const t = s.text.slice(...first).trim();
  if (!SHELL.has(member)) return t;
  const m = /^[`'"]\s*(?:\$\{\s*([A-Za-z_$][\w$.]*)\s*\}|([^\s`'"$]+))/.exec(t);
  return m ? (m[1] ?? `'${m[2]}'`) : t;
}

/** Which bindings hold text SLICED from a script (D-5251): an initialiser that READS a script, or that names a
 *  binding already sliced. Decided per binding, an identifier resolving to its nearest earlier binding, so a later
 *  `src` that holds something else is not caught by an earlier one, and a script NAME bound elsewhere in the file
 *  under the same name (script names are per file, not per binding) does not hide a read. */
function slicedAt(s: Src, bs: Binding[], scripts: Set<string>): (name: string, at: number) => boolean {
  const byName = new Map<string, Binding[]>();
  for (const b of bs) byName.set(b.name, [...(byName.get(b.name) ?? []), b]);
  const sliced = new Set<number>();
  const is = (name: string, at: number): boolean => {
    const b = (byName.get(name) ?? []).filter((x) => x.at < at).pop();
    return b !== undefined && sliced.has(b.at);
  };
  for (let changed = true; changed;) {
    changed = false;
    for (const b of bs) {
      if (sliced.has(b.at)) continue;
      const text = s.text.slice(...b.init);
      const code = s.code.slice(...b.init);
      const reads = READS_TEXT.test(code) && (SCRIPT_PATH.test(text) || [...scripts].some((n) => word(n).test(code)));
      if (reads || idents(code).some((n) => is(n, b.at))) { sliced.add(b.at); changed = true; }
    }
  }
  return is;
}

type Shape = 'no env' | 'env: process.env' | '{ ...process.env } without a builder';
const LITERAL: Shape = '{ ...process.env } without a builder';
const BUILDER = /\b(?:ghContainedEnv|ccrcContainedEnv)\s*\(/;
const BUILDER_G = new RegExp(BUILDER.source, 'g');
const SPREAD_PARENT = /\.\.\.\s*process\.env\b/g;
const ARG_PARENT = /(?<=[(,])\s*process\.env\s*(?=[,)])/g;

/** An expression with a trailing `as`/`satisfies` cast and its wrapping parentheses removed. */
function stripCast(e: string): string {
  let x = e.trim();
  for (let i = 0; i < 4; i++) {
    const y = x.replace(/\s+(?:as|satisfies)\s+[\w$.<>[\],|&\s]+$/, '').trim();
    const z = /^\(([\s\S]*)\)$/.exec(y)?.[1]?.trim() ?? y;
    if (z === x) break;
    x = z;
  }
  return x;
}

/** True when the parent's env appears in `inner` AFTER every builder call ends: a later spread or argument wins, so
 *  `{ ...ghContainedEnv(h), ...process.env }` is the parent's env again, and a builder AFTER it contains it. */
function parentWins(inner: string, parent: RegExp): boolean {
  const at = [...inner.matchAll(parent)].map((m) => m.index!);
  if (at.length === 0) return false;
  let end = -1;
  for (const m of inner.matchAll(BUILDER_G)) end = Math.max(end, closeOf(inner, m.index! + m[0].length - 1));
  return at[at.length - 1]! > end;
}

/** The bare shape of an env EXPRESSION at [a, b), or null; an identifier is followed to its nearest earlier binding,
 *  or to its default when it is a parameter. */
function bareEnv(s: Src, a: number, b: number, bs: Binding[], hops = 0): Shape | null {
  const expr = stripCast(s.code.slice(a, b));
  if (expr === 'process.env') return 'env: process.env';
  if (/^Object\s*\.\s*assign\s*\(/.test(expr)) {
    const o = s.code.indexOf('(', s.code.indexOf('assign', a));
    const inner = s.code.slice(o, closeOf(s.code, o) + 1);
    return parentWins(inner, ARG_PARENT) || parentWins(inner, SPREAD_PARENT) ? LITERAL : null;
  }
  if (expr.startsWith('{')) {
    const open = s.code.indexOf('{', a);
    const inner = s.code.slice(open, closeOf(s.code, open) + 1);
    if (parentWins(inner, SPREAD_PARENT)) return LITERAL;
    if (BUILDER.test(inner)) return null;
    // `{ ...env, X }`: the spread identifier's own binding decides.
    for (const m of inner.matchAll(/\.\.\.\s*([A-Za-z_$][\w$]*)\s*(?=[,}])/g)) {
      const r = identEnv(s, m[1]!, a, bs, hops);
      if (r) return r;
    }
    return null;
  }
  if (IDENT.test(expr)) return identEnv(s, expr, a, bs, hops);
  return null;
}
function identEnv(s: Src, name: string, at: number, bs: Binding[], hops: number): Shape | null {
  if (hops > 3) return null;
  const b = nearest(bs, name, at);
  if (b) return bareEnv(s, b.init[0], b.init[1], bs, hops + 1);
  // A parameter with a default (`(env = process.env) => …`): the default is what a call without it gets.
  let last: RegExpMatchArray | undefined;
  const param = new RegExp(`[(,]\\s*${pat(name)}\\s*(?::[^=,()]*)?=(?![=>])\\s*`, 'g');
  for (const m of s.code.slice(0, at).matchAll(param)) last = m;
  if (!last) return null; // a parameter with no default: its caller's to pin
  const start = last.index! + last[0].length;
  let i = start;
  for (let d = 0; i < s.code.length; i++) {
    const c = s.code[i]!;
    if (c === '(' || c === '[' || c === '{') d++;
    else if (c === ')' || c === ']' || c === '}') { if (d === 0) break; d--; }
    else if (c === ',' && d === 0) break;
  }
  return bareEnv(s, start, i, bs, hops + 1);
}

/** The env of an options object at [a, b): the LAST `env` key or spread decides, as it does in JS. A spread that
 *  cannot be followed leaves the env undecided here (null); one that names no env changes nothing. */
function optsEnv(s: Src, a: number, b: number, bs: Binding[], hops: number): Shape | null {
  if (hops > 3) return null;
  const opt = stripCast(s.code.slice(a, b));
  if (IDENT.test(opt)) {
    const bind = nearest(bs, opt, a);
    return bind ? optsEnv(s, bind.init[0], bind.init[1], bs, hops + 1) : null; // a parameter: its caller's to pin
  }
  if (!opt.startsWith('{')) return opt.startsWith('[') || /^['"`]/.test(opt) ? 'no env' : null;
  const o = s.code.indexOf('{', a);
  let result: Shape | null = 'no env';
  for (const [pa, pb] of partsOf(s.code, o, closeOf(s.code, o))) {
    const p = s.code.slice(pa, pb).trim();
    if (/^env\s*:/.test(p)) result = bareEnv(s, pa + s.code.slice(pa, pb).indexOf(':') + 1, pb, bs);
    else if (p === 'env') result = identEnv(s, 'env', pa, bs, 0);
    else if (p.startsWith('...')) {
      const name = p.slice(3).trim();
      const bind = IDENT.test(name) ? nearest(bs, name, pa) : undefined;
      if (!bind) { result = null; continue; }
      const r = optsEnv(s, bind.init[0], bind.init[1], bs, hops + 1);
      if (r !== 'no env') result = r;
    }
  }
  return result;
}
/** The env of a spawn call: its last argument when it has two or more, else none. */
function envOf(s: Src, open: number, close: number, bs: Binding[]): Shape | null {
  const parts = partsOf(s.code, open, close);
  if (parts.length < 2) return 'no env';
  const [a, b] = parts[parts.length - 1]!;
  return optsEnv(s, a, b, bs, 0);
}

/** The PROGRAM (a spawn's first argument) decides whether a script it names is run or only read. Every program a
 *  script-naming spawn uses is in one of these two sets, or the census reds until it is placed: a new spelling (a
 *  `'sh'`, a `'timeout'`) is a decision, never a default. */
const RUNNERS = new Set(["'bash'", 'BASH', 'DEADLINE_BIN', 'DOCTOR_DEADLINE_BIN']);
const READERS = new Set(["'git'"]); // `git show <rev>:<path>` and `git ls-files <path>` name the script as a path
interface Spawn {
  file: string; line: number; kind: 'script' | 'sliced' | null; prog: string; placed: boolean;
  shape: Shape | null; argText: string;
}
interface Hit { file: string; line: number; shape: Shape }
interface Census {
  spawns: Spawn[]; hits: Hit[]; slicedHits: Hit[]; unplaced: string[]; programs: Map<string, number>;
  exported: Map<string, Paths>;
}

/** Every spawn-family call in a set of sources, classified; the hits are the BARE ones that run a script, and the
 *  sliced hits the BARE ones that run text sliced from one. */
function analyse(srcs: Src[]): Census {
  const exported = exportsOf(srcs);
  const spawns: Spawn[] = [];
  for (const s of srcs) {
    const n = namesOf(s, importsOf(s, exported));
    const bs = bindingsOf(s);
    const sliced = slicedAt(s, bs, n.scripts);
    const callees = calleesOf(s);
    for (const m of s.code.matchAll(spawnRe(callees))) {
      const member = callees.get(m[1]!.replace(/\s+/g, '')) ?? m[1]!;
      const open = m.index! + m[0].length - 1;
      const close = closeOf(s.code, open);
      const code = s.code.slice(open, close + 1);
      const argText = s.text.slice(open, close + 1);
      const scoped = n.scoped.filter((x) => m.index! >= x.from && m.index! <= x.to).map((x) => x.name);
      const named = SCRIPT_PATH.test(argText) || [...n.scripts, ...scoped].some((x) => word(x).test(code));
      const prog = programOf(s, open, close, member);
      const reader = READERS.has(prog);
      const slice = !named && idents(code).some((x) => sliced(x, m.index!));
      spawns.push({
        file: s.rel, line: lineOf(s, m.index!),
        kind: named && !reader ? 'script' : slice && !reader ? 'sliced' : null,
        prog: named ? prog : '',
        placed: !named || RUNNERS.has(prog) || reader || n.scripts.has(prog) || scoped.includes(prog),
        shape: envOf(s, open, close, bs), argText,
      });
    }
  }
  const programs = new Map<string, number>();
  for (const x of spawns) if (x.prog !== '') programs.set(x.prog, (programs.get(x.prog) ?? 0) + 1);
  const hits = (k: 'script' | 'sliced'): Hit[] => spawns.filter((x) => x.kind === k && x.shape !== null)
    .map((x) => ({ file: x.file, line: x.line, shape: x.shape! }));
  return {
    spawns, hits: hits('script'), slicedHits: hits('sliced'), programs, exported,
    unplaced: spawns.filter((x) => !x.placed).map((x) => `${x.file}:${x.line} (${x.prog})`),
  };
}

const fmt = (h: Hit): string => `${h.file}:${h.line} (${h.shape})`;
/** Every hit is listed with its exact count, and every listed file still holds that many: pinned both ways. */
function pinned(hs: Hit[], list: Map<string, { count: number }>, name: string, what: string): void {
  const counts = new Map<string, Hit[]>();
  for (const h of hs) counts.set(h.file, [...(counts.get(h.file) ?? []), h]);
  const unlisted = [...counts].filter(([f]) => !list.has(f)).flatMap(([, x]) => x).map(fmt);
  expect(unlisted, `${what}: ${unlisted.join(', ')}`).toEqual([]);
  for (const [f, a] of list) {
    const got = counts.get(f) ?? [];
    expect(got.length, `${name} says ${a.count} for ${f}; measured ${got.map((x) => x.line).join(', ') || 'none'}`)
      .toBe(a.count);
  }
}

/** Inline sources, one spelling per line, each line that must be a hit carrying its verdict in a trailing
 *  `// expect: <script|sliced> <shape>` comment; a line with no comment must be no hit. */
const fixture = (rel: string, lines: string[]): Src => toSrc(rel, `${lines.join('\n')}\n`);
const CORPUS: Src[] = [
  fixture('fixture/test/paths.ts', [
    "import path from 'node:path';",
    `export const CCRC = path.join(ROOT, '${D}', 'ccrc');`,
    `export const SCRIPTS_DIR = path.resolve(ROOT, '..', '${D}');`,
  ]),
  fixture('fixture/test/spellings.test.ts', [
    "import { spawnSync, execFileSync as run, exec } from 'node:child_process';",
    "import * as cp from 'node:child_process';",
    "import * as pty from 'node-pty';",
    "import * as P from './paths.js';",
    "import { CCRC, SCRIPTS_DIR } from './paths.js';",
    "const SRC = path.join(SCRIPTS_DIR, 'ccrc');",
    "const text = readFileSync(CCRC, 'utf8');",
    'const base = { env: process.env };',
    "spawnSync('bash', [CCRC]); // expect: script no env",
    "spawnSync('bash', [CCRC], { encoding: 'utf8' }); // expect: script no env",
    'execSync(`bash ${CCRC} y`); // expect: script no env',
    "spawnSync('bash', [CCRC], { env: process.env }); // expect: script env: process.env",
    "spawnSync('bash', [CCRC], { env: { ...process.env, HOME: d } }); // expect: script { ...process.env } without a builder",
    "const e = { ...process.env, HOME: d }; spawnSync('bash', [CCRC], { env: e }); // expect: script { ...process.env } without a builder",
    "spawnSync('bash', [CCRC], { env: process.env as Record<string, string> }); // expect: script env: process.env",
    "spawnSync('bash', [CCRC], { ...base, encoding: 'utf8' }); // expect: script env: process.env",
    "spawnSync('bash', [CCRC], { env: Object.assign({}, process.env, { HOME: d }) }); // expect: script { ...process.env } without a builder",
    "spawnSync('bash', [CCRC], { env: { ...ghContainedEnv(d), ...process.env } }); // expect: script { ...process.env } without a builder",
    "const f = (env = process.env) => spawnSync('bash', [CCRC], { env }); // expect: script env: process.env",
    "run('bash', [SRC], { env: process.env }); // expect: script env: process.env",
    "cp.spawnSync('bash', [P.CCRC], { env: process.env }); // expect: script env: process.env",
    "pty.spawn('bash', [CCRC], { env: process.env as Record<string, string> }); // expect: script env: process.env",
    'exec(`bash ${CCRC} x`, { env: process.env }); // expect: script env: process.env',
    "for (const s of [CCRC]) spawnSync('bash', [s], { env: process.env }); // expect: script env: process.env",
    "spawnSync('bash', ['-c', text], { env: process.env }); // expect: sliced env: process.env",
    "spawnSync('bash', [CCRC], { env: ghContainedEnv(d, { ...process.env }) });",
    "spawnSync('bash', [CCRC], { env: { ...process.env, ...ccrcContainedEnv(d) } });",
    "spawnSync('bash', [CCRC], { env: memEnv() });",
    "spawnSync('git', ['show', `HEAD:${CCRC}`]);",
    "spawnSync('bash', ['-c', 'command -v curl'], { env: process.env });",
    '/re/.exec(CCRC);',
  ]),
];

describe('every spawn of the real ccd or ccrc script gets a contained env (wave 18, R14(b))', () => {
  const c = analyse(SOURCES);

  it('found the trees, the scripts and the spawns it is about', () => {
    // A census of nothing passes everything: each half must be measuring something, and the halves are named.
    expect([...ROOTS], 'both test trees, by name').toEqual(['server/test', 'agent/test']);
    for (const r of ROOTS) expect(SOURCES.filter((s) => s.rel.startsWith(`${r}/`)).length, r).toBeGreaterThan(5);
    expect([...(c.exported.get('server/test/ccdWsHelpers.ts')?.scripts ?? [])], 'the harness exports the ccd script path')
      .toContain('CCD');
    expect(c.spawns.filter((x) => x.kind === 'script').length, 'spawns that execute a script').toBeGreaterThan(100);
  });

  it('every BARE spawn of a script is in ALLOWED, with its exact count; no entry is stale', () => {
    pinned(c.hits, ALLOWED, 'ALLOWED', 'a script spawned with the parent\'s env');
  });

  it('every BARE spawn of text sliced from a script is in SLICED_ALLOWED, with its exact count; no entry is stale', () => {
    pinned(c.slicedHits, SLICED_ALLOWED, 'SLICED_ALLOWED', 'sliced script text spawned with the parent\'s env');
  });

  it('every program a script-naming spawn uses is placed: a runner, a reader, or the script itself', () => {
    expect(c.unplaced, `place each in RUNNERS or READERS: ${c.unplaced.join(', ')}`).toEqual([]);
    for (const p of [...RUNNERS, ...READERS]) expect(c.programs.get(p) ?? 0, `${p} is placed but no spawn uses it`).toBeGreaterThan(0);
  });

  it('every ALLOWED and SLICED_ALLOWED entry carries a reason', () => {
    for (const [f, a] of [...ALLOWED, ...SLICED_ALLOWED]) expect(a.reason.trim().length, f).toBeGreaterThan(40);
  });

  it('decides the function-extraction spawn R14(b) named by rule: no env, and it runs sliced text, not the script', () => {
    // `ccrc-install.test.ts`'s `_inst_installed` harness: `bash -c <harness>`, the harness text sliced out of the
    // script, with no env. Not an ALLOWED hit by the EXECUTES rule; counted in SLICED_ALLOWED (D-5251). A change
    // that made it spawn the script itself would turn it into an ALLOWED hit here.
    const src = SOURCES.find((s) => s.rel === 'server/test/ccrc-install.test.ts')!.raw.split('\n');
    const inst = c.spawns.filter((x) => x.file === 'server/test/ccrc-install.test.ts' && /\['-c', harness\]/.test(x.argText)
      && src.slice(x.line - 30, x.line).some((l) => l.includes('/^_inst_installed\\(\\) \\{')));
    expect(inst.length, 'the _inst_installed harness spawn').toBe(1);
    expect(inst[0]!.shape, 'it has no env').toBe('no env');
    expect(inst[0]!.kind, 'it runs text sliced from the script').toBe('sliced');
  });

  it('decides every spelling on a fixture corpus: each line gets the verdict its comment names, and no other line gets one', () => {
    const got = analyse(CORPUS);
    const want = (k: 'script' | 'sliced'): string[] => CORPUS.flatMap((s) => s.raw.split('\n').flatMap((l, i) => {
      const m = /\/\/ expect: (script|sliced) (.+)$/.exec(l);
      return m && m[1] === k ? [`${s.rel}:${i + 1} (${m[2]})`] : [];
    }));
    expect(got.hits.map(fmt).sort(), 'scripts').toEqual(want('script').sort());
    expect(got.slicedHits.map(fmt).sort(), 'sliced text').toEqual(want('sliced').sort());
  });
});
````

  **Run it with the three hit files at the base** (the census first, the fixes second). Expected red-first *(reviser, measured standalone over `git archive 256b25ecb`; the prototype measured the same seven under vitest)*: 6 of 7 rows green.
  - "every BARE spawn of a script is in ALLOWED" is red with exactly seven hits:
    ```
    server/test/ccrc-memory.test.ts:18 ({ ...process.env } without a builder)
    server/test/ccrc-memory.test.ts:405 ({ ...process.env } without a builder)
    server/test/ccrc-memory.test.ts:932 ({ ...process.env } without a builder)
    server/test/ccrc-memory.test.ts:960 ({ ...process.env } without a builder)
    server/test/projected-home.test.ts:47 ({ ...process.env } without a builder)
    server/test/projected-home.test.ts:658 ({ ...process.env } without a builder)
    server/test/runbook-holds.test.ts:152 ({ ...process.env } without a builder)
    ```
    The census reports the line of the spawn call; Step 1's anchors are the env lines just below.
  - `SLICED_ALLOWED`'s row, row 6 (`sliced`) and the corpus row are green on the base. `main` may have moved since, so under vitest the worker re-measures all seven. A further hit, or a changed sliced count, follows Step 3's rule, and the worker reads each slice against its reason before the commit.
  - If row 6 reads `null`, a slice spelling was missed: refine `slicedAt`, and record the refinement under a reserve number.
  - Row 4 lists any program a new spelling brings that is not yet placed. On the base, the placed programs are `'bash'` (103), `BASH` (75), `DEADLINE_BIN` (1), `DOCTOR_DEADLINE_BIN` (2) and `'git'` (2) *(reviser, measured standalone)*.
  - A sliced or script spawn the worker finds to be a false member (an identifier that only shares a name with a sliced binding) is reported, never silently accepted. The rule is narrowed only by a scope like the `for … of` names, with a corpus line that pins it.

- [ ] **Step 3: Fix the hits.**
  - **The rule for any hit beyond the prototype's seven** *(revised)*. If it is in an unclaimed file and the fix is a builder at the call site: first claim that file (one more all-or-nothing claim call), take the next reserve number, and say so under `## Deviations found`, then fix it. If it is in a claimed or run-only file: add it to `ALLOWED` with its reason and count. Never widen a file's entry silently.
  - `projected-home.test.ts` *(revised, unmeasured; the prototype gave each helper the builder inline, measured 57 green)*:

````diff
diff --git a/server/test/projected-home.test.ts b/server/test/projected-home.test.ts
--- a/server/test/projected-home.test.ts
+++ b/server/test/projected-home.test.ts
@@ -21,7 +21,8 @@ import { parseRoster } from '../../shared/roster.js';
 import { leastLoadedCases, type LeastLoadedCase } from './fixtures/leastLoaded.js';
 import { mkTmp } from './tmpHelpers.js';
 import { seedRoster, DEFAULT_TEST_ROSTER } from './helpers.js';
-import { CCD, plantPoolEpoch, seedAccountsSh } from './ccdWsHelpers.js';
+import { CCD, ghContainedEnv, plantPoolEpoch, seedAccountsSh } from './ccdWsHelpers.js';
+import { assertNoRealTool } from './containedTools.js';
 
 let home: string;
 
@@ -45,7 +46,13 @@ const now = (): number => Math.floor(Date.now() / 1000);
 
+/** The env both `source CCD` helpers below spawn with (wave 18, R14(b)): the fixture HOME; the manager, tmux, gh and
+ *  net poisons first on PATH; and the fixture user bus that rides `systemd` (D-5248). One builder, so the row below
+ *  pins what both helpers get. */
+const phEnv = (h: string): NodeJS.ProcessEnv =>
+  ghContainedEnv(h, { ...process.env, HOME: h }, { systemd: true, tmux: true, net: true });
+
 const sh = (snippet: string): string =>
   execFileSync('bash', ['-c', `source "${CCD}"; ${snippet}`],
-    { encoding: 'utf8', env: { ...process.env, HOME: home } }).trim();
+    { encoding: 'utf8', env: phEnv(home) }).trim();
 
 beforeEach(() => {
   home = mkTmp('ccrc-projected-');
@@ -64,4 +71,10 @@ beforeEach(() => {
 });
 
 afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });
+
+describe('projected-home spawns ccd contained (wave 18, R14(b))', () => {
+  it('the env both ccd helpers here use passes assertNoRealTool', () => {
+    expect(() => assertNoRealTool(phEnv(home), home)).not.toThrow();
+  });
+});
@@ -656,7 +669,7 @@ describe('ccd and projectHome agree about telemetry, not only about limits files
 
   const shH = (snippet: string): string =>
     execFileSync('bash', ['-c', `source "${CCD}"; ${snippet}`],
-      { encoding: 'utf8', env: { ...process.env, HOME: h } }).trim();
+      { encoding: 'utf8', env: phEnv(h) }).trim();
 
   afterEach(() => { if (h !== undefined) fs.rmSync(h, { recursive: true, force: true }); });
 
````

  `projected-home`'s `beforeEach` writes wrapper stubs (`claude`, `claude-a`, …) into `<home>/.local/bin`, which is `harnessBin(home)`. None of them is a contained tool, and the poisons are create-if-absent, so neither displaces the other.

  `ccrc-memory.test.ts` and `runbook-holds.test.ts`, as the prototype measured them (unchanged):

````diff
diff --git a/server/test/ccrc-memory.test.ts b/server/test/ccrc-memory.test.ts
index 5370a5f7f..0956b926d 100644
--- a/server/test/ccrc-memory.test.ts
+++ b/server/test/ccrc-memory.test.ts
@@ -3,6 +3,8 @@ import { spawnSync } from 'node:child_process';
 import fs from 'node:fs';
 import path from 'node:path';
 import { mkTmp } from './tmpHelpers.js';
+import { ccrcContainedEnv } from './ccrcContainment.js';
+import { assertNoRealTool } from './containedTools.js';
 // The scratch vocabulary has ONE home: server/test/scratchSlugs.ts. Its
 // comment carries the rule, why /var/tmp is the negative control, and why
 // the Darwin spelling of that control is the one a Linux-only pin misses.
@@ -13,10 +15,15 @@ let home: string;
 beforeEach(() => { home = mkTmp('ccrc-memory-'); });
 afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });
 
+/** The env every spawn of ccrc in this file runs under (wave 18, R14(b)): the fixture HOME and bus, and a recording
+ *  poison for every CONTAINED_TOOLS name first on PATH. `extra` lands last, as the old literal's did. */
+const memEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv =>
+  ({ ...ccrcContainedEnv(home, process.env, { managers: true, curl: 'poison' }), ...extra });
+
 const run = (args: string[], extraEnv: Record<string, string> = {})
   : { code: number; out: string } => {
   const r = spawnSync('bash', [CCRC, ...args],
-    { env: { ...process.env, HOME: home, ...extraEnv }, encoding: 'utf8' });
+    { env: memEnv(extraEnv), encoding: 'utf8' });
   return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
 };
 
@@ -27,6 +34,12 @@ function seed(homeSuffix: string, slug: string, files: Record<string, string>):
   for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(d, n), c);
 }
 
+describe('ccrc memory runs contained (wave 18, R14(b))', () => {
+  it('the env every spawn here uses passes assertNoRealTool', () => {
+    expect(() => assertNoRealTool(memEnv(), home)).not.toThrow();
+  });
+});
+
 describe('ccrc memory — the census', () => {
   it('names a home that holds a plain memory directory', () => {
     seed('.claude', '-p-demo', { 'a.md': 'x' });
@@ -275,7 +288,8 @@ describe('ccrc memory --apply — the union', () => {
       + 'for a in "$@"; do [ "$a" = "$RACE_LINK" ] && ln -s "$RACE_STORE" "$RACE_LINK" 2>/dev/null; done\n'
       + 'exit $rc\n', { mode: 0o755 });
     const r = run(['memory', '--apply'], {
-      PATH: `${bin}:${process.env['PATH'] ?? ''}`,
+      // Ahead of the contained PATH (its poisons stay ahead of the system's), never of the parent's.
+      PATH: `${bin}:${memEnv()['PATH'] ?? ''}`,
       RACE_LINK: link, RACE_STORE: store,
     });
     expect(r.code, r.out).toBe(0);
@@ -405,7 +419,7 @@ describe('ccrc memory --apply — the union', () => {
     const r = spawnSync('bash', ['-c',
       'source "$1"; left=$(_mem_absorb "$2" "$2" corp) && printf \'left=%s\\n\' "$left"',
       'wrapper', CCRC, store],
-      { env: { ...process.env, HOME: home }, encoding: 'utf8' });
+      { env: memEnv(), encoding: 'utf8' });
     expect(r.status, `stderr: ${r.stderr}`).toBe(0);
     expect(r.stdout.trim()).toBe('left=0');
     // nothing in the store was touched by the self-absorb
@@ -932,7 +946,7 @@ describe('ccrc memory --apply — the union', () => {
     const r = spawnSync(
       'bash',
       ['-c', 'ulimit -c 0; ulimit -f 1; exec bash "$1" memory --apply', 'wrapper', CCRC],
-      { env: { ...process.env, HOME: home }, encoding: 'utf8' },
+      { env: memEnv(), encoding: 'utf8' },
     );
     const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
     expect(r.status).not.toBe(0);
@@ -960,7 +974,7 @@ describe('ccrc memory --apply — the union', () => {
     const r = spawnSync(
       'bash',
       ['-c', 'ulimit -c 0; ulimit -f 1; exec bash "$1" memory --apply', 'wrapper', CCRC],
-      { env: { ...process.env, HOME: home }, encoding: 'utf8' },
+      { env: memEnv(), encoding: 'utf8' },
     );
     const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
     expect(r.status).not.toBe(0);
````

````diff
diff --git a/server/test/runbook-holds.test.ts b/server/test/runbook-holds.test.ts
index 358665342..6000bf7fa 100644
--- a/server/test/runbook-holds.test.ts
+++ b/server/test/runbook-holds.test.ts
@@ -38,6 +38,8 @@ import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'nod
 import { tmpdir } from 'node:os';
 import path, { join } from 'node:path';
 import { fileURLToPath } from 'node:url';
+import { ccrcContainedEnv } from './ccrcContainment.js';
+import { assertNoRealTool } from './containedTools.js';
 
 const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
 const CCRC = join(root, 'ccd/ccrc');
@@ -140,15 +142,18 @@ const runExposureCheck = (fn: string, stubs?: Record<string, string>): string =>
       'CCRC_DDNS_TOKEN=fixture-token-not-real',
       '',
     ].join('\n'), { mode: 0o600 });
-    let env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
+    // Contained (wave 18, R14(b)): the fixture HOME, the fixture bus, and a recording poison for every
+    // CONTAINED_TOOLS name, first on PATH. The stubs go ahead of the poisons; none of them is a contained tool.
+    let env: NodeJS.ProcessEnv = ccrcContainedEnv(home, process.env, { managers: true, curl: 'poison' });
     if (stubs) {
       const bin = join(home, 'stub-bin');
       mkdirSync(bin);
       for (const [name, body] of Object.entries(stubs)) {
         writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
       }
-      env = { ...env, PATH: `${bin}:${process.env.PATH}` };
+      env = { ...env, PATH: `${bin}:${env['PATH'] ?? ''}` };
     }
+    assertNoRealTool(env, home);
     const r = spawnSync('bash', ['-c', `. "$1"; . "$2"; ${fn}`, 'bash', CCRC, DOCTOR_CHECKS],
       { env, encoding: 'utf8' });
     expect(r.status, r.stderr).toBe(0);
````

  And `ccrc-containment.test.ts`'s two comments that called the scan residue (its other hunks are Task 5's):

````diff
diff --git a/server/test/ccrc-containment.test.ts b/server/test/ccrc-containment.test.ts
index 98588f683..78b7d1959 100644
--- a/server/test/ccrc-containment.test.ts
+++ b/server/test/ccrc-containment.test.ts
@@ -9,8 +9,8 @@
 //        slides back to `ghContainedEnv(home, { ...process.env … })`, and a new `...process.env, HOME: home`
 //        literal — each reds here and names its line. It cannot see a raw spawn of the real `ccd/ccrc` with no
 //        `env` option, with `env: process.env`, or with `{ ...process.env, HOME: <any other name> }` (fix round 1,
-//        F5: a scan for raw `ccd/ccrc` spawns is residue). The per-builder pins and `assertNoRealTool` are what
-//        hold those today.
+//        F5). Since wave 18 (R14(b)) `raw-spawn-census.test.ts` reads every file of both test trees for exactly
+//        those three shapes.
 import { describe, it, expect } from 'vitest';
 import { spawnSync } from 'node:child_process';
 import {
@@ -416,7 +418,7 @@ describe('keepDigest\'s env (wave 9 R9-F8, 3b)', () => {
 });
 
 // Two shapes only (fix round 1, F5): a raw `ccd/ccrc` spawn with no `env`, with `env: process.env`, or with
-// `{ ...process.env, HOME: dir }` is invisible to both scans below.
+// `{ ...process.env, HOME: dir }` is invisible to both scans below; `raw-spawn-census.test.ts` is that scan (wave 18).
 describe('the census — two shapes of a bare parent env: a `ghContainedEnv({ ...process.env` builder, and the `...process.env, HOME: home` literal (wave 9 R10d, 3c)', () => {
   const FILES = ['ccrc-update.test.ts', 'ccrc-install.test.ts', 'ccrc-cli.test.ts', 'ccrc-install-graphify.test.ts',
     'installTreeFixture.ts'] as const;
````

  Run, one per call:
  - `raw-spawn-census`: 7 of 7 *(reviser, measured standalone; under vitest, to be measured by the worker)*;
  - `projected-home`: 58, which is 57 *(prototype)* and the new row;
  - `ccrc-memory`: 59 (58 and the new containment row);
  - `runbook-holds`: 23;
  - `ccrc-containment` *(prototype)*.

  Then `single-definition` (585, *prototype*, with the prototype's census file present). It must not see the ccd script's path spelled as two quoted adjacent segments, and the corpus's `ghContainedEnv(`, `ccrcContainedEnv(` and `memEnv(` text must not read as a second definition: *(to be measured by the worker)*. Then `ccd-workspaces` (81).

- [ ] **Step 4: Mutation rows.** T3-1a to T3-5r were *(reviser, measured standalone)* on the prototype tree, each applied to a scratch copy of the census and restored with `cmp`; under vitest the worker re-measures them. T3-6 to T3-10 are *(revised, unmeasured)* unless bracketed. The T3-1 rows are standing pins: each one breaks a detector branch, and the fixture corpus (row 7) is what reds.

  | row | mutation | expected red set |
  |---|---|---|
  | T3-1 | (the prototype's scratch module, now the corpus) | [prototype: a scratch `w18CensusMutant.ts` spawning the real ccrc three ways reddened "every BARE spawn …" (1 of 5), listing `:7 ({ ...process.env } without a builder)`, `:8 (env: process.env)` and `:9 (no env)`; those three shapes are the corpus's first lines] |
  | T3-1a | `envOf`'s `parts.length < 2` returns `null` | row 7 only (the one-argument `execSync` line, which the corpus gained because this row survived without it) |
  | T3-1b | `bareEnv`'s `expr === 'process.env'` branch deleted | row 7 only |
  | T3-1c | `stripCast` returns its input unchanged | row 7 only |
  | T3-1d | `calleesOf` returns the bare names only | row 7 only |
  | T3-1e | `importsOf` drops its namespace loop | row 7 only |
  | T3-1f | `namesOf` drops `under(d)` | row 7 only |
  | T3-1g | `namesOf` returns no scoped names | row 7 only |
  | T3-1h | `parentWins` moved after the builder test (the prototype's rule: any builder in the literal is contained) | row 7 only |
  | T3-1i | `optsEnv` gives up at the first spread (the prototype's rule) | row 3 ("SLICED_ALLOWED says 2 for server/test/update-semver.test.ts; measured none": its spawns spread `SPAWN_OPTS`) and row 7 |
  | T3-1j | `identEnv`'s default-parameter branch removed | row 7 only |
  | T3-1k | `bareEnv`'s `Object.assign` branch removed | row 7 only |
  | T3-1l | `slicedAt` marks nothing | row 3 ("SLICED_ALLOWED says 1 for server/test/ccrc-doctor.test.ts; measured none"), row 6 ("expected null to be \"sliced\""), row 7 |
  | T3-1m | `READS_TEXT` without `read` | row 3 ("SLICED_ALLOWED says 2 for server/test/ccrc-install.test.ts; measured none": its slices read through `read(…)`) and row 6 |
  | T3-1n | `ROOTS = ['server/test']` | row 1 only ("both test trees, by name") |
  | T3-2 | the `ALLOWED` key renamed to `ccrc-doctor-REMOVED.test.ts` | row 2 only: "a script spawned with the parent's env: server/test/ccrc-doctor.test.ts:8375 …". [prototype: the same, 1 of 5] |
  | T3-3 | `ALLOWED`'s `count: 2` | row 2 only: "ALLOWED says 2 for server/test/ccrc-doctor.test.ts; measured 8375: expected 1 to be 2". [prototype: the same, 1 of 5] |
  | T3-3s | `update-semver`'s `SLICED_ALLOWED` count 3 | row 3 only: "SLICED_ALLOWED says 3 for server/test/update-semver.test.ts; measured 65, 68" |
  | T3-3t | `deploy-env-guard`'s `SLICED_ALLOWED` key renamed | row 3 only: "sliced script text spawned with the parent's env: server/test/deploy-env-guard.test.ts:268 (no env)" |
  | T3-4 | `'bash'` removed from `RUNNERS` | row 4 only, listing every `'bash'` spawn. [prototype: 1 of 5] |
  | T3-5 | `'cat'` added to `READERS` | row 4 only: "'cat' is placed but no spawn uses it". [prototype: 1 of 5] |
  | T3-5r | `deploy-env-guard`'s reason cut to `'x'` | row 5 only |
  | T3-6 | `runbook-holds`' env reverted to `{ ...process.env, HOME: home }`; run `runbook-holds` and the census | the census (`runbook-holds.test.ts:157`), and two `runbook-holds` rows ("the exposure PASS line …", "the name PASS line …"), each by `assertNoRealTool: XDG_RUNTIME_DIR=/run/user/<uid> does not name a path inside the fixture HOME`. [prototype: 3 of 28] |
  | T3-7 | `ccrc-memory`'s `memEnv` reverted to `({ ...process.env, HOME: home, ...extra })`; run `ccrc-memory` and the census | `ccrc-memory`'s "the env every spawn here uses passes assertNoRealTool" only. The census stays GREEN: every spawn passes `memEnv(…)`, a call (D-5253). [prototype: 1 of 64] |
  | T3-8 | either `projected-home` call site reverted to `env: { ...process.env, HOME: … }` | row 2, naming that line. [prototype, on the inline form: the census reddened its line] |
  | T3-9 | `phEnv` drops `net` | `projected-home`'s new row: "assertNoRealTool: ssh resolved to …". The census stays green (a helper call) |
  | T3-10 | `phEnv` drops `systemd` | `projected-home`'s new row: the bus pair and `systemctl` are no longer under HOME |

- [ ] **Step 5: Commit** `test(update): a census of raw spawns of the ccd and ccrc scripts and of text sliced from them, and the hits it found (wave 18, R14(b), D-5250, D-5251, D-5253)`.

### Task 4: W18-c — the closed-stdin sentences say which shell (R23(a))

**Files:** `server/test/containedTools.ts`.

- [ ] **Step 1: Anchors** (the ledger's `:126-127` has moved): the JSDoc bullet `because an empty config can name nothing, and a closed stdin reads as one.` (`:77`) and the comment `fails part-way checks and feeds the same prefix (a closed stdin is an empty config, and passes).` (`:138`). `git grep -n 'containedTools.ts:'` finds no citation into the file (measured).

- [ ] **Step 2: The measurement the prose rests on** *(prototype)*. A scratch script, run with fd 0 closed, under each shell:
  ```bash
  ls -l /bin/sh
  for sh in dash bash "bash --posix"; do
    out=$(timeout 3 $sh -c 'cfg=$(cat); printf "len=%s rc=%s" "${#cfg}" "$?"' 0<&- 2>&1)
    echo "$sh: exit=$? out=[$out]"
  done
  ```
  Output on the prototype box:
  ```
  lrwxrwxrwx 1 root root 4 Mar 31  2024 /bin/sh -> dash
  dash: exit=0 out=[cat: -: Bad file descriptor
  cat: closing standard input: Bad file descriptor
  len=0 rc=1]
  bash: exit=124 out=[]
  bash --posix: exit=124 out=[]
  ```
  So dash reads an empty config; bash (macOS's `/bin/sh`) hangs, and the front fails closed.

- [ ] **Step 3: The change** (prose only; no row: a closed-stdin row would pin dash and hang on a Mac):

````diff
diff --git a/server/test/containedTools.ts b/server/test/containedTools.ts
index eeeb91de8..4a6ccaefd 100644
--- a/server/test/containedTools.ts
+++ b/server/test/containedTools.ts
@@ -74,7 +74,8 @@ export const CLAIM_DATA_LINE_ERE = String.raw`^data = "\{\\"code\\":\\"[A-Za-z0-
  *    each line starting `header = "`, the name `[A-Za-z0-9-]+`, the value holding no `"`, no `\` and no control
  *    character; an EMPTY config passes too. Nothing in-tree sends one now (notify.sh exits 0 before curl when it has no token, D-4393,
  *    and ccrc-api, ccrc-token-sync and the sync scripts always send a header or a data line); the allowance is kept
- *    because an empty config can name nothing, and a closed stdin reads as one. Since the box-token lifecycle
+ *    because an empty config can name nothing (a CLOSED stdin reads as one under dash; under bash, macOS's /bin/sh,
+ *    `cfg=$(cat)` hangs instead, which fails closed — wave 18, R23(a)). Since the box-token lifecycle
  *    (wave 1, Task B1) ONE more line shape passes: `ccrc token sync`'s claim body, `CLAIM_DATA_LINE_ERE` above — a
  *    `data = "…"` line that is exactly `{"code":<43 base64url>,"nodeId":<lowercase uuid>}` with its quotes escaped,
  *    so it names no file (no leading `@`), no URL and no other field. Any other key (`url`, `proxy`,
@@ -135,7 +136,8 @@ export function loopbackCurlFront(realCurl: string): string {
     // only newlines reads as the empty config. An EMPTY config passes (nothing in-tree sends one now: notify.sh exits before curl
     // when it has no token; it is allowed because it can name nothing), and a second `-K -` is refused. The config is never logged: a refusal records argv only.
     // `cat`'s own status is deliberately not a verdict: what the check sees is exactly what is re-fed, so a read that
-    // fails part-way checks and feeds the same prefix (a closed stdin is an empty config, and passes).
+    // fails part-way checks and feeds the same prefix (a closed stdin is an empty config under dash, and passes; under
+    // bash the substitution's pipe lands on fd 0, `cat` reads its own output, and the front hangs: fails closed).
     'cfg=; have_cfg=',
     // FAILS CLOSED (wave 13 fix round 1, review 294 F1): grep -qv exits 1 only when NO line falls outside the rule, and
     // that is the one status that passes. 0 is a line outside the rule; 2 (an error) and 127 (no grep on PATH) are a
````

  Run `ccrc-containment` (unchanged count) and `ccd-harness-containment` (both import the file).

- [ ] **Step 4: Commit** `test(update): the curl front's closed-stdin sentences name the shell (wave 18, R23(a))`.

### Task 5: W18-d and W18-e — the fail-closed rows pin the whole log, and a leading blank line is fed (R23(b), R23(d))

**Files:** `server/test/ccrc-containment.test.ts`.

- [ ] **Step 1: Anchors:** the two `it(` rows beginning `refuses a config the rule admits when grep cannot give a verdict` and `refuses a url directive when there is no grep on PATH at all`, each with `expect(t.poison()).toContain(args.join(' '));`; `refusedCfg`'s row `` ['a blank line inside the config', ['-K', '-', ok], `${HDR}\n${HDR}`], ``; `containedTools.ts`'s `refuse()` (one `printf '%s\n' "$argv_log"` line per refusal).

- [ ] **Step 2: The change** (Task 3 already holds this file's first two hunks):

````diff
diff --git a/server/test/ccrc-containment.test.ts b/server/test/ccrc-containment.test.ts
index 98588f683..78b7d1959 100644
--- a/server/test/ccrc-containment.test.ts
+++ b/server/test/ccrc-containment.test.ts
@@ -281,6 +281,8 @@ describe('the loopback curl front parses argv — an option it does not allowlis
     ['an unquoted header value', ['-K', '-', ok], 'header = x-ccrc-mail-token: zz\n'],
     ['the long-option config spelling', ['-K', '-', ok], '--header "x-ccrc-mail-token: zz"\n'],
     ['a blank line inside the config', ['-K', '-', ok], `${HDR}\n${HDR}`],
+    // `cfg=$(cat)` strips only TRAILING newlines, so a leading one survives to the check (wave 18, R23(d)).
+    ['a LEADING blank line', ['-K', '-', ok], `\n${HDR}`],
     ['--data-binary @file', ['--data-binary', '@/etc/passwd', ok], ''],
     ['-d @file', ['-d', '@/etc/passwd', ok], ''],
     ['-X with a URL in its value', ['-X', 'GET http://127.0.0.1:7788/', ok], ''],
@@ -333,8 +335,8 @@ describe('the loopback curl front parses argv — an option it does not allowlis
   }
   // The front reads the config with `cfg=$(cat)`, which strips EVERY trailing newline before the check runs (wave 13 fix
   // round 1, review 294 F2). So trailing blank lines pass, and the real curl gets the NORMALISED text (one trailing
-  // newline), not the caller's bytes. A leading or interior blank line is refused (the `a blank line inside the config`
-  // row above). An input of only `\n` reads as the empty config, which "passes an empty config" already
+  // newline), not the caller's bytes. A leading or interior blank line is refused (the `a LEADING blank line` and `a
+  // blank line inside the config` rows above). An input of only `\n` reads as the empty config, which "passes an empty config" already
   // covers; it needs no row of its own.
   it('passes a config with trailing blank lines, handing the real curl the NORMALISED text: one trailing newline (wave 13 fix round 1, F2)', () => {
     const t = setup();
@@ -353,7 +355,7 @@ describe('the loopback curl front parses argv — an option it does not allowlis
     const args = ['-sS', '-K', '-'];
     expect(t.run(args, HDR), args.join(' ')).toBe(97);
     expect(t.fakeArgv(), 'the (fake) real curl must not have run').toEqual([]);
-    expect(t.poison()).toContain(args.join(' '));
+    expect(t.poison(), 'the log holds the refusal record and nothing else').toBe(`${args.join(' ')}\n`);
     expect(t.poison(), 'the config reached the refusal log').not.toContain(HDR.trim());
     expect(t.passed()).toBe('');
   });
@@ -372,7 +374,7 @@ describe('the loopback curl front parses argv — an option it does not allowlis
     const args = ['-sS', '-K', '-'];
     expect(t.run(args, 'url = "http://203.0.113.9/x"\n'), args.join(' ')).toBe(97);
     expect(t.fakeArgv(), 'the (fake) real curl must not have run').toEqual([]);
-    expect(t.poison()).toContain(args.join(' '));
+    expect(t.poison(), 'the log holds the refusal record and nothing else').toBe(`${args.join(' ')}\n`);
     expect(t.poison(), 'the config reached the refusal log').not.toContain('203.0.113.9');
     expect(t.passed()).toBe('');
   });
````

  Run `ccrc-containment`. Expected *(prototype)*: 96 of 96 (95 at the base, plus the leading-blank row). The two rows' logs read exactly `-sS -K -\n`.

- [ ] **Step 3: Mutation rows.** All *(prototype)*:

  | row | mutation (in `containedTools.ts`'s generated front) | expected red set (measured) |
  |---|---|---|
  | T5-1 | `refuse()` appends the record twice (`>> "$HOME/curl-poison"; printf "%s\n" "$argv_log" >> "$HOME/curl-poison"`) | exactly the two fail-closed rows (2 of 96): "the log holds the refusal record and nothing else: expected '-sS -K -\n-sS -K -\n' to be '-sS -K -\n'" |
  | T5-1c | the same mutant against the BASE assertions (`toContain`) | 0 of 95 (the control: the old rows could not see it) |
  | T5-2 | the front strips one leading newline (`cfg=$(cat); cfg=${cfg#"\n"}; have_cfg=1`) | the new row only (1 of 96): "-K - http://127.0.0.1:41999/: expected +0 to be 97" |
  | T5-2c | the same mutant against the BASE rows | 0 of 95 (the control: no row fed a leading blank) |

  (The scout's own first form of T5-2, `sed '/./,$!d'`, also redded the no-grep row as an artefact: `sed` is absent from that row's PATH. The parameter-expansion form has no such artefact.)

- [ ] **Step 4: Commit** `test(update): the fail-closed rows pin the whole refusal log, and a leading blank line is refused (wave 18, R23(b), R23(d))`.

### Task 6: The importer census, before (in Task 0) and after, and the reach logs (D-5252)

**Files:** none changed.

- [ ] **Step 1: The set** (run in Task 0). From inside `server/test`, a reach script over every `.ts`/`.mts`/`.mjs`/`.js` file's relative imports (the prototype's, kept verbatim):

````python
#!/usr/bin/env python3
"""Census of server/test files reaching ccdWsHelpers.ts (direct and transitive), and of makeCcdHarness reach."""
import os, re, sys, json
root = sys.argv[1]  # server/test dir
imp_re = re.compile(r"""(?:import|export)\s[^'";]*?from\s+['"](\.{1,2}/[^'"]+)['"]|import\(\s*['"](\.{1,2}/[^'"]+)['"]""", re.S)
files = {}
for dp, dn, fn in os.walk(root):
    if 'node_modules' in dp: continue
    for f in fn:
        if f.endswith(('.ts', '.mts', '.mjs', '.js')):
            p = os.path.join(dp, f)
            files[os.path.relpath(p, root)] = open(p, encoding='utf8', errors='replace').read()
def resolve(src, spec):
    base = os.path.normpath(os.path.join(os.path.dirname(src), spec))
    for cand in (base, re.sub(r'\.js$', '.ts', base), re.sub(r'\.mjs$', '.mts', base), base + '.ts'):
        if cand in files: return cand
    return None
deps = {}
for f, txt in files.items():
    ds = set()
    for m in imp_re.finditer(txt):
        spec = m.group(1) or m.group(2)
        r = resolve(f, spec)
        if r: ds.add(r)
    deps[f] = ds
def reaches(f, target, seen=None):
    seen = seen or set()
    if f in seen: return False
    seen.add(f)
    for d in deps[f]:
        if d == target or reaches(d, target, seen): return True
    return False
target = 'ccdWsHelpers.ts'
direct = sorted(f for f in files if target in deps[f])
trans = sorted(f for f in files if f != target and reaches(f, target))
tests_direct = [f for f in direct if f.endswith('.test.ts')]
tests_trans = [f for f in trans if f.endswith('.test.ts')]
helpers = [f for f in trans if not f.endswith('.test.ts')]
# modules (helpers) whose text calls makeCcdHarness(
harness_mods = {f for f in files if 'makeCcdHarness(' in files[f] and f != target}
def reaches_harness(f, seen=None):
    seen = seen or set()
    if f in seen: return False
    seen.add(f)
    if f in harness_mods: return True
    return any(reaches_harness(d, seen) for d in deps[f])
harness_tests = [f for f in tests_trans if reaches_harness(f)]
out = dict(direct=len(direct), direct_tests=len(tests_direct), trans_tests=len(tests_trans), helpers=helpers,
           harness_reach_tests=len(harness_tests))
print(json.dumps(out, indent=1))
open(sys.argv[2], 'w').write('\n'.join(tests_trans) + '\n')
open(sys.argv[3], 'w').write('\n'.join(harness_tests) + '\n')
````

  Run `python3 -I reach.py <server/test> "$SCRATCH/trans.txt" "$SCRATCH/harness.txt"`. Prototype at `256b25ecb`: 278 test files reach `ccdWsHelpers.ts`, and 188 of them reach `makeCcdHarness`. The batch set has three parts, 282 files in all:
  - `harness.txt` (188 files, in batches of about 16);
  - `trans.txt` minus `harness.txt` minus `ccrc-install.test.ts`, `ccrc-update.test.ts` and `ccrc-doctor.test.ts` (87 files, in batches of 15);
  - seven extras: `runbook-holds`, `ccrc-memory`, `single-definition`, `update-semver`, `deploy-env-guard`, `topology-clean` and `dtbd`.

  The census file imports nothing, so it is in neither phase; Task 7 Step 2 runs it.

- [ ] **Step 2: Before, on the untouched tip (Task 0), with the reach spies** *(revised, unmeasured)*. Nothing is swapped into the workspace: the tree is `origin/main` as fetched, before any edit of this wave's (D-5252). First the spies. Each one logs `HOME | tool | argv` and exec's the real binary, whose path is resolved when the spy is written, so a base run behaves as it did. A `BASH_ENV` file logs every bash that starts with a real or absent `XDG_RUNTIME_DIR`. `inheritedEnv()` passes both PATH and `BASH_ENV` through, so the spies sit after `harnessBin` and before `/usr/bin` in every harness spawn:

```bash
T=$(mktemp -d /tmp/w18.XXXXXX); SPY="$T/spy"; mkdir -p "$SPY"
LOG="$SCRATCH/reach-before.log"; : > "$LOG"
for t in ssh scp curl; do
  real=$(command -v "$t") || continue
  sed -e "s|@TOOL@|$t|" -e "s|@LOG@|$LOG|" -e "s|@REAL@|$real|" > "$SPY/$t" <<'EOF'
#!/bin/sh
printf '%s | @TOOL@ | %s\n' "$HOME" "$*" >> '@LOG@'
exec '@REAL@' "$@"
EOF
  chmod 755 "$SPY/$t"
done
sed -e "s|@LOG@|$LOG|" > "$T/bash-env.sh" <<'EOF'
case "${XDG_RUNTIME_DIR-unset}" in
  /run/user/*|unset) printf '%s | bus | %s\n' "$HOME" "${XDG_RUNTIME_DIR-unset}" >> '@LOG@' ;;
esac
EOF
```

  Then run each batch in the foreground, one per call, after reading the slice's `memory.current` (Global Constraints; the wait is bounded):

      PATH="$SPY:$PATH" BASH_ENV="$T/bash-env.sh" TMPDIR="$T/before-<batch>" timeout 580 \
        ./node_modules/.bin/vitest run <files> --pool=forks --maxWorkers=2 \
        --reporter=default --reporter=json --outputFile.json="$SCRATCH/res/before/<batch>.json"

  Caveats on the logs:
  - A spawn whose env is built from scratch (`env -i`, a literal PATH such as `/usr/bin:/bin`) bypasses the spies. The logs are a lower bound, and say so in the wave-done.
  - The loopback curl fronts (`ccrc-api`, `ccrcContainment`'s `curl: 'front'`) resolve "the real curl" with `command -v curl`, so they find the spy. Their 127.0.0.1 calls are logged as expected lines.

- [ ] **Step 3: After, on the wave** (after Task 5). The same batches, with the same spies rewritten to `LOG="$SCRATCH/reach-after.log"` and a fresh `$T`, into `$SCRATCH/res/after/`.

  Read both logs by HOME, and map each HOME to its test by its `mkTmp`/`makeCcdHarness` prefix:

      cut -d'|' -f1-2 "$SCRATCH/reach-<phase>.log" | sort | uniq -c | sort -rn

  - The before log names every test that reached a real `ssh`, `scp`, `curl` or user bus at the base, including any that tolerated the failure and stayed green.
  - The after log must hold no tool line from a `makeCcdHarness` HOME. It must hold no bus line from a spawn whose builder asks `systemd`, unless that builder kept a caller's pair under HOME (that pair is not `/run/user/*`, so it is never logged).
  - Every remaining line is second ring (Not in this wave) or a loopback front, and the wave-done says which.

- [ ] **Step 4: Compare per file** (the prototype's script, kept verbatim):

````python
import json, glob, os
S = os.environ['SCRATCH'] + '/res'
def load(phase):
    out = {}
    for p in sorted(glob.glob(f'{S}/{phase}/*.json')):
        d = json.load(open(p))
        for t in d['testResults']:
            st = [a['status'] for a in t['assertionResults']]
            out[os.path.basename(t['name'])] = (st.count('passed'), st.count('failed'), len(st) - st.count('passed') - st.count('failed'),
                                                sorted(a['fullName'] for a in t['assertionResults'] if a['status'] == 'failed'))
    return out
b, a = load('before'), load('after')
tot = lambda d: tuple(sum(v[i] for v in d.values()) for i in range(3))
print('files before', len(b), 'after', len(a), 'totals before (pass, fail, skip)', tot(b), 'after', tot(a))
for f in sorted(set(b) | set(a)):
    if b.get(f, (None,) * 4)[:3] != a.get(f, (None,) * 4)[:3] or b.get(f, [0] * 4)[3] != a.get(f, [0] * 4)[3]:
        print(f, 'before', b.get(f, ('-',))[:3], 'after', a.get(f, ('-',))[:3])
        for n in sorted(set(b.get(f, [0, 0, 0, []])[3]) ^ set(a.get(f, [0, 0, 0, []])[3])):
            print('   changed red:', n[:150])
print('red in both:')
for f in sorted(set(b) & set(a)):
    for n in sorted(set(b[f][3]) & set(a[f][3])):
        print('  ', f, '|', n[:140])
````

  Prototype result *(prototype; before at about 20:24, after at about 21:50 UTC, load 15 to 30)*:
  ```
  files before 282 after 282 totals before (pass, fail, skip) (12389, 6, 46) after (12400, 6, 46)
  ccd-harness-containment.test.ts before (14, 0, 0) after (23, 0, 0)
  ccd-ws-audit.test.ts before (140, 1, 4) after (141, 0, 4)
     changed red: the contained rung — never pushed, nothing unique refuses no-remote when the project has no origin at all
  ccrc-containment.test.ts before (95, 0, 0) after (96, 0, 0)
  ccrc-memory.test.ts before (58, 0, 0) after (59, 0, 0)
  history-ingest.test.ts before (162, 0, 0) after (161, 1, 0)
     changed red: history ingest: the FTS index (plan task 23) D-4346 (history-permanent-failures-classified): a stored blob that does not decode is passed over, never
  red in both:
     ccd-entry-install.test.ts | a refused run changes nothing, and nothing is called converged without its kernel self-test (review 216 F4, F11, F12) F11 a PATH entry whose
     ccd-entry-install.test.ts | the fix pass of the final review: layouts, mode repair, postcondition, the interpreter path the shebang names the PATH-selected python3 when
     ccd-review-335-pins.test.ts | F9: an rm that fails on a long, non-ASCII name reaches the row as ONE short clean line (spec §5.6) the clips leaf’s unmeasured arm (`clipswh
     ccd-review-335-pins.test.ts | F9: an rm that fails on a long, non-ASCII name reaches the row as ONE short clean line (spec §5.6) the temp root’s unmeasured arm after the
     ccd-ws-collect-verb.test.ts | the pause, the lock, and never a lock for a foreign name a `tmproots/` that c
  ```

  What the prototype's comparison showed:
  - **The pass delta, +11, was exactly the prototype's new tests:** 9 in `ccd-harness-containment`, 1 in `ccrc-containment` and 1 in `ccrc-memory`. The census file is no importer, so it is not in the set.
  - **The revised wave's expected delta is +15** *(revised, unmeasured)*: 11 in `ccd-harness-containment`, and 1 each in `ccd-pool-sync`, `projected-home`, `ccrc-containment` and `ccrc-memory`.
  - **The five reds in both phases are the scratch TMPDIR**, not the wave. `ccd-entry-install`'s two refuse with "the shebang for <scratch>/…/python3 is 155 bytes, over the 127 every support…" (the evidence truncates it there), and the other three are the same long-path class. With the default TMPDIR, `ccd-entry-install`, `ccd-review-335-pins` and `ccd-ws-collect-verb` passed 90 of 90 *(prototype)*. The short `$T` (Global Constraints) is meant to keep them green in both phases. If they red anyway, run those three with the default TMPDIR in both phases.
  - **`history-ingest`'s after-red** passed 162 of 162 in isolation at 21:52 UTC *(prototype)*, so it was a load flake. The file is under claim 1497, another run's, and imports nothing this wave changes by a path the change can move.
  - **`ccd-ws-audit`'s before-red** passed 141 of 141 (4 skipped) in isolation on the BASE helpers *(prototype)*, so it was a load flake in the base phase.

- [ ] **Step 5:** Record the worker's own before/after tables and both reach-log summaries in the wave-done. A file whose counts differ beyond the new tests is investigated in isolation in BOTH phases before it is called a flake: in particular, any red the bus now following `systemd` causes (Task 1 Step 3's fallback). *(to be measured by the worker)*

### Task 7: The gate and the PR

- [ ] **Step 1: Merge `main` forward if it moved.** Run `git fetch origin main`. If `origin/main` is not in HEAD, run `git merge --no-edit origin/main`: an ordinary merge, never a rebase, a force-push or GitHub's Update branch.
  - Stop and report only on a conflict, or on a hunk that overlaps one of this wave's in a File-structure file. A disjoint change to one is merged and named.
  - **If the merge carries #435, or any other change to `ccdWsHelpers.ts` or `containedTools.ts`,** re-run `ccd-harness-containment`, `ccd-workspaces`, `ccd-tmux-anchor` and `raw-spawn-census`, and re-measure rows T1-1 to T1-13.
  - **After every merge of `main`,** re-run `raw-spawn-census`: `main` may have changed a file its lists count.
  - Re-read the claims and the open PRs.
- [ ] **Step 2: The touched and pinning suites, one file per call** (counts *prototype* unless marked):
  - the wave's own files: `ccd-harness-containment` (25, *revised*), `raw-spawn-census` (7, *standalone*), `ccd-pool-sync` (41, *revised*), `pool-accounts-route` (31), `projected-home` (58, *revised*), `ccrc-memory` (59), `runbook-holds` (23) and `ccrc-containment` (96);
  - the pinning and exposed files: `ccd-workspaces` (81), `ccd-tmux-anchor` (35), `ccd-update-sync` (45), `ccrc-token-sync` (93), `ccrc-api` (103), `ccd-version` (9), `ccd-lifecycle-emit` (59), `ccd-lifecycle-gen` (17), `macos-platform` (102, 11 skipped), `ccd-supervised-start` (25, 4 skipped) and `session-hook` (516);
  - the guards: `topology-clean` (55), `dtbd` (1), `update-semver` (13) and `deploy-env-guard` (27).

  The first finisher's last run *(prototype, 22:32 UTC, load 15.6)* ran 13 of those files in one call: `raw-spawn-census`, `ccd-harness-containment`, `projected-home`, `ccd-workspaces`, `single-definition`, `ccd-pool-sync`, `pool-accounts-route`, `ccrc-containment`, `ccrc-memory`, `runbook-holds`, `ccd-tmux-anchor`, `ccrc-token-sync` and `ccd-update-sync`. All 1173 passed, on the earlier shape. Its next batch of eight (`typecheck-tests`, `topology-clean`, `dtbd`, `ccd-version`, `ccd-lifecycle-emit`, `ccd-lifecycle-gen`, `macos-platform` and `ccrc-api`) was killed (exit 137, the out-of-memory kill). Every count on the revised files is *(to be measured by the worker)*.
- [ ] **Step 3: The heavy guards, one per call, after reading the slice's memory:**
  - `single-definition` (585, *prototype* in the after-phase);
  - `typecheck-tests` *(to be measured by the worker; `tsc -p test/tsconfig.tests.json --noEmit` exited 0, prototype)*;
  - then `cd server && ./node_modules/.bin/tsc --noEmit; echo "exit $?"`.
- [ ] **Step 4: The heavy importers, by CI** (D-5252) *(revised)*. `ccrc-install`, `ccrc-update` and `ccrc-doctor` are not run locally.
  - Their BEFORE is `main`'s latest trusted full suite (a daily or dispatched full run at or after `256b25ecb`): name it and its result.
  - Their AFTER is this PR's `test (server)`. The wave-done names the PR's `select tests` summary, and checks that it lists all three, and all 278 files of `trans.txt`.
  - If it does not list them, run `gh workflow run ci.yml --ref <branch> -f mode=full`, name that run, and never wait on it.
  - No `-t` partition exists for `ccrc-doctor` or `ccrc-install`. Wave 16's plan (Task 8 Step 4) lists seven for `ccrc-update`, if the coordinator asks for a local run.
- [ ] **Step 5: The final tip.**
  - Task 6's after phase is not re-run on the final tip unless `main` moved under `server/test`, `ccd` or `shared` after it ran (Step 1).
  - **The sharded gate, as wave 16 runs it:** if the 1-minute load is under 20 and the slice's memory under 21 GB, run `TMPDIR="$T/shard-<i>" ./node_modules/.bin/vitest run --shard=<i>/6 --maxWorkers=2` for `i` = 1 to 6, in sequence. The sum of their `Test Files` must equal `find server/test -name '*.test.ts' | wc -l`.
  - Otherwise, after the bounded wait, the wave-done says the shards were not run and gives the load and the memory. Then `gh workflow run ci.yml --ref <branch> -f mode=full`, and name that run, without waiting on it.
  - A `ccdWsHelpers.ts` change makes the PR's CI selection run nearly every server test, so the PR's own `test (server)` is close to the full suite either way.
- [ ] **Step 6: The ledger, scope and residue guards, last.**
  *(to be measured by the worker: none of the three ran with this plan in the tree; the D-number loop below printed nothing over the finisher's uncommitted tree.)*
  ```bash
  git fetch origin main
  cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts && ./node_modules/.bin/vitest run test/dtbd.test.ts \
    && ./node_modules/.bin/vitest run test/topology-clean.test.ts && cd ..
  # the Global Constraints' scope check: prints nothing
  git diff --stat origin/main...HEAD     # exactly File structure's New and Changed lists
  ```
  Then the D-number check. Every D-token the branch adds is one of 5247 to 5258 and defined in this plan, or already on `origin/main`. It prints nothing:
  ```bash
  PLAN=docs/superpowers/plans/2026-10-16-centralised-update-w18-test-containment.md
  git diff origin/main...HEAD | grep '^+' | grep -oE '\bD-[0-9]+\b' | sort -u > "$SCRATCH/dnums"
  while read -r d; do
    case "${d#D-}" in
      524[7-9]|525[0-8]) grep -qE "^- \*\*$d\*\* — " "$PLAN" || echo "UNDEFINED $d"; continue ;;
      5259|526[0-6]) echo "BLOCK NUMBER PAST THE RESERVE: $d"; continue ;;
    esac
    git grep -qwF -e "$d" origin/main -- docs/superpowers && continue
    echo "OUTSIDE THE BLOCK OR THE RESERVE: $d"
  done < "$SCRATCH/dnums"
  ```
- [ ] **Step 7: The PR,** from the workspace branch. **This repository is public**: no hostname, account or lane name, absolute or home path, mount path, tailnet name or address, docserver URL, private repo, or ticket ID anywhere in the title, body, commits or branch name. Check the text before posting.
  - **Its first paragraph says:**
    - tests only, deploy class none;
    - the harness now poisons `ssh`, `scp` and `curl` (opt-in `net` in `ghContainedEnv`, asked by `makeCcdHarness`);
    - every `systemd` caller's user bus now points under HOME;
    - one named door, `stubContainedTool`, for a functional stub;
    - the census reads both test trees, and lists bare sliced spawns on their own;
    - a `ccdWsHelpers.ts` change makes CI's selection run nearly every server test.
  - **The body:** one section per task, carrying D-5247 to D-5253 by number. It includes the mutation tables' measured results, Task 6's before/after table and both reach-log summaries, and the not-in-this-wave list.
    - It names #435 as a disjoint open change to `ccdWsHelpers.ts`.
    - It says that `ALLOWED` and `SLICED_ALLOWED` pin counts in `ccrc-doctor.test.ts` and `ccrc-install.test.ts` (Reading 4).
  - **Links:** the plan and the files are GitHub `blob/main` URLs built from the repository's own remote (`git remote get-url origin`), with the PR's `/files` view beside each until the merge. Never a docserver URL.
  - Every commit's author and committer are the noreply identity: `git log --format='%an <%ae> | %cn <%ce>' origin/main..HEAD`.
  - The body is hand-written and ends with the attribution line the session's instructions give.
- [ ] **Step 8: The wave-done, in the same turn as the push.** It carries:
  - the tip sha and PR number;
  - the claims and open PRs at each edit and at the push;
  - each suite's result against Step 2's counts;
  - Step 4's CI arbiters (the before run, and the PR's selection summary or the dispatched run);
  - the importer census tables and both reach-log summaries;
  - the shards or why not, with the load and memory;
  - every mutation row (T1-1 to T5-2c) re-measured on the tip, with its red set against the listed one;
  - the measured `SLICED_ALLOWED` and any widened `ALLOWED`, each with its reason;
  - whether Task 1 Step 3's bus fallback was taken;
  - any reserve number spent, defined here in the commit that cites it;
  - a note for the coordinator about Reading 4's landing order;
  - anything bearing on a reading below.

## Readings (for the coordinator to rule; each was chosen where no ruling decided it)

1. **Where `net` and the bus live** (D-5247, D-5248). Options:
   - (a) **`net` opt-in, asked by `makeCcdHarness`, `projected-home`'s `phEnv` and the pool runners; the bus follows `systemd`, and a caller's pair under HOME stands** (this plan, *revised, unmeasured*);
   - (b) both opt-in and asked by the harness alone, as the prototype measured it green. This leaves the bus open at about 77 harness-user own-env sites and at the second ring's 98 `systemd` sites;
   - (c) both unconditional for every `systemd` caller, which reds 91 tests in three files that run a functional or loopback curl.

   Recommendation: (a), with (b) as the measured fallback if Task 6 finds a bus red the wave accepts.
2. **The stub door** (D-5249). Options:
   - (a) **one named helper, `stubContainedTool`, refusing a non-contained name** (this plan, *revised*);
   - (b) raw relocation into `harnessBin` (the prototype, measured);
   - (c) a named opt-out, `net: { except: ['curl'] }`.

   Recommendation: (a), because the brief asks for "an explicit, named opt-in stub", and a grep for the helper lists every opt-out.
3. **The second ring** (D-5253). What still has some reach after this wave:
   - about 79 direct `ghContainedEnv` files keep the real `ssh`, `scp` and `curl`, though their `systemd` sites now get the fixture bus;
   - about 35 spawns in 10 `ccrc-*` files with thin builders keep both the real bus and the network tools;
   - a harness user's own env on a second HOME has no plant.

   Options: (a) **name it and leave it** (this plan); (b) a later wave gives each builder `net` (or `ccrcContainedEnv`), file by file, with the five curl users relocated through `stubContainedTool` first. Recommendation: (a) here, and (b) as residue for the coordinator to schedule.
4. **`ccrc-doctor.test.ts:8375`, and the counts in claimed files.** The `_box_role` spawn is on `ALLOWED` while claim 1499 holds the file. Its HOME is a path inside the repository that does not exist, and the measured `_box_role` runs no tool. `SLICED_ALLOWED` also pins counts in `ccrc-doctor.test.ts` and `ccrc-install.test.ts`, which run 360's open fix round is editing. Options:
   - (a) **list them with their reasons now, and fix them (`ccrcContainedEnv`) in the first wave that may write the files** (this plan);
   - (b) wait for run 360 to land and fix them in this wave.

   Recommendation: (a), with two notes:
   - The coordinator carries the fix into wave 17's brief, which owns `ccrc-doctor.test.ts` after run 360.
   - The coordinator either lands wave 18 after run 360, or tells run 360 that a change to a bare spawn in those two files updates `raw-spawn-census.test.ts`'s lists in the same PR.
5. **The stale line citations into `ccdWsHelpers.ts`** (Anchors): seven comment citations in four files already named the wrong lines at the base. Options:
   - (a) **leave them** (this plan: they are prose, unchecked, and in files this wave does not otherwise touch);
   - (b) re-anchor them by content in this wave, which adds four files to the claim set.

   Recommendation: (a), and a docs-PR note.
6. **The census's helper-call blind spot** (D-5253, rows T3-7 and T3-9): a bare env returned by a local helper (`memEnv()`, `phEnv()`) is invisible to the census. Options:
   - (a) **leave it to each file's own `assertNoRealTool` row** (this plan, which adds that row to `ccrc-memory`, `runbook-holds` and `projected-home`);
   - (b) follow a call to a same-file arrow function's returned literal, one more resolution rule.

   Recommendation: (a). Option (b) costs a rule the census then has to pin, for a shape with two instances that are already pinned.
7. **The sliced class** (D-5251). Options:
   - (a) **enumerate it in `SLICED_ALLOWED`, listed, not fixed** (this plan: 12 spawns in 6 files; three of the files are claimed or run-only, and the other three run version arithmetic, a key read or jq);
   - (b) fix the members in the three unclaimed files (`continued-in-parity`, `deploy-env-guard`, `update-semver`) now, which adds three files to the claim set;
   - (c) the prototype's rule, which kept the class out of scope and pinned only the R14(b) spawn.

   Recommendation: (a). The list makes a new member a decision, and fixing a slice's env is its file's wave.
8. **The heavy importers** (D-5252). Options:
   - (a) **CI arbitrates: `main`'s trusted full suite before, and this PR's selected `test (server)` (or a `mode=full` dispatch) after** (this plan);
   - (b) local `-t` parts. No partition exists for `ccrc-doctor` or `ccrc-install`, and the box's slice runs above the memory bar.

   Recommendation: (a), which CLAUDE.md's "CI is the arbiter for a file it ran" covers.

## Coordinator rulings on this plan's readings (2026-10-17)

- **Reading 1:** (a), with (b) as the fallback. `net` is opt-in, and the bus follows `systemd`. The bus half is
  unmeasured, so Task 1 measures it first. If Task 6 finds a red that the bus causes and that this wave cannot fix
  inside its own files, fall back to (b). Say so in the wave-done, with the red set. (c) is out.
- **Reading 2:** (a), `stubContainedTool`.
- **Reading 3:** (a). The second ring is named, not fixed. The coordinator records it as residue for a later test
  wave, after stable.
- **Reading 4:** (a), and **this wave lands after run 360**. The census file is new in this wave, so run 360 cannot
  break it before it exists. When run 360 has merged, Task 7 Step 1's merge of `main` re-runs the census, and the
  same PR updates `ALLOWED` and `SLICED_ALLOWED` to what it measures. The `ccrc-doctor.test.ts` `_box_role` spawn,
  and the sliced members in the files run 360 holds, go to wave 17, which owns `ccrc-doctor.test.ts` after run 360.
  Nobody mails run 360 about the census.
- **Reading 5:** (a). The docs PR notes the seven stale citations.
- **Readings 6, 7 and 8:** as recommended. CI arbitrates the three heavy importers: `main`'s trusted full suite is
  the before; the after is this PR's selected `test (server)` when its `select tests` summary lists them, otherwise
  a `mode=full` dispatch on this branch.
- **The landing order.** Waves 15 and 16 (#441, #444) may land before this wave. If either has, Task 7 Step 1
  re-runs, after the merge of `main`, each test file that wave added or changed and that reaches `ccdWsHelpers.ts`
  (wave 16's `sweepFixture.ts` users among them), and the wave-done names them. This is the same rule as #435's.
- **Not in this wave, corrected.** Wave 16's Reading 9 ruling named wave 18 for widening `sweepFixture.ts`'s
  Darwin helper cases to plain `it`. That file is wave 16's and is not on `main`, so this wave cannot edit it. It
  goes to the residue, for a test wave after wave 16 lands, with a dispatched full run.
- **The base.** The plan was drafted at `256b25ecb`. `main` read `0a06ebb9a` at the ruling, and `git diff --stat
  256b25ecb 0a06ebb9a -- server ccd agent shared deploy` printed nothing. Build on `origin/main` at dispatch, and
  re-measure every anchor by its quoted text first.
- **Unmeasured rows.** Every row marked *(revised, unmeasured)* is measured first, and the measured value goes in
  the worker's ledger and the wave-done.
- **Memory.** The memory rules in Global Constraints stand as written. The slice read 23.0 GB at the ruling, so
  expect waits. When the 30-minute cap is reached, use CI, and the wave-done names every batch that did not run
  locally, with the readings.
