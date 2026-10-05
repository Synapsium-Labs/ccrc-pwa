// Wave 9 R10d / R9-F8 (Task 3): containment of the ccrc test envs is STRUCTURAL.
//
// Three groups, one file because they are one claim:
//   3a — the checker's own self-tests (`assertNoRealTool`), the loopback curl front, and the create-if-absent
//        rule `ccrcContainedEnv` is built on. A checker nothing can make red is a comment.
//   3b — the one per-builder pin that lives HERE: `keepDigest`'s env (`installTreeFixture.ts` registers no
//        tests). The other builders pin themselves in their own files.
//   3c — the census: a text scan of the five files that build ccrc envs, for TWO shapes only — a builder that
//        slides back to `ghContainedEnv(home, { ...process.env … })`, and a new `...process.env, HOME: home`
//        literal — each reds here and names its line. It cannot see a raw spawn of the real `ccd/ccrc` with no
//        `env` option, with `env: process.env`, or with `{ ...process.env, HOME: <any other name> }` (fix round 1,
//        F5: a scan for raw `ccd/ccrc` spawns is residue). The per-builder pins and `assertNoRealTool` are what
//        hold those today.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync, chmodSync,
} from 'node:fs';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { harnessBin } from './ccdWsHelpers.js';
import { CONTAINED_TOOLS, assertNoRealTool, loopbackCurlFront } from './containedTools.js';
import { ccrcContainedEnv } from './ccrcContainment.js';
import { installVersionedTree, keepDigestEnv } from './installTreeFixture.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f: string): string => readFileSync(join(here, f), 'utf8');

/** What `command -v <name>` answers under `env` — resolution only, nothing is executed. */
function resolve(env: NodeJS.ProcessEnv, name: string): string {
  const r = spawnSync('/bin/sh', ['-c', `command -v ${name}`], { env, encoding: 'utf8' });
  return r.stdout.trim();
}

