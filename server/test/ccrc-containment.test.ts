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
//        F5). Since wave 18 (R14(b)) `raw-spawn-census.test.ts` reads every file of both test trees for exactly
//        those three shapes.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync, chmodSync,
} from 'node:fs';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv, harnessBin } from './ccdWsHelpers.js';
import {
  CONTAINED_TOOLS, assertNoPoisonLeft, assertNoRealTool, busUnder as busUnderOf, loopbackCurlFront, physicalPath,
  plantPoison, takePoisonRecord,
} from './containedTools.js';
import { ccrcContainedEnv } from './ccrcContainment.js';
import { installVersionedTree, keepDigestEnv } from './installTreeFixture.js';
import { TOKEN_CLAIM_PATH } from '../../shared/box-token.js';

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

describe('the bus is read physically, loginctl is contained, and every builder sets the bus (D-8394, residue R35(e) and (f))', () => {
  /** A directory outside every fixture HOME, standing in for the real runtime dir. */
  const outside = (): string => mkTmp('contain-real-runtime-');

  it('a bus path through `sym/..` resolves inside HOME lexically but climbs out physically: refused', () => {
    const home = mkTmp('contain-symdotdot-');
    const real = outside();
    mkdirSync(join(real, 'sub'));
    symlinkSync(join(real, 'sub'), join(home, 'sym'));
    const via = `${home}/sym/..`;
    expect(path.resolve(via), 'lexically, HOME itself').toBe(home);
    expect(physicalPath(via), 'physically, the real dir').toBe(realpathSync(real));
    const env = { HOME: home, PATH: join(home, 'bin'), XDG_RUNTIME_DIR: via,
      DBUS_SESSION_BUS_ADDRESS: `unix:path=${via}/bus` };
    expect(busUnderOf(env, home)).toBe(false);
    expect(() => assertNoRealTool(env, home)).toThrow(/XDG_RUNTIME_DIR=.*does not name a path inside the fixture HOME/);
  });

  it('a bus value that is a symlink under HOME to a runtime dir outside it is refused', () => {
    const home = mkTmp('contain-symbus-');
    const real = outside();
    symlinkSync(real, join(home, 'xdg'));
    const env = { HOME: home, PATH: join(home, 'bin'), XDG_RUNTIME_DIR: join(home, 'xdg'),
      DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(home, 'xdg', 'bus')}` };
    expect(busUnderOf(env, home)).toBe(false);
    expect(() => assertNoRealTool(env, home)).toThrow(/does not name a path inside the fixture HOME/);
    // ghContainedEnv no longer keeps that pair: the fixture pair replaces it.
    const contained = ghContainedEnv(home, env);
    expect(contained['XDG_RUNTIME_DIR']).toBe(join(home, 'no-runtime-dir'));
  });

  it('a fixture runtime dir the test made under HOME, existing or not, still stands', () => {
    const home = mkTmp('contain-ownbus-');
    mkdirSync(join(home, 'xdg'));
    for (const dir of [join(home, 'xdg'), join(home, 'not-made-yet')]) {
      const env = { HOME: home, XDG_RUNTIME_DIR: dir, DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(dir, 'bus')}` };
      expect(busUnderOf(env, home), dir).toBe(true);
      expect(ghContainedEnv(home, env)['XDG_RUNTIME_DIR'], dir).toBe(dir);
    }
  });

  it('loginctl is a contained tool: a real-looking one first on PATH is refused, and ccrcContainedEnv poisons it', () => {
    expect(CONTAINED_TOOLS).toContain('loginctl');
    const home = mkTmp('contain-loginctl-');
    const d = decoy('loginctl');
    expect(() => assertNoRealTool({ ...busUnder(home), PATH: d }, home)).toThrow(/loginctl resolved to .*decoy/);
    const env = ccrcContainedEnv(home, { ...process.env, PATH: `${d}:${process.env['PATH'] ?? ''}` },
      { managers: false, curl: 'poison' });
    // `managers: false` is a SPINE builder's call, and a spine builder fronts its own systemctl and systemd-run next;
    // this case plants those two as poisons in its place, so a runner with a real /usr/bin/systemctl stays contained
    // and loginctl is the one thing under test (D-8394).
    for (const n of ['systemctl', 'systemd-run']) plantPoison(harnessBin(home), n);
    expect(resolve(env, 'loginctl')).toBe(join(harnessBin(home), 'loginctl'));
    expect(() => assertNoRealTool(env, home)).not.toThrow();
    const ccd = ghContainedEnv(mkTmp('contain-loginctl-ccd-'), {}, { systemd: true });
    expect(ccd['PATH']!.split(':')[0]).toMatch(/\.local\/bin$/);
    expect(existsSync(join(ccd['PATH']!.split(':')[0]!, 'loginctl')), 'the systemd arm plants it').toBe(true);
  });

  it('a gh-only ghContainedEnv (a thin builder) sets the fixture bus over the caller\'s real pair', () => {
    const home = mkTmp('contain-thin-bus-');
    const env = ghContainedEnv(home, { ...process.env, HOME: home, XDG_RUNTIME_DIR: '/run/user/0',
      DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/0/bus' });
    expect(`${env['XDG_RUNTIME_DIR']}|${env['DBUS_SESSION_BUS_ADDRESS']}`)
      .toBe(`${join(home, 'no-runtime-dir')}|unix:path=${join(home, 'no-bus')}`);
  });
});

