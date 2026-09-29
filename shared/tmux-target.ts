/**
 * THE ONE TYPESCRIPT SPELLING OF A tmux SESSION, AS A NAME AND AS A TARGET
 * (D-3525). L0: imports nothing — the server's `Tmux` adapter, its drawer
 * attach and the agent's drawer attach all build their argv from here, and
 * `ccd/ccd`'s `_tmux` / `_tmux_t` / `_tmux_at` are the bash twins.
 *
 * A NAME AND A TARGET ARE TWO DIFFERENT THINGS. `tmuxName` is what a session
 * is CALLED — what `new-session -s` creates. A `-t` argument is not a name to
 * tmux, it is a SEARCH: the exact name, then a unique PREFIX of a name, then an
 * fnmatch pattern, and for a window- or pane-type command with no colon, first
 * a WINDOW NAME in the most recently used session. Measured on tmux 3.4: with
 * `cc-x` gone and `cc-x-2` live, a bare `-t cc-x` reads, types into, resizes,
 * attaches to and kills `cc-x-2`.
 *
 * `tmuxTarget` is the exact form, and all three of its parts are load-bearing:
 *   - `=` refuses the prefix and pattern matches;
 *   - `:` makes it "the current window of exactly this session" — without it,
 *     `list-panes`/`resize-window` still prefix-match and `capture-pane`,
 *     `send-keys` and `display-message` FAIL on a session that exists;
 *   - `.` and `:` become `_`, because tmux rewrites them that way in a session
 *     NAME (`-s cc-w-my.site` creates `cc-w-my_site`) — anchoring the unrewritten
 *     name answers `can't find session` for a LIVE session, i.e. `gone`.
 * A missing session answers `can't find session: cc-x` under this form for
 * every command the adapter runs — the one message the classifiers read as
 * death.
 */
export function tmuxName(id: string): string {
  return `cc-${id}`;
}

export function tmuxTarget(id: string): string {
  return `=${tmuxName(id).replace(/[.:]/g, '_')}:`;
}
