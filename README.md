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
- `ccd/` — the pieces that live on the **fleet host**: `ccd` itself, plus
  `session-hook.sh` (the Claude Code hook that reports each session's state)
  and `install-session-hooks.sh` (the idempotent installer that registers it
  in every wrapper home). See "How a session's state is known" below.
- `deploy/` — `ccrc.service` / `ccrc-agent.service` (systemd user units),
  `ccrc.env.example` / `ccrc-agent.env.example` (env templates — copy to
  `ccrc.env` / `ccrc-agent.env`, gitignored, to supply real tokens),
  `notify.sh` (ccd swap hook → `/api/notify`), `deploy.sh`.

HTTPS is fronted by `tailscale serve` on port 8443 (a secure context is required
for the service worker + WebAPK install). 443 root is the claude-docserver
(project docs at `/<project>/…`) with mech-fleet-preview at `/fleet`; ccrc can't
take 443 root without its SPA fallback swallowing every doc path, so it stays on
its own port.

## How a session's state is known

**Hooks first, the pane as a ranked fallback.** Claude Code fires hooks on its
own lifecycle, so ccrc no longer has to infer what a session is doing from
terminal text.

`ccd/session-hook.sh` runs on the hot path of every tool call in every fleet
session and writes `~/.cc-sessions/<id>.hookstate.json` atomically. Its contract
is absolute: **exit 0 on every path**, write atomically or not at all, no
network, no locks, no waiting — a hook that can slow or break a session is worse
than no hook. It self-identifies from tmux (`cc-<id>`), so a non-fleet session
exits silently. `install-session-hooks.sh` registers it in all four wrapper
homes (`~/.claude`, `~/.claude-personal`, `~/.claude-corp`, `~/.claude-gpt`),
sweeping its own managed entries and leaving anything else in `settings.json`
untouched; every write is `jq`-gated and backed up to `~/ccrc-backups/<ts>/`.

The file carries one of three states — `working`, `waiting`, `done` — plus a
structured **ask envelope** for a waiting session: either
`{questions: [...]}` (an `AskUserQuestion`, copied verbatim from the tool call's
own JSON) or `{approval: {tool, summary}}` (a permission prompt), and the
subagents the hooks have seen start and stop.

`server/src/hookstate.ts` reads it and **fails to null** on anything it cannot
vouch for: a missing file, over 64 KB, malformed JSON, an unrecognised state, a
`sessionId` that no longer matches the registry's uuid for that session (so a
restarted session cannot inherit its predecessor's state), or a write older than
30 minutes. `null` therefore means *no fresh hook data* — never a fourth state.

The pane scraper still runs, and still raises a dialog the hook never got a
write for (an older Claude Code, a hook that failed to install). Neither source
suppresses the other; the PWA prefers the envelope and falls back to the scrape.

### The attention bucket

Every session on the fleet wire carries `bucket` and `bucketSince`, computed
once, server-side, in `server/src/bucket.ts`. The fleet screen's sections, its
counts and each row's own state word all read that one field, so they cannot
disagree — before this there were three independent re-derivations that drifted.

The ladder tests, in order: `archivedAt` (→ `cleanup` when the PR is merged,
else `archived`), then `dead`, then `attention` (a pending dialog or a waiting
hook), then `working`, then `done` (which requires hook evidence — a hookless
busy→idle transition never proves a turn *finished*), then `idle`. **The
archived rows come first deliberately**: `ws-archive` stops the session, so
every cleanup candidate is also `dead`, and a dead-first ladder would leave the
cleanup bucket permanently empty.

`bucketSince` is *derived* from evidence already on the record — never
remembered by the watcher, which would reset on every deploy and paint the whole
fleet as freshly-unseen several times a day.

`status` itself stays frozen and hook-blind; a test asserts it is identical with
and without hook state present.

### Workspace holds & programs

A **hold** is a program's declared claim on a workspace — `ccd ws-hold
--session <id> --reason <text>` writes `$REG/<id>.hold`, and `ccd ws-release
--session <id>` removes it. No timeout, no expiry, ever: the claim lasts as
long as the reason is true, and the reason string *is* the whole display —
verbatim on the fleet chip, the actions sheet, and the held-merged push,
parsed nowhere. Workspace-only (a main checkout has nothing to protect) and an
archived workspace refuses (restore first); an empty reason refuses, on both
the client and ccd itself, with the identical sentence.

A hold has exactly two consumers. `archiveMerged`'s auto-archive gate gains
`held !== null` as an extra conjunct, so a workspace idle between two waves of
the same program reads as claimed, not finished, and survives a sweep even
after its PR merges. And `ws-rm` / `ws-reap` grow one refusal rung apiece:
destroying a workspace a program declared mid-flight takes two deliberate acts,
never one — `ws-rm` dies with `held: <reason> — release first`, `ws-reap`
answers `{"refused":"held"}`, and the cleanup sheet renders that as "A program
has this workspace held — it is mid-flight, so nothing was removed." Release
first, then clean up. Unchanged: the bucket ladder, `ws-archive` itself, and
manual archive/restore — a merged-but-held workspace can still be archived by
hand from the PR sheet, which is why that sheet names the hold instead of
promising a sweep that will never come. See
[`docs/superpowers/programs/TEMPLATE.md`](docs/superpowers/programs/TEMPLATE.md)
for the wave-handoff ledger a program keeps beside its hold.

## Attention, notifications and answering

- **Unseen watermark** (`pwa/src/lib/seen.ts`): a session is unseen when it
  entered a human-wanting bucket (`attention`, `done`, `cleanup`) after this
  device last acknowledged it. Per-device in `localStorage` on purpose — ccrc
  has no user accounts, so "seen" belongs to the person holding the phone.
- **Push copy discipline** (`server/src/watch.ts`): project context appears in a
  title only when more than one project is active, and nothing fires for a
  session a client reports on screen. The PWA states that claim on every socket
  open and refreshes it every 15 s; the server expires a claim it has not heard
  for 45 s, so a phone that loses signal without a close frame goes back to
  being notified rather than silently muted.
- **Answering from the notification**: an ask push carries the question's first
  two option labels as notification actions, and `pwa/public/push-sw.js` POSTs
  the answer without opening the app. A button is offered *only* where the
  answer route would accept it — an action that can only be refused costs a tap
  and a wait to learn what the server already knew.
- **Catch-up watermark**: `{epoch, seq}` as one atomic JSON value on both sides
  (`server/src/notifylog.ts`, `pwa/src/lib/notifymark.ts`). A seq is meaningless
  without the lifetime of the counter that produced it — written separately, a
  death between the two writes forges a valid-looking pair and silently drops
  real notifications. When the server cannot *prove* the client saw everything
  it says `resync`, and the client then surfaces nothing retroactively.

Three routes can act on a session, each with its own named refusals:

| Route | What it does | Gate |
| --- | --- | --- |
| `POST /api/sessions/:id/dialog` | answers a **pane** menu by walking the `❯` marker | refuses a stale dialog id; never presses Enter unless the re-captured pane proves the marker landed |
| `POST /api/sessions/:id/ask` | answers a **hook-reported** question by option index | re-reads the current envelope and refuses unless a content digest still matches, the pane still shows that exact menu, and the question is single |
| `POST /api/sessions/:id/submit` | presses **one** Enter on a box that already holds text | refuses unless the box matches the text the caller expected; one Enter, never a retry loop |

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

**Ordering between the two targets.** A change that touches `ccd/` — the hook
script in particular — must ship to the fleet host *before or with* the server,
because the server reads what the hook writes. Shipping a server that expects a
newer envelope shape to a fleet still running the old hook is how you get a
confident UI over stale data. A server+PWA-only change has no such constraint.

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

Hooks now carry a session's *state* (above), which removed the worst of this —
but the pane is still scraped, and two jobs genuinely need it: reading the
input-box draft, and proving that the menu on screen is the one an answer is
about. Both drift between Claude Code versions. After any upgrade, re-capture
the fixtures under `server/test/fixtures/panes/` (e.g.
`tmux capture-pane -t cc-<id> -p`) and re-run `test/dialog.test.ts` /
`test/send.test.ts` / `test/ask-route.test.ts`.

Hook *delivery* drifts too, and silently: Claude Code 2.1.222 delivers
`AskUserQuestion` as a `PermissionRequest`, not the `PreToolUse` the mapping was
originally written against. Both arms are kept and both are pinned by tests,
because which one fires is a harness detail this repo cannot predict across
upgrades. After an upgrade, check that a real question still writes
`ask.questions` and not an empty `ask.approval`.

Known real-format subtleties already encoded:

- The **input box** is the LAST `❯` line (history turns render `❯ ` above it),
  and the empty box uses `❯` + a **U+00A0 non-breaking space**, not a plain one.
- A `--remote-control` pane **never renders `esc to interrupt`**, so busy-ness is
  taken from the live status file (`sessions/<pid>.json`), not the pane.
- Real **AskUserQuestion** menus put a description line under each option and can
  split the list across a `───` rule — options are not adjacent.

Anything the parser can't handle degrades to `parsed:false` / the terminal
drawer rather than crashing.
