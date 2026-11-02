// The fixture the sign-in suites share (accounts plan Task A20; D-5514, D-5515, D-7750): `ccrc-account-auth-start`,
// `ccd-account-auth-private-socket`, `ccrc-account-method-switch`, `ccrc-account-reauth` and the canary's private-socket
// case. It is `laneStateFixture.ts`'s box (HOME is a throwaway directory, `ccrc` runs out of `<home>/ccrc/ccd/ccrc`)
// with the four things a sign-in reaches planted as stand-ins, each recording what it was asked:
//   - `systemd-run`: a transient unit is a DETACHED process in a process group of its own (a `--scope` runs in the
//     foreground, in the caller's group, as the real one does), recorded under `<home>/fake-units/<unit>.pid`;
//   - `systemctl --user stop <unit>`: TERMs that unit's process group and waits for it; `show-environment` is the
//     manager probe. Both managers REFUSE as the real ones do when no user bus can be found (no `XDG_RUNTIME_DIR`),
//     record the bus each call was given to `<home>/bus-calls`, and answer as an unreachable manager while
//     `<home>/manager-down` exists;
//   - `tmux`: each `-L <socket>` is a directory under `<home>/fake-tmux/`; a session is a detached process group whose
//     output is that socket's SCROLLBACK file, which outlives `kill-server` the way a capture taken before it would;
//   - `script`: the pty vehicle, which runs the command it is handed, for both argument orders.
// The upstream `claude` is a stub too: `setup-token` and `auth login` print a sign-in URL, ask for a code on stdin
// and answer from fixture files; `-p` is the probe, answering by the credential it was given; `auth logout` records
// its config dir. NOTHING here reaches a real manager, tmux server, network or `claude`, and no value is real-shaped.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ghContainedEnv } from './ccdWsHelpers.js';
import { BASH, REPO, ccrcIn, laneBox } from './laneStateFixture.js';
import { assertManagerStandIns, MANAGER_STANDIN_MARK } from './codexLaneFixture.js';