describe('the poison teardown: a record nothing took is a standing red (D-8394, residue R35(e))', () => {
  /** Runs the poison at `<home>/.local/bin/<name>` with HOME set, as a spawn under a builder would. */
  const hit = (home: string, name: string, ...args: string[]): number | null =>
    spawnSync(join(harnessBin(home), name), args, { env: { HOME: home, PATH: '/usr/bin:/bin' } }).status;

  it('a poison hit and not taken fails the check, naming the record and its argv; once named it is not named again', () => {
    const home = mkTmp('contain-ledger-');
    plantPoison(harnessBin(home), 'ssh');
    expect(hit(home, 'ssh', 'box', 'uptime')).toBe(97);
    expect(() => assertNoPoisonLeft()).toThrow(new RegExp(`${join(home, 'ssh-poison').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: "box uptime"`));
    expect(() => assertNoPoisonLeft(), 'a leak reds once, in the test that made it').not.toThrow();
  });

  it('a record the case takes passes; a later hit of the same record re-arms it', () => {
    const home = mkTmp('contain-ledger-take-');
    plantPoison(harnessBin(home), 'scp');
    hit(home, 'scp', 'a', 'b');
    expect(takePoisonRecord(home, 'scp')).toEqual(['a b']);
    expect(() => assertNoPoisonLeft([home])).not.toThrow();
    hit(home, 'scp', 'c');
    expect(() => assertNoPoisonLeft()).toThrow(/scp-poison: "a b"/);
  });

  it('the ledger outlives a HOME the test removed itself', () => {
    const home = mkTmp('contain-ledger-gone-');
    plantPoison(harnessBin(home), 'curl');
    hit(home, 'curl', 'http://example.invalid/');
    rmSync(home, { recursive: true, force: true });
    expect(() => assertNoPoisonLeft()).toThrow(/curl-poison: "http:\/\/example\.invalid\/" \(removed with its HOME\)/);
  });

  it('the one standing allowance: a manager poison met by read-only state queries only, read off the file or the ledger', () => {
    const home = mkTmp('contain-ledger-readonly-');
    for (const n of ['launchctl', 'loginctl']) plantPoison(harnessBin(home), n);
    hit(home, 'launchctl', 'print', 'gui/501/app.ccrc.ccrc');
    hit(home, 'loginctl', 'show-user', '501', '--property=Linger');
    expect(() => assertNoPoisonLeft([home]), 'read-only queries, the files present').not.toThrow();
    hit(home, 'launchctl', 'print', 'gui/501/app.ccrc.ccrc-agent');
    rmSync(home, { recursive: true, force: true });
    expect(() => assertNoPoisonLeft(), 'a read-only query, its HOME gone: judged from the ledger').not.toThrow();
  });

  it('a manager record with a WRITE beside its state query is a leak', () => {
    const home = mkTmp('contain-ledger-write-');
    plantPoison(harnessBin(home), 'launchctl');
    hit(home, 'launchctl', 'print', 'gui/501/app.ccrc.ccrc');
    hit(home, 'launchctl', 'bootout', 'gui/501/app.ccrc.ccrc');
    expect(() => assertNoPoisonLeft([home])).toThrow(/launchctl-poison: "print gui\/501\/app\.ccrc\.ccrc"/);
    writeFileSync(join(home, 'systemctl-poison'), '--user is-active ccrc.service\n--user stop ccrc.service\n');
    expect(() => assertNoPoisonLeft([home])).toThrow(/systemctl-poison/);
  });

  it('a hand-written `*-poison` file under a directory is found by the scan, and taking it clears it', () => {
    const home = mkTmp('contain-ledger-scan-');
    mkdirSync(join(home, 'nested', 'home'), { recursive: true });
    writeFileSync(join(home, 'nested', 'home', 'journalctl-poison'), '-u ccrc\n');
    expect(() => assertNoPoisonLeft([home])).toThrow(/journalctl-poison: "-u ccrc"/);
    writeFileSync(join(home, 'rsync-poison'), 'x\n');
    expect(takePoisonRecord(home, 'rsync')).toEqual(['x']);
    expect(() => assertNoPoisonLeft([home])).not.toThrow();
  });

  it('the teardown is wired: tmpHelpers checks after every test and scans what it removes; the harness checks its HOME', () => {
    // An afterEach runs after the test it guards, so nothing in a file can watch its own hook fire: pinned in the
    // source, as `tmpfixtures.test.ts` pins `afterAll(removeTmpFixtures);`.
    const strip = (src: string): string => src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    const tmp = strip(read('tmpHelpers.ts'));
    expect(tmp.split('afterEach(() => { assertNoPoisonLeft(); });').length - 1, 'the per-test check').toBe(1);
    for (const fn of ['export function removeTmpFixtures(', 'export function removeTmpFixturesSince(']) {
      const start = tmp.indexOf(fn);
      expect(start, fn).toBeGreaterThan(-1);
      const body = tmp.slice(start, tmp.indexOf('\n}\n', start));
      expect(body.indexOf('assertNoPoisonLeft(dirs)'), `${fn} scans before it removes`).toBeGreaterThan(-1);
      // The removal goes through `removeDir` (the late-writer retry, D-8394), which is `rmSync` recursive and forced.
      expect(body.indexOf('removeDir('), `${fn} removes through removeDir`).toBeGreaterThan(-1);
      expect(body.indexOf('assertNoPoisonLeft(dirs)')).toBeLessThan(body.indexOf('removeDir('));
    }
    const rd = tmp.slice(tmp.indexOf('function removeDir('), tmp.indexOf('\n}\n', tmp.indexOf('function removeDir(')));
    expect(rd).toContain('rmSync(dir, { recursive: true, force: true, maxRetries: ');
    expect(strip(read('ccdWsHelpers.ts'))).toContain('cleanup: () => { try { assertNoPoisonLeft([home]); } finally {');
  });

  it('the gh poison and the loopback curl front log their hits in the same ledger', () => {
    const home = mkTmp('contain-ledger-gh-');
    const env = ghContainedEnv(home, { HOME: home, PATH: '/usr/bin:/bin' });
    expect(spawnSync('gh', ['pr', 'list'], { env }).status).toBe(97);
    writeFileSync(join(harnessBin(home), 'curl'), loopbackCurlFront('/usr/bin/false'), { mode: 0o755 });
    expect(spawnSync(join(harnessBin(home), 'curl'), ['http://example.invalid/'], { env }).status).toBe(97);
    rmSync(home, { recursive: true, force: true });
    expect(() => assertNoPoisonLeft()).toThrow(/gh-poison[^]*curl-poison|curl-poison[^]*gh-poison/);
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
      const refused = takePoisonRecord(home, 'curl').join('\n');
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
  const setup = (extraEnv: NodeJS.ProcessEnv = {}): {
    run: (args: string[], input?: string) => number; fakeArgv: () => string[]; fakeStdin: () => string;
    fakeProxyEnv: () => string; poison: () => string; passed: () => string;
    home: string; bin: string; env: NodeJS.ProcessEnv;
  } => {
    const home = mkTmp('contain-h2-');
    const bin = join(home, 'bin');
    mkdirSync(bin, { recursive: true });
    const fake = join(bin, 'fake-real-curl');
    // It also keeps what it was handed on stdin, and any proxy variable it inherited (wave 13, R16): a `-K -` config
    // must reach the real curl intact, and the `-K -` path must run it with the proxy variables unset.
    writeFileSync(fake, '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/fake-curl-argv"\ncat > "$HOME/fake-curl-stdin"\n'
      + 'env | grep -i \'proxy=\' >> "$HOME/fake-curl-proxy-env"\nexit 0\n', { mode: 0o755 });
    writeFileSync(join(bin, 'curl'), loopbackCurlFront(fake), { mode: 0o755 });
    writeFileSync(join(home, 'curl-allow-ports'), `${P}\n`);
    const env: NodeJS.ProcessEnv = { HOME: home, PATH: `${bin}:/usr/bin:/bin`, ...extraEnv };
    const read = (f: string): string => (existsSync(join(home, f)) ? readFileSync(join(home, f), 'utf8') : '');
    return {
      home, bin, env,
      run: (args, input = '') => spawnSync('/bin/sh', ['-c', 'exec curl "$@"', 'curl', ...args],
        { env, encoding: 'utf8', input }).status ?? -1,
      fakeArgv: () => read('fake-curl-argv').split('\n').filter(Boolean),
      fakeStdin: () => read('fake-curl-stdin'),
      fakeProxyEnv: () => read('fake-curl-proxy-env'),
      // TAKEN (D-8394): every case here meets the front's refusal on purpose and asserts on its record.
      poison: () => { const lines = takePoisonRecord(home, 'curl'); return lines.length ? `${lines.join('\n')}\n` : ''; },
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
  // `-K -` with a stdin config of `header = "…"` lines, and the three options ccrc-api and notify.sh add (wave 13, R16;
  // D-4095). A row whose subject is an option hands the front a config that would otherwise pass; a row whose subject
  // is the config changes one thing in an otherwise-valid line, so each row refuses for its own reason. The token is a
  // fixture: no row carries a real one.
  const HDR = 'header = "x-ccrc-mail-token: ' + 'z'.repeat(64) + '"\n';
  // ccd/ccrc-token-sync's claim body as its printf writes it: fixture code and node id, never a real one.
  const CLAIM_CODE = 'Qx9_-'.repeat(9).slice(0, 43);
  const CLAIM_NODE = '0123abcd-0000-4000-8000-000000000001';
  const CLAIM_LINE = `data = "{\\"code\\":\\"${CLAIM_CODE}\\",\\"nodeId\\":\\"${CLAIM_NODE}\\"}"\n`;
  const refusedCfg: Array<[string, string[], string]> = [
    ['-K <file> (only `-K -` is admitted)', ['-K', '/tmp/x', ok], HDR],
    ['--config - (only the short spelling the senders use)', ['--config', '-', ok], HDR],
    ['-K- attached', ['-K-', ok], HDR],
    ['a second -K -', ['-K', '-', '-K', '-', ok], HDR],
    // The key rows carry a HEADER-SHAPED value, so the key is the only thing that can refuse them (wave 13, R16).
    ['a url key', ['-K', '-', ok], 'url = "x-a: b"\n'],
    ['a proxy key', ['-K', '-', ok], 'proxy = "x-a: b"\n'],
    ['a connect-to key', ['-K', '-', ok], 'connect-to = "x-a: b"\n'],
    ['a resolve key', ['-K', '-', ok], 'resolve = "x-a: b"\n'],
    ['an output key', ['-K', '-', ok], 'output = "x-a: b"\n'],
    ['a config key (curl would read a second config)', ['-K', '-', ok], 'config = "x-a: b"\n'],
    ['a capitalised key', ['-K', '-', ok], 'Header = "x-a: b"\n'],
    ['no space before the =', ['-K', '-', ok], 'header= "x-a: b"\n'],
    ['two spaces before the =', ['-K', '-', ok], 'header  = "x-a: b"\n'],
    ['a leading space', ['-K', '-', ok], ' header = "x-a: b"\n'],
    ['a comment line', ['-K', '-', ok], '# header = "x-a: b"\n'],
    ['a trailing comment', ['-K', '-', ok], 'header = "x-a: b" # c\n'],
    ['a url directive smuggled ahead of a header on one line', ['-K', '-', ok], 'url = "http://127.0.0.1:7788/" header = "x-a: b"\n'],
    ['a dot in the header name', ['-K', '-', ok], 'header = "x.y: z"\n'],
    ['an @ leading the header name', ['-K', '-', ok], 'header = "@x: y"\n'],
    ['a carriage return inside the header value', ['-K', '-', ok], 'header = "x-a: b\r"\n'],
    ['a good header line beside a url line', ['-K', '-', ok], `${HDR}url = "http://127.0.0.1:7788/"\n`],
    ['an @file header', ['-K', '-', ok], 'header = "@/etc/passwd"\n'],
    ['a quote inside the header value', ['-K', '-', ok], 'header = "x-ccrc-mail-token: a"b"\n'],
    ['a backslash inside the header value', ['-K', '-', ok], 'header = "x-ccrc-mail-token: a\\b"\n'],
    ['an unquoted header value', ['-K', '-', ok], 'header = x-ccrc-mail-token: zz\n'],
    ['the long-option config spelling', ['-K', '-', ok], '--header "x-ccrc-mail-token: zz"\n'],
    ['a blank line inside the config', ['-K', '-', ok], `${HDR}\n${HDR}`],
    // `cfg=$(cat)` strips only TRAILING newlines, so a leading one survives to the check (wave 18, R23(d)).
    ['a LEADING blank line', ['-K', '-', ok], `\n${HDR}`],
    ['--data-binary @file', ['--data-binary', '@/etc/passwd', ok], ''],
    ['-d @file', ['-d', '@/etc/passwd', ok], ''],
    ['-X with a URL in its value', ['-X', 'GET http://127.0.0.1:7788/', ok], ''],
    ['-X lowercase', ['-X', 'post', ok], ''],
    ['-X empty', ['-X', '', ok], ''],
    // The claim body (box-token lifecycle wave 1, Task B1): the ONE `data` line shape the front admits. Each row changes
    // one thing in an otherwise-admitted line, so each refuses for its own reason.
    ['a data line naming a file', ['-K', '-', ok], 'data = "@/etc/passwd"\n'],
    ['a data-binary key carrying the claim body', ['-K', '-', ok], CLAIM_LINE.replace(/^data /, 'data-binary ')],
    ['a claim body with a third field', ['-K', '-', ok], CLAIM_LINE.replace('\\"}"', '\\",\\"url\\":\\"x\\"}"')],
    ['a claim code of 42 characters', ['-K', '-', ok], CLAIM_LINE.replace(CLAIM_CODE, CLAIM_CODE.slice(1))],
    ['an uppercase node id', ['-K', '-', ok], CLAIM_LINE.replace(CLAIM_NODE, CLAIM_NODE.toUpperCase())],
    ['an unescaped claim body', ['-K', '-', ok], CLAIM_LINE.replace(/\\"/g, '"')],
  ];
  for (const [what, args, input] of refusedCfg) {
    it(`refuses ${what}: exit 97, recorded by argv alone, and nothing reaches curl (wave 13, R16)`, () => {
      const t = setup();
      expect(t.run(args, input), args.join(' ')).toBe(97);
      expect(t.fakeArgv(), 'the (fake) real curl must not have run').toEqual([]);
      expect(t.poison()).toContain(args.join(' '));
      for (const line of input.split('\n').filter(Boolean)) {
        expect(t.poison(), 'the config reached the refusal log').not.toContain(line);
      }
      expect(t.passed()).toBe('');
    });
  }
  const passesCfg: Array<[string, string[], string]> = [
    ['ccrc-api\'s POST shape (`-K -` header, a JSON body)', ['-sS', '-K', '-', '-m', '30', '-o', '/tmp/x', '-w', '%{http_code}',
      '-X', 'POST', '-H', 'content-type: application/json', '--data-binary', '{"program":"p"}', `${ok}api/runs`], HDR],
    ['ccrc-api\'s GET shape', ['-sS', '-K', '-', '-m', '30', '-o', '/tmp/x', '-w', '%{http_code}', '-X', 'GET', `${ok}api/runs`], HDR],
    ['notify.sh\'s shape', ['-fsS', '-m', '5', '-X', 'POST', `${ok}api/notify`, '-K', '-', '-H', 'content-type: application/json',
      '-d', '{"message":"m"}'], HDR],
    ['an empty config (nothing in-tree sends one now; it names nothing, so it passes)', ['-fsS', '-m', '5', '-X', 'POST', `${ok}api/notify`, '-K', '-',
      '-H', 'content-type: application/json', '-d', '{"message":"m"}'], ''],
    ['two header lines', ['-sS', '-K', '-', ok], `${HDR}header = "accept: application/json"\n`],
    ['ccrc token sync\'s claim shape (`-K -` data line, the claim body)', ['-sS', '-K', '-', '-H', 'content-type: application/json',
      '-X', 'POST', '-o', '/tmp/x', '-w', '%{http_code}', '--max-filesize', '4096', '--max-time', '15', `${ok}${TOKEN_CLAIM_PATH.slice(1)}`],
      CLAIM_LINE],
  ];
  for (const [what, args, input] of passesCfg) {
    it(`passes ${what}, to the real curl with -q first, and hands it the config on stdin (wave 13, R16)`, () => {
      const t = setup();
      expect(t.run(args, input), args.join(' ')).toBe(0);
      const argv = t.fakeArgv();
      expect(argv[0], 'the (fake) real curl ran with -q first and the argv unchanged').toBe(`-q ${args.join(' ')}`);
      expect(t.fakeStdin(), 'the config did not reach the real curl intact').toBe(input);
      expect(t.passed()).toContain(ok);
      expect(t.poison()).toBe('');
    });
  }
  // The front reads the config with `cfg=$(cat)`, which strips EVERY trailing newline before the check runs (wave 13 fix
  // round 1, review 294 F2). So trailing blank lines pass, and the real curl gets the NORMALISED text (one trailing
  // newline), not the caller's bytes. A leading or interior blank line is refused (the `a LEADING blank line` and `a
  // blank line inside the config` rows above). An input of only `\n` reads as the empty config, which "passes an empty config" already
  // covers; it needs no row of its own.
  it('passes a config with trailing blank lines, handing the real curl the NORMALISED text: one trailing newline (wave 13 fix round 1, F2)', () => {
    const t = setup();
    const args = ['-sS', '-K', '-', ok];
    expect(t.run(args, HDR + '\n\n'), args.join(' ')).toBe(0);
    expect(t.fakeArgv()[0], 'the (fake) real curl ran with -q first and the argv unchanged').toBe(`-q ${args.join(' ')}`);
    expect(t.fakeStdin(), 'the config reached the real curl normalised: trailing newlines stripped, one put back').toBe(HDR);
    expect(t.poison()).toBe('');
  });
  // The config check fails CLOSED (wave 13 fix round 1, review 294 F1): it passes only when the rule-check's grep exits
  // exactly 1 (no line outside the rule). Both rows carry NO URL argument, so `allowed()` (which also calls grep, and
  // refuses first on its own) cannot mask the check: the refusal is `cfg_ok`'s or it is not a refusal.
  it('refuses a config the rule admits when grep cannot give a verdict: a grep that exits 2 (fix round 1, F1)', () => {
    const t = setup();
    writeFileSync(join(t.bin, 'grep'), '#!/bin/sh\nexit 2\n', { mode: 0o755 });
    const args = ['-sS', '-K', '-'];
    expect(t.run(args, HDR), args.join(' ')).toBe(97);
    expect(t.fakeArgv(), 'the (fake) real curl must not have run').toEqual([]);
    expect(t.poison(), 'the log holds the refusal record and nothing else').toBe(`${args.join(' ')}\n`);
    expect(t.poison(), 'the config reached the refusal log').not.toContain(HDR.trim());
    expect(t.passed()).toBe('');
  });
  it('refuses a url directive when there is no grep on PATH at all: a check that cannot run is not a pass (fix round 1, F1)', () => {
    const t = setup();
    // On the refusal path the front calls one external tool besides grep: `cat` (the config read). Everything else it
    // uses there is a shell builtin, and the shebang and the harness's `/bin/sh` are absolute. No grep, and
    // /usr/bin:/bin are OFF this PATH. `cat` is resolved on the host (`/usr/bin/cat` on Linux, `/bin/cat` on macOS).
    const cat = resolve(process.env, 'cat');
    expect(cat, 'no cat on the host PATH to link').not.toBe('');
    const tools = join(t.home, 'tools-no-grep');
    mkdirSync(tools, { recursive: true });
    symlinkSync(cat, join(tools, 'cat'));
    t.env['PATH'] = `${t.bin}:${tools}`;
    expect(spawnSync('/bin/sh', ['-c', 'command -v grep'], { env: t.env, encoding: 'utf8' }).stdout.trim(), 'a grep is on the row\'s PATH').toBe('');
    const args = ['-sS', '-K', '-'];
    expect(t.run(args, 'url = "http://203.0.113.9/x"\n'), args.join(' ')).toBe(97);
    expect(t.fakeArgv(), 'the (fake) real curl must not have run').toEqual([]);
    expect(t.poison(), 'the log holds the refusal record and nothing else').toBe(`${args.join(' ')}\n`);
    expect(t.poison(), 'the config reached the refusal log').not.toContain('203.0.113.9');
    expect(t.passed()).toBe('');
  });
  it('without -K -, the real curl gets the caller\'s stdin untouched: the front reads nothing (wave 13, R16)', () => {
    const t = setup();
    expect(t.run(['-sS', ok], 'not a config\n')).toBe(0);
    expect(t.fakeStdin()).toBe('not a config\n');
  });
  it('the -K - path runs the real curl with the parent\'s proxy variables unset, as the exec path does (wave 13, R16)', () => {
    const t = setup({ http_proxy: 'http://127.0.0.1:7788', HTTPS_PROXY: 'http://127.0.0.1:7788', ALL_PROXY: 'socks5://127.0.0.1:7788' });
    expect(t.run(['-sS', '-K', '-', ok], HDR)).toBe(0);
    expect(t.fakeStdin(), 'the -K - path did not run').toBe(HDR);
    expect(t.fakeProxyEnv(), 'a proxy variable reached the real curl on the -K - path').toBe('');
  });
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
// `{ ...process.env, HOME: dir }` is invisible to both scans below; `raw-spawn-census.test.ts` is that scan (wave 18).
describe('the census — two shapes of a bare parent env: a `ghContainedEnv({ ...process.env` builder, and the `...process.env, HOME: home` literal (wave 9 R10d, 3c)', () => {
  // The `ccrc update` suite is a family of files (D-6767): the shared fixture and the four parts.
  // D-6767: `ccrc-install-*.test.ts` is the family below (the fixture holds the runners, the parts the describes).
  const INSTALL_FAMILY = ['ccrc-installFixture.ts', 'ccrc-install-tree.test.ts', 'ccrc-install-versioned.test.ts',
    'ccrc-install-units.test.ts', 'ccrc-install-landing.test.ts', 'ccrc-install-role.test.ts',
    'ccrc-install-codex.test.ts'] as const;
  const FILES = ['ccrc-updateFixture.ts', 'ccrc-update-fetch.test.ts', 'ccrc-update-phases.test.ts', 'ccrc-update-kept.test.ts',
    'ccrc-update-flip-backups.test.ts', ...INSTALL_FAMILY, 'ccrc-cli.test.ts', 'ccrc-install-graphify.test.ts',
    'installTreeFixture.ts'] as const;
  const lineOf = (src: string, at: number): number => src.slice(0, at).split('\n').length;

  it('no `ghContainedEnv(` call in the files is handed `{ ...process.env` — every builder starts from ccrcContainedEnv', () => {
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

  // Two since codex-bridge Stage 4, Task 3: the third was `ccrc-install-units.test.ts`'s check that the usage unit's
  // interpreter was the one `ccgpt-runtime python` answers, and the unit no longer names a runtime interpreter.
  it('`...process.env, HOME: home` appears only at the two ccd/ccgpt-runtime spawns of the ccrc-install-*.test.ts family', () => {
    const counts: Record<string, string[]> = {};
    for (const f of FILES) {
      const src = read(f);
      const at: string[] = [];
      for (const m of src.matchAll(/\.\.\.process\.env, HOME: home/g)) at.push(`${f}:${lineOf(src, m.index!)}`);
      counts[f] = at;
    }
    for (const f of FILES) {
      if ((INSTALL_FAMILY as readonly string[]).includes(f)) continue;
      expect(counts[f]!.length, `${f}: ${counts[f]!.join(', ')}`).toBe(0);
    }
    const familyAt = INSTALL_FAMILY.flatMap((f) => counts[f]!);
    expect(familyAt.length, familyAt.join(', ')).toBe(2);
    // The two survivors run the GPT lane's binary, never ccd/ccrc.
    for (const loc of familyAt) {
      const [f, lineText] = loc.split(':');
      const line = Number(lineText);
      const window = read(f!).split('\n').slice(Math.max(0, line - 12), line + 1).join('\n');
      expect(window, `${loc} must be a ccgpt-runtime spawn`).toMatch(/ccgpt-runtime/);
    }
  });

  // THE SECOND RING (residue R35(a), D-8394): the update suites' direct callers and the thin `ccrc-*` builders. Each
  // file's builders start from ccrcContainedEnv, or call ghContainedEnv with `net: true` (ssh, scp and curl poisons;
  // the fixture bus is every caller's since D-8394). `ccrc-doctor-fleet-box.test.ts` stays gh-only by measurement:
  // `net`'s poisons land in `~/.local/bin`, ahead of the doctor fixture's own stub dir on `doctorEnv`'s PATH.
  const RING2 = ['ccd-update-sync.test.ts', 'update-intent-cross-side.test.ts', 'updateIntentFixtures.ts',
    'ccrc-restamp.test.ts', 'ccrc-approval-key.test.ts', 'ccrc-versioned-audit.test.ts', 'ccrc-passwd.test.ts',
    'ccrc-rollout.test.ts', 'ccrc-uninstall.test.ts', 'ccrc-account.test.ts', 'ccrc-expose.test.ts'] as const;
  /** Every `ghContainedEnv(` CALL in `src` (comment lines skipped) as its full argument text, parentheses matched. */
  const ghCalls = (src: string): Array<{ at: number; text: string }> => {
    const out: Array<{ at: number; text: string }> = [];
    for (const m of src.matchAll(/ghContainedEnv\(/g)) {
      const lineStart = src.lastIndexOf('\n', m.index!) + 1;
      if (/^\s*(\/\/|\*)/.test(src.slice(lineStart, m.index!))) continue;
      let depth = 0;
      let j = m.index! + 'ghContainedEnv'.length;
      for (; j < src.length; j++) {
        if (src[j] === '(') depth++;
        else if (src[j] === ')' && --depth === 0) break;
      }
      out.push({ at: lineOf(src, m.index!), text: src.slice(m.index!, j + 1) });
    }
    return out;
  };

  it('the second ring: every builder in the files starts from ccrcContainedEnv, or asks ghContainedEnv for `net` (D-8394)', () => {
    const offenders: string[] = [];
    for (const f of RING2) {
      const src = read(f);
      const calls = ghCalls(src);
      for (const c of calls) if (!/\bnet: true\b/.test(c.text)) offenders.push(`${f}:${c.at}`);
      if (calls.length === 0 && !/ccrcContainedEnv\(/.test(src)) offenders.push(`${f}: no builder at all`);
    }
    expect(offenders, `a second-ring builder without net or ccrcContainedEnv at ${offenders.join(', ')}`).toEqual([]);
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
    for (const [f, fn] of [['ccrc-installFixture.ts', 'runInstall'], ['ccrc-updateFixture.ts', 'runUpdate']] as const) {
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
