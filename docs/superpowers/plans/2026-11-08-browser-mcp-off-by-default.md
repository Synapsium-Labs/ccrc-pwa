# Browser MCP servers off by default in fleet sessions

ccrc managed no MCP servers before this change: every fleet session started whatever its account's config dir enabled.
Measured on the fleet before it: 7 of 19 account config dirs enable `playwright@claude-plugins-official` and
`chrome-devtools-mcp@claude-plugins-official`, and 10 sessions each ran both (70 processes, 3.87 GiB RSS). Almost none
of those sessions drive a browser. This plan turns the servers off by default, per session, at spawn, and lets a
session that needs a browser ask for one.

## What ships

- **Box settings** (`ccd/ccrc`'s `CCRC_SETTINGS`, the `browser-tools` family): `CCRC_BROWSER_MCP_DEFAULT` (`on` or
  `off`, default `off`, class `value`) and `CCRC_BROWSER_MCP_SERVERS` (comma-separated Claude Code server names, default
  the two measured names, class `is-set`). Their checks (`_browser_mcp_default_ok`, `_browser_mcp_servers_ok` and their
  words) ride the generated `ccd/lib/ccrc-settings.sh`, because `ccd` reads both at every spawn and never sources
  `ccd/ccrc`. `shared/api.ts`'s `BOX_SETTING_TABLE`, value words and refusal words mirror them.