/** The upstream lane, a token lane and a sign-in lane, in the plan's lane vocabulary. */
export const AUTH_ROSTER = {
  version: 1,
  accounts: [
    { id: 'claude', label: 'team·max', configDirSuffix: '.claude', exec: { kind: 'upstream' },
      homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
    { id: 'lane-b', label: 'lane·b', configDirSuffix: '.claude-lane-b',
      exec: { kind: 'generated', secretsFile: '.cc-secrets/lane-b-oauth.env' },
      homeAble: true, hue: 'violet', telemetry: 'anthropic' },
    { id: 'lane-s', label: 'lane·s', configDirSuffix: '.claude-lane-s', exec: { kind: 'generated' },
      homeAble: true, hue: 'amber', telemetry: 'anthropic' },
  ],
};

/** An attempt id, the server's 32 lowercase hex characters. */
export const ATTEMPT = '0123456789abcdef0123456789abcdef';
export const OTHER_ATTEMPT = 'fedcba9876543210fedcba9876543210';

/** Credentials the probe stub tells apart by their first word; none is real-shaped. */
export const GOOD_TOKEN = 'GOOD-a20-minted-not-a-real-token';
export const GOOD_OLD_TOKEN = 'GOOD-a20-old-token-not-a-real-one';
export const REFUSED_TOKEN = 'NOPE-a20-minted-not-a-real-token';
export const GOOD_SIGN_IN = 'GOOD-a20-sign-in-credential';
export const OLD_SIGN_IN = 'GOOD-a20-old-sign-in-credential';
export const REFUSED_SIGN_IN = 'NOPE-a20-sign-in-credential';
/** The one-time code the operator pastes: a canary that must reach no argv, file or stream but the child's stdin. */
export const CODE = 'CODECANARY-a20-1234567890abcdefgh#xyz';

export const reg = (home: string): string => join(home, '.cc-sessions');
export const statusPath = (home: string, id: string): string => join(reg(home), '.auth', `${id}.json`);
export const scratchOf = (home: string, id: string): string => join(home, '.ccrc', 'auth-scratch', id);
export const tokenFile = (home: string, id: string): string => join(home, '.cc-secrets', `${id}-oauth.env`);
export const credFile = (home: string, suffix: string): string => join(home, suffix, '.credentials.json');

/** The user bus, as both managers find it: none without \`XDG_RUNTIME_DIR\` (systemd's own sentence), and none while
 *  \`<home>/manager-down\` exists. Each call's pair is recorded first, so a case can read what the verb exported. */
const BUS_GUARD = `printf '%s|%s\\n' "\${XDG_RUNTIME_DIR-(unset)}" "\${DBUS_SESSION_BUS_ADDRESS-(unset)}" >> "$HOME/bus-calls"
[ -n "\${XDG_RUNTIME_DIR:-}" ] || { echo 'Failed to connect to bus: $DBUS_SESSION_BUS_ADDRESS and $XDG_RUNTIME_DIR not defined' >&2; exit 1; }
[ ! -e "$HOME/manager-down" ] || { echo 'Failed to connect to bus: No such file or directory' >&2; exit 1; }`;

const SYSTEMD_RUN = `#!/usr/bin/env bash
${MANAGER_STANDIN_MARK}
# authAttemptFixture: a transient unit is a detached process group; --scope runs in the foreground.
printf '%s\\n' "$*" >> "$HOME/systemd-run-calls"
${BUS_GUARD}
scope=0; unit=''
while [ $# -gt 0 ]; do
  case "$1" in
    --user|--collect) ;;
    --scope) scope=1 ;;
    --unit=*) unit="\${1#--unit=}" ;;
    --setenv=*) export "\${1#--setenv=}" ;;
    -p) shift ;;
    -*) ;;
    *) break ;;
  esac
  shift
done
if [ "$scope" = 1 ]; then exec "$@"; fi
mkdir -p "$HOME/fake-units"
set -m
"$@" </dev/null >/dev/null 2>"$HOME/fake-units/$unit.stderr" &
printf '%s\\n' "$!" > "$HOME/fake-units/$unit.pid"
exit 0
`;

const SYSTEMCTL = `#!/usr/bin/env bash
${MANAGER_STANDIN_MARK}
# authAttemptFixture: \`--user show-environment\` and \`--user stop <unit>[.service]\`; stop TERMs the unit's group and waits.
printf '%s\\n' "$*" >> "$HOME/systemctl-calls"
${BUS_GUARD}
[ "\${1:-}" = --user ] || exit 90
[ "\${2:-}" = show-environment ] && exit 0
[ "\${2:-}" = stop ] || exit 90
u="\${3%.service}"; f="$HOME/fake-units/$u.pid"
[ -f "$f" ] || { echo "Failed to stop $3: Unit $3 not loaded." >&2; exit 5; }
p="$(<"$f")"; rm -f "$f"
kill -TERM -- "-$p" 2>/dev/null || kill -TERM "$p" 2>/dev/null
for _ in $(seq 1 100); do kill -0 "$p" 2>/dev/null || exit 0; sleep 0.1; done
exit 0
`;

const TMUX = `#!/usr/bin/env bash
# authAttemptFixture: one directory per socket; a session is a detached process group writing that socket's scrollback.
printf '%s\\n' "$*" >> "$HOME/tmux-calls-log"
sock=default
while :; do case "\${1:-}" in -L) sock="$2"; shift 2 ;; -f) shift 2 ;; *) break ;; esac; done
d="$HOME/fake-tmux/$sock"; mkdir -p "$d"
sub="\${1:-}"; [ $# -gt 0 ] && shift
case "$sub" in
  new-session)
    name=''
    while [ $# -gt 1 ]; do case "$1" in -s) name="$2"; shift 2 ;; -x|-y) shift 2 ;; -d) shift ;; *) break ;; esac; done
    if [ -f "$d/$name.pid" ] && kill -0 "$(<"$d/$name.pid")" 2>/dev/null; then echo "duplicate session: $name" >&2; exit 1; fi
    set -m
    bash -c "$1" </dev/null >>"$d/scrollback" 2>&1 &
    printf '%s\\n' "$!" > "$d/$name.pid"
    exit 0 ;;
  has-session)
    t="\${2#=}"; t="\${t%:}"
    [ -f "$d/$t.pid" ] && kill -0 "$(<"$d/$t.pid")" 2>/dev/null ;;
  kill-session)
    t="\${2#=}"; t="\${t%:}"; [ -f "$d/$t.pid" ] || exit 1
    p="$(<"$d/$t.pid")"; rm -f "$d/$t.pid"; kill -HUP -- "-$p" 2>/dev/null; exit 0 ;;
  kill-server)
    any=1
    for f in "$d"/*.pid; do
      [ -f "$f" ] || continue
      any=0; p="$(<"$f")"; rm -f "$f"; kill -HUP -- "-$p" 2>/dev/null || kill -HUP "$p" 2>/dev/null
    done
    exit "$any" ;;
  capture-pane) cat "$d/scrollback" 2>/dev/null ;;
  list-sessions) ls "$d"/*.pid >/dev/null 2>&1 ;;
  *) exit 0 ;;
esac
`;

/** The pty vehicle: util-linux's \`-qfc <cmd> /dev/null\` and BSD's \`-q /dev/null <cmd…>\`, each run as given. */
const SCRIPT = `#!/usr/bin/env bash
if [ "\${1:-}" = -qfc ]; then exec bash -c "$2"; fi
[ "\${1:-}" = -q ] && shift 2
exec "$@"
`;

/** The upstream \`claude\`. Records each call's first words, its config dir and whether a token was in its environment,
 *  never a credential or a code. */
const UPSTREAM = `#!/usr/bin/env bash
printf '%s %s|%s|%s\\n' "\${1:-}" "\${2:-}" "\${CLAUDE_CONFIG_DIR:-}" "$( [ -n "\${CLAUDE_CODE_OAUTH_TOKEN:-}" ] && echo token || echo none)" >> "$HOME/upstream-calls"
ask() {
  [ -f "$HOME/slow-prompt" ] && sleep "$(<"$HOME/slow-prompt")"
  echo "Visit: https://claude.com/cai/oauth/authorize?code=true&client_id=fixture&state=fixture-state"
  printf 'Paste code here > '
  IFS= read -r code || exit 3
  [ -n "$code" ] || exit 3
  [ -f "$HOME/hang-after-code" ] && sleep 120
  case "$code" in BAD*) echo "OAuth error: that code was not accepted"; exit 1 ;; esac
  code=''
}
case "\${1:-}" in
  setup-token)
    echo "Create a long-lived token for Claude Code."
    ask
    IFS= read -r tok < "$HOME/mint-token"
    echo "export CLAUDE_CODE_OAUTH_TOKEN=$tok"
    echo "This token expires in 1 year."
    exit 0 ;;
  auth)
    case "\${2:-}" in
      login) ask; mkdir -p "$CLAUDE_CONFIG_DIR"; cp "$HOME/signin-credential" "$CLAUDE_CONFIG_DIR/.credentials.json"; exit 0 ;;
      logout) printf '%s\\n' "$CLAUDE_CONFIG_DIR" >> "$HOME/logout-dirs"; exit 0 ;;
      status) echo '{"loggedIn":true,"authMethod":"claudeai"}'; exit 0 ;;
    esac
    exit 2 ;;
  -p)
    [ -x "$HOME/probe-hook" ] && "$HOME/probe-hook"
    if [ -n "\${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then v="$CLAUDE_CODE_OAUTH_TOKEN"
    else IFS= read -r v < "$CLAUDE_CONFIG_DIR/.credentials.json" || v=''; fi
    case "$v" in
      GOOD-*) echo '{"type":"result","subtype":"success","is_error":false,"result":"ok"}'; exit 0 ;;
      DOWN-*) echo '{"type":"result","subtype":"success","is_error":true,"terminal_reason":"api_error","api_error_status":null,"result":"API Error: Connection refused"}'; exit 1 ;;
      *) echo '{"type":"result","subtype":"success","is_error":true,"terminal_reason":"api_error","api_error_status":401,"result":"Invalid bearer token"}'; exit 1 ;;
    esac ;;
esac
exit 2
`;

/** A box carrying `laneBox`'s tree and roster, the sign-in helper and `ccrc` on its launcher paths, and every
 *  stand-in above. `mint` is what `setup-token` prints; `signIn` is the `.credentials.json` `auth login` writes. */
export function authBox(prefix: string, opts: { roster?: unknown; mint?: string; signIn?: string } = {}): string {
  const home = laneBox(prefix, opts.roster ?? AUTH_ROSTER);
  const bin = join(home, '.local', 'bin');
  // AFTER `laneBox`, whose `boxEnv` plants refusing managers: this fixture's own replace them, and no runner here
  // calls `boxEnv` again (it would put the refusers back).
  writeFileSync(join(bin, 'systemd-run'), SYSTEMD_RUN, { mode: 0o755 });
  writeFileSync(join(bin, 'systemctl'), SYSTEMCTL, { mode: 0o755 });
  writeFileSync(join(bin, 'launchctl'), `#!/bin/sh\n${MANAGER_STANDIN_MARK}\nexit 97\n`, { mode: 0o755 });
  writeFileSync(join(bin, 'tmux'), TMUX, { mode: 0o755 });
  writeFileSync(join(bin, 'claude'), UPSTREAM, { mode: 0o755 });
  writeFileSync(join(home, 'fake-script'), SCRIPT, { mode: 0o755 });
  symlinkSync(join(REPO, 'ccd', 'ccd-account-auth'), join(bin, 'ccd-account-auth'));
  writeFileSync(join(bin, 'ccrc'), `#!/bin/sh\nexec '${BASH}' '${ccrcIn(home)}' "$@"\n`, { mode: 0o755 });
  writeFileSync(join(home, 'mint-token'), `${opts.mint ?? GOOD_TOKEN}\n`, { mode: 0o600 });
  writeFileSync(join(home, 'signin-credential'), `${opts.signIn ?? GOOD_SIGN_IN}\n`, { mode: 0o600 });
  for (const s of ['.claude-lane-b', '.claude-lane-s']) mkdirSync(join(home, s), { recursive: true });
  return home;
}

/** The env every runner here spawns under: the harness's containment (gh, systemd and tmux asked for, the stand-ins
 *  above already in place), the fast knobs, and the Linux arm of both `ccrc` and the helper whatever the host. */
export function authEnv(home: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const e = ghContainedEnv(home, { ...process.env, HOME: home }, { systemd: true, tmux: true });
  for (const k of Object.keys(e)) if (k.startsWith('CCRC_')) delete e[k];
  Object.assign(e, {
    OSTYPE: 'linux-gnu', CCRC_AUTH_SCRIPT: join(home, 'fake-script'), CCRC_AUTH_TICK: '0.2', CCRC_AUTH_TIMEOUT: '30',
  }, extra);
  assertManagerStandIns(e, home);
  return e;
}

/** This host's own arm, for a verb that does not launch a sign-in (an `add`, an install, a switch): `ccrc` spells
 *  each platform's tools its own way, so a GNU spelling forced onto a Mac would refuse for a reason of the host's. */
export const HOST_OSTYPE = process.platform === 'darwin' ? 'darwin23' : 'linux-gnu';

export interface Result { code: number; stdout: string; stderr: string; ms: number }

/** `ccrc <args>` under umask 022, the argv after the program fixed (never a string built from a path). */
export function ccrcAuth(home: string, args: string[], stdin = '', extra: NodeJS.ProcessEnv = {}): Result {
  const t0 = Date.now();
  const r = spawnSync(BASH, ['-c', 'umask 022; exec "$@"', '_', BASH, ccrcIn(home), ...args],
    { env: authEnv(home, extra), encoding: 'utf8', input: stdin, timeout: 90_000 });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '', ms: Date.now() - t0 };
}

