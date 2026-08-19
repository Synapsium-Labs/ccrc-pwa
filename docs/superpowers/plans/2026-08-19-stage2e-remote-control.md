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

- [ ] **Step 1: RED+GREEN — `_inst_rc`.** Seed-once exactly like `_inst_env`: dest `$HOME/.ccrc/remote-control`; existing file → `install: remote-control: kept (operator-owned)`; absent → write one line `off` via tmp+mv, `install: remote-control: off (fresh installs default off — edit ~/.ccrc/remote-control to 'on' for claude.ai discoverability)`. Wire after `_inst_env`. Tests: fresh box → file says `off`; pre-existing `on` → byte-identical after re-run; mutation: unconditional overwrite → red.
- [ ] **Step 2: RED+GREEN — deploy's fleet lane seeds `on`.** In the agent branch, between the roster block and the accounts.sh install (the ordering matters: flag BEFORE the new ccd lands, so no respawn window sees new-ccd + unseeded box): a remote `[ -e ... ] || printf 'on\n' > ...` guarded block in deploy's own idiom (one ssh, seed-once, never overwrite — mirror `ship_roster`'s shape and comment WHY `on`: the reference fleet ran RC before the flag existed; default-off would strip it silently at the next respawn). Add the deploy-verify pins: the block exists in the agent branch, positioned before the accounts.sh `install_atomic` (indexOf-ordering test in the existing style — and respect the name-shadowing rule: no comment naming the anchor helpers above the code). Mutation: move the seed after the ccd install → ordering pin red.
- [ ] **Step 3: RED+GREEN — doctor names the effective mode.** `_check_config`'s PASS detail (and its fleet-role SKIP detail unchanged) gains the measured RC state: read the flag file with the same trimmed-first-line rule (a tiny `_dr_rc_state` helper in doctor-checks — prints `on`/`off (default)`/`off`; no second spelling of the semantic: comment cross-references ccd's `_rc_enabled` as the authority, same pattern as the D-92 unit-dir agreement — add the same style of literal-agreement test comparing the two files' `remote-control` path spelling). PASS example: `config: ccrc.env present, fleet mode local; remote-control off (default)`. Tests: three states pinned; existing config tests updated only in their PASS-detail expectations.
- [ ] **Step 4: Docs.** `ccd/ccd:4` header line describes the argv as conditional; README's RC mentions (grep `remote.control|/rc` — README:1252's "a `--remote-control` pane" and the fleet description) reworded to "per-box, `~/.ccrc/remote-control`"; CLAUDE.md:4's fleet line likewise (one clause, no restructuring). None of these lines is test-pinned (readme-holds covers other sections) — verify with the suites anyway.
- [ ] **Step 5: Commit.** `feat(install,deploy): the box's remote-control fact is seeded once from either lane, and doctor says what it measured`

### Task 3: Dialogs still surface when the pane is honestly busy

**Files:**
- Modify: `server/src/sessionws.ts:243`, `server/src/watch.ts:2407` (gate via `hasMenu`, the send.ts:320 idiom), `server/src/fleet.ts:100-105` + `server/src/inject/send.ts:935-938` (comments only: "never renders" → mode-dependent wording)
- Test: `server/test/sessionws.test.ts`, the watch dialog suite (locate: `git grep -n 'paneState' server/test`)

**Interfaces:** none.

