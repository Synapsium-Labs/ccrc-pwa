// `ccrc auth on|off` — the console's sign-in for a box used at localhost (desktop polish wave 181, D-TBD-auth-on).
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
  chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync,
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
  '    if [ -s "$plan" ]; then next=$(head -n 1 "$plan"); tail -n +2 "$plan" > "$plan.n"; mv "$plan.n" "$plan"; fi',
  '    if [ -z "$next" ]; then',
  '      if grep -qx "CCRC_AUTH=on" "$HOME/.ccrc/ccrc.env" 2>/dev/null; then next=armed; else next=off; fi',
  '    fi',
  '    printf \'%s\\n\' "$next" > "$HOME/server-state"; exit 0 ;;',
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

interface Result { code: number; out: string }
/** `ccrc auth <sub>` on a real terminal. A pty merges the two streams. */
function runTty(home: string, args: string[], extra: Record<string, string> = {}): Promise<Result> {
  return new Promise((resolve) => {
    const p = pty.spawn(BASH, [ccrcIn(home), ...args], {
      name: 'xterm-color', cols: 400, rows: 60, cwd: home, env: env(home, extra),
    });
    let out = '';
    let done = false;
    const finish = (code: number): void => { if (!done) { done = true; clearTimeout(t); resolve({ code, out }); } };
    const t = setTimeout(() => { p.kill(); finish(-1); }, 60_000);
    p.onData((d) => { out += d; });
    p.onExit(({ exitCode }) => finish(exitCode));
  });
}
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
  expect(readdirSync(join(b.home, '.ccrc')).filter((f) => /\.auth(\.tmp|-restore)\./.test(f))).toEqual([]);
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
      expect(on.out).toMatch(/ccrc expose/);
      await expectRefused(b, await runTty(b.home, ['auth', 'off']), before, /un-exposing the box/);
    });
  }

  it('refuses a non-loopback CCRC_HOST bind, and an undecidable one', async () => {
    const a = box('ccrc-auth-wild-', `CCRC_HOST=0.0.0.0\nCCRC_PORT=${PORT}\n`);
    await expectRefused(a, await runTty(a.home, ['auth', 'on']), bytes(envFile(a.home)), /CCRC_HOST=0\.0\.0\.0/);
    const u = box('ccrc-auth-undecided-', `CCRC_HOST ="127.0.0.1"\nCCRC_PORT=${PORT}\n`);
    await expectRefused(u, await runTty(u.home, ['auth', 'on']), bytes(envFile(u.home)), /was not measured/);
  });

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

  it('refuses a foreign CCRC_ORIGIN and a foreign CCRC_RP_ID, naming the key and never the value', async () => {
    for (const line of ['CCRC_ORIGIN=https://box.example.com', 'CCRC_RP_ID=example.com']) {
      const b = box('ccrc-auth-foreign-', `${portLines()}${line}\n`);
      const r = await runTty(b.home, ['auth', 'on']);
      await expectRefused(b, r, bytes(envFile(b.home)), new RegExp(`already sets ${line.split('=')[0]}`));
      expect(r.out).not.toMatch(/example\.com/);
    }
  });
});

describe('ccrc auth on: the write, the restart and the proof', () => {
  // Every shape of line the write must carry over untouched: comments (one NAMING a key, which is still a comment),
  // a key we do not own, odd spacing in a value, a CRLF line, and a last line with no newline.
  // A function: the port is known only once `beforeAll` has started the console.
  const others = (): string => `# box config\n${portLines()}# CCRC_AUTH=off   <- a comment that names the key\n`
    + 'CCRC_VAPID_SUBJECT=mailto:fixture@example.invalid\nCCRC_FLEET=local\r\nNOTE_LINE=a  b\tc';

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
    expect(readdirSync(join(b.home, '.ccrc')).filter((f) => /\.auth(\.tmp|-restore)\./.test(f))).toEqual([]);
  });

  it('replaces a bare KEY= line and CCRC_AUTH=off rather than adding a second line', async () => {
    const b = box('ccrc-auth-bare-', `${portLines()}CCRC_AUTH=off\nCCRC_RP_ID=\nCCRC_ORIGIN="http://localhost:${PORT}"\n`);
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
      expect(restarts(b.home)).toEqual(['--user restart ccrc.service', '--user restart ccrc.service']);
      expect(readdirSync(join(b.home, '.ccrc')).filter((f) => /\.auth(\.tmp|-restore)\./.test(f))).toEqual([]);
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

  it('leaves a value it did not write, and names it', async () => {
    const b = box('ccrc-auth-off-foreign-', `${portLines()}CCRC_AUTH=on\nCCRC_ORIGIN=https://box.example.com\nCCRC_RP_ID=localhost\n`);
    writeFileSync(join(b.home, 'server-state'), 'armed\n');
    const r = await runTty(b.home, ['auth', 'off']);
    expect(r.code, r.out).toBe(0);
    expect(bytes(envFile(b.home))).toBe(`${portLines()}CCRC_ORIGIN=https://box.example.com\n`);
    expect(r.out).toMatch(/left as they were.*CCRC_ORIGIN/);
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
