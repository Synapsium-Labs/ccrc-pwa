# Claude Code binary lifecycle, wave 3: install — the intent and its projection, the node's pull, the intent routes, the canary's approval, the installer live, the launcher adopted, the upstream token on a descriptor, the prune adopted, the operator's bootstrap, and the Settings controls — Implementation Plan

> **For agentic workers:** one PR per task, in the order of §Landing order, each dispatched only when its row in §Gates is all green. To execute a task, REQUIRED SUB-SKILL: superpowers:subagent-driven-development, with superpowers:test-driven-development for every red-first step. Steps use checkbox (`- [ ]`) syntax. **Every task here except CB3j is band 3**: it installs binaries, selects what every lane's launcher runs, or touches the upstream credential. Written and reviewed natively, never handed off; the ones marked **two reviewers** merge only after two independent reviews, one reading only the security lens. Workers do not edit §Deviations and decisions.

**Spec:** `docs/superpowers/specs/2026-10-18-claude-binary-lifecycle-design.md` (rev 3, approved by the operator 2026-10-19: "all cards accepted/answered"). §8 and §10.2, §10.5 bind this plan in full; §8.4 names what it supersedes.

**Status:** rev 0 (2026-10-19), written with the spec's rev 3, the other wave plans and the ledger. Tasks dispatch as their gates open. The wave's deploy is one gated operator act (OA-4), because the launcher is on every lane's exec path.

