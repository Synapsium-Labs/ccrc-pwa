# ccrc — self-hosted remote control for the Claude Code fleet

A mobile-first, installable PWA to view and drive the `ccd` fleet of
`--remote-control` Claude Code sessions on server-box, over Tailscale. It follows
sessions across account swaps — the thing the official claude.ai app can't do.

**Install URL (tailnet only):** `https://server-box.tailnet-example.ts.net/`
Add to home screen in Android Chrome / iOS Safari for the standalone app.
(Served at 443 root via `tailscale serve`; the claude-docserver moved to `:8443`.)

## Architecture

- `server/` — Node ≥22 + Fastify (TS ESM). One process, systemd user unit
  `ccrc.service`, bound to the Tailscale address only (`CCRC_HOST:CCRC_PORT`,
  default `127.0.0.1:7788`; the box runs `203.0.113.7:7788`). No database —
  it reads ccd's flat files and shells out to `ccd`/`tmux` through an injected
  Runner, so the whole thing is unit-testable off-box against fixtures.
- `pwa/` — React + Vite installable PWA ("phosphor & ink" design). Builds into
  `server/dist-pwa`, which the server serves at `/`.
- `deploy/` — `ccrc.service`, `notify.sh` (ccd swap hook → `/api/notify`),
  `deploy.sh`.

HTTPS is fronted by `tailscale serve` at 443 root (a secure context is required
for the service worker + WebAPK install). `/fleet` (mech-fleet-preview) stays on
443; the claude-docserver moved to `:8443` so ccrc — a PWA that wants a clean
origin root — owns `/`.

## Develop

```bash
cd server && npm ci && npm run test      # 82 unit tests, hermetic
cd ../pwa && npm ci && npm run test       # 126 tests
```

Run the server against a fixture home: `CCRC_HOME=<tree> npm run dev` in `server/`.

## Deploy

```bash
bash infra/ccrc/deploy/deploy.sh          # rsync → box npm ci + build → restart unit → health check
```

The service unit uses `/usr/bin/env node` (box node is in `/usr/local/bin`).

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
