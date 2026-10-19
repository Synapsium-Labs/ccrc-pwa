# Claude Code binary lifecycle inside ccrc — design

**Status:** rev 3 (2026-10-19). **Approved by the operator 2026-10-19**, in their words: "all cards accepted/answered". They answered §13's sixteen decisions through the superpowers visual companion; every card stands at its recommended option, and decision 1 was clicked explicitly. Rev 2 was revised after three reviews (§17). **Plan:** five wave plans, `docs/superpowers/plans/2026-10-19-claude-binary-lifecycle-w1-observe.md`, `…-w2-roll.md`, `…-w3-install.md`, `…-w4-self-update-off.md` and `…-w5-auto-roll.md` (tasks CB1a to CB5c), and the programme ledger `docs/superpowers/programs/claude-binary-lifecycle.md`. **Brief:** CCRCP-32 (GitHub #218), "Claude Code binary lifecycle inside ccrc: install the latest version on every node, and roll idle sessions onto it automatically". Its twelve decisions are named in §14 by slug, each beside the global number the wave plans define for it (D-5695 to D-5724 were issued to this programme; each is defined once, in the plan that builds it).

**Builds on:** hibernation (`2026-10-16-working-state-and-interruptions-design.md` §5.11, D-5242, and its plan's Tasks 16-19), the stop-finished-workers lane (the same plan's Task 15b, D-5370, D-5427), swap's restart order (`cmd_swap`), and the centralised update control plane (`2026-09-20-centralised-update-management-design.md`). **Sequenced after:** skins W2 (`docs/superpowers/plans/2026-10-18-ccrc-skins-w2-shells.md`, its S2d, S7a, S7c and S16) and the Settings redesign (its R1a-c and R2) for every PWA surface (§6.4). **Supersedes, in part:** `2026-08-21-upstream-launcher-decision-brief.md` §6 and `docs/superpowers/plans/2026-08-21-upstream-launcher-locks.md` "Not done here" (§8.4 below).

**Citations** are to `origin/main` `976bc459`, written `≈:` with a function or constant name beside each line hint. **[F]** marks a read-only measurement on the fleet node on 2026-10-18 (scripts piped over stdin, nothing copied, no session, unit, pane or registry touched, the launcher read only through a token-masking filter); **[I]** a measurement of Claude Code 2.1.302's own installer on a development machine inside a throwaway HOME and config dir (no login, no session, no `-p` turn); **[C]** a reading of the code; **[R18]** a fact recorded in CCRCP-18; **[M]** a measurement this spec requires before the wave that depends on it, listed in §11.1.

---

## 1. The problem

The operator, 2026-10-18: automated updates of the Claude Code binary on ccrc, and the restarts that apply them, done properly.

Today nobody owns Claude Code releases for the fleet. New builds do land on the box, but only because some running session's in-process updater happens to fetch them. Each lane then runs the build *its own* updater last recorded, not the newest on disk, so even a restart does not apply an update. Rolling a session onto a new build is a manual act with no idle check (the one recorded roll killed five sessions 30 s apart). The three files that install, choose and prune builds live outside the repo.

## 2. Measured

### 2.1 Releases and installs [F] [I]

- Upstream published **24 releases in 30 days** (about one per weekday, usually 14:00-18:00 UTC, sometimes two a day). Today `latest` = 2.1.302 and `stable` = 2.1.292, ten builds behind.
- The fleet node holds six builds (2.1.291, .296, .299, .300, .301, .302), each 250-285 MB. They arrived about every 1.7 days, four of them on Oct 14-16, each **0.7 to 4.8 h after release**. Some never arrived; 2.1.297 and .298 were never published (the sequence has gaps).
- Every Anthropic lane's config shows `autoUpdates: false` but `installMethod: native` and `autoUpdatesProtectedForNative: true`, which makes `autoUpdates: false` a no-op [I: the 2.1.302 auto-update predicate]. So every session's background updater is live, and whichever fires first installs into the shared `versions/` directory. The five proxy lanes have no update record; Codex lanes export `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` (`ccd/ccrc-codex`), which disables the updater, so they never install [C].
- Per-lane records (`.last-update-result.json`), 15 lanes: one lane last succeeded on Oct 12 (to 2.1.296), two stop at .299, two at .300, one at .301, seven at .302, and two recorded `install_failed` on Oct 17 with `version_to: null` and `error_code: null`.

### 2.2 What runs [F]

- 47 Claude Code processes for 45 live sessions (48 session units): **32 on 2.1.302, 2 on .301, 3 on .300, 2 on .299, 7 on .296, 1 on .291** (by `/proc/<pid>/exe`). All 15 stragglers are more than a day old; 12 more than three days. The 7 on .296 match the one lane whose record is stuck at .296. Two processes run outside tmux (one under a shell, one directly under systemd).
- Some panes report "2.1.9x" through `FleetSession.version` while every `exe` path names one of the six real builds. The source of the discrepancy is unmeasured [M1].
- The out-of-repo launcher at `~/.local/bin/claude` picks, first match wins: `CCRC_CLAUDE_VERSION`; `versions/.pinned` (malformed or missing is fatal, exit 127; no pin exists today); **the lane's own `version_to`** (soft: falls through if the build is absent); the highest installed build (`sort -V`, first executable). For the upstream lane only it *sources* a dot-env file under `$HOME` for the token.
- **Installed is not running.** A restart or a hibernate-then-wake keeps a lane on its recorded build until its own updater writes a newer one, and a failed record silently switches the lane to "highest".
- The out-of-repo prune (`claude-prune-versions`, a daily timer) keeps the newest 3 by modification time, plus any build a lane record names, the pin, and any build a running process executes. It removed nothing on the last three nights (kept .291 for a running process, .296 and .299 for lane records).

### 2.3 Restarts and memory [F] [R18]

- Session unit: `Restart=always`, `RestartSec=3`, `KillMode=process`, **`StartLimitBurst=5` in `StartLimitIntervalSec=2min`**. Its memory limits bind only the supervisor; Claude Code runs in per-pane scopes inside the `claude-session` slice. `_supervised_start` calls `_svc_reset_failed` before `_svc_enable_now`, which also clears the start-limit counter [C].
- The slice: **MemoryMax 24 GiB, 16.4 GiB used, swap 6.0 of 6.0 GiB (full)**, 409 OOM kills since Aug 19. The user tree above it (`user@`, MemoryMax 26 GiB) sat at 25.3 GiB with 736 OOM kills, so it is today's tighter ceiling. Claude Code RSS median 264 MiB, max 425 MiB.
- Since Oct 15: 182 session ends (130 on Oct 17), 174 linked to OOM; **74 pane OOM kills came within 120 s after a restart of any cause**. Recycling six sessions serially took the slice from 4.8 GiB headroom to 61 MiB of its MemoryMax, about 0.79 GiB net per recycle [R18].
- Pane come-up after a restart (n=53): **median 2.1 s, p95 19.2 s, max 37.5 s.** The unit's own settle (`_spawn_settle` inside `ccd supervise`) may run up to `SPAWN_SETTLE_SUPERVISE_S` = 1350 s on an unknown gate [C].

### 2.4 Hibernation, today [F] [C]

ccrc v0.0.287 (built today) carries `cmd_hibernate`, but no `hibernate-live` marker exists: the hibernation sweep runs in shadow. **It is not the only path to `ccd hibernate`:** the stop-finished-workers lane (`server/src/stopDone.ts`, D-5370, D-5427) is live and composes `ccd hibernate` for finished workers. The gate sizing from `deploy/measure-working-state.py --section snapshot`: 37 of 45 live sessions idle; idle more than 2 h: 27, more than 6 h: 24, more than 24 h: 11. 23 sessions hold as `scheduled` because their turn marker carries no `crons` count (the field landed with today's deploy, Task 16, so a marker written before it lacks it until the session's next turn), and 2 hold on a real cron. All 15 stragglers are more than a day old, so most of the idle ones carry no `crons` and hold for every roll, manual or automatic, until their next turn. Attached-viewer, mail, claim and run holds were not measured, and the shadow verdict lines live only in the server's log on the other node (not read). Hibernation's Task 19 (the memory instrument and its stop rule) has not started its shadow week.

### 2.5 The installer [I]

- `claude install <version|stable|latest>` needs no login and no session, about **5 s** per build. It downloads into `~/.local/share/claude/versions/<ver>` through a staging area under `~/.cache/claude/staging/` (about 286 MB), checks the binary's **SHA-256 against the release manifest** (compressed and decompressed, re-checked before the atomic move), and moves it into place. With a non-symlink launcher it leaves the launcher untouched and prunes nothing.
- **Signature checking is inferred, not measured.** The binary's strings carry an embedded public key and the manifest carries `manifestSignatureEnforcement: "flag"` with modes `require-enforcing-release` and `allow-unsigned-legacy`; the docs say manifests are signed from 2.1.89 on. No tampered-manifest test was run [M5].
- **Exit codes lie in one direction:** `install X` where X is the running binary's own version prints success and exits 0 without doing anything; `DISABLE_UPDATES=1` refuses and exits 0; a custom launcher means exit 0 changes nothing about what runs. Only a 404, no network (3 tries, about 5 s) or a checksum failure exits 1. The UI offers `--force` ("Try running with --force to override checks"); what it overrides was not measured.
- Every install first creates `versions/<ver>` as a **0-byte, mode-644 placeholder**, left behind on a 404 or a network failure, and a failed install can leave staging files behind.
- A lexical glob (`vers=(versions/*); ${vers[-1]}`, the shape modelled in `server/test/ccrc-wrappers.test.ts`) picks 2.1.99 over 2.1.302 and picked a 0-byte placeholder in the fixture.
- Pointers `https://downloads.claude.ai/claude-code-releases/{latest,stable}` are plain text with no auth; `/<ver>/manifest.json` carries per-platform `checksum` and `size` (linux-x64 2.1.302: 285,793,528 B), with signature files beside it.
- `DISABLE_AUTOUPDATER=1` stops only the background updater; `claude install` and `claude update` still work. `DISABLE_UPDATES=1` blocks every path. Install paths follow `XDG_*` variables.
- The 2.1.302 strings carry `CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR`, `CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR`, `apiKeyHelper` and `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`; which of them fits the upstream token is unmeasured [M4].
- Two concurrent installs of the same version both succeed with a matching checksum. Installing an older target is a downgrade.
- Claude Code's own `--bg` supervisor rolls idle sessions the same way ccrc's hibernation would: it skips sessions that are mid-transition, attached, would be downgraded or had recent input, re-checks after an await, then restarts with `--resume`. It does not cover tmux panes, so it is a precedent, not a reusable part.
- Calling the binary with a stray positional starts a session bootstrap and writes a transcript (a rig accident under zsh). Every caller passes argv as separate words.

## 3. Operator rulings

1. **2026-09-30:** all of this lives inside ccrc, with no separate box mechanism. ccrc installs the latest Claude Code on every fleet node, shows which sessions are behind, and restarts each session that is behind onto the new binary once it is safely idle. Every restart is a resume.
2. **2026-10-18:** automated Claude Code updates, and restarts that apply them properly.
3. **2026-10-19:** §13's sixteen decisions, each at its recommended option ("all cards accepted/answered"). Each is marked ruled in §13 with the alternatives not taken, and carried through the body below.
4. **Standing rulings that bind this design** (not made for it): deploys are AGENT-FIRST, the fleet agent's lane before the server's; the ccrc SAFETY rules hold for every session; restarts never herd; and the operator's account switching and the auto-swap are never blocked (2026-10-19): no roll gate, hold or lock in this design refuses or delays `ccd swap`, a `ccd swap` the auto-swap composes, or the operator's switch of a lane, and a roll that meets a swap in flight yields (§7.1).

## 4. Goals and non-goals

**Goals.** One ccrc-owned installer per node; a target build per node and lane kind that the launcher actually runs, promoted only after a canary on that pair; every session's running build visible against that target; a manual "Restart onto 2.1.x"; an automatic, serial, memory-aware roll that stops on a bad build; both nodes and every lane, driven by the node inventory.

