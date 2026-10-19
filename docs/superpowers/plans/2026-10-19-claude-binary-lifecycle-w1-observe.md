# Claude Code binary lifecycle, wave 1: observe — the lexicon, the deny rules, the operator's switches, the installer in measure mode, the tenth node file, the running build against its target, the card chip and the Settings card — Implementation Plan

> **For agentic workers:** one PR per task, in the order of §Landing order, each dispatched only when its row in §Gates is all green. To execute a task, REQUIRED SUB-SKILL: superpowers:subagent-driven-development, with superpowers:test-driven-development for every red-first step. Steps use checkbox (`- [ ]`) syntax. Workers do not edit §Deviations and decisions. A departure is named by slug in the task's report; the coordinator asks the allocator for a number (this programme's block has no spare) and enters it, never the worker.

**Spec:** `docs/superpowers/specs/2026-10-18-claude-binary-lifecycle-design.md` (rev 3, approved by the operator 2026-10-19). Every section binds this plan; the ones each task builds are named in its header. Read the named section before Step 0.

**Status:** rev 1 (2026-10-19): rev 0 with two reviews applied (§Review log). **The spec was approved by the operator 2026-10-19**, in their words: "all cards accepted/answered" (the sixteen decisions of its §13, each at its recommended option). This plan was written in the same docs PR as the spec's rev 3, the other four wave plans and the ledger (`docs/superpowers/programs/claude-binary-lifecycle.md`). Tasks dispatch as their gates open.

**Inputs.** The spec's §6 (observe), §7.6 (who may roll), §8.1 (the installer, measure mode), §10.4 (the switches), §11 and §11.1 (M1), §12; the operator's rulings 1, 5, 6, 13 and 14 (spec §13); the Settings plan (`2026-10-18-settings-redesign.md`: R2b1's `SettingsDataProvider`, R2b2's ordered card list, its C5, answered); the skins W2 plan (`2026-10-18-ccrc-skins-w2-shells.md`: S7a's `sessionHeaderView`, S16's `FactsSection`); the centralised update design (`2026-09-20-centralised-update-management-design.md`: one writer per `nodes` column group, the node-file admission rules).

