# GPT lane ownership — Plan 3b: the cutover — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **That applies to Part A only.** Part B is a live runbook. The controller session executes it with the operator present, and it is never dispatched to a subagent, a Workflow or a fleet worker.

**Goal:** Move both live GPT lanes off the other repository's runtime and onto ccrc's own, one lane at a time, with every step reversible until Plan 4. It comes in two parts.
- **Part A (Tasks A1–A7)** is one small code PR. It closes the six gaps Plan 3a's final review left that the cutover leans on:
  - an undecidable roster read fails closed at every "is this row codex-kind" reader (A1);
  - a usage withdrawal is counted only when re-measured, and doctor names a surviving ccrc timer on a flipped-back id (A2);
  - account removal waits for an in-flight usage refresh instead of racing it (A3);
  - the refresh loop never reads a bodyless render failure as `skipped` (A4);
  - doctor's three codex-path unmeasured folds are named (A5);
  - the models reads are FIFO-safe (A6).

  A7 appends spec §21, runs the Part A gate and opens the PR. Like Plan 3a, Part A is inert on today's live shape, and its merge is a rollout.
- **Part B (Tasks B1–B6)** is the per-lane runbook:
  - B1 is a read-only census that confirms the preconditions, records the real values and confirms the operator rulings;
  - B2 builds the isolated runtime;
  - B3 is one cutover procedure, run once per lane: park the sessions, stop the foreign tiers, flip the roster, start ccrc's tiers, verify, un-park;
  - B4 is the soak gate;
  - B5 is B3 for the second lane;
  - B6 closes out and starts Plan 4's soak clock.

  Every live act sits under a named authorisation ([Authorisation shapes](#authorisation-shapes)).

**Architecture:** No new executable, verb, unit or process primitive. Part A lands in seams that already exist:
- `_models_litellm_codex`'s contract widens from two answers to three, and its readers change in the same commit: `_models_probe_codex_env`, `_models_litellm`'s dispatcher, and any other reader a grep finds (`ccd/ccrc`).
- `_inst_codex_usage` re-measures its own disables, and `_check_codex` gains one WARN over the enabled ccrc usage ids that are no longer codex lanes (`ccd/ccrc`, `ccd/ccrc-doctor-checks`).
- `_acct_remove_usage` waits, bounded, for ccrc's own `ccrc-codex-usage@<id>.service` to go inactive. It never stops it.
- The refresh loop's LiteLLM block reads `_models_litellm`'s exit code.
- `_dr_cx_bins`, `_check_codex`'s left-state scan and `_dr_cx_sessions` name what they could not measure.
- `shared/modelenv.mjs` exports one `readRegular`, which `deploy/models-op.mjs` imports in place of its private copy.

Part B drives only shipped verbs: `ccd swap`, `ccrc account disable|enable`, `ccgpt-runtime build|check`, `ccrc wrappers`, `ccrc models …`, `ccrc codex start|status|stop|login`, `ccrc doctor`, and one `systemctl --user enable --now` of ccrc's own usage instance (R-C10). The other repository is touched only by its own lane-explicit stop and by the operator's disable of its usage timers. Each lane leaves the external path by its row's kind alone (ruling Z8): from its roster edit on, the probe, the LiteLLM step and the usage converge take the codex arms Plans 2b-2 and 3a shipped.

**Tech Stack:**
- Part A: bash (`ccd/ccrc`, `ccd/ccrc-doctor-checks`), Node ESM (`shared/modelenv.mjs`, `deploy/models-op.mjs`) and vitest (`server/test`).
- Part B: the `ccrc`/`ccd` CLIs, `systemctl --user` listings, `ss`, `stat`, and the update control plane (the PWA's Settings screen, or `POST /api/updates/intent`).

**Spec:** `docs/superpowers/specs/2026-09-20-gpt-lane-ownership-design.md`. This plan implements §15 step 3, the per-lane cutover, as §20.9 reshapes it. It reads:
- §4, the roster contract a codex row must satisfy;
- §9, adoption by path: the codex row's `authDir` is the lane's existing OAuth directory;
- §10 and §20.4, usage publication and its single writer;
- §12 and §20.3, doctor;
- §19 and §20, the amendments Plans 2b-2 and 3a made.

A7 appends `## 21. Amendments (Plan 3b)` under §19's and §20's rules: same-line pointers only above it, and no line above §21 moves. Where this plan departs from the spec, a carry-forward or a ruling, the departure is named `⟦D:<slug>⟧` and the controller mints its number after review.

> **Measurements.** Facts cited as "the 2026-10-05 census" come from read-only measurements taken while this plan was drafted: on the operator's fleet box, and in this tree at `be93d159` (`origin/main`, with Plan 3a #239 and its macOS follow-up #240 merged). The reports are not tracked. Every live value in them is stated here **by shape only**: no id, label, port, path under the operator's home, host, session name, model id, email or live-box version appears in this plan. Every line number below is an example measured at `be93d159`, to re-derive by name, never to paste. The server box was not measured.

---

## Global Constraints

Every task's requirements implicitly include this section. The first group binds both parts. The second binds Part A, adapted from Plan 3a's Global Constraints. The third binds Part B.

**Both parts**
- **The repository is PUBLIC (AGPL-3.0).** No tracked byte, PR body, ticket or commit message may carry a real account id, lane label, email, host, port, credential, OAuth path, config name, session codename, operator username, live-box version or real model id. Nor is a real value printed into anything tracked, even transiently.
  - Part A's fixture vocabulary is Plan 3a's: ids `codex-a` and `codex-b` (kind `codex`), `ext-a` and `ext-b` (kind `external`, `telemetry: "codex"`), `gen-a` (kind `generated`), `claude` (upstream) and `claude2` (generated), `authDir` `.local/share/ccrc/codex/<id>` written only through `codexAuthDir(id)`, the token `test-token-not-a-secret`, model ids `gpt-x` and `probe-model`, and ports from `freePorts()` for anything that listens. **No fixture id this plan adds equals a rostered id.** The upstream ids `claude` and `claude2`, and `server/test/ccrc-models.test.ts`' pre-existing external fixture, are inherited; an added line reads that fixture by position (`LEGACY_EXTERNAL_ID`, Plan 3a's ruling R13), never by spelling. A7 re-checks the added ids by count, without printing the roster.
  - Part B names live values only through the parameters B1 defines once, in a `0600` scratch values file and in the GPT-lane section of the gitignored `deploy/reference-fleet.md`: `<lane-id>`, `<lane-shim-port>`, `<lane-litellm-port>`, `<lane-auth-dir>` (`$HOME`-relative, as `exec.authDir` takes it), `<park-target-wrapper>`, `<session-id>`, `<nodeId>`, `<box-global-litellm-config>` and `<UTC>` (a `date -u +%Y%m%dT%H%M%SZ` stamp read from the clock, never typed). B1's parameter table is their only definition, and it lists every other parameter Part B uses.
- **Deviation numbers are issued, never chosen.** A departure is written `⟦D:<short-slug>⟧`. Never write a number nobody issued, a `D-TBD` or a range. The controller mints every number after review. Plan 3a's three Plan-3b slugs (`runtime-built-before-the-roster-flip`, `lane-without-a-registry-inits-after-the-flip`, `both-foreign-usage-timers-retired-per-lane`) belong to Part B's execution ledger, with `second-lane-first-accepts-z4-refusals` (only if R-O1 rules lane 2 first): each is appended to `$PB/execution-slugs.tsv` when its act fires (Part B's constraints below), and this plan does not mint them.
- **Never run the destructive `ccd` verbs** (`ws-rm`, `ws-reap`, `ws-gc --prune`, `ws-archive`, `ws-restore`, `ws-reclaim`). Never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or a `claude-session@*` unit directly. Part B reaches them only through the verbs that own them: `ccd swap` for a session's unit and pane, `ccrc account disable|enable` for the `<id>-disabled` marker.
- **Never read a secret.** Never read or print `auth.json`, `runtime.env`, a secrets file, the other repository's shared `0600` env file, or any unit's `Environment=`. `auth.json` is checked by `stat` only (existence, mode, mtime), and the gateway key's route into a unit is proved by that unit's `EnvironmentFiles=` line and by the shipped `_svc_run_supervised`'s refusal of any `*KEY` argv name, never by reading a unit's `Environment` property, not even through a counting pipe (ruling R3).
- **Docs links.** A tracked file, a PR body or a ticket links a document by its GitHub `blob/main` URL. A docserver URL appears in chat only.

**Part A (code; subagent-driven)**
- **The base.** Part A is written against `be93d159`. Rebase onto `origin/main` before A1. Each task's Step 0 writes its base to `$SCRATCH/a<n>-base` (`a1-base` … `a7-base`), and every later block of that task reads it back with `BASE="$(cat "$SCRATCH/a<n>-base")"`, never from a variable an earlier call set. A scope or residue check runs as `git diff "$BASE" HEAD` after the task's commit, or before it as `git diff "$BASE"` against the worktree or `git diff --cached "$BASE"` against the index.
- **Fixture HOMEs only.** Never run `ccrc`, `ccd`, `ccgpt-runtime`, `ccrc-codex`, `ccrc-models-probe`, `ccgpt` or either Python file against the live `$HOME`. The harnesses are `makeCcdHarness` (`server/test/ccdWsHelpers.ts`), `installFixtureTree` (`server/test/installTreeFixture.ts`), `ccgptHarness.ts` and `codexLaneFixture.ts`, with its `plantSystemd` recorders (`systemctlCalls`, `systemdRunCalls`). Every `systemctl`, `systemd-run`, `ccgpt` and `pgrep` a test can reach is a stand-in planted in the same commit as the path that reaches it. A3's fake manager is one more `systemctl` stand-in, never the real manager.
- **Mutation-table discipline.** Every new guard ships with a case that goes RED when the guard is mutated, measured both ways with counts. If a demanded mutation does not red, **report that it does not**, and never manufacture code to force a bind. A mutation row backs up every file it edits, one backup per file, and proves its restore with `git diff --quiet -- <files>`. Anything a mutation can make block (a FIFO, a sleep, a wait loop, a listener) runs under `timeout`, so nothing outlives the census. A6's FIFO cases and A3's wait cases self-expire.
- **Suites.**
  - Run each suite in the FOREGROUND from inside its package, with a timeout of at least 600000 ms, as `./node_modules/.bin/vitest run test/<file>.test.ts`. Never bare `npx vitest`. Every suite command is census-wrapped (below).
  - Each server shard is its own foreground call (`--shard=<i>/12`, twelve calls), each under the tool's 600 s cap. No call loops several suites that together could pass the cap.
  - **`server/test/ccrc-doctor.test.ts` is never run whole in one call.** It is three foreground calls, the step's evidence label suffixed `-1`, `-2` and `-3`, with Plan 3a's complementary `-t` filters: `'^ccrc doctor: [a-c]'`, `'^ccrc doctor: [d-m]'` and `'^(?!ccrc doctor: [a-m])'`. The whole-file count is the three parts' sum. A part that runs past about 500 s is split again at another letter, keeping the parts complementary. A mutation row that names doctor cases runs only the part that holds them.
  - `tsc --noEmit` does not read `server/test/`, so a task that writes a test file typechecks it with `./node_modules/.bin/vitest run test/typecheck-tests.test.ts`.
  - The known load flakes (the repository's `CLAUDE.md` list) are re-run in isolation before anyone calls them a real break.
- **Never spell `writeFileSync` in `ccd/ccrc`.** `server/test/modelenv-single-writer.test.ts` text-scans every tracked source file. `ccd/ccrc` already spells the model-env keys and `settings.json`, so one `writeFileSync` there, even inside an embedded `node -e`, makes it a second writer of the model env block, and the suite reds. A node one-liner in `ccd/ccrc` writes with `node:fs/promises`' `writeFile`. `deploy/models-op.mjs` stays exempt because it imports `clearSettingsEnv` from `shared/modelenv.mjs`, and A6 keeps that import.
- **The platform layer, and `ccd/ccd`.** `ccd/ccd` is not edited, unless a task must add or change a `_plat_*` or `_svc_*` helper. Those helpers live between the `THE PLATFORM LAYER` and `END PLATFORM LAYER` sentinels, a region `server/test/macos-platform.test.ts` pins byte-identical in `ccd/ccd` and `ccd/ccrc` (`ccd/ccrc:70-1250` at `be93d159`). A3 should compose `_svc_is_active` as it stands and need no new helper. If any task does edit the region, it edits both files in one commit and re-stamps `ccd/ccd`'s line-2 `# ccrc:generated 1 sha256=` marker with the shipped `markGenerated` (`shared/mark.mjs`), never by hand. The gate is `server/test/ownership.test.ts` green. `node shared/mark.mjs --check` is hollow: the module has no CLI and exits 0 for any file.
- **Inserted lines in `ccd/ccrc` can shift cited anchors.** If `server/test/session-hook.test.ts`' citation census reds after a `ccd/ccrc` insertion, the repair is ruling S6-R11's. README is repaired by content first, then the census is re-measured with its composition stated. A number is never adjusted to make the test green.
- **Spec amendments are appended, never inserted.** The spec is 1111 lines at `be93d159`. A7 appends `## 21. Amendments (Plan 3b)` after the last line and makes only same-line pointer edits above it. It proves that with the diff Plan 3a Task 11 used: every hunk above §21 is a same-line edit, and the rest is the append.
- **Commits** land on the workspace's own branch, never a separate feature branch. Each carries the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, and its message is passed as `git commit -F - <<'EOF' … EOF`. Author and committer are the noreply identity this worktree's git config already carries. After every commit, `git log -1 --format='%an <%ae> | %cn <%ce>'` shows that identity only.
- **The whole of Part A is squash-merged:** one commit on `main`, one release, one rollout. Merges here need `--admin`.
- **Containment census on every suite command (Plan 3a's ruling R11, restated for Part A).** A recorder is necessary, not sufficient, so every suite command runs between two snapshots, and a step whose census fails has failed, whatever vitest printed. The census signals nothing. A leak is reported to the controller, and removing a leaked real unit is the operator's act.

  **A code block nested under a list item is run with its fence's indentation removed,** so every heredoc terminator (`EOF`) reaches column 0. Copied with its indent, a heredoc never ends.

  **One sourced file carries every name a block uses,** because an agent's shell keeps no variable, function or working directory between Bash calls. Before A1, choose one absolute scratch directory, once, named `plan3b-exec`. It sits outside the tree, is never tracked, and is not under the temp root's `ccrc-` or `ccgpt-` prefixes, which the process census counts. Write `plan3b-env.sh` there, beside the census script:

  ```bash
  S='<abs scratch>/plan3b-exec'; T='<abs worktree>'   # typed here and in each block's source line, nowhere else
  mkdir -p "$S" && printf "SCRATCH='%s'\nTREE='%s'\n" "$S" "$T" > "$S/plan3b-env.sh" && cat >> "$S/plan3b-env.sh" <<'EOF'
  # plan3b-env.sh: Plan 3b's one sourced file (B1 Step 0 appends Part B's names). Line 1 is SCRATCH, line 2 the worktree.
  CENSUS="$SCRATCH/census-run.sh"; R11="$CENSUS"   # one script, two spellings
  EVID="$SCRATCH/census"; mkdir -p "$EVID"           # the default evidence root: "$EVID/<label>"
  r11() { "$CENSUS" "$EVID/$1" "${@:2}"; }           # r11 <label> <command…>
  BASE=''                                            # each task sets BASE="$(cat "$SCRATCH/a<n>-base")" itself
  unset -f grep 2>/dev/null; unalias grep 2>/dev/null || true   # a locator is GNU grep: a shell's grep wrapper reads a mid-pattern $ as an anchor
  cd "$TREE" || return 1   # every block starts at the worktree root, whatever the last call left
  EOF
  ```

  **Every bash block in Part A that uses a helper, `$SCRATCH`, `$TREE` or `$BASE` begins with `. "<abs scratch>/plan3b-exec/plan3b-env.sh"`, and a block that runs from a package then `cd`s there itself. No block relies on a variable, function or directory an earlier block set.** Part B sources this same file: B1 Step 0 appends `PB="$SCRATCH/partB"` (Part B's only evidence root), `VALUES`, `B`, `redact`, `vset` and `lane` (rulings N1, N2, R18). Then write the census body below to `"$SCRATCH/census-run.sh"` with a quoted heredoc (`<<'EOF'`), and `chmod +x` it. It is Plan 3a's script byte for byte, apart from its first comment line:

  ```bash
  #!/usr/bin/env bash
  # census-run.sh <evidence-dir> <command...>: Plan 3b Part A's containment gate (Plan 3a's ruling R11).
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

  **What it leaves.** Seven files in its evidence dir (`units-before.txt`, `units-after.txt`, `new-units.txt`, `procs-before.txt`, `procs-after.txt`, `leaks.txt`, `run.txt`) and one verdict line. That line is `census: clean …`, or `census: FAIL …` with exit 125 (a unit or link change) or 126 (a surviving fixture process). A clean census exits with the wrapped command's own code, so a red-first run reads `census: clean` with vitest's non-zero exit. The two verdicts are read separately.

  **A census FAIL stops the step, and it is attributed by count before it counts,** never by printing `new-units.txt`:

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"; f="<that run's evidence dir>/new-units.txt"; fx='(^|[-@:])codex-[ab]([-.]|$)|ccrc-codex-usage@'
  grep -v '^gone:' "$f" | grep -cE "$fx"    # fixture-named: a leak
  grep -c '^gone:' "$f"                     # a vanished enablement link: a leak, by count
  grep -v '^gone:' "$f" | grep -vcE "$fx"   # foreign: count only
  ```

  - A new unit or link counts if its name carries a fixture lane id or is any `ccrc-codex-usage@*` instance. **That rule holds only while no live ccrc usage instance exists, so all of Part A runs before B3's first enable.** If any Part A suite would run after a lane window has opened, stop, and the controller re-rules the attribution regex first.
  - A `gone:` line always counts. No Part A code or suite may disable a unit on the real manager.
  - A surviving process counts if its fixture path is one this run created (named in `run.txt`, or under the test file's own `mkTmp` prefix).
  - Anything else is foreign. When every hit of a run is foreign, mark its evidence dir with `touch "<its evidence dir>/attributed-foreign"` and re-run the command in isolation under a new label. A7's closing gate reads that marker and counts only attributable hits, over every evidence dir except `$SCRATCH/census-controls`.

  **The census's three controls run once, as A1's Step 0, before Part A's first suite.** They write under `$SCRATCH/census-controls`, outside `$EVID`, because two of them fail on purpose:

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
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

  A control that answers otherwise is re-run in isolation, under a private `TMPDIR` for the clean one, and never waved through. This is Part A's ONE census script. No task writes another or restates its body.

**Part B (the live runbook)**
- **Controller-executed only, with the operator present.** No Part B step is dispatched to a subagent, a Workflow, a fleet worker or the handoff lane.
- **Every live act sits under a named authorisation** ([Authorisation shapes](#authorisation-shapes)). An act not listed in the authorisation in force is not run, and a step reached outside its window stops.
- **A read-only step says "read-only".** It may run any time, before or between windows, and changes no file, unit, process or registry row. Probes are listings (`systemctl --user list-units`/`list-timers`/`is-active`/`is-enabled`, `ss -ltnp`, `ls -la`, `stat`, `pgrep -af`), never a connect to a live port. One exception is named where it is used: the verification turn through the lane, which is authorised.
- **`~/.local/bin/ccgpt` is never moved, edited or deleted in Plan 3b,** and neither are `ccgpt-proxy`, `ccgpt-usage`, their `.py` copies or their `.bak-*`/`.pre-*` backups. The other lane execs `ccgpt` until its own flip, and Plan 4 removes it. "Move the launcher aside" means only the lane's entry file, `~/.local/bin/<lane-id>`, the path `ccrc wrappers` writes. It is moved with `mv` to `~/.local/bin/<lane-id>.pre-ccrc-<UTC>`. Lane 1's entry file is a symlink, so the link moves and its target is never followed, copied or touched.
- **The other repository's stop is always lane-explicit, and only before that lane's flip.** It runs through the lane's own entry file with the id set, `CCGPT_ACCOUNT_ID=<lane-id> ~/.local/bin/<lane-id> stop` (B3 Step 6), and never as a bare `ccgpt stop`. For any lane but lane 1, `ccgpt` with only the id refuses without both port variables (`_require_lane_ports`, measured), and only the entry file exports them. Measured: `ccgpt` defaults its lane id to lane 1, so a bare stop names lane 1's two units, and once lane 1 is codex those are ccrc's own tier names (spec §19.2, ruling Z4's reason). Once a lane is codex, no `ccgpt stop` naming it ever runs. After the stop, wait more than the foreign units' `RestartSec` (3 s), then re-check by listing only that the units are gone and the ports are free. A remaining `unit-foreign` or `port-foreign` refusal from `ccrc codex start` is a stop, never an override.
- **No rollout, update or deploy by hand** (operator ruling 2026-09-30). Never run `ccrc update`, `ccrc rollout` or `deploy/deploy.sh` against either box. Part A reaches the boxes through the updater, and a Part A rollback is the updater's own (`ccrc rollback` or the PWA's), at the operator's word. R-C10's targeted runtime build and instance enable are put to the operator as a ruling, because they resemble a hand converge.
- **Real values never leave the box.** Commands are typed with the parameters substituted from B1's values file. No real value is written into a tracked file, a PR, a ticket or mail.
- **Backups before mutation, restored on rollback.** Each lane's roster, `settings.json` (mode preserved, `cp -p`), whichever of `~/.ccrc/models/<lane-id>.{json,classes.json,classes.tsv,effort.json}` exist, and the entry file (its move is its backup) are backed up before the step that changes them. Each backup goes into that window's `<window-dir>` = `$HOME/.ccrc-3b/<lane-id>-<UTC>` (0700, outside any tree, so it survives a scratch wipe or a reboot; B1 Step 0 creates `$HOME/.ccrc-3b/`), and B4–B6 read it there. The entry file is moved beside itself as `~/.local/bin/<lane-id>.pre-ccrc-<UTC>`, and the optional server-box mirror's backup is `accounts.json.pre-3b-<UTC>` beside the server's roster. Every step states its own rollback if it was reached.
- **An execution-ledger departure is appended when it fires,** once per slug: `grep -q "^<slug>$(printf '\t')" "$PB/execution-slugs.tsv" 2>/dev/null || printf '%s\t%s\n' '<slug>' '<one-sentence definition>' >> "$PB/execution-slugs.tsv"`. The sites are B2 Step 5 (`runtime-built-before-the-roster-flip`), B3 Step 11 (`lane-without-a-registry-inits-after-the-flip`), the second window's B3 Step 7 (`both-foreign-usage-timers-retired-per-lane`), and the first window's B3 Step 9(c) when R-O1 ruled lane 2 first (`second-lane-first-accepts-z4-refusals`). B6 Step 6 mints from that file and nothing else.
- **First measurements, never facts (ruling R12).** Each is recorded in the verification record (B6 Step 5) the first time it is read: the first runtime build's wall time and `~/.cache/pip` growth (B2); whether a launcher refusal (`ccrc-codex: <code>:`) reaches the `claude-session@` journal (B3 Step 18, B4 criterion 6); whether the detached update's `install: codex…` lines reach `journalctl --user` (B4 criterion 7); B4's gateway-401 pattern against a real LiteLLM 401 line; and whether the user journal is readable (B4 Step 2).

## Review Focus

Five failure modes the spec implies that no task's tests exercised before this plan, most likely first. Each names the input, what a reasonable operator expects, and the task that now pins it. Items 1 and 4 are pinned by Part A's tests; items 2, 3 and 5 are live-runbook failure modes, pinned by Part B's stop conditions, a stated exception to the rule that a focus item names a test.

1. **A roster read that is undecidable mid-window.** B3's roster replace, an operator's hand edit or a missing `jq` can meet the hourly refresh or doctor between two reads. Expected: no reader treats a row it cannot classify as "not codex". The probe never falls back to the external fetch's token-directory default, the dispatcher never renders the external arm, and the refresh row is `ok:false` with `roster-invalid` or `missing-dependency`, never `ok:true`. **Pinned by A1**, which adds, beside its per-reader cases, one refresh case (`cmd_models refresh codex-a`, the per-row path the hourly `refresh --all` takes) under a `_codex_lanes` that answers rc 1, against a roster with a codex row. Its row is `ok:false` with the forwarded `roster-invalid` line as its reason, the command exits 1, and the `pgrep`, `ccgpt` and `systemd-run` stand-ins log no call. Also by B3, whose roster flip is one same-directory `mv` of a candidate the shipped `parseRoster` has accepted, so no reader ever sees a half-written file.
2. **A park target whose pool differs from the session's project.** Expected: the window never opens on a swap ccd refuses (`pool-mismatch`, or an undecidable tag that `--cross-pool` cannot override), and no session is half-moved. **Pinned by B1**, which reads read-only each live session's project pool tag (`~/.cc-sessions/pools/<project>`, presence and the tag word) and `<park-target-wrapper>`'s resolved pool, and records `serve` or `refuse` per session before any window. And by B3, which parks every session before any other act and treats any refused or failed swap as the stop condition, with nothing else yet done. `--cross-pool` runs only on a named operator decision recorded in the window's authorisation.
3. **A foreign transient unit that respawns within `RestartSec`.** The other repository's tiers run `Restart=always`, `RestartSec=3`, and anything that launches the lane's entry file starts both tiers again within seconds: an un-parked session's respawn, a stray launch. Expected: `ccrc codex start` never meets a foreign unit or listener it would have to override. **Pinned by B3.** It parks every session before the stop. It re-lists units and ports twice, more than 3 s apart, after the lane-explicit stop, and again after the entry file's move, immediately before `ccrc codex start`. Any `ccgpt-<lane-id>-*` unit loaded, or any listener on `<lane-shim-port>` or `<lane-litellm-port>`, is a stop.
4. **Two usage writers for one lane on a flip-back.** A rollback re-enables the foreign timer while ccrc's instance link survived a `disable --now` the manager answered 0. Lane 1's foreign timer is the flat, id-less one, which ccrc's converge cannot attribute. Expected: one writer per limits row at every moment. **Pinned by A2** (the converge's re-measure and doctor's WARN naming the surviving `ccrc-codex-usage@<id>.timer`). And by B3's rollback order: `systemctl --user disable --now ccrc-codex-usage@<lane-id>.timer`, then a read-only re-measure that the `timers.target.wants` link is gone (`systemctl --user is-enabled` reading `disabled`) and a wait for the service to go inactive (RB5), and only then the operator's re-enable of the foreign timer.
5. **A dead refresh token in the lane's own tier.** The tier's LiteLLM process runs the `Authenticator` itself, out of reach of Plan 3a's in-process guard, and on a dead refresh token it can start a device flow on the first request. Spec §20.1's "No device flow outside `ccrc codex login`" over-claims here. Expected: a dead token stops the window for `ccrc codex login` before any session returns to the lane. **Pinned by B3.** `ccrc models refresh <lane-id>` must answer its row `ok:true`, with `probe:"codex"` and `litellm` `rendered` or `unchanged`, before `ccrc codex start` and before any un-park. A `login-required` row stops the window. B1 reads, by `stat` only, the age of each lane's `auth.json` and catalogue. A7's §21 pointer on that §20.1 line states the containment.

## What earlier plans already shipped (measured)

Measured on `be93d159`. Line numbers are examples to re-derive by name.

| Plan (PR, merge commit) | What it gives Plan 3b |
|---|---|
| Plan 1, the roster contract (#163, `592cb109`) | `exec.kind: "codex"` in `shared/roster.ts`' `parseExec` (`:691`). It requires `provider: "openai"`, a `proxyPort` and a `litellmPort` that differ (`parseLanePort`, `:571`) and are unique across the roster, and a `$HOME`-relative `authDir` refused under `.ccrc/`. `_acct_credential` refuses a codex lane, and `_acct_remove` removes its launcher marker-verified and keeps `authDir`. B3's roster edit is validated against exactly this parser |
| Plan 2a, the request path (#165, `4dca80f8`) | `ccd/ccgpt-proxy.py` (the shim) and `ccd/ccgpt-usage.py` (the publisher), ported into this tree and pinned |
| Plan 2b-1, the lane installs inert (#171, `3a8a93a5`) | The four GPT-lane executables (`ccgpt-proxy.py`, `ccgpt-usage.py`, `ccgpt-runtime`, `ccrc-codex`; `CODEX_LANE_BINS`, `ccd/ccrc-doctor-checks:6303`), placed off the `server` role and in both uninstall censuses. A codex row's generated wrapper execs `ccrc-codex` (`shared/wrapper.mjs:99`). The 2026-10-05 census found both on the box's `~/.local/bin` |
| Plan 2b-2, the lane runs (#217, `b89c2974`) | `ccgpt-runtime build|check|python` with the pinned LiteLLM range, the behaviour probe and the stamp (B2). The lane library: `_codex_lanes` (`ccd/ccrc:10764`, three answers), `_codex_row` (`:10789`), `_codex_foreign_what` (`:11598`), the sole source of `unit-foreign`/`port-foreign`. `ccrc codex start|stop|status|login` (`cmd_codex`, `:12216`). A codex lane's own `litellm.yaml` arm (`_models_litellm_lane`, `:10158`; `_models_litellm_lane_held`, `:10267`). `_inst_codex_runtime` (`:14835`) and `_inst_codex_tiers` (`:15300`), which B4's auto-update exercises |
| Plan 3a, before the flip (#239, `c9ada654`) | A codex row's probe reads its own `authDir` through its own runtime, with no default (`_models_probe_codex_env`, `:9833`; `_fetch_codex_lane`, `ccd/ccrc-models-probe:216`), while an external row keeps `_fetch_codex` (`:153`) until its flip (Z1). Z3: `ccrc models <id> init codex` refuses `codex-registry-needs-codex-lane` on a non-codex row (`deploy/models-op.mjs:956`), which makes lane 2's `init` follow its flip. Z4: `_models_litellm_stop_blocked` (`ccd/ccrc:10092`) refuses the external arm's bare `ccgpt stop` while any codex row exists. `_check_codex` (`ccd/ccrc-doctor-checks:5933`) with `_fix_codex` (`:6111`) and `_fix_wrappers` (`:2987`). ccrc's usage pair `deploy/systemd/ccrc-codex-usage@.{service,timer}` (`TimeoutStartSec=300`, `OnActiveSec=5min`, `OnUnitActiveSec=15min`), converged by `_inst_codex_usage` (`ccd/ccrc:14992`), which withholds ccrc's instance while the same id's foreign template instance is enabled. `ccrc wrappers --force` keeps a symlinked launcher's backup a symlink (`cp -P -p`, `:4445`). The rehearsal: `ccrc-install.test.ts` "Plan 3a Task 10 — the cutover rehearsal" (`:8417`) and `ccrc-update.test.ts` (`:12769`). Spec §20 (`:976` to EOF `:1111`) |
| #240, the GPT lane's macOS reds (`be93d159`) | Test-only. The codex fixture's Python stand-ins bind without a reverse lookup, the Darwin stubs and paths are corrected, and Plan 3a's `ccrc-account` C12–C15 and `ccrc-codex` L0e are systemd-only. It cleared the macOS reds #217 and #239 added. Part A's new systemd-dependent cases follow the same `describeLinux` / systemd-only pattern |

**Measured absent on `be93d159`, and owed here:**

| Absent | Task |
|---|---|
| `_models_litellm_codex` (`ccd/ccrc:10113`) reads `_codex_lanes 2>/dev/null` and answers 1 on rc 1 or 2, the same answer as a roster with no codex row. Its readers `_models_probe_codex_env` (`:9833`) and `_models_litellm`'s dispatcher (`:10406`) both fall through to the external path | A1 |
| `_inst_codex_usage`'s two `disable --now` sites trust the exit code alone, unlike `_acct_remove_usage` (`:22443`), which re-checks. `_check_codex` never compares `_codex_usage_enabled_ids` (`:14940`) with the codex lanes | A2 |
| `cmd_account remove` deletes `~/.cc-limits/<id>.json` right after `_acct_remove_usage` (`:8678`), with nothing asking whether `ccrc-codex-usage@<id>.service` is mid-run | A3 |
| The refresh loop's LiteLLM block defaults `lit="skipped"` (`:10587`) and derives a failure only from a parsed body's `.detail`, with no exit-code fallback and no `// empty` | A4 |
| `_dr_cx_bins` returns early when `cmp` is absent (`ccd/ccrc-doctor-checks:6310`). `_check_codex`'s left-state glob reads an unlistable `~/.ccrc/codex` as empty. `_dr_cx_sessions` (`:6587`) folds an unreadable `.wrapper` into "another lane's" | A5 |
| `readRegular` is private to `deploy/models-op.mjs` (`:166`). `readRoster` (`:176`), `mergeSettingsEnv` (`shared/modelenv.mjs:251`) and `clearSettingsEnv` (`:328`) open by name with no type test | A6 |
| Spec §21, and same-line pointers on `:497`, `:982`, `:993`, `:1007`, `:1024`, `:1035`, `:1039` and `:1042` | A7 |

**If a task below appears to ask for something in the first table, stop and report.** This table has gone stale, and the controller re-measures before anything is written.

## The live shape at drafting (2026-10-05, shape only)

Measured read-only on the fleet box at about 15:15 UTC. B1 re-measures every line before anything is done, and any difference stops the window.
- **Updates.** The box runs a release that contains Plan 3a (#239). `ccrc update --check` reports `state=current` with projection `none`. Between 2026-10-04 and 2026-10-05 the box moved through several releases by its own updater, so auto-update works. On 2026-10-04 it had sat at `desired none` for a while.
- **Roster.** 17 rows. The two GPT lanes are both `exec.kind: "external"`, `provider: "openai"`, telemetry codex. Their exec blocks carry only kind and provider: no ports, no `authDir`, no secrets file. Both rows are home-able, and neither carries a pool.
- **Lane 1** is the lane with a codex class registry: all four of `~/.ccrc/models/<lane-id>.{json,classes.json,classes.tsv,effort.json}` exist. Its entry file is a symlink to the other repository's `ccgpt`. **It has 6 live supervised sessions**: 6 registry rows name its wrapper, each with an active `claude-session@` unit. At Plan 3a's drafting it had none.
- **Lane 2** has no registry, only its effort file. Its entry file is a small regular file. It exports the lane id and the lane's two ports, then execs `ccgpt`. **It has 1 live supervised session.** At Plan 3a's drafting it had 2, one of them a coordinator.
- **The other repository's tiers.** All four transient units, `ccgpt-<lane>-{litellm,shim}.service` for both lanes, are loaded, active and running. `ccgpt`'s lane id defaults to lane 1, and its port pair is derived for lane 1 only. Every other lane's entry file must export both ports, or `ccgpt` refuses.
- **Z4 is armed today.** Lane 1's LiteLLM process was launched on the external arm's box-global config, and `_models_litellm_running`'s `pgrep -f` pattern matches it. Lane 2's names its own lane-suffixed copy and does not match.
- **The other repository's usage timers.** The flat `ccgpt-usage.timer` (lane 1) is enabled and active. The template instance `ccgpt-usage@<lane-id>.timer` (lane 2's) is active, and `ccgpt-usage@.timer` reads `indirect`. The census read a 15-minute cadence for each from `list-timers`. The template pair exists only on the box: it is not in the other repository's git tree.
- **ccrc's usage pair.** `ccrc-codex-usage@.service` (static) and `ccrc-codex-usage@.timer` (disabled) are placed, and no instance exists.
- **`ccrc-models.timer`** fires hourly. At the census its next fire was about 50 minutes away.
- **No ccrc runtime has been built:** `~/.ccrc/runtime/codex` and `~/.ccrc/codex` are both absent.
- **`~/.local/bin`** holds ccrc's `ccrc-codex` and `ccgpt-runtime`, and the other repository's `ccgpt`, `ccgpt-proxy` and `ccgpt-usage`, their `.py` copies, and several `.bak-*` and `.pre-*` backups of them.
- **The other repository's bytes on the box.** The live `ccgpt` matches no commit anywhere in that repository's history: it is diverged, hand-edited bytes. The live `ccgpt-usage` matches two older commits, so it is stale, not diverged.
- **Host.** `node` resolves on a system path, and disk has over 100 GB free (64% used).
- **Not re-measured at drafting:** both OAuth directories' modes (0700, each `auth.json` 0600, at Plan 3a's drafting), the lanes' port holders, and the server box. B1 measures all three.

## Task order

```
Part A (one branch, subagent-driven, executed in this order)
  A1 ─► A4          (both edit ccd/ccrc's models section and server/test/ccrc-models.test.ts)
  A2 ─► A3          (both edit ccd/ccrc's codex-usage helpers; one order keeps anchors stable)
  A2 ─► A5          (both edit _check_codex and server/test/ccrc-doctor.test.ts)
  A6                (independent: shared/modelenv.mjs, deploy/models-op.mjs, server/test/models-op.test.ts)
  A1 … A6 ─► A7     (spec §21, the Part A gate, the PR)

══ GATE: Part A squash-merged, auto-released, and running on the fleet box (read-only proof below) ══

Part B (the controller, the operator present)
  B1 (read-only; re-run at the top of every window)
   └─► B2 (the runtime build; its own authorisation)
        └─► B3 (first lane, per R-O1) ─► B4 (soak gate) ─► B5 (= B3 for the second lane) ─► B4 (again) ─► B6
```

- **Execution order:** A1, A2, A3, A4, A5, A6, A7. One worker per task, one branch, reviewed per task, then the whole branch. The graph says which moves are forbidden, not what may run in parallel.
- **A7 runs last.** It appends spec §21 and its eight same-line pointers (A1, A2's two, A3, A5, A6 and the two wording minors), re-runs every guard suite (`single-definition`, `modelenv-single-writer`, `deviation-refs` after `git fetch origin main`, `dtbd`, `topology-clean`, `ownership`, `macos-platform`, `session-hook`), runs all twelve server shards and the agent and pwa suites census-wrapped, and opens the PR. The PR body links documents by `blob/main` URL only.
- **The gate between the parts is read-only, and Part B waits on it.** B1 proves it:
  - the PR is squash-merged;
  - the fleet box's `ccrc update --check` first line reads `state=current`, and its `sha=` has Part A's squash commit as an ancestor (`git merge-base --is-ancestor <part-a-squash> <that sha>` in this tree);
  - `ccrc version`'s `install:` line reads `complete`;
  - `ccrc doctor` gives every check the class the pre-merge capture recorded (`$PB/doctor-classes-pre-partA.txt`, [Authorisation shapes](#authorisation-shapes)), or the operator accepts each WARN by name (B1 Step 6), with `codex` still one SKIP.

  The server box's build is read in the PWA (`GET /api/updates`, session-gated). Part B starts only after all of it holds. If it does not, the operator rules: wait for the updater, or roll Part A back through the updater.
- **B1 is read-only.** It may run any time, and it re-runs at the top of each window, because a window opens on the census it just took, never on an older one.
- **B2 precedes any roster flip,** so the first codex row never meets an absent runtime.
- **B3 runs once per lane, parameterised:**
  - whether the lane had a class registry before its flip (a lane without one runs `ccrc models <lane-id> init codex` after its flip, by Z3, and its rollback runs `ccrc models <lane-id> rm` before the roster backup returns);
  - its live session count, every session parked;
  - whether it is the first or the second flip (the second lane's stop runs after the first lane is codex, so only the lane-explicit stop is ever typed).

  R-O1 rules which lane is first.
- **B4 runs between the lanes and after the second.** B5 does not start until B4 has passed for the first lane.
- **B6 runs once both lanes have passed B4.** It starts Plan 4's soak clock, R-O9.

## Operator rulings to confirm at plan review

The operator rules each at plan review. B1 records each ruling with the census it was taken on.

- **R-O1, which lane goes first: a measured fork.** Since Plan 3a's drafting the session counts have reversed: lane 1, the lane with a registry, has 6 live sessions, and lane 2 has 1. Plan 3a's "lane 1 first" was conditional on lane 1 being idle, and it no longer is.
  - **Order X: lane 2 first, then lane 1.**
    - One session is parked for the first live run.
    - Lane 2 needs `init codex` after its flip (Z3), and its rollback needs `ccrc models <lane-id> rm`.
    - **The Z4 consequence.** From lane 2's flip until lane 1's, the roster carries a codex row while lane 1 is still external, has a registry, and runs its proxy on the box-global config (measured: the `pgrep -f` match above). So any hourly refresh in which lane 1's render changed is refused `restart-failed`: `ccrc models refresh --all` exits 1, and `ccrc-models.service` reads failed. The refusal fires before any write, so lane 1 keeps serving on its unchanged config, and the next run retries.
    - The refusal's own remedy text says "Stop that proxy by hand … or flip lane … to codex". Under order X the proxy is never stopped by hand, because lane 1's sessions run on it. The remedy is lane 1's own window.
    - Refusals are not expected to change doctor's classes. Doctor's `services` check measures `ccrc-models.timer` active, not the oneshot's last result, and the probe still writes lane 1's catalogue. B1 records doctor's classes, and any change is a stop for re-ruling. The one expected change is doctor's `codex` row: after lane 2's flip it is one WARN for the still-enabled, unattributable flat `ccgpt-usage.timer` until lane 1's flip (⟦D:flat-foreign-timer-warns-until-lane-one-flips⟧).
  - **Order Y: lane 1 first, then lane 2.** This is Plan 3a's recommendation. After lane 1's flip no external lane has a registry, so Z4 can never fire. But the first live run parks and un-parks six sessions, a failed first turn rolls back a six-session lane, and lane 1's entry file is the symlink.
  - **The read-only monitor under order X** is B4's criterion 8 (`b4-sample.sh`, fifth argument `<still-external-lane-id>`), sampled until lane 1's flip. B1 Step 4's `b1-z4.sh` measures how often lane 1's render changes (R-O1's input), and B3 Step 19 records the window's own baseline. The rule for reading Z4's refusal (the row's reason carries `ccrc will not stop it`, never the bare code word `restart-failed`) is stated once, in B4.
  - **Recommendation: order X, lane 2 first.** It is the smallest blast radius for the first live run, one parked session. Z4's bounded degradation is accepted and monitored until lane 1's flip (execution-ledger slug `second-lane-first-accepts-z4-refusals`, minted only if R-O1 rules lane 2 first). B4's "no `restart-failed` row" criterion reads the flipped lane only, and lane 1's expected refusals under order X are recorded, not counted. Under order X, lane 1's window follows B4 without an extended soak, because every hour between the flips is a degraded hour.
- **R-O2, parking, generalised to both lanes.**
  - Every live supervised session on the lane is parked with `ccd swap <session-id> <park-target-wrapper>` before the lane's entry file moves. The swap happens at a measured idle point: the turn marker `$REG/<session-id>.turn.json` reads `done` (or the hook state reads idle), and no dialog is pending. A coordinator is parked between its waves. Un-parking is the symmetric `ccd swap <session-id> <lane-id>` after verification.
  - **Stop conditions:**
    - `pool-mismatch`, or an undecidable pool die (`--cross-pool` only on a named operator decision, and never over an undecidable read);
    - an operator judgement of no headroom on `<park-target-wrapper>` (a manual swap runs no headroom check of its own);
    - a failed `claude-session@<session-id>` unit.

    A failed first turn after an un-park swaps that session back out and rolls the lane back.
  - B1 reads every session's project pool tag and the target account's resolved pool, read-only, before the window.
  - The runbook trusts `ccd/ccd`'s `cmd_swap` header ("A manual swap is now pool-constrained exactly like an automatic one"), not `pwa/src/fleet/SwapSheet.tsx`'s older comment, which says the opposite (ticket below).
- **R-O3, the port pairs: keep each lane's existing pair** (B-7). Lane 1's pair is `ccgpt`'s lane-1 default. Lane 2's is the two exports in its entry file. `_codex_tier_ours` makes a squatter loud, and choosing ports is the operator's alone. B1 records them as `<lane-shim-port>` and `<lane-litellm-port>`.
- **R-O4, `settings.json` after cutover.** Freeze it at cutover: `plugins` is a link and persists, and hooks and the statusline are converged by `install-session-hooks.sh`. Leave `alwaysThinkingEnabled` as written, because it persists and no ccrc writer owns it. B1 measures read-only whether the shim's effort mapping makes it moot.
- **R-O5, mirroring the lanes' exec blocks into the server box's roster:** yes, after both lanes pass B4, under the optional third authorisation, with critic #14's census first (B6). The server reads its roster at boot only, so the mirror's `agreed` waits for its next start, by default the next auto-update landing on the server box. A hand `systemctl --user restart ccrc.service` there runs only under the mirror authorisation, and the operator reads agreement in the PWA (ruling R9).
- **R-O6, the auto-update pause, amended by measurement.**
  - A per-box pause exists only through the API: `POST /api/updates/intent` with `{"scope":"<nodeId>","auto":"off"}`. The route is session-gated, so only the operator can call it. The PWA's Settings screen writes only the fleet scope `*`.
  - **Recommendation:** for each lane's window, the operator pauses fleet-wide in the PWA (`auto` off on `*`), records the prior `auto` and `channel` (and any `pinnedTag`), and restores them after verification (⟦D:update-pause-is-fleet-scoped⟧).
  - The controller reads the state read-only through `ccrc update --check`'s `projection=` and `ccrc channel`'s `auto`. On the fleet box it allows up to 60 s of projection lag, the `ccd-update-sync.timer` interval, before trusting either.
  - `auto: "off"` stops the scheduler only, not a hand update or a PWA apply tap. `~/.ccrc/update.lock` is not a pause mechanism.
  - If restoring a non-`off` `auto` on `*` answers 409 `auto-needs-rollback-gate`, the fleet stays paused and the operator rules.
  - The pause never spans a soak, because B4 needs one auto-update to land while the lane is codex.
  - A node-scoped intent row for `<nodeId>` overrides the `*` pause for that node. B1 Step 6 reads whether one exists, and if so that row is the one paused.
- **R-O7, the live launcher's bytes, which match no commit:** keep a box-local, dot-named `0600` snapshot until Plan 4's cleanup is verified. B6 Step 8 takes the snapshot. Plan 4 Task 4 verifies that it exists, byte-equal by hash, before any `rm`. B1 records the launcher's SHA-256 in the values file, so Plan 4 can prove it snapshots the bytes that ran during the soak. Measured: only the launcher is diverged; the usage publisher is merely stale.
- **R-O8, the other repository's box-swap runbook and the GLM notes: trim in place,** amended by measurement. Neither 2026-07-22 document that names `ccgpt` (the box-swap runbook and the box-role-swap migration design) is GPT-lane-specific, so deleting either would destroy unrelated migration history. The GLM notes' destination, `infra/handoff/README.md`, already carries a `claude-glm` row. This is Plan 4 Task 1.
- **R-O9, the soak before Plan 4:** at least one full weekly usage window on both lanes, measured reset to reset from each lane's limits-row `sevenResetAt` (B6 Step 7's clock), so it runs one to two weeks. It stands.
- **R-S1, each soak gate (B4):** at least 24 h, and it must include one hourly refresh taking the codex arm and one auto-update landing while the lane is codex (ruling R8). Under order X that is at least 24 refusal-eligible hours for lane 1. The operator may rule longer, and shortens it only by naming the replacement.
- **R-C11, account removal's wait (A3):** `CCRC_ACCT_USAGE_WAIT_S` defaults to 300 s, the usage unit's `TimeoutStartSec`. The wait is held under the placement lock (`_acct_marker_lock`), so ccd placements can wait that long during a removal that meets a running poll; at the bound the removal refuses `usage-refresh-in-flight` before the roster drop, and can be retried (ruling R16). The operator confirms 300, or names a smaller default before A3 is executed.
- **R-C10, the targeted runtime build and instance enable.**
  - Measured: the converge's own enable for an eligible lane is `_inst_enable_timer codex-usage ccrc-codex-usage@<id>.timer`, which is `systemctl --user enable --now ccrc-codex-usage@<id>.timer`. `_inst_codex_runtime` builds only once a codex lane exists, so no update builds the runtime before the first flip.
  - So Part B builds with `ccgpt-runtime build` in B2. In each window, after the operator's foreign-timer disable, it runs that one `enable --now`.
  - The alternative is waiting for the next auto-update's converge after the flip. That leaves the lane with no usage writer until a release lands, and it is not boundable inside a window.
  - **Recommendation:** the targeted route. After the foreign disable, the next auto-update's converge is a no-op for the lane. B4 proves it: its install transcript's `codex-usage` line names the lane enabled, with nothing withdrawn or withheld.
  - The operator confirms that this is not the hand rollout the 2026-09-30 ruling forbids. If it is, B2 and the enable wait for a converge the operator triggers through the updater.

## Part A — the code PR before the first flip

### Task A1: an undecidable roster read fails closed at every codex-kind reader

> Rulings applied:
> - **A-1.** `_models_litellm_codex` now gives three answers: 0 (codex), 1 (not codex) and 2 (cannot tell). On 2, `_codex_lanes`' own sentence reaches stderr; its `2>/dev/null` is gone. Every reader of the function refuses on 2 with the word it is handed (`roster-invalid` or `missing-dependency`), the way `_codex_row`'s propagation already does. No new word is minted.
>   - There are two readers: `_models_probe_codex_env` and `_models_litellm`'s dispatcher (`ccd/ccrc:10406` on `be93d159`, IN scope).
>   - Step 0's grep shows no third one.
> - **A-7, handed on.** This task edits no spec line. It states the pointer and the §21 item text, and Task A7 applies them.
> - **S1.** The change is inert on the live shape. That roster is readable and jq is present, so `_codex_lanes` answers rc 0 and every row takes the answer it takes today.
> - **F2 / F4.** Each suite command runs census-wrapped (`r11`, Global Constraints). The departure is named by slug, `⟦D:codex-kind-read-fails-closed⟧`. Fixture ids are `codex-a`, `codex-b` and `ext-a`.

**Files:**
- Modify: `ccd/ccrc`, three hunks, each located by name and never by line. The file is not stamped (D-3171), and `ccd/ccd` is not touched.
  - `_models_probe_codex_env`, plus the last paragraph of the header comment above it (`grep -n '^_models_probe_codex_env() {' ccd/ccrc`).
  - The `# WHICH ARM (D-3482)` comment block and `_models_litellm_codex` (`grep -n '^_models_litellm_codex() {' ccd/ccrc`).
  - `_models_litellm`: the first comment line of its body and its dispatch line (`grep -n '  if _models_litellm_codex "$1"; then _models_litellm_lane' ccd/ccrc`).
- Test: `server/test/ccrc-models.test.ts`.
  - Two new cases (one `it.each` of two) and one real-library case in the describe `each codex lane's probe reads its OWN authDir through its OWN runtime, with no default; …(Plan 3a Task 1)`.
  - One `it.each` of two, and one refresh case after it, in the describe `ccrc models litellm — a codex-kind lane renders its own config and restarts its own tier (D-3482)`.
  - One existing case is re-aimed, never deleted: the Z4 describe's `a roster whose codex lanes cannot be told refuses the stop too: undecidable is never "no codex lane"`. See Why.
- Modify, conditional: `server/test/session-hook.test.ts`. Only if Step 4's citation census reds, repaired by S6-R11 in this task's own commit (Step 4).
- **Unchanged, measured:** `ccd/ccrc-models-probe`, `deploy/models-op.mjs`, `server/test/models-probe.test.ts` and `server/test/codexLaneFixture.ts`. The probe's own contract is pinned with the marker handed in directly, so this seam never reaches it.

**Interfaces:**
- Consumes (2b-2 / Plan 3a, unchanged):
  - `_codex_lanes`: rc 0 with ids (empty means none); rc 1 with a `ccrc codex: roster-invalid:` line on stderr; rc 2 with a `ccrc codex: missing-dependency:` line.
  - `_codex_say` (it prints `$PROG codex: <word>: <sentence>`), `_codex_row`, and `_models_refuse <error> <exit> <detail>` (one JSON object on stdout, `$PROG: <detail>` on stderr, then `exit`).
  - Test helpers: `sourced`, `codexBox`, `oneObject` and `poisonLog` at file level; `boxGlobal`, `lanePath` and the `pgrep`/`ccgpt` poisons in the D-3482 describe; `pgrep`, `ccgpt` and `calls` in the `ccrc models litellm` describe.
- Produces:
  - `_models_litellm_codex <id>`: 0 if the row is codex-kind, 1 if the roster was read and the row is not, 2 if the roster cannot say.
    - On 2 it sets `MODELS_CODEX_UNTOLD` (`roster-invalid` | `missing-dependency`) and `MODELS_CODEX_UNTOLD_RC` (the lane library's rc). Both are top-level globals, initialised beside the function.
    - The lane library's own line stays on stderr.
  - `_models_probe_codex_env <id>`: on 2 it returns the lane library's rc (1 or 2), and the probe never runs. `_models_refresh_one` then records the forwarded line as the row's `reason`.
  - `_models_litellm <id>`: on 2 it refuses `{"ok":false,"error":"roster-invalid"|"missing-dependency",…}` with exit 1, before either arm. Nothing is rendered, pgrep is not asked, and nothing is stopped.
  - **Handed to Task A7** (A7 applies it, and its `## 21` assigns the item number `<n>`):
    - **The pointer.** Spec `:982` (`grep -n "A codex lane's probe has no default" docs/superpowers/specs/2026-09-20-gpt-lane-ownership-design.md`), the bullet whose lead is `**A codex lane's probe has no default.**`, gets ` (amended: §21.<n>, ⟦D:codex-kind-read-fails-closed⟧)` at the line's end, after `For every other row the function unsets only the marker and the interpreter.`, as Task A7's table places it. It is a same-line edit, and no line moves.
    - **The §21 item**, appended by A7 under the heading `### 21.<n> A roster that cannot say which rows are codex-kind (§20.1, §20.2)`:
      - `_models_litellm_codex`, the one reader of "is this row codex-kind" outside the install spine and doctor, answers three ways: codex, not codex, or cannot tell (`_codex_lanes` rc 1 `roster-invalid`, rc 2 `missing-dependency`). On the third answer the lane library's own line reaches stderr and is never discarded.
      - The probe-input seam, `_models_probe_codex_env`, refuses "cannot tell" with that line and the library's rc, as it refuses a `_codex_row` refusal. The probe never runs, so a codex row is never probed down the external path's default token directory, and a refresh row's `reason` is that line.
      - `_models_litellm`'s dispatcher refuses "cannot tell" before either arm, with the library's word as its envelope's `error`. A codex lane's model list never lands in the box-global file another repository's LiteLLM reads, and nothing is stopped.
      - No new word is minted. Z4's own undecidable arm (`_models_litellm_stop_blocked`) stays, for a roster that turns unreadable between the dispatcher's read and the stop guard's read.

**Why:**
- **The bug.** `_models_litellm_codex` runs `_codex_lanes 2>/dev/null` and returns 1 whenever no id matched. On rc 1 or rc 2 the library prints no ids, so a roster nobody could read answers exactly what a roster with no codex row answers. The function's own header says so ("An unreadable roster … answers "not codex" here").
- **The probe reader.** `_models_probe_codex_env` then takes the "every other row" arm. A codex row is probed through `_fetch_codex`, whose token directory has a default, which is another lane's (D-3706's wrong-lane-default class, spec `:986-987`).
- **The dispatcher reader.** `_models_litellm` falls through to the external arm. Read on `deploy/models-op.mjs`' `litellm` op, that arm renders a codex registry's model list into `$HOME/.handoff/litellm-config.yaml`, the file another repository's live LiteLLM reads, after asking `pgrep`. The dispatcher case below measures that write as its red.
- **Fail closed, as Z4 already does.** `_models_litellm_stop_blocked` (Z4) is the one place in the file that already fails closed on the same input. This task gives both readers that rule, in the library's own word, the way `_codex_row`'s refusals already reach the same seam.
- **Readers outside scope.** Every other `_codex_lanes` caller already branches on its rc: `_inst_codex_runtime`, `_inst_codex_usage`, `_inst_codex_tiers`, `_uninst_codex`, and doctor's `_check_codex` and `_fix_codex`. `ccd/ccd`'s `_codex_lanes` is a different, telemetry-keyed function that is never undecidable, and it is not edited.
- **Why the Z4 case is re-aimed.** The dispatcher now asks `_codex_lanes` before the external arm. So the existing Z4 case would hit the new `roster-invalid` refusal instead of the stop guard it pins: its stub answers rc 1 to every call. It keeps its title verbatim, because §20.10 names it as the row of record. It keeps its subject through a roster that turns unreadable between the two reads: the first read answers "no codex lane", the second rc 1. That is the race Z4's own arm still exists for. Plan 3a's mutation row 8 (Z4's `return 0` → `return 1`) must still red it (Step 5, row A1-M7).
- **Failure path only.** A roster `_codex_lanes` cannot parse is one `readRoster` refuses too, so the op that followed would have refused anyway. The difference is that the refusal now comes first, in the lane library's words, and never as a wrong-lane probe or a box-global render. A missing jq already blinded `_models_run_probe`'s own secrets read.

- [ ] **Step 0: record the base, check the census, re-run the locators (read-only).**

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  git rev-parse HEAD > "$SCRATCH/a1-base"; cat "$SCRATCH/a1-base"
  grep -n '_models_litellm_codex' ccd/ccrc | grep -v '^[0-9]*:[[:space:]]*#'
  # → three lines: `if ! _models_litellm_codex "$1"; then` (the probe seam), the definition,
  #   and `if _models_litellm_codex "$1"; then _models_litellm_lane "$1"; return $?; fi` (the dispatcher)
  grep -rln '_models_litellm_codex' ccd deploy shared server/src agent/src pwa/src
  # → ccd/ccrc only: there is no third reader
  grep -n '_codex_lanes' ccd/ccrc ccd/ccrc-doctor-checks | grep -v ':[[:space:]]*#'
  # → every caller other than `_models_litellm_codex` assigns `|| rc=$?`/`|| lrc=$?` (or `; rc=$?`) and branches on it
  cd server
  r11 a1-base-models ./node_modules/.bin/vitest list test/ccrc-models.test.ts | tail -n 1
  grep -c ' > ' "$EVID/a1-base-models/run.txt"
  ```

  The first line is the census verdict. Record the case count, the second line (one `vitest list` line per case): 164 on `be93d159`, re-derived here. A third reader in the grep is a stop: report it, and widen this task to that reader before Step 1.

- [ ] **Step 1: write the failing tests.**
  - In `server/test/ccrc-models.test.ts`, inside the Plan 3a Task 1 describe, add the following directly after the case `a codex row that does not validate is refused with _codex_row's own rc and sentence, and its probe is never handed a directory`:

    ```ts
      // Plan 3b Task A1 (⟦D:codex-kind-read-fails-closed⟧): a
      // roster whose codex rows the lane library cannot tell is refused HERE, in that
      // library's own word, line and rc, and the probe never runs. Read as "not
      // codex", an exec.kind "codex" row went down the external fetch, whose token
      // directory has a default: another lane's (D-3706's class).
      it.each([[1, 'roster-invalid'], [2, 'missing-dependency']] as const)(
        'a roster whose codex lanes cannot be told (the lane library answers rc %i) is refused at the probe-input seam with its own %s line and rc — never "not codex", and the probe never runs (Plan 3b Task A1)',
        async (rc, word) => {
          home = await codexBox(['codex-a']);
          const r = sourced(`_codex_lanes() { _codex_say ${word} "fixture: which roster lanes are codex lanes cannot be told"; return ${rc}; }; _models_run_probe codex-a env`, []);
          expect(r.code, r.stderr).toBe(rc);
          expect(r.stderr).toMatch(new RegExp(`^ccrc codex: ${word}: fixture: which roster lanes are codex lanes cannot be told$`, 'm'));
          expect(r.stdout, 'the probe ran').toBe('');
        });

      it('the REAL lane library over a roster it cannot read: its own roster-invalid sentence reaches the caller, rc 1, and the probe never runs (Plan 3b Task A1)', async () => {
        home = await codexBox(['codex-a']);
        fs.writeFileSync(join(home, '.ccrc', 'accounts.json'), '{"version":1,"accounts":{}}\n');
        const r = sourced('_models_run_probe codex-a env', []);
        expect(r.code, r.stderr).toBe(1);
        expect(r.stderr).toMatch(/^ccrc codex: roster-invalid: \$HOME\/\.ccrc\/accounts\.json could not be read as a roster, so its codex lanes are unknown — 'ccrc wrappers' prints the validator's own sentence for it\.$/m);
        expect(r.stdout, 'the probe ran').toBe('');
      });
    ```

  - In the D-3482 describe, add the following directly after its first behavioural case, `renders to the lane's own litellm.yaml through the REAL library on an idle lane — …`:

    ```ts
      // Plan 3b Task A1: the dispatcher takes NEITHER arm on a roster whose codex
      // rows cannot be told. Before it, this row fell through to the external arm,
      // which asked pgrep and rendered codex-a's model list into the box-global
      // file another repository's LiteLLM reads.
      it.each([[1, 'roster-invalid'], [2, 'missing-dependency']] as const)(
        'a roster whose codex lanes cannot be told (the lane library answers rc %i) is refused %s before either arm — never the box-global file, pgrep, ccgpt or systemd-run (Plan 3b Task A1)',
        (rc, word) => {
          const r = sourced(`_codex_lanes() { _codex_say ${word} "fixture: which roster lanes are codex lanes cannot be told"; return ${rc}; }; cmd_models litellm codex-a`, []);
          expect(r.code, r.stderr).toBe(1);
          const b = oneObject(r);
          expect(b['error']).toBe(word);
          expect(String(b['detail'])).toContain('so whether lane codex-a is exec.kind "codex" cannot be told, and neither LiteLLM arm was taken');
          expect(String(b['detail'])).toMatch(/Nothing was written and nothing was stopped\.$/);
          expect(r.stderr).toMatch(new RegExp(`^ccrc codex: ${word}: fixture: which roster lanes are codex lanes cannot be told$`, 'm'));
          expect(fs.existsSync(boxGlobal()), 'the codex row was rendered into the box-global file').toBe(false);
          expect(fs.existsSync(lanePath('codex-a'))).toBe(false);
          for (const name of ['pgrep', 'ccgpt', 'systemd-run']) expect(poisonLog(name), name).toEqual([]);
        });
    ```

  - In the same D-3482 describe, directly after that `it.each`:

    ```ts
      // Plan 3b Task A1: the refresh row of such a roster is a FAILED row whose reason
      // is the lane library's own forwarded line. The probe never runs, so the row is
      // never fetched down the external path, and neither LiteLLM arm is taken.
      it('refresh over a roster whose codex lanes cannot be told: the row is ok:false with the lane library\'s roster-invalid line as its reason, exit 1, and no pgrep, ccgpt or systemd-run call (Plan 3b Task A1)', () => {
        const r = sourced('_codex_lanes() { _codex_say roster-invalid "fixture: which roster lanes are codex lanes cannot be told"; return 1; }; cmd_models refresh codex-a', [],
          { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
        expect(r.code, r.stderr).toBe(1);
        const rows = oneObject(r)['refreshed'] as { id: string; ok: boolean; reason?: string }[];
        expect(rows).toEqual([{ id: 'codex-a', ok: false, reason: expect.any(String) }]);
        expect(rows[0]!.reason).toContain('ccrc codex: roster-invalid: fixture: which roster lanes are codex lanes cannot be told');
        expect(fs.existsSync(boxGlobal()), 'the codex row was rendered into the box-global file').toBe(false);
        for (const name of ['pgrep', 'ccgpt', 'systemd-run']) expect(poisonLog(name), name).toEqual([]);
      });
    ```

    This case is derived, not measured. If Step 2 shows the refresh refusing before any row is written, assert that envelope instead, and conform Review Focus 1's sentence to it.

  - Re-aim the Z4 case. This is the old text, unique in the file:

    ```ts
        it('a roster whose codex lanes cannot be told refuses the stop too: undecidable is never "no codex lane"', () => {
          pgrep(true);
          const r = sourced('_codex_lanes() { return 1; }; cmd_models litellm ext-a', []);
          expect(r.code).toBe(1);
    ```

    New:

    ```ts
        it('a roster whose codex lanes cannot be told refuses the stop too: undecidable is never "no codex lane"', () => {
          pgrep(true);
          // Plan 3b Task A1: the dispatcher asks `_codex_lanes` FIRST now, and refuses
          // an undecidable roster before either arm (its own cases are in the codex-kind
          // describe below). This case keeps its subject, Z4's own undecidable arm, with a
          // roster that turns unreadable BETWEEN the two reads: the first answers "no codex
          // lane", the second rc 1. The count is a file, because each read runs in its own `$(…)`.
          const counted = `_codex_lanes() { local n; n=$(( $(cat "$HOME/lanes-reads" 2>/dev/null || echo 0) + 1 )); printf '%s\\n' "$n" > "$HOME/lanes-reads"; [ "$n" -eq 1 ] && return 0; return 1; }`;
          const r = sourced(`${counted}; cmd_models litellm ext-a`, []);
          expect(fs.readFileSync(join(home, 'lanes-reads'), 'utf8'), 'the dispatcher and the stop guard each read once').toBe('2\n');
          expect(r.code).toBe(1);
    ```

    The case's remaining lines (`restart-failed`, `…(the lane library answered rc 1)`, no `ccgpt` call, no config) stay byte for byte.

- [ ] **Step 2: run them red.** Foreground, one call, timeout at least 600000 ms:

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  cd server
  r11 a1-red ./node_modules/.bin/vitest run test/ccrc-models.test.ts
  ```

  Expected: `Tests 6 failed | <Step 0 count> passed (<Step 0 count + 6>)` under `census: clean — … command exit 1`. The reason each new case fails today:
  - **The two probe-seam cases:** `expected 0 to be 1` and `expected 0 to be 2`. The seam reads "not codex", and `env` runs and prints.
  - **The real-library case:** `expected 0 to be 1`, for the same reason.
  - **The two dispatcher cases:** `expected 0 to be 1`. The external arm rendered codex-a into `boxGlobal()` and logged a `pgrep` call.
  - **The refresh case:** `expected 0 to be 1`. The seam read "not codex", so the probe ran and the row read `ok:true`.

  The re-aimed Z4 case is GREEN before this change, with `lanes-reads` at `2`. Any other red is a finding.

- [ ] **Step 3: implement (`ccd/ccrc`).**
  - **The probe seam.** Old (unique):

    ```bash
    # (`_models_litellm_codex`, that is `_codex_lanes`) and its one reader of a
    # row (`_codex_row`). A codex row that does not validate is refused with
    # `_codex_row`'s own rc and sentence, and the probe never runs.
    _models_probe_codex_env() {   # <accountId> -> 0, or _codex_row's rc for a codex row that does not validate
      if ! _models_litellm_codex "$1"; then
        unset CCRC_CODEX_PYTHON CCRC_PROBE_LANE_KIND
        return 0
      fi
      _codex_row "$1" || return $?
    ```

    New:

    ```bash
    # (`_models_litellm_codex`, that is `_codex_lanes`) and its one reader of a
    # row (`_codex_row`). A codex row that does not validate is refused with
    # `_codex_row`'s own rc and sentence, and the probe never runs.
    # A ROSTER THAT CANNOT SAY (Plan 3b Task A1,
    # ⟦D:codex-kind-read-fails-closed⟧): `_models_litellm_codex`
    # rc 2 is refused the same way. The lane library's own `ccrc codex:
    # roster-invalid:` or `missing-dependency:` line is already on stderr, its rc
    # is returned, and the probe never runs. Never "not codex": that arm hands an
    # exec.kind "codex" row to the external fetch, whose token directory has a
    # default, which is another lane's (D-3706's class).
    _models_probe_codex_env() {   # <accountId> -> 0; _codex_row's rc for a codex row that does not validate; the lane library's rc for a roster that cannot say
      local kind=0
      _models_litellm_codex "$1" || kind=$?
      case "$kind" in
        0) ;;
        1) unset CCRC_CODEX_PYTHON CCRC_PROBE_LANE_KIND
           return 0 ;;
        *) unset CCRC_CODEX_PYTHON CCRC_PROBE_LANE_KIND
           [ "$MODELS_CODEX_UNTOLD_RC" -ne 0 ] && return "$MODELS_CODEX_UNTOLD_RC"
           return 1 ;;
      esac
      _codex_row "$1" || return $?
    ```

  - **The reader.** Old (unique):

    ```bash
    # WHICH ARM (D-3482): `exec.kind == "codex"` read off
    # ~/.ccrc/accounts.json by the lane library's ONE reader of that question
    # (`_codex_lanes`) — never accounts.sh's CCRC_CODEX_BACKEND, which is keyed
    # on `telemetry` and names today's EXTERNAL live lanes. An unreadable roster
    # (`_codex_lanes` rc 1, no ids) answers "not codex" here and still cannot
    # write through the external arm: that arm's PHASE 1 hands the same file to
    # the op, whose `readRoster` refuses before anything is rendered, in its own
    # sentence. The library's `ccrc codex: roster-invalid:` line is discarded,
    # because it would be the wrong verb's prefix in a `ccrc models` run.
    _models_litellm_codex() {   # <accountId> -> 0 iff the roster row is exec.kind "codex"
      local l
      while IFS= read -r l; do [ "$l" = "$1" ] && return 0; done < <(_codex_lanes 2>/dev/null)
      return 1
    }
    ```

    New:

    ```bash
    # WHICH ARM, AND WHETHER IT CAN BE TOLD (D-3482; Plan 3b Task A1,
    # ⟦D:codex-kind-read-fails-closed⟧): `exec.kind == "codex"`
    # read off ~/.ccrc/accounts.json by the lane library's ONE reader of that
    # question (`_codex_lanes`) — never accounts.sh's CCRC_CODEX_BACKEND, which is
    # keyed on `telemetry` and names today's EXTERNAL live lanes. THREE answers,
    # never two:
    #   - 0: the row is codex-kind;
    #   - 1: the roster was read, and the row is not;
    #   - 2: the roster cannot say: `_codex_lanes` rc 1 (`roster-invalid`) or rc 2
    #     (`missing-dependency`); any other non-zero reads `roster-invalid`, the
    #     library's word for a roster it could not read. The library's own
    #     `ccrc codex: <word>:` line is LEFT ON STDERR, never discarded, and
    #     MODELS_CODEX_UNTOLD names the word, MODELS_CODEX_UNTOLD_RC the rc.
    # Undecidable is never "not codex" (Z4's rule, `_models_litellm_stop_blocked`
    # above). Folded into 1, it sent a codex row's probe down the external
    # fetch's default token directory, and its LiteLLM render into the
    # box-global file another repository's proxy reads. Both readers refuse 2 in
    # the library's word: `_models_probe_codex_env` and `_models_litellm`'s
    # dispatcher, the only two (Plan 3b Task A1's grep). Both call it in their
    # own shell, so the two names reach them.
    MODELS_CODEX_UNTOLD=''
    MODELS_CODEX_UNTOLD_RC=0
    _models_litellm_codex() {   # <accountId> -> 0 codex, 1 not codex, 2 the roster cannot say (above)
      local ids rc=0
      MODELS_CODEX_UNTOLD=''; MODELS_CODEX_UNTOLD_RC=0
      ids="$(_codex_lanes)" || rc=$?
      if [ "$rc" -ne 0 ]; then
        MODELS_CODEX_UNTOLD_RC="$rc"
        MODELS_CODEX_UNTOLD=roster-invalid
        [ "$rc" -eq 2 ] && MODELS_CODEX_UNTOLD=missing-dependency
        return 2
      fi
      case $'\n'"$ids"$'\n' in *$'\n'"$1"$'\n'*) return 0 ;; esac
      return 1
    }
    ```

  - **The dispatcher.** Old (unique):

    ```bash
      # A codex-kind lane takes its own arm (`_models_litellm_lane`, above).
    ```

    New:

    ```bash
      # A codex-kind lane takes its own arm (`_models_litellm_lane`, above), and a
      # roster that cannot say whether this row is one takes NEITHER (Plan 3b Task A1).
    ```

    Old (unique):

    ```bash
      if _models_litellm_codex "$1"; then _models_litellm_lane "$1"; return $?; fi
      local file check crc
    ```

    New:

    ```bash
      # WHICH ARM (Plan 3b Task A1, ⟦D:codex-kind-read-fails-closed⟧):
      # refused in the lane library's own word, `_codex_row`'s propagation, and its
      # own line is already on stderr. The external arm would render a codex row's
      # model list into the box-global file another repository's LiteLLM reads;
      # the codex arm would act on a row nobody read.
      local kind=0
      _models_litellm_codex "$1" || kind=$?
      case "$kind" in
        0) _models_litellm_lane "$1"; return $? ;;
        1) ;;
        *) if [ "$MODELS_CODEX_UNTOLD" = missing-dependency ]; then
             _models_refuse missing-dependency 1 "jq is not on PATH (the lane library's ccrc codex: missing-dependency line says so), so whether lane $1 is exec.kind \"codex\" cannot be told, and neither LiteLLM arm was taken: a codex lane's model list never goes to the box-global file, and an external lane's is never rendered as a codex one. Install jq, then re-run this command. Nothing was written and nothing was stopped."
           fi
           _models_refuse roster-invalid 1 "\$HOME/.ccrc/accounts.json could not be read as a roster (the lane library answered rc $MODELS_CODEX_UNTOLD_RC; its ccrc codex: roster-invalid line says why), so whether lane $1 is exec.kind \"codex\" cannot be told, and neither LiteLLM arm was taken: a codex lane's model list never goes to the box-global file, and an external lane's is never rendered as a codex one. Fix the roster ('ccrc wrappers' prints the validator's sentence), then re-run this command. Nothing was written and nothing was stopped." ;;
      esac
      local file check crc
    ```

- [ ] **Step 4: run green, then the neighbours.** Each block is ONE foreground call, timeout at least 600000 ms:

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  cd server
  r11 a1-green ./node_modules/.bin/vitest run test/ccrc-models.test.ts
  ```

  Expected: `Tests <Step 0 count + 6> passed`, `census: clean`.

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  cd server
  r11 a1-neigh-probe ./node_modules/.bin/vitest run test/models-probe.test.ts
  ```

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  cd server
  r11 a1-neigh-codex ./node_modules/.bin/vitest run test/ccrc-codex.test.ts -t '^_codex_lanes|^_codex_row'
  ```

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  cd server
  r11 a1-neigh-hook ./node_modules/.bin/vitest run test/session-hook.test.ts
  ```

  - `models-probe` and `ccrc-codex`: green, with their counts unchanged.
  - `session-hook`: the compaction-card corpus cites `ccd/ccrc` at lines this task's three hunks sit above (`:10990`, `:11635`), and those citations are COUNTED, never re-anchored (`'ccd/ccrc': 5`). Plan 3a's Tasks 1 and 2 added lines above them and the count did not move. If it reds anyway, repair it by S6-R11 in this task's own commit:
    1. Copy the edited `ccd/ccrc` aside, and `git show "$(cat "$SCRATCH/a1-base")":ccd/ccrc > ccd/ccrc`.
    2. Insert a dump line above the red assertion, `fs.writeFileSync(path.join(process.env.S6_DUMP!, '<case>.json'), JSON.stringify(<asserted expression>, null, 1));`, and run with `S6_DUMP=$SCRATCH/a1-s6/base`.
    3. Restore the edit and run again with `S6_DUMP=$SCRATCH/a1-s6/task`, then `diff` the two dumps.
    4. Paste the TASK values in the instrument's own order. Append one comment paragraph naming the cause: "Plan 3b Task A1's edits to `_models_probe_codex_env`, `_models_litellm_codex` and `_models_litellm`; no corpus document edited, no rule changed — S6-R11, no D-number".
    5. Remove the probe line. `git diff server/test/session-hook.test.ts` shows only the value and that paragraph. Never widen a rule.

- [ ] **Step 5: the mutation table. MEASURE every row both ways.**
  - Stage this task's files, so the index holds the green tree, then back up `ccd/ccrc`:

    ```bash
    . "<abs scratch>/plan3b-exec/plan3b-env.sh"
    git add ccd/ccrc server/test/ccrc-models.test.ts
    mkdir -p "$SCRATCH/a1-mut" && cp ccd/ccrc "$SCRATCH/a1-mut/ccrc"
    ```

  - For each row alone, apply the mutation and run:

    ```bash
    . "<abs scratch>/plan3b-exec/plan3b-env.sh"
    cd server
    r11 a1-mut-<row> ./node_modules/.bin/vitest run test/ccrc-models.test.ts -t 'Plan 3b Task A1|undecidable is never'
    ```

  - Then restore the file and verify the restore. Re-run the row's command labelled `a1-mut-<row>-green`:

    ```bash
    . "<abs scratch>/plan3b-exec/plan3b-env.sh"
    cp "$SCRATCH/a1-mut/ccrc" ccd/ccrc && git diff --quiet -- ccd/ccrc && echo restored
    ```

  - The red counts below are derived from the cases, not measured yet. Record the measured ones. If a row does not red, report that; never add code to force a bind.

  | # | Guard | Mutation (in `ccd/ccrc`) | Goes red |
  |---|---|---|---|
  | A1-M1 | the reader never folds undecidable into "not codex" | in `_models_litellm_codex`, `ids="$(_codex_lanes)" \|\| rc=$?` → `ids="$(_codex_lanes 2>/dev/null)" \|\| return 1` | 6: both probe-seam rows, the real-library case, both dispatcher rows and the refresh case |
  | A1-M2 | the probe seam refuses 2 | in `_models_probe_codex_env`'s `*)` arm, replace its two `return` lines with `return 0` | 4: both probe-seam rows, the real-library case (the probe runs `env`) and the refresh case (its row reads ok) |
  | A1-M3 | the dispatcher refuses 2 before either arm | in `_models_litellm`, the whole `*)` arm's body → `;;` | 2: both dispatcher rows (`boxGlobal()` written, `pgrep` logged) |
  | A1-M4 | the dispatcher forwards the library's word | `[ "$MODELS_CODEX_UNTOLD" = missing-dependency ]` → `false` | 1: the dispatcher's rc 2 row (`error` reads `roster-invalid`) |
  | A1-M5 | the library's line is forwarded, never swallowed | `ids="$(_codex_lanes)" \|\| rc=$?` → `ids="$(_codex_lanes 2>/dev/null)" \|\| rc=$?` | 6: every new case's stderr or reason assertion |
  | A1-M6 | the probe seam returns the library's rc | `[ "$MODELS_CODEX_UNTOLD_RC" -ne 0 ] && return "$MODELS_CODEX_UNTOLD_RC"` → `:` | 1: the probe-seam rc 2 row (`expected 1 to be 2`) |
  | A1-M7 | Z4's own undecidable arm is still bound | Plan 3a's row 8: in `_models_litellm_stop_blocked`'s `if [ "$rc" -ne 0 ]` branch, `return 0` → `return 1` | 1: the re-aimed Z4 case |
  | A1-M8 | missing jq is its own word, never `roster-invalid` | in `_models_litellm_codex`, `[ "$rc" -eq 2 ] && MODELS_CODEX_UNTOLD=missing-dependency` → `:` | 1: the dispatcher's rc 2 row |

- [ ] **Step 6: scope and residue check,** against this task's own base:

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  BASE="$(cat "$SCRATCH/a1-base")"
  git diff --name-only "$BASE"
  # → ccd/ccrc, server/test/ccrc-models.test.ts (and server/test/session-hook.test.ts only if Step 4 repaired it)
  git diff --quiet "$BASE" -- ccd/ccd ccd/ccrc-models-probe ccd/ccrc-doctor-checks deploy shared docs && echo untouched
  # → untouched
  ids="$(jq -r '.accounts[] | select(.telemetry == "codex") | .id' "$HOME/.ccrc/accounts.json")"
  printf '%s\n' "$ids" | grep -c .
  # → the box's Codex-telemetry row count, read now and never printed
  printf '%s\n' "$ids" | while IFS= read -r id; do
    git diff "$BASE" | grep '^+' | sed 's/$/ /' | grep -cE "[^[:alnum:]_-]${id}[^[:alnum:]_-]"
  done
  # → 0 for each: no added line names a live lane id. Only counts print.
  ```

- [ ] **Step 7: commit.**

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  git add ccd/ccrc server/test/ccrc-models.test.ts
  git commit -F - <<'EOF'
  fix(models): a roster that cannot say which rows are codex-kind is refused, never read as "not codex"

  _models_litellm_codex folded the lane library's roster-invalid (rc 1) and
  missing-dependency (rc 2) answers into "not codex", the answer a roster
  with no codex row gives. So a codex row's probe went down the external
  fetch, whose token directory has a default (another lane's), and its
  LiteLLM render went to the box-global file another repository reads.
  The reader now answers codex / not codex / cannot tell, and leaves the
  library's own line on stderr. Both readers, the probe-input seam and
  _models_litellm's dispatcher, refuse "cannot tell" in the library's word,
  as _codex_row's refusals already do. Z4's stop guard keeps its own arm
  for a roster that turns unreadable between the two reads. Inert on a
  readable roster.

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git log -1 --format='%an <%ae> | %cn <%ce>'
  ```

  Expected: the worktree's noreply identity only. Any other identity stops the task.

### Task A2: the usage converge re-measures each withdrawal, and doctor names a surplus ccrc usage timer

> Rulings applied:
> - **A-2.** `_inst_codex_usage`'s two `systemctl --user disable --now` calls count an instance as withdrawn only when a re-read of its `timers.target.wants` link (`! _codex_usage_enabled "$u"`) agrees. Otherwise the run prints the EXISTING could-not-disable and `NOT CONVERGED` line shapes, byte for byte, and degrades `codex-usage`.
>   - Doctor gets its own WARN line in the codex usage rows, one per id. It names every enabled `ccrc-codex-usage@<id>.timer` whose id is not a codex lane now. Its remedy is the exact `systemctl --user disable --now ccrc-codex-usage@<id>.timer`, ccrc's own unit, because no fixer withdraws it (`_fix_codex` enables or disables no unit). The next update's converge is named as the automatic cure (reconcile ruling R6).
  - **`_uninst_codex_usage`'s rc-only count (reconcile ruling R7)** gets the same re-read: a timer is counted stopped only when its link is measurably gone.
> - **The carry-forward bullet, whole** (Plan 3a's `### Final-review follow-ups`, "Usage-converge flip-back gaps"). It also names two sentences that such a timer makes false:
>   - the left-lane-state WARN's "nothing of ccrc's reads it" (the publisher reads that lane's `lane.json`);
>   - the second-writer WARN's "ccrc withholds its own", over a box where ccrc's own timer is enabled too.
>
>   Each now says what was measured.
> - **A-7, handed on.** This task edits no spec line. It states the two pointers (`:1039`, and `:1035` by controller ruling NC-1) and the §21 item text, and Task A7 applies them.
> - **S1.** The change is inert on the live shape: no `ccrc-codex-usage@<id>.timer` instance exists there (census), so the surplus set is empty and doctor's codex check still SKIPs. With no codex lane and no instance, the converge still prints `none`.
> - **F2 / F4.** Census-wrapped commands. Slugs: `⟦D:usage-withdrawal-is-re-measured⟧` and `⟦D:surplus-ccrc-usage-timer-warns⟧`.

**Files:**
- Modify: `ccd/ccrc`, `_inst_codex_usage` only (`grep -n '^_inst_codex_usage() {' ccd/ccrc`): its header comment gains one paragraph, and its two disables gain the re-read. Both sit below `ccd/ccrc:11635`, the highest line the compaction-card corpus cites. The file is not stamped.
- Modify: `ccd/ccrc-doctor-checks`:
  - two new functions, `_dr_codex_usage_surplus` and `_dr_codex_usage_surplus_rows`, between `_dr_codex_usage`'s closing `}` and the `# ── codex: the ccrc-owned Codex lanes on this box, measured end to end` header;
  - `_dr_codex_usage`'s first branch;
  - in `_check_codex`: the loaded guard's list, the empty-population SKIP's condition, the left-lane-state loop, and one call before `_dr_cx_report`.

  The highest `ccrc-doctor-checks:<N>` citation in tracked non-docs text is `:2542`, so nothing cited moves.
- Test: `server/test/ccrc-install.test.ts`: `runUsageStep` gains a `keepLink` option (its `systemctl` stand-in's `disable` arm and its docstring), and two new cases are added in `describe('ccrc install: the codex usage converge, measured in isolation (_inst_codex_usage, Plan 3a Task 6)')`.
- Test: `server/test/ccrc-doctor.test.ts`:
  - file-level constants `SURPLUS_ROWS`, `SURPLUS_WARN`, `SURPLUS_FIX`, `UNLISTABLE_WARN` and `UNLISTABLE_FIX`, below `usageBox`;
  - three new cases in the Linux usage-rows describe, one re-aimed and one new second-writer case;
  - in the any-host usage-rows describe, one forced-Darwin case and one new `it.each` row;
  - in `ccrc doctor: codex, part 1`, the flip-back case re-aimed (never deleted) and three new cases.
- Modify: `ccd/ccrc`, `_uninst_codex_usage`'s one disable (ruling R7): a timer is counted stopped only when the same re-read finds its link gone, and a kept link lands in that function's existing `failed` line.
- Test: `server/test/ccrc-uninstall.test.ts`: its `systemctl` stand-in's `disable` arm gains a `usage-keeplink` file, and one case is added after the Plan 3a Task 7 usage-template case.
- **Unchanged, measured:** `_codex_usage_enabled`, `_codex_usage_enabled_ids` and every other reader in the `_codex_usage_*` family; `_acct_remove_usage` (already re-measures; Task A3's); and `server/test/codexLaneFixture.ts` (`plantCodexUsage`'s `pair`/`enabled`/`row` options suffice).

**Interfaces:**
- Consumes (Plan 3a Task 6, unchanged): `_codex_usage_timer`, `_codex_usage_foreign`, `_codex_usage_wants`, `_codex_usage_enabled <unit>` (a dangling link counts), and `_codex_usage_enabled_ids` (one id per line, glob order; rc 1 with `_codex_shape`'s sentence when the shape contract is missing; reads no roster). Doctor's `_dr_cx_warn`, `_dr_cx_member`, `_dr_cx_report` and the `DRX_*` arrays. Test helpers: `runUsageStep`, `T`, `DIS` and `ctl` (describe-local); `usageRows`, `usageBox`, `plantCodexUsage`, `plantForeignUsage`, `healthy`, `healthyCodexBox`, `codexRoster`, `lanePorts`, `runDoctor`, `codexVerdicts`, `remedyAfter`, `noRunnerBugLine` and `itLinux`.
- Produces:
  - `_inst_codex_usage`: a withdrawal is named only when the link is measurably gone. A disable answered 0 with the link still there lands in `stuck`: the same stderr could-not-disable line, the same `NOT CONVERGED — ccrc's own usage timer is still enabled for <ids>, …` line, and the same single `codex-usage` degraded step. On the foreign arm, the lane's `NOT ENABLED` line says `… is enabled too, and this run could not disable it, so both publishers are armed.`
  - `_dr_codex_usage_surplus <codex lane id>…` sets `DR_CODEX_USAGE_SURPLUS` (an array, glob order). It returns 0 when measured, 1 when the enabled set cannot be listed, and 3 on macOS (not applicable).
  - `_dr_codex_usage_surplus_rows <that rc>` records one WARN per surplus id, or one unmeasured WARN on rc 1.
  - **The surplus WARN, verbatim** (Part B's soak gate reads doctor clean by its absence): `WARN codex: ccrc-codex-usage@<id>.timer is still enabled, and '<id>' is not a Codex lane in $HOME/.ccrc/accounts.json, so ccrc's usage publisher still runs for '<id>' every cycle: the writer of $HOME/.cc-limits/<id>.json, and of a token refresh in the authDir its lane.json names, for a lane ccrc no longer runs`. Its remedy line: `  remedy: systemctl --user disable --now ccrc-codex-usage@<id>.timer (ccrc's own unit; no ccrc fixer withdraws it), or leave it to the next update, whose converge withdraws a ccrc usage timer whose id is no longer a Codex lane and re-measures the link`.
  - `_uninst_codex_usage`: a timer is counted in `<n> codex usage timer(s) stopped and disabled` only when its link is measurably gone. A disable answered 0 with the link still there prints that function's existing `uninstall: units: disable --now <unit> failed (continuing …)` line.
  - `_check_codex` no longer SKIPs while `DR_CODEX_USAGE_SURPLUS` is non-empty or the set is unlistable. The left-lane-state WARN's last clause reads `ccrc's own ccrc-codex-usage@<id>.timer still reads it (the WARN naming that timer says how to withdraw it)` for a surplus id, and is byte for byte today's for every other id.
  - `_dr_codex_usage`, when both `ccgpt-usage@<id>.timer` and `ccrc-codex-usage@<id>.timer` are enabled, WARNs `<id>: another repository's <f> is enabled, and ccrc's own <t> is enabled too, so two publishers race this lane's ~/.cc-limits row and two token refreshes its OAuth directory`. Its remedy names ccrc's withdrawal first. The withheld-only case keeps today's sentence.
  - **Handed to Task A7** (A7 applies it, and its `## 21` assigns `<m>`):
    - **The pointer.** On spec `:1039` (`grep -n "A withdrawal systemd refuses leaves" docs/superpowers/specs/2026-09-20-gpt-lane-ownership-design.md`), `naming every lane whose timer is still enabled.` becomes `naming every lane whose timer is still enabled. (amended: §21.2, ⟦D:usage-withdrawal-is-re-measured⟧, ⟦D:surplus-ccrc-usage-timer-warns⟧)`, as Task A7's table writes it. It is a same-line edit, and no line moves.
    - **The second pointer** (controller ruling NC-1). On spec `:1035` (`grep -n 'Beside a foreign instance' docs/superpowers/specs/2026-09-20-gpt-lane-ownership-design.md`), the §20.4 bullet `- **Beside a foreign instance.** …` gets ` (amended: §21.2, ⟦D:surplus-ccrc-usage-timer-warns⟧)` directly after `WARNs with the operator's own disable as the remedy`, before its full stop, as Task A7's table writes it. This task's both-enabled WARN names ccrc's withdrawal first, so that sentence's remedy is now the withheld case's only. It is a same-line edit, and no line moves.
    - **The §21 item**, appended under `### 21.<m> A withdrawal is re-measured, and doctor names a ccrc usage timer no lane owns (§20.3, §20.4)`:
      - A withdrawal counts only when a re-read of `timers.target.wants/` finds the link gone, at both of `_inst_codex_usage`'s disables, and at `_uninst_codex_usage`'s. A disable the manager answers 0 while the link stays gets the refused withdrawal's own stderr line and `NOT CONVERGED` step: it is the same fact, ccrc's timer still enabled, and the same remedy. This is the reading account removal already has (§20.4's last bullet).
      - `_check_codex` WARNs, one line per id, on every enabled `ccrc-codex-usage@<id>.timer` whose id is not a codex lane now. The set is read by `_codex_usage_enabled_ids` (no roster) minus the codex lanes. The remedy is `systemctl --user disable --now ccrc-codex-usage@<id>.timer`, ccrc's own unit, with the next update's converge as the automatic cure.
      - Such an id is a subject on its own, so the empty-population SKIP never stands over it, and a set that cannot be listed is its own WARN, unmeasured. The row is not applicable on macOS.
      - The left-lane-state WARN says "nothing of ccrc's reads it" only when no such timer is enabled for that id, because the publisher reads the `lane.json` a flip back keeps.
      - The second-writer WARN says ccrc withholds its own timer only when that timer is not enabled. When both are, it says both publishers are armed, and names ccrc's withdrawal first.

**Why:**
- **The rc-only verdict.** `_inst_codex_usage` runs `if systemctl --user disable --now "$u"; then withdrawn+=(…)` at its withdraw-first loop and again on its foreign arm. It trusts the exit code, while its sibling `_acct_remove_usage` runs `… >&2 && ! _codex_usage_enabled "$u"`. `ccrc-account.test.ts`'s C15 pins why: a disable the manager answers 0 while the link stays is not a removal. So on a flip back, the converge could print `withdrawn from <id>` over a timer that goes on polling. `_uninst_codex_usage` counted its stops the same way, and ruling R7 folds it in here.
- **No doctor row.** Doctor's per-id usage rows run only over today's codex lanes (`for id in "${lanes[@]}"`), so nothing names that survivor. Either cause leaves `ccrc-codex-usage@<id>.timer` running for an id ccrc no longer runs: this gap, or a roster flip with no `ccrc install` since. Each cycle it rewrites `~/.cc-limits/<id>.json`, and its publisher (`ccd/ccgpt-usage.py`, which reads `~/.ccrc/codex/<id>/lane.json`) refreshes that lane's token.
- **Two false sentences.** The same survivor makes the left-lane-state WARN's "nothing of ccrc's reads it" false. On a still-codex lane whose withdrawal beside a foreign timer did not take, the second-writer WARN's "ccrc withholds its own" is false too: its fixture, `usageBox` with `plantForeignUsage`, is in fact BOTH armed. Each sentence now says what the links say. The second-writer case keeps its title verbatim, because §20.10 cites it as the row of record. Its expected sentence moves to the both-armed WARN, and a new case pins the withheld-only sentence, which is now true only where it is said.
- **Measured before the SKIP.** The surplus is measured BEFORE the empty-population SKIP. A box whose last codex lane flipped back, and whose lane state was removed by hand, has nothing else for this check to see. A SKIP there would say no ccrc lane runs over a timer that does. A set `_codex_usage_enabled_ids` cannot list is unmeasured, never empty (this codebase's overloaded-null rule), so it is its own WARN and blocks the SKIP too. `_check_wrappers` already FAILs the missing shape contract that causes it.
- **macOS.** ccrc places no launchd job (decision 17), so the row answers not-applicable (rc 3) and records nothing. That is `_dr_codex_usage_box`'s doctrine, and it is pinned by a forced-Darwin case.
- **One line shape.** The could-not-disable and `NOT CONVERGED` lines keep their bytes (ruling A-2: "the existing NOT CONVERGED line shape"). A refusal and an accepted-but-untaken disable are the same fact and the same operator remedy, as account removal already treats them.

- [ ] **Step 0: record the base, check the census, re-run the locators (read-only).**

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  git rev-parse HEAD > "$SCRATCH/a2-base"; cat "$SCRATCH/a2-base"
  grep -nF 'if systemctl --user disable --now "$u"; then' ccd/ccrc
  # → exactly three lines: two inside _inst_codex_usage (its withdraw-first loop and its foreign arm), one inside _uninst_codex_usage
  grep -nF 'systemctl --user disable --now "$u" >&2 && ! _codex_usage_enabled "$u"' ccd/ccrc
  # → one line: _acct_remove_usage, the reading this task copies
  grep -n 'nothing of ccrc.s reads it while\|ccrc withholds its own \$t while it stands' ccd/ccrc-doctor-checks
  # → two lines: the left-lane-state WARN and the second-writer WARN
  grep -n '_codex_usage_enabled_ids' ccd/ccrc-doctor-checks
  # → nothing: doctor never reads ccrc's enabled set today
  grep -rn 'ccrc-codex-usage@' server/test/ccrc-update.test.ts server/test/ccrc-install-graphify.test.ts | grep -v 'enable --now'
  # → nothing: those harnesses' `disable` arms (exit 0, no link removed) are reached by no case that plants a ccrc instance
  grep -cF 'rm -f -- "$HOME/.config/systemd/user/timers.target.wants/$3" ;;' server/test/ccrc-uninstall.test.ts
  # → 1: the uninstall stand-in's disable arm, which Step 1 widens
  ```

- [ ] **Step 1: write the failing tests.**
  - `server/test/ccrc-install.test.ts`, `runUsageStep`:
    - In its docstring, after `A unit listed in \`refuse\` is refused.`, add: `A unit listed in \`keepLink\` (Plan 3b Task A2) is a disable the manager ANSWERS 0 while its link stays — the shape \`ccrc-account.test.ts\`'s C15 pins for account removal.`
    - In its parameter type, `refuse?: string[]; shape?: boolean;` becomes `refuse?: string[]; keepLink?: string[]; shape?: boolean;`.
    - After `writeFileSync(join(home, 'refuse'), (c.refuse ?? []).map((u) => \`${u}\n\`).join(''));`, add:

      ```ts
        writeFileSync(join(home, 'keeplink'), (c.keepLink ?? []).map((u) => `${u}\n`).join(''));
      ```

    - Old (unique):

      ```ts
          '    disable) rm -f -- "$HOME/.config/systemd/user/timers.target.wants/$4"; return 0 ;;',
      ```

      New:

      ```ts
          '    disable) grep -qxF -- "$4" "$HOME/keeplink" || rm -f -- "$HOME/.config/systemd/user/timers.target.wants/$4"; return 0 ;;',
      ```

  - Same file, two new cases at the end of the isolation describe, after its forced-Darwin case:

    ```ts
      it('a withdrawal the manager answers 0 while its link stays is NOT withdrawn: the could-not-disable line, NOT CONVERGED, and one degraded step — measured, never read off the exit code (Plan 3b Task A2)', () => {
        const r = runUsageStep({ lanes: [], enabled: ['ext-a'], keepLink: [T('ext-a')] });
        expect(ctl(r)).toEqual([DIS('ext-a')]);
        expect(r.links, 'the stand-in removed the link it was told to keep').toEqual([T('ext-a')]);
        expect(r.degraded).toEqual(['codex-usage']);
        expect(r.stderr).toMatch(/^install: codex-usage: could not disable ccrc-codex-usage@ext-a\.timer — account ext-a is no longer a codex lane, so its timer must not poll; run: systemctl --user disable --now ccrc-codex-usage@ext-a\.timer$/m);
        expect(r.stdout, 'a withdrawal the link contradicts was claimed').toBe(
          'install: codex-usage: NOT CONVERGED — ccrc\'s own usage timer is still enabled for ext-a, which this run had to withdraw and systemd would not disable (the could-not-disable line above names each, with its command). This install continues. Run those commands, then re-run: ccrc install\n');
      });

      it('on the foreign arm too: a disable answered 0 with the link still there says both publishers are armed, never "this run disabled it" (Plan 3b Task A2)', () => {
        const r = runUsageStep({ lanes: ['codex-a'], enabled: ['codex-a'], foreign: ['codex-a'], keepLink: [T('codex-a')] });
        expect(ctl(r)).toEqual([DIS('codex-a')]);
        expect(r.links).toEqual(['ccgpt-usage@codex-a.timer', T('codex-a')]);
        expect(r.degraded).toEqual(['codex-usage']);
        expect(r.stderr).toMatch(/^install: codex-usage: could not disable ccrc-codex-usage@codex-a\.timer — run: systemctl --user disable --now ccrc-codex-usage@codex-a\.timer$/m);
        expect(r.stdout).toMatch(/^install: codex-usage: NOT ENABLED for codex-a — .* ccrc's own ccrc-codex-usage@codex-a\.timer is enabled too, and this run could not disable it, so both publishers are armed\. ccrc never disables another tool's unit: /m);
        expect(r.stdout).not.toMatch(/this run disabled it/);
        expect(r.stdout).toMatch(/^install: codex-usage: enabled for no lane; withheld from codex-a; withdrawn from no lane$/m);
        expect(r.stdout).toMatch(/^install: codex-usage: NOT CONVERGED — ccrc's own usage timer is still enabled for codex-a, which this run had to withdraw and systemd would not disable/m);
      });
    ```

  - `server/test/ccrc-uninstall.test.ts` (ruling R7). In the `systemctl` stand-in's `disable` arm, old (unique):

    ```ts
        '      rm -f -- "$HOME/.config/systemd/user/timers.target.wants/$3" ;;',
    ```

    New:

    ```ts
        '      grep -qxF -- "$3" "$HOME/usage-keeplink" 2>/dev/null || rm -f -- "$HOME/.config/systemd/user/timers.target.wants/$3" ;;',
    ```

    Then one case, directly after the Plan 3a Task 7 case `every ENABLED instance of ccrc\'s usage template is stopped and disabled …`:

    ```ts
      itLinux('an instance whose disable the manager answers 0 while its link stays is NOT counted stopped: its failed line names it and the count is the measured one (Plan 3b Task A2, usage template)', () => {
        const home = mkTmp('ccrc-uninst-usage-keeplink-');
        plantInstalledBox(home);
        const units = join(home, '.config', 'systemd', 'user');
        const wants = join(units, 'timers.target.wants');
        mkdirSync(wants, { recursive: true });
        for (const id of ['codex-a', 'codex-b']) symlinkSync(join(units, 'ccrc-codex-usage@.timer'), join(wants, `ccrc-codex-usage@${id}.timer`));
        writeFileSync(join(home, 'usage-keeplink'), 'ccrc-codex-usage@codex-b.timer\n');
        const r = runVerb(home, 'uninstall');
        expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
        expect(r.stdout).toMatch(/^uninstall: units: 1 codex usage timer\(s\) stopped and disabled$/m);
        expect(r.stderr).toMatch(/^uninstall: units: disable --now ccrc-codex-usage@codex-b\.timer failed \(continuing/m);
      });
    ```

  - `server/test/ccrc-doctor.test.ts`, file level, directly below `function usageBox(…) { … }`:

    ```ts
    /** Plan 3b Task A2 (⟦D:surplus-ccrc-usage-timer-warns⟧): the surplus row,
     *  measured, recorded and printed alone, for `usageRows`' `script`. */
    const SURPLUS_ROWS = [
      'DRX_CLASS=(); DRX_WHAT=(); DRX_FIX=()',
      's=0; _dr_codex_usage_surplus codex-a || s=$?',
      'printf "rc=%s\\nsurplus=%s\\n" "$s" "${DR_CODEX_USAGE_SURPLUS[*]-}"',
      '_dr_codex_usage_surplus_rows "$s"',
      '_dr_cx_report "surplus measured"; :',
    ].join('\n');
    const SURPLUS_WARN = (id: string): string => `WARN codex: ccrc-codex-usage@${id}.timer is still enabled, and '${id}' is not a Codex lane in $HOME/.ccrc/accounts.json, so ccrc's usage publisher still runs for '${id}' every cycle: the writer of $HOME/.cc-limits/${id}.json, and of a token refresh in the authDir its lane.json names, for a lane ccrc no longer runs`;
    const SURPLUS_FIX = (id: string): string => `  remedy: systemctl --user disable --now ccrc-codex-usage@${id}.timer (ccrc's own unit; no ccrc fixer withdraws it), or leave it to the next update, whose converge withdraws a ccrc usage timer whose id is no longer a Codex lane and re-measures the link`;
    const UNLISTABLE_WARN = "WARN codex: ccrc's own enabled usage timers could not be listed (the wrapper shape contract could not be read), so a ccrc-codex-usage@<id>.timer left enabled for an id that is no longer a Codex lane cannot be seen — unmeasured, never none";
    const UNLISTABLE_FIX = '  remedy: ccrc install — the wrapper shape contract ships with ccrc, and the install places it again';
    ```

  - In the Linux describe `ccrc doctor: codex — the usage rows, measured in isolation (Plan 3a Task 6)`:
    - Re-aim the second-writer case, keeping its title. Old (unique):

      ```ts
          expect(warns(r.stdout)).toEqual([expect.stringMatching(/^WARN codex: codex-a: another repository's ccgpt-usage@codex-a\.timer is enabled, so two publishers would race this lane's ~\/\.cc-limits row and two token refreshes its OAuth directory — ccrc withholds its own ccrc-codex-usage@codex-a\.timer while it stands$/)]);
          expect(r.stdout).toMatch(/^ {2}remedy: once this lane's cutover no longer needs it, disable it yourself: systemctl --user disable --now ccgpt-usage@codex-a\.timer, then run: ccrc install — ccrc never disables another tool's unit$/m);
      ```

      New:

      ```ts
          // Plan 3b Task A2: this fixture is BOTH armed (`usageBox` enables ccrc's own
          // timer), so the WARN says so and names ccrc's withdrawal first. The title is
          // §20.10's row of record, kept verbatim; the withheld-only case is the next one.
          expect(warns(r.stdout)).toEqual([`WARN codex: codex-a: another repository's ccgpt-usage@codex-a.timer is enabled, and ccrc's own ${T} is enabled too, so two publishers race this lane's ~/.cc-limits row and two token refreshes its OAuth directory`]);
          expect(r.stdout).toMatch(new RegExp(`^ {2}remedy: systemctl --user disable --now ${esc(T)} \\(ccrc's own unit; no ccrc fixer withdraws it\\), or leave it to the next update, whose converge withdraws ${esc(T)} while ccgpt-usage@codex-a\\.timer stands and re-measures the link\\. Once this lane's cutover no longer needs ccgpt-usage@codex-a\\.timer, disable it yourself: systemctl --user disable --now ccgpt-usage@codex-a\\.timer — ccrc never disables another tool's unit$`, 'm'));
      ```

    - Directly after that case:

      ```ts
        it('ANOTHER repository\'s timer enabled and ccrc\'s own withheld, as the converge leaves it: the WARN says ccrc withholds its own — true only now (Plan 3b Task A2)', () => {
          const home = usageBox('ccrc-doctor-usage-second-writer-withheld-', { enabled: false });
          plantForeignUsage(home, 'codex-a');
          const r = usageRows(home);
          expect(warns(r.stdout)).toEqual([expect.stringMatching(/^WARN codex: codex-a: another repository's ccgpt-usage@codex-a\.timer is enabled, so two publishers would race this lane's ~\/\.cc-limits row and two token refreshes its OAuth directory — ccrc withholds its own ccrc-codex-usage@codex-a\.timer while it stands$/)]);
          expect(r.stdout).toMatch(/^ {2}remedy: once this lane's cutover no longer needs it, disable it yourself: systemctl --user disable --now ccgpt-usage@codex-a\.timer, then run: ccrc install — ccrc never disables another tool's unit$/m);
          expect(r.asked).toEqual([]);
        });
      ```

    - Directly before its `itCodex('wired into _check_codex …')` case:

      ```ts
        it('every enabled ccrc usage timer belongs to a Codex lane: no surplus, nothing recorded, the manager never asked (Plan 3b Task A2)', () => {
          const r = usageRows(usageBox('ccrc-doctor-usage-surplus-none-'), false, SURPLUS_ROWS);
          expect(r.code, r.stderr).toBe(0);
          expect(r.stdout).toMatch(/^rc=0$/m);
          expect(r.stdout).toMatch(/^surplus=$/m);
          expect(warns(r.stdout), r.stdout).toEqual([]);
          expect(r.asked).toEqual([]);
        });

        it('a ccrc usage timer enabled for an id that is no longer a Codex lane WARNs by name — read off the manager\'s links, never the roster — remedy the exact disable, with the next update's converge as its automatic cure (Plan 3b Task A2)', () => {
          const home = usageBox('ccrc-doctor-usage-surplus-');
          plantCodexUsage(home, 'ext-a', { row: false });
          const r = usageRows(home, false, SURPLUS_ROWS);
          expect(r.stdout).toMatch(/^rc=0$/m);
          expect(r.stdout).toMatch(/^surplus=ext-a$/m);
          expect(warns(r.stdout), r.stdout).toEqual([SURPLUS_WARN('ext-a')]);
          expect(remedyAfter(r.stdout, /^WARN codex: ccrc-codex-usage@ext-a\.timer is still enabled/)).toBe(SURPLUS_FIX('ext-a'));
          expect(r.asked, 'the surplus row asked the user manager').toEqual([]);
        });

        it('ccrc\'s enabled usage timers that cannot be listed are their own WARN, unmeasured — never "no surplus" (Plan 3b Task A2)', () => {
          const r = usageRows(usageBox('ccrc-doctor-usage-surplus-unlistable-'), false,
            `unset WRAPPER_ID_RE WRAPPER_SUFFIX_SAFE_RE; CCRC_HERE="$HOME/no-shape-contract-here"\n${SURPLUS_ROWS}`);
          expect(r.stdout).toMatch(/^rc=1$/m);
          expect(warns(r.stdout), r.stdout).toEqual([UNLISTABLE_WARN]);
          expect(remedyAfter(r.stdout, /^WARN codex: ccrc's own enabled usage timers could not be listed/)).toBe(UNLISTABLE_FIX);
        });
      ```

  - In the any-host describe `ccrc doctor: codex — the usage rows, on any host (Plan 3a Task 6)`:
    - In the loaded-guard `it.each`, `['_codex_usage_enabled', '_codex_usage_timer', …` becomes `['_codex_usage_enabled', '_codex_usage_enabled_ids', '_codex_usage_timer', …`.
    - After its forced-Darwin case:

      ```ts
        it('forced Darwin: the surplus row is not applicable — rc 3 and nothing recorded, even over a ccrc link for a non-codex id (Plan 3b Task A2)', () => {
          const home = usageBox('ccrc-doctor-usage-surplus-darwin-');
          plantCodexUsage(home, 'ext-a', { row: false });
          const r = usageRows(home, true, SURPLUS_ROWS);
          expect(r.stdout).toMatch(/^rc=3$/m);
          expect(r.stdout).toMatch(/^surplus=$/m);
          expect(warns(r.stdout), r.stdout).toEqual([]);
        });
      ```

  - In `ccrc doctor: codex, part 1 — …`:
    - Re-aim the case `WARNs lane state left for an id that is no longer a Codex lane — a flip back keeps it — and never deletes it`. After its `codexRoster(…, { accountsSh: false });` line, add:

      ```ts
          // Plan 3b Task A2: this is the state AFTER the converge a flip back runs, which
          // withdraws codex-b's usage timer, so its link goes as a manager's disable
          // removes it. The timer left enabled is the next case's subject.
          rmSync(join(home, '.config', 'systemd', 'user', 'timers.target.wants', 'ccrc-codex-usage@codex-b.timer'));
      ```

    - Directly after that case, three new ones:

      ```ts
        itLinux('a flip back whose usage timer is still enabled: the left-state WARN no longer says nothing of ccrc\'s reads it, and the timer is its own WARN (Plan 3b Task A2)', async () => {
          const home = await healthyCodexBox('ccrc-doctor-codex-flipback-timer-', ['codex-a', 'codex-b']);
          const keep = lanePorts(home, 'codex-a');
          codexRoster(home, [{ id: 'codex-a', ...keep }], [{
            id: 'codex-b', label: 'codex-b', configDirSuffix: '.claude-codex-b',
            exec: { kind: 'external' }, homeAble: false, telemetry: 'codex',
          }], { accountsSh: false });
          const r = runDoctor(home);
          expect(codexVerdicts(r.stdout), r.stdout).toEqual([
            expect.stringMatching(/^WARN codex: lane state is left under \S+\/\.ccrc\/codex\/codex-b, and 'codex-b' is not a Codex lane in \$HOME\/\.ccrc\/accounts\.json — a flip back to another launcher keeps it on purpose, and ccrc's own ccrc-codex-usage@codex-b\.timer still reads it \(the WARN naming that timer says how to withdraw it\)$/),
            SURPLUS_WARN('codex-b'),
          ]);
          expect(remedyAfter(r.stdout, /^WARN codex: ccrc-codex-usage@codex-b\.timer is still enabled/)).toBe(SURPLUS_FIX('codex-b'));
          noRunnerBugLine(r.stdout, 'codex');
        });

        itLinux('a ccrc usage timer left enabled with no Codex lane and no lane state at all is a WARN — never the empty-population SKIP (Plan 3b Task A2)', () => {
          const home = healthy('ccrc-doctor-codex-surplus-only-');
          plantCodexUsage(home, 'ext-a', { pair: false, row: false });   // a dangling link still reads enabled (D-3726)
          const r = runDoctor(home);
          expect(codexVerdicts(r.stdout), r.stdout).toEqual([SURPLUS_WARN('ext-a')]);
          noRunnerBugLine(r.stdout, 'codex');
        });

        itLinux('a box whose usage-timer set cannot be listed is a WARN, unmeasured — never the empty-population SKIP (Plan 3b Task A2)', () => {
          const home = healthy('ccrc-doctor-codex-surplus-unlistable-');
          rmSync(join(home, 'ccrc', 'ccd', 'ccrc-wrapper-shape'), { force: true });
          const r = runDoctor(home);
          expect(codexVerdicts(r.stdout), r.stdout).toEqual([UNLISTABLE_WARN]);
          noRunnerBugLine(r.stdout, 'codex');
        });
      ```

- [ ] **Step 2: run them red.** Each block is ONE foreground call, timeout at least 600000 ms:

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  cd server
  r11 a2-red-install ./node_modules/.bin/vitest run test/ccrc-install.test.ts -t 'the codex usage converge, measured in isolation'
  ```

  Expected: `Tests 2 failed | 18 passed`. The 18 is `be93d159`'s count, measured; re-derive it. The reasons:
  - **The withdraw-first case:** `degraded` is `[]`, and stdout reads `… withdrawn from ext-a`.
  - **The foreign-arm case:** stdout carries `this run disabled it.` and no `NOT CONVERGED`.

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  cd server
  r11 a2-red-doctor ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'Plan 3b Task A2|lane state left for an id that is no longer|ANOTHER repository|FAILs in its loaded guard'
  ```

  Expected: 9 failed. The reasons:
  - **The surplus-none, surplus-named, unlistable and forced-Darwin cases:** `_dr_codex_usage_surplus: command not found`, printing `rc=127`.
  - **The re-aimed second-writer case:** it reads the old "withholds" sentence.
  - **The `_codex_usage_enabled_ids` guard row:** the check got past a guard that lacks it.
  - **The flip-back-with-timer case:** it finds one verdict line, not two.
  - **The surplus-only and unlistable end-to-end cases:** `SKIP codex: …`.

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  cd server
  r11 a2-red-uninst ./node_modules/.bin/vitest run test/ccrc-uninstall.test.ts -t 'usage template'
  ```

  Expected (Linux; both cases are `itLinux`): `Tests 1 failed | 1 passed`. The keep-link case reads `2 codex usage timer(s) stopped and disabled` and no failed line.

  The withheld-only second-writer case and the re-aimed flip-back case are GREEN before the change, by design. Mutation rows A2-M12 and Plan 3a's M14 bind them.

- [ ] **Step 3: implement `ccd/ccrc`.**
  - Old (unique):

    ```bash
    # (`_inst_enable_timer`).
    # POSITION: inside `_inst_enable`, after the daemon-reload that read the
    ```

    New:

    ```bash
    # (`_inst_enable_timer`).
    # A WITHDRAWAL IS RE-MEASURED, never read off the exit code (Plan 3b Task A2,
    # ⟦D:usage-withdrawal-is-re-measured⟧): both disables below count only when a
    # re-read of the manager's link finds it gone, `_acct_remove_usage`'s
    # reading. A disable the manager answers 0 while the link stays is the
    # refused withdrawal's own could-not-disable line and NOT CONVERGED step,
    # because it is the same fact (ccrc's timer is still enabled) and the same
    # operator remedy.
    # POSITION: inside `_inst_enable`, after the daemon-reload that read the
    ```

  - Old (unique):

    ```bash
        u="$(_codex_usage_timer "$e")"
        if systemctl --user disable --now "$u"; then
          withdrawn+=("$e")
    ```

    New:

    ```bash
        u="$(_codex_usage_timer "$e")"
        if systemctl --user disable --now "$u" && ! _codex_usage_enabled "$u"; then
          withdrawn+=("$e")
    ```

  - Old (unique):

    ```bash
          if _codex_usage_enabled "$u"; then
            if systemctl --user disable --now "$u"; then
              withdrawn+=("$id")
    ```

    New:

    ```bash
          if _codex_usage_enabled "$u"; then
            if systemctl --user disable --now "$u" && ! _codex_usage_enabled "$u"; then
              withdrawn+=("$id")
    ```

  - `_uninst_codex_usage` (ruling R7). Old (unique):

    ```bash
        u="$(_codex_usage_timer "$id")"
        if systemctl --user disable --now "$u"; then
          n=$((n + 1))
    ```

    New:

    ```bash
        u="$(_codex_usage_timer "$id")"
        if systemctl --user disable --now "$u" && ! _codex_usage_enabled "$u"; then
          n=$((n + 1))
    ```

- [ ] **Step 4: implement `ccd/ccrc-doctor-checks`.**
  - **The second-writer branch, in `_dr_codex_usage`.** Old (unique):

    ```bash
      # (1) WHO publishes this lane's row.
      if _codex_usage_enabled "$f"; then
    ```

    New:

    ```bash
      # (1) WHO publishes this lane's row.
      # BOTH ARMED (Plan 3b Task A2, ⟦D:surplus-ccrc-usage-timer-warns⟧):
      # the converge withdraws ccrc's own while the foreign one stands, but a
      # withdrawal the manager refused, or answered while the link stayed,
      # leaves both, and "ccrc withholds its own" would be false over a link
      # that says otherwise.
      if _codex_usage_enabled "$f" && _codex_usage_enabled "$t"; then
        _dr_cx_warn "$id: another repository's $f is enabled, and ccrc's own $t is enabled too, so two publishers race this lane's ~/.cc-limits row and two token refreshes its OAuth directory" \
          "systemctl --user disable --now $t (ccrc's own unit; no ccrc fixer withdraws it), or leave it to the next update, whose converge withdraws $t while $f stands and re-measures the link. Once this lane's cutover no longer needs $f, disable it yourself: systemctl --user disable --now $f — ccrc never disables another tool's unit"
        rc=2
      elif _codex_usage_enabled "$f"; then
    ```

    The withheld-only branch below it, and every branch after that, keep their bytes.
  - **The two new functions.** Old (unique):

    ```bash
      DR_CODEX_USAGE_NOTE="$(_dr_join ${note[@]+"${note[@]}"})"
      return "$rc"
    }

    # ── codex: the ccrc-owned Codex lanes on this box, measured end to end ────
    ```

    New:

    ```bash
      DR_CODEX_USAGE_NOTE="$(_dr_join ${note[@]+"${note[@]}"})"
      return "$rc"
    }

    # ── the usage timer ccrc left enabled for an id that is no longer a Codex lane ──
    # Plan 3b Task A2 (⟦D:surplus-ccrc-usage-timer-warns⟧). The rows above
    # walk TODAY's codex lanes, so a flip back whose withdrawal never happened left
    # `ccrc-codex-usage@<id>.timer` polling with no row to name it. Two causes: no
    # `ccrc install` since the roster edit, or a disable the manager answered while
    # its link stayed. That timer rewrites ~/.cc-limits/<id>.json and runs a token
    # refresh against the authDir in the lane.json a flip back keeps.
    # THE SET is ccrc's own reading of the manager's links (`_codex_usage_enabled_ids`,
    # D-3726), which reads no roster, minus the codex lanes `_check_codex` read.
    # MEASURED BEFORE the empty-population SKIP (`_check_codex`): such an id is a
    # subject on its own. A set that cannot be listed (`_codex_usage_enabled_ids`
    # rc 1: the shape contract is missing, which the `wrappers` check FAILs) is
    # UNMEASURED, never empty, and is its own WARN. NOT APPLICABLE ON macOS
    # (decision 17): ccrc places no launchd job, so there is nothing to find (rc 3).
    # No systemctl call, and no file under the timer is read.
    _dr_codex_usage_surplus() {   # <codex lane id>… -> rc 0 measured, 1 unlistable, 3 macOS; sets DR_CODEX_USAGE_SURPLUS
      local have e
      DR_CODEX_USAGE_SURPLUS=()
      [ "${CCD_OS:-linux}" = darwin ] && return 3
      have="$(_codex_usage_enabled_ids 2>/dev/null)" || return 1
      for e in $have; do
        _dr_cx_member "$e" "$@" || DR_CODEX_USAGE_SURPLUS+=("$e")
      done
      return 0
    }

    _dr_codex_usage_surplus_rows() {   # <_dr_codex_usage_surplus's rc> -> WARN findings, recorded through _dr_cx_warn
      local id t
      if [ "$1" -eq 1 ]; then
        _dr_cx_warn "ccrc's own enabled usage timers could not be listed (the wrapper shape contract could not be read), so a ccrc-codex-usage@<id>.timer left enabled for an id that is no longer a Codex lane cannot be seen — unmeasured, never none" \
          "ccrc install — the wrapper shape contract ships with ccrc, and the install places it again"
        return 0
      fi
      for id in ${DR_CODEX_USAGE_SURPLUS[@]+"${DR_CODEX_USAGE_SURPLUS[@]}"}; do
        t="$(_codex_usage_timer "$id")"
        _dr_cx_warn "$t is still enabled, and '$id' is not a Codex lane in \$HOME/.ccrc/accounts.json, so ccrc's usage publisher still runs for '$id' every cycle: the writer of \$HOME/.cc-limits/$id.json, and of a token refresh in the authDir its lane.json names, for a lane ccrc no longer runs" \
          "systemctl --user disable --now $t (ccrc's own unit; no ccrc fixer withdraws it), or leave it to the next update, whose converge withdraws a ccrc usage timer whose id is no longer a Codex lane and re-measures the link"
      done
      return 0
    }

    # ── codex: the ccrc-owned Codex lanes on this box, measured end to end ────
    ```

  - **`_check_codex`'s loaded guard.** Old (unique):

    ```bash
                _codex_usage_enabled _codex_usage_timer _codex_usage_foreign _codex_usage_wants _codex_usage_flat_foreign \
    ```

    New:

    ```bash
                _codex_usage_enabled _codex_usage_enabled_ids _codex_usage_timer _codex_usage_foreign _codex_usage_wants _codex_usage_flat_foreign \
    ```

  - **`_check_codex`'s SKIP.** Task A5 edits the `for d in "$root"/*/; do` loop just above, so only the lines from its `done` on are touched here. Old (unique):

    ```bash
        _dr_cx_member "$n" ${lanes[@]+"${lanes[@]}"} || left+=("$n")
      done
      if [ "${#lanes[@]}" -eq 0 ] && [ "${#left[@]}" -eq 0 ]; then
    ```

    New:

    ```bash
        _dr_cx_member "$n" ${lanes[@]+"${lanes[@]}"} || left+=("$n")
      done
      # Plan 3b Task A2: ccrc's own usage timers left enabled for an id that is not
      # a codex lane now, measured BEFORE the empty-population SKIP. Such a timer is
      # a subject on its own, and so is a set that cannot be listed
      # (`_dr_codex_usage_surplus`, above).
      local -a DR_CODEX_USAGE_SURPLUS=()
      local surplus_rc=0
      _dr_codex_usage_surplus ${lanes[@]+"${lanes[@]}"} || surplus_rc=$?
      if [ "${#lanes[@]}" -eq 0 ] && [ "${#left[@]}" -eq 0 ] && [ "${#DR_CODEX_USAGE_SURPLUS[@]}" -eq 0 ] && [ "$surplus_rc" -ne 1 ]; then
    ```

  - **The left-lane-state loop, and the record call.** Old (unique):

    ```bash
      for n in ${left[@]+"${left[@]}"}; do
        _dr_cx_warn "lane state is left under $root/$n, and '$n' is not a Codex lane in \$HOME/.ccrc/accounts.json — a flip back to another launcher keeps it on purpose, and nothing of ccrc's reads it while '$n' is not a Codex lane" \
    ```

    New:

    ```bash
      local left_reads
      for n in ${left[@]+"${left[@]}"}; do
        # Plan 3b Task A2: the publisher reads this lane.json, so "nothing of ccrc's
        # reads it" is said only when no ccrc usage timer is enabled for '$n'.
        left_reads="nothing of ccrc's reads it while '$n' is not a Codex lane"
        _dr_cx_member "$n" ${DR_CODEX_USAGE_SURPLUS[@]+"${DR_CODEX_USAGE_SURPLUS[@]}"} \
          && left_reads="ccrc's own $(_codex_usage_timer "$n") still reads it (the WARN naming that timer says how to withdraw it)"
        _dr_cx_warn "lane state is left under $root/$n, and '$n' is not a Codex lane in \$HOME/.ccrc/accounts.json — a flip back to another launcher keeps it on purpose, and $left_reads" \
    ```

    The remedy line and the loop's `done` keep their bytes. Then, old (unique):

    ```bash
      _dr_cx_report "${#lanes[@]} Codex lane(s): $(_dr_cx_join ', ' ${DRX_OK[@]+"${DRX_OK[@]}"}); runtime ${DRX_RUNTIME:-unmeasured}; the four GPT-lane executables match the shipped tree${DR_CODEX_USAGE_BOX_NOTE:+; $DR_CODEX_USAGE_BOX_NOTE}"
    ```

    New:

    ```bash
      _dr_codex_usage_surplus_rows "$surplus_rc"
      _dr_cx_report "${#lanes[@]} Codex lane(s): $(_dr_cx_join ', ' ${DRX_OK[@]+"${DRX_OK[@]}"}); runtime ${DRX_RUNTIME:-unmeasured}; the four GPT-lane executables match the shipped tree${DR_CODEX_USAGE_BOX_NOTE:+; $DR_CODEX_USAGE_BOX_NOTE}"
    ```

- [ ] **Step 5: run green, then the neighbours.** Each block is ONE foreground call, timeout at least 600000 ms.
  - The three red-first commands again, labelled `a2-green-install`, `a2-green-doctor` and `a2-green-uninst`. Expected: `20 passed`, every selected doctor case passed, and `2 passed`.
  - The rehearsal, whose flip back must still converge and still show the left-state WARN with its original clause (its converge's stand-in removes the link):

    ```bash
    . "<abs scratch>/plan3b-exec/plan3b-env.sh"
    cd server
    r11 a2-neigh-rehearsal ./node_modules/.bin/vitest run test/ccrc-install.test.ts -t 'Plan 3a Task 10 — the cutover rehearsal'
    ```

  - The doctor file, as its three complementary parts (Global Constraints), one call each, labelled `a2-neigh-doctor-1`, `-2` and `-3`:

    ```bash
    . "<abs scratch>/plan3b-exec/plan3b-env.sh"
    cd server
    r11 a2-neigh-doctor-<k> ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t '<P>'
    ```

    Every part is green. `HEALTHY_SKIPS` is unchanged, because a `healthy()` box plants no ccrc usage link, so `codex` still SKIPs there.
  - The neighbours that share these readers:

    ```bash
    . "<abs scratch>/plan3b-exec/plan3b-env.sh"
    cd server
    r11 a2-neigh-acct ./node_modules/.bin/vitest run test/ccrc-account.test.ts -t 'C1[2-5]'
    ```

    ```bash
    . "<abs scratch>/plan3b-exec/plan3b-env.sh"
    cd server
    r11 a2-neigh-uninst ./node_modules/.bin/vitest run test/ccrc-uninstall.test.ts -t 'usage template'
    ```

    ```bash
    . "<abs scratch>/plan3b-exec/plan3b-env.sh"
    cd server
    r11 a2-neigh-census ./node_modules/.bin/vitest run test/install-census.test.ts
    ```

    ```bash
    . "<abs scratch>/plan3b-exec/plan3b-env.sh"
    cd server
    r11 a2-neigh-hook ./node_modules/.bin/vitest run test/session-hook.test.ts
    ```

    ```bash
    . "<abs scratch>/plan3b-exec/plan3b-env.sh"
    cd server
    r11 a2-neigh-tc ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
    ```

    All green, counts unchanged, except `a2-neigh-uninst`, which counts the new keep-link case (`2 passed`). `session-hook` is expected green, because every `ccd/ccrc` insert here sits below `:11635`. If it reds, repair it by Task A1 Step 4's S6-R11 procedure in this commit, with the dumps under `$SCRATCH/a2-s6/`.

- [ ] **Step 6: the mutation table. MEASURE every row both ways.**
  - Stage, then back up:

    ```bash
    . "<abs scratch>/plan3b-exec/plan3b-env.sh"
    git add ccd/ccrc ccd/ccrc-doctor-checks server/test/ccrc-install.test.ts server/test/ccrc-doctor.test.ts server/test/ccrc-uninstall.test.ts
    mkdir -p "$SCRATCH/a2-mut"
    cp ccd/ccrc "$SCRATCH/a2-mut/ccrc"; cp ccd/ccrc-doctor-checks "$SCRATCH/a2-mut/ccrc-doctor-checks"
    ```

  - Rows A2-M1 and A2-M2 run the install command, A2-M15 runs `a2-red-uninst`'s command (labelled `a2-mut-A2-M15`), and every other row runs the doctor command:

    ```bash
    . "<abs scratch>/plan3b-exec/plan3b-env.sh"
    cd server
    r11 a2-mut-<row> ./node_modules/.bin/vitest run test/ccrc-install.test.ts -t 'the codex usage converge, measured in isolation'   # A2-M1, A2-M2
    ```

    ```bash
    . "<abs scratch>/plan3b-exec/plan3b-env.sh"
    cd server
    r11 a2-mut-<row> ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'Plan 3b Task A2|lane state left for an id that is no longer|ANOTHER repository|FAILs in its loaded guard'   # every other row
    ```

  - Restore both files, verify the restore, and re-run the row's command as `a2-mut-<row>-green`:

    ```bash
    . "<abs scratch>/plan3b-exec/plan3b-env.sh"
    cp "$SCRATCH/a2-mut/ccrc" ccd/ccrc; cp "$SCRATCH/a2-mut/ccrc-doctor-checks" ccd/ccrc-doctor-checks
    git diff --quiet -- ccd/ccrc ccd/ccrc-doctor-checks && echo restored
    ```

  - The red counts below are derived from the cases; record the measured ones. If a row does not red, report that; never add code to force a bind.

  | # | Guard | Mutation | Goes red |
  |---|---|---|---|
  | A2-M1 | the withdraw-first disable is re-measured | `ccd/ccrc`, the first `if systemctl --user disable --now "$u" && ! _codex_usage_enabled "$u"; then` (the `withdrawn+=("$e")` one): drop ` && ! _codex_usage_enabled "$u"` | 1: `a withdrawal the manager answers 0 while its link stays is NOT withdrawn…` |
  | A2-M2 | the foreign-arm disable is re-measured | the same clause at the `withdrawn+=("$id")` disable | 1: `on the foreign arm too: …` |
  | A2-M3 | a surplus id blocks the SKIP | `ccd/ccrc-doctor-checks`, in the SKIP condition, drop `&& [ "${#DR_CODEX_USAGE_SURPLUS[@]}" -eq 0 ] ` | 1: `a ccrc usage timer left enabled with no Codex lane and no lane state at all…` |
  | A2-M4 | an unlistable set blocks the SKIP | in the SKIP condition, drop ` && [ "$surplus_rc" -ne 1 ]` | 1: `a box whose usage-timer set cannot be listed…` |
  | A2-M5 | the surplus is the enabled set minus the codex lanes | in `_dr_codex_usage_surplus`, `_dr_cx_member "$e" "$@" \|\| DR_CODEX_USAGE_SURPLUS+=("$e")` → `:` | 3: the surplus-named rows case, the flip-back-with-timer case, and the surplus-only case |
  | A2-M6 | … and never the codex lanes themselves | the same line → `DR_CODEX_USAGE_SURPLUS+=("$e")` | 2 or more: `every enabled ccrc usage timer belongs to a Codex lane…`, and the flip-back-with-timer case (codex-a becomes a surplus too) |
  | A2-M7 | unlistable is never empty | `\|\| return 1` → `\|\| return 0` | 2: the unlistable rows case and the unlistable end-to-end case |
  | A2-M8 | not applicable on macOS | delete `[ "${CCD_OS:-linux}" = darwin ] && return 3` | 1: `forced Darwin: the surplus row is not applicable…` |
  | A2-M9 | the surplus is recorded | in `_check_codex`, delete `_dr_codex_usage_surplus_rows "$surplus_rc"` | 3: the flip-back-with-timer, surplus-only and unlistable end-to-end cases (each finds a PASS) |
  | A2-M10 | the left-state WARN states what the links say | delete the `&& left_reads=…` continuation line (and the trailing ` \` above it) | 1: the flip-back-with-timer case |
  | A2-M11 | both armed is said as both armed | `if _codex_usage_enabled "$f" && _codex_usage_enabled "$t"; then` → `if false; then` | 1: the re-aimed second-writer case (R6) |
  | A2-M12 | … and only when ccrc's own is enabled | the same condition → `if _codex_usage_enabled "$f"; then` | 1: the withheld-only second-writer case |
  | A2-M13 | the reader is in the loaded guard | drop `_codex_usage_enabled_ids ` from the guard's list | 1: the `it.each` row `_codex_usage_enabled_ids not loaded: …` |
  | A2-M14 | the unlistable WARN is recorded, never skipped | in `_dr_codex_usage_surplus_rows`, `if [ "$1" -eq 1 ]; then` → `if false; then` | 2: the unlistable rows case and the unlistable end-to-end case (a PASS with nothing recorded) |
| A2-M15 | uninstall counts a stop only when re-measured | `ccd/ccrc`, in `_uninst_codex_usage`, drop ` && ! _codex_usage_enabled "$u"` | 1: the Plan 3b uninstall keep-link case |

  Plan 3a's doctor row M14 (`_dr_cx_member "$n" … || left+=("$n")` → `:`) must still red the re-aimed flip-back case. Record it as `a2-mut-3aM14`.

- [ ] **Step 7: scope and residue check,** against this task's own base:

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  BASE="$(cat "$SCRATCH/a2-base")"
  git diff --name-only "$BASE"
  # → ccd/ccrc, ccd/ccrc-doctor-checks, server/test/ccrc-doctor.test.ts, server/test/ccrc-install.test.ts, server/test/ccrc-uninstall.test.ts
  #   (plus Task A1's files if A1 committed on this base; the A2 diff itself names only these five)
  git diff "$BASE" -- ccd/ccrc | grep '^[-+]' | grep -v '^[-+][-+]' | grep -vc '^+#\|withdrawn+=\|disable --now "\$u"'
  # → 0: the ccrc hunk is the comment paragraph and the three disable lines only
  git diff --quiet "$BASE" -- ccd/ccd deploy shared docs server/test/codexLaneFixture.ts && echo untouched
  # → untouched
  ids="$(jq -r '.accounts[] | select(.telemetry == "codex") | .id' "$HOME/.ccrc/accounts.json")"
  printf '%s\n' "$ids" | while IFS= read -r id; do
    git diff "$BASE" | grep '^+' | sed 's/$/ /' | grep -cE "[^[:alnum:]_-]${id}[^[:alnum:]_-]"
  done
  # → 0 for each: no added line names a live lane id. Only counts print.
  ```

- [ ] **Step 8: commit.**

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  git add ccd/ccrc ccd/ccrc-doctor-checks server/test/ccrc-install.test.ts server/test/ccrc-doctor.test.ts server/test/ccrc-uninstall.test.ts
  git commit -F - <<'EOF'
  fix(codex-usage): a withdrawal is re-measured, and doctor names a ccrc usage timer no lane owns

  _inst_codex_usage counted a usage-timer withdrawal on systemctl's exit
  code alone. Now, like account removal, it counts one only when a re-read
  of the timers.target.wants link finds it gone, and a disable answered 0
  with the link still there is the refused withdrawal's NOT CONVERGED step.
  Uninstall counts a usage timer stopped on the same re-read.
  Doctor's codex check WARNs, per id, on any enabled
  ccrc-codex-usage@<id>.timer whose id is not a codex lane now (remedy
  ccrc's own systemctl disable; the next update's converge cures it too), measured before the
  empty-population SKIP. A set that cannot be listed is its own WARN.
  The left-lane-state WARN no longer says nothing of ccrc's reads that
  lane.json while such a timer runs, and the second-writer WARN says both
  publishers are armed when they are. Not applicable on macOS. Inert on a
  box with no ccrc usage instance.

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git log -1 --format='%an <%ae> | %cn <%ce>'
  ```

  Expected: the worktree's noreply identity only. Any other identity stops the task.

### Task A3: account removal waits for an in-flight ccrc usage refresh, never stops it

> Rulings applied:
> - **A-3.** `_acct_remove_usage` waits for `ccrc-codex-usage@<id>.service` to go inactive before the limits row is removed, and never stops it. The wait is bounded by `CCRC_ACCT_USAGE_WAIT_S` (default 300, the unit's `TimeoutStartSec`) and prints a waiting line. At the bound the removal refuses `usage-refresh-in-flight`, with a retry sentence, before any limits-row deletion. The retry is pinned.
> - **The retry premise, measured, and the one change it forces.** On `be93d159` `cmd_account remove` calls `_acct_remove_usage` after the roster drop (`grep -n '^  _acct_remove_usage "$id"; ' ccd/ccrc`, below `_acct_write_op "$stands" drop …`). A refusal there could never be retried: the retry's own `_acct_lane` runs `deploy/account-op.mjs`'s `lane` op, which refuses `unknown-id` for an id the roster no longer names. So this task moves the call to just before the drop. Every step before that point repeats as a no-op on a second run, which makes the ruling's "a retry is safe" true. That move is its own departure, `⟦D:usage-quiesce-before-the-roster-drop⟧`.
> - **A-7, handed on.** This task edits no spec line. It states the §21.3 wording and the `:1042` pointer below, and Task A7 applies them.
> - **S1.** Inert on the live shape: the box has ccrc's template pair placed and no instance, so a removal asks the user manager one read-only `is-active`, reads `inactive`, and goes on as before. No step of this plan runs `ccrc account remove` on the live box.
> - **F2 / F4.** Census-wrapped commands, red first, a mutation row per guard. Slugs: `⟦D:account-removal-waits-for-usage-refresh⟧` and `⟦D:usage-quiesce-before-the-roster-drop⟧`.

**Files:**
- Modify: `ccd/ccrc`:
  - in `_acct_remove`, ONE line moves. Plan 3a's caller line `_acct_remove_usage "$id"; [ -z "$ACCT_USAGE_REMOVED" ] || …` is deleted from above the limits-row loop, and one replacement line goes directly above `_acct_write_op "$stands" drop --file …`. The function's line count is unchanged, so nothing below the old line moves, and no line the compaction-card corpus cites moves (every cited `ccd/ccrc` line is above `_acct_remove` or below the old line);
  - a new `_acct_usage_wait_secs`, and a rewritten `_acct_remove_usage` with its header comment, both at `_acct_remove_usage`'s current place (`grep -n '^_acct_remove_usage() {' ccd/ccrc`, `:22443` at `be93d159`), below every cited line. The file is not stamped.
- Test: `server/test/ccrc-account.test.ts`:
  - `buildEnv`'s deleted-knob list gains `'CCRC_ACCT_USAGE_WAIT_S'`;
  - `plantUsageCtl` gains an `svc` option and a branch that answers every argv naming `ccrc-codex-usage@<id>.service`, with its docstring; a new `usageSvcCalls` beside `usageCtlCalls`; a file-level `USAGE_EXT_A` row;
  - in `describe('ccrc account remove')`, after C15: two helpers (`seedUsageWait`, `runWith`) and six new cases.
- **Unchanged, measured:** the platform layer (`_svc_is_active` is composed as it stands, so `ccd/ccd` and `macos-platform.test.ts`'s region are untouched); `_codex_usage_timer`, `_codex_usage_enabled`, `_codex_usage_wants`, `_codex_bus_defaults`; the limits-row loop; `_uninst_codex_usage`; `server/test/codexLaneFixture.ts` (`plantCodexUsage`'s `pair`/`enabled`/`row` options suffice). C4 and C12–C15 keep their titles and assertions.

**Interfaces:**
- Consumes: `_codex_usage_timer <id>`, `_codex_usage_enabled <unit>`, `_codex_usage_wants`, `_codex_bus_defaults`, `_svc_is_active <unit>` (one word on stdout, empty when the manager did not answer; on Linux the manager's own word, so a running oneshot reads `activating`), `$BOX_UNIT_DIR`, `$CCD_OS`, `$PROG`, `_acct_refuse <class> <code> <detail>`. Test helpers: `box`, `run`, `env`, `sourceRun`, `oneObject`, `seedRosterJson`, `seedFull`, `plantRow`, `plantLauncher`, `plantTmux`, `plantCodexUsage`, `plantUsageCtl`, `usageCtlCalls`, `lexists`, `itSystemd`, `UPSTREAM`, `HOMEABLE`, `MANAGER_STANDIN_MARK`.
- Produces:
  - `_acct_usage_wait_secs`: prints the bound in whole seconds, no newline, rc 0. `CCRC_ACCT_USAGE_WAIT_S`, default 300. It falls back to 300 by `_codex_ready_secs`' own parse: empty, not all digits, five characters or longer, or zero in any spelling. A value that passes is read in base 10 (`010` is 10).
  - `_acct_remove_usage <id> <what-still-stands>`. It disables ccrc's timer exactly as before (same lines, same `ACCT_USAGE_REMOVED` / `ACCT_USAGE_STEP`). Then, on Linux with ccrc's template `ccrc-codex-usage@.service` placed in `$BOX_UNIT_DIR`, it reads `_svc_is_active ccrc-codex-usage@<id>.service` once a second:
    - `inactive` or `failed`: done;
    - `activating`, `active`, `deactivating`, `reloading` or `refreshing`: in flight. The first such read prints the waiting line, and the loop reads again;
    - any other answer, the empty one included: unmeasured. It sets `ACCT_USAGE_WAIT_STEP` and returns;
    - at the bound, still in flight: it refuses, exit 1, `usage-refresh-in-flight`.

    It never asks for a stop. macOS and a box without the template ask the manager nothing.
  - **The waiting line, verbatim** (stderr): `ccrc account remove: ccrc's usage poll ccrc-codex-usage@<id>.service is running (<state>); waiting up to <n>s for it to finish before $HOME/.cc-limits/<id>.json is removed. ccrc never stops it: it may be writing the lane's OAuth token file.`
  - **The refusal, verbatim** (the envelope's `detail`): `ccrc's usage poll ccrc-codex-usage@<id>.service for <id> still reads <state> after <n>s (CCRC_ACCT_USAGE_WAIT_S), so this removal stopped before the roster drop and before $HOME/.cc-limits/<id>.json: ccrc never stops a poll, because it may be writing the lane's OAuth token file, and a row removed under a running poll is written again. <timer sentence> <what-still-stands> Retry 'ccrc account remove --id <id>' once 'systemctl --user is-active ccrc-codex-usage@<id>.service' reads inactive: every step this run took is safe to repeat.` The timer sentence is measured at the bound. It is `ccrc's usage timer ccrc-codex-usage@<id>.timer is not enabled, so no new poll starts.` or `… is still enabled, so new polls go on starting: run systemctl --user disable --now ccrc-codex-usage@<id>.timer first.`
  - **The unmeasured operator step, verbatim:** `ccrc's usage poll ccrc-codex-usage@<id>.service may still be running for the removed account <id>: the user manager did not say (systemctl --user is-active answered "<state>"), so this removal did not wait for it, and a poll that was running may write $HOME/.cc-limits/<id>.json again after this removal. Run: systemctl --user is-active ccrc-codex-usage@<id>.service — once it reads inactive, remove $HOME/.cc-limits/<id>.json by hand if it is there.`
  - `cmd_account remove` runs `_acct_remove_usage` after the home sweep and before the roster drop, and passes it the drop's own what-still-stands clause. When the timer link was removed, that clause gains `ccrc's usage timer for <id> was disabled; 'ccrc install' enables it again for a lane that is still codex.`
  - **Handed to Task A7:**
    - **The pointer** on spec `:1042` (`grep -n 'and the removal still completes' docs/superpowers/specs/2026-09-20-gpt-lane-ownership-design.md`) is the one A7's table already lists, with this task's second slug added: ` (amended: §21.3, ⟦D:account-removal-waits-for-usage-refresh⟧, ⟦D:usage-quiesce-before-the-roster-drop⟧)`, directly after `and the removal still completes`, before its full stop. It is a same-line edit.
    - **§21.3, as it should read at the tip.** Keep A7's first three bullets, and add `⟦D:usage-quiesce-before-the-roster-drop⟧` to the third. Replace its last bullet, "A removal with no running refresh is unchanged", with these three:
      - `ccrc account remove` runs this half after the home sweep and before the roster drop, where Plan 3a ran it after the drop. A refusal after the drop could not be retried, because a second run refuses `unknown-id` for an id the roster no longer names (⟦D:usage-quiesce-before-the-roster-drop⟧). The wait therefore holds the placement lock the removal already holds, for at most the bound.
      - It asks the manager only on Linux, with ccrc's template `ccrc-codex-usage@.service` placed, whether or not the timer is still enabled. A retry finds the timer already disabled. A box without the template, and macOS, ask nothing.
      - A manager that does not say whether the poll runs is unmeasured, never done. The removal completes, with an operator step naming the row to remove by hand once the poll reads inactive. A removal that finds no poll running completes as before.
    - **§21.12's `‹A3›` cell** is this task's six `it(` titles, in `ccrc-account.test.ts`.

**Why:**
- **The race.** `_acct_remove_usage` names only the timer. `systemctl --user disable --now ccrc-codex-usage@<id>.timer` stops the timer, not the `ccrc-codex-usage@<id>.service` it already fired. That unit is `Type=oneshot` with `TimeoutStartSec=300` (`deploy/systemd/ccrc-codex-usage@.service`), so a fired poll runs to its end whatever the timer does. `cmd_account remove` then `rm -f`s `~/.cc-limits/<id>.json` in the same function, with nothing in between asking about the service. A poll still running rewrites the row the removal just deleted. The server tolerates that ghost row (`server/src/limits.ts`' `inRoster`), but the removal's own report is false. On a codex lane the poll also reads the lane's `lane.json`, which the file reap after the drop deletes.
- **Wait, never stop.** The poll runs the Authenticator, which can be mid-way through writing the lane's `auth.json` (a token refresh, or the account-id write-back that §20.1 records). `systemctl stop` sends SIGTERM partway through that write. `exec.authDir` is deliberately kept by removal, so a truncated token file would outlive the account and break the next login on it. So the removal waits, and its refusal tells the operator to retry, never to stop.
- **The words.** A oneshot reads `activating` for its whole run, never `active`, so a wait that tested only `active` would never wait at all (mutation A3-M2). `inactive` and `failed` are done. `failed` is a poll that ended badly, and it writes nothing more. Anything else, above all the empty answer of a manager that did not reply, is unmeasured (`_svc_is_active`'s own three-answer doctrine). It gets its own outcome: an operator step, neither silence nor a refusal. A refusal there would make every removal impossible on a box whose user bus is down (C13's poison manager is exactly that box, and C13 must still complete).
- **Before the drop.** At the bound the removal refuses. The ruling says a retry is safe, and it is safe only before the drop. After the drop, `_acct_lane`'s `lane` op refuses `unknown-id` (`grep -n "refuse('unknown-id'" deploy/account-op.mjs`), so the operator would be told to retry a command that can only refuse. Before the drop, every earlier step repeats as a no-op on a second run:
  - rehoming finds no registry field naming the id;
  - the home sweep finds nothing to sweep (`clearSettingsEnv` answers `changed: false`, and the skills are gone);
  - a stopped codex tier is still stopped;
  - the timer, already disabled, is skipped.

  The case "the refusal is retryable" pins the first, second and fourth on a generated lane carrying a registry row, ccrc skills and a settings `env` block. The third is the codex arm's own re-measure: a second run's `_codex_tier_ours` answers 1, not running, and the arm moves on. The disable comes before the wait because a timer still enabled could fire a new poll between "inactive" and the row's `rm`. A refusal leaves the timer disabled, and `ccrc install`'s converge enables it again for a lane that is still codex.
- **The lock.** By the drop the removal holds the placement lock (`_acct_marker_lock`, held to exit), so ccd placements wait while the poll is waited for. That wait is bounded by `CCRC_ACCT_USAGE_WAIT_S`, and in practice it is one poll: a token refresh plus one request the publisher bounds at 30 s (the unit's own comment). Releasing the lock early would reopen the census race the lock exists for.
- **Only where a poll can run.** The manager is asked only on Linux, with ccrc's template placed, never on the timer's link alone, because a retry finds the link already gone. No template means no instance can run, so C4's external removal still asks no manager. macOS places no usage unit (decision 17), the same reason `_dr_codex_usage_box` gives for its early return.
- **One line moved, not grown.** The caller stays a single line, as Plan 3a's was, so `_acct_remove` keeps its length. The argument lives in `_acct_remove_usage`'s header, below every cited line.

- [ ] **Step 0: record the base, run the base suite, and re-run the locators (read-only).**

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  git rev-parse HEAD > "$SCRATCH/a3-base"; cat "$SCRATCH/a3-base"
  grep -n '^_acct_remove_usage() {' ccd/ccrc
  # → one line
  a="$(grep -n 'drop --file "$(_acct_roster_path)" --id "$id" --stands "$stands"' ccd/ccrc | cut -d: -f1)"
  b="$(grep -n '^  _acct_remove_usage "$id"; ' ccd/ccrc | cut -d: -f1)"
  echo "drop=$a usage=$b"; [ "$b" -gt "$a" ] && echo "the usage half runs AFTER the drop"
  # → two line numbers, then: the usage half runs AFTER the drop
  grep -n "refuse('unknown-id'" deploy/account-op.mjs
  # → the lane op's refusal for an id the roster does not name (one of the lines is inside `if (op === 'lane')`)
  grep -c 'CCRC_ACCT_USAGE_WAIT_S\|usage-refresh-in-flight\|ACCT_USAGE_WAIT_STEP' ccd/ccrc
  # → 0
  grep -n '^Type=oneshot$\|^TimeoutStartSec=300$' deploy/systemd/ccrc-codex-usage@.service
  # → both lines
  grep -n '^_codex_usage_timer() {' ccd/ccrc > "$SCRATCH/a3-anchor"; cat "$SCRATCH/a3-anchor"
  # → one line, between the caller and _acct_remove_usage: Step 4 proves it does not move
  ```

  Then the base suite, once, recorded:

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  cd server
  r11 a3-base-account ./node_modules/.bin/vitest run test/ccrc-account.test.ts
  ```

  Expected: green, `census: clean … command exit 0`. Record its `Tests <P> passed | <K> skipped (<T>)` line (331 tests at `be93d159` on Linux; A1 and A2 add none to this file). Step 3 expects `<P + 6>` passed and the same `<K>` skipped.

- [ ] **Step 1: write the failing tests** in `server/test/ccrc-account.test.ts`.
  - `buildEnv`. Old (unique):

    ```ts
        'CCRC_CODEX_PROBE_S', 'CCRC_CODEX_READY_S']) delete e[k];
    ```

    New:

    ```ts
        'CCRC_CODEX_PROBE_S', 'CCRC_CODEX_READY_S',
        // Plan 3b Task A3: account removal's wait for a running usage poll.
        'CCRC_ACCT_USAGE_WAIT_S']) delete e[k];
    ```

  - `plantUsageCtl`. Replace its docstring and its head. Old (unique):

    ```ts
     *  this file's own stand-in at `~/.local/bin/systemctl`, whose poison still
     *  answers the lane library. `keepLink` makes it a manager that answers 0 and
     *  leaves the link where it was (C15). */
    function plantUsageCtl(home: string, o: { keepLink?: boolean } = {}): string {
      const dir = join(home, 'usage-ctl');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'systemctl'), [
        '#!/bin/sh',
        MANAGER_STANDIN_MARK,
        'case " $* " in *" ccgpt-usage"*) printf \'%s\\n\' "$*" >> "$HOME/usage-ctl-foreign" ;; esac',
    ```

    New:

    ```ts
     *  this file's own stand-in at `~/.local/bin/systemctl`, whose poison still
     *  answers the lane library. `keepLink` makes it a manager that answers 0 and
     *  leaves the link where it was (C15).
     *
     *  Plan 3b Task A3 (⟦D:account-removal-waits-for-usage-refresh⟧): EVERY argv
     *  naming ccrc's usage SERVICE, `ccrc-codex-usage@<id>.service`, is answered
     *  here and never passed on. It is recorded to `usage-svc-calls` with what
     *  stood at that moment: the lane's limits row (`row=present|absent`) and its
     *  roster entry (`roster=named|dropped`). `is-active` answers from `svc`, one
     *  word per call, the LAST word sticking (default `inactive`, the word a
     *  oneshot that is not running reads). The word `-` is a manager that did not
     *  answer: nothing on stdout, exit 1. After 30 `is-active` calls it answers
     *  `inactive` whatever `svc` says, so a wait that a mutation leaves unbounded
     *  still ends (Global Constraints: every wait case self-expires). Any other
     *  verb on the service (a stop) exits 0 having only been recorded; the cases
     *  assert there is none. */
    function plantUsageCtl(home: string, o: { keepLink?: boolean; svc?: string[] } = {}): string {
      const dir = join(home, 'usage-ctl');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(home, 'usage-svc-states'), (o.svc ?? []).map((w) => `${w}\n`).join(''));
      rmSync(join(home, 'usage-svc-n'), { force: true });
      writeFileSync(join(dir, 'systemctl'), [
        '#!/bin/sh',
        MANAGER_STANDIN_MARK,
        'case " $* " in *" ccgpt-usage"*) printf \'%s\\n\' "$*" >> "$HOME/usage-ctl-foreign" ;; esac',
        'u=\'\'',
        'for a in "$@"; do case "$a" in ccrc-codex-usage@*.service) u="$a" ;; esac; done',
        'if [ -n "$u" ]; then',
        '  id="${u#ccrc-codex-usage@}"; id="${id%.service}"',
        '  row=absent; [ -e "$HOME/.cc-limits/$id.json" ] && row=present',
        '  roster=dropped; grep -q "\\"$id\\"" "$HOME/.ccrc/accounts.json" 2>/dev/null && roster=named',
        '  printf \'%s row=%s roster=%s\\n\' "$*" "$row" "$roster" >> "$HOME/usage-svc-calls"',
        '  { [ "$1" = --user ] && [ "$2" = is-active ]; } || exit 0',
        '  f="$HOME/usage-svc-states"; w=inactive',
        '  if [ -s "$f" ]; then',
        '    w="$(head -n 1 "$f")"',
        '    if [ "$(wc -l < "$f")" -gt 1 ]; then tail -n +2 "$f" > "$f.next" && mv -f "$f.next" "$f"; fi',
        '  fi',
        '  n=0; [ -f "$HOME/usage-svc-n" ] && n="$(cat "$HOME/usage-svc-n")"; n=$((n + 1)); printf \'%s\' "$n" > "$HOME/usage-svc-n"',
        '  [ "$n" -le 30 ] || w=inactive',
        '  [ "$w" = - ] && exit 1',
        '  printf \'%s\\n\' "$w"; [ "$w" = active ] && exit 0; exit 3',
        'fi',
    ```

    The rest of the function (its `disable --now` arm and the `exec` of the file's own stand-in) is unchanged.

  - Directly after `const usageCtlCalls = …;`, add:

    ```ts
    /** Plan 3b Task A3: every argv `plantUsageCtl` saw naming ccrc's usage service, in order. */
    const usageSvcCalls = (home: string): string[] =>
      (existsSync(join(home, 'usage-svc-calls')) ? readFileSync(join(home, 'usage-svc-calls'), 'utf8').split('\n').filter(Boolean) : []);
    /** The live lanes' shape (exec.kind external, telemetry codex), as C4, C14 and C15 spell it. */
    const USAGE_EXT_A = {
      id: 'ext-a', label: 'lab·dev0', hue: 'amber', configDirSuffix: '.claude-ext-a', homeAble: false,
      telemetry: 'codex', exec: { kind: 'external', provider: 'openai' },
    };
    ```

  - In `describe('ccrc account remove')`, directly after C15's closing `});`, add:

    ```ts
      // ── Plan 3b Task A3 (⟦D:account-removal-waits-for-usage-refresh⟧,
      // ⟦D:usage-quiesce-before-the-roster-drop⟧): a usage poll the timer already
      // fired is WAITED for, never stopped, before the roster drop and before the
      // limits row. `ext-a` (C14's shape) keeps every other manager question out of
      // the run, so `systemctl-poison` stays absent: nothing else was asked.
      const seedUsageWait = (home: string, svc: string[]): { link: string; row: string; ctl: string } => {
        seedRosterJson(home, [UPSTREAM, USAGE_EXT_A, HOMEABLE('team-shared', 'blue')]);
        for (const id of ['claude', 'team-shared']) plantLauncher(home, id);
        plantLauncher(home, 'ext-a', '#!/bin/sh\n# somebody else wrote this\nexit 0\n');
        const { link, row } = plantCodexUsage(home, 'ext-a');
        const ctl = plantUsageCtl(home, { svc });
        plantTmux(home, []);
        return { link, row, ctl };
      };
      const runWith = (home: string, ctl: string, extra: NodeJS.ProcessEnv = {}): Result =>
        run(home, ['account', 'remove', '--id', 'ext-a'], '', { PATH: `${ctl}:${env(home)['PATH'] ?? ''}`, ...extra });
      const SVC = 'ccrc-codex-usage@ext-a.service';

      itSystemd('Plan 3b Task A3: a usage poll already running is WAITED for — one waiting line, is-active only, never a stop — before the roster drop and the limits row', () => {
        const home = box('ccrc-account-remove-usage-wait-');
        const { link, row, ctl } = seedUsageWait(home, ['active', 'activating', 'inactive']);
        const r = runWith(home, ctl, { CCRC_ACCT_USAGE_WAIT_S: '30' });
        expect(r.code, r.stderr).toBe(0);
        const j = oneObject(r);
        // THE ORDER IS THE CLAIM: every read saw the row AND the roster entry still standing.
        expect(usageSvcCalls(home)).toEqual(Array(3).fill(`--user is-active ${SVC} row=present roster=named`));
        expect(r.stderr.split('\n').filter((l) => l.startsWith('ccrc account remove: '))).toEqual([
          `ccrc account remove: ccrc's usage poll ${SVC} is running (active); waiting up to 30s for it to finish before $HOME/.cc-limits/ext-a.json is removed. ccrc never stops it: it may be writing the lane's OAuth token file.`]);
        expect(usageCtlCalls(home)).toEqual(['--user disable --now ccrc-codex-usage@ext-a.timer']);
        expect(lexists(link)).toBe(false);
        expect(existsSync(row), 'the limits row survived the removal').toBe(false);
        expect(j['removed']).toEqual(expect.arrayContaining([link, row]));
        expect(existsSync(join(home, 'systemctl-poison')), 'the removal asked the manager something else').toBe(false);
      });

      itSystemd('Plan 3b Task A3: a poll still running at the bound REFUSES usage-refresh-in-flight before the roster drop and before any limits-row deletion — never a stop', () => {
        const home = box('ccrc-account-remove-usage-in-flight-');
        const { link, row, ctl } = seedUsageWait(home, ['activating']);
        const roster = join(home, '.ccrc', 'accounts.json');
        const rosterBefore = readFileSync(roster, 'utf8');
        const r = runWith(home, ctl, { CCRC_ACCT_USAGE_WAIT_S: '2' });
        expect(r.code).toBe(1);
        const j = oneObject(r);
        expect(j['error']).toBe('usage-refresh-in-flight');
        const detail = String(j['detail']);
        expect(detail.startsWith(`ccrc's usage poll ${SVC} for ext-a still reads activating after 2s (CCRC_ACCT_USAGE_WAIT_S), so this removal stopped before the roster drop and before $HOME/.cc-limits/ext-a.json: ccrc never stops a poll, because it may be writing the lane's OAuth token file, and a row removed under a running poll is written again.`), detail).toBe(true);
        expect(detail).toContain('ccrc\'s usage timer ccrc-codex-usage@ext-a.timer is not enabled, so no new poll starts.');
        expect(detail).toContain('The roster entry and all account artifacts still stand');
        expect(detail.endsWith(`Retry 'ccrc account remove --id ext-a' once 'systemctl --user is-active ${SVC}' reads inactive: every step this run took is safe to repeat.`), detail).toBe(true);
        expect(r.stderr).toMatch(/^ccrc account remove: ccrc's usage poll ccrc-codex-usage@ext-a\.service is running \(activating\); waiting up to 2s /m);
        expect(readFileSync(roster, 'utf8'), 'the roster was dropped past a running poll').toBe(rosterBefore);
        expect(existsSync(row), 'the limits row was deleted under a running poll').toBe(true);
        expect(lexists(link), 'the timer is withdrawn first, so no new poll starts').toBe(false);
        const calls = usageSvcCalls(home);
        expect(calls.length, 'the bound was not waited out').toBeGreaterThanOrEqual(2);
        for (const c of calls) expect(c).toBe(`--user is-active ${SVC} row=present roster=named`);
        expect(existsSync(join(home, 'systemctl-poison'))).toBe(false);
      });

      itSystemd('Plan 3b Task A3: the refusal is retryable — every step before the wait repeats as a no-op, and the retry completes the removal', () => {
        const home = box('ccrc-account-remove-usage-retry-');
        seedFull(home);
        plantRow(home, 'orchard-api', { wrapper: 'alt-max', home: 'alt-max' });
        const { link } = plantCodexUsage(home, 'alt-max', { row: false });   // seedFull writes the row
        const ctl = plantUsageCtl(home, { svc: ['activating'] });
        plantTmux(home, []);
        const row = join(home, '.cc-limits', 'alt-max.json');
        const launcher = join(home, '.local', 'bin', 'alt-max');
        const field = (name: string): string => readFileSync(join(home, '.cc-sessions', `orchard-api.${name}`), 'utf8');
        const runIt = (): Result => run(home, ['account', 'remove', '--id', 'alt-max'], '',
          { PATH: `${ctl}:${env(home)['PATH'] ?? ''}`, CCRC_ACCT_USAGE_WAIT_S: '2' });

        const first = runIt();
        expect(first.code).toBe(1);
        const f = oneObject(first);
        expect(f['error']).toBe('usage-refresh-in-flight');
        expect(String(f['detail'])).toContain('Registry fields already rehomed to claude: orchard-api.wrapper orchard-api.home.');
        // Everything before the wait HAPPENED…
        expect(field('wrapper')).toBe('claude');
        expect(field('home')).toBe('claude');
        expect(existsSync(join(home, '.claude-alt-max', 'skills', 'ccrc-worker')), 'the sweep did not run before the wait').toBe(false);
        expect(lexists(link)).toBe(false);
        // …and nothing the drop or the artifact loop owns did.
        expect(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8')).toContain('"alt-max"');
        for (const p of [row, launcher]) expect(existsSync(p), p).toBe(true);

        writeFileSync(join(home, 'usage-svc-states'), 'inactive\n');
        const second = runIt();
        expect(second.code, second.stderr).toBe(0);
        const j = oneObject(second);
        expect(j['rehomed'], 'the retry found a field still naming the account').toEqual([]);
        expect((j['roster'] as { accounts: { id: string }[] }).accounts.map((a) => a.id)).toEqual(['claude', 'team-shared']);
        for (const p of [row, launcher]) expect(existsSync(p), p).toBe(false);
        expect(j['removed']).toEqual(expect.arrayContaining([row, launcher]));
        expect(usageCtlCalls(home), 'the retry disabled the timer a second time').toEqual(['--user disable --now ccrc-codex-usage@alt-max.timer']);
        for (const c of usageSvcCalls(home)) expect(c).toBe('--user is-active ccrc-codex-usage@alt-max.service row=present roster=named');
      });

      itSystemd('Plan 3b Task A3: a manager that does not say whether the poll runs is UNMEASURED — an operator step, never read as done — and the removal completes', () => {
        const home = box('ccrc-account-remove-usage-unmeasured-svc-');
        const { row, ctl } = seedUsageWait(home, ['-']);
        const r = runWith(home, ctl);
        expect(r.code, r.stderr).toBe(0);
        expect(oneObject(r)['operator-steps']).toContain(`ccrc's usage poll ${SVC} may still be running for the removed account ext-a: the user manager did not say (systemctl --user is-active answered ""), so this removal did not wait for it, and a poll that was running may write $HOME/.cc-limits/ext-a.json again after this removal. Run: systemctl --user is-active ${SVC} — once it reads inactive, remove $HOME/.cc-limits/ext-a.json by hand if it is there.`);
        expect(usageSvcCalls(home)).toEqual([`--user is-active ${SVC} row=present roster=named`]);
        expect(existsSync(row)).toBe(false);
        expect(r.stderr).not.toMatch(/waiting up to/);
      });

      it('Plan 3b Task A3: on macOS no manager is asked about a usage poll — ccrc places no usage unit there (decision 17)', () => {
        const home = box('ccrc-account-remove-usage-darwin-');
        plantCodexUsage(home, 'ext-a', { enabled: false, row: false });   // the template, on the Linux path the sourced file resolved
        const r = sourceRun(home, 'CCD_OS=darwin\n_acct_remove_usage ext-a "STANDS."\nprintf "removed=%s|step=%s|wait=%s\\n" "$ACCT_USAGE_REMOVED" "$ACCT_USAGE_STEP" "$ACCT_USAGE_WAIT_STEP"');
        expect(r.code, r.stderr).toBe(0);
        expect(r.stdout).toBe('removed=|step=|wait=\n');
        for (const p of ['launchctl-poison', 'systemctl-poison']) expect(existsSync(join(home, p)), p).toBe(false);
      });

      it('Plan 3b Task A3: CCRC_ACCT_USAGE_WAIT_S is the bound, in whole seconds, default 300, falling back exactly as CCRC_CODEX_READY_S does', () => {
        const home = box('ccrc-account-usage-wait-secs-');
        const read = (v?: string): string =>
          sourceRun(home, '_acct_usage_wait_secs', v === undefined ? {} : { CCRC_ACCT_USAGE_WAIT_S: v }).stdout;
        expect(read()).toBe('300');
        expect(read('7')).toBe('7');
        expect(read('010'), 'read in base 10, never octal').toBe('10');
        for (const v of ['', 'abc', '0', '00', '00007', '99999', '-5', '1.5']) expect(read(v), JSON.stringify(v)).toBe('300');
      });
    ```

- [ ] **Step 2: run them red.** Foreground, timeout at least 600000 ms:

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  cd server
  r11 a3-red ./node_modules/.bin/vitest run test/ccrc-account.test.ts -t 'Plan 3b Task A3|C1[2-5]:|C4: never reaps'
  ```

  Expected: `Tests 6 failed | 5 passed | <K'> skipped` under `census: clean — … command exit 1`. C4 and C12–C15 stay green: a base run never names the service, so the stand-in's new branch is never reached. Each new case fails on the base for this reason:
  - **waited for:** `expected [] to deeply equal [ …three is-active lines… ]`. The base removal never names the service, and exits 0.
  - **refuses at the bound:** `expected 0 to be 1`.
  - **retryable:** `expected 0 to be 1` on the first run, which completes.
  - **unmeasured:** `expected [ …the operator steps… ] to include …`. No step names the service.
  - **macOS:** a non-zero exit, with `ACCT_USAGE_WAIT_STEP: unbound variable` on stderr (`set -u`).
  - **the bound:** `expected '' to be '300'`, with `_acct_usage_wait_secs: command not found` on stderr.

  Any other failure stops the task. Read it before writing code.

- [ ] **Step 3: write the code** in `ccd/ccrc`.
  - **The caller, one line moved.** Delete this line (unique), which sits directly above `for f in "$CCRC_LIMITS_DIR/$id.json" "$_SVC_REG/$id-disabled" …`:

    ```bash
      _acct_remove_usage "$id"; [ -z "$ACCT_USAGE_REMOVED" ] || removed+=("$ACCT_USAGE_REMOVED"); [ -z "$ACCT_USAGE_STEP" ] || operator_steps+=("$ACCT_USAGE_STEP")
    ```

    Then, Old (unique):

    ```bash
      _acct_write_op "$stands" drop --file "$(_acct_roster_path)" --id "$id" --stands "$stands"
    ```

    New:

    ```bash
      _acct_remove_usage "$id" "$stands"; [ -z "$ACCT_USAGE_REMOVED" ] || { removed+=("$ACCT_USAGE_REMOVED"); stands="$stands ccrc's usage timer for $id was disabled; 'ccrc install' enables it again for a lane that is still codex."; }; [ -z "$ACCT_USAGE_STEP" ] || operator_steps+=("$ACCT_USAGE_STEP"); [ -z "$ACCT_USAGE_WAIT_STEP" ] || operator_steps+=("$ACCT_USAGE_WAIT_STEP")
      _acct_write_op "$stands" drop --file "$(_acct_roster_path)" --id "$id" --stands "$stands"
    ```

  - **The function and its bound.** Replace the whole of `_acct_remove_usage`, from its header comment's first line `# Account removal's usage half (Plan 3a Task 7): ccrc's own` through the function's closing `}`, with:

    ```bash
    # Account removal's usage half (Plan 3a Task 7; Plan 3b Task A3): ccrc's own
    # `ccrc-codex-usage@<id>.timer`, disabled if this box has it enabled — WHATEVER
    # the row's kind (D-3727). A lane
    # flipped back to external can still carry the instance its codex days enabled,
    # and after the removal nothing converges it until the next install, while it
    # rewrites the very ~/.cc-limits row the removal deletes. Found by the manager's
    # own link, never the roster. Another repository's `ccgpt-usage@<id>.timer` is
    # never touched or named in a systemctl call. Sets ACCT_USAGE_REMOVED (the link,
    # once the disable MEASURABLY took it) or ACCT_USAGE_STEP (the operator step
    # when it did not). Every byte the manager says goes to stderr: `_acct_remove`'s
    # stdout is one JSON object.
    #
    # THEN IT WAITS, AND IT NEVER STOPS (⟦D:account-removal-waits-for-usage-refresh⟧).
    # Disabling the timer does not end the `ccrc-codex-usage@<id>.service` it had
    # already fired: a oneshot runs to the end of its poll, and that poll may be
    # part-way through the Authenticator's write of the lane's `auth.json`. A stop
    # could cut that write short, in the authDir removal deliberately keeps, so
    # nothing here asks for one. A limits row removed under a running poll is
    # written again by it. So the service is read through `_svc_is_active` once a
    # second, for at most `_acct_usage_wait_secs`, with one waiting line on stderr:
    #   * `inactive`, `failed`: done;
    #   * `activating` (a oneshot reads it for its WHOLE run — never `active`),
    #     `active`, `deactivating`, `reloading`, `refreshing`: in flight;
    #   * anything else, the EMPTY answer of a manager that did not reply included:
    #     UNMEASURED, never done. The removal goes on, and ACCT_USAGE_WAIT_STEP says
    #     so. Refusing would make every removal impossible on a box whose user bus
    #     is down.
    # At the bound it REFUSES `usage-refresh-in-flight`, ending its sentence with the
    # caller's what-still-stands clause ($2) and the retry. The timer is disabled
    # FIRST because a timer still enabled could fire a new poll between an
    # `inactive` read and the row's `rm`.
    #
    # THE CALLER RUNS IT BEFORE THE ROSTER DROP (⟦D:usage-quiesce-before-the-roster-drop⟧).
    # Plan 3a ran it after the drop, where it could not refuse. A refusal there could
    # not be retried, because `_acct_lane` answers `unknown-id` for an id the roster no
    # longer names. Before the drop, every earlier step repeats as a no-op on a second
    # run: rehoming finds no field naming the id, the home sweep finds nothing, a
    # stopped tier stays stopped, and this function skips a disabled timer. So the
    # retry the refusal asks for is safe. It waits under the placement lock
    # `_acct_marker_lock` already holds, for at most the bound. One poll is a token
    # refresh plus one request the publisher bounds at 30 s (the unit's own comment).
    #
    # ASKED ONLY WHERE A POLL CAN RUN: on Linux, with ccrc's template
    # `ccrc-codex-usage@.service` placed in the unit directory, whether or not the
    # timer link is still there (a retry finds it gone). A box without the template
    # can hold no instance, and macOS places no usage unit (decision 17), so neither
    # asks the manager anything.
    #
    # The bound: `CCRC_ACCT_USAGE_WAIT_S`, default 300, which is the unit's own
    # TimeoutStartSec (D-3707). After 300 s systemd ends the poll itself. It falls
    # back to 300 on exactly the values `_codex_ready_secs` falls back on, by the
    # same parse, and is read in base 10. Prints the number with no newline;
    # always rc 0.
    _acct_usage_wait_secs() {
      local s="${CCRC_ACCT_USAGE_WAIT_S:-300}"
      case "$s" in ''|*[!0-9]*|?????*) s=300 ;; esac
      s=$(( 10#$s ))
      [ "$s" -ge 1 ] || s=300
      printf '%s' "$s"
    }
    _acct_remove_usage() {   # <id> <what-still-stands>
      ACCT_USAGE_REMOVED=''; ACCT_USAGE_STEP=''; ACCT_USAGE_WAIT_STEP=''
      local u s tpl state limit t0 said=0 timer
      u="$(_codex_usage_timer "$1")"; s="${u%.timer}.service"; tpl="$BOX_UNIT_DIR/${s%%@*}@.service"
      if _codex_usage_enabled "$u"; then
        _codex_bus_defaults
        if systemctl --user disable --now "$u" >&2 && ! _codex_usage_enabled "$u"; then
          ACCT_USAGE_REMOVED="$(_codex_usage_wants)/$u"
        else
          ACCT_USAGE_STEP="ccrc's usage timer $u is still enabled for the removed account $1, so it may go on rewriting \$HOME/.cc-limits/$1.json. Run: systemctl --user disable --now $u"
        fi
      fi
      [ "$CCD_OS" != darwin ] || return 0
      { [ -e "$tpl" ] || [ -L "$tpl" ]; } || return 0
      _codex_bus_defaults
      limit="$(_acct_usage_wait_secs)"; t0=$SECONDS
      while :; do
        state="$(_svc_is_active "$s")"
        case "$state" in
          inactive|failed) return 0 ;;
          activating|active|deactivating|reloading|refreshing) : ;;
          *)
            ACCT_USAGE_WAIT_STEP="ccrc's usage poll $s may still be running for the removed account $1: the user manager did not say (systemctl --user is-active answered \"$state\"), so this removal did not wait for it, and a poll that was running may write \$HOME/.cc-limits/$1.json again after this removal. Run: systemctl --user is-active $s — once it reads inactive, remove \$HOME/.cc-limits/$1.json by hand if it is there."
            return 0 ;;
        esac
        if [ "$said" -eq 0 ]; then
          printf '%s\n' "$PROG account remove: ccrc's usage poll $s is running ($state); waiting up to ${limit}s for it to finish before \$HOME/.cc-limits/$1.json is removed. ccrc never stops it: it may be writing the lane's OAuth token file." >&2
          said=1
        fi
        if [ $(( SECONDS - t0 )) -ge "$limit" ]; then
          timer="ccrc's usage timer $u is not enabled, so no new poll starts."
          _codex_usage_enabled "$u" && timer="ccrc's usage timer $u is still enabled, so new polls go on starting: run systemctl --user disable --now $u first."
          _acct_refuse 1 usage-refresh-in-flight "ccrc's usage poll $s for $1 still reads $state after ${limit}s (CCRC_ACCT_USAGE_WAIT_S), so this removal stopped before the roster drop and before \$HOME/.cc-limits/$1.json: ccrc never stops a poll, because it may be writing the lane's OAuth token file, and a row removed under a running poll is written again. $timer $2 Retry 'ccrc account remove --id $1' once 'systemctl --user is-active $s' reads inactive: every step this run took is safe to repeat."
        fi
        sleep 1
      done
    }
    ```

    The disable's two lines (`if systemctl --user disable --now "$u" >&2 && ! _codex_usage_enabled "$u"; then` and the `ACCT_USAGE_STEP=` sentence) keep their bytes. Only their indent moves, so Plan 3a's re-measure row (its A4g, bound by C15) still applies.

- [ ] **Step 4: run green, and prove nothing cited moved.**

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  grep -n '^_codex_usage_timer() {' ccd/ccrc | diff - "$SCRATCH/a3-anchor" && echo "anchor unmoved"
  # → anchor unmoved: the caller's move kept _acct_remove's length
  a="$(grep -n 'drop --file "$(_acct_roster_path)" --id "$id" --stands "$stands"' ccd/ccrc | cut -d: -f1)"
  b="$(grep -n '^  _acct_remove_usage "$id" "$stands"; ' ccd/ccrc | cut -d: -f1)"
  [ "$b" -eq $((a - 1)) ] && echo "the usage half runs directly before the drop"
  grep -c '^  _acct_remove_usage "$id"; ' ccd/ccrc
  # → 0: Plan 3a's call site is gone
  sed -n '/^_acct_remove_usage() {/,/^}$/p' ccd/ccrc | grep -cE '_svc_stop|systemctl[^#]* stop '
  # → 0
  cd server
  r11 a3-green ./node_modules/.bin/vitest run test/ccrc-account.test.ts
  ```

  Expected: `anchor unmoved`, `the usage half runs directly before the drop`, `0`, `0`, then `Tests <P + 6> passed | <K> skipped` against Step 0's record, under `census: clean … command exit 0`. The new waits make the file about 6 s slower.

  Then the neighbours, each its own foreground call:

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  cd server
  r11 a3-neigh-hook ./node_modules/.bin/vitest run test/session-hook.test.ts
  ```

  Expected: green. Nothing above the anchor changed length. If it reds anyway, the cause is not this task's: stop and report it to the controller, with the failing assertion's name. Never adjust a census number here.

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  cd server
  r11 a3-neigh-tc ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
  ```

  Expected: green. It typechecks `server/test/`, which `tsc --noEmit` does not read.

- [ ] **Step 5: the mutation table. MEASURE every row both ways.**
  - Stage this task's files, so the index holds the green tree, then back up `ccd/ccrc`:

    ```bash
    . "<abs scratch>/plan3b-exec/plan3b-env.sh"
    git add ccd/ccrc server/test/ccrc-account.test.ts
    mkdir -p "$SCRATCH/a3-mut" && cp ccd/ccrc "$SCRATCH/a3-mut/ccrc"
    ```

  - For each row alone, apply the mutation in `ccd/ccrc` and run. `timeout` bounds a row that would leave the wait unbounded, on top of the stand-in's 30-read cap:

    ```bash
    . "<abs scratch>/plan3b-exec/plan3b-env.sh"
    cd server
    r11 a3-mut-<row> timeout 300 ./node_modules/.bin/vitest run test/ccrc-account.test.ts -t 'Plan 3b Task A3|C1[2-5]:|C4: never reaps'
    ```

  - Then restore and prove the restore, and re-run the row's command labelled `a3-mut-<row>-green` (expected: 11 passed):

    ```bash
    . "<abs scratch>/plan3b-exec/plan3b-env.sh"
    cp "$SCRATCH/a3-mut/ccrc" ccd/ccrc && git diff --quiet -- ccd/ccrc && echo restored
    ```

  - The red counts below are derived from the cases, not yet measured. Record the measured ones. If a row does not red, report that, and never add code to force a bind.

  | # | Guard | Mutation (in `ccd/ccrc`) | Goes red |
  |---|---|---|---|
  | A3-M1 | the service is read at all | in `_acct_remove_usage`, `state="$(_svc_is_active "$s")"` → `state=inactive` | 4: waited for, refuses at the bound, retryable, unmeasured |
  | A3-M2 | `activating` is in flight (a running oneshot's only word) | the in-flight arm `activating\|active\|deactivating\|reloading\|refreshing)` → `active\|deactivating\|reloading\|refreshing)` | 3: waited for (two reads, not three, and an operator step), refuses at the bound, retryable |
  | A3-M3 | `active` is in flight | the same arm without `active` | 1: waited for (its first read is `active`) |
  | A3-M4 | the bound refuses | the `_acct_refuse 1 usage-refresh-in-flight …` line → `return 0` | 2: refuses at the bound, retryable (its first run exits 0) |
  | A3-M5 | never a stop | insert `_svc_stop "$s"` on its own line directly above `sleep 1` | 3: waited for, refuses at the bound, retryable (each records a `--user stop …` line) |
  | A3-M6 | before the drop | delete the new caller line, and re-insert Plan 3a's caller line (Step 3's deleted line, with `"$stands"` added after `"$id"`) directly above `for f in "$CCRC_LIMITS_DIR/$id.json"` | 4: waited for and unmeasured (`roster=dropped`), refuses at the bound (the roster was dropped), retryable (its second run refuses `unknown-id`) |
  | A3-M7 | unmeasured is never done | the `*)` arm's `ACCT_USAGE_WAIT_STEP="…"` line → `:` | 1: unmeasured |
  | A3-M8 | only where a poll can run | delete the line `{ [ -e "$tpl" ] \|\| [ -L "$tpl" ]; } \|\| return 0` | 1: C4 (`an external removal asked a service manager`) |
  | A3-M9 | macOS asks nothing | delete the line `[ "$CCD_OS" != darwin ] \|\| return 0` | 1: macOS (`wait=` carries the unmeasured step) |
  | A3-M10 | the knob is read | in `_acct_usage_wait_secs`, `local s="${CCRC_ACCT_USAGE_WAIT_S:-300}"` → `local s=300` | 4: the bound case (`7` reads 300), waited for (its line says `300s`), and the refusal and retry cases, which run the stand-in to its 30-read cap and exit 0 after about 30 s |
  | A3-M11 | base 10 | `s=$(( 10#$s ))` → `s=$(( s ))` | 1: the bound case (`010` reads 8) |

- [ ] **Step 6: scope and residue check,** against this task's own base:

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  BASE="$(cat "$SCRATCH/a3-base")"
  git diff --name-only "$BASE"
  # → ccd/ccrc, server/test/ccrc-account.test.ts
  git diff --quiet "$BASE" -- ccd/ccd ccd/ccrc-doctor-checks deploy shared docs server/test/codexLaneFixture.ts && echo untouched
  # → untouched
  git diff "$BASE" -- ccd/ccrc | grep '^+' | grep -cE '_svc_stop|systemctl --user stop|writeFileSync'
  # → 0
  git diff "$BASE" -- ccd/ccrc server/test/ccrc-account.test.ts | grep '^+' | grep -c 'D-[0-9]'
  # → 1: the header's existing D-3707 (the unit's TimeoutStartSec). Any other hit is a number nobody issued: remove it
  ```

- [ ] **Step 7: commit.**

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  git add ccd/ccrc server/test/ccrc-account.test.ts
  git commit -F - <<'EOF'
  fix(account): removal waits for a running usage poll, never stops it, and refuses before the drop at the bound

  Disabling ccrc-codex-usage@<id>.timer does not end the oneshot it had
  already fired, and account removal deleted ~/.cc-limits/<id>.json right
  after, under a poll that writes it again and may be part-way through the
  Authenticator's write of the lane's auth.json. The removal now disables
  the timer, then reads the service once a second (activating, the word a
  running oneshot reads, is in flight) until it is done, bounded by
  CCRC_ACCT_USAGE_WAIT_S (default 300, the unit's TimeoutStartSec), with
  one waiting line. It never asks for a stop. At the bound it refuses
  usage-refresh-in-flight. A manager that does not answer is unmeasured,
  an operator step, never done. The usage half now runs before the roster
  drop, because a refusal after the drop cannot be retried (the retry
  refuses unknown-id). Every earlier step repeats as a no-op, so the retry
  the refusal asks for completes. One caller line moved, so no cited line
  moved. Inert where no poll is running, and on macOS.

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git log -1 --format='%an <%ae> | %cn <%ce>'
  ```

### Task A4: the refresh loop never reads a bodyless render failure as skipped

> Rulings applied:
> - **A-4.** An `ok:true` row whose LiteLLM render failed with no body must not read `skipped`. The code fix lands here. The row records the failure in the loop's existing vocabulary. The `.detail` vs `.detail // empty` difference is in the same block, so it folds into the same commit, with no number of its own.
> - **Which word.** The loop has no failure-code field. A failed row is `{id, ok:false, reason}`, and `reason` is a sentence. `litellm: "failed"` was retired from the row by the STOP-THEN-WRITE ruling, whose comment the block carries: the row's `litellm` vocabulary is `rendered|unchanged|skipped`. So this task mints no word and revives none. A render that fails with nothing to read becomes the existing failed row, and its reason is its sibling's sentence shape, `_models_litellm exited <rc> with no answer`. Two steps up, the `materialise` failure already says `materialise exited <rc> with no answer`.
> - **The reading rule** (for Part B's soak gate, Task B4, which states it): on a `probe:"codex"` row, only `ok:true` with `litellm` `rendered` or `unchanged` says the codex arm rendered. `skipped` on such a row is a failure signal on every build, this fix or not.
> - **S1.** Inert on the live shape. Every refusal `_models_litellm` makes today goes through `_models_refuse`, which always prints a JSON body with a `detail`, so only a killed or crashed render reaches the changed branch. Lane 1's hourly row changes only on such a run, and then it truthfully reads `ok:false`, so `refresh --all` exits 1.
> - **F2 / F4.** Census-wrapped commands, red first, a mutation row per guard. Slug: `⟦D:bodyless-litellm-failure-fails-the-row⟧`.

**Files:**
- Modify: `ccd/ccrc`, the `refresh` arm of `cmd_models`: the LiteLLM block that starts at `grep -n '^          lit="skipped"$' ccd/ccrc` (`:10587` at `be93d159`; Task A1's edits sit above it, so re-derive it by that locator). Five lines change and the line count stays the same, so no line the compaction-card corpus cites moves. The file is not stamped.
- Test: `server/test/ccrc-models.test.ts`:
  - one `it.each` (three rows) at the end of `describe('refresh runs the litellm step for a codex lane (§5)')`;
  - one case in `describe('ccrc models litellm — a codex-kind lane renders its own config and restarts its own tier (D-3482)')`, directly after `'refresh: a codex lane whose stop fails is a FAILED row that says why, and its config is not written'`.
- **Unchanged, measured:**
  - `_models_litellm` and both its arms;
  - the `materialise` block above;
  - the row-assembly `if`/`elif`/`else`, which already turns a non-empty `lreason` into `ok:false`;
  - the tail's `{ok, op, refreshed}` object and the exit code.
- **Consumers of the row, measured.** Nothing in `server/src`, `pwa/src`, `agent/src` or `shared` reads `refreshed[]` (`grep -rn 'refreshed' … | grep -c litellm` → 0). Doctor's `models` check reads each catalogue's own status and `fetchedAt`, not this row. `ccrc-models.service` (`Type=oneshot`, `ExecStart=… ccrc models refresh --all`) goes `failed` on exit 1, and its journal holds the row. So the row's readers are the operator, the journal and Part B's soak gate.

**Interfaces:**
- Consumes: `_models_litellm <id>` (stdout: one JSON body on success or refusal; exit 0 on success), `$probe`, `$mreason`, `$id`, `jq`.
- Produces:
  - for a lane whose catalogue probe and `materialise` succeeded, with `probe` `codex`, where `_models_litellm` exits `<rc>` non-zero:
    - its body's last line has a non-empty `.detail`: unchanged, `{id, ok:false, reason:<that detail>}`;
    - no stdout, a body with no `.detail` (or `null`), or bytes that are not JSON: `{id, ok:false, reason:"_models_litellm exited <rc> with no answer"}`. That makes `refresh --all` and `refresh <id>` exit 1 with the tail's `ok:false`. Before this task such a lane read `{id, probe:"codex", ok:true, count, litellm:"skipped"}`, or `reason:"null"`, at exit 0 or 1 respectively;
  - `litellm:"skipped"` now appears only on an `ok:true` row whose probe is not `codex`, or none (the block's guard `[ "$probe" = "codex" ]`). That is what makes Part B's reading rule exact on a fixed box;
  - jq's own complaint about a non-JSON body no longer reaches stderr (`2>/dev/null`, as the `materialise` block has).
  - **Handed to Task A7:** §21.4 as A7 drafted it is true of this code, and needs no pointer above §21, because no spec line above it states the row's vocabulary. Its "a non-empty `reason` naming that exit" is the literal `_models_litellm exited <rc> with no answer`. §21.12's `‹A4›` cell is this task's four case titles in `ccrc-models.test.ts` (the `it.each` expands to three).

**Why:**
- **The fold.** `lit="skipped"` is the default. On failure the block derives `lreason` only by parsing the body's last line: `printf '%s' "$lbody" | tail -n1 | jq -r '.detail'`. On an empty body that prints nothing at rc 0 (`printf '' | jq -r '.detail'`, measured). So `lreason` is empty, the `elif [ -n "$lreason" ]` arm is skipped, and the final `else` builds `ok:true` with the untouched `skipped`. A failed render reads as a success with an optional step not taken.
- **Two more shapes of the same fold.** A body with no `.detail` makes plain `.detail` print the literal `null`, a non-empty and meaningless reason. Bytes that are not JSON make jq fail on stderr with nothing on stdout, which is the empty case again. The `materialise` block two steps up already reads `.detail // empty` with `2>/dev/null`, and defaults an empty reason to `materialise exited $mat_rc with no answer`. This block now matches it exactly, with its exit code captured explicitly instead of read off the `if`.
- **Why none of today's cases saw it.** Every refusal case in the suite reaches `_models_refuse`, which always prints a body with a `detail`. So the new cases redefine `_models_litellm` after `ccd/ccrc` is sourced, the `sourced(…)` idiom the Z4 case uses for `_codex_lanes`.
- **Line-neutral.** `lbody` joins the `local` line, the capture replaces the old `local lbody`, the fallback shares the `lreason` line, and the comment's last line takes the pointer. So the block keeps its length.

- [ ] **Step 0: record the base and re-run the locators (read-only).**

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  git rev-parse HEAD > "$SCRATCH/a4-base"; cat "$SCRATCH/a4-base"
  grep -n '^          lit="skipped"$' ccd/ccrc
  # → one line
  sed -n '/^          lit="skipped"$/,/litellm:\$lit}/p' ccd/ccrc | grep -cF "jq -r '.detail')"
  # → 1: the bare .detail
  sed -n '/^          lit="skipped"$/,/litellm:\$lit}/p' ccd/ccrc | grep -c 'with no answer'
  # → 0: no fallback
  grep -c 'mreason="materialise exited $mat_rc with no answer"' ccd/ccrc
  # → 1: the sibling this block copies
  printf '' | jq -r '.detail'; echo "rc=$?"
  # → an empty line, then rc=0: the mechanism of the fold
  grep -rn 'refreshed' server/src pwa/src agent/src shared --include=*.ts --include=*.tsx --include=*.mjs | grep -c litellm
  # → 0: no code consumer of the row
  grep -n '^# ── THE CODEX LANE LIBRARY (spec' ccd/ccrc > "$SCRATCH/a4-anchor"; cat "$SCRATCH/a4-anchor"
  # → one line, below the block: Step 4 proves it does not move
  ```

- [ ] **Step 1: write the failing tests** in `server/test/ccrc-models.test.ts`.
  - At the end of `describe('refresh runs the litellm step for a codex lane (§5)')`, after the case `'a lane whose restart fails is a FAILED row, and the run exits 1'`:

    ```ts
      // Plan 3b Task A4 (⟦D:bodyless-litellm-failure-fails-the-row⟧): a render that
      // FAILS with no `.detail` to read — no stdout at all (a killed subshell), an
      // envelope with no `detail`, or bytes that are not JSON — is a FAILED row
      // naming its exit, never `ok:true` with the `skipped` default and never the
      // reason "null". Every case above reaches `_models_refuse`, which always prints
      // a body, so none of them could see this. The function is redefined after
      // `ccd/ccrc` is sourced, the idiom the Z4 case uses for `_codex_lanes`.
      it.each([
        ['no stdout at all', '_models_litellm() { return 1; }', 1],
        ['an envelope with no detail', '_models_litellm() { printf \'%s\\n\' \'{"ok":false}\'; return 5; }', 5],
        ['bytes that are not JSON', '_models_litellm() { printf \'%s\\n\' \'not json\'; return 1; }', 1],
      ])('Plan 3b Task A4: a render that fails with %s is a FAILED row naming its exit, never ok:true with litellm "skipped"', (_what, stub, rc) => {
        const r = sourced(`${stub}\ncmd_models refresh ${LEGACY_EXTERNAL_ID}`, [], { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
        expect(r.code, r.stderr).toBe(1);
        const b = oneObject(r);
        expect(b['ok']).toBe(false);
        expect(b['refreshed']).toEqual([{ id: LEGACY_EXTERNAL_ID, ok: false, reason: `_models_litellm exited ${rc} with no answer` }]);
        expect(r.stderr, 'the block\'s own jq spoke on stderr').not.toMatch(/parse error/);
        expect(fs.existsSync(join(home, '.ccrc', 'models', `${LEGACY_EXTERNAL_ID}.json`)), 'the probe\'s catalogue stands').toBe(true);
      });
    ```

  - In the D-3482 describe, directly after `'refresh: a codex lane whose stop fails is a FAILED row that says why, and its config is not written'`:

    ```ts
      it('Plan 3b Task A4: refresh — a codex lane whose render dies with no answer is a FAILED row naming its exit, and its tier is never asked', () => {
        fs.writeFileSync(lanePath('codex-a'), OLD);
        const r = sourced('_models_litellm() { return 137; }\ncmd_models refresh codex-a', ['lock', 'ours', 'stop', 'start'],
          { CCRC_MODELS_PROBE_FIXTURE: CODEX_RAW });
        expect(r.code, r.stderr).toBe(1);
        expect(oneObject(r)['refreshed']).toEqual([{ id: 'codex-a', ok: false, reason: '_models_litellm exited 137 with no answer' }]);
        expect(laneCalls(), 'a stubbed render reached the lane library').toEqual([]);
        expect(fs.readFileSync(lanePath('codex-a'), 'utf8')).toBe(OLD);
      });
    ```

- [ ] **Step 2: run them red.** Foreground, timeout at least 600000 ms:

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  cd server
  r11 a4-red ./node_modules/.bin/vitest run test/ccrc-models.test.ts -t 'Plan 3b Task A4|a lane whose restart fails|refresh: a codex lane whose stop fails|refresh reaches the same arm'
  ```

  Expected: `Tests 4 failed | 3 passed | <K> skipped` under `census: clean — … command exit 1`. The three existing refresh-failure cases stay green. The reasons:
  - **no stdout at all**, and **bytes that are not JSON**: `expected 0 to be 1`. The row is `{ id: <LEGACY_EXTERNAL_ID>, probe: 'codex', ok: true, count: 9, litellm: 'skipped' }`, and the run exits 0. The second also prints jq's `parse error` on stderr.
  - **an envelope with no detail**: the exit is 1, and the row's reason is `'null'` (`expected [ { id: <LEGACY_EXTERNAL_ID>, ok: false, reason: 'null' } ] to deeply equal …`).
  - **the codex lane**: `expected 0 to be 1`. Its row reads `ok: true`, `litellm: 'skipped'`.

  Any other failure stops the task. Read it before writing code.

- [ ] **Step 3: write the code** in `ccd/ccrc`, the refresh arm's LiteLLM block.
  - Old (unique, the four lines directly below `          lit="skipped"`):

    ```bash
              local lreason=""
              if [ -z "$mreason" ] && [ "$probe" = "codex" ]; then
                local lbody
                if lbody="$(_models_litellm "$id" 2>/dev/null)"; then
    ```

    New:

    ```bash
              local lreason="" lbody lrc=0
              if [ -z "$mreason" ] && [ "$probe" = "codex" ]; then
                lbody="$(_models_litellm "$id" 2>/dev/null)" || lrc=$?
                if [ "$lrc" -eq 0 ]; then
    ```

  - Old (unique, the STOP-THEN-WRITE comment's last line and the line under it):

    ```bash
                  # bug this ruling fixes.
                  lreason="$(printf '%s' "$lbody" | tail -n1 | jq -r '.detail')"
    ```

    New:

    ```bash
                  # bug this ruling fixes; so is one with no .detail (Plan 3b A4, ⟦D:bodyless-litellm-failure-fails-the-row⟧).
                  lreason="$(printf '%s' "$lbody" | tail -n1 | jq -r '.detail // empty' 2>/dev/null)"; [ -n "$lreason" ] || lreason="_models_litellm exited $lrc with no answer"
    ```

    `local … lrc=0` runs once per loop iteration, so every lane starts from 0. The capture is its own statement, never `local lbody="$(…)"`, whose status would be `local`'s.

- [ ] **Step 4: run green, and prove nothing below moved.**

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  grep -n '^# ── THE CODEX LANE LIBRARY (spec' ccd/ccrc | diff - "$SCRATCH/a4-anchor" && echo "anchor unmoved"
  # → anchor unmoved
  sed -n '/^          lit="skipped"$/,/litellm:\$lit}/p' ccd/ccrc | grep -cF "jq -r '.detail')"
  # → 0
  sed -n '/^          lit="skipped"$/,/litellm:\$lit}/p' ccd/ccrc | grep -c '_models_litellm exited \$lrc with no answer'
  # → 1
  cd server
  r11 a4-green ./node_modules/.bin/vitest run test/ccrc-models.test.ts
  ```

  Expected: `anchor unmoved`, `0`, `1`, then the whole file green with four more passed than Task A1's tip recorded, under `census: clean … command exit 0`.

  Then the neighbours, each its own foreground call, each expected green:

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  cd server
  r11 a4-neigh-hook ./node_modules/.bin/vitest run test/session-hook.test.ts
  ```

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  cd server
  r11 a4-neigh-tc ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
  ```

  If `session-hook` reds, stop and report the failing assertion's name to the controller: this task moved no line, so the cause is elsewhere.

- [ ] **Step 5: the mutation table. MEASURE every row both ways.**
  - Stage, then back up:

    ```bash
    . "<abs scratch>/plan3b-exec/plan3b-env.sh"
    git add ccd/ccrc server/test/ccrc-models.test.ts
    mkdir -p "$SCRATCH/a4-mut" && cp ccd/ccrc "$SCRATCH/a4-mut/ccrc"
    ```

  - For each row alone, apply it and run:

    ```bash
    . "<abs scratch>/plan3b-exec/plan3b-env.sh"
    cd server
    r11 a4-mut-<row> timeout 300 ./node_modules/.bin/vitest run test/ccrc-models.test.ts -t 'Plan 3b Task A4|a lane whose restart fails|refresh: a codex lane whose stop fails|refresh reaches the same arm'
    ```

  - Restore and prove the restore, then re-run labelled `a4-mut-<row>-green` (expected: 7 passed):

    ```bash
    . "<abs scratch>/plan3b-exec/plan3b-env.sh"
    cp "$SCRATCH/a4-mut/ccrc" ccd/ccrc && git diff --quiet -- ccd/ccrc && echo restored
    ```

  - Counts are derived, not yet measured. Record the measured ones, and report any row that does not red.

  | # | Guard | Mutation (in `ccd/ccrc`) | Goes red |
  |---|---|---|---|
  | A4-M1 | the exit-code fallback | delete `; [ -n "$lreason" ] \|\| lreason="_models_litellm exited $lrc with no answer"` | 4: all three `it.each` rows (`ok: true`, `skipped`) and the codex lane |
  | A4-M2 | `.detail // empty` | `jq -r '.detail // empty' 2>/dev/null` → `jq -r '.detail' 2>/dev/null` | 1: the envelope with no detail (reason `null`) |
  | A4-M3 | the exit code is captured | `lbody="$(_models_litellm "$id" 2>/dev/null)" \|\| lrc=$?` → `lbody="$(_models_litellm "$id" 2>/dev/null)"` | 6: the four new rows and the two existing refusal cases, all now `ok: true` with `litellm: "unchanged"` |
  | A4-M4 | jq's complaint stays off stderr | drop the `2>/dev/null` after `'.detail // empty'` | 1: bytes that are not JSON (`parse error` on stderr) |
  | A4-M5 | the existing detail still wins | `lreason="$(printf …)"; [ -n "$lreason" ] \|\| lreason=…` → `lreason="_models_litellm exited $lrc with no answer"` | 2: `'a lane whose restart fails…'` and `'refresh: a codex lane whose stop fails…'` (`/could not be stopped/` no longer matches) |

- [ ] **Step 6: scope and residue check,** against this task's own base:

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  BASE="$(cat "$SCRATCH/a4-base")"
  git diff --name-only "$BASE"
  # → ccd/ccrc, server/test/ccrc-models.test.ts
  git diff --numstat "$BASE" -- ccd/ccrc
  # → 5	5	ccd/ccrc
  git diff --quiet "$BASE" -- ccd/ccd ccd/ccrc-doctor-checks ccd/ccrc-models-probe deploy shared docs && echo untouched
  # → untouched
  git diff "$BASE" -- ccd/ccrc | grep '^+' | grep -c 'litellm-failed\|litellm: *"failed"\|writeFileSync'
  # → 0: no retired word revived, no new writer
  ids="$(jq -r '.accounts[] | select(.telemetry == "codex") | .id' "$HOME/.ccrc/accounts.json")"
  printf '%s\n' "$ids" | while IFS= read -r id; do
    git diff "$BASE" | grep '^+' | sed 's/$/ /' | grep -cE "[^[:alnum:]_-]${id}[^[:alnum:]_-]"
  done
  # → 0 for each: no added line names a live lane id (the fixture reads LEGACY_EXTERNAL_ID by position). Only counts print.
  ```

- [ ] **Step 7: commit.**

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  git add ccd/ccrc server/test/ccrc-models.test.ts
  git commit -F - <<'EOF'
  fix(models): a LiteLLM render that fails with nothing to read is a failed refresh row, never ok:true skipped

  The refresh loop read a failed render's reason only from its body's
  .detail. A render that died with no stdout (a killed subshell) left the
  reason empty, so the row fell through to ok:true with the untouched
  "skipped" default; a body with no .detail gave the reason "null"; bytes
  that were not JSON did the first, with jq complaining on stderr. The block
  now captures the exit code, reads .detail // empty quietly, and falls
  back to "_models_litellm exited <rc> with no answer", exactly as the
  materialise block two steps up already does. The existing ok:false row
  carries it, and litellm: "failed" stays retired. So on a codex-probe row
  "skipped" can no longer stand for a failure. Every refusal today has a
  detail, so only a killed render changes. Line-neutral.

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git log -1 --format='%an <%ae> | %cn <%ce>'
  ```

### Task A5: doctor's codex checks tell unmeasured from absent

> Ruling A-5 absorbs three of Plan 3a's "Doctor robustness minors" (final-review follow-up, owner "one follow-up ticket, before Plan 3b"). Each one folds "could not measure" into an answer that reads healthy or empty. All three paths run only for a codex lane or for lane state under `~/.ccrc/codex`. Today's live shape has neither: no codex row, and no `~/.ccrc/codex` (census 2026-10-05). So the merge changes no live verdict. The `codex` row still answers its one SKIP.

**Files:**
- Modify `ccd/ccrc-doctor-checks`. Plan 3a's final review gave line numbers (`:5876`, `:5773`, `:6542`), and they are stale. Find each place by name:
  - **(a)** `_dr_cx_bins` (`grep -n '^_dr_cx_bins() {' ccd/ccrc-doctor-checks`; :6304 at `be93d159`). Replace the whole body.
  - **(b)** `_check_codex`'s left-state scan:
    - the loop is `grep -nF 'for d in "$root"/*/; do' ccd/ccrc-doctor-checks` (:5982);
    - the empty-population `if` sits below it, after Task A2's surplus lines (:5987 at `be93d159`, before A2);
    - add one block after the `for n in ${left[@]+"${left[@]}"}; do` loop (:6037-6040), just before `_dr_cx_report`.
  - **(c)** `_dr_cx_sessions` (`grep -n '^_dr_cx_sessions() {' ccd/ccrc-doctor-checks`; :6580-6596), and its header comment (:6573-6579).
- Modify `server/test/ccrc-doctor.test.ts` to add seven cases:
  - five in `describeCodex('ccrc doctor: codex, part 1 — …')`: three for (a), two for (b);
  - two in `describeCodex('ccrc doctor: codex, part 2 — …')`, for (c).
- **Not modified:**
  - `_fix_codex`. It already places a missing executable when there is no `cmp`, and names every other file "not compared" (`ccrc-doctor.test.ts`, "with no cmp on PATH, only a missing or non-executable file is placed…").
  - `_dr_cx_tiers`' two session WARNs, word for word. (c) feeds the existing `DRX_UNASKED` word and adds no new one.
  - `CODEX_LANE_BINS`, which stays on its one pinned line.
  - `ccd/ccrc`.
- **No added line in `ccd/ccrc-doctor-checks` spells `writeFileSync` or `renameSync`.** `modelenv-single-writer.test.ts` counts any file that spells a model-env key, `settings.json` and one of those words as a second writer.

**Interfaces:**
- **Consumes:**
  - from `ccd/ccrc-doctor-checks`, all unchanged: `_dr_cx_warn`, `_dr_cx_fail`, `_dr_cx_join`, `_dr_cx_member`, `_dr_cx_report`, `CODEX_LANE_BINS`, `_dr_skip`, and `DRX_UNASKED` / `DRX_UNASKED_SID`;
  - from `ccd/ccrc`: `_codex_lane_dir` (`$HOME/.ccrc/codex/<id>`) and `_svc_is_active`, both unchanged;
  - test helpers in `ccrc-doctor.test.ts`: `healthy`, `healthyCodexBox`, `runDoctor`, `codexVerdicts`, `remedyAfter`, `noRunnerBugLine`, `unstub`, `binDir` and `IS_DARWIN`. The doctor's `systemctl` stub answers from `<home>/fixture-unit-<unit>`;
  - `r11 <label> <command…>` and `$SCRATCH` / `$TREE` / `$EVID` / `$CENSUS`, from the sourced `plan3b-env.sh` (Global Constraints).
- **Produces:**
  - **(a)** With no `cmp` on PATH, `_dr_cx_bins` still FAILs a GPT-lane executable that is:
    - missing from the shipped tree: `the shipped tree (<tree>) has no <names>, …`;
    - missing from `$HOME/.local/bin`, or not executable: `<names> missing from $HOME/.local/bin, or not executable — every Codex lane needs all four`.

    Then one WARN names only the files that are present and were not compared: `cmp is not on PATH, so <names> in $HOME/.local/bin could not be compared with the shipped tree — unmeasured, not current`. Its remedy is unchanged: `install diffutils (it ships cmp), then re-run doctor`. With `cmp` present, every byte is the base's.
  - **(b)** This applies when `~/.ccrc/codex` exists, or is a link, and is not a directory this user can read and search: a mode-000 directory, a regular file, or a dangling symlink. `_check_codex` then never answers the empty-population SKIP. It WARNs:
    - `<root> exists and cannot be listed (it is not a directory this user can read and search), so whether any Codex lane state is left under it was not measured — unmeasured, never read as no lane state`;
    - its remedy: `make it a directory this user can list again (ccrc creates it with mode 0700: chmod 700 <root>), or move aside by hand whatever sits there, then re-run doctor; ccrc never changes or removes it for you`.

    The rc is 2, the worst class printed. An ABSENT root still SKIPs, byte for byte.
  - **(c)** Take a `~/.cc-sessions/<sid>.wrapper` that is a regular file but cannot be opened. It counts once into `DRX_UNASKED`, and the first such sid becomes `DRX_UNASKED_SID`. It is never "another lane's" and never live. When the lane's LiteLLM tier is down, `_dr_cx_tiers`' existing WARN therefore fires: `…whether any of this lane's registered sessions is live could not be asked (N unanswered) — unmeasured, not idle`, remedy `ask by hand (systemctl --user status claude-session@<sid>.service); …`. A `.wrapper` in ccd's own writer shape is still read as before. That shape is `_reg_set`'s `printf '%s'`, with NO trailing newline.
  - **For Part B.** The soak gate's "doctor clean" (B4), and every Part B step that reads `ccrc doctor`'s `codex` row, now cannot read "unmeasured" as PASS or SKIP on these three paths.
  - **For Task A7's §21**, one item and one same-line pointer, under `⟦D:codex-doctor-unmeasured-is-not-skip⟧` (reconcile slug list): §21.5 departs from §20.3's "SKIPs … on an empty codex population" (:1007) and from `_dr_cx_bins`' cmp-absent early return.
    - The §21 item text: "**Doctor's `codex` row tells unmeasured from absent (Plan 3b Task A5).** If `~/.ccrc/codex` exists and cannot be listed (a directory this user cannot read and search, or anything that is not a directory), lane state is unmeasured: a WARN, never the empty-population SKIP. With no `cmp` on PATH, only the byte compare is unmeasured. A GPT-lane executable missing from `~/.local/bin` or from the shipped tree still FAILs by name, and the WARN names the files left uncompared. A session `.wrapper` that cannot be read counts as a session that may be on the lane: unanswered, never another lane's, never idle."
    - The pointer goes at the end of spec line 1007, §20.3's `- **Placement and skips.** …` bullet: ` (amended: §21.5, ⟦D:codex-doctor-unmeasured-is-not-skip⟧)`, as Task A7's table writes it.

**Why:**

*(a) The executables row.*
- `_dr_cx_bins` returns straight after its cmp-absent WARN, before the loop that finds a missing or non-executable file. So on a box with no `cmp`, a lane with no `ccrc-codex` reads WARN where it should read FAIL.
  - Only the `cmp -s` line needs `cmp`. The `-f` and `-x` tests are shell built-ins.
- Narrowing the gate to that one line also makes the check agree with its fixer. `_fix_codex` runs only on a FAIL. It already places a missing file without `cmp`, but it could never be reached, because the check never FAILed.
- The WARN now names the files it did not compare, so it never claims more than was skipped. When a file is missing, it is FAILed, not counted as uncompared.

*(b) The left-state scan.*
- When the root exists but cannot be listed, `for d in "$root"/*/` matches nothing. This was measured on a mode-000 directory, a regular file and a dangling link. The empty-population branch then printed `no … lane state is left under <root>`, which is a claim nobody measured.
  - This is `_check_pools`' `pools-unlistable` class.
- Ruling A-5 classes it as a WARN, not a FAIL:
  - nothing ccrc runs reads lane state for an id that is not a codex row;
  - a codex row's own lane rows still measure its own files.
- The existence conjunct (`-e || -L`) is what keeps an absent root an answer and not a finding. Mutation row M5 deletes it, and the two SKIP cases red.

*(c) The session census.*
- `{ IFS= read -r w < "$wf"; } 2>/dev/null` leaves `w=''` when the open fails, and an empty `w` falls through to the same `continue` as another lane's wrapper.
- The read's own exit status cannot tell the two apart. ccd writes every registry field with `printf '%s'` (`_reg_set`), so a real `.wrapper` has no trailing newline. `read` therefore returns 1 on every healthy one, while still setting `w`.
  - A fix keyed on `read`'s status would turn every live session into "unanswered". Row M8 is that fix, and the no-newline control (case c2) is what reds it.
- So the fix asks the one question that does tell them apart: did the redirection fail?
  - It is spelled `if { IFS= read -r w || :; } 2>/dev/null < "$wf"; then …; else …; fi`. Inside the braces, `|| :` makes the compound answer 0 whenever the open succeeded.
  - `2>/dev/null` comes BEFORE the `<`, because redirections apply left to right. That keeps bash's own "Permission denied" line off doctor's output.
- **It must not be written in negated form.** This was measured on bash 5.2.21 while drafting (in a scratch directory, never the tree):
  - `if ! { IFS= read -r w || :; } 2>/dev/null < f` on a mode-000 `f` takes the READABLE branch;
  - the positive form takes the unreadable branch;
  - so row M7 is the negated spelling, and it reds case c1.
- An unreadable wrapper is counted without asking its unit, because which lane it is on is the unknown. The existing remedy, "ask by hand (… status claude-session@<sid>.service); if one is live, start the lane", is then the right one.
- `[ -f "$wf" ]` stays first, so a FIFO at a `.wrapper` path is still never opened (D-2380's class).

- [ ] **Step 0: Base, subjects, census baseline.**

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  git rev-parse HEAD > "$SCRATCH/a5-base"   # this task's base; later blocks read it back from the file
  grep -n '^_dr_cx_bins() {' ccd/ccrc-doctor-checks          # one line
  grep -nF 'for d in "$root"/*/; do' ccd/ccrc-doctor-checks  # one line, inside _check_codex
  grep -n '^_dr_cx_sessions() {' ccd/ccrc-doctor-checks      # one line
  cd server
  r11 a5-0-p1 ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'ccrc doctor: codex, part'
  ```

  Expected:
  - each grep prints exactly one line;
  - vitest prints `Tests  43 passed`, which is part 1's 31 cases plus part 2's 12 at `be93d159`, plus whatever Tasks A1-A4 added to those two describes. Re-derive it and record it;
  - the last line is `census: clean — no unit or link change, 0 fixture processes left; command exit 0`.

  On a box with no `python3` the two describes are skipped (`describeCodex`). Stop and report that, because no case below would run.

- [ ] **Step 1: Write the failing tests.**

  (a) and (b) go in `describeCodex('ccrc doctor: codex, part 1 — …')`.

  For (a), insert the block below directly after the case `it('FAILs a shipped tree that lacks one of them — the compare has no source', …)`. Its closing lines are unique in the file:
  - `    expect(runDoctor(home).stdout).toMatch(/^FAIL codex: the shipped tree \(.*\/ccrc\/ccd\) has no ccgpt-runtime, /m);`
  - `  });`

  ```ts

  // ── Plan 3b Task A5 (a): no cmp costs the byte compare, and nothing else ──
  // A file missing from ~/.local/bin, not executable, or absent from the
  // shipped tree is a fact cmp plays no part in. `_dr_cx_bins` used to return
  // on the cmp-absent WARN before its loop ever ran, so those FAILs were
  // swallowed and `_fix_codex`, which runs only on a FAIL, was unreachable.
  it('with no cmp on PATH, a GPT-lane executable missing from ~/.local/bin still FAILs by name, and only the compare is unmeasured (Plan 3b A-5)', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-nocmp-missing-');
    unstub(home, 'cmp');
    rmSync(join(binDir(home), 'ccrc-codex'));
    const r = runDoctor(home);
    expect(r.stdout, r.stdout).toMatch(/^FAIL codex: ccrc-codex missing from \$HOME\/\.local\/bin, or not executable — every Codex lane needs all four$/m);
    const re = /^WARN codex: cmp is not on PATH, so ccgpt-proxy\.py, ccgpt-usage\.py, ccgpt-runtime in \$HOME\/\.local\/bin could not be compared with the shipped tree — unmeasured, not current$/m;
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toBe('  remedy: install diffutils (it ships cmp), then re-run doctor');
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('with no cmp on PATH, a shipped tree that lacks one still FAILs by name (Plan 3b A-5)', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-nocmp-notree-');
    unstub(home, 'cmp');
    rmSync(join(home, 'ccrc', 'ccd', 'ccgpt-runtime'));
    const r = runDoctor(home);
    expect(r.stdout, r.stdout).toMatch(/^FAIL codex: the shipped tree \(.*\/ccrc\/ccd\) has no ccgpt-runtime, /m);
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('with no cmp on PATH and all four placed, the one codex verdict is the WARN naming all four — never a PASS claiming they match (Plan 3b A-5)', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-nocmp-all-');
    unstub(home, 'cmp');
    const r = runDoctor(home);
    expect(codexVerdicts(r.stdout), r.stdout).toEqual([
      'WARN codex: cmp is not on PATH, so ccgpt-proxy.py, ccgpt-usage.py, ccgpt-runtime, ccrc-codex in $HOME/.local/bin could not be compared with the shipped tree — unmeasured, not current',
    ]);
    noRunnerBugLine(r.stdout, 'codex');
  });
  ```

  For (b), insert this block directly after the case `it('left lane state is a subject even with no Codex lane at all — a WARN, never the empty-population SKIP', …)`. Its first assertion line `    expect(codexVerdicts(r.stdout)).toEqual([expect.stringMatching(/^WARN codex: lane state is left under \S+\/ext-a, /)]);` is unique, so find that line, then insert after the case's closing `  });`:

  ```ts

  // ── Plan 3b Task A5 (b): a lane-state root that cannot be listed ─────────
  // `for d in "$root"/*/` matches nothing on a mode-000 directory, a regular
  // file or a dangling link (measured), so each of them used to fold into the
  // empty-population SKIP. `_check_pools`' `pools-unlistable` class, worded as
  // a WARN by ruling A-5. An ABSENT root still SKIPs: the two SKIP cases above
  // are this pair's control.
  it.skipIf(process.getuid?.() === 0)(
    'an unlistable ~/.ccrc/codex is unmeasured — a WARN, never the empty-population SKIP (Plan 3b A-5)', () => {
      // Skipped as root: root lists any directory, so the fixture cannot be built.
      const home = healthy('ccrc-doctor-codex-root-unlistable-');
      const root = join(home, '.ccrc', 'codex');
      mkdirSync(join(root, 'ext-a'), { recursive: true });
      writeFileSync(join(root, 'ext-a', 'lane.json'), '{}\n');
      chmodSync(root, 0o000);
      try {
        const r = runDoctor(home);
        const re = /^WARN codex: \S+\/\.ccrc\/codex exists and cannot be listed \(it is not a directory this user can read and search\), so whether any Codex lane state is left under it was not measured — unmeasured, never read as no lane state$/m;
        expect(codexVerdicts(r.stdout), r.stdout).toEqual([expect.stringMatching(re)]);
        expect(remedyAfter(r.stdout, re)).toMatch(/^ {2}remedy: make it a directory this user can list again \(ccrc creates it with mode 0700: chmod 700 \S+\/\.ccrc\/codex\), /);
        noRunnerBugLine(r.stdout, 'codex');
      } finally {
        chmodSync(root, 0o700);   // mkTmp's cleanup cannot empty a mode-000 directory
      }
    });

  it('a regular file where ~/.ccrc/codex belongs is unmeasured too — a WARN, never the SKIP, at any uid (Plan 3b A-5)', () => {
    const home = healthy('ccrc-doctor-codex-root-file-');
    writeFileSync(join(home, '.ccrc', 'codex'), 'not a directory\n');
    const r = runDoctor(home);
    expect(codexVerdicts(r.stdout), r.stdout).toEqual([expect.stringMatching(
      /^WARN codex: \S+\/\.ccrc\/codex exists and cannot be listed \(it is not a directory this user can read and search\), /)]);
    noRunnerBugLine(r.stdout, 'codex');
  });
  ```

  (c) goes in `describeCodex('ccrc doctor: codex, part 2 — …')`. Insert the block directly after the case `itLinux('a LiteLLM tier down while the manager gives no word for a lane session WARNs "unmeasured, not idle" — never idle, never live', …)`. Its remedy line is unique: `    expect(remedyAfter(r.stdout, re)).toBe('  remedy: ask by hand (systemctl --user status claude-session@proj-b.service); if one is live, start the lane: ccrc codex start codex-a');`. Insert after the case's closing `  });`:

  ```ts

  // ── Plan 3b Task A5 (c): an unreadable .wrapper is not "another lane's" ──
  // ccd writes every registry field with `printf '%s'` (`_reg_set`): no
  // trailing newline, so `read`'s own status is 1 on EVERY real wrapper.
  // Only a failed REDIRECTION says "could not be read". The second case is
  // the control that pins ccd's own shape, so a fix keyed on read's status reds.
  it.skipIf(IS_DARWIN || process.getuid?.() === 0)(
    'a lane session whose .wrapper cannot be read is unanswered — never another lane\'s, never idle (Plan 3b A-5)', async () => {
      // Skipped as root, who reads a 0000-mode file; and on macOS, for the
      // remedy's systemctl spelling, as the "no word" case above is.
      const home = await healthyCodexBox('ccrc-doctor-codex-wrapper-unreadable-');
      const reg = join(home, '.cc-sessions');
      mkdirSync(reg, { recursive: true });
      writeFileSync(join(reg, 'proj-b.wrapper'), 'codex-a');
      chmodSync(join(reg, 'proj-b.wrapper'), 0o000);
      // Live, to show a live unit does not make an unreadable wrapper "this lane's".
      writeFileSync(join(home, 'fixture-unit-claude-session@proj-b.service'), 'active\n');
      const r = runDoctor(home);
      expect(r.stdout, r.stdout).not.toMatch(/live session\(s\) run on this lane/);
      const re = /^WARN codex: codex-a's LiteLLM tier is not running, and whether any of this lane's registered sessions is live could not be asked \(1 unanswered\) — unmeasured, not idle$/m;
      expect(r.stdout, r.stdout).toMatch(re);
      expect(remedyAfter(r.stdout, re)).toBe('  remedy: ask by hand (systemctl --user status claude-session@proj-b.service); if one is live, start the lane: ccrc codex start codex-a');
      expect(r.stdout).not.toMatch(/Permission denied/);
      noRunnerBugLine(r.stdout, 'codex');
    });

  it("a .wrapper in ccd's own shape — no trailing newline — still reads as this lane's: one live session (Plan 3b A-5)", async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-wrapper-nonl-');
    const reg = join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    writeFileSync(join(reg, 'proj-b.wrapper'), 'codex-a');
    writeFileSync(join(home, 'fixture-unit-claude-session@proj-b.service'), 'active\n');
    const r = runDoctor(home);
    expect(r.stdout, r.stdout).toMatch(/^WARN codex: codex-a's LiteLLM tier is not running while 1 live session\(s\) run on this lane, /m);
    expect(r.stdout).not.toMatch(/could not be asked/);
    noRunnerBugLine(r.stdout, 'codex');
  });
  ```

  The file already imports `chmodSync`, `mkdirSync`, `rmSync`, `writeFileSync`, `join` and `IS_DARWIN` (`grep -n "chmodSync, existsSync" server/test/ccrc-doctor.test.ts`). Add no import.

- [ ] **Step 2: Run the new cases red.**

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"; cd server
  r11 a5-red ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'Plan 3b A-5'
  ```

  Expected as a non-root user on Linux: `Tests  6 failed | 1 passed (7)`, then `census: clean …; command exit 1`. The counts are predicted, not measured; if a case's verdict differs, report it and do not adjust it. Why each case is red:
  - **nocmp-missing:** no FAIL line. Only the base's WARN prints, whose wording differs too.
  - **nocmp-notree:** no FAIL line.
  - **nocmp-all:** the base's WARN says "the GPT-lane executables", not the four names. This one is red by wording only.
  - **root-unlistable** and **root-file:** the empty-population SKIP prints.
  - **wrapper-unreadable:** no WARN, because the unreadable wrapper read as another lane's.
  - **wrapper-nonl** is GREEN. It is the control, and its red is mutation row M8.

  As root, `root-unlistable` and `wrapper-unreadable` are skipped (`4 failed | 1 passed | 2 skipped`). On macOS `wrapper-unreadable` is skipped.

- [ ] **Step 3: Implement (a), `_dr_cx_bins`.** Replace the function from `_dr_cx_bins() {` through its closing `}`. The four lines above it, ending `CODEX_LANE_BINS=(ccgpt-proxy.py ccgpt-usage.py ccgpt-runtime ccrc-codex)`, stay byte for byte. The replacement:

  ```bash
  _dr_cx_bins() {
    local tree="$BOX_TREE_DIR/ccd" bin="$HOME/.local/bin" name have_cmp=1
    local -a notree=() missing=() drift=() uncompared=()
    # Plan 3b Task A5: no `cmp` costs the BYTE compare only. A file missing
    # from the shipped tree or from ~/.local/bin, or not executable, is a fact
    # `cmp` plays no part in, and is FAILed by name whatever PATH holds; the
    # early return this replaced swallowed it, and with it the only FAIL that
    # lets `_fix_codex` (FAIL-only, R-C8) place the file. A file left
    # uncompared is named in its own WARN, never claimed current.
    command -v cmp >/dev/null 2>&1 || have_cmp=0
    for name in "${CODEX_LANE_BINS[@]}"; do
      if [ ! -f "$tree/$name" ]; then notree+=("$name"); continue; fi
      if [ ! -f "$bin/$name" ] || [ ! -x "$bin/$name" ]; then missing+=("$name"); continue; fi
      if [ "$have_cmp" -eq 0 ]; then uncompared+=("$name"); continue; fi
      cmp -s "$tree/$name" "$bin/$name" || drift+=("$name")
    done
    [ "${#notree[@]}" -eq 0 ] || _dr_cx_fail "the shipped tree ($tree) has no $(_dr_cx_join ', ' "${notree[@]}"), so nothing on this box says what the GPT-lane executables should be" \
      "run 'ccrc update' (or 'ccrc install' from a checkout) to place the shipped tree"
    [ "${#missing[@]}" -eq 0 ] || _dr_cx_fail "$(_dr_cx_join ', ' "${missing[@]}") missing from \$HOME/.local/bin, or not executable — every Codex lane needs all four" \
      "run 'ccrc update' (or 'ccrc install' from a checkout): it places them from the shipped tree on every role but server"
    [ "${#drift[@]}" -eq 0 ] || _dr_cx_fail "$(_dr_cx_join ', ' "${drift[@]}") in \$HOME/.local/bin differ from the shipped tree's copies in $tree, so a lane would run bytes this build did not ship" \
      "run 'ccrc update' (or 'ccrc install' from a checkout): it re-places them from the shipped tree"
    [ "${#uncompared[@]}" -eq 0 ] || _dr_cx_warn "cmp is not on PATH, so $(_dr_cx_join ', ' "${uncompared[@]}") in \$HOME/.local/bin could not be compared with the shipped tree — unmeasured, not current" \
      "install diffutils (it ships cmp), then re-run doctor"
    return 0
  }
  ```

  The three `_dr_cx_fail` statements are the base's, byte for byte, in the base's order.

- [ ] **Step 4: Implement (b), the left-state scan.** In `_check_codex`, replace these lines with the block below:
  - `  for d in "$root"/*/; do`
  - the three lines after it, then `  done`

  Stop at that `done`: Task A2's surplus lines below it (its comment, `local -a DR_CODEX_USAGE_SURPLUS=()`, `local surplus_rc=0` and the `_dr_codex_usage_surplus` call) stay untouched. Then, in the empty-population `if` that follows them, old (unique, as Task A2 left it):

  ```bash
    if [ "${#lanes[@]}" -eq 0 ] && [ "${#left[@]}" -eq 0 ] && [ "${#DR_CODEX_USAGE_SURPLUS[@]}" -eq 0 ] && [ "$surplus_rc" -ne 1 ]; then
  ```

  New:

  ```bash
    if [ "${#lanes[@]}" -eq 0 ] && [ "${#left[@]}" -eq 0 ] && [ "${#DR_CODEX_USAGE_SURPLUS[@]}" -eq 0 ] && [ "$surplus_rc" -ne 1 ] && [ "$root_unlistable" -eq 0 ]; then
  ```

  The SKIP branch's body below that `if` is unchanged. The block that replaces the loop:

  ```bash
    # Plan 3b Task A5: a lane-state root that EXISTS (or is a link) and cannot
    # be listed — a directory this user cannot read and search, or anything
    # that is not a directory — is UNMEASURED. The glob below matches nothing
    # either way (measured: a mode-000 directory, a regular file, a dangling
    # link), so without this test such a root folded into the empty-population
    # SKIP, indistinguishable from a box with no lane state (`_check_pools`'
    # `pools-unlistable` class). A WARN by ruling A-5: nothing ccrc runs reads
    # lane state for an id that is not a codex row, and a codex row's own rows
    # below still measure its own files. An ABSENT root is an answer, not a
    # finding: the existence conjunct is what keeps it the SKIP.
    local root_unlistable=0
    if { [ -e "$root" ] || [ -L "$root" ]; } && { [ ! -d "$root" ] || [ ! -r "$root" ] || [ ! -x "$root" ]; }; then
      root_unlistable=1
    else
      for d in "$root"/*/; do
        [ -d "$d" ] || continue
        n="${d%/}"; n="${n##*/}"
        _dr_cx_member "$n" ${lanes[@]+"${lanes[@]}"} || left+=("$n")
      done
    fi
  ```

  Then, directly after the `done` that closes `for n in ${left[@]+"${left[@]}"}; do`, add the block below. That loop's remedy line ends `ccrc never deletes a lane's state on a flip"` and is unique. The `_dr_cx_report …` line stays where it is:

  ```bash
    if [ "$root_unlistable" -eq 1 ]; then
      _dr_cx_warn "$root exists and cannot be listed (it is not a directory this user can read and search), so whether any Codex lane state is left under it was not measured — unmeasured, never read as no lane state" \
        "make it a directory this user can list again (ccrc creates it with mode 0700: chmod 700 $root), or move aside by hand whatever sits there, then re-run doctor; ccrc never changes or removes it for you"
    fi
  ```

- [ ] **Step 5: Implement (c), `_dr_cx_sessions`.**
  - **Header comment.** Its last line is `# opened (D-2380's class).`. Insert these lines directly after it, before `_dr_cx_sessions() {`:

    ```bash
    # AN UNREADABLE `.wrapper` IS NOT ANOTHER LANE'S (Plan 3b Task A5): it is a
    # session that may be on this lane, counted into DRX_UNASKED (the "could not
    # tell" word), never into DRX_LIVE and never skipped. Whether it was READ is
    # the redirection's answer, not `read`'s: ccd writes the field with
    # `printf '%s'` (`_reg_set`), no trailing newline, so `read` returns 1 on
    # every real wrapper while still setting `w`. Spelled POSITIVE on purpose:
    # under bash 5.2 `if ! { …; } 2>/dev/null < f` takes the readable branch when
    # the open fails (measured), and `2>/dev/null` sits before the `<` so bash's
    # own "Permission denied" never reaches doctor's output.
    ```

  - **The loop body.** Replace these four lines with the block below:
    - `    w=''; { IFS= read -r w < "$wf"; } 2>/dev/null`
    - `    [ "$w" = "$id" ] || continue`
    - `    sid="${wf##*/}"; sid="${sid%.wrapper}"`

    That is from the first through the third line after `    [ -f "$wf" ] || continue`. The `case` below them is unchanged.

    ```bash
        sid="${wf##*/}"; sid="${sid%.wrapper}"
        w=''
        if { IFS= read -r w || :; } 2>/dev/null < "$wf"; then
          [ "$w" = "$id" ] || continue
        else
          DRX_UNASKED=$((DRX_UNASKED + 1)); [ -n "$DRX_UNASKED_SID" ] || DRX_UNASKED_SID="$sid"
          continue
        fi
    ```

- [ ] **Step 6: Run green, and run the regressions.** Each command is its own foreground call:

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"; cd server
  r11 a5-green ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'Plan 3b A-5'
  ```

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"; cd server
  r11 a5-reg-parts ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'ccrc doctor: codex, part'
  ```

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"; cd server
  r11 a5-reg-usage ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'ccrc doctor: codex — the usage rows'
  ```

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"; cd server
  r11 a5-reg-fix ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'ccrc doctor --fix: codex'
  ```

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"; cd server
  r11 a5-reg-install ./node_modules/.bin/vitest run test/ccrc-install.test.ts -t 'Plan 3a Task 10'
  ```

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"; cd server
  r11 a5-reg-update ./node_modules/.bin/vitest run test/ccrc-update.test.ts -t 'Plan 3a Task 10'
  ```

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"; cd server
  r11 a5-reg-writer ./node_modules/.bin/vitest run test/modelenv-single-writer.test.ts
  ```

  Expected:
  - `a5-green` is `Tests  7 passed (7)`, or `5 passed | 2 skipped` as root.
  - `a5-reg-parts` is Step 0's count plus 7, all passed.
  - Every other run is green.
  - Each run's last line is `census: clean …; command exit 0`.

  Then, before the commit, run the file whole as the Global Constraints' three complementary parts: `a5-whole-1`, `a5-whole-2` and `a5-whole-3`. The part filtered `'^ccrc doctor: [a-c]'` holds every new case. All three parts are green, and their sum is the file's count before this task plus 7.

- [ ] **Step 7: Mutation table, measured both ways.** First commit the task as WIP:

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  git add -A && git commit -qm 'wip: task A5' && git status --short   # → empty
  ```

  Each row is three calls, with exactly one row in flight:
  1. Back up every file the row edits.
  2. Apply the row's edit, then run its filter through the census under a deadline. A row can make a case wait on nothing, but never block; the deadline is belt and braces.
  3. Restore the file and prove the restore.

  Shown for M1. Every row edits `ccd/ccrc-doctor-checks` only.

  ```bash
  # 7a: one backup per file the row edits
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  row=a5-M1; files='ccd/ccrc-doctor-checks'
  mkdir -p "$SCRATCH/mut/$row"
  for f in $files; do cp -- "$f" "$SCRATCH/mut/$row/${f//\//__}"; done
  ls "$SCRATCH/mut/$row"   # → one backup per file
  ```

  Apply the row's edit to the working tree, then:

  ```bash
  # 7b: the row's filter, through the census, under a deadline
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"; cd server
  r11 a5-7-M1 timeout -k 10 540 ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'Plan 3b A-5'   # → the Red column's count failed
  ```

  ```bash
  # 7c: restore from the backup, and prove it
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  row=a5-M1; files='ccd/ccrc-doctor-checks'
  for f in $files; do cp -- "$SCRATCH/mut/$row/${f//\//__}" "$f"; done
  git diff --quiet -- $files && echo "restored $row"   # → restored a5-M1
  ```

  Every row's filter is `-t 'Plan 3b A-5'` except M5, whose filter is `-t 'SKIPs a roster with no Codex lane|SKIPs a box with no roster file'`. The counts are for a non-root Linux user, and are predicted. If a row does not red, report it, and never add code to force it (D-3152). If a restore does not print `restored`, the table stops.

  | Row | `ccd/ccrc-doctor-checks`: mutation (old → new) | Red |
  |---|---|---|
  | M1 | (a) directly after `command -v cmp >/dev/null 2>&1 \|\| have_cmp=0`, insert `[ "$have_cmp" -eq 1 ] \|\| return 0` (the base's early return) | 3: nocmp-missing, nocmp-notree, nocmp-all |
  | M2 | (a) delete `if [ "$have_cmp" -eq 0 ]; then uncompared+=("$name"); continue; fi` (`cmp -s` then exits 127, and every present file reads as drifted) | 2: nocmp-missing (no WARN, plus an extra "differ" FAIL) and nocmp-all |
  | M3 | (a) delete the `[ "${#uncompared[@]}" -eq 0 ] \|\| _dr_cx_warn "cmp is not on PATH, …"` statement (both of its lines) | 2: nocmp-missing; nocmp-all reads `PASS codex: … the four GPT-lane executables match the shipped tree`, a PASS nothing measured |
  | M4 | (b) `if { [ -e "$root" ] \|\| [ -L "$root" ]; } && { … }; then` → `if false; then` | 2: root-unlistable, root-file (1 as root) |
  | M5 | (b) `{ [ -e "$root" ] \|\| [ -L "$root" ]; } && ` deleted, so an absent root reads as unlistable | 2: "SKIPs a roster with no Codex lane — never a PASS naming no lane" and "SKIPs a box with no roster file at all — …" (an absent root is an answer, not a finding) |
  | M6 | (b) ` && [ "$root_unlistable" -eq 0 ]` deleted from the empty-population `if` | 2: root-unlistable, root-file |
  | M7 | (c) the new `if/else/fi` → the negated spelling: `if ! { IFS= read -r w \|\| :; } 2>/dev/null < "$wf"; then` + the two unasked lines + `continue` + `fi`, then `[ "$w" = "$id" ] \|\| continue` | 1: wrapper-unreadable (bash 5.2's negated redirection failure takes the readable branch, measured) |
  | M8 | (c) `if { IFS= read -r w \|\| :; } 2>/dev/null < "$wf"; then` → `if IFS= read -r w 2>/dev/null < "$wf"; then` (keyed on `read`'s status) | 1: wrapper-nonl (ccd's newline-less wrapper reads as unanswered, not live) |
  | M9 | (c) the new `if/else/fi` → the base's `{ IFS= read -r w < "$wf"; } 2>/dev/null` then `[ "$w" = "$id" ] \|\| continue` | 1: wrapper-unreadable |

  Under every row, the control cases outside the row's Red column stay green.

- [ ] **Step 8: Commit.**

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  BASE="$(cat "$SCRATCH/a5-base")"
  git status --short   # → empty: every row restored, and the WIP commit holds the task
  git commit --amend -q -F - <<'EOF'
  fix(doctor): codex rows tell unmeasured from absent — no cmp, an unlistable lane root, an unreadable .wrapper (Plan 3b Task A5)

  With no cmp on PATH, _dr_cx_bins now costs only the byte compare: a missing,
  non-executable or tree-absent GPT-lane executable still FAILs by name, and the
  WARN names the files it left uncompared. An existing ~/.ccrc/codex that cannot
  be listed is a WARN, never the empty-population SKIP. An unreadable session
  .wrapper counts as unanswered, never as another lane's; ccd's own
  newline-less wrapper still reads as this lane's.

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git log -1 --format='%an <%ae> | %cn <%ce>'   # → the worktree's noreply identity only
  git diff --name-only "$BASE" HEAD | sort      # → ccd/ccrc-doctor-checks server/test/ccrc-doctor.test.ts
  ```

### Task A6: every models lane-file read is FIFO-safe, through one readRegular

> Ruling A-6 absorbs Plan 3a's last final-review follow-up: "the models writer path still opens `settings.json` by name … before Plan 3b relies on `doctor --fix` for a codex lane". Three reads open a file by name without asking its type first:
> - MF-2's five type-tested reads left out `mergeSettingsEnv`'s and `clearSettingsEnv`'s reads of `settings.json`, in `shared/modelenv.mjs`;
> - every op's first read, `readRoster`, in `deploy/models-op.mjs`, opens by name too.
>
> A FIFO at any of these paths blocks the open forever. At the settings path, that blocks `_fix_codex`'s re-render (`materialise` without `--check`) and every `ccrc models` mutation. At the roster path, it blocks every `ccrc models` verb. On a regular file the new read is byte-identical, and every live file is regular, so the merge changes nothing that runs.

**Files:**
- Modify `shared/modelenv.mjs`:
  - its `node:fs` import (`grep -n "^import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';" shared/modelenv.mjs`; :33 at `be93d159`);
  - one new export, `readRegular`, directly after the `ModelEnvInvalid` class;
  - one line in `mergeSettingsEnv` (:251) and one in `clearSettingsEnv` (:328). Both read `    const text = readFileSync(settingsPath, 'utf8');`, so each is located by the line above it, below.
- Modify `shared/modelenv.d.mts`: one declaration after `export declare class ModelEnvInvalid extends Error {}`.
- Modify `deploy/models-op.mjs`:
  - its `node:fs` import (:57) drops `statSync`;
  - its `../shared/modelenv.mjs` import (:64-66) gains `readRegular`;
  - the private `readRegular` and its docstring (:155-169) become a pointer comment;
  - `readRoster`'s read (:176).
- Modify `server/test/models-op.test.ts`: four cases in `describe('a FIFO at a lane file\'s path is that read\'s unreadable answer, never a block (MF-2, F2)', …)`.
- Modify `server/test/single-definition.test.ts`: one case in `describe('the model files, and who reads each one', …)`.
- **Not modified:**
  - the tmp + rename write path in `mergeSettingsEnv` / `clearSettingsEnv`: `writeFileSync(tmp, …)`, `renameSync(tmp, settingsPath)` and the `unlinkSync(tmp)` catch. These are what the EISDIR pins exercise;
  - `readRoster`'s two-way `roster-absent` / `roster-unreadable` split, and every error code;
  - `ccd/ccrc`, which never spells `writeFileSync` (the modelenv single-writer scan);
  - `deploy/account-op.mjs`' own roster read, which ruling A-6 does not name.

**Interfaces:**
- **Consumes:**
  - the MF-2 describe's own helpers in `models-op.test.ts`: `fifo(p)`, `bounded(...args)` (spawnSync with `timeout: BOUND_MS`, 10 s, asserting `signal === null` before parsing), `init()`, `settingsPath()` and `beforeEach`'s `CODEX_ROW` roster;
  - the module helpers `rosterPath`, `regPath`, `op` and `home`;
  - in `single-definition.test.ts`: `MODELS_CORPUS`, `codeOf`, `rel` and `ccrcRoot`;
  - `r11` and `plan3b-env.sh` (Global Constraints).
- **Produces:**
  - **`readRegular(p: string): string`,** exported from `shared/modelenv.mjs` and declared in `shared/modelenv.d.mts`. It answers:
    - `statSync(p).isFile()` false: throws `Error('not a regular file')` with `code: 'ENOTREG'`;
    - absent path or dangling link: throws `ENOENT`, as the bare read did;
    - otherwise: the file's text, read `utf8`.

    It is the ONE definition. `deploy/models-op.mjs` imports it, and `single-definition.test.ts` pins one holder.
  - **A FIFO at a lane's `settings.json`.**
    - `materialise`, which also covers `init`'s own materialise and `_fix_codex`'s re-render, answers exit 1, `{"ok":false,"error":"settings-unwritable","detail":"<settings path> could not be read: not a regular file. Nothing was written."}`. It writes nothing after the refused merge.
    - `rm` reaps its four model files first, as it always has (its unlink loop runs before its settings step, by design). It then answers exit 1 with the same `settings-unwritable` detail.
    - Neither blocks.
  - **A FIFO at the roster path** answers every op with exit 1, `roster-unreadable`, detail `<roster> exists and could not be read: not a regular file. Regenerating it will not help; fix its permissions.`, and does not block.
  - **A directory at `settings.json`** keeps its code, `settings-unwritable`. Its detail now reads `not a regular file` where it read `EISDIR: illegal operation on a directory, read`. This is a failure-path wording change, and nothing pins the old wording.
  - **For Part B.** `ccrc doctor --fix`'s codex re-render and `ccrc models <lane> rm` (B-8's rollback for a lane that had no registry) can no longer hang on a non-regular file at these paths.
  - **For Task A7's §21**, one item and one same-line pointer. No deviation slug: this is conformance to §20.3's own rule ("every lane file … is type-tested first"), so it mints no number.
    - The §21 item text: "**The models writer path and the roster read are type-tested too (Plan 3b Task A6).** `readRegular` is one exported function in `shared/modelenv.mjs`, and `deploy/models-op.mjs` imports it. `mergeSettingsEnv` and `clearSettingsEnv` read the lane's `settings.json` through it, so a FIFO there is `settings-unwritable` (`… could not be read: not a regular file. Nothing was written.`), never a block, and `ccrc doctor --fix`'s re-render cannot hang on one. `readRoster`, every op's first read, answers a FIFO with `roster-unreadable`. The tmp + rename write path is unchanged."
    - The pointer goes at the end of spec line 1024, §20.3's `- **Every lane file `deploy/models-op.mjs` reads is type-tested first**, …` bullet: ` (amended: §21.6)`, as Task A7's table writes it (A6 mints nothing). Plan 3b falsifies that line's last sentence, "The writer path is unchanged: … still open the lane's `settings.json` by name, so a FIFO there can still block `_fix_codex`'s re-render; that is a carried follow-up", so the line must carry the pointer.

**Why:**
- *Why one definition, in `shared/modelenv.mjs`.* The two settings reads live in `shared/modelenv.mjs`. That module cannot import from `deploy/`, and `deploy/models-op.mjs` already imports from it. So the helper moves down to the shared module, and the op imports it.
  - Plan 3a's open question (two copies or one) is settled by ruling A-6: one.
  - `single-definition.test.ts`' main scan filters `.tsx?`, so it cannot see the `.mjs` pair. The new case is in `the model files, and who reads each one`, whose own `MODELS_CORPUS` walks `shared/` and `deploy/` `.mjs` and `.mts` files.
  - The pin matches a DEFINITION (`^(export )?function readRegular(`), not the bare name. Otherwise `modelenv.d.mts`' `export declare function readRegular(` and every call site would be holders too.
  - `shared/modelenv.mjs` is deploy-side and already imports `node:fs`; the PWA does not bundle it. So `statSync` is not an L0 violation.
- *Why the codes do not change.*
  - Each read's existing non-`ENOENT` arm already turns any other failure into that read's unreadable answer: `ModelEnvInvalid('… could not be read: …')` → `settings-unwritable`, and `roster-unreadable`.
  - `ENOTREG` falls into exactly that arm. So no caller of `readRoster`'s `{err}` shape, and no `.error` reader in `ccd/ccrc`, sees a new word.
  - `statSync` follows links, as bash `-f` does. A symlinked settings file or roster reads as before, and a dangling link is still `ENOENT`, meaning absent.
  - Mutation row M6 is the "unreadable is not absent" half. Read as absent, a FIFO settings file would be replaced by a rename, and the case reds.
- *Why the EISDIR pins keep their meaning.* `a failed materialise unlinks its own tmp, run repeatedly` and `a failed lane.json write unlinks its own tmp, run repeatedly` pin a RENAME onto a directory. That is the write path, and this task does not touch it. The read side's directory answer keeps its code, and the control case added here pins that.
- *Why every new FIFO case is self-expiring.* Each spawn goes through `bounded()`. Before the fix, the child blocks in `open(2)`, is ended by spawnSync's own `timeout` at 10 s, and `signal` reds the case, not the suite. That was measured by MF-2 on the same helper. The op spawns nothing, so the signalled child is the process that blocks, and nothing outlives the census. Mutation runs carry an outer `timeout` as well.

- [ ] **Step 0: Base, subjects, census baseline.**

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  git rev-parse HEAD > "$SCRATCH/a6-base"
  grep -n "^function readRegular(p) {" deploy/models-op.mjs                  # one line (the private copy, to be removed)
  grep -n "    raw = readFileSync(file, 'utf8');" deploy/models-op.mjs      # one line, inside readRoster
  grep -c "    const text = readFileSync(settingsPath, 'utf8');" shared/modelenv.mjs   # → 2 (merge, clear)
  grep -rn "readRegular" shared deploy server/src agent/src pwa/src | grep -c 'function readRegular('   # → 1
  cd server
  r11 a6-0 ./node_modules/.bin/vitest run test/models-op.test.ts
  ```

  Expected:
  - the greps answer one line, one line, `2` and `1`;
  - vitest is `Tests  120 passed (120)` at `be93d159`, plus anything Tasks A1-A4 added. Re-derive and record it;
  - the last line is `census: clean … command exit 0`.

- [ ] **Step 1: Write the failing tests.**

  (a) `server/test/models-op.test.ts`. The MF-2 describe's last case is `it('litellm without --commit, with a FIFO --out, reads no previous rendering: changed:true, and writes nothing', …)`. Find its closing lines:
  - `    expect(fs.existsSync(`${out}.prev`)).toBe(false);`
  - `  }, 20_000);`

  Directly after them, and before the describe's closing `});`, add:

  ```ts

  // ── Plan 3b Task A6: the writer path and the roster read ────────────────
  // `mergeSettingsEnv` and `clearSettingsEnv` (`shared/modelenv.mjs`) read the
  // lane's settings.json, and `readRoster` is every op's first read: each
  // opened BY NAME, so a FIFO there blocked `materialise` (and with it
  // `_fix_codex`'s re-render), `rm`, and every verb. Each now reads through
  // the one `readRegular`, and a FIFO gets that read's EXISTING answer.
  it('materialise with a FIFO settings.json answers settings-unwritable, and writes nothing after the refused merge (Plan 3b A-6)', () => {
    init();
    const tsv = path.join(home, '.ccrc', 'models', `${CODEX_ROW.id}.classes.tsv`);
    const tsvBefore = fs.statSync(tsv).mtimeMs;
    fifo(settingsPath());
    const r = bounded('materialise', '--file', rosterPath(), '--id', CODEX_ROW.id);
    expect(r.code, r.stdout).toBe(1);
    expect(r.body['error']).toBe('settings-unwritable');
    expect(r.body['detail']).toMatch(/settings\.json could not be read: not a regular file\. Nothing was written\.$/);
    expect(fs.statSync(settingsPath()).isFIFO(), 'materialise replaced the FIFO it refused').toBe(true);
    expect(fs.statSync(tsv).mtimeMs, 'materialise wrote the TSV after refusing the settings merge').toBe(tsvBefore);
  }, 20_000);

  it('rm with a FIFO settings.json reaps the lane files, then answers settings-unwritable — never a block (Plan 3b A-6)', () => {
    init();
    fifo(settingsPath());
    const r = bounded('rm', '--file', rosterPath(), '--id', CODEX_ROW.id);
    expect(r.code, r.stdout).toBe(1);
    expect(r.body['error']).toBe('settings-unwritable');
    expect(r.body['detail']).toMatch(/settings\.json could not be read: not a regular file\. Nothing was written\.$/);
    // `rm`'s unlink loop runs BEFORE its settings step, by design (an orphan
    // has no settings to clear), so the model files are already reaped.
    expect(fs.existsSync(regPath(CODEX_ROW.id))).toBe(false);
    expect(fs.statSync(settingsPath()).isFIFO(), 'rm replaced the FIFO it refused').toBe(true);
  }, 20_000);

  it('every op with a FIFO roster answers roster-unreadable — never a block (Plan 3b A-6)', () => {
    fifo(rosterPath());
    const r = bounded('lanes', '--file', rosterPath());
    expect(r.code, r.stdout).toBe(1);
    expect(r.body['error']).toBe('roster-unreadable');
    expect(r.body['detail']).toMatch(/accounts\.json exists and could not be read: not a regular file\. /);
    expect(fs.statSync(rosterPath()).isFIFO()).toBe(true);
  }, 20_000);

  // The control: a DIRECTORY at settings.json never blocked (EISDIR is
  // immediate), and its code must not move. Green before this task and after.
  it('materialise with a DIRECTORY at settings.json still answers settings-unwritable (Plan 3b A-6)', () => {
    init();
    fs.rmSync(settingsPath());
    fs.mkdirSync(settingsPath());
    const r = bounded('materialise', '--file', rosterPath(), '--id', CODEX_ROW.id);
    expect(r.code, r.stdout).toBe(1);
    expect(r.body['error']).toBe('settings-unwritable');
    expect(r.body['detail']).toMatch(/settings\.json could not be read: /);
    expect(fs.statSync(settingsPath()).isDirectory()).toBe(true);
  }, 20_000);
  ```

  (b) `server/test/single-definition.test.ts`, in `describe('the model files, and who reads each one', …)`. Insert directly before `  it('the four class names are enumerated only where a walk needs the sequence', () => {`, which is unique:

  ```ts
  it('a lane file\'s type-tested read is DEFINED once, in shared/modelenv.mjs, and deploy/models-op.mjs imports it (Plan 3b A-6)', () => {
    // A definition, not a mention: `shared/modelenv.d.mts` declares it
    // (`export declare function …`) and every reader calls it, and neither is
    // a second opinion about what "a lane file's read" means. Two copies were
    // what Plan 3a's MF-2 left (one per module), and ruling A-6 makes it one.
    const defines = MODELS_CORPUS
      .filter((f) => /^(?:export\s+)?function\s+readRegular\s*\(/m.test(codeOf(f)))
      .map(rel).sort();
    expect(defines).toEqual(['shared/modelenv.mjs']);
    expect(readFileSync(path.join(ccrcRoot, 'deploy', 'models-op.mjs'), 'utf8'))
      .toMatch(/import\s*\{[^}]*\breadRegular\b[^}]*\}\s*from\s*'\.\.\/shared\/modelenv\.mjs'/);
  });

  ```

- [ ] **Step 2: Run the new cases red.** Each command is its own call:

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"; cd server
  r11 a6-red-op ./node_modules/.bin/vitest run test/models-op.test.ts -t 'Plan 3b A-6'
  ```

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"; cd server
  r11 a6-red-sd ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'readRegular'
  ```

  Expected (predicted; report a difference, never adjust a case):
  - **`a6-red-op`:** `Tests  3 failed | 1 passed (4)`.
    - Each of the three FIFO cases reds BY DEADLINE: `models-op <op> did not exit by itself: it blocked on the FIFO and was ended at the 10 s bound`. The child's `signal` is `SIGTERM`.
    - The directory control is green.
    - The census line is `census: clean …; command exit 1`. Any `census: FAIL` here is attributed by the Global Constraints' rule before it counts.
  - **`a6-red-sd`:** `Tests  1 failed | … skipped`. `defines` is `['deploy/models-op.mjs']`, and the import assertion fails.

- [ ] **Step 3: Implement — `shared/modelenv.mjs` and its declaration.**
  - **(a) The import.** `import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';` becomes:

    ```js
    import { readFileSync, writeFileSync, renameSync, unlinkSync, statSync } from 'node:fs';
    ```

  - **(b) The export.** Insert directly after the `ModelEnvInvalid` class. Its two lines are unique: `  constructor(message) { super(message); this.name = 'ModelEnvInvalid'; }` and `}`.

    ```js

    /** A LANE FILE's read, type-tested first: the ONE definition. Plan 3a's
     *  final fix wave (MF-2) wrote it in `deploy/models-op.mjs`; Plan 3b Task A6
     *  moved it here so this module's own two `settings.json` reads use it too,
     *  and `deploy/models-op.mjs` imports it (`single-definition.test.ts` pins
     *  one definition). `readFileSync` opens BY NAME with no regard for TYPE: a
     *  FIFO with no writer blocks INSIDE the open, so no `catch` ever runs, and
     *  `ccrc doctor`'s `_check_codex` and `--fix`'s `_fix_codex`, which call the
     *  op with no deadline, hang whole. So the type is asked first. `statSync`
     *  FOLLOWS links, as bash `-f` does: a symlink to a regular file reads as
     *  before, and an absent path or a dangling link throws ENOENT exactly as
     *  the bare read did. Anything that is not a regular file throws `ENOTREG`,
     *  which every caller's existing non-ENOENT arm answers as that read's own
     *  unreadable answer, never a block. */
    export function readRegular(p) {
      if (!statSync(p).isFile()) throw Object.assign(new Error('not a regular file'), { code: 'ENOTREG' });
      return readFileSync(p, 'utf8');
    }
    ```

  - **(c) `mergeSettingsEnv`'s read.** Replace this block:

    ```js
      let existed = false;
      try {
        const text = readFileSync(settingsPath, 'utf8');
    ```

    with this block:

    ```js
      let existed = false;
      try {
        // Type-tested (Plan 3b Task A6): a FIFO is "could not be read", never a block.
        const text = readRegular(settingsPath);
    ```

  - **(d) `clearSettingsEnv`'s read.** Replace this block:

    ```js
      let json;
      try {
        const text = readFileSync(settingsPath, 'utf8');
    ```

    with this block:

    ```js
      let json;
      try {
        // Type-tested (Plan 3b Task A6): a FIFO is "could not be read", never a block.
        const text = readRegular(settingsPath);
    ```

  - **(e) `shared/modelenv.d.mts`.** Directly after `export declare class ModelEnvInvalid extends Error {}`, add:

    ```ts
    /** A lane file's text, type-tested first: throws ENOTREG for anything that is
     *  not a regular file (a FIFO above all), ENOENT for an absent path. */
    export declare function readRegular(p: string): string;
    ```

- [ ] **Step 4: Implement — `deploy/models-op.mjs`.**
  - **(a) The `node:fs` import.** `statSync` has no other use once the private copy goes (`grep -n statSync deploy/models-op.mjs`). This import line:

    ```js
    import { readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync, statSync } from 'node:fs';
    ```

    becomes:

    ```js
    import { readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync } from 'node:fs';
    ```

  - **(b) The modelenv import.** This import:

    ```js
    import {
      MODEL_ENV_KEYS, ModelEnvInvalid, classesTsv, clearSettingsEnv, effortFile, mergeSettingsEnv, modelEnvBlock,
    } from '../shared/modelenv.mjs';
    ```

    becomes:

    ```js
    import {
      MODEL_ENV_KEYS, ModelEnvInvalid, classesTsv, clearSettingsEnv, effortFile, mergeSettingsEnv, modelEnvBlock,
      readRegular,
    } from '../shared/modelenv.mjs';
    ```

  - **(c) The private copy.** Replace the docstring that begins `/** A LANE FILE's read, type-tested first (Plan 3a final fix wave, F2 —` and the function under it, through the function's closing `}`, with:

    ```js
    /** A LANE FILE's read is `readRegular`, imported from `shared/modelenv.mjs`:
     *  Plan 3a's final fix wave (MF-2, F2 — D-2380's class) wrote it here, and
     *  Plan 3b Task A6 moved it there so `mergeSettingsEnv` and
     *  `clearSettingsEnv` read through the same type test. Its docstring there
     *  says why a FIFO must never be opened by name. */
    ```

    The five existing call sites (`readCatalogue`, `readRegistry`, the show-path settings read, `materialiseCheck` and the litellm previous-render read) are unchanged and now resolve to the import.
  - **(d) `readRoster`.** This block:

    ```js
    /** THE ONE ROSTER READ, and it is READ-ONLY. Absent and unreadable are two
     *  codes: the remedies differ. */
    function readRoster(file) {
      let raw;
      try {
        raw = readFileSync(file, 'utf8');
    ```

    becomes:

    ```js
    /** THE ONE ROSTER READ, and it is READ-ONLY. Absent and unreadable are two
     *  codes: the remedies differ. Type-tested (`readRegular`, Plan 3b Task A6):
     *  every op reads the roster before anything else, so a FIFO here used to
     *  hang every verb; it is `roster-unreadable` now, through the same arm. */
    function readRoster(file) {
      let raw;
      try {
        raw = readRegular(file);
    ```

- [ ] **Step 5: Run green, the EISDIR pins and the regressions.** Each command is its own foreground call:

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"; cd server
  r11 a6-green-op ./node_modules/.bin/vitest run test/models-op.test.ts
  ```

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"; cd server
  r11 a6-eisdir ./node_modules/.bin/vitest run test/models-op.test.ts -t 'unlinks its own tmp'
  ```

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"; cd server
  r11 a6-green-sd ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'the model files, and who reads each one'
  ```

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"; cd server
  r11 a6-modelenv ./node_modules/.bin/vitest run test/modelenv.test.ts test/modelenv-single-writer.test.ts test/modelenv-types.test.ts
  ```

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"; cd server
  r11 a6-ccrc-models ./node_modules/.bin/vitest run test/ccrc-models.test.ts
  ```

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"; cd server
  r11 a6-doctor-fifo ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t 'never a hang'
  ```

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"; cd server
  r11 a6-typecheck ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
  ```

  Expected:
  - `a6-green-op` is Step 0's count plus 4, all passed.
  - `a6-eisdir` is `Tests  2 passed`: both rename-failure pins, unchanged.
  - Every other run is green.
  - Each run's last line is `census: clean …; command exit 0`.

  `modelenv-single-writer`'s holder list is still `['shared/modelenv.mjs']`. `deploy/models-op.mjs` still imports `mergeSettingsEnv` and `clearSettingsEnv`, so its `importsHelper` exemption holds. `typecheck-tests` is listed among the known load flakes; if it reds, re-run it in isolation before calling it real.

- [ ] **Step 6: Mutation table, measured both ways.** First commit the task as WIP:

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  git add -A && git commit -qm 'wip: task A6' && git status --short   # → empty
  ```

  Each row is Task A5 Step 7's three calls: back up every file the row edits, apply the edit and run, then restore and prove it with `git diff --quiet`. Change only the row id, the `files`, the suite and the filter. Every run is `r11 a6-6-<row> timeout -k 10 540 ./node_modules/.bin/vitest run <suite> -t '<filter>'`. A blocked case is ended by `bounded()`'s 10 s bound, and the outer `timeout` is belt and braces.

  | Row | Files: mutation (old → new) | Suite `-t` filter | Red |
  |---|---|---|---|
  | M1 | `shared/modelenv.mjs`: in `mergeSettingsEnv`, `const text = readRegular(settingsPath);` → `const text = readFileSync(settingsPath, 'utf8');` | models-op `'Plan 3b A-6'` | 1: the materialise FIFO case, by deadline |
  | M2 | `shared/modelenv.mjs`: the same edit in `clearSettingsEnv` | models-op `'Plan 3b A-6'` | 1: the rm FIFO case, by deadline |
  | M3 | `deploy/models-op.mjs`: in `readRoster`, `raw = readRegular(file);` → `raw = readFileSync(file, 'utf8');` | models-op `'Plan 3b A-6'` | 1: the roster FIFO case, by deadline |
  | M4 | `shared/modelenv.mjs`: delete `readRegular`'s `if (!statSync(p).isFile()) throw …;` line | models-op `'FIFO'` | 8: all five MF-2 cases and the three new FIFO cases, each by deadline. This proves models-op's five MF-2 reads now go through the shared helper |
  | M5 | `deploy/models-op.mjs`: delete `  readRegular,` from the modelenv import, and insert `function readRegular(p) { return readFileSync(p, 'utf8'); }` directly below the pointer comment (a second, untyped copy) | single-definition `'readRegular'`, then models-op `'FIFO'` (two runs, one restore) | 1 (the pin); then 6: the five MF-2 cases and the roster case, by deadline. The two settings cases stay green, because they read through the shared helper |
  | M6 | `shared/modelenv.mjs`: in `mergeSettingsEnv`'s catch, `if (e.code !== 'ENOENT') {` → `if (e.code !== 'ENOENT' && e.code !== 'ENOTREG') {` (a FIFO read as absent) | models-op `'Plan 3b A-6'` | 1: the materialise FIFO case. The rename replaces the FIFO, and the op exits 0 |

  Under every row, the directory control and the two EISDIR pins stay green. Confirm that by adding `\|unlinks its own tmp` to M1's filter once. If a row does not red, report it, and never add code to force it.

- [ ] **Step 7: Commit.**

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  BASE="$(cat "$SCRATCH/a6-base")"
  git status --short   # → empty
  git commit --amend -q -F - <<'EOF'
  fix(models): every lane-file read is FIFO-safe through one readRegular — settings merge, settings clear, roster (Plan 3b Task A6)

  readRegular moves from deploy/models-op.mjs to shared/modelenv.mjs as the one
  exported definition; models-op imports it. mergeSettingsEnv and
  clearSettingsEnv read the lane's settings.json through it (a FIFO is
  settings-unwritable, never a block, so doctor --fix's re-render cannot hang),
  and readRoster does too (a FIFO is roster-unreadable). Codes, the tmp + rename
  write path and the EISDIR rename pins are unchanged.

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git log -1 --format='%an <%ae> | %cn <%ce>'   # → the worktree's noreply identity only
  git diff --name-only "$BASE" HEAD | sort
  # → deploy/models-op.mjs server/test/models-op.test.ts server/test/single-definition.test.ts shared/modelenv.d.mts shared/modelenv.mjs
  ```

### Task A7: spec §21 Amendments (Plan 3b), the Part A gate, and the Part A PR

**Files:**
- Modify: `docs/superpowers/specs/2026-09-20-gpt-lane-ownership-design.md`.
  - Append `## 21. Amendments (Plan 3b)` after line 1111, the file's last line at `be93d159`.
  - Make eight same-line pointer edits above it, and nothing else above it (ruling A-7; Plan 3a's R9; reconcile ruling R4; controller ruling NC-1). Those edits are on lines 497, 982, 993, 1007, 1024, 1035, 1039 and 1042 at `be93d159`, re-derived by locator in Step 2.
- Modify: nothing else that is tracked. `ccd/`, `shared/`, `deploy/`, `server/`, `agent/` and `pwa/` are A1–A6's; this task only reads them.
- Test (read-only): the doc guards (`deviation-refs.test.ts`, `dtbd.test.ts`, `topology-clean.test.ts`, `single-definition.test.ts`) and the Part A merged-tree gate:
  - 12 server shards;
  - `ccrc-doctor.test.ts` in three parts;
  - the agent and pwa suites;
  - three `tsc --noEmit` runs and `typecheck-tests.test.ts`;
  - `session-hook.test.ts -t "compaction card"`;
  - the census gate over every run.
- Scratch only, never committed, all under `$SCRATCH`:
  - `a7-base`, this task's base;
  - `a7-pointers.cjs`, the pointer edits;
  - `a7-r9.cjs` and the `a7-spec.*` files it writes, the proof;
  - `a7-m*.md`, the proof's mutants, removed by path in Step 4;
  - `a7-pr-body.md`, the PR body;
  - `a7-gate-hits`.

**Interfaces:**
- **Consumes:**
  - Tasks A1–A6's commits, each on this workspace's branch;
  - the Global Constraints' `plan3b-env.sh`, which sets `$SCRATCH`, `$TREE`, `$CENSUS` and `$EVID` and leaves the shell at the worktree root;
  - the controller's substitution of every `⟦D:…⟧` in this plan, made before this task starts.
- **Produces:**
  - spec §21.1–§21.12. The numbering is fixed here, and any task or comment that cites "§21.N" means these;
  - the eight pointers;
  - one docs commit;
  - the gate's evidence under `$EVID/a7-*`;
  - the Part A PR.

**Why:**
- **Part B argues from the spec.** Six of its sentences stop being true once A1–A6 land:
  - §20.1 says an undecidable row falls to "every other row";
  - §20.3 says the codex check SKIPs on an empty codex population, which a surplus ccrc usage timer or an unlistable lane-state root no longer is;
  - §20.4's withdrawal is counted on an exit code;
  - §20.4 says `_check_codex` WARNs beside a foreign instance with the operator's own disable as the remedy, which is the withheld case's remedy only, once both publishers can be armed;
  - §20.4 says account removal "still completes";
  - §20.3 calls the writer path's FIFO a carried follow-up.

  Two sentences Part B relies on claim too much: `:497`'s "nothing reads an OAuth file", and `:993`'s "no device flow outside `ccrc codex login`". Plan 3a's "Spec wording minors" follow-up gives both to Plan 3b. `:1082`, and the order of D-3721's sentences, stay with Plan 4's docs.
- **Three Part B facts the spec does not yet say:**
  - the move aside touches the lane's entry file only;
  - the other repository's stop always names its lane;
  - a per-box update pause is API-only.

  §15 step 3 and §20.9 are consistent with all three but name none, so each is stated once, in §21.9–§21.11, as amendment prose. None contradicts a sentence above, so none carries a pointer. §21.9 also records the one order departure, the entry file's move before the roster flip (⟦D:entry-moved-aside-not-the-launcher⟧).
- **Append, never insert.** The tree cites this spec by line number:
  - `ccd/ccgpt-usage.py` cites §5.4 line 333;
  - `ccd/ccrc-models-probe` cites about line 497;
  - the Plan 2a plan cites lines 497 and 698.

  So every hunk above §21 must be a same-line pointer. Step 4 proves it with Plan 3a Task 11's method: the base blob is diffed against the worktree file, hunk by hunk. The proof was measured while drafting, on a scratch copy of the spec at `be93d159` with this section's text appended.
- **The gate runs on the merged tree.** Part A's merge auto-releases, and both boxes follow dev, so the merge is a rollout. What gets merged is `main` plus this branch, and that is what the gate runs.

- [ ] **Step 0: Record the base, and confirm A1–A6 are in and the cut holds.**

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
git fetch origin main
git merge-base origin/main HEAD > "$SCRATCH/a7-base"
BASE="$(cat "$SCRATCH/a7-base")"
SPEC=docs/superpowers/specs/2026-09-20-gpt-lane-ownership-design.md
PLAN=docs/superpowers/plans/2026-10-05-gpt-lane-ownership-3b-the-cutover.md
git log --oneline "$BASE"..HEAD                                   # Tasks A1–A6, each its own commit
git diff --quiet "$BASE" -- "$SPEC" && echo SPEC-AT-BASE           # nothing has touched the spec yet
git show "$BASE:$SPEC" | wc -l                                    # expected: 1111 (re-derive if main moved it)
grep -cE '⟦D:[a-z0-9]+(-[a-z0-9]+)*⟧' "$PLAN"                      # expected: 0, the controller has substituted every slug
git diff "$BASE" HEAD -- ccd deploy shared server agent pwa | grep '^+' | grep -c '⟦D:'   # expected: 0, no slug reached the tree
git diff --quiet "$BASE" HEAD -- ccd/ccd ccd/ccgpt-runtime ccd/ccgpt-proxy.py && echo CUT-OK
git diff --quiet "$BASE" HEAD -- shared/litellm.mjs deploy/litellm-config.template.yaml && echo RENDER-OK
fx() { sed -n '/^_fetch_codex() {$/,/^PY$/p'; }
cmp -s <(git show "$BASE:ccd/ccrc-models-probe" | fx) <(git show HEAD:ccd/ccrc-models-probe | fx) && echo FETCH-OK
ax() { sed -n '/^_models_litellm() {/,/^}$/p' | sed -n '/^  local file check crc$/,$p'; }
diff <(git show "$BASE:ccd/ccrc" | ax) <(git show HEAD:ccd/ccrc | ax) >/dev/null && echo ARM-OK
git grep -nE 'systemctl[^|;]*ccgpt-usage' -- ccd deploy | wc -l    # expected: 2, Plan 3a's two flat-timer remedies
```

Expected, in order:
1. A1–A6's commits;
2. `SPEC-AT-BASE`, then `1111`, then `0`, then `0`;
3. `CUT-OK`, `RENDER-OK`, `FETCH-OK` and `ARM-OK`, then `2`.

What each answer means:
- **The cut.** `ccd/ccd` would need a re-stamp. `ccd/ccgpt-runtime` is hashed into every runtime stamp, and the shim's bytes are what `_codex_tier_stale` compares, so none of the three may move.
- **The external path keeps the base's bytes** (Plan 3a's Z1, still binding until each lane's flip):
  - `_fetch_codex` is unchanged;
  - the external arm's body, from `local file check crc` on, is unchanged. Task A1's edit to `_models_litellm`'s dispatcher sits above that line, so `ARM-OK` holds with A1 landed;
  - the renderer and its template are unchanged.
- **The `2` are Plan 3a's two operator remedies naming the other repository's flat timer.** Task A2's WARN names ccrc's own `ccrc-codex-usage@<id>.timer`, which this pattern does not match.

Any other answer stops the task. Name the commit that caused it. A non-zero slug count means the plan has not been substituted, and the controller is told.

- [ ] **Step 1: Append §21, verbatim.**

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
SPEC=docs/superpowers/specs/2026-09-20-gpt-lane-ownership-design.md
[ "$(tail -c1 "$SPEC" | od -An -c | tr -d ' ')" = '\n' ] && echo ENDS-WITH-NEWLINE
cat >> "$SPEC" <<'EOF'

## 21. Amendments (Plan 3b)

Plan 3b (`docs/superpowers/plans/2026-10-05-gpt-lane-ownership-3b-the-cutover.md`) has two parts. Part A is one code PR that lands before any roster row is flipped to `codex`, inert on a roster with none and on the fleet box's live shape. Part B is the per-lane live runbook: each lane's flip is its own operator authorisation, and Part B changes no tracked byte except its close-out's docs PR to that plan. §19's and §20's rules hold here: a sentence above that the tree now contradicts, or that claims more than the tree does, carries a same-line pointer, `(amended: §21.N, D-NNNN)`, and the item below says what is true. **No line above this section moved:** Plan 3b's Task A7 proves that every hunk above this heading is a same-line pointer and the rest is this append. Each D-number is defined in that plan's Deviations found. §21.1-§21.6 are Part A's code, §21.7 and §21.8 correct two sentences Part B relies on, and §21.9-§21.11 say how Part B runs §15 step 3. Part B records its own execution-time departures in that plan's ledger as it reaches them. *(Added 2026-10-05.)*

### 21.1 Every reader of "is this row codex-kind" fails closed (§20.1, §20.2)

- **Three answers, not two.** `_models_litellm_codex` answers 0 for a row that is `exec.kind: "codex"`, 1 for a row that is not, and 2 when the roster cannot say which rows are: `_codex_lanes`' rc 1 (`roster-invalid`) or rc 2 (`missing-dependency`). On 2 it forwards `_codex_lanes`' own sentence to stderr instead of discarding it. An undecidable roster no longer answers "not codex" (⟦D:codex-kind-read-fails-closed⟧).
- **Every reader refuses on 2, in the forwarded word.** `_models_probe_codex_env` refuses, and the probe never runs, so a row that may be codex-kind never reaches the external fetch and its token-directory default, the class D-3706 names. `_models_litellm`'s dispatcher refuses rather than falling through to the external arm. Every other reader of the answer does the same. Each refusal carries `roster-invalid` or `missing-dependency`, as `_codex_row`'s propagation already does, and no new word is minted.
- `_models_litellm_stop_blocked` (§20.2, D-3753) already failed closed on the same input, and is unchanged.
- On a readable roster with jq on PATH the answers are the base's, 0 and 1, so a roster with no codex row, the live shape included, behaves exactly as before.

### 21.2 The usage converge re-measures a withdrawal, and doctor names a ccrc timer with no codex lane (§20.3, §20.4)

- **A withdrawal counts only when the link is gone.** After each `systemctl --user disable --now` in `_inst_codex_usage` (the withdrawal of an id that is no longer a codex lane, and the withdrawal beside another repository's instance) and in `_uninst_codex_usage`, ccrc re-measures `_codex_usage_enabled`. The instance is counted withdrawn, or stopped, only when that re-measure agrees. A disable the manager answers 0 while the link stays is the refusal §20.4 already describes: its own stderr line with the command, and the run's `NOT CONVERGED` line names that lane too (uninstall's own `failed` line, for `_uninst_codex_usage`). It is the re-read account removal already made (§20.4, C15) (⟦D:usage-withdrawal-is-re-measured⟧).
- **Doctor names a surplus ccrc timer.** `_check_codex`'s usage rows gain one WARN line of their own for every enabled `ccrc-codex-usage@<id>.timer` whose id is not a codex lane now: a flip back whose withdrawal did not take, or a roster edit no install has converged yet. Such a timer still polls, refreshes that lane's token and rewrites `~/.cc-limits/<id>.json`, so it is a finding of its own, never folded into the left-state row. Its remedy is the exact `systemctl --user disable --now ccrc-codex-usage@<id>.timer`, because no ccrc fixer withdraws a unit, and it names the next update's converge as the automatic cure. That is ccrc's own unit, so naming it breaks nothing §20.4 forbids. On Darwin the row answers the stated not-applicable §20.8 gives every usage row (⟦D:surplus-ccrc-usage-timer-warns⟧).
- **Doctor says what the links say.** Such an id is a subject on its own, so the empty-population SKIP never stands over it, and a set that cannot be listed is its own WARN, unmeasured. The left-lane-state WARN says "nothing of ccrc's reads it" only when no such timer is enabled for that id. The second-writer WARN says ccrc withholds its own timer only when that timer is not enabled; when both are enabled, it says both publishers are armed and names ccrc's withdrawal first, so §20.4's "with the operator's own disable as the remedy" is the withheld case's remedy.

### 21.3 Account removal waits for an in-flight usage refresh (§13, §20.4)

- After it disables the timer, `_acct_remove_usage` waits for `ccrc-codex-usage@<id>.service` to go inactive before the limits row, `~/.cc-limits/<id>.json`, is removed. It never stops that service: a oneshot mid-refresh may be writing the lane's `auth.json` through the library (§21.7), and a stop could cut that write short.
- The wait prints a waiting line and is bounded by `CCRC_ACCT_USAGE_WAIT_S`, default 300, the unit's own `TimeoutStartSec` (D-3707).
- When the bound expires, the removal refuses by name, `usage-refresh-in-flight`, with a sentence telling the operator to retry, before any limits-row deletion. Every step before the wait is idempotent, so the retry is safe, and Plan 3b pins that. So §20.4's "the removal still completes" holds for a disable the manager refuses or answers while the link stays, and not for a refresh still running when the bound expires (⟦D:account-removal-waits-for-usage-refresh⟧, ⟦D:usage-quiesce-before-the-roster-drop⟧).
- `ccrc account remove` runs this half after the home sweep and before the roster drop, where Plan 3a ran it after the drop. A refusal after the drop could not be retried, because a second run refuses `unknown-id` for an id the roster no longer names (⟦D:usage-quiesce-before-the-roster-drop⟧). The wait therefore holds the placement lock the removal already holds, for at most the bound.
- It asks the manager only on Linux, with ccrc's template `ccrc-codex-usage@.service` placed, whether or not the timer is still enabled. A retry finds the timer already disabled. A box without the template, and macOS, ask nothing.
- A manager that does not say whether the poll runs is unmeasured, never done. The removal completes, with an operator step naming the row to remove by hand once the poll reads inactive. A removal that finds no poll running completes as before.

### 21.4 A LiteLLM render that fails with no answer is a failed row (§8, §20.2)

- In `ccrc models refresh`, once a lane's catalogue probe and `materialise` have succeeded and its probe is `codex`, the LiteLLM step runs. When `_models_litellm` exits non-zero and its body carries no non-empty `.detail` (nothing on stdout, as from a killed subshell or any exit that does not pass through `_models_refuse`; a body with no `.detail` or a `null` one; or bytes that are not JSON), the row is `ok: false` with a non-empty `reason` naming that exit, as a `materialise` failure two steps earlier already is. It is never `ok: true` with `litellm: "skipped"`. `litellm: "failed"` stays retired from the row's vocabulary, and the same block reads `.detail // empty`, as the `materialise` block does (⟦D:bodyless-litellm-failure-fails-the-row⟧).
- **The reading rule.** On a `probe: "codex"` row, only `ok: true` with `litellm` set to `rendered` or `unchanged` says the LiteLLM step ran and succeeded. `skipped` on such a row is a failure signal on every build, this fix or not. Plan 3b's soak gate counts a refresh as having taken a codex lane's arm only on such a row, for an id the roster names `exec.kind: "codex"`.

### 21.5 Doctor's codex check reads "unmeasured" where it cannot tell (§12, §20.3)

- **A missing `cmp` skips only the byte compare.** `_dr_cx_bins` no longer returns at its cmp-absent WARN. A GPT-lane executable that is missing or not executable, or that has no shipped tree to compare against, is still found and FAILs in its own words. Only the drift compare is named "not compared", as a WARN.
- **An unlistable lane-state root is unmeasured, never "no Codex lane".** When `~/.ccrc/codex` exists but cannot be listed, `_check_codex` WARNs that the lane state there is unmeasured, instead of SKIPping as if it were empty.
- **An unreadable `.wrapper` is unmeasured.** `_dr_cx_sessions` counts a session whose `.wrapper` file cannot be read as one that may be on the lane, the "unmeasured, not idle" count of §20.3, never as another lane's session.
- All three are codex-lane-only paths. On a box with no codex lane and no lane-state root, doctor's `codex` row is still one SKIP, unless a ccrc usage timer is still enabled for an id that is no longer a codex lane (§21.2) (⟦D:codex-doctor-unmeasured-is-not-skip⟧).

### 21.6 The models writer path is type-tested too (§20.3)

- `shared/modelenv.mjs` exports `readRegular`, the one type-tested read: a path that is not a regular file throws `ENOTREG` before anything is read, so a FIFO never blocks. `deploy/models-op.mjs` imports it and keeps no copy of its own.
- It now guards the lane's `settings.json` read in `mergeSettingsEnv` and in `clearSettingsEnv`, where a non-regular file gets their existing could-not-be-read refusal and nothing is written. It also guards `readRoster`, the read every `deploy/models-op.mjs` op makes first, where a non-regular file answers `roster-unreadable` and an absent file still answers `roster-absent`.
- The tmp-and-rename write is unchanged, so the rename failures `models-op.test.ts` pins (an `EISDIR` target) keep their meaning.
- So neither `_fix_codex`'s re-render nor any `ccrc models` verb can hang on a FIFO at the roster or at a lane's `settings.json`. This closes the follow-up §20.3's last bullet names (bookkeeping: conformance to that bullet's own class, D-2380's; it mints nothing).

### 21.7 Who reads an OAuth file, per lane kind (§9)

- **For every codex lane, §9's closing sentence is true of ccrc's own code.** Nothing ccrc ships, whether doctor, installer, publisher, probe or test, opens a codex lane's `auth.json`. It checks existence and mode only.
- **The library does read and write it.** LiteLLM's `Authenticator`, inside ccrc's isolated runtime, reads the lane's `auth.json`, and writes it back when it refreshes the token: its `expires_at`, and an `account_id` it derives when the file has none (§20.1). It runs in the probe's codex path, the usage publisher, `ccrc codex login` and the lane's own LiteLLM tier, each against that lane's own `exec.authDir` and never another lane's.
- **For an `external` lane, until its flip,** the probe's external fetch reads `auth.json` directly for `account_id`: the base's bytes, the breach D-3161 records. The other repository's own processes read and write that lane's file as they always have. Plan 4's ccrc PR deletes the external fetch (§20.9).
- That library write is why account removal waits for a running refresh and never stops one (§21.3).

### 21.8 The device flow a lane's own LiteLLM tier can still start (§20.1)

- §20.1's "No device flow outside `ccrc codex login`" holds for the two programs its sub-bullets name: the probe's codex path and the usage publisher replace the `Authenticator`'s device-code path in-process with a `login-required` refusal.
- It does not hold for a codex lane's own LiteLLM tier. The tier runs the runtime's `Authenticator` inside its own process, which that guard does not reach, so a tier that needs a token while the lane's refresh token is dead can still begin a device flow.
- Plan 3b contains it. At each lane's flip, before any session returns to the lane, one refresh, `ccrc models refresh <id>`, runs through the guarded codex path and proves the lane's token refreshes. A `login-required` answer there stops the window for `ccrc codex login <id>`, run with the operator present. Nothing in the tree changes for this.

### 21.9 The lane's entry file, never the shared launcher (§15 step 3)

- §15 step 3's "move an unowned launcher aside" is, for each lane, exactly that lane's own entry file, `~/.local/bin/<id>`: the path `ccrc wrappers` writes for a codex row. It is renamed beside itself with a `.pre-ccrc-<UTC>` suffix before `ccrc wrappers` runs. Where the entry file is a symlink, the link is moved and its target is never touched.
- The other repository's shared launcher, `~/.local/bin/ccgpt`, is never moved, edited or deleted in Plan 3b, because every still-external lane's entry file execs it until that lane's own flip. Plan 4 removes it, with the rest of §15 step 4.
- A rollback moves the entry file back with one `mv`, after ccrc's tiers for the lane are stopped and ccrc's marker-verified launcher is removed.
- The move comes before the roster row turns codex-kind, the reverse of §15 step 3's listed order, so no claimer (`ccrc wrappers`, `_fix_wrappers`, an install) ever meets a codex row over a foreign launcher (⟦D:entry-moved-aside-not-the-launcher⟧).

### 21.10 The other repository's stop names its lane, and runs only before that lane's flip (§15 step 3, §20.2)

- The shared launcher's `stop` stops one lane's two units: the lane its `CCGPT_ACCOUNT_ID` selects, which defaults to the first lane when unset. So §15 step 3's "stop the old tiers with the currently installed lane-aware launcher" is the lane's own entry file run with `CCGPT_ACCOUNT_ID=<id>` set and `stop`. For any lane but the first, the shared launcher alone refuses without both port variables, which only that entry file exports. It is never a bare `ccgpt stop`, which in any other lane's window stops the first lane's tiers.
- It runs only before that lane's roster flip. From the flip on, the lane's unit names, `ccgpt-<id>-{litellm,shim}.service` (§19.2), are ccrc's own tiers, so no `ccgpt stop` that names a codex lane ever runs. That is the same reason the external arm's bare stop is refused once any codex row exists (D-3753).
- After the stop, the runbook waits longer than those units' `RestartSec` (3 s), then re-checks that the lane's transient units are gone and its two ports are free, by listing units and listening sockets only and connecting to nothing. Only then does `ccrc codex start <id>` run. A `unit-foreign` or `port-foreign` refusal that remains (§20.3's `_codex_foreign_what`) stops the window, and is never overridden.
- **Between two lanes' flips.** While a still-external lane's LiteLLM reads the box-global config and its proxy runs, any refresh that would change that render is refused `restart-failed` (D-3753). `ccrc models refresh --all` then exits 1, and `ccrc-models.service` reads failed on each such run until that lane flips. The lane keeps serving on its unchanged config. Which lane flips first is an operator ruling in Plan 3b, and Part B monitors this bounded degradation read-only until the second flip.

### 21.11 Pausing auto-update for a lane window (§15 step 3, §20.9)

- Unattended updates pause through intent, never through a file. An intent row with `auto: "off"` makes `autoPermits` refuse every unattended dispatch in its scope.
- A per-box pause is an intent row scoped to that node: `POST /api/updates/intent` with `{scope: <nodeId>, auto: "off"}`, a session-gated write only the operator can make. A node's own row overrides the fleet default for exactly that node. The PWA's Settings screen writes only the fleet scope, `*`, so a per-box pause is API-only; a per-node control in the PWA is a follow-up ticket, not Plan 3b.
- `auto: "off"` stops the scheduler, not a `ccrc update` someone runs by hand. `~/.ccrc/update.lock` is the one-update-at-a-time lock, not a pause. A fleet box learns its intent through `ccd-update-sync.timer`'s pull, so a change reaches it within about a minute.
- Plan 3b recommends a fleet-wide pause from the PWA for each lane window, with the prior `auto` and `channel` recorded and restored after verification. The controller reads the state read-only, through `ccrc update --check` and `ccrc channel`.

### 21.12 Who holds each mutation-table row Plan 3b added (§18)

| Guard | Task | Held by (the case title, read from the suite at execution) |
|---|---|---|
| an undecidable roster is never "not codex": every reader refuses in the forwarded word | A1 | ‹A1› |
| a withdrawal is counted only when the re-measured link is gone | A2 | ‹A2-converge› |
| an enabled ccrc usage timer with no codex lane is its own WARN, with ccrc's own remedy | A2 | ‹A2-doctor› |
| account removal waits for a running refresh, never stops it, and refuses `usage-refresh-in-flight` at the bound before any limits-row deletion; a retry completes | A3 | ‹A3› |
| a LiteLLM render that fails with no answer is an `ok: false` row, never `ok: true` with `skipped` | A4 | ‹A4› |
| doctor's codex check: a missing `cmp`, an unlistable lane-state root and an unreadable `.wrapper` each read unmeasured | A5 | ‹A5› |
| the roster read and the settings merge and clear are type-tested through the one exported `readRegular`: a FIFO is that read's unreadable answer, never a block | A6 | ‹A6› |
EOF
grep -c '^## 21\. Amendments (Plan 3b)$' "$SPEC"   # expected: 1
grep -c '^### 21\.' "$SPEC"                         # expected: 12
```

Expected: `ENDS-WITH-NEWLINE`, then `1`, then `12`. The heredoc's first line is blank, so §21 starts after one blank line, exactly as §20 does. The heredoc is quoted (`<<'EOF'`), so no `$` or backtick inside it expands. The `‹A1›`…`‹A6›` cells of §21.12 are filled in Step 3.

- [ ] **Step 2: The eight same-line pointers.** Each is appended inside the one line its locator matches, and the line is otherwise unchanged. The line numbers below were measured at `be93d159`; the script re-derives every one by locator and refuses, writing nothing, unless each locator matches exactly one line and each anchor occurs once in it.

| Line at `be93d159` | Old text (exact) | New text |
|---|---|---|
| 497 | `Nothing in ccrc — doctor, installer, publisher, probe or test — ever reads the contents of an OAuth file.` | the same, then ` (amended: §21.7)` |
| 982 | the §20.1 bullet `- **A codex lane's probe has no default.** …`, ending `For every other row the function unsets only the marker and the interpreter.` | the same, then ` (amended: §21.1, ⟦D:codex-kind-read-fails-closed⟧)` |
| 993 | ``- **No device flow outside `ccrc codex login`.**`` | the same, then ` (amended: §21.8)` |
| 1007 | the §20.3 bullet `- **Placement and skips.** …`, ending ``because the `wrappers` check already FAILs it (D-3723).`` | the same, then ` (amended: §21.5, ⟦D:codex-doctor-unmeasured-is-not-skip⟧)` |
| 1024 | the §20.3 bullet ``- **Every lane file `deploy/models-op.mjs` reads is type-tested first**, …``, ending `that is a carried follow-up, not a claim of this bullet.` | the same, then ` (amended: §21.6)` |
| 1035 | the §20.4 bullet `- **Beside a foreign instance.** …`, whose first sentence ends ``and `_check_codex` WARNs with the operator's own disable as the remedy.`` | the same, with ` (amended: §21.2, ⟦D:surplus-ccrc-usage-timer-warns⟧)` inserted directly after `WARNs with the operator's own disable as the remedy`, before its full stop |
| 1039 | ``  - A withdrawal systemd refuses leaves ccrc's timer enabled. It gets its own stderr line with the command, and the run ends with a `NOT CONVERGED` line naming every lane whose timer is still enabled.`` | the same, then ` (amended: §21.2, ⟦D:usage-withdrawal-is-re-measured⟧, ⟦D:surplus-ccrc-usage-timer-warns⟧)` |
| 1042 | the §20.4 bullet `- **Uninstall and account removal.** …`, whose fourth sentence is `It reports the link removed only when a re-read finds it gone; a disable the manager refuses, or answers while the link stays, is reported as an operator step, and the removal still completes.` | the same, with ` (amended: §21.3, ⟦D:account-removal-waits-for-usage-refresh⟧, ⟦D:usage-quiesce-before-the-roster-drop⟧)` inserted directly after `and the removal still completes`, before its full stop |

Lines 982 and 1024 are quoted by their first and last clauses, and line 1035 by its lead and the clause its pointer follows, because each is a single line over 600 characters. The locators below match each one whole.

Ruling A-7 names four of these lines: `:497`, `:993`, §20.1's no-default bullet and §20.4's withdrawal line. The other three, `:1007`, `:1024` and `:1042`, are sentences that §21.5, §21.6 and §21.3 make incomplete or false (reconcile ruling R4). §20's own rule is that a sentence the tree contradicts carries a pointer, so they get one too. The eighth, `:1035`, is §20.4's foreign-instance bullet (controller ruling NC-1): once §21.2's both-enabled WARN names ccrc's withdrawal first, its "`_check_codex` WARNs with the operator's own disable as the remedy" is the withheld case's remedy only, so it points at §21.2 under A2's doctor slug.

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
SPEC=docs/superpowers/specs/2026-09-20-gpt-lane-ownership-design.md
cat > "$SCRATCH/a7-pointers.cjs" <<'EOF'
// a7-pointers.cjs <spec-file>: the eight same-line pointers above §21. Each edit names
// the ONE line its locator matches and the ONE place in that line its pointer follows.
// It refuses, writing nothing, unless every locator matches exactly one line and every
// anchor occurs exactly once in it. A line that already carries its pointer matches
// no locator, so a second run refuses rather than doubling a pointer.
const { readFileSync, writeFileSync } = require('node:fs');
const file = process.argv[2];
const lines = readFileSync(file, 'utf8').split('\n');
const EDITS = [
  [/^Nothing in ccrc — doctor, installer, publisher, probe or test — ever reads the contents of an OAuth file\.$/,
    'an OAuth file.', ' (amended: §21.7)'],
  [/^- \*\*A codex lane's probe has no default\.\*\* .*For every other row the function unsets only the marker and the interpreter\.$/,
    'unsets only the marker and the interpreter.', ' (amended: §21.1, ⟦D:codex-kind-read-fails-closed⟧)'],
  [/^- \*\*No device flow outside `ccrc codex login`\.\*\*$/,
    '`ccrc codex login`.**', ' (amended: §21.8)'],
  [/^- \*\*Placement and skips\.\*\* The check sits after `models` in the check table\..*already FAILs it \(D-3723\)\.$/,
    'already FAILs it (D-3723).', ' (amended: §21.5, ⟦D:codex-doctor-unmeasured-is-not-skip⟧)'],
  [/^- \*\*Every lane file `deploy\/models-op\.mjs` reads is type-tested first\*\*.*that is a carried follow-up, not a claim of this bullet\.$/,
    'not a claim of this bullet.', ' (amended: §21.6)'],
  [/^- \*\*Beside a foreign instance\.\*\* .*`_check_codex` WARNs with the operator's own disable as the remedy\. Two publishers /,
    "WARNs with the operator's own disable as the remedy", ' (amended: §21.2, ⟦D:surplus-ccrc-usage-timer-warns⟧)'],
  [/^  - A withdrawal systemd refuses leaves ccrc's timer enabled\. .*naming every lane whose timer is still enabled\.$/,
    'whose timer is still enabled.', ' (amended: §21.2, ⟦D:usage-withdrawal-is-re-measured⟧, ⟦D:surplus-ccrc-usage-timer-warns⟧)'],
  [/^- \*\*Uninstall and account removal\.\*\* .*and the removal still completes\. §19\.8's .*no longer holds\.$/,
    'and the removal still completes', ' (amended: §21.3, ⟦D:account-removal-waits-for-usage-refresh⟧, ⟦D:usage-quiesce-before-the-roster-drop⟧)'],
];
const bad = [];
const at = EDITS.map(([re, after], k) => {
  const hit = lines.flatMap((l, i) => (re.test(l) ? [i] : []));
  if (hit.length !== 1) { bad.push(`edit ${k + 1}: ${hit.length} lines match its locator`); return -1; }
  const n = lines[hit[0]].split(after).length - 1;
  if (n !== 1) bad.push(`edit ${k + 1}: its anchor occurs ${n} times on line ${hit[0] + 1}`);
  return hit[0];
});
if (bad.length > 0) { console.error(`pointers REFUSED, nothing written:\n${bad.join('\n')}`); process.exit(1); }
at.forEach((i, k) => {
  const [, after, ptr] = EDITS[k];
  lines[i] = lines[i].replace(after, after + ptr);
  console.log(`line ${i + 1}: '${ptr.trim()}' after '${after}'`);
});
writeFileSync(file, lines.join('\n'));
EOF
node "$SCRATCH/a7-pointers.cjs" "$SPEC"; echo "rc=$?"
node "$SCRATCH/a7-pointers.cjs" "$SPEC" 2>&1 | head -1; echo "rc=$?"
grep -c '(amended: §21\.' "$SPEC"   # expected: 9, the eight pointers and §21's own preamble line, which spells the pointer's form
```

Expected, in order:
1. Eight lines, `line 497: '(amended: §21.7)' after 'an OAuth file.'` through `line 1042: '(amended: §21.3, D-…)' after 'and the removal still completes'`, then `rc=0`.
2. `pointers REFUSED, nothing written:`, then `rc=0`. That `rc` is `head`'s; the refusal itself exited 1. The second run is the script's own idempotence control: an edited line matches no locator.
3. `9`: the eight pointers, plus §21's preamble line that spells `(amended: §21.N, D-NNNN)`.

This was measured on a scratch copy of the spec at `be93d159` with the slugs stood in by numbers: six lines and rc 0 the first time, and six `0 lines match its locator` refusals and rc 1 the second. The seventh edit (`:1007`) was added at review and re-measured the same way: seven lines and rc 0, and the proof's `7 pointer-only edits`. The eighth (`:1035`) was added by controller ruling NC-1 and re-measured the same way: eight lines and rc 0, eight `0 lines match its locator` refusals and rc 1 the second time, `9` from the count, and the proof's `8 pointer-only edits; 91 lines appended`.

- [ ] **Step 3: Conform §21.1–§21.6 to the code that landed, and fill §21.12.** §21 states what A1–A6 commit, so each claim is re-read against the tip before anything is proved or committed. §21 sits below the old last line, so correcting it moves nothing the proof guards. A sentence the tip contradicts is corrected in §21, never by editing the code.

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
# §21.1 (A1): the answer no longer discards _codex_lanes' sentence; every reader is listed for reading
sed -n '/^_models_litellm_codex() {/,/^}$/p' ccd/ccrc | grep -c '_codex_lanes 2>/dev/null'   # base 1, expected 0
grep -nE '_models_litellm_codex "\$1"' ccd/ccrc                                              # base 2 readers; read each at the tip
# §21.2 (A2): the converge re-measures after each disable
sed -n '/^_inst_codex_usage() {/,/^}$/p' ccd/ccrc | grep -c '_codex_usage_enabled "\$u"'     # base 1, expected 3 or more
# §21.3 (A3): the word, the bound, and no stop of the service
grep -c 'usage-refresh-in-flight' ccd/ccrc                                                   # base 0, expected 1 or more
grep -c 'CCRC_ACCT_USAGE_WAIT_S' ccd/ccrc                                                    # base 0, expected 1 or more
sed -n '/^_acct_remove_usage() {/,/^}$/p' ccd/ccrc | grep -cE '_svc_stop|systemctl[^#]* stop '  # expected 0
# §21.4 (A4): the litellm block's bare .detail is folded into .detail // empty
sed -n '/^          lit="skipped"$/,/litellm:\$lit}/p' ccd/ccrc | grep -cF "jq -r '.detail')"  # base 1, expected 0
# §21.6 (A6): one exported readRegular, imported by models-op, no private copy
grep -cE '^export (function readRegular\(|const readRegular\b)' shared/modelenv.mjs          # base 0, expected 1
grep -cE '^(function readRegular\(|const readRegular\b)' deploy/models-op.mjs                 # base 1, expected 0
node -e "const s=require('fs').readFileSync('deploy/models-op.mjs','utf8'); const m=s.match(/import\s*\{([^}]*)\}\s*from '\.\.\/shared\/modelenv\.mjs'/); console.log(m ? (/\breadRegular\b/.test(m[1]) ? 'IMPORTED' : 'NOT-IMPORTED') : 'NO-IMPORT')"   # base NOT-IMPORTED, expected IMPORTED
```

The base values above were measured at `be93d159`. Then read, at the tip, the parts no count can settle:
- **§21.1:** each reader the grep lists refuses on answer 2 in the forwarded word.
- **§21.2:** the surplus WARN's remedy text. Confirm that Task A2's case pins the exact `systemctl --user disable --now ccrc-codex-usage@<id>.timer`, with the next update's converge as the automatic cure, and that §21.2 says no more; and that `_uninst_codex_usage`'s disable carries the re-read. If the row has no Darwin early return, cut §21.2's Darwin sentence and report it to the controller.
- **§21.3:** the order in `_acct_remove_usage` and `cmd_account remove`. The wait comes before the limits-row loop, and the refusal comes before any `rm` of `~/.cc-limits/<id>.json`.
- **§21.4:** the reason Task A4's case pins is non-empty and names the exit.
- **§21.5:** `_dr_cx_bins`, `_check_codex`'s left-state scan, and `_dr_cx_sessions`, against §21.5's three bullets.

A count that answers otherwise, or a reading that contradicts a bullet, means one of two things, and the step names which:
- the bullet is wrong about the code, so correct the bullet in §21;
- the code is short of its task, so report to the controller and stop. That is the A-task's failure, not this step's to repair.

Then fill §21.12. Replace each of `‹A1›`, `‹A2-converge›`, `‹A2-doctor›`, `‹A3›`, `‹A4›`, `‹A5›` and `‹A6›` with the exact `it(` titles of the cases that task's mutation table names, read from the suites at the tip (`grep -nF "it('" server/test/<file>.test.ts`). Each title is quoted and prefixed with its file, in §20.10's form: `` `ccrc-models.test.ts`: "<title>", and "<title>" ``.

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
grep -c '‹' docs/superpowers/specs/2026-09-20-gpt-lane-ownership-design.md   # expected: 0
```

- [ ] **Step 4: Prove that no line above §21 moved.** This is Plan 3a Task 11's proof, re-aimed at §21. The base's blob is diffed against a FILE, the worktree's spec here and never `HEAD`, because Step 7 commits only after this proof. Then hunks are classified:
- the one hunk that starts after the old last line is the append;
- every other hunk must keep its line numbers (`-a,b +a,b`), and each changed line must equal its old line once a §21 pointer is removed;
- a pointer is ` (amended: §21.N)` or ` (amended: §21.N, D-NNNN[, D-NNNN…])`, with numbers only, so an unsubstituted slug fails the proof.

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
cat > "$SCRATCH/a7-r9.cjs" <<'EOF'
// a7-r9.cjs <base> <spec-file-on-disk> <scratch>: no line above §21 moved. The base
// blob is diffed against a FILE (the worktree's spec, or a scratch mutant), never HEAD.
const { execFileSync, spawnSync } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const [base, target, scratch] = process.argv.slice(2);
const spec = 'docs/superpowers/specs/2026-09-20-gpt-lane-ownership-design.md';
const old = execFileSync('git', ['show', `${base}:${spec}`], { encoding: 'utf8' });
const oldLen = old.split('\n').length - 1;
writeFileSync(`${scratch}/a7-spec.base`, old);
const r = spawnSync('git', ['diff', '--no-index', '--unified=0', '--', `${scratch}/a7-spec.base`, target], { encoding: 'utf8' });
if (r.status !== 0 && r.status !== 1) { console.error(`R9 FAILS: git diff --no-index exited ${r.status}`); process.exit(1); }
const POINTER = / \(amended: §21\.\d+(?:, D-\d+)*\)/g;
const bad = [];
let appended = 0, pointers = 0;
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
    else pointers += 1;
  });
}
if (bad.length > 0) { console.error(`R9 FAILS:\n${bad.join('\n')}`); process.exit(1); }
if (appended === 0) { console.error('R9 FAILS: nothing appended — §21 is not in the diff'); process.exit(1); }
console.log(`R9: ${oldLen} lines above §21 unmoved; ${pointers} pointer-only edits; ${appended} lines appended`);
EOF
SPEC=docs/superpowers/specs/2026-09-20-gpt-lane-ownership-design.md
node "$SCRATCH/a7-r9.cjs" "$(cat "$SCRATCH/a7-base")" "$SPEC" "$SCRATCH"; echo "rc=$?"
```

Expected: `R9: 1111 lines above §21 unmoved; 8 pointer-only edits; 91 lines appended`, then `rc=0`. 91 is the appended block's measured length, the leading blank line plus §21's 90 lines, re-measured at review on a scratch copy of the spec at `be93d159` with numbers standing in for the slugs (the drafted text was 87, before review added bullets to §21.2, §21.3 and §21.9). Step 3's fills are in-line, so they change no count. A different count from a Step 3 correction is fine, provided it is the block's own `wc -l`.

**Mutations of the proof.** Each runs on a scratch copy, so the worktree's spec is never edited and there is nothing to restore. None of them can block, so none needs a `timeout`.

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
SPEC=docs/superpowers/specs/2026-09-20-gpt-lane-ownership-design.md; B="$(cat "$SCRATCH/a7-base")"
sed '333i\\' "$SPEC" > "$SCRATCH/a7-m1.md"                                                        # M1: one blank line above §5.4's line 333
node "$SCRATCH/a7-r9.cjs" "$B" "$SCRATCH/a7-m1.md" "$SCRATCH" 2>&1 | sed -n '1,2p'
sed '497s/ever reads/never reads/' "$SPEC" > "$SCRATCH/a7-m2.md"                                  # M2: a word changed beside a pointer
node "$SCRATCH/a7-r9.cjs" "$B" "$SCRATCH/a7-m2.md" "$SCRATCH"; echo "rc=$?"
sed -E '982s/ \(amended: §21\.1, D-[0-9]+\)/ (amended: §21.1, ⟦D:MUTANT⟧)/' "$SPEC" > "$SCRATCH/a7-m3.md"  # M3: an unsubstituted slug
node "$SCRATCH/a7-r9.cjs" "$B" "$SCRATCH/a7-m3.md" "$SCRATCH"; echo "rc=$?"
git show "$B:$SPEC" > "$SCRATCH/a7-m4.md"                                                         # M4: the bare base, nothing appended
node "$SCRATCH/a7-r9.cjs" "$B" "$SCRATCH/a7-m4.md" "$SCRATCH"; echo "rc=$?"
rm -f -- "$SCRATCH/a7-m1.md" "$SCRATCH/a7-m2.md" "$SCRATCH/a7-m3.md" "$SCRATCH/a7-m4.md"
```

| Row | Mutation | Reds with | Control |
|---|---|---|---|
| M1 | a blank line inserted above line 333 | `R9 FAILS:` then `@@ -332,0 +333 @@: moves lines` (every later hunk follows, each "moves lines") | the unmutated run above |
| M2 | `ever reads` → `never reads` on the pointered line 497 | `R9 FAILS:` / `line 497: not a pointer-only edit`, `rc=1` | the same |
| M3 | the §21.1 pointer's number replaced by a slug | `R9 FAILS:` / `line 982: not a pointer-only edit`, `rc=1` | the same |
| M4 | the base spec itself | `R9 FAILS: nothing appended — §21 is not in the diff`, `rc=1` | the same |

All four answers, and the control's counts, were measured while drafting. The script was run against `be93d159` on a scratch copy carrying this section's §21 text and the six pointers, with numbers standing in for the slugs, and re-measured after ruling NC-1 with all eight pointers: the same four answers.

- [ ] **Step 5: The append carries no real value.**
  - `topology-clean` (Step 6) holds the GPT-lane labels, added by Plan 3a Task 11.
  - This step's structural grep covers what no class expresses: an email shape, a home path, the other repository's config directory, a tailnet name, a loopback port, or any `:NNNN` port.

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
SPEC=docs/superpowers/specs/2026-09-20-gpt-lane-ownership-design.md
git diff -U0 "$(cat "$SCRATCH/a7-base")" -- "$SPEC" | grep '^+[^+]' \
  | grep -cE '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}|/home/|\.handoff|ts\.net|127\.0\.0\.1:[0-9]|:[0-9]{4,5}([^0-9]|$)'   # expected: 0
```

Expected: `0`, which was measured on the drafted text. `ccrc-codex-usage@<id>.timer` and `ccrc-codex-usage@.service` do not match the email shape, because what follows the `@` is `<` or `.`. A hit is read by count and line number only (`grep -nE … | cut -d: -f1`), and the offending §21 phrase is rewritten into parameter form.

- [ ] **Step 6: The doc guards.**
  - `deviation-refs` compares against `origin/main` without merging, so it fetches first.
  - `topology-clean` holds base64 labels, so its output is suppressed and its exit code is the verdict.
  - Each suite is one foreground call under the census.

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
git fetch origin main
cd server && "$CENSUS" "$EVID/a7-s6-ledger" env -u CLAUDE_CONFIG_DIR ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts
```

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
cd server && "$CENSUS" "$EVID/a7-s6-topology" bash -c 'env -u CLAUDE_CONFIG_DIR ./node_modules/.bin/vitest run test/topology-clean.test.ts >/dev/null 2>&1'
```

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
cd server && "$CENSUS" "$EVID/a7-s6-single-definition" env -u CLAUDE_CONFIG_DIR ./node_modules/.bin/vitest run test/single-definition.test.ts
```

Expected: each green, then `census: clean — no unit or link change, 0 fixture processes left; command exit 0`.
- **`deviation-refs`** reds on a number defined in two plans. The likeliest cause is a branch that took the same number: report it, and the controller re-mints.
- **`dtbd`** reds on any `D-TBD-<slug>` placeholder.
- **`topology-clean`** reds on a residue token. Read a non-zero exit by case title only, never by its output.
- **`single-definition`** is run because Task A6 moves `readRegular`. Its `.classes.json` count in `ccd/ccrc-doctor-checks` is still 2 (Plan 3a's pin, `server/test/single-definition.test.ts`), because nothing in Part A reads a registry file by name.

- [ ] **Step 7: Commit the spec.**

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
git add docs/superpowers/specs/2026-09-20-gpt-lane-ownership-design.md
git commit -F - <<'EOF'
docs(gpt-lane): Plan 3b Task A7 — spec §21, Amendments (Plan 3b), and eight same-line pointers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log -1 --format='%an <%ae> | %cn <%ce>'
git diff --stat "$(cat "$SCRATCH/a7-base")" HEAD -- docs/superpowers/specs/
```

Expected:
- the identity line shows the noreply identity this worktree's git config carries, and nothing else. Any other identity stops the task before anything is pushed;
- the stat names the one spec file.

- [ ] **Step 8: The Part A merged-tree gate.** Run it from this worktree with `CLAUDE_CONFIG_DIR` unset, as CI runs it. Every command goes through `$CENSUS` in the foreground, one suite or shard per Bash call, each inside the tool's 600 s cap. No call loops several suites.
  - **Merge `main` in first if it moved.**
    1. Run `git fetch origin main`.
    2. If `git merge-base --is-ancestor origin/main HEAD` fails, run `git merge --no-edit origin/main`, then `git merge-base origin/main HEAD > "$SCRATCH/a7-base"`.
    3. Re-run Steps 0 and 4, and Step 6's ledger call, against the new base.

    A D-number defined only on `main` reds the ledger scan until the merge, and a `main` that edited the spec moves the proof's base.
  - **Server: 12 shards, then the doctor file alone.** One call per shard, for k = 1 to 12 in turn:

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
k=1   # 1, 2, … 12: one call each
cd server && "$CENSUS" "$EVID/a7-gate-shard-$k" env -u CLAUDE_CONFIG_DIR timeout 590 ./node_modules/.bin/vitest run --shard=$k/12 --exclude '**/ccrc-doctor.test.ts'
```

  `ccrc-doctor.test.ts` is never run whole in one call. At Plan 3a's base it took 424 s and 525 s, and Part A adds cases to it (Tasks A2 and A5). So it runs as three complementary parts:

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
k=1; P='^ccrc doctor: [a-c]'   # then k=2 '^ccrc doctor: [d-m]', then k=3 '^(?!ccrc doctor: [a-m])': one call each
cd server && "$CENSUS" "$EVID/a7-gate-doctor-$k" env -u CLAUDE_CONFIG_DIR timeout 590 ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t "$P"
```

  The three parts' case counts sum to the file's total, which `./node_modules/.bin/vitest list test/ccrc-doctor.test.ts --json` names. A part that exits 124 (`timeout`'s answer) is split again at another letter, keeping the parts complementary. A failing shard is re-run alone before anything is called a break. The repository `CLAUDE.md` lists the known load flakes, and CI on the quiet box is the arbiter for a file its selection ran.
  - **Agent and PWA**, one call each:

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
cd agent && "$CENSUS" "$EVID/a7-gate-agent" env -u CLAUDE_CONFIG_DIR ./node_modules/.bin/vitest run
```

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
cd pwa && "$CENSUS" "$EVID/a7-gate-pwa" env -u CLAUDE_CONFIG_DIR ./node_modules/.bin/vitest run
```

  - **Typecheck: three `tsc`, then the tests' own typecheck.** One call each. `tsc --noEmit` does not read `server/test/`, so `typecheck-tests.test.ts` is the fourth call:

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
cd server && "$CENSUS" "$EVID/a7-gate-tsc-server" ./node_modules/.bin/tsc --noEmit
```

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
cd agent && "$CENSUS" "$EVID/a7-gate-tsc-agent" ./node_modules/.bin/tsc --noEmit
```

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
cd pwa && "$CENSUS" "$EVID/a7-gate-tsc-pwa" ./node_modules/.bin/tsc --noEmit
```

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
cd server && "$CENSUS" "$EVID/a7-gate-typecheck-tests" env -u CLAUDE_CONFIG_DIR ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
```

  - **The compaction-card corpus.** Tasks A1–A4 edit `ccd/ccrc`, and an edit there can move a line the card corpus cites:

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
cd server && "$CENSUS" "$EVID/a7-gate-card" env -u CLAUDE_CONFIG_DIR ./node_modules/.bin/vitest run test/session-hook.test.ts -t "compaction card"
```

  - **The ledger and residue guards**, re-run on the merged tree: Step 6's three calls again, under the labels `a7-gate-ledger`, `a7-gate-topology` and `a7-gate-single-definition`.
  - **The cut, the proof and the identity**, after any merge of `main`:

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
BASE="$(cat "$SCRATCH/a7-base")"
git diff --quiet "$BASE" HEAD -- ccd/ccd ccd/ccgpt-runtime ccd/ccgpt-proxy.py && echo CUT-OK
node "$SCRATCH/a7-r9.cjs" "$BASE" docs/superpowers/specs/2026-09-20-gpt-lane-ownership-design.md "$SCRATCH"
git diff "$BASE" HEAD -- ccd deploy shared | grep '^+' | grep -nE '\.local/bin/ccgpt|ccgpt-usage[@.]'
git log --format='%an <%ae> | %cn <%ce>' "$BASE"..HEAD | sort -u
```

  Expected:
  - `CUT-OK`;
  - the Step 4 line, with its counts;
  - the hits of the `+`-line grep are only refusals, comments or remedy sentences that name another repository's file. Read every hit; a hit that writes, moves or drives one stops the gate;
  - one identity, the noreply one.

  Step 0's ruling-Z lines (`FETCH-OK`, `ARM-OK`, `RENDER-OK`, `2`) answer as they did there.

  Every suite and `tsc` call above answers green, then `census: clean — no unit or link change, 0 fixture processes left; command exit 0`.

- [ ] **Step 9: The census gate, over every run Part A made.** The gate is the Global Constraints' `$CENSUS` evidence, read whole and attributed by the same rule the Global Constraints give beside the script:
  - the census's own controls write under `$SCRATCH/census-controls`, are red by design, and are skipped;
  - these hits are attributable whatever else was recorded:
    - a new unit or link whose name carries a fixture lane id;
    - any `ccrc-codex-usage@*` instance;
    - any vanished enablement link (a `gone:` line);
  - any other hit counts unless its evidence dir carries the `attributed-foreign` marker, which the implementer `touch`ed before that run's isolated re-run.

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
jq -r '.accounts[].id' "$HOME/.ccrc/accounts.json" | grep -cxE 'codex-a|codex-b|ext-a|ext-b|gen-a'   # expected: 0, a count only
find "$SCRATCH" "${TMPDIR:-/tmp}"/plan3b* -maxdepth 4 -path "$SCRATCH/census-controls" -prune -o \
  \( -name new-units.txt -o -name leaks.txt \) -size +0c -print 2>/dev/null > "$SCRATCH/a7-gate-hits"
fx='(^|[-@:])codex-[ab]([-.]|$)|ccrc-codex-usage@'
grep '/new-units\.txt$' "$SCRATCH/a7-gate-hits" | while IFS= read -r f; do
  { grep -v '^gone:' "$f" | grep -qE "$fx" || grep -q '^gone:' "$f"; } && echo "$f"; done | wc -l   # expected: 0
while IFS= read -r f; do [ -e "$(dirname "$f")/attributed-foreign" ] || echo "$f"; done < "$SCRATCH/a7-gate-hits" | wc -l   # expected: 0
```

Expected: `0`, `0` and `0`. An attributable 125 or 126 anywhere in Part A's evidence **fails the gate**:
- report it by its evidence dir and its counts, naming a unit only when it is fixture-named;
- clean nothing by hand from this session. Removing a leaked unit is the operator's act.

A deliberate red inside a census-wrapped command is that command's own exit code, never a census hit.

- [ ] **Step 10: The PR body, then push and open the PR.** This is the controller's act, after its whole-branch review of Part A. The body is written to a scratch file and checked before it is sent.

The rules:
- **Links:** the plan and the spec by **GitHub blob URL** on `main`, plus the PR's own Files view as the interim link, so the body reads correctly before and after the merge. **No docserver URL**, and no tailnet name of any kind: the PR is public, and most readers cannot open one.
- **"Merging this PR is a rollout."** It says so in those words, and says why.
- **Inert on today's shape,** because no roster row is `exec.kind: "codex"`, and every Part A arm is reached only through a codex row, a failure path, or an operator's own verb.
- **Deviations listed individually,** once minted: one line per D-number Part A defines, copied from this plan's Deviations found. Never a range, and never a slug.
- **Squash-merge**, which this repository merges with `--admin`, and the Claude Code footer.

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
cat > "$SCRATCH/a7-pr-body.md" <<'EOF'
## GPT lane ownership — Plan 3b, Part A: the code before the first roster flip

- Plan: https://github.com/Synapsium-Labs/ccrc-pwa/blob/main/docs/superpowers/plans/2026-10-05-gpt-lane-ownership-3b-the-cutover.md
- Spec: https://github.com/Synapsium-Labs/ccrc-pwa/blob/main/docs/superpowers/specs/2026-09-20-gpt-lane-ownership-design.md (§21, Amendments (Plan 3b))
- Until this merges, read both in this PR's Files view: @@FILES@@

**Merging this PR is a rollout.** Every merge to `main` becomes a dev prerelease within about a minute, and both boxes follow the dev channel on their own, so within minutes each box runs `ccrc update` onto this build: its install spine, its closing doctor, and from then on the hourly `ccrc-models.timer`. Nothing here is rolled out by hand.

**It is inert on today's live shape, because no roster row is `exec.kind: "codex"`.** Every arm Part A changes is reached only through a codex row, a failure path, or an operator's own verb:
- A1: on a readable roster the codex-kind answer is the base's 0 or 1. The new refusal fires only when the roster cannot be read or jq is missing, where the base folded the row into "not codex".
- A2: no ccrc usage instance exists, so the converge has nothing to withdraw and doctor has no surplus timer to name.
- A3: changes only `ccrc account remove`. On a Linux box with ccrc's usage template placed (the fleet box has it), every removal now asks the user manager one read-only `systemctl --user is-active ccrc-codex-usage@<id>.service`, and its report lists the usage entries before the roster drop. It waits only while a ccrc usage refresh is running, and no instance exists today.
- A4: changes only a row whose LiteLLM render failed with no answer.
- A5: doctor's codex check is still one SKIP on a box with no codex lane and no lane-state root.
- A6: a regular file reads the same bytes. Only a non-regular file at the roster or at a lane's `settings.json` answers differently, with that read's existing unreadable refusal instead of a block.
- A7: spec §21 and eight same-line pointers. No line above §21 moved; the PR's proof diffs the base blob hunk by hunk.

No roster is edited, and no file, unit, timer or launcher of another repository is written, moved, started, stopped, enabled or disabled. The live cutover is Part B, run by the controller with the operator present, one authorisation per lane, after this build is running on the fleet box. This merge authorises none of it.

### Deviations
EOF
```

Append the deviation lines to `$SCRATCH/a7-pr-body.md` by hand, one per D-number that Part A's tasks define. Use the form `- D-NNNN (<slug>): <the definition's first sentence>`. Then append the gate summary and the footer:

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
cat >> "$SCRATCH/a7-pr-body.md" <<'EOF'

### Evidence
- Every Part A guard landed red-first, with a mutation row that reds, recorded in the plan's tasks.
- The merged-tree gate ran in full: 12 server shards, `ccrc-doctor.test.ts` in three parts, agent, pwa, three `tsc --noEmit`, `typecheck-tests`, the compaction-card corpus, `deviation-refs`, `dtbd`, `topology-clean` and `single-definition`. Each ran under the containment census, which recorded no attributable unit, link or process.

Please **squash-merge** (this repository merges with `--admin`).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
B="$SCRATCH/a7-pr-body.md"; PLAN=docs/superpowers/plans/2026-10-05-gpt-lane-ownership-3b-the-cutover.md
grep -c 'ts\.net' "$B"                                                               # expected: 0
grep -cF 'blob/main/docs/superpowers/plans/2026-10-05-gpt-lane-ownership-3b-the-cutover.md' "$B"   # expected: 1
grep -cF 'Merging this PR is a rollout.' "$B"                                        # expected: 1
grep -cE '⟦D:|D-TBD|D-[0-9]+ *(-|–|\.\.) *D-[0-9]+' "$B"                             # expected: 0: no slug, placeholder or range
awk '/^## Deviations found/{f=1;next} /^## /{f=0} f' "$PLAN" | grep -oE 'D-[0-9]+' | sort -u > "$SCRATCH/a7-defined"
grep -oE 'D-[0-9]+' "$B" | sort -u | comm -23 - "$SCRATCH/a7-defined" | wc -l         # expected: 0: every number in the body is defined in the plan
```

Expected: `0`, `1`, `1`, `0` and `0`. Then push the workspace's own branch and open the PR, and give it its Files link once it has a number:

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
B="$SCRATCH/a7-pr-body.md"
git push -u origin HEAD
gh pr create --base main --head "$(git branch --show-current)" \
  --title "GPT lane ownership Plan 3b Part A: fail-closed codex-kind reads, the usage and removal fixes, spec §21" \
  --body-file "$B"
n="$(gh pr view --json number -q .number)"
sed -i "s#@@FILES@@#https://github.com/Synapsium-Labs/ccrc-pwa/pull/$n/files#" "$B"
grep -c '@@FILES@@' "$B"   # expected: 0
gh pr edit "$n" --body-file "$B"
```

Expected: the push succeeds and the pre-push hook passes, then `gh pr create` prints the PR's URL, then `0`, and the edit succeeds. The PR's checks are CI's selection: `test (server)` and the full `agent`, `pwa`, `build-pwa` and `probe-macos` legs. The macOS legs gate nothing, by ruling. The merge itself is the operator's.

## Part B — the live runbook

### Task B1: preconditions, a fresh read-only census, the values file, and the operator's rulings

**Files:**
- Scratch only, never committed, all under `$PB` = `<abs scratch>/plan3b-exec/partB` (`$SCRATCH/partB`), directory mode 0700, files 0600 (`umask 077`):
  - Part B's names, appended to the Global Constraints' `plan3b-env.sh` (no second sourced file), plus `redact.py` and the census scripts `b1-units.sh`, `b1-values.py`, `b1-census.sh`, `b1-z4.sh`, `b1-park.py`, `b1-candidate.sh`, `b1-dryrun.mjs` and `b1-reference.py`;
  - `values.sh`, **the values file**: every real value Part B uses, one `NAME=<shell-quoted value>` per line;
  - `park-map.txt` (candidate index to account id), `rulings.txt` (the operator's answers), and `evidence/` (every step's redacted output).
- Modify, outside the tree: the GPT-lane section of the gitignored `deploy/reference-fleet.md` in the operator's primary checkout. That is the first `worktree` line of `git worktree list --porcelain`, and the copy the repository's `CLAUDE.md` means by "real values". The section sits between two marker lines and is replaced whole on a re-run. Every other byte of the file is kept (ruling B-9).
- Read, never written: `~/.ccrc/accounts.json`, `~/.ccrc/models/`, `~/.ccrc/node-id`, `~/.cc-sessions/*.{wrapper,project,hold}`, `~/.cc-sessions/pools/`, `~/.cc-sessions/pool-epoch` and `~/.cc-limits/*.json`. Also read: the other repository's launcher `~/.local/bin/ccgpt`, its account-id, suffix, token-directory and port-default lines only; lane 2's entry file, its `export` and `exec` lines only; and the `ccrc-models.service` journal, its JSON rows only.
- Never opened: anything under either `<lane-auth-dir>` (existence, mode and mtime by `stat` only), any `runtime.env`, secrets file or `~/.handoff/env`, and any unit's `Environment=`. The user manager's environment is read for its `PATH` line alone, which never leaves `sed`.

**Interfaces:**
- Consumes Part A merged on `main` and running on the fleet box (ruling S1).
- Produces, for B2-B4:
  - the values file and its keys (the parameter table below);
  - `plan3b-env.sh`'s Part B names: `$PB`, `$VALUES`, `$B`, `lane <n>`, `vset KEY VALUE` and `redact`;
  - `b1-census.sh`, which B3 re-runs at each window's open;
  - `b1-z4.sh`, Z4's read-only measurement (R-O1's input; between the flips the monitor is B4's criterion 8);
  - `b1-candidate.sh` and `b1-dryrun.mjs`, the one spelling of a lane's roster edit and its validation by the shipped parser;
  - `b1-units.sh`, the unit and link name snapshot;
  - the recorded rulings.
- Writes nothing on the box beyond the scratch directory and the reference file's section.

**Why:**
- **The carry-forward's step 1, adapted (ruling S1, B-9).** Part B starts only when Part A runs on the fleet box. Every live command after this task names a parameter, never a value. So this task measures each value once, read-only, from the place the other repository or ccrc actually keeps it. It writes each value into one 0600 file, and stops on any disagreement between two sources of the same fact.
- **The live shape moved since Plan 3a's drafting** (the 2026-10-05 census, shape only):
  - lane 1, the lane with a codex class registry, has six live supervised sessions, where it had none;
  - lane 2 has one, where it had two;
  - all four foreign tiers run.

  Plan 3a's order argument rested on lane 1 being idle. This census is what ruling B-1's per-lane procedure is parameterised by.
- **Two facts no earlier census measured.**
  - The roster rows carry no ports and no `authDir` today. The values the codex rows will adopt (ruling B-7, spec §9) live in the other repository's launcher and in lane 2's entry file. Each is cross-checked here against the listener its running unit's MainPID holds.
  - One lane id can be a substring of another id, or of an unrelated file or unit name. So every match below is an exact field comparison, and `redact` replaces whole tokens, longest value first.
- **The controller's own shell PATH holds no `~/.local/bin` (measured).** That is the fleet-session PATH the repository's memory records. So every ccrc, ccd and builder verb in a block that sources `plan3b-env.sh` is called as `"$B/<verb>"`, and a block that does not (most of B3's) begins with `export PATH="$HOME/.local/bin:$PATH"` instead. A bare verb with neither never runs.

**The parameter table (ruling B-9; reconcile ruling N3).** Every Part B step names these, and nothing else stands for a real value. This table is their only definition. The values themselves live in two places only: `$PB/values.sh` (0600) and the GPT-lane section of the gitignored `deploy/reference-fleet.md`. Neither is tracked, and no value is ever written into this plan. A per-lane parameter is read through `lane <n>`, which sets `LANE_<KEY>` from `L<n>_<KEY>`. So `<lane-id>` in a lane step is `$LANE_ID` after `lane <n>`.

| Parameter | Meaning | Measured from (read-only) | Values-file key |
|---|---|---|---|
| `<lane-id>` | the lane's roster id. **Lane 1** is the `telemetry: "codex"` row with a `~/.ccrc/models/<lane-id>.classes.json`; **lane 2** is the other | `~/.ccrc/accounts.json`, `~/.ccrc/models/`; cross-checked against the other repository's launcher default id, which must be lane 1's | `L1_ID`, `L2_ID` |
| `<lane-shim-port>` | the shim's port, the one Claude Code faces. It becomes `exec.proxyPort` (R-O3 keeps it) | lane 1: the launcher's empty-suffix `PORT="${CCGPT_PORT:-…}"` default; lane 2: its entry file's `export CCGPT_PORT=` line. Each must be held by the MainPID of `ccgpt-<lane-id>-shim.service` (or its child) | `L<n>_SHIM_PORT` |
| `<lane-litellm-port>` | LiteLLM's port. It becomes `exec.litellmPort` | the same two sources' `CCGPT_LITELLM_PORT`, cross-checked against `ccgpt-<lane-id>-litellm.service`'s MainPID | `L<n>_LITELLM_PORT` |
| `<lane-auth-dir>` | the lane's existing OAuth directory, `$HOME`-relative, adopted as `exec.authDir` (spec §9.2) | derived exactly as the launcher's `CHATGPT_TOKEN_DIR` line derives it: an empty suffix for lane 1, `-<lane-id>` for lane 2. Its existence and mode are taken by `stat` | `L<n>_AUTH_DIR` |
| `<lane-config-dir>` | the lane's `$HOME`-relative Claude config directory, whose `settings.json` B3 backs up | the roster's `configDirSuffix`. It must equal the launcher's `.claude-<lane-id>`, or a parked session's transcript would not be found after the flip | `L<n>_CONFIG_DIR` |
| `<lane-entry>` | the shape of `~/.local/bin/<lane-id>`: `symlink` (lane 1, to the other repository's launcher) or `regular` (lane 2) | `lstat` | `L<n>_ENTRY` |
| `<lane-registry>` | `yes` if the lane has a codex class registry before its flip (ruling B-1's first parameter) | `~/.ccrc/models/` | `L<n>_REGISTRY` |
| `<session-id>` | one registry id. `<lane-sessions>` is the space-separated list of the ids whose `.wrapper` names the lane (ruling B-1's second parameter) | `~/.cc-sessions/*.wrapper`, exact line equality | `L<n>_SESSIONS` |
| `<park-target-wrapper>` | the non-codex wrapper the lane's sessions park on (ruling B-2) | the operator's choice among Step 5's candidates | `PARK_TARGET` |
| `<nodeId>` | the fleet box's node id, the `scope` of a per-node update intent | `~/.ccrc/node-id` | `NODE_ID` |
| `<controller-session-id>` | the controller's own registry id, which must be on no GPT lane | typed once by the controller | `CONTROLLER_SID` |
| `<part-a-merge-sha>` | Part A's squash-merge commit on `main` | typed once by the controller from the merged PR | `PART_A_SHA` |
| `<box-global-litellm-config>` | the external arm's LiteLLM config, `_models_litellm_path` with no argument (`ccd/ccrc`), which Z4's monitor watches | the tree's own default spelling | `GLOBAL_RENDER` |
| `<runtime-gen>` | the generation B2 built | B2 Step 4 | `RUNTIME_GEN` |
| `<n>` | the lane's number, `1` or `2`: the argument `lane <n>` takes | this table's lane 1 and lane 2 | — |
| `<lane-session-count>` | the number of `<lane-sessions>` | Step 2 | `L<n>_SESSION_COUNT` |
| `<other-lane-id>` | the other GPT lane's id | Step 2 | `L<n>_OTHER_ID` |
| `<foreign-usage-timer>`, `<foreign-usage-service>` | the other repository's usage timer and service for the lane: lane 1 the flat `ccgpt-usage.timer` / `.service`, lane 2 `ccgpt-usage@<lane-id>.timer` / `.service` (never the template) | Step 2, checked by Step 3 | `L<n>_FOREIGN_TIMER`, `L<n>_FOREIGN_SERVICE` |
| `<first-lane-id>`, `<second-lane-id>` | the `L<k>_ID` of the first and the second lane in `FLIP_ORDER` | Step 9 | `FLIP_ORDER` |
| `<first-lane-foreign-usage-timer>`, `<second-lane-foreign-usage-timer>` | `<foreign-usage-timer>` of `<first-lane-id>` and of `<second-lane-id>` | `FLIP_ORDER` with `L<k>_FOREIGN_TIMER` | derived |
| `<still-external-lane-id>` | lane 1's id, and only between the flips under the lane-2-first order (`FLIP_ORDER` `2 1`, `FLIPPED` `2`) | `FLIP_ORDER`, `FLIPPED` | `L1_ID` |
| `<flip-ordinal>` | `first` if `FLIPPED` is empty at B3 Step 0, else `second` | B3 Step 0 | derived from `FLIPPED` |
| `<window-dir>` | `$HOME/.ccrc-3b/<lane-id>-<UTC>`, mode 0700, with the window's `<UTC>`: the window's backups and evidence | B3 Step 1 | derived |
| `<window-end-UTC>` | the end of the window the operator names | the operator, at B3 Step 0 | not stored; said for the record |
| `<prior-auto>`, `<prior-channel>` | the fleet-scope update intent before a window's pause | Step 6, read back by the operator at each window's B3 Step 1 | `PRIOR_AUTO`, `PRIOR_CHANNEL`; per window, `<window-dir>/cp-prior-intent.tsv` |
| `<part-a-release>` | the first release tag that contains `<part-a-merge-sha>` | Step 1 (`git tag --contains`) | `PART_A_RELEASE` |
| `<doctor-baseline>` | `$PB/evidence/b1-doctor-classes.txt`, Step 6's class table (one `<check> <CLASS>` line per check), taken before any flip | Step 6 | a path; not stored |
| `<settings-backup>` | `<window-dir>/settings.json.bak` | B3 Step 5 | a path; not stored |
| `<flip-epoch>` | the second the lane's roster row went into place, `<window-dir>/flip.epoch` | B3 Step 9(c) | `L<n>_FLIP_EPOCH` (B3 Step 20) |
| `<server-box>` | the server box's ssh destination | the gitignored `deploy/reference-fleet.md` (`CCRC_BOX`) | not in the values file |
| launcher hash | the SHA-256 of `~/.local/bin/ccgpt` (R-O7), never printed | Step 2 | `CCGPT_SHA256` |
| flip order | ruling R-O1's answer, for example `2 1`. "First or second flip" is ruling B-1's third parameter | Step 9 | `FLIP_ORDER` |
| flipped lanes | the lanes already flipped. B3 appends to it after a verified flip (`vset FLIPPED "…"`) | B3 | `FLIPPED` |
| `<UTC>` | `date -u +%Y%m%dT%H%M%SZ`, taken at the act. Inside a B3 window it is the window's stamp, printed once at B3 Step 1 and reused by every block of that window (`<window-dir>`, the entry file's `.pre-ccrc-<UTC>`, the roster's temporary names) | the clock, at the step | not stored; a window's is in its `<window-dir>`'s name |

Two more parameters stand for paths, typed once in Step 0 the way Plan 3a types them, and in no other line: `<abs scratch>`, the controller's scratch directory, and `<abs worktree>`, the controller's checkout of this repository.

**Every step below runs on the fleet box, in the controller's own shell, with the operator present.** Each bash block begins by sourcing `plan3b-env.sh`, and relies on no variable, function or directory an earlier call set. Every line a block shows passes through `redact`, which prints a parameter name in place of each recorded value and `~` in place of `$HOME`. A mismatch line therefore names the fact that differs, never the value.

- [ ] **Step 0: The scratch, the sourced file, the redaction filter and the name snapshot.** Read-only on the box.

```bash
S='<abs scratch>/plan3b-exec'; T='<abs worktree>'   # typed here, and in each block's source line, nowhere else
[ -s "$S/plan3b-env.sh" ] || { echo "step0: $S/plan3b-env.sh is missing: write it first with the Global Constraints' block, then re-run this step"; exit 1; }
sed -i "2s|^TREE=.*|TREE='$T'|" "$S/plan3b-env.sh"   # Part A is merged: from here TREE is the controller's checkout
grep -qxF '# plan3b-env.sh: Part B (Tasks B1-B6), appended by B1 Step 0' "$S/plan3b-env.sh" || cat >> "$S/plan3b-env.sh" <<'EOF'
# plan3b-env.sh: Part B (Tasks B1-B6), appended by B1 Step 0
umask 077
PB="$SCRATCH/partB"; VALUES="$PB/values.sh"   # Part B's one evidence root; each step's evidence under "$PB/evidence"
B="$HOME/.local/bin"; REG="$HOME/.cc-sessions"; MODELS="$HOME/.ccrc/models"
UNITDIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"; WANTS="$UNITDIR/timers.target.wants"
LIVEPATH="$B:/usr/local/bin:/usr/bin:/bin"   # ccrc-models.service's own PATH line
if [ -s "$VALUES" ]; then . "$VALUES"; fi
redact() { python3 "$PB/redact.py" "$VALUES"; }
vset() {   # vset KEY VALUE: set one key in the values file, 0600, every other line kept
  local k="$1" v="$2" t="$VALUES.tmp.$$"
  { if [ -f "$VALUES" ]; then grep -v "^$k=" -- "$VALUES"; fi; printf '%s=%q\n' "$k" "$v"; } > "$t" \
    && chmod 600 "$t" && mv -f -- "$t" "$VALUES"
}
lane() {   # lane <1|2>: the per-lane parameters every Part B step names, as LANE_<KEY>
  case "${1-}" in 1|2) ;; *) echo "lane: 1 or 2" >&2; return 1 ;; esac
  local v
  for v in ID SHIM_PORT LITELLM_PORT AUTH_DIR CONFIG_DIR ENTRY REGISTRY SESSIONS SESSION_COUNT OTHER_ID FOREIGN_TIMER FOREIGN_SERVICE FLIP_EPOCH; do
    eval "LANE_$v=\${L$1_$v-}"
  done
  LANE_N="$1"
  [ -n "$LANE_ID" ] || { echo "lane $1: no values yet (B1 Step 2 writes them)" >&2; return 1; }
}
cd "$TREE" || return 1
EOF
. "$S/plan3b-env.sh" && mkdir -p "$PB/evidence" "$HOME/.ccrc-3b" && chmod 700 "$S" "$PB" "$PB/evidence" "$HOME/.ccrc-3b" || exit 1
L="$PB"
cat > "$L/redact.py" <<'EOF'
#!/usr/bin/env python3
# redact.py <values.sh>: stdin to stdout, every recorded VALUE of a sensitive key replaced by
# its key's name, longest value first, matched only where no letter, digit or `_` touches it.
# One id can be a substring of another id or of an unrelated file or unit name, so a bare
# substring replace would rename the wrong thing. Then $HOME becomes `~`.
import os, re, shlex, sys
SENSITIVE = re.compile(r'(_ID|_PORT|_DIR|_SESSIONS|_SID|_RENDER|PARK_TARGET)$')
pairs = []
try:
    with open(sys.argv[1]) as f:
        for line in f:
            k, sep, v = line.rstrip('\n').partition('=')
            if not sep or not SENSITIVE.search(k):
                continue
            for w in ' '.join(shlex.split(v)).split():
                if len(w) >= 2:
                    pairs.append((w, '<' + k + '>'))
except FileNotFoundError:
    pass
pairs.sort(key=lambda p: -len(p[0]))
text = sys.stdin.read()
for v, name in pairs:
    text = re.sub(r'(?<![A-Za-z0-9_])' + re.escape(v) + r'(?![A-Za-z0-9_])', name, text)
home = os.environ.get('HOME', '')
if home:
    text = text.replace(home, '~')
sys.stdout.write(text)
EOF
cat > "$L/b1-units.sh" <<'EOF'
#!/usr/bin/env bash
# b1-units.sh <plan3b-env.sh>: the GPT-lane unit NAMES and timers.target.wants link names on
# the real user manager (Plan 3a's census `units()`), sorted and redacted. It observes only:
# it reads no unit property and signals nothing.
set -uo pipefail
. "$1" || exit 2
{ systemctl --user list-units --all --no-legend --plain 'ccgpt-*' 'ccrc-codex-usage@*' | awk '{ print $1 }'
  for l in "$WANTS"/ccgpt-* "$WANTS"/ccrc-codex-usage@*; do
    if [ -L "$l" ] || [ -e "$l" ]; then echo "wants:${l##*/}"; fi
  done
} | sed '/^$/d' | sort -u | redact
EOF
chmod 700 "$L"/*.sh "$L"/*.py
. "$S/plan3b-env.sh" && "$PB/b1-units.sh" "$SCRATCH/plan3b-env.sh" > "$PB/evidence/b1-units-0.txt" \
  && echo "step0: $(wc -l < "$PB/evidence/b1-units-0.txt") unit/link names; scratch mode $(stat -c %a "$PB")"
```

- **Expected:** `step0: <k> unit/link names; scratch mode 700`. With no values file yet, the names are only `~`-redacted, so the controller does not print the file. By the 2026-10-05 census shape, `<k>` counts the four foreign tier units, the two foreign usage timers and their oneshots, and the two usage `wants:` links, all of the other repository. No `ccrc-codex-usage@<id>` name appears.
- **Stop:** the scratch directory cannot be made 0700, or `systemctl --user` does not answer.
- **Rollback:** none. Only scratch and the empty `$HOME/.ccrc-3b/` were written. Removing `$PB` by path, and the appended Part B section of `plan3b-env.sh`, undoes it.
- **Authorisation:** read-only.

- [ ] **Step 1: Part A is merged and is what the fleet box runs.** Read-only. `<part-a-merge-sha>` is typed here.

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
PA='<part-a-merge-sha>'
git fetch -q origin main && git merge-base --is-ancestor "$PA" origin/main && echo "partA: on origin/main"
git fetch -q --tags origin && vset PART_A_RELEASE "$(git tag --contains "$PA" --sort=v:refname | head -n 1)" && grep -c '^PART_A_RELEASE=v' "$VALUES"
v="$("$B/ccrc" version 2>&1)"; box="$(printf '%s\n' "$v" | sed -n '1s/^ccrc \([0-9a-f]\{7,40\}\) .*/\1/p')"
git cat-file -e "$box^{commit}" 2>/dev/null && git merge-base --is-ancestor "$PA" "$box" && echo "partA: in the build the box runs"
printf '%s\n' "$v" | grep -qx 'install: complete' && echo "install: complete"
t="$HOME/ccrc"   # the release tree the box runs (a symlink into ~/ccrc-versions)
echo "partA words in the running tree: $(grep -c 'usage-refresh-in-flight' "$t/ccd/ccrc") refusal, $(grep -c 'CCRC_ACCT_USAGE_WAIT_S' "$t/ccd/ccrc") wait knob, $(grep -cE '^export (function|const) readRegular\b' "$t/shared/modelenv.mjs") exported readRegular"
for f in ccgpt-proxy.py ccgpt-usage.py ccgpt-runtime ccrc-codex; do cmp -s "$B/$f" "$t/ccd/$f" && echo "placed $f = tree" || echo "placed $f DIFFERS from the tree"; done
```

- **Expected:**
  - `partA: on origin/main`, then `1` (`<part-a-release>` recorded), then `partA: in the build the box runs` and `install: complete`;
  - each of the three Part A words counted at least once. They are A-3's refusal word, A-3's wait knob and A-6's one exported reader, so this measures Part A's bytes in the tree the box actually runs, not a tag name;
  - four `placed <name> = tree` lines.

  The server box is read by the operator, on the PWA's update screen (`GET /api/updates`'s `nodes`): its measured build is reported, not gated. It runs no lane, and ruling S1 gates on the fleet box only.
- **Stop:** any line missing, or any `DIFFERS`. Part B does not start. The way forward is the box's own update mechanism, which the 2026-09-30 ruling says is watched and never replaced by a hand rollout. A `DIFFERS` means an install did not complete its bins step, and is reported to the operator.
- **Rollback:** none.
- **Authorisation:** read-only.

- [ ] **Step 2: The values file.** Read-only on the box. Writes `$PB/values.sh` at 0600. `<controller-session-id>` and `<part-a-merge-sha>` are typed here. Re-running this step re-measures every key it owns and keeps every key a later step added (`PARK_TARGET`, `FLIP_ORDER`, `FLIPPED`, `RUNTIME_*`, `PRIOR_*`, `CENSUS_UTC`, `PART_A_RELEASE`, `L<n>_FLIP_EPOCH`). **It is never re-run once a lane is flipped** (`FLIPPED` non-empty, from B3 Step 20 on): its lane identification and its entry-file and registry reads assume the pre-flip shape, which a flip changes. A session count that changes after a flip is cured by Step 3's re-record of the still-unflipped lane alone.

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
cat > "$PB/b1-values.py" <<'EOF'
#!/usr/bin/env python3
# b1-values.py <values.sh> <controller-session-id> <part-a-merge-sha>: Plan 3b Task B1 Step 2.
# Every per-lane value Part B names, measured read-only on this box and written 0600 (ruling
# B-9). Of the other repository's launcher only its id, suffix, token-directory and port-default
# lines are matched, of lane 2's entry file only its export and exec lines; no OAuth directory is
# listed or opened. Prints counts and value-free reasons only. Any stop writes nothing.
import hashlib, json, os, re, shlex, sys
H = os.environ['HOME']
out, csid, pa = sys.argv[1:4]
B = os.path.join(H, '.local', 'bin'); REG = os.path.join(H, '.cc-sessions'); M = os.path.join(H, '.ccrc', 'models')
stops = []
def lines(p):
    with open(p, encoding='utf-8', errors='replace') as f:
        return f.read().splitlines()
def one(rx, ls, what):
    hits = [m.group(1) for m in map(re.compile(rx).match, ls) if m]
    if len(hits) != 1:
        stops.append(f'{what}: {len(hits)} matching line(s), not 1')
        return ''
    return hits[0]
rows = json.load(open(os.path.join(H, '.ccrc', 'accounts.json')))['accounts']
gptrows = [a for a in rows if a.get('telemetry') == 'codex']
if len(gptrows) != 2:
    sys.exit(f'b1-values: stopped: {len(gptrows)} telemetry-codex row(s), not 2; nothing written')
reg = [a for a in gptrows if os.path.exists(os.path.join(M, a['id'] + '.classes.json'))]
if len(reg) != 1:
    sys.exit(f'b1-values: stopped: {len(reg)} GPT row(s) carry a class registry, not 1; nothing written')
l1 = reg[0]; l2 = next(a for a in gptrows if a is not l1)
v = {'L1_ID': l1['id'], 'L2_ID': l2['id'], 'L1_REGISTRY': 'yes', 'L2_REGISTRY': 'no'}
cc = lines(os.path.join(B, 'ccgpt'))
if one(r'^export CCGPT_ACCOUNT_ID="\$\{CCGPT_ACCOUNT_ID:-([^}"]+)\}"', cc, 'launcher default id') not in ('', l1['id']):
    stops.append('the launcher default id is not lane 1 (the registry lane)')
if one(r'^\[ "\$CCGPT_ACCOUNT_ID" = ([^ \]]+) \] \|\| CCGPT_LANE_SUFFIX="-\$CCGPT_ACCOUNT_ID"', cc, 'launcher suffix rule') not in ('', l1['id']):
    stops.append('the launcher suffix rule exempts another id than lane 1')
tok = one(r'^export CHATGPT_TOKEN_DIR="\$\{CHATGPT_TOKEN_DIR:-\$HOME/(\.handoff/chatgpt-auth)\$\{CCGPT_LANE_SUFFIX\}\}"', cc, 'launcher token-dir rule')
v['L1_SHIM_PORT'] = one(r'^\s+PORT="\$\{CCGPT_PORT:-([0-9]+)\}"', cc, 'lane 1 shim port default')
v['L1_LITELLM_PORT'] = one(r'^\s+export CCGPT_LITELLM_PORT="\$\{CCGPT_LITELLM_PORT:-([0-9]+)\}"', cc, 'lane 1 litellm port default')
e2 = lines(os.path.join(B, l2['id']))
if one(r'''^export CCGPT_ACCOUNT_ID=["']?([^"'\s]+)["']?\s*$''', e2, 'lane 2 entry id') not in ('', l2['id']):
    stops.append('lane 2 entry exports another id')
v['L2_SHIM_PORT'] = one(r'''^export CCGPT_PORT=["']?([0-9]+)["']?\s*$''', e2, 'lane 2 shim port')
v['L2_LITELLM_PORT'] = one(r'''^export CCGPT_LITELLM_PORT=["']?([0-9]+)["']?\s*$''', e2, 'lane 2 litellm port')
one(r'''^exec "\$HOME/\.local/bin/(ccgpt)" "\$@"\s*$''', e2, 'lane 2 exec line')
if any(re.search(r'CHATGPT_TOKEN_DIR|CCGPT_CONFIG', l) for l in e2):
    stops.append('lane 2 entry overrides the token directory or the config path')
if tok:
    v['L1_AUTH_DIR'] = tok; v['L2_AUTH_DIR'] = tok + '-' + l2['id']
for n, a in (('1', l1), ('2', l2)):
    if a.get('configDirSuffix') != '.claude-' + a['id']:
        stops.append(f'lane {n}: configDirSuffix is not the launcher\'s .claude-<lane-id>')
    v[f'L{n}_CONFIG_DIR'] = a.get('configDirSuffix', '')
    e = os.path.join(B, a['id'])
    if os.path.islink(e):
        v[f'L{n}_ENTRY'] = 'symlink'
        if os.path.realpath(e) != os.path.realpath(os.path.join(B, 'ccgpt')):
            stops.append(f'lane {n}: entry is a symlink to something other than the launcher')
    elif os.path.isfile(e):
        v[f'L{n}_ENTRY'] = 'regular'
    else:
        stops.append(f'lane {n}: entry is neither a symlink nor a regular file')
    sids = []
    for f in sorted(os.listdir(REG)):
        p = os.path.join(REG, f)
        if f.endswith('.wrapper') and os.path.isfile(p):
            with open(p) as fh:
                if fh.readline().strip() == a['id']:
                    sids.append(f[:-len('.wrapper')])
    v[f'L{n}_SESSIONS'] = ' '.join(sids)
    v[f'L{n}_SESSION_COUNT'] = str(len(sids))
    v[f'L{n}_OTHER_ID'] = (l2 if a is l1 else l1)['id']
    v[f'L{n}_FOREIGN_TIMER'] = 'ccgpt-usage.timer' if a is l1 else f"ccgpt-usage@{a['id']}.timer"
    v[f'L{n}_FOREIGN_SERVICE'] = 'ccgpt-usage.service' if a is l1 else f"ccgpt-usage@{a['id']}.service"
if (v.get('L1_ENTRY'), v.get('L2_ENTRY')) != ('symlink', 'regular'):
    stops.append('the entry shapes are not lane 1 symlink and lane 2 regular file')
try:
    with open(os.path.join(REG, csid + '.wrapper')) as fh:
        w = fh.readline().strip()
    if w in (l1['id'], l2['id']):
        stops.append('the controller\'s own session is on a GPT lane')
except OSError:
    stops.append('the controller\'s session id names no registry row')
nid = open(os.path.join(H, '.ccrc', 'node-id')).read().strip()
if not re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', nid):
    stops.append('~/.ccrc/node-id is not a lowercase uuid')
if not re.fullmatch(r'[0-9a-f]{7,40}', pa):
    stops.append('the Part A sha is not a commit id')
v['CCGPT_SHA256'] = hashlib.sha256(open(os.path.join(B, 'ccgpt'), 'rb').read()).hexdigest()   # R-O7: hashed, never printed
v.update({'NODE_ID': nid, 'CONTROLLER_SID': csid, 'PART_A_SHA': pa,
          'GLOBAL_RENDER': os.path.join(H, '.handoff', 'litellm-config.yaml')})
if stops:
    for s in stops:
        print('b1-values: STOP:', s)
    sys.exit(f'b1-values: stopped: {len(stops)} reason(s); nothing written')
kept = []
if os.path.exists(out):
    with open(out) as f:
        kept = [l for l in f if l.partition('=')[0] not in v]
fd = os.open(out + '.tmp', os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, 'w') as f:
    f.writelines(kept)
    for k in sorted(v):
        f.write(f'{k}={shlex.quote(v[k])}\n')
os.chmod(out + '.tmp', 0o600); os.replace(out + '.tmp', out)
print(f"b1-values: {len(v)} key(s) written, {len(kept)} kept, mode 600; "
      f"lane 1: registry yes, entry symlink, {len(v['L1_SESSIONS'].split())} session(s); "
      f"lane 2: registry no, entry regular, {len(v['L2_SESSIONS'].split())} session(s)")
EOF
chmod 700 "$PB/b1-values.py"
python3 "$PB/b1-values.py" "$VALUES" '<controller-session-id>' '<part-a-merge-sha>' | tee "$PB/evidence/b1-values.txt"
```

- **Expected:** one line, `b1-values: 29 key(s) written, 0 kept, mode 600; lane 1: registry yes, entry symlink, <s1> session(s); lane 2: registry no, entry regular, <s2> session(s)`. The 2026-10-05 census counted six and one sessions. A different count is a fact, not a mismatch: it is ruling B-1's parameter, and Step 9 re-puts R-O1 when it changes the recommendation's premise.
- **Stop:** any `b1-values: STOP:` line, which writes nothing. Each names the fact that disagrees (for example, `the launcher default id is not lane 1`). It never names a value, so it can be pasted to the operator as is. Nothing proceeds. This plan's lane identification assumes the measured shape, and a different shape needs a re-ruling, not an adjusted regex.
- **Rollback:** none on the box. Delete `$VALUES` to forget the values.
- **Authorisation:** read-only.

- [ ] **Step 3: The census.** Read-only. B3 re-runs this same script at each window's open. It skips a lane listed in `FLIPPED`, because B3's verification measures a flipped lane.

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
cat > "$PB/b1-census.sh" <<'EOF'
#!/usr/bin/env bash
# b1-census.sh <plan3b-env.sh>: Part B's read-only census (Task B1 Step 3; B3 re-runs it at
# each window's open). It reads names, modes, mtimes, unit states, MainPIDs and listening-socket
# rows only: no unit Environment, no OAuth file's contents, no connect, no write. Its output is
# redacted; exit 0 iff no MISMATCH line.
set -uo pipefail
. "$1" || exit 2
raw="$PB/evidence/.census-raw.$$"; out="$PB/evidence/b1-census-$(date -u +%Y%m%dT%H%M%SZ).txt"
ok()   { printf 'ok       %s\n' "$*"; }
miss() { printf 'MISMATCH %s\n' "$*"; }
note() { printf 'note     %s\n' "$*"; }
flipped() { case " ${FLIPPED-} " in *" $1 "*) return 0 ;; esac; return 1; }
wanted() { [ -L "$WANTS/$1" ] || [ -e "$WANTS/$1" ]; }
age_h() { echo $(( ( $(date +%s) - $(stat -c %Y -- "$1") ) / 3600 )); }
holder_ok() {   # <port> <mainpid>: 0 iff that port's listener is the MainPID or its child
  local pid
  pid="$(ss -ltnpH "sport = :$1" 2>/dev/null | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | head -n1)"
  [ -n "$pid" ] && [ "${2:-0}" != 0 ] || return 1
  [ "$pid" = "$2" ] || [ "$(ps -o ppid= -p "$pid" | tr -d ' ')" = "$2" ]
}
{
roster="$HOME/.ccrc/accounts.json"
nc="$(jq '[.accounts[] | select((.exec|type)=="object" and .exec.kind=="codex")] | length' "$roster")"
set -- ${FLIPPED-}
[ "$nc" = "$#" ] && ok "roster: $nc codex-kind row(s), as FLIPPED records" || miss "roster: $nc codex-kind row(s); FLIPPED records $#"
for n in 1 2; do
  lane "$n" || { miss "lane $n: no values"; continue; }
  if flipped "$n"; then note "lane $n: flipped; B3's verification measures it"; continue; fi
  row="$(jq -c --arg id "$LANE_ID" '[.accounts[] | select(.id==$id)] | if length==1 then .[0]
          | {k:.exec.kind, p:.exec.provider, keys:(.exec|keys), t:.telemetry, h:.homeAble, pool:has("pool"), c:.configDirSuffix}
          else {rows:length} end' "$roster")"
  want="$(jq -cn --arg c "$LANE_CONFIG_DIR" '{k:"external",p:"openai",keys:["kind","provider"],t:"codex",h:true,pool:false,c:$c}')"
  [ "$row" = "$want" ] && ok "lane $n: roster row external/openai/codex, exec kind+provider only, homeAble, no pool" \
    || miss "lane $n: roster row shape $row"
  have=""; for s in json classes.json classes.tsv effort.json; do [ -e "$MODELS/$LANE_ID.$s" ] && have="$have $s"; done
  if [ "$LANE_REGISTRY" = yes ]; then exp=" json classes.json classes.tsv effort.json"; else exp=" effort.json"; fi
  [ "$have" = "$exp" ] && ok "lane $n: models files:$have" || miss "lane $n: models files:${have:- none}; expected$exp"
  if [ -f "$MODELS/$LANE_ID.json" ]; then
    note "lane $n: catalogue fetched $(( ( $(date +%s) - $(jq -r '.fetchedAt // 0' "$MODELS/$LANE_ID.json") ) / 3600 )) h ago, stale $(jq -r '.stale // false' "$MODELS/$LANE_ID.json")"
  fi
  e="$B/$LANE_ID"
  case "$LANE_ENTRY" in
    symlink) [ -L "$e" ] && [ "$(readlink -f -- "$e")" = "$(readlink -f -- "$B/ccgpt")" ] \
               && ok "lane $n: entry is a symlink to the other repository's launcher" || miss "lane $n: entry is not that symlink" ;;
    regular) [ -f "$e" ] && [ ! -L "$e" ] && ok "lane $n: entry is a regular file" || miss "lane $n: entry is not a regular file" ;;
  esac
  [ "$(grep -c '^# ccrc:generated ' -- "$e" 2>/dev/null)" = 0 ] && ok "lane $n: entry carries no ccrc marker" || miss "lane $n: entry carries a ccrc marker"
  [ "$(find "$B" -maxdepth 1 -name "$LANE_ID.pre-ccrc-*" | wc -l)" = 0 ] && ok "lane $n: no moved-aside entry yet" || miss "lane $n: a $LANE_ID.pre-ccrc-* entry exists"
  for t in litellm shim; do
    u="ccgpt-$LANE_ID-$t.service"; p="$LANE_LITELLM_PORT"; [ "$t" = shim ] && p="$LANE_SHIM_PORT"
    st="$(systemctl --user is-active "$u" 2>/dev/null)"; mp="$(systemctl --user show -p MainPID --value "$u" 2>/dev/null)"
    if [ "$st" = active ] && holder_ok "$p" "${mp:-0}"; then ok "lane $n: $u active; its MainPID holds $p"
    else miss "lane $n: $u is ${st:-unknown}, or $p is not held by its MainPID"; fi
  done
  if [ "$n" = 1 ]; then fu=ccgpt-usage.timer; else fu="ccgpt-usage@$LANE_ID.timer"; fi
  wanted "$fu" && [ "$(systemctl --user is-active "$fu")" = active ] && ok "lane $n: foreign usage timer $fu enabled and active" \
    || miss "lane $n: foreign usage timer $fu is not enabled and active"
  wanted "ccrc-codex-usage@$LANE_ID.timer" && miss "lane $n: ccrc's usage instance is already enabled" || ok "lane $n: no ccrc usage instance"
  ad="$HOME/$LANE_AUTH_DIR"
  [ -d "$ad" ] && [ ! -L "$ad" ] && [ "$(stat -c %a -- "$ad")" = 700 ] && ok "lane $n: authDir is a 0700 directory" || miss "lane $n: authDir is not a 0700 directory"
  [ -f "$ad/auth.json" ] && [ "$(stat -c %a -- "$ad/auth.json")" = 600 ] \
    && ok "lane $n: auth.json is 0600, last written $(age_h "$ad/auth.json") h ago" || miss "lane $n: auth.json is absent or not 0600"
  sj="$HOME/$LANE_CONFIG_DIR/settings.json"
  [ -f "$sj" ] && ok "lane $n: settings.json $(stat -c '%F, mode %a' -- "$sj"), alwaysThinkingEnabled set: $(jq 'has("alwaysThinkingEnabled")' "$sj" 2>/dev/null)" \
    || miss "lane $n: settings.json is absent"
  lr="$HOME/.cc-limits/$LANE_ID.json"
  [ -f "$lr" ] && note "lane $n: usage row $(( ( $(date +%s) - $(jq -r '.ts // 0' "$lr") ) / 60 )) min old (the other repository's writer)" || note "lane $n: no usage row"
  cnt=0; for f in "$REG"/*.wrapper; do [ -f "$f" ] && [ "$(head -n1 -- "$f")" = "$LANE_ID" ] && cnt=$((cnt + 1)); done
  set -- $LANE_SESSIONS
  if [ -n "${FLIPPED-}" ]; then fix="a lane is flipped, so B1 Step 2 is never re-run: re-record lane $n alone, vset L${n}_SESSIONS and vset L${n}_SESSION_COUNT from the exact-line .wrapper read (B1 Step 3's Stop), then re-run this census"
  else fix="re-run B1 Step 2"; fi
  [ "$cnt" = "$#" ] && ok "lane $n: $cnt session row(s), as recorded" || miss "lane $n: $cnt session row(s) now, $# recorded; $fix"
  for sid in $LANE_SESSIONS; do
    st="$(systemctl --user is-active "claude-session@$sid.service" 2>/dev/null)"
    [ "$st" = active ] && ok "lane $n: claude-session@$sid active" || miss "lane $n: claude-session@$sid is ${st:-unknown}; it cannot be parked"
  done
done
if [ -z "${FLIPPED-}" ]; then
  [ -e "$HOME/.ccrc/codex" ] && miss "box: ~/.ccrc/codex exists before any flip" || ok "box: no ~/.ccrc/codex"
fi
rt="$("$B/ccgpt-runtime" check 2>&1)"; rrc=$?
if [ -z "${RUNTIME_GEN-}" ]; then
  [ "$rrc" = 1 ] && [ "$rt" = "ccgpt-runtime: absent" ] && ok "box: no runtime yet (B2 builds it)" || miss "box: runtime check answered rc $rrc: $rt; expected absent"
else
  case "$rt" in
    "ccgpt-runtime: current $RUNTIME_GEN "*) [ "$rrc" = 0 ] && ok "box: runtime current, B2's generation" || miss "box: runtime check rc $rrc" ;;
    *) miss "box: runtime check answered rc $rrc: $rt; expected B2's generation current" ;;
  esac
fi
for u in ccrc-codex-usage@.service ccrc-codex-usage@.timer; do [ -f "$UNITDIR/$u" ] && ok "box: $u placed" || miss "box: $u not placed"; done
for l in "$WANTS"/ccrc-codex-usage@*.timer; do
  [ -L "$l" ] || [ -e "$l" ] || continue
  i="${l##*/ccrc-codex-usage@}"; i="${i%.timer}"
  [ "$i" = "${L1_ID-}" ] && flipped 1 && continue
  [ "$i" = "${L2_ID-}" ] && flipped 2 && continue
  miss "box: ccrc-codex-usage@$i.timer is enabled for an id that is not a flipped lane"
done
for f in ccgpt-proxy.py ccgpt-usage.py ccgpt-runtime ccrc-codex; do cmp -s "$B/$f" "$HOME/ccrc/ccd/$f" && ok "box: placed $f = tree" || miss "box: placed $f differs from the tree"; done
w="$(head -n1 -- "$REG/${CONTROLLER_SID-}.wrapper" 2>/dev/null)"
[ -n "$w" ] && [ "$w" != "${L1_ID-}" ] && [ "$w" != "${L2_ID-}" ] && ok "box: the controller's session is on no GPT lane" || miss "box: the controller's session is on a GPT lane, or unknown"
for d in "$HOME" "${TMPDIR:-/tmp}"; do
  a="$(df --output=avail -B1G -- "$d" | tail -n1 | tr -d ' ')"
  [ "${a:-0}" -ge 2 ] && ok "disk: $a GiB free under $d" || miss "disk: ${a:-?} GiB free under $d; 2 needed"
done
a="$(awk '/^MemAvailable:/ { print int($2 / 1048576) }' /proc/meminfo)"
[ "${a:-0}" -ge 2 ] && ok "memory: $a GiB available" || miss "memory: ${a:-?} GiB available; 2 needed"
pp="$(systemctl --user show-environment 2>/dev/null | sed -n 's/^PATH=//p')"
[ -n "$pp" ] && env -i PATH="$pp" sh -c 'command -v node' >/dev/null 2>&1 \
  && ok "box: node resolves on the user manager's PATH, which a supervised pane inherits" || miss "box: node is not on the user manager's PATH"
echo "-- units: name load active sub"
systemctl --user list-units --all --no-legend --plain 'ccgpt-*' 'ccrc-codex-usage@*' | awk '{ print "unit    ", $1, $2, $3, $4 }'
echo "-- timers: name, enabled link, next elapse"
for t in ccgpt-usage.timer "ccgpt-usage@${L2_ID-}.timer" ccrc-models.timer; do
  printf 'timer    %s %s %s\n' "$t" "$(wanted "$t" && echo linked || echo unlinked)" "$(systemctl --user show -p NextElapseUSecRealtime --value "$t" 2>/dev/null)"
done
} > "$raw" 2>&1
redact < "$raw" > "$out"; rm -f -- "$raw"
m="$(grep -c '^MISMATCH' "$out")"; echo "census: $([ "$m" = 0 ] && echo MATCH || echo "MISMATCH ($m)")" >> "$out"
cat "$out"; [ "$m" = 0 ]
EOF
chmod 700 "$PB/b1-census.sh"
"$PB/b1-census.sh" "$SCRATCH/plan3b-env.sh"; echo "census rc=$?"
```

- **Expected**, against the 2026-10-05 shape. Every check line is `ok` or `note`, the last two lines are `census: MATCH` and `census rc=0`, and in particular:
  - `roster: 0 codex-kind row(s)`;
  - per lane:
    - the row shape;
    - the models files (lane 1: all four; lane 2: `effort.json` alone);
    - both foreign tiers `active`, with each recorded port held by that unit's MainPID;
    - its foreign usage timer (lane 1: the flat `ccgpt-usage.timer`; lane 2: `ccgpt-usage@<lane-id>.timer`) linked and active, and no ccrc instance;
    - `authDir` 0700 with a 0600 `auth.json`;
    - every recorded session's `claude-session@<session-id>` active;
  - `box: no ~/.ccrc/codex`, and `box: no runtime yet (B2 builds it)`;
  - both `ccrc-codex-usage@` template files placed, and the four GPT-lane executables equal to the tree;
  - the controller on no GPT lane;
  - at least 2 GiB of disk under `$HOME` and under the temp root, and 2 GiB of memory available. That is the carry-forward's floor; the first generation is about 650 MB, and the swap peak about 2 GB;
  - `node` on the user manager's PATH. That PATH is what a supervised pane inherits, and `ccrc-codex` refuses `no-node` without it;
  - the `note` lines record lane 1's catalogue age and `stale` flag, each `auth.json` age, and the usage-row ages (the carry-forward's dead-refresh-token reads). A catalogue stale for more than a day, or an `auth.json` older than about a week, is said to the operator, because B3's refresh-before-session proof is where a dead token stops the window.
- **Stop:** any `MISMATCH` line, and nothing is done (the carry-forward's step 1, ruling B-9). The line names the fact.
  - A changed session count is cured by re-recording, never by editing the census. While `FLIPPED` is empty, re-run Step 2. Once a lane is flipped, Step 2 is never re-run (its rule above): re-record only the still-unflipped lane `<n>` the MISMATCH line names, both keys from the census's own exact-line `.wrapper` read, then re-run the census. The MISMATCH line names this cure:

    ```bash
    ( . "<abs scratch>/plan3b-exec/plan3b-env.sh" && lane <n> \
      && { case " ${FLIPPED-} " in *" <n> "*) echo "lane <n> is flipped: not re-recorded"; exit 1 ;; esac; } \
      && s="$(for f in "$REG"/*.wrapper; do [ -f "$f" ] && [ "$(head -n1 -- "$f")" = "$LANE_ID" ] && { b="${f##*/}"; echo "${b%.wrapper}"; }; done | paste -sd ' ' -)" \
      && vset "L<n>_SESSIONS" "$s" && set -- $s && vset "L<n>_SESSION_COUNT" "$#" && echo "lane <n>: $# session row(s) re-recorded" \
      && "$PB/b1-census.sh" "$SCRATCH/plan3b-env.sh" | tail -n 1 )
    ```

    Expected: `lane <n>: <count> session row(s) re-recorded`, then `census: MATCH`. It writes those two keys only, in the values file, and nothing on the box. A refusal, or a census still MISMATCH, stops the window.
  - A session whose unit is not `active` is ruling B-2's "a failed unit": that lane's window cannot open until the operator rules on it.
  - Any other mismatch goes to the operator with the redacted line.
- **Rollback:** none.
- **Authorisation:** read-only.

- [ ] **Step 4: Z4's measurement, R-O1's input.** Read-only. Between the flips the hourly monitor is B4's criterion 8, and B3 Step 19 records each window's own baseline; this script may be re-run any time for comparison.

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
cat > "$PB/b1-z4.sh" <<'EOF'
#!/usr/bin/env bash
# b1-z4.sh <plan3b-env.sh> [days]: Z4's read-only measurement (Task B1 Step 4; re-runnable any
# time for comparison, also while one lane is codex and lane 1 is not). Counts only: which LiteLLM processes run on
# which config class; which of them `_models_litellm_running`'s own predicate matches; how
# often lane 1's box-global render changed; what the hourly refresh answered for lane 1; and
# the refresh service's last result.
set -uo pipefail
. "$1" || exit 2
days="${2:-7}"; lane 1 || exit 2
{
g=0 s=0 c=0 o=0
while read -r _ args; do
  case "$args" in
    *"--config $GLOBAL_RENDER "*|*"--config $GLOBAL_RENDER") g=$((g + 1)) ;;
    *"--config $HOME/.handoff/litellm-config-"*) s=$((s + 1)) ;;
    *"/.ccrc/codex/"*) c=$((c + 1)) ;;
    *) o=$((o + 1)) ;;
  esac
done < <(pgrep -a -f 'litellm .*--config' 2>/dev/null)
echo "litellm processes: box-global config $g, lane-suffixed config $s, a ccrc lane's own config $c, other $o"
m="$(pgrep -f "litellm .*$GLOBAL_RENDER" 2>/dev/null)"
mp="$(systemctl --user show -p MainPID --value "ccgpt-$LANE_ID-litellm.service" 2>/dev/null)"
echo "the box-global predicate matches $(printf '%s\n' "$m" | grep -c .) process(es); lane 1's foreign LiteLLM is $(printf '%s\n' "$m" | grep -qx "${mp:-none}" && echo one of them || echo not one of them)"
for f in "$MODELS/$LANE_ID.classes.json" "$MODELS/$LANE_ID.json" "$MODELS/$LANE_ID.classes.tsv" "$GLOBAL_RENDER"; do
  if [ -e "$f" ]; then echo "mtime: ${f##*/} $(( ( $(date +%s) - $(stat -c %Y -- "$f") ) / 3600 )) h ago"; else echo "mtime: ${f##*/} absent"; fi
done
j="$(journalctl --user -u ccrc-models.service --since "-$days days" -o cat --no-pager 2>/dev/null | grep '^{"ok":')"
echo "refresh runs in the journal over $days day(s): $(printf '%s\n' "$j" | grep -c .)"
printf '%s\n' "$j" | grep . | jq -r --arg id "$LANE_ID" '
  ([.refreshed[] | select(.id == $id)][0]) as $r
  | if $r == null then "lane 1 absent"
    elif $r.ok then "lane 1 ok, litellm " + ($r.litellm // "none")
    elif (($r.reason // "") | test("ccrc will not stop it")) then "lane 1 refused by Z4 (restart-failed)"
    elif (($r.reason // "") | test("PREVIOUS config")) then "lane 1 restart-failed (another arm)"
    else "lane 1 failed" end' | sort | uniq -c | sed 's/^ */  /'
echo "ccrc-models.service: $(systemctl --user show -p ActiveState -p Result ccrc-models.service | tr '\n' ' ')"
echo "ccrc-models.timer: $(systemctl --user show -p LastTriggerUSec -p NextElapseUSecRealtime ccrc-models.timer | tr '\n' ' ')"
} 2>&1 | redact | tee "$PB/evidence/b1-z4-$(date -u +%Y%m%dT%H%M%SZ).txt"
EOF
chmod 700 "$PB/b1-z4.sh"
"$PB/b1-z4.sh" "$SCRATCH/plan3b-env.sh" 7
```

- **Expected, measured 2026-10-05 in shape:**
  - `box-global config 1` and `lane-suffixed config 1`;
  - `the box-global predicate matches 1 process(es); lane 1's foreign LiteLLM is one of them`. That is the predicate `_models_litellm_running` asks (`ccd/ccrc`), so Z4 is live today, not hypothetical;
  - four `mtime:` lines;
  - the refresh-run count, with one `lane 1 ok, litellm rendered|unchanged` tally per word;
  - the service's `Result=success`, and the timer's last and next fire. The next fire is what B3's window must fall outside: the timer is `OnUnitActiveSec=60min`, `AccuracySec=5min`.
- **How the numbers are read (ruling B-1).** Each `lane 1 ok, litellm rendered` run is an hour in which lane 1's box-global render changed. Today that run reached the external arm's bare `ccgpt stop`. Once any lane is codex, the same run is refused by Z4 instead: a `restart-failed` row, `ccrc models refresh --all` exiting 1, and `ccrc-models.service` failed. Meanwhile lane 1 keeps serving its unchanged config. So the `rendered` count over the journal's span is the measured frequency of the bounded degradation that the order "lane 2 first" accepts until lane 1's flip. `unchanged` runs are unaffected.
- **Stop:** none for this step, which only measures. Its numbers are R-O1's input in Step 9.
  - If no process matches the predicate, or lane 1's LiteLLM is not the one that does, the order consequence differs from the one the rulings describe. Step 9 says so to the operator.
  - If the journal holds no refresh run at all, that is said too: the frequency is then unmeasured, and the render mtime is the only reading.
- **Rollback:** none.
- **Authorisation:** read-only.

- [ ] **Step 5: The parking forecast and the park target.** Read-only. The operator then chooses `<park-target-wrapper>`.

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
cat > "$PB/b1-park.py" <<'EOF'
#!/usr/bin/env python3
# b1-park.py <values.sh> <map-out>: Task B1 Step 5, read-only. For each GPT-lane session, its
# project's pool word as `_project_pool_state` would spell it (ccd/ccd); for each account that
# could take a parked session, its usage and its pool forecast against those projects. ccd's
# own swap decides at the act (B3); this is a forecast. Candidate ids go only to <map-out>.
import json, os, re, shlex, sys
H = os.environ['HOME']; REG = os.path.join(H, '.cc-sessions')
vals = {}
for line in open(sys.argv[1]):
    k, sep, v = line.rstrip('\n').partition('=')
    if sep: vals[k] = ' '.join(shlex.split(v))
def proj_word(sid):
    try:
        with open(os.path.join(REG, sid + '.project')) as f: p = f.readline().strip()
    except FileNotFoundError:
        return 'untagged', None
    except OSError:
        return 'unreadable', None
    if not p: return 'untagged', None
    d = os.path.join(REG, 'pools')
    if not os.path.lexists(d): return 'untagged', None
    if not os.path.isdir(d): return 'unreadable', None
    f = os.path.join(d, p)
    if not os.path.lexists(f): return 'untagged', None
    if not os.path.isfile(f): return 'unreadable', None
    try:
        with open(f, 'rb') as fh: name = fh.read(64).decode('ascii').strip()
    except (OSError, UnicodeDecodeError):
        return 'unreadable', None
    return ('named', name) if re.fullmatch(r'[A-Za-z0-9._-]{1,63}', name) else ('malformed', None)
rows = json.load(open(os.path.join(H, '.ccrc', 'accounts.json')))['accounts']
central = {}
ep = os.path.join(REG, 'pool-epoch')
if os.path.isfile(ep):
    for l in open(ep):
        f = l.split()
        if len(f) == 3 and f[0] == 'acct': central[f[1]] = f[2]
def acct_pool(a):
    return central.get(a['id']) if os.path.isfile(ep) else a.get('pool')
words = []
for n in ('1', '2'):
    sids = vals.get(f'L{n}_SESSIONS', '').split()
    ws = [proj_word(s) for s in sids]; words += ws
    held = sum(os.path.exists(os.path.join(REG, s + '.hold')) for s in sids)
    tally = {w: sum(1 for x, _ in ws if x == w) for w in ('untagged', 'named', 'unreadable', 'malformed')}
    print(f'lane {n}: {len(sids)} session(s); project pools: ' + ', '.join(f'{v} {k}' for k, v in tally.items()) + f'; held by a programme: {held}')
gptids = {vals.get('L1_ID'), vals.get('L2_ID')}
cands = []
for a in rows:
    e = a.get('exec') or {}
    if a["id"] in gptids or a.get('telemetry') == 'codex' or e.get('kind') not in ('upstream', 'generated'): continue
    if e.get('kind') == 'generated' and e.get('provider', 'anthropic') != 'anthropic': continue
    if not a.get('homeAble'): continue
    if not os.access(os.path.join(H, '.local', 'bin', a['id']), os.X_OK): continue
    if os.path.lexists(os.path.join(REG, a['id'] + '-disabled')): continue
    cands.append(a)
fd = os.open(sys.argv[2], os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, 'w') as m:
    for i, a in enumerate(cands, 1):
        m.write(f'c{i}={a["id"]}\n')
        try:
            lim = json.load(open(os.path.join(H, '.cc-limits', a['id'] + '.json')))
            use = f'five {lim.get("five")}%, seven {lim.get("seven")}%'
        except (OSError, ValueError):
            use = 'no usage row'
        ap = acct_pool(a)
        # _pool_ok (ccd/ccd): an untagged project, or an untagged account, serves; two names must agree
        serve = sum(1 for w, p in words if w == 'untagged' or (w == 'named' and (ap is None or p == ap)))
        undec = sum(1 for w, _ in words if w in ('unreadable', 'malformed'))
        print(f'candidate c{i}: kind {a["exec"]["kind"]}; {use}; pool forecast serves {serve}/{len(words)} lane session(s), {undec} undecidable')
print(f'park-map: {len(cands)} candidate(s) written 0600')
EOF
chmod 700 "$PB/b1-park.py"
python3 "$PB/b1-park.py" "$VALUES" "$PB/park-map.txt" | redact | tee "$PB/evidence/b1-park.txt"
```

- **Expected:**
  - one `lane <n>:` line per lane, with its project-pool tally and the number of sessions a programme holds. Those held sessions are workers or coordinators: B3 parks a coordinator only between its waves (ruling B-2);
  - one `candidate c<k>:` line per account that could take a parked session: rostered, Anthropic-backed, home-able, an executable launcher, and no `-disabled` marker;
  - `park-map: <k> candidate(s) written 0600`.
- **Then the operator chooses.** The operator reads the candidate lines, and `park-map.txt` privately if they wish. They name one `c<k>` with headroom for the larger lane's sessions, and that judgement is theirs (ruling B-2: "no headroom" is never a refusal ccd issues for a manual swap). The controller records it:

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
k='c<k>'   # the operator's choice
t="$(sed -n "s/^$k=//p" "$PB/park-map.txt")"; [ -n "$t" ] && vset PARK_TARGET "$t" && echo "PARK_TARGET recorded" | redact
```

- **Stop:**
  - any session whose project word is `unreadable` or `malformed`. ccd's swap dies on an undecidable pool even under `--cross-pool` (`_pool_ok` rc 2, `ccd/ccd`), so that session cannot be parked (ruling B-2), and the operator repairs its tag first;
  - no candidate serves every lane session by the forecast. Either the operator names a target in the sessions' pool, or rules `--cross-pool` for named sessions as a recorded decision in `rulings.txt` (ruling B-2);
  - no candidate at all.
- **Rollback:** delete `PARK_TARGET` from the values file (`vset PARK_TARGET ''`).
- **Authorisation:** read-only. The choice is the operator's own act, recorded.

- [ ] **Step 6: Update intent, the doctor's classes, and the refresh timer.** Read-only.

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
{ "$B/ccrc" update --check 2>&1 | head -n1
  "$B/ccrc" channel 2>&1 | head -n1; } | redact | tee "$PB/evidence/b1-update.txt"
c="$("$B/ccrc" channel 2>/dev/null | head -n1)"
vset PRIOR_AUTO "$(printf '%s' "$c" | sed -n 's/.* auto=\([^ ]*\).*/\1/p')"
vset PRIOR_CHANNEL "$(printf '%s' "$c" | sed -n 's/.* channel=\([^ ]*\) .*/\1/p')"
"$B/ccrc" doctor > "$PB/evidence/.doctor-raw" 2>&1; drc=$?
awk '/^(PASS|WARN|FAIL|SKIP) [a-z0-9-]+:/ { c = $2; sub(/:$/, "", c); print c, $1 }' "$PB/evidence/.doctor-raw" | sort -u > "$PB/evidence/b1-doctor-classes.txt"
grep '^summary: ' "$PB/evidence/.doctor-raw" | redact; rm -f -- "$PB/evidence/.doctor-raw"
echo "doctor rc=$drc; codex row: $(sed -n 's/^codex //p' "$PB/evidence/b1-doctor-classes.txt" | tr '\n' ' ')"
echo "FAIL rows: $(awk '$2 == "FAIL" { print $1 }' "$PB/evidence/b1-doctor-classes.txt" | tr '\n' ' ')"
echo "WARN rows: $(awk '$2 == "WARN" { print $1 }' "$PB/evidence/b1-doctor-classes.txt" | tr '\n' ' ')"
if [ -s "$PB/doctor-classes-pre-partA.txt" ]; then diff "$PB/doctor-classes-pre-partA.txt" "$PB/evidence/b1-doctor-classes.txt" && echo "classes: as before Part A"; fi
```

- **Expected:**
  - `check: box=… projection=<ok|none> state=current`. `none` is a converged managed node: the control plane names nothing newer;
  - `channel: state=<ok|none> channel=<dev|stable> … auto=<channel|stable>`;
  - doctor's `summary:` line, `codex row: SKIP` (no codex lane and no lane state; Plan 3a's merge measurement and ruling Z7), and `FAIL rows:` empty;
  - each `WARN` row named, by check name only. The controller recorded `doctor-classes-pre-partA.txt` before Part A's merge ([Authorisation shapes](#authorisation-shapes)), so every non-codex class equals it (`classes: as before Part A`). If that capture is missing, the operator reads the WARN names and accepts each by name, recorded in `rulings.txt`.
- **Then the operator reads the control plane (read-only, in their own browser session).** They open `GET /api/updates` and record two facts in `rulings.txt`, as `FLEET-INTENT: auto <a> channel <c>` and `NODE-ROW: <yes|no>`:
  - the fleet-scope (`*`) row's `auto` and `channel`, the values B3's pause restores (ruling B-6);
  - whether an `intent` row exists with `scope` equal to `<nodeId>`. A node-scoped row overrides the fleet row for that node (`resolveNodeIntent`, `server/src/update/resolve.ts`: `input.nodeIntent ?? input.fleetIntent`). If one exists, a fleet-wide pause in the PWA does not pause the fleet box. B3's pause must then be that node row's `auto: "off"`, through the API, since the PWA's Settings screen writes only `*` (ruling B-6).
- **Stop:**
  - `state=` other than `current`: wait for the update mechanism, then re-run;
  - `projection=` `unreadable`, `stale` or `malformed`;
  - any doctor `FAIL` row;
  - `codex` not exactly `SKIP`.
- **Rollback:** none.
- **Authorisation:** read-only.

- [ ] **Step 7: Each lane's flip, validated now by the shipped parser, in a scratch HOME.** Read-only on the box. B3 re-runs `b1-candidate.sh` and `b1-dryrun.mjs` on the then-current roster for the real edit, so the roster change is spelled once.

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
cat > "$PB/b1-candidate.sh" <<'EOF'
#!/usr/bin/env bash
# b1-candidate.sh <plan3b-env.sh> <lane> <in-roster> <out-roster>: the ONE spelling of a lane's
# flip. Its exec block becomes kind codex, with its own two ports and its existing authDir
# (adoption, spec §9.2; R-O3 keeps the ports); every other field and every other row is kept.
# Refuses unless the input carries exactly one external row with the lane's id. Writes <out> 0600.
set -euo pipefail
. "$1"; lane "$2"
jq --arg id "$LANE_ID" --argjson sp "$LANE_SHIM_PORT" --argjson lp "$LANE_LITELLM_PORT" --arg ad "$LANE_AUTH_DIR" '
  if ([.accounts[] | select(.id == $id and .exec.kind == "external")] | length) != 1
  then error("the lane is not exactly one external row in this roster") else . end
  | .accounts |= map(if .id == $id
      then .exec = {kind: "codex", provider: "openai", proxyPort: $sp, litellmPort: $lp, authDir: $ad}
      else . end)' "$3" > "$4"
EOF
cat > "$PB/b1-dryrun.mjs" <<'EOF'
// b1-dryrun.mjs <roster.js> <candidate.json>: the SHIPPED parser (the release tree the box runs,
// built by the release workflow) over one candidate roster. Prints `parsed: …` or the
// RosterError's message and remedy, for the caller to redact. Reads only the candidate file.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const [rjs, file] = process.argv.slice(2);
const { parseRoster } = await import(pathToFileURL(rjs).href);
try {
  const r = parseRoster(JSON.parse(readFileSync(file, 'utf8')));
  console.log(`parsed: ${r.accounts.length} rows, codex-kind ${r.accounts.filter((a) => a.exec.kind === 'codex').length}`);
} catch (e) {
  console.log(`refused: ${e.message}`);
  if (e.remedy) console.log(`remedy: ${e.remedy}`);
  process.exitCode = 1;
}
EOF
chmod 700 "$PB/b1-candidate.sh"
D="$PB/dry"; rm -rf -- "$D"; mkdir -p "$D/home"; RJS="$HOME/ccrc/server/dist/shared/roster.js"
cp -p -- "$HOME/.ccrc/accounts.json" "$D/live.json"
"$PB/b1-candidate.sh" "$SCRATCH/plan3b-env.sh" 1 "$D/live.json" "$D/lane1.json"
"$PB/b1-candidate.sh" "$SCRATCH/plan3b-env.sh" 2 "$D/live.json" "$D/lane2.json"
"$PB/b1-candidate.sh" "$SCRATCH/plan3b-env.sh" 2 "$D/lane1.json" "$D/both.json"
for c in live lane1 lane2 both; do
  printf '%s: ' "$c"; env HOME="$D/home" node "$PB/b1-dryrun.mjs" "$RJS" "$D/$c.json" 2>&1 | redact
done
cmp -s "$D/live.json" "$HOME/.ccrc/accounts.json" && echo "live roster untouched"
```

- **Expected:** `live: parsed: <r> rows, codex-kind 0`, `lane1: parsed: <r> rows, codex-kind 1`, `lane2: parsed: <r> rows, codex-kind 1` and `both: parsed: <r> rows, codex-kind 2`, then `live roster untouched`.
  - `RJS` is the release tree's own `server/dist/shared/roster.js`. That is the parser the box's server and ccrc were built with: it exists on the box (measured 2026-10-05), so no `npm run build` runs inside a window.
  - `both` proves the four ports are pairwise distinct across the two lanes, which `parseRoster` requires of every codex lane together (`shared/roster.ts`, one shared port map).
- **Stop:**
  - any `refused:` line. Its redacted message and remedy name the field (an `authDir` the parser refuses, a port out of range, two equal ports). It is a stop, never an edit to make it pass: the values come from the lane as it runs (ruling B-7);
  - `b1-candidate.sh` refusing (`the lane is not exactly one external row`).
- **Rollback:** none on the box. `$PB/dry` is scratch.
- **Authorisation:** read-only.

- [ ] **Step 8: The GPT-lane section of the gitignored reference file (ruling B-9).** No live act. The writes are the controller's scratch and the operator's gitignored reference file, which ruling B-9 assigns to this task.

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
P="$(git worktree list --porcelain | sed -n '1s/^worktree //p')"; R="$P/deploy/reference-fleet.md"
git -C "$P" check-ignore -q deploy/reference-fleet.md || { echo "reference file is not gitignored there: stop"; exit 1; }
[ -f "$R" ] && cp -p -- "$R" "$PB/reference-fleet.md.pre-b1-$(date -u +%Y%m%dT%H%M%SZ)"
vset CENSUS_UTC "$(date -u +%Y-%m-%dT%H:%MZ)"
cat > "$PB/b1-reference.py" <<'EOF'
#!/usr/bin/env python3
# b1-reference.py <values.sh> <reference-fleet.md>: the GPT-lane section of the gitignored
# reference file (ruling B-9), between two marker lines, replaced whole on a re-run; every other
# byte of the file is kept, and so is its mode. Prints a line count, never a value.
import os, shlex, sys
vals = {}
for line in open(sys.argv[1]):
    k, sep, v = line.rstrip('\n').partition('=')
    if sep: vals[k] = ' '.join(shlex.split(v))
g = lambda k: vals.get(k) or '—'
BEGIN, END = '<!-- plan3b:lane-values:begin -->', '<!-- plan3b:lane-values:end -->'
rows = [('`<lane-id>`', 'ID'), ('`<lane-shim-port>` (exec.proxyPort)', 'SHIM_PORT'),
        ('`<lane-litellm-port>` (exec.litellmPort)', 'LITELLM_PORT'), ('`<lane-auth-dir>` (exec.authDir)', 'AUTH_DIR'),
        ('`<lane-config-dir>`', 'CONFIG_DIR'), ('entry file', 'ENTRY'), ('class registry before its flip', 'REGISTRY'),
        ('`<session-id>`s at the census', 'SESSIONS')]
sec = [BEGIN, '## GPT lanes — Plan 3b (measured read-only by Task B1; operator-only)', '',
       f'Census {g("CENSUS_UTC")}. The values file is Part B scratch `values.sh` (0600).', '',
       '| Parameter | lane 1 | lane 2 |', '|---|---|---|']
sec += [f'| {label} | {g("L1_" + k)} | {g("L2_" + k)} |' for label, k in rows]
sec += ['', f'- `<nodeId>` (fleet box): {g("NODE_ID")}', f'- `<park-target-wrapper>`: {g("PARK_TARGET")}',
        f'- flip order (R-O1): {g("FLIP_ORDER")}; flipped: {g("FLIPPED")}',
        f'- runtime (B2): {g("RUNTIME_GEN")}, litellm {g("RUNTIME_LITELLM")}, {g("RUNTIME_CANARY")}',
        f'- update intent before the windows (this node\'s projection): auto {g("PRIOR_AUTO")}, channel {g("PRIOR_CHANNEL")}', END]
p = sys.argv[2]
text = open(p).read() if os.path.exists(p) else ''
mode = os.stat(p).st_mode & 0o777 if os.path.exists(p) else 0o600
if BEGIN in text and END in text:
    pre, rest = text.split(BEGIN, 1); post = rest.split(END, 1)[1]
    text = pre + '\n'.join(sec) + post
else:
    text = text.rstrip('\n') + '\n\n' + '\n'.join(sec) + '\n'
with open(p + '.tmp', 'w') as f: f.write(text)
os.chmod(p + '.tmp', mode); os.replace(p + '.tmp', p)
print(f'reference: GPT-lane section {len(sec)} lines written; file mode {oct(mode)[2:]}')
EOF
chmod 700 "$PB/b1-reference.py"
python3 "$PB/b1-reference.py" "$VALUES" "$R"
git -C "$P" status --porcelain -- deploy/reference-fleet.md | wc -l   # 0: still ignored, nothing tracked moved
```

- **Expected:** `reference: GPT-lane section 22 lines written; file mode <its mode>`, then `0`. B2 Step 5 and B3 re-run `b1-reference.py` after they add `RUNTIME_*`, `FLIP_ORDER` or `FLIPPED`.
- **Stop:** the file is not gitignored in the primary checkout, or `git status` reports it. Then nothing is written there, and the values file stays the only record.
- **Rollback:** copy `reference-fleet.md.pre-b1-<UTC>` back over the file with `cp -p`.
- **Authorisation:** covered by ruling B-9. No live act.

- [ ] **Step 9: The operator's rulings, confirmed against this census.** Read-only. The controller states each ruling with its recommendation and the census facts it rests on. The operator answers each one, and each answer is recorded verbatim as one `<KEY>: <answer>` line of `$PB/rulings.txt`, the key being the ruling's name (`R-O1` … `R-O9`, `R-S1`, `R-C10`, `R-C11`). Optional lines record a `CROSS-POOL: <session-id> …` decision (Step 5) and a `WARN-ACCEPTED: <check> …` acceptance (Step 6). `FLIP_ORDER` is set with `vset`. Nothing in B2-B4 runs on a ruling this step did not record.

  - **R-O1, the order. It is an open operator ruling, ruled at plan review and confirmed here (ruling B-1).** Recommendation: lane 2 first (`vset FLIP_ORDER "2 1"`).

    | | Lane 2 first (recommended) | Lane 1 first |
    |---|---|---|
    | First live window parks | Step 2's `<s2>` session(s): one at the census | Step 2's `<s1>`: six at the census |
    | Lane with a registry before its flip | no: `init codex` follows its roster flip (Z3) | yes: no `init` |
    | Z4 between the flips | from lane 2's flip until lane 1's, each hourly run that re-renders lane 1 while its foreign proxy runs on the box-global config is refused: a `restart-failed` row, `ccrc models refresh --all` exit 1, and `ccrc-models.service` failed. Lane 1 keeps serving its unchanged config. Step 4 measured how often that run happens (its `rendered` count) | none: after lane 1's flip no external lane has a registry, and lane 2's proxy runs a lane-suffixed config, which the box-global predicate never matches (Step 4) |
    | Read-only monitor until the second flip | B4's criterion 8 (`b4-sample.sh`); its baseline is B3 Step 19's record, and `b1-z4.sh` (Step 4) is the measurement R-O1 rests on. A `lane 1 refused by Z4` tally is expected; a refusal on the flipped lane is not (ruling B-10) | not needed |

    The recommendation rests on the session counts. If Step 2 counted no fewer sessions on lane 2 than on lane 1, it is re-put to the operator, not assumed. It also rests on Step 4 finding lane 1's process the one the predicate matches: if it does not, the Z4 row is re-stated from what Step 4 measured.
  - **R-O2, parking (ruling B-2).** Every live session on the lane is parked with `ccd swap <session-id> <park-target-wrapper>` at a measured idle point, before the entry file moves, and un-parked symmetrically after verification. The park target is Step 5's recorded choice. Any `--cross-pool` is named per session here, or not at all.
  - **R-O3:** keep each lane's port pair, which Step 2 measured and Step 7 validated.
  - **R-O4, `settings.json` after the cutover:** freeze it. On `alwaysThinkingEnabled`, the measurement R-O4 asked for: ccrc's shim pops `thinking` (and `output_config`) on every `/messages` request and sets Codex's `reasoning.effort` itself. That is `ccd/ccgpt-proxy.py`'s `_apply_effort`, pinned by `server/test/ccgpt-proxy.test.ts`'s `strips both output_config and thinking when an explicit effort is sent` and `strips thinking even when output_config is absent entirely and no lane default applies (ruling §5)`; the second was run green alone while this plan was drafted. So the key has no effect on a codex lane's wire. Recommendation: leave it as written, because no ccrc writer owns it. Step 3's census recorded whether each lane's `settings.json` sets it.
  - **R-O5:** mirror both lanes' exec blocks into the server box's roster at close-out, after both verify, behind critic #14's census.
  - **R-O6, as amended by ruling B-6.** The operator pauses fleet-wide in the PWA for each lane window, and restores Step 6's recorded fleet `auto` and `channel` after verification. If Step 6 found a node-scoped row for `<nodeId>`, that row is paused through `POST /api/updates/intent` instead. `auto: "off"` stops the scheduler only, never a hand update, and `update.lock` is not a pause.
  - **R-O7:** B6 Step 8 takes the box-local 0600 snapshot of the other repository's launcher at close-out, and Plan 4 Task 4 verifies it, byte-equal by hash to Step 2's `CCGPT_SHA256`, before any `rm`. Plan 3b never moves, edits or deletes `~/.local/bin/ccgpt` (ruling B-3).
  - **R-O8:** trim the two box-swap records in place (Plan 4; ruling S2).
  - **R-O9:** one full weekly usage window on both lanes before Plan 4, measured reset to reset from each lane's limits-row `sevenResetAt` (B6 Step 7).
  - **R-S1, each soak gate (B4):** at least 24 h, with one hourly refresh taking the codex arm and one auto-update landing while the lane is codex (ruling R8).
  - **R-C11, account removal's wait:** `CCRC_ACCT_USAGE_WAIT_S`'s default of 300 s, held under the placement lock (ruling R16). No Part B step runs `ccrc account remove`, so this is recorded for the merged build, not exercised here.
  - **R-C10, ccrc's usage instance (ruling B-5).** From the measured command reference, there are three routes.
    - **(a) The targeted enable, recommended:** `systemctl --user enable --now ccrc-codex-usage@<lane-id>.timer`. It is the exact verb `_inst_enable_timer` runs on that ccrc-owned unit (`ccd/ccrc`). Run only after the operator has disabled the lane's foreign usage timer, it is what the next auto-update's `_inst_codex_usage` converge would itself leave, so that update is a no-op over it.
    - **(b) Wait for the next auto-update's converge.** The lane then publishes no ccrc usage row until a release happens to land. Doctor's no-row WARN is suppressed only for 2700 s after an enable, and there would be no enable.
    - **(c) A hand `ccrc install` or `ccrc update`.** It is refused by the 2026-09-30 ruling.

    The operator answers (a) or (b).
  - **The WARN rows** Step 6 left for acceptance by name, if any.

- **Expected:** `rulings.txt` holds one answered line per bullet, and `FLIP_ORDER` is set.
- **Stop:** any ruling unanswered, or answered other than its recommendation without the replacement stated. The plan's later tasks are written for the recommendations, so a different answer goes back to the plan's owner before B2.
- **Rollback:** none.
- **Authorisation:** read-only. The rulings are the operator's.

- [ ] **Step 10: B1's verdict.** Read-only.

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
"$PB/b1-census.sh" "$SCRATCH/plan3b-env.sh" > /dev/null && c=ok || c=MISMATCH
miss=""; for k in R-O1 R-O2 R-O3 R-O4 R-O5 R-O6 R-O7 R-O8 R-O9 R-S1 R-C10 R-C11 FLEET-INTENT NODE-ROW; do
  grep -q "^$k: ." "$PB/rulings.txt" 2>/dev/null || miss="$miss $k"
done
[ "$c" = ok ] && [ -n "${PARK_TARGET-}" ] && [ -n "${FLIP_ORDER-}" ] && [ -z "$miss" ] \
  && { printf 'B1 OK %s\n' "$(date -u +%Y-%m-%dT%H:%MZ)" > "$PB/b1-verdict"; cat "$PB/b1-verdict"; } \
  || echo "B1 NOT OK: census $c, park target ${PARK_TARGET:+set}, flip order ${FLIP_ORDER:+set}, unanswered:${miss:- none}"
```

- **Expected:** `B1 OK <UTC>`. B2 Step 0 requires this file to be under 24 hours old, and B3 re-runs the census itself at its window's open.
- **Stop:** `B1 NOT OK`, naming which part, and which ruling keys are unanswered. The matching step is re-run.
- **Rollback:** none.
- **Authorisation:** read-only.

### Task B2: build the isolated runtime before any roster names a codex lane

**Files:**
- Created on the box, by ccrc's own builder only: `~/.ccrc/runtime/codex/gen-<UTC>-<pid>/` (a venv), its `.ccrc-runtime.json` stamp, `.ccrc-pip-report.json`, `.ccrc-probe.py` and `.ccrc-probe.stderr`, and the relative `current` symlink. `ccd/ccgpt-runtime` owns that directory whole (spec §5.2). pip's own wheel cache under `~/.cache/pip` grows too, because the builder passes no `--no-cache-dir`.
- Scratch: `$PB/evidence/b2-*`, and `values.sh` gains `RUNTIME_GEN`, `RUNTIME_LITELLM`, `RUNTIME_CANARY` and `RUNTIME_BUILT`.
- Nothing else: no roster, no unit, no timer, no wrapper and no lane directory (`~/.ccrc/codex/` stays absent).

**Interfaces:**
- Consumes B1's `b1-verdict` (at most 24 hours old), the values file, `b1-units.sh` and B1's doctor class table.
- Produces a current runtime generation, named in `RUNTIME_GEN`. B3 requires, at each window's open, that `ccgpt-runtime check` answers `current <runtime-gen>`. A release landing between B2 and a window that moved the builder's requirement or probe answers `requirement-moved` or `probe-moved` there, and B3 then re-runs this task under the same authorisation before its window opens.
- Records the raw-shape canary.

**Why:**
- **The carry-forward's step 2 and critic #13.** `ccrc codex start` and the codex probe both need a runtime. Building it inside a lane window would put a pip install of minutes, bounded only by `CCRC_RUNTIME_PIP_S` (1200 s per pip call) and `CCRC_RUNTIME_PROBE_S` (300 s), inside the window that has sessions parked. So it is built first, on its own named authorisation.
- **It is inert until a roster row is codex.**
  - `_inst_codex_runtime` builds and touches it only when `_codex_lanes` names a lane, so every auto-update before the first flip prints `install: codex runtime: none — no codex lane in the roster` and leaves it alone.
  - `_check_codex` SKIPs with no codex lane and no `~/.ccrc/codex/` state, whatever the runtime holds (`ccd/ccrc-doctor-checks`).
  - The probe's codex arm, the usage unit and the tiers each run it only for a codex row.

  So this task changes nothing that runs, and needs no update pause.
- **The probe is the acceptance test, and this build is the measurement of Plan 2b-2's range ruling (item 2b2-12).** pip installs the highest LiteLLM inside the one declared requirement (`LITELLM_REQUIREMENT` in `ccd/ccgpt-runtime`, the spec's `>=1.101.0,<1.110`), and the build becomes current only on a `behaviour_probe: PASS` line plus exit 0. A probe failure is therefore a release inside the range failing the probe: the ruling's revisit trigger.
- **Plan 3b's execution ledger records this as `runtime-built-before-the-roster-flip`** when the step fires (ruling F4: the ledger mints it, not this plan).

**Authorisation:** **the runtime-build authorisation**, one named operator act before any lane window (critic #13). It covers:
- Steps 1-3: the build, and one retry after a named transient cause (an unreachable index, or a probe `timed-out` on a loaded box);
- the rollback below.

Anything else returns to the operator.

- [ ] **Step 0: Preconditions.** Read-only.

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
v="$PB/b1-verdict"; [ -s "$v" ] && [ $(( $(date +%s) - $(stat -c %Y "$v") )) -lt 86400 ] && echo "b1: verdict fresh" || echo "b1: verdict missing or stale; re-run B1 Step 10"
echo "codex-kind rows: $(jq '[.accounts[] | select((.exec|type)=="object" and .exec.kind=="codex")] | length' "$HOME/.ccrc/accounts.json")"
cmp -s "$B/ccgpt-runtime" "$HOME/ccrc/ccd/ccgpt-runtime" && echo "builder: placed = tree"
"$B/ccgpt-runtime" check; echo "check rc=$?"
python3 -c 'import venv, ensurepip' && echo "python3: venv and ensurepip importable"
echo "builds running: $(pgrep -fc 'ccgpt-runtime build')"
for d in "$HOME" /tmp; do echo "disk: $(df --output=avail -B1G -- "$d" | tail -n1 | tr -d ' ') GiB free under $d"; done | redact
echo "memory: $(awk '/^MemAvailable:/ { print int($2 / 1048576) }' /proc/meminfo) GiB available"
"$PB/b1-units.sh" "$SCRATCH/plan3b-env.sh" > "$PB/evidence/b2-units-before.txt"; echo "units: $(wc -l < "$PB/evidence/b2-units-before.txt") name(s) recorded"
```

- **Expected:**
  - `b1: verdict fresh`, `codex-kind rows: 0` and `builder: placed = tree`;
  - `ccgpt-runtime: absent` on stderr, then `check rc=1`, on the first run. If an earlier run of this task built one, the answer is `ccgpt-runtime: current gen-… litellm=…` with `check rc=0`, and Step 1's build then answers `current` and changes nothing;
  - `python3: venv and ensurepip importable`, and `builds running: 0`;
  - both disk lines at 2 GiB or more, and memory at 2 GiB or more. One generation is about 650 MB, the first build's peak is about 2 GB (Plan 2b-2's measurement, an example), and pip's cache adds its wheels on top;
  - a unit-name count equal to B1 Step 0's.
- **Stop:**
  - any line missing or different;
  - `check` answering `mutated`, `requirement-moved` or `probe-moved` on a box where this task never ran. Something else wrote `~/.ccrc/runtime/codex`, which is reported and not rebuilt over;
  - a `codex-kind rows` count above 0. A roster flip happened without B3, and the window is closed.
- **Rollback:** none.
- **Authorisation:** read-only.

- [ ] **Step 1: Start the build, detached, with its exit code captured.** The runtime-build authorisation. It runs detached because the controller's tool calls are capped at 600 s, while the builder's own bounds allow two pip calls of 1200 s each plus a 300 s probe. Its environment is the one an install's builder would see: `ccrc-models.service`'s PATH, the builder's default deadlines (the two knobs unset), and pip's temp under `/tmp`.

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
OUT="$PB/evidence/b2-build.out"; ERR="$PB/evidence/b2-build.err"; : > "$OUT"; : > "$ERR"
date -u +%Y-%m-%dT%H:%M:%SZ > "$PB/evidence/b2-start"
setsid -f env -u CCRC_RUNTIME_PIP_S -u CCRC_RUNTIME_PROBE_S -u TMPDIR -u PYTHONPATH PATH="$LIVEPATH" \
  bash -c '"$1" build > "$2" 2> "$3"; echo "b2-rc=$?" >> "$2"' _ "$B/ccgpt-runtime" "$OUT" "$ERR" < /dev/null
sleep 2; echo "started: $(pgrep -fc 'ccgpt-runtime build') build process(es)"
```

- **Expected:** `started: 1 build process(es)`. On a box where Step 0 found the runtime current, the build may already have exited, answering `current`, and the count is 0. Step 2 reads its `b2-rc=` line either way.
- **Stop:** `started: 0` with no `b2-rc=` line in `$OUT` after Step 2's first poll.
- **Rollback, if reached:** see "Rollback" below. Nothing is current until the swap, and a build that dies before it leaves `current` as it was.
- **Authorisation:** the runtime-build authorisation.

- [ ] **Step 2: Wait for it, in bounded foreground polls.** Read-only. Each call is one foreground Bash call with a timeout of at least 600000 ms. Repeat while the answer is `still building`, up to five calls. Five polls of about 580 s cover the builder's worst bounded case: two pip calls of 1200 s and a 300 s probe.

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
timeout 580 bash -c 'until grep -q "^b2-rc=" "$1"; do sleep 15; done' _ "$PB/evidence/b2-build.out" \
  && echo "done: $(grep '^b2-rc=' "$PB/evidence/b2-build.out")" || echo "still building ($(pgrep -fc 'ccgpt-runtime build') process(es))"
```

- **Expected:** `done: b2-rc=<n>`, typically within a few minutes. There is no measured wall time for this box; record `b2-start` and the `b2-rc` time in the ledger, as the first measurement.
- **Stop:** `still building` after the fifth call. The build has run past every bound the builder sets, and the one unbounded stage is `python3 -m venv`. Report the generation directory's name (`ls -d "$HOME"/.ccrc/runtime/codex/gen-* | redact`) to the operator. Ending the build is the operator's decision, by the pid in that name. A killed build leaves a half-built generation that is not `current`: the next passing build's prune removes it, because its pid is dead and no tier names it (`_rt_prune`), or the rollback removes it by path.
- **Rollback:** none for the poll.
- **Authorisation:** read-only.

- [ ] **Step 3: Read the verdict.** Read-only.

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
{ echo "stdout:"; grep -v '^b2-rc=' "$PB/evidence/b2-build.out"; echo "stderr:"; cat "$PB/evidence/b2-build.err"; grep '^b2-rc=' "$PB/evidence/b2-build.out"; } | redact
```

- **Expected (exit 0):** stdout is one line, `ccgpt-runtime: built gen-<UTC>-<pid> litellm=<v> raw-shape-leaks-system-role=<yes|no|unknown> (absent; previous: none)`, stderr is empty, and `b2-rc=0`. A box where Step 0 found the runtime current gives `ccgpt-runtime: current gen-… litellm=<v>` and `b2-rc=0`, and the canary is then read from the stamp in Step 4. Spec §19.3 measured litellm 1.101.0 leaking a system-role item in the raw shape, so `raw-shape-leaks-system-role=yes` is the expected canary on a release near the floor. It never gates, whatever it says.
- **The other outcomes, each a stop.** Every failure prints exactly one `ccgpt-runtime: build failed at <stage>: <detail> — the previous runtime (if any) stays current` line on stderr, exits 2, and deletes the half-built generation itself (`_rt_fail`). Exit 1 is a refusal that built nothing.

  | `b2-rc` and stderr | Meaning | What happens |
  |---|---|---|
  | `2`, `build failed at venv:` | `python3 -m venv` failed (for example, no `ensurepip`) | stop. Installing a system package is the operator's act, outside this plan |
  | `2`, `build failed at pip: pip-too-old: …` | the venv's pip is older than the builder's floor, and the in-venv upgrade failed | stop. The detail names the cause, usually an unreachable index; one retry under this authorisation once the operator names the cause cleared |
  | `2`, `build failed at pip: timed-out: …` or `pip could not install …` | the index or the network | the same: one retry after a named cause |
  | `2`, `build failed at probe: <FAIL line>` | a LiteLLM release inside the range failed the behaviour probe: **2b2-12's revisit trigger** | stop for the operator's ruling on the range. The record is the redacted line, the UTC time, and the fact that pip installed the highest release inside the requirement at that time (the builder's header), which names the release. Narrowing the range is a reviewed code change to `LITELLM_REQUIREMENT`, never a Plan 3b act |
  | `2`, `build failed at probe: timed-out: …` | the probe did not exit within `CCRC_RUNTIME_PROBE_S` | one retry when the box is less loaded; a second timeout goes to the ruling, as above |
  | `2`, `build failed at stamp:` or `at swap:` | the builder could not record or publish a passing generation | stop, reported as a ccrc defect |
  | `1` with a refusal line (`python3 is not on PATH`, `cannot create …`, `… already exists`) | nothing was built | stop |

- **Rollback, if reached:** a failed build needs none, because `_rt_fail` removed its generation. Verify with `ls -d "$HOME"/.ccrc/runtime/codex/gen-* 2>/dev/null | wc -l`, which answers `0` on a first build. Any other count goes to the operator.
- **Authorisation:** read-only. A retry is Step 1 again, under the runtime-build authorisation.

- [ ] **Step 4: Verify what is current, and that nothing else moved.** Read-only.

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
RT="$HOME/.ccrc/runtime/codex"
"$B/ccgpt-runtime" check 2>&1 | redact; echo "check rc=${PIPESTATUS[0]}"
py="$("$B/ccgpt-runtime" python)"; gen="${py%/bin/python}"; gen="${gen##*/}"; echo "python resolves into $gen" | redact
[ "$(readlink "$RT/current")" = "$gen" ] && echo "current -> $gen (relative)"
st="$RT/$gen/.ccrc-runtime.json"
req="$(sed -n "s/^LITELLM_REQUIREMENT='\([^']*\)'\$/\1/p" "$B/ccgpt-runtime")"
[ "$(jq -r .requirement "$st")" = "$req" ] && echo "stamp requirement = the builder's one declaration"
lv="$(jq -r .litellm "$st")"; cv="$(jq -r .canary "$st")"
python3 -c 'import sys; v = tuple(int(x) for x in sys.argv[1].split(".")[:3]); sys.exit(0 if (1, 101, 0) <= v < (1, 110, 0) else 1)' "$lv" \
  && echo "litellm inside the requirement; canary: $cv"
echo "generations: $(ls -d "$RT"/gen-* | wc -l); temp links: $(ls -a "$RT" | grep -c '^\.current\.tmp\.')"
echo "size: $(du -sm "$RT/$gen" | cut -f1) MB; disk: $(df --output=avail -B1G -- "$HOME" | tail -n1 | tr -d ' ') GiB free"
[ -e "$HOME/.ccrc/codex" ] && echo "~/.ccrc/codex EXISTS" || echo "no ~/.ccrc/codex"
"$PB/b1-units.sh" "$SCRATCH/plan3b-env.sh" > "$PB/evidence/b2-units-after.txt"
diff "$PB/evidence/b2-units-before.txt" "$PB/evidence/b2-units-after.txt" > /dev/null && echo "units: unchanged"
"$B/ccrc" doctor 2>&1 | awk '/^(PASS|WARN|FAIL|SKIP) [a-z0-9-]+:/ { c = $2; sub(/:$/, "", c); print c, $1 }' | sort -u > "$PB/evidence/b2-doctor-classes.txt"
diff "$PB/evidence/b1-doctor-classes.txt" "$PB/evidence/b2-doctor-classes.txt" > /dev/null && echo "doctor: every class as in B1, codex $(sed -n 's/^codex //p' "$PB/evidence/b2-doctor-classes.txt")"
```

- **Expected, in order:**
  - `ccgpt-runtime: current gen-<UTC>-<pid> litellm=<v>` and `check rc=0`;
  - `python resolves into <the same generation>` and `current -> <it> (relative)`;
  - `stamp requirement = the builder's one declaration`;
  - `litellm inside the requirement; canary: raw-shape-leaks-system-role=<yes|no|unknown>`;
  - `generations: 1; temp links: 0`;
  - a size of about 650 MB (Plan 2b-2's figure; record what this box measures), with the free disk still at 2 GiB or more;
  - `no ~/.ccrc/codex`;
  - `units: unchanged`;
  - `doctor: every class as in B1, codex SKIP`. Doctor does not read the runtime while no lane is codex.

  The requirement is read from the placed builder's own line, never spelled here: `single-definition.test.ts` pins its one home.
- **Stop:**
  - any line missing;
  - above all, `check` not exit 0 right after a build that said `built`. That is an overloaded success, the same refusal `_inst_codex_runtime` makes;
  - a unit-name difference, unless every differing name is one of the other repository's usage oneshots appearing or leaving on its own timer, which is read and reported;
  - a doctor class difference.
- **Rollback, if reached:** see "Rollback".
- **Authorisation:** read-only.

- [ ] **Step 5: Record it.** Scratch only.

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
st="$(readlink -f "$HOME/.ccrc/runtime/codex/current")/.ccrc-runtime.json"
vset RUNTIME_GEN "$(basename "$(dirname "$st")")"; vset RUNTIME_LITELLM "$(jq -r .litellm "$st")"
vset RUNTIME_CANARY "$(jq -r .canary "$st")"; vset RUNTIME_BUILT "$(jq -r .builtAt "$st")"
P="$(git worktree list --porcelain | sed -n '1s/^worktree //p')"
python3 "$PB/b1-reference.py" "$VALUES" "$P/deploy/reference-fleet.md"
"$PB/b1-census.sh" "$SCRATCH/plan3b-env.sh" | tail -n1
```

- **Expected:** the reference line, then `census: MATCH`. With `RUNTIME_GEN` set, the census now expects `current <runtime-gen>` where B1 expected `absent`.
  - Append `runtime-built-before-the-roster-flip` to `$PB/execution-slugs.tsv` (Part B's Global Constraints), and record the build's wall time, the generation's size, `~/.cache/pip`'s growth and the canary in the verification record: ruling R12's first measurements, never stated as facts.
  - The canary is reported to the operator as information. It never gates (spec §19.3), and the shim folds both system doors before LiteLLM sees a request.
- **Stop:** `census: MISMATCH`.
- **Rollback:** none for the record.
- **Authorisation:** read-only.

**Rollback (the runtime-build authorisation).** `ccgpt-runtime` has no verb that removes a generation. Its verbs are `build`, `check`, `python` and `probe-source`, and its only remover is the prune a later passing build runs. The only ccrc verb that removes the runtime is `ccrc uninstall`, which removes far more. So the rollback has two forms:
- **Default: keep it.** While no roster row is codex, nothing runs it and no check reads it (Why, above), and the next build reuses or prunes it. Rolling B2 back is "do not flip yet".
- **Remove it, only on the operator's word** (for example, for disk). Remove the directory by path, behind three guards measured in the same call ⟦D:runtime-removed-by-path-on-rollback⟧:

```bash
. "<abs scratch>/plan3b-exec/plan3b-env.sh"
RT="$HOME/.ccrc/runtime/codex"
n="$(jq '[.accounts[] | select((.exec|type)=="object" and .exec.kind=="codex")] | length' "$HOME/.ccrc/accounts.json")"
s="$(find "$HOME/.ccrc/codex" -name '*.started' 2>/dev/null | wc -l)"; p="$(pgrep -fc -- "$RT/" || true)"
if [ "$n" = 0 ] && [ "$s" = 0 ] && [ "${p:-0}" = 0 ]; then rm -rf -- "$RT" && echo "runtime removed"; vset RUNTIME_GEN ''
else echo "refused: codex rows $n, tier records $s, processes $p; nothing removed"; fi
```

  The three guards are: no roster row is codex, no lane's `<tier>.started` record exists (the builder's own in-use test), and no process's argv names the directory. Expected: `runtime removed`. After it, `ccgpt-runtime check` answers `absent`, and B1's census expects that again. Any `refused:` line leaves the runtime in place and goes to the operator.

### Task B3: cut over one lane

> The one per-lane procedure (rulings B-1…B-8). It is run twice, once per lane, in the order R-O1 rules. It is written so that the order does not change a step, only three parameters do:
> - **`<lane-registry>`.** Lane 1 has a codex class registry (`yes`). Lane 2 has none (`no`), so its `ccrc models <lane-id> init codex` runs after its roster flip, because ruling Z3 refuses it before (Step 11).
> - **The lane's live sessions.** Every one is parked before the entry file moves (Step 3). At the 2026-10-05 census lane 1 had six and lane 2 had one. B1's census count is the one this run trusts, and Step 2 re-counts it.
> - **`<flip-ordinal>`, `first` or `second`.** It decides what the box looks like before the flip and what Z4 does after it (table below).
>
> The controller runs every step, with the operator present. Nothing here is dispatched to a subagent. Every live act names its authorisation: **[LW <lane-id>]** is this lane's window act in [Authorisation shapes](#authorisation-shapes), which covers the step and its rollback. **[OP]** is an act the operator performs themselves, on their own units or in the PWA. **[RO]** is read-only and may run any time.

**Files:**
- No tracked file changes. This task is a live runbook.
- **On the fleet box, written or moved, each by a named step:**
  - `~/.ccrc/accounts.json` (Step 9);
  - `~/.local/bin/<lane-id>`, moved aside (Step 8) and then written by `ccrc wrappers` (Step 10);
  - the lane's `settings.json`, the lane's `~/.ccrc/models/<lane-id>.*` files and `~/.ccrc/codex/<lane-id>/` (Steps 11–13, through ccrc's own verbs);
  - the account's disabled marker (Steps 4 and 17, through `ccrc account`);
  - ccrc's own `ccrc-codex-usage@<lane-id>.timer` enablement (Step 14), and ccrc's tiers (Step 15);
  - the registry wrapper field of each parked session (Steps 3 and 18, through `ccd swap`);
  - `<window-dir>` (Step 1), the window's backups and evidence.
- **Never touched in this task:** `~/.local/bin/ccgpt`, `ccgpt-proxy`, `ccgpt-usage` (ruling B-3); `~/.handoff/env`; any `auth.json`'s contents; any unit's `Environment=` values; tmux; the other lane's files and units.

**Interfaces:**
- **Consumes:**
  - **B1's values (ruling B-9).** B1 defines `<lane-id>`, `<lane-shim-port>`, `<lane-litellm-port>`, `<lane-auth-dir>`, `<park-target-wrapper>`, `<nodeId>` and `<session-id>`, in the gitignored `deploy/reference-fleet.md` section and the 0600 values file. Its values file must also carry, per lane, the parameters this task adds:
    - `<lane-config-dir>`, the row's `configDirSuffix`;
    - `<lane-session-count>`;
    - `<lane-registry>`;
    - `<foreign-usage-timer>` and `<foreign-usage-service>`;
    - `<box-global-litellm-config>`, the absolute path `_models_litellm_path` answers with no id;
    - `<other-lane-id>`;
    - `<controller-session-id>`;
    - `<part-a-release>`.

    B1 also records each session's project pool tag and the park target's pool (ruling B-2). The operator names `<flip-ordinal>` and `<window-end-UTC>` at Step 0, and Step 1 records `<UTC>`, `<prior-auto>` and `<prior-channel>`. Every `<…>` in a command below is substituted from those records, never typed fresh.
  - **B2's runtime.** `ccgpt-runtime check` answers `current`. Step 0 re-measures it.
  - **Part A's behaviours, as merged and running on the fleet box:**
    - A-1: a codex-kind row behind an undecidable roster read refuses, never reads "not codex". Steps 9 and 12 rely on it while the roster changes under them.
    - A-2: a withdrawn usage instance is re-measured, and doctor warns on an enabled ccrc instance whose id is not a codex lane. The rollback relies on it.
    - A-4: a codex-probe refresh row whose render failed is never `ok:true` with `litellm:"skipped"`. Step 12's reading rule.
    - A-5 and A-6: doctor reads unmeasured as unmeasured, and the models writer refuses a FIFO rather than blocking. Step 16(g).
  - **Shipped verbs, unchanged:**
    - `ccd swap` and `ccd ls`;
    - `ccrc account disable|enable`, `ccrc wrappers [--dry-run]`;
    - `ccrc models <id> init codex`, `ccrc models refresh <id>`, `ccrc models litellm <id>`, `ccrc models <id> rm`;
    - `ccrc codex start|stop|status|login`, `ccrc doctor`, `ccrc channel`, `ccrc update --check`, `ccgpt-runtime check`;
    - from the installed tree `~/ccrc` (the symlink to the running release): `server/dist/shared/roster.js`'s `parseRoster`, `shared/mark.mjs`'s `verifyMarker` and `deploy/gen-accounts.mjs`. The release ships them built (measured on the fleet box 2026-10-05: all three present under `~/ccrc`), so nothing is built inside the window.
- **Produces:**
  - **`<window-dir>`** = `$HOME/.ccrc-3b/<lane-id>-<UTC>`, mode 0700, box-local, outside any tree, never under the temp root. It holds:
    - `cp-*` (Step 2's checkpoint);
    - `*.bak` and `models-existed.txt` (Step 5);
    - `parked.tsv` (Step 3);
    - `accounts.candidate.json` (Step 9);
    - `refresh.json` (Step 12);
    - `turn.jsonl` (Step 16e);
    - `doctor-after.txt` and `doctor-after-classes.txt` (Step 16g);
    - `unpark-<session-id>.epoch` (Step 18);
    - `z4-baseline.txt` (Step 19);
    - `record.tsv` (Step 20).

    B4 Step 3 reads `unpark-*.epoch` for a first-turn watch handed over at Step 18. `record.tsv` and `z4-baseline.txt` are the window's evidence, which B6 Step 5's verification record reads.
  - **The rollback rows RB1–RB15**, which B4's stop criteria name.
  - **For the plan's ledger, when they fire:** the carry-forward's `lane-without-a-registry-inits-after-the-flip` (Step 11) and `both-foreign-usage-timers-retired-per-lane` (Step 7). These are the execution ledger's to mint (ruling F4), and this task does not mint them.

**Why:**
- **One procedure, three parameters.** The two lanes differ in exactly the facts the table below names. Writing the procedure once keeps the order (R-O1) an operator ruling, not a rewrite. Each difference is a parameter checked at Step 0, so a lane whose live shape is not the one its parameters claim stops before anything is done.
- **Parking first (R-O2, ruling B-2).** A surviving Claude Code process carries the other repository's gateway key. And once the entry file is aside, a respawn fails five times inside `StartLimitIntervalSec=120` and systemd marks the unit failed. So no live session may sit on the lane between Step 6 and Step 18. `ccd swap` carries the conversation, and `ccd` is the authority on the pool question: its refusal is the stop.
- **The foreign stop is lane-explicit and happens only before this lane's flip (ruling B-4).** The other repository's stop stops units by name, `ccgpt-<id>-{litellm,shim}.service`, which are exactly ccrc's tier names (spec §19.2). With `CCGPT_ACCOUNT_ID` unset it names lane 1. A non-lane-1 id also needs both ports, and the launcher refuses without them (`_require_lane_ports`, measured). So the stop always runs through the lane's own entry file, with the id set: that form carries both ports and names only this lane's two units.
- **The entry file moves before the roster says codex.** From the moment the row is codex-kind, every claimer of `~/.local/bin/<lane-id>` would meet a foreign file there: `ccrc wrappers`, doctor's `_fix_wrappers`, and an install's wrappers step. Each would refuse and report a degraded step. Moving the file first means no reader ever sees a codex row over a foreign launcher. Spec §15.3 lists the exec-block write before the move, so the order is a departure ⟦D:entry-moved-aside-not-the-launcher⟧.
- **Adoption, not re-login (ruling B-7, spec §9.2).** The row's `authDir` is the lane's existing OAuth directory, and its ports are the lane's existing pair (R-O3). Step 12's refresh is the first act that runs LiteLLM's `Authenticator` against that directory under ccrc's runtime. It runs before any tier starts and before any session returns, so a dead refresh token stops the window at `login-required` rather than inside a tier process that would start a device flow (Plan 3a Task 1, hazard 3).
- **One writer per limits row (ruling B-5, R-C10).** The operator's disable of the lane's foreign timer precedes both the roster flip and ccrc's enable. Only in that order is the next auto-update's `_inst_codex_usage` converge a no-op, and never a withdrawal.

**The parameters of one run**

| | Lane 1 | Lane 2 |
|---|---|---|
| `<lane-registry>` | `yes`: `<lane-id>.{json,classes.json,classes.tsv,effort.json}` exist, registry probe `codex` | `no`: only `<lane-id>.effort.json` |
| Entry file `~/.local/bin/<lane-id>` | a symlink to `~/.local/bin/ccgpt`. The link moves, never its target | a small regular file that exports the lane's id and both ports and execs `ccgpt` |
| `<foreign-usage-timer>` / `<foreign-usage-service>` | `ccgpt-usage.timer` / `ccgpt-usage.service` (flat; its lane is the publisher's shell default) | `ccgpt-usage@<lane-id>.timer` / `ccgpt-usage@<lane-id>.service` (the instance, never the template `ccgpt-usage@.timer`) |
| Matches `pgrep -f "litellm .*<box-global-litellm-config>"` while its foreign tiers run | yes | no (it runs on a lane-suffixed config) |
| Step 11 | skipped | `init codex` |
| Models files backed up | all four | the effort file only |

| | `first` flip | `second` flip |
|---|---|---|
| The box before the flip | No codex row. ccrc's external arm may still run the bare `ccgpt stop`, which names lane 1's units, on an hourly changed render while lane 1's proxy runs (Z1). The window therefore avoids the `ccrc-models.timer` fire (Step 0) | One codex row, `<other-lane-id>`. Z4 refuses the external arm's stop. This run never names `<other-lane-id>` in a `ccgpt` invocation, and Steps 2, 6 and 16 re-measure that its tiers still run |
| After the flip | **If this is lane 2:** lane 1 is now an external lane with a registry and a proxy on the box-global config. Until lane 1's flip, any hourly refresh whose lane-1 render changed is refused (`restart-failed`, `ccrc models refresh --all` exit 1, `ccrc-models.service` failed), and lane 1 keeps serving on its unchanged config. Step 19 arms the read-only monitor, and B4 reads it. **If this is lane 1:** no external lane has a registry, so Z4 cannot fire | No external lane is left. Z4 cannot fire |
| Doctor's `codex` row at Step 16(g) | lane 1: `PASS codex: 1 Codex lane(s): …`. Lane 2: one `WARN codex:` line for the flat `ccgpt-usage.timer`, which stays enabled, unattributable, until lane 1's flip ⟦D:flat-foreign-timer-warns-until-lane-one-flips⟧ | `PASS codex: 2 Codex lane(s): …` |
| Roster parse at Step 9 | one codex row | two codex rows. Their four ports are pairwise distinct (`parseRoster`'s whole-roster gate) |

**What "stop" means here.** Halt at the step. Run the rollback table below from the highest step reached, in its order, and report to the operator. Nothing is overridden: no `--force`, no `--cross-pool` without the operator's named decision, no hand kill of a unit or a port holder.

Every bash block below begins with `export PATH="$HOME/.local/bin:$PATH"`, because a fleet session's shell does not carry `~/.local/bin` (measured). The controller's shell keeps no variable between calls, so each block that uses `W` sets it on its own first line, as `W="$HOME/.ccrc-3b/<lane-id>-<UTC>"`.

- [ ] **Step 0: Preconditions and this lane's parameters (read-only).** [RO]

  ```bash
  export PATH="$HOME/.local/bin:$PATH"
  ccrc version | head -n 3
  ccrc update --check | head -n 1
  ( . "<abs scratch>/plan3b-exec/plan3b-env.sh" && "$PB/b1-census.sh" "$SCRATCH/plan3b-env.sh" | tail -n 1; echo "flipped: ${FLIPPED:-none}"; ccgpt-runtime check | grep -c -- " $RUNTIME_GEN " )
  ccgpt-runtime check
  jq -c --arg id '<lane-id>' '.accounts[] | select(.id == $id) | {kind: .exec.kind, provider: .exec.provider, execKeys: (.exec | keys), telemetry, homeAble, configDirSuffix}' "$HOME/.ccrc/accounts.json"
  for f in json classes.json classes.tsv effort.json; do if [ -e "$HOME/.ccrc/models/<lane-id>.$f" ]; then echo "present $f"; else echo "absent $f"; fi; done
  [ ! -e "$HOME/.ccrc/models/<lane-id>.classes.json" ] || jq -r '"registry probe: \(.probe)"' "$HOME/.ccrc/models/<lane-id>.classes.json"
  if [ -L "$HOME/.local/bin/<lane-id>" ]; then echo "entry: symlink to $(readlink "$HOME/.local/bin/<lane-id>")"; elif [ -f "$HOME/.local/bin/<lane-id>" ]; then echo 'entry: regular file'; else echo 'entry: MISSING'; fi
  stat -c '%a %F' "$HOME/<lane-auth-dir>" "$HOME/<lane-auth-dir>/auth.json"
  stat -c '%a %F' "$HOME/<lane-config-dir>/settings.json"
  ccd ls | awk -v s='<controller-session-id>' 'NR > 1 && $1 == s { print "controller on: " $2 }'
  systemctl --user list-timers --all --no-legend ccrc-models.timer
  df -h --output=avail "$HOME" | tail -n 1
  claude --help | grep -c -- '--include-partial-messages'
  ```
  - **Expect:**
    - `ccrc version`'s `install:` line reads `complete`, and its version is `<part-a-release>` or later;
    - the check line reads `state=current`;
    - `census: MATCH` (B1's census, re-run at this window's open; it skips a lane listed in `FLIPPED`), then `flipped: none` on the first flip or the first lane's number on the second (that answer is `<flip-ordinal>`), then `1`: B2's `<runtime-gen>` is the current generation;
    - `ccgpt-runtime: current <gen> litellm=<v>`, exit 0;
    - the row reads `{"kind":"external","provider":"openai","execKeys":["kind","provider"],"telemetry":"codex","homeAble":true,…}`, and its `configDirSuffix` is `<lane-config-dir>`;
    - the models lines and the entry shape match the parameter table for this lane, and `registry probe: codex` prints when `<lane-registry>` is `yes`;
    - `700 directory` and `600 regular file` (stat only; the file is never opened);
    - `settings.json` is a `regular file`;
    - the controller is on any wrapper but `<lane-id>`;
    - `ccrc-models.timer`'s NEXT elapse falls after `<window-end-UTC>`, the end the operator names for this window;
    - at least 2 GB free;
    - `1`.
  - **Second flip only:** `ccrc codex status '<other-lane-id>' --json | jq -c '[.tiers.litellm.state, .tiers.shim.state]'` prints `["running","running"]`.
  - **Stop if:** any line differs. This includes:
    - an `execKeys` with more than `kind` and `provider`. A secrets file or ports on the row are a shape this procedure was not written for;
    - a symlinked `settings.json`. ccrc's settings writer replaces it with a 0600 regular file;
    - the controller on this lane, which would park itself;
    - a `census: MISMATCH`, whose line names the fact, or a `0` for the generation (re-run B2 under the runtime-build authorisation first). A session-count MISMATCH names its own cure: B1 Step 2 while `FLIPPED` is empty; on the second flip, only B1 Step 3's re-record of this lane's `L<n>_SESSIONS` and `L<n>_SESSION_COUNT`, never B1 Step 2. Then re-run this step;
    - a timer fire inside the window. Wait until it has fired and its row has been read, then re-run this step.

    Nothing has been done yet.
  - **Rollback if reached:** none.

- [ ] **Step 1: Open the window: the operator pauses auto-update (ruling B-6).** [OP] for the pause, [RO] for the reads.
  - **The operator**, on the PWA's Settings screen (Updates), reads the fleet scope's current values and says them aloud for the record: `<prior-auto>` and `<prior-channel>`. Then they set auto to off. That screen writes only the fleet scope `*`, which is the recommendation: every box pauses for the window. The per-box alternative is API-only and session-gated, so only the operator can call it: `POST /api/updates/intent` with `{"scope":"<nodeId>","auto":"off"}`.
  - **The controller:**

    ```bash
    export PATH="$HOME/.local/bin:$PATH"
    date -u +%Y%m%dT%H%M%SZ
    ```
    The printed stamp is this window's `<UTC>`.

    ```bash
    export PATH="$HOME/.local/bin:$PATH"
    W="$HOME/.ccrc-3b/<lane-id>-<UTC>"
    ( umask 077; mkdir -p -- "$W" ) && stat -c '%a' "$W"
    printf 'prior-auto\t%s\nprior-channel\t%s\n' '<prior-auto>' '<prior-channel>' > "$W/cp-prior-intent.tsv"
    l=''; for i in $(seq 1 18); do l="$(ccrc channel | head -n 1)"; case "$l" in *' auto=off') break ;; esac; sleep 10; done; echo "$l"
    ```
  - **Expect:** `700`, then a line `channel: state=ok channel=<prior-channel> desired=… desired-stable=… desired-dev=… auto=off` within 180 s. A fleet box's projection lags up to about 60 s behind the intent, through `ccd-update-sync.timer`, plus its lease.
  - **Stop if:** `auto=off` does not appear within 180 s, or `state=` is anything but `ok`. Rollback: RB15.
  - **For the whole window:**
    - `auto:"off"` stops the scheduler only. Nobody taps Apply or Rollback in the PWA, and nobody runs `ccrc update` or `ccrc rollout` (ruling 2026-09-30).
    - `~/.ccrc/update.lock` is not a pause mechanism, and no step takes it.
    - Nobody taps the PWA's model-refresh button for this lane, and nobody runs `ccrc models refresh` outside Step 12.
  - **Rollback if reached:** RB15.

- [ ] **Step 2: Checkpoint (read-only).** [RO]

  ```bash
  export PATH="$HOME/.local/bin:$PATH"
  W="$HOME/.ccrc-3b/<lane-id>-<UTC>"
  ccrc version > "$W/cp-version.txt"
  ccrc channel | head -n 1 > "$W/cp-channel.txt"
  jq -r '"update phase: \(.phase // "absent")"' "$HOME/.ccrc/update.json" 2>/dev/null || echo 'update phase: absent'
  ccd ls | awk -v w='<lane-id>' 'NR > 1 && $2 == w { print $1 "\t" $3 }' > "$W/cp-lane-rows.tsv"
  while IFS="$(printf '\t')" read -r s st; do printf '%s\t%s\t%s\n' "$s" "$st" "$(systemctl --user is-active "claude-session@$s.service")"; done < "$W/cp-lane-rows.tsv" > "$W/cp-lane-units.tsv"
  awk -F '\t' '$3 == "active"' "$W/cp-lane-units.tsv" | wc -l
  systemctl --user list-units --all --no-legend --plain 'ccgpt-*' 'ccrc-codex-usage@*' | awk '{ print $1, $3, $4 }' > "$W/cp-units.txt"
  systemctl --user list-timers --all --no-legend 'ccgpt-usage*' 'ccrc-codex-usage@*' 'ccrc-models.timer' > "$W/cp-timers.txt"
  ss -Hltn "( sport = :<lane-shim-port> or sport = :<lane-litellm-port> )" | wc -l
  sha256sum "$HOME/.local/bin/ccgpt" > "$W/cp-ccgpt.sha256"
  pgrep -f "litellm .*<box-global-litellm-config>" | wc -l
  ccrc doctor > "$W/cp-doctor.txt" 2>&1; echo "doctor rc=$?"
  awk '/^(PASS|WARN|FAIL|SKIP) [a-z0-9-]+:/ { c = $2; sub(":$", "", c); print c, $1 }' "$W/cp-doctor.txt" | sort -u > "$W/cp-doctor-classes.txt"
  grep -E '^(PASS|WARN|FAIL|SKIP) codex: ' "$W/cp-doctor.txt"
  ```
  - **Expect:**
    - `update phase:` `done`, `failed`, `reverted` or `absent`: no update is mid-run (`auto:"off"` stops only the next one);
    - the active-unit count equals `<lane-session-count>`;
    - `cp-units.txt` names both `ccgpt-<lane-id>-{litellm,shim}.service` as `active running`, and no `ccrc-codex-usage@<lane-id>` unit;
    - port listeners: `2`;
    - the `pgrep` count is `1` while lane 1 is still external with its foreign tiers up, and `0` once lane 1 has flipped;
    - doctor's `codex` row: `SKIP` on the first flip. On the second, `PASS codex: 1 Codex lane(s): <other-lane-id> …` after a lane-1 first flip, or the single flat-timer `WARN codex:` line after a lane-2 first flip.
  - **Stop if:** any count or class differs from B1's census record for this lane. Rollback: RB15. An update phase other than those four is an update still running over the box: wait for it to end, then re-run Step 0.
  - **Rollback if reached:** RB15. The checkpoint itself writes only `<window-dir>`.

- [ ] **Step 3: Park every live session on the lane (ruling B-2).** [LW <lane-id>]; `--cross-pool` only by the operator's named decision, [OP].
  - **For each `<session-id>`** whose `cp-lane-units.tsv` third column is `active`, one at a time:
    1. **Idle point, read-only.** The two registry files are read and never written.

       ```bash
       jq -r '"hookstate: \(.state)"' "$HOME/.cc-sessions/<session-id>.hookstate.json"
       if [ -e "$HOME/.cc-sessions/<session-id>.turn.json" ]; then jq -r '"turn: \(.state) bg=\(.bg)"' "$HOME/.cc-sessions/<session-id>.turn.json"; else echo 'turn: absent'; fi
       ```
       - **Expect:** `hookstate: done`, and `turn: done bg=0` or `turn: absent`.
       - `working`, `waiting` (a pending dialog owns the keyboard) and `bg` other than `0` are not an idle point: wait and re-read. A swap kills the pane, a background shell included.
       - **A coordinator** is parked between waves only. The operator confirms that it holds no wave-done to verify and no review report to rule on.
       - The operator confirms that `<park-target-wrapper>` has headroom for the session. "No headroom" is the operator's judgement, never a `ccd` refusal.
    2. **The swap:**

       ```bash
       export PATH="$HOME/.local/bin:$PATH"
       ccd swap '<session-id>' '<park-target-wrapper>'
       printf '%s\t%s\n' '<session-id>' '<park-target-wrapper>' >> "$HOME/.ccrc-3b/<lane-id>-<UTC>/parked.tsv"
       sleep 20
       systemctl --user is-active 'claude-session@<session-id>.service'
       ccd ls | awk -v s='<session-id>' 'NR > 1 && $1 == s { print $2, $3 }'
       ```
       - **Expect:** `swapped <session-id>: <lane-id> -> <park-target-wrapper> (discover on claude.ai under the <park-target-wrapper> account)`, then `active`, then `<park-target-wrapper> running`.
  - **After the last one:** `ccd ls | awk -v w='<lane-id>' 'NR > 1 && $2 == w && ($3 == "running" || $3 == "restarting")' | wc -l` prints `0`.
  - **Stop if: the session cannot be parked.** These are the window-never-opens shapes (critic #20):
    - `ccd` dies `pool-mismatch: …`. The session is untouched. Cross only on the operator's named decision, with `ccd swap --cross-pool '<session-id>' '<park-target-wrapper>'`, never by default;
    - `ccd` dies on an undecidable pool tag or an unreadable project field. No flag crosses it;
    - the operator judges that no destination has headroom;
    - the session's unit reads `failed`, or does not reach `active` within 60 s;
    - an idle point does not come within the window the operator allows.
  - **Rollback if reached:** RB14 for every row in `parked.tsv`, then RB15.

- [ ] **Step 4: Switch the account off for placement.** [LW <lane-id>]

  ```bash
  export PATH="$HOME/.local/bin:$PATH"
  ccrc account disable --id '<lane-id>'
  ccd ls | awk -v w='<lane-id>' 'NR > 1 && $2 == w && ($3 == "running" || $3 == "restarting")' | wc -l
  ```
  - **Expect:** `{"ok":true,"id":"<lane-id>","disabled":true}`, then `0`.
    - Placement could put a session on the lane between Step 3 and this step. ccd's own rescue could also move a parked session back. So a non-zero count means each such session is parked exactly as in Step 3, before anything else runs.
  - **Stop if:**
    - **`last-enabled-home` (rc 1, nothing written).** This lane is the only globally placeable home on this box. Either the operator first switches another home-able account on ([OP], `ccrc account enable --id <that id>`) and this step re-runs, or the window stops;
    - `marker-conflict` or `marker-write`.
  - **Rollback if reached:** RB13, then RB14 and RB15.

- [ ] **Step 5: Back up what the cutover will change (ruling B-8).** [LW <lane-id>]

  ```bash
  export PATH="$HOME/.local/bin:$PATH"
  W="$HOME/.ccrc-3b/<lane-id>-<UTC>"
  cp -p -- "$HOME/<lane-config-dir>/settings.json" "$W/settings.json.bak"
  : > "$W/models-existed.txt"
  for f in json classes.json classes.tsv effort.json; do src="$HOME/.ccrc/models/<lane-id>.$f"; if [ -e "$src" ]; then cp -p -- "$src" "$W/models.$f.bak" && echo "$f" >> "$W/models-existed.txt"; fi; done
  cp -p -- "$HOME/.ccrc/accounts.json" "$W/accounts.json.bak"
  cp -P -p -- "$HOME/.local/bin/<lane-id>" "$W/entry.bak"
  for p in "$HOME/<lane-config-dir>/settings.json:$W/settings.json.bak" "$HOME/.ccrc/accounts.json:$W/accounts.json.bak"; do a="${p%%:*}"; b="${p#*:}"; cmp -s -- "$a" "$b" && [ "$(stat -c %a -- "$a")" = "$(stat -c %a -- "$b")" ] && echo "ok ${b##*/}" || echo "MISMATCH ${b##*/}"; done
  while read -r f; do cmp -s -- "$HOME/.ccrc/models/<lane-id>.$f" "$W/models.$f.bak" && echo "ok models.$f" || echo "MISMATCH models.$f"; done < "$W/models-existed.txt"
  if [ -L "$W/entry.bak" ]; then [ "$(readlink -- "$W/entry.bak")" = "$(readlink -- "$HOME/.local/bin/<lane-id>")" ] && echo 'ok entry (link)' || echo 'MISMATCH entry'; else cmp -s -- "$W/entry.bak" "$HOME/.local/bin/<lane-id>" && echo 'ok entry (file)' || echo 'MISMATCH entry'; fi
  cat "$W/models-existed.txt"
  ```
  - **Expect:**
    - every line reads `ok …`, and the entry reads `(link)` for lane 1 and `(file)` for lane 2;
    - `models-existed.txt` lists all four (lane 1) or `effort.json` alone (lane 2).
    - `cp -p` keeps each file's mode, which the rollback restores. ccrc's own settings writer writes 0600 (`shared/modelenv.mjs`), so Step 11 or 12 may change the mode, and only the backup holds the prior one.
  - **Stop if:** any `MISMATCH`, or a `cp` error. Delete nothing.
  - **Rollback if reached:** RB13–RB15. The backups are kept until B4 closes.

- [ ] **Step 6: Stop the other repository's tiers for THIS lane only, then re-measure (ruling B-4).** [LW <lane-id>]
  - **Before the stop, read-only.** The two units are this lane's and are not ccrc's:

    ```bash
    export PATH="$HOME/.local/bin:$PATH"
    systemctl --user list-units --all --no-legend --plain 'ccgpt-<lane-id>-*' | awk '{ print $1, $3, $4 }'
    for t in litellm shim; do pid="$(systemctl --user show -p MainPID --value "ccgpt-<lane-id>-$t.service")"; printf '%s ccrc-argv-words=%s\n' "$t" "$(ps -ww -o args= -p "$pid" | grep -c -e '--ccrc-lane=' -e '/\.ccrc/codex/')"; done
    systemctl --user list-units --all --no-legend --plain 'ccgpt-<other-lane-id>-*' | awk '{ print $1, $3, $4 }'
    ```
    - **Expect:** exactly `ccgpt-<lane-id>-litellm.service active running` and `ccgpt-<lane-id>-shim.service active running`, then `litellm ccrc-argv-words=0` and `shim ccrc-argv-words=0`, then the other lane's two `ccgpt-<other-lane-id>-*` units as `active running` (the other repository's on the first flip, ccrc's on the second), which the after-check below compares.
  - **The stop, through the lane's own entry file with the id set.** For lane 2 that file supplies both ports, which `_require_lane_ports` demands. For lane 1 the link reaches `ccgpt` with the same id as its default. Never a bare `ccgpt stop`, and never once this lane's row is codex:

    ```bash
    export PATH="$HOME/.local/bin:$PATH"
    W="$HOME/.ccrc-3b/<lane-id>-<UTC>"
    CCGPT_ACCOUNT_ID='<lane-id>' "$HOME/.local/bin/<lane-id>" stop > "$W/foreign-stop.txt" 2>&1; echo "stop rc=$?"
    sleep 5
    systemctl --user list-units --all --no-legend --plain 'ccgpt-<lane-id>-*' | wc -l
    ss -Hltn "( sport = :<lane-shim-port> or sport = :<lane-litellm-port> )" | wc -l
    sleep 5
    systemctl --user list-units --all --no-legend --plain 'ccgpt-<lane-id>-*' | wc -l
    ss -Hltn "( sport = :<lane-shim-port> or sport = :<lane-litellm-port> )" | wc -l
    systemctl --user list-units --all --no-legend --plain 'ccgpt-<other-lane-id>-*' | awk '{ print $1, $3, $4 }'
    ```
  - **Expect:** `stop rc=<rc>` (recorded), then `0` and `0`, then `0` and `0` again after the second wait, then the other lane's two units exactly as the before-listing showed them. The launcher's own output is kept in `<window-dir>/foreign-stop.txt` and not matched, because its wording was never measured; it is read, by count only, for any lane id but `<lane-id>`.
    - The 5 s wait is longer than the units' `RestartSec=3`.
    - The unit count is also the count-only proof that no key-bearing transient unit of this lane remains: the other repository passes the gateway key by `--setenv` (2b2-4), and `--collect` removes a stopped unit's metadata with it.
  - **Second flip only:** `ccrc codex status '<other-lane-id>' --json | jq -c '[.tiers.litellm.state, .tiers.shim.state]'` still prints `["running","running"]`.
  - **Stop if:**
    - the other lane's units differ from the before-listing, or `foreign-stop.txt` names any id but `<lane-id>`. Stop at once and report: another lane's units may have been stopped;
    - a unit or a listener remains after a second 5 s wait. A later `ccrc codex start` would refuse it as `unit-foreign` or `port-foreign`, which is a stop, never an override;
    - the other lane's tiers moved.
  - **Rollback if reached:** RB12 (the foreign tiers back), then RB13–RB15.

- [ ] **Step 7: The operator disables the lane's foreign usage timer (ruling B-5).** [OP] for the disable, [RO] for the re-measure.
  - **The operator runs one of:**
    - lane 1: `systemctl --user disable --now ccgpt-usage.timer`;
    - lane 2: `systemctl --user disable --now ccgpt-usage@<lane-id>.timer`. Never the template, `ccgpt-usage@.timer`.
  - **The controller re-measures.** It never stops the service, which may be mid-way through an `auth.json` refresh write:

    ```bash
    export PATH="$HOME/.local/bin:$PATH"
    systemctl --user is-enabled '<foreign-usage-timer>'; systemctl --user is-active '<foreign-usage-timer>'
    st=''; for i in $(seq 1 30); do st="$(systemctl --user is-active '<foreign-usage-service>')"; case "$st" in inactive|failed) break ;; esac; sleep 10; done; echo "service: $st"
    ```
  - **Expect:** `disabled`, `inactive`, then `service: inactive` within 300 s, the publisher's own bound. On the second window, append `both-foreign-usage-timers-retired-per-lane` to `$PB/execution-slugs.tsv` (Part B's Global Constraints).
  - **Stop if:** the timer still reads `enabled` after the operator's second attempt, or the service is still active at 300 s.
  - **Rollback if reached:** RB11, then RB12–RB15.

- [ ] **Step 8: Move ONLY the lane's entry file aside (ruling B-3).** [LW <lane-id>]

  ```bash
  export PATH="$HOME/.local/bin:$PATH"
  W="$HOME/.ccrc-3b/<lane-id>-<UTC>"
  mv -n -T -- "$HOME/.local/bin/<lane-id>" "$HOME/.local/bin/<lane-id>.pre-ccrc-<UTC>"
  if [ -e "$HOME/.local/bin/<lane-id>" ] || [ -L "$HOME/.local/bin/<lane-id>" ]; then echo 'entry: STILL PRESENT'; else echo 'entry: moved'; fi
  ls -ld -- "$HOME/.local/bin/<lane-id>.pre-ccrc-<UTC>" | cut -c1
  ( cd / && sha256sum -c "$W/cp-ccgpt.sha256" )
  ```
  - **Expect:**
    - `entry: moved`;
    - `l` for lane 1, because the link itself moved and its target did not, or `-` for lane 2;
    - `<path>: OK`: `~/.local/bin/ccgpt` is byte-unchanged, because the other lane may still exec it until its own flip. Plan 4 removes it.
  - **Stop if:** anything else. In particular, `mv -n` refuses to overwrite an existing `.pre-ccrc-<UTC>` name.
  - **Rollback if reached:** RB10, then RB11–RB15.

- [ ] **Step 9: The roster flip. Build the candidate, validate it with the shipped parser in a scratch HOME, and rename it into place (ruling B-7, spec §4.1).** [LW <lane-id>]
  - **(a) Build it from the backup, which is still the live file.** Only this row's `exec` changes, to the five fields spec §4.1 requires. `label`, `configDirSuffix`, `homeAble`, `hue`, `telemetry` (`codex`) and any `pool` stay as they are:

    ```bash
    export PATH="$HOME/.local/bin:$PATH"
    W="$HOME/.ccrc-3b/<lane-id>-<UTC>"
    cmp -s -- "$W/accounts.json.bak" "$HOME/.ccrc/accounts.json" && echo 'roster: unchanged since Step 5' || echo 'roster: CHANGED'
    ( . "<abs scratch>/plan3b-exec/plan3b-env.sh" && "$PB/b1-candidate.sh" "$SCRATCH/plan3b-env.sh" <n> "$W/accounts.json.bak" "$W/accounts.candidate.json" ); echo "candidate rc=$?"
    jq -n --slurpfile a "$W/accounts.json.bak" --slurpfile b "$W/accounts.candidate.json" \
      '(($a[0] | .accounts |= map(del(.exec))) == ($b[0] | .accounts |= map(del(.exec)))) and (([$a[0].accounts, $b[0].accounts] | transpose | map(select(.[0].exec != .[1].exec) | .[0].id)) == ["<lane-id>"])'
    jq -c --arg id '<lane-id>' '.accounts[] | select(.id == $id) | .exec | keys' "$W/accounts.candidate.json"
    ```
    - **Expect:** `roster: unchanged since Step 5`, `candidate rc=0` (B1's `b1-candidate.sh`, the one spelling of the edit, which also refuses unless the lane is exactly one external row), `true`, `["authDir","kind","litellmPort","provider","proxyPort"]`.
    - `<lane-auth-dir>` is `$HOME`-relative and is not under `.ccrc/`. The parser refuses either breach.
  - **(b) The shipped parser, and the bare-node mirror plus its projection,** both run with `HOME` pointed at a scratch directory, so nothing either one might read reaches live state:

    ```bash
    export PATH="$HOME/.local/bin:$PATH"
    W="$HOME/.ccrc-3b/<lane-id>-<UTC>"
    T="$(readlink -f "$HOME/ccrc")"
    mkdir -p -- "$W/scratch-home"
    ( set -o pipefail; . "<abs scratch>/plan3b-exec/plan3b-env.sh" && HOME="$W/scratch-home" node "$PB/b1-dryrun.mjs" "$T/server/dist/shared/roster.js" "$W/accounts.candidate.json" | redact ); echo "parse rc=$?"
    HOME="$W/scratch-home" node "$T/deploy/gen-accounts.mjs" "$W/accounts.candidate.json" > "$W/accounts.sh.candidate"; echo "mirror rc=$?"
    HOME="$W/scratch-home" node "$T/deploy/gen-accounts.mjs" "$W/accounts.json.bak" > "$W/accounts.sh.before"; echo "mirror-before rc=$?"
    cmp -s -- "$W/accounts.sh.before" "$W/accounts.sh.candidate" && echo 'projection: unchanged by this edit' || echo 'projection: CHANGED'
    cmp -s -- "$W/accounts.sh.before" "$HOME/.ccrc/accounts.sh" && echo 'live accounts.sh: matches the roster' || echo 'live accounts.sh: differs from the roster'
    ```
    - **Expect:**
      - `parsed: <the live count> rows, codex-kind 1` on the first flip, or `codex-kind 2` on the second (B1's `b1-dryrun.mjs`), then `parse rc=0`;
      - `mirror rc=0` and `mirror-before rc=0`;
      - `projection: unchanged by this edit`. `accounts.sh` is keyed on telemetry, ids and config directories, and none of them moves, so `ccd` and `ccrc-codex`'s `_ccrc_dir_id` keep reading the same projection with no install;
      - `live accounts.sh: matches the roster`.
  - **(c) Rename it into place,** mode preserved, through a dot-named temporary file beside the roster, so that the rename is atomic on one filesystem:

    ```bash
    export PATH="$HOME/.local/bin:$PATH"
    W="$HOME/.ccrc-3b/<lane-id>-<UTC>"
    systemctl --user list-timers --all --no-legend ccrc-models.timer
    [ -f "$HOME/.ccrc/accounts.json" ] && [ ! -L "$HOME/.ccrc/accounts.json" ] && echo 'roster: regular file' || echo 'roster: NOT A REGULAR FILE'
    m="$(stat -c %a -- "$HOME/.ccrc/accounts.json")"
    cmp -s -- "$W/accounts.json.bak" "$HOME/.ccrc/accounts.json" && install -m "$m" -- "$W/accounts.candidate.json" "$HOME/.ccrc/.accounts.json.cutover-<UTC>" && mv -f -T -- "$HOME/.ccrc/.accounts.json.cutover-<UTC>" "$HOME/.ccrc/accounts.json"
    cmp -s -- "$W/accounts.candidate.json" "$HOME/.ccrc/accounts.json" && echo "roster: flipped, mode $(stat -c %a -- "$HOME/.ccrc/accounts.json") (was $m)" || echo 'roster: NOT FLIPPED'
    cmp -s -- "$W/accounts.candidate.json" "$HOME/.ccrc/accounts.json" && date -u +%s > "$W/flip.epoch"   # <flip-epoch>: B5 Step 5 reads it, Step 20 records it
    ```
    - **Expect:** the timer's next fire more than 20 minutes away, `roster: regular file`, then `roster: flipped, mode <m> (was <m>)`, and `flip.epoch` written.
    - **First window, lane 2 first only:** append `second-lane-first-accepts-z4-refusals` to `$PB/execution-slugs.tsv` (Part B's Global Constraints).
  - **From this line on, this lane is codex-kind.** No `ccgpt` invocation may name it again (Z4's reason), and its probe, its LiteLLM render and the usage converge all key on `exec.kind` (Z8).
  - **Stop if:**
    - (a) is not exactly as expected;
    - the parser or the mirror refuses. Read `.message` and `.remedy`, rename nothing, and correct the value from B1's record, never by guessing;
    - the projection changes;
    - the rename fails;
    - `ccrc-models.timer`'s next fire is within 20 minutes. Wait for it to fire and read its row, then re-run (a) to (c);
    - `roster: NOT FLIPPED` because the roster changed since Step 5 (the guarding `cmp` failed): re-run Steps 5 and 9.
  - **Rollback if reached:** before the rename, RB10–RB15. After it, RB7, then RB10–RB15.

- [ ] **Step 10: `ccrc wrappers` writes the lane's launcher.** [LW <lane-id>]

  ```bash
  export PATH="$HOME/.local/bin:$PATH"
  T="$(readlink -f "$HOME/ccrc")"
  ccrc wrappers --dry-run
  ccrc wrappers; echo "wrappers rc=$?"
  node --input-type=module -e 'const [tree, file] = process.argv.slice(1); const { verifyMarker } = await import(`${tree}/shared/mark.mjs`); const { readFileSync } = await import("node:fs"); console.log(`marker: ${verifyMarker(readFileSync(file, "utf8"))}`);' "$T" "$HOME/.local/bin/<lane-id>"
  grep -c 'ccrc-codex' "$HOME/.local/bin/<lane-id>"
  bash -c '. "$HOME/.ccrc/accounts.sh" && _ccrc_dir_id "$HOME/<lane-config-dir>"'; echo
  ```
  - **Expect:**
    - the dry run prints exactly one `WOULD-WRITE <lane-id>: <bin>/<lane-id> — …` line. The path is absent, because Step 8 moved the foreign file away, so a plain run writes it with no flag. Every other line is a `CONVERGED` already present at B1's census, and its `summary:` counts `0 refused`;
    - the plain run prints one `WRITE <lane-id>: …`, a summary with `1 written` and `0 refused`, and `wrappers rc=0`;
    - `marker: ccrc-unmodified`;
    - a count of at least `1`;
    - `<lane-id>`, the launcher's reverse map.
  - **Stop if:**
    - any `REFUSE`, including lock 5's witness refusal. It has no flag and is never forced;
    - a WRITE for any other id;
    - a marker other than `ccrc-unmodified`;
    - an empty reverse map.
  - **Rollback if reached:** RB7, then RB9–RB15.

- [ ] **Step 11: `<lane-registry>` = `no` only: `init codex` after the flip, and the before/after diff (ruling Z3).** [LW <lane-id>]. Skip it for lane 1.

  ```bash
  export PATH="$HOME/.local/bin:$PATH"
  W="$HOME/.ccrc-3b/<lane-id>-<UTC>"
  ccrc models '<lane-id>' init codex | tail -n 1 | jq -c '{ok, op, created, remedy: (.remedy // null)}'
  jq -rn --slurpfile x "$W/settings.json.bak" --slurpfile y "$HOME/<lane-config-dir>/settings.json" '($x[0].env // {}) as $p | ($y[0].env // {}) as $q | ([$p, $q | keys[]] | unique)[] as $k | "\($k)\t" + (if ($p | has($k)) and ($q | has($k)) then (if $p[$k] == $q[$k] then "same" else "changed" end) elif ($q | has($k)) then "added" else "removed" end)'
  jq -n --slurpfile x "$W/settings.json.bak" --slurpfile y "$HOME/<lane-config-dir>/settings.json" '"non-env settings unchanged: \(($x[0] | del(.env)) == ($y[0] | del(.env)))"'
  jq -rn --slurpfile x "$W/models.effort.json.bak" --slurpfile y "$HOME/.ccrc/models/<lane-id>.effort.json" '($x[0].byModel // {}) as $p | ($y[0].byModel // {}) as $q | ($p | keys) as $pk | ($q | keys) as $qk | ($pk - ($pk - $qk)) as $both | "before\t\($pk | length)", "after\t\($qk | length)", "in-both\t\($both | length)", "only-before\t\(($pk - $qk) | length)", "only-after\t\(($qk - $pk) | length)", "effort-changed-in-both\t\([$both[] as $k | select($p[$k] != $q[$k])] | length)"'
  ```
  - **Expect:**
    - `{"ok":true,"op":"init","created":true,"remedy":null}`. The codex seed ships a mapping, so no `remedy` appears;
    - in the env diff, only keys of `MODEL_ENV_KEYS` (`shared/modelenv.mjs`: the four `ANTHROPIC_DEFAULT_*_MODEL`, `ANTHROPIC_MODEL`, `ANTHROPIC_SMALL_FAST_MODEL`, `CLAUDE_CODE_SUBAGENT_MODEL`, `CLAUDE_CODE_MAX_CONTEXT_TOKENS`) may read anything but `same`;
    - `non-env settings unchanged: true`;
    - the effort counts are recorded as printed.

    Keys and counts only: no value and no model id is printed, because model ids stay out of tracked text and transcripts (critic #3). Append `lane-without-a-registry-inits-after-the-flip` to `$PB/execution-slugs.tsv` (Part B's Global Constraints).
  - **Stop if:**
    - `codex-registry-needs-codex-lane`. The flip did not land: re-run Step 9(c)'s `cmp`;
    - `probe-declared`;
    - any non-model key differs;
    - `non-env settings unchanged: false`.
  - **Rollback if reached:** RB6–RB15.

- [ ] **Step 12: The dead-token gate: `ccrc models refresh <lane-id>` (ruling B-7).** [LW <lane-id>]; `ccrc codex login` with the operator's browser.

  ```bash
  export PATH="$HOME/.local/bin:$PATH"
  W="$HOME/.ccrc-3b/<lane-id>-<UTC>"
  ccrc models refresh '<lane-id>' > "$W/refresh.json"; echo "refresh rc=$?"
  jq -c '.refreshed[] | {id, probe, ok, litellm: (.litellm // null), count: (.count // null), reason: ((.reason // "") | .[0:200])}' "$W/refresh.json"
  stat -c '%a %n' "$HOME/.ccrc/codex/<lane-id>/litellm.yaml"
  ```
  - **Expect:**
    - `refresh rc=0`;
    - `{"id":"<lane-id>","probe":"codex","ok":true,"litellm":"rendered","count":<n ≥ 1>,"reason":""}`, where `litellm` may read `unchanged`;
    - the lane's own `litellm.yaml` exists: the codex arm rendered it.
  - **The reading rule (ruling A-4):** this row counts only if `probe` is `codex`, `ok` is `true` and `litellm` is `rendered` or `unchanged`. `skipped` on a codex-probe row is a failure, whatever `ok` says.
  - **For both lanes:** run the last three commands of Step 11's block (the env-key diff, the non-env check and the effort counts) against the backups. Expect Step 11's shape: only `MODEL_ENV_KEYS` keys move, and `non-env settings unchanged: true`.
  - **Stop if:**
    - **`login-required` in `reason`.** The window halts for `ccrc codex login '<lane-id>'`, with the operator present. It prints only the runtime's device-flow URL and code. The operator signs in with their browser, and the login ends `ccrc codex: <lane-id>: logged in (auth.json is present in its authDir)`, rc 0. Then this step re-runs once. A second `login-required`, or a login whose rc is not 0, stops the window;
    - `runtime-api-moved`. The cure is a ccrc release, never a hand update;
    - any other `ok:false`, a `skipped` codex row, or rc 1.
  - **Rollback if reached:** RB6 when `<lane-registry>` is `no`, then RB7–RB15.

- [ ] **Step 13: `ccrc models litellm <lane-id>`.** [LW <lane-id>]

  ```bash
  export PATH="$HOME/.local/bin:$PATH"
  ccrc models litellm '<lane-id>' | tail -n 1 | jq -c '{changed}'; echo "litellm rc=${PIPESTATUS[0]}"
  ```
  - **Expect:** `{"changed":false}` (Step 12 just rendered it) and `litellm rc=0`.
  - **Stop if:** a refusal, or `changed:true` on a second run.
  - **Rollback if reached:** as Step 12.

- [ ] **Step 14: Enable ccrc's usage instance, by R-C10's ruling (ruling B-5).** [LW <lane-id>]
  - **R-C10 is an open operator ruling.** Recommendation: **(a)**.
    - **(a) The targeted enable**, measured in B1's command reference. It equals the spine's own `_inst_codex_usage` converge because Step 7's foreign disable came first, so the next auto-update finds nothing to change.
    - **(b) No enable now.** The next auto-update after Step 20 converges it. Step 16(f) then moves to B4. Meanwhile this lane's `~/.cc-limits` row ages, because its foreign publisher is already off.

    No arm runs `ccrc install`, `ccrc update` or `ccrc rollout` by hand.
  - **Under (a):**

    ```bash
    export PATH="$HOME/.local/bin:$PATH"
    systemctl --user is-enabled '<foreign-usage-timer>'
    systemctl --user enable --now 'ccrc-codex-usage@<lane-id>.timer'
    systemctl --user is-enabled 'ccrc-codex-usage@<lane-id>.timer'; systemctl --user is-active 'ccrc-codex-usage@<lane-id>.timer'
    ```
    - **Expect:** `disabled`, then `enabled` and `active`, re-measured and never read off the exit code.
    - **Lane 2 first:** the flat `ccgpt-usage.timer` is still enabled. It writes lane 1's row, its shell default, never lane 2's, so it is no second writer here, and ccrc's converge treats it as unattributable.
  - **Stop if:** `<foreign-usage-timer>` reads anything but `disabled`, or ccrc's timer is not `enabled`.
  - **Rollback if reached:** RB5, then RB6 when `<lane-registry>` is `no`, then RB7–RB15.

- [ ] **Step 15: `ccrc codex start <lane-id>`.** [LW <lane-id>]

  ```bash
  export PATH="$HOME/.local/bin:$PATH"
  systemctl --user list-units --all --no-legend --plain 'ccgpt-<lane-id>-*' | wc -l
  ss -Hltn "( sport = :<lane-shim-port> or sport = :<lane-litellm-port> )" | wc -l
  ccrc codex start '<lane-id>'; echo "start rc=$?"
  ```
  - **Expect:** `0` and `0` (nothing foreign loaded or listening immediately before the start; a non-zero count stops before the start, with Step 14's rollback), then `ccrc codex: <lane-id>: litellm started (systemd ccgpt-<lane-id>-litellm.service), shim started (systemd ccgpt-<lane-id>-shim.service)` and `start rc=0`.
  - **Stop if: any refusal.** `not-logged-in`, `runtime-absent`, `shim-absent`, `lane-unwritable`, `tier-not-ready` and `tier-foreign` each stop the window. For `tier-not-ready`, the operator reads the last lines of `~/.ccrc/logs/codex/<lane-id>/<tier>.log`; the controller does not print them, because a tier's log can carry request fragments.
    - **`unit-foreign` and `port-foreign` are an unconditional stop.** No flag exists to pass them, and none is sought.
    - **An `UNPROVEN` tier** in `ccrc codex status` within its 3 s `RestartSec` window is this lane's own crash loop, not a foreign unit. Re-read once after 5 s before treating it as foreign.
  - **Rollback if reached:** RB4 onward.

- [ ] **Step 16: Verify, none of it by reading a secret (spec §15.3).** [RO], except (e) and (f), which are [LW <lane-id>]
  - **(a) Unit names and slice:**

    ```bash
    for t in litellm shim; do systemctl --user show -p Id -p Slice -p ActiveState -p SubState -p Transient -p MainPID "ccgpt-<lane-id>-$t.service" | tr '\n' ' '; echo; done
    ```
    - **Expect, per tier:** `Id=ccgpt-<lane-id>-<tier>.service`, `Slice=app.slice`, `ActiveState=active`, `SubState=running`, `Transient=yes`, and a non-zero `MainPID`.
  - **(b) `/ccgpt/lane` answers JSON, through `ccrc codex status`, never a hand `curl`:**

    ```bash
    export PATH="$HOME/.local/bin:$PATH"
    ccrc codex status '<lane-id>' --json | jq -c '{litellm: .tiers.litellm, shim: .tiers.shim, runtime: .runtime.generation, lane: .lane.json}'
    ```
    - **Expect:** both tiers `{"state":"running","via":"systemd","pid":<that tier's MainPID>}`, and a runtime generation.
    - The shim reads `running` only when `GET /ccgpt/lane` answered status 200, `Content-Type: application/json`, and the body `{"lane":"<lane-id>"}` (`_codex_lane_answer`). The other repository's `text/plain` answer is refused by that same reader.
  - **(c) Each `MainPID` holds its port, by listing, with no connect:**

    ```bash
    for t in litellm shim; do pid="$(systemctl --user show -p MainPID --value "ccgpt-<lane-id>-$t.service")"; port='<lane-litellm-port>'; [ "$t" = shim ] && port='<lane-shim-port>'; printf '%s mainpid=%s holders=%s\n' "$t" "$pid" "$(ss -Hltnp "sport = :$port" | grep -o 'pid=[0-9]*' | sort -u | tr '\n' ' ')"; done
    ```
    - **Expect:** each line's holders are exactly `pid=<its mainpid>`.
  - **(d) The gateway key reaches the tier only through its envfile (spec §5.4, §19.4). The unit's `Environment` property is never read, not even through a counting pipe (ruling R3):**

    ```bash
    export PATH="$HOME/.local/bin:$PATH"; T="$(readlink -f "$HOME/ccrc")"
    systemctl --user show -p EnvironmentFiles --value 'ccgpt-<lane-id>-litellm.service' | grep -c '/\.ccrc/codex/<lane-id>/runtime\.env'
    sed -n '/^_svc_run_supervised() {/,/^}$/p' "$T/ccd/ccrc" | grep -c 'a secret travels in the envfile, never in argv or unit metadata'
    ```
    - **Expect:** `1`, then `1`. Step 15 started both tiers through `ccrc codex start`, and (a) read `Transient=yes`, so both went through `_svc_run_supervised`, which refuses, with rc 64 and before `systemd-run` is called, any `--setenv` name ending in KEY, TOKEN, SECRET, PASSWORD or PASSWD. So the key's only route into the unit is `EnvironmentFile=` `runtime.env`, which the first count shows. This closes 2b2-4 for the lane with no read of unit metadata values.
  - **(e) A headless streamed turn and a tool call, through the lane's own wrapper.** [LW <lane-id>], the window's one test turn:

    ```bash
    export PATH="$HOME/.local/bin:$PATH"
    W="$HOME/.ccrc-3b/<lane-id>-<UTC>"
    mkdir -p -- "$W/turn" && cd "$W/turn" && timeout 600 "$HOME/.local/bin/<lane-id>" -p 'Run the shell command true with your Bash tool, then reply with the single word done.' --output-format stream-json --verbose --include-partial-messages --allowedTools 'Bash(true)' --max-turns 4 > "$W/turn.jsonl" 2> "$W/turn.err"; echo "turn rc=$?"
    jq -r 'select(.type == "result") | "result \(.subtype) is_error=\(.is_error)"' "$W/turn.jsonl"
    jq -r 'select(.type == "assistant") | .message.content[]? | select(.type == "tool_use") | .name' "$W/turn.jsonl" | sort | uniq -c
    jq -r 'select(.type == "stream_event") | .type' "$W/turn.jsonl" | wc -l
    grep -c '^ccrc-codex: ' "$W/turn.err"
    ```
    - **Expect:** `turn rc=0`, `result success is_error=false`, at least `1 Bash`, a non-zero stream-event count (the turn streamed through the shim), and `0` launcher refusals. No model text and no model id is printed.
  - **(f) One publisher run leaves a fresh row, and this lane has a single writer.** Under R-C10 (a); under (b) this moves to B4. [LW <lane-id>]:

    ```bash
    export PATH="$HOME/.local/bin:$PATH"
    systemctl --user start 'ccrc-codex-usage@<lane-id>.service'; echo "publisher rc=$?"
    systemctl --user show -p Result --value 'ccrc-codex-usage@<lane-id>.service'
    jq -r --argjson now "$(date +%s)" '"row age=\($now - .ts)s seven=\(.seven != null) five-key=\(has("five"))"' "$HOME/.cc-limits/<lane-id>.json"
    systemctl --user is-enabled '<foreign-usage-timer>'; systemctl --user is-active '<foreign-usage-service>'
    ```
    - **Expect:**
      - `publisher rc=0` (a oneshot; `start` returns when it ends, at most 300 s);
      - `success`;
      - `row age=<at most 120>s seven=true five-key=true`;
      - `disabled` and `inactive`: ccrc's instance is the lane's only enabled publisher.
  - **(g) Doctor:**

    ```bash
    export PATH="$HOME/.local/bin:$PATH"
    W="$HOME/.ccrc-3b/<lane-id>-<UTC>"
    ccrc doctor > "$W/doctor-after.txt" 2>&1; echo "doctor rc=$?"
    grep -E '^(PASS|WARN|FAIL|SKIP) codex: ' "$W/doctor-after.txt"
    awk '/^(PASS|WARN|FAIL|SKIP) [a-z0-9-]+:/ { c = $2; sub(":$", "", c); print c, $1 }' "$W/doctor-after.txt" | sort -u > "$W/doctor-after-classes.txt"
    diff -- "$W/cp-doctor-classes.txt" "$W/doctor-after-classes.txt"
    ```
    - **Expect:**
      - lane 1, either ordinal, and lane 2 on the second flip: `PASS codex: <1 or 2> Codex lane(s): <ids> (…; ccrc-codex-usage@<lane-id>.timer enabled, usage row <n>s old); runtime gen-…; the four GPT-lane executables match the shipped tree`;
      - lane 2 on the first flip: exactly one codex line, `WARN codex: another repository's ccgpt-usage.timer is enabled on this box; it names no lane, so ccrc cannot tell whether it is a second publisher of a codex lane's ~/.cc-limits row` ⟦D:flat-foreign-timer-warns-until-lane-one-flips⟧;
      - `diff` shows only the `codex` pair changing. Every other check keeps its checkpoint class.
  - **Second flip only:** `ccrc codex status '<other-lane-id>' --json | jq -c '[.tiers.litellm.state, .tiers.shim.state]'` still prints `["running","running"]`.
  - **Stop if:** any line differs. Never `ccrc doctor --fix` inside the window: a WARN never triggers it, and a FAIL here is a rollback.
  - **Rollback if reached:** RB4 onward.

- [ ] **Step 17: `ccrc account enable`.** [LW <lane-id>]

  ```bash
  export PATH="$HOME/.local/bin:$PATH"
  ccrc account enable --id '<lane-id>'
  ```
  - **Expect:** `{"ok":true,"id":"<lane-id>","disabled":false}`.
  - **Stop if:** `marker-conflict` or `marker-write`.
  - **Rollback if reached:** RB3 (switch it off again), then RB4 onward.

- [ ] **Step 18: Un-park, with symmetric swaps.** [LW <lane-id>]
  - **For each row of `parked.tsv`, one at a time:**
    1. Take Step 3's idle-point reads on the session, now on `<park-target-wrapper>`. The same answers are required, because this swap also replaces the pane.
    2. Swap it back, and watch its unit for 60 s:

       ```bash
       export PATH="$HOME/.local/bin:$PATH"
       W="$HOME/.ccrc-3b/<lane-id>-<UTC>"
       ccd swap '<session-id>' '<lane-id>'
       date -u +%s%3N > "$W/unpark-<session-id>.epoch"
       sleep 10; r0="$(systemctl --user show -p NRestarts --value 'claude-session@<session-id>.service')"
       sleep 60; r1="$(systemctl --user show -p NRestarts --value 'claude-session@<session-id>.service')"
       printf 'unit=%s restarts=%s->%s\n' "$(systemctl --user is-active 'claude-session@<session-id>.service')" "$r0" "$r1"
       journalctl --user -u 'claude-session@<session-id>.service' --since '-3min' --no-pager -o cat | grep -c 'ccrc-codex: '
       ccd ls | awk -v s='<session-id>' 'NR > 1 && $1 == s { print $2, $3 }'
       ```
       - **Expect:** `swapped <session-id>: <park-target-wrapper> -> <lane-id> (…)`, then `unit=active restarts=<n>-><n>`, `0`, and `<lane-id> running`.
  - **Each session's first turn on the lane, read-only.** It is whatever reaches the session next: a mail nudge, or a prompt the operator sends from the PWA. Re-read until a turn after the un-park has ended:

    ```bash
    W="$HOME/.ccrc-3b/<lane-id>-<UTC>"
    jq -r --argjson t "$(cat "$W/unpark-<session-id>.epoch")" 'if (.turnAt // 0) > $t then "first turn: \(.state) err=\(.err)" else "first turn: not yet" end' "$HOME/.cc-sessions/<session-id>.turn.json"
    ```
    - **Expect:** `first turn: done err=null`.
    - The window stays open until every un-parked session prints that line. At the operator's word, a session that has not yet taken a turn hands its watch to B4 (it reads `unpark-<session-id>.epoch`), and the window closes over it ⟦D:first-turn-watch-may-outlive-the-window⟧.
  - **Stop if:** a swap dies, the unit is not `active`, the restart count rises, any launcher refusal line appears, or a first turn ends `failed`. That session is swapped straight back out to `<park-target-wrapper>`, with `ccd swap '<session-id>' '<park-target-wrapper>'` at its next idle point, and the lane rolls back (critic #20).
  - **Rollback if reached:** RB2 for every session already back on the lane, then RB3 onward.

- [ ] **Step 19: First flip, lane 2 first only: arm the Z4 monitor for lane 1 (read-only).** [RO]

  ```bash
  export PATH="$HOME/.local/bin:$PATH"
  W="$HOME/.ccrc-3b/<lane-id>-<UTC>"
  { systemctl --user list-timers --all --no-legend ccrc-models.timer
    systemctl --user show -p ActiveState -p Result ccrc-models.service | tr '\n' ' '; echo
    printf 'refused-restarts-since-window=%s\n' "$(journalctl --user -u ccrc-models.service --since '<UTC>' --no-pager -o cat | grep -c 'ccrc will not stop it')"
    stat -c 'mtime=%Y %n' "$HOME/.ccrc/models/<other-lane-id>.classes.json" "$HOME/.ccrc/models/<other-lane-id>.json" '<box-global-litellm-config>'
    printf 'pgrep-box-global=%s\n' "$(pgrep -f "litellm .*<box-global-litellm-config>" | wc -l)"
  } | tee "$W/z4-baseline.txt"
  ```
  - **Expect:**
    - the timer's next fire;
    - `ActiveState=inactive Result=success`, or `Result=exit-code` if a fire since the flip met a changed lane-1 render;
    - a count of refused restarts, matched on the phrase Z4's detail carries (`the LiteLLM proxy is running on the PREVIOUS config, and ccrc will not stop it`), because the refresh row's `reason` holds that detail and not the code word;
    - the three mtimes;
    - `pgrep-box-global=1`: lane 1's foreign LiteLLM.
  - **From here the hourly monitor is B4's criterion 8**, never this block, which is the window's own baseline record. A rising count while lane 1 serves is Z4's accepted, bounded degradation: lane 1 keeps serving its unchanged config. If the catalogue mtime moves past the render mtime, that measures how often lane 1's rendered model list has gone stale. Lane 1's own flip is the remedy, never a hand stop of its proxy.
  - **Stop if:** never in this task. B4 owns the criteria.
  - **Rollback if reached:** none. The step is read-only.

- [ ] **Step 20: Resume auto-update and close the window's record.** [OP] for the resume, [RO] for the reads.
  - **The operator** restores `<prior-auto>` and `<prior-channel>` on the PWA's Settings screen, or with the same per-node intent call carrying the recorded values if Step 1 used it.
  - **The controller:**

    ```bash
    export PATH="$HOME/.local/bin:$PATH"
    W="$HOME/.ccrc-3b/<lane-id>-<UTC>"
    l=''; for i in $(seq 1 18); do l="$(ccrc channel | head -n 1)"; case "$l" in *' auto=<prior-auto>') break ;; esac; sleep 10; done; echo "$l"
    ccrc version | head -n 1
    printf 'lane\t%s\nwindow\t%s\nflip\t%s\nhas-registry\t%s\nversion\t%s\nrefresh\t%s\ndoctor-codex\t%s\nclosed\t%s\n' '<lane-id>' '<UTC>' '<flip-ordinal>' '<lane-registry>' "$(ccrc version | head -n 1)" "$(jq -c '.refreshed[0] | {probe, ok, litellm}' "$W/refresh.json")" "$(grep -E -m1 '^(PASS|WARN|FAIL) codex: ' "$W/doctor-after.txt" | cut -d' ' -f1)" "$(date -u +%Y%m%dT%H%M%SZ)" > "$W/record.tsv"
    ```

    Then record the flip in the values file, and refresh the reference file's section:

    ```bash
    . "<abs scratch>/plan3b-exec/plan3b-env.sh"
    lane <n> && vset FLIPPED "${FLIPPED:+$FLIPPED }<n>" && vset "L<n>_FLIP_EPOCH" "$(cat "$HOME/.ccrc-3b/<lane-id>-<UTC>/flip.epoch")"
    P="$(git worktree list --porcelain | sed -n '1s/^worktree //p')"; python3 "$PB/b1-reference.py" "$VALUES" "$P/deploy/reference-fleet.md"
    ```
  - **Expect:**
    - `channel: state=ok channel=<prior-channel> … auto=<prior-auto>` within 180 s;
    - the same version as `cp-version.txt`: no update landed inside the window;
    - `record.tsv` written; B6 Step 5 reads it;
    - the reference line, with `FLIPPED` and `L<n>_FLIP_EPOCH` recorded, so the next window's census expects this lane codex.
  - **Stop if:**
    - the intent does not come back within 180 s. The operator re-applies it;
    - the version moved inside the window. Report: an update's spine ran over a half-cut lane, and B4's first read re-measures everything above.
  - **Rollback if reached:** none of its own. A later rollback re-pauses first (RB1).

**Rollback, per step reached (ruling B-8).** Run the rows top to bottom, skipping each row whose step was not reached. Between RB1–RB3 (re-pause, sessions out, the account off) and RB13–RB15 (the account on, sessions back, the intent restored), the order is B-8's:
1. ccrc's stop first;
2. ccrc's usage instance;
3. the backups, with `ccrc models <lane-id> rm` before the roster for a lane that had no registry;
4. the marker-verified wrapper;
5. the entry file;
6. the operator's foreign timer;
7. the other repository's tiers.

A row's own failure stops the rollback and goes to the operator; it is never forced. Every row falls under [LW <lane-id>] unless it says [OP]. Each row's command runs after `export PATH="$HOME/.local/bin:$PATH"` and `W="$HOME/.ccrc-3b/<lane-id>-<UTC>"`.

| Row | Run if this step was reached | What it undoes, and the exact command | Expect |
|---|---|---|---|
| RB1 | 20 | [OP] Pause auto-update again, as Step 1, and read `auto=off` the same way | `… auto=off` within 180 s |
| RB2 | 18 | Every session on the lane goes back out, each at an idle point (Step 3's two reads): `ccd swap '<session-id>' '<park-target-wrapper>'` | `swapped <session-id>: <lane-id> -> <park-target-wrapper> (…)`, and Step 3's closing count prints `0` |
| RB3 | 17 | `ccrc account disable --id '<lane-id>'` | `{"ok":true,"id":"<lane-id>","disabled":true}` |
| RB4 | 15 | **ccrc's stop first**, never the other repository's: `ccrc codex stop '<lane-id>'`, then `ccrc codex status '<lane-id>' --json \| jq -c '[.tiers.litellm.state, .tiers.shim.state]'` | `ccrc codex: <lane-id>: litellm stopped, shim stopped`, then `["stopped","stopped"]`. A `foreign` or `UNPROVEN` tier is re-read after 5 s, and is then the operator's |
| RB5 | 14 (a), or whenever `ccrc-codex-usage@<lane-id>.timer` measures enabled (`systemctl --user is-enabled`), as under R-C10 (b) after a converge | `systemctl --user disable --now 'ccrc-codex-usage@<lane-id>.timer'`, then `systemctl --user is-enabled 'ccrc-codex-usage@<lane-id>.timer'`, then wait up to 300 s for `systemctl --user is-active 'ccrc-codex-usage@<lane-id>.service'` to read `inactive`. The service is never stopped, because it may be writing `auth.json` (ruling A-3's reason) | `disabled`, re-measured and never read off the exit code (ruling A-2), then `inactive` |
| RB6 | 11 (lane 2 only) | Before RB7's roster restore, while the row is still codex-kind: `ccrc models '<lane-id>' rm`. A registry left on an external row would be probed hourly through lane 1's directory: Z3 keeps an existing registry (Plan 3a Task 7, hazard 4) | `{"ok":true,"op":"rm","id":"<lane-id>","removed":[…],"settings":"cleared"}` |
| RB7 | 9(c) | The roster backup: `m="$(stat -c %a -- "$W/accounts.json.bak")"; install -m "$m" -- "$W/accounts.json.bak" "$HOME/.ccrc/.accounts.json.rollback-<UTC>" && mv -f -T -- "$HOME/.ccrc/.accounts.json.rollback-<UTC>" "$HOME/.ccrc/accounts.json"; cmp -- "$W/accounts.json.bak" "$HOME/.ccrc/accounts.json" && echo restored` | `restored`. From here the lane is `external` again, and its probe, render and converge follow it (Z1) |
| RB8 | 11 or 12 | The settings and models backups, modes included: `cp -p -- "$W/settings.json.bak" "$HOME/<lane-config-dir>/settings.json"; while read -r f; do cp -p -- "$W/models.$f.bak" "$HOME/.ccrc/models/<lane-id>.$f"; done < "$W/models-existed.txt"`, then Step 5's two verification loops | every line `ok …`. Lane 2 gets its effort file back and nothing else; lane 1 gets all four |
| RB9 | 10 | The marker-verified wrapper: Step 10's `verifyMarker` command, then `rm -- "$HOME/.local/bin/<lane-id>"` only if it printed `marker: ccrc-unmodified` | `marker: ccrc-unmodified`, then the path is absent. A `ccrc-edited` or `foreign` answer leaves the file and goes to the operator |
| RB10 | 8 | The entry file: `mv -n -T -- "$HOME/.local/bin/<lane-id>.pre-ccrc-<UTC>" "$HOME/.local/bin/<lane-id>"`, then, for lane 1, `readlink "$HOME/.local/bin/<lane-id>"`, then `( cd / && sha256sum -c "$W/cp-ccgpt.sha256" )` | the entry is back, lane 1's link names `ccgpt` again, and `ccgpt` reads `OK` |
| RB11 | 7 | [OP] The foreign timer, after RB5 and never before, or the converge degrades (Plan 3a Task 6, hazard 5). Lane 1: `systemctl --user enable --now ccgpt-usage.timer`. Lane 2: `systemctl --user enable --now ccgpt-usage@<lane-id>.timer`. Then `systemctl --user is-enabled '<foreign-usage-timer>'` | `enabled` |
| RB12 | 6 | The other repository's tiers, restarted lane-explicitly. Its launcher has no start verb and ensures both tiers on every launch, so the start is one headless turn through the restored entry file with the id set: `mkdir -p -- "$W/turn" && cd "$W/turn" && CCGPT_ACCOUNT_ID='<lane-id>' timeout 600 "$HOME/.local/bin/<lane-id>" -p 'Reply with the single word ok.' --max-turns 1 > "$W/foreign-restart.txt" 2>&1; echo "rc=$?"`, then `systemctl --user list-units --all --no-legend --plain 'ccgpt-<lane-id>-*' \| awk '{ print $1, $3, $4 }'`, then `ss -Hltn "( sport = :<lane-shim-port> or sport = :<lane-litellm-port> )" \| wc -l` | `rc=0`, both `ccgpt-<lane-id>-*` units `active running`, then `2`. For lane 1 the restored launcher reads the box-global config. Nothing rendered it while lane 1 was codex, and the next hourly refresh renders it as before (Z1) |
| RB13 | 4 | `ccrc account enable --id '<lane-id>'` | `{"ok":true,"id":"<lane-id>","disabled":false}` |
| RB14 | 3 | Each row of `parked.tsv` back to the lane, now on the restored foreign launcher, at an idle point: `ccd swap '<session-id>' '<lane-id>'`, with Step 18's 60 s unit watch | `swapped …`, `unit=active`, and the restart count unchanged |
| RB15 | 1 | [OP] Restore `<prior-auto>` and `<prior-channel>`, read back as in Step 20 | `… auto=<prior-auto>` |

- **After a rollback, read-only:**
  - `ccrc doctor`'s classes equal `cp-doctor-classes.txt`, except the `codex` row. That row may add one `WARN codex: lane state is left under …/.ccrc/codex/<lane-id>, and '<lane-id>' is not a Codex lane in …`: the lane state is kept by design (spec §13), and Plan 3a Task 10's flip back pins exactly that leftover;
  - no WARN names an enabled `ccrc-codex-usage@<lane-id>.timer` (ruling A-2's doctor row);
  - `ccrc wrappers --dry-run` prints no line for `<lane-id>`, and no `ORPHAN`;
  - if Step 20 had recorded the flip, `vset FLIPPED` with `<n>` removed and `vset L<n>_FLIP_EPOCH ''`, so the next census expects the roster RB7 restored;
  - the backups in `<window-dir>` are kept until B4 closes.
- **A rollback after a lane-2 first flip** makes lane 2 external again with no registry (RB6), so Z4's guard sees no codex row, and lane 1's hourly refresh is today's again.

### Task B4: the soak gate

**Files:** none tracked. Box-local only, under the Part B evidence root `$PB` that Task B1's `plan3b-env.sh` defines (0700): the gate script `$PB/b4-sample.sh` (written once, Step 1, reused by Task B5), and one gate directory per lane, `$PB/b4-<lane-id>/` (0700), holding the gate's start record and one `sample-<epoch>/` directory per sample.

**Interfaces:**
- Consumes: `plan3b-env.sh` (`$PB`); `<doctor-baseline>` = `$PB/evidence/b1-doctor-classes.txt`, Task B1 Step 6's class table (one `<check> <CLASS>` line per check), taken before any flip; Task B3's completed run for `<lane-id>`, ending with every parked session un-parked and the window's auto-update pause lifted; `<foreign-usage-timer>` and, between lanes in the lane-2-first order only, `<still-external-lane-id>`, both from Task B1's values file.
- Produces: `b4-sample.sh <lane-id> <gate-dir> <foreign-usage-timer> <doctor-baseline> [<still-external-lane-id>]`, exit `0` PASSED, `1` OPEN, `2` STOP, `3` ROLLBACK, `64` usage; `$PB/b4-<lane-id>/start` (the gate's epoch); and the last sample's `verdicts.txt`, which Task B5 Step 1 and Task B6 Step 1 read.

**Why:** ruling B-10. A lane that has just served a headless test turn (Task B3) has not yet shown that it holds up under the box's own machinery: the hourly `ccrc-models.timer` refresh on the codex arm, ccrc's usage publisher as the row's only writer, and an auto-update that re-runs the install spine over a running codex lane (`_inst_codex_runtime`, `_inst_codex_tiers`, `_inst_codex_usage`, `ccd/ccrc`). The gate measures each of those read-only, from evidence the box already keeps (the user journal, unit state, the `~/.cc-limits` row, the tier logs), so a sample taken hours apart still covers the hours between. It runs twice: between the two lanes, for the first lane, and after the second lane (Task B5 Step 7), for the second lane plus one confirming sample of the first. **The gate never pauses auto-update** (R-O6: a lane's window only, never across the soak), never runs `ccrc update`, `ccrc rollout`, `ccrc models refresh` or `ccrc doctor --fix`, and never prompts a session.

**The criteria.** Every one is measured by `b4-sample.sh`, criterion by criterion, and none is waived by a later sample.

| # | Criterion | PASS needs | STOP or ROLLBACK when | Source |
|---|---|---|---|---|
| 1 | refresh | at least one `ccrc-models.timer` run since the gate opened whose row for this lane takes the codex arm, by the reading rule below, and no failed or `skipped` row for this lane | ROLLBACK: a restart-class row (`could not be stopped`, `did not start again`, `is DOWN`) or a foreign-tier row. STOP: `login-required`; an `ok:true` row reading `skipped`; any other failed row; a run with no row for this lane; a `rendered` row while the lane's own `litellm.yaml` is older than the gate | B-10 ("at least one refresh taking the codex arm", "no `restart-failed` row for the flipped lane"); A-4 |
| 2 | service | `ccrc-models.timer` active; `ccrc-models.service` not failed | STOP: a dead timer, or a failed service the sample cannot attribute. EXPECTED (lane-2-first, between lanes): failed on the still-external lane's Z4 row alone | B-1 |
| 3 | usage | the other repository's timer for this lane disabled and inactive; `ccrc-codex-usage@<lane-id>.timer` enabled and active; at least four publishes since the gate opened; the row's `ts` belongs to ccrc's last publish | ROLLBACK: the row older than 1800 s, or any gap between ccrc's publishes longer than 1800 s (two 15-minute intervals). STOP: a second writer (the foreign timer back on, or a `ts` ccrc's last run did not write) | B-10 ("a usage row refreshing every 15 min from a single writer"); carry-forward stop criteria |
| 4 | doctor | no FAIL line; no WARN on a check that did not WARN in `<doctor-baseline>`; `PASS codex` naming this lane | ROLLBACK: a codex FAIL naming a foreign tier or listener. STOP: any other FAIL, a new WARN, any other codex WARN. EXPECTED (lane-2-first, between lanes): codex's one WARN is the flat `ccgpt-usage.timer` ⟦D:flat-foreign-timer-warns-until-lane-one-flips⟧ | B-10 ("doctor clean") |
| 5 | tiers | `ccrc codex status <lane-id> --json` reads both tiers `running`; no gateway 401 in the lane's tier logs since the gate opened (counted, never printed) | ROLLBACK: a tier reading `foreign`, or any 401. STOP: a tier log shorter than at the gate's start (its count is unmeasured), or a tier `stopped` while sessions run | carry-forward stop criteria (a gateway 401, a foreign-listener finding) |
| 6 | sessions | at least one supervised session on the lane shows a completed turn (`.turn.json` state `done` with a `turnAt` after the gate opened: a turn that began after the gate and ended, never a restart that only re-stamped `at`) | ROLLBACK: a launcher refusal (`ccrc-codex: <code>:`) or start-limit line in any `claude-session@<session-id>` journal, or a failed `claude-session@<session-id>` unit. STOP: a session ending on a `failed` turn (ruling B-2's first-turn rule) | B-10 ("a real session turn"); carry-forward stop criteria |
| 7 | update | one update landed on the box since the gate opened (`ccrc version` moved, `~/.ccrc/update.json` phase `done`), and its journal shows `install: codex runtime:` re-measured, `install: codex tiers:` measured, and this lane in `install: codex-usage: enabled for …`, with no `NOT …` or `restart FAILED` line | STOP: auto-update reads `off`; a landing that ended `reverted` or `failed`; a landing whose codex lines carry a NOT/FAILED line or are missing from the journal | B-10 ("one auto-update landing while the lane is codex"); carry-forward critic #4 |
| 8 | z4 | (lane-2-first, between lanes only) recorded, never a gate failure: how many timer runs Z4 refused for the still-external lane, whether its catalogue and the box-global render changed since the gate opened, how many processes hold the box-global config | NOTE: a still-external-lane row that failed for any reason other than Z4, reported to the operator and never this lane's rollback | B-1 |

**The reading rule (A-4), stated once.** A refresh row counts as having taken the codex arm only when all of these hold: it is a `ccrc-models.service` run's row (`journalctl --user -u ccrc-models.service`, the line beginning `{"ok":`), it names `<lane-id>`, and it reads `probe: "codex"`, `ok: true` and `litellm: "rendered"` or `"unchanged"`. The roster row is `exec.kind: "codex"` from the flip on, and after Part A's A-1 an undecidable roster read refuses rather than folding to the external arm, so such a row was rendered by the lane's own arm into `$HOME/.ccrc/codex/<lane-id>/litellm.yaml`. A `rendered` row is corroborated by that file's mtime. **An `ok: true` row reading `skipped` never counts:** for a codex-probe row it is the signature of the bodyless `_models_litellm` failure that Part A's A-4 turns into a failed row, and the gate reads it as failure evidence whether or not that fix is on the box. A failed row, or a run with no row for this lane, never counts either. `ccrc models refresh <lane-id>` run by hand in Task B3 is not a timer run and is not counted.

**The lane-2-first order: Z4 between the lanes (ruling B-1).** If the operator rules R-O1 for lane 2 first, lane 1 is still `external`, still has its class registry, and its foreign proxy still runs on the box-global config while lane 2 soaks. From lane 2's flip until lane 1's, every hourly refresh whose render of lane 1 would change is refused by Z4 (`restart-failed`, row reason "… ccrc will not stop it: the roster names codex-kind lane(s) …"), `ccrc models refresh --all` exits 1 and `ccrc-models.service` reads failed. Lane 1 keeps serving on its unchanged config, with the model list it had. The gate accepts that, records it on every sample (criterion 8: refused runs, catalogue changed yes/no, render rewritten yes/no, proxy count), and passes the still-external lane's id as the fifth argument so criterion 2 can attribute the failed service. How often lane 1's catalogue changed is read as a hash of its catalogue's `models` array against the gate's opening, not as a file mtime: the probe rewrites `~/.ccrc/models/<lane-id>.json` on every run, changed or not, while the class registry's own mtime moves only on an operator's `set-class`; the box-global render's mtime moves only when something writes it, which Z4 forbids. The remedy is lane 1's own flip, Task B5. Doctor's box-level usage row also WARNs while lane 1's flat `ccgpt-usage.timer` stays enabled, because it names no lane; between lanes in this order, that one WARN is read as expected (criterion 4). In the lane-1-first order no external lane has a registry after the first flip, nothing is refused, and the fifth argument is never given.

**The minimum duration.** A gate passes no sooner than **24 hours** after it opened, and only when every criterion reads PASS (or EXPECTED) at once. Twenty-four hours is twenty-four hourly refreshes and about ninety-six usage publishes. The one criterion the gate cannot hurry is the landing (criterion 7); Step 5 says what happens while it waits. R-O9's full weekly window is not this gate's: it starts in Task B6 Step 7 and gates Plan 4.

- [ ] **Step 1: Write the gate script, once (read-only on the box; it writes only into `$PB`).**

  Before the first gate only. Task B5 reuses it unchanged. Run as one foreground call; the heredoc terminator reaches column 0 once the fence's indentation is removed (Global Constraints).

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  [ ! -e "$PB/b4-sample.sh" ] || { echo "b4: $PB/b4-sample.sh exists; it is written once" >&2; exit 1; }
  ( umask 077; cat > "$PB/b4-sample.sh" ) <<'EOF'
  #!/usr/bin/env bash
  # b4-sample.sh — Plan 3b Task B4: one soak-gate sample for ONE codex lane. READ-ONLY.
  # usage: b4-sample.sh <lane-id> <gate-dir> <foreign-usage-timer> <doctor-baseline> [<still-external-lane-id>]
  # It reads unit states, the user journal, file sizes and mtimes, the lane's
  # ~/.cc-limits row, `ccd ls`, the lane's sessions' turn markers, `ccrc codex
  # status`, `ccrc version`, `ccrc channel` and `ccrc doctor` (whose bounded connects
  # go only to the ports the roster names for a codex lane). It starts, stops,
  # enables, disables, resets and signals nothing, and reads no auth.json, no unit
  # Environment= and no key-bearing file. Tier logs are COUNTED, never printed, and
  # no verdict line spells a lane id. It writes only under <gate-dir>/sample-<epoch>/.
  # Exit: 0 PASSED, 1 OPEN, 2 STOP, 3 ROLLBACK, 64 usage.
  set -uo pipefail
  [ "$#" -ge 4 ] || { echo "usage: b4-sample.sh <lane-id> <gate-dir> <foreign-usage-timer> <doctor-baseline> [<still-external-lane-id>]" >&2; exit 64; }
  L=$1; G=$2; F=$3; B=$4; X=${5:-}
  for f in start version offset-litellm offset-shim; do
    [ -s "$G/$f" ] || { echo "b4: $G/$f is missing; run Task B4 Step 2 first" >&2; exit 64; }
  done
  [ -s "$B" ] || { echo "b4: the doctor baseline $B is missing" >&2; exit 64; }
  if [ -n "$X" ] && { [ ! -s "$G/x-catalogue" ] || [ ! -s "$G/x-render-mtime" ]; }; then
    echo "b4: $G has no x-catalogue/x-render-mtime; Step 2's Z4 block was not run for this gate" >&2; exit 64
  fi
  T0=$(cat "$G/start"); now=$(date -u +%s); T0ms=$((T0 * 1000)); el=$((now - T0))
  E="$G/sample-$now"; ( umask 077; mkdir -p -- "$E" ) || exit 1
  RB=0; ST=0; WT=0
  v() {   # <criterion> <PASS|WAIT|STOP|ROLLBACK|EXPECTED|NOTE> <why>
    case "$2" in ROLLBACK) RB=1 ;; STOP) ST=1 ;; WAIT) WT=1 ;; esac
    printf 'B4 %-9s %-8s %s\n' "$1" "$2" "$3" | tee -a "$E/verdicts.txt"
  }
  n() { local r; r=$(jq -s "$1" "$2" 2>/dev/null) || r=0; printf '%s' "${r:-0}"; }
  
  # 1. REFRESH — the A-4 reading rule: only a timer row for this lane that says
  #    probe "codex", ok true and litellm "rendered" or "unchanged" took the codex arm.
  journalctl --user -q -u ccrc-models.service --since "@$T0" -o cat 2>/dev/null | grep '^{"ok":' > "$E/runs.jsonl"
  runs=$(wc -l < "$E/runs.jsonl" | tr -d ' ')
  jq -c --arg id "$L" '.refreshed[]? | select(.id == $id)' "$E/runs.jsonl" > "$E/rows.jsonl" 2>/dev/null
  rows=$(wc -l < "$E/rows.jsonl" | tr -d ' ')
  took=$(n '[.[] | select(.probe == "codex" and .ok == true and (.litellm == "rendered" or .litellm == "unchanged"))] | length' "$E/rows.jsonl")
  rend=$(n '[.[] | select(.ok == true and .litellm == "rendered")] | length' "$E/rows.jsonl")
  skip=$(n '[.[] | select(.ok == true and .litellm != "rendered" and .litellm != "unchanged")] | length' "$E/rows.jsonl")
  rest=$(n '[.[] | select(.ok != true and ((.reason // "") | test("could not be stopped|did not start again|is DOWN")))] | length' "$E/rows.jsonl")
  forn=$(n '[.[] | select(.ok != true and ((.reason // "") | test("not provably this lane|cannot prove is this lane")))] | length' "$E/rows.jsonl")
  logn=$(n '[.[] | select(.ok != true and ((.reason // "") | test("login-required")))] | length' "$E/rows.jsonl")
  oth=$(n '[.[] | select(.ok != true and ((.reason // "") | test("could not be stopped|did not start again|is DOWN|not provably this lane|cannot prove is this lane|login-required") | not))] | length' "$E/rows.jsonl")
  ym=$(stat -c %Y -- "$HOME/.ccrc/codex/$L/litellm.yaml" 2>/dev/null || echo 0)
  if [ "$rest" -gt 0 ] || [ "$forn" -gt 0 ]; then
    v refresh ROLLBACK "$rest restart-class and $forn foreign-tier row(s) for this lane in $runs timer run(s) since the gate opened"
  elif [ "$logn" -gt 0 ]; then
    v refresh STOP "$logn login-required row(s): this lane's token cannot be refreshed — ccrc codex login with the operator present, or roll the lane back"
  elif [ "$skip" -gt 0 ] || [ "$oth" -gt 0 ] || [ "$rows" -lt "$runs" ]; then
    v refresh STOP "$skip ok-but-not-rendered row(s), $oth other failed row(s), $((runs - rows)) run(s) with no row for this lane — none of them took the codex arm; read $E/rows.jsonl"
  elif [ "$rend" -gt 0 ] && [ "$ym" -lt "$T0" ]; then
    v refresh STOP "a row says rendered, but this lane's own litellm.yaml is older than the gate"
  elif [ "$took" -lt 1 ]; then
    v refresh WAIT "no timer run has taken the codex arm yet ($runs run(s) since the gate opened)"
  else
    v refresh PASS "$took of $runs timer run(s) took the codex arm; none failed or read skipped"
  fi
  
  # 2. SERVICE — ccrc-models.timer alive; a failed ccrc-models.service attributed.
  svc=$(systemctl --user is-failed ccrc-models.service 2>/dev/null); svc=${svc:-unknown}
  tmr=$(systemctl --user is-active ccrc-models.timer 2>/dev/null); tmr=${tmr:-unknown}
  last=$(tail -n 1 "$E/runs.jsonl")
  lo=$(printf '%s\n' "$last" | jq --arg l "$L" --arg x "$X" '[.refreshed[]? | select(.id != $l and .id != $x and .ok != true)] | length' 2>/dev/null); lo=${lo:-0}
  lx=$(printf '%s\n' "$last" | jq -r --arg x "$X" '[.refreshed[]? | select(.id == $x) | .ok] | if length == 0 then "none" else (.[0] | tostring) end' 2>/dev/null); lx=${lx:-none}
  ll=$(printf '%s\n' "$last" | jq -r --arg l "$L" '[.refreshed[]? | select(.id == $l) | .ok] | if length == 0 then "none" else (.[0] | tostring) end' 2>/dev/null); ll=${ll:-none}
  if [ "$tmr" != active ]; then
    v service STOP "ccrc-models.timer is $tmr, so no hourly refresh reaches this lane"
  elif [ "$svc" = failed ] && [ "$ll" = false ]; then
    v service STOP "ccrc-models.service failed, and its last run failed this lane's row (the refresh line says why)"
  elif [ "$svc" = failed ] && [ -n "$X" ] && [ "$lx" = false ] && [ "$lo" -eq 0 ]; then
    v service EXPECTED "ccrc-models.service failed on the still-external lane's row alone (Z4, accepted until that lane's flip)"
  elif [ "$svc" = failed ] && [ "$lo" -gt 0 ]; then
    v service NOTE "ccrc-models.service failed on $lo other lane row(s), not this lane's — report them to the operator"
  elif [ "$svc" = failed ]; then
    v service STOP "ccrc-models.service is failed and its last run names no failure this sample can attribute — read: journalctl --user -u ccrc-models.service -n 50"
  else
    v service PASS "ccrc-models.timer active; ccrc-models.service $svc"
  fi
  
  # 3. USAGE — one writer, every 15 minutes, never older than two intervals.
  fen=$(systemctl --user is-enabled "$F" 2>/dev/null); fen=${fen:-not-found}
  fac=$(systemctl --user is-active "$F" 2>/dev/null); fac=${fac:-inactive}
  cen=$(systemctl --user is-enabled "ccrc-codex-usage@$L.timer" 2>/dev/null); cen=${cen:-not-found}
  cac=$(systemctl --user is-active "ccrc-codex-usage@$L.timer" 2>/dev/null); cac=${cac:-inactive}
  srun=$(systemctl --user is-active "ccrc-codex-usage@$L.service" 2>/dev/null); srun=${srun:-inactive}
  journalctl --user -q -u "ccrc-codex-usage@$L.service" --since "@$T0" -o short-unix 2>/dev/null > "$E/usage-journal.txt"
  grep -F ': Finished ' "$E/usage-journal.txt" | awk '{ print int($1) }' > "$E/usage-finished.txt"
  nfin=$(wc -l < "$E/usage-finished.txt" | tr -d ' ')
  nfail=$(grep -cF 'Failed with result' "$E/usage-journal.txt")
  gap=$(awk -v p="$T0" -v now="$now" '{ g = $1 - p; if (g > m) m = g; p = $1 } END { g = now - p; if (g > m) m = g; print m + 0 }' "$E/usage-finished.txt")
  lastfin=$(tail -n 1 "$E/usage-finished.txt")
  ts=$(jq -r 'if type == "object" and (.ts | type) == "number" then (.ts | floor | tostring) else empty end' "$HOME/.cc-limits/$L.json" 2>/dev/null)
  if [ "$fen" = enabled ] || [ "$fac" = active ]; then
    v usage STOP "the other repository's usage timer for this lane reads $fen/$fac — a second writer; the operator disables it again"
  elif [ "$cen" != enabled ] || [ "$cac" != active ]; then
    v usage STOP "ccrc's usage timer for this lane reads $cen/$cac"
  elif ! [[ "$ts" =~ ^[0-9]+$ ]]; then
    v usage STOP "this lane's ~/.cc-limits row carries no numeric ts"
  elif [ $((now - ts)) -gt 1800 ] || [ "$gap" -gt 1800 ]; then
    v usage ROLLBACK "usage row $((now - ts))s old, longest gap between ccrc's publishes since the gate opened ${gap}s — more than two 15-minute intervals"
  elif [ "$srun" = activating ] || [ "$srun" = active ]; then
    v usage WAIT "a publish is running now; sample again in a minute"
  elif [ -n "$lastfin" ] && { [ $((lastfin - ts)) -lt -2 ] || [ $((lastfin - ts)) -gt 300 ]; }; then
    v usage STOP "the row's ts is not ccrc's last publish ($((lastfin - ts))s apart) — a second writer, or a run that wrote nothing"
  elif [ "$nfin" -lt 4 ]; then
    v usage WAIT "$nfin publish(es) since the gate opened; four make one hour's cadence"
  else
    v usage PASS "$nfin publishes since the gate opened, longest gap ${gap}s, row $((now - ts))s old, $nfail failed run(s), one writer"
  fi
  
  # 4. DOCTOR — no FAIL; no WARN that Task B1's baseline did not have; codex PASS
  #    naming this lane (or, between lanes in the lane-2-first order, its one
  #    expected WARN: the still-external lane's flat usage timer).
  ccrc doctor > "$E/doctor.txt" 2>&1
  grep -oE '^(PASS|WARN|FAIL|SKIP) [A-Za-z0-9_-]+:' "$E/doctor.txt" | sort -u > "$E/doctor-classes.txt"
  awk 'NF == 2 { print $2 " " $1 ":" }' "$B" | sort -u > "$E/baseline-classes.txt"   # Task B1 Step 6's class table: one "<check> <CLASS>" line per check
  fails=$(grep -c '^FAIL ' "$E/doctor.txt")
  cxfor=$(grep -E '^FAIL codex: ' "$E/doctor.txt" | grep -ciE 'foreign|not provably')
  neww=$(grep '^WARN ' "$E/doctor-classes.txt" | grep -v '^WARN codex:$' | grep -cvxF -f "$E/baseline-classes.txt")
  cxw=$(grep -c '^WARN codex: ' "$E/doctor.txt")
  cxflat=$(grep -c "^WARN codex: another repository's ccgpt-usage.timer is enabled on this box" "$E/doctor.txt")
  cxp=$(grep '^PASS codex: ' "$E/doctor.txt" | grep -cE "(^|[^A-Za-z0-9_-])$L([^A-Za-z0-9_-]|$)")   # an exact token, never a substring (ruling N4)
  flaten=$(systemctl --user is-enabled ccgpt-usage.timer 2>/dev/null)
  if [ "$cxfor" -gt 0 ]; then
    v doctor ROLLBACK "codex FAILs on a foreign tier or listener — read $E/doctor.txt"
  elif [ "$fails" -gt 0 ]; then
    v doctor STOP "$fails FAIL line(s) — read $E/doctor.txt"
  elif [ "$neww" -gt 0 ]; then
    v doctor STOP "$neww check(s) WARN that did not WARN in Task B1's baseline — read $E/doctor.txt"
  elif [ "$cxp" -eq 1 ] && [ "$cxw" -eq 0 ]; then
    v doctor PASS "PASS codex names this lane; no FAIL, and no WARN outside the baseline"
  elif [ -n "$X" ] && [ "$flaten" = enabled ] && [ "$cxw" -eq 1 ] && [ "$cxflat" -eq 1 ]; then
    v doctor EXPECTED "codex's one WARN is the still-external lane's flat usage timer, which retires at that lane's flip"
  else
    v doctor STOP "codex answered $cxw WARN line(s) and $cxp PASS line(s) naming this lane — read $E/doctor.txt"
  fi
  
  # 5. TIERS — both running and proven this lane's; no gateway 401 since the gate opened.
  st=$(ccrc codex status "$L" --json 2>/dev/null)
  tl=$(printf '%s' "$st" | jq -r '.tiers.litellm.state // "unknown"' 2>/dev/null); tl=${tl:-unknown}
  tsh=$(printf '%s' "$st" | jq -r '.tiers.shim.state // "unknown"' 2>/dev/null); tsh=${tsh:-unknown}
  n401=0; trunc=0
  for t in litellm shim; do
    lf="$HOME/.ccrc/logs/codex/$L/$t.log"; o=$(cat "$G/offset-$t")
    sz=$(stat -c %s -- "$lf" 2>/dev/null || echo 0)
    if [ "$sz" -lt "$o" ]; then trunc=1; continue; fi
    c=$(tail -c +"$((o + 1))" -- "$lf" 2>/dev/null | grep -cE '(^|[^0-9])401([^0-9]|$)|AuthenticationError|Unauthorized')
    n401=$((n401 + ${c:-0}))
  done
  if [ "$tl" = foreign ] || [ "$tsh" = foreign ]; then
    v tiers ROLLBACK "a tier of this lane reads foreign (read: ccrc codex status <lane-id>)"
  elif [ "$n401" -gt 0 ]; then
    v tiers ROLLBACK "$n401 gateway-401 line(s) in this lane's tier logs since the gate opened (counted, never printed)"
  elif [ "$trunc" -ne 0 ]; then
    v tiers STOP "a tier log is shorter than at the gate's start, so its 401 count is unmeasured"
  elif [ "$tl" = running ] && [ "$tsh" = running ]; then
    v tiers PASS "both tiers running and proven this lane's; 0 gateway 401s since the gate opened"
  elif [ "$tl" = starting ] || [ "$tsh" = starting ]; then
    v tiers WAIT "a tier is still starting"
  else
    v tiers STOP "litellm $tl, shim $tsh"
  fi
  
  # 6. SESSIONS — a real turn completes on the lane; no launcher refusal, no failed unit.
  ccd ls 2>/dev/null | awk -v w="$L" 'NR > 1 && $2 == w { print $1 }' > "$E/sessions.txt"
  ns=$(wc -l < "$E/sessions.txt" | tr -d ' '); sfail=0; refus=0; dn=0; fl=0
  while IFS= read -r sid; do
    [ -n "$sid" ] || continue
    [ "$(systemctl --user is-failed "claude-session@$sid.service" 2>/dev/null)" = failed ] && sfail=$((sfail + 1))
    c=$(journalctl --user -q -u "claude-session@$sid.service" --since "@$T0" -o cat 2>/dev/null \
          | grep -cE 'ccrc-codex: [a-z-]+: |start-limit-hit|Start request repeated too quickly')
    refus=$((refus + ${c:-0}))
    read -r ms ma < <(jq -r '[(.state // "absent"), ((.turnAt // 0) | floor | tostring)] | join(" ")' \
                        "$HOME/.cc-sessions/$sid.turn.json" 2>/dev/null || echo "absent 0")
    if [ "${ma:-0}" -ge "$T0ms" ]; then
      case "$ms" in "done") dn=$((dn + 1)) ;; "failed") fl=$((fl + 1)) ;; esac
    fi
  done < "$E/sessions.txt"
  if [ "$refus" -gt 0 ] || [ "$sfail" -gt 0 ]; then
    v sessions ROLLBACK "$refus launcher-refusal or start-limit line(s), and $sfail failed claude-session unit(s), on this lane since the gate opened"
  elif [ "$fl" -gt 0 ]; then
    v sessions STOP "$fl session(s) on this lane end on a failed turn since the gate opened — a failed first turn after un-park is swapped back out and the lane rolls back (ruling B-2)"
  elif [ "$ns" -eq 0 ]; then
    v sessions WAIT "no supervised session is on this lane"
  elif [ "$dn" -lt 1 ]; then
    v sessions WAIT "$ns session(s) on this lane; none shows a completed turn since the gate opened"
  else
    v sessions PASS "$ns session(s) on this lane; $dn show a completed turn since the gate opened"
  fi
  
  # 7. UPDATE — one auto-update lands while the lane is codex, and its install
  #    spine re-measured the runtime, measured the tiers and kept the usage instance.
  v0=$(cat "$G/version"); vn=$(ccrc version 2>/dev/null | sed -n 's/^version //p' | head -n 1)
  ph=$(jq -r '.phase // "absent"' "$HOME/.ccrc/update.json" 2>/dev/null); ph=${ph:-absent}
  ua=$(jq -r '(.updatedAt // 0) | floor | tostring' "$HOME/.ccrc/update.json" 2>/dev/null); ua=${ua:-0}
  au=$(ccrc channel 2>/dev/null | sed -n 's/^channel: .* auto=\([a-z]*\)$/\1/p' | head -n 1)
  journalctl --user -q --since "@$T0" -o cat 2>/dev/null | grep -E '^install: codex(-usage| runtime| tiers):' > "$E/update-codex.txt"
  ubad=$(grep -cE 'NOT (restarted|measured|BUILT|CONVERGED|ENABLED)|restart FAILED|could not disable' "$E/update-codex.txt")
  uen=$(sed -n 's/^install: codex-usage: enabled for \([^;]*\);.*/\1/p' "$E/update-codex.txt" | tr ' ' '\n' | grep -cxF -- "$L")
  urt=$(grep -cE '^install: codex runtime: .*(already current|built, probed and current)' "$E/update-codex.txt")
  utr=$(grep -cE '^install: codex tiers: [0-9]+ codex lane\(s\) — ' "$E/update-codex.txt")
  if [ "$au" = off ]; then
    v update STOP "auto-update reads off on this box — R-O6 pauses it for a lane's window only, never across the soak"
  elif [ "$ua" -ge "$T0" ] && { [ "$ph" = reverted ] || [ "$ph" = failed ]; }; then
    v update STOP "an update since the gate opened ended $ph — read ~/.ccrc/update.json and ccrc update --check"
  elif [ "$vn" = "$v0" ] || [ "$ph" != "done" ] || [ "$ua" -lt "$T0" ]; then
    v update WAIT "no update has landed on this box since the gate opened (phase $ph)"
  elif [ "$ubad" -gt 0 ]; then
    v update STOP "the landing's codex install lines carry $ubad NOT/FAILED line(s) — read $E/update-codex.txt"
  elif [ "$urt" -lt 1 ] || [ "$utr" -lt 1 ] || [ "$uen" -lt 1 ]; then
    v update STOP "an update landed, but its codex lines are not all in the user journal (runtime $urt, tiers $utr, usage-enabled $uen)"
  else
    v update PASS "an update landed since the gate opened; the runtime was re-measured, the tiers measured, and this lane's usage instance kept"
  fi
  
  # 8. Z4 MONITOR — only between lanes in the lane-2-first order: the still-external
  #    lane whose hourly re-render Z4 refuses while its foreign proxy runs.
  if [ -n "$X" ]; then
    jq -c --arg id "$X" '.refreshed[]? | select(.id == $id)' "$E/runs.jsonl" > "$E/x-rows.jsonl" 2>/dev/null
    xr=$(wc -l < "$E/x-rows.jsonl" | tr -d ' ')
    xz=$(n '[.[] | select(.ok != true and ((.reason // "") | test("ccrc will not stop it")))] | length' "$E/x-rows.jsonl")
    xo=$(n '[.[] | select(.ok != true and ((.reason // "") | test("ccrc will not stop it") | not))] | length' "$E/x-rows.jsonl")
    xc=$(jq -cS '.models' "$HOME/.ccrc/models/$X.json" 2>/dev/null | sha256sum | cut -c1-16)
    xm=$(stat -c %Y -- "$HOME/.handoff/litellm-config.yaml" 2>/dev/null || echo 0)
    xp=$(pgrep -fc "litellm .*$HOME/.handoff/litellm-config.yaml" 2>/dev/null); xp=${xp:-0}
    cc=no; [ "$xc" = "$(cat "$G/x-catalogue")" ] || cc=yes
    rw=no; [ "$xm" = "$(cat "$G/x-render-mtime")" ] || rw=yes
    if [ "$xo" -gt 0 ]; then
      v z4 NOTE "$xo still-external-lane row(s) failed for a reason other than Z4 — report to the operator; not this lane's rollback"
    else
      v z4 EXPECTED "$xz of $xr timer run(s) refused the still-external lane's re-render (Z4); its catalogue changed since the gate opened: $cc; box-global render rewritten: $rw; foreign proxy processes on that config: $xp"
    fi
  fi
  
  if [ "$RB" -ne 0 ]; then echo "B4 gate: ROLLBACK — a stop-or-rollback criterion fired; see $E/verdicts.txt"; exit 3; fi
  if [ "$ST" -ne 0 ]; then echo "B4 gate: STOP — a criterion needs the operator's reading; see $E/verdicts.txt"; exit 2; fi
  if [ "$WT" -ne 0 ] || [ "$el" -lt 86400 ]; then
    echo "B4 gate: OPEN — $((el / 3600)) h of the 24 h minimum elapsed; every criterion not PASS reads WAIT"; exit 1
  fi
  echo "B4 gate: PASSED — $((el / 3600)) h; every criterion PASS or EXPECTED"; exit 0
  EOF
  chmod 0700 "$PB/b4-sample.sh" && bash -n "$PB/b4-sample.sh" && echo "b4-sample.sh: written, syntax ok"
  ```

  Expected: `b4-sample.sh: written, syntax ok`. Measured while drafting: `bash -n` and `shellcheck -S warning` clean, and a fixture run (a `mkTmp`-style HOME, every box tool a stand-in on `PATH`) answered `B4 gate: PASSED` on a healthy fixture and `B4 gate: ROLLBACK` (exit 3) on one planted 401 line, with criterion 1 reading STOP on a planted `ok:true, litellm:"skipped"` row and criterion 2 reading EXPECTED on a failed service whose only failing row was a Z4 refusal.
  **Stop:** the file already exists with other bytes (compare by `cmp`, never by printing), or `bash -n` fails.
  **Rollback:** `rm -f -- "$PB/b4-sample.sh"`; it is this plan's own scratch file.
  **Authorisation:** read-only (it writes only this plan's box-local scratch).

- [ ] **Step 2: Open the gate for `<lane-id>` (read-only).**

  Right after Task B3's last step for this lane: every parked session is back on the lane, and the window's auto-update pause is lifted.

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  G="$PB/b4-<lane-id>"; ( umask 077; mkdir -p -- "$G" ) || exit 1
  [ ! -e "$G/start" ] || { echo "b4: this lane's gate is already open; never reopen it over its own start" >&2; exit 1; }
  ccrc channel | head -n 1                                   # → channel: state=ok … auto=<prior-auto>  (never auto=off)
  ccd ls | awk -v w=<lane-id> 'NR > 1 && $2 == w' | wc -l     # → the session count Task B3 parked and un-parked
  journalctl --user -q -u ccrc-models.service -n 20 -o cat | grep -c '^{"ok":'   # → 1 or more: the journal holds refresh rows
  date -u +%s > "$G/start"
  ccrc version | sed -n 's/^version //p' | head -n 1 > "$G/version"
  for t in litellm shim; do
    { stat -c %s -- "$HOME/.ccrc/logs/codex/<lane-id>/$t.log" 2>/dev/null || echo 0; } > "$G/offset-$t"
  done
  wc -c < "$G/version"                                       # → more than 1: the box carries a version stamp
  ```

  Between lanes in the lane-2-first order only, also record the Z4 monitor's baseline for the still-external lane:

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  G="$PB/b4-<lane-id>"
  jq -cS '.models' "$HOME/.ccrc/models/<still-external-lane-id>.json" | sha256sum | cut -c1-16 > "$G/x-catalogue"
  stat -c %Y -- "$HOME/.handoff/litellm-config.yaml" > "$G/x-render-mtime"
  pgrep -fc "litellm .*$HOME/.handoff/litellm-config.yaml"    # → 1: the still-external lane's foreign proxy, the Z4-armed shape
  ```

  **Stop:** `auto=off` (Task B3's resume did not land, or the ≤60 s projection lag has not elapsed: re-read once after a minute, then stop for the operator); a session count that differs from Task B3's record; no refresh row in the journal (the user journal is not readable here, so the gate cannot measure; report it); an empty version file. In the Z4 block, a `pgrep` count other than 1 is reported to the operator before the gate opens, because the Z4 consequence it monitors needs that proxy.
  **Rollback:** none needed; `rm -rf -- "$PB/b4-<lane-id>"` undoes an aborted opening, and only before the first sample.
  **Authorisation:** read-only.

- [ ] **Step 3: Take samples until the gate passes (read-only).**

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  "$PB/b4-sample.sh" <lane-id> "$PB/b4-<lane-id>" <foreign-usage-timer> <doctor-baseline>; echo "rc=$?"
  ```

  Between lanes in the lane-2-first order, append `<still-external-lane-id>` as the fifth argument. Run it in the foreground with a timeout of at least 600000 ms (it runs `ccrc doctor`).

  When: once at once (the opening sample); once within an hour after the first `ccrc-models.timer` fire after the gate opened (`systemctl --user list-timers --no-legend ccrc-models.timer` names it); then at least every 8 hours; within an hour after any update lands on the box; and once more at or after the 24-hour mark. Criteria 1, 3, 6 and 7 read the journal back to the gate's opening on every sample, so a gap between samples loses no evidence.

  **A handed-over first-turn watch (Task B3 Step 18).** For each `<window-dir>/unpark-<session-id>.epoch` Task B3 handed over, run B3 Step 18's first-turn read on every sample until it prints `first turn: done err=null`. `first turn: failed` is B3 Step 18's stop: that session is swapped back out at its next idle point, and the lane rolls back (Step 4).

  Expected, the opening sample: eight or seven `B4 <criterion> <verdict> <why>` lines (eight with the fifth argument), most reading `WAIT` (no timer run yet, fewer than four publishes, no landing yet), then `B4 gate: OPEN — 0 h of the 24 h minimum elapsed; every criterion not PASS reads WAIT` and `rc=1`. Expected, the passing sample:

  ```
  B4 refresh   PASS     <n> of <m> timer run(s) took the codex arm; none failed or read skipped
  B4 service   PASS     ccrc-models.timer active; ccrc-models.service inactive
  B4 usage     PASS     <n> publishes since the gate opened, longest gap <s>s, row <s>s old, 0 failed run(s), one writer
  B4 doctor    PASS     PASS codex names this lane; no FAIL, and no WARN outside the baseline
  B4 tiers     PASS     both tiers running and proven this lane's; 0 gateway 401s since the gate opened
  B4 sessions  PASS     <n> session(s) on this lane; <n> show a completed turn since the gate opened
  B4 update    PASS     an update landed since the gate opened; the runtime was re-measured, the tiers measured, and this lane's usage instance kept
  B4 gate: PASSED — <h> h; every criterion PASS or EXPECTED
  rc=0
  ```

  Between lanes in the lane-2-first order, `service` may read `EXPECTED … (Z4, accepted until that lane's flip)`, `doctor` may read `EXPECTED codex's one WARN is the still-external lane's flat usage timer …`, and an eighth line `B4 z4 EXPECTED <k> of <m> timer run(s) refused the still-external lane's re-render (Z4); its catalogue changed since the gate opened: <yes|no>; box-global render rewritten: <yes|no>; foreign proxy processes on that config: 1` appears on every sample. Record `<k>` and the two yes/no words from each sample in the verification record: a `yes` for the catalogue with a `no` for the render is lane 1 serving a model list older than its catalogue, Z4's bounded degradation, and its only remedy is lane 1's flip.
  **Stop:** `rc=2` (Step 4). **Rollback:** `rc=3` (Step 4). **Authorisation:** read-only.

- [ ] **Step 4: Act on a STOP or a ROLLBACK verdict, with the operator present.**

  Read the sample's `verdicts.txt` and the evidence file each STOP or ROLLBACK line names. Never print a tier log, an `auth.json`, a unit's `Environment=` or the lane's runtime env; every count the script gives is already the answer.

  - **`rc=2`, STOP.** The gate is paused, not failed. The lane keeps serving. The operator reads the named evidence and rules one of three things: a named repair that is the operator's own act (for example re-disabling a foreign usage timer the other repository re-enabled, or `ccrc codex login <lane-id>` in the operator's browser on a `login-required` row, which falls under the lane's per-lane authorisation), after which sampling resumes on the same gate; a rollback (below); or, for a STOP whose cause is not this lane's (criterion 2's NOTE, criterion 8's NOTE), carry on and report it. The controller never repairs silently and never reaches for `ccrc doctor --fix`, which acts on FAIL only and is not a soak tool.
  - **`rc=3`, ROLLBACK.** A stop-or-rollback criterion of the carry-forward fired: a gateway 401, a foreign tier or listener, a usage row older than two intervals, a launcher refusal or failed unit in a `claude-session@<session-id>` journal, or a restart-class refresh row for this lane. The operator rules rollback or a named repair. A rollback is **Task B3's rollback table, run from RB1, top to bottom, in its order, with every step the completed window reached counted as reached** (ruling B-8; so RB6 runs only for a lane that ran Step 11), under the lane's own per-lane authorisation reopened as a window with auto-update paused again (R-O6; [Authorisation shapes](#authorisation-shapes)). So the account goes off for placement (RB3) before ccrc's tiers stop (RB4); RB5 runs whenever `ccrc-codex-usage@<lane-id>.timer` measures enabled, under either R-C10 arm, and waits for its service to go inactive; RB11's re-enable of `<foreign-usage-timer>` comes only after that wait; RB12 restarts the other repository's tiers with one headless turn through the restored entry file, the id set, because that launcher has no tier-only start verb (ruling R11); and RB13 switches the account back on.

    After a rollback the gate directory is kept as evidence, and the lane is re-attempted only through a fresh Task B3 run. Rolling back the lane flipped first in the lane-2-first order leaves no codex row on the roster, so Z4 is disarmed and the external arm's bare stop returns to today's shape (ruling Z1); rolling back the lane flipped second never touches the first lane.
  **Authorisation:** a STOP's reading is read-only; any repair or rollback is the lane's per-lane authorisation, with the operator present.

- [ ] **Step 5: While no update has landed (read-only).**

  Criterion 7 waits for the box's own updater; nothing in this plan triggers one. If 72 hours pass after the gate opened with `B4 update WAIT`, the controller tells the operator and keeps sampling. An update reaches the box when a release it follows is published, and every merge to `main` publishes a dev prerelease (`.github/workflows/release-main.yml`), so an ordinary merge of any reviewed PR is the operator's lever, and only the operator's. **Never `ccrc update`, `ccrc rollout`, a PWA apply tap or a hand install to satisfy the gate** (operator ruling 2026-09-30): the criterion exists to watch the updater, and a hand move would measure the hand.
  **Stop:** `ccrc channel` reads `auto=off` (criterion 7's STOP), or `ccrc update --check`'s first line reads `projection=` anything other than `ok` for more than an hour: report it, because the box's updater is not reaching it.
  **Rollback:** none. **Authorisation:** read-only.

- [ ] **Step 6: Close the gate (read-only).**

  The gate closes on the first sample that answers `rc=0`. Record in the verification record (Task B6 Step 5): the gate directory, its opening and passing UTC, the codex-arm run count, the landed version tag's shape (a newer dev or stable tag, never its number in tracked text), the usage cadence line, and, between lanes in the lane-2-first order, every sample's `z4` line. The gate directory stays until Task B6 Step 7's clock has run out: Task B6 and the daily soak samples read it.
  **Stop:** a later sample of the same gate reading `rc=2` or `rc=3` before Task B5 starts reopens Step 4: a passed gate is a measurement, not a licence.
  **Rollback:** none. **Authorisation:** read-only.

### Task B5: the second lane

**Files:** none tracked. Box-local: `$PB/b5-census/` (0700), the second lane's own Task B3 evidence, its B4 gate `$PB/b4-<second-lane-id>/`.

**Interfaces:**
- Consumes: the first lane's B4 gate passed (Task B4 Step 6); R-O1's ruled order; Task B1's census block and values; Task B3 as the one per-lane procedure; `b4-sample.sh`.
- Produces: the second lane flipped and verified by the same procedure; the measured end of the external path on this box's roster (Step 6), which Plan 4's ccrc PR re-measures as its precondition; the second lane's B4 gate.

**Why:** ruling B-1 writes one per-lane procedure (Task B3), parameterised by registry, session count and flip position. This task runs it for the other lane and lists exactly what differs the second time, because the second flip is not a copy of the first: the box has a codex lane already, its auto-update has landed over that lane, and, in the lane-2-first order, the Z4 state ends here.

- [ ] **Step 1: The first lane's gate still passes (read-only).**

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  "$PB/b4-sample.sh" <first-lane-id> "$PB/b4-<first-lane-id>" <first-lane-foreign-usage-timer> <doctor-baseline> [<still-external-lane-id>]; echo "rc=$?"
  ```

  The fifth argument is given only in the lane-2-first order, where it is `<second-lane-id>` (lane 1, still external).
  Expected: `B4 gate: PASSED …` and `rc=0`.
  **Stop:** any other exit: Task B4 Step 4 first. **Rollback:** none. **Authorisation:** read-only.

- [ ] **Step 2: Re-run Task B1's census and read its delta (read-only).**

  Run Task B1's census block unchanged into `$PB/b5-census`, then this block, which measures the facts the second window depends on:

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  A="$HOME/.ccrc/accounts.json"
  jq -r --arg f <first-lane-id> --arg s <second-lane-id> '.accounts[] | select(.id == $f or .id == $s)
    | [(if .id == $f then "first" else "second" end), .exec.kind,
       (((.exec.proxyPort != null) and (.exec.litellmPort != null)) | tostring),
       ((.exec.authDir != null) | tostring)] | join(" ")' "$A" | sort
  # → first codex true true
  # → second external false false
  ccgpt-runtime check; echo "rc=$?"                                    # → ccgpt-runtime: current <gen> litellm=<v>, rc=0
  ccrc codex status <first-lane-id> --json | jq -r '[.tiers.litellm.state, .tiers.shim.state] | join(" ")'   # → running running
  systemctl --user is-enabled <first-lane-foreign-usage-timer> ccrc-codex-usage@<first-lane-id>.timer      # → disabled, then enabled
  stat -c %F -- "$HOME/.local/bin/<second-lane-id>"                    # → symbolic link (lane 1) | regular file (lane 2)
  grep -c '^# ccrc:generated ' "$HOME/.local/bin/<second-lane-id>"     # → 0: still the other repository's, unmarked
  systemctl --user list-units --all --no-legend --plain 'ccgpt-<second-lane-id>-*' | awk '{ print $2, $3, $4 }'   # → loaded active running, twice
  systemctl --user is-enabled <second-lane-foreign-usage-timer>        # → enabled
  for x in json classes.json classes.tsv effort.json; do [ -e "$HOME/.ccrc/models/<second-lane-id>.$x" ] && echo "$x"; done
  # → json, classes.json, classes.tsv, effort.json (lane 1) | effort.json (lane 2)
  ccd ls | awk -v w=<second-lane-id> 'NR > 1 && $2 == w' | wc -l      # → this window's session count to park
  pgrep -fc "litellm .*$HOME/.handoff/litellm-config.yaml"             # → 1 (second = lane 1, its foreign proxy) | 0 (second = lane 2)
  df -Pk "$HOME" | awk 'NR == 2 { print int($4 / 1048576) " GiB free" }'   # → 2 or more
  systemctl --user list-timers --no-legend ccrc-models.timer           # → its next fire falls outside the planned window
  [ "$(sha256sum -- "$HOME/.local/bin/ccgpt" | cut -d' ' -f1)" = "$CCGPT_SHA256" ] && echo 'ccgpt: untouched' || echo 'ccgpt: CHANGED'   # → ccgpt: untouched, against Task B1's CCGPT_SHA256 (ruling B-3)
  ```

  Expected delta against Task B1's census, and nothing else:

  | Fact | At Task B1 | Now |
  |---|---|---|
  | first lane's roster row | `external`, no ports, no `authDir` | `codex`, its existing port pair, its existing OAuth directory |
  | first lane's entry file | the other repository's (symlink or small file), unmarked | ccrc's marker-verified wrapper; the old entry at `<first-lane-id>.pre-ccrc-<UTC>` |
  | first lane's tier units | `ccgpt-<first-lane-id>-{litellm,shim}.service`, the other repository's | the same names, ccrc's, `running` per `ccrc codex status` |
  | first lane's foreign usage timer | enabled | disabled |
  | `ccrc-codex-usage@<first-lane-id>.timer` | absent | enabled and active |
  | `~/.ccrc/runtime/codex/current`, `~/.ccrc/codex/<first-lane-id>/` | absent | present; `ccgpt-runtime check` current |
  | the box's version | Task B1's | possibly newer: Task B4's landing |
  | the second lane: row, entry file shape and marker, tiers, foreign usage timer, models files | as recorded | unchanged |
  | sessions on the second lane | Task B1's count | re-counted here. A changed count is re-recorded by Task B1 Step 3's re-record of this lane alone, never by re-running B1 Step 2, and the census re-run; this window parks every one |

  Also re-read, per session on the second lane, its project's pool tag and its `<park-target-wrapper>`'s pool, as Task B3's census does (ruling B-2).
  A census `MISMATCH lane <n>: … session row(s) now, … recorded` is cured as the table's last row says, then the census is re-run into `$PB/b5-census`; Task B1 Step 2 is never re-run here, because the first lane is flipped. Any other census MISMATCH stops.
  **Stop:** any delta the table does not name, a pool mismatch or undecidable pool for a session to park, under 2 GiB free, a `ccgpt-runtime check` that is not current (the runtime build was its own pre-lane authorisation, and a second build is not this window's: report it), or `ccgpt`'s hash changed. Nothing is done.
  **Rollback:** none. **Authorisation:** read-only.

- [ ] **Step 3: What differs in Task B3 for the second lane (read-only; this is the window's brief).**

  Run Task B3 unchanged, with `<lane-id>` = `<second-lane-id>`, and with these differences, which each B3 step reads off this table before it acts:

  | Task B3's item | second = lane 1 (lane-2-first order) | second = lane 2 (lane-1-first order) |
  |---|---|---|
  | class registry | it has one: **no `init codex`**; the backups hold all four `~/.ccrc/models/<lane-id>.{json,classes.json,classes.tsv,effort.json}` | none: `ccrc models <lane-id> init codex` **after** the roster flip (Z3 refuses it before); the backups hold the effort file only |
  | sessions to park | six (Step 2's count), each at its own measured idle point, coordinators between waves; spread over more than one `<park-target-wrapper>` where the operator judges one lacks headroom; the window opens only once every one is parked | one |
  | entry file | a symlink to `ccgpt`: `mv -n -T -- "$HOME/.local/bin/<lane-id>" "$HOME/.local/bin/<lane-id>.pre-ccrc-<UTC>"` (Task B3 Step 8 unchanged) moves the link, never its target | a small regular file: the same `mv -n -T` |
  | the other repository's stop | Task B3 Step 6 unchanged: `CCGPT_ACCOUNT_ID='<lane-id>' "$HOME/.local/bin/<lane-id>" stop`, through the entry file and with the id spelled in full even though this id is that launcher's default; before it, list `ccgpt-<lane-id>-*` units (two, the other repository's) and confirm lane 2's tiers are ccrc's under their own, different names | Task B3 Step 6 unchanged: `CCGPT_ACCOUNT_ID='<lane-id>' "$HOME/.local/bin/<lane-id>" stop`, before that file moves (only it exports both ports; `ccgpt` with the id alone refuses); lane 1's units are ccrc's since its flip and must not be named |
  | foreign usage timer | the flat `ccgpt-usage.timer` | the template instance `ccgpt-usage@<lane-id>.timer`, never the bare template `ccgpt-usage@.timer` |
  | Z4 | ends at this flip: Step 5 measures it | absent: lane 2 has no registry, so no refresh reaches it before its flip |
  | ports and `authDir` | lane 1's existing pair (R-O3 keeps it) and its existing OAuth directory | lane 2's pair (its entry file's two exports, Task B1's values) and its existing OAuth directory |
  | runtime | built; Step 2 proved it current; no build in this window | the same |
  | backups | taken fresh in this window: the roster backup is the roster **with the first lane already codex**, never the first window's backup, which would revert the first lane too | the same |
  | rollback | Task B3's order; never touches the first lane (lane 2, codex); afterwards Z4 is armed again and the first lane's gate samples take the fifth argument once more | Task B3's order plus `ccrc models <lane-id> rm` before the roster backup returns; never touches lane 1 |

  **Stop:** none of its own; each B3 step carries its own. **Rollback:** none. **Authorisation:** read-only.

- [ ] **Step 4: Run Task B3 for the second lane.**

  Every live act of this window sits under **the second lane's per-lane authorisation**, its own named window, given by the operator for this lane: the pause and resume of auto-update (record `<prior-auto>` and `<prior-channel>` again, never reuse the first window's record), `ccrc account disable` and `enable`, the parks and un-parks, the lane-explicit stop and the foreign usage-timer disable, the entry-file move, the roster edit, `init codex` (lane 2 only) and the refresh, `ccrc codex login` if prompted, starting the tiers and enabling `ccrc-codex-usage@<lane-id>.timer`, and the headless test turn.
  Expected: Task B3's own verification, every bullet, for `<second-lane-id>`.
  **Stop and rollback:** Task B3's, with Step 3's differences.
  **Authorisation:** the second lane's per-lane authorisation.

- [ ] **Step 5: Z4 ends — second = lane 1 only (read-only).**

  After the first `ccrc-models.timer` run that follows lane 1's flip (`<flip-epoch>`, `<window-dir>/flip.epoch` from Task B3 Step 9(c), also `L<n>_FLIP_EPOCH`):

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  journalctl --user -q -u ccrc-models.service --since "@<flip-epoch>" -o cat | grep '^{"ok":' | tail -n 1 \
    | jq -c --arg id <second-lane-id> '.refreshed[] | select(.id == $id) | {probe, ok, litellm}'
  # → {"probe":"codex","ok":true,"litellm":"rendered"} (or "unchanged" if Task B3's hand refresh already rendered it)
  systemctl --user is-failed ccrc-models.service                     # → inactive
  pgrep -fc "litellm .*$HOME/.handoff/litellm-config.yaml"           # → 0
  ```

  From here the first lane's gate samples drop the fifth argument: no external lane with a registry remains, so nothing is refused.
  **Stop:** the row is absent, failed or `skipped` (Task B4's reading rule), or the service still reads failed: that is the second lane's own refresh failing, Task B4 Step 4's ROLLBACK path for it.
  **Rollback:** none of its own. **Authorisation:** read-only.

- [ ] **Step 6: The external path is retired from this box's roster (read-only).**

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  A="$HOME/.ccrc/accounts.json"
  jq '[.accounts[] | select(.exec.kind == "external" and .telemetry == "codex")] | length' "$A"   # → 0
  jq '[.accounts[] | select(.exec.kind == "codex")] | length' "$A"                                # → 2
  jq -r '.accounts[] | select(.exec.kind == "external") | .id' "$A" \
    | while IFS= read -r id; do [ -e "$HOME/.ccrc/models/$id.classes.json" ] && echo x; done | wc -l   # → 0
  systemctl --user list-units --all --no-legend --plain 'ccgpt-*' | wc -l                           # → 4: two tiers per codex lane, no other
  for id in <first-lane-id> <second-lane-id>; do
    ccrc codex status "$id" --json | jq -r '[.tiers.litellm.state, .tiers.shim.state] | join(" ")'
  done                                                                                               # → running running, twice
  systemctl --user is-enabled <first-lane-foreign-usage-timer> <second-lane-foreign-usage-timer>     # → disabled, disabled
  pgrep -fc "litellm .*$HOME/.handoff/litellm-config.yaml"                                          # → 0
  stat -c %Y -- "$HOME/.handoff/litellm-config.yaml" > "$PB/b5-census/box-global-render-mtime"
  ccrc doctor 2>&1 | grep -E '^(PASS|WARN|FAIL) codex: '                                            # → one PASS codex line naming both lanes
  ```

  After the next `ccrc-models.timer` fire, re-read `stat -c %Y -- "$HOME/.handoff/litellm-config.yaml"` and compare it with the recorded value: equal, because no lane's render reaches the box-global file any more. The other repository's `~/.local/bin/ccgpt` is still in place and unmodified (Step 2's hash): Plan 4 removes it, never Plan 3b (ruling B-3).
  This is the precondition Plan 4's ccrc PR re-measures before it deletes the external arm: no `external` row has a codex registry.
  **Stop:** any count other than the expected, a codex WARN or FAIL, or a box-global render written after the second flip. Report it; nothing is rolled back for a read.
  **Rollback:** none. **Authorisation:** read-only.

- [ ] **Step 7: The soak gate after the second lane (read-only).**

  Run Task B4 Steps 2 to 6 for `<second-lane-id>` with its own gate directory and no fifth argument, and, at that gate's passing sample, one sample of the first lane's gate (no fifth argument, since Step 5 or the lane-1-first order left nothing to monitor).
  Expected: both answer `B4 gate: PASSED` and `rc=0` within the same hour.
  **Stop and rollback:** Task B4 Step 4, for whichever lane fired. **Authorisation:** read-only.

### Task B6: close-out

**Files:** box-local: `$PB/verification-record.md` (0600), `$PB/plan4-soak-clock.sh` and `$PB/plan4-soak/` (0700), `$PB/ledger-allocation.json`, the R-O7 snapshot directory `$HOME/.ccgpt-launcher-r-o7/` (0700, files 0600), and, on the server box under its own authorisation only, `~/.ccrc/accounts.json` plus its `accounts.json.pre-3b-<UTC>` backup. Tracked, through one ordinary docs PR: this plan file's `### Part B execution ledger` subsection, appended at the end of `## Deviations found`, and a shape-only `## Part B execution record` section appended at the end of the plan.

**Interfaces:**
- Consumes: both lanes' B4 gates passed (Task B5 Step 7); Task B5 Step 6's retirement read; each window's recorded `<prior-auto>`/`<prior-channel>` and its `<settings-backup>`; Task B1's R-O4 measurement; `$PB/execution-slugs.tsv`, one `<slug><TAB><one-sentence definition>` line per departure any Part B step recorded.
- Produces: the verification record; the minted execution-ledger numbers; `plan4-soak-clock.sh <clock-dir> <lane-id>...` (exit `0` R-O9 met, `1` running, `2` broken or unmeasured) and its clock directory, which Plan 4's first task reads; the R-O7 snapshot, which Plan 4's live-box cleanup verifies before any `rm`.

**Why:** the carry-forward's step 6, plus R-O5's optional mirror under its own authorisation (critic #14), R-O7's snapshot and R-O9's clock. The close-out leaves the box in a state Plan 4 can start from by measurement alone, and leaves the public tree with the departures defined and the execution described by shape.

- [ ] **Step 1: Both lanes are verified (read-only).**

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  "$PB/b4-sample.sh" <first-lane-id> "$PB/b4-<first-lane-id>" <first-lane-foreign-usage-timer> <doctor-baseline> | tail -n 1
  "$PB/b4-sample.sh" <second-lane-id> "$PB/b4-<second-lane-id>" <second-lane-foreign-usage-timer> <doctor-baseline> | tail -n 1
  ```

  Expected: `B4 gate: PASSED …` twice.
  **Stop:** anything else: Task B4 Step 4. **Rollback:** none. **Authorisation:** read-only.

- [ ] **Step 2: Apply R-O4's settings-mirror ruling (read-only, per lane).**

  R-O4 (recommendation: freeze each codex home's `settings.json` at cutover; `plugins` stays a link; hooks and the statusline stay converged by `install-session-hooks.sh`; `alwaysThinkingEnabled` is left as written). Applying it is measuring that nothing has written the frozen part since the cutover: no ccrc writer owns those keys, and ccrc's own launcher, unlike the one it replaced, mirrors nothing.

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  D="$HOME/$(jq -r --arg id <lane-id> '.accounts[] | select(.id == $id) | .configDirSuffix' "$HOME/.ccrc/accounts.json")"
  for f in "<settings-backup>" "$D/settings.json"; do jq -cS 'del(.env, .hooks, .statusLine)' "$f" | sha256sum | cut -c1-16; done
  # → the same 16 hex digits twice
  jq -r 'has("alwaysThinkingEnabled")' "<settings-backup>" "$D/settings.json"   # → the same word twice
  [ -L "$D/plugins" ] && [ -e "$D/plugins" ] && echo "plugins: link resolves"   # → plugins: link resolves
  ```

  `env` is excluded because ccrc's `materialise` owns the model-env keys there; `hooks` and `statusLine` because `install-session-hooks.sh` converges them on every update. Record in the verification record, beside these hashes, Task B1's R-O4 measurement of whether the shim's effort mapping makes `alwaysThinkingEnabled` moot.
  **Stop:** the hashes differ (something wrote a frozen key: find the writer before the soak goes on, and read only key NAMES, never values), the link is missing, or the operator ruled R-O4 other than freeze: a mirror is a writer ccrc does not have, so it is a new task, not this step.
  **Rollback:** none (a ruling applied by measurement). **Authorisation:** read-only.

- [ ] **Step 3: Auto-update runs and every intent is restored (read-only).**

  ```bash
  ccrc channel | head -n 1           # → channel: state=ok channel=<prior-channel> … auto=<prior-auto>
  ccrc update --check | head -n 1    # → check: box=<tag> … projection=ok state=current
  jq -r '.phase' "$HOME/.ccrc/update.json"   # → done
  ssh <server-box> '"$HOME/.local/bin/ccrc" channel | head -n 1; "$HOME/.local/bin/ccrc" update --check | head -n 1'   # → the same two shapes, the same box= tag
  ```

  The operator confirms in the PWA's update screen that the fleet scope `*` reads the recorded `<prior-auto>` and `<prior-channel>`, that every node-scoped intent row a window wrote for `<nodeId>` reads its recorded prior values, and that no node shows an in-flight or `failed`/`reverted` row. "Running" is already measured: each lane's B4 gate saw a landing.
  **Stop:** `auto=off`, a channel other than recorded, `projection=` other than `ok` (re-read once after a minute: the fleet box's projection lags up to about 60 s), or a version skew between the boxes that is not a landing in flight. The operator restores the value; the controller re-reads.
  **Rollback:** none. **Authorisation:** read-only (the restore, if needed, is the operator's own console act).

- [ ] **Step 4 (optional, R-O5): Mirror the two exec blocks into the server box's roster.**

  Only if the operator rules R-O5 "yes", and only under **the server-box mirror authorisation**, the optional third one, given for this step alone. Every command runs on the server box, through `ssh <server-box>`.

  *4a. Census (read-only; critic #14).* One body, run on both boxes:

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  ( umask 077; cat > "$PB/b6-roster-census.sh" ) <<'EOF'
  A="$HOME/.ccrc/accounts.json"
  jq -S --arg a "$1" --arg b "$2" 'del(.accounts[] | select(.id == $a or .id == $b) | .exec)' "$A" | sha256sum | cut -c1-16
  jq -r --arg a "$1" --arg b "$2" '.accounts[] | select(.id == $a or .id == $b)
    | [(if .id == $a then "first" else "second" end), .exec.kind, (if .pool == null then "untagged" else "tagged" end)] | join(" ")' "$A" | sort
  "$HOME/.local/bin/ccrc" update --check | head -n 1
  EOF
  bash "$PB/b6-roster-census.sh" <first-lane-id> <second-lane-id>
  ssh <server-box> bash -s -- <first-lane-id> <second-lane-id> < "$PB/b6-roster-census.sh"
  for id in <first-lane-id> <second-lane-id>; do awk -v a="$id" '$1 == "acct" && $2 == a' "$HOME/.cc-sessions/pool-epoch" | wc -l; done
  ```

  Expected: the two boxes' first lines are the same 16 hex digits (the rosters agree everywhere except these two exec blocks); the server box reads `first external untagged` / `second external untagged` and the fleet box `first codex untagged` / `second codex untagged`; both `check:` lines name the same `box=` tag with `state=current`; the fleet box's pool epoch carries no `acct` line for either id (`0`, `0`), as at Task B1. The operator confirms the PWA's update screen (`GET /api/updates`) lists both nodes on that tag with no in-flight row.
  **Stop:** the hashes differ (the rosters already disagree elsewhere, which is not this plan's to reconcile), a pool tag on either side, a version skew, or an in-flight update. Nothing is written.

  *4b. Back up (server-box mirror authorisation).*

  ```bash
  ssh <server-box> bash -s -- <UTC> <<'EOF'
  A="$HOME/.ccrc/accounts.json"; K="$A.pre-3b-$1"
  [ ! -e "$K" ] || { echo "backup exists: $K" >&2; exit 1; }
  cp -p -- "$A" "$K" && cmp -s -- "$A" "$K" && stat -c '%a' -- "$A" "$K"
  EOF
  ```

  Expected: the same mode twice. **Its restore, named now:** `ssh <server-box> 'A="$HOME/.ccrc/accounts.json"; cp -p -- "$A.pre-3b-<UTC>" "$A.restore.tmp" && mv -f -- "$A.restore.tmp" "$A"'`.

  *4c. The candidate, validated by the shipped parser in a scratch HOME (server-box mirror authorisation).*

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  jq -c --arg a <first-lane-id> --arg b <second-lane-id> '[.accounts[] | select(.id == $a or .id == $b) | {id, exec}]' "$HOME/.ccrc/accounts.json" \
    | ssh <server-box> 'umask 077; mkdir -p "$HOME/.plan3b-b6" && cat > "$HOME/.plan3b-b6/exec.json"'
  ssh <server-box> bash -s <<'EOF'
  W="$HOME/.plan3b-b6"; A="$HOME/.ccrc/accounts.json"; C="$W/accounts.candidate.json"
  R="$HOME/ccrc/server/dist/shared/roster.js"
  [ -f "$R" ] || { echo "parseRoster: the shipped parser is not at $R — stop" >&2; exit 1; }
  ( umask 077; jq --slurpfile ex "$W/exec.json" 'reduce $ex[0][] as $e (.; .accounts |= map(if .id == $e.id then .exec = $e.exec else . end))' "$A" > "$C" ) || exit 1
  mkdir -p "$W/home"
  HOME="$W/home" node --input-type=module -e '
  import { readFileSync } from "node:fs";
  import { pathToFileURL } from "node:url";
  const [r, c] = process.argv.slice(1);
  const { parseRoster } = await import(pathToFileURL(r).href);
  try {
    const roster = parseRoster(JSON.parse(readFileSync(c, "utf8")));
    console.log(`parseRoster: ok, ${roster.accounts.length} accounts`);
  } catch (e) {
    console.error(`parseRoster: REFUSED — ${e.message}`);
    if (e.remedy) console.error(`remedy: ${e.remedy}`);
    process.exitCode = 1;
  }' "$R" "$C"
  EOF
  ```

  Expected: `parseRoster: ok, <n> accounts`, with `<n>` the roster's row count from Task B1's census. The release tarball carries `server/dist` (`deploy/build-release.sh`), so the shipped parser is on the server box's tree. The node snippet was exercised while drafting against a stand-in module, answering `ok` on a valid file and `REFUSED` plus its `remedy` on an invalid one.
  **Stop (the parseRoster stop):** `REFUSED`, the parser missing, or a non-zero exit: read `message` and `remedy`, remove the candidate (`rm -f -- "$HOME/.plan3b-b6/accounts.candidate.json"` on the server box), rename nothing.

  *4d. Rename into place (server-box mirror authorisation).*

  ```bash
  ssh <server-box> bash -s <<'EOF'
  A="$HOME/.ccrc/accounts.json"; C="$HOME/.plan3b-b6/accounts.candidate.json"
  cmp -s -- "$A.pre-3b-<UTC>" "$A" || { echo 'roster changed since the 4b backup: nothing renamed' >&2; exit 1; }
  chmod "$(stat -c %a -- "$A")" -- "$C" && mv -f -- "$C" "$A"
  jq -r '[.accounts[] | select(.exec.kind == "codex")] | length' "$A"
  EOF
  ```

  Expected: `2`.

  *4e. Roster agreement (server-box mirror authorisation for a restart; otherwise read-only).* The server loads its roster at boot and never reloads it (`ownRosterFp`'s comment, `server/src/server.ts`), so the mirror takes effect at the server's next start. Recommended: wait for the next auto-update landing on the server box, whose restart reads it. The alternative, under this authorisation only, is the operator's `systemctl --user restart ccrc.service` on the server box. After that start:

  ```bash
  ssh <server-box> 'curl -s http://127.0.0.1:7788/health | jq -r .ok; curl -s http://127.0.0.1:7788/api/fleet/health | jq -r .roster'
  # → true, then agreed
  ```

  `/health` is exempt from the auth gate; `/api/fleet/health` is not, so with the gate armed its read answers 401, and the operator reads the same field in the PWA, where the fleet-host banner shows no roster divergence (`FleetHostBanner`'s `roster === 'divergent'` arm). The two projections already agreed before the mirror: `accounts.sh` (`generateAccountsSh`, `shared/generate.mjs`) carries no exec kind, port or `authDir`, so a mirror that changes only exec blocks must still read `agreed`.
  **Stop and rollback (4b to 4e):** the server does not come up, `/health` does not answer, or the roster reads `divergent`: run 4b's named restore, restart the same way, and re-read `agreed`. A `divergent` after a pure exec-block mirror means the candidate changed something else: keep the evidence, report it.
  **Authorisation:** the server-box mirror authorisation (optional); 4a is read-only.

- [ ] **Step 5: Complete the verification record for both lanes (box-local).**

  `$PB/verification-record.md`, mode 0600, never committed: it holds real ids, paths and tags. Fill every item from the evidence each task left, citing the evidence path beside it:

  ```markdown
  # GPT lane Plan 3b — verification record (box-local, 0600)
  R-O1: <lane-2-first | lane-1-first>, ruled <UTC>
  ## first lane: <first-lane-id>   (and the same block for the second lane)
  - [ ] window opened <UTC>, closed <UTC>; auto-update paused <UTC>, restored <UTC> to auto=<prior-auto> channel=<prior-channel>
  - [ ] parked <n> session(s) (targets, per session); un-parked <UTC>; each first turn after un-park: done
  - [ ] backups: roster, settings.json (mode kept), the models files that existed, the entry file at <lane-id>.pre-ccrc-<UTC>; path and sha256 of each
  - [ ] other repository's stop: lane-explicit; units gone and ports free after more than RestartSec (listing only)
  - [ ] foreign usage timer disabled by the operator <UTC>; ccrc-codex-usage@<lane-id>.timer enabled <UTC>
  - [ ] roster: parseRoster ok in a scratch HOME; in place <UTC>; ccrc wrappers WRITE; init codex: created | not needed
  - [ ] refresh proof before any session returned: row ok
  - [ ] tiers running, unit names and slice; /ccgpt/lane JSON; gateway key only through the runtime.env EnvironmentFile (16d, no Environment read); key-bearing transient units left: 0
  - [ ] headless streamed turn and a tool call: ok; first usage publish ts <UTC>, one writer
  - [ ] B4 gate <dir>: opened <UTC>, passed <UTC>; codex-arm runs <n>; landing (tag shape) <UTC>; z4 lines (lane-2-first only)
  - [ ] departures recorded in execution-slugs.tsv: <slugs | none>
  ## close-out
  - [ ] R-O4: frozen-key hashes equal; alwaysThinkingEnabled as written; Task B1's moot-ness finding
  - [ ] auto-update running on both boxes; every intent restored
  - [ ] Task B5 Step 6: external path retired from this box's roster
  - [ ] server-box mirror: agreed <UTC> | not authorised
  - [ ] R-O7 snapshot: directory, file names, sha256, modes
  - [ ] execution ledger: numbers, PR
  - [ ] Plan 4 soak clock: started <UTC>; R1 per lane
  ```

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  stat -c %a -- "$PB/verification-record.md"         # → 600
  grep -c '^- \[ \]' "$PB/verification-record.md"    # → 0, once Steps 6 to 8 have filled their lines
  ```

  **Stop:** an item with no evidence path: the step that should have produced it is re-measured, never back-filled from memory. **Rollback:** none. **Authorisation:** read-only (it writes this plan's box-local record).

- [ ] **Step 6: Mint Part B's execution-ledger numbers, and define them in the same act.**

  `$PB/execution-slugs.tsv` holds every departure that fired: the carry-forward's three, `runtime-built-before-the-roster-flip` (the pre-lane build), `lane-without-a-registry-inits-after-the-flip` (lane 2's `init codex`) and `both-foreign-usage-timers-retired-per-lane` (both timers, one per window), plus any a Part B step recorded with its own proposed slug. Allocate exactly that many, once:

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  N=$(grep -c . "$PB/execution-slugs.tsv")
  printf '{"project":"ccrc-pwa","count":%d,"title":"GPT lane ownership Plan 3b: Part B execution ledger"}\n' "$N" \
    | "$HOME/.local/bin/ccrc-api" ledger allocate --json - > "$PB/ledger-allocation.json"
  jq -r '.ok, (.numbers | join(" "))' "$PB/ledger-allocation.json"
  ```

  Expected: `true`, then `N` contiguous numbers. In the same sitting, on a fresh workspace branch from `origin/main`, append to this plan file a `### Part B execution ledger` subsection at the end of `## Deviations found`, one entry per number in that section's format, pairing the numbers with the slugs in file order; and a `## Part B execution record` section at the end of the plan, stated by shape only (lane 1 / lane 2, the order ruled, each gate's passing date, the landing as "a dev release", Z4's refused-run count, the mirror's outcome), with no real id, port, path, host, model id or email. Then:

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  git -C "$TREE" fetch origin main
  cd "$TREE/server" && r11 b6-deviation-refs ./node_modules/.bin/vitest run test/deviation-refs.test.ts
  cd "$TREE/server" && r11 b6-dtbd ./node_modules/.bin/vitest run test/dtbd.test.ts
  cd "$TREE/server" && r11 b6-topology-clean ./node_modules/.bin/vitest run test/topology-clean.test.ts
  ```

  Expected: each file green, then `census: clean — no unit or link change, 0 fixture processes left; command exit 0`. Commit with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, check `git log -1 --format='%an <%ae> | %cn <%ce>'` shows the worktree's noreply identity only, push, and open the PR with blob/main links only, its body ending with the Claude Code attribution line.
  **Stop:** the allocation answers anything but `ok: true` (`not-seeded`, a 401, a 5xx): write no number, never guess one, and report it; a red guard; a residue hit. A number that was issued but cannot be defined today is reported with its slug, never reused.
  **Rollback:** an unmerged docs PR is closed; issued numbers are never returned (the floor only rises), which costs nothing.
  **Authorisation:** an ordinary docs PR, reviewed and merged by the operator (`--admin`, this repository's rule); the allocation is the box-token write `ccrc-api` makes on this box's own behalf.

- [ ] **Step 7: Start Plan 4's soak clock (R-O9; read-only on the box).**

  R-O9: at least one full weekly usage window on both lanes before Plan 4. One full window is measured reset to reset: from `R1`, each lane's first weekly reset after the clock starts, to `R2`, the next one, which the lane's row names once `R1` has passed. So the clock runs between one and two weeks.

  ```bash
  . "<abs scratch>/plan3b-exec/plan3b-env.sh"
  [ ! -e "$PB/plan4-soak-clock.sh" ] || { echo "soak-clock: the script exists; it is written once" >&2; exit 1; }
  ( umask 077; cat > "$PB/plan4-soak-clock.sh" ) <<'EOF'
  #!/usr/bin/env bash
  # plan4-soak-clock.sh <clock-dir> <lane-id>... — ruling R-O9's clock. READ-ONLY on the box:
  # it reads each lane's ~/.cc-limits row (sevenResetAt, ts) and the last 24 h of ccrc's
  # usage-publish journal, and writes only into <clock-dir>. One FULL weekly window is
  # [R1, R2]: R1 the lane's first weekly reset after the clock started (recorded at the
  # start), R2 the next one, which the row names once R1 has passed (recorded here, once).
  # Exit: 0 every lane has run one full window on ccrc's publication; 1 a window still
  # runs; 2 a lane's evidence is unmeasured or its publication broke; 64 usage.
  set -uo pipefail
  [ "$#" -ge 2 ] || { echo "usage: plan4-soak-clock.sh <clock-dir> <lane-id>..." >&2; exit 64; }
  C=$1; shift
  [ -s "$C/start" ] || { echo "soak-clock: $C/start is missing; run Task B6 Step 7 first" >&2; exit 64; }
  now=$(date -u +%s); since=$(cat "$C/start"); [ $((now - 86400)) -gt "$since" ] && since=$((now - 86400))
  rc=0; i=0
  worse() { [ "$1" -gt "$rc" ] && rc=$1; return 0; }
  for L in "$@"; do
    i=$((i + 1)); row="$HOME/.cc-limits/$L.json"
    r=$(jq -r 'if (.sevenResetAt | type) == "number" then (.sevenResetAt | floor | tostring) else empty end' "$row" 2>/dev/null)
    ts=$(jq -r 'if (.ts | type) == "number" then (.ts | floor | tostring) else empty end' "$row" 2>/dev/null)
    r1=$(cat "$C/$L.r1" 2>/dev/null)
    if ! [[ "$r" =~ ^[0-9]+$ && "$ts" =~ ^[0-9]+$ && "$r1" =~ ^[0-9]+$ ]]; then
      echo "soak-clock: lane #$i: UNMEASURED — the row's sevenResetAt/ts or the recorded R1 is not a number"; worse 2; continue
    fi
    gap=$(journalctl --user -q -u "ccrc-codex-usage@$L.service" --since "@$since" -o short-unix 2>/dev/null \
          | grep -F ': Finished ' | awk -v p="$since" -v now="$now" '{ t = int($1); g = t - p; if (g > m) m = g; p = t } END { g = now - p; if (g > m) m = g; print m + 0 }')
    if [ $((now - ts)) -gt 1800 ] || [ "${gap:-0}" -gt 1800 ]; then
      echo "soak-clock: lane #$i: BROKEN — usage row $((now - ts))s old, longest publish gap in the last 24 h ${gap}s (more than two intervals): Task B4's ROLLBACK criterion"; worse 2; continue
    fi
    if [ "$now" -lt "$r1" ]; then
      echo "soak-clock: lane #$i: window not begun — its first weekly reset after the clock's start is $(( (r1 - now) / 3600 )) h away"; worse 1; continue
    fi
    if [ ! -s "$C/$L.r2" ]; then
      if [ "$r" -gt "$r1" ]; then
        printf '%s\n' "$r" > "$C/$L.r2"
      elif [ $((now - r1)) -le 1800 ]; then
        echo "soak-clock: lane #$i: R1 has just passed; the next publish names the next reset"; worse 1; continue
      else
        echo "soak-clock: lane #$i: BROKEN — R1 passed $(( (now - r1) / 60 )) min ago and the row still names it"; worse 2; continue
      fi
    fi
    r2=$(cat "$C/$L.r2")
    if [ "$now" -ge "$r2" ]; then
      echo "soak-clock: lane #$i: one full weekly window ran on ccrc's publication (R-O9 met)"
    else
      echo "soak-clock: lane #$i: inside its full window; $(( (r2 - now) / 3600 )) h left"; worse 1
    fi
  done
  exit "$rc"
  EOF
  chmod 0700 "$PB/plan4-soak-clock.sh" && bash -n "$PB/plan4-soak-clock.sh" || exit 1
  C="$PB/plan4-soak"; ( umask 077; mkdir -p -- "$C" ) || exit 1
  [ ! -e "$C/start" ] || { echo "soak-clock: already started" >&2; exit 1; }
  for L in <first-lane-id> <second-lane-id>; do
    jq -r 'if (.sevenResetAt | type) == "number" then (.sevenResetAt | floor | tostring) else empty end' "$HOME/.cc-limits/$L.json" > "$C/$L.r1"
    [ -s "$C/$L.r1" ] || { echo "soak-clock: a lane's row names no weekly reset; R-O9 cannot be measured" >&2; exit 1; }
  done
  date -u +%s > "$C/start"
  "$PB/plan4-soak-clock.sh" "$C" <first-lane-id> <second-lane-id>; echo "rc=$?"
  ```

  Expected: two lines `soak-clock: lane #<i>: window not begun — its first weekly reset after the clock's start is <h> h away` and `rc=1`. Measured while drafting in a fixture HOME with stand-ins: `window not begun … 1 h away` before `R1`, and `inside its full window; 166 h left` once `R1` had passed and the row named the next reset, with `R2` recorded once. The script writes only into its clock directory.

  From here, **once a day until it answers `rc=0`**: run the clock, and one `b4-sample.sh` per lane against that lane's existing gate (Task B4 Step 3's command). Each daily run checks the last 24 hours of ccrc's usage-publish journal, so a daily cadence leaves no hour unread. Plan 4 starts only on a day when the clock answers `rc=0` (`one full weekly window ran on ccrc's publication (R-O9 met)` for both lanes) **and** both samples answer `rc=0`, and then only on the operator's explicit go (spec §2.11's standing authorisation plus that go).
  **Stop:** `rc=2` (a lane's row stale, a publish gap over 1800 s, a reset the row never rolled past, or an unreadable row): Task B4 Step 4's reading for that lane; the clock does not restart by itself, and whether a broken window restarts it is the operator's ruling. A daily sample answering `rc=2` or `rc=3` stops the clock the same way.
  **Rollback:** none. **Authorisation:** read-only (it writes only its own clock directory).

- [ ] **Step 8: R-O7's snapshot of the other repository's live launcher bytes (box-local, 0600).**

  The live `~/.local/bin/ccgpt` matches no commit of its repository (measured across that repository's whole history, unlike its usage publisher, which is merely stale), so this snapshot is the only record of what the lanes ran before ccrc. It also carries that repository's committed-in-plaintext account emails (spec §15), so it never leaves this box: no repository, no shipped evidence, no PR, never printed.

  ```bash
  R="$HOME/.ccgpt-launcher-r-o7"; U=$(date -u +%Y%m%dT%H%M%SZ)
  ( umask 077; mkdir -p -- "$R" ) && chmod 0700 "$R" || exit 1
  cp -p -- "$HOME/.local/bin/ccgpt" "$R/ccgpt.$U" && chmod 0600 "$R/ccgpt.$U"
  for e in "$HOME/.local/bin/<first-lane-id>".pre-ccrc-* "$HOME/.local/bin/<second-lane-id>".pre-ccrc-*; do
    [ -e "$e" ] || [ -L "$e" ] || continue
    cp -P -p -- "$e" "$R/${e##*/}.$U"
    [ -L "$R/${e##*/}.$U" ] || chmod 0600 "$R/${e##*/}.$U"
  done
  cmp -s -- "$HOME/.local/bin/ccgpt" "$R/ccgpt.$U" && echo "snapshot: byte-equal"
  stat -c '%a %F' -- "$R" "$R"/*
  sha256sum -- "$R/ccgpt.$U" | cut -c1-16
  ```

  Expected: `snapshot: byte-equal`; `700 directory` for the directory; `600 regular file` for the launcher copy and lane 2's moved-aside entry; a `symbolic link` line for lane 1's moved-aside entry, kept as the link it is (the same `cp -P -p` rule as `ccrc wrappers --force`'s symlink backup). Record the directory, the file names and the hash prefix in the verification record. The two globs name only the entries Plan 3b moved aside (`<first-lane-id>.pre-ccrc-<UTC>`, `<second-lane-id>.pre-ccrc-<UTC>`); the other repository's older `.bak-*` / `.pre-*` copies are not this snapshot's and stay for Plan 4's critic #18 list.
  **Stop:** `cmp` differs, or a mode is not as expected: `rm -f -- "$R/ccgpt.$U"` (this plan's own new file) and take it again.
  **Rollback:** none needed: it adds files only. It is kept until Plan 4's live-box cleanup is verified, and Plan 4 verifies it exists, byte-equal by hash, before its first `rm`.
  **Authorisation:** operator ruling R-O7, which names this snapshot. It reads the other repository's files and never moves, edits or deletes one.

## Authorisation shapes

- **Part A merge.**
  - **The act:** an ordinary review, then one squash-merge with `--admin`. The merge is itself a rollout: it becomes a dev prerelease within about a minute, and both boxes follow on their own.
  - **What it changes on today's live shape (no codex row): nothing that runs on a success path.**
    - A1's refusals fire only when the roster cannot be classified. Today that read falls through to the external path, and after the merge it refuses `roster-invalid` or `missing-dependency`, a failure path only.
    - A2's re-measure and WARN are reached only with a ccrc usage instance enabled, and none exists.
    - A3: every `ccrc account remove` on a Linux box with ccrc's template `ccrc-codex-usage@.service` placed (the fleet box has it) now makes one read-only `systemctl --user is-active ccrc-codex-usage@<id>.service` call. Its usage half runs before the roster drop, so the report lists the usage entries before the drop (⟦D:usage-quiesce-before-the-roster-drop⟧). The wait is reached only while that service runs, and no instance exists. A manager that does not answer adds an operator step. No Part B step runs `ccrc account remove`.
    - A4 changes the hourly refresh row of lane 1, the external lane with a codex-probe registry, but only when its render step fails with no body or with a body lacking `.detail`. That row then reads `ok:false` with a reason instead of `ok:true`/`skipped` (or reason `null`). `refresh --all` then exits 1, truthfully.
    - A5's three changes sit on `_check_codex` paths past its SKIP, and today it SKIPs.
    - A6's type test answers the same for the regular files on the box. Only a non-regular file now refuses where it would have blocked.
  - **What it does not authorise:** any Part B act.
  - **Before the merge, read-only:** the controller records doctor's class table for the gate in [Task order](#task-order) and for B1 Step 6: `. "<abs scratch>/plan3b-exec/plan3b-env.sh"; mkdir -p "$SCRATCH/partB"; "$HOME/.local/bin/ccrc" doctor 2>&1 | awk '/^(PASS|WARN|FAIL|SKIP) [a-z0-9-]+:/ { c = $2; sub(/:$/, "", c); print c, $1 }' | sort -u > "$SCRATCH/partB/doctor-classes-pre-partA.txt"`.
- **The runtime-build authorisation (B2; pre-lane, critic #13):**
  - `ccgpt-runtime build`, then `ccgpt-runtime check`, recording the raw-shape canary;
  - writes only under `~/.ccrc/runtime/codex/` (about 650 MB; B1 has proved at least 2 GB free).
  - Rollback: keep it by default, because nothing reads the runtime until a codex row exists. Only on the operator's word, remove `~/.ccrc/runtime/codex` by path behind B2's three guards (⟦D:runtime-removed-by-path-on-rollback⟧).
- **[LW <lane-id>], the lane's per-lane authorisation, with a named window (`<UTC>` start, `<window-end-UTC>` end).** B3 tags its acts with it, and B5 Step 4 calls the second one "the second lane's per-lane authorisation"; [OP] marks the operator's own act and [RO] a read-only one. A B4 STOP repair or ROLLBACK for the lane reopens it: the operator names a new window (start and end, recorded in `rulings.txt`), auto-update is paused again (RB1), and the same acts and rollback rows apply. It covers every act below, and nothing else:
  - the auto-update pause and its restore, the operator's own PWA acts (R-O6);
  - `ccd swap <session-id> <park-target-wrapper>` for each live session on the lane, the symmetric un-park `ccd swap <session-id> <lane-id>`, and, on a failed first turn, the swap back out. This covers both lanes, now that both carry sessions;
  - `ccrc account disable --id <lane-id>` and `ccrc account enable --id <lane-id>`, and, only on a `last-enabled-home` refusal, the operator's `ccrc account enable --id <another home-able id>` ([OP], B3 Step 4);
  - the backups (roster, `settings.json`, the models files that exist);
  - the lane-explicit stop of the other repository's tiers through the lane's own entry file, `CCGPT_ACCOUNT_ID=<lane-id> ~/.local/bin/<lane-id> stop` (B3 Step 6; ruling R11), before the roster flip only, never a bare `ccgpt stop`;
  - the operator's own disable of the lane's foreign usage timer: `systemctl --user disable --now ccgpt-usage.timer` for lane 1, `systemctl --user disable --now ccgpt-usage@<lane-id>.timer` for lane 2;
  - `mv ~/.local/bin/<lane-id> ~/.local/bin/<lane-id>.pre-ccrc-<UTC>`;
  - the roster hand edit: the lane's `exec` block becomes `{"kind":"codex","provider":"openai","proxyPort":<lane-shim-port>,"litellmPort":<lane-litellm-port>,"authDir":"<lane-auth-dir>"}`, validated by the shipped `parseRoster` in a scratch HOME, then renamed into place;
  - `ccrc wrappers`;
  - `ccrc models <lane-id> init codex`, for a lane without a registry only;
  - `ccrc models refresh <lane-id>` and `ccrc models litellm <lane-id>`;
  - `ccrc codex login <lane-id>`, only on `login-required`, in the operator's browser;
  - `systemctl --user enable --now ccrc-codex-usage@<lane-id>.timer` (R-C10), and one `systemctl --user start ccrc-codex-usage@<lane-id>.service` publisher run;
  - `ccrc codex start <lane-id>`;
  - one headless test turn with one tool call through the lane;
  - **if reached, the rollback acts:**
    - `ccrc codex stop <lane-id>`;
    - `systemctl --user disable --now ccrc-codex-usage@<lane-id>.timer`;
    - `ccrc models <lane-id> rm`, for a lane that had no registry before its flip, before the roster backup returns;
    - restoring the backups;
    - removing ccrc's marker-verified wrapper;
    - moving the entry file back;
    - the operator's re-enable of the foreign usage timer;
    - restarting the other repository's tiers through the restored entry file. That repository has no tier-only start verb (its usage header names `login`, `stop` and a bare launch), so the start is the first launch through the restored `~/.local/bin/<lane-id>`: one headless turn, run with `CCGPT_ACCOUNT_ID=<lane-id>` set (B3's RB12; ruling R11).
- **Optional: the server-box mirror authorisation (R-O5; B6 Step 4b–4e).** A read-only census first: the roster copy, the `/api/updates` builds, and the pool epoch for these ids. Then a backup of `accounts.json` with its restore named. A `parseRoster` refusal is a stop, and roster agreement must answer `agreed` afterwards. The server reads its roster at boot only, so `agreed` waits for its next start, by default the next auto-update landing on the server box. A hand `systemctl --user restart ccrc.service` on the server box runs only under this authorisation, and the operator reads roster agreement in the PWA (ruling R9).
- **B6's close-out PR:** `ccrc-api ledger allocate` (B6 Step 6) and the docs PR that defines Part B's execution-ledger numbers. It is an ordinary review, merged by the operator.
- **R-O7's snapshot (B6 Step 8):** authorised by the ruling itself. It reads and copies the other repository's files and never moves, edits or deletes one.
- **Plan 4** rests on the operator's standing authorisation of the eventual removal (spec §2.11), plus an explicit go after R-O9's soak ([Carry-forward to Plan 4](#carry-forward-to-plan-4)).

## Follow-up tickets (not this plan)

Per ruling A-8, these stay tickets. This plan creates none. Each is listed for the operator to open, with its owner's evidence.
- **`_fix_codex` prints "litellm.yaml NOT rendered" over a refusal whose detail says the file WAS written** (`ccd/ccrc-doctor-checks`' `_fix_codex` catch, against `_models_litellm_lane_held`'s post-write `start-failed` branch). Cosmetic, codex-lane only. It needs a grep of every `.error` consumer before splitting the `start-failed` code.
- **The `login-required` wording, and import-time LiteLLM output on the codex path** (`ccd/ccrc-models-probe`'s `login-required` refusal). Both need a real-LiteLLM opt-in case (`CCRC_TEST_LITELLM_PY`) to measure, and the wording is plan-mandated and pinned, so it is reworded in its own change.
- **Plan 3a's test-coverage minors.** The probe runtime's no-network audit hook is unpinned (`server/test/codexLaneFixture.ts`). Also the per-task deferred minors Plan 3a's final review listed: Task 4 (1)–(4) and (7); Task 5 (5) and (6); Task 6 (5) and (6); Task 7 (2)–(6); Task 8's two; Task 10 (1), (4), (6), (7) and (8).
- **`server/test/macos-platform.test.ts` timed out once at 20 s under load.** It is green alone, and the macOS legs gate nothing by ruling. The ticket is for the repository `CLAUDE.md` flake list's maintainers.
- **`pwa/src/fleet/SwapSheet.tsx`'s comment says manual swaps are pool-unconstrained.** That contradicts `ccd/ccd`'s `cmd_swap` header, which states that a manual swap is pool-constrained like an automatic one. The comment is stale prose, and a reader of the PWA gets the wrong model.
- **The PWA has no per-node update-intent control.** The Settings screen hardcodes `FLEET_SCOPE`, so a per-box pause, which the server and store fully support, is API-only (R-O6).
- **The FIFO class outside the lane files (ruling R7).** `deploy/account-op.mjs` opens the roster by name with its own read, and `deploy/models-op.mjs` reads the providers whitelist, an `--endpoints` file and the LiteLLM template with bare `readFileSync`. A6 leaves both: they are shipped-tree or argv files, not lane files.
- **A `_models_litellm` that exits 0 with an empty body reads `litellm: "unchanged"`** (ruling R17, A4's residue). No path does that today. B4's render-mtime cross-check is the independent signal.

## Carry-forward to Plan 4

Plan 3a's Plan 4 section, carried with the amendments this plan's measurements force. Nothing here is done in Plan 3b. Plan 4 starts only after R-O9's soak (at least one full weekly usage window on both lanes, its clock started by B6) and an explicit operator go.

**Plan 4: retirement (the point of no return)**
1. **OpenClawHetzner: R-O8, trim in place (amended).** Neither 2026-07-22 document that names `ccgpt` is GPT-lane-specific, so trim each one's `ccgpt` lines in place under a superseded note, and delete neither file. The `claude-glm` install notes' home, `infra/handoff/README.md`, already has a `claude-glm` row. A grep proves the notes are complete there before any line goes.
2. **OpenClawHetzner: split `test_ccgpt_proxy.py` per method.** State method counts before and after. The GLM/K3 wrapper cases, the provider-policy cases and the ownership-allow-list case stay and pass, run per the file's docstring (that repository has no CI for them). The publisher's SHA-256 pin goes with the publisher.
   - **Obligation (critic #19):** map each deleted GPT-lane test method to a ccrc case, or to a stale `nohup` pin that spec §14 says to replace, with counts on both sides.
3. **OpenClawHetzner: delete the GPT-lane files and repair every reference.**
   - **Obligation (critic #19):** the count is ten files deleted plus the one split in Task 2, not "eleven deleted".
   - Fix the `.gitignore` comment. Afterwards `git grep ccgpt` hits only superseded records and Task 1's superseded notes.
   - **Amended by measurement:** the `ccgpt-usage@.{timer,service}` template pair is not in that repository's git tree, so this task deletes only the flat pair's tracked files. A `git grep` there under-counts what the box holds, and Task 4 carries the template.
   - `~/.handoff/env` and the GLM/K3/handoff-runner scripts are untouched. No email is added anywhere.
4. **The live box: clean up the other repository's installed lane files.**
   - First, verify that R-O7's snapshot (Plan 3b's B6 Step 8) exists, byte-equal by hash to the SHA-256 B1 recorded (`CCGPT_SHA256`), before any `rm`.
   - **The list, amended:**
     - `~/.local/bin/ccgpt`, which Plan 3b never moved (B-3);
     - `ccgpt-proxy` and `ccgpt-usage`, with their `.py` copies;
     - both lanes' moved-aside `<lane-id>.pre-ccrc-<UTC>` entry files. Lane 1's is a symlink: remove the link, never its target;
     - the stale PATH copy of the model probe;
     - the four usage unit files, **including the box-only `ccgpt-usage@.{timer,service}` template**, with their drop-in directory, then `daemon-reload`;
     - the other repository's box-global LiteLLM config and its per-lane copies.
   - **Obligation (critic #18):** also list, or explicitly keep, the other repository's `.bak-*` and `.pre-*` backups of its launcher and shim in `~/.local/bin`.
   - **Stop before any `rm`** if any process's argv names one of those files or the other repository's LiteLLM venv, or if any `ccgpt-usage*` timer is enabled.
   - **Afterwards:** `ccrc doctor` is clean, both lanes still serve a turn, and `~/.handoff/env` and both `authDir`s are byte-untouched (stat mtime and size only). The other repository's LiteLLM venv is left alone unless a ruling says otherwise.
5. **ccrc PR, code plus docs (ruling Z8).** A small PR, opened once no external lane has a codex registry, measured read-only on the fleet box first: no `external` row has a `<id>.classes.json`.
   - It deletes `_models_litellm`'s external arm (the box-global path, `_models_litellm_running`'s `pgrep`, the bare `ccgpt stop`) with `_models_litellm_stop_blocked`. It also deletes the probe's `_fetch_codex`, which carries the token-directory default and the direct `auth.json` read, so D-3161 closes everywhere. `_fetch`'s dispatch line goes with it, and so does the `CCRC_PROBE_LANE_KIND` marker.
   - Z3's and Z4's guards go with their pins. **Amended:** A1's three-answer contract and its codex-side refusals stay, because a codex reader still needs to fail closed. Only the external fall-through it guards disappears. A4's exit-code fallback stays.
   - `BASE_LIVE_SHAPE` (`server/test/ccrc-install.test.ts`) is retired or re-measured, as its docstring says.
   - **The spec, amended:**
     - Record that the cutover and the deletion are done, citing the other repository's deletion commit and Plan 3b's deviations.
     - §21's pointer on `:497` becomes true without condition once the external fetch's `auth.json` read is gone, and the spec says so.
     - Fix §20.9's "measures the base on the same fixture" (`:1082`, and D-3705's definition, which says the same: a golden measured once) and D-3721's sentence order, the half of Plan 3a's spec-wording follow-up this plan leaves.
   - `deviation-refs`, `dtbd` and `topology-clean` stay green, and no docserver URL or real value appears.

**Authorisation (carried):** Tasks 1–3 are one OpenClawHetzner PR, reviewed there. Task 4 is a separate, irreversible live act, authorised on its own. Task 5 is a small ccrc PR.

## Where every carried item lands

Every bullet of Plan 3a's carry-forward Plan-3b part, and every "Final-review follow-ups" bullet, mapped to a task here, to Plan 4, to a follow-up ticket, or to done.

**Plan 3a's carry-forward, Plan 3b part**

| Carried item | Lands in | How |
|---|---|---|
| Each lane leaves the external path by its kind at its flip (Z8); nothing switched by hand | B3 (verified) | B3's verification reads the first refresh row's `probe:"codex"` and the lane's own `litellm.yaml`, and no external-arm act is typed |
| "The lane with a registry flips first (Z4)" | **R-O1, reopened**; B1, B3, B4 | The session counts reversed, so both orders are laid out with Z4's consequence. The recommendation is lane 2 first, with Z4's degradation monitored (execution-ledger slug `second-lane-first-accepts-z4-refusals`, if it fires) |
| "Since 2026-09-30 this is live": measure which process `pgrep -f` matches | B1 | Re-measured at drafting (lane 1's LiteLLM matches). B1 re-measures it, and B4 monitors under order X |
| A flip back keeps the lane's registry; the lane without one removes it on rollback | B3 (rollback) | `ccrc models <lane-id> rm` before the roster backup returns, for a lane that had no registry before its flip |
| Step 1: a release with Plan 3a on both boxes, update converged, doctor classes kept | B1 | Now a release containing Part A, too: the gate in [Task order](#task-order) |
| Step 1: port holders, units, timers, `authDir` modes, launcher shapes and sessions match | B1 | Read-only. Any mismatch stops the window |
| Step 1: `node` on a session pane's PATH | B1 | |
| Step 1: at least 2 GB of disk free | B1 | |
| Step 1: the next `ccrc-models.timer` fire falls outside the window | B1, B3 | Re-read at the top of each window |
| Step 1: re-measure the lane-1 tiers | B1 | |
| Step 1, critic #15: the reference file's GPT-lane section | B1 | B1 writes it and the `0600` values file (B-9) |
| Step 1: stop on any census mismatch | B1 | |
| Step 2: build the runtime before any codex row; record the canary; stop on a failing stage | B2 | |
| Step 2: a probe failure in the pinned range goes to a ruling (2b2-12) | B2 | Its stop condition |
| Step 2, critic #13: the build is its own authorisation | [Authorisation shapes](#authorisation-shapes) | |
| Step 3: lane 1's order 1–9 | B3, parameterised | Now one procedure for both lanes. Parking is generalised (R-O2), only the entry file moves (B-3), and the stop is lane-explicit (B-4) |
| Step 3: the verification list (units and slice, MainPID per port, `/ccgpt/lane`, count-only key absence, a streamed turn and a tool call, one publisher run, doctor) | B3 | |
| Step 3: then `ccrc account enable` | B3 | |
| Step 3, critic #3: back up `settings.json` (mode kept) and the models files; restore on rollback | B3 | B-8's list |
| Step 3, critic #5: account disable and enable; the `last-enabled-home` refusal | B3 | B1 confirms other placeable homes exist |
| Step 3, critic #7: never the foreign stop for a migrated lane; rollback stops ccrc first | B3; Global Constraints | B-4, and B-8's rollback order |
| Step 3, critic #4: pause auto-update for the window only | B3; **R-O6, amended** | Fleet-wide PWA pause recommended, because a per-box pause is API-only (⟦D:update-pause-is-fleet-scoped⟧) |
| Step 3: rollback per step reached | B3 | B-8's order |
| Step 3: `login-required` stops for `ccrc codex login` with the operator | B3 | B-7 |
| Step 3, hazard 3: the tier's `Authenticator` on a dead token; prove a refresh first; read catalogue age and `auth.json` mtime | B3, B1; A7 (§21 pointer on `:993`) | Review Focus 5 |
| Step 4: one real session runs on the lane | B4 | |
| Step 4: one hourly refresh takes the codex arm | B4 | Under A4's reading rule: only a row whose `litellm` reads `rendered` or `unchanged` with `probe:"codex"` counts |
| Step 4, critic #4: one auto-update lands while the lane is codex | B4 | Also R-C10's no-op proof |
| Step 4: the usage row refreshes every 15 minutes from a single writer | B4 | |
| Step 4: doctor stays clean | B4 | |
| Step 4: stop and rollback criteria (gateway 401, foreign listener, usage row older than two intervals, a launcher refusal in the session journal) | B4 | Plus no `restart-failed` row for the flipped lane |
| Step 5: park lane 2's sessions (R-O2) | B3 via B5 | Its session count is now 1 |
| Step 5: stop lane 2's tiers, wait past `RestartSec`, re-check ports and units | B3 | Review Focus 3 |
| Step 5, Z4's reason: never a bare `ccgpt stop` | B3; Global Constraints | |
| Step 5: the operator disables the template instance | B3 | B-5 |
| Step 5: move the launcher aside, then flip the roster | B3 | |
| Step 5, critic #3: lane 2's backups | B3 | |
| Step 5: `ccrc wrappers`, then `init codex`; diff the settings env block and the effort file | B3 | The registry parameter |
| Step 5: refresh, `litellm`, the targeted enable, `start`; a `unit-foreign`/`port-foreign` refusal is a stop | B3 | |
| Step 5: verify, plus no key-bearing transient unit remains (count only) | B3 | |
| Step 5: un-park | B3 | |
| Step 5, critic #20: a session that cannot park keeps the window shut; a failed first turn rolls back | B3; R-O2 | B-2's stop conditions |
| Step 5: rollback, plus the foreign restart, the instance timer and `ccrc models <lane> rm` | B3 | |
| Step 6: R-O4's settings ruling | B6 | |
| Step 6: the server-box mirror with critic #14's census, backup, `parseRoster` stop and `agreed` check | B6 | The optional authorisation |
| Step 6: confirm auto-update is running | B6 | |
| Step 6: complete the verification record for both lanes | B6 | |
| Step 6: start Plan 4's soak clock | B6 | R-O9 |
| The three Plan-3b ledger slugs | Part B's execution ledger | Recorded when they fire (B2, B3, B3); not minted by this plan |
| R-O1 … R-O9 and R-C10 | [Operator rulings](#operator-rulings-to-confirm-at-plan-review) | R-O1 reopened, R-O2 generalised, R-O6 and R-O8 amended by measurement |
| Authorisation shapes, Plan 3b part | [Authorisation shapes](#authorisation-shapes) | The parking swaps now cover both lanes |
| Authorisation shapes, Plan 4 part; Plan 4 Tasks 1–5 | [Carry-forward to Plan 4](#carry-forward-to-plan-4) | Task 1 trim in place; Task 4 lists the box-only template |
| The live shape at drafting: the launcher matches no commit | R-O7; B6 Step 8 (snapshot); Plan 4 Task 4 (verify) | Re-measured: only the launcher is diverged, and the publisher is stale |
| The live shape at drafting: a stale PATH copy of the model probe | Plan 4 Task 4 | |

**Plan 3a's "Final-review follow-ups"**

| Follow-up | Lands in |
|---|---|
| DONE: lane 1's stale "idle" facts | **Done** in Plan 3a. B1 re-measures (lane 1 now carries 6 sessions) |
| `_models_probe_codex_env` and `_models_litellm_codex` fold an undecidable roster into "not codex" | **A1**, with `_models_litellm`'s dispatcher, and §20.1's "has no default" pointer in A7 |
| Usage-converge flip-back gaps | **A2**, and §20.4's two pointers in A7 (`:1039`, and `:1035` by ruling NC-1) |
| Account removal can race an in-flight `ccrc-codex-usage@<id>.service` | **A3**: wait, never stop |
| Doctor robustness minors (`cmp`, unlistable `~/.ccrc/codex`, unreadable `.wrapper`) | **A5**, absorbed from its ticket |
| `_fix_codex`'s "NOT rendered" over a written file | **Follow-up ticket** |
| Task 1 minor 4's `login-required` wording and import-time LiteLLM output | **Follow-up ticket** |
| The refresh loop's bodyless `_models_litellm` failure read as `skipped` | **A4** (the code, with `.detail // empty`), and B4's reading rule |
| DONE: `BASE_LIVE_SHAPE`'s docstring | **Done** in Plan 3a. **Plan 4** Task 5 acts on its pointer |
| Spec wording minors: `:497` and `:993` | **A7** (§21 pointers) |
| Spec wording minors: §20.9 `:1082` and D-3705's same claim, and D-3721's sentence order | **Plan 4** Task 5's docs |
| Test-coverage minors | **Follow-up ticket** |
| `macos-platform.test.ts`' timeout under load | **Follow-up ticket** |
| The models writer path opens `settings.json` and the roster by name | **A6**, absorbed from its ticket |

**Found by this plan's measurements, not carried from 3a**

| Item | Lands in |
|---|---|
| `_models_litellm`'s dispatcher is a third reader of the undecidable fold | A1 |
| `SwapSheet.tsx`'s stale pool comment | Follow-up ticket |
| The PWA has no per-node update-intent control | Follow-up ticket; R-O6's amendment |
| The `ccgpt-usage@.{timer,service}` template is box-only | Plan 4 Tasks 3 and 4 |
| R-O8's documents are not GPT-lane-specific | Plan 4 Task 1 (trim in place) |
| `ccgpt` has no tier-only start verb | B3's rollback; [Authorisation shapes](#authorisation-shapes) |
| `_uninst_codex_usage` counts a stop on the exit code alone | A2 (ruling R7) |
| `cmd_account remove` runs its usage half after the roster drop, so a refusal there could not be retried | A3 (⟦D:usage-quiesce-before-the-roster-drop⟧) |
| `account-op.mjs`' and `models-op.mjs`' other by-name reads | Follow-up ticket |
| An exit-0, empty-body render reads `unchanged` | Follow-up ticket; B4's mtime cross-check |

## Deviations found

Named by slug; the controller mints each number from the allocator after review and substitutes it (never a range). A6 carries none: it closes §20.3's own carried follow-up (conformance).

- **⟦D:codex-kind-read-fails-closed⟧** (A1). `_models_litellm_codex` widens to three answers (0 codex, 1 not codex, 2 cannot tell, forwarding `_codex_lanes`' sentence), and every reader refuses on 2 in `roster-invalid`/`missing-dependency` instead of folding an undecidable roster into "not codex", departing from spec §20.1's "for every other row" sentence.
- **⟦D:usage-withdrawal-is-re-measured⟧** (A2). `_inst_codex_usage` counts an instance withdrawn only when `_codex_usage_enabled` re-measures its link gone after `disable --now`; a 0 answer with the link left is the existing NOT CONVERGED refusal, and `_uninst_codex_usage` counts a timer stopped only on the same re-measure (its rc-only count, ruling R7), departing from spec §20.4's rc-only withdrawal.
- **⟦D:surplus-ccrc-usage-timer-warns⟧** (A2). Doctor's codex usage rows gain their own WARN naming any enabled `ccrc-codex-usage@<id>.timer` whose id is not a codex lane now, with ccrc's own withdrawal as the remedy, a row spec §20.3/§20.4 do not have.
- **⟦D:account-removal-waits-for-usage-refresh⟧** (A3). `_acct_remove_usage` waits, bounded by `CCRC_ACCT_USAGE_WAIT_S` (default 300), for `ccrc-codex-usage@<id>.service` to go inactive, never stops it, and refuses `usage-refresh-in-flight` before any limits-row deletion at the bound, departing from spec §20.4's "the removal still completes".
- **⟦D:usage-quiesce-before-the-roster-drop⟧** (A3). _acct_remove_usage moves from after the roster drop (Plan 3a's position) to directly before it, because a usage-refresh-in-flight refusal after the drop could not be retried (the retry's _acct_lane refuses unknown-id), while every step before the drop repeats as a no-op.
- **⟦D:bodyless-litellm-failure-fails-the-row⟧** (A4). A refresh row whose `_models_litellm` step exits non-zero with no readable `.detail` (no stdout, no or a `null` `.detail`, or bytes that are not JSON) is `ok:false` with a non-empty reason, never `ok:true, litellm:"skipped"`, with the same block's `.detail` read folded to `.detail // empty`.
- **⟦D:codex-doctor-unmeasured-is-not-skip⟧** (A5). Doctor's codex check reads unmeasured where it cannot tell: a missing `cmp` skips only the byte compare, an unlistable `~/.ccrc/codex` WARNs instead of SKIPping, and an unreadable `.wrapper` counts as a session that may be on the lane.
- **⟦D:entry-moved-aside-not-the-launcher⟧** (B3). The carry-forward's "move the launcher aside" moves only the lane's entry file `~/.local/bin/<lane-id>` (lane 1's symlink as a link, never its target), and never the shared `~/.local/bin/ccgpt`, which Plan 3b never moves, edits or deletes. That entry file is moved aside (Step 8) before the roster row becomes codex-kind (Step 9), which reverses spec §15.3's listed order, so that no claimer (ccrc wrappers, doctor's _fix_wrappers, an install) ever sees a codex row over a foreign launcher.
- **⟦D:update-pause-is-fleet-scoped⟧** (B3). R-O6's per-lane-window auto-update pause is taken fleet-wide (auto off on scope '*' through the PWA) instead of for the one box, because a per-node pause is reachable only through the session-gated API.
- **⟦D:runtime-removed-by-path-on-rollback⟧** (B2). ccgpt-runtime has no verb that removes a generation, so B2's optional rollback (only on the operator's word) removes ~/.ccrc/runtime/codex by path, behind three guards measured in the same call: no codex roster row, no lane <tier>.started record, and no process argv naming the directory. This departs from spec §5.2's 'ccgpt-runtime owns ~/.ccrc/runtime/codex/ whole'.
- **⟦D:flat-foreign-timer-warns-until-lane-one-flips⟧** (B3/B4). Under the lane-2-first order, doctor's codex row after lane 2's flip is one WARN for the still-enabled, unattributable flat ccgpt-usage.timer (lane 1's publisher), not PASS, and this is accepted until lane 1's own flip disables that timer.
- **⟦D:first-turn-watch-may-outlive-the-window⟧** (B3). An un-parked session that has not yet taken its first turn on the lane may, at the operator's word, hand its first-turn watch (critic #20's failed-first-turn rollback trigger) to B4's soak instead of holding the lane window open.

**Part B execution-ledger slugs** (minted only when they fire, during the runbook): `runtime-built-before-the-roster-flip`, `lane-without-a-registry-inits-after-the-flip`, `both-foreign-usage-timers-retired-per-lane` (carried from Plan 3a), and `second-lane-first-accepts-z4-refusals` (fires only if the operator rules R-O1 = lane 2 first).

## Appendix: the controller rulings this plan cites

The drafting rulings (S1–S2, A-1–A-8, B-1–B-10, F1–F6) and the reconciliation rulings (N1–N4, R1–R18) were settled in the controller's scratch before this plan was assembled; every task above already states the ruling it applies. The ones a reader needs to evaluate the plan:

- **Scope (S1).** Part A is one inert code PR, executed subagent-driven; Part B is a live runbook the controller session executes with the operator present, never dispatched to a subagent, every live act under a named authorisation.
- **Order (B-1).** One per-lane procedure (B3), order-agnostic; the recommendation is lane 2 first; the operator rules R-O1 at plan review.
- **Entry file, never `ccgpt` (B-3); lane-explicit foreign stop (B-4).**
- **No unit Environment is ever read (R3); `~/.cc-sessions` is read, never written (R2).**
- **Never roll out by hand (ruling 2026-09-30); the update pause is the operator's (B-6).**
- **Drafting-time incident (R15):** one drafter ran `ccrc version` against the real HOME once while measuring. It is a pure read and changed nothing; recorded here because the drafting rules forbade it.
