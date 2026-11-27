// `ccrc auth on|off` — the console's sign-in for a box used at localhost (desktop polish wave 181, D-9105).
//
// What this file owns: every refusal (each leaves ccrc.env byte for byte as it was and restarts nothing), the write's
// exactness, idempotence, the restart and its proof, the restore on a failed proof, `off`, the usage line, and the
// agreement between what the verb writes and what the SERVER reads from it.
//
// ── HOW THE FIXTURE CONTAINS IT ───────────────────────────────────────────
//  1. HOME is a throwaway `mkTmp` directory. The verb writes `$HOME/.ccrc/ccrc.env` and restarts `ccrc.service`; on the
//     box this suite runs on both are live, so neither is ever reached: HOME is the fixture's and every service manager
//     is a stub.
//  2. `ccrc` is a symlink at `<home>/ccrc/ccd/ccrc` and the hasher a COPY beside it, with a compiled reader built from
//     this checkout (`authFixtures.ts`), as the passwd suite plants them.
//  3. `ccrcContainedEnv` with the loopback curl: the real curl, reaching only `127.0.0.1:<port>` for a port this file
//     lists. The port is a small HTTP server in THIS process that plays the console: it answers `/health` and
//     `/api/auth/status` from `<home>/server-state`.
//  4. `systemctl` is a recording stub. On `restart ccrc.service` it plays the server reading its env file: the next line
//     of `<home>/restart-plan` if any (`dead`, `off`), else `armed` when ccrc.env holds `CCRC_AUTH=on`, else `off`.
//  5. The verb is the operator's, so every run that should get past the guards runs on a pty (node-pty), with
//     CLAUDECODE, TMUX and TMUX_PANE removed from its environment: this suite itself may run inside a session.
//  6. The installed unit is what the installer lands, never a stand-in: this checkout's deploy/ccrc.service, copied to
//     `<home>/ccrc/deploy/` and to the user unit directory unchanged (review 3971 R1). The end-to-end cases run on
//     Linux only; the function-level ones (a Mac's refusal and the helper, the signal handler) run everywhere (review
//     3971 R3).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pty from 'node-pty';
import { mkTmp } from './tmpHelpers.js';
import { ccrcContainedEnv } from './ccrcContainment.js';
import { loopbackCurlFront } from './containedTools.js';
import { fixtureSecretLine, plantAuthHelper, plantAuthModule } from './authFixtures.js';
import { seedRoster } from './helpers.js';
import { loadConfig } from '../src/config.js';
import { cookiePolicyProblem } from '../src/auth/cookie.js';
import { relyingPartyProblem } from '../src/auth/webauthn.js';
import { accountOriginClass } from '../src/accounts/gate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const CCRC_SRC = join(REPO, 'ccd', 'ccrc');
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();
/** The unit the installer lands: the tree's own file, copied unchanged (`_inst_units`, deploy.sh). */
const SHIPPED_UNIT_SRC = join(REPO, 'deploy', 'ccrc.service');
const SHIPPED_UNIT = readFileSync(SHIPPED_UNIT_SRC, 'latin1');
/** Wave 193: the end-to-end cases run on both platforms. On Linux the box is a systemd user unit and a systemctl stub; on
 *  a Mac it is the launchd job the installer's writer prints and a launchctl stub. A describe made with `onEach` runs
 *  once per platform this box can run: on a Mac, darwin with the real BSD tools; on Linux, linux and a SIMULATED darwin,
 *  where `ccrc` is sourced and `CCD_OS=darwin` (and the unit directory it fixes at load) set after, as the suite's other
 *  darwin harnesses do. What a simulated darwin cannot run is the task note's list: `_plat_mode`'s darwin arm (BSD
 *  `stat -f`, here a shim that answers GNU's `%a` in its shape), BSD `cp`, `mv`, `chmod` and `awk`, and /bin/bash 3.2
 *  sourcing the env files. Describes that read systemd's own answers stay Linux only. */
const IS_DARWIN = process.platform === 'darwin';
type Plat = 'linux' | 'darwin';
const HOST_PLAT: Plat = IS_DARWIN ? 'darwin' : 'linux';
let PLAT: Plat = HOST_PLAT;
const simulated = (): boolean => PLAT === 'darwin' && !IS_DARWIN;
const PLATFORMS: Plat[] = IS_DARWIN ? ['darwin'] : ['linux', 'darwin'];
/** One describe per platform; `body` gets the platform for collection-time choices (`it.skipIf`). */
function onEach(title: string, body: (p: Plat) => void): void {
  for (const p of PLATFORMS) {
    describe(`${title} [${p === 'darwin' && !IS_DARWIN ? 'darwin, simulated' : p}]`, () => {
      beforeAll(() => { PLAT = p; });
      afterAll(() => { PLAT = HOST_PLAT; });
      body(p);
    });
  }
}
const MAC_LABEL = 'app.ccrc.ccrc';
const macJobFile = (h: string): string => join(h, 'Library', 'LaunchAgents', `${MAC_LABEL}.plist`);
/** The PATH a Mac install wrote into the fixture's job: the writer's own appends, fixed so every row knows it. */
const JOB_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
/** The file the verb finds installed: the unit on Linux, the job on a Mac. */
const installedFile = (h: string): string =>
  (PLAT === 'darwin' ? macJobFile(h) : join(h, '.config', 'systemd', 'user', 'ccrc.service'));

const ccrcIn = (home: string): string => join(home, 'ccrc', 'ccd', 'ccrc');
const envFile = (home: string): string => join(home, '.ccrc', 'ccrc.env');
/** One restart of the console's service, as the cases count them; on a Mac each `kickstart -k` of its job is one. */
const RESTART = '--user restart ccrc.service';
const restarts = (home: string): string[] => {
  const [f, re] = PLAT === 'darwin'
    ? [join(home, 'launchctl-argv'), /^kickstart -k /] : [join(home, 'systemctl-argv'), /^--user restart /];
  const kick = `kickstart -k gui/${process.getuid?.() ?? 0}/${MAC_LABEL}`;
  return (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter((l) => re.test(l)) : [])
    .map((l) => (PLAT === 'darwin' && l === kick ? RESTART : l));
};
const bytes = (p: string): string | null => (existsSync(p) ? readFileSync(p, 'latin1') : null);
/** A directory of links to every command of the real PATH but `name`, so nothing else a run needs goes missing. */
function pathWithout(home: string, name: string): string {
  const bin = join(home, `path-without-${name}`);
  mkdirSync(bin);
  for (const d of (process.env['PATH'] ?? '').split(':').filter((x) => x && existsSync(x))) {
    for (const f of readdirSync(d)) {
      if (f === name || existsSync(join(bin, f))) continue;
      try { symlinkSync(join(d, f), join(bin, f)); } catch { /* a name two directories share: the first wins */ }
    }
  }
  return bin;
}

