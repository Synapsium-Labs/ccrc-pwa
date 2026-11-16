# The terminal drawer capture rig

What the PWA's terminal drawer re-wraps is a real Claude Code screen: a 220-column,
50-row tmux pane plus tmux's one default status line, so the attaching client is
220x51. This rig records the pair for six synthetic situations — the 220x51
byte stream from a node-pty `tmux attach` client and the matching `tmux
capture-pane -p` output — so the drawer's model and re-wrap tests build on
measured bytes instead of hand-written mocks (spec
`docs/superpowers/specs/2026-10-14-terminal-drawer-every-width-design.md` §9,
plan `docs/superpowers/plans/2026-10-14-terminal-drawer-every-width-stage1.md`
Task 6, D-5006).

- `mockapi.mjs` — reused unchanged from `server/test/delegation-rig/`. A scripted
  mock of the Anthropic Messages API; the scenario file IS the script.
- `record.sh` — host driver and in-container recorder. It builds a throwaway
  Ubuntu 24.04 container, seeds a fixture HOME and repo under `/rig`, installs
  Node, Claude Code and node-pty into a host cache, and runs `drive.mjs` for
  each scenario. It never runs in CI; it needs docker, network and about 3 GB of
  tmpfs RAM.
- `drive.mjs` — one scenario. Starts the mock, starts a private tmux server as
  `ccd` spawns sessions, waits for the ready footer, sends the prompt, waits for
  the marker, attaches a 220x51 node-pty client, records the stream, takes two
  `capture-pane -p` snapshots 200 ms apart, and writes one fixture JSON.
- `scenarios/*.json` — the six situations: a Bash permission prompt, a Write
  preview, an AskUserQuestion multi-select, a reply with a markdown table and
  code block, a hung/animated turn, and a done reply with an unsubmitted paste.
- `sanitize.mjs` — reused unchanged from `server/test/delegation-rig/`. It scans
  the committed corpus for residue with the same allowlist it runs before the
  fixtures enter the tree.

## What it never does

- No live Claude Code session, no real project, no host HOME directory.
- No default tmux server: every run uses its own socket (`-L drawerrig`) and the
  fleet's own `tmux.conf`.
- No permission bypass: the permission scenario needs the prompt, so the seeded
  settings give `permissions.defaultMode = "default"` and an empty allow list.
- Never run in CI: the recording needs docker, apt, nodejs.org and npm.

## Prerequisites

- docker (or an equivalent container runtime) on PATH.
- Network for apt, `nodejs.org` and the npm registry.
- About 3 GB of tmpfs RAM: `/tmp` and `/rig` are mounted as tmpfs inside the
  container.
- The cache directory defaults to `${XDG_CACHE_HOME:-$HOME/.cache}/ccrc-drawer-rig`.
  It is bind-mounted into the container and stays on the host.

## How to run

```
bash server/test/drawer-rig/record.sh [--cc-version X.Y.Z] [--node-version X.Y.Z] [--cache DIR] [--keep] [--dry-run] [<scenario>...]
bash server/test/drawer-rig/record.sh --help
```

With no scenario names, every `scenarios/*.json` is recorded, sorted. Examples:

```
bash server/test/drawer-rig/record.sh --dry-run
bash server/test/drawer-rig/record.sh --keep
bash server/test/drawer-rig/record.sh permission multiselect
bash server/test/drawer-rig/record.sh --cc-version 2.1.300
```

`--dry-run` prints the steps and exits 0 without making anything or running
anything. `--keep` leaves the raw work directory for inspection.

## What happens

1. The selected scenarios are validated with `drive.mjs --check`.
2. A temporary raw root is made outside the source tree.
3. `docker run` starts an Ubuntu 24.04 container with `/tmp` and `/rig` as tmpfs.
   The rig scripts, the mock, and the fleet `tmux.conf` are bind-mounted read-only
   under `/rig/src`; the cache and the raw output directory are bind-mounted
   read-write.
4. Inside the container, as root:
   - apt updates and installs `tmux git g++ make python3 curl ca-certificates
     faketime` with the sandbox user override and apt lists/archives on `/tmp`.
   - A user `rig` matching the host uid/gid is created.
   - Architecture is resolved, `libfaketime.so.1` is located, and `tmux -V` is
     recorded.
   - Node is downloaded from `nodejs.org`, verified with `SHASUMS256.txt`, and
     extracted into the cache (as `rig`).
   - Claude Code and node-pty are installed into the cache (as `rig`).
5. For each scenario, as `rig`:
   - `/rig/home`, `/rig/project-a` and `/rig/run` are removed and recreated.
   - `/rig/project-a` is a fresh git repo with three files and one commit.
   - `/rig/run/key` is a key-shaped placeholder written mode 0600.
   - `/rig/home/.claude/settings.json` requests the fullscreen renderer and no
     permission bypass.
   - `/rig/home/.claude/.claude.json` marks onboarding complete and seeds the
     auto-default-nudge as already seen.
   - `drive.mjs` runs: mock → tmux spawn → ready wait → alternate-screen check →
     prompt → marker wait → optional keys → node-pty attach → quiet/cap read →
     optional bracketed paste → first capture → 200 ms sleep → second capture →
     checks → fixture JSON.
6. The container exits. `record.sh` scans the raw root fail-closed with
   `sanitize.mjs --scan`. If residue is found, nothing is copied and the raw root
   is kept.
