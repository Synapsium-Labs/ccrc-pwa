# Every tmux call goes through one socket lookup

## Goal

The operator's ruling on Q8 of the session host research (`docs/superpowers/specs/2026-11-09-session-host-research.md`
§6.1): keep ONE shared tmux server for now, and route every tmux call through one socket lookup, with a CI guard
against new raw calls, so that a later split (a server per session or per project) is a change of setting rather than
a hunt through the call sites. Behaviour with the default setting is unchanged: no flag is added to any argv.

## What was read first

- There was no socket helper to extend. `_tmux` / `_tmux_t` / `_tmux_at` (`ccd/ccd`) and `tmuxName` / `tmuxTarget`
  (`shared/tmux-target.ts`) spell a session's NAME and TARGET; every call reached tmux's default server implicitly
  (`$TMUX` inside a pane, `/tmp/tmux-<uid>/default` outside one).
- ccd/ccd ran 110 tmux calls, five of them through a wrapper that execs its argv (`_plat_timeout`, `exec`), where a
  shell function cannot stand in. Outside it: `ccrc` (one, plus three on the auth lane's private servers), the
  doctor's checks (three), the session hook, the status line, the keepalive, the scope sweep and `ccrc-api` (one each),
  and `ccd-account-auth` (private servers only).
- TypeScript spawns tmux in four places: the server's `realRunner` (the local `Tmux` adapter's runner), the server's
  local drawer (`attachPty`), the agent's whitelisted exec and the agent's drawer (`spawnFleetPty`). The `Tmux`
  adapter's `this.run('tmux', …)` calls are requests to a runner, and in remote mode the agent's whitelist judges
  their argv by its first token, so the lookup applies where the process is spawned, after the whitelist.
- `_am_who` (the account door) asks the default socket by PATH (`-S /tmp/tmux-<uid>/default`) on purpose: `$TMUX` and
  `$TMUX_TMPDIR` are set by the caller. An environment variable as the setting would hand the caller the same lever.

## Deviations found

- **D-8270 (2026-11-11)** — tmux-one-socket-lookup: every tmux call goes through one socket lookup, `_tmx_sock` /
  `_tmx_argv` / `_tmx` in bash (one block in `ccd/ccd`, copied byte for byte into each script that cannot source it)
  and `tmuxCommand` / `tmuxRoute` in `shared/tmux-target.ts`. Both read the first line of `~/.ccrc/tmux-socket`:
  absent or empty is tmux's default server and adds nothing; a socket name puts `-L <name>` first; anything else asks
  no tmux and answers why with exit 1, never the "can't find session" that reads as gone. The setting is a FILE, not
  an environment variable, so every process on a box (supervisors, agent, timers, an operator's shell, a pane's hook)
  reads one answer and no caller can redirect a door; the account door reads it under the password database's home.
  `tmux-socket-census.test.ts` fails on any raw `tmux` call in bash under `ccd/` and `deploy/`, and any spawn of the
  literal 'tmux' in TypeScript or JavaScript, outside the lookup and its named exceptions: the auth lane's private
  `-L ccrc-auth-<id>` servers, the account door's socket path, `tmux -V` probes, and the history tool's two pane
  questions (`ccd/history/cli.mjs`, `sweep.mjs`), which ask the calling pane's own server through `$TMUX` and cannot
  import the TypeScript lookup. Nothing writes the setting today and no console control sets it: the split that first
  writes it owns that control, its migration (a server change restarts every pane) and routing the history tool.

## Tasks

- [x] T1. Test first, red: `tmux-socket.test.ts` pins the TypeScript lookup and the server's two spawns; the agent's
  exec and drawer tests pin theirs. Then `tmuxCommand` / `tmuxRoute` / `readTmuxSocketSetting` in
  `shared/tmux-target.ts`, routed in `realRunner`, `attachPty`, the agent's exec (after the whitelist) and
  `spawnFleetPty`.
- [x] T2. The bash lookup block in `ccd/ccd`; every ccd/ccd call routed (`_tmx …` as a statement, or
  `"${_TMX_ARGV[@]}" …` in a capture, a pipeline stage or where a wrapper execs the argv); `_am_who` builds its socket
  path from `_tmx_sock "$AM_HOME"`. Suites that pinned a call's spelling in the source follow it; the calls tmux
  receives are unchanged.
- [x] T2b. Fork-free on the hot path: the block reads the setting ONCE per process, at load, into `_TMX_ARGV`, with
  builtins only, and no capture or pipeline stage calls the `_tmx` function (it would cost a fork per call: +5 a
  tick on `idle-home`). `ccd-tick-budget.test.ts`'s TICK_BUDGET is main's, unchanged. The three functions are
  C10 Session host rows in `ccd/contexts.tsv` (the host's one tmux lookup, the file-split plan's Task 7 table), and
  the 26 calls into them from C1 to C4 are lines in `ccd/contexts-edges.tsv`.
- [x] T3. The block copied into `ccrc`, the session hook, the status line, the keepalive, the scope sweep and
  `ccrc-api`, and their calls routed; `tmux-socket-census.test.ts`, with fixtures that add a raw call and a run that
  moves every call by changing the setting.