**Inputs.** The spec's §8.1 to §8.6, §10.1 (the approval half), §10.2, §10.5, §11 (W3), §11.1 (M4, M5); the operator's rulings 1, 11, 14 and 15; the centralised update design (`2026-09-20-centralised-update-management-design.md`: the leased intent, `writeOwnProjection`, `ccd-update-sync`, the journal `updateIntentLog`); the upstream launcher decision brief (`2026-08-21-upstream-launcher-decision-brief.md`, its §6 superseded) and the locks plan (`2026-08-21-upstream-launcher-locks.md`, its "Not done here" answered; lock 5, D-156, kept); D-159 (identity split from executable, implemented here); D-3478 (a file at a lane launcher's path cuts every lane over); the Settings plan's R1b `AckConfirm`, R1c result lines and C5; W1's §Global constraints, binding here in full.

**Base:** `origin/main` `f82d0c015` (#701). Anchors at that sha: `ccd/ccrc` `cmd_doctor` ≈:3650, `cmd_wrappers` ≈:3959, `ACCT_OPERATOR_STEP_2` ≈:7040, `cmd_install` ≈:12469, `_inst_atomic` ≈:13916, `_inst_keep_aside` ≈:13986, `_inst_bins` ≈:14129, `_inst_caps` ≈:14647, `_inst_units` ≈:14874, `cmd_uninstall` ≈:23070; `ccd/ccd-update-sync` (`DEST="$HOME/.ccrc/update-intent"` ≈:129); `ccd/ccrc-codex` (`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` ≈:180); `shared/roster.ts` (`secretsFile` on the upstream kind ≈:137); `server/src/update/project.ts` (`writeOwnProjection` ≈:68); `server/src/update/routes.ts` (`GET /api/updates/intent/:nodeId` ≈:782, `POST /api/updates/intent` ≈:611); `server/src/coord/schema.ts` (`MIGRATIONS` ≈:63); `server/test/ccrc-wrappers.test.ts` (the modelled `vers=(versions/*)` launcher).

**Deploy class.** CB3a, CB3c, CB3d and CB3j are server lane. CB3b, CB3e to CB3i are **AGENT-FIRST**: the fleet node moves first, and CB3f's launcher adoption is the operator act OA-4. The wire stays additive: the Claude intent rides as one optional field of the leased intent's answer; no `FLEET_PROTO` bump.

**Names.** Tasks **CB3a** to **CB3j**. Operator acts **OA-4** (the adoption) and **OA-5** (the bootstrap, U15).

**Goal, PR by PR.**

| After | What runs | What the operator sees |
|---|---|---|
| W2 | each lane still runs its own updater's `version_to`; rolls run only the canary | the card, read-only; Restart onto, for the canary |
| CB3a | unchanged | unchanged (tables, the projection on the server's own node) |
| CB3b | unchanged | unchanged (each fleet node holds `~/.ccrc/claude-intent`) |
| CB3c | unchanged | unchanged (the routes exist; no control yet) |
| CB3d | unchanged | a passed canary approves its build for its (node, kind) |
| CB3e | the installer installs the channel's build and promotes approved targets | the card's last-run line says install |
| CB3f | **every lane runs the pair's target** through the adopted launcher | the card's target is what runs |
| CB3g | the upstream lane's token arrives on a descriptor | nothing visible |
| CB3h | the prune keeps what runs and what records name | the card's builds list shrinks to what is kept |
| CB3i | a node with no build can be bootstrapped by the operator | `ccrc install` offers the bootstrap |
| CB3j | unchanged | channel, pin and Unpin on the card; the mode (off, manual) under Automation |

---

## Gates: what each task waits for, stated honestly

Measured on 2026-10-19 at `f82d0c015` (26 open PRs).

- **#435** holds `ccd/ccd`, `ccd/ccrc-doctor-checks`, `server/test/ccrc-codex-launcher.test.ts`, `server/test/ccrc-doctor.test.ts` and `server/test/ccdWsHelpers.ts`. CB3f edits the doctor and `ccrc-codex`'s kind export, CB3g edits `_spawn_start`. **CB3f and CB3g wait for #435** (W2 already waited for it, so in practice it has merged).
- **#397** and **#700** hold `shared/api.ts`, `server/src/server.ts` and `server/src/coord/routes.ts`. CB3c adds routes in `server/src/update/routes.ts` (no PR holds it) and wire types in `shared/api.ts`: **CB3c waits for #397 and #700**.
- **Settings R2b2 and CB1h** gate **CB3j**; R1b's `AckConfirm` and R1c's result lines have merged.
- **W2** gates this wave: CB2a to CB2g (a canary must have run, so OA-3 must have passed on at least one pair before CB3d approves anything). **OA-3** gates the W3 deploy, not any PR.
- **M4** (the descriptor variable) gates **CB3g**; **M5** (a tampered manifest through a local proxy, the `"flag"` enforcement, the fingerprint already measured in CB1d) gates **CB3e**. Both are development-fixture measurements in the task's Step 0, not operator acts.
- **The W1 node file green for 24 h** on every fleet node (spec §11's W3 deploy gate) gates OA-4.

| Task | #435 | #397 / #700 | Settings | Earlier waves | Other |
|---|---|---|---|---|---|
| CB3a intent tables, projection | no | no (`server/src/update/*`, `schema.ts`) | — | CB1a | — |
| CB3b the node's pull | no | no | — | CB3a | — |
| CB3c intent routes, journal | no | **yes** (`shared/api.ts`) | — | CB2g | CB3a |
| CB3d canary approves target | no | no | — | CB2e, CB2f | CB3a |
| CB3e installer live | no | no | — | CB1d, CB2d (the shared lock) | CB3b, CB3d; **M5** |
| CB3f launcher adopted | **yes** | no | — | CB2b | CB3e |
| CB3g token on a descriptor | **yes** | no | — | — | CB3f; **M4** |
| CB3h prune adopted | no | no | — | CB2d | CB3f |
| CB3i bootstrap | no | no | — | — | CB3e |
| CB3j Settings controls | no | no | **R2b2** | CB1h | CB3c |

## In flight, and what it fences off

| In flight | Files it changes that this plan would otherwise touch | Tasks it gates |
|---|---|---|
| #435 | `ccd/ccd`, `ccd/ccrc-doctor-checks`, `ccrc-codex-launcher`, `ccrc-doctor` tests | CB3f, CB3g |
| #397, #700 | `shared/api.ts` | CB3c |

No open PR holds `ccd/ccrc`'s install path, `ccd/ccd-update-sync`, `ccd/ccrc-codex`, `shared/roster.ts`, `server/src/update/project.ts`, `server/src/update/routes.ts`, `server/src/coord/schema.ts`, `server/src/coord/store.ts` or `server/test/ccrc-wrappers.test.ts`.

## Landing order

```
CB3a (tables, projection) ─┬─ CB3b (pull; fleet) ─────────────┐
                           ├─ CB3c (routes) ── CB3j (controls; after R2b2)
                           └─ CB3d (canary approves) ─────────┴─ CB3e (installer live; M5) ─┬─ CB3f (launcher; after #435) ── CB3g (descriptor; M4)
                                                                                           │                                └─ CB3h (prune)
                                                                                           └─ CB3i (bootstrap)
--- operator ---
OA-4 (the adoption, AGENT-FIRST, gated) after CB3a to CB3h are merged; OA-5 only for a node with no build
```

CB3e to CB3h are merged before OA-4 and deployed together by it: the installer may promote a target only once a launcher reads it, and the old prune timer must retire in the same step the new prune starts (spec §8.5).

## Global constraints

W1's §Global constraints bind here in full. In addition:

- **No token, secrets path or lane name in the tree.** The repo carries the variable names and the roster field, nothing else. The launcher reads no secret. Tests use a fixture secrets file under the harness HOME with a dummy value, and assert the value appears in no argv, environ, log or journal row (CB3g).
- **Every rung fails closed.** The launcher never serves a 0-byte placeholder, an unsmoked, unverified or halted build, on any rung; with no admissible build it exits 127.
- **The installer never downgrades unattended** (decision 12): a pointer below the newest approved target is `upstream-retreat`, never a selection.
- **A node cut off never advances** (spec §10.2): an intent older than 15 min makes the run install-only.
- **Two reviewers** for CB3e, CB3f, CB3g and CB3i.

## Review focus (the failure modes most likely to bite)

1. **The candidate served before its canary.** Only a canary roll names the candidate; the launcher's rungs never read it; promotion reads only the intent's `approvedTarget` (CB3d, CB3e, CB3f).
2. **A cut-over that strands every lane.** The adoption byte-compares, keeps a non-ccrc launcher aside, refuses over `.pinned`, and `ccrc uninstall` restores the kept copy (CB3f).
3. **A secret in an environ, argv or log.** The descriptor opens the 0600 file after an owner and mode check under `set +x`; only the descriptor variable is exported (CB3g).
4. **A prune that deletes what runs.** It keeps every `exe` of a live process, every record's build, the targets, the pin, and the 3 newest smoked; it deletes nothing when the `/proc` scan fails while sessions are registered (CB3h).
5. **A stale or partitioned node advancing.** `at` older than 15 min: install-only, no candidate, no target (CB3b, CB3e).
6. **An intent route a session can reach.** Every intent route is operator-cookie only, non-exempt both ways, absent from `ccrc-api` (CB3c).
7. **Lock 5 weakened.** `cmd_wrappers` still refuses to overwrite the launcher (CB3f).
8. **A bootstrap the timer can run.** Only `ccrc install`, interactively, bootstraps; the timer reports and does nothing on a node with no smoked build (CB3e, CB3i).

## Tasks

### Task CB3a: the Claude intent, its tables and its projection (D-5711; spec §10.2) — GATED: after CB1a

**Routing:** band 3 (the record that decides which build may run). **Lane:** server. **Needs:** CB1a.

**Files:**
- Modify `server/src/coord/schema.ts`: one `MIGRATIONS` entry adding tables only: `claude_intent` (`scope` `'*'` or a node id, `channel`, `pin`, `mode`, `setAt`), `claude_halts` (`build`, `reason`, `node`, `at`, `ackedAt`), `claude_canaries` (`node`, `kind`, `build`, `result`, `at`, `tx`), `claude_roll_failures` (`id`, `build`, `node`, `session`, `at`, `ackedAt`), `claude_intent_log` (`at`, `actor`, `what`, `before`, `after`). Seeds nothing: an absent `'*'` row is the defaults (`latest`, no pin, `manual`).
- Modify `server/src/coord/store.ts`: their methods, one writer each.
- Create `server/src/update/claudeIntent.ts`: `effectiveClaudeIntent(nodeId)` (node row over `'*'`) and `renderClaudeIntent(…)`: `{ at, channel, pin, mode, halts, approvedTarget, minBuild }`, `approvedTarget` per kind from `claude_canaries` (CB3d writes the rows).
- Modify `server/src/update/project.ts`: `writeOwnProjection` (≈:68) also writes `~/.ccrc/claude-intent` (0600) on the server's own node; and `server/src/update/routes.ts`'s `GET /api/updates/intent/:nodeId` (≈:782) carries `claude` as an optional field of its answer.
- Create `server/test/claude-intent.test.ts`; modify `server/test/update-projection.test.ts`.

- [ ] **Step 1: Red.** "no row: the defaults"; "a node row wins over `'*'`"; "unacked halts are projected, acked ones are not"; "`approvedTarget` is empty until a canary row passes"; "`minBuild` is 2.1.277"; "the intent answer carries `claude`; an older parser ignores it"; "the migration adds tables only".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `'*'` wins over the node row | claude-intent | its case |
  | acked halts projected | claude-intent | its case |
  | `approvedTarget` taken from the candidate | claude-intent | "empty until a canary row passes" |
  | an `ALTER TABLE` added | claude-intent | "tables only" |

- [ ] **Step 4: Verify.** `tsc --noEmit`; each suite alone.

### Task CB3b: the node pulls the Claude intent (D-5712; spec §10.2, §8.1's start on change) — GATED: after CB3a

**Routing:** band 3. **Lane:** AGENT-FIRST (FLEET: `ccd-update-sync`). **Needs:** CB3a.

**Files:**
- Modify `ccd/ccd-update-sync`: the answer's `claude` field is validated with `jq` (never sourced; every field re-validated with CB1a's grammar rendered into the `jq` program) and written atomically to `~/.ccrc/claude-intent` (0600) beside `DEST` (≈:129); on any failure the last good projection is kept; when its content changes, `systemctl --user start --no-block ccrc-claude-install.service`.
- Create `server/test/update-sync-claude.test.ts`.

- [ ] **Step 1: Red.** "a valid field is written"; "a pin `2.1.3; rm -rf` is refused and the last good file kept"; "an absent field leaves the file as it was"; "a change starts the installer without blocking; no change starts nothing".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | the pin not re-validated | update-sync-claude | its case |
  | an absent field truncates the file | update-sync-claude | its case |
  | `--no-block` dropped | update-sync-claude | "without blocking" |

- [ ] **Step 4: Verify.** The suite alone; `bash -n ccd/ccd-update-sync`.

### Task CB3c: the intent routes and their journal (D-5713; spec §10.5) — GATED: after CB3a, CB2g, #397 and #700

**Routing:** band 3 (operator-only writes that pick builds). **Lane:** server. **Needs:** CB3a, CB2g; #397 and #700 merged.

**Files:**
- Modify `server/src/update/routes.ts`: `POST /api/claude/intent` (`channel`, `pin`, `mode`, scope `'*'` or a node id; `mode: 'auto'` refused here, `409 not-yet`, until CB5a), `POST /api/claude/unpin`. Each validates with CB1a's grammar and `minBuild`, writes, journals in `claude_intent_log` with `pwaDec(req)`, and re-projects.
- Modify `server/src/server.ts`'s roll route (CB2g): `to` may now be the pair's target or the pin; `not-yet` only while no pair target exists for a non-canary.
- Modify `shared/api.ts`: the routes' wire types.
- Modify `server/test/auth-gate.test.ts` (non-exempt both ways); create `server/test/claude-intent-routes.test.ts`; a case asserts `ccrc-api` has no command for them.

- [ ] **Step 1: Red.** "the box token is refused"; "a pin below 2.1.277 is refused"; "every write journals its actor"; "`auto` answers `not-yet`"; "Unpin clears the pin, not a halt"; "after a target exists, the roll route admits the target".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | the route accepts the box token | claude-intent-routes | its case |
  | `minBuild` not checked | claude-intent-routes | its case |
  | the journal write dropped | claude-intent-routes | its case |
  | `auto` accepted | claude-intent-routes | "`not-yet`" |

- [ ] **Step 4: Verify.** `tsc --noEmit`; each suite alone.

### Task CB3d: a passed canary approves its build (D-5714; spec §10.1's approval, §8.1 step 8's source) — GATED: after CB3a, CB2e and CB2f

**Routing:** band 3 (the one path to a target). **Lane:** server. **Needs:** CB3a; CB2e (the canary rows), CB2f (the `roll` act on the server).

**Files:**
- Create `server/src/update/claudeCanary.ts`: reads the lifecycle mirror's `roll` rows with `meas.canary`; `passed` writes a `claude_canaries` row `(node, kind, build, passed)` and re-projects that node's `approvedTarget[kind]`; `failed` writes `failed` (CB5b raises the halt); `inconclusive` writes nothing. A canary run before CB3a landed (OA-3's) is read from the mirror's history once, on the first pass.
- Create `server/test/claude-canary-approve.test.ts`.

- [ ] **Step 1: Red.** "a passed canary on (fleet, anthropic) approves 2.1.302 for that pair only"; "the codex pair stays unapproved"; "an inconclusive canary approves nothing"; "a failed canary approves nothing"; "the W2a canary already in the mirror is read once".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | approval per node, not per kind | claude-canary-approve | "the codex pair stays unapproved" |
  | `inconclusive` read as passed | claude-canary-approve | its case |
  | the history not read | claude-canary-approve | "read once" |

- [ ] **Step 4: Verify.** `tsc --noEmit`; the suite alone.

### Task CB3e: the installer, live (D-5715; spec §8.1 steps 1 to 9, the backoff, the proven marker) — GATED: after CB3b, CB3d and M5

**Routing:** band 3, **two reviewers** (installs binaries). **Lane:** AGENT-FIRST (FLEET). **Needs:** CB3b, CB3d; **M5** in Step 0.

**Files:**
- Modify `ccd/ccrc-claude-install`: install mode (the unit's `ExecStart` drops `--measure`): the gates (the switch; the intent parsed with `jq`; `at` older than 15 min → install-only, `intent-stale`); resolve (pin, else the channel's pointer, default `latest`; `below-floor`, `halted`, `upstream-retreat`); space (2 × size + 2 GiB, `no-space`; staging and placeholders older than 1 h removed); install if absent with `<runner> install <want>`, each argument its own word, 600 s, `<runner>` a smoked build other than `<want>`, no `--force`, and nothing at all when no smoked build exists (`install-failed`, "bootstrap is the operator's", spec §8.6); verify by postcondition (CB1d's chain); smoke; publish the candidate; promote from the intent's `approvedTarget` only, writing `~/.ccrc/claude-target` (one line per kind) and `~/.ccrc/claude-prev-target`, the pin as both kinds' target by the same rule, `pin-unavailable` until it can; backoff on consecutive same-`why` failures (30 min, 1 h, 2 h, up to 6 h); the proven marker `~/.ccrc/claude-installer-proven` once it has itself installed and promoted one build it resolved, with no failed run in 24 h and 72 h live.
- Modify `deploy/systemd/ccrc-claude-install.service`.
- Create `server/test/claude-installer-live.test.ts`.

- [ ] **Step 0: M5, in a development fixture.** A local HTTPS proxy serving a tampered manifest and a tampered binary for one build to `claude install` under a throwaway HOME: does it refuse; what does `manifestSignatureEnforcement: "flag"` control. Record the result in the PR body and the ledger. The design does not depend on the answer (ccrc's own `gpgv` check is independent), but the review needs it.
- [ ] **Step 1: Red.** "stale intent: no candidate, no target, `intent-stale`, but a projected pin is still installed"; "a pointer below the approved target is `upstream-retreat` and selects nothing"; "`<runner>` is never `<want>`"; "no smoked build: nothing installed, `claude` never called"; "the candidate is never written to `claude-target`"; "an approved target is written for its kind only"; "a pin is both kinds' target"; "the backoff doubles to 6 h on one `why` and resets on another"; "the proven marker needs all three conditions"; "`--force` is never passed".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | the candidate promoted | claude-installer-live | "never written to `claude-target`" |
  | staleness ignored | claude-installer-live | "stale intent" |
  | `<runner>` may be `<want>` | claude-installer-live | its case |
  | the retreat selected | claude-installer-live | its case |
  | proven after 24 h | claude-installer-live | "all three conditions" |
  | the backoff never resets | claude-installer-live | its case |

- [ ] **Step 4: Verify.** The suite alone; `bash -n`.

### Task CB3f: the launcher, adopted as a pure selector (D-5716; spec §8.3, §8.4) — GATED: after CB3e and #435

**Routing:** band 3, **two reviewers** (every lane's exec path; D-3478). **Lane:** AGENT-FIRST, deployed by **OA-4**. **Needs:** CB3e; #435 merged.

**Files:**
- Create `ccd/claude-launcher` (bash, provenance marker `ccrc-launcher`): kind from `CCRC_CLAUDE_KIND` (default `anthropic`); rungs: `CCRC_CLAUDE_VERSION` (validated, `-s -x`, smoked, not halted, else 127); `~/.ccrc/claude-target`'s line for the kind; `~/.ccrc/claude-prev-target`'s; before any `claude-smoked` exists, the newest `-s -x` build by `sort -V`; else 127. Bounded reads (`head -c 64`), no network, no roster, no secret, no `CLAUDE_CONFIG_DIR`. `exec versions/<v> "$@"`.
- Modify `ccd/ccrc-codex`: exports `CCRC_CLAUDE_KIND=codex`.
- Modify `ccd/ccrc`: `_inst_bins` (≈:14129) places the launcher at `~/.local/bin/<upstream id>` (the roster's upstream id); adoption byte-compares; a different, non-ccrc file is kept aside (`_inst_keep_aside` ≈:13986) and replaced atomically only after the operator confirms, in `ccrc install`'s prompt, that its token-file reference becomes the roster's `exec.secretsFile` (the installer never reads or prints the token); `ccrc install` refuses over an existing `versions/.pinned`; `cmd_uninstall` (≈:23070) restores the kept copy; `cmd_doctor` (≈:3650) reports the provenance marker, the byte-compare and the mode only; `ACCT_OPERATOR_STEP_2` (≈:7040) is deleted; `cmd_wrappers` (≈:3959) still refuses to overwrite the launcher (lock 5).
- Modify `server/test/ccrc-wrappers.test.ts` (the modelled `vers=(versions/*)` launcher replaced by the shipped one); create `server/test/claude-launcher.test.ts`; modify `server/test/ccrc-codex-launcher.test.ts`, `server/test/install-census.test.ts`, `server/test/ccrc-uninstall.test.ts`, `server/test/ccrc-doctor.test.ts`.

- [ ] **Step 1: Red.** "2.1.302 over 2.1.99"; "a 0-byte build is never served"; "an unsmoked target falls to the previous target"; "a halted target is not served"; "after `claude-smoked` exists, no highest rung"; "nothing admissible: 127"; "a codex lane reads the codex line"; "the launcher reads no file outside `~/.ccrc` and `versions/`" (an strace-free fixture: a `HOME` whose other files are unreadable); "adoption keeps a foreign launcher aside and uninstall restores it"; "`.pinned` refuses the adoption"; "`ccrc wrappers` refuses to overwrite it"; "doctor prints no body and no secrets path".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | lexical glob restored | claude-launcher | "2.1.302 over 2.1.99" |
  | `-s` dropped | claude-launcher | "0-byte" |
  | the highest rung kept after smoking exists | claude-launcher | its case |
  | the smoked check dropped from rung 1 | claude-launcher | its case |
  | uninstall removes instead of restoring | ccrc-uninstall | its case |
  | lock 5's refusal removed | ccrc-wrappers | its case |

- [ ] **Step 4: Verify.** Each suite alone; `bash -n ccd/claude-launcher ccd/ccrc ccd/ccrc-codex`.

### Task CB3g: the upstream token on a descriptor (D-5717; spec §8.3 "The upstream token", decision 11) — GATED: after CB3f, #435 and M4

**Routing:** band 3, **two reviewers**, one reading only the security lens (credential path). **Lane:** AGENT-FIRST (FLEET: `ccd`). **Needs:** CB3f; #435; **M4** in Step 0.

**Files:**
- Modify `ccd/ccd` `_spawn_start` (≈:22885): for a lane whose roster account is the upstream kind, under `set +x`, check `exec.secretsFile` is a regular file of mode 0600 owned by the user (else refuse the spawn with a named error and no path in it), open it on a descriptor, and add only the descriptor variable M4 names to the spawn's environment. Config-dir comparisons use `realpath -m`.
- Create `server/test/ccd-upstream-descriptor.test.ts`.

- [ ] **Step 0: M4, in a development fixture.** Which descriptor variable Claude Code accepts for the upstream token kind (`CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR` or the API-key twin), with a dummy token against a local stub, no login, no `-p` turn. **If neither fits, STOP**: the ruling was the descriptor (decision 11); the alternatives were not taken, and the question returns to the operator through the coordinator.
- [ ] **Step 1: Red.** "the dummy value appears in no argv, no environ, no tmux command line, no journal row and no log"; "mode 0644 refuses"; "another owner refuses"; "a non-upstream lane gets no descriptor"; "`set -x` around the spawn prints no value".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | the value exported instead of the descriptor | ccd-upstream-descriptor | "no environ" |
  | the mode check removed | ccd-upstream-descriptor | "0644 refuses" |
  | `set +x` removed | ccd-upstream-descriptor | its case |

- [ ] **Step 4: Verify.** The suite alone; `bash -n ccd/ccd`.

### Task CB3h: the prune, adopted, and the old timer retired (D-5718; spec §8.5) — GATED: after CB3f

**Routing:** band 3 (deletes builds). **Lane:** AGENT-FIRST. **Needs:** CB3f (the adoption step retires the old timer).

**Files:**
- Modify `ccd/ccrc-claude-install`: the prune at the end of every run under the exclusive lock, keeping spec §8.5's set (candidate, targets, previous targets, pin, every `.rolling`/`.claude-build`/`.claude-canary` build, every live `exe` and live lock pid, the 3 newest smoked non-halted by version); deleting halted builds no one runs or names, and removing them from `claude-smoked`; deleting nothing when the `/proc` scan fails or finds no Claude Code process while sessions are registered.
- Modify `ccd/ccrc`: adoption disables and removes the old prune timer and its service; `cmd_doctor` fails while it is active.
- Create `server/test/claude-prune.test.ts`.

- [ ] **Step 1: Red.** "a build a live process runs is kept"; "a build a record names is kept"; "the fourth-newest unreferenced build is deleted"; "a halted unreferenced build is deleted and unsmoked"; "a failed `/proc` scan deletes nothing"; "a roll holding the lock shared blocks the prune"; "doctor fails while the old timer is active".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | sort by mtime | claude-prune | "the fourth-newest" |
  | the `exe` scan skipped | claude-prune | "a live process runs" |
  | fail-open on a failed scan | claude-prune | its case |
  | the lock not taken | claude-prune | its case |

- [ ] **Step 4: Verify.** The suite alone; `bash -n`.

### Task CB3i: the operator's bootstrap (D-5719; spec §8.6, decision 15) — GATED: after CB3e

**Routing:** band 3, **two reviewers** (downloads and runs a binary). **Lane:** AGENT-FIRST (`ccrc install`). **Needs:** CB3e.

**Files:**
- Modify `ccd/ccrc` `cmd_install` (≈:12469): on a `fleet` or `both` node with no smoked build, offer the bootstrap interactively (refused without a TTY and inside a session): download the platform binary the signed manifest names into staging, `gpgv` and SHA-256 as CB1d, smoke, then that binary's own `install` into the same postcondition; never touch the launcher path.
- Create `server/test/ccrc-claude-bootstrap.test.ts`.

- [ ] **Step 1: Red.** "no TTY refuses"; "a session refuses"; "a bad signature installs nothing"; "the launcher path is untouched"; "the timer, on the same node, reports and installs nothing".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | the TTY check removed | ccrc-claude-bootstrap | its case |
  | the binary run before `gpgv` | ccrc-claude-bootstrap | "a bad signature" |
  | the timer bootstraps | ccrc-claude-bootstrap | its case |

- [ ] **Step 4: Verify.** The suite alone; `bash -n ccd/ccrc`.

### Task CB3j: the card's controls — channel, pin, and the mode under Automation (D-5720; spec §6.3, decision 14) — GATED: after CB3c, CB1h and R2b2

**Routing:** band 2 (Pin and Unpin are danger confirms through existing primitives). **Lane:** PWA. **Needs:** CB3c; CB1h; Settings R2b2.

**Files:**
- Modify `pwa/src/screens/settings/ClaudeCodeCard.tsx`: channel (`latest`, `stable`; the server's answer checks the radio, never the tap); Pin (a danger confirm naming the downgrade) and Unpin; result lines under each control (R1c).
- Modify `pwa/src/screens/settings/AutomationSection.tsx` (R2b1 creates it): a Claude Code mode card, `off` and `manual` only in this wave (`auto` arrives with CB5c).
- Modify `pwa/src/screens/settingsText.ts`; create `pwa/test/claude-code-controls.test.tsx`.

- [ ] **Step 1: Red.** "the radio follows the server, not the tap"; "Pin asks first, Cancel focused"; "a refusal is an amber result line, never a toast"; "the mode card offers off and manual only"; "both are operator-cookie writes through the provider".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | checked from the tap | claude-code-controls | its case |
  | Pin one tap | claude-code-controls | its case |
  | `auto` offered | claude-code-controls | its case |

- [ ] **Step 4: Per width × skin × mode** (the Settings plan's 32 cells), with each confirm open at 390 and at 900 or wider, both skins, both modes.
- [ ] **Step 5: Verify.** `cd pwa && ./node_modules/.bin/tsc --noEmit`; the suite alone; `settings-screen.test.tsx` alone.

## Operator acts in this wave

- **OA-4: the adoption, AGENT-FIRST and gated** (spec §11's W3 deploy gate). After CB3a to CB3i have merged, the node file from W1 has been green for 24 h on every fleet node and OA-3 has passed for at least one pair: the operator approves the fleet-lane deploy, then `ccrc install` on each `fleet`/`both` node, where they confirm the kept-aside launcher's token-file reference becoming the roster's `exec.secretsFile` (nothing prints the token); `ccrc doctor`'s launcher and old-timer checks must be green before the server lane follows. Rollback: `ccrc uninstall` restores the kept-aside launcher.
- **OA-5: the bootstrap, once, only for a node with no Claude Code build** (decision 15). Today's fleet node holds six builds, so OA-5 is for a new fleet node; the timer never bootstraps.

## Deviations and decisions

### Issued for this work and defined here

From this programme's block, D-5695 to D-5724, this plan defines D-5711 to D-5720. The spec's §14 cites D-5711, D-5715 and D-5716.

- **D-5711** — `claude-intent-vocabulary` (Task CB3a; spec slug): the Claude intent is a parallel vocabulary and parallel `coord.db` tables (`claude_intent`, `claude_halts`, `claude_canaries`, `claude_roll_failures`, `claude_intent_log`), never rows in `releases` or `update_intent`; the server resolves it per node (node row over `'*'`) and projects it, timestamped, as `~/.ccrc/claude-intent` with `halts`, `approvedTarget` per kind and `minBuild`, an optional field of the leased intent's answer; a projection older than 15 min stops a node advancing (spec §10.2, §10.5). Its shared lexicon is D-5695.
- **D-5712** — `claude-intent-pull` (Task CB3b): `ccd-update-sync` writes the Claude intent from the answer it already pulls every 60 s, validated with `jq` and never sourced, keeping the last good projection on any failure, and starts the installer without blocking when the projection changes (spec §10.2, §8.1).
- **D-5713** — `claude-intent-routes` (Task CB3c): `POST /api/claude/intent` and `POST /api/claude/unpin` are operator-cookie routes, non-exempt both ways and absent from `ccrc-api`, validating the pin against the grammar and `minBuild`, journalling every write with its actor; `auto` is refused until W5; the roll route then admits the pair's target or the pin (spec §10.5, §7.5).
- **D-5714** — `canary-approves-target` (Task CB3d): only a passed canary on a (node, lane kind) approves a build for that pair; the server reads it from the lifecycle mirror, the W2a canary included, writes `claude_canaries`, and projects `approvedTarget[kind]`; an inconclusive canary approves nothing (spec §10.1; decision 8).
- **D-5715** — `ccrc-claude-installer` (Tasks CB1d, CB3e; spec slug): one ccrc-owned installer per `fleet`/`both` node on a 30 min timer, under a scrubbed environment and an exclusive lock: install-only on a stale intent; the channel's pointer (default `latest`, decision 1) or the pin; the floor; the space check; install from a smoked build other than the wanted one, without `--force`; verification by `gpgv` against the committed keyring, then size and SHA-256, never by exit code; the smoke; the candidate; promotion only from the intent's `approvedTarget`; the backoff; the proven marker; and no bootstrap by the timer (spec §8.1, §8.6). CB1d's measure mode is D-5698.
- **D-5716** — `launcher-and-prune-adopted` (Tasks CB3f, CB3h; spec slug): ccrc ships the launcher, a pure selector keyed by lane kind with fail-closed rungs (the explicit version, the target, the previous target, and "highest" only before any build is smoked), reading no roster, no secret and no network; the adoption byte-compares, keeps a foreign launcher aside, and is undone by `ccrc uninstall`; the prune runs inside the installer and the old daily timer is retired in the same step; the decision brief's §6 and the locks plan's "Not done here" are superseded; lock 5 is kept; D-159 is implemented, not superseded (spec §8.3 to §8.5).
- **D-5717** — `upstream-token-by-descriptor` (Task CB3g): the upstream lane's token reaches Claude Code on a file descriptor ccd opens at spawn from the roster's `exec.secretsFile`, after an owner and mode check, with only the descriptor variable exported; the launcher reads no secret (decision 11). If M4 finds no descriptor variable that fits, the task stops and the question returns to the operator; `apiKeyHelper` and the environment were not taken.
- **D-5718** — `prune-keeps-what-runs` (Task CB3h): the adopted prune keeps the candidate, every target and previous target, the pin, every build a roll record names and every build a live process executes, and the 3 newest smoked non-halted builds by version; it deletes nothing on a failed `/proc` scan; a roll holds the install lock shared, so no prune runs while a roll needs its `from` (spec §8.5).
- **D-5719** — `claude-bootstrap-operator-act` (Task CB3i): a node with no Claude Code build is bootstrapped once, by the operator, interactively in `ccrc install`, from the signed manifest, verified and smoked before anything may select it; the timer never bootstraps (decision 15, spec §8.6).
- **D-5720** — `claude-controls-in-settings` (Task CB3j): the Claude Code card gains channel, Pin and Unpin on Settings → Updates, and the Claude Code mode (`off`, `manual`) sits under Automation; each control is checked from the server's answer and answers in a result line, and Pin is a danger confirm (decision 14; the Settings plan's C5).

## Out of scope

Lane self-update (W4); automatic rolls, halts and the retreat's one-tap pin (W5); a per-session pin; a version-keyed table of first-run gates.