/** The env the agent's account op spawns `ccrc account` with (`agent/src/accountop.ts`): exactly HOME, PATH and LANG,
 *  plus this fixture's own knobs (the Linux arm and the pty vehicle, none of them a bus). No `XDG_RUNTIME_DIR` and no
 *  `DBUS_SESSION_BUS_ADDRESS`, so the verb must find the user manager by itself. */
export function agentSpawnEnv(home: string): NodeJS.ProcessEnv {
  const full = authEnv(home);
  const e: NodeJS.ProcessEnv = { HOME: home, PATH: full['PATH'], LANG: 'C.UTF-8' };
  for (const k of ['OSTYPE', 'CCRC_AUTH_SCRIPT', 'CCRC_AUTH_TICK', 'CCRC_AUTH_TIMEOUT']) e[k] = full[k];
  assertManagerStandIns(e, home);
  return e;
}

/** `ccrcAuth` under `agentSpawnEnv`. */
export function ccrcAuthAsAgent(home: string, args: string[]): Result {
  const t0 = Date.now();
  const r = spawnSync(BASH, ['-c', 'umask 022; exec "$@"', '_', BASH, ccrcIn(home), ...args],
    { env: agentSpawnEnv(home), encoding: 'utf8', input: '', timeout: 90_000 });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '', ms: Date.now() - t0 };
}