// ── the console, played by this process ────────────────────────────────────
let server: http.Server;
let PORT = 0;
const homes = new Set<string>();
beforeAll(async () => {
  server = http.createServer((req, res) => {
    // Every fixture home writes its own state; the request names none, so the one home whose ccrc.env names this
    // server's port and was last restarted answers. One test at a time touches the server (the file runs serially).
    const home = [...homes].find((h) => existsSync(join(h, 'server-state')));
    const state = home ? readFileSync(join(home, 'server-state'), 'utf8').trim() : 'down';
    if (state === 'down') { req.socket.destroy(); return; }
    res.setHeader('content-type', 'application/json');
    if (req.url === '/health') { res.end(JSON.stringify({ ok: true, version: 'v9.8.7' })); return; }
    if (req.url === '/api/auth/status') {
      res.end(JSON.stringify({ authed: false, passkeysEnrolled: 0, mode: state === 'armed' ? 'passphrase' : 'off' }));
      return;
    }
    res.statusCode = 404; res.end('{}');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  PORT = (server.address() as AddressInfo).port;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

/** The restart, as either stub plays it: the server reading its env file. */
const RESTART_ARM = [
  '    plan="$HOME/restart-plan"; next=""',
  '    if [ -s "$plan" ]; then next=$(head -n 1 "$plan"); tail -n +2 "$plan" > "$plan.n"; /bin/mv "$plan.n" "$plan"; fi',
  '    [ "$next" != fail ] || exit 1',
  '    if [ -z "$next" ]; then',
  '      if grep -qx "CCRC_AUTH=on" "$HOME/.ccrc/ccrc.env" 2>/dev/null; then next=armed; else next=off; fi',
  '    fi',
  '    printf \'%s\\n\' "$next" > "$HOME/server-state"; exit 0 ;;',
];
const SYSTEMCTL_STUB = [
  '#!/bin/sh',
  'printf \'%s\\n\' "$*" >> "$HOME/systemctl-argv"',
  'case "$*" in',
  '  "--user restart ccrc.service")',
  ...RESTART_ARM,
  // `systemctl --user show ccrc.service -p …`: one line per property asked, in systemd's own order and not the order
  // asked (measured on systemd 259: FragmentPath, SourcePath, DropInPaths, NeedDaemonReload, then the service's
  // Environment, EnvironmentFiles, PassEnvironment), an empty one printed as `Name=`, as systemd prints a property asked
  // by name. What systemd loaded for the unit (the reach proof's other sources, review 3934 F2): the two known
  // EnvironmentFile= lines unless `<home>/sd-envfiles` replaces them, and `<home>/sd-dropins`, `<home>/sd-environment`
  // when a case plants them; `<home>/sd-show-fails` makes a read that asks DropInPaths fail, and the manager's own
  // environment too. Which file systemd loaded and whether as it is now (review 3971 R1, wave 190 F1): the user unit
  // directory's own file unless `<home>/sd-fragment` holds the whole answer (its lines, or nothing for no line), an
  // empty SourcePath unless `<home>/sd-sourcepath` holds the whole answer the same way, `<home>/sd-needreload` the
  // reload answer (no by default); `<home>/sd-needreload-fails` makes a read that asks NeedDaemonReload fail. A loaded
  // PassEnvironment is `<home>/sd-passenv` (wave 190 fix round 1, R5).
  '  "--user show ccrc.service -p "*)',
  '    want=" $* "',
  '    case "$want" in *" -p DropInPaths "*) [ ! -e "$HOME/sd-show-fails" ] || exit 1 ;; esac',
  '    case "$want" in *" -p NeedDaemonReload "*) [ ! -e "$HOME/sd-needreload-fails" ] || exit 1 ;; esac',
  '    for p in FragmentPath SourcePath DropInPaths NeedDaemonReload Environment EnvironmentFiles PassEnvironment; do',
  '      case "$want" in *" -p $p "*) ;; *) continue ;; esac',
  '      case $p in',
  '        FragmentPath) if [ -e "$HOME/sd-fragment" ]; then cat "$HOME/sd-fragment"; else',
  '          printf \'FragmentPath=%s\\n\' "$HOME/.config/systemd/user/ccrc.service"; fi ;;',
  '        SourcePath) if [ -e "$HOME/sd-sourcepath" ]; then cat "$HOME/sd-sourcepath"; else printf \'SourcePath=\\n\'; fi ;;',
  '        DropInPaths) printf \'DropInPaths=%s\\n\' "$(cat "$HOME/sd-dropins" 2>/dev/null)" ;;',
  '        NeedDaemonReload) printf \'NeedDaemonReload=%s\\n\' "$(cat "$HOME/sd-needreload" 2>/dev/null || echo no)" ;;',
  '        Environment) printf \'Environment=%s\\n\' "$(cat "$HOME/sd-environment" 2>/dev/null)" ;;',
  '        EnvironmentFiles) if [ -e "$HOME/sd-envfiles" ]; then cat "$HOME/sd-envfiles"; else',
  '          printf \'EnvironmentFiles=%s (ignore_errors=yes)\\n\' "$HOME/.ccrc/ccrc.env" "$HOME/.ccrc/exposure.env"; fi ;;',
  '        PassEnvironment) printf \'PassEnvironment=%s\\n\' "$(cat "$HOME/sd-passenv" 2>/dev/null)" ;;',
  '      esac',
  '    done; exit 0 ;;',
  '  "--user show-environment")',
  '    [ ! -e "$HOME/sd-show-fails" ] && [ ! -e "$HOME/sd-manager-env-fails" ] || exit 1',
  '    if [ -e "$HOME/sd-manager-env" ]; then cat "$HOME/sd-manager-env"; else printf \'HOME=%s\\nLANG=C.UTF-8\\n\' "$HOME"; fi',
  '    exit 0 ;;',
  '  "--user is-active ccrc.service")',
  // `<home>/sd-is-active`, when a case plants it, is the whole answer (review 4061 C5: what the manager says is held too).
  '    if [ -e "$HOME/sd-is-active" ]; then cat "$HOME/sd-is-active"; exit 3; fi',
  '    if [ "$(cat "$HOME/server-state" 2>/dev/null)" = down ]; then echo failed; exit 3; fi',
  '    echo active; exit 0 ;;',
  'esac',
  'echo "fixture systemctl: unexpected argv: $*" >&2; exit 90',
].join('\n') + '\n';

// `launchctl` on a Mac box (wave 193), the shape `_svc_launchctl` runs: a stub on PATH is not the system binary, so the
// sandbox guard lets it run. `print gui/<uid>/app.ccrc.ccrc` answers `<home>/lc-print` (the box writes what launchd
// would hold for the installed job; `@STATE@` is `running` unless the server is down), 113 when `<home>/lc-not-held`
// stands, 5 when `<home>/lc-print-fails` does. `kickstart -k` is the restart, 113 when `<home>/lc-kick-fails` or
// `lc-not-held` stands. `getenv <KEY>` answers the domain's environment from `<home>/lc-domain-env` (KEY=value lines;
// an unset key prints nothing and exits 0, the shape the macOS leg measures), 5 when `<home>/lc-getenv-fails` stands.
const LAUNCHCTL_STUB = [
  '#!/bin/sh',
  'printf \'%s\\n\' "$*" >> "$HOME/launchctl-argv"',
  'case "$1 $2" in',
  '  "print gui/"*"/app.ccrc.ccrc")',
  '    [ ! -e "$HOME/lc-not-held" ] || { echo "Could not find service \\"app.ccrc.ccrc\\" in domain" >&2; exit 113; }',
  '    [ ! -e "$HOME/lc-print-fails" ] || exit 5',
  '    st=running; [ "$(cat "$HOME/server-state" 2>/dev/null)" != down ] || st="not running"',
  '    while IFS= read -r l; do case "$l" in *@STATE@*) printf \'%s\\n\' "${l%%@STATE@*}$st" ;; *) printf \'%s\\n\' "$l" ;; esac; done < "$HOME/lc-print"',
  '    exit 0 ;;',
  '  "kickstart -k")',
  '    case "$3" in gui/*/app.ccrc.ccrc) ;; *) echo "fixture launchctl: unexpected argv: $*" >&2; exit 90 ;; esac',
  '    [ ! -e "$HOME/lc-not-held" ] && [ ! -e "$HOME/lc-kick-fails" ] || exit 113',
  ...RESTART_ARM,
  '  "getenv "*)',
  '    [ ! -e "$HOME/lc-getenv-fails" ] || exit 5',
  '    v=$(grep "^$2=" "$HOME/lc-domain-env" 2>/dev/null | head -n 1); [ -z "$v" ] || printf \'%s\\n\' "${v#*=}"; exit 0 ;;',
  'esac',
  'echo "fixture launchctl: unexpected argv: $*" >&2; exit 90',
].join('\n') + '\n';
/** A simulated darwin's BSD `stat -f%Mp%Lp` (`_plat_mode`), answered from GNU's `%a` in BSD's padded shape; every other
 *  form passes through. */
const STAT_SHIM = (real: string): string => '#!/bin/sh\n'
  + `if [ "$1" = -f%Mp%Lp ]; then shift; exec ${real} -c 0%a "$@"; fi\nexec ${real} "$@"\n`;
const REAL_STAT = spawnSync('/bin/sh', ['-c', 'command -v stat'], { encoding: 'utf8' }).stdout.trim() || '/usr/bin/stat';

/** The installed job: the real writer's bytes for this home, through a bash that sourced ccrc with darwin set. */
function writeJob(home: string, jobPath = JOB_PATH, cls = 'Background'): string {
  const r = spawnSync(BASH, ['-c', `. "$1"; CCD_OS=darwin; _inst_plist_server ${MAC_LABEL} "$HOME/.ccrc/logs/${MAC_LABEL}.log" server "$2" "$3"`,
    'writer', CCRC_SRC, jobPath, cls], { env: { HOME: home, PATH: process.env['PATH'] ?? '/usr/bin:/bin' }, encoding: 'latin1' });
  if (r.status !== 0) throw new Error(`the writer failed: ${r.stderr}`);
  mkdirSync(join(home, 'Library', 'LaunchAgents'), { recursive: true });
  writeFileSync(macJobFile(home), r.stdout, 'latin1');
  return r.stdout;
}
/** The job's three arguments, as launchd reads them from the file (its `&amp;` is `&`). */
function jobArgs(job: string): string[] {
  const lines = job.split('\n');
  const at = lines.indexOf('  <key>ProgramArguments</key>');
  return lines.slice(at + 2, at + 5).map((l) => l.replace(/^ {4}<string>/, '').replace(/<\/string>$/, '').replace(/&amp;/g, '&'));
}
/** What `launchctl print` answers for a job launchd holds, in its shape (one tab a level). `over` replaces a field. */
function printOf(home: string, job: string, over: { path?: string; program?: string; args?: string[];
  env?: [string, string][] } = {}): string {
  const uid = process.getuid?.() ?? 0;
  const args = over.args ?? jobArgs(job);
  // The block a real launchd drew (wave 193's first full run, macos-26-arm64): its four keys in its order. The rate
  // limit's value was not printed there; a whole number stands in.
  const env = over.env ?? [['OSLogRateLimit', '64'], ['PATH', JOB_PATH], ['HOME', home], ['XPC_SERVICE_NAME', MAC_LABEL]];
  return [`gui/${uid}/${MAC_LABEL} = {`, '\tactive count = 1', `\tpath = ${over.path ?? macJobFile(home)}`, '\ttype = LaunchAgent',
    '\tstate = @STATE@', '', `\tprogram = ${over.program ?? '/bin/bash'}`, '\targuments = {', ...args.map((a) => `\t\t${a}`), '\t}', '',
    '\tinherited environment = {', '\t\tSSH_AUTH_SOCK => /private/tmp/com.apple.launchd.x/Listeners', '\t}', '',
    '\tdefault environment = {', '\t\tPATH => /usr/bin:/bin:/usr/sbin:/sbin', '\t}', '',
    '\tenvironment = {', ...env.map(([k, v]) => `\t\t${k} => ${v}`), '\t}', '', `\tdomain = gui/${uid} [100005]`, '}', ''].join('\n');
}

interface Box { home: string }
/** A server box on loopback: ccrc.env naming this server's port, ccrc.service installed, the server up with sign-in
 *  off, and (unless `passphrase: false`) a real passphrase file. `envText` is ccrc.env's whole text; the port line is
 *  the caller's to include (`portLines()`). */
function box(prefix: string, envText: string, opts: { passphrase?: boolean | 'garbled' } = {}): Box {
  const home = mkTmp(prefix);
  homes.clear(); homes.add(home);
  const ccd = join(home, 'ccrc', 'ccd');
  mkdirSync(ccd, { recursive: true });
  symlinkSync(CCRC_SRC, join(ccd, 'ccrc'));
  plantAuthHelper(join(home, 'ccrc'));
  plantAuthModule(join(home, 'ccrc'));
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  writeFileSync(envFile(home), envText, { mode: 0o600 });
  chmodSync(envFile(home), 0o600);
  // The tree's unit file, and the installed copy of it, byte for byte: what `_inst_units` lands (review 3971 R1). On a
  // Mac, what `_inst_units_darwin` lands: the job the writer prints for this home, and what launchd holds for it.
  mkdirSync(join(home, 'ccrc', 'deploy'), { recursive: true });
  copyFileSync(SHIPPED_UNIT_SRC, join(home, 'ccrc', 'deploy', 'ccrc.service'));
  if (PLAT === 'darwin') {
    writeFileSync(join(home, 'lc-print'), printOf(home, writeJob(home)));
  } else {
    const units = join(home, '.config', 'systemd', 'user');
    mkdirSync(units, { recursive: true });
    copyFileSync(SHIPPED_UNIT_SRC, join(units, 'ccrc.service'));
  }
  if (opts.passphrase !== false) {
    writeFileSync(join(home, '.ccrc', 'auth.scrypt'), opts.passphrase === 'garbled' ? 'not a secret line\n' : fixtureSecretLine(),
      { mode: 0o600 });
  }
  writeFileSync(join(home, 'server-state'), 'off\n');
  return { home };
}
const portLines = (): string => `CCRC_HOST=127.0.0.1\nCCRC_PORT=${PORT}\n`;

function env(home: string, extra: Record<string, string> = {}): Record<string, string> {
  const e = ccrcContainedEnv(home, process.env, { managers: true, curl: 'loopback' });
  writeFileSync(join(home, 'curl-allow-ports'), `${PORT}\n`);
  writeFileSync(join(home, '.local', 'bin', 'systemctl'), SYSTEMCTL_STUB, { mode: 0o755 });
  if (PLAT === 'darwin') writeFileSync(join(home, '.local', 'bin', 'launchctl'), LAUNCHCTL_STUB, { mode: 0o755 });
  // A case that plants a failing `stat` of its own keeps it (the shim is written once, where none stands).
  if (simulated() && !existsSync(join(home, '.local', 'bin', 'stat'))) {
    writeFileSync(join(home, '.local', 'bin', 'stat'), STAT_SHIM(REAL_STAT), { mode: 0o755 });
  }
  // The pane guard's one tmux read, answered with `<home>/tmux-session` when a case plants one; the containment's
  // poison stands otherwise.
  const session = join(home, 'tmux-session');
  if (existsSync(session)) {
    writeFileSync(join(home, '.local', 'bin', 'tmux'), '#!/bin/sh\n'
      + '[ "$1 $2 $3 $4 $5" = "display-message -p -t %7 #S" ] || { echo "fixture tmux: $*" >&2; exit 90; }\n'
      + `cat ${JSON.stringify(session)}\n`, { mode: 0o755 });
  }
  for (const k of ['CLAUDECODE', 'TMUX', 'TMUX_PANE', 'CCRC_ADDR', 'CCRC_HEALTH_TIMEOUT', 'CCRC_UPDATE_HEALTH_S']) delete e[k];
  e.CCRC_UPDATE_HEALTH_S = '2';
  return { ...(e as Record<string, string>), ...extra };
}

interface Result { code: number; out: string; signal?: number }
/** A simulated darwin's command line: `ccrc` sourced (its dispatch skipped: `$0` is not the file), the platform and
 *  the unit directory it fixes at load set after, then the verb's own function with the verb's words. */
const SIM_DARWIN = 'f=$1; shift; v=$1; shift; set -- "$@"; . "$f"; CCD_OS=darwin; BOX_UNIT_DIR="$HOME/Library/LaunchAgents"; '
  + '[ "$v" = auth ] || { echo "simulated darwin runs auth only" >&2; exit 90; }; cmd_auth "$@"';
const argvOf = (home: string, args: string[]): string[] =>
  (simulated() ? ['-c', SIM_DARWIN, 'sim-darwin', ccrcIn(home), ...args] : [ccrcIn(home), ...args]);
/** `ccrc auth <sub>` on a real terminal, with the terminal handed back so a case can signal the run. A pty merges the
 *  two streams. */
function startTty(home: string, args: string[], extra: Record<string, string> = {}): { p: pty.IPty; done: Promise<Result> } {
  const p = pty.spawn(BASH, argvOf(home, args), {
    name: 'xterm-color', cols: 400, rows: 60, cwd: home, env: env(home, extra),
  });
  const done = new Promise<Result>((resolve) => {
    let out = '';
    let fin = false;
    const finish = (code: number, signal?: number): void => {
      if (!fin) { fin = true; clearTimeout(t); resolve({ code, out, ...(signal ? { signal } : {}) }); }
    };
    const t = setTimeout(() => { p.kill(); finish(-1); }, 90_000);
    p.onData((d) => { out += d; });
    p.onExit(({ exitCode, signal }) => finish(exitCode, signal));
  });
  return { p, done };
}
const runTty = (home: string, args: string[], extra: Record<string, string> = {}): Promise<Result> =>
  startTty(home, args, extra).done;
const leftovers = (home: string): string[] => readdirSync(join(home, '.ccrc')).filter((f) => /\.auth(\.tmp|-restore)\./.test(f));
const waitFor = async (pred: () => boolean, ms = 20_000): Promise<void> => {
  for (const end = Date.now() + ms; !pred(); await new Promise((r) => setTimeout(r, 50))) {
    if (Date.now() > end) throw new Error('waited too long');
  }
};
/** `ccrc <args>` with stdin a pipe — the shape a session's tool has. */
function runPiped(home: string, args: string[]): Result {
  const r = spawnSync(BASH, argvOf(home, args), { env: env(home), encoding: 'utf8', input: '' });
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** On a Mac the job sources ccrc.env with bash, and a line its reader cannot hold to a plain assignment makes every key
 *  undecided, so a row whose Linux reason is one key's shape refuses there at the first key read, with these words. */
const NOT_PLAIN = /is not a plain NAME=value line, and on macOS the launchd job sources both env files with bash/;
/** The refusal shape: non-zero, ccrc.env exactly as it was, nothing restarted, no temp or restore file left. */
async function expectRefused(b: Box, r: Result, before: string | null, words: RegExp): Promise<void> {
  expect(r.code, r.out).not.toBe(0);
  expect(r.out).toMatch(words);
  expect(r.out).toMatch(/Nothing was changed/);
  expect(bytes(envFile(b.home))).toBe(before);
  expect(restarts(b.home)).toEqual([]);
  expect(leftovers(b.home)).toEqual([]);
}

const ON_LINES = (port: number): string =>
  `# ccrc auth on: sign-in at http://localhost:${port} ('ccrc auth off' removes these lines)\n`
  + `CCRC_AUTH=on\nCCRC_RP_ID=localhost\nCCRC_ORIGIN=http://localhost:${port}\nCCRC_COOKIE_INSECURE=on\n`;

onEach('ccrc auth: the guards an operator-only verb runs first', () => {
  it('refuses inside a Claude Code session (CLAUDECODE set)', async () => {
    const b = box('ccrc-auth-claudecode-', portLines());
    const before = bytes(envFile(b.home));
    await expectRefused(b, await runTty(b.home, ['auth', 'on'], { CLAUDECODE: '1' }), before, /inside a Claude Code session/);
  });

  it('refuses without a terminal — a pipe is a session tool or a script', async () => {
    const b = box('ccrc-auth-notty-', portLines());
    const before = bytes(envFile(b.home));
    for (const sub of ['on', 'off']) {
      await expectRefused(b, runPiped(b.home, ['auth', sub]), before, /stdin here is not a terminal/);
    }
  });

  it("refuses inside a fleet session's pane (tmux session cc-*), and only there", async () => {
    const b = box('ccrc-auth-pane-', portLines());
    const before = bytes(envFile(b.home));
    const stub = (name: string): void => writeFileSync(join(b.home, 'tmux-session'), `${name}\n`);
    stub('cc-lane-a-demo');
    await expectRefused(b, await runTty(b.home, ['auth', 'on'], { TMUX_PANE: '%7' }), before, /a fleet session's pane \(cc-lane-a-demo\)/);
    stub('operator');
    const r = await runTty(b.home, ['auth', 'on'], { TMUX_PANE: '%7' });
    expect(r.code, r.out).toBe(0);
  });
});

onEach('ccrc auth: which box may run it', (p) => {
  it('refuses on the fleet role, and on a box with no ccrc.service installed', async () => {
    const a = box('ccrc-auth-fleet-', `${portLines()}CCRC_ROLE=fleet\n`);
    await expectRefused(a, await runTty(a.home, ['auth', 'on']), bytes(envFile(a.home)), /runs no console/);
    const c = box('ccrc-auth-nounit-', portLines());
    spawnSync('rm', ['-f', installedFile(c.home)]);
    await expectRefused(c, await runTty(c.home, ['auth', 'on']), bytes(envFile(c.home)),
      p === 'darwin' ? /app\.ccrc\.ccrc\.plist is not installed/ : /ccrc\.service is not installed/);
  });

  // On a Mac the ddns pair is one launchd job (`_box_reach`'s own comment).
  const ddns: [string, (h: string) => void, RegExp] = p === 'darwin'
    ? ['the ddns job', (h) => writeFileSync(join(h, 'Library', 'LaunchAgents', 'app.ccrc.ccrc-ddns.plist'), ''), /app\.ccrc\.ccrc-ddns\.plist is installed/]
    : ['the ddns timer unit', (h) => writeFileSync(join(h, '.config', 'systemd', 'user', 'ccrc-ddns.timer'), ''), /ccrc-ddns\.timer is installed/];
  for (const [name, plant, words] of [
    ['an exposure file', (h: string) => writeFileSync(join(h, '.ccrc', 'exposure.env'), 'CCRC_AUTH=on\n', { mode: 0o600 }), /exposure\.env exists/],
    ['a Caddyfile', (h: string) => writeFileSync(join(h, '.ccrc', 'Caddyfile'), 'x {\n}\n'), /Caddyfile exists/],
    ddns,
  ] as const) {
    it(`refuses a box reached from elsewhere: ${name}, naming ccrc expose — on and off alike`, async () => {
      const b = box('ccrc-auth-reach-', portLines());
      plant(b.home);
      const before = bytes(envFile(b.home));
      const on = await runTty(b.home, ['auth', 'on']);
      await expectRefused(b, on, before, words);
      // Review 3934 A4: never a bare `ccrc expose`, which exits 2 (missing subcommand).
      expect(on.out).toMatch(/ccrc expose duckdns, ccrc expose byo or ccrc expose ip/);
      expect(on.out).not.toMatch(/ccrc expose(?! (?:duckdns|byo|ip)\b)/);
      await expectRefused(b, await runTty(b.home, ['auth', 'off']), before, /un-exposing the box/);
    });
  }

  it('refuses a non-loopback CCRC_HOST bind, and an undecidable one', async () => {
    const a = box('ccrc-auth-wild-', `CCRC_HOST=0.0.0.0\nCCRC_PORT=${PORT}\n`);
    // Review 3971 R5 (A5): a bind and nothing else gets the README's remedy on `on` too, never the three expose arms.
    const onBind = await runTty(a.home, ['auth', 'on']);
    await expectRefused(a, onBind, bytes(envFile(a.home)), /CCRC_HOST=0\.0\.0\.0 in .* is not a value this verb can read as this machine only/);
    expect(onBind.out).toMatch(/Bind it back to 127\.0\.0\.1 \(or remove the line\) and re-run, or arm it by hand \(the README's 'The session gate'\)/);
    expect(onBind.out).not.toMatch(/ccrc expose/);
    // Review 3934 A4: off names the bind, not un-exposing (there is nothing to un-expose).
    const offBind = await runTty(a.home, ['auth', 'off']);
    await expectRefused(a, offBind, bytes(envFile(a.home)), /CCRC_HOST=0\.0\.0\.0 in .* is not a value this verb can read as this machine only/);
    expect(offBind.out).not.toMatch(/un-exposing/);
    const u = box('ccrc-auth-undecided-', `CCRC_HOST ="127.0.0.1"\nCCRC_PORT=${PORT}\n`);
    await expectRefused(u, await runTty(u.home, ['auth', 'on']), bytes(envFile(u.home)), /was not measured/);
  });

  // Review 3934 A2: loopback is an address, never any text that begins 127. Review 3971 R5 (A3a): the sentence is true of
  // each value refused, a loopback spelling this reader does not take (127.1, LOCALHOST) among them: never "beyond".
  for (const host of ['127.0.0.1.example.com', '127.256.0.1', '127.0.0.01', '127.255.255.255', '127.1', 'LOCALHOST']) {
    it(`refuses CCRC_HOST=${host}, on and off: loopback is 127.0.0.1 to 127.255.255.254, localhost or ::1`, async () => {
      const b = box('ccrc-auth-127text-', `CCRC_HOST=${host}\nCCRC_PORT=${PORT}\n`);
      const before = bytes(envFile(b.home));
      for (const sub of ['on', 'off']) {
        const r = await runTty(b.home, ['auth', sub]);
        await expectRefused(b, r, before, /is not a value this verb can read as this machine only \(127\.0\.0\.1 to 127\.255\.255\.254, localhost or ::1\)/);
        expect(r.out).toContain(`auth ${sub}: CCRC_HOST=${host} in `);
        expect(r.out).not.toMatch(/beyond this machine/);
      }
    });
  }

  // Review 3934 A3: on writes http://localhost:<port> and prints it, which is the server only on 127.0.0.1 or localhost.
  for (const host of ['127.0.0.2', '::1']) {
    it(`on refuses the loopback bind CCRC_HOST=${host}, whose address it would write falsely, and names the hand route`, async () => {
      const b = box('ccrc-auth-otherloop-', `CCRC_HOST=${host}\nCCRC_PORT=${PORT}\n`);
      const r = await runTty(b.home, ['auth', 'on']);
      await expectRefused(b, r, bytes(envFile(b.home)), /binds the server to a loopback address other than 127\.0\.0\.1/);
      expect(r.out).toContain(`CCRC_HOST=${host}`);
      expect(r.out).toMatch(/the README's hand route \('The session gate'\)/);
    });
  }

  it('refuses while an update or rollback holds ~/.ccrc/update.lock', async () => {
    const b = box('ccrc-auth-lock-', portLines());
    const lock = join(b.home, '.ccrc', 'update.lock');
    // Its own process group, so the `finally` ends flock AND the command it holds the lock for.
    const holder: ChildProcess = spawn('flock', [lock, 'sleep', '30'], { stdio: 'ignore', detached: true });
    try {
      for (let i = 0; i < 100 && spawnSync('flock', ['-n', lock, 'true']).status === 0; i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(spawnSync('flock', ['-n', lock, 'true']).status).toBe(1);
      await expectRefused(b, await runTty(b.home, ['auth', 'on']), bytes(envFile(b.home)), /holds ~\/\.ccrc\/update\.lock/);
    } finally { if (holder.pid !== undefined) process.kill(-holder.pid, 'SIGKILL'); }
  });
});

onEach('ccrc auth on: what must hold before anything is written', () => {
  it('refuses with no passphrase, and says to run ccrc passwd first', async () => {
    const b = box('ccrc-auth-nopass-', portLines(), { passphrase: false });
    await expectRefused(b, await runTty(b.home, ['auth', 'on']), bytes(envFile(b.home)), /ccrc passwd, then ccrc auth on/);
  });

  it('refuses a passphrase file the server could not use', async () => {
    const b = box('ccrc-auth-garbled-', portLines(), { passphrase: 'garbled' });
    await expectRefused(b, await runTty(b.home, ['auth', 'on']), bytes(envFile(b.home)), /cannot be used/);
  });

  // Review 3934 F1: the passphrase file's path, and the session store's, as ccrc.service receives them (`_box_unit_env`).
  for (const key of ['CCRC_AUTH_SECRET_PATH', 'CCRC_SESSIONS_PATH']) {
    it(`refuses a ${key} line the unit reader cannot decide (a space before =) rather than reading it as unset`, async () => {
      const b = box('ccrc-auth-pathkey-', `${portLines()}${key} =/elsewhere/file\n`);
      await expectRefused(b, await runTty(b.home, ['auth', 'on']), bytes(envFile(b.home)),
        PLAT === 'darwin' ? NOT_PLAIN : new RegExp(`names ${key} in a shape this reader does not decide`));
    });
  }

  it('refuses a foreign CCRC_ORIGIN and a foreign CCRC_RP_ID, naming the key and never the value', async () => {
    for (const line of ['CCRC_ORIGIN=https://box.example.com', 'CCRC_RP_ID=example.com']) {
      const b = box('ccrc-auth-foreign-', `${portLines()}${line}\n`);
      const r = await runTty(b.home, ['auth', 'on']);
      await expectRefused(b, r, bytes(envFile(b.home)), new RegExp(`already sets ${line.split('=')[0]}`));
      expect(r.out).not.toMatch(/example\.com/);
    }
  });
});

// Every shape of line the write must carry over untouched: comments (one NAMING a key, which is still a comment),
// a key we do not own, odd spacing in a value, a CRLF line, and a last line with no newline.
// A function: the port is known only once `beforeAll` has started the console.
// On a Mac the job sources ccrc.env with bash, and its reader holds the file to plain assignments (wave 193 B3): no CR,
// and a value with a blank in it is one whole quoted pair; the rest of the file is the same lines.
const others = (): string => `# box config\n${portLines()}# CCRC_AUTH=off   <- a comment that names the key\n`
  + (PLAT === 'darwin' ? "CCRC_VAPID_SUBJECT=mailto:fixture@example.invalid\nCCRC_FLEET=local\nNOTE_LINE='a  b\tc'"
    : 'CCRC_VAPID_SUBJECT=mailto:fixture@example.invalid\nCCRC_FLEET=local\r\nNOTE_LINE=a  b\tc');

onEach('ccrc auth on: the write, the restart and the proof', () => {

  it('appends the four lines, keeps every other byte and the file mode, restarts once and proves sign-in on', async () => {
    const b = box('ccrc-auth-on-', others());
    chmodSync(envFile(b.home), 0o640);
    const r = await runTty(b.home, ['auth', 'on']);
    expect(r.code, r.out).toBe(0);
    expect(bytes(envFile(b.home))).toBe(`${others()}\n${ON_LINES(PORT)}`);
    expect(statSync(envFile(b.home)).mode & 0o7777).toBe(0o640);
    expect(restarts(b.home)).toEqual(['--user restart ccrc.service']);
    expect(readFileSync(join(b.home, 'server-state'), 'utf8').trim()).toBe('armed');
    expect(r.out).toMatch(/sign-in is on/);
    expect(r.out).toMatch(/answers with sign-in on \(v9\.8\.7\)/);
    expect(r.out).toMatch(new RegExp(`open http://localhost:${PORT}/ — exactly that address\\. http://127\\.0\\.0\\.1:${PORT} is a different origin`));
    expect(r.out).toMatch(/sign in with the passphrase you set with ccrc passwd/);
    expect(r.out).toMatch(/the restart left them running/);
    expect(leftovers(b.home)).toEqual([]);
  });

  it('replaces a bare KEY= line and CCRC_AUTH=off rather than adding a second line', async () => {
    // Review 3934 A8 (X3): a bare cookie line too, so no key is left twice (one holding `on` already matches).
    const b = box('ccrc-auth-bare-', `${portLines()}CCRC_AUTH=off\nCCRC_RP_ID=\nCCRC_COOKIE_INSECURE=\nCCRC_ORIGIN="http://localhost:${PORT}"\n`);
    const r = await runTty(b.home, ['auth', 'on']);
    expect(r.code, r.out).toBe(0);
    expect(bytes(envFile(b.home))).toBe(`${portLines()}${ON_LINES(PORT)}`);
  });

  it('is idempotent: a second run says so, writes nothing and restarts nothing', async () => {
    const b = box('ccrc-auth-again-', portLines());
    expect((await runTty(b.home, ['auth', 'on'])).code).toBe(0);
    const after = bytes(envFile(b.home));
    const r = await runTty(b.home, ['auth', 'on']);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/already on/);
    expect(r.out).toMatch(/answers with sign-in on/);
    expect(bytes(envFile(b.home))).toBe(after);
    expect(restarts(b.home)).toHaveLength(1);
  });

  for (const [plan, words] of [
    ['down', /ccrc\.service is failed/],
    ['off', /answers off/],
  ] as const) {
    it(`puts the file back when the restarted console does not prove sign-in on (${plan}), restarts again, exits 1`, async () => {
      const b = box(`ccrc-auth-restore-${plan}-`, others());
      const before = bytes(envFile(b.home));
      writeFileSync(join(b.home, 'restart-plan'), `${plan}\n`);
      const r = await runTty(b.home, ['auth', 'on']);
      expect(r.code, r.out).toBe(1);
      // On a Mac a job that is not running has no failed word (`_svc_is_active` keeps launchd's "unanswered" apart).
      expect(r.out).toMatch(plan === 'down' && PLAT === 'darwin' ? /ccrc\.service is unanswered/ : words);
      expect(r.out).toMatch(/was put back/);
      expect(r.out).toMatch(/it is back as it was, with sign-in off/);
      expect(bytes(envFile(b.home))).toBe(before);
      expect(restarts(b.home)).toEqual([RESTART, RESTART]);
      expect(leftovers(b.home)).toEqual([]);
    });
  }

  it('the four lines mean, to the SERVER, what the verb says they mean', async () => {
    const b = box('ccrc-auth-agree-', portLines());
    expect((await runTty(b.home, ['auth', 'on'])).code).toBe(0);
    // ccrc.env as systemd's EnvironmentFile= hands it over: KEY=value lines, comments skipped, the later line winning.
    const fromFile: Record<string, string> = {};
    for (const raw of readFileSync(envFile(b.home), 'utf8').split('\n')) {
      const l = raw.trim();
      if (l === '' || l.startsWith('#')) continue;
      const i = l.indexOf('=');
      fromFile[l.slice(0, i)] = l.slice(i + 1);
    }
    seedRoster(b.home);
    const cfg = loadConfig({ ...fromFile, CCRC_HOME: b.home });
    expect(cfg.authEnabled).toBe(true);
    expect(cfg.cookieSecure).toBe(false);
    expect(cfg.rpId).toBe('localhost');
    expect(cfg.origin).toBe(`http://localhost:${PORT}`);
    expect(accountOriginClass(cfg.origin)).toBe('loopback');
    expect(cookiePolicyProblem(cfg.origin, cfg.cookieSecure)).toBeNull();
    expect(relyingPartyProblem(cfg.rpId, cfg.origin)).toBeNull();
  });
});

onEach('ccrc auth off', () => {
  it('removes exactly what on wrote — the file is back to its bytes — and proves sign-in off', async () => {
    const original = `# box config\n${portLines()}# CCRC_AUTH=on  <- a comment, never removed\nCCRC_FLEET=local\n`;
    const b = box('ccrc-auth-off-', original);
    expect((await runTty(b.home, ['auth', 'on'])).code).toBe(0);
    const r = await runTty(b.home, ['auth', 'off']);
    expect(r.code, r.out).toBe(0);
    expect(bytes(envFile(b.home))).toBe(original);
    expect(readFileSync(join(b.home, 'server-state'), 'utf8').trim()).toBe('off');
    expect(r.out).toMatch(/sign-in is off/);
    expect(r.out).toMatch(/answers with sign-in off/);
    expect(restarts(b.home)).toHaveLength(2);
  });

  // Review 3934 R1 (the coordinator's ruling): a foreign origin is the one evidence the box has that it is reached from
  // elsewhere, and the proof cannot see a proxy, so off refuses there; turning sign-in off is a hand edit of the file.
  for (const line of ['CCRC_ORIGIN=https://box.example.com', 'CCRC_RP_ID=example.com']) {
    const key = line.split('=')[0]!;
    it(`refuses a box armed by hand for another address (a ${key} it did not write), naming the key, never the value`, async () => {
      const b = box('ccrc-auth-off-foreign-', `${portLines()}CCRC_AUTH=on\n${line}\n`);
      writeFileSync(join(b.home, 'server-state'), 'armed\n');
      const r = await runTty(b.home, ['auth', 'off']);
      await expectRefused(b, r, `${portLines()}CCRC_AUTH=on\n${line}\n`, new RegExp(`${key} holds? a value this verb did not write`));
      expect(r.out).toMatch(/armed by hand for another address/);
      expect(r.out).toMatch(/a hand edit of .*ccrc\.env/);
      expect(r.out).not.toMatch(/example\.com/);
    });
  }

  // Wave 193 C6: on wrote its origin for the port its marker line names, and CCRC_PORT has moved since. off refuses that
  // origin as it refuses any it would not write today (never loosened), and says the way on that works.
  it('refuses its own origin for a port CCRC_PORT has moved from, with a way on that works: the port back, then off', async () => {
    const moved = PORT === 7788 ? 7789 : 7788;
    const armedAt = (p: number): string => `CCRC_HOST=127.0.0.1\nCCRC_PORT=${p}\n${ON_LINES(PORT)}`;
    const b = box('ccrc-auth-off-moved-', armedAt(moved));
    writeFileSync(join(b.home, 'server-state'), 'armed\n');
    const r = await runTty(b.home, ['auth', 'off']);
    await expectRefused(b, r, armedAt(moved), /CCRC_ORIGIN holds http:\/\/localhost:\d+, which ccrc auth on wrote for port \d+ \(its marker line in .*ccrc\.env says so\)/);
    expect(r.out).toContain(`CCRC_ORIGIN holds http://localhost:${PORT}, which ccrc auth on wrote for port ${PORT}`);
    expect(r.out).toContain(`and CCRC_PORT is now ${moved}, so it is not the origin this verb would write today`);
    expect(r.out).toContain(`To go on: set CCRC_PORT back to ${PORT}, run ccrc auth off, then change the port; or remove the lines by hand (the README's 'The session gate')`);
    expect(r.out).not.toMatch(/armed by hand for another address/);
    // The way on, followed: the port back, then off, which acts and proves.
    writeFileSync(envFile(b.home), armedAt(PORT));
    const back = await runTty(b.home, ['auth', 'off']);
    expect(back.code, back.out).toBe(0);
    expect(bytes(envFile(b.home))).toBe(`CCRC_HOST=127.0.0.1\nCCRC_PORT=${PORT}\n`);
    // Without its marker line the same origin is no line of this verb's: the hand-armed words, as before.
    const lines = `CCRC_HOST=127.0.0.1\nCCRC_PORT=${moved}\nCCRC_AUTH=on\nCCRC_RP_ID=localhost\nCCRC_ORIGIN=http://localhost:${PORT}\n`;
    const h = box('ccrc-auth-off-moved-nomark-', lines);
    const n = await runTty(h.home, ['auth', 'off']);
    await expectRefused(h, n, lines, /CCRC_ORIGIN holds a value this verb did not write/);
    expect(n.out).toMatch(/armed by hand for another address/);
    expect(n.out).not.toMatch(/set CCRC_PORT back/);
  });

  it('a foreign cookie line alone is no such evidence: off removes its own lines and names the one it left', async () => {
    const b = box('ccrc-auth-off-cookie-',
      `${portLines()}CCRC_AUTH=on\nCCRC_RP_ID=localhost\nCCRC_ORIGIN=http://localhost:${PORT}\nCCRC_COOKIE_INSECURE=yes\n`);
    writeFileSync(join(b.home, 'server-state'), 'armed\n');
    const r = await runTty(b.home, ['auth', 'off']);
    expect(r.code, r.out).toBe(0);
    expect(bytes(envFile(b.home))).toBe(`${portLines()}CCRC_COOKIE_INSECURE=yes\n`);
    expect(r.out).toMatch(/left as they were.*CCRC_COOKIE_INSECURE/);
  });

  it('removes every CCRC_AUTH line whatever it holds, and of the others only those holding its own value (X3b)', async () => {
    const b = box('ccrc-auth-off-every-',
      `${portLines()}CCRC_AUTH=off\nCCRC_FLEET=local\nCCRC_AUTH='on'\nCCRC_RP_ID=localhost\nCCRC_ORIGIN=http://localhost:${PORT}\n`);
    writeFileSync(join(b.home, 'server-state'), 'armed\n');
    const r = await runTty(b.home, ['auth', 'off']);
    expect(r.code, r.out).toBe(0);
    expect(bytes(envFile(b.home))).toBe(`${portLines()}CCRC_FLEET=local\n`);
  });

  it('says it is already off, and writes and restarts nothing', async () => {
    const b = box('ccrc-auth-off-already-', portLines(), { passphrase: false });
    const before = bytes(envFile(b.home));
    const r = await runTty(b.home, ['auth', 'off']);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/already off/);
    expect(bytes(envFile(b.home))).toBe(before);
    expect(restarts(b.home)).toEqual([]);
  });

  it('puts the file back when the console does not come back off', async () => {
    const b = box('ccrc-auth-off-restore-', `${portLines()}${ON_LINES(PORT)}`);
    writeFileSync(join(b.home, 'server-state'), 'armed\n');
    const before = bytes(envFile(b.home));
    writeFileSync(join(b.home, 'restart-plan'), 'armed\n');
    const r = await runTty(b.home, ['auth', 'off']);
    expect(r.code, r.out).toBe(1);
    expect(r.out).toMatch(/it is back as it was, with sign-in on/);
    expect(bytes(envFile(b.home))).toBe(before);
    // Review 3934 A8: one restart for the change, one to put it back, and nothing left beside the file.
    expect(restarts(b.home)).toEqual([RESTART, RESTART]);
    expect(leftovers(b.home)).toEqual([]);
  });

  // Review 3934 A1: a non-zero restart never reads as restarted, even when the old server already answers the asked
  // mode (here: CCRC_AUTH=on in the file, a server never restarted onto it, so it answers off).
  // Wave 190 A6: a restore that fails, both shapes. With no file before the run (the restarts both fail, so no server is
  // asked), the one this run wrote cannot be removed: it is named as this run's, never as a "previous" file. With a file
  // before it, the copy cannot be moved back while the re-proof passes: the server answers as before, on this run's lines.
  it('a failed proof whose removal of the file this run created fails: named as this run\'s, kept, exit 1', async () => {
    const b = box('ccrc-auth-created-rmfails-', '');
    spawnSync('rm', ['-f', envFile(b.home)]);
    writeFileSync(join(b.home, 'restart-plan'), 'fail\nfail\n');
    mkdirSync(join(b.home, '.local', 'bin'), { recursive: true });
    writeFileSync(join(b.home, '.local', 'bin', 'rm'), '#!/bin/sh\ncase "$*" in *"/.ccrc/ccrc.env") exit 1 ;; esac\nexec /usr/bin/rm "$@"\n',
      { mode: 0o755 });
    const r = await runTty(b.home, ['auth', 'on']);
    expect(r.code, r.out).toBe(1);
    expect(r.out).toMatch(/the restarted console did not prove the change: the restart command failed/);
    expect(r.out).toMatch(/ccrc\.env, which this run created, was NOT removed: it still holds this run's lines/);
    expect(r.out).not.toMatch(/previous|old file/);
    expect(bytes(envFile(b.home))).toBe(ON_LINES(7788));
    expect(restarts(b.home)).toEqual([RESTART, RESTART]);
  });

  // Wave 190 fix round 1 (R5): the same removal failing, with the re-proof passing: the server answers as before on
  // this run's lines, and no old file is named. With no ccrc.env before the run the verb asks the default port, 7788, so
  // a curl in front of the suite's loopback front (planted before it, which it then leaves alone) sends 7788 to this
  // server's port; the front still reaches only the ports listed, so nothing on this box's own 7788 is asked.
  it('a failed proof whose removal of the file this run created fails, with the re-proof passing: "on this run\'s lines" alone', async () => {
    const b = box('ccrc-auth-created-rmfails-up-', '');
    spawnSync('rm', ['-f', envFile(b.home)]);
    writeFileSync(join(b.home, 'restart-plan'), 'down\noff\n');
    mkdirSync(join(b.home, '.local', 'bin'), { recursive: true });
    const realCurl = spawnSync('/bin/sh', ['-c', 'command -v curl'], { encoding: 'utf8' }).stdout.trim() || '/usr/bin/curl';
    writeFileSync(join(b.home, '.local', 'bin', 'curl-front'), loopbackCurlFront(realCurl), { mode: 0o755 });
    writeFileSync(join(b.home, '.local', 'bin', 'curl'), `#!${BASH}\nargs=(); for a in "$@"; do args+=("\${a//127.0.0.1:7788/127.0.0.1:${PORT}}"); done\n`
      + 'exec "$(dirname "$0")/curl-front" "${args[@]}"\n', { mode: 0o755 });
    writeFileSync(join(b.home, '.local', 'bin', 'rm'), '#!/bin/sh\ncase "$*" in *"/.ccrc/ccrc.env") exit 1 ;; esac\nexec /usr/bin/rm "$@"\n',
      { mode: 0o755 });
    const r = await runTty(b.home, ['auth', 'on']);
    expect(r.code, r.out).toBe(1);
    expect(r.out).toMatch(/ccrc\.env, which this run created, was NOT removed: it still holds this run's lines, and ccrc\.service was restarted again: it answers with sign-in off as before this run, though on this run's lines\./);
    expect(r.out).not.toMatch(/previous|old file/);
    expect(existsSync(envFile(b.home))).toBe(true);
    expect(restarts(b.home)).toEqual([RESTART, RESTART]);
  });

  it('a failed proof whose copy cannot be moved back, with the re-proof passing: "on this run\'s lines, not on its old file"', async () => {
    const b = box('ccrc-auth-copyback-mvfails-', portLines());
    writeFileSync(join(b.home, 'restart-plan'), 'down\noff\n');
    mkdirSync(join(b.home, '.local', 'bin'), { recursive: true });
    writeFileSync(join(b.home, '.local', 'bin', 'mv'), '#!/bin/sh\ncase "$*" in *ccrc.env.auth-restore.*) exit 1 ;; esac\nexec /usr/bin/mv "$@"\n',
      { mode: 0o755 });
    const r = await runTty(b.home, ['auth', 'on']);
    expect(r.code, r.out).toBe(1);
    expect(r.out).toMatch(/The previous .*ccrc\.env was NOT put back: the previous file is kept at .*ccrc\.env\.auth-restore\.\d+, and .*ccrc\.env still holds this run's lines/);
    expect(r.out).toMatch(/it answers with sign-in off as before this run, though on this run's lines, not on its old file/);
    expect(bytes(envFile(b.home))).toBe(`${portLines()}${ON_LINES(PORT)}`);
    expect(leftovers(b.home).filter((f) => f.includes('.auth-restore.'))).toHaveLength(1);
    expect(restarts(b.home)).toEqual([RESTART, RESTART]);
  });

  it('takes a failed restart as a failed proof: the file goes back, exit 1', async () => {
    const b = box('ccrc-auth-restart-fails-', `${portLines()}${ON_LINES(PORT)}`);
    const before = bytes(envFile(b.home));
    writeFileSync(join(b.home, 'restart-plan'), 'fail\n');
    const r = await runTty(b.home, ['auth', 'off']);
    expect(r.code, r.out).toBe(1);
    expect(r.out).toMatch(/the restart command failed/);
    expect(r.out).not.toMatch(/ccrc\.service restarted, and/);
    expect(bytes(envFile(b.home))).toBe(before);
    expect(restarts(b.home)).toEqual([RESTART, RESTART]);
    expect(leftovers(b.home)).toEqual([]);
  });
});

// ── review 3934 F2: what else can hand ccrc.service its bind or a sign-in key ─────────────────────────────────────
// The reach proof reads ccrc.env and the exposure file. On Linux the unit can also take its environment from a
// drop-in, an Environment= or PassEnvironment= line in the unit itself, an EnvironmentFile= beyond those two, or the
// user manager's own environment; the verb reads the unit file and its drop-in directories on disk (what the next
// start applies) and asks systemd what it loaded (what the restart applies), and refuses, on and off alike, naming
// each source by path and never a value. A source it cannot list is undecidable, and refuses too.
describe.skipIf(IS_DARWIN)("ccrc auth: the unit's other sources of its environment (review 3934 F2)", () => {
  const units = (h: string): string => join(h, '.config', 'systemd', 'user');
  /** The installed unit with `lines` added under [Service]: the reading names them before the installer's check would. */
  const unit = (h: string, lines: string): void =>
    writeFileSync(join(units(h), 'ccrc.service'), SHIPPED_UNIT.replace('[Service]\n', `[Service]\n${lines}`));
  const dropIn = (h: string, dir: string, name: string, text: string): void => {
    mkdirSync(join(units(h), dir), { recursive: true });
    writeFileSync(join(units(h), dir, name), text);
  };
  const cases: [string, (h: string) => void, RegExp][] = [
    ['a drop-in naming an all-interfaces bind', (h) => dropIn(h, 'ccrc.service.d', 'bind.conf', '[Service]\nEnvironment=CCRC_HOST=0.0.0.0\n'),
      /ccrc\.service\.d\/bind\.conf is a drop-in for ccrc\.service/],
    ['a drop-in for every user service', (h) => dropIn(h, 'service.d', 'all.conf', '[Service]\nEnvironment=CCRC_HOST=0.0.0.0\n'),
      /service\.d\/all\.conf is a drop-in for ccrc\.service/],
    ['an Environment= line in the unit itself', (h) => unit(h, 'Environment="CCRC_HOST=0.0.0.0" NODE_ENV=production\n'),
      /ccrc\.service sets CCRC_HOST in an Environment= line/],
    ['a PassEnvironment= line in the unit itself', (h) => unit(h, 'PassEnvironment=CCRC_ORIGIN\n'),
      /ccrc\.service passes CCRC_ORIGIN from the service manager \(PassEnvironment=\)/],
    ['an environment file beyond the two', (h) => unit(h, 'EnvironmentFile=-%h/.ccrc/more.env\n'),
      /ccrc\.service reads .*\/\.ccrc\/more\.env \(EnvironmentFile=\)/],
    ['a drop-in systemd loaded from another directory', (h) => writeFileSync(join(h, 'sd-dropins'), '/etc/systemd/user/ccrc.service.d/bind.conf'),
      /systemd loaded the drop-in \/etc\/systemd\/user\/ccrc\.service\.d\/bind\.conf for ccrc\.service/],
    ['an Environment= systemd loaded', (h) => writeFileSync(join(h, 'sd-environment'), 'NODE_ENV=production CCRC_HOST=0.0.0.0'),
      /systemd loaded ccrc\.service with CCRC_HOST in its Environment=/],
    ['an environment file systemd loaded beyond the two', (h) => writeFileSync(join(h, 'sd-envfiles'),
      `EnvironmentFiles=${join(h, '.ccrc', 'ccrc.env')} (ignore_errors=yes)\nEnvironmentFiles=/etc/ccrc/extra.env (ignore_errors=no)\n`),
      /systemd loaded ccrc\.service with the environment file \/etc\/ccrc\/extra\.env/],
    // Wave 190 fix round 1 (R5): the sources read asks PassEnvironment, and a loaded one refuses.
    ['a PassEnvironment systemd loaded', (h) => writeFileSync(join(h, 'sd-passenv'), 'NODE_OPTIONS CCRC_ORIGIN'),
      /systemd loaded ccrc\.service passing CCRC_ORIGIN from the service manager/],
    ["the user manager's own environment", (h) => writeFileSync(join(h, 'sd-manager-env'), `HOME=${h}\nCCRC_HOST=0.0.0.0\n`),
      /the user service manager's environment \(systemctl --user show-environment\) sets CCRC_HOST/],
  ];
  for (const [name, plant, words] of cases) {
    it(`refuses on and off: ${name}, naming the source and never a value`, async () => {
      const b = box('ccrc-auth-src-', portLines());
      plant(b.home);
      const before = bytes(envFile(b.home));
      for (const sub of ['on', 'off']) {
        const r = await runTty(b.home, ['auth', sub]);
        await expectRefused(b, r, before, words);
        expect(r.out).toMatch(/which this verb does not read/);
        expect(r.out).not.toMatch(/0\.0\.0\.0/);
      }
    });
  }

  // Wave 193: a drop-in on disk that systemd also lists as loaded is one source, named once (the de-duplication had no
  // case; review 4061 C5 moved it from the printed words to the paths themselves).
  it('names a drop-in on disk that systemd also loaded once, as the drop-in on disk', async () => {
    const b = box('ccrc-auth-src-dedupe-', portLines());
    dropIn(b.home, 'ccrc.service.d', 'bind.conf', '[Service]\nEnvironment=CCRC_HOST=0.0.0.0\n');
    writeFileSync(join(b.home, 'sd-dropins'), join(units(b.home), 'ccrc.service.d', 'bind.conf'));
    for (const sub of ['on', 'off']) {
      const r = await runTty(b.home, ['auth', sub]);
      await expectRefused(b, r, bytes(envFile(b.home)), /ccrc\.service\.d\/bind\.conf is a drop-in for ccrc\.service/);
      expect(r.out.match(/bind\.conf/g)).toHaveLength(1);
      expect(r.out).not.toMatch(/systemd loaded the drop-in/);
    }
  });

  it('refuses a drop-in directory it cannot list, and a service manager it cannot ask, as not measured', async () => {
    const a = box('ccrc-auth-src-unlisted-', portLines());
    mkdirSync(join(units(a.home), 'ccrc.service.d'));
    chmodSync(join(units(a.home), 'ccrc.service.d'), 0o000);
    try {
      for (const sub of ['on', 'off']) {
        await expectRefused(a, await runTty(a.home, ['auth', sub]), bytes(envFile(a.home)), /ccrc\.service\.d cannot be listed, so .* was not measured/);
      }
    } finally { chmodSync(join(units(a.home), 'ccrc.service.d'), 0o755); }
    const c = box('ccrc-auth-src-unasked-', portLines());
    writeFileSync(join(c.home, 'sd-show-fails'), '');
    await expectRefused(c, await runTty(c.home, ['auth', 'on']), bytes(envFile(c.home)), /systemctl --user show did not answer, so .* was not measured/);
  });

  // Review 3971 R1: the shipped shape is the installed unit untouched (its two EnvironmentFile= lines with %h). A hand
  // edit of it, even one naming no key, now refuses as not the installer's file (the next describe).
  it('passes the installed unit untouched, another key in what systemd loaded, and an empty drop-in directory', async () => {
    const b = box('ccrc-auth-src-shipped-', portLines());
    expect(readFileSync(join(units(b.home), 'ccrc.service'), 'latin1')).toBe(SHIPPED_UNIT);
    mkdirSync(join(units(b.home), 'ccrc.service.d'));
    writeFileSync(join(b.home, 'sd-environment'), 'NODE_ENV=production');
    const r = await runTty(b.home, ['auth', 'on']);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/sign-in is on/);
  });
});

// ── review 3971 R1: the verb acts only on the unit the installer lands ────────────────────────────────────────────
// `_inst_units` (and deploy.sh) copy the tree's deploy/ccrc.service to the user unit directory unchanged. A unit that
// is not that file byte for byte refuses, on and off alike, naming the file and never the difference: this closes the
// ExecStart edit (`env CCRC_HOST=0.0.0.0 node`) and every line the reading above parses differently from systemd. A unit
// systemd has not reloaded since it changed (NeedDaemonReload=yes), or a systemd that does not say, refuses too.
describe.skipIf(IS_DARWIN)('ccrc auth: the installed unit is the installer\'s, as systemd loaded it (review 3971 R1)', () => {
  const installed = (h: string): string => join(h, '.config', 'systemd', 'user', 'ccrc.service');
  const edits: [string, (u: string) => string][] = [
    ['an ExecStart= edit that binds every interface (env CCRC_HOST=0.0.0.0 before node)',
      (u) => u.replace('ExecStart=/usr/bin/env node', 'ExecStart=/usr/bin/env CCRC_HOST=0.0.0.0 node')],
    ["an Environment line with a space around '=', which systemd takes and the reading does not",
      (u) => u.replace('[Service]\n', '[Service]\nEnvironment = CCRC_HOST=0.0.0.0\n')],
    ['an Environment= line continued onto the next line',
      (u) => u.replace('[Service]\n', '[Service]\nEnvironment=NODE_ENV=production \\\n  CCRC_HOST=0.0.0.0\n')],
    ['an Environment= line with an escape in the name',
      (u) => u.replace('[Service]\n', '[Service]\nEnvironment=CCRC_\\x48OST=0.0.0.0\n')],
    ['an edit that names no key at all', (u) => u.replace('RestartSec=3', 'RestartSec=4')],
  ];
  for (const [name, edit] of edits) {
    it(`refuses on and off: ${name}, naming the file and never the difference`, async () => {
      const b = box('ccrc-auth-own-', portLines());
      writeFileSync(installed(b.home), edit(SHIPPED_UNIT));
      expect(readFileSync(installed(b.home), 'latin1')).not.toBe(SHIPPED_UNIT);
      const before = bytes(envFile(b.home));
      for (const sub of ['on', 'off']) {
        const r = await runTty(b.home, ['auth', sub]);
        await expectRefused(b, r, before, /ccrc\.service is not the unit file ccrc installs \(.*\/ccrc\/deploy\/ccrc\.service\), and this verb acts only on its own/);
        // Wave 190 A3: an update leaves a box already on its version alone, so it is no way on; ccrc install always
        // lands the tree's file and reloads systemd. Fix round 1 (R2): it names the role, and this box records none.
        expect(r.out).toMatch(/To go on: ccrc install --role <role> puts the shipped file back and reloads systemd \(an update does not, on a box already on its version; this box records no role, and a bare install takes role both\); or set the keys by hand \(the README's 'The session gate'\)/);
        expect(r.out).not.toMatch(/or an update, puts/);
        expect(r.out).not.toMatch(/0\.0\.0\.0|RestartSec/);
      }
    });
  }

  // Wave 190 fix round 1 (R2): a bare install takes role both and never reads the recorded role, so the way on names it.
  // Fix round 2 (R1): only a role word the install takes for a box this verb serves is printed; any other content is
  // never printed, and the sentence says the recorded role is not one the install takes. Each case asserts the whole
  // printed line, so nothing of the file's content can ride along.
  const ownLine = (h: string, fix: string, sub = 'on'): string =>
    `ccrc: auth ${sub}: ${installed(h)} is not the unit file ccrc installs (${join(h, 'ccrc', 'deploy', 'ccrc.service')}), and this `
    + `verb acts only on its own. To go on: ${fix}; or set the keys by hand (the README's 'The session gate'). Nothing was changed.`;
  const printed = (out: string): string => out.replace(/\r/g, '').trim();
  // Review 4061 C1: `both` is the other word the clamp prints, so it has a row of its own (the mutant that drops it from
  // the clamp was green without one); `server` and `both`, on and off alike.
  for (const role of ['server', 'both']) {
    it(`names the recorded role ${role} in the install that puts a hand-edited unit back, on and off`, async () => {
      const b = box('ccrc-auth-own-role-', `CCRC_ROLE=${role}\n${portLines()}`);
      writeFileSync(installed(b.home), `${SHIPPED_UNIT}# edited\n`);
      for (const sub of ['on', 'off']) {
        const r = await runTty(b.home, ['auth', sub]);
        await expectRefused(b, r, bytes(envFile(b.home)), /ccrc\.service is not the unit file ccrc installs/);
        expect(r.out).toContain(`To go on: ccrc install --role ${role} puts the shipped file back and reloads systemd (an update does not, on a box already on its version); or set`);
        expect(r.out).not.toMatch(/<role>|records no role/);
        expect(printed(r.out)).toBe(ownLine(b.home, `ccrc install --role ${role} puts the shipped file back and reloads systemd (an `
          + 'update does not, on a box already on its version)', sub));
      }
    });
  }

  // Review 4061 C2: the four rows run on `off` as well as `on`; the role check is the same arm for both.
  const notTaken: [string, string][] = [
    ['an unknown word', 'Server'],
    ['a shell metacharacter', 'server; touch /tmp/x'],
    ['a control character', 'server\x1b[31mRED'],
    ['a very long value', 'x'.repeat(3000)],
  ];
  for (const [name, value] of notTaken) {
    it(`never prints a recorded role the install does not take, on and off: ${name}`, async () => {
      const b = box('ccrc-auth-own-badrole-', `CCRC_ROLE=${value}\n${portLines()}`);
      writeFileSync(installed(b.home), `${SHIPPED_UNIT}# edited\n`);
      for (const sub of ['on', 'off']) {
        const r = await runTty(b.home, ['auth', sub]);
        await expectRefused(b, r, bytes(envFile(b.home)), /ccrc\.service is not the unit file ccrc installs/);
        expect(printed(r.out)).toBe(ownLine(b.home, 'ccrc install --role <role> puts the shipped file back and reloads systemd (an '
          + `update does not, on a box already on its version; the role ${envFile(b.home)} records is not one ccrc install takes, and a `
          + 'bare install takes role both)', sub));
        expect(r.out).not.toContain(value);
        expect(r.out).not.toMatch(/records no role/);
      }
    });
  }

  // Review 4061 C4: a ccrc.env that cannot be read records a role nobody read, which is not "no role": its own words.
  it('says an unreadable ccrc.env was not read for its role, never that it records none, on and off', async () => {
    const b = box('ccrc-auth-own-unread-', `CCRC_ROLE=server\n${portLines()}`);
    writeFileSync(installed(b.home), `${SHIPPED_UNIT}# edited\n`);
    const before = bytes(envFile(b.home));
    for (const sub of ['on', 'off']) {
      chmodSync(envFile(b.home), 0o000);
      let r: Result;
      try { r = await runTty(b.home, ['auth', sub]); } finally { chmodSync(envFile(b.home), 0o600); }
      await expectRefused(b, r, before, /ccrc\.service is not the unit file ccrc installs/);
      expect(printed(r.out)).toBe(ownLine(b.home, 'ccrc install --role <role> puts the shipped file back and reloads systemd (an '
        + `update does not, on a box already on its version; ${envFile(b.home)} cannot be read, so the role it records was not `
        + 'read, and a bare install takes role both)', sub));
      expect(r.out).not.toMatch(/records no role|is not one ccrc install takes/);
    }
  });

  it('refuses a unit systemd has not reloaded since it changed, and a systemd that does not say, naming the reload', async () => {
    const a = box('ccrc-auth-own-stale-', portLines());
    writeFileSync(join(a.home, 'sd-needreload'), 'yes\n');
    for (const sub of ['on', 'off']) {
      const r = await runTty(a.home, ['auth', sub]);
      await expectRefused(a, r, bytes(envFile(a.home)), /systemd has not loaded .*ccrc\.service as it is now \(NeedDaemonReload=yes\)/);
      expect(r.out).toMatch(/To go on: run systemctl --user daemon-reload, then re-run/);
    }
    // Wave 193 C6: no answer is not cured by a reload, so the way on says there is none from here and names the hand route.
    const c = box('ccrc-auth-own-unsaid-', portLines());
    writeFileSync(join(c.home, 'sd-needreload-fails'), '');
    for (const sub of ['on', 'off']) {
      const r = await runTty(c.home, ['auth', sub]);
      await expectRefused(c, r, bytes(envFile(c.home)),
        /systemctl --user show did not say whether systemd loaded .*ccrc\.service as it is now \(NeedDaemonReload\), so what the restart would apply was not measured/);
      expect(r.out).toMatch(/To go on: this systemd does not answer NeedDaemonReload, so this verb cannot prove the unit on this box; set the keys by hand \(the README's 'The session gate'\)\. Nothing was changed\./);
      expect(r.out).not.toMatch(/daemon-reload/);
    }
  });

  // Wave 190 F1: the compare and the reload answer say nothing of WHICH file systemd loaded. A unit of the same name
  // earlier on the user search path (measured on systemd 259: the control directories, the runtime transient directory
  // and the early generators come before ~/.config/systemd/user) passes both, so the read that asks NeedDaemonReload
  // asks FragmentPath and SourcePath too, and the verb acts only when systemd names the user unit directory's own file.
  const loadedElsewhere: [string, (h: string) => string][] = [
    ['the user control directory (~/.config/systemd/user.control)', (h) => join(h, '.config', 'systemd', 'user.control', 'ccrc.service')],
    ['the runtime transient directory (/run/user/<uid>/systemd/transient)', () => '/run/user/1000/systemd/transient/ccrc.service'],
    // Wave 190 fix round 1 (R5): the same directory, another file (an alias to a sibling): the file must be the unit.
    ['another file in the user unit directory', (h) => join(h, '.config', 'systemd', 'user', 'other.service')],
  ];
  for (const [name, frag] of loadedElsewhere) {
    it(`refuses on and off: systemd loaded ccrc.service from ${name}, naming both files`, async () => {
      const b = box('ccrc-auth-frag-', portLines());
      writeFileSync(join(b.home, 'sd-fragment'), `FragmentPath=${frag(b.home)}\n`);
      const before = bytes(envFile(b.home));
      for (const sub of ['on', 'off']) {
        const r = await runTty(b.home, ['auth', sub]);
        await expectRefused(b, r, before, /systemd loaded ccrc\.service from .*, not from .*\/\.config\/systemd\/user\/ccrc\.service, the file this verb read/);
        expect(r.out).toContain(frag(b.home));
        expect(r.out).toMatch(/To go on: take that unit away .*run systemctl --user daemon-reload, then re-run/);
      }
    });
  }

  it('refuses on and off: a unit systemd made from another source (SourcePath), naming it', async () => {
    const b = box('ccrc-auth-frag-source-', portLines());
    writeFileSync(join(b.home, 'sd-sourcepath'), 'SourcePath=/etc/init.d/ccrc\n');
    for (const sub of ['on', 'off']) {
      const r = await runTty(b.home, ['auth', sub]);
      await expectRefused(b, r, bytes(envFile(b.home)), /systemd made ccrc\.service from \/etc\/init\.d\/ccrc \(SourcePath\)/);
    }
  });

  // Wave 190 fix round 1 (R1): an empty SourcePath is no other source; no SourcePath line at all is no answer.
  it('refuses as not measured a read that prints no SourcePath line', async () => {
    const b = box('ccrc-auth-src-unsaid-', portLines());
    writeFileSync(join(b.home, 'sd-sourcepath'), '');
    for (const sub of ['on', 'off']) {
      const r = await runTty(b.home, ['auth', sub]);
      await expectRefused(b, r, bytes(envFile(b.home)),
        /systemctl --user show did not say whether systemd made ccrc\.service from another source \(SourcePath\), so what the restart would apply was not measured/);
      // Fix round 2 (R3): a reload cannot make the manager print a property it left out, so the way on is the hand route.
      expect(r.out).toMatch(/To go on: this systemd does not answer SourcePath, so this verb cannot prove the unit on this box; set the keys by hand \(the README's 'The session gate'\)\. Nothing was changed/);
      expect(r.out).not.toMatch(/daemon-reload/);
    }
  });

  // Fix round 2 (R2): the no-SourcePath arm comes after the FragmentPath compare, so a unit loaded from elsewhere is
  // refused for that, whatever the SourcePath answer.
  it('refuses a fragment loaded elsewhere for that, even when the read prints no SourcePath line', async () => {
    const b = box('ccrc-auth-frag-src-unsaid-', portLines());
    writeFileSync(join(b.home, 'sd-fragment'), 'FragmentPath=/run/user/1000/systemd/transient/ccrc.service\n');
    writeFileSync(join(b.home, 'sd-sourcepath'), '');
    for (const sub of ['on', 'off']) {
      const r = await runTty(b.home, ['auth', sub]);
      await expectRefused(b, r, bytes(envFile(b.home)),
        /systemd loaded ccrc\.service from \/run\/user\/1000\/systemd\/transient\/ccrc\.service, not from .*\/\.config\/systemd\/user\/ccrc\.service, the file this verb read/);
      expect(r.out).not.toMatch(/SourcePath/);
    }
  });

  it('refuses as not measured an empty FragmentPath answer, and no FragmentPath line at all', async () => {
    for (const answer of ['FragmentPath=\n', '']) {
      const b = box('ccrc-auth-frag-unsaid-', portLines());
      writeFileSync(join(b.home, 'sd-fragment'), answer);
      for (const sub of ['on', 'off']) {
        const r = await runTty(b.home, ['auth', sub]);
        await expectRefused(b, r, bytes(envFile(b.home)),
          /systemctl --user show did not say which file systemd loaded for ccrc\.service \(FragmentPath\), so what the restart would apply was not measured/);
        // Wave 193 C6: a reload does not make systemd name a file, so the way on names the hand route, never the reload.
        expect(r.out).toMatch(/To go on: this systemd names no file it loaded for ccrc\.service, and a reload does not make it name one, so this verb cannot prove the unit on this box; set the keys by hand \(the README's 'The session gate'\)\. Nothing was changed\./);
        expect(r.out).not.toMatch(/daemon-reload/);
      }
    }
  });

  it('passes when systemd names the user unit directory\'s own file, asked in the same read as the reload answer', async () => {
    const b = box('ccrc-auth-frag-own-', portLines());
    const r = await runTty(b.home, ['auth', 'on']);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/sign-in is on/);
    const asks = readFileSync(join(b.home, 'systemctl-argv'), 'utf8').split('\n').filter((l) => / -p NeedDaemonReload\b/.test(l));
    expect(asks).toHaveLength(1);
    expect(asks[0]).toMatch(/ -p FragmentPath\b/);
    expect(asks[0]).toMatch(/ -p SourcePath\b/);
  });

  it('refuses as not measured when the tree\'s own unit file cannot be read', async () => {
    const b = box('ccrc-auth-own-notree-', portLines());
    spawnSync('rm', ['-f', join(b.home, 'ccrc', 'deploy', 'ccrc.service')]);
    await expectRefused(b, await runTty(b.home, ['auth', 'on']), bytes(envFile(b.home)),
      /ccrc\/deploy\/ccrc\.service, the unit file ccrc installs, cannot be read, so whether .* is that file was not measured/);
  });
});

// ── review 3971 R1(d), the coordinator's ruling B: not on a Mac yet ──────────────────────────────────────────────
// Two fields of the launchd job belong to the moment of the install, so the job file cannot be proved the installer's:
// on a Mac the verb refuses before any read of the box, with the hand route, and the helper that offers it declines.
// `ccrc` takes its platform from bash's OSTYPE, so darwin is set after sourcing (the unit reader's own harness) and these
// run on every platform. Wave 193: the Mac refusal of review 3971's ruling B is gone where the proof can be made; the
// helper's rows below are the function-level ones, and the Mac's end-to-end rows follow in their own describe.
describe('ccrc auth: the helper that offers the verb, function by function (wave 190 A4, wave 193 g)', () => {
  /** A loopback server box (ccrc.env, the installed unit), then `body` run in a bash that sourced ccrc with `os` set. */
  function asFunction(os: 'linux' | 'darwin', body: string,
    opts: { path?: (dir: string) => string; plant?: (dir: string) => void; prefix?: string } = {}):
  { rc: number; err: string; env: string | null; calls: string; lock: boolean } {
    const dir = mkTmp(opts.prefix ?? 'ccrc-auth-mac-');
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    mkdirSync(join(dir, '.ccrc'), { recursive: true });
    writeFileSync(join(dir, '.ccrc', 'ccrc.env'), 'CCRC_HOST=127.0.0.1\nCCRC_PORT=7788\n', { mode: 0o600 });
    // What the installer lands (wave 190 A4: the helper asks the compare half): the tree's unit file, and its copy.
    mkdirSync(join(dir, 'ccrc', 'deploy'), { recursive: true });
    copyFileSync(SHIPPED_UNIT_SRC, join(dir, 'ccrc', 'deploy', 'ccrc.service'));
    mkdirSync(join(dir, '.config', 'systemd', 'user'), { recursive: true });
    copyFileSync(SHIPPED_UNIT_SRC, join(dir, '.config', 'systemd', 'user', 'ccrc.service'));
    for (const m of ['launchctl', 'systemctl']) {
      writeFileSync(join(bin, m), `#!/bin/sh\nprintf '%s %s\\n' ${m} "$*" >> "$HOME/calls"; exit 90\n`, { mode: 0o755 });
    }
    opts.plant?.(dir);
    const script = [`. ${JSON.stringify(CCRC_SRC)}`, `CCD_OS=${os}`, body].join('\n');
    const PATH = opts.path ? `${bin}:${opts.path(dir)}` : `${bin}:${process.env['PATH'] ?? '/usr/bin:/bin'}`;
    const r = spawnSync(BASH, ['-c', script], { encoding: 'utf8', env: { HOME: dir, PATH } });
    const calls = existsSync(join(dir, 'calls')) ? readFileSync(join(dir, 'calls'), 'utf8') : '';
    return { rc: r.status ?? -1, err: r.stderr, env: bytes(join(dir, '.ccrc', 'ccrc.env')), calls,
      lock: existsSync(join(dir, '.ccrc', 'update.lock')) };
  }
  // Doctor's `auth` line and install's gate line ask only this helper, so it decides for both surfaces.
  // Wave 190 A4: the helper asks the installer's-unit proof's compare half, which needs no service manager, so doctor and
  // install no longer offer the verb on a Linux box whose installed unit is not the tree's file. One row per reason it
  // declines there; the untouched unit is the control.
  it.each([
    ['the installed unit edited by hand', (d: string): void => {
      const u = join(d, '.config', 'systemd', 'user', 'ccrc.service');
      writeFileSync(u, readFileSync(u, 'latin1').replace('RestartSec=3', 'RestartSec=4'));
    }],
    ["the tree's own unit file missing", (d: string): void => { spawnSync('rm', ['-f', join(d, 'ccrc', 'deploy', 'ccrc.service')]); }],
    ['cmp exiting 2 (the compare failed)', (d: string): void => {
      writeFileSync(join(d, 'bin', 'cmp'), '#!/bin/sh\nexit 2\n', { mode: 0o755 });
    }],
  ] as const)('the helper that offers the verb, on linux, answers 1 for %s', (_name, plant) => {
    const r = asFunction('linux', '_auth_fits_here "$HOME/.config/systemd/user"; echo "rc=$?" >&2', { plant });
    expect(r.err).toContain('rc=1');
    expect(r.calls).toBe('');
  });

  it('the helper that offers the verb, on linux, answers 1 with no cmp on PATH', () => {
    const r = asFunction('linux', '_auth_fits_here "$HOME/.config/systemd/user"; echo "rc=$?" >&2',
      { path: (d) => pathWithout(d, 'cmp') });
    expect(r.err).toContain('rc=1');
  });

  // Wave 193 g: on a Mac the helper offers the verb where it would act, asking what needs no service manager: the job
  // file's proof (its reproducible part and its two fields), the reach read and the keys, through the reader that holds
  // ccrc.env to plain assignments (B3). The box that fits on Linux fits on a Mac with the job the writer prints; each
  // reason it declines there has a row.
  const macFits = (plant: (d: string) => void = () => {}, prefix?: string): string => asFunction('darwin', [
    'BOX_UNIT_DIR="$HOME/Library/LaunchAgents"',
    `_inst_plist_server ${MAC_LABEL} "$HOME/.ccrc/logs/${MAC_LABEL}.log" server ${JSON.stringify(JOB_PATH)} Background > "$BOX_UNIT_DIR/${MAC_LABEL}.plist"`,
    'm=$(cat "$HOME/mac-edit" 2>/dev/null) && [ -z "$m" ] || eval "$m"',
    '_auth_fits_here "$BOX_UNIT_DIR"; echo "rc=$?" >&2',
  ].join('\n'), { prefix, plant: (d) => { mkdirSync(join(d, 'Library', 'LaunchAgents'), { recursive: true }); plant(d); } }).err;
  it.each([['linux', 0], ['darwin', 0]] as const)('the helper that offers the verb, on %s, answers %i', (os, want) => {
    const err = os === 'darwin' ? macFits() : asFunction(os, '_auth_fits_here "$HOME/.config/systemd/user"; echo "rc=$?" >&2').err;
    expect(err).toContain(`rc=${want}`);
  });
  it.each([
    ['the job edited by hand', `printf '<!-- edited -->\\n' >> "$BOX_UNIT_DIR/${MAC_LABEL}.plist"`],
    ['a PATH entry this verb does not read', `printf '%s' "$(sed 's#<string>/usr/bin:#<string>.:/usr/bin:#' "$BOX_UNIT_DIR/${MAC_LABEL}.plist")" > "$BOX_UNIT_DIR/j" && printf '\\n' >> "$BOX_UNIT_DIR/j" && mv "$BOX_UNIT_DIR/j" "$BOX_UNIT_DIR/${MAC_LABEL}.plist"`],
    ['a ccrc.env line that is not a plain assignment (B3)', 'printf \'CCRC_X=$(id)\\n\' >> "$HOME/.ccrc/ccrc.env"'],
    ['a foreign CCRC_ORIGIN', 'printf \'CCRC_ORIGIN=https://box.example.com\\n\' >> "$HOME/.ccrc/ccrc.env"'],
  ] as const)('the helper that offers the verb, on darwin, answers 1 for %s', (_name, edit) => {
    expect(macFits((d) => writeFileSync(join(d, 'mac-edit'), edit))).toContain('rc=1');
  });
  // A2: the verb refuses a home outside the closed form before any read, so the helper does not offer it there either.
  it('the helper that offers the verb, on darwin, answers 1 for a home whose path holds a space', () => {
    expect(macFits(() => {}, 'ccrc-auth-mac-sp ace-')).toContain('rc=1');
  });
});

// ── wave 193: on a Mac, the job proved (issue #3475) ──────────────────────────────────────────────────────────────
// The verb acts on a Mac where it can prove the job: the job file is what the installer's writer prints for this home
// but for its PATH and ProcessType, each held to a closed grammar; launchd holds that file as it is; the domain sets
// none of the keys. Every row runs on darwin: real on the macOS leg, simulated on Linux.
describe(`ccrc auth on a Mac: the job proved (wave 193) [${IS_DARWIN ? 'darwin' : 'darwin, simulated'}]`, () => {
  beforeAll(() => { PLAT = 'darwin'; });
  afterAll(() => { PLAT = HOST_PLAT; });
  const job = (h: string): string => readFileSync(macJobFile(h), 'latin1');
  const NOT_JOB = /app\.ccrc\.ccrc\.plist is not the job ccrc installs, and this verb acts only on its own\. To go on: ccrc install --role <role> puts the shipped job back and loads it into launchd/;

  it('turns sign-in on and off: the four lines, one kickstart each, and the proof, with no systemd asked', async () => {
    const b = box('ccrc-auth-mac-', portLines());
    const before = bytes(envFile(b.home));
    const on = await runTty(b.home, ['auth', 'on']);
    expect(on.code, on.out).toBe(0);
    expect(bytes(envFile(b.home))).toBe(`${before}${ON_LINES(PORT)}`);
    expect(statSync(envFile(b.home)).mode & 0o777).toBe(0o600);
    expect(restarts(b.home)).toEqual([RESTART]);
    expect(on.out).toMatch(/the server at 127\.0\.0\.1:\d+ answers with sign-in on/);
    const off = await runTty(b.home, ['auth', 'off']);
    expect(off.code, off.out).toBe(0);
    expect(bytes(envFile(b.home))).toBe(before);
    expect(restarts(b.home)).toEqual([RESTART, RESTART]);
    expect(existsSync(join(b.home, 'systemctl-argv'))).toBe(false);
    expect(leftovers(b.home)).toEqual([]);
  });

  // B3: on a Mac the job sources ccrc.env with bash, and what the verb leaves is plain to that reader, both states.
  it("leaves ccrc.env plain to the Mac's reader after on and after off, each key read back as written", async () => {
    const b = box('ccrc-auth-mac-plain-', portLines());
    const readBack = (): string => spawnSync(BASH, ['-c', `. "$1"; CCD_OS=darwin; _box_env_shell_plain "$HOME/.ccrc/ccrc.env" && echo plain; `
      + 'for k in CCRC_AUTH CCRC_RP_ID CCRC_ORIGIN CCRC_COOKIE_INSECURE; do _box_unit_env $k; echo "$k=$BUE_VAL rc=$?"; done',
    'check', CCRC_SRC], { env: { HOME: b.home, PATH: process.env['PATH'] ?? '' }, encoding: 'utf8' }).stdout;
    expect((await runTty(b.home, ['auth', 'on'])).code).toBe(0);
    expect(readBack()).toBe(`plain\nCCRC_AUTH=on rc=0\nCCRC_RP_ID=localhost rc=0\nCCRC_ORIGIN=http://localhost:${PORT} rc=0\nCCRC_COOKIE_INSECURE=on rc=0\n`);
    expect((await runTty(b.home, ['auth', 'off'])).code).toBe(0);
    expect(readBack()).toBe('plain\nCCRC_AUTH= rc=0\nCCRC_RP_ID= rc=0\nCCRC_ORIGIN= rc=0\nCCRC_COOKIE_INSECURE= rc=0\n');
  });

  // a, A1: what an install writes and what a hand edit does are told apart. Each row: on and off refuse, the job file
  // named, its bytes never printed.
  const edits: [string, (j: string) => string][] = [
    ['a key added to its EnvironmentVariables', (j) => j.replace('    <key>HOME</key>', '    <key>NODE_OPTIONS</key><string>--require /tmp/x.js</string>\n    <key>HOME</key>')],
    ['its shell line binding every interface', (j) => j.replace('exec /usr/bin/env node', 'exec /usr/bin/env CCRC_HOST=0.0.0.0 node')],
    ['a job written by an older writer (no core limits)', (j) => j.replace(/ {2}<key>SoftResourceLimits<\/key>[\s\S]*?<\/dict>\n {2}<key>HardResourceLimits<\/key>[\s\S]*?<\/dict>\n/, '')],
    ['the same job re-serialised with tabs', (j) => j.replace(/^ {2}/gm, '\t')],
    ['CRLF line endings', (j) => j.replace(/\n/g, '\r\n')],
    ['no newline after its last line', (j) => j.replace(/\n$/, '')],
    ['a binary plist', () => 'bplist00\u00d4\u0001\u0002\u0003\u0000\u0000\u0000\u0008Label'],
    ['a ProcessType that is not one of the four words', (j) => j.replace('<string>Background</string>', '<string>Batch</string>')],
  ];
  for (const [name, edit] of edits) {
    it(`refuses on and off a job file that is not the installer's: ${name}, naming the file, never a byte of it`, async () => {
      const b = box('ccrc-auth-mac-edit-', portLines());
      writeFileSync(macJobFile(b.home), edit(job(b.home)), 'latin1');
      const before = bytes(envFile(b.home));
      for (const sub of ['on', 'off']) {
        const r = await runTty(b.home, ['auth', sub]);
        await expectRefused(b, r, before, NOT_JOB);
        expect(r.out).not.toMatch(/NODE_OPTIONS|0\.0\.0\.0|Batch|bplist/);
      }
    });
  }

  // A1: a PATH field outside its grammar is not cured by an install from the same shell, so its way on says so.
  const badPaths: [string, string][] = [
    ['a relative entry', '/usr/bin:.'], ['an empty entry', '/usr/bin::/bin'], ['an empty entry at its end', '/usr/bin:/sbin:'],
    ['an entity', '/usr/bin:/x&amp;y'],
    ['a quote', "/usr/bin:/it's"], ['a double quote', '/usr/bin:/a"b'], ['a backslash', '/usr/bin:/a\\b'],
    ['a tab', '/usr/bin:/a\tb'], ['a byte above ASCII', '/usr/bin:/caf\u00e9'],
    ['a second key', '/usr/bin</string><key>NODE_OPTIONS</key><string>--require=/x'],
  ];
  for (const [name, value] of badPaths) {
    it(`refuses on and off a job whose PATH holds ${name}, with a way on that is not the same install`, async () => {
      const b = box('ccrc-auth-mac-path-', portLines());
      writeJob(b.home, value);
      const before = bytes(envFile(b.home));
      for (const sub of ['on', 'off']) {
        const r = await runTty(b.home, ['auth', sub]);
        await expectRefused(b, r, before, /the PATH in .*app\.ccrc\.ccrc\.plist holds an entry this verb does not read as a plain absolute directory/);
        expect(r.out).toMatch(/To go on: an install puts the PATH of the shell it runs in into the job, so run ccrc install --role <role> from a shell whose PATH holds only absolute directories/);
        expect(r.out).not.toMatch(/puts the shipped job back/);
        for (const part of value.split(':').filter((s) => s.length >= 4 && !['/usr/bin', '/sbin', '/bin'].includes(s))) expect(r.out).not.toContain(part);
      }
    });
  }

  it('acts on a job whose PATH holds an app bundle\'s directory (a space) and whose ProcessType is Interactive', async () => {
    const b = box('ccrc-auth-mac-bundle-', portLines());
    const p = '/usr/bin:/Applications/Some App.app/Contents/Resources/bin:/bin';
    writeFileSync(join(b.home, 'lc-print'), printOf(b.home, writeJob(b.home, p, 'Interactive'), { env: [['PATH', p], ['HOME', b.home]] }));
    const r = await runTty(b.home, ['auth', 'on']);
    expect(r.code, r.out).toBe(0);
  });

  // A3 (ruled: option 1, the Mac only): launchd loads the file a link names, which this verb did not read. The link
  // refuses at the job-file proof, before launchd is asked what it holds; the regular file the box plants passes (the
  // first row of this describe).
  it('refuses on and off a job file that is a link, even to an equal file, before asking launchd', async () => {
    const b = box('ccrc-auth-mac-link-', portLines());
    renameSync(macJobFile(b.home), join(b.home, 'job-elsewhere.plist'));
    symlinkSync(join(b.home, 'job-elsewhere.plist'), macJobFile(b.home));
    for (const sub of ['on', 'off']) {
      const r = await runTty(b.home, ['auth', sub]);
      await expectRefused(b, r, bytes(envFile(b.home)),
        /app\.ccrc\.ccrc\.plist is a symlink, and launchd loads the job from the file it names, which this verb did not read/);
      expect(r.out).toMatch(/To go on: ccrc install --role <role> writes the shipped job in its place and loads it into launchd/);
    }
    expect(readFileSync(join(b.home, 'launchctl-argv'), 'utf8')).not.toMatch(/^print /m);
  });

  it('refuses as not measured a job file it cannot read', async () => {
    const b = box('ccrc-auth-mac-unread-', portLines());
    chmodSync(macJobFile(b.home), 0o000);
    try {
      await expectRefused(b, await runTty(b.home, ['auth', 'on']), bytes(envFile(b.home)),
        /app\.ccrc\.ccrc\.plist cannot be read, so whether it is the job ccrc installs was not measured/);
    } finally { chmodSync(macJobFile(b.home), 0o644); }
  });

  // A4: the role printed in a way on is the clamped one, on a Mac too. (A role holding a control byte never gets that
  // far there: the job's reader refuses its line as not a plain assignment, naming the line and not the value.)
  for (const [role, fix] of [['server', '--role server'], ['both', '--role both'], ['Server', '--role <role>'], ['servers', '--role <role>']] as const) {
    it(`names the recorded role only when it is server or both: ${role}, on and off`, async () => {
      const b = box('ccrc-auth-mac-role-', `CCRC_ROLE=${role}\n${portLines()}`);
      writeFileSync(macJobFile(b.home), `${job(b.home)}<!-- edited -->\n`);
      for (const sub of ['on', 'off']) {
        const r = await runTty(b.home, ['auth', sub]);
        await expectRefused(b, r, bytes(envFile(b.home)), /app\.ccrc\.ccrc\.plist is not the job ccrc installs, and this verb acts only on its own/);
        expect(r.out).toContain(`To go on: ccrc install ${fix} puts the shipped job back and loads it into launchd`);
        if (fix === '--role <role>') expect(r.out).not.toContain(`--role ${role}`);
      }
    });
  }

  // b: what launchd holds is the file just compared. Each row plants launchd's answer; on and off refuse.
  const held: [string, (h: string, j: string) => string, RegExp][] = [
    ['from another file', (h, j) => printOf(h, j, { path: '/Library/LaunchAgents/app.ccrc.ccrc.plist' }),
      /launchd holds the job app\.ccrc\.ccrc from \/Library\/LaunchAgents\/app\.ccrc\.ccrc\.plist, not from .*app\.ccrc\.ccrc\.plist, the file this verb read/],
    ['with other arguments (a bind in its shell line)', (h, j) => printOf(h, j, { args: jobArgs(j).map((a) => a.replace('env node', 'env CCRC_HOST=0.0.0.0 node')) }),
      /launchd holds the job app\.ccrc\.ccrc with another program or other arguments than/],
    ['with another program', (h, j) => printOf(h, j, { program: '/bin/zsh' }), /with another program or other arguments than/],
    ['with a key of its own in its environment', (h, j) => printOf(h, j, { env: [['PATH', JOB_PATH], ['HOME', h], ['NODE_OPTIONS', '--require /tmp/x.js']] }),
      /launchd holds the job app\.ccrc\.ccrc with NODE_OPTIONS in its own environment, which .*app\.ccrc\.ccrc\.plist does not set/],
    ['with XPC_SERVICE_NAME holding another label', (h, j) => printOf(h, j, { env: [['PATH', JOB_PATH], ['HOME', h], ['XPC_SERVICE_NAME', 'app.other']] }),
      /launchd holds the job app\.ccrc\.ccrc with XPC_SERVICE_NAME in its own environment, which .*app\.ccrc\.ccrc\.plist does not set/],
    ['with a fourth key beside XPC_SERVICE_NAME', (h, j) => printOf(h, j, { env: [['PATH', JOB_PATH], ['HOME', h], ['XPC_SERVICE_NAME', MAC_LABEL], ['BASH_ENV', '/tmp/x']] }),
      /launchd holds the job app\.ccrc\.ccrc with BASH_ENV in its own environment/],
    // Wave 193 fix round (ruling 40092): OSLogRateLimit only by its exact name, holding one to nine digits.
    ...([['a word', 'abc'], ['nothing', ''], ['ten digits', '1234567890'], ['a space', '1 2']] as const).map(([what, v]):
      [string, (h: string, j: string) => string, RegExp] => [`with OSLogRateLimit holding ${what}`,
      (h, j) => printOf(h, j, { env: [['OSLogRateLimit', v], ['PATH', JOB_PATH], ['HOME', h], ['XPC_SERVICE_NAME', MAC_LABEL]] }),
      /launchd holds the job app\.ccrc\.ccrc with OSLogRateLimit in its own environment, which .*app\.ccrc\.ccrc\.plist does not set/]),
    ...(['oslogratelimit', 'XOSLogRateLimit', 'OSLogRateLimitX'] as const).map((k): [string, (h: string, j: string) => string, RegExp] =>
      [`with ${k}, not the measured key's exact name`,
        (h, j) => printOf(h, j, { env: [[k, '64'], ['PATH', JOB_PATH], ['HOME', h], ['XPC_SERVICE_NAME', MAC_LABEL]] }),
        new RegExp(`launchd holds the job app\\.ccrc\\.ccrc with ${k} in its own environment`)]),
    ['with another PATH', (h, j) => printOf(h, j, { env: [['PATH', '/tmp/evil:/usr/bin'], ['HOME', h]] }), /with another PATH or HOME in its environment than/],
    ['with another HOME', (h, j) => printOf(h, j, { env: [['PATH', JOB_PATH], ['HOME', '/tmp/elsewhere']] }), /with another PATH or HOME in its environment than/],
  ];
  for (const [name, print, words] of held) {
    it(`refuses on and off a job launchd holds ${name}, naming the reason and never a value`, async () => {
      const b = box('ccrc-auth-mac-held-', portLines());
      writeFileSync(join(b.home, 'lc-print'), print(b.home, job(b.home)));
      for (const sub of ['on', 'off']) {
        const r = await runTty(b.home, ['auth', sub]);
        await expectRefused(b, r, bytes(envFile(b.home)), words);
        expect(r.out).toMatch(/To go on: ccrc install --role <role> loads the job file into launchd again/);
        expect(r.out).not.toMatch(/0\.0\.0\.0|\/tmp\/evil|\/tmp\/elsewhere|zsh|--require|app\.other|\/tmp\/x/);
      }
    });
  }
  it('acts on the block a real launchd drew: OSLogRateLimit, PATH, HOME and XPC_SERVICE_NAME (wave 193 fix round)', async () => {
    const b = box('ccrc-auth-mac-measured-', portLines());
    writeFileSync(join(b.home, 'lc-print'), printOf(b.home, job(b.home)));
    expect(readFileSync(join(b.home, 'lc-print'), 'utf8')).toContain('\t\tOSLogRateLimit => 64\n');
    const r = await runTty(b.home, ['auth', 'on']);
    expect(r.code, r.out).toBe(0);
  });
  it("acts on a job whose environment launchd also gives XPC_SERVICE_NAME, holding the job's label", async () => {
    const b = box('ccrc-auth-mac-xpc-', portLines());
    writeFileSync(join(b.home, 'lc-print'), printOf(b.home, job(b.home), { env: [['PATH', JOB_PATH], ['HOME', b.home], ['XPC_SERVICE_NAME', MAC_LABEL]] }));
    const r = await runTty(b.home, ['auth', 'on']);
    expect(r.code, r.out).toBe(0);
  });
  it('refuses a job launchd does not hold (no such service), with the install as the way on', async () => {
    const b = box('ccrc-auth-mac-notheld-', portLines());
    writeFileSync(join(b.home, 'lc-not-held'), '');
    for (const sub of ['on', 'off']) {
      const r = await runTty(b.home, ['auth', sub]);
      await expectRefused(b, r, bytes(envFile(b.home)), /launchd holds no job app\.ccrc\.ccrc \(launchctl print: no such service\)/);
      expect(r.out).toMatch(/To go on: ccrc install --role <role> loads the job file into launchd again/);
    }
  });
  const SAID_ALL = /launchctl print gui\/\d+\/app\.ccrc\.ccrc did not say all of the job's path, program, arguments and environment, so what launchd holds/;
  for (const [name, plant, words] of [
    ['a print that fails', (h: string) => writeFileSync(join(h, 'lc-print-fails'), ''),
      /launchctl print gui\/\d+\/app\.ccrc\.ccrc did not answer, so what launchd holds for the job was not measured/],
    ['a print with no path line', (h: string) => writeFileSync(join(h, 'lc-print'), printOf(h, job(h)).replace(/\tpath = .*\n/, '')), SAID_ALL],
    ['a print with no environment block', (h: string) => writeFileSync(join(h, 'lc-print'), printOf(h, job(h)).replace(/\tenvironment = \{\n[\s\S]*?\t\}\n/, '')), SAID_ALL],
  ] as const) {
    it(`refuses as not measured ${name}, saying there is no way on from here but the hand route`, async () => {
      const b = box('ccrc-auth-mac-unprinted-', portLines());
      plant(b.home);
      const r = await runTty(b.home, ['auth', 'on']);
      await expectRefused(b, r, bytes(envFile(b.home)), words);
      expect(r.out).toMatch(/this verb cannot prove the job on this box without that read; set the keys by hand/);
    });
  }

  // b: the domain's own environment, which every job of the domain inherits.
  for (const key of ['CCRC_HOST', 'CCRC_ORIGIN', 'BASH_ENV']) {
    it(`refuses on and off a domain whose environment sets ${key}, naming the key, never its value`, async () => {
      const b = box('ccrc-auth-mac-domain-', portLines());
      writeFileSync(join(b.home, 'lc-domain-env'), `${key}=/tmp/value-of-${key}\n`);
      for (const sub of ['on', 'off']) {
        const r = await runTty(b.home, ['auth', sub]);
        await expectRefused(b, r, bytes(envFile(b.home)), new RegExp(`launchd's own environment \\(launchctl getenv\\) sets ${key}`));
        expect(r.out).not.toContain('/tmp/value-of');
      }
    });
  }
  it('refuses as not measured a domain read that does not answer', async () => {
    const b = box('ccrc-auth-mac-domain-unasked-', portLines());
    writeFileSync(join(b.home, 'lc-getenv-fails'), '');
    await expectRefused(b, await runTty(b.home, ['auth', 'on']), bytes(envFile(b.home)), /launchctl getenv CCRC_HOST did not answer, so launchd's own environment was not read/);
  });

  // d: a failed kickstart is a failed restart, and takes the restore path.
  it('puts the file back when the kickstart fails (the job not held at restart time), exit 1', async () => {
    const b = box('ccrc-auth-mac-kick-', portLines());
    writeFileSync(join(b.home, 'lc-kick-fails'), '');
    const before = bytes(envFile(b.home));
    const r = await runTty(b.home, ['auth', 'on']);
    expect(r.code, r.out).toBe(1);
    expect(r.out).toMatch(/the restarted console did not prove the change: the restart command failed \(launchctl kickstart -k gui\/\d+\/app\.ccrc\.ccrc\)/);
    expect(bytes(envFile(b.home))).toBe(before);
    expect(leftovers(b.home)).toEqual([]);
  });

  // A2: the installer writes the home raw into the job file and into its shell line in single quotes.
  for (const [name, mark] of [['a quote', "hq'uote"], ['an ampersand', 'ha&mp'], ['a space', 'hsp ace']] as const) {
    it(`refuses, before any read of the box, a home whose path holds ${name}, naming no byte of it`, async () => {
      const b = box(`ccrc-auth-mac-${mark}-`, portLines());
      for (const sub of ['on', 'off']) {
        const r = await runTty(b.home, ['auth', sub]);
        expect(r.code, r.out).toBe(1);
        expect(r.out).toMatch(new RegExp(`auth ${sub}: this home's path holds a byte other than a letter, a digit or one of \\._/@:\\+,%=~-\\[\\], and ccrc writes it into the console's job file`));
        expect(r.out).not.toContain(mark);
      }
      expect(existsSync(join(b.home, 'launchctl-argv'))).toBe(false);
      expect(existsSync(join(b.home, '.ccrc', 'update.lock'))).toBe(false);
    });
  }

  // B3: on a Mac every key the verb reads goes through the reader of the job's bash sourcing, and an unmeasured answer
  // for any one of them refuses, on and off, before a write.
  it('refuses on and off a ccrc.env line that is not a plain assignment, before a write', async () => {
    const b = box('ccrc-auth-mac-notplain-', `${portLines()}CCRC_X=$(id)\n`);
    for (const sub of ['on', 'off']) {
      await expectRefused(b, await runTty(b.home, ['auth', sub]), bytes(envFile(b.home)),
        /line 3 is not a plain NAME=value line, and on macOS the launchd job sources both env files with bash/);
    }
  });
  const KEYS_ON = ['CCRC_HOST', 'CCRC_PORT', 'CCRC_AUTH', 'CCRC_RP_ID', 'CCRC_ORIGIN', 'CCRC_COOKIE_INSECURE', 'CCRC_SESSIONS_PATH', 'CCRC_AUTH_SECRET_PATH'];
  /** cmd_auth in a darwin harness whose job reader logs each key and answers unmeasured (rc 3) for `bad`. Not spawnSync:
   *  the console this process plays must answer while the run waits on it. */
  const harness = async (b: Box, sub: string, bad = ''): Promise<{ rc: number; keys: string[]; out: string }> => {
    const c = spawn(BASH, ['-c', [
      'bad="$2"; . "$1"; CCD_OS=darwin; BOX_UNIT_DIR="$HOME/Library/LaunchAgents"; _ccrc_operator_only() { :; }',
      'eval "_orig_shell()$(declare -f _box_unit_env_shell | tail -n +2)"',
      '_box_unit_env_shell() { echo "$1" >> "$HOME/keys-read"; if [ "$1" = "$bad" ]; then BUE_WHY="planted"; return 3; fi; _orig_shell "$1"; }',
      `cmd_auth ${sub}`,
    ].join('\n'), 'harness', ccrcIn(b.home), bad], { env: env(b.home), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    c.stdout?.on('data', (d) => { out += d; });
    c.stderr?.on('data', (d) => { out += d; });
    const rc = await new Promise<number>((r) => c.on('close', (code) => r(code ?? -1)));
    const f = join(b.home, 'keys-read');
    return { rc, out, keys: existsSync(f) ? [...new Set(readFileSync(f, 'utf8').split('\n').filter(Boolean))] : [] };
  };
  it('reads every key through that reader: on reads all eight, off the six it uses', async () => {
    const b = box('ccrc-auth-mac-keys-', portLines());
    const on = await harness(b, 'on');
    expect(on.rc, on.out).toBe(0);
    expect(on.keys.sort()).toEqual([...KEYS_ON].sort());
    spawnSync('rm', ['-f', join(b.home, 'keys-read')]);
    const off = await harness(b, 'off');
    expect(off.rc, off.out).toBe(0);
    expect(off.keys.sort()).toEqual(KEYS_ON.slice(0, 6).sort());
  });
  for (const key of KEYS_ON) {
    it(`refuses, before a write, when that reader cannot decide ${key}: on${KEYS_ON.indexOf(key) < 6 ? ' and off' : ''}`, async () => {
      const subs = KEYS_ON.indexOf(key) < 6 ? ['on', 'off'] : ['on'];
      for (const sub of subs) {
        const b = box('ccrc-auth-mac-undecided-', sub === 'off' ? `${portLines()}${ON_LINES(PORT)}` : portLines());
        const before = bytes(envFile(b.home));
        const r = await harness(b, sub, key);
        expect(r.rc, `${key} ${sub}`).toBe(1);
        expect(bytes(envFile(b.home))).toBe(before);
        expect(restarts(b.home)).toEqual([]);
        expect(leftovers(b.home)).toEqual([]);
      }
    });
  }

  // c: the lock, on a Mac with the real flock (Homebrew's on the macOS leg).
  it('refuses with no flock on PATH, giving the Mac its way on', async () => {
    const b = box('ccrc-auth-mac-noflock-', portLines());
    const r = await runTty(b.home, ['auth', 'on'], { PATH: `${join(b.home, '.local', 'bin')}:${pathWithout(b.home, 'flock')}` });
    await expectRefused(b, r, bytes(envFile(b.home)), /flock is not on PATH\), so a running update could not be ruled out\. Install it \(brew install flock, as ccrc install asks on a Mac\) and re-run/);
  });
});

// ── review 3934 F3: a signal in the proof window, the copy it keeps, and a copy a killed run left ─────────────────
onEach('ccrc auth: a signal in the proof window (review 3934 F3)', () => {
  for (const sig of ['INT', 'TERM', 'HUP'] as const) {
    it(`SIG${sig} three seconds into the proof puts the old bytes back, restarts once more, leaves no copy and frees the lock`, async () => {
      const b = box(`ccrc-auth-sig-${sig.toLowerCase()}-`, others());
      chmodSync(envFile(b.home), 0o640);
      const before = bytes(envFile(b.home));
      writeFileSync(join(b.home, 'restart-plan'), 'down\n');
      const { p, done } = startTty(b.home, ['auth', 'on'], { CCRC_UPDATE_HEALTH_S: '60' });
      await waitFor(() => restarts(b.home).length === 1);
      // The copy, read while the proof waits: 0600 by its own mode, whatever the file's (0640 here).
      const copy = leftovers(b.home).filter((f) => f.includes('.auth-restore.'));
      expect(copy).toHaveLength(1);
      expect(statSync(join(b.home, '.ccrc', copy[0]!)).mode & 0o7777).toBe(0o600);
      await new Promise((r) => setTimeout(r, 3000));
      if (sig === 'INT') p.write('\x03'); else process.kill(p.pid, `SIG${sig}`);
      const r = await done;
      expect(r.code, r.out).not.toBe(0);
      expect(r.out).toMatch(/is back on its old file/);
      expect(r.out).toMatch(/was not proven/);
      expect(r.out).toMatch(/ccrc doctor/);
      expect(bytes(envFile(b.home))).toBe(before);
      expect(statSync(envFile(b.home)).mode & 0o7777).toBe(0o640);
      expect(restarts(b.home)).toEqual([RESTART, RESTART]);
      expect(leftovers(b.home)).toEqual([]);
      expect(spawnSync('flock', ['-n', join(b.home, '.ccrc', 'update.lock'), 'true']).status).toBe(0);
    });
  }

  it('a signal after the copy is made and before the write changes nothing, restarts nothing and leaves no copy', async () => {
    const b = box('ccrc-auth-sig-pre-', portLines());
    const before = bytes(envFile(b.home));
    // A cp that makes the copy, then waits, so the signal lands between the copy and the rename.
    mkdirSync(join(b.home, '.local', 'bin'), { recursive: true });
    writeFileSync(join(b.home, '.local', 'bin', 'cp'), '#!/bin/sh\n/usr/bin/cp "$@" || exit $?\n'
      + 'case "$*" in *auth-restore*) : > "$HOME/cp-done"; sleep 3 ;; esac\n', { mode: 0o755 });
    const { p, done } = startTty(b.home, ['auth', 'on']);
    await waitFor(() => existsSync(join(b.home, 'cp-done')));
    process.kill(p.pid, 'SIGTERM');
    const r = await done;
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toMatch(/stopped by a signal before anything was written\. Nothing was changed/);
    expect(bytes(envFile(b.home))).toBe(before);
    expect(restarts(b.home)).toEqual([]);
    expect(leftovers(b.home)).toEqual([]);
  });

  // Review 3971 R4: the state is `proved` before the copy goes, so a signal there finds the change standing, not a
  // copy gone that would read as a file put back. An rm that signals the verb as it removes the copy, once.
  it('a signal as the proven run removes its copy leaves the change standing: no restore, no second restart', async () => {
    const b = box('ccrc-auth-sig-proved-', portLines());
    mkdirSync(join(b.home, '.local', 'bin'), { recursive: true });
    writeFileSync(join(b.home, '.local', 'bin', 'rm'), '#!/bin/sh\n'
      + 'case "$*" in *auth-restore*) [ -e "$HOME/rm-signalled" ] || { : > "$HOME/rm-signalled"; kill -TERM "$PPID"; } ;; esac\n'
      + 'exec /usr/bin/rm "$@"\n', { mode: 0o755 });
    const r = await runTty(b.home, ['auth', 'on']);
    expect(existsSync(join(b.home, 'rm-signalled'))).toBe(true);
    expect(r.code, r.out).toBe(130);
    expect(r.out).toMatch(/stopped by a signal after the change was proven: it stands/);
    expect(r.out).not.toMatch(/is back on its old file/);
    expect(bytes(envFile(b.home))).toBe(`${portLines()}${ON_LINES(PORT)}`);
    expect(restarts(b.home)).toEqual([RESTART]);
    expect(leftovers(b.home)).toEqual([]);
  });

  it('refuses while a copy that a killed run left stands beside ccrc.env, naming it and what it is — on and off', async () => {
    const b = box('ccrc-auth-leftover-', portLines());
    const left = join(b.home, '.ccrc', 'ccrc.env.auth-restore.4242');
    writeFileSync(left, 'CCRC_HOST=127.0.0.1\n', { mode: 0o600 });
    const before = bytes(envFile(b.home));
    for (const sub of ['on', 'off']) {
      const r = await runTty(b.home, ['auth', sub]);
      expect(r.code, r.out).not.toBe(0);
      expect(r.out).toContain(left);
      expect(r.out).toMatch(/a copy of .*ccrc\.env as it was before a run of ccrc auth that did not finish \(it was killed, or it could not put the file back and kept the copy\)/);
      expect(r.out).toMatch(/Nothing was changed/);
      expect(bytes(envFile(b.home))).toBe(before);
      expect(restarts(b.home)).toEqual([]);
      expect(existsSync(left)).toBe(true);
    }
  });
});

// ── review 3971 R4: the handler reads the disk, not where the run had got to ───────────────────────────────────────
// Called as a function with the state, the files and the kept-copy flag that each line of the write and restore reaches,
// with a recording restart: the reviewer's measurement, red on the handler that read the state word alone. Bash only,
// so it runs on every platform.
describe('ccrc auth: the proof window\'s signal handler, line by line (review 3971 R4)', () => {
  function handler(o: { state: string; keep: 0 | 1; dest: string | null; copy: string | null; had?: 0 | 1; rmFails?: boolean }):
  { rc: number; err: string; dest: string | null; copy: string | null; restarts: number } {
    const dir = mkTmp('ccrc-auth-handler-');
    const dest = join(dir, 'ccrc.env');
    const copy = join(dir, 'ccrc.env.auth-restore.4242');
    if (o.dest !== null) writeFileSync(dest, o.dest, { mode: 0o600 });
    if (o.copy !== null) writeFileSync(copy, o.copy, { mode: 0o600 });
    const script = [
      `. ${JSON.stringify(CCRC_SRC)}`, `HOME=${JSON.stringify(dir)}`,
      '_svc_restart() { printf "%s\\n" "$*" >> "$HOME/restarts"; }',
      `AUTH_SIG_SUB=on; AUTH_SIG_DEST=${JSON.stringify(dest)}; AUTH_BAK=${JSON.stringify(copy)}; AUTH_SIG_MODE=640; AUTH_SIG_HAD=${o.had ?? 1}`,
      `AUTH_KEEP_BAK=${o.keep}; AUTH_SIG_STATE=${o.state}`,
      o.rmFails ? 'rm() { return 1; }' : ':',
      '_auth_on_signal',
    ].join('\n');
    const r = spawnSync(BASH, ['-c', script], { encoding: 'utf8', env: { HOME: dir, PATH: process.env['PATH'] ?? '/usr/bin:/bin' } });
    const n = existsSync(join(dir, 'restarts')) ? readFileSync(join(dir, 'restarts'), 'utf8').split('\n').filter(Boolean).length : 0;
    return { rc: r.status ?? -1, err: r.stderr, dest: bytes(dest), copy: bytes(copy), restarts: n };
  }
  const OLD = 'CCRC_PORT=7788\n';
  const NEW = `CCRC_PORT=7788\n${ON_LINES(7788)}`;

  it('H1 written, the copy there (the rename or the first proof): the old bytes go back, one restart, said', () => {
    const r = handler({ state: 'written', keep: 0, dest: NEW, copy: OLD });
    expect(r).toMatchObject({ rc: 130, dest: OLD, copy: null, restarts: 1 });
    expect(r.err).toMatch(/is back on its old file, byte for byte, and ccrc\.service was restarted once on it\. That was not proven/);
  });

  // Wave 190 A2: the handler cannot see the old file, only that the copy is gone, so it says what it infers and why.
  it('H2 written, the copy already moved back (just after the failed proof\'s restore): no copy named, one restart', () => {
    const r = handler({ state: 'written', keep: 0, dest: OLD, copy: null });
    expect(r).toMatchObject({ rc: 130, dest: OLD, copy: null, restarts: 1 });
    expect(r.err).toMatch(/the copy this run kept of .*ccrc\.env is gone, which in this run only its own restore does, so .*ccrc\.env is taken to be back on its old file, and ccrc\.service was restarted once on it\. That was not proven/);
    expect(r.err).not.toMatch(/could NOT|auth-restore|byte for byte/);
  });

  // Wave 190 A2: with no file before the run there is no old file to be back on.
  it('H5 written, no file before this run: the one this run wrote is removed, one restart, and no old file is named', () => {
    const r = handler({ state: 'written', keep: 0, dest: NEW, copy: null, had: 0 });
    expect(r).toMatchObject({ rc: 130, dest: null, copy: null, restarts: 1 });
    expect(r.err).toMatch(/is gone again, as before this run, which found no such file, and ccrc\.service was restarted once on it\. That was not proven/);
    expect(r.err).not.toMatch(/old file/);
  });

  // Wave 190 A5: the kept-copy arm for a file this run created (its removal failed earlier in the run).
  it('H6 written, after a removal that failed of a file this run created: never said to be gone, no restart', () => {
    const r = handler({ state: 'written', keep: 1, dest: NEW, copy: null, had: 0 });
    expect(r).toMatchObject({ rc: 130, dest: NEW, copy: null, restarts: 0 });
    expect(r.err).toMatch(/after .*ccrc\.env, which this run created, could NOT be removed: it still holds this run's lines\. Remove it, then restart/);
    expect(r.err).not.toMatch(/old file|gone again/);
  });

  // Wave 190 fix round 1 (R5): the handler's own removal of a file this run created fails.
  it('H7 written, no file before this run, the handler\'s own removal failing: named as this run\'s, kept, no restart', () => {
    const r = handler({ state: 'written', keep: 0, dest: NEW, copy: null, had: 0, rmFails: true });
    expect(r).toMatchObject({ rc: 130, dest: NEW, copy: null, restarts: 0 });
    expect(r.err).toMatch(/stopped by a signal while writing or proving the change, and .*ccrc\.env, which this run created, could NOT be removed; remove it, then restart/);
    expect(r.err).not.toMatch(/old file|previous|put back|gone again/);
  });

  it('H3 written, after a restore that failed (the copy kept): never said to be back, the copy named, no restart', () => {
    const r = handler({ state: 'written', keep: 1, dest: NEW, copy: OLD });
    expect(r).toMatchObject({ rc: 130, dest: NEW, copy: OLD, restarts: 0 });
    expect(r.err).toMatch(/could NOT be put back: the previous file is kept at .*ccrc\.env\.auth-restore\.4242, and .*ccrc\.env still holds this run's lines/);
    expect(r.err).not.toMatch(/is back on its old file/);
  });

  it('H4 proved, the copy removed (just after the proof passed): the change stands, nothing is put back or restarted', () => {
    const r = handler({ state: 'proved', keep: 0, dest: NEW, copy: null });
    expect(r).toMatchObject({ rc: 130, dest: NEW, copy: null, restarts: 0 });
    expect(r.err).toMatch(/stopped by a signal after the change was proven: it stands/);
    expect(r.err).not.toMatch(/before anything was written|could NOT/);
  });
});

// ── review 3934 F4, review 3971 R2: every refusal before the write has a case that goes red without it ─────────
onEach('ccrc auth: every refusal before the write (review 3934 F4)', (p) => {
  /** A command on PATH ahead of the real one (the containment's bin), failing for the arguments `when` matches. */
  // The real command found where this box keeps it (a Mac has cp and mv in /bin, review 3971 F4).
  const failing = (h: string, cmd: string, when: string): void => {
    mkdirSync(join(h, '.local', 'bin'), { recursive: true });
    const real = spawnSync('/bin/sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' }).stdout.trim() || `/usr/bin/${cmd}`;
    writeFileSync(join(h, '.local', 'bin', cmd), `#!/bin/sh\ncase "$*" in ${when}) exit 1 ;; esac\nexec ${real} "$@"\n`,
      { mode: 0o755 });
  };
  const helper = (h: string): string => join(h, 'ccrc', 'deploy', 'gen-auth-hash.mjs');

  it('refuses a ccrc.env that is a symlink (a rename would replace the link with a file), on and off', async () => {
    const b = box('ccrc-auth-symlink-', portLines());
    const real = join(b.home, '.ccrc', 'real.env');
    renameSync(envFile(b.home), real);
    symlinkSync(real, envFile(b.home));
    for (const sub of ['on', 'off']) {
      await expectRefused(b, await runTty(b.home, ['auth', sub]), bytes(real), /ccrc\.env is a symlink/);
      expect(lstatSync(envFile(b.home)).isSymbolicLink()).toBe(true);
    }
  });

  for (const port of ['0', '65536', '99999']) {
    it(`refuses CCRC_PORT=${port}, which is no port number`, async () => {
      const b = box('ccrc-auth-port-', `CCRC_HOST=127.0.0.1\nCCRC_PORT=${port}\n`);
      await expectRefused(b, await runTty(b.home, ['auth', 'on']), bytes(envFile(b.home)), /is not a port number \(1 to 65535\)/);
    });
  }

  it('refuses a RELATIVE CCRC_AUTH_SECRET_PATH, whose file the server and this verb would read in different places', async () => {
    const b = box('ccrc-auth-relsecret-', `${portLines()}CCRC_AUTH_SECRET_PATH=secrets/gate.scrypt\n`);
    await expectRefused(b, await runTty(b.home, ['auth', 'on']), bytes(envFile(b.home)), /CCRC_AUTH_SECRET_PATH to a RELATIVE path/);
  });

  it('refuses with no node on PATH, and with the passphrase checker missing', async () => {
    const a = box('ccrc-auth-nonode-', portLines());
    // Every command of the real PATH but node, so nothing else the verb runs goes missing.
    const bin = join(a.home, 'path-without-node');
    mkdirSync(bin);
    for (const d of (process.env['PATH'] ?? '').split(':').filter((x) => x && existsSync(x))) {
      for (const f of readdirSync(d)) {
        if (f === 'node' || existsSync(join(bin, f))) continue;
        try { symlinkSync(join(d, f), join(bin, f)); } catch { /* a name two directories share: the first wins */ }
      }
    }
    await expectRefused(a, await runTty(a.home, ['auth', 'on'], { PATH: `${join(a.home, '.local', 'bin')}:${bin}` }),
      bytes(envFile(a.home)), /node is not on PATH/);
    const c = box('ccrc-auth-nochecker-', portLines());
    spawnSync('rm', ['-f', helper(c.home)]);
    await expectRefused(c, await runTty(c.home, ['auth', 'on']), bytes(envFile(c.home)), /the passphrase checker is missing/);
  });

  for (const [code, words] of [['5', /this box has no server build/], ['7', /checking the passphrase file exited 7/]] as const) {
    it(`refuses when the passphrase checker exits ${code}`, async () => {
      const b = box(`ccrc-auth-checker-${code}-`, portLines());
      writeFileSync(helper(b.home), `process.exit(${code});\n`);
      await expectRefused(b, await runTty(b.home, ['auth', 'on']), bytes(envFile(b.home)), words);
    });
  }

  it('refuses when the mode of ccrc.env cannot be read, when the copy fails, and when the rewrite fails', async () => {
    for (const [cmd, when, words] of [
      ['stat', '*ccrc.env*', /the mode of .*ccrc\.env could not be read/],
      ['cp', '*auth-restore*', /could not keep a copy of .*ccrc\.env to restore from/],
      ['mv', '*.auth.tmp.*', /writing .*ccrc\.env failed; it is exactly as it was/],
    ] as const) {
      const b = box(`ccrc-auth-${cmd}-fails-`, portLines());
      failing(b.home, cmd, when);
      await expectRefused(b, await runTty(b.home, ['auth', 'on']), bytes(envFile(b.home)), words);
    }
  });

  // Review 3971 R2 (its F1): the five refusals that had no case. Each goes red without its refusal (the note's 9.1 rows).
  it('refuses a CCRC_PORT line the unit reader cannot decide (a space before =), rather than taking the default port', async () => {
    const b = box('ccrc-auth-port-undecided-', `CCRC_HOST=127.0.0.1\nCCRC_PORT =${PORT}\n`);
    for (const sub of ['on', 'off']) {
      await expectRefused(b, await runTty(b.home, ['auth', sub]), bytes(envFile(b.home)),
        PLAT === 'darwin' ? NOT_PLAIN : /names CCRC_PORT in a shape this reader does not decide .*, so the address was not measured/);
    }
  });

  for (const key of ['CCRC_AUTH', 'CCRC_RP_ID', 'CCRC_ORIGIN', 'CCRC_COOKIE_INSECURE']) {
    it(`refuses a ${key} line the unit reader cannot decide (a space before =), on and off`, async () => {
      const b = box('ccrc-auth-key-undecided-', `${portLines()}${key} =x\n`);
      for (const sub of ['on', 'off']) {
        await expectRefused(b, await runTty(b.home, ['auth', sub]), bytes(envFile(b.home)),
          PLAT === 'darwin' ? NOT_PLAIN : new RegExp(`names ${key} in a shape this reader does not decide`));
      }
    });
  }

  it('refuses with no flock on PATH, and says how to go on', async () => {
    const b = box('ccrc-auth-noflock-', portLines());
    // Every command of the real PATH but flock, so nothing else the verb runs goes missing.
    const bin = join(b.home, 'path-without-flock');
    mkdirSync(bin);
    for (const d of (process.env['PATH'] ?? '').split(':').filter((x) => x && existsSync(x))) {
      for (const f of readdirSync(d)) {
        if (f === 'flock' || existsSync(join(bin, f))) continue;
        try { symlinkSync(join(d, f), join(bin, f)); } catch { /* a name two directories share: the first wins */ }
      }
    }
    const r = await runTty(b.home, ['auth', 'on'], { PATH: `${join(b.home, '.local', 'bin')}:${bin}` });
    await expectRefused(b, r, bytes(envFile(b.home)), /update\.lock cannot be taken \(flock is not on PATH\)/);
    // Wave 193 c: on a Mac the way on is the install's own (Homebrew's flock).
    expect(r.out).toMatch(PLAT === 'darwin'
      ? /Install it \(brew install flock, as ccrc install asks on a Mac\) and re-run, or set the keys by hand \(the README's 'The session gate'\)/
      : /Put flock on PATH and re-run, or set the keys by hand \(the README's 'The session gate'\)/);
  });

  it('refuses when the lock cannot be opened (update.lock is a directory) as not measured', async () => {
    const b = box('ccrc-auth-lockdir-', portLines());
    mkdirSync(join(b.home, '.ccrc', 'update.lock'));
    await expectRefused(b, await runTty(b.home, ['auth', 'on']), bytes(envFile(b.home)),
      /update\.lock could not be taken or measured, so a running update could not be ruled out/);
  });

  // Wave 190 A5: the installer's-unit compare's two unmeasured arms.
  // The unit compare's tool and the user manager's environment are Linux's; the Mac's reads have rows of their own.
  it.skipIf(p === 'darwin')('refuses as not measured with no cmp on PATH, and when cmp fails with another exit', async () => {
    const a = box('ccrc-auth-nocmp-', portLines());
    await expectRefused(a, await runTty(a.home, ['auth', 'on'], { PATH: `${join(a.home, '.local', 'bin')}:${pathWithout(a.home, 'cmp')}` }),
      bytes(envFile(a.home)), /cmp is not on PATH, so whether .*\/ccrc\.service is .*\/deploy\/ccrc\.service was not measured/);
    const c = box('ccrc-auth-cmp2-', portLines());
    mkdirSync(join(c.home, '.local', 'bin'), { recursive: true });
    writeFileSync(join(c.home, '.local', 'bin', 'cmp'), '#!/bin/sh\nexit 2\n', { mode: 0o755 });
    for (const sub of ['on', 'off']) {
      await expectRefused(c, await runTty(c.home, ['auth', sub]), bytes(envFile(c.home)),
        /ccrc\.service could not be compared with .*\/deploy\/ccrc\.service, so whether it is that file was not measured/);
    }
  });

  it.skipIf(p === 'darwin')("refuses when only the user manager's environment does not answer (systemctl --user show-environment)", async () => {
    const b = box('ccrc-auth-managerenv-unasked-', portLines());
    writeFileSync(join(b.home, 'sd-manager-env-fails'), '');
    for (const sub of ['on', 'off']) {
      await expectRefused(b, await runTty(b.home, ['auth', sub]), bytes(envFile(b.home)),
        /systemctl --user show-environment did not answer, so the user service manager's environment was not read/);
    }
  });
});

// Wave 193's fix round: the closed form's length is tested apart from its bytes. macOS's regex library caps a counted
// bound at RE_DUP_MAX, 255 (glibc allows 32767), so a pattern with `{1,1024}` matched nothing on a real Mac: every value
// was held back and, through the home check, the verb refused on every Mac. The simulated darwin uses glibc and could
// never see it, so the class is held on Linux by the file's text: no interval bound over 255 anywhere in ccd/ccrc (main
// has none, so the guard is not noisy). The rows below pin the length edges the form keeps.
describe('ccrc auth: the closed form carries no counted bound a Mac cannot match (wave 193 fix round)', () => {
  it('ccd/ccrc holds no interval bound over 255, in a bash match or any other pattern', () => {
    const over: string[] = [];
    readFileSync(CCRC_SRC, 'utf8').split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/\\?\{(\d+)(?:,(\d*))?\\?\}/g)) {
        if (Math.max(Number(m[1]), Number(m[2] || 0)) > 255) over.push(`ccd/ccrc:${i + 1}: ${m[0]}`);
      }
    });
    expect(over).toEqual([]);
  });
  it('_box_said prints 1024 bytes of the form whole, and holds 1025, an empty value and a byte outside it', () => {
    const said = (v: string): { rc: number; out: string } => {
      const r = spawnSync(BASH, ['-c', `. ${JSON.stringify(CCRC_SRC)}; _box_said "$1"`, 'said', v],
        { encoding: 'utf8', env: { HOME: mkTmp('ccrc-auth-said-'), PATH: process.env['PATH'] ?? '/usr/bin:/bin' } });
      return { rc: r.status ?? -1, out: r.stdout };
    };
    const HELD = '[a value this verb does not print]';
    for (const n of [1, 255, 256, 1024]) expect(said('a'.repeat(n)), `${n} bytes`).toEqual({ rc: 0, out: 'a'.repeat(n) });
    for (const v of ['a'.repeat(1025), '', 'a b', `a\x1b[2J`]) expect(said(v), JSON.stringify(v.slice(0, 8))).toEqual({ rc: 1, out: HELD });
  });
});

// Review 4061 C5: a value the verb read from a file, or from what the service manager answers, reaches the terminal only
// whole and in a closed form (letters, digits and ._/@:+,%=~-[], at most 1024 bytes); anything else is printed as
// "[a value this verb does not print]", so an escape sequence, a newline or a quote in it never reaches the terminal or
// a line the operator is told to copy. Each row: the refusal it reaches, on and off where both reach it, and no byte of
// the value in the output. A quote in a CCRC_HOST or CCRC_AUTH_SECRET_PATH line never reaches a print at all: the unit
// reader refuses any quote that is not one whole pair as undecidable, naming the line and not its value (its two rows
// pin that, and were green before C5).
onEach('ccrc auth: a value read from a file is printed only in a closed form (review 4061 C5)', (p) => {
  const HELD = '[a value this verb does not print]';
  const ESC = '\x1b[2J';
  const units = (h: string): string => join(h, '.config', 'systemd', 'user');
  const oneLine = (out: string): string[] => out.replace(/\r/g, '').trim().split('\n');
  const heldIn = (r: Result, ...raw: string[]): void => {
    expect(r.out).toContain(HELD);
    expect(r.out).not.toContain('\x1b');
    for (const v of raw) expect(r.out).not.toContain(v);
    expect(oneLine(r.out)).toHaveLength(1);
  };
  const cases: [string, string, (h: string) => void, string[], RegExp][] = [
    ['CCRC_HOST with an escape sequence (the bind sentence)', `CCRC_HOST=0.0.0.0${ESC}\nCCRC_PORT=@PORT@\n`, () => {}, ['0.0.0.0'],
      /CCRC_HOST=\[a value this verb does not print\] in .*ccrc\.env is not a value this verb can read as this machine only/],
    ['CCRC_HOST with an escape sequence beside an exposure file (the reach reasons)', `CCRC_HOST=0.0.0.0${ESC}\nCCRC_PORT=@PORT@\n`,
      (h) => writeFileSync(join(h, '.ccrc', 'exposure.env'), 'CCRC_AUTH=on\n', { mode: 0o600 }), ['0.0.0.0'],
      /this box is reached from elsewhere \(CCRC_HOST=\[a value this verb does not print\] in .*ccrc\.env; .*exposure\.env exists\)/],
    ["an EnvironmentFile= line naming a path with an escape sequence and a quote", '@PORTLINES@',
      (h) => writeFileSync(join(units(h), 'ccrc.service'),
        SHIPPED_UNIT.replace('[Service]\n', `[Service]\nEnvironmentFile=-%h/.ccrc/m${ESC}'q.env\n`)), ["'q.env"],
      /ccrc\.service reads \[a value this verb does not print\] \(EnvironmentFile=\)/],
    ['an EnvironmentFile= line naming a path with a quote alone', '@PORTLINES@',
      (h) => writeFileSync(join(units(h), 'ccrc.service'),
        SHIPPED_UNIT.replace('[Service]\n', "[Service]\nEnvironmentFile=-%h/.ccrc/it's.env\n")), ["it's"],
      /ccrc\.service reads \[a value this verb does not print\] \(EnvironmentFile=\)/],
    ['a drop-in whose file name holds a newline, an escape sequence and a quote', '@PORTLINES@', (h) => {
      mkdirSync(join(units(h), 'ccrc.service.d'), { recursive: true });
      writeFileSync(join(units(h), 'ccrc.service.d', `b'\n${ESC}.conf`), '[Service]\n');
    }, ["b'"], /\[a value this verb does not print\] is a drop-in for ccrc\.service/],
    // One byte class a row, so a grammar that let any one of them through is red by its own row.
    ...([['a newline', 'b\nc.conf', 'c.conf'], ['an escape sequence', `b${ESC}c.conf`, 'c.conf'], ['a quote', "b'c.conf", "b'c"],
      ['a space', 'b c.conf', 'b c']] as const).map(([what, file, raw]): [string, string, (h: string) => void, string[], RegExp] => [
      `a drop-in whose file name holds ${what} alone`, '@PORTLINES@', (h) => {
        mkdirSync(join(units(h), 'ccrc.service.d'), { recursive: true });
        writeFileSync(join(units(h), 'ccrc.service.d', file), '[Service]\n');
      }, [raw], /\[a value this verb does not print\] is a drop-in for ccrc\.service/]),
    ['a drop-in systemd loaded from a path with an escape sequence', '@PORTLINES@',
      (h) => writeFileSync(join(h, 'sd-dropins'), `/etc/systemd/user/ccrc.service.d/x${ESC}.conf`), ['/etc/systemd'],
      /systemd loaded the drop-in \[a value this verb does not print\] for ccrc\.service/],
    ['an environment file systemd loaded from a path with an escape sequence', '@PORTLINES@',
      (h) => writeFileSync(join(h, 'sd-envfiles'), `EnvironmentFiles=${join(h, '.ccrc', 'ccrc.env')} (ignore_errors=yes)\n`
        + `EnvironmentFiles=/etc/ccrc/e${ESC}.env (ignore_errors=no)\n`), ['/etc/ccrc'],
      /systemd loaded ccrc\.service with the environment file \[a value this verb does not print\]/],
    ['a FragmentPath with an escape sequence', '@PORTLINES@',
      (h) => writeFileSync(join(h, 'sd-fragment'), `FragmentPath=/run/user/1/systemd/u${ESC}/ccrc.service\n`), ['/run/user'],
      /systemd loaded ccrc\.service from \[a value this verb does not print\], not from .*ccrc\.service, the file this verb read/],
    ['a SourcePath with an escape sequence', '@PORTLINES@',
      (h) => writeFileSync(join(h, 'sd-sourcepath'), `SourcePath=/etc/x${ESC}\n`), ['/etc/x'],
      /systemd made ccrc\.service from \[a value this verb does not print\] \(SourcePath\)/],
  ];
  for (const [name, envText, plant, raw, words] of cases) {
    // A unit's lines, a drop-in and what systemd answers are Linux's; the bind rows run on both.
    it.skipIf(p === 'darwin' && !name.startsWith('CCRC_HOST'))(`never prints ${name}, on and off`, async () => {
      const b = box('ccrc-auth-held-', envText.replace('@PORTLINES@', portLines()).replace('@PORT@', String(PORT)));
      plant(b.home);
      const before = bytes(envFile(b.home));
      for (const sub of ['on', 'off']) {
        const r = await runTty(b.home, ['auth', sub]);
        // On a Mac the job's reader holds such a line to a plain assignment, so it refuses it at the first key read,
        // naming the line and never its value: the value never reaches a print.
        await expectRefused(b, r, before, PLAT !== 'darwin' ? words
          : name.includes('exposure') ? /this box is reached from elsewhere \(.*exposure\.env exists\)/ : NOT_PLAIN);
        if (PLAT === 'darwin') { expect(r.out).not.toContain('\x1b'); for (const v of raw) expect(r.out).not.toContain(v); } else heldIn(r, ...raw);
      }
    });
  }

  // The passphrase path, in each of the three sentences that name it (`on` alone reads it).
  const secrets: [string, string, (h: string, p: string) => void, string[], RegExp][] = [
    ['no passphrase file at it', `/nonexistent/a${ESC}b.scrypt`, () => {}, ['/nonexistent', 'b.scrypt'],
      /there is no passphrase yet \(\[a value this verb does not print\]\)/],
    ['a passphrase file there the server could not use', `@HOME@/.ccrc/g${ESC}x.scrypt`,
      (_h, p) => writeFileSync(p, 'not a secret line\n', { mode: 0o600 }), ['x.scrypt'],
      /the passphrase file at \[a value this verb does not print\] cannot be used/],
    ['a relative path', `sec${ESC}ret.scrypt`, () => {}, ['ret.scrypt'], /to a RELATIVE path \(\[a value this verb does not print\]\)/],
  ];
  for (const [name, value, plant, raw, words] of secrets) {
    it(`never prints a CCRC_AUTH_SECRET_PATH with an escape sequence: ${name}`, async () => {
      const b = box('ccrc-auth-held-secret-', portLines(), { passphrase: false });
      const p = value.replace('@HOME@', b.home);
      writeFileSync(envFile(b.home), `${portLines()}CCRC_AUTH_SECRET_PATH=${p}\n`, { mode: 0o600 });
      plant(b.home, p);
      const r = await runTty(b.home, ['auth', 'on']);
      await expectRefused(b, r, bytes(envFile(b.home)), PLAT === 'darwin' ? NOT_PLAIN : words);
      if (PLAT === 'darwin') { expect(r.out).not.toContain('\x1b'); for (const v of raw) expect(r.out).not.toContain(v); } else heldIn(r, ...raw);
    });
  }

  // What the service manager answers for the unit's state is printed in the failed proof's sentence: held the same way.
  // On a Mac the state word is one of `_svc_is_active`'s own literals, read from launchd's print; no answer reaches it.
  it.skipIf(p === 'darwin')('never prints a state word the service manager answers with an escape sequence in it (a failed proof)', async () => {
    const b = box('ccrc-auth-held-state-', portLines());
    writeFileSync(join(b.home, 'sd-is-active'), `activ${ESC}e\n`);
    const before = bytes(envFile(b.home));
    const r = await runTty(b.home, ['auth', 'on']);
    expect(r.code, r.out).toBe(1);
    expect(r.out).toMatch(/the restarted console did not prove the change: after 2s ccrc\.service is \[a value this verb does not print\] and/);
    expect(r.out).not.toContain('\x1b');
    expect(r.out).not.toContain('activ');
    expect(bytes(envFile(b.home))).toBe(before);
    expect(leftovers(b.home)).toEqual([]);
  });

  // Held already by the unit reader, before any print (pins, green before C5).
  for (const [name, line] of [
    ['a quote in CCRC_HOST', "CCRC_HOST=0.0.0.0'x"],
    ['a CCRC_HOST value that spans a newline', 'CCRC_HOST="0.0.0.0\nevil"'],
    ['a quote in CCRC_AUTH_SECRET_PATH', "CCRC_AUTH_SECRET_PATH=/tmp/a'b"],
  ] as const) {
    it(`never prints ${name}: the unit reader refuses it as undecidable, naming the line`, async () => {
      const b = box('ccrc-auth-held-reader-', `CCRC_PORT=${PORT}\n${line}\n`);
      const r = await runTty(b.home, ['auth', 'on']);
      await expectRefused(b, r, bytes(envFile(b.home)), /was not measured/);
      expect(r.out).not.toMatch(/'x|evil|a'b/);
    });
  }
});

// ── wave 193 f: one real launchd job, on a GitHub-hosted macOS runner only (F1 to F4, the coordinator's terms) ────────
// F1: it runs only when the three variables GitHub Actions sets itself read so AND the platform is darwin; anywhere else
// it is skipped by name, and the row after it proves the gate on any box. F2: before it bootstraps, it asks whether a
// job with the verb's label is held already, and if one is it stops red and touches nothing; it boots out only the job
// it bootstrapped, by its own file, on failure too. F3: the guard's allow switch is set in this case's run only. F4:
// nothing in it is a real account, host or path: a temporary home, and a console stand-in on loopback at a port it
// picks, which answers from its own environment, so what launchd's `bash -c` sourced is what the proof reads.
function realLaunchdGate(e: NodeJS.ProcessEnv, platform: string): boolean {
  return platform === 'darwin' && e['GITHUB_ACTIONS'] === 'true' && e['RUNNER_OS'] === 'macOS'
    && e['RUNNER_ENVIRONMENT'] === 'github-hosted';
}
describe('the real launchd case runs only on a GitHub-hosted macOS runner (wave 193 F1)', () => {
  const all = { GITHUB_ACTIONS: 'true', RUNNER_OS: 'macOS', RUNNER_ENVIRONMENT: 'github-hosted' };
  it('opens with all three variables on darwin, and never with two of three, another value, or another platform', () => {
    expect(realLaunchdGate(all, 'darwin')).toBe(true);
    expect(realLaunchdGate(all, 'linux')).toBe(false);
    for (const k of Object.keys(all) as (keyof typeof all)[]) {
      const two: Record<string, string> = { ...all };
      delete two[k];
      expect(realLaunchdGate(two, 'darwin'), `without ${k}`).toBe(false);
      expect(realLaunchdGate({ ...all, [k]: 'other' }, 'darwin'), `${k}=other`).toBe(false);
    }
  });
});
describe.skipIf(!realLaunchdGate(process.env, process.platform))(
  'ccrc auth against a real launchd job (wave 193 f: a GitHub-hosted macOS runner only)', () => {
    const LC = '/bin/launchctl';
    const uid = process.getuid?.() ?? 0;
    let booted = '';
    beforeAll(() => { PLAT = 'darwin'; });
    afterAll(() => {
      PLAT = HOST_PLAT;
      if (booted !== '') spawnSync(LC, ['bootout', `gui/${uid}`, booted], { stdio: 'ignore' });
    });
    /** Section headings and key names of a print, never a value (what the coordinator asked to see). */
    const shape = (out: string): string => out.split('\n').filter((l) => / = \{$/.test(l) || / => /.test(l))
      .map((l) => l.replace(/ => .*$/, ' =>')).join('\n');
    it('on, then off, through launchd: bootstrap, kickstart, the proof, and the bootout of only its own job', async () => {
      const pre = spawnSync(LC, ['print', `gui/${uid}/${MAC_LABEL}`], { encoding: 'utf8' });
      expect(pre.status, `a job ${MAC_LABEL} is already held in gui/${uid}; nothing was touched`).not.toBe(0);
      const port = await new Promise<number>((r) => { const s = http.createServer().listen(0, '127.0.0.1', () => {
        const p = (s.address() as AddressInfo).port; s.close(() => r(p)); }); });
      const b = box('ccrc-auth-launchd-', `CCRC_HOST=127.0.0.1\nCCRC_PORT=${port}\n`);
      const entry = join(b.home, 'ccrc', 'server', 'dist', 'server', 'src', 'index.js');
      mkdirSync(path.dirname(entry), { recursive: true });
      writeFileSync(entry, "import('node:http').then(({ default: http }) => http.createServer((q, s) => {\n"
        + "  s.setHeader('content-type', 'application/json');\n"
        + "  if (q.url === '/health') { s.end(JSON.stringify({ ok: true })); return; }\n"
        + "  if (q.url === '/api/auth/status') { s.end(JSON.stringify({ mode: process.env.CCRC_AUTH === 'on' ? 'passphrase' : 'off' })); return; }\n"
        + "  s.statusCode = 404; s.end('{}');\n"
        + '}).listen(Number(process.env.CCRC_PORT), process.env.CCRC_HOST || \'127.0.0.1\'));\n');
      const nodeDir = path.dirname(process.execPath);
      writeJob(b.home, `${nodeDir}:/usr/bin:/bin:/usr/sbin:/sbin`);
      mkdirSync(join(b.home, '.ccrc', 'logs'), { recursive: true });
      const boot = spawnSync(LC, ['bootstrap', `gui/${uid}`, macJobFile(b.home)], { encoding: 'utf8' });
      expect(boot.status, boot.stderr).toBe(0);
      booted = macJobFile(b.home);
      try {
        const held = spawnSync(LC, ['print', `gui/${uid}/${MAC_LABEL}`], { encoding: 'utf8' }).stdout;
        console.log(`wave 193 measurement, the job's print (headings and key names only):\n${shape(held)}`);
        console.log(`wave 193 measurement, the domain's print (headings and key names only):\n${shape(
          spawnSync(LC, ['print', `gui/${uid}`], { encoding: 'utf8' }).stdout)}`);
        const unset = spawnSync(LC, ['getenv', 'CCRC_WAVE193_UNSET_PROBE'], { encoding: 'utf8' });
        console.log(`wave 193 measurement, getenv of an unset key: exit ${unset.status}, ${unset.stdout.length} bytes out`);
        const bad = spawnSync(LC, ['getenv'], { encoding: 'utf8' });
        console.log(`wave 193 measurement, getenv with no key: exit ${bad.status}, ${bad.stdout.length} bytes out`);
        // The fix round's one value shape (ruling 40092): OSLogRateLimit's value, by its length and whether it is all
        // digits, never the value itself.
        const lines = held.split('\n');
        const at = lines.indexOf('\tenvironment = {');
        const block = at < 0 ? [] : lines.slice(at + 1, lines.indexOf('\t}', at));
        const rate = block.find((l) => l.startsWith('\t\tOSLogRateLimit => '))?.slice('\t\tOSLogRateLimit => '.length);
        console.log(`wave 193 measurement, OSLogRateLimit in the job's own environment: ${rate === undefined ? 'absent'
          : `${rate.length} bytes, ${/^[0-9]+$/.test(rate) ? 'all digits' : 'not all digits'}`}`);
        const e = env(b.home, { CCRC_ALLOW_SANDBOX_LAUNCHCTL: '1', CCRC_UPDATE_HEALTH_S: '60' });
        rmSync(join(b.home, '.local', 'bin', 'launchctl'), { force: true });
        writeFileSync(join(b.home, 'curl-allow-ports'), `${port}\n`);
        const run = (sub: string): Promise<Result> => new Promise((resolve) => {
          const p = pty.spawn(BASH, [ccrcIn(b.home), 'auth', sub], { name: 'xterm-color', cols: 400, rows: 60, cwd: b.home, env: e });
          let out = '';
          p.onData((d) => { out += d; });
          p.onExit(({ exitCode }) => resolve({ code: exitCode, out }));
        });
        const on = await run('on');
        expect(on.code, on.out).toBe(0);
        expect(on.out).toMatch(/answers with sign-in on/);
        const off = await run('off');
        expect(off.code, off.out).toBe(0);
        expect(off.out).toMatch(/answers with sign-in off/);
      } finally {
        const out = spawnSync(LC, ['bootout', `gui/${uid}`, booted], { encoding: 'utf8' });
        if (out.status === 0) booted = '';
      }
    }, 240_000);
  });

onEach('ccrc auth: the verb is in the usage and the verb table', () => {
  it('lists auth in the usage, and refuses a missing or unknown subcommand as a usage error', () => {
    const b = box('ccrc-auth-usage-', portLines());
    const help = runPiped(b.home, ['auth', '--help']);
    expect(help.code).toBe(0);
    expect(help.out).toMatch(/^ {2}auth {6}on\|off: the console's sign-in for a box used at localhost\./m);
    expect(runPiped(b.home, ['auth']).code).toBe(2);
    expect(runPiped(b.home, ['auth', 'bogus']).code).toBe(2);
    expect(runPiped(b.home, ['auth', 'on', 'extra']).code).toBe(2);
  });
});
