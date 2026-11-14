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
 *   - the NAME is created already sanitised (`.` and `:` become `_`: tmux 3.4
 *     rewrites them itself, tmux 3.7c keeps them), so the target is exact on any
 *     tmux version — an unsanitised anchor would answer `can't find session` for
 *     a LIVE session, i.e. `gone`.
 * A missing session answers `can't find session: cc-x` under this form for
 * every command the adapter runs — the one message the classifiers read as
 * death.
 */
export function tmuxName(id: string): string {
  return `cc-${id}`.replace(/[.:]/g, '_');
}

export function tmuxTarget(id: string): string {
  return `=${tmuxName(id)}:`;
}

/**
 * D-8270 (the session host research's §6.1 ruling on Q8): THE ONE tmux SOCKET LOOKUP. The fleet keeps ONE shared tmux
 * server for now, and every tmux call is routed through this lookup so that a later split (a server per session or
 * per project) is a change of setting, not a hunt through the call sites. `ccd/ccd`'s `_tmx_sock` / `_tmx_argv` /
 * `_tmx` are the bash twins and read the SAME setting, the first line of `<home>/.ccrc/tmux-socket`:
 *   - absent, or an empty first line: tmux's own default server, and the argv is exactly what it was before this
 *     lookup existed (no flag is added);
 *   - a socket name (`TMUX_SOCKET_NAME_RE`): `-L <name>` leads every call;
 *   - anything else (unreadable, not a regular file, not a name): tmux is NOT asked. The command becomes a `sh` that
 *     prints why and exits 1, so every caller reads "could not ask", never the "can't find session" that means gone:
 *     a wrong socket would read every live pane as gone, which is exactly what reclaim and the account counts must
 *     never be shown.
 * A file and not an environment variable: every process on the box (the supervisors, the agent, the timers, an
 * operator's shell, a session's hook) reads the same answer, and no caller can point a door at a server of its own
 * making by setting a variable (`_am_who` reads the file under the password database's home).
 */
export const TMUX_SOCKET_FILE = '.ccrc/tmux-socket';
export const TMUX_SOCKET_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/;

/** What a reader found at `<home>/.ccrc/tmux-socket`. */
export type TmuxSocketSetting =
  | { readonly kind: 'absent' }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'unreadable'; readonly why: string };

/** The three file-system calls the reader needs, handed in so this file imports nothing (L0). */
export interface TmuxSocketFs {
  lstatSync(p: string): unknown;
  statSync(p: string): { isFile(): boolean };
  readFileSync(p: string, encoding: 'utf8'): string;
}

export function tmuxSocketPath(home: string): string {
  return `${home.replace(/\/+$/, '')}/${TMUX_SOCKET_FILE}`;
}

/** The bash twin's reading, call for call: absent when nothing (not even a dangling link) is there; otherwise it must
 *  be a regular file that reads, and only its first line counts. */
export function readTmuxSocketSetting(home: string, fs: TmuxSocketFs): TmuxSocketSetting {
  const p = tmuxSocketPath(home);
  try { fs.lstatSync(p); } catch { return { kind: 'absent' }; }
  try {
    if (!fs.statSync(p).isFile()) return { kind: 'unreadable', why: `${p} cannot be read` };
    return { kind: 'text', text: fs.readFileSync(p, 'utf8').split('\n')[0]! };
  } catch {
    return { kind: 'unreadable', why: `${p} cannot be read` };
  }
}

/** The socket a setting names: `''` is tmux's default server. */
export function tmuxSocketOf(s: TmuxSocketSetting): { ok: true; name: string } | { ok: false; why: string } {
  if (s.kind === 'absent') return { ok: true, name: '' };
  if (s.kind === 'unreadable') return { ok: false, why: s.why };
  if (s.text === '' || TMUX_SOCKET_NAME_RE.test(s.text)) return { ok: true, name: s.text };
  return { ok: false, why: `${TMUX_SOCKET_FILE} does not hold a socket name (1 to 64 letters, digits, _ and -, not led by -)` };
}

export interface TmuxCommand { readonly file: string; readonly args: readonly string[] }

/** The refusal's program: `$0` is the sentence, the tmux argv after it is ignored. The bash twin runs the same one. */
export const TMUX_REFUSE_SH = 'printf "%s\\n" "$0" >&2; exit 1';

/** EVERY tmux spawn's command: the file and argv to run for `tmux <args…>` on the fleet's server. */
export function tmuxCommand(setting: TmuxSocketSetting, args: readonly string[]): TmuxCommand {
  const sock = tmuxSocketOf(setting);
  if (!sock.ok) return { file: 'sh', args: ['-c', TMUX_REFUSE_SH, `ccrc: tmux was not asked: ${sock.why}`, ...args] };
  return { file: 'tmux', args: sock.name === '' ? [...args] : ['-L', sock.name, ...args] };
}

/** A generic executor's form: `cmd` is routed through `tmuxCommand` when it is tmux, and passes untouched (the
 *  setting unread) when it is anything else. */
export function tmuxRoute(cmd: string, args: readonly string[], setting: () => TmuxSocketSetting): TmuxCommand {
  return cmd === 'tmux' ? tmuxCommand(setting(), args) : { file: cmd, args: [...args] };
}
