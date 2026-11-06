# Doctor measures a session's PATH, and launches the Playwright browsers

**Goal:** doctor stops vouching for the PATH of whoever ran it. A fleet box whose sessions could not run a bare `ccrc`,
`ccd`, `ccrc-api` or `graphify` passed `path` and `graphify-path`, because `ccrc update` adds `~/.local/bin` to its own
PATH, and the remedies those checks printed (edit `~/.profile`, re-run `ccrc install`) cannot reach a session.

**This change:**

- `path` and `graphify-path` read every live session's environment, and with none running, the user manager's PATH. With
  neither, on a server box, or on Darwin with no readable proc tree, they measure `$PATH` as before, with the same lines.
- Their session arms print a root step that clears the verdict, into a directory read from the measured PATH. A test runs
  each printed step and re-runs the check.
- `path` passes a session that reaches every installed command some other way, so the box that took the step goes green.
- New check `playwright`: launches each cached browser build offline, WARN at worst.
- `README.md`, **After a box move**: a bare-command check under a session PATH.

**Not changed:** the session PATH itself. Nothing is installed. Neither `install` nor `update` writes the root step.

## Deviations found

- **D-8047 (2026-11-06)** — `doctor-session-path`: three findings from building this.
  1. A pane gets the PATH of the tmux client that ran `new-session`, not the server's: measured on an isolated socket,
     tmux 3.7, two clients on two PATHs gave two panes those PATHs while `show-environment -g` named only the first. So
     `show-environment` is the wrong source, sessions on one server can differ, and the header of `ccd/ccrc-codex`, which
     says a pane has the tmux server's PATH, is true only of the spawn that also started the server.
  2. `graphify-path` keeps its FAIL class, now on the session's PATH. A box whose sessions lack `graphify` therefore turns
     that doctor line red until the root step is taken, and under `ccrc update` that is D-3114's exit 3: the box moved, no
     revert, and a rollout relays it and goes on.
  3. A lane's `settings.json` `env` block is applied inside Claude Code and does not show in the process environment, so
     a lane that sets PATH there reads as lacking. Doctor can only over-report here. Which revisions a run will ask for is
     pinned by each project's Playwright package, so `playwright` lists what is cached and cannot compare the two.