/** An executable `name` in a fresh directory outside every fixture HOME. */
function decoy(name: string): string {
  const d = mkTmp('decoy-');
  writeFileSync(join(d, name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return d;
}

/** An env that satisfies the bus half of the checker: both paths SET and under `home`. */
const busUnder = (home: string): NodeJS.ProcessEnv => ({
  HOME: home,
  XDG_RUNTIME_DIR: join(home, 'no-runtime-dir'),
  DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(home, 'no-bus')}`,
});

describe('assertNoRealTool — the checker\'s own self-tests (wave 9 R10d, 3a)', () => {
  it('(a) a real-looking ssh outside the fixture HOME, first on PATH, is refused by name and path', () => {
    const home = mkTmp('contain-a-');
    const d = decoy('ssh');
    expect(() => assertNoRealTool({ ...busUnder(home), PATH: d }, home)).toThrow(/ssh resolved to .*decoy/);
  });

  it('(b) a SYMLINK from the fixture to a binary outside it is refused — by realpath, not by the path the shell printed', () => {
    const home = mkTmp('contain-b-');
    const d = decoy('gh');
    const bin = join(home, 'bin');
    mkdirSync(bin, { recursive: true });
    symlinkSync(join(d, 'gh'), join(bin, 'gh'));
    // Control: the shell's own answer is a path INSIDE home — a checker that compared that string would pass it.
    expect(resolve({ PATH: bin }, 'gh')).toBe(join(bin, 'gh'));
    expect(() => assertNoRealTool({ ...busUnder(home), PATH: bin }, home)).toThrow(/gh/);
  });

  it('(c) an UNSET XDG_RUNTIME_DIR is refused: ccrc defaults it to the real bus (`: "${XDG_RUNTIME_DIR:=/run/user/$UID}"`)', () => {
    const home = mkTmp('contain-c-');
    mkdirSync(join(home, 'bin'), { recursive: true });
    const env: NodeJS.ProcessEnv = { ...busUnder(home), PATH: join(home, 'bin') };
    delete env['XDG_RUNTIME_DIR'];
    expect(() => assertNoRealTool(env, home)).toThrow(/XDG_RUNTIME_DIR/);
  });

  it('(d) a DBUS_SESSION_BUS_ADDRESS naming the real bus is refused', () => {
    const home = mkTmp('contain-d-');
    mkdirSync(join(home, 'bin'), { recursive: true });
    const env = { ...busUnder(home), PATH: join(home, 'bin'), DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1/bus' };
    expect(() => assertNoRealTool(env, home)).toThrow(/DBUS_SESSION_BUS_ADDRESS/);
  });

  it('(e) a clean env — nothing on PATH, both bus paths under the fixture — passes', () => {
    const home = mkTmp('contain-e-');
    mkdirSync(join(home, 'bin'), { recursive: true });
    expect(() => assertNoRealTool({ ...busUnder(home), PATH: join(home, 'bin') }, home)).not.toThrow();
  });
});

describe('ccrcContainedEnv — create-if-absent, spine builders, and the loopback curl front (wave 9 R10d, 3a)', () => {
  it('(f) a functional ssh and systemctl planted BEFORE the call keep their content; the rest is poisoned; the env passes the checker', () => {
    const home = mkTmp('contain-f-');
    const bin = harnessBin(home);
    writeFileSync(join(bin, 'ssh'), '#!/bin/sh\n# MARKER-FUNCTIONAL-SSH\nexit 0\n', { mode: 0o755 });
    writeFileSync(join(bin, 'systemctl'), '#!/bin/sh\n# MARKER-FUNCTIONAL-SYSTEMCTL\nexit 0\n', { mode: 0o755 });
    const env = ccrcContainedEnv(home, process.env, { managers: true, curl: 'poison' });
    expect(() => assertNoRealTool(env, home)).not.toThrow();
    for (const n of ['scp', 'curl']) expect(resolve(env, n), n).toBe(join(home, '.local', 'bin', n));
    expect(readFileSync(join(bin, 'ssh'), 'utf8')).toContain('MARKER-FUNCTIONAL-SSH');
    expect(readFileSync(join(bin, 'systemctl'), 'utf8')).toContain('MARKER-FUNCTIONAL-SYSTEMCTL');
  });

  it('(g) a SPINE builder\'s start leaves no manager and no .codex delegate in ~/.local/bin — and neither does keepDigest', () => {
    const home = mkTmp('contain-g-');
    // NOT checked by assertNoRealTool here: a spine builder's own fronts are what contain its manager names, and
    // `assertSpineFrontContained` pins them; this is only its START, which must hand `adoptPlantedSystemd` nothing.
    ccrcContainedEnv(home, process.env, { managers: false, curl: 'poison' });
    const names = ['systemctl', 'systemd-run', '.codex-systemctl', '.codex-systemd-run'];
    const listing = (): string[] => {
      const bin = join(home, '.local', 'bin');
      return existsSync(bin) ? readdirSync(bin) : [];
    };
    for (const n of names) expect(listing(), `after the builder: ${n}`).not.toContain(n);
    installVersionedTree(home, 'v1.0.0');
    for (const n of names) expect(listing(), `after keepDigest: ${n}`).not.toContain(n);
  });

  describe('(h) the loopback curl front', () => {
    const realCurl = spawnSync('/bin/sh', ['-c', 'command -v curl'], { encoding: 'utf8' }).stdout.trim();
    const closedPort = async (): Promise<number> => {
      const s = createNetServer();
      await new Promise<void>((res) => s.listen(0, '127.0.0.1', res));
      const p = (s.address() as AddressInfo).port;
      await new Promise<void>((res) => s.close(() => res()));
      return p;
    };
    const run = (env: NodeJS.ProcessEnv, args: string[]): number => {
      const r = spawnSync('/bin/sh', ['-c', 'exec curl "$@"', 'curl', ...args], { env, encoding: 'utf8', timeout: 20_000 });
      return r.status ?? -1;
    };
    it.skipIf(realCurl === '')('a listed loopback port reaches the REAL curl (7, refused — never 97); anything else is recorded and refused', async () => {
      const home = mkTmp('contain-h-');
      const P = await closedPort();
      writeFileSync(join(home, 'curl-allow-ports'), `${P}\n`);
      const env = ccrcContainedEnv(home, process.env, { managers: false, curl: 'loopback' });
      expect(run(env, ['-sS', `http://127.0.0.1:${P}/`])).toBe(7);
      expect(readFileSync(join(home, 'curl-front-passed'), 'utf8')).toContain(`http://127.0.0.1:${P}/`);
      expect(existsSync(join(home, 'curl-poison')), 'nothing refused yet').toBe(false);
      expect(run(env, ['http://127.0.0.1:7788/health']), 'the live server\'s port').toBe(97);
      expect(run(env, ['https://example.invalid/']), 'another host').toBe(97);
      expect(run(env, ['-K', 'x', `http://127.0.0.1:${P}/`]), '-K').toBe(97);
      // `--url <listed>` reaches the real curl too (7); the `=` form is not a curl option at all (2, curl's own).
      expect(run(env, ['-sS', '--url', `http://127.0.0.1:${P}/`]), '--url').toBe(7);
      expect(run(env, [`--url=http://127.0.0.1:${P}/`]), '--url=').toBe(2);
      const refused = readFileSync(join(home, 'curl-poison'), 'utf8');
      expect(refused).toContain('http://127.0.0.1:7788/health');
      expect(refused).toContain('https://example.invalid/');
      expect(refused).toContain('-K');
    });
  });
});