**Non-goals.** Reimplementing Claude Code's download or verification; rolling processes ccrc does not supervise (the two non-tmux processes are reported, not rolled); per-session build pins chosen by the operator; changing hibernation's own gate, its 6 h N or its arming; arming hibernation, which stays a separate operator decision, the hibernation plan's Task 19, outside this programme (decision 16, ruled 2026-10-19).

## 5. The model in one paragraph

The server holds a Claude Code intent per node (channel, optional pin, mode, halted builds, and the build each lane kind is approved to run) and projects it, timestamped, to every node. A ccrc-owned installer on each node installs the channel's newest build with Claude Code's own `claude install`, verifies it by postcondition and an independent signature check, smoke-tests it, and publishes it as the node's **candidate**. The candidate is not run by anything except a **canary roll**: the first roll onto that build for one session of each (node, lane kind). Only when that canary passes does the server approve the build for the pair, and only then does the installer write the **target** the adopted launcher serves to every other spawn on the node: a wake, a crash restart, a fresh start, a roll. A session running an older build than its pair's target is **behind**. The roll moves a behind session onto the target: a dedicated `ccd roll` that shares hibernation's re-measured gate, checks the transcript as swap does, carries its build and strict resume through the registry into the unit's own spawn, and runs its act detached so no caller's timeout can cut it in half. The server schedules rolls serially per node behind a memory gate; a failed canary or repeated failed rolls halt the build, and a node whose intent is stale stops advancing.

## 6. Observe (`claude-version-observed`, `claude-node-file`)

### 6.1 Per-session version

`FleetSession.version` already exists, measured from Claude Code's own `<cfg>/sessions/<pid>.json` (`server/src/livestate.ts`, fed in `server/src/fleet.ts` ≈:554-734) [C]. The server adds one additive field beside it, `FleetSession.claude`:

- `kind`: `anthropic` or `codex`, the lane kind (§10.1);
- `target`: the pair's target build (§6.2); before W3, when no target exists, the node's **candidate**, flagged `targetIsCandidate: true`;
- `exe`: the build the session's process executes, from the node file's pid map (§6.2), so the server can cross-check `version` [M1];
- `state`: `current` (running equals target), `behind` (running is older), `ahead` (running is newer than a target the operator pinned back: never rolled automatically), `on-halted` (running a halted build: rolled back to the target under the same gate, §10.3), `unmeasured` (version null, unparseable, below the 2.1.277 floor of §9 trap 5, or disagreeing with `exe`), `asleep` (hibernated: it wakes on the target, nothing to roll);
- `roll`: null, or `{ phase: 'queued' | 'held' | 'rolling' | 'canary' | 'failed', hold?: <name>, tx?: <id>, at }`.

### 6.2 The node inventory's Claude Code columns

The agent cannot read `~/.local/share/claude/versions` (`checkPath` read roots, `agent/src/whitelist.ts`) [C]. So the node itself writes its measurement into a **tenth NODE_FILE**, `~/.ccrc/claude.json` (mode 0600, under `NODE_FILE_CAP_BYTES` 64 KiB), written only by the installer (§8). `NODE_FILES` (`shared/agent-protocol.ts` ≈:168) and `isCcrcNodeFile` gain it, and the census tests that pin the count at nine move to ten, red by design until they do.

```
{ "v": 1, "at": <epoch>, "mode": "measure" | "install",
  "channel": "latest" | "stable", "pin": "x.y.z" | null,
  "pointer": { "latest": "x.y.z", "stable": "x.y.z", "at": <epoch> } | null,
  "candidate": "x.y.z" | null,
  "target": { "anthropic": "x.y.z" | null, "codex": "x.y.z" | null },
  "prevTarget": { "anthropic": "x.y.z" | null, "codex": "x.y.z" | null },
  "builds": [ { "v": "x.y.z", "bytes": n, "sha256ok": true|false|null, "sigok": true|false|null,
                "smoke": "ok"|"failed"|null, "running": n, "halted": true|false } ],
  "running": [ { "pid": n, "build": "x.y.z" } ],
  "placeholders": n, "staging": n, "selfUpdateOff": true|false,
  "intentAt": <epoch> | null, "localHalts": [ "x.y.z" ],
  "last": { "at": <epoch>, "result": "ok"|"no-op"|"failed", "why": <ClaudeInstallWhy>, "failures": n },
  "switches": { "installDisabled": b, "rollDisabled": b, "rollLive": b, "selfUpdateKept": b },
  "rollAfterMinutes": n,
  "memory": { "anonBytes": n, "ceilingBytes": n, "ceiling": "slice"|"user",
              "swapUsedBytes": n | null, "swapTotalBytes": n | null } | null }
```

- `running` maps pids to builds from `readlink /proc/<pid>/exe` only; nothing reads `environ` or `cmdline` (§9 trap 9).
- `why` is a closed enum, `ClaudeInstallWhy` in `shared/claudeVersion.ts`: `ok`, `no-op`, `measure-only`, `disabled`, `intent-stale`, `pointer-unreachable`, `manifest-unreachable`, `below-floor`, `halted`, `no-space`, `install-failed`, `checksum-mismatch`, `signature-failed`, `smoke-failed`, `pin-unavailable`, `upstream-retreat`. Installer stderr never enters this file or any API response; it stays in the node's journal (§9 trap 9).
- `switches` reports the operator's markers (§10.4, §8.2) read-only, so Settings can show them; `rollAfterMinutes` is the roll quiet window the node's `$REG/claude-roll-after-minutes` sets (default 90, clamped to 15 min to 24 h, §12), which the server's verdict reads from here.
- `memory` is the Task 19 measure (§7.4), plus the swap figures Settings shows (never a hold, decision 6): `memory.stat` `anon` of the session slice against the lowest `memory.max` among the slice and its ancestors, the user tree included. It is read by one ccd function, `_mem_headroom`, which the roll's gate and Task 19's instrument share.

`upsertNodeMeasurement` (`server/src/coord/store.ts`) stores it in a new column group on `nodes`, one writer per group as the update design requires, additive migration (`MIGRATIONS[n]`): `claudeCandidate`, `claudeTarget` (JSON by kind), `claudePrevTarget` (JSON), `claudeChannel`, `claudePin`, `claudeLatest`, `claudeStable`, `claudeBuilds` (JSON), `claudeRunning` (JSON), `claudeSelfUpdateOff`, `claudeIntentAt`, `claudeInstallAt`, `claudeInstallResult`, `claudeInstallWhy`, `claudeHeadroomBytes`. Names are `claude*` because `currentVersion`/`highestVersion` already mean ccrc's own version [C].

### 6.3 What the operator sees

- **Card.** The session card shows one chip, and only when the state is `behind`, `on-halted` or the roll `failed`: `cc .296` (the patch number alone when major and minor match the target, the full version otherwise), neutral tone, warning tone for `on-halted` and a `failed` roll. Nothing shows when the session is current, ahead, unmeasured or asleep; the card never grows a second line for this.
- **Facts.** `sessionFacts` (`pwa/src/session/sessionFacts.ts`, D-5104) already turns `version` into `{word, measured}`; it is extended with the `claude` state (target, state, roll phase or hold) and stays the one PWA reader of both fields. It is rendered through S16's `FactsSection` and its facts chip, and through S7a's pure `sessionHeaderView`, never by editing `SessionHeader.tsx` directly. The words: `Claude Code 2.1.296 → 2.1.302 · rolls when idle 90 min`, `held: viewer`, `rolling`, `roll failed, back on 2.1.296`, `on a halted build`, `version unmeasured`, `wakes on 2.1.302`. Whenever the card shows a chip, the facts show the same fact and more.
- **The action.** **Restart onto 2.1.302** is a session command in `commands.ts` (S2d's move of the ⋯ items into commands), available while the state is `behind`, `on-halted` or `ahead` (worded "Restart onto 2.1.300" when the target was pinned back). It posts `POST /api/sessions/:id/roll` (§7.5); today's Restart posts `/ensure`, which is a no-op on a live pane and cannot be reused [C].
- **Settings** (decision 14, ruled 2026-10-19). A "Claude Code" card on the Settings redesign's Updates page (`/settings/updates`, after its R2b2), between Nodes and Update policy (that plan's coordinator item C5, answered), and the Claude Code mode under Automation. The card is built read-only by CB1h and gains its controls in CB3j and CB5c; the mode control is CB3j's. It uses that spec's control kinds (§6.1 there), danger confirms (§6.3 there: Pin, Unpin, halt Ack through `AckConfirm`) and result lines (§6.4 there) rather than toasts, and adds its fields to that spec's `SettingsDataProvider`'s single `/api/updates` read. It shows channel and mode; per node: candidate, target per kind, latest available, installed builds (signature, checksum, smoke, halted), sessions behind / current / on-halted / unmeasured, last installer run with its `why` and failure count, whether lane self-update is off and whether the operator kept it on (decision 5), memory headroom and swap use (swap is shown, never a hold: decision 6), intent freshness; the pin with **Unpin**; halted builds with the reason and **Ack**; an `upstream-retreat` event with a one-tap **Pin to 2.1.x** (§10.3); and each node's kill-switch state, read-only.

### 6.4 Sequencing against skins W2 and the Settings redesign

`SessionHeader.tsx` and `SessionActionsSheet.tsx` are frozen by #402/#627 until they merge, then restructured by S2d, S7a and S7c; `SettingsScreen.tsx` is retired by R2 into `pwa/src/screens/settings/*`. So the PWA parts of W1 and W2 land after S7a, S16 (or are folded into S16 if it has not landed) and R2, and the server parts land first, additive and unread. The phone header stays at S7c's height (about 96 px) with one chip in its rail; the Claude Code fact lives in the facts section, not a new header line.

Every skin and width (the UI-at-every-width rule):

| Skin × width | Card chip | Facts (header view and section) | Settings card |
|---|---|---|---|
| Refined, 360 px | `cc .296` in the chip row, which already wraps | one facts-chip in S7c's rail; the full line in `FactsSection` | stacked, one block per node; builds as a compact list; confirms full-height |
| Refined, 390 px | same | same | same |
| Refined, 1280 px | same | the facts chip; the line in `FactsSection` | two columns: fleet controls, then a node table |
| Refined, 1920 px | same | same | the node table gains the builds column inline |
| Instrument, 360 px | same chip, Instrument tone tokens | rail chip as S7c; the line in `FactsSection` | stacked, as Refined |
| Instrument, 390 px | same | same | same |
| Instrument, 1280 px | same | facts chip and the line, Instrument density | node table, Instrument density |
| Instrument, 1920 px | same | same | node table with builds inline |

## 7. The roll (`ccd-roll-verb`, `strict-resume-and-transcript-preflight`, `roll-holds`, `roll-scheduler-memory-aware`, `roll-spawn-carrier`)

### 7.1 Why a dedicated verb that shares hibernation's gate (`ccd-roll-verb`)

Hibernate-then-wake is a roll: once the launcher serves the target (§8.3), every hibernation followed by a wake lands the session on it, so an armed hibernation, and the already-live stop-finished-workers lane, roll their populations for free once W3 lands. That stays, and is the passive path.

