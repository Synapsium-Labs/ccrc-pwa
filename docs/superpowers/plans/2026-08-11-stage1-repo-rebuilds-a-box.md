# Stage 1: The Repo Can Rebuild a Box — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gap between the repo and the running boxes so that a deploy from a clean checkout reproduces production — and prove it with a build stamp that `/health` and `ccd version` report and the deploy itself asserts.

**Architecture:** Four moves, all in the deploy/config seam, none in product logic: (1) repatriate every artifact that exists only on the live hosts (systemd drop-ins, the cap-scopes enforcer, live-ahead script edits) and make `deploy.sh` install them; (2) cut `ccrc.service` over to `EnvironmentFile=` and retire the hand-made drop-in on the live box; (3) give the agent's projects root an env seam; (4) stamp every deploy with `{sha, ref, builtAt, dirty}` shipped to `~/.ccrc/build.json` on both boxes, surfaced by `/health` and a new `ccd version` verb, and asserted equal by the deploy's own final links.

**Tech Stack:** bash (deploy.sh, ccd), systemd user units, TypeScript (Fastify server, agent), vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-11-ccrc-oss-single-dev-infra-design.md` (Stage 1 row + §2, §3).

## Global Constraints

- Node floor: `>=22.13.0` (the `engines` pin; node:sqlite without flags).
- Config format is env files, never TOML/YAML (spec §2).
- `CCRC_PORT` default stays `7788`; `CCRC_HOST` default stays `127.0.0.1` (spec §6; the live box overrides both via its env file).
- No new npm dependencies in server/ or agent/.
- Tests-first for every behavior change; `deploy.sh` structure changes are pinned by `agent/test/deploy-verify.test.ts` reading the script as text (house pattern).
- Existing tests define compatibility: `server/test/health.test.ts`, `server/test/config.test.ts`, `agent/test/deploy-verify.test.ts` may be EDITED where this plan says so, never deleted.
- Both remote command blocks in deploy.sh (`AGENT_CMD=`, `REMOTE_CMD=`) are single-quoted strings whose `&&` links existing tests split and order-check — additions must stay inside the quoting discipline (no nested single quotes; `$(…)`/`$VAR` expand remotely).
- The live boxes: server = server-box (`you@203.0.113.7:2222`, key `~/.ssh/your-key-b`), fleet host = openclaw (self, `you@198.51.100.7:2222`). Deploys run from a clean worktree at `origin/main`.

## File Structure

```
Create:
  deploy/systemd/claude-session@.service.d/limits.conf      (from live host, verbatim)
  deploy/systemd/app-claude-session.slice.d/limits.conf     (from live host; installed to the \x2d-escaped dir)
  deploy/systemd/ccrc-agent.service.d/protect.conf          (from live host, verbatim)
  deploy/systemd/ccd-cap-scopes.service                     (from live host, verbatim)
  deploy/systemd/ccd-cap-scopes.timer                       (from live host, verbatim)
  ccd/ccd-cap-scopes                                        (from live ~/.local/bin, verbatim incl. postmortem header)
  server/src/buildinfo.ts                                   (stamp reader: file -> BuildInfo | null)
  server/test/buildinfo.test.ts
  server/test/ccd-version.test.ts
Modify:
  ccd/statusline-command.sh          (repatriate 2 live-ahead claude-dev0 case lines)
  ccd/install-session-hooks.sh       (homes list gains $HOME/.claude-dev0)
  ccd/ccd                            (new `version` verb: cmd_version + dispatch + usage + caps list)
  deploy/ccrc.service                (EnvironmentFile cutover)
  deploy/ccrc.env.example            (document ALL real vars: HOST/PORT, VAPID trio, PROJECTS_ROOT)
  deploy/ccrc-agent.env.example      (document CCRC_PROJECTS_ROOT)
  deploy/deploy.sh                   (install new artifacts; generate+ship build stamp; assert identity)
  agent/src/server.ts                (resolveProjectsRoot seam; default flips to $HOME/projects)
  agent/src/index.ts                 (pass CCRC_PROJECTS_ROOT through)
  server/src/config.ts               (buildInfoPath)
  server/src/index.ts                (load stamp, hand to buildServer deps)
  server/src/server.ts               (/health returns build)
  server/test/health.test.ts         (expect the new body)
  agent/test/deploy-verify.test.ts   (new stage-1 pins)
  agent/test/whitelist.test.ts       (only if the example-path literals collide — see Task 4)
```

---

### Task 1: Repatriate the live-ahead script edits

The live `~/.claude/statusline-command.sh` on openclaw is 2 lines AHEAD of `ccd/statusline-command.sh` (claude-dev0 support added by hand), and `ccd/install-session-hooks.sh`'s homes list is missing `.claude-dev0` for the same reason. The repo must match live reality before anything ships these files.

**Files:**
- Modify: `ccd/statusline-command.sh` (two case tables, ~lines 51 and 156)
- Modify: `ccd/install-session-hooks.sh` (homes list, ~line 26)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: repo copies byte-identical in intent to live; Task 2 ships `statusline-command.sh`.

- [ ] **Step 1: Verify the live diff is still exactly two case lines**

Run:
```bash
diff -u ccd/statusline-command.sh ~/.claude/statusline-command.sh
```
Expected: exactly two `+` lines (no other drift since the investigation):
```
+  "$HOME/.claude-dev0")     acct="${GREEN}lab·dev0${RESET}" ;;
+  "$HOME/.claude-dev0")     lbl="claude-dev0" ;;
```
If ANY other lines differ, STOP and re-read the live file — repatriate whatever is actually there, not this plan's snapshot.

- [ ] **Step 2: Apply both lines to the repo copy**

In `ccd/statusline-command.sh`, first case table (account label, after the `.claude-corp` line):
```bash
  "$HOME/.claude-corp")     acct="${BLUE}team·shared${RESET}" ;;
  "$HOME/.claude-dev0")     acct="${GREEN}lab·dev0${RESET}" ;;
```
Second case table (wrapper label, after the `.claude-corp` line):
```bash
  "$HOME/.claude-corp")     lbl="claude-corp" ;;
  "$HOME/.claude-dev0")     lbl="claude-dev0" ;;
```

- [ ] **Step 3: Confirm the diff is now empty**

Run: `diff -u ccd/statusline-command.sh ~/.claude/statusline-command.sh && echo IDENTICAL`
Expected: `IDENTICAL`

- [ ] **Step 4: Add `.claude-dev0` to install-session-hooks.sh homes**

In `ccd/install-session-hooks.sh`, the default homes list currently reads:
```bash
homes=("$HOME/.claude" "$HOME/.claude-personal" "$HOME/.claude-corp" "$HOME/.claude-gpt")
```
Change to:
```bash
homes=("$HOME/.claude" "$HOME/.claude-personal" "$HOME/.claude-corp" "$HOME/.claude-gpt" "$HOME/.claude-dev0")
```
(Quote the ACTUAL current line from the file — if it differs from the above, keep its shape and append the dev0 entry. The loop body already skips non-existent dirs: `[[ -d "$dir" ]] || continue`, so machines without dev0 are unaffected.)

- [ ] **Step 5: Syntax-check both scripts**

Run: `bash -n ccd/statusline-command.sh && bash -n ccd/install-session-hooks.sh && echo OK`
Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add ccd/statusline-command.sh ccd/install-session-hooks.sh
git commit -m "fix(ccd): the repo's statusline and hook installer catch up with the live host's claude-dev0 support"
```

---

### Task 2: Commit the host-only systemd artifacts and make the deploy install them

