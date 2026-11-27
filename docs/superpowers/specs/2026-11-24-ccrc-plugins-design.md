# ccrc plugins — design

Status: design, approved section by section by the operator on 2026-11-24. The plan follows from it.

## 1. Problem and scope

ccrc has no way to extend it without changing its tree. The operator wants separately attachable plugins at three
extension points: **commands** (`ccrc <plugin> …`), **reactions to fleet events** (a session died, a PR merged, an
account limit), and **panels in the PWA**.

Decided with the operator:
- Plugins are the operator's own (placed by hand) **and** official ones shipped in ccrc's release, disabled until the
  operator enables them. No third-party catalogue.
- A plugin reads fleet state and acts outside ccrc freely; it acts **on the fleet** only through the API doors the
  console uses, and only those the operator granted it. Protected verbs, secrets and the box token are never granted.
- Events are durable: each plugin has a cursor over the existing notice feed and gets what it missed, at least once.
- A plugin is a **process per call**: no daemons, no supervision (the Go core's rule).
- Containers are not part of this spec. Running ccrc, or one fleet project, in containers is a separate, opt-in
  programme (operator, 2026-11-24); a container runtime for plugins arrives with it.

Rejected: Go's `plugin` package (no Windows, needs the very same Go build); WASM (a third-party dependency, against the
core's standard-library rule); long-lived plugin processes and webhooks (supervision and a network surface for no
isolation gain on a single-user fleet).

## 2. The plugin model

- **Where.** Official plugins ship in the release tree under `plugins/<name>/`; the operator's own live in
  `~/.ccrc/plugins/<name>/`. Two plugins with one name refuse to load (neither shadows the other).
- **Manifest** `plugin.json`:
  ```json
  { "name": "linear", "version": "1.0.0", "exec": "bin/linear",
    "commands": ["sync", "link"],
    "events": ["done", "merged", "limit"],
    "panel": { "title": "Linear", "static": "panel/" },
    "grants": ["fleet.read", "notice.raise"] }
  ```
  `name` follows the id grammar (`[a-z][a-z0-9-]{0,40}`) and must not collide with a built-in `ccrc` subcommand. Event
  names are `NotifyEvent` kinds from `shared/api.ts` — the notice feed's own vocabulary, not a second list.
- **Enabling** is the operator's: Settings in the PWA, or `ccrc plugin enable|disable <name>` in their shell. Like
  account management, these are never a session's: they join the classifier's forbidden rows, the hook's deny arm and
  the child deny file (an accident guard, as for the account verbs). Enabled state and approved grants live in
  `coord.db`, written by one session-gated door.
- **Off switch** `$REG/plugin-off`: present and empty turns every plugin off; a line naming a plugin turns that one off.
  Nothing in the tree writes it.
- **One runner.** The Go core (`ccrc-core plugin …`) parses manifests, resolves grants, builds the plugin's environment
  and runs it. The server never spawns a plugin itself: for events and panels it runs `ccrc-core plugin` as a child
  through its existing local exec adapter. A box with an enabled plugin therefore has the core installed (the installer
  places it on any role when a plugin is enabled there).

## 3. The call protocol

Every call starts the plugin's `exec` with its directory as the working directory and this environment, built from
an empty one (never the caller's): `PATH`, `HOME`, `LANG`, `CCRC_PLUGIN_NAME`, `CCRC_PLUGIN_STATE` (=
`~/.ccrc/plugin-state/<name>/`, created 0700), and, only when the plugin holds grants, `CCRC_API_URL` and
`CCRC_PLUGIN_TOKEN`. No other ccrc secret reaches it.

- **Commands.** `ccrc <plugin> <args…>` runs `exec` with the args. The plugin's stdout, stderr and exit status are the
  command's; there is no JSON layer.