// (h) again, for the front's ARGV PARSER (review fix, wave 9 R10d). The refusal rows build the front around a FAKE
// "real curl" that only records its argv, so a regressed front cannot reach any listener — not the live server's
// 7788, not a unix socket — while the test measures it: "refused" means exit 97 AND the fake never ran.
describe('the loopback curl front parses argv — an option it does not allowlist, a scheme-less URL, or a value that redirects the connection is refused (wave 9 R10d)', () => {
  const P = 41999;
  const setup = (): { run: (args: string[]) => number; fakeArgv: () => string[]; poison: () => string; passed: () => string } => {
    const home = mkTmp('contain-h2-');
    const bin = join(home, 'bin');
    mkdirSync(bin, { recursive: true });
    const fake = join(bin, 'fake-real-curl');
    writeFileSync(fake, '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/fake-curl-argv"\nexit 0\n', { mode: 0o755 });
    writeFileSync(join(bin, 'curl'), loopbackCurlFront(fake), { mode: 0o755 });
    writeFileSync(join(home, 'curl-allow-ports'), `${P}\n`);
    const env: NodeJS.ProcessEnv = { HOME: home, PATH: `${bin}:/usr/bin:/bin` };
    const read = (f: string): string => (existsSync(join(home, f)) ? readFileSync(join(home, f), 'utf8') : '');
    return {
      run: (args) => spawnSync('/bin/sh', ['-c', 'exec curl "$@"', 'curl', ...args], { env, encoding: 'utf8' }).status ?? -1,
      fakeArgv: () => read('fake-curl-argv').split('\n').filter(Boolean),
      poison: () => read('curl-poison'),
      passed: () => read('curl-front-passed'),
    };
  };
  const ok = `http://127.0.0.1:${P}/`;
  const refused: Array<[string, string[]]> = [
    ['a scheme-less URL on the live server\'s port', ['127.0.0.1:7788/health']],
    ['a scheme-less host', ['example.com/x']],
    ['a scheme-less URL on a LISTED port', [`127.0.0.1:${P}/`]],
    ['-x (proxy) with a listed URL', ['-x', '127.0.0.1:7788', ok]],
    ['--proxy', ['--proxy', 'http://127.0.0.1:7788', ok]],
    ['--preproxy', ['--preproxy', 'socks5://127.0.0.1:7788', ok]],
    ['--socks5', ['--socks5', '127.0.0.1:7788', ok]],
    ['--connect-to', ['--connect-to', `127.0.0.1:${P}:evil.example:443`, ok]],
    ['--resolve', ['--resolve', `127.0.0.1:${P}:203.0.113.7`, ok]],
    ['--unix-socket', ['--unix-socket', '/run/user/1000/bus', ok]],
    ['--abstract-unix-socket', ['--abstract-unix-socket', 'x', ok]],
    ['--doh-url', ['--doh-url', 'https://evil.example/dns', ok]],
    ['--next', [ok, '--next', 'http://127.0.0.1:7788/']],
    ['-:', [ok, '-:', 'http://127.0.0.1:7788/']],
    ['-K', ['-K', 'x', ok]],
    ['--config', ['--config', 'x', ok]],
    ['--', ['--', ok]],
    ['an unknown option', ['--no-such-option', ok]],
    ['an abbreviated allowlisted option (curl accepts prefixes; the front is exact)', ['--max-t', '3', ok]],
    ['a short cluster with a letter outside the set', ['-sx', '127.0.0.1:7788', ok]],
    ['a good URL beside a bad positional', [ok, 'http://127.0.0.1:7788/health']],
    ['--url on the live server\'s port', ['--url', 'http://127.0.0.1:7788/']],
    ['--url= on the live server\'s port', ['--url=http://127.0.0.1:7788/']],
    ['a scheme-less --url', ['--url', '127.0.0.1:7788/health']],
    ['userinfo that moves the host', [`http://127.0.0.1:${P}@evil.example/`]],
    ['https to the listed port', [`https://127.0.0.1:${P}/`]],
  ];
  for (const [what, args] of refused) {
    it(`refuses ${what}: exit 97, recorded, and nothing reaches curl`, () => {
      const t = setup();
      expect(t.run(args), args.join(' ')).toBe(97);
      expect(t.fakeArgv(), 'the (fake) real curl must not have run').toEqual([]);
      expect(t.poison()).toContain(args.join(' '));
      expect(t.passed()).toBe('');
    });
  }
  const passes: Array<[string, string[]]> = [
    ['the SHA256SUMS fetch shape ccrc uses', ['-fsSL', '--connect-timeout', '2', '--max-time', '5', '--max-filesize', '4096',
      '--speed-limit', '1024', '--speed-time', '30', '-o', '/tmp/x', `${ok}rel/SHA256SUMS`]],
    ['the bundle probe shape', ['-fsSL', '--connect-timeout', '2', '--max-time', '5', '-o', '/tmp/x', '-w', '%{http_code}', `${ok}b.sigstore.json`]],
    ['the health probe shape (an -H value that looks like a URL is a VALUE)', ['-s', '--max-time', '3', '-H', 'accept: application/json',
      '-w', '\n%{http_code}', `${ok}health`]],
    ['--url', ['--url', ok]],
    ['a header value that holds a URL, beside a good positional', ['-H', 'Referer: http://example.com/', ok]],
  ];
  for (const [what, args] of passes) {
    it(`passes ${what}, to the real curl, with -q first`, () => {
      const t = setup();
      expect(t.run(args), args.join(' ')).toBe(0);
      const argv = t.fakeArgv();
      expect(argv.length, 'the (fake) real curl ran (a `-w` value holding a newline logs two lines)').toBeGreaterThan(0);
      expect(argv[0]!.startsWith('-q '), `argv was: ${argv[0]}`).toBe(true);
      expect(t.passed()).toContain(ok);
      expect(t.poison()).toBe('');
    });
  }
  it('--url=<listed> passes the front (curl itself answers 2: it has no `--url=` form) and is recorded as passed; the live port is refused above', () => {
    const t = setup();
    expect(t.run([`--url=${ok}`])).toBe(0);
    expect(t.fakeArgv()[0]).toBe(`-q --url=${ok}`);
    expect(t.passed()).toContain(ok);
  });
});

