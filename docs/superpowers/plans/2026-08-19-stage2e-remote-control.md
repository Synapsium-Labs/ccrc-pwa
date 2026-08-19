# Stage 2e — `CCRC_REMOTE_CONTROL` becomes a per-box fact, and the carried fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A box decides at spawn time whether its sessions run `--remote-control` — default OFF for fresh OSS installs, ON preserved for the reference fleet — with the pane heuristics guarded in both modes, the one server-side RC-off hazard (dialog suppression under a busy marker) closed, and the four fixes this slice inherited (A2-NEW, the `ccd version` stamp reader, the shim refusal line, the effective-mode doctor surface) paid in the same branch. The real-VM stage-2 proof gets its runbook and stays the operator's gate.

**Architecture:** The flag is a dedicated file, `~/.ccrc/remote-control`, first line `on`|`off`, absent = off. Chosen over a `ccrc.env` key or an `accounts.sh` line for three cited reasons: ccd takes no env overrides (HOME is its only isolation boundary — ccd/ccd:72-78, restated :91-95), ccd never reads the token-bearing `ccrc.env` (ccd/ccrc:102-105) and `claude-session@.service` carries no `EnvironmentFile=` at all, and the FLEET host — the box ccd runs on — has no `ccrc.env` whatsoever (ccd/ccrc:364-370; deploy ships it server-lane only, deploy.sh:699), so an env-file read with default-off would silently strip RC from the live fleet at the next respawn. The file matches ccd's existing per-box switch idiom (`$REG/<w>-disabled` ccd:191, `AUTOCOMPACT_DISABLE_FILE` ccd:7458). Seed-once both ways: `ccrc install` writes `off` (the spec's OSS default), deploy's FLEET lane writes `on` if absent, ordered BEFORE the ccd install (a new ccd reading an unseeded box must not flip the fleet); neither ever overwrites — the operator owns the file after first seed. Both spawn sites in `_spawn_start` (the primary at ccd/ccd:7862 AND the resume-retry at :7898) condition on one reader function. Mixed-mode is the expected transition state: live sessions keep RC until individually respawned, so `/rc active` STAYS in the ready-marker set and every heuristic must tolerate both vocabularies at once.

**Tech Stack:** bash (ccd/ccd, ccd/ccrc, ccd/ccrc-doctor-checks, deploy/deploy.sh), TypeScript (server/src/sessionws.ts, watch.ts, fleet.ts, inject/send.ts), vitest.

## Global Constraints

