# Overrides in force, and a reboot that says it cannot run before the tap

- **D-8382 (2026-11-12)** — the console shows the terminal-only overrides in force and the reboot's configuration before it is needed (#1442): `GET /api/fleet/health` carries `rebootConfigured` (a boolean, never the token or the id) and the unreachable banner disables Reboot and names the remedy while it is `false`; the switchboard registers `autocompact-disabled` and the three `~/.ccrc` off switches (`graph-gate-off`, `ccrc-card-off`, `compact-card-off`) as rows; the session-gated read `GET /api/fleet/overrides` answers every hand-only override with its state, read where it lives, and the server box's approvals topology; Settings › Automation › Overrides in force lists the ones that stand from their switchboard rows, and Settings › Security › Approvals says in one line what `approvals-single-box` means here.

## Why

The degraded-fleet reboot answered `not-configured` (501, `CCRC_HETZNER_TOKEN` or `CCRC_FLEET_SERVER_ID` unset) only
after the tap, which is mid-outage. The emergency override markers were not all in the switchboard, so nothing in the
console showed one that was left on: `autocompact-disabled` (`~/.cc-sessions`) and the three `~/.ccrc` off switches the
session hook reads had no row, and the rows that did exist were shown only where one card happened to read them (the
stall watch's two).

## Change

- **Reboot.** `fleetRebootTarget(cfg)` (`server/src/config.ts`) is the pair or `null`; the reboot route acts on it and
  the health answer's remote arm reports `rebootConfigured: fleetRebootTarget(cfg) !== null`, so the button and the 501
  cannot disagree. `FleetHealth.rebootConfigured` is optional (absence-permits: an older server leaves the button as it
  was). `FleetHostBanner`'s unreachable arm disables Reboot while it is `false` and says
  `FLEET_REBOOT_NOT_CONFIGURED_TEXT` and `FLEET_REBOOT_REMEDY_TEXT` (`shared/api.ts`).
- **Switchboard.** `shared/switches.ts` gains `AUTOCOMPACT_DISABLED_MARKER` (a registry row, C3), a third storage kind
  `CcrcFileStorage` (`~/.ccrc/<file>` on the fleet host) and its three rows: `GRAPH_GATE_OFF_FILE` (C3),
  `CCRC_CARD_OFF_FILE` (C5) and `COMPACT_CARD_OFF_FILE` (C3), all `hand-only`. Derived from the table: `ccrcFileSwitchNames`,
  `CCRC_SWITCH_FILES`, `overrideSwitchNames` (every marker or `~/.ccrc` row whose writer is `hand-only`), `overridesOf`
  and `switchPath`.
- **Where they are read.** A registry row through the one registry listing and `readSwitches`, the reader the stall
  watch's held flags and every lane already share. A `~/.ccrc` row through one `statMeasured` of
  `<ccrcDir>/<file>` over the fleet io: the fleet host's agent admits a `stat` of exactly `CCRC_SWITCH_FILES`
  (`checkCcrcSwitchStat`, `agent/src/whitelist.ts`), at the literal path, never a symlink onto another file, and for
  `stat` alone (`checkPath` admits none of them, so `read`, `readdir` and `lstat` stay refused). An older agent refuses
  with `forbidden`, which reads `unmeasurable`, never `clear`.
- **The read.** `GET /api/fleet/overrides` (`server/src/overridesRead.ts`, registered in `server.ts`): not EXEMPT, so
  session-gated when armed, no box token, no write twin. It also answers the server box's approvals topology
  (`approvalsTopologyOf`, `server/src/coord/approvalsign.ts`, whose `rulings` is `rulingsAllowedHere`'s answer).
- **Console.** Settings › Automation › Overrides in force (after Stall watch) shows each override that stands: its name,
  its row's `meaning`, its absence (`default`) and "To lift it, remove <path> at a terminal on the fleet box", every line
  from the switchboard row (`overridesWords.ts`). An override that could not be read is counted in an amber line. Settings
  › Security › Approvals (last) is one line by topology and opt-in. Neither card has a control.

## Deviations found

- The approvals opt-in is not a switchboard row. It lives on the SERVER box (`cfg.ccrcDir`, beside the signing key) and
  is a topology choice, not an emergency override, so it stays out of Overrides in force; its name rides the wire from
  `APPROVALS_SINGLE_BOX_FILE`, so the console spells it nowhere.
- The `~/.ccrc` names are `*_FILE` constants, not `*_MARKER`: the switchboard census reads every `*_MARKER` as a registry
  row, and these are never in a registry listing.
- The read is one route under `/api/fleet/`, beside the health answer, not a coordination door: the overrides span the
  contexts, and no coordinator acts on them.
- A live symlink at a `~/.ccrc` switch name reads `unmeasurable`, though the hook's `[ -e ]` would follow it: the agent
  never answers one file's size and time under another file's name. A dangling one reads absent, as `[ -e ]` does.

## Tests

- `server/test/fleet-health.test.ts`: `rebootConfigured` per key pair, absent in local mode, and the route's 501 exactly
  when it is `false`.
- `server/test/overrides-route.test.ts`: the overrides are exactly the hand-only marker and `~/.ccrc` rows in `SWITCHES`
  order; the four new rows' storage and owners; each state kept as read; the route over a fixture HOME; an unlistable
  registry and an unreadable stat read `unmeasurable`; the topology per role, mode and file agrees with the ruling gate.
- `agent/test/whitelist.test.ts`, `agent/test/fileops.test.ts`: the `stat`-only grant, by name and literal path; every
  other op and name refused.
- `pwa/test/fleet-host-banner.test.tsx`, `pwa/test/overrides-section.test.tsx`: the disabled button and remedy; the rows,
  lines and absence of controls; the census that the cards name no override and read `SWITCHES`.
- `pwa/browser/overrides-in-force.browser.test.ts`: both cards and the banner at 390, 1280 and 1920 in both skins.