**Base:** `origin/main` `f82d0c015` (#701). Code is cited by file and by function, constant or selector, with `≈` line hints measured at that sha. The spec's own hints are at `976bc459` and have drifted (for example `_spawn_start`, spec ≈:23271, is ≈:22885 here). Step 0 of each task re-grounds them by content on the tree it starts from.

**Deploy class.** CB1b, CB1c and CB1d are **AGENT-FIRST** (`ccd`, `ccrc`, the session hooks and new units reach the fleet node first; the server lane follows). CB1e is AGENT-FIRST (the agent admits the tenth node file before the server reads it). CB1a and CB1f are server lane and additive. CB1g and CB1h are PWA (inside the server's release). No task bumps `FLEET_PROTO`. **Nothing in this wave restarts a session, changes what a launcher runs, installs a build or reads a credential.**

**Names.** Tasks are **CB1a** to **CB1h**. Later waves: CB2a to CB2h (`…-w2-roll.md`), CB3a to CB3j (`…-w3-install.md`), CB4a (`…-w4-self-update-off.md`), CB5a to CB5c (`…-w5-auto-roll.md`). Operator acts are **OA-1** to **OA-6** (the ledger). Settings plan tasks are R0 to R5; skins W2 plan tasks S0 to S18; the hibernation plan (`2026-10-16-working-state-and-interruptions.md`) Tasks 15b to 19.

**Goal, PR by PR.**

| After | The operator sees | Underneath |
|---|---|---|
| `main` | nothing about Claude Code builds | sessions' own updaters install builds; nobody owns them |
| CB1a | unchanged | `shared/claudeVersion.ts`: the version grammar, channels, modes, lane kinds, the closed `why` enum, the comparator, the node-file parser |
| CB1b | unchanged | `ccd roll`, `ccd claude …`, `claude install`/`update` and writes to the build directory and the launcher are denied to sessions and children |
| CB1c | unchanged | the operator's `ccd claude` switch verbs and `_mem_headroom`; no reader of any switch yet |
| CB1d | unchanged | the installer runs every 30 min in measure mode: verifies and smokes the builds on disk, publishes the candidate, writes `~/.ccrc/claude.json` |
| CB1e | unchanged | the agent admits `claude.json`; the inventory sweep stores it in the `nodes` `claude*` columns |
| CB1f | unchanged (fields unread) | `FleetSession.claude` and the Updates view's `claude` block |
| CB1g | the card chip `cc .296` on a behind session; the Claude Code fact in the facts section and header view | none |
| CB1h | the Claude Code card on Settings → Updates, read-only | none |

---

## Gates: what each task waits for, stated honestly

Measured on 2026-10-19 at `f82d0c015` with `gh pr list -R Synapsium-Labs/ccrc-pwa --state open --json number,title,files` (26 open PRs; the dependency bumps edit only lockfiles and `package.json`, which no task here edits).

- **#435** (session continuity wave 4b) holds `ccd/ccd`, `ccd/ccrc-doctor-checks`, `server/test/ccdWsHelpers.ts`, `server/test/ccrc-doctor.test.ts` and `server/test/ccrc-codex-launcher.test.ts`. CB1c edits `ccd/ccd`; CB1d edits `ccd/ccrc`'s doctor and may need a `ccdWsHelpers.ts` helper. **Both wait for #435**, or the later PR absorbs the other with `git merge` and re-runs its suites; neither edits a file #435 holds before it merges.
- **#397** (path identity W1a, `CONFLICTING`) holds `server/src/fleet.ts`, `shared/api.ts`, `server/test/single-definition.test.ts` and `server/test/whitelist-subset.test.ts`, among sixty files. **#700** (a coordinator names its child) holds `shared/api.ts` and `server/src/ccdargv.ts`. CB1b edits `shared/api.ts` and `single-definition.test.ts`; CB1e edits `shared/agent-protocol.ts` (no open PR holds it); CB1f edits `server/src/fleet.ts` and `shared/api.ts`. **CB1b and CB1f wait for #397 and #700**, or for the coordinator to sequence them (the later PR merges `main` first).
- **#705** (`pwa/src/lib/api.ts`) **has merged** (`a720fbad0`); `origin/main` has since moved to `bd363a76b`. CB1h reads `/api/updates` through R2b1's `SettingsDataProvider`, not `lib/api.ts`; no gate remains.
- **Skins W2:** **S7a** (`sessionHeaderView`) and **S16** (`FactsSection`) are unbuilt and gate CB1g. **#627** has merged (`9b18fb0cd`), so `SessionHeader.tsx` is no longer frozen by it, but CB1g never edits `SessionHeader.tsx` (spec §6.3): it extends `sessionFacts` and the two views S7a and S16 create.
- **Settings:** R1a to R1c have merged (`59984b350` is R1c); **R2b1** (`SettingsDataProvider`, `/settings/updates`) and **R2b2** (Updates' cards rendered from one ordered list, C5) are unbuilt and gate CB1h.
- **M1** (spec §11.1, OA-1) gates CB1f's `exe` cross-check rule: the measurement says where "2.1.9x" comes from, and CB1f's `unmeasured` rule follows it.
- **Hibernation:** no task here waits for it, and nothing here reads or writes a hibernation marker.

| Task | #435 | #397 / #700 | #705 | Skins W2 | Settings | Other |
|---|---|---|---|---|---|---|
| CB1a lexicon | no | no | no | — | — | — |
| CB1b deny rules | no | **yes** (`shared/api.ts`, `single-definition.test.ts`) | no | — | — | CB1a |
| CB1c switch verbs, `_mem_headroom` | **yes** (`ccd/ccd`) | no | no | — | — | CB1b |
| CB1d installer, measure mode | **yes** (`ccd/ccrc` doctor, `ccdWsHelpers.ts`) | no | no | — | — | CB1a, CB1c |
| CB1e tenth node file, columns | no | no | no | — | — | CB1d (the file exists on a node) |
| CB1f `FleetSession.claude`, Updates view | no | **yes** (`fleet.ts`, `shared/api.ts`) | no | — | — | CB1e; **OA-1** (M1) |
| CB1g chip and facts | no | no | no | **S7a, S16** | — | CB1f |
| CB1h Settings card, read-only | no | no | merged | — | **R2b1, R2b2** | CB1f |

## In flight, and what it fences off

| In flight | Files it changes that this plan would otherwise touch | Tasks it gates |
|---|---|---|
| #435 | `ccd/ccd`, `ccd/ccrc-doctor-checks`, `server/test/ccdWsHelpers.ts`, `server/test/ccrc-doctor.test.ts` | CB1c, CB1d |
| #397 | `server/src/fleet.ts`, `shared/api.ts`, `server/test/single-definition.test.ts`, `server/test/whitelist-subset.test.ts` | CB1b, CB1f |
| #700 | `shared/api.ts`, `server/src/ccdargv.ts` | CB1b, CB1f |

No open PR holds `ccd/ccrc` (outside its doctor checks file), `shared/agent-protocol.ts`, `agent/src/whitelist.ts`, `server/src/update/inventory.ts`, `server/src/coord/schema.ts`, `server/src/coord/store.ts`, `server/src/coord/approvalguard.ts`, `ccd/install-session-hooks.sh`, `server/src/update/routes.ts` or `pwa/src/session/sessionFacts.ts`. Each task re-reads every list at Step 0.

## Landing order

```
CB1a (lexicon) ── CB1b (deny rules) ── CB1c (switches; after #435) ── CB1d (installer, measure; after #435)
                                                                         └── CB1e (node file) ── CB1f (server reads; after #397/#700 and OA-1)
                                                                                                   ├── CB1g (chip, facts; after S7a, S16)
                                                                                                   └── CB1h (Settings card; after R2b1, R2b2)
```

The fleet half (CB1b's hook twin, CB1c, CB1d, CB1e's agent half) deploys AGENT-FIRST: the fleet agent's lane, then the server's. CB1e's server half deploys only after the agent half is live on every fleet node (an absent file is "no columns", so the order is safe either way, but the census expects ten names on both sides).

## Global constraints

Every task's requirements include this section. `CLAUDE.md` is the authority; this is its working subset for the programme, and the later wave plans bind it by reference.

- **Public repository.** Every line, fixture, commit message and PR body is public. Fixtures use neutral names: nodes labelled `fleet` and `server`, lanes `lane-a` and `lane-b`, the upstream id `upstream-a`, projects `project-a`. No hostnames, IPs, tailnet names, account or lane names, emails, absolute home paths, other project names or people's names. Paths are written `~/.ccrc/…`, `$REG/…`, `~/.local/share/claude/versions/…`. `server/test/topology-clean.test.ts` stays green.
- **SAFETY.** Nothing here runs `ccd` against the live `$HOME`, touches tmux, a live pane, `~/.cc-sessions`, `~/.cc-limits` or a `claude-session@*` unit, or runs `ws-expire`, `ws-reclaim` or `ws-reap`. Every `ccd` and `ccrc` test uses `makeCcdHarness` fixture HOMEs (`server/test/ccdWsHelpers.ts`). No task runs `claude install`, `claude update` or a downloaded build outside a fixture HOME; the installer's tests stub `claude` and `curl` on `PATH`. A measurement on the fleet node is an operator act (OA-1), read-only, named with the SAFETY rule in the ask.
- **No herd, ever.** Nothing in this wave restarts anything. Later waves inherit: every restart goes through `ccd roll`'s gate, one at a time per node, behind the memory gate and the 120 s `recent-spawn` hold (spec §7.4); 74 of 194 measured OOM kills came within 120 s of a restart.
- **The operator's account switching and the auto-swap are never blocked** (operator ruling 2026-10-19). No task adds a refusal, lock or wait to `cmd_swap` or the auto-swap's path; CB1b's deny rules name only the roll, install and build-selection verbs.
- **No root runner.** Run cd'd into a package: `cd server && ./node_modules/.bin/vitest run test/<file> --maxWorkers=2`. Never bare `npx vitest` at the root, never the full server suite; one suite at a time, in the foreground, with a timeout of at least 600000 ms. `cd ui && npm ci` before `cd pwa && npm ci`.
- **Every width, both skins, both modes** (PWA tasks). CB1g and CB1h check 360, 390, 1280 and 1920 × Refined and Instrument × dark (Phosphor & Ink) and light (Phosphor Daylight), 16 cells each, every cell ✓ or a note in the PR body; the Settings card also checks the Settings plan's 438, 900, 1024 and 1440 widths, as every Settings PR does. A desktop-only interim is not acceptable.
- **Mutation discipline.** Every guard ships with a test that goes red when the guard is deleted and when it is made wrong. Each mutation table is RUN: apply the mutant, run the named suite alone, record the red line in the PR, restore with `git checkout -- <file>`. Never commit a mutant.
- **Wire discipline.** Additive, absence-permits, one reader per field; an older server ignores a field, an older PWA renders nothing for it.
- **coord.db.** One `MIGRATIONS` entry per task that needs one; an `ALTER TABLE … ADD COLUMN` with no `NOT NULL` and no `CHECK` on a token a newer build writes, or a new table, so a rollback stays bootable (`db.ts` rule 3).
- **Leak hygiene** (spec §6.2, §9 trap 9). Installer stderr reaches only the node's journal, never `claude.json`, an API answer or a test snapshot. Nothing reads `/proc/<pid>/environ` or `cmdline`; the pid map reads only `readlink /proc/<pid>/exe`.
- **Band routing.** Band 1: mechanical. Band 2: spec-able, reviewed by one reviewer. **Band 3: anything that installs or verifies binaries, restarts sessions, selects what a launcher runs, or touches credentials or the deny rules; written and reviewed natively, never handed off, and reviewed by two reviewers**, one of them reading only the security lens (§Review focus). Each task's header names its band.
- **Deviation ledger.** This plan defines D-5695 to D-5702 (§Deviations and decisions) and never allocates. No tracked file carries a concrete `D-TBD` placeholder (`dtbd.test.ts`).
- **Branch discipline.** One commit per task on the workspace's own branch; absorb `main` only with `git merge`; every commit leaves the suites it touches green.

## Review focus (the failure modes most likely to bite)

1. **A session that can still install or roll.** The TypeScript lists and the bash twin must be equal, and `ccd roll` must be a deny, not an approvable prompt, under default-escalate (CB1b).
2. **A switch an automatic path can write.** Every `ccd claude` switch verb refuses inside a session (`CLAUDECODE` set) and is the only writer of its marker; `single-definition.test.ts` pins the writers (CB1c).
3. **A memory measure that reads page cache, or the wrong level.** `_mem_headroom` is the minimum, over the slice and each ancestor up to and including the user tree, of that level's `memory.max` minus its **own** `memory.stat` `anon`; `memory.current` and `memory.peak` are forbidden (Task 19's stop rule). Reading the slice's `anon` against an ancestor's cap fails open on today's tighter user tree (CB1c).
4. **A verification that trusts an exit code or an unsigned manifest.** The measure run compares size and SHA-256 only against a manifest whose signature `gpgv` verified with the committed keyring; a 0-byte placeholder is never smoked or listed (CB1d).
5. **A leak through the node file.** Installer stderr, a URL with a query, a path under another HOME or an environ value in `claude.json` is a STOP (CB1d, CB1e).
6. **A census that moves on one side only.** NODE_FILES gains `claude` once, and every census pinning nine moves to ten in the same PR (CB1e).
7. **A chip that says "updated".** The chip shows only `behind`, `on-halted` and a failed roll; nothing says "updated" until the running build moves (spec §9 trap 1) (CB1g).
8. **A card that reads twice.** The Settings card adds its fields to the provider's single `/api/updates` read and makes no request of its own (CB1h).

## Tasks

### Task CB1a: the Claude Code version lexicon (D-5695; spec §6.2's `why`, §10.2's vocabulary, §12's floor) — lands now

**Routing:** band 2 (pure functions with an enumerated test list). **Lane:** server (shared code; no deploy effect until a reader lands). **Needs:** nothing.

**Files:**
- Create `shared/claudeVersion.ts`: `CLAUDE_VERSION` (`/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/`), `isClaudeVersion`, `compareClaudeVersions(a, b)` (numeric per part; throws on a non-version, as `compareReleaseTags` does for tags), `ClaudeChannel = 'latest' | 'stable'` with `CLAUDE_CHANNEL_DEFAULT = 'latest'` (decision 1), `ClaudeRollMode = 'off' | 'manual' | 'auto'` with `CLAUDE_ROLL_MODE_DEFAULT = 'manual'` (decision 3), `ClaudeLaneKind = 'anthropic' | 'codex'`, `ClaudeInstallWhy` (the closed sixteen of spec §6.2, as a `const` tuple and its type), `CLAUDE_MIN_BUILD = '2.1.277'` (with a comment naming `liveStatusCoversDelegation`, `server/src/livestate.ts` ≈:95, as the floor's source), `CLAUDE_ROLL_AFTER_MINUTES = { default: 90, min: 15, max: 1440 }` (decision 2), `CLAUDE_HEADROOM_GATE_BYTES = 3 * 2**30` (decision 6), and `parseClaudeNodeFile(text): ClaudeNodeFile | null` for spec §6.2's document (rev 3 shape: `switches`, `rollAfterMinutes`, the swap figures), returning `null` for anything that is not the version-1 shape and dropping, never echoing, unknown keys.
- Create `server/test/claude-version.test.ts`.
- Modify `server/test/single-definition.test.ts`: the version regex and the floor are defined once, in `shared/claudeVersion.ts` (a scan of `server/src`, `agent/src`, `pwa/src` and `shared/` for a second `2.1.277` literal or a second copy of the regex body). **Frozen:** #397 holds this file; if #397 is still open, this one case moves to CB1b, which waits for #397 anyway, and the PR says so.

- [ ] **Step 0: Re-ground.** Read `compareReleaseTags` and `RELEASE_TAG` (the update plane's ccrc-shaped twins) and `liveStatusCoversDelegation` (`server/src/livestate.ts` ≈:95); confirm the floor literal there.
- [ ] **Step 1: Red.** `claude-version.test.ts`: `2.1.302` > `2.1.99` (the lexical trap of spec §2.5); `2.1.9` < `2.1.10`; `02.1.3`, `2.1`, `2.1.3-beta`, `v2.1.3`, `2.1.3\n` refused; `compareClaudeVersions` throws on a non-version; the `why` tuple has exactly the sixteen names in spec order; the defaults are `latest`, `manual`, 90 and 3 GiB; `parseClaudeNodeFile` accepts the spec's sample, refuses `v: 2`, a `running` entry with a non-integer pid, a `builds[].v` that is not a version, a `why` outside the enum, and a `rollAfterMinutes` outside 15 to 1440; it drops an unknown key; it never returns installer stderr (a `stderr` key is dropped). Each is red against `main` (no module).
- [ ] **Step 2: Green.** Write the module.
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `compareClaudeVersions` compares strings | claude-version | "2.1.302 > 2.1.99" |
  | the regex admits a leading zero | claude-version | "`02.1.3` refused" |
  | the regex loses its `$` | claude-version | "`2.1.3\n` refused" |
  | `parseClaudeNodeFile` passes unknown keys through | claude-version | "drops an unknown key" |
  | a seventeenth `why` added | claude-version | "exactly the sixteen" |
  | `CLAUDE_CHANNEL_DEFAULT` set to `stable` | claude-version | "the defaults" |
  | a second `2.1.277` literal added in `server/src/livestate.ts` | single-definition | "the floor is defined once" |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/tsc --noEmit
      cd server && ./node_modules/.bin/vitest run test/claude-version.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts --maxWorkers=2

**Not in this task:** the coord tables (CB3a), any reader of the node file (CB1e).

### Task CB1b: who may roll, install or select a build (D-5696; spec §7.6) — GATED: after CB1a, #397 and #700

**Routing:** band 3, **two reviewers** (the deny rules are the wall between a session and the fleet's binaries; one reviewer reads only the security lens, Review focus 1). **Lane:** AGENT-FIRST (the hook twin reaches the fleet node through `ccrc install` before the server's guard; either order is safe, because each side only adds denials). **Needs:** CB1a; #397 and #700 merged (`shared/api.ts`, `single-definition.test.ts`).

**Files:**
- Modify `server/src/coord/approvalguard.ts`: `FORBIDDEN_CCD_VERBS` (≈:122) gains `roll` and `claude`; `FORBIDDEN_PATTERNS` (≈:194) gains a write into `/.local/share/claude/versions` and a write to the launcher path (`/.local/bin/` followed by the roster's upstream id, matched by the shape of the path, never a literal lane name). The registry-path pattern already covers `~/.ccrc/claude-*` and `$REG/claude-roll-*`; a case proves it.
- Modify `shared/api.ts`: `CHILD_DENY_CCD_VERBS` (≈:11174) gains `roll` and `claude`; `CHILD_DENY_RULES` (≈:11193) gains `Bash(claude install:*)` and `Bash(claude update:*)`, the same under every head `childDenyHeads` yields for the upstream id, and the path-qualified forms.
- Modify `ccd/install-session-hooks.sh` (the bash twin, ≈:152): the same verbs and rules.
- Modify `CLAUDE.md`'s SAFETY list: `ccd roll`, `ccd claude …`, `claude install` and `claude update`, and writes to the build directory and the launcher are forbidden to every session; the operator's switch verbs are the operator's.
- Modify `server/test/ccd-spawn-child-settings.test.ts`, `server/test/install-session-hooks.test.ts` (the twins equal), `server/test/approvalguard.test.ts` and `server/test/single-definition.test.ts`.

- [ ] **Step 0: Re-ground.** Read both lists and the twin; read how `ccd ws-reclaim` was added to both (its PR is the model). Confirm `ccd-spawn-child-settings.test.ts` and `install-session-hooks.test.ts` still compare the twins byte for byte.
- [ ] **Step 1: Red.** "a child's `ccd roll <id> --to 2.1.302 --expect t` is a deny, not an approvable prompt"; "a child's `ccd claude roll-live on` is a deny"; "`claude install 2.1.302` and `claude update` are denied to a child, under the upstream id's name too"; "a write into `~/.local/share/claude/versions/2.1.302` is forbidden"; "a write to the launcher path is forbidden; a write to `~/.local/bin/ccd` is not newly forbidden by this rule"; "the bash twin equals the TypeScript list"; "`~/.ccrc/claude-intent` and `$REG/claude-roll-live` writes are already forbidden by the registry pattern". Red against `main`.
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `roll` dropped from `CHILD_DENY_CCD_VERBS` only | install-session-hooks | "the bash twin equals" |
  | `roll` dropped from both | ccd-spawn-child-settings | "a child's `ccd roll` … is a deny" |
  | `claude` dropped from `FORBIDDEN_CCD_VERBS` | approvalguard | "`ccd claude roll-live on` is a deny" |
  | the versions-directory pattern removed | approvalguard | "a write into … versions … is forbidden" |
  | the launcher pattern matches every `~/.local/bin/*` | approvalguard | "… `ccd` is not newly forbidden" |
  | `claude update` dropped from `CHILD_DENY_RULES` | ccd-spawn-child-settings | its case |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/tsc --noEmit
      cd server && ./node_modules/.bin/vitest run test/ccd-spawn-child-settings.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/install-session-hooks.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts --maxWorkers=2

**Not in this task:** `ccd swap` and any account verb (the 2026-10-19 ruling: account switching and the auto-swap are never blocked; a case asserts `ccd swap` is unchanged by this PR).

### Task CB1c: the operator's switches and the memory measure (D-5697; spec §10.4, §8.2, §6.2's `memory`, §7.2's `hibernation-arming`) — GATED: after CB1b and #435

**Routing:** band 3 (markers that stop rolls and installs; the memory measure the roll gate trusts). **Lane:** AGENT-FIRST (FLEET: `ccd`). **Needs:** CB1b (the verbs are denied to sessions before they exist); #435 merged (`ccd/ccd`).

**Files:**
- Modify `ccd/ccd`: a new `cmd_claude` (dispatch beside `cmd_hibernate`, ≈:28204) with exactly the writing subverbs `install-disable | install-enable | roll-disable | roll-enable | roll-live on | roll-live off | self-update keep | self-update release | shadow-week on | shadow-week off`, each writing or removing one marker (`$REG/claude-install-disabled`, `$REG/claude-roll-disabled`, `$REG/claude-roll-live`, `$REG/claude-self-update-kept`, `$REG/hibernate-shadow-week`) with `_reg_set`-style atomic writes, journalled `_lc_done claude "" "" sub <subverb> actor <text>`, refusing with exit 4 inside a session (`CLAUDECODE` set) and inside a `cc-*` pane, the speed bumps `ccrc history`'s writing verbs use. `roll-live on` also refuses while `$REG/hibernate-live` is younger than 24 h or `$REG/hibernate-shadow-week` is younger than 8 days (decision 13; the act path's own `hibernation-arming` hold is CB2c's and CB5a's). The read-only subverb `ccd claude mem` prints `_mem_headroom`'s line and writes nothing; it is how the installer (CB1d) and the operator reach the one definition, and it is denied to sessions with the rest of `ccd claude` (CB1b). `cmd_caps` (≈:8487) lists `claude`.
- Modify `ccd/ccd`: `_mem_headroom` (new, beside `_operator_choice_keep` ≈:21202): for every level L from the session slice up to and including the user tree, reads L's own `memory.stat` `anon` and L's `memory.max` (a level reading `max` is skipped), takes the minimum of `max(L) − anon(L)`, and prints `anonBytes ceilingBytes ceiling swapUsed swapTotal` for the binding level (swap from that level's `memory.swap.current` and `memory.swap.max`, `-` when unreadable). It never reads `memory.current` or `memory.peak`.
- Create `server/test/ccd-claude-switches.test.ts`, `server/test/ccd-mem-headroom.test.ts` (a fixture cgroup tree under the harness HOME, the path injected through one variable read only by `_mem_headroom`).
- Modify `server/test/lifecycle-vocabulary.test.ts` (the `claude` act joins `_LC_ACTS` ≈:4368 and `LifecycleAct` in `shared/api.ts` ≈:7598 together; it is deliberate for the dead-coordinator lane because it touches no session) and `server/test/single-definition.test.ts` (each marker has exactly one writer, `cmd_claude`; `$REG/<id>.no-roll` has none, decision 4).

- [ ] **Step 0: Re-ground.** Read `cmd_hibernate`'s argument parsing and `_lc_done`/`_lc_fail` (≈:5020); read how `ccrc history` refuses inside a session; read the harness's fixture cgroup support, if any (otherwise add the one variable).
- [ ] **Step 1: Red.** Switches: each subverb writes or removes exactly its marker; a second `install-disable` is idempotent; an unknown subverb exits 2 and writes nothing; `CLAUDECODE=1` refuses every subverb with exit 4 and writes nothing; `roll-live on` refuses with `hibernate-live` 1 h old and succeeds with it 25 h old or absent; each act writes one journal row with its actor; `ccd caps` lists `claude`. Headroom: a fixture with the slice at 16.4 of 24 GiB and the user tree at 25.3 of 26 GiB reports the user tree as the ceiling with about 0.7 GiB of headroom (below the 3 GiB gate); a fixture whose slice is the tighter reports the slice; a level reading `max` is skipped; `ccd claude mem` prints the same line and writes nothing; `shadow-week on` then `roll-live on` refuses; a missing `memory.stat` prints nothing and exits 1 (fail closed); a fixture whose `memory.current` is near the cap and whose `anon` is low reports the `anon` figure.
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | the `CLAUDECODE` refusal removed | ccd-claude-switches | "refuses every subverb with exit 4" |
  | `roll-live on`'s 24 h check removed | ccd-claude-switches | "refuses with `hibernate-live` 1 h old" |
  | `roll-disable` writes `claude-roll-live` | ccd-claude-switches | its case |
  | `_mem_headroom` reads `memory.current` | ccd-mem-headroom | "reports the `anon` figure" |
  | the ancestor walk stops at the slice | ccd-mem-headroom | "the user tree as the ceiling" |
  | only the slice's `anon` read, against every level's cap | ccd-mem-headroom | "about 0.7 GiB" |
  | `roll-live on` ignores `hibernate-shadow-week` | ccd-claude-switches | "`shadow-week on` then `roll-live on` refuses" |
  | a missing `memory.stat` prints zero headroom | ccd-mem-headroom | "exits 1 (fail closed)" |
  | a second writer of `claude-roll-live` added in `cmd_ensure` | single-definition | "exactly one writer" |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/ccd-claude-switches.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccd-mem-headroom.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/lifecycle-vocabulary.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts --maxWorkers=2
      bash -n ccd/ccd

**Not in this task:** any reader of the switches (the installer, CB1d; `ccd roll`, CB2c; the spawn line, CB4a; the server's sweep, CB5a).

### Task CB1d: the ccrc-owned installer in measure mode (D-5698; spec §8.1 "W1 measure mode", steps 1, 5, 6 and 7, §6.2) — GATED: after CB1c and #435

**Routing:** band 3, **two reviewers** (verifies binaries and their signatures; runs a downloaded binary's `--version`). **Lane:** AGENT-FIRST (FLEET: `ccrc install` places the script and its units on `fleet` and `both` nodes only). **Needs:** CB1a (the grammar it re-validates with, through a generated `jq` program), CB1c (`ccd claude mem`, the install switch); #435 merged.

**Files:**
- Create `ccd/ccrc-claude-install` (bash): `--measure` only in this task (any other mode exits 2: "install mode is CB3e"). Under `env -i` with the allow-list `HOME`, `PATH`, `LANG`, `CLAUDE_CONFIG_DIR=~/.ccrc/claude-installer/cfg`, and `HTTPS_PROXY` only when the inventory declares one; cwd `~/.ccrc/claude-installer/cwd`; stdin `/dev/null`; `flock -x ~/.ccrc/claude-install.lock` for the whole run. Each run: the install switch (`disabled`); resolve the channel pointer (the intent's channel when a projection exists, else `latest`, decision 1) with spec §8.1 step 2's `curl` limits; for **every build on disk** that is non-empty and executable: fetch its manifest and signature (64 KiB cap), `gpgv` against `deploy/claude-release-keyring.gpg`, then size and SHA-256 against the verified manifest only, then the smoke (`--version` under a throwaway HOME and config dir, 30 s, must print `<v> (Claude Code)`); append passing builds to `~/.ccrc/claude-smoked`; write the newest passing, non-halted, at-or-above-floor build to `~/.ccrc/claude-candidate`; write `~/.ccrc/claude.json` (spec §6.2, rev 3.1) atomically, mode 0600, with the pid map from `readlink /proc/<pid>/exe` only, the switch states (with the adoption marker and the ages of `hibernate-shadow-week` and `hibernate-live`), `rollAfterMinutes` and the memory block from `ccd claude mem`'s output (the one definition; the installer never re-implements the walk). It installs nothing, writes no target and prunes nothing.
- Create `deploy/claude-release-keyring.gpg` (the public key), with its fingerprint recorded in the script's header comment and in the PR body; Step 0 measures it (M5's fingerprint half).
- Create `deploy/systemd/ccrc-claude-install.service` (oneshot, `CPUWeight=10`, `ExecStart=%h/.local/libexec/ccrc/ccrc-claude-install --measure`) and `deploy/systemd/ccrc-claude-install.timer` (`OnUnitActiveSec=30min`, `RandomizedDelaySec=5min`, `Persistent=true`).
- Modify `ccd/ccrc`: `_inst_bins` (≈:14129) places the script through `_inst_atomic` (≈:13916) on `fleet` and `both` roles only (the D-3111 role gate); `_inst_units` (≈:14874) places and enables the two units beside `ccd-update-sync` (≈:14922); `cmd_uninstall` (≈:23070) removes them; `cmd_doctor` (≈:3650) reports the installer's last run (`last.result`, `why`, failures) from `claude.json`, never its stderr.
- Create `server/test/claude-installer-measure.test.ts` (fixture HOME; stub `curl`, `gpgv` and a fixture `versions/` of shell scripts that print `<v> (Claude Code)`; a fixture `/proc` root injected through one variable). Modify `server/test/install-census.test.ts` (the new bin and units, per role) and `server/test/ccrc-uninstall.test.ts`.

- [ ] **Step 0: Re-ground and measure.** Read `_inst_bins`, `_inst_units` and the role gate. In a development fixture (no fleet node): fetch the release manifest and its signature for one current build, and the published signing key from the vendor's documentation; record the documented fingerprint and check the downloaded key against it. If no published fingerprint can be found, STOP: the keyring is not committed and the coordinator returns the question to the operator (the measure run would report `sigok: null` for every build, which CB1g and CB1h must then show).
- [ ] **Step 1: Red.** "the scrubbed environment carries only the allow-list" (the stub prints its environ to a fixture file; an `ANTHROPIC_*`, `XDG_*` or `DISABLE_*` variable in the caller's environment never reaches it); "a build whose manifest signature fails is `sigok: false` and never smoked"; "a size or checksum mismatch is `sha256ok: false`"; "a 0-byte placeholder is never smoked or listed"; "2.1.302 is the candidate over 2.1.99" (version order, not lexical); "a build below 2.1.277 is never the candidate"; "an unreachable pointer reports `pointer-unreachable` and keeps the candidate"; "`claude-install-disabled` reports `disabled` and changes nothing"; "measure mode writes no `claude-target`, installs nothing (the `claude` stub is never called with `install`) and deletes nothing"; "stderr of a failing `gpgv` is absent from `claude.json`"; "the pid map reads only `exe` links"; "`claude.json` is mode 0600 and parses with `parseClaudeNodeFile`"; "the units are placed on `fleet` and `both`, not on `server`"; "uninstall removes them".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `env -i` dropped | claude-installer-measure | "carries only the allow-list" |
  | the checksum compared before the signature is verified | claude-installer-measure | "signature fails … never smoked" |
  | `-s` dropped from the build filter | claude-installer-measure | "a 0-byte placeholder" |
  | `sort -V` replaced by a lexical sort | claude-installer-measure | "2.1.302 … over 2.1.99" |
  | the floor check removed | claude-installer-measure | "below 2.1.277" |
  | measure mode writes `claude-target` | claude-installer-measure | "writes no `claude-target`" |
  | stderr appended to `last.why` | claude-installer-measure | "stderr … absent" |
  | the role gate dropped | install-census | "not on `server`" |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/vitest run test/claude-installer-measure.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/install-census.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/ccrc-uninstall.test.ts --maxWorkers=2
      bash -n ccd/ccrc-claude-install ccd/ccrc

**Not in this task:** install mode, promotion, the proven marker, backoff, the prune (CB3e, CB3h); the node file's agent admission (CB1e).

### Task CB1e: the tenth node file and the `nodes` Claude Code columns (D-5699; spec §6.2) — GATED: after CB1d

**Routing:** band 2 (an additive census move and one migration). **Lane:** AGENT-FIRST (the agent admits the file; the server's inventory reads it). **Needs:** CB1a (`parseClaudeNodeFile`), CB1d.

**Files:**
- Modify `shared/agent-protocol.ts`: `NODE_FILES` (≈:170) gains `claude: 'claude.json'`; the "nine names" comment says ten.
- Modify `server/src/update/inventory.ts`: `MEASURED_FILE_KEYS` (≈:90) gains `claude`; the sweep parses it with `parseClaudeNodeFile` and hands the measurement on (an unparseable file is "no columns", never an error row).
- Modify `server/src/coord/schema.ts`: one `MIGRATIONS` entry (after the last, ≈:63's array) adding the nullable columns of spec §6.2 to `nodes`, plus `claudeSwitches` (JSON) and `claudeRollAfterMinutes`.
- Modify `server/src/coord/store.ts`: `upsertNodeMeasurement` (≈:8027) writes the `claude*` group, its one writer, and leaves the group untouched when the file is absent (a node that never ran the installer keeps nulls).
- Modify the census tests that pin nine: Step 0 lists them (`grep -rln NODE_FILES server/test agent/test`; at `f82d0c015`: `single-definition`, `doctor-box-token`, `ccrc-token-sync`, `inventory-identity`, `update-projection`, `fleet-identity-composition`, `token-rotation-real-verb`, `push-copy`, `ccrc-uninstall`, `install-census`). Each moves to ten; none is weakened.
- Create `server/test/inventory-claude.test.ts`.

- [ ] **Step 0: Re-ground.** Read the agent's admission of `NODE_FILE_BASENAMES` and the 64 KiB cap; read one existing column group's writer and its migration.
- [ ] **Step 1: Red.** "a node whose `claude.json` names candidate 2.1.302 stores `claudeCandidate` 2.1.302"; "an absent file leaves the group null"; "an unparseable file leaves the group as it was and logs one line"; "a file over 64 KiB is refused by the agent"; "the migration adds columns only, all nullable"; "an older `user_version` file boots" (the rollback shape); the censuses at ten.
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `claude` left out of `MEASURED_FILE_KEYS` | inventory-claude | "stores `claudeCandidate`" |
  | an absent file writes nulls over existing values | inventory-claude | "leaves the group as it was" (the unparseable case) |
  | a column declared `NOT NULL` | inventory-claude | "columns only, all nullable" |
  | the census in `install-census` left at nine | install-census | its count |

- [ ] **Step 4: Verify.** Each census suite of Step 0 alone, then:

      cd server && ./node_modules/.bin/tsc --noEmit
      cd server && ./node_modules/.bin/vitest run test/inventory-claude.test.ts --maxWorkers=2
      cd agent && ./node_modules/.bin/tsc --noEmit

**Not in this task:** any wire field (CB1f).

### Task CB1f: the running build against its target, on the wire (D-5700; spec §6.1, §6.3's Settings fields) — GATED: after CB1e, #397, #700 and OA-1

**Routing:** band 2. **Lane:** server, additive. **Needs:** CB1e; #397 and #700 merged (`fleet.ts`, `shared/api.ts`); **OA-1** (M1: where "2.1.9x" comes from, so the `unmeasured` rule is the measured one).

**Files:**
- Modify `shared/api.ts`: `FleetSession` (≈:91) gains optional `claude?: ClaudeSessionFact` (spec §6.1: `kind`, `target`, `targetIsCandidate`, `candidate`, `exe`, `state`, `roll`), `roll` always `null` in this wave; `UpdatesView` (≈:9466) gains optional `claude?: ClaudeUpdatesView` (per node: candidate, target per kind, latest and stable from the pointer, builds with `sigok`, `sha256ok`, `smoke`, `halted`, `running`; the counts behind, current, on-halted, unmeasured; the last run with its `why` and failures; `selfUpdateOff` and `switches`; headroom and swap; `intentAt`).
- Modify `server/src/fleet.ts` (≈:587-767, where `version` is composed): compose `claude` from the session's node row: `kind` from the lane (`codex` when the roster account is a Codex lane, else `anthropic`), `target` (the pair target, or the candidate with `targetIsCandidate` while no target exists), `exe` from the pid map, and `state` by spec §6.1 with M1's rule for `unmeasured`; `asleep` for a hibernated row.
- Modify `server/src/update/routes.ts`: `GET /api/updates` (≈:581) composes `claude` from the `nodes` rows.
- Create `server/test/fleet-claude-fact.test.ts`; modify `server/test/fleet-health.test.ts` only if Step 0 finds it pins the session shape.

- [ ] **Step 0: Re-ground.** Read OA-1's result in the ledger; read how `version` and `liveCoversWorkflows` are composed (≈:642).
- [ ] **Step 1: Red.** "a session on 2.1.296 with candidate 2.1.302 is `behind`, `targetIsCandidate`"; "running equals target is `current`"; "a null version is `unmeasured`"; "a version below 2.1.277 is `unmeasured`"; "a version disagreeing with the pid's `exe` build is `unmeasured`" (M1's rule); "a hibernated row is `asleep`"; "a Codex lane's kind is `codex` and its target is the codex target"; "no node file: no `claude` field" (absence permits); "with a target 2.1.302 and a newer, un-canaried candidate 2.1.303, `candidate` is 2.1.303; once a canary row exists for it, `candidate` is absent"; "`GET /api/updates` carries the per-node block and the counts".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | the `exe` cross-check removed | fleet-claude-fact | "disagreeing … is `unmeasured`" |
  | the floor check removed | fleet-claude-fact | "below 2.1.277" |
  | `asleep` computed as `behind` | fleet-claude-fact | "a hibernated row is `asleep`" |
  | the kind always `anthropic` | fleet-claude-fact | "a Codex lane's kind" |
  | `claude` set to `{}` when no file exists | fleet-claude-fact | "no `claude` field" |

- [ ] **Step 4: Verify.**

      cd server && ./node_modules/.bin/tsc --noEmit
      cd server && ./node_modules/.bin/vitest run test/fleet-claude-fact.test.ts --maxWorkers=2
      cd server && ./node_modules/.bin/vitest run test/update-routes.test.ts --maxWorkers=2

**Not in this task:** the `roll` phase (CB2g); `on-halted` from halts (CB5b; until then no build is halted from the server).

### Task CB1g: the card chip and the Claude Code fact (D-5701; spec §6.3's card and facts, §6.4) — GATED: after CB1f, S7a and S16

**Routing:** band 2. **Lane:** PWA (server's release). **Needs:** CB1f; skins W2 **S7a** (`sessionHeaderView`) and **S16** (`FactsSection`) merged.

**Files:**
- Modify `pwa/src/session/sessionFacts.ts` (`sessionFacts` ≈:67): the facts gain `claude: { word, tone, chip } | null` from `FleetSession.claude`; the one PWA reader of both `version` and `claude`.
- Modify `pwa/src/session/sessionHeaderView.ts` (S7a creates it): the facts chip carries the Claude Code word when `sessionFacts` gives a chip.
- Modify `pwa/src/inspector/FactsSection.tsx` (S16 creates it): the Claude Code line.
- Modify the session card's chip row (Step 0 names the file S16 and #647 left; at `f82d0c015` the chips live in `pwa/src/fleet/chips.tsx`): `cc .296` only for `behind`, `on-halted` and a failed roll; neutral tone, warning tone for `on-halted` and failed.
- Create `pwa/test/claude-fact.test.tsx`.

- [ ] **Step 0: Re-ground.** Read S7a's and S16's merged files; find where a card chip is added (the glanceable-card rules, one legible context line, no truncation).
- [ ] **Step 1: Red.** The words of spec §6.3 (`Claude Code 2.1.296 → 2.1.302 · rolls when idle 90 min`, `version unmeasured`, `wakes on 2.1.302`); the chip `cc .296` when major and minor match, `cc 2.0.9` otherwise; no chip for current, ahead, unmeasured or asleep; "the card never grows a second line"; "whenever the card shows a chip, the facts show the same fact"; "no `claude` field renders nothing".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | the chip shown for `current` | claude-fact | "no chip for current" |
  | the full version always | claude-fact | "`cc .296` when major and minor match" |
  | `FactsSection` formats the word itself | claude-fact | the source scan "one reader" |
  | the word says "updated" | claude-fact | spec §9 trap 1's case |

- [ ] **Step 4: Per width × skin × mode** (16 cells: 360, 390, 1280, 1920 × Refined, Instrument × dark, light), against a fixture home with a behind, a current, an unmeasured and an asleep session. The chip sits in the chip row, which wraps; the phone header stays at S7c's height with one facts chip in its rail; the line sits in `FactsSection`. Each cell ✓ or a note.
- [ ] **Step 5: Verify.**

      cd pwa && ./node_modules/.bin/tsc --noEmit
      cd pwa && ./node_modules/.bin/vitest run test/claude-fact.test.tsx --maxWorkers=2
      cd pwa && ./node_modules/.bin/vitest run test/session-header-view.test.ts --maxWorkers=2

**Not in this task:** the Restart command (CB2h); the roll phases (CB2h reads them).

### Task CB1h: the Claude Code card on Settings → Updates, read-only (D-5702; spec §6.3's Settings, decision 14; the Settings plan's C5) — GATED: after CB1f, R2b1 and R2b2

**Routing:** band 2. **Lane:** PWA. **Needs:** CB1f; Settings **R2b1** (`SettingsDataProvider`, `/settings/updates`) and **R2b2** (Updates' cards from one ordered list).

**Files:**
- Create `pwa/src/screens/settings/ClaudeCodeCard.tsx`: a `Section({ scope: 'Whole fleet', title: 'Claude Code', purpose, children })`, prop-fed from the provider's `SettingsView`, no request of its own. Shows the channel and mode (read-only words in this wave), and per node: candidate, target per kind, latest and stable, installed builds with signature, checksum, smoke and halted words, the session counts, the last run with its `why` and failures, lane self-update off or kept, memory headroom and swap use (swap shown, never called a hold: decision 6), intent freshness, and the switches, read-only.
- Modify `pwa/src/screens/settings/UpdatesSection.tsx` (R2b1 creates it): one entry in R2b2's ordered list, between Nodes and Update policy (C5, answered).
- Modify `pwa/src/screens/settings/SettingsDataProvider.tsx`: `SettingsView.claude` from the existing `/api/updates` read.
- Modify `pwa/src/screens/settingsText.ts`: the card's words (purpose, the `why` sentences, one per enum member, a total record).
- Create `pwa/test/claude-code-card.test.tsx`.
- Modify `pwa/test/settings-updates.test.tsx` (R2b2 creates it): its order case becomes "the cards are Fleet version, Nodes, Claude Code, Update policy, in that order, from one list".

- [ ] **Step 0: Re-ground.** Read R2b1's provider and R2b2's ordered list; confirm the C5 slot.
- [ ] **Step 1: Red.** "the card sits between Nodes and Update policy"; "it makes no request of its own"; "every `why` has a sentence" (a total record over CB1a's tuple); "no node file: the card says not measured, never 'up to date'"; "swap is shown and never worded as a hold"; "a `sigok: null` build says signature not checked"; "the switches read on or off and offer no control".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | the card reads `/api/updates` itself | claude-code-card | "no request of its own" |
  | one `why` sentence removed | claude-code-card | "every `why` has a sentence" |
  | an absent block renders "Up to date" | claude-code-card | "never 'up to date'" |
  | the card placed after Update policy | claude-code-card | "between Nodes and Update policy" |

- [ ] **Step 4: Per width × skin × mode** (the Settings plan's 32 cells: 360, 390, 438, 900, 1024, 1280, 1440, 1920 × Refined, Instrument × dark, light): stacked per node below 760 with builds as a compact list; two columns at 1280 (fleet words, then a node table); the builds column inline at 1920; Instrument density in Instrument. Each cell ✓ or a note.
- [ ] **Step 5: Verify.**

      cd pwa && ./node_modules/.bin/tsc --noEmit
      cd pwa && ./node_modules/.bin/vitest run test/claude-code-card.test.tsx --maxWorkers=2
      cd pwa && ./node_modules/.bin/vitest run test/settings-updates.test.tsx --maxWorkers=2
      cd pwa && ./node_modules/.bin/vitest run test/settings-screen.test.tsx --maxWorkers=2

**Not in this task:** any control (channel, pin and mode are CB3j; Ack and the retreat pin are CB5c).

## Operator acts in this wave

- **OA-1 (before CB1f): M1, read-only, on the fleet node.** For every live session, `FleetSession.version` against `readlink /proc/<pid>/exe`, and the source of "2.1.9x". The ask names the SAFETY rule ("NEVER touch tmux, `~/.cc-sessions` … directly": nothing is touched; scripts are piped over stdin, nothing copied, no pane, unit or registry written). The result is entered in the ledger, and CB1f's `unmeasured` rule follows it.
- **The wave's deploys** follow the standing rule: AGENT-FIRST (the fleet agent's lane, then the server's), each from a fresh `origin/main` worktree as a detached unit, verified from its log.

## Acceptance

Every PWA task's PR body carries its width × skin × mode table, each cell ✓ or a note. Every fleet task's PR body carries the mutation table's red lines and the `bash -n` output. CB1d's PR body records the keyring fingerprint and where it was published.

## Rollback

W1 changes nothing a session runs, so its rollback is simple. Server lane first (the reverse of AGENT-FIRST): the PWA and server readers ignore an absent field. Then the fleet lane: `systemctl --user disable --now ccrc-claude-install.timer`, then `ccrc uninstall`'s removal of the two units only, or roll `ccrc` back (CB1d's uninstall case covers the units). `~/.ccrc/claude.json`, `claude-smoked` and `claude-candidate` may stay: nothing reads them before W2 and W3. The switch markers stay where the operator put them. The deny rules (CB1b) are only added denials and are never rolled back on their own.

## Deviations and decisions

### Issued for this work and defined here

The allocator issued D-5695 to D-5724 to this programme (30 numbers, one per task). This plan defines D-5695 to D-5702. The spec's §14 cites D-5699 and D-5700; every other plan cites, never redefines.

- **D-5695** — `claude-version-lexicon` (Task CB1a): Claude Code versions have their own lexicon in `shared/claudeVersion.ts`, parallel to the update plane's ccrc-shaped one and never mixed with it: the bare `x.y.z` grammar with numeric comparison, channels `latest | stable` (default `latest`, decision 1), modes `off | manual | auto` (default `manual`, decision 3), lane kinds `anthropic | codex`, the closed sixteen-member `ClaudeInstallWhy`, the 2.1.277 floor, the roll window bounds (default 90, 15 to 1440 minutes, decision 2), the 3 GiB headroom gate (decision 6), and the one node-file parser. Each is defined once (spec §6.2, §10.2, §12).
  - **As planned:** the spec's §10.2 puts the vocabulary inside `claude-intent-vocabulary` (D-5711); its shared half lands here, first, because the node file of W1 needs the `why` enum and the parser before any intent exists.
- **D-5696** — `claude-verbs-closed-to-sessions` (Task CB1b): `ccd roll` and `ccd claude …` join `FORBIDDEN_CCD_VERBS` and `CHILD_DENY_CCD_VERBS` in one change with the bash twin; `claude install` and `claude update`, under the upstream id's name too, join `CHILD_DENY_RULES`; writes to the build directory and the launcher path join `FORBIDDEN_PATTERNS`; the ccrc `CLAUDE.md` SAFETY list names them. Under default-escalate a child's `ccd roll` is a deny. No account or swap verb is touched (the 2026-10-19 ruling) (spec §7.6).
  - **As planned:** the spec's §11 puts §7.6 in W2; it lands in W1, before the first verb it names exists, so no verb is ever live without its deny.
- **D-5697** — `claude-operator-switches` (Task CB1c): one operator-only verb family, `ccd claude install-disable | install-enable | roll-disable | roll-enable | roll-live on | off | self-update keep | release`, the only writer of each marker, journalled with its actor and refused inside a session; `roll-live on` refuses while `hibernate-live` is younger than 24 h (decision 13); `shadow-week on | off` (the marker that holds automatic rolls during hibernation's Task 19 shadow week, decision 13); and `_mem_headroom`, the one measure of memory headroom (the minimum over the slice and each ancestor up to the user tree of that level's `memory.max` minus its own `anon`, the binding level reported; swap beside it, never a hold, decision 6), called by the roll gate and reached by the installer and the operator only through the read-only `ccd claude mem`. It follows Task 19's stop rule; Task 19's instrument keeps its own code (spec §10.4, §8.2, §6.2, §7.4).
  - **As planned:** every switch verb ships in W1, not with its reader (rev 2 shipped the roll switch with `ccd roll`), so each switch is in the operator's hand before the act it stops. `self-update keep | release` is rev 3's reversal of decision 5's automatic switch.
- **D-5698** — `claude-installer-measure-mode` (Task CB1d): the ccrc-owned installer ships first in measure mode: on its 30 min timer, under a scrubbed environment and the install lock, it verifies every build on disk (`gpgv` against the committed keyring, then size and SHA-256 against the verified manifest, then a smoke), lists the passing ones in `~/.ccrc/claude-smoked`, publishes the newest at or above the floor as `~/.ccrc/claude-candidate`, and writes `~/.ccrc/claude.json`; it installs, promotes and prunes nothing. Placed on `fleet` and `both` nodes only (spec §8.1's measure mode, §6.2).
- **D-5699** — `claude-node-file` (Task CB1e; spec slug): `~/.ccrc/claude.json` is the tenth NODE_FILE, written only by the installer, with its pid map from `exe` links only, the closed `why` enum and `_mem_headroom`'s figures, and the inventory sweep stores it in a `claude*` column group on `nodes`, one writer, additive migration. Rev 3 adds `switches`, `rollAfterMinutes` and the swap figures (spec §6.2).
- **D-5700** — `claude-version-observed` (Tasks CB1f, CB1g, CB1h; spec slug): every session's running build is shown against its (node, lane kind) target, or the candidate before W3, as `FleetSession.claude`'s state (`current`, `behind`, `ahead`, `on-halted`, `unmeasured`, `asleep`); one card chip only for `behind`, `on-halted` and a failed roll; `sessionFacts`' Claude Code state in the facts section and the header view; and the Updates view's per-node block that the Settings card reads (spec §6.1, §6.3, §6.4).
- **D-5701** — `claude-fact-one-reader` (Task CB1g): `sessionFacts` is the one PWA reader of `version` and `claude`; the chip, the header view's facts chip and `FactsSection` render its words and never format them; nothing says "updated" until the running build moves (spec §6.3, §9 trap 1).
- **D-5702** — `claude-settings-card-slot` (Task CB1h): the Claude Code card sits on Settings → Updates between Nodes and Update policy, reads only the provider's single `/api/updates` read, and is read-only in W1; its controls arrive with the waves that make them act (CB3j, CB5c), and the Claude Code mode sits under Automation (decision 14; the Settings plan's C5, answered there).

Issued and unused (Task CB1a): 5757, 5758.

## Out of scope

Installing, promoting and pruning builds (W3); any roll (W2, W5); the launcher (W3); lane self-update (W4); any change to hibernation's gate, its N or its arming (decision 16).

## Review log

**rev 0 → rev 1 (2026-10-19).** Two reviews of the spec's rev 3 and the five plans, both NEEDS REVISION. Each finding was checked against `origin/main` `bd363a76b`. The rows below are the ones that touch this plan; the spec's §17 carries all of them.

| Finding | Verdict | What changed here |
|---|---|---|
| Headroom read the slice's `anon` against the lowest ancestor cap (7.6 GiB where the user tree had 0.7 GiB); CB1c's Files and Step 1 disagreed | applied | CB1c Files and Step 1, Review focus 3, D-5697; the mutant "only the slice's `anon`" |
| The installer could not call `_mem_headroom`; the Task 19 sharing claim was unwired | applied | CB1c gains the read-only `ccd claude mem`; CB1d calls it; D-5697 drops the sharing claim |
| U13 enforced only at `roll-live on` | applied | CB1c gains `shadow-week on` and `off`, and `roll-live on` refuses on it; the act-path hold is CB2c's and CB5a's |
| A newer candidate could never be canaried after a target existed | applied | CB1f exposes `candidate` per pair, with its red case |
| R2b2's order test turned red by CB1h and not run | applied | CB1h modifies and runs `settings-updates.test.tsx` |
| #705 listed open | applied | the gates mark it merged (`a720fbad0`); base moved to `bd363a76b` |
| No wave stated its rollback | applied | §Rollback |
