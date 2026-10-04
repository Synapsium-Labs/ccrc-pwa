// Wave 9 R10d / R9-F8 (Task 3): containment of the ccrc test envs is STRUCTURAL.
//
// Three groups, one file because they are one claim:
//   3a — the checker's own self-tests (`assertNoRealTool`), the loopback curl front, and the create-if-absent
//        rule `ccrcContainedEnv` is built on. A checker nothing can make red is a comment.
//   3b — the one per-builder pin that lives HERE: `keepDigest`'s env (`installTreeFixture.ts` registers no
//        tests). The other builders pin themselves in their own files.
//   3c — the census: a text scan of the five files that build ccrc envs, so a builder that slides back to
//        `ghContainedEnv(home, { ...process.env … })`, or a raw spawn of the real `ccd/ccrc` that hands the
//        parent's env bare, reds here and names its line.
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
import { CONTAINED_TOOLS, assertNoRealTool } from './containedTools.js';
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
      const refused = readFileSync(join(home, 'curl-poison'), 'utf8');
      expect(refused).toContain('http://127.0.0.1:7788/health');
      expect(refused).toContain('https://example.invalid/');
      expect(refused).toContain('-K');
    });
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

describe('the census — no builder or raw spawn of the real ccd/ccrc hands the parent\'s env bare (wave 9 R10d, 3c)', () => {
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
