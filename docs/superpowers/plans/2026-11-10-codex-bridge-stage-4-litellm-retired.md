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
| 5 | `litellm.yaml` kept current | the refresh arm of `ccd/ccrc#_models_box_sub`, `#_models_litellm` | The lane's refresh row fails |
| 6 | Adding or re-signing a lane | `ccd/ccrc#_acct_codex_pick` and `#_acct_install_codex` refuse `codex-runtime-absent`; `deploy/account-op.mjs#addedEntry` writes no `bridge` key | A new lane cannot be added, and when it can it is a `litellm` lane |

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
3. **New lanes start `direct`** (Task 7). Recommendation: yes, once the verdict is in. Until then `account add` keeps
   writing a `litellm` lane.
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
  litellm.log`, and every `<home>/.claude*/projects/*/*.jsonl`. From a transcript row it reads `type`, `subtype`,
  `timestamp`, `uuid`, `isSidechain`, `isApiErrorMessage`, `compactMetadata.trigger`, `message.id` and
  `message.model`, never a row's text.
- **What leaves.** Counts, rates, stamps, model names, and the names the bridge's drift counters already hold. No
  session id, path, prompt or request id.
- **The five criteria**, each `pass`, `fail` or `unmeasured` with its numbers, as the Stage 2 runbook's step 5 words
  them:
  1. `outcomes.emptyArguments` is 0.
  2. The 5xx rate, `outcomes.5xx` over the sum of `routes.*.requests`, against the baseline's rate from
     `litellm.log`. `client-gone` and `drain-cut` are shown and stay out of the rate.
  3. The compaction rate in the baseline window against the watch window: automatic `compact_boundary` rows over
     assistant calls, deduplicated by `message.id`, for rows a GPT model answered.
  4. The credential: the status file's state, its last error code, and how long ago it last refreshed.
  5. The drift counters: every family's `unexplained` list is empty.
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
- Produces: `CCRC_CODEX_PYTHON` is the runtime's interpreter when one resolves, else the system `python3`. Empty only
  when neither resolves.

The choice is mode-blind on purpose: the program is the same under either interpreter, a box with a runtime keeps
today's path byte for byte, and no mode has to be readable at this point.

- [ ] **Step 1: Write the failing tests.** In a fixture with `runtime: false` and a `direct` lane: "the hourly
  refresh on a direct lane probes with the system python3 when no runtime resolves" (the row is clean and the
  catalogue is written); "with a runtime, the probe still runs on the runtime's interpreter" (the fake runtime
  python records its argv); "with neither, the probe refuses `python-absent`, never `runtime-absent`".
- [ ] **Step 2: Run them and see them fail** (`runtime-absent` today).
- [ ] **Step 3: Implement.** In `_models_probe_codex_env`, when `ccgpt-runtime python` answers nothing, take
  `_codex_python`'s answer with its refusal silenced. In `_fetch_codex_lane`, the empty-interpreter refusal becomes
  `python-absent`, naming both remedies.
- [ ] **Step 4: Run the tests and see them pass**, with `models-probe.test.ts`'s existing "handed no interpreter"
  case re-pinned to the new word.
- [ ] **Step 5: Commit.**

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
- Produces: with no lane in `litellm` mode, the runtime row reads `ok: no codex lane runs in litellm mode, so no
  LiteLLM runtime is needed` whether or not one is present, and `--fix` builds none and renders no `litellm.yaml`.

- [ ] **Step 1: Write the failing tests.** "direct lanes only, no runtime: the codex check is green"; "direct lanes
  only, `--fix` runs no build"; "one litellm lane and no runtime: FAIL as today"; "the modes cannot be read: the
  row is WARN `could not tell`, never ok".
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and see them pass.**
- [ ] **Step 5: Commit.**

### Task 6: a `direct` lane's refresh and sign-in ask nothing of the runtime

**Files:**
- Modify: `ccd/ccrc` (the refresh arm of `_models_box_sub`, `_acct_install_codex`)
- Test: `server/test/ccrc-models.test.ts`, `server/test/ccrc-account-codex-add.test.ts`

**Interfaces:**
- Produces: on a `direct` lane the hourly refresh renders `litellm.yaml` only while a runtime resolves (so a switch
  back still finds it current), and skips it by name when none does. A sign-in on a `direct` lane runs the probe's
  `--check` through Task 2's interpreter and renders no `litellm.yaml`.

- [ ] **Step 1: Write the failing tests.** "the hourly refresh on a direct lane with no runtime renders no
  litellm.yaml and its row is clean"; "with a runtime it renders as today"; "a sign-in on a direct lane with no
  runtime completes".
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and see them pass.**
- [ ] **Step 5: Commit.**

### Task 7: a new lane starts `direct`

Waits for ruling 3.

**Files:**
- Modify: `deploy/account-op.mjs` (`addedEntry`), `ccd/ccrc` (`_acct_codex_pick`), `pwa/src/fleet/accountWords.ts`
- Test: `server/test/account-ops.test.ts`, `server/test/ccrc-account-codex-add.test.ts`,
  `pwa/test/chatgpt-sheet.test.tsx`

**Interfaces:**
- Produces: a new Codex row carries `exec.bridge: "direct"`, written explicitly. `_acct_codex_pick` asks for
  `_codex_python` where it asked for the runtime, and still draws two ports, because `exec.litellmPort` stays
  required.

- [ ] **Step 1: Write the failing tests.** "a new codex row is written with bridge direct"; "add with no runtime and
  a python3 at 3.9 succeeds"; "add with no usable python3 refuses `python-absent`"; the PWA's refusal words for the
  new code.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and see them pass.**
- [ ] **Step 5: Commit.**

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
- Produces: `ccrc codex runtime remove` removes `~/.ccrc/runtime/codex` and each lane's `litellm.yaml` and its
  `.prev`, keeps every log, and prints what it removed. It is refused, with nothing removed, as `lane-needs-runtime`
  (naming each lane the roster resolves to `litellm`), `tier-running` (a LiteLLM or shim tier of any lane still
  answers), or `modes-unreadable`. With no runtime on the box it answers `already` and exits 0. Its last line says
  that a rollback to a build before wave 4a needs `ccgpt-runtime build`, which that build's `ccrc doctor --fix` runs.

- [ ] **Step 1: Write the failing tests**, one per refusal, the removal itself, `already`, and "uninstall and the
  verb remove through one function".
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** The removal is `_uninst_codex`'s, moved into one function both call.
- [ ] **Step 4: Run the tests and see them pass.**
- [ ] **Step 5: Commit.**

### Task 10: status says there is no runtime, and that none is needed

**Files:**
- Modify: `ccd/ccrc` (`_codex_cmd_status`)
- Test: `server/test/ccrc-codex-bridge.test.ts`

- [ ] **Step 1: Write the failing test.** "status on a direct lane with no runtime prints `runtime: none (no lane
  needs one)` and `--json` carries `runtime.generation: null`".
- [ ] **Step 2 to 5:** fail, implement, pass, commit.

## The cutover runbook (the operator's steps, not tasks)

Nothing here is run by an agent unless the operator says so for that step.

**R1. Take the watch's readings.** On the fleet box, for each lane, with the stamp of its switch from the Stage 2
plan's records:

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

**Done:** Task 1.

**Needs before it starts:** nothing for Task 0 and Tasks 2 to 6. Task 7 waits for ruling 3. Wave 4b waits for wave
4a on `main`. R1 to R5 are the operator's.

**Open questions for the operator:** the six rulings above, most important first: 2 (the verdict), 1 (the order of
the stages), 3 (new lanes), 4 (when the runtime leaves).