- **`ccd/ccd` is editable this slice** (the Build 8 fence is down; verified: zero open PRs, zero unmerged branches, the other session's handoff says nothing in flight). Every commit that edits `ccd/ccd` MUST re-stamp its line-2 provenance marker or `server/test/ownership.test.ts:139-152` reds; the re-stamp command is spelled at `ownership.test.ts:131-135` and `markGenerated` is idempotent. Treat ccd/ccd with the care its role deserves: it supervises the live fleet; every function you touch, read its header comments first and preserve them.
- **NEVER delete `/rc active` from the ready-marker regex** (ccd/ccd:7637) in this slice — pre-flip sessions survive on the live fleet and both pane vocabularies must classify correctly simultaneously. The mode-independent footers (`? for shortcuts`, `shift+tab to cycle`, `← for agents`) already carry the load in production (ccd/ccd:7635-7636's own comment).
- **Honesty about fixtures:** every RC-off pane fixture this slice writes is INVENTED (every capture in `server/test/fixtures/panes/` is RC-on; `ask-user-question-real.txt:7` literally says `/remote-control is active`). Label each invented fixture with a comment saying so and naming the stage gate that will replace it with a measured capture. Never claim live-mode proof from an invented fixture.
- Fixture HOMEs only; never run ccd/ccrc against the live `$HOME`. `WS_ADD_REAL_SPAWN` keeps `_spawn_start` real and logs tmux argv to `$HOME/ccd-calls` — that is the argv-assertion seam. Mutation-table discipline with measured records; TDD red-first; foreground vitest, never npx; suites from inside each package.
- The flag file's path is spelled ONCE in ccd/ccd (a single variable near `CCRC_ACCOUNTS_SH`, ccd:178) and once in each writer (`ccrc install`'s step; deploy.sh's fleet lane); `single-definition.test.ts`'s bash corpus (ccd/ + deploy/) will see all three — check its patterns; if a pin trips, extend deliberately with the named-exclusion idiom.
- `deploy/deploy.sh` edits must respect `agent/test/deploy-verify.test.ts`'s text pins: function-body regexes truncate at a column-1 `}`; ordering assertions locate calls by `indexOf`, so comments must not spell helper names before the call; new fleet-lane code lands between the roster block and the ccd install with its own ordering pin added to the suite.
- Control-byte discipline: `server/test/source-bytes.test.ts:78` scans for raw control bytes — the `←` in any new marker-regex copy is multibyte UTF-8 (fine), but never paste raw ESC/backspace into source or fixtures; build fixture bytes with escapes.
- **Registers and exit tables unchanged** (ccrc: results stdout, `$PROG:` refusals stderr exit 1, usage exit 2, verdict+remedy adjacency; ccd: `die` on stderr). No `set -e` in ccrc, no column-1 `}` mid-function anywhere.
- The 2026-08-13 per-worker-RC ruling (dispatched workers spawn without RC — fleet-robustness-design:1526, build8 plan:88-94, orchestrator task #37) is NOT subsumed by this slice: a per-box flag gives no per-worker granularity. Task 7 records it as remaining open.
- No new dependencies. All three suites green before the branch is done.

## File structure

- `ccd/ccd` — modify: flag reader + both spawn lines (Task 1); `cmd_version` reader split (Task 5); header line :4 doc (Task 2).
- `ccd/ccrc` — modify: `_inst_rc` step (Task 2); `_inst_shim` refusal text (Task 6).
- `ccd/ccrc-doctor-checks` — modify: `_check_config` effective-mode detail (Task 2); `wr_upstream` bucket (Task 4).
- `deploy/deploy.sh` — modify: fleet-lane flag seed (Task 2); `install_ccrc_shim` refusal text (Task 6).
- `server/src/sessionws.ts`, `server/src/watch.ts` — modify: dialog gating via `hasMenu` (Task 3).
- `server/src/fleet.ts`, `server/src/inject/send.ts` — modify: comments only (Task 3).
- `README.md`, `CLAUDE.md` — modify: RC described as per-box config (Task 2); stage-gate runbook pointer (Task 7).
- `docs/superpowers/specs/2026-08-19-stage2-vm-gate-runbook.md` — create (Task 7).
- Tests: `server/test/ccd-spawn-split.test.ts`, `ccd-login-screen.test.ts` (or a new `ccd-rc-flag.test.ts`), `ccrc-install.test.ts`, `ccrc-doctor.test.ts`, `agent/test/deploy-verify.test.ts`, `server/test/sessionws.test.ts`, `watch`-adjacent suites, `ccd-version.test.ts`, `single-definition.test.ts`.

---

### Task 1: The flag exists and both spawn sites obey it

**Files:**
- Modify: `ccd/ccd` (one variable + one reader function near the roster block :178-190; the spawn lines :7862 and :7898; the header :4 stays for Task 2)
- Test: `server/test/ccd-spawn-split.test.ts` (+ the ready-marker guard in `ccd-login-screen.test.ts` or a new `server/test/ccd-rc-flag.test.ts`)

**Interfaces:**
- Produces: `CCRC_RC_FILE="$HOME/.ccrc/remote-control"` (the ONE spelling in ccd) and `_rc_enabled()` — returns 0 iff the file's first line, whitespace-trimmed, is exactly `on`. Absent, unreadable, empty, or any other value → 1 (default off; a garbled file must not half-enable). Bounded read (`read -r` of one line), no external binaries, set-u-safe.
- Consumes: nothing.

- [x] **Step 1: RED — four argv cases.** In `ccd-spawn-split.test.ts`, using the existing `WS_ADD_REAL_SPAWN` + `seed()` + `_spawn_start myid new` pattern (:59-76) and the `RESUME_DIES` two-line pattern (:454-472): (a) no flag file → the `tmux new-session` argv does NOT contain `--remote-control`; (b) flag file `on` → it DOES contain `--remote-control 'myid'`; (c)+(d) the same pair for the resume-retry second spawn line (both lines of the RESUME_DIES sequence checked — the retry at ccd:7898 is the easily-missed copy). All four red today (the flag file changes nothing; `--remote-control` is unconditional).
- [x] **Step 2: GREEN — the reader and the conditional.**

```bash
# beside CCRC_ACCOUNTS_SH (:178) —
CCRC_RC_FILE="$HOME/.ccrc/remote-control"
_rc_enabled() {   # first line 'on' => sessions spawn with --remote-control.
  # A FILE, not an env var (HOME is ccd's only isolation boundary — see
  # SPAWN_GATE_TRIES) and not ccrc.env (never read by ccd: it carries tokens,
  # and the fleet host does not have one). Absent or anything-but-'on' is OFF:
  # a garbled file must not half-enable a mode. Seeded 'off' by ccrc install,
  # 'on' by deploy's fleet lane; operator-owned after that.
  local first=""
  [[ -f "$CCRC_RC_FILE" ]] || return 1
  IFS= read -r first < "$CCRC_RC_FILE" 2>/dev/null || return 1
  [[ "${first//[[:space:]]/}" == "on" ]]
}
```

  In `_spawn_start`, compute once before the spawn: `local rcflag=""; _rc_enabled && rcflag="--remote-control '$id'"` and replace the literal `--remote-control '$id'` with `$rcflag` in BOTH command strings (:7862 and :7898 — the resume-retry too; an empty `$rcflag` collapses to nothing in the composed string exactly as `$sidflag` already does). Update the `_spawn` comment at :7969 ("we pass `--remote-control '$id'`" → conditional wording). Re-stamp ccd's marker (ownership.test.ts:131-135). Run the four tests green + the whole `ccd-spawn-split` + `ccd-spawn-verdict` + `ownership` files.
- [x] **Step 3: RED+GREEN — the ready-marker guards nothing pinned before.** Two tests (in `ccd-login-screen.test.ts`'s PANE_TEXT idiom, :106-178): (a) an INVENTED RC-off ready pane — built from the real captured footer at `statusline.test.ts:9` (`⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents`) plus a busy-free prompt row, no `/rc` anywhere — drives the real `_accept_first_run_prompts` to rc 0 with zero keystrokes (comment: INVENTED fixture; the Stage-2 VM gate replaces it with a measured capture); (b) a source-scan guard pinning that the marker regex still contains ALL FIVE alternatives including `/rc active` (mixed-mode rule) — red measured by deleting one alternative. Both directions recorded.
- [x] **Step 4: Mutations.** (i) revert the conditional at :7898 only (retry hardcodes RC again) → test (d) red alone — proving the second site is independently pinned; (ii) `_rc_enabled` accepting any non-empty file → the garbled-file test red (add it: file containing `ON`/`yes`/`on extra` → off). Record both.
- [x] **Step 5: Commit.** `feat(ccd): sessions spawn with --remote-control only when the box says on (D-99)` — ledger D-99 in this plan: the spec said "CCRC_REMOTE_CONTROL config"; what shipped is a dedicated file, with the three constraint citations (C1/C2/C3) above.

### Task 2: The writers, the doctor surface, and the docs

**Files:**
- Modify: `ccd/ccrc` (`_inst_rc` wired after `_inst_env`), `deploy/deploy.sh` (fleet-lane seed), `ccd/ccrc-doctor-checks` (`_check_config` detail), `ccd/ccd:4` + `README.md` + `CLAUDE.md` (RC described as per-box config)
- Test: `server/test/ccrc-install.test.ts`, `server/test/ccrc-doctor.test.ts`, `agent/test/deploy-verify.test.ts`

**Interfaces:**
- Consumes: Task 1's file semantics.
- Produces: `_inst_rc` (seed-once `off`); deploy fleet-lane block (seed-once `on`, BEFORE the accounts.sh/ccd installs).

- [x] **Step 1: RED+GREEN — `_inst_rc`.** Seed-once exactly like `_inst_env`: dest `$HOME/.ccrc/remote-control`; existing file → `install: remote-control: kept (operator-owned)`; absent → write one line `off` via tmp+mv, `install: remote-control: off (fresh installs default off — edit ~/.ccrc/remote-control to 'on' for claude.ai discoverability)`. Wire after `_inst_env`. Tests: fresh box → file says `off`; pre-existing `on` → byte-identical after re-run; mutation: unconditional overwrite → red.
- [x] **Step 2: RED+GREEN — deploy's fleet lane seeds `on`.** In the agent branch, between the roster block and the accounts.sh install (the ordering matters: flag BEFORE the new ccd lands, so no respawn window sees new-ccd + unseeded box): a remote `[ -e ... ] || printf 'on\n' > ...` guarded block in deploy's own idiom (one ssh, seed-once, never overwrite — mirror `ship_roster`'s shape and comment WHY `on`: the reference fleet ran RC before the flag existed; default-off would strip it silently at the next respawn). Add the deploy-verify pins: the block exists in the agent branch, positioned before the accounts.sh `install_atomic` (indexOf-ordering test in the existing style — and respect the name-shadowing rule: no comment naming the anchor helpers above the code). Mutation: move the seed after the ccd install → ordering pin red.
- [x] **Step 3: RED+GREEN — doctor names the effective mode.** `_check_config`'s PASS detail (and its fleet-role SKIP detail unchanged) gains the measured RC state: read the flag file with the same trimmed-first-line rule (a tiny `_dr_rc_state` helper in doctor-checks — prints `on`/`off (default)`/`off`; no second spelling of the semantic: comment cross-references ccd's `_rc_enabled` as the authority, same pattern as the D-92 unit-dir agreement — add the same style of literal-agreement test comparing the two files' `remote-control` path spelling). PASS example: `config: ccrc.env present, fleet mode local; remote-control off (default)`. Tests: three states pinned; existing config tests updated only in their PASS-detail expectations.
- [x] **Step 4: Docs.** `ccd/ccd:4` header line describes the argv as conditional; README's RC mentions (grep `remote.control|/rc` — README:1252's "a `--remote-control` pane" and the fleet description) reworded to "per-box, `~/.ccrc/remote-control`"; CLAUDE.md:4's fleet line likewise (one clause, no restructuring). None of these lines is test-pinned (readme-holds covers other sections) — verify with the suites anyway.
- [x] **Step 5: Commit.** `feat(install,deploy): the box's remote-control fact is seeded once from either lane, and doctor says what it measured`

### Task 3: Dialogs still surface when the pane is honestly busy

**Files:**
- Modify: `server/src/sessionws.ts:243`, `server/src/watch.ts:2407` (gate via `hasMenu`, the send.ts:320 idiom), `server/src/fleet.ts:100-105` + `server/src/inject/send.ts:935-938` (comments only: "never renders" → mode-dependent wording)
- Test: `server/test/sessionws.test.ts`, the watch dialog suite (locate: `git grep -n 'paneState' server/test`)

**Interfaces:** none.

- [x] **Step 1: RED.** A fixture pane carrying BOTH a live busy line (`fixtures/panes/busy.txt`'s real `esc to interrupt` spinner row) AND a permission dialog with its menu footer — with RC off this is a real, expected pane state. Assert the dialog reaches the sessionws frame and the watch tick. Red today: `paneState()` answers `'busy'` before `'menu'` (dialog.ts:20-21) and both call sites suppress the parse.
- [x] **Step 2: GREEN.** At both call sites replace the `paneState(pane) === 'menu'` gate with the `hasMenu(...)` idiom send.ts:320 uses (`dialog.ts:23-28` documents exactly why `hasMenu` is independent of the busy check). Do NOT change `paneState` itself (its 'busy'-first ordering is load-bearing for its other consumers — check each remaining consumer before claiming none is affected, and list them in the report).
- [x] **Step 3: Regression + comments.** The existing stale-scrollback tests (send.test.ts:342-346, sessionws.test.ts:510, mail-sweep.test.ts:846, livestate.test.ts:76) must stay green — run them by name. Reword the fleet.ts/send.ts comments to mode-aware truth ("a --remote-control pane does not render the busy marker; an RC-off pane does — either way busy-ness comes from the live status file, which also sees subagents"). Mutation: restore the `paneState==='menu'` gate at one site → that site's new test red. Commit: `fix(server): a dialog on a busy pane still reaches the PWA — RC-off panes render both at once`
- [x] **Fix round 1 (D-102).** Step 2's call-site fix left the task's own stated goal unreachable: `parseDialog` (`pane/dialog.ts:142`) re-tests `paneState(pane) !== 'menu'` as its own first line, the identical hazard one layer deeper, inside the file this task's brief fenced OUT of scope. The fence sat on the hazard's real seat — see D-102. Lifted for that one line; `parseDialog` now gates on `hasMenu` too. Commit: `fix(server): parseDialog stops letting the busy marker veto a menu parse (D-102)`

### Task 4: A2-NEW — an absent upstream binary asks for Claude Code, not a roster edit

**Files:**
- Modify: `ccd/ccrc-doctor-checks` (fourth bucket `wr_upstream`; the shared `external|upstream` case arm splits)
- Test: `server/test/ccrc-doctor.test.ts`, `server/test/ccrc-install.test.ts`

**Interfaces:** consumes the D-82 nameref construction (`_dr_wr_present <id> <bucket>`, the deliberate present-but-wrong asymmetry).

- [ ] **Step 1: RED.** (a) Doctor fixture: roster's upstream account with NO file at `$HOME/.local/bin/<id>` → the FAIL line's remedy must match `/install Claude Code/` and NOT `/ccrc adopt/` (today: the roster-sync remedy — red). (b) The e2e the 2d fixtures hid: a `freshBox` variant WITHOUT the fake ELF `claude` (ccrc-install.test.ts:280-285 plants it; build the variant beside it) → the full `ccrc install` transcript's closing doctor prints the install-Claude-Code remedy and exit 1 — the FIRST sentence a fresh-VM operator reads must be actionable.
- [ ] **Step 2: GREEN.** Split the case arm exactly as surveyed: `upstream)` routes `_dr_wr_present "$id" wr_upstream`; `external)` keeps `wr_hard` (somebody else's launcher — nothing to tell them to install); declare `wr_upstream=()` beside the other three (:1070); emit its FAIL line FIRST (before `wr_absent`'s — most-actionable leads), remedy naming `$HOME/.local/bin/<id>` (never hardcode `claude` — the roster names the id):

```
"install Claude Code so its binary lands at \$HOME/.local/bin/<id> — that path is literally what ccd execs, and nothing here installs it for you; then re-run 'ccrc doctor'. If it lives elsewhere, symlink it there"
```

  The dangling-symlink arm rides along (same operator action); present-but-wrong arms stay `wr_hard` for free (hard-wired in `_dr_wr_present`). Extend the header's class list comment. Existing detail-only tests (:1882-1888 etc.) stay green — the detail sentence is unchanged; only the remedy moves.
- [ ] **Step 3: Mutations + commit.** Re-merge `wr_upstream` into `wr_hard` → both Step-1 tests red; recorded. Both-buckets-in-one-run test (absent upstream + a generated-account disagreement → two FAIL lines, distinct remedies, the upstream line first). Commit: `fix(doctor): a fresh box's first sentence is install Claude Code, not edit your roster (A2-NEW)`

### Task 5: `ccd version` stops collapsing four failures into one sentence

**Files:**
- Modify: `ccd/ccd` `cmd_version` (:2096-2118) — split in place (Option A; delegation measurably breaks the vitest harness and a dev checkout, and prints the wrong tool name)
- Test: `server/test/ccd-version.test.ts`, `server/test/single-definition.test.ts` (comment wording only)

- [ ] **Step 1: RED.** Four new cases: python3 absent from PATH → die names python3, not the stamp; stamp unreadable (chmod 000) → die names permission; a DIRECTORY at the stamp path → die "not a regular file" (today: falsely "unstamped"); `"dirty": "false"` (string) → refuses (type check, ccrc's :240-245 rationale). Existing five cases stay.
- [ ] **Step 2: GREEN.** Mirror `_box_build_fields`' condition split inside `cmd_version`'s bash (probe `command -v python3` first; `[[ -e ]]` vs `[[ -f ]]` split; the python heredoc distinguishes parse-failure from missing-field via distinct exit codes; dirty type-checked). Keep the output line format byte-identical on success (deploy.sh:606-609 greps the sha; deploy-verify pins the invocation). Re-stamp ccd's marker. Soften single-definition's :717-724 comment (the named gap is now a deliberate, split, second reader — or note Option B remains the consolidation path); neither holder list moves.
- [ ] **Step 3: Mutations + commit.** Re-collapse to the single die → all four new tests red; recorded. Commit: `fix(ccd): version tells you WHICH thing is broken — python3, permissions, a directory, or the stamp itself`

### Task 6: The launcher's refusal survives a self-installed box

**Files:**
- Modify: `deploy/deploy.sh:152` + `ccd/ccrc:2027` (byte-identical refusal rewrite), `agent/test/deploy-verify.test.ts:1541` (the `/deploy/` pin), optionally both provenance comments (deploy.sh:136 / ccrc:2011 — both or neither)
- Test: `server/test/ccrc-install.test.ts:1224-1248` (the byte-equality pin enforces coordination for free)

- [ ] **Step 1: The four-file coordinated edit** exactly as surveyed: refusal becomes `… so there is nothing for this launcher to run. Re-install: run 'bash install.sh' from a ccrc checkout on this box, or (on a fleet-deployed box) re-run deploy/deploy.sh against it.` — byte-identical in both generators, `if`-form preserved, no column-1 `}`. deploy-verify:1541 relaxes to assert BOTH `/install\.sh/` and `/deploy/` (the refusal must name both lanes), message string updated. If the provenance comments change, both change.
- [ ] **Step 2: Verify + commit.** ccrc-install byte-equality green; deploy-verify behaviour tests green; mutation: edit ONE generator → byte pin red (record). Commit: `fix(shim): the launcher's refusal names both ways a box gets its tree`

### Task 7: The stage gate gets its runbook; the ledgers close

**Files:**
- Create: `docs/superpowers/specs/2026-08-19-stage2-vm-gate-runbook.md`
- Modify: this plan's ledger; `README.md` (one pointer line in the install section)

- [ ] **Step 1: The runbook** — the operator's fresh-VM proof, honestly scoped: provision (Ubuntu ≥ node floor per server/package.json), clone, `bash install.sh`, expected first-run doctor state (RED on wrappers with the install-Claude-Code remedy until Claude Code is installed — Task 4's sentence is the UX), install Claude Code, `ccrc doctor` green, `ccd menu` → first session spawns RC-OFF (verify via `ps` argv: no `--remote-control`), PWA answers on 127.0.0.1:7788, under 15 minutes wall-clock. THE DELIVERABLE BEYOND PASS/FAIL: `tmux capture-pane` the RC-off ready pane and check it into `server/test/fixtures/panes/` — retroactively converting Task 1's invented fixture into a measured one (name the fixture file and the test to update). Also: what to do on failure (each doctor remedy is now followable — that was this workstream's point).
- [ ] **Step 2: Ledger close-out.** In this plan: record that the per-worker-RC ruling (orchestrator task #37) remains OPEN and why a per-box flag does not subsume it; the stage gate stays PENDING-OPERATOR with the runbook as its instrument. README's install section gains one line pointing at the runbook.
- [ ] **Step 3: Full suites** (server, agent, pwa — foreground) + commit: `docs(stage2): the VM gate has a runbook and an honest deliverable — a measured RC-off pane`

---

## Deviations found

(Continues the global sequence; next free number at plan time: **D-99** — reserved by Task 1 for the flag-file-not-env-key deviation from the spec's literal `CCRC_REMOTE_CONTROL` wording, with the C1/C2/C3 citations.)

**D-99 — the remote-control switch is a FILE (`~/.ccrc/remote-control`), not the spec's `CCRC_REMOTE_CONTROL` config key.** (Task 1, `ccd/ccd`: `CCRC_RC_FILE` + `_rc_enabled`, read once in `_spawn_start`.)

The spec spelled the switch as a `CCRC_REMOTE_CONTROL` config value — an env-style key, which on this box means a line in `~/.ccrc/ccrc.env`. Three measured constraints make that spelling unimplementable in ccd, and the third makes it actively dangerous:

- **C1 — ccd takes no env overrides, by contract.** `ccd:9-13` states it for `PROJECTS_ROOT`; `SPAWN_GATE_TRIES` (`:72-78`) and `SPAWN_SETTLE_S` (`:91-93`) repeat it verbatim: *HOME is ccd's only isolation boundary, and nothing on the wire can set a shell variable.* `server/test/ccd-spawn-split.test.ts` already pins one of these ("is not an env override"). A per-box fact that an environment could flip would be a way to change what a spawn *is* from outside the box, and would break the one boundary every ccd test relies on. So the switch has to arrive through HOME — i.e. as a file.
- **C2 — ccd never reads `ccrc.env`, deliberately.** That file carries `CCRC_AGENT_TOKEN`, `CCRC_VAPID_PRIVATE` and a Hetzner token; `ccd/ccrc:102-105` says so and is why even `ccrc` never sources it and never reads it whole (`_box_env_value` reads one key at a time). Teaching the fleet's *supervisor* to open the token file to answer a boolean is the wrong direction across a security seam, for zero gain.
- **C3 — the fleet host has no `ccrc.env` at all.** Measured and recorded at `ccd/ccrc:364-370`: the fleet box has `agent.env`, not `ccrc.env`, because `deploy/deploy.sh` ships `ccrc.env` on the **server lane only**. An env-file read with a default-off would therefore have answered "off" on the one box that runs ~11 live RC sessions — silently stripping `--remote-control` from every session on the live fleet at the next spawn. That is not a config mechanism; it is an outage with a config-shaped trigger.

**What shipped instead:** `CCRC_RC_FILE="$HOME/.ccrc/remote-control"`, one spelling in ccd, read by `_rc_enabled` — a bounded single-line `read -r`, no external binaries, set-u-safe; first line whitespace-trimmed must equal `on`, and **absent / unreadable / empty / anything else is OFF** (a garbled file must not half-enable a mode). `_spawn_start` evaluates it **once** into `$rcflag` and substitutes it into **both** spawn command strings — the primary and the `--session-id` retry — so a resume that dies and retries cannot come back a differently-shaped pane. Empty collapses out of the composed string exactly as `$sidflag`'s alternatives do.

**⚠ TASK 1 ALONE MUST NOT SHIP TO THE REFERENCE FLEET — ✅ LIFTED BY TASK 2.** While Task 1 stood alone nothing wrote the flag file, so on every existing box `_rc_enabled` answered off and installing that ccd on the fleet host would have stripped `--remote-control` from all ~11 live sessions at their next respawn. **The standing AGENT-FIRST rule did not save it — it is the procedure that would have caused it:** `ccd/` changes normally go to the fleet host *before* the server, and here the ccd install has to land *after* the seed.

**The block is lifted by Task 2's commits.** Both writers now exist (`_inst_rc` in `ccd/ccrc`, seeding `off`; `deploy/deploy.sh`'s agent-lane block, seeding `on`), and the deploy lane seeds the flag *within the same run*, in the agent branch above every `install_atomic` it performs — so there is no window in which a box has the new ccd and no flag. `agent/test/deploy-verify.test.ts` ("the remote-control flag is seeded ON, once, BEFORE the ccd that reads it lands") pins the block's presence, its position ahead of both the accounts.sh and the ccd install, and the trailing newline in the bytes it writes; moving the seed below `install_atomic ccd/ccd` reds the ordering pin, and `printf "on"` for `printf "on\n"` reds the bytes pin (both measured). `ccd/ccd`'s own comment block above `_rc_enabled` now states the ordering as the live fact to keep, in place of the deploy-block sentence.

**The lift is IN CODE AND SOURCE-ORDER ONLY, and the operator still owes the run.** Nothing here has been executed against a real box: every claim about the deploy lane is text extraction and index comparison over `deploy.sh`. The block is lifted in the sense that the seed exists and provably precedes the ccd install *in the script*; it becomes lifted in fact at the first `bash deploy/deploy.sh agent <host>`, which remains the pending real-VM stage gate. **Until that run happens, no hand-shipped `ccd` is safe on a fleet host** — the ordering guarantee lives in `deploy.sh` and nowhere else, so an `install_atomic`/`scp` of `ccd/ccd` done by hand onto an unseeded box reopens exactly the window this closed.

Three consequences worth carrying forward:

- **The writers owe a trailing newline — ✅ both pay it.** `read` returns non-zero at EOF-before-delimiter, so `printf 'on' > file` (no newline) reads as **off**. The direction is fail-safe and is left as-is; Task 2's writers each write a line and each has a test asserting the BYTES (`ccrc-install.test.ts` compares `'off\n'` whole; `deploy-verify.test.ts` extracts the seed's `printf` format string and asserts `on\n`), so dropping the newline in either writer is 1 red. `server/test/ccd-rc-flag.test.ts` pins the reader's half of the same measurement.
- **`/rc active` stays in the ready-marker set** (`ccd`'s `_accept_first_run_prompts`). The flip is not atomic across a fleet: pre-flip sessions are still RC panes and still have to classify as "up" through a swap or a restart. Measured: deleting that one alternative reds exactly one test in the whole suite (the new source-scan guard) — nothing else notices, which is why the guard exists.
- **Doctor owes a THIRD state, not two — ✅ shipped, and it turned out to be a fourth as well (D-100).** As specced `_dr_rc_state` printed `on` / `off (default)` / `off`, which reports a newline-less `printf 'on'` file as a deliberate `off` — the operator's edit did not take and the surface says they chose it. `off (unparseable — the file must hold one line reading 'on' or 'off')` closes that at the reporting layer, which is the right place to pay for it, and leaves the reader strict. D-100 below records the fifth printed form the same reasoning forced.

**D-100 — `_dr_rc_state` prints FIVE forms, not the four Task 2 specced: `off (unreadable — …)` is split off from `off (unparseable — …)`.** (Task 2, `ccd/ccrc-doctor-checks`.)

The brief named four printed forms over three semantic states: `on`, `off`, `off (default)`, and `off (unparseable — the file must hold one line reading 'on' or 'off')`. Implementing it exactly collapses two conditions an operator acts on completely differently into the last one. A `chmod 000` flag file and an empty file both make `read` fail with nothing in the variable, so the "unparseable" sentence would tell somebody to fix bytes that were never the problem, on a box where the bytes may already say `on`. That is the overloaded-seam defect `CLAUDE.md` bans by name ("two conditions a caller handles differently must not collapse to the same value"), and `_check_config` — the very function this helper feeds — already splits the identical pair for `ccrc.env` twenty lines below, with two WARN arms and two different remedies (`ls -ld` vs `ls -l`).

What shipped: `[ ! -f ] || [ ! -r ]` is asked BEFORE the read (a post-hoc `[ -n "$first" ]` cannot tell an empty file from an unreadable one, because `read` leaves the variable empty in both), and answers `off (unreadable — it is there and nothing could be read out of it; look at what is really there)`. Everything past that guard is a file whose bytes really were the answer, so an EMPTY file correctly reports `unparseable`. Measured: dropping the guard reds the unreadable case; collapsing `unparseable` into a bare `off` reds 2; collapsing `off (default)` into `off` reds 1.

**Precision note (fix round 1, review Minor 5).** `_check_config` is a COARSER precedent than the first wording claimed, not an identical one: there the unreadable pair gets **two** WARN arms with two different remedies, here the two conditions share one always-PASS form, because nothing about the flag file is a defect to remedy. And the arms are ~110 lines away in the file, not "twenty lines down". Both sides of the split are now pinned — the empty-file → `unparseable` row was the half the argument turns on and had no test of its own.

**D-101 — the RC state is its own always-PASS check (`rc`), not an append to `_check_config`'s PASS details.** (Task 2 fix round 1, `ccd/ccrc-doctor-checks`; the review's one Important.)

Task 2 Step 3 said "`_check_config`'s PASS detail … gains the measured RC state", and it shipped exactly that. The result couples a fact about **spawn shape** to the health of an **unrelated file**: the readout appears on `_check_config`'s two PASS arms only, so it is silent on the fleet-role SKIP and on all three `ccrc.env` WARNs (absent / not-a-regular-file / unreadable). Two consequences, both real:

- **The reference fleet host printed nothing about RC.** It has no `ccrc.env` and never will — D-86's topology branch SKIPs `config` there — and it is the one box in the topology that actually runs `on`. Three shipped pointers (`ccd/ccd`'s `_rc_enabled` docstring, `ccrc-doctor-checks`' own header, and the README, two paragraphs above a block headed "Ordering, **on a fleet host**") told operators to read a line that box does not print.
- **A `chmod 000 ccrc.env` took the readout down** on a server box whose flag file was perfectly readable.

**What shipped instead:** `rc`, an entry in `CCRC_DOCTOR_CHECKS` after `config`, whose whole body is `_dr_pass rc "$(_dr_rc_state)"`. It reads one file and nothing else — no `ccrc.env`, no unit files, no box role — and it is **always PASS**: the state is a fact about how a box is configured, not a defect, both values are correct for the boxes that chose them, and this file's rule is that a WARN owes a remedy there is no sentence for. Both `_check_config` appends are removed, so the fact has one home and the config detail is a statement about `ccrc.env` again. This is strictly SMALLER than what it replaces. The three pointers now name `rc`. Measured: deleting the table entry reds the table/function bijection (`ORPHAN _check_rc`); re-coupling it to `ccrc.env` (a `[ -r "$BOX_ENV_FILE" ] || _dr_skip` guard) reds the two independence tests.

**D-102 — the plan's "dialog.ts UNTOUCHED" fence sat directly on the hazard's own seat; lifted in fix round 1.** (Task 3, `server/src/pane/dialog.ts:142`, `parseDialog`.)

Task 3's brief scoped the fix to the two call sites that decide whether to attempt a `parseDialog` parse (`sessionws.ts:243`, `watch.ts:2407`) — replace `paneState(pane) === 'menu'` with `hasMenu(...)` — and explicitly fenced `pane/dialog.ts` out of scope. The survey behind that brief was call-site-only and never traced INTO `parseDialog`'s own body. `parseDialog`'s first line is `if (paneState(pane) !== 'menu') return null;` — a second, independent instance of the identical RC-off hazard (`paneState` answers `'busy'` before `'menu'` even when a real menu is also on screen), and it is the line every fixed call site funnels through: `hasMenu` deciding to ATTEMPT the parse changes nothing about what `parseDialog` itself then returns.

Measured (implementer round 1, before this fix): with both call sites fixed and the fence still up, the combo fixture (`busy.txt`'s spinner row + a real menu, the exact shape an RC-off pane renders while a dialog is up) reds on the desired "dialog reaches the frame" assertion both BEFORE and AFTER the call-site fix — for two different reasons in sequence. Reverting the call-site fix afterward left the ENTIRE regression suite green either way: the mutation was completely unobservable by any behavioral test, because `parseDialog`'s own gate dominates the outcome regardless of which gate its caller used. Correctly flagged, not fixed, per the round-1 brief's own instruction — this entry is the follow-up.

**What shipped:** the fence lifted for the one line at its seat. `parseDialog`'s gate now reads `if (!hasMenu(pane.replace(SGR, ''))) return null;` — the same idiom `inject/send.ts:320` uses, SGR-stripped for idiom consistency (a no-op today: every caller already captures pane text without escape codes, `tmux.capture`, never `captureAnsi`). `paneState` itself, and every other property of `parseDialog`, is untouched — `test/dialog.test.ts`'s full 23-test suite passed unmodified, including the pinned "busy pane yields state busy and null dialog" case (stays true: a PURE busy pane with no menu still fails `hasMenu`, so the outcome is unchanged for every pane this fix doesn't target).

Every caller of `parseDialog` was enumerated first (`git grep -n parseDialog server/src server/test`) before touching anything: the two now-fixed call sites; `inject/send.ts`'s `answerDialog` (walks the cursor and confirms an answer, at :915 and :926) — does not rely on the busy-veto to suppress anything, only on staleness (`dialog.id !== dialogId`) and walk verification, so the fix is a strict improvement there (a busy flicker mid-walk no longer breaks an otherwise-successful confirm) and no existing test constructs a busy+menu combo pane for it; `inject/send.ts`'s `sendPrompt`/`clearBox` guards (:320, :495, :865) call `hasMenu` directly and never route through `parseDialog` at all, so they were never at risk; and every test caller (`answer.test.ts`, `routes.test.ts`, `dialog.test.ts`) uses pure-menu fixtures, unaffected.

Re-measured with the fix in place: reverting `parseDialog`'s own gate alone → both behavioral tests (`sessionws.test.ts`, `push-copy.test.ts`) red (confirmed). Reverting EITHER call site's outer gate alone, with `parseDialog`'s fix left standing → the SAME behavioral test still reds (confirmed, both sites) — the call-site gates are **not** made redundant by this fix: they remain the independent decision of whether to attempt a parse at all, `parseDialog`'s fix is the independent decision of what that parse returns once attempted, and both must be correct for the pipeline to work. The two `mutation-sensitive` source-text pins fix round 1 added (to compensate for the then-unobservable call-site mutation) are now genuinely redundant with the behavioral tests and were removed rather than kept as decoration.

## Deferred out of this plan

- Per-worker RC (orchestrator task #37, the 2026-08-13 ruling) — open, recorded by Task 7.
- Deleting `/rc active` from the marker set — only after no pre-flip session survives on the reference fleet; operator-observable, not schedulable here.
- Option B for `ccd version` (delegating to `ccrc version` via sibling exec) — the consolidation path if the split reader ever needs a third edit.
- The 2d follow-ups not carried here (the D-87 read-boundedness pair → next wrapper-shape slice; the small hygiene batch) — unchanged destinations.
- ~~A fleet host's doctor never reports its RC state~~ — **FIXED in Task 2 fix round 1, see D-101.** (Was: `_dr_rc_state` hung off `_check_config`'s PASS arms, so the readout was silent on four arms and absent on exactly the box that runs `on`.)