Five artifacts exist only on the running fleet host: three drop-ins (`claude-session@.service.d/limits.conf`, `app-claude\x2dsession.slice.d/limits.conf`, `ccrc-agent.service.d/protect.conf`), the `ccd-cap-scopes` service+timer pair, and the `~/.local/bin/ccd-cap-scopes` enforcer script. Plus two repo files nothing installs: `ccd/claude-session@.service` and `ccd/tmux.conf`. After this task, `deploy.sh agent` installs all of them.

**Files:**
- Create: `deploy/systemd/claude-session@.service.d/limits.conf`
- Create: `deploy/systemd/app-claude-session.slice.d/limits.conf`
- Create: `deploy/systemd/ccrc-agent.service.d/protect.conf`
- Create: `deploy/systemd/ccd-cap-scopes.service`
- Create: `deploy/systemd/ccd-cap-scopes.timer`
- Create: `ccd/ccd-cap-scopes`
- Modify: `deploy/deploy.sh` (agent branch)
- Test: `agent/test/deploy-verify.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `deploy/systemd/**` tree rsync-shipped (it lives under `deploy/`, already in both rsync source lists); install lines inside `AGENT_CMD` that Task 8's identity assertions must not displace from their pinned order.

- [ ] **Step 1: Write the failing test**

Append to the `describe('the verification is actually wired into the deploy, and can observe a restart', …)` block in `agent/test/deploy-verify.test.ts`:

```ts
  it('the agent deploy installs every systemd artifact the fleet host actually runs', () => {
    // Stage 1 (OSS infra spec §"repo can rebuild a box"). These five artifacts
    // existed ONLY on the live host — the guardrail drop-ins whose own comments
    // call them "the guardrail that actually contains a runaway", the
    // cap-scopes enforcer pair, and two repo files nothing installed
    // (claude-session@.service, tmux.conf). A repo that cannot reproduce its
    // own box is the root defect the whole stage exists to close.
    for (const f of [
      'systemd/claude-session@.service.d/limits.conf',
      'systemd/app-claude-session.slice.d/limits.conf',
      'systemd/ccrc-agent.service.d/protect.conf',
      'systemd/ccd-cap-scopes.service',
      'systemd/ccd-cap-scopes.timer',
    ]) {
      expect(existsSync(path.join(deployDir, f)), `${f} is not in the repo`).toBe(true);
    }
    expect(existsSync(path.join(deployDir, '..', 'ccd', 'ccd-cap-scopes')),
      'the cap-scopes enforcer script is not in the repo').toBe(true);

    const agentCmd = /AGENT_CMD='([\s\S]*?)'/.exec(deploySh)![1]!;
    const links = agentCmd.split('&&').map((s) => s.replace(/\\\s*$/, '').trim());
    // The supervisor unit and every drop-in land BEFORE daemon-reload, so the
    // sweep later in the branch restarts supervisors under the NEW unit set.
    const reloadAt = links.findIndex((l) => l.includes('daemon-reload'));
    expect(reloadAt).toBeGreaterThan(-1);
    for (const needle of [
      'cp ~/ccrc/ccd/claude-session@.service ~/.config/systemd/user/',
      'claude-session@.service.d',
      'app-claude\\x2dsession.slice.d',
      'ccrc-agent.service.d',
      'cp ~/ccrc/deploy/systemd/ccd-cap-scopes.service ~/ccrc/deploy/systemd/ccd-cap-scopes.timer ~/.config/systemd/user/',
    ]) {
      const at = links.findIndex((l) => l.includes(needle));
      expect(at, `AGENT_CMD does not install: ${needle}`).toBeGreaterThan(-1);
      expect(at, `${needle} must land before daemon-reload`).toBeLessThan(reloadAt);
    }
    // The timer is enabled after daemon-reload; the enforcer script goes
    // through install_atomic like every other executable.
    const timerAt = links.findIndex((l) => l.includes('enable --now ccd-cap-scopes.timer'));
    expect(timerAt, 'the cap-scopes timer is never enabled').toBeGreaterThan(reloadAt);
    expect(deploySh).toContain('install_atomic ccd/ccd-cap-scopes .local/bin/ccd-cap-scopes 755');
    expect(deploySh).toContain('install_atomic ccd/tmux.conf .tmux.conf 644');
    expect(deploySh).toContain('install_atomic ccd/statusline-command.sh .claude/statusline-command.sh 755');
  });
```

Also add `existsSync` to the `node:fs` import at the top of the file:
```ts
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd agent && ./node_modules/.bin/vitest run test/deploy-verify.test.ts`
Expected: FAIL — `systemd/claude-session@.service.d/limits.conf is not in the repo`

- [ ] **Step 3: Copy the live artifacts into the repo, verbatim**

```bash
mkdir -p deploy/systemd/claude-session@.service.d \
         deploy/systemd/app-claude-session.slice.d \
         deploy/systemd/ccrc-agent.service.d
cp ~/.config/systemd/user/claude-session@.service.d/limits.conf deploy/systemd/claude-session@.service.d/limits.conf
cp ~/.config/systemd/user/'app-claude\x2dsession.slice.d'/limits.conf deploy/systemd/app-claude-session.slice.d/limits.conf
cp ~/.config/systemd/user/ccrc-agent.service.d/protect.conf deploy/systemd/ccrc-agent.service.d/protect.conf
cp ~/.config/systemd/user/ccd-cap-scopes.service deploy/systemd/ccd-cap-scopes.service
cp ~/.config/systemd/user/ccd-cap-scopes.timer deploy/systemd/ccd-cap-scopes.timer
cp ~/.local/bin/ccd-cap-scopes ccd/ccd-cap-scopes
chmod 755 ccd/ccd-cap-scopes
```
Then verify each against the investigation's verbatim quotes (they are in
`/tmp/claude-1000/stage1-liveArtifacts.md` during this session; afterwards the
live host is the source of truth): limits.conf sets MemoryHigh=6G/MemoryMax=10G,
the slice limits 20G/24G, protect.conf MemoryMin=192M/CPUWeight=5000, the
enforcer is 55 lines whose header carries the 2026-08-10 postmortem. The
`ccgpt-usage.service.d/path.conf` drop-in is deliberately NOT repatriated — it
belongs to a non-ccrc poller.

- [ ] **Step 4: Wire the installs into deploy.sh's agent branch**

In `deploy/deploy.sh`, replace the current install block (the four `install_atomic` calls and the hooks runner) with:

```bash
  # ccd installs BEFORE the agent restart, never after: the agent caches
  # `ccd caps` at boot (the 113-second lesson), so an agent restarted against
  # yesterday's ccd pins yesterday's verb set until someone restarts it again.
  # notify.sh is the ccd swap hook and lives outside the rsync tree.
  # All executables go through install_atomic — see its comment for why a
  # plain scp over these exact files is a live correctness bug.
  install_atomic ccd/ccd .local/bin/ccd 755
  install_atomic deploy/notify.sh .cc-sessions/notify.sh 755
  # session-hook.sh + its installer ship every deploy too — the installer is
  # idempotent (it backs up settings.json itself before touching it) and
  # safe to re-run against homes it already converged.
  install_atomic ccd/session-hook.sh .cc-sessions/session-hook.sh 755
  install_atomic ccd/install-session-hooks.sh .cc-sessions/install-session-hooks.sh 755
  # Stage 1: the artifacts the fleet host runs but no deploy ever shipped.
  # The cap-scopes enforcer is the OOM guardrail (see its own header for the
  # 13-days-silently-broken postmortem); tmux.conf is how truecolor survives
  # to the attaching client; statusline is what writes ~/.cc-limits telemetry.
  install_atomic ccd/ccd-cap-scopes .local/bin/ccd-cap-scopes 755
  install_atomic ccd/tmux.conf .tmux.conf 644
  install_atomic ccd/statusline-command.sh .claude/statusline-command.sh 755
  "${SSH[@]}" "$BOX" 'bash ~/.cc-sessions/install-session-hooks.sh'
```

Then extend `AGENT_CMD` — current block:
```bash
  AGENT_CMD='cd ~/ccrc/agent && npm ci && npm run build \
    && mkdir -p ~/.config/systemd/user && cp ~/ccrc/deploy/ccrc-agent.service ~/.config/systemd/user/ \
    && export XDG_RUNTIME_DIR=/run/user/$(id -u) \
    && systemctl --user daemon-reload && systemctl --user enable --now ccrc-agent.service \
    && systemctl --user restart ccrc-agent.service \
    && bash ~/ccrc/deploy/verify-service.sh ccrc-agent.service'
```
becomes:
```bash
  # The supervisor unit and every drop-in land BEFORE daemon-reload so the
  # sweep below restarts supervisors under the new unit set. The slice
  # drop-in's target dir carries systemd's \x2d escape — the repo source dir
  # is plainly named, the DESTINATION must be the escaped name or systemd
  # never reads it. Inside this single-quoted block, "\x2d" sits in remote
  # double quotes, where bash preserves the backslash.
  AGENT_CMD='cd ~/ccrc/agent && npm ci && npm run build \
    && mkdir -p ~/.config/systemd/user \
    && cp ~/ccrc/deploy/ccrc-agent.service ~/.config/systemd/user/ \
    && cp ~/ccrc/ccd/claude-session@.service ~/.config/systemd/user/ \
    && mkdir -p ~/.config/systemd/user/claude-session@.service.d "$HOME/.config/systemd/user/app-claude\x2dsession.slice.d" ~/.config/systemd/user/ccrc-agent.service.d \
    && cp ~/ccrc/deploy/systemd/claude-session@.service.d/limits.conf ~/.config/systemd/user/claude-session@.service.d/ \
    && cp ~/ccrc/deploy/systemd/app-claude-session.slice.d/limits.conf "$HOME/.config/systemd/user/app-claude\x2dsession.slice.d/" \
    && cp ~/ccrc/deploy/systemd/ccrc-agent.service.d/protect.conf ~/.config/systemd/user/ccrc-agent.service.d/ \
    && cp ~/ccrc/deploy/systemd/ccd-cap-scopes.service ~/ccrc/deploy/systemd/ccd-cap-scopes.timer ~/.config/systemd/user/ \
    && export XDG_RUNTIME_DIR=/run/user/$(id -u) \
    && systemctl --user daemon-reload && systemctl --user enable --now ccrc-agent.service \
    && systemctl --user enable --now ccd-cap-scopes.timer \
    && systemctl --user restart ccrc-agent.service \
    && bash ~/ccrc/deploy/verify-service.sh ccrc-agent.service'
```
Note `verify-service.sh ccrc-agent.service` stays the LAST link — the existing
test pins that.

- [ ] **Step 5: Run the tests and syntax check**

Run: `bash -n deploy/deploy.sh && cd agent && ./node_modules/.bin/vitest run test/deploy-verify.test.ts`
Expected: PASS (all, including the pre-existing last-link and rsync-exclude pins)

- [ ] **Step 6: Commit**

```bash
git add deploy/systemd ccd/ccd-cap-scopes deploy/deploy.sh agent/test/deploy-verify.test.ts
git commit -m "feat(deploy): the fleet host's guardrails live in the repo and every deploy installs them"
```

---

### Task 3: EnvironmentFile cutover for ccrc.service

Today `deploy/ccrc.service` bakes `Environment=CCRC_HOST=203.0.113.7` and `Environment=CCRC_PORT=7788`, has no `EnvironmentFile=`, and the box's REAL config rides an unmanaged drop-in (`ccrc.service.d/remote.conf` → `~/.ccrc/remote.env`, which also carries three VAPID vars the example never mentions). The unit gains `EnvironmentFile=-%h/.ccrc/ccrc.env`; the example documents every real variable; the live migration happens in Task 9.

**Files:**
- Modify: `deploy/ccrc.service`
- Modify: `deploy/ccrc.env.example`
- Test: `agent/test/deploy-verify.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the unit shape Task 9's migration relies on; `-`-prefixed (optional) EnvironmentFile so a fresh box with no env file still boots in local mode on loopback defaults.

- [ ] **Step 1: Write the failing test**

Append to the same describe block in `agent/test/deploy-verify.test.ts`:

```ts
  it("ccrc.service reads ~/.ccrc/ccrc.env and bakes NOTHING — the env file deploy.sh ships is finally read", () => {
    // Survey blocker #1 by depth: deploy.sh faithfully shipped ccrc.env to
    // ~/.ccrc/ for weeks while the unit read nothing, and the live box's real
    // config accreted in a hand-made drop-in the repo cannot see. The `-`
    // prefix keeps a fresh box bootable with no env file at all (local mode,
    // loopback defaults from config.ts).
    const unit = readFileSync(path.join(deployDir, 'ccrc.service'), 'utf8');
    expect(unit).toContain('EnvironmentFile=-%h/.ccrc/ccrc.env');
    expect(/^Environment=/m.test(unit),
      'baked Environment= literals are back in ccrc.service').toBe(false);

    // And the example documents every variable the LIVE box actually needs —
    // the three VAPID vars were real config with no documentation anywhere.
    const example = readFileSync(path.join(deployDir, 'ccrc.env.example'), 'utf8');
    for (const v of ['CCRC_HOST', 'CCRC_PORT', 'CCRC_VAPID_PUBLIC',
      'CCRC_VAPID_PRIVATE', 'CCRC_VAPID_SUBJECT', 'CCRC_PROJECTS_ROOT']) {
      expect(example, `ccrc.env.example does not document ${v}`).toContain(v);
    }
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd agent && ./node_modules/.bin/vitest run test/deploy-verify.test.ts -t 'reads ~/.ccrc/ccrc.env'`
Expected: FAIL — `EnvironmentFile=-%h/.ccrc/ccrc.env` not found

- [ ] **Step 3: Rewrite deploy/ccrc.service**

```ini
[Unit]
Description=ccrc — self-hosted remote control for Claude Code sessions
After=network-online.target

[Service]
# ALL machine configuration lives in ~/.ccrc/ccrc.env (spec §2: one env file
# per box, read by everything). The `-` makes it optional: a fresh box with no
# env file boots in local mode on config.ts defaults (127.0.0.1:7788). The
# baked Environment= literals this replaces were one operator's tailnet IP —
# and the live box's real config rode an unmanaged drop-in this line retires
# (see the 2026-08-11 stage-1 plan, Task 9, for the migration).
EnvironmentFile=-%h/.ccrc/ccrc.env
ExecStart=/usr/bin/env node %h/ccrc/server/dist/server/src/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
```

- [ ] **Step 4: Rewrite deploy/ccrc.env.example**

```bash
# ccrc server env — the ONE machine-config file for the server box, installed
# at ~/.ccrc/ccrc.env and read by ccrc.service (EnvironmentFile). Absent file
# = local mode on loopback defaults; every value here overrides a default in
# server/src/config.ts.
#
# Copy to `deploy/ccrc.env` locally (gitignored — never commit the real file)
# and `bash deploy/deploy.sh` ships it.

# Bind address + port. The default (127.0.0.1:7788) is loopback-only — set
# CCRC_HOST only when something in front (tailscale serve, a reverse proxy)
# targets a specific interface. NOTE: tailscale serve on the current box
# proxies to 203.0.113.7:7788 LITERALLY, so that box must keep CCRC_HOST in
# sync with the serve config.
CCRC_HOST=127.0.0.1
CCRC_PORT=7788

# 'local' (default) drives the fleet on this box directly via node:fs/exec.
# 'remote' drives it through ccrc-agent over CCRC_AGENT_URL instead.
CCRC_FLEET=local

# ws:// or wss:// URL of the ccrc-agent WS endpoint on the fleet host,
# INCLUDING the /agent path, e.g. ws://100.x.x.x:7789/agent
CCRC_AGENT_URL=

# Must match the fleet host's CCRC_AGENT_TOKEN (see ccrc-agent.env.example).
CCRC_AGENT_TOKEN=

# Where project checkouts live on THIS box (local mode reads them directly).
# Default if unset: /data/projects (server/src/config.ts).
CCRC_PROJECTS_ROOT=

# Web-push (VAPID) keys — REQUIRED for push notifications; without them the
# push service is disabled. Generate a pair with:
#   npx web-push generate-vapid-keys
# These were live, undocumented config until the 2026-08-11 stage-1 cutover.
CCRC_VAPID_PUBLIC=
CCRC_VAPID_PRIVATE=
CCRC_VAPID_SUBJECT=

# Hetzner Cloud API token — used only for the degraded-mode fleet-host reboot
# action (POST /api/fleet/reboot). Omit to leave that route disabled (501).
CCRC_HETZNER_TOKEN=

# Hetzner Cloud server ID of the fleet host — used only for the reboot action.
CCRC_FLEET_SERVER_ID=
```

- [ ] **Step 5: Run the test to verify it passes, and the config suite still holds**

Run: `cd agent && ./node_modules/.bin/vitest run test/deploy-verify.test.ts && cd ../server && ./node_modules/.bin/vitest run test/config.test.ts`
Expected: PASS both (config.test.ts exercises `loadConfig` defaults, which this task does not touch).

- [ ] **Step 6: Commit**

```bash
git add deploy/ccrc.service deploy/ccrc.env.example agent/test/deploy-verify.test.ts
git commit -m "feat(deploy): ccrc.service finally reads the env file the deploy has always shipped"
```

---

### Task 4: The agent's projects root gets its env seam

`agent/src/server.ts:59` exports `DEFAULT_PROJECTS_ROOT = '/srv/projects'` — one operator's Hetzner volume id, no env override, always taken in production (`agent/src/index.ts` passes no projectsRoot). It becomes `CCRC_PROJECTS_ROOT` with a `$HOME/projects` fallback (spec §2). No existing agent test depends on the literal default (verified: every booted test injects a tmp root; the two `HC_Volume` mentions in tests are example-path strings, not the default).

**Files:**
- Modify: `agent/src/server.ts` (~line 59 and the `startAgent` defaulting, ~line 460)
- Modify: `agent/src/index.ts` (~line 18)
- Modify: `deploy/ccrc-agent.env.example`
- Test: `agent/test/projects-root.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `resolveProjectsRoot(rawRoot: string | undefined, env: NodeJS.ProcessEnv): string` exported from `agent/src/server.ts`; `agent/src/index.ts` passes `projectsRoot: process.env.CCRC_PROJECTS_ROOT` into `startAgent`. Task 9 ships the real value in the box's `agent.env`.

- [ ] **Step 1: Write the failing test**

Create `agent/test/projects-root.test.ts`:

```ts
// Stage 1 (OSS infra spec §2): the agent's whitelist root was one operator's
// Hetzner volume id, compiled in, no override — the literal that made every
// other install's file reads fail silently. The resolution order is: explicit
// opt (tests, embedders) > CCRC_PROJECTS_ROOT (production, via agent.env) >
// $HOME/projects (the spec's cross-component default).
import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { resolveProjectsRoot } from '../src/server.js';

describe('resolveProjectsRoot', () => {
  it('prefers an explicit option over everything', () => {
    expect(resolveProjectsRoot('/opt/repos', { CCRC_PROJECTS_ROOT: '/env/root' }))
      .toBe('/opt/repos');
  });

  it('falls back to CCRC_PROJECTS_ROOT from the environment', () => {
    expect(resolveProjectsRoot(undefined, { CCRC_PROJECTS_ROOT: '/env/root' }))
      .toBe('/env/root');
  });

  it('defaults to $HOME/projects — never a hardcoded volume path', () => {
    expect(resolveProjectsRoot(undefined, {}))
      .toBe(path.join(os.homedir(), 'projects'));
  });

  it('an empty env var is absent, not a root of ""', () => {
    expect(resolveProjectsRoot(undefined, { CCRC_PROJECTS_ROOT: '' }))
      .toBe(path.join(os.homedir(), 'projects'));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd agent && ./node_modules/.bin/vitest run test/projects-root.test.ts`
Expected: FAIL — `resolveProjectsRoot` is not exported

- [ ] **Step 3: Implement the seam**

In `agent/src/server.ts`, replace the constant (keep its line position/comment style):

```ts
/** Resolution order for the whitelist's projects root: explicit option
 *  (tests, embedders) > CCRC_PROJECTS_ROOT (production — set in
 *  ~/.ccrc/agent.env) > $HOME/projects (spec §2's cross-component default).
 *  The old export was one operator's literal Hetzner volume id
 *  ('/srv/projects'), compiled in with no override —
 *  every OTHER machine's agent silently whitelisted a directory that does
 *  not exist. An empty env var counts as absent, never as a root of "". */
