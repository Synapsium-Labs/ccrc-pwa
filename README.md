# ccrc — self-hosted remote control for the Claude Code fleet

A mobile-first, installable PWA to view and drive the `ccd` fleet of
`--remote-control` Claude Code sessions on server-box, over Tailscale. It follows
sessions across account swaps — the thing the official claude.ai app can't do.

**Install URL (tailnet only):** `https://server-box.tailnet-example.ts.net:8443/`
Add to home screen in Android Chrome / iOS Safari for the standalone app.

> ccrc lives on port **8443**, not 443 root. The `claude-docserver` owns 443
> root — it serves every project's docs at `https://<host>/<project>/…`, and
> those root-path URLs are referenced all over generated specs/plans. A PWA
> can't share that path space (its SPA fallback would swallow every doc path
> and serve index.html), so ccrc keeps its own port.

## Architecture

- `server/` — Node ≥22 + Fastify (TS ESM). One process, systemd user unit
  `ccrc.service`, bound to the Tailscale address only (`CCRC_HOST:CCRC_PORT`,
  default `127.0.0.1:7788`; the box runs `203.0.113.7:7788`). No database —
  in **local** fleet mode it reads ccd's flat files and shells out to
  `ccd`/`tmux` directly through an injected `Runner`/`FleetIO`; in **remote**
  fleet mode the exact same seams are backed by a WS client talking to
  `agent/` on the fleet host instead (see "Remote fleet mode" below). Either
  way the whole thing is unit-testable off-box against fixtures.
- `agent/` — Node ≥22 WS service (TS ESM) that runs ON the fleet host and
  exposes a small, whitelisted exec/file/tail/pty surface over a bearer-token
  connection. Only needed for remote fleet mode; local mode never touches it.
- `pwa/` — React + Vite installable PWA ("phosphor & ink" design). Builds into
  `server/dist-pwa`, which the server serves at `/`.
- `shared/` — `agent-protocol.ts` (server↔agent WS message types) and
  `api.ts` (server↔PWA REST/WS types), imported by both `server/` and
  `agent/`.
- `deploy/` — `ccrc.service` / `ccrc-agent.service` (systemd user units),
  `ccrc.env.example` / `ccrc-agent.env.example` (env templates — copy to
  `ccrc.env` / `ccrc-agent.env`, gitignored, to supply real tokens),
  `notify.sh` (ccd swap hook → `/api/notify`), `deploy.sh`.

HTTPS is fronted by `tailscale serve` on port 8443 (a secure context is required
for the service worker + WebAPK install). 443 root is the claude-docserver
(project docs at `/<project>/…`) with mech-fleet-preview at `/fleet`; ccrc can't
take 443 root without its SPA fallback swallowing every doc path, so it stays on
its own port.

## Develop

```bash
cd server && npm ci && npm run test      # unit tests, hermetic
cd ../agent && npm ci && npm run test     # unit tests, hermetic
cd ../pwa && npm ci && npm run test       # component tests
```

Run the server against a fixture home: `CCRC_HOME=<tree> npm run dev` in `server/`.

## Deploy

```bash
bash deploy/deploy.sh                # server: build PWA here (freshness-gated) → rsync → box npm ci + build → restart unit → health check
bash deploy/deploy.sh agent <host>   # ccrc-agent: rsync → ship ccd + notify.sh (backed up) + session-hook.sh (installs it) → host npm ci + build → restart unit
```

`CCRC_BOX` overrides the server's default target (`you@203.0.113.7`);
the agent target's `<host>` defaults to `$CCRC_BOX` if omitted, but in
practice the fleet host is a different box (see "Remote fleet mode" below).
`CCRC_HEALTH_URL` overrides the server's post-deploy health-check URL
(default `http://203.0.113.7:7788/health`).

Both targets ship a local, gitignored env file to `~/.ccrc/` on the box first
if one exists (`deploy/ccrc.env` / `ccrc-agent.env` — copy from
the committed `*.env.example` templates and fill in real tokens; the real
files are never committed). The service units use `/usr/bin/env node` (box
node is in `/usr/local/bin`). Every run stamps its backups (previous ccd,
notify.sh, served dist trees) into `~/ccrc-backups/<timestamp>/` on the
target before overwriting anything — and a backup copy that *fails* aborts
the deploy before `rsync --delete` can destroy the state it failed to save.
The agent deploy installs `ccd` BEFORE restarting the agent — the agent
caches `ccd caps` at boot, so the reverse order pins a stale verb set.

**Restore** (manual, from the target box — pick the `<ts>` to roll back to):

```bash
# fleet host (agent target)
cp -a ~/ccrc-backups/<ts>/ccd ~/.local/bin/ccd
cp -a ~/ccrc-backups/<ts>/notify.sh ~/.cc-sessions/notify.sh
cp -a ~/ccrc-backups/<ts>/session-hook.sh ~/.cc-sessions/session-hook.sh
cp -a ~/ccrc-backups/<ts>/agent-dist/. ~/ccrc/agent/dist/
systemctl --user restart ccrc-agent.service
# server box
cp -a ~/ccrc-backups/<ts>/dist-pwa/. ~/ccrc/server/dist-pwa/
systemctl --user restart ccrc.service
```

## Remote fleet mode

By default (`CCRC_FLEET=local`, unset) the server reads ccd's flat files and
shells out to `ccd`/`tmux` directly on its own box — this is what's deployed
today. `CCRC_FLEET=remote` instead drives the fleet through `ccrc-agent`
running on a separate fleet host, over a single authenticated WebSocket —
the server never SSHes into the fleet box at runtime.

### Config