- [ ] **Step 1: RED.** A fixture pane carrying BOTH a live busy line (`fixtures/panes/busy.txt`'s real `esc to interrupt` spinner row) AND a permission dialog with its menu footer — with RC off this is a real, expected pane state. Assert the dialog reaches the sessionws frame and the watch tick. Red today: `paneState()` answers `'busy'` before `'menu'` (dialog.ts:20-21) and both call sites suppress the parse.
- [ ] **Step 2: GREEN.** At both call sites replace the `paneState(pane) === 'menu'` gate with the `hasMenu(...)` idiom send.ts:320 uses (`dialog.ts:23-28` documents exactly why `hasMenu` is independent of the busy check). Do NOT change `paneState` itself (its 'busy'-first ordering is load-bearing for its other consumers — check each remaining consumer before claiming none is affected, and list them in the report).
- [ ] **Step 3: Regression + comments.** The existing stale-scrollback tests (send.test.ts:342-346, sessionws.test.ts:510, mail-sweep.test.ts:846, livestate.test.ts:76) must stay green — run them by name. Reword the fleet.ts/send.ts comments to mode-aware truth ("a --remote-control pane does not render the busy marker; an RC-off pane does — either way busy-ness comes from the live status file, which also sees subagents"). Mutation: restore the `paneState==='menu'` gate at one site → that site's new test red. Commit: `fix(server): a dialog on a busy pane still reaches the PWA — RC-off panes render both at once`

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

- **C1 — ccd takes no env overrides, by contract.** `ccd:72-78` states it for `PROJECTS_ROOT`, and `SPAWN_GATE_TRIES`/`SPAWN_SETTLE_S` repeat it verbatim: *HOME is ccd's only isolation boundary, and nothing on the wire can set a shell variable.* `server/test/ccd-spawn-split.test.ts` already pins one of these ("is not an env override"). A per-box fact that an environment could flip would be a way to change what a spawn *is* from outside the box, and would break the one boundary every ccd test relies on. So the switch has to arrive through HOME — i.e. as a file.
- **C2 — ccd never reads `ccrc.env`, deliberately.** That file carries `CCRC_AGENT_TOKEN`, `CCRC_VAPID_PRIVATE` and a Hetzner token; `ccd/ccrc:102-105` says so and is why even `ccrc` never sources it and never reads it whole (`_box_env_value` reads one key at a time). Teaching the fleet's *supervisor* to open the token file to answer a boolean is the wrong direction across a security seam, for zero gain.
- **C3 — the fleet host has no `ccrc.env` at all.** Measured and recorded at `ccd/ccrc:364-370`: the fleet box has `agent.env`, not `ccrc.env`, because `deploy/deploy.sh` ships `ccrc.env` on the **server lane only**. An env-file read with a default-off would therefore have answered "off" on the one box that runs ~11 live RC sessions — silently stripping `--remote-control` from every session on the live fleet at the next spawn. That is not a config mechanism; it is an outage with a config-shaped trigger.

**What shipped instead:** `CCRC_RC_FILE="$HOME/.ccrc/remote-control"`, one spelling in ccd, read by `_rc_enabled` — a bounded single-line `read -r`, no external binaries, set-u-safe; first line whitespace-trimmed must equal `on`, and **absent / unreadable / empty / anything else is OFF** (a garbled file must not half-enable a mode). `_spawn_start` evaluates it **once** into `$rcflag` and substitutes it into **both** spawn command strings — the primary and the `--session-id` retry — so a resume that dies and retries cannot come back a differently-shaped pane. Empty collapses out of the composed string exactly as `$sidflag`'s alternatives do.

Two consequences worth carrying forward:

- **The writers owe a trailing newline.** `read` returns non-zero at EOF-before-delimiter, so `printf 'on' > file` (no newline) reads as **off**. The direction is fail-safe and is left as-is; Task 2's writers (`ccrc install`, deploy's fleet lane) must write a line, and `server/test/ccd-rc-flag.test.ts` pins the measured behaviour so the contract is visible rather than folklore.
- **`/rc active` stays in the ready-marker set** (`ccd`'s `_accept_first_run_prompts`). The flip is not atomic across a fleet: pre-flip sessions are still RC panes and still have to classify as "up" through a swap or a restart. Measured: deleting that one alternative reds exactly one test in the whole suite (the new source-scan guard) — nothing else notices, which is why the guard exists.

## Deferred out of this plan

- Per-worker RC (orchestrator task #37, the 2026-08-13 ruling) — open, recorded by Task 7.
- Deleting `/rc active` from the marker set — only after no pre-flip session survives on the reference fleet; operator-observable, not schedulable here.
- Option B for `ccd version` (delegating to `ccrc version` via sibling exec) — the consolidation path if the split reader ever needs a third edit.
- The 2d follow-ups not carried here (the D-87 read-boundedness pair → next wrapper-shape slice; the small hygiene batch) — unchanged destinations.