For the active path, composing `ccd hibernate` then `ccd ensure` from the server is rejected, for four measured reasons [C]:
1. Between the two calls the row reads hibernated: the PWA shows "Waking…", `peerDeliverable` answers `yes` through the hibernated rung, and the mail lane may wake it under the automatic wake budget.
2. Hibernate has no transcript pre-flight and no uuid re-read, and the wake's `_spawn_start resume` falls back once to `--session-id <uuid>` (ccd ≈:23300-23332) when `--resume` leaves no session: a missing transcript silently becomes a fresh conversation (trap 3).
3. A wake runs whatever the launcher picks; it cannot name a build or report the one it got, and ccd never records a version (`_spawn_settle`'s `spawn` row has only rc and wrapper).
4. Hibernate has no detach: a caller with a timeout can be cut off between the kill and the start.

Spelling it as a swap is also rejected: `cmd_swap` refuses a same-account target and a hibernated row [C].

So **`ccd roll <id> --to <x.y.z> --expect <token>`** is one verb, built from parts that exist.

**The spawn runs inside the unit, so the roll's parameters travel through the registry.** `_supervised_start` (ccd ≈:23941) only runs `_svc_reset_failed` and `_svc_enable_now` and polls `_alive`; the pane is created by the unit's `ccd supervise` → `_spawn_start` (≈:23271), whose environment comes from systemd [C]. An environment variable set in the `ccd roll` process never reaches it. So, in the style of D-5237's `_resume_env "$id"`, the roll writes registry records that `_spawn_start` reads on **every** spawn of that unit, systemd's own restarts included (`roll-spawn-carrier`):

- `$REG/<id>.rolling`: `<tx> <from> <to> <attempt> <spawns> <holder-unit> <startedAt>`, written with `_reg_set` before anything is stopped. While it exists, `_spawn_start` renders `CCRC_CLAUDE_VERSION=<to of this attempt>` into the `exec env` line, behaves as strict (below), increments `spawns`, and, past the cap of 2 spawns per tx, refuses to spawn: it writes `_lc_fail roll` cause `spawn-cap`, marks the record `phase=failed`, and exits with the status the unit lists in `RestartPreventExitStatus=` (added to `claude-session@.service`), so systemd stops restarting it. A `.rolling` older than 30 min whose holder unit is gone is **stale**: it is recovered (below), never honoured as a build carrier, so a later crash restart cannot exit 127 on a pruned build.
- `$REG/<id>.resume-strict`: present while a ccrc-initiated resume is in flight (a roll, and a wake after a hibernation, §7.3). `_spawn_start resume` then drops the `--session-id` retry (≈:23308): a failed resume ends rc 3 instead of a fresh conversation. Removed by `_spawn_start` once the resumed session's `sessions/<pid>.json` names the same uuid.
- `$REG/<id>.claude-build`: the build a completed roll put the session on. `_spawn_start` honours it on later spawns while no `.rolling` exists and either no target file exists (before W3) or the session's pair target is older than it; it is dropped once the target is equal or newer, or the build is halted or absent. So a rolled session that later restarts for another reason (an OOM kill) never runs a lower build than the one that last wrote its transcript.

All three, and the canary's soak record `.claude-canary`, are validated on read (`^[0-9]+\.[0-9]+\.[0-9]+$` for builds), are kept by the prune (§8.5), and join `ccd-lifecycle-purge`'s suffix list. They are written only by `ccd roll`, `cmd_hibernate` and `_spawn_start`; `single-definition.test.ts` pins the writers.

**The act, always detached.** After the gate passes, `ccd roll` writes `.rolling`, starts its act in its own transient unit through `_svc_run_detached` with `CCD_ROLL_DETACHED=1` (swap's pattern, `CCD_SWAP_DETACHED`, ccd ≈:27688), and answers the caller at once with the tx id. No caller's timeout, no agent restart during an AGENT-FIRST deploy and no OOM kill of the caller can leave a half-done roll, because the caller holds nothing past the dispatch. The act order, run by the detached unit (hibernate's, plus swap's transcript checks):

1. `_lc_done roll` phase `kill` (written **first**, as hibernate writes `_lc_done hibernate` before `_ws_unsupervise`, so a kill that ends the shell early still reads as deliberate);
2. `_operator_choice_keep` (keeps the operator's `/model` and effort);
3. `_transcript_matches` pre-flight; the transcript path, uuid and size are recorded in `.rolling`;
4. `_ws_unsupervise` (first, so `Restart=always` cannot resurrect the old process); the `.stopped` stamp it writes (≈:4156) is removed in the same step, and every reader takes `.rolling` over `.stopped`;
5. `tmux kill-session`; `sleep 1` flush; re-read the uuid (it rotates on `/clear`); second `_transcript_matches`;
6. `_supervised_start` (the unit's `_spawn_start` reads `.rolling` and `.resume-strict`). **The roll never calls `_spawn_settle` itself**: the settle already runs inside the unit, and a second acceptor would type into the same pane;
7. wait for the unit's `spawn` stamp newer than `startedAt`, then judge the outcome at the deadline (§10.1's health check for a canary; for any roll: spawn rc 0, `_idle_for_keystroke` passes, the new pid's `/proc/<pid>/exe` build and its `sessions/<pid>.json` version both equal `to`, the same uuid, the transcript not shrunk);
8. `_lc_done roll` phase `outcome` with `meas.from`, `meas.to`, `meas.ran`, `meas.uuid`, `meas.rc`, or `_lc_fail roll` with the cause; write `.claude-build` on success; remove `.rolling`.

**Concurrency.** `cmd_swap`, `cmd_hibernate` and `cmd_stop` take no per-session lock today [C]. While a live `.rolling` exists (its holder unit active), `cmd_ensure`, `cmd_start`, `cmd_hibernate`, `cmd_stop` and the mail lane's wake refuse with `rolling` (a quiet skip for automatic callers; the PWA's Restart shows "rolling"). **`cmd_swap` is never refused for a roll** (the operator's ruling of 2026-10-19: account switching and the auto-swap are never blocked; rev 3). A roll yields to a swap instead: its gate refuses `swapping` while a swap holds the session (a fresh `lastswap` or a live swap unit), and a swap that arrives during the act waits, bounded by the act's own deadline (§12, at most 120 s plus the restore), for the outcome row, then runs; it is never turned away. The canary's 15 min soak (§10.1) runs **after** `.rolling` is removed, recorded in `$REG/<id>.claude-canary`, which no verb refuses on; a swap, a hibernation or a stop during the soak ends the canary `inconclusive` (neither passed nor failed), and the next eligible session on that pair is the canary again. A stale `.rolling` is **recovered** by the next `ensure` or by the box sweep: a strict resume on `from` with attempt 2, journalled `_lc_done roll` phase `recovered`. The server words the row `rolling`, never `stopped`; the census of lifecycle readers (`hibernate-census.test.ts`) gains a stance for `.rolling` in every reader.

**No self-roll.** A roll whose target is the calling session refuses `self-roll` (exit 4). The agent and the PWA route never run inside the target pane, and hibernation's verdict already excludes attached and viewed sessions, so no server-initiated roll needs a self-detach arm; always detaching covers trap 7.

**Exit codes (synchronous, the gate only):** 0 dispatched, with the tx id on stdout; 3 `session-busy` with a hold name (quiet skip, as hibernate); 4 refused (transcript, version, `--to` invalid or not allowed, token, kill switch, `self-roll`, `rolling`). The outcome is never an exit code: the server reads the `roll` journal row through the lifecycle mirror, and `FleetSession.version`.

**Arity and the token.** The verb takes exactly one id, `--to` matching `^[0-9]+\.[0-9]+\.[0-9]+$`, and `--expect`; no other flags. Before anything is stopped, ccd re-validates on the node that `versions/<to>` is non-empty and executable, listed in `~/.ccrc/claude-smoked`, absent from `~/.ccrc/claude-halted` and the projected halts, and equal to the node's target for the session's kind, its pin, or, for a canary, the node's candidate (`~/.ccrc/claude-candidate`); otherwise exit 4. `--expect` is an action token the server mints binding `(id, uuid, from, to)`, as `ws-reclaim` and `ws-expire` are gated; the verb is enrolled in `REQUIRED_VERB_FLAG`, and ccd re-proves the token at the act.

It is a new lifecycle act, `roll`, added to `_LC_ACTS` and `LifecycleAct` together (`lifecycle-vocabulary.test.ts`), and to `DEAD_COORDINATOR_DELIBERATE_ACTS` with one exception: a **failed** roll row (`_lc_fail roll`, or an outcome row with `meas.rc` ≠ 0) is not deliberate, so the dead-coordinator lane handles a coordinator orphaned by a failed roll; an older server parses `roll` as `unknown`, which counts as deliberate. Both cases are pinned in `lifecycle-vocabulary.test.ts` and the dead-coordinator policy tests. It is listed by `cmd_caps`; the agent grant is `EXEC_WHITELIST` `['roll', '--expect']` (`agent/src/whitelist.ts`), called with a 30 s exec timeout, which the synchronous gate fits because the act is detached; `CCD_ARGV.roll` (`server/src/ccdargv.ts`) with whitelist-subset and ccdargv-brand cases; rows in `unattended-actor.test.ts`. The server's routes and sweep gate on `verbSupported(state, CCD_ARGV.roll(...))`, the one spelling used throughout.

### 7.2 The gate: hibernation's, plus named holds (`roll-holds`)

A roll requires everything hibernation requires, with two parameters changed: the quiet window, and the opt-out suffix. `_hib_gate` (the factored `cmd_hibernate` re-measure both verbs call, so the two can never drift) takes the opt-out suffix as a parameter, and so does the server verdict's input: `.no-hibernate` for hibernate, `.no-roll` for roll.

| Check | Where | Source |
|---|---|---|
| live word `idle`; no menu; bucket `idle`; `background` null; roster empty | server verdict | `hibernateVerdict` |
| turn marker `done`, `bg` exactly 0, `crons` exactly 0 (−1 or absent holds) | server and ccd | same |
| no `.hold`, no open run as worker or claimant, no claim, no queued mail, runs readable | server | same |
| nobody viewing (`Presence.isOpen`, held for `PRESENCE_OPEN_TTL_MS` after server start) | server | same |
| not stranded, swap-blocked, substrate fault, archived, expiring | server | same |
| no `esc to interrupt`, prompt present with an empty box, 60 s quiet, no fresh `lastswap`, nobody attached (`#{session_attached}` = 0) | ccd at the act | `cmd_hibernate` |
| **quiet window: the turn marker's newest `turnAt`/`stopAt`/`restartAt` older than the roll window** (default 90 min, §12) instead of hibernation's N | server | `hibernateVerdict(i, now, afterMs)` already takes N as a parameter |

New holds, each named, each failing closed:
- **`version-unmeasured`**: `FleetSession.version` is null or not `x.y.z`, or disagrees with the node's `exe` build for the pid. Never rolls.
- **`version-untrusted`**: the running version is below 2.1.277, the floor of `liveStatusCoversDelegation` (`server/src/livestate.ts` ≈:95), whose idle semantics this gate relies on.
- **`limit-blocked`**: the lane's `AccountLimits` (`server/src/limits.ts`) measure at its cap. A wake into a blocked lane ends `_spawn_settle` rc 5. A lane with no limits source (proxy lanes) does not hold.
- **`no-roll`**: the opt-out marker `$REG/<id>.no-roll`, a new marker, not `.no-hibernate` (decision 4, ruled 2026-10-19): a roll resumes at once, unlike a hibernation, so a session may accept one and not the other. Like `.no-hibernate` it is the operator's, written by hand on the fleet node, and nothing in the tree writes it (`single-definition.test.ts` pins that).
- **`swapping`**: a swap holds the session (a fresh `lastswap`, or a live swap unit). A roll always yields to a swap; a swap never waits on a roll beyond the act's deadline (§7.1, §3 ruling 4).
- **`roll-failed`**: a roll of this session onto this build already failed; not retried onto it until the operator acks (§10.3).
- **`low-memory`**, measured by ccd at the act through `_mem_headroom` (§6.2): headroom under the gate of §12. Re-measured after the previous roll's canary or outcome settles, not only at the act.
- **`recent-spawn`**, measured by ccd at the act: any pane on the node spawned in the last 120 s, from the units' `spawn` stamps or the turn markers' `restartAt`. A crash restart, a wake or a fresh start counts, not only a roll.
- **`compacting`**, measured by ccd at the act: the session's transcript file modified in the last 10 min. Claude Code's idle compaction fires about 55 min after `end_turn` and does not move the turn marker (working-state spec §5.11), and whether it shows `esc to interrupt` is unmeasured [M3]; a kill mid-compaction risks the transcript.

A hibernated row is never rolled (`asleep`): it wakes on the target. A **manual** roll (§7.5, the operator's Restart) skips the quiet window, which shrinks to ccd's own 60 s; **every other check still applies**, `compacting`, `recent-spawn` and `low-memory` included (decision 7, ruled 2026-10-19): the operator is choosing the moment, but nothing they cannot see (a background task, a cron, mail, an open run, a compaction, a recent spawn) is ever lost, and the sheet names the hold and offers no override.

**Today's consequence.** Because markers written before Task 16 carry no `crons`, most of today's 15 stragglers hold `scheduled` for every roll until their next turn [F]. The hold stays fail-closed, since a restart loses session crons; the number of behind sessions carrying `crons` is re-measured, read-only, before W2a [M2].

### 7.3 What the roll does to hibernation's own path (`strict-resume-and-transcript-preflight`)

`cmd_hibernate` gains swap's `_transcript_matches` pre-flight before its kill (refusing `no-transcript`), and writes `$REG/<id>.resume-strict` with its `.hibernated` marker, so the wake after a hibernation, like every roll, resumes strictly: `_spawn_start resume` does **not** fall back to `--session-id`; it fails with rc 3 and the row reads `orphan`, which the dead-coordinator lane and the PWA already handle. A fresh conversation in place of a resumed one is data loss and is never a silent outcome of a ccrc-initiated restart. Operator-initiated `ccd start` keeps today's fallback.

### 7.4 Scheduling: serial, memory-aware, capped (`roll-scheduler-memory-aware`)

The server decides; ccd re-checks at the act. A roll sweep runs inside the hibernation sweep's clock (`HIBERNATE_SWEEP_MS`, 5 min). It holds the coordination serialiser (`port.serial`, coordMutex) and the session's queue (D-5428) **only for the verdict and the dispatch**, never across the spawn, since the act is detached (§7.1):

- **One roll at a time per node.** The next roll on a node is dispatched only after the previous one's outcome row exists and its health check (§10.1) has settled.
- **One shared act budget.** Rolls, hibernations and the stop-finished-workers lane's hibernations draw from one per-sweep budget (`HIBERNATE_PER_SWEEP`, 3 fleet-wide), with at most one roll per node per sweep, so no lane beside another doubles the kill herd.
- **The resume herd.** An automatic roll is dispatched only when `wakeAdmit` (`server/src/coord/wakeBudget.ts`, `WAKE_BURST` 2 per 60 s) would admit an automatic wake, and counts in that window; a manual roll is admitted as `asked` and counted.
- **Memory** (decision 6, ruled 2026-10-19: headroom only). ccd refuses `low-memory` below 3 GiB of headroom by the Task 19 measure (§6.2: `anon` against the lowest ancestor `memory.max`, slice and user tree), and `recent-spawn` within 120 s of any spawn on the node. Full swap is **not** a hold: it is reported in the node file (`memory.swapUsedBytes`, `memory.swapTotalBytes`) and shown in Settings, because holding on full swap would hold every roll today. Hibernation's Task 19 stop rule forbids `memory.current` and `memory.peak` for this, because page cache fills toward the cap on a busy box; this spec follows it. The server also spaces rolls on a node at least 5 min apart.
- **Per-hour cap.** At most 6 automatic rolls per node per hour (§12).
- **Starts.** `_supervised_start` resets the start-limit counter through `_svc_reset_failed` [C], so systemd's `StartLimitBurst` does not bound a roll. The bound is the `.rolling` record's own: at most 2 spawns per tx, counting systemd's restarts of that tx (§7.1). A roll never retries inside the act beyond the one restore.
- **Task 19** (decision 13, ruled 2026-10-19: both). Roll restarts are tagged `cause=roll` in the lifecycle journal from the first roll (W2), so Task 19's memory instrument excludes them and its numbers stay clean; and automatic rolls stay off during Task 19's shadow week and its first armed day: `claude-roll-live` is not set then (the operator's act, OA-6 in the ledger), and `ccd claude roll-live on` refuses while `$REG/hibernate-live` is younger than 24 h.

**The restore.** When the new build fails after the kill (spawn rc 3, 4 or 6, the settle unfinished at the deadline, or `meas.ran` not the asked build), the detached act: `_ws_unsupervise` and `tmux kill-session` first, so the unit and its in-unit settle loop are gone; then rewrites `.rolling` to `to = from`, attempt 2; then `_supervised_start`, still strict. If `from` is not smoked or is halted, the restore uses the pair's target instead. If that resume fails too, or the spawn cap is reached, the outcome is `_lc_fail roll`, the row reads `roll failed`, and the operator is notified (§10.3). rc 5 (hard-blocked) is a limit, not a build fault: no restore onto another build is needed beyond the strict resume, the lane holds `limit-blocked` from then on, and it never counts as a build failure.

**Bounded time.** The bound the design commits to is per session: a behind session that passes the gate is rolled within 1 h of becoming eligible (one sweep, the spacing and the cap). A session that does not pass the gate stays behind, named by its hold in its facts; today most stragglers are ineligible until their next turn (§7.2).

### 7.5 Manual first

`POST /api/sessions/:id/roll` (operator-cookie gated, body `{ to }`) mints the `--expect` token and composes `ccd roll <id> --to <x.y.z> --expect <token>` through the agent's exec path (§7.1). `to` must equal the pair's target or the pin; before W3 the route admits only the operator-named canary, with `to` = the node's candidate (W2a). It answers `202 { tx }` once dispatched (the row then shows `rolling` and the outcome arrives through the journal mirror), `409 { hold }` when the gate holds (the sheet names the hold and offers nothing to override it), `409 hibernated` (offer Wake), `409 rolling`, `409 not-behind`, `409 not-yet` (before W3, any roll other than the canary), `404` on a node whose `ccd caps` does not list `roll`.

### 7.6 Who may roll

Rolling, installing and selecting builds are operator acts or ccrc's own automatic acts, never a session's (the fleet SAFETY rules):

- `roll`, and the operator-only `ccd claude …` verbs of §10.4, join `FORBIDDEN_CCD_VERBS` (`server/src/coord/approvalguard.ts` ≈:122) and `CHILD_DENY_CCD_VERBS` (`shared/api.ts` ≈:11151) in one change, with the bash twin in `ccd/install-session-hooks.sh`; `ccd-spawn-child-settings.test.ts` and `install-session-hooks.test.ts` hold them equal. Under default-escalate, a child's `ccd roll` is therefore a deny, not an approvable prompt.
- `Bash(claude install:*)` and `Bash(claude update:*)`, and the same under the upstream id's name, join `CHILD_DENY_RULES`; `FORBIDDEN_PATTERNS` gains writes to `/.local/share/claude/versions` and to the launcher path. The registry-path pattern already covers `~/.ccrc/claude-*` and `$REG/claude-roll-*` [C].
- The ccrc-pwa `CLAUDE.md` SAFETY list gains `ccd roll`, `ccd claude …`, `claude install`/`claude update`, and writes to the build directory and the launcher.
- The action token (§7.1) means a session that types `ccd roll` by hand, a stale server or a compromised one cannot roll onto an arbitrary build: ccd checks `--to` against node-local files and re-proves the token.

## 8. Install (`ccrc-claude-installer`, `launcher-and-prune-adopted`, `lane-self-update-off`)

### 8.1 One ccrc-owned installer per node, on a timer (`ccrc-claude-installer`)

`~/.local/libexec/ccrc/ccrc-claude-install`, placed by `_inst_bins`/`_inst_atomic`, run by `ccrc-claude-install.service` (oneshot, `CPUWeight=10`) from `ccrc-claude-install.timer` (**every 30 min**, `RandomizedDelaySec=5min`, `Persistent=true`), and started at once (`--no-block`) by `ccd-update-sync` whenever the pulled Claude intent changes (§10.2). It holds `flock -x ~/.ccrc/claude-install.lock` for its whole run. It runs under `env -i` with an allow-list: `HOME`, `PATH`, `LANG`, `CLAUDE_CONFIG_DIR` = a ccrc-owned `~/.ccrc/claude-installer/cfg` (so no lane's `.claude.json` is written), and `HTTPS_PROXY` only when the node's inventory declares one. No `ANTHROPIC_*`, token, `XDG_*` or `DISABLE_*` variable reaches it (a test pins the allow-list). cwd is an empty `~/.ccrc/claude-installer/cwd`; stdin `/dev/null`. Each run:

1. **Gates.** `$REG/claude-install-disabled` → report `disabled`, change nothing. Read `~/.ccrc/claude-intent` (§10.2) as JSON with `jq`, never sourced, re-validating every field with `shared/claudeVersion.ts`'s regexes. If its `at` is older than 15 min (several 60 s pulls), the run is **install-only**: it may still install and verify the pair targets and the pin already projected, but it publishes no new candidate and writes no target; report `intent-stale`. A pin rollback already projected is never blocked by staleness.
2. **Resolve the wanted build.** If the intent names a pin, that is the wanted build. Otherwise `curl` the channel's pointer (the intent's `channel`, default `latest`: decision 1, ruled 2026-10-19; the canary and the halt are the safety net) with `--proto =https --proto-redir =https --max-redirs 2`, the host allow-list (`downloads.claude.ai`), a 64-byte cap and a 10 s timeout, and validate `^\d+\.\d+\.\d+$`; an unreachable pointer keeps the current state and reports `pointer-unreachable`. A wanted build below the intent's `minBuild` (at least 2.1.277: the version-untrusted floor, above the 2.1.89 signature floor) is refused, `below-floor`. A wanted build in the projected halts or `~/.ccrc/claude-halted` is never wanted, `halted`. A pointer older than the newest approved target is an **upstream retreat**: report `upstream-retreat`, select nothing, and let the server raise it (§10.3); it is taken only through a pin.
3. **Space.** Require free space of at least 2× the manifest's `size` plus 2 GiB on the filesystems holding `versions/` and `~/.cache/claude/staging`, or report `no-space` and do nothing. Delete staging files older than 1 h and 0-byte `versions/*` placeholders older than 1 h (the native cleanup's own age [I]).
4. **Install it if absent.** If `versions/<want>` is missing, empty or not executable, run, with each argument a separate word, a 600 s timeout: `<runner> install <want>`, where `<runner>` is a smoke-passed build **other than** `<want>` (so the short-circuit on the running binary's own version, §2.5, never applies). `--force` is not used: it is unnecessary and what it overrides was not measured. A node with no smoke-passed build installs nothing and reports; its bootstrap is an operator act (§8.6).
5. **Verify by postcondition, never by exit code.** Fetch `/<want>/manifest.json` (64 KiB cap, the same curl limits) and its signature, and verify the signature with `gpgv` against a keyring committed in the repo (`deploy/claude-release-keyring.gpg`, a public key, pinned to Anthropic's documented fingerprint). Only a manifest whose signature verifies is compared: `versions/<want>` non-empty, executable, its size equal to `platforms.<plat>.size` and its SHA-256 equal to `platforms.<plat>.checksum`. A failed signature marks the build `sigok: false` and a mismatch `sha256ok: false`; neither is ever selectable. This makes ccrc's check independent of the channel that delivered the binary: a compromised mirror controls the binary and an unsigned manifest, not the key. Whether `claude install` itself refuses a tampered manifest is measured before W3 [M5].
6. **Smoke-test.** `versions/<want> --version` under `env -i` with a throwaway `HOME` and `CLAUDE_CONFIG_DIR` under `~/.ccrc/claude-installer/smoke`, a 30 s timeout, stdin `/dev/null`; it must print `<want> (Claude Code)` and exit 0. On success append `<want>` to `~/.ccrc/claude-smoked` (one version per line, the launcher's allow-list). The smoke proves the binary runs on this node; it cannot prove the first-run gates or idle semantics, which is the canary's job (§10.1).
7. **Publish the candidate.** The newest build that passed 5 and 6, is not halted and is not below the floor is written atomically to `~/.ccrc/claude-candidate`. **Nothing serves the candidate** except a canary roll that names it (§7.1, §10.1).
8. **Promote, from the intent only.** For each lane kind, the intent's `approvedTarget[kind]` (set by the server only after that (node, kind) canary passed, §10.1) is written atomically to `~/.ccrc/claude-target` (one line per kind: `anthropic x.y.z`, `codex x.y.z`) when that build is present, verified, smoked and not locally halted; otherwise the installer installs and verifies it first (steps 3-6) and keeps the current target until it can, reporting `pin-unavailable`. The previous value is kept as `prevTarget` in `claude.json`. The pin, when set, is written as both kinds' target by the same rule.
9. **Prune** (§8.5) and **report**: rewrite `~/.ccrc/claude.json` (§6.2).

**Failures.** After consecutive failures with the same `why`, the timer's next run is backed off exponentially (30 min, 1 h, 2 h, up to 6 h); `last.result=failed` with the reason and the failure count reaches Settings.

**W1 measure mode.** The first wave runs the installer with `--measure`: it resolves the pointer, verifies (signature, size, checksum) and smoke-tests **every build already on disk**, writes `claude-smoked` and `claude-candidate` (the newest that passed), and reports. It installs nothing, writes no target and prunes nothing; no launcher reads anything it writes before W3. So W1 can already show who is behind the candidate, and W2's canary has a build to roll onto.

**Roles.** The installer and the launcher are placed on nodes whose inventory role is `fleet` or `both`; a `server`-role node runs no sessions, so nothing per account or per build is placed there (`_inst_bins` already role-gates per-account executables, D-3111). `ccd roll` ships with ccd wherever ccd ships, and refuses on a node with no sessions.

### 8.2 Turning lanes' self-update off (`lane-self-update-off`)

Once a node's installer is **proven** (it has itself installed and promoted at least one build it resolved, with no failed run in the last 24 h, and at least 72 h since it went live), it writes `~/.ccrc/claude-installer-proven`. ccd's spawn `exec env` line (`_spawn_start` ≈:22885 at `f82d0c015`), the one place every lane's spawn passes, then adds `DISABLE_AUTOUPDATER=1` while that marker exists **and** the operator's keep marker `$REG/claude-self-update-kept` does not (decision 5, ruled 2026-10-19: automatic, visible in Settings, reversible). The operator reverses it with `ccd claude self-update keep` (writes the keep marker; every lane's updater is live again from its next spawn) and undoes that with `ccd claude self-update release`; both are operator-only verbs (§10.4), and Settings shows which state each node is in. Each session picks it up at its next spawn. `DISABLE_AUTOUPDATER`, not `DISABLE_UPDATES`, so a hand `claude update` still works as an operator escape hatch, and the installer's own scrubbed environment is unaffected [I]. `autoUpdates: false` is not used: it is a no-op on a native install [I]. Codex lanes are already off [C]. The generated wrappers (`shared/wrapper.mjs` `generateWrapperBody`) are not touched, because `_wrap_parse_shape` matches every line byte for byte. Until the marker exists, sessions' updaters remain a second writer into `versions/`; their builds are never served by the adopted launcher unless smoked and approved, and the installer's postcondition re-check covers them.

### 8.3 The launcher, adopted: a pure selector (`launcher-and-prune-adopted`)

ccrc ships the launcher (`ccd/claude-launcher`) and `ccrc install` places it at `~/.local/bin/<upstream id>` through `_inst_bins`/`_inst_atomic`; the path comes from the roster's upstream id, never a hard-coded name. It is bash, reads only local ccrc files with bounded reads (`head -c 64`), never the roster, never a secret, no network. The lane kind comes from `CCRC_CLAUDE_KIND` (exported as `codex` by `ccrc-codex`, default `anthropic`). It picks, first match wins:

1. `CCRC_CLAUDE_VERSION` when set: validated `x.y.z`, `versions/<v>` non-empty and executable, **listed in `~/.ccrc/claude-smoked` and absent from `~/.ccrc/claude-halted`**, else exit 127 (an explicit request that cannot be met is an error; ccd's spawn sets it from `.rolling` or `.claude-build`, §7.1).
2. `~/.ccrc/claude-target`'s line for the kind: validated, non-empty, executable, smoked, not halted.
3. The previous target for the kind (from a one-line `~/.ccrc/claude-prev-target`, written with the target), by the same rule.
4. Before the installer has ever run on the node (no `~/.ccrc/claude-smoked` file at all): the newest non-empty executable build by `sort -V`. Once `claude-smoked` exists this rung is disabled; nothing falls back to "highest". With no admissible build the launcher exits 127.

It then `exec`s `versions/<v>` with the original arguments. **Dropped:** the per-lane `version_to` rung (the cause of "installed is not running", §2.2) and `versions/.pinned` (the pin now lives in the intent, §10.2; `ccrc install` refuses to adopt over an existing `.pinned` and tells the operator to set the pin in Settings; none exists today [F]). **Fixed:** the lexical glob and the 0-byte placeholder (traps T3, T4): every rung filters `-s && -x` and sorts by version.

**The upstream token (trap 9).** The launcher reads no secret, so a `claude` call with a clean environment (a unit, a script, the agent, a doctor probe) gets no upstream identity injected, and the delicacy D-159 named (a secret in the one launcher every lane execs) is gone. This **implements** D-159's split of identity from executable rather than superseding it. The upstream lane's token is supplied where the upstream lane is spawned: ccd's `_spawn_start`, for a lane whose roster account is the upstream kind, reads `exec.secretsFile` (which already exists on the upstream kind and is declarative today, `shared/roster.ts` ≈:137, `EXEC_KEYS_UPSTREAM`; the change is that ccd becomes its reader). **Ruled 2026-10-19 (decision 11): the descriptor.** The token reaches Claude Code on a file descriptor ccd hands over at spawn, and the launcher reads no secret. M4 confirms in the fixture, before W3, which descriptor variable fits the token kind. The other two seams are **not taken**; they are kept below only as the record of what was weighed, and if M4 shows no descriptor variable fits, CB3g stops and the question returns to the operator rather than falling through to them:
1. **A file descriptor.** After checking the file is mode 0600 and owned by the user (`set +x` first), the spawn opens it on a descriptor (`exec 3<"$file"`) and exports only `CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR=3` (or the API-key twin, whichever fits the token kind). The value is never in any environ, argv or log.
2. *Not taken:* **`apiKeyHelper`**, a ccrc-owned helper that reads the file.
3. *Not taken:* **the environment**, which would have been a recorded deviation from the brief's trap 9. It would have needed `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` on the upstream lane, after measuring that it strips the token from tool children, hooks and MCP servers, and `env` and `printenv` joining the classifier's printing-a-secret heads.

The repo carries the variable names and the roster field, nothing else; no token, no secrets path, no template value. Config-dir comparisons that decide "is this the upstream lane" use `realpath -m`, never a string compare. Today's launcher *sources* its file; adoption removes that.

**Migration.** `ccrc install` byte-compares the installed launcher with the shipped one. A different, non-ccrc file is copied aside first (`_inst_keep_aside`); its token-file reference is resolved into the roster's `exec.secretsFile` only after the operator confirms it in `ccrc install`'s prompt (the installer never reads or prints the token); then it is replaced atomically. The cut-over is every lane at once (D-3478: a file placed at a lane launcher's path cuts every lane over), so it is AGENT-FIRST and gated (§11). `ccrc uninstall` restores the kept-aside copy instead of removing the launcher, so uninstalling never leaves every lane without an executable. Adoption keeps the rules `ccrc adopt` relies on: the launcher declares no `CLAUDE_CONFIG_DIR` (D-155, `_wrap_declares_config_dir`), and it carries its own provenance marker (`ccrc-launcher`), not `shared/mark.mjs`'s `ccrc-unmodified`, so `cmd_wrappers` never classifies it as a wrapper it may rewrite. `ccrc doctor`'s launcher check reports the provenance marker, the byte-compare result and the mode only, never the launcher's body or any secrets path.

### 8.4 What this supersedes

- `2026-08-21-upstream-launcher-decision-brief.md` §6 ("the launcher's version pin silently un-pins … operator-side tooling, not ccrc"): superseded; the launcher is ccrc's.
- `docs/superpowers/plans/2026-08-21-upstream-launcher-locks.md` "Not done here" (the silent un-pin; "highest" is not the installer's choice): both answered by §8.3.
- D-159 is **not** superseded: its split of identity from executable is what §8.3 implements.
- **Lock 5 stays** (D-156, the witness index in `cmd_wrappers`, `ccd/ccrc` ≈:3837-3940, ≈:4214). It guards `ccrc wrappers` writes, a different door from `_inst_bins` [C], and it must keep refusing to overwrite the launcher. The brief's "reverses lock 5" is therefore not needed.
- `ACCT_OPERATOR_STEP_2` (`ccd/ccrc` ≈:7040, "add the config directory to the prune's keep list") is deleted with the adoption.
- `server/test/ccrc-wrappers.test.ts`'s modelled launcher (`vers=(versions/*)`) is replaced by the shipped one.

### 8.5 The prune, adopted

The installer runs the prune at the end of every run. **The old daily timer is retired in the same step** that installs the launcher: `ccrc install`'s adoption disables and removes `claude-prune-versions.timer` and its service, and `ccrc doctor` fails while the old timer is still active. The prune takes the install lock exclusively; a roll holds it shared (`flock -s`) from its gate to its outcome row, so no prune runs while a roll needs its `from`. It never deletes, of the builds in `versions/`:
- the candidate, every pair target and previous target, the pin;
- every build named in a `$REG/*.rolling` or `$REG/*.claude-build`;
- **any build a live process executes**: `readlink /proc/<pid>/exe` for every process of the user (nothing else is read from `/proc`), plus any lock in `~/.local/state/claude/locks/` whose pid is live (trap 1);
- the 3 newest smoke-passed, non-halted builds by version (not by modification time).

Halted builds that no process executes and no record names are deleted, and removed from `claude-smoked`. Staging leftovers and placeholders older than 1 h go (§8.1 step 3). It deletes nothing when the `/proc` scan fails or returns no Claude Code process while sessions are registered (fail closed). On today's six builds (250-285 MB each) that keeps at most about 6 builds, about 1.7 GB.

### 8.6 Bootstrap: an operator act

Ruled 2026-10-19 (decision 15): a node with no Claude Code build at all is bootstrapped once by the operator in `ccrc install` from the signed manifest (OA-5 in the ledger), never by the timer and never by `curl | bash`: ccrc downloads the platform binary the signed manifest names, verifies it with `gpgv` and SHA-256 as in §8.1 step 5, smoke-tests it, and then runs that binary's own `install` into the same staging postcondition. Nothing may select it before the postcondition and the smoke pass, and the bootstrap never creates or replaces the launcher path.

## 9. The nine traps, answered

1. **Installing is not rolling.** Answered by construction: the installer only publishes a candidate and promotes an approved target; nothing running changes until a spawn, and the prune keeps every build a live process executes or a roll record names (§8.5). The UI says "behind", never "updated", until the running version moves (§6.3).
2. **Never `ensure` or `stop` as the primitive.** `ccd roll` uses neither: hibernate's `_ws_unsupervise` before the kill (so `Restart=always` cannot resurrect the old process), with the `.stopped` stamp it writes replaced by a `.rolling` marker every reader honours and any stale one recovered by a strict resume, and its own `_supervised_start` (§7.1).
3. **The uuid rotates on `/clear`; refuse if the transcript is missing.** Swap's pre-flight, `sleep 1`, uuid re-read and second `_transcript_matches` are in the roll's act order, and every ccrc-initiated resume is strict through `$REG/<id>.resume-strict`, read inside the unit, with no silent `--session-id` fallback; `cmd_hibernate` gains the pre-flight too (§7.1, §7.3).
4. **A new binary changes the first-run gates.** `_accept_first_run_prompts` runs on every spawn as today, but nothing in it is keyed by version, so the canary is the measurement, and nothing but a canary runs an unapproved build: the candidate is promoted to the target only after the (node, kind) canary comes back at an idle prompt, judged by ccd, on the new build with the same uuid (§8.1, §10.1).
5. **Idle semantics are version-coupled.** The gate fails closed on an unmeasured, disagreeing or untrusted running version (`version-unmeasured`, `version-untrusted`, floor 2.1.277), and the canary's health is judged by ccd's own `_idle_for_keystroke`, not by the new build's status reporting (§7.2, §10.1). `liveStatusCoversDelegation` stays a floor; this programme adds the per-build canary record that its "re-measure on every bump" note asks for.
6. **Queued prompts and background work are lost on restart.** Hibernation's checks are kept whole: strict `idle`, no draft, turn marker `bg` exactly 0 and `crons` exactly 0, no queued mail, no open run, nobody viewing or attached, plus `compacting` and `recent-spawn` (§7.2). Even a manual roll keeps them.
7. **Restarting from inside the session.** A roll of the caller's own session refuses `self-roll`, and every roll's act is detached (§7.1).
8. **Both boxes and every lane.** The installer and the launcher ship to every `fleet` and `both` node `ccrc install` installs, and `ccd roll` with ccd, keyed by `nodeId` and the inventory's role, never by hostname (§8.1). Codex lanes run the same launcher through `ccrc-codex` with `CCRC_CLAUDE_KIND=codex`, so their target and canary are their own (§10.1); the shim and proxy units are never touched by a roll.
9. **Security.** The token stays out of the repo, argv, logs and, by the preferred seam, every environ; the launcher reads no secret (§8.3). The installer runs under a scrubbed environment and a ccrc-owned config dir; the prune reads only `/proc/<pid>/exe` links; installer stderr reaches only the journal, never the node file or an API (§6.2). Release integrity is checked independently, by `gpgv` against a committed key before size and checksum (§8.1). Who may roll is closed to sessions (§7.6), and intent writes are operator-only and journalled (§10.5).

## 10. Canary, intent and auto-roll (`claude-intent-vocabulary`, `claude-canary-and-auto-roll`)

### 10.1 The canary gates adoption

The first roll onto a candidate for each **(node, lane kind)** pair is its canary (decision 8, ruled 2026-10-19: per machine and account kind; per node alone and once fleet-wide are not taken), where lane kind is `anthropic` or `codex` (they pass different start paths: the Codex shim and proxy). Selection is two-phase: until a pair's canary has passed, **no spawn on that pair other than the canary runs the candidate**; crash restarts, wakes, fresh starts and every other roll keep landing on the pair's current target. The canary roll names the candidate through `.rolling` (§7.1). A canary may be manual (the operator's button) or, in `auto`, the sweep's first eligible behind session on the pair.

The canary is **healthy** when ccd judges, at the deadline of 120 s after the roll's start: the unit's `spawn` stamp is newer than the roll's start with rc 0 (a settle not finished by the deadline is a failure); `_idle_for_keystroke` passes (prompt present, no menu, empty box, no `esc to interrupt`); the transcript path and uuid are unchanged and its size has not shrunk; and the new pid's `/proc/<pid>/exe` build and its `sessions/<pid>.json` version both equal the candidate. It must then stay **15 min** without a restart whose recorded cause is not an OOM kill, and its RSS at the end of the soak must not exceed the old build's RSS for that session by more than 30%, so a build that uses more memory fails even though its OOM restarts are excused. A healthy canary records `(node, kind, build) → passed` in `claude_canaries`; the server then sets `approvedTarget[kind]` for that node in the projected intent, and the installer promotes it (§8.1 step 8).

### 10.2 The intent, its vocabulary and its projection (`claude-intent-vocabulary`)

Claude Code versions are bare `x.y.z` with channels `latest|stable`; the update plane's `RELEASE_TAG` (`^v\d+\.\d+\.\d+$`), `UpdateChannel` (`stable|dev`), `AutoMode` (`off|stable|channel`) and `compareReleaseTags` (throws on non-tags) are ccrc-release-shaped [C]. So the Claude intent is a **parallel** vocabulary in `shared/claudeVersion.ts` (`CLAUDE_VERSION` regex, `ClaudeChannel`, `ClaudeRollMode = 'off'|'manual'|'auto'`, `ClaudeLaneKind`, `ClaudeInstallWhy`, `compareClaudeVersions`) and parallel tables in `coord.db`: `claude_intent` (scope `'*'` or a nodeId; `channel`, `pin`, `mode`, `setAt`), `claude_halts` (`build`, `reason`, `node`, `at`, `ackedAt`), `claude_canaries`, `claude_roll_failures` (`build`, `node`, `session`, `at`, `ackedAt`) and `claude_intent_log` (§10.5). Nothing is added to `releases` or `update_intent`.

The server resolves the effective intent per node (node row over `'*'`) and projects it as `~/.ccrc/claude-intent` (mode 0600), a sibling of `~/.ccrc/update-intent`, carrying `at`, `channel`, `pin`, `mode`, `halts` (every unacked halted build), `approvedTarget` (per kind, §10.1) and `minBuild` (§8.1 step 2). `writeOwnProjection` writes it on the server's own node, and `ccd-update-sync`, which already pulls the leased intent every 60 s, pulls it on the others as an additive field of the same response. Older parsers ignore the field. The intent pull failed intermittently today (one HTTP 502, a few timeouts) [F]. A node that cannot pull keeps its last projection, and once that projection is older than 15 min the installer stops advancing (§8.1 step 1): **a node cut off from the control plane never adopts a build the control plane has not seen.** A node whose own canary or restore fails writes `~/.ccrc/claude-halted` at once (ccd, at the outcome), and its installer and launcher honour it before the server hears of it.

Reused as-is from the update plane: the lease (`dispatchNode`/`releaseLease`/`settleNode`), `fleetGate`/`isHalting`/`ack`, the deadline, the notifier (`update/notify.ts`, a push opening `/settings`), and the capability gate idiom (`moveRefusal`'s `no-update-gate`, `_inst_caps`).

### 10.3 Halts, failures and rollback

**A halt** is raised by any of: a canary that is not healthy; a roll restore that fails; **two post-kill roll failures onto one build within 24 h on any node** (counted in `claude_roll_failures`); or an operator act. A halt:
1. **halts the build**: a `claude_halts` row, projected in every node's intent; no installer publishes or promotes it and no roll targets it, on any node, until the operator acks. Because selection is two-phase, a halted candidate never became any pair's target, so **nothing is pinned automatically**: every node stays where it is, on the target it already runs (decision 10, ruled 2026-10-19: halt only; an automatic pin-back is not taken);
2. **notifies the operator**: one push, kind `update`, "Claude Code 2.1.303 failed its canary on <node role>: <reason>; nodes stay on their current build", opening Settings;
3. **restores the session** on its own `from` build (§7.4), reported separately from the node's target;
4. **rolls sessions off it**: a session whose running build is halted (it got there before the halt, e.g. through a lane's own updater before W3 and W4) reads `on-halted` and is rolled back to its pair's target under the same gate and budgets. `ahead` stays manual-only, for operator pins.

**A failed roll** that does not raise a halt records a `claude_roll_failures` row; that session holds `roll-failed` for that build until the operator acks it, and shows `roll failed`.

**An upstream retreat** (the channel pointer moved below the newest approved target, `upstream-retreat` from any node: a release you run was pulled) halts the current target for new candidate selection and new rolls, notifies the operator with a one-tap **Pin to 2.1.x** (the pointer's build), and shows in Settings. It never downgrades unattended; the downgrade is the operator's pin (decision 12, ruled 2026-10-19: notify with a one-tap pin; an automatic downgrade is not taken).

**A pin** is operator-only. When set, every node's installer installs and verifies the pinned build if it is absent (§8.1), keeps its current target until it can (`pin-unavailable`), then promotes it for both kinds; sessions above it read `ahead`.

Ack clears the halt, not the pin; Unpin is a separate act. After a failed canary, rolls onto that build resume **only when the operator acknowledges it**, never automatically when a newer build passes (decision 9, ruled 2026-10-19; automatic clearing is not taken). A newer build is never blocked by an older build's halt: it gets its own canaries.

### 10.4 Modes and kill switches

- **Modes** (`claude_intent.mode`, per node or `'*'`): `off` (the installer still installs and reports; nothing rolls), `manual` (the session command only), `auto` (the sweep, §7.4). Default `manual`. **Ruled 2026-10-19 (decision 3):** a node becomes `auto` only after its first manual canary has passed (OA-3) **and** one shadow week of its hold counts has been reviewed (OA-6); `manual` until then. `auto` everywhere at once, and `manual` forever, are not taken.
- **`auto` needs the node's capability.** Like `moveRefusal`'s `no-update-gate`, auto applies to a node only when its `ccd caps` lists `roll` and its inventory row has been re-measured since the mode was set. A node that was offline when auto was set does not converge unattended: its first roll after it returns is a canary again.
- **Shadow first.** In `auto`, until `$REG/claude-roll-live` exists on the node, the sweep logs `claude-roll-shadow <id> from=<v> to=<v>` lines and **also each hold, by name**, at most once per id per hour, and exposes the last sweep's counts by hold on `/api/fleet/health` (the hibernation sweep logs only its would-act answers, which left today's gate unmeasurable [F]).
- **Kill switches.** `$REG/claude-roll-disabled` makes `ccd roll` refuse every roll on the node, automatic or manual, at the act, whatever the server says; `$REG/claude-install-disabled` makes the installer report and change nothing. They, `claude-roll-live` and the self-update keep marker (§8.2), are written and removed only by operator-only verbs, `ccd claude roll-disable | roll-enable | install-disable | install-enable | roll-live on | off | self-update keep | release`, each journalled with its actor, refused inside a session, and forbidden to sessions (§7.6). `single-definition.test.ts` pins that no automatic path writes any of them. The verbs and their markers all ship in W1 (CB1c), before any reader exists, so every switch is in the operator's hand before the act it stops (rev 3; rev 2 shipped the roll switch with `ccd roll`). `roll-live on` refuses while `$REG/hibernate-live` is younger than 24 h (decision 13).

### 10.5 Intent writes

- Routes: `POST /api/claude/intent` (channel, pin, mode; scope `'*'` or a nodeId), `POST /api/claude/halts/:build/ack`, `POST /api/claude/roll-failures/:id/ack`, `POST /api/claude/unpin`, and `POST /api/sessions/:id/roll` (§7.5). All are operator-cookie routes, listed as non-exempt in the gate test's both-direction assertion (`auth/gate.ts`'s `EXEMPT` table), never box-token routes (every session holds the box token), and absent from `ccrc-api`.
- Every `claude_intent`, `claude_halts` and acknowledgement write is journalled in `claude_intent_log` with its actor, as the update plane's `updateIntentLog` does: `pwaDec(req)` for the operator, `canary`, `roll-failures` or `upstream-retreat` for the automatic halts.
- The server validates `pin` against `CLAUDE_VERSION` and `minBuild` before writing. The node parses the projection with `jq`, re-validates every field, and keeps its last good projection on any failure.

## 11. Waves, deploy classes and gates

| W | Scope | D | Deploy class | Depends on | Deploy gate |
|---|---|---|---|---|---|
| 1 | Observe: installer in `--measure` mode (verify and smoke the on-disk builds, publish the candidate) and its timer, `ccd claude install-disable/enable`, the tenth NODE_FILE with the pid map and `_mem_headroom`, `nodes` columns, `FleetSession.claude`; PWA: `sessionFacts` extended, facts chip and section, card chip, Settings card read-only | `claude-version-observed`, `claude-node-file`, `ccrc-claude-installer` (measure only) | FLEET FIRST (install spine), then server; PWA after S7a, S16 and R2 (§6.4) | M1 | additive fields; absent node file = no columns, no chip |
| 2 | `ccd roll` (gate, holds, always-detached act, `.rolling`/`.resume-strict`/`.claude-build` read by `_spawn_start`, spawn cap, restore, `--expect`, roll kill switch), who may roll (§7.6), hibernate pre-flight and strict wake, `POST /api/sessions/:id/roll` admitting only the canary, the session command | `ccd-roll-verb`, `strict-resume-and-transcript-preflight`, `roll-holds`, `roll-spawn-carrier` | FLEET FIRST (`ccd`, unit drop-in), then server | 1 | `verbSupported(state, CCD_ARGV.roll(...))`; route `404` without it |
| 2a | First live manual roll: the canary for one (node, kind), on one idle behind session the operator names | — | **operator act** | 2, M2 | operator approval naming the SAFETY rule (no roll of a live session during development; this is the one allowed live action) |
| 3 | Installer live (`install` mode, two-phase promotion, intent freshness, space, signature, backoff), launcher adopted as a pure selector, upstream token through ccd's spawn, prune adopted and the old timer retired, intent tables, projection and journal, intent routes, Settings controls (channel, pin, mode `off`/`manual`) | `claude-intent-vocabulary`, `ccrc-claude-installer`, `launcher-and-prune-adopted` | **AGENT-FIRST** (the launcher is on every lane's exec path), then server | 1, 2a, M4, M5 | node file from W1 green for 24 h; byte-compare and keep-aside done; `ccrc doctor` launcher and old-timer checks green |
| 4 | Lane self-update off | `lane-self-update-off` | FLEET, SELF-GATED (`ccd` spawn line) | 3 | `~/.ccrc/claude-installer-proven` on the node |
| 5 | Auto-roll: scheduler, shared budgets with hibernation and stop-done, memory gate, `recent-spawn` and `compacting` holds, canary table, failure counting, halts, `on-halted` rollback, upstream retreat, notify, shadow then live | `roll-scheduler-memory-aware`, `claude-canary-and-auto-roll` | server, then **operator act** (`ccd claude roll-live on` per node) | 3, 4, M3 | one shadow week of hold counts reviewed by the operator; mode `auto` set; not during Task 19's shadow week or first armed day |

**The plans** (rev 3). Each wave has its own plan under `docs/superpowers/plans/`, dated 2026-10-19: W1 `…-w1-observe.md` (CB1a to CB1h), W2 and W2a `…-w2-roll.md` (CB2a to CB2h, then OA-3), W3 `…-w3-install.md` (CB3a to CB3j), W4 `…-w4-self-update-off.md` (CB4a) and W5 `…-w5-auto-roll.md` (CB5a to CB5c). The ledger `docs/superpowers/programs/claude-binary-lifecycle.md` holds the gates between them and the operator acts OA-1 to OA-6. Two items move earlier than the table above, both to W1: who may roll and install (§7.6, CB1b), so the deny rules are in force before any verb they name exists; and every operator kill-switch verb (§10.4, CB1c), so each switch is in the operator's hand before the act it stops.

Before W3 the adopted launcher does not exist, so W2's roll names its build through `.rolling`, which today's launcher honours through `CCRC_CLAUDE_VERSION` (§2.2), and `.claude-build` keeps a rolled session on its build across a later crash restart, which would otherwise return it to its lane's recorded `version_to`. W2 rolls only the W2a canary.

### 11.1 Measurements required before their wave

| M | What | Read-only where | Before |
|---|---|---|---|
| M1 | `FleetSession.version` against `/proc/<pid>/exe` per session; the source of "2.1.9x" | fleet node | W1 |
| M2 | How many behind sessions carry `crons` in their turn marker | fleet node | W2a |
| M3 | The pane and the live word during an idle compaction: is `esc to interrupt` shown; does the transcript mtime move | a fixture session, no `-p` turn on the fleet | W5 (and the default window) |
| M4 | Which token seam Claude Code accepts for the upstream token kind (descriptor, `apiKeyHelper`), and, if the environment is used, whether `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` strips it from tool children | development fixture | W3 |
| M5 | A tampered manifest and binary through a local HTTPS proxy: does `claude install` refuse; what controls the `"flag"` enforcement; the documented key fingerprint for the committed keyring | development fixture | W3 |

## 12. The numbers

| Number | Value | Why, and where it was measured |
|---|---|---|
| installer tick | 30 min, ±5 min random; backoff to 6 h on repeated failures | 24 releases in 30 days, arrival lag today 0.7-4.8 h [F]; acceptance asks for one tick; a pointer probe is a 64-byte `curl` [I] |
| install timeout | 600 s | 286 MB build; the installer's own stall timeout is 120 s and it retries dropped connections [I] |
| free space | 2 × build size + 2 GiB | about 286 MB staged plus the final copy [I]; the work volume has filled before |
| smoke timeout | 30 s | `--version` returns at once on a cached binary [I] |
| intent freshness | 15 min | the pull runs every 60 s; today's pull failures were single 502s and timeouts [F] |
| build floor | 2.1.277 (`minBuild`) | `liveStatusCoversDelegation` [C]; above the 2.1.89 signature floor [I] |
| roll quiet window | 90 min, ruled 2026-10-19 (decision 2) (operator-settable, 15 min to 24 h, `$REG/claude-roll-after-minutes`) | past the prompt cache's 1 h life, and off the 50-70 min band where Claude Code's idle compaction fires (about 55 min after `end_turn`) until M3 shows compaction is visible to `_idle_for_keystroke`; 27 of 45 idle more than 2 h [F] |
| compacting hold | transcript unmodified for 10 min | a compaction rewrites the transcript |
| recent-spawn hold | 120 s since any spawn on the node | 74 OOM kills within 120 s after a restart of any cause [F] |
| headroom gate | 3 GiB by `anon` against the lowest ancestor `memory.max` | about 0.79 GiB net per recycle [R18]; max RSS 425 MiB [F]; the user tree is the tighter ceiling today [F]; Task 19's stop rule forbids `memory.current` |
| spacing on a node | 5 min | the hibernation sweep clock (`HIBERNATE_SWEEP_MS`) |
| per-hour cap | 6 automatic rolls per node | the spacing allows 12; half leaves room for hibernation wakes and crash restarts |
| shared act budget | 3 per sweep fleet-wide (rolls, hibernations, stop-done), 1 roll per node per sweep | `HIBERNATE_PER_SWEEP` [C] |
| resume herd | inside `WAKE_BURST` 2 per 60 s | `wakeBudget.ts` [C] |
| spawns per roll | at most 2, counted in `.rolling` | `_supervised_start` resets the start-limit counter [C], so systemd's `StartLimitBurst=5` does not bound it |
| stale roll record | 30 min with its holder unit gone | the act's own deadline plus the restore, well under it |
| agent exec timeout for `roll` | 30 s | the gate is synchronous, the act detached; `DEFAULT_EXEC_TIMEOUT_MS` 10 s, `MAX_EXEC_TIMEOUT_MS` 300 s [C] |
| canary deadline | 120 s | pane come-up p50 2.1 s, p95 19.2 s, max 37.5 s [F]; about three times the max |
| canary soak | 15 min, non-OOM restarts only; RSS at most +30% over the old build | OOM kills are the box's background rate: 174 OOM-linked ends in four days [F] |
| failure halt | 2 post-kill roll failures onto one build within 24 h, any node | one failure can be the session; two is the build |
| builds kept | candidate, pair targets and previous targets, pin, every build a roll record names or a live process executes, 3 newest smoke-passed | today's prune keeps 3 [F]; the native cleanup keeps 2 [I] |
| placeholder and staging age | 1 h | the native cleanup's own threshold [I] |
| proven installer | 72 h live, one self-resolved install, no failure in 24 h | builds arrive about every 1.7 days [F], so 72 h normally includes one release |
| per-session bound | rolled within 1 h of passing the gate | one sweep (5 min) + spacing + cap |

## 13. Operator decisions (ruled 2026-10-19)

The operator answered all sixteen on 2026-10-19 through the superpowers visual companion, in their words "all cards accepted/answered". Every card stands at its recommended option, A; decision 1 was clicked explicitly. Each entry gives the question, the ruling, where the body carries it, and the alternatives kept here as **not taken**.

1. **Channel.** **Ruled: `latest`**; the canary and the halt are the safety net (§8.1 step 2, §10.1, §10.3). *Not taken:* `stable` (2.1.292 on 2026-10-18, ten builds behind what most sessions already ran).
2. **Roll quiet window.** **Ruled: 90 minutes** before an automatic roll; past the prompt cache's life and off Claude Code's idle-compaction band; revisited after M3 (§7.2, §12). *Not taken:* 15 min (the brief), 60 min, and only hibernation's 6 h.
3. **Default mode.** **Ruled:** `auto` per node only after its first manual canary passes (OA-3) and one shadow week (OA-6); `manual` until then (§10.4). *Not taken:* `manual` everywhere for good; `auto` on every node once any canary passes.
4. **Opting out.** **Ruled: a new `.no-roll` marker**; a roll resumes at once, unlike a hibernation (§7.2). *Not taken:* reusing `.no-hibernate`.
5. **Each account's own updater.** **Ruled:** turned off automatically once the ccrc installer is proven, visible in Settings, reversible by the operator's `ccd claude self-update keep` (§8.2, §10.4). *Not taken:* an operator act per node to turn it off.
6. **Memory gate.** **Ruled: 3 GiB of headroom only**; full swap is shown in Settings, not a hold (§6.2, §7.4). *Not taken:* also holding while swap is full, which would hold every roll today.
7. **The operator's manual Restart.** **Ruled:** it skips the quiet window; every other safety check still applies, `compacting`, `recent-spawn` and `low-memory` included (§7.2, §7.5). *Not taken:* the manual roll waiting out the window like an automatic one; a manual override of any other hold.
8. **Canary scope.** **Ruled: per (node, lane kind)**, that is per machine and account kind (§10.1). *Not taken:* per node; once fleet-wide.
9. **After a failed canary.** **Ruled:** rolls onto that build resume only when the operator acknowledges it; a newer build is never blocked by an older one (§10.3). *Not taken:* clearing automatically when a newer build passes its canary.
10. **A failed canary.** **Ruled:** halt that build; every node stays where it is, with no automatic pin-back (§10.3). *Not taken:* also pinning the fleet automatically, which with two-phase selection could only downgrade.
11. **The upstream token's seam.** **Ruled: a descriptor ccd hands over at spawn**; the launcher reads no secret (§8.3), subject to M4 naming the variable. *Not taken:* `apiKeyHelper`; the environment (a deviation from the brief's trap 9). If M4 shows no descriptor fits, the question returns to the operator.
12. **A pulled release you run** (an upstream retreat). **Ruled:** notify with a one-tap pin; never an unattended downgrade (§10.3). *Not taken:* downgrading automatically.
13. **Hibernation's shadow week.** **Ruled:** automatic rolls stay off during it (and its first armed day), and roll restarts are tagged `cause=roll` so its numbers stay clean (§7.4, §10.4). *Not taken:* rolling through it; untagged roll restarts.
14. **The controls.** **Ruled:** a Claude Code card on the redesigned Settings → Updates page, between Nodes and Update policy, and the Claude Code mode under Automation (§6.3; the Settings plan's coordinator item C5, answered there). *Not taken:* a separate Settings page.
15. **A node with no Claude Code build.** **Ruled:** the operator installs it once from the signed manifest in `ccrc install` (OA-5); the timer never bootstraps (§8.6). *Not taken:* an automatic bootstrap by the timer.
16. **Arming hibernation.** **Ruled:** it stays a separate decision, the hibernation plan's Task 19, outside this programme (§4). Once the launcher is adopted every wake is a roll onto the approved target, and the live stop-finished-workers lane already is one; arming would roll the long-idle population for free, but that is Task 19's call. *Not taken:* arming it as part of this programme.

## 14. Decisions (named here)

Each number is defined once, in the §Deviations and decisions section of the wave plan that builds it (the task named in the last column); the spec and the other plans cite it. The other eighteen numbers of the block, D-5695 to D-5724, are the plans' own task-level decisions.

| Number | Slug | Section | Defined by |
|---|---|---|---|
| D-5700 | `claude-version-observed`: per-session running build against its pair's target, the card chip, `sessionFacts`' Claude Code state in the facts section and header view, the Settings card | §6.1, §6.3, §6.4 | CB1f |
| D-5699 | `claude-node-file`: `~/.ccrc/claude.json` as the tenth NODE_FILE, its pid map, the closed `why` enum, `_mem_headroom`, and the `nodes` `claude*` columns | §6.2 | CB1e |
| D-5711 | `claude-intent-vocabulary`: parallel `claude_*` tables, `shared/claudeVersion.ts`, the timestamped `~/.ccrc/claude-intent` projection with halts, `approvedTarget` and `minBuild`, the freshness rule, the intent routes and journal | §10.2, §10.5 | CB3a |
| D-5705 | `ccd-roll-verb`: a dedicated same-account restart-in-place sharing hibernation's gate and act order, always-detached act, arity and action token, no self-roll, `roll` lifecycle act, who may roll | §7.1, §7.6 | CB2c |
| D-5703 | `strict-resume-and-transcript-preflight`: no silent `--session-id` fallback on a ccrc-initiated resume; `cmd_hibernate` gains swap's pre-flight and the strict wake | §7.3 | CB2a |
| D-5709 | `roll-holds`: the roll window, the opt-out suffix parameter, and the holds `version-unmeasured`, `version-untrusted`, `limit-blocked`, `no-roll`, `roll-failed`, `low-memory`, `recent-spawn`, `compacting` | §7.2 | CB2g |
| D-5722 | `roll-scheduler-memory-aware`: serial per node, the serialiser held only for verdict and dispatch, shared act budget with hibernation and stop-done, wake budget, Task 19 memory measure, spacing, per-hour cap, the restore | §7.4 | CB5a |
| D-5715 | `ccrc-claude-installer`: the timer, scrubbed environment, freshness, floor, space and backoff, install from another build without `--force`, `gpgv` and postcondition verification, smoke, candidate, promotion from the intent, measure mode, roles, operator bootstrap | §8.1, §8.6 | CB3e |
| D-5716 | `launcher-and-prune-adopted`: the shipped launcher as a pure selector keyed by lane kind, its rungs, the upstream token through ccd's spawn (implementing D-159), the prune with the old timer retired; supersedes the decision brief §6 and the locks plan's "Not done here"; lock 5 kept | §8.3-§8.5 | CB3f |
| D-5721 | `lane-self-update-off`: `DISABLE_AUTOUPDATER=1` on ccd's spawn line once the installer is proven | §8.2 | CB4a |
| D-5723 | `claude-canary-and-auto-roll`: two-phase selection gated by a canary per (node, lane kind) judged by ccd, halts (canary, restore, repeated failures, upstream retreat), `on-halted` rollback, notify, modes, shadow, kill switches and their operator verbs | §10.1, §10.3, §10.4 | CB5b |
| D-5704 | `roll-spawn-carrier`: `$REG/<id>.rolling`, `.resume-strict` and `.claude-build`, read by `_spawn_start` on every spawn of the unit; the spawn cap and `RestartPreventExitStatus`; stale-record recovery; readers take `.rolling` over `.stopped` | §7.1 | CB2b |

## 15. Invariants

1. A running session's build changes only through a spawn; the installer never touches a running process, and the prune never deletes a build a live process executes or a roll record names.
2. No ccrc-initiated restart turns a resume into a fresh conversation.
3. Nothing hibernation would hold for is rolled automatically; a manual roll differs only in the quiet window.
4. At most one roll is in flight per node, none starts below the memory gate or within 120 s of any spawn on the node, and a roll spawns at most twice.
5. No spawn other than a canary roll runs a build without a passed canary on its (node, lane kind). The launcher never serves a build that failed signature, checksum or smoke, a 0-byte placeholder, or a halted build, on any rung; a pinned build wins over the channel.
6. A failed canary leaves every node on the build it already ran as its target and the operator notified, and no roll onto the failed build ever runs again until the operator acks.
7. No token, secrets path, host or lane name enters the repo; the token never reaches argv, a log or, by the preferred seam, any environ; the launcher reads no secret; installer stderr never reaches a node file or an API.
8. A node without `roll` in `ccd caps` behaves as today: the roll route answers `404`, and nothing rolls there.
9. `ccrc wrappers` never overwrites the launcher (lock 5).
10. A node whose intent is older than 15 min never publishes a new candidate or promotes a target.
11. No session can roll, install or select a build: those verbs and paths are denied to sessions and children (§7.6), and the kill switches have operator-only writers.
12. A crash restart after a roll never runs a lower build than the one the session last ran.
13. No roll, hold, lock or record refuses or delays the operator's account switch or the auto-swap beyond the act's own deadline; a roll yields to a swap (§3 ruling 4, §7.1).
14. Automatic rolls never run during hibernation's Task 19 shadow week or its first armed day, and every roll restart is journalled `cause=roll` (decision 13).

## 16. Out of scope

Rolling processes outside ccrc's supervision; operator-chosen per-session pins; downgrades other than through a pin; Claude Code's own `--bg` sessions and `claude respawn`; changing hibernation's 6 h N or arming it; a version-keyed table of first-run gates (the canary measures instead).

## 17. Review log

**rev 1 → rev 2 (2026-10-18).** Three reviews of rev 1, each verdict NEEDS REVISION: a correctness and work-loss review, a security review, and a reuse and sequencing review. Every finding above low severity, and every cheap low one, is applied:

- **The spawn runs in the unit** (critical, two reviews): the build and strict resume no longer travel as environment variables of the `ccd roll` process; `.rolling`, `.resume-strict` and `.claude-build` in the registry are read by `_spawn_start` on every spawn of the unit, and the roll never calls `_spawn_settle` (§7.1, `roll-spawn-carrier`).
- **An interrupted roll** (critical) and **the synchronous contract against the agent's exec timeout** (high): the act is always detached; the caller gets a tx id; `.rolling` replaces the `.stopped` stamp for every reader; a stale one is recovered by a strict resume; the serialiser is held only for verdict and dispatch (§7.1, §7.4).
- **The canary did not gate adoption** (critical, all three reviews): selection is two-phase, candidate then approved target per (node, kind) (§8.1, §10.1).
- **A failed canary pinned to an arbitrary straggler** (high, two reviews): no automatic pin; a halt leaves nodes on their target; `on-halted` sessions are rolled back (§10.3, decision 10).
- **The restore raced the unit** (high): kill and unsupervise first, then the rewritten record; the start bound is the record's spawn cap, since `_supervised_start` resets systemd's counter (§7.4).
- **Partitioned nodes kept advancing** (high, two reviews): a timestamped intent with halts and `approvedTarget`; stale means install-only; a local halt file (§8.1, §10.2).
- **Sessions were not barred from rolling and installing** (high): §7.6, the action token, arity, no self-roll.
- **The upstream token in the environ, and wrong facts about the roster and D-159** (high): the launcher is a pure selector; the token goes through ccd's spawn, preferably on a descriptor; D-159 implemented, not superseded; `exec.secretsFile` already exists (§8.3, decision 11).
- **Circular waves** (critical): W1's measure mode publishes a candidate (§8.1, §11).
- **The memory gate used `memory.current`** (high): Task 19's measure (§6.2, §7.4).
- **UI and Settings collisions with skins W2 and the Settings redesign** (high, two findings): facts through `sessionFacts`, S16 and `sessionHeaderView`, a session command, a per-skin width table, the Updates-page card after R2 (§6.3, §6.4, decision 14).
- **Medium findings applied:** prune race, old timer retirement and live-pid locks (§8.5); disk space, staging cleanup, backoff and network-failure reporting (§8.1); upstream retreat (§10.3, decision 12); the `compacting` hold and a 90 min window off the compaction band (§7.2, §12, decision 2, M3); the canary judged by ccd, not the build's own status, with an RSS check (§10.1); halts on repeated roll failures and the `roll-failed` hold (§10.3); no downgrade on a crash restart after a roll, and W2 limited to the canary (§7.1, §11); the `recent-spawn` hold and post-canary re-measure (§7.2); stop-done in the shared budget and Task 19 sequencing (§7.4, decision 13); today's stragglers mostly lack `crons` (§2.4, §7.2, M2); arity and on-node `--to` validation (§7.1); a failed roll is not deliberate for the dead-coordinator lane (§7.1); the roll kill switch moved to W2 (§10.4); `--force` dropped (§8.1); the launcher reads no roster, uninstall restores the kept-aside copy, D-3478 cited (§8.3); the two version sources cross-checked (§6.1, §6.2, M1); fail-closed launcher rungs and on-node `--to` checks (§8.3, §7.1); an independent `gpgv` check, floors, curl limits and an operator bootstrap (§8.1, §8.6, M5); intent routes and their journal (§10.5).
- **Low findings applied:** the deliberate row first (§7.1); one transport, the exec grant with a 30 s timeout for the gate, the act detached (§7.1); operator-only verbs for the kill switches and `claude-roll-live` (§10.4); the bootstrap made an operator act (§8.6); the installer's scrubbed environment (§8.1); the closed `why` enum and leak hygiene (§6.2, §8.3, §8.5); the opt-out suffix as a gate parameter (§7.2); one gate spelling, `verbSupported(state, CCD_ARGV.roll(...))` (§7.1); seven lanes at .302, not eight (§2.1); placement per role (§8.1).
- **Landing note.** The spec lands before its plan, so its decisions are named by slug only: `deviation-refs.test.ts` requires every number cited in the tree to be defined in a plan's Deviations section. The plan enters the twelve allocated numbers against these slugs in §14's order.

**rev 2 → rev 3 (2026-10-19), the operator's rulings and approval.** The operator answered §13's sixteen decisions through the superpowers visual companion ("all cards accepted/answered"): every card at its recommended option A, decision 1 clicked explicitly. The spec is approved. What changed:

- **§13** rewritten as rulings, each dated, with where the body carries it and the alternatives marked *not taken*; **§3** gains the rulings and the standing rules that bind the design; the Status line records the approval and names the five wave plans and the ledger.
- **Carried through the body:** the channel default `latest` (§8.1 step 2, decision 1); the 90 min window (§12, decision 2); the default mode, `auto` per node only after its first manual canary and one shadow week (§10.4, decision 3); `.no-roll` as its own operator-written marker with no writer in the tree (§7.2, decision 4); the self-update switch reversible by the operator's `ccd claude self-update keep | release` and shown in Settings (§8.2, §10.4, decision 5); headroom-only memory gate, swap reported in the node file and shown in Settings (§6.2, §6.3, §7.4, decision 6); the manual Restart skipping only the quiet window (§7.2, decision 7); canary per (node, kind) (§10.1, decision 8); acknowledgement-only clearing (§10.3, decision 9); halt with no pin-back (§10.3, decision 10); the descriptor seam, the other two marked not taken, with M4 able only to return the question to the operator (§8.3, decision 11); the one-tap pin on a pulled release (§10.3, decision 12); `cause=roll` from W2 and `roll-live on` refusing while `hibernate-live` is younger than 24 h (§7.4, §10.4, decision 13); the Settings slot between Nodes and Update policy with the mode under Automation (§6.3, decision 14); the operator's one-time bootstrap (§8.6, decision 15); arming hibernation outside the programme (§4, decision 16).
- **The 2026-10-19 swap ruling** (account switching and the auto-swap are never blocked, given on the Accounts design the same day) reaches this design: rev 2 had `cmd_swap` refuse while a `.rolling` record was live, and the 15 min canary soak held the record. Rev 3: `cmd_swap` is never refused for a roll; a roll yields with the new `swapping` hold; a swap that arrives mid-act waits at most the act's deadline; the soak runs after `.rolling` is removed, in `$REG/<id>.claude-canary`, and a swap during it makes the canary `inconclusive` (§7.1, §7.2, invariant 13).
- **The node file** gains `switches` (the operator's markers, read-only) and `rollAfterMinutes`, and `memory` gains the swap figures (§6.2), because Settings shows the kill switches and swap and the server's verdict needs the window.
- **Two items move to W1** (§11's "The plans"): the deny rules of §7.6 (CB1b) and every operator kill-switch verb (CB1c), so neither lands after the act it guards.
- **§14** names each decision's global number and its defining task; **§15** gains invariants 13 and 14.

