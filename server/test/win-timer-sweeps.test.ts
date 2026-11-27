// The Windows port: four timer sweeps that failed (or did nothing) on every run of an MSYS2 box, each run here end to
// end under MSYS2's bash against a FIXTURE HOME, never the box's own.
//   - ccd-land-probe: MSYS2's Python has no signal.pthread_sigmask, so every tick died with an AttributeError (exit 1).
//   - ccd-usage-sweep: the models file's MSYS path was spelled inside node's code string, which MSYS never converts.
//   - ccd-scope-sweep: no XDG_RUNTIME_DIR from the manager; with the Windows spelling the manager now sets, it runs.
//   - ccd-tmp-sweep: Claude Code keeps its temp under %TEMP%\claude, not claude-<uid>, and is invisible to /proc.
import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { spawnSyncGroup } from './spawnGroup.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { resolveBash } from '../src/exec.js';
import { seedAccountsSh } from './ccdWsHelpers.js';
import { posixPath, posixPathList } from './helpers.js';

const WIN = process.platform === 'win32';
const REPO = path.resolve(__dirname, '../..');
const script = (name: string): string => (WIN ? posixPath(path.join(REPO, 'ccd', name)) : '');

afterEach(removeTmpFixtures);

/** A clean environment for an MSYS2 child: MSYS2's own tools first, nothing of the session running the suite. */
function msysEnv(home: string, extra: Record<string, string> = {}): Record<string, string> {
  const keep = ['SystemRoot', 'SYSTEMROOT', 'windir', 'WINDIR', 'ComSpec', 'PATHEXT', 'SystemDrive', 'NUMBER_OF_PROCESSORS'];
  const env: Record<string, string> = {};
  for (const k of keep) { const v = process.env[k]; if (v !== undefined) env[k] = v; }
  const inherited = process.env['PATH'] ?? process.env['Path'] ?? '';
  env['PATH'] = `/usr/bin:${posixPathList(inherited)}`;
  env['HOME'] = posixPath(home);
  env['LANG'] = 'C.UTF-8';
  return { ...env, ...extra };
}

/** `bash -c <body> _ args...` under MSYS2. */
function bashRun(body: string, args: string[], env: Record<string, string>, timeout = 240_000): { status: number | null; out: string; err: string } {
  const r = spawnSyncGroup(resolveBash(), ['-c', body, '_', ...args], { encoding: 'utf8', env, timeout, windowsHide: true });
  return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}

/** The same, asynchronous: for a run that needs this process's event loop (a fixture server, a holder). */
function bashAsync(body: string, args: string[], env: Record<string, string>): Promise<{ status: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const c = spawn(resolveBash(), ['-c', body, '_', ...args], { env, windowsHide: true });
    let out = ''; let err = '';
    c.stdout.on('data', (d) => { out += String(d); });
    c.stderr.on('data', (d) => { err += String(d); });
    c.on('close', (status) => resolve({ status, out, err }));
  });
}

describe.skipIf(!WIN)('ccd-land-probe on MSYS2 (no signal.pthread_sigmask)', () => {
  it('a tick over one project runs to its end: exit 0, the base measured', () => {
    const root = mkTmp('ccrc-win-land-');
    const home = path.join(root, 'home');
    fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    fs.mkdirSync(path.join(home, '.ccrc', 'landing'), { recursive: true });
    fs.mkdirSync(path.join(root, 'tmp'));
    fs.writeFileSync(path.join(home, '.ccrc', 'landing', 'proj-a.conf'), '');
    // The project's origin is a github URL rewritten to a local bare repository (the fixture's insteadOf), so the fetch
    // never leaves the box; the forge CLI is `false`, so the forge reads answer unmeasured.
    const setup = [
      'set -e', 'export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null',
      'G="git -c user.name=t -c user.email=t@t -c init.defaultBranch=main"',
      '$G init -q --bare "$1/origin.git"', '$G init -q "$HOME/projects/proj-a"', 'cd "$HOME/projects/proj-a"',
      'echo a > a', '$G add a', '$G commit -qm a', '$G remote add origin https://github.com/acme/proj-a',
      'git --git-dir="$1/origin.git" fetch -q "$HOME/projects/proj-a" main:main',
      'printf \'[url "%s"]\\n\\tinsteadOf = https://github.com/acme/proj-a\\n\' "$1/origin.git" > "$HOME/.gitconfig"',
    ].join('\n');
    const env = msysEnv(home, { TMPDIR: posixPath(path.join(root, 'tmp')) });
    const s = bashRun(setup, [posixPath(root)], env);
    expect(s.status, s.err).toBe(0);
    const r = bashRun('cd "$HOME" && exec bash "$1"', [script('ccd-land-probe')], { ...env, CCD_LAND_PROBE_GH: '/usr/bin/false' });
    expect(r.err).not.toContain('pthread_sigmask');
    expect(r.status, r.err).toBe(0);
    const probe = JSON.parse(fs.readFileSync(path.join(home, '.cc-sessions', 'landing', 'proj-a', 'probe'), 'utf8'));
    expect(probe.base.sha).toMatch(/^[0-9a-f]{40}$/);
  }, 300_000);
});