describe('keepDigest\'s env (wave 9 R9-F8, 3b)', () => {
  it('main\'s literal env shape — HOME and the parent\'s PATH, nothing else — is refused by the checker', () => {
    const home = mkTmp('contain-kd-main-');
    expect(() => assertNoRealTool({ HOME: home, PATH: process.env['PATH'] }, home)).toThrow();
  });

  it('keepDigestEnv hands out no env under which a real ssh, scp, systemctl, systemd-run, launchctl, tmux, gh or curl can run, and no real user bus (wave 9 R10d)', () => {
    const home = mkTmp('contain-kd-');
    expect(() => assertNoRealTool(keepDigestEnv(home), home)).not.toThrow();
    // Inside the fixture HOME, outside ~/.local/bin: adoptPlantedSystemd and the exact listings read only that dir.
    expect(existsSync(join(home, '.local', 'bin')), 'keepDigestEnv must not create ~/.local/bin').toBe(false);
    expect(readdirSync(join(home, '.keep-digest-poison-bin')).sort()).toEqual([...CONTAINED_TOOLS].sort());
    // Create-if-absent, on every call: a second call changes nothing.
    const first = readFileSync(join(home, '.keep-digest-poison-bin', 'ssh'), 'utf8');
    chmodSync(join(home, '.keep-digest-poison-bin', 'ssh'), 0o755);
    keepDigestEnv(home);
    expect(readFileSync(join(home, '.keep-digest-poison-bin', 'ssh'), 'utf8')).toBe(first);
  });
});

