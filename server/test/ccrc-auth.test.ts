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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pty from 'node-pty';
import { mkTmp } from './tmpHelpers.js';
import { ccrcContainedEnv } from './ccrcContainment.js';
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

const ccrcIn = (home: string): string => join(home, 'ccrc', 'ccd', 'ccrc');
const envFile = (home: string): string => join(home, '.ccrc', 'ccrc.env');
const restarts = (home: string): string[] => {
  const f = join(home, 'systemctl-argv');
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter((l) => /^--user restart /.test(l)) : [];
};
const bytes = (p: string): string | null => (existsSync(p) ? readFileSync(p, 'latin1') : null);

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

const SYSTEMCTL_STUB = [
  '#!/bin/sh',
  'printf \'%s\\n\' "$*" >> "$HOME/systemctl-argv"',
  'case "$*" in',
  '  "--user restart ccrc.service")',
  '    plan="$HOME/restart-plan"; next=""',
  '    if [ -s "$plan" ]; then next=$(head -n 1 "$plan"); tail -n +2 "$plan" > "$plan.n"; /bin/mv "$plan.n" "$plan"; fi',
  '    [ "$next" != fail ] || exit 1',
  '    if [ -z "$next" ]; then',
  '      if grep -qx "CCRC_AUTH=on" "$HOME/.ccrc/ccrc.env" 2>/dev/null; then next=armed; else next=off; fi',
  '    fi',
  '    printf \'%s\\n\' "$next" > "$HOME/server-state"; exit 0 ;;',
  // What systemd loaded for the unit, and its manager's own environment (the reach proof's other sources, review 3934
  // F2): the two known EnvironmentFile= lines unless `<home>/sd-envfiles` replaces them, and `<home>/sd-dropins`,
  // `<home>/sd-environment`, `<home>/sd-manager-env` when a case plants them; `<home>/sd-show-fails` makes either fail.
  '  "--user show ccrc.service -p DropInPaths -p EnvironmentFiles -p Environment -p PassEnvironment")',
  '    [ ! -e "$HOME/sd-show-fails" ] || exit 1',
  '    printf \'DropInPaths=%s\\n\' "$(cat "$HOME/sd-dropins" 2>/dev/null)"',
  '    printf \'Environment=%s\\n\' "$(cat "$HOME/sd-environment" 2>/dev/null)"',
  '    if [ -e "$HOME/sd-envfiles" ]; then cat "$HOME/sd-envfiles"; else',
  '      printf \'EnvironmentFiles=%s (ignore_errors=yes)\\n\' "$HOME/.ccrc/ccrc.env" "$HOME/.ccrc/exposure.env"; fi',
  '    printf \'PassEnvironment=\\n\'; exit 0 ;;',
  '  "--user show-environment")',
  '    [ ! -e "$HOME/sd-show-fails" ] || exit 1',
  '    if [ -e "$HOME/sd-manager-env" ]; then cat "$HOME/sd-manager-env"; else printf \'HOME=%s\\nLANG=C.UTF-8\\n\' "$HOME"; fi',
  '    exit 0 ;;',
  '  "--user is-active ccrc.service")',
  '    if [ "$(cat "$HOME/server-state" 2>/dev/null)" = down ]; then echo failed; exit 3; fi',
  '    echo active; exit 0 ;;',
  'esac',
  'echo "fixture systemctl: unexpected argv: $*" >&2; exit 90',
].join('\n') + '\n';

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
  const units = join(home, '.config', 'systemd', 'user');
  mkdirSync(units, { recursive: true });
  writeFileSync(join(units, 'ccrc.service'), '[Service]\n');
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
/** `ccrc auth <sub>` on a real terminal, with the terminal handed back so a case can signal the run. A pty merges the
 *  two streams. */