/** The same, in a process group of its own, so a case can kill the caller's whole group as the agent's timeout does. */
export function ccrcAuthSpawn(home: string, args: string[], extra: NodeJS.ProcessEnv = {}): ChildProcess {
  return spawn(BASH, ['-c', 'umask 022; exec "$@"', '_', BASH, ccrcIn(home), ...args],
    { env: authEnv(home, extra), detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** The one JSON object a verb prints. */
export function answerOf(r: { stdout: string; stderr: string }): Record<string, unknown> {
  const lines = r.stdout.split('\n').filter((l) => l !== '');
  if (lines.length !== 1) throw new Error(`expected one JSON line, got ${lines.length}: ${r.stdout}${r.stderr}`);
  return JSON.parse(lines[0]!) as Record<string, unknown>;
}

/** The lane's status file, or `null`. */
export function statusOf(home: string, id: string): Record<string, unknown> | null {
  try { return JSON.parse(readFileSync(statusPath(home, id), 'utf8')) as Record<string, unknown>; } catch { return null; }
}

const settle = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });

/** Polls the status file until its state is one of `want`; answers the last state seen. */
export async function waitState(home: string, id: string, want: readonly string[], ms = 30_000): Promise<string | null> {
  const until = Date.now() + ms;
  let last: string | null = null;
  while (Date.now() < until) {
    const s = statusOf(home, id);
    last = s === null ? null : String(s['state']);
    if (last !== null && want.includes(last)) return last;
    await settle(100);
  }
  return last;
}

/** Waits until no fake unit and no fake tmux session is running, bounded. */
export async function waitQuiet(home: string, ms = 30_000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (livePids(home).length === 0) return;
    await settle(100);
  }
}