| Var | Where | Meaning |
| --- | --- | --- |
| `CCRC_FLEET` | server | `local` (default) or `remote`. |
| `CCRC_AGENT_URL` | server | `ws://`/`wss://` URL of `ccrc-agent` on the fleet host, e.g. `ws://100.x.x.x:7789`. |
| `CCRC_AGENT_TOKEN` | server + agent | Bearer token; must match on both sides. Generate with `openssl rand -hex 32`. |
| `CCRC_HETZNER_TOKEN` | server | Hetzner Cloud API token — only used by the degraded-mode reboot action. Unset leaves that route disabled (`501`). |
| `CCRC_FLEET_SERVER_ID` | server | Hetzner Cloud server ID of the fleet host — only used by the reboot action. |
| `CCRC_AGENT_HOST` | agent | Bind interface, default `127.0.0.1`. Never `0.0.0.0` — bind the tailnet address explicitly instead. |
| `CCRC_AGENT_PORT` | agent | Listen port, default `7789`. |

See `deploy/ccrc.env.example` and `deploy/ccrc-agent.env.example` for
copy-paste templates.

### Agent security model

`ccrc-agent` (`agent/`) is deliberately narrow — it is not a
general remote-shell:

- **Network**: binds a single interface (tailnet-only by convention; default
  `127.0.0.1`), never `0.0.0.0`. Every connection must send a valid `hello`
  frame with the bearer token within 3 s, or the socket is closed; a wrong
  token closes with code `4401`.
- **Exec whitelist**: only `tmux` (`has-session`, `list-panes`,
  `capture-pane`, `send-keys`, `resize-window`) and `ccd` (`start`, `enable`,
  `ensure`, `stop`, `swap`, `clip`) — matched against the exact bare command
  name (no path components) and an exact first-argument subcommand. Anything
  else comes back `{ok:false, err:'forbidden'}`.
- **Path whitelist**: every file op resolves the target through `realpath`
  and checks it's still under an allowed canonical prefix — closing the
  classic symlink-escape hole. Reads: `$HOME/.cc-sessions/`,
  `$HOME/.cc-limits/`, `$HOME/.cc-clips/`, `$HOME/.claude*/` (glob), and the
  fleet's projects root. Writes: `$HOME/.cc-clips/` only.
- **pty**: `ptyOpen` only ever spawns `tmux attach -t cc-<sessionId>`, with
  `sessionId` sanitized to `[A-Za-z0-9_-]+` — never an arbitrary command.

### Degraded mode

While the fleet host is unreachable in remote mode, the server keeps serving
the last-known-good fleet snapshot instead of going blank:

- On every successful full fleet poll, the snapshot is written atomically to
  `~/.ccrc/state-cache.json` on the **server's** box (this file never goes
  through the agent — it's local housekeeping, same as the PWA dist-check).
- When the agent connection drops, `GET /api/fleet` keeps serving that cached
  snapshot with `stale: true` and `downSince: <epoch ms>`; the PWA shows a
  banner ("Fleet host unreachable since …") once it sees `stale`.
- `GET /api/fleet/health` → `{mode, connected, downSince}` — poll this to
  check remote-mode connectivity (`mode: 'local'` always reports
  `connected: true`).
- `POST /api/fleet/reboot` fires a Hetzner Cloud reboot of the fleet host —
  the PWA's confirm dialog names the collateral (it also restarts the
  rp-llm services sharing that box). Guards: `409` if `mode !== 'remote'`,
  `501` if `CCRC_HETZNER_TOKEN`/`CCRC_FLEET_SERVER_ID` aren't set, `502` on a
  Hetzner API error, `202` on success.

### Verifying a remote-mode deploy

After `deploy.sh agent <host>` and flipping the server to `CCRC_FLEET=remote`:

```bash
curl -fsS http://203.0.113.7:7788/api/fleet/health   # {"mode":"remote","connected":true,"downSince":null}
```

Then kill/stop `ccrc-agent` on the fleet host and re-poll — `connected`
should flip to `false`, `/api/fleet` should keep returning the last snapshot
with `stale: true`, and the PWA banner should appear. Cutting the currently
local-only deployment over to remote mode (wiring `ccrc.service` to source
`CCRC_FLEET=remote` for real) is intentionally out of scope here — see the
plan's self-review notes.

## Live end-to-end tests

Drive a throwaway `claude2-cctest` session on the box through the public API:

```bash
CCRC_BASE_URL=http://203.0.113.7:7788 \
  npx vitest run --config vitest.e2e.config.ts        # in server/
```

The suite is `CCRC_BASE_URL`-gated, so a bare `vitest run` stays hermetic.
Reset cctest between runs: stop `claude-session@{claude2,claude}-cctest` and
`rm ~/.cc-sessions/{claude2,claude}-cctest.*`.

## Pane-format fragility (re-capture after Claude Code upgrades)

ccrc scrapes the tmux pane for dialogs and the input-box draft, and these
strings drift between Claude Code versions. After any upgrade, re-capture the
fixtures under `server/test/fixtures/panes/` (e.g.
`tmux capture-pane -t cc-<id> -p`) and re-run `test/dialog.test.ts` /
`test/send.test.ts`. Known real-format subtleties already encoded:

- The **input box** is the LAST `❯` line (history turns render `❯ ` above it),
  and the empty box uses `❯` + a **U+00A0 non-breaking space**, not a plain one.
- A `--remote-control` pane **never renders `esc to interrupt`**, so busy-ness is
  taken from the live status file (`sessions/<pid>.json`), not the pane.
- Real **AskUserQuestion** menus put a description line under each option and can
  split the list across a `───` rule — options are not adjacent.

Anything the parser can't handle degrades to `parsed:false` / the terminal
drawer rather than crashing.