describe.skipIf(!WIN)('ccd-usage-sweep on MSYS2 (a native node and an MSYS path)', () => {
  it('reads the class table and completes a pass: exit 0, one record counted', () => {
    const home = mkTmp('ccrc-win-usage-');
    seedAccountsSh(home);
    fs.mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
    fs.copyFileSync(path.join(REPO, 'ccd', 'ccd-usage-sweep.py'), path.join(home, '.local', 'bin', 'ccd-usage-sweep.py'));
    const env = msysEnv(home, { CCRC_TREE: posixPath(REPO) });
    const line = JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), sessionId: 's1',
      message: { id: 'm1', model: 'claude-opus-5', usage: { input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } });
    // One transcript in the first rostered account's config dir, found through the roster itself.
    const put = bashRun('set -e; . "$HOME/.ccrc/accounts.sh"; d="$(_ccrc_cfg_dir "${CCRC_ACCOUNTS[0]}")/projects/-w-demo"; mkdir -p "$d"; printf \'%s\\n\' "$1" > "$d/s1.jsonl"',
      [line], env);
    expect(put.status, put.err).toBe(0);
    const r = bashRun('exec bash "$1"', [script('ccd-usage-sweep')], env);
    expect(r.err).not.toContain('could not read FAMILY_TOKENS');
    expect(r.status, r.err).toBe(0);
    expect(r.out).toMatch(/usage-sweep: ok \S+ 1 records/);
    const census = JSON.parse(fs.readFileSync(path.join(home, '.ccrc', 'usage-sweep.json'), 'utf8'));
    expect(census.passes.at(-1)).toMatchObject({ status: 'ok', records: 1 });
  }, 300_000);
});