- **The `browser` routing field** (`on`/`off`, absent = the box default): `ROUTE_WRITABLE_FIELDS` in `shared/api.ts`,
  `ROUTE_FIELDS`/`ROUTE_BROWSERS` and `_route_valid` in `ccd/ccd`. So `ccd route --session <id> --set browser=on`,
  `--route browser=on` on the minting verbs (a dispatch's route), `parseRouteFields` and the registry's route read all
  take it with no second list. A new caps token, `browser-route-v1`, gates the server's use of it: the operator's doors
  answer 501 without it and a dispatch drops the field and journals `route-omitted:no-browser-route-cap`
  (`routeForBrowserCap`).
- **Launch**: `_browser_spawn_compose` runs in `_spawn_start` (every spawn path: start, ensure, a swap's restart, a
  roll's wake), after the child's deny file and before the account deny file. When the effective value is `off` it
  merges `{"deniedMcpServers":[{"serverName":…},…]}` into the row's one `--settings` (D-5391); `SETTINGS_UNION_JQ` now
  unions `deniedMcpServers` across sides. It records what it applied in `$REG/<id>.browsermcp` (`on`/`off`), which the
  registry reads (listed-only) into `FleetSession.browserMcp`. It never refuses or delays a spawn: a missing settings
  reader composes nothing and records `on`; a setting that cannot be read or is refused reads as its default; each warns.
- **Console**: Settings › Automation › Browser tools (the box default, the server list, how many running sessions use a
  browser, a door to Stop leftovers); the session's ⋯ menu › Browser tools (a sheet with On and Off, what this run
  applied and whether a change waits for the next start); the New session sheet's Browser field (Box default, on, off).
- **Doctor**: `browser-mcp` counts the Claude Code processes that run a configured browser server (the distinct parents
  of each server's process tree) against the registry rows whose last spawn recorded `on`, and warns when the first is
  higher.
- **Docs**: the README's "Browser MCP servers, off by default", the settings paragraph and the Config table; the
  coordinator skill's wave-lifecycle note, "dispatch with `browser=on` when the task needs a browser".

## Measurements (2026-11-08, Claude Code 2.1.318 on the Mac; the fleet runs 2.1.319)

All through `claude -p "reply ok" --output-format stream-json --verbose`, reading the `system`/`init` event's
`mcp_servers`, and, for the process check, the probe session's own process tree (descendants of its pid only, so other
sessions on the machine are not counted).

- The operator's own config dir (playwright enabled): `mcp_servers` lists `plugin:playwright:playwright` (`connected`).
  `--settings '{"deniedMcpServers":[{"serverName":"plugin:playwright:playwright"}]}'` removes it; the plugin stays in
  `plugins`. The bare key `{"serverName":"playwright"}` does NOT match (the server still connects).
  `{"serverCommand":["npx","@playwright/mcp@latest"]}` matches too.
- `chrome-devtools-mcp` was not installed on the Mac, so both plugins were installed from the official marketplace
  into a throwaway `CLAUDE_CONFIG_DIR` (no credentials: the init event is emitted before the login check, and nothing
  of the operator's configuration changed). Its init event lists `plugin:chrome-devtools-mcp:chrome-devtools` and
  `plugin:playwright:playwright`. The design's predicted name, `plugin:chrome-devtools:chrome-devtools` (from the
  plugin's root `plugin.json`, whose name is `chrome-devtools`), does NOT match: the name Claude Code uses is the
  plugin's (`.claude-plugin/plugin.json` and the marketplace entry, both `chrome-devtools-mcp`) and the server key
  (`chrome-devtools`).
- Denying both measured names removes both from `mcp_servers`, keeps all eight of the chrome-devtools-mcp plugin's
  skills, and starts none of their processes: the probe's tree held `npm exec @playwright/mcp@latest`,
  `node …/playwright-mcp`, `npm exec chrome-devtools-mcp@1.11.0`, `node …/chrome-devtools-mcp` and its telemetry
  watchdog without the deny, and no MCP process with it.
- `serverCommand` matches only the exact argv: `["npx","chrome-devtools-mcp@1.11.0"]` matches, and a wildcard
  (`["npx","chrome-devtools-mcp@*"]`) does not, nor does `serverName` take one (`plugin:chrome-devtools-mcp:*`). The
  plugin pins its version in its argv, so a `serverCommand` entry would stop matching at the plugin's next release.
  The default list therefore names servers by `serverName` only; no command entry is added as a second match.

## The author's calls (from the ticket's own text)

- Coordinators are off too: every new session starts no browser server unless it is enabled for it.
- Per-session servers only; no shared per-box server.
- No forced restarts of running sessions: a running session keeps its servers until its next spawn.
- A session may turn its own browser on with `ccd route`, applied at its next restart.

## Deviations found

- **D-8121 (2026-11-08)** — browser MCP servers off by default in fleet sessions: the `browser` routing field, the two
  box settings, the spawn's `deniedMcpServers` composition and its `$REG/<id>.browsermcp` record, the `browser-route-v1`
  caps token, the Browser tools card and sheet, and doctor's `browser-mcp` check, as above. Its departures from the
  design, each measured or argued here: the chrome-devtools server's name is `plugin:chrome-devtools-mcp:chrome-devtools`
  (measured, not the predicted `plugin:chrome-devtools:chrome-devtools`); no `serverCommand` entry is added (the
  plugin's argv is version-pinned and the match takes no wildcard); the composition applies on every lane, a Codex lane
  included, because `ccrc-codex` execs Claude Code with its argv untouched, as the account deny file already assumes; the
  card sits in Settings › Automation, because Settings has no Sessions section and the card's door, Stop leftovers, is
  there; the session's control is a ⋯ menu item and sheet, because the session screen has no route sheet with a
  Workflows row; and the test harness pins `CCRC_BROWSER_MCP_DEFAULT=on` (`ccdWsHelpers.ts`) so the suites that pin a
  spawn argv byte for byte measure what they did, while `ccd-browser-spawn.test.ts` measures the default.
  Review fixes in the same PR: `browser` is not a routing answer, so a route that names only `browser` keeps the
  default row. A fresh dispatch's route of `browser` alone is laid over its run kind's row and keeps `--route-default`
  (`dispatchDecide.ts`); `ws-add` and a minting `start` given only `browser` pairs still seed the coordinator row
  (`_route_argv_routes`); and `_route_any` leaves `browser` out, so a stray `browser` field is not a routing record. The
  doctor's count never reads a Claude Code process as a server: an off session's own argv carries the denial inline,
  naming both `mcp` and each server key (`_dr_bmcp_is_claude`). The console's `queued` follows the box default for a
  session with no field of its own, and its count no longer reads a pane with no record as using a browser.

## Known limits

- **No restart-now control.** The card does not offer "Restart idle sessions now": the only roll path
  (`ccd hibernate --roll`, the roll lane) is the automatic coordinator roll with its own budget, journal and target
  rules, and an operator-triggered roll of a chosen set is a lane of its own. A change reaches a running session at its
  next start; the card and the doctor's remedy say so.
- **The box default is set on the box.** Like every box setting, it is shown in the console and written in the fleet
  box's `~/.ccrc/ccrc.env`; the console has no writer for it.
- **A custom server list is shown as set, not listed** (`is-set`): the box settings view records only whether it is
  set, so the card names the default list or says the box sets its own.
- **ccd cannot clear the field.** `ccd route` sets a field and has no unset, so a session that set `browser` keeps
  following its own value; the sheet offers On and Off, not "box default". The field no longer counts as a routing
  record (`_route_any`), so it does not suppress the coordinator row or the no-record effort keystroke.
- **The doctor's match is by command line.** A process counts when its command line holds a configured server's key and
  `mcp` and it is not Claude Code itself (first word `claude`, or `--settings` / `deniedMcpServers` in its argv); a
  server whose command line names neither is not counted, and one that names both is, whatever it is.
  Two shapes can raise a brief false WARN: a session's own shell command that names `mcp` and a server key (a grep or a
  test of this code) sits under its Claude Code process, and a browser helper the server launched that is reparented
  out of the server's tree on Linux would count its new parent. The second is not measured; check it at acceptance.
- **The coordinator's manual route door is not gated for `browser`.** `POST /api/runs/:id/route` accepts the field
  because it is writable, but unlike dispatch and the operator doors it does not check `browser-route-v1`: an older ccd
  answers with its own unknown-field error, and the run journal records a route rung for a field that is not one.
- **The session sheet's write runs the route applier.** It goes through `ccd route ... --apply`, so a session with a
  class or effort already pending gets that keystroke typed when Browser is toggled, and a busy pane records a skip
  note. The browser record itself is right.
- **The doctor's ON counts every record that says on**, stopped, hibernated and archived rows included, not only the
  running sessions whose effective value is on. ON can only be too high, so a stale `on` record can hide a pane that
  really leaks a server (WARN is raised only when USING is above ON); it never raises a false WARN.
- **A pane with no record is counted apart.** A pane spawned before this ccd (`browserMcp` absent on the row) runs
  whatever its account enables, which the console cannot see; the card counts it as "started before ccrc managed browser
  tools", never as using a browser, until it restarts. The session sheet reads the box default with one `/api/updates`
  read when it opens; if that read fails, a session with no field of its own shows no pending change.
- **The environment can shadow ccrc.env for ccd.** ccd reads both settings with `_ccrc_knob`'s default mode, where the
  process environment wins over `~/.ccrc/ccrc.env`, while the console's settings read uses the file. A caller whose
  environment carries a stale `CCRC_BROWSER_MCP_DEFAULT` (a unit's `EnvironmentFile` loaded at its start) spawns with it
  until that process restarts, and the card can say otherwise meanwhile.
- **Real-engine width checks cover the Settings card only.** `browser-tools-card.browser.test.ts` measures the card at
  360, 390, 1280 and 1920; the session's Browser tools sheet (the shared `Sheet` and `OptionRow`) and the New session
  route row's 2 x 2 grid are covered by jsdom only.
- **Acceptance is checked on the box after deploy**, not here: a new session starts no browser server; an enabled one
  gets it and it is gone after hibernation with Stop leftovers armed; the process count matches the sessions using a
  browser.
