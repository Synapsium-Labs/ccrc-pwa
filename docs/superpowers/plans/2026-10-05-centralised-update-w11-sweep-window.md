# Centralised update management, wave 11: one shared verify window for the supervisor sweep, re-checked once (R12, sweep half), wave 10's residue (R13) and the auth reader's residue (R14 f–j): Implementation Plan

The coordinator scoped wave 11 on 2026-10-04 22:56 UTC (workflow `wf_790a5b99-8ca`) and ruled its scope on 2026-10-05 11:10 UTC, when wave 9 merged as `00f8a193` (#251) and run 270 opened. On 2026-10-05 13:58 UTC (ledger entry "wave 11's plan drafted and attacked; the operator re-ruled ruling 6"):
- the draft was attacked (workflow `wf_6ef19291-c0d`, 26 confirmed findings, none blocking);
- the operator re-ruled ruling 6 for wave 11: **"Re-check once."**;
- the coordinator ruled on every other finding.

This revision applies all of it.

The wave covers three things, with R14(f) first:
- **R14 (f)–(j)**, the auth reader's residue in `ccd/ccrc`'s `_box_*` readers, pins and prose (Tasks 1–3, part of Task 8).
- **R13 (a)–(f)**, wave 10's residue in `deploy/verify-service.sh` and its tests (Tasks 4–5, part of Task 8).
- **R12's sweep half** in `_upd_sweep`, Linux and Darwin, with the operator's re-check (Tasks 6–7).

One line per task:
- **Task 1.** R14(f)+(g): `_box_unit_env`'s Linux arm reads bytes (`local LC_ALL=C` after the Darwin dispatch).
  - U4u's F2 row runs on both feeders, and a Linux false-OFF row and R14(g)'s plain-loop row join it.
  - U4p pins that no `LC_ALL`, in any spelling, sits above the dispatch.
- **Task 2.** R14(j): the Darwin plain test refuses the thirteen names that, measured against bash 3.2.57 and 5.2.21, stop the launchd job before `exec`. It uses a new cause, `name`, and its reason text names the cause and the line, never the variable.
- **Task 3.** R14(i): an instrument in `server/test/platform-hazards.test.ts` records which UTF-8 locale bash takes on the runner and whether the unpinned readers misread there. It never asserts the macOS answer.
- **Task 4.** R13(f), and wave 10's Readings 2–3: the cross-version file is re-homed onto a FROZEN copy of the pre-wave-11 `_upd_sweep`, byte-identical from v0.0.60 to v0.0.84.
  - The helpers that frozen sweep calls are pinned by hash.
  - Its builders move to `server/test/sweepFixture.ts`, and its header cites `ccd/ccrc` by content.
  - It adopts wave 9's containment beside its own.
  - It lands before any `_upd_sweep` edit.
- **Task 5.** R13(a)–(d) in `deploy/verify-service.sh`. The purged arm requires all of these:
  - ccd's id grammar;
  - no leading `.`;
  - a `.uuid` that is not a symlink;
  - `LoadState=loaded`.

  The re-poll's `sleep`, the `-L` half and `?*` get their pins.
- **Task 6.** R12, Linux:
  - `_upd_sweep` verifies every listed unit by concurrent per-unit calls, in chunks of at most 128, from a launcher subshell whose failed fork cannot end the run.
  - Units that read crash-shaped (`activating`, `failed`) after the restart join the set (D-3984).
  - A unit whose first verify failed crash-like gets ONE more single-argument call, in the foreground, after its batch. Only a second failure fails the update, and re-checks stop at the first that fails (D-3983; Reading 17, ruled).
  - A unit with no recorded result gets its first verify alone, in the foreground, under the same rule (Reading 18, ruled).
  - Each unit's output is replayed in listing order, and the sweep's exit path kills its own verify jobs.
  - It dies through a report-ownership guard (`_upd_sweep_die`), in words that state the facts before the unit name.
- **Task 7.** R12, Darwin: `_ccrc_job_stayed_up` samples every kicked job in one shared window, in-process. Each failure gets one re-check. The arm's two dies go through `_upd_sweep_die` with facts-first wording, and D-3949's comments say where the arms still differ.
- **Task 8.** Prose, line-neutral: R13(e) (wave 10's plan), R14(h) (wave 9's D-3833 bullet), and D-3949's `deploy/deploy.sh` comment.
- **Task 9.** The gate and the PR.

**THIS WAVE GOES LIVE ON MERGE**, by auto (dev, `auto=channel`), fleet box first. The live state, from the ledger's 2026-10-05 12:36 entry:
- The operator acked the failed v0.0.78 fleet row at 12:21:44.
- Auto converged both boxes on v0.0.84 by 12:36.
- The fleet box's move ran v0.0.78's `_upd_sweep` with v0.0.84's script. It verified 71 supervisors one at a time, about 8.9 s each, 10.5 min in all.
- Nothing is halted. The next fleet move, into wave 11's release, runs v0.0.84's sweep.

**The sequencing fact every task respects.** The move INTO a build runs the OLD `_upd_sweep`, the one being replaced:
- the detached update re-execs the launcher (`_upd_detach`'s `_svc_run_detached /bin/sh -c 'PATH="$HOME/.local/bin:$PATH" exec "$HOME/.local/bin/ccrc" "$@"'`, `ccd/ccrc:18355`);
- the launcher execs `~/ccrc/ccd/ccrc` before the flip (`_inst_shim`'s heredoc line `exec "$CCRC_SHIPPED" "$@"`, `ccd/ccrc:13969`).

That old sweep resolves the script when it calls it: `local verify="$BOX_TREE_DIR/deploy/verify-service.sh"` (`ccd/ccrc:20948`), with `BOX_TREE_DIR="$HOME/ccrc"` (`ccd/ccrc:1588`). By then the link names the NEW tree. Three consequences:
- the sweep half (Tasks 6–7: the shared window, the re-check, the crash-shaped listing, the guard) protects only the moves AFTER the one that ships it;
- the script half (Task 5, on top of wave 10) protects the move into it;
- a rollback (flip or re-install) runs the NEW sweep with an OLDER script, because `~/ccrc` then names the kept or re-installed tree.

**The pairings, and which task makes each safe.** The four names below:
- **OLD sweep:** the `_upd_sweep` every release from v0.0.60 through v0.0.84 ships. It is one function text, sha256 `d01e0a05…`, measured per tag. The attack measured the same digest from v0.0.53.
- **S0:** `verify-service.sh` at v0.0.60–v0.0.79 (sha256 `fae9a23f…`), with no classifier.
- **S10:** the script at v0.0.80–v0.0.84, with wave 10's classifier.
- **S11:** this wave's script.

Every NEW-sweep call, the re-check included, passes the script exactly one argument and reads only its exit code and its output. So every script version answers it.

| Sweep | Script | When it runs | Safe because |
|---|---|---|---|
| OLD | S11 | **the move INTO wave 11, on both boxes** (both run v0.0.84 since 12:36) | Task 5 keeps wave 10's exit 0 for a stamped or purged stop, and its new guards only narrow the purged arm. `LoadState` reads `loaded` for every purged id on the live user manager (35 real ones, measured). Task 4's X-cases prove this pairing on the frozen bytes. This move has no re-check and no crash-shaped listing: those are NEW-sweep code. Its serial loop verifies late, which the attack measured as failing 0 of 24 recorded sweeps with S10. Its die still writes with no ownership check and still names the backup, so the worst case costs one more ack, as before |
| NEW | S11 | every move after wave 11 lands, and a rollback flip to a kept tree from wave 11 or later | Tasks 5 and 6 |
| NEW | S10 | a rollback (flip, re-install or the watchdog's) to v0.0.80–v0.0.84 | Task 6's calls are one-argument. S10 has the classifier. R13(a)'s narrowings are absent there, on inputs measured unreachable (review 263 F2). The re-check and the crash-shaped listing are sweep-side and work unchanged |
| NEW | S0 | a rollback to v0.0.79 or older | One-argument calls verify every unit (R1, the critic's B2), and a crash-like failure is re-checked (R3). There is no classifier, so a stop that is still in place at the re-check fails that rollback's sweep, as it always did (R2) |
| deploy.sh's serial loop | the script it just pushed | the fallback deploy | Task 5, through the script. The loop is unchanged, with no re-check (Not in this wave) |
| NEW Darwin arm | — (in-process) | moves after wave 11 lands on a Mac | Task 7. No Mac is centrally managed |
| OLD Darwin arm | — | the move INTO wave 11 on a Mac | nothing new: it dies on a deliberate stop (D-3949) |

Tasks 1–3 touch no pairing: `ccrc doctor` and install's gate line run the tree they ship in.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ] `) syntax for tracking.

**Goal:** a supervisor that is healthy, or was stopped on purpose, no longer fails a fleet update, while a crash still does.
- A deliberate stop late in a fleet sweep no longer fails a healthy update. A transient death inside the window, recovered by the re-check, no longer does either.
- A crash still fails, including a build that crash-loops every unit.
- The die never clobbers another run's report, and it says what is true.
- Doctor's auth reader reads bytes on both feeders and refuses the shell names that stop the macOS job.

How the incident happened (ledger, 2026-10-04 22:27):
- `_upd_sweep`'s Linux arm lists the active set once (`ccd/ccrc:20950`), then runs `verify-service.sh` on each unit in turn. Each run is a 3 s settle plus a 5 s window, live about 8.9 s per unit.
- The first failure ends the verify through `_ccrc_die` (`ccd/ccrc:20963-20968`). The die writes `failed` (`ccd/ccrc:2355`), and the server halts every move until an ack.
- A hand archive inside that span failed v0.0.78's move. At 71 units the span is now 10.5 min.

Wave 10 fixed the script. This wave shortens the span to one window and adds the operator's re-check, without giving the script a new argument contract.

**Why the re-check (13:58, attack F1).** The attack measured the 24 recorded update sweeps since 2026-09-29.
- Supervisor exits run hot right after a sweep's restart: 3 in the first 120 s, against 0.25 expected at the 0.30/h baseline.
- A shared window puts every unit's one exposure about 22–27 s after the restart.
- On 2026-10-04 at 22:06, `ccrc-pwa-bright-harbor`'s session ended 28 s after its restart, and systemd brought it back at +30 s.
  - A shared window would have read p1 `active` and p2 `activating` or a new MainPID, and failed the update.
  - The serial loop verified that unit at +78 s and passed it.
- So the planned sweep without a re-check fails 1 of 24 recorded sweeps, where the OLD sweep with S10 fails 0.
- The re-check passes exactly that shape (W14) and still fails a crash that persists (W15).

**Architecture:**
- No ring changes. No server, agent, PWA or `shared/` source changes. No change to `ccd/ccd`, `ccd/ccrc-doctor-checks`, a unit file or `install.sh`.
- **`ccd/ccrc`:**
  - `_box_unit_env` gains one `local LC_ALL=C` after its Darwin dispatch (Task 1).
  - `_box_env_shell_plain` gains one name refusal, and `_box_unit_env_shell` a `name)` reason arm (Task 2).
  - New, directly above `_upd_sweep` (Task 6): `_upd_sweep_die`, `_upd_sweep_launch`, `_upd_sweep_kill`, `_upd_sweep_replay` and `_upd_sweep_spo`.
  - `_upd_sweep`'s Linux verify block is rewritten (Task 6), and so is its Darwin stay-up block (Task 7), each with its comments.
  - `_ccrc_job_stayed_up` takes `<unit>...` and samples in one window (Task 7).
  - `_ccrc_die`'s one line is byte-identical.
- **`deploy/verify-service.sh`:** a new `ccd_id_ok` helper above `stopped_on_purpose`, the purged arm's guards, and the WHY block's R13(a) paragraph and its one stale sentence about the serial sweep (Task 5). Lines 1–62 do not move.
- **`deploy/deploy.sh`:** one comment line, reworded in place (Task 8). The loop is untouched.
- **Tests:**
  - `agent/test/deploy-verify.test.ts` (Task 5).
  - `server/test/ccrc-sweep-deliberate-stop.test.ts`, re-homed (Tasks 4–5).
  - The new `server/test/ccrc-sweep-window.test.ts` (Task 6).
  - The new `server/test/sweepFixture.ts`, a non-test helper module.
  - Two new frozen fixtures under `server/test/fixtures/` (Tasks 4, 6).
  - `server/test/ccrc-update.test.ts` (Task 7), `server/test/ccrc-doctor.test.ts` (Tasks 1–2), `server/test/platform-hazards.test.ts` (Task 3), and one comment in `server/test/ccrcContainment.ts` (Task 1).

**Tech Stack:**
- bash `set -uo pipefail` (`ccd/ccrc`, `deploy/verify-service.sh`). ccrc's floor is bash ≥ 4.4.
- vitest in `agent/` and `server/`.
- TypeScript on node `>=22.13.0`.
- No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-20-centralised-update-management-design.md`. No section changes: the design never says what a sweep verify failure means (R12 report 2, §0). Every departure from shipped text or from a ledger ruling is a numbered entry in `## Deviations found`.

**Producers:**
- `main` at `00f8a193a2f06eb9d87e4d66cdd4c859adf111fd` (#251, wave 9; v0.0.84).
- The R12 investigation (`wf_790a5b99-8ca`: the synthesis and the completeness critic's B1–B2, I1–I9, M1–M8).
- The attack on this plan (`wf_6ef19291-c0d`: lenses live-window F1–F7, pairings-die P1–P6, auth-reader A1–A5 and tests-containment T-1–T-8).
- Reviews 263 (R13), 265 (F9), 266 and 269 (R14 f–j).

**D-refs this plan cites as they stand:**
- D-2605: `_reg_purge` orders its deletion, `.generation` last (`ccd/ccd:4041-4044`, `:4087-4091`), and keeps nothing;
- D-3599: an unmeasured listing degrades the sweep;
- D-3808, D-3818 and D-3830: wave 9's test harness, containment and plan amendments;
- D-3822, D-3823, D-3831, D-3832 and D-3833: the auth reader;
- D-3946, D-3947, D-3948, D-3949 and D-3950: wave 10's script half.

## Not in this wave

Reviewers: do not raise these.

- **R14 (a)–(e) and the 10-02 wave-10 deferrals** belong to wave 12 (ledger, 2026-10-05 11:10):
  - R2, R3, R4-1 and R4-3, R8a–h, R9-R1, R10c, R10f, R10i, R10j and R10k;
  - the `ccd/ccd` harness containment and the dotted-id reverse maps;
  - `_bak_prune`/`_bak_gc`'s shared filter (R14a), the raw-spawn census (R14b), the six parked minors (R14c) and the Linux per-key line number (R14e).
- **`--no-reload` in `_svc_enable`, which is wave-12 residue (13:58, F3).**
  - Each restarted supervisor runs `systemctl --user enable` (`ccd/ccd:882`, called by `cmd_ensure`, `:21947`), so the user manager reloads once per supervisor, one reload after another. At 71 units that is 27 s.
  - Passing `--no-reload` would remove that storm. It is a `ccd/ccd` change, outside this wave.
- **`deploy/deploy.sh`'s per-unit loop does NOT change, and gets no re-check.** It still runs `bash ~/ccrc/deploy/verify-service.sh "$u" || exit 1` serially (`deploy/deploy.sh:1108-1109`). The reasons:
  1. It is the fallback, not the update path. It writes no `update.json`, so it cannot halt the fleet. A false failure there costs a re-run.
  2. It runs the script it just pushed, so it never meets B2's version skew.
  3. It already gets wave 10's classifier, and Task 5's narrowings, through the script.
  4. Its `SWEEP_CMD` is pinned by `single-definition.test.ts`'s sweep describe and by `agent/test/deploy-verify.test.ts`'s `SWEEP_CMD` regex cases.
  5. The R12 synthesis and wave 10's ruling 1 both said to leave it.

  Only its comment at `:986` changes, line-neutral (D-3949's own instruction).
- **Lifting a deliberate stop into a warning, the console or `update.json`** (wave 10's Reading 4, the critic's M8).
  - The script's `stopped on purpose:` line is replayed in listing order on the sweep's stdout (Task 6), so the transcript keeps it.
  - A sweep-side warning would make the sweep parse the script's success text, a second contract every rollback pairing would have to tolerate.
  - The sweep reads that text in one place only: to tell a non-crash-like failure (D-3983).
  - The success lines are pinned verbatim by `runbook-holds.test.ts:429-444`.
- **A Darwin deliberate-stop classifier** (Reading 1; D-3975). The Darwin arm gets the re-check (D-3983), not a classifier.
- **A Darwin crash-shaped listing.** D-3984 is systemd's `list-units` vocabulary. The Darwin arm already warns about and skips a job with the start-limit stamp (`ccd/ccrc:20861-20864`), and no Mac is centrally managed.
- **Ruling 3** stands: an UNSTAMPED `inactive` unit still fails, and the re-check does not change that unless the unit is back up and stable by its re-check.
- **Critic M4:** a second update's `try-restart` during this run's window still reads as MainPID churn on the first call. The re-check covers it if the churn has settled. The ownership guard (Task 6) stops the report being overwritten.
- **Critic I9 / ruling 5:** no bulk-stop cap. **No freshness clause** (ruling 4). **No `ActiveEnterTimestamp` read.**
- **A registry test that would tell a purged row from a never-existed id** (Risk notes, R13(a)). D-2605's purge keeps nothing, measured: 0 of 35 purged ids still hold a `.generation`. So no registry fact tells the two apart, and the input is unreachable.
- **README / CLAUDE.md:** no sentence states the sweep verify's rule, measured. `README.md:789-790` and `:875` name the sweep and its preflight only, and stay true. Neither file is edited.
- **Other stale `ccd/ccrc:<n>` citations** in test comments are left: `ccrc-account.test.ts`, `ccrc-install.test.ts`, `session-hook.test.ts` and more are already stale at `00f8a193`. Only the six this wave owns are re-pointed:
  - R13(f)'s three;
  - `ccrc-doctor.test.ts:3591`'s and `:8384`'s `:2939`;
  - `ccrcContainment.ts:13`'s `:3295`.

  This wave's insertions move the last three, which are correct at `00f8a193`.

## Global Constraints

- **Anchors.**
  - Every anchor is measured at `00f8a193`, quoted, and given as `file:line`.
  - Step 1 of each task re-measures its anchors by their quoted text on the tip being built, after `git fetch origin main` (and a merge if `main` moved). The quote wins over the number.
  - Find code with graphify first (`graphify query "…"` over `graphify-out/`), then confirm with `grep -nF` of the quoted text.
- **Scope.**
  - The files in File structure, and nothing else.
  - The whole-branch check prints nothing:

        git diff --stat origin/main...HEAD -- agent/src server/src pwa shared ccd/ccd ccd/ccrc-doctor-checks ccd/ccrc-adopt '*.service' '*.timer' deploy/systemd server/test/ccdWsHelpers.ts server/test/codexLaneFixture.ts server/test/installTreeFixture.ts server/test/containedTools.ts README.md CLAUDE.md agent/CLAUDE.md .github install.sh

  - `deploy/systemd` is in the list for its four drop-ins, under `*.service.d/` and `*.slice.d/`. Git's `'*.service'` pathspec matches none of them, and `'*.service.d' '*.slice.d'` matches none either (measured with `git ls-files`: 0, 0 and 4 of 4 for `deploy/systemd`).
  - `deploy/deploy.sh` changes in comments only and keeps its line count. This prints nothing: `diff <(git show origin/main:deploy/deploy.sh | grep -v '^\s*#') <(grep -v '^\s*#' deploy/deploy.sh); [ "$(git show origin/main:deploy/deploy.sh | wc -l)" = "$(wc -l < deploy/deploy.sh)" ] || echo MOVED`.
- **Line pins that must hold.**
  - `deploy/verify-service.sh` lines 1–62 do not move. V15 pins them, and four sites cite them by number: `ccd/ccrc:25`, `ccd/ccrc:1693`, `ccd/ccrc-doctor-checks:153` and `server/test/ccrc-cli.test.ts:130`. This prints nothing: `diff <(git show origin/main:deploy/verify-service.sh | sed -n '1,62p') <(sed -n '1,62p' deploy/verify-service.sh)`.
  - `_ccrc_die`'s line (`ccd/ccrc:2355`) is byte-identical. The harnesses extract it with `^_ccrc_die\(\) \{.*\}$`, and Task 4's X0c pins its digest.
  - `_upd_sweep` stays readable by `/_upd_sweep\(\) \{([\s\S]*?)\n\}/`:
    - no line inside it starts with `}`;
    - its Darwin arm opens at `"$CCD_OS" = darwin` and closes at its own two-space `  fi`;
    - every inner block indents deeper (`single-definition.test.ts:2785-2810`'s `updSweepArms`).
  - The five new helpers go ABOVE `_upd_sweep`, never inside it, each readable by its own `/<name>\(\) \{([\s\S]*?)\n\}/`.
  - The three sweep close lines are byte-identical: the success line, the zero line and the Darwin zero line (`runbook-holds.test.ts:429-444` pins the first two).
- **`ccd/ccrc` grows in Tasks 1, 2, 6 and 7.** `session-hook.test.ts`'s census carries `'ccd/ccrc': 5` (`:8417`), a count of frozen-corpus citations that already fail. Growth can move it by coincidence. The attack measured 14 lines inserted at `:2854` and `:2971` keeping it green, and Tasks 6–7 insert below every frozen citation (the highest is `:11635`).
  - After each of those tasks, run `session-hook.test.ts`.
  - If `byFile` moved, re-measure it by S6-R11: dump the failure sets of the merge base and the tip, diff them, and state the composition in a comment beside the entry. That makes `server/test/session-hook.test.ts` a changed file, File structure's one conditional entry. Never adjust a number to make it green. No D-number.
- **Citations by content.** A citation this wave writes or re-points names a function and a quoted line, never a bare line number into `ccd/ccrc`. Task 4's X0b pins the cross-version file's header citations.
- **Fixture HOMEs only.**
  - Every case that runs or sources the real `ccd/ccrc`, or runs any copy of `verify-service.sh`, runs under a `mkTmp` HOME.
  - Every new server spawn proves its tools first:
    - the cross-version and window files call their own 12-name `assertContained` AND wave 9's `assertNoRealTool` on the spawn's final env (wave 10's Reading 3, decided: both);
    - the `ccrc-update` and `ccrc-doctor` cases use `updateEnv`/`unitEnvAnswers` as they are.
  - `TMPDIR` for every sweep spawn is `<home>/tmp`. The sweep's scratch dir lands under it and is asserted gone (W11).
  - **No verify job outlives its case** (T-1).
    - Every case that kills a sweep mid-verify then scans `/proc/*/environ` for processes carrying `HOME=<that home>`, in three steps and in this order:
      - it collects: `const found = survivors(box); const left = readdirSync(tmp);`;
      - it reaps, unconditionally: `reapSurvivors(box)` SIGKILLs every one and polls until none remain;
      - only then it asserts, on `left` and `found`.
    - **The reap runs before any `expect` that can throw.** A `try { … } finally { reapSurvivors(box); }` around the assertions is the same rule. The runs this plan requires to be red must leak nothing: Task 6 Step 2's red-first run, and rows T6-13a and T6-13b. The verify measured survivors in exactly those runs, 0.5 s after a 3 s spawn returned: 6 under each mutant and 4 under today's serial sweep.
    - This keeps the file's `afterAll` from removing a HOME while one of its jobs could fall through to the parent PATH's `systemctl` or `journalctl`.
  - No case runs `ccd`, `ccrc`, `systemctl`, `systemd-run`, `tmux`, `gh`, `ssh`, `scp`, `curl` or `journalctl` against the live box. No case reads or writes a real `~/.cc-sessions`, `~/.ccrc` or `~/.cc-limits`, or touches a `claude-session@*` unit.
  - Resolve bash once from the parent's PATH (`BASH`, the `ccrc-update.test.ts:63-68` idiom). Never spawn a bare `'bash'` under a narrowed PATH.
  - Every spawn carries a `timeout` below its `it`'s timeout: server sweep cases are `itLinux(…, 60_000)` with spawns at 45 s; agent cases are `30_000` with spawns at 15 s or less.
- **Frozen fixtures are never edited.**
  - `server/test/fixtures/upd-sweep-pre-wave11.bash` holds a header comment, then the OLD `_upd_sweep` text byte for byte.
  - `server/test/fixtures/verify-service-pre-wave10.sh` is S0 byte for byte.
  - Each digest is pinned by a case (X0, R0), and the frozen sweep's helpers are pinned by X0c.
- **Mutation-table discipline.** Every guard ships with a case that reds when the guard is removed or mutated, and the red is measured.
  - Before each mutation: `cp <file> "$SCRATCH/<name>.orig"`. Never `git checkout --`.
  - Apply the mutation and check that it parses (`bash -n`; tsc for test edits). A mutation that cannot parse as spelled is respelled, and the respelling is recorded.
  - Run the named command, then restore with `cp` and check with `cmp`.
  - A row is done only with a measured red count and the assertion that fired. A spawn timeout is "code -1", a suite hang is "killed by timeout(1)", never "red".
  - Each row lists its full expected red set. A measured set that differs is reported, not silently accepted.
  - `ccd/ccrc` is mutated only as a scratch copy pointed at by a transient edit of the test file's `CCRC_SRC` (wave 10's T2 technique), or in place and restored with `cp` + `cmp` before the next step. Confirm with `git status --porcelain` that only the intended files differ.
  - Rows marked *(prototype)* were measured on a scratch bash harness against a scratch copy of `ccd/ccrc` carrying this plan's blocks, not through vitest. The worker re-measures every row through the real file.
- **D-numbers.**
  - This plan defines its departures as D-3972 to D-3984, from the block the allocator issued to run 270 (3972–3991). Numbers 3985 and 3986 are not used by this plan.
  - **The worker's reserve is numbers 3987 to 3991.** Take them in order, and define each in `## Deviations found` in the commit that first cites it.
  - Never write any other number. Never call the allocator. Never land a `D-TBD-` spelling.
  - A code comment that a departure governs names its number.
- **Suites.**
  - Run in the foreground, one command per call, inside the package, with a timeout of at least 600000 ms: `./node_modules/.bin/vitest run test/<file>.test.ts`. Never bare `npx vitest`.
  - Run `npm ci` first wherever `node_modules` is absent (`agent/`, `server/`, `pwa/`; `typecheck-tests` spawns all three compilers).
  - `TMPDIR` and all scratch go on the ROOT disk (`$SCRATCH` under the session's scratchpad), never on the work volume (ledger, 2026-10-05 02:43).
  - **`-t` parts that cannot run hollow (T-4).** `-t` is a regex. A title with `(` or `|` in it selects nothing and exits 0 (measured: `-t "ccrc update: the supervisor sweep (Task 7 — R1, granted 2026-08-21)"` gives 505 skipped).
    - A file that runs past 600 s under load (`ccrc-doctor`, `ccrc-update`) runs in `-t` parts.
    - Each part's pattern is a paren-free substring or a regex-escaped title, never `file:line`. Write alternation as `|` or `[Dd]`, never `\|`.
    - Every part must report a non-zero `Tests N passed`.
    - The parts' patterns are disjoint: no case matches two of them.
    - The sum of the parts' PASSED counts equals the number of lines `./node_modules/.bin/vitest list test/<file>.test.ts` prints on this runner. `vitest list` omits `itDarwin`/`skipIf` cases. Each part reports the rest of the file as skipped, so its passed plus skipped is always the whole file's count, which proves nothing. Measured on vitest 4.1.10 with a probe of 3 cases plus 1 `skipIf` case: `list` printed 3 lines; `-t alpha` gave `2 passed | 2 skipped (4)` and `-t beta` gave `1 passed | 3 skipped (4)`, so only the passed counts sum to 3.
    - Instead of the sum, the worker may compare the union of the parts' passed titles from `--reporter=json` with `vitest list`'s titles.
    - A part that reports everything skipped, or zero tests, fails the gate.
- **No residue in tracked text:** no hostname, username, absolute home path, mount path, docserver URL or org name. Fixture ids are `demo-good`, `demo-gone`, `demo-a` … `demo-d`, `demo-z` (a gate target that never runs) and one 40-character `demo-` id (W7). Run `topology-clean.test.ts` after `git add` of each new file.
- **Commits.**
  - Commit on the workspace branch only, at least once per task, as `fix(update): …`, `test(update): …` or `docs(update): …`. Never use a separate feature branch.
  - Send the wave-done in the same turn as the push, and never end a turn to wait on CI.

## Review Focus

1. **The move INTO wave 11 is protected** (bar class: a stamped or purged deliberate stop under the OLD sweep and S11 returns non-zero).
   - Task 4 runs the frozen OLD sweep, sourced over this tree's `ccd/ccrc`, against this tree's script. A stamped stop and a purged stop return 0. An unstamped stop and a crash die as before.
   - R13(a)'s `LoadState` guard must not refuse a real reclaimed unit. Measured read-only on the live user manager (systemd 255.4): a never-existed id, an escaped id, `..` and 35 real purged ids all read `LoadState=loaded`.
2. **No LISTED crash passes the NEW sweep, and a crash-shaped unit is now listed** (D-3984).
   - Every listed unit is verified, and a failure never stops the rest (W3).
   - A unit that reads `activating` or `failed` after the restart is verified (W17).
   - A crash that persists through its re-check fails (W15, W3). A build that crash-loops every unit fails (W15, W17).
   - A job that recorded no result is never a pass: it gets its first verify in the foreground, then the same re-check (W13, W18b).
   - The script is called once per unit with ONE argument (W0, R1).
   - The die runs in the run's own shell (W5, the critic's I8).
   - An unstamped `inactive` still fails unless it is back by the re-check (ruling 3, W4).
3. **The re-check is exactly the ruling's** (D-3983).
   - Only a crash-like first failure is re-checked: a non-zero or unrecorded rc, and no `stopped on purpose:` line. A non-zero exit after such a line is not re-checked (W16).
   - The re-check is one single-argument call, in the foreground, with no rc file, after its batch.
   - Every re-checked unit is named on stderr, with its outcome (W14).
   - The 2026-10-04 22:06 shape passes on the re-check (W14).
   - Re-checks stop at the first that fails: a build that crash-loops every unit makes exactly one re-check call (W15, D8). The die gives the three counts.
   - A unit with no recorded result gets its first verify in the foreground and then the same re-check (W13, W18b).
   - An unreadable crash listing is said in one pinned line, never silently (W17c).
4. **The die never overwrites a report this run does not own** (W6, D3).
   - It still writes `failed` when the report is its own, absent or unreadable (`_upd_report_is_mine`'s rc-0 arms, unchanged).
   - Its 200-character report detail carries the count, "did not stay up" and "nothing was rolled back" on both arms, for any id length. The unit name comes after them, and the cap truncates only the name (W7, D6).
   - It names no backup (W8, D2).
5. **The sweep never leaves without a report because of its own launches** (P1), **and leaves nothing running** (T-1, P6).
   - A failed fork in the launcher subshell ends that subshell only. The units with no recorded result are verified one at a time (W18).
   - The exit path kills every unfinished job's process group (W11(c)).
6. **The Darwin arm samples every kicked job in ONE window and re-checks each failure once** (D1, D7).
   - `_ccrc_job_stayed_up`'s single-unit contract, which the gate and `_inst_enable` use, is byte-identical in its calls and its `CCRC_STAYED_DETAIL` (D4).
7. **The auth reader.**
   - No false ARMED on either feeder under any locale.
   - Every Linux verdict under any caller locale equals `main`'s under `LC_ALL=C` (Task 1's differential).
   - T4-M31, T4-M32 and T4-M33 still red (Task 1's table).
   - The Darwin plain test refuses exactly the measured thirteen names and nothing a canonical file holds (U5's controls).
8. **Containment and hygiene.**
   - No real tool can run (`assertContained` plus `assertNoRealTool`).
   - No `ccrc-sweep.*` scratch dir survives a run, passing, dying or TERMed (W11), and a stale one is removed at the next sweep's start (W19).
   - The fallback without a scratch dir runs today's foreground calls (W12).

## Risk notes

Each premise below is measured at `00f8a193` unless it says otherwise. Where a risk is kept on purpose, that is said.

- **Live state.** Both boxes run v0.0.84 since 12:36 (ledger 12:36), so the move into wave 11 is v0.0.84's OLD sweep with S11, which is protected. Nothing is halted.
- **A transient death right after the restart (attack F1; the 13:58 ruling).**
  - The shared window puts each unit's one exposure at 22–27 s after the restart. That is the hottest period measured: 3 exits in the first 120 s of 24 sweeps, against 0.25 expected.
  - Without the re-check, the 2026-10-04 22:06 sweep would have failed. With it, the unit's second call, 8 or more seconds later, finds it up and stable, and passes it. Its stderr line counts the event.
  - Kept as a risk, by the ruling: a unit that dies again inside its re-check window fails the update.
- **A swap the first tick dispatches (attack F2; reworded from the draft's "first-tick swap").**
  - A restarted supervisor runs `_auto_swap_check` on its first loop pass (`ccd/ccd:22044`). That only DISPATCHES a swap (`_dispatch_swap`, `:15904-15955`), which sleeps a random 0–120 s jitter (`SWAP_JITTER=120`, `:1346`) in a transient unit before `cmd_swap`'s `_svc_stop` stops the unit (`:24260`).
  - So a dispatch overlaps the 8 s window with probability about (8 + downtime)/121, and the re-check, 8 or more seconds later, gives the swap's carry a second chance.
  - `swap.log` shows 0 dispatches within 130 s of any of the 24 recorded sweeps, against a fleet rate of 0.36/h. No mitigation beyond the re-check, and ruling 3 is untouched.
- **The reload storm (attack F3).**
  - Each restarted supervisor's `systemctl --user enable` reloads the user manager (`ccd/ccd:882`, `:21947`), one reload after another, about 0.33–0.38 s each. Measured in every one of the 24 sweeps:
    - 71 units took 27 s (12:23:45 sweep: 71 "Reloading finished" lines, 12:23:45.9–12:24:13.0);
    - 62–71 units took 23–27 s, and 36–45 units 10–13 s.
  - The post-restart listing returns 21.6–24.3 s after the restart at 62–71 units, about 3 s before the storm ends. Method calls queue in order, so the verify's first reads wait at most the storm's tail.
  - At the 128 bound, the storm would run an estimated 45–49 s. That is reasoned, not measured.
  - A verify read that times out behind the storm prints a bus error, which is not `active`, so that unit's first call fails crash-like. Its re-check runs after the batch, by when the storm is over.
  - The bound stays 128 (13:58). `--no-reload` is wave-12 residue (Not in this wave).
- **Concurrency cost.**
  - **Stub-measured:** 65 concurrent units took 8.7–10.2 s wall at load 16–20, and 128 took about 10.5 s. The peaks were about 34 MB and 46 MB PSS for the verify processes and their children.
  - **Real-manager-measured** (attack, read-only): 168 concurrent `systemctl --user show -p MainPID --value` calls over 56 active supervisors finished in 257–383 ms, with no non-zero rc, at load 15. 58 and 128 concurrent jobs of 2 reads each finished in 0.23 s and 0.30 s at load 19, outside a storm.
  - The live headroom (attack P1): the transient unit's TasksMax is 37558, the user slice's pids.max is 82629 with 3346 in use, and `ulimit -u` is 125196. A 128-unit chunk is about 400 tasks.
  - The server's 15-minute deadline (`deadlineExpired`, `server/src/update/dispatch.ts:249`; `DEFAULT_UPDATE_DEADLINE_MS`, `server/src/config.ts:50`) is not approached by the window itself.
- **What the re-check costs (Reading 17, ruled: stop at the first failed re-check).**
  - **A broken build fails fast:** its first pass (one window), plus ONE re-check of about 3–8 s, since a crash-looping unit usually fails at its settle read. The server's deadline never decides it.
  - **The worst case is a storm in which many units fail their first pass and every one passes its re-check.** The re-checks are serial, so that costs about n × (settle + window): about 8 s per re-checked unit.
    - That is comparable to today's serial loop, measured live at 71 units in 10.5 min (about 8.9 s each, ledger 12:36).
    - Like today's loop, it nears the server's 15-minute deadline only past about 100 re-checked units.
- **A failed fork (attack P1).** bash cannot catch a failed `fork`: in the shell that forked, it prints `fork: Resource temporarily unavailable` and exits that shell, rc 254, with no die and so no `failed` report (measured on 5.2.21).
  - So the job launches run in a launcher SUBSHELL (`( _upd_sweep_launch … )`), and a failed launch ends only that subshell.
  - The sweep then kills the jobs the launcher did start, warns, and verifies each unit with no recorded result in the foreground (W18).
  - The run's own remaining forks are the same handful every phase of `cmd_update` makes. If those fail, no bash code can write a report either, because writing one forks `date`, `jq` and `mv`. The server's deadline then decides it, and on a server/both box the watchdog does.
  - The replay uses builtins only (`_upd_sweep_replay`), so a captured file costs the run no fork.
- **Signals and leftovers (attack P4, P6, T-1).**
  - A unit stop (the detached unit, or `ccrc-update-watchdog.service`'s `TimeoutStartSec=1800`) sends one SIGTERM to every process in the cgroup. One SIGTERM to the sweep's pid alone also runs the exit chain.
  - The exit chain then runs `_upd_sweep_kill` and removes the scratch dir. Measured on the prototype: 0 survivors and no dir left. Without the kill, 5 processes carrying the box's HOME survived (W11(c)).
  - **Only SIGKILL, or a kernel OOM kill of the sweep, leaves a dir.** It lands in `${TMPDIR:-/tmp}` (TMPDIR unset: `/tmp`, on the root disk, measured), outside `ccd-tmp-sweep`'s reach (`ccd/ccd:20130`), at a few KB per unit.
  - The next sweep removes every `ccrc-sweep.*` dir whose recorded owner pid is gone, before it makes its own (W19).
  - A job left by a SIGKILLed sweep ends on its own within about 20 s. It is read-only.
  - The kill is by process group: each job is its own group (`set -m` in the launcher), so a group kill takes the job, its verify and the verify's own children (measured).
  - **Each job is signalled at most once, and only while its own chunk is in flight** (verify L1, W20).
    - The kill skips a job that recorded a result (`.rc`), a job whose chunk's results were read (`.done`) and a job already signalled (`.killed`). It refuses a pid of 1 or less.
    - Without those markers, the verify measured the same three groups TERMed twice: once by the failed launcher's arm, then again by the exit chain on a SIGTERM during the foreground verify.
  - **One narrow case remains.** A job of the chunk in flight can end without writing its `.rc`, on a disk that cannot take the file. If the system reuses its number before the chunk's results are read, the kill can signal that number once.
    - A marker that cannot be written leaves its job signalable again.
    - The verify's box has pid_max 4194304, so a reuse within one chunk is remote there.
- **`set -m` in the launcher prints job notices** (`[1]+ Done …`) on the launcher's stderr. That stream goes to `$vdir/launch.err`, which is replayed only when the launcher fails.
- **`LoadState` on the live USER manager (attack F5).** The probe was `systemctl --user show`, read-only, on systemd 255.4-1ubuntu8.17:
  - a never-existed id reads `LoadState=loaded`, `ActiveState=inactive`, `SubState=dead`, MainPID 0, with the user template as `FragmentPath`;
  - `claude-session@demo\x2dgood.service` and `claude-session@..service` read `loaded`;
  - `claude-session@.service` gives rc 1;
  - 35 real ids stopped since 2026-09-29, absent from `list-units --all` and with no `.uuid` (e.g. one reclaimed since today's 12:24 verify), all read `loaded inactive dead disabled`.

  The draft's system-manager measurement is consistent with this:

  | Input | `is-active` | `show -p LoadState --value` | `list-units --all` |
  |---|---|---|---|
  | an instance that never existed | `inactive`, rc 3 | `loaded` | absent |
  | enabled, then `disable --now`, then GC'd | `inactive`, rc 3 | `loaded` | absent |
  | `claude-session@demo\x2dgood.service` | — | `loaded` | — |
  | `claude-session@..service` | — | `loaded` | — |
  | `claude-session@.service` (the template itself) | — | an error, rc 1, nothing on stdout | — |
  | `claude-session@*.service` (a glob) | — | empty | — |
  | `claude-session@a/b.service` | — | an error on stderr, then `loaded` for the escaped name | — |
  | no template installed | rc 4 | `not-found` | — |
  | a masked instance | — | `masked` | — |
  | a start-limit crash loop | `failed` | — | — |
- **The crash-shaped listing (D-3984), measured** on systemd 255.4 (a throwaway `ubuntu:24.04` system-manager container, `docker run --rm`, image removed after).
  - `list-units 'claude-session@*' --state=activating,failed --plain --no-legend` printed a crash-looping instance as `loaded activating auto-restart`, and the same instance, once its start limit was spent, as `loaded failed failed`.
  - It printed neither an active instance nor a stopped one. The ACTIVE word is the third field.
- **R13(a) cannot close the "never-existed id" input.** It reads `loaded`. It stays unreachable: both sweeps verify only units their own listings showed active, or crash-shaped after having been active (D-3984). No registry fact tells it from a purged row, because D-2605's purge removes `.generation` last and keeps nothing: 0 of 35 purged ids hold one, measured.
- **Darwin is measured on Linux only.** Tasks 2 and 7 run their cases by sourcing `ccd/ccrc` with `CCD_OS=darwin` set after the `.`, which reaches the Darwin arms on every runner. Two `itDarwin` cases (E20d, D5d) run only on `test-macos`, and the coordinator reads them there.
  - Task 2's thirteen names were measured on bash 3.2.57 (`docker run --rm bash:3.2`, a musl build) and on bash 5.2.21 (host), and re-measured by the attack over 97 names × 4 values × 3 modes. Apple's `/bin/bash` 3.2.57 build was not measured.
- **Task 2's measurement**, the launchd job's own line shape (`set -a; [ -f e1 ] && . e1; [ -f e2 ] && . e2; set +a; exec /usr/bin/env …`), each name as `NAME=0`, plain and after `POSIXLY_CORRECT=1`:
  - **plain mode:** no name stops the job. The six read-only names print `readonly variable` and carry on, and `CCRC_AUTH=on` still lands;
  - **POSIX mode, bash 5.2:** the job ends (rc 127, before `exec`) on the six read-only names `BASHOPTS`, `BASH_VERSINFO`, `EUID`, `PPID`, `SHELLOPTS` and `UID`;
  - **POSIX mode, bash 3.2:** on `BASH_VERSINFO`, `EUID`, `PPID`, `SHELLOPTS` and `UID`, and, SILENTLY, on six names that are NOT read-only: `BASH_ARGC`, `BASH_ARGV`, `BASH_LINENO`, `BASH_SOURCE`, `FUNCNAME` and `GROUPS`;
  - an EMPTY `POSIXLY_CORRECT=` turns POSIX mode on too (bash 3.2);
  - a read-only assignment placed BEFORE `POSIXLY_CORRECT` is not fatal;
  - `BASH_COMPAT=0` and `BASH_XTRACEFD=0` print an error and carry on;
  - `PATH=0` breaks `/usr/bin/env node`'s lookup in every mode. That is a misconfiguration, not a reserved name, so it is not refused;
  - a UTF-8 `LC_ALL=` assignment in `ccrc.env` changes nothing about how either bash parses the exposure file.
- **R14(f) changes some Linux verdicts, under a UTF-8 caller only.** This is the point, and D-3979 says so. The attack's differential: 6,000 file pairs against a port of systemd v255's `EnvironmentFile=` parser.
  - The tip under `C`, `C.UTF-8` and `en_US.UTF-8` equals `main` under `C` in 6000 of 6000 pairs, with 0 wrong decided answers.
  - `main` under UTF-8 had 7 false ARMED, 83 false OFF and 17 other wrong values. Those are now gone.
  - A few UTF-8 verdicts move from a value that was right by accident to rc 3 (fail-closed): a key line hidden behind a comment ending in a lone lead byte. That was 2 of 3000 pairs in one corpus and 39 of 3000 in the other. None moves to a wrong decided value.
  - Every existing pin runs under `LC_ALL=C`, so no existing case moves.
- **The pin's placement is load-bearing for wave 9's T4-M31, measured.** Any `LC_ALL=C` in `_box_unit_env` above the Darwin dispatch masks T4-M31: R14(g)'s input under `C.UTF-8` reads rc 3 with that mutation applied. That holds whether it sits on its own line or as a token on the first `local` line. So the pin goes after the dispatch, and U4p refuses any `LC_ALL` token above it.
- **The rollback flip leaves `UPD_BACKUP_DIR` empty.** `_upd_backup` has one caller in the update path, `cmd_update` (`ccd/ccrc:16812`). So on the flip path the old die read "The pre-update backup is complete at " with nothing after it. That is one more reason for D-3974.

## Deviations found

These are departures from the ledger's rulings, or from what shipped text at `00f8a193` documents.

- **D-3972** — *The sweep's verify: concurrent per-unit calls, in chunks; every unit; output replayed; a launcher subshell and an exit-path reaper; a foreground fallback.*
  - **Shipped:**
    - `_upd_sweep`'s Linux arm verifies serially, and its first failure ends the verify: `bash "$verify" "$u" \ || _ccrc_die "…"` (`ccd/ccrc:20963-20968`).
    - The comment above it says "Each restarted supervisor is held to the same standard as the services the staged install just verified" (`:20943`).
  - **The ruling** (2026-10-04 22:56) is "one shared window, by concurrent per-unit calls rather than a new multi-unit argument".
  - **The departures:**
    - (a) The calls run in chunks of at most `CCRC_SWEEP_VERIFY_JOBS`, which defaults to 128 and admits only `^[1-9][0-9]{0,3}$` (anything else reads as 128). So a fleet above 128 units gets ceil(N/128) windows, not one. The bound is ruled (13:58).
    - (b) Every listed unit is verified, a failure included, so the die can name how many failed and which came first.
    - (c) Each unit's stdout and stderr are captured to files and replayed in listing order once its chunk ends, by builtins (no fork). So the transcript appears per chunk, and two dumps never interleave.
    - (d) Pass is decided by an rc FILE each job writes. A missing, empty or non-numeric rc is UNRECORDED, never a pass. That unit gets its first verify alone, in the foreground, with the same re-check rule as every other unit (13:58, Reading 18). So a disk that fills mid-sweep, or a launcher that dies, cannot fail a healthy fleet (F7, P1).
    - (e) The jobs are started by `_upd_sweep_launch` inside a subshell, each in its own process group (`set -m`), each with its pid recorded. A failed fork ends the subshell, never the run (P1).
    - (f) `_upd_sweep_kill` TERMs the process group of each job of the chunk in flight that recorded no result. The run's exit chain runs it, then removes the dir (T-1, P6), and so does the arm for a failed launcher.
      - Each job is signalled at most once (verify L1). Each job gets a `.done` marker once its chunk's results are read, and a `.killed` marker once it is signalled. Both are builtin writes.
      - A pid of 1 or less is refused.
    - (g) A sweep first removes any `ccrc-sweep.*` dir whose recorded owner pid is gone (P4).
    - (h) With no scratch dir (`mktemp -d`, or the owner write, fails), the units are verified exactly as the old loop verified them: one `bash "$verify" "$u"` at a time, in the foreground, on the run's own streams (P5). Only the verdict differs from before: every unit is verified, and the re-check applies.
    - (i) A new environment knob, overridable for the reason `SETTLE`/`WINDOW` are.
  - The script is still resolved through `$BOX_TREE_DIR` at call time, and still called with one argument, so every pairing in the table above holds.
  - (e)'s launch is changed by D-3988: the launcher subshell is asynchronous, not the sweep shell's foreground child.
- **D-3973** — *The sweep's die checks report ownership.*
  - **Shipped:** `_ccrc_die`'s header: "the same die is also the run's `failed` report (design §10): the ONE hook, so no die site carries a report call of its own" (`ccd/ccrc:2338-2340`).
  - **Why it matters:** both callers release the lock before the sweep (`ccd/ccrc:17133-17136`, `:17656-17658`), so a second update may own `update.json` when a supervisor fails.
  - **The change:** every die in `_upd_sweep` now goes through `_upd_sweep_die`. It clears `UPD_REPORTING`, with one stdout line saying so, when `_upd_report_is_mine` answers rc 1 (the report POSITIVELY names another pid). Then it calls `_ccrc_die` unchanged.
  - Absent, unreadable and malformed reports still get `failed`, as `_upd_report_is_mine`'s own header requires.
  - The skip line follows the two callers' closing-write skip lines (`ccd/ccrc:17166`, `:17673`).
- **D-3974** — *The sweep die's wording and its report detail: facts first, then the unit.*
  - **Shipped:**
    - the Linux die "`$u was restarted and did not stay up — read: systemctl --user status $u. The pre-update backup is complete at $UPD_BACKUP_DIR`" (`ccd/ccrc:20966`);
    - the Darwin twins (`:20868`, `:20881`);
    - the Darwin comment "this is the one line in the whole update path that points an operator at the backup, and on macOS it must be able to fire" (`:20877-20878`);
    - the `itDarwin` case "naming the pre-update backup" (`server/test/ccrc-update.test.ts:2973-2983`).
  - **Why change it:** no path restores that backup once the sweep runs. The install completed, and the gate passed, or never ran under `--no-gate`. On a rollback flip `UPD_BACKUP_DIR` is empty.
  - **The new detail** carries the ruled three counts (Reading 17): `sweep: <k> of <n> supervisors did not stay up on a first verify; a re-check failed, <m> left un-re-checked — install complete, nothing was rolled back (first failed re-check: <unit>); read: systemctl --user status <unit>`.
    - Darwin's says `launchd session jobs did not stay up on a first window`, and carries the job's pid detail after the unit name.
    - A non-crash-like failure has `sweep: <j> of <n> supervisors exited non-zero after a 'stopped on purpose' line, never re-checked — install complete, nothing was rolled back (first: <unit>); …`.
  - **Measured against `_upd_json_str`'s cut** (`ccd/ccrc:18422`; the critic's M1, attack P3): the facts end at character 144–150 on Linux and 153–159 on Darwin, for counts from `1 of 1` to `136 of 136` and any id length. So the 200-character cap truncates only the unit name and the remedy, never the facts.
  - The full sentence goes to stderr, and every re-checked or un-re-checked unit gets its own stderr line.
- **D-3975** — *The Darwin arm: one in-process shared window, a re-check, and still no classifier.*
  - **Shipped:**
    - `_ccrc_job_stayed_up() {   # <unit> -> 0 iff ONE pid held across the window` (`ccd/ccrc:20804`), called once per kicked job (`:20879-20882`);
    - the arm's header "Same job, same guard, different observable" (`:20815`);
    - D-3949 says wave 11 "rewords them together with the Darwin arm".
  - **Now:**
    - `_ccrc_job_stayed_up <unit>...` settles once, reads every job's pid, waits one window and reads every pid again, in this process. Launchd has no script to skew against a rollback flip, so no concurrency is needed.
    - With one unit, its calls and `CCRC_STAYED_DETAIL` are byte-identical (attack P5 checked both callers), so the gate (`:19684`) and `_inst_enable` (`:14638`) are unchanged.
    - Each job that failed the window is re-measured once, alone, until one re-check fails (D-3983; Reading 17).
    - The arm still has NO deliberate-stop classifier (Reading 1).
  - **Why no classifier:** launchd's observable for a deliberate bootout (`_svc_disable_now`) is also the start-limit emulation's (`.svcfailed`). A classifier would need a second registry read, and macOS boxes are not centrally managed.
  - D-3949's comments now say exactly that difference instead of "the same standard".
- **D-3976** — *R13(a): the purged arm now asks systemd one more question.*
  - **Shipped:** D-3946 describes the classifier's reads as "one directory test, `-e <id>.stopped`, `-e <id>.uuid`, and one guarded one-line read of `<id>.stopped`". V17 and X4 pin a purged unit's call log as `is-active` twice and nothing else (`agent/test/deploy-verify.test.ts:2543-2552`, `server/test/ccrc-sweep-deliberate-stop.test.ts:331-344`).
  - **Now:** before the purged arm passes, `ccd_id_ok` must accept the id, and `systemctl --user show -p LoadState --value "$UNIT"` must read exactly `loaded`. That adds one query, made only when `<id>.uuid` is absent, so an unstamped stop's log (V5, X3b) is unchanged.
  - **The grammar** is ccd's `^[A-Za-z0-9._-]+$` (`ccd/ccd:8751`), spelled with its alphabets written out, as `_svc_real_home` spells its own (`ccd/ccrc:796`). A range is collation-dependent: `[[ démo =~ ^[A-Za-z0-9._-]+$ ]]` matches under glibc's `en_US.UTF-8` (measured), and the script runs in its caller's locale.
  - All 126 live registry ids and 56 active unit ids pass it (attack P1's measurement, read-only), so S11 refuses no live purged id by name.
  - `LoadState=loaded` is measured on the live user manager for 35 real purged ids (Risk notes).
- **D-3977** — *R13(a), wider than ruled: a leading `.` is refused.* `claude-session@..service` (id `.`) passes both ruled guards: the grammar admits `.`, and systemd reads it `loaded` (measured, system and user manager). ccd ids are `<account>-<project>`, and `_ws_project_valid` refuses a leading dot at creation (`ccd/ccd:6429`). So `ccd_id_ok` refuses one. It only narrows a pass, and closes the last of review 263 F2's named-unit inputs.
- **D-3978** — *R13(a), wider than ruled: a symlinked `<id>.uuid` is not a purged row.*
  - The purged test was `[ ! -e "$reg/$id.uuid" ]`. `-e` follows a link, so a dangling symlink read as purged (review 263 F2, measured).
  - It becomes `[ ! -e … ] && [ ! -L … ]`. Something sits at the name, so the row is not gone.
- **D-3979** — *R14(f): the Linux `unit`-mode reader now reads bytes, which moves some Linux verdicts under a UTF-8 caller.*
  - **Shipped:**
    - D-3833: "Found and NOT changed (round 2's bar forbids changing a Linux verdict): `unit` mode's own line loop (Linux) also reads in the caller's locale …" (wave 9's plan `:364`);
    - D-3822: "Round-2 ruling R-A leaves this mode as it was";
    - U4u's F2 row is Darwin-only "for that reason" (`server/test/ccrc-doctor.test.ts:4096-4099`).
  - **Now:** `_box_unit_env` declares `local LC_ALL=C` after its Darwin dispatch (Task 1).
  - **The property:** every Linux verdict under any caller locale equals `main`'s under `LC_ALL=C`, which is what systemd's byte-wise parser reads.
  - Under a UTF-8 caller, that moves every wrong decided value (a false ARMED, a false OFF, another wrong value) to the right answer or to rc 3. It also moves a few verdicts that were right by accident to rc 3 (fail-closed): a key line hidden behind a comment ending in a lone lead byte. **No verdict moves to a wrong decided value** (attack A4: 6,000 pairs against a systemd v255 port).
- **D-3980** — *R14(j): the Darwin plain test refuses thirteen names, under a new cause.*
  - **Shipped:**
    - D-3822's rule admits any `NAME` matching `[A-Za-z_][A-Za-z0-9_]*` (`ccd/ccrc:2854`);
    - `BEP_CAUSE` is documented as `nul | cr | shape` (`:2947`, and `_box_env_shell_plain`'s header `:2833-2840`).
  - **Now:** a line assigning `POSIXLY_CORRECT`, `BASHOPTS`, `BASH_VERSINFO`, `EUID`, `PPID`, `SHELLOPTS`, `UID`, `BASH_ARGC`, `BASH_ARGV`, `BASH_LINENO`, `BASH_SOURCE`, `FUNCNAME` or `GROUPS` fails the file with `BEP_CAUSE=name`.
  - `_box_unit_env_shell` words it on its own `name)` arm, naming the cause and the line number, never the variable or the bytes (attack A1). It does not call all thirteen read-only: six are bash's read-only variables, six are names bash 3.2's POSIX mode will not assign, and one is `POSIXLY_CORRECT` itself (A5).
  - **The set is the measured one** (Risk notes; the attack re-measured it over 97 names and found it exact). Refusing both halves keeps the rule order-free and file-free.
- **D-3987** — *R14(j) widened: `HISTCMD` and `OPTIND` join the refused names (coordinator ruling 2026-10-05, mail 3558, option A).*
  - **Shipped:** D-3980's set is thirteen names, all of which stop the launchd job's bash only inside POSIX mode.
  - **Now:** a line assigning `HISTCMD` or `OPTIND` fails the file with `BEP_CAUSE=name`, like the thirteen. They are integer variables with no assign function, so a value that is an arithmetic error (`1/0`, `09`, `1+`, `a.b`) ends the job's non-interactive bash with rc 1 before its `exec` in bash 3.2.57, 4.4 and 5.2.21, without POSIX mode, while doctor on macOS read rc 0 `on` and called the gate ARMED (review of Task 2, F1).
  - **Why by name:** refusing the name keeps the rule order-free and file-free, whatever the value. Option B, an arithmetic grammar for the value, was rejected as a second parser. This widens Reading 10's set to fifteen names.
  - `_box_unit_env_shell`'s `name)` reason still names the cause and the line number, never the variable, and does not call them all read-only. The read-only count in the comment is worded by version: five of the set in bash 3.2 (`BASHOPTS` arrived in 4.1), six in 5.2.
- **D-3981** — *Two committed plans are amended in place* (wave 9's D-3830 precedent). Each amendment is marked `(wave 11, R…)`:
  - wave 10's Task 1 summary sentence (R13e), `docs/superpowers/plans/2026-10-04-centralised-update-w10-verify-deliberate-stop.md:11`, brought to its Global Constraint (`:134`);
  - wave 9's D-3833 measurement bullet (R14h), `docs/superpowers/plans/2026-10-02-centralised-update-w9-stable-readiness.md:362`, reworded from a corpus count to the property. The same entry's "Found and NOT changed" bullet (`:364`) gains a pointer to D-3979.
- **D-3982** — *Two frozen copies of shipped code live in the test tree, on purpose, and the helpers one of them calls are pinned by hash.*
  - CLAUDE.md's single-source rule enumerates a fact once. `server/test/fixtures/upd-sweep-pre-wave11.bash` and `server/test/fixtures/verify-service-pre-wave10.sh` are second copies of `_upd_sweep` and of `verify-service.sh`, by design. They are the exact bytes older releases run: the OLD sweep is the move INTO wave 11, and S0 is a rollback to v0.0.79 or older.
  - Each is pinned to its released digest (X0, R0) and never edited.
  - The OLD sweep runs on this tree's `_ccrc_die`, `_upd_redact`, `_upd_phase`, `_upd_json_str`, `_tmp_guard`, `_exit_add` and `_exit_run`, which are identical at v0.0.60, v0.0.78, v0.0.84 and `main` (measured). X0c pins their digests (T-8), so a later edit to one reds X0c instead of silently testing a mix no box runs.
  - Neither copy sits under `single-definition.test.ts`'s roots (`shared`, `server/src`, `pwa/src`, `agent/src`) or its bash roots (`ccd`, `deploy`, plus `install.sh`), so no scan counts them.
  - Retire both, with their cases, once no box can run a pre-wave-11 sweep or a pre-wave-10 script (wave 10's Reading 2).
- **D-3983** — *The operator's re-check (13:58, "Re-check once"), which supersedes ruling 6 for wave 11.*
  - **Shipped:**
    - Ruling 6 of 2026-10-04 22:56 is "one pane death inside the window, which reads as MainPID churn, still fails in waves 10 and 11".
    - The verify script's own WHY block repeats it ("one pane death that a check observes still fails", `deploy/verify-service.sh:95`, `:103`). The script keeps that meaning per call; this departure is the sweep's.
  - **Now:**
    - A unit whose first verify fails crash-like gets ONE more call, `bash "$verify" "$u"`, one argument, in the FOREGROUND on the run's own streams, with no rc file, after its batch. The update fails for that unit only if that call fails too.
    - **Re-checks stop at the first that fails** (13:58, Reading 17). Once one has failed, the update fails, and no later crash-like unit is re-checked. Each of those is counted and named on stderr instead. A re-check that passes goes on to the next.
    - **A unit with no recorded result** (its launcher failed, or its rc could not be written) gets its first verify alone, in the foreground. A crash-like failure of that call is re-checked by the same rule (13:58, Reading 18).
    - Crash-like means the first call's rc is non-zero, or was not recorded, and its captured stdout holds no `stopped on purpose:` line. No shipped script prints that line before a non-zero exit, so in practice every non-zero exit is crash-like. A unit that broke this would fail with no re-check (W16).
    - On the no-scratch fallback, and for a unit with no recorded result, the first call is not captured, so every non-zero first call there is crash-like.
    - Every re-checked unit is named on **stderr**, before and after, with its outcome: `update: sweep: re-check: <unit> …`. The swap and death rate stays countable from the journal.
    - The Darwin arm does the same with `_ccrc_job_stayed_up "$u"` (D-3975).
  - **Why:** the measured F1 shape (Risk notes). The serial loop already passed a unit that recovered before its own window, and the re-check gives the shared window the same chance once.
- **D-3984** — *Units that read crash-shaped after the restart are verified, not only warned about (13:58, attack F4).*
  - **Shipped:** wave 8 item G only warns about a unit that "was active before try-restart and is not active after it — this sweep did not verify it" (`ccd/ccrc:20972-20980`). The verify set is the `--state=active` listing alone (`:20950`). So a build that crash-loops every unit, none of them `active` at the listing, could end `done`.
  - **Now:** when a verify script exists and a pre-restart-active unit is missing from the active listing, the sweep reads one more listing: `systemctl --user list-units "claude-session@*" --state=activating,failed --plain --no-legend`, measured on systemd 255.
    - A missing unit that it shows as `activating` or `failed` joins the verify set, with the re-check, and gets one stderr line naming its word.
    - Anything else missing (`inactive`: a deliberate stop; or gone) keeps item G's warning.
    - If that listing cannot be read, the sweep says so in one pinned line (13:58, Reading 19): "the crash listing was not measured, so a crash-looping supervisor among the units missing from the active listing is only warned about below — none of them is verified or claimed healthy". Then every missing unit keeps item G's warning. Like wave 8's D-3599, an unmeasured listing claims nothing.
    - When nothing is missing, the listing is never issued, so `ccrc-update.test.ts`'s argv-order pin is unchanged.
- **D-3988** — *A signal during the sweep's concurrent batch aborts the run, and stops every verify job the launcher started (coordinator ruling 2026-10-05, mail 3565; review of Task 6; fix round 2, mail 3575).* **It changes D-3972 (e)'s launch:** the launcher subshell is no longer the sweep shell's foreground child but an asynchronous one that the sweep shell `wait`s on.
  - **The regression:** `_upd_sweep_launch`'s `set -m` puts every verify job in a group of its own, so an INT never reaches a job, and the launcher ran as the sweep shell's FOREGROUND child. Bash runs a shell's own trap only after its foreground child returns, and drops an INT whose child did not die of INT. So an INT that reached the sweep shell alone waited out the whole batch (about 8 s on a real verify) and the run went on to `SWEEP_OK`, rc 0. On the serial sweep an INT killed the foreground `bash verify`, and the run ended in under a second. A TERM sent to the sweep shell alone was swallowed the same way (measured: 32 of 36 runs).
  - **The ruling:** D-141's class: an operator's Ctrl-C must abort (`cmd_passwd`'s header). A signal during a concurrent batch ends the run by that signal, never `SWEEP_OK`, with the jobs TERMed through `_upd_sweep_kill`, each at most once, 0 survivors, and the scratch dir removed.
  - **Round 1 (26d3a4d70):** the launcher runs in the background, the sweep shell waits on it under an INT trap that TERMs the launcher and re-raises INT on itself. Review found a leak: a signal that lands during the launch loop TERMs the launcher between forking job k and writing `k.pid`, so the exit chain never sees job k.
  - **Round 2, what this round added:**
    - A STOP FILE, `$vdir/stop`, which the launcher reads at the top of each loop iteration (it forks no more once it is there). `$vdir/looped` says the loop is over; past it the launcher only waits for its jobs.
    - `_upd_sweep_stop <vdir>`, run by the INT handler and first in the exit chain: it creates `stop`, TERMs the launcher only if `looped` exists, and WAITS for it. The wait is bounded: a launcher still in its loop ends after at most one fork and one `.pid` write, and a launcher past it is TERMed, so no job's pid is unrecorded when `_upd_sweep_kill` looks. The launcher's pid is `$vdir/launcher.proc` (not `*.pid`, which `_upd_sweep_kill` would signal), written after the launch and truncated after the reap, so a stale pid is never signalled.
    - The INT handler re-raises (`exit 130` would read as a failed launcher), saves the caller's INT trap and puts it back, and `lpid` is reset per batch.
    - **Why a file and not a TERM trap in the launcher** (the shape first approved): a trap is inherited as a caught handler by each job's subshell and by the `bash` it forks, for the instant before bash resets it, and a TERM that lands then is lost (measured). The trap shape leaked in every shape (5 to 8 runs in 24, and 18 in 36 for a TERM to the sweep shell, against 4 in 36 on the foreground launcher). The stop file has no handler to inherit. A job's `SigCgt`/`SigIgn` equal the foreground launcher's in both builds (measured).
  - **What it does not change:** no verdict moves without a signal, so every W and R case is unchanged. A TERM sent to the sweep's process GROUP still TERMs the launcher itself at a random point of its loop; a job forked in the instant before its `.pid` write can be lost (measured: 30 runs in 96, against 28 in 72 on the foreground launcher). That is residue, not closed. W21 pins the other shapes.

## File structure

**New**
- `docs/superpowers/plans/2026-10-05-centralised-update-w11-sweep-window.md` (this plan).
- `server/test/sweepFixture.ts` (Task 4): the sweep fixture builders, moved out of the cross-version file and extended. It is a non-test module, because importing a `.test.ts` registers its cases twice.
- `server/test/fixtures/upd-sweep-pre-wave11.bash` (Task 4): the OLD sweep, frozen.
- `server/test/fixtures/verify-service-pre-wave10.sh` (Task 6): S0, frozen.
- `server/test/ccrc-sweep-window.test.ts` (Task 6): the NEW sweep's cases and the rollback pairings.

**Changed**
- `ccd/ccrc`:
  - `_box_unit_env` (`:2968-3018`) and its header (Task 1);
  - `_box_env_shell_plain` (`:2841-2864`) and its header, the `BEP_CAUSE` comment (`:2947`), and `_box_unit_env_shell`'s reason `case` (`:3051-3061`) (Task 2);
  - five new helpers above `:20813`, and `_upd_sweep`'s Linux verify block (`:20943-20968`) (Task 6);
  - `_ccrc_job_pid`'s twin header (`:20789-20795`), `_ccrc_job_stayed_up` (`:20804-20812`), and `_upd_sweep`'s Darwin header and stay-up block (`:20815-20828`, `:20866-20882`) (Task 7).
- `deploy/verify-service.sh` (Task 5): the WHY block (`:71-109`, below the pinned lines), a new `ccd_id_ok` above `stopped_on_purpose`, and the purged arm (`:135-136`).
- `deploy/deploy.sh` (Task 8): `:986`, one comment line, in place.
- `agent/test/deploy-verify.test.ts` (Task 5): `stubs()` and `sweepStubs()` answer `show -p LoadState --value`; V2's title and V17's call log; the new V23–V30.
- `server/test/ccrc-sweep-deliberate-stop.test.ts` (Tasks 4–5): re-homed onto `sweepFixture.ts` and the frozen sweep; the header cites by content; X0, X0b, X0c; X4's log.
- `server/test/ccrc-update.test.ts` (Task 7):
  - the `launchctl` stub's per-label churn knobs (`:383-386`);
  - D0–D4 and D6–D8 beside G1c-direct (`:2925`);
  - the `itDarwin` churn case's assertions (D5d, `:2973-2983`).
- `server/test/ccrc-doctor.test.ts` (Tasks 1–2): U4U (`:4100-4106`) and U4u (`:4108-4125`); the new U4p, U5, U5l and E20d; the comments at `:3591` and `:8384`, re-pointed by content.
- `server/test/ccrcContainment.ts` (Task 1): the `:13` comment's `:3295`, re-pointed by content.
- `server/test/platform-hazards.test.ts` (Task 3): one new describe.
- `docs/superpowers/plans/2026-10-04-centralised-update-w10-verify-deliberate-stop.md:11` and `docs/superpowers/plans/2026-10-02-centralised-update-w9-stable-readiness.md:362`, `:364` (Task 8; D-3981).

**Changed only on a condition:**
- `server/test/session-hook.test.ts`: only if S6-R11 finds that `byFile` moved after Task 1, 2, 6 or 7. The change is then a composition comment beside the `'ccd/ccrc'` entry, never a number changed to make it green (Global Constraints). Otherwise the file is run, not edited.

**Run, not edited:**
- the agent suite in full;
- `ccrc-install`, `ccrc-cli`, `ccrc-containment`, `ccrc-uninstall`, `ccrc-install-graphify`, `ccrc-versioned-audit`, `build-release`;
- `single-definition`, `runbook-holds`, `session-hook`, `macos-platform`, `typecheck-tests`, `topology-clean`, `dtbd`, `deviation-refs`.

## Tasks

### Task 1: R14(f) first, then (g): the Linux reader reads bytes; the plain test's own loop is pinned under UTF-8

**Files:** `ccd/ccrc` (`_box_unit_env` and its header), `server/test/ccrc-doctor.test.ts` (U4U, U4u, the new U4p), `server/test/ccrcContainment.ts` (one comment).

**Safe under:** no pairing. Doctor and install's gate line run the tree they ship in.

**Interfaces and code.** Insert this directly below `if [ "${CCD_OS:-linux}" = darwin ]; then _box_unit_env_shell "$key"; return; fi` (`ccd/ccrc:2971`), and nowhere above it:
```bash
  # Wave 11 R14(f) (D-3979): the Linux arm reads BYTES, as systemd's EnvironmentFile= parser does. In the caller's
  # UTF-8 locale `unit` mode's `read` took a line ending in an incomplete UTF-8 sequence and the newline after it as one
  # character, so a comment swallowed the key line below it — a false ARMED or a false OFF. Declared HERE, after the
  # Darwin dispatch and never above it, in no spelling: a pin above it would cover `_box_unit_env_shell` too, and that
  # arm's own `LC_ALL=C` (D-3833) would stop being load-bearing — T4-M31 would no longer red (measured). U4p pins it.
  local LC_ALL=C
```
- It reaches the `$(_box_env_value … unit)` subshells, `_box_env_unit_whole` and `_box_env_qopen` by bash's dynamic scope. Review 269 and the attack measured that `local LC_ALL=C` takes effect mid-function and is restored on return, on bash 5.2.21 and 3.2.57.
- `_box_unit_env`'s header Linux line (`:2960`, "Linux  systemd's `EnvironmentFile=` — `_box_env_value`'s `unit` mode. …") gains ", read byte-wise (D-3979)".

**The cases** (in the `describe` that holds U4, U4u and U4n):
- **U4U** is restructured so each row states its answer per feeder: `[label, ccrc.env, exposure file | null, { darwin?: Want; linux?: Want }]`. `Want` is one of:
  - `{ rc: 3; nul: true }`: today's NUL arm;
  - `{ rc: 3; line: number }`: `BUE_WHY` starts with `<exposure path> line <n> is not a plain NAME=value line`;
  - `{ rc: 0; val: string; src: 'env' | 'exp' }`.

  A feeder absent from a row is not asserted for it, and the comment says why.

| # | Row | ccrc.env | exposure file | darwin | linux |
|---|---|---|---|---|---|
| F1 | a lead byte right before the NUL (today's) | `CCRC_AUTH=off\n` | `# caf\xc3\0\nCCRC_AUTH=on\n` | rc 3, NUL | rc 3, NUL |
| F1b | the NUL as the last byte, after a lead byte (today's) | `CCRC_AUTH=off\n` | `CCRC_AUTH=on\n#\xc3\0` | rc 3, NUL | rc 3, NUL |
| F2 | a comment ending in a lone lead byte keeps its newline (today's row, **now both feeders**, R14f) | `CCRC_AUTH=on\n` | `# caf\xc3\nCCRC_AUTH=off\n` | rc 0 `off` exp | rc 0 `off` exp |
| L1 | the same merge in ccrc.env: a false OFF (R14f) | `# caf\xc3\nCCRC_AUTH=on\n` | null | rc 0 `on` env | rc 0 `on` env |
| G1 | the plain test's own line loop (R14g, review 269 F1) | `CCRC_AUTH=on\n` | `# caf\xc3\nunset CCRC_AUTH\n` | rc 3, line 2 | rc 0 `on` env (systemd ignores a line with no `=`) |

- **U4u** keeps its title stem, its `utf8Locale()` and its exit-7 proof. It FAILS, never skips, when no UTF-8 locale takes effect.
  - Its comment block (`:4093-4099`) is rewritten to say three things: the F2 row is no longer Darwin-only; `unit` mode reads bytes since D-3979; G1 is the input review 269 measured giving a false ARMED under the "relocated pin" mutant.
- **U4p** (new, all platforms): a structural pin on the placement, robust to any spelling (attack A3).
  - From `CCRC_SRC`, `/_box_unit_env\(\) \{([\s\S]*?)\n\}/` must match. Call its body `body`, and the dispatch's index `d = body.indexOf('_box_unit_env_shell "$key"; return; fi')`, which must be > -1.
  - `/\bLC_ALL\b/.test(body.slice(0, d))` must be `false`: no `LC_ALL` token at all above the dispatch, on its own line or on the first `local` line.
  - `/^  local LC_ALL=C$/m.test(body.slice(d))` must be `true`: the pin below the dispatch.
  - `/_box_unit_env_shell\(\) \{[^\n]*\n  local key="\$1" v rc bad="" LC_ALL=C\n/` must match (the function line carries a `# <KEY>` comment).
  - The message names T4-M31 and D-3979.
- **`server/test/ccrcContainment.ts:13`:** "(seven pairs in ccd/ccrc, :3295 first)" becomes "(seven pairs in ccd/ccrc, the first in `_box_units`)". At `00f8a193`, `:3295` is inside `_box_units() {` (`:3278`), and this task's lines move it. Re-measure the enclosing function by content before writing it. Keep the comment's line count.

- [ ] **Step 1: Re-measure,** on the tip being built:
  ```bash
  git rev-parse --short HEAD origin/main
  grep -nF 'if [ "${CCD_OS:-linux}" = darwin ]; then _box_unit_env_shell "$key"; return; fi' ccd/ccrc   # :2971
  grep -nF 'local key="$1" v rc bad="" LC_ALL=C' ccd/ccrc                                               # :3024
  grep -nF 'local chunk LC_ALL=C' ccd/ccrc                                                              # :2873
  grep -nF 'local LC_ALL=C ws=$'"'"' \t\r'"'"'' ccd/ccrc                                                  # :2913 (_box_env_unit_whole)
  grep -n '^function utf8Locale\|^function unitEnvAnswers\|U4U: Array\|U4u: under a UTF-8\|U4n: `_box_env_has_nul`' server/test/ccrc-doctor.test.ts   # :3015 :3027 :4100 :4108 :4127
  grep -c 'XDG_RUNTIME_DIR:=' ccd/ccrc                                                                  # 7
  grep -n 'XDG_RUNTIME_DIR:=' ccd/ccrc | head -1                                                        # :3295
  wc -l ccd/ccrc                                                                                        # 23350
  ```
- [ ] **Step 2: Red first.**
  - Restructure U4U as above and add L1, G1 and U4p.
  - Run `cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t "U4"`.
  - **Expected red on `main`'s `ccd/ccrc`:**
    - U4u, on linux F2 (`[0,'on',envPath]` vs `[0,'off',expPath]`) and linux L1 (`[0,'','']` vs `[0,'on',envPath]`);
    - U4p (no pin below the dispatch).
  - **Expected green:** darwin F2, darwin L1, darwin G1, linux G1, F1, F1b, U4 and U4n. The attack confirmed these against `main` under `C.UTF-8`.
  - Record the assertions.
- [ ] **Step 3: Implement** the six lines and the header clause. Run `bash -n ccd/ccrc`.
- [ ] **Step 4: Run green,** one call each:
  - `ccrc-doctor -t "U1|U2|U3|U4"`;
  - `ccrc-doctor` in full, or in `-t` parts that each report a non-zero pass count (Global Constraints);
  - `ccrc-install -t "gate"`;
  - `session-hook`.
- [ ] **Step 5: The differential (the property, not a corpus count).**
  - In `$SCRATCH`, write a throwaway script (never committed). It generates at least 2,000 random ccrc.env/exposure file pairs: comment lines with lone lead bytes, high bytes, CRs, NULs, quotes, `export`, spaced `=`, `\` endings and canonical lines. It reads `_box_unit_env CCRC_AUTH` with `CCD_OS=linux`:
    - from the tip under `C`, `C.UTF-8` and `en_US.UTF-8`;
    - from `git show origin/main:ccd/ccrc` under `C`.
  - **Expected:** every tip verdict, `rc`, `BUE_VAL` and `BUE_SRC`, equals `main`'s under `C`, in every locale. The attack measured 6000/6000. Report the counts.
  - Also run the same pairs with `CCD_OS=darwin`. The tip must equal `main` in every locale: Task 1 leaves the Darwin arm untouched.
- [ ] **Step 6: The mutation table.** Rows T1-1, T1-2, T1-2b and T1-3 were measured by the attack on scratch copies of `main` plus this task, under `C.UTF-8`; T1-4's corrected spelling too.

  | # | Guard | Mutation | Goes red (full expected set) | Command |
  |---|---|---|---|---|
  | T1-1 | the Linux pin | delete `local LC_ALL=C` from `_box_unit_env` | U4u (linux F2, linux L1), U4p | `cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t "U4"` |
  | T1-2 | its placement | move it onto `_box_unit_env`'s first `local` line (above the dispatch) | U4p only. Then, with T1-2 still applied, apply T4-M31 too: record that U4u stays GREEN, the hazard U4p exists for | same |
  | T1-2b | its placement, a second spelling (A3) | keep the pin below the dispatch AND append `LC_ALL=C` to the first `local` line | U4p only (the token above the dispatch) | same |
  | T1-3 | T4-M31 (D-3833), re-measured on the tip | drop `_box_unit_env_shell`'s `LC_ALL=C` | U4u (darwin F2, darwin L1, darwin G1), U4p (its last clause) | same |
  | T1-4 | the relocated-pin mutant (review 269 F1), respelled (A2) | drop `_box_unit_env_shell`'s `LC_ALL=C`, and add `if [ "$mode" = shell ]; then local LC_ALL=C; fi` as the FIRST line of `_box_env_value`'s body, before its loop | U4u (darwin G1) only, U4p (its last clause) | same |
  | T1-5 | T4-M32, re-measured | drop `_box_env_has_nul`'s own `LC_ALL=C` | U4n | same |
  | T1-6 | T4-M33, re-measured | U4u's locale passed as `xx_XX.UTF-8` directly | U4u fails, exit 7 (`did not take effect`), never skips | same |
- [ ] **Step 7: Commit:** `fix(update): doctor's Linux auth reader reads bytes whatever the caller's locale, and the Darwin plain test's own line loop is pinned under UTF-8 (wave 11, R14f, R14g; D-3979)`.

### Task 2: R14(j): the Darwin plain test refuses the names that stop the launchd job

**Files:** `ccd/ccrc` (`_box_env_shell_plain`, its header, the `BEP_CAUSE` comment, `_box_unit_env_shell`'s reason `case`), `server/test/ccrc-doctor.test.ts` (U5, U5l, E20d; the `:3591` and `:8384` comments).

**Safe under:** no pairing (doctor). The Linux arm never calls `_box_env_shell_plain`.

**Interfaces and code.** Directly below `case "$name" in ''|[0-9]*|*[!A-Za-z0-9_]*) BEP_LINE=$n; BEP_CAUSE=shape; return 1 ;; esac` (`ccd/ccrc:2854`):
```bash
    # Wave 11 R14(j) (D-3980): names /bin/bash reserves. Under the job's `set -a; . file`, POSIXLY_CORRECT turns POSIX
    # mode on, and in POSIX mode assigning one of bash's six read-only variables — or, in bash 3.2, BASH_ARGC, BASH_ARGV,
    # BASH_LINENO, BASH_SOURCE, FUNCNAME or GROUPS — ends the shell before its `exec` (measured: bash 3.2.57, 5.2.21), so
    # the job never starts, whatever CCRC_AUTH says. Refused as a NAME, in either file and in any order.
    case "$name" in
      POSIXLY_CORRECT|BASHOPTS|BASH_VERSINFO|EUID|PPID|SHELLOPTS|UID|BASH_ARGC|BASH_ARGV|BASH_LINENO|BASH_SOURCE|FUNCNAME|GROUPS)
        BEP_LINE=$n; BEP_CAUSE=name; return 1 ;;
    esac
```
A new arm in `_box_unit_env_shell`'s `case "$BEP_CAUSE"`, before `*)`. It names the cause and the line, never the variable (A1), and calls none of them read-only (A5):
```bash
    name) BUE_WHY="$bad line $BEP_LINE assigns a variable /bin/bash reserves, and on macOS the launchd job sources both env files with /bin/bash, which can stop at such an assignment before the server starts (in POSIX mode, which one of those variables turns on)"
          BUE_FIX="delete line $BEP_LINE of $bad, or rename the variable it sets (ccrc expose rewrites the exposure file)" ;;
```
- `BEP_CAUSE=""   # _box_env_shell_plain: nul | cr | shape` (`:2947`) gains `| name`.
- `_box_env_shell_plain`'s header gains one sentence naming the rule and D-3980.
- The Darwin arm already reads under `LC_ALL=C` (D-3833), so `[!A-Za-z0-9_]` and the names compare as bytes.

**The cases:**
- **U5** (all platforms, `unitEnvAnswers(rows, 'darwin')`):
  - For each of the thirteen names, ccrc.env `<NAME>=0\nCCRC_AUTH=on\n` with no exposure file reads rc 3.
    - `BUE_WHY` starts `<envPath> line 1 assigns a variable /bin/bash reserves`.
    - Neither `BUE_WHY` nor `BUE_FIX` contains the name: `expect(why).not.toContain(name)` and the same for `fix`, for all thirteen, `POSIXLY_CORRECT` included.
    - `BUE_FIX` names line 1.
  - The review's exact input: ccrc.env `POSIXLY_CORRECT=1\n`, exposure `UID=0\nCCRC_AUTH=on\n` reads rc 3, naming ccrc.env line 1.
  - The order-free row: ccrc.env `CCRC_AUTH=on\n`, exposure `CCRC_RP_ID=x\nGROUPS=0\n` reads rc 3, naming the exposure file line 2.
  - **Controls, rc 0 `on`:** `PATH=/usr/bin`, `HOME=/x`, `LC_ALL=C.UTF-8`, `BASH_COMPAT=0`, `BASH_XTRACEFD=0`, `MY_UID=0`, `UIDX=0`, `uid=0` and `POSIXLY_CORRECTX=1`, each followed by `CCRC_AUTH=on`.
- **U5l** (all platforms, `'linux'`): the review's exact input reads rc 0 `on` from the exposure file. systemd sets both as plain environment, so the platform split is stated as data.
- **E20d** (`itDarwin`): the review's input through `ccrc doctor`, on `healthy()` with a usable passphrase, gives one `WARN auth` "was not measured", naming ccrc.env line 1, and never a PASS ARMED. macOS acceptance: the coordinator reads it.
- **The two `:2939` comments** (T-7). This task's insertion moves `ccd/ccrc:2939` (`BUE_VAL=""`), and both comments are correct at `00f8a193`.
  - `ccrc-doctor.test.ts:3591`: "`ccd/ccrc:2939` resets it at file scope" becomes "`BUE_VAL=""`, the out-param block's first line above `_box_unit_env`, resets it at file scope".
  - `ccrc-doctor.test.ts:8384`: "an env entry is reset at ccrc's own file scope, `:2939`" becomes "… at ccrc's own file scope (`BUE_VAL=""`'s line)".

- [ ] **Step 1: Re-measure:**
  ```bash
  grep -nF "case \"\$name\" in ''|[0-9]*|*[!A-Za-z0-9_]*) BEP_LINE=\$n; BEP_CAUSE=shape; return 1 ;; esac" ccd/ccrc   # :2854
  grep -nF 'BEP_CAUSE=""   # _box_env_shell_plain: nul | cr | shape' ccd/ccrc                      # :2947
  grep -nF 'BUE_VAL=""     # _box_unit_env:' ccd/ccrc                                              # :2939
  grep -nF ':2939' server/test/ccrc-doctor.test.ts                                                 # :3591 :8384
  ```
  Also re-measure that no fixture line in `ccrc-doctor`, `ccrc-install` or `ccrc-update` assigns one of the thirteen names (`grep -nE`; measured empty at `00f8a193`, and the attack found no shipped writer that emits one), so no existing Darwin verdict moves.
- [ ] **Step 2: Red first.** Add U5, U5l and E20d. Run `ccrc-doctor -t "U5"`.
  - **Expected red on the Task 1 tip:** U5's 15 refused rows (rc 0 `on` vs rc 3).
  - **Expected green:** U5's nine controls and U5l. E20d is macOS only.
- [ ] **Step 3: Implement.** Run `bash -n ccd/ccrc`.
- [ ] **Step 4: Run green:** `ccrc-doctor -t "U3|U4|U5"`, then `ccrc-doctor` in full or in non-hollow parts, then `session-hook`.
- [ ] **Step 5: Mutation table.**

  | # | Guard | Mutation | Goes red | Command |
  |---|---|---|---|---|
  | T2-1 | the name refusal | delete the new `case` | U5 (every refused row) | `cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t "U5"` |
  | T2-2 | each name is in the set | drop `GROUPS` from the pattern | U5's `GROUPS` row and the order-free row only | same |
  | T2-3 | anchored names | `UID` becomes `*UID*` | U5's `MY_UID` and `UIDX` controls | same |
  | T2-4 | its own reason | delete the `name)` arm (falls to the `shape` wording) | U5 (the `assigns a variable /bin/bash reserves` prefix) | same |
  | T2-5 | the reason never names the variable (A1) | append ` ($name)` to the `name)` arm's `BUE_WHY` and `local name` in `_box_unit_env_shell` set from a re-read of the line | U5's `not.toContain(name)` assertions, all thirteen | same |
- [ ] **Step 6: Commit:** `fix(update): on macOS doctor does not call the gate ARMED when an env file assigns a name that stops the launchd job's bash (wave 11, R14j; D-3980)`.

### Task 3: R14(i): record the macOS runner's UTF-8 locale, and whether the readers' pins can red there

**Files:** `server/test/platform-hazards.test.ts` (one new describe, appended).

**Safe under:** no pairing (test-only).

**Why this file.** It is the project's instrument for questions only macOS can answer. Its header says "the darwin cases are written so the ANSWER travels in the assertion MESSAGE", and its cases are "RECORDED, not wished for … asserts only that we got one, and prints which" (`:122-130`).
- It runs on `probe-macos` with `--reporter=verbose` (`.github/workflows/ci.yml:640`), and on `test-macos` like any file.
- So a Darwin case here must not assert the unknown answer: a red would be a `full-suite` red, which blocks `stable`.

**The describe:** `R14(i): the UTF-8 locale bash takes here, and whether D-3833/D-3979's locale pins are load-bearing on this platform`.
- **The probe:** module-level, wrapped in try/catch so collection never throws. It copies `ccrc-doctor.test.ts`'s `utf8Locale()` candidate list (`C.UTF-8`, `en_US.UTF-8`) and its one-character test, because a test file cannot be imported, and the comment says so. It yields `LOC`, or `'none'`.
- **H1** (`it`, every platform): `R14(i): bash takes ${LOC} here`. It asserts `LOC !== 'none'` (fail, never skip, as U4u does) and `console.info`s the locale.
- **H2** (`itLinux`, the control): under `LOC`, with no pin anywhere:
  - an unpinned `IFS= read -r -d '' x < f` over `# caf\xc3\0\nCCRC_AUTH=on\n` MISSES the NUL (rc 1);
  - an unpinned `while IFS= read -r l; do n=$((n+1)); done < f` over `# caf\xc3\nX=1\n` counts 1 line.

  Both are asserted. They are why T4-M32, T4-M31 and T1-1 red on Linux. The attack confirmed both on bash 5.2 under `C.UTF-8` and `en_US.UTF-8`.
- **H3** (`itDarwin`, RECORDED): the same two probes.
  - Each answer is computed and `console.info`ed as `R14(i): under ${LOC}, an unpinned read -d '' ${misses|sees} the NUL after a lead byte (so U4n ${can|cannot} red here); an unpinned read ${merges|keeps} the line (so U4u F2 and G1 ${can|cannot} red here)`.
  - The case asserts only that each probe exited 0 or 1 and produced its field, and carries the sentence in the message.
  - Measured by the attack: musl bash 3.2.57 under UTF-8 does NOT merge. So a runner whose PATH bash were 3.2 would record "cannot red", which is below ccrc's bash ≥ 4.4 floor.

- [ ] **Step 1:** re-measure `grep -n "RECORDED, not wished for" server/test/platform-hazards.test.ts` (`:122`) and the probe step (`.github/workflows/ci.yml:640`).
- [ ] **Step 2:** write the describe. Run `cd server && ./node_modules/.bin/vitest run test/platform-hazards.test.ts`. Expected: H1 and H2 green on Linux; H3 skipped.
- [ ] **Step 3: Mutation table.**

  | # | Guard | Mutation | Goes red | Command |
  |---|---|---|---|---|
  | T3-1 | H2 measures the hazard | H2's probe bash gets `LC_ALL=C` | H2 (both probes) | `cd server && ./node_modules/.bin/vitest run test/platform-hazards.test.ts -t "R14"` |
  | T3-2 | H1 fails rather than skips | the candidate list becomes `['xx_XX.UTF-8']` | H1 and H2 (`none`) | same |
- [ ] **Step 4: Commit:** `test(update): record which UTF-8 locale bash takes on each runner, and whether the auth readers' locale pins can red there (wave 11, R14i)`.
- **The record itself** is read by the coordinator from the PR's `probe-macos` and `test-macos` logs (H1's and H3's lines) and written into the ledger (Reading 11). The worker quotes the Linux answer in the wave-done.

### Task 4: re-home the cross-version file onto the frozen pre-wave-11 sweep (R13 f; wave 10's Readings 2 and 3)

**Files:** create `server/test/sweepFixture.ts` and `server/test/fixtures/upd-sweep-pre-wave11.bash`; rewrite `server/test/ccrc-sweep-deliberate-stop.test.ts`.

**Safe under:** this task changes no product file. It must land BEFORE Task 6 touches `_upd_sweep`. X0 in today's file reds the moment the sweep changes shape (the attack measured X0, X2, X3, X3b and X4 red against the concurrent sweep), and this task makes the case independent of the sweep in the tree.

**The frozen fixture.**
- The file starts with this header, then the function text:
  ```bash
  # FROZEN (wave 11, D-3982) — `_upd_sweep` exactly as every release from v0.0.60 through v0.0.84 ships it, measured
  # per tag. The move INTO wave 11 runs THIS function (the box's old ccrc) with the new tree's verify-service.sh, so
  # `ccrc-sweep-deliberate-stop.test.ts` sources it over this tree's ccd/ccrc and runs it. Never edit what follows:
  # X0 pins its sha256, and X0c pins the tree's helpers it calls. If a later wave must change one of those helpers,
  # it freezes v0.0.84's copy here, below the function, first. Retire this file and its cases once no box's ~/ccrc,
  # or kept ~/ccrc-versions/<tag>, predates wave 11's release.
  ```
- The function text is produced, never typed, by `git show v0.0.84:ccd/ccrc | awk '/^_upd_sweep\(\) \{/{f=1} f{print} f&&/^\}/{exit}' >> server/test/fixtures/upd-sweep-pre-wave11.bash`. That is 174 lines.
- Its sha256 is `d01e0a056196d5dc113ed51976d38959f893a11bb99821bd4f6758c039dacd42`, the same at v0.0.60, v0.0.65, v0.0.70, v0.0.72, v0.0.74, v0.0.75, v0.0.76, v0.0.78, v0.0.79, v0.0.80 and v0.0.84. The attack measured it from v0.0.53; v0.0.50–v0.0.52 differ.

**`server/test/sweepFixture.ts`** takes the cross-version file's builders, which wave 10 wrote, and extends them. It imports `node:*`, `./tmpHelpers.js`, `./ccdWsHelpers.js` (`ghContainedEnv`, `harnessBin`), `./ccrcContainment.js` (`ccrcContainedEnv`) and `./containedTools.js` (`assertNoRealTool`). Never a `.test.ts`.
```ts
export const REPO: string;            // the repo root
export const BASH: string;            // bash resolved once from the parent's PATH
export const CCRC_SRC: string;        // join(REPO, 'ccd', 'ccrc')
export const VERIFY_SRC: string;      // join(REPO, 'deploy', 'verify-service.sh')
export const FROZEN_SWEEP: string;    // join(here, 'fixtures', 'upd-sweep-pre-wave11.bash')
export const FROZEN_VERIFY_S0: string;// join(here, 'fixtures', 'verify-service-pre-wave10.sh')   (Task 6)
export const POISONS: readonly string[];   // tmux ccd launchctl loginctl systemd-run ssh scp curl npm (gh: ghContainedEnv)
export const CONTAINED: readonly string[]; // the 12 names, spelled out (wave 10's list)
/** listed: 'active' = in the pre-restart AND the --state=active listing (the default); 'crash:<word>' = in the
 *  pre-restart listing as active, and in the --state=activating,failed listing as `<word>`; 'gone' = in the
 *  pre-restart listing only. `active`/`mainPid` are answered one per call, the last repeating, across EVERY call of
 *  that unit — the first verify's and the re-check's alike. */
export interface UnitPlant { unit: string; active: string[]; mainPid: string[]; loadState?: string;
  listed?: 'active' | `crash:${string}` | 'gone' }
/** A unit's Nth `is-active` call waits, polling every 0.1 s for at most `boundTenths`, until `until` holds; then it
 *  answers its planned word, or `failed` when `onTimeout` says so. `firstPids` counts units whose FIRST
 *  `show -p MainPID` has been made; `isActive` counts another unit's `is-active` calls. */
export interface Gate { unit: string; call: number; until: { firstPids: number } | { unit: string; isActive: number };
  boundTenths: number; onTimeout: 'answer' | 'failed' }
/** `journalGate`: the stub journalctl, for `unit`, waits (at most 50 tenths) until `systemctl-calls` holds `line`. */
export interface BoxOpts { units: UnitPlant[]; registry?: Record<string, string>; verifySrc?: string;
  gates?: Gate[]; journalGate?: { unit: string; line: string }; crashListingRc?: number;
  tmpdir?: 'dir' | 'file'; report?: { pid: number; phase?: string } }
export interface Box { home: string; env: NodeJS.ProcessEnv }
export function makeBox(o: BoxOpts): Box;
export function assertContained(box: Box): void;   // the 12-name resolution AND assertNoRealTool(box.env, box.home)
export function runSweep(box: Box, o?: { frozen?: string; pre?: string; env?: Record<string, string>;
  reporting?: { pid: number }; tail?: string; timeout?: number; killSignal?: NodeJS.Signals }):
  { code: number; stdout: string; stderr: string };
export function survivors(box: Box): number[];     // pids whose /proc/<pid>/environ holds HOME=<box.home> (Linux)
export function reapSurvivors(box: Box): void;     // SIGKILL them, then poll (bounded 5 s) until survivors() is empty
export function calls(box: Box): string[];         // <home>/systemctl-calls, `$*` per line
export function poisonFiles(box: Box): string[];
export function report(box: Box): string | null;   // <home>/.ccrc/update.json, raw
export const SWEEP_OK: string;                    // the success line, byte for byte (runbook-holds pins it too)
```
- **`makeBox`:**
  - It plants the stubs FIRST: `systemctl`, `journalctl` and the poisons, in `harnessBin(home)`. Then it builds the env with `ccrcContainedEnv(home, base, { managers: false, curl: 'poison' })`. Its poisons are create-if-absent, so the functional stubs win.
  - `base` is built from scratch, never `...process.env`: `HOME`, the parent's `PATH`, `LANG=C`, `TMPDIR=<home>/tmp`, and `CCRC_VERIFY_SETTLE=0`, `CCRC_VERIFY_WINDOW=0`, `CCRC_VERIFY_LOG_LINES=5`, `CCRC_VERIFY_STOP_INTERVAL=0`.
  - `ccrcContainedEnv` sets `XDG_RUNTIME_DIR` and `DBUS_SESSION_BUS_ADDRESS` under HOME.
  - `tmpdir: 'file'` makes `<home>/tmp` a regular file.
  - `report` plants `<home>/.ccrc/update.json` as `{"target":"v0.0.85","phase":"<phase|restarting>","startedAt":1,"updatedAt":1,"detail":null,"from":"auto","pid":<pid>}`.
- **The stub `systemctl`** keeps wave 10's verbs and their exact answers. It records `$*` before any shift, requires and shifts `--user`, and exits 90 with `fixture systemctl: unexpected argv` on anything else.
  - `list-units` prints the planted units as `<unit> loaded <word> <sub> x`, in plant order:
    - unfiltered: every unit, `active`;
    - `--state=active`: those `listed: 'active'`;
    - `--state=activating,failed`: those `listed: 'crash:<word>'`, or exits `crashListingRc` when set;
    - `--state=failed`: nothing.
  - It adds `show -p LoadState --value <unit>`: the unit's `loadState`, where `''` prints nothing and exits 1.
  - It adds the gates. When a `firstPids` gate exists, a unit's first `show -p MainPID` appends the unit to `<home>/fx/p1`.
- **The stub `journalctl`** records its argv and prints `fixture journal line for <unit>`, waiting first under `journalGate`.
- **`runSweep`** calls `assertContained(box)` first, then spawns:

      spawnSync(BASH, ['-c', '. "$1"; [ -z "$2" ] || . "$2"; <pre>; CCD_OS=linux; UPD_BACKUP_DIR="$HOME/ccrc-backups/fixture"; <reporting>; _upd_sweep; rc=$?; <tail>; exit $rc', 'ccrc-under-test', CCRC_SRC, frozen ?? ''], { env: {...box.env, ...o.env}, encoding: 'utf8', timeout: o.timeout ?? 45_000, killSignal: o.killSignal ?? 'SIGTERM' })

  - `<pre>` shadows a function after sourcing (W18). It is empty by default.
  - `<reporting>` is `UPD_REPORTING=1; UPD_REPORT_PID=<pid>; UPD_REPORT_TARGET=v0.0.85; UPD_FROM=auto; UPD_REPORT_STARTED=1` when asked, and empty otherwise.

**The re-homed file.**
- **The header** keeps its WHY and cites by content, never by line (R13f):
  - `_upd_detach`'s `_svc_run_detached /bin/sh -c 'PATH="$HOME/.local/bin:$PATH" exec "$HOME/.local/bin/ccrc" "$@"'`;
  - `_inst_shim`'s heredoc line `exec "$CCRC_SHIPPED" "$@"`;
  - the sweep's `local verify="$BOX_TREE_DIR/deploy/verify-service.sh"`;
  - `BOX_TREE_DIR="$HOME/ccrc"`.

  It says the move INTO wave 11 runs the frozen bytes with this tree's script. The describe is `the move INTO wave 11: the pre-wave-11 _upd_sweep (frozen, v0.0.60–v0.0.84), sourced over this tree's ccd/ccrc, with this tree's verify-service.sh`.
- Every case runs `runSweep(box, { frozen: FROZEN_SWEEP })`. Its two units are `DEMO_GOOD` (`['active']`/`['4242']`) and `DEMO_GONE`, in that order.
- A `demo-gone.generation` planted for a purged row is a mid-purge registry shape the script never reads. D-2605 removes `.generation` last, so a fully purged row has none. The comment says so, and never calls it a fact the purge keeps (F6).

| # | Case | Expected |
|---|---|---|
| X0 | the frozen bytes are the released bytes | `FROZEN_SWEEP` matches `/^_upd_sweep\(\) \{\n[\s\S]*?\n\}\n/m`; the match's sha256 is `d01e0a05…cd42`; it holds `local verify="$BOX_TREE_DIR/deploy/verify-service.sh"`, `bash "$verify" "$u" \` and `\|\| _ccrc_die "$u was restarted and did not stay up — read: systemctl --user status $u.` (D-3950's quote) |
| X0b | the header's content citations hold in this tree | `CCRC_SRC` holds each of the four quoted strings above. The current `_upd_sweep` body holds `local verify="$BOX_TREE_DIR/deploy/verify-service.sh"`, so the NEXT move still resolves the script at call time |
| X0c | the frozen sweep's helpers are v0.0.84's (T-8) | Each function below is extracted from `CCRC_SRC` by one rule: a one-line `^<name>\(\) \{.*\}$` is its line; otherwise the text from `^<name>\(\) [{(]` through the first later line that is exactly `}` or `)`, each line plus `\n`. Its sha256 equals the v0.0.84 literal: `_ccrc_die` `e7e1f481267223048b0910f900cd7a3f7a48d569d82f1bdb963a1a6dd0fdc018`, `_upd_redact` `572ccbf1220059570ce48128c6e45152bb76f5472bcd894cfdbac8b550a40586`, `_upd_phase` `d6d3453123096c8e8d99b032464bad7e7f5782b47bd7e5e5627d57c596e8ce52`, `_upd_json_str` `fb88a5e9d342a2ebef1eb4e4ffde92841d5d117de713507ac6f88f2ce495dff2`, `_tmp_guard` `e82e65af95b11acd398aa3d83f0522f31f8e3567e801c4c2d70f04e25c659104`, `_exit_add` `6936453d935739d982dc714dd0b44ce8fd1947e59cf6bb4638a2ffca8bbca0f8`, `_exit_run` `2691a2221fb27401bec42bb08c2f42a8078c58a845a367efe5ebe9e1c001a1aa`. The message says: freeze v0.0.84's copy into the fixture before changing it |
| X1 | containment | `assertContained` as a case. `XDG_RUNTIME_DIR` and `DBUS_SESSION_BUS_ADDRESS` start with `home` |
| X2 | stamped stop caught in the window | as at `00f8a193` (`:291-302`): rc 0, the stamped line, `SWEEP_OK`, and the exact 15-line `X2_LOG` |
| X3 | unstamped stop dies, with the OLD bytes' own sentence (characterisation) | as at `00f8a193` (`:304-315`), the `The pre-update backup is complete at <home>/ccrc-backups/fixture` text included: those are the frozen bytes |
| X3b | its exact log | `[...X2_LOG, STATUS_LINE]` |
| X4 | reclaimed and purged before the loop reaches it | as at `00f8a193` (`:323-345`). Task 5 adds its `LoadState` line |

After X2, X3, X3b and X4, no `*-poison` file exists.

- [ ] **Step 1: Re-measure:**
  ```bash
  git show v0.0.84:ccd/ccrc | awk '/^_upd_sweep\(\) \{/{f=1} f{print} f&&/^\}/{exit}' | sha256sum   # d01e0a05…cd42
  git show origin/main:ccd/ccrc | awk '/^_upd_sweep\(\) \{/{f=1} f{print} f&&/^\}/{exit}' | sha256sum   # the same
  grep -nF 'exec "$CCRC_SHIPPED" "$@"' ccd/ccrc                     # :13969 (_inst_shim)
  grep -nF "_svc_run_detached /bin/sh -c 'PATH=\"\$HOME/.local/bin:\$PATH\" exec \"\$HOME/.local/bin/ccrc\" \"\$@\"'" ccd/ccrc   # :18355
  grep -nF 'local verify="$BOX_TREE_DIR/deploy/verify-service.sh"' ccd/ccrc   # :20948
  grep -n '^export function ccrcContainedEnv\|^export function assertNoRealTool' server/test/ccrcContainment.ts server/test/containedTools.ts
  ```
  If `main`'s sweep digest is not `d01e0a05…`, stop and report: `main` moved the sweep. Re-compute X0c's seven digests from `git show v0.0.84:ccd/ccrc` and from the tree by the X0c rule. They must equal the literals above.
- [ ] **Step 2:** create the fixture by the command above. Write `sweepFixture.ts`, and rewrite the file onto it. Run `cd server && ./node_modules/.bin/vitest run test/ccrc-sweep-deliberate-stop.test.ts`. **Expected:** X0–X4, X0b, X0c and X3b green, on this tree's unedited `ccd/ccrc` and script.
- [ ] **Step 3: Mutation table.**

  | # | Guard | Mutation | Goes red | Command |
  |---|---|---|---|---|
  | T4-1 | the frozen bytes | change one byte inside the fixture's function text (a comment letter) | X0 (sha256) | `cd server && ./node_modules/.bin/vitest run test/ccrc-sweep-deliberate-stop.test.ts` |
  | T4-2 | content citations | alter `exec "$CCRC_SHIPPED" "$@"` in the test's quoted list | X0b | same |
  | T4-3 | containment, a name only `POISONS` plants (T-2) | drop `ccd` from `POISONS` | X1, X2, X3, X3b, X4 (`assertContained` refuses: `ccd` resolves outside the fixture bin, or nowhere). `tmux`, `ssh`, `scp`, `launchctl` and `curl` are also planted by `ccrcContainedEnv`, so dropping one of them reds nothing (measured), and no row claims it | same |
  | T4-4 | wave 9's bus check | set `XDG_RUNTIME_DIR` outside `home` on the env `ccrcContainedEnv` RETURNED (a value set in `base` is overwritten) | X1–X4 (`assertNoRealTool` throws) | same |
  | T4-5 | the case runs the FROZEN sweep | `runSweep` ignores `frozen` | measured in Task 6, Step 5 (T6-18) | — |
  | T4-6 | the frozen sweep's helpers (T-8) | in a scratch copy pointed at by a transient `CCRC_SRC` edit, change `s="${s:0:200}"` to `s="${s:0:201}"` inside `_upd_json_str` | X0c only | same |
- [ ] **Step 4: Commit:** `test(update): the move-INTO case runs the frozen pre-wave-11 sweep with its helpers pinned, its builders move to sweepFixture.ts, and its citations are by content (wave 11, R13f; D-3982)`. Then run `topology-clean.test.ts`.

### Task 5: R13 (a)–(d): verify-service.sh's purged arm believes only a real ccd id and a loadable unit; the three pins

**Files:** `deploy/verify-service.sh`, `agent/test/deploy-verify.test.ts`, `server/test/ccrc-sweep-deliberate-stop.test.ts` (X4), `server/test/sweepFixture.ts` (already answers `LoadState`).

**Safe under:** every pairing that runs S11. X2–X4 prove the OLD sweep + S11 (the move INTO wave 11) against the frozen bytes; Task 6 proves the NEW sweep + S11. Pairings that run S10 or S0 never see this change.

**Interfaces and code.** Above `stopped_on_purpose() {` (`deploy/verify-service.sh:110`), with one blank line between:
```bash
# ccd's session-id grammar, `^[A-Za-z0-9._-]+$` (ccd/ccd's "bad session id" checks), with its alphabets written out
# rather than as ranges — as ccd/ccrc's `_svc_real_home` writes its own — because a range is collation-dependent
# under some UTF-8 locales and this script runs in its caller's. A leading `.` is refused too (D-3977): ccd ids are
# `<account>-<project>`, and `claude-session@..service` passes the grammar and reads `loaded`.
ccd_id_ok() {   # <id> -> 0 iff ccd could have minted it
  local az=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ d=0123456789
  case "$1" in ''|.*|*[!${az}${d}._-]*) return 1 ;; esac
}
```
The purged arm (`:135-136`) becomes:
```bash
  elif [ ! -e "$reg/$id.uuid" ] && [ ! -L "$reg/$id.uuid" ]; then
    # R13(a) (wave 11, D-3976, D-3977, D-3978): "purged" is believed only of a name ccd could have minted, with nothing
    # at all at <id>.uuid (a symlink is something), and of a unit systemd can load. `show -p LoadState` answers
    # `loaded` for every instance of the installed template — a reclaimed, disabled, garbage-collected one included
    # (measured on the live user manager, systemd 255, 35 real purged ids) — so it refuses only a missing template, a
    # masked unit, or a name systemd will not parse. A never-existed id still reads as purged: unreachable, since both
    # sweeps verify only units their own listings showed. Asked only here, so a unit whose row is kept costs no query.
    ccd_id_ok "$id" || return 1
    load=$(systemctl --user show -p LoadState --value "$UNIT" 2>/dev/null)
    [ "$load" = loaded ] || return 1
    evidence="its registry row is purged (no ~/.cc-sessions/$id.uuid)"
```
- `stopped_on_purpose`'s `local` line gains `load`.
- The WHY block gains one paragraph, below its REG paragraph (`:105-109`), naming R13(a), D-3976, D-3977 and D-3978 and the measured `LoadState` facts.
- The WHY block's first paragraph (`:72-74`, "`ccrc update`'s sweep and deploy.sh's SWEEP_CMD list the active supervisors ONCE, then run this script per unit, serially, ~8s each, and the first non-zero exit fails the run") is reworded in place. It now says: deploy.sh's SWEEP_CMD still does; `ccrc update`'s sweep, since wave 11, runs it per unit concurrently and re-checks a crash-like failure once (D-3983). Each call's own verdict is unchanged.
- The stamped arm is unchanged, by the ruling's text ("before the purged arm").
- The purged line's text is unchanged.

**The harness.**
- `stubs()` gains an optional `loadState?: string` (default `'loaded'`). It is answered on `*" LoadState "*`, before the `MainPID` arm: the word on one line and exit 0, or, for `''`, nothing and exit 1.
- `sweepStubs` answers `LoadState` with `loaded` for every unit.
- **V2's title**, "a purged row passes (the purge keeps `generation`, D-2605)", becomes "a purged row passes (a `.generation` left mid-purge is never read; D-2605 removes it last)" (F6).

**The cases** (appended to wave 10's describe; `U` = `claude-session@demo-gone.service`; every case `30_000`):

| # | Case | Plant | Expected |
|---|---|---|---|
| V17 | (amended) inactive at the settle read, purged | as today | exit 0, the purged line. `calls` is exactly: is-active U, is-active U, `systemctl --user show -p LoadState --value U` |
| V23 | an escaped name is not ccd's (R13a) | unit `claude-session@demo\x2dgone.service` (a literal backslash); `['active','inactive','inactive']`; `plantReg(home, { 'demo-gone.generation': '7' })` | exit 1; exactly 3 `is-active`; no `LoadState` call |
| V24 | `it.each` `not-found`, `masked`, `''`: a unit systemd cannot load (R13a) | `['active','inactive','inactive']`; `{ 'demo-gone.generation': '7' }`; `loadState` X | exit 1; stderr has `became 'inactive'` and `DEPLOY FAILED` |
| V25 | `claude-session@..service` (D-3977) | `['active','inactive','inactive']`; `plantReg(home, {})` | exit 1; no `LoadState` call |
| V26 | a symlinked `.uuid` is a row (D-3978) | `['active','inactive','inactive']`; `<reg>/demo-gone.generation` = `7`, and `<reg>/demo-gone.uuid` a DANGLING symlink to `<home>/nowhere` | exit 1; no `LoadState` call |
| V27 | the re-poll sleeps `STOP_INTERVAL` (R13b) | a stub `sleep` in the stub dir (`printf '%s\n' "$1" >> "$D/sleeps"; exit 0`) and `assertStubsResolve` extended to `sleep` for this case; `['active','deactivating','deactivating','deactivating','inactive']`; stamp; `env: { CCRC_VERIFY_STOP_INTERVAL: '7' }` | exit 0, the stamped line; `sleeps` is exactly `0`, `0`, `7`, `7` |
| V28 | a symlinked stamp is never read (R13c) | `['active','inactive','inactive']`; `demo-gone.uuid`; `<home>/elsewhere` = `canary-9f2`; `<reg>/demo-gone.stopped` a symlink to it | exit 0; stdout is the stamped line with `(not read: not a plain file)`; stdout has no `canary-9f2` |
| V29 | an empty id never passes (R13d, `?*`) | unit `claude-session@.service`; `['active','inactive','inactive']`; `plantReg(home, { '.stopped': '1 ccd' })` | exit 1; exactly 2 `is-active` |
| V30 | the grammar's spelling (D-3976) | reads `VERIFY` | it holds `  case "$1" in ''\|.*\|*[!${az}${d}._-]*) return 1 ;; esac` and `  local az=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ d=0123456789`; the message names `_svc_real_home` and the locale reason |

- In the cross-version file, **X4**'s call log becomes `[...FIRST_11, is-active DEMO_GONE, is-active DEMO_GONE, '--user show -p LoadState --value claude-session@demo-gone.service']` (14 lines). X2, X3 and X3b are unchanged: their row is kept, so no `LoadState` query happens.

- [ ] **Step 1: Re-measure:**
  ```bash
  grep -nF 'stopped_on_purpose() {   # -> 0, and one stdout line' deploy/verify-service.sh   # :110
  grep -nF 'case "$UNIT" in claude-session@?*.service) ;; *) return 1 ;; esac' deploy/verify-service.sh   # :112
  grep -nF '    sleep "$STOP_INTERVAL"' deploy/verify-service.sh                                  # :120
  grep -nF 'if [ -f "$reg/$id.stopped" ] && [ ! -L "$reg/$id.stopped" ]; then' deploy/verify-service.sh   # :130
  grep -nF 'elif [ ! -e "$reg/$id.uuid" ]; then' deploy/verify-service.sh                     # :135
  grep -nF '[[ $id =~ ^[A-Za-z0-9._-]+$ ]] || die "bad session id"' ccd/ccd                 # :8751
  grep -nF 'az=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ d=0123456789' ccd/ccrc  # :796
  grep -n "it('V2:\|it('V17\|it('V22" agent/test/deploy-verify.test.ts                     # :2372 :2543 :2601
  wc -l deploy/verify-service.sh                                                               # 189
  ```
- [ ] **Step 2: Red first.**
  - Extend the harness, then add V23–V30 and amend V2, V17 and X4.
  - Run `cd agent && ./node_modules/.bin/vitest run test/deploy-verify.test.ts`. **Expected red:**
    - V17, and (server) X4, on the missing `LoadState` line;
    - V23, V24 ×3 (`not-found`, `masked`, `''`: today's script never asks, so each passes as purged), V25 and V26, on `toBe(1)` (they get 0);
    - V30 (no `ccd_id_ok`).
  - **Expected green, because the guards they pin exist today:** V27, V28 and V29.
  - Record each.
- [ ] **Step 3: Implement.**
  - `bash -n deploy/verify-service.sh` must print nothing.
  - The line-pin `diff` (Global Constraints) must print nothing.
  - Run the agent file, then `cd server && ./node_modules/.bin/vitest run test/ccrc-sweep-deliberate-stop.test.ts`. **Expected:** all green.
- [ ] **Step 4: Mutation table** (`cp` to scratch, mutate, `bash -n`, run, restore with `cp`, `cmp`).

  | # | Guard (quoted) | Mutation | Goes red (full expected set) | Command |
  |---|---|---|---|---|
  | T5-1 | `ccd_id_ok "$id" \|\| return 1` | delete it | V23, V25 | `cd agent && ./node_modules/.bin/vitest run test/deploy-verify.test.ts` |
  | T5-2 | the leading-dot alternative `.*` | delete it | V25, V30 (V30 pins that exact case line by text; measured by the attack) | same |
  | T5-3 | the explicit alphabets | `*[!${az}${d}._-]*` becomes `*[!A-Za-z0-9._-]*` | V30 | same |
  | T5-4 | the `LoadState` check | delete the two lines | V24 ×3, V17, and (server) X4 | same, then `cd server && ./node_modules/.bin/vitest run test/ccrc-sweep-deliberate-stop.test.ts` |
  | T5-5 | exact `loaded` | `[ "$load" = loaded ]` becomes `[ -n "$load" ]` | V24 `not-found`, V24 `masked` | agent |
  | T5-6 | the query's place (only a purged row costs it) | move the two `LoadState` lines to just above `if [ -e "$reg/$id.stopped" ]` | V1 and V18 (exact logs), and (server) X2 and X3b (exact logs). V17 and X4 stay green: their order is unchanged | both |
  | T5-7 | `[ ! -L "$reg/$id.uuid" ]` | delete it | V26 | agent |
  | T5-8 | the re-poll `sleep` (R13b) | `sleep "$STOP_INTERVAL"` becomes `:` | V27 (`0`,`0` vs `0`,`0`,`7`,`7`) | agent |
  | T5-9 | the same | `sleep "$STOP_INTERVAL"` becomes `sleep 1` | V27 | agent |
  | T5-10 | `[ ! -L "$reg/$id.stopped" ]` (R13c) | delete it | V28 (stdout has `canary-9f2`) | agent |
  | T5-11 | `?*` (R13d) | `claude-session@?*.service` becomes `claude-session@*.service` | V29 (exit 0 through `$reg/.stopped`) | agent |
- [ ] **Step 5: Commit:** `fix(update): verify-service.sh believes "purged" only of a real ccd id, a row with nothing at its uuid and a unit systemd can load; the re-poll sleep, the symlink half and the empty-id glob are pinned (wave 11, R13a-d; D-3976, D-3977, D-3978)`.

### Task 6: R12, Linux: one shared window by concurrent per-unit calls; the re-check; crash-shaped units; the die's guard, wording and cap

**Files:**
- `ccd/ccrc`: the five new helpers, and `_upd_sweep`'s Linux verify block and its comment;
- create `server/test/fixtures/verify-service-pre-wave10.sh` and `server/test/ccrc-sweep-window.test.ts`;
- extend `server/test/sweepFixture.ts` if a shape below is missing.

**Safe under:** the NEW sweep with S11 (the W-cases), S10 (by construction: one unit per call, exit code and output only) and S0 (R1–R3). It does nothing for the move INTO wave 11, which runs the OLD sweep (Task 4–5's X-cases).

**Interfaces and code.** These blocks show the INTENT, and they were run.
- **Where:** a scratch HOME, a copy of `ccd/ccrc` at `00f8a193` with these blocks applied (`bash -n` clean), stubs, and the real S10 script at `SETTLE=0`/`WINDOW=0`.
- **What passed:**
  - W1, W3 ×2, W5, W6 and W10 ×4;
  - W11(c), with 0 survivors;
  - W12, W13a/b, W14 ×2, W15, W16, W17, W17b, W17c, W18 and W19.
- **Mutation rows measured:** T6-1, T6-3, T6-4, T6-6, T6-11b, T6-13a, T6-15, T6-R1, T6-R2, T6-R3, T6-R5, T6-R6, T6-C1, T6-C2, T6-P1, T6-P4a and T6-P4b, each red as its row says.
- **After the coordinator's rulings on Readings 17–19**, the block was re-run in the stop-at-first form shown here: W3/W5, W4, W12, W13a/b, W14, W15 (one re-check call), W16, W17, W17c (the pinned line), W18 and W18b gave the rows' expectations. The block and helpers exactly as printed here were then extracted from this plan into a scratch copy (`bash -n` clean) and re-run: W15 (one re-check call, the three counts), W17c (the pinned line, byte for byte), W5 (a 200-character detail holding the facts and the unit), W16 and a clean four-unit sweep.
- **After the verify (workflow `wf_cc4fcd92-a09`),** the helpers and block were extracted again, exactly as printed here with the kill markers, into a scratch copy of `origin/main`'s `ccd/ccrc` (`bash -n` clean).
  - The harness was the verify's bash harness, extended with W2b ×4, W5, W6, W7, W11(b), W20(a), W20(b) and R1's new assertion.
  - All 32 cases passed: W1, W2b ×4, W3 ×2, W4, W5, W6, W7, W9, W11(b), W12, W13a/b, W14 ×2, W15, W16, W17, W17b, W17c, W17d, W18, W18b, W19, W20(a), W20(b), R1, R2 and R3.
  - Then rows T6-1, T6-4, T6-5, T6-6, T6-10, T6-15, T6-16, T6-R1 to T6-R6, T6-C1 to T6-C5, T6-P1, T6-P4a, T6-P4b, T6-K1 and T6-K2 were measured there. Each went red as its row now says.
  - T6-K3's red is W0's text clause, checked by text.
- An earlier cut, without the re-check, ran 65 units with the real script at `SETTLE=3`/`WINDOW=5` in 8.7 s.
- The implementer keeps the variable names and the shape.

The five helpers go directly above `_upd_sweep() {`, in this order:
```bash
# _upd_sweep_die <message> — the sweep's ONE die (wave 11, R12; D-3973). Both callers release the lock before the
# sweep (`cmd_update`'s and `cmd_rollback`'s flip arm: `_upd_unlock` then `_upd_sweep`), so a second update may own
# ~/.ccrc/update.json when a supervisor fails, and `_ccrc_die` would overwrite its in-flight report with this run's
# `failed`. So, exactly as both callers' closing writes do, the report is written only while `_upd_report_is_mine`:
# a report that POSITIVELY names another pid is left alone, with one line saying so. NEVER called inside `$(…)`, a
# pipeline or `( … )`: `_ccrc_die` reports only from the run's own shell (`$BASHPID = $$`), so a die there would end
# that subshell alone and the sweep would print its success line over a failed unit (the R12 critic's I8).
_upd_sweep_die() {
  if [ "${UPD_REPORTING:-0}" = 1 ] && ! _upd_report_is_mine; then
    echo "update: report: skipped — ~/.ccrc/update.json no longer names this run's pid (${UPD_REPORT_PID:-$$}); a newer update took the lock this run released before the sweep, and this run's failed report would have overwritten its in-flight one"
    UPD_REPORTING=0
  fi
  _ccrc_die "$@"
}
# _upd_sweep_launch <vdir> <verify> <from> <to> — ALWAYS run in a subshell, `( … )` (wave 11, D-3972 e). Starts one
# verify job per unit in units[from..to-1] (the caller's array, by dynamic scope), each in a process group of its own
# (`set -m`) so the exit path can stop a job with everything it started, records each job's pid, and waits for them.
# A fork that fails ends THIS subshell (bash exits the shell that forked: rc 254, measured) — never the run.
_upd_sweep_launch() {
  local vdir="$1" verify="$2" k
  set -m
  for ((k = $3; k < $4; k++)); do
    { bash "$verify" "${units[k]}" </dev/null >"$vdir/$k.out" 2>"$vdir/$k.err"; printf '%s\n' "$?" >"$vdir/$k.rc"; } </dev/null >/dev/null 2>&1 &
    printf '%s\n' "$!" >"$vdir/$k.pid"
  done
  wait
}
# _upd_sweep_kill <vdir> — TERM the process group of each verify job of the chunk in flight that recorded no result
# (D-3972 f). The exit chain runs it when a signal ends the run mid-verify, and the sweep runs it when its launcher
# failed. Each job is signalled AT MOST ONCE, and only while its own chunk is in flight. It skips a job that recorded a
# result (`.rc`), a job whose chunk's results were read (`.done`) and a job already signalled (`.killed`), and it
# refuses a pid of 1 or less (`kill -- -1` would signal every process the user owns). The markers are builtin writes,
# with no fork (verify L1).
_upd_sweep_kill() {
  local f p
  for f in "$1"/*.pid; do
    [ -f "$f" ] || continue
    { [ -e "${f%.pid}.rc" ] || [ -e "${f%.pid}.done" ] || [ -e "${f%.pid}.killed" ]; } && continue
    p=""; IFS= read -r p < "$f" || :
    case "$p" in ''|*[!0-9]*) continue ;; esac
    [ "$p" -gt 1 ] || continue
    kill -TERM -- "-$p" 2>/dev/null
    : >"${f%.pid}.killed"
  done
  return 0
}
# _upd_sweep_replay <file> <1|2> — a captured file to stdout (1) or stderr (2), by builtins: no fork (D-3972 c).
_upd_sweep_replay() {
  local l
  [ -f "$1" ] || return 0
  if [ "$2" = 2 ]; then
    while IFS= read -r l || [ -n "$l" ]; do printf '%s\n' "$l" >&2; done < "$1"
  else
    while IFS= read -r l || [ -n "$l" ]; do printf '%s\n' "$l"; done < "$1"
  fi
}
# _upd_sweep_spo <file> — rc 0 iff a captured stdout holds a `stopped on purpose:` line: the one place the sweep reads
# the script's text, to tell a failure that is NOT crash-like from one that is (D-3983).
_upd_sweep_spo() {
  local l
  [ -f "$1" ] || return 1
  while IFS= read -r l || [ -n "$l" ]; do case "$l" in 'stopped on purpose: '*) return 0 ;; esac; done < "$1"
  return 1
}
```
- The Linux arm's `systemctl --user try-restart "claude-session@*" \ || _ccrc_die "…"` (`ccd/ccrc:20934-20935`) becomes `|| _upd_sweep_die "…"`, with the same text.
- The block from the comment `# Each restarted supervisor is held to the same standard as the services the` (`:20943`) through the loop's `done` (`:20968`) becomes the following. `local verify=…`, `after_listing` and the D-3599 fork stay where they are, in between:
```bash
  # THE VERIFY — ONE SHARED WINDOW, BY CONCURRENT PER-UNIT CALLS, RE-CHECKED ONCE (wave 11, R12; D-3972, D-3983,
  # D-3984). Each restarted supervisor is held to verify-service.sh out of the tree `~/ccrc` names AT CALL TIME,
  # resolved here and never cached: that protects the move INTO a release (it runs the OLD sweep with the NEW script),
  # and it is why a rollback pairs THIS sweep with an OLDER script. So every call passes ONE unit — an older script
  # reads only `$1` and would verify the first of a list and pass the rest unverified (the R12 critic's B2).
  # The calls run CONCURRENTLY, in chunks of at most CCRC_SWEEP_VERIFY_JOBS (default 128; one chunk, one window), from
  # a launcher subshell whose failed fork cannot end this run. EVERY unit is verified, a failure included; each one's
  # output is replayed in listing order. A unit whose first call failed crash-like — a non-zero or unrecorded rc, and
  # no `stopped on purpose:` line — gets ONE more call, alone, in the foreground, after its batch, and fails only if
  # that fails too (the operator's ruling of 2026-10-05 13:58): a pane that died and came back inside the hot minute
  # after the restart is not a crashed build. A unit that was active before try-restart and reads `activating` or
  # `failed` after it is verified too (D-3984); one that reads `inactive` keeps item G's warning below. With no scratch
  # directory, the calls are the old loop's: one at a time, in the foreground. No die sits inside a job, a pipeline or
  # `$(…)` (I8). `--state=active` here and NOT above: handing verify-service.sh a unit try-restart never touched is
  # deploy.sh's final-review finding 6.
  local verify="$BOX_TREE_DIR/deploy/verify-service.sh"
  # … `local after_listing arc=0`, the listing and the D-3599 fork, unchanged …
  local -a units=() missing=() crash=() unrec=() ncfail=()
  local vdir="" vjobs="${CCRC_SWEEP_VERIFY_JOBS:-128}" i j k r lrc d o cu _cl cw _cs _cd clist crc=0 m inb cb kc=0 mn=0 rfail=""
  [[ "$vjobs" =~ ^[1-9][0-9]{0,3}$ ]] || vjobs=128
  for u in $(printf '%s\n' "$after_listing" | awk '{print $1}'); do units+=("$u"); done
  if [ -f "$verify" ]; then
    for cb in ${before[@]+"${before[@]}"}; do
      inb=0; for u in ${units[@]+"${units[@]}"}; do [ "$u" = "$cb" ] && { inb=1; break; }; done
      [ "$inb" -eq 1 ] || missing+=("$cb")
    done
    if [ "${#missing[@]}" -gt 0 ]; then
      clist="$(systemctl --user list-units "claude-session@*" --state=activating,failed --plain --no-legend)" || crc=$?
      if [ "$crc" -ne 0 ]; then
        echo "update: warning: the crash listing was not measured (systemctl --user list-units \"claude-session@*\" --state=activating,failed --plain --no-legend failed, rc $crc), so a crash-looping supervisor among the units missing from the active listing is only warned about below — none of them is verified or claimed healthy" >&2
      else
        while read -r cu _cl cw _cs _cd; do
          [ -n "$cu" ] || continue
          for m in "${missing[@]}"; do
            if [ "$m" = "$cu" ]; then
              units+=("$cu")
              echo "update: sweep: $cu was active before try-restart and reads '$cw' after it — it is verified with the rest (wave 11, D-3984)" >&2
              break
            fi
          done
        done <<< "$clist"
      fi
    fi
  fi
  if [ -f "$verify" ] && [ "${#units[@]}" -gt 0 ]; then
    # A SIGKILLed sweep leaves its dir (nothing runs on SIGKILL): remove every one whose recorded owner is gone (D-3972 g).
    for d in "${TMPDIR:-/tmp}"/ccrc-sweep.*; do
      { [ -d "$d" ] && [ ! -L "$d" ]; } || continue
      o=""; [ -f "$d/owner" ] && IFS= read -r o < "$d/owner"
      case "$o" in ''|*[!0-9]*) continue ;; esac
      kill -0 "$o" 2>/dev/null && continue
      rm -rf -- "$d"
    done
    if vdir="$(mktemp -d "${TMPDIR:-/tmp}/ccrc-sweep.XXXXXX" 2>/dev/null)" && [ -d "$vdir" ] && printf '%s\n' "$$" >"$vdir/owner" 2>/dev/null; then
      _exit_add "_upd_sweep_kill $(printf '%q' "$vdir"); rm -rf -- $(printf '%q' "$vdir")"
    else
      [ -z "$vdir" ] || rm -rf -- "$vdir"
      vdir=""
      echo "update: warning: no scratch directory for the verify (mktemp -d under ${TMPDIR:-/tmp} failed) — the supervisors are verified one at a time, as before wave 11" >&2
    fi
    i=0
    while [ "$i" -lt "${#units[@]}" ]; do
      crash=(); unrec=()
      if [ -n "$vdir" ]; then
        j=$((i + vjobs)); [ "$j" -le "${#units[@]}" ] || j=${#units[@]}
        lrc=0; ( _upd_sweep_launch "$vdir" "$verify" "$i" "$j" ) 2>"$vdir/launch.err" || lrc=$?
        if [ "$lrc" -ne 0 ]; then
          _upd_sweep_kill "$vdir"
          echo "update: warning: the verify launcher exited $lrc — each unit of this batch with no recorded result is verified alone, in the foreground" >&2
          _upd_sweep_replay "$vdir/launch.err" 2
        fi
        for ((k = i; k < j; k++)); do
          : >"$vdir/$k.done"   # this job's chunk is read: no later kill signals it (verify L1)
          r=""; [ -f "$vdir/$k.rc" ] && IFS= read -r r < "$vdir/$k.rc"
          _upd_sweep_replay "$vdir/$k.out" 1; _upd_sweep_replay "$vdir/$k.err" 2
          case "$r" in
            0) ;;
            ''|*[!0-9]*) unrec+=("$k") ;;
            *) if _upd_sweep_spo "$vdir/$k.out"; then ncfail+=("${units[k]}"); else crash+=("$k"); fi ;;
          esac
        done
        # A unit with no recorded result (its launcher failed, or its rc could not be written) gets its FIRST verify
        # here, alone, in the foreground; a crash-like failure of it is re-checked by the same rule as any other (13:58).
        for k in ${unrec[@]+"${unrec[@]}"}; do
          echo "update: sweep: ${units[k]} recorded no result; verifying it alone, in the foreground — this is its first verify (wave 11, D-3983)" >&2
          r=0; bash "$verify" "${units[k]}" || r=$?
          [ "$r" -eq 0 ] || crash+=("$k")
        done
      else
        j=$((i + 1))
        r=0; bash "$verify" "${units[i]}" || r=$?
        [ "$r" -eq 0 ] || crash+=("$i")
      fi
      # THE RE-CHECK, which STOPS AT THE FIRST THAT FAILS (13:58, Reading 17): re-checks run one at a time in the
      # foreground, so a crash-looping fleet fails after one of them, never after N; a re-check that passes goes on.
      for k in ${crash[@]+"${crash[@]}"}; do
        kc=$((kc + 1))
        if [ -n "$rfail" ]; then
          mn=$((mn + 1))
          echo "update: sweep: re-check: ${units[k]} failed its first verify and is not re-checked — a re-check already failed, so this update fails (wave 11, D-3983)" >&2
          continue
        fi
        echo "update: sweep: re-check: ${units[k]} — its first verify did not pass; verifying it once more, alone (wave 11, D-3983)" >&2
        r=0; bash "$verify" "${units[k]}" || r=$?
        if [ "$r" -eq 0 ]; then
          echo "update: sweep: re-check: ${units[k]} passed its re-check — counted as a transient failure, not fatal" >&2
        else
          rfail="${units[k]}"
          echo "update: sweep: re-check: ${units[k]} failed its re-check too — read: systemctl --user status ${units[k]}" >&2
        fi
      done
      i=$j
    done
    [ -z "$vdir" ] || rm -rf -- "$vdir"
  fi
  after=(${units[@]+"${units[@]}"})
  if [ -n "$rfail" ]; then
    _upd_sweep_die "sweep: $kc of ${#units[@]} supervisors did not stay up on a first verify; a re-check failed, $mn left un-re-checked — install complete, nothing was rolled back (first failed re-check: $rfail); read: systemctl --user status $rfail"
  elif [ "${#ncfail[@]}" -gt 0 ]; then
    _upd_sweep_die "sweep: ${#ncfail[@]} of ${#units[@]} supervisors exited non-zero after a 'stopped on purpose' line, never re-checked — install complete, nothing was rolled back (first: ${ncfail[0]}); read: systemctl --user status ${ncfail[0]}"
  fi
```
- **The fallback.** The no-scratch call `bash "$verify" "${units[i]}" || r=$?` is today's call exactly: foreground, inherited stdin and streams (attack P5). So is the re-check call.
- Item G's loop and the two close lines below stay byte-identical. Units verified through D-3984 are in `after`, so item G does not warn about them.
- The new locals are declared once, with the arm's others.
- The fallback's first call, and the foreground first call of a unit with no recorded result, are uncaptured, so their `stopped on purpose:` text cannot be read. Every non-zero first call there is crash-like (D-3983).
- **The re-checks stop at the first that fails** (Reading 17). A crash-like unit met after that is counted and named, never re-checked, and later batches still get their concurrent first pass.
- **The die gives three counts** (13:58), facts first:
  - `kc`, the units crash-like on their first verify;
  - `rfail`, the first unit whose re-check failed;
  - `mn`, the crash-like units left un-re-checked.

  A non-crash-like failure, with no failed re-check, has its own die line.
- **The launcher's own stderr** (`launch.err`) holds `set -m`'s `[1]+ Done …` notices and any `fork:` error. It is replayed only when the launcher fails.

**The frozen S0 fixture:** `git show v0.0.79:deploy/verify-service.sh > server/test/fixtures/verify-service-pre-wave10.sh`. That is 107 lines, sha256 `fae9a23fc312a8f11b782e976a7fdca934e47401d39c9feb21f055513dfcdcd3`, the same at v0.0.60. It has no header: its bytes are the pin. Its provenance comment lives in `sweepFixture.ts` beside `FROZEN_VERIFY_S0`.

**The cases** (`server/test/ccrc-sweep-window.test.ts`):
- Every case is `itLinux(…, 60_000)` and runs `runSweep(box)`: this tree's sweep and this tree's script, unless the row says otherwise.
- Units are `claude-session@demo-a.service`, `demo-b`, `demo-c` and `demo-d`.
- "stable" means `['active']`/`['<4000+i>']`, and "churn" means `['active']`/`['111','222','333','444']`: every read a new pid, so the first call AND the re-check fail.
- A "stamp" or "purged" plant is wave 10's.
- "No re-check" means stderr has no `update: sweep: re-check:` line.

| # | Case | Plant | Expected |
|---|---|---|---|
| W0 | the shape (text) | reads `CCRC_SRC`. The Linux arm is the body after the Darwin arm's close, split exactly as `single-definition.test.ts`'s `updSweepArms` splits it (`indexOf('"$CCD_OS" = darwin')`, then `indexOf('\n  fi', d0)`) | The Linux arm holds `local verify="$BOX_TREE_DIR/deploy/verify-service.sh"`, `CCRC_SWEEP_VERIFY_JOBS:-128` and `--state=activating,failed`. Across the Linux arm and `_upd_sweep_launch`'s body, `bash "$verify"` occurs exactly 4 times (the job, an unrecorded unit's first verify, the fallback's, the re-check), each followed by one quoted `"${units[i]}"` or `"${units[k]}"` and then not by another `"`: every call passes one unit. The Linux arm holds no `_ccrc_die`. `_upd_sweep_die`'s body holds `! _upd_report_is_mine` and `_ccrc_die "$@"`. `_upd_sweep_launch`'s holds `set -m`. `_upd_sweep_kill`'s holds `[ "$p" -gt 1 ] \|\| continue` (the refusal of a pid of 1 or less, which no case may exercise: T6-K3). The arm's `_exit_add` string holds `_upd_sweep_kill`, and the arm holds `[ -n "$rfail" ]` (the stop) |
| W1 | ONE shared window | 3 stable; gates: each unit's 2nd `is-active` waits for `firstPids: 3`, bound 50 tenths, `onTimeout: 'failed'` | rc 0; `SWEEP_OK`; no re-check. A serial verify would fail each first call at the barrier and pass on the re-check, so "no re-check" is what pins the window (measured) |
| W2 | the bound | `env: { CCRC_SWEEP_VERIFY_JOBS: '2' }`; 3 stable; gates: demo-a's and demo-b's 2nd `is-active` wait for demo-c's 1st `is-active`, bound 30 tenths, `onTimeout: 'answer'` | rc 0; the index of demo-c's first `is-active` in `calls` is greater than the index of demo-a's and demo-b's second `show -p MainPID` |
| W2b | `it.each` `0`, `abc`, `-1`, `99999`: an invalid bound reads as 128 | W1's plant; `CCRC_SWEEP_VERIFY_JOBS` = X | rc 0; no re-check; `code` is not -1 |
| W3 | `it.each` jobs `1`, `128`: every unit is verified after a failure | demo-a churn, demo-b and demo-c stable | rc 1. demo-a has 4 `show -p MainPID` calls (first call plus re-check), demo-b and demo-c 2 each. stderr has `ccrc: sweep: 1 of 3 supervisors did not stay up on a first verify; a re-check failed, 0 left un-re-checked — install complete, nothing was rolled back (first failed re-check: claude-session@demo-a.service); read: systemctl --user status claude-session@demo-a.service` |
| W4 | the FIRST failed re-check is named, and the stop leaves the rest un-re-checked | demo-a an unstamped stop (`['active','inactive']`, `demo-a.uuid`: still down at its re-check), demo-b stable, demo-c churn | rc 1. stderr holds `update: sweep: re-check: claude-session@demo-a.service failed its re-check too` BEFORE `update: sweep: re-check: claude-session@demo-c.service failed its first verify and is not re-checked`. demo-c has 2 `show -p MainPID` calls. The die says `2 of 3`, `1 left un-re-checked` and `(first failed re-check: claude-session@demo-a.service)` (measured on the prototype) |
| W5 | the die is this run's `failed` report, from its own shell (I8) | `report: { pid: 4242 }`; `reporting: { pid: 4242 }`; demo-a churn, demo-b stable | rc 1; `update.json`'s `phase` is `failed`, and its `detail` starts `sweep: 1 of 2 supervisors did not stay up on a first verify; a re-check failed, 0 left un-re-checked - install complete, nothing was rolled back (first failed re-check: claude-session@demo-a`; stdout has no `update: sweep: every live` |
| W6 | a foreign report survives | `report: { pid: 999999, phase: 'resolving' }`; `reporting: { pid: 4242 }`; demo-a churn | rc 1; `update.json` byte-identical to the plant; stdout has `update: report: skipped — ~/.ccrc/update.json no longer names this run's pid (4242); a newer update took the lock this run released before the sweep, and this run's failed report would have overwritten its in-flight one` |
| W7 | the 200-character cap keeps the facts, and truncates the unit (the critic's M1, attack P3) | one unit `claude-session@demo-<35 x>.service`, churn; reporting as W5 | `detail.length` ≤ 200. `detail` contains `1 of 1`, `did not stay up`, `0 left un-re-checked`, `nothing was rolled back` and `(first failed re-check: claude-session@`. stderr's `ccrc: sweep:` line holds the full unit name and ends `read: systemctl --user status <unit>` |
| W8 | no backup is promised | W5's plant | neither stderr nor `update.json`'s `detail` contains `backup` |
| W9 | stdout is replayed in listing order | demo-a stable; demo-b stamped stop; demo-c purged and inactive at its settle read (`['inactive','inactive']`, `listed: 'active'`, registry `demo-c.generation`); demo-d stable | rc 0; no re-check. stdout's lines matching `^(verified\|stopped on purpose):` are exactly: `verified: …demo-a…`, the stamped line for demo-b, the purged line for demo-c, `verified: …demo-d…`. `SWEEP_OK` is stdout's last line |
| W10 | stderr dumps never interleave, deterministically (T-3) | demo-a churn, demo-b stable, demo-c churn; `journalGate: { unit: demo-a, line: '--user status --no-pager --lines=0 claude-session@demo-c.service' }`, so demo-a's journal output waits until demo-c has begun its own dump | stderr's FIRST `fixture journal line for claude-session@demo-a.service` comes before its first `## DEPLOY FAILED — claude-session@demo-c.service` |
| W11 | the scratch dir is removed, and nothing outlives the run (T-1, P6) | (a) 3 stable, `tail: 'ls -A "$TMPDIR" > "$HOME/tmp-after"'`; (b) demo-a churn; (c) 2 stable, a gate holding demo-a's 2nd `is-active` until demo-z's 1st (it never comes), bound 100 tenths, `onTimeout: 'answer'`; `runSweep` with `timeout: 3_000`, `killSignal: 'SIGTERM'` (the main pid only, never `timeout(1)`) | (a) rc 0; `tmp-after` holds only nothing (in the same shell, before exit). (b) rc 1; `<home>/tmp` empty after the spawn. (c) the spawn was killed. 0.5 s after it returns, the case collects `found = survivors(box)` and `left = readdirSync(<home>/tmp)`, runs `reapSurvivors(box)`, and only then asserts: `left` holds no `ccrc-sweep.*`, and `found` is empty (measured 0; 5 with the kill removed). Collect, reap, assert: the Global Constraint's order (T-1) |
| W12 | no scratch dir: today's calls, one at a time, re-check included (P5) | `tmpdir: 'file'`; demo-a stable; demo-b the 22:06 shape (W14's activating row); gate: demo-a's 2nd `is-active` waits for demo-b's 1st `is-active`, bound 30 tenths, `onTimeout: 'answer'` | rc 0. stderr has `update: warning: no scratch directory for the verify` and `re-check: claude-session@demo-b.service passed its re-check`. Counted from the `--state=active` listing line onward (the KillMode preflight names every unit first, attack T-6), demo-b's first call comes after demo-a's last |
| W13 | an unrecorded rc is never a verdict: the unit gets its first verify in the foreground, then the same re-check (D-3972 d; F7; Reading 18) | 1 unit. `verifySrc` = a fixture that appends `$1` to `$HOME/fixture-calls`, reads `readlink "/proc/$$/fd/1"`, and when that names `*/ccrc-sweep.*/*.out`, makes `${out%.out}.rc` a DIRECTORY (so the job's rc write fails) and exits 0. Otherwise (a foreground call) it prints `verified: <unit> (foreground)` and exits (a) 0 or (b) 1 | (a) rc 0; 2 fixture calls; stderr has `recorded no result; verifying it alone, in the foreground`; no re-check. (b) rc 1; 3 fixture calls (the job, the foreground first verify, its one re-check); the die says `1 of 1` (both measured on the prototype) |
| W14 | `it.each` the recorded 2026-10-04 22:06 shape passes on the re-check (D-3983) | demo-a and demo-c stable. demo-b is either `['active','activating','active','active']`/`['111','222','222']` (activating at p2, then up) or `['active','active','active','active']`/`['111','222','333','333']` (a new MainPID at p2, then stable) | rc 0; `SWEEP_OK`. stderr has `update: sweep: re-check: claude-session@demo-b.service — its first verify did not pass` and `… passed its re-check — counted as a transient failure, not fatal`. demo-b has exactly 4 `is-active` calls |
| W15 | a build that crash-loops every unit makes exactly ONE re-check call, then dies (Reading 17) | 3 units, each churn | rc 1. Exactly one `verifying it once more, alone` line (demo-a's) and one `failed its re-check too`, then two `failed its first verify and is not re-checked` lines (demo-b, demo-c). demo-a has 4 `show -p MainPID` calls, demo-b and demo-c 2 each. The die says `3 of 3` and `2 left un-re-checked` (measured on the prototype) |
| W16 | a non-crash-like failure is not re-checked (D-3983's second clause) | 1 unit; `verifySrc` = a fixture that appends `$1` to `$HOME/fixture-calls`, prints `stopped on purpose: <unit> (fixture)` and exits 1 | rc 1; exactly 1 fixture call; no re-check |
| W17 | crash-shaped units are verified, with the re-check (D-3984; attack F4) | none `active` after the restart: demo-a `listed: 'crash:activating'` (`['activating']`), demo-b `listed: 'crash:failed'` (`['failed']`), demo-c `listed: 'crash:activating'` (`['activating']`) | rc 1; three `reads 'activating'`/`reads 'failed'` lines; exactly one re-check call (the stop); the die says `3 of 3` and `2 left un-re-checked`; `calls` holds `--user list-units claude-session@* --state=activating,failed --plain --no-legend` exactly once. Before this wave: rc 0 with item G's warnings |
| W17b | a unit `inactive` after the restart keeps item G's warning | demo-a stable; demo-b `listed: 'gone'` | rc 0; stderr has item G's `claude-session@demo-b.service was active before try-restart and is not active after it`; `SWEEP_OK`; the crash listing queried once; demo-b never verified |
| W17c | the crash listing cannot be read: one pinned line, then today's warnings (Reading 19) | demo-a stable; demo-b `listed: 'crash:activating'`; `crashListingRc: 94` | rc 0. stderr has, exactly, `update: warning: the crash listing was not measured (systemctl --user list-units "claude-session@*" --state=activating,failed --plain --no-legend failed, rc 94), so a crash-looping supervisor among the units missing from the active listing is only warned about below — none of them is verified or claimed healthy`, and after it item G's warning for demo-b. demo-b is never verified |
| W17d | nothing missing: no crash listing | 3 stable | `calls` has no `--state=activating,failed` line (so `ccrc-update.test.ts`'s argv-order pin is untouched) |
| W18 | a failed launch cannot end the run (P1) | 3 stable; `pre` shadows `_upd_sweep_launch` with a copy that starts only unit `$3`'s job, waits, prints `fork: Resource temporarily unavailable` to stderr and `exit 254` | rc 0; stderr has `update: warning: the verify launcher exited 254` and two `recorded no result; verifying it alone, in the foreground` lines (demo-b, demo-c); no re-check; `SWEEP_OK` (measured on the prototype) |
| W18b | a never-started unit gets the same re-check (Reading 18) | W18's `pre`; demo-a stable; demo-b W14's activating row; demo-c stable | rc 0; demo-b's foreground first verify fails crash-like, and stderr then has `re-check: claude-session@demo-b.service passed its re-check` (measured on the prototype) |
| W19 | stale scratch dirs (P4) | 1 stable; before the sweep, `<home>/tmp/ccrc-sweep.STALE1/owner` = the pid of a process that has exited (spawn `true`, wait), `ccrc-sweep.LIVE1/owner` = `process.pid`, and `ccrc-sweep.NOOWNER/` with no owner file | rc 0; afterwards `<home>/tmp` holds exactly `ccrc-sweep.LIVE1` and `ccrc-sweep.NOOWNER` |
| W20 | `it.each` (a), (b): each job's group is signalled at most once, and never after its chunk was read (verify L1) | `pre` shadows `kill` with a function that appends `$*` to `$HOME/kill-log` when `$1` is `-TERM`, then runs `builtin kill "$@"`. (a) 3 stable; a gate holds demo-a's 2nd `is-active` until demo-z's 1st, bound 100 tenths, `onTimeout: 'answer'`. `pre` also shadows two helpers. `_upd_sweep_launch` becomes a copy that starts only unit `$3`'s job, does NOT wait, prints `fork: Resource temporarily unavailable` to stderr and runs `exit 254`. `_upd_sweep_replay`, called on `*/launch.err`, runs `builtin kill -TERM $$`, so the sweep's own SIGTERM lands after the launcher's kill and before the chunk is read. (b) 1 unit; `verifySrc` = a fixture that appends `$1` to `$HOME/fixture-calls`. When its stdout names `*/ccrc-sweep.*/*.out`, it makes `${out%.out}.rc` a symlink to a path that does not exist and exits 0, so the job's rc write fails and `-e` reads false. Otherwise (the foreground first verify) it runs `kill -TERM "$PPID"` and exits 1 | The sweep ends on its own SIGTERM, well inside the spawn timeout (not code -1). Then collect, reap and assert, in the Global Constraint's order: no `ccrc-sweep.*` in `<home>/tmp`, and no survivor. (a) `kill-log` holds exactly one `-TERM -- -<n>` line, the launcher's kill; the exit chain does not signal that group again. (b) 2 fixture calls, and `kill-log` is empty: the exit chain does not signal the finished job's group. Both measured on the prototype, stable over 9 runs |
| R0 | the frozen S0 is v0.0.79's script | reads `FROZEN_VERIFY_S0` | sha256 `fae9a23f…dcd3`; 107 lines; no `stopped_on_purpose` |
| R1 | NEW sweep + S0: every unit is verified (the critic's B2) | `verifySrc: FROZEN_VERIFY_S0`; demo-a stable, demo-b churn | rc 1; demo-b has 4 `show -p MainPID` calls; the die says `1 of 2` and `(first failed re-check: claude-session@demo-b.service)`; stderr has no `recorded no result` line, because each unit had a job of its own (T6-16's behavioural pin) |
| R2 | NEW sweep + S0: a stop still down at its re-check fails (no classifier before wave 10; a rollback to ≤ v0.0.79) | `verifySrc: FROZEN_VERIFY_S0`; demo-a stable; demo-b `['active','inactive']` with a stamp | rc 1; the die says `1 of 2` |
| R3 | NEW sweep + S0: the re-check works with an older script | `verifySrc: FROZEN_VERIFY_S0`; demo-a stable; demo-b W14's activating row | rc 0; `passed its re-check` for demo-b |

After every W- and R-case, no `*-poison` file exists.

- [ ] **Step 1: Re-measure:**
  ```bash
  grep -nF '  for u in $(printf '"'"'%s\n'"'"' "$after_listing" | awk '"'"'{print $1}'"'"'); do' ccd/ccrc   # :20963
  grep -nF '|| _ccrc_die "$u was restarted and did not stay up — read: systemctl --user status $u. The pre-update backup is complete at $UPD_BACKUP_DIR"' ccd/ccrc   # :20966
  grep -nF '|| _ccrc_die "systemctl --user try-restart claude-session@* failed' ccd/ccrc   # :20935
  grep -n '^_upd_report_is_mine() {\|^_exit_add() {\|^_upd_sweep() {' ccd/ccrc          # :21007 :2400 :20813
  grep -nF 's="${s:0:200}"' ccd/ccrc                                                       # :18422
  grep -n '_upd_phase restarting' ccd/ccrc                                                 # :17133 :17656
  git show v0.0.79:deploy/verify-service.sh | sha256sum                                    # fae9a23f…dcd3
  ```
  Also re-measure that no `ccrc-update.test.ts` sweep case packs a tree that carries `deploy/verify-service.sh` AND leaves a pre-restart unit out of `fixture-sweep-active`. Only such a case would reach the crash listing, and that file's stub answers `--state=activating,failed` with `unexpected argv`, exit 90. Measured at `00f8a193`: every sweep case uses the stub tree, which has no `deploy/`.
- [ ] **Step 2: Red first.** Create the S0 fixture and the file. Run `cd server && ./node_modules/.bin/vitest run test/ccrc-sweep-window.test.ts`. **Expected red on the Task 5 tip** (today's serial sweep):
  - W0 (no `units[k]`, a `_ccrc_die` present, no crash listing);
  - W1 and W2b ×4 (serial: the barrier fails the first unit, and today's die fires);
  - W3 ×2 (demo-b and demo-c have 0 `show` calls; the die text);
  - W4, W5, W7 and W8 (the die text, `backup`);
  - W6 (today's die overwrites the foreign report);
  - W10 (today the first failure ends the verify, so demo-c is never verified and its dump never prints);
  - W11(c) on `survivors` (today the TERMed shell leaves its foreground verify running; its tmp half is green, since no scratch dir exists today);
  - W12 (no warning; demo-b fails with no re-check);
  - W13 (a) and (b) on the fixture's call count (1, not 2 or 3; the job-side rc trick never applies today), and (b) on the die text too;
  - W14 ×2 and R3 (rc 1: no re-check);
  - W15 (no re-check line at all; the die text);
  - W17 (rc 0: none is verified), W17b (no crash listing is ever queried) and W17c (no `the crash listing was not measured` line);
  - W18 (rc 0, but no launcher warning: there is no `_upd_sweep_launch` to shadow) and W18b (rc 1: demo-b dies in today's loop);
  - W19 (stale dirs stay);
  - W20 (a) and (b) (measured on the prototype against `origin/main`'s serial sweep). There is no launcher or replay to shadow, and no kill. So (a)'s gate holds and the run ends with no SIGTERM and no `kill-log` line. In (b), the one foreground call signals the sweep: 1 fixture call, not 2;
  - R1 (demo-b's `show` count, 2 not 4, and the die text) and R2 (the die text).
  - **Expected green on today's shape:** W2 (serial satisfies its order), W9, W11(a), W11(b), W16 (today it fails with one call and no re-check, which is what W16 pins), W17d and R0.
  - Record each red's assertion. Do not commit the reds alone unless the workspace convention allows it.
- [ ] **Step 3: Implement** the helpers and the block.
  - `bash -n ccd/ccrc` must print nothing.
  - The function must still match `/_upd_sweep\(\) \{([\s\S]*?)\n\}/`, with `updSweepArms` splitting it.
  - Run `ccrc-sweep-window`, `ccrc-sweep-deliberate-stop`, `single-definition -t "supervisor sweep"`, `runbook-holds` and `ccrc-update -t "supervisor sweep"`, one call each, each `-t` part reporting a non-zero pass count. **Expected:** all green.
- [ ] **Step 4: `session-hook`**, and S6-R11 if `byFile` moved.
- [ ] **Step 5: Mutation table.** Mutate `ccd/ccrc` in place, `cp` and `cmp` around each row. `git status --porcelain` must show only the intended files.

  | # | Guard | Mutation | Goes red (full expected set) | Command |
  |---|---|---|---|---|
  | T6-1 | concurrency *(prototype)* | `vjobs=1` forced after the regex line | W1, W2b ×4 (re-check lines appear; rc stays 0) and W18 (one unit per batch, so W18's shadow starts every unit and no `recorded no result` line appears) (all measured). W2 stays green: serial also satisfies its order | `cd server && ./node_modules/.bin/vitest run test/ccrc-sweep-window.test.ts` |
  | T6-2 | the bound | `j=$((i + vjobs))` becomes `j=${#units[@]}` | W2 (demo-c starts at once) | same |
  | T6-3 | the bound's validation *(prototype)* | delete the `[[ "$vjobs" =~ … ]] \|\| vjobs=128` line | W2b `0` and `-1` (no progress: spawn timeout, code -1, measured), `abc` (code 127, `abc: unbound variable`, measured); W2b `99999` green | same |
  | T6-4 | every unit verified *(prototype)* | add `[ -z "$rfail" ] \|\| break` after `i=$j` | W3 jobs `1` (demo-c gets 0 `show` calls, measured); W3 jobs `128` green | same |
  | T6-5 | the first failed re-check is the one named *(prototype)* | `rfail="${units[k]}"` becomes `rfail="${units[$((j - 1))]}"` (the batch's last unit) | W3 jobs `128` and W4 (`first failed re-check: …demo-c`), and W5 (its detail names demo-b) (all measured). W3 jobs `1` stays green: in a one-unit batch the last unit is the unit itself | same |
  | T6-6 | no die in a subshell (I8) *(prototype)* | wrap BOTH of the Linux arm's verdict dies, the `rfail` die and the `ncfail` die, in `( … )` | W3 ×2, W4, W5 (rc 0, phase still `restarting`, the success line), W6, W7, W11(b), W13(b), W15, W17, R1 and R2 through the `rfail` die, and W16 through the `ncfail` die; each rc 0, or no `failed` phase (all measured). Wrapping the `rfail` die alone leaves W16 green (measured) | same |
  | T6-7 | the ownership guard | `if [ "${UPD_REPORTING:-0}" = 1 ] && ! _upd_report_is_mine; then` becomes `if false; then` | W6 (overwritten) | same |
  | T6-8 | facts first under the cap | move `(first failed re-check: $rfail)` to just after `did not stay up on a first verify` | W7 (`nothing was rolled back` cut for a 40-char id), W3's and W5's exact texts | same |
  | T6-9 | no backup claim | append `. The pre-update backup is complete at $UPD_BACKUP_DIR` to the die | W8, W3's exact text | same |
  | T6-10 | stdout replay | delete `_upd_sweep_replay "$vdir/$k.out" 1;` | W9 | same |
  | T6-11 | stderr replay | delete `_upd_sweep_replay "$vdir/$k.err" 2` | W10 (demo-a's dump missing) | same |
  | T6-11b | the per-job capture (T-3) *(prototype)* | in `_upd_sweep_launch`, the job line becomes `{ bash "$verify" "${units[k]}" </dev/null; printf '%s\n' "$?" >"$vdir/$k.rc"; } &`, and the sweep's `2>"$vdir/launch.err"` on the launcher is dropped | W10 (4 of 4 red, measured: demo-a's journal line lands after demo-c's banner). W9 may red; it is not claimed | same |
  | T6-12 | removal before return | delete `[ -z "$vdir" ] \|\| rm -rf -- "$vdir"` | W11(a). W11(b) stays green: the exit chain removes it on the die | same |
  | T6-13a | the exit path kills its jobs (T-1) *(prototype)* | the `_exit_add` string becomes `"rm -rf -- $(printf '%q' "$vdir")"` | W11(c) (`survivors` non-empty: 5 measured) | same |
  | T6-13b | the exit-chain arm at all | replace the `_exit_add` line with `:` (an empty `then` would not parse) | W11(c) (a `ccrc-sweep.*` left, and survivors) | same |
  | T6-14 | the fallback is serial and foreground (P5) | in the fallback arm, first start every remaining unit in the background (`for ((k = i; k < ${#units[@]}; k++)); do bash "$verify" "${units[k]}" & done; wait`), then set `j=${#units[@]}` and record each as passed | W12 (order: demo-b's first call comes before demo-a's last) | same |
  | T6-15 | an unrecorded rc is never a pass *(prototype)* | `''\|*[!0-9]*) unrec+=("$k") ;;` becomes `''\|*[!0-9]*) ;;` | W13(a) (1 fixture call, not 2), W13(b) (rc 0), W18 (no `recorded no result` lines), W18b (no `passed its re-check`) and W20(b) (no foreground call, so no SIGTERM end) (all measured) | same |
  | T6-16 | one unit per call (B2) *(prototype)* | `_upd_sweep_launch`'s loop becomes one job, `bash "$verify" "${units[@]:$3:$(($4-$3))}"`, writing unit `$3`'s files only | W0 (no `"${units[k]}"` after the job's call); W1 and W2b ×4 (the one job verifies the batch serially, so the barrier fails its first unit and re-check lines appear); R1 on its `recorded no result` assertion (demo-b had no job of its own) (all measured). R1's rc, its `show` count (4) and its die text stay green: since Reading 18 an unrecorded unit gets a foreground first verify and then the re-check, so the rc-file design closes B2 a second time, and only W0 and that assertion tell this mutant apart | same |
  | T6-17 | the Linux arm's dies all go through the guard | the try-restart die back to `_ccrc_die` | W0 | same |
  | T6-18 | (Task 4's T4-5) the cross-version file runs the frozen sweep | `runSweep` ignores `frozen` | X2, X3, X3b, X4 (the new die text and the new log; X0, X0b and X0c read files and stay green) | `… test/ccrc-sweep-deliberate-stop.test.ts` |
  | T6-R1 | the re-check (D-3983) *(prototype)* | in the re-check loop, `r=0; bash "$verify" "${units[k]}" \|\| r=$?` becomes `r=1` | W14 ×2 (rc 1), W12, W18b and R3 (no `passed its re-check`), and on the call counts W3 ×2 and W15 (demo-a 2 `show` calls, not 4), W13(b) (2 fixture calls, not 3) and R1 (demo-b 2 `show` calls, not 4) (all measured) | same |
  | T6-R2 | an unrecorded unit gets a first verify before any re-check (Reading 18) *(prototype)* | `''\|*[!0-9]*) unrec+=("$k") ;;` becomes `''\|*[!0-9]*) crash+=("$k") ;;` (straight to the re-check) | W13(a) (a `re-check:` line, and no `recorded no result` line), W13(b) (2 fixture calls, not 3), W18 (two `re-check:` lines and no `recorded no result` line), W18b (rc 1: demo-b's one call is a re-check, and it fails) (all measured) | same |
  | T6-R3 | only a crash-like failure is re-checked *(prototype)* | `*) if _upd_sweep_spo "$vdir/$k.out"; then ncfail+=("${units[k]}"); else crash+=("$k"); fi ;;` becomes `*) crash+=("$k") ;;` | W16 (2 fixture calls, not 1, measured) | same |
  | T6-R4 | the re-check is named | delete the `passed its re-check` echo | W14 ×2, W12, W18b, R3 | same |
  | T6-R5 | **the stop at the first failed re-check** (Reading 17) *(prototype)* | `if [ -n "$rfail" ]; then` (in the re-check loop) becomes `if false; then` | W15 (3 `verifying it once more` lines, not 1, measured), W17 (3 re-checks), W4 (demo-c re-checked) | same |
  | T6-R6 | **a never-started unit's failed first verify is re-checked** (Reading 18) *(prototype)* | in the unrecorded loop, `[ "$r" -eq 0 ] \|\| crash+=("$k")` becomes `[ "$r" -eq 0 ] \|\| rfail="${units[k]}"` | W18b (rc 1, measured), W13(b) (2 fixture calls, not 3) | same |
  | T6-C1 | the crash-shaped listing (D-3984) *(prototype)* | `if [ "${#missing[@]}" -gt 0 ]; then` (the listing's) becomes `if false; then` | W17 (rc 0), W17b (the crash listing never queried) and W17c (no pinned `not measured` line before item G's warning) (all measured). W0 stays green: the `--state=activating,failed` text is still in the arm | same |
  | T6-C2 | only crash-shaped units join *(prototype)* | before the listing, `units+=("${missing[@]}"); missing=()` (every missing unit verified) | W17 (no `reads 'activating'` lines; the crash listing never queried), W17b (rc 1: an unstamped `inactive` fails) and W17c (rc 1; no pinned line) (all measured) | same |
  | T6-C3 | a failed crash listing changes nothing | the `crc -ne 0` arm also does `units+=("${missing[@]}")` | W17c (rc 1) | same |
  | T6-C4 | no listing when nothing is missing | drop `if [ "${#missing[@]}" -gt 0 ]` (the listing always runs) | W17d | same |
  | T6-C5 | **an unmeasured crash listing is not silent** (Reading 19) | delete the `the crash listing was not measured` echo | W17c (its exact line) | same |
  | T6-P1 | a failed launch falls back *(prototype)* | after `_upd_sweep_kill "$vdir"` in the `lrc` arm, add `_upd_sweep_die "launcher"` | W18 (rc 1), W18b (rc 1) and W20(a) (it dies before its own SIGTERM) (all measured) | same |
  | T6-P4a | stale dirs are removed *(prototype)* | `rm -rf -- "$d"` in the stale loop becomes `:` | W19 (`STALE1` left, measured) | same |
  | T6-P4b | only a dead owner's *(prototype)* | delete `kill -0 "$o" 2>/dev/null && continue` | W19 (`LIVE1` removed, measured) | same |
  | T6-K1 | each job is signalled at most once (verify L1) *(prototype)* | delete `: >"${f%.pid}.killed"` in `_upd_sweep_kill` | W20(a) (two `-TERM` lines for one group, measured) | same |
  | T6-K2 | no signal after a chunk is read (verify L1) *(prototype)* | delete `: >"$vdir/$k.done"` in the result loop | W20(b) (one `-TERM` line, to the finished job's group, measured) | same |
  | T6-K3 | a pid of 1 or less is refused (verify L1) | delete `[ "$p" -gt 1 ] \|\| continue` in `_upd_sweep_kill` | W0 (text) only. No case plants such a pid file, and none may: under this mutant a planted `1` runs `kill -TERM -- -1`, which signals every process the user owns | same |

  Spawn timeouts are recorded as "code -1". T6-3's `0` and `-1` make no progress by design: the case's own 45 s spawn timeout ends them.
- [ ] **Step 6: Commit:** `fix(update): the sweep verifies every restarted supervisor in one shared window, re-checks a crash-like failure once, verifies units that came back crash-shaped, and dies naming how many failed without touching another run's report (wave 11, R12; D-3972, D-3973, D-3974, D-3982, D-3983, D-3984)`.

### Task 7: R12, Darwin: one shared window in-process, one re-check, the same die

**Files:** `ccd/ccrc` (`_ccrc_job_pid`'s twin header, `_ccrc_job_stayed_up`, `_upd_sweep`'s Darwin header and stay-up block), `server/test/ccrc-update.test.ts`.

**Safe under:** the NEW Darwin arm only. The move INTO wave 11 on a Mac runs the OLD arm. No Mac is centrally managed.

**Interfaces and code:**
```bash
_ccrc_job_stayed_up() {   # <unit>... -> 0 iff ONE pid held across ONE shared window for EVERY unit (wave 11, D-3975)
  # One settle, one pid read per job, one window, a second read per job. With ONE unit this is the call sequence and
  # the CCRC_STAYED_DETAIL the gate and `_inst_enable` have always had. With several: CCRC_STAYED_BAD lists the jobs
  # whose pid did not hold, CCRC_STAYED_WHY their details in the same order, and CCRC_STAYED_DETAIL is the first one's.
  local u i=0 d p2
  local -a p1=()
  CCRC_STAYED_BAD=(); CCRC_STAYED_WHY=(); CCRC_STAYED_DETAIL=""
  sleep "${CCRC_VERIFY_SETTLE:-3}"
  for u in "$@"; do p1+=("$(_ccrc_job_pid "$u")"); done
  sleep "${CCRC_VERIFY_WINDOW:-5}"
  for u in "$@"; do
    p2="$(_ccrc_job_pid "$u")"
    d="pid ${p1[i]:-none} -> ${p2:-none} across ${CCRC_VERIFY_SETTLE:-3}s+${CCRC_VERIFY_WINDOW:-5}s"
    [ "$#" -eq 1 ] && CCRC_STAYED_DETAIL="$d"
    if [ -z "${p1[i]}" ] || [ "${p1[i]}" != "$p2" ]; then
      CCRC_STAYED_BAD+=("$u"); CCRC_STAYED_WHY+=("$d")
      [ -n "$CCRC_STAYED_DETAIL" ] || CCRC_STAYED_DETAIL="$d"
    fi
    i=$((i + 1))
  done
  [ "${#CCRC_STAYED_BAD[@]}" -eq 0 ]
}
```
The Darwin arm's try-restart die (`:20867-20868`) becomes:

    || _upd_sweep_die "restarting $u failed — the supervisors' state is now mixed (the install completed and nothing was rolled back); read: $(_svc_status_hint "$u")"

The stay-up block's comment and loop (`:20870-20882`) become:
```bash
    # THE STAY-UP GATE — ONE shared window for every kicked job, then ONE re-check of each that failed (wave 11, R12;
    # D-3975, D-3983). kickstart's exit is the exit of the KICK, not of the process surviving it
    # (deploy/verify-service.sh's header, for systemd), so every kicked supervisor is re-measured — in this process,
    # because launchd has no script of its own to skew against a rollback (D-3972's reason for per-unit calls is
    # Linux's). A job whose pid did not hold is re-measured once more, alone, and fails the update only if that fails
    # too: every one is named, re-checks stop at the first that fails (Reading 17), and the die gives the counts (D-3974). NOT the Linux standard in one respect (D-3949): there
    # is no deliberate-stop classifier here, so a session stopped on purpose, still stopped at its re-check, fails the
    # update — launchd's observable for a deliberate bootout is also the start-limit emulation's, and no macOS box is
    # centrally managed.
    if [ "${#kicked[@]}" -gt 0 ] && ! _ccrc_job_stayed_up "${kicked[@]}"; then
      first=("${CCRC_STAYED_BAD[@]}"); firstwhy=("${CCRC_STAYED_WHY[@]}")
      for ((bi = 0; bi < ${#first[@]}; bi++)); do
        u="${first[bi]}"
        if [ -n "$dfail" ]; then   # the stop at the first failed re-check (13:58, Reading 17)
          dleft=$((dleft + 1))
          echo "update: sweep: re-check: $u did not stay up (${firstwhy[bi]}) and is not re-checked — a re-check already failed, so this update fails (wave 11, D-3983)" >&2
          continue
        fi
        echo "update: sweep: re-check: $u did not stay up (${firstwhy[bi]}) — re-measuring it once more, alone (wave 11, D-3983)" >&2
        if _ccrc_job_stayed_up "$u"; then
          echo "update: sweep: re-check: $u passed its re-check ($CCRC_STAYED_DETAIL) — counted as a transient failure, not fatal" >&2
        else
          dfail="$u"; dwhy="$CCRC_STAYED_DETAIL"
          echo "update: sweep: re-check: $u failed its re-check too ($CCRC_STAYED_DETAIL) — read: $(_svc_status_hint "$u")" >&2
        fi
      done
      [ -z "$dfail" ] || _upd_sweep_die "sweep: ${#first[@]} of ${#kicked[@]} launchd session jobs did not stay up on a first window; a re-check failed, $dleft left un-re-checked — install complete, nothing was rolled back (first failed re-check: $dfail, $dwhy); read: $(_svc_status_hint "$dfail")"
    fi
```
- The arm's `local u sid plist missing=0` line gains `bi dleft=0 dfail="" dwhy=""`, and a `local -a first=() firstwhy=()` line follows it.
- Item G's zero line and success line (`:20886-20890`) are byte-identical.
- The arm's header (`:20815`, "Same job, same guard, different observable") gains one sentence: the guard is the same, and the verify is not quite (no classifier, D-3949; a re-check, D-3983).
- `_ccrc_job_pid`'s twin header (`:20789-20795`, "… deploy/verify-service.sh, which reads systemd's vocabulary and stays the one implementation there") gains: "… and alone carries the deliberate-stop classifier (wave 10), so the arms differ there (D-3949, D-3975)".

**The `launchctl` stub** (`server/test/ccrc-update.test.ts:383-386`) gains two per-label churn knobs, additively:
- `app.ccrc.session.*) [ -f "$HOME/fixture-pid-churn" ] && churn=1 ;;` becomes `app.ccrc.session.*) { [ -f "$HOME/fixture-pid-churn" ] || [ -f "$HOME/fixture-pid-churn.$lbl" ]; } && churn=1 ;;`.
- `fixture-pid-churn-first.<lbl>`, holding K: the first K `print`s of that label after its `kickstart` answer churning pids, and later ones `4242`. The `kickstart` arm writes `$HOME/fx-kick.<lbl>` = 0, and each `print` of that label increments it.

**The cases** (beside G1c-direct, `:2925`):
- D0–D4 and D6–D8 are `it`, so they run on every platform, through `sourcedCcrc(home, 'CCD_OS=darwin; UPD_BACKUP_DIR="$HOME/ccrc-backups/fixture"; …; _upd_sweep')`, with `plantSessionPlist` for each job.
- `updateEnv` already sets `CCRC_VERIFY_SETTLE`/`WINDOW` to 0.

| # | Case | Plant | Expected |
|---|---|---|---|
| D0 | the Darwin arm's dies go through the guard (text) | reads `ccd/ccrc`; the Darwin arm, split as W0 splits it | it holds no `_ccrc_die`, and exactly two `_upd_sweep_die "` calls |
| D1 | ONE shared window | alpha, beta, gamma, loaded, stable | rc 0; stdout has `3 restarted and re-measured still up`; no `re-check:` line; the `launchctl-calls` lines after the last `kickstart` line are exactly six `print gui/<n>/app.ccrc.session.<id>` lines with ids alpha, beta, gamma, alpha, beta, gamma |
| D2 | a job that churns through its re-check is named, with the counts | D1's, plus `fixture-pid-churn.app.ccrc.session.beta` | rc 1. stderr has `update: sweep: re-check: claude-session@beta.service did not stay up (pid `, then `failed its re-check too`, and `ccrc: sweep: 1 of 3 launchd session jobs did not stay up on a first window; a re-check failed, 0 left un-re-checked — install complete, nothing was rolled back (first failed re-check: claude-session@beta.service, pid `. stderr has no `backup` |
| D3 | a foreign report survives the Darwin die | D2's, plus `update.json` naming pid 999999 (W6's body) and `UPD_REPORTING=1; UPD_REPORT_PID=4242; UPD_REPORT_TARGET=v0.0.85; UPD_FROM=auto; UPD_REPORT_STARTED=1` before `_upd_sweep` | rc 1; `update.json` byte-identical; stdout has `update: report: skipped — ` |
| D4 | the single-unit contract (the gate, `_inst_enable`) | alpha loaded; the script `CCD_OS=darwin; _ccrc_job_stayed_up claude-session@alpha.service; echo "rc=$? detail=$CCRC_STAYED_DETAIL"`, then the same with `fixture-pid-churn` | stable: stdout `rc=0 detail=pid 4242 -> 4242 across 0s+0s`, with exactly 2 `print` lines in `launchctl-calls`. Churn: `rc=1 detail=pid 4…` and `… across 0s+0s` |
| D5d | (`itDarwin`, the existing churn case at `:2973`, retitled `… FAILS the update, naming how many and the first job, and no backup no path restores (wave 11, D-3974)`) | as today (`fixture-pid-churn`: every print churns, so the re-check fails too) | not 0; `did not stay up`; `sweep: 1 of 1 launchd session jobs`; no `pre-update backup` |
| D6 | the Darwin cap keeps the facts (attack P3) | one job with a 31-character id (the live registry's longest, per the attack), churning; `UPD_REPORTING=1` as D3 with an own-pid report | `detail.length` ≤ 200, and `detail` contains `1 of 1`, `did not stay up` and `nothing was rolled back` |
| D7 | the re-check passes a job that recovered | D1's, plus `fixture-pid-churn-first.app.ccrc.session.beta` = `2` (its window's two reads churn, its re-check's are stable) | rc 0; stderr has `re-check: claude-session@beta.service passed its re-check`; stdout has `3 restarted and re-measured still up` |
| D8 | every job churning makes exactly ONE re-check, then dies (Reading 17) | D1's, plus `fixture-pid-churn` | rc 1; exactly one `re-measuring it once more, alone` line; two `and is not re-checked` lines; the die says `3 of 3` and `2 left un-re-checked` |

- [ ] **Step 1: Re-measure:**
  ```bash
  grep -nF '_ccrc_job_stayed_up() {   # <unit> -> 0 iff ONE pid held across the window' ccd/ccrc   # :20804
  grep -nF 'for u in ${kicked[@]+"${kicked[@]}"}; do' ccd/ccrc                                    # :20879
  grep -nF '_ccrc_job_stayed_up "$main" \' ccd/ccrc                                               # :14638
  grep -nF 'if ! _ccrc_job_stayed_up "$unit"; then' ccd/ccrc                                      # :19684
  grep -n "G1c-direct\|naming the pre-update backup\|app.ccrc.session.\*) \[ -f" server/test/ccrc-update.test.ts   # :2925 :2973 :385
  ```
- [ ] **Step 2: Red first.** Add D0–D4, D6–D8 and D5d's new assertions. Run `cd server && ./node_modules/.bin/vitest run test/ccrc-update.test.ts -t "supervisor sweep"` (one part; it must report a non-zero pass count).
  - **Expected red on the Task 6 tip:** D0 (two `_ccrc_die`), D1 (order a,a,b,b,c,c), D2 (the die text, `backup`), D3 (overwritten), D6 (the old text has no `nothing was rolled back`), D7 (no re-check: rc 1) and D8 (no re-check lines).
  - **Expected green:** D4. D5d is macOS only.
- [ ] **Step 3: Implement.** Then run, one call each:
  - `bash -n ccd/ccrc`;
  - the `updSweepArms` split (`single-definition -t "supervisor sweep"`);
  - `ccrc-update -t "supervisor sweep"`;
  - `ccrc-update` in full or in non-hollow parts;
  - `ccrc-install -t "[Dd]arwin"` (never `"Darwin\|darwin"`, which selects nothing: attack T-4);
  - `session-hook`.
- [ ] **Step 4: Mutation table.**

  | # | Guard | Mutation | Goes red | Command |
  |---|---|---|---|---|
  | T7-1 | one window | restore the per-unit loop (`for u in …; do _ccrc_job_stayed_up "$u" \|\| …; done`) with the new die | D1 (order) | `cd server && ./node_modules/.bin/vitest run test/ccrc-update.test.ts -t "supervisor sweep"` |
  | T7-2 | failures recorded *(prototype)* | delete `CCRC_STAYED_BAD+=("$u"); CCRC_STAYED_WHY+=("$d")` | D2 (rc 0), D3 (rc 0), D4's churn half (`rc=0`), D6 (no report written), D7 (no re-check, so no `passed its re-check` line) and D8 (rc 0) (measured); D5d on macOS. D1 and D4's stable half stay green | same |
  | T7-3 | the single-unit detail | `[ "$#" -eq 1 ] && CCRC_STAYED_DETAIL="$d"` deleted | D4 (stable: empty detail) | same |
  | T7-4 | the Darwin die's guard | the stay-up die back to `_ccrc_die` | D0, D3 | same |
  | T7-5 | no backup claim | append `. The pre-update backup is complete at $UPD_BACKUP_DIR` to the Darwin die | D2 (`backup`); D5d on macOS | same |
  | T7-6 | the Darwin re-check (D-3983) | `if _ccrc_job_stayed_up "$u"; then` becomes `if false; then` | D7 (rc 1) | same |
  | T7-8 | the Darwin stop at the first failed re-check (Reading 17) | `if [ -n "$dfail" ]; then` becomes `if false; then` | D8 (3 re-measurements, not 1) | same |
  | T7-7 | facts first under the cap | move `(first failed re-check: $dfail, $dwhy)` to just after `did not stay up on a first window` | D6, D2's exact text | same |
- [ ] **Step 5: Commit:** `fix(update): the Darwin sweep re-measures every kicked job in one shared window, re-checks each failure once, and fails with how many did not stay up, through the same report guard (wave 11, R12; D-3974, D-3975, D-3983)`.

### Task 8: prose: R13(e), R14(h), D-3949's deploy.sh comment

**Files:**
- `docs/superpowers/plans/2026-10-04-centralised-update-w10-verify-deliberate-stop.md:11`;
- `docs/superpowers/plans/2026-10-02-centralised-update-w9-stable-readiness.md:362`, `:364`;
- `deploy/deploy.sh:986`.

**Safe under:** no pairing. `deploy.sh`'s change is a comment.

- **R13(e), wave 10's plan `:11`:**
  - Was: "  - Every case in `agent/test/deploy-verify.test.ts` runs on a fixture HOME, the cases that exist today included."
  - Becomes: "  - Every case that executes `deploy/verify-service.sh` sets `HOME` to a `mkTmp` directory, the cases that exist today included; V20 runs with `HOME` unset on purpose, and the file's other spawns run other scripts (wave 11, R13e; the Global Constraint at `:134`)."
- **R14(h), wave 9's plan `:362`:**
  - Was: "  - No Linux verdict changes, and no Darwin verdict moves from rc 3 to a decided value. Measured by a differential fuzz of 2,500 file pairs × 2 keys … Every pin already ran under `LC_ALL=C`, so the shipped code now reads in the locale the tests assert."
  - Becomes: "  - The property (wave 11, R14h): no Linux verdict changes; on Darwin no verdict moves from rc 3 to a decided value, and every verdict that moves ends at bash's byte-wise answer. It was checked by differential fuzzes of `670d25fd` against the fix under `C` and `C.UTF-8`, and by review 269 against a bash 3.2.57 oracle running the launchd job's own line (no false ARMED under `C`, `C.UTF-8` or `en_US.UTF-8`). The fix's Darwin verdicts are identical under `C` and `C.UTF-8`. Every pin already ran under `LC_ALL=C`, so the shipped code now reads in the locale the tests assert."
- **Wave 9's plan `:364`** (the "Found and NOT changed" bullet) gains a last sentence: "Fixed in wave 11 (R14f, D-3979): `_box_unit_env`'s Linux arm reads bytes, and U4u's F2 row runs on both feeders."
  - The attack checked that this sentence does not start a line in the `- **D-N**` shape, so `deviation-refs`' DEFINED regex does not count it as a definition.
- **`deploy/deploy.sh:986`:**
  - Was: `  # the same standard as the agent itself: verify-service.sh, per unit —`
  - Becomes: `  # verify-service.sh, per unit, as the agent is (a session also passes stopped on purpose, D-3947) —`

  The line count is unchanged (Global Constraints check).

- [ ] **Step 1:** re-measure the three quotes with `grep -nF`.
- [ ] **Step 2:** edit. Run `cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts` (after `git fetch origin main`), `dtbd` and `topology-clean`, plus the agent `deploy-verify` file (it reads `deploy.sh`).
- [ ] **Step 3: Commit:** `docs(update): wave 10's summary sentence and wave 9's D-3833 bullet say what was measured, and deploy.sh's sweep comment says what a session's pass means (wave 11, R13e, R14h; D-3981, D-3949)`.

### Task 9: The gate and the PR

- [ ] **Step 1: Start from a merged, clean tree.**
  ```bash
  git status --porcelain
  git fetch origin main
  git merge-base --is-ancestor origin/main HEAD && echo "origin/main is in HEAD" || echo "MAIN MOVED"
  ```
  - On `MAIN MOVED`, run `git merge --no-edit origin/main`, keep both sides of every hunk, and record `git show --remerge-diff HEAD`.
  - If `main` changed `_upd_sweep`, `_box_unit_env`, `_box_env_shell_plain`, `_ccrc_job_stayed_up`, any of X0c's seven helpers or `deploy/verify-service.sh`, stop and report.
- [ ] **Step 2: Dependencies:** `npm ci` in `agent/`, `server/` and `pwa/`, wherever `node_modules` is absent.
- [ ] **Step 3: Agent,** in full (CI runs `test (agent)` in full):
  ```bash
  cd agent && ./node_modules/.bin/vitest run test/deploy-verify.test.ts
  cd agent && ./node_modules/.bin/vitest run
  ```
  `agent/tsconfig.json` does not type-check `test/`. `typecheck-tests` (Step 4) does.
- [ ] **Step 4: Server, one file per call,** foreground, timeout ≥ 600000 ms:
  - `ccrc-sweep-deliberate-stop`, `ccrc-sweep-window`;
  - `ccrc-update` and `ccrc-doctor`. Either may run in `-t` parts by the Global Constraints rule:
    - paren-free and disjoint patterns (no case matches two);
    - each part's PASSED count non-zero;
    - the parts' PASSED counts summing to the number of lines `vitest list test/<file>.test.ts` prints on this runner (list omits `itDarwin`/`skipIf` cases), or the union of the parts' passed titles from `--reporter=json` equal to `vitest list`'s titles. Record the sum, or the comparison, in the wave-done;
  - `ccrc-install`, `ccrc-cli`, `ccrc-containment`, `ccrc-uninstall`, `ccrc-install-graphify`, `ccrc-versioned-audit`, `build-release`;
  - `single-definition`, `runbook-holds`, `session-hook`, `platform-hazards`, `macos-platform`;
  - `typecheck-tests`, `topology-clean`, `dtbd`.

  Then run `cd server && ./node_modules/.bin/tsc --noEmit; echo "exit $?"`.
  - If the 1-minute load (`cat /proc/loadavg`) is under 20, also run the six shards in sequence with `TMPDIR="$SHARD_TMP"`. The sum of their `Test Files` must equal `find server/test -name '*.test.ts' | wc -l`. Otherwise, say in the wave-done that the shards were not run, and give the load.
  - A red in a known load flake (CLAUDE.md's list, `typecheck-tests` among them) is re-run IN ISOLATION before it is called a break.
- [ ] **Step 5: The ledger, scope and line guards, last:**
  ```bash
  git fetch origin main
  cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts
  git diff --stat origin/main...HEAD -- agent/src server/src pwa shared ccd/ccd ccd/ccrc-doctor-checks ccd/ccrc-adopt '*.service' '*.timer' deploy/systemd server/test/ccdWsHelpers.ts server/test/codexLaneFixture.ts server/test/installTreeFixture.ts server/test/containedTools.ts README.md CLAUDE.md agent/CLAUDE.md .github install.sh   # prints nothing
  git diff --stat origin/main...HEAD     # exactly File structure's New and Changed lists, plus server/test/session-hook.test.ts only if its condition fired
  diff <(git show origin/main:deploy/verify-service.sh | sed -n '1,62p') <(sed -n '1,62p' deploy/verify-service.sh)   # nothing
  diff <(git show origin/main:deploy/deploy.sh | grep -v '^\s*#') <(grep -v '^\s*#' deploy/deploy.sh)                 # nothing
  [ "$(git show origin/main:deploy/deploy.sh | wc -l)" = "$(wc -l < deploy/deploy.sh)" ] || echo MOVED                 # nothing
  [ "$(git show origin/main:ccd/ccrc | grep -E '^_ccrc_die\(\) \{.*\}$')" = "$(grep -E '^_ccrc_die\(\) \{.*\}$' ccd/ccrc)" ] || echo DIE-MOVED   # nothing
  bash -n ccd/ccrc; bash -n deploy/verify-service.sh; echo "exit $?"
  ```
- [ ] **Step 6: The PR,** from the workspace branch.
  - Its first paragraph says:
    - the merge goes live on both boxes by auto, fleet box first;
    - both boxes run v0.0.84 since 12:36 (the ack landed 12:21:44), so the move INTO this wave runs v0.0.84's OLD sweep with this script, and Task 4's X-cases prove that move protected on the frozen bytes;
    - the sweep half, re-check included, protects the moves after it;
    - a rollback pairs this sweep with an older script, and R1–R3 say what that gives.
  - One section per task, carrying D-3972 to D-3984 by number. It names the operator's 13:58 ruling for D-3983 and D-3984.
  - Links to the plan and the files are GitHub `blob/main` URLs built from the repository's own remote, with the PR's `/files` view beside each until merge. Never a docserver URL.
  - Every commit's author and committer are the noreply identity: `git log --format='%an <%ae> | %cn <%ce>' origin/main..HEAD`.
  - The body ends with the attribution line the session's instructions give.
  - After CI starts, read the PR's `select tests` summary. It must list `ccrc-sweep-window.test.ts` and `ccrc-sweep-deliberate-stop.test.ts`, and the files that read `ccd/ccrc` and `deploy/verify-service.sh`. If one of Step 4's server files is missing, run `gh workflow run ci.yml --ref <branch> -f mode=full` and name that run in the wave-done.
- [ ] **Step 7: The wave-done, in the same turn as the push.** It carries:
  - the tip sha, the PR number and the remerge-diff result;
  - each suite's result, the `-t` parts with their counts, the shards or the reduced list, and the load;
  - each task's red-first counts;
  - every mutation row (T1-1 … T7-7) with its measured red set against the listed set and the assertion that fired. Timeouts and hangs are named as such, and *(prototype)* rows are re-measured through the real file;
  - Task 1 Step 5's differential counts;
  - H2's Linux answer (Task 3), and the macOS cases for the coordinator to read: E20d, D5d, H1 and H3, and every new `it` in `ccrc-update`/`ccrc-doctor`;
  - any reserve number spent, each defined in this plan in the commit that cites it;
  - anything the work found that bears on a reading below.

## Readings (for the coordinator to rule; each was chosen where no ruling decided it)

Readings 1–15 stand as drafted except where the 13:58 rulings changed them. Each change is marked.

1. **The Darwin arm gets the shared window and the re-check, but no deliberate-stop classifier** (D-3975, D-3949, D-3983).
   - D-3949 says wave 11 "rewords them together with the Darwin arm", which could mean adding one.
   - The cost of adding it: launchd's not-loaded state after `_svc_disable_now`'s bootout is also what the start-limit emulation leaves. A classifier would need a `.svcfailed` read beside `.stopped`, and a second copy of the rule outside `verify-service.sh`. No macOS box is centrally managed.
   - Changed at 13:58: the re-check applies to Darwin too. Its reason, a transient death in a shared window, is the same.
2. **The bound is 128, chunked (not a sliding pool), with the knob `CCRC_SWEEP_VERIFY_JOBS`** (D-3972). Ruled at 13:58, with the storm stated (Risk notes).
3. **Every listed unit is verified after a failure,** and the die names the count and the first unit, with every failing unit on stderr (D-3972 b, D-3974).
4. **No scratch dir means today's foreground calls** (D-3972 h). Changed by the P5 ruling: today's calls exactly, with the new verdict (every unit, the re-check).
5. **Wave 10's cross-version case is re-homed on a frozen copy, not retired** (wave 10's Reading 2; D-3982). Both boxes still run the OLD sweep for the move into this wave. The copy is pinned to its released digest, and its helpers by X0c (T-8).
6. **Containment: both checks** (wave 10's Reading 3). The file keeps its own 12-name check and adds `ccrcContainedEnv` + `assertNoRealTool`.
7. **R13(a) as ruled closes only part of F2.**
   - `LoadState` reads `loaded` for every instance of an installed template, never-existed ids and `..` included (measured on both managers).
   - This plan adds the leading-dot refusal (D-3977) and the symlinked-`.uuid` rule (D-3978).
   - It leaves the never-existed id open (unreachable). No registry fact closes it (F6).
8. **R13(a)'s grammar is written as explicit alphabets** with no locale pin, following `_svc_real_home`, rather than `[[ =~ ]]` plus `local LC_ALL=C`. It is pinned by text (V30): no runner here shows the range hazard in a `case` glob, because bash 5.2 has `globasciiranges` on and the 4.4 image is musl.
9. **R14(f)'s pin sits after the Darwin dispatch,** with a structural pin (U4p) that refuses any `LC_ALL` token above it (A3).
10. **R14(j)'s set is the thirteen measured names, under a new cause `name`.**
    - `HOME`, `IFS`, the locale variables, `BASH_COMPAT` and `BASH_XTRACEFD` are not refused: none stops the job by being assigned (measured).
    - `PATH` is not refused either. A wrong `PATH` does stop the job, but as a misconfiguration of a variable a legitimate `ccrc.env` may set.
    - Changed by A1/A5: the reason names the cause and the line, never the variable, and does not call them all read-only.
11. **R14(i)'s record is an instrument that never asserts the macOS answer** (Task 3).
    - A red there would block `stable` through `full-suite`.
    - The coordinator records the locale and the two yes/no answers in the ledger from `probe-macos`/`test-macos`.
    - D-3833's text is not amended for (i) in this wave.
12. **A deliberate stop is replayed on stdout, not lifted into a warning or `update.json`** (wave 10's Reading 4, the critic's M8). Re-checks are named on stderr (D-3983).
13. **The die says "the install completed and nothing was rolled back", before the unit.** It does not say "the gate passed": `--no-gate` reaches the sweep with no gate run (`ccd/ccrc:17114-17119`, "--no-gate measured nothing"). Changed by P3: facts first on both arms, so only the unit name is ever truncated.
14. **Citations re-pointed:** six. They are R13(f)'s three, plus the three this wave's insertions move: `ccrc-doctor.test.ts:3591` and `:8384` (T-7), and `ccrcContainment.ts:13`. Already-stale citations elsewhere are left.
15. **`deploy.sh`: the loop is unchanged, with no re-check; one comment line is reworded** (D-3949's instruction), line-neutral.
16. **Replaced by the operator's ruling of 13:58, "Re-check once."** Implemented as D-3983 (the re-check) and D-3984 (crash-shaped units).
    - The draft's Reading 16, a first-tick swap kept as a risk, is withdrawn: the hazard was a jittered dispatched swap, measured at 0 near any sweep (F2).
17. **RULED (coordinator): stop at the first failed re-check.**
    - Once a re-check fails, no later crash-like unit is re-checked: each is counted and named on stderr. A re-check that passes goes on to the next, and later batches still get their concurrent first pass.
    - The die gives three counts: the units crash-like on their first verify, the first unit whose re-check failed, and the units left un-re-checked.
    - Pinned by W15 and D8, and by mutation rows T6-R5 and T7-8. The worst-case timing is in Risk notes.
18. **RULED: a unit the launcher never started gets the same re-check.**
    - A missing, empty or non-numeric rc means no recorded result. Its foreground call counts as its first verify, and a crash-like failure of it gets the one re-check, by the same rule as every other unit.
    - Pinned by W13(b) (3 calls) and W18b, and by rows T6-R2 and T6-R6.
    - A unit with a non-zero rc after a `stopped on purpose:` line still fails with no re-check, as the ruling's definition of crash-like requires. No shipped script produces that state.
19. **RULED: falling back to item G's warnings is accepted, never silently** (D-3984).
    - When the crash listing cannot be read, the sweep prints one line saying it was not measured, so crash-looping units are only warned about, and none is claimed healthy. Then item G's warnings follow.
    - Pinned exactly by W17c, and by row T6-C5.
20. **New: the reaper sends TERM at most once per job, and only to the process group of a job of the chunk in flight that recorded no result** (verify L1).
    - It skips `.rc`, `.done` and `.killed` jobs, and refuses a pid of 1 or less. Pinned by W20 and by rows T6-K1, T6-K2 and T6-K3.
    - The stale-dir sweep removes dirs only, and never signals.
    - So a reused pid can be signalled in one narrow case only, and then at most once: a job of the chunk in flight that ended without writing its `.rc`, whose number the system reused before the chunk was read (Risk notes).

## Coordinator rulings on this plan's readings (2026-10-05)

- **Readings 1 to 20 are ruled as they now read.** Each one is either drafted or changed by the 13:58, 14:30 and
  15:05 rulings in the programme ledger. Readings 16 to 19 carry the operator's "re-check once" and its three
  follow-ons. Do not reshape any of them. If one cannot be done as written, stop that item and mail the coordinator
  the input and the result.
- **Task 7's D3 on a Linux runner** (raised after the final verify). Under `CCD_OS=darwin`, `_upd_report_readable`
  calls `_plat_size`, which runs BSD `stat -f %z`. GNU stat rejects that, so the foreign report reads as this run's
  own, and D3 goes red on correct code.
  - D3 runs on every platform with a shim, `_plat_size() { stat -c %s "$@"; }`, defined in D3's own script after
    sourcing. It tests the die's ownership logic, and the shim stands in for the platform primitive only.
  - Add **D3d**, an `itDarwin` twin of D3 with no shim. It runs the real `_plat_size` on the macOS legs.
  - Give D6 the same shim only if it needs one; it passes on Linux without one today.
  - T7-2's and T7-4's red sets keep D3. D3d is a macOS-only red, which the coordinator reads on `test-macos`.