/** Every recorded unit and pane pid still alive. */
export function livePids(home: string): number[] {
  const out: number[] = [];
  const dirs = [join(home, 'fake-units')];
  const tm = join(home, 'fake-tmux');
  if (existsSync(tm)) for (const s of readdirSync(tm)) dirs.push(join(tm, s));
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d).filter((n) => n.endsWith('.pid'))) {
      const pid = Number(readFileSync(join(d, f), 'utf8').trim());
      if (Number.isInteger(pid) && pid > 0 && alive(pid)) out.push(pid);
    }
  }
  return out;
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** Kills every unit and pane group this box started: each suite's `afterEach`, so no case leaves a process behind. */
export function reapAll(home: string): void {
  for (const pid of livePids(home)) {
    try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  }
}

/** Each socket's scrollback, keyed by socket name (`default` for the shared server). */
export function scrollbacks(home: string): Record<string, string> {
  const tm = join(home, 'fake-tmux');
  const out: Record<string, string> = {};
  if (!existsSync(tm)) return out;
  for (const s of readdirSync(tm)) {
    const f = join(tm, s, 'scrollback');
    out[s] = existsSync(f) ? readFileSync(f, 'utf8') : '';
  }
  return out;
}

/** Lines of a recorded call log, or `[]`. */
export function logLines(home: string, name: string): string[] {
  const f = join(home, name);
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean) : [];
}

/** A status file as an attempt's helper leaves it: what `set --method … --attempt` reads to bind the install. */
export function plantAttempt(home: string, id: string, attempt: string, state = 'exchanging'): void {
  mkdirSync(join(reg(home), '.auth'), { recursive: true, mode: 0o700 });
  writeFileSync(statusPath(home, id),
    `${JSON.stringify({ state, updatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), attemptId: attempt })}\n`,
    { mode: 0o600 });
}

/** The credential an attempt leaves in scratch, as the helper writes it. */
export function plantMinted(home: string, id: string, token: string): void {
  mkdirSync(scratchOf(home, id), { recursive: true, mode: 0o700 });
  writeFileSync(join(scratchOf(home, id), 'minted.env'), `export CLAUDE_CODE_OAUTH_TOKEN=${token}\n`, { mode: 0o600 });
}
export function plantScratchSignIn(home: string, id: string, credential: string): void {
  mkdirSync(join(scratchOf(home, id), 'config'), { recursive: true, mode: 0o700 });
  writeFileSync(join(scratchOf(home, id), 'config', '.credentials.json'), `${credential}\n`, { mode: 0o600 });
}

/** The roster as parsed JSON. */
export function rosterOf(home: string): { accounts: { id: string; exec: Record<string, unknown> }[] } {
  return JSON.parse(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8')) as { accounts: { id: string; exec: Record<string, unknown> }[] };
}

/** A probe hook: a shell snippet the upstream stub runs at every probe, before it answers. */
export function plantProbeHook(home: string, body: string): void {
  writeFileSync(join(home, 'probe-hook'), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
}