describe.skipIf(!WIN)('ccd-scope-sweep on MSYS2 (the manager\'s Windows-spelled XDG_RUNTIME_DIR, no cgroups)', () => {
  it('finds no pane scope and writes its record: exit 0', async () => {
    const root = mkTmp('ccrc-win-scope-');
    const home = path.join(root, 'home');
    const run = path.join(root, 'run');   // the Windows spelling, as the manager hands it to every unit
    fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    fs.mkdirSync(run);
    // The manager stand-in: the real win/bin/systemctl shim, answering from a fixture endpoint that lists no pane scope.
    const server = http.createServer((req, res) => {
      if (req.headers['x-ccrc-sup-token'] !== 'fixture-token') { res.statusCode = 403; res.end(); return; }
      res.end(req.url === '/units' ? 'claude-session@lane-a-x.service loaded active running lane-a-x\nccrc.service loaded active running ccrc\n' : '');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    try {
      const port = (server.address() as { port: number }).port;
      fs.mkdirSync(path.join(home, '.ccrc', 'supervisor'), { recursive: true });
      fs.writeFileSync(path.join(home, '.ccrc', 'supervisor', 'endpoint.json'), JSON.stringify({ port, token: 'fixture-token' }));
      const base = msysEnv(home);
      const env = { ...base, PATH: `${posixPath(path.join(REPO, 'win', 'bin'))}:${base['PATH']}` };
      const unset = await bashAsync('exec bash "$1"', [script('ccd-scope-sweep')], env);
      expect(unset.status, 'the measured failure, without the runtime directory').toBe(1);
      expect(unset.err).toContain('no-runtime-dir');
      const r = await bashAsync('exec bash "$1"', [script('ccd-scope-sweep')], { ...env, XDG_RUNTIME_DIR: run });
      expect(r.status, r.err).toBe(0);
    } finally { server.close(); }
    const state = fs.readFileSync(path.join(run, 'ccd-scope-sweep.state'), 'utf8').split('\n').filter(Boolean);
    expect(state).toHaveLength(1);
    expect(state[0]).toMatch(/^# ccd-scope-sweep v1 tick=\d+ up=\d+ mode=shadow$/);
  }, 300_000);
});

describe.skipIf(!WIN)('ccd-tmp-sweep on MSYS2 (%TEMP%\\claude, native Claude Code)', () => {
  const DEAD = '11111111-1111-4111-8111-111111111111';
  const LIVE = '22222222-2222-4222-8222-222222222222';
  const HELD = '33333333-3333-4333-8333-333333333333';

  /** Three old sessions under <TEMP>/claude/<slug>; LIVE is named by a session file under a WINDOWS pid (this test
   *  runner's own: a native process MSYS's /proc never lists). `probe` is the stand-in for `ccd path-users`: the one
   *  probe's native detection is ccd's own test (ccd-win-native-users.test.ts); here it is what the sweep asks and obeys. */
  function fixture(probe: string): { proj: string; temp: string; asks: string; env: Record<string, string> } {
    const root = mkTmp('ccrc-win-tmpsweep-');
    const home = path.join(root, 'home');
    const temp = path.join(root, 'temp');
    fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const proj = path.join(temp, 'claude', 'C--w-proj');
    for (const u of [DEAD, LIVE, HELD]) {
      fs.mkdirSync(path.join(proj, u, 'scratchpad'), { recursive: true });
      fs.writeFileSync(path.join(proj, u, 'scratchpad', 'f'), 'x\n');
    }
    fs.mkdirSync(path.join(home, '.claude', 'sessions'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: LIVE }));
    const old = new Date(Date.now() - 10 * 86_400_000);
    const age = (p: string): void => {
      for (const e of fs.readdirSync(p, { withFileTypes: true })) {
        if (e.isDirectory()) age(path.join(p, e.name)); else fs.utimesSync(path.join(p, e.name), old, old);
      }
      fs.utimesSync(p, old, old);
    };
    age(path.join(temp, 'claude'));
    const asks = path.join(root, 'asks');
    const stub = path.join(root, 'ccd');
    fs.writeFileSync(stub, `#!/bin/bash\nprintf '%s\\n' "$*" >> '${posixPath(asks)}'\n${probe}\n`, { mode: 0o755 });
    return { proj, temp, asks, env: msysEnv(home, { TEMP: temp, TMP: temp, CCD_TMP_SWEEP_CCD: posixPath(stub) }) };
  }
  // Answers held for HELD and nobody for every other path, in the order asked, as `ccd path-users --json` does.
  const ANSWERS = 'shift 2>/dev/null; [ "$1" = --json ] && shift\n'
    + `for p in "$@"; do v=nobody; case "$p" in *${HELD}) v=held ;; esac; printf '{"path":"%s","verdict":"%s","pids":[],"why":""}\\n' "$p" "$v"; done`;

  it('sweeps <TEMP>/claude: a dead session goes; one a live Windows pid names, and one the probe calls held, stay', async () => {
    const fx = fixture(ANSWERS);
    const pre = bashRun('[ -d "/proc/$1" ] && echo listed || echo unlisted', [String(process.pid)], fx.env);
    expect(pre.out.trim(), 'the live pid must be one /proc cannot see').toBe('unlisted');
    const r = await bashAsync('exec bash "$1"', [script('ccd-tmp-sweep')], fx.env);
    expect(r.status, r.err).toBe(0);
    expect(r.out).toContain(`root ${posixPath(path.join(fx.temp, 'claude'))}`);
    expect(r.out).toMatch(/removed 1 unit\(s\) \(1 session dir\(s\), 0 loose\)/);
    expect(r.out).toMatch(/skipped 1 live, 1 in-use/);
    expect(fs.existsSync(path.join(fx.proj, DEAD)), 'the dead session').toBe(false);
    expect(fs.existsSync(path.join(fx.proj, LIVE, 'scratchpad', 'f')), 'the live session').toBe(true);
    expect(fs.existsSync(path.join(fx.proj, HELD, 'scratchpad', 'f')), 'the held session').toBe(true);
    // The dead pass asked the probe about both units it would judge, never the live one.
    const first = fs.readFileSync(fx.asks, 'utf8').split('\n')[0]!;
    expect(first).toMatch(/^path-users --json /);
    expect(first).toContain(DEAD);
    expect(first).toContain(HELD);
    expect(first).not.toContain(LIVE);
  }, 300_000);

  it('a probe that cannot answer holds every unit: nothing is removed', async () => {
    const fx = fixture('exit 1');
    const r = await bashAsync('exec bash "$1"', [script('ccd-tmp-sweep')], fx.env);
    expect(r.status, r.err).toBe(0);
    expect(r.out).toMatch(/removed 0 unit\(s\)/);
    expect(r.out).toMatch(/skipped 1 live, 2 in-use/);
    for (const u of [DEAD, LIVE, HELD]) expect(fs.existsSync(path.join(fx.proj, u, 'scratchpad', 'f')), u).toBe(true);
  }, 300_000);
});