export function resolveProjectsRoot(
  rawRoot: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (rawRoot !== undefined && rawRoot !== '') return rawRoot;
  const fromEnv = env.CCRC_PROJECTS_ROOT;
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  return path.join(os.homedir(), 'projects');
}
```

In `startAgent`'s opts defaulting (~line 460), change:
```ts
  projectsRoot: rawOpts.projectsRoot ?? DEFAULT_PROJECTS_ROOT,
```
to:
```ts
  projectsRoot: resolveProjectsRoot(rawOpts.projectsRoot),
```
Delete the old `DEFAULT_PROJECTS_ROOT` export. If `os`/`path` are not already
imported in `agent/src/server.ts`, add the node: imports.

In `agent/src/index.ts`, extend the startAgent call:
```ts
const agent = await startAgent({
  host: process.env.CCRC_AGENT_HOST,
  port: process.env.CCRC_AGENT_PORT ? Number(process.env.CCRC_AGENT_PORT) : undefined,
  token,
  projectsRoot: process.env.CCRC_PROJECTS_ROOT,
});
```
(`resolveProjectsRoot` treats the explicit-undefined and empty-string cases
identically, so passing the raw env value through is safe.)

- [ ] **Step 4: Run the agent suite to verify everything passes**

Run: `cd agent && ./node_modules/.bin/vitest run && ./node_modules/.bin/tsc --noEmit`
Expected: PASS all (if any test imported `DEFAULT_PROJECTS_ROOT`, update it to call `resolveProjectsRoot(undefined, {})` — the investigation found none, but verify with `grep -rn DEFAULT_PROJECTS_ROOT agent/`).

- [ ] **Step 5: Document the variable**

Append to `deploy/ccrc-agent.env.example`:

```bash
# Where project checkouts live on THIS fleet host — the root the agent's
# file/exec whitelist allows. Default if unset: $HOME/projects.
# (The current fleet host uses /srv/projects.)
CCRC_PROJECTS_ROOT=
```

- [ ] **Step 6: Commit**

```bash
git add agent/src/server.ts agent/src/index.ts agent/test/projects-root.test.ts deploy/ccrc-agent.env.example
git commit -m "feat(agent): the whitelist root stops being one operator's volume id and becomes CCRC_PROJECTS_ROOT"
```

---

### Task 5: deploy.sh generates and ships the build stamp

Every deploy computes `{sha, ref, builtAt, dirty}` from the LOCAL checkout (the `~/ccrc` tree on the boxes is not a git repo — rsync output) and lands it at `~/.ccrc/build.json` on the target, both branches, before services restart.

**Files:**
- Modify: `deploy/deploy.sh`
- Test: `agent/test/deploy-verify.test.ts`

**Interfaces:**
- Consumes: `install_atomic` (exists).
- Produces: `~/.ccrc/build.json` on every deployed box with shape `{"sha": string(40 hex), "ref": string, "builtAt": ISO-8601 UTC, "dirty": boolean}`; a `stamp_build` helper + `$BUILD_SHA` var that Task 8's assertions reuse.

- [ ] **Step 1: Write the failing test**

Append to the same describe block in `agent/test/deploy-verify.test.ts`:

```ts
  it('every deploy stamps ~/.ccrc/build.json on the target — from the LOCAL git tree, before services restart', () => {
    // Stage 1's central artifact: the "from" and "to" that update/skew
    // detection needs. Computed locally (the rsynced ~/ccrc tree on the box
    // is NOT a git repo), shipped like every other file (install_atomic:
    // temp + rename, so a reader never sees a torn stamp).
    const fn = /stamp_build\(\) \{([\s\S]*?)\n\}/.exec(deploySh);
    expect(fn, 'deploy.sh has no stamp_build() helper').toBeTruthy();
    const body = fn![1]!;
    // The sha/ref/dirty facts are computed at top level (they serve BOTH
    // branches and Task 8's assertions); the helper's job is the shipping.
    expect(deploySh).toContain('BUILD_SHA="$(git rev-parse HEAD)"');
    expect(deploySh, 'the stamp must state dirtiness, not hide it').toContain('git diff --quiet');
    expect(body).toContain('"$BUILD_SHA"');
    expect(body).toContain('install_atomic');
    expect(body).toContain('.ccrc/build.json');

    // Called on BOTH branches, before each branch's remote build+restart
    // chain executes.
    const agentBranchStart = deploySh.indexOf('if [ "$TARGET" = "agent" ]');
    const elseAt = deploySh.indexOf('\nelse');
    const agentStamp = deploySh.indexOf('stamp_build', agentBranchStart);
    expect(agentStamp, 'agent branch never stamps').toBeGreaterThan(agentBranchStart);
    expect(agentStamp).toBeLessThan(deploySh.indexOf('"$AGENT_CMD"'));
    expect(agentStamp).toBeLessThan(elseAt);
    const serverStamp = deploySh.indexOf('stamp_build', elseAt);
    expect(serverStamp, 'server branch never stamps').toBeGreaterThan(elseAt);
    expect(serverStamp).toBeLessThan(deploySh.indexOf('"$REMOTE_CMD"'));
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd agent && ./node_modules/.bin/vitest run test/deploy-verify.test.ts -t 'stamps ~/.ccrc/build.json'`
Expected: FAIL — no stamp_build helper

- [ ] **Step 3: Implement stamp_build**

In `deploy/deploy.sh`, after the `prune_backups` helper, add:

```bash
# The build stamp: what a box is RUNNING, stated by the box itself. Computed
# from the LOCAL checkout — the rsynced ~/ccrc tree on the target is not a git
# repository, so `git rev-parse` must run here, before anything ships. A dirty
# tree deploys (stage 1 does not forbid it; stage 4's release pipeline will)
# but the stamp SAYS so: sha + "-dirty" is a fact, a clean sha nobody measured
# is the forgery class this repo bans by name. Shipped via install_atomic so
# no reader ever sees a torn stamp.
BUILD_SHA="$(git rev-parse HEAD)"
git diff --quiet && git diff --cached --quiet && BUILD_DIRTY=false || BUILD_DIRTY=true
BUILD_REF="$(git rev-parse --abbrev-ref HEAD)"
stamp_build() {
  local stamp
  stamp="$(mktemp)"
  printf '{"sha":"%s","ref":"%s","builtAt":"%s","dirty":%s}\n' \
    "$BUILD_SHA" "$BUILD_REF" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$BUILD_DIRTY" > "$stamp"
  "${SSH[@]}" "$BOX" 'mkdir -p ~/.ccrc'
  install_atomic "$stamp" .ccrc/build.json 644
  rm -f "$stamp"
}
```

Call it on both branches:
- Agent branch: insert `stamp_build` on its own line immediately after the
  `install_atomic ccd/statusline-command.sh …` line (before the hooks runner).
- Server branch: insert `stamp_build` immediately after the
  `ship_env ccrc.env .ccrc/ccrc.env` line.

Note: `install_atomic` scps `"$stamp"` (an absolute mktemp path) — its `src`
parameter is any local path, so this composes without change.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash -n deploy/deploy.sh && cd agent && ./node_modules/.bin/vitest run test/deploy-verify.test.ts`
Expected: PASS all

- [ ] **Step 5: Commit**

```bash
git add deploy/deploy.sh agent/test/deploy-verify.test.ts
git commit -m "feat(deploy): every deploy stamps the box with what it shipped — sha, ref, time, and honesty about dirt"
```

---

### Task 6: The server reads the stamp and /health reports it

`/health` currently returns a static `{ ok: true }`. It gains `build: BuildInfo | null` — the stamp read once at boot, `null` when absent or unparseable (a dev checkout, or a box never stamped). Missing/invalid degrades to `null`, never a throw: `/health` is the deploy's own gate and must answer even on a half-configured box.

**Files:**
- Create: `server/src/buildinfo.ts`
- Create: `server/test/buildinfo.test.ts`
- Modify: `server/src/config.ts` (add `buildInfoPath`)
- Modify: `server/src/index.ts` (read at boot, pass into deps)
- Modify: `server/src/server.ts` (/health handler + Deps type)
- Modify: `server/test/health.test.ts`

**Interfaces:**
- Consumes: `~/.ccrc/build.json` shape from Task 5.
- Produces: `interface BuildInfo { sha: string; ref: string; builtAt: string; dirty: boolean }` and `readBuildInfo(filePath: string): BuildInfo | null` exported from `server/src/buildinfo.ts`; `Deps.build: BuildInfo | null`; `/health` body `{ ok: true, build: BuildInfo | null }`. Task 7's ccd verb and Task 8's deploy assertion consume the `/health` shape.

- [ ] **Step 1: Write the failing reader test**

Create `server/test/buildinfo.test.ts`:

```ts
// The stamp reader refuses to invent: absent file, unreadable file, invalid
// JSON, wrong shape — all null, never a throw and never a partial object.
// /health is the deploy's own verification gate; a stamp problem must not
// take the route down with it.
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { readBuildInfo } from '../src/buildinfo.js';
import { mkTmp } from './tmpHelpers.js';

const put = (content: string): string => {
  const dir = mkTmp('ccrc-buildinfo-');
  const f = path.join(dir, 'build.json');
  writeFileSync(f, content);
  return f;
};

describe('readBuildInfo', () => {
  it('reads a complete stamp', () => {
    const stamp = { sha: 'a'.repeat(40), ref: 'main', builtAt: '2026-08-11T11:00:00Z', dirty: false };
    expect(readBuildInfo(put(JSON.stringify(stamp)))).toEqual(stamp);
  });

  it('a missing file is null', () => {
    expect(readBuildInfo(path.join(mkTmp('ccrc-buildinfo-'), 'nope.json'))).toBeNull();
  });

  it('invalid JSON is null, not a throw', () => {
    expect(readBuildInfo(put('{half a stamp'))).toBeNull();
  });

  it('a wrong shape is null — a stamp with no sha is not a stamp', () => {
    expect(readBuildInfo(put('{"ref":"main","builtAt":"2026-08-11T11:00:00Z","dirty":false}'))).toBeNull();
    expect(readBuildInfo(put('{"sha":42,"ref":"main","builtAt":"x","dirty":false}'))).toBeNull();
  });
});
```

(If the literal-template above reads awkwardly, write the first case plainly:
build the JSON with `JSON.stringify({ sha: 'a'.repeat(40), ref: 'main', builtAt: '2026-08-11T11:00:00Z', dirty: false })`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/buildinfo.test.ts`
Expected: FAIL — `../src/buildinfo.js` does not exist

- [ ] **Step 3: Implement the reader**

Create `server/src/buildinfo.ts`:

```ts
/** The deploy's build stamp (~/.ccrc/build.json, written by deploy.sh's
 *  stamp_build): what THIS box is running, stated by the box itself. Read
 *  once at boot. Every failure mode is null — absent (dev checkout, never
 *  stamped), unreadable, unparseable, wrong shape — never a throw and never
 *  a partial: /health is the deploy's own verification gate, and a stamp
 *  problem must not take the route down with it. `dirty` rides along so a
 *  working-tree deploy can never masquerade as the clean sha it claims. */
import { readFileSync } from 'node:fs';

export interface BuildInfo {
  sha: string;
  ref: string;
  builtAt: string;
  dirty: boolean;
}

export function readBuildInfo(filePath: string): BuildInfo | null {
  let raw: string;
  try { raw = readFileSync(filePath, 'utf8'); } catch { return null; }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o.sha !== 'string' || typeof o.ref !== 'string'
    || typeof o.builtAt !== 'string' || typeof o.dirty !== 'boolean') return null;
  return { sha: o.sha, ref: o.ref, builtAt: o.builtAt, dirty: o.dirty };
}
```

- [ ] **Step 4: Run the reader test to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/buildinfo.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing /health test**

In `server/test/health.test.ts`, replace the existing assertion:

```ts
  it('GET /health returns ok and the build stamp (null when unstamped)', async () => {
    const app = await buildServer(testDeps());
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    // testDeps() carries no stamp: null is the honest answer for a dev boot,
    // and the deploy's sha assertion greps for the REAL stamp in production.
    expect(res.json()).toEqual({ ok: true, build: null });
    await app.close();
  });

  it('GET /health carries the stamp when the box was deployed', async () => {
    const app = await buildServer({
      ...testDeps(),
      build: { sha: 'b'.repeat(40), ref: 'main', builtAt: '2026-08-11T11:00:00Z', dirty: false },
    });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.json()).toEqual({
      ok: true,
      build: { sha: 'b'.repeat(40), ref: 'main', builtAt: '2026-08-11T11:00:00Z', dirty: false },
    });
    await app.close();
  });
```

(Check how `testDeps()` is defined in that file's imports — if it builds a
plain object, `build` may be absent; the handler below treats absent as null.)

- [ ] **Step 6: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/health.test.ts`
Expected: FAIL — body is `{ ok: true }`, missing `build`

- [ ] **Step 7: Wire config, boot, deps, and the handler**

`server/src/config.ts` — in the `CcrcConfig` type add:
```ts
  /** The deploy's build stamp (deploy.sh stamp_build). Absent = dev boot. */
  buildInfoPath: string;
```
and in `loadConfig`, next to `mailTokenPath`:
```ts
    buildInfoPath: path.join(home, '.ccrc', 'build.json'),
```

`server/src/server.ts` — add to the `Deps` type (wherever `cfg` and
`fleetState` are declared):
```ts
  build?: BuildInfo | null;
```
with `import type { BuildInfo } from './buildinfo.js';`, and change the
/health handler:
```ts
  app.get('/health', async () => ({ ok: true, build: deps.build ?? null }));
```

`server/src/index.ts` — after `const cfg = loadConfig();`:
```ts
import { readBuildInfo } from './buildinfo.js';
…
const build = readBuildInfo(cfg.buildInfoPath);
```
and include `build` in the deps object passed to `buildServer` (both fleet-mode
branches construct deps — add it to the shared part).

- [ ] **Step 8: Run the server suite and typecheck**

Run: `cd server && ./node_modules/.bin/vitest run && ./node_modules/.bin/tsc --noEmit`
Expected: PASS all. `fleet-health.test.ts`'s three `toEqual` pins are on
`/api/fleet/health`, which this task does not touch — they must stay green.

- [ ] **Step 9: Commit**

```bash
git add server/src/buildinfo.ts server/src/config.ts server/src/index.ts server/src/server.ts server/test/buildinfo.test.ts server/test/health.test.ts
git commit -m "feat(server): /health states what build this box runs — or null, never a guess"
```

---

### Task 7: `ccd version` — the fleet host states what it runs

A new read-only verb printing the stamp from `~/.ccrc/build.json`. On an
unstamped box (dev checkout) it says so and exits 0 — that is an honest
answer, not an error. Registered in the dispatch table, the usage line, and
`cmd_caps` (the test convention: a verb routes AND advertises).

**Files:**
- Modify: `ccd/ccd` (new `cmd_version` near `cmd_caps` ~line 1651; dispatch table ~line 7229; usage line ~line 7230; caps heredoc ~line 1649)
- Test: `server/test/ccd-version.test.ts` (create)

**Interfaces:**
- Consumes: `~/.ccrc/build.json` (Task 5's shape).
- Produces: `ccd version` stdout `ccd <sha> (<ref>, built <builtAt><, dirty?>)` or `ccd unstamped (no ~/.ccrc/build.json — not deployed by deploy.sh)`; Task 8's agent-branch assertion greps this output for the sha.

- [ ] **Step 1: Write the failing test**

Create `server/test/ccd-version.test.ts`:

```ts
// `ccd version` — the fleet host's half of build identity (stage 1). The
// stamp is deploy.sh's ~/.ccrc/build.json; an unstamped HOME (dev checkout)
// gets an honest "unstamped", exit 0 — not an invented version and not an
// error. Harness: the ccd-forget.test.ts dispatcher pattern, verbatim.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, ghContainedEnv, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-version-'); });
afterEach(() => { h.cleanup(); });

const runCcd = (...args: string[]): { code: number; stdout: string; stderr: string } => {
  try {
    return {
      code: 0, stderr: '',
      stdout: execFileSync('bash', [CCD, ...args], {
        encoding: 'utf8', cwd: h.home,
        env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }),
      }),
    };
  } catch (e) {
    const err = e as { status?: number; stdout?: Buffer; stderr?: Buffer };
    return { code: err.status ?? 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
  }
};

describe('ccd version', () => {
  it('routes, takes no argv, and advertises itself in caps', () => {
    const r = runCcd('version', 'extra');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('usage: ccd version');
    expect(runCcd('caps').stdout.split('\n')).toContain('version');
  });

  it('prints the stamp when the box was deployed', () => {
    fs.mkdirSync(path.join(h.home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(h.home, '.ccrc', 'build.json'), JSON.stringify({
      sha: 'c'.repeat(40), ref: 'main', builtAt: '2026-08-11T11:00:00Z', dirty: false,
    }));
    const r = runCcd('version');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('c'.repeat(40));
    expect(r.stdout).toContain('main');
    expect(r.stdout).toContain('2026-08-11T11:00:00Z');
    expect(r.stdout).not.toContain('dirty');
  });

  it('a dirty stamp says dirty — a working-tree deploy cannot masquerade', () => {
    fs.mkdirSync(path.join(h.home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(h.home, '.ccrc', 'build.json'), JSON.stringify({
      sha: 'd'.repeat(40), ref: 'main', builtAt: '2026-08-11T11:00:00Z', dirty: true,
    }));
    expect(runCcd('version').stdout).toContain('dirty');
  });

  it('an unstamped HOME answers honestly, exit 0', () => {
    const r = runCcd('version');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('unstamped');
  });

  it('a corrupt stamp is named, not parsed around', () => {
    fs.mkdirSync(path.join(h.home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(h.home, '.ccrc', 'build.json'), '{torn');
    const r = runCcd('version');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('unreadable');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-version.test.ts`
Expected: FAIL — `usage: ccd {start|…}` (unknown verb), exit 1 on the first case for the wrong reason (no `usage: ccd version` in stderr). Confirm the failure text before proceeding.

- [ ] **Step 3: Implement cmd_version**

In `ccd/ccd`, directly after `cmd_caps` (~line 1651):

```bash
cmd_version() {   # what THIS box runs, per the deploy's own stamp — never a guess.
  # ~/.ccrc/build.json is written by deploy.sh's stamp_build (temp + rename,
  # so no torn reads). No stamp = a dev checkout or a box no deploy touched:
  # "unstamped" at exit 0 is the honest ANSWER there, not an error. A stamp
  # that exists but does not parse is different — something wrote garbage
  # where the deploy writes facts — and that refuses loudly instead of
  # printing a version nobody measured.
  [[ $# -eq 0 ]] || die "usage: ccd version"
  local stamp="$HOME/.ccrc/build.json"
  if [[ ! -f "$stamp" ]]; then
    echo "ccd unstamped (no ~/.ccrc/build.json — not deployed by deploy.sh)"
    return 0
  fi
  python3 - "$stamp" <<'PY' || die "build stamp unreadable: $stamp"
import json, sys
try:
    o = json.load(open(sys.argv[1]))
    sha, ref, built, dirty = o["sha"], o["ref"], o["builtAt"], o["dirty"]
except Exception:
    sys.exit(1)
print(f"ccd {sha} ({ref}, built {built}{', dirty' if dirty else ''})")
PY
}
```

Dispatch table (after the `pr-state)` line):
```bash
  version)   shift; cmd_version "$@" ;;
```
Usage line: append `|version` inside the braces of the `usage: ccd {…}` string.
Caps heredoc in `cmd_caps`: add a line `version` (after `ws-rm`, before `ls`, matching the existing near-sorted order).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bash -n ccd/ccd && cd server && ./node_modules/.bin/vitest run test/ccd-version.test.ts test/ccd-forget.test.ts`
Expected: PASS (ccd-forget included because it asserts caps contents in one case — confirm the new verb breaks nothing there).

- [ ] **Step 5: Commit**

```bash
git add ccd/ccd server/test/ccd-version.test.ts
git commit -m "feat(ccd): ccd version states the deploy stamp, admits unstamped, and refuses to parse garbage"
```

---

### Task 8: The deploy asserts the identity it just shipped

The stage's whole proof, phrased by the deploy itself: after the server chain's
health curl, assert `/health`'s `build.sha` equals `$BUILD_SHA`; after the
agent chain, assert `ccd version` on the box prints `$BUILD_SHA`.

**Files:**
- Modify: `deploy/deploy.sh` (both branches)
- Test: `agent/test/deploy-verify.test.ts`

**Interfaces:**
- Consumes: `$BUILD_SHA` (Task 5), `/health` body (Task 6), `ccd version` output (Task 7).
- Produces: the deploy fails loudly when a box answers with a different build than the one just shipped — the assertion the spec says "today cannot even be phrased".

- [ ] **Step 1: Write the failing test**

Append to the same describe block:

```ts
  it('the deploy proves the box now RUNS what it shipped — sha equality, not just 200 OK', () => {
    // The 2026-08-10 failure class, closed at the mechanism level: a green
    // deploy that proves only "something answers" lets a stale binary hide
    // behind an {ok:true}. The server branch greps /health for the exact sha
    // it stamped; the agent branch asks the box's own ccd. Both AFTER their
    // chains, so they interrogate the restarted services.
    const serverBranch = deploySh.slice(deploySh.indexOf('\nelse'));
    // NB the deploy.sh line escapes its quotes for the shell — \"sha\":\"$BUILD_SHA\" —
    // so the needle here carries the backslashes too.
    const healthAssertAt = serverBranch.indexOf('\\"sha\\":\\"$BUILD_SHA\\"');
    expect(healthAssertAt, 'the server branch never checks /health against the shipped sha')
      .toBeGreaterThan(-1);
    expect(healthAssertAt).toBeGreaterThan(serverBranch.indexOf('"$REMOTE_CMD"'));

    const agentBranch = deploySh.slice(
      deploySh.indexOf('if [ "$TARGET" = "agent" ]'), deploySh.indexOf('\nelse'));
    const ccdAssertAt = agentBranch.indexOf('ccd version');
    expect(ccdAssertAt, 'the agent branch never checks ccd version against the shipped sha')
      .toBeGreaterThan(-1);
    expect(ccdAssertAt).toBeGreaterThan(agentBranch.indexOf('"$AGENT_CMD"'));
    expect(agentBranch.indexOf('grep -qF "$BUILD_SHA"', ccdAssertAt),
      'the ccd version output is not compared to the shipped sha')
      .toBeGreaterThan(-1);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd agent && ./node_modules/.bin/vitest run test/deploy-verify.test.ts -t 'RUNS what it shipped'`
Expected: FAIL — no sha check in either branch

- [ ] **Step 3: Implement both assertions**

Agent branch — after the `"${SSH[@]}" "$BOX" "$SWEEP_CMD"` line, before `prune_backups`:

```bash
  # The box's own statement of what it now runs, compared to what this run
  # shipped. `ccd version` reads ~/.ccrc/build.json (stamp_build, above);
  # a mismatch means the atomic install or the stamp itself went sideways —
  # fail the deploy, loudly, with both values in view.
  "${SSH[@]}" "$BOX" '~/.local/bin/ccd version' | tee /dev/stderr | grep -qF "$BUILD_SHA" \
    || { echo "deploy: FAILED — the box's ccd version does not carry the shipped sha $BUILD_SHA" >&2; exit 1; }
```

Server branch — after the `"${SSH[@]}" "$BOX" "$REMOTE_CMD"` line, before `prune_backups`:

```bash
  # /health's build stamp must equal what this run shipped. The curl inside
  # REMOTE_CMD proved "something answers"; this proves it answers AS the
  # build we deployed — the assertion the 2026-08-10 stale-binary afternoon
  # was missing. -f on a fresh curl: a dead server here is also a failure.
  curl -fsS "$HEALTH_URL" | grep -qF "\"sha\":\"$BUILD_SHA\"" \
    || { echo "deploy: FAILED — /health does not report the shipped sha $BUILD_SHA" >&2; exit 1; }
```

- [ ] **Step 4: Run the full deploy-verify suite**

Run: `bash -n deploy/deploy.sh && cd agent && ./node_modules/.bin/vitest run test/deploy-verify.test.ts`
Expected: PASS all — including the pre-existing pins (verify-last-link, prune ordering, rsync excludes), which the insertions must not have displaced.

- [ ] **Step 5: Run every suite the stage touched**

Run:
```bash
cd agent  && ./node_modules/.bin/vitest run && ./node_modules/.bin/tsc --noEmit && cd ..
cd server && ./node_modules/.bin/vitest run && ./node_modules/.bin/tsc --noEmit && cd ..
cd pwa    && ./node_modules/.bin/vitest run && ./node_modules/.bin/tsc --noEmit && cd ..
```
Expected: PASS everywhere (pwa untouched — it must stay green as the no-regression control).

- [ ] **Step 6: Commit**

```bash
git add deploy/deploy.sh agent/test/deploy-verify.test.ts
git commit -m "feat(deploy): a deploy now proves the box runs the sha it shipped — on both branches, from the box's own mouth"
```

---

### Task 9: Ship it — PR, merge, migrate the live box, deploy, verify

The operator-facing cutover. Order matters: the PR merges first (CI is the
gate), the local gitignored env files are prepared BEFORE the server deploy
(ship_env lands them in the same run), and the hand-made drop-in is retired
only AFTER `/health` proves the cutover unit reads the new file.

**Files:** none (operations).

**Interfaces:**
- Consumes: everything above, merged to main.
- Produces: both boxes stamped, `/health` and `ccd version` reporting the merged sha, the `remote.env` drop-in retired, `ccrc.env.example`'s claim ("read by the unit") finally true.

- [ ] **Step 1: Open the PR and merge on green**

```bash
git push -u origin HEAD
gh pr create --title "feat(infra): stage 1 — the repo can rebuild a box" --body "Stage 1 of the OSS single-dev infrastructure design (docs/superpowers/specs/2026-08-11-ccrc-oss-single-dev-infra-design.md): the fleet host's guardrail drop-ins, cap-scopes enforcer, supervisor unit, tmux.conf and statusline are repatriated into the repo and installed by every agent deploy; ccrc.service reads ~/.ccrc/ccrc.env instead of baking one operator's IP; the agent's whitelist root becomes CCRC_PROJECTS_ROOT (default \$HOME/projects); and every deploy stamps ~/.ccrc/build.json, surfaced by /health and the new 'ccd version', with the deploy itself asserting sha equality on both branches."
gh pr checks --watch   # takes the current branch's PR
gh pr merge --merge    # ditto — or pass the number gh pr create printed
git fetch origin && git merge --ff-only origin/main
```

- [ ] **Step 2: Prepare the gitignored real env files from the live boxes**

```bash
# Server env: today's real values live in ~/.ccrc/remote.env ON server-box.
ssh -p 2222 -i ~/.ssh/your-key-b you@203.0.113.7 'cat ~/.ccrc/remote.env' > deploy/ccrc.env
# Add what the baked unit used to provide and the new unit no longer does:
printf 'CCRC_HOST=203.0.113.7\nCCRC_PORT=7788\nCCRC_PROJECTS_ROOT=/data/projects\n' >> deploy/ccrc.env
# Agent env: append the projects root to the existing real agent.env.
ssh -p 2222 -i ~/.ssh/your-key-b you@198.51.100.7 'cat ~/.ccrc/agent.env' > deploy/ccrc-agent.env
printf 'CCRC_PROJECTS_ROOT=/srv/projects\n' >> deploy/ccrc-agent.env
# Both are gitignored — verify before proceeding:
git check-ignore deploy/ccrc.env deploy/ccrc-agent.env && echo "gitignored, safe"
```
STOP if `check-ignore` fails — do not continue with secret-bearing files
unignored.

- [ ] **Step 3: Deploy the agent (fleet host first — verb-set rule), then the server**

```bash
CCRC_SSH_KEY=~/.ssh/your-key-b bash deploy/deploy.sh agent you@198.51.100.7
CCRC_SSH_KEY=~/.ssh/your-key-b bash deploy/deploy.sh
```
Expected: both end green, and each now ALSO prints/passes its identity
assertion. The server deploy works while the old drop-in still exists: the
drop-in's `EnvironmentFile=%h/.ccrc/remote.env` and the unit's new
`ccrc.env` line both load, and the files carry equal values by construction
(Step 2 built ccrc.env FROM remote.env).

- [ ] **Step 4: Retire the drop-in, restart, verify again**

```bash
ssh -p 2222 -i ~/.ssh/your-key-b you@203.0.113.7 '
  export XDG_RUNTIME_DIR=/run/user/$(id -u) \
  && rm ~/.config/systemd/user/ccrc.service.d/remote.conf \
  && rmdir ~/.config/systemd/user/ccrc.service.d \
  && systemctl --user daemon-reload && systemctl --user restart ccrc.service \
  && bash ~/ccrc/deploy/verify-service.sh ccrc.service'
curl -fsS http://203.0.113.7:7788/health
# Expected: {"ok":true,"build":{"sha":"<merged sha>",...}} — the unit now runs
# on ccrc.env ALONE. Only after this verifies:
ssh -p 2222 -i ~/.ssh/your-key-b you@203.0.113.7 'rm ~/.ccrc/remote.env'
```

- [ ] **Step 5: The stage-1 exit checklist — every line from the box's own mouth**

```bash
SHA=$(git rev-parse origin/main)
# Server: stamped, correct sha, remote mode still working.
curl -fsS http://203.0.113.7:7788/health | grep -F "\"sha\":\"$SHA\"" && echo "server: STAMPED CORRECTLY"
curl -fsS http://203.0.113.7:7788/api/fleet/health   # expect mode:remote, connected:true
# Fleet host: ccd stamped, timer live, drop-ins loaded, PWA-visible telemetry intact.
~/.local/bin/ccd version | grep -F "$SHA" && echo "ccd: STAMPED CORRECTLY"
systemctl --user is-active ccd-cap-scopes.timer
systemctl --user show ccrc-agent.service -p MemoryMin --value       # expect 201326592 (192M)
systemctl --user show claude-session@ccrc-pwa-calm-mesa.service -p MemoryMax --value  # expect 10737418240 (10G)
```
Expected: every check answers as annotated. If the drop-in property checks
return `infinity`/`0`, the drop-ins did not load — check
`systemctl --user cat <unit>` for the drop-in header before touching anything.

- [ ] **Step 6: Record the milestone**

Update the spec's Status line (`docs/superpowers/specs/2026-08-11-ccrc-oss-single-dev-infra-design.md`) from "pending implementation plan" to "Stage 1 shipped <date>; stages 2+ pending", commit to a branch, PR it with the checklist output in the body.

---

## Self-Review Notes (spec → plan coverage)

- Spec stage-1 row: EnvironmentFile cutover (Task 3 + 9), unshipped artifacts (Tasks 1, 2), agent root (Task 4), build identity in /health + ccd version (Tasks 5–7), proof "build id equals what was shipped" (Task 8, asserted by the deploy itself; Task 9 exercises it against production).
- The scratch-VM proof from the spec's stage table is deliberately deferred to stage 2's installer work: stage 1's deploy still assumes an existing box (rsync + npm on target). What stage 1 proves is the identity assertion and repo completeness on the REAL boxes — the strictly stronger claim available today. The spec's stage-2 proof ("fresh VM → install.sh") is where the scratch VM enters.
- `CCRC_HOST` note: tailscale serve on server-box proxies to `203.0.113.7:7788` literally, so the live env file keeps that bind (Task 9 Step 2) — loopback-only is the fresh-install default, not a migration.
- Not touched, deliberately: `/api/fleet/health` (three full-body `toEqual` pins), the `AgentReady` frame (`v` field's own docstring defers it; version-on-ready is stage 3+ per spec §3), `ccgpt-usage` drop-in (not ccrc's).
