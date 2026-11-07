# A session's PATH holds `~/.local/bin`

Fleet sessions run with no `~/.local/bin` on `PATH` on most accounts, so a bare `ccrc`, `ccd`, `ccrc-api` or
`graphify` fails in them. A pane's `PATH` is the tmux server's, which a supervised session inherits from the service
manager. A wrapper cannot set it (`_wrap_parse_shape` refuses the shape), and `~/.bashrc` cannot, because Claude Code
writes the process `PATH` as the last line of its shell snapshot.

- **D-8050 (2026-11-06)** — ccd gives every session `~/.local/bin` at its two launch lines. `SESSION_PANE_PATH`, one
  definition, is a `/bin/sh -c` word between `exec env`'s variables and the wrapper, ending in `exec "$@"`, so no
  process stays between the pane and the wrapper. It is one single-quoted word because the pane's shell is whatever
  tmux has as its default, and a fish pane rejects a whole `-c` string for one `case` in it. `$HOME` and `$PATH` stay
  literal for that `/bin/sh`, so it names no machine. The folder goes last, so a tool the box already resolves keeps
  answering and the folder only adds names. A `PATH` that already holds the folder is left as it was. Both lines sit
  in `_spawn_start`, which every account kind reaches through its wrapper: upstream, generated and codex.

## What this switches on

- The heavy-test arm of `session-hook.sh` is gated on `command -v ccrc`, so it was off in sessions without the folder.
  A restarted session now meets it: a heavy test or typecheck started outside `ccrc test` is denied on a fleet box, and
  a `systemd-run` of one's own around a test is denied everywhere. `ccrc test` then runs it in the test slice, behind
  the fleet-wide heavy queue.
- That arm reads a heredoc body as commands, so a heredoc whose body has a line that reads as a heavy command is
  denied too, such as a pull request body listing `npm run typecheck`, or a `node` heredoc that mentions a test program.

## Known limits

- A running session keeps its old `PATH` until it restarts.
- A fish pane on Linux still starts nothing, with or without this step: the tool-child's `${...-}` on that line is not
  fish syntax (`fish -c 'exec env A="${X-}" true'` exits 127, fish 4.9.3). That line is not changed here. The Darwin
  line runs under fish.
- CI has no fish binary, so the fish row skips there. `ccd-session-path.test.ts` also pins, on every box, that no shell
  grammar of this kind stands outside single quotes on the Darwin line.
- An account whose `settings.json` sets `env.PATH` keeps that value, because Claude Code applies it over the launch
  `PATH`.
- `doctor`'s `graphify-path` check still names `ccrc install` as the remedy when it runs from a session that has not
  restarted. A restart is what fixes that session.
- Comments in `ccd/session-hook.sh` and `ccd/ccrc-codex` still say sessions never get the folder. Both are rules
  files, which a PR may not change beside anything else, so they are corrected in a rules-only PR once this lands.