function startTty(home: string, args: string[], extra: Record<string, string> = {}): { p: pty.IPty; done: Promise<Result> } {
  const p = pty.spawn(BASH, [ccrcIn(home), ...args], {
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
  const r = spawnSync(BASH, [ccrcIn(home), ...args], { env: env(home), encoding: 'utf8', input: '' });
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

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

describe('ccrc auth: the guards an operator-only verb runs first', () => {
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

describe('ccrc auth: which box may run it', () => {
  it('refuses on the fleet role, and on a box with no ccrc.service installed', async () => {
    const a = box('ccrc-auth-fleet-', `${portLines()}CCRC_ROLE=fleet\n`);
    await expectRefused(a, await runTty(a.home, ['auth', 'on']), bytes(envFile(a.home)), /runs no console/);
    const c = box('ccrc-auth-nounit-', portLines());
    const unit = join(c.home, '.config', 'systemd', 'user', 'ccrc.service');
    spawnSync('rm', ['-f', unit]);
    await expectRefused(c, await runTty(c.home, ['auth', 'on']), bytes(envFile(c.home)), /ccrc\.service is not installed/);
  });

  for (const [name, plant, words] of [
    ['an exposure file', (h: string) => writeFileSync(join(h, '.ccrc', 'exposure.env'), 'CCRC_AUTH=on\n', { mode: 0o600 }), /exposure\.env exists/],
    ['a Caddyfile', (h: string) => writeFileSync(join(h, '.ccrc', 'Caddyfile'), 'x {\n}\n'), /Caddyfile exists/],
    ['the ddns timer unit', (h: string) => writeFileSync(join(h, '.config', 'systemd', 'user', 'ccrc-ddns.timer'), ''), /ccrc-ddns\.timer is installed/],
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
    await expectRefused(a, await runTty(a.home, ['auth', 'on']), bytes(envFile(a.home)), /CCRC_HOST=0\.0\.0\.0/);
    // Review 3934 A4: off names the bind, not un-exposing (there is nothing to un-expose).
    const offBind = await runTty(a.home, ['auth', 'off']);
    await expectRefused(a, offBind, bytes(envFile(a.home)), /CCRC_HOST=0\.0\.0\.0 in .* binds the server beyond this machine/);
    expect(offBind.out).not.toMatch(/un-exposing/);
    const u = box('ccrc-auth-undecided-', `CCRC_HOST ="127.0.0.1"\nCCRC_PORT=${PORT}\n`);
    await expectRefused(u, await runTty(u.home, ['auth', 'on']), bytes(envFile(u.home)), /was not measured/);
  });

  // Review 3934 A2: loopback is an address, never any text that begins 127.
  for (const host of ['127.0.0.1.example.com', '127.256.0.1', '127.0.0.01', '127.255.255.255']) {
    it(`refuses CCRC_HOST=${host} as reached from elsewhere: loopback is 127.0.0.1 to 127.255.255.254, localhost or ::1`, async () => {
      const b = box('ccrc-auth-127text-', `CCRC_HOST=${host}\nCCRC_PORT=${PORT}\n`);
      const before = bytes(envFile(b.home));
      await expectRefused(b, await runTty(b.home, ['auth', 'on']), before, new RegExp(`reached from elsewhere \\(CCRC_HOST=${host.replace(/\./g, '\\.')} in `));
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

describe('ccrc auth on: what must hold before anything is written', () => {
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
      await expectRefused(b, await runTty(b.home, ['auth', 'on']), bytes(envFile(b.home)), new RegExp(`names ${key} in a shape this reader does not decide`));
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
const others = (): string => `# box config\n${portLines()}# CCRC_AUTH=off   <- a comment that names the key\n`
  + 'CCRC_VAPID_SUBJECT=mailto:fixture@example.invalid\nCCRC_FLEET=local\r\nNOTE_LINE=a  b\tc';
const RESTART = '--user restart ccrc.service';

describe('ccrc auth on: the write, the restart and the proof', () => {

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
      expect(r.out).toMatch(words);
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

describe('ccrc auth off', () => {
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
describe("ccrc auth: the unit's other sources of its environment (review 3934 F2)", () => {
  const units = (h: string): string => join(h, '.config', 'systemd', 'user');
  const unit = (h: string, text: string): void => writeFileSync(join(units(h), 'ccrc.service'), text);
  const dropIn = (h: string, dir: string, name: string, text: string): void => {
    mkdirSync(join(units(h), dir), { recursive: true });
    writeFileSync(join(units(h), dir, name), text);
  };
  const cases: [string, (h: string) => void, RegExp][] = [
    ['a drop-in naming an all-interfaces bind', (h) => dropIn(h, 'ccrc.service.d', 'bind.conf', '[Service]\nEnvironment=CCRC_HOST=0.0.0.0\n'),
      /ccrc\.service\.d\/bind\.conf is a drop-in for ccrc\.service/],
    ['a drop-in for every user service', (h) => dropIn(h, 'service.d', 'all.conf', '[Service]\nEnvironment=CCRC_HOST=0.0.0.0\n'),
      /service\.d\/all\.conf is a drop-in for ccrc\.service/],
    ['an Environment= line in the unit itself', (h) => unit(h, '[Service]\nEnvironment="CCRC_HOST=0.0.0.0" NODE_ENV=production\n'),
      /ccrc\.service sets CCRC_HOST in an Environment= line/],
    ['a PassEnvironment= line in the unit itself', (h) => unit(h, '[Service]\nPassEnvironment=CCRC_ORIGIN\n'),
      /ccrc\.service passes CCRC_ORIGIN from the service manager \(PassEnvironment=\)/],
    ['an environment file beyond the two', (h) => unit(h, '[Service]\nEnvironmentFile=-%h/.ccrc/ccrc.env\nEnvironmentFile=-%h/.ccrc/more.env\n'),
      /ccrc\.service reads .*\/\.ccrc\/more\.env \(EnvironmentFile=\)/],
    ['a drop-in systemd loaded from another directory', (h) => writeFileSync(join(h, 'sd-dropins'), '/etc/systemd/user/ccrc.service.d/bind.conf'),
      /systemd loaded the drop-in \/etc\/systemd\/user\/ccrc\.service\.d\/bind\.conf for ccrc\.service/],
    ['an Environment= systemd loaded', (h) => writeFileSync(join(h, 'sd-environment'), 'NODE_ENV=production CCRC_HOST=0.0.0.0'),
      /systemd loaded ccrc\.service with CCRC_HOST in its Environment=/],
    ['an environment file systemd loaded beyond the two', (h) => writeFileSync(join(h, 'sd-envfiles'),
      `EnvironmentFiles=${join(h, '.ccrc', 'ccrc.env')} (ignore_errors=yes)\nEnvironmentFiles=/etc/ccrc/extra.env (ignore_errors=no)\n`),
      /systemd loaded ccrc\.service with the environment file \/etc\/ccrc\/extra\.env/],
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

  it('passes the shipped shape: the two known EnvironmentFile= lines (%h), another key in Environment=, an empty drop-in directory', async () => {
    const b = box('ccrc-auth-src-shipped-', portLines());
    unit(b.home, '[Service]\nEnvironmentFile=-%h/.ccrc/ccrc.env\nEnvironmentFile=-%h/.ccrc/exposure.env\nEnvironment=NODE_ENV=production\nLimitCORE=0\n');
    mkdirSync(join(units(b.home), 'ccrc.service.d'));
    writeFileSync(join(b.home, 'sd-environment'), 'NODE_ENV=production');
    const r = await runTty(b.home, ['auth', 'on']);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/sign-in is on/);
  });
});

// The launchd job (macOS): its EnvironmentVariables, the files its bash line sources, and launchd's own environment.
// `ccrc` recomputes CCD_OS from uname on every run, so the Darwin arm is asked as a function, with CCD_OS set after
// sourcing (the unit reader's own harness, ccrc-doctor-core-auth), against a recording launchctl stub.
describe('ccrc auth: the launchd job\'s other sources (review 3934 F2, the Darwin arm, as a function)', () => {
  function sources(plant: (dir: string, plist: string) => void, launchctl: string): { rc: number; reasons: string; why: string } {
    const dir = mkTmp('ccrc-auth-src-darwin-');
    const bin = join(dir, 'bin');
    mkdirSync(join(dir, '.ccrc'), { recursive: true });
    mkdirSync(join(dir, 'Library', 'LaunchAgents'), { recursive: true });
    mkdirSync(bin);
    writeFileSync(join(bin, 'launchctl'), `#!/bin/sh\n${launchctl}\n`, { mode: 0o755 });
    const script = [
      `. ${JSON.stringify(CCRC_SRC)}`, 'CCD_OS=darwin', `HOME=${JSON.stringify(dir)}`,
      'BOX_UNIT_DIR="$HOME/Library/LaunchAgents"; BOX_ENV_FILE="$HOME/.ccrc/ccrc.env"; CCRC_EXPOSURE_FILE="$HOME/.ccrc/exposure.env"',
      'plist="$BOX_UNIT_DIR/$(_box_unit_file ccrc.service)"; printf "%s" "$plist" > "$HOME/plist-path"',
      `[ -x ${JSON.stringify(join(dir, 'plant'))} ] && ${JSON.stringify(join(dir, 'plant'))} "$plist"`,
      '_auth_unit_sources "$BOX_UNIT_DIR"; rc=$?',
      'printf "%s" "$rc" > "$HOME/rc"; printf "%s\\n" "${AUS_REASONS[@]}" > "$HOME/reasons"; printf "%s" "$AUS_WHY" > "$HOME/why"',
    ].join('\n');
    writeFileSync(join(dir, 'plant'), '#!/bin/sh\n:\n', { mode: 0o755 });
    plant(dir, '');
    const r = spawnSync(BASH, ['-c', script], {
      encoding: 'utf8', env: { HOME: dir, PATH: `${bin}:${process.env['PATH'] ?? '/usr/bin:/bin'}`, CCRC_ALLOW_SANDBOX_LAUNCHCTL: '1' },
    });
    expect(r.status, r.stderr).toBe(0);
    const g = (n: string): string => readFileSync(join(dir, n), 'utf8');
    return { rc: Number(g('rc')), reasons: g('reasons'), why: g('why') };
  }
  /** A plist written by the shipped writer, `_inst_plist_server`, then edited by `edit` (a sed expression or none). */
  const shipped = (edit: string) => (dir: string): void => {
    writeFileSync(join(dir, 'plant'), `#!/bin/bash\n. ${JSON.stringify(CCRC_SRC)}\nCCD_OS=darwin\n`
      + `HOME=${JSON.stringify(dir)}; BOX_ENV_FILE="$HOME/.ccrc/ccrc.env"; CCRC_EXPOSURE_FILE="$HOME/.ccrc/exposure.env"\n`
      + `_inst_plist_server "$(_svc_label ccrc.service)" "$HOME/ccrc.log" > "$1"\n${edit ? `sed -i ${JSON.stringify(edit)} "$1"\n` : ''}`,
    { mode: 0o755 });
  };
  const UNSET = 'case "$1" in getenv) exit 0 ;; esac; exit 90';

  it('the shipped job, with nothing in launchd\'s environment, has no other source', () => {
    const r = sources(shipped(''), UNSET);
    expect(r).toEqual({ rc: 0, reasons: '\n', why: '' });
  });

  it('names a key in the job\'s EnvironmentVariables, a third sourced file, and a key in launchd\'s environment — never a value', () => {
    const k = sources(shipped('s|<key>HOME</key>|<key>CCRC_HOST</key><string>0.0.0.0</string><key>HOME</key>|'), UNSET);
    expect(k.rc).toBe(0);
    expect(k.reasons).toMatch(/\.plist sets CCRC_HOST in its EnvironmentVariables/);
    const f = sources(shipped("s|set +a;|[ -f '/etc/ccrc/extra.env' ] \\&amp;\\&amp; . '/etc/ccrc/extra.env'; set +a;|"), UNSET);
    expect(f.reasons).toMatch(/\.plist sources \/etc\/ccrc\/extra\.env/);
    const l = sources(shipped(''), 'case "$1 $2" in "getenv CCRC_HOST") echo 0.0.0.0; exit 0 ;; getenv*) exit 0 ;; esac; exit 90');
    expect(l.reasons).toMatch(/launchd's own environment \(launchctl getenv\) sets CCRC_HOST/);
    for (const x of [k, f, l]) expect(x.reasons).not.toMatch(/0\.0\.0\.0/);
  });

  it('a launchctl that does not answer, and a job file it cannot read, are undecidable', () => {
    expect(sources(shipped(''), 'exit 3')).toMatchObject({ rc: 1, why: expect.stringMatching(/launchctl getenv did not answer/) });
    const u = sources((dir) => writeFileSync(join(dir, 'plant'), '#!/bin/sh\nmkdir "$1"\n', { mode: 0o755 }), UNSET);
    expect(u).toMatchObject({ rc: 1, why: expect.stringMatching(/\.plist cannot be read/) });
  });
});

// ── review 3934 F3: a signal in the proof window, the copy it keeps, and a copy a killed run left ─────────────────
describe('ccrc auth: a signal in the proof window (review 3934 F3)', () => {
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

  it('refuses while a copy that a killed run left stands beside ccrc.env, naming it and what it is — on and off', async () => {
    const b = box('ccrc-auth-leftover-', portLines());
    const left = join(b.home, '.ccrc', 'ccrc.env.auth-restore.4242');
    writeFileSync(left, 'CCRC_HOST=127.0.0.1\n', { mode: 0o600 });
    const before = bytes(envFile(b.home));
    for (const sub of ['on', 'off']) {
      const r = await runTty(b.home, ['auth', sub]);
      expect(r.code, r.out).not.toBe(0);
      expect(r.out).toContain(left);
      expect(r.out).toMatch(/a copy of .*ccrc\.env as it was before a run of ccrc auth that was killed/);
      expect(r.out).toMatch(/Nothing was changed/);
      expect(bytes(envFile(b.home))).toBe(before);
      expect(restarts(b.home)).toEqual([]);
      expect(existsSync(left)).toBe(true);
    }
  });
});

// ── review 3934 F4: every refusal before the write has a case that goes red without it ───────────────────────────
describe('ccrc auth: every refusal before the write (review 3934 F4)', () => {
  /** A command on PATH ahead of the real one (the containment's bin), failing for the arguments `when` matches. */
  const failing = (h: string, cmd: string, when: string): void => {
    mkdirSync(join(h, '.local', 'bin'), { recursive: true });
    writeFileSync(join(h, '.local', 'bin', cmd), `#!/bin/sh\ncase "$*" in ${when}) exit 1 ;; esac\nexec /usr/bin/${cmd} "$@"\n`,
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
});

describe('ccrc auth: the verb is in the usage and the verb table', () => {
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