- **Events.** The server runs one batch per plugin at a time. Stdin carries a header line `{"v":1,"kind":"events"}`
  then up to 100 events after the plugin's cursor, each the feed record with its `seq`. After handling one, the plugin
  writes `{"ack":<seq>}` on stdout. The cursor (in `coord.db`, one writer: the server's event lane) moves to the last
  ack when the process ends. Delivery is at least once; a plugin must tolerate a repeat. When the cursor has fallen
  behind what the feed archive keeps, the batch's first event is `{"kind":"gap"}`.
- **Panels.** The server serves the panel's static files itself. A data request from the panel becomes one call with
  stdin `{"v":1,"kind":"panel","path":…,"query":…}` and one stdout line `{"status":…,"body":…}`.
- **Bounds.** An event batch: 30 s. A panel call: 10 s and 1 MiB of answer. A command: none (it is the operator's own
  invocation).

## 4. Failure

- An event batch that exits non-zero or passes its bound leaves the cursor at the last ack; the lane retries after 1
  min, 5 min, 30 min, doubling to 6 h.
- The same event failing five times in a row **pauses** the plugin: it is never skipped silently. The operator sees a
  notice (the funnel's `record-always`) and a doctor line, and chooses Skip or Retry in Settings.
- A panel call that fails answers the iframe `502` with the reason. A command's failure is its own exit status.
- A manifest that does not parse, a missing `exec`, a name collision or an event name outside `NotifyEvent` keeps the
  plugin off, with the reason in doctor and in Settings.

## 5. Grants, the plugin token and the trust boundary

- **Grants** are one table in `shared/` (L0): each grant name maps to the routes and methods it opens — `fleet.read`
  (the fleet, session and run reads), `notice.raise` (a record in the notice feed), `mail.send` (system mail to a
  session), `item.create` (a Waiting-on-you item), `session.restart`, `session.swap`. The grants a plugin holds are the
  intersection of its manifest's request and the operator's approval.
- **Never grantable** (a guard test, red when such a route enters the table): protected verbs, account and secret
  doors, the box-token doors, the update control plane, the auth doors, and every operator door that takes a step-up.
- **The token.** When a plugin is enabled with grants, the server mints a random token for it and keeps only its hash
  in `coord.db`. It rotates on every grant change, disable or re-enable, and the old one stops working at once. It
  reaches the fleet box through the existing box-token delivery lane (the agent's token-sync op), so there is no second
  secret-distribution mechanism. Its files join `ACCOUNT_SECRET_PATHS`, so the session hook refuses a session that
  reads them (an accident guard, as for the other secrets).
- **The gate.** A new header `x-ccrc-plugin-token`: `auth/gate.ts` resolves it to a plugin and its grants and admits
  only those routes; anything else is `403`. A plugin token never passes a door that needs the operator's session.
- **Attribution.** Every API call a plugin makes is recorded with the plugin's name. On a single-user fleet a plugin
  runs as the same UNIX user as ccd: it is attributed, not sandboxed, and this spec does not claim otherwise.
- **Panels.** An iframe with `sandbox="allow-scripts"` and without `allow-same-origin`, so it cannot reach the
  console's cookie; a strict CSP on the panel's files; its data only through the server's proxy.

## 6. Architecture

- **Go core** (`core/`): `domain/plugin` (L1: manifest rules, name grammar, grant intersection, the event-batch and
  pause deciders), `adapter/pluginfs` (L3: plugin directories, state directories), `app/plugin` (L4: `ccrc-core plugin
  run|events|panel|list`), wired in `cmd/ccrc-core`.
- **Server**: the event lane (L4 scheduler) over the notice feed's archive, the panel routes, the Settings doors, the
  token mint and the gate's plugin arm; the cursor, enabled state, grants and token hashes in `coord.db` (one writer
  each).
- **PWA**: Settings rows (enable, grants, Skip/Retry on a paused plugin) and the panel host.
- **`ccrc`**: `ccrc <plugin> …` and `ccrc plugin enable|disable|list`, forwarded to the core.

## 7. Tests

The grants guard (never-grantable routes); the gate (`403` outside grants, a rotated token refused); the off switch;
events: a crash mid-batch re-delivers from the last ack, a poison event pauses at the fifth failure, a lagging cursor
gets `gap`; commands: the environment holds no ccrc secret; panels: the `sandbox` attributes and the CSP; the
forbidden lists refuse `ccrc plugin enable` from a session. Each guard is measured red when its code is removed.

## 8. Waves

1. The registry and commands in the core (`plugin.json`, `ccrc <plugin>`, `ccrc plugin list`, the off switch).
2. Grants and tokens: the shared table, the mint, the delivery lane, the gate arm, the Settings doors.
3. Events: the lane, the cursor, the batch protocol, the pause.
4. PWA panels: the static host, the proxy, the Settings UI.

Implementation starts after wave 2 of the Go core, on its own branch, under the same token-pacing rule.