// Two shapes only (fix round 1, F5): a raw `ccd/ccrc` spawn with no `env`, with `env: process.env`, or with
// `{ ...process.env, HOME: dir }` is invisible to both scans below.
describe('the census — two shapes of a bare parent env: a `ghContainedEnv({ ...process.env` builder, and the `...process.env, HOME: home` literal (wave 9 R10d, 3c)', () => {
  const FILES = ['ccrc-update.test.ts', 'ccrc-install.test.ts', 'ccrc-cli.test.ts', 'ccrc-install-graphify.test.ts',
    'installTreeFixture.ts'] as const;
  const lineOf = (src: string, at: number): number => src.slice(0, at).split('\n').length;

  it('no `ghContainedEnv(` call in the five files is handed `{ ...process.env` — every builder starts from ccrcContainedEnv', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      const src = read(f);
      for (const m of src.matchAll(/ghContainedEnv\(/g)) {
        const call = src.slice(m.index!, m.index! + 200);
        if (/\.\.\.process\.env/.test(call)) offenders.push(`${f}:${lineOf(src, m.index!)}`);
      }
    }
    expect(offenders, `ghContainedEnv called with the parent's env bare at ${offenders.join(', ')}`).toEqual([]);
  });

  it('`...process.env, HOME: home` appears only at the three ccd/ccgpt-runtime spawns of ccrc-install.test.ts', () => {
    const counts: Record<string, string[]> = {};
    for (const f of FILES) {
      const src = read(f);
      const at: string[] = [];
      for (const m of src.matchAll(/\.\.\.process\.env, HOME: home/g)) at.push(`${f}:${lineOf(src, m.index!)}`);
      counts[f] = at;
    }
    for (const f of FILES) {
      const want = f === 'ccrc-install.test.ts' ? 3 : 0;
      expect(counts[f]!.length, `${f}: ${counts[f]!.join(', ')}`).toBe(want);
    }
    // The three survivors run the GPT lane's binary, never ccd/ccrc.
    const src = read('ccrc-install.test.ts');
    for (const loc of counts['ccrc-install.test.ts']!) {
      const line = Number(loc.split(':')[1]);
      const window = src.split('\n').slice(Math.max(0, line - 12), line + 1).join('\n');
      expect(window, `${loc} must be a ccgpt-runtime spawn`).toMatch(/ccgpt-runtime/);
    }
  });

  it('keepDigest spawns under keepDigestEnv, and installTreeFixture.ts imports nothing from vitest or ./ccrcContainment', () => {
    const src = read('installTreeFixture.ts');
    const start = src.indexOf('export function keepDigest(');
    expect(start, 'keepDigest not found').toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf('\n}\n', start));
    expect(body).toContain('keepDigestEnv(');
    const imports = [...src.matchAll(/^import[^;]*from\s+'([^']+)'/gms)].map((m) => m[1]!);
    expect(imports.filter((i) => /vitest|ccrcContainment/.test(i))).toEqual([]);
    expect(imports).toContain('./containedTools.js');
  });

  it('runInstall and runUpdate each call assertNoRealTool(env, home) AFTER assertSpineFrontContained(env, home', () => {
    for (const [f, fn] of [['ccrc-install.test.ts', 'runInstall'], ['ccrc-update.test.ts', 'runUpdate']] as const) {
      const src = read(f);
      const start = src.indexOf(`function ${fn}(`);
      expect(start, `${f}: ${fn} not found`).toBeGreaterThan(-1);
      const body = src.slice(start, src.indexOf('\n}\n', start));
      const spine = body.indexOf('assertSpineFrontContained(env, home');
      const real = body.indexOf('assertNoRealTool(env, home)');
      expect(spine, `${fn} calls assertSpineFrontContained`).toBeGreaterThan(-1);
      expect(real, `${fn} calls assertNoRealTool(env, home)`).toBeGreaterThan(spine);
    }
  });
});
