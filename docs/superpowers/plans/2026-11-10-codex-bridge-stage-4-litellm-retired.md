# Codex bridge Stage 4: LiteLLM retired Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A box whose Codex lanes all run `direct` needs no LiteLLM environment, a new lane starts `direct`, the
runtime can be removed from a box by one verb, and after that `litellm` mode can leave the tree.

**Architecture:** Three waves, each shipped and measured before the next. Wave 4a removes every dependency a `direct`
lane still has on the LiteLLM runtime, and changes nothing for a `litellm` lane. Wave 4b adds the one act that removes
the runtime from a box. Wave 4c deletes `litellm` mode and is planned in its own document once 4b has run on the
reference fleet. The roster stays the one authority for a lane's mode, `lane.json` stays its projection, and no reader
changes what an absent `exec.bridge` means.

**Tech Stack:** bash (`ccd/ccrc`, `ccd/ccrc-doctor-checks`, `ccd/ccrc-models-probe`), stdlib Python
(`ccd/ccgpt-usage.py`, `deploy/measure-codex-watch.py`), Node ESM (`deploy/account-op.mjs`, `shared/roster-json.mjs`),
systemd unit files, vitest 5 in fixture HOMEs.

**Spec:** `docs/superpowers/specs/2026-10-15-codex-bridge-design.md`: §2.1 (the two per-lane switches), §2.6 (the
callers' table), §2.8 ("A lane leaves LiteLLM after 7 days on `direct` ... The LiteLLM environment is removed once both
lanes have passed") and Figure 5. The Stage 2 plan,
`docs/superpowers/plans/2026-10-22-codex-bridge-stage-2-bridge.md`, holds the operator runbook this plan continues
(steps 5 to 7) and the records of both lanes' switches.

## In short

- Both lanes of the reference fleet are recorded on `direct` since 2026-10-27. The watch that decides whether they
  leave LiteLLM ended on 2026-11-03, and its result is recorded nowhere. Task 0 builds the instrument that takes the
  readings in one run, so the operator can rule.
- A `direct` lane still leans on the LiteLLM runtime in six places. None is the request path. Wave 4a moves each one
  off, in an order that keeps every intermediate build healthy on a box with the runtime and on a box without it.
- The first safety fix is merged ahead of this plan: a switch back to `litellm` on a box with no runtime is refused
  before anything is stopped (Task 1).
- Removing the runtime from a box is one operator act (wave 4b). Until then the way back, `ccrc codex switch <id>
  litellm`, works as it does today.
- Stage 3 (the `siwc` upstream) is independent of all of this. It waits on the operator's trial sign-in.

## What exists today

Measured on `main` at `d452cfc35` (2026-11-10). A `direct` lane's bridge tier, its start, stop, status and sign-in
already need no runtime. These still do:

| # | What | Where | What happens with no runtime |
|---|---|---|---|
| 1 | The catalogue probe's interpreter | `ccd/ccrc#_models_probe_codex_env` exports `CCRC_CODEX_PYTHON` from `ccgpt-runtime python`; `ccd/ccrc-models-probe#_fetch_codex_lane` refuses `runtime-absent` | The hourly refresh row fails, the catalogue reads stale, auto-advance stops, `ccrc-models.service` exits 1 |
| 2 | The usage poll's interpreter | `deploy/systemd/ccrc-codex-usage@.service`, `ExecStart=%h/.ccrc/runtime/codex/current/bin/python -I ...` | Every poll fails to exec and the lane's limits row goes stale |
| 3 | The runtime build at install | `ccd/ccrc#_inst_codex_runtime`, gated on `exec.kind`, never on the mode | It builds a runtime nobody uses |
| 4 | The doctor and its fix | `ccd/ccrc-doctor-checks#_dr_cx_runtime`, `#_dr_cx_bins`, `#_fix_codex` steps 2 and 3 | FAIL `no isolated LiteLLM runtime is current`, so `ccrc update` exits 3; `--fix` rebuilds it |
| 5 | The sign-in's install check | `ccd/ccrc#_acct_install_codex` runs the probe's `--check` on the runtime's interpreter | A lane cannot be signed in again |
| 6 | Adding a lane | `ccd/ccrc#_acct_codex_pick` and `#_acct_install_codex` refuse `codex-runtime-absent`; `deploy/account-op.mjs#addedEntry` writes no `bridge` key | A new lane cannot be added, and when it can it is a `litellm` lane |

Not on the list, measured while building Task 5: the hourly render of a lane's `litellm.yaml` needs no runtime. It
is a pure render, so it keeps running on a `direct` lane and a switch back still finds the file current.

Facts the tasks rest on:

- `ccgpt-usage.py` has imported nothing of LiteLLM since Stage 1. Only its unit names the runtime's interpreter.
- The probe's inline program is stdlib plus the auth library, and already runs under `-I`.
- The system `python3` is already required on every box with a Codex lane: the auth library runs under it for
  `ccrc codex login` and for every status read.
- `exec.bridge` has one programmatic writer, the `codex-mode` op of `deploy/account-op.mjs`. It deletes the key for
  `litellm` and writes only `direct`. Every reader resolves an absent key to `litellm`.
- No file under `ccd/` may read `exec.bridge` from the roster (`single-definition/late-census.test.ts`). Bash reads
  the mode from the rendered `lane.json`, and an unreadable mode is a refusal, never a default.
- `exec.litellmPort` is required by the server, the agent, every Node tool and bash. This plan keeps it.
- Any edit to `ccgpt-proxy.py`, `ccgpt-auth.py` or the bridge package restarts every running bridge at the next
  update, behind a 5-second drain.

## Rulings this plan asks of the operator

Each has a recommendation. None blocks wave 4a's first tasks.

1. **Stage 4 before Stage 3.** The design's Figure 5 draws Stage 3 first, and §2.8's text needs only that both lanes
   pass. Stage 3 waits on the trial sign-in, which is independent. Recommendation: Stage 4 goes first.
2. **Each lane's watch verdict**, from Task 0's readings (runbook step R1). lane-a has no baseline of its own defined:
   it was switched six hours into lane-b's watch (the Stage 2 plan's record of the second lane's switch).
   Recommendation: judge both lanes on the criteria that need no baseline, and both together on the two that do.
3. **New lanes start `direct`** (Task 7). **Ruled 2026-11-10: yes, always.** `account add` writes a `direct` lane,
   and no longer waits for the watch verdict.
4. **When the runtime leaves the fleet box** (R4). Recommendation: after the 4a build has run there for a week with
   the doctor green, the usage rows fresh and the hourly refresh clean.
5. **The catalogue probe's identity.** The design's D27 has ccrc name itself on the backend route. The bridge and the
   usage poll do. The models probe still presents as the Codex CLI. Changing it is one live request the runbook would
   have to cover, so it is out of this plan unless the operator rules it in.
6. **The leftovers on the fleet box** (the ownership spec's §23.8): another repository's LiteLLM environments, old
   logs and snapshots. This plan never touches them.

## Global Constraints

- Tests run in fixture HOMEs only. Nothing here is run against a live host, and no runbook step is run by an agent
  unless the operator says so for that step.
- An absent `exec.bridge` means `litellm` in every reader until wave 4c. No reader's default changes.
- `exec.litellmPort`, the tier vocabulary, the unit names in `lane.json` and the gateway key's file and line stay as
  they are. Wave 4c decides each.
- No bash line reads `exec.bridge` from the roster. A question about the roster's modes is asked of a Node op.
- Every guard ships with a test that fails when the guard is removed, run before and after.
- One pull request per task. A task that changes a `litellm` lane's behaviour is out of scope and is reported.
- The repository is public: lanes are `lane-a` and `lane-b`, hosts are roles.

## Review Focus

1. **A box with only `direct` lanes and no runtime.** `ccrc update` exits 0, the doctor is green, the hourly refresh
   row is clean, and the usage row is fresh. Tests: Tasks 2 to 6 each assert their part on a fixture with
   `runtime: false`.
2. **A mixed box.** One `litellm` lane and one `direct` lane: the runtime is still built, checked and repaired, and
   nothing changes for the `litellm` lane. Tests: Task 4 and Task 5, a mixed-roster case each.
3. **A roster the install step cannot read.** The runtime step degrades by name as it does today. It never treats
   "cannot tell" as "no lane needs it". Test: Task 4, "an unreadable roster is NOT BUILT, never none".
4. **The way back.** With the runtime present a switch to `litellm` works as today. With it absent the switch is
   refused before a tier is stopped. Test: Task 1 (merged).
5. **A rollback to a build before wave 4a on a box whose runtime was removed.** Lanes keep serving, the doctor of the
   older build FAILs the runtime row, and its `--fix` rebuilds the runtime. Test: none in this tree, because the
   older build is not in it. The removal verb prints the sentence (Task 9), and the runbook says it (R4).

## Task 0: the watch's instrument

**Files:**
- Create: `deploy/measure-codex-watch.py`
- Test: `server/test/measure-codex-watch.test.ts`

**Interfaces:**
- Consumes: the bridge's stats file (version 1, `ccd/codexbridge/stats.py`), the lane's `lane.json`, the auth
  library's status file, the lane's `litellm.log`, and Claude Code transcripts.
- Produces: one report, as text or `--json`, that a person pastes into the Stage 2 plan's record.

It follows the contract of `deploy/measure-working-state.py`: read-only, run by hand on the fleet box as the fleet
user, and what leaves is counts.

```
python3 -I deploy/measure-codex-watch.py --lane <id> --flip <UTC stamp> [--baseline-since <UTC stamp>]
        [--until <UTC stamp>] [--home <dir>] [--json]
```

- `--flip` is when the lane went `direct`. `--baseline-since` defaults to seven days before it. `--until` defaults to
  now. Stamps are `YYYY-MM-DDTHH:MM[:SS]Z`.
- **What it reads, and nothing else.** `<home>/.ccrc/codex/<id>/lane.json` (the mode, the auth directory and the
  files' names), `bridge.stats.json`, the auth status file (never the credential), `<home>/.ccrc/logs/codex/<id>/
  litellm.log`, the lane's advance and windows files under `<home>/.ccrc/models/`, and every
  `<home>/.claude*/projects/*/*.jsonl`. From a transcript row it reads `type`, `subtype`, `timestamp`, `uuid`,
  `isSidechain`, `isApiErrorMessage`, `version`, `compactMetadata.trigger`, `compactMetadata.preTokens`, `message.id`
  and `message.model`, never a row's text.
- **What leaves.** Counts, rates, stamps, model names, and the names the bridge's drift counters already hold. No
  session id, path, prompt or request id.
- **The five criteria**, each `pass`, `fail` or `unmeasured` with its numbers, as the Stage 2 runbook's step 5 words
  them:
  1. `outcomes.emptyArguments` is 0.
  2. The 5xx rate, 5xx / (2xx + 5xx) on both sides: the stats file's outcomes against the `POST /v1/messages` lines
     of `litellm.log`, query string stripped. `count_tokens` lines and 4xx are printed and stay out of both rates, as
     do `client-gone` and `drain-cut`. It fails only when the watch's rate is higher and the exact one-sided
     conditional binomial test gives p < 0.05. Both rates carry exact 95% intervals.
  3. The compaction rate, on the main thread only, against a comparable baseline: the baseline is cut at the last
     class advance or window change before the flip. Each model's baseline rate is weighted by the watch's calls,
     and the reading fails only when the watch's boundaries exceed that expectation and the one-sided Poisson test
     gives p < 0.05. It reads `unmeasured` when the compaction point moved more than 10%, or when the comparable
     baseline holds fewer than 5 sessions or 20 boundaries. The box scope, a paired reading and the version mix are
     context.
  4. The credential, in the auth library's own vocabulary. It fails when the library's `bars` refuses the status,
     when the code is in `NEEDS_SIGNIN_CODES` or `CONFIG_ERROR_CODES`, with no credential, with an expired token, or
     when the last refresh is older than half the token's life plus 900 s. Any other code is context.
  5. The drift counters: every family's `unexplained` list is empty.

  Every window event goes in the report's `events`, and the store's cumulative `store:*` outcomes go beside the
  bridge. The instrument's docstring holds the full rules.
- **Unmeasured is never pass.** A file that is absent, unreadable or of another version, a log with no line the
  reader recognises, and a window with no assistant call each read `unmeasured`, with the reason.
- **The baseline window is the operator's to choose.** The lanes' measured windows were applied on 2026-10-22, five
  days before the switch, and a wider window alone lowers the compaction rate. A baseline that starts before that
  date compares two different systems, so the report prints the window it used beside every rate.

- [ ] **Step 1: Write the failing tests.** A fixture home with a stats file, a status file, a log and two
  transcripts, and these cases: the five criteria on a passing fixture; each criterion failing alone; each input
  absent reads `unmeasured`; a transcript row answered by a Claude model is not counted; an assistant call that
  appears in two files is counted once; a manual compaction is not counted; `--json` parses and carries the same
  numbers; and the sentinel case, in which every string the fixture plants in a prompt, a path and a session id is
  absent from both outputs.
- [ ] **Step 2: Run them and see them fail** (`./node_modules/.bin/vitest run test/measure-codex-watch.test.ts`).
- [ ] **Step 3: Write `deploy/measure-codex-watch.py`**, stdlib only, every file opened read-only.
- [ ] **Step 4: Run the tests and see them pass.**
- [ ] **Step 5: Commit.**

## Wave 4a: a `direct` lane needs nothing from LiteLLM

### Task 1: a switch asks for the incoming mode's interpreter before it stops a tier

Merged ahead of this plan, because it protects the way back on any box. `ccd/ccrc#_codex_mode_interpreter` owns the
question; `ccd/ccrc#_codex_cmd_switch` asks it of the incoming mode before its first stop, and the start verb asks the
same owner. Tests: two cases in `server/test/ccrc-codex-bridge.test.ts`.

### Task 2: the catalogue probe runs without a runtime

**Files:**
- Modify: `ccd/ccrc` (`_models_probe_codex_env`), `ccd/ccrc-models-probe` (`_fetch_codex_lane`'s header and its
  refusal sentence)
- Test: `server/test/models-probe.test.ts`, `server/test/ccrc-models.test.ts`

**Interfaces:**
- Consumes: `_codex_python` (the system `python3` at 3.9 or later, absolute path, rc 1 with one line).
- Produces: on a `direct` lane `CCRC_CODEX_PYTHON` is the system `python3`, and with none usable the lane library's
  own `python-absent` or `python-too-old` line is the refusal, ending "Nothing was probed.". On a `litellm` lane, and
  on a lane whose mode cannot be read, it is the runtime's interpreter, empty when none resolves, as before.

The choice follows the lane's mode, and that changed while this task was built. The first draft took the runtime's
interpreter whenever one resolved and fell back otherwise. Two things spoke against it. The probe's tests hold, on
purpose, that a `litellm` lane never falls back to an interpreter the runtime did not resolve. And a `direct` lane
that keeps using the runtime's interpreter until the day the runtime is removed would meet its new path only on that
day. By mode, a `litellm` lane is unchanged, and a `direct` lane runs its probe under the system `python3` from the
first rollout, a week before the runtime leaves (R3).

- [ ] **Step 1: Write the failing tests** in `ccrc-models.test.ts`, on a `direct` lane: "a direct codex lane with no
  runtime probes under the system python3: the catalogue is written"; "a direct codex lane with a runtime on the box
  still probes under the system python3, never the runtime's"; "a direct codex lane with no usable python3 refuses
  python-absent, and nothing is probed".
- [ ] **Step 2: Run them and see them fail** (`runtime-absent` today).
- [ ] **Step 3: Implement.** `_models_probe_codex_env` reads the lane's mode and, for `direct`, takes
  `_codex_python "Nothing was probed."`. `_fetch_codex_lane` is unchanged but for its header.
- [ ] **Step 4: Run the tests and see them pass.** The existing `litellm` cases, "handed no interpreter it refuses
  runtime-absent" among them, pass unchanged.
- [ ] **Step 5: Commit**, with the README's sentence on the probe's interpreter.

### Task 3: the usage poll runs on the system `python3`

**Files:**
- Modify: `deploy/systemd/ccrc-codex-usage@.service`
- Test: `server/test/ccrc-install-units.test.ts`, `server/test/ccgpt-usage.test.ts`

**Interfaces:**
- Produces: `ExecStart=/usr/bin/env python3 -I %h/.local/bin/ccgpt-usage.py`, and no `LITELLM_LOCAL_MODEL_COST_MAP`
  line.

The unit's comment gives the old reason: the publisher imported LiteLLM, and the box's `python3` could import another
copy from the user site. The publisher has not imported it since Stage 1, and `-I` keeps the user site out.

- [ ] **Step 1: Write the failing tests.** "the usage unit runs the system python3, isolated, and names no runtime
  path" (the exact `ExecStart`); "the publisher imports no third-party module" (run it under `python3 -I -S` in a
  fixture with an import hook that fails on any module outside the standard library and the auth library).
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement**, and rewrite the unit's comment to say what is true now.
- [ ] **Step 4: Run the tests and see them pass.**
- [ ] **Step 5: Commit.**

### Task 4: install builds the runtime only for a lane that needs it

**Files:**
- Modify: `deploy/account-op.mjs` (a read op), `ccd/ccrc` (`_inst_codex_runtime`)
- Test: `server/test/account-ops.test.ts`, `server/test/ccrc-install-codex.test.ts`

**Interfaces:**
- Produces: `node deploy/account-op.mjs codex-modes --file <roster>` prints one line per Codex lane, `<id> <mode>`,
  each mode resolved by the roster's own parser, and exits 0; a roster it cannot read exits non-zero with the
  parser's sentence. `_inst_codex_runtime` builds when any line reads `litellm`.

- [ ] **Step 1: Write the failing tests.** For the op: a roster with one row of each kind prints the two Codex rows
  with their resolved modes, an absent key as `litellm`; an invalid roster exits non-zero. For the install step:
  "only direct lanes: codex runtime: none, and `ccgpt-runtime build` is not run"; "a litellm lane beside a direct
  one: built as today"; "an unreadable roster is NOT BUILT, never none"; "a runtime already on the box is left
  alone when no lane needs it" (its generation and stamp unchanged).
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** The step's first line for the new case is
  `install: codex runtime: none — no codex lane runs in litellm mode`.
- [ ] **Step 4: Run the tests and see them pass.**
- [ ] **Step 5: Commit.**

### Task 5: the doctor and its fix ask for the runtime only when a lane needs it

**Files:**
- Modify: `ccd/ccrc-doctor-checks` (`_dr_cx_runtime`, `_dr_cx_bins`, `_fix_codex`)
- Test: `server/test/ccrc-doctor-codex.test.ts`

**Interfaces:**
- Consumes: Task 4's `codex-modes` op.
- Produces: with no lane in `litellm` mode, the runtime row asks nothing of the runtime and the check's line reads
  `runtime not needed (no codex lane runs in litellm mode)`, whether or not one is present, and `--fix` neither
  checks nor builds one. When the modes cannot be told, the row and the fix are the ones they always were.
  `_dr_cx_bins` is unchanged: `ccgpt-runtime` is still one of the five executables every install places.

- [ ] **Step 1: Write the failing tests.** The runtime row alone, with the question answered by table and a
  `ccgpt-runtime` whose `check` answers `absent`: no lane in `litellm` mode gives no finding and never asks the
  runtime; a lane in `litellm` mode, and "cannot tell", each give the FAIL it always was. The fix: with no lane in
  `litellm` mode a refused runtime is neither checked nor rebuilt; "cannot tell" rebuilds as before; and the fix
  refuses when the question is not loaded.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and see them pass.**
- [ ] **Step 5: Commit.**

### Task 6: a `direct` lane's sign-in asks nothing of the runtime

**Files:**
- Modify: `ccd/ccrc` (`_acct_install_codex`)
- Test: `server/test/ccrc-account-codex-add.test.ts`

**Interfaces:**
- Produces: `_codex_probe_python <id> [<how a direct lane's refusal ends>]`, the one owner of "which interpreter
  runs this lane's probe", which Task 2's `_models_probe_codex_env` and `_acct_install_codex` both ask. A sign-in on
  a `direct` lane checks under the system `python3` and is not refused `codex-runtime-absent`; with no usable
  `python3` it is refused `codex-check-unrun`, an existing code, so the console needs no new word. A `litellm`
  lane's sign-in is unchanged.

- [ ] **Step 1: Write the failing tests.** "a direct lane with no runtime checks the sign-in under the system
  python3 and installs it"; "a direct lane with a runtime on the box still checks under the system python3"; "a
  direct lane with no usable python3 is `codex-check-unrun`, never told to build a runtime, and nothing is sent".
  The existing "no runtime is `codex-runtime-absent`" case holds for a `litellm` lane, unchanged.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and see them pass.**
- [ ] **Step 5: Commit.**

### Task 7: a new lane starts `direct`

Ruling 3 is made, so this is built.

**Files:**
- Modify: `deploy/account-op.mjs` (`check-add`'s plan), `ccd/ccrc` (`_acct_codex_pick`),
  `pwa/src/fleet/accountWords.ts`, `README.md`
- Test: `server/test/ccrc-account-codex-add.test.ts`, `server/test/ccrc-account.test.ts`,
  `pwa/test/chatgpt-sheet.test.tsx`

**Interfaces:**
- Produces: a new Codex row carries `exec.bridge: "direct"`, written explicitly. `_acct_codex_pick` asks for
  `_codex_python` where it asked for the runtime, and still draws two ports, because `exec.litellmPort` stays
  required.

- [x] **Step 1: Write the failing tests.** "a new codex row is written with bridge direct"; "add with no runtime and
  a python3 at 3.9 succeeds"; "add with no usable python3 refuses `codex-python-absent`"; the PWA's refusal words for
  the new code.
- [x] **Step 2: Run them and see them fail.**
- [x] **Step 3: Implement.**
- [x] **Step 4: Run the tests and see them pass.**
- [x] **Step 5: Commit.**

The PWA keeps its words for `codex-runtime-absent`: a fleet host on an older build still answers it.

### Task 8: the README and the usage text say what is true

**Files:**
- Modify: `README.md` ("A ChatGPT/Codex lane", "Model classes per lane", the doctor table), `ccd/ccrc` (the `codex`
  usage text)
- Test: `server/test/ccrc-cli.test.ts`, `server/test/readme-roster-mirror.test.ts`

- [ ] **Step 1: Re-pin the usage text's cases, see them fail.**
- [ ] **Step 2: Rewrite the sentences** that say the probe needs the runtime, that sign-in runs through it, and that
  install builds one for any Codex lane.
- [ ] **Step 3: Run the tests and see them pass. Commit.**

## Wave 4b: the runtime leaves a box

### Task 9: `ccrc codex runtime remove`

**Files:**
- Modify: `ccd/ccrc` (`cmd_codex`, a new `_codex_cmd_runtime`, and `_uninst_codex`, whose removal it shares)
- Test: `server/test/ccrc-codex-bridge.test.ts`, `server/test/ccrc-uninstall.test.ts`

**Interfaces:**
- Consumes: Task 4's `codex-modes` op, `_codex_tier_ours`.
- Produces: `ccrc codex runtime remove` removes `~/.ccrc/runtime/codex` and nothing else, and says so in one line
  that also says how to go back: `ccgpt-runtime build` before a switch to `litellm`, and after a rollback to a build
  from before the runtime became optional, which that build's `ccrc doctor --fix` runs. It is refused, with nothing
  removed, as `lane-needs-runtime` (naming each lane the roster resolves to `litellm`, with its switch),
  `modes-unreadable`, `tier-running` (a LiteLLM or shim tier of any lane still runs, whatever the roster says) or
  `tier-unmeasured`. With no runtime on the box it answers `already absent` and exits 0. It holds the roster
  writers' lock while it asks and removes, so no switch records a lane back to `litellm` between them. A lane's
  `litellm.yaml` stays: it is a pure render the hourly refresh keeps current, so a lane switched back after a
  rebuild finds it there.

- [ ] **Step 1: Write the failing tests**, one per refusal, the removal itself with a bridge left serving,
  `already absent`, the usage forms, and "the uninstall and the verb remove through one function".
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** The removal is `_uninst_codex`'s, moved into `_codex_runtime_rm`, and the roster
  writers' lock is the switch's, moved into `_codex_roster_lock` (both in #2593, a move with no change in
  behaviour), so the verb's own change stays under the growth limit on `ccd/ccrc`.
- [ ] **Step 4: Run the tests and see them pass.**
- [ ] **Step 5: Commit.**

### Task 10: status says there is no runtime

Not needed, measured while building Task 9: `ccrc codex status <id>` already prints `runtime absent` and its
`--json` carries `runtime.generation: null` when no runtime resolves. Whether the box needs one is the doctor's
line (Task 5).

## The cutover runbook (the operator's steps, not tasks)

Nothing here is run by an agent unless the operator says so for that step.

**R1. Take the watch's readings.** On the fleet box, for each lane, with the stamp of its switch from the Stage 2
plan's records. lane-b switched first (06:26:03Z) and lane-a six hours later (12:32:04Z), so each stamp is its own
lane's:

```
python3 -I ~/ccrc/deploy/measure-codex-watch.py --lane lane-b --flip 2026-10-27T06:26:03Z --baseline-since 2026-10-22T10:48:00Z
python3 -I ~/ccrc/deploy/measure-codex-watch.py --lane lane-a --flip 2026-10-27T12:32:04Z --baseline-since 2026-10-22T10:48:00Z
```

Read `ccrc doctor`'s `codex` row and `ccrc codex status <id> --json` beside them. The readings and the verdict go in
the Stage 2 plan's record, as its step 7 says.

**R2. Roll out the build that carries wave 4a**, fleet box first. Every running bridge restarts once, behind its
5-second drain.

**R3. A week with the runtime still present.** The doctor stays green, both usage rows stay fresh, and the hourly
refresh stays clean. The way back at any point is `ccrc codex switch <id> litellm`.

**R4. Remove the runtime.** `ccrc codex runtime remove`, then `ccrc doctor` and `ccrc codex status <id>` for each
lane. From here the way back is `ccgpt-runtime build` first, then the switch. A rollback to a build before wave 4a
leaves the lanes serving and that build's doctor asking for the runtime; its `--fix` rebuilds it.

**R5. Record it**, and open wave 4c's plan.

## Wave 4c: `litellm` mode leaves the tree (outline)

Its own plan, written when R4 has held on the reference fleet. What it has to decide:

- **A row with no `bridge` key.** Every such row is a `litellm` lane to this build and to any older one. Options: the
  install writes `direct` into it once; or a start refuses it by name and the doctor says how to move it.
- **`exec.litellmPort`.** Every reader on both boxes must accept its absence before any writer omits it, and a
  rollback below that release then refuses the roster. It may simply stay, reserved.
- **What is deleted**: `ccd/ccgpt-runtime`, the shim's relay in `ccd/ccgpt-proxy.py` (the bridge keeps the hooks it
  imports), `shared/litellm.mjs`, `deploy/litellm-config.template.yaml`, `ccrc models litellm`, the LiteLLM and shim
  tiers, and the auth library's LiteLLM-only door.
- **What keeps its name**: the gateway key's file `runtime.env` and its line. Four readers and one writer share the
  grammar, and a rename buys nothing.
- **The tests.** About 20,000 lines of suites and fixtures default to a `litellm` lane.

## Deviations found

None yet. A deviation's number is issued by the ledger door when this programme's run opens. Until then a finding is
reported in the pull request that met it.

## Where things stand

**Done:** Task 0 (#2572), Task 1 (#2569), Task 2 (#2586), Task 3 (#2573), Task 4 (#2575), Task 5 (#2588),
Task 6 (#2595), Task 8 (the README) and Task 9 (#2593, #2590). Task 10 needed no change. The first release that
carries all of it is the one cut from Task 9's merge.

**Task 0 was revised after its first live readings (2026-11-10).** Every failing reading came from the
instrument's comparison, not from the lane. The 5xx rate counted `count_tokens` in the baseline only. The compaction
rate compared a baseline taken mostly at the larger context window with a watch taken entirely at the smaller one.
The credential failed on a stale upstream code. All three now measure like for like, and `unmeasured` still holds
the stage.

**Still to build:** wave 4c, which waits for R4. Task 7 is built: a new lane starts `direct`.

**The operator's:** R1 to R5. R1 needs nothing but a build at or after v0.0.1076 on the fleet box.

**Open questions for the operator:** the six rulings above, most important first: 2 (the verdict), 1 (the order of
the stages), 3 (new lanes), 4 (when the runtime leaves).
