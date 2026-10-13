# GPT lane ownership — Plan 3a: what the tree must do before any roster row is flipped — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land every code precondition of the GPT-lane cutover, so that Plan 3b's per-lane flip has nothing left to write in this tree. Six things, each one task or more:
- for a codex-kind lane, the model probe reads that lane's own `authDir` through that lane's own runtime, with no token-directory default. An `external` lane's probe keeps today's environment and fetch, the default included, until that lane's own flip in Plan 3b (ruling Z1, Z2);
- the external `_models_litellm` arm keeps its bytes on today's shape. It never runs the other repository's stop once a codex lane exists, and an `external` lane cannot gain a codex class registry (Z3, Z4);
- `_check_codex` and its `--fix` exist (spec §12);
- the settings-env drift check sees a codex lane;
- the usage pair is ccrc's, under its own name, `ccrc-codex-usage@.{service,timer}`, and converges to exactly the roster's codex lanes;
- the whole cutover is rehearsed in fixtures: today's live shape changes nothing that runs, a flip converges, a flip-back converges, and after one lane's flip a still-external lane's arm never stops a codex tier.

All of it is **inert on a roster with no `codex` row, and on today's live shape** (stated by shape in [Global Constraints](#global-constraints)). Merging this plan auto-releases, and both boxes follow the dev channel on their own, so the merge is itself a rollout. Under operator ruling Z (2026-10-01) that rollout changes nothing that runs on the live box. It adds two unit files at unused names with no instance, one install transcript line, and a `codex` doctor row that answers SKIP. Beyond that, only verbs an operator runs answer differently, chiefly `ccrc models <id> init codex`, which now refuses to create a codex registry on a row that is not `exec.kind: "codex"`, the live `external` rows included. [Merge authorisation](#merge-authorisation) lists exactly that, with the one difference a failure path can reach.

**Architecture:** No new executable and no new process primitive. Everything lands in seams that already exist:
- `ccd/ccrc-models-probe` and `_models_run_probe` (`ccd/ccrc`): a codex-kind row exports its own `$HOME/<exec.authDir>` and runs the probe's codex-lane arm under `ccgpt-runtime python`, with no default. That arm refuses the device flow inside the process, before anything is written, and reads `ChatGPT-Account-Id` through `Authenticator().get_account_id()`. Every other row keeps the base's probe environment, and `_fetch_codex` keeps its bytes, the token-directory default included (Z1, Z2).
- `_models_litellm`'s external arm (`ccd/ccrc`) keeps its box-global path, its `pgrep` and its bare `ccgpt stop`, and the hourly refresh keeps reaching it, until each lane's flip (Z1). Task 2 adds two narrow refusals and nothing else:
  - while the roster carries any `codex` row, the arm refuses that stop through its existing `restart-failed` path, before any write (Z4);
  - `deploy/models-op.mjs`' `init` op, the one creator of a class registry, refuses by name (`codex-registry-needs-codex-lane`) to create a codex registry on any row that is not `exec.kind: "codex"`, the live `external` rows included (Z3).
- `ccd/ccrc-doctor-checks` gains `_check_codex`, the table entry after `models`, `_fix_codex`, and `_fix_wrappers` (the marker-verified launcher's cure). They are composed from Plan 2b-2's read-only lane primitives behind `declare -F`, plus one new check-only `materialise` in `deploy/models-op.mjs`.
- `deploy/account-op.mjs`'s `effectiveBaseUrl` learns the codex lane's loopback shim.
- The usage pair moves to `deploy/systemd/ccrc-codex-usage@.{service,timer}`:
  - `_inst_units` places it on the `fleet` and `both` roles, on Linux only;
  - `_inst_enable` converges the enabled instances to exactly the roster's codex lanes, and yields to a foreign instance for the same id;
  - uninstall, account removal and the fallback deploy carry it by one census.
- `cmd_wrappers --force` backs up a symlinked launcher as a symlink.
- The rehearsal (Task 10) runs the live shape, a flip and a flip-back end to end, as new describes in `server/test/ccrc-install.test.ts` and `server/test/ccrc-update.test.ts`, whose module-private harness it needs.

Plan 3b (the per-lane live runbook, authorised once per lane) and Plan 4 are separate plans, written later. Plan 4 is the other repository's deletion and the box cleanup, plus a small ccrc PR. Once no external lane has a codex registry, that PR deletes the external arm, the probe default, the external fetch's direct `auth.json` read, and the guards Z3 and Z4 add (Z8). What the two plans inherit is in [Carry-forward to Plan 3b and Plan 4](#carry-forward-to-plan-3b-and-plan-4).

**Tech Stack:** bash (`ccd/ccrc`, `ccd/ccrc-doctor-checks`, `ccd/ccrc-models-probe`, `deploy/deploy.sh`), Python 3 (the probe's embedded programs and `ccd/ccgpt-usage.py`), Node ESM (`deploy/account-op.mjs`, `deploy/models-op.mjs`), systemd unit files, and vitest (`server/test`, `agent/test`).

**Spec:** `docs/superpowers/specs/2026-09-20-gpt-lane-ownership-design.md`. This plan implements:
- §9, for a codex lane: the probe stops guessing, and nothing this plan adds opens an OAuth file. An external lane's probe is §19.6's, kept until its flip (D-3706);
- §10, usage publication;
- §11, placement, role and the fallback deploy;
- §12, doctor and `doctor --fix`;
- §13, uninstall;
- §15 steps 1-2, ccrc first and the roster last. Steps 3-4 are Plans 3b and 4.

It also reads §19, Plan 2b-2's amendments, above all §19.6, which left the external arm "until Plan 3's cutover retires that arm". Operator ruling Z (2026-10-01) keeps that sentence as written: each lane leaves the external path at its own flip in Plan 3b, and Plan 4's ccrc PR deletes the path. Where this plan departs from the spec, the departure carries an allocator-issued number, defined in [Deviations found](#deviations-found). Ruling Z's one new departure is D-3753, issued by the allocator on 2026-10-01. Task 11 appends `## 20. Amendments (Plan 3a)` to the spec.

> **Measurements.** Facts cited as "the 2026-09-30 … census" were taken read-only, while this plan was drafted, on the operator's fleet box and in this tree at `1f9fa22d` (`origin/main`, with Plan 2b-2 merged). The reports are not tracked. Every live value in them is stated here **by shape only** (ruling R13): no id, label, port, path, host, session name or version of the live box appears in this plan, except one name the base tree already spells: the probe's default token directory (Global Constraints). Each fact a task depends on is restated in that task, and the implementer re-measures it before relying on it. The server box was not measured.

---

## Rulings this plan is built on

The controller rulings R-C1…R-C12 are the questions the skeleton put to the controller, adopted as their recommendations say (controller rulings R4, R5) except where a later ruling reshapes them (R3 reshapes R-C12, and the fix-round ruling F9 reshapes R3's fallback). **Operator ruling Z (2026-10-01) binds over every one of them.** It replaces R-C2 and withdraws R-C3, and with them the parts of R3 and R4 that carried them: R3's refusal, skip and `_check_models` sentence, and R4 whole. Its clauses are cited Z1…Z9. Each departure is an allocator-issued number. [Deviations found](#deviations-found) defines it, and the tasks cite it.

| Ruling | What the tree does | Named departure | Departs from |
|---|---|---|---|
| R-C1 (R2) | The usage pair is ccrc's, as `ccrc-codex-usage@.{service,timer}`. ccrc never places, enables, disables or removes `ccgpt-usage@` or the flat `ccgpt-usage.{service,timer}` | `D-3717` | spec §4.3, §10, §12 and §13, which name `ccgpt-usage@<id>.timer` |
| Task 6 | The enabled instance set converges to exactly the roster's codex lanes, so a flip-back disables that id's instance | `D-3718` | spec §11, which covers placement only |
| R6 | The converge degrades rather than enables `ccrc-codex-usage@<id>.timer` while the other repository's `ccgpt-usage@<id>.timer` is enabled for the same id. `_check_codex` WARNs, and the remedy is the operator's own disable. The flat, id-less foreign timer cannot be attributed to a lane, and the row says so | `D-3719` | spec §15.3, where retiring the foreign timer was only the runbook's step order |
| R2 | On Darwin the usage placement and the usage doctor rows answer a stated not-applicable, with a forced-Darwin test | `D-3720` | spec §12's usage WARN rows |
| R-C2, replaced by operator ruling Z (Z1, Z2, Z3) | A codex-kind lane's probe reads its own `authDir` through its own runtime, with no default (Task 1). An `external` lane keeps today's probe environment and fetch, the default included, and the hourly refresh keeps probing and refreshing it until its flip. In place of R-C2's freeze, the one creator of a class registry refuses by name (`codex-registry-needs-codex-lane`) to create a codex registry on a row that is not `exec.kind: "codex"`: the live `external` rows, the shape Z3 names, and a non-Anthropic `generated` row, which declares no `authDir` either. Its remedy is "flip the lane to `codex` first (Plan 3b)". A registry that already exists is untouched (Task 2). `_check_models` is unchanged | `D-3706`, redefined by Z6 | spec §9.1's "loses its default outright": the default stays for external lanes until their flip, and a codex registry cannot be created on an external lane. §19.6, under which external lanes keep today's behaviour until the cutover, is conformed to |
| R3, narrowed by Z2 | The device flow is prevented inside the process, before any write to `auth.json`, in the probe's codex-lane arm and in `ccd/ccgpt-usage.py`, which nothing live runs. The probe's external fetch keeps its bytes, so Z2's one-program allowance is not taken. The usage service gets `TimeoutStartSec=300` (Task 1; Task 6's `git mv` carries it) | `D-3707` | spec §9, §10 and §19.3, which name neither refusal |
| R-C12, reshaped by R3, F9 and Z2 | D-3161 closes on the codex-lane arm, through `Authenticator().get_account_id()`. The external fetch keeps its direct `account_id` read, the base's bytes, until Plan 4's ccrc PR deletes that path (Z8). Task 1 measured the method in the installed LiteLLM at drafting, and its Step 0b re-measures it read-only, by grepping the installed `Authenticator`'s source file, never by running one. If the method is gone, Task 1 stops and reports, and the controller rules. F9 replaces R3's "stays deferred, recorded by slug", so no fallback is chosen and no slug is pre-named | none: closing D-3161 on the path this plan adds is conformance to spec §9, so it mints no number. The external path's read is the breach D-3161 already records | — |
| R-C3, withdrawn by operator ruling Z (Z1) | The external `_models_litellm` arm is NOT retired before the flip. Its box-global path, its `pgrep` and its bare `ccgpt stop` keep their bytes on today's shape, and the hourly refresh keeps reaching it, until each lane's flip in Plan 3b. Plan 4's ccrc PR deletes it (Z8) | `D-3708`, redefined by Z6 as "withdrawn by operator ruling Z (2026-10-01)" and kept as a recorded decision | none: spec §19.6 stands as written |
| Z4 | While the roster carries any `codex` row, the external arm refuses its bare `ccgpt stop` through its existing `restart-failed` refusal, with a sentence naming why, before any write. A bare `ccgpt stop` stops units by name, and after a flip those names are ccrc's own tiers (spec §19.2; critic #7). With no codex row, as today, the arm is unchanged (Task 2) | `D-3753`, issued by the allocator on 2026-10-01 | spec §8 and §19.6, under which an external lane keeps the bare `ccgpt stop` byte for byte until the cutover |
| R-C4 | `_check_codex` may connect to the ports the roster names for a codex lane, each connect bounded by `CCRC_CODEX_PROBE_S` (default 2 s, `ccd/ccrc:10345`) | none: §12's listener rows need it | — |
| R-C5 | Doctor trusts `ccgpt-runtime check` (the stamp). `--fix` rebuilds, and the rebuild re-probes | `D-3711` | spec §12, "failing its behaviour probe" |
| R-C6 | `_codex_lanes` rc 1 (roster unreadable) and rc 2 (no `jq`) are FAIL, never SKIP | `D-3710` | spec §12, which defines only the empty-set SKIP |
| R-C7 | For a codex lane, a settings-env `ANTHROPIC_BASE_URL` that is absent, or equal to `http://127.0.0.1:<proxyPort>`, is healthy. Present and different is WARN | `D-3709` | Plan 2b-2 carry-forward 8 |
| R-C8 | `cmd_doctor` keeps its FAIL-only fixer contract. The missing-timer WARN names `ccrc install` as its remedy, and a tier whose only finding is stale code, also a WARN, names `ccrc update` | `D-3721` | spec §12 ("`--fix` may … enable a missing usage timer, and restart a verified ccrc-owned active tier", read for a tier that is only stale) |
| R-C9 | Uninstall runs `disable --now` on every enabled ccrc usage instance | none: spec §13 already says so | — |
| R-C10 | Plan 3b's route: a targeted `ccgpt-runtime build` and a targeted instance enable, never a full `ccrc install` inside a lane window. 3a ships nothing for it, and the merge confirms nothing about it; see the note in [Merge authorisation](#merge-authorisation) | none in 3a | — |
| R-C11 (R5) | `deploy.sh` stops placing `~/.local/bin/ccrc-models-probe`, in Task 7 with every other `deploy-verify` edit | none: 2b-1 carry-forward 21 | — |
| R7 | `lane.json`'s staleness against the registry is measured by a check-only `materialise --check true`, which writes nothing and answers `changed`. Without `--check` it writes, as every caller before it expects. Task 4 uses it and Task 8 cures it | `D-3712` | R7's parenthetical (a bare `materialise`, no `--commit`, as the check) and `deploy/models-op.mjs`' write-always contract |
| R8 | `--fix` regenerates a launcher only when it is marker-verified, through a new `_fix_wrappers` that runs the shipped `ccrc wrappers` with no flag | `D-3730` | spec §12, which places it under `_check_codex`'s `--fix` |
| R9, R10 | The spec amendments are appended as §20. Every live GPT-lane label that the class's own `passes` does not pin joins `topology-clean`'s fleet-account-label class. One live label is byte-equal to a pinned pass, so it stays out and Task 11's hand-grep covers it | `D-3722` | ruling R10, which adds both labels |

## Global Constraints

Every task's requirements implicitly include this section. The first two groups are Plan 2b-2's, and still bind. The last two are this plan's own.

**Repository and process (carried from 2b-2)**
- **Node floor `>=22.13.0`**, identical across the three engines. Never lower an `engines` field to make a test green.
- **The repository is PUBLIC (AGPL-3.0).** No tracked byte may carry a real account id, lane name, label, email, host, port, credential, OAuth path, config name, session codename, operator username, version of a live box, or real model id (ruling R13). Nor is a real value printed, even transiently: real labels are handled only base64-encoded, in `0600` scratch files, with test output suppressed and the verdict read from the exit code, and a red-first proof for the residue class uses a synthetic label inside a disposable copy (`git archive HEAD | tar -x -C <tmp>`, plus a `server/node_modules` symlink). Fixture vocabulary:
  - ids `codex-a` and `codex-b` (kind `codex`);
  - `ext-a` and `ext-b` (kind `external`, `telemetry: "codex"`): the live lanes' shape in unit cases (Tasks 2, 3, 6, 7; Task 1 hands `ext-a` to the probe as an argument only, never as a roster row). The rehearsal (Task 10) instead flips `codex-a` and `codex-b` between the two kinds;
  - `gen-a` (kind `generated`): the third row Task 2's Z3 refusal is measured on;
  - the tree's existing non-live `router` row;
  - `claude` (upstream) and `claude2` (generated);
  - `authDir` `.local/share/ccrc/codex/<id>`, written only through `codexAuthDir(id)`;
  - token `test-token-not-a-secret`, model ids `gpt-x` and `probe-model`;
  - ports from `freePorts()` for anything that listens, and `45010`/`45011`/`45020`/`45021` only for pure-parse fixtures that open no socket.

  **No fixture id equals a rostered id** (ruling R11). Measured 2026-09-30: none of the fixture ids above is on the live roster, and on 2026-10-01 again with `gen-a` (a count, 0). Task 11 re-checks this by comparison, without printing the roster.

  **One live path is the tree's own spelling, and public:** the probe's token-directory default, `$HOME/.handoff/chatgpt-auth` (`ccd/ccrc-models-probe:162` at the base, and the spec's §1 table and §9.1). It is the first lane's OAuth directory, but the base already carries it, so Task 11 Step 4's hand-grep drops it as a name the base carries. Task 10's live-shape fixture names it to model that default. Task 1 adds no line that spells it, so its cut can prove mechanically that `_fetch_codex` stays the one holder in the probe.
- **`ccd/ccd` is not edited at all.** An edit means a re-stamp and a charge on the compaction-card census, and 3a needs neither. `ccd/ccrc` is hand-written and carries no marker (D-3171).
- **The base.** This plan was measured at `1f9fa22d`. Rebase onto `origin/main` before Task 1. Every line number, count and case count quoted below is an example to RE-DERIVE, never a value to paste. Locate every subject by its name plus a grep at execution time. Post-condition diffs compare against the task's own recorded base, never against `origin/main`. Each task's Step 0 writes that base to a file of its own, and every later block of that task reads it back from that file, never from a variable an earlier call set: Task 1 `$SCRATCH/t1/base`; Tasks 2 and 3 `$SCRATCH/t2-base` and `$SCRATCH/t3-base`; Tasks 4 and 5 `$SCRATCH/base`; Tasks 6 and 7 `$SCRATCH/t6-base` and `$SCRATCH/t7-base`; Tasks 8 and 9 `$EVID/task8-base` and `$EVID/task9-base`; Tasks 10 and 11 `$SCRATCH/t10-base` and `$SCRATCH/t11-base`, the merge-base they name. The sourced `plan3a-env.sh` (below) reads `$SCRATCH/base` into `$BASE`, so Tasks 4 and 5 use `$BASE` as it stands. Every other task sets `BASE="$(cat <its file>)"` in the block that needs it, because the env's `$BASE` may be an earlier task's. A scope or residue check runs after the task's own commit, as `git diff "$BASE" HEAD`, or before it against the worktree or the index (`git diff "$BASE"`, `git diff --cached "$BASE"`), never as a `$BASE..HEAD` diff before the commit exists.
- **Fixture HOMEs only.** Never run `ccrc`, `ccd`, `ccgpt-runtime`, `ccrc-codex`, `ccrc-models-probe` or either Python file against the live `$HOME`. The harnesses:
  - `makeCcdHarness` (`server/test/ccdWsHelpers.ts`);
  - `installFixtureTree` (`server/test/installTreeFixture.ts`);
  - `ccgptHarness.ts`;
  - `codexLaneFixture.ts`.
- **Never run the destructive `ccd` verbs** (`ws-rm`, `ws-reap`, `ws-gc --prune`, `ws-archive`, `ws-restore`, `ws-reclaim`). Never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or any `claude-session@*` unit.
- **Single source of truth.** Runtime lists are derived from one declaration, never hand-kept twice (`single-definition.test.ts`). `single-definition.test.ts` also pins an exact count of lines that touch `.classes.json` in `ccd/ccrc-doctor-checks` (`server/test/single-definition.test.ts:1795`): two at the base, and still two when this plan ends. The earlier draft's third reader, `_check_models`' own read of a registry's `probe` field for a lane the refresh skipped, went with ruling Z, which leaves `_check_models`' verdicts unchanged. `_check_codex` reads registry facts only through `deploy/models-op.mjs` check-only ops, never by naming the file. Any new reader re-measures the count.
- **Mutation-table discipline.** Every guard ships with a case that goes RED when the guard is mutated, measured both ways with counts. If a demanded mutation does not red, **report that it does not**. Never manufacture code to force a bind (D-3152). A mutation row backs up every file it edits, one backup per file, and verifies its restore with `git diff --quiet -- <files>`. Anything a mutation makes block (a FIFO, a sleep, a listener) runs under `timeout`, so nothing outlives the census.
- **Suites.**
  - Run each suite in the FOREGROUND from inside its package, with a timeout of at least 600000 ms, as `./node_modules/.bin/vitest run test/<file>.test.ts`. Never bare `npx vitest`. Every such command is wrapped in the census below.
  - Each server shard is its own foreground call (`--shard=<i>/12`, twelve calls), each under the tool's 600 s cap. No call loops several suites that together could pass it, and the agent and pwa suites are separate calls.
  - **`server/test/ccrc-doctor.test.ts` is never run whole in one call.** Census-wrapped and alone, it took 424 s and 525 s in two measurements at `1f9fa22d`, against that cap, and this plan adds about a hundred cases to it. So wherever a step runs it with no `-t`, it is three foreground calls, the step's evidence label suffixed `-1`, `-2` and `-3`, with these complementary filters (`<k>`/`<P>`): `1`/`'^ccrc doctor: [a-c]'`, `2`/`'^ccrc doctor: [d-m]'` and `3`/`'^(?!ccrc doctor: [a-m])'`. At `1f9fa22d` they selected 88, 123 and 288 of the 499 cases `vitest list` names. The step's whole-file count is the three parts' sum. A part that runs past about 500 s is split again at another letter, keeping the parts complementary. A mutation row that names doctor cases runs only the part that holds them.
  - `tsc --noEmit` does not read `server/test/`. When a task writes a test file, its typecheck step is `./node_modules/.bin/vitest run test/typecheck-tests.test.ts` (D-3163).
  - Known load flakes (the repository's `CLAUDE.md` list) are re-run in isolation before anyone calls them a real break.
- **Deviation numbers are issued, never chosen.** This plan's own departures were minted by the allocator on 2026-10-01 and are defined individually in [Deviations found](#deviations-found). Ruling Z's new departure was issued by the allocator on 2026-10-01 as `D-3753` (slug `external-arm-never-stops-a-codex-tier`); the plan carries no unminted slug. A task that finds a new departure during execution reports it with a proposed slug, `⟦D:<short-slug>⟧` (ruling R12), and the controller mints its number and substitutes it. Never write a number nobody issued, a `D-TBD`, or a range.
- **Commits** land on the workspace's own branch, never a separate feature branch, with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, the message passed as `git commit -F - <<'EOF' … EOF` (or `--amend -F -` onto a task's WIP commit). **The commit-identity rule:** author and committer are the noreply identity this worktree's git config already carries. No task passes `-c user.*` or copies another commit's author. After every commit, `git log -1 --format='%an <%ae> | %cn <%ce>'` shows that identity only, and any other stops the task before anything is pushed (the pre-push hook refuses identity residue). Task 11 checks the whole branch the same way.

**The live box (carried from 2b-2, widened)**
- **Never write, move or delete** another repository's files:
  - `~/.local/bin/ccgpt`, `~/.local/bin/ccgpt-proxy`, `~/.local/bin/ccgpt-usage`;
  - any per-lane launcher that is not marker-verified;
  - any `~/.config/systemd/user/ccgpt-usage*` file;
  - anything in the other repository's shared `0600` env file or its config directory (spec §15).
- **Never start, stop, restart, `reset-failed`, enable or disable any `ccgpt-*` unit or any `ccgpt-usage*` timer** on the real user manager, and never bind or probe a live lane's port. No code this plan adds does it either (ruling R6). The one existing path that can, the external arm's bare `ccgpt stop` (`ccd/ccrc:10031`), keeps the base's bytes on today's shape (Z1), and refuses once any `codex` row exists (Z4). Where a foreign unit blocks convergence, ccrc degrades and names the operator's own act.
- **No repository-wide or destructive git on the live box:** no `git worktree prune`, `gc`, `stash`, branch deletion or `reset`. A test's fixture worktree lives in a disposable clone or under its own `mkTmp`, and is removed by path.
- **Never read or print a live unit's `Environment=`, or any key-bearing file** (`runtime.env`, `auth.json`, a secrets file, the other repository's env file). Any check on one is count-only.
- **Nothing this plan adds to doctor, the probe, the publisher, `--fix` or a test opens an `auth.json`** (spec §9): existence and mode only. A `0000`-mode `auth.json` fixture must still pass every check that concerns it. The codex-lane arm's `account_id` comes from `get_account_id()`, closing D-3161 there, per R3, F9 and Z2: if the installed `Authenticator` has lost that method, Task 1 stops and reports. The external fetch's own read of `auth.json` for `account_id` is the base's bytes, which Z1 keeps until Plan 4's ccrc PR deletes that path (Z8). A case that drives that path does so only against a fixture `auth.json` under a `mkTmp` HOME.
- **Every `systemd-run` and `systemctl` a test can reach is a fixture.** A task that adds such a path plants a recorder (`plantSystemd` with `systemctlCalls`/`systemdRunCalls`, or the harness's own) **in the same commit**. This plan adds enable and disable paths in Tasks 6 and 7.
- **Every `ccgpt` and `pgrep` a test can reach is a stand-in.** Ruling Z keeps the external arm's bare `ccgpt stop`, and on the live box that verb stops the live lanes' tiers by name. The census cannot catch it: it flags a new unit or a vanished enablement link, and a stopped `--collect` transient unit simply leaves the listing. So a case that drives the external arm plants a recording `ccgpt` and `pgrep` in its fixture HOME's `~/.local/bin`, as `server/test/ccrc-models.test.ts` already does per describe (`:1315`, `:1632-1634`), and Task 2 makes that file's `env()` poison both wherever the HOME holds no stand-in, and stop inheriting `CCGPT_CONFIG`, the other repository's override of the arm's box-global path, which the arm still honours. Task 10 drops `CCGPT_CONFIG` too, and proves both names resolve to stand-ins before any run that can reach the arm (`REHEARSAL_ENV`, `assertForeignFront`).
- **No real litellm in the default suite.** Cases that need it are opt-in, behind `describe.skipIf(!process.env.CCRC_TEST_LITELLM_PY)`. Anything that imports litellm sets `LITELLM_LOCAL_MODEL_COST_MAP=True` and `PYTHONDONTWRITEBYTECODE=1`, and gets a `mkTmp` HOME and a synthetic token directory.
- **Containment census on every suite command (ruling R11).** 2b-2's suites leaked a real transient unit named for a fixture lane, plus fixture processes, into the live user manager. A recorder is necessary, not sufficient. So every suite command in this plan runs between two snapshots, and a step whose census fails has failed, whatever vitest printed. The census signals nothing: a leak is reported to the controller, and removing a leaked real unit is the operator's act.

  **A code block nested under a list item is run with its fence's indentation removed,** so every heredoc terminator (`EOF`) reaches column 0; copied with its indent, a heredoc never ends.

  **One sourced file carries every name a block uses,** because an agent's shell keeps no variable, function or working directory between Bash calls. Before Task 1, choose one absolute scratch directory, once: outside the tree, never tracked, and not under the temp root's `ccrc-` or `ccgpt-` prefixes, which the process census counts. Write `plan3a-env.sh` there, beside the census script:

  ```bash
  S='<abs scratch>'; T='<abs worktree>'   # typed here and in each block's source line, nowhere else
  mkdir -p "$S" && printf "SCRATCH='%s'\nTREE='%s'\n" "$S" "$T" > "$S/plan3a-env.sh" && cat >> "$S/plan3a-env.sh" <<'EOF'
  # plan3a-env.sh: Plan 3a's one sourced file. Line 1 is SCRATCH, line 2 the worktree.
  CENSUS="$SCRATCH/census-run.sh"; R11="$CENSUS"; CR="$CENSUS"   # one script, the three spellings the tasks use
  EVID="$SCRATCH/census"; mkdir -p "$EVID"                         # the default evidence root: "$EVID/<label>"
  r11()    { "$CENSUS" "$EVID/$1" "${@:2}"; }      # r11 <label> <command…>
  census() { "$CENSUS" "$EVID/t1-$1" "${@:2}"; }   # Task 1's spelling: census <label> <command…>
  # Tasks 4 and 5's base: their Step 0 writes the file. Every other task reads its own base file itself.
  BASE=''; if [ -s "$SCRATCH/base" ]; then BASE="$(cat "$SCRATCH/base")"; fi
  cd "$TREE" || return 1   # every block starts at the worktree root, whatever the last call left
  EOF
  ```

  **Every bash block in this plan that uses a helper, `$SCRATCH`, `$TREE` or `$BASE` begins with `. "<abs scratch>/plan3a-env.sh"`, and a block that runs from a package then `cd`s there itself. Sourcing the file leaves the shell at the worktree root, so a block's own `cd server` (or `cd "$TREE/server"`) depends on nothing an earlier call did. No block relies on a variable, function or directory an earlier block set.** Then write the census body below to `"$SCRATCH/census-run.sh"` with a quoted heredoc (`<<'EOF'`), and `chmod +x` it:

  ```bash
  #!/usr/bin/env bash
  # census-run.sh <evidence-dir> <command...>: Plan 3a's containment gate (ruling R11).
  # It OBSERVES only. It signals nothing, stops nothing, and reads no unit property:
  # `systemctl --user list-units` names, the user manager's `timers.target.wants` link
  # names and `ps` rows, before and after one command. It prints no unit name.
  set -uo pipefail
  [ "$#" -ge 2 ] || { echo "usage: census-run.sh <evidence-dir> <command...>" >&2; exit 64; }
  out=$1; shift
  mkdir -p -- "$out" || exit 1
  root="$(cd "${TMPDIR:-/tmp}" && pwd -P)/"
  # Unit NAMES only: a live foreign oneshot changes state on its own timer, so a
  # state column would red a clean run. A name that was not there before is a leak.
  # Enablement links too, as `wants:<unit>`: `enable` and `disable` change a link,
  # and a disabled unit can stay loaded, so a link is the one trace both acts leave.
  units() {
    local w="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/timers.target.wants" l names
    names="$(LC_ALL=C systemctl --user list-units --all --no-legend --plain \
      'ccgpt-*' 'ccrc-codex-usage@*' | awk '{ print $1 }')" || return 1
    for l in "$w"/ccgpt-* "$w"/ccrc-codex-usage@*; do
      if [ -L "$l" ] || [ -e "$l" ]; then names="$names"$'\n'"wants:${l##*/}"; fi
    done
    printf '%s\n' "$names" | sed '/^$/d' | sort -u
  }
  # Fixture processes: this user's processes with an argv token under the temp
  # root's `ccrc-` or `ccgpt-` fixture prefixes (`mkTmp`'s). Only pid, ppid, start
  # time and those tokens are kept: another session's argv can carry a credential.
  procs() {
    ps -u "$(id -u)" -o pid=,ppid=,lstart=,args= 2>/dev/null | awk -v r="$root" '
      /census-run\.sh/ { next }
      { keep = ""
        for (i = 8; i <= NF; i++) { t = $i; sub(/^[^\/]*=/, "", t); gsub(/[\047"]/, "", t)
          if (index(t, r "ccrc-") == 1 || index(t, r "ccgpt-") == 1) keep = keep " " t }
        if (keep != "") print $1, $2, $3, $4, $5, $6, $7 keep }' | sort -n
  }
  units > "$out/units-before.txt" || { echo "census: the before snapshot failed; nothing was run" >&2; exit 1; }
  procs > "$out/procs-before.txt"
  "$@" 2>&1 | tee "$out/run.txt"
  rc=${PIPESTATUS[0]}
  units > "$out/units-after.txt"
  sleep 5   # a fixture supervisor lingers three seconds after it completes (spec §19.9)
  procs > "$out/procs-after.txt"
  # A name that appeared, and an enablement link that vanished (as `gone:wants:<unit>`).
  { comm -13 "$out/units-before.txt" "$out/units-after.txt"
    comm -23 "$out/units-before.txt" "$out/units-after.txt" | grep '^wants:' | sed 's/^/gone:/'
  } > "$out/new-units.txt"
  # FILENAME, not NR==FNR: with an empty before-file NR==FNR holds for every
  # after-line too, and every leak would read as already seen (measured).
  awk 'FILENAME == ARGV[1] { seen[$1] = 1; next } !($1 in seen)' "$out/procs-before.txt" "$out/procs-after.txt" > "$out/leaks.txt"
  if [ -s "$out/new-units.txt" ]; then
    echo "census: FAIL — $(wc -l < "$out/new-units.txt" | tr -d ' ') unit or link change(s) on the real user manager; nothing was stopped; see $out/new-units.txt, by count" >&2
    exit 125
  fi
  if [ -s "$out/leaks.txt" ]; then
    echo "census: FAIL — $(wc -l < "$out/leaks.txt" | tr -d ' ') fixture process(es) survived; nothing was signalled; see $out/leaks.txt" >&2
    exit 126
  fi
  echo "census: clean — no unit or link change, 0 fixture processes left; command exit $rc"
  exit "$rc"
  ```

  **What it leaves, exactly.** Seven files in its evidence dir: `units-before.txt`, `units-after.txt`, `new-units.txt`, `procs-before.txt`, `procs-after.txt`, `leaks.txt` and `run.txt` (the command's own output). And one verdict line: `census: clean …`, or `census: FAIL …` with exit 125 (a unit or link change) or 126 (a surviving fixture process). A clean census exits with the wrapped command's own code: 0 when it is green, and its own non-zero code when it is red on purpose, still under a `census: clean` line. So the command's verdict and the census's are read separately. Nothing else is a census output, and a step that names another file or message means one of these. Before anything runs, a bad argument list exits 64 and a failed first snapshot exits 1; neither is a verdict.

  **A census FAIL stops the step; it is not yet a verdict.** Other sessions run suites on this box, and a foreign lane's own transient tiers can start mid-run, so every hit is attributed before it counts. It is attributed by count, never by printing `new-units.txt`, because a foreign name can carry a live id:

  ```bash
  . "<abs scratch>/plan3a-env.sh"; f="<that run's evidence dir>/new-units.txt"; fx='(^|[-@:])codex-[ab]([-.]|$)|ccrc-codex-usage@'
  grep -v '^gone:' "$f" | grep -cE "$fx"    # fixture-named: a leak; these lines carry no real value and may be named
  grep -c '^gone:' "$f"                     # a vanished enablement link: a leak, reported by count
  grep -v '^gone:' "$f" | grep -vcE "$fx"   # foreign: count only
  ```

  - a new unit or link counts only if its name carries a fixture lane id (`codex-a`, `codex-b`) or is any `ccrc-codex-usage@*` instance, since no live lane has one before Plan 3b;
  - a `gone:` line always counts: no code 3a ships and no suite may disable a unit on the real manager, and the operator's own disables are Plan 3b's;
  - a surviving process counts only if its fixture path is one this command's own run created (named in the evidence dir's `run.txt`, or under the test file's own `mkTmp` prefix);
  - anything else is foreign. When every hit of a run is foreign, mark that run's evidence dir with `touch "<its evidence dir>/attributed-foreign"`, the one marker Task 11's closing gate reads, then re-run the command in isolation under a new label.

  Nothing is stopped or signalled either way. An attributable hit is a leak: report it and do not proceed. Task 11's closing gate applies this same rule over every evidence dir except the controls' `$SCRATCH/census-controls`, and counts only attributable hits.

  **Its three controls run once, before Task 1's first suite,** as Task 1's Step 0 runs this block. They write under `$SCRATCH/census-controls`, outside `$EVID`, because two of them fail on purpose:

  ```bash
  . "<abs scratch>/plan3a-env.sh"
  C="$SCRATCH/census-controls"; mkdir -p "$C/fake-sc"; rm -f "$C/fake-sc/n"
  "$CENSUS" "$C/true" true; echo "rc=$?"
  # → census: clean — no unit or link change, 0 fixture processes left; command exit 0, then rc=0
  cat > "$C/fake-sc/systemctl" <<EOF
  #!/bin/sh
  # A stand-in systemctl: silent on its first call, one fixture-shaped unit on every later one.
  if [ -e '$C/fake-sc/n' ]; then echo 'ccrc-codex-usage@census-probe.timer loaded inactive dead census control'; else : > '$C/fake-sc/n'; fi
  EOF
  chmod +x "$C/fake-sc/systemctl"
  PATH="$C/fake-sc:$PATH" "$CENSUS" "$C/units" true; echo "rc=$?"
  # → census: FAIL — 1 unit or link change(s) on the real user manager; …, then rc=125
  "$CENSUS" "$C/proc" bash -c "bash -c 'sleep 12; :' ${TMPDIR:-/tmp}/ccrc-census-probe >/dev/null 2>&1 &"; echo "rc=$?"
  # → census: FAIL — 1 fixture process(es) survived; …, then rc=126. The sleeper expires 12 s after it starts; nothing signals it.
  ```

  The first two were re-measured on this script during the plan's fix round, the clean one under a private `TMPDIR`: on the shared temp root, a concurrent session's own `ccrc-` fixtures turned it into a 126. The process control is the drafting measurement, and that part of the script is unchanged. A control that answers otherwise is re-run in isolation, never waved through.

  This is the plan's ONE census script. No task writes another or restates its body. The tasks spell it through the names `plan3a-env.sh` defines (`$CENSUS`, `$R11`, `$CR`, `r11` and `census`), sourced at the top of each block.

  A task that wants its own evidence root spells it in each block as a fixed path under the scratch directory (for example `"$EVID/t4-…"` or `"$SCRATCH/t6-ev"`), never a `mktemp -d` name, which a later block cannot recover. Every suite command runs through the census from `server/` (or `agent/`), in the foreground. Its expected output is vitest's own result, then the `census: clean` line, and its exit code is vitest's.

  A 125 or a 126 fails the step (R11) whatever vitest printed. Stop and report it with the attribution counts and the pids, naming a unit only when it is fixture-named, and never stop, reset or signal anything by hand. Two causes were measured while drafting, and both are still reported, never waved through: a live foreign lane's transient tiers appearing mid-run (125), and another session's `ccrc-` fixture under the same temp root (126). Re-run once in isolation before reporting either.

**Order invariants (carried from 2b-2)**
- Nothing follows `_inst_installed`, and `cmd_install` ends with `cmd_doctor`. `cmd_install`'s step list is pinned by an exact `toEqual`, so a new bare step is a deliberate, visible edit.
- **Every commit on the branch installs.** An install line never precedes its file. A renamed file and every line that names it (`TREE_FILES`, `_inst_units`, `_uninst_units`, `deploy.sh`, the censuses) move in one commit.
- **The whole plan is squash-merged:** one commit on `main`, one release, one rollout.
- `deploy.sh` hazards (spec §11). Several `*-ship.test.ts` suites locate their subject by an exact, un-shadowed `install_atomic` spelling. `graph-noise-ship.test.ts` holds a three-code-line drift budget around its pinned neighbours.
- New bash carries no un-shimmed GNU spelling (`sha256sum`, bare `timeout`, `stat -c`, `date -d`, `mv -T`, template-less `mktemp`). Inside `ccd/ccrc` and `ccd/ccrc-doctor-checks`, use the `_plat_*` helpers.

**This plan's own**
- **Inert on today's live shape, stated by shape** (rulings R1, R13, Z). Measured 2026-09-30, the live fleet box's shape is this:
  - Its roster has **no `codex` row**. It has two `external` rows with `provider: "openai"` and `telemetry: "codex"`, and neither declares ports or an `authDir`.
  - Call them the first lane and the second lane. The first has a class registry whose probe is codex, plus a catalogue. The second has only an effort file.
  - `~/.ccrc/runtime/codex/` and `~/.ccrc/codex/` are absent.
  - Both lanes' launchers are unmarked and belong to the other repository. One is a symlink to its shared launcher. The other is a small file that execs that launcher by path.
  - The other repository's flat usage timer and one instance of its `ccgpt-usage@` template are enabled. Its unit files carry no ccrc marker.
  - The second lane's two transient tiers run under `ccgpt-<id>-{litellm,shim}.service`, the unit names ccrc's own tiers use (spec §19.2), and that lane carries live sessions. At drafting the first lane was idle: no session, and no tier loaded. **Re-measured 2026-09-30, after drafting:** the first lane's two tiers run too, under the same unit-name shape, so the external arm's bare `ccgpt stop` is armed on the live box today, on its changed-and-running path. Z1 keeps that decision byte for byte, so the merge stays neutral ([Merge authorisation](#merge-authorisation)).
  - The hourly `ccrc-models.timer` refresh renders the other repository's box-global LiteLLM config through the external arm. The file's mtime matched the timer's last run. After the merge it goes on doing exactly that (Z1).
  - A stale `~/.local/bin/ccrc-models-probe` left by an older fallback deploy is on the box, and ccrc never runs it.

  On that shape the merge changes nothing that runs (ruling Z). [Merge authorisation](#merge-authorisation) lists exactly what it adds, and Task 10 is the proof, run in fixtures (Z7).
- **`ccd/ccgpt-runtime` and `ccd/ccgpt-proxy.py` are byte-identical to the base** (Task 11's cut).
  - `_rt_probe_source` (`ccd/ccgpt-runtime:591-781` at `1f9fa22d`) is hashed into every runtime stamp, so an edit there rebuilds the runtime on every box with a codex lane.
  - The shim's bytes are what `_codex_tier_stale` compares, so an edit there marks every running ccrc tier stale.
  - `ccd/ccrc-models-probe` is hashed by nothing (`ccd/ccgpt-runtime` names it only in a comment), so Task 1 may edit it, except for `_fetch_codex` (next item).
- **The external path keeps the base's bytes, in place** (ruling Z1). Task 11's cut proves each item:
  - `_fetch_codex` in `ccd/ccrc-models-probe` (`:153-196` at `1f9fa22d`) stays byte-identical, where it is. Task 1's codex-lane arm is a new function beside it, chosen where `_fetch` dispatches its `codex` kind (`:235`). So `git diff "$BASE" -- ccd/ccrc-models-probe` removes no line of `_fetch_codex`, and no added line spells the external default's directory, which that function already carries (R13).
  - `_models_litellm_path` and `_models_litellm_running` (`ccd/ccrc:9703-9717` at `1f9fa22d`) are unchanged. The external arm's body (`:10020-10051`) keeps every byte except one inserted block: Z4's refusal, inside the arm's `_models_litellm_running` branch, ahead of the `ccgpt stop` it guards. So the refusal is asked only where the base would run that stop.
  - For a row that is not `exec.kind: "codex"`, `_models_run_probe` hands the probe exactly the environment the base hands it, the `exec.secretsFile` re-supply included (Z7: "same probe env").
- **ccrc never touches a `ccgpt-usage` unit** (ruling R2). ccrc's pair is `ccrc-codex-usage@.service` and `ccrc-codex-usage@.timer`, with instances `ccrc-codex-usage@<id>.timer`. `install-census.test.ts`'s `FOREIGN_LIVE_BOX_UNIT_PREFIX = 'ccgpt-usage@'` stays and keeps refusing. Placement is `fleet` and `both`, Linux only. On Darwin, placement and the usage doctor rows answer a stated not-applicable: `_inst_units_darwin` places no timer at all, and macOS is not centrally managed (centralised-update design, decision 17).
- **Doctor mechanics** (spec §12).
  - Checks are sourced under `set -uo pipefail`, without `-e`, and a check's return code equals the worst class it printed.
  - A SKIP is exactly one SKIP line and `return 3`.
  - Every `$BOX_ENV_FILE` read is `[ -f ] && [ -r ]`, in that order, and tolerates `${BOX_ENV_FILE:-}`.
  - `_check_codex` connects only to ports the roster names for a codex lane, bounded by `CCRC_CODEX_PROBE_S` (R-C4). So every doctor case with a codex lane rosters ports from `freePorts()`, and never lets doctor connect to a port it did not plant or prove free.
  - `--fix` runs only on a FAIL (R-C8). The verdict is doctor's re-measurement, never the fixer's word. `--fix` never chooses a port, performs OAuth, reads a credential, signals a process it has not proved, overwrites an unverified launcher, or deletes state.
- **Every timer-enable degrade appends `INST_DEGRADED`** (Task 6), so the closing line never claims convergence over a failed enable.
- **Spec amendments are appended, never inserted** (ruling R9). The spec is 974 lines at `1f9fa22d`. Task 11 appends `## 20. Amendments (Plan 3a)` after the last line and makes same-line pointer edits only above it: **no line above §20 moves**. The tree cites the spec by line number: `ccd/ccgpt-usage.py` cites §5.4 line 333, `ccd/ccrc-models-probe` cites line ~497, and the Plan 2a plan cites lines 497 and 698. Task 11 proves it with a diff that shows only appended lines and same-line edits.
- **No rollout by hand, and no auto-update pause for this merge.** The merge rides ccrc's own updater, which is monitored and never replaced by a hand rollout (operator ruling 2026-09-30). This plan edits no roster. Nothing it adds writes, starts, stops, enables or disables anything of the other repository's. What today's external arm already does there, it goes on doing, byte for byte, until each lane's flip (Z1).

---

## Merge authorisation

- **The act.** An ordinary review, then one squash-merge of this plan's branch into `main`. This repository's merges need `--admin`. The plan edits no roster, nothing it adds writes, starts, stops, enables or disables a file or unit of the other repository, and it carries no hand rollout.
- **The merge is itself a rollout.** Every merge to `main` becomes a dev prerelease within about a minute (`.github/workflows/release-main.yml`). Both boxes follow the dev channel automatically (ruling R1). Measured 2026-09-30, the fleet box was already on `origin/main`'s tip, with `install: complete`. So within minutes both boxes run `ccrc update` onto this plan, meaning its install spine, its closing doctor and, from then on, the hourly `ccrc-models.timer`. **The operator approves the merge knowing that.** Under operator ruling Z (2026-10-01) the plan is built so that this rollout changes nothing that runs on today's live shape. So it carries no operator confirmation beyond the merge itself. The two the earlier draft asked for are gone: R-C2 is replaced and R-C3 withdrawn (Z1-Z4, Z6).
- **What the rollout adds on today's live shape, exactly:**
  - **Two unit files at unused names, with no instance.** The fleet box's user unit directory gains `ccrc-codex-usage@.service` and `ccrc-codex-usage@.timer`, names nothing else holds (D-3717). No instance is enabled, because no roster row is `codex`: the converge's set is empty, and there is no ccrc instance for it to disable. A `server`-role box places neither file, and neither does a Darwin box (D-3720).
  - **One new doctor row, a SKIP.** Doctor gains `codex`, which answers exactly one SKIP line: there is no codex lane, and no lane state under `~/.ccrc/codex/`. Every other check, `models` included, keeps its class, and Task 10 pins that check by check (Z7). Doctor's summary line counts one more check and one more skip. Its exit code, and so install's and update's, is unchanged, because a SKIP never counts as a FAIL (`cmd_doctor`, `ccd/ccrc:3348`, `:3412`).
  - **One new install transcript line.** Every install and update prints `install: codex-usage: none — no codex lane in the roster` (Task 6), beside Plan 2b-2's `install: codex runtime: none — no codex lane in the roster`. No shipped reader parses an `install:` line (measured: no hit under `server/src`, `agent/src`, `shared` or `pwa/src`, and `ccd/ccrc` greps none of its own).
  - **The hourly refresh does exactly what it did** (Z1). `ccrc-models.service` runs `ccrc models refresh --all` (`deploy/systemd/ccrc-models.service:11`), as before. The external lane with a codex registry is probed through the base's environment and the base's `_fetch_codex`, the token-directory default included. The other repository's box-global LiteLLM config is rendered by the same arm, and the `ccgpt stop` decision is the same. Z4's new refusal sits on that arm's stop path, but it fires only while the roster carries a `codex` row, and this roster carries none. Task 10 pins the probe environment, the render and the stop decision against the base tree.
  - **Re-measured 2026-09-30, after drafting: lane 1's tiers run.** So on the live box today the external arm's bare `ccgpt stop` is armed: a changed render while the proxy runs on the box-global config reaches it. The merge still changes nothing there. The base runs that same stop on that same render, Z1 keeps the decision byte for byte, and Z4's refusal cannot fire with no `codex` row. Task 10's second refresh pins exactly that arm against the base.
  - **Bytes that change where nothing on this shape runs them differently.** `ccd/ccrc-models-probe` gains a codex-lane arm beside `_fetch_codex`, which keeps its bytes. `~/.local/bin/ccgpt-usage.py` gains the device-flow guard and the absent-file remedy, but nothing live runs it: ccrc's pair has no instance, and the other repository's timers run that repository's own publisher (Z2). Doctor, install, account removal and uninstall gain arms that only a codex row, a flip-back or an operator's own verb reaches.
- **The verbs that answer differently, and only when an operator runs them:**
  - `ccrc models <id> init codex` that would create a registry on a row that is not `exec.kind: "codex"`, an `external` row included, is refused by name (`codex-registry-needs-codex-lane`), with the remedy "flip the lane to `codex` first (Plan 3b)" (Z3, Task 2). On today's shape that is the second lane, which has none. The first lane's registry exists, so `init codex` there creates nothing and keeps today's `created: false` answer. Nothing automatic creates a registry: the timer runs only `refresh --all`, and the agent's exec whitelist is `['tmux', 'ccd']` (`agent/src/whitelist.ts:192`).
  - `ccrc doctor --fix` gains `_fix_codex` and `_fix_wrappers` (Task 8). Each runs only on its own check's FAIL, and install's closing doctor runs without `--fix` (`_inst_doctor_tail`, `ccd/ccrc:13292`). `_fix_wrappers` runs `ccrc wrappers` with no flag, which overwrites only a launcher whose ccrc marker verifies and never writes an `external` row's launcher at all (`ccd/ccrc:3815`, `:4195`), so neither live GPT-lane launcher is reachable from it.
  - `ccrc wrappers --force` backs up a symlinked launcher as a symlink (Task 9).
- **Z2's allowance is not taken, so the probe behaves the same for an external row on every path.** Z2 lets the device-flow guard cover the external branch too, but only if the probe is one program for both kinds. It is not. The external fetch keeps the base's bytes, so an external lane whose token cannot be refreshed behaves exactly as it does today, device flow included, until its flip moves it onto the guarded arm.
- **The two failure-path-only differences.**
  - **Task 6.** If one of the nine existing timer enables fails, install's closing line names a degraded step where today it claims convergence. Nothing changes while every enable succeeds. The exit code is doctor's, unchanged, and no shipped file parses that sentence. Measured: outside `ccd/ccrc`'s own printing lines (`:12144-12150`) and comments, the two phrasings `every step above converged` and `converged with` match only `server/test/ccrc-install.test.ts`'s pins and one unrelated comment (`converged without`, `ccd/ccrc-doctor-checks:4914`).
  - **Z4's guard, fail-closed.** If the roster's codex lanes cannot be read at the moment of the stop (`_codex_lanes` rc 1 or 2), the external arm refuses `restart-failed` where the base would run the bare stop. Through `cmd_models` that needs the roster to change mid-run, so it is a failure path only.
- **What this merge does not authorise:** any roster edit; any act on the other repository's units, timers, launchers or configs; a class registry for the second lane; the first runtime build; `ccrc codex login`; parking a session; `ccrc account disable|enable`; pausing auto-update. All of these are Plan 3b's, authorised per lane.
- **A note for Plan 3b (R-C10), carried and not confirmed here.** Inside a lane window, 3b builds the runtime and enables that lane's usage instance by the targeted route: `ccgpt-runtime build`, then `systemctl --user enable --now ccrc-codex-usage@<id>.timer`. That equals the spine's own converge only once the operator has disabled that lane's foreign usage timer: its `ccgpt-usage@<id>.timer`, or the flat `ccgpt-usage.timer`, whose lane is the other repository's own default. Before that, the next update's converge withdraws an instance that a foreign template instance blocks, and an enable beside the flat timer leaves two writers for the lane, which the id-less flat timer hides from the converge. So the operator's foreign disable precedes both the roster flip and the enable, and only then is the next auto-update a no-op. Whether that route is the hand rollout the 2026-09-30 ruling forbids is Plan 3b's question to put to the operator. 3a ships nothing for it, and this merge decides nothing about it.
- **What the merge leaves for later (Z8).** At its flip, each lane leaves the external path by its row's kind alone, in Plan 3b: the probe, the LiteLLM arm and the usage converge all key on `exec.kind`. Plan 4's ccrc PR deletes the external arm, the probe default, the external fetch's direct `auth.json` read, and the reason Z3's and Z4's guards exist, once no external lane has a codex registry.
- **After the merge.** The controller measures read-only that each box's update record names the new release, and that the fleet box's closing doctor gives Task 10's live-shape classes: today's classes, check for check, plus one `codex` SKIP. Any difference is reported to the operator. The way back is the updater's own rollback, the PWA's or `ccrc rollback`, at the operator's word, never a hand edit. A rollback changes nothing that runs either, because the hourly refresh is the same on both sides of the merge. It drops Z3's and Z4's refusals with the rest of the new code. It also leaves the two `ccrc-codex-usage@` template files placed and inert, because an install places files and never removes one its tree does not name.

## Review Focus

1. **No codex-kind lane resolves another lane's token directory, and no external lane can gain the registry that would make it probe one.** Look for a default on the codex-lane arm; the scrub without a re-supply; a codex row routed to `_fetch_codex`, or an external row to the codex-lane arm; a writer that creates a codex registry for an `external` row (Z3); `deploy.sh` still placing the PATH probe copy; or `lane.json` carrying a previous id's `authDir`. Also check that nothing this plan adds opens an `auth.json` (the `0000`-mode fixture passes). The external fetch's own read is the base's bytes, kept by Z1. Pinned by Tasks 1, 2, 4 and 7.
2. **The device flow never starts in the codex-lane arm or the publisher.** No device-code request is made and nothing is written into `auth.json` (the stand-in's marks, in both files); the publisher prints no code; and the usage oneshot is bounded by `TimeoutStartSec`. The external fetch carries no guard, deliberately: Z2's allowance is not taken. Pinned by Task 1.
3. **One writer per lane's limits row.** The instance converge enables exactly the roster's codex lanes and disables a flipped-back id. It degrades, rather than enabling, while the other repository's instance for the same id is enabled, and `_check_codex`'s WARN names the operator's disable. No path disables, stops or rewrites a foreign unit, and the unattributable flat timer is said to be unattributable. Pinned by Tasks 6 and 7.
4. **The auto-rollout changes nothing that runs on today's live shape (ruling Z).** Every doctor check, `models` included, keeps its class before and after, and `codex` answers one SKIP. The external lane's hourly refresh does exactly what the base tree does: the same probe environment, the same render, the same `ccgpt stop` decision. No `systemctl` verb names a `ccgpt-*` unit, and no runtime is built. Look for any byte of `_fetch_codex` or of the external arm's body that moved, other than Z4's inserted refusal. Pinned by Task 10 (Z7) and Task 11's cut.
5. **Every half state is named, never folded.** `_codex_lanes`' rc 1 and rc 2 are FAIL, not SKIP, and rc equals the worst class. Tier identity is worded only by `_codex_foreign_what`, and a foreign listener survives both doctor and `--fix`. `--fix` acts on FAIL alone and doctor's re-measurement is its verdict. A flip-back converges: the instance is disabled, the lane state left behind is flagged (Task 4's WARN), and a symlinked launcher's backup is still a symlink. Pinned by Tasks 4, 5, 8, 9 and 10.
6. **The two guards Z adds are narrow, and Z4's fails closed.**
   - Z4 refuses the external arm's stop while the roster carries any `codex` row, through the existing `restart-failed` path and before any write. It sits inside the arm's running branch, so it is asked only where the base would run that stop. A roster `_codex_lanes` cannot read (rc 1) or cannot ask (rc 2) never reads as "no codex row" there, unlike `_models_litellm_codex`'s dispatch, where the op's own roster refusal follows.
   - Z3 refuses only the CREATION of a codex registry on a row that is not codex-kind: the live `external` rows, and a non-Anthropic `generated` row, which declares no `authDir` either. A registry that already exists, and every verb that reads or edits it, is untouched, and every other probe kind is still created on any row.
   - After a flip of lane A, a still-external lane B with a registry has its stop refused, and `init codex` on an external lane refuses. Pinned by Tasks 2 and 10.

## What earlier plans already shipped — measured 2026-09-30 on `1f9fa22d`, do NOT redo

| Item | State |
|---|---|
| `exec.kind: "codex"` with `proxyPort`, `litellmPort` and `authDir` (refused under `.ccrc/`, `shared/roster.ts`'s `authDir` gate), in both roster mirrors | **done** (Plan 1) |
| `_acct_credential` refuses a codex lane. `_acct_remove` removes its launcher marker-verified, reaps the lane's generated state, and keeps `authDir` and the logs | **done** (Plan 1; Plan 2b-2 Task 8) |
| `ccd/ccgpt-proxy.py` and `ccd/ccgpt-usage.py` | **done** (Plan 2a) |
| The four GPT-lane executables, `GPT_LANE_BINS` (`ccgpt-proxy.py`, `ccgpt-usage.py`, `ccgpt-runtime`, `ccrc-codex`), placed by `_inst_bins` behind `!= server` (`ccd/ccrc:13561-13567`) and present in both uninstall censuses | **done** (Plans 2b-1, 2b-2) |
| `deploy/systemd/ccgpt-usage@.{service,timer}`. `ExecStart` runs `%h/.ccrc/runtime/codex/current/bin/python -I` with the cost map local. **No installer places it** (`_inst_units`' note at `ccd/ccrc:14223`, `_uninst_units`' at `:21484`) | **done, deliberately unplaced** (D-3172, D-3486). **Task 6 renames and places it** |
| `ccd/ccgpt-runtime` `build`, `check` and `python`. `LITELLM_REQUIREMENT='litellm[proxy]>=1.101.0,<1.110'` at `:102` (D-3487). `_rt_probe_source` at `:591-781` | **done** (Plan 2b-2 Task 3). 3a edits no byte of it |
| The lane library in `ccd/ccrc`:<br>- `_codex_lanes` `:10369`, keyed on `exec.kind`;<br>- `_codex_row` `:10394`;<br>- `_codex_lane_json_state` `:10463`, against the roster row only;<br>- `_codex_tier_ours` `:10827`, codes 0-4;<br>- `_codex_tier_stale` `:10965`, codes 0/1/2;<br>- `_codex_foreign_what` `:11203`;<br>- `_codex_cmd_status` `:11663` | **done** (Plan 2b-2 Tasks 4-5). Tasks 4-5 consume these read-only |
| `ccrc codex start|stop|status|login <id>` (`cmd_codex`, `ccd/ccrc:11821`) | **done** (Plan 2b-2 Tasks 5, 8) |
| A codex-kind lane's own `~/.ccrc/codex/<id>/litellm.yaml`, with an identity-gated stop, write and start (`_models_litellm_codex` `:9728`, `_models_litellm_lane` `:9773`) | **done** (D-3482). The external arm beside it (`:10020-10051`) keeps its bytes on today's shape (Z1). **Task 2** inserts only Z4's refusal ahead of its `ccgpt stop` |
| `_inst_codex_runtime` (`:14288`, which builds only when at least one codex lane exists), `_inst_codex_tiers` (`:14564`) and `_uninst_codex` (`:21616`), each degrading into `INST_DEGRADED` | **done** (Plan 2b-2 Tasks 10-11) |
| `_check_wrappers` expects `ccrc-codex` for a codex lane in all three of its arms. `healthyCodexBox` is at `server/test/ccrc-doctor.test.ts:1208` | **done** (Plan 1; Plan 2b-2 Task 1) |
| `codexLaneFixture.ts`: `freePort`/`freePorts`, `codexRoster`, `codexAuthDir`, `GPT_LANE_BINS`, `plantCodexBins`, `plantFakeRuntime`, `plantSystemd` with its `systemctlCalls`/`systemdRunCalls` recorders, `spawnListener`, `spawnFakeLitellm`, `registerLaneCleanup` and `killLaneProcesses` | **done** (Plan 2b-2 Tasks 4, 5, 10) |
| `install-census.test.ts`'s `FOREIGN_LIVE_BOX_UNIT_PREFIX = 'ccgpt-usage@'` (`:1591`) | **done**. It stays, and it still refuses that prefix after the rename |
| `topology-clean`'s email class, and its fleet-account-label class `ROSTER_RESIDUE` (`:288`, base64) | **done**. The label class does not hold the GPT-lane labels yet. **Task 11 adds each one its own `passes` does not pin** (R10, D-3722) |

Measured **absent** on `1f9fa22d`, and owed here:

| Absent | Task |
|---|---|
| `_check_codex` and `_fix_codex`: 0 hits under `ccd server agent shared deploy`. `CCRC_DOCTOR_CHECKS` (`ccd/ccrc-doctor-checks:166-206`) ends with `models` | 4, 5, 6, 8 |
| The probe's token directory, for a codex-kind row. `ccd/ccrc-models-probe:162` still defaults it to the first live lane's directory. `_models_run_probe` (`ccd/ccrc:9471-9484`) unsets `CHATGPT_TOKEN_DIR` and re-supplies it only from `exec.secretsFile`, which no codex row carries. The interpreter is the `readlink` idiom (`:160-161`), run as `"$venv_py" -` (`:165`) with no `-I` and no cost map. The probe opens `auth.json` for `account_id` (`:170`, D-3161). All of it stays for an external row until its flip (Z1) | 1 |
| `Authenticator().get_access_token()` in the probe (`:171`) and in the publisher (`ccd/ccgpt-usage.py:583`) can start the device flow, and the usage service sets no `TimeoutStartSec`. Owed for the codex-lane arm and the publisher; the external fetch keeps it (Z2) | 1 |
| No writer refuses a codex class registry for a row that is not codex-kind, an `external` row included. The one creator is `deploy/models-op.mjs`' `init` op (`:839-875`), reached only through `ccrc models <id> init` (`ccd/ccrc:9542-9569`). It checks the probe kind and an existing registry, never the row's kind | 2 |
| The external arm of `_models_litellm` runs a bare `ccgpt stop` on its changed-and-running path (`ccd/ccrc:10031`) without asking whether any roster row is `codex`, although that verb stops `ccgpt-<id>-{litellm,shim}.service` by name, the names ccrc's own tiers use (spec §19.2). The hourly refresh reaches it (`:10194-10196`), and `single-definition.test.ts:1798-1816` pins its path to one line, which stays | 2 |
| `effectiveBaseUrl` (`deploy/account-op.mjs:1026-1035`) answers `null` for codex | 3 |
| Seven stale `deploy.sh` line citations in `ccd/ccrc-doctor-checks` (`:274`, `:276`, `:741`, `:1152`, `:2168`, `:3737`, `:3740`; 2b-2 counted six) | 4 |
| `deploy/models-op.mjs`' `materialise` has no check-only mode | 4 |
| Nine `_inst_enable` timer-enable degrades (`ccd/ccrc:14417`, `:14423`, `:14432`, `:14438`, `:14443`, `:14449`, `:14455`, `:14460`, `:14468`). None appends `INST_DEGRADED`, and the closing line is at `:12144-12150` | 6 |
| `_inst_units_darwin` (`ccd/ccrc:14048-14072`) places no timer | 6 (a stated not-applicable) |
| `deploy.sh:674` places `~/.local/bin/ccrc-models-probe`. ccrc runs `$CCRC_HERE/ccrc-models-probe` (`ccd/ccrc:9487`, `:9667`), never the PATH copy | 7 |
| `cmd_wrappers`' `--force` backup is `cp -p` without `-P` (`ccd/ccrc:4121`) | 9 |
| Stale probe-line citations: `ccd/ccrc-doctor-checks:5311` and `:5324`, and `server/test/ccrc-doctor.test.ts:7876`, cite `ccrc-models-probe:397` and `:409`, where the lines are really `:405` (`fetchedAt`) and `:417` (`_mark_stale`) | 1 |

**If a task below appears to ask for something in the first table, stop and report.** It means this table has gone stale, and the controller must re-measure before anything is written.

## File structure

| File | Responsibility | Tasks |
|---|---|---|
| `ccd/ccrc-models-probe` (a codex-lane arm beside `_fetch_codex`, which keeps its bytes), `ccd/ccrc` (`_models_run_probe`, `_models_probe_codex_env`) | a codex lane's own `authDir` and runtime; `no-token-dir`, `runtime-absent`, `not-logged-in`, `runtime-api-moved`, `login-required`; an external row's probe environment and fetch unchanged | 1 |
| `ccd/ccgpt-usage.py`, `deploy/systemd/ccgpt-usage@.service` (before its rename) | the in-process device-flow refusal; `TimeoutStartSec` | 1 |
| `ccd/ccrc-doctor-checks` (`_check_models`' header comment) | the stale probe and `models-op.mjs` citations re-aimed by name; no verdict changes | 1 |
| `ccd/ccrc` (`_models_litellm`'s external arm: one inserted refusal ahead of its `ccgpt stop`, and no other byte of the arm's body; no line of the refresh loop), `deploy/models-op.mjs` (`init`, the one creator of a class registry) | Z4's `restart-failed` refusal while any `codex` row exists; Z3's refusal to create a codex registry on a row that is not codex-kind | 2 |
| `deploy/account-op.mjs` (`effectiveBaseUrl`, `opDoctor`'s comparison) | the codex loopback URL, absent-or-equal | 3 |
| `ccd/ccrc-doctor-checks` (`CCRC_DOCTOR_CHECKS`, `_check_codex`), `deploy/models-op.mjs` (check-only `materialise`) | the static rows; the seven `deploy.sh` citations re-aimed by anchor | 4 |
| `ccd/ccrc-doctor-checks` (`_check_codex`'s tier arm) | tier identity, half-up lanes, stale code, a down gateway under live sessions | 5 |
| `deploy/systemd/ccrc-codex-usage@.{service,timer}` (`git mv`), `ccd/ccrc` (`_inst_units`, `_inst_enable`), `ccd/ccrc-doctor-checks` (usage rows) | the pair placed, the instances converged, every enable degrading honestly, the Darwin not-applicable | 6 |
| `ccd/ccrc` (`_uninst_units`, `_acct_remove`'s codex arm), `deploy/deploy.sh` (the agent arm; the probe line removed) | one census for the pair; the fallback deploy | 7 |
| `ccd/ccrc-doctor-checks` (`_fix_codex`, `_fix_wrappers`), `ccd/ccrc` (the usage text), `ccd/ccgpt-usage.py` (the absent-file remedy) | `--fix` for a codex lane and its launcher | 8 |
| `ccd/ccrc` (`cmd_wrappers`) | a symlink's backup stays a symlink | 9 |
| `server/test/ccrc-install.test.ts` and `server/test/ccrc-update.test.ts` (appended describes: a new file would need a third copy of their module-private harness) | live shape, flip and flip-back, in fixtures | 10 |
| the spec (§20, same-line pointers), this plan (count table, Deviations found), `server/test/topology-clean.test.ts` (`ROSTER_RESIDUE`) | close-out | 11 |
| `server/test/codexLaneFixture.ts` (Tasks 1, 4, 6, 10), `server/test/installTreeFixture.ts` (Task 10) | shared fixtures, extended in place and never duplicated | 1, 4, 6, 10 |
| the test files each task names | the cases | each |

## Task order

```
1 ─► 2
1 ─► 4
1 ─┐
4 ─┴─► 6 ─► 7
4 ─► 5 ─► 6
1, 4, 5, 6 ─► 8
3, 9            (independent)
1 … 9 ─► 10 ─► 11
```

The execution order is 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11: one worker, one branch. The graph says which moves are forbidden, not what may run in parallel.
- **Task 1 comes first.** It is the hard precondition (2b-2 carry-forward 7): no row may flip to `codex` before a probe that reads that lane's own `authDir` has reached both boxes. It changes nothing for an external row (Z1).
- **Task 2 follows Task 1.** Ruling Z removed what coupled them: the refresh-loop skip Task 2 consumed, and the `refresh --all` exit 1 Task 2 caused when it landed alone. Task 2 now adds two refusals to existing code and changes nothing the hourly refresh does, so neither task needs the other to land green. The order stays because both edit `ccd/ccrc`'s models section and `server/test/ccrc-models.test.ts`, and one order keeps the anchors each task re-derives stable.
- **Task 4 follows Task 1.** It edits `ccd/ccrc-doctor-checks` after Task 1's by-name re-aim of that file's `deploy/models-op.mjs` line citations. That file's `.classes.json` count is two at the base and stays two through both tasks.
- **Task 4 precedes Tasks 5, 6 and 8.** `_check_codex` must exist before any usage instance can be enabled (2b-1 carry-forward 12's order). Task 5 extends its tier arm, Task 6 adds its usage rows, and Task 8 fixes the rows Tasks 4-6 print.
- **Task 6 follows Tasks 1 and 5.** It `git mv`s the service file that Task 1 gives `TimeoutStartSec=300`, and keeps that value. It also wires its usage rows into the per-lane loop Task 5 extends.
- **Task 7 follows Task 6.** Uninstall, account removal and the fallback deploy carry the renamed pair. `agent/test/deploy-verify.test.ts` is edited once, in Task 7, which also removes the `deploy.sh` probe line (ruling R5).
- **Task 8 follows Tasks 1, 4, 5 and 6.** It edits `ccd/ccgpt-usage.py` after Task 1, and cures what Tasks 4-6 report.
- **Tasks 3 and 9 are independent.** They touch `deploy/account-op.mjs` and `cmd_wrappers`, which no other task edits.
- **Task 10 follows Tasks 1-9.** It rehearses them all (Z7). On the live shape it pins every doctor check's class before and after, `models` included, and that the external lane's hourly refresh keeps the base's probe environment, render and `ccgpt stop` decision. After a flip of lane A it pins that a still-external lane B with a registry has its stop refused (Z4), and it pins that `init codex` on an external lane refuses (Z3).
- **Task 11 runs last.** It holds the spec §20 amendments, the residue class, the cut, the full gate and the count table. The cut proves `ccd/ccd`, `ccd/ccgpt-runtime` and `ccd/ccgpt-proxy.py` byte-identical to the base, and the external path's bytes kept: `_fetch_codex` whole, and the external arm's body but for Z4's one insertion.

## Where every carried item lands

Every obligation Plans 2b-1 and 2b-2 handed to "Plan 3", mapped to a task here, to Plan 3b or Plan 4, or to NOT-APPLICABLE with its reason.

**Plan 2b-2's carry-forward (items 1-12)**

| Item | What | Placed in | Why there |
|---|---|---|---|
| 2b2-1 | the per-lane cutover sequence | **Plan 3b**, rehearsed in fixtures by **Task 10** | a live act, authorised once per lane (spec §15.3, §16). 3a carries no live act |
| 2b2-2 (code and naming) | place and enable the usage timer per codex lane; take over the template name or use ccrc's own | **Task 6** (`ccrc-codex-usage@`, R2), with **Task 7** for uninstall, account removal and the fallback deploy | taking over the name would overwrite the other repository's live template the moment the merge auto-rolls |
| 2b2-2 (the live half) | retire the other repository's flat timer and its template instance | **Plan 3b** | ccrc never disables a foreign unit (R6). Task 6's converge yields to one, and `_check_codex` names the operator's disable |
| 2b2-3 | the live launcher's settings mirror, and whether `alwaysThinkingEnabled` still matters now that the shim owns effort | **Plan 3b** (ruling R-O4, with the `alwaysThinkingEnabled` question added, R14) | no code: both lanes measured in sync, and the choice is the operator's |
| 2b2-4 | the gateway key in the other repository's unit metadata | **Plan 3b** | it closes when a lane's foreign transient units go. ccrc's own tiers already receive the key only through `EnvironmentFile=` (§19.4's refusal) |
| 2b2-5 | `_check_codex` | **Tasks 4** (static rows), **5** (tier rows), **6** (usage rows) and **8** (`--fix`) | |
| 2b2-6 | `_models_litellm`'s external arm | kept byte for byte on today's shape until each lane's flip (Z1; R-C3 withdrawn, D-3708). **Task 2** inserts Z4's refusal ahead of its stop (`D-3753`). Each lane leaves the arm at its flip in **Plan 3b**, and **Plan 4**'s ccrc PR deletes it (Z8) | spec §19.6 stands as written. What could not wait is the stop: after a flip its unit names are ccrc's own tiers, so once any codex row exists the arm never runs it |
| 2b2-7 | the probe's `authDir`, interpreter and cost map | **Task 1**, for a codex-kind row. An external row keeps today's probe until its flip (Z1) | the hard precondition: no row may flip before it has reached both boxes |
| 2b2-8 | the settings-env drift check compares nothing for a codex lane | **Task 3** (R-C7) | |
| 2b2-9 | `ccrc account auth-start` | **NOT-APPLICABLE** | the verb does not exist (`ACCT_SUBS`, `ccd/ccrc:1535`), and the pane's door already routes a codex lane to `ccrc codex login` (D-3489). There is nothing to route until a design adds the verb |
| 2b2-10 | the timer-enable degrades never reach `INST_DEGRADED` | **Task 6** | there are nine on main, not eight. Task 6 adds one more enable, so they all degrade honestly together |
| 2b2-11 | stale `deploy.sh:<N>` citations in `ccd/ccrc-doctor-checks` (seven measured, not six) | **Task 4**, re-aimed by quoted anchor (D-3725) | same file as `_check_codex`. Task 7 edits `deploy.sh`, so a new line number would go stale inside this plan |
| 2b2-12 | the LiteLLM range width (D-3487) | **Plan 3b** | the ruling stands. Its revisit trigger, a release inside `<1.110` failing the probe, is measured by 3b's first live runtime build, which stops for a ruling if it fires |

**Plan 2b-1's carry-forward (items 12-21, plus 22 for completeness)**

| Item | What | Placed in | Why there |
|---|---|---|---|
| 2b1-12 | the usage timer's cutover order: rename past the foreign template, retire its flat timer, place the pair, and enable per adopted lane once `_check_codex` exists and `ExecStart` resolves the runtime interpreter | **Task 6** (the rename, the placement and the converge, after Task 4's `_check_codex`; `ExecStart` already resolves the runtime, D-3486), and **Plan 3b** (retire the foreign units, then enable ccrc's instance, per lane) | R14 |
| 2b1-13 | rewrite, never delete, the install argv census and the foreign-pair survival fixture | **Task 6** | under the rename the foreign-prefix assertions stay true, and they gain ccrc's pair |
| 2b1-14 | does uninstall sweep the instances? | **Task 7**: yes (R-C9) | spec §13 already says every enabled instance. An instance is a oneshot poller holding no session state, so D-3167's never-touch reasoning for sessions does not carry over |
| 2b1-15 | amend §4.2; a `doctor --fix` `lane.json` arm; the publisher's absent-file remedy | **Task 8** (the arm and the remedy, with the remedy's pin in the same commit) and **Task 11** (§4.2's amendment, in §20) | |
| 2b1-16 | `_check_codex`'s four staleness cases | **Task 4**: roster staleness through `_codex_lane_json_state`, and registry staleness through the check-only `materialise` (R7). Cured by **Task 8**, rehearsed by **Task 10** | |
| 2b1-17a | a per-lane `litellm.yaml` | **NOT-APPLICABLE** | done in 2b-2 (D-3482) |
| 2b1-17b | the probe's `authDir` | **Task 1** | |
| 2b1-17c | a macOS launchd equivalent of the usage timer | **Task 6** (a stated not-applicable with a forced-Darwin test, R2) and **Task 11** (§20 says so) | `_inst_units_darwin` places no timer at all, and macOS is not centrally managed (centralised-update design, decision 17) |
| 2b1-18 | `models-op.mjs`' tmp names without `O_EXCL`, and its write order | **NOT-APPLICABLE** | a pre-existing idiom shared with `writeRegistry`, not GPT-lane work. `lane.json` holds no secret (`runtime.env` already moved to `mktemp`, D-3529). Its consequence, mutually stale files, is Task 4's FAIL and Task 8's cure |
| 2b1-19 | `ccrc-uninstall.test.ts`' hand-written absence list omits the `ccd-usage-sweep` pair | **Task 7** | derived from what the fixture planted, which must cover every `_inst_units` destination (D-3728) |
| 2b1-20 | `deploy-verify.test.ts`' hand-typed landed list | **Task 7** | derived from the agent chain's own `_unit_atomic` operands, plus a template anchor (D-3729) |
| 2b1-21 (the probe half) | `deploy.sh` places `ccrc-models-probe`, which install never does | **Task 7** (R-C11, with the other `deploy-verify` edits, R5). The stale live PATH copy is removed in **Plan 4** | ccrc never runs the PATH copy and nothing refreshes it, so a stale one hands even a codex lane the first lane's directory if an operator runs it by hand. It is no longer the only reader of that default: under ruling Z1 ccrc's own probe keeps it for an external lane until that lane's flip (D-3706) |
| 2b1-21 (the `ccrc-api` half) | `deploy.sh` places `ccrc-api` | **NOT-APPLICABLE** | not GPT-lane work. The skills call `~/.local/bin/ccrc-api` by path, so the line stays |
| 2b1-22 | two stale `deploy.sh` citations in doctor-checks | **Task 4** | the same finding as 2b2-11, re-measured at seven |

**Found by the 2026-09-30 measurement, in neither carry-forward**

| Item | Placed in |
|---|---|
| The device flow can start inside the hourly oneshot. It writes a cooldown marker into `auth.json` and prints a code, and a timeout-based bound leaves the marker behind (critic gap 2) | **Task 1**, for the probe's codex-lane arm and the publisher: refused in-process before any write. The usage service gets `TimeoutStartSec`. The external fetch keeps the base's bytes (Z1, Z2), so its exposure is today's until that lane's flip |
| The probe opens `auth.json` for `account_id` (D-3161) | **Task 1**, on the codex-lane arm, through `Authenticator().get_account_id()`, which Task 1's Step 0b re-measures read-only by grepping the installed source file. If the method is gone, Task 1 stops and reports, and the controller rules (F9). The closure mints no number. The external fetch keeps its read until **Plan 4**'s ccrc PR deletes that path (Z8) |
| `_check_models` would raise a false WARN for a lane the refresh stops refreshing (critic gap 1) | **NOT-APPLICABLE** under ruling Z: no lane stops being refreshed, so `_check_models`' verdicts are unchanged. **Task 10** pins its class before and after (Z7) |
| An `init codex` on an external lane before its flip gives that lane a registry the hourly refresh then probes through the external fetch's default, which is the first lane's OAuth (the wrong-lane hazard R-C2's freeze closed) | **Task 2** (Z3, D-3706): the one creator of a class registry refuses it by name, with the remedy "flip the lane to `codex` first (Plan 3b)". A registry that already exists is untouched. Pinned by **Tasks 2 and 10** |
| A flip back leaves the codex registry a lane carried as a codex lane, because Z3 refuses only a new one, so a flipped-back lane other than the first is probed hourly through the first lane's directory (Task 7, hazard 4) | **Plan 3b**: lane 2's rollback removes the registry its `init codex` created before the roster goes back ([Carry-forward](#carry-forward-to-plan-3b-and-plan-4)). Lane 1's flip back is safe, because the default is its own directory |
| A second usage writer for one lane (critic gap 6) | **Task 6** (R6) |
| `lane.json` stale against the registry (critic gap 11) | **Task 4** (R7), cured by **Task 8** |
| `--fix` regenerating a marker-verified launcher (§12; critic gap 12) | **Task 8** (R8): a new `_fix_wrappers` (D-3730) |
| `cmd_doctor` runs a fixer only on FAIL, while §12 lists enabling a missing timer, which is a WARN row | **Task 8** (R-C8: the FAIL-only contract stays, and the WARN names `ccrc install`) |
| The `--force` backup is `cp -p` without `-P` (`ccd/ccrc:4121`) | **Task 9** |
| Stale probe-line citations | **Task 1** |
| The usage pair on Darwin (critic gap 10) | **Task 6** (R2) |
| The fleet-account-label residue class lacks the two GPT-lane labels, and the second lane's ports, auth-directory name and config names have no class (critic gap 16) | **Task 11** (R10): each label that the class's own `passes` does not pin is added base64 and red-first, read from the box's roster at execution time. A label pinned as a pass stays out (D-3722). The rest, that label included, is a hand-grep whose inputs Task 11 measures read-only on the fleet box at execution time (F1): ids and labels from the box's roster, the second lane's ports from its launcher's two `export` lines only, the auth-directory and config names by `ls` (names only), and session codenames from the `.wrapper` field files (names only). The gitignored reference file is not consulted, and adding its GPT-lane section is Plan 3b Task 1's |
| Suites run on the live fleet box (critic gap 17) | the census in [Global Constraints](#global-constraints), on every step, and **Task 11**'s gate |
| Spec lines 333, 497 and 698 are cited by line number (critic gap 9) | **Task 11** (R9) |
| The other repository's stop verb stops `ccgpt-<id>-{litellm,shim}.service` by name, which are the names ccrc's tiers use (critic gap 7) | **Task 2** for ccrc's own call of it (Z4, `D-3753`): while the roster carries any `codex` row, the external arm refuses rather than run it, pinned by **Task 10**'s flip case. **Plan 3b** for the operator's own hand: never run it for a migrated lane, and roll back with `ccrc codex stop` first |
| Every other finding for Plans 3b and 4: the first runtime build; the second lane's missing registry; parking its sessions; a per-window auto-update pause; `ccrc account disable` during a window; the server box's roster copy; the reference file's missing GPT-lane section; state backups before a refresh; the other repository's deletion and the box cleanup | [Carry-forward to Plan 3b and Plan 4](#carry-forward-to-plan-3b-and-plan-4) |

**Plan 2b-2's recorded hazards** (its carry-forward's "Hazards the drafts recorded")

| Hazard | Placed in |
|---|---|
| `ccd/ccd`'s `_codex_lanes` is keyed on telemetry | **NOT-APPLICABLE**: the two functions never share a shell, spec §16 rules out teaching ccd the kind, and after each flip the two predicates agree for that lane |
| the centralised-update W4 branch's exact `systemd-run` argv prefixes in `ccrc-update.test.ts` | **NOT-APPLICABLE**: W4 is merged, and every harness 3a reaches plants a recorder (Tasks 6-7) |
| An edit to the runtime probe's bytes rebuilds every box | a Global Constraint, proved by **Task 11**'s cut |
| a refusal from `ccrc-codex` is lost when tmux closes the pane | **Plan 3b**: a headless turn before any real spawn, and the `claude-session@<id>` journal as a stop criterion (the carry-forward's steps 3 and 4) |


### Task 1: A codex lane's model probe reads its own OAuth through its own runtime, with no default; every other lane keeps today's probe, byte for byte

> Resolved by operator ruling Z (2026-10-01), which replaces R-C2 and binds over every earlier ruling:
> - **Z1.** An `external` lane keeps today's probe until its own flip in Plan 3b: the token-directory default, the PATH-derived interpreter, the direct `auth.json` read, and the hourly refresh that probes and renders it. Nothing is frozen, nothing is skipped, and `_check_models` is not given a sentence.
> - **Z2.** A codex-kind lane gets the new path: its own `authDir`, its own runtime, no default, the device-flow refusal and `get_account_id()`.
> - **Z3** (no codex registry may be CREATED on an external lane) is **Task 2's**. The one writer that creates a registry is `deploy/models-op.mjs`' `init` op (`grep -n "if (opName === 'init')" deploy/models-op.mjs`; :839 at `1f9fa22d`). Its one caller in the tree is `ccrc models <id> init` (`_models_lane_sub`'s `init)` arm, ccd/ccrc:9564 and :9566). This task edits neither: `deploy/models-op.mjs` is in its NOT-modified list, and every case it adds creates a codex registry only on a codex-kind row.

**Files:**
- Modify: `ccd/ccrc-models-probe`
  - `_fetch_codex` (`grep -n '^_fetch_codex() {' ccd/ccrc-models-probe`; measured :153-196 at `1f9fa22d`) is NOT edited. It stays every external lane's arm, byte for byte (Z1), and Step 17 proves it. It still holds the readlink idiom (:160-161), the lane-one default directory (:162), `"$venv_py" -` with no `-I` and no cost map (:165), and the program's own `auth.json` read for `account_id` (:170, D-3161).
  - New `_fetch_codex_lane`, with its header comment, directly below `_fetch_codex`'s closing `}` and the blank line after it, above `# C13: the compatible arm's only legitimate http:// case.` (`grep -nF` it; :198).
  - `_fetch`'s one Codex line, `    codex) _fetch_codex ;;` (`grep -nxF` it; :235), becomes a dispatch on `CCRC_PROBE_LANE_KIND`, with a comment above it.
- Modify: `ccd/ccgpt-usage.py`
  - The twin guard block goes directly below `from litellm.llms.chatgpt.authenticator import Authenticator  # noqa: E402` (`grep -nF` it; :231).
  - `main()`'s `token = Authenticator().get_access_token()` (`grep -nF` it; :583) is replaced.
- Modify: `deploy/systemd/ccgpt-usage@.service`: one `TimeoutStartSec=300` line directly above `ExecStart=` (`grep -n '^ExecStart=' deploy/systemd/ccgpt-usage@.service`).
- Modify: `ccd/ccrc`
  - `_models_run_probe` (`grep -n '^_models_run_probe() {' ccd/ccrc`; :9471-9484): one added line in each subshell. Its two `unset` lines and its source line are unchanged. One sentence of its header comment (:9439-9440) changes.
  - New `_models_probe_codex_env`, directly below `_models_run_probe`'s closing `}`, above `MODELS_ENDPOINTS_TMP=""` (`grep -n '^MODELS_ENDPOINTS_TMP=""$' ccd/ccrc`).
  - Nothing else. `_models_box_sub`'s `refresh` arm, `_models_refresh_one`, `_models_lane_sub` and every `_models_litellm*` function keep their bytes (Step 17 proves it).
- Modify, comment lines only: `ccd/ccrc-doctor-checks`, in `_check_models`' header comment and its population loop's comment (`grep -n '^_check_models() {' ccd/ccrc-doctor-checks`; :5354-5656). They carry five stale citations:
  - the skeleton's two, `ccd/ccrc-models-probe:397` at :5311 and `:409` at :5324. The real lines are :405 and :417, and this task's insert moves both again;
  - three `deploy/models-op.mjs` citations found while measuring: `:573` at :5301 and :5396, and `:185` at :5406 (`hasRegistry` is now :664, `canCarryRegistry` :199).
  - All five are re-aimed by NAME, so they cannot rot again. Each is a same-line edit, so no line of the file moves. No code line of `_check_models` changes (Z1).
- Modify: `server/test/codexLaneFixture.ts`: an appended block (no `describe`). It holds the stand-in Authenticator, the probe's fake runtime interpreter and their readers.
- Modify: `server/test/models-probe.test.ts`: one new describe, appended.
- Modify: `server/test/ccgpt-usage.test.ts`: `publisherEnv`'s `PYTHONPATH` (`grep -n '^function publisherEnv' server/test/ccgpt-usage.test.ts`), one module-level stub, the header-block case's bearer pin (`grep -nF "toBe('Bearer stub-token-not-a-secret')" server/test/ccgpt-usage.test.ts`; :718), and two new cases.
- Modify: `server/test/ccrc-install.test.ts`: the D-3486 unit case (`grep -n "it('ccgpt-usage@.service runs the isolated runtime" server/test/ccrc-install.test.ts`; :4140).
- Modify: `server/test/ccrc-models.test.ts`:
  - module helpers: `codexRow`, hoisted from the codex-kind describe (:1916-1920), and `codexBox`;
  - one new describe, directly after `describe('ccrc models <id> discovery')`.
  - No existing case changes. The two `CHATGPT_TOKEN_DIR` scrub cases (:1179-1236), and every refresh, litellm and external-arm case, run an external row whose probe arm is byte-identical, so they are green before and after. They are Z1's pins now.
- Modify, one comment: `server/test/ccrc-doctor.test.ts`, `writeModelCatalogue`'s docstring, whose stale probe citation is at :7876, re-aimed by name.
- Modify, CONDITIONAL: `README.md` and `server/test/session-hook.test.ts`, only if Step 15's compaction-card census reds, repaired per S6-R11 in this task's own commit.
- NOT modified, and gated by Step 17: `ccd/ccgpt-runtime`, `ccd/ccd`, `ccd/ccgpt-proxy.py`, `deploy/deploy.sh`, `deploy/models-op.mjs` (Task 2's, Z3), `server/test/single-definition.test.ts` and `server/test/fixtures/pystub/**`.

**Interfaces:**
- Consumes (all shipped on `1f9fa22d`; this task defines none of them again):
  - `_codex_row <id>` (ccd/ccrc:10394).
    - It sets `CX_ID CX_KIND CX_CFG CX_AUTH CX_PROXY CX_LITELLM`, every one EMPTY after a refusal.
    - It answers rc 2 for a malformed id and rc 1 for any other refusal, each with one `ccrc codex: <code>: …` line on stderr, `not-codex` included.
  - `_models_litellm_codex <id>` (ccd/ccrc:9728), which asks `_codex_lanes` (:10369): 0 iff the roster row is `exec.kind: "codex"`. An unreadable roster reads as "not codex". This is the lane library's one reader of that question, and it discards the library's stderr.
  - `_codex_runtime_cli` (ccd/ccrc:10290) and `ccgpt-runtime python` (ccd/ccgpt-runtime:576-581).
    - rc 0 plus the RESOLVED `<gen>/bin/python` on stdout;
    - otherwise rc 1 and one stderr word, `absent` or `mutated`.
    - It never runs the interpreter.
  - `_models_run_probe`'s scrub (ccd/ccrc:9476, :9480). Its two `unset` lines are unchanged, byte for byte.
  - `_models_refresh_one` (ccd/ccrc:9666-9682) and `_models_box_sub`'s `refresh` arm, unchanged. `MODELS_REFRESH_REASON` is the probe's first stderr line. The arm asks models-op's `lanes` op before any probe, and that op's strict reader refuses a roster it cannot parse.
  - The probe's stale path: `_mark_stale` and `cut -c1-300` of the fetch's stderr. Each of this task's refusal lines is written REMEDY FIRST, so the cut never loses the remedy.
  - `codexLaneFixture.ts` exports:
    - `plantCodexBins`;
    - `plantFakeRuntime`, whose `python` option supplies the interpreter body;
    - `authDirOf`, `plantLaneAuth` and `freePorts`;
    - the module-internal `lines` and `shq`;
    - `pythonOrSkip`, from `ccgptHarness.ts`.
  - `ccrc-models.test.ts`' `box`, `ROSTER` (its `router` row, exec.kind `generated` with a secrets file, and `router2`, exec.kind `external` with none), `run`, `sourced`, `oneObject` and `CODEX_RAW`.
  - The installed LiteLLM's `Authenticator`, measured read-only (Why) and re-measured by Step 0b before anything relies on it.
- Produces:
  - **The probe's two Codex arms.** `ccrc-models-probe <id> codex` takes `_fetch_codex_lane` iff `CCRC_PROBE_LANE_KIND` is exactly `codex`, and `_fetch_codex` for every other value, an absent one included.
    - **`_fetch_codex` is today's arm, byte for byte**: the readlink idiom, the token-directory default, `"$venv_py" -`, the program's own `auth.json` read for `account_id` and no guard. It is every external lane's until that lane's flip (Plan 3b), and Plan 4's ccrc half deletes it with the dispatch line (Z8).
    - **`_fetch_codex_lane` is the codex lane's contract.** It reads exactly two inputs, `CHATGPT_TOKEN_DIR` and `CCRC_CODEX_PYTHON`, and has NO default for either.
      - Each refusal is one stderr line, `ccrc-models-probe: <code>: <remedy> — <why>`, and exits 1. They are checked in this order, the first three before any interpreter runs:
        - `no-token-dir`;
        - `runtime-absent`, naming `ccrc install`;
        - `not-logged-in`, naming `ccrc codex login <id>`: existence of `auth.json` only;
        - `runtime-api-moved`, naming `ccrc update`;
        - `login-required`, naming `ccrc codex login <id>`.
      - It runs `"$CCRC_CODEX_PYTHON" -I -` with every `CHATGPT_*`/`LITELLM_*`/`OPENAI_*` variable, `CCRC_CODEX_PYTHON` and `CCRC_PROBE_LANE_KIND` removed, then exports `CHATGPT_TOKEN_DIR`, `LITELLM_LOCAL_MODEL_COST_MAP=True`, `CODEX_CLIENT_VERSION`, `CCRC_PROBE_ACCOUNT` and `CCRC_PROBE_PROG`.
      - `ChatGPT-Account-Id` comes from `Authenticator().get_account_id()`.
  - **The unattended guard**, ONE text in `ccd/ccrc-models-probe` (inside `_fetch_codex_lane`'s program, and nowhere else in that file) and `ccd/ccgpt-usage.py`. It sits between `# ── unattended-authenticator guard (Plan 3a Task 1)` and `# ── end unattended-authenticator guard ──` and defines:
    - `LoginRequired`;
    - `RuntimeApiMoved`;
    - `_unattended(authenticator, required=("get_access_token",))`, which returns a subclass whose `_login_device_code` and `_wait_for_access_token` raise `LoginRequired`.
  - **The publisher's refusals**: `ccgpt-usage: login-required: run ccrc codex login <id> — …` and `ccgpt-usage: runtime-api-moved: run ccrc update — …`. Its request is unchanged: it still sends no `ChatGPT-Account-Id`.
  - **The usage unit.** `deploy/systemd/ccgpt-usage@.service` carries `TimeoutStartSec=300`. Task 6's `git mv` to the ccrc-owned name carries the line, and the install pin moves with it.
  - **`ccd/ccrc`:**
    - `_models_probe_codex_env <id>`.
      - For an exec.kind `codex` row it exports `CHATGPT_TOKEN_DIR=$HOME/<exec.authDir>`, `CCRC_PROBE_LANE_KIND=codex` and `CCRC_CODEX_PYTHON=<ccgpt-runtime python's answer, or empty>`. It returns `_codex_row`'s own rc for a codex row that does not validate.
      - For every other row it unsets `CCRC_CODEX_PYTHON` and `CCRC_PROBE_LANE_KIND`, and nothing else. So that row's `CHATGPT_TOKEN_DIR` is today's: scrubbed, then whatever its secrets file sets.
    - `_models_run_probe <id> <argv…>` calls it inside both subshells, after the scrub and after any secrets file.
    - Nothing else. There is no `external-lane` refusal and no skipped row: `ccrc models refresh` probes, re-materialises and renders an external lane with a codex registry exactly as it did (Z1).
  - **`_check_models`:** no code change, so every doctor row keeps its class on today's live shape. Task 10 pins that (Z7).
  - **single-definition:** unchanged. The `.classes.json` line count in `ccd/ccrc-doctor-checks` stays 2.
  - **`codexLaneFixture.ts` exports:** `AuthStubMode`, `ProbeRuntime`, `ProbeRuntimeCall`, `writeAuthStub(dir, rec)`, `setAuthStubMode(rec, mode)`, `deviceFlowMarks(rec)`, `probeRuntime(home, catalogueFile)`, `probeRuntimeCalls(rec)` and `probeArgv0(rec)`.
  - **`ccrc-models.test.ts` module helpers:** `codexRow(id, proxyPort, litellmPort, extraExec?)` and `codexBox(ids, extra?)`. No external fixture row: this task needs none.
  - **No census script of its own.** Its suites run through the Global Constraints' `$SCRATCH/census-run.sh`, spelled `census <label> <command…>` from the sourced `plan3a-env.sh`.
  - **What this task leaves to Task 7.** `deploy/deploy.sh:674` (placing `~/.local/bin/ccrc-models-probe`, R-C11, 2b1-21's probe half) is NOT touched here. R5 moves that removal into Task 7, the task that also edits `agent/test/deploy-verify.test.ts`, `usage-sweep-deploy-ship.test.ts` and `install-census.test.ts`' note at :58.
  - **What this task leaves to Task 2 (Z3, Z4).** Refusing the CREATION of a codex registry on a row that is not exec.kind `codex`, at models-op's `init` op; and the external LiteLLM arm's refusal of the other repository's stop once any codex row exists (`D-3753`). This task's cases are written so that neither reds them: no case gives a non-codex row a registry, so no case reaches the external LiteLLM arm.

**Why:**
- **The hard precondition (carry-forward 7, 2b1-17b).**
  - The probe defaults `CHATGPT_TOKEN_DIR` to lane one's directory (ccd/ccrc-models-probe:162).
  - Its only caller, `_models_run_probe` (ccd/ccrc:9471-9484), unsets that variable and puts it back only from `exec.secretsFile`.
  - A codex row carries `authDir` and no secrets file, so every codex lane would probe with lane one's OAuth. Spec §9.1: "loses its default outright … a lane that cannot supply one is **refused**".
  - The interpreter was the python beside whichever `litellm` is on PATH (:160-161), run without `-I` or the cost map. For a codex lane it is now the isolated runtime `ccgpt-runtime python` resolves. That closes the probe half D-3484 left open (spec §19.3: "`ccd/ccrc-models-probe`'s import is Plan 3's"), for every lane that runs on that runtime.
- **Two arms, and the external one keeps its bytes (operator ruling Z1, Z2; D-3706).**
  - The operator was asked whether R-C2 (refuse and skip an external lane with a codex registry, freezing its catalogue) was the best way, and chose a merge that changes nothing on the live box. No row there is codex-kind, so the probe that runs there after the merge must be the one that ran before it.
  - So the codex lane's path is a NEW function, and `_fetch_codex` is not edited at all. One line in `_fetch` picks between them. The external program's bytes stay literal, which is Z1, and Plan 4's deletion is one function and one line.
  - The pick is a positive marker, `CCRC_PROBE_LANE_KIND=codex`, exported only by `_models_probe_codex_env`. It is not "`CCRC_CODEX_PYTHON` is set": an empty interpreter must still take the codex path, where it refuses `runtime-absent`. Set-but-empty against unset would be an overloaded null at a seam.
  - No stray marker reaches a probe for a non-codex row: `_models_probe_codex_env` unsets it for every other row AFTER the secrets file. On a codex row, an ambient or secrets-file marker is overwritten by the row's own.
  - Z2 lets the device-flow guard cover the external arm too, but only if the probe were ONE program whose external branch is the codex branch's code. It is two programs. So the external program carries no guard, and the merge has no failure-path difference on it either. What that leaves is hazard 3.
- **The caller supplies the codex inputs, from the row, through the lane library's readers.**
  - `_models_probe_codex_env` asks `_models_litellm_codex`, the one exec.kind reader, then `_codex_row`, the one row reader, and exports `$HOME/$CX_AUTH`.
  - It runs AFTER the scrub and after any secrets file. So neither an ambient value nor a lane's secrets file can hand a codex lane another directory or another interpreter.
  - `CCRC_CODEX_PYTHON` is exported EMPTY when no runtime resolves. An inherited value can never stand in for the runtime.
  - For every other row it unsets the marker and the interpreter and leaves `CHATGPT_TOKEN_DIR` alone. So the two `unset` lines and the source line keep doing exactly what they did, and the two pre-existing scrub cases still pin that (mutation row 24).
  - An unreadable roster reads as "not codex" here, as everywhere `_models_litellm_codex` is asked. That cannot send a codex row to the default directory: `refresh` asks models-op's `lanes` op first, and that op's strict reader refuses such a roster before any probe runs.
- **What the merge does on today's live shape** (stated by shape; Z1).
  - The live fleet box has two external rows with codex telemetry. Exactly one carries a class registry, and no row is codex-kind. No Codex runtime is built there.
  - After the auto-rollout, that lane's hourly refresh runs the same probe arm in the same environment as before. `_models_probe_codex_env` answers "not codex" and unsets two names that nothing on that box sets. Its catalogue, its re-materialise, its LiteLLM render and its stop decision are what they were. Task 2 keeps the external LiteLLM arm's bytes on this shape (Z4).
  - `ccgpt-usage.py` and `ccgpt-usage@.service` change bytes but run nowhere there. The unit is placed by no installer (D-3172), and the other repository's timer runs its own publisher.
  - `_check_models` is not edited, so the `models` row keeps its class, and so does every other row. Task 10 pins both (Z7).
- **The device flow is prevented in-process (critic #2, R3), on the codex lane's path.**
  - Measured 2026-09-30 read-only, by `grep` and `sed` of a LiteLLM installed on the fleet box outside ccrc, inside D-3487's `>=1.101.0,<1.110`. The ccrc runtime is not built there, and no Authenticator was run. Step 0b re-measures the names below the same way before Step 1.
  - In `litellm/llms/chatgpt/authenticator.py`, `get_access_token` (:55-76) falls through a usable token and a refresh to two steps:
    - `_wait_for_access_token(cooldown)` (:374-386), which polls up to `DEVICE_CODE_COOLDOWN_SECONDS` = 300 s;
    - `_login_device_code` (:153-173). Its `_record_device_code_request` (:370-372) WRITES `device_code_requested_at` into the lane's `auth.json`. It then prints the code to stdout (the probe's `$RAW`) and polls for up to `DEVICE_CODE_TIMEOUT_SECONDS` = 15 min.
  - A deadline cannot undo that write. A poll killed part-way leaves the marker, and the lane's own tier then waits out the cooldown on live requests.
  - So both names are overridden to raise `LoginRequired` before either can write, in the codex lane's probe program and in the publisher.
  - A runtime whose Authenticator lacks either name is refused `runtime-api-moved`: overriding a name the library no longer calls would guard nothing. The runtime's own behaviour probe checks only `get_access_token` (ccd/ccgpt-runtime:676-678), and it is frozen (below). So this fail-closed check is the only one.
  - The usage service also gets `TimeoutStartSec=300` (a oneshot has no start timeout by default). The in-process refusal covers the device flow, and the bound covers everything else a wedged refresh could hold. 300 s is `ccrc-models.service`'s own bound, and it is well under the timer's 15 min interval.
  - `ccrc codex login` is untouched. It IS the device flow, run by a person.
- **D-3161 closes on the codex lane's path (critic #21, R3).**
  - `Authenticator.get_account_id` exists in the measured source (authenticator.py:78-90). LiteLLM's own chatgpt transformations call it for the same header (`llms/chatgpt/chat/transformation.py:58`, `llms/chatgpt/responses/transformation.py:59`). So a codex lane's probe request now matches its tier's, and no ccrc code opens a codex lane's `auth.json` (spec §9, line 497). Step 0b re-measures the method, read-only, before Step 4 relies on it. If it is gone, the task stops there and the controller rules; nothing in this task writes a fallback.
  - One measured behavioural difference: when `auth.json` has no `account_id`, `get_account_id` derives it from the token's claims and writes it back (:88-89). That is a LIBRARY write, the same class as its `expires_at` write inside `_is_token_expired`. The probe then sends the header where it used to send none, which the lane's own tier already does.
  - `_fetch_codex` keeps its own `auth.json` read for an external lane (Z1). It goes with that arm in Plan 4's ccrc half (Z8). Task 11 records D-3161 closed on the codex path and retired with the external arm, under its own number. Neither mints a new one.
- **The hazard: "any edit to the probe's bytes rebuilds every box". Which probe, and what it costs here.** Two files are called "the probe".
  - **The one whose bytes rebuild boxes is NOT this task's file.** It is `ccd/ccgpt-runtime`'s behaviour probe, the `_rt_probe_source` heredoc (:592-780).
    - Its bytes are hashed (`_RT_SHA_PY`, :113, compared at :401 against the stamp's `probeSha256`). A mismatch answers `probe-moved` (:402), `check` fails, and `_inst_codex_runtime` rebuilds (ccd/ccrc:14288-14320).
    - That happens on every box whose roster has at least one codex lane, at its next install or update. Main auto-releases and both boxes follow dev, so that is within minutes of a merge.
    - A rebuild is about 650 MB per generation, network pip bounded by `CCRC_RUNTIME_PIP_S` (1200 s) plus the probe's `CCRC_RUNTIME_PROBE_S` (300 s), and about 2 GB at the swap peak (Plan 2b-2's measurement; an example).
    - **Cost today: zero.** No box has a codex lane, so even an edit there would rebuild nothing on this merge.
    - **Cost after 3b's first flip:** every such edit is an unattended rebuild inside an auto-update on the live fleet box.
    - That is why this task does NOT teach `_rt_probe_source` the three Authenticator names the guard now needs, though the runtime's own probe would be their natural gate. The model probe's own `runtime-api-moved` refusal is the substitute. Step 17 gates `ccd/ccgpt-runtime` byte-identical to the base.
  - **`ccd/ccrc-models-probe` is hashed by nothing.** `grep -n ccrc-models-probe ccd/ccgpt-runtime` finds only the comment at :87. Its edit costs one re-placed tree file per box: no rebuild and no tier restart.
  - The same holds for `ccd/ccgpt-usage.py`. `_codex_tier_stale` measures the runtime generation and the shim's bytes, never the publisher's.
- **The test fallout is small, by design.**
  - No existing case changes. The tree's ccrc-models fixture runs `init codex` and `refresh` on an external row for its refresh mechanics, and that row's probe arm is byte-identical, so every such case is green before and after. Together with the two `CHATGPT_TOKEN_DIR` scrub cases, they are Z1's pins now.
  - The new cases run codex-kind lanes only (`codex-a`, `codex-b`), plus the tree's `router` and `router2` rows for the "every other row" half, which `_models_run_probe` reaches with no registry at all.
  - So Task 2's Z3 guard, which refuses `init codex` on a non-codex row, reds none of this task's cases. The pre-existing cases that create a codex registry on an external row are Task 2's to re-seed.
- **No added line names a live lane id (R13).** Codex lanes are `codex-a` and `codex-b`. The probe's two Z1 cases pass the probe the fixture id `ext-a`, and read the default directory off the arm's own text rather than spelling it.

**Deviations (the controller minted the numbers):**
- D-3706, as redefined by operator ruling Z6: the departure Z1 and Z3 make from spec §9.1's "loses its default outright". The default stays for an external lane's probe until that lane's flip, through a separate arm the probe takes for every caller but a codex lane. And a codex registry cannot be created on an external lane (Z3, Task 2). Spec §19.6 ("`external` lanes keep today's box-global path … until Plan 3's cutover retires that arm") stands as written.
- D-3707: the probe and the publisher override two private LiteLLM names (`_login_device_code`, `_wait_for_access_token`) and refuse `login-required`/`runtime-api-moved`, which couples ccrc to private names inside D-3487's range. The usage unit also gains `TimeoutStartSec=300`. None of §9, §10 or §19.3 names either refusal.

- [ ] **Step 0: record the base, check the R11 census, re-run the locators (read-only).**

```bash
. "<abs scratch>/plan3a-env.sh" && cd "$(git rev-parse --show-toplevel)"
mkdir -p "$SCRATCH/t1"
git rev-parse HEAD > "$SCRATCH/t1/base"; cat "$SCRATCH/t1/base"
# The census is the Global Constraints' one script, never a copy.
test -x "$CENSUS" && type census >/dev/null && echo census-ok
```

  - Then run the Global Constraints' census-controls block once, before this task's first suite, as ONE call, exactly as spelled there: its three controls share the block's `$C` and its stand-in `systemctl`, which a second call would not have. Expected: the process control exits 126, the unit control 125, and the `true` control 0 with `census: clean …`. Any other answer stops the task.
  - Shell state does not survive between Bash calls. So every later block in this task begins with the same source line and reads the base back from `$SCRATCH/t1/base`. No block relies on a variable an earlier call set.
  - `census <name> <command…>` is the Global Constraints' shorthand for `"$CENSUS" "$EVID/t1-<name>" <command…>`, defined in `plan3a-env.sh`.
    - Each `census …` line in this task, inline or in a block, is ONE foreground Bash call of its own, with timeout ≥ 600000, spelled `. "<abs scratch>/plan3a-env.sh" && cd "$(git rev-parse --show-toplevel)/server" && census …`. Never two suites in one call.
    - The census verdict and the command's own exit are separate. A 125 or 126 stops the task. The command's exit is vitest's: 1 is expected at the red runs (Steps 3, 7 and 11, the twin case at Step 5, and Step 16's mutated runs) and stops the task anywhere else.
    - The process census counts THIS shell's temp root. A concurrent session sharing that root can produce a false 126. Attribute every hit by the Global Constraints' rule, and re-run in isolation before reporting one.
  - Fixture ids must never equal a rostered id: `jq -r '.accounts[].id' "$HOME/.ccrc/accounts.json" | grep -xE 'codex-a|codex-b|ext-a|ext-b|gen-a'` prints nothing. The tree's pre-existing `ccrc-models.test.ts` ROSTER rows are not this plan's fixture ids and are not checked here. Of them, this task's new cases name only `router` and `router2`, the tree's non-live rows. `ext-a` is only ever an argument to the probe, never a roster row, in this task.
  - Record the baselines, one call per line (examples measured at `1f9fa22d`: 46, 34, 148 and 24 passed):

```bash
. "<abs scratch>/plan3a-env.sh" && cd "$(git rev-parse --show-toplevel)/server" && census s0-probe ./node_modules/.bin/vitest run test/models-probe.test.ts
. "<abs scratch>/plan3a-env.sh" && cd "$(git rev-parse --show-toplevel)/server" && census s0-usage ./node_modules/.bin/vitest run test/ccgpt-usage.test.ts
. "<abs scratch>/plan3a-env.sh" && cd "$(git rev-parse --show-toplevel)/server" && census s0-models ./node_modules/.bin/vitest run test/ccrc-models.test.ts
. "<abs scratch>/plan3a-env.sh" && cd "$(git rev-parse --show-toplevel)/server" && census s0-doctor-models ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'ccrc doctor: models'
```

  - Re-run every `grep` locator in **Files** and stop on any that finds nothing or finds two. Every line number in this task was measured at `1f9fa22d` and is an example to re-derive.

- [ ] **Step 0b: re-measure, read-only, that the installed LiteLLM's `Authenticator` still has every name this task relies on.**

  Step 4's account-id read and the unattended guard depend on four names in `litellm/llms/chatgpt/authenticator.py`. They were measured while drafting (Why). Measure them again now by grepping SOURCE TEXT only: nothing here imports litellm, and no Authenticator runs.

```bash
. "<abs scratch>/plan3a-env.sh"
# Every LiteLLM installed for this user: the ccrc Codex runtime's generations
# (`ccd/ccgpt-runtime`'s RT; none is built on today's fleet box) and any venv up
# to two levels under $HOME. A source is reported by ordinal, never by path.
shopt -s nullglob dotglob
n=0
for f in "$HOME"/.ccrc/runtime/codex/*/lib/python3*/site-packages/litellm/llms/chatgpt/authenticator.py \
         "$HOME"/*/lib/python3*/site-packages/litellm/llms/chatgpt/authenticator.py \
         "$HOME"/*/*/lib/python3*/site-packages/litellm/llms/chatgpt/authenticator.py; do
  n=$((n + 1))
  for name in get_access_token get_account_id _login_device_code _wait_for_access_token; do
    echo "source #$n: $name defs=$(grep -cE "^[[:space:]]+def ${name}\(" "$f")"
  done
done
echo "litellm sources: $n"
```

  - Expected (measured 2026-10-01 on the fleet box): `litellm sources:` at least 1, and `defs=1` on every line.
  - **`get_account_id` at `defs=0` in any source, or no source at all: stop here, before Step 1, and report it.** The controller rules. Step 4's `get_account_id` lines, mutation row 8 and the D-3161 closure are written only once this answer holds.
  - `_login_device_code` or `_wait_for_access_token` at `defs=0` stops the task the same way. The guard overrides both, so a runtime without them would refuse every lane `runtime-api-moved`.
  - Any count above 1 is reported too: a second definition is a shape this task did not read.
  - This step mints nothing. D-3161 is closed under its own number (Task 11).

- [ ] **Step 1: the fixture — a stand-in Authenticator and the probe's fake runtime interpreter.**

  Append to `server/test/codexLaneFixture.ts`. It uses the module's existing `fs`, `path`, `mkdirSync`, `writeFileSync`, `lines`, `shq` and `pythonOrSkip`, and imports nothing new.

```ts
// ════════════════════════════════════════════════════════════════════════
// Plan 3a Task 1 — the MODEL PROBE's runtime interpreter, and a stand-in
// Authenticator.
//
// `ccd/ccrc-models-probe`'s codex arm runs `<runtime python> -I -` with its
// program on stdin, importing `litellm.llms.chatgpt.authenticator`. The
// interpreter below is what a fake generation carries for it: plant it with
// `plantFakeRuntime(home, { python })`, or hand its path to the probe as
// CCRC_CODEX_PYTHON.
//   - Any argv but exactly `-I -` exits 90, so a probe that dropped `-I` reds.
//   - It runs THIS box's python3 on the program with the stand-in on
//     sys.path. `-I` ignores PYTHONPATH, so a wrapper program inserts it.
//   - An audit hook denies every socket connect and name lookup.
//   - The probe's one `urllib.request.urlopen` is answered from a recorded
//     catalogue file.
//   - Per run it records one JSON line: the CHATGPT_/LITELLM_/OPENAI_
//     environment plus CODEX_CLIENT_VERSION, every request's url and headers,
//     and every open() of a file named auth.json.
//
// The stand-in (`writeAuthStub`) follows litellm 1.101.0's get_access_token,
// read from that version's source: a usable token, a refresh, the cooldown
// wait (`_wait_for_access_token`), then the device flow (`_login_device_code`,
// which WRITES device_code_requested_at into auth.json before it prints a code
// and polls). Each device-side step here records a mark in `<rec>/device-flow`,
// makes that same auth.json write, and returns AT ONCE, so a guard that fails
// reds on the mark instead of hanging a suite. Its mode is `<rec>/mode`,
// default `token`, read at import.
// ════════════════════════════════════════════════════════════════════════

export type AuthStubMode = 'token' | 'no-account-id' | 'device' | 'cooldown' | 'renamed';

export interface ProbeRuntimeCall {
  env: Record<string, string>;
  requests: { url: string; headers: Record<string, string> }[];
  authOpens: string[];
}

export interface ProbeRuntime {
  /** The interpreter BODY: `plantFakeRuntime`'s `python` option, or a file to hand the probe. */
  python: string;
  /** Where each run is recorded, and where the stand-in reads its mode. */
  rec: string;
  /** The stand-in `litellm` package root. */
  stub: string;
}

const authStubSource = (rec: string): string => [
  '# A stand-in for litellm.llms.chatgpt.authenticator (codexLaneFixture.ts,',
  '# Plan 3a Task 1). NOT litellm: it models the one control flow the',
  '# unattended guard exists for, and nothing else.',
  'import json, os, time',
  `_REC = ${JSON.stringify(rec)}`,
  'try:',
  '    with open(os.path.join(_REC, "mode")) as _f:',
  '        MODE = _f.read().strip() or "token"',
  'except OSError:',
  '    MODE = "token"',
  'TOKEN = "test-token-not-a-secret"',
  '',
  '',
  'class Authenticator:',
  '    def __init__(self):',
  '        self.token_dir = os.getenv("CHATGPT_TOKEN_DIR", os.path.expanduser("~/.config/litellm/chatgpt"))',
  '        self.auth_file = os.path.join(self.token_dir, os.getenv("CHATGPT_AUTH_FILE", "auth.json"))',
  '',
  '    def get_access_token(self):',
  '        # litellm 1.101.0 order: a usable token, a refresh, the cooldown wait, the device flow.',
  '        if MODE in ("token", "no-account-id"):',
  '            return TOKEN',
  '        if MODE == "cooldown":',
  '            token = self._wait_for_access_token(300.0)',
  '            if token:',
  '                return token',
  '        login = self._login_device_code_v2 if MODE == "renamed" else self._login_device_code',
  '        return login()["access_token"]',
  '',
  '    def get_account_id(self):',
  '        if MODE == "no-account-id":',
  '            return None',
  '        return "acct-" + os.path.basename(self.token_dir)',
  '',
  '    def _login_device_code(self):',
  '        self._device_step("device-code")',
  '        print("Sign in with ChatGPT using device code:\\n2) Enter code: WXYZ-4321", flush=True)',
  '        return {"access_token": "device-token-not-a-secret"}',
  '',
  '    def _wait_for_access_token(self, timeout_seconds):',
  '        self._device_step("cooldown-wait")',
  '        return None',
  '',
  '    def _device_step(self, what):',
  '        with open(os.path.join(_REC, "device-flow"), "a") as f:',
  '            f.write(what + "\\n")',
  '        with open(self.auth_file, "w") as f:',
  '            json.dump({"device_code_requested_at": time.time()}, f)',
  '',
  '',
  'if MODE == "renamed":',
  '    # A litellm whose device flow moved to another name: a guard that only',
  '    # overrides the old name guards nothing.',
  '    Authenticator._login_device_code_v2 = Authenticator._login_device_code',
  '    del Authenticator._login_device_code',
].join('\n') + '\n';

/** The stand-in package under `dir`, reading its mode from `<rec>/mode`. */
export function writeAuthStub(dir: string, rec: string): void {
  const pkg = path.join(dir, 'litellm', 'llms', 'chatgpt');
  mkdirSync(pkg, { recursive: true });
  mkdirSync(rec, { recursive: true });
  writeFileSync(path.join(dir, 'litellm', '__init__.py'), '# codexLaneFixture.ts stand-in (Plan 3a Task 1): NOT litellm\n');
  writeFileSync(path.join(dir, 'litellm', 'llms', '__init__.py'), '');
  writeFileSync(path.join(pkg, '__init__.py'), '');
  writeFileSync(path.join(pkg, 'authenticator.py'), authStubSource(rec));
}

export function setAuthStubMode(rec: string, mode: AuthStubMode): void {
  writeFileSync(path.join(rec, 'mode'), `${mode}\n`);
}

/** Each device-side step the stand-in took, in order. Empty is the guard holding. */
export const deviceFlowMarks = (rec: string): string[] => lines(path.join(rec, 'device-flow'));
/** The `$0` of every run of the probe-runtime interpreter. Empty: it never ran. */
export const probeArgv0 = (rec: string): string[] => lines(path.join(rec, 'argv0'));
export const probeRuntimeCalls = (rec: string): ProbeRuntimeCall[] =>
  lines(path.join(rec, 'calls.jsonl')).map((l) => JSON.parse(l) as ProbeRuntimeCall);

const PROBE_RUNTIME_WRAPPER = [
  'import atexit, json, os, sys, urllib.request',
  'sys.dont_write_bytecode = True',
  'stub, rec, answer = sys.argv[1], sys.argv[2], sys.argv[3]',
  'sys.argv = ["-"]',
  'sys.path.insert(0, stub)',
  'call = {"env": {k: v for k, v in os.environ.items()',
  '                if k.startswith(("CHATGPT_", "LITELLM_", "OPENAI_")) or k == "CODEX_CLIENT_VERSION"},',
  '        "requests": [], "authOpens": []}',
  'recording = [True]',
  '',
  '',
  'def _audit(event, args):',
  '    if not recording[0]:',
  '        return',
  '    if event in ("socket.connect", "socket.getaddrinfo"):',
  '        raise PermissionError("fixture probe runtime: no network under test")',
  '    if event == "open" and args and isinstance(args[0], str) and os.path.basename(args[0]) == "auth.json":',
  '        call["authOpens"].append(args[0])',
  '',
  '',
  'sys.addaudithook(_audit)',
  '',
  '',
  'def _dump():',
  '    recording[0] = False',
  '    with open(os.path.join(rec, "calls.jsonl"), "a") as f:',
  '        f.write(json.dumps(call) + "\\n")',
  '',
  '',
  'atexit.register(_dump)',
  '',
  '',
  'class _Answer:',
  '    def __init__(self, data):',
  '        self._data = data',
  '',
  '    def read(self):',
  '        return self._data',
  '',
  '',
  'def _urlopen(req, timeout=None):',
  '    call["requests"].append({"url": req.full_url,',
  '                             "headers": {k.lower(): v for k, v in req.header_items()}})',
  '    recording[0] = False',
  '    try:',
  '        with open(answer, "rb") as f:',
  '            return _Answer(f.read())',
  '    finally:',
  '        recording[0] = True',
  '',
  '',
  'urllib.request.urlopen = _urlopen',
  'exec(compile(sys.stdin.read(), "<stdin>", "exec"), {"__name__": "__main__"})',
].join('\n');

/** The model probe's fake runtime interpreter, recording under `<home>/probe-rec`,
 *  its stand-in Authenticator under `<home>/probe-stub`, answering the one
 *  catalogue request from `catalogueFile`. Throws on a box with no python3:
 *  guard the describe with `pythonOrSkip()`. */
export function probeRuntime(home: string, catalogueFile: string): ProbeRuntime {
  const py = pythonOrSkip();
  if (py === null) throw new Error('probeRuntime: no python3 on this box — guard the case with pythonOrSkip()');
  if (!fs.existsSync(catalogueFile)) throw new Error(`probeRuntime: ${catalogueFile} does not exist`);
  const rec = path.join(home, 'probe-rec');
  const stub = path.join(home, 'probe-stub');
  writeAuthStub(stub, rec);
  const python = [
    '#!/bin/sh',
    "# The model probe's fake runtime interpreter (codexLaneFixture.ts, Plan 3a Task 1). NOT a runtime.",
    'if [ "$#" -ne 2 ] || [ "$1" != -I ] || [ "$2" != - ]; then',
    '  echo "fixture probe runtime: unexpected argv: $*" >&2',
    '  exit 90',
    'fi',
    `printf '%s\\n' "$0" >> ${shq(path.join(rec, 'argv0'))}`,
    `exec ${shq(py)} -I -c ${shq(PROBE_RUNTIME_WRAPPER)} ${shq(stub)} ${shq(rec)} ${shq(catalogueFile)}`,
  ].join('\n') + '\n';
  return { python, rec, stub };
}
```

- [ ] **Step 2: write the failing probe tests.**

  In `server/test/models-probe.test.ts`, add to the imports:
  - `import { pythonOrSkip } from './ccgptHarness.js';`
  - `import { deviceFlowMarks, probeArgv0, probeRuntime, probeRuntimeCalls, setAuthStubMode, type ProbeRuntime } from './codexLaneFixture.js';`

  Then append this describe:

```ts
// ── Plan 3a Task 1: a codex lane's Codex arm reads only what its caller hands it
// `ccrc`'s `_models_run_probe` exports CCRC_PROBE_LANE_KIND=codex,
// CHATGPT_TOKEN_DIR (the row's own exec.authDir) and CCRC_CODEX_PYTHON (the
// interpreter `ccgpt-runtime python` resolved) for an exec.kind "codex" row,
// and neither the marker nor the interpreter for any other row. These cases
// hand the probe those values directly, so what they pin is the PROBE's own
// contract:
//   - on the marker, no default for either input;
//   - three refusals before any interpreter runs;
//   - the interpreter run isolated and scrubbed;
//   - an Authenticator that may refresh a token and may never start a device
//     sign-in;
//   - and WITHOUT the marker, today's arm, byte for byte (operator ruling Z1,
//     D-3706): the last two cases.
// CONTAINMENT FIRST: every case plants a poisoned `litellm` and a poisoned
// `python` beside it on the fixture PATH. An old or mutated probe that goes
// looking for a PATH LiteLLM runs a recorder — never the runner's own LiteLLM,
// whose real Authenticator would start a real device sign-in against a
// fixture HOME.
describe.skipIf(pythonOrSkip() === null)('the Codex arm: a codex lane gets no default token directory, its own runtime and never a device sign-in; every other caller keeps today\'s arm (Plan 3a Task 1)', () => {
  let pr: ProbeRuntime;
  let py: string;
  const authDir = (): string => path.join(home, '.local', 'share', 'ccrc', 'codex', 'codex-a');
  const authBytes = (): string => fs.readFileSync(path.join(authDir(), 'auth.json'), 'utf8');
  const poisonRan = (): boolean => fs.existsSync(path.join(home, 'python-poison'));

  beforeEach(() => {
    const bin = path.join(home, '.local', 'bin');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'litellm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'python'),
      '#!/bin/sh\nprintf \'%s %s|%s\\n\' "$0" "$*" "${CHATGPT_TOKEN_DIR:-}" >> "$HOME/python-poison"\nexit 1\n', { mode: 0o755 });
    pr = probeRuntime(home, CODEX_RAW);
    py = path.join(home, 'probe-runtime-python');
    fs.writeFileSync(py, pr.python, { mode: 0o755 });
    fs.mkdirSync(authDir(), { recursive: true });
    fs.writeFileSync(path.join(authDir(), 'auth.json'), '{}');
  });

  const codex = (extra: NodeJS.ProcessEnv = {}): Result =>
    run(['codex-a', 'codex'], { CCRC_PROBE_LANE_KIND: 'codex', CHATGPT_TOKEN_DIR: authDir(), CCRC_CODEX_PYTHON: py, ...extra });

  it('handed no CHATGPT_TOKEN_DIR it refuses no-token-dir — there is no default directory — and no interpreter runs', () => {
    const r = codex({ CHATGPT_TOKEN_DIR: '' });
    expect(r.code).toBe(1);
    // A boolean, not `toMatch`: the pre-Plan-3a probe answers from its old default
    // directory, a real lane's path, so a failing `toMatch` would print it.
    expect(/no-token-dir: run it through 'ccrc models refresh codex-a' — this codex-lane fetch/.test(r.stderr),
      'the no-token-dir refusal').toBe(true);
    expect(probeArgv0(pr.rec), 'an interpreter ran with no token directory').toEqual([]);
    expect(poisonRan()).toBe(false);
    expect(fs.existsSync(path.join(home, '.ccrc', 'models', 'codex-a.json'))).toBe(false);
    expect(curlCalls()).toEqual([]);
  });

  it('handed no interpreter it refuses runtime-absent, naming ccrc install — and never falls back to the python beside a litellm on PATH', () => {
    for (const handed of ['', path.join(home, 'no-such-python')]) {
      const r = codex({ CCRC_CODEX_PYTHON: handed });
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/runtime-absent: run ccrc install \(it builds the Codex runtime\), then ccrc models refresh codex-a/);
    }
    expect(poisonRan(), 'the PATH litellm\'s python ran').toBe(false);
    expect(probeArgv0(pr.rec)).toEqual([]);
  });

  it('with no auth.json in the handed directory it refuses not-logged-in, naming ccrc codex login — existence only, before any interpreter runs', () => {
    fs.rmSync(path.join(authDir(), 'auth.json'));
    const r = codex();
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/not-logged-in: run ccrc codex login codex-a/);
    expect(probeArgv0(pr.rec)).toEqual([]);
  });

  it('runs the handed interpreter as `-I -`, every ambient CHATGPT_/LITELLM_/OPENAI_ variable gone, the cost map local, reading the handed directory', () => {
    const r = codex({
      CHATGPT_AUTH_FILE: path.join(home, 'ambient', 'elsewhere.json'),
      OPENAI_API_KEY: 'ambient-not-a-secret',
      LITELLM_LOG: 'DEBUG',
    });
    expect(r.code, r.stderr).toBe(0);
    expect(probeArgv0(pr.rec)).toEqual([py]);
    const calls = probeRuntimeCalls(pr.rec);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.env).toEqual({
      CHATGPT_TOKEN_DIR: authDir(),
      LITELLM_LOCAL_MODEL_COST_MAP: 'True',
      CODEX_CLIENT_VERSION: expect.stringMatching(/^\d+\.\d+\.\d+$/),
    });
    expect((catalogueAt('codex-a') as { models: unknown[] }).models).toHaveLength(9);
    expect(poisonRan()).toBe(false);
    expect(curlCalls()).toEqual([]);
  });

  it('sends ChatGPT-Account-Id from Authenticator().get_account_id(), and its own program never opens auth.json (D-3161 closed)', () => {
    expect(codex().code).toBe(0);
    const [call] = probeRuntimeCalls(pr.rec);
    expect(call!.requests).toHaveLength(1);
    expect(call!.requests[0]!.url).toMatch(/^https:\/\/chatgpt\.com\/backend-api\/codex\/models\?client_version=/);
    expect(call!.requests[0]!.headers['authorization']).toBe('Bearer test-token-not-a-secret');
    expect(call!.requests[0]!.headers['chatgpt-account-id']).toBe('acct-codex-a');
    expect(call!.authOpens, 'the probe program opened auth.json itself').toEqual([]);
  });

  it('an Authenticator that knows no account id sends no ChatGPT-Account-Id at all', () => {
    setAuthStubMode(pr.rec, 'no-account-id');
    expect(codex().code).toBe(0);
    expect(probeRuntimeCalls(pr.rec)[0]!.requests[0]!.headers).not.toHaveProperty('chatgpt-account-id');
  });

  it('a token the runtime can neither use nor refresh is login-required AT ONCE: the device flow never starts, and auth.json is never written', () => {
    setAuthStubMode(pr.rec, 'device');
    const before = authBytes();
    const r = codex();
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/login-required: run ccrc codex login codex-a/);
    expect(deviceFlowMarks(pr.rec), 'the device flow started').toEqual([]);
    expect(authBytes(), 'auth.json was written').toBe(before);
    // No `Enter code` check here: the program's stdout is the probe's $RAW, never
    // the caller's. The marks and auth.json's bytes are what bind.
    expect(probeRuntimeCalls(pr.rec)[0]!.requests).toEqual([]);
  });

  it('another sign-in\'s cooldown is login-required too: the probe never waits on it', () => {
    setAuthStubMode(pr.rec, 'cooldown');
    const before = authBytes();
    const r = codex();
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/login-required: run ccrc codex login codex-a/);
    expect(deviceFlowMarks(pr.rec)).toEqual([]);
    expect(authBytes()).toBe(before);
  });

  it('a runtime whose Authenticator lacks a name the guard overrides is refused runtime-api-moved, before any token is asked', () => {
    setAuthStubMode(pr.rec, 'renamed');
    const before = authBytes();
    const r = codex();
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/runtime-api-moved: run ccrc update — this runtime's Authenticator has no _login_device_code/);
    expect(deviceFlowMarks(pr.rec)).toEqual([]);
    expect(authBytes()).toBe(before);
  });

  it('the unattended guard is ONE text, in the probe and in the usage publisher', () => {
    const START = '# ── unattended-authenticator guard (Plan 3a Task 1)';
    const END = '# ── end unattended-authenticator guard ──';
    const block = (file: string): string => {
      const src = fs.readFileSync(file, 'utf8');
      const a = src.indexOf(START);
      expect(a, `${file} carries the guard`).toBeGreaterThan(-1);
      expect(src.indexOf(START, a + 1), `${file} carries it once`).toBe(-1);
      const b = src.indexOf(END, a);
      expect(b, `${file} closes it`).toBeGreaterThan(a);
      return src.slice(a, b + END.length);
    };
    expect(block(PROBE)).toBe(block(path.join(REPO, 'ccd', 'ccgpt-usage.py')));
  });

  it('the codex-lane arm spells no default token directory and no PATH-derived interpreter', () => {
    const body = extractFn('_fetch_codex_lane');
    // Booleans, never `not.toMatch(body)`: a failure prints its subject.
    expect(/CHATGPT_TOKEN_DIR:-[^}]/.test(body), 'a default token directory').toBe(false);
    expect(body.includes('command -v litellm'), 'a PATH-derived interpreter').toBe(false);
    expect(body.includes('readlink'), 'readlink').toBe(false);
  });

  // Z1 (operator ruling Z, D-3706): every caller that is not a codex lane
  // keeps today's arm, byte for byte, until that lane's own flip. Both cases
  // are GREEN before this task and after it. They bind through mutation rows
  // 15-17, never through a red-first run.
  it('without the codex-lane marker the arm is today\'s: the python beside the PATH litellm, run as `-`, on the directory it was handed; a handed CCRC_CODEX_PYTHON never runs', () => {
    const pathPython = path.join(fs.realpathSync(path.join(home, '.local', 'bin')), 'python');
    for (const marker of ['', 'external']) {
      fs.rmSync(path.join(home, 'python-poison'), { force: true });
      const r = run(['ext-a', 'codex'], { CCRC_PROBE_LANE_KIND: marker, CHATGPT_TOKEN_DIR: authDir(), CCRC_CODEX_PYTHON: py });
      expect(r.code, `marker "${marker}"`).toBe(1);   // the PATH python is a recorder that exits 1
      expect(fs.readFileSync(path.join(home, 'python-poison'), 'utf8'), `marker "${marker}"`)
        .toBe(`${pathPython} -|${authDir()}\n`);
    }
    expect(probeArgv0(pr.rec), 'the handed runtime interpreter ran').toEqual([]);
    expect(curlCalls()).toEqual([]);
  });

  it('without the codex-lane marker and handed no directory, the arm still falls back to its own default, and nothing runs where that holds no auth.json', () => {
    // The default is read off the arm's own text and never spelled here: it
    // is a real lane's directory (ruling R13).
    const m = /\$\{CHATGPT_TOKEN_DIR:-\$HOME\/([^}]+)\}/.exec(extractFn('_fetch_codex'));
    expect(m !== null, '_fetch_codex keeps a default token directory').toBe(true);
    const r = run(['ext-a', 'codex'], { CHATGPT_TOKEN_DIR: '', CCRC_CODEX_PYTHON: py });
    expect(r.code).toBe(1);
    // A boolean: a failing `toContain` would print the default directory.
    expect(r.stderr.includes(`not logged in (${home}/${m![1]})`), 'today\'s sentence, on the default directory').toBe(true);
    expect(poisonRan(), 'an interpreter ran with no auth.json').toBe(false);
    expect(probeArgv0(pr.rec)).toEqual([]);
  });
});
```

- [ ] **Step 3: run them red.**

  `census s3-probe ./node_modules/.bin/vitest run test/models-probe.test.ts`. Expected: 11 new FAIL, and 48 green: the 46 existing (count re-derived at Step 0) and the two Z1 cases. Those two pin today's arm, so they are green before this task by design, and mutation rows 15-17 are what bind them. Measured on a scratch copy at `4ec8926a` (the code of `1f9fa22d`): `Tests 11 failed | 48 passed (59)`. The reason each new case fails today:
  - the first case: the probe ignores the marker and takes today's arm, which uses its default directory, holding no `auth.json`, and says `not logged in`, never `no-token-dir`. The assertion is a boolean, so that directory's path is never printed;
  - runtime-absent: today's arm ignores `CCRC_CODEX_PYTHON`, resolves the poisoned `python` beside the planted `litellm`, and `python-poison` exists. That poison is the containment working;
  - not-logged-in: today's sentence has no `not-logged-in:` code;
  - `-I -`, D-3161, no-account-id, device, cooldown and renamed: the fixture interpreter never runs, and the poisoned PATH python runs instead;
  - the twin: neither file carries the markers;
  - the literal-absence case: `_fetch_codex_lane` does not exist yet, so `extractFn` throws.

- [ ] **Step 4: implement the probe.**

  `_fetch_codex` is not touched (Z1). Two edits:

  1. In `_fetch`, the one line `    codex) _fetch_codex ;;` (`grep -nxF '    codex) _fetch_codex ;;' ccd/ccrc-models-probe` finds exactly one) becomes:

```bash
    # Plan 3a Task 1 (D-3706): ONE marker picks the Codex arm, and only
    # `ccrc`'s `_models_run_probe` sets it, for an exec.kind "codex" roster
    # row. Every other caller gets `_fetch_codex`, byte for byte as it was.
    codex) if [ "${CCRC_PROBE_LANE_KIND:-}" = codex ]; then _fetch_codex_lane; else _fetch_codex; fi ;;
```

  2. Directly below `_fetch_codex`'s closing `}` and the blank line after it, above `# C13: the compatible arm's only legitimate http:// case.`, add this, then one blank line:

```bash
# THE CODEX LANE'S FETCH (spec §9.1; Plan 3a Task 1, D-3706). `_fetch`
# takes this arm only when `ccrc`'s `_models_run_probe` marked the call
# CCRC_PROBE_LANE_KIND=codex, which it does for an exec.kind "codex" roster
# row and for no other. `_fetch_codex` above is every other caller's arm,
# byte for byte as it was, default directory and all, until that lane's own
# flip (Plan 3b); Plan 4 deletes it.
# This arm is handed two values and reads nothing else:
#   CHATGPT_TOKEN_DIR  the row's own exec.authDir, under $HOME;
#   CCRC_CODEX_PYTHON  the interpreter `ccgpt-runtime python` resolved (the
#                      isolated runtime), empty when none resolves.
# It has NO default for either. A codex row carries an authDir and no
# secrets file, so a default here would have probed every codex lane with
# one other lane's OAuth, through a LiteLLM nobody built for it.
#
# Each missing input is its own one-line refusal, checked before any
# interpreter runs, and `auth.json` is tested for EXISTENCE only (spec §9).
# Every refusal names its remedy FIRST, because the stale path below keeps
# only the first 300 characters of this arm's stderr.
_fetch_codex_lane() {
  local token_dir="${CHATGPT_TOKEN_DIR:-}" py="${CCRC_CODEX_PYTHON:-}"
  if [ -z "$token_dir" ]; then
    echo "$PROG: no-token-dir: run it through 'ccrc models refresh $ACCOUNT' — this codex-lane fetch was handed no CHATGPT_TOKEN_DIR, and it has no default: a codex lane's OAuth directory is its roster row's exec.authDir (spec §9.1)" >&2
    return 1
  fi
  if [ -z "$py" ] || [ ! -x "$py" ]; then
    echo "$PROG: runtime-absent: run ccrc install (it builds the Codex runtime), then ccrc models refresh $ACCOUNT — this fetch was handed no runnable runtime interpreter (${py:-none}), so nothing imported litellm" >&2
    return 1
  fi
  if [ ! -f "$token_dir/auth.json" ]; then
    echo "$PROG: not-logged-in: run ccrc codex login $ACCOUNT — its authDir ($token_dir) holds no auth.json; existence is all this probe checks, and it never reads one" >&2
    return 1
  fi
  # How the interpreter runs:
  #   - under -I: no PYTHONPATH, PYTHONHOME or user site ahead of the
  #     runtime's litellm;
  #   - with the cost map local (D-3484): without it `import litellm`
  #     fetches a mutable remote JSON, with three retries;
  #   - with every CHATGPT_*/LITELLM_*/OPENAI_* variable the caller carried
  #     removed first. This is `ccrc codex login`'s own scrub, for its own
  #     reason: the authenticator os.path.join()s CHATGPT_AUTH_FILE onto the
  #     token dir, so an ambient absolute value would move the credential it
  #     reads.
  # The unattended guard inside covers THIS program only. `_fetch_codex`
  # keeps its own program, unguarded, as it was (Z1).
  (
    for v in ${!CHATGPT_@} ${!LITELLM_@} ${!OPENAI_@}; do unset "$v"; done
    unset CCRC_CODEX_PYTHON CCRC_PROBE_LANE_KIND
    export CHATGPT_TOKEN_DIR="$token_dir" LITELLM_LOCAL_MODEL_COST_MAP=True \
      CODEX_CLIENT_VERSION="$CODEX_CLIENT_VERSION" CCRC_PROBE_ACCOUNT="$ACCOUNT" CCRC_PROBE_PROG="$PROG"
    exec "$py" -I -
  ) > "$RAW" <<'PY'
import os, sys, urllib.request
from litellm.llms.chatgpt.authenticator import Authenticator

PROG = os.environ["CCRC_PROBE_PROG"]
ACCOUNT = os.environ["CCRC_PROBE_ACCOUNT"]


# ── unattended-authenticator guard (Plan 3a Task 1): one text, in ccd/ccrc-models-probe and ccd/ccgpt-usage.py ──
# A caller nobody watches must never start LiteLLM's device sign-in. What
# litellm 1.101.0 does (the floor of the runtime's requirement, read from its
# source): get_access_token falls through a usable token and a refresh to two
# steps:
#   - _wait_for_access_token, which polls up to 300 s on another sign-in's
#     cooldown;
#   - _login_device_code, which WRITES device_code_requested_at into the
#     lane's auth.json, prints a code nobody reads, and polls up to 15 minutes.
# A deadline cannot undo that write. A poll killed part-way leaves the marker,
# and the lane's own LiteLLM tier then waits out the cooldown on live requests.
# So both are refused here, in-process, before either can write. A runtime
# whose Authenticator lacks a name this guard overrides, or one its caller
# needs, is refused too: overriding a name the library no longer calls guards
# nothing.
class LoginRequired(Exception):
    """The lane holds no token LiteLLM can use or refresh: only a person can sign it in."""


class RuntimeApiMoved(Exception):
    """This runtime's Authenticator lacks a name the guard depends on."""


def _unattended(authenticator, required=("get_access_token",)):
    missing = [name for name in (*required, "_login_device_code", "_wait_for_access_token")
               if not callable(getattr(authenticator, name, None))]
    if missing:
        raise RuntimeApiMoved(", ".join(missing))

    class Unattended(authenticator):
        def _login_device_code(self, *args, **kwargs):
            raise LoginRequired("device-code")

        def _wait_for_access_token(self, *args, **kwargs):
            raise LoginRequired("device-code-cooldown")

    return Unattended
# ── end unattended-authenticator guard ──


def refuse(code, sentence):
    sys.stderr.write(f"{PROG}: {code}: {sentence}\n")
    raise SystemExit(1)


# `get_access_token()` REFRESHES an expired token. That is the whole reason
# this arm goes through LiteLLM rather than reading auth.json, and the guard
# above makes sure it never goes further than a refresh.
# ChatGPT-Account-Id comes from `get_account_id()`, the call LiteLLM's own
# chatgpt transformations make for the same header, so this program never
# opens auth.json itself (spec §9: existence and mode only). That closes
# D-3161 for a codex lane; `_fetch_codex` keeps its read until Plan 4.
try:
    auth = _unattended(Authenticator, ("get_access_token", "get_account_id"))()
    token = auth.get_access_token()
    account_id = auth.get_account_id()
except RuntimeApiMoved as missing:
    refuse("runtime-api-moved",
           f"run ccrc update — this runtime's Authenticator has no {missing}, so the fetch for "
           f"\"{ACCOUNT}\" cannot run without risking an interactive sign-in; nothing was sent. If this "
           "build is current, the runtime's litellm range admits an Authenticator this probe does not know: report it")
except LoginRequired:
    refuse("login-required",
           f"run ccrc codex login {ACCOUNT} — \"{ACCOUNT}\" holds no token the Codex runtime can use or "
           "refresh, and this unattended probe never starts a device sign-in (that would write auth.json "
           "and wait up to 15 minutes)")

# The Authorization/originator/user-agent/session_id headers match
# ccd/ccgpt-usage.py's own request (task-10-fix-rulings.md C-2): what the
# backend expects from a real Codex CLI caller. The publisher sends no
# ChatGPT-Account-Id; this arm sends the one LiteLLM's own tier sends.
headers = {
    "Authorization": f"Bearer {token}",
    "originator": "codex_cli_rs",
    "user-agent": "codex_cli_rs/0.0.0 (Unknown 0; unknown) unknown",
    "session_id": "00000000-0000-0000-0000-000000000000",
}
if account_id:
    headers["ChatGPT-Account-Id"] = account_id
url = ("https://chatgpt.com/backend-api/codex/models?client_version="
       + os.environ["CODEX_CLIENT_VERSION"])
req = urllib.request.Request(url, headers=headers)
sys.stdout.write(urllib.request.urlopen(req, timeout=30).read().decode("utf-8"))
PY
}
```

- [ ] **Step 5: run the probe suite green.**

  `census s5-probe ./node_modules/.bin/vitest run test/models-probe.test.ts`. Expected: every case green but the twin, which stays red until Step 8 puts the guard in `ccgpt-usage.py`: 58 passed and 1 failed (Step 0's count plus 13; an example). Record the twin as expected-red here.

- [ ] **Step 6: write the failing publisher tests, and the unit pin.**

  In `server/test/ccgpt-usage.test.ts`:

  1. Add `import { deviceFlowMarks, setAuthStubMode, writeAuthStub } from './codexLaneFixture.js';`.
  2. Directly above `function publisherEnv(`, add:

```ts
/** The stand-in Authenticator every publisher case imports (Plan 3a Task 1).
 *  `pystub`'s one-method class answers a token and nothing else, and it stays
 *  that minimal (`ccgpt-harness.test.ts` pins it). The publisher's unattended
 *  guard refuses a runtime whose Authenticator lacks the two device-flow names
 *  it overrides, so every case that reaches `get_access_token` imports this
 *  one instead. It is written once, in token mode, and never shared with a
 *  case that changes its mode. */
const AUTH_STUB = ((): string => { const d = mkTmp('ccgpt-usage-authstub-'); writeAuthStub(d, d); return d; })();
```

  3. In `publisherEnv`, `PYTHONPATH: PYSTUB_DIR,` becomes `PYTHONPATH: AUTH_STUB,`. The two cases that set `PYSTUB_DIR` directly keep it: the unset-id case refuses before the import, and the task-11 case only imports.
  4. **The header-block case's bearer pin.** `publisherEnv` now imports the stand-in, whose token is `test-token-not-a-secret`, not `pystub`'s. In the case titled `task-10 fix round 1 (C-2/C-3): sends the Codex-CLI header block and the lane's own probeModel` (`grep -nF "toBe('Bearer stub-token-not-a-secret')" server/test/ccgpt-usage.test.ts` finds its one line; :718 at `1f9fa22d`), `expect(captured.headers['authorization']).toBe('Bearer stub-token-not-a-secret');` becomes `expect(captured.headers['authorization']).toBe('Bearer test-token-not-a-secret'); // Plan 3a Task 1: publisherEnv imports the AUTH_STUB stand-in`. It is the only publisher case that pins the token. `grep -rn stub-token-not-a-secret server/test` also names `pystub` itself and the harness and runtime suites' own copies, which stay.
  5. Append inside `describe.skipIf(!PY)('ccgpt-usage.py', …)`:

```ts
  // Plan 3a Task 1 (critic #2): the publisher is an unattended oneshot. Its
  // Authenticator may refresh a token and must never start a device sign-in.
  // In litellm 1.101.0 that sign-in WRITES device_code_requested_at into
  // auth.json before it prints a code and polls for 15 minutes, and no
  // deadline can undo the write. The stand-in's device path records a mark
  // and makes that same write, so a guard that fails reds on the mark.
  it('Plan 3a Task 1: a token the runtime can neither use nor refresh is login-required at once — no device flow, no auth.json write, nothing published', async () => {
    const home = mkTmp('ccgpt-usage-device-');
    const id = mintId();
    plantLane(home, id);
    const stub = join(home, 'auth-stub');
    writeAuthStub(stub, stub);
    setAuthStubMode(stub, 'device');
    const auth = join(home, '.local', 'share', 'ccrc', 'codex', id, 'auth.json');
    const before = readFileSync(auth, 'utf8');
    const { url, close, requests } = await startEndpoint(fullHeaders());
    try {
      const r = await runPyAsync(ccgptFile('ccgpt-usage.py'), { home, env: publisherEnv(id, url, { PYTHONPATH: stub }) });
      expect(r.timedOut).toBe(false);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain(`ccgpt-usage: login-required: run ccrc codex login ${id} —`);
      expect(deviceFlowMarks(stub), 'the device flow started').toEqual([]);
      expect(readFileSync(auth, 'utf8'), 'auth.json was written').toBe(before);
      expect(r.stdout + r.stderr).not.toMatch(/Enter code/);
      expect(existsSync(limitsPath(home, id))).toBe(false);
      expect(requests.length).toBe(0);
    } finally {
      await close();
    }
  });

  it('Plan 3a Task 1: a runtime whose Authenticator lacks a device-flow name the guard overrides is refused runtime-api-moved, before any token is asked', async () => {
    const home = mkTmp('ccgpt-usage-apimoved-');
    const id = mintId();
    plantLane(home, id);
    const stub = join(home, 'auth-stub');
    writeAuthStub(stub, stub);
    setAuthStubMode(stub, 'renamed');
    const { url, close, requests } = await startEndpoint(fullHeaders());
    try {
      const r = await runPyAsync(ccgptFile('ccgpt-usage.py'), { home, env: publisherEnv(id, url, { PYTHONPATH: stub }) });
      expect(r.timedOut).toBe(false);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/ccgpt-usage: runtime-api-moved: run ccrc update — this runtime's Authenticator has no _login_device_code/);
      expect(deviceFlowMarks(stub)).toEqual([]);
      expect(existsSync(limitsPath(home, id))).toBe(false);
      expect(requests.length).toBe(0);
    } finally {
      await close();
    }
  });
```

  In `server/test/ccrc-install.test.ts`, inside the D-3486 case, directly after its `expect(code).toContain('Environment=CCGPT_ACCOUNT_ID=%i');`:

```ts
    // Plan 3a Task 1: a oneshot has NO start timeout by default. The
    // publisher refuses a device sign-in in-process; this bounds everything
    // else a wedged refresh could hold. Task 6's rename carries the line.
    expect(code.filter((l) => l.startsWith('TimeoutStartSec=')), 'the usage poll must be bounded')
      .toEqual(['TimeoutStartSec=300']);
```

- [ ] **Step 7: run them red.**
  - `census s7-usage ./node_modules/.bin/vitest run test/ccgpt-usage.test.ts`. Expected: the two new cases FAIL. The device case's mark is `['device-code']` and its request count is 1. The renamed case has no refusal. The 34 existing cases stay GREEN on the generated stub. In token mode it answers a token as `pystub` does, but its own token, which is why item 4 re-aims the header-block case's bearer pin.
  - `census s7-install ./node_modules/.bin/vitest run test/ccrc-install.test.ts -t "runs the isolated runtime"`. Expected: FAIL on `the usage poll must be bounded`.

- [ ] **Step 8: implement the publisher and the unit.**

  In `ccd/ccgpt-usage.py`, directly below `from litellm.llms.chatgpt.authenticator import Authenticator  # noqa: E402`, add two blank lines and then the guard block. It runs from `# ── unattended-authenticator guard (Plan 3a Task 1): …` to `# ── end unattended-authenticator guard ──` inclusive, byte-identical to Step 4's heredoc copy (the twin case pins it). Replace:

```python
    # Authenticator refreshes the access token if it has expired. Stubbed in
    # every test in this wave (server/test/fixtures/pystub, Task 1) to
    # return a fixed non-secret string — this file never sees, stores or
    # logs a real credential either way.
    token = Authenticator().get_access_token()
```

  with:

```python
    # Authenticator refreshes the access token if it has expired, and it
    # never starts a device sign-in here: the unattended guard above refuses
    # one before it can write auth.json (Plan 3a Task 1). Stubbed in every
    # test (codexLaneFixture.ts's writeAuthStub) with a fixed non-secret
    # string. This file never sees, stores or logs a real credential.
    try:
        token = _unattended(Authenticator)().get_access_token()
    except RuntimeApiMoved as missing:
        sys.exit(f"ccgpt-usage: runtime-api-moved: run ccrc update — this runtime's Authenticator has no "
                 f"{missing}, so this poll cannot run without risking an interactive sign-in; nothing was published")
    except LoginRequired:
        sys.exit(f"ccgpt-usage: login-required: run ccrc codex login {ACCOUNT_ID} — lane {ACCOUNT_ID} holds no "
                 "token the Codex runtime can use or refresh, and this unattended poll never starts a device "
                 "sign-in; nothing was published")
```

  In `deploy/systemd/ccgpt-usage@.service`, directly above `ExecStart=`:

```ini
# Plan 3a Task 1: a oneshot has no start timeout by default, so a wedged
# token refresh held the poll forever. The publisher refuses a device sign-in
# in-process (its unattended guard); this bounds the rest. 300 s is
# ccrc-models.service's own bound, well under this timer's 15 min interval.
TimeoutStartSec=300
```

- [ ] **Step 9: run green.**

  Run each in the foreground, one at a time:
  - `census s9-usage ./node_modules/.bin/vitest run test/ccgpt-usage.test.ts`: all green (36; an example).
  - `census s9-install ./node_modules/.bin/vitest run test/ccrc-install.test.ts -t "runs the isolated runtime"`: green.
  - `census s9-probe ./node_modules/.bin/vitest run test/models-probe.test.ts`: all green, the twin case included (59 measured on a scratch copy; an example).
  - `census s9-harness ./node_modules/.bin/vitest run test/ccgpt-harness.test.ts`: green and unchanged. `pystub` stays one class with one method.

- [ ] **Step 10: write the failing caller tests.**

  In `server/test/ccrc-models.test.ts`:

  1. **Imports.** Add `import { pythonOrSkip } from './ccgptHarness.js';`. Widen the one `from './codexLaneFixture.js'` import in place (`grep -n "from './codexLaneFixture.js'"` finds exactly one) with `authDirOf, freePorts, plantLaneAuth, probeArgv0, probeRuntime, probeRuntimeCalls`.

  2. **Module helpers**, directly below `function boxWithStubOp(`'s closing `}`. `codexRow` MOVES here from the codex-kind litellm describe (`grep -n "const codexRow = " server/test/ccrc-models.test.ts` finds the one definition). Delete it there and change nothing else in that describe.

```ts
/** One `exec.kind: "codex"` roster row, its authDir the fixture's. Hoisted out of
 *  the codex-kind litellm describe by Plan 3a Task 1; that describe still uses it.
 *  `extraExec` adds exec fields (`secretsFile`, which a codex row may carry). */
const codexRow = (id: string, proxyPort: number, litellmPort: number,
  extraExec: Record<string, unknown> = {}): Record<string, unknown> => ({
  id, label: id, configDirSuffix: `.claude-${id}`,
  exec: { kind: 'codex', provider: 'openai', proxyPort, litellmPort, authDir: `.local/share/ccrc/codex/${id}`, ...extraExec },
  homeAble: false, telemetry: 'codex',
});

/** Plan 3a Task 1: `box()` with one codex row per id appended, each on two DISTINCT
 *  kernel-chosen ports (never a constant: the real lane library probes them), then
 *  `extra`. It replaces the box the file-level `beforeEach` made. */
async function codexBox(ids: readonly string[], extra: readonly Record<string, unknown>[] = []): Promise<string> {
  const ports = await freePorts(ids.length * 2);
  fs.rmSync(home, { recursive: true, force: true });
  return box({ ...ROSTER, accounts: [...ROSTER.accounts,
    ...ids.map((id, i) => codexRow(id, ports[2 * i]!, ports[2 * i + 1]!)), ...extra] });
}
```

  3. **The new describe**, directly after `describe('ccrc models <id> discovery')`'s closing `});`. The two `CHATGPT_TOKEN_DIR` scrub cases inside that describe stay where they are, byte for byte: they refresh an external row whose probe arm is unchanged, and they are the Z1 pins of the "every other row" half.

```ts
// ── Plan 3a Task 1 (spec §9.1, D-3706): each codex lane's probe reads its OWN
// OAuth through its OWN runtime. `_models_run_probe` exports the inputs and the
// codex-lane marker for an exec.kind "codex" row, after the scrub and after
// any secrets file. Every other row keeps today's probe environment exactly
// (operator ruling Z1): the two CHATGPT_TOKEN_DIR scrub cases in the describe
// above still hold it, unchanged. CONTAINMENT FIRST: every case poisons a PATH
// `litellm` and the `python` beside it, so no old or mutated probe can reach
// the runner's own LiteLLM.
describe.skipIf(pythonOrSkip() === null)('each codex lane\'s probe reads its OWN authDir through its OWN runtime, with no default; every other row keeps today\'s probe environment (Plan 3a Task 1)', () => {
  const poisonedDir = (): string => join(home, 'someone-elses-token-dir');
  const poisonRan = (): boolean => fs.existsSync(join(home, 'python-poison'));
  const poisonPathLitellm = (): string => {
    const bin = join(home, '.local', 'bin');
    fs.writeFileSync(join(bin, 'litellm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const p = join(bin, 'python');
    fs.writeFileSync(p, '#!/bin/sh\nprintf \'%s\\n\' "$0" >> "$HOME/python-poison"\nexit 1\n', { mode: 0o755 });
    return p;
  };
  const rowsOf = (r: Result): Record<string, unknown>[] => oneObject(r)['refreshed'] as Record<string, unknown>[];

  it('two codex lanes: each probe is handed its own authDir and the resolved runtime — never the other lane\'s, an ambient one, or a secrets file\'s', async () => {
    const [pa, la, pb, lb] = await freePorts(4);
    fs.rmSync(home, { recursive: true, force: true });
    home = box({ ...ROSTER, accounts: [...ROSTER.accounts,
      codexRow('codex-a', pa!, la!), codexRow('codex-b', pb!, lb!, { secretsFile: '.secrets/codex-b.env' })] });
    const poison = poisonPathLitellm();
    fs.mkdirSync(poisonedDir(), { recursive: true });
    fs.writeFileSync(join(poisonedDir(), 'auth.json'), JSON.stringify({ account_id: 'leaked-account-id' }));
    // codex-b's secrets file (legal on a codex row) tries to hand its probe
    // another directory and another interpreter. The codex inputs are exported
    // AFTER it is sourced, so neither may win.
    fs.mkdirSync(join(home, '.secrets'), { recursive: true });
    fs.writeFileSync(join(home, '.secrets', 'codex-b.env'),
      `export CHATGPT_TOKEN_DIR=${poisonedDir()}\nexport CCRC_CODEX_PYTHON=${poison}\n`);
    plantCodexBins(home);
    const pr = probeRuntime(home, CODEX_RAW);
    const rt = plantFakeRuntime(home, { python: pr.python });
    for (const id of ['codex-a', 'codex-b']) {
      plantLaneAuth(home, id);
      expect(run(['models', id, 'init', 'codex']).code).toBe(0);
    }
    const r = run(['models', 'refresh', '--all'], { CHATGPT_TOKEN_DIR: poisonedDir(), CCRC_CODEX_PYTHON: poison });
    expect(rowsOf(r).map((x) => [x['id'], x['ok']])).toEqual([['codex-a', true], ['codex-b', true]]);
    expect(r.code, 'refresh --all').toBe(0);
    const calls = probeRuntimeCalls(pr.rec);
    expect(calls.map((c) => c.env['CHATGPT_TOKEN_DIR']).sort())
      .toEqual([authDirOf(home, 'codex-a'), authDirOf(home, 'codex-b')]);
    expect(calls.map((c) => c.requests[0]?.headers['chatgpt-account-id']).sort())
      .toEqual(['acct-codex-a', 'acct-codex-b']);
    expect(probeArgv0(pr.rec)).toEqual([rt.python, rt.python]);
    for (const id of ['codex-a', 'codex-b']) {
      const cat = JSON.parse(fs.readFileSync(join(home, '.ccrc', 'models', `${id}.json`), 'utf8')) as { models: unknown[] };
      expect(cat.models, id).toHaveLength(9);
    }
    expect(poisonRan(), 'an interpreter the runtime did not resolve ran').toBe(false);
    expect(r.stdout + r.stderr).not.toContain(poisonedDir());
    expect(r.stdout + r.stderr).not.toContain('leaked-account-id');
  });

  it('a codex lane with no runtime refuses runtime-absent, naming ccrc install — an ambient interpreter and the PATH litellm never run', async () => {
    home = await codexBox(['codex-a']);
    const poison = poisonPathLitellm();
    plantCodexBins(home);                      // ccgpt-runtime is placed; no generation is built
    plantLaneAuth(home, 'codex-a');
    expect(run(['models', 'codex-a', 'init', 'codex']).code).toBe(0);
    const r = run(['models', 'refresh', 'codex-a'], { CCRC_CODEX_PYTHON: poison });
    expect(r.code).toBe(1);
    const [row] = rowsOf(r);
    expect(row).toMatchObject({ id: 'codex-a', probe: 'codex', ok: false });
    // Booleans: before this task the reason names the probe's default
    // directory, a real lane's path, which a failing `toMatch` would print.
    expect(/runtime-absent: run ccrc install/.test(String(row!['reason'])), 'the runtime-absent refusal').toBe(true);
    expect(poisonRan(), 'an inherited interpreter ran').toBe(false);
  });

  it('a codex lane whose authDir holds no auth.json is not-logged-in, naming ccrc codex login, and no interpreter runs', async () => {
    home = await codexBox(['codex-a']);
    poisonPathLitellm();
    plantCodexBins(home);
    const pr = probeRuntime(home, CODEX_RAW);
    plantFakeRuntime(home, { python: pr.python });
    expect(run(['models', 'codex-a', 'init', 'codex']).code).toBe(0);
    const r = run(['models', 'refresh', 'codex-a']);
    expect(r.code).toBe(1);
    expect(/not-logged-in: run ccrc codex login codex-a/.test(String(rowsOf(r)[0]!['reason'])), 'the not-logged-in refusal').toBe(true);
    expect(probeArgv0(pr.rec)).toEqual([]);
    expect(poisonRan()).toBe(false);
  });

  it('_models_run_probe hands a codex row its own authDir, runtime and marker; every other row gets neither marker nor runtime, and today\'s CHATGPT_TOKEN_DIR', async () => {
    home = await codexBox(['codex-a']);
    plantCodexBins(home);
    const rt = plantFakeRuntime(home);
    fs.mkdirSync(join(home, '.secrets'), { recursive: true });
    fs.writeFileSync(join(home, '.secrets', 'router.env'), 'export ANTHROPIC_AUTH_TOKEN=lane-token\n'
      + `export CHATGPT_TOKEN_DIR=${join(home, 'from-a-secrets-file')}\nexport CCRC_CODEX_PYTHON=${join(home, 'from-a-secrets-file-py')}\n`
      + 'export CCRC_PROBE_LANE_KIND=codex\n');
    // The ambient marker is a value no row would get, so a codex row's own
    // export is what the first expectation reads, never an inherited one.
    const ambient = { CHATGPT_TOKEN_DIR: join(home, 'ambient-dir'), CCRC_CODEX_PYTHON: join(home, 'ambient-py'), CCRC_PROBE_LANE_KIND: 'ambient' };
    const seen = (id: string): Record<string, string> => {
      const r = sourced(`_models_run_probe ${id} env`, [], ambient);
      expect(r.code, r.stderr).toBe(0);
      return Object.fromEntries(r.stdout.split('\n')
        .filter((l) => /^(CHATGPT_TOKEN_DIR|CCRC_CODEX_PYTHON|CCRC_PROBE_LANE_KIND)=/.test(l))
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
    };
    expect(seen('codex-a')).toEqual({
      CHATGPT_TOKEN_DIR: authDirOf(home, 'codex-a'), CCRC_CODEX_PYTHON: rt.python, CCRC_PROBE_LANE_KIND: 'codex' });
    // Z1: what the probe got before this task, and nothing more. The scrub
    // keeps an ambient CHATGPT_TOKEN_DIR out; a secrets file's value still
    // reaches the probe; the marker and the interpreter never do.
    expect(seen('router'), 'a row with a secrets file').toEqual({ CHATGPT_TOKEN_DIR: join(home, 'from-a-secrets-file') });
    expect(seen('router2'), 'a row with none').toEqual({});
  });
});
```

  No other case in this file changes. At `1f9fa22d` that is 148 cases, so 152 after this step (measured on a scratch copy; an example).

- [ ] **Step 11: run them red.**

  `census s11-models ./node_modules/.bin/vitest run test/ccrc-models.test.ts`. Measured on a scratch copy at `4ec8926a`: `Tests 4 failed | 148 passed (152)`.
  - Expected FAIL, and why each fails today:
    - two codex lanes: today `_models_run_probe` hands `codex-a` no directory, so the probe falls to its default, which holds no `auth.json`; `codex-b`'s secrets file hands it the poisoned directory, and the poisoned PATH python runs. Both rows read `ok: false`;
    - runtime-absent and not-logged-in: the probe never sees a codex lane's inputs, so neither code appears in the row's reason (booleans, so the default directory a failing `toMatch` would print stays out of the output);
    - `_models_run_probe hands a codex row…`: today the scrub leaves `CCRC_CODEX_PYTHON` and the marker as the caller set them, and exports neither the row's directory nor the marker; for `router`, the secrets file's interpreter and marker reach the probe.
  - Expected GREEN: every pre-existing case, the two scrub cases among them.
  - If a pre-existing case reds here, stop: this step edits no line it reads.

- [ ] **Step 12: implement the caller.**

  In `ccd/ccrc`:

  1. **`_models_run_probe`'s header comment.** The sentence spans two comment lines (`grep -n 'is read for exactly$' ccd/ccrc` finds the first; :9439-9440 at `1f9fa22d`). Old:

```bash
# which lane is asking. The roster row for `<accountId>` is read for exactly
# one fact, `exec.secretsFile`, and — when it has one — that file is sourced in
```

     New. The line after it, `# a SUBSHELL that runs the probe and nothing else, …`, is kept:

```bash
# which lane is asking. The roster row for `<accountId>` is read for two
# facts: `exec.secretsFile` and, through the lane library's readers, whether
# it is an exec.kind "codex" row (`_models_probe_codex_env`, below). When it
# has a secrets file, that file is sourced in
```

  2. Directly below `_models_run_probe`'s closing `}`, above `MODELS_ENDPOINTS_TMP=""`, followed by one blank line. Never directly above `_models_run_probe() {`: its header comment ends on that line, and a function placed there would part the two.

```bash
# THE CODEX LANE'S PROBE INPUTS (spec §9.1; Plan 3a Task 1, D-3706).
#   - An exec.kind "codex" row: this exports the row's own `exec.authDir`,
#     under $HOME, as CHATGPT_TOKEN_DIR; the interpreter `ccgpt-runtime
#     python` resolves as CCRC_CODEX_PYTHON, EMPTY when none resolves, so the
#     probe refuses `runtime-absent` rather than inheriting a caller's value;
#     and CCRC_PROBE_LANE_KIND=codex, the one marker that sends the probe
#     down its codex-lane fetch, which has no default directory.
#   - Every other row: it UNSETS CCRC_CODEX_PYTHON and CCRC_PROBE_LANE_KIND
#     and touches nothing else. That row's CHATGPT_TOKEN_DIR is exactly what
#     it was before this function existed (scrubbed above, then whatever its
#     secrets file sets), so an external lane's fetch keeps today's bytes,
#     default directory included, until its own flip (Plan 3b).
# Called ONLY inside `_models_run_probe`'s two subshells, after the scrub and
# the source line: neither a caller nor a secrets file can choose a lane's
# arm, directory or interpreter, and none of it reaches the verb's own shell.
# The row is read through the lane library's one reader of `exec.kind`
# (`_models_litellm_codex`, that is `_codex_lanes`) and its one reader of a
# row (`_codex_row`). A codex row that does not validate is refused with
# `_codex_row`'s own rc and sentence, and the probe never runs.
_models_probe_codex_env() {   # <accountId> -> 0, or _codex_row's rc for a codex row that does not validate
  if ! _models_litellm_codex "$1"; then
    unset CCRC_CODEX_PYTHON CCRC_PROBE_LANE_KIND
    return 0
  fi
  _codex_row "$1" || return $?
  export CHATGPT_TOKEN_DIR="$HOME/$CX_AUTH"
  export CCRC_PROBE_LANE_KIND=codex
  CCRC_CODEX_PYTHON="$("$(_codex_runtime_cli)" python 2>/dev/null)" || CCRC_CODEX_PYTHON=''
  export CCRC_CODEX_PYTHON
  return 0
}
```

  3. `_models_run_probe`'s body, old:

```bash
  if [ -n "$secrets" ]; then
    ( unset ANTHROPIC_AUTH_TOKEN ANTHROPIC_API_KEY CHATGPT_TOKEN_DIR
      [ -r "$HOME/$secrets" ] && . "$HOME/$secrets"
      exec "$@" )
  else
    ( unset ANTHROPIC_AUTH_TOKEN ANTHROPIC_API_KEY CHATGPT_TOKEN_DIR
      exec "$@" )
  fi
```

  new. The two `unset` lines and the source line are unchanged; each subshell gains one line:

```bash
  if [ -n "$secrets" ]; then
    ( unset ANTHROPIC_AUTH_TOKEN ANTHROPIC_API_KEY CHATGPT_TOKEN_DIR
      [ -r "$HOME/$secrets" ] && . "$HOME/$secrets"
      _models_probe_codex_env "$id" || exit $?
      exec "$@" )
  else
    ( unset ANTHROPIC_AUTH_TOKEN ANTHROPIC_API_KEY CHATGPT_TOKEN_DIR
      _models_probe_codex_env "$id" || exit $?
      exec "$@" )
  fi
```

- [ ] **Step 13: run it green.**
  - `census s13-models ./node_modules/.bin/vitest run test/ccrc-models.test.ts`: all green, 152 (Step 0's count plus 4; measured on a scratch copy).
  - `census s13-probe ./node_modules/.bin/vitest run test/models-probe.test.ts`: green.

- [ ] **Step 14: re-aim the six stale citations by name (comment lines only).**

  Each edit below replaces text inside one comment line, so no line of either file moves, and no code line changes.

  In `ccd/ccrc-doctor-checks`:
  1. In `_check_models`' header comment:
     - `(\`deploy/models-op.mjs:573\`) called directly` becomes `(\`deploy/models-op.mjs\`'s \`lanes\` op) called directly`;
     - `(\`ccd/ccrc-models-probe:397\`, \`int(time.time())\`)` becomes `(\`ccd/ccrc-models-probe\`'s \`_normalise\`, \`int(time.time())\`)`;
     - `\`_mark_stale\` (\`ccd/ccrc-models-probe:409\`)` becomes `\`_mark_stale\` (\`ccd/ccrc-models-probe\`)`.
  2. In the population loop's comment, `This bare \`[ -f ]\` is NOT \`hasRegistry\` (\`deploy/models-op.mjs:573\`)` becomes `This bare \`[ -f ]\` is NOT \`hasRegistry\` (\`deploy/models-op.mjs\`'s \`lanes\` op)`, and `the shipped predicate, \`deploy/models-op.mjs:185\`)` becomes `the shipped predicate, \`deploy/models-op.mjs\`'s \`canCarryRegistry\`)`.

  In `server/test/ccrc-doctor.test.ts`, in `writeModelCatalogue`'s docstring, `(\`ccd/ccrc-models-probe:397\`'s \`int(time.time())\`)` becomes `(\`ccd/ccrc-models-probe\`'s \`_normalise\`, \`int(time.time())\`)`.

  Then `census s14-doctor-models ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'ccrc doctor: models'`: green, with exactly Step 0's `s0-doctor-models` count (24 at `1f9fa22d`; measured unchanged on a scratch copy). Step 17 proves the doctor-checks edits are comment lines only.

- [ ] **Step 15: run it green, plus every suite that pins the same files.** Each runs in the foreground, one at a time. The counts are examples, measured on a scratch copy of `4ec8926a` with this task applied:
  - `census s15-probe ./node_modules/.bin/vitest run test/models-probe.test.ts` (59) and `census s15-models ./node_modules/.bin/vitest run test/ccrc-models.test.ts` (152): green.
  - `census s15-usage ./node_modules/.bin/vitest run test/ccgpt-usage.test.ts` (36) and `census s15-harness ./node_modules/.bin/vitest run test/ccgpt-harness.test.ts` (24, unchanged): green.
  - `census s15-install ./node_modules/.bin/vitest run test/ccrc-install.test.ts -t "runs the isolated runtime"`: green.
  - `census s15-codex ./node_modules/.bin/vitest run test/ccrc-codex.test.ts` (201, unchanged): green. It is `codexLaneFixture.ts`' main consumer, whose block this task only appended to.
  - `census s15-single ./node_modules/.bin/vitest run test/single-definition.test.ts`: green and unchanged (249). This task edits no line it counts: the `.classes.json` count in `ccd/ccrc-doctor-checks` stays 2, and the litellm-version-spec scan finds nothing new in the guard's prose.
  - `census s15-macos ./node_modules/.bin/vitest run test/macos-platform.test.ts` (94 passed, 11 skipped): green. It covers the GNU-spelling corpus over `ccd/ccrc` and the probe. `_fetch_codex`'s `readlink -f` is unchanged and already excused, and nothing added is GNU-only (`${!prefix@}` is bash 3.2).
  - `census s15-topology ./node_modules/.bin/vitest run test/topology-clean.test.ts`: green.
  - `census s15-census ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored'`: expected green, but measured, not assumed (13 passed on the scratch copy).
    - The corpus cites three `ccd/ccrc` lines BELOW this task's insert: `:9663`, `:10990` and `:11635`, all in the graphify spec. The insert moves them by 36 lines on the scratch copy.
    - The census's `'ccd/ccrc'` key has moved on pure shifts before.
    - If it reds, repair it per S6-R11 IN THIS TASK'S OWN COMMIT, after the last `ccd/ccrc` edit: README by content first, every other pin re-measured from a dump, no rule widened, and a gate that stops is reported. README.md and `session-hook.test.ts` then join Step 18's file list.
  - `census s15-types ./node_modules/.bin/vitest run test/typecheck-tests.test.ts`: the only instrument over `server/test/` (D-3163).

- [ ] **Step 16: the mutation table. MEASURE every row both ways, and record the red count and the green count.**

  How each row is run. Every file a row edits gets its own backup, and every restore is proved by git:
  - **Once, before row 1,** stage the task's work, so the index holds the implemented state that each restore is measured against. Nothing is committed until Step 18.

```bash
. "<abs scratch>/plan3a-env.sh" && cd "$(git rev-parse --show-toplevel)"
git add -- ccd/ccrc-models-probe ccd/ccgpt-usage.py ccd/ccrc ccd/ccrc-doctor-checks \
  deploy/systemd/ccgpt-usage@.service \
  server/test/codexLaneFixture.ts server/test/models-probe.test.ts server/test/ccgpt-usage.test.ts \
  server/test/ccrc-install.test.ts server/test/ccrc-models.test.ts server/test/ccrc-doctor.test.ts
# plus: git add -- README.md server/test/session-hook.test.ts, only if Step 15's repair ran
git diff --quiet && echo staged-t1
```

  - **Per row:** back up every file it edits, apply the edit, run each named suite as its own `census m<row>-<suite> …` call (Step 0's spelling), restore, then re-run green. A row's suite may run with its describe's `-t` filter: `'the Codex arm: a codex lane gets'` (probe), `"each codex lane's probe reads its OWN authDir"` (caller), `'Plan 3a Task 1'` (publisher), `"runs the isolated runtime"` (install), `'CHATGPT_TOKEN_DIR'` (row 24). Row 10, which edits two files, as the example:

```bash
. "<abs scratch>/plan3a-env.sh" && cd "$(git rev-parse --show-toplevel)"
ROW=10; FILES=(ccd/ccrc-models-probe ccd/ccgpt-usage.py)
for f in "${FILES[@]}"; do
  mkdir -p "$SCRATCH/t1/mut/$ROW/$(dirname "$f")" && cp -p -- "$f" "$SCRATCH/t1/mut/$ROW/$f" || echo "BACKUP FAILED: $f"
done
```

```bash
. "<abs scratch>/plan3a-env.sh" && cd "$(git rev-parse --show-toplevel)"
ROW=10; FILES=(ccd/ccrc-models-probe ccd/ccgpt-usage.py)
for f in "${FILES[@]}"; do cp -p -- "$SCRATCH/t1/mut/$ROW/$f" "$f"; done
git diff --quiet -- "${FILES[@]}" && echo restored-t1
```

  - `restored-t1` is the only proof of a restore. Its absence stops the table: `git diff --stat -- "${FILES[@]}"` names what is left, and the staged copy is the way back (`git checkout -- <file>`). Never print that diff's lines for rows 15-17: `_fetch_codex` spells a real lane's directory.
  - **Row 16 never spells that directory.** Its edit is a pattern, applied and checked like this, and its backup and restore are the per-row blocks above with `ROW=16; FILES=(ccd/ccrc-models-probe)`:

```bash
. "<abs scratch>/plan3a-env.sh" && cd "$(git rev-parse --show-toplevel)"
python3 - ccd/ccrc-models-probe <<'PY'
import re, sys
p = sys.argv[1]
s = open(p).read()
s, n = re.subn(r'token_dir="\$\{CHATGPT_TOKEN_DIR:-\$HOME/[^}]+\}"', 'token_dir="${CHATGPT_TOKEN_DIR:-}"', s)
open(p, "w").write(s)
print("row 16 substitutions:", n)   # → 1, inside _fetch_codex; the lane arm's own default-less line does not match
PY
```

  - The files each row edits:
    - rows 1-9, 12 and 15-17: `ccd/ccrc-models-probe`;
    - rows 10 and 11: BOTH `ccd/ccrc-models-probe` and `ccd/ccgpt-usage.py`;
    - row 13: `ccd/ccgpt-usage.py`;
    - row 14: `deploy/systemd/ccgpt-usage@.service`;
    - rows 18-24: `ccd/ccrc`.
  - After the last row, `git diff --quiet && echo table-restored-t1`: the worktree is the staged state again.

  "Measured" is the red count on a scratch copy of `4ec8926a` with this task applied, each row run once and restored; every row was green again after its restore. Re-measure each at execution.

  | # | Guard | Mutation | Goes red | Measured |
  |---|---|---|---|---|
  | 1 | no default token directory on the codex lane's arm | in `_fetch_codex_lane`, set `token_dir` to a SYNTHETIC default, `"${CHATGPT_TOKEN_DIR:-$HOME/.local/share/ccrc/codex/default-lane}"`. Never copy or print `_fetch_codex`'s own default: it is a real lane's directory | probe: `handed no CHATGPT_TOKEN_DIR…` (the refusal word is `not-logged-in`); `the codex-lane arm spells no default…` | 2 |
  | 2 | no PATH-derived interpreter | insert `[ -n "$py" ] \|\| py="$(dirname "$(readlink -f "$(command -v litellm)" 2>/dev/null)")/python"` above the `runtime-absent` test | probe: `handed no interpreter…` (`python-poison` exists: the containment poison, never a real LiteLLM); `the codex-lane arm spells no default…` | 2 |
  | 3 | runtime-absent before any import | the `runtime-absent` block's test → `false` (as if deleted) | probe: `handed no interpreter…` (no `runtime-absent:` in stderr) | 1 |
  | 4 | existence only, before the interpreter | the `not-logged-in` block's test → `false` | probe: `with no auth.json…` (the stand-in answers: exit 0); caller: `…authDir holds no auth.json…` | 1 + 1 |
  | 5 | `-I` | `exec "$py" -` | probe: `runs the handed interpreter as -I -…` (the fixture exits 90), and every case that expects exit 0 or reaches the program | 6 |
  | 6 | the scrub | delete the `for v in ${!CHATGPT_@} …` line | probe: `runs the handed interpreter as -I -…` (env carries `CHATGPT_AUTH_FILE`, `OPENAI_API_KEY`, `LITELLM_LOG`) | 1 |
  | 7 | the cost map | drop `LITELLM_LOCAL_MODEL_COST_MAP=True` from the export | probe: `runs the handed interpreter as -I -…` | 1 |
  | 8 | D-3161 closed on the codex path | replace `account_id = auth.get_account_id()` with `import json; account_id = json.load(open(os.path.join(os.environ["CHATGPT_TOKEN_DIR"], "auth.json"))).get("account_id", "")` | probe: `sends ChatGPT-Account-Id from Authenticator().get_account_id()…` (`authOpens` is non-empty) | 1 |
  | 9 | the device flow refused | in the probe, `auth = Authenticator()` for the `_unattended(…)()` line | probe: `…login-required AT ONCE…` (marks `['device-code']`, auth.json rewritten), the cooldown and renamed cases | 3 |
  | 10 | the cooldown refused | delete the `_wait_for_access_token` override from BOTH copies (so the twin stays green) | probe: `another sign-in's cooldown…` (marks `['cooldown-wait']`) | 1 |
  | 11 | fail closed on a moved name | `if missing:` becomes `if False:` in BOTH copies | probe: `…lacks a name the guard overrides…` (marks `['device-code']`); publisher: `…refused runtime-api-moved…` | 1 + 1 |
  | 12 | the guard is one text | change `"device-code"` to `"device"` in the probe's copy only | probe: `the unattended guard is ONE text…` | 1 |
  | 13 | the publisher's device flow refused | `token = Authenticator().get_access_token()` | publisher: `…login-required at once…` (marks `['device-code']`; the endpoint sees one request) and `…refused runtime-api-moved…` | 2 |
  | 14 | the poll is bounded | delete the unit's `TimeoutStartSec=300` | install: `…runs the isolated runtime…` | 1 |
  | 15 | only the marker picks the codex lane's arm | `_fetch`'s dispatch → `codex) _fetch_codex_lane ;;` | probe: both Z1 cases (`without the codex-lane marker…`: the handed runtime runs; `…falls back to its own default…`: `no-token-dir`) | 2 |
  | 16 | the external arm keeps its default (Z1) | the row 16 block above: `_fetch_codex`'s default stripped by pattern, never spelled | probe: `…falls back to its own default…` (no default to read off the arm) | 1 |
  | 17 | only the value `codex` picks it | `[ "${CCRC_PROBE_LANE_KIND:-}" = codex ]` → `[ -n "${CCRC_PROBE_LANE_KIND:-}" ]` | probe: `without the codex-lane marker…` (its `external` pass runs the handed runtime) | 1 |
  | 18 | each lane its own authDir | in `_models_probe_codex_env`, `_codex_row "$1"` becomes `_codex_row "$(_codex_lanes 2>/dev/null \| head -n1)"` | caller: `two codex lanes…` (both calls carry codex-a's directory; codex-b's header is `acct-codex-a`) | 1 |
  | 19 | the directory export | delete `export CHATGPT_TOKEN_DIR="$HOME/$CX_AUTH"` | caller: all four (`no-token-dir` where a row or a refusal was expected; `_models_run_probe hands…` lacks the directory) | 4 |
  | 20 | codex inputs after the secrets file | in the secrets branch, move `_models_probe_codex_env "$id" \|\| exit $?` above the source line | caller: `two codex lanes…` (codex-b's probe gets the secrets file's directory and runs its poisoned interpreter); `_models_run_probe hands…` (`router` shows the secrets file's interpreter and marker) | 2 |
  | 21 | never an inherited interpreter | replace the `CCRC_CODEX_PYTHON=…`/`export CCRC_CODEX_PYTHON` pair with `py="$("$(_codex_runtime_cli)" python 2>/dev/null)" && export CCRC_CODEX_PYTHON="$py"` | caller: `a codex lane with no runtime…` (`python-poison`: the ambient interpreter ran) | 1 |
  | 22 | the marker export | delete `export CCRC_PROBE_LANE_KIND=codex` | caller: all four (with no marker, a codex lane takes `_fetch_codex`) | 4 |
  | 23 | neither marker nor interpreter for any other row | delete the non-codex arm's `unset CCRC_CODEX_PYTHON CCRC_PROBE_LANE_KIND` | caller: `_models_run_probe hands…` (`router` shows the secrets file's interpreter and marker; `router2` the ambient ones) | 1 |
  | 24 | an external row's scrub is today's (Z1) | drop `CHATGPT_TOKEN_DIR` from BOTH `_models_run_probe` `unset` lines | caller: the two pre-existing scrub cases (`an ambient CHATGPT_TOKEN_DIR pointing at a poisoned auth.json…`, `a codex lane with a secrets file that sets only ANTHROPIC_AUTH_TOKEN…`) and `_models_run_probe hands…` | 3 |

  Record these explicitly:
  - **Equivalent mutant, not pinned:** `_fetch_codex_lane`'s `unset CCRC_CODEX_PYTHON CCRC_PROBE_LANE_KIND` inside its subshell. Deleting it stays green (measured: 13 of 13 in the probe describe), because the program reads neither name and the fixture records only `CHATGPT_*`, `LITELLM_*`, `OPENAI_*` and `CODEX_CLIENT_VERSION`. It stays as hygiene: the interpreter gets nothing it was not meant to.
  - **Row 24 is no longer an equivalent mutant.** The external rows' `CHATGPT_TOKEN_DIR` is still today's, so the scrub still decides it, and the two pre-existing cases still red.
  - **If a demanded mutation stays green, report it.** Never add code to force a red (D-3152).

- [ ] **Step 17: the cut, the external arm's bytes, and the residue check.**

```bash
. "<abs scratch>/plan3a-env.sh" && cd "$(git rev-parse --show-toplevel)"
BASE="$(cat "$SCRATCH/t1/base")"
# Before the commit, so every check reads the WORKTREE against the base. Step 16
# staged it and restored it to that state. Nothing below prints a diff line:
# `_fetch_codex` spells a real lane's directory, so it is compared, never shown.
git diff --quiet "$BASE" -- ccd/ccgpt-runtime ccd/ccd ccd/ccgpt-proxy.py deploy/deploy.sh deploy/models-op.mjs \
  server/test/single-definition.test.ts server/test/fixtures/pystub \
  && echo "cut held: no runtime rebuild, no ccd re-stamp, no fallback-deploy or registry-writer edit"
fx() { sed -n '/^_fetch_codex() {$/,/^PY$/p'; }
cmp -s <(git show "$BASE:ccd/ccrc-models-probe" | fx) <(fx < ccd/ccrc-models-probe) \
  && echo "external probe arm byte-identical"
echo "probe lines removed or changed: $(git diff -U0 "$BASE" -- ccd/ccrc-models-probe | grep -c '^-[^-]')"
seam() { sed '/^# THE PROBE IS A BOX-LEVEL EXECUTABLE WITH NO LANE CONTEXT: it reads$/,/^MODELS_ENDPOINTS_TMP=""$/d'; }
cmp -s <(git show "$BASE:ccd/ccrc" | seam) <(seam < ccd/ccrc) \
  && echo "ccd/ccrc identical outside the probe seam"
echo "doctor-checks code lines changed: $(git diff -U0 "$BASE" -- ccd/ccrc-doctor-checks | grep '^[-+][^-+]' | grep -vc '^[-+][[:space:]]*#')"
for v in $(jq -r '.accounts[] | select(.telemetry == "codex") | .id, .label' "$HOME/.ccrc/accounts.json" | sort -u); do
  git diff "$BASE" -U0 | grep '^+' | grep -qF -e "'$v'" -e "\"$v\"" && echo "RESIDUE: an added line names a live lane id or label"
done
echo residue-check-done
```

  - Expected, in order: `cut held…`, `external probe arm byte-identical`, `probe lines removed or changed: 1` (the old `codex)` line), `ccd/ccrc identical outside the probe seam`, `doctor-checks code lines changed: 0`, then `residue-check-done` with no `RESIDUE:` line. The four tree checks gave those answers on the scratch copy, compared against the base tree.
  - `ccd/ccrc identical outside the probe seam` is Z1's proof for the caller side: the region it removes runs from `_models_run_probe`'s header comment to `MODELS_ENDPOINTS_TMP=""`, so the `refresh` arm, `_models_refresh_one`, `_models_lane_sub` and every `_models_litellm*` function are byte-identical.
  - Any other answer stops the task.
  - The residue loop reads the live values off the box's roster at execution time and prints none of them (R10, R13).

- [ ] **Step 18: commit.**
  - Post-condition, against the recorded base (`$SCRATCH/t1/base`) and never `origin/main`. Before the commit it is the worktree's `git diff --name-only "$BASE"`, and after it `git diff --name-only "$BASE" HEAD`. Each names exactly:
    - `ccd/ccrc-models-probe`, `ccd/ccgpt-usage.py`, `ccd/ccrc`, `ccd/ccrc-doctor-checks`;
    - `deploy/systemd/ccgpt-usage@.service`;
    - `server/test/codexLaneFixture.ts`, `server/test/models-probe.test.ts`, `server/test/ccgpt-usage.test.ts`, `server/test/ccrc-install.test.ts`, `server/test/ccrc-models.test.ts` and `server/test/ccrc-doctor.test.ts`;
    - plus README.md and `server/test/session-hook.test.ts` only when Step 15's repair ran.
    - Any other name stops the task.
  - `git add` exactly those files, and commit. The author and committer follow the Global Constraints' commit-identity rule.

```bash
. "<abs scratch>/plan3a-env.sh" && cd "$(git rev-parse --show-toplevel)"
BASE="$(cat "$SCRATCH/t1/base")"
git diff --name-only "$BASE" | sort        # before the commit: the worktree against the base
git add -- ccd/ccrc-models-probe ccd/ccgpt-usage.py ccd/ccrc ccd/ccrc-doctor-checks \
  deploy/systemd/ccgpt-usage@.service \
  server/test/codexLaneFixture.ts server/test/models-probe.test.ts server/test/ccgpt-usage.test.ts \
  server/test/ccrc-install.test.ts server/test/ccrc-models.test.ts server/test/ccrc-doctor.test.ts
# plus: git add -- README.md server/test/session-hook.test.ts, only if Step 15's repair ran
git commit -F - <<'EOF'
fix(gpt-lane): a codex lane's model probe reads its own OAuth through its own runtime; every other lane's probe is unchanged

Plan 3a Task 1 (carry-forward 7, spec §9.1, operator ruling Z).

For an exec.kind "codex" row, `_models_run_probe` now hands the probe the
row's own exec.authDir, the interpreter `ccgpt-runtime python` resolves and
the marker CCRC_PROBE_LANE_KIND=codex, after the scrub and after any
secrets file. The probe's new codex-lane arm has no default for either
input, runs that interpreter under -I, scrubbed, with the cost map local,
and refuses no-token-dir, runtime-absent, not-logged-in, runtime-api-moved
and login-required, one line each, remedy first. Every other row keeps
`_fetch_codex` byte for byte, its default directory included, until that
lane's own flip (D-3706).

The codex-lane arm and the usage publisher refuse LiteLLM's device flow
in-process, before it can write auth.json, and fail closed on a runtime
whose Authenticator moved the names the guard overrides. The usage unit
gains TimeoutStartSec=300 (D-3707). On the codex-lane arm,
ChatGPT-Account-Id comes from Authenticator().get_account_id(), so no ccrc
code opens a codex lane's auth.json: D-3161 closed there.

ccd/ccgpt-runtime is byte-identical, so no box rebuilds its runtime. The
refresh loop, both LiteLLM arms and doctor's models check are unchanged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git diff --name-only "$BASE" HEAD | sort   # after the commit: the same list
git status --short                          # expected: nothing
```

**What Task 1 deliberately does NOT do:**
- **No edit to `ccd/ccgpt-runtime`** (so no `_rt_probe_source` change and no rebuild anywhere), `ccd/ccd` (no re-stamp) or `ccd/ccgpt-proxy.py`. The runtime's behaviour probe keeps checking `get_access_token` only, and the model probe's `runtime-api-moved` is the gate for the other three names.
- **No edit to `deploy/deploy.sh`.** Its `:674` placement of `~/.local/bin/ccrc-models-probe` (R-C11, 2b1-21's probe half) is Task 7's, per R5, with `deploy-verify.test.ts`, `usage-sweep-deploy-ship.test.ts` and `install-census.test.ts`' :58 note. ccrc never runs that PATH copy (`$CCRC_HERE`, ccd/ccrc:9487, :9667).
- **No edit to `_fetch_codex`, the refresh loop, `_models_litellm` or `_check_models`.** An external lane's probe, refresh, re-materialise, LiteLLM render and stop decision are what they were, and so is every doctor row (Z1). The external LiteLLM arm's one new refusal, once a codex row exists, is Task 2's (Z4).
- **No guard on creating a registry.** Refusing a codex registry on a non-codex row is Task 2's (Z3), at `deploy/models-op.mjs`' `init` op.
- **No `_check_codex`** (Tasks 4-5), no usage-pair placement or rename (Task 6), and no edit to `pystub`.
- **No change to `ccrc codex login`,** which IS the device flow, run by a person, or to the publisher's request (still no `ChatGPT-Account-Id`) or its lane.json remedies (Task 8).

**Hazards later tasks must respect:**
1. **"The probe" names two files.** Only `ccd/ccgpt-runtime`'s `_rt_probe_source` is hashed. Any byte of it, a comment included, rebuilds the runtime on every box with a codex lane at its next auto-update. That is zero boxes until 3b's first flip, and about 650 MB of unattended pip on the live fleet box after it. `ccd/ccrc-models-probe` is hashed by nothing.
2. **The guard depends on two PRIVATE LiteLLM names.** A litellm inside D-3487's range that renames either makes every codex lane's probe and every poll refuse `runtime-api-moved`. That is loud and never a hang, but it stales every codex lane's catalogue and usage row at once. Task 4's `_check_codex` is where that surfaces on the box.
3. **Neither the external arm nor the live LiteLLM TIER is guarded.** Until a lane's flip, its hourly refresh runs `_fetch_codex`, whose `get_access_token()` can still start a device flow on a dead refresh token, exactly as it can today (Z1). The tier's own Authenticator can too, and that is not ccrc code. Both leave the external lane at its flip. Carry to 3b: prove a refresh with the lane's own `ccrc models refresh` before un-parking.
4. **Every codex-lane probe refusal is remedy-first,** because `_mark_stale` keeps only 300 characters of the fetch's stderr. A new refusal must keep the order.
5. **`_codex_row`'s refusal reaches `ccrc models`' `reason` with its own `ccrc codex:` prefix.** That is deliberate: it is the one sentence for a codex row that does not validate.
6. **Two Codex arms until Plan 4.** `CCRC_PROBE_LANE_KIND=codex` is the only thing that picks the codex lane's arm, and `_models_probe_codex_env` its only writer. A caller that runs the probe for a codex lane without going through `_models_run_probe` gets `_fetch_codex`, default directory and all. Plan 4's ccrc half deletes `_fetch_codex`, the dispatch line and the two Z1 cases in `models-probe.test.ts` together (Z8).
7. **A codex registry on a non-codex row is still probed through the default.** That is today's live shape, kept on purpose (Z1). What stops a second such lane from appearing is Task 2's Z3 guard, not anything here.
8. **The census compares unit NAMES, not states,** so a live foreign oneshot firing mid-run is not a leak. Its process census counts this shell's temp root only.


### Task 2: The external arm stays byte for byte on today's shape; it never runs the other repository's stop once a codex lane exists; an external lane cannot gain a codex registry

> Resolved by operator ruling Z (2026-10-01), which replaces R-C2 and R-C3:
> - **Z1, Z5.** `_models_litellm`'s external arm keeps its box-global path, its `pgrep` and its bare `ccgpt stop` for an `external` lane until that lane's own flip in Plan 3b. Spec §19.6 stands as written. The retirement this task used to carry is withdrawn, and D-3708 records that decision.
> - **Z4.** The arm never runs the other repository's stop once any roster row is codex-kind. It refuses through its existing `restart-failed` path, with a sentence naming why, before any write. On today's shape, with no codex row, nothing changes. This is the new departure `D-3753`.
> - **Z3 lives in this task.** `deploy/models-op.mjs`' `init` arm is the one place a class registry is created, and no other task edits it. So the guard is here: a codex registry is never created on a row that is not codex-kind, and a registry that already exists is untouched. This is D-3706, as ruling Z6 redefines it.
> - **No dependency on Task 1's code.** Neither guard reads the probe or the refresh loop, and Task 1 changes neither the arm nor the `init` arm. The order 1 → 2 holds only because both tasks edit `server/test/ccrc-models.test.ts`.

**Files:**
- Modify `deploy/models-op.mjs`, in the `init` arm (`grep -n "if (opName === 'init') {" deploy/models-op.mjs`; :839 at `4ec8926a`). Add one guard block between the existing-registry branch's closing `}` (:854) and `const seed = JSON.parse(JSON.stringify(SEEDS[a.probe]));` (:855).
- Modify `ccd/ccrc`:
  - Add `_models_litellm_stop_blocked`, directly below `_models_litellm_running() { pgrep -f "litellm .*$(_models_litellm_path)" >/dev/null 2>&1; }` (`grep -n '^_models_litellm_running()' ccd/ccrc`; :9717).
  - In `_models_litellm` (`grep -n '^_models_litellm() {' ccd/ccrc`; :10014-10051), change two places: its four-line header comment (:10015-10018), and one guard block as the first statement inside `if _models_litellm_running; then` (:10030).
  - **Not touched:**
    - `_models_litellm_path`, `_models_litellm_running`, and the rest of the external arm;
    - the codex arm and `_codex_litellm_ensure`;
    - `_models_lane_sub`'s `init` arm, which already passes the op's refusal through;
    - the refresh loop and the `litellm)` sub.
- Modify `server/test/fixtures/modelCases.ts`: add one export, `SEEDED_REGISTRY_BYTES`, directly below `SEEDED`.
- Modify `server/test/models-op.test.ts`:
  - its two imports, plus the module helpers `LEGACY_EXTERNAL_ID` and `plantCodex`;
  - every SETUP `init codex` on a row that is not codex-kind becomes `plantCodex(…)`. At `4ec8926a` that is 26 statements and one `beforeEach` one-liner;
  - in `describe('init (§10, §13.1)')`, two cases are re-aimed at a codex-kind row, and four are new.
- Modify `server/test/ccrc-models.test.ts`:
  - its two imports;
  - the module helpers `LEGACY_SECRETS_EXTERNAL_ID` and `seedCodex`, plus `EXT_A_ROW` and `LEGACY_EXTERNAL_ID`. Task 1 leaves `codexRow` and `codexBox` at module level and no external fixture row, and Step 1(e) still adds only the names it does not find;
  - `env()`, two edits for the containment Global Constraint: an inherited `CCGPT_CONFIG` is dropped, and `pgrep` and `ccgpt` get a poison wherever the HOME holds no stand-in of its own;
  - in `describe('the models harness containment wall')`, one case;
  - every SETUP `init codex` on a row that is not codex-kind becomes `seedCodex(…)`. At `4ec8926a` that is 22 statements and 3 `expect(…).toBe(0)` lines;
  - in `describe('ccrc models <id> init')`, one case is re-aimed and two are new;
  - in `describe('ccrc models litellm')`, one nested describe of six cases.
- **Not modified:**
  - `server/test/single-definition.test.ts`. Its one-holder pin of the box-global path stays true, because the arm keeps that path;
  - `shared/litellm.mjs`, `deploy/litellm-config.template.yaml`, and the op's `litellm` arm.

**Interfaces:**
- **Consumes:**
  - `_codex_lanes` (`ccd/ccrc:10369`), the lane library's one reader of exec.kind. It answers:
    - rc 0 with one id per line, or with nothing, which means "none";
    - rc 1 for a roster it cannot read;
    - rc 2 when `jq` is missing.
  - `_models_litellm_running` (:9717) and `_models_refuse` (:2392), unchanged.
  - In `deploy/models-op.mjs`: `refuse`, `isObj`, the account `findAccount` returned, and the `init` arm's existing-registry branch, all unchanged.
    - `writeRegistry` has exactly two callers (`grep -n 'writeRegistry(' deploy/models-op.mjs`): this arm's create, and the mutating ops' rewrite of a registry that already exists.
    - So the create is the one place a registry comes into being.
  - Test helpers:
    - in `ccrc-models.test.ts`: `box`, `env`, `run`, `sourced`, `oneObject`, `writeCatalogue`, `registryOf`, `ROSTER` and `CODEX_RAW`, plus `describe('ccrc models litellm')`'s own `pgrep`, `ccgpt`, `calls` and `configPath`;
    - in `models-op.test.ts`: `seed`, `op`, `rosterPath`, `regPath`, `registryOf`, `settingsOf` and `writeCatalogue`;
    - `codexAuthDir` (`codexLaneFixture.ts`) and `SEEDED` (`fixtures/modelCases.ts`).
  - Task 1's module-level `codexRow(id, proxyPort, litellmPort, extraExec?)` in `ccrc-models.test.ts`. Task 1 defines no external fixture row, so Step 1 defines `EXT_A_ROW` and `LEGACY_EXTERNAL_ID`, and adds `codexRow` too only if Task 1 as committed left none.
  - `env()`'s own `poison` helper and `MANAGER_STANDIN_MARK` (`codexLaneFixture.ts`), unchanged.
  - `r11 <evidence-label> <command…>`, the census wrapper in `$SCRATCH/plan3a-env.sh`. Every block below that uses it, `$SCRATCH` or `$BASE` sources that file first (ruling F2).
- **Produces:**
  - **The op's refusal.** Take `init --probe codex` on a row that has no registry yet and whose `exec.kind` is not `codex`. It answers exit 1 with `{"ok":false,"error":"codex-registry-needs-codex-lane","detail":"account \"<id>\" is not a codex-kind lane (its exec.kind is \"<kind>\"), and only a codex-kind lane declares the authDir its probe must read, so a codex class registry here would be probed through a token directory that is not this lane's. Flip the lane to \"codex\" first (Plan 3b), then re-run 'ccrc models <id> init codex'. Nothing was written."}`.
    - Its stderr line is `models-op: <detail> (codex-registry-needs-codex-lane)`, and nothing is written.
    - `ccrc models <id> init codex` passes it through at exit 1.
    - Every other case is unchanged. A registry that already exists answers `created: false` and stays byte for byte, and every other probe kind is created on any row.
  - **`_models_litellm_stop_blocked`** answers one of three ways:
    - no codex-kind row: rc 1, and it prints nothing;
    - one or more codex-kind rows: rc 0, printing `the roster names codex-kind lane(s) <id>[, <id>…]`;
    - `_codex_lanes` cannot answer: rc 0, printing `which roster lanes are codex-kind cannot be read (the lane library answered rc <n>)`.
  - **The external arm.** When a proxy is running on a changed render and the stop is blocked, it answers `restart-failed` at exit 1, with this detail: `the LiteLLM proxy is running on the PREVIOUS config, and ccrc will not stop it: <clause>, and the only stop this arm has is another repository's bare 'ccgpt stop', which stops units by name, the names a codex lane's own tiers carry. Stop that proxy by hand once you know which lane's units that stop would name, or flip lane <id> to codex (Plan 3b), then re-run this command — until then this box serves the old model list. Nothing was written and nothing was stopped.`
    - Every other path is today's, byte for byte.
    - The hourly refresh carries that refusal as an `ok: false` row whose `reason` is the sentence, and exits 1.
  - **Test fixtures:**
    - `SEEDED_REGISTRY_BYTES` (`fixtures/modelCases.ts`): `SEEDED` in `writeRegistry`'s bytes;
    - `plantCodex(id)` (`models-op.test.ts`) and `seedCodex(id)` (`ccrc-models.test.ts`): a codex registry that predates the refusal, planted 0600 and then materialised by the op;
    - `LEGACY_SECRETS_EXTERNAL_ID` (`ccrc-models.test.ts`): `ROSTER.accounts[5]!.id`.
  - **The harness's containment** (`ccrc-models.test.ts`' `env()`): no case inherits `CCGPT_CONFIG`; a case that wants it passes it in `extra`. A HOME that holds no `pgrep` or `ccgpt` of its own gets a poison for each, which logs its argv to `$HOME/<name>-poison` and exits 97. A stand-in a case writes before a run is never overwritten by that run's `env()`.
  - **For Task 10 (ruling Z7):**
    - the live-shape fixture writes its external lane's codex registry by file (its own `REHEARSAL_REGISTRY`), never through `init codex`, which now refuses there;
    - its `init codex` case expects `codex-registry-needs-codex-lane`;
    - its post-flip case expects `restart-failed`, a detail containing `the roster names codex-kind lane(s) <the flipped id>`, and an empty `ccgpt` call log.
  - **For Task 11's §20**, three texts:
    - in §20.1: "A codex class registry is created only on an `exec.kind: "codex"` row. `ccrc models <id> init codex` on any other row is refused `codex-registry-needs-codex-lane`, writes nothing, and names the remedy: flip the lane first (Plan 3b). A registry that already exists is untouched (Plan 3a Task 2, D-3706).";
    - in §20.2: "§19.6 stands. An `external` lane keeps the box-global path, the `pgrep` and the bare `ccgpt stop` until its own flip (D-3708, withdrawn by operator ruling Z). One guard is added. Once any roster row is `exec.kind: "codex"`, or the roster's codex lanes cannot be read, the external arm refuses its bare stop as `restart-failed` and writes nothing. That stop names units by name, and a codex lane's tiers carry those names (§19.2) (Plan 3a Task 2, `D-3753`).";
    - a same-line pointer on §19.6's last bullet: "(amended: §20.2, `D-3753`)".

**Why:**

*The live arm stays, and so does its stop, until each lane's flip (Z1).*
- Measured on the live fleet box: two `external` rows with Codex telemetry, one of them with a codex class registry, and no codex-kind row.
- The hourly `ccrc-models.timer` reaches the external arm for the lane with the registry. It renders the box-global config that the other repository's launcher reads, and it runs that repository's bare stop when a changed render meets a running proxy.
- Ruling Z keeps all of that until the lane's flip. Plan 3b's flip moves each lane onto the codex arm automatically, because `_models_litellm_codex` picks the arm from `exec.kind`. Plan 4's ccrc half deletes the arm once no external lane has a codex registry (Z8).

*Why the stop needs a guard before any flip (Z4, critic #7).*
- A bare `ccgpt stop` stops units by name. The names are `ccgpt-<id>-{litellm,shim}.service`, the same names ccrc's own tiers run under (spec §19.2).
  - Before any flip, only the other repository uses those names.
  - After lane A's flip, lane A's ccrc tiers share them.
- ccrc cannot tell which lane's units that repository's stop would name. So once any row is codex-kind, the external arm refuses the stop rather than guess. This makes the runbook's order structural.
- The guard uses the arm's existing refusal, `restart-failed`, before PHASE 2 writes. So the STOP-THEN-WRITE doctrine holds: nothing is written, and the next run sees the same difference and retries. The sentence never tells the operator to run the bare stop, because that is exactly the act being refused.
- It binds the stop alone:
  - a changed render with no proxy running still lands, because no stop is owed;
  - an unchanged render asks nothing;
  - on a roster with no codex row the arm is today's, byte for byte, because `_codex_lanes` answers rc 0 with nothing.
- Undecidable is not "none": a roster whose codex lanes cannot be read refuses the stop too.
  - Through `cmd_models` this branch cannot be reached. `_models_deps` requires `jq`, and PHASE 1's op refuses an unreadable roster first.
  - So its case reaches the branch by redefining `_codex_lanes` in a sourced shell, and its mutation is row 8.
- It asks `_codex_lanes`, which is keyed on exec.kind, never on telemetry. Today's live rows carry `telemetry: "codex"` while still external, so a telemetry-keyed guard would block the live stop today (row 9).

*Why no registry is created on a lane that is not codex-kind (Z3).*
- After Z1, an `external` lane's probe keeps the token-directory default until its flip, and that directory belongs to one particular lane. If any other external row gained a codex registry, the next hourly refresh would probe it with that lane's OAuth.
  - That is the wrong-lane hazard R-C2 closed by freezing. Z3 closes it by making the registry unreachable instead.
- The guard sits in the op, not in `ccd/ccrc`.
  - The `init` arm's create is the one place a registry comes into being, so the guard covers the verb and every other caller of the op ("any other writer", Z3).
  - The mutating ops rewrite a registry that exists, and never change its probe kind. The `probe-declared` refusal belongs to `init`.
- It sits after the existing-registry branch. So the live lane that already has a codex registry keeps it, answers `created: false`, and keeps being refreshed (row 5).
- It is keyed on `exec.kind !== "codex"`, the predicate every other 3a gate uses.
  - On a valid roster, that means `external`, the shape Z3 names and the live one, or a non-Anthropic `generated` row. A `generated` row declares no `authDir` either, so its probe takes the same default.
  - An Anthropic row is refused `anthropic-lane` before this point.
  - Row 3 is the narrower, `external`-only reading, which leaves the `generated` row creatable.
- Every other probe kind is still created on any row, as before (row 2).
- The refusal names Z3's remedy. A lane gains its codex registry after its flip, when `init codex` succeeds.

*The test fallout, and why the migration plants rather than inits.*
- The two suites built "an external lane with a codex registry", the live shape, by running `init codex` on the tree's external ROSTER rows.
  - Measured on a scratch copy of `4ec8926a` with the guard alone: 50 reds in `models-op.test.ts` and 39 in `ccrc-models.test.ts`.
  - Every one of them is a setup that no longer creates its registry.
- On the live box such a registry predates the guard, so the fixture plants one the same way.
  - `SEEDED_REGISTRY_BYTES` is `init codex`'s own write. `seeds today's codex registry, byte for byte, on a codex-kind lane` binds the two (measured identical).
  - The op's own `materialise` then writes what `init` writes after the registry.
  - The claims are unchanged: each case still measures the arm, the refresh or the op on that shape.
- Only three cases need a real creation: two in `models-op.test.ts` and one in `ccrc-models.test.ts`. They move to a codex-kind row, and their seed values are read off `SEEDED` rather than retyped.
- **No added line names a live lane id (R13).** The residue check counts added lines naming a live codex-telemetry id, and the tree's pre-existing ROSTER ids are outside this plan's fixture vocabulary.
  - So a migrated line names a pre-existing row by position: `LEGACY_EXTERNAL_ID` (`ROSTER.accounts[2]!.id`, in both files) and `LEGACY_SECRETS_EXTERNAL_ID` (`ROSTER.accounts[5]!.id`).
  - This plan never spells those ids either. Step 1(f)'s script reads them off each file's ROSTER.
  - New rows are `ext-a`, `ext-b`, `gen-a` and `codex-a`.

*Why the harness now poisons `pgrep` and `ccgpt`, and drops `CCGPT_CONFIG` (the head's containment Global Constraint).*
- Ruling Z keeps the external arm as live code. Every case that reaches it runs `pgrep -f`, and may run a bare `ccgpt stop`. On the fleet box a real `ccgpt stop` stops a live lane's units by name, and the census cannot see that: a stopped `--collect` transient unit simply leaves the listing.
- Today only the describes that plant a functional stand-in are contained. A case that reached the arm without one would resolve whatever `pgrep` and `ccgpt` the runner's PATH carries. So `env()` plants a poison for each wherever the HOME holds none.
- A describe's own stub is written before its run and must survive it, so the poison never overwrites one. Row 17 is that half: always poisoning reds 12 cases.
- `CCGPT_CONFIG` is the other repository's override of the arm's box-global path, and the arm still honours it. A GPT-lane session can carry a real one, so `env()` no longer inherits it, exactly as it already drops the two lane bounds. A case that wants it passes it in `extra`, as `the external arm still honours CCGPT_CONFIG …` does.

*The live shape after the merge.* Nothing changes:
- no codex row exists, so `_models_litellm_stop_blocked` answers rc 1, and the arm, its render and its stop run as before;
- nothing on the box runs `init codex`: neither the timer nor the install spine calls it;
- the lane with a registry keeps it.

Task 10 pins all three on the live-shape fixture.

- [ ] **Step 0: Base and census.**

  ```bash
  . "<abs scratch>/plan3a-env.sh"
  jq -r '.accounts[].id' "$HOME/.ccrc/accounts.json" | grep -cxE 'codex-a|codex-b|ext-a|ext-b|gen-a'   # expected: 0 (no fixture id is a rostered id)
  git rev-parse HEAD > "$SCRATCH/t2-base"   # this task's base: Steps 6 and 7 read it back, never a shell variable (F2)
  cd server
  r11 t2-base ./node_modules/.bin/vitest run test/ccrc-models.test.ts test/models-op.test.ts
  ```

  Expected:
  - both files are green;
  - the last line is `census: clean — no unit or link change, 0 fixture processes left; command exit 0`. A `census: FAIL …` (exit 125 or 126) is attributed by the rule beside the census script before it counts.

  Record both files' case counts from vitest's summary. At `4ec8926a`, before Task 1, they were 148 (`ccrc-models`) and 106 (`models-op`). Re-derive them on top of Task 1, which must already be committed.

- [ ] **Step 1: Write the failing tests, and migrate the setups the refusal reaches.**

  (a) `server/test/fixtures/modelCases.ts`: directly below `SEEDED`'s closing `};` (its last field line, `  effort: { haiku: 'high', sonnet: 'high', opus: 'max', fable: 'max' },`, is unique in the file), add:

  ```ts

  /** `SEEDED` byte for byte as `init codex` writes it: `writeRegistry`'s 2-space
   *  JSON and a trailing newline (Plan 3a Task 2). Since operator ruling Z3 the
   *  op refuses to CREATE a codex registry on a row that is not exec.kind
   *  "codex", so a case that needs the live Codex lanes' shape (an external row
   *  whose registry predates that refusal) plants these bytes instead.
   *  `models-op.test.ts`' `seeds today's codex registry, byte for byte, on a
   *  codex-kind lane` binds them to the op's own write. */
  export const SEEDED_REGISTRY_BYTES = `${JSON.stringify(SEEDED, null, 2)}\n`;
  ```

  (b) `server/test/models-op.test.ts`, imports. Replace `import { CODEX } from './fixtures/modelCases.js';` (unique) with:

  ```ts
  import { CODEX, SEEDED, SEEDED_REGISTRY_BYTES } from './fixtures/modelCases.js';
  import { codexAuthDir } from './codexLaneFixture.js';
  ```

  (c) `models-op.test.ts`, module helpers. Directly below the closing `};` of `const writeCatalogue = (id: string, cat: unknown = CODEX): void => {` (unique), add:

  ```ts

  /** This file's third ROSTER row, an EXTERNAL row, read by position rather than
   *  spelled, so no added line names a roster id outside Plan 3a's fixture
   *  vocabulary (ruling R13). */
  const LEGACY_EXTERNAL_ID = ROSTER.accounts[2]!.id;

  /** Plan 3a Task 2 (operator ruling Z3, D-3706): `init codex` no longer CREATES
   *  a codex registry on a row that is not exec.kind "codex", and this file's
   *  external rows are the live Codex lanes' kind before their flip. A case
   *  that needs such a row WITH a codex registry is the live shape, a registry
   *  that predates the refusal, which the refusal leaves untouched. So it is
   *  planted in `init codex`'s own bytes (`SEEDED_REGISTRY_BYTES`), 0600 as
   *  `writeRegistry` writes it, and the op's own `materialise` then writes what
   *  `init` writes after them. */
  function plantCodex(id: string): void {
    fs.mkdirSync(path.join(home, '.ccrc', 'models'), { recursive: true });
    fs.writeFileSync(regPath(id), SEEDED_REGISTRY_BYTES, { mode: 0o600 });
    const m = op('materialise', '--file', rosterPath(), '--id', id);
    expect(m.code, m.stdout + m.stderr).toBe(0);
  }
  ```

  (d) `models-op.test.ts`, inside `describe('init (§10, §13.1)', () => {`: its first two `it(`s create a codex registry on `ROSTER.accounts[2]`, an external row. They are `seeds today's … registry for probe codex` and `materialises on success: the env block, the three-column TSV and the effort file`. Replace them, from the first `  it(` of that describe up to (not including) `  it('is idempotent — a second init changes nothing and says so', () => {`, with:

  ```ts
    // Plan 3a Task 2 (operator ruling Z3, D-3706): a codex registry is CREATED
    // on an `exec.kind: "codex"` row only, so the two creation cases run on one.
    // Their claims are unchanged, read off the `SEEDED` fixture rather than
    // retyped; the first also binds the bytes every planted registry carries.
    const CODEX_ROW = {
      id: 'codex-a', label: 'codex-a', configDirSuffix: '.claude-codex-a',
      exec: { kind: 'codex', provider: 'openai', proxyPort: 45010, litellmPort: 45011, authDir: codexAuthDir('codex-a') },
      homeAble: false, telemetry: 'codex',
    };

    it('seeds today\'s codex registry, byte for byte, on a codex-kind lane', () => {
      seed({ ...ROSTER, accounts: [...ROSTER.accounts, CODEX_ROW] });
      const r = op('init', '--file', rosterPath(), '--id', 'codex-a', '--probe', 'codex');
      expect(r.code).toBe(0);
      expect(r.body['created']).toBe(true);
      expect(registryOf('codex-a')).toEqual(SEEDED);
      // What `plantCodex` (above) and `ccrc-models.test.ts`' `seedCodex` write
      // for a lane whose registry predates the refusal: these same bytes.
      expect(fs.readFileSync(regPath('codex-a'), 'utf8')).toBe(SEEDED_REGISTRY_BYTES);
    });

    it('materialises on success: the env block, the three-column TSV and the effort file', () => {
      seed({ ...ROSTER, accounts: [...ROSTER.accounts, CODEX_ROW] });
      op('init', '--file', rosterPath(), '--id', 'codex-a', '--probe', 'codex');
      const { haiku, sonnet, opus } = SEEDED.classes;
      const s = settingsOf('.claude-codex-a');
      expect(s.env.ANTHROPIC_DEFAULT_FABLE_MODEL).toBe('ccrc-unavailable-fable');
      expect(s.env.ANTHROPIC_MODEL).toBe(opus);
      expect(s.env.CLAUDE_CODE_SUBAGENT_MODEL).toBe('sonnet');
      expect(fs.readFileSync(path.join(home, '.ccrc', 'models', 'codex-a.classes.tsv'), 'utf8'))
        .toBe(`haiku\t${haiku}\tassigned\nsonnet\t${sonnet}\tassigned\n`
          + `opus\t${opus}\tassigned\nfable\t\tunassigned\n`);
      expect(JSON.parse(fs.readFileSync(path.join(home, '.ccrc', 'models', 'codex-a.effort.json'), 'utf8')))
        .toEqual({ byModel: { [haiku!]: 'high', [sonnet!]: 'high', [opus!]: 'max' } });
    });

    // Z3's refusal, on every row that is not codex-kind. The live Codex lanes'
    // shape first (`ext-a`); `ext-b` drops its provider, and `gen-a` is the
    // other kind a registry can sit on. Together they say the gate is the row's
    // KIND, never its telemetry or its provider.
    it.each([
      ['ext-a', { exec: { kind: 'external', provider: 'openai' }, telemetry: 'codex' }],
      ['ext-b', { exec: { kind: 'external' }, telemetry: 'codex' }],
      ['gen-a', { exec: { kind: 'generated' }, telemetry: 'none' }],
    ])('refuses to CREATE a codex registry on %s, a row that is not exec.kind codex, by name, and writes nothing (Z3)', (id, shape) => {
      seed({ ...ROSTER, accounts: [...ROSTER.accounts,
        { id, label: id, configDirSuffix: `.claude-${id}`, homeAble: false, ...shape }] });
      writeCatalogue(id);
      const r = op('init', '--file', rosterPath(), '--id', id, '--probe', 'codex');
      expect(r.code).toBe(1);
      expect(r.body['error']).toBe('codex-registry-needs-codex-lane');
      expect(String(r.body['detail'])).toContain('Flip the lane to "codex" first (Plan 3b)');
      expect(String(r.body['detail'])).toContain('Nothing was written.');
      expect(r.stderr).toMatch(new RegExp(`^models-op: account "${id}" is not a codex-kind lane`, 'm'));
      for (const f of [`${id}.classes.json`, `${id}.classes.tsv`, `${id}.effort.json`]) {
        expect(fs.existsSync(path.join(home, '.ccrc', 'models', f)), f).toBe(false);
      }
      expect(fs.existsSync(path.join(home, `.claude-${id}`))).toBe(false);
    });

    it('every other probe kind is still created on an external row (Z3 refuses codex alone)', () => {
      const r = op('init', '--file', rosterPath(), '--id', 'router', '--probe', 'compatible',
        '--base-url', 'https://compatible.example.invalid');
      expect(r.code, r.stdout + r.stderr).toBe(0);
      expect(r.body['created']).toBe(true);
      expect(registryOf('router')['probe']).toBe('compatible');
    });

  ```

  (e) `server/test/ccrc-models.test.ts`:
  - **Imports.** Replace `import { CODEX } from './fixtures/modelCases.js';` (unique) with `import { CODEX, SEEDED, SEEDED_REGISTRY_BYTES } from './fixtures/modelCases.js';`. When this step defines `codexRow` (below), widen the one `from './codexLaneFixture.js'` import in place with `codexAuthDir`, unless Task 1 already added it.
  - **`describe('the models harness containment wall', () => {`**: directly below the closing `  });` of its only case (that case ends with `    expect(body.indexOf('assertManagerStandIns(e, h);')).toBeLessThan(body.indexOf('return e;'));`, unique), add the case below. It stays red until Step 4(d) changes `env()`:

  ```ts

    it('drops an inherited CCGPT_CONFIG, and poisons pgrep and ccgpt wherever a case planted no stand-in of its own (Plan 3a Task 2)', () => {
      // `command -v` and file reads only: nothing here EXECUTES either name, so a
      // mutation that deletes a poison reds this case without ever reaching a
      // real `ccgpt` that a runner's PATH might carry.
      const was = process.env['CCGPT_CONFIG'];
      process.env['CCGPT_CONFIG'] = join(home, 'a-config-no-case-made.yaml');
      try {
        for (const name of ['pgrep', 'ccgpt']) fs.rmSync(join(home, '.local', 'bin', name), { force: true });
        const e = env(home);
        expect(e['CCGPT_CONFIG'] === undefined, 'an inherited CCGPT_CONFIG reached a case').toBe(true);
        expect(env(home, { CCGPT_CONFIG: 'from-extra' })['CCGPT_CONFIG'], 'a case still passes one in extra').toBe('from-extra');
        for (const name of ['pgrep', 'ccgpt']) {
          const at = spawnSync('/bin/sh', ['-c', `command -v ${name}`], { env: e, encoding: 'utf8' }).stdout.trim();
          expect(at, name).toBe(join(home, '.local', 'bin', name));
          expect(fs.readFileSync(at, 'utf8'), name).toContain(MANAGER_STANDIN_MARK);
        }
        // A case's own stand-in, written before a run, survives that run's env().
        const own = '#!/bin/sh\nexit 0\n';
        fs.writeFileSync(join(home, '.local', 'bin', 'ccgpt'), own, { mode: 0o755 });
        env(home);
        expect(fs.readFileSync(join(home, '.local', 'bin', 'ccgpt'), 'utf8'), 'env() overwrote a case\'s own ccgpt').toBe(own);
      } finally {
        if (was === undefined) delete process.env['CCGPT_CONFIG']; else process.env['CCGPT_CONFIG'] = was;
      }
    });
  ```

  - **Module helpers**, directly below `function boxWithStubOp(`'s closing `}`. Task 1 left `codexRow` there, and no external row. `grep -n -E '^const (codexRow|EXT_A_ROW|LEGACY_EXTERNAL_ID) = ' server/test/ccrc-models.test.ts` must find each name at most once: on Task 1 as written, `codexRow` once and the other two not at all. Add only the ones it does not find, exactly as follows.

  ```ts

  /** One `exec.kind: "codex"` roster row, its authDir the fixture's. */
  const codexRow = (id: string, proxyPort: number, litellmPort: number,
    extraExec: Record<string, unknown> = {}): Record<string, unknown> => ({
    id, label: id, configDirSuffix: `.claude-${id}`,
    exec: { kind: 'codex', provider: 'openai', proxyPort, litellmPort, authDir: codexAuthDir(id), ...extraExec },
    homeAble: false, telemetry: 'codex',
  });

  /** An EXTERNAL lane in the live Codex lanes' SHAPE (exec.kind "external",
   *  provider openai, telemetry "codex"), under a fixture id. */
  const EXT_A_ROW = {
    id: 'ext-a', label: 'ext-a', configDirSuffix: '.claude-ext-a',
    exec: { kind: 'external', provider: 'openai' }, homeAble: false, telemetry: 'codex',
  } as const;

  /** ROSTER's external row that the external-arm and refresh cases were
   *  written against, read by position rather than spelled, so no added line
   *  names a roster id outside Plan 3a's fixture vocabulary (ruling R13). */
  const LEGACY_EXTERNAL_ID = ROSTER.accounts[2]!.id;
  ```

  Then, always:

  ```ts

  /** ROSTER's other external row, the one that carries `exec.secretsFile`,
   *  read by position for the same reason as `LEGACY_EXTERNAL_ID`. */
  const LEGACY_SECRETS_EXTERNAL_ID = ROSTER.accounts[5]!.id;

  /** Plan 3a Task 2 (operator ruling Z3, D-3706): `ccrc models <id> init codex`
   *  no longer CREATES a codex registry on a row that is not exec.kind "codex",
   *  and this file's external rows are the live Codex lanes' kind before their
   *  flip. A case that needs such a row WITH a codex registry is the live
   *  shape, a registry that predates the refusal, which the refusal leaves
   *  untouched. So it is planted in `init codex`'s own bytes
   *  (`SEEDED_REGISTRY_BYTES`, bound to the op in `models-op.test.ts`), 0600,
   *  and the box's own `materialise` then writes what `init` writes after them. */
  function seedCodex(id: string): void {
    fs.mkdirSync(join(home, '.ccrc', 'models'), { recursive: true });
    fs.writeFileSync(join(home, '.ccrc', 'models', `${id}.classes.json`), SEEDED_REGISTRY_BYTES, { mode: 0o600 });
    const m = spawnSync(process.execPath, [join(home, 'ccrc', 'deploy', 'models-op.mjs'), 'materialise',
      '--file', join(home, '.ccrc', 'accounts.json'), '--id', id], { env: env(home), encoding: 'utf8' });
    expect(m.status, `${m.stdout}${m.stderr}`).toBe(0);
  }
  ```

  - **`describe('ccrc models <id> init', () => {`**: its first `it(`, `seeds the … registry and materialises, at exit 0`, creates a codex registry on `ROSTER.accounts[2]`. Replace it, from that describe's first `  it(` up to (not including) `  it('needs a probe kind', () => {`, with:

  ```ts
    // Plan 3a Task 2 (operator ruling Z3, D-3706): the verb CREATES a codex
    // registry on an `exec.kind: "codex"` row only. Its seeding claim moves to
    // one; the live Codex lanes' shape (`EXT_A_ROW`) is refused by name with
    // nothing written, and keeps a registry it already has.
    it('seeds a codex-kind lane\'s registry and materialises, at exit 0', () => {
      fs.rmSync(home, { recursive: true, force: true });
      home = box({ ...ROSTER, accounts: [...ROSTER.accounts, codexRow('codex-a', 45010, 45011)] });
      const r = run(['models', 'codex-a', 'init', 'codex']);
      expect(r.code).toBe(0);
      expect(oneObject(r)['created']).toBe(true);
      expect((registryOf('codex-a')['classes'] as Record<string, unknown>)['opus']).toBe(SEEDED.classes.opus);
      expect(registryOf('codex-a')['subagent']).toBe('sonnet');
      const settings = JSON.parse(fs.readFileSync(join(home, '.claude-codex-a', 'settings.json'), 'utf8'));
      expect(settings.env.ANTHROPIC_DEFAULT_FABLE_MODEL).toBe('ccrc-unavailable-fable');
    });

    it('refuses to CREATE a codex registry on an external lane, by name, and writes nothing (Z3)', () => {
      fs.rmSync(home, { recursive: true, force: true });
      home = box({ ...ROSTER, accounts: [...ROSTER.accounts, EXT_A_ROW] });
      writeCatalogue('ext-a');
      const r = run(['models', 'ext-a', 'init', 'codex']);
      expect(r.code).toBe(1);
      const b = oneObject(r);
      expect(b['error']).toBe('codex-registry-needs-codex-lane');
      expect(String(b['detail'])).toContain('Flip the lane to "codex" first (Plan 3b)');
      expect(r.stderr).toMatch(/^models-op: account "ext-a" is not a codex-kind lane/m);
      for (const f of ['ext-a.classes.json', 'ext-a.classes.tsv', 'ext-a.effort.json']) {
        expect(fs.existsSync(join(home, '.ccrc', 'models', f)), f).toBe(false);
      }
      expect(fs.existsSync(join(home, '.claude-ext-a'))).toBe(false);
    });

    it('an external lane whose codex registry predates this build keeps it: init answers created:false, byte for byte (Z3)', () => {
      fs.rmSync(home, { recursive: true, force: true });
      home = box({ ...ROSTER, accounts: [...ROSTER.accounts, EXT_A_ROW] });
      seedCodex('ext-a');
      const p = join(home, '.ccrc', 'models', 'ext-a.classes.json');
      const before = fs.readFileSync(p, 'utf8');
      const r = run(['models', 'ext-a', 'init', 'codex']);
      expect(r.code, r.stderr).toBe(0);
      expect(oneObject(r)['created']).toBe(false);
      expect(fs.readFileSync(p, 'utf8')).toBe(before);
    });

  ```

  - **`describe('ccrc models litellm', () => {`**: directly below the closing `  });` of its case `the external arm still honours CCGPT_CONFIG — the other repository's override of that one path` (that case ends with ``expect(calls('pgrep')).toEqual([`-f litellm .*${elsewhere}`]);``, unique), and above `  it('needs an id', () => {`, add:

  ```ts

    // Plan 3a Task 2 (operator ruling Z4, D-3753).
    // Once ANY roster row is codex-kind (lane A, after its flip), this arm's
    // bare `ccgpt stop` could stop lane A's own tiers, which carry the unit
    // names that stop uses. So for a still-external lane B with a registry, the
    // arm refuses the stop, through its own restart-failed path, and writes
    // nothing. Lane B is `ext-a` in the live Codex lanes' shape, lane A
    // `codex-a`. Pure-parse ports: nothing in this describe connects to one.
    describe('once a codex-kind lane exists, the bare stop is never run (Z4)', () => {
      const flip = (): void => {
        const p = join(home, '.ccrc', 'accounts.json');
        const roster = JSON.parse(fs.readFileSync(p, 'utf8')) as { accounts: unknown[] };
        roster.accounts.push(codexRow('codex-a', 45010, 45011));
        fs.writeFileSync(p, `${JSON.stringify(roster, null, 2)}\n`);
      };

      beforeEach(() => {
        fs.rmSync(home, { recursive: true, force: true });
        home = box({ ...ROSTER, accounts: [...ROSTER.accounts, EXT_A_ROW] });
        pgrep(false); ccgpt();
        writeCatalogue('ext-a');
        seedCodex('ext-a');
      });

      it('on today\'s shape (no codex-kind row) the bare stop still runs, byte for byte (Z1)', () => {
        pgrep(true);
        const r = run(['models', 'litellm', 'ext-a']);
        expect(r.code, r.stderr).toBe(0);
        expect(oneObject(r)['restarted']).toBe(true);
        expect(calls('ccgpt')).toEqual(['stop']);
        expect(fs.existsSync(configPath())).toBe(true);
      });

      it('after a flip, a running proxy on a changed render is REFUSED restart-failed, naming why: nothing stopped, nothing written', () => {
        flip(); pgrep(true);
        const r = run(['models', 'litellm', 'ext-a']);
        expect(r.code).toBe(1);
        const b = oneObject(r);
        expect(b['error']).toBe('restart-failed');
        expect(String(b['detail'])).toContain('the roster names codex-kind lane(s) codex-a');
        expect(String(b['detail'])).toContain('Nothing was written and nothing was stopped.');
        expect(String(b['detail'])).not.toContain("Run 'ccgpt stop' by hand");
        expect(r.stderr).toMatch(/^ccrc: the LiteLLM proxy is running on the PREVIOUS config, and ccrc will not stop it/m);
        expect(calls('ccgpt')).toEqual([]);
        expect(fs.existsSync(configPath())).toBe(false);
        expect(fs.existsSync(`${configPath()}.prev`)).toBe(false);
      });

      it('after a flip, with nothing running, the render lands exactly as before: the guard binds the stop alone', () => {
        flip();
        const r = run(['models', 'litellm', 'ext-a']);
        expect(r.code, r.stderr).toBe(0);
        expect(oneObject(r)['changed']).toBe(true);
        expect(oneObject(r)['restarted']).toBe(false);
        expect(fs.existsSync(configPath())).toBe(true);
        expect(calls('ccgpt')).toEqual([]);
      });

      it('after a flip, an unchanged render asks nothing, even with a proxy running', () => {
        expect(run(['models', 'litellm', 'ext-a']).code).toBe(0);
        flip(); pgrep(true);
        const r = run(['models', 'litellm', 'ext-a']);
        expect(r.code, r.stderr).toBe(0);
        expect(oneObject(r)['changed']).toBe(false);
        expect(calls('ccgpt')).toEqual([]);
      });

      it('a roster whose codex lanes cannot be told refuses the stop too: undecidable is never "no codex lane"', () => {
        pgrep(true);
        const r = sourced('_codex_lanes() { return 1; }; cmd_models litellm ext-a', []);
        expect(r.code).toBe(1);
        const b = oneObject(r);
        expect(b['error']).toBe('restart-failed');
        expect(String(b['detail'])).toContain('which roster lanes are codex-kind cannot be read (the lane library answered rc 1)');
        expect(calls('ccgpt')).toEqual([]);
        expect(fs.existsSync(configPath())).toBe(false);
      });

      it('the hourly refresh carries the refusal as a FAILED row, exits 1, and still stops nothing', () => {
        flip(); pgrep(true);
        const r = run(['models', 'refresh', '--all'], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
        expect(r.code).toBe(1);
        const rows = oneObject(r)['refreshed'] as { id: string; ok: boolean; reason?: string }[];
        const lane = rows.find((x) => x.id === 'ext-a');
        expect(lane?.ok).toBe(false);
        expect(String(lane?.reason)).toContain('the roster names codex-kind lane(s) codex-a');
        expect(calls('ccgpt')).toEqual([]);
        expect(fs.existsSync(configPath())).toBe(false);
      });
    });
  ```

  (f) **The mechanical migration**, as ONE call, after (a)-(e). Every SETUP statement that runs `init codex` on a row that is not codex-kind becomes a planted registry. The two external ROSTER rows' ids are read off each file's own ROSTER by position, never typed into this plan or the tree (R13), and the script prints only counts:

  ```bash
  . "<abs scratch>/plan3a-env.sh"
  node - <<'EOF'
  // Plan 3a Task 2, Step 1(f): the mechanical migration. Every SETUP `init
  // codex` on a row that is not codex-kind becomes a planted registry. The ids
  // of the tree's own external ROSTER rows are read off each file's ROSTER by
  // position, never typed (R13), and only counts are printed.
  const fs = require('node:fs');
  const rosterIds = (src) => {
    const at = src.indexOf('const ROSTER = {');
    const block = src.slice(at, src.indexOf('\n};\n', at));
    return [...block.matchAll(/\{ id: '([a-z][a-z0-9-]*)'/g)].map((m) => m[1]);
  };
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const migrate = (file, rules) => {
    let src = fs.readFileSync(file, 'utf8');
    for (const [re, to, label] of rules) {
      console.log(`${file}: ${label}: ${(src.match(re) ?? []).length}`);
      src = src.replace(re, to);
    }
    fs.writeFileSync(file, src);
  };
  const cm = 'server/test/ccrc-models.test.ts';
  const [, , ext, , , secrets] = rosterIds(fs.readFileSync(cm, 'utf8'));
  migrate(cm, [
    [new RegExp(`^(\\s*)run\\(\\['models', (?:'${esc(ext)}'|LEGACY_EXTERNAL_ID), 'init', 'codex'\\]\\);$`, 'gm'),
      '$1seedCodex(LEGACY_EXTERNAL_ID);', 'ROSTER[2] statements'],
    [new RegExp(`^(\\s*)run\\(\\['models', (?:'${esc(secrets)}'|LEGACY_SECRETS_EXTERNAL_ID), 'init', 'codex'\\]\\);$`, 'gm'),
      '$1seedCodex(LEGACY_SECRETS_EXTERNAL_ID);', 'ROSTER[5] statements'],
    [/^(\s*)expect\(run\(\['models', 'router2', 'init', 'codex'\]\)\.code\)\.toBe\(0\);$/gm,
      "$1seedCodex('router2');", 'router2 expects'],
  ]);
  const mop = 'server/test/models-op.test.ts';
  const [, , opExt] = rosterIds(fs.readFileSync(mop, 'utf8'));
  migrate(mop, [
    [new RegExp(`^(\\s*)op\\('init', '--file', rosterPath\\(\\), '--id', '${esc(opExt)}', '--probe', 'codex'\\);$`, 'gm'),
      '$1plantCodex(LEGACY_EXTERNAL_ID);', 'ROSTER[2] statements'],
    [/^(\s*)op\('init', '--file', rosterPath\(\), '--id', '(router|codex-b)', '--probe', 'codex'\);$/gm,
      "$1plantCodex('$2');", 'router and codex-b statements'],
    [new RegExp(`^(  beforeEach\\(\\(\\) => \\{ )op\\('init', '--file', rosterPath\\(\\), '--id', '${esc(opExt)}', '--probe', 'codex'\\);( \\}\\);)$`, 'gm'),
      '$1plantCodex(LEGACY_EXTERNAL_ID);$2', 'the beforeEach one-liner'],
  ]);
  EOF
  ```

  Measured at `4ec8926a`, before Task 1:
  - `ccrc-models.test.ts`: 21 `ROSTER[2]` statements, 1 `ROSTER[5]` statement and 3 `router2` expects;
  - `models-op.test.ts`: 23 `ROSTER[2]` statements, 3 `router` and `codex-b` statements (both external rows there), and 1 `beforeEach` one-liner.

  Task 1's own cases may move these counts, so re-derive them. Then the first and third counts must answer 0, and the second answers 1 on top of Task 1 as written: its two-lane case's `init codex` loop over `codex-a` and `codex-b`, both codex-kind rows, which stays unmigrated:

  ```bash
  . "<abs scratch>/plan3a-env.sh"
  grep -cE "^\s*run\(\['models', '[^']+', 'init', 'codex'\]\);$" server/test/ccrc-models.test.ts
  grep -E "init', 'codex'\]\)\.code\)\.toBe\(0\);$" server/test/ccrc-models.test.ts | grep -vc "'codex-a'"
  grep -E "^\s*op\('init', '--file', rosterPath\(\), '--id', '[^']+', '--probe', 'codex'\)" server/test/models-op.test.ts | grep -vc "'codex-a'"
  ```

  Any other non-zero count is an `init codex` setup the script did not reach: one Task 1 added, or a spelling it changed. Migrate it by the same rule, by hand. If its row is an external fixture row such as `ext-a`, use `seedCodex('<that id>')` or `plantCodex('<that id>')`. Report it by file and count, never by quoting a line that might carry a ROSTER id.

- [ ] **Step 2: Run it red.** Foreground, one call each, timeout at least 600000 ms:

  ```bash
  . "<abs scratch>/plan3a-env.sh"
  cd server
  r11 t2-red ./node_modules/.bin/vitest run test/ccrc-models.test.ts test/models-op.test.ts
  ```

  Expected: exactly **8 red**. vitest exits 1, and the census line still reads `census: clean — … command exit 1`, because the red is the command's own exit code and the census verdict is separate (F10). Measured on a scratch copy of `4ec8926a`, without Task 1:
  - `models-op`: the three `refuses to CREATE a codex registry on <id>…` rows (`ext-a`, `ext-b`, `gen-a`), each `expected +0 to be 1`, because today's op creates the registry;
  - `ccrc-models`, `refuses to CREATE a codex registry on an external lane…`: `expected +0 to be 1`;
  - `ccrc-models`, three Z4 cases, each `expected +0 to be 1` because today's arm runs the bare stop:
    - `after a flip, a running proxy on a changed render is REFUSED…`;
    - `a roster whose codex lanes cannot be told refuses the stop too…`;
    - `the hourly refresh carries the refusal as a FAILED row…`.
  - `ccrc-models`, `drops an inherited CCGPT_CONFIG, and poisons pgrep and ccgpt…`: `an inherited CCGPT_CONFIG reached a case: expected false to be true`, because today's `env()` inherits it. Measured: 1 failed in `-t 'the models harness containment wall'` on the same copy, before Step 4(d).

  GREEN before the change, by design:
  - **Every migrated case.** The planted registry is exactly the one `init` would have written.
  - **The re-aimed creation cases**, which now run on a codex-kind row.
  - **`an external lane whose codex registry predates this build keeps it…`.** An existing registry was always answered `created: false`.
  - **`every other probe kind is still created on an external row…`.**
  - **The three Z4 controls:** today's shape, nothing running, and an unchanged render.

  Their reds are mutation rows 2, 5, 9, 11, 12, 13 and 14, and the migration control. The counts are Step 0's plus 9 (`ccrc-models`: one case replaced by three, six added in the litellm describe, and one containment case) and plus 4 (`models-op`: two re-aimed, and four added).

- [ ] **Step 3: Z3 — the op creates a codex registry on a codex-kind lane only (`deploy/models-op.mjs`).** Old (unique):

  ```js
        out({ ok: true, op: 'init', created: false, ...describe(account, registry, catalogue) });
        return 0;
      }
      const seed = JSON.parse(JSON.stringify(SEEDS[a.probe]));
  ```

  New:

  ```js
        out({ ok: true, op: 'init', created: false, ...describe(account, registry, catalogue) });
        return 0;
      }
      // A CODEX REGISTRY IS CREATED ON A CODEX-KIND LANE ONLY (Plan 3a Task 2,
      // operator ruling Z3, D-3706). The model probe reads a codex-kind lane's
      // own `exec.authDir`. Every other row declares none, and an `external`
      // row's probe keeps the token-directory default until that lane's flip
      // (ruling Z1): a directory that belongs to one particular lane. So a codex
      // registry created here would put the hourly refresh one run away from
      // probing this lane with another lane's OAuth. This branch is the ONE
      // place a registry is created (`writeRegistry`'s other caller rewrites one
      // that already exists), so the refusal covers `ccrc models <id> init
      // codex` and every other caller of this op alike. A registry that ALREADY
      // exists is untouched: the arm above answers it first, and the mutating
      // ops below still rewrite it, so a lane that gained one before this build
      // keeps it and keeps being refreshed. Every other probe kind is created on
      // any row, as before.
      if (a.probe === 'codex' && !(isObj(account.exec) && account.exec.kind === 'codex')) {
        const kind = isObj(account.exec) && typeof account.exec.kind === 'string' ? account.exec.kind : null;
        return refuse(1, 'codex-registry-needs-codex-lane',
          `account "${a.id}" is not a codex-kind lane (its exec.kind is ${JSON.stringify(kind)}), and only `
          + 'a codex-kind lane declares the authDir its probe must read, so a codex class registry here '
          + 'would be probed through a token directory that is not this lane\'s. Flip the lane to "codex" '
          + `first (Plan 3b), then re-run 'ccrc models ${a.id} init codex'. Nothing was written.`);
      }
      const seed = JSON.parse(JSON.stringify(SEEDS[a.probe]));
  ```

- [ ] **Step 4: Z4 — the external arm never runs the bare stop once a codex-kind lane exists (`ccd/ccrc`).**

  (a) Old (unique):

  ```bash
  _models_litellm_running() { pgrep -f "litellm .*$(_models_litellm_path)" >/dev/null 2>&1; }
  ```

  New:

  ```bash
  _models_litellm_running() { pgrep -f "litellm .*$(_models_litellm_path)" >/dev/null 2>&1; }

  # THE BARE STOP'S PRECONDITION (Plan 3a Task 2, operator ruling Z4,
  # D-3753). The external arm's only stop is
  # another repository's bare `ccgpt stop`, which stops units BY NAME, and a
  # codex-kind lane's own tiers carry those names (`ccgpt-<id>-{litellm,shim}
  # .service`, spec §19.2). With no codex-kind row on the roster, today's shape,
  # that stop can reach only that repository's own units: rc 1, nothing printed,
  # and the arm runs exactly as before. Once ANY row is codex-kind, ccrc cannot
  # tell whose units that stop would name: rc 0, the reason as one clause on
  # stdout, and the arm refuses before it writes. A roster whose codex lanes
  # cannot be told (`_codex_lanes` rc 1 or rc 2) answers rc 0 too, because
  # undecidable is never "no codex lane". Asked of `_codex_lanes`, the lane
  # library's ONE reader of exec.kind.
  _models_litellm_stop_blocked() {   # -> rc 0 and one clause on stdout iff the external arm must not run the bare stop
    local ids rc=0
    ids="$(_codex_lanes 2>/dev/null)" || rc=$?
    if [ "$rc" -ne 0 ]; then
      printf 'which roster lanes are codex-kind cannot be read (the lane library answered rc %s)' "$rc"
      return 0
    fi
    [ -n "$ids" ] || return 1
    printf 'the roster names codex-kind lane(s) %s' "${ids//$'\n'/, }"
    return 0
  }
  ```

  (b) In `_models_litellm`'s header, old (unique):

  ```bash
    # Everything below is the EXTERNAL arm, unchanged byte for byte
    # (D-3482): the live lanes are external, and another
    # repository's LiteLLM reads that arm's file. Plan 3 retires it at cutover.
  ```

  New:

  ```bash
    # Everything below is the EXTERNAL arm, unchanged byte for byte
    # (D-3482) but for one guard (Plan 3a Task 2,
    # D-3753): its bare stop is refused
    # once any roster row is codex-kind. The live lanes are external, and another
    # repository's LiteLLM reads that arm's file. Plan 3 retires it at cutover.
  ```

  (c) In its body, old (unique):

  ```bash
    local restarted=false
    if _models_litellm_running; then
      if command -v ccgpt >/dev/null 2>&1 && ccgpt stop >/dev/null 2>&1; then
  ```

  New:

  ```bash
    local restarted=false
    if _models_litellm_running; then
      # NEVER THE BARE STOP ONCE A CODEX-KIND LANE EXISTS (Plan 3a Task 2,
      # operator ruling Z4, D-3753). Refused
      # HERE, through this arm's own restart-failed path and before PHASE 2, so
      # nothing is written and the next run sees the same difference again.
      local blocked
      if blocked="$(_models_litellm_stop_blocked)"; then
        _models_refuse restart-failed 1 "the LiteLLM proxy is running on the PREVIOUS config, and ccrc will not stop it: $blocked, and the only stop this arm has is another repository's bare 'ccgpt stop', which stops units by name, the names a codex lane's own tiers carry. Stop that proxy by hand once you know which lane's units that stop would name, or flip lane $1 to codex (Plan 3b), then re-run this command — until then this box serves the old model list. Nothing was written and nothing was stopped."
      fi
      if command -v ccgpt >/dev/null 2>&1 && ccgpt stop >/dev/null 2>&1; then
  ```

  Nothing else in the arm moves: the box-global path, the `pgrep`, the bare stop, its own `restart-failed` sentence, and PHASE 2 keep their bytes.

  (d) **The harness's containment (`server/test/ccrc-models.test.ts`' `env()`).** Two edits, both inside that one function. Old (unique):

  ```ts
    for (const k of ['CCRC_CODEX_PROBE_S', 'CCRC_CODEX_READY_S']) delete inherited[k];
  ```

  New:

  ```ts
    // Plan 3a Task 2 (operator ruling Z1): nor is `CCGPT_CONFIG`, the other
    // repository's override of the external arm's box-global path, which that
    // arm still honours and a GPT-lane session can carry. Inherited, it would
    // aim a case's render and its `pgrep -f` at a real config.
    for (const k of ['CCRC_CODEX_PROBE_S', 'CCRC_CODEX_READY_S', 'CCGPT_CONFIG']) delete inherited[k];
  ```

  Old (unique):

  ```ts
    poison('launchctl', 'ccrc tests must never query this box\'s real launchd');
    assertManagerStandIns(e, h);
  ```

  New:

  ```ts
    poison('launchctl', 'ccrc tests must never query this box\'s real launchd');
    // Plan 3a Task 2 (operator ruling Z1): the external arm keeps its `pgrep -f`
    // and its bare `ccgpt stop`, and on the fleet box a real `ccgpt stop` stops
    // a live lane's units BY NAME, which the census cannot see. So a HOME that
    // holds no stand-in of its own gets a poison. Only then: the functional
    // stubs a describe writes before a run must survive that run's env().
    for (const name of ['pgrep', 'ccgpt']) {
      if (!fs.existsSync(join(h, '.local', 'bin', name))) poison(name, `ccrc tests must never reach a real ${name}`);
    }
    assertManagerStandIns(e, h);
  ```

  `extra` is still applied after the deletion, so `the external arm still honours CCGPT_CONFIG …` passes its own. `box()` calls `env(h)` once when it builds a HOME, so every HOME starts with both poisons, and a describe's stub overwrites them by its own `writeFileSync`.

- [ ] **Step 5: Run green, then the neighbours.** Foreground. Each block is ONE Bash call with a 600000 ms timeout (ruling F6):

  ```bash
  . "<abs scratch>/plan3a-env.sh"
  cd server
  r11 t2-green ./node_modules/.bin/vitest run test/ccrc-models.test.ts test/models-op.test.ts
  ```

  ```bash
  . "<abs scratch>/plan3a-env.sh"
  cd server
  r11 t2-neigh1 ./node_modules/.bin/vitest run test/single-definition.test.ts test/macos-platform.test.ts test/ccrc-cli.test.ts test/litellm-render.test.ts test/topology-clean.test.ts
  ```

  ```bash
  . "<abs scratch>/plan3a-env.sh"
  cd server
  r11 t2-neigh2 ./node_modules/.bin/vitest run test/session-hook.test.ts
  ```

  ```bash
  . "<abs scratch>/plan3a-env.sh"
  cd server
  r11 t2-neigh3 ./node_modules/.bin/vitest run test/ccgpt-usage.test.ts test/ccrc-codex-launcher.test.ts
  ```

  ```bash
  . "<abs scratch>/plan3a-env.sh"
  cd server
  r11 t2-neigh4-1 ./node_modules/.bin/vitest run test/ccrc-codex.test.ts -t 'the lane runs, in fixtures'
  ```

  ```bash
  . "<abs scratch>/plan3a-env.sh"
  cd server
  r11 t2-neigh4-2 ./node_modules/.bin/vitest run test/ccrc-codex.test.ts -t '^(?!.*the lane runs, in fixtures)'
  ```

  ```bash
  . "<abs scratch>/plan3a-env.sh"
  cd server
  r11 t2-neigh5 ./node_modules/.bin/vitest run test/ccrc-install.test.ts -t 'the codex runtime step on a real spine'
  ```

  ```bash
  . "<abs scratch>/plan3a-env.sh"
  cd server
  r11 t2-neigh6 ./node_modules/.bin/vitest run test/ccrc-uninstall.test.ts -t '_uninst_codex'
  ```

  ```bash
  . "<abs scratch>/plan3a-env.sh"
  cd server
  r11 t2-types ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
  ```

  Expected: all green, and each call ends `census: clean …`. Measured on a scratch copy of `4ec8926a` with this task applied and without Task 1:
  - `t2-green`: 157 and 110, Step 2's counts. The 157 was measured on the same copy with Step 4(d) applied: `Tests 267 passed (267)` for the two files together, census clean.
  - `t2-neigh1`, without `topology-clean`, which needs `git ls-files` and so runs only in the real tree: 394 passed, 11 skipped.
  - `session-hook`: 335/335. The compaction-card corpus cites `ccd/ccrc`, and this task adds 34 lines to that file, so the census was the risk; it did not move. If it reds here, apply S6-R11 in this commit: re-measure and dump. README carries no `ccd/ccrc` anchor. Never widen the rule.
  - `t2-neigh3`: 64 passed.
  - `ccrc-codex`. Every `init codex` there is on a codex-kind row, which the guard leaves alone. Run whole with the guard alone, it took 637 s, past the tool's cap, hence the two parts. 197 passed. 4 were red at `expected -1 to be +0`: a `spawnSync` that its own timeout killed under load, in `lifeBox`'s codex-kind `init`, and none of them names the refusal. So a red there is re-run in isolation before it counts (the known-load-flake rule).
  - `t2-neigh5`: 6 passed. `t2-neigh6`: 17 passed. Both `init codex` on codex-kind lanes only.
  - `typecheck-tests`: `server/test/ is clean under a tests-inclusive project` is green.

- [ ] **Step 6: Mutation table.**
  - First stage this task's five files, so that the index holds the green tree every restore is checked against (ruling F7). Then back up each file a row edits, one copy per file. Nothing is committed here:

    ```bash
    . "<abs scratch>/plan3a-env.sh"
    git add ccd/ccrc deploy/models-op.mjs server/test/fixtures/modelCases.ts \
      server/test/models-op.test.ts server/test/ccrc-models.test.ts
    mkdir -p "$SCRATCH/t2-mut"
    for f in ccd/ccrc deploy/models-op.mjs server/test/fixtures/modelCases.ts \
             server/test/models-op.test.ts server/test/ccrc-models.test.ts; do
      cp "$f" "$SCRATCH/t2-mut/$(basename "$f")"
    done
    ```

  - Then, for each row alone, apply the mutation and run its command as one call. Rows 1-5, 11 and 14-17 run both files whole. Rows 6-10, 12 and 13 touch only `ccd/ccrc`, which `models-op.test.ts` never runs, so they run the `ccrc-models` describes that reach the arm:

    ```bash
    . "<abs scratch>/plan3a-env.sh"
    cd server
    r11 t2-mut-<row> ./node_modules/.bin/vitest run test/ccrc-models.test.ts test/models-op.test.ts   # rows 1-5, 11, 14-17
    ```

    ```bash
    . "<abs scratch>/plan3a-env.sh"
    cd server
    r11 t2-mut-<row> ./node_modules/.bin/vitest run test/ccrc-models.test.ts -t 'ccrc models litellm|ccrc models refresh|ccrc models <id> init'   # rows 6-10, 12, 13
    ```

  - Record the red count. A red row is vitest's exit 1 under `census: clean — … command exit 1`, because the census verdict is separate (F10). Then restore every file, verify the restore, and re-run that row's command green, labelled `t2-mut-<row>-green`:

    ```bash
    . "<abs scratch>/plan3a-env.sh"
    for f in ccd/ccrc deploy/models-op.mjs server/test/fixtures/modelCases.ts \
             server/test/models-op.test.ts server/test/ccrc-models.test.ts; do
      cp "$SCRATCH/t2-mut/$(basename "$f")" "$f"
    done
    git diff --quiet -- ccd/ccrc deploy/models-op.mjs server/test/fixtures/modelCases.ts \
      server/test/models-op.test.ts server/test/ccrc-models.test.ts && echo restored
    ```

    Expected: `restored`.
  - The counts below were measured on a scratch copy of `4ec8926a` without Task 1; re-derive them. If a row does not red, report that. Never add code to force a bind.

  | # | Guard | Mutation | Goes red (measured) |
  |---|---|---|---|
  | 1 | Z3: a codex registry is created on a codex-kind lane only | delete the `if (a.probe === 'codex' && !(isObj(account.exec) && account.exec.kind === 'codex')) { … }` block (its comment may stay) | 4: the three `refuses to CREATE … on <id>` rows (`models-op`), and `refuses to CREATE … on an external lane` (`ccrc-models`) |
  | 2 | Z3 refuses the codex probe alone | drop `a.probe === 'codex' && ` from that condition | 35: 20 in `models-op` (every openrouter or compatible create on a row that is not codex-kind, `every other probe kind is still created…` among them) and 15 in `ccrc-models` |
  | 3 | keyed on "not codex-kind", never on `external` alone | the condition → `a.probe === 'codex' && isObj(account.exec) && account.exec.kind === 'external'` | 1: the `gen-a` row |
  | 4 | keyed on the kind, never on telemetry | the condition → `a.probe === 'codex' && account.telemetry !== 'codex'` | 3: the `ext-a` and `ext-b` rows, and `refuses to CREATE … on an external lane` |
  | 5 | a registry that already exists is untouched | move the whole block, comment and all, above `    if (registry !== null) {` | 2: `is idempotent — a second init changes nothing and says so` (`models-op`), and `an external lane whose codex registry predates this build keeps it…` (`ccrc-models`) |
  | 6 | Z4: never the bare stop once a codex-kind lane exists | delete the `local blocked` … `fi` block in `_models_litellm` (its comment may stay) | 3: `after a flip, a running proxy … REFUSED…`, `a roster whose codex lanes cannot be told…`, `the hourly refresh carries the refusal…` |
  | 7 | a codex-kind row blocks the stop | in `_models_litellm_stop_blocked`, `[ -n "$ids" ] \|\| return 1` → `return 1` | 2: `after a flip, a running proxy … REFUSED…`, `the hourly refresh carries the refusal…` |
  | 8 | undecidable blocks the stop | in its `if [ "$rc" -ne 0 ]` branch, `return 0` → `return 1` | 1: `a roster whose codex lanes cannot be told…` |
  | 9 | asked of exec.kind, never telemetry | `ids="$(_codex_lanes 2>/dev/null)" \|\| rc=$?` → `ids="$(jq -r '.accounts[] \| select(.telemetry == "codex") \| .id' "$(_models_roster_path)" 2>/dev/null)" \|\| rc=$?` | 4: `on today's shape (no codex-kind row) the bare stop still runs…`, `after a flip, a running proxy … REFUSED…`, `a roster whose codex lanes cannot be told…`, `the hourly refresh carries the refusal…` |
  | 10 | refused BEFORE the stop | move the `local blocked` … `fi` block below the arm's own `if command -v ccgpt …; fi`, still inside `if _models_litellm_running; then` | 3: the same three as row 6, each now finding `stop` in the `ccgpt` call log |
  | 11 | the planted bytes are `init codex`'s | `` `${JSON.stringify(SEEDED, null, 2)}\n` `` → `` `${JSON.stringify(SEEDED)}\n` `` in `SEEDED_REGISTRY_BYTES` | 2: `seeds today's codex registry, byte for byte, on a codex-kind lane`, and `keeps 2-space indent and a trailing newline` (both `models-op`) |
  | 12 | the guard binds the stop, never the render | move the `local blocked` … `fi` block, two spaces less indented, to just above `  if _models_litellm_running; then` | 1: `after a flip, with nothing running, the render lands exactly as before…` |
  | 13 | … nor an unchanged render | move it instead to just below the external arm's PHASE 1 refusal line, `[ "$crc" -eq 0 ] \|\| { printf '%s\n' "$check"; return "$crc"; }` (the one after the box-global `--out`) | 2: `… with nothing running …`, and `after a flip, an unchanged render asks nothing, even with a proxy running` |
  | 14 | Z3 refuses only a row that is not codex-kind | the condition → `a.probe === 'codex'` | 49: every create on a codex-kind row, 8 in `models-op` (the two re-aimed cases among them) and 41 in `ccrc-models` |
  | 15 | the harness never inherits `CCGPT_CONFIG` | drop `'CCGPT_CONFIG'` from `env()`'s `for (const k of […]) delete inherited[k];` list | 1: `drops an inherited CCGPT_CONFIG, and poisons pgrep and ccgpt…` |
  | 16 | the harness poisons `pgrep` and `ccgpt` | delete `env()`'s `for (const name of ['pgrep', 'ccgpt']) { … }` loop, all three lines | 1: the same case (`command -v` resolves past this HOME's `~/.local/bin`) |
  | 17 | … only where the HOME holds no stand-in | `if (!fs.existsSync(join(h, '.local', 'bin', name))) poison(name,` → `poison(name,` | 12: the same case, and every case whose functional `pgrep`/`ccgpt` stub must survive its run: 6 in `describe('ccrc models litellm')`, 4 in its nested Z4 describe, and `a lane whose restart fails is a FAILED row, and the run exits 1` |

  **The migration control.** Restore the two test files from the task base, keep the implementation, and run them:

  ```bash
  . "<abs scratch>/plan3a-env.sh"
  for f in server/test/models-op.test.ts server/test/ccrc-models.test.ts; do
    git show "$(cat "$SCRATCH/t2-base")":"$f" > "$f"
  done
  cd server
  r11 t2-mut-migration ./node_modules/.bin/vitest run test/ccrc-models.test.ts test/models-op.test.ts
  ```

  Measured with the guard alone at `4ec8926a`: 89 red, 50 in `models-op` and 39 in `ccrc-models`. Every one is a setup whose registry is no longer created. Then run the restore block above and re-run green. The number is Task 1's base plus the cases it added, so re-derive it. What matters is that it is non-zero and that Step 5's run is green.

  Rows 7, 8 and 9 edit the one helper, and their reds differ on purpose: each case names the clause it expects. Rows 12 and 13 are the only reds of the two render controls.

- [ ] **Step 7: Scope and residue check,** against this task's own base. Each diff compares the recorded base with the working tree, never `"$BASE" HEAD`: until Step 8 commits, HEAD is still the base. The working-tree form means the same before that commit and after it (ruling F3):

  ```bash
  . "<abs scratch>/plan3a-env.sh"
  BASE="$(cat "$SCRATCH/t2-base")"
  git diff --name-only "$BASE"
  # → ccd/ccrc, deploy/models-op.mjs, server/test/ccrc-models.test.ts,
  #   server/test/fixtures/modelCases.ts, server/test/models-op.test.ts
  git diff --quiet "$BASE" -- ccd/ccd ccd/ccgpt-runtime ccd/ccrc-models-probe deploy/systemd \
    shared/litellm.mjs deploy/litellm-config.template.yaml server/test/single-definition.test.ts && echo untouched
  # → untouched (no re-stamp, no runtime rebuild, the probe is Task 1's, no unit changes, and the external
  #   arm's renderer, template and one-holder pin are exactly as they were: ruling Z1)
  ids="$(jq -r '.accounts[] | select(.telemetry == "codex") | .id' "$HOME/.ccrc/accounts.json")"
  printf '%s\n' "$ids" | grep -c .
  # → 2: the box's two Codex-telemetry rows, read from its roster now, never from this plan, and never printed (F1, F4)
  printf '%s\n' "$ids" | while IFS= read -r id; do
    git diff "$BASE" | grep '^+' | sed 's/$/ /' | grep -cE "[^[:alnum:]_-]${id}[^[:alnum:]_-]"
  done
  # → 0, then 0: no added line names a live lane id (R13). Only counts print. The line is space-padded
  # rather than matched with an `(^|…)` alternation, which the harness's `grep` function (ugrep) silently
  # misses for some ids (measured in the fix round with the synthetic id `abc2`).
  ```

  Any other answer is a finding. Report it by file and count, never by quoting the line.

- [ ] **Step 8: Commit.**

  ```bash
  . "<abs scratch>/plan3a-env.sh"
  git add ccd/ccrc deploy/models-op.mjs server/test/fixtures/modelCases.ts \
    server/test/models-op.test.ts server/test/ccrc-models.test.ts
  git commit -F - <<'EOF'
  fix(models): no codex registry on a lane that is not codex-kind, and no bare stop once one is

  `ccrc models <id> init codex` now refuses, by name and writing nothing,
  to create a codex class registry on a roster row whose exec.kind is not
  "codex": such a lane declares no authDir, so its probe would read another
  lane's token directory. A registry that already exists is untouched, and
  every other probe kind is created as before. The external LiteLLM arm
  keeps its box-global path, its pgrep and its bare stop, but once any
  roster row is codex-kind (or the roster's codex lanes cannot be read) it
  refuses that stop as restart-failed before writing, because the stop
  names units a codex lane's tiers share. On a roster with no codex row
  nothing changes. The suites plant the live shape's pre-existing registry
  in init's own bytes instead of creating it, and the models suite's
  harness no longer inherits CCGPT_CONFIG and poisons pgrep and ccgpt
  wherever a case planted no stand-in.

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git log -1 --format='%an <%ae> | %cn <%ce>'   # → the worktree's noreply identity only (the commit-identity rule)
  ```

**What this task deliberately does NOT do** (reject any of these as scope creep):
- **Retire the external arm.** Its path, `pgrep` and bare stop stay for an `external` lane until that lane's flip (Z1). D-3708 is withdrawn, and Plan 4's ccrc half deletes the arm (Z8).
- **Freeze anything.** There is no skipped row, no frozen catalogue, no `_check_models` sentence, and no rollback asymmetry. Ruling Z removed every R-C2 consequence.
- **The refresh loop, the probe, or `_models_run_probe`.** Those are Task 1's. This task edits no line of `_models_box_sub`.
- **Delete, rewrite or migrate a registry that exists.** The live lane's registry stays exactly as it is (Z3).
- **The `show` summary's remedy line** (`ccd/ccrc:9382`, "Run: ccrc models <id> init <codex|openrouter|compatible>"). For an external lane with no registry, its `codex` word now meets the refusal, and that refusal names the remedy. Re-wording the summary is not needed for safety.
- **Anything of the other repository's.** This task writes, moves and deletes no file under `~/.handoff`, no `~/.local/bin/ccgpt*` and no `ccgpt-*` unit, and it stops nothing.
- **The spec.** Task 11 appends §20 and makes the same-line pointer edit (R9). This task produces the text.

**Hazards a later task must respect:**
1. **After lane A's flip, a still-external lane B can fail every hourly refresh.** This happens when lane B has a codex registry, a proxy is running on the box-global config, and lane B's render changes. The refresh then fails with `restart-failed` (exit 1, so `ccrc-models.service` fails) until the operator acts. That is loud by design.
   - Whether it can fire depends on which proxy holds the box-global config when the first flip lands, and the drafting census did not measure that. Flipping the lane with the registry first moves that lane to the codex arm, so the case cannot arise.
   - Before the first flip, Plan 3b measures `pgrep`'s answer read-only. Its runbook names the case and its remedy.
2. **`init codex` needs the flip first.** The live lane without a registry gains one only after its row is `exec.kind: "codex"`, so Plan 3b orders the flip before the `init`. A deliberate `ccrc models <id> rm` of the live lane's registry before its flip makes that registry uncreatable until the flip.
3. **A fixture that needs an external lane with a codex registry plants it by file, never through `init codex`.** In these two suites that is `plantCodex` and `seedCodex`: `SEEDED_REGISTRY_BYTES`, then the op's `materialise`. A later task writes its own registry literal where it needs other bytes or no derived files, as Task 4's `lane: null` case and Task 10's `REHEARSAL_REGISTRY` do. That holds for Tasks 4-10 and every later suite. A change to `SEEDS.codex` reds `seeds today's codex registry, byte for byte` first; update `SEEDED` in the same commit.
4. **`restart-failed` now has two causes,** a failed stop and a refused one. Only the detail tells them apart, and the refresh row's `reason` carries it. A caller that keys on the code alone cannot tell them apart.
5. **Plan 2b-2 Task 6's mutation rows 2, 5 and 20 keep their subject,** because the arm is not retired. Task 11's count table records them as before.

### Task 3: The settings-env drift check compares a codex lane against its loopback shim

> Resolved by ruling R5 (R-C7):
> - For a codex lane the rule is **absent or equal**: `settings.json`'s env block may omit `ANTHROPIC_BASE_URL`, or name exactly `http://127.0.0.1:<proxyPort>`.
> - Present and different is `settings-env-drift`, a WARN. Carry-forward 8's "compare against the loopback URL" becomes this rule (D-3709).
> - The external rows are judged exactly as today, which is inert on the live shape.

**Files:**
- Modify: `deploy/account-op.mjs`:
  - `effectiveBaseUrl`'s docstring and body (:1020-1035) gain a codex arm first. Locate with `grep -n '^function effectiveBaseUrl' deploy/account-op.mjs`;
  - `opDoctor`'s env comparison (:1087-1101) gets the absent-or-equal rule and a codex sentence. Locate with `grep -n '^function opDoctor' deploy/account-op.mjs`.
  - **Untouched:**
    - the `lane` op's ternary (:1995);
    - `effectiveBaseUrl`'s own ternary (:1032), whose `codex` term is now unreachable there but stays, so the two ternaries are still one spelling;
    - `PROVIDER_BASE_URL` (:124-129), whose `openai: null` mirrors `shared/providers.ts`.
- Modify: `server/test/ccrc-doctor.test.ts`, inside `describe('ccrc doctor: accounts')` (:8280-8460): one describe-local helper and six cases, inserted directly above `it('spells the vocabulary that shared/providers.ts defines, and no other code', …)`.
- Run, unchanged: `server/test/ccrc-account.test.ts`' `the deploy mirror agrees with shared/providers.ts, column by column` (:356-386). `PROVIDER_BASE_URL.openai` stays null.

**Interfaces:**
- **Consumes:**
  - the codex ExecSpec (Plan 1): `exec.kind: "codex"` and an integer `exec.proxyPort`;
  - the launcher's export `export ANTHROPIC_BASE_URL="http://127.0.0.1:$cx_port"` (`ccd/ccrc-codex:177`), whose value `ccrc-codex-launcher.test.ts:360` pins as `http://127.0.0.1:${lane.proxyPort}`. That test is the other half of this task's agreement;
  - `MODEL_ENV_KEYS` (`shared/modelenv.mjs:55-64`), which lacks the key;
  - `_check_accounts` (`ccd/ccrc-doctor-checks:3072`), unchanged. It reads the helper's `COUNTS` and finding lines;
  - doctor test helpers: `healthy`, `writeRoster`, `writeWrapper` (never `healthyCodexBox`, which Task 4 rewrites into an async lane on free ports: these cases build `codexAccountsBox`, the base fixture's shape, on the pure-parse pair 45010/45011), `writeSettingsEnv` (:7490), `lineFor`, `doctorEnv`, `shq`, `BASH` and `Result`;
  - `r11`, defined in `$SCRATCH/plan3a-env.sh`, which every block below that uses it, `$SCRATCH` or `$BASE` sources first (ruling F2).
- **Produces:**
  - `effectiveBaseUrl(exec)`: for `exec.kind === 'codex'` it answers `http://127.0.0.1:${exec.proxyPort}` when `proxyPort` is an integer in 1..65535, and `null` otherwise. It is unchanged for every other kind.
  - `opDoctor`, for a codex row whose `settings.json` exists:
    - the row is counted in `COUNTS`' env field;
    - no finding when the env block is absent, unparseable or has no `ANTHROPIC_BASE_URL` key, or when the key equals the loopback URL;
    - otherwise `settings-env-drift\t<id>\t<suffix>/settings.json sets ANTHROPIC_BASE_URL to <value>, and this codex lane's endpoint is its loopback shim http://127.0.0.1:<port>, which its launcher exports — whichever of the two Claude Code honours, one of them is wrong. No ccrc writer puts that key there: delete it from the env block by hand`.
  - `accountsOnly(home)`, describe-local in `describe('ccrc doctor: accounts')`: `_check_accounts` alone, sourced from the fixture's own `ccd/ccrc-doctor-checks`. Also `codexAccountsBox(prefix)`, describe-local too: `healthy()` plus one codex row on the pure-parse pair and its launcher.
  - For Task 11's §20: "A codex lane's `settings.json` env block may omit `ANTHROPIC_BASE_URL` or name exactly `http://127.0.0.1:<exec.proxyPort>`; any other value is `settings-env-drift` (WARN), naming both (Plan 3a Task 3, D-3709)."

**Why:**

*Today the check compares nothing for a codex lane.*
- `effectiveBaseUrl` returns `exec.baseUrl`, else the provider's default. A codex row has no `baseUrl` (the parser refuses one on that kind), and `openai`'s default is `null` (`PROVIDER_BASE_URL.openai`, :128, mirrored from `shared/providers.ts:163`).
- So `opDoctor` skips every codex lane (`wants === null`, :1081). A codex lane whose `settings.json` pointed Claude Code somewhere else would pass every check (carry-forward 8).

*Why absent-or-equal, not equal.*
- No ccrc writer puts `ANTHROPIC_BASE_URL` into a codex lane's `settings.json`: `MODEL_ENV_KEYS` lacks it, and `mergeSettingsEnv` touches only those keys.
- The launcher exports the key in the process environment instead (`ccd/ccrc-codex:177`).
- The live lanes' env blocks carry model keys only, measured by key name with no value read. Requiring equality would WARN on every healthy lane forever, from the moment 3b flips one.
- A key that is present and different is a real hazard. Which of settings env and process env Claude Code honours is unmeasured (R-C7), so the finding names both values and judges neither.
- The remedy is in the finding itself, because `_check_accounts`' shared remedy line ("re-running the lane's provisioning, whose settings.json merge is idempotent") would not remove a key no provisioning writes.

*Why the codex arm is keyed on `exec.kind` alone.* The live Codex lanes are `external` rows with `provider: 'openai'` and codex telemetry. An arm keyed on the provider or on telemetry would start comparing them against a loopback URL their launcher does not export. Case 6 pins it, with a hand-edited `proxyPort` so that the wrong key would build a URL.

*Why a codex row with no usable port answers `null`.*
- The alternative, `http://127.0.0.1:undefined`, would put a sentence naming an endpoint nobody can build into a WARN.
- This check is not the roster's judge: the wrappers check is, and Task 4's `_check_codex` FAILs "ports invalid". So it measures nothing for that row, which case 5 pins.
- `null` already means "nothing to compare" to this caller. The condition is handled identically, so no distinction is narrowed.

*Why the cases run `_check_accounts` alone.* A whole `ccrc doctor` over a codex roster runs every check against it, and Task 4's `_check_codex` will connect to the lane's ports. The accounts check opens no socket. Run on its own, these cases cannot reach a port whatever order Tasks 3 and 4 land in, and 45010/45011/45020 remain the pure-parse vocabulary they are. The precedent for sourcing one check is `:2582`, `:2802` and `:5454`. Sourcing from the fixture's own `ccd/` makes `CCRC_HERE` the fixture tree, so `account-op.mjs` is the copy `installCcrc` planted from this worktree.

*Inert on the live shape.* No live row is codex-kind, and the two external rows still answer `null` (case 6). The merge changes no doctor line on either box. After each 3b flip, that lane's env block, which has no `ANTHROPIC_BASE_URL`, passes.

- [ ] **Step 0: Base.**

  ```bash
  . "<abs scratch>/plan3a-env.sh"
  git rev-parse HEAD > "$SCRATCH/t3-base"   # this task's base: Step 6 reads it back, never a shell variable (F2)
  cd server
  r11 t3-base ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'ccrc doctor: accounts'
  ```

  Expected: green, and the last line is `census: clean …`. Record the describe's case count: 10 at `1f9fa22d`.

- [ ] **Step 1: Write the failing tests.** In `server/test/ccrc-doctor.test.ts`, directly above `  it('spells the vocabulary that shared/providers.ts defines, and no other code', () => {` (unique), insert:

  ```ts
    // ── a codex lane (Plan 3a Task 3, R-C7) ─────────────────────────────────
    // `_check_accounts` ALONE, out of the fixture box's own tree: every case
    // below has a codex row in its roster, and a whole `ccrc doctor` would run
    // every other check against that row — including the codex check a later
    // task of this plan adds, which connects to a lane's ports. This check
    // opens no socket, so its cases run it on its own; 45010/45011/45020 are
    // the pure-parse port vocabulary of `codexAccountsBox`, below. Never Task
    // 4's `healthyCodexBox`, which becomes an async lane on FREE ports.
    // Sourced from the fixture's own `ccd/`, so `CCRC_HERE` is the fixture
    // tree and `account-op.mjs` is the copy `installCcrc` planted.
    const accountsOnly = (home: string): Result => {
      const r = spawnSync(BASH, ['-c',
        `set -uo pipefail; . ${shq(join(home, 'ccrc', 'ccd', 'ccrc-doctor-checks'))}; _check_accounts`],
        { env: doctorEnv(home), encoding: 'utf8' });
      return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    };
    const CODEX_DIR = '.claude-codex-a';
    /** A healthy box plus one codex lane on the pure-parse pair and its
     *  launcher: the base tree's `healthyCodexBox` shape, kept here so Task 4's
     *  rewrite of that fixture (async, free ports) cannot move these cases. */
    const codexAccountsBox = (prefix: string): string => {
      const home = healthy(prefix);
      writeRoster(home, [{
        id: 'codex-a', configDirSuffix: CODEX_DIR,
        exec: { kind: 'codex', provider: 'openai', proxyPort: 45010, litellmPort: 45011, authDir: '.local/share/ccrc/codex/codex-a' },
        telemetry: 'codex',
      }]);
      writeWrapper(home, 'codex-a', { cfgDir: CODEX_DIR, target: 'ccrc-codex' });
      return home;
    };

    it('a codex lane whose env block has no ANTHROPIC_BASE_URL passes, and is counted — its launcher exports the endpoint', () => {
      const home = codexAccountsBox('ccrc-doctor-accounts-codex-absent-');
      writeSettingsEnv(home, CODEX_DIR, { ANTHROPIC_MODEL: 'gpt-x' });
      const r = accountsOnly(home);
      const line = lineFor(r.stdout, 'accounts');
      expect(line, r.stdout).toMatch(/^PASS accounts: /);
      expect(line).toContain('1 provider env block');
      expect(r.code).toBe(0);
    });

    it('a codex lane whose settings.json has no env block at all passes too', () => {
      const home = codexAccountsBox('ccrc-doctor-accounts-codex-noblock-');
      mkdirSync(join(home, CODEX_DIR), { recursive: true });
      writeFileSync(join(home, CODEX_DIR, 'settings.json'), '{}\n');
      const r = accountsOnly(home);
      expect(lineFor(r.stdout, 'accounts'), r.stdout).toMatch(/^PASS accounts: /);
      expect(r.code).toBe(0);
    });

    it('a codex lane whose env names its own loopback shim passes', () => {
      const home = codexAccountsBox('ccrc-doctor-accounts-codex-equal-');
      writeSettingsEnv(home, CODEX_DIR, { ANTHROPIC_BASE_URL: 'http://127.0.0.1:45010' });
      const r = accountsOnly(home);
      const line = lineFor(r.stdout, 'accounts');
      expect(line, r.stdout).toMatch(/^PASS accounts: /);
      expect(line).toContain('1 provider env block');
    });

    it('a codex lane whose env names any other endpoint WARNS settings-env-drift, naming both and the hand remedy', () => {
      const home = codexAccountsBox('ccrc-doctor-accounts-codex-drift-');
      writeSettingsEnv(home, CODEX_DIR, { ANTHROPIC_BASE_URL: 'http://127.0.0.1:45020' });
      const r = accountsOnly(home);
      expect(r.code).toBe(2);
      const lines = r.stdout.split('\n');
      const i = lines.findIndex((l) => l.startsWith('WARN accounts: '));
      expect(i, r.stdout).toBeGreaterThan(-1);
      expect(lines[i]).toContain('settings-env-drift: codex-a');
      expect(lines[i]).toContain('http://127.0.0.1:45020');
      expect(lines[i]).toContain('loopback shim http://127.0.0.1:45010');
      expect(lines[i]).toContain('delete it from the env block by hand');
      expect(lines[i + 1]).toMatch(/^ {2}remedy: \S/);
    });

    it('a codex row with no usable proxyPort is not this check\'s to judge: no finding, and no endpoint invented', () => {
      const home = healthy('ccrc-doctor-accounts-codex-noport-');
      writeRoster(home, [{
        id: 'codex-a', configDirSuffix: CODEX_DIR,
        exec: { kind: 'codex', provider: 'openai', litellmPort: 45011, authDir: '.local/share/ccrc/codex/codex-a' },
        telemetry: 'codex',
      }]);
      writeSettingsEnv(home, CODEX_DIR, { ANTHROPIC_BASE_URL: 'http://127.0.0.1:45020' });
      const r = accountsOnly(home);
      expect(lineFor(r.stdout, 'accounts'), r.stdout).toMatch(/^PASS accounts: /);
      expect(r.stdout).not.toContain('undefined');
    });

    it('an external row in the live Codex lanes\' shape is judged exactly as before: the arm keys on exec.kind, never provider or telemetry', () => {
      // `ext-a` is a fixture id in the live shape (external, provider openai,
      // telemetry codex) — plus a hand-edited proxyPort the parser would refuse
      // on this kind, so an arm keyed on anything but `exec.kind` WOULD build a
      // loopback URL here and this case would see it.
      const home = healthy('ccrc-doctor-accounts-codex-external-');
      writeRoster(home, [{
        id: 'ext-a', configDirSuffix: '.claude-ext-a',
        exec: { kind: 'external', provider: 'openai', proxyPort: 45010 }, telemetry: 'codex',
      }]);
      writeSettingsEnv(home, '.claude-ext-a', { ANTHROPIC_BASE_URL: 'http://127.0.0.1:45020' });
      const r = accountsOnly(home);
      expect(lineFor(r.stdout, 'accounts'), r.stdout).toMatch(/^PASS accounts: /);
      expect(lineFor(r.stdout, 'accounts')).toContain('0 provider env block');
    });

  ```

- [ ] **Step 2: Run it red.**

  ```bash
  . "<abs scratch>/plan3a-env.sh"
  cd server
  r11 t3-red ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'ccrc doctor: accounts'
  ```

  Expected: **3 red**. vitest exits 1 under `census: clean — … command exit 1`, because the census verdict is separate (F10). Measured on a scratch copy:
  - the absent-key case: `expected 'PASS accounts: 2 account(s): 0 declar…' to contain '1 provider env block'`;
  - the loopback-equal case: the same message;
  - the drift case: `expected +0 to be 2`, because nothing is compared today.

  The no-env-block, no-port and external cases are **green** before the change: today the codex row is skipped and the external row answers `null`. Their reds are mutation rows 3, 4 and 5. The describe's count is Step 0's plus 6.

- [ ] **Step 3: The codex arm and the absent-or-equal rule** (`deploy/account-op.mjs`).

  (a) Old (unique):

  ```js
   *  box produces no env-block measurement at all rather than a finding about a
   *  file that does not exist. */
  function effectiveBaseUrl(exec) {
    if (typeof exec.baseUrl === 'string' && exec.baseUrl !== '') return exec.baseUrl;
  ```

  New:

  ```js
   *  box produces no env-block measurement at all rather than a finding about a
   *  file that does not exist.
   *
   *  A CODEX lane is the exception, and it is keyed on `exec.kind` alone (Plan 3a
   *  Task 3, R-C7): its endpoint is its own loopback shim,
   *  `http://127.0.0.1:<exec.proxyPort>` — the URL its launcher exports
   *  (`ccd/ccrc-codex`'s ANTHROPIC_BASE_URL line; `ccrc-codex-launcher.test.ts`
   *  pins that side) — never a provider default: `openai`'s is null, which is
   *  why this check used to compare nothing for such a lane. A codex row whose
   *  proxyPort is not a whole number in the launcher's 1..65535 answers `null`:
   *  this check is not the roster's judge (the wrappers check is), so it
   *  measures nothing for that row rather than naming an endpoint no launcher
   *  could build. */
  function effectiveBaseUrl(exec) {
    if (exec.kind === 'codex') {
      const port = exec.proxyPort;
      return Number.isInteger(port) && port >= 1 && port <= 65535 ? `http://127.0.0.1:${port}` : null;
    }
    if (typeof exec.baseUrl === 'string' && exec.baseUrl !== '') return exec.baseUrl;
  ```

  (b) In `opDoctor`, old (unique):

  ```js
      } catch { env = null; }
      if (env === null || typeof env !== 'object') {
        lines.push([DOCTOR_FINDINGS[1], acct.id,
  ```

  New (its comment as amended by Task 11's close-out, `3bd31cca4`: a comment here that spells the model-env export's name reds `modelenv-single-writer`, because this file already writes `settings.json`):

  ```js
      } catch { env = null; }
      // A CODEX lane's rule is ABSENT OR EQUAL (R-C7,
      // D-3709). Its launcher exports
      // ANTHROPIC_BASE_URL itself, and no ccrc writer puts that key in
      // settings.json (the model-env keys shared/modelenv.mjs owns), so an env block
      // without it — or no env block at all — is that lane's healthy state.
      // Only a key naming ANOTHER endpoint is drift; which of the two Claude
      // Code honours is unmeasured, so the finding says both and judges neither.
      const codex = e.kind === 'codex';
      if (env === null || typeof env !== 'object') {
        if (codex) continue;
        lines.push([DOCTOR_FINDINGS[1], acct.id,
  ```

  (c) Old (unique):

  ```js
      const has = typeof env.ANTHROPIC_BASE_URL === 'string' ? env.ANTHROPIC_BASE_URL : null;
      if (has !== wants) {
        lines.push([DOCTOR_FINDINGS[1], acct.id,
          `the roster says ${wants} and ${acct.configDirSuffix}/settings.json says ${has ?? 'nothing'}`]
          .join('\t'));
      }
  ```

  New:

  ```js
      if (codex && !Object.hasOwn(env, 'ANTHROPIC_BASE_URL')) continue;
      const has = typeof env.ANTHROPIC_BASE_URL === 'string' ? env.ANTHROPIC_BASE_URL : null;
      if (has !== wants) {
        lines.push([DOCTOR_FINDINGS[1], acct.id, codex
          ? `${acct.configDirSuffix}/settings.json sets ANTHROPIC_BASE_URL to ${has ?? 'a non-string value'}, `
            + `and this codex lane's endpoint is its loopback shim ${wants}, which its launcher exports — `
            + 'whichever of the two Claude Code honours, one of them is wrong. No ccrc writer puts that key '
            + 'there: delete it from the env block by hand'
          : `the roster says ${wants} and ${acct.configDirSuffix}/settings.json says ${has ?? 'nothing'}`]
          .join('\t'));
      }
  ```

  `envs += 1` stays where it is, before the parse. A codex lane with a `settings.json` is counted as measured, which the absent-key case's `1 provider env block` pins.

- [ ] **Step 4: Run green, then the neighbours.** Foreground. Each block is ONE Bash call with a 600000 ms timeout. The whole doctor file takes 7 to 9 minutes alone, so nothing shares its calls, and it runs as the Global Constraints' three parts, one call each (ruling F6):

  ```bash
  . "<abs scratch>/plan3a-env.sh"
  cd server
  r11 t3-green ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'ccrc doctor: accounts'
  ```

  ```bash
  . "<abs scratch>/plan3a-env.sh"
  cd server
  r11 t3-doctor-<k> ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t <P>   # three calls, k = 1, 2, 3: the Global Constraints' parts
  ```

  ```bash
  . "<abs scratch>/plan3a-env.sh"
  cd server
  r11 t3-account ./node_modules/.bin/vitest run test/ccrc-account.test.ts
  ```

  ```bash
  . "<abs scratch>/plan3a-env.sh"
  cd server
  r11 t3-neigh ./node_modules/.bin/vitest run test/topology-clean.test.ts test/typecheck-tests.test.ts
  ```

  Expected:
  - `accounts` has Step 0's count plus 6, all green;
  - the whole doctor file is green: its three parts' counts sum to 505 passed and 4 skipped, as measured whole on a scratch copy;
  - `ccrc-account` is green, including the mirror case, because `PROVIDER_BASE_URL.openai` is still null;
  - `topology-clean` and `typecheck-tests` are green;
  - each call ends `census: clean …`.

- [ ] **Step 5: Mutation table.** Every row edits `deploy/account-op.mjs` alone. First stage this task's two files, so that the index holds the green tree each restore is checked against (ruling F7), and back up that one file. Nothing is committed here:

  ```bash
  . "<abs scratch>/plan3a-env.sh"
  git add deploy/account-op.mjs server/test/ccrc-doctor.test.ts
  mkdir -p "$SCRATCH/t3-mut" && cp deploy/account-op.mjs "$SCRATCH/t3-mut/account-op.mjs"
  ```

  Then, for each row alone, apply the mutation and run this as one call:

  ```bash
  . "<abs scratch>/plan3a-env.sh"
  cd server
  r11 t3-mut-<row> ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'ccrc doctor: accounts'
  ```

  Record the red count. A red row is vitest's exit 1 under `census: clean — … command exit 1`, because the census verdict is separate (F10). Restore and verify, then re-run the block above green, labelled `t3-mut-<row>-green`:

  ```bash
  . "<abs scratch>/plan3a-env.sh"
  cp "$SCRATCH/t3-mut/account-op.mjs" deploy/account-op.mjs && git diff --quiet -- deploy/account-op.mjs && echo restored
  ```

  Expected: `restored`. The counts were measured on a scratch copy; re-derive them.

  | # | Guard | Mutation | Goes red (measured) |
  |---|---|---|---|
  | 1 | a codex lane is compared at all | delete the `if (exec.kind === 'codex') { … }` block in `effectiveBaseUrl` | 3: absent-key (`0 provider env block`), loopback-equal (`0 provider env block`), drift (rc 0) |
  | 2 | an absent key is healthy | delete `if (codex && !Object.hasOwn(env, 'ANTHROPIC_BASE_URL')) continue;` | 1: absent-key (WARN "sets ANTHROPIC_BASE_URL to a non-string value") |
  | 3 | an absent env block is healthy | delete `if (codex) continue;` | 1: no-env-block (WARN "carries no env block") |
  | 4 | no invented endpoint | `return Number.isInteger(port) && … : null;` → `` return `http://127.0.0.1:${port}`; `` | 1: no-port (the WARN names `http://127.0.0.1:undefined`) |
  | 5 | keyed on `exec.kind`, never provider | `if (exec.kind === 'codex') {` → `if (exec.provider === 'openai') {` | 1: the external live-shape case |
  | 6 | the finding names both values | `${has ?? 'a non-string value'}` → `another endpoint` | 1: drift (`http://127.0.0.1:45020` absent) |

- [ ] **Step 6: Scope and residue check,** against this task's own base. As in Task 2 Step 7, each diff compares the recorded base with the working tree, never `"$BASE" HEAD`, so it means the same before Step 7's commit and after it (ruling F3):

  ```bash
  . "<abs scratch>/plan3a-env.sh"
  BASE="$(cat "$SCRATCH/t3-base")"
  git diff --name-only "$BASE"
  # → deploy/account-op.mjs, server/test/ccrc-doctor.test.ts
  git diff "$BASE" -- deploy/account-op.mjs | grep '^[-+]' | grep -c "e\['kind'\] === 'external' || e\['kind'\] === 'codex'"
  # → 0: the `lane` op's ternary is not on any changed line
  ids="$(jq -r '.accounts[] | select(.telemetry == "codex") | .id' "$HOME/.ccrc/accounts.json")"
  printf '%s\n' "$ids" | grep -c .
  # → 2: read from the box's roster now, never from this plan, and never printed (F1, F4)
  printf '%s\n' "$ids" | while IFS= read -r id; do
    git diff "$BASE" | grep '^+' | sed 's/$/ /' | grep -cE "[^[:alnum:]_-]${id}[^[:alnum:]_-]"
  done
  # → 0, then 0 (R13). Only counts print. Space-padded for the reason Task 2 Step 7 gives.
  ```

  Any other answer is a finding. Report it by file and count, never by quoting the line.

- [ ] **Step 7: Commit.**

  ```bash
  git add deploy/account-op.mjs server/test/ccrc-doctor.test.ts
  git commit -F - <<'EOF'
  fix(doctor): the settings-env drift check sees codex lanes

  A codex lane's endpoint is its loopback shim, http://127.0.0.1:<proxyPort>,
  which its launcher exports. Its settings.json env block may omit
  ANTHROPIC_BASE_URL (no ccrc writer puts it there) or name exactly that
  URL; any other value is settings-env-drift, naming both values and the
  hand remedy. The arm is keyed on exec.kind, so the external rows are
  judged exactly as before.

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  ```

**What this task deliberately does NOT do:**
- **The `lane` op** (:1995) and **`PROVIDER_BASE_URL`**. The provider table stays the one `shared/providers.ts` mirrors, and no codex default is invented there.
- **`_check_accounts`.** Its PASS sentence, its generic remedy line and its arm order are unchanged. The codex remedy rides in the finding.
- **Normalising URLs.** Comparison stays byte-exact, as for every other lane. `http://127.0.0.1:<port>/` and `http://localhost:<port>` are drift, which is right: the shim binds 127.0.0.1.
- **`lane.json`.** The check compares against the roster's `proxyPort`, the authority. The launcher reads `lane.json`, and `lane.json` going stale against the roster is Task 4's FAIL (R7).
- **Writing or deleting the key.** `doctor --fix` never edits an operator's `settings.json` env block.

**Hazards a later task must respect:**
1. **Task 4's `_check_codex` runs in every whole-doctor case with a codex roster.** Those are the `healthyCodexBox` wrappers cases at :3855-3898, and they connect to 45010/45011. This task's cases avoid that by running `_check_accounts` alone. Task 4 must plant fixture listeners or free ports for those cases, and must not re-point this task's cases at `runDoctor`.
2. **The loopback URL has two builders in two languages:** the launcher's bash export and `effectiveBaseUrl`'s template. Each is pinned by behaviour in its own suite (`ccrc-codex-launcher.test.ts:360` and this task's loopback-equal and drift cases). A change to either spelling (a host, a scheme, a trailing slash) must change both in one commit.
3. **If a later measurement shows `settings.json` env overrides the process environment**, a present-and-different key misroutes every turn, and the class may need to become FAIL. That is a ruling, not an edit to this rule (R-C7).

### Task 4: `_check_codex`, part 1 — population, executables, runtime, authDir, ports and lane state (no socket)

**Files:**
- Modify `deploy/models-op.mjs` — a check-only `materialise` (ruling R7). Every edit above the `OPS` table is line-count-neutral, because the tree cites this file by line number: `server/test/modelenv.test.ts` at `:298`, and `ccd/ccrc-doctor-checks`' `_check_models` comments at `:185` and `:573` (both already stale at `1f9fa22d`: :185 is a blank line and :573 is `OPS.init`, neither the code it names). Ruling Z gives `_check_models` no rewrite, so those two may still be there when this task starts. This task's one line-adding edit, inside `OPS.materialise` (:578), sits below all three, and Step 7 proves each cited line unmoved either way (measured at `1f9fa22d`; re-derive with `git grep -n "models-op\.mjs:[0-9]" -- ':!docs'`).
  - The path-helper comment (`grep -n 'names these two directly' deploy/models-op.mjs`, :115-116), rewritten in place (2 lines → 2).
  - `materialise`'s two path locals (`grep -n 'const classes = path.join(modelsDir()' deploy/models-op.mjs`, :341-342) and its file list (`grep -n 'const files = \[\[classes, classesTsv' deploy/models-op.mjs`, :403-406), in place (2 → 2, 4 → 4).
  - `OPS.materialise` (`grep -n "^  materialise: {" deploy/models-op.mjs`, :578) gains the optional `check` key.
  - Two new functions, `materialFiles` and `materialiseCheck`, directly after the `OPS` table's closing `};` (:584).
  - The `materialise` arm of `main` (`grep -n "^  if (opName === 'materialise') {" deploy/models-op.mjs`, :830).
- Modify `ccd/ccrc-doctor-checks`:
  - `CCRC_DOCTOR_CHECKS` (`grep -n '^CCRC_DOCTOR_CHECKS=(' ccd/ccrc-doctor-checks`, :166-206): the `  models` line (:205) becomes `  models codex …` ON THE SAME LINE (Why).
  - The seven stale `deploy.sh` citations (`grep -nE 'deploy\.sh.?(:|[[:space:]]*\(:)[0-9]' ccd/ccrc-doctor-checks` → :274, :276, :741, :1152, :2168, :3737, :3740), each rewritten on its own line.
  - The `_check_codex` block, appended after the file's last line, the end of `_check_models` (:5656 at `1f9fa22d`; ruling Z gives `_check_models` no rewrite, but re-derive it at Step 0, because an earlier task may still edit this file).
- Modify `server/test/codexLaneFixture.ts` — `codexRoster` (`grep -n '^export function codexRoster' server/test/codexLaneFixture.ts`, :98-126) gains `opts.accountsSh`.
- Modify `server/test/ccrc-doctor.test.ts`:
  - the vitest import (:38) and the `node:fs` import's second names line (:42), same-line;
  - `SHIPPED_SKILLS`, directly above `healthy()` (`grep -n '^/\*\* A box where every check passes' server/test/ccrc-doctor.test.ts`, :1021), and `healthy()`'s skills loop (:1067), same-line;
  - `healthyCodexBox` (`grep -n '^function healthyCodexBox' server/test/ccrc-doctor.test.ts`, :1204-1219), replaced by the Codex fixture block;
  - `HEALTHY_SKIPS` (`grep -n '^const HEALTHY_SKIPS' server/test/ccrc-doctor.test.ts`, :1288) and its docstring;
  - the five `healthyCodexBox` callers (`grep -n "healthyCodexBox('" server/test/ccrc-doctor.test.ts`), all of them `wrappers` cases (:3854-3909). No earlier task adds one: ruling Z gives `_check_models` no codex-specific sentence, so Task 1 adds no `models` case on this fixture, and Task 3's accounts cases build their own `codexAccountsBox`;
  - two describes appended at the end of the file (:8828 at `1f9fa22d`; Tasks 1 and 3 add cases above it first).
- Modify `server/test/models-op.test.ts` — five cases inside `describe('lane.json (spec §5.4) — the codex lane manifest'` (:1111), directly before the `});` that closes it (:1312).
- Neighbours run, not edited: `single-definition`, `pool-name-parity`, `macos-platform`, `ccrc-models`, `modelenv`, `ccrc-codex`, `ccrc-doctor-graphify`, `install-census`, the codex and doctor cases of `ccrc-install`, and `typecheck-tests`.

**Interfaces:**
- Consumes:
  - The plan's R11 census wrapper, `"$CENSUS" <evidence-dir> <command…>`, and the env file every block below sources first, `<abs scratch>/plan3a-env.sh`, which defines `SCRATCH`, `CENSUS`, `EVID` and `BASE` (Global Constraints, ruling F2): two snapshots of `systemctl --user list-units --all 'ccgpt-*' 'ccrc-codex-usage@*'` and a fixture-process census around each suite run.
  - The lane library in `ccd/ccrc`, read-only, called directly (the doctor table is sourced into `ccrc`, so these are in scope — `_check_update-sync`'s `declare -F` guard at doctor-checks:3857 is the precedent). The line numbers were measured at `1f9fa22d`; Tasks 1 and 2 edit `ccd/ccrc` above them first, so locate each by name:
    - `_codex_lanes` (:10369): rc 0 with ids, EMPTY meaning none; rc 1 roster-invalid; rc 2 no jq;
    - `_codex_row <id>` (:10394): sets `CX_ID CX_KIND CX_CFG CX_AUTH CX_PROXY CX_LITELLM`; rc 2 usage, rc 1 any other refusal, its sentence on stderr as `ccrc codex: <code>: <sentence>`;
    - `_codex_lane_json_state <id>` (:10463): `current|stale|absent` against the ROSTER row only;
    - `_codex_lane_dir` (:10288), `_codex_runtime_cli` (:10290), `_codex_litellm_yaml` (:10291), `_models_node` (:1268), `_models_roster_path` (:9369), `_models_litellm_template` (:9707), `_box_env_value`, `BOX_TREE_DIR` (:1588), `BOX_ENV_FILE` (:1348), `PROG` (:1311).
  - `ccgpt-runtime check` (ccd/ccgpt-runtime `_rt_check` :566-574, verdict :391-405): rc 0 and stdout `ccgpt-runtime: current <gen> litellm=<v>`; rc 1 and stderr exactly one of `ccgpt-runtime: absent|requirement-moved|probe-moved|mutated`. It compares the stamp and never re-runs the probe.
  - `deploy/models-op.mjs`, check-only answers only: `show` (registry, `derived.retired`, `renderRefusal`), `litellm` WITHOUT `--commit` (answers `changed`, writes nothing: :795-812), and this task's `materialise --check true`.
  - `codexLaneFixture.ts`: `freeLanes`, `codexRoster`, `GPT_LANE_BINS` (pinned to `_inst_bins`' gate by `ccrc-install.test.ts`), `plantFakeRuntime`, `plantLaneAuth`, `authDirOf`, `killLaneProcesses`; `ccgptHarness.ts`: `pythonOrSkip`.
- Produces:
  - `codex` in `CCRC_DOCTOR_CHECKS`, directly after `models`, and `_check_codex` with its helpers `_dr_cx_find`, `_dr_cx_fail`, `_dr_cx_warn`, `_dr_cx_member`, `_dr_cx_join`, `_dr_cx_report`, `_dr_cx_bins`, `_dr_cx_runtime`, `_dr_cx_lane`, and `CODEX_LANE_BINS`, the one file-level declaration of the four GPT-lane executables the check compares (Task 8's `_fix_codex` reads it). Findings accumulate in `_check_codex`'s locals `DRX_CLASS`/`DRX_WHAT`/`DRX_FIX` (bash's dynamic scope); `_dr_cx_report` prints every FAIL line, then every WARN line, each with its own remedy, and returns the worst class. **Task 5 adds its rows through `_dr_cx_fail`/`_dr_cx_warn` inside the per-lane loop; Task 6 adds its usage rows the same way; Task 8's `_fix_codex` cures the FAIL lines below.**
  - The per-lane PASS words, `DRX_LANE_WORDS` (`ports <P>/<L>, signed in, lane.json current, LiteLLM config current`), joined into the PASS as `<n> Codex lane(s): <id> (<words>), …; runtime <gen> litellm=<v>; the four GPT-lane executables match the shipped tree`. Task 5 widens each lane's words.
  - The sentences, exactly as Step 4 spells them, that Task 8 cures and Task 10 reads. Two SKIP lines (`this box records CCRC_ROLE=server, …`; `no account in $HOME/.ccrc/accounts.json is exec.kind "codex", and no lane state is left under <root>, …`), and a third for an absent roster.
  - `deploy/models-op.mjs materialise --file <roster> --id <id> --check true` → exit 0 and `{"ok":true,"op":"materialise","id":<id>,"check":true,"changed":{"lane":bool|null,"classes":bool,"effort":bool}|null}`, writing nothing; any other `--check` value exit 2 `bad-argv`. `materialFiles(account, registry, catalogue)`, the one list of files `materialise` renders whole — Task 8's cure is the existing write form.
  - `codexRoster(home, lanes, extra, { accountsSh: false })`.
  - In `ccrc-doctor.test.ts`: `async healthyCodexBox(prefix, ids = ['codex-a']): Promise<string>` (free ports, a converged lane end to end), `installModelsOp`, `placeLaneBins`, `writeLaneModels`, `renderLane`, `lanePorts`, `editRosterRow`, `codexVerdicts`, `remedyAfter`, `treeState`, `currentGen`, `SHIPPED_SKILLS`, `CODEX_TOOLS`, `PY`, `describeCodex`, `itCodex`, `codexHomes` (with a file-level `afterEach`). `HEALTHY_SKIPS` is `(darwin ? 1 : 0) + 4`.

**Why:**
- **What §12 asks of part 1, and where each row comes from.** Population, then box rows, then lane rows, every finding its own sentence with its own remedy (spec §12: "each as its own sentence with its own remedy"):
  - the four GPT-lane executables against the shipped tree, `_check_skills`' rule (`$BOX_TREE_DIR/ccd`, the tree the stamp names), compared byte for byte with `cmp`;
  - the runtime, through `ccgpt-runtime check`, one sentence per word;
  - `exec.authDir`, existence and mode only;
  - the row's ports (the row reader) and cross-lane collisions (belt and braces behind `parseRoster`, spec §12);
  - `lane.json` against the roster row (`_codex_lane_json_state`) and against the class registry (the new check-only `materialise`, ruling R7 — 2b-1 item 16's "retired haiku still written as probeModel" and "roster-edit staleness");
  - the registry itself through models-op `show`: none, or another probe's, is FAIL (2b-1 item 16); haiku unassigned or retired from the catalogue is WARN (§12's "probe model absent from the current catalogue");
  - the rendered LiteLLM config against the catalogue, through `litellm` without `--commit` (absent, stale, never probed);
  - lane state left under `~/.ccrc/codex/` for an id that is no longer a codex lane (2b-1 item 16's flip-back case), a WARN D-3713.
- **The population, and the two answers that are never a SKIP (ruling R-C6).** `_codex_lanes` rc 1 (the roster cannot be read) and rc 2 (no jq) are FAILs naming `ccrc wrappers` and jq D-3710. An unreadable roster is not an empty one, and a SKIP there would read "no Codex lane" on a box that has some. An ABSENT roster file is different: it is a positive answer, and `_check_wrappers` already FAILs it, so it SKIPs with its own sentence D-3723. Role `server` SKIPs, as `_check_accounts` reads it (doctor-checks:3082-3087); `CCRC_ROLE` unset reads as not server (spec §12).
- **Inert on today's live shape, which is what makes the merge's auto-rollout safe.** The live fleet box's roster has two `external` rows with codex telemetry (one with a class registry) and no `exec.kind: "codex"` row, and no `~/.ccrc/codex/` directory at all (measured 2026-09-30). So `_check_codex` answers exactly one SKIP there, and one SKIP on the server box (`CCRC_ROLE=server`), before it asks anything. Task 10's live-shape rehearsal pins that. The external lane that carries a class registry is not this check's subject: the population is `exec.kind == "codex"` rows, never a telemetry field or a registry's probe kind. That lane stays `_check_models`' subject alone, and this task does not touch `_check_models`, so its class there is what it was (ruling Z1). The new `codex` SKIP is the one line the live doctor gains; Task 10 pins every existing check's class, `models` included, as identical before and after (ruling Z7).
- **Read-only, the whole way down.** Every registry and catalogue fact comes through models-op's check-only answers:
  - so this task adds no code line naming the registry's file to `ccd/ccrc-doctor-checks` (single-definition.test.ts:1784-1795 pins that exact count: two, the base's, because ruling Z gives `_check_models` no registry reader of its own; Step 4 compares it with `$BASE`), and nothing here writes, renders, mkdirs, starts or stops anything;
  - the two cases that could catch a writer measure bytes AND mtimes (`treeState`): a re-render of identical bytes still moves an mtime;
  - `authDir` is asked `-e`/`-d`/`-r`/`-x`, and `auth.json` only `-f`, which needs search permission on the directory and nothing on the file, so a 0000-mode `auth.json` PASSes. An `authDir` with no `auth.json` is a FAIL in `ccrc codex start`'s own refusal words, because start refuses there D-3724.
- **Why `materialise` needs a check form, and why it is opt-in** D-3712. `_codex_lane_json_state` compares lane.json with the ROSTER row only (id, configDir, authDir, ports, units present). A haiku reassigned by hand, or a write interrupted between the TSV and lane.json (2b-1 item 18), leaves a lane.json that the roster agrees with and the registry does not. Ruling R7 measures it with a check-only materialise. The default stays the write, `--check true` is the opt-in:
  - two shipped callers run `materialise` expecting a write (`_codex_lane_json_ensure`, ccd/ccrc:10494, and the refresh loop, :10181), and `models-op.test.ts` makes 13 calls to it without a flag, besides `ccrc-models.test.ts`' cases through the verbs;
  - flipping the default would change every one of them; an opt-in flag changes none;
  - any other value is refused at exit 2, so a typo never falls through to the write.

  It renders through one shared list, `materialFiles`, which `materialise` itself now writes from, so "what materialise would write" cannot mean two things.
- **The runtime row trusts the stamp** (ruling R-C5) D-3711. §12 says "failing its behaviour probe". `ccgpt-runtime check` compares the stamp's requirement, probe hash and LiteLLM version and never re-runs the probe, which may take `CCRC_RUNTIME_PROBE_S` (300 s); doctor closes every install and update. `ccgpt-runtime build` re-probes, and every remedy says so. `requirement-moved` is §12's "out of range".
- **The executables list is one line, pinned to the installer.** `CODEX_LANE_BINS` is `_inst_bins`' GPT-lane gate (ccd/ccrc:13560-13568) in its order. It is declared once at file level, so Task 8's `_fix_codex` restores exactly what this check compares. A test pins that line to `GPT_LANE_BINS`, which `ccrc-install.test.ts` already pins to the gate, so a fifth executable reds before this list can drift.
- **The table entry shares a line with `models`, deliberately.** Lines below the table are cited by number from other files (`git grep -n "ccrc-doctor-checks:[0-9]" -- ':!docs'`): ccd/ccrc :3878, :5940, :5971, :5978, :7229, :7241, :7675, :8480 and :8851, `deploy/account-op.mjs:221`, and `ccrc-account.test.ts` :545, :575, :597, :744, :2209, :4064, :4252 and :4271. A new line at :206 would move every one of them. `models codex` on one line is still two array entries (`tableNames()` reads them apart). Every other edit above the appended block is same-line, and Step 7 measures it.
- **`HEALTHY_SKIPS` rises by one.** `healthy()` rosters only the upstream Anthropic account, so `codex` SKIPs on every platform; the darwin term (`scopes`) is unchanged. Measured in a scratch copy of this tree at `1f9fa22d`: with `codex` in the table and the constant NOT raised, exactly eight existing cases red, and nothing else:
  - `services`' "reports a dead service and a dead timer as TWO lines";
  - the output contract's "every line is exactly PASS|WARN|FAIL|SKIP" and "prints a summary count LAST";
  - `wrappers`' "counts BOTH lines in the summary";
  - `config`'s "SKIPS an env-less FLEET-ROLE box";
  - `fleet`'s "SKIPS in local mode";
  - `provenance`'s "SKIPs a box with no completed-install record";
  - `tmux_skew`'s "SKIPS when no server is running".
- **`healthyCodexBox` has to become a real Codex box, with free ports.** Its five callers (the `wrappers` codex cases) assert `r.code === 0` on the whole doctor run. The current fixture rosters a codex lane with no executables, no runtime, no authDir, no registry and no lane.json, so `_check_codex` would FAIL it. The new fixture builds a converged lane end to end:
  - every rendered file comes from the REAL writers (models-op `materialise`, then `litellm --commit true`), so a case measures what the product writes;
  - the ports come from `freeLanes`, never the fixed pure-parse pair, because Task 5's rows connect to them (2b-2's Global Constraints: fixed ports are for fixtures that open no socket);
  - it writes no `accounts.sh` (`codexRoster`'s new `accountsSh: false`), for `healthy()`'s own reason, the `graphify` arms;
  - it links the binaries the lane library needs on this file's PATH-contained harness (2b-2 plan :6885-6888, hazard 9): `bash`, `readlink`, `cat`, `cmp`, `ps`, `awk`, `od`, `tr` and this platform's sha256 tool;
  - it copies the shipped skills into the lane's home, because materialise creates that home and `skills` measures every existing rostered home;
  - it needs python3 (`plantFakeRuntime`'s interpreter hands the stamp read to one), so the five callers and every new case are gated `skipIf(PY === null)`.
- **The seven stale `deploy.sh` citations** D-3725. 2b-2's carry-forward 11 counted six in the `deploy.sh:<N>` shape; measured, there is a seventh, `` `deploy.sh` (:417, :464) `` at :741. Each is re-aimed by a quoted ANCHOR, the code text it names, not by a new line number. This plan's own Task 7 edits `deploy.sh`'s agent arm, so any line number re-aimed here would go stale inside this plan. A pin forbids the line-number shape and proves each anchor still exists in `deploy.sh`.
- **Out of this task:** the tier rows (Task 5), the usage-timer and usage-row rows (Task 6), `doctor --fix` (Task 8: a fixer runs only on a FAIL, ruling R-C8).

- [ ] **Step 0: Record the base, the locators and the neighbours' counts (read-only)**

Record this task's base once, to `$SCRATCH/base`, the file the Global Constraints' env file reads `BASE` from. Steps 4, 7 and 9 use that `$BASE`, and never diff against `origin/main`, which can move while this task runs. Shell state does not survive between Bash calls (ruling F2), so every block below begins by sourcing the env file and naming its own directory, and no block relies on a variable an earlier block set. Every suite command runs through the census, one suite per foreground call (ruling F6), with a timeout of at least 600000 ms.

```bash
. "<abs scratch>/plan3a-env.sh"; cd "$(git rev-parse --show-toplevel)"
: "${CENSUS:?source the Global Constraints' env file first}"
git rev-parse HEAD > "$SCRATCH/base"   # this task's base; every later block reads it as $BASE
grep -n '^CCRC_DOCTOR_CHECKS=(' ccd/ccrc-doctor-checks                         # → 166
grep -n '^  models$' ccd/ccrc-doctor-checks                                     # → 205, exactly one line
grep -nE 'deploy\.sh.?(:|[[:space:]]*\(:)[0-9]' ccd/ccrc-doctor-checks | cut -d: -f1 | tr '\n' ' '   # → 274 276 741 1152 2168 3737 3740
wc -l < ccd/ccrc-doctor-checks                                                  # → the last line, which closes _check_models: 5656 at 1f9fa22d (re-derive: ruling Z leaves _check_models unrewritten, but an earlier task may still edit the file)
grep -c '_check_codex\|_dr_cx_' ccd/ccrc-doctor-checks                          # → 0
grep -n "^  materialise: {" deploy/models-op.mjs                                # → 578
grep -c "'check'" deploy/models-op.mjs                                          # → 0
grep -n '^function healthyCodexBox\|^const HEALTHY_SKIPS' server/test/ccrc-doctor.test.ts   # → 1208, 1288
grep -c "healthyCodexBox('" server/test/ccrc-doctor.test.ts                    # → 5: the wrappers cases and no other caller, the ones 1d converts
```

Then record each neighbour's count, one suite per call (ruling F6), every call a block of this shape:

```bash
. "<abs scratch>/plan3a-env.sh"; cd "$(git rev-parse --show-toplevel)/server"
"$CENSUS" "$EVID/t4-0-ccrc-doctor-<k>" ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t <P>   # the Global Constraints' three parts, k = 1, 2, 3; record each "Tests" line
```

for `ccrc-doctor` (three calls, as shown; its count is their sum), then `models-op`, `ccrc-codex`, `single-definition`, `pool-name-parity`, `macos-platform`, `ccrc-models`, `modelenv`, `install-census` and `ccrc-doctor-graphify`, each run whole (`test/<suite>.test.ts`, no `-t`) and labelled `t4-0-<suite>`.

Measured at `1f9fa22d` (examples to re-derive, never to paste): `ccrc-doctor` `Tests 499 passed | 4 skipped (503)` there, so `505 passed | 4 skipped (509)` once Task 3's six doctor cases have landed (derived, not measured; ruling Z leaves Task 1 no doctor case, because `_check_models` gains no sentence), `models-op` `Tests 106 passed (106)` there, so `110 passed (110)` once Task 2's four Z3 cases have landed (derived), `ccrc-codex` `Tests 201 passed (201)`. Any locator that finds nothing, or finds two, stops the task.

**The census reads live units too.** While this task was drafted, the live fleet placed a session on one of the other repository's lanes mid-run, and that lane's two transient tiers appeared in the `after` snapshot of a green, contained run. A census `FAIL` (exit 125 or 126) stops the step: attribute every hit by the rule beside the census script, re-run once in isolation, report what is attributable, and never touch the unit or signal the process (Global Constraints).

- [ ] **Step 1: Write the failing tests**

**1a. `server/test/models-op.test.ts`.** Insert these cases directly before the `});` that closes `describe('lane.json (spec §5.4) — the codex lane manifest'` (the first `^});$` after `grep -n "describe('lane.json (spec §5.4)" server/test/models-op.test.ts`; it follows the case `replaces an existing lane.json by rename`). They reuse that describe's `CODEX_LANE`, `CODEX_EXTERNAL`, `laneDir`, `lanePath`, `reclassifyHaiku` and the file's `op`/`seed`/`rosterPath`/`regPath`. The model id `gpt-x-mini` is the describe's own fixture word.

```ts
  // ── Plan 3a Task 4: `materialise --check true` (ruling R7) ────────────────
  // `ccrc doctor`'s `_check_codex` asks this whether lane.json has gone stale
  // against the REGISTRY, which `_codex_lane_json_state`'s roster-only compare
  // cannot see. Every case proves the check WROTE NOTHING, by bytes AND by
  // mtime (a rewrite of identical bytes still moves the mtime), because a
  // check that cured what it measured would turn doctor into a writer.
  const stateOf = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const d of [path.join(home, '.ccrc', 'codex'), laneDir(), path.join(home, '.ccrc', 'models')]) {
      if (!fs.existsSync(d)) continue;
      out[`${d}/`] = String(fs.statSync(d).mtimeMs);
      for (const n of fs.readdirSync(d)) {
        const p = path.join(d, n);
        if (fs.statSync(p).isFile()) out[p] = `${fs.statSync(p).mtimeMs}:${fs.readFileSync(p, 'utf8')}`;
      }
    }
    return out;
  };
  const check = (id = 'codex-a', value = 'true'): Result =>
    op('materialise', '--file', rosterPath(), '--id', id, '--check', value);
  const laneChanged = (r: Result): unknown => (r.body['changed'] as Record<string, unknown>)['lane'];

  it('--check true on a converged codex lane: every file unchanged, and nothing written', () => {
    expect(op('init', '--file', rosterPath(), '--id', 'codex-a', '--probe', 'codex').code).toBe(0);
    const before = stateOf();
    const r = check();
    expect(r.code, JSON.stringify(r.body)).toBe(0);
    expect(r.body).toEqual({ ok: true, op: 'materialise', id: 'codex-a', check: true,
      changed: { lane: false, classes: false, effort: false } });
    expect(stateOf()).toEqual(before);
  });

  it('--check true after the registry moves on disk: lane.json is changed, and still holds the OLD bytes', () => {
    op('init', '--file', rosterPath(), '--id', 'codex-a', '--probe', 'codex');
    const old = fs.readFileSync(lanePath(), 'utf8');
    reclassifyHaiku('gpt-x-mini');
    const before = stateOf();
    const r = check();
    expect(r.code, JSON.stringify(r.body)).toBe(0);
    expect(laneChanged(r)).toBe(true);
    expect(stateOf()).toEqual(before);
    expect(fs.readFileSync(lanePath(), 'utf8')).toBe(old);
    // Control: the WRITE form cures it, and the check then answers unchanged.
    expect(op('materialise', '--file', rosterPath(), '--id', 'codex-a').code).toBe(0);
    expect(laneChanged(check())).toBe(false);
  });

  it('--check true after a roster port edit is changed; with the lane directory gone it is changed and the directory is NOT recreated', () => {
    op('init', '--file', rosterPath(), '--id', 'codex-a', '--probe', 'codex');
    seed({ ...ROSTER, accounts: [...ROSTER.accounts,
      { ...CODEX_LANE, exec: { ...CODEX_LANE.exec, proxyPort: 45020 } }, CODEX_EXTERNAL] });
    expect(laneChanged(check())).toBe(true);
    fs.rmSync(path.join(home, '.ccrc', 'codex'), { recursive: true, force: true });
    const r = check();
    expect(r.code, JSON.stringify(r.body)).toBe(0);
    expect(laneChanged(r)).toBe(true);
    expect(fs.existsSync(path.join(home, '.ccrc', 'codex'))).toBe(false);
  });

  it('--check true answers lane: null on a lane with no manifest, and changed: null on a lane with no registry', () => {
    // `router` is `external` and carries a codex registry that ALREADY EXISTS,
    // as the live first lane's does. It is planted by hand, never through
    // `init codex`, which ruling Z3 refuses on an external row: a registry
    // that already exists is the one shape Z3 leaves alone.
    fs.mkdirSync(path.dirname(regPath('router')), { recursive: true });
    fs.writeFileSync(regPath('router'), `${JSON.stringify({ probe: 'codex',
      classes: { haiku: null, sonnet: null, opus: null, fable: null }, subagent: 'sonnet', discovery: 'catalogue' }, null, 2)}\n`);
    const r = check('router');
    expect(r.code, JSON.stringify(r.body)).toBe(0);
    expect(laneChanged(r)).toBeNull();
    const none = check('codex-a');
    expect(none.code, JSON.stringify(none.body)).toBe(0);
    expect(none.body['changed']).toBeNull();
    expect(fs.existsSync(path.join(home, '.ccrc', 'codex'))).toBe(false);
  });

  it('--check with any value but "true" is refused at exit 2 and writes nothing — a typo never falls through to the write', () => {
    op('init', '--file', rosterPath(), '--id', 'codex-a', '--probe', 'codex');
    reclassifyHaiku('gpt-x-mini');
    const before = stateOf();
    for (const v of ['yes', 'TRUE', '1']) {
      const r = check('codex-a', v);
      expect(r.code, v).toBe(2);
      expect(r.body['error'], v).toBe('bad-argv');
    }
    expect(stateOf()).toEqual(before);
  });
```

**1b. `server/test/codexLaneFixture.ts`.** `codexRoster` gains a fourth parameter. Old:

```ts
 *  reader would refuse throws here instead of testing nothing. Returns the
 *  roster object. */
export function codexRoster(
  home: string,
  lanes: readonly CodexLaneRow[],
  extra: readonly Record<string, unknown>[] = [],
): { version: 1; accounts: Record<string, unknown>[] } {
```

New:

```ts
 *  reader would refuse throws here instead of testing nothing. Returns the
 *  roster object. `accountsSh: false` (Plan 3a Task 4) writes the JSON alone:
 *  `ccrc-doctor.test.ts`' healthy box has no `accounts.sh`, and one would
 *  give `graphify`'s skills/excludes arms a subject that fixture never set up. */
export function codexRoster(
  home: string,
  lanes: readonly CodexLaneRow[],
  extra: readonly Record<string, unknown>[] = [],
  opts: { accountsSh?: boolean } = {},
): { version: 1; accounts: Record<string, unknown>[] } {
```

and its last lines, Old `  seedAccountsSh(home, roster);` → New `  if (opts.accountsSh !== false) seedAccountsSh(home, roster);`. Every existing caller passes three arguments or fewer and keeps its behaviour.

**1c. `server/test/ccrc-doctor.test.ts` — the harness.** Five edits, in file order. The first two are same-line, so `:66` and `:70` (cited from `ccrc-install.test.ts:110` and `pool-name-parity.test.ts:45`, and accurate today) do not move.

1. The vitest import (:38): `import { describe, it, expect } from 'vitest';` → `import { describe, it, expect, afterEach } from 'vitest';`.
2. The `node:fs` import's second names line (:42): append `readdirSync, lstatSync, readlinkSync,` after `appendFileSync,` on the same line.
3. Directly above `/** A box where every check passes.` (:1021), insert:

```ts
/** The three shipped skill trees and the name each installs under in a home —
 *  `_check_skills`' subject. One list for `healthy()` and `healthyCodexBox()`. */
const SHIPPED_SKILLS = [['coordinator-skill', 'ccrc-coordinator'], ['worker-skill', 'ccrc-worker'], ['reviewer-skill', 'ccrc-reviewer']] as const;

```

   and in `healthy()` replace the loop head (:1067) `for (const [tree, name] of [['coordinator-skill', 'ccrc-coordinator'], ['worker-skill', 'ccrc-worker'], ['reviewer-skill', 'ccrc-reviewer']] as const) {` with `for (const [tree, name] of SHIPPED_SKILLS) {`.
4. Replace `healthyCodexBox` whole. Old:

```ts
/** A healthy box plus the ccrc-owned Codex launcher contract. The topology
 *  values are the public fixture pair, and the relative auth directory is
 *  syntactically safe; doctor wrappers neither opens nor validates OAuth. */
function healthyCodexBox(prefix: string): string {
  const home = healthy(prefix);
  writeRoster(home, [{
    id: 'codex-a', configDirSuffix: '.claude-codex-a',
    exec: {
      kind: 'codex', provider: 'openai', proxyPort: 45010, litellmPort: 45011,
      authDir: '.local/share/ccrc/codex/codex-a',
    },
    telemetry: 'codex',
  }]);
  writeWrapper(home, 'codex-a', { cfgDir: '.claude-codex-a', target: 'ccrc-codex' });
  return home;
}
```

   New — the imports sit HERE, mid-file, on purpose (ES modules hoist an `import` declaration from anywhere at top level):

```ts
// ── Plan 3a Task 4: the Codex lane fixtures `_check_codex` needs ──────────
// Imported HERE rather than at the top of the file: an `import` declaration
// may sit anywhere at a module's top level (ES modules hoist it), and the two
// citations into this file that are accurate today — `:66` and `:70`, from
// ccrc-install.test.ts and pool-name-parity.test.ts — must not move.
import {
  authDirOf, codexRoster, freeLanes, GPT_LANE_BINS, killLaneProcesses, plantFakeRuntime, plantLaneAuth,
  type LanePorts,
} from './codexLaneFixture.js';
import { pythonOrSkip } from './ccgptHarness.js';

/** python3, or null. `plantFakeRuntime`'s interpreter hands `ccgpt-runtime
 *  check`'s stamp read and probe hash to a real python3, so without one every
 *  Codex fixture's runtime reads `mutated` and a healthy lane cannot PASS. */
const PY = pythonOrSkip();
const describeCodex = describe.skipIf(PY === null);
const itCodex = it.skipIf(PY === null);

/** Every home `healthyCodexBox` built, so what a case spawns into it is ended
 *  after the case, pass or fail — `killLaneProcesses` ends current-run
 *  children through their own handles, never by name or pattern. */
const codexHomes: string[] = [];
afterEach(async () => { for (const h of codexHomes.splice(0)) await killLaneProcesses(h); });

/** The binaries `_check_codex` and the lane library it calls need on this
 *  file's PATH-contained harness, which carries no system directory (2b-2's
 *  hazard 9): `bash` (every `#!/usr/bin/env bash` — the placed `ccgpt-runtime`
 *  and the fake runtime interpreter), `readlink` and `cat` (`ccgpt-runtime
 *  check`), `cmp` (the executables row), `ps`, `awk`, `od` and `tr` (the tier
 *  identity, Task 5), and this platform's sha256 tool (`_plat_sha256`, which
 *  `_codex_started_json` hashes a tier's code with). */
const CODEX_TOOLS = ['bash', 'readlink', 'cat', 'cmp', 'ps', 'awk', 'od', 'tr',
  process.platform === 'darwin' ? 'shasum' : 'sha256sum'];

/** `deploy/models-op.mjs`' import closure and the LiteLLM template it renders
 *  against — what `_check_codex` runs through `_models_node`
 *  (`$CCRC_HERE/../deploy/models-op.mjs`). COPIED, not symlinked, for
 *  `plantAuthHelper`'s reason: node resolves a module's imports from its REAL
 *  path. A file missing here is not a degraded fixture: every Codex PASS case
 *  reds on the check's "printed no answer" FAIL. */
const MODELS_OP_CLOSURE = ['deploy/models-op.mjs', 'deploy/litellm-config.template.yaml',
  'shared/roster-json.mjs', 'shared/base-url.mjs', 'shared/models.mjs', 'shared/modelenv.mjs', 'shared/litellm.mjs'];

function installModelsOp(home: string): void {
  for (const rel of MODELS_OP_CLOSURE) {
    mkdirSync(path.dirname(join(home, 'ccrc', rel)), { recursive: true });
    copyFileSync(join(REPO, rel), join(home, 'ccrc', rel));
  }
}

/** The four GPT-lane executables, `GPT_LANE_BINS` — the constant
 *  ccrc-install.test.ts pins to `_inst_bins`' gate: SYMLINKED into the
 *  fixture's shipped tree (`<home>/ccrc/ccd`, `$BOX_TREE_DIR/ccd`, what the
 *  check compares against) and COPIED into `<home>/.local/bin`, as
 *  `_inst_atomic` places them — so a case can edit the placed copy and never
 *  the repository's. */
function placeLaneBins(home: string): void {
  for (const n of GPT_LANE_BINS) {
    symlinkSync(join(REPO, 'ccd', n), join(home, 'ccrc', 'ccd', n));
    copyFileSync(join(REPO, 'ccd', n), join(binDir(home), n));
    chmodSync(join(binDir(home), n), 0o755);
  }
}

/** A Codex lane's class registry and catalogue, in the public fixture model
 *  vocabulary (`probe-model` is the haiku class, the lane's usage probe
 *  model). Written as the operator's file and the probe's file are; every
 *  RENDERED file comes from the real writer (`renderLane`), never by hand. */
function writeLaneModels(home: string, id: string, o: {
  probe?: string; classes?: Record<string, string | null>; discovery?: unknown; models?: readonly string[];
} = {}): void {
  const dir = join(home, '.ccrc', 'models');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.classes.json`), `${JSON.stringify({
    probe: o.probe ?? 'codex',
    classes: o.classes ?? { haiku: 'probe-model', sonnet: 'gpt-x', opus: null, fable: null },
    subagent: 'sonnet',
    discovery: o.discovery ?? 'catalogue',
  }, null, 2)}\n`);
  writeFileSync(join(dir, `${id}.json`), JSON.stringify({
    probe: 'codex', fetchedAt: Math.floor(Date.now() / 1000), stale: false,
    models: (o.models ?? ['gpt-x', 'gpt-x-mini', 'probe-model']).map((m) => ({ id: m })),
  }));
}

/** lane.json, the TSV, the effort file, the settings env block and the
 *  lane's LiteLLM config, by the REAL writers — the fixture tree's own
 *  `models-op.mjs` `materialise`, then `litellm --commit true` — so a case
 *  that re-renders after editing a registry is measuring what the product
 *  writes. */
function renderLane(home: string, id: string): void {
  const roster = join(home, '.ccrc', 'accounts.json');
  const op = (...args: string[]): void => {
    const r = spawnSync(process.execPath, [join(home, 'ccrc', 'deploy', 'models-op.mjs'), ...args],
      { env: { PATH: process.env['PATH'] ?? '', HOME: home }, encoding: 'utf8' });
    if (r.status !== 0 || !(r.stdout ?? '').startsWith('{"ok":true')) {
      throw new Error(`renderLane: models-op ${args[0]} ${id} exited ${r.status}: ${r.stdout}${r.stderr}`);
    }
  };
  op('materialise', '--file', roster, '--id', id);
  op('litellm', '--file', roster, '--id', id,
    '--template', join(home, 'ccrc', 'deploy', 'litellm-config.template.yaml'),
    '--out', join(home, '.ccrc', 'codex', id, 'litellm.yaml'), '--commit', 'true');
}

/** A lane's two ports, read back from the roster `healthyCodexBox` wrote. */
function lanePorts(home: string, id: string): { proxyPort: number; litellmPort: number } {
  const r = JSON.parse(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8')) as
    { accounts: Array<{ id: string; exec?: { proxyPort?: number; litellmPort?: number } }> };
  const x = r.accounts.find((a) => a.id === id)?.exec;
  if (x?.proxyPort === undefined || x.litellmPort === undefined) throw new Error(`lanePorts: no ports for ${id}`);
  return { proxyPort: x.proxyPort, litellmPort: x.litellmPort };
}

/** Rewrites one roster row in place, as an operator's hand edit does — the
 *  JSON is written back RAW, so a shape `parseRoster` would refuse reaches
 *  the check exactly as it would on a box. */
function editRosterRow(home: string, id: string, edit: (row: Record<string, any>) => void): void {
  const p = join(home, '.ccrc', 'accounts.json');
  const r = JSON.parse(readFileSync(p, 'utf8')) as { accounts: Array<Record<string, any>> };
  const row = r.accounts.find((a) => a['id'] === id);
  if (row === undefined) throw new Error(`editRosterRow: no row ${id}`);
  edit(row);
  writeRawRoster(home, `${JSON.stringify(r, null, 2)}\n`);
}

/** A healthy box whose roster also carries Codex lanes (`ids`), each one a
 *  lane ccrc runs end to end: its launcher, a signed-in authDir, its model
 *  registry and a fresh catalogue, and the files rendered from them; the
 *  four GPT-lane executables placed from the shipped tree; a current
 *  runtime. Every check still PASSes — healthy()'s contract — so a Codex
 *  case breaks exactly one thing. The ports are FREE ones (`freeLanes`),
 *  never the fixed pure-parse pair: from Task 5 on the check connects to
 *  them. No `accounts.sh` (`codexRoster`'s `accountsSh: false`), for
 *  healthy()'s own reason. */
async function healthyCodexBox(prefix: string, ids: readonly string[] = ['codex-a']): Promise<string> {
  const home = healthy(prefix);
  codexHomes.push(home);
  const lanes: LanePorts[] = await freeLanes(ids);
  codexRoster(home, lanes, [], { accountsSh: false });
  for (const b of CODEX_TOOLS) linkReal(home, b);
  installModelsOp(home);
  placeLaneBins(home);
  plantFakeRuntime(home);
  for (const { id } of lanes) {
    writeWrapper(home, id, { cfgDir: `.claude-${id}`, target: 'ccrc-codex' });
    plantLaneAuth(home, id);
    writeLaneModels(home, id);
    renderLane(home, id);
    // materialise wrote `<cfgDir>/settings.json`, so the home now EXISTS, and
    // `skills` measures every existing rostered home: it carries the shipped
    // skills, as `ccrc install` leaves it.
    for (const [tree, name] of SHIPPED_SKILLS) {
      cpSync(join(REPO, 'ccd', tree), join(home, `.claude-${id}`, 'skills', name), { recursive: true });
    }
  }
  return home;
}
```

5. `HEALTHY_SKIPS`. Replace its docstring's last line and the constant. Old:

```ts
 *  way: deleting this `+ 1` reds every summary/count pin above again. */
const HEALTHY_SKIPS = (process.platform === 'darwin' ? 1 : 0) + 3;
```

New:

```ts
 *  way: deleting this `+ 1` reds every summary/count pin above again.
 *
 *  RAISED BY ONE AGAIN (Plan 3a Task 4): `codex` SKIPs on every platform —
 *  `healthy()` rosters only the upstream Anthropic account, so its Codex
 *  population is empty everywhere, and a scan over no lane must never PASS
 *  (`_check_codex`'s empty-set SKIP). `healthyCodexBox()` is the fixture
 *  where it answers. Measured the same way: deleting this `+ 1` reds the
 *  summary and count pins that read this constant (Plan 3a Task 4's
 *  mutation row). */
const HEALTHY_SKIPS = (process.platform === 'darwin' ? 1 : 0) + 4;
```

**1d. The five `healthyCodexBox` callers** (`grep -n "healthyCodexBox('" server/test/ccrc-doctor.test.ts`), all in `describe('ccrc doctor: wrappers'`. Task 3's accounts cases use their own `codexAccountsBox`, and ruling Z leaves Task 1 no `models` case on this fixture (Step 0's count of 5 is the check). In each, `const home = healthyCodexBox(` becomes `const home = await healthyCodexBox(`, and its `it(` becomes `itCodex(`. The four synchronous ones also become `async`:
- `'a correctly installed Codex lane passes the wrappers check and reports its one lane', () => {` → `…, async () => {`
- `'a Codex launcher execing the upstream account instead of ccrc-codex fails and names both', () => {` → `…, async () => {`
- `'a Codex launcher execing ccgpt — another repository\'s launcher on the fleet box — fails and names ccrc-codex (D-3478)', () => {` → `…, async () => {`
- `'an absent Codex launcher fails in the absent bucket with the ccrc-wrappers remedy', () => {` → `…, async () => {`
- `'the launcher the writer generates for a Codex lane passes — writer and checker name one target'` is already `async`.

Their assertions do not change. Two of them pin `r.code === 0` on the WHOLE doctor run, which is why the fixture had to become a lane every check passes.

**1e. Append at the end of `server/test/ccrc-doctor.test.ts`** — the citation pin, and `_check_codex`'s part-1 describe:

```ts
// ── Plan 3a Task 4: `_check_codex`, part 1 (spec §12) ─────────────────────
// Every case runs the FULL `ccrc doctor` and reads the codex lines, and every
// case asserts no runner-bug line: a check whose return code disagrees with
// the worst line it printed is reported by `cmd_doctor` as an EXTRA FAIL,
// which a regex for the intended verdict alone would never see.
const codexVerdicts = (out: string): string[] =>
  out.split('\n').filter((l) => /^(PASS|WARN|FAIL|SKIP) codex: /.test(l));
/** The line after the first line `re` matches — its remedy, by `_dr_line`'s contract. */
const remedyAfter = (out: string, re: RegExp): string => {
  const ls = out.split('\n');
  const i = ls.findIndex((l) => re.test(l));
  return i === -1 ? '' : (ls[i + 1] ?? '');
};
/** Every file under `roots`, by bytes AND mtime, and every directory by mtime:
 *  a rewrite of identical bytes still moves an mtime, and a tmp created and
 *  removed still moves its directory's. */
function treeState(...roots: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string): void => {
    if (!existsSync(d)) return;
    out[`${d}/`] = String(lstatSync(d).mtimeMs);
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      const st = lstatSync(p);
      if (st.isDirectory()) walk(p);
      else out[p] = `${st.mtimeMs}:${st.isFile() ? readFileSync(p, 'utf8') : 'not-a-file'}`;
    }
  };
  for (const r of roots) walk(r);
  return out;
}
const currentGen = (home: string): string => readlinkSync(join(home, '.ccrc', 'runtime', 'codex', 'current'));

describe('ccrc-doctor-checks cites deploy.sh by anchor, never by line (Plan 3a Task 4, 2b-2 carry-forward 11)', () => {
  // The seven citations this file carried by line number all pointed at
  // unrelated code when measured (six in the `deploy.sh:<N>` shape, one as
  // `deploy.sh` (:N, :M)). A quoted anchor cannot drift with the line it sits
  // on, and this pins that each one still exists in deploy.sh — so a
  // deploy.sh edit that removes one reds HERE, naming the citation to re-aim.
  const checks = readFileSync(CHECKS_SRC, 'utf8');
  const deploy = readFileSync(join(REPO, 'deploy', 'deploy.sh'), 'utf8');
  const ANCHORS = [
    'agent shared deploy ccd "$BOX":ccrc/',
    'server shared deploy ccd "$BOX":ccrc/',
    'mkdir -p ~/ccrc-backups/$TS',
    "AGENT_BUILD_CMD='_unit_atomic() {",
    '_unit_atomic ~/ccrc/deploy/systemd/ccd-pool-sync.timer',
    '_unit_atomic ~/ccrc/deploy/ccrc.service',
    '_unit_atomic ~/ccrc/deploy/ccrc-agent.service',
    '_unit_atomic ~/ccrc/deploy/systemd/ccd-cap-scopes.timer',
  ];

  it('no line cites deploy.sh by line number', () => {
    expect(checks.split('\n').filter((l) => /deploy\.sh[`']*(?::|\s*\(:)\d/.test(l))).toEqual([]);
  });

  it.each(ANCHORS)('the anchor %s is quoted here and still exists in deploy.sh', (a) => {
    expect(checks, 'ccrc-doctor-checks no longer quotes this anchor').toContain(a);
    expect(deploy, 'deploy.sh no longer carries this anchor: re-aim the citation in ccrc-doctor-checks').toContain(a);
  });
});

describeCodex('ccrc doctor: codex, part 1 — population, executables, runtime, authDir, ports and lane state (Plan 3a Task 4, spec §12)', () => {
  it('is in the table directly after models', () => {
    const names = tableNames();
    expect(names).toContain('codex');
    expect(names.indexOf('codex')).toBe(names.indexOf('models') + 1);
  });

  it("compares exactly GPT_LANE_BINS — the list ccrc-install.test.ts pins to _inst_bins' gate", () => {
    const m = /^CODEX_LANE_BINS=\(([^)]*)\)$/m.exec(readFileSync(CHECKS_SRC, 'utf8'));
    expect(m, 'ccrc-doctor-checks no longer declares CODEX_LANE_BINS on one line').toBeTruthy();
    expect(m![1]!.split(' ')).toEqual([...GPT_LANE_BINS]);
  });

  // ── the population ──────────────────────────────────────────────────────
  it('PASSes a healthy lane and names its ports, its state and the runtime — never the bare word ok', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-pass-');
    const { proxyPort, litellmPort } = lanePorts(home, 'codex-a');
    const r = runDoctor(home);
    expect(codexVerdicts(r.stdout), r.stdout).toEqual([
      `PASS codex: 1 Codex lane(s): codex-a (ports ${proxyPort}/${litellmPort}, signed in, lane.json current, `
      + `LiteLLM config current); runtime ${currentGen(home)} litellm=1.101.0; the four GPT-lane executables match the shipped tree`,
    ]);
    noRunnerBugLine(r.stdout, 'codex');
    expect(r.code, r.stdout).toBe(0);
  });

  it('names EVERY lane in the PASS — two lanes, two entries', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-pass-two-', ['codex-a', 'codex-b']);
    const line = lineFor(runDoctor(home).stdout, 'codex');
    expect(line).toMatch(/^PASS codex: 2 Codex lane\(s\): codex-a \(ports \d+\/\d+, .*\), codex-b \(ports \d+\/\d+, .*\); runtime /);
  });

  it('CCRC_ROLE unset is NOT server: the lane is measured, not skipped', async () => {
    // healthy()'s ccrc.env records no CCRC_ROLE — the reading `cmd_update` has.
    const home = await healthyCodexBox('ccrc-doctor-codex-role-unset-');
    expect(readFileSync(join(home, '.ccrc', 'ccrc.env'), 'utf8')).not.toMatch(/CCRC_ROLE/);
    expect(lineFor(runDoctor(home).stdout, 'codex')).toMatch(/^PASS codex: 1 Codex lane/);
  });

  it('SKIPs on a box that records CCRC_ROLE=server — exactly one SKIP line, no verdict, no runner-bug line', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-role-server-');
    appendFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_ROLE=server\n');
    const r = runDoctor(home);
    expect(codexVerdicts(r.stdout), r.stdout).toEqual([
      'SKIP codex: this box records CCRC_ROLE=server, so it runs no Codex lane — a server box converges nothing per account',
    ]);
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('SKIPs a roster with no Codex lane — never a PASS naming no lane', () => {
    const home = healthy('ccrc-doctor-codex-none-');
    const r = runDoctor(home);
    expect(codexVerdicts(r.stdout)).toEqual([expect.stringMatching(
      /^SKIP codex: no account in \$HOME\/\.ccrc\/accounts\.json is exec\.kind "codex", and no lane state is left under /)]);
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('SKIPs a box with no roster file at all — absent is an answer; the wrappers check owns it', () => {
    const home = healthy('ccrc-doctor-codex-noroster-');
    rmSync(join(home, '.ccrc', 'accounts.json'), { force: true });
    const r = runDoctor(home);
    expect(codexVerdicts(r.stdout)).toEqual([expect.stringMatching(
      /^SKIP codex: no account roster at \$HOME\/\.ccrc\/accounts\.json and no lane state under .* the 'wrappers' check above owns a missing roster$/)]);
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('FAILs — never SKIPs — a roster that cannot be read, naming ccrc wrappers (ruling R-C6)', () => {
    const home = healthy('ccrc-doctor-codex-badroster-');
    writeRawRoster(home, '{"version":1,"accounts":');
    const r = runDoctor(home);
    const re = /^FAIL codex: \$HOME\/\.ccrc\/accounts\.json could not be read as a roster, so its Codex lanes are unknown — an unreadable roster is not an empty one$/m;
    expect(codexVerdicts(r.stdout), r.stdout).toEqual([expect.stringMatching(re)]);
    expect(remedyAfter(r.stdout, re)).toMatch(/^ {2}remedy: run: ccrc wrappers — /);
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('FAILs — never SKIPs — a box with no jq, naming jq (ruling R-C6)', () => {
    const home = healthy('ccrc-doctor-codex-nojq-');
    unstub(home, 'jq');
    const r = runDoctor(home);
    const re = /^FAIL codex: jq is not on PATH, so which roster accounts are Codex lanes cannot be told/m;
    expect(codexVerdicts(r.stdout), r.stdout).toEqual([expect.stringMatching(re)]);
    expect(remedyAfter(r.stdout, re)).toMatch(/^ {2}remedy: install jq /);
    noRunnerBugLine(r.stdout, 'codex');
  });

  // ── the executables and the runtime ─────────────────────────────────────
  it('FAILs a GPT-lane executable missing from ~/.local/bin, and one that drifted from the shipped tree', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-bins-');
    rmSync(join(binDir(home), 'ccrc-codex'));
    appendFileSync(join(binDir(home), 'ccgpt-usage.py'), '\n# edited on the box\n');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL codex: ccrc-codex missing from \$HOME\/\.local\/bin, or not executable — every Codex lane needs all four$/m);
    expect(r.stdout).toMatch(/^FAIL codex: ccgpt-usage\.py in \$HOME\/\.local\/bin differ from the shipped tree's copies in /m);
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('FAILs a shipped tree that lacks one of them — the compare has no source', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-notree-');
    rmSync(join(home, 'ccrc', 'ccd', 'ccgpt-runtime'));
    expect(runDoctor(home).stdout).toMatch(/^FAIL codex: the shipped tree \(.*\/ccrc\/ccd\) has no ccgpt-runtime, /m);
  });

  const restamp = (home: string, patch: Record<string, string>): void => {
    const rt = plantFakeRuntime(home);
    writeFileSync(rt.stamp, `${JSON.stringify({ ...JSON.parse(readFileSync(rt.stamp, 'utf8')), ...patch })}\n`);
  };
  it.each([
    ['absent', (h: string) => rmSync(join(h, '.ccrc', 'runtime'), { recursive: true, force: true }),
      /no isolated LiteLLM runtime is current on this box \(ccgpt-runtime check: absent\)/],
    ['requirement-moved', (h: string) => restamp(h, { requirement: 'litellm[proxy]>=0.0.1,<0.0.2' }),
      /built for another LiteLLM requirement than this ccrc declares \(ccgpt-runtime check: requirement-moved\)/],
    ['probe-moved', (h: string) => restamp(h, { probeSha256: '0'.repeat(64) }),
      /passed an older behaviour probe than the one this ccrc ships \(ccgpt-runtime check: probe-moved\)/],
    ['mutated', (h: string) => { plantFakeRuntime(h, { stamp: false }); },
      /no longer matches its stamp \(ccgpt-runtime check: mutated\)/],
  ] as const)('FAILs a runtime that `ccgpt-runtime check` answers %s, in its own sentence, with a rebuild remedy', async (word, plant, said) => {
    const home = await healthyCodexBox(`ccrc-doctor-codex-rt-${word}-`);
    plant(home);
    const r = runDoctor(home);
    const re = new RegExp(`^FAIL codex: .*${said.source}`, 'm');
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toMatch(/ccgpt-runtime build/);
    noRunnerBugLine(r.stdout, 'codex');
  });

  // ── authDir: existence and mode only ────────────────────────────────────
  it('FAILs an authDir that does not exist, and one that is not a directory', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-auth-absent-');
    const dir = authDirOf(home, 'codex-a');
    rmSync(dir, { recursive: true, force: true });
    const gone = runDoctor(home);
    const re = /^FAIL codex: codex-a's authDir ~\/\.local\/share\/ccrc\/codex\/codex-a does not exist/m;
    expect(gone.stdout).toMatch(re);
    expect(remedyAfter(gone.stdout, re)).toMatch(/ccrc codex login codex-a/);
    writeFileSync(dir, 'not a directory\n');
    expect(runDoctor(home).stdout).toMatch(/^FAIL codex: codex-a's authDir ~\/\S+ is not a directory this user can list and search/m);
  });

  it('FAILs an authDir with no auth.json in the words `ccrc codex start` refuses with', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-auth-nologin-');
    rmSync(join(authDirOf(home, 'codex-a'), 'auth.json'));
    const r = runDoctor(home);
    const re = /^FAIL codex: codex-a has no OAuth login: ~\/\S+ holds no auth\.json \(existence is all ccrc checks; it never reads one\)/m;
    expect(r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toBe('  remedy: sign the lane in: ccrc codex login codex-a');
  });

  // Root reads a 0000 file anyway, so the discriminator proves nothing there — a
  // visible skip, not a false green.
  it.skipIf(PY === null || (typeof process.getuid === 'function' && process.getuid() === 0))(
    'PASSes a 0000-mode auth.json — existence and mode are all it asks; nothing under authDir is opened', async () => {
      const home = await healthyCodexBox('ccrc-doctor-codex-auth-0000-');
      chmodSync(join(authDirOf(home, 'codex-a'), 'auth.json'), 0o000);
      expect(lineFor(runDoctor(home).stdout, 'codex')).toMatch(/^PASS codex: 1 Codex lane\(s\): codex-a \(ports \d+\/\d+, signed in, /);
    });

  it.skipIf(PY === null || (typeof process.getuid === 'function' && process.getuid() === 0))(
    'FAILs an authDir this user cannot search', async () => {
      const home = await healthyCodexBox('ccrc-doctor-codex-auth-000dir-');
      const dir = authDirOf(home, 'codex-a');
      chmodSync(dir, 0o000);
      try {
        expect(runDoctor(home).stdout).toMatch(/^FAIL codex: codex-a's authDir ~\/\S+ is not a directory this user can list and search/m);
      } finally {
        chmodSync(dir, 0o700);
      }
    });

  // ── the roster row: ports ───────────────────────────────────────────────
  it('FAILs a hand-edited row whose port is not a port, in the row reader\'s own words', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-port-bad-');
    editRosterRow(home, 'codex-a', (row) => { row['exec'].proxyPort = 70000; });
    const r = runDoctor(home);
    const re = /^FAIL codex: codex-a's codex row cannot be used \(roster-invalid: .*exec\.proxyPort\/exec\.litellmPort.*\), and until it is fixed no Codex lane's model state can be read/m;
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toMatch(/ccrc never chooses a lane's ports or paths for you$/);
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('FAILs two lanes that share a port — belt and braces behind the roster refusal', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-port-collide-', ['codex-a', 'codex-b']);
    const shared = lanePorts(home, 'codex-a').proxyPort;
    editRosterRow(home, 'codex-b', (row) => { row['exec'].litellmPort = shared; });
    const r = runDoctor(home);
    const re = new RegExp(`^FAIL codex: codex-a and codex-b both use port ${shared}, `, 'm');
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toMatch(/ccrc never chooses a port$/);
    noRunnerBugLine(r.stdout, 'codex');
  });

  // ── lane.json ───────────────────────────────────────────────────────────
  it('FAILs an absent lane.json, and one the roster row has moved away from', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-lanejson-');
    const lane = join(home, '.ccrc', 'codex', 'codex-a', 'lane.json');
    const text = readFileSync(lane, 'utf8');
    rmSync(lane);
    expect(runDoctor(home).stdout).toMatch(/^FAIL codex: codex-a has no lane\.json \(/m);
    writeFileSync(lane, text);
    // The roster moves the lane's authDir; lane.json still names the old one.
    editRosterRow(home, 'codex-a', (row) => { row['exec'].authDir = '.local/share/ccrc/codex/codex-a-moved'; });
    plantLaneAuth(home, 'codex-a');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL codex: codex-a's lane\.json disagrees with its roster row /m);
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('FAILs a lane.json gone stale against the REGISTRY (ruling R7) — and measuring it wrote nothing', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-lanejson-registry-');
    // The operator's haiku moves by hand; nothing re-rendered lane.json.
    writeLaneModels(home, 'codex-a', { classes: { haiku: 'gpt-x-mini', sonnet: 'gpt-x', opus: null, fable: null } });
    const roots = [join(home, '.ccrc', 'codex'), join(home, '.ccrc', 'models'), join(home, '.claude-codex-a')];
    const before = treeState(...roots);
    const r = runDoctor(home);
    const re = /^FAIL codex: codex-a's lane\.json is stale against its class registry: /m;
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toMatch(/re-render it: ccrc models codex-a set-subagent sonnet /);
    expect(treeState(...roots)).toEqual(before);
    noRunnerBugLine(r.stdout, 'codex');
  });

  // ── the class registry, through models-op ───────────────────────────────
  it('FAILs a Codex lane with no class registry, and one whose registry is another probe\'s', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-registry-');
    rmSync(join(home, '.ccrc', 'models', 'codex-a.classes.json'));
    const none = runDoctor(home);
    const re = /^FAIL codex: codex-a is a Codex lane with no class registry, /m;
    expect(none.stdout).toMatch(re);
    expect(remedyAfter(none.stdout, re)).toBe('  remedy: create it: ccrc models codex-a init codex, then ccrc models refresh codex-a');
    writeLaneModels(home, 'codex-a', {
      probe: 'openrouter', classes: { haiku: null, sonnet: null, opus: null, fable: null }, discovery: [],
    });
    expect(runDoctor(home).stdout).toMatch(/^FAIL codex: codex-a is a Codex lane whose class registry declares probe "openrouter": /m);
  });

  it('WARNs a lane that routes haiku to nothing, and one whose probe model left the catalogue', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-haiku-', ['codex-a', 'codex-b']);
    writeLaneModels(home, 'codex-a', { classes: { haiku: null, sonnet: 'gpt-x', opus: null, fable: null } });
    renderLane(home, 'codex-a');
    writeLaneModels(home, 'codex-b', { models: ['gpt-x', 'gpt-x-mini'] });
    renderLane(home, 'codex-b');
    const r = runDoctor(home);
    expect(codexVerdicts(r.stdout), r.stdout).toEqual([
      expect.stringMatching(/^WARN codex: codex-a routes haiku to nothing, so its lane\.json carries no probe model /),
      expect.stringMatching(/^WARN codex: codex-b's usage probe model, probe-model \(its haiku class\), is absent from the lane's current catalogue/),
    ]);
    noRunnerBugLine(r.stdout, 'codex');
  });

  // ── the rendered LiteLLM config ─────────────────────────────────────────
  it('FAILs a stale LiteLLM config, an absent one, and a lane never probed — and measuring wrote nothing', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-litellm-');
    const yaml = join(home, '.ccrc', 'codex', 'codex-a', 'litellm.yaml');
    appendFileSync(yaml, '# edited on the box\n');
    const edited = readFileSync(yaml, 'utf8');
    const stale = runDoctor(home);
    const re = /^FAIL codex: codex-a's LiteLLM config \(.*litellm\.yaml\) is stale against the lane's catalogue: /m;
    expect(stale.stdout, stale.stdout).toMatch(re);
    expect(remedyAfter(stale.stdout, re)).toMatch(/re-render it: ccrc models litellm codex-a /);
    expect(readFileSync(yaml, 'utf8')).toBe(edited);
    rmSync(yaml);
    expect(runDoctor(home).stdout).toMatch(/^FAIL codex: codex-a has no rendered LiteLLM config \(/m);
    expect(existsSync(yaml)).toBe(false);
    rmSync(join(home, '.ccrc', 'models', 'codex-a.json'));
    const never = runDoctor(home);
    expect(never.stdout).toMatch(/^FAIL codex: codex-a has never been probed, /m);
    expect(remedyAfter(never.stdout, /^FAIL codex: codex-a has never been probed/m)).toBe('  remedy: probe it: ccrc models refresh codex-a');
  });

  // ── lane state left behind ──────────────────────────────────────────────
  it('WARNs lane state left for an id that is no longer a Codex lane — a flip back keeps it — and never deletes it', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-flipback-', ['codex-a', 'codex-b']);
    const keep = lanePorts(home, 'codex-a');
    codexRoster(home, [{ id: 'codex-a', ...keep }], [{
      id: 'codex-b', label: 'codex-b', configDirSuffix: '.claude-codex-b',
      exec: { kind: 'external' }, homeAble: false, telemetry: 'codex',
    }], { accountsSh: false });
    const r = runDoctor(home);
    expect(codexVerdicts(r.stdout), r.stdout).toEqual([expect.stringMatching(
      /^WARN codex: lane state is left under \S+\/\.ccrc\/codex\/codex-b, and 'codex-b' is not a Codex lane in /)]);
    expect(existsSync(join(home, '.ccrc', 'codex', 'codex-b', 'lane.json'))).toBe(true);
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('left lane state is a subject even with no Codex lane at all — a WARN, never the empty-population SKIP', () => {
    const home = healthy('ccrc-doctor-codex-leftonly-');
    mkdirSync(join(home, '.ccrc', 'codex', 'ext-a'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'codex', 'ext-a', 'lane.json'), '{}\n');
    const r = runDoctor(home);
    expect(codexVerdicts(r.stdout)).toEqual([expect.stringMatching(/^WARN codex: lane state is left under \S+\/ext-a, /)]);
    noRunnerBugLine(r.stdout, 'codex');
  });

  // ── the worst class ─────────────────────────────────────────────────────
  it('one lane FAILing and another WARNing: FAIL lines, then WARN lines, each with its own remedy, and the check returns the worst', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-worst-', ['codex-a', 'codex-b']);
    rmSync(join(authDirOf(home, 'codex-a'), 'auth.json'));
    writeLaneModels(home, 'codex-b', { classes: { haiku: null, sonnet: 'gpt-x', opus: null, fable: null } });
    renderLane(home, 'codex-b');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const at = (re: RegExp): number => lines.findIndex((l) => re.test(l));
    const f = at(/^FAIL codex: codex-a has no OAuth login/);
    const w = at(/^WARN codex: codex-b routes haiku to nothing/);
    expect(f, r.stdout).toBeGreaterThan(-1);
    expect(w).toBeGreaterThan(f);
    expect(lines[f + 1]).toMatch(/^ {2}remedy: \S/);
    expect(lines[w + 1]).toMatch(/^ {2}remedy: \S/);
    noRunnerBugLine(r.stdout, 'codex');
    expect(r.code).toBe(1);
  });
});
```

- [ ] **Step 2: Run them red**

```bash
. "<abs scratch>/plan3a-env.sh"; cd "$(git rev-parse --show-toplevel)/server"
"$CENSUS" "$EVID/t4-2-models-op" ./node_modules/.bin/vitest run test/models-op.test.ts
```

```bash
. "<abs scratch>/plan3a-env.sh"; cd "$(git rev-parse --show-toplevel)/server"
"$CENSUS" "$EVID/t4-2-doctor-<k>" ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t <P>   # three calls, k = 1, 2, 3 (the Global Constraints' parts); the counts below are their sum
```

Expected. They were measured on a scratch copy of `1f9fa22d` WITHOUT Tasks 1 and 3, so the doctor total is re-derived for the execution order, in which Task 3's six doctor cases land first (Task 1 adds none under ruling Z): Step 0's own total plus this task's 39 cases.
- `models-op`: `Tests 4 failed | 107 passed (111)` on `1f9fa22d`'s 106, measured without Task 2, i.e. Step 0's own total plus five: `4 failed | 111 passed (115)` once Task 2's four have landed. The four `--check true` cases red on `unknown key --check` (exit 2). The fifth, the typo case, is green on both sides, because the old op refuses the unknown key with the same exit 2. Its red mutation is row MO3.
- `ccrc-doctor`: `Tests 47 failed | 497 passed | 4 skipped (548)` (re-derive; the copy without Tasks 1 and 3 measured `47 failed | 491 passed | 4 skipped (542)`):
  - all 39 new cases (the citation pin: no line cites by number, and each of the eight anchors; the table, `lane_bins` and every `_check_codex` case, since no codex line is printed);
  - the eight `HEALTHY_SKIPS` pins listed in Why, because the constant is raised and the check is not in the table yet;
  - no other case. In particular the five `wrappers` codex cases stay GREEN: they read the `wrappers` line, and no other check fails their now-converged lane.

- [ ] **Step 3: Implement `materialise --check true` in `deploy/models-op.mjs`**

Four same-count edits, then the new functions, then the arm.

1. The helper comment (:115-116). Old:

```js
// `rm` names these two directly — `materialise` builds the same two paths off
// an `account`, which an ORPHAN id has none of.
```

New:

```js
// `rm` and `materialise` both name these two by id (`materialFiles`): an ORPHAN
// id has no `account` to build a path off, so neither builds one off it.
```

2. `materialise`'s two locals (:341-342). Old:

```js
  const classes = path.join(modelsDir(), `${account.id}.classes.tsv`);
  const effort = path.join(modelsDir(), `${account.id}.effort.json`);
```

New — the two helpers `rm` already uses, so `materialFiles` and the writer's `wrote` answer name one path each:

```js
  const classes = classesTsvPath(account.id);
  const effort = effortPath(account.id);
```

3. `materialise`'s file list (:403-406). Old:

```js
    const files = [[classes, classesTsv(registry, catalogue)],
      [effort, `${JSON.stringify(effortFile(registry, catalogue))}\n`]];
    if (lane !== null) files.push([lane, `${JSON.stringify(manifest, null, 2)}\n`]);
    for (const [p, text] of files) {
```

New:

```js
    // ONE list of what is rendered whole, shared with `materialiseCheck`
    // (Plan 3a Task 4), so "what materialise writes" cannot mean two things.
    const files = materialFiles(account, registry, catalogue);
    for (const [, p, text] of files) {
```

4. `OPS.materialise` (:578). Old `  materialise: { keys: ['file', 'id'], required: ['file', 'id'] },`. New:

```js
  // `check` is OPTIONAL (Plan 3a Task 4): `--check true` is the check-only
  // form, which writes nothing and answers `changed`; omitted, the op writes,
  // as every caller before it expects. Any other value is refused.
  materialise: { keys: ['file', 'id', 'check'], required: ['file', 'id'] },
```

5. Directly after the `OPS` table's closing `};` (the line after the `litellm:` row), insert:

```js
/** The files `materialise` renders WHOLE, as `[key, path, text]` in write
 *  order: the TSV, the effort file and — on a codex-kind lane only — spec
 *  §5.4's `lane.json`. ONE list for the writer (`materialise`) and the checker
 *  (`materialiseCheck`, Plan 3a Task 4), so "what materialise would write"
 *  cannot mean two things. `settings.json` is not here: it is MERGED into a
 *  file the operator owns, never rendered whole, and `show`'s `settingsDrift`
 *  is its measurement. Throws what `classesTsv` and `effortFile` throw; both
 *  callers catch it. */
function materialFiles(account, registry, catalogue) {
  const manifest = laneManifest(account, registry);
  const files = [
    ['classes', classesTsvPath(account.id), classesTsv(registry, catalogue)],
    ['effort', effortPath(account.id), `${JSON.stringify(effortFile(registry, catalogue))}\n`],
  ];
  if (manifest !== null) files.push(['lane', laneJsonPath(account.id), `${JSON.stringify(manifest, null, 2)}\n`]);
  return files;
}

/** `materialise --check true` (Plan 3a Task 4, ruling R7, D-3712):
 *  renders exactly what `materialise` would write whole and compares it with the bytes on
 *  disk, WRITING NOTHING — no tmp, no directory, no settings merge. `ccrc
 *  doctor`'s `_check_codex` asks it whether a lane's `lane.json` has gone
 *  stale against the class registry (a haiku reassigned by hand, a write
 *  interrupted between two files), which the roster-only compare in
 *  `ccd/ccrc`'s `_codex_lane_json_state` cannot see. `changed` maps each of
 *  `materialFiles`' keys to true when the file is absent or its bytes differ;
 *  `lane` is null on a lane that is not `exec.kind: "codex"`, the writer's own
 *  "legitimately not written". `changed` is null when there is no registry:
 *  nothing would be rendered at all. A file that EXISTS and cannot be read is
 *  a refusal, never "changed": the two remedies differ. */
function materialiseCheck(account, registry, catalogue) {
  if (registry === null) return { changed: null };
  let files;
  try {
    files = materialFiles(account, registry, catalogue);
  } catch (e) {
    if (e instanceof ModelEnvInvalid) return { err: ['settings-unwritable', e.message] };
    return { err: ['materialise-failed', `${e.message}`] };
  }
  const changed = { lane: null };
  for (const [key, p, text] of files) {
    let onDisk;
    try {
      onDisk = readFileSync(p, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') { changed[key] = true; continue; }
      return { err: ['materialise-unreadable', `${p} exists and could not be read: ${e.message}. Nothing was written.`] };
    }
    changed[key] = onDisk !== text;
  }
  return { changed };
}
```

6. The `materialise` arm (:830). Old:

```js
  if (opName === 'materialise') {
    const mat = materialise(account, registry, catalogue);
```

New:

```js
  if (opName === 'materialise') {
    // Plan 3a Task 4: `--check true` answers what a write WOULD change and
    // writes nothing. Any other value is refused before anything is written,
    // because a typo must never fall through to the write.
    if (a.check !== undefined) {
      if (a.check !== 'true') {
        return refuse(2, 'bad-argv',
          `--check takes only the value "true" (got ${JSON.stringify(a.check)}); leave it out to write.`);
      }
      const chk = materialiseCheck(account, registry, catalogue);
      if (chk.err !== undefined) return refuse(1, chk.err[0], chk.err[1]);
      out({ ok: true, op: 'materialise', id: a.id, check: true, changed: chk.changed });
      return 0;
    }
    const mat = materialise(account, registry, catalogue);
```

```bash
. "<abs scratch>/plan3a-env.sh"; cd "$(git rev-parse --show-toplevel)/server"
node --check ../deploy/models-op.mjs
"$CENSUS" "$EVID/t4-3-models-op" ./node_modules/.bin/vitest run test/models-op.test.ts    # → Tests 115 passed (115) in the execution order: Step 0's own total plus five (re-derive; 111 on `1f9fa22d` without Task 2)
```

- [ ] **Step 4: Implement `_check_codex` part 1, its table entry and the seven citations in `ccd/ccrc-doctor-checks`**

1. The table (:205). Old `  models`. New, ON THE SAME LINE:

```bash
  models codex   # two entries on one line: every line below is cited by number elsewhere
```

2. The seven citations, each rewritten on its own line (Old → New):
   - :274 `` (deploy.sh:343), so `` → `` (deploy.sh's agent-arm rsync, `agent shared deploy ccd "$BOX":ccrc/`), so ``
   - :276 `` (deploy.sh:613), so `` → `` (deploy.sh's server-arm rsync, `server shared deploy ccd "$BOX":ccrc/`), so ``
   - :741 `` # cap-scopes timer, and `deploy.sh` (:417, :464) is what puts each there. `` → `` # cap-scopes timer, and `deploy.sh` puts each there (`_unit_atomic ~/ccrc/deploy/ccrc.service`, `_unit_atomic ~/ccrc/deploy/ccrc-agent.service`, `_unit_atomic ~/ccrc/deploy/systemd/ccd-cap-scopes.timer`). ``
   - :1152 `` (deploy.sh:401), so until this branch existed `` → `` (deploy.sh's agent-arm rsync, `agent shared deploy ccd "$BOX":ccrc/`), so until this branch existed ``
   - :2168 `` (deploy.sh:33-34), and `` → `` (each deploy.sh arm's `mkdir -p ~/ccrc-backups/$TS`), and ``
   - :3737 `` though: `deploy/deploy.sh:785`'s `` → `` though: deploy.sh's agent-arm (`AGENT_BUILD_CMD='_unit_atomic() {`) `` — the next line's `` `_unit_atomic` — CLAUDE.md's … `` then reads on
   - :3740 `` unconditionally (`deploy/deploy.sh:798`) `` → `` unconditionally (its `_unit_atomic ~/ccrc/deploy/systemd/ccd-pool-sync.timer` line) ``
3. Append after the file's last line:

```bash
# ── codex: the ccrc-owned Codex lanes on this box, measured end to end ────
# Spec §12 (Plan 3a Tasks 4 and 5). ONE check, every Codex lane, and every
# finding on its OWN line with its OWN remedy — FAIL lines first, then WARN
# lines, the return code the worst of them ("ONE CHECK MAY ANSWER IN TWO
# CLASSES", this file's header) — because a lane with no authDir and a lane
# with a stale shim are two operator actions, never one bucket.
#
# THE POPULATION is the roster's `exec.kind == "codex"` rows, read by the lane
# library's ONE reader of that question (`_codex_lanes`, ccd/ccrc) — never
# accounts.sh's telemetry-keyed CCRC_CODEX_BACKEND, which names the EXTERNAL
# lanes another repository runs — plus any lane directory left under
# `_codex_lane_dir` for an id the roster no longer calls codex: a flip back to
# another launcher keeps that state on purpose, and it is WARNed, never
# silently skipped (D-3713).
#   - role `server`: SKIP, a server box converges nothing per account
#     (D-3111). CCRC_ROLE unset or unreadable reads as NOT server, as
#     `cmd_update` reads it.
#   - no roster FILE at all: SKIP. ABSENT is a positive answer, and a missing
#     roster is the `wrappers` check's FAIL (D-3723).
#   - `_codex_lanes` rc 1 (the roster cannot be read) or rc 2 (no jq): FAIL,
#     never SKIP (ruling R-C6, D-3710).
#     An unreadable roster is not an empty one, and
#     a SKIP there would read "no Codex lane" on a box that has some — the
#     overloaded null this codebase bans by name.
#   - no Codex lane and no left lane state: SKIP, never a PASS naming no lane
#     (a scan over an empty set passes everything: `_check_models`' C5).
#
# READ-ONLY, THE WHOLE WAY DOWN. Registry and catalogue facts come ONLY
# through `deploy/models-op.mjs`'s check-only answers — `show`, `materialise
# --check true` and `litellm` without `--commit` — so this file never names
# the class registry's file (single-definition.test.ts pins that count at the
# lines `_check_models` has), and no row here writes, renders, mkdirs,
# starts or stops anything. `exec.authDir` is asked for existence and mode
# ONLY: nothing under it is ever opened (spec §9).
#
# THE RUNTIME ROW TRUSTS THE STAMP (ruling R-C5,
# D-3711). `ccgpt-runtime check` compares the
# current generation's stamp with this build's LiteLLM requirement, its
# behaviour probe's hash and the installed LiteLLM version; it never re-runs
# the probe, which may take CCRC_RUNTIME_PROBE_S (300 s), and doctor closes
# every install and update. `ccgpt-runtime build` is what re-probes.
_check_codex() {
  local role=""
  # `${BOX_ENV_FILE:-}`, `-f` before `-r`: `_check_accounts`' own reading.
  [ -f "${BOX_ENV_FILE:-}" ] && [ -r "${BOX_ENV_FILE:-}" ] && role="$(_box_env_value "$BOX_ENV_FILE" CCRC_ROLE)"
  if [ "$role" = server ]; then
    _dr_skip codex "this box records CCRC_ROLE=server, so it runs no Codex lane — a server box converges nothing per account"
    return 3
  fi
  # The loaded-guard `_check_update-sync` carries: every function below is
  # ccrc's own, and a table sourced by something else must say so, not die.
  local fn
  for fn in _box_env_value _codex_lanes _codex_row _codex_lane_json_state _codex_lane_dir \
            _codex_litellm_yaml _codex_runtime_cli _models_node _models_roster_path _models_litellm_template; do
    if ! declare -F "$fn" >/dev/null 2>&1 || [ -z "${BOX_TREE_DIR:-}" ]; then
      _dr_fail codex "ccrc's own Codex lane library is not loaded ($fn, or BOX_TREE_DIR, is missing), so no lane on this box was measured" \
        "this is a bug in ccrc, not a fact about your box — _check_codex calls the _codex_* library declared in ccrc itself, and this check table was sourced by something that is not ccrc"
      return 1
    fi
  done
  local roster root out rc=0 id d n
  roster="$(_models_roster_path)"
  root="$(_codex_lane_dir '')"; root="${root%/}"
  local -a lanes=() left=()
  if [ -e "$roster" ] || [ -L "$roster" ]; then
    out="$(_codex_lanes 2>/dev/null)"; rc=$?
    case "$rc" in
      0) [ -z "$out" ] || mapfile -t lanes <<< "$out" ;;
      2)
        _dr_fail codex "jq is not on PATH, so which roster accounts are Codex lanes cannot be told — a box that has some would read as having none" \
          "install jq (the 'jq' check above names what is missing), then re-run doctor"
        return 1 ;;
      *)
        _dr_fail codex "\$HOME/.ccrc/accounts.json could not be read as a roster, so its Codex lanes are unknown — an unreadable roster is not an empty one" \
          "run: ccrc wrappers — it prints the roster validator's own sentence; fix what it names, then re-run doctor"
        return 1 ;;
    esac
  fi
  for d in "$root"/*/; do
    [ -d "$d" ] || continue
    n="${d%/}"; n="${n##*/}"
    _dr_cx_member "$n" ${lanes[@]+"${lanes[@]}"} || left+=("$n")
  done
  if [ "${#lanes[@]}" -eq 0 ] && [ "${#left[@]}" -eq 0 ]; then
    if [ -e "$roster" ] || [ -L "$roster" ]; then
      _dr_skip codex "no account in \$HOME/.ccrc/accounts.json is exec.kind \"codex\", and no lane state is left under $root, so there is no Codex lane to measure"
    else
      _dr_skip codex "no account roster at \$HOME/.ccrc/accounts.json and no lane state under $root, so this box has no Codex lane — the 'wrappers' check above owns a missing roster"
    fi
    return 3
  fi

  local -a DRX_CLASS=() DRX_WHAT=() DRX_FIX=() DRX_OK=() bad=()
  local -A owner=()
  local DRX_RUNTIME='' DRX_LANE_WORDS='' models=1 p
  if [ "${#lanes[@]}" -gt 0 ]; then
    _dr_cx_bins
    _dr_cx_runtime
    if ! command -v node >/dev/null 2>&1; then
      models=0
      _dr_cx_fail "node is not on PATH, so no Codex lane's class registry, lane.json or LiteLLM config could be measured against its catalogue" \
        "install Node (the 'node' check above names what is missing), then re-run doctor"
    fi
    # EVERY ROW FIRST, then every lane. A hand-edited row, or two lanes on one
    # port, makes the whole roster one `deploy/models-op.mjs` refuses to read,
    # so no lane's model state can be measured until it is fixed — known
    # before any lane is asked, and said once, on the row's own line.
    for id in "${lanes[@]}"; do
      if ! _codex_row "$id" 2>/dev/null; then
        out="$(_codex_row "$id" 2>&1 >/dev/null)"; out="${out#"${PROG:-ccrc} codex: "}"
        _dr_cx_fail "$id's codex row cannot be used ($out), and until it is fixed no Codex lane's model state can be read — the roster does not validate" \
          "fix the row in \$HOME/.ccrc/accounts.json by hand ('ccrc wrappers' prints the roster validator's own sentence for it); ccrc never chooses a lane's ports or paths for you"
        bad+=("$id"); models=0; continue
      fi
      # Belt and braces behind `parseRoster`'s own refusal (spec §12): both
      # ports of every lane share ONE map, `shared/roster.ts`'s rule, because
      # a shim port that is another lane's LiteLLM port is as wrong as two
      # shim ports.
      for p in "$CX_PROXY" "$CX_LITELLM"; do
        if [ -n "${owner[$p]:-}" ] && [ "${owner[$p]}" != "$id" ]; then
          _dr_cx_fail "${owner[$p]} and $id both use port $p, so one lane's requests would reach the other lane's OAuth — and until it is fixed no Codex lane's model state can be read (the roster does not validate)" \
            "give each Codex lane its own two ports in \$HOME/.ccrc/accounts.json by hand; ccrc never chooses a port"
          bad+=("$id" "${owner[$p]}"); models=0
        else
          owner[$p]="$id"
        fi
      done
    done
    for id in "${lanes[@]}"; do
      _dr_cx_member "$id" ${bad[@]+"${bad[@]}"} && continue
      _dr_cx_lane "$id" "$models" "$roster"
      DRX_OK+=("$id ($DRX_LANE_WORDS)")
    done
  fi
  for n in ${left[@]+"${left[@]}"}; do
    _dr_cx_warn "lane state is left under $root/$n, and '$n' is not a Codex lane in \$HOME/.ccrc/accounts.json — a flip back to another launcher keeps it on purpose, and nothing of ccrc's reads it while '$n' is not a Codex lane" \
      "if the flip back is final and ccrc runs nothing for '$n' any more (its tiers were stopped with 'ccrc codex stop $n' before the flip), remove $root/$n by hand; ccrc never deletes a lane's state on a flip"
  done
  _dr_cx_report "${#lanes[@]} Codex lane(s): $(_dr_cx_join ', ' ${DRX_OK[@]+"${DRX_OK[@]}"}); runtime ${DRX_RUNTIME:-unmeasured}; the four GPT-lane executables match the shipped tree"
}

# `_check_codex`'s findings, recorded into the caller's DRX_CLASS/DRX_WHAT/
# DRX_FIX (bash's dynamic scope: they are `local` to `_check_codex`) and
# printed by `_dr_cx_report`, so each is one sentence plus its own remedy.
_dr_cx_find()   { DRX_CLASS+=("$1"); DRX_WHAT+=("$2"); DRX_FIX+=("$3"); }
_dr_cx_fail()   { _dr_cx_find FAIL "$1" "$2"; }
_dr_cx_warn()   { _dr_cx_find WARN "$1" "$2"; }
_dr_cx_member() { local x="$1" y; shift; for y in "$@"; do [ "$y" = "$x" ] && return 0; done; return 1; }
_dr_cx_join()   { local sep="$1" out="" x; shift; for x in "$@"; do out+="${out:+$sep}$x"; done; printf '%s' "$out"; }

# Every FAIL line, then every WARN line, each with its own remedy; the return
# code is the worst class printed (cmd_doctor cross-checks the two, and a
# disagreement is its own FAIL). PASS only when nothing was found at all.
_dr_cx_report() {   # <PASS detail>
  local i worst=0
  if [ "${#DRX_CLASS[@]}" -eq 0 ]; then
    _dr_pass codex "$1"
    return 0
  fi
  for i in "${!DRX_CLASS[@]}"; do
    [ "${DRX_CLASS[$i]}" = FAIL ] || continue
    _dr_fail codex "${DRX_WHAT[$i]}" "${DRX_FIX[$i]}"; worst=1
  done
  for i in "${!DRX_CLASS[@]}"; do
    [ "${DRX_CLASS[$i]}" = WARN ] || continue
    _dr_warn codex "${DRX_WHAT[$i]}" "${DRX_FIX[$i]}"; [ "$worst" -eq 1 ] || worst=2
  done
  return "$worst"
}

# The four GPT-lane executables against the SHIPPED TREE, byte for byte —
# `_check_skills`' rule (the tree the stamp names, `$BOX_TREE_DIR/ccd`), with
# `cmp` where that check uses `diff`. `CODEX_LANE_BINS` is `_inst_bins`'
# GPT-lane gate, in its order, declared ONCE at file level so `_fix_codex`
# (Task 8) restores exactly what this compares. ccrc-doctor.test.ts pins this
# one line to `GPT_LANE_BINS`, which ccrc-install.test.ts pins to the gate
# itself, so a fifth executable or a rename reds there before this list can drift.
CODEX_LANE_BINS=(ccgpt-proxy.py ccgpt-usage.py ccgpt-runtime ccrc-codex)
_dr_cx_bins() {
  local tree="$BOX_TREE_DIR/ccd" bin="$HOME/.local/bin" name
  local -a notree=() missing=() drift=()
  if ! command -v cmp >/dev/null 2>&1; then
    _dr_cx_warn "cmp is not on PATH, so the GPT-lane executables in \$HOME/.local/bin could not be compared with the shipped tree — unmeasured, not current" \
      "install diffutils (it ships cmp), then re-run doctor"
    return 0
  fi
  for name in "${CODEX_LANE_BINS[@]}"; do
    if [ ! -f "$tree/$name" ]; then notree+=("$name"); continue; fi
    if [ ! -f "$bin/$name" ] || [ ! -x "$bin/$name" ]; then missing+=("$name"); continue; fi
    cmp -s "$tree/$name" "$bin/$name" || drift+=("$name")
  done
  [ "${#notree[@]}" -eq 0 ] || _dr_cx_fail "the shipped tree ($tree) has no $(_dr_cx_join ', ' "${notree[@]}"), so nothing on this box says what the GPT-lane executables should be" \
    "run 'ccrc update' (or 'ccrc install' from a checkout) to place the shipped tree"
  [ "${#missing[@]}" -eq 0 ] || _dr_cx_fail "$(_dr_cx_join ', ' "${missing[@]}") missing from \$HOME/.local/bin, or not executable — every Codex lane needs all four" \
    "run 'ccrc update' (or 'ccrc install' from a checkout): it places them from the shipped tree on every role but server"
  [ "${#drift[@]}" -eq 0 ] || _dr_cx_fail "$(_dr_cx_join ', ' "${drift[@]}") in \$HOME/.local/bin differ from the shipped tree's copies in $tree, so a lane would run bytes this build did not ship" \
    "run 'ccrc update' (or 'ccrc install' from a checkout): it re-places them from the shipped tree"
  return 0
}

# The isolated runtime, by `ccgpt-runtime check` — one word per failure, each
# its own sentence and remedy. A `ccgpt-runtime` that is not there is the
# executables row's finding, said there once.
_dr_cx_runtime() {
  local cli ans rc
  cli="$(_codex_runtime_cli)"
  [ -x "$cli" ] || return 0
  ans="$("$cli" check 2>&1)"; rc=$?
  case "$rc:$ans" in
    "0:ccgpt-runtime: current "*) DRX_RUNTIME="${ans#ccgpt-runtime: current }" ;;
    "1:ccgpt-runtime: absent")
      _dr_cx_fail "no isolated LiteLLM runtime is current on this box (ccgpt-runtime check: absent), so no Codex lane can start its tiers" \
        "build it: ccgpt-runtime build (ccrc install and ccrc update run the same build)" ;;
    "1:ccgpt-runtime: requirement-moved")
      _dr_cx_fail "the current runtime generation was built for another LiteLLM requirement than this ccrc declares (ccgpt-runtime check: requirement-moved), so it is out of the range this build was probed against" \
        "rebuild it: ccgpt-runtime build — it builds, probes and swaps in a generation for the declared range, and the old one stays current until the new one passes" ;;
    "1:ccgpt-runtime: probe-moved")
      _dr_cx_fail "the current runtime generation passed an older behaviour probe than the one this ccrc ships (ccgpt-runtime check: probe-moved), so what it was proven to do is not what this build checks" \
        "rebuild it: ccgpt-runtime build — it re-runs the shipped probe against a fresh generation" ;;
    "1:ccgpt-runtime: mutated")
      _dr_cx_fail "the current runtime generation no longer matches its stamp (ccgpt-runtime check: mutated): its interpreter, its stamp or its installed LiteLLM changed after the build" \
        "rebuild it: ccgpt-runtime build — a mutated generation is never repaired in place" ;;
    *)
      _dr_cx_fail "ccgpt-runtime check answered something this doctor does not know (exit $rc: $(_dr_first_line "$ans")), so the runtime's state is unmeasured" \
        "ccrc and ccgpt-runtime ship together and must be one build: run 'ccrc update', then re-run doctor" ;;
  esac
  return 0
}

# One lane's static rows. Its row already read in `_check_codex`'s row pass;
# it is read again HERE so this shell's CX_* are this lane's.
_dr_cx_lane() {   # <id> <models: 1 = its model state is measurable> <roster> — sets DRX_LANE_WORDS
  local id="$1" models="$2" roster="$3" auth st ans lc yaml
  local -a f=()
  DRX_LANE_WORDS=''
  _codex_row "$id" 2>/dev/null || return 0
  DRX_LANE_WORDS="ports $CX_PROXY/$CX_LITELLM"
  # authDir: EXISTENCE AND MODE ONLY (spec §9, §12). `[ -f ]` needs search
  # permission on the directory and nothing on the file, so a 0000 auth.json
  # passes: its contents are never this check's business.
  auth="$HOME/$CX_AUTH"
  if [ ! -e "$auth" ] && [ ! -L "$auth" ]; then
    _dr_cx_fail "$id's authDir ~/$CX_AUTH does not exist, so the lane has nothing to sign in to" \
      "sign the lane in: ccrc codex login $id (the runtime's own login creates it, owner-only) — ccrc never performs OAuth for you"
  elif [ ! -d "$auth" ] || [ ! -r "$auth" ] || [ ! -x "$auth" ]; then
    _dr_cx_fail "$id's authDir ~/$CX_AUTH is not a directory this user can list and search, so whether the lane is signed in cannot be told" \
      "make it a directory you own and can search (chmod u+rx ~/$CX_AUTH); ccrc never reads what is inside it"
  elif [ ! -f "$auth/auth.json" ]; then
    _dr_cx_fail "$id has no OAuth login: ~/$CX_AUTH holds no auth.json (existence is all ccrc checks; it never reads one), so 'ccrc codex start $id' refuses" \
      "sign the lane in: ccrc codex login $id"
  else
    DRX_LANE_WORDS+=", signed in"
  fi
  # lane.json against the ROSTER row: id, configDir, authDir, both ports, unit names present.
  st="$(_codex_lane_json_state "$id" 2>/dev/null)" || st=''
  case "$st" in
    current) ;;
    absent)
      _dr_cx_fail "$id has no lane.json ($(_codex_lane_dir "$id")/lane.json), which the launcher, the shim and the usage publisher all read" \
        "render it: ccrc codex start $id renders lane.json from the roster before it starts the lane (every session launch runs the same start)" ;;
    stale)
      _dr_cx_fail "$id's lane.json disagrees with its roster row (its id, configDir, authDir, a port or its unit names), so the shim and the usage publisher read the lane's old shape" \
        "re-render it: ccrc codex start $id renders lane.json from the roster before it starts the lane" ;;
    *)
      _dr_cx_fail "whether $id's lane.json matches its roster row could not be measured" \
        "run: ccrc codex status $id — it reads the same file and says what it could see" ;;
  esac
  if [ "$models" -ne 1 ]; then DRX_LANE_WORDS+=", model state unread"; return 0; fi
  # The lane's model state, ONLY through models-op's `show`.
  ans="$(_models_node show --file "$roster" --id "$id" 2>/dev/null)"
  mapfile -t f < <(printf '%s' "$ans" | jq -r '
      if .ok != true then error("refused") else . end
      | (.registry | if type == "object" then . else null end) as $r
      | (if $r == null then null else $r.classes.haiku end) as $h
      | (if $r == null then "none" else ($r.probe // "" | tostring) end),
        ($h // "" | tostring),
        (if $r == null then "" else ($r.subagent // "" | tostring) end),
        (if ($h | type) == "string" and ((.derived.retired // []) | any(. == $h)) then "retired" else "live" end),
        (.renderRefusal // "" | tostring | gsub("[\n\t]"; " ")),
        "END"' 2>/dev/null)
  if [ "${#f[@]}" -ne 6 ] || [ "${f[5]}" != END ]; then
    if printf '%s' "$ans" | jq -e '.ok == false' >/dev/null 2>&1; then
      _dr_cx_fail "$id: 'ccrc models' refused to read the lane's model state — $(printf '%s' "$ans" | jq -r '"\(.error // "?"): \(.detail // "" | gsub("[\n\t]"; " "))"' 2>/dev/null)" \
        "fix what that sentence names, then re-run doctor"
    else
      _dr_cx_fail "$id: 'ccrc models' printed no answer about the lane (deploy/models-op.mjs), so its class registry and catalogue are unmeasured" \
        "ccrc and deploy/models-op.mjs ship together and must be one build: run 'ccrc update', then re-run doctor"
    fi
    return 0
  fi
  local probe="${f[0]}" haiku="${f[1]}" sub="${f[2]}" ret="${f[3]}" refusal="${f[4]}"
  if [ "$probe" = none ]; then
    _dr_cx_fail "$id is a Codex lane with no class registry, so nothing says which model any class routes to, and its probe model and LiteLLM config have nothing to be rendered from" \
      "create it: ccrc models $id init codex, then ccrc models refresh $id"
    return 0
  fi
  if [ "$probe" != codex ]; then
    _dr_cx_fail "$id is a Codex lane whose class registry declares probe \"$probe\": that is another provider's catalogue, and a LiteLLM config rendered from it would name models the ChatGPT backend has never heard of" \
      "remove that registry deliberately (ccrc models $id rm) and create the lane's own: ccrc models $id init codex — ccrc never changes a registry's probe kind for you"
    return 0
  fi
  [ -z "$refusal" ] || _dr_cx_fail "$id's model files cannot be rendered: $refusal" \
    "fix the class that sentence names (ccrc models $id show prints the registry), then re-run doctor"
  if [ -z "$haiku" ]; then
    _dr_cx_warn "$id routes haiku to nothing, so its lane.json carries no probe model and its usage publisher refuses to publish" \
      "assign one: ccrc models $id set-class haiku <modelId>"
  elif [ "$ret" = retired ]; then
    _dr_cx_warn "$id's usage probe model, $haiku (its haiku class), is absent from the lane's current catalogue, so the usage publisher probes a model the backend no longer lists" \
      "reassign it: ccrc models $id set-class haiku <modelId> (ccrc models $id show lists the catalogue)"
  fi
  # lane.json against the REGISTRY (ruling R7): the check-only materialise.
  # Asked only over a lane.json the roster row agrees with — a stale or absent
  # one is already its own FAIL above, with its own remedy.
  if [ "$st" = current ]; then
    lc="$(_models_node materialise --file "$roster" --id "$id" --check true 2>/dev/null \
          | jq -r 'if .ok == true and .check == true then (.changed.lane | tostring) else "error:\(.error // "no answer")" end' 2>/dev/null)"
    case "$lc" in
      false) DRX_LANE_WORDS+=", lane.json current" ;;
      true)
        _dr_cx_fail "$id's lane.json is stale against its class registry: the registry has moved (its haiku class, which is the lane's probe model, or another field lane.json carries) since the file was written" \
          "re-render it: ccrc models $id set-subagent ${sub:-sonnet} (any models mutation re-renders the lane's files, lane.json among them)" ;;
      *)
        _dr_cx_fail "whether $id's lane.json matches its class registry could not be measured ('ccrc models' answered ${lc:-nothing})" \
          "ccrc and deploy/models-op.mjs ship together and must be one build: run 'ccrc update', then re-run doctor" ;;
    esac
  fi
  # The rendered LiteLLM config against the CATALOGUE: models-op's `litellm`
  # without `--commit` is check-only — it answers `changed` and writes nothing.
  yaml="$(_codex_litellm_yaml "$id")"
  lc="$(_models_node litellm --file "$roster" --id "$id" --template "$(_models_litellm_template)" --out "$yaml" 2>/dev/null \
        | jq -r 'if .ok == true then "changed:\(.changed)" else "refused:\(.error // ""):\(.detail // "" | gsub("[\n\t]"; " "))" end' 2>/dev/null)"
  case "$lc" in
    changed:false) DRX_LANE_WORDS+=", LiteLLM config current" ;;
    changed:true)
      if [ -e "$yaml" ] || [ -L "$yaml" ]; then
        _dr_cx_fail "$id's LiteLLM config ($yaml) is stale against the lane's catalogue: a render now would write different bytes, so the lane's LiteLLM routes a model list the catalogue has moved past" \
          "re-render it: ccrc models litellm $id (it stops the lane's own LiteLLM tier around the write when that tier is running, and starts it again)"
      else
        _dr_cx_fail "$id has no rendered LiteLLM config ($yaml), so the lane's LiteLLM tier has nothing to start on" \
          "render it: ccrc models litellm $id (ccrc codex start $id renders it too when it is absent)"
      fi ;;
    refused:never-probed:*)
      _dr_cx_fail "$id has never been probed, so there is no catalogue for its LiteLLM config to be rendered from" \
        "probe it: ccrc models refresh $id" ;;
    refused:*)
      _dr_cx_fail "$id: 'ccrc models' refused to render the lane's LiteLLM config — ${lc#refused:}" \
        "fix what that sentence names, then re-run doctor" ;;
    *)
      _dr_cx_fail "whether $id's LiteLLM config is current could not be measured ('ccrc models' printed no answer)" \
        "ccrc and deploy/models-op.mjs ship together and must be one build: run 'ccrc update', then re-run doctor" ;;
  esac
  return 0
}
```

```bash
. "<abs scratch>/plan3a-env.sh"; cd "$(git rev-parse --show-toplevel)"
bash -n ccd/ccrc-doctor-checks
grep -nE 'deploy\.sh.?(:|[[:space:]]*\(:)[0-9]' ccd/ccrc-doctor-checks     # → nothing
# The worktree against the base, before the commit (ruling F3):
[ "$(grep -c 'classes\.json' ccd/ccrc-doctor-checks)" = "$(git show "$BASE:ccd/ccrc-doctor-checks" | grep -c 'classes\.json')" ] && echo unchanged   # → unchanged: the check never names the registry file
```

- [ ] **Step 5: Run green, then the neighbours**

```bash
. "<abs scratch>/plan3a-env.sh"; cd "$(git rev-parse --show-toplevel)/server"
"$CENSUS" "$EVID/t4-5-doctor-<k>" ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t <P>   # three calls, the Global Constraints' parts; their sum → Tests 544 passed | 4 skipped (548): Step 0's own total plus 39, every case green (re-derive; the copy without Tasks 1 and 3 measured 538 passed | 4 skipped (542))
```

```bash
. "<abs scratch>/plan3a-env.sh"; cd "$(git rev-parse --show-toplevel)/server"
"$CENSUS" "$EVID/t4-5-models-op" ./node_modules/.bin/vitest run test/models-op.test.ts     # → Tests 115 passed (115) in the execution order: Step 0's own total plus five (re-derive; 111 on `1f9fa22d` without Task 2)
```

Then one call per suite (ruling F6) for each of `single-definition`, `pool-name-parity`, `macos-platform`, `ccrc-models`, `modelenv`, `ccrc-codex`, `install-census` and `ccrc-doctor-graphify`, each a block of this shape, labelled `t4-5-<suite>`:

```bash
. "<abs scratch>/plan3a-env.sh"; cd "$(git rev-parse --show-toplevel)/server"
"$CENSUS" "$EVID/t4-5-<suite>" ./node_modules/.bin/vitest run test/<suite>.test.ts             # → each equals its Step 0 line
```

```bash
. "<abs scratch>/plan3a-env.sh"; cd "$(git rev-parse --show-toplevel)/server"
"$CENSUS" "$EVID/t4-5-install" ./node_modules/.bin/vitest run test/ccrc-install.test.ts    # its closing doctor now runs _check_codex
```

What each neighbour guards here:
- `single-definition`: the exact count of registry-file lines in doctor-checks (two, the base's count, which ruling Z leaves alone; :1784-1795), and the models-dir holders list;
- `pool-name-parity`: exactly two `.cc-sessions/<dir>` literals in doctor-checks — this task adds none;
- `macos-platform`: the GNU-spelling corpus includes doctor-checks — no bare `timeout`, `stat -c` or `sha256sum`;
- `ccrc-models`: `materialise`'s two write callers, now writing through `materialFiles`;
- `ccrc-install`: every codex spine case pins `r.code` to `doctorCode(home)`, which re-runs the same doctor, so both sides move together; a case pinning `0` has no codex lane, and `codex` SKIPs there.

Measured on the scratch copy (with Task 5 in place as well): `single-definition`'s registry-count and holders cases, `pool-name-parity` 21, `macos-platform` 94 + 11 skipped, `ccrc-models` 148, `modelenv` 53, `ccrc-doctor-graphify` 30, `ccrc-codex`, and `ccrc-install`'s 72 codex and doctor cases are green. Every other failure seen there came from the copy having no `.git`, never from this task.

- [ ] **Step 6: Typecheck the test directory**

```bash
. "<abs scratch>/plan3a-env.sh"; cd "$(git rev-parse --show-toplevel)/server"
"$CENSUS" "$EVID/t4-6-typecheck" ./node_modules/.bin/vitest run test/typecheck-tests.test.ts   # → server/test/ is clean under a tests-inclusive project
```

- [ ] **Step 7: The line-count rule, measured**

Every cited line above the appended block, and above `OPS` in models-op, is where it was:

```bash
. "<abs scratch>/plan3a-env.sh"; cd "$(git rev-parse --show-toplevel)"
for f in ccd/ccrc-doctor-checks:152,166,443,452,457,1012,2253,2300,2316,2382,2386,2388,2401,2403,2408,2419,2427,2432,2542 \
         deploy/models-op.mjs:185,298,573 server/test/ccrc-doctor.test.ts:66,70; do
  file="${f%%:*}"
  for l in $(echo "${f#*:}" | tr , ' '); do
    [ "$(git show "$BASE:$file" | sed -n "${l}p")" = "$(sed -n "${l}p" "$file")" ] || echo "MOVED: $file:$l"
  done
done                                                                             # → prints nothing
# The worktree against the base, before the commit (ruling F3; the commit is Step 8's):
git show "$BASE:ccd/ccrc-doctor-checks" | wc -l   # → L, the base's last line
git diff -U0 "$BASE" -- ccd/ccrc-doctor-checks | grep '^@@'                      # → eight one-line hunks (the table line and the seven citations), then one insert past L
```

- [ ] **Step 8: Mutation table — measure every row both ways**

First commit the task as WIP, so `git diff --quiet` below compares each restore with the task's committed bytes:

```bash
cd "$(git rev-parse --show-toplevel)" && git add -A && git commit -qm 'wip: task 4' && git status --short   # → empty
```

Then run each row alone, in three calls (ruling F7: one backup per file the row edits, and the restore proven by `git diff --quiet`). Shown for M5; each row substitutes its own `row`, its `files` (EVERY file it edits, from its File column), its suite and its `-t` filter:

```bash
# 8a: before the edit, one backup per file the row edits
. "<abs scratch>/plan3a-env.sh"; cd "$(git rev-parse --show-toplevel)"
row=t4-M5; files='ccd/ccrc-doctor-checks'
mkdir -p "$SCRATCH/mut/$row"
for f in $files; do cp -- "$f" "$SCRATCH/mut/$row/${f//\//__}"; done
ls "$SCRATCH/mut/$row"   # → one backup per file
```

Apply the row's edit to the working tree, then:

```bash
# 8b: the row's filter, through the census
. "<abs scratch>/plan3a-env.sh"; cd "$(git rev-parse --show-toplevel)/server"
"$CENSUS" "$EVID/t4-8-M5" ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'drifted from the shipped tree'   # → the Red column's count failed
```

```bash
# 8c: restore every file from its own backup, and prove it
. "<abs scratch>/plan3a-env.sh"; cd "$(git rev-parse --show-toplevel)"
row=t4-M5; files='ccd/ccrc-doctor-checks'
for f in $files; do cp -- "$SCRATCH/mut/$row/${f//\//__}" "$f"; done
git diff --quiet -- $files && echo "restored $row"   # → restored t4-M5
```

The suite is `test/ccrc-doctor.test.ts` for every M row and `test/models-op.test.ts` for every MO row. M16 edits `server/test/ccrc-doctor.test.ts`, M18 `deploy/deploy.sh` and the MO rows `deploy/models-op.mjs`; every other row edits `ccd/ccrc-doctor-checks`. A restore that does not print `restored` stops the table. Counts were measured on the scratch copy with exactly these filters.

| Row | File: mutation (old → new) | Suite `-t` filter | Red |
|---|---|---|---|
| M1 | doctor-checks: the empty-population block's `return 3` (after its two SKIP lines) → `return 0` | ccrc-doctor `'SKIPs a roster with no Codex lane\|SKIPs a box with no roster'` | 2: both SKIP cases (the runner's "exited 0 having printed 1 SKIP" bug line) |
| M2 | doctor-checks: in `_codex_lanes`' `*)` arm, insert `_dr_skip codex "roster unreadable"; return 3` before the FAIL | `'a roster that cannot be read'` | 1 |
| M3 | doctor-checks: the same in the `2)` arm | `'a box with no jq'` | 1 |
| M4 | doctor-checks: `CODEX_LANE_BINS=(… ccgpt-runtime ccrc-codex)` → drop `ccrc-codex` | `'GPT_LANE_BINS\|GPT-lane executable missing'` | 2: the list pin and the missing-`ccrc-codex` case |
| M5 | doctor-checks: `cmp -s "$tree/$name" "$bin/$name" \|\| drift+=("$name")` → `: cmp` | `'drifted from the shipped tree'` | 1 |
| M6 | doctor-checks: `"1:ccgpt-runtime: requirement-moved")` → `"1:ccgpt-runtime: requirement-moved"\|"1:ccgpt-runtime: probe-moved")` | `'answers probe-moved'` | 1 |
| M7 | doctor-checks: `elif [ ! -f "$auth/auth.json" ]` → `elif [ ! -r "$auth/auth.json" ]` (a check that needs READ permission, which a 0000-mode auth.json denies) | `'0000-mode'` | 1 (skipped as root) |
| M8 | doctor-checks: the collision `if [ -n "${owner[$p]:-}" ] && …; then` → `if false; then` | `'share a port'` | 1 |
| M9 | doctor-checks: `    current) ;;` → `    current\|stale) ;;` | `'roster row has moved'` | 1 |
| M10 | doctor-checks: drop `--check true` from the `materialise` call | `'stale against the REGISTRY'` | 1: the FAIL is gone AND `treeState` differs — doctor wrote |
| M11 | doctor-checks: `--out "$yaml" 2>/dev/null` → `--out "$yaml" --commit true 2>/dev/null` | `'stale LiteLLM config'` | 1: doctor cured it, and the bytes changed |
| M12 | doctor-checks: `elif [ "$ret" = retired ]` → `elif false` | `'routes haiku to nothing'` | 1 |
| M13 | doctor-checks: `_dr_cx_report`'s `return "$worst"` → `return 0` | `'FAILing and another WARNing'` | 1 (the runner's rc-disagrees bug line) |
| M14 | doctor-checks: `_dr_cx_member "$n" … \|\| left+=("$n")` → `:` | `'lane state'` | 2 |
| M15 | doctor-checks: `if [ "$role" = server ]` → `if [ "$role" != fleet ]` | `'CCRC_ROLE'` | 1: role unset is skipped |
| M16 | ccrc-doctor.test.ts: `HEALTHY_SKIPS … + 4` → `+ 3` | the eight pins' titles (Why) | 8 |
| M17 | doctor-checks: :274's anchor → `(deploy.sh:599)` | `'deploy.sh by line number\|anchor'` | 1: "no line cites deploy.sh by line number" |
| M18 | deploy/deploy.sh: `_unit_atomic ~/ccrc/deploy/systemd/ccd-pool-sync.timer ` → `….tmr ` | `'anchor'` | 1. A mutation that APPENDS to the anchor (`.timerX`) stays green, because the anchor is a prefix of it — measured |
| MO1 | models-op: before `materialiseCheck(…)` in the check arm, call `materialise(account, registry, catalogue);` | models-op `'check'` | 3 |
| MO2 | models-op: drop `'check'` from `OPS.materialise.keys` | `'check'` | 4 |
| MO3 | models-op: `if (a.check !== 'true')` → `if (false)` | `'check'` | 1: the typo case |
| MO4 | models-op: `changed[key] = onDisk !== text;` → `changed[key] = true;` | `'check'` | 2 |
| MO5 | models-op: the writer's `materialFiles(…)` → `materialFiles(…).filter(([k]) => k !== 'lane')` | `'lane.json'` | 7: five existing lane.json cases and two new ones — the writer really writes from the shared list |

If a row does not red, report that; never add code to force it.

- [ ] **Step 9: Commit**

```bash
. "<abs scratch>/plan3a-env.sh"; cd "$(git rev-parse --show-toplevel)"
git status --short                                                         # → empty: every row was restored, and the WIP commit holds the task
git commit --amend -q -F - <<'EOF'
feat(doctor): _check_codex part 1 — population, executables, runtime, authDir, ports, lane state (Plan 3a Task 4)

A check-only `materialise --check true` in deploy/models-op.mjs measures lane.json
against the class registry (ruling R7); the default stays the write. HEALTHY_SKIPS
rises by one (`codex` SKIPs on healthy()), healthyCodexBox becomes a converged lane
on free ports, and the seven stale deploy.sh citations are re-aimed by anchor.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git diff --name-only "$BASE" HEAD | sort   # after the commit (ruling F3)
# → ccd/ccrc-doctor-checks deploy/models-op.mjs server/test/ccrc-doctor.test.ts server/test/codexLaneFixture.ts server/test/models-op.test.ts
```


### Task 5: `_check_codex`, part 2 — tier identity, bounded port connects, half-up lanes, stale code, and a down gateway under live sessions

**Files:**
- NOT modified: `ccd/ccrc`. The second-writer question is Task 6's (R6), so this task adds no function there. (An insert at :11251 would also have moved the `ccd/ccrc:11635` line the compaction-card corpus cites.)
- Modify `ccd/ccrc-doctor-checks` — Task 4's `_check_codex`: its loaded-guard list, its locals and its per-lane loop; then append the part-2 helpers after the file's last line.
- Modify `server/test/ccrc-doctor.test.ts`:
  - `runDoctorBounded` (:1000-1013) takes an `extraEnv`;
  - Task 4's Codex import block is widened, and a `startedJson` helper added beside `lanePorts`;
  - Task 4's PASS pin is rewritten to the part-2 words;
  - one describe appended at the end of the file.
- Neighbours run, not edited: `ccrc-install` (its codex spine cases end in doctor, which now connects to their lanes' ports), `ccrc-codex`, `pool-name-parity`, `macos-platform`, `single-definition`, `typecheck-tests`.

**Interfaces:**
- Consumes:
  - Task 4's `_check_codex` and helpers (`_dr_cx_fail`, `_dr_cx_warn`, `_dr_cx_join`), its locals, and its test fixtures (`healthyCodexBox`, `lanePorts`, `codexVerdicts`, `remedyAfter`, `currentGen`, `describeCodex`, `codexHomes`).
  - The lane library, read-only (line numbers measured at `1f9fa22d`; Tasks 1 and 2 edit `ccd/ccrc` above them first, so locate each by name):
    - `_codex_tier_ours <id> <tier>` (ccd/ccrc:10827): 0 ours running · 1 not running · 2 foreign, with `CX_TIER_WHY` · 3 cannot ask · 4 ours starting. It sets `CX_TIER_VIA`/`CX_TIER_PID`, and reads through `_codex_port_listening` (:10586) and `_codex_lane_answer` (:10602), each bounded by `_plat_timeout "$(_codex_probe_secs)"` (`CCRC_CODEX_PROBE_S`, default 2, :10336).
    - `_codex_tier_stale <id> <tier>` (:10965): 0 stale · 1 current · 2 cannot tell.
    - `_codex_tier_is_our_handle <rc>` (:10928): the ONE reading of "is what `_codex_tier_ours` just answered this lane's own tier". It answers 0 for a 0, a 4, and a 2 whose `CX_TIER_WHY` is `listener-other-process`, and is called directly after `_codex_tier_ours`, with its rc.
    - `_codex_foreign_what <id> <tier>` (:11203): `CX_FOREIGN_CODE`, `CX_FOREIGN_WHAT`, `CX_FOREIGN_FIX` — the one wording of every rc 2.
    - `_svc_is_active` (:996, three answers: a word, or empty for "not asked"), `_svc_status_hint` (:980), `_codex_bus_defaults` (:10355), `_codex_shape` (:10298), `CODEX_TIERS` (:10279).
  - `~/.cc-sessions/<sid>.wrapper` (ccd's registry field `wrapper`), read as a file only.
  - `codexLaneFixture.ts`: `spawnListener`, `alive`, `portAccepts`, `plantSystemd`, `fakeUnit`, `laneUnits`, `systemdRunCalls`, `systemctlCalls`.
- Produces:
  - `_dr_cx_tiers` and `_dr_cx_sessions`, called for every lane whose row read. Each lane's PASS words become `<Task 4's words>; tiers: none running (a lane is lazy) | tiers: <tier> running (<via>, pid <n>), …`, and Task 6 appends its usage words after them.
  - NOT this task's: the other repository's `ccgpt-usage@<id>.timer` enabled for a codex lane (R6). That row is Task 6's. Task 6 reads it from `timers.target.wants/` with the same helpers its converge acts on (D-3726), so doctor and the converge cannot disagree.
  - The sentences Step 3 spells, which Task 8's fixer cures where a cure is allowed (restart a verified own tier) and names where it is not (a foreign listener, OAuth, ports).
  - `runDoctorBounded(home, ms, extraEnv)`; `startedJson(home, tier)`.

**Why:**
- **Doctor may connect to a lane's loopback ports, bounded** (ruling R-C4). §12's foreign-listener row cannot be measured otherwise, and doctor already probes loopback (it curls `/health` and runs `openssl s_client`). Every connect is the lane library's own, the one `ccrc codex status` makes, and each is bounded by `CCRC_CODEX_PROBE_S`, so a listener that accepts and never answers costs a bound, not a hang. The test for that uses an IN-PROCESS server on purpose: `runDoctor` blocks this process's event loop, so the kernel completes the connect and nothing ever answers it (codexLaneFixture.ts' own header measured that deadlock). Its mutation, an unbounded `_codex_lane_answer`, hangs until `runDoctorBounded`'s deadline and reds.
- **Nothing here signals, stops or starts anything.** Every rc 2 is named in `_codex_foreign_what`'s words and left running. The foreign-listener case asserts that the listener is alive and still accepting after doctor. That assertion has no safe red mutation: a foreign listener has no handle this lane proves, and a pattern kill would reach other suites' fixtures on a shared box. The mutation-backed sibling is the unit-unproven case, whose `systemd-run` recorder must stay empty (row T5-M10).
- **The classes, where §12 is silent:**
  - a live unit of the tier's name with `MainPID` 0 (`unit-unproven`) is a WARN with the helper's retry wording D-3714. This lane's own crash-looping tier reads exactly so inside its `RestartSec`, and a FAIL there would fail every `ccrc update` that lands in that window;
  - a 2 that `_codex_tier_is_our_handle` reads as this lane's own process (`listener-other-process`: this lane's tier, alive by its command line, while another process holds its port) is a FAIL in `_codex_foreign_what`'s words alone. That sentence names the pid it proved, so the "ccrc neither adopts nor stops what it cannot identify" tail every other foreign FAIL carries would contradict it;
  - a 3 (cannot ask) is a WARN, "unmeasured, never read as running or as stopped" D-3715;
  - `_codex_tier_stale`'s 2 is its own WARN, never current and never stale (2b-2 Task 4 hazard 6);
  - a LiteLLM tier down while a LIVE session runs on the lane is a WARN (2b-2 plan :11065-11067: after a start that wrote, the refresh reads "unchanged" and never retries the start) D-3716. "Live" is `_svc_is_active claude-session@<sid>.service`, with its three answers kept apart, as `_check_routing`'s census does.
- **A lane is lazy.** Both tiers down is a PASS. One ours (0 or 4) and the other not running (1) is §12's FAIL, with the idempotent `ccrc codex start` as its remedy.
- **The second writer is Task 6's, not this task's** (ruling R6). The other repository's `ccgpt-usage@<id>.timer` enabled for a codex lane is one fact with one reader. That reader is Task 6's `_codex_usage_enabled`, which reads the `timers.target.wants/` link the manager itself makes, and which Task 6's converge, uninstall, account removal and doctor row all share. A second, bus-asked copy here would print the same WARN twice on a box whose manager answers, and disagree with the converge on a box whose manager does not.
- **No new `systemctl` verb.** The tier rows ask the manager only through the lane library's existing questions (`_codex_tier_ours`' unit reads and `_svc_is_active`), and every harness that reaches them already answers them with a recorder. The update and uninstall harnesses reach none of it: they have no codex row, so `codex` SKIPs before it asks.
- **Inert on the live box.** `_check_codex` SKIPs before the tier arm on today's live shape (no codex row, no lane state), so no live port is ever connected to and no foreign unit is asked about until a roster row is flipped.
- **Out of this task:** every usage row, the second writer included (Task 6), and every cure (Task 8).

- [ ] **Step 0: Record the base and the locators (read-only)**

```bash
. "<abs scratch>/plan3a-env.sh"; cd "$(git rev-parse --show-toplevel)"
: "${CENSUS:?source the Global Constraints' env file first}"
git rev-parse HEAD > "$SCRATCH/base"   # this task's base; Step 7 reads it as $BASE
grep -c '^_check_codex() {' ccd/ccrc-doctor-checks                               # → 1 (Task 4 landed)
grep -c '_dr_cx_tiers' ccd/ccrc-doctor-checks # → 0
grep -n '^_codex_foreign_what() {' ccd/ccrc                                       # → one line
grep -n '^_codex_tier_is_our_handle() {' ccd/ccrc   # → one line
grep -n '^# The ONE spelling of a missing placed shim' ccd/ccrc                   # → one line
grep -n '^  reset-failed)$' server/test/codexLaneFixture.ts                       # → one line (Task 4's codexRoster edit moves it)
grep -c 'is-enabled' server/test/codexLaneFixture.ts server/test/ccrc-doctor.test.ts   # → 0 and 0
```

Then record each neighbour's count, one suite per call (ruling F6), every call a block of this shape:

```bash
. "<abs scratch>/plan3a-env.sh"; cd "$(git rev-parse --show-toplevel)/server"
"$CENSUS" "$EVID/t5-0-ccrc-doctor-<k>" ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t <P>   # the Global Constraints' three parts, k = 1, 2, 3; record each "Tests" line
```

for `ccrc-doctor` (three calls, as shown; its count is their sum), then `ccrc-codex`, `ccrc-install`, `pool-name-parity`, `macos-platform` and `single-definition`, each run whole and labelled `t5-0-<suite>`: Step 4 compares every one of them with this line. Measured on the scratch copy, which had Task 4 but not Tasks 1 and 3: `ccrc-doctor` `Tests 538 passed | 4 skipped (542)`, so `544 passed | 4 skipped (548)` in the execution order, where Task 3's six land first and Task 1 adds none (ruling Z) (derived; re-derive); `ccrc-codex` `Tests 201 passed (201)`.

- [ ] **Step 1: Write the failing tests**

**1a–1b.** Nothing here. This task adds no fixture to `codexLaneFixture.ts` and no case to `ccrc-codex.test.ts`, because the second-writer question is Task 6's, read from the manager's own links.

**1c. `server/test/ccrc-doctor.test.ts` — the harness.**
1. `stubSystemctl` is unchanged. This task asks the user manager no new verb, because the second-writer row is Task 6's, read from the manager's own links.
2. `runDoctorBounded`: `function runDoctorBounded(home: string, ms = 10000): Result {` → `function runDoctorBounded(home: string, ms = 10000, extraEnv: NodeJS.ProcessEnv = {}): Result {`, and its spawn's `{ env: doctorEnv(home), encoding: 'utf8' }` → `{ env: { ...doctorEnv(home), ...extraEnv }, encoding: 'utf8' }`. Its callers pass two arguments and keep their meaning.
3. Task 4's Codex import block. Old:

```ts
import {
  authDirOf, codexRoster, freeLanes, GPT_LANE_BINS, killLaneProcesses, plantFakeRuntime, plantLaneAuth,
  type LanePorts,
} from './codexLaneFixture.js';
import { pythonOrSkip } from './ccgptHarness.js';
```

New:

```ts
import {
  alive, authDirOf, codexRoster, fakeUnit, freeLanes, GPT_LANE_BINS, killLaneProcesses, laneUnits, plantFakeRuntime,
  plantLaneAuth, plantSystemd, portAccepts, spawnListener, systemdRunCalls,
  type LanePorts, type Listener, type ListenerAnswer,
} from './codexLaneFixture.js';
import { pythonOrSkip } from './ccgptHarness.js';
import { createServer, type Socket } from 'node:net';
```

4. Directly above `` /** A lane's two ports, read back from the roster `healthyCodexBox` wrote. */ ``, insert:

```ts
/** `_codex_started_json <tier>` as the lane library computes it NOW in this
 *  fixture HOME — the one spelling of the record a start writes (ccd/ccrc) —
 *  under the same contained PATH doctor runs with (Plan 3a Task 5). */
function startedJson(home: string, tier: 'litellm' | 'shim'): string {
  const r = spawnSync(BASH, ['-c', `. ${shq(ccrcIn(home))}; _codex_started_json ${tier}`],
    { env: doctorEnv(home), encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`_codex_started_json ${tier}: ${r.stderr}`);
  return (r.stdout ?? '').trim();
}

```

5. Task 4's PASS pin (`'PASSes a healthy lane and names its ports, its state and the runtime — never the bare word ok'`). Replace its `expect(codexVerdicts(r.stdout), r.stdout).toEqual([ … ]);` with:

```ts
    // Plan 3a Task 5 widened each lane's words with its tiers (a lane is
    // lazy: none running is healthy).
    expect(codexVerdicts(r.stdout), r.stdout).toEqual([
      `PASS codex: 1 Codex lane(s): codex-a (ports ${proxyPort}/${litellmPort}, signed in, lane.json current, `
      + `LiteLLM config current; tiers: none running (a lane is lazy)); runtime ${currentGen(home)} litellm=1.101.0; `
      + 'the four GPT-lane executables match the shipped tree',
    ]);
```

**1d. Append at the end of `server/test/ccrc-doctor.test.ts`:**

```ts
// ── Plan 3a Task 5: `_check_codex`, part 2 — the tier rows (spec §12) ─────
// Listeners are PYTHON children (`spawnListener`), because `runDoctor` blocks
// this process's event loop: an in-process server can never ANSWER — which is
// exactly what the bounded-probe case below wants, and nothing else does.
describeCodex('ccrc doctor: codex, part 2 — tier identity, half-up lanes, stale code and a down gateway (Plan 3a Task 5, spec §12)', () => {
  const at = (home: string, tier: 'shim' | 'litellm', answer: ListenerAnswer, lane = 'codex-a', argv: readonly string[] = []): Promise<Listener> => {
    const { proxyPort, litellmPort } = lanePorts(home, 'codex-a');
    return spawnListener(home, { answer, lane, port: tier === 'shim' ? proxyPort : litellmPort, argv });
  };
  it('a listener on the shim port answering as ANOTHER lane FAILs in _codex_foreign_what\'s words, and is left running', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-other-lane-');
    const port = lanePorts(home, 'codex-a').proxyPort;
    const l = await at(home, 'shim', 'json', 'codex-b');
    const r = runDoctor(home);
    const re = new RegExp(`^FAIL codex: codex-a: port ${port} \\(codex-a's shim tier\\) is held by a listener that is not this lane's: it answers as another lane — ccrc neither adopts nor stops what it cannot identify$`, 'm');
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toBe(`  remedy: Stop whatever holds port ${port}, or give codex-a other ports in ~/.ccrc/accounts.json.`);
    noRunnerBugLine(r.stdout, 'codex');
    // Named, and left running: nothing in doctor signals anything.
    expect(alive(l.pid)).toBe(true);
    expect(await portAccepts(port)).toBe(true);
  });

  it('a listener answering with NO id — the other repository\'s shim shape, or anything on the LiteLLM port — FAILs as unidentified', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-no-id-');
    const { proxyPort, litellmPort } = lanePorts(home, 'codex-a');
    await at(home, 'shim', 'text');
    await at(home, 'litellm', '404');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(new RegExp(`^FAIL codex: codex-a: port ${proxyPort} \\(codex-a's shim tier\\) is held by a listener that is not this lane's: its identity check failed`, 'm'));
    expect(r.stdout).toMatch(new RegExp(`^FAIL codex: codex-a: port ${litellmPort} \\(codex-a's litellm tier\\) is held by a listener that is not this lane's: its identity check failed`, 'm'));
    noRunnerBugLine(r.stdout, 'codex');
  });

  // `listener-other-process` is the one foreign 2 that IS this lane's own
  // process (`_codex_tier_is_our_handle`): its sentence names the pid it
  // proved, so it never carries the "cannot identify" tail. LiteLLM's
  // identity is /proc on Linux, as in the half-up case below.
  itLinux('this lane\'s own LiteLLM while another process holds its port FAILs in _codex_foreign_what\'s words alone — never "cannot identify"', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-other-proc-');
    const port = lanePorts(home, 'codex-a').litellmPort;
    const yaml = join(home, '.ccrc', 'codex', 'codex-a', 'litellm.yaml');
    // This lane's LiteLLM by its command line, on a kernel-chosen port…
    const mine = await spawnListener(home, { answer: '404', argv: ['--config', yaml] });
    writeFileSync(join(home, '.ccrc', 'codex', 'codex-a', 'litellm.pid'), `${mine.pid}\n`);
    // …while another process holds litellmPort.
    await at(home, 'litellm', '404');
    const r = runDoctor(home);
    const re = new RegExp(`^FAIL codex: codex-a: port ${port} \\(codex-a's litellm tier\\) is held by a process that is not this lane's LiteLLM: pid ${mine.pid} is this lane's by its command line, and another process holds the port's listening socket$`, 'm');
    expect(r.stdout, r.stdout).toMatch(re);
    expect(r.stdout).not.toMatch(/cannot identify/);
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('one tier running and the other not is FAIL — the shim up, LiteLLM down', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-half-shim-');
    await at(home, 'shim', 'json');
    const r = runDoctor(home);
    const re = /^FAIL codex: codex-a is half up: its shim is running and its LiteLLM tier is not, /m;
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toBe('  remedy: start the tier that is down: ccrc codex start codex-a (idempotent: it starts only what is not running)');
    noRunnerBugLine(r.stdout, 'codex');
  });

  // LiteLLM's identity is a PID that ITSELF holds the port (`_codex_pid_listens`):
  // /proc on Linux. The Darwin arm (lsof) is ccrc-codex.test.ts' to measure.
  itLinux('one tier running and the other not is FAIL — LiteLLM up (its nohup pidfile proves it), the shim down', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-half-litellm-');
    const yaml = join(home, '.ccrc', 'codex', 'codex-a', 'litellm.yaml');
    const l = await at(home, 'litellm', '404', 'codex-a', ['--config', yaml]);
    writeFileSync(join(home, '.ccrc', 'codex', 'codex-a', 'litellm.pid'), `${l.pid}\n`);
    const r = runDoctor(home);
    expect(r.stdout, r.stdout).toMatch(/^FAIL codex: codex-a is half up: its LiteLLM tier is running and its shim is not, /m);
    expect(lineFor(r.stdout, 'codex')).not.toMatch(/^PASS/);
    noRunnerBugLine(r.stdout, 'codex');
  });

  itLinux('a live unit of the shim\'s name whose MainPID is 0 — a restart window — WARNs with the retry wording, never as foreign, and doctor starts nothing', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-unproven-');
    plantSystemd(home, { userManager: true });
    const unit = laneUnits(home, 'codex-a').shim;
    fakeUnit(home, unit, { state: 'active', pid: 0 });
    const r = runDoctor(home);
    const re = new RegExp(`^WARN codex: codex-a: the unit ${unit.replace(/[.@]/g, '\\$&')} is active, but its identity as codex-a's shim tier is unproven: `, 'm');
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toMatch(/^ {2}remedy: Re-run in a few seconds: this lane's own tier reads this way between two of its restarts/);
    expect(codexVerdicts(r.stdout).filter((l) => l.startsWith('FAIL codex: '))).toEqual([]);
    expect(systemdRunCalls(home)).toEqual([]);
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('a running shim started from other bytes WARNs "older than the installed bytes"; the current record does not', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-stale-');
    await at(home, 'shim', 'json');
    const rec = join(home, '.ccrc', 'codex', 'codex-a', 'shim.started');
    const now = startedJson(home, 'shim');
    writeFileSync(rec, `${now}\n`);
    expect(runDoctor(home).stdout).not.toMatch(/^WARN codex: codex-a's shim tier is running code older/m);
    writeFileSync(rec, `${JSON.stringify({ ...JSON.parse(now) as Record<string, string>, code: '0'.repeat(64) })}\n`);
    const r = runDoctor(home);
    const re = /^WARN codex: codex-a's shim tier is running code older than the installed bytes: /m;
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toMatch(/'ccrc update' restarts a running, proven, stale ccrc tier/);
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('a running shim whose bytes cannot be told right now WARNs "unmeasured, not current" — never current, never stale', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-stale-unknown-');
    await at(home, 'shim', 'json');
    rmSync(join(home, '.ccrc', 'runtime'), { recursive: true, force: true });
    const r = runDoctor(home);
    expect(r.stdout, r.stdout).toMatch(/^WARN codex: codex-a's shim tier is running, and whether it runs the installed bytes cannot be told .* — unmeasured, not current$/m);
    expect(r.stdout).not.toMatch(/^WARN codex: codex-a's shim tier is running code older/m);
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('a LiteLLM tier down under a LIVE session on the lane WARNs; a session on another lane, or a stopped one, does not', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-live-');
    const reg = join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    writeFileSync(join(reg, 'proj-a.wrapper'), 'claude\n');
    writeFileSync(join(home, 'fixture-unit-claude-session@proj-a.service'), 'active\n');
    writeFileSync(join(reg, 'proj-b.wrapper'), 'codex-a\n');
    expect(runDoctor(home).stdout).not.toMatch(/live session/);
    writeFileSync(join(home, 'fixture-unit-claude-session@proj-b.service'), 'active\n');
    const r = runDoctor(home);
    const re = /^WARN codex: codex-a's LiteLLM tier is not running while 1 live session\(s\) run on this lane, /m;
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toBe('  remedy: start it: ccrc codex start codex-a (every session launch runs the same start)');
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('a listener that accepts and never answers costs the check its probe bound — never a hang', async () => {
    // IN-PROCESS, on purpose (the header above): while doctor runs, this
    // process's event loop is blocked, so the kernel completes the connect
    // and nothing ever reads or answers it — a wedged listener, exactly.
    const home = await healthyCodexBox('ccrc-doctor-codex-hung-');
    const port = lanePorts(home, 'codex-a').proxyPort;
    const socks = new Set<Socket>();
    const srv = createServer((s) => { socks.add(s); });
    await new Promise<void>((res, rej) => { srv.once('error', rej); srv.listen(port, '127.0.0.1', () => res()); });
    try {
      const r = runDoctorBounded(home, 60_000, { CCRC_CODEX_PROBE_S: '1' });
      expect(r.stdout, r.stdout).toMatch(new RegExp(`^FAIL codex: codex-a: port ${port} \\(codex-a's shim tier\\) is held by a listener that is not this lane's: its identity check failed`, 'm'));
      noRunnerBugLine(r.stdout, 'codex');
    } finally {
      for (const s of socks) s.destroy();
      await new Promise<void>((res) => { srv.close(() => res()); });
    }
  });
});
```

- [ ] **Step 2: Run them red**

```bash
. "<abs scratch>/plan3a-env.sh"; cd "$(git rev-parse --show-toplevel)/server"
"$CENSUS" "$EVID/t5-2-doctor-<k>" ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t <P>   # three calls, k = 1, 2, 3 (the Global Constraints' parts); the counts below are their sum
```

```bash
. "<abs scratch>/plan3a-env.sh"; cd "$(git rev-parse --show-toplevel)/server"
"$CENSUS" "$EVID/t5-2-codex"  ./node_modules/.bin/vitest run test/ccrc-codex.test.ts
```

Expected (Task 4's check in place, this task's tests written):
- `ccrc-doctor`: `Tests 11 failed | 543 passed | 4 skipped (558)` (re-derive: Step 0's total plus ten) — the ten new part-2 cases and the rewritten PASS pin (no tier words yet). Task 4's other cases stay green, the two-lane PASS included (its regex is `.*`-tolerant). These counts are DERIVED, not measured: the scratch copy measured the draft's part-2 cases on Task 4's tree without Tasks 1 and 3, and since then the two second-writer cases moved to Task 6 and the `listener-other-process` case was added.
- `ccrc-codex`: unchanged and green; this task adds nothing to it.

- [ ] **Step 3: Implement**

**3a. `ccd/ccrc` is not edited.** The second-writer question is Task 6's (R6), read from the manager's own links.

**3b. `ccd/ccrc-doctor-checks`** — three edits inside Task 4's `_check_codex`, then the append.
1. The loaded guard. Old:

```bash
  for fn in _box_env_value _codex_lanes _codex_row _codex_lane_json_state _codex_lane_dir \
            _codex_litellm_yaml _codex_runtime_cli _models_node _models_roster_path _models_litellm_template; do
    if ! declare -F "$fn" >/dev/null 2>&1 || [ -z "${BOX_TREE_DIR:-}" ]; then
      _dr_fail codex "ccrc's own Codex lane library is not loaded ($fn, or BOX_TREE_DIR, is missing), so no lane on this box was measured" \
```

New:

```bash
  for fn in _box_env_value _codex_lanes _codex_row _codex_lane_json_state _codex_lane_dir \
            _codex_litellm_yaml _codex_runtime_cli _models_node _models_roster_path _models_litellm_template \
            _codex_tier_ours _codex_tier_stale _codex_foreign_what _codex_tier_is_our_handle \
            _svc_is_active _svc_status_hint; do
    if ! declare -F "$fn" >/dev/null 2>&1 || [ -z "${BOX_TREE_DIR:-}" ] || [ -z "${CODEX_TIERS:-}" ]; then
      _dr_fail codex "ccrc's own Codex lane library is not loaded ($fn, BOX_TREE_DIR or CODEX_TIERS is missing), so no lane on this box was measured" \
```

2. The locals. Old `  local DRX_RUNTIME='' DRX_LANE_WORDS='' models=1 p`. New:

```bash
  local DRX_RUNTIME='' DRX_LANE_WORDS='' DRX_TIER_WORDS='' models=1 p
  local DRX_LIVE=0 DRX_UNASKED=0 DRX_UNASKED_SID=''
```

3. The per-lane loop. Old:

```bash
      _dr_cx_lane "$id" "$models" "$roster"
      DRX_OK+=("$id ($DRX_LANE_WORDS)")
```

New:

```bash
      _dr_cx_lane "$id" "$models" "$roster"
      _dr_cx_tiers "$id"
      DRX_OK+=("$id ($DRX_LANE_WORDS; $DRX_TIER_WORDS)")
```

4. Append after the file's last line:

```bash
# ── _check_codex, part 2: the tier rows (spec §12; Plan 3a Task 5) ────────
# THE QUESTION IS THE LIBRARY'S. `_codex_tier_ours` (ccd/ccrc) answers each
# tier — 0 ours running, 1 not running, 2 foreign (CX_TIER_WHY), 3 cannot ask,
# 4 ours starting — through the SAME probes `ccrc codex status` asks:
# `_codex_port_listening` and `_codex_lane_answer`, each a loopback connect
# under `_plat_timeout "$(_codex_probe_secs)"` (CCRC_CODEX_PROBE_S, default
# 2 s). So a listener that accepts and never answers costs this check its
# bound, never a hang (ruling R-C4: doctor MAY connect to a lane's loopback
# ports, bounded). Every 2 is worded by `_codex_foreign_what`, the one helper
# every rc-2 consumer names through, and NOTHING here signals, stops or
# starts anything: a foreign listener is named and left running.
#   - a 2 whose CX_TIER_WHY is `unit-unproven` is a WARN with that helper's
#     retry wording, never a FAIL: this lane's own tier reads exactly so
#     inside its RestartSec window (D-3714);
#   - a 2 that `_codex_tier_is_our_handle` reads as this lane's own process
#     (`listener-other-process`) is a FAIL in the helper's words alone: that
#     sentence names the pid it proved, so it never says "cannot identify";
#   - a 3 is a WARN, unmeasured — never read as running or as stopped
#     (D-3715);
#   - a lane is LAZY, so both tiers down is a PASS; one up and one down is
#     the FAIL §12 names;
#   - `_codex_tier_stale` answers 0 stale, 1 current, 2 cannot tell, and a 2
#     is its own WARN — never current, never stale;
#   - a LiteLLM tier down under a live session is a WARN (2b-2's hazard: a
#     tier that died after a start that wrote stays down until the next
#     start, D-3716).
_dr_cx_tiers() {   # <id> — sets DRX_TIER_WORDS
  local id="$1" tier q word own lq=3 sq=3
  local -a words=()
  for tier in $CODEX_TIERS; do
    CX_LISTEN_WHY=''
    _codex_tier_ours "$id" "$tier" 2>/dev/null; q=$?
    case "$q" in
      0|4)
        word="$tier running"; [ "$q" -eq 4 ] && word="$tier starting"
        # CX_TIER_* read NOW: the next question overwrites them.
        words+=("$word${CX_TIER_VIA:+ ($CX_TIER_VIA${CX_TIER_PID:+, pid $CX_TIER_PID})}")
        _codex_tier_stale "$id" "$tier"
        case $? in
          1) ;;
          0) _dr_cx_warn "$id's $tier tier is running code older than the installed bytes: it started from another runtime generation, or another placed shim, than a start would use now" \
               "restart it onto the installed bytes: 'ccrc update' restarts a running, proven, stale ccrc tier; by hand, 'ccrc codex stop $id' then 'ccrc codex start $id'" ;;
          *) _dr_cx_warn "$id's $tier tier is running, and whether it runs the installed bytes cannot be told (no current runtime generation, or the tier's code file cannot be hashed) — unmeasured, not current" \
               "make the runtime current (the runtime finding, if any, names how), then re-run doctor" ;;
        esac ;;
      1) words+=("$tier not running") ;;
      2)
        # Asked FIRST, directly after `_codex_tier_ours`, as its contract says.
        own=1; _codex_tier_is_our_handle "$q" && own=0
        words+=("$tier foreign")
        _codex_foreign_what "$id" "$tier"
        if [ "${CX_TIER_WHY:-}" = unit-unproven ]; then
          _dr_cx_warn "$id: $CX_FOREIGN_WHAT" "$CX_FOREIGN_FIX"
        elif [ "$own" -eq 0 ]; then
          _dr_cx_fail "$id: $CX_FOREIGN_WHAT" "$CX_FOREIGN_FIX"
        else
          _dr_cx_fail "$id: $CX_FOREIGN_WHAT — ccrc neither adopts nor stops what it cannot identify" "$CX_FOREIGN_FIX"
        fi ;;
      *)
        words+=("$tier unmeasured")
        _dr_cx_warn "$id's $tier tier could not be measured${CX_LISTEN_WHY:+ ($CX_LISTEN_WHY)} — unmeasured, never read as running or as stopped" \
          "run: ccrc codex status $id — it asks the same question and says what it could see" ;;
    esac
    if [ "$tier" = litellm ]; then lq="$q"; else sq="$q"; fi
  done
  case "$lq:$sq" in
    [04]:1)
      _dr_cx_fail "$id is half up: its LiteLLM tier is running and its shim is not, so every request a session sends this lane fails before it reaches LiteLLM" \
        "start the tier that is down: ccrc codex start $id (idempotent: it starts only what is not running)" ;;
    1:[04])
      _dr_cx_fail "$id is half up: its shim is running and its LiteLLM tier is not, so every request the shim forwards fails" \
        "start the tier that is down: ccrc codex start $id (idempotent: it starts only what is not running)" ;;
  esac
  if [ "$lq" = 1 ]; then
    _dr_cx_sessions "$id"
    if [ "$DRX_LIVE" -gt 0 ]; then
      _dr_cx_warn "$id's LiteLLM tier is not running while $DRX_LIVE live session(s) run on this lane, so every turn they send fails at the gateway — a tier that died after its start stays down until the next start" \
        "start it: ccrc codex start $id (every session launch runs the same start)"
    elif [ "$DRX_UNASKED" -gt 0 ]; then
      _dr_cx_warn "$id's LiteLLM tier is not running, and whether any of this lane's registered sessions is live could not be asked ($DRX_UNASKED unanswered) — unmeasured, not idle" \
        "ask by hand${DRX_UNASKED_SID:+ ($(_svc_status_hint "claude-session@$DRX_UNASKED_SID.service"))}; if one is live, start the lane: ccrc codex start $id"
    fi
  fi
  if [ "$lq:$sq" = 1:1 ]; then
    DRX_TIER_WORDS="tiers: none running (a lane is lazy)"
  else
    DRX_TIER_WORDS="tiers: $(_dr_cx_join ', ' "${words[@]}")"
  fi
}

# The lane's LIVE sessions: `~/.cc-sessions/<sid>.wrapper` names the account a
# session runs on (ccd's registry field, read here as a file and never
# written), and `_svc_is_active claude-session@<sid>.service` whether it runs
# — three answers, as `_check_routing`'s census has: live, measured not-live,
# and NOT ASKED (the manager printed no word), which is never folded into
# not-live. `[ -f ]` first, so a FIFO planted at a `.wrapper` path is never
# opened (D-2380's class).
_dr_cx_sessions() {   # <id> — sets DRX_LIVE, DRX_UNASKED, DRX_UNASKED_SID
  local id="$1" reg="$HOME/.cc-sessions" wf w sid
  DRX_LIVE=0; DRX_UNASKED=0; DRX_UNASKED_SID=''
  [ -d "$reg" ] || return 0
  if [ ! -r "$reg" ] || [ ! -x "$reg" ]; then DRX_UNASKED=1; return 0; fi
  for wf in "$reg"/*.wrapper; do
    [ -f "$wf" ] || continue
    w=''; { IFS= read -r w < "$wf"; } 2>/dev/null
    [ "$w" = "$id" ] || continue
    sid="${wf##*/}"; sid="${sid%.wrapper}"
    case "$(_svc_is_active "claude-session@$sid.service")" in
      active|activating|reloading|refreshing|deactivating) DRX_LIVE=$((DRX_LIVE + 1)) ;;
      '') DRX_UNASKED=$((DRX_UNASKED + 1)); [ -n "$DRX_UNASKED_SID" ] || DRX_UNASKED_SID="$sid" ;;
    esac
  done
  return 0
}
```

The new code reads `~/.cc-sessions` as `"$reg"/*.wrapper` off `reg="$HOME/.cc-sessions"`, so `pool-name-parity.test.ts`' count of exactly two `.cc-sessions/<dir>` code literals (:139-165) does not move.

```bash
cd "$(git rev-parse --show-toplevel)" && bash -n ccd/ccrc && bash -n ccd/ccrc-doctor-checks
```

- [ ] **Step 4: Run green, then the neighbours**

```bash
. "<abs scratch>/plan3a-env.sh"; cd "$(git rev-parse --show-toplevel)/server"
"$CENSUS" "$EVID/t5-4-doctor-<k>" ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t <P>   # three calls, the Global Constraints' parts; their sum → Tests 554 passed | 4 skipped (558): Step 0's own total plus ten, every case green (re-derive)
```

```bash
. "<abs scratch>/plan3a-env.sh"; cd "$(git rev-parse --show-toplevel)/server"
"$CENSUS" "$EVID/t5-4-codex"  ./node_modules/.bin/vitest run test/ccrc-codex.test.ts     # → Tests 201 passed (201), unchanged
```

Then one call per suite (ruling F6) for each of `ccrc-install`, `pool-name-parity`, `macos-platform` and `single-definition`, each a block of this shape, labelled `t5-4-<suite>`:

```bash
. "<abs scratch>/plan3a-env.sh"; cd "$(git rev-parse --show-toplevel)/server"
"$CENSUS" "$EVID/t5-4-<suite>" ./node_modules/.bin/vitest run test/<suite>.test.ts           # → each equals its Step 0 line
```

`ccrc-install`'s codex spine cases start real fixture tiers (`startLane`) and end in doctor. That doctor now connects to those tiers and asks their `.started` records. Every such case pins `r.code === doctorCode(home)`, which re-runs the same doctor. Measured on the scratch copy: its 72 codex and doctor cases green, with no new unit and no leaked fixture process.

- [ ] **Step 5: Typecheck the test directory**

```bash
. "<abs scratch>/plan3a-env.sh"; cd "$(git rev-parse --show-toplevel)/server"
"$CENSUS" "$EVID/t5-5-typecheck" ./node_modules/.bin/vitest run test/typecheck-tests.test.ts   # → server/test/ is clean
```

- [ ] **Step 6: Mutation table — measure every row both ways**

Commit the task as WIP first (`cd "$(git rev-parse --show-toplevel)" && git add -A && git commit -qm 'wip: task 5' && git status --short` → empty). Then run every row alone by Task 4 Step 8's three blocks (ruling F7), each block beginning with the env line, with `row=t5-<row>`, `files` set to EVERY file the row edits (`ccd/ccrc` for T5-M6, `ccd/ccrc-doctor-checks` for every other row), the census label `t5-6-<row>`, and `test/ccrc-doctor.test.ts` with the row's `-t` filter. A restore that does not print `restored` stops the table. Counts were measured on the scratch copy, except T5-M12's, which was added after that measurement: re-measure it.

| Row | File: mutation | Suite `-t` filter | Red |
|---|---|---|---|
| T5-M1 | doctor-checks: the half-up arm `    1:[04])` → `    1:[04]XX)` | ccrc-doctor `'the shim up, LiteLLM down'` | 1 |
| T5-M2 | doctor-checks: `if [ "${CX_TIER_WHY:-}" = unit-unproven ]` → `if false` | `'restart window'` | 1: a FAIL appears, the WARN does not |
| T5-M3 | doctor-checks: the stale `*)` arm's `_dr_cx_warn` → `: _dr_cx_warn` (cannot-tell read as current) | `'cannot be told'` | 1 |
| T5-M4 | doctor-checks: `if [ "$DRX_LIVE" -gt 0 ]` → `if false` | `'LIVE session'` | 1 |
| T5-M5 | doctor-checks: `case "$(_svc_is_active "claude-session@$sid.service")" in` → `case active in` | `'LIVE session'` | 1: the stopped-session control WARNs |
| T5-M6 | ccd/ccrc `_codex_lane_answer`: `resp="$(_plat_timeout "$(_codex_probe_secs)" "$BASH" -c '` → `resp="$("$BASH" -c '` | `'never a hang'` | 1: `runDoctorBounded` throws at its 60 s deadline |
| T5-M10 | doctor-checks: after the unit-unproven `_dr_cx_warn …`, append `; systemd-run --user --unit=doctor-mutation true >/dev/null 2>&1` | ccrc-doctor `'restart window'` | 1: `systemdRunCalls` is not empty |
| T5-M11 | doctor-checks: delete `      _dr_cx_tiers "$id"` | `'ANOTHER lane\|NO id'` | 2 |
| T5-M12 | doctor-checks: `elif [ "$own" -eq 0 ]; then` → `elif false; then` | `'another process holds its port'` | 1: the FAIL gains the "cannot identify" tail (derived, not measured) |

The foreign-listener survival assertion has no row (Why): report it as a behaviour pin with no safe red mutation. Never force one.

- [ ] **Step 7: Commit**

```bash
. "<abs scratch>/plan3a-env.sh"; cd "$(git rev-parse --show-toplevel)"
git status --short                                                         # → empty: every row was restored
git commit --amend -q -F - <<'EOF'
feat(doctor): _check_codex part 2 — tier identity, half-up lanes, stale code, a down gateway (Plan 3a Task 5)

Tier rows through the lane library's bounded loopback probes (ruling R-C4),
every foreign finding in _codex_foreign_what's words and left running.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git diff --name-only "$BASE" HEAD | sort   # after the commit (ruling F3)
# → ccd/ccrc-doctor-checks server/test/ccrc-doctor.test.ts
```


### Task 6: The usage pair becomes ccrc's own, `ccrc-codex-usage@`, placed on fleet/both, one instance per codex lane; every timer enable degrades honestly

> Rulings applied:
> - **R2 / R-C1.** The pair is renamed and never placed at `ccgpt-usage@`. It is placed on `fleet` and `both`, Linux only. On Darwin the install step and the doctor rows state a not-applicable, and a forced-Darwin case pins each (critic #10).
> - **R6.** The converge withholds ccrc's instance while another repository's `ccgpt-usage@<id>.timer` is enabled for the same id. `_check_codex` gains a WARN row whose remedy is the operator's own disable. The flat, id-less foreign timer is reported as unattributable (critic #6).
> - **R3 (usage half).** The renamed service carries Task 1's `TimeoutStartSec=300` unchanged. The in-process refusal of the device-code flow is Task 1's (critic #2).
> - **R11, R12, R13; F2, F6.** Every suite command runs through the Global Constraints' `census-run.sh` (`$CENSUS`), each as its own foreground call. Every bash block below that uses `$SCRATCH`, `$CENSUS` or a base begins by sourcing `plan3a-env.sh`, and reads this task's base and evidence directory back from `$SCRATCH/t6-base` and `$SCRATCH/t6-ev`, so no step relies on a variable an earlier call set. Deviations are named by slug. Every fixture is `codex-a`, `codex-b`, `ext-a` or `ext-b`, with pure-parse ports `45010`/`45011`.
> - **2b-2 carry-forward 10**, measured on `1f9fa22d`: **nine** `_inst_enable` timer refusals append nothing to `INST_DEGRADED`, at `ccd/ccrc:14417, 14423, 14432, 14438, 14443, 14449, 14455, 14460, 14468`. That is not eight: the watchdog's landed after 2b-2's text was written.
> - **2b-1 item 12** (critic #23): `_check_codex` must exist before any instance is enabled. This task therefore follows Task 4, and it lands the converge in the same commit as the doctor rows that watch it.

**Files:**
- Rename, with `git mv`:
  - `deploy/systemd/ccgpt-usage@.service` → `deploy/systemd/ccrc-codex-usage@.service`
  - `deploy/systemd/ccgpt-usage@.timer` → `deploy/systemd/ccrc-codex-usage@.timer`

  Then edit both (Step 6a).
- Modify: `ccd/ccrc`. It is **not** stamped (D-3171). `ccd/ccd` is not touched. Every insert lands **below** `ccd/ccrc:11635`, the highest line the compaction-card corpus cites into this file (Step 9 measures it), so the S6-R11 census owes nothing:
  - A new block between `_inst_codex_runtime`'s closing `}` (`grep -n '^_inst_codex_runtime() {' ccd/ccrc`) and `_inst_enable`'s header (`grep -n '^# ── _inst_enable — ask systemd to read them' ccd/ccrc`). It holds `_codex_usage_timer`, `_codex_usage_foreign`, `_codex_usage_wants`, `_codex_usage_enabled`, `_codex_usage_enabled_ids`, `_codex_usage_flat_foreign`, `_inst_codex_usage` and `_inst_enable_timer`.
  - `_inst_units`: the six-line comment at `grep -n "NOT the GPT-usage publisher's" ccd/ccrc` (`:14223-14228` today) becomes the placement.
  - `_inst_enable` (`grep -n '^_inst_enable() {' ccd/ccrc`, `:14381`):
    - its Darwin dispatch line;
    - the nine two-line timer enables (`grep -n 'could not enable .*\.timer — run' ccd/ccrc`);
    - one call to `_inst_codex_usage` after the watchdog's enable.
  - `_uninst_units`: its comment at `grep -n "NOT \`ccgpt-usage@.{service,timer}\`: \`_inst_units\` places neither" ccd/ccrc` (`:21484`) changes, and the two template files join its `rm -f`. Its instances are Task 7's.
- Modify: `ccd/ccrc-doctor-checks`:
  - `_DR_CODEX_USAGE_STALE_S`, `_dr_codex_usage_box` and `_dr_codex_usage`, directly above Task 4's `_check_codex` (`grep -n '^_check_codex() {' ccd/ccrc-doctor-checks`);
  - two calls inside `_check_codex` (Step 6g).

  The highest `ccrc-doctor-checks:<N>` citation in tracked non-docs text is `:2542`, so nothing cited moves.
- Modify: `ccd/ccgpt-usage.py`, ONE docstring line in `_required_env` (`grep -n '(\`ccgpt-usage@<id>.timer\`) always names its instance' ccd/ccgpt-usage.py`, `:151`). Nothing hashes this file: `_codex_started_json` hashes only the shim.
- Test: `server/test/ccrc-install.test.ts`:
  - the harness's `systemctl` stub (`grep -n "plant('systemctl', \[" server/test/ccrc-install.test.ts`, `:494`);
  - `UNIT_FILES` (`:3970`);
  - three cases rewritten, never deleted (2b-1 item 13), and the `--role server` case;
  - four new blocks: the isolation describe, a real-spine case, the nine-degrade case and the text guard.
- Test: `server/test/install-census.test.ts`:
  - `DEPLOY_SH_WITHHOLDS` (`:1478`, a one-commit entry that Task 7 deletes);
  - the deploy-enable case's families and prose (`:1545-1566`);
  - the release describe's anchor (`:1759`);
  - a new own-name pin in the foreign-name describe (`:1593`). `FOREIGN_LIVE_BOX_UNIT_PREFIX = 'ccgpt-usage@'` stays, unchanged.
- Test: `server/test/ccrc-doctor.test.ts`:
  - two new describes, one under `describeLinux` (its end-to-end case included) and one for any host, and one line in Task 4's doctor-clean codex fixture;
  - add `codexRoster, plantCodexUsage, plantForeignUsage` to its `./codexLaneFixture.js` import (Task 4 adds that import line; extend it).
- Test: `server/test/codexLaneFixture.ts`: two new exports, `plantCodexUsage` and `plantForeignUsage`.
- Test: `server/test/ccrc-update.test.ts` and `server/test/ccrc-install-graphify.test.ts`: a `disable` arm in each harness's `systemctl` stub, for containment. See Why.
- **Unchanged, measured:** `server/test/installTreeFixture.ts`. `TREE_FILES` carries `'deploy/systemd'` as a DIRECTORY entry (`grep -n "  'deploy/systemd'," server/test/installTreeFixture.ts`), so the renamed pair reaches every fixture tree with no edit.

**Every tracked name of the pair, and who changes it.** Measured with `git grep -n 'ccgpt-usage@' -- ':!docs'` on `1f9fa22d`, 38 lines:

| Site | Today | Task |
|---|---|---|
| `deploy/systemd/ccgpt-usage@.{service,timer}` | the pair, with self-references (`.timer:6-7`, `.service:21-25`) | 6: `git mv` + edit |
| `ccd/ccgpt-usage.py:151` | docstring names `ccgpt-usage@<id>.timer` | 6 |
| `ccd/ccrc:14223` | `_inst_units`: "placed by no installer yet" | 6: becomes the placement |
| `ccd/ccrc:21484` | `_uninst_units`: "`_inst_units` places neither" | 6 (template), 7 (instances) |
| `server/test/ccrc-install.test.ts:3999, :4077, :4105, :4140, :5807-5847` | UNIT_FILES comment; "places NO ccgpt-usage@"; the foreign-pair survival case; the unit pin; `--role server` | 6 |
| `server/test/install-census.test.ts:1552-1561` | the deploy-enable case's prose | 6 |
| `server/test/install-census.test.ts:1585-1616` | the foreign-name guard (its PREFIX stays) | kept, and 6 adds an own-name pin |
| `server/test/ccrc-uninstall.test.ts:802-840` | the foreign-pair survival case | 7 |
| `deploy/deploy.sh:822-825` | "The chain above places NO `ccgpt-usage@`" | 7 |
| the spec, `:196, :249, :598, :604, :730, :947` (and `:505`, a fenced diagram that takes no pointer: §20.4's reading rule covers it) | the template's name | 11 (§20 plus same-line pointers) |

**Interfaces:**
- Consumes:
  - From Task 4 (check each in Step 0):
    - `_check_codex` is in `CCRC_DOCTOR_CHECKS` after `models`. It SKIPs on role `server` and on an empty codex population, and FAILs on an unreadable roster or a missing jq.
    - It keeps a per-lane loop over the codex ids, which Task 5 extends. It records every finding through `_dr_cx_warn`/`_dr_cx_fail` into `DRX_CLASS`/`DRX_WHAT`/`DRX_FIX`, collects PASS fragments in `DRX_OK`, and prints them all through `_dr_cx_report`, whose return code is the worst class. Step 6g wires into exactly those names.
    - Task 4's doctor-clean codex fixture in `ccrc-doctor.test.ts`, `async healthyCodexBox(prefix, ids = ['codex-a'])`: free ports, and a converged lane whose registry assigns haiku to `probe-model`, which its catalogue lists.
  - From Task 1: `ccd/ccgpt-usage.py` refuses the Authenticator's device-code flow in-process, before any write, answering `login-required`. The `TimeoutStartSec` below bounds what is left: a stalled refresh or request.
  - From 2b-2, unchanged:
    - `_codex_lanes`: rc 0 with ids (empty means none), rc 1 `roster-invalid`, rc 2 `missing-dependency`;
    - `_codex_shape`, `_codex_say` (uses `$PROG`), `_models_roster_path`, `_plat_mtime`, `BOX_UNIT_DIR`, `WRAPPER_ID_RE`;
    - doctor's `_dr_warn`, `_dr_fail`, `_dr_join`, `_dr_log_hint` and `CCRC_UNIT_DIR`;
    - `deploy/models-op.mjs show`, check-only. On a codex lane it answers one object: `{ok, registry: {classes: {haiku, …}} | null, derived: {retired: […]}, catalogue: {stale} | null}`. Measured in a scratch HOME: `retired` lists the haiku id when a live catalogue lacks it, and a broken registry answers `ok:false` with exit 1;
    - test helpers: `runStepHarness`, `lanesFn`, `DEGRADED_OUT`, `ccrcFunction`, `codexBox`, `codexRoster`, `freeLanes`, `doctorCode`, `systemctlCalls`, `unitDir`, `placed`, `freshBox`.
- Produces:
  - `deploy/systemd/ccrc-codex-usage@.service`: `ExecStart=%h/.ccrc/runtime/codex/current/bin/python -I %h/.local/bin/ccgpt-usage.py`, `Environment=CCGPT_ACCOUNT_ID=%i`, `Environment=LITELLM_LOCAL_MODEL_COST_MAP=True`, and **`TimeoutStartSec=300`** (Task 1's, carried by the `git mv`). `deploy/systemd/ccrc-codex-usage@.timer`: `OnActiveSec=5min`, `OnUnitActiveSec=15min`, `AccuracySec=1min`, `WantedBy=timers.target`.
  - `_inst_units` places both at `~/.config/systemd/user/`, mode 644, on every role but `server`, Linux only.
  - In `ccd/ccrc`:
    - `_codex_usage_timer <id>` prints `ccrc-codex-usage@<id>.timer`.
    - `_codex_usage_foreign <id>` prints `ccgpt-usage@<id>.timer`. ccrc reads it and never acts on it.
    - `_codex_usage_wants` prints `$BOX_UNIT_DIR/timers.target.wants`.
    - `_codex_usage_enabled <unit>` is rc 0 iff that unit's wants link exists.
    - `_codex_usage_enabled_ids` prints one id per line, in glob order, with rc 1 when the shape contract is missing.
    - `_codex_usage_flat_foreign` is rc 0 iff `ccgpt-usage.timer`'s wants link exists.
    - `_inst_enable_timer <word> <unit>`: enables, or prints `install: <word>: could not enable <unit> — run: systemctl --user enable --now <unit>` on stderr and appends `<unit>` to `INST_DEGRADED`. It always returns 0.
    - `_inst_codex_usage` is called from `_inst_enable` on both platform arms.
  - `_inst_codex_usage`'s transcript lines:
    - `install: codex-usage: none — no codex lane in the roster`
    - `install: codex-usage: enabled for <ids|no lane>; withheld from <ids|no lane>; withdrawn from <ids|no lane>`
    - `install: codex-usage: NOT ENABLED for <id> — another repository's ccgpt-usage@<id>.timer is enabled on this box, …` (degraded `codex-usage`)
    - `install: codex-usage: NOT CONVERGED — …` (roster rc 1, jq rc 2, or no shape contract; degraded `codex-usage`; nothing enabled or disabled)
    - `install: codex-usage: note — another repository's ccgpt-usage.timer is enabled on this box. …`
    - `install: codex-usage: not applicable on macOS — …`
  - `INST_DEGRADED` gains each refused timer's UNIT NAME (the nine, and each instance), and `codex-usage`.
  - In `ccd/ccrc-doctor-checks`:
    - `_DR_CODEX_USAGE_STALE_S=2700`.
    - `_dr_codex_usage_box`: WARN findings recorded through Task 4's `_dr_cx_warn`, rc 2 or 0. It sets `DR_CODEX_USAGE_PAIR=present|missing` and `DR_CODEX_USAGE_BOX_NOTE`, and FAILs with rc 1 only when ccrc's reader is not loaded.
    - `_dr_codex_usage <id>`: the same contract. It sets `DR_CODEX_USAGE_NOTE`, the lane's PASS fragment.
  - In `codexLaneFixture.ts`:
    - `plantCodexUsage(home, id, {pair?, enabled?, row?, ageS?, linkAgeS?}) → {unitDir, link, row}`;
    - `plantForeignUsage(home, id | null) → link`.
  - Hand-offs: Task 7 (uninstall instances, account removal, deploy.sh, and deleting the one-commit `DEPLOY_SH_WITHHOLDS` entry), Task 8 (cites `D-3721`), Task 10 (the rehearsal consumes the converge and the rows), Task 11 (the spec lines in the table above).

**Why:**

**Why a new name, and not the template's.** Merging this plan is itself a rollout. Every merge to `main` becomes a dev prerelease, and both boxes follow it. The live fleet box has two `external` rows with codex telemetry. It has another repository's `ccgpt-usage@` template, with one instance of it enabled, and that repository's flat usage timer is enabled too. `_inst_atomic` has no ownership check, so placing ccrc's pair at `ccgpt-usage@` would rewrite a running timer's definition on the auto-update. The enabled instance would then run ccrc's publisher against a `lane.json` that does not exist. Under `ccrc-codex-usage@` nothing of the other repository's is written, read for action, or named in a systemctl call. The name is also outside `spineSystemctlArms()`' `*" ccgpt-"*` route, so every spine harness answers it as an ordinary unit.

**Why this is inert on the live box.** No roster row there is `exec.kind: "codex"`:
- `_inst_codex_usage` prints `none`, and nothing is enabled or disabled. Its reads are one `jq` over the roster and one directory glob.
- `_check_codex` SKIPs on the empty population (Task 4), so the box-level rows never run. The enabled flat foreign timer draws no WARN there.
- What lands is two new unit files that nothing enables.

Task 10's rehearsal pins all of this.

**Why the instances CONVERGE, and don't only enable.**
- A lane flipped back to `external` must stop being polled by ccrc on the next install (3b's rollback).
- An auto-update inside a cutover window runs this step too (R-O6).

So the enabled set is made exactly the roster's codex lanes (`D-3718`). An unreadable roster or a missing jq converges NOTHING, in either direction, because a set nobody read is not an empty set.

**Why a second writer degrades (R6).**
- Two publishers would race one `~/.cc-limits/<id>.json`.
- Two Authenticator refreshes would race one rotating refresh token in the lane's adopted OAuth directory.

ccrc may stop only its own unit. So while the other repository's instance for that id is enabled, ccrc's is withheld, and withdrawn if it was on, and the line names the operator's own `disable` (`D-3719`). The flat `ccgpt-usage.timer` names no lane; its lane is the other repository's own shell default, which ccrc does not spell. It is therefore reported as unattributable and blocks nothing.

**Why "enabled" is read from the wants links.** `enable` of a timer with `WantedBy=timers.target` makes exactly one link, `timers.target.wants/<unit>`, and `disable` removes it. No systemctl verb lists a template's enabled instances. A per-id `is-enabled` needs the user bus for a question one directory answers, and uninstall must find ccrc's instances on a box whose bus is down (`D-3726`). The converge, uninstall, account removal and doctor all read the same helpers. What they cannot see is stated in the helpers' header: a timer started but never enabled, or one enabled under another target.

**Why every timer degrade is now counted.** Until now, nine timer refusals printed their remedy and appended nothing to `INST_DEGRADED`. The closing line then read "every step above converged" over a timer that never armed, which is the defect that line's own comment names. One helper now spells the remedy once and names the degraded step by its unit. The real-spine case derives the expected set from what the run actually asked systemd, so a tenth timer is measured the day it lands.

**Why `TimeoutStartSec=300`, Task 1's value, is kept.** A oneshot has no start timeout by default. While it runs, its timer starts no second instance, so a hung poll would silence that lane's row for good. One poll is a token refresh plus one request that the publisher bounds at 30 s. The device-code flow, the one path that waits for minutes, is refused in-process by Task 1. Task 1 set 300 s, `ccrc-models.service`'s own bound, and this task keeps it. A pin keeps the bound under one timer cycle.

**Why the doctor rows remedy `ccrc install`.** `cmd_doctor` runs a fixer on a FAIL only, one contract for every fixer (D-3113), and a stopped poller is a WARN (R-C8). So the missing-timer WARN names the converge (`D-3721`), and Task 8 cites that slug.

**Why macOS answers not-applicable.** `_inst_units_darwin` places no timer at all (decision 17). A WARN would stand on every macOS codex lane for ever, the noise that `_inst_linger_darwin`'s doctrine refuses (`D-3720`). `HEALTHY_SKIPS` does not move: these rows never SKIP the whole check, and a healthy box has no codex lane. Step 9 measures it.

**Why the template's removal lands HERE.** `install-census.test.ts`'s "every systemd unit file the install spine places is removed by the uninstall census" reds the moment `_inst_units` places the pair. So the two `rm -f` operands ride this commit. Disabling the instances before that removal is Task 7's, as is deploy.sh's placement. For that one commit the pair is declared in `DEPLOY_SH_WITHHOLDS`, and Task 7 deletes the entry when deploy.sh learns the lines. The withholding describe's direction 2 reds if Task 7 forgets. The plan squash-merges, so `main` never carries this commit alone.

**Why the update and graphify stubs gain a `disable` arm.** The converge can now call `systemctl --user disable --now` wherever `_inst_enable` runs. That is the install spine, which `ccrc update` re-runs from the staged tree, and the graphify install suite's spine. Measured on `1f9fa22d`, no fixture in either file roster a codex lane or plants a `ccrc-codex-usage@` wants link (Step 0 greps), so the arm is containment. "Every new systemctl path gets a recorder in the same commit."

- [ ] **Step 0: Record the base, check the census script, and measure the preconditions. Stop and report if any answer differs.**

```bash
. "<abs scratch>/plan3a-env.sh"
test -x "$CENSUS" || { echo "write the Global Constraints' census-run.sh first"; exit 1; }   # the plan's one census script (F10)
git rev-parse HEAD > "$SCRATCH/t6-base" && mkdir -p "$SCRATCH/t6-ev"   # every later step reads these back (F2)

grep -n '^_check_codex() {' ccd/ccrc-doctor-checks                              # 1 line (Task 4)
grep -c 'could not enable [a-z.-]*\.timer — run: systemctl --user enable --now' ccd/ccrc   # 9 (carry-forward 10)
git ls-files deploy/systemd | grep -cE '@\.(service|timer)$'                  # 2: ccgpt-usage@.service, ccgpt-usage@.timer (claude-session@.service.d/limits.conf is a drop-in, not a template)
git ls-files deploy/systemd | grep -c 'ccrc-codex-usage@'                      # 0
grep -n "  'deploy/systemd'," server/test/installTreeFixture.ts                # 1 (the directory entry)
grep -n "NOT the GPT-usage publisher's" ccd/ccrc                               # 1 (_inst_units, :14223)
grep -n "NOT \`ccgpt-usage@.{service,timer}\`: \`_inst_units\` places neither" ccd/ccrc   # 1 (:21484)
grep -noE 'ccd/ccrc:[0-9]+' docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md \
  docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md README.md | sed 's/.*://' | sort -n | tail -1   # 11635
grep -n '^_inst_codex_runtime() {\|^_inst_enable() {\|^_inst_units() {\|^_uninst_units() {' ccd/ccrc   # all below 11635
grep -lE 'kind: .codex.|codexRoster|ccrc-codex-usage@' server/test/ccrc-update.test.ts server/test/ccrc-install-graphify.test.ts   # nothing (Why: containment)
grep -n "^async function healthyCodexBox" server/test/ccrc-doctor.test.ts   # Task 4's doctor-clean fixture
```

What a wrong answer means:
- **`_check_codex` absent:** Task 4 has not landed, and it comes first (2b-1 item 12's order).
- **A count other than nine:** re-derive. The nine-degrade case derives its expected set from the run, and only its floor (`≥ 9`) quotes the number.
- **Any `ccrc-codex-usage@` already tracked:** stop. This table is stale.

- [ ] **Step 1: Write the failing tests in `server/test/ccrc-install.test.ts`.**

1a. **The harness's `systemctl` stub.** In the `plant('systemctl', [...])` call of the runner's env, replace the `enable)` arm, from `'  enable)',` through its `'    exit 0 ;;',`, with the block below. It adds a `disable` arm after it:

```ts
    '  enable)',
    '    [ "$2" = "--now" ] && [ -n "$3" ] || { echo "fixture systemctl: unexpected argv: $*" >&2; exit 90; }',
    // A named unit whose `enable --now` refuses — the shape of a unit file
    // systemd will not accept, which must reach the operator as a refusal
    // naming that unit.
    '    if [ -f "$HOME/fixture-enable-fail" ]; then',
    '      IFS= read -r bad < "$HOME/fixture-enable-fail"',
    '      [ "$3" = "$bad" ] && { echo "Failed to enable unit $3: fixture" >&2; exit 1; }',
    '    fi',
    // Plan 3a Task 6: EVERY timer refused at once, except the one whose
    // refusal is fatal, so one install measures every degrading enable.
    '    if [ -f "$HOME/fixture-enable-fail-timers" ] && [ "$3" != ccd-cap-scopes.timer ]; then',
    '      case "$3" in *.timer) echo "Failed to enable unit $3: fixture" >&2; exit 1 ;; esac',
    '    fi',
    // Plan 3a Task 6: an instance of ccrc's usage template is enabled the way
    // systemd enables one, by its `timers.target.wants` link, so the doctor at
    // the end of the SAME install reads what this step did (`enable-linger`'s
    // causal chain, below). Only these instances: nothing reads another
    // timer's link.
    '    case "$3" in ccrc-codex-usage@*.timer)',
    '      mkdir -p "$HOME/.config/systemd/user/timers.target.wants"',
    '      ln -sfn "$HOME/.config/systemd/user/ccrc-codex-usage@.timer" "$HOME/.config/systemd/user/timers.target.wants/$3" ;;',
    '    esac',
    '    exit 0 ;;',
    // Plan 3a Task 6: `_inst_codex_usage` withdraws a ccrc usage timer whose
    // lane is no longer a codex lane. Recorded, answered, never a real one;
    // the wants link goes as a manager's `disable` removes it.
    '  disable)',
    '    [ "$2" = "--now" ] && [ -n "$3" ] || { echo "fixture systemctl: unexpected argv: $*" >&2; exit 90; }',
    '    rm -f -- "$HOME/.config/systemd/user/timers.target.wants/$3"',
    '    exit 0 ;;',
```

1b. **`UNIT_FILES`.** Delete the two-line comment that begins `  // NOT the GPT-usage publisher's \`ccgpt-usage@.{service,timer}\`: no role`. Insert these rows directly after `['ccrc-models.timer', 'deploy/systemd/ccrc-models.timer'],`:

```ts
  // Plan 3a Task 6: ccrc's OWN usage pair (D-3717),
  // ROLE-GATED `!= server` like the pairs above it, Linux only. The template
  // lands on every fleet/both box. Its INSTANCES are armed per codex lane by
  // `_inst_codex_usage`, and this describe's roster has none, so none is.
  ['ccrc-codex-usage@.service', 'deploy/systemd/ccrc-codex-usage@.service'],
  ['ccrc-codex-usage@.timer', 'deploy/systemd/ccrc-codex-usage@.timer'],
```

1c. **Rewrite the case `places NO ccgpt-usage@ unit file on any role`** (2b-1 item 13: rewritten deliberately, never deleted). Replace the whole `itLinux('places NO ccgpt-usage@ unit file on any role …', () => { … });` with:

```ts
  itLinux('places ccrc\'s OWN usage pair on both and fleet, and still writes no ccgpt-usage@ name on any role (Plan 3a Task 6)', () => {
    // 2b-1 item 13, rewritten deliberately. Until Plan 3a no role placed a
    // usage pair at all (D-3172): its only name was another repository's live
    // template on the fleet box (final review F-1). The pair now ships as
    // `ccrc-codex-usage@` and lands on both and fleet. The foreign name is
    // still never written, and with no codex lane rostered no instance is
    // enabled, which is the live box's shape once this merges. The
    // `--role server` describe pins the third role.
    const home = freshBox('ccrc-install-codex-usage-fleet-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'agent.env'),
      'CCRC_SERVER_URL=http://127.0.0.1:7788\nCCRC_AGENT_TOKEN=fixture-not-a-real-token\n');
    const r = runInstall(home, ['install', '--role', 'fleet']);
    expect(r.code, r.stderr).toBe(0);
    for (const [role, h, out] of [['both', units.home, units.r.stdout], ['fleet', home, r.stdout]] as const) {
      for (const u of ['ccrc-codex-usage@.service', 'ccrc-codex-usage@.timer']) {
        expect(readFileSync(unitDir(h, u)), `--role ${role}: ${u} is not the placed tree's copy`)
          .toEqual(readFileSync(placed(h, 'deploy', 'systemd', u)));
      }
      expect(readdirSync(unitDir(h)).filter((n) => n.startsWith('ccgpt-usage')),
        `--role ${role} wrote a name another repository owns on the live fleet box`).toEqual([]);
      expect(existsSync(placed(h, 'deploy', 'systemd', 'ccgpt-usage@.service')),
        'the old template name still ships in the placed tree').toBe(false);
      const argv = systemctlCalls(h).map((c) => c.argv).join('\n');
      expect(argv, `--role ${role}: a systemctl verb named another repository's unit`).not.toContain('ccgpt-usage');
      expect(argv, `--role ${role}: an instance was armed on a roster with no codex lane`).not.toContain('ccrc-codex-usage@');
      expect(out).toMatch(/^install: codex-usage: none — no codex lane in the roster$/m);
    }
  });
```

1d. **Extend the foreign-pair survival case** (`a FOREIGN ccgpt-usage@ unit pair and its enabled instance survive install --role fleet and uninstall, byte for byte`). Keep every line of it. Insert this after `untouched('after install --role fleet');`:

```ts
    // Plan 3a Task 6: ccrc's OWN pair lands BESIDE the foreign one, under its
    // own name, and (below) leaves with uninstall while the foreign one stays.
    for (const u of ['ccrc-codex-usage@.service', 'ccrc-codex-usage@.timer']) {
      expect(existsSync(unitDir(home, u)), `install --role fleet did not place ccrc's own ${u} beside the foreign pair`).toBe(true);
    }
```

Then insert this after `untouched('after uninstall');`:

```ts
    for (const u of ['ccrc-codex-usage@.service', 'ccrc-codex-usage@.timer']) {
      expect(existsSync(unitDir(home, u)), `uninstall left ccrc's own ${u}`).toBe(false);
    }
```

1e. **The unit pin.** Retitle `ccgpt-usage@.service runs the isolated runtime's interpreter under -I, with the cost map local (D-3486)` to:

`ccrc-codex-usage@.service runs the isolated runtime's interpreter under -I, with the cost map local and a start bound (D-3486, Plan 3a Task 6)`.

Change its `read(join(REPO, 'deploy', 'systemd', 'ccgpt-usage@.service'))` to `read(join(REPO, 'deploy', 'systemd', 'ccrc-codex-usage@.service'))`. In its first comment, change `The pair is still placed by no installer (D-3172, the two cases above); this pins what Plan 3 will arm.` to `Plan 3a places the pair under ccrc's own name and arms one instance per codex lane (the cases above and the converge describe).`. Then insert this after the `expect(code.filter((l) => /^Environment=["']?PATH=/.test(l)), …).toEqual([]);` assertion:

```ts
    // A oneshot has no start timeout by default, and its timer starts no
    // second instance while one runs: a poll that hung would silence the
    // lane's usage row for good. Bounded, and inside one timer cycle.
    const bound = code.filter((l) => /^TimeoutStartSec=\d+$/.test(l));
    expect(bound, 'the usage service carries no TimeoutStartSec — a hung poll would never end').toHaveLength(1);
    const timer = read(join(REPO, 'deploy', 'systemd', 'ccrc-codex-usage@.timer'))
      .split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));
    const cycle = timer.map((l) => /^OnUnitActiveSec=(\d+)min$/.exec(l)).find((m) => m !== null);
    expect(cycle, 'the usage timer\'s OnUnitActiveSec is not spelled in minutes — this pin has gone stale').toBeDefined();
    expect(Number(bound[0]!.slice('TimeoutStartSec='.length)), 'a poll may still be running when the next one is due')
      .toBeLessThan(Number(cycle![1]) * 60);
    // The converge, uninstall, account removal and doctor read ENABLEMENT as
    // this target's wants link (D-3726):
    // another target and every one of those readers goes blind.
    expect(timer, 'the usage timer is no longer wanted by timers.target').toContain('WantedBy=timers.target');
```

1f. **The `--role server` case** (grep for `spine minus nothing`):
- In the `UNIT_FILES` skip condition, add `|| dest.startsWith('ccrc-codex-usage@')` after `|| dest.startsWith('ccd-tmp-sweep.')`.
- Change the comment sentence `The ccgpt-usage@ pair is placed on NO role (F-1), and its absence is asserted here too, for the third role.` to `Another repository's ccgpt-usage@ name is written on NO role (F-1), and ccrc's own usage pair is \`!= server\` (Plan 3a): both absences are asserted here, for the third role.`
- Insert this after the two `ccgpt-usage@` `existsSync` lines:

```ts
    expect(existsSync(unitDir(home, 'ccrc-codex-usage@.service'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccrc-codex-usage@.timer'))).toBe(false);
```

- Insert this after `expect(systemctlCalls(home).map((c) => c.argv).join('\n')).not.toContain('ccgpt-usage');`:

```ts
    expect(systemctlCalls(home).map((c) => c.argv).join('\n')).not.toContain('ccrc-codex-usage');
```

1g. **The converge, in isolation.** Insert this directly above `describe('ccrc install: the codex runtime step on a real spine (Plan 2b-2 Task 10)', …`:

```ts
/** `_inst_codex_usage` alone (Plan 3a Task 6). The converge, its six
 *  `_codex_usage_*` reads, `_codex_shape`, `_codex_say` and
 *  `_inst_enable_timer` come REAL out of ccd/ccrc; `_codex_lanes` is stubbed
 *  by `lanesFn`. `systemctl` is a bash FUNCTION: it shadows the isolation
 *  wall's binary, so every call the step makes lands in `$HOME/calls`, and a
 *  call made any other way still reaches the wall. It answers
 *  `enable --now` and `disable --now` as a manager does, by planting and
 *  removing the timer's `timers.target.wants` link, so the converge's own
 *  reads see its own acts. A unit listed in `refuse` is refused. `enabled`,
 *  `foreign` and `flatForeign` plant links before the step runs. */
function runUsageStep(c: {
  lanes?: string[]; lanesRc?: number; role?: 'both' | 'fleet' | 'server'; os?: 'linux' | 'darwin';
  enabled?: string[]; foreign?: string[]; flatForeign?: boolean; refuse?: string[];
}): StepRun & { links: string[] } {
  const home = mkTmp('ccrc-codex-usage-step-');
  const units = join(home, '.config', 'systemd', 'user');
  const wants = join(units, 'timers.target.wants');
  mkdirSync(wants, { recursive: true });
  const link = (name: string, template: string): void => symlinkSync(join(units, template), join(wants, name));
  for (const id of c.enabled ?? []) link(`ccrc-codex-usage@${id}.timer`, 'ccrc-codex-usage@.timer');
  for (const id of c.foreign ?? []) link(`ccgpt-usage@${id}.timer`, 'ccgpt-usage@.timer');
  if (c.flatForeign === true) link('ccgpt-usage.timer', 'ccgpt-usage.timer');
  writeFileSync(join(home, 'refuse'), (c.refuse ?? []).map((u) => `${u}\n`).join(''));
  const r = runStepHarness(home, [
    'set -uo pipefail',
    'PROG=ccrc',
    `INST_ROLE=${c.role ?? 'both'}`,
    `CCD_OS=${c.os ?? 'linux'}`,
    'BOX_UNIT_DIR="$HOME/.config/systemd/user"',
    'INST_DEGRADED=()',
    `. '${join(REPO, 'ccd', 'ccrc-wrapper-shape')}'`,
    lanesFn(c.lanes ?? ['codex-a'], c.lanesRc ?? 0),
    'systemctl() {',
    '  printf \'systemctl %s\\n\' "$*" >> "$HOME/calls"',
    '  { [ "${1:-}" = --user ] && [ "${3:-}" = --now ] && [ -n "${4:-}" ]; } || { echo "fixture systemctl: unexpected argv: $*" >&2; return 90; }',
    '  if grep -qxF -- "$4" "$HOME/refuse"; then echo "Failed to $2 unit $4: fixture" >&2; return 1; fi',
    '  case "$2" in',
    '    enable) ln -sfn "$HOME/.config/systemd/user/${4%%@*}@.timer" "$HOME/.config/systemd/user/timers.target.wants/$4"; return 0 ;;',
    '    disable) rm -f -- "$HOME/.config/systemd/user/timers.target.wants/$4"; return 0 ;;',
    '  esac',
    '  echo "fixture systemctl: unexpected argv: $*" >&2; return 90',
    '}',
    ...['_codex_say', '_codex_shape', '_codex_usage_timer', '_codex_usage_foreign', '_codex_usage_wants',
      '_codex_usage_enabled', '_codex_usage_enabled_ids', '_codex_usage_flat_foreign', '_inst_enable_timer',
      '_inst_codex_usage'].map((f) => ccrcFunction(f)),
    '_inst_codex_usage; rc=$?',
    DEGRADED_OUT,
    'exit "$rc"',
  ].join('\n'));
  return { ...r, links: readdirSync(wants).sort() };
}

describe('ccrc install: the codex usage converge, measured in isolation (_inst_codex_usage, Plan 3a Task 6)', () => {
  const T = (id: string): string => `ccrc-codex-usage@${id}.timer`;
  const EN = (id: string): string => `systemctl --user enable --now ${T(id)}`;
  const DIS = (id: string): string => `systemctl --user disable --now ${T(id)}`;
  const ctl = (r: StepRun): string[] => r.calls.filter((l) => l.startsWith('systemctl '));
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  it('a server-role box: silent, and the manager is never asked', () => {
    const r = runUsageStep({ role: 'server', lanes: ['codex-a'], enabled: ['ext-a'] });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    expect(ctl(r)).toEqual([]);
    expect(r.links).toEqual([T('ext-a')]);
    expect(r.degraded).toEqual([]);
  });

  it('no codex lane and no ccrc timer enabled: one line, and the manager is never asked', () => {
    const r = runUsageStep({ lanes: [] });
    expect(r.stdout).toBe('install: codex-usage: none — no codex lane in the roster\n');
    expect(ctl(r)).toEqual([]);
    expect(r.degraded).toEqual([]);
  });

  it('one timer per codex lane, in roster order, and none for any other id', () => {
    const r = runUsageStep({ lanes: ['codex-a', 'codex-b'] });
    expect(ctl(r)).toEqual([EN('codex-a'), EN('codex-b')]);
    expect(r.links).toEqual([T('codex-a'), T('codex-b')]);
    expect(r.degraded).toEqual([]);
    expect(r.stdout).toBe('install: codex-usage: enabled for codex-a codex-b; withheld from no lane; withdrawn from no lane\n');
  });

  it('a ccrc timer whose id is no longer a codex lane is DISABLED first — a flip-back converges on the next install', () => {
    const r = runUsageStep({ lanes: ['codex-a'], enabled: ['codex-a', 'ext-a'] });
    expect(ctl(r)).toEqual([DIS('ext-a'), EN('codex-a')]);
    expect(r.links).toEqual([T('codex-a')]);
    expect(r.degraded).toEqual([]);
    expect(r.stdout).toMatch(/; withdrawn from ext-a$/m);
  });

  it('the last codex lane gone: its timer is withdrawn, nothing is enabled, and the line says so', () => {
    const r = runUsageStep({ lanes: [], enabled: ['codex-a'] });
    expect(ctl(r)).toEqual([DIS('codex-a')]);
    expect(r.links).toEqual([]);
    expect(r.stdout).toBe('install: codex-usage: enabled for no lane; withheld from no lane; withdrawn from codex-a\n');
  });

  it('ANOTHER repository\'s timer enabled for a codex lane: ccrc\'s is withheld and withdrawn, the step degrades, and the foreign unit is never named to the manager (R6)', () => {
    const r = runUsageStep({ lanes: ['codex-a', 'codex-b'], enabled: ['codex-a'], foreign: ['codex-a'] });
    expect(ctl(r)).toEqual([DIS('codex-a'), EN('codex-b')]);
    expect(ctl(r).join('\n'), 'the converge asked the manager about another repository\'s unit').not.toContain('ccgpt-usage');
    expect(r.links, 'the foreign link was touched, or ccrc\'s was left beside it')
      .toEqual(['ccgpt-usage@codex-a.timer', T('codex-b')]);
    expect(r.degraded).toEqual(['codex-usage']);
    expect(r.stdout).toMatch(/^install: codex-usage: NOT ENABLED for codex-a — another repository's ccgpt-usage@codex-a\.timer is enabled on this box, and two publishers would race this lane's ~\/\.cc-limits row\. ccrc never disables another tool's unit: once this lane's cutover retires it, run: systemctl --user disable --now ccgpt-usage@codex-a\.timer — then re-run: ccrc install$/m);
    expect(r.stdout).toMatch(/^install: codex-usage: enabled for codex-b; withheld from codex-a; withdrawn from no lane$/m);
  });

  it('another repository\'s FLAT timer names no lane: said once, unattributed, and it blocks nothing', () => {
    const r = runUsageStep({ lanes: ['codex-a'], flatForeign: true });
    expect(ctl(r)).toEqual([EN('codex-a')]);
    expect(r.degraded).toEqual([]);
    expect(r.stdout).toMatch(/^install: codex-usage: note — another repository's ccgpt-usage\.timer is enabled on this box\. It names no lane, so ccrc cannot tell which lane's ~\/\.cc-limits row it writes; if it is one of codex-a, two publishers race that row\. ccrc leaves it alone; once no lane on this box relies on it, run: systemctl --user disable --now ccgpt-usage\.timer$/m);
    expect(r.links).toContain('ccgpt-usage.timer');
  });

  it('on a box with no codex lane the foreign timers are not the converge\'s business at all — the live fleet box\'s shape after this merge', () => {
    const r = runUsageStep({ lanes: [], foreign: ['ext-b'], flatForeign: true });
    expect(r.stdout).toBe('install: codex-usage: none — no codex lane in the roster\n');
    expect(ctl(r)).toEqual([]);
    expect(r.links).toEqual(['ccgpt-usage.timer', 'ccgpt-usage@ext-b.timer']);
    expect(r.degraded).toEqual([]);
  });

  it('an unreadable roster is never "no codex lane": NOT CONVERGED, degraded, and a ccrc timer already on is NOT withdrawn', () => {
    const r = runUsageStep({ lanesRc: 1, enabled: ['codex-a'] });
    expect(ctl(r)).toEqual([]);
    expect(r.links).toEqual([T('codex-a')]);
    expect(r.degraded).toEqual(['codex-usage']);
    expect(r.stdout).toMatch(/^install: codex-usage: NOT CONVERGED — \$HOME\/\.ccrc\/accounts\.json could not be read as a roster/m);
  });

  it('no jq (rc 2): the same refusal to act, in its own sentence', () => {
    const r = runUsageStep({ lanesRc: 2, enabled: ['codex-a'] });
    expect(ctl(r)).toEqual([]);
    expect(r.links).toEqual([T('codex-a')]);
    expect(r.degraded).toEqual(['codex-usage']);
    expect(r.stdout).toMatch(/^install: codex-usage: NOT CONVERGED — jq is not on PATH/m);
  });

  it('an enable systemd refuses: the helper\'s line on stderr, and the degraded step is that unit', () => {
    const r = runUsageStep({ lanes: ['codex-a', 'codex-b'], refuse: [T('codex-b')] });
    expect(ctl(r)).toEqual([EN('codex-a'), EN('codex-b')]);
    expect(r.degraded).toEqual([T('codex-b')]);
    expect(r.stderr).toMatch(new RegExp(`^install: codex-usage: could not enable ${esc(T('codex-b'))} — run: systemctl --user enable --now ${esc(T('codex-b'))}$`, 'm'));
    expect(r.stdout).toMatch(/^install: codex-usage: enabled for codex-a; withheld from no lane; withdrawn from no lane$/m);
  });

  it('a withdrawal systemd refuses: its own line, degraded, and the timer is still there to name', () => {
    const r = runUsageStep({ lanes: [], enabled: ['ext-a'], refuse: [T('ext-a')] });
    expect(r.degraded).toEqual(['codex-usage']);
    expect(r.stderr).toMatch(/^install: codex-usage: could not disable ccrc-codex-usage@ext-a\.timer — account ext-a is no longer a codex lane, so its timer must not poll; run: systemctl --user disable --now ccrc-codex-usage@ext-a\.timer$/m);
    expect(r.links).toEqual([T('ext-a')]);
  });

  it('forced Darwin: one not-applicable line naming the lanes, the manager never asked, and NOT a degraded step (R2)', () => {
    const r = runUsageStep({ os: 'darwin', lanes: ['codex-a', 'codex-b'], enabled: ['ext-a'] });
    expect(r.stdout).toBe('install: codex-usage: not applicable on macOS — ccrc places no launchd job for a codex lane\'s usage poller (decision 17: macOS is not centrally managed), so this box publishes no ~/.cc-limits row for: codex-a, codex-b\n');
    expect(ctl(r)).toEqual([]);
    expect(r.degraded).toEqual([]);
  });

  it('forced Darwin with no codex lane: silent', () => {
    const r = runUsageStep({ os: 'darwin', lanes: [] });
    expect(r.stdout).toBe('');
    expect(ctl(r)).toEqual([]);
  });
});
```

1h. **The converge on a real spine.** Insert this after the `describeLinux('ccrc install: the codex tier restart step on a real spine (Plan 2b-2 Task 10)', …)` block:

```ts
describeLinux('ccrc install: the codex usage converge on a real spine (Plan 3a Task 6)', () => {
  it('one usage timer per codex lane and none for an external lane; a re-run arms the same one again and nothing else', async () => {
    const lanes = await freeLanes(['codex-a']);
    const home = codexBox('ccrc-codex-usage-spine-', lanes);
    // `ext-a`: the live lanes' shape (exec.kind external, telemetry codex), a fixture id.
    codexRoster(home, lanes, [{ id: 'ext-a', label: 'ext-a', configDirSuffix: '.claude-ext-a',
      exec: { kind: 'external', provider: 'openai' }, homeAble: false, telemetry: 'codex' }]);
    const usage = (): string[] => systemctlCalls(home).map((c) => c.argv).filter((a) => a.includes('usage@'));
    const r = runInstall(home);
    expect(existsSync(dotCcrc(home, 'installed')), `${r.stdout}\n${r.stderr}`).toBe(true);
    expect(usage()).toEqual(['--user enable --now ccrc-codex-usage@codex-a.timer']);
    expect(lstatSync(unitDir(home, 'timers.target.wants', 'ccrc-codex-usage@codex-a.timer')).isSymbolicLink()).toBe(true);
    expect(r.stdout).toMatch(/^install: codex-usage: enabled for codex-a; withheld from no lane; withdrawn from no lane$/m);
    expect(r.code).toBe(doctorCode(home));
    runInstall(home);
    expect(usage(), 'a re-run did more than re-arm the same timer').toEqual([
      '--user enable --now ccrc-codex-usage@codex-a.timer', '--user enable --now ccrc-codex-usage@codex-a.timer']);
  }, 60_000);
});
```

1i. **Every timer degrade is counted, on a real spine.** Add this describe beside the one above:

```ts
describeLinux('ccrc install: a timer systemd refuses is a COUNTED degraded step (Plan 3a Task 6; 2b-2 carry-forward 10)', () => {
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /** The names the closing line gives, split on the `,` cmd_install joins with. */
  const degradedNamed = (stdout: string): string[] => {
    const m = /^install: done — converged with \d+ degraded steps? \(([^)]*)\)$/m.exec(stdout);
    return m === null ? [] : m[1]!.split(',').map((s) => s.trim()).filter(Boolean);
  };

  it('every timer enable systemd refuses is NAMED in the closing line — derived from what the run asked, nine across both and fleet', () => {
    // Until Plan 3a nine refusals printed a remedy and appended nothing, so
    // the closing line said "every step above converged" over a timer that
    // never armed. The expected set is what THIS run asked systemd to enable,
    // never a list typed here, so a tenth timer is measured the day it lands.
    const seen = new Set<string>();
    for (const role of ['both', 'fleet'] as const) {
      const home = freshBox(`ccrc-install-timer-degrades-${role}-`);
      mkdirSync(join(home, '.ccrc'), { recursive: true });
      writeFileSync(join(home, '.ccrc', 'agent.env'),
        'CCRC_SERVER_URL=http://127.0.0.1:7788\nCCRC_AGENT_TOKEN=fixture-not-a-real-token\n');
      writeFileSync(join(home, 'fixture-enable-fail-timers'), '');
      const r = runInstall(home, ['install', '--role', role]);
      expect(r.code, `--role ${role}: a refused timer failed the install\n${r.stderr}`).toBe(0);
      const asked = [...new Set(systemctlCalls(home)
        .map((c) => /^--user enable --now (\S+\.timer)$/.exec(c.argv)?.[1])
        .filter((u): u is string => u !== undefined && u !== 'ccd-cap-scopes.timer'))].sort();
      expect(asked.length, `--role ${role}: the run asked for too few timer enables — this harness has gone stale`)
        .toBeGreaterThanOrEqual(7);
      expect(degradedNamed(r.stdout).filter((n) => n.endsWith('.timer')).sort(),
        `--role ${role}: the closing line does not name every timer systemd refused`).toEqual(asked);
      for (const u of asked) {
        expect(r.stderr, `--role ${role}: ${u}'s refusal carries no remedy line`)
          .toMatch(new RegExp(`^install: [a-z-]+: could not enable ${esc(u)} — run: systemctl --user enable --now ${esc(u)}$`, 'm'));
        seen.add(u);
      }
    }
    expect(seen.size, 'both roles together reach fewer degrading timer enables than the nine measured on main at 1f9fa22d')
      .toBeGreaterThanOrEqual(9);
  }, 60_000);

  it('every timer `_inst_enable` arms after ccd-cap-scopes goes through `_inst_enable_timer`, which counts its refusal', () => {
    const body = ccrcFunction('_inst_enable');
    const via = [...body.matchAll(/^ {2}\[ "\$INST_ROLE" !?= [a-z]+ \] \|\| _inst_enable_timer [a-z-]+ \S+\.timer$/gm)];
    expect(via.length, 'fewer helper-routed timer enables than the nine on main — the reader has gone stale, or a timer left the helper')
      .toBeGreaterThanOrEqual(9);
    const code = body.split('\n').filter((l) => !/^\s*#/.test(l));
    expect(code.filter((l) => /could not enable/.test(l)),
      'a timer in _inst_enable still degrades through its own echo, outside the helper that counts it').toEqual([]);
    expect(code.filter((l) => /systemctl --user enable --now [A-Za-z0-9@._-]+\.timer/.test(l)),
      'a literal timer enable in _inst_enable bypasses _inst_enable_timer').toEqual([]);
    expect(ccrcFunction('_inst_enable_timer'), 'the helper no longer counts the step it degrades')
      .toMatch(/^ {2}INST_DEGRADED\+=\("\$2"\)$/m);
  });
});
```

1j. **The watchdog-degrade case** (grep for `a systemd that will not take the watchdog timer DEGRADES the install`). Append one assertion after its `expect(r.stderr).toMatch(…)`:

```ts
    expect(r.stdout, 'the closing line claims a convergence the watchdog timer never had')
      .toMatch(/^install: done — converged with \d+ degraded steps? \([^)]*\bccrc-update-watchdog\.timer\b[^)]*\)$/m);
```

- [ ] **Step 2: Write the failing tests in `server/test/install-census.test.ts`.**

2a. **`DEPLOY_SH_WITHHOLDS`.** Replace its `units:` line with:

```ts
    units: ['ccd-update-sync.service', 'ccd-update-sync.timer', 'ccrc-update-watchdog.service', 'ccrc-update-watchdog.timer',
      // Plan 3a: Task 6 places ccrc's usage pair ONE COMMIT before Task 7
      // teaches deploy.sh's agent lane the same two lines. Withheld for exactly
      // that commit. Task 7 deletes this entry, and direction 2 below reds if
      // it does not.
      'ccrc-codex-usage@.service', 'ccrc-codex-usage@.timer'],
```

2b. **The deploy-enable case.** In its first comment, change `so this binds \`claude-session@\` and\n    // \`ccgpt-usage@\` alike, and any template added later.` to `so this binds \`claude-session@\` and\n    // \`ccrc-codex-usage@\` alike, and any template added later — plus one family named below.`. Replace the five-line comment that begins `    // ...and every template unit file this repository SHIPS, placed or not` with:

```ts
    // ...and every template unit file this repository SHIPS, placed or not
    // (`git ls-files`, by basename). PLUS ONE family no file here names any
    // more: `ccgpt-usage@`, another repository's template on a live fleet box
    // (FOREIGN_LIVE_BOX_UNIT_PREFIX, below). Until Plan 3a this repository
    // shipped a pair under that name, so the derivation caught it. The rename
    // to `ccrc-codex-usage@` (D-3717)
    // would have dropped it silently, and a deploy that armed one of ITS
    // instances would arm another tool's publisher.
```

Then change `const families = [...new Set(templates.map((t) => t.slice(0, t.indexOf('@') + 1)))];` to:

```ts
    const families = [...new Set([...templates.map((t) => t.slice(0, t.indexOf('@') + 1)), FOREIGN_LIVE_BOX_UNIT_PREFIX])];
```

2c. **The own-name pin.** Add this `it` at the end of `describe('neither installer ever writes a name another repository owns on the live fleet box (D-3478, D-3172)', …)`:

```ts
  it('ccrc\'s usage pair is placed under its OWN name, and nothing else of a usage family is (Plan 3a Task 6)', () => {
    // The rename is what keeps the guard above green. A usage template placed
    // under any other spelling, or a second one, is a decision to record here.
    const usage = [...placedUnits()].filter((u) => isTemplate(u) && /usage@/.test(u)).sort();
    expect(usage, 'the usage template _inst_units places is not ccrc\'s own pair')
      .toEqual(['ccrc-codex-usage@.service', 'ccrc-codex-usage@.timer']);
    expect(usage.filter((u) => u.startsWith(FOREIGN_LIVE_BOX_UNIT_PREFIX))).toEqual([]);
  });
```

2d. **The release anchor.** In the release describe, insert this after the `gated` loop:

```ts
    // Plan 3a Task 6: every TEMPLATE `_inst_units` places is copied out of a
    // source this census read, so the tarball carries it. Derived from the
    // placement, never typed: ccrc's usage pair today.
    for (const t of [...placedUnits()].filter(isTemplate)) {
      expect([...sources].some((s) => path.posix.basename(s) === t),
        `${t} is placed by _inst_units and no tree source the release census read is that file`).toBe(true);
    }
```

- [ ] **Step 3: Write the fixture helpers and the failing doctor tests.**

3a. **`server/test/codexLaneFixture.ts`.** Append these after `laneUnits`:

```ts
// ── Plan 3a Task 6: a codex lane's usage pair, as `ccrc install` leaves it ─

/** The usage pair as a converged Linux box has it:
 *  - ccrc's template pair, COPIED from `deploy/systemd/` into the unit directory;
 *  - the lane's instance ENABLED, through the `timers.target.wants` link that
 *    `systemctl enable` makes, which is what the converge and doctor read;
 *  - a usage row `ageS` seconds old, in the publisher's own shape
 *    (`fiveResetAt`/`sevenResetAt` present, null included).
 *  `pair: false` plants no template, `enabled: false` no link and `row: false`
 *  no row. `linkAgeS` backdates the link's OWN mtime, which is the moment the
 *  timer was enabled. */
export function plantCodexUsage(home: string, id: string, o: {
  pair?: boolean; enabled?: boolean; row?: boolean; ageS?: number; linkAgeS?: number;
} = {}): { unitDir: string; link: string; row: string } {
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(id)) throw new Error(`plantCodexUsage: unsafe id ${JSON.stringify(id)}`);
  const unitDir = join(home, '.config', 'systemd', 'user');
  const wants = join(unitDir, 'timers.target.wants');
  fs.mkdirSync(wants, { recursive: true });
  if (o.pair !== false) {
    for (const f of ['ccrc-codex-usage@.service', 'ccrc-codex-usage@.timer']) {
      fs.copyFileSync(join(REPO, 'deploy', 'systemd', f), join(unitDir, f));
    }
  }
  const link = join(wants, `ccrc-codex-usage@${id}.timer`);
  if (o.enabled !== false) {
    fs.symlinkSync(join(unitDir, 'ccrc-codex-usage@.timer'), link);
    if (o.linkAgeS !== undefined) {
      const t = Date.now() / 1000 - o.linkAgeS;
      fs.lutimesSync(link, t, t);
    }
  }
  const row = join(home, '.cc-limits', `${id}.json`);
  if (o.row !== false) {
    fs.mkdirSync(path.dirname(row), { recursive: true });
    fs.writeFileSync(row, JSON.stringify({
      five: null, seven: 12, ts: Math.floor(Date.now() / 1000) - (o.ageS ?? 60), fiveResetAt: null, sevenResetAt: null,
    }));
  }
  return { unitDir, link, row };
}

/** ANOTHER repository's usage timer, ENABLED: its wants link, and nothing
 *  else. ccrc never reads the foreign unit file, so none is planted, and the
 *  link's target is deliberately absent. `id` null plants the flat, id-less
 *  `ccgpt-usage.timer`. */
export function plantForeignUsage(home: string, id: string | null): string {
  const unitDir = join(home, '.config', 'systemd', 'user');
  const wants = join(unitDir, 'timers.target.wants');
  fs.mkdirSync(wants, { recursive: true });
  const link = join(wants, id === null ? 'ccgpt-usage.timer' : `ccgpt-usage@${id}.timer`);
  fs.symlinkSync(join(unitDir, id === null ? 'ccgpt-usage.timer' : 'ccgpt-usage@.timer'), link);
  return link;
}
```

3b. **`server/test/ccrc-doctor.test.ts`, Task 4's fixture.** In `healthyCodexBox` (locate it by the grep in Step 0), insert `plantCodexUsage(home, id);` inside its per-lane `for (const { id } of lanes)` loop, directly after `renderLane(home, id);`. Every Task 4/5 case that expects `PASS codex` keeps it, and Step 7 records that count before and after.

One exact PASS pin now carries this task's usage words: Task 4's `'PASSes a healthy lane and names its ports, its state and the runtime — never the bare word ok'`, as Task 5 rewrote it. The row age in those words moves, so the pin becomes a pattern. Replace its

```ts
    expect(codexVerdicts(r.stdout), r.stdout).toEqual([
      `PASS codex: 1 Codex lane(s): codex-a (ports ${proxyPort}/${litellmPort}, signed in, lane.json current, `
      + `LiteLLM config current; tiers: none running (a lane is lazy)); runtime ${currentGen(home)} litellm=1.101.0; `
      + 'the four GPT-lane executables match the shipped tree',
    ]);
```

with

```ts
    // Plan 3a Task 6: each lane's words end with its usage rows. On Linux they
    // are the timer enabled and the row's age, which moves, so this is a
    // pattern; on macOS they are the two stated not-applicables.
    const rx = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const usage = IS_DARWIN ? rx('; usage timer not applicable on macOS') : '; ccrc-codex-usage@codex-a\\.timer enabled; usage row \\d+s old';
    const box = IS_DARWIN ? rx('; usage publishing not applicable on macOS — ccrc places no launchd job for it (decision 17)') : '';
    expect(codexVerdicts(r.stdout), r.stdout).toEqual([expect.stringMatching(new RegExp(
      `^${rx(`PASS codex: 1 Codex lane(s): codex-a (ports ${proxyPort}/${litellmPort}, signed in, lane.json current, LiteLLM config current; tiers: none running (a lane is lazy)`)}`
      + `${usage}${rx(`); runtime ${currentGen(home)} litellm=1.101.0; the four GPT-lane executables match the shipped tree`)}${box}$`))]);
```

3c. **`server/test/ccrc-doctor.test.ts`, the two new describes.** Append them after Task 4's and Task 5's `_check_codex` describes:

```ts
// ── Plan 3a Task 6: `_check_codex`'s usage rows, measured in isolation ────
/** ccd/ccrc and this check file SOURCED into one shell. ccrc's dispatch is
 *  guarded by `BASH_SOURCE[0] == $0`, so sourcing runs nothing. The shell
 *  runs under this file's contained PATH, in a fixture HOME. `darwin` sets
 *  OSTYPE, from which ccrc recomputes CCD_OS at source time. A recording
 *  `systemctl` stub is planted, so a row that asked the manager anything is
 *  caught: these rows read the manager's own links and must never ask it. */
function usageRows(home: string, darwin = false, script?: string): Result & { asked: string[] } {
  stub(home, 'systemctl', 'printf \'%s\\n\' "$*" >> "$HOME/usage-rows-systemctl"; exit 97');
  // The rows RECORD through `_check_codex`'s `_dr_cx_warn` (Task 4). A bare
  // shell gives them the three arrays, and `_dr_cx_report` prints what they recorded.
  const body = script ?? [
    'DRX_CLASS=(); DRX_WHAT=(); DRX_FIX=()',
    '_dr_codex_usage_box; b=$?',
    '_dr_codex_usage codex-a; l=$?',
    'printf "rc=%s,%s\\npair=%s\\nbox-note=%s\\nnote=%s\\n" "$b" "$l" "${DR_CODEX_USAGE_PAIR:-}" "$DR_CODEX_USAGE_BOX_NOTE" "$DR_CODEX_USAGE_NOTE"',
    '_dr_cx_report "usage rows measured"; :',
  ].join('\n');
  // BOUNDED BY THE PROCESS GROUP (Plan 3a ruling F8), as `runDoctorBounded`
  // above is: `spawnSync`'s own `timeout` signals only `bash`, and a `jq`
  // blocked on a FIFO inside a `$(…)` (Step 8's W6 mutation) would outlive the
  // run. GNU `timeout -k` signals the whole group, so no reader survives the
  // census. With no usable deadline binary only the FIFO case can block, and
  // that case is skipped.
  const src = `set -uo pipefail\n. ${shq(CCRC_SRC)}\n. ${shq(CHECKS_SRC)}\n${body}`;
  const env = { ...doctorEnv(home), ...(darwin ? { OSTYPE: 'darwin23' } : {}) };
  const r = DOCTOR_DEADLINE_BIN === null
    ? spawnSync(BASH, ['-c', src], { env, encoding: 'utf8', timeout: 20_000 })
    : spawnSync(DOCTOR_DEADLINE_BIN, ['-k', '1', '20', BASH, '-c', src], { env, encoding: 'utf8' });
  const f = join(home, 'usage-rows-systemctl');
  return {
    code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '',
    asked: existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean) : [],
  };
}

/** A fixture HOME in the shape these rows read:
 *  - the codex lane rostered, with pure-parse ports (nothing here opens a socket);
 *  - its registry and catalogue in fixture model ids (`probe-model` is the
 *    haiku class, `gpt-x` the sonnet class);
 *  - the usage pair as `ccrc install` leaves it.
 *  Each case breaks exactly one thing. */
function usageBox(prefix: string, o: Parameters<typeof plantCodexUsage>[2] & {
  haiku?: string | null; catalogue?: 'live' | 'retired' | 'stale' | 'none';
} = {}): string {
  const home = mkTmp(prefix);
  containedPath(home);
  stubNode(home, 'v22.20.0');
  for (const b of ['jq', 'date', 'stat']) linkReal(home, b);
  codexRoster(home, [{ id: 'codex-a', proxyPort: 45010, litellmPort: 45011 }]);
  const models = join(home, '.ccrc', 'models');
  mkdirSync(models, { recursive: true });
  writeFileSync(join(models, 'codex-a.classes.json'), JSON.stringify({
    probe: 'codex', classes: { haiku: o.haiku === undefined ? 'probe-model' : o.haiku, sonnet: 'gpt-x', opus: null, fable: null },
    subagent: 'sonnet', discovery: 'catalogue',
  }));
  const cat = o.catalogue ?? 'live';
  if (cat !== 'none') {
    writeFileSync(join(models, 'codex-a.json'), JSON.stringify({
      probe: 'codex', fetchedAt: Math.floor(Date.now() / 1000), stale: cat === 'stale',
      models: (cat === 'retired' ? ['gpt-x'] : ['gpt-x', 'probe-model']).map((id) => ({ id })),
    }));
  }
  plantCodexUsage(home, 'codex-a', o);
  return home;
}

// LINUX ONLY: on a macOS host bash's own OSTYPE is darwin*, so ccrc computes
// CCD_OS=darwin at source time and every row below would answer
// not-applicable. The forced-Darwin, unloaded and threshold cases need no
// host, and sit in the describe after this one.
describeLinux('ccrc doctor: codex — the usage rows, measured in isolation (Plan 3a Task 6)', () => {
  const T = 'ccrc-codex-usage@codex-a.timer';
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const warns = (out: string): string[] => out.split('\n').filter((l) => l.startsWith('WARN codex: '));

  it('placed, enabled and fresh: no WARN, a note naming what was measured, and the manager never asked', () => {
    const r = usageRows(usageBox('ccrc-doctor-usage-healthy-'));
    expect(r.code, r.stderr).toBe(0);
    expect(warns(r.stdout), r.stdout).toEqual([]);
    expect(r.stdout).toMatch(/^rc=0,0$/m);
    expect(r.stdout).toMatch(new RegExp(`^note=${esc(T)} enabled; usage row \\d+s old$`, 'm'));
    expect(r.asked, 'a usage row asked the user manager').toEqual([]);
  });

  it('the pair not installed: ONE box-level WARN naming ccrc install, and no per-lane "not enabled" echo of it', () => {
    const r = usageRows(usageBox('ccrc-doctor-usage-nopair-', { pair: false, enabled: false }));
    expect(warns(r.stdout)).toEqual([expect.stringMatching(/^WARN codex: ccrc's usage unit pair is not installed \(ccrc-codex-usage@\.service ccrc-codex-usage@\.timer absent from .*\), so no codex lane on this box publishes its ~\/\.cc-limits row$/)]);
    expect(r.stdout).toMatch(/^ {2}remedy: ccrc install — it places the pair and enables one usage timer per codex lane$/m);
    expect(r.stdout).toMatch(/^rc=2,0$/m);
    expect(r.stdout).toMatch(/^pair=missing$/m);
  });

  it('the lane\'s timer not enabled: WARN, remedy ccrc install (D-3721)', () => {
    const r = usageRows(usageBox('ccrc-doctor-usage-disabled-', { enabled: false }));
    expect(warns(r.stdout)).toEqual([`WARN codex: codex-a: ${T} is not enabled, so this lane's ~/.cc-limits usage row is never refreshed`]);
    expect(r.stdout).toMatch(/^ {2}remedy: ccrc install — its converge enables one usage timer per codex lane$/m);
    expect(r.stdout).toMatch(/^rc=0,2$/m);
  });

  it('ANOTHER repository\'s timer enabled for the same lane: one WARN naming it, remedy the operator\'s own disable, and a stale row is not judged — ccrc is not its writer (R6)', () => {
    const home = usageBox('ccrc-doctor-usage-second-writer-', { ageS: 99_999 });
    plantForeignUsage(home, 'codex-a');
    const r = usageRows(home);
    expect(warns(r.stdout)).toEqual([expect.stringMatching(/^WARN codex: codex-a: another repository's ccgpt-usage@codex-a\.timer is enabled, so two publishers would race this lane's ~\/\.cc-limits row and two token refreshes its OAuth directory — ccrc withholds its own ccrc-codex-usage@codex-a\.timer while it stands$/)]);
    expect(r.stdout).toMatch(/^ {2}remedy: once this lane's cutover no longer needs it, disable it yourself: systemctl --user disable --now ccgpt-usage@codex-a\.timer, then run: ccrc install — ccrc never disables another tool's unit$/m);
    expect(r.asked).toEqual([]);
  });

  it('another repository\'s FLAT timer: a box-level WARN that it cannot be attributed, never a lane\'s', () => {
    const home = usageBox('ccrc-doctor-usage-flat-');
    plantForeignUsage(home, null);
    const r = usageRows(home);
    expect(warns(r.stdout)).toEqual([expect.stringMatching(/^WARN codex: another repository's ccgpt-usage\.timer is enabled on this box; it names no lane, so ccrc cannot tell whether it is a second publisher of a codex lane's ~\/\.cc-limits row$/)]);
    expect(r.stdout).toMatch(/^rc=2,0$/m);
  });

  it('a row older than three polls: WARN naming its age and the publisher\'s log', () => {
    const r = usageRows(usageBox('ccrc-doctor-usage-stale-', { ageS: 2701 }));
    expect(warns(r.stdout)).toEqual([expect.stringMatching(/^WARN codex: codex-a: its usage row was last written 45 min ago — more than three of ccrc-codex-usage@codex-a\.timer's polls$/)]);
    expect(r.stdout).toMatch(/^ {2}remedy: read what the publisher says: journalctl --user -u ccrc-codex-usage@codex-a\.service -n 50$/m);
  });

  it('no row yet, the timer enabled moments ago: no WARN, and the note says why', () => {
    const r = usageRows(usageBox('ccrc-doctor-usage-norow-fresh-', { row: false }));
    expect(warns(r.stdout)).toEqual([]);
    expect(r.stdout).toMatch(/^note=.*no usage row yet \(enabled \d+s ago; the first poll runs five minutes after enable\)/m);
  });

  it('no row, and the timer enabled longer than three polls ago: WARN — this lane has never published', () => {
    const r = usageRows(usageBox('ccrc-doctor-usage-norow-old-', { row: false, linkAgeS: 2701 }));
    expect(warns(r.stdout)).toEqual([expect.stringMatching(/^WARN codex: codex-a: ccrc-codex-usage@codex-a\.timer has been enabled for longer than 45 min and this lane has never published a usage row \(.*\/\.cc-limits\/codex-a\.json\)$/)]);
  });

  // Under W6's mutation the row's `jq` blocks on this FIFO, and `usageRows`'
  // process-group bound ends it, exit 124, with no reader left behind (F8).
  it.skipIf(DOCTOR_DEADLINE_BIN === null)('a FIFO at the row\'s path is a WARN, never a hang', () => {
    const home = usageBox('ccrc-doctor-usage-fifo-', { row: false });
    mkdirSync(join(home, '.cc-limits'), { recursive: true });
    expect(spawnSync('mkfifo', [join(home, '.cc-limits', 'codex-a.json')]).status).toBe(0);
    const r = usageRows(home);
    expect(r.code, 'the rows blocked on a FIFO (exit 124: ended at the 20 s process-group bound)').toBe(0);
    expect(warns(r.stdout)).toEqual([expect.stringMatching(/^WARN codex: codex-a: .*\/\.cc-limits\/codex-a\.json is not a regular file, so this lane's usage row cannot be read$/)]);
  }, 40_000);

  it('a row with no numeric ts: WARN, its age unmeasured', () => {
    const home = usageBox('ccrc-doctor-usage-nots-', { row: false });
    mkdirSync(join(home, '.cc-limits'), { recursive: true });
    writeFileSync(join(home, '.cc-limits', 'codex-a.json'), '{"five":null,"seven":12}');
    const r = usageRows(home);
    expect(warns(r.stdout)).toEqual([expect.stringMatching(/^WARN codex: codex-a: .*codex-a\.json carries no numeric ts, so its age cannot be measured$/)]);
  });

  itCodex('wired into _check_codex on a doctor-clean codex box: a second writer turns its PASS into a WARN on the check\'s own name', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-usage-e2e-');   // Task 4's fixture, extended by Step 3b
    expect(lineFor(runDoctor(home).stdout, 'codex'), 'the doctor-clean codex box no longer PASSes codex')
      .toMatch(/^PASS codex: .*ccrc-codex-usage@codex-a\.timer enabled/);
    plantForeignUsage(home, 'codex-a');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^WARN codex: codex-a: another repository's ccgpt-usage@codex-a\.timer is enabled/m);
    expect(r.stdout).not.toMatch(/^PASS codex: /m);
  });
});

// The rows that need no host: forced Darwin (OSTYPE is set, so ccrc computes
// CCD_OS=darwin on any host), the unloaded reader, and the threshold pin.
describe('ccrc doctor: codex — the usage rows, on any host (Plan 3a Task 6)', () => {
  const warns = (out: string): string[] => out.split('\n').filter((l) => l.startsWith('WARN codex: '));

  it('forced Darwin: every row not applicable — no WARN with nothing planted, and the notes say why (R2)', () => {
    const r = usageRows(usageBox('ccrc-doctor-usage-darwin-', { pair: false, enabled: false, row: false }), true);
    expect(warns(r.stdout), r.stdout).toEqual([]);
    expect(r.stdout).toMatch(/^rc=0,0$/m);
    expect(r.stdout).toMatch(/^box-note=usage publishing not applicable on macOS — ccrc places no launchd job for it \(decision 17\)$/m);
    expect(r.stdout).toMatch(/^note=usage timer not applicable on macOS$/m);
  });

  it('sourced without ccrc, the rows FAIL naming the bug, rather than reading a function that does not exist', () => {
    const home = usageBox('ccrc-doctor-usage-unloaded-');
    const r = spawnSync(BASH, ['-c', `set -uo pipefail\n. ${shq(CHECKS_SRC)}\n_dr_codex_usage_box; echo "rc=$?"`],
      { env: doctorEnv(home), encoding: 'utf8' });
    expect(r.stdout).toMatch(/^FAIL codex: ccrc's own usage-timer reader is not loaded/m);
    expect(r.stdout).toMatch(/^rc=1$/m);
  });

  it('the staleness threshold covers three of the shipped timer\'s cycles', () => {
    const r = spawnSync(BASH, ['-c', `. ${shq(CHECKS_SRC)}; printf '%s' "$_DR_CODEX_USAGE_STALE_S"`], { encoding: 'utf8' });
    const m = /^OnUnitActiveSec=(\d+)min$/m.exec(readFileSync(join(REPO, 'deploy', 'systemd', 'ccrc-codex-usage@.timer'), 'utf8'));
    expect(m, 'the usage timer\'s cadence is not spelled in minutes — this pin has gone stale').not.toBeNull();
    expect(Number(r.stdout), 'a row one missed poll old would read as stale').toBeGreaterThanOrEqual(3 * Number(m![1]) * 60);
  });
});
```

- [ ] **Step 4: Plant the containment arm in the two other spine harnesses.**
- In `server/test/ccrc-update.test.ts`'s `plant('systemctl', [...])`, directly after its `'  enable) [ "$2" = "--now" ] && [ -n "$3" ] || { …; exit 90; }; exit 0 ;;',` line, add:

```ts
    // Plan 3a Task 6: the usage converge (`_inst_enable`) may withdraw a ccrc
    // usage timer; recorded and answered here, never a real manager.
    '  disable) [ "$2" = "--now" ] && [ -n "$3" ] || { echo "fixture systemctl: unexpected argv: $*" >&2; exit 90; }; exit 0 ;;',
```

- In `server/test/ccrc-install-graphify.test.ts`'s `plant('systemctl', [...])`, add the same `disable)` line directly after its `enable)` arm's closing `'    exit 0 ;;',`.

- [ ] **Step 5: Run the tests and watch them fail.** Each line is its own foreground Bash call from the tree root, with a timeout of at least 600000 ms (F6), and sources the env file itself (F2):

```bash
. "<abs scratch>/plan3a-env.sh"; cd server && "$CENSUS" "$SCRATCH/t6-ev/red-install" ./node_modules/.bin/vitest run test/ccrc-install.test.ts
. "<abs scratch>/plan3a-env.sh"; cd server && "$CENSUS" "$SCRATCH/t6-ev/red-census" ./node_modules/.bin/vitest run test/install-census.test.ts
. "<abs scratch>/plan3a-env.sh"; cd server && "$CENSUS" "$SCRATCH/t6-ev/red-doctor-<k>" ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t <P>   # three calls, k = 1, 2, 3: the Global Constraints' parts
. "<abs scratch>/plan3a-env.sh"; cd server && "$CENSUS" "$SCRATCH/t6-ev/red-tc" ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
```

Expected results:
- **`ccrc-install.test.ts` reds:**
  - the byte-for-byte unit case (ENOENT on `ccrc-codex-usage@.service` in the placed tree);
  - the rewritten `places ccrc's OWN usage pair` case;
  - the survival case (ccrc's pair was not placed);
  - the unit pin (ENOENT on the renamed file);
  - every case of the isolation describe (`ccd/ccrc has no _codex_usage_timer() { … } at column 0`, thrown by `ccrcFunction`);
  - the real-spine case;
  - the nine-degrade case (the closing line names nothing);
  - the text guard (`no _inst_enable_timer`);
  - the watchdog-degrade assertion (the closing line reads `every step above converged`).

  GREEN, and stated: the `--role server` case (its absences already hold; its red is U2 in Step 8), and every other pre-existing case.
- **`install-census.test.ts` reds:**
  - `DEPLOY_SH_WITHHOLDS` direction 1 (`these DEPLOY_SH_WITHHOLDS.units names are not in placedUnits()`, the one-commit entry before any placement);
  - the own-name pin.

  GREEN: the deploy-enable case (no enable matches either family), and the release anchor (the only placed template, `claude-session@.service`, has its source).
- **`ccrc-doctor.test.ts` reds:** every case of the two new describes (the FIFO case is skipped instead on a host with no usable `timeout`/`gtimeout`). `_dr_codex_usage_box` is not found, so no `rc=` line matches, and the e2e case finds no usage fragment in `PASS codex`.
- **`typecheck-tests.test.ts`:** green once 3a's exports exist, red on any typing slip. Record it.

Record every count, before and after.

- [ ] **Step 6: Implement.**

6a. **Rename and edit the pair.**

```bash
git mv 'deploy/systemd/ccgpt-usage@.service' 'deploy/systemd/ccrc-codex-usage@.service'
git mv 'deploy/systemd/ccgpt-usage@.timer' 'deploy/systemd/ccrc-codex-usage@.timer'
git status --short deploy/systemd   # two R lines, nothing else
```

`deploy/systemd/ccrc-codex-usage@.service`, whole file. The D-3486 paragraph is kept as it was. The `Description=` line changes. Task 1's `TimeoutStartSec=300` stays, and its comment is rewritten for the unit's new name. The closing paragraph says where the pair is placed now:

```ini
[Unit]
Description=ccrc Codex-lane usage window publisher for %i
[Service]
Type=oneshot
Environment=CCGPT_ACCOUNT_ID=%i
# D-3486, closing D-3164's half that Plan 2b-2 owns: the isolated
# runtime's own interpreter, never `env python3`. On the operator's fleet box
# `python3` imports a third-party litellm fork from user site-packages, so the
# shebang's interpreter fails SILENTLY there, and on a box without one it
# fails with ImportError. `ccgpt-runtime` owns ~/.ccrc/runtime/codex/, and
# `current` is the generation it last probed. Through `current`, not the
# resolved generation the long-running tiers use: a oneshot resolves the link
# afresh on every poll, and the builder's prune keeps current plus one previous
# generation, so a poll that overlaps a swap keeps its files. `-I`, so no
# PYTHONPATH, PYTHONHOME or user site puts another litellm in front of the
# runtime's. Never a PATH line: %h/.local/bin holds no python.
# The cost map stays local (D-3484): without it, `import litellm`
# fetches a mutable remote JSON, with retries, on every poll.
Environment=LITELLM_LOCAL_MODEL_COST_MAP=True
# A oneshot has NO start timeout by default (systemd.service(5), TimeoutStartSec=:
# "except when Type=oneshot is used, in which case the timeout is disabled"),
# and while this unit runs its timer starts no second instance — so a poll that
# hung would silence this lane's usage row for good. One poll is a token
# refresh plus one request the publisher bounds at 30 s; the device-code flow,
# the one path that waits for minutes, is refused in-process before it writes
# anything (Plan 3a Task 1). Task 1's 300 s, `ccrc-models.service`'s own
# bound, is that with room, and inside one timer cycle; on expiry systemd
# stops this cgroup and the next tick polls.
TimeoutStartSec=300
ExecStart=%h/.ccrc/runtime/codex/current/bin/python -I %h/.local/bin/ccgpt-usage.py
# ccrc's OWN name, never `ccgpt-usage@`: on a live fleet box that template is
# another repository's, with an instance enabled, and placing ours there would
# rewrite a running timer's definition on the next update
# (D-3717). `_inst_units` places this
# pair on fleet/both, Linux only; `_inst_enable`'s converge enables one instance
# per codex lane. The publisher reads ~/.ccrc/codex/%i/lane.json for everything
# else, so no path is re-derived here from a naming convention (spec §5.4).
```

In `deploy/systemd/ccrc-codex-usage@.timer`:
- `Description=periodic usage poll for ccrc GPT lane %i` becomes `Description=periodic usage poll for ccrc Codex lane %i`.
- In its comment, `` `ccgpt-usage@%i.timer` elapsing activates`` / ``# `ccgpt-usage@%i.service` `` become `` `ccrc-codex-usage@%i.timer` elapsing activates`` / ``# `ccrc-codex-usage@%i.service` ``.
- Directly above `[Install]`, add:

```ini
# `WantedBy=timers.target` is also what `enable` links into
# `timers.target.wants/`, the one place ccrc reads to know an instance is
# enabled (D-3726).
```

6b. **`ccd/ccrc`, the new block.** Insert it directly above `# ── _inst_enable — ask systemd to read them, then prove one stayed up ─────`:

```bash
# ── The Codex lanes' usage pair: ccrc's OWN template, and whose timer is on ─
# Plan 3a Task 6 (spec §10, §11; rulings R2, R6). ccrc's publisher runs as
# `ccrc-codex-usage@<id>.{service,timer}`, NEVER as `ccgpt-usage@`: on a live
# fleet box that template name is another repository's, with an instance
# enabled, and `_inst_atomic` replaces whatever sits at its destination — a
# merge placing the pair there would rewrite a running timer's definition on
# the next auto-update and point its enabled instance at a lane.json that does
# not exist (D-3717).
#
# "ENABLED" IS READ FROM THE MANAGER'S OWN LINKS, never asked
# (D-3726). Enabling a timer whose
# `[Install]` says `WantedBy=timers.target` makes exactly one symlink,
# `timers.target.wants/<unit>`, and disabling it removes that link. No systemctl
# verb lists a template's enabled INSTANCES, and a per-id `is-enabled` needs the
# user bus for a question one directory answers — including on a box whose bus
# is down, where uninstall must still find ccrc's instances. The converge,
# uninstall, account removal and doctor all read THESE helpers, so they cannot
# disagree about what "enabled" means. What this cannot see, stated rather than
# hidden: a timer STARTED but never enabled, and one enabled under another
# target.
#
# PLACED HERE, beside the first caller, and not in the lane library above
# `cmd_codex`: an insert there would move lines the compaction-card citation
# corpus cites into this file (session-hook.test.ts).
_codex_usage_timer() {   # <id> -> ccrc's usage timer for that lane
  printf 'ccrc-codex-usage@%s.timer' "$1"
}
_codex_usage_foreign() {   # <id> -> ANOTHER repository's usage timer for that lane: read, never acted on
  printf 'ccgpt-usage@%s.timer' "$1"
}
_codex_usage_wants() {   # -> the directory `systemctl --user enable` links a timer into
  printf '%s/timers.target.wants' "$BOX_UNIT_DIR"
}
_codex_usage_enabled() {   # <unit> -> rc 0 iff its wants link exists, a dangling one included
  local l
  l="$(_codex_usage_wants)/$1"
  [ -L "$l" ] || [ -e "$l" ]
}
# Every id with a ccrc usage timer enabled, one per line, in glob (lexical)
# order. The ROSTER IS NOT READ: uninstall and the converge both need the
# instances ccrc armed whatever the roster says now, and an uninstall must work
# over a roster it cannot read. A name that fails the account-id grammar is
# skipped — ccrc never enables one, so it is not ccrc's. rc 1, with
# `_codex_shape`'s own sentence, when the shape contract is missing.
_codex_usage_enabled_ids() {
  local f n
  _codex_shape || return 1
  for f in "$(_codex_usage_wants)"/ccrc-codex-usage@*.timer; do
    { [ -L "$f" ] || [ -e "$f" ]; } || continue
    n="${f##*/ccrc-codex-usage@}"; n="${n%.timer}"
    [[ "$n" =~ $WRAPPER_ID_RE ]] && printf '%s\n' "$n"
  done
  return 0
}
# Another repository's FLAT `ccgpt-usage.timer`. It names no lane — its lane is
# that repository's own shell default, which ccrc does not spell — so ccrc can
# say only THAT it is enabled, never which lane's row it writes.
_codex_usage_flat_foreign() {
  _codex_usage_enabled ccgpt-usage.timer
}

# ── _inst_codex_usage — one usage timer per codex lane, and no other ──────
# Plan 3a Task 6. CONVERGES the set of ENABLED `ccrc-codex-usage@<id>.timer`
# instances to exactly the roster's codex lanes
# (D-3718):
#   - WITHDRAW FIRST: an enabled ccrc instance whose id is no longer a codex
#     lane — a lane flipped back to external, an account removed while this
#     box had no systemctl — is disabled, so a flip-back converges on the next
#     install and is never polled again;
#   - a codex lane's instance is enabled (`enable --now`, idempotent), through
#     `_inst_enable_timer`, whose refusal is a counted degraded step;
#   - a codex lane for which ANOTHER repository's `ccgpt-usage@<id>.timer` is
#     enabled gets no ccrc instance, and one ccrc had enabled is withdrawn: two
#     publishers would race one `~/.cc-limits/<id>.json`, and two Authenticator
#     refreshes one rotating refresh token (D-3719).
#     ccrc NEVER disables the foreign timer; the line names the operator's own
#     command. The flat `ccgpt-usage.timer` names no lane, so it is reported as
#     unattributable and blocks nothing.
# An unreadable roster (`_codex_lanes` rc 1), a missing jq (rc 2) or a missing
# shape contract converges NOTHING — enables none and withdraws none — because
# a set nobody read is not an empty set. Each degrades (`codex-usage`).
# LINUX ONLY: `_inst_units_darwin` places no timer at all (decision 17), so on
# macOS a box with a codex lane is told once that its usage row is not
# published here, and that is NOT a degraded step (`_inst_linger_darwin`'s
# doctrine: a property of the platform, not an event in this run). A
# server-role box converges nothing per account (D-3111) and has no pair.
# POSITION: inside `_inst_enable`, after the daemon-reload that read the
# template `_inst_units` placed, and after `_inst_codex_runtime` made the
# runtime current that the publisher's ExecStart names.
_inst_codex_usage() {
  [ "$INST_ROLE" = server ] && return 0
  local lanes have id e u f keep before lrc=0 hrc=0
  local -a codex=() enabled=() withheld=() withdrawn=()
  lanes="$(_codex_lanes)" || lrc=$?
  if [ "$CCD_OS" = darwin ]; then
    { [ "$lrc" -eq 0 ] && [ -n "$lanes" ]; } || return 0
    echo "install: codex-usage: not applicable on macOS — ccrc places no launchd job for a codex lane's usage poller (decision 17: macOS is not centrally managed), so this box publishes no ~/.cc-limits row for: ${lanes//$'\n'/, }"
    return 0
  fi
  if [ "$lrc" -eq 2 ]; then
    echo "install: codex-usage: NOT CONVERGED — jq is not on PATH (the ccrc codex: missing-dependency line above says so), so which roster lanes are codex lanes cannot be told, and no usage timer was enabled or disabled. This install continues. Install jq, then re-run: ccrc install"
    INST_DEGRADED+=(codex-usage)
    return 0
  fi
  if [ "$lrc" -ne 0 ]; then
    echo "install: codex-usage: NOT CONVERGED — \$HOME/.ccrc/accounts.json could not be read as a roster (the ccrc codex: roster-invalid line above says why), so no usage timer was enabled or disabled. This install continues. Fix the roster (ccrc wrappers prints the validator's sentence), then re-run: ccrc install"
    INST_DEGRADED+=(codex-usage)
    return 0
  fi
  have="$(_codex_usage_enabled_ids)" || hrc=$?
  if [ "$hrc" -ne 0 ]; then
    echo "install: codex-usage: NOT CONVERGED — the wrapper shape contract could not be read (the ccrc codex: line above says so), so ccrc's own usage timers cannot be told from anything else, and none was enabled or disabled. This install continues. Re-run: ccrc install"
    INST_DEGRADED+=(codex-usage)
    return 0
  fi
  [ -z "$lanes" ] || mapfile -t codex <<< "$lanes"
  for e in $have; do
    keep=0
    for id in ${codex[@]+"${codex[@]}"}; do [ "$id" = "$e" ] && keep=1; done
    [ "$keep" -eq 1 ] && continue
    u="$(_codex_usage_timer "$e")"
    if systemctl --user disable --now "$u"; then
      withdrawn+=("$e")
    else
      echo "install: codex-usage: could not disable $u — account $e is no longer a codex lane, so its timer must not poll; run: systemctl --user disable --now $u" >&2
      INST_DEGRADED+=(codex-usage)
    fi
  done
  for id in ${codex[@]+"${codex[@]}"}; do
    u="$(_codex_usage_timer "$id")"; f="$(_codex_usage_foreign "$id")"
    if _codex_usage_enabled "$f"; then
      withheld+=("$id")
      if _codex_usage_enabled "$u"; then
        systemctl --user disable --now "$u" \
          || echo "install: codex-usage: could not disable $u — run: systemctl --user disable --now $u" >&2
      fi
      echo "install: codex-usage: NOT ENABLED for $id — another repository's $f is enabled on this box, and two publishers would race this lane's ~/.cc-limits row. ccrc never disables another tool's unit: once this lane's cutover retires it, run: systemctl --user disable --now $f — then re-run: ccrc install"
      INST_DEGRADED+=(codex-usage)
      continue
    fi
    before="${#INST_DEGRADED[@]}"
    _inst_enable_timer codex-usage "$u"
    [ "${#INST_DEGRADED[@]}" -gt "$before" ] || enabled+=("$id")
  done
  if [ "${#codex[@]}" -gt 0 ] && _codex_usage_flat_foreign; then
    echo "install: codex-usage: note — another repository's ccgpt-usage.timer is enabled on this box. It names no lane, so ccrc cannot tell which lane's ~/.cc-limits row it writes; if it is one of ${codex[*]}, two publishers race that row. ccrc leaves it alone; once no lane on this box relies on it, run: systemctl --user disable --now ccgpt-usage.timer"
  fi
  if [ "${#codex[@]}" -eq 0 ] && [ "${#withdrawn[@]}" -eq 0 ]; then
    echo "install: codex-usage: none — no codex lane in the roster"
    return 0
  fi
  echo "install: codex-usage: enabled for ${enabled[*]:-no lane}; withheld from ${withheld[*]:-no lane}; withdrawn from ${withdrawn[*]:-no lane}"
}

# ── _inst_enable_timer — enable one timer, or DEGRADE and count it ────────
# Plan 3a Task 6 (2b-2 carry-forward 10). Every timer `_inst_enable` arms below
# `ccd-cap-scopes.timer` DEGRADES rather than dies when systemd refuses it —
# the idiom each one's own comment argues — and until this helper that degrade
# was only a line on stderr: nine refusals, measured on main at 1f9fa22d,
# appended nothing to INST_DEGRADED, so the closing line read "every step above
# converged" over a timer that never armed, the state-asserted-never-measured
# defect that line's own comment names. ONE spelling of the remedy, and the
# degraded step is named by the UNIT the remedy names, which is what an
# operator greps for.
_inst_enable_timer() {   # <transcript word> <unit>
  systemctl --user enable --now "$2" && return 0
  echo "install: $1: could not enable $2 — run: systemctl --user enable --now $2" >&2
  INST_DEGRADED+=("$2")
  return 0
}
```

6c. **`_inst_units`.** Replace the six-line comment that begins `    # NOT the GPT-usage publisher's \`ccgpt-usage@.{service,timer}\` pair, which` with:

```bash
    # Plan 3a Task 6: the Codex lanes' usage pair, under ccrc's OWN name
    # (D-3717). NEVER `ccgpt-usage@`:
    # on a live fleet box that template is another repository's, with an
    # instance ENABLED, and `_inst_atomic` replaces whatever sits at its
    # destination (install-census.test.ts refuses the prefix). Role-gated for
    # its own reason: its one consumer is a codex lane, which runs through a
    # per-account launcher, and a server-role box converges nothing per account
    # (D-3111). Linux only by construction — the Darwin arm returned at the top
    # of this function, and `_inst_units_darwin` places no timer at all
    # (decision 17). The TEMPLATE lands on every fleet/both box, codex lane or
    # not: a template nobody enables runs nothing. Its instances are
    # `_inst_codex_usage`'s, one per codex lane, from `_inst_enable`.
    _inst_atomic "$tree/deploy/systemd/ccrc-codex-usage@.service" "$dir/ccrc-codex-usage@.service" 644
    _inst_atomic "$tree/deploy/systemd/ccrc-codex-usage@.timer" "$dir/ccrc-codex-usage@.timer" 644
```

6d. **`_inst_enable`.**
- Its Darwin dispatch, `  if [ "$CCD_OS" = darwin ]; then _inst_enable_darwin; return $?; fi`, becomes:

```bash
  if [ "$CCD_OS" = darwin ]; then _inst_enable_darwin || return $?; _inst_codex_usage; return 0; fi
```

- The nine two-line enables become one-line calls, mechanically, and the count is asserted in the same act:

```bash
python3 - <<'PY'
import pathlib, re
p = pathlib.Path('ccd/ccrc'); s = p.read_text()
# `!?=`: two gates read `!= fleet`, and seven a single `=` (`= server` six times, `= fleet` once).
pat = re.compile(
    r'^(  \[ "\$INST_ROLE" !?= [a-z]+ \] \|\| )systemctl --user enable --now (\S+\.timer) \\\n'
    r'    \|\| echo "install: ([a-z-]+): could not enable \2 — run: systemctl --user enable --now \2" >&2\n',
    re.M)
s2, n = pat.subn(lambda m: f'{m.group(1)}_inst_enable_timer {m.group(3)} {m.group(2)}\n', s)
assert n == 9, f'expected the nine timer enables measured at 1f9fa22d, rewrote {n}'
p.write_text(s2)
PY
grep -n '_inst_enable_timer [a-z-]* [a-z.-]*\.timer$' ccd/ccrc   # 9 lines, each keeping its own gate
```

  Every comment above each enable stays as it is.
- Insert the converge directly above `  # ── THE RESTART, AND WHY \`enable --now\` IS NOT ENOUGH ─────────────────`:

```bash
  # Plan 3a Task 6: the Codex lanes' usage timers, converged to exactly the
  # roster's codex set, after daemon-reload read the template `_inst_units`
  # placed. `_inst_codex_usage` says why each of its acts, and why none of
  # them is fatal.
  _inst_codex_usage
```

6e. **`_uninst_units`.**
- Replace its three-line comment `  # NOT \`ccgpt-usage@.{service,timer}\`: \`_inst_units\` places neither (its own` … `An uninstall removes only what ccrc placed.` with:

```bash
  # ccrc's OWN usage pair, `ccrc-codex-usage@.{service,timer}`, goes with the
  # rest (Plan 3a). NEVER `ccgpt-usage@.{service,timer}` or an instance of it:
  # on a live fleet box those names hold another repository's enabled units,
  # and an uninstall removes only what ccrc placed.
```

- In its `rm -f`, insert this line after `    "$dir/ccrc-update-watchdog.service" "$dir/ccrc-update-watchdog.timer" \`:

```bash
    "$dir/ccrc-codex-usage@.service" "$dir/ccrc-codex-usage@.timer" \
```

6f. **`ccd/ccrc-doctor-checks`.** Insert this block directly above `_check_codex() {`:

```bash
# ── `_check_codex`'s usage rows (Plan 3a Task 6; spec §12; rulings R2, R6) ──
# THREE findings, each its own sentence with its own remedy. Each is RECORDED
# through `_check_codex`'s `_dr_cx_warn` (Task 4) and printed by its
# `_dr_cx_report`, never here. They are two of §12's three usage rows, plus
# the second writer R6 adds. §12's third, a probe model absent from the
# catalogue, is Task 4's `_dr_cx_lane` row, said once:
#   - ccrc's usage pair not installed, or a lane's instance not enabled: WARN,
#     remedy `ccrc install`, the converge that enables it
#     (D-3721: `cmd_doctor` runs a fixer on a
#     FAIL only, D-3113's one contract, and a stopped poller is a WARN);
#   - another repository's usage timer enabled for this lane: WARN, remedy the
#     operator's own disable — ccrc never disables another tool's unit, and the
#     converge withholds ccrc's own instance while it stands. The FLAT, id-less
#     one names no lane, so it is reported once, as unattributable;
#   - the lane's usage row stale, never published, or unreadable: WARN.
# "Enabled" is ccrc's own reading of the manager's links (`_codex_usage_enabled`
# in ccrc, D-3726), the one the
# converge acts on. No systemctl call: nothing here needs the user bus.
# NOT APPLICABLE ON macOS, and said so, never a WARN: ccrc places no launchd job
# for the poller (decision 17), so a WARN there would stand on every macOS codex
# lane for ever — the noise `_inst_linger_darwin`'s doctrine refuses
# (D-3720).
# The usage row is read only after a regular-file test (a FIFO at that path
# blocks a read — F2's class, `_check_models`), and nothing here opens an OAuth
# file.
# THREE of the timer's 15-minute cycles: one missed poll is not a finding.
# `ccrc-doctor.test.ts` ties this to the shipped timer's `OnUnitActiveSec=`.
_DR_CODEX_USAGE_STALE_S=2700

_dr_codex_usage_box() {   # -> WARN findings, recorded; rc 2 if any, else 0; sets DR_CODEX_USAGE_PAIR and DR_CODEX_USAGE_BOX_NOTE
  local u rc=0
  local -a missing=()
  DR_CODEX_USAGE_PAIR=present; DR_CODEX_USAGE_BOX_NOTE=''
  if ! declare -F _codex_usage_enabled >/dev/null 2>&1; then
    _dr_fail codex "ccrc's own usage-timer reader is not loaded, so no codex lane's usage timer was measured" \
      "this is a bug in ccrc, not a fact about your box — _check_codex calls _codex_usage_enabled, declared once in ccrc itself, and this check table was sourced by something that is not ccrc"
    return 1
  fi
  if [ "${CCD_OS:-linux}" = darwin ]; then
    DR_CODEX_USAGE_BOX_NOTE="usage publishing not applicable on macOS — ccrc places no launchd job for it (decision 17)"
    return 0
  fi
  for u in ccrc-codex-usage@.service ccrc-codex-usage@.timer; do
    [ -f "$CCRC_UNIT_DIR/$u" ] || missing+=("$u")
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    DR_CODEX_USAGE_PAIR=missing
    _dr_cx_warn "ccrc's usage unit pair is not installed (${missing[*]} absent from $CCRC_UNIT_DIR), so no codex lane on this box publishes its ~/.cc-limits row" \
      "ccrc install — it places the pair and enables one usage timer per codex lane"
    rc=2
  fi
  if _codex_usage_flat_foreign; then
    _dr_cx_warn "another repository's ccgpt-usage.timer is enabled on this box; it names no lane, so ccrc cannot tell whether it is a second publisher of a codex lane's ~/.cc-limits row" \
      "if it publishes for a codex lane, disable it yourself: systemctl --user disable --now ccgpt-usage.timer — ccrc never disables another tool's unit"
    rc=2
  fi
  return "$rc"
}

_dr_codex_usage() {   # <id> -> WARN findings for this lane, recorded; rc 2 if any, else 0; sets DR_CODEX_USAGE_NOTE
  local id="$1" rc=0 t f row now en ts age
  local -a note=()
  DR_CODEX_USAGE_NOTE=''
  if [ "${CCD_OS:-linux}" = darwin ]; then
    DR_CODEX_USAGE_NOTE="usage timer not applicable on macOS"
    return 0
  fi
  t="$(_codex_usage_timer "$id")"; f="$(_codex_usage_foreign "$id")"
  # (1) WHO publishes this lane's row.
  if _codex_usage_enabled "$f"; then
    _dr_cx_warn "$id: another repository's $f is enabled, so two publishers would race this lane's ~/.cc-limits row and two token refreshes its OAuth directory — ccrc withholds its own $t while it stands" \
      "once this lane's cutover no longer needs it, disable it yourself: systemctl --user disable --now $f, then run: ccrc install — ccrc never disables another tool's unit"
    rc=2
  elif _codex_usage_enabled "$t"; then
    note+=("$t enabled")
  elif [ "${DR_CODEX_USAGE_PAIR:-present}" = present ]; then
    _dr_cx_warn "$id: $t is not enabled, so this lane's ~/.cc-limits usage row is never refreshed" \
      "ccrc install — its converge enables one usage timer per codex lane"
    rc=2
  fi
  # (2) THE ROW, judged only when ccrc's timer is its writer.
  if _codex_usage_enabled "$t" && ! _codex_usage_enabled "$f"; then
    row="$HOME/.cc-limits/$id.json"
    if ! now="$(date +%s 2>/dev/null)" || ! [[ "$now" =~ ^[0-9]+$ ]]; then
      _dr_cx_warn "$id: this box's \`date\` cannot answer +%s, so the age of this lane's usage row cannot be measured" \
        "install a working GNU/BSD date — every age-based check in this file needs it"
      rc=2
    elif [ ! -e "$row" ] && [ ! -L "$row" ]; then
      en="$(_plat_mtime "$(_codex_usage_wants)/$t" 2>/dev/null)" || en=''
      if [[ "$en" =~ ^[0-9]+$ ]] && [ $((now - en)) -le "$_DR_CODEX_USAGE_STALE_S" ]; then
        note+=("no usage row yet (enabled $((now - en))s ago; the first poll runs five minutes after enable)")
      else
        _dr_cx_warn "$id: $t has been enabled for longer than $((_DR_CODEX_USAGE_STALE_S / 60)) min and this lane has never published a usage row ($row)" \
          "read what the publisher says: $(_dr_log_hint "ccrc-codex-usage@$id.service")"
        rc=2
      fi
    elif [ ! -f "$row" ]; then
      _dr_cx_warn "$id: $row is not a regular file, so this lane's usage row cannot be read" \
        "move it aside; the next poll writes a regular file there"
      rc=2
    else
      ts="$(jq -r 'if type == "object" and (.ts | type) == "number" then (.ts | floor | tostring) else empty end' "$row" 2>/dev/null)" || ts=''
      if ! [[ "$ts" =~ ^[0-9]+$ ]]; then
        _dr_cx_warn "$id: $row carries no numeric ts, so its age cannot be measured" \
          "move it aside; the next poll rewrites it — and read what the publisher says: $(_dr_log_hint "ccrc-codex-usage@$id.service")"
        rc=2
      else
        age=$((now - ts))
        if [ "$age" -gt "$_DR_CODEX_USAGE_STALE_S" ]; then
          _dr_cx_warn "$id: its usage row was last written $((age / 60)) min ago — more than three of $t's polls" \
            "read what the publisher says: $(_dr_log_hint "ccrc-codex-usage@$id.service")"
          rc=2
        else
          note+=("usage row ${age}s old")
        fi
      fi
    fi
  fi
  # (3) THE PROBE MODEL is not measured here. Task 4's `_dr_cx_lane` owns
  # both of its rows (haiku unassigned, haiku retired from the catalogue)
  # through models-op's `show`, and a second copy would print each twice.
  DR_CODEX_USAGE_NOTE="$(_dr_join ${note[@]+"${note[@]}"})"
  return "$rc"
}
```

6g. **Wire the rows into Task 4's `_check_codex`**, in Task 4's own names, so the check still prints every FAIL line, then every WARN line, and returns the worst class it printed (`_dr_cx_report`):
- 6f's two functions record every finding through `_dr_cx_warn "<what>" "<remedy>"` and never print one with `_dr_warn`. Only `_dr_codex_usage_box`'s not-loaded guard prints its own FAIL, and it returns 1.
- **The locals.** Directly after Task 5's `  local DRX_LIVE=0 DRX_UNASKED=0 DRX_UNASKED_SID=''`, add:

```bash
  local DR_CODEX_USAGE_PAIR=present DR_CODEX_USAGE_BOX_NOTE='' DR_CODEX_USAGE_NOTE=''
```

- **Once**, directly after `    _dr_cx_runtime`. That call sits inside the `if [ "${#lanes[@]}" -gt 0 ]` block, so a box with only left lane state never asks:

```bash
    # Plan 3a Task 6: the box-level usage rows, once. A reader that is not
    # loaded is its own FAIL, already printed: stop there.
    _dr_codex_usage_box; [ "$?" -ne 1 ] || return 1
```

- **Per lane**, replace Task 5's two lines

```bash
      _dr_cx_tiers "$id"
      DRX_OK+=("$id ($DRX_LANE_WORDS; $DRX_TIER_WORDS)")
```

  with

```bash
      _dr_cx_tiers "$id"
      _dr_codex_usage "$id"
      DRX_OK+=("$id ($DRX_LANE_WORDS; $DRX_TIER_WORDS${DR_CODEX_USAGE_NOTE:+; $DR_CODEX_USAGE_NOTE})")
```

- **The PASS detail.** In `_check_codex`'s closing `_dr_cx_report "…; the four GPT-lane executables match the shipped tree"`, append `${DR_CODEX_USAGE_BOX_NOTE:+; $DR_CODEX_USAGE_BOX_NOTE}` before the closing quote.

`_dr_codex_usage`'s own return code is not read here. Its findings are already in `DRX_CLASS`, and `_dr_cx_report` returns the worst of them.

6h. **`ccd/ccgpt-usage.py:151`.** `    (\`ccgpt-usage@<id>.timer\`) always names its instance, and a publisher` becomes `    (\`ccrc-codex-usage@<id>.timer\`) always names its instance, and a publisher`.

6i. **Check the shell syntax, and list what the suites collect:**

```bash
. "<abs scratch>/plan3a-env.sh"
bash -n ccd/ccrc && bash -n ccd/ccrc-doctor-checks && echo syntax-ok
# Collection runs every module's top level, so it is census-wrapped (R11). The list lands in the census's own run.txt (F10).
cd server && "$CENSUS" "$SCRATCH/t6-ev/collect" ./node_modules/.bin/vitest list test/ccrc-install.test.ts test/install-census.test.ts test/ccrc-doctor.test.ts > /dev/null; echo "census exit $?"; wc -l < "$SCRATCH/t6-ev/collect/run.txt"
```

- [ ] **Step 7: Run everything green.** Each line is its own foreground Bash call from the tree root, with a timeout of at least 600000 ms (F6), and sources the env file itself (F2):

```bash
. "<abs scratch>/plan3a-env.sh"; cd server && "$CENSUS" "$SCRATCH/t6-ev/g-install" ./node_modules/.bin/vitest run test/ccrc-install.test.ts
. "<abs scratch>/plan3a-env.sh"; cd server && "$CENSUS" "$SCRATCH/t6-ev/g-census" ./node_modules/.bin/vitest run test/install-census.test.ts
. "<abs scratch>/plan3a-env.sh"; cd server && "$CENSUS" "$SCRATCH/t6-ev/g-doctor-<k>" ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t <P>   # three calls, k = 1, 2, 3: the Global Constraints' parts
. "<abs scratch>/plan3a-env.sh"; cd server && "$CENSUS" "$SCRATCH/t6-ev/g-update" ./node_modules/.bin/vitest run test/ccrc-update.test.ts
. "<abs scratch>/plan3a-env.sh"; cd server && "$CENSUS" "$SCRATCH/t6-ev/g-graphify" ./node_modules/.bin/vitest run test/ccrc-install-graphify.test.ts
. "<abs scratch>/plan3a-env.sh"; cd server && "$CENSUS" "$SCRATCH/t6-ev/g-uninst" ./node_modules/.bin/vitest run test/ccrc-uninstall.test.ts
. "<abs scratch>/plan3a-env.sh"; cd server && "$CENSUS" "$SCRATCH/t6-ev/g-neigh" ./node_modules/.bin/vitest run test/timer-first-run.test.ts test/ccgpt-usage.test.ts test/build-release.test.ts
. "<abs scratch>/plan3a-env.sh"; cd server && "$CENSUS" "$SCRATCH/t6-ev/g-scans" ./node_modules/.bin/vitest run test/single-definition.test.ts test/macos-platform.test.ts test/ownership.test.ts
. "<abs scratch>/plan3a-env.sh"; cd server && "$CENSUS" "$SCRATCH/t6-ev/g-topo" ./node_modules/.bin/vitest run test/topology-clean.test.ts
. "<abs scratch>/plan3a-env.sh"; cd server && "$CENSUS" "$SCRATCH/t6-ev/g-tc" ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
. "<abs scratch>/plan3a-env.sh"; cd server && "$CENSUS" "$SCRATCH/t6-ev/g-cite" ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored'
. "<abs scratch>/plan3a-env.sh"; cd agent && "$CENSUS" "$SCRATCH/t6-ev/g-dv" ./node_modules/.bin/vitest run test/deploy-verify.test.ts
```

Why each neighbour is in the list:
- `ccrc-update.test.ts`, `ccrc-install-graphify.test.ts` and `ccrc-uninstall.test.ts` run the spine, or `_uninst_units`, that this task changed.
- `timer-first-run.test.ts` derives its timer census from `deploy/systemd/`, and the renamed timer keeps exactly one anchor.
- `ccgpt-usage.test.ts` is the publisher whose docstring changed.
- `build-release.test.ts` reads `PATHSPEC`.
- `single-definition`, `macos-platform` and `ownership` scan `ccd/ccrc` and `ccd/ccrc-doctor-checks`. The new code carries no GNU-only spelling: `_plat_mtime`, and no `sort`, `stat -c` or `date -d`.
- `topology-clean` checks residue.
- The `session-hook` citation census is expected GREEN, because every `ccd/ccrc` insert here is below `:11635` (Step 9). If it reds, repair it by S6-R11 in this commit and say why.
- `deploy-verify` copies `deploy/systemd/` whole into its fixture run.

Also expect:
- The server-case counts to rise by exactly: `ccrc-install` +17 (the 14 isolation cases, the real-spine case, and the two cases of the nine-degrade describe); `install-census` +1 (the own-name pin); `ccrc-doctor` +14 (the two usage-rows describes, 11 Linux cases and 3 for any host, without the three probe-model cases the reconciliation left to Task 4). Record the actual counts. The rewritten cases keep their counts.
- Task 4's and Task 5's `PASS codex` cases to stay green after Step 3b. Record their count before and after.
- `ccrc-update.test.ts` and `ccrc-install-graphify.test.ts` never to reach the new `disable` arm. `grep -c 'disable --now' "$HOME"/…` is not meaningful across fixtures, so this is measured by the Step 0 grep.
- If one of the known load flakes reds (`CLAUDE.md`), re-run that file alone before calling it a break.

- [ ] **Step 8: Mutation table, measured both ways.** Before mutating, take `git add -A && git commit -m 'wip: task 6'`. Then each row is four acts, and each Bash act is its own call (F2, F6, F7):
  1. **Back up every file the row edits**, one copy per file, with the first block below. U1–U4, C1–C7, D1 and D2 edit `ccd/ccrc`; T1 and T2 `deploy/systemd/ccrc-codex-usage@.service`; T3 and S1 `deploy/systemd/ccrc-codex-usage@.timer`; W1–W10 `ccd/ccrc-doctor-checks`; F1 `deploy/deploy.sh`. No Task 6 row edits two files.
  2. **Mutate** exactly as the row says, and nothing else.
  3. **Run each named suite as its own call**, `. "<abs scratch>/plan3a-env.sh"; cd server && "$CENSUS" "$SCRATCH/t6-ev/mut-<row>-<suite>" ./node_modules/.bin/vitest run test/<suite>.test.ts`, and record *failing / total*. For `ccrc-doctor`, run only the Global Constraints' part that holds the row's cases: part 1, `-t '^ccrc doctor: [a-c]'`, for every W row, because this task's two usage-rows describes sit in it.
  4. **Restore from the backups** with the second block, which verifies the restore with `git diff --quiet` against the WIP commit. Then re-run the same suites and record *failing / total* after the restore.

```bash
. "<abs scratch>/plan3a-env.sh"; ROW=U1; FILES=(ccd/ccrc)   # back up: ROW and FILES from the row
for f in "${FILES[@]}"; do mkdir -p "$SCRATCH/t6-mut/$ROW/$(dirname "$f")" && cp -p -- "$f" "$SCRATCH/t6-mut/$ROW/$f" || exit 1; done; echo "backed up ${#FILES[@]} file(s) for $ROW"
```

```bash
. "<abs scratch>/plan3a-env.sh"; ROW=U1; FILES=(ccd/ccrc)   # restore: the same ROW and FILES as its backup
for f in "${FILES[@]}"; do cp -p -- "$SCRATCH/t6-mut/$ROW/$f" "$f" || exit 1; done
git diff --quiet -- "${FILES[@]}" && [ -z "$(git status --porcelain)" ] && echo "restored $ROW" || echo "NOT restored: stop and report"
```

If a demanded mutation does not red, **report that it does not**, and never add code to force a bind.

| # | Guard | Mutation | Must red |
|---|---|---|---|
| U1 | the pair is placed | delete the two `ccrc-codex-usage@` `_inst_atomic` lines in `_inst_units` | ccrc-install: the byte-for-byte unit case, `places ccrc's OWN usage pair`, and the survival case. install-census: the own-name pin, `DEPLOY_SH_WITHHOLDS` direction 1, and "the uninstall census removes no systemd unit file the install spine does not place" (the `rm -f` pair). |
| U2 | the `!= server` gate | move both lines above `  if [ "$INST_ROLE" != server ]; then` | ccrc-install: the `--role server` case |
| U3 | the foreign name is never written | change the `.service` destination to `"$dir/ccgpt-usage@.service"` | install-census: the foreign-name guard. ccrc-install: the survival case (its foreign bytes changed). |
| U4 | the template's removal | drop the `ccrc-codex-usage@` line from `_uninst_units`' `rm -f` | install-census: "every systemd unit file the install spine places is removed by the uninstall census". ccrc-install: the survival case (`uninstall left ccrc's own …`). |
| C1 | withdraw | delete the first `for e in $have` loop in `_inst_codex_usage` | isolation: the flip-back case and the last-lane-gone case |
| C2 | the second writer | delete the `if _codex_usage_enabled "$f"; then … continue; fi` arm | isolation: the foreign case |
| C3 | an unreadable roster acts on nothing | delete the `if [ "$lrc" -ne 0 ]` block | isolation: the unreadable-roster case (the planted timer is withdrawn) |
| C4 | Darwin | delete the `if [ "$CCD_OS" = darwin ]` block | isolation: both forced-Darwin cases |
| C5 | server | delete `[ "$INST_ROLE" = server ] && return 0` | isolation: the server case |
| C6 | the call | delete `_inst_codex_usage` from `_inst_enable`'s Linux arm | ccrc-install: the real-spine usage case, and the `none` line in `places ccrc's OWN usage pair`. The isolation cases stay GREEN, because they call the function directly; record that. |
| C7 | the flat note never blocks | add `continue` right after the flat-timer `echo` inside a loop, or make the flat check `return 0` | isolation: the flat case (`enable` missing, or the line missing) |
| D1 | the degrade is counted | delete `INST_DEGRADED+=("$2")` from `_inst_enable_timer` | ccrc-install: the nine-degrade case (both roles), the text guard, the watchdog assertion, and the isolation enable-refused case |
| D2 | no timer bypasses the helper | restore `ccd-tmp-sweep.timer`'s old two-line `\|\| echo … >&2` form | ccrc-install: the nine-degrade case (the closing line lacks `ccd-tmp-sweep.timer`), and the text guard |
| T1 | the start bound | delete `TimeoutStartSec=300` | ccrc-install: the unit pin |
| T2 | the bound fits a cycle | `TimeoutStartSec=900` | ccrc-install: the unit pin |
| T3 | the wants target | `WantedBy=default.target` in the timer | ccrc-install: the unit pin |
| W1 | the pair-missing row | delete the `missing` WARN block in `_dr_codex_usage_box` | doctor: the pair-missing case |
| W2 | the second-writer row | delete the first arm of `_dr_codex_usage`'s `if` | doctor: the second-writer case and the e2e case |
| W3 | the not-enabled row | change `! _codex_usage_enabled "$t"` so that the arm never fires (swap `elif [ "${DR_CODEX_USAGE_PAIR:-present}" = present ]` to `elif false`) | doctor: the disabled case |
| W4 | staleness | `-gt "$_DR_CODEX_USAGE_STALE_S"` → `-gt 999999` | doctor: the stale case |
| W5 | never published | make the absent-row arm always take the note branch | doctor: the norow-old case |
| W6 | FIFO safety | delete the `elif [ ! -f "$row" ]` arm | doctor: the FIFO case (exit 124 at `usageRows`' 20 s process-group bound, F8: `timeout -k` ends the blocked `jq` with its group, so no reader survives and the census stays clean). Measured where `DOCTOR_DEADLINE_BIN` resolves; where it does not, the case is skipped, and W6 is reported unmeasured |
| W9 | Darwin rows | delete both Darwin arms | doctor: the forced-Darwin case |
| W10 | the reader guard | delete the `declare -F` block | doctor: the unloaded case |
| S1 | threshold ↔ unit | `OnUnitActiveSec=30min` in the timer | doctor: the threshold pin |
| F1 | the foreign family stays refused | add `systemctl --user enable --now ccgpt-usage@codex-a.timer` to deploy.sh's `AGENT_CMD` enable chain | install-census: the deploy-enable case (it is GREEN without the 2b edit; record both) |

- [ ] **Step 9: Post-conditions.** They run after Step 8's WIP commit, which is the task's own commit (Step 10 only rewrites its message), so every diff reads `git diff "$BASE" HEAD` over a clean tree (F3).

```bash
. "<abs scratch>/plan3a-env.sh"; BASE="$(cat "$SCRATCH/t6-base")"
git rev-parse -q --verify "$BASE^{commit}" >/dev/null && [ -z "$(git status --porcelain)" ] || { echo 'no t6 base, or the tree is not the WIP commit: stop'; exit 1; }
git diff --quiet "$BASE" HEAD -- ccd/ccd ccd/ccgpt-runtime ccd/ccgpt-proxy.py && echo cut-ok     # no box rebuilds, no re-stamp
top=$(grep -noE 'ccd/ccrc:[0-9]+' docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md \
  docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md README.md | sed 's/.*://' | sort -n | tail -1)
low=$(git diff -U0 "$BASE" HEAD -- ccd/ccrc | sed -nE 's/^@@ -([0-9]+).*/\1/p' | sort -n | head -1)
[ "$low" -gt "$top" ] && echo "every ccd/ccrc hunk ($low…) is below the corpus's highest anchor ($top)"
git diff "$BASE" HEAD -- server/test/ccrc-doctor.test.ts | grep -c '^[-+].*HEALTHY_SKIPS =' || echo 'HEALTHY_SKIPS unchanged'   # 0
git diff --stat "$BASE" HEAD -- server/test/installTreeFixture.ts   # empty (the directory entry carries the rename)
```

Residue (R10, R13; rulings F1, F4). **Build `$SCRATCH/plan3a-live-values` once, here**; Task 7 Step 9 reads the same file. Its values are exactly the ones Task 11 Step 4 lists, measured read-only on the fleet box now, the way that step measures them (F1):
- the two GPT-lane ids and labels, from the box roster;
- lane 2's two ports, from its launcher's two `export` lines only;
- the OAuth-directory and per-lane config names under `~/.handoff` (`chatgpt-auth*`, `litellm-config*`), by `ls`, names only, minus any name the base tree already carries, as Task 11 Step 4 drops them;
- lane 2's session codenames, from the `.wrapper` field files, names only.

The gitignored `deploy/reference-fleet.md` is not consulted. No value is ever printed (F4). Each source is a read-only pipeline whose output goes straight into `enc`, which stores one base64-encoded value per line in a file created at mode 0600. Write one `<source> | enc` line per source where the block's comment stands, so the whole build is one call. Never `cat` the file, and never paste a value anywhere tracked.

```bash
. "<abs scratch>/plan3a-env.sh"; LIVE="$SCRATCH/plan3a-live-values"
rm -f -- "$LIVE" && install -m 600 /dev/null "$LIVE" || exit 1   # created 0600: an existing file's mode would survive a bare umask
enc() { while IFS= read -r v; do [ -n "$v" ] && { printf '%s' "$v" | base64 -w0; echo; }; done >> "$LIVE"; }
# <source> | enc   (one line per Task 11 Step 4 source; nothing reaches the screen)
[ "$(stat -c %a "$LIVE")" = 600 ] && echo "live-values: $(wc -l < "$LIVE") value(s), mode 600"
```

Expected: at least six values (two ids, two labels, two ports), mode 600. Then scan this task's added lines:

```bash
. "<abs scratch>/plan3a-env.sh"; BASE="$(cat "$SCRATCH/t6-base")"; LIVE="$SCRATCH/plan3a-live-values"
test -s "$LIVE" || { echo 'plan3a-live-values missing or empty: build it as Task 6 Step 9 says'; exit 1; }
git rev-parse -q --verify "$BASE^{commit}" >/dev/null && [ -z "$(git status --porcelain)" ] || { echo 'no t6 base, or the tree is not the WIP commit: stop'; exit 1; }
# Decoded only into grep's pattern stream; each value literal, bounded by anything but [[:alnum:]_-].
pats() { while IFS= read -r l; do printf '%s' "$l" | base64 -d | sed 's/[][\.*^$+?(){}|]/\\&/g; s/.*/(^|[^[:alnum:]_-])&([^[:alnum:]_-]|$)/'; echo; done < "$LIVE"; }
git diff "$BASE" HEAD | command grep '^+' | command grep -qEf <(pats); rc=$?
[ "$rc" -eq 1 ] && echo residue-clean
[ "$rc" -eq 0 ] && git diff --name-only "$BASE" HEAD | while IFS= read -r f; do
  n=$(git diff "$BASE" HEAD -- "$f" | command grep '^+' | command grep -cEf <(pats)); [ "$n" -eq 0 ] || echo "residue: $f: $n added line(s) carry a live value"
done
[ "$rc" -le 1 ] || echo "residue: the scan did not run (grep rc $rc)"
```

Expected: `residue-clean`. A missing or empty file, a missing base or a dirty tree stops the scan before it can read clean. Each value matches literally, bounded by anything but a letter, digit, `_` or `-`, so a fixture name or a `D-` number never hits. `command grep` is GNU grep: the agent shell's `grep` is a function that runs another engine, which answers this bounded pattern differently (measured while this plan was fixed). A `residue:` line stops the task. It names a file and a count, never the line. Reword the added line into fixture vocabulary in this task. A hit that is only a number equal to a port, such as a line citation, is reported by file and count to the controller, who rules.

- [ ] **Step 10: Commit.** Amend the WIP commit into the task's commit:

```bash
git add deploy/systemd ccd/ccrc ccd/ccrc-doctor-checks ccd/ccgpt-usage.py \
  server/test/ccrc-install.test.ts server/test/install-census.test.ts server/test/ccrc-doctor.test.ts \
  server/test/codexLaneFixture.ts server/test/ccrc-update.test.ts server/test/ccrc-install-graphify.test.ts
git commit --amend -F - <<'EOF'
feat(gpt-lane): ccrc's own usage pair, ccrc-codex-usage@, converged to the codex lanes; every timer degrade counted

The usage pair is renamed from ccgpt-usage@ to ccrc-codex-usage@
(D-3717): on a live fleet box the
old name is another repository's template with an instance enabled, and a
merge auto-rolls. _inst_units places it on fleet/both, Linux only; the
service keeps Task 1's TimeoutStartSec=300.

_inst_codex_usage, inside _inst_enable, converges the enabled instances to
exactly the roster's codex lanes (D-3718):
it withdraws a ccrc timer whose lane is no longer codex, enables one per
codex lane, and withholds ccrc's while another repository's
ccgpt-usage@<id>.timer is enabled for the same id
(D-3719). It never touches or names a foreign unit
to the manager; the flat, id-less foreign timer is reported unattributed.
An unreadable roster, a missing jq or a missing shape contract converges
nothing. Enablement is read from timers.target.wants
(D-3726). macOS says
not-applicable and degrades nothing.

_inst_enable_timer: the nine timer refusals that printed a remedy and
appended nothing to INST_DEGRADED (measured at 1f9fa22d) now degrade by
unit name, so the closing line can no longer claim a timer that never armed.

_check_codex's usage rows: pair not installed, instance not enabled, a
second writer, and a stale / never-published / unreadable row — each WARN
with its own remedy, recorded through _dr_cx_warn
(D-3721, D-3720).

_uninst_units removes the template pair (its instances: Task 7), and
DEPLOY_SH_WITHHOLDS declares the pair for this one commit (Task 7 teaches
deploy.sh). Rewritten, not deleted (2b-1 item 13): the "no usage unit on any
role" case, the foreign-pair survival case, the unit pin.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Before pushing, check `git log -1 --format='%an <%ae>'` against the repository's identity rule. Put the Step 5 and Step 8 counts in the PR body, not in the commit.

**What this task deliberately does NOT do** (reject any of these as scope creep):
- It does not disable instances on uninstall, and it does not touch `_acct_remove` or `deploy/deploy.sh`. All three are Task 7's. For this one commit, deploy.sh's comment "The chain above places NO `ccgpt-usage@`" still reads as it did, and Task 7 rewrites it.
- It never places, enables, disables, removes or reads the CONTENT of a `ccgpt-usage*` unit. It reads only whether its wants link exists.
- It adds no `_inst_*` step. `CCRC_INST_SPINE` and the `cmd_install` step-list pin are unchanged: the converge runs inside `_inst_enable`.
- It adds no `--fix` arm (Task 8), and no launchd job for the poller (decision 17, stated in Task 11's §20).
- It does not touch `ccd/ccgpt-runtime`, `ccd/ccgpt-proxy.py` or `ccd/ccd`. In `ccd/ccgpt-usage.py` it changes one docstring line, and nothing of Task 1's or Task 8's edits.
- It adds `ccrc-codex-usage@*` to no `_check_services` `known` list. Templates are `_check_codex`'s (spec §12).

**Hazards a later task or plan must respect:**
1. **3b's targeted enable (R-C10) must retire the foreign instance FIRST.** While another repository's `ccgpt-usage@<id>.timer` is enabled, every `ccrc install`, update and auto-update withholds ccrc's instance and degrades. That is by design, and it makes an auto-update inside a window safe.
2. **A foreign timer that is `start`ed but not enabled is invisible** to the converge and to doctor alike, as stated in the helpers' header. 3b's retirement is `disable --now`, never a bare `stop`.
3. **The flat foreign timer is unattributable.** After a lane flips, doctor WARNs about it until the operator disables it (3b Task 3c).
4. **`WantedBy=timers.target` is load-bearing** (the T3 pin). A unit that moves to another target blinds every reader of the link.
5. **Rollback is a roster edit plus an install.** A lane flipped back to `external` has ccrc's instance withdrawn by the next install. The operator re-enables the other repository's timer by hand afterwards, never before, or the converge degrades.

### Task 7: Uninstall, account removal and the fallback deploy carry the usage pair; the two hand lists become derived; deploy.sh stops placing the model probe

> Rulings applied:
> - **R-C9 / spec §13.** Uninstall disables every enabled instance of ccrc's template, then removes the pair.
> - **R-C11, with R5's file list.** `deploy.sh` stops placing `~/.local/bin/ccrc-models-probe`. The edit lives here so that `agent/test/deploy-verify.test.ts` is edited once, together with `usage-sweep-deploy-ship.test.ts`'s note and `install-census.test.ts:58` (critic #8). Operator ruling Z leaves R-C11 standing and changes one of its reasons: ccrc's own probe keeps the token-directory default for an `external` lane until that lane's flip (Z1, `D-3706`), so the PATH copy is no longer the one reader with that default (Why).
> - **2b-1 items 14, 19, 20.**
> - **R11, R12, R13; F2, F6** as in Task 6, with `$SCRATCH/t7-base` and `$SCRATCH/t7-ev`.

**Files:**
- Modify: `ccd/ccrc`:
  - New `_uninst_codex_usage` and `_acct_remove_usage`, directly above `_uninst_units`' header (`grep -n '^# Stop, disable, delete — in that order' ccd/ccrc`, `:21418` today, below every cited anchor).
  - `_uninst_units`: one call inside its systemctl branch, and its comment (Task 6's).
  - `_acct_remove`: ONE added line, directly above `  for f in "$CCRC_LIMITS_DIR/$id.json" "$_SVC_REG/$id-disabled" "$_SVC_REG/$id.hookstate.json"; do` (`:8352`). That line sits ABOVE `ccd/ccrc:11635`, the corpus's highest anchor, so Step 6 runs the S6-R11 census.
- Modify: `deploy/deploy.sh`, **line-neutral from line 826 on**, and neutral everywhere a reader cites it (Step 5 measures it):
  - `:669-674`: the probe's comment and its `install_atomic`, six lines, become a six-line note (R-C11).
  - `:696-697` and `:712-713`: two D-2600 notes that say the probe "spends" graph-noise slack, reworded on their own lines.
  - `:815`: `AGENT_BUILD_CMD`'s last link gains the pair's two `_unit_atomic` links (+2).
  - `:822-825`: the "places NO `ccgpt-usage@`" paragraph, four lines, becomes two (−2).
- Test: `server/test/ccrc-uninstall.test.ts`:
  - its `systemctl` stub's `disable` arm;
  - `plantInstalledBox` plants ccrc's pair;
  - the `units:` case, rewritten with its lists derived;
  - a new instance-sweep case;
  - the foreign-pair case (`:809`), extended;
  - two helpers.
- Test: `server/test/ccrc-account.test.ts`: C12, C13 and C14 (the describe already holds C1–C11), plus `plantUsageCtl`. Import `plantCodexUsage, plantForeignUsage` from `./codexLaneFixture.js`.
- Test: `server/test/install-census.test.ts`:
  - `DEPLOY_SH_WITHHOLDS` loses Task 6's one-commit entry;
  - the header note at `:58`;
  - the STATED SCOPE bullet on the disable census (`:179`).
- Test: `agent/test/deploy-verify.test.ts`:
  - `:704`, the probe's `toContain`, becomes an absence pin;
  - the hand-typed `landed` list (`:870-899`) is derived from the chain;
  - a template anchor;
  - `readdirSync` joins its `node:fs` import.
- Test: `server/test/usage-sweep-deploy-ship.test.ts`: the comment at `:96-99`.
- **Unchanged, measured:**
  - `graph-noise-ship.test.ts`. The sweep-to-list code-line distance goes from 3 to 2, and its budget is ≤ 3.
  - `deploy-verify.test.ts:578`. It asserts that `ccd/ccrc-models-probe` is in the repository, and that stays true: ccrc runs its tree's copy, which the `ccd/` rsync lands at `~/ccrc/ccd/`.
  - `ccrc-api-ship`, `compact-card-ship`, `tmp-sweep` and the three `install-*-skill` suites. No line they locate changes.

**Interfaces:**
- Consumes:
  - From Task 6: `_codex_usage_timer`, `_codex_usage_foreign`, `_codex_usage_wants`, `_codex_usage_enabled` and `_codex_usage_enabled_ids`; the `DEPLOY_SH_WITHHOLDS` entry; `plantCodexUsage` and `plantForeignUsage`; `_uninst_units`' `rm -f` of the pair.
  - From 2b-2:
    - `_codex_bus_defaults`, and `_acct_remove`'s `removed` and `operator_steps` arrays and its one-JSON-object stdout;
    - test helpers: `plantInstalledBox`, `runVerb`, `verbEnv`, `ccrcFunction`, `box`, `seedRosterJson`, `plantLaneState`, `codexLaneOnFreePorts`, `run`, `env`, `oneObject`, `MANAGER_STANDIN_MARK`, and `deploy-verify`'s `agentCmd` and `src`.
- Produces:
  - `_uninst_codex_usage`: disables every `ccrc-codex-usage@*.timer` that has a wants link, whatever the roster says, while its template is still on disk. It prints `uninstall: units: <n> codex usage timer(s) stopped and disabled` when there were any, and a line per refusal. It never names a `ccgpt-usage` unit.
  - `_acct_remove_usage <id>`: disables ccrc's instance for that id, whatever the row's kind. It sets `ACCT_USAGE_REMOVED` (the wants link, once the disable measurably removed it) or `ACCT_USAGE_STEP` (an operator step). It never refuses.
  - deploy.sh's agent lane places `ccrc-codex-usage@.{service,timer}` and enables none, and no longer places `~/.local/bin/ccrc-models-probe`.
  - The uninstall suite's absence list is the fixture's own unit directory, and `plantInstalledBox` ⊇ `_inst_units`' destinations, read out of `ccd/ccrc`. deploy-verify's `landed` list is the chain's own `_unit_atomic` operands.

**Why:**

**Why uninstall sweeps the instances, and in a function of its own.** Spec §13 removes "every enabled instance" of the pair (R-C9). An instance is a oneshot poller holding no session state, so D-3167's never-touch reasoning for `claude-session@` does not carry over. Order matters: a template removed under an enabled instance leaves systemd holding a dangling enablement, and the stub now records whether the template was still on disk at each disable. The sweep lives outside `_uninst_units` because `install-census.test.ts`'s disable census reads every `disable --now` operand there as a literal unit name and THROWS on anything else. An instance name is built from an id at run time, so this census reads it nowhere, and the uninstall suite measures it instead.

**Why account removal disables it whatever the kind.** A lane flipped back to `external` can still carry the instance that its codex days enabled. After the removal nothing converges it until the next install, and meanwhile it rewrites the very `~/.cc-limits/<id>.json` that the removal deletes. The helper acts only when ccrc's own link exists, so a live external lane, which never had one, still asks no manager anything. C4 stands, and C14 pins both halves (`D-3727`). It never refuses: the roster is already dropped by then, so a failure is an operator step, and the next install converges it anyway.

**Why the lists are derived this way.**
- **Uninstall.** The hand list omitted `ccd-usage-sweep`'s pair, although the fixture planted it and `_uninst_units` removed it: a list with a hole is a green nobody earned (2b-1 item 19). A list derived from `_uninst_units` would drop a unit from both sides at once. So the absence list is WHAT THE FIXTURE PLANTED, read off the unit directory, and a derived check pins that the fixture plants every destination `_inst_units` names (`D-3728`).
- **deploy-verify.** Its `landed` list had missed the pool-sync, models and usage-sweep pairs (2b-1 item 20). It is derived from the chain the case actually runs, not from `_inst_units` (`D-3729`). install-census already requires every `_inst_units` unit on one of deploy.sh's lanes, and the agent lane deliberately places units `_inst_units` does not (`zz-no-memoryhigh.conf`, `protect.conf`) and withholds ones it does.

**Why deploy.sh places the pair, and enables none of it.** Spec §11: the fallback deploy carries what `ccrc install` places. install-census's install ⊆ deploy case would otherwise red once Task 6's one-commit withholding is deleted. Its deploy-enable case forbids arming any instance there: an instance is a lane's, armed by `ccrc install`'s converge. A deploy.sh-installed box with a codex lane therefore has the template and no instance, and doctor's "not enabled" WARN names `ccrc install`.

**Why the deploy.sh edits are line-neutral.**
- Tracked text cites `deploy.sh:<N>`: the frozen compaction-card corpus cites `:570` and `:648`, and Task 4 re-aims `ccrc-doctor-checks`' citations by quoted anchor on both lanes, and pins each anchor's presence in `deploy.sh`, so no anchor may leave it. The 2b-1 paragraph at `:817` exists because a citation corpus cited lines above it.
- The probe block is replaced by a note of the same length.
- The two new `_unit_atomic` links (+2) are paid for by shortening, by two lines, the paragraph they make false.
- Measured on `1f9fa22d`: no line inside `:815-825` is cited outside `docs/`.
- Step 5 proves the rest by content: every cited line's text is byte-identical before and after.

**Why the probe's PATH copy goes (R-C11).** ccrc runs `$CCRC_HERE/ccrc-models-probe` (`ccd/ccrc:9487`, `:9667`), never the PATH copy, and `ccrc install` never placed one. `ccrc update` never refreshes a PATH copy, so it goes stale. The live one already is: it predates Task 1, and reads lane one's OAuth directory for every lane, a codex lane included. After Task 1, ccrc's own copy keeps that default for an `external` lane only, until the lane's flip, and gives a codex lane its own `authDir` with no default (`D-3706`, as operator ruling Z redefines it). So the PATH copy is no longer the one reader with that default. It is the one copy that would hand it to a codex lane, if an operator ran it by hand. Removing the stale copy already on a box is Plan 4's. This is no deviation: spec §11 already has the fallback deploy mirror `ccrc install`, which never placed this copy (ruling R-C11).

**Why this is inert on the live box.**
- Boxes move by `ccrc rollout`/`update`, not by deploy.sh.
- Uninstall and account removal run only when an operator runs them.
- On the live shape, neither finds a `ccrc-codex-usage@` link, so neither asks the manager anything.

- [ ] **Step 0: Record the base, and measure the preconditions. Stop and report if any answer differs.**

```bash
. "<abs scratch>/plan3a-env.sh"
test -x "$CENSUS" || { echo "write the Global Constraints' census-run.sh first"; exit 1; }   # the plan's one census script (F10)
git rev-parse HEAD > "$SCRATCH/t7-base" && mkdir -p "$SCRATCH/t7-ev"   # every later step reads these back (F2)
git ls-files deploy/systemd | grep -c 'ccrc-codex-usage@'                       # 2 (Task 6)
grep -n "'ccrc-codex-usage@.service', 'ccrc-codex-usage@.timer'\]," server/test/install-census.test.ts   # 1 (Task 6's one-commit entry)
grep -n '^_codex_usage_enabled_ids() {' ccd/ccrc                                # 1 (Task 6)
grep -n 'install_atomic ccd/ccrc-models-probe' deploy/deploy.sh                 # 1 line, :674
sed -n 669p deploy/deploy.sh                                                    # "# The model-class registry's catalogue probe (spec §5), unconditional here"
grep -n "ccd-tmp-sweep.timer'\$" deploy/deploy.sh                              # 1 line, :815 (AGENT_BUILD_CMD's last link)
grep -n 'The chain above places NO' deploy/deploy.sh                            # 1 line, :822
wc -l < deploy/deploy.sh                                                        # 1257
git grep -noE 'deploy\.sh:[0-9]+' -- ':!docs' | sed 's/.*://' | sort -un | awk '$1>=815 && $1<=825'   # nothing
grep -n "ccrc-models-probe .local/bin/ccrc-models-probe 755" agent/test/deploy-verify.test.ts          # 1 line, :704
grep -n "^  for f in \"\$CCRC_LIMITS_DIR/\$id.json\"" ccd/ccrc                  # 1 line (_acct_remove)
```

Record the base's cited-line texts for Step 5:

```bash
. "<abs scratch>/plan3a-env.sh"; EV="$SCRATCH/t7-ev"
# Docs included, THIS PLAN excluded: it cites deploy.sh:674 and :822, the very
# lines Step 5d rewrites, so with it this census could never read as before.
git grep -hoE 'deploy\.sh:[0-9]+' -- ':!docs/superpowers/plans/2026-09-30-gpt-lane-ownership-3a-before-the-flip.md' | sed 's/.*://' | sort -un > "$EV/deploy-cited"
while read -r n; do printf '%s\t%s\n' "$n" "$(sed -n "${n}p" deploy/deploy.sh)"; done < "$EV/deploy-cited" > "$EV/cited-before"
```

- [ ] **Step 1: Write the failing tests in `server/test/ccrc-uninstall.test.ts`.**

1a. **The `systemctl` stub.** In `verbEnv`'s `plant('systemctl', [...])`, replace:

`'  disable) [ "$2" = "--now" ] && [ -n "$3" ] || { echo "fixture systemctl: unexpected argv: $*" >&2; exit 90; }; exit 0 ;;',`

with:

```ts
    '  disable)',
    '    [ "$2" = "--now" ] && [ -n "$3" ] || { echo "fixture systemctl: unexpected argv: $*" >&2; exit 90; }',
    // Plan 3a Task 7: an instance of ccrc's usage template is disabled the
    // way systemd disables one — its `timers.target.wants` link goes — and the
    // stub records whether the TEMPLATE was still on disk at that moment, so
    // "instances before the template" is a measurement.
    '    case "$3" in ccrc-codex-usage@*.timer)',
    '      t=absent; [ -e "$HOME/.config/systemd/user/ccrc-codex-usage@.timer" ] && t=present',
    '      printf \'%s template=%s\\n\' "$3" "$t" >> "$HOME/usage-disables"',
    '      rm -f -- "$HOME/.config/systemd/user/timers.target.wants/$3" ;;',
    '    esac',
    '    exit 0 ;;',
```

1b. **`plantInstalledBox`.** In its unit-file list, add a row after `'ccrc-update-watchdog.service', 'ccrc-update-watchdog.timer'`:

```ts
    // Plan 3a Task 6: ccrc's own usage pair, placed on fleet/both.
    'ccrc-codex-usage@.service', 'ccrc-codex-usage@.timer',
```

Mind the closing `]`: the new strings go inside the array, before `]) {`.

1c. **Two helpers.** Put them above `describe('ccrc uninstall: the remove set (spec §7)', …`:

```ts
/** Every regular file under the unit directory, relative to it, sorted —
 *  what `plantInstalledBox`, or a case, actually put there. */
function unitFilesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    for (const e of readdirSync(rel === '' ? dir : join(dir, rel), { withFileTypes: true })) {
      const r = rel === '' ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) walk(r);
      else if (e.isFile()) out.push(r);
    }
  };
  walk('');
  return out.sort();
}

/** Every unit file `_inst_units`' systemd arm places, relative to the unit
 *  directory, READ OUT OF ccd/ccrc (Plan 3a Task 7). Each is an
 *  `_inst_atomic` destination, `"$dir/<name>"` or `"$slice/<name>"`, with
 *  `$role_unit` read as both values the function gives it. Any other variable
 *  in a destination THROWS: a name this reader cannot resolve would drop out
 *  of the fixture check silently (install-census.test.ts's no-silent-drops
 *  rule). */
function instUnitsDestinations(): string[] {
  const body = ccrcFunction('_inst_units');
  const roles = [...body.matchAll(/\brole_unit=([A-Za-z0-9@._-]+)/g)].map((m) => m[1]!);
  if (roles.length < 2) throw new Error(`_inst_units gives role_unit ${roles.length} value(s), not the two this reader expects`);
  const slice = /\bslice="\$dir\/([^"]+)"/.exec(body);
  if (slice === null) throw new Error('_inst_units no longer names its slice drop-in directory as slice="$dir/…"');
  const out = new Set<string>();
  for (const m of body.matchAll(/_inst_atomic\s+"[^"]*"\s*(?:\\\n\s*)?"\$(dir|slice)\/([^"]+)"/g)) {
    const root = m[1]!; const rest = m[2]!;
    for (const n of rest === '$role_unit' ? roles : [rest]) {
      if (n.includes('$')) throw new Error(`_inst_units places "${m[0]}" through a variable this reader does not resolve — spell it literally, or teach it`);
      out.add(root === 'slice' ? `${slice[1]!}/${n}` : n);
    }
  }
  if (out.size < 10) throw new Error(`_inst_units read as only ${out.size} destinations — this reader has gone stale`);
  return [...out].sort();
}
```

1d. **Rewrite the `units:` case.** Replace the head of `itLinux('units: disable --now, delete every unit file incl. both drop-ins and the slice escape, daemon-reload — recording stub only', () => {`, from its first line through the `for … of [ … ]) { expect(existsSync(join(units, u)), \`${u} survived\`).toBe(false); }` loop, with:

```ts
  itLinux('units: every unit file the box had goes — read off the fixture, which must plant all of _inst_units — disable --now, daemon-reload last, recording stub only (Plan 3a Task 7; 2b-1 item 19)', () => {
    const home = mkTmp('ccrc-uninst-units-');
    plantInstalledBox(home);
    const units = join(home, '.config', 'systemd', 'user');
    const before = unitFilesUnder(units);
    // THE FIXTURE COVERS THE INSTALL. The hand-typed list this replaces named
    // every pair but `ccd-usage-sweep`'s, while the fixture planted it and the
    // uninstall removed it: a list with a hole is a green nobody earned.
    for (const u of instUnitsDestinations()) {
      expect(before, `plantInstalledBox does not plant ${u}, which _inst_units places — plant it, so its removal is measured`).toContain(u);
    }
    const r = runVerb(home, 'uninstall');
    expect(r.code, r.stderr).toBe(0);
    expect(before.filter((f) => existsSync(join(units, f))), 'these unit files survived the uninstall').toEqual([]);
```

Keep every line after that loop (the two drop-in-directory absences and the call assertions) as it is.

1e. **The instance sweep.** Add this `itLinux` to the same describe:

```ts
  itLinux('every ENABLED instance of ccrc\'s usage template is stopped and disabled while its template is still on disk, whatever the roster says (Plan 3a Task 7; spec §13, ruling R-C9)', () => {
    const home = mkTmp('ccrc-uninst-usage-instances-');
    plantInstalledBox(home);
    const units = join(home, '.config', 'systemd', 'user');
    const wants = join(units, 'timers.target.wants');
    mkdirSync(wants, { recursive: true });
    // Two instances, and `plantInstalledBox`'s roster is not even a roster
    // (`{"fixture":"roster"}`): the sweep reads the manager's links, never the roster.
    for (const id of ['codex-a', 'codex-b']) {
      symlinkSync(join(units, 'ccrc-codex-usage@.timer'), join(wants, `ccrc-codex-usage@${id}.timer`));
    }
    const r = runVerb(home, 'uninstall');
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(readFileSync(join(home, 'usage-disables'), 'utf8').split('\n').filter(Boolean), 'an instance was disabled after its template was gone, or not at all')
      .toEqual(['ccrc-codex-usage@codex-a.timer template=present', 'ccrc-codex-usage@codex-b.timer template=present']);
    expect(readdirSync(wants), 'an enabled instance survived the uninstall').toEqual([]);
    for (const u of ['ccrc-codex-usage@.service', 'ccrc-codex-usage@.timer']) {
      expect(existsSync(join(units, u)), `${u} survived`).toBe(false);
    }
    const calls = readFileSync(join(home, 'systemctl-calls'), 'utf8').split('\n').filter(Boolean);
    expect(calls.indexOf('--user disable --now ccrc-codex-usage@codex-a.timer')).toBeGreaterThan(-1);
    expect(calls[calls.length - 1]).toBe('--user daemon-reload');
    expect(r.stdout).toMatch(/^uninstall: units: 2 codex usage timer\(s\) stopped and disabled$/m);
  });
```

1f. **The foreign-pair case** (`uninstall removes the four GPT-lane executables and leaves a ccgpt-usage@ unit pair it never placed alone`):
- Retitle it `uninstall removes the four GPT-lane executables and ccrc's own usage pair and instance, and leaves a ccgpt-usage@ pair and instance it never placed alone (Plan 3a Task 7)`.
- In its comment, change `The usage-window publisher's\n  // \`ccgpt-usage@.{service,timer}\` pair is the other half of this case since\n  // 2b-1's final review, F-1: no installer places it, because` to `Another repository's\n  // \`ccgpt-usage@.{service,timer}\` pair is the other half of this case since\n  // 2b-1's final review, F-1: ccrc places its own under \`ccrc-codex-usage@\` (Plan 3a), because`.
- Directly after `symlinkSync(join(units, 'ccgpt-usage@.timer'), wants);`, insert:

```ts
    // ccrc's OWN instance for the SAME id, beside the foreign one.
    const ours = join(units, 'timers.target.wants', 'ccrc-codex-usage@codex-a.timer');
    symlinkSync(join(units, 'ccrc-codex-usage@.timer'), ours);
```

- Directly after `expect(readlinkSync(wants)).toBe(join(units, 'ccgpt-usage@.timer'));`, insert:

```ts
    expect(existsSync(ours) || (() => { try { lstatSync(ours); return true; } catch { return false; } })(),
      'ccrc\'s own usage instance survived the uninstall').toBe(false);
    for (const u of ['ccrc-codex-usage@.service', 'ccrc-codex-usage@.timer']) {
      expect(existsSync(join(units, u)), `ccrc's own ${u} survived`).toBe(false);
    }
```

- Its closing `not.toContain('ccgpt-usage')` stays.

- [ ] **Step 2: Write the failing account-removal cases in `server/test/ccrc-account.test.ts`.** Add `plantCodexUsage, plantForeignUsage` to the `./codexLaneFixture.js` import. Add this helper beside `plantLockProbe`:

```ts
/** Plan 3a Task 7: a marked `systemctl` stand-in, FIRST on PATH through
 *  `run()`'s extraEnv. It answers `--user disable --now ccrc-codex-usage@*.timer`
 *  by removing that timer's wants link, and records it. It records any argv
 *  naming `ccgpt-usage` to `usage-ctl-foreign`, and passes EVERY other call to
 *  this file's own stand-in at `~/.local/bin/systemctl`, whose poison still
 *  answers the lane library. */
function plantUsageCtl(home: string): string {
  const dir = join(home, 'usage-ctl');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'systemctl'), [
    '#!/bin/sh',
    MANAGER_STANDIN_MARK,
    'case " $* " in *" ccgpt-usage"*) printf \'%s\\n\' "$*" >> "$HOME/usage-ctl-foreign" ;; esac',
    'if [ "$1" = --user ] && [ "$2" = disable ] && [ "$3" = --now ]; then',
    '  case "$4" in ccrc-codex-usage@*.timer)',
    '    printf \'%s\\n\' "$*" >> "$HOME/usage-ctl-calls"',
    '    rm -f -- "$HOME/.config/systemd/user/timers.target.wants/$4"; exit 0 ;;',
    '  esac',
    'fi',
    `exec '${join(home, '.local', 'bin', 'systemctl')}' "$@"`,
  ].join('\n') + '\n', { mode: 0o755 });
  return dir;
}
const usageCtlCalls = (home: string): string[] =>
  (existsSync(join(home, 'usage-ctl-calls')) ? readFileSync(join(home, 'usage-ctl-calls'), 'utf8').split('\n').filter(Boolean) : []);
const lexists = (p: string): boolean => { try { lstatSync(p); return true; } catch { return false; } };
```

Add these three cases after C11, the describe's last case, inside `describe('ccrc account remove', …)`. They are C12–C14 because C7–C11 already exist there, and a reused label would select two cases at once:

```ts
  it('C12: removing a codex account disables ccrc\'s own usage timer for it, reports the link removed, keeps its OAuth and logs, and never names another repository\'s (Plan 3a Task 7)', async () => {
    const home = box('ccrc-account-remove-codex-usage-');
    const lane = await codexLaneOnFreePorts();
    seedRosterJson(home, [UPSTREAM, lane, HOMEABLE('team-shared', 'blue')]);
    for (const id of ['claude', 'team-shared']) plantLauncher(home, id);
    plantCodexLauncher(home);
    const auth = join(home, codexAuthDir(lane.id), 'auth.json');
    mkdirSync(path.dirname(auth), { recursive: true });
    writeFileSync(auth, '{"fixture":"oauth"}\n');
    const state = plantLaneState(home, lane);
    const { link } = plantCodexUsage(home, lane.id, { row: false });
    const foreign = plantForeignUsage(home, lane.id);
    const ctl = plantUsageCtl(home);
    plantTmux(home, []);
    const r = run(home, ['account', 'remove', '--id', lane.id], '', { PATH: `${ctl}:${env(home)['PATH'] ?? ''}` });
    expect(r.code, r.stderr).toBe(0);
    const j = oneObject(r);
    expect(usageCtlCalls(home)).toEqual([`--user disable --now ccrc-codex-usage@${lane.id}.timer`]);
    expect(lexists(link), 'ccrc\'s usage timer is still enabled for a removed account').toBe(false);
    expect(j['removed']).toContain(link);
    expect(lexists(foreign) && lstatSync(foreign).isSymbolicLink(), 'another repository\'s usage link was removed').toBe(true);
    expect(existsSync(join(home, 'usage-ctl-foreign')), 'a systemctl call named another repository\'s usage unit').toBe(false);
    expect(readFileSync(auth, 'utf8')).toBe('{"fixture":"oauth"}\n');
    for (const [f, bytes] of Object.entries(state.logs)) expect(readFileSync(f, 'utf8'), f).toBe(bytes);
  });

  it('C13: a usage timer the manager will not disable is an operator step, and the removal still completes', async () => {
    const home = box('ccrc-account-remove-codex-usage-refused-');
    const lane = await codexLaneOnFreePorts();
    seedRosterJson(home, [UPSTREAM, lane, HOMEABLE('team-shared', 'blue')]);
    for (const id of ['claude', 'team-shared']) plantLauncher(home, id);
    plantCodexLauncher(home);
    plantLaneState(home, lane);
    const { link } = plantCodexUsage(home, lane.id, { row: false });
    plantTmux(home, []);
    // No stand-in: this file's own systemctl poison refuses every call (97).
    const r = run(home, ['account', 'remove', '--id', lane.id]);
    expect(r.code, r.stderr).toBe(0);
    const steps = oneObject(r)['operator-steps'] as string[];
    expect(steps).toContain(`ccrc's usage timer ccrc-codex-usage@${lane.id}.timer is still enabled for the removed account ${lane.id}, so it may go on rewriting $HOME/.cc-limits/${lane.id}.json. Run: systemctl --user disable --now ccrc-codex-usage@${lane.id}.timer`);
    expect(lexists(link)).toBe(true);
    expect(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8')).not.toContain(`"${lane.id}"`);
  });

  it('C14: an EXTERNAL account still carrying the ccrc usage timer its codex days enabled has it disabled too — and asks the manager nothing else (C4 stands)', () => {
    const home = box('ccrc-account-remove-external-usage-');
    seedRosterJson(home, [UPSTREAM,
      { id: 'ext-a', label: 'lab·dev0', hue: 'amber', configDirSuffix: '.claude-ext-a', homeAble: false,
        telemetry: 'codex', exec: { kind: 'external', provider: 'openai' } },
      HOMEABLE('team-shared', 'blue')]);
    for (const id of ['claude', 'team-shared']) plantLauncher(home, id);
    plantLauncher(home, 'ext-a', '#!/bin/sh\n# somebody else wrote this\nexit 0\n');
    const { link } = plantCodexUsage(home, 'ext-a', { row: false });
    const ctl = plantUsageCtl(home);
    plantTmux(home, []);
    const r = run(home, ['account', 'remove', '--id', 'ext-a'], '', { PATH: `${ctl}:${env(home)['PATH'] ?? ''}` });
    expect(r.code, r.stderr).toBe(0);
    expect(usageCtlCalls(home)).toEqual(['--user disable --now ccrc-codex-usage@ext-a.timer']);
    expect(lexists(link)).toBe(false);
    expect(existsSync(join(home, 'systemctl-poison')), 'an external removal asked the manager anything else').toBe(false);
  });
```

- [ ] **Step 3: Write the failing census and deploy tests.**

3a. **`server/test/install-census.test.ts`:**
- Delete Task 6's one-commit entry from `DEPLOY_SH_WITHHOLDS.units`: its four comment lines and `'ccrc-codex-usage@.service', 'ccrc-codex-usage@.timer'`. Direction 2 reds until Step 4 lands deploy.sh's lines. That is this task's red-first.
- In the header's `AND AGAINST deploy.sh` paragraph, change `oversight: \`deploy.sh\` also places \`ccrc-api\` and \`ccrc-models-probe\`, which\n// \`ccrc install\` places nowhere —` to `oversight: \`deploy.sh\` also places \`ccrc-api\` (and placed \`ccrc-models-probe\`\n// until Plan 3a, ruling R-C11), which \`ccrc install\` places nowhere —`.
- In STATED SCOPE, change the bullet that begins `//   - The disable census reads literal \`systemctl --user … disable --now\` calls` so that its second sentence reads:

```ts
//   - The disable census reads literal `systemctl --user … disable --now` calls
//     only. `ccd/ccrc`'s `_svc_disable_now` helper, a separate stop-then-
//     disable, and `_uninst_codex_usage`'s per-INSTANCE disable of ccrc's
//     usage template (an instance name is built from an id at run time;
//     `ccrc-uninstall.test.ts` measures it) are not read, and a
//     system-manager `systemctl disable` (no `--user`) is not a user-unit
//     disable, so it does not count.
```

3b. **`agent/test/deploy-verify.test.ts`:**
- Add `readdirSync` to its `node:fs` import.
- Replace `    expect(deploySh).toContain('install_atomic ccd/ccrc-models-probe .local/bin/ccrc-models-probe 755');` (`:704`) with:

```ts
    // Plan 3a Task 7 (ruling R-C11): NO ~/.local/bin copy of the model probe.
    // ccrc runs its own tree's copy, which the rsync of `ccd/` lands; `ccrc
    // update` never refreshes a PATH copy, and a stale one reads lane one's
    // OAuth directory for a codex lane too. Code lines only, so the note that
    // replaced the call may say why.
    expect(deploySh.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
      .filter((l) => l.includes('ccrc-models-probe')), 'deploy.sh places a PATH copy of the model probe again').toEqual([]);
```

- In the `the unit files install ATOMICALLY` case, replace the whole `const landed: Array<[string, string]> = [ … ];` declaration with:

```ts
    // Every artifact the chain places, DERIVED FROM THE CHAIN THIS CASE JUST
    // RAN (Plan 3a Task 7; 2b-1 item 20), never typed: a unit `_unit_atomic`
    // gains is measured landing the day it is added. The hand list this
    // replaces named sixteen and had missed the pool-sync, models and
    // usage-sweep pairs while every case stayed green. From the chain and not
    // from `_inst_units` (D-3729):
    // install-census.test.ts already holds every `_inst_units` unit to one of
    // deploy.sh's lanes, and this lane places units `_inst_units` does not.
    const unitRoot = /^(?:~|\$HOME)\/\.config\/systemd\/user\//;
    const landed: Array<[string, string]> = [...script.matchAll(/(?:^|&&)\s*_unit_atomic\s+(\S+)\s+(\S+)/gm)]
      .map((m) => {
        const from = m[1]!.replace(/^"|"$/g, '');
        const to = m[2]!.replace(/^"|"$/g, '');
        if (!from.startsWith('~/ccrc/') || !unitRoot.test(to)) {
          throw new Error(`deploy-verify: a _unit_atomic call this reader cannot place: ${m[0]} — spell its source under ~/ccrc/ and its destination under ~/.config/systemd/user/, or teach this reader`);
        }
        return [to.replace(unitRoot, ''), join(src, from.slice('~/ccrc/'.length))] as [string, string];
      });
    expect(landed.length, 'the unit chain read as fewer calls than the hand list it replaced — this reader has gone stale')
      .toBeGreaterThanOrEqual(16);
    // THE ANCHOR, derived from the tree: every TEMPLATE unit file under
    // deploy/systemd lands on this lane — ccrc's usage pair today (Plan 3a) —
    // because a codex lane runs on the fleet host.
    const templates = readdirSync(join(deployDir, 'systemd')).filter((n) => /@\.[A-Za-z]+$/.test(n));
    expect(templates.length, 'deploy/systemd ships no template unit — this anchor would check nothing').toBeGreaterThanOrEqual(1);
    for (const t of templates) {
      expect(landed.map(([d]) => d), `${t} ships in deploy/systemd and the agent lane never places it`).toContain(t);
    }
```

  The `for (const [dest, from] of landed)` loop and the SENTINEL block below it stay unchanged, and now cover every derived pair.

3c. **`server/test/usage-sweep-deploy-ship.test.ts`.** Replace:

```ts
    // graph-noise-ship.test.ts pins the sweep and its noise list as
    // neighbours with three code lines of slack, already fully spent by
    // ccrc-models-probe, so this sibling (like ccd-account-auth) is placed
    // below the noise list instead.
```

with:

```ts
    // graph-noise-ship.test.ts pins the sweep and its noise list as
    // neighbours with three code lines of slack, which ccrc-models-probe
    // spent until Plan 3a stopped placing it (ruling R-C11); this sibling
    // (like ccd-account-auth) stays below the noise list all the same.
```

- [ ] **Step 4: Run the tests and watch them fail.** Each line is its own foreground Bash call from the tree root, with a timeout of at least 600000 ms (F6), and sources the env file itself (F2):

```bash
. "<abs scratch>/plan3a-env.sh"; cd server && "$CENSUS" "$SCRATCH/t7-ev/red-uninst" ./node_modules/.bin/vitest run test/ccrc-uninstall.test.ts
. "<abs scratch>/plan3a-env.sh"; cd server && "$CENSUS" "$SCRATCH/t7-ev/red-acct" ./node_modules/.bin/vitest run test/ccrc-account.test.ts -t 'C12|C13|C14|C4'
. "<abs scratch>/plan3a-env.sh"; cd server && "$CENSUS" "$SCRATCH/t7-ev/red-census" ./node_modules/.bin/vitest run test/install-census.test.ts
. "<abs scratch>/plan3a-env.sh"; cd agent && "$CENSUS" "$SCRATCH/t7-ev/red-dv" ./node_modules/.bin/vitest run test/deploy-verify.test.ts
```

Expected results:
- **`ccrc-uninstall.test.ts` reds:**
  - the instance-sweep case (`usage-disables` absent: nothing disabled the instances; the links survive);
  - the foreign-pair case (`ccrc's own usage instance survived`).

  GREEN, and stated: the rewritten `units:` case, because Task 6's `rm -f` already removes the pair and the fixture now plants every `_inst_units` destination. Its red is I3 and I4 (Step 8).
- **`ccrc-account.test.ts` reds:** C12 (no disable call), C13 (no operator step), C14 (no disable call). GREEN: C4.
- **`install-census.test.ts` reds:** `every systemd unit file _inst_units places, deploy.sh places too` (`ccrc-codex-usage@.service`, `ccrc-codex-usage@.timer`).
- **`deploy-verify.test.ts` reds:**
  - the probe absence pin (the call is still there);
  - the template anchor (`ccrc-codex-usage@.service ships in deploy/systemd and the agent lane never places it`).

  GREEN: the derived `landed` list, which now reads the pool-sync, models and usage-sweep pairs the hand list missed. Record its length.

- [ ] **Step 5: Implement.**

5a. **`ccd/ccrc`, the two helpers.** Insert them directly above `# Stop, disable, delete — in that order, because a unit file removed under a`:

```bash
# ── ccrc's usage INSTANCES, on the way out (Plan 3a Task 7; spec §13) ─────
# Every ENABLED instance of ccrc's own usage template, stopped and disabled
# while its template is still on disk — `_uninst_units` calls this BEFORE its
# `rm -f`, because a template removed under an enabled instance leaves systemd
# holding a dangling enablement (ruling R-C9). Found through the manager's own
# links (`_codex_usage_enabled_ids`), NEVER the roster: an uninstall must reach
# an instance whose lane the roster no longer names, and must work over a
# roster it cannot read. It never names another repository's `ccgpt-usage`
# unit, template or instance — those are not ccrc's (R2). ITS OWN FUNCTION,
# not a loop inside `_uninst_units`: install-census.test.ts reads every
# `disable --now` operand there as a literal unit name, and an instance name is
# built from an id at run time. A refusal is reported and the uninstall
# continues, as every `disable --now` in `_uninst_units` is.
_uninst_codex_usage() {
  local ids id u n=0 failed=0
  if ! ids="$(_codex_usage_enabled_ids)"; then
    echo "uninstall: units: ccrc's enabled codex usage timers could not be listed (the ccrc codex: line above says why), so none was disabled — the template is removed below; finish by hand: list \$HOME/.config/systemd/user/timers.target.wants/ccrc-codex-usage@*.timer, and run systemctl --user disable --now on each" >&2
    return 0
  fi
  for id in $ids; do
    u="$(_codex_usage_timer "$id")"
    if systemctl --user disable --now "$u"; then
      n=$((n + 1))
    else
      failed=$((failed + 1))
      echo "uninstall: units: disable --now $u failed (continuing — the template is removed below; read: systemctl --user status $u)" >&2
    fi
  done
  [ $((n + failed)) -eq 0 ] || echo "uninstall: units: $n codex usage timer(s) stopped and disabled"
}

# Account removal's usage half (Plan 3a Task 7): ccrc's own
# `ccrc-codex-usage@<id>.timer`, disabled if this box has it enabled — WHATEVER
# the row's kind (D-3727). A lane
# flipped back to external can still carry the instance its codex days enabled,
# and after the removal nothing converges it until the next install, while it
# rewrites the very ~/.cc-limits row the removal deletes. Found by the manager's
# own link, never the roster. Another repository's `ccgpt-usage@<id>.timer` is
# never touched or named in a systemctl call. Sets ACCT_USAGE_REMOVED (the link,
# once the disable MEASURABLY took it) or ACCT_USAGE_STEP (the operator step
# when it did not). It never refuses: by the time it runs the roster no longer
# names the id, and a oneshot poller holds no state the next install cannot
# converge. Every byte the manager says goes to stderr: `_acct_remove`'s
# stdout is one JSON object.
_acct_remove_usage() {   # <id>
  ACCT_USAGE_REMOVED=''; ACCT_USAGE_STEP=''
  local u; u="$(_codex_usage_timer "$1")"
  _codex_usage_enabled "$u" || return 0
  _codex_bus_defaults
  if systemctl --user disable --now "$u" >&2 && ! _codex_usage_enabled "$u"; then
    ACCT_USAGE_REMOVED="$(_codex_usage_wants)/$u"
    return 0
  fi
  ACCT_USAGE_STEP="ccrc's usage timer $u is still enabled for the removed account $1, so it may go on rewriting \$HOME/.cc-limits/$1.json. Run: systemctl --user disable --now $u"
}
```

5b. **`_uninst_units`.**
- Inside its `if command -v systemctl >/dev/null 2>&1; then` branch, directly after the `done` that closes the `disable --now` loop and before `  else`, insert:

```bash
    # Plan 3a Task 7: every ENABLED instance of ccrc's usage template, while
    # the template is still on disk (spec §13; ruling R-C9). Its own function:
    # `_uninst_codex_usage`'s header says why.
    _uninst_codex_usage
```

- In Task 6's comment above the `rm -f`, change `goes with the\n  # rest (Plan 3a).` to `goes with the\n  # rest, its enabled instances disabled above first (Plan 3a).`.

5c. **`_acct_remove`.** Insert ONE line directly above `  for f in "$CCRC_LIMITS_DIR/$id.json" "$_SVC_REG/$id-disabled" "$_SVC_REG/$id.hookstate.json"; do`:

```bash
  _acct_remove_usage "$id"; [ -z "$ACCT_USAGE_REMOVED" ] || removed+=("$ACCT_USAGE_REMOVED"); [ -z "$ACCT_USAGE_STEP" ] || operator_steps+=("$ACCT_USAGE_STEP")
```

It sits before the limits-file removal, so a poller cannot recreate the row the removal is about to delete. Its reasons are in the helper's header, which sits below the corpus anchors, so this function grows by one line only.

5d. **`deploy/deploy.sh`.** Five edits, each quoted exactly.

(1) Replace `:669-674`, six lines:

```bash
  # The model-class registry's catalogue probe (spec §5), unconditional here
  # exactly as its two siblings above: the agent lane only ever ships to a
  # fleet host, so there is no server-role branch to gate it against. The
  # rsync of `ccd/` above ALSO lands it at ~/ccrc/ccd/, which is where the
  # verbs resolve it from; this copy is the one an operator can run by hand.
  install_atomic ccd/ccrc-models-probe .local/bin/ccrc-models-probe 755
```

with six lines:

```bash
  # NO ~/.local/bin COPY OF THE MODEL-CLASS CATALOGUE PROBE (Plan 3a Task 7,
  # ruling R-C11). ccrc runs its own tree's copy, which the rsync of `ccd/`
  # above lands at ~/ccrc/ccd/. `ccrc update` never refreshes a PATH copy, and
  # a stale one reads lane one's OAuth directory for a codex lane too. An old
  # copy is removed by hand at the box cleanup (Plan 4). This note is as long
  # as the lines it replaced, so no line this file's readers cite moves.
```

(2) `:696-697`. Replace:

```bash
  # follows it" — with three code lines of slack, and `ccrc-models-probe` had
  # already spent one of them. Inserting here instead of there costs nothing:
```

with:

```bash
  # follows it" — with three code lines of slack, and `ccrc-models-probe` spent
  # one of them until Plan 3a stopped placing it. Inserting here costs nothing:
```

(3) `:712-713`. Replace:

```bash
  # the noise list as neighbours with three code lines of slack, and
  # `ccrc-models-probe` already spends one of them.
```

with:

```bash
  # the noise list as neighbours with three code lines of slack, of which
  # `ccrc-models-probe` spent one until Plan 3a stopped placing it.
```

(4) `:815`, `AGENT_BUILD_CMD`'s last link. Replace:

```bash
    && _unit_atomic ~/ccrc/deploy/systemd/ccd-tmp-sweep.timer ~/.config/systemd/user/ccd-tmp-sweep.timer'
```

with:

```bash
    && _unit_atomic ~/ccrc/deploy/systemd/ccd-tmp-sweep.timer ~/.config/systemd/user/ccd-tmp-sweep.timer \
    && _unit_atomic ~/ccrc/deploy/systemd/ccrc-codex-usage@.service ~/.config/systemd/user/ccrc-codex-usage@.service \
    && _unit_atomic ~/ccrc/deploy/systemd/ccrc-codex-usage@.timer ~/.config/systemd/user/ccrc-codex-usage@.timer'
```

(5) `:822-825`, four lines, originally. Replace:

```bash
  # The chain above places NO `ccgpt-usage@.{service,timer}`, and neither does
  # `ccd/ccrc`'s `_inst_units`: a live fleet box already has a unit pair at those
  # names, owned by another repository and with an instance enabled, so placing
  # ours is the cutover, which is Plan 3's. The files ship in the tree only.
```

with two lines:

```bash
  # The chain above places ccrc's OWN usage pair, `ccrc-codex-usage@`, never
  # `ccgpt-usage@` (another repo's), and arms none: `ccrc install` does, per lane.
```

5e. **Check the syntax, and prove the line-neutrality by content:**

```bash
. "<abs scratch>/plan3a-env.sh"; EV="$SCRATCH/t7-ev"
bash -n ccd/ccrc && bash -n deploy/deploy.sh && echo syntax-ok
[ "$(wc -l < deploy/deploy.sh)" -eq 1257 ] && echo 'deploy.sh length unchanged (1257)'
while read -r n; do printf '%s\t%s\n' "$n" "$(sed -n "${n}p" deploy/deploy.sh)"; done < "$EV/deploy-cited" > "$EV/cited-after"
diff "$EV/cited-before" "$EV/cited-after" && echo 'every cited deploy.sh line reads byte-for-byte as before'
```

A difference here means a cited line lands inside one of the five edits. Stop and report it. Do not re-aim a citation to make this pass.

- [ ] **Step 6: The citation census (S6-R11).** This task's one `_acct_remove` line sits above `ccd/ccrc:11635`, the frozen corpus's highest `ccd/ccrc` anchor. One foreground call from the tree root:

```bash
. "<abs scratch>/plan3a-env.sh"; cd server && "$CENSUS" "$SCRATCH/t7-ev/s6" ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored'
```

- **Green:** record it. Nothing to repair.
- **Red:** repair it by S6-R11 in this task's commit.
  1. Re-point README anchors by CONTENT first.
  2. Then re-measure every other red assertion by dumping:
     - back up the edited `ccd/ccrc` to `$SCRATCH/t7-ev/s6-backup/ccrc` (F7), and run `git show "$(cat "$SCRATCH/t7-base")":ccd/ccrc > ccd/ccrc`;
     - insert `fs.writeFileSync(path.join(process.env.S6_DUMP!, '<case>.json'), JSON.stringify(<the asserted expression>, null, 1));` above each red assertion;
     - run with `S6_DUMP="$SCRATCH/t7-ev/s6-base"` (made first, with `mkdir -p`), restore `ccd/ccrc` from its backup and check it with `cmp`, and run with `S6_DUMP="$SCRATCH/t7-ev/s6-task"`. Each act is its own call that first sources `plan3a-env.sh` (F2), and each run goes through `"$CENSUS"`;
     - `diff` the two dumps.
  3. Paste the TASK values into the assertions in the instrument's own order. Never retype an anchor.
  4. Append one paragraph to that assertion's comment naming the references that entered and left, and the cause: "Plan 3a Task 7's one-line insert into `_acct_remove`; no corpus document edited, no rule changed — S6-R11, no deviation".
  5. Remove every probe line. `git diff server/test/session-hook.test.ts` must show only the census values and that paragraph.

- [ ] **Step 7: Run everything green.** Each line is its own foreground Bash call from the tree root, with a timeout of at least 600000 ms (F6), and sources the env file itself (F2):

```bash
. "<abs scratch>/plan3a-env.sh"; cd server && "$CENSUS" "$SCRATCH/t7-ev/g-uninst" ./node_modules/.bin/vitest run test/ccrc-uninstall.test.ts
. "<abs scratch>/plan3a-env.sh"; cd server && "$CENSUS" "$SCRATCH/t7-ev/g-acct" ./node_modules/.bin/vitest run test/ccrc-account.test.ts
. "<abs scratch>/plan3a-env.sh"; cd server && "$CENSUS" "$SCRATCH/t7-ev/g-census" ./node_modules/.bin/vitest run test/install-census.test.ts
. "<abs scratch>/plan3a-env.sh"; cd server && "$CENSUS" "$SCRATCH/t7-ev/g-install" ./node_modules/.bin/vitest run test/ccrc-install.test.ts
. "<abs scratch>/plan3a-env.sh"; cd server && "$CENSUS" "$SCRATCH/t7-ev/g-ship" ./node_modules/.bin/vitest run test/graph-noise-ship.test.ts test/usage-sweep-deploy-ship.test.ts test/ccrc-api-ship.test.ts test/compact-card-ship.test.ts test/tmp-sweep.test.ts
. "<abs scratch>/plan3a-env.sh"; cd server && "$CENSUS" "$SCRATCH/t7-ev/g-skills" ./node_modules/.bin/vitest run test/install-coordinator-skill.test.ts test/install-worker-skill.test.ts test/install-reviewer-skill.test.ts
. "<abs scratch>/plan3a-env.sh"; cd server && "$CENSUS" "$SCRATCH/t7-ev/g-deploy" ./node_modules/.bin/vitest run test/deploy-coordinates.test.ts test/deploy-env-guard.test.ts test/fleet-build-skew.test.ts test/buildinfo.test.ts test/lifecycle.test.ts test/pools-prose.test.ts test/timer-first-run.test.ts test/license.test.ts
. "<abs scratch>/plan3a-env.sh"; cd server && "$CENSUS" "$SCRATCH/t7-ev/g-auth" ./node_modules/.bin/vitest run test/ccd-account-auth.test.ts -t 'the agent deploy ships it'
. "<abs scratch>/plan3a-env.sh"; cd server && "$CENSUS" "$SCRATCH/t7-ev/g-anchor" ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'cites deploy.sh by anchor'
. "<abs scratch>/plan3a-env.sh"; cd server && "$CENSUS" "$SCRATCH/t7-ev/g-scans" ./node_modules/.bin/vitest run test/single-definition.test.ts test/macos-platform.test.ts test/topology-clean.test.ts
. "<abs scratch>/plan3a-env.sh"; cd server && "$CENSUS" "$SCRATCH/t7-ev/g-tc" ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
. "<abs scratch>/plan3a-env.sh"; cd server && "$CENSUS" "$SCRATCH/t7-ev/g-cite" ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored'
. "<abs scratch>/plan3a-env.sh"; cd agent && "$CENSUS" "$SCRATCH/t7-ev/g-dv" ./node_modules/.bin/vitest run test/deploy-verify.test.ts test/build-fp.test.ts
```

The deploy.sh readers were measured with `git grep -l 'deploy.sh' -- server/test agent/test`, whose ~50 hits mostly only name the file. The list keeps every suite that reads it: `license.test.ts` reads the whole file for the old org name, and `ccd-account-auth.test.ts`' 'the agent deploy ships it' locates `install_atomic ccd/ccd-account-auth` directly below the D-2600 note that edit (2) rewrites. Re-run that grep at execution, and add any new reader to the list. `g-anchor` is Task 4's describe 'ccrc-doctor-checks cites deploy.sh by anchor, never by line', which pins every anchor this task's edits must keep.

Also expect:
- The server-case counts to rise by exactly: `ccrc-uninstall` +1 (the instance sweep); `ccrc-account` +3 (C12, C13, C14); `install-census` 0; `deploy-verify` 0, since its assertions change inside existing cases. Record them. `deploy-verify`'s derived `landed` length: record it. It is ≥ 16 and includes both `ccrc-codex-usage@` files.
- `graph-noise-ship`'s sweep-to-list distance to read 2, which is within its 3.

- [ ] **Step 8: Mutation table, measured both ways.** Take `git add -A && git commit -m 'wip: task 7'` first. Then each row is four acts, as in Task 6 Step 8, and each Bash act is its own call (F2, F6, F7):
  1. **Back up every file the row edits**, one copy per file, with the first block below. I1, I2, I3, I5, A1, A2 and A3 edit `ccd/ccrc`; I4 `server/test/ccrc-uninstall.test.ts`; **A4 edits two**, `ccd/ccrc` and `server/test/ccrc-account.test.ts` (the stub), so it takes two backups; P1, P3, P4 and P5 `deploy/deploy.sh`; P2 `server/test/install-census.test.ts`.
  2. **Mutate** exactly as the row says, and nothing else.
  3. **Run each named suite as its own call**, `. "<abs scratch>/plan3a-env.sh"; cd server && "$CENSUS" "$SCRATCH/t7-ev/mut-<row>-<suite>" ./node_modules/.bin/vitest run test/<suite>.test.ts` (`cd agent` for deploy-verify), and record *failing / total*.
  4. **Restore from the backups** with the second block, which verifies the restore with `git diff --quiet` against the WIP commit. Then re-run the same suites and record *failing / total* after the restore.

```bash
. "<abs scratch>/plan3a-env.sh"; ROW=A4; FILES=(ccd/ccrc server/test/ccrc-account.test.ts)   # back up: ROW and FILES from the row
for f in "${FILES[@]}"; do mkdir -p "$SCRATCH/t7-mut/$ROW/$(dirname "$f")" && cp -p -- "$f" "$SCRATCH/t7-mut/$ROW/$f" || exit 1; done; echo "backed up ${#FILES[@]} file(s) for $ROW"
```

```bash
. "<abs scratch>/plan3a-env.sh"; ROW=A4; FILES=(ccd/ccrc server/test/ccrc-account.test.ts)   # restore: the same ROW and FILES as its backup
for f in "${FILES[@]}"; do cp -p -- "$SCRATCH/t7-mut/$ROW/$f" "$f" || exit 1; done
git diff --quiet -- "${FILES[@]}" && [ -z "$(git status --porcelain)" ] && echo "restored $ROW" || echo "NOT restored: stop and report"
```

If a mutation does not red, **report that it does not**.

| # | Guard | Mutation | Must red |
|---|---|---|---|
| I1 | the sweep runs | delete the `_uninst_codex_usage` call in `_uninst_units` | ccrc-uninstall: the instance sweep (no `usage-disables`, links survive), and the foreign-pair case (ccrc's instance survived) |
| I2 | instances before the template | move the call below the `rm -f … \|\| _ccrc_die` line (outside the systemctl branch, guarded by `command -v systemctl`) | ccrc-uninstall: the instance sweep (`template=absent`) |
| I3 | the derived absence | drop `"$dir/ccd-usage-sweep.service" "$dir/ccd-usage-sweep.timer"` from `_uninst_units`' `rm -f` | ccrc-uninstall: the `units:` case (`these unit files survived`). install-census: "every systemd unit file the install spine places is removed". |
| I4 | the fixture covers `_inst_units` | remove `'ccd-usage-sweep.service', 'ccd-usage-sweep.timer'` from `plantInstalledBox` | ccrc-uninstall: the `units:` case (`plantInstalledBox does not plant ccd-usage-sweep.service`) |
| I5 | the reader resolves | spell one `_inst_units` destination `"$dir/$u"` (as a mutation only) | ccrc-uninstall: THROWS `through a variable this reader does not resolve` |
| A1 | removal disables | delete the `_acct_remove_usage …` line in `_acct_remove` | ccrc-account: C12 and C14 |
| A2 | the operator step | make `_acct_remove_usage` `return 0` right after its failed `systemctl` (drop the `ACCT_USAGE_STEP=` line) | ccrc-account: C13 |
| A3 | never a foreign unit | add `systemctl --user disable --now "$(_codex_usage_foreign "$1")" >&2` to `_acct_remove_usage` | ccrc-account: C12 (`usage-ctl-foreign` written) |
| A4 | measured, not assumed | drop `&& ! _codex_usage_enabled "$u"` in `ccd/ccrc`, and make `plantUsageCtl`'s stub in `server/test/ccrc-account.test.ts` answer 0 without removing the link (two files, two backups) | ccrc-account: C12 (`link` in `removed` while it still exists) |
| P1 | deploy.sh places the pair | delete the two new `_unit_atomic` links (restore `:815`'s closing quote) | install-census: install ⊆ deploy. deploy-verify: the template anchor. |
| P2 | the one-commit withhold is gone | re-add Task 6's `DEPLOY_SH_WITHHOLDS` entry | install-census: direction 2 (`ARE placed by deploy.sh now`) |
| P3 | no instance armed by deploy.sh | add `systemctl --user enable --now ccrc-codex-usage@codex-a.timer` to `AGENT_CMD`'s enable chain | install-census: the deploy-enable case |
| P4 | the probe stays off PATH | re-add `  install_atomic ccd/ccrc-models-probe .local/bin/ccrc-models-probe 755` | deploy-verify: the probe absence pin |
| P5 | the derived chain reader | add a `_unit_atomic ~/elsewhere/x.timer ~/.config/systemd/user/x.timer` link to `AGENT_BUILD_CMD` | deploy-verify: THROWS `cannot place` (and install-census reads it as an untracked source) |

- [ ] **Step 9: Post-conditions.**

They run after Step 8's WIP commit, which is the task's own commit (Step 10 only rewrites its message), so every diff reads `git diff "$BASE" HEAD` over a clean tree (F3).

```bash
. "<abs scratch>/plan3a-env.sh"; BASE="$(cat "$SCRATCH/t7-base")"
git rev-parse -q --verify "$BASE^{commit}" >/dev/null && [ -z "$(git status --porcelain)" ] || { echo 'no t7 base, or the tree is not the WIP commit: stop'; exit 1; }
git diff --quiet "$BASE" HEAD -- ccd/ccd ccd/ccgpt-runtime ccd/ccgpt-proxy.py ccd/ccrc-models-probe && echo cut-ok
git diff -U0 "$BASE" HEAD -- ccd/ccrc | grep -v '^+++ ' | grep -c '^+'   # the two helpers, the _uninst_units call and its comment, and ONE _acct_remove line
[ "$(git show "$BASE":deploy/deploy.sh | wc -l)" -eq "$(git show HEAD:deploy/deploy.sh | wc -l)" ] && echo deploy-length-neutral
```

Residue: the same scan as Task 6 Step 9, over this task's added lines, from the file Task 6 Step 9 built (F1, F4). Its stops and its `residue:` rule are Task 6 Step 9's.

```bash
. "<abs scratch>/plan3a-env.sh"; BASE="$(cat "$SCRATCH/t7-base")"; LIVE="$SCRATCH/plan3a-live-values"
test -s "$LIVE" || { echo 'plan3a-live-values missing or empty: build it as Task 6 Step 9 says'; exit 1; }
git rev-parse -q --verify "$BASE^{commit}" >/dev/null && [ -z "$(git status --porcelain)" ] || { echo 'no t7 base, or the tree is not the WIP commit: stop'; exit 1; }
# Decoded only into grep's pattern stream; each value literal, bounded by anything but [[:alnum:]_-].
pats() { while IFS= read -r l; do printf '%s' "$l" | base64 -d | sed 's/[][\.*^$+?(){}|]/\\&/g; s/.*/(^|[^[:alnum:]_-])&([^[:alnum:]_-]|$)/'; echo; done < "$LIVE"; }
git diff "$BASE" HEAD | command grep '^+' | command grep -qEf <(pats); rc=$?
[ "$rc" -eq 1 ] && echo residue-clean
[ "$rc" -eq 0 ] && git diff --name-only "$BASE" HEAD | while IFS= read -r f; do
  n=$(git diff "$BASE" HEAD -- "$f" | command grep '^+' | command grep -cEf <(pats)); [ "$n" -eq 0 ] || echo "residue: $f: $n added line(s) carry a live value"
done
[ "$rc" -le 1 ] || echo "residue: the scan did not run (grep rc $rc)"
```

- [ ] **Step 10: Commit.** Amend the WIP commit:

```bash
git add ccd/ccrc deploy/deploy.sh server/test/ccrc-uninstall.test.ts server/test/ccrc-account.test.ts \
  server/test/install-census.test.ts server/test/usage-sweep-deploy-ship.test.ts agent/test/deploy-verify.test.ts
# plus README.md and server/test/session-hook.test.ts only if Step 6 repaired the census
git commit --amend -F - <<'EOF'
feat(gpt-lane): uninstall, account removal and deploy.sh carry the usage pair; two hand lists derived; no PATH copy of the probe

Uninstall disables every enabled ccrc-codex-usage@ instance while its template
is still on disk, found by the manager's own links and never the roster, then
removes the pair (spec §13, R-C9); it never names a ccgpt-usage unit. Account
removal disables ccrc's instance for the removed id whatever the row's kind
(D-3727), reports the link as
removed once it measurably went, and turns a refusal into an operator step.

deploy.sh's agent lane places the pair and arms none, and no longer places
~/.local/bin/ccrc-models-probe (R-C11).
Both deploy.sh edits are line-neutral: every cited line reads as before.

The uninstall suite's absence list is what the fixture planted, and the
fixture must plant every _inst_units destination
(D-3728; 2b-1 item 19, which
missed ccd-usage-sweep). deploy-verify's landed list is the chain's own
_unit_atomic operands, with a template anchor
(D-3729; 2b-1 item 20).
DEPLOY_SH_WITHHOLDS loses Task 6's one-commit entry.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Before pushing, check `git log -1 --format='%an <%ae>'` against the repository's identity rule. Put the Step 4 and Step 8 counts in the PR body.

**What this task deliberately does NOT do** (reject any of these as scope creep):
- It removes no stale `~/.local/bin/ccrc-models-probe` from any box. Only an operator's act at Plan 4's cleanup does that.
- It does not remove the `ccrc-api` placement (2b-1 item 21's other half, deferred).
- It adds no instance enable to deploy.sh. install-census forbids one.
- It never disables, reads or removes a `ccgpt-usage*` unit or link. C12 and the foreign-pair case pin that.
- It adds no `--purge` rule: `~/.cc-limits` stays out of every sweep.
- It re-aims no `deploy.sh:<N>` citation. The edits are neutral, and Step 5e proves it.
- It changes `deploy-verify.test.ts:578` in no way (Files: unchanged, measured).

**Hazards a later task or plan must respect:**
1. **The deploy.sh length budget is spent.** Any later insert above `:826` moves every citation below it. Task 4's re-aimed `ccrc-doctor-checks` citations are quoted anchors on both lanes, and its 'cites deploy.sh by anchor' describe reds if one leaves. Re-run Step 5e's content census after any deploy.sh edit.
2. **`_acct_remove` changes the S6-R11 census.** Every later task that inserts into `ccd/ccrc` above `:11635` pays the same census in its own commit.
3. **An instance is disabled only where ccrc can see its link.** An instance enabled under another target is invisible to uninstall too, as Task 6's helpers' header states.
4. **3b's rollback order.** `ccrc codex stop <id>`, the roster flip back, then `ccrc install` withdraws ccrc's instance. Re-enable the other repository's timer after that, never before, or the converge degrades (Task 6, hazard 5). The flip back also returns the lane to the external path, which operator ruling Z keeps byte for byte. From then on the hourly refresh probes that lane's class registry through the token-directory default, lane one's OAuth directory (Z1, `D-3706`). While any codex row remains, the external arm refuses instead of running the other repository's stop (Z4, `D-3753`). Z3 refuses only a NEW codex registry on an external lane, and the one the lane used as a codex lane survives the flip back. So for any lane but the first, a flip back with that registry in place reopens the wrong-lane probe that Z3 keeps out of a new one. 3b's rollback must say what becomes of that registry before the flip back; this plan ships nothing for it.


### Task 8: `doctor --fix` for a codex lane and its launcher; the publisher's absent-file remedy tells the truth

> Resolved by the controller rulings (Task 8):
> - R-C8 (adopted by R5): the FAIL-only contract stays. `cmd_doctor` runs a fixer only on rc 1, so a WARN never reaches one. The missing-usage-timer WARN names `ccrc install` (`D-3721`), and this task pins the contract rather than changing it.
> - R7: lane.json that is stale against the class registry is measured by Task 4's check-only `materialise` and cured here.
> - R8: `--fix` regenerates a launcher only when ccrc's marker still verifies (`D-3730`).
> - R11: every suite command runs inside the census wrapper.
> - R12, R13: slugs only, fixtures only.

**Files:**
- Modify: `ccd/ccrc-doctor-checks`
  - New `_fix_wrappers`, directly after `_check_wrappers`' closing brace and above the `# ── skills — every rostered home carries the SHIPPED skills` header. Measured today: `_check_wrappers` is :2421-2889. Locate with `grep -n '^_check_wrappers() {' ccd/ccrc-doctor-checks`, then the first column-0 `}` after it.
  - New `_fix_codex`, directly after `_check_codex`'s closing brace. `_check_codex` is Task 4's; locate with `grep -n '^_check_codex() {' ccd/ccrc-doctor-checks`.
- Modify: `ccd/ccrc`, the usage text's `doctor` entry. Measured at :2013-2014; locate with `grep -n -- '--fix cures the checks that know how' ccd/ccrc`. Its two lines are rewritten in place, so no line moves.
  - `cmd_doctor` (:3273-3395, fixer guard at :3312) is **not** modified (R-C8).
- Modify: `ccd/ccgpt-usage.py`, every edit line-neutral:
  - `_read_lane`'s absent-file refusal (:255-259);
  - the four docstring sentences that say doctor has no `lane.json` arm: :24-29, :241-250, :280 and :319 (`grep -n "doctor has no\|Doctor renders no\|Plan 3's to settle" ccd/ccgpt-usage.py`).
- Modify: `server/test/ccrc-doctor.test.ts`:
  - its imports (`node:fs` at :44-47, and the module imports after `./fixtures/poolRule.js` at :54);
  - four describes appended at the end of the file (last describe today: `ccrc doctor: memory`, :8495).
- Modify: `server/test/ccgpt-usage.test.ts`: the absent-file case (:443-470, whose pin is :463) and two comments that go stale (:787-788, :819-820).
- Test: those two files.

**Interfaces:**
- Consumes:
  - Task 4:
    - `_check_codex` and its table entry `codex` (after `models`). It FAILs on:
      - a GPT-lane executable missing or drifted from `$BOX_TREE_DIR/ccd`;
      - a `ccgpt-runtime check` refusal;
      - lane.json absent, or stale against the roster (`_codex_lane_json_state`) or against the registry (R7);
      - litellm.yaml stale;
      - an absent authDir, with a remedy naming `ccrc codex login <id>`;
      - invalid or colliding ports.
    - `CODEX_LANE_BINS`: Task 4's ONE declaration, in `ccd/ccrc-doctor-checks`, of the four GPT-lane executables `_check_codex` compares, in `_inst_bins`' order. It may be a bash array or a word list; this task reads it as `${CODEX_LANE_BINS[*]}`, and `checksDecl` below reads either shape.
    - R7's check-only `materialise`, as Task 4 spells it (D-3712): `node deploy/models-op.mjs materialise --file <roster> --id <id> --check true` writes nothing and answers `{"ok":true,"op":"materialise","id":…,"check":true,"changed":{"lane":<bool>|null,"classes":<bool>,"effort":<bool>}|null}`. Without `--check` it writes, as before, and answers today's `{"ok":true,"op":"materialise","id":…,"wrote":{…}|null}`.
    - `healthyCodexBox(prefix)` as Tasks 4-6 leave it (synchronous or not; `await` takes both). It returns a HOME on which `_check_codex` prints no FAIL, with:
      - one lane `codex-a`;
      - the four GPT-lane files at `$HOME/ccrc/ccd` and at `$HOME/.local/bin`;
      - `$HOME/ccrc/deploy/models-op.mjs` and the LiteLLM template;
      - a class registry and a catalogue;
      - lane.json and litellm.yaml current;
      - an authDir;
      - a fake runtime whose `ccgpt-runtime check` passes;
      - no tier running.
    - The slug `D-3711`.
  - Task 5: `_check_codex`'s tier arm FAILs a listener that answers as something else, and signals nothing.
  - Task 6: the usage-timer WARN row, whose remedy names `ccrc install` and never `doctor --fix`. This task's remedy scan pins that.
  - Plan 2b-2, shipped:
    - `_inst_atomic` (ccd/ccrc:13358), `_inst_codex_tiers` (:14564), `_models_litellm_lane_held` (:9882);
    - `_codex_lock` and `_codex_unlock` (:11140, :11170), `_codex_row` (:10394), `_codex_lane_json_state` (:10463), `_codex_lanes` (:10369);
    - `_codex_runtime_cli` (:10290), `_models_node` (:1268), `_models_roster_path` (:9369), `_box_env_value` (:2726), `_ccrc_die` (:2336).
    - From `codexLaneFixture.ts`: `GPT_LANE_BINS`, `ccrcFunction`, `ccrcLine`, `lockStub`, `isolationManagerStubs`, `assertIsolationWallFirst`, `strayManagerCalls`, `freeLanes`, `spawnListener`, `alive`, `portAccepts`, `killLaneProcesses`, `authDirOf`. From `ccgptHarness.ts`: `pythonOrSkip`.
  - Global Constraints: `plan3a-env.sh`, which every bash block below sources first, because no variable, function or `cd` survives from one Bash call to the next. From it come `$CENSUS`, the plan's one census script (`"$CENSUS" <evidence-dir> <command…>`, R11), and `$EVID`, the evidence root, which is not under `/tmp/ccrc-*`.
- Produces:
  - `_fix_codex` and `_fix_wrappers` in `ccd/ccrc-doctor-checks`, with the exact `FIX codex:` and `FIX wrappers:` lines quoted in Step 3.
  - The publisher's absent-file refusal: `ccgpt-usage: refusing to publish — <path> does not exist; run \`ccrc doctor --fix\` (no class registry yet: \`ccrc models <id> init codex\`)`.
  - Test helpers in `ccrc-doctor.test.ts`: `fixerNames()`, `checksFunction(name)`, `checksDecl(name)`, `runFixCodex(case)`. Task 10 may reuse them.

**Why:**
- **What a fixer is, measured.** `cmd_doctor` runs `_fix_<name>` only when `--fix` is set, the check returned 1, and the fixer exists (ccd/ccrc:3312). It prints the measured FAIL, then the fixer's `FIX <name>:` lines, then runs the check again. The summary counts the second answer only (:3313-3319). The fixer runs in doctor's OWN shell (`"_fix_$name" || true`), unlike the check, which runs in a subshell. The one precedent is `_fix_skills` (doctor-checks:3018), whose rule spec §12 adopts: re-run the shipped tree's own installer, and let the re-measurement be the verdict.
- **R-C8 keeps that contract, and this task pins it.** Spec §12 lists "enable a missing usage timer" among `--fix`'s powers, but that row is a WARN, and a WARN never reaches a fixer. So the timer's one enabler stays `ccrc install`'s converge (Task 6), the row's remedy names `ccrc install`, and `_fix_codex` enables and disables nothing (`D-3721`). Two new guards make the contract a mechanism rather than a comment:
  - a runner case shows a WARN's fixer never runs and a FAIL's does;
  - a scan of every `_dr_warn`/`_dr_fail` call site shows that a remedy naming `ccrc doctor --fix` belongs to a FAIL whose check has a fixer. A WARN never names it, and a fixer-less FAIL never promises one. (164 call sites today, and exactly one names `--fix`: skills' FAIL.)
- **What `_fix_codex` cures, row by row against §12:**
  - "restore a ccrc-owned executable from the shipped tree": `_inst_atomic`, the primitive `_inst_bins` places the four with (ccd/ccrc:13562-13566). It is called per file only when the placed copy is missing, not executable, or not `cmp`-identical, so a converged file is not rewritten (pinned on mtime).
  - "rebuild and re-probe a staged runtime": `ccgpt-runtime build`, only when `ccgpt-runtime check` refuses. That is R-C5's trust-the-stamp rule (`D-3711`), and a current runtime is never rebuilt.
  - "re-render lane.json": models-op's `materialise` without `--check`, the ONE writer. It runs when lane.json is stale against the roster (`_codex_lane_json_state`, which compares the roster row only, ccd/ccrc:10463-10480) or against the registry (R7's `materialise --check true`). An answer the fixer cannot read counts as stale, never as current. `_codex_lane_json_ensure` is NOT the cure: it short-circuits on `current` (:10493), and `current` is a roster-only measurement, so it could never cure R7's case.
  - "re-render the LiteLLM config": `_models_litellm_lane_held` (:9882), the codex arm's own body. Its phase-1 compare makes a converged file a no-op. Its identity gate stops and starts only a tier it proves this lane's, and refuses `tier-foreign` or `tier-unmeasured` otherwise, having written nothing. Its precondition is the lane lock, which this fixer holds.
  - "restart a verified ccrc-owned active tier": `_inst_codex_tiers` (:14564), the install step that restarts a tier only when it is this lane's own, running (`_codex_tier_ours` 0) and stale. It runs only when step 1 or 2 replaced code a running tier may hold. The litellm render restarts its own tier itself, and a stale-tier WARN alone never reaches this function.
  - "regenerate a marker-verified launcher": not here. A launcher is `_check_wrappers`' measurement; `_check_codex` does not measure one, and a second verdict line would count one finding twice (doctor-checks:3058's `launcher-absent` note). So it is `_fix_wrappers` (below).
- **What it may not do, and how each is kept:**
  - Choose a port: a row `_codex_row` refuses (invalid or colliding ports) is named and left. No lock is taken, nothing is written, and the roster is never opened for writing.
  - Perform OAuth or read a credential: nothing here reaches `_codex_login` (a tripwire in the isolation harness), and nothing opens an authDir. A 0000 `auth.json` survives, and an absent authDir is not created.
  - Kill a listener it cannot identify: every stop is inside `_models_litellm_lane_held` or `_inst_codex_tiers`, both behind `_codex_tier_ours`. This function calls no stop, start or `systemctl` itself (tripwires plus the isolation wall).
  - Delete user state: it deletes nothing.
- **Why the whole cure runs in a subshell.** `_ccrc_die` exits (ccd/ccrc:2336), `_models_refuse` exits (:2392-2397), and an unbound variable is fatal under `set -u`. Called bare in doctor's own shell, any of those would end the doctor run before the re-measurement it exists for (the "whole cure is a subshell" mutation row: 4 isolation reds, measured, which are the cases that read what the caller sees after the fixer returns). Each lane is a nested subshell as well, so its lock is released as the lane ends, through `_codex_unlock` or by the subshell's exit if the work dies first. The litellm body runs in a `$( … )` of its own, because its refusals exit.
- **Why `_fix_wrappers` is the shipped `ccrc wrappers`, with no flag, in a child process.**
  - With no flag, `cmd_wrappers`' own table overwrites exactly one class: `ccrc-unmodified` (ccd/ccrc:3979-3984), a file carrying ccrc's marker whose hash verifies. It backs that file up first, and it writes an `absent` id.
  - It REFUSES `ccrc-edited` (:3985-3992) and every `foreign`, `unreadable` and `oversize` file, each with its own remedy.
  - So "never an unverified launcher" is the verb's table, not a second rule to drift from it, and the fixer never passes `--force` or `--adopt`.
  - It runs as a child because `cmd_wrappers` `_ccrc_die`s on a manifest it will not trust and arms an EXIT trap for its staging directory.
  - Its lines are relayed under `FIX wrappers:`, so its own `summary:` line is never read as doctor's.
  - It reaches generated launchers as well as Codex ones; that is the same act `ccrc install`'s `_inst_wrappers` performs (`D-3730`).
- **The publisher's absent-file remedy tells the truth now (2b-1 carry-forward 15).** `ccd/ccgpt-usage.py:255-259` said "run `ccrc doctor --fix` to render it" while no doctor arm rendered lane.json: its own docstrings said so three times, and a fourth said "Doctor renders no `lane.json`". After this task that sentence is true on this tree: Task 4 FAILs an absent lane.json, and `_fix_codex` renders it (proved end to end below). The one case `--fix` cannot render is a lane with no class registry, so the refusal names that act too: `ccrc models <id> init codex`, which renders lane.json itself. The edits are line-neutral (`ccd/ccgpt-usage.py` cites spec §5.4 line 333 twice, and Task 1 edits this file first).
- **Containment (R11).** This task adds no `systemctl` or `systemd-run` call site. It reaches the user manager only through the lane library, and both harnesses contain that:
  - the isolation harness puts Plan 2b-2's wall first on PATH, and any direct call throws;
  - the doctor harness's PATH is fixture directories only, with no `systemd-run` and a `systemctl` stub that answers 90 to anything it does not know;
  - `healthy()`'s `python3` stub is `exit 0`, so a runtime build reached by mistake fails at `venv` in milliseconds and never reaches pip. Every real-run case also asserts that no `runtime: rebuilding` line appeared.

- [ ] **Step 0: record this task's base and the census (read-only).**

  Do this before any edit. Each bash block in this task is ONE foreground Bash call, timeout ≥ 600000. Each begins by sourcing the Global Constraints' `plan3a-env.sh`, because no variable, function or `cd` survives from one call to the next:

```bash
. "<abs scratch>/plan3a-env.sh"
test -x "$CENSUS" && test -d "$EVID" || { echo "the census script or the evidence root is missing — see Global Constraints"; exit 1; }
git rev-parse HEAD > "$EVID/task8-base"
cd server
"$CENSUS" "$EVID/t8-s0-usage" ./node_modules/.bin/vitest run test/ccgpt-usage.test.ts   # record its count: 34 at 1f9fa22d, 36 once Task 1 is in (an example)
```

  Then run the whole doctor file. It does not fit in one call: census-wrapped, it took 525 s at `1f9fa22d` against the 600 s tool cap, and that was before Tasks 1-7 added their cases.
  - Run it in three parts, one foreground call each, and record each part's `Tests …` line. The parts, as `<k>`/`<P>`:
    - `1`/`'^ccrc doctor: [a-c]'`;
    - `2`/`'^ccrc doctor: [d-m]'`;
    - `3`/`'^(?!ccrc doctor: [a-m])'`.
  - The three patterns are complementary. At `1f9fa22d` they select 88, 123 and 288 cases: all 499 that `vitest list` names. Parts 1 and 2 ran in 208 s together there, and part 3 in 229 s.
  - Tasks 4-6's `ccrc doctor: codex …` describes fall in part 1. This task's `ccrc doctor --fix: …` describes fall in part 3.
  - If a part runs past about 500 s, split it again at another letter before Step 4, keeping the patterns complementary.

```bash
. "<abs scratch>/plan3a-env.sh"
cd server
"$CENSUS" "$EVID/t8-s0-doctor-<k>" ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t <P>
```

  - Re-run this task's locators (Files), and stop on any that finds nothing or finds two. Also stop and report if Task 4 left no `CODEX_LANE_BINS`, no `codex` table entry, or no check-only `materialise`: those are this task's inputs.
  - Each run ends with `census: clean — no unit or link change, 0 fixture processes left; command exit 0`, and the exit code is vitest's.
  - A census exit of 125 or 126 stops the step:
    - 125 prints `census: FAIL — N unit or link change(s) on the real user manager; …`, and the changes are in `<evidence-dir>/new-units.txt`, read by count and never printed;
    - 126 prints `census: FAIL — N fixture process(es) survived …`, and the rows are in `<evidence-dir>/leaks.txt`.
  - Attribute each hit by the rule beside the census script before it counts. A concurrent session's `ccrc-` fixtures under the same temp root land in `leaks.txt` too (measured three times while drafting). Re-run once in isolation, and report either way.

- [ ] **Step 1: write the failing tests.**

- [ ] `server/test/ccrc-doctor.test.ts` imports. Every name joins an import Task 4 already put in place, and no import line is added above `:70`. That is Task 4's reason: `ccrc-install.test.ts:110` and `pool-name-parity.test.ts:45` cite `:66` and `:70`.
  - In the `node:fs` import's second names line, as Task 4 left it, old `  openSync, writeSync, ftruncateSync, closeSync, copyFileSync, utimesSync, appendFileSync, readdirSync, lstatSync, readlinkSync,` → new `  openSync, writeSync, ftruncateSync, closeSync, copyFileSync, utimesSync, appendFileSync, readdirSync, lstatSync, readlinkSync, statSync,`.
  - Widen Task 4's mid-file `./codexLaneFixture.js` import, as Tasks 5 and 6 left it, with the names it lacks: `ccrcFunction, ccrcLine, lockStub, isolationManagerStubs, assertIsolationWallFirst, strayManagerCalls`. `pythonOrSkip` is already imported there, from `./ccgptHarness.js`: never import it twice.
  - Directly after Task 4's `import { pythonOrSkip } from './ccgptHarness.js';`, add:

```ts
import { generateWrapperBody } from '../../shared/wrapper.mjs';
import { markGenerated } from '../../shared/mark.mjs';
```

- [ ] Append the contract describe, the isolation harness and its describe. These were measured green against this task's Step 3 on a scratch copy of the tree while drafting (22 cases):

```ts
// ════════════════════════════════════════════════════════════════════════
// Plan 3a Task 8 — `doctor --fix` for a codex lane, and for its launcher.
// ════════════════════════════════════════════════════════════════════════

/** Every `_fix_<name>` the shipped check table defines, by name. */
function fixerNames(): string[] {
  const r = spawnSync(BASH, ['-c', `set -uo pipefail; . ${shq(CHECKS_SRC)}\ndeclare -F | sed -n "s/^declare -f _fix_//p"`],
    { encoding: 'utf8', env: { ...process.env, PATH: process.env['PATH'] ?? '' } });
  if (r.status !== 0) throw new Error(`could not list the fixers: ${r.stderr}`);
  return (r.stdout ?? '').split('\n').filter(Boolean);
}

describe('ccrc doctor --fix: the contract every fixer runs under (Plan 3a Task 8)', () => {
  it('a fixer runs on a FAIL only: a WARN keeps its verdict and its fixer never runs (R-C8)', () => {
    const home = healthy('ccrc-doctor-fix-fail-only-');
    writeChecks(home, [
      'CCRC_DOCTOR_CHECKS=(warned failed)',
      '_check_warned() { printf "WARN warned: a poller is missing\\n  remedy: run ccrc install\\n"; return 2; }',
      '_fix_warned()   { : > "$HOME/fixer-ran-warned"; echo "FIX warned: enabled it"; }',
      '_check_failed() {',
      '  if [ -e "$HOME/fixer-ran-failed" ]; then printf "PASS failed: cured\\n"; return 0; fi',
      '  printf "FAIL failed: broken\\n  remedy: run ccrc doctor --fix\\n"; return 1',
      '}',
      '_fix_failed()   { : > "$HOME/fixer-ran-failed"; echo "FIX failed: cured it"; }',
      '',
    ].join('\n'));
    const r = runDoctor(home, ['doctor', '--fix']);
    expect(existsSync(join(home, 'fixer-ran-warned')), 'a WARN reached its fixer').toBe(false);
    expect(r.stdout).not.toMatch(/^FIX warned:/m);
    expect(r.stdout).toMatch(/^WARN warned: a poller is missing$/m);
    // The FAIL is printed as measured, the fixer says what it did, and the
    // SECOND measurement is the one the summary counts.
    expect(r.stdout).toMatch(/^FAIL failed: broken\n {2}remedy: run ccrc doctor --fix\nFIX failed: cured it\nPASS failed: cured$/m);
    expect(r.stdout).toMatch(/^summary: 2 checks \(0 skipped\), 2 verdicts — 1 passed, 1 warned, 0 failed$/m);
    expect(r.code, r.stdout).toBe(0);
  });

  it('every _fix_<name> names a check in the table — a fixer with no entry is never run', () => {
    const names = tableNames();
    const fixers = fixerNames();
    // The CONTROL: the three this tree ships are seen, so an empty scan cannot pass.
    expect(fixers).toEqual(expect.arrayContaining(['codex', 'skills', 'wrappers']));
    for (const f of fixers) expect(names, `_fix_${f} is defined, and no table entry "${f}" will ever run it`).toContain(f);
  });

  it('a remedy that names `ccrc doctor --fix` is a FAIL of a check that has a fixer — never a WARN (R-C8)', () => {
    const src = readFileSync(CHECKS_SRC, 'utf8');
    const fixers = new Set(fixerNames());
    // Every `_dr_warn <name>` / `_dr_fail <name>` call, through its `\`-continued lines.
    const calls = [...src.matchAll(/_dr_(warn|fail) ([a-z][a-z0-9_-]*)((?:[^\n]*\\\n)*[^\n]*)/g)]
      .map((m) => ({ cls: m[1]!, name: m[2]!, text: m[3]! }));
    // `_check_codex` records its findings through `_dr_cx_warn` / `_dr_cx_fail`
    // (Tasks 4-6) and prints them under its own name: the same rule binds them.
    for (const m of src.matchAll(/_dr_cx_(warn|fail) ((?:[^\n]*\\\n)*[^\n]*)/g)) {
      calls.push({ cls: m[1]!, name: 'codex', text: m[2]! });
    }
    expect(calls.length, 'the call-site scan found almost nothing — re-anchor it').toBeGreaterThan(100);
    const naming = calls.filter((c) => /doctor --fix/.test(c.text));
    // The CONTROL: skills' FAIL remedy names it, so the scan can see one.
    expect(naming.some((c) => c.cls === 'fail' && c.name === 'skills')).toBe(true);
    expect(naming.filter((c) => c.cls === 'warn' || !fixers.has(c.name)).map((c) => `${c.cls} ${c.name}`)).toEqual([]);
  });
});

/** One function out of ccd/ccrc-doctor-checks, column-0 signature to column-0 `}`. */
function checksFunction(name: string): string {
  const m = new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?\\n\\}`, 'm').exec(readFileSync(CHECKS_SRC, 'utf8'));
  if (m === null) throw new Error(`ccd/ccrc-doctor-checks has no ${name}() { … } at column 0`);
  return m[0];
}
/** Task 4's ONE declaration of the GPT-lane executables `_check_codex` compares,
 *  as it stands in ccd/ccrc-doctor-checks: a one-line assignment or an array. */
function checksDecl(name: string): string {
  const m = new RegExp(`^${name}=(?:\\([^)]*\\)|[^\\n]*)$`, 'm').exec(readFileSync(CHECKS_SRC, 'utf8'));
  if (m === null) throw new Error(`ccd/ccrc-doctor-checks declares no ${name}`);
  return m[0];
}

type LaneBin = (typeof GPT_LANE_BINS)[number];
interface FixCodexCase {
  lanes?: string[]; lanesRc?: number;
  /** CCRC_ROLE in `$HOME/.ccrc/ccrc.env`; unset writes no file */
  role?: string;
  /** ids whose `_codex_row` refuses, with its roster-invalid sentence */
  badRows?: string[];
  lockRefuse?: string[];
  /** `_codex_lane_json_state` per id; default `current` */
  laneState?: Record<string, 'current' | 'stale' | 'absent'>;
  /** the check-only materialise per id: its `changed`, or `refused`; default false */
  registryChanged?: Record<string, boolean | 'refused'>;
  /** the committing materialise per id; default `wrote` */
  commit?: Record<string, 'wrote' | 'no-registry' | 'refused'>;
  /** `_models_litellm_lane_held` per id; default `same` (changed:false) */
  litellm?: Record<string, 'same' | 'rendered' | 'restarted' | 'foreign'>;
  /** `ccgpt-runtime check` before a build, `build`, and `check` after one; default 0 */
  runtime?: { check?: number; build?: number; afterBuild?: number };
  /** each placed executable against the fixture's shipped tree; default `same` */
  bins?: Partial<Record<LaneBin, 'same' | 'drift' | 'missing' | 'mode'>>;
  /** executables the fixture's shipped tree LACKS */
  treeLacks?: LaneBin[];
  tiersDegraded?: boolean;
  /** one ccrc seam left undefined, for the loaded-guard case */
  unload?: string;
  /** make `$HOME/.local/bin` read-only before the run */
  binReadOnly?: boolean;
  /** stamp every placed executable with {@link AGED} before the run */
  ageBins?: boolean;
}

/** A past instant a converged executable must still carry after a run. */
const AGED = new Date('2026-01-02T03:04:05Z');

const FIX_TRIPWIRES = ['_codex_login', '_codex_stop_tier', '_codex_start_tier', '_codex_stop_lane',
  '_codex_cmd_start', '_codex_cmd_stop', '_codex_lane_json_ensure', '_codex_runtime_env_ensure', 'cmd_wrappers'];

/** `_fix_codex` alone. Its ccrc seams are stubbed by table; its one real
 *  primitive (`_inst_atomic`, with `_ccrc_die` and `PROG`) and `_box_env_value`
 *  come out of ccd/ccrc, and `_dr_join` and Task 4's `CODEX_LANE_BINS` out of
 *  ccd/ccrc-doctor-checks. The HOME holds a fixture SHIPPED TREE at
 *  `$HOME/ccrc/ccd` — its `ccgpt-runtime` a recording fake, so a restore keeps
 *  the fake — and the placed copies at `$HOME/.local/bin`. Every ccrc function
 *  this fixer must never call is a tripwire that records and refuses, and
 *  Task 10 of Plan 2b-2's isolation wall is FIRST on PATH, so a direct
 *  `systemctl` or `systemd-run` is a thrown, named red. */
function runFixCodex(c: FixCodexCase = {}): {
  code: number; stdout: string; stderr: string; calls: string[]; tripwire: string[]; fix: string[];
  home: string; after: string;
} {
  const home = mkTmp('ccrc-doctor-fix-codex-iso-');
  const lanes = c.lanes ?? ['codex-a'];
  const tree = join(home, 'ccrc', 'ccd');
  const bin = join(home, '.local', 'bin');
  mkdirSync(tree, { recursive: true });
  mkdirSync(bin, { recursive: true });
  const RUNTIME_FAKE = [
    '#!/bin/sh',
    'printf \'ccgpt-runtime %s\\n\' "$1" >> "$HOME/calls"',
    'case "$1" in',
    '  check) if [ -e "$HOME/rt-built" ]; then exit "$(cat "$HOME/rt-after-build")"; fi; exit "$(cat "$HOME/rt-check")" ;;',
    '  build) rc="$(cat "$HOME/rt-build")"; [ "$rc" -eq 0 ] && : > "$HOME/rt-built"; exit "$rc" ;;',
    'esac',
    'exit 64',
    '',
  ].join('\n');
  for (const n of GPT_LANE_BINS) {
    const text = n === 'ccgpt-runtime' ? RUNTIME_FAKE : `#!/bin/sh\n# fixture shipped ${n}\n`;
    if (!(c.treeLacks ?? []).includes(n)) writeFileSync(join(tree, n), text, { mode: 0o755 });
    const state = c.bins?.[n] ?? 'same';
    if (state === 'missing') continue;
    writeFileSync(join(bin, n), state === 'drift' ? `#!/bin/sh\n# drifted ${n}\n` : text,
      { mode: state === 'mode' ? 0o644 : 0o755 });
    if (c.ageBins === true) utimesSync(join(bin, n), AGED, AGED);
  }
  writeFileSync(join(home, 'rt-check'), `${c.runtime?.check ?? 0}\n`);
  writeFileSync(join(home, 'rt-build'), `${c.runtime?.build ?? 0}\n`);
  writeFileSync(join(home, 'rt-after-build'), `${c.runtime?.afterBuild ?? 0}\n`);
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  writeFileSync(join(home, '.ccrc', 'accounts.json'), '{"fixture":"a roster --fix must never write"}\n');
  if (c.role !== undefined) writeFileSync(join(home, '.ccrc', 'ccrc.env'), `CCRC_ROLE=${c.role}\n`);
  // A second lane's credential, 0000: nothing may open it, so a read would fail loudly.
  const cred = join(home, '.local', 'share', 'ccrc', 'codex', 'codex-b');
  mkdirSync(cred, { recursive: true });
  writeFileSync(join(cred, 'auth.json'), '{"fixture":"test-token-not-a-secret"}\n', { mode: 0o000 });

  const arms = (table: Record<string, string>, fmt: (id: string, v: string) => string): string[] =>
    Object.entries(table).map(([id, v]) => fmt(id, v));
  const MAT = (id: string, extra: string): string =>
    `echo '{"ok":true,"op":"materialise","id":"${id}"${extra}}'`;
  const defs: Record<string, string> = {
    _codex_lanes: (c.lanesRc ?? 0) === 0
      ? `_codex_lanes() { printf '%s\\n' _codex_lanes >> "$HOME/calls"; ${lanes.length === 0 ? ':' : `printf '%s\\n' ${lanes.join(' ')}`}; }`
      : `_codex_lanes() { printf '%s\\n' _codex_lanes >> "$HOME/calls"; echo "ccrc codex: roster-invalid: fixture: the roster could not be read" >&2; return ${c.lanesRc}; }`,
    _codex_row: [
      '_codex_row() {',
      `  case " ${(c.badRows ?? []).join(' ')} " in *" $1 "*) echo "ccrc codex: roster-invalid: account '$1''s codex row does not validate (exec.proxyPort/exec.litellmPort) — fixture" >&2; return 1 ;; esac`,
      '  CX_ID="$1"; return 0',
      '}',
    ].join('\n'),
    _codex_lane_json_state: [
      '_codex_lane_json_state() {',
      '  case "$1" in',
      ...arms(c.laneState ?? {}, (id, v) => `    ${id}) echo ${v}; return 0 ;;`),
      '  esac',
      '  echo current',
      '}',
    ].join('\n'),
    _codex_runtime_cli: '_codex_runtime_cli() { printf \'%s\' "$HOME/.local/bin/ccgpt-runtime"; }',
    _models_roster_path: '_models_roster_path() { printf \'%s\' "$HOME/.ccrc/accounts.json"; }',
    _models_node: [
      '_models_node() {',
      '  printf \'_models_node %s\\n\' "$*" >> "$HOME/calls"',
      '  local id="" check=0',
      '  while [ $# -gt 0 ]; do case "$1" in --id) id="$2"; shift ;; --check) check=1; shift ;; esac; shift; done',
      '  if [ "$check" -eq 1 ]; then',
      '    case "$id" in',
      ...arms(Object.fromEntries(Object.entries(c.registryChanged ?? {}).map(([k, v]) => [k, String(v)])),
        (id, v) => (v === 'refused'
          ? `      ${id}) echo '{"ok":false,"error":"no-answer","detail":"fixture"}'; return 1 ;;`
          : `      ${id}) ${MAT(id, `,"check":true,"changed":{"lane":${v},"classes":false,"effort":false}`)}; return 0 ;;`)),
      '    esac',
      '    echo "{\\"ok\\":true,\\"op\\":\\"materialise\\",\\"id\\":\\"$id\\",\\"check\\":true,\\"changed\\":{\\"lane\\":false,\\"classes\\":false,\\"effort\\":false}}"; return 0',
      '  fi',
      '  case "$id" in',
      ...arms(c.commit ?? {}, (id, v) => (v === 'no-registry'
        ? `    ${id}) ${MAT(id, ',"wrote":null')}; return 0 ;;`
        : v === 'refused'
          ? `    ${id}) echo '{"ok":false,"error":"settings-unwritable","detail":"fixture: the env block cannot be rendered"}'; return 1 ;;`
          : `    ${id}) ${MAT(id, `,"wrote":{"lane":"lane.json of ${id}"}`)}; return 0 ;;`)),
      '  esac',
      '  echo "{\\"ok\\":true,\\"op\\":\\"materialise\\",\\"id\\":\\"$id\\",\\"wrote\\":{\\"lane\\":\\"lane.json of $id\\"}}"',
      '}',
    ].join('\n'),
    _models_litellm_lane_held: [
      '_models_litellm_lane_held() {',
      '  printf \'%s %s lock=%s\\n\' _models_litellm_lane_held "$1" "${CX_LOCK_ID:-}" >> "$HOME/calls"',
      '  case "$1" in',
      ...arms(c.litellm ?? {}, (id, v) => {
        switch (v) {
          case 'rendered': return `    ${id}) echo '{"ok":true,"op":"litellm","id":"${id}","changed":true,"restarted":false}'; return 0 ;;`;
          case 'restarted': return `    ${id}) echo '{"ok":true,"op":"litellm","id":"${id}","changed":true,"restarted":true}'; return 0 ;;`;
          // `_models_refuse`'s own shape: one JSON object, then EXIT.
          case 'foreign': return `    ${id}) echo '{"ok":false,"error":"tier-foreign","detail":"lane ${id}\\u0027s LiteLLM tier is not provably this lane\\u0027s — fixture"}'; exit 1 ;;`;
          default: return '';
        }
      }),
      '  esac',
      '  echo "{\\"ok\\":true,\\"op\\":\\"litellm\\",\\"id\\":\\"$1\\",\\"changed\\":false}"',
      '}',
    ].join('\n'),
    _inst_codex_tiers: [
      '_inst_codex_tiers() {',
      '  printf \'_inst_codex_tiers role=%s\\n\' "${INST_ROLE:-unset}" >> "$HOME/calls"',
      '  echo "install: codex tiers: fixture — measured"',
      ...(c.tiersDegraded === true ? ['  INST_DEGRADED+=(codex-tiers)'] : []),
      '}',
    ].join('\n'),
  };
  if (c.unload !== undefined) delete defs[c.unload];
  const harness = [
    'set -uo pipefail',
    ccrcLine(/^PROG=.*$/m, 'PROG='),
    ccrcLine(/^_ccrc_die\(\) \{.*\}$/m, '_ccrc_die'),
    ccrcFunction('_inst_atomic'),
    ccrcFunction('_box_env_value'),
    'BOX_TREE_DIR="$HOME/ccrc"',
    'BOX_ENV_FILE="$HOME/.ccrc/ccrc.env"',
    checksFunction('_dr_join'),
    checksDecl('CODEX_LANE_BINS'),
    ...Object.values(defs),
    lockStub(c.lockRefuse ?? []),
    ...FIX_TRIPWIRES.map((f) => `${f}() { printf '%s %s\\n' ${f} "$*" >> "$HOME/tripwire"; return 97; }`),
    checksFunction('_fix_codex'),
    '_fix_codex; rc=$?',
    'printf \'after rc=%s lockfd=%s\\n\' "$rc" "${CX_LOCK_FD:-}"',
    'exit "$rc"',
  ].join('\n');
  if (c.binReadOnly === true) chmodSync(bin, 0o555);
  const wall = isolationManagerStubs(home);
  const env = { PATH: `${wall}:${process.env['PATH'] ?? ''}`, HOME: home, LC_ALL: 'C' };
  assertIsolationWallFirst(env, home);
  const p = spawnSync(BASH, ['-c', harness], { env, encoding: 'utf8' });
  if (c.binReadOnly === true) chmodSync(bin, 0o755);
  const stray = strayManagerCalls(home);
  if (stray.length > 0) {
    throw new Error(`_fix_codex reached the user manager directly:\n${stray.join('\n')}\n${p.stderr ?? ''}`);
  }
  const lines = (f: string): string[] =>
    (existsSync(join(home, f)) ? readFileSync(join(home, f), 'utf8').split('\n').filter(Boolean) : []);
  const out = p.stdout ?? '';
  return {
    code: p.status ?? -1, stdout: out, stderr: p.stderr ?? '', calls: lines('calls'), tripwire: lines('tripwire'),
    fix: out.split('\n').filter((l) => l.startsWith('FIX codex:')), home,
    after: out.split('\n').filter((l) => l.startsWith('after rc=')).join('\n'),
  };
}

describe('ccrc doctor --fix: codex, measured in isolation (_fix_codex, Plan 3a Task 8)', () => {
  const DONE = (n: number): string =>
    `FIX codex: done for ${n} codex lane(s) — no port, roster row, OAuth, credential, unidentified listener or unit enablement was touched; the re-measurement below is the verdict`;
  const commit = (home: string, id: string): string => `_models_node materialise --file ${home}/.ccrc/accounts.json --id ${id}`;
  const check = (home: string, id: string): string => `${commit(home, id)} --check true`;
  const held = (id: string): string => `_models_litellm_lane_held ${id} lock=${id}`;
  const TIERS_LINE = 'FIX codex: tiers: re-ran the install step that restarts a running tier only when it is this lane\'s own and runs code this fix replaced (its lines above)';

  it('a converged lane: every measurement is asked, and nothing is placed, rebuilt, rendered or restarted', () => {
    const r = runFixCodex();
    expect(r.code, r.stderr).toBe(0);
    expect(r.calls).toEqual(['_codex_lanes', 'ccgpt-runtime check', '_codex_lock codex-a',
      check(r.home, 'codex-a'), held('codex-a'), '_codex_unlock codex-a']);
    expect(r.fix).toEqual([DONE(1)]);
    expect(r.tripwire).toEqual([]);
    expect(r.after).toBe('after rc=0 lockfd=');
  });

  it('refuses, asking nothing, when a ccrc function it calls is not loaded', () => {
    const r = runFixCodex({ unload: '_models_node' });
    expect(r.code).toBe(1);
    expect(r.calls).toEqual([]);
    expect(r.fix).toEqual(["FIX codex: refused — ccrc's own _models_node is not loaded, so nothing was cured; this is a bug in ccrc, not a fact about your box (the check table was sourced by something that is not ccrc)"]);
  });

  it('a server box is refused before the roster is read: it converges nothing per account', () => {
    const r = runFixCodex({ role: 'server', bins: { 'ccgpt-usage.py': 'drift' } });
    expect(r.code).toBe(1);
    expect(r.calls).toEqual([]);
    expect(r.fix).toEqual(['FIX codex: refused — this box records CCRC_ROLE=server, which converges nothing per account, so nothing was cured']);
    expect(readFileSync(join(r.home, '.local', 'bin', 'ccgpt-usage.py'), 'utf8')).toBe('#!/bin/sh\n# drifted ccgpt-usage.py\n');
  });

  it('an unreadable roster or a missing jq is refused, never read as "no codex lane"', () => {
    for (const lanesRc of [1, 2]) {
      const r = runFixCodex({ lanesRc, bins: { 'ccgpt-usage.py': 'drift' } });
      expect(r.code, `lanesRc ${lanesRc}`).toBe(1);
      expect(r.calls).toEqual(['_codex_lanes']);
      expect(r.fix).toEqual(['FIX codex: refused — which roster lanes are codex lanes could not be read (the ccrc codex: line above says why), so nothing was cured']);
    }
    // The CONTROL: an empty population says so in its own words.
    const none = runFixCodex({ lanes: [] });
    expect(none.code).toBe(0);
    expect(none.fix).toEqual(['FIX codex: nothing to cure — no codex lane in the roster']);
  });

  it('a drifted, a missing and a mode-only executable are placed again from the shipped tree at 0755, and only then are the tiers asked', () => {
    const r = runFixCodex({ role: 'fleet', bins: { 'ccgpt-proxy.py': 'mode', 'ccgpt-usage.py': 'drift', 'ccrc-codex': 'missing' } });
    expect(r.code, r.stderr).toBe(0);
    expect(r.fix).toEqual([
      'FIX codex: restored $HOME/.local/bin/ccgpt-proxy.py from the shipped tree',
      'FIX codex: restored $HOME/.local/bin/ccgpt-usage.py from the shipped tree',
      'FIX codex: restored $HOME/.local/bin/ccrc-codex from the shipped tree',
      TIERS_LINE,
      DONE(1),
    ]);
    for (const n of GPT_LANE_BINS) {
      const placed = join(r.home, '.local', 'bin', n);
      expect(readFileSync(placed).equals(readFileSync(join(r.home, 'ccrc', 'ccd', n))), `${n} is not the shipped bytes`).toBe(true);
      expect(statSync(placed).mode & 0o777, n).toBe(0o755);
    }
    // The tiers are asked LAST, once, with the box's own role.
    expect(r.calls[r.calls.length - 1]).toBe('_inst_codex_tiers role=fleet');
    expect(r.calls.filter((l) => l.startsWith('_inst_codex_tiers'))).toHaveLength(1);
  });

  it('a converged executable is never rewritten — measured on mtime, not on the message', () => {
    const r = runFixCodex({ ageBins: true, bins: { 'ccgpt-usage.py': 'drift' } });
    expect(r.fix.filter((l) => l.includes('restored'))).toEqual(['FIX codex: restored $HOME/.local/bin/ccgpt-usage.py from the shipped tree']);
    for (const n of GPT_LANE_BINS) {
      const t = statSync(join(r.home, '.local', 'bin', n)).mtimeMs;
      if (n === 'ccgpt-usage.py') expect(t, n).not.toBe(AGED.getTime());
      else expect(t, `${n} was rewritten though it was already the shipped bytes`).toBe(AGED.getTime());
    }
  });

  it('a shipped tree that lacks an executable names it and places nothing at that path', () => {
    const r = runFixCodex({ treeLacks: ['ccgpt-usage.py'], bins: { 'ccgpt-usage.py': 'missing' } });
    expect(r.fix).toContain('FIX codex: ccgpt-usage.py: not restored — the shipped tree has no $HOME/ccrc/ccd/ccgpt-usage.py; run \'ccrc update\' (or \'ccrc install\' from a checkout) to place it');
    expect(existsSync(join(r.home, '.local', 'bin', 'ccgpt-usage.py'))).toBe(false);
    // Nothing was replaced, so no tier is asked to restart.
    expect(r.calls.some((l) => l.startsWith('_inst_codex_tiers'))).toBe(false);
  });

  it.skipIf(process.getuid?.() === 0)('an install step that dies is contained: the lanes and the caller still run', () => {
    const r = runFixCodex({ bins: { 'ccgpt-proxy.py': 'drift' }, binReadOnly: true });
    expect(r.fix).toContain('FIX codex: ccgpt-proxy.py: not restored — the install step refused (its line above says why)');
    expect(r.stderr).toMatch(/^ccrc: could not install .*ccgpt-proxy\.py — nothing at that path was replaced$/m);
    expect(r.calls).toContain('_codex_lock codex-a');
    expect(r.after).toBe('after rc=0 lockfd=');
  });

  it('a runtime its own check refuses is rebuilt, re-checked, and then the tiers are asked', () => {
    const r = runFixCodex({ runtime: { check: 1, build: 0, afterBuild: 0 } });
    expect(r.calls.slice(0, 4)).toEqual(['_codex_lanes', 'ccgpt-runtime check', 'ccgpt-runtime build', 'ccgpt-runtime check']);
    expect(r.fix).toEqual([
      "FIX codex: runtime: rebuilding with 'ccgpt-runtime build' — pip may take minutes",
      'FIX codex: runtime: rebuilt, probed and current',
      TIERS_LINE,
      DONE(1),
    ]);
    expect(r.calls[r.calls.length - 1]).toBe('_inst_codex_tiers role=both');
  });

  it('a build that fails, or leaves no current runtime, is said — and no tier is restarted over it', () => {
    for (const runtime of [{ check: 1, build: 2 }, { check: 1, build: 0, afterBuild: 1 }]) {
      const r = runFixCodex({ runtime });
      expect(r.fix).toContain("FIX codex: runtime: NOT rebuilt — 'ccgpt-runtime build' did not leave a current runtime (its reason is the ccgpt-runtime line on stderr), so the previous one, if any, stays current");
      expect(r.calls.some((l) => l.startsWith('_inst_codex_tiers')), JSON.stringify(runtime)).toBe(false);
    }
  });

  it('lane.json stale against the roster, or absent, is re-rendered by its one writer under the lane lock', () => {
    for (const st of ['stale', 'absent'] as const) {
      const r = runFixCodex({ laneState: { 'codex-a': st } });
      expect(r.calls).toEqual(['_codex_lanes', 'ccgpt-runtime check', '_codex_lock codex-a',
        check(r.home, 'codex-a'), commit(r.home, 'codex-a'), held('codex-a'), '_codex_unlock codex-a']);
      expect(r.fix).toEqual(["FIX codex: codex-a: lane.json re-rendered from the roster and this lane's class registry", DONE(1)]);
    }
  });

  it('lane.json current against the roster but stale against the registry (R7) is re-rendered too — and an answer it cannot read is stale, never current', () => {
    for (const v of [true, 'refused'] as const) {
      const r = runFixCodex({ registryChanged: { 'codex-a': v } });
      expect(r.calls, String(v)).toContain(commit(r.home, 'codex-a'));
      expect(r.fix).toContain("FIX codex: codex-a: lane.json re-rendered from the roster and this lane's class registry");
    }
  });

  it('a lane with no class registry is named with the one act that renders it; a writer refusal with its own code', () => {
    const none = runFixCodex({ laneState: { 'codex-a': 'absent' }, commit: { 'codex-a': 'no-registry' } });
    expect(none.fix).toContain('FIX codex: codex-a: lane.json NOT rendered — this lane has no class registry, and lane.json is rendered from it; run: ccrc models codex-a init codex');
    const refused = runFixCodex({ laneState: { 'codex-a': 'stale' }, commit: { 'codex-a': 'refused' } });
    expect(refused.fix).toContain('FIX codex: codex-a: lane.json NOT rendered — deploy/models-op.mjs answered settings-unwritable: fixture: the env block cannot be rendered');
  });

  it('litellm.yaml goes through the codex arm\'s body, holding the lane lock, and what it did is said', () => {
    const r = runFixCodex({ lanes: ['codex-a', 'codex-b'], litellm: { 'codex-a': 'rendered', 'codex-b': 'restarted' } });
    expect(r.calls).toContain(held('codex-a'));
    expect(r.calls).toContain(held('codex-b'));
    expect(r.fix).toEqual([
      'FIX codex: codex-a: litellm.yaml re-rendered',
      "FIX codex: codex-b: litellm.yaml re-rendered, and this lane's own LiteLLM tier restarted onto it",
      DONE(2),
    ]);
    // A render restarts its own tier; nothing else here does.
    expect(r.calls.some((l) => l.startsWith('_inst_codex_tiers'))).toBe(false);
  });

  it('a render the codex arm refuses — a tier it cannot prove this lane\'s — is named and contained, and the next lane still runs', () => {
    const r = runFixCodex({ lanes: ['codex-a', 'codex-b'], litellm: { 'codex-a': 'foreign', 'codex-b': 'rendered' } });
    expect(r.fix).toEqual([
      "FIX codex: codex-a: litellm.yaml NOT rendered — tier-foreign: lane codex-a's LiteLLM tier is not provably this lane's — fixture",
      'FIX codex: codex-b: litellm.yaml re-rendered',
      DONE(2),
    ]);
    expect(r.tripwire).toEqual([]);
    expect(r.after).toBe('after rc=0 lockfd=');
  });

  it('a roster row that does not validate is left — no lock, no write, no render — and the roster is byte-identical', () => {
    const r = runFixCodex({ lanes: ['codex-a', 'codex-b'], badRows: ['codex-a'], laneState: { 'codex-a': 'stale', 'codex-b': 'stale' } });
    expect(r.fix).toEqual([
      'FIX codex: codex-a: nothing cured — its roster row does not validate (the ccrc codex: line above says why), and --fix never edits the roster or chooses a port',
      "FIX codex: codex-b: lane.json re-rendered from the roster and this lane's class registry",
      DONE(2),
    ]);
    expect(r.stderr).toMatch(/^ccrc codex: roster-invalid: account 'codex-a''s codex row does not validate/m);
    expect(r.calls.filter((l) => l.includes('codex-a') && !l.startsWith('_codex_lanes'))).toEqual([]);
    expect(readFileSync(join(r.home, '.ccrc', 'accounts.json'), 'utf8')).toBe('{"fixture":"a roster --fix must never write"}\n');
  });

  it('a lane whose lock cannot be taken is left, and the next lane still runs; each lock is released before the next is taken', () => {
    const refused = runFixCodex({ lanes: ['codex-a', 'codex-b'], lockRefuse: ['codex-a'], laneState: { 'codex-a': 'stale' } });
    expect(refused.fix[0]).toBe("FIX codex: codex-a: nothing cured — its lane lock could not be taken (the line above says why); re-run 'ccrc doctor --fix' once it is free");
    expect(refused.calls).not.toContain(commit(refused.home, 'codex-a'));
    expect(refused.calls).toContain('_codex_lock codex-b');
    const both = runFixCodex({ lanes: ['codex-a', 'codex-b'] });
    expect(both.calls.filter((l) => /^(_codex_lock|_codex_unlock|LOCK-STILL-HELD) /.test(l)))
      .toEqual(['_codex_lock codex-a', '_codex_unlock codex-a', '_codex_lock codex-b', '_codex_unlock codex-b']);
    expect(both.after).toBe('after rc=0 lockfd=');
  });

  it('a tier restart that cannot finish is said', () => {
    const r = runFixCodex({ bins: { 'ccgpt-usage.py': 'drift' }, tiersDegraded: true });
    expect(r.fix).toContain('FIX codex: tiers: re-ran the install step that restarts a verified-own stale tier, and it could not restart every one (its lines above say which)');
  });

  it('never OAuth, never a credential, never a unit: every arm at once touches none of them', () => {
    const r = runFixCodex({
      lanes: ['codex-a', 'codex-b'], bins: { 'ccgpt-usage.py': 'drift' }, runtime: { check: 1 },
      laneState: { 'codex-a': 'absent' }, litellm: { 'codex-b': 'restarted' },
    });
    expect(r.code, r.stderr).toBe(0);
    expect(r.tripwire).toEqual([]);
    // codex-a has NO authDir on disk: none is created. codex-b's is 0000: it
    // is still exactly what it was, because nothing opened it.
    expect(existsSync(join(r.home, '.local', 'share', 'ccrc', 'codex', 'codex-a'))).toBe(false);
    const auth = join(r.home, '.local', 'share', 'ccrc', 'codex', 'codex-b', 'auth.json');
    expect(statSync(auth).mode & 0o777).toBe(0o000);
    chmodSync(auth, 0o600);
    expect(readFileSync(auth, 'utf8')).toBe('{"fixture":"test-token-not-a-secret"}\n');
    expect(readFileSync(join(r.home, '.ccrc', 'accounts.json'), 'utf8')).toBe('{"fixture":"a roster --fix must never write"}\n');
  });
});
```

- [ ] Append the launcher describe (5 cases, measured green on the scratch copy):

```ts
describe('ccrc doctor --fix: wrappers — a launcher is regenerated only when ccrc\'s marker still verifies (Plan 3a Task 8)', () => {
  /** A FULL roster — label, homeAble and telemetry on every row, which `ccrc
   *  wrappers`' own validator requires and `writeRoster`'s convenience rows do
   *  not carry — with one GENERATED account and no codex row, so `_check_codex`
   *  SKIPs and `_fix_codex` never runs on these boxes (the Codex case below is
   *  the one exception, and says so). */
  const UP = { id: 'claude', label: 'claude', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true, telemetry: 'anthropic' };
  const GEN = { id: 'claude2', label: 'claude2', configDirSuffix: '.claude2', exec: { kind: 'generated' }, homeAble: true, telemetry: 'none' };
  const marked = (id: string, suffix: string, execKind: 'generated' | 'codex'): string =>
    markGenerated(generateWrapperBody({ id, configDirSuffix: suffix, execKind }, 'claude'));
  function launcherBox(prefix: string, accounts: object[] = [UP, GEN]): string {
    const home = healthy(prefix);
    writeRawRoster(home, `${JSON.stringify({ version: 1, accounts }, null, 2)}\n`);
    // `cmd_wrappers` resolves its generator one directory up from ITS OWN file:
    // `$HOME/ccrc/deploy/gen-wrappers.mjs` here. A symlink, because node
    // resolves the generator's own imports from its real path (this checkout's
    // `shared/`), which is the pair a box ships together.
    mkdirSync(join(home, 'ccrc', 'deploy'), { recursive: true });
    symlinkSync(join(REPO, 'deploy', 'gen-wrappers.mjs'), join(home, 'ccrc', 'deploy', 'gen-wrappers.mjs'));
    // The verb's own tools. The contained PATH carries none of them by design.
    for (const t of ['mkdir', 'mktemp', 'date', 'stat', 'cp', 'chmod', 'mv', 'rm']) linkReal(home, t);
    return home;
  }
  const bin = (home: string, id: string): string => join(home, '.local', 'bin', id);
  /** Everything doctor printed AFTER the fixer's closing line: the re-measurement. */
  const second = (out: string): string => {
    const i = out.lastIndexOf("FIX wrappers: ran the shipped tree's 'ccrc wrappers'");
    if (i < 0) throw new Error(`no _fix_wrappers closing line in:\n${out}`);
    return out.slice(i);
  };
  const backups = (home: string, id: string): string[] =>
    readdirSync(join(home, '.local', 'bin')).filter((n) => n.startsWith(`${id}.pre-ccrc-`));

  it('an absent launcher is written by --fix, and the re-measurement is a PASS', () => {
    const home = launcherBox('ccrc-doctor-fix-wrappers-absent-');
    const r0 = runDoctor(home);
    expect(lineFor(r0.stdout, 'wrappers')).toMatch(/^FAIL wrappers: /);
    expect(existsSync(bin(home, 'claude2')), 'doctor without --fix wrote a launcher').toBe(false);
    const r = runDoctor(home, ['doctor', '--fix']);
    expect(r.stdout).toMatch(/^FIX wrappers: WRITE claude2: /m);
    expect(second(r.stdout)).toMatch(/^PASS wrappers: /m);
    expect(readFileSync(bin(home, 'claude2'), 'utf8')).toBe(marked('claude2', '.claude2', 'generated'));
    expect(statSync(bin(home, 'claude2')).mode & 0o777).toBe(0o755);
  });

  it('a launcher whose ccrc marker still verifies, written for an older roster, is regenerated, and the one it replaced is kept', () => {
    const home = launcherBox('ccrc-doctor-fix-wrappers-stale-');
    const old = marked('claude2', '.claude2-old', 'generated');
    writeFileSync(bin(home, 'claude2'), old, { mode: 0o755 });
    const r0 = runDoctor(home);
    expect(lineFor(r0.stdout, 'wrappers')).toMatch(/^FAIL wrappers: /);
    expect(readFileSync(bin(home, 'claude2'), 'utf8')).toBe(old);
    const r = runDoctor(home, ['doctor', '--fix']);
    expect(r.stdout).toMatch(/^FIX wrappers: REWRITE claude2: /m);
    expect(second(r.stdout)).toMatch(/^PASS wrappers: /m);
    expect(readFileSync(bin(home, 'claude2'), 'utf8')).toBe(marked('claude2', '.claude2', 'generated'));
    const b = backups(home, 'claude2');
    expect(b).toHaveLength(1);
    expect(readFileSync(bin(home, b[0]!), 'utf8')).toBe(old);
  });

  it('a launcher ccrc did not write is never overwritten: its FAIL stands, byte for byte, with no backup', () => {
    const home = launcherBox('ccrc-doctor-fix-wrappers-foreign-');
    const foreign = ['#!/usr/bin/env bash', '# hand-written, and pointing somewhere else on purpose',
      'export CLAUDE_CONFIG_DIR="$HOME/.claude2-elsewhere"', 'exec "$HOME/.local/bin/claude" "$@"', ''].join('\n');
    writeFileSync(bin(home, 'claude2'), foreign, { mode: 0o755 });
    const r = runDoctor(home, ['doctor', '--fix']);
    expect(r.stdout).toMatch(/^FIX wrappers: REFUSE claude2: /m);
    expect(second(r.stdout)).toMatch(/^FAIL wrappers: /m);
    expect(readFileSync(bin(home, 'claude2'), 'utf8')).toBe(foreign);
    expect(backups(home, 'claude2')).toEqual([]);
  });

  it('a launcher ccrc wrote and someone edited since is never overwritten either', () => {
    const home = launcherBox('ccrc-doctor-fix-wrappers-edited-');
    const edited = marked('claude2', '.claude2', 'generated').replace('/.claude2"', '/.claude2-hand"');
    expect(edited, 'the edit changed nothing — re-anchor it on the export line').not.toBe(marked('claude2', '.claude2', 'generated'));
    writeFileSync(bin(home, 'claude2'), edited, { mode: 0o755 });
    const r = runDoctor(home, ['doctor', '--fix']);
    expect(r.stdout).toMatch(/^FIX wrappers: REFUSE claude2: /m);
    expect(second(r.stdout)).toMatch(/^FAIL wrappers: /m);
    expect(readFileSync(bin(home, 'claude2'), 'utf8')).toBe(edited);
    expect(backups(home, 'claude2')).toEqual([]);
  });

  it('a Codex lane\'s marker-verified launcher is regenerated the same way, to exec ccrc-codex', async () => {
    // This box has a codex row, so `_check_codex` measures it and FAILs (none
    // of its lane state exists), and `_fix_codex` runs too. It is contained
    // here the way every doctor fixture is: a contained PATH, no user manager,
    // healthy()'s `python3` stub (a runtime build this reached would fail at
    // `venv` before any pip), and free ports (a tier question finds nothing).
    // Only the `wrappers` lines are this case's subject.
    const [lane] = await freeLanes(['codex-a']);
    const home = launcherBox('ccrc-doctor-fix-wrappers-codex-', [UP, {
      id: 'codex-a', label: 'codex-a', configDirSuffix: '.claude-codex-a', homeAble: true, telemetry: 'codex',
      exec: { kind: 'codex', provider: 'openai', proxyPort: lane!.proxyPort, litellmPort: lane!.litellmPort,
        authDir: '.local/share/ccrc/codex/codex-a' },
    }]);
    writeFileSync(bin(home, 'codex-a'), marked('codex-a', '.claude-codex-a-old', 'codex'), { mode: 0o755 });
    const r = runDoctor(home, ['doctor', '--fix']);
    expect(r.stdout).toMatch(/^FIX wrappers: REWRITE codex-a: /m);
    expect(second(r.stdout)).toMatch(/^PASS wrappers: /m);
    const text = readFileSync(bin(home, 'codex-a'), 'utf8');
    expect(text).toBe(marked('codex-a', '.claude-codex-a', 'codex'));
    expect(text).toContain('\nexec "$HOME/.local/bin/ccrc-codex" "$@"\n');
  });
});
```

- [ ] Append the real-run describe. These cases need Task 4's `healthyCodexBox`, so they could not be run while drafting. They typecheck (`tsc -p test/tsconfig.tests.json`, measured clean), and the implementer measures them:

```ts
describe('ccrc doctor --fix: codex, on a real doctor run (Plan 3a Task 8)', () => {
  // Task 4's `healthyCodexBox`, as Tasks 4-6 leave it: `_check_codex` prints
  // no FAIL on it. Each case breaks exactly ONE thing. `await` takes the
  // fixture whether Tasks 4-5 left it synchronous or not.
  //
  // CONTAINED THE WAY EVERY DOCTOR FIXTURE IS: a PATH of fixture directories
  // only (no `systemd-run`, a stub `systemctl`), and healthy()'s `python3`
  // stub, so a runtime build reached by mistake fails at `venv` before any
  // pip. Every case also asserts that no `runtime: rebuilding` line appears,
  // so such a mistake is a red here, never a slow build. The runtime arm
  // itself is measured in isolation above: a real one is pip.
  const FIX_TOOLS = ['cmp', 'cp', 'chmod', 'mv', 'rm', 'mkdir'] as const;
  /** Everything after the fixer's closing line: doctor's SECOND measurement. */
  const afterFix = (out: string): string => {
    const i = out.lastIndexOf('FIX codex: done for ');
    if (i < 0) throw new Error(`_fix_codex never reached its closing line:\n${out}`);
    return out.slice(i);
  };
  const noBuild = (out: string): void => {
    expect(out, 'this case reached a runtime build').not.toMatch(/^FIX codex: runtime: rebuilding/m);
  };
  type Roster = { accounts: Array<{ id: string; exec: Record<string, unknown> }> };
  const rosterFile = (home: string): string => join(home, '.ccrc', 'accounts.json');
  const readRosterJson = (home: string): Roster => JSON.parse(readFileSync(rosterFile(home), 'utf8')) as Roster;
  const codexRowOf = (j: Roster): { id: string; exec: Record<string, unknown> } => {
    const row = j.accounts.find((a) => a.id === 'codex-a');
    if (row === undefined) throw new Error('healthyCodexBox rosters no codex-a');
    return row;
  };
  const laneJson = (home: string): string => join(home, '.ccrc', 'codex', 'codex-a', 'lane.json');

  it('a drifted GPT-lane executable is placed again from the shipped tree, and the re-measurement — not the FIX line — is the verdict', async () => {
    const home = await healthyCodexBox('ccrc-doctor-fix-codex-bin-');
    for (const t of FIX_TOOLS) linkReal(home, t);
    const shipped = join(home, 'ccrc', 'ccd', 'ccgpt-usage.py');
    const placed = join(home, '.local', 'bin', 'ccgpt-usage.py');
    expect(existsSync(shipped), 'healthyCodexBox ships no ccgpt-usage.py in its tree (Task 4 owes it)').toBe(true);
    const drifted = '#!/usr/bin/env python3\n# drifted by hand\n';
    // Unlink first: a write through a link the fixture planted would edit its target.
    rmSync(placed, { force: true });
    writeFileSync(placed, drifted, { mode: 0o755 });
    const r0 = runDoctor(home);
    expect(r0.stdout).toMatch(/^FAIL codex: /m);
    expect(r0.stdout, 'doctor without --fix ran a fixer').not.toMatch(/^FIX /m);
    expect(readFileSync(placed, 'utf8')).toBe(drifted);
    const r = runDoctor(home, ['doctor', '--fix']);
    noBuild(r.stdout);
    expect(r.stdout).toMatch(/^FIX codex: restored \$HOME\/\.local\/bin\/ccgpt-usage\.py from the shipped tree$/m);
    expect(afterFix(r.stdout)).not.toMatch(/^FAIL codex: /m);
    expect(readFileSync(placed).equals(readFileSync(shipped))).toBe(true);
    expect(statSync(placed).mode & 0o777).toBe(0o755);
  });

  it('an absent lane.json is rendered by --fix: the remedy the usage publisher names works on this tree', async () => {
    const home = await healthyCodexBox('ccrc-doctor-fix-codex-lanejson-');
    expect(existsSync(laneJson(home)), 'healthyCodexBox has no lane.json (Task 4 owes it)').toBe(true);
    const want = JSON.parse(readFileSync(laneJson(home), 'utf8')) as unknown;
    rmSync(laneJson(home));
    const r0 = runDoctor(home);
    expect(r0.stdout).toMatch(/^FAIL codex: /m);
    expect(existsSync(laneJson(home)), 'doctor without --fix wrote a lane.json').toBe(false);
    const r = runDoctor(home, ['doctor', '--fix']);
    noBuild(r.stdout);
    expect(r.stdout).toMatch(/^FIX codex: codex-a: lane\.json re-rendered from the roster and this lane's class registry$/m);
    expect(afterFix(r.stdout)).not.toMatch(/^FAIL codex: /m);
    expect(JSON.parse(readFileSync(laneJson(home), 'utf8'))).toEqual(want);
  });

  it('a hand-edited litellm.yaml is re-rendered through the codex arm, and no tier was running to restart', async () => {
    const home = await healthyCodexBox('ccrc-doctor-fix-codex-litellm-');
    const yaml = join(home, '.ccrc', 'codex', 'codex-a', 'litellm.yaml');
    expect(existsSync(yaml), 'healthyCodexBox has no litellm.yaml (Task 4 owes it)').toBe(true);
    const want = readFileSync(yaml, 'utf8');
    writeFileSync(yaml, `${want}# edited by hand\n`);
    const r = runDoctor(home, ['doctor', '--fix']);
    noBuild(r.stdout);
    expect(r.stdout).toMatch(/^FIX codex: codex-a: litellm\.yaml re-rendered$/m);
    expect(afterFix(r.stdout)).not.toMatch(/^FAIL codex: /m);
    expect(readFileSync(yaml, 'utf8')).toBe(want);
  });

  it.skipIf(pythonOrSkip() === null)('a foreign listener on a lane port survives --fix and its FAIL stands, while what --fix may cure is cured', async () => {
    const home = await healthyCodexBox('ccrc-doctor-fix-codex-foreign-');
    // Fresh ports — never a hard-coded one for a real listener — which also
    // leaves lane.json stale against the roster: a FAIL this fix may cure.
    const [ports] = await freeLanes(['codex-a']);
    const j = readRosterJson(home);
    const row = codexRowOf(j);
    row.exec['proxyPort'] = ports!.proxyPort;
    row.exec['litellmPort'] = ports!.litellmPort;
    writeFileSync(rosterFile(home), `${JSON.stringify(j, null, 2)}\n`);
    const foreign = await spawnListener(home, { answer: 'text', lane: 'codex-a', port: ports!.proxyPort });
    try {
      const r = runDoctor(home, ['doctor', '--fix']);
      noBuild(r.stdout);
      expect(r.stdout).toMatch(/^FIX codex: codex-a: lane\.json re-rendered from the roster and this lane's class registry$/m);
      expect(afterFix(r.stdout)).toMatch(/^FAIL codex: /m);
      expect(alive(foreign.pid), 'the foreign listener was signalled').toBe(true);
      expect(await portAccepts(ports!.proxyPort)).toBe(true);
      expect((JSON.parse(readFileSync(laneJson(home), 'utf8')) as { proxyPort: number }).proxyPort).toBe(ports!.proxyPort);
    } finally {
      await killLaneProcesses(home);
    }
  }, 60_000);

  it('a roster row whose two ports collide stays FAIL: --fix chooses no port and writes no roster', async () => {
    const home = await healthyCodexBox('ccrc-doctor-fix-codex-ports-');
    const j = readRosterJson(home);
    const row = codexRowOf(j);
    row.exec['litellmPort'] = row.exec['proxyPort'];
    writeFileSync(rosterFile(home), `${JSON.stringify(j, null, 2)}\n`);
    const before = readFileSync(rosterFile(home));
    const r = runDoctor(home, ['doctor', '--fix']);
    noBuild(r.stdout);
    expect(r.stdout).toMatch(/^FIX codex: codex-a: nothing cured — its roster row does not validate \(the ccrc codex: line above says why\), and --fix never edits the roster or chooses a port$/m);
    expect(afterFix(r.stdout)).toMatch(/^FAIL codex: /m);
    expect(readFileSync(rosterFile(home)).equals(before), '--fix wrote the roster').toBe(true);
  });

  it('an absent authDir stays FAIL with the login remedy: --fix runs no OAuth and creates nothing there', async () => {
    const home = await healthyCodexBox('ccrc-doctor-fix-codex-auth-');
    const auth = authDirOf(home, 'codex-a');
    rmSync(auth, { recursive: true, force: true });
    const r = runDoctor(home, ['doctor', '--fix']);
    noBuild(r.stdout);
    const second = afterFix(r.stdout);
    expect(second).toMatch(/^FAIL codex: /m);
    expect(second).toMatch(/^ {2}remedy: .*ccrc codex login codex-a/m);
    expect(existsSync(auth), '--fix created the authDir').toBe(false);
  });
});
```

- [ ] `server/test/ccgpt-usage.test.ts`, the absent-file case (:443). Old:

```ts
  it('task-10: refuses when lane.json is absent, naming the remedy', async () => {
```

→ new:

```ts
  it('task-10, settled by Plan 3a Task 8: refuses when lane.json is absent, naming the two acts that render it', async () => {
```

  and its pin (:462-463). Old:

```ts
      expect(r.stderr).toMatch(/lane\.json/);
      expect(r.stderr).toMatch(/ccrc doctor --fix/);
```

→ new:

```ts
      expect(r.stderr).toMatch(/lane\.json does not exist; run `ccrc doctor --fix` \(no class registry yet: /);
      // A lane with no class registry has nothing `--fix` can render from:
      // the act that renders its lane.json then is `init`, named with THIS id.
      expect(r.stderr).toContain(`(no class registry yet: \`ccrc models ${id} init codex\`)`);
```

- [ ] The two comments that this task makes false. At :787-788, old `  // cures it. \`ccrc doctor --fix\` did not — no doctor arm renders lane.json,` → new `  // cures it. \`ccrc doctor --fix\` does not — its lane.json arm re-renders,`. At :819-820, old:

```ts
  // publishes. The ABSENT-file refusal and its `doctor --fix` pin above are
  // deliberately untouched (deferred to Plan 3).
```

→ new:

```ts
  // publishes. The ABSENT-file refusal's remedy above is Plan 3a Task 8's:
  // `ccrc doctor --fix`, whose lane.json arm renders a missing manifest.
```

- [ ] Typecheck (`tsc --noEmit` does not read `server/test/`):

```bash
. "<abs scratch>/plan3a-env.sh"
cd server
"$CENSUS" "$EVID/t8-s1-tc" ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
```

  Expected: green, then `census: clean — no unit or link change, 0 fixture processes left; command exit 0`.

- [ ] **Step 2: run it red.** One foreground call, timeout ≥ 600000:

```bash
. "<abs scratch>/plan3a-env.sh"
cd server
"$CENSUS" "$EVID/t8-s2-doctor" ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'Plan 3a Task 8'
"$CENSUS" "$EVID/t8-s2-usage"  ./node_modules/.bin/vitest run test/ccgpt-usage.test.ts -t 'lane.json is absent'
```

- [ ] Expected, case by case:
  - **Green at base, deliberately:**
    - `a fixer runs on a FAIL only…`: it pins the contract R-C8 keeps, and its red is the mutation row;
    - `a remedy that names \`ccrc doctor --fix\`…`: the tree has exactly one such remedy, skills' FAIL, and `_fix_skills` exists.
  - `every _fix_<name> names a check in the table…`: RED, `expected [ 'skills' ] to include … 'codex', 'wrappers'`.
  - All 19 isolation cases: RED, thrown by `checksFunction`: `ccd/ccrc-doctor-checks has no _fix_codex() { … } at column 0`.
  - The five launcher cases: RED on their first `FIX wrappers:` match (`WRITE`, `REWRITE`, `REFUSE`, `REFUSE`, `REWRITE`). Doctor with `--fix` runs no fixer for `wrappers` yet, and each case's launcher is byte for byte what it planted.
  - The six real-run cases: RED on their first `FIX codex:` match, because no fixer runs for `codex` yet.
  - `ccgpt-usage`: 1 failed, `expected 'ccgpt-usage: refusing to publish — /t…' to match /lane\.json does not exist; run `ccrc …/` (measured on the scratch copy).
- [ ] Each run's last line is `census: clean — no unit or link change, 0 fixture processes left; command exit 1`, and the call exits 1. The reds are vitest's own exit code. The census verdict is separate: a 125 or a 126 stops the step, as in Step 0.

- [ ] **Step 3: implement.**

- [ ] `ccd/ccrc-doctor-checks`: insert directly after `_check_wrappers`' closing brace (the line after its `_dr_pass wrappers …` line):

```bash
# ── _fix_wrappers — the cure `ccrc doctor --fix` runs for `wrappers` ──────
# Spec §12 lets `--fix` "regenerate a marker-verified launcher" and forbids
# it to "overwrite an unverified launcher". A launcher is THIS check's
# measurement — `_check_codex` does not measure one, and a second verdict
# line for it would count one finding twice (`_check_accounts`'
# `launcher-absent` note) — so its cure rides this check, for a generated
# and a Codex account alike (D-3730,
# Plan 3a Task 8).
#
# THE CURE IS THE SHIPPED TREE'S OWN `ccrc wrappers`, WITH NO FLAG
# (`_fix_skills`' rule: re-run the shipped installer, never a copy of it).
# With no flag that verb overwrites exactly one class of file — a launcher
# carrying ccrc's marker whose hash still verifies (`ccrc-unmodified`), and
# it backs that one up first — writes where nothing is, and REFUSES every
# other file with its own remedy: a marked file edited since, a foreign
# file (equivalent or not), one it cannot read, one over 1 MiB, an id
# another launcher execs. So "never an unverified launcher" is the verb's
# own table, not a second rule here, and this fixer never passes `--force`
# or `--adopt`: those are the operator's.
#
# A CHILD PROCESS, never `cmd_wrappers` called in this shell: that verb
# `_ccrc_die`s on a manifest it will not trust and arms an EXIT trap for its
# staging directory, and cmd_doctor calls a fixer in ITS OWN shell. Its
# output is relayed line by line under this fixer's prefix, so its own
# `summary:` line can never be read as doctor's.
_fix_wrappers() {
  local ccrc="$BOX_TREE_DIR/ccd/ccrc" said rc=0 l
  if [ ! -f "$ccrc" ]; then
    echo "FIX wrappers: refused — the shipped tree has no \$HOME/ccrc/ccd/ccrc, so its 'ccrc wrappers' cannot be run; run 'ccrc update' (or 'ccrc install' from a checkout)"
    return 1
  fi
  said="$("${BASH:-bash}" "$ccrc" wrappers 2>&1)" || rc=$?
  while IFS= read -r l; do
    [ -z "$l" ] || printf 'FIX wrappers: %s\n' "$l"
  done <<< "$said"
  echo "FIX wrappers: ran the shipped tree's 'ccrc wrappers' with no flag (exit $rc) — it overwrites only a launcher whose ccrc marker still verifies, writes only where nothing is, and refuses every other file; the re-measurement below is the verdict"
}
```

- [ ] `ccd/ccrc-doctor-checks`: insert directly after `_check_codex`'s closing brace:

```bash
# ── _fix_codex — the cure `ccrc doctor --fix` runs for `codex` ────────────
# Spec §12's `--fix` list, as Plan 3a Task 8 lands it. cmd_doctor calls a
# fixer ONLY when its check FAILED (its `"$rc" -eq 1` guard) and then
# measures AGAIN; the verdict is that second measurement, never this
# function's word (`_fix_skills`' rule). Two rows of §12's list
# therefore live elsewhere: a missing or disabled usage timer is a WARN,
# which never reaches a fixer, so its remedy names `ccrc install`, whose
# converge is that unit's one enabler (D-3721);
# and the launcher is `_check_wrappers`' measurement, so its cure is
# `_fix_wrappers` (D-3730).
#
# WHAT IT DOES, each through the shipped tree's own installer step or the
# lane library's own writer — never a copy of either:
#   1. a GPT-lane executable (`CODEX_LANE_BINS`, the list `_check_codex`
#      compares) that is missing, not executable, or not byte-identical to
#      $BOX_TREE_DIR/ccd/<name> is placed again by `_inst_atomic`, the
#      primitive `_inst_bins` places it with;
#   2. a runtime `ccgpt-runtime check` refuses is rebuilt and re-probed by
#      `ccgpt-runtime build` — the stamp is trusted until then
#      (D-3711, Task 4);
#   3. per lane, under its lane lock: lane.json is re-rendered by its ONE
#      writer, models-op's `materialise` (no `--check`), when it is stale
#      against the roster (`_codex_lane_json_state`) or against the class
#      registry (`materialise --check true`, R7); and litellm.yaml is
#      re-rendered through the codex arm's own body,
#      `_models_litellm_lane_held`, whose compare makes a converged file a
#      no-op and whose gate stops and starts only a tier it proves this
#      lane's (the identity gate every stop path shares);
#   4. only when step 1 or 2 replaced code a running tier may hold:
#      `_inst_codex_tiers`, the install step that restarts a tier only when
#      it is this lane's own, running, and stale.
# WHAT IT NEVER DOES: edit the roster or choose a port (a row that does not
# validate is named and left); run OAuth (`ccrc codex login <id>` is the
# remedy the check prints); open anything under an authDir; signal a process
# it cannot prove is a lane's (every stop is behind `_codex_tier_ours`,
# inside steps 3 and 4); enable or disable any unit; overwrite a launcher;
# delete anything.
#
# THE WHOLE CURE RUNS IN A SUBSHELL. cmd_doctor runs each CHECK in a
# subshell but calls the FIXER in its own shell, and the library this calls
# can end the shell it runs in: `_ccrc_die` and `_models_refuse` exit, and an
# unbound variable is fatal under `set -u`. Called bare, any of those would
# end the doctor run before the re-measurement it exists for. Each lane's
# work is a nested subshell as well, so its lane lock is released as that
# lane ends — through `_codex_unlock`, the lock's only release, or by the
# subshell's own exit if the lane's work dies first — and no descriptor
# reaches the next lane or the re-measurement.
_fix_codex() {
  (
    local role="" lanes lrc=0 n src dst rt id replaced=0
    local -a ids=() missing=()
    for n in _codex_lanes _codex_row _codex_lane_json_state _codex_lock _codex_unlock \
             _codex_runtime_cli _models_node _models_roster_path _models_litellm_lane_held \
             _inst_atomic _inst_codex_tiers _box_env_value; do
      declare -F "$n" >/dev/null 2>&1 || missing+=("$n")
    done
    declare -p CODEX_LANE_BINS >/dev/null 2>&1 || missing+=(CODEX_LANE_BINS)
    if [ "${#missing[@]}" -gt 0 ]; then
      echo "FIX codex: refused — ccrc's own $(_dr_join "${missing[@]}") is not loaded, so nothing was cured; this is a bug in ccrc, not a fact about your box (the check table was sourced by something that is not ccrc)"
      exit 1
    fi
    # -f BEFORE -r, as `_check_skills` reads it. `_check_codex`
    # SKIPs a server box, so cmd_doctor never calls this there; the refusal
    # is for any other caller, because `_inst_bins` places no GPT-lane
    # executable on a server box and step 1 must not either.
    [ -f "${BOX_ENV_FILE:-}" ] && [ -r "$BOX_ENV_FILE" ] && role="$(_box_env_value "$BOX_ENV_FILE" CCRC_ROLE)"
    if [ "$role" = server ]; then
      echo "FIX codex: refused — this box records CCRC_ROLE=server, which converges nothing per account, so nothing was cured"
      exit 1
    fi
    # An unreadable roster (rc 1) and a missing jq (rc 2) are not "no codex
    # lane": each is the check's own FAIL, and nothing here can cure either.
    lanes="$(_codex_lanes)" || lrc=$?
    if [ "$lrc" -ne 0 ]; then
      echo "FIX codex: refused — which roster lanes are codex lanes could not be read (the ccrc codex: line above says why), so nothing was cured"
      exit 1
    fi
    [ -z "$lanes" ] || mapfile -t ids <<<"$lanes"
    if [ "${#ids[@]}" -eq 0 ]; then
      echo "FIX codex: nothing to cure — no codex lane in the roster"
      exit 0
    fi

    # 1. The executables, from the shipped tree, by the installer's own primitive.
    for n in ${CODEX_LANE_BINS[*]}; do
      src="$BOX_TREE_DIR/ccd/$n"; dst="$HOME/.local/bin/$n"
      if [ ! -f "$src" ]; then
        echo "FIX codex: $n: not restored — the shipped tree has no \$HOME/ccrc/ccd/$n; run 'ccrc update' (or 'ccrc install' from a checkout) to place it"
        continue
      fi
      if cmp -s "$src" "$dst" 2>/dev/null && [ -x "$dst" ]; then continue; fi
      if ( mkdir -p "${dst%/*}" && _inst_atomic "$src" "$dst" 755 ); then
        echo "FIX codex: restored \$HOME/.local/bin/$n from the shipped tree"
        replaced=1
      else
        echo "FIX codex: $n: not restored — the install step refused (its line above says why)"
      fi
    done

    # 2. The runtime: rebuilt only when its own check refuses.
    rt="$(_codex_runtime_cli)"
    if [ ! -x "$rt" ]; then
      echo "FIX codex: runtime: not rebuilt — \$HOME/.local/bin/ccgpt-runtime is not on this box (the lines above say why)"
    elif ! "$rt" check >/dev/null 2>&1; then
      echo "FIX codex: runtime: rebuilding with 'ccgpt-runtime build' — pip may take minutes"
      if "$rt" build >/dev/null && "$rt" check >/dev/null 2>&1; then
        echo "FIX codex: runtime: rebuilt, probed and current"
        replaced=1
      else
        echo "FIX codex: runtime: NOT rebuilt — 'ccgpt-runtime build' did not leave a current runtime (its reason is the ccgpt-runtime line on stderr), so the previous one, if any, stays current"
      fi
    fi

    # 3. Each lane's files, under its lane lock.
    for id in "${ids[@]}"; do
      [ -n "$id" ] || continue
      (
        local st chk ans rc err detail body roster
        roster="$(_models_roster_path)"
        if ! _codex_row "$id" >/dev/null; then
          echo "FIX codex: $id: nothing cured — its roster row does not validate (the ccrc codex: line above says why), and --fix never edits the roster or chooses a port"
          exit 0
        fi
        if ! _codex_lock "$id"; then
          echo "FIX codex: $id: nothing cured — its lane lock could not be taken (the line above says why); re-run 'ccrc doctor --fix' once it is free"
          exit 0
        fi
        st="$(_codex_lane_json_state "$id")" || st=unmeasured
        chk="$(_models_node materialise --file "$roster" --id "$id" --check true 2>/dev/null)" || chk=""
        if [ "$st" != current ] \
           || ! printf '%s' "$chk" | jq -e '.ok == true and .check == true and .changed.lane == false' >/dev/null 2>&1; then
          ans="$(_models_node materialise --file "$roster" --id "$id" 2>/dev/null)"; rc=$?
          if [ "$rc" -eq 0 ] && printf '%s' "$ans" | jq -e '.ok == true and (.wrote.lane | type) == "string"' >/dev/null 2>&1; then
            echo "FIX codex: $id: lane.json re-rendered from the roster and this lane's class registry"
          elif [ "$rc" -eq 0 ] && printf '%s' "$ans" | jq -e '.ok == true and .wrote == null' >/dev/null 2>&1; then
            echo "FIX codex: $id: lane.json NOT rendered — this lane has no class registry, and lane.json is rendered from it; run: ccrc models $id init codex"
          else
            err="$(printf '%s' "$ans" | jq -r '.error // empty' 2>/dev/null)"
            detail="$(printf '%s' "$ans" | jq -r '.detail // empty' 2>/dev/null)"
            echo "FIX codex: $id: lane.json NOT rendered — deploy/models-op.mjs answered ${err:-exit $rc}${detail:+: $detail}"
          fi
        fi
        # Its own subshell: the codex arm's body ends a refusal with
        # `_models_refuse`, which exits. The lock this lane holds is its
        # precondition, and a subshell inherits it.
        body="$( _models_litellm_lane_held "$id" 2>/dev/null )"; rc=$?
        body="${body##*$'\n'}"
        if [ "$rc" -ne 0 ]; then
          err="$(printf '%s' "$body" | jq -r '.error // empty' 2>/dev/null)"
          detail="$(printf '%s' "$body" | jq -r '.detail // empty' 2>/dev/null)"
          echo "FIX codex: $id: litellm.yaml NOT rendered — ${err:-the render exited $rc}${detail:+: $detail}"
        elif printf '%s' "$body" | jq -e '.changed == true and .restarted == true' >/dev/null 2>&1; then
          echo "FIX codex: $id: litellm.yaml re-rendered, and this lane's own LiteLLM tier restarted onto it"
        elif printf '%s' "$body" | jq -e '.changed == true' >/dev/null 2>&1; then
          echo "FIX codex: $id: litellm.yaml re-rendered"
        fi
        _codex_unlock
      )
    done

    # 4. The tiers — only when this run replaced code a running tier may hold.
    if [ "$replaced" -eq 1 ]; then
      if ( INST_ROLE="${role:-both}"; INST_DEGRADED=(); _inst_codex_tiers; [ "${#INST_DEGRADED[@]}" -eq 0 ] ); then
        echo "FIX codex: tiers: re-ran the install step that restarts a running tier only when it is this lane's own and runs code this fix replaced (its lines above)"
      else
        echo "FIX codex: tiers: re-ran the install step that restarts a verified-own stale tier, and it could not restart every one (its lines above say which)"
      fi
    fi
    echo "FIX codex: done for ${#ids[@]} codex lane(s) — no port, roster row, OAuth, credential, unidentified listener or unit enablement was touched; the re-measurement below is the verdict"
    exit 0
  )
}
```

- [ ] `ccd/ccrc`, the usage text. Old:

```
            --fix cures the checks that know how (skills: the shipped tree's
            installers into every rostered home) and measures them again
```

→ new, same two lines:

```
            --fix cures the checks that know how (skills, wrappers, codex —
            each by the shipped tree's own installer) and measures them again
```

- [ ] `ccd/ccgpt-usage.py`, five in-place replacements, none of which adds or removes a line:
  - :24-29, old:

```
     `deploy/models-op.mjs`'s materialiser (Plan 2b-1 Task 6), which every
     `ccrc models <id>` mutation runs; doctor has no `lane.json` arm. So this
     file reads the manifest if present, and REFUSES if it is absent or
     unusable, each refusal naming a remedy — the absent-file refusal's
     remedy is Plan 3's to settle (it still names `ccrc doctor --fix`, spec
     §12's planned `--fix` arm). Nothing here invents a default model.
```

  → new:

```
     `deploy/models-op.mjs`'s materialiser (Plan 2b-1 Task 6), which every
     `ccrc models <id>` mutation runs, and which `ccrc doctor --fix` runs
     where doctor FAILs a lane's lane.json (Plan 3a Task 8). So this file
     reads the manifest if present, and REFUSES if it is absent or unusable,
     each refusal naming a remedy that works on this tree. Nothing here
     invents a default model.
```

  - :241-250, old:

```
    `lane.json` is written by `deploy/models-op.mjs`'s materialiser, which
    every `ccrc models <id>` mutation runs (Plan 2b-1 Task 6); doctor has no
    `lane.json` arm, whatever the design spec's `--fix` table plans. The
    behaviour for the file itself: read it if present and well-formed, and
    REFUSE if it is absent or not valid JSON. The absent-file refusal still
    names `ccrc doctor --fix` (task-10-rulings.md (commit 4893935a) §4) —
    which remedy it should name is deferred to Plan 3, together with the
    doctor arm it points at. Per-field validation (a present-but-wrong-shape
    `probeModel`/`authDir`) happens at each field's own reader below, and
    each names a remedy that works today.
```

  → new:

```
    `lane.json` is written by `deploy/models-op.mjs`'s materialiser, which
    every `ccrc models <id>` mutation runs (Plan 2b-1 Task 6), and which
    `ccrc doctor --fix` runs where doctor FAILs a lane's lane.json (Plan 3a
    Task 8). The behaviour for the file itself: read it if present and
    well-formed, and REFUSE if it is absent or not valid JSON. The absent
    refusal names both acts that render it — `ccrc doctor --fix`, and, for a
    lane with no class registry yet, `ccrc models <id> init codex` (settling
    task-10-rulings.md (commit 4893935a) §4's deferral). Per-field validation
    (a present-but-wrong-shape `probeModel`/`authDir`) happens at each
    field's own reader below, and each names a remedy that works today.
```

  - :257-258, old:

```python
            f"ccgpt-usage: refusing to publish — {LANE_MANIFEST_PATH} does not exist; "
            "run `ccrc doctor --fix` to render it"
```

  → new:

```python
            f"ccgpt-usage: refusing to publish — {LANE_MANIFEST_PATH} does not exist; "
            f"run `ccrc doctor --fix` (no class registry yet: `ccrc models {ACCOUNT_ID} init codex`)"
```

  - :280, old ``    re-render (`ccrc models`' own; doctor has no lane.json arm yet) reproduces it, and`` → new ``    re-render (`ccrc models`' own, or `ccrc doctor --fix`'s) reproduces it, and``.
  - :319, old ``    naming the field. Doctor renders no `lane.json`.`` → new ``    naming the field. `ccrc doctor --fix` re-renders it too (Plan 3a Task 8).``.

- [ ] Parse gates, before any green run, in one call:

```bash
. "<abs scratch>/plan3a-env.sh"
bash -n ccd/ccrc-doctor-checks && bash -n ccd/ccrc && echo parsed                        # → parsed, and nothing else
python3 -c "import ast; ast.parse(open('ccd/ccgpt-usage.py').read())" && echo py-parsed   # → py-parsed
git diff --numstat "$(cat "$EVID/task8-base")" -- ccd/ccgpt-usage.py ccd/ccrc          # → each row's added and deleted counts are equal
( cd server && "$CENSUS" "$EVID/t8-s3-list" ./node_modules/.bin/vitest list test/ccrc-doctor.test.ts -t 'Plan 3a Task 8' )
grep -c '^test/ccrc-doctor\.test\.ts > ' "$EVID/t8-s3-list/run.txt"                    # → 33
```

  - `ast.parse` is used, never `py_compile`, which would write a `__pycache__` into `ccd/`.
  - The numstat compares the worktree with the task's base, before any commit exists. Line-neutral means equal counts on both rows.
  - `vitest list` loads every module, so it runs inside the census too. It omits a case that `skipIf` skips, so as root or without python the count is lower by the cases Step 4 names.

- [ ] **Step 4: run it green, plus the neighbours.** Five foreground calls, each with timeout ≥ 600000. First this task's own cases:

```bash
. "<abs scratch>/plan3a-env.sh"
cd server
"$CENSUS" "$EVID/t8-s4-new" ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'Plan 3a Task 8'
```

  Then the whole doctor file, in Step 0's three parts (its `<k>` and `<P>`, or its finer split if it made one), one call each:

```bash
. "<abs scratch>/plan3a-env.sh"
cd server
"$CENSUS" "$EVID/t8-s4-doctor-<k>" ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t <P>
```

  Then the neighbours, in one call. At `1f9fa22d` these six took about 80 s of test time, plus the census's 5 s settle per run:

```bash
. "<abs scratch>/plan3a-env.sh"
cd server
"$CENSUS" "$EVID/t8-s4-usage" ./node_modules/.bin/vitest run test/ccgpt-usage.test.ts
"$CENSUS" "$EVID/t8-s4-wrap"  ./node_modules/.bin/vitest run test/ccrc-wrappers.test.ts
"$CENSUS" "$EVID/t8-s4-sd"    ./node_modules/.bin/vitest run test/single-definition.test.ts
"$CENSUS" "$EVID/t8-s4-mac"   ./node_modules/.bin/vitest run test/macos-platform.test.ts
"$CENSUS" "$EVID/t8-s4-cite"  ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored'
"$CENSUS" "$EVID/t8-s4-tc"    ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
```

- [ ] Expected:
  - the first run: 33 passed. As root, `an install step that dies…` is skipped. With no python, the foreign-listener case is skipped;
  - the doctor file's three parts: parts 1 and 2 keep their Step 0 counts and are all green, and part 3 is its Step 0 count plus 33;
  - `ccgpt-usage`: Step 0's count (36 once Task 1 is in; an example), all green. This task re-aims one case and adds none;
  - `ccrc-wrappers`: unchanged;
  - `single-definition`: green. This task spells no `.classes.json`, no box-global LiteLLM config path and no `.ccrc/models` literal: registry facts reach it only through `_models_node`, and 248 of its 249 cases were measured green on the scratch copy. The 249th needs a git checkout;
  - `macos-platform`: green (no GNU-only spelling was added);
  - the citation corpus: green. It was measured green on the scratch copy with both edited files in place. If it reds, repair it per S6-R11 in this task's own commit, after its last edit;
  - `typecheck-tests`: green;
  - every run ends with `census: clean — no unit or link change, 0 fixture processes left; command exit 0`.

- [ ] **Step 5: the mutation table. Measure every row both ways.** "Measured" rows were run while drafting, on a scratch copy of the tree carrying this task's Step 3 and a stand-in for Task 4's table entry and `CODEX_LANE_BINS`. The implementer re-measures every row on the real tree. "Expected" rows need Task 4's fixture and are measured at execution. Run `bash -n` on the mutated file before the suite. A mutation that does not parse reds every case for a reason that is not the guard, and it does not count: measured once while drafting, when a first spelling of the subshell row left a `)` unmatched and falsely reported 19 reds.

  First stage this task's files with Step 6's `git add` line, so that each restore is proved against them. Then each row is one foreground call of the shape below.
  - `F` lists EVERY file the row edits, and each gets its own backup.
  - The suite is `test/ccrc-doctor.test.ts -t <S>`, or `test/ccgpt-usage.test.ts` for the publisher row.

```bash
. "<abs scratch>/plan3a-env.sh"
row=<row-label>; F="<every file the row edits>"; B="$EVID/t8-mut/$row"; mkdir -p "$B"
for f in $F; do cp -p -- "$f" "$B/${f//\//_}.bak"; done
# … apply the row's mutation to each file in $F …
bash -n ccd/ccrc-doctor-checks && bash -n ccd/ccrc && echo parsed    # → parsed, or the row does not count
( cd server && "$CENSUS" "$EVID/t8-mut-$row" ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t <S> )
for f in $F; do cp -p -- "$B/${f//\//_}.bak" "$f"; done
git diff --quiet -- $F && echo restored    # → restored: the worktree equals the staged task again; anything else stops the table
```

  - A deliberate red is vitest's own exit code. The census line still reads `census: clean — …; command exit 1`, and a 125 or a 126 stops the table, as in Step 0.
  - `<S>` is `'Plan 3a Task 8'` for every row except two, which run `-t 'measured in isolation'` only. In the real-run describe, those two mutations would reach a real act:
    - `a current runtime is never rebuilt` would run a real `ccgpt-runtime build`;
    - `never OAuth` would run the real `_codex_login`, which execs the lane runtime's sign-in.
  - Both rows' red counts below were measured on the isolation cases.

| Guard | Mutation | Goes red |
|---|---|---|
| the FAIL-only contract (R-C8) | in `cmd_doctor`, `"$rc" -eq 1` → `"$rc" -ne 0` in the fixer guard | `a fixer runs on a FAIL only…` (measured: 1 failed) |
| every fixer has a table entry | `_fix_codex() {` → `_fix_codexx() {` | the fixer census; every isolation case (`checksFunction` throws); every real-run case (measured: 20 failed, before the real-run cases existed) |
| a WARN never names `--fix` | append `, then run ccrc doctor --fix` to `_check_skills`' `install diffutils` WARN remedy | the remedy scan (measured) |
| a FAIL that names `--fix` has a fixer | `_fix_skills() {` → `_fix_skillz() {` | the fixer census and the remedy scan (measured: 2 failed) |
| the whole cure is a subshell | the opening `  (` → `  {` and the closing `  )` → `  }` (both, so the file still parses) | `a converged lane…`, `an install step that dies…`, `a render the codex arm refuses…` and `a lane whose lock cannot be taken…`: their `after rc=0 lockfd=` line is never printed, because the body's `exit` ends the caller (measured: 4 failed) |
| the loaded guard | its `if [ "${#missing[@]}" -gt 0 ]` → `if false` | `refuses, asking nothing, when a ccrc function it calls is not loaded` (measured) |
| a server box is refused | `if [ "$role" = server ]` → `if false` | `a server box is refused…` (measured) |
| an unreadable roster is not "none" | `lanes="$(_codex_lanes)" \|\| lrc=$?` → `\|\| lanes=""` | `an unreadable roster or a missing jq is refused…` (measured) |
| a restore that says it acted, acts | `if ( mkdir -p "${dst%/*}" && _inst_atomic "$src" "$dst" 755 ); then` → `if true; then` | isolation `a drifted, a missing and a mode-only…`, `a converged executable is never rewritten…`, `an install step that dies…` (measured: 3 failed); real-run `a drifted GPT-lane executable…` on its no-FAIL re-measurement (expected: the FIX line prints and the FAIL stands) |
| a converged file is left alone | delete the `if cmp -s … && [ -x "$dst" ]; then continue; fi` line | 11 isolation cases (measured) |
| a current runtime is never rebuilt | `elif ! "$rt" check >/dev/null 2>&1; then` → `else` | 9 isolation cases (measured) |
| the lane lock is taken | `if ! _codex_lock "$id"; then` → `if false; then` | 5 isolation cases (measured) |
| the lane lock is released through `_codex_unlock` | the per-lane `_codex_unlock` → `:` | 3 isolation cases (measured) |
| lane.json stale against the registry is cured (R7) | drop the `\|\| ! printf … '.ok == true and .check == true and .changed.lane == false'` disjunct | `lane.json current against the roster but stale against the registry…` (measured) |
| no registry is its own sentence | `elif … '.ok == true and .wrote == null' …` → `elif false` | `a lane with no class registry…` (measured) |
| a row that does not validate is left | delete the `exit 0` after the row sentence | `a roster row that does not validate is left…` (measured); real-run `a roster row whose two ports collide…` (expected) |
| the codex arm's exit is contained | `body="$( _models_litellm_lane_held "$id" 2>/dev/null )"` → a bare call | `litellm.yaml goes through the codex arm's body…` and `a render the codex arm refuses…` (measured: 2 failed) |
| tiers only after a replace | `if [ "$replaced" -eq 1 ]; then` → `if true; then` | 7 isolation cases (measured) |
| tiers after a replace | the same line → `if false; then` | 3 isolation cases (measured); real-run `a drifted GPT-lane executable…` stays GREEN, because no tier runs there. **Report that only the isolation cases bind this row.** |
| never OAuth | add `_codex_login "$id" >/dev/null 2>&1 \|\| :` after the lock | `never OAuth, never a credential, never a unit…`, the converged case and the foreign case (measured: 3 failed, the tripwire) |
| an unverified launcher is never overwritten | `wrappers 2>&1` → `wrappers --force 2>&1` in `_fix_wrappers` | `a launcher ccrc did not write…` and `a launcher ccrc wrote and someone edited since…` (measured: 2 failed) |
| the launcher fixer exists | `_fix_wrappers() {` → `_fix_wrapperz() {` | the fixer census and all five launcher cases (measured: 6 failed) |
| the publisher's remedy | restore the old refusal line | `task-10, settled by Plan 3a Task 8…` (measured: it is the Step 2 red) |
| the isolation wall | drop the `${wall}:` prefix from `runFixCodex`' PATH | **Report that no case reds**: `_fix_codex` calls no manager binary itself, so the wall is containment, not a measurement. `assertIsolationWallFirst` throws first anyway |

- [ ] **Step 6: commit.**

  Stage the files, then check the scope against the index before the commit exists. The base is the one Step 0 recorded, never `origin/main`:

```bash
. "<abs scratch>/plan3a-env.sh"
BASE="$(cat "$EVID/task8-base")"
git add ccd/ccrc-doctor-checks ccd/ccrc ccd/ccgpt-usage.py server/test/ccrc-doctor.test.ts server/test/ccgpt-usage.test.ts
git diff --quiet && echo no-unstaged-edit    # → no-unstaged-edit: no mutation was left behind
git diff --cached --name-only "$BASE"        # → exactly the five files on the git add line
```

  - If Step 4's citation repair ran, add `README.md` and `server/test/session-hook.test.ts` to the `git add` line. They are then the only other names allowed, and any other name stops the task.
  - Commit with this message, as `git commit -F - <<'EOF'` … `EOF`, then run the Global Constraints' commit-identity check:

```
feat(gpt-lane): doctor --fix cures a codex lane and its launcher

_fix_codex restores a missing or drifted GPT-lane executable from the
shipped tree, rebuilds a runtime its own check refuses, and, under each
lane's lock, re-renders a lane.json stale against the roster or the
class registry and a litellm.yaml through the codex arm's own body. It
restarts a verified-own stale tier only after it replaced code. It never
chooses a port, edits the roster, runs OAuth, opens an authDir, stops a
tier itself, or enables a unit. The whole cure runs in a subshell, so
the library's exits cannot end the doctor run.

_fix_wrappers runs the shipped `ccrc wrappers` with no flag: it
overwrites only a launcher whose ccrc marker still verifies and refuses
every other (D-3730).

The FAIL-only fixer contract stays, so the usage-timer WARN names
`ccrc install` (D-3721). A runner case
and a remedy scan pin it. The usage publisher's absent-file refusal now
names two acts that work on this tree.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

**What Task 8 deliberately does NOT do:**
- No `cmd_doctor` edit. R-C8 keeps the FAIL-only contract, so no fixer ever runs on a WARN.
- No enable, disable or restart of any unit by this task's own code. The usage timer's converge is Task 6's `_inst_enable`, and the second-writer WARN's remedy is the operator's own disable (R6).
- No re-probe of a current runtime (R-C5). The stamp is trusted until `check` refuses.
- No restart of a tier this run did not make stale, except the one the litellm render restarts itself.
- No `--force` and no `--adopt` in `_fix_wrappers`, and no per-id scope: `ccrc wrappers` has none.
- No settings-env fix. Task 3's drift row is a WARN.
- No change to `_inst_codex_tiers`, `_models_litellm_lane_held`, `_codex_lane_json_ensure`, `cmd_wrappers` or `ccd/ccd`.
- No real runtime build in any test. The runtime arm is measured in isolation only, and every real-run case asserts that no build was reached.

**Hazards later tasks must respect:**
1. **`_fix_wrappers` reaches generated launchers too.** A generated account whose marker-verified wrapper is stale against the roster is rewritten by `ccrc doctor --fix`, exactly as `ccrc install` would, and a backup is kept.
2. **A runtime rebuild is pip and can take minutes.** `--fix` is operator-run only: install's closing doctor never passes it (`_inst_doctor_tail`, ccd/ccrc:13290-13292). 3b must not run `doctor --fix` inside a lane window expecting it to be quick.
3. **The fixer holds each lane's lock while it renders.** A session's `ccrc codex start` on that lane waits for it, bounded by `_codex_ready_secs + 30`.
4. **A lane.json render rewrites all four of materialise's files** (settings.json's env block, classes.tsv, the effort file and lane.json), because materialise has one write form.
5. **The check-only `materialise` spelling is Task 4's.** If Task 4 lands a different key, this task's argv and its isolation stub change with it, in one commit.
6. **`_inst_codex_tiers` lines appear under the `install: codex tiers:` prefix** inside a `doctor --fix` transcript. Their wording is the install step's.

**Deviation entries this task cites or owes.** The controller mints each number once, in Deviations found. `missing-timer-remedy-is-ccrc-install` is Task 6's as well, and it gets one entry:
- `D-3721`: spec §12 lists "enable a missing usage timer" among `--fix`'s powers. Doctor runs a fixer only on a FAIL, and that row is a WARN, so no fixer enables any unit. The WARN's remedy names `ccrc install`, whose converge is the timer's one enabler. A runner case and a remedy scan pin both halves. (R-C8.)
- `D-3730`: spec §12 places "regenerate a marker-verified launcher" under `_check_codex`'s `--fix`. A launcher is `_check_wrappers`' measurement, so its cure is `_fix_wrappers`. That fixer runs the shipped `ccrc wrappers` with no flag, which overwrites only a launcher whose ccrc marker verifies, and it therefore reaches generated launchers as well as Codex ones. (R8.)

### Task 9: `ccrc wrappers --force` backs up a symlinked launcher as a symlink

> Resolved by the controller rulings (Task 9): R11 (the census wrapper), R13 (the live shape is stated by shape only). The critic's citation correction is adopted: the `cp -p` is at ccd/ccrc:4121. Line :4118 is inside the comment block above it.

**Files:**
- Modify: `ccd/ccrc`, `cmd_wrappers`' backup block (`cmd_wrappers` is at :3582). Measured today: the comment is at :4120 and `cp -p -- "$WRAPPER_BIN_DIR/$id" "$WRAPPER_BIN_DIR/$backup" \` at :4121. Locate with `grep -n 'cp -p -- "\$WRAPPER_BIN_DIR/\$id" "\$WRAPPER_BIN_DIR/\$backup"' ccd/ccrc`, which must find exactly one line.
- Modify: `server/test/ccrc-wrappers.test.ts`: the `node:fs` import (:44-46), and one describe appended at the end of the file. The last describe today is `ccrc wrappers: the Codex launcher target`, at :1426.
- Test: `server/test/ccrc-wrappers.test.ts`.

**Interfaces:**
- Consumes: nothing from any other task. It uses the file's own helpers: `makeHome`, `runWrappers`, `binOf`, `backupsFor`, `binEntries`, `bodyFor`, `handWritten`, `CODEX_FIXTURE`, `CODEX_ID` and `GENERATED_IDS`.
- Produces: a rewrite backup `<id>.pre-ccrc-<UTC>` that is what was at `<id>`: the symlink itself when `<id>` is a symlink, and a regular file with the same bytes, mode and mtime otherwise. So one `mv` restores it exactly.

**Why:**
- **What the backup does today, measured.** Every rewrite (`--force` on an edited or a parseable foreign file, `--adopt` on an equivalent one, and a plain run over a marker-verified file whose roster changed) copies `<id>` aside with `cp -p -- "$WRAPPER_BIN_DIR/$id" "$WRAPPER_BIN_DIR/$backup"` (ccd/ccrc:4121). Then it renames the staged text over `<id>`: `cp` to `.<id>.tmp.$$`, `chmod`, `mv -f` (:4135-4141). `mv -f` REPLACES a symlink at `<id>` and never writes through it, so the file behind the link is untouched (measured). But `cp -p` without `-P` FOLLOWS the link. Measured on a scratch fixture HOME, a codex lane whose launcher was a relative symlink to a wrapper-shaped file, rewritten under `--force`, left `codex-a.pre-ccrc-<UTC>` as a REGULAR 154-byte copy of the target's bytes. Restoring that backup by `mv`, the one act its name promises, would put a frozen second copy of the other file where the link was. The link would be gone.
- **Why it matters before any flip.** The live fleet box has a launcher of exactly this shape: a symlink to another repository's launcher, which 3b moves aside and restores (R13: stated by shape). A backup that cannot restore the link is a rollback that silently forks that launcher.
- **Why `-P`, and why it is safe.**
  - GNU `cp -P` never follows a symlink in SOURCE and copies the link itself. BSD `cp -P` without `-R` keeps the physical walk, so it copies the link too. Both userlands take it.
  - For a regular file `-P` changes nothing.
  - `-p` still carries mode and timestamps.
  - The fix was measured on a scratch copy of the tree: `cp -P -p` left `codex-a.pre-ccrc-<UTC> -> .codex-a-launcher`, and `mv` of it restored the link byte for byte.
- **Why the fixture's target is a dot-name beside the id.** A "." never matches `WRAPPER_ID_RE`, so the witness scan (`cmd_wrappers`' lock 5) and the orphan report never read the target as an account, and the case measures the backup alone. The symlink is RELATIVE, as the live shape is, which is also what makes a same-directory backup of the link resolve to the same file.

- [ ] **Step 0: record this task's base (read-only).**

  Do this before any edit, in one foreground call. As in Task 8, every bash block in this task begins by sourcing `plan3a-env.sh`:

```bash
. "<abs scratch>/plan3a-env.sh"
test -x "$CENSUS" && test -d "$EVID" || { echo "the census script or the evidence root is missing — see Global Constraints"; exit 1; }
git rev-parse HEAD > "$EVID/task9-base"
grep -c 'cp -p -- "\$WRAPPER_BIN_DIR/\$id" "\$WRAPPER_BIN_DIR/\$backup"' ccd/ccrc    # must print 1
cd server
"$CENSUS" "$EVID/t9-s0" ./node_modules/.bin/vitest run test/ccrc-wrappers.test.ts   # 60 passed at 1f9fa22d (measured); no earlier task adds a case to this file
```

  It ends with `census: clean — no unit or link change, 0 fixture processes left; command exit 0`. A 125 or a 126 stops the step, attributed and reported as in Task 8 Step 0.

- [ ] **Step 1: write the failing tests.**

- [ ] `server/test/ccrc-wrappers.test.ts`, the `node:fs` import. Old:

```ts
  chmodSync, closeSync, existsSync, ftruncateSync, mkdirSync, openSync, readdirSync, readFileSync,
  renameSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
```

→ new:

```ts
  chmodSync, closeSync, existsSync, ftruncateSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync,
  readlinkSync, renameSync, statSync, symlinkSync, utimesSync, writeFileSync,
} from 'node:fs';
```

- [ ] Append:

```ts
// ════════════════════════════════════════════════════════════════════════
// Plan 3a Task 9 — a launcher that is a SYMLINK is backed up as that symlink.
// `--force` (and every other rewrite) copies the file at `<id>` aside as
// `<id>.pre-ccrc-<UTC>` before the rename lands. The rename REPLACES a
// symlink at `<id>` rather than writing through it, so the backup must be the
// symlink too: a copy of the bytes behind it would restore, by `mv`, a frozen
// second copy of somebody else's launcher in place of the link to it.
// ════════════════════════════════════════════════════════════════════════
describe('ccrc wrappers: a rewritten launcher is backed up as what was there (Plan 3a Task 9)', () => {
  /** A wrapper-shaped launcher nobody generated, saying something else (its
   *  own config dir), so `--force` rewrites it: the foreign class's `dok = ok`
   *  arm. It sits BESIDE the id under a dot-name, which can never match
   *  WRAPPER_ID_RE, so neither the witness scan nor the orphan report reads it
   *  as an account; the id is a RELATIVE symlink to it. */
  const TARGET = '.codex-a-launcher';
  const targetText = handWritten({
    suffix: '.codex-a-elsewhere', target: 'ccrc-codex',
    note: 'another tool\'s launcher, reached through a symlink',
  });

  it('a symlinked launcher rewritten under --force is backed up as the same symlink, and one mv restores it exactly', () => {
    const home = makeHome('ccrc-wrappers-symlink-force-', { roster: CODEX_FIXTURE });
    writeFileSync(join(binOf(home), TARGET), targetText, { mode: 0o755 });
    symlinkSync(TARGET, join(binOf(home), CODEX_ID));
    const r = runWrappers(home, ['--force']);
    expect(r.code, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/^REWRITE codex-a: /m);
    // The launcher is the roster's now: a regular file that REPLACED the link
    // by a rename, and the file the link pointed at is byte for byte what it was.
    const p = join(binOf(home), CODEX_ID);
    expect(lstatSync(p).isSymbolicLink()).toBe(false);
    expect(readFileSync(p, 'utf8')).toBe(bodyFor(CODEX_FIXTURE, CODEX_ID));
    expect(readFileSync(join(binOf(home), TARGET), 'utf8')).toBe(targetText);
    const backups = backupsFor(home, CODEX_ID);
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/^codex-a\.pre-ccrc-\d{8}T\d{6}Z$/);
    const b = join(binOf(home), backups[0] ?? '');
    expect(lstatSync(b).isSymbolicLink(),
      'the backup is a regular file: the copy followed the link and saved the bytes behind it').toBe(true);
    expect(readlinkSync(b)).toBe(TARGET);
    // The one act the backup's name promises restores what was there, exactly.
    renameSync(b, p);
    expect(lstatSync(p).isSymbolicLink()).toBe(true);
    expect(readlinkSync(p)).toBe(TARGET);
    expect(readFileSync(p, 'utf8')).toBe(targetText);
    expect(binEntries(home)).toEqual([TARGET, CODEX_ID, ...GENERATED_IDS].sort());
  });

  it('a regular-file launcher is still backed up as a regular file, with its bytes and its mtime', () => {
    // The CONTROL for the row above: `-P` changes nothing for a file that is
    // not a link, and `-p` still carries the replaced file's timestamps.
    const home = makeHome('ccrc-wrappers-regular-force-', { roster: CODEX_FIXTURE });
    const p = join(binOf(home), CODEX_ID);
    writeFileSync(p, targetText, { mode: 0o755 });
    const then = new Date('2026-01-02T03:04:05Z');
    utimesSync(p, then, then);
    const r = runWrappers(home, ['--force']);
    expect(r.code, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`).toBe(0);
    const backups = backupsFor(home, CODEX_ID);
    expect(backups).toHaveLength(1);
    const b = join(binOf(home), backups[0] ?? '');
    expect(lstatSync(b).isFile()).toBe(true);
    expect(readFileSync(b, 'utf8')).toBe(targetText);
    expect(Math.round(statSync(b).mtimeMs)).toBe(then.getTime());
  });
});
```

- [ ] **Step 2: run it red.** One foreground call:

```bash
. "<abs scratch>/plan3a-env.sh"
cd server
"$CENSUS" "$EVID/t9-s2" ./node_modules/.bin/vitest run test/ccrc-wrappers.test.ts -t 'Plan 3a Task 9'
```

  Expected, measured on the scratch copy: `Tests  1 failed | 1 passed | 60 skipped (62)`, then `census: clean — no unit or link change, 0 fixture processes left; command exit 1`. The red is vitest's own exit code, and the census verdict is separate.
  - The symlink case reds with `the backup is a regular file: the copy followed the link and saved the bytes behind it: expected false to be true`.
  - The regular-file case is the CONTROL and is green at base. Its red is the drop-`-p` mutation row.

- [ ] **Step 3: implement.**

- [ ] `ccd/ccrc`, `cmd_wrappers`' backup. Old:

```bash
      # `cp -p` so the backup keeps the mode and timestamps of what it replaced.
      cp -p -- "$WRAPPER_BIN_DIR/$id" "$WRAPPER_BIN_DIR/$backup" \
```

→ new:

```bash
      # `cp -p` so the backup keeps the mode and timestamps of what it replaced,
      # and `-P` so it keeps WHAT it replaced (Plan 3a Task 9): the rename below
      # REPLACES a symlink at this path rather than writing through it, so the
      # thing moved out of the way is the LINK, and its backup must be the link
      # too. Without `-P`, cp follows it and saves the bytes behind it: a `mv`
      # of that backup would then put a frozen second copy of somebody else's
      # launcher where the link to it was. A live fleet box has a launcher of
      # exactly that shape (a symlink to another tool's launcher). `-P` changes
      # nothing for a regular file, and both userlands take it: GNU cp, and BSD
      # cp, whose `-P` without `-R` copies the link itself.
      cp -P -p -- "$WRAPPER_BIN_DIR/$id" "$WRAPPER_BIN_DIR/$backup" \
```

  The `|| _ccrc_die …` continuation line after it is unchanged.
- [ ] Parse gate: `bash -n ccd/ccrc` exits 0 and prints nothing.

- [ ] **Step 4: run it green, plus the neighbours.** One foreground call, timeout ≥ 600000. At `1f9fa22d` these four took about 65 s of test time:

```bash
. "<abs scratch>/plan3a-env.sh"
cd server
"$CENSUS" "$EVID/t9-s4-wrap" ./node_modules/.bin/vitest run test/ccrc-wrappers.test.ts
"$CENSUS" "$EVID/t9-s4-cite" ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored'
"$CENSUS" "$EVID/t9-s4-mac"  ./node_modules/.bin/vitest run test/macos-platform.test.ts
"$CENSUS" "$EVID/t9-s4-tc"   ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
```

- [ ] Expected:
  - `ccrc-wrappers`: `Tests  62 passed (62)`, measured on the scratch copy. That includes every existing backup case: each reads its backup with `readFileSync`, which a regular file still satisfies;
  - the citation corpus: `13 passed`, measured on the scratch copy with this edit in place. The comment adds nine lines to `ccd/ccrc` below :4120, and the README carries no `ccd/ccrc:<line>` citation (measured: 0). If it reds, repair it per S6-R11 in this task's own commit;
  - `macos-platform`: green (`cp -P -p` is not a GNU-only spelling);
  - `typecheck-tests`: green;
  - every run ends with `census: clean — no unit or link change, 0 fixture processes left; command exit 0`.

- [ ] **Step 5: the mutation table. Measure every row both ways.**

  First stage this task's two files with Step 6's `git add` line. Then each row is one foreground call. Every row edits `ccd/ccrc` alone:

```bash
. "<abs scratch>/plan3a-env.sh"
row=<row-label>; B="$EVID/t9-mut/$row"; mkdir -p "$B"; cp -p -- ccd/ccrc "$B/ccrc.bak"
# … apply the row's mutation to ccd/ccrc …
bash -n ccd/ccrc && echo parsed    # → parsed, or the row does not count
( cd server && "$CENSUS" "$EVID/t9-mut-$row" ./node_modules/.bin/vitest run test/ccrc-wrappers.test.ts )
cp -p -- "$B/ccrc.bak" ccd/ccrc
git diff --quiet -- ccd/ccrc && echo restored    # → restored; anything else stops the table
```

  - Each row runs the whole file, which took about 16 s at `1f9fa22d`, because the last row also reds one of the file's own cases.
  - A deliberate red reads `census: clean — …; command exit 1`. A 125 or a 126 stops the table.

| Guard | Mutation | Goes red |
|---|---|---|
| a symlink is backed up as the symlink | drop `-P` (the pre-task line) | `a symlinked launcher rewritten under --force is backed up as the same symlink…` (measured: it is the Step 2 red) |
| the same, spelled the other way | `cp -P -p` → `cp -L -p` | the same case (expected: `-L` follows, as bare `cp` does) |
| the backup keeps the replaced file's timestamps | drop `-p` (`cp -P -- …`) | `a regular-file launcher is still backed up as a regular file, with its bytes and its mtime` (measured: `expected 1790793387442 to be 1767323045000`). **Report that the symlink case stays green**: it asserts no link mtime |
| the rewrite never writes through the link | replace the `mv -f -- "$tmp" "$WRAPPER_BIN_DIR/$id"` with `cat -- "$tmp" > "$WRAPPER_BIN_DIR/$id"` | the symlink case: the target's bytes change (`readFileSync(TARGET)`), and `<id>` is still a link (expected, to measure). The file's own read-only case (`rewrites through a temp file and a rename…`) reds too |

- [ ] **Step 6: commit.**

  Stage the files, then check the scope against the index before the commit exists, against the base Step 0 recorded:

```bash
. "<abs scratch>/plan3a-env.sh"
BASE="$(cat "$EVID/task9-base")"
git add ccd/ccrc server/test/ccrc-wrappers.test.ts
git diff --quiet && echo no-unstaged-edit    # → no-unstaged-edit: no mutation was left behind
git diff --cached --name-only "$BASE"        # → exactly ccd/ccrc and server/test/ccrc-wrappers.test.ts
```

  - If Step 4's citation repair ran, add `README.md` and `server/test/session-hook.test.ts` to the `git add` line. They are then the only other names allowed, and any other name stops the task.
  - Commit with this message, as `git commit -F - <<'EOF'` … `EOF`, then run the Global Constraints' commit-identity check:

```
fix(wrappers): back up a symlinked launcher as the symlink

A rewrite copies the file at <id> aside before renaming the new text
over it. The rename replaces a symlink at <id> rather than writing
through it, but the backup's `cp -p` followed the link and saved the
bytes behind it. Restoring that backup by `mv` would put a frozen copy
of another tool's launcher where the link was. `cp -P -p` keeps the link
itself. For a regular file nothing changes, and both userlands take the
flag.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

**What Task 9 deliberately does NOT do:**
- No change to how the new text lands (`cp` to a dot-temp, `chmod`, `mv -f`). It already replaces a link without writing through it, which the new case pins.
- No change to `--dry-run`'s wording, or to which classes rewrite.
- No change to `_inst_keep_aside`'s `cp -p` (ccd/ccrc:13447) or to `_plat_cp_replace` (:431-435). A keep-aside of a symlinked personal file at an install destination has the same shape, but it is not this task's measured defect, and no such file was measured on either box.

**Hazards later tasks must respect:**
1. **A backup that is a RELATIVE symlink resolves against the directory it sits in.** Moved anywhere but `$HOME/.local/bin` it points at nothing, and only a `mv` back to `<id>` restores what was there. 3b's rollback step must be that `mv`, never a `cp` of the backup, which would follow the link.
2. **`_inst_keep_aside` still follows symlinks** (not measured as a live case). A later task that lets the install spine keep aside a file that can be a link owes the same `-P`.


### Task 10: The cutover rehearsal, in fixtures: today's live shape is inert, a flip converges, a flip back converges

**Files:**
- Modify: `server/test/codexLaneFixture.ts`. Append the live-shape block (Step 1) at the end of the file. It adds no `describe`, for the reason the module's own header gives (`codexLaneFixture.ts:1-5`).
- Modify: `server/test/installTreeFixture.ts`. Add five `TREE_FILES` entries directly after `'deploy/account-op.mjs',` (`grep -n "^  'deploy/account-op.mjs',$" server/test/installTreeFixture.ts` finds exactly one line).
- Modify: `server/test/ccrc-install.test.ts`
  - the `node:fs` import (`:72-76`), widened in place by `renameSync`;
  - the one `./codexLaneFixture.js` import (`:86-92`), widened in place and never duplicated;
  - one new line, `import { verifyMarker } from '../../shared/mark.mjs';`, directly below the `installTreeFixture` import (`:85`);
  - `startLane`'s docstring (`grep -n 'the fixture tree carries no models-op.mjs' server/test/ccrc-install.test.ts`). Step 1 makes it false, so it becomes "through the REPOSITORY's ccrc, as every `models` verb in this file runs";
  - the rehearsal block, appended at the end of the file (Step 2).
- Modify: `server/test/ccrc-update.test.ts`. Widen the `./codexLaneFixture.js` import (`:55-58`) in place, and append one describe at the end of the file (Step 2).
- Scratch only, never committed: a disposable `git archive` copy of the plan's base, and what Step 3 appends to that copy: this task's live-shape block (to `codexLaneFixture.ts`), its five `TREE_FILES` lines (to `installTreeFixture.ts`) and the MEASURE case (to `ccrc-install.test.ts`).
- **Not** a new `codex-cutover-rehearsal.test.ts`, although the skeleton names that file. The reason is under Why.

**Interfaces:**
- Consumes:
  - `$CENSUS`, the R11 wrapper named in Global Constraints and invoked as `"$CENSUS" <evidence-dir> <cmd…>`. It prints `census: clean …` or `census: FAIL …`, and exits 125 when a unit or enablement link changed, 126 when a fixture process survived, and otherwise with the command's own code (F10). Its body is written once, in Global Constraints, and never restated. `$SCRATCH`, `$CENSUS` and `$EVID` come from `$SCRATCH/plan3a-env.sh` (Global Constraints), which every bash block below sources first (F2).
  - Task 1, under operator ruling Z (Z1, Z2):
    - an `external` row's probe runs today's path, byte for byte, failure path included, through `_fetch_codex`, which Task 1 does not edit: `_models_run_probe`'s scrub; the token-directory default, still the one code line in `ccd/ccrc-models-probe` that carries `:-$HOME/.handoff/chatgpt-auth}`; the interpreter beside the `litellm` on PATH, run as `<it> -` with no `-I`; and no `LITELLM_*`, `CCRC_CODEX_PYTHON` or `CCRC_PROBE_*` export;
    - so the hourly refresh probes, materialises and renders for an external lane with a codex registry exactly as the base does, and `_check_models` is unchanged.
  - Task 2, for ruling Z3 (it owns `deploy/models-op.mjs`' `init` arm, the one creator of a class registry): `ccrc models <id> init codex` on a row that is not `exec.kind: "codex"`, an `external` row included, exits 1 with one JSON refusal, `{ ok: false, error: "codex-registry-needs-codex-lane", detail }` (held in `INIT_EXTERNAL_REFUSAL`), whose detail names the remedy, `Flip the lane to "codex" first (Plan 3b)`. It writes nothing and runs no probe. A registry that already exists is untouched, and `set-subagent` on it still re-materialises (`plantLiveShape` relies on that).
  - Task 2 (Z1, Z4):
    - `_models_litellm`'s external arm keeps its bytes on a roster with no codex row: the box-global path (`CCGPT_CONFIG` still honoured), the `pgrep` and the bare `ccgpt stop`;
    - while the roster carries any `exec.kind: "codex"` row, or while the lane library cannot say which rows are, a stop the arm would owe is refused as `{ ok: false, error: "restart-failed", detail }` at exit 1, before any write. The detail carries `the roster names codex-kind lane(s) <id>[, <id>…]` and never tells the operator to run `ccgpt stop`. With nothing running on the config, the arm renders as today.
  - Task 4:
    - `codex` sits in `CCRC_DOCTOR_CHECKS`, and an empty codex population prints exactly one `SKIP codex:` line.
    - Lane state left behind for an id flipped back to `external` is flagged with Task 4's `lane state is left under <root>/<id>, and '<id>' is not a Codex lane in …` sentence. This task assumes class `WARN`, held in `FLIP_BACK_LEFTOVER_CLASS`.
  - Task 5: a codex lane whose own tiers run current code gets `PASS codex:` lines only.
  - Task 6:
    - Files: `deploy/systemd/ccrc-codex-usage@.service` and `deploy/systemd/ccrc-codex-usage@.timer`.
    - Placement: `_inst_units` places the pair on `fleet` and `both`, on Linux.
    - Convergence: `_inst_enable` runs `systemctl --user enable --now ccrc-codex-usage@<id>.timer` for each roster codex lane, and `disable --now` for any enabled instance whose id is no longer a codex lane.
    - While `ccgpt-usage@<id>.timer` is enabled for the same id, the enable is withheld. `INST_DEGRADED` then names the word held in `USAGE_DEGRADED` (assumed `codex-usage`; Step 0 re-derives it). `_check_codex` gives a WARN naming `ccgpt-usage@<id>.timer`, and the remedy on the next line names `systemctl --user disable --now ccgpt-usage@<id>.timer`.
    - Fixture stubs: `ccrcEnv`'s `systemctl` stub creates `~/.config/systemd/user/timers.target.wants/ccrc-codex-usage@<id>.timer` on `enable --now` and removes the link on `disable --now`, as systemd's own `enable` and `disable` do. `updateEnv`'s stub only records and answers `disable --now`, which suffices because the update case rosters no codex lane. The converge reads the links itself and never asks `systemctl`.
  - Task 7: `ccrc uninstall` removes `ccrc-codex-usage@.{service,timer}` and never names `ccgpt-usage`.
  - Plan 2b-2's fixtures:
    - from `codexLaneFixture.ts`: `codexRoster`, `codexAuthDir`, `authDirOf`, `freeLanes`, `plantSystemd`, `killLaneProcesses`, `registerLaneCleanup`, `trackChild`, `laneUnits`, `laneAnswer`, `portAccepts`, `eventually`, `spineRunCalls` and `assertSpineFrontContained`;
    - from `ccrc-install.test.ts`: `freshBox`, `gitInit`, `treeRoot`, `runInstall`, `ccrcEnv`, `READY`, `REPO_CCRC`, `plantRuntimeTemplate`, `realPy`, `systemctlCalls`, `unitDir`, `dotCcrc`, `read`, `runtimeDir` and `laneDir`;
    - from `ccrc-update.test.ts`: `freshUpdateBox`, `plantOldBox`, `plantCoordDb`, `packRelease`, `fullTree`, `runUpdate`, `updateEnv`, `BASH`, `REPO` and `itLinux`;
    - `verifyMarker` (`shared/mark.mjs:156`).
- Produces:
  - `codexLaneFixture.ts` exports:
    - the shape: `REHEARSAL_LANES`, `externalCodexRow(id)`, `REHEARSAL_REGISTRY`, `rehearsalCatalogue(fetchedAt)`, `writeRehearsalCatalogue(home, id, fetchedAt)`, `FOREIGN_PATHS`, `ForeignEntry`, `foreignSnapshot(home, except?)` and `plantLiveShape(home, ccrcModels)`;
    - doctor: `doctorClasses(stdout)`, `doctorTable(checksFile)`, `STATE_CHANGING` and `stateCallsNaming(argv, unit)`;
    - the hourly refresh and the external arm: `PROBE_ENV_VALUES`, `PROBE_ENV_PRESENCE`, `ForeignProbeCall`, `foreignProbeCalls(home)`, `foreignCcgptCalls(home)`, `unitExecOf(home, unit)`, `assertForeignFront(env, home)`, `spawnForeignProxyStandIn(home)`, `stopForeignProxyStandIn(child)`, `withForeignProxyRunning(home, act)`, `restoreForeignConfig(home)`, `RefreshObservation`, `observeHourlyRefresh(home, harnessEnv, realPython)` and `liveShapeRefreshes(home, harnessEnv, realPython)`.
  - `TREE_FILES` gains `ccd/ccrc-models-probe`, `deploy/models-op.mjs`, `deploy/litellm-config.template.yaml`, `shared/modelenv.mjs` and `shared/litellm.mjs`.
  - `ccrc-install.test.ts` gains the describe `Plan 3a Task 10 — the cutover rehearsal` with six cases, and the measured literal `BASE_LIVE_SHAPE`.
  - `ccrc-update.test.ts` gains the describe `Plan 3a Task 10 — ccrc update onto this tree over today's live shape` with one case.

**Why:**
- **The merge is the rollout.**
  - Every merge to `main` becomes a dev prerelease within minutes, and both boxes follow dev automatically (CLAUDE.md, "Deploy = release + rollout"; D-3705). The fleet box's live shape therefore meets Tasks 1–9 with no runbook in between.
  - That shape, stated by shape only (R13):
    - two `external` rows with codex telemetry, `homeAble` and a palette hue, and no ports, no `authDir` and no secrets file, one of which carries a codex class registry;
    - one lane's launcher is a symlink to another repository's launcher, and the other lane's is a small file that execs it by path;
    - that repository's flat usage timer is enabled, and so is one instance of its usage template;
    - its box-global LiteLLM config is present;
    - its LiteLLM install is on PATH, and the token directory the probe defaults to is lane 1's OAuth directory;
    - there is no ccrc runtime and no `~/.ccrc/codex/`.
  - `plantLiveShape` builds exactly that, with fixture ids.
- **What "inert" means, by operator ruling Z (2026-10-01): the merge changes nothing an external lane does.** Five measurements:
  1. No byte, mode or link target changes at any path another repository owns (`foreignSnapshot`), except where the base's own hourly refresh writes, and there the tip writes exactly the base's bytes (5, below). The key-bearing paths, each lane's `auth.json` and the other repository's env file, are measured by `lstat` alone and never opened (Global Constraints), so a rewrite of the same bytes still shows.
  2. No state-changing `systemctl` verb and no `systemd-run` names a `ccgpt-*` unit. Reads are allowed, because Task 6's second-writer check (R6) has to read whether the other repository's instance is enabled.
  3. No runtime, no lane state and no ccrc usage instance appear.
  4. Every doctor check keeps its base class, `models` included, and `codex` answers one SKIP (Z7).
  5. The hourly refresh does exactly what the base's did: the same probe environment, the same rendered bytes, and the same `ccgpt stop` decision, on both arms of that decision (Z1, Z7).
- **"Before" is the base tree, and it is measured, never assumed (critic #1, Z7).**
  - Step 3 runs this task's own fixture code on a disposable copy of the base, through the same calls the live case makes: both install passes' closing doctor, the two hourly refreshes (`liveShapeRefreshes`) and the doctor after them. The answer is pasted into `BASE_LIVE_SHAPE`, and the live case asserts that the tip's answer equals it.
  - Measured at drafting, on a copy of `4ec8926a` (its tree outside `docs/` is `1f9fa22d`'s): 39 checks in each doctor map, two WARNs, no FAIL and `models: PASS`. Both refreshes exited 0, each probed once through `~/.handoff/chatgpt-auth` and rendered the box-global config, and the second ran `ccgpt stop` once. On the same copy, `init codex` on the lane-2 analog created a registry: the hazard ruling Z3 closes.
- **Two refreshes, because the stop decision has two arms.**
  - At drafting the live box's lane 1 was idle, so its hourly refresh rendered and stopped nothing. Since 2026-09-30 lane 1's tiers are measured running, so a changed render on today's live box takes the second arm below, the one that runs the bare stop. A rehearsal that ran only the first arm would pass a tip whose external arm never stops at all, or one whose Z4 guard fires on today's shape.
  - So the second refresh runs after the other repository has re-rendered its config, and while its proxy runs on it. There the base runs its bare `ccgpt stop` once, and the tip must too.
- **The hourly unit is run exactly as the unit runs it.**
  - `ccrc-models.service` is a `Type=oneshot` whose `ExecStart=%h/.local/bin/ccrc models refresh --all` (`deploy/systemd/ccrc-models.service:11`). A oneshot fails exactly when that command exits non-zero, and the refresh loop returns 1 whenever any row failed (`ccd/ccrc:10243`).
  - `observeHourlyRefresh` reads `ExecStart` and `PATH` from the *installed* unit, expands `%h`, and runs that argv through the placed launcher. That is why Step 1 adds `models-op.mjs`, its two imports, the probe and the template to `TREE_FILES`: `models-op.mjs` imports both `.mjs` files at load, so a tree missing either fails every `models` verb with `ERR_MODULE_NOT_FOUND`.
  - The unit's `PATH` is prepended to the harness `PATH` rather than used alone. The fixture bin stays first, so containment holds, and `node` still resolves on runners that keep it outside `/usr/bin`.
  - Two fixture departures, each named in `observeHourlyRefresh`. The install harness's `python3` is a stub that refuses every program but its own, and the live box's `~/.local/bin` holds none, so a directory holding only a link to the real interpreter goes first: the probe's normaliser needs one. And every probe name, `CCRC_MODELS_PROBE_FIXTURE` and `CCGPT_CONFIG` are dropped, because a user unit's environment is the manager's, which carries none of them.
  - The other repository's interpreter is a RECORDER, planted where the probe's external path looks for it: beside the `litellm` on PATH. So the probe environment is a measurement. It records the values of six non-secret names and only the presence of three credential names, and it never opens a token directory.
- **Containment, now that the external arm is live code at the tip (Z1).** On the fleet box the arm is dangerous to run for real: the real `ccgpt stop` stops a lane's units by name, and `CCGPT_CONFIG`, which a GPT-lane session can carry, points `_models_litellm_path` at a real config.
  - So every run that can reach the arm drops `CCGPT_CONFIG` (`REHEARSAL_ENV`), and before it runs, `assertForeignFront` proves that `ccgpt` and `litellm` resolve to this HOME's stand-ins.
  - The running proxy is a node sleeper whose argv carries the fixture config's path, so `pgrep -f` matches it and no live process. It binds nothing and expires on its own (F8).
- **Z3, in the live case.** `init codex` on the lane-2 analog, the external lane with no registry, is the wrong-lane hazard itself: on the base it creates a registry, and the next hourly refresh would probe that lane through the default token directory, which is lane 1's. At the tip it refuses by name, writes nothing and runs no probe. Lane 1's existing registry is pinned byte-identical through the whole case.
- **Z4, end to end.**
  - After codex-a's flip in Plan 3b's order, codex-b stays external and is given a registry by file: a pre-3a one, since no `init` can make it now.
  - With the other repository's proxy up on the box-global config, `ccrc models litellm codex-b` owes a stop. The bare `ccgpt stop` names lane 1's units, which are codex-a's own tiers now. So the arm must refuse `restart-failed`, write nothing and run no `ccgpt`, and codex-a's shim must still answer.
  - With nothing running there is nothing to stop, and the render lands as it does today: Z4 guards the stop, never the render.
- **Update is its own leg.** `cmd_update` runs the staged tree's `bash <tree>/ccd/ccrc install` (`ccd/ccrc:16183`), so a second install is the update's spine, and the live case runs two. The real update (fetch, verify, backup, the staged spine, the gate) is the one `ccrc-update.test.ts` case. It uses the `fullTree` release the suite already packs, on the box of the "codex steps ride the staged spine" describe (`ccrc-update.test.ts:11569`), at that fixture's role `both`, which takes the same codex and usage arms as `fleet` (R2).
- **The flip follows Plan 3b's order: launcher aside, roster edit, wrappers, refresh, litellm, enable, start.**
  - The enable is the spine's own converge. R-C10's targeted route equals it by design, and the converge is what the next auto-update would run anyway.
  - The operator's own acts on the other repository's units appear as what `systemctl --user disable|enable` does to `timers.target.wants/`. The fixture performs them where the runbook places them; ccrc never does (R6).
  - The two steps that need a real LiteLLM (the refresh, and the one publisher run) are stood in for by the files each leaves behind. The default suite has no real LiteLLM (Global Constraints), and Task 1's two-lane case and `ccgpt-usage.test.ts` own that behaviour.
  - The adopted OAuth directory is part of the foreign snapshot, so adoption by path (§9.2) is measured rather than assumed.
  - `<id>.pre-ccrc-<UTC>` is the name `cmd_wrappers`' own backup uses. A "." can never appear in an id, so doctor never reads the file as an account (`ccd/ccrc:4110-4119`).
- **The flip back follows the carry-forward's rollback order.**
  - `ccrc codex stop` runs first, because the other repository's stop stops units by name and those are ccrc's tier names too (critic #7).
  - Then the roster backup goes back byte for byte, ccrc's wrapper is removed only after `verifyMarker` answers `ccrc-unmodified`, and the old launcher comes back by `mv`, so a symlink stays a symlink.
  - Lane state is kept (§13), so doctor must flag the leftover lane state, in Task 4's `lane state is left under …` WARN, and nothing else.
  - The roster backup leaves no codex row, so from then on the lane is on today's external path again, and Z4's guard has nothing to see.
- **The out-of-order case is R6, end to end.** A flip made while the other repository's instance timer is still enabled must degrade rather than enable, and doctor must name the operator's own disable. After that disable, the next converge enables ccrc's instance. Task 6 owns the unit-level cases; this is 3b's steps c and f run in the wrong order on a real spine. Its lane has no registry, and ruling Z3 lets it gain one only after the flip, as the case does.
- **Why the existing suites, not a new file.**
  - The harness the rehearsal drives is module-private: `ccrcEnv`, `runInstall`, `freshBox`, `gitInit`, `plantRuntimeTemplate`, `systemctlCalls` and `unitDir` in `ccrc-install.test.ts`, and `updateEnv`, `runUpdate`, `fullTree` and `packRelease` in `ccrc-update.test.ts`.
  - A `.test.ts` cannot import another `.test.ts`: doing so registers that suite a second time (`installTreeFixture.ts:1-11`). A new file would need a third copy of several hundred harness lines, which is the drift `installTreeFixture.ts` was created to end.
  - The fixture both suites share goes in `codexLaneFixture.ts`.
- **Red-first.**
  - The behaviour rehearsed here landed red-first in Tasks 1–9.
  - This task's own reds are, first, the baseline case, which stays red until Step 3's measurement is pasted in, and second, the mutation table (Step 5), which un-lands each piece, ruling Z's guards included, and names the case that reds.
- **Containment.**
  - Every suite command runs under `$CENSUS` (R11).
  - Fixture ids are `codex-a` and `codex-b`, and Step 0 checks that neither is a rostered id on this box.
  - Real listeners bind only kernel-chosen ports (`freeLanes`), and `killLaneProcesses` runs in `afterEach`.

- [ ] **Step 0: Record the base and check what this task consumes (read-only).**

```bash
. "<abs scratch>/plan3a-env.sh"
cd "$(git rev-parse --show-toplevel)"
git merge-base origin/main HEAD > "$SCRATCH/t10-base"   # later blocks read it back; no block keeps a variable (F2)
mkdir -p "$EVID"
test -x "$CENSUS" && echo census-ok          # expected: census-ok (else write the Global Constraints' census-run.sh first)
# R11: no fixture id is rostered on this box (a count, never a list)
jq -r '.accounts[].id' "$HOME/.ccrc/accounts.json" | grep -cxE 'codex-a|codex-b|ext-a|ext-b|gen-a'   # expected: 0
# What Tasks 2, 4 and 6 put where this task reads them. Stop on any miss:
ls deploy/systemd/ccrc-codex-usage@.service deploy/systemd/ccrc-codex-usage@.timer
grep -cE '^  models codex( |$)' ccd/ccrc-doctor-checks   # expected: 1 (Task 4 puts codex on models' own line)
grep -n 'INST_DEGRADED+=(' ccd/ccrc          # read it: the usage enable's word is USAGE_DEGRADED below
# Ruling Z: what Tasks 1 and 2 keep and add. Stop on any miss:
grep -cF ':-$HOME/.handoff/chatgpt-auth}' ccd/ccrc-models-probe   # expected: 1 (Z1: the external path keeps its default, on one code line; M1 mutates it)
grep -cF 'ccgpt stop >/dev/null 2>&1' ccd/ccrc                     # expected: 1 (Z1: the external arm keeps its bare stop)
grep -cF 'if blocked="$(_models_litellm_stop_blocked)"; then' ccd/ccrc   # expected: 1 (Task 2's Z4 guard; M2 and M3 mutate this line)
grep -cF "if (a.probe === 'codex' && !(isObj(account.exec) && account.exec.kind === 'codex')) {" deploy/models-op.mjs   # expected: 1 (Task 2's Z3 guard; M4 mutates this line)
grep -c "'codex-registry-needs-codex-lane'" deploy/models-op.mjs   # expected: 1 (Z3's refusal word, held in INIT_EXTERNAL_REFUSAL below)
```

- [ ] **Step 1: The live-shape fixture, and the tree the hourly unit runs.**

Append to `server/test/codexLaneFixture.ts`. The block uses only what the module already imports and exports at the base (its header names them), so Step 3 can copy it unchanged onto the base tree. At drafting it was typechecked with Step 2's block by the server's own `tsc -p test/tsconfig.tests.json`, and run on the base by Step 3's MEASURE case, both in a disposable copy of `4ec8926a`:

```ts
// ── Plan 3a Task 10 — the live shape (begin) ─────────────────────────────
// The fleet box's live SHAPE before any roster row is flipped, in fixture
// vocabulary (ruling R13: the plan and this file state it by shape only):
//   - two `external` rows whose telemetry is codex, provider openai, homeAble,
//     with a palette hue, and with no ports, no authDir and no secretsFile;
//   - the lane-1 analog `codex-a` already carries a codex class registry and
//     a catalogue; the lane-2 analog `codex-b` carries an effort file only;
//   - `codex-a`'s launcher is a symlink to another repository's launcher, and
//     `codex-b`'s a small file that execs it by path; neither carries a marker;
//   - that repository's launcher, shim and publisher in ~/.local/bin, its flat
//     usage pair (enabled), its usage template pair with an ENABLED instance
//     for `codex-b`, its box-global LiteLLM config and its shared env file;
//   - that repository's LiteLLM install: a `litellm` on PATH whose directory
//     holds the interpreter the probe's EXTERNAL path runs (here a RECORDER),
//     and the token directory that path defaults to, which is lane 1's;
//   - each lane's OAuth directory, 0700, holding an auth.json at 0600.
// No ccrc runtime and no ~/.ccrc/codex/. `codex-a`/`codex-b` are fixture ids
// (ruling R11): never a rostered id on any box.
//
// Written against what this module already imports and exports on the plan's
// BASE (`fs`, `path`, `spawn`, `spawnSync`, `ChildProcess`, `createHash`,
// `codexRoster`, `codexAuthDir`, `trackChild`, `assertSpineFrontContained`), so
// Plan 3a Task 10 Step 3 can append this block unchanged to the BASE tree's
// copy of this module and measure the base with the same code (ruling Z7:
// "before" is measured, never assumed).
// ─────────────────────────────────────────────────────────────────────────

export const REHEARSAL_LANES = ['codex-a', 'codex-b'] as const;

/** An `external` row in the live rows' shape: kind and provider in `exec` and
 *  nothing else there; homeAble, with a palette hue (the fixture's, not theirs). */
export function externalCodexRow(id: string): Record<string, unknown> {
  return {
    id, label: id, configDirSuffix: `.claude-${id}`,
    exec: { kind: 'external', provider: 'openai' }, homeAble: true, hue: 'violet', telemetry: 'codex',
  };
}

/** The class registry the lane-1 analog carries: fixture model ids only
 *  (`gpt-x`, `probe-model`), valid against `rehearsalCatalogue`. */
export const REHEARSAL_REGISTRY = {
  probe: 'codex',
  classes: { haiku: 'probe-model', sonnet: 'gpt-x', opus: 'gpt-x', fable: null },
  subagent: 'sonnet',
  discovery: 'catalogue',
  effort: { haiku: 'high', sonnet: 'high', opus: 'high', fable: 'high' },
} as const;

/** Its catalogue, fetched at `fetchedAt`: UNIX SECONDS, the probe's unit. */
export function rehearsalCatalogue(fetchedAt: number): Record<string, unknown> {
  const m = (id: string): Record<string, unknown> => ({
    id, label: id, context: null, maxContext: null, efforts: ['low', 'medium', 'high'],
    hidden: false, priceIn: null, priceOut: null,
  });
  return { probe: 'codex', fetchedAt, stale: false, models: [m('gpt-x'), m('probe-model')] };
}

/** `~/.ccrc/models/<id>.json`: what a passing refresh leaves, or its age. */
export function writeRehearsalCatalogue(home: string, id: string, fetchedAt: number): void {
  const dir = path.join(home, '.ccrc', 'models');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.json`), `${JSON.stringify(rehearsalCatalogue(fetchedAt))}\n`);
}

const FOREIGN_MARK = '# FOREIGN-FIXTURE-3a: another repository owns this file';

/** The names the probe's interpreter is asked about, one list for the recorder
 *  below and for `observeHourlyRefresh`'s scrub (single definition). VALUES are
 *  recorded for the first list, PRESENCE only for the second: a credential's
 *  value never reaches a file, even a fixture's. */
export const PROBE_ENV_VALUES = [
  'CHATGPT_TOKEN_DIR', 'CODEX_CLIENT_VERSION', 'LITELLM_LOCAL_MODEL_COST_MAP',
  'CCRC_CODEX_PYTHON', 'CCRC_PROBE_ACCOUNT', 'CCRC_PROBE_PROG',
] as const;
export const PROBE_ENV_PRESENCE = ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'] as const;

/** The Codex `/models` body, in the endpoint's own shape (the probe's codex
 *  normaliser: `slug`, `display_name`, `supported_reasoning_levels`). */
const FOREIGN_MODELS_BODY = JSON.stringify({
  models: ['gpt-x', 'probe-model'].map((slug) => ({
    slug, display_name: slug, supported_reasoning_levels: ['low', 'medium', 'high'].map((effort) => ({ effort })),
  })),
});

/** The interpreter beside that repository's `litellm`, which the probe's
 *  external path runs as `<it> -` with its program on stdin. A RECORDER: it
 *  drains the program, appends one tab-separated line per call to
 *  `$HOME/foreign-probe-calls` (`argv=…`, then each name's value or presence),
 *  and answers the `/models` body. It never opens the token directory (spec §9:
 *  existence and mode only), and it is plain sh, so no python resolves for it. */
const FOREIGN_PYTHON = [
  '#!/bin/sh',
  FOREIGN_MARK,
  'cat >/dev/null',
  '{',
  '  printf \'argv=%s\' "$*"',
  `  for n in ${PROBE_ENV_VALUES.join(' ')}; do`,
  '    if printenv "$n" >/dev/null; then printf \'\\t%s=%s\' "$n" "$(printenv "$n")"; else printf \'\\t%s=<unset>\' "$n"; fi',
  '  done',
  `  for n in ${PROBE_ENV_PRESENCE.join(' ')}; do`,
  '    if printenv "$n" >/dev/null; then printf \'\\t%s=<set>\' "$n"; else printf \'\\t%s=<unset>\' "$n"; fi',
  '  done',
  '  printf \'\\n\'',
  '} >> "$HOME/foreign-probe-calls"',
  `printf '%s\\n' '${FOREIGN_MODELS_BODY}'`,
  '',
].join('\n');

/** The box-global LiteLLM config the external arm renders, and the `.prev`
 *  copy its write keeps beside it (`deploy/models-op.mjs`'s litellm op). */
const FOREIGN_RENDER = '.handoff/litellm-config.yaml';
const FOREIGN_RENDER_PREV = `${FOREIGN_RENDER}.prev`;
/** That repository's LiteLLM install: fixture path, its shape only. */
const FOREIGN_LITELLM_BIN = '.local/share/foreign-litellm/bin';

/** Every regular file the shape puts at a path another repository owns:
 *  [HOME-relative path, mode, bytes]. The launcher is a RECORDER, so a bare
 *  `ccgpt stop` from ccrc is a measurement (`$HOME/foreign-ccgpt-calls`). */
const FOREIGN_FILES: ReadonlyArray<readonly [string, number, string]> = [
  ['.local/bin/ccgpt', 0o755,
    `#!/bin/sh\n${FOREIGN_MARK}\nprintf '%s\\n' "$*" >> "$HOME/foreign-ccgpt-calls"\nexit 0\n`],
  ['.local/bin/ccgpt-proxy', 0o755, `#!/usr/bin/env python3\n${FOREIGN_MARK}\n`],
  ['.local/bin/ccgpt-usage', 0o755, `#!/bin/sh\n${FOREIGN_MARK}\nexit 0\n`],
  ['.local/bin/codex-b', 0o755, `#!/bin/sh\n${FOREIGN_MARK}\nexec "$HOME/.local/bin/ccgpt" "$@"\n`],
  [`${FOREIGN_LITELLM_BIN}/litellm`, 0o755,
    `#!/bin/sh\n${FOREIGN_MARK}\necho "fixture litellm: resolved for its directory, never run" >&2\nexit 97\n`],
  [`${FOREIGN_LITELLM_BIN}/python`, 0o755, FOREIGN_PYTHON],
  ['.config/systemd/user/ccgpt-usage.service', 0o644,
    `${FOREIGN_MARK}\n[Service]\nType=oneshot\nExecStart=%h/.local/bin/ccgpt-usage\n`],
  ['.config/systemd/user/ccgpt-usage.service.d/path.conf', 0o644,
    `${FOREIGN_MARK}\n[Service]\nEnvironment=PATH=%h/.local/bin:/usr/bin:/bin\n`],
  ['.config/systemd/user/ccgpt-usage.timer', 0o644,
    `${FOREIGN_MARK}\n[Timer]\nOnUnitActiveSec=20min\n[Install]\nWantedBy=timers.target\n`],
  ['.config/systemd/user/ccgpt-usage@.service', 0o644,
    `${FOREIGN_MARK}\n[Service]\nType=oneshot\nEnvironment=CCGPT_ACCOUNT_ID=%i\nExecStart=%h/.local/bin/ccgpt-usage\n`],
  ['.config/systemd/user/ccgpt-usage@.timer', 0o644,
    `${FOREIGN_MARK}\n[Timer]\nOnUnitActiveSec=20min\n[Install]\nWantedBy=timers.target\n`],
  [FOREIGN_RENDER, 0o644, `${FOREIGN_MARK}\nmodel_list: []\n`],
  ['.handoff/env', 0o600, 'FIXTURE_NOT_A_KEY=1\n'],
];

/** The links: the alias launcher (relative, as `ln -s ccgpt` makes it), the
 *  `litellm` on PATH, the default token directory (lane 1's), and the two
 *  enabled timers (absolute, as `systemctl --user enable` makes them). */
const FOREIGN_LINKS: ReadonlyArray<readonly [string, string, 'relative' | 'home']> = [
  ['.local/bin/codex-a', 'ccgpt', 'relative'],
  ['.local/bin/litellm', `${FOREIGN_LITELLM_BIN}/litellm`, 'home'],
  ['.handoff/chatgpt-auth', codexAuthDir('codex-a'), 'home'],
  ['.config/systemd/user/timers.target.wants/ccgpt-usage.timer', '.config/systemd/user/ccgpt-usage.timer', 'home'],
  ['.config/systemd/user/timers.target.wants/ccgpt-usage@codex-b.timer', '.config/systemd/user/ccgpt-usage@.timer', 'home'],
];

const OAUTH_BYTES = '{"fixture": "test-token-not-a-secret"}\n';

/** Every path `foreignSnapshot` reads: the files, the links, each lane's
 *  OAuth directory and file (spec §9.2: ccrc checks them and never writes
 *  them), and the `.prev` an external render leaves (absent until one). */
export const FOREIGN_PATHS: readonly string[] = [
  ...FOREIGN_FILES.map(([rel]) => rel),
  ...FOREIGN_LINKS.map(([rel]) => rel),
  ...REHEARSAL_LANES.flatMap((id) => [codexAuthDir(id), `${codexAuthDir(id)}/auth.json`]),
  FOREIGN_RENDER_PREV,
];

export type ForeignEntry =
  | { kind: 'file'; mode: number; bytes: string }
  | { kind: 'sealed'; mode: number; size: number; mtimeMs: number; ino: number }
  | { kind: 'link'; target: string }
  | { kind: 'dir'; mode: number }
  | { kind: 'absent' };

/** The key-bearing paths: each lane's auth.json and the other repository's env
 *  file. Global Constraints: existence and mode only, never opened, fixtures
 *  included. `lstat` alone measures them, so a 0000-mode fixture is measured
 *  too, and a rewrite of the same bytes still shows (mtime, inode). */
const SEALED: ReadonlySet<string> = new Set([
  '.handoff/env', ...REHEARSAL_LANES.map((id) => `${codexAuthDir(id)}/auth.json`),
]);

/** What sits at every foreign path now. `except` drops the paths a runbook
 *  step moves on purpose. */
export function foreignSnapshot(home: string, except: readonly string[] = []): Record<string, ForeignEntry> {
  const out: Record<string, ForeignEntry> = {};
  for (const rel of FOREIGN_PATHS) {
    if (except.includes(rel)) continue;
    const p = path.join(home, rel);
    let st: fs.Stats;
    try { st = fs.lstatSync(p); } catch { out[rel] = { kind: 'absent' }; continue; }
    if (st.isSymbolicLink()) out[rel] = { kind: 'link', target: fs.readlinkSync(p) };
    else if (st.isDirectory()) out[rel] = { kind: 'dir', mode: st.mode & 0o7777 };
    else if (SEALED.has(rel)) {
      out[rel] = { kind: 'sealed', mode: st.mode & 0o7777, size: st.size, mtimeMs: st.mtimeMs, ino: st.ino };
    } else out[rel] = { kind: 'file', mode: st.mode & 0o7777, bytes: fs.readFileSync(p, 'utf8') };
  }
  return out;
}

/** Plants the live shape. `ccrcModels` runs one `ccrc models …` argv under the
 *  CALLING suite's contained harness (this module owns none). It is asked
 *  once, for the shipped re-materialise remedy (`ccd/ccrc`'s settingsDrift
 *  line: "re-materialise by running any models mutation"), which writes
 *  `codex-a`'s TSV, effort file and settings env through the real op. That is
 *  a write to a registry that ALREADY exists, which ruling Z3 leaves alone. */
export function plantLiveShape(
  home: string,
  ccrcModels: (argv: string[]) => { code: number; stdout: string; stderr: string },
): void {
  codexRoster(home, [], REHEARSAL_LANES.map((id) => externalCodexRow(id)));
  for (const [rel, mode, text] of FOREIGN_FILES) {
    const p = path.join(home, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text, { mode });
    fs.chmodSync(p, mode);
  }
  for (const [rel, target, base] of FOREIGN_LINKS) {
    const p = path.join(home, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.symlinkSync(base === 'home' ? path.join(home, target) : target, p);
  }
  for (const id of REHEARSAL_LANES) {
    const dir = path.join(home, codexAuthDir(id));
    fs.mkdirSync(dir, { recursive: true });
    fs.chmodSync(dir, 0o700);
    fs.writeFileSync(path.join(dir, 'auth.json'), OAUTH_BYTES, { mode: 0o600 });
    fs.chmodSync(path.join(dir, 'auth.json'), 0o600);
  }
  // codex-a's config dir exists with no env yet; codex-b's env is hand-written, never ccrc-rendered.
  fs.mkdirSync(path.join(home, '.claude-codex-a'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude-codex-a', 'settings.json'), '{}\n');
  fs.mkdirSync(path.join(home, '.claude-codex-b'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude-codex-b', 'settings.json'), '{"env": {"ANTHROPIC_MODEL": "gpt-x"}}\n');
  const models = path.join(home, '.ccrc', 'models');
  fs.mkdirSync(models, { recursive: true });
  fs.writeFileSync(path.join(models, 'codex-a.classes.json'), `${JSON.stringify(REHEARSAL_REGISTRY, null, 2)}\n`);
  writeRehearsalCatalogue(home, 'codex-a', Math.floor(Date.now() / 1000));
  fs.writeFileSync(path.join(models, 'codex-b.effort.json'), '{"byModel":{}}\n');
  const m = ccrcModels(['models', 'codex-a', 'set-subagent', 'sonnet']);
  if (m.code !== 0) throw new Error(`plantLiveShape: ccrc models codex-a set-subagent sonnet refused:\n${m.stdout}\n${m.stderr}`);
  for (const f of ['codex-a.classes.tsv', 'codex-a.effort.json']) {
    if (!fs.existsSync(path.join(models, f))) throw new Error(`plantLiveShape: the re-materialise wrote no ${f}`);
  }
}

/** Every check's CLASS in one doctor transcript: the set of verdict words its
 *  own lines carry, in PASS/WARN/FAIL/SKIP order joined by '+'. A check may
 *  answer in two classes at once (`cmd_doctor` counts verdict LINES), so a
 *  class is the set, never only the worst. */
export function doctorClasses(stdout: string): Record<string, string> {
  const ORDER = ['PASS', 'WARN', 'FAIL', 'SKIP'];
  const seen = new Map<string, Set<string>>();
  for (const line of stdout.split('\n')) {
    const v = /^(PASS|WARN|FAIL|SKIP) ([a-z0-9_-]+): /.exec(line);
    if (v === null) continue;
    const set = seen.get(v[2]!) ?? new Set<string>();
    set.add(v[1]!);
    seen.set(v[2]!, set);
  }
  return Object.fromEntries([...seen.keys()].sort()
    .map((name) => [name, ORDER.filter((w) => seen.get(name)!.has(w)).join('+')]));
}

/** The check table a `ccrc-doctor-checks` file declares, in order. */
export function doctorTable(checksFile: string): string[] {
  const m = /^CCRC_DOCTOR_CHECKS=\(\n([\s\S]*?)\n\)$/m.exec(fs.readFileSync(checksFile, 'utf8'));
  if (m === null) throw new Error(`${checksFile} declares no CCRC_DOCTOR_CHECKS table`);
  // As bash reads it: a `#` starts a comment, and one line can carry two
  // entries (Task 4's `  models codex   # …`).
  return m[1]!.split('\n').map((l) => l.replace(/#.*$/, '').trim()).filter((l) => l !== '')
    .flatMap((l) => l.split(/\s+/));
}

/** A systemctl argv, as the spine fronts record it (`--user <verb> …`), that
 *  CHANGES something. Reads (is-active, is-enabled, show, list-*) never match. */
export const STATE_CHANGING =
  /^--user (?:enable|disable|start|stop|restart|try-restart|reload|reset-failed|mask|unmask|kill|link|preset|revert)\b/;

export const stateCallsNaming = (argv: readonly string[], unit: RegExp): string[] =>
  argv.filter((a) => STATE_CHANGING.test(a) && unit.test(a));

const rehearsalLines = (p: string): string[] =>
  (fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter((l) => l !== '') : []);
/** Every `ccgpt` argv the other repository's launcher saw, in order. */
export const foreignCcgptCalls = (home: string): string[] => rehearsalLines(path.join(home, 'foreign-ccgpt-calls'));
/** One call of the other repository's LiteLLM interpreter, HOME written `~`. */
export interface ForeignProbeCall { argv: string; env: Record<string, string> }
export function foreignProbeCalls(home: string): ForeignProbeCall[] {
  return rehearsalLines(path.join(home, 'foreign-probe-calls')).map((l) => {
    const [argv = '', ...pairs] = l.split(home).join('~').split('\t');
    return {
      argv: argv.replace(/^argv=/, ''),
      env: Object.fromEntries(pairs.map((p) => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)])),
    };
  });
}

/** A unit's own ExecStart argv and PATH, read from the INSTALLED copy, `%h` expanded. */
export function unitExecOf(home: string, unit: string): { argv: string[]; path: string } {
  const code = fs.readFileSync(path.join(home, '.config', 'systemd', 'user', unit), 'utf8')
    .split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));
  const exec = code.filter((l) => l.startsWith('ExecStart='));
  const pathLine = code.filter((l) => l.startsWith('Environment=PATH='));
  if (exec.length !== 1 || pathLine.length !== 1) {
    throw new Error(`${unit}: ${exec.length} ExecStart and ${pathLine.length} PATH lines, not one of each`);
  }
  const h = (s: string): string => s.split('%h').join(home);
  return {
    argv: h(exec[0]!.slice('ExecStart='.length)).split(/\s+/),
    path: h(pathLine[0]!.slice('Environment=PATH='.length)),
  };
}

/** THROWS unless, under `env`, `ccgpt` resolves to this shape's RECORDER and
 *  `litellm` to its stand-in install, both in `<home>/.local/bin`, and no
 *  `CCGPT_CONFIG` is set. On the fleet box the real `ccgpt stop` stops a lane's
 *  units BY NAME, and a `CCGPT_CONFIG` inherited from a GPT-lane session names a
 *  REAL config (`_models_litellm_path` honours it), so an external-arm run under
 *  any other env could reach a live lane. It only asks `command -v` and reads a
 *  file: nothing it resolves is run. */
export function assertForeignFront(env: NodeJS.ProcessEnv, home: string): void {
  if (env['CCGPT_CONFIG'] !== undefined) {
    throw new Error('assertForeignFront: CCGPT_CONFIG is set, so the external arm would render and pgrep a config outside this HOME');
  }
  for (const name of ['ccgpt', 'litellm']) {
    const r = spawnSync('/bin/sh', ['-c', `command -v ${name}`], { env, encoding: 'utf8' });
    const got = (r.stdout ?? '').trim();
    const want = path.join(home, '.local', 'bin', name);
    if (got !== want) {
      throw new Error(`assertForeignFront: ${name} resolved to ${got === '' ? '(nothing)' : got}, not ${want}`);
    }
  }
  if (!fs.readFileSync(path.join(home, '.local', 'bin', 'ccgpt'), 'utf8').includes(FOREIGN_MARK)) {
    throw new Error('assertForeignFront: ~/.local/bin/ccgpt is not this shape\'s recorder');
  }
}

/** That repository's LiteLLM proxy RUNNING on its box-global config, as
 *  `_models_litellm_running`'s `pgrep -f "litellm .*<config>"` sees one: a node
 *  sleeper whose argv carries `litellm --config <config>`. It binds nothing,
 *  expires on its own (ruling F8), and is tracked, so `killLaneProcesses` ends
 *  it if a case dies first. Resolves once the child has exec'd. */
export async function spawnForeignProxyStandIn(home: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)', 'litellm', '--config',
    path.join(home, FOREIGN_RENDER)], { stdio: 'ignore' });
  trackChild(home, child);
  await new Promise<void>((resolve, reject) => { child.once('spawn', () => resolve()); child.once('error', reject); });
  return child;
}

/** Ends a stand-in this case started and waits for its exit. */
export async function stopForeignProxyStandIn(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => { child.once('exit', () => resolve()); child.kill('SIGTERM'); });
}

/** Runs `act` while that repository's proxy runs on its box-global config. */
export async function withForeignProxyRunning<T>(home: string, act: () => T): Promise<T> {
  const proxy = await spawnForeignProxyStandIn(home);
  try { return act(); } finally { await stopForeignProxyStandIn(proxy); }
}

/** The other repository re-renders its own box-global config (its installer's
 *  act, which the fixture performs for it), so the next render differs again. */
export function restoreForeignConfig(home: string): void {
  const entry = FOREIGN_FILES.find(([rel]) => rel === FOREIGN_RENDER);
  if (entry === undefined) throw new Error(`restoreForeignConfig: ${FOREIGN_RENDER} is not a planted file`);
  fs.writeFileSync(path.join(home, entry[0]), entry[2]);
  fs.chmodSync(path.join(home, entry[0]), entry[1]);
}

/** What one hourly refresh did, comparable across trees and runs: the unit's
 *  exit, its rows, each call of the other repository's interpreter, every
 *  foreign path the run changed (its new entry: a mode and a sha256, never the
 *  bytes), and the other repository's launcher calls. */
export interface RefreshObservation {
  status: number | null;
  rows: unknown[];
  probeCalls: ForeignProbeCall[];
  foreignChanged: Record<string, string>;
  ccgptCalls: string[];
}

function entryWord(home: string, e: ForeignEntry | undefined): string {
  if (e === undefined || e.kind === 'absent') return 'absent';
  if (e.kind === 'file') return `file ${e.mode.toString(8)} sha256:${createHash('sha256').update(e.bytes).digest('hex')}`;
  if (e.kind === 'sealed') return `sealed ${e.mode.toString(8)} rewritten`;
  if (e.kind === 'link') return `link ${e.target.split(home).join('~')}`;
  return `dir ${e.mode.toString(8)}`;
}

/** `ccrc-models.service` run exactly as the unit runs it: ITS `ExecStart`,
 *  through the placed launcher, with ITS `PATH` ahead of the harness's. Two
 *  departures from the bare unit, each a fixture's and each named:
 *    - the install harness's `python3` is a stub that refuses every program but
 *      its own (`ccrcEnv`), and the live box's `~/.local/bin` holds no python3,
 *      so one directory holding only a link to the real interpreter goes first;
 *    - every probe name above, `CCRC_MODELS_PROBE_FIXTURE` and `CCGPT_CONFIG`
 *      are dropped: a user unit's environment is the manager's, which carries
 *      none of them, so a developer's shell cannot decide the answer. */
export function observeHourlyRefresh(home: string, harnessEnv: NodeJS.ProcessEnv, realPython: string): RefreshObservation {
  const before = foreignSnapshot(home);
  const probes0 = foreignProbeCalls(home).length;
  const ccgpt0 = foreignCcgptCalls(home).length;
  const unit = unitExecOf(home, 'ccrc-models.service');
  const shadow = path.join(home, 'rehearsal-real-python');
  fs.mkdirSync(shadow, { recursive: true });
  fs.rmSync(path.join(shadow, 'python3'), { force: true });
  fs.symlinkSync(realPython, path.join(shadow, 'python3'));
  const env: NodeJS.ProcessEnv = { ...harnessEnv, PATH: `${shadow}:${unit.path}:${harnessEnv['PATH'] ?? ''}` };
  for (const n of [...PROBE_ENV_VALUES, ...PROBE_ENV_PRESENCE, 'CCRC_MODELS_PROBE_FIXTURE', 'CCGPT_CONFIG']) delete env[n];
  assertSpineFrontContained(env, home);
  assertForeignFront(env, home);
  const r = spawnSync(unit.argv[0]!, unit.argv.slice(1), { env, encoding: 'utf8', timeout: 240_000 });
  const after = foreignSnapshot(home);
  const foreignChanged: Record<string, string> = {};
  for (const rel of Object.keys(after).sort()) {
    if (JSON.stringify(after[rel]) !== JSON.stringify(before[rel])) foreignChanged[rel] = entryWord(home, after[rel]);
  }
  let rows: unknown[] = [];
  try {
    rows = (JSON.parse((r.stdout ?? '').trim().split('\n').pop() ?? '') as { refreshed?: unknown[] }).refreshed ?? [];
  } catch { rows = [`unparseable stdout: ${(r.stdout ?? '').slice(0, 200)}`]; }
  return {
    status: r.status,
    rows,
    probeCalls: foreignProbeCalls(home).slice(probes0),
    foreignChanged,
    ccgptCalls: foreignCcgptCalls(home).slice(ccgpt0),
  };
}

/** The two hourly refreshes Task 10 measures on the base and asserts at the
 *  tip, as ONE sequence so both trees run the same code (Step 3 copies this
 *  block):
 *    1. nothing runs on the box-global config, so a changed render is written
 *       and nothing is stopped (the live shape at drafting, lane 1 idle);
 *    2. that repository re-renders its config and its proxy runs on it, so the
 *       external arm owes its stop, and on the base runs its bare `ccgpt stop`
 *       (the live shape since 2026-09-30, lane 1's tiers measured running). */
export async function liveShapeRefreshes(
  home: string, harnessEnv: NodeJS.ProcessEnv, realPython: string,
): Promise<RefreshObservation[]> {
  const first = observeHourlyRefresh(home, harnessEnv, realPython);
  restoreForeignConfig(home);
  const second = await withForeignProxyRunning(home, () => observeHourlyRefresh(home, harnessEnv, realPython));
  return [first, second];
}
// ── Plan 3a Task 10 — the live shape (end) ───────────────────────────────
```

In `server/test/installTreeFixture.ts`, directly after `'deploy/account-op.mjs',`:

```ts
  // Plan 3a Task 10: the model-registry op, the two modules it imports at
  // load, the probe it runs and the template `ccrc models litellm` renders,
  // so the PLACED launcher can run `ccrc models refresh --all` the way
  // `ccrc-models.service` runs it (`ExecStart=%h/.local/bin/ccrc models
  // refresh --all`). Without the two imports every models verb dies with
  // ERR_MODULE_NOT_FOUND. Copied, never stubbed, for the GPT lane's reason above.
  'ccd/ccrc-models-probe',
  'deploy/models-op.mjs',
  'deploy/litellm-config.template.yaml',
  'shared/modelenv.mjs',
  'shared/litellm.mjs',
```

Run it:

```bash
. "<abs scratch>/plan3a-env.sh"
cd server && "$CENSUS" "$EVID/t10-s1-typecheck" ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
```

Expected: green, then `census: clean — no unit or link change, 0 fixture processes left; command exit 0`.

- [ ] **Step 2: The rehearsal, red until the base is measured.**

Widen the two imports as the **Files** list says. The `./codexLaneFixture.js` import in `ccrc-install.test.ts` gains `codexAuthDir, authDirOf, eventually, plantLiveShape, foreignSnapshot, externalCodexRow, REHEARSAL_REGISTRY, writeRehearsalCatalogue, doctorClasses, doctorTable, stateCallsNaming, liveShapeRefreshes, foreignCcgptCalls, foreignProbeCalls, assertForeignFront, withForeignProxyRunning, type ForeignEntry, type RefreshObservation`, placed before `type StubRc`. The one in `ccrc-update.test.ts` gains `plantLiveShape, foreignSnapshot, stateCallsNaming`.

Append this to `server/test/ccrc-install.test.ts`:

```ts
// ════════════════════════════════════════════════════════════════════════
// Plan 3a Task 10 — the cutover REHEARSAL (spec §15 steps 1-3, in fixtures).
// Merging Plan 3a auto-releases and both boxes follow dev (D-3705), and by
// operator ruling Z (2026-10-01) the merge changes nothing on the live box.
// So these cases are the evidence that the rollout is a no-op on the fleet
// box's live SHAPE (`plantLiveShape`): every doctor check keeps its class,
// `models` included, and the external lane's hourly refresh does exactly what
// the base's did (Z1, Z7). They also show that an external lane cannot gain a
// codex registry (Z3), that once a flip makes one lane codex the external arm
// never runs the other repository's stop (Z4), that a flip made in Plan 3b's
// order converges, and that a flip back converges. The runbook's two steps
// that need a real LiteLLM (the refresh of a CODEX lane and the one publisher
// run) are stood in for by the files each leaves: the default suite has no
// real LiteLLM (Global Constraints), and Task 1's two-lane case and
// ccgpt-usage.test.ts own their behaviour.
// ════════════════════════════════════════════════════════════════════════

/** What the base tree did on the live shape, MEASURED by Task 10 Step 3 on a
 *  disposable copy of the plan's base and pasted here, never typed: both
 *  install passes' closing doctor, the two hourly refreshes
 *  (`liveShapeRefreshes`), and the doctor after them. The first case proves
 *  it is a measurement of this table that FAILs nothing. */
interface LiveShapeMeasure {
  install: Array<{ code: number; classes: Record<string, string> }>;
  refresh: RefreshObservation[];
  doctor: { code: number; classes: Record<string, string> };
}
const BASE_LIVE_SHAPE: LiveShapeMeasure = { install: [], refresh: [], doctor: { code: -1, classes: {} } };
/** The base's map for a box that has installed and not yet refreshed: the
 *  update spine's pass, which the flip case starts from. */
const baseInstalled = (): Record<string, string> => BASE_LIVE_SHAPE.install[1]?.classes ?? {};
/** Ruling Z3's refusal code for `init codex` on a row that is not codex-kind,
 *  as Task 2 lands it in `deploy/models-op.mjs` (Step 0 counts it there). */
const INIT_EXTERNAL_REFUSAL = 'codex-registry-needs-codex-lane';
/** Task 4's class for lane state an id left behind when flipped back to
 *  `external` — kept by design (spec §13), so never a FAIL. */
const FLIP_BACK_LEFTOVER_CLASS = 'WARN';
/** Task 6's INST_DEGRADED word for a usage enable it withheld (Step 0 re-derives it). */
const USAGE_DEGRADED = 'codex-usage';
/** 3b step d's name for a launcher moved aside, `cmd_wrappers`' own backup
 *  shape: no id can contain a ".", so doctor never reads it as an account. */
const ASIDE = '.pre-ccrc-20260930T000000Z';
/** The extra env of every rehearsal run that can reach `_models_litellm`'s
 *  external arm, and of the live-shape runs Step 3 mirrors. `CCGPT_CONFIG` is
 *  the other repository's override of the box-global path, which
 *  `_models_litellm_path` honours, and a GPT-lane session can carry a real one,
 *  so it is dropped (an undefined value never reaches the child).
 *  `assertForeignFront` refuses an env that still has it. */
const REHEARSAL_ENV: NodeJS.ProcessEnv = { ...READY, CCGPT_CONFIG: undefined };
const epochS = (): number => Math.floor(Date.now() / 1000);
const without = <T>(o: Record<string, T>, keys: readonly string[]): Record<string, T> =>
  Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
const argvOf = (home: string): string[] => systemctlCalls(home).map((c) => c.argv);
const usageEnables = (home: string): string[] =>
  argvOf(home).filter((a) => /^--user enable --now ccrc-codex-usage@/.test(a));
/** The one JSON object a `ccrc models` verb prints last on stdout, or `{}`. */
const lastJson = (stdout: string): { ok?: boolean; error?: string; detail?: string; [k: string]: unknown } => {
  try { return JSON.parse(stdout.trim().split('\n').pop() ?? '') as { ok?: boolean }; } catch { return {}; }
};
/** A publisher row in `ccd/ccgpt-usage.py`'s shape: both reset keys present, null included. */
const usageRow = (): string =>
  `${JSON.stringify({ five: null, seven: 12, ts: epochS(), fiveResetAt: null, sevenResetAt: null })}\n`;

/** A fresh FLEET box in the live shape. Its tree is stamped (`codexBox`'s
 *  reason: with no stamp `_inst_installed` writes no record), and its agent env
 *  is present so `--role fleet` never prompts. The runtime template is planted
 *  so that a later flip can build; with no codex lane it is never used. Step 3's
 *  MEASURE case builds its box with exactly these calls. */
function liveBox(prefix: string, opts: { systemd?: boolean } = {}): string {
  const home = freshBox(prefix);
  gitInit(treeRoot(home));
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  writeFileSync(join(home, '.ccrc', 'agent.env'),
    'CCRC_SERVER_URL=http://127.0.0.1:7788\nCCRC_AGENT_TOKEN=fixture-not-a-real-token\n');
  plantLiveShape(home, (argv) => runInstall(home, argv, REHEARSAL_ENV, { from: REPO_CCRC }));
  plantRuntimeTemplate(home, { verdict: 'pass', version: '1.101.0' });
  if (opts.systemd === true) plantSystemd(home, { userManager: true });
  return home;
}

describeLinux('Plan 3a Task 10 — the cutover rehearsal', () => {
  const homes: string[] = [];
  afterEach(async () => {
    for (const h of homes.splice(0)) await killLaneProcesses(h);
  });

  interface Flip { lane: LanePorts; rosterBefore: string; aside: string }

  /** Plan 3b's per-lane steps c–h for the lane-1 analog, in the runbook's order. */
  async function flipCodexA(home: string): Promise<Flip> {
    const [lane] = await freeLanes(['codex-a']);
    const bin = join(home, '.local', 'bin');
    // c. the OPERATOR disables the other repository's flat timer: what
    //    `systemctl --user disable` removes. The fixture acts for the operator;
    //    ccrc never does (ruling R6).
    rmSync(unitDir(home, 'timers.target.wants', 'ccgpt-usage.timer'));
    // d. the launcher moves aside, as the link it is
    const aside = join(bin, `codex-a${ASIDE}`);
    renameSync(join(bin, 'codex-a'), aside);
    // e. the roster edit, its backup kept: kind codex, provider openai, a port
    //    pair, and the authDir the lane already uses (adoption by path, §9.2).
    //    From here the lane takes the codex path with no other act (ruling Z8).
    const rosterBefore = read(dotCcrc(home, 'accounts.json'));
    codexRoster(home, [lane!], [externalCodexRow('codex-b')]);
    expect(authDirOf(home, 'codex-a')).toBe(join(home, codexAuthDir('codex-a')));
    // f. wrappers; the refresh, stood in by the catalogue it leaves; litellm
    const w = runInstall(home, ['wrappers'], READY);
    expect(w.code, `ccrc wrappers:\n${w.stdout}\n${w.stderr}`).toBe(0);
    expect(verifyMarker(read(join(bin, 'codex-a'))), 'ccrc wrappers did not write codex-a').toBe('ccrc-unmodified');
    writeRehearsalCatalogue(home, 'codex-a', epochS());
    const lit = runInstall(home, ['models', 'litellm', 'codex-a'], READY, { from: REPO_CCRC });
    expect(lit.code, `ccrc models litellm codex-a:\n${lit.stdout}\n${lit.stderr}`).toBe(0);
    //    the usage enable: the spine's own converge (R-C10's targeted route is
    //    this by design), run the way the next auto-update runs it
    rmSync(join(home, 'systemctl-calls'), { force: true });
    const inst = runInstall(home, ['install', '--role', 'fleet'], READY);
    expect(inst.stdout, `the converge did not complete:\n${inst.stderr}`).toMatch(/^install: done — /m);
    // g. start, the product stop registered first
    registerLaneCleanup(home, 'rehearsal:codex-a', () => {
      runInstall(home, ['codex', 'stop', 'codex-a'], READY, { from: REPO_CCRC });
    });
    const start = runInstall(home, ['codex', 'start', 'codex-a'], READY, { from: REPO_CCRC });
    expect(start.code, `ccrc codex start codex-a:\n${start.stdout}\n${start.stderr}`).toBe(0);
    // h. the one publisher run, stood in by the row it leaves
    mkdirSync(join(home, '.cc-limits'), { recursive: true });
    writeFileSync(join(home, '.cc-limits', 'codex-a.json'), usageRow());
    return { lane: lane!, rosterBefore, aside };
  }

  it('the base tree: BASE_LIVE_SHAPE is its measured answer — each doctor map names every check but codex and FAILs none, and the two hourly refreshes exercised both arms of the stop decision', () => {
    const table = doctorTable(join(REPO, 'ccd', 'ccrc-doctor-checks'));
    expect(table, 'Task 4 put codex in the table').toContain('codex');
    const want = table.filter((n) => n !== 'codex').sort();
    const maps = [...BASE_LIVE_SHAPE.install, BASE_LIVE_SHAPE.doctor];
    expect(maps.map((m) => m.code), 'BASE_LIVE_SHAPE is not Step 3\'s measurement — re-measure it on the plan\'s base')
      .toEqual([0, 0, 0]);
    for (const m of maps) {
      expect(Object.keys(m.classes).sort(),
        'BASE_LIVE_SHAPE is not Step 3\'s measurement of this table — re-measure it on the plan\'s base').toEqual(want);
      expect(Object.entries(m.classes).filter(([, c]) => c.includes('FAIL')),
        'the base tree FAILs a check on the live shape: the fixture is wrong, not the tree').toEqual([]);
    }
    expect(BASE_LIVE_SHAPE.refresh.map((o) => o.status), 'the base\'s hourly unit failed: the fixture is wrong')
      .toEqual([0, 0]);
    expect(BASE_LIVE_SHAPE.refresh.map((o) => o.ccgptCalls),
      'the second refresh did not owe the stop: the stand-in proxy is not what pgrep sees').toEqual([[], ['stop']]);
    for (const o of BASE_LIVE_SHAPE.refresh) {
      expect(o.probeCalls.map((c) => c.env['CHATGPT_TOKEN_DIR']),
        'the base did not probe the external lane through its default token directory').toEqual(['~/.handoff/chatgpt-auth']);
    }
  });

  it('live shape: two installs, both hourly refreshes, doctor and uninstall do exactly what the base did, and init codex on an external lane refuses (rulings Z1, Z3, Z7)', async () => {
    const home = liveBox('ccrc-rehearsal-live-');
    homes.push(home);
    const models = join(home, '.ccrc', 'models');
    const registryA = read(join(models, 'codex-a.classes.json'));
    const stopsAfterRefresh = BASE_LIVE_SHAPE.refresh.flatMap((o) => o.ccgptCalls).length;
    const contained = (stage: string, want: Record<string, ForeignEntry>, stops: number): void => {
      expect(stateCallsNaming(argvOf(home), /\bccgpt-/),
        `${stage}: a state-changing systemctl verb named a ccgpt- unit`).toEqual([]);
      expect(spineRunCalls(home).filter((l) => l.includes('--unit=ccgpt-')), `${stage}: a ccgpt- unit was started`)
        .toEqual([]);
      expect(foreignCcgptCalls(home), `${stage}: ccrc ran the other repository's launcher`).toHaveLength(stops);
      expect(foreignSnapshot(home), `${stage}: a foreign byte, mode or link changed`).toEqual(want);
      expect(read(join(models, 'codex-a.classes.json')),
        `${stage}: the external lane's existing registry was touched (ruling Z3)`).toBe(registryA);
    };
    const s0 = foreignSnapshot(home);
    // 1-2. install, then again: the second is the update's spine (ccd/ccrc:16183)
    expect(BASE_LIVE_SHAPE.install, 'Step 3 measured two install passes').toHaveLength(2);
    for (const [pass, base] of BASE_LIVE_SHAPE.install.entries()) {
      const stage = `install pass ${pass + 1}`;
      const r = runInstall(home, ['install', '--role', 'fleet'], REHEARSAL_ENV);
      expect(r.code, `${stage}:\n${r.stdout}\n${r.stderr}`).toBe(0);
      expect(r.stdout).toMatch(/^install: codex runtime: none — no codex lane in the roster$/m);
      expect(existsSync(runtimeDir(home)), `${stage}: a runtime was built`).toBe(false);
      expect(existsSync(join(home, '.ccrc', 'codex')), `${stage}: lane state was written`).toBe(false);
      expect(r.stdout.split('\n').filter((l) => l.startsWith('SKIP codex: ')), `${stage}: _check_codex`).toHaveLength(1);
      expect(doctorClasses(r.stdout), `${stage}: a check's class moved from the base's (ruling Z7)`)
        .toEqual({ ...base.classes, codex: 'SKIP' });
      for (const u of ['ccrc-codex-usage@.service', 'ccrc-codex-usage@.timer']) {
        expect(existsSync(unitDir(home, u)), `${stage}: --role fleet did not place ${u}`).toBe(true);
      }
      expect(usageEnables(home), `${stage}: an instance was enabled on a box with no codex lane`).toEqual([]);
      contained(stage, s0, 0);
    }
    // 3. the hourly refresh, twice, exactly as ccrc-models.service runs it: the
    //    external lane keeps the base's probe env, render and stop decision (Z1)
    const refresh = await liveShapeRefreshes(home, { ...ccrcEnv(home), ...REHEARSAL_ENV }, realPy());
    expect(refresh, 'the external lane\'s hourly refresh did not do what the base\'s did (ruling Z1)')
      .toEqual(BASE_LIVE_SHAPE.refresh);
    const s1 = foreignSnapshot(home);
    contained('the hourly refresh', s1, stopsAfterRefresh);
    // 4. doctor after the refreshes: every check keeps the base's class, models included (Z7)
    const d = runInstall(home, ['doctor'], REHEARSAL_ENV);
    expect(d.code, d.stdout).toBe(BASE_LIVE_SHAPE.doctor.code);
    expect(doctorClasses(d.stdout), 'doctor: a check\'s class moved from the base\'s (ruling Z7)')
      .toEqual({ ...BASE_LIVE_SHAPE.doctor.classes, codex: 'SKIP' });
    contained('doctor', s1, stopsAfterRefresh);
    // 5. ruling Z3: an external lane cannot gain a codex registry. The lane-2
    //    analog has none, and this is the wrong-lane hazard itself: on the base,
    //    this init succeeds, and the next hourly refresh probes that lane through
    //    the default token directory, which is lane 1's.
    const probes = foreignProbeCalls(home).length;
    const files = readdirSync(models).sort();
    const init = runInstall(home, ['models', 'codex-b', 'init', 'codex'], REHEARSAL_ENV, { from: REPO_CCRC });
    expect(init.code, `init codex on an external lane was not refused:\n${init.stdout}\n${init.stderr}`).not.toBe(0);
    const refusal = lastJson(init.stdout);
    expect(refusal, init.stdout).toMatchObject({ ok: false, error: INIT_EXTERNAL_REFUSAL });
    expect(refusal.detail ?? '', 'the refusal does not give ruling Z3\'s remedy').toMatch(/flip the lane to .?codex.? first/i);
    expect(readdirSync(models).sort(), 'the refused init wrote a file').toEqual(files);
    expect(foreignProbeCalls(home), 'the refused init ran the probe').toHaveLength(probes);
    contained('init codex on an external lane', s1, stopsAfterRefresh);
    // 6. uninstall
    const un = runInstall(home, ['uninstall']);
    expect(un.code, `${un.stdout}\n${un.stderr}`).toBe(0);
    contained('uninstall', s1, stopsAfterRefresh);
    for (const u of ['ccrc-codex-usage@.service', 'ccrc-codex-usage@.timer']) {
      expect(existsSync(unitDir(home, u)), `uninstall left ${u}`).toBe(false);
    }
  }, 300_000);

  it('ruling Z4: once a flip makes codex-a a codex lane, the external arm for a still-external lane with a registry refuses the stop it owes, writes nothing and runs no ccgpt; with nothing to stop it still renders', async () => {
    const home = liveBox('ccrc-rehearsal-z4-', { systemd: true });
    homes.push(home);
    const i0 = runInstall(home, ['install', '--role', 'fleet'], REHEARSAL_ENV);
    expect(i0.code, `${i0.stdout}\n${i0.stderr}`).toBe(0);
    const f = await flipCodexA(home);
    // codex-b stays external and carries a registry made before ruling Z3's
    // guard existed (no `init codex` can make one now): the files a pre-3a
    // init and refresh leave. Its render is the box-global config.
    const models = join(home, '.ccrc', 'models');
    writeFileSync(join(models, 'codex-b.classes.json'), `${JSON.stringify(REHEARSAL_REGISTRY, null, 2)}\n`);
    writeRehearsalCatalogue(home, 'codex-b', epochS());
    const cfg = join(home, '.handoff', 'litellm-config.yaml');
    const planted = read(cfg);
    const calls0 = argvOf(home).length;
    assertForeignFront({ ...ccrcEnv(home), ...REHEARSAL_ENV }, home);
    // the box-global config differs from the render, and that repository's
    // proxy runs on it: the stop is owed, and a bare `ccgpt stop` would stop the
    // lane-1 units by name, which are now codex-a's own tiers
    const refused = await withForeignProxyRunning(home,
      () => runInstall(home, ['models', 'litellm', 'codex-b'], REHEARSAL_ENV, { from: REPO_CCRC }));
    expect(refused.code, `the external arm did not refuse:\n${refused.stdout}\n${refused.stderr}`).toBe(1);
    const body = lastJson(refused.stdout);
    expect(body, refused.stdout).toMatchObject({ ok: false, error: 'restart-failed' });
    expect(body.detail ?? '', 'the refusal does not name the codex lane as its reason').toContain('the roster names codex-kind lane(s) codex-a');
    expect(body.detail ?? '', 'the refusal sends the operator to the stop it refused').not.toMatch(/run 'ccgpt stop'/i);
    expect(foreignCcgptCalls(home), 'ccrc ran the other repository\'s stop while a codex lane exists (ruling Z4)')
      .toEqual([]);
    expect(read(cfg), 'the refusal wrote the box-global config').toBe(planted);
    expect(existsSync(`${cfg}.prev`), 'the refusal wrote a .prev').toBe(false);
    expect(stateCallsNaming(argvOf(home).slice(calls0), /\bccgpt-/), 'the refusal changed a ccgpt- unit').toEqual([]);
    const ans = await laneAnswer(f.lane.proxyPort);
    expect(JSON.parse(ans!.body), 'codex-a\'s own shim stopped answering').toEqual({ lane: 'codex-a' });
    // with nothing running on it there is nothing to stop, and the render lands
    // as it does today (ruling Z1: Z4 guards the stop, never the render)
    const rendered = runInstall(home, ['models', 'litellm', 'codex-b'], REHEARSAL_ENV, { from: REPO_CCRC });
    expect(rendered.code, `${rendered.stdout}\n${rendered.stderr}`).toBe(0);
    expect(lastJson(rendered.stdout)).toMatchObject({ ok: true, changed: true, restarted: false });
    expect(read(cfg), 'the render did not land').not.toBe(planted);
    expect(foreignCcgptCalls(home)).toEqual([]);
  }, 300_000);

  it('the flip, in Plan 3b\'s order: only codex-a\'s ccrc instance is enabled, codex-b and its foreign timer are untouched, and doctor answers PASS for the lane', async () => {
    const home = liveBox('ccrc-rehearsal-flip-', { systemd: true });
    homes.push(home);
    const i0 = runInstall(home, ['install', '--role', 'fleet'], READY);
    expect(i0.code, `${i0.stdout}\n${i0.stderr}`).toBe(0);
    const s0 = foreignSnapshot(home);
    const f = await flipCodexA(home);
    expect(usageEnables(home), 'the converge enabled the wrong instance set')
      .toEqual(['--user enable --now ccrc-codex-usage@codex-a.timer']);
    expect(stateCallsNaming(argvOf(home), /ccgpt-usage|ccgpt-codex-b-/), 'ccrc changed a unit that is not codex-a\'s own')
      .toEqual([]);
    const units = laneUnits(home, 'codex-a');
    expect(spineRunCalls(home).map((l) => /--unit=(\S+)/.exec(l)?.[1]).filter((u) => u?.startsWith('ccgpt-')).sort(),
      'a ccgpt- unit other than codex-a\'s two tiers was started').toEqual([units.litellm, units.shim].sort());
    const moved = ['.local/bin/codex-a', '.config/systemd/user/timers.target.wants/ccgpt-usage.timer'];
    expect(foreignSnapshot(home, moved), 'a foreign byte changed that no runbook step moves').toEqual(without(s0, moved));
    expect(lstatSync(f.aside).isSymbolicLink(), 'the launcher moved aside is no longer a link').toBe(true);
    expect(readlinkSync(f.aside)).toBe('ccgpt');
    expect(existsSync(join(home, 'foreign-ccgpt-calls')), 'ccrc ran the other repository\'s launcher').toBe(false);
    const ans = await laneAnswer(f.lane.proxyPort);
    expect(JSON.parse(ans!.body)).toEqual({ lane: 'codex-a' });
    const d = runInstall(home, ['doctor'], READY);
    expect(d.code, d.stdout).toBe(0);
    expect(doctorClasses(d.stdout), 'a check other than codex moved at the flip')
      .toEqual({ ...baseInstalled(), codex: 'PASS' });
    const codexLines = d.stdout.split('\n').filter((l) => /^(PASS|WARN|FAIL|SKIP) codex: /.test(l)).join('\n');
    expect(codexLines).toMatch(/codex-a/);
    expect(codexLines, 'doctor measured an external lane as a codex lane').not.toMatch(/codex-b/);
  }, 300_000);

  it('the flip back — ccrc\'s stop first, the roster backup, the marked wrapper out, the old launcher back — converges: the instance is disabled, lane state is kept, and doctor flags only the leftover', async () => {
    const home = liveBox('ccrc-rehearsal-flipback-', { systemd: true });
    homes.push(home);
    const i0 = runInstall(home, ['install', '--role', 'fleet'], READY);
    expect(i0.code, `${i0.stdout}\n${i0.stderr}`).toBe(0);
    const s0 = foreignSnapshot(home);
    const tipLive = doctorClasses(i0.stdout);
    const f = await flipCodexA(home);
    const bin = join(home, '.local', 'bin');
    // 1. ccrc's own stop FIRST: the other repository's stop stops units by
    //    name, and ccrc's tiers carry those names (carry-forward, critic #7)
    const stop = runInstall(home, ['codex', 'stop', 'codex-a'], READY, { from: REPO_CCRC });
    expect(stop.code, `${stop.stdout}\n${stop.stderr}`).toBe(0);
    await eventually(async () => !(await portAccepts(f.lane.proxyPort)), 'codex-a\'s shim port to close');
    await eventually(async () => !(await portAccepts(f.lane.litellmPort)), 'codex-a\'s litellm port to close');
    // 2. the roster backup, byte for byte: from here the lane is on today's
    //    external path again, and no codex row is left for Z4's guard to see
    writeFileSync(dotCcrc(home, 'accounts.json'), f.rosterBefore);
    // 3. ccrc's wrapper out, marker-verified first, and the old launcher back, still a link
    const wrapper = join(bin, 'codex-a');
    expect(verifyMarker(read(wrapper)), 'the file at codex-a is not ccrc\'s unmodified wrapper').toBe('ccrc-unmodified');
    rmSync(wrapper);
    renameSync(f.aside, wrapper);
    // 4. the OPERATOR re-enables the other repository's flat timer
    symlinkSync(unitDir(home, 'ccgpt-usage.timer'), unitDir(home, 'timers.target.wants', 'ccgpt-usage.timer'));
    // 5. the converge the next install or auto-update runs
    rmSync(join(home, 'systemctl-calls'), { force: true });
    const back = runInstall(home, ['install', '--role', 'fleet'], READY);
    expect(back.stdout, back.stderr).toMatch(/^install: done — /m);
    expect(argvOf(home).filter((a) => /^--user disable\b/.test(a) && a.includes('ccrc-codex-usage@codex-a.timer')),
      'the converge did not disable an instance whose lane is no longer codex').toHaveLength(1);
    expect(usageEnables(home)).toEqual([]);
    expect(stateCallsNaming(argvOf(home), /\bccgpt-/), 'the flip back changed a ccgpt- unit').toEqual([]);
    for (const kept of ['lane.json', 'litellm.yaml', 'runtime.env']) {
      expect(existsSync(join(laneDir(home, 'codex-a'), kept)), `lane state ${kept} was not kept (spec §13)`).toBe(true);
    }
    expect(foreignSnapshot(home), 'the flip back did not restore every foreign path').toEqual(s0);
    const d = runInstall(home, ['doctor'], READY);
    expect(doctorClasses(d.stdout), 'a check other than codex moved at the flip back')
      .toEqual({ ...tipLive, codex: FLIP_BACK_LEFTOVER_CLASS });
    const codexLines = d.stdout.split('\n').filter((l) => /^(PASS|WARN|FAIL|SKIP) codex: /.test(l)).join('\n');
    expect(codexLines).toMatch(/codex-a/);
    expect(codexLines).toMatch(/^WARN codex: lane state is left under \S+\/\.ccrc\/codex\/codex-a, and 'codex-a' is not a Codex lane in /m);
  }, 300_000);

  it('out of order: a flip made while the other repository\'s instance timer for that lane is still enabled withholds ccrc\'s enable, and doctor names the operator\'s own disable (ruling R6)', async () => {
    const home = liveBox('ccrc-rehearsal-second-writer-');
    homes.push(home);
    const i0 = runInstall(home, ['install', '--role', 'fleet'], READY);
    expect(i0.code, `${i0.stdout}\n${i0.stderr}`).toBe(0);
    const s0 = foreignSnapshot(home);
    const [lane] = await freeLanes(['codex-b']);
    const bin = join(home, '.local', 'bin');
    // step c (the operator's disable of ccgpt-usage@codex-b.timer) is SKIPPED
    renameSync(join(bin, 'codex-b'), join(bin, `codex-b${ASIDE}`));
    codexRoster(home, [lane!], [externalCodexRow('codex-a')]);
    // the lane has no registry: 3b's `init codex` after the flip (ruling Z3
    // forces that order) and its refresh, stood in by the files they leave
    writeFileSync(join(home, '.ccrc', 'models', 'codex-b.classes.json'), `${JSON.stringify(REHEARSAL_REGISTRY, null, 2)}\n`);
    writeRehearsalCatalogue(home, 'codex-b', epochS());
    const m = runInstall(home, ['models', 'codex-b', 'set-subagent', 'sonnet'], READY, { from: REPO_CCRC });
    expect(m.code, `${m.stdout}\n${m.stderr}`).toBe(0);
    expect(runInstall(home, ['wrappers'], READY).code).toBe(0);
    expect(runInstall(home, ['models', 'litellm', 'codex-b'], READY, { from: REPO_CCRC }).code).toBe(0);
    // the other repository's publisher is still writing this lane's row
    mkdirSync(join(home, '.cc-limits'), { recursive: true });
    writeFileSync(join(home, '.cc-limits', 'codex-b.json'), usageRow());
    rmSync(join(home, 'systemctl-calls'), { force: true });
    const inst = runInstall(home, ['install', '--role', 'fleet'], READY);
    expect(inst.stdout, inst.stderr).toMatch(/^install: done — /m);
    expect(usageEnables(home), 'ccrc enabled a second writer over one limits row').toEqual([]);
    expect(stateCallsNaming(argvOf(home), /\bccgpt-usage/), 'ccrc touched the other repository\'s timer').toEqual([]);
    expect(inst.stdout).toMatch(new RegExp(
      `^install: done — converged with \\d+ degraded steps? \\([^)]*\\b${USAGE_DEGRADED}\\b[^)]*\\)$`, 'm'));
    expect(foreignSnapshot(home, ['.local/bin/codex-b'])).toEqual(without(s0, ['.local/bin/codex-b']));
    const d = runInstall(home, ['doctor'], READY);
    const lines = d.stdout.split('\n');
    const w = lines.findIndex((l) => l.startsWith('WARN codex: ') && l.includes('ccgpt-usage@codex-b.timer'));
    expect(w, d.stdout).toBeGreaterThan(-1);
    expect(lines[w + 1]).toMatch(/^ {2}remedy: .*systemctl --user disable --now ccgpt-usage@codex-b\.timer/);
    // the operator's disable; then the converge enables ccrc's instance and the WARN is gone
    rmSync(unitDir(home, 'timers.target.wants', 'ccgpt-usage@codex-b.timer'));
    rmSync(join(home, 'systemctl-calls'), { force: true });
    const again = runInstall(home, ['install', '--role', 'fleet'], READY);
    expect(usageEnables(home)).toEqual(['--user enable --now ccrc-codex-usage@codex-b.timer']);
    expect(again.stdout, 'the second-writer finding outlived the operator\'s disable').not.toMatch(/ccgpt-usage@codex-b\.timer/);
  }, 240_000);
});
```

Append this to `server/test/ccrc-update.test.ts`. `existsSync`, `readFileSync` and `spawnSync` are already imported there (`grep -n "from 'node:fs'\|from 'node:child_process'" server/test/ccrc-update.test.ts`):

```ts
// Plan 3a Task 10 — the merge is itself an inert rollout: the REAL update onto
// this tree, over the fleet box's live shape (codexLaneFixture's `plantLiveShape`),
// on the box the "codex steps ride the staged spine" describe above uses.
describe('Plan 3a Task 10 — ccrc update onto this tree over today\'s live shape', () => {
  itLinux('a real update leaves every foreign byte and link, names no ccgpt- unit in a state-changing verb, and builds nothing', () => {
    const home = freshUpdateBox('ccrc-update-rehearsal-live-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantCoordDb(home);
    plantLiveShape(home, (argv) => {
      const env: NodeJS.ProcessEnv = { ...updateEnv(home), CCGPT_CONFIG: undefined };   // REHEARSAL_ENV's reason
      assertSpineFrontContained(env, home);
      const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), ...argv], { env, encoding: 'utf8' });
      return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    });
    const s0 = foreignSnapshot(home);
    packRelease(home, fullTree(home, { version: 'v2.0.0', sha: 'newsha0000000000000000000000000000000000' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(foreignSnapshot(home), 'the update changed a byte, mode or link another repository owns').toEqual(s0);
    const calls = existsSync(join(home, 'systemctl-calls'))
      ? readFileSync(join(home, 'systemctl-calls'), 'utf8').split('\n').filter(Boolean) : [];
    expect(stateCallsNaming(calls, /\bccgpt-/), 'a state-changing systemctl verb named a ccgpt- unit').toEqual([]);
    expect(calls.filter((a) => /^--user enable --now ccrc-codex-usage@/.test(a)),
      'an instance was enabled on a box with no codex lane').toEqual([]);
    expect(spineRunCalls(home)).toEqual([]);
    expect(existsSync(join(home, 'foreign-ccgpt-calls')), 'ccrc ran the other repository\'s launcher').toBe(false);
    expect(existsSync(join(home, '.ccrc', 'runtime', 'codex')), 'a runtime was built').toBe(false);
    expect(existsSync(join(home, '.ccrc', 'codex')), 'lane state was written').toBe(false);
    expect(r.stdout.split('\n').filter((l) => l.startsWith('SKIP codex: ')), 'the staged spine\'s closing doctor')
      .toHaveLength(1);
  }, 120_000);
});
```

Run the baseline case:

```bash
. "<abs scratch>/plan3a-env.sh"
cd server && "$CENSUS" "$EVID/t10-s2-red" ./node_modules/.bin/vitest run test/ccrc-install.test.ts -t 'the base tree'
```

Expected **RED**: 1 failed, `BASE_LIVE_SHAPE is not Step 3's measurement — re-measure it on the plan's base`, then `census: clean — no unit or link change, 0 fixture processes left; command exit 1`. The red is vitest's own exit code; the census verdict is separate (F10).

- [ ] **Step 3: Measure the base, and paste the measurement.**

The base is measured in a disposable `git archive` copy, never a worktree: this repository is only read (F5), and this suite runs in such a copy (measured at drafting). The copy gets this task's own fixture block and `TREE_FILES` lines, unchanged, and one MEASURE case that makes `liveBox`'s calls and then the live case's, in its order and with its env.

```bash
. "<abs scratch>/plan3a-env.sh"
B="$SCRATCH/t10-base-tree"; rm -rf -- "$B"; mkdir -p -- "$B"
git archive "$(cat "$SCRATCH/t10-base")" | tar -x -C "$B"
ln -s "$TREE/server/node_modules" "$B/server/node_modules"
# the Step 1 block, unchanged, onto the base's own module
awk '/^\/\/ ── Plan 3a Task 10 — the live shape \(begin\)/{p=1} p' server/test/codexLaneFixture.ts \
  >> "$B/server/test/codexLaneFixture.ts"
# the Step 1 TREE_FILES lines, unchanged, onto the base's own list
python3 - server/test/installTreeFixture.ts "$B/server/test/installTreeFixture.ts" <<'PY'
import pathlib, re, sys
tip, base = (pathlib.Path(a) for a in sys.argv[1:])
m = re.search(r"^  // Plan 3a Task 10: the model-registry op.*?^  'shared/litellm\.mjs',\n", tip.read_text(), re.S | re.M)
assert m, "the tip's installTreeFixture.ts carries no Task 10 block"
anchor, b = "  'deploy/account-op.mjs',\n", base.read_text()
assert b.count(anchor) == 1, f"the base's list carries {b.count(anchor)} account-op lines, not 1"
base.write_text(b.replace(anchor, anchor + m.group(0)))
PY
cat >> "$B/server/test/ccrc-install.test.ts" <<'EOF'

// MEASURE ONLY — Plan 3a Task 10 Step 3; appended to a disposable copy of the BASE and never committed.
import {
  plantLiveShape as measureLiveShape, doctorClasses as measureClasses, liveShapeRefreshes as measureRefreshes,
} from './codexLaneFixture.js';
describe('MEASURE the live shape on this tree', () => {
  it('writes it to REHEARSAL_OUT', async () => {
    // liveBox's calls, then the live case's, in its order and with its env (REHEARSAL_ENV)
    const env: NodeJS.ProcessEnv = { ...READY, CCGPT_CONFIG: undefined };
    const home = freshBox('ccrc-rehearsal-measure-');
    gitInit(treeRoot(home));
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'agent.env'),
      'CCRC_SERVER_URL=http://127.0.0.1:7788\nCCRC_AGENT_TOKEN=fixture-not-a-real-token\n');
    measureLiveShape(home, (argv) => runInstall(home, argv, env, { from: REPO_CCRC }));
    plantRuntimeTemplate(home, { verdict: 'pass', version: '1.101.0' });
    const install = [1, 2].map(() => {
      const r = runInstall(home, ['install', '--role', 'fleet'], env);
      return { code: r.code, classes: measureClasses(r.stdout) };
    });
    const refresh = await measureRefreshes(home, { ...ccrcEnv(home), ...env }, realPy());
    const d = runInstall(home, ['doctor'], env);
    writeFileSync(process.env['REHEARSAL_OUT']!,
      `${JSON.stringify({ install, refresh, doctor: { code: d.code, classes: measureClasses(d.stdout) } })}\n`);
    await killLaneProcesses(home);
  }, 240_000);
});
EOF
( cd "$B/server" && REHEARSAL_OUT="$SCRATCH/t10-base-live-shape.json" \
    "$CENSUS" "$EVID/t10-s3-base" ./node_modules/.bin/vitest run test/ccrc-install.test.ts -t 'MEASURE the live shape' )
grep -cE '"/(tmp|home|mnt|Users|var)/' "$SCRATCH/t10-base-live-shape.json"   # expected: 0 (HOME is written ~)
node -e 'console.log(JSON.stringify(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")), null, 2))' \
  "$SCRATCH/t10-base-live-shape.json"
rm -rf -- "$B"   # by path: a scratch directory, never a git operation (F5)
```

Expected:
- 1 passed, then `census: clean … command exit 0`, then `0`.
- The printed object. Measured at drafting on a copy of `4ec8926a`, whose tree outside `docs/` is `1f9fa22d`'s:
  - `install`: two entries, each `code: 0` with one `"<check>": "<CLASS>"` pair for every entry in the base's table (39 at `1f9fa22d`; re-derive the count), two `WARN`s, no `FAIL`, and `"models": "PASS"`;
  - `refresh`: two entries, each `status: 0` with the one row `{ "id": "codex-a", "probe": "codex", "ok": true, "count": 2, "litellm": "rendered" }` and one probe call whose `CHATGPT_TOKEN_DIR` is `~/.handoff/chatgpt-auth` and whose `LITELLM_LOCAL_MODEL_COST_MAP` is `<unset>`. The first changed the box-global config and its `.prev` and ran no `ccgpt`; the second changed the config and ran `ccgpt stop` once;
  - `doctor`: `code: 0` and the same checks.

If any class shows a FAIL, or either refresh exited non-zero, **stop**: the fixture is wrong, not the tree.

Paste the printed object as `BASE_LIVE_SHAPE`'s value: it is JSON, which TypeScript reads as an object literal of the declared type. Re-run the Step 2 command. Expected **GREEN**: 1 passed.

- [ ] **Step 4: The whole rehearsal at the tip.**

Two foreground calls, one suite each (F6):

```bash
. "<abs scratch>/plan3a-env.sh"
cd server && "$CENSUS" "$EVID/t10-s4-install" ./node_modules/.bin/vitest run test/ccrc-install.test.ts -t 'Plan 3a Task 10'
```

```bash
. "<abs scratch>/plan3a-env.sh"
cd server && "$CENSUS" "$EVID/t10-s4-update" ./node_modules/.bin/vitest run test/ccrc-update.test.ts -t 'Plan 3a Task 10'
```

Expected: 6 passed in the install suite and 1 passed in the update suite, each followed by `census: clean … command exit 0`.
- A check whose class moves from the base's is a defect in Tasks 1–9, because ruling Z7 makes identity the requirement. It is fixed in that task's code, never in the expectation, and reported.
- A refresh observation that differs from the base's is the same kind of defect: ruling Z1 keeps the external path byte for byte.
- A FAIL on the `.pre-ccrc-` file would be a finding for Plan 3b's runbook. Report it; never widen the fixture to hide it.

- [ ] **Step 5: The mutation table.**

Each row un-lands one piece of Tasks 1–7 in the working tree. It backs up the one file it edits, replaces the row's **Old** text, which must occur exactly once, with its **New** text, runs only the case that must red, restores the file from its backup, checks the restore with `git diff --quiet` (F7: `ccd/` and `deploy/` are committed by Tasks 1–9 and this task never edits them), and runs the case again as its control. Every Old is text Tasks 1–7 land; re-read it in the file and copy it from there, indentation included. Rows M2–M4 quote Task 2's two guard lines as Task 2 writes them, with the file's indentation; Step 0 counted each exactly once. If a mutation does not red, **report it**; never manufacture code to force a red (Global Constraints). A red that lands on an earlier assertion of the same stage still binds the row's guard; record which assertion fired.

| # | Un-lands | File, function | Old → New | Case (`-t`) | Expected red |
|---|---|---|---|---|---|
| M1 | Z1: the external probe path keeps its token-directory default | `ccd/ccrc-models-probe`, the external path of the codex fetch (`grep -nF ':-$HOME/.handoff/chatgpt-auth}' ccd/ccrc-models-probe` finds its one code line) | `:-$HOME/.handoff/chatgpt-auth}` → `:-}`: the default withdrawn, as the superseded R-C2 had it | `live shape` | `the external lane's hourly refresh did not do what the base's did (ruling Z1)` (the probe answers `not logged in`, the row is `ok:false`, the unit exits 1) |
| M2 | Z4's scope: the guard fires only while the roster carries a codex row | `ccd/ccrc`, `_models_litellm`'s external arm: Task 2's guard, the first statement inside `if _models_litellm_running; then` | `    if blocked="$(_models_litellm_stop_blocked)"; then` → `    if :; then`, so it fires on every owed stop | `live shape` | `the external lane's hourly refresh did not do what the base's did (ruling Z1)` (the second refresh's row is `ok:false` with Task 2's refusal, and no `stop` is recorded) |
| M3 | Z4: the external arm never runs the other repository's stop once a codex lane exists | the same line | `    if blocked="$(_models_litellm_stop_blocked)"; then` → `    if false; then` | `ruling Z4` | `the external arm did not refuse` (the arm runs the recorder's `stop`, writes the render and exits 0, so this is the first assertion to fire) |
| M4 | Z3: an external lane cannot gain a codex registry | `deploy/models-op.mjs`, the `init` arm: Task 2's guard | `    if (a.probe === 'codex' && !(isObj(account.exec) && account.exec.kind === 'codex')) {` → `    if (false) {` | `live shape` | `init codex on an external lane was not refused` |
| M5 | Task 6's converge keyed on `exec.kind` | `ccd/ccrc`, `_inst_codex_usage` | the two lines `  local -a codex=() enabled=() withheld=() withdrawn=()` and `  lanes="$(_codex_lanes)" \|\| lrc=$?` → the first unchanged, then `  lanes="$(. "$HOME/.ccrc/accounts.sh" && printf '%s\n' ${CCRC_CODEX_BACKEND[@]+"${CCRC_CODEX_BACKEND[@]}"})" \|\| lrc=$?` (the telemetry-keyed list, which names both external rows). The second line alone also stands in `_inst_codex_runtime` and `_inst_codex_tiers` | `live shape` | `install pass 1: an instance was enabled on a box with no codex lane` |
| M6 | Task 6's own name for the pair: the converge also places it under the other repository's template names | `ccd/ccrc`, `_inst_units` | the line `    _inst_atomic "$tree/deploy/systemd/ccrc-codex-usage@.timer" "$dir/ccrc-codex-usage@.timer" 644` → that line, then `    _inst_atomic "$tree/deploy/systemd/ccrc-codex-usage@.service" "$dir/ccgpt-usage@.service" 644` and `    _inst_atomic "$tree/deploy/systemd/ccrc-codex-usage@.timer" "$dir/ccgpt-usage@.timer" 644` | `live shape` | `install pass 1: a foreign byte, mode or link changed` |
| M7 | Task 6's disable of an instance whose id is no longer codex | `ccd/ccrc`, `_inst_codex_usage`'s withdraw loop | the two lines `    if systemctl --user disable --now "$u"; then` and `      withdrawn+=("$e")` → `    if :; then` and `      withdrawn+=("$e")`. The first line alone also stands in Task 7's `_uninst_codex_usage` | `the flip back` | `the converge did not disable an instance whose lane is no longer codex` |
| M8 | Task 6's withheld enable beside the other repository's instance (R6) | `ccd/ccrc`, `_inst_codex_usage`'s enable loop | `    if _codex_usage_enabled "$f"; then` → `    if false; then` | `out of order` | `ccrc enabled a second writer over one limits row` |
| M9 | `_uninst_units` removes only ccrc's own pair (Task 6, 6e) | `ccd/ccrc`, `_uninst_units`' `rm -f` | `    "$dir/ccrc-codex-usage@.service" "$dir/ccrc-codex-usage@.timer" \` → `    "$dir/ccrc-codex-usage@.service" "$dir/ccrc-codex-usage@.timer" "$dir/ccgpt-usage@.timer" \` | `live shape` | `uninstall: a foreign byte, mode or link changed` |

Each row is two foreground calls (F6). First write the row's Old text to `$SCRATCH/t10-<M>.old` and its New text to `$SCRATCH/t10-<M>.new` (an empty file for a deletion), then the mutated run:

```bash
. "<abs scratch>/plan3a-env.sh"
cd "$(git rev-parse --show-toplevel)"
M=M1; F=ccd/ccrc-models-probe; T='live shape'   # one row at a time, from the table above
cp -- "$F" "$SCRATCH/t10-$M.orig"                # the row's one file, one backup (F7)
python3 - "$F" "$SCRATCH/t10-$M.old" "$SCRATCH/t10-$M.new" <<'PY'
import pathlib, sys
f, old, new = (pathlib.Path(a) for a in sys.argv[1:])
s, o, n = f.read_text(), old.read_text(), new.read_text()
assert o != "" and s.count(o) == 1, f"{f}: the row's Old text occurs {s.count(o)} times, not once"
f.write_text(s.replace(o, n))
PY
( cd server && "$CENSUS" "$EVID/t10-$M" ./node_modules/.bin/vitest run test/ccrc-install.test.ts -t "$T" ); echo "rc=$?"
```

Then the restore and the control:

```bash
. "<abs scratch>/plan3a-env.sh"
cd "$(git rev-parse --show-toplevel)"
M=M1; F=ccd/ccrc-models-probe; T='live shape'   # the same row
cp -- "$SCRATCH/t10-$M.orig" "$F" && git diff --quiet -- "$F" && echo restored
( cd server && "$CENSUS" "$EVID/t10-$M-control" ./node_modules/.bin/vitest run test/ccrc-install.test.ts -t "$T" )
```

Expected for every row:
- the mutated run: 1 failed at the named assertion, then `census: clean … command exit 1` and `rc=1`;
- the file is `restored`;
- the control: 1 passed, then `census: clean … command exit 0`.

At the end, `git diff --quiet -- ccd/ deploy/ && echo tree-clean` prints `tree-clean`.

- [ ] **Step 6: The neighbours, in full.**

One foreground call per suite (F6), with `f` set in turn to `ccrc-install`, `ccrc-update`, `install-census`, `single-definition` and `typecheck-tests`:

```bash
. "<abs scratch>/plan3a-env.sh"
f=ccrc-install   # then ccrc-update, install-census, single-definition, typecheck-tests: one call each
cd server && "$CENSUS" "$EVID/t10-s6-$f" ./node_modules/.bin/vitest run "test/$f.test.ts"
```

Expected:
- All five are green.
- `ccrc-install.test.ts` gains 6 cases and `ccrc-update.test.ts` gains 1.
- `install-census`, `single-definition` and `typecheck-tests` have unchanged counts. `TREE_FILES` is still defined once (`single-definition.test.ts:3208`).
- Every run ends with `census: clean … command exit 0`.

A red in a known load flake (CLAUDE.md) is re-run in isolation before anything is called a break.

- [ ] **Step 7: Commit.**

```bash
git add server/test/codexLaneFixture.ts server/test/installTreeFixture.ts server/test/ccrc-install.test.ts server/test/ccrc-update.test.ts
git commit -F - <<'EOF'
test(gpt-lane): Plan 3a Task 10 — the cutover rehearsal: the live shape is inert, a flip and a flip back converge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log -1 --format='%an <%ae>'   # checked against the repository's identity rule, as Tasks 6–9 do
```

### Task 11: Close-out: spec §20, the residue class, the count table, the wave-close gate

**Files:**
- Modify: `docs/superpowers/specs/2026-09-20-gpt-lane-ownership-design.md`. Append a new `## 20. Amendments (Plan 3a)` after line 974, the file's current last line, and make same-line pointer edits only (R9).
- Modify: `server/test/topology-clean.test.ts`. Append entries to `ROSTER_RESIDUE` (`:288-290`), and extend the docstring above it (`:279-287`) in place.
- Modify: this plan's **Count table** (below). Execution-time departures are reported by slug and minted by the controller.
- Test (read-only):
  - the full 12-shard server suite, the agent and pwa suites, and `typecheck-tests.test.ts`;
  - `deviation-refs.test.ts`, `dtbd.test.ts` and `topology-clean.test.ts`;
  - `session-hook.test.ts -t "compaction card"`.
- Scratch only, never committed:
  - `$SCRATCH/t11-*`: the scripts, and the residue value files, base64 lines at 0600 (F4), the value files deleted by Step 4;
  - `$SCRATCH/t11-residue-copy`, Step 3's disposable copy of `HEAD` with a repository of its own, removed by path in Step 4;
  - never read or written by this task: the primary checkout's gitignored `deploy/reference-fleet.md` (ruling F1). It has no GPT-lane section (measured at drafting); adding one is Plan 3b Task 1's.

**Interfaces:** consumes the end state of Tasks 1–10. It produces spec §20, one or more new `ROSTER_RESIDUE` entries and the count table, and nothing in `ccd/`, `shared/` or `deploy/`.

**Why:**
- **The spec is the authority the next two plans argue from.** Plans 3b and 4 argue from it, and several of its sentences are false once Tasks 1–10 land.
- **Every amendment is appended (R9, critic #9).** The tree cites this document by line number: `ccd/ccgpt-usage.py` cites §5.4 line 333, `ccd/ccrc-models-probe:177` cites line ~497, and the Plan 2a plan cites lines 497 and 698. Any line above §20 that moved would silently re-aim one of those citations, so every correction is appended as §20, and the sentence it corrects gets a same-line pointer. Step 2 proves it mechanically.
- **The residue class learns the GPT-lane labels (R10, critic #16).** `topology-clean`'s fleet-account-label class encodes only the four Anthropic labels and the employer name, so a GPT-lane label would ship green.
  - One of the two live labels is byte-equal to a token the class's own `passes` list already pins. The class is a case-insensitive substring pattern over every tracked blob, so that token cannot join it (D-3722).
  - The hand-grep covers that label, together with the values no class expresses: lane 2's ports, the OAuth directory names, the per-lane config names, and the session codenames. All of them are measured read-only on the box at execution time (ruling F1).
  - **No real value is written to a tracked file in clear or printed, even transiently (F4).** The red-first proof uses a synthetic label in a disposable copy. Real values live only base64-encoded in 0600 scratch files, and every run that carries one is read by counts and exit codes.
- **The unit and process census gates every suite command (R11, critic #17).** Plan 2b-2's suite leaked a real transient unit and dozens of processes into the live user manager. Recorders are necessary but not sufficient, so the gate observes the real user manager before and after every command.

- [ ] **Step 0: Confirm the base and the cut.**

```bash
. "<abs scratch>/plan3a-env.sh"
cd "$(git rev-parse --show-toplevel)"
git merge-base origin/main HEAD > "$SCRATCH/t11-base"
BASE="$(cat "$SCRATCH/t11-base")"
git log --oneline "$BASE"..HEAD                     # Tasks 1–10, each its own commit
git diff --quiet "$BASE" HEAD -- ccd/ccd ccd/ccgpt-runtime ccd/ccgpt-proxy.py && echo CUT-OK
git diff --quiet "$BASE" HEAD -- shared/litellm.mjs deploy/litellm-config.template.yaml && echo RENDER-OK
# Ruling Z1: the external path's bytes. Compared, never printed: `_fetch_codex` spells the probe's default directory.
fx() { sed -n '/^_fetch_codex() {$/,/^PY$/p'; }
cmp -s <(git show "$BASE:ccd/ccrc-models-probe" | fx) <(git show HEAD:ccd/ccrc-models-probe | fx) && echo FETCH-OK
git diff -U0 "$BASE" HEAD -- ccd/ccrc-models-probe | grep -c '^-[^-]'   # expected: 1, `_fetch`'s old `codex)` line (Task 1)
hx() { sed -n '/^_models_litellm_path() {/,/^}$/p; /^_models_litellm_running() {/p'; }
cmp -s <(git show "$BASE:ccd/ccrc" | hx) <(git show HEAD:ccd/ccrc | hx) && echo HELPERS-OK
ax() { sed -n '/^_models_litellm() {/,/^}$/p' | sed -n '/^  local file check crc$/,$p'; }
diff <(git show "$BASE:ccd/ccrc" | ax) <(git show HEAD:ccd/ccrc | ax) | grep -cE '^[0-9]+(,[0-9]+)?[acd][0-9]+(,[0-9]+)?$'   # expected: 1 hunk
diff <(git show "$BASE:ccd/ccrc" | ax) <(git show HEAD:ccd/ccrc | ax) | grep -cE '^[0-9]+a[0-9]+(,[0-9]+)?$'   # expected: 1, and it is an insertion
diff <(git show "$BASE:ccd/ccrc" | ax) <(git show HEAD:ccd/ccrc | ax) | grep -c '^<'   # expected: 0, no line of the arm's body removed or changed
git grep -nE 'systemctl[^|;]*ccgpt-usage' -- ccd deploy | wc -l   # expected: 2 (R2: ccrc never drives it; the two are operator remedies)
```

Expected, in order: `CUT-OK`, `RENDER-OK`, `FETCH-OK`, `1`, `HELPERS-OK`, `1`, `1`, `0`, and `2`. Every check reads Tasks 1–10's commits, which exist by now (F3).
- The ruling-Z lines prove Z1 over the whole plan, where Task 1's cut proved only its own commit. They say:
  - `_fetch_codex` is byte-identical, and the probe's one removed line is `_fetch`'s old `codex)` dispatch;
  - `_models_litellm_path` and `_models_litellm_running` are unchanged, and so are the renderer and the template the external arm renders with;
  - the external arm's body, from `local file check crc` to its closing `}`, differs from the base by one inserted block, Task 2's Z4 guard, and nothing else.
  Any other answer stops the step: name the commit.
- If `CUT-OK` is missing, stop and name the commit. `ccd/ccd` would mean a re-stamp and a census charge, and `ccd/ccgpt-runtime` would rebuild every box that has a codex lane.
- The `2` are Task 6's two operator remedies for the other repository's flat timer, each telling the operator to run `systemctl --user disable --now ccgpt-usage.timer`: one in `_inst_codex_usage`'s note (`ccd/ccrc`) and one in `_dr_codex_usage_box`'s remedy (`ccd/ccrc-doctor-checks`). Read each. Any other hit stops the step unless it is a refusal or a comment naming the other repository's unit.

- [ ] **Step 1: Append §20 and the same-line pointers.**

Append this verbatim after line 974. By the time this step runs, the controller has substituted every `⟦D:<slug>⟧`. Before appending, replace every `‹…›`:
- in §20.10, every `‹…›` with the exact `it(` titles of the cases that hold the row, read from the suites at the tip (`grep -nF "it('" server/test/<file>.test.ts`, then the cases the task's own mutation table names).

After the append, `grep -c '‹' docs/superpowers/specs/2026-09-20-gpt-lane-ownership-design.md` prints `0`.

````markdown

## 20. Amendments (Plan 3a)

Plan 3a (`docs/superpowers/plans/2026-09-30-gpt-lane-ownership-3a-before-the-flip.md`) lands what the tree must do before any roster row is flipped to `codex`, inert on a roster with none and on the fleet box's live shape: by operator ruling Z (2026-10-01), its merge changes nothing an external lane does. §19's rules hold here: a sentence above that the tree now contradicts carries a same-line pointer, `(amended: §20.N, D-NNNN)`, and the item below says what the tree does. **No line above this section moved:** Plan 3a's close-out proves that every hunk above this heading is a same-line pointer and the rest is this append. Each D-number is defined in that plan's Deviations found. *(Added 2026-09-30.)*

### 20.1 The model probe (§9.1)

- **A codex lane's probe has no default.** `_models_run_probe`'s scrub is unchanged. After it, and after any secrets file, `_models_probe_codex_env` exports for an `exec.kind: "codex"` row `CHATGPT_TOKEN_DIR="$HOME/<exec.authDir>"` (read through `_codex_row`), the lane's runtime interpreter as `CCRC_CODEX_PYTHON` (empty when none resolves), and `CCRC_PROBE_LANE_KIND=codex`, the one marker that sends the probe down its codex path, `_fetch_codex_lane`. That path reads exactly the first two and has no default for either. For every other row the function unsets only the marker and the interpreter.
- **The interpreter.** A codex row's probe runs `ccgpt-runtime python` under `-I`, with `LITELLM_LOCAL_MODEL_COST_MAP=True` and every `CHATGPT_*`, `LITELLM_*` and `OPENAI_*` name scrubbed first. This is the probe half that Plan 2b-2 carried forward.
- **Refusals** on the codex path, one line each, with a remedy:
  - `no-token-dir`;
  - `runtime-absent` (run `ccrc install`);
  - `not-logged-in` (run `ccrc codex login <id>`): the `authDir` holds no `auth.json`, tested for existence only, before any interpreter runs;
  - `runtime-api-moved` (run `ccrc update`): the runtime's `Authenticator` lacks a name the unattended guard overrides;
  - `login-required` (run `ccrc codex login <id>`).
  Nothing opens `auth.json` to decide.
- **An external lane keeps today's probe path until its flip (D-3706).** For any row that is not codex-kind, the probe runs exactly as before this plan, through `_fetch_codex`: the token-directory default, the interpreter beside the `litellm` on PATH, and no `-I`. So the hourly refresh keeps probing, refreshing and rendering for an external lane that has a codex registry, and `_check_models` is unchanged. The device-flow guard below is the codex path's alone, because the external path is its own function with today's bytes (ruling Z2's one-program allowance is not taken). Plan 3b's flip moves a lane onto the codex path with no other act.
- **An external lane cannot gain a codex registry (D-3706).** A codex class registry is created only on an `exec.kind: "codex"` row. `ccrc models <id> init codex` on any other row, the `external` rows included, is refused `codex-registry-needs-codex-lane` by `deploy/models-op.mjs`' `init` op, the one creator of a registry, so every caller of the op is covered. It writes nothing and names the remedy: flip the lane to `codex` first (Plan 3b). A registry that already exists is untouched, and every other probe kind is created on any row as before. So on today's shape the default probes only the lane whose directory it is: a lane with no registry is never probed, and none can gain one before its flip. A lane that is flipped back keeps the registry it had as a codex lane, and Plan 3b's rollback says what becomes of it.
- **No device flow outside `ccrc codex login`.**
  - On the probe's codex path and in `ccd/ccgpt-usage.py`, the `Authenticator`'s device-code path is replaced in-process by a `login-required` refusal, which fires before anything writes `auth.json`.
  - So a codex lane whose token cannot be refreshed answers within the probe's bound and never leaves a cooldown marker behind.
  - `ccrc-codex-usage@.service` carries `TimeoutStartSec=300` (D-3707).
- **The account id (closes D-3161 for every codex lane).** The probe's codex path takes `ChatGPT-Account-Id` from `Authenticator().get_account_id()` and opens no `auth.json`. When `auth.json` carries no `account_id`, that call derives one from the token's claims and writes it back: a library write, the same class as its `expires_at` write. The external path's direct `auth.json` read stays, byte for byte, until the final plan deletes that path, so §9's closing sentence is true of every codex lane and not yet of the external path.

### 20.2 The external LiteLLM arm, until each lane's flip (§8, §19.6)

- **It keeps its bytes on a roster with no codex row.** `_models_litellm`'s external arm still renders the other repository's box-global config, still asks the `pgrep`, and still runs the bare `ccgpt stop` when a changed render meets a running proxy. §19.6 stands as written: Plan 3a does not retire the arm before the flip (D-3708 records the retirement ruling Z withdrew).
- **It never runs the other repository's stop once a codex lane exists (D-3753).** A bare `ccgpt stop` stops units by name, and after a flip those names are ccrc's own tiers. So while the roster carries any `exec.kind: "codex"` row, or while the lane library cannot say which rows are, a stop the external arm would owe is refused through its existing `restart-failed` path, before any write, with a sentence that names why and never sends the operator to `ccgpt stop`. On a roster with no codex row this changes nothing, and with nothing to stop the arm still renders as before.
- **A lane leaves the arm at its own flip,** when `_models_litellm_codex` starts answering yes for it. The final plan's ccrc half deletes the arm and this guard together, once no external lane has a codex registry (§20.9).

### 20.3 `_check_codex` (§12)

- **Placement and skips.** The check sits after `models` in the check table. It SKIPs on role `server` and on an empty codex population: one line, then `return 3`. An absent roster file SKIPs too, because the `wrappers` check already FAILs it (D-3723).
- **An unreadable roster is not an empty population.** `_codex_lanes`' roster-invalid answer and its missing-jq answer are FAILs, naming `ccrc wrappers` and jq (D-3710).
- **The runtime row trusts the stamp.** It asks `ccgpt-runtime check`, which compares the stamp. Doctor never re-runs the behaviour probe; `--fix`'s rebuild is what re-probes (D-3711).
- **`lane.json` staleness is measured two ways.**
  - Against the roster row, by `_codex_lane_json_state`.
  - Against the registry and catalogue, by `deploy/models-op.mjs materialise --check true`, which writes nothing and answers `changed`. Without `--check` it writes, as every caller before it expects (D-3712).
- **Rows beyond the table above**, each its own sentence with its own remedy:
  - lane state left for an id that is no longer codex (a flip back);
  - a non-codex registry on a codex lane (FAIL);
  - a tier that cannot be asked at all, and one whose staleness cannot be told (each a WARN, unmeasured, never PASS);
  - a stopped `litellm` tier on a lane with live sessions (WARN);
  - a unit whose identity is not yet proven inside `RestartSec`, worded as a retry.

  Tier identity is `_codex_tier_ours`, every connect is bounded by `CCRC_CODEX_PROBE_S`, and anything foreign is worded by `_codex_foreign_what`. Nothing is signalled (D-3713, D-3714, D-3715, D-3716). An `authDir` holding no `auth.json` is a FAIL in `ccrc codex start`'s own words (D-3724).
- **Registry facts** are read through `deploy/models-op.mjs`'s check-only ops, never by a second reader of `<id>.classes.json`.
- **The settings-env drift check.** `deploy/account-op.mjs`'s `effectiveBaseUrl` answers `http://127.0.0.1:<proxyPort>` for a codex lane. The rule is absent-or-equal: no ccrc writer puts `ANTHROPIC_BASE_URL` in a codex home's `settings.json` (the launcher exports it instead), so absent is healthy and present-but-different is the WARN (D-3709).

### 20.4 Usage publication, under ccrc's own name (§4.3, §10, §11, §12, §13, §19.8)

- **The name.** ccrc's pair is `ccrc-codex-usage@.service` / `ccrc-codex-usage@.timer`, in `deploy/systemd/`.
  - `ccgpt-usage@` stays the other repository's name. ccrc never places, enables, disables or removes a unit under it, and `install-census.test.ts` still refuses that prefix.
  - Wherever a sentence above names `ccgpt-usage@<id>.timer` as ccrc's unit, read `ccrc-codex-usage@<id>.timer` (D-3717).
- **Placement and convergence.**
  - `_inst_units` places the pair on roles `fleet` and `both`, on Linux.
  - `_inst_enable` converges the enabled instance set to exactly the roster's codex lanes: it enables `ccrc-codex-usage@<id>.timer` for each codex lane and disables any enabled instance whose id is no longer one, so a flip back converges (D-3718).
- **Beside a foreign instance.** While the other repository's `ccgpt-usage@<id>.timer` is enabled for the same id, the converge withholds ccrc's enable and degrades, and `_check_codex` WARNs with the operator's own disable as the remedy. Two publishers over one `~/.cc-limits/<id>.json` is the race §10 retires. The other repository's flat, id-less timer cannot be attributed to any lane, so no code refuses on it; retiring it is the runbook's act, and doctor names it as unattributable (D-3719). "Enabled" is read from `timers.target.wants/` links, by one set of helpers that the converge, uninstall, account removal and doctor share (D-3726).
- **Degraded timer enables are counted.** Every timer enable in `_inst_enable` that degrades now also joins `INST_DEGRADED`, so the closing line never claims convergence over a failed enable (bookkeeping: Plan 2b-2's carry-forward item 10).
- **Uninstall and account removal.** Uninstall runs `disable --now` on every enabled instance of ccrc's template, then removes the pair, so §13's sentence is now true. Account removal disables ccrc's instance for that id, whatever the row's kind, and keeps its OAuth directory and logs (D-3727). §19.8's "the usage unit template pair is not removed" no longer holds.

### 20.5 `doctor --fix` (§12)

- **What `_fix_codex` does.** It restores ccrc-owned executables from the shipped tree through `_inst_atomic`, the primitive `_inst_bins` places them with. It runs `ccgpt-runtime build` (which re-probes) when `ccgpt-runtime check` refuses. It re-materialises `lane.json`, re-renders the lane's LiteLLM config through the codex arm, and restarts a verified-own stale tier only after it replaced code. Doctor's re-measurement is the verdict.
- **What `_fix_wrappers` does.** A launcher is the `wrappers` check's measurement, so its cure rides that check. `_fix_wrappers` runs the shipped `ccrc wrappers` with no flag, which overwrites only a launcher whose ccrc marker still verifies, writes an absent one, and refuses every other file. It reaches generated launchers too (D-3730).
- **What it never does:** choose a port, run OAuth, read a credential, signal an unproven process, overwrite an unverified launcher, or delete state.
- **Fixers run on a FAIL only.** `cmd_doctor` runs a fixer only on a FAIL, for every check, as `_fix_skills` established. A missing or disabled usage timer is a WARN, so `--fix` does not enable it. That row's remedy is `ccrc install`, whose converge enables the timer. A tier running stale code is a WARN too, so `--fix` does not restart it on that alone: its remedy names `ccrc update`, whose install step restarts a proven, stale ccrc tier, or the lane's own `ccrc codex stop` and `start` (D-3721).
- **The publisher's remedy.** The publisher's refusal for an absent `lane.json` names a remedy that works on this tree.

### 20.6 What converges `lane.json` (§4.2)

- Besides `ccrc wrappers` and `ccrc models litellm <id>`, `lane.json` converges through `ccrc codex start <id>`, which renders whatever is absent, and through `ccrc doctor --fix` (bookkeeping: §4.2 named two of the four paths).

### 20.7 The fallback deploy (§11)

- `deploy/deploy.sh`'s agent arm places ccrc's usage pair, and `agent/test/deploy-verify.test.ts` derives its landed list from the agent chain's own `_unit_atomic` operands rather than keeping a hand-typed one (D-3729).
- `deploy.sh` no longer places `~/.local/bin/ccrc-models-probe`. ccrc never runs that copy; it runs its own tree's copy through `$CCRC_HERE`. Removing a stale PATH copy from a box is Plan 4's job (bookkeeping: ruling R-C11).
- `ccrc-uninstall.test.ts`' absence list is what its fixture planted, and the fixture must plant every `_inst_units` destination (D-3728).

### 20.8 macOS (§10, §12)

- `_inst_units_darwin` places no timer at all (decision 17: macOS is not centrally managed, and `ccrc-models.timer` has no Darwin arm either). So the usage pair and its converge are Linux-only. On Darwin, `_check_codex`'s usage rows answer a stated not-applicable rather than WARN forever (D-3720).

### 20.9 The cutover's order, as the release lane runs it (§15, §16)

- **The merge is the rollout.** Every merge to `main` becomes a prerelease that both boxes follow automatically, so §15 step 1's "nothing is deployed" and step 2's `ccrc rollout` no longer describe how this work lands.
  - By operator ruling Z (2026-10-01), Plan 3a's merge changes nothing an external lane does. On the fleet box's live shape it places ccrc's inert usage pair and adds doctor's `codex` row, which answers one SKIP. Every other check keeps its class, `models` included, and the external lane's hourly refresh probes, renders and stops exactly as before (D-3705).
  - Its rehearsal (`ccrc-install.test.ts`, "Plan 3a Task 10") is the evidence: it measures the base on the same fixture and asserts that the tip's answer equals it.
- **§15 step 3 is Plan 3b**, one authorisation per lane.
  - Each lane leaves the external path at its own flip, with no other act: from the roster edit on, its probe takes the codex path and its LiteLLM step the lane's own arm.
  - There, "retire the fixed usage timer" means disabling each of that lane's timers from the other repository, the flat one and any template instance, before ccrc's instance is enabled. The converge refuses the out-of-order case for an instance.
  - A lane with no registry gains one only after its flip (§20.1).
- **§15 step 4 is Plan 4**, and its ccrc half is now code and docs: once no external lane has a codex registry, it deletes `_models_litellm`'s external arm, the probe's token-directory default, the external probe path's direct `auth.json` read, and the two guards §20.1 and §20.2 add.

### 20.10 Who holds each mutation-table row Plan 3a added (§18)

| Guard | Task | Held by (the case title, read from the suite at execution) |
|---|---|---|
| a codex lane's probe gets its own `authDir` and runtime, never another lane's | 1 | `ccrc-models.test.ts`: ‹the two-lane case› |
| no token-directory default on the codex path; its refusals | 1 | `models-probe.test.ts`: ‹cases› |
| the device flow never writes `auth.json` (the probe's codex path and the publisher) | 1 | `models-probe.test.ts`, `ccgpt-usage.test.ts`: ‹the marker cases› |
| an external lane keeps today's probe path and hourly refresh, and every doctor check keeps its class, `models` included | 1, 10 | `ccrc-models.test.ts`: ‹cases›; `ccrc-install.test.ts`: "the base tree: …", "live shape: …" |
| a codex registry is created on a codex-kind row only | 2, 10 | `models-op.test.ts`, `ccrc-models.test.ts`: ‹cases›; `ccrc-install.test.ts`: "live shape: …" |
| the external arm keeps its bytes on a roster with no codex row, and refuses the stop it owes once one exists | 2, 10 | `ccrc-models.test.ts`: ‹cases›; `ccrc-install.test.ts`: "live shape: …", "ruling Z4: …" |
| a models case reaches no real `pgrep` or `ccgpt`, and inherits no `CCGPT_CONFIG` | 2 | `ccrc-models.test.ts`: ‹the containment-wall case› |
| settings env absent or equal for a codex lane | 3 | `ccrc-doctor.test.ts`: ‹accounts cases› |
| `_check_codex`: SKIPs, FAILs, rc equals the worst class | 4 | `ccrc-doctor.test.ts`: ‹cases› |
| tier identity, a half-up lane, stale code, a down gateway under live sessions | 5 | `ccrc-doctor.test.ts`: ‹cases› |
| the pair under ccrc's name, one instance per codex lane, the flip-back disable, the degrade beside a foreign instance | 6, 10 | `ccrc-install.test.ts`: ‹cases›; "the flip …", "the flip back …", "out of order: …" |
| every timer-enable degrade joins `INST_DEGRADED` | 6 | `ccrc-install.test.ts`: ‹case› |
| uninstall and account removal disable instances; derived lists | 7 | `ccrc-uninstall.test.ts`, `ccrc-account.test.ts`, `agent/test/deploy-verify.test.ts`: ‹cases› |
| `_fix_codex` cures FAILs; the re-measurement is the verdict | 8 | `ccrc-doctor.test.ts`: ‹cases› |
| a `--force` backup keeps a symlink a symlink | 9 | `ccrc-wrappers.test.ts`: ‹case› |
| the live shape is inert through update | 10 | `ccrc-update.test.ts`: "a real update leaves every foreign byte …" |
| the GPT-lane labels in the residue class | 11 | `topology-clean.test.ts`: the fleet-account-label class's `catches` |
````

Then make these same-line pointer edits. The line numbers were measured at `1f9fa22d`; re-derive each with the grep shown.

| Line | Locate with | Edit (same line, nothing else) |
|---|---|---|
| 179 | `grep -n '^converge it\. A minting verb' <spec>` | `converge it (amended: §20.6). A minting verb …` |
| 196 | `grep -n '^| usage timer |' <spec>` | `` | usage timer | `ccgpt-usage@<id>.timer` (amended: §20.4, D-3717) | `` |
| 249 | `grep -n '| the per-lane usage instance pair |$' <spec>` | before the final ` |`: ` (amended: §20.4, D-3717)` |
| 450 | `grep -n 'An .external. lane keeps the bare .ccgpt stop., byte for byte' <spec>` | directly after `until Plan 3's cutover`: ` (amended: §20.2, D-3753)` |
| 476 | `grep -n '^   not carry\.$' <spec>` | `   not carry. (amended: §20.1, D-3706)` |
| 512 | `grep -n 'The pair itself stays unplaced until Plan 3 arms it' <spec>` | append ` (amended: §20.4, D-3717, D-3718)` |
| 548 | `grep -n 'until then nothing places it (D-' <spec>` | directly after that parenthesis: ` (amended: §20.4)` |
| 565 | `grep -n '^\*\*Fallback deploy\.\*\*' <spec>` | `… on its agent arm (amended: §20.7). Two` |
| 589 | `grep -n '^| no `codex` lane in the roster |' <spec>` | before the final ` |`: ` (amended: §20.3, D-3710)` |
| 591 | `grep -n 'failing its behaviour probe | FAIL |' <spec>` | `… failing its behaviour probe (amended: §20.3, D-3711) | FAIL |` |
| 592 | `grep -n 'absent or stale against the catalogue | FAIL |' <spec>` | `… stale against the catalogue (amended: §20.3, D-3712) | FAIL |` |
| 598 | `grep -n '^| `ccgpt-usage@<id>.timer` missing or disabled |' <spec>` | `… missing or disabled (amended: §20.4, D-3720) | WARN |` |
| 600 | `grep -n '^| every lane healthy, no tier running' <spec>` | before the final ` |`: ` (amended: §20.3)` |
| 604 | `grep -n 'asks about `ccgpt-usage@<id>.timer` per lane' <spec>` | `` … `ccgpt-usage@<id>.timer` (amended: §20.4) per lane, which is `` |
| 612 | `grep -n '^regenerate a marker-verified launcher, re-render' <spec>` | `regenerate a marker-verified launcher (amended: §20.5, D-3730), re-render …` |
| 613 | `grep -n '^timer, and restart a verified ccrc-owned active tier' <spec>` | `timer, and restart a verified ccrc-owned active tier (amended: §20.5, D-3721). It may …`: one same-line pointer, after both WARN-only powers |
| 621 | `grep -n 'so there is nothing to remove), marker-verified' <spec>` | `… nothing to remove) (amended: §20.4), marker-verified …` |
| 674 | `grep -n '`ccrc rollout` as usual\.' <spec>` | `` … `ccrc rollout` as usual (amended: §20.9, D-3705). Both … `` |
| 681 | `grep -n 'Retire the fixed usage timer\. Then the next lane\.' <spec>` | `… Retire the fixed usage timer (amended: §20.9). Then the next lane.` |
| 703 | `grep -n '^- Deploying or rolling out this migration\.' <spec>` | `- Deploying or rolling out this migration (amended: §20.9, D-3705). The operator …` |
| 730 | `grep -n '| per-lane usage instance pair |$' <spec>` | before the final ` |`: ` (amended: §20.4, D-3717)` |
| 904 | `grep -n 'until Plan 3.s cutover retires that arm\.$' <spec>` | append ` (amended: §20.2, D-3753)` |
| 925 | `grep -n 'Plan 3 arms the pair and owns its removal\.$' <spec>` | append ` (amended: §20.4)` |
| 947 | `grep -n '(D-3486);$' <spec>` | directly before the final `;`: ` (amended: §20.4)` |

- [ ] **Step 2: Prove that no line above §20 moved (R9, critic #9).**

The proof diffs the base's blob against a FILE: the worktree's spec here, never `HEAD`, because Step 8 commits the spec only after this proof (F3). Step 10 re-runs it after the commit, where the worktree and `HEAD` agree.

```bash
. "<abs scratch>/plan3a-env.sh"
cd "$(git rev-parse --show-toplevel)"
cat > "$SCRATCH/t11-r9.cjs" <<'EOF'
// t11-r9.cjs <base> <spec-file-on-disk> <scratch>: R9's proof. The base blob is diffed
// against a FILE, the worktree's spec by default, never against HEAD, so the proof sees
// Step 1's edit before Step 8 commits it (F3), and its mutation runs on a scratch copy.
const { execFileSync, spawnSync } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const [base, target, scratch] = process.argv.slice(2);
const spec = 'docs/superpowers/specs/2026-09-20-gpt-lane-ownership-design.md';
const old = execFileSync('git', ['show', `${base}:${spec}`], { encoding: 'utf8' });
const oldLen = old.split('\n').length - 1;
writeFileSync(`${scratch}/t11-spec.base`, old);
const r = spawnSync('git', ['diff', '--no-index', '--unified=0', '--', `${scratch}/t11-spec.base`, target], { encoding: 'utf8' });
if (r.status !== 0 && r.status !== 1) { console.error(`R9 FAILS: git diff --no-index exited ${r.status}`); process.exit(1); }
const POINTER = / \(amended: §20\.\d+(?:, D-\d+)*\)/g;
const bad = [];
let appended = 0;
for (const h of r.stdout.split(/^(?=@@ )/m).slice(1)) {
  const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(h);
  const a = Number(m[1]), b = m[2] === undefined ? 1 : Number(m[2]);
  const c = Number(m[3]), d = m[4] === undefined ? 1 : Number(m[4]);
  const body = h.split('\n').slice(1);
  if (b === 0 && a === oldLen && c === oldLen + 1) { appended += d; continue; }
  if (a !== c || b !== d) { bad.push(`${m[0]}: moves lines`); continue; }
  const minus = body.filter((l) => l.startsWith('-')).map((l) => l.slice(1));
  const plus = body.filter((l) => l.startsWith('+')).map((l) => l.slice(1));
  minus.forEach((o, i) => {
    if ((plus[i] ?? '').replace(POINTER, '') !== o) bad.push(`line ${a + i}: not a pointer-only edit`);
  });
}
if (bad.length > 0) { console.error(`R9 FAILS:\n${bad.join('\n')}`); process.exit(1); }
if (appended === 0) { console.error('R9 FAILS: nothing appended — §20 is not in the diff'); process.exit(1); }
console.log(`R9: ${oldLen} lines above §20 unmoved; ${appended} lines appended; every other hunk is a pointer-only edit`);
EOF
SPEC=docs/superpowers/specs/2026-09-20-gpt-lane-ownership-design.md
node "$SCRATCH/t11-r9.cjs" "$(cat "$SCRATCH/t11-base")" "$SPEC" "$SCRATCH"
grep -c '^## 20\. Amendments (Plan 3a)$' "$SPEC"   # expected: 1
```

Expected: `R9: 974 lines above §20 unmoved; <N> lines appended; every other hunk is a pointer-only edit`, with N > 0, followed by `1`. A diff with nothing appended prints `R9 FAILS: nothing appended — §20 is not in the diff` and exits 1.

**Mutation of this proof**, on a scratch copy, so the worktree's spec is never edited and there is nothing to restore (F7):

```bash
. "<abs scratch>/plan3a-env.sh"
cd "$(git rev-parse --show-toplevel)"
sed '333i\\' docs/superpowers/specs/2026-09-20-gpt-lane-ownership-design.md > "$SCRATCH/t11-spec-mutant.md"   # one blank line above line 333
node "$SCRATCH/t11-r9.cjs" "$(cat "$SCRATCH/t11-base")" "$SCRATCH/t11-spec-mutant.md" "$SCRATCH"; echo "rc=$?"
rm -f -- "$SCRATCH/t11-spec-mutant.md"
```

Expected: `R9 FAILS:`, a line `@@ -332,0 +333 @@: moves lines`, and `rc=1`. The unmutated run above is its control. (Measured on a scratch copy of the spec at `1f9fa22d` with a 4-line append: the control printed `R9: 974 lines above §20 unmoved; 4 lines appended; …`, the mutant `@@ -332,0 +333 @@: moves lines`, and the bare spec `R9 FAILS: nothing appended …`.)

- [ ] **Step 3: The GPT-lane labels join the residue class, red-first on a synthetic label (R10, F4).** No real label is written to a tracked file in clear, or printed, even transiently and even encoded (F4). Real labels are handled only base64-encoded in 0600 scratch files, and every run that carries one has its output suppressed and is read by its exit code. S7's measurement: the class's `passes` list carries a comment with an apostrophe, so its quoted tokens are read only after `//` comments are stripped (eight passes; unstripped, three are lost).

  1. **Which labels join**, by index and verdict only:

```bash
. "<abs scratch>/plan3a-env.sh"
cd "$(git rev-parse --show-toplevel)"
umask 077
jq -r '.accounts[] | select(.telemetry == "codex") | .label | @base64' "$HOME/.ccrc/accounts.json" > "$SCRATCH/t11-labels.b64"
wc -l < "$SCRATCH/t11-labels.b64"                   # expected: 2 (never cat this file)
cat > "$SCRATCH/t11-labels.mjs" <<'EOF'
// t11-labels.mjs <labels.b64> <joiners.b64>: which live labels the class's `passes` does
// not pin. Decodes in memory only; prints an index, a verdict and a count, never a label.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const labels = readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean);
const src = readFileSync('server/test/topology-clean.test.ts', 'utf8');
const cls = src.slice(src.indexOf("name: 'fleet account label'"));
// `//` comments stripped first: one of them carries an apostrophe that breaks the quote pairing
const passes = new Set([...(/passes: \[([\s\S]*?)\]/.exec(cls)?.[1] ?? '').replace(/\/\/[^\n]*/g, '')
  .matchAll(/'([^']*)'/g)].map((m) => m[1]));
if (passes.size !== 8) throw new Error(`expected the class's eight passes, read ${passes.size}`);
const clear = (b) => Buffer.from(b, 'base64').toString('utf8');
const joiners = [];
labels.forEach((b, i) => {
  if (passes.has(clear(b))) console.log(`label ${i + 1}: pinned as a pass by this class — stays out`);
  else { joiners.push(b); console.log(`label ${i + 1}: joins`); }
});
writeFileSync(process.argv[3], joiners.map((b) => `${b}\n`).join(''), { mode: 0o600 });
let tracked = 0;
if (joiners.length > 0) {
  try {
    tracked = execFileSync('git', ['grep', '-I', '-l', '-i', '-F', '-f', '-', '--', '.'],
      { input: joiners.map((b) => `${clear(b)}\n`).join(''), encoding: 'utf8' }).split('\n').filter(Boolean).length;
  } catch (e) { if (e.status !== 1) throw new Error(`git grep exited ${e.status}`); }   // 1: no file matched
}
console.log(`tracked files carrying a joiner today: ${tracked}`);
EOF
node "$SCRATCH/t11-labels.mjs" "$SCRATCH/t11-labels.b64" "$SCRATCH/t11-joiners.b64"
```

  Expected, from the drafting measurement: one `label <i>: pinned as a pass by this class — stays out`, one `label <j>: joins`, then `tracked files carrying a joiner today: 0`. If both join, both go in. If neither joins, record that, skip sub-steps 2 and 3, and go to Step 4.

  2. **The red-first proof, on a synthetic label in a disposable copy (F4).** The label is `zq-synthetic-lane-label`: fixture vocabulary, on no roster and in no tracked file. The copy is `git archive HEAD` plus a repository of its own, because `topology-clean` walks `git ls-files` and resolves a history base; `CCRC_HISTORY_BASE=HEAD` gives its history rows an empty range. This repository is only read (F5).

```bash
. "<abs scratch>/plan3a-env.sh"
cd "$(git rev-parse --show-toplevel)"
D="$SCRATCH/t11-residue-copy"; rm -rf -- "$D"; mkdir -p -- "$D"
git archive HEAD | tar -x -C "$D"
( cd "$D" && git init -q -b main && git add -A \
    && git -c user.name=fixture -c user.email=fixture@example.com commit -qm 'disposable copy' )
ln -s "$PWD/server/node_modules" "$D/server/node_modules"
printf '%s' zq-synthetic-lane-label | base64 > "$SCRATCH/t11-synthetic.b64"
cat > "$SCRATCH/t11-residue-insert.mjs" <<'EOF'
// t11-residue-insert.mjs <topology-clean.test.ts> <b64-file>: appends each base64 line of
// <b64-file> to ROSTER_RESIDUE after its fifth entry, then re-reads the list and checks every
// one decodes as a member. Prints counts only: never a value, encoded or not.
import { readFileSync, writeFileSync } from 'node:fs';
const [target, b64File] = process.argv.slice(2);
const add = readFileSync(b64File, 'utf8').split('\n').filter(Boolean);
const ANCHOR = "'ZXhwb3BsYXRmb3Jt',\n";
const src = readFileSync(target, 'utf8');
if (src.split(ANCHOR).length !== 2) throw new Error('ROSTER_RESIDUE: the fifth entry is not exactly one line end');
writeFileSync(target, src.replace(ANCHOR, `${ANCHOR}${add.map((b) => `  '${b}',\n`).join('')}`));
const list = /const ROSTER_RESIDUE: string\[\] = \[([\s\S]*?)\]\.map/.exec(readFileSync(target, 'utf8'))?.[1] ?? '';
const decoded = new Set([...list.matchAll(/'([A-Za-z0-9+/=]+)'/g)].map((m) => Buffer.from(m[1], 'base64').toString('utf8')));
const present = add.filter((b) => decoded.has(Buffer.from(b, 'base64').toString('utf8'))).length;
console.log(`ROSTER_RESIDUE: ${decoded.size} entries; ${present}/${add.length} added entries present`);
if (present !== add.length) process.exit(1);
EOF
git -C "$D" grep -c -i -F -e zq-synthetic-lane-label; echo "rc=$?"   # expected: rc=1 (no tracked file carries it)
printf 'residue probe: %s\n' zq-synthetic-lane-label >> "$D/README.md"
```

  Then three census runs in the copy, each its own foreground call. Measured at drafting on a copy of `92361061`: 55 passed, then `1 failed | 54 passed`, then 55 passed.
  - **The blindness**, with the plant in place and the class unchanged:

```bash
. "<abs scratch>/plan3a-env.sh"
cd "$SCRATCH/t11-residue-copy/server" && CCRC_HISTORY_BASE=HEAD "$CENSUS" "$EVID/t11-s3-blind" env -u CLAUDE_CONFIG_DIR ./node_modules/.bin/vitest run test/topology-clean.test.ts
```

  Expected: **green**, then `census: clean … command exit 0`. The class cannot see the label.
  - **The guard.** The synthetic label's base64 joins the copy's `ROSTER_RESIDUE` after its fifth entry, so index 4, which `catches` reads, keeps its meaning:

```bash
. "<abs scratch>/plan3a-env.sh"
node "$SCRATCH/t11-residue-insert.mjs" "$SCRATCH/t11-residue-copy/server/test/topology-clean.test.ts" "$SCRATCH/t11-synthetic.b64"
cd "$SCRATCH/t11-residue-copy/server" && CCRC_HISTORY_BASE=HEAD "$CENSUS" "$EVID/t11-s3-guard" env -u CLAUDE_CONFIG_DIR ./node_modules/.bin/vitest run test/topology-clean.test.ts
```

  Expected: `ROSTER_RESIDUE: 6 entries; 1/1 added entries present`, then **exactly 1 failed**: `forbidden class: fleet account label > nothing in the tree speaks it`, naming `README.md:<its last line>: zq-synthetic-lane-label`. Then `census: clean … command exit 1`. The class's own `catches` self-test grows by the new token and stays green.
  - **The restore**, from the copy's own commit:

```bash
. "<abs scratch>/plan3a-env.sh"
git -C "$SCRATCH/t11-residue-copy" show HEAD:README.md > "$SCRATCH/t11-residue-copy/README.md"
git -C "$SCRATCH/t11-residue-copy" diff --quiet -- README.md && echo clean
cd "$SCRATCH/t11-residue-copy/server" && CCRC_HISTORY_BASE=HEAD "$CENSUS" "$EVID/t11-s3-restore" env -u CLAUDE_CONFIG_DIR ./node_modules/.bin/vitest run test/topology-clean.test.ts
```

  Expected: `clean`, then green with the blindness run's case count, because `catches` is derived from the list.

  3. **The real edit, in this worktree.** The same script appends the real joiners' base64, and nothing prints a value:

```bash
. "<abs scratch>/plan3a-env.sh"
cd "$(git rev-parse --show-toplevel)"
node "$SCRATCH/t11-residue-insert.mjs" server/test/topology-clean.test.ts "$SCRATCH/t11-joiners.b64"
git diff -U0 -- server/test/topology-clean.test.ts | grep -c "^+  '[A-Za-z0-9+/=]*',$"   # expected: N, the joiner count
```

  Expected: `ROSTER_RESIDUE: <5 + N> entries; N/N added entries present`, then `N`. Extend the docstring above the list (`:279-287`) in place, by hand and with no value in it: "…plus its operator's old employer name, and (Plan 3a) every GPT-lane label that this class's `passes` does not pin". Then the suite, output suppressed (F4):

```bash
. "<abs scratch>/plan3a-env.sh"
cd server && "$CENSUS" "$EVID/t11-s3-real" bash -c 'env -u CLAUDE_CONFIG_DIR ./node_modules/.bin/vitest run test/topology-clean.test.ts >/dev/null 2>&1'
```

  Expected: `census: clean … command exit 0`. On any other exit, never re-run it with its output shown. Read the failing cases by title only, from a 0600 report that is deleted at once, and report them:

```bash
. "<abs scratch>/plan3a-env.sh"
cd server && umask 077
"$CENSUS" "$EVID/t11-s3-real-titles" bash -c 'env -u CLAUDE_CONFIG_DIR ./node_modules/.bin/vitest run test/topology-clean.test.ts --reporter=json --outputFile="$1" >/dev/null 2>&1' _ "$SCRATCH/t11-tc.json"
jq -r '.testResults[].assertionResults[] | select(.status == "failed") | .fullName' "$SCRATCH/t11-tc.json"
rm -f -- "$SCRATCH/t11-tc.json"
```

  `git diff -U0 -- server/test/topology-clean.test.ts | grep '^[-+]' | grep -v "^+  '"` now shows only the two file-header lines and the docstring's lines.

- [ ] **Step 4: The hand-grep for values no class expresses (R10 as amended by F1, critic #15).**
  1. **The values** are measured read-only on the fleet box at execution time (F1). They are never taken from this plan, never printed (only counts are), and never read out of a key-bearing file:
     - both lane ids and both labels, from the box's `~/.ccrc/accounts.json` (not a secret);
     - lane 2's two ports, from its launcher's two `export CCGPT_PORT=` / `export CCGPT_LITELLM_PORT=` lines only; the launcher's other lines never leave `grep`. Lane 2 is the lane whose `~/.local/bin/<id>` is a regular file; lane 1's is a symlink (the measured shape);
     - the OAuth directory and per-lane LiteLLM config names under `~/.handoff` (`chatgpt-auth*`, `litellm-config*`), names only, minus any name the base tree already carries: the unsuffixed first-lane names are public in the spec;
     - lane 2's session codenames: the names of the `~/.cc-sessions/*.wrapper` field files whose one line is lane 2's id.

     The gitignored `deploy/reference-fleet.md` is not consulted (F1); it has no GPT-lane section, and adding one is Plan 3b Task 1's.
  2. **The two scratch files**, base64 lines at mode 0600 (F4):
     - `$SCRATCH/t11-strict.b64`: the two ids, plus any label the class pins as a pass. These are scanned with `-` counted as part of a word, so a compound that only contains one is not a hit;
     - `$SCRATCH/t11-residue.b64`: every other value, minus anything already in the strict list or pinned as a pass, scanned as `grep -w` would.
  3. **The scan** reads `git diff "$BASE"`, the worktree against the base: Tasks 1–10's commits plus this task's uncommitted §20, residue entries and count table (F3).

```bash
. "<abs scratch>/plan3a-env.sh"
cd "$(git rev-parse --show-toplevel)"
umask 077
BASE="$(cat "$SCRATCH/t11-base")"
cat > "$SCRATCH/t11-measure.mjs" <<'EOF'
// t11-measure.mjs <base> <strict.b64> <residue.b64>: Step 4's values, measured read-only on
// this box (ruling F1) and written base64, one per line, to two 0600 files (F4). Prints
// counts only. Opens no key-bearing file: the launcher is read through grep's two lines.
import { readFileSync, writeFileSync, readdirSync, lstatSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
// Every failure is reported by its code alone: a JSON.parse or a grep error would
// echo a snippet of the roster, a lane id or a home path.
function main() {
  const [base, strictF, residueF] = process.argv.slice(2);
  const H = process.env.HOME;
  const rows = JSON.parse(readFileSync(join(H, '.ccrc', 'accounts.json'), 'utf8')).accounts
    .filter((a) => a.telemetry === 'codex');
  const ids = rows.map((a) => a.id), labels = rows.map((a) => a.label);
  const src = readFileSync('server/test/topology-clean.test.ts', 'utf8');
  const cls = src.slice(src.indexOf("name: 'fleet account label'"));
  const passes = new Set([...(/passes: \[([\s\S]*?)\]/.exec(cls)?.[1] ?? '').replace(/\/\/[^\n]*/g, '')
    .matchAll(/'([^']*)'/g)].map((m) => m[1]));
  if (passes.size !== 8) throw Object.assign(new Error(), { code: `the class's passes read ${passes.size}, not 8` });
  // lane 2 is the lane whose launcher is a regular file; lane 1's is a symlink (the measured shape)
  const lane2 = ids.filter((id) => { try { return lstatSync(join(H, '.local', 'bin', id)).isFile(); } catch { return false; } });
  const ports = lane2.length !== 1 ? [] : execFileSync('grep', ['-E', '^export CCGPT_(PORT|LITELLM_PORT)=',
    join(H, '.local', 'bin', lane2[0])], { encoding: 'utf8' }).split('\n').filter(Boolean)
    .map((l) => l.replace(/^[^=]*=/, '').replace(/["' ]/g, ''));
  const inBase = (v) => {
    try { execFileSync('git', ['grep', '-q', '-F', '-e', v, base, '--'], { stdio: 'ignore' }); return true; }
    catch { return false; }
  };
  // names only; the unsuffixed first-lane names are already public (the spec names them)
  const names = readdirSync(join(H, '.handoff')).filter((n) => /^(chatgpt-auth|litellm-config)/.test(n) && !inBase(n));
  const reg = join(H, '.cc-sessions');
  const sessions = lane2.length !== 1 ? [] : readdirSync(reg).filter((f) => f.endsWith('.wrapper'))
    .filter((f) => readFileSync(join(reg, f), 'utf8').trim() === lane2[0]).map((f) => f.slice(0, -'.wrapper'.length));
  // the ids, and a label the class pins as a pass, are scanned with `-` as part of a word
  const strict = [...new Set([...ids, ...labels.filter((l) => passes.has(l))])];
  const residue = [...new Set([...labels, ...ports, ...names, ...sessions])]
    .filter((v) => !strict.includes(v) && !passes.has(v));
  const b64 = (a) => a.map((v) => `${Buffer.from(v, 'utf8').toString('base64')}\n`).join('');
  writeFileSync(strictF, b64(strict), { mode: 0o600 });
  writeFileSync(residueF, b64(residue), { mode: 0o600 });
  console.log(`ids ${ids.length}; lane 2 ${lane2.length}; ports ${ports.length}; names ${names.length}; ` +
    `sessions ${sessions.length}; strict ${strict.length}; residue ${residue.length}`);
}
try { main(); } catch (e) {
  console.error(`t11-measure: stopped (${e?.code ?? e?.status ?? e?.name ?? 'error'}); no value printed, nothing written`);
  process.exit(2);
}
EOF
cat > "$SCRATCH/t11-scan.mjs" <<'EOF'
// t11-scan.mjs <base> <strict.b64> <residue.b64>: every line `git diff <base>` adds, the
// WORKTREE against the base (ruling F3: this task's uncommitted edits count), against both
// lists. Prints file:line and a verdict, never a value; exits 1 on any stop.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const [base, strictF, residueF] = process.argv.slice(2);
const dec = (f) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((b) => Buffer.from(b, 'base64').toString('utf8'));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const strict = dec(strictF).map((v) => new RegExp(`(^|[^A-Za-z0-9_-])${esc(v)}([^A-Za-z0-9_-]|$)`));
const residue = dec(residueF).map((v) => ({ v, re: new RegExp(`(^|[^A-Za-z0-9_])${esc(v)}([^A-Za-z0-9_]|$)`) }));
const citeAt = (before) => {
  const c = /(?:^|[\s(`'",[])([A-Za-z0-9_./@-]*):(?:\d+-)?$/.exec(before);
  if (c === null) return false;
  const tok = c[1];
  return tok === '' || (/[A-Za-z]/.test(tok) && tok !== 'localhost');   // a path, or a bare `(:<n>`
};
const diff = execFileSync('git', ['diff', '--unified=0', '--no-color', '--no-ext-diff', base],
  { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
let file = '', n = 0, prev = '', stops = 0, cites = 0;
for (const l of diff.split('\n')) {
  const header = l.startsWith('+++ ') && prev.startsWith('--- ');
  prev = l;
  if (header) { file = l.replace(/^\+\+\+ (b\/)?/, ''); continue; }
  const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
  if (h) { n = Number(h[1]); continue; }
  if (!l.startsWith('+')) continue;
  const t = l.slice(1), at = `${file}:${n}`;
  n += 1;
  strict.forEach((re, i) => { if (re.test(t)) { stops += 1; console.log(`${at}: strict value ${i + 1} — STOP`); } });
  residue.forEach(({ v, re }, i) => {
    if (!re.test(t)) return;
    // a port that is really a line citation (`file:<n>`, `file:<m>-<n>`, a bare `(:<n>`) is
    // reported, not failed; `host:<n>` (an address, `localhost`, a dotted quad) never is
    const cite = /^\d+$/.test(v) && [...t.matchAll(new RegExp(`(?<![0-9])${esc(v)}(?![0-9])`, 'g'))]
      .every((m) => citeAt(t.slice(0, m.index)));
    if (cite) { cites += 1; console.log(`${at}: residue value ${i + 1} — citation-shaped, reported`); }
    else { stops += 1; console.log(`${at}: residue value ${i + 1} — STOP`); }
  });
}
console.log(`scan: ${stops} stop(s), ${cites} citation-shaped hit(s)`);
process.exit(stops === 0 ? 0 : 1);
EOF
node "$SCRATCH/t11-measure.mjs" "$BASE" "$SCRATCH/t11-strict.b64" "$SCRATCH/t11-residue.b64"
node "$SCRATCH/t11-scan.mjs" "$BASE" "$SCRATCH/t11-strict.b64" "$SCRATCH/t11-residue.b64"; echo "scan rc=$?"
rm -f -- "$SCRATCH"/t11-{strict,residue,labels,joiners,synthetic}.b64 "$SCRATCH/plan3a-live-values"   # the last is Task 6 Step 9's; no later task reads it
rm -rf -- "$SCRATCH/t11-residue-copy"
```

Expected:
- `ids 2; lane 2 1; ports 2; names <n>; sessions <n>; strict <2 or 3>; residue <n>`. If `lane 2` is not `1` or `ports` is not `2`, stop: the box's shape has moved since the census, and the controller rules.
- Zero or more `<file>:<line>: residue value <i> — citation-shaped, reported` lines. Each is a port that is really a line citation (`file:<n>`, `file:<m>-<n>`, a bare `(:<n>`); it goes into the report by `file:line` and does not fail the step. A `host:<n>` address is never citation-shaped.
- `scan: 0 stop(s), <n> citation-shaped hit(s)` and `scan rc=0`.

A `t11-measure: stopped (<code>)` line means nothing was written and no value was printed; cure the cause it names and re-run the block.

Any `— STOP` line **stops the close-out**. Find the line by its `file:line`, and reword it into fixture vocabulary in the task that added it. (The measure and scan scripts were checked at drafting against a fixture HOME and synthetic values, never the box's.)

- [ ] **Step 5: Re-measure the compaction-card census.**

```bash
. "<abs scratch>/plan3a-env.sh"
cd server && "$CENSUS" "$EVID/t11-s5-card" ./node_modules/.bin/vitest run test/session-hook.test.ts -t "compaction card"
```

Expected: green, with the same count as the base's run, then `census: clean … command exit 0`. This plan makes no `ccd/ccd` edit, but a `ccd/ccrc` edit can still move a line the card corpus cites. If it is red, name the task that moved the line and repair it with the S6-R11 procedure: README first by content, then re-measure the corpus by DUMPING the sets. Commit that repair on its own.

- [ ] **Step 6: The count table.** For every suite a task touched, measure the case count at the base and at the tip. Never infer a count.
  - **Base:** `git worktree add --detach <scratch> "$(cat "$SCRATCH/t11-base")"`, then symlink `server/node_modules` and `agent/node_modules`, run each suite there under `$CENSUS`, one foreground call per suite (F6), and finish with `git worktree remove --force <scratch>`, by path and never `git worktree prune` (F5). Do not use a `git archive` tree: `install-census`' tracked-source cases throw on it.
  - **Tip:** this tree, read from vitest's JSON reporter.

  A falling count needs its reason on the same row.

**Count table**

| Suite | Base (merge-base) | Tip | Tasks | Why it moved |
|---|---|---|---|---|
| `ccrc-models.test.ts` | 148 | 164 | 1, 2 | +16. Task 1: one new describe of six cases (four, plus its fix round's dead-refresh-token and invalid-row cases); the two `CHATGPT_TOKEN_DIR` scrub cases (`:1179-1236`) stay. Task 2: the `init` describe's seeding case re-aimed and two Z3 cases added, one nested Z4 describe of seven (six, plus its fix round's two-lane join case), and one containment-wall case; its `init codex` setups on external rows become planted registries, which moves no count. The external-arm cases (`:1621-1815`) stay |
| `models-probe.test.ts` | 46 | 61 | 1 | +15: the no-default, runtime and device-flow cases (13, plus the fix round's dead-refresh-token and no-`get_account_id` cases) |
| `ccgpt-usage.test.ts` | 34 | 37 | 1, 8 | +3: the device-flow marker case, the renamed-API case and the fix round's dead-refresh-token case (Task 1); the absent-file remedy pin (`:463`) moved and re-titled, which moves no count (Task 8) |
| `ccrc-doctor.test.ts` | 499 | 617 | 1, 3, 4, 5, 6, 8 | +118: accounts +6 (Task 3); the deploy.sh anchor describe 9 and `_check_codex` part 1 30 (Task 4); part 2 12 (Task 5); the usage rows 12 in isolation and 9 on any host (Task 6); `--fix` 25 in isolation, 6 on a real run, 3 for the fixer contract and 6 for wrappers (Task 8). The citation (`:7876`) and `HEALTHY_SKIPS` (`:1288`) +1 move no count |
| `single-definition.test.ts` | 249 | 249 | none (run only) | 0, as expected: under ruling Z, `_check_models` gains no registry reader (the `.classes.json` count stays 2), and the box-global path keeps its one holder (`:1798-1816`) |
| `ccrc-account.test.ts` | 327 | 331 | 7 (Task 3 runs it unchanged) | +4: C12–C14, account removal disables the instance, and C15, which binds the re-read guard (kept by controller ruling as conformance; it mints nothing); the provider mirror (`:356-386`) unchanged |
| `models-op.test.ts` | 106 | 115 | 2, 4 | +9. Task 2: two creation cases re-aimed at a codex-kind row, and four Z3 cases (an `it.each` of three rows plus "every other probe kind"); its `init codex` setups on external rows become `plantCodex`, which moves no count. Task 4: five check-only `materialise` cases |
| `ccrc-install.test.ts` | 246 | 273 | 1, 6, 10 | +27: the usage converge 18 in isolation, 1 on a real spine and 2 for the counted timer degrade (Task 6); +6 rehearsal cases (Task 10). Task 1's D-3486 unit pin gains `TimeoutStartSec` and the usage-pair argv census is rewritten (`:3999-4154`), which moves no count |
| `ccrc-install-graphify.test.ts` | 57 | 57 | 6 | 0, as expected: a containment `disable)` arm in its `systemctl` stub only |
| `install-census.test.ts` | 17 | 18 | 6, 7 | +1: Task 6's own-name pin. Task 6's renamed pair in the release carriage, and Task 7's `:58` note, `DEPLOY_SH_WITHHOLDS` and STATED SCOPE bullet, move no count |
| `ccrc-update.test.ts` | 440 | 441 | 6, 10 | +1: the rehearsal case (Task 10); the converge under update moves no count |
| `ccrc-uninstall.test.ts` | 77 | 78 | 7 | +1: the instance sweep; the derived absence list re-titles an existing case |
| `ccrc-wrappers.test.ts` | 60 | 62 | 9 | +2: the symlink backup and its regular-file control |
| `usage-sweep-deploy-ship.test.ts` | 10 | 10 | 7 (R5) | 0: `deploy.sh`'s probe line gone, an assertion inside an existing case |
| `graph-noise-ship.test.ts` | 4 | 4 | 7 (R5), run only | 0, as expected: the sweep-to-list distance goes 3 → 2, inside its budget of 3 |
| `topology-clean.test.ts` | 55 | 55 | 11 | 0: `catches` is derived from the list |
| `macos-platform.test.ts` | 94 | 94 | 6 | 0: the forced-Darwin arms landed in `ccrc-install.test.ts` and `ccrc-doctor.test.ts`, not here |
| `agent/test/deploy-verify.test.ts` | 45 | 45 | 7 (R5) | 0: the probe absence pin, and the landed list derived from the agent chain's own `_unit_atomic` operands plus a template anchor, are assertions inside two existing cases |
| `session-hook.test.ts -t "compaction card"` | 175 | 175 | — | 0, as expected (Step 5; the tip's census-wrapped run: 175 passed) |

**How the counts were measured (Task 11).** Each count is the number of cases `vitest list --json` names for that file on this box, run census-wrapped, one call per suite. The base column was measured in a detached worktree at the merge-base `1f9fa22d`, removed by path afterwards; the tip column in this tree. `vitest list` leaves out a case its `skipIf` skips on the measuring box, so a count here is that box's runnable cases, the same instrument on both sides. No count fell.

**Task 10's mutation row of record for M2 is M2b.** M2 as written (`if :; then`) reds the Z1 assertion through an unset `$blocked`. M2b (`if blocked="$(_models_litellm_stop_blocked)" || :; then`) reds the same assertion by exactly the predicted mechanism: the second refresh's row is `ok:false` with Task 2's refusal, the status is 1, and no `stop` is recorded.

**None retired:** under ruling Z the external arm stays, so Plan 2b-2 Task 6's mutation rows 2, 5 and 20 keep their subject and stay where Plan 2b-2 left them.

**Final fix wave, MF-2: the lane-file type test (`readRegular`, `deploy/models-op.mjs`).** Measured red-first on the merged tree: before the fix, all five new `models-op.test.ts` cases and the new `ccrc-doctor.test.ts` case were red by deadline (each `models-op` child ended at its 10 s `spawnSync` bound with `signal` `SIGTERM`; the doctor run ended at `runDoctorBounded`'s 60 s process-group bound). Each mutation row backed up the file it edits and verified its restore with `git diff --quiet`, and every run was bounded.

| Row | Mutation (`deploy/models-op.mjs`) | Reds | Stays green |
|---|---|---|---|
| MF-2 (i) | drop `readRegular`'s `isFile()` throw | all five MF-2 `models-op.test.ts` cases (5 of 5, each by deadline) and the doctor FIFO case (by deadline) | nothing else was run |
| MF-2 (ii) | revert only `readCatalogue`'s call site to `readFileSync(…, 'utf8')` | "show with a FIFO catalogue answers catalogue-unreadable" alone (1 of 5) | the other four MF-2 cases |

**Final fix wave, MF-3: `assertForeignFront`'s refusals (`server/test/codexLaneFixture.ts`).** The guard existed and only its green path ran; the five cases (a control and one per refusal) run nothing but `/bin/sh -c 'command -v …'`, with `exit 97` decoys outside the HOME that are never run. No product byte changes, so this is inert under ruling Z. Each row was measured red, its restore verified with `git diff --quiet`.

| Row | Mutation (`assertForeignFront`) | Reds | Stays green |
|---|---|---|---|
| MF-3 (1) | delete the `CCGPT_CONFIG is set` throw | "refuses an env that still carries CCGPT_CONFIG, …" (1 of 5) | the control and the other three refusals |
| MF-3 (2) | make the `got !== want` comparison always false | the `ccgpt` and the `litellm` resolution cases (2 of 5) | the control, `CCGPT_CONFIG` and the recorder case |
| MF-3 (3) | delete the `FOREIGN_MARK` check | "refuses a <home>/.local/bin/ccgpt that is not this shape's recorder" (1 of 5) | the control and the other three refusals |

- [ ] **Step 7: Execution-time departures.** Any departure a task found during execution is reported by slug. The controller mints its number and substitutes it; nobody else writes a D-number, a `D-TBD`, or a range (R12).

```bash
. "<abs scratch>/plan3a-env.sh"
grep -cE '⟦D:[a-z0-9]+(-[a-z0-9]+)*⟧' docs/superpowers/plans/2026-09-30-gpt-lane-ownership-3a-before-the-flip.md docs/superpowers/specs/2026-09-20-gpt-lane-ownership-design.md   # expected: 0 in both
git fetch origin main
cd server && "$CENSUS" "$EVID/t11-s7-ledger" ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts
```

Expected: `0` for both files, then green. The pattern counts only a real slug, so the plan's own mentions of the form (`⟦D:<slug>⟧`, `⟦D:<short-slug>⟧`) never count.

- [ ] **Step 8: Commit.**

```bash
git add docs/superpowers/specs/2026-09-20-gpt-lane-ownership-design.md docs/superpowers/plans/2026-09-30-gpt-lane-ownership-3a-before-the-flip.md server/test/topology-clean.test.ts
git commit -F - <<'EOF'
docs(gpt-lane): Plan 3a Task 11 — spec §20, the GPT-lane labels in the residue class, the count table

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log -1 --format='%an <%ae>'   # checked against the repository's identity rule, as Tasks 6–9 do
```

- [ ] **Step 9: The unit and process census gate (R11, F10).** This wrapper is `$CENSUS`, the Global Constraints' `$SCRATCH/census-run.sh`. It is written there once and never restated here, and it observes and never signals anything. The gate, over the whole plan, reads every run's evidence: the script writes `new-units.txt` and `leaks.txt` on every run. It counts only **attributable** hits, by the attribution rule beside the script (F10):
  - the census's own three controls write under `$SCRATCH/census-controls`, are red by design, and are skipped;
  - a new unit or link whose name carries a fixture lane id, any `ccrc-codex-usage@*` instance, and any vanished enablement link (a `gone:` line) are attributable whatever else was recorded;
  - any other hit counts unless its evidence dir carries the `attributed-foreign` marker, which the Global Constraints' rule has the implementer `touch` when every hit of that run was foreign, before its isolated re-run.

```bash
. "<abs scratch>/plan3a-env.sh"
jq -r '.accounts[].id' "$HOME/.ccrc/accounts.json" | grep -cxE 'codex-a|codex-b|ext-a|ext-b|gen-a'   # expected: 0
find "$SCRATCH" "${TMPDIR:-/tmp}"/plan3a* -maxdepth 4 -path "$SCRATCH/census-controls" -prune -o \
  \( -name new-units.txt -o -name leaks.txt \) -size +0c -print 2>/dev/null > "$SCRATCH/t11-gate-hits"
fx='(^|[-@:])codex-[ab]([-.]|$)|ccrc-codex-usage@'   # the Global Constraints' fixture-name pattern
# attributable whatever the marker says: a fixture-named unit or link, or a vanished link
grep '/new-units\.txt$' "$SCRATCH/t11-gate-hits" | while IFS= read -r f; do
  { grep -v '^gone:' "$f" | grep -qE "$fx" || grep -q '^gone:' "$f"; } && echo "$f"; done | wc -l   # expected: 0
# every other hit, unless its run was attributed foreign before its isolated re-run
while IFS= read -r f; do [ -e "$(dirname "$f")/attributed-foreign" ] || echo "$f"; done < "$SCRATCH/t11-gate-hits" | wc -l   # expected: 0
```

Expected: `0`, `0` and `0`. An attributable 125 or 126 anywhere in the plan's evidence **fails the gate**. It is reported by its evidence dir and its counts, naming a unit only when it is fixture-named (F4), and nothing is cleaned by hand from this session. A leaked `ccgpt-<fixture>-*` unit sits beside other programs' live units, and its removal is the operator's call. A deliberate red inside a census-wrapped command is that command's own exit code, never a census hit (F10).

- [ ] **Step 10: The wave-close gate.** Run it from this worktree with `CLAUDE_CONFIG_DIR` unset, as CI runs it. Every suite command goes through `$CENSUS`, in the foreground, one suite or shard per Bash call, each inside the 600 s tool cap (F6). Every block sources `plan3a-env.sh` first (F2).
  - **Merge `main` in first if it moved.** Run `git fetch origin main`. If `git merge-base --is-ancestor origin/main HEAD` fails, merge `origin/main`, re-record the base with `git merge-base origin/main HEAD > "$SCRATCH/t11-base"`, and re-run Tasks 10 and 11's suites. A D-reference defined only on `main` reds the floor scan until the merge.
  - **Server suite: 12 shards, then the doctor file alone.** One foreground call per shard, for k = 1 to 12 in turn, never a loop inside one call:

```bash
. "<abs scratch>/plan3a-env.sh"
k=1   # 1, 2, … 12: one call each (F6)
cd server && "$CENSUS" "$EVID/gate-shard-$k" env -u CLAUDE_CONFIG_DIR timeout 590 ./node_modules/.bin/vitest run --shard=$k/12 --exclude '**/ccrc-doctor.test.ts'
```

  `ccrc-doctor.test.ts` alone took 424 s and 525 s at the base (two measurements, foreground and census-wrapped), and Tasks 1–8 add about a hundred cases to it, so it runs as the Global Constraints' three parts, one call each:

```bash
. "<abs scratch>/plan3a-env.sh"
k=1; P='^ccrc doctor: [a-c]'   # then k=2 '^ccrc doctor: [d-m]', then k=3 '^(?!ccrc doctor: [a-m])': one call each (F6)
cd server && "$CENSUS" "$EVID/gate-doctor-$k" env -u CLAUDE_CONFIG_DIR timeout 590 ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t "$P"
```

  The three parts' case counts sum to the file's total. A part that exits 124 (`timeout`'s answer) is split again at another letter, keeping the parts complementary. A failing shard is re-run alone before anything is called a break. The known load flakes are listed in `CLAUDE.md`, and CI on the quiet box is the arbiter for a file it ran.
  - **Agent and PWA suites**, one call each:

```bash
. "<abs scratch>/plan3a-env.sh"
cd agent && "$CENSUS" "$EVID/gate-agent" env -u CLAUDE_CONFIG_DIR ./node_modules/.bin/vitest run
```

```bash
. "<abs scratch>/plan3a-env.sh"
cd pwa && "$CENSUS" "$EVID/gate-pwa" env -u CLAUDE_CONFIG_DIR ./node_modules/.bin/vitest run
```

  - **Typecheck**, one call each: `cd server && ./node_modules/.bin/tsc --noEmit`; `cd agent && ./node_modules/.bin/tsc --noEmit`; and

```bash
. "<abs scratch>/plan3a-env.sh"
cd server && "$CENSUS" "$EVID/gate-typecheck-tests" env -u CLAUDE_CONFIG_DIR ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
```

  - **Ledger and residue guards.** `topology-clean` now carries the real labels' base64, so its run has its output suppressed and is read by exit code (F4), as Step 3's real run is:

```bash
. "<abs scratch>/plan3a-env.sh"
git fetch origin main
cd server && "$CENSUS" "$EVID/gate-ledger" env -u CLAUDE_CONFIG_DIR ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts
```

```bash
. "<abs scratch>/plan3a-env.sh"
cd server && "$CENSUS" "$EVID/gate-topology" bash -c 'env -u CLAUDE_CONFIG_DIR ./node_modules/.bin/vitest run test/topology-clean.test.ts >/dev/null 2>&1'
```

  Expected: green, then `census: clean … command exit 0` for each. A non-zero `topology-clean` exit is read by case title only, by Step 3's fallback.
  - **The cut and the live-box rule.** This runs after Step 8's commit, so `"$BASE" HEAD` holds every task (F3):

```bash
. "<abs scratch>/plan3a-env.sh"
cd "$(git rev-parse --show-toplevel)"
BASE="$(cat "$SCRATCH/t11-base")"
git diff --quiet "$BASE" HEAD -- ccd/ccd ccd/ccgpt-runtime ccd/ccgpt-proxy.py && echo CUT-OK
git diff "$BASE" HEAD -- ccd deploy shared | grep '^+' | grep -nE '\.local/bin/ccgpt|ccgpt-usage[@.]'
```

  Expected: `CUT-OK`, and Step 0's ruling-Z lines, re-run here after any merge of `main`, answer as they did there. The hits may be only refusals and comments naming the other repository's files, and Task 6's two flat-timer remedies (Step 0). Read every hit.
  - **R9 and R10 at the tip.** Re-run Steps 2 and 4 after any merge of `main`, against the re-recorded base.
  - **Identity:** `git log --format='%an <%ae> | %cn <%ce>' origin/main..HEAD | sort -u` shows the noreply identity only.
  - **The unit and process census gate** (Step 9) is green over every evidence directory above.
  - **Push and open the PR.** The body:
    - links the plan and the spec by **GitHub blob URL**, with the PR's Files view as the interim link, never a docserver URL;
    - states that **merging is a rollout**: `main` auto-releases, both boxes follow dev, and Task 10's rehearsal is the evidence that the rollout is inert on the live shape;
    - states, per **operator ruling Z (2026-10-01)**, that the merge changes nothing an external lane does: every doctor check keeps its class, `models` included, `codex` answers one SKIP, and the external lane's hourly refresh probes, renders and stops exactly as before. So the merge carries no operator confirmation of a live change, because it makes none;
    - notes R-C10's framing as Plan 3b's, not this merge's;
    - states that no roster is edited and no file or unit of another repository is touched;
    - asks for a **squash-merge**, which this repository merges with `--admin`;
    - ends with the Claude Code footer.

## Deviations found

Each number below was issued by the allocator (`POST /api/ledger/deviations`, through `ccrc-api ledger allocate`) on 2026-10-01, in two issues: one block for the skeleton's departures, and `D-3753` alone for operator ruling Z4. Each is defined here in the same act. A departure found during execution is reported by slug, and the controller mints its number. Nobody else writes a D-number, a `D-TBD` or a range. A **contingency** is written as a plain slug and minted only when it fires at execution.

Each entry says what departs, from which text, the measurement that forced it, and what it costs if wrong.

- **D-3705: merging Plan 3a rolls it out to both boxes, so the plan is built to be a no-op there.**
  - **Departs from:** spec §15 step 1 ("nothing is deployed"), step 2 ("`ccrc rollout` as usual"), and §16 (rollout out of scope).
  - **Measured:** every merge to `main` becomes a dev prerelease that both boxes follow automatically. At drafting, the live fleet box ran `origin/main`'s own release with its install complete.
  - **What it forces:**
    - Task 10's rehearsal, which measures the base on the same fixture and asserts that the tip's answer equals it;
    - the renamed usage pair;
    - by operator ruling Z (2026-10-01), a merge that changes nothing an external lane does: the external path keeps its bytes until each lane's flip (D-3706, D-3753), so the merge carries no operator confirmation of a live change.
  - **Cost if wrong:** a non-inert byte reaches the live box within minutes. The way back is `ccrc rollback` to the previous kept version.
- **D-3706: the probe's default stays for an `external` lane until its flip, and an `external` lane cannot gain a codex registry** (redefined by operator ruling Z, 2026-10-01, Z1 and Z3; this number first named the opposite, the default withdrawn for every lane).
  - **Departs from:** spec §9.1, "loses its default outright … a lane that cannot supply one is **refused**". A codex-kind lane conforms: its probe takes its own `authDir` and has no default. An `external` lane does not, by ruling: it keeps today's path, which spec §19.6 and Plan 2b-2's scope already promised ("external lanes keep today's behaviour byte for byte until Plan 3's cutover").
  - **Measured:**
    - The probe's only caller scrubs `CHATGPT_TOKEN_DIR` and re-supplies it only from `exec.secretsFile` (`ccd/ccrc:9471-9484`), and the live external rows carry neither a secrets file nor an `authDir`. So for them the default is the only token directory there is.
    - The default is lane 1's own OAuth directory, and lane 1 is the one live row with a codex registry, refreshed hourly today. So today the default probes the right lane.
    - The hazard is a registry made on the other lane before its flip. On the base, `init codex` there succeeds (measured on a disposable copy, Task 10), and the next hourly refresh would probe that lane with lane 1's OAuth.
  - **What the tree does:**
    - the external path keeps its bytes, default included, so the hourly refresh, `_check_models` and the external arm do exactly what they did (Task 10 pins it against the measured base);
    - `deploy/models-op.mjs`' `init` op, the one creator of a class registry, behind `ccrc models <id> init codex` and every other caller, refuses by name (`codex-registry-needs-codex-lane`) to create a codex registry on a row that is not `exec.kind: "codex"`, with the remedy "flip the lane to `codex` first (Plan 3b)" (Task 2). That covers the live `external` rows, the shape Z3 names, and a non-Anthropic `generated` row, which declares no `authDir` either and whose probe would take the same default. A registry that already exists is untouched.
  - **Cost if wrong:** a registry on an external lane that the guard never saw is probed through lane 1's directory until that lane's flip: a hand-written file, say, or the one a lane other than lane 1 keeps when it is flipped back (Task 7, hazard 4; Plan 3b's rollback removes it). The final plan's ccrc half deletes the default and the guard together, once no external lane has a codex registry.
- **D-3707: nothing in the hourly path may start a device-code login.**
  - **Departs from:** LiteLLM's `Authenticator` default, which starts a device flow when no token can be refreshed, and from the skeleton's plan to bound it by a timeout. Spec §9.3 says only that login is a ccrc verb.
  - **Measured (critic #2), from the installed library's source:**
    - the device path writes `device_code_requested_at` into the lane's `auth.json` before it polls for up to 15 minutes;
    - it prints the code to stdout;
    - after that, every other `Authenticator` user waits up to 5 minutes;
    - the usage oneshot sets no `TimeoutStartSec`.
  - **What the tree does:** the probe's codex path and `ccd/ccgpt-usage.py` override the device path in-process to raise `login-required` before any write, and the usage service gains `TimeoutStartSec`. A test pins it with a stub whose device path would write a marker file, and asserts the marker never appears. The probe's external path, `_fetch_codex`, keeps every byte, failure path included: ruling Z2's one-program allowance is not taken (Task 1), so an external lane's hourly probe can still start a device flow on a dead token, exactly as it can today, until its flip (Task 1, hazard 3).
  - **Cost if wrong:** a codex lane whose refresh token has died answers `login-required` every hour rather than prompting. The cure is `ccrc codex login <id>` with the operator present. The guard also couples ccrc to two private LiteLLM names inside D-3487's range. A LiteLLM that renames either makes every probe and poll refuse `runtime-api-moved`, loudly.
- **D-3708: withdrawn by operator ruling Z (2026-10-01).** Kept as a recorded decision.
  - **What it was:** ccrc would stop rendering and stopping another repository's LiteLLM at Plan 3a's merge, retiring `_models_litellm`'s external arm before any flip (the superseded R-C3).
  - **What ruling Z decided instead:** the external arm is NOT retired before the flip. It keeps its bytes on today's shape, and spec §19.6 stands as written ("until Plan 3's cutover retires that arm"). Each lane leaves the arm at its own flip, and the final plan's ccrc half deletes it once no external lane has a codex registry. The one change ruling Z makes to the arm is D-3753.
  - **Measured at drafting:** the arm is live. On the day of drafting the hourly timer rendered the other repository's box-global config, a bare `ccgpt stop` sits on its changed-and-running path (`ccd/ccrc:10030-10031` at `1f9fa22d`), and exactly one lane reaches it, then a lane with no sessions and nothing listening.
  - **Re-measured 2026-09-30, after drafting:** that lane's tiers run, so the bare stop on that path is armed on the live box today. The withdrawal stands: Z1 keeps that decision byte for byte, so the merge stays neutral.
  - **Cost:** none: the tree keeps what it had. Spec §20.2 names this number only to record the withdrawal.
- **D-3709: for a codex lane, an absent `ANTHROPIC_BASE_URL` in settings is healthy.**
  - **Departs from:** Plan 2b-2's carry-forward item 8, "teach it `http://127.0.0.1:<proxyPort>`", which read as present-and-equal.
  - **Measured:**
    - No ccrc writer puts that key in a codex home's settings (`shared/modelenv.mjs:55-64`).
    - The launcher exports it instead (`ccd/ccrc-codex:177`).
    - Whether a value in settings overrides the exported one is unmeasured.
  - **Cost if wrong:** a hand-added key with the matching value goes unreported. A mismatching one is still reported.
- **D-3710: `_check_codex` FAILs on a roster it cannot read.**
  - **Departs from:** spec §12, which defines only the empty-set SKIP, and from the sibling `_check_models`, which SKIPs an unreadable roster and leaves it to `wrappers`.
  - **Why:** `_codex_lanes` answers rc 1 for an unreadable roster and rc 2 for a missing jq. Folding either into SKIP is the overloaded empty this codebase bans, and it would read as "no codex lane" on a box that has some.
  - **Cost if wrong:** one extra FAIL beside `wrappers`' on a box whose roster is broken.
- **D-3711: doctor asks `ccgpt-runtime check` and never re-runs the behaviour probe.**
  - **Departs from:** §12's row "failing its behaviour probe".
  - **Measured:**
    - `check` compares the stamp and never re-runs the probe (`ccd/ccgpt-runtime:566-574`).
    - The probe can take up to `CCRC_RUNTIME_PROBE_S=300` seconds.
    - Doctor ends every install and update.
  - **Cost if wrong:** a runtime whose behaviour changed under an unchanged stamp passes doctor. The stamp's version re-measure still catches a changed litellm, and `--fix` re-probes.
- **D-3712: `materialise` gains a check-only form, `--check true`. Without it, it writes as before.**
  - **Departs from:** ruling R7's parenthetical (a bare `materialise`, no `--commit`, as the check), and `deploy/models-op.mjs`'s own contract, under which it always writes.
  - **Measured (critic #11):** §12 wants `lane.json` "stale against the catalogue" to FAIL, and no instrument measured it. `_codex_lane_json_state` compares only against the roster.
  - **What the tree does:** `materialise --check true` renders what a write would, through the one file list the writer uses (`materialFiles`). It compares that with the bytes on disk and answers `changed` per file, writing nothing. Any other `--check` value is refused at exit 2. The default stays the write, because two shipped callers (`_codex_lane_json_ensure`, the refresh loop) and 13 `models-op.test.ts` calls expect it.
  - **Cost if wrong:** a checking caller that omits the flag writes. `_check_codex` and `_fix_codex` are the two callers that must pass it, and Task 4's mutation row M10 reds a doctor that writes.
- **D-3713: lane state left for an id that is no longer a codex lane is a WARN, and a subject of the check.**
  - **Departs from:** §12's table, which has no such row (2b-1 item 16).
  - **Why:** a flip back keeps that state on purpose (§13), and the empty-population SKIP would hide it.
  - **Cost if wrong:** one WARN until the operator removes the directory by hand. ccrc never deletes it.
- **D-3714: a live unit of a tier's name whose MainPID proves nothing is a WARN, in `_codex_foreign_what`'s retry wording.**
  - **Departs from:** §12's foreign-listener FAIL.
  - **Why:** this lane's own crash-looping tier reads exactly so inside its `RestartSec`, and a FAIL there would fail every `ccrc update` that lands in that window.
  - **Cost if wrong:** a foreign unit in that state is a WARN, not a FAIL, until its MainPID proves something.
- **D-3715: a tier `_codex_tier_ours` cannot ask about is a WARN, unmeasured.**
  - **Departs from:** §12, which is silent on it.
  - **Why:** it is never read as running or as stopped. A tier whose staleness cannot be told is likewise its own WARN, never current and never stale.
  - **Cost if wrong:** one WARN, whose remedy is `ccrc codex status <id>`.
- **D-3716: a LiteLLM tier down while a live session runs on the lane is a WARN.**
  - **Departs from:** §12's table.
  - **Why:** this is Plan 2b-2's hazard. A tier that died after a start that wrote stays down until the next start, and every turn those sessions send fails at the gateway.
  - **Cost if wrong:** one WARN, whose remedy is the idempotent `ccrc codex start <id>`.
- **D-3717: ccrc's usage pair is `ccrc-codex-usage@.{service,timer}`.**
  - **Departs from:** spec §4.3, §10 and §12, which name `ccgpt-usage@<id>.timer`.
  - **Measured:**
    - The other repository's `ccgpt-usage@.{service,timer}` template is installed on the live box, with one instance enabled.
    - ccrc's pair has the same names and a different body.
    - Because the merge auto-rolls, placing ccrc's pair under those names would overwrite a live template the moment Plan 3a merges, and the enabled instance would then run ccrc's publisher against a `lane.json` that does not exist.
    - `install-census.test.ts:1591` already refuses the prefix.
  - **Cost if wrong:** the docs carry two names for one role until Plan 4 retires the other repository's copy.
- **D-3718: install enables an instance per codex lane and disables the rest.**
  - **Departs from:** §11, which says `_inst_enable` enables, not converges.
  - **Why:** a flip back must not leave ccrc's publisher running for a lane the other repository serves again, which would put two writers on one limits row.
  - **Cost if wrong:** an instance hand-enabled for a non-codex id is disabled by the next install. The remedy is to make that lane codex.
- **D-3719: ccrc withholds its enable while the other repository's instance for the same id is enabled.**
  - **Departs from:** nothing. It is new (ruling R6, critic #6), because otherwise only the runbook's step order would stop two publishers.
  - **Limit:** the flat, id-less foreign timer cannot be attributed to a lane, so no code refuses on it. The runbook disables it.
  - **Cost if wrong:** a lane whose foreign instance is still enabled has no ccrc publisher until the operator disables that instance. The doctor WARN says so.
- **D-3720: no usage timer on macOS, and no permanent WARN there either.**
  - **Departs from:** §10, which names no platform, and §12's WARN row read on Darwin (2b-1 item 17c).
  - **Measured:** `_inst_units_darwin` installs no timer at all (`ccd/ccrc:14048-14072`, decision 17).
  - **Cost if wrong:** a macOS codex lane publishes no usage row.
- **D-3721: the missing-timer WARN names `ccrc install`, not `--fix`, and `--fix` restarts no tier on a stale finding alone: beyond the codex arm's own restart of a lane's proven running LiteLLM tier under a changed render, it asks for a tier restart only after it places `ccgpt-proxy.py` or `ccgpt-runtime` again where `cmp` did not find the shipped bytes, or rebuilds the runtime, and that restart, `_inst_codex_tiers`, the same step `ccrc update` runs, also restarts any other stale ccrc-owned tier on any lane (the ruled residue).**
  - **Departs from:** §12's `--fix` list: "enable a missing usage timer", and "restart a verified ccrc-owned active tier", read for a tier whose only finding is stale code. Both rows are WARNs. On a FAIL, `--fix` asks for a tier restart only after it replaced the bytes (measured by `cmp`) of the shim (`ccgpt-proxy.py`) or the runtime CLI (`ccgpt-runtime`), or rebuilt the runtime (Task 8). A `cmp` that ran but could not read the installed file (exit 2) counts as a byte difference, so that placement asks too; a mode-only fix, `ccgpt-usage.py`, `ccrc-codex`, and a placement with no `cmp` on PATH (the one unmeasured compare) never ask. Separately, `_fix_codex`'s step 3 re-renders `litellm.yaml` through the codex arm on every `--fix`, and the arm stops and restarts the lane's own proven running LiteLLM tier when that render changed: its stop-before-write, never a restart for staleness. It then runs `_inst_codex_tiers`, the install step `ccrc update` runs, which restarts every running ccrc-owned tier that measures stale, on any lane, not only the tiers whose code this fix replaced (ruled residue, Task 8 fix round 1). A stale tier's own remedy names `ccrc update` or the lane's `ccrc codex stop` and `start` (Task 5).
  - **Measured:** `cmd_doctor` runs a fixer only when a check returns 1 (`ccd/ccrc:3312`). R-C8 keeps that one contract for every fixer.
  - **Cost if wrong:** one extra command for the operator.
- **D-3722: one of the two live GPT-lane labels cannot join the residue class.**
  - **Departs from:** ruling R10 and critic #16, which say to add both labels.
  - **Measured at drafting, by shape:**
    - One label is byte-equal to a token the class's own `passes` already pins.
    - The class is a case-insensitive substring pattern over every tracked blob.
    - That token would therefore red the class's own pass pin and every tracked occurrence of the identifier.
  - **What the tree does:** only a label that no pass pins joins the class (Task 11 Step 3). The pinned one is covered by Step 4's hand-grep, which measures it from the box roster at execution time (ruling F1) and scans for it as a whole word.
  - **Cost if wrong:** that label can reappear in a tracked line with no ratchet catching it. It is already public by that pin.

- **D-3723: an absent roster file SKIPs `codex`.**
  - **Departs from:** ruling R-C6's FAIL, read as covering every roster the check cannot read.
  - **Why:** absent is a positive answer, and the `wrappers` check already FAILs a missing roster, so a second FAIL would count one finding twice. R-C6's FAIL stays for a roster that exists and cannot be read, and for a missing jq.
  - **Cost if wrong:** a box with no roster shows one FAIL instead of two.
- **D-3724: an `authDir` holding no `auth.json` is a FAIL.**
  - **Departs from:** §12, which names only an `authDir` that is absent or unreadable.
  - **Why:** `ccrc codex start` refuses exactly there, and the FAIL uses its words. The check tests existence only and opens nothing.
  - **Cost if wrong:** none beyond a FAIL whose remedy is `ccrc codex login <id>`.
- **D-3725: `ccd/ccrc-doctor-checks` cites `deploy.sh` by quoted code anchor, never by line.**
  - **Departs from:** Plan 2b-2's carry-forward item 11, which re-aims six citations at new line numbers.
  - **Measured:** seven stale citations, not six. Task 7 edits `deploy.sh`, so any line number re-aimed in Task 4 would go stale inside this plan.
  - **Cost if wrong:** a `deploy.sh` edit that drops an anchor reds Task 4's anchor pin, which names the citation to re-aim.
- **D-3726: "enabled" is read from the `timers.target.wants/<unit>` link the manager itself makes.**
  - **Departs from:** the spec, which does not say how enablement is measured.
  - **Why:** no `systemctl` verb lists a template's enabled instances, and uninstall must find ccrc's instances on a box whose user bus is down. The converge, uninstall, account removal and doctor share one reading, so they cannot disagree.
  - **Cost if wrong:** a timer started but never enabled, or enabled under another target, is invisible to all four.
- **D-3727: removing an account disables ccrc's own usage instance for it, whatever the row's kind.**
  - **Departs from:** spec §9's per-kind removal, and the skeleton's "removing a codex account disables its instance".
  - **Why:** a lane flipped back to `external` can still carry the instance its codex days enabled, and that instance would go on rewriting the limits row the removal deletes.
  - **Cost if wrong:** none on a live external lane. It has no ccrc link, so the manager is asked nothing.
- **D-3728: the uninstall suite's absence list is what its fixture planted.**
  - **Departs from:** the skeleton, which derives it from `_uninst_units` (2b-1 item 19).
  - **Why:** a list derived from the removal side drops a unit from both sides at once. A derived check requires the fixture to plant every `_inst_units` destination.
  - **Cost if wrong:** a new `_inst_units` destination reds until the fixture plants it, by design.
- **D-3729: `deploy-verify`'s landed list is `AGENT_BUILD_CMD`'s own `_unit_atomic` operands, plus a template anchor.**
  - **Departs from:** the skeleton, which derives it from `_inst_units` (2b-1 item 20).
  - **Why:** `install-census.test.ts` already holds every `_inst_units` unit to one of `deploy.sh`'s lanes. The agent lane also places units `_inst_units` does not, and withholds some it does.
  - **Cost if wrong:** a `_unit_atomic` call the reader cannot place throws, by design.
- **D-3730: regenerating a marker-verified launcher is `_fix_wrappers`' cure, not `_fix_codex`'s.**
  - **Departs from:** spec §12, which places it under `_check_codex`'s `--fix`.
  - **Why:** a launcher is `_check_wrappers`' measurement, and a second verdict line would count one finding twice. `_fix_wrappers` runs the shipped `ccrc wrappers` with no flag. That overwrites only a launcher whose ccrc marker still verifies (keeping a backup), writes an absent one, and refuses every other file.
  - **Cost if wrong:** it reaches generated launchers as well as Codex ones, the same act `ccrc install` performs.
- **D-3753: the external arm refuses its bare `ccgpt stop` while the roster carries any codex row** (operator ruling Z4, 2026-10-01; issued by the allocator the same day).
  - **Departs from:** spec §19.6 and §8, under which an `external` lane keeps "the bare `ccgpt stop`, byte for byte, until Plan 3's cutover".
  - **Measured:** the bare `ccgpt stop` is the other repository's lane-1 default, and it stops `ccgpt-<lane>-{shim,litellm}.service` by name (critic #7). Those are exactly the names ccrc's own tiers use (spec §19.2). So after lane 1's flip, a bare stop from the external arm, reached through any still-external lane with a codex registry, would stop ccrc's own lane-1 tiers. Until now only the runbook's order stood between the two.
  - **What the tree does:** inside the external arm's owed-stop branch, while the roster carries any `exec.kind: "codex"` row, or while the lane library cannot say which rows are (`_codex_lanes` rc 1 or rc 2), the arm refuses through its existing `restart-failed` path, before any write, with a sentence that names the codex lane as the reason and never sends the operator to `ccgpt stop`. On today's shape, with no codex row, nothing changes, and a render with nothing to stop still lands. Task 10's live and Z4 cases pin both.
  - **Cost if wrong:** after a flip, an external lane with a registry whose render changed while a proxy runs on the box-global config keeps the old rendering, refused every hour, until that lane's own flip or until the proxy stops. Each refusal is a failed row, so `ccrc models refresh --all` exits 1 and `ccrc-models.service` fails hourly in that window (Task 2, hazard 1). It never takes down a ccrc tier.

**Contingencies, minted only when they fire:**
- D-3161's closure, on the probe's codex path (its external path keeps its read until the final plan deletes that path, ruling Z8), is not a contingency: Task 1 measured `Authenticator().get_account_id()` present at drafting, and closing a breach D-3161 recorded is conformance to spec §9, so it mints nothing. If Task 1's Step 0b, a read-only grep of the installed source, finds the method gone, Task 1 stops and reports before its Step 1; the controller rules then, and no slug is pre-named for it (F9).

**Considered and not minted:**

These are bookkeeping or conformance to the spec as written, with no departure:
- §4.2's two further convergence paths (§20.6);
- `deploy.sh` no longer placing the probe's PATH copy (ruling R-C11; §11 already says the fallback deploy mirrors install);
- uninstall sweeping ccrc's usage instances (§13 as written);
- every timer-enable degrade joining `INST_DEGRADED` (Plan 2b-2's carry-forward item 10);
- the symlink-preserving `--force` backup (a defect fix; no spec sentence says otherwise);
- the stale citations Tasks 1 and 4 re-aim.

## Carry-forward to Plan 3b and Plan 4

Per R1, these are two separate plans, written later. Nothing here is done in Plan 3a. Everything is stated in fixture or shape terms:
- "lane 1" is the lane that was empty at drafting (the rehearsal's `codex-a`) and "lane 2" is the busy one (`codex-b`);
- real values are never written here. Plan 3a Task 11 Step 4 measures the few it needs read-only on the box at execution time and never consults the gitignored reference file (ruling F1); that file gains its GPT-lane section in Plan 3b Task 1.

**The measured live shape at drafting (shape only)**
- **Roster:** two `external` rows, provider `openai`, telemetry `codex`, with no ports, no `authDir` and no secrets file. Lane 1 carries a codex class registry and a catalogue; lane 2 carries an effort file only.
- **Launchers:** lane 1's is a symlink to the other repository's launcher, and lane 2's is a small file that execs it by path. Neither carries a ccrc marker.
- **Lane 1:** no sessions, its tier units are not loaded, and nothing listens on its ports. Its credential file was last written days before the census, so its refresh token may be dead.
  - **Re-measured 2026-09-30, after drafting:** lane 1's two tiers are running, under the same `ccgpt-<id>-{litellm,shim}.service` shape as lane 2's, so the external arm's bare `ccgpt stop` is armed on the live box today. Its sessions were not re-counted. Plan 3b step 1's census re-measures both, and its stop condition catches any other difference.
- **Lane 2:** two supervised sessions, one of them an active coordinator, running on the other repository's transient tiers. Those units' metadata carries the gateway key.
- **Usage:** the other repository's flat timer (lane 1) and one instance of its template (lane 2) are both enabled. No ccrc usage unit exists anywhere.
- **Runtime:** there is no ccrc runtime and no `~/.ccrc/codex/`. The first build is about 650 MB, and the box has already hit ENOSPC once.
- **The other repository's launcher on the box** matches no commit in that repository. A ccrc-owned PATH copy of the model probe on the box is stale.
- **OAuth directories:** both are 0700, each with an `auth.json` at 0600 (measured by stat only).

**Plan 3b: the per-lane live cutover (a runbook; no PR)**

Each lane leaves the external path automatically at its own flip (ruling Z8). From the roster edit on, `_models_run_probe` gives that lane its own `authDir` and runtime, and `_models_litellm` takes the lane's own arm. Nothing in ccrc is switched by hand, and a lane still external keeps today's probe, refresh and render.

Plan 3a's two ruling-Z guards bind 3b's order:
- **The lane with a registry flips first (Z4; Plan 3a Task 2, hazard 1).** After any flip, the external arm refuses its bare stop for a still-external lane that has a registry. If that lane's render changes while a proxy runs on the box-global config, every hourly refresh fails (`restart-failed`, `ccrc models refresh --all` exit 1, `ccrc-models.service` failed) until the lane flips. R-O1's order, lane 1 first, leaves no external lane with a registry after the first flip, so the case cannot arise. Still, before the first flip, measure read-only which process `pgrep -f` matches on the box-global config. If the order ever changes, the runbook names that failure and its remedy, the lane's own flip.
  - **Since 2026-09-30 this is live, not hypothetical.** Lane 1's tiers run, so from Plan 3b's first codex flip on, while lane 1 is still external and its proxy is up, Z4 refuses lane 1's hourly restarts: each changed render is a `restart-failed` row and a failed `ccrc-models.service`. So the flips must be ordered, lane 1 first, or that proxy stopped by the operator before any other lane flips.
- **A flip back keeps the lane's registry (Z3 refuses only a new one; Plan 3a Task 7, hazard 4).** From then on that lane's hourly probe takes the external path's default, lane 1's directory. That is right for lane 1 and the wrong lane for lane 2, so lane 2's rollback removes the registry its `init codex` created (step 5).

1. **Preconditions and a fresh read-only census.**
   - A release containing Plan 3a runs on both boxes, `ccrc update --check` reports converged, and `ccrc doctor` gives every check the class it had before the merge, with `codex` a SKIP (ruling Z7).
   - Port holders, unit and timer lists, both `authDir` modes, launcher shapes and sessions per lane all match the census.
   - `node` resolves on a session pane's PATH.
   - At least 2 GB of disk is free.
   - The next `ccrc-models.timer` fire falls outside the window.
   - Re-measure the lane-1 tiers, because two earlier reads disagree about them.
   - **Obligation (critic #15):** Plan 3b Task 1 adds the GPT-lane section to the gitignored reference file, from values measured read-only on the box the way Plan 3a Task 11 Step 4 measures them. Plan 3a never consulted that file (ruling F1). Re-check the section before step 2.
   - **Stop condition:** any mismatch with the census, and nothing is done.
2. **Build the isolated runtime before any roster names a codex lane.** Run `ccgpt-runtime build`, then `check`, and record the raw-shape canary.
   - **Stop condition:** any failing stage.
   - A probe failure inside the pinned LiteLLM range is the revisit trigger of Plan 2b-2's range ruling (item 2b2-12), and it goes to a ruling.
   - **Obligation (critic #13):** this build is its own named authorisation, before lane 1's.
3. **Lane 1: cut over and verify.**
   - **Order:**
     1. checkpoint;
     2. `ccrc account disable --id <lane>`;
     3. the other repository's stop, if anything is running;
     4. the operator disables its flat timer (2b1-12's order: the foreign timer goes before ccrc's instance is enabled, and Plan 3a's converge now refuses the reverse for a template instance);
     5. move the launcher aside to `<id>.pre-ccrc-<UTC>`;
     6. validate the candidate roster with the shipped parser in a scratch HOME, then rename it into place;
     7. `ccrc wrappers`, `ccrc models refresh <id>`, `ccrc models litellm <id>`, and the targeted enable;
     8. `ccrc codex start`;
     9. verify.
   - **Verification:**
     - unit names and slice;
     - each port's MainPID holding its port;
     - `/ccgpt/lane` answering JSON;
     - a count-only proof that the gateway key is absent from unit metadata;
     - a headless streamed turn and a tool call;
     - one publisher run that leaves a fresh single-writer row;
     - `ccrc doctor`.
   - Then `ccrc account enable`.
   - **Obligations:**
     - **critic #3:** before step 7, back up the lane's `settings.json` with its mode preserved, and `~/.ccrc/models/<lane>.{json,classes.json,classes.tsv,effort.json}`, and restore them on rollback;
     - **critic #5:** the account disable and enable, handling the `last-enabled-home` refusal;
     - **critic #7:** the other repository's stop stops `ccgpt-<lane>-{shim,litellm}.service` by name, which are exactly ccrc's tier names. So it is never run for a migrated lane, and the rollback order is `ccrc codex stop` first, then the launcher back. This replaces the old, refuted "Restart=always is unmeasured" risk. Plan 3a's external arm refuses its own bare stop while any codex row exists (D-3753), so ccrc's hourly refresh can never be the one that runs it;
     - **critic #4:** auto-update is paused for this lane's window only (R-O6) and resumed after verification.
   - **Rollback, per step reached:** `ccrc codex stop`; disable ccrc's instance; restore the roster backup and the settings/models backups; remove ccrc's marker-verified wrapper; `mv` the launcher back; the operator re-enables the flat timer. Lane state is kept. Plan 3a Task 10's flip back rehearses this exact order. The restored launcher reads the other repository's box-global config. Nothing rendered it while lane 1 was codex, so it holds the rendering from before the flip; once the roster backup makes lane 1 external again, the next hourly refresh renders it as before (ruling Z1).
   - **The login:** a `login-required` at the refresh stops the plan for `ccrc codex login <lane>` with the operator present (Plan 3a's bounded refusal).
   - **Obligation (Plan 3a Task 1, hazard 3):** the lane's own LiteLLM tier runs LiteLLM's `Authenticator` inside the tier process, where 3a's guard cannot reach, and it can still start a device flow on a dead refresh token. Prove a refresh with `ccrc models refresh <lane>` before the lane takes a session, so a dead token stops the window instead. Until the flip, the same holds for lane 1's hourly probe: it runs the external path, `_fetch_codex`, which carries no device-flow guard (ruling Z2, Plan 3a Task 1 hazard 3), exactly as before Plan 3a. Its credential file was last written days before the census, so the census reads the catalogue's age and the `auth.json` mtime (stat only) before the window opens.
4. **Lane 1 soak gate.**
   - One real session runs on the lane.
   - At least one hourly `ccrc-models.timer` run takes the codex arm.
   - **Obligation (critic #4):** at least one auto-update lands on the box while lane 1 is codex, so the soak exercises the `_inst_codex_tiers` restart and the runtime check.
   - The usage row refreshes every 15 minutes from a single writer.
   - Doctor stays clean.
   - **Stop or rollback criteria:**
     - a gateway 401;
     - a foreign-listener finding;
     - a usage row older than two intervals;
     - a launcher refusal in the `claude-session@<id>` journal.
5. **Lane 2: park, cut over, un-park.**
   - **Park both sessions (R-O2).** A surviving Claude Code process carries the other repository's gateway key, and a respawn while the launcher is aside fails five times and marks the unit failed.
   - Stop the other repository's lane-2 tiers, wait longer than `RestartSec`, and re-check that the ports are free and the units are gone.
   - **Obligation (ruling Z4's reason):** by then lane 1 is codex, and a bare `ccgpt stop` names lane 1's units, which are ccrc's own tiers. Measure, read-only, which units lane 2's own stop names before running it, and never run a bare `ccgpt stop`.
   - The operator disables that repository's template instance.
   - Move the launcher aside, then flip the roster.
   - **Obligation (critic #3):** before `ccrc wrappers` and `init codex`, back up lane 2's `settings.json` with its mode preserved, and whichever of `~/.ccrc/models/<lane>.{json,classes.json,classes.tsv,effort.json}` exist. The rollback restores them.
   - Run `ccrc wrappers`, then `ccrc models <lane> init codex`, which ruling Z3 refuses until the roster flip, so this order is structural. Diff the settings env block **and** the effort file before and after (critic #3), because model ids stay out of tracked text.
   - Refresh with lane 2's own `authDir`, then `litellm`, the targeted enable and `start`. A `unit-foreign` or `port-foreign` refusal is a stop, never an override.
   - Verify as for lane 1, plus a count-only check that no key-bearing transient unit remains.
   - Un-park.
   - **Obligations (critic #20):**
     - if any session cannot be parked (a refused swap, a failed swap, or no destination with headroom), the window does not open;
     - on un-park, a session whose first turn fails is swapped back out and the lane rolls back.
   - **Rollback:** as for lane 1, plus restarting the other repository's lane 2 through its restored launcher and re-enabling its instance timer. Before the roster backup goes back, remove the class registry lane 2's `init codex` created (`ccrc models <lane> rm`), then restore the models backups, which held only lane 2's effort file. Ruling Z3 leaves an existing registry alone, and a lane-2 registry left on an external row is probed hourly through lane 1's directory (Plan 3a Task 7, hazard 4).
6. **Close-out.**
   - Apply R-O4's settings-mirror ruling.
   - Mirror the server box's roster only if R-O5 says to. **Obligations (critic #14):**
     - a read-only census first (the roster copy, the `/api/updates` builds, and the pool epoch for these ids);
     - a backup of `accounts.json` with its restore named;
     - a stop if `parseRoster` refuses;
     - roster agreement answering `agreed` afterwards.
   - Confirm auto-update is running.
   - Complete the verification record for both lanes.
   - Start Plan 4's soak clock.

   Plan 3b's own ledger mints these when they fire: `runtime-built-before-the-roster-flip`, `lane-without-a-registry-inits-after-the-flip` and `both-foreign-usage-timers-retired-per-lane`.

**Operator rulings, with recommendations (R-O1…R-O9), plus R-C10's framing**
- **R-O1, which lane goes first:** lane 1, then a soak, then lane 2, **conditional on Plan 3b step 1's lane-1 session count**. At drafting lane 1 had no sessions and no loaded units, and it already has a registry; since 2026-09-30 its tiers are measured running. If step 1 counts no session on lane 1, the recommendation stands as written. If it counts any, lane 1's window parks them first, as R-O2 parks lane 2's, or the order goes back to the operator. Either way lane 1 flips first for Z4's reason: it is the lane with a registry.
- **R-O2, parking lane 2's two sessions:** swap each through ccd's own swap to a non-codex account at an idle point between the coordinator's waves, and swap back after verification. Add critic #20's stop conditions.
- **R-O3, lane 1's port pair (which sits in a band other test mocks use):** keep it. `_codex_tier_ours` makes a squatter loud, and choosing ports is the operator's alone.
- **R-O4, who keeps a codex home's `settings.json` in step after cutover:** freeze it at cutover. `plugins` is a link and persists, and hooks and the statusline are converged by `install-session-hooks.sh`. Also answer, per R14 and critic #23, whether `alwaysThinkingEnabled` still matters now that the shim owns effort. Recommendation: leave the key as written (it persists, and no ccrc writer owns it), and measure in Plan 3b Task 1 whether the shim's effort mapping makes it moot.
- **R-O5, mirroring the lanes' exec blocks into the server box's roster:** yes, after both lanes verify and after critic #14's census.
- **R-O6, pausing auto-update:** pause it for each lane's window only, never across the soak (critic #4, and the 2026-09-30 ruling that ccrc's own updater is monitored, never replaced by hand). The skeleton's `update.lock` reason is refuted: no runbook step takes that lock.
- **R-O7, the live launcher's bytes, which match no commit:** keep a box-local, dot-named 0600 snapshot until Plan 4's cleanup is verified.
- **R-O8, OpenClawHetzner's box-swap runbook and the GLM notes:** trim the runbook in place, and move the GLM install notes into `infra/handoff/README.md`.
- **R-O9, the soak before Plan 4:** at least one full weekly usage window on both lanes.
- **R-C10's framing, a note carried from Plan 3a's merge authorisation (critic #22):** use the targeted `ccgpt-runtime build` plus the one `enable --now` of ccrc's instance, not a full install. It equals the spine's own converge only once the operator has disabled that lane's foreign usage timer (its `ccgpt-usage@<id>.timer`, or the flat `ccgpt-usage.timer`), so that disable precedes both the roster flip and the enable, as steps 3 and 5 order it. Only then is the next update a no-op. Plan 3b puts it to the operator for confirmation, because it resembles the hand rollout that the 2026-09-30 ruling forbids.

**Authorisation shapes**
- **Plan 3b**
  - **Pre-lane:** one authorisation for Task 2's runtime build (critic #13).
  - **Per lane:** one act each, with a named window, covering every one of these (critic #13):
    - the auto-update pause and resume;
    - `ccrc account disable` and `enable`;
    - the other repository's stop and its usage-timer disables;
    - the launcher move;
    - the roster hand edit;
    - `init codex` (lane 2) and the refresh;
    - `ccrc codex login`, if prompted, with the operator's browser;
    - starting ccrc's tiers and enabling its usage instance;
    - one headless test turn;
    - for lane 2, the ccd swaps that park and un-park its sessions.
  - **Optional:** a third authorisation for the server-box mirror.
- **Plan 4**
  - It rests on the operator's standing authorisation of the eventual removal (spec §2.11), plus an explicit go after the soak.
  - Tasks 1–3 are one OpenClawHetzner PR, reviewed there.
  - Task 4 is a separate, irreversible live act, authorised on its own.
  - Task 5 is a small ccrc PR, code plus docs (ruling Z8).

**Plan 4: retirement (the point of no return)**
1. **OpenClawHetzner:** move claude-glm's install notes out of the runbook being deleted, to where R-O8 says. A grep proves the notes are at their new home before the old file goes.
2. **OpenClawHetzner:** split `test_ccgpt_proxy.py` per method. State method counts before and after. The GLM/K3 wrapper cases, the provider-policy cases and the ownership-allow-list case stay and pass, run per the file's docstring (that repository has no CI for them). The publisher's SHA-256 pin goes with the publisher.
   - **Obligation (critic #19):** map each deleted GPT-lane test method to a ccrc case, or to a stale `nohup` pin that spec §14 says to replace, with counts on both sides.
3. **OpenClawHetzner:** delete the GPT-lane files and repair every reference.
   - **Obligation (critic #19):** the count is ten files deleted plus the one split in Task 2, not "eleven deleted".
   - Mark the box-swap design record superseded, and fix the `.gitignore` comment.
   - `git grep ccgpt` then hits only superseded records.
   - `~/.handoff/env` and the GLM/K3/handoff-runner scripts are untouched.
   - No email is added anywhere.
4. **The live box: clean up the other repository's installed lane files.**
   - First, take R-O7's snapshot.
   - The list: the three `~/.local/bin` executables, the moved-aside `<lane>.pre-ccrc-*` launchers, the stale PATH copy of the model probe, the four usage unit files and their drop-in directory (then `daemon-reload`), and the other repository's box-global LiteLLM config with its per-lane copies.
   - **Obligation (critic #18):** also list, or explicitly keep, the other repository's `.bak-*` and `.pre-*` backup copies of its launcher and shim in `~/.local/bin`.
   - **Stop before any `rm`** if any process's argv names one of those files or the other repository's LiteLLM venv, or if any `ccgpt-usage*` timer is enabled.
   - **Afterwards:** `ccrc doctor` is clean, both lanes still serve a turn, and `~/.handoff/env` and both `authDir`s are byte-untouched (stat mtime and size only).
   - The other repository's LiteLLM venv is left alone unless a ruling says otherwise.
5. **ccrc PR, code plus docs (ruling Z8):** a small PR, opened once no external lane has a codex registry, measured read-only on the fleet box first: no `external` row has a `<id>.classes.json`.
   - It deletes `_models_litellm`'s external arm (the box-global path, `_models_litellm_running`'s `pgrep`, the bare `ccgpt stop`) with Plan 3a Task 2's `_models_litellm_stop_blocked`, and the probe's `_fetch_codex`, which carries the token-directory default and the direct `auth.json` read, so D-3161 closes everywhere. `_fetch`'s dispatch line goes with it, and so does the `CCRC_PROBE_LANE_KIND` marker `_models_probe_codex_env` exports for it.
   - Ruling Z3's registry guard and Z4's stop guard lose their reason to exist and go with them, each with its pins: `models-probe.test.ts`' two Z1 cases, the Z4 describe, Task 10's live-shape refresh pins, and the planted external registries (`plantCodex`, `seedCodex`, `SEEDED_REGISTRY_BYTES`) wherever a case dies with the arm.
   - The spec records that the cutover and the deletion are done, citing the other repository's deletion commit and Plan 3b's deviations. `deviation-refs`, `dtbd` and `topology-clean` stay green, and no docserver URL or real value appears.

### Final-review follow-ups

The whole-branch review's twelve follow-ups, adjudicated 2026-10-02, each with its owner, and one more the final fix wave found at MF-2's edge (the last bullet). Line numbers are measured on the final fix wave's tree, after its merge of `origin/main`; re-derive them by name before acting. Two are done in that wave, and the other ten are carried, none dropped.

- **DONE (final fix wave): lane 1's stale "idle" facts.** The Global Constraints' live shape, Task 10's two-refreshes note and its copy of `liveShapeRefreshes`' docstring (and that docstring in `server/test/codexLaneFixture.ts`), D-3708's "Measured at drafting", this section's live shape and vocabulary, the Z4 order bullet, R-O1 and the Merge authorisation now say that lane 1's tiers are measured running since 2026-09-30, that the bare stop is armed, and that the merge stays neutral. Owner: done; Plan 3b step 1's census re-measures it.
- **`_models_probe_codex_env` and `_models_litellm_codex` fold an undecidable roster into "not codex"** (`ccd/ccrc:9575`, `:9855`). D-3706's wrong-lane-default class; Z4 already fails closed on the same undecidability. Refuse instead, with a case and a mutation row, and amend §20.1's "has no default" sentence (spec `:982`). Owner: **Plan 3b**, landed before its first flip.
- **Usage-converge flip-back gaps** (Task 6 minor 7, `_dr_codex_usage_box` at `ccd/ccrc-doctor-checks:5758`; the "nothing of ccrc's reads it" clause at `:6008`; the "withholds its own" wording at `:5799`; Task 11 minor 3's rc-only withdrawal verdict, `_inst_codex_usage`'s disables at `ccd/ccrc:14730` and `:14743`; spec §20.4's "every lane whose timer is still enabled", spec `:1039`). A doctor WARN over `_codex_usage_enabled_ids` minus the codex lanes, `&& ! _codex_usage_enabled "$u"` after each disable, and §20.4 amended in the same commit. Owner: **Plan 3b**, before it relies on a converged flip back.
- **Account removal can race an in-flight `ccrc-codex-usage@<id>.service`** (Task 7 minor 1; `_acct_remove_usage`, `ccd/ccrc:22058`, and the limits-row removal loop at `:8421`). Stop ccrc's own exact-name `.service`, or wait for it to go inactive, before the limits row is deleted, minding the `auth.json` write a stop mid-refresh could interrupt; or narrow the comment. No instance can exist before Plan 3b, and the ghost-row consequence is refuted (`server/src/limits.ts`'s `inRoster`). Owner: **Plan 3b**, before its first codex account removal.
- **Doctor robustness minors** (Task 4 minor 5, a missing `cmp` early-returns past the missing-file and no-tree checks, `ccd/ccrc-doctor-checks:5876`; Task 4 minor 6, an unlistable `~/.ccrc/codex` reads as SKIP, `:5773`; Task 5 minor 4, an unreadable `.wrapper` folds into "not this lane's", `_dr_cx_sessions` at `:6542`). Overloaded-null or unmeasured folds on codex-lane-only paths, inert at merge. Owner: **one follow-up ticket**, before Plan 3b.
- **`_fix_codex` prints "litellm.yaml NOT rendered" over a refusal whose detail says the file was written** (`ccd/ccrc-doctor-checks:6205`). Cosmetic, codex-lane only. Owner: **a follow-up ticket**.
- **Task 1 minor 4's `login-required` wording, and import-time LiteLLM output or tracebacks on the codex path** (`ccd/ccrc-models-probe:347`). Both need a real-LiteLLM opt-in case (`CCRC_TEST_LITELLM_PY`) to measure; the wording is plan-mandated and pinned, so it is reworded in its own change. Owner: **a follow-up ticket**.
- **Pre-existing: the refresh loop folds a bodyless `_models_litellm` failure into `skipped` on an `ok:true` row** (`ccd/ccrc:10348-10359`). The base's bytes, outside Plan 3a. Owner: **Plan 3b**: its soak gate (step 4) must not count a `skipped` row as "took the codex arm".
- **DONE (final fix wave): `BASE_LIVE_SHAPE`'s docstring** (`server/test/ccrc-install.test.ts`) names the commit it was measured on, the merge-base `1f9fa22d`, says it is a golden re-measured only by Task 10 Step 3 on a disposable copy of a new base, and says Plan 4's deletion of the external arm retires or re-measures it. Owner: done; **Plan 4** acts on the pointer.
- **Spec wording minors.** No same-line pointer on spec `:497` ("Nothing in ccrc … reads the contents of an OAuth file") against §20.1's library read and write of `auth.json`; §20.1's "No device flow outside `ccrc codex login`" (spec `:993`) over-claims, because the tier process's `Authenticator` can still start one; §20.9 (spec `:1082`) and D-3705 say the rehearsal "measures the base on the same fixture" where it compares against a golden measured once; D-3721's sentence order. Each edit to a line above §20 keeps Task 11's same-line-pointer proof green. Owner: **Plan 3b** for the lines it relies on, the rest **Plan 4**'s docs.
- **Test-coverage minors.** The probe runtime's no-network audit hook is unpinned (`server/test/codexLaneFixture.ts:1903`), plus the per-task deferred minors: Task 4 (1)-(4) and (7); Task 5 (5) and (6); Task 6 (5) and (6); Task 7 (2)-(6); Task 8's two; Task 10 (1), (4), (6), (7) and (8). Guard-binding and nit items with no live effect; the final fix wave's MF-2 `materialise --check` case already binds the `materialise-unreadable` refusal. Owner: **one follow-up ticket**.
- **`server/test/macos-platform.test.ts` timed out once at 20 s under load.** Green alone, and the macOS legs gate nothing by ruling. Owner: **a follow-up ticket** for the repository `CLAUDE.md`'s flake-list maintainers, not this branch.
- **Found by the final fix wave, at MF-2's edge: the models writer path still opens `settings.json` by name.** MF-2 type-tests the five lane-file READS models-op makes, and the fix list kept the `materialise` writer path unchanged. That path's settings merge, and `rm`'s clear, read the lane's `settings.json` through `shared/modelenv.mjs`'s `mergeSettingsEnv` and `clearSettingsEnv` (`:247`, `:325`) with no type test, so a FIFO there can still block `_fix_codex`'s re-render (`materialise` without `--check`, `ccd/ccrc-doctor-checks:6186`) and every `ccrc models` mutation. The roster read (`readRoster`, `deploy/models-op.mjs`) opens by name too. Owner: **a follow-up ticket**, before Plan 3b relies on `doctor --fix` for a codex lane: the same `readRegular` test in `shared/modelenv.mjs`'s two reads, keeping the EISDIR rename failures `models-op.test.ts` pins, with a FIFO case and a mutation row each.

## Appendix: the controller rulings this plan cites (R1–R15)

These rulings bind every drafter and reviewer of Plan 3a. The fix round's rulings F1–F10 amend them and win where the two disagree; R3 below carries F9, and R10 and R11 carry F1, F4 and F10. Operator ruling Z (2026-10-01) binds over all of them: it replaces R-C2 and R-C3, and with them R3's external-lane half and R4 (its own row is the last). `R-C1`…`R-C12` are the skeleton's questions, anchored in [Rulings this plan is built on](#rulings-this-plan-is-built-on). `R-O1`…`R-O9` are the operator's, in [Carry-forward to Plan 3b and Plan 4](#carry-forward-to-plan-3b-and-plan-4).

| Ruling | What it binds |
|---|---|
| R1 | Scope: Plan 3a only. That is the code that must land before any roster row is flipped, inert on today's live shape. Merging auto-releases, and both boxes follow dev. Plans 3b and 4 are separate and written later. This plan ends with their carry-forward, stating the live shape in fixture terms only. |
| R2 | The usage pair is ccrc's, as `ccrc-codex-usage@.{service,timer}`, placed on fleet and both, Linux only. `ccgpt-usage@` stays the other repository's: ccrc never places, enables, disables or removes it. On Darwin, placement and the doctor rows answer a stated not-applicable, with a forced-Darwin test. |
| R3 (as amended by F9, and by ruling Z for external lanes) | A codex lane's probe has no token-directory default and reads its own `authDir` through its own runtime. An external lane keeps today's probe path, default included, until its flip (Z1), and cannot gain a codex registry (Z3); Task 10 pins every check's class, `models` included, and the external lane's hourly refresh against the measured base. The device flow is prevented in-process before any `auth.json` write, on the probe's codex path and in the publisher, tested by a stub whose marker must never appear. The usage service gets `TimeoutStartSec`. D-3161 closes on the codex path through `Authenticator().get_account_id()`, which Task 1's Step 0b re-measures read-only; if the method is gone, Task 1 stops and reports and the controller rules. No slug is pre-named, and the closure mints no number. |
| R4 (replaced by ruling Z) | The external `_models_litellm` arm is NOT retired in 3a. It keeps its bytes on today's shape and refuses its stop once a codex row exists (Z1, Z4). The merge authorisation carries no operator confirmation; only R-C10's 3b framing remains, as a note. |
| R5 | R-C4…R-C9 and R-C11 are adopted as their recommendations state. R-C11's file list includes `agent/test/deploy-verify.test.ts`, `usage-sweep-deploy-ship.test.ts` and `install-census.test.ts`' note at :58. The `deploy.sh` probe-line removal rides with the other deploy-verify edits. |
| R6 | The second writer: the converge degrades rather than enables ccrc's instance while the other repository's instance for the same id is enabled. `_check_codex` WARNs and names the operator's own disable, and ccrc never disables a foreign unit. The flat, id-less foreign timer is said to be unattributable. |
| R7 | `lane.json` staleness against the registry is measured by a check-only `materialise` that answers `changed`. Task 4 uses it and Task 8 cures it. It is spelled `--check true` (D-3712). |
| R8 | `--fix` regenerates a launcher only when it is marker-verified (Task 8); otherwise the deferral is recorded by slug. |
| R9 | Spec edits are an appended `## 20. Amendments (Plan 3a)` plus same-line pointers. No line above §20 moves, and Task 11 proves it. |
| R10 (as amended by F1 and F4) | Task 11 adds every live GPT-lane label that the class's `passes` does not pin to `topology-clean`'s ROSTER_RESIDUE class, base64-encoded, reading the labels from the box roster at execution time; the red-first proof uses a synthetic label in a disposable copy (F4). A hand-grep covers the rest, measured read-only on the fleet box at execution time (F1): the ids and labels from the roster, lane 2's ports from its launcher's two `export` lines, the auth-directory and config names by `ls`, and lane 2's session codenames from `.wrapper` field files, names only. The gitignored reference file is not consulted; its GPT-lane section is Plan 3b Task 1's. The plan spells none of the values, and no step prints one. |
| R11 (as amended by F10) | Every suite command runs between two snapshots of `systemctl --user list-units --all 'ccgpt-*' 'ccrc-codex-usage@*'` and of the user manager's `timers.target.wants` links of those names, plus a fixture-process census, and any new unit, appeared or vanished link, or process that the attribution rule assigns to the run fails the step; Task 11's final gate counts only those. Fixture ids never equal a rostered id. |
| R12 | Deviations are named `⟦D:<short-slug>⟧` only. The controller mints every number after review. |
| R13 | Public repository: no real account id, label, port, host, email, operator path or live model id appears in any added line. Live facts are stated by shape. |
| R14 | Item placement covers 2b1-12, under Task 6 and the 3b carry-forward. The `alwaysThinkingEnabled` question goes to the 3b carry-forward. |
| R15 | Style: Plan 2b-2's format; code written against the actual current functions; red-first tests; a mutation for every new guard; foreground suites through `./node_modules/.bin/vitest run`. |
| Z (operator, 2026-10-01) | Binds over every row above. Plan 3a's merge changes nothing on the live box. Z1: external lanes keep today's behaviour byte for byte until their flip in Plan 3b. Z2: codex-kind lanes get the new probe path. Z3: an external lane cannot gain a codex registry. Z4: the external arm never runs the other repository's stop once a codex lane exists. Z5: task numbering stays. Z6: D-3706 and D-3708 are redefined, and Z4 is a new departure. Z7: Task 10 pins every check's class and the external lane's hourly refresh against the measured base. Z8: the carry-forward. Z9: spec §20 describes Z1–Z4. |