7. Clean scans are copied into `pwa/test/fixtures/drawer/recorded/<claude-version>/`.
8. The committed corpus is scanned again with `sanitize.mjs --scan`.

## Fixture JSON schema

Each recorded file is a JSON object with exactly these keys in this order:

```jsonc
{
  "scenario": "permission",          // the scenario name
  "covers": ["..."],                 // the spec §9 properties it feeds
  "claudeCode": "2.1.299",           // Claude Code version that produced the screen
  "tmux": "tmux 3.4",                // tmux version string
  "cols": 220,                       // client columns (PINNED_WINDOW_COLS)
  "rows": 51,                        // client rows (PINNED_WINDOW_ROWS + 1 status row)
  "attach": "...",                   // the raw node-pty attach byte stream
  "capture": ["...", "..."],         // 50 rows from capture-pane -p, trimmed as tmux trims
  "animatedRows": [0, 7]             // 0-based row indices that differed between two captures 200 ms apart
}
```

`capture` always has exactly 50 rows. `animatedRows` is measured, never hand-listed.

## Scenario files

`scenarios/<name>.json` is both the scenario and the mock's script (`mockapi.mjs` ignores the keys it does not
know). `drive.mjs --check` refuses any key outside this list:

```jsonc
{
  "name": "permission",        // the file's own name
  "covers": ["..."],           // the spec §9 properties the recording feeds
  "model": "claude-sonnet-4-5",// optional: passed to Claude Code as --model (see the effort hint below)
  "prompt": "...",             // typed into the box, then Enter
  "marker": "...",             // text on capture-pane -p that says the screen is reached
  "keys": ["Space", "Down"],   // optional: tmux key names sent after the marker
  "paste": ["line 1", "line 2"], // optional: typed through the attach client as the field frames it, after the attach
  "entries": [ ... ],          // the mock's script; every entry matches "tools" (see below)
  "default": { ... }           // optional: the mock's fallback
}
```

## Fail-closed scan and copy

`record.sh` runs `server/test/delegation-rig/sanitize.mjs --scan <raw-root>`
before any file is copied. If the scanner finds residue (a path outside `/rig`, a
host other than `127.0.0.1`, the running user's name, etc.) it exits 1 and the
run is refused whole: nothing enters the tree. Fix the scenario or the seeding
and re-record.

After a clean raw scan, only the selected scenario files are copied into
`pwa/test/fixtures/drawer/recorded/<claude-version>/`; files already there are
left untouched. The committed corpus is then scanned again with the same
scanner.

## Residue review

Before committing recorded fixtures, read every byte under
`pwa/test/fixtures/drawer/recorded/`. The scanner cannot see a clock or a name
that is not the scanning user's, so look especially for:

- absolute paths outside `/rig`, `/usr`, `/bin` or `/dev/null`;
- hostnames or IP addresses other than `127.0.0.1`;
- real clocks, people's names, emails, or account names;
- `sk-ant-` API key material (the recorded key is a placeholder, but verify).

## What the rig had to learn (measured on Claude Code 2.1.299, tmux 3.4)

- **The alternate screen comes from the fullscreen renderer.** A seeded config gets the classic main-screen
  renderer; the fleet's panes are on the alternate screen (spec W1), so the seeded `settings.json` carries
  `"tui": "fullscreen"`, and `drive.mjs` refuses a pane whose `#{alternate_on}` is not `1`.
- **An auto-mode dialog opens first** unless `.claude.json` carries `hasSeenAutoDefaultNudge: true`.
- **The interactive loop's request is classified `sub` by `mockapi.mjs`**, not `main`, so every scenario entry
  matches `"tools"`.
- **Claude Code prints the wall clock** (`done 2:49 PM`). The pane runs under libfaketime from
  `2026-01-01 12:00:00` UTC, so the screen reads `done 12:00 PM` and no real clock is recorded.
- **tmux sends `_` for every non-ASCII cell to a client whose locale is not UTF-8**, so the attach client's env
  names `C.UTF-8`.
- **tmux's default `status-right` draws the pane title, a clock and a date.** Both sides of the status line are
  neutral literals (`[cc-demo] ` and nothing), set in the invocation that creates the session.
- **apt runs as root with its lists on tmpfs**: on a docker VM whose disk was full for unprivileged writers, the
  `_apt` sandbox user could not write its downloads. Everything the rig user writes is on tmpfs or the cache.
- **The effort hint reads as a path to the scanner.** For a model with effort levels, a screen that shows the
  input box carries a right-aligned `◐ medium · /effort`, and `sanitize.mjs --scan` reads ` /effort` as an
  absolute path outside `/rig`: it refused three of the six recordings whole. Those three scenarios (`busy`,
  `markdown-table-code`, `reply-done`) name `"model": "claude-sonnet-4-5"`, for which Claude Code shows no effort
  hint; `drive.mjs` passes it as `--model`. The dialog scenarios keep the default model, because their dialog
  covers the box and, on claude-sonnet-4-5, the Bash prompt loses its "switch to auto mode" option. The
  right-aligned shape is covered by the hand-built synthetic screens.
- **A multi-select row toggles to `[✔]`**, not `[x]` (where the hand-built synthetic screens differ, the recorded
  pair wins).

## Adding a new Claude Code version

Record a new version into a new version directory:

```
bash server/test/drawer-rig/record.sh --cc-version X.Y.Z
```

This writes `pwa/test/fixtures/drawer/recorded/X.Y.Z/*.json` and scans the whole
corpus. Do not overwrite an existing version directory by hand.
