// The delegation broker's capture rig (wave 1, spec 2026-10-04 §8.1-§8.2): the mock Anthropic
// API, the driver's guards and setup, the sanitiser and the matrix builder. Hermetic: no row
// starts Claude Code, names the real HOME, or touches any tmux server.
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

const RIG = path.resolve(__dirname, 'delegation-rig');
const MOCK = path.join(RIG, 'mockapi.mjs');

const children: ChildProcess[] = [];
afterEach(() => { for (const c of children.splice(0)) c.kill('SIGKILL'); });

/** The env a mock spawns with: the outer shell's MOCK_LOG / MOCK_REQDIR / MOCK_MAIN_MARKER removed. */
function mockEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  delete env.MOCK_LOG; delete env.MOCK_REQDIR; delete env.MOCK_MAIN_MARKER;
  return env;
}

/** Start the mock on an ephemeral port with `script` as its MOCK_SCRIPT; resolves to its base URL.
 *  `cwd` (optional) is the mock's working directory. A mock that exits before binding rejects at once
 *  with its exit code and stderr. */
async function startMock(script: object, cwd?: string): Promise<string> {
  const dir = mkTmp('ccrc-dlg-mock-');
  const file = path.join(dir, 'script.json');
  fs.writeFileSync(file, JSON.stringify(script));
  const child = spawn(process.execPath, [MOCK], { env: mockEnv({ MOCK_PORT: '0', MOCK_SCRIPT: file }), stdio: ['ignore', 'pipe', 'pipe'], ...(cwd ? { cwd } : {}) });
  children.push(child);
  const port = await new Promise<string>((resolve, reject) => {
    let out = '';
    let err = '';
    const t = setTimeout(() => reject(new Error(`mock did not start: ${out}${err}`)), 10_000);
    child.stderr!.on('data', (b: Buffer) => { err += b.toString(); });
    child.on('exit', (code, signal) => { clearTimeout(t); reject(new Error(`mock exited before binding (code ${code}, signal ${signal}): ${err}`)); });
    child.stdout!.on('data', (b: Buffer) => {
      out += b.toString();
      const m = /^mock listening 127\.0\.0\.1:(\d+)$/m.exec(out);
      if (m) { clearTimeout(t); resolve(m[1] as string); }
    });
  });
  return `http://127.0.0.1:${port}`;
}

const MAIN_SYSTEM = [{ type: 'text', text: 'You are an interactive agent that helps users.' }];
// Carries the MAIN marker too, so only classify()'s cc_is_subagent arm can make this request a sub.
const SUB_SYSTEM = [{ type: 'text', text: 'You are an interactive agent that helps users. x-anthropic-billing-header: cc_is_subagent=true;' }];
const messages = (base: string, body: object): Promise<Response> =>
  fetch(`${base}/v1/messages?beta=true`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
/** The SSE stream as its parsed `data:` objects, in order. */
const events = async (r: Response): Promise<Array<Record<string, any>>> =>
  (await r.text()).split('\n\n').filter((b) => b.includes('data: ')).map((b) => JSON.parse(b.slice(b.indexOf('data: ') + 6)));

describe('mockapi.mjs (the rig\'s mock Anthropic API)', () => {
  it('answers the connectivity probe, and 404s an unknown route', async () => {
    const base = await startMock({ entries: [] });
    expect((await fetch(`${base}/api/hello`, { method: 'HEAD' })).status).toBe(200);
    expect((await fetch(`${base}/v1/nope`, { method: 'POST', body: '{}' })).status).toBe(404);
  });

  it('streams a scripted tool_use as message_start … input_json_delta … message_stop, stop_reason tool_use', async () => {
    const input = { description: 'dlg', prompt: 'dlg-sub', isolation: 'worktree' };
    const base = await startMock({ entries: [{ label: 'call', match: { kind: 'tools', lastUser: '^dlg go$' }, tool_use: { name: 'Agent', input } }] });
    const r = await messages(base, { model: 'm', stream: true, system: MAIN_SYSTEM, tools: [{ name: 'Agent' }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'dlg go' }] }] });
    const ev = await events(r);
    expect(ev.map((e) => e.type)).toEqual(expect.arrayContaining(['message_start', 'content_block_start', 'content_block_stop', 'message_delta', 'message_stop']));
    const start = ev.find((e) => e.type === 'content_block_start');
    expect(start?.content_block).toMatchObject({ type: 'tool_use', name: 'Agent' });
    const json = ev.filter((e) => e.delta?.type === 'input_json_delta').map((e) => e.delta.partial_json).join('');
    expect(JSON.parse(json)).toEqual(input);
    expect(ev.find((e) => e.type === 'message_delta')?.delta.stop_reason).toBe('tool_use');
  });

  it('nameAny picks the first name the request offers', async () => {
    const base = await startMock({ entries: [{ match: { kind: 'tools' }, tool_use: { nameAny: ['Agent', 'Task'], input: {} }, repeat: true }] });
    const ask = async (tools: string[]): Promise<string> => {
      const ev = await events(await messages(base, { model: 'm', stream: true, system: MAIN_SYSTEM,
        tools: tools.map((name) => ({ name })), messages: [{ role: 'user', content: 'x' }] }));
      return ev.find((e) => e.type === 'content_block_start')?.content_block.name;
    };
    expect(await ask(['Bash', 'Task'])).toBe('Task');
    expect(await ask(['Agent', 'Task'])).toBe('Agent');
  });

  it('matches a subagent request by its billing-header marker, and a tool_result by its text', async () => {
    const base = await startMock({ entries: [
      { label: 'sub', match: { kind: 'sub', lastUser: 'DLG-ACK-1' }, text: 'DLG-SUB-DONE' },
    ] });
    const ev = await events(await messages(base, { model: 'm', stream: true, system: SUB_SYSTEM, tools: [{ name: 'Bash' }],
      messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'DLG-ACK-1\n' }] }] }));
    expect(ev.filter((e) => e.delta?.type === 'text_delta').map((e) => e.delta.text).join('')).toBe('DLG-SUB-DONE');
  });

  it('reports consumed labels, and never consumes a repeat entry', async () => {
    const base = await startMock({ entries: [
      { label: 'once', match: { kind: 'tools', lastUser: '^a$' }, text: 'A' },
      { label: 'always', match: { kind: 'tools', lastUser: '^b$' }, text: 'B', repeat: true },
    ] });
    const ask = (t: string): Promise<Response> => messages(base, { model: 'm', stream: false, system: MAIN_SYSTEM, tools: [{ name: 'Bash' }], messages: [{ role: 'user', content: t }] });
    await (await ask('a')).text();
    await (await ask('b')).text();
    await (await ask('b')).text();
    const state = await (await fetch(`${base}/__rig/state`)).json() as { consumedLabels: string[]; requests: number };
    expect(state.consumedLabels).toEqual(['once']);
  });

  it('synthesises a side request\'s JSON from its schema', async () => {
    const base = await startMock({ entries: [] });
    const r = await messages(base, { model: 'm', stream: false, system: 'title', messages: [{ role: 'user', content: 'x' }],
      output_config: { format: { type: 'json_schema', schema: { type: 'object', properties: { title: { type: 'string' } } } } } });
    const body = await r.json() as { content: Array<{ text: string }> };
    expect(JSON.parse(body.content[0]!.text)).toEqual({ title: 'Rig session' });
  });

  it('replaces a $NOW+<s> header value with an epoch second', async () => {
    const base = await startMock({ entries: [{ match: { kind: 'tools' }, status: 429, headers: { 'anthropic-ratelimit-unified-reset': '$NOW+60' } }] });
    const before = Math.floor(Date.now() / 1000);
    const r = await messages(base, { model: 'm', stream: true, system: MAIN_SYSTEM, tools: [{ name: 'Bash' }], messages: [{ role: 'user', content: 'x' }] });
    expect(r.status).toBe(429);
    const reset = Number(r.headers.get('anthropic-ratelimit-unified-reset'));
    expect(reset).toBeGreaterThanOrEqual(before + 59);
    expect(reset).toBeLessThanOrEqual(before + 62);
  });

  it('refuses to start without MOCK_SCRIPT', () => {
    const r = spawnSync(process.execPath, [MOCK], { env: mockEnv({ MOCK_SCRIPT: '', MOCK_PORT: '0' }), encoding: 'utf8', timeout: 10_000 });
    expect(r.status).toBe(2);
  });

  it('a running mock with MOCK_LOG and MOCK_REQDIR unset writes no file', async () => {
    const cwd = mkTmp('ccrc-dlg-mockcwd-');
    const base = await startMock({ entries: [{ match: { kind: 'tools' }, text: 'ok' }] }, cwd);
    const r = await messages(base, { model: 'm', stream: false, system: MAIN_SYSTEM, tools: [{ name: 'Bash' }], messages: [{ role: 'user', content: 'x' }] });
    expect(r.status).toBe(200);
    await r.text();
    expect(fs.readdirSync(cwd)).toEqual([]);
    expect(fs.readdirSync(RIG).filter((n) => /\.log$|^reqs/.test(n))).toEqual([]);
  });
});

const RIGSH = path.join(RIG, 'rig.sh');
const TREE = path.resolve(__dirname, '../..');
const rigsh = (args: string[], env: NodeJS.ProcessEnv = {}, cwd?: string): { status: number | null; stdout: string; stderr: string } => {
  const r = spawnSync('bash', [RIGSH, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 120_000, ...(cwd ? { cwd } : {}) });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};

describe('rig.sh guards (the rig never names the real HOME or the default tmux server)', () => {
  it('guard-root accepts only an absolute, canonical ccrc-dlg-rig.* path outside $HOME', () => {
    const home = mkTmp('ccrc-dlg-home-');
    expect(rigsh(['guard-root', '/tmp/ccrc-dlg-rig.Ab12'], { HOME: home }).status).toBe(0);
    for (const bad of ['ccrc-dlg-rig.rel', '/tmp/other', `${home}/ccrc-dlg-rig.x`, '/tmp/ccrc-dlg-rig.x/../y',
      '/tmp//ccrc-dlg-rig.x', '/tmp/./ccrc-dlg-rig.x', '/tmp/ccrc-dlg-rig.x/', '/']) {
      expect(rigsh(['guard-root', bad], { HOME: home }).status, bad).not.toBe(0);
    }
    expect(rigsh(['guard-root', `${home}/ccrc-dlg-rig.x`], { HOME: `${home}/` }).status, 'a HOME with a trailing slash').not.toBe(0);
  }, 60_000);

  it('guard-sock accepts only ^dlg[A-Za-z0-9_-]*$', () => {
    expect(rigsh(['guard-sock', 'dlg123']).status).toBe(0);
    for (const bad of ['default', '', 'dlg/x', 'xdlg', 'dlg x']) expect(rigsh(['guard-sock', bad]).status, bad).not.toBe(0);
  }, 60_000);

  it('setup refuses a root the guard refuses, and creates nothing there', () => {
    const home = mkTmp('ccrc-dlg-home-');
    const r = rigsh(['setup', path.join(home, 'ccrc-dlg-rig.inside')], { HOME: home });
    expect(r.status).toBe(2);
    expect(fs.existsSync(path.join(home, 'ccrc-dlg-rig.inside'))).toBe(false);
  }, 60_000);

  it('check-scenario refuses a non-integer wait, a tmux separator among keys, and an unknown verb', () => {
    const dir = mkTmp('ccrc-dlg-sc-');
    const write = (name: string, steps: object[]): string => {
      const f = path.join(dir, `${name}.json`);
      fs.writeFileSync(f, JSON.stringify({ steps, entries: [] }));
      return f;
    };
    expect(rigsh(['check-scenario', write('ok', [{ waitReady: 60 }, { keys: ['Enter'] }, { probeLabels: ['a-1'], timeoutS: 9 }, { snapshot: 'before-kill' }])]).status).toBe(0);
    expect(rigsh(['check-scenario', write('arith', [{ waitReady: 'SECONDS[$(touch x)]' }])], {}, dir).status).toBe(2);
    expect(fs.existsSync(path.join(dir, 'x')), 'the arithmetic payload ran').toBe(false);
    expect(rigsh(['check-scenario', write('chain', [{ keys: ['Enter', ';', 'run-shell'] }])]).status).toBe(2);
    expect(rigsh(['check-scenario', write('verb', [{ bogus: 1 }])]).status).toBe(2);
  }, 60_000);

  it('run-base picks /tmp when TMPDIR sits under HOME by its spelling or its physical path, and keeps one outside', () => {
    const real = fs.realpathSync(mkTmp('ccrc-dlg-home-'));
    const outside = fs.realpathSync(mkTmp('ccrc-dlg-out-'));
    const linkHome = path.join(outside, 'home-link');
    fs.symlinkSync(real, linkHome);                       // HOME spelled through a symlink to the real directory
    const inside = path.join(real, 'sub'); fs.mkdirSync(inside);
    const viaLink = path.join(outside, 'tmp-link'); fs.symlinkSync(inside, viaLink);   // outside by spelling, inside by path
    const linkIn = path.join(real, 'out-link'); fs.symlinkSync(outside, linkIn);        // inside by spelling, outside by path
    const base = (home: string, tmpdir: string): string => rigsh(['run-base'], { HOME: home, TMPDIR: tmpdir }).stdout.trim();
    expect(base(real, inside), 'spelled under HOME').toBe('/tmp');
    expect(base(real, viaLink), 'physically under HOME').toBe('/tmp');
    expect(base(linkHome, inside), 'under the physical HOME, HOME spelled through a link').toBe('/tmp');
    expect(base(real, linkIn), 'spelled under HOME, physically outside').toBe('/tmp');
    expect(base(real, outside), 'outside HOME').toBe(outside);
    const text = fs.readFileSync(RIGSH, 'utf8');
    expect(text).toContain('mktemp -d "$(run_base)/ccrc-dlg-rig.XXXXXX"');
    expect(text).toContain('for d in "$(run_base)"/ccrc-dlg-rig.*; do');
  }, 120_000);

  it('no line of rig.sh calls tmux except through the private-socket helper', () => {
    const lines = fs.readFileSync(RIGSH, 'utf8').split('\n').filter((l) => /\btmux\b(?!-)/.test(l) && !/^\s*#/.test(l));
    const ok = (l: string): boolean => l.includes('tmux -L "$s" -f /dev/null') || l.includes('for c in jq tmux git');
    expect(lines.filter((l) => !ok(l))).toEqual([]);
  });

  it('reap removes a run root whose owner is gone and keeps one whose owner lives', () => {
    const tmp = mkTmp('ccrc-dlg-tmp-');
    const dead = fs.mkdtempSync(path.join(tmp, 'ccrc-dlg-rig.'));
    const live = fs.mkdtempSync(path.join(tmp, 'ccrc-dlg-rig.'));
    fs.writeFileSync(path.join(dead, '.owner'), `${spawnSync('true').pid}\n`);   // a finished child's pid
    fs.writeFileSync(path.join(live, '.owner'), `${process.pid}\n`);
    const r = rigsh(['reap'], { TMPDIR: tmp, TMUX_TMPDIR: mkTmp('ccrc-dlg-tmux-'), HOME: mkTmp('ccrc-dlg-home-') });
    expect(r.status, r.stderr).toBe(0);
    expect(fs.existsSync(dead)).toBe(false);
    expect(fs.existsSync(live)).toBe(true);
  }, 60_000);
});

/** Set every mtime under `root` (files, symlinks, then directories, children first) to `when`. */
function ageTree(root: string, when: Date): void {
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    const f = path.join(root, e.name);
    if (e.isDirectory()) ageTree(f, when);
    else if (!e.isSymbolicLink()) fs.utimesSync(f, when, when);
  }
  fs.utimesSync(root, when, when);
}

describe('rig.sh reap, an ownerless run root (a late writer recreated it after cleanup_run removed it)', () => {
  const reapIn = (tmp: string) => rigsh(['reap'], { TMPDIR: tmp, TMUX_TMPDIR: mkTmp('ccrc-dlg-tmux-'), HOME: mkTmp('ccrc-dlg-home-') });
  /** A root shaped like the measured leftover: only a transcript under fixhome/cfg/projects, no .owner. */
  const ownerless = (tmp: string): string => {
    const root = fs.mkdtempSync(path.join(tmp, 'ccrc-dlg-rig.'));
    const dir = path.join(root, 'fixhome', 'cfg', 'projects', '-rig-repo');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '00000000-0000-4000-8000-000000000000.jsonl'), '{}\n');
    return root;
  };
  const old = new Date(Date.now() - 30 * 60_000);

  it('removes one whose newest mtime is older than 10 minutes', () => {
    const tmp = mkTmp('ccrc-dlg-tmp-');
    const root = ownerless(tmp);
    ageTree(root, old);
    const r = reapIn(tmp);
    expect(r.status, r.stderr).toBe(0);
    expect(fs.existsSync(root)).toBe(false);
  }, 60_000);

  it('keeps a fresh one (run may be between mktemp and writing .owner), and one with a single fresh file inside an aged tree', () => {
    const tmp = mkTmp('ccrc-dlg-tmp-');
    const fresh = ownerless(tmp);
    const mixed = ownerless(tmp);
    ageTree(mixed, old);
    fs.writeFileSync(path.join(mixed, 'fixhome', 'late.txt'), 'x');   // one recent write anywhere keeps it
    const r = reapIn(tmp);
    expect(r.status, r.stderr).toBe(0);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.existsSync(mixed)).toBe(true);
  }, 60_000);

  it('skips a symlinked one, and what it points at', () => {
    const tmp = mkTmp('ccrc-dlg-tmp-');
    const target = ownerless(mkTmp('ccrc-dlg-target-'));
    ageTree(target, old);
    fs.symlinkSync(target, path.join(tmp, 'ccrc-dlg-rig.link'));
    const r = reapIn(tmp);
    expect(r.status, r.stderr).toBe(0);
    expect(fs.existsSync(path.join(target, 'fixhome'))).toBe(true);
    expect(fs.lstatSync(path.join(tmp, 'ccrc-dlg-rig.link')).isSymbolicLink()).toBe(true);
  }, 60_000);

  it('keeps an aged one while a process has its working directory under it', () => {
    const tmp = mkTmp('ccrc-dlg-tmp-');
    const root = ownerless(tmp);
    ageTree(root, old);
    const holder = spawn('sleep', ['60'], { cwd: path.join(root, 'fixhome'), stdio: 'ignore' });
    children.push(holder);
    const r = reapIn(tmp);
    expect(r.status, r.stderr).toBe(0);
    expect(fs.existsSync(root)).toBe(true);
  }, 60_000);
});

describe('rig.sh wait_run_quiet (cleanup_run waits out a process still under the run root)', () => {
  /** Run wait_run_quiet from rig.sh's own text (the case dispatch at its foot would otherwise run), with a 1 s bound. */
  const wait = (root: string): { status: number | null; stderr: string; ms: number } => {
    const text = fs.readFileSync(RIGSH, 'utf8');
    const from = text.indexOf('procs_under() {');
    const to = text.indexOf('cleanup_run() {');
    expect(from).toBeGreaterThan(0);
    expect(to).toBeGreaterThan(from);
    const t0 = Date.now();
    const r = spawnSync('bash', ['-c', `${text.slice(from, to)}\nwait_run_quiet "$1" ""`, 'x', root], { encoding: 'utf8', env: { ...process.env, RUN_QUIET_S: '1' }, timeout: 60_000 });
    return { status: r.status, stderr: r.stderr, ms: Date.now() - t0 };
  };
  const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const gone = async (pid: number): Promise<boolean> => { for (let i = 0; i < 50; i++) { if (!alive(pid)) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };

  it('returns at once when nothing is under the root', () => {
    const root = mkTmp('ccrc-dlg-rig.');
    const r = wait(root);
    expect(r.status, r.stderr).toBe(0);
    expect(r.ms).toBeLessThan(900);
  }, 60_000);

  it('waits for a process under the root to exit, and SIGKILLs one that outlasts the bound; a process elsewhere is never touched', async () => {
    const root = mkTmp('ccrc-dlg-rig.');
    const elsewhere = spawn('sleep', ['60'], { cwd: mkTmp('ccrc-dlg-else-'), stdio: 'ignore' });
    const brief = spawn('sleep', ['0.5'], { cwd: root, stdio: 'ignore' });
    const stuck = spawn('sleep', ['60'], { cwd: root, stdio: 'ignore' });
    children.push(elsewhere, brief, stuck);
    await new Promise((r) => setTimeout(r, 200));
    const r = wait(root);
    expect(r.status, r.stderr).toBe(0);
    expect(await gone(brief.pid!)).toBe(true);
    expect(await gone(stuck.pid!)).toBe(true);
    expect(alive(elsewhere.pid!)).toBe(true);
  }, 60_000);
});

describe('rig.sh reap, sockets and scenario text', () => {
  it('reap removes only the private socket of a dead owner (never `default`, never a live owner\'s)', () => {
    const tmuxTmp = fs.mkdtempSync('/tmp/dlgt-');   // short: a unix socket path is capped near 108 bytes
    try {
      const dir = path.join(tmuxTmp, `tmux-${os.userInfo().uid}`);
      fs.mkdirSync(dir);
      const deadPid = spawnSync('true').pid;
      const stale = (name: string): void => {   // a socket file whose listener is gone: bind, then die without unlinking
        const code = `require('node:net').createServer().listen(${JSON.stringify(path.join(dir, name))}, () => process.kill(process.pid, 'SIGKILL'))`;
        spawnSync(process.execPath, ['-e', code], { timeout: 10_000 });
      };
      for (const n of [`dlg${deadPid}`, `dlg${process.pid}`, 'default']) stale(n);
      for (const n of [`dlg${deadPid}`, `dlg${process.pid}`, 'default']) expect(fs.statSync(path.join(dir, n)).isSocket(), n).toBe(true);
      const r = rigsh(['reap'], { TMUX_TMPDIR: tmuxTmp, TMPDIR: mkTmp('ccrc-dlg-tmp-'), HOME: mkTmp('ccrc-dlg-home-') });
      expect(r.status, r.stderr).toBe(0);
      expect(fs.readdirSync(dir).sort()).toEqual(['default', `dlg${process.pid}`].sort());
    } finally { fs.rmSync(tmuxTmp, { recursive: true, force: true }); }
  }, 60_000);

  it('reap never follows a symlinked ccrc-dlg-rig.* entry', () => {
    const tmp = mkTmp('ccrc-dlg-tmp-');
    const target = mkTmp('ccrc-dlg-rig.');   // a name the guard would accept, so only the symlink skip protects it
    fs.writeFileSync(path.join(target, '.owner'), `${spawnSync('true').pid}\n`);
    fs.writeFileSync(path.join(target, 'keep'), 'x');
    fs.symlinkSync(target, path.join(tmp, 'ccrc-dlg-rig.link'));
    const r = rigsh(['reap'], { TMPDIR: tmp, TMUX_TMPDIR: mkTmp('ccrc-dlg-tmux-'), HOME: mkTmp('ccrc-dlg-home-') });
    expect(r.status, r.stderr).toBe(0);
    expect(fs.existsSync(path.join(target, 'keep'))).toBe(true);
  }, 60_000);

  it('setup refuses a root that resolves, through a symlink, to somewhere the guard refuses', () => {
    const home = fs.realpathSync(mkTmp('ccrc-dlg-home-'));
    const out = fs.realpathSync(mkTmp('ccrc-dlg-out-'));
    fs.mkdirSync(path.join(home, 'inner'));
    const link = path.join(out, 'ccrc-dlg-rig.viaparent');            // an existing entry that points into HOME
    fs.symlinkSync(path.join(home, 'inner'), link);
    const r1 = rigsh(['setup', link], { HOME: home });
    expect(r1.status).toBe(2);
    expect(fs.readdirSync(path.join(home, 'inner'))).toEqual([]);
    const parentLink = path.join(out, 'parent-link');                  // a not-yet-existing root under a parent that is such a link
    fs.symlinkSync(path.join(home, 'inner'), parentLink);
    const r2 = rigsh(['setup', path.join(parentLink, 'ccrc-dlg-rig.new')], { HOME: home });
    expect(r2.status).toBe(2);
    expect(fs.readdirSync(path.join(home, 'inner'))).toEqual([]);
  }, 60_000);

  it('check-scenario refuses a type or answerDialog value that is not a single-line string', () => {
    const dir = mkTmp('ccrc-dlg-sc-');
    const write = (name: string, steps: object[]): string => {
      const f = path.join(dir, `${name}.json`);
      fs.writeFileSync(f, JSON.stringify({ steps, entries: [] }));
      return f;
    };
    expect(rigsh(['check-scenario', write('ok', [{ type: 'dlg one' }, { answerDialog: 'Run a dynamic workflow' }])]).status).toBe(0);
    for (const [n, st] of [['t-nl', { type: 'a\nb' }], ['t-cr', { type: 'a\rb' }], ['t-num', { type: 7 }], ['d-nl', { answerDialog: 'x\ny' }], ['d-obj', { answerDialog: ['x'] }]] as Array<[string, object]>) {
      expect(rigsh(['check-scenario', write(n, [st])]).status, n).toBe(2);
    }
  }, 60_000);
});

describe('rig.sh setup (fixture HOME and repo)', () => {
  it('builds the fixture HOME and repo under its root, with ccrc\'s own hook registered by ccrc\'s own installer', () => {
    const home = mkTmp('ccrc-dlg-home-');
    const root = mkTmp('ccrc-dlg-rig.');
    const r = rigsh(['setup', root, '2.1.999'], { HOME: home });
    expect(r.status, r.stderr).toBe(0);
    const s = JSON.parse(fs.readFileSync(path.join(root, 'fixhome/cfg/settings.json'), 'utf8'));
    for (const ev of ['PreToolUse', 'PostToolUse', 'SubagentStart', 'SubagentStop', 'SessionStart', 'SessionEnd', 'Stop']) {
      expect(JSON.stringify(s.hooks[ev] ?? []), ev).toContain('/session-hook.sh');
    }
    expect(s.hooks.WorktreeCreate).toBeUndefined();
    expect(s.hooks.WorktreeRemove).toBeUndefined();
    expect(s).toMatchObject({ enableWorkflows: true, worktree: { baseRef: 'head' } });
    expect(s.permissions.allow).toEqual(expect.arrayContaining(['Bash', 'Agent', 'Workflow']));
    expect(s.permissions.defaultMode).toBe('default');
    expect(JSON.stringify(s)).not.toMatch(/bypassPermissions/);
    expect(fs.readFileSync(path.join(root, 'fixhome/.cc-sessions/session-hook.sh')))
      .toEqual(fs.readFileSync(path.join(TREE, 'ccd/session-hook.sh')));
    expect(fs.readFileSync(path.join(root, 'fixhome/.cc-sessions/rig-hookcap.generation'), 'utf8'))
      .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(fs.statSync(path.join(root, 'key')).mode & 0o777).toBe(0o600);
    const log = spawnSync('git', ['-C', path.join(root, 'repo'), 'log', '--format=%an <%ae>'], { encoding: 'utf8' });
    expect(log.stdout.trim()).toBe('Rig Fixture <you@example.com>');
    const cj = JSON.parse(fs.readFileSync(path.join(root, 'fixhome/cfg/.claude.json'), 'utf8'));
    expect(cj.projects[path.join(root, 'repo')]).toMatchObject({ hasTrustDialogAccepted: true });
    expect(cj.lastReleaseNotesSeen).toBe('2.1.999');
  }, 60_000);

  it('setup writes only under its root: the HOME it ran with is left empty', () => {
    const home = mkTmp('ccrc-dlg-home-');
    const root = mkTmp('ccrc-dlg-rig.');
    expect(rigsh(['setup', root], { HOME: home }).status).toBe(0);
    expect(fs.readdirSync(home)).toEqual([]);
  }, 60_000);

  it('every scenario passes check-scenario, names itself, and its waits and probes name its labels', () => {
    const dir = path.join(RIG, 'scenarios');
    const files = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort();
    expect(files).toHaveLength(14);
    for (const f of files) {
      expect(rigsh(['check-scenario', path.join(dir, f)]).status, f).toBe(0);
      const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as { scenario: string; covers: string[]; steps: Array<Record<string, unknown>>; entries: Array<{ label?: string }> };
      expect(s.scenario, f).toBe(f.replace(/\.json$/, ''));
      expect(s.covers.length, f).toBeGreaterThan(0);
      const labels = new Set(s.entries.map((e) => e.label).filter(Boolean));
      for (const st of s.steps) {
        const verb = Object.keys(st)[0] as string;
        if (verb === 'waitLabels' || verb === 'probeLabels') for (const l of st[verb] as string[]) expect(labels.has(l), `${f}: ${l}`).toBe(true);
      }
      expect(JSON.stringify(s), f).not.toMatch(/WorktreeCreate|WorktreeRemove|dangerously/);
    }
  }, 120_000);
});

const SANITIZE = path.join(RIG, 'sanitize.mjs');
/** A raw bundle as rig.sh's `collect` leaves it, for a run root that is only a STRING here. */
function rawBundle(raw: string, root: string, version: string, scenario: string, caps: Array<[string, number, object]>, versionsDir = '/opt/fake-claude/versions'): string {
  const d = path.join(raw, version, scenario);
  fs.mkdirSync(path.join(d, 'caps'), { recursive: true });
  fs.writeFileSync(path.join(d, 'root'), `${root}\n${root}\n`);
  fs.writeFileSync(path.join(d, 'version'), `${version}\n`);
  fs.writeFileSync(path.join(d, 'versions-dir'), `${versionsDir}\n`);
  fs.writeFileSync(path.join(d, 'scenario'), `${scenario}\n`);
  for (const [event, ms, payload] of caps) fs.writeFileSync(path.join(d, 'caps', `${event}-${ms}-100.cap`), `{"envSid":"u-1"}\n${JSON.stringify(payload)}\n`);
  const adm = path.join(d, 'admin', 'agent-abc');
  fs.mkdirSync(adm, { recursive: true });
  fs.writeFileSync(path.join(adm, 'files'), 'CLAUDE_BASE\nHEAD\ngitdir\nlogs\n');
  fs.writeFileSync(path.join(adm, 'gitdir'), `${root}/repo/.claude/worktrees/agent-abc/.git\n`);
  fs.writeFileSync(path.join(adm, 'HEAD'), 'aaaa\n');
  fs.writeFileSync(path.join(adm, 'CLAUDE_BASE'), 'bbbb');
  fs.writeFileSync(path.join(adm, 'first-log-sha'), 'bbbb\n');
  const munged = root.replace(/[^A-Za-z0-9]/g, '-');
  const meta = path.join(d, 'meta', 'cfg', `${munged}-repo`, 'uuid-1', 'subagents');
  fs.mkdirSync(meta, { recursive: true });
  fs.writeFileSync(path.join(meta, 'agent-abc.meta.json'), JSON.stringify({ worktreePath: `${root}/repo/.claude/worktrees/agent-abc`, toolUseId: 't' }));
  const snap = path.join(d, 'snapshots', 'before-kill');
  fs.mkdirSync(snap, { recursive: true });
  fs.writeFileSync(path.join(snap, 'admin-records'), 'agent-abc\n');
  fs.writeFileSync(path.join(snap, 'worktrees'), 'agent-abc\n');
  fs.writeFileSync(path.join(d, 'worktrees-left'), 'agent-abc\n');
  fs.writeFileSync(path.join(d, 'worktree-list'), `worktree ${root}/repo\nHEAD bbbb\nbranch refs/heads/main\n`);
  fs.writeFileSync(path.join(d, 'branches'), 'main\nworktree-agent-abc\n');
  fs.writeFileSync(path.join(d, 'labels'), '["main-call"]\n');
  fs.writeFileSync(path.join(d, 'notes'), '');
  return d;
}
const sanitize = (raw: string, out: string): { status: number | null; stdout: string; stderr: string } => {
  const r = spawnSync(process.execPath, [SANITIZE, raw, out], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};

describe('sanitize.mjs (raw bundles -> committed fixtures, fail-closed)', () => {
  const ROOT = '/tmp/ccrc-dlg-rig.Ab12Cd';
  const MUNGED = ROOT.replace(/[^A-Za-z0-9]/g, '-');
  const leakRun = (payload: object): { status: number | null; stderr: string; written: string[] } => {
    const raw = mkTmp('ccrc-dlg-raw.');
    const out = mkTmp('ccrc-dlg-fix-');
    rawBundle(raw, ROOT, '2.1.999', 'leak', [['Stop', 1, { hook_event_name: 'Stop', ...payload }]]);
    const r = sanitize(raw, out);
    return { status: r.status, stderr: r.stderr, written: fs.readdirSync(out) };
  };

  it('reads a closing tag as a tag, not a path: a task-notification prompt passes with an allowed output file and fails closed on a foreign one', () => {
    const note = (file: string): object => ({ prompt: `<task-notification><status>completed</status><output-file>${file}</output-file></task-notification>` });
    const foreign = leakRun(note('/srv/x/out'));
    expect(foreign.status, 'a real foreign path inside the tags').toBe(1);
    expect(foreign.written).toEqual([]);
    for (const file of ['/rig/tmp/x.output', `${ROOT}/tmp/x.output`]) {
      const ok = leakRun(note(file));
      expect(ok.status, `${file}: ${ok.stderr}`).toBe(0);
    }
  }, 60_000);

  it('a `<` is not a path boundary: a shell redirect or a tag around a real path still fails closed', () => {
    for (const prompt of ['a</srv/x', 'done</mnt/x/y', 'wc -l</etc/hosts', '<x></opt/app/conf></x>', 'sort</srv/data/list']) {
      const r = leakRun({ prompt });
      expect(r.status, prompt).toBe(1);
      expect(r.written, prompt).toEqual([]);
    }
  }, 60_000);

  it('replaces the run root, its munged form and the binaries directory; orders events; keeps shas and snapshots', () => {
    const raw = mkTmp('ccrc-dlg-raw.');
    const out = mkTmp('ccrc-dlg-fix-');
    rawBundle(raw, ROOT, '2.1.999', 'agent-plain', [
      ['SubagentStart', 20, { hook_event_name: 'SubagentStart', agent_id: 'abc', cwd: `${ROOT}/repo` }],
      ['SessionStart', 10, { hook_event_name: 'SessionStart', session_id: 's', cwd: `${ROOT}/repo`,
        transcript_path: `${ROOT}/fixhome/cfg/projects/${MUNGED}-repo/s.jsonl`, sink: '/dev/null', git: '/usr/bin/git',
        bin: '/opt/fake-claude/versions/2.1.999' }],
    ]);
    const r = sanitize(raw, out);
    expect(r.status, r.stderr).toBe(0);
    const text = fs.readFileSync(path.join(out, '2.1.999', 'agent-plain.json'), 'utf8');
    for (const bad of ['ccrc-dlg-rig', '/tmp/', '/opt/']) expect(text.includes(bad), bad).toBe(false);
    const f = JSON.parse(text);
    expect(f).toMatchObject({ v: 1, version: '2.1.999', scenario: 'agent-plain', labels: ['main-call'], notes: [] });
    expect(f.events.map((e: { event: string; seq: number; dtMs: number }) => [e.event, e.seq, e.dtMs])).toEqual([['SessionStart', 1, 0], ['SubagentStart', 2, 10]]);
    expect(f.events[0].payload).toMatchObject({ transcript_path: '/rig/fixhome/cfg/projects/-rig-repo/s.jsonl', sink: '/dev/null', git: '/usr/bin/git', bin: '/rig/versions/2.1.999' });
    expect(f.events[1].payload.cwd).toBe('/rig/repo');
    expect(f.disk.admin['agent-abc']).toEqual({ files: ['CLAUDE_BASE', 'HEAD', 'gitdir', 'logs'], gitdir: '/rig/repo/.claude/worktrees/agent-abc/.git',
      head: 'aaaa', claudeBase: 'bbbb', locked: false, firstLogSha: 'bbbb' });
    expect(Object.keys(f.disk.metas)).toEqual(['cfg/-rig-repo/uuid-1/subagents/agent-abc.meta.json']);
    expect(f.disk.snapshots).toEqual({ 'before-kill': { adminRecords: ['agent-abc'], worktrees: ['agent-abc'] } });
    expect(f.disk.worktreesLeft).toEqual(['agent-abc']);
  });

  it('fails closed on residue: exit 1, the finding named by place not value, and NOTHING written', () => {
    const raw = mkTmp('ccrc-dlg-raw.');
    const out = mkTmp('ccrc-dlg-fix-');
    rawBundle(raw, ROOT, '2.1.999', 'clean', [['Stop', 1, { hook_event_name: 'Stop' }]]);
    rawBundle(raw, ROOT, '2.1.999', 'dirty', [['Stop', 1, { hook_event_name: 'Stop', cwd: '/home/someone-else/x' }]]);
    const r = sanitize(raw, out);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('2.1.999/dirty /events/0/payload/cwd');
    expect(r.stderr).not.toContain('someone-else');
    expect(fs.readdirSync(out)).toEqual([]);
  });

  it('treats any absolute path outside /rig, /usr, /bin and /dev/null as residue, and a key-shaped string too', () => {
    for (const leak of ['/mnt/vol-0000/acme', '/srv/box/x', '/dev/shm/x', '/devnull', 'sk-ant-xyz']) {
      const r = leakRun({ note: leak });
      expect(r.status, leak).toBe(1);
      expect(r.stderr, leak).toContain('2.1.999/leak /events/0/payload/note');
      expect(r.stderr, leak).not.toContain(leak);
      expect(r.written, leak).toEqual([]);
    }
  });

  it('names a leaking KEY by its index, never its text', () => {
    // Each leaking key carries residue in its VALUE too: the value's own pointer runs THROUGH the key's
    // segment, so a pointer that printed the key's text would show it there. The second key is a
    // plain-NAME-shaped secret (it passes the segment pattern; only the residue test keeps it out).
    const r = leakRun({ tool_response: { '/home/someone-else/acme-client': '/srv/x', 'sk-ant-leakkey': '/srv/y' } });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('2.1.999/leak /events/0/payload/tool_response/#0 (key)');
    expect(r.stderr).toContain('2.1.999/leak /events/0/payload/tool_response/#1 (key)');
    expect(r.stderr).toContain('2.1.999/leak /events/0/payload/tool_response/#0\n');
    expect(r.stderr).toContain('2.1.999/leak /events/0/payload/tool_response/#1\n');
    expect(r.stderr).not.toContain('someone-else');
    expect(r.stderr).not.toContain('leakkey');
    expect(r.written).toEqual([]);
  });

  it('treats a path joined after a colon as residue (a PATH-like value), and writes nothing', () => {
    for (const leak of ['/usr/bin:/home/someone-else/.local/bin', '/usr/bin:/bin:/mnt/vol-0000/tools', 'PATH=/usr/bin:/srv/box/bin', '/usr/bin::/srv/box/bin']) {
      const r = leakRun({ env_path: leak });
      expect(r.status, leak).toBe(1);
      expect(r.stderr, leak).toContain('2.1.999/leak /events/0/payload/env_path');
      expect(r.stderr, leak).not.toContain('someone-else');
      expect(r.written, leak).toEqual([]);
    }
    // the allowed spellings still pass when colon-joined
    const ok = leakRun({ env_path: '/usr/bin:/bin:/rig/versions' });
    expect(ok.status, ok.stderr).toBe(0);
  });

  it('munges BOTH spellings of the run root (the root file holds the run root and its physical path)', () => {
    const PHYS = '/mnt/vol-0000/tmp/ccrc-dlg-rig.Ab12Cd';
    const PHYS_MUNGED = PHYS.replace(/[^A-Za-z0-9]/g, '-');
    const raw = mkTmp('ccrc-dlg-raw.');
    const out = mkTmp('ccrc-dlg-fix-');
    const d = rawBundle(raw, ROOT, '2.1.999', 'two-spellings', [['Stop', 1, {
      hook_event_name: 'Stop', cwd: `${PHYS}/repo`, transcript_path: `${PHYS}/fixhome/cfg/projects/${PHYS_MUNGED}-repo/s.jsonl`, other: `${ROOT}/repo`,
    }]]);
    fs.writeFileSync(path.join(d, 'root'), `${ROOT}\n${PHYS}\n`);
    const r = sanitize(raw, out);
    expect(r.status, r.stderr).toBe(0);
    const f = JSON.parse(fs.readFileSync(path.join(out, '2.1.999', 'two-spellings.json'), 'utf8'));
    expect(f.events[0].payload).toEqual({ hook_event_name: 'Stop', cwd: '/rig/repo', transcript_path: '/rig/fixhome/cfg/projects/-rig-repo/s.jsonl', other: '/rig/repo' });
  });

  it.skipIf(os.userInfo().username.length < 4)('fails closed on the running user\'s name as a whole word', () => {
    const r = leakRun({ note: `x-${os.userInfo().username}-y` });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('2.1.999/leak /events/0/payload/note');
    expect(r.stderr.toLowerCase()).not.toContain(os.userInfo().username.toLowerCase());
    expect(r.written).toEqual([]);
  });

  // The user's and host's names are read at test time, never written here.
  const USER = os.userInfo().username;
  const HOST = os.hostname().split('.')[0] as string;
  const cap = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1);
  const expectNamed = (r: { status: number | null; stderr: string; written: string[] }, ptr: string, ...secrets: string[]): void => {
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toContain(`2.1.999/leak ${ptr}`);
    for (const x of secrets) expect(r.stderr.toLowerCase()).not.toContain(x.toLowerCase());
    expect(r.written).toEqual([]);
  };

  it('fails closed on a `..` path segment, however the path before it reads', () => {
    for (const leak of ['/rig/../srv/acme', '/usr/../mnt/x', '/dev/null/../../srv/x', '../../srv/acme', '..']) {
      expectNamed(leakRun({ note: leak }), '/events/0/payload/note', 'srv/acme');
    }
    for (const fine of ['a..b', 'wait...', '/rig/repo/a..b']) {
      const r = leakRun({ note: fine });
      expect(r.status, `${fine}: ${r.stderr}`).toBe(0);
    }
  });

  it('fails closed on a `//`-led host or path (a URL, a share, a file:/// URL), and still passes the placeholder loopback', () => {
    for (const leak of ['file:///srv/x', '//fileserver/share', 'http://internal-host.corp/path', 'https://acme.example.org', 'x //srv/y']) {
      expectNamed(leakRun({ note: leak }), '/events/0/payload/note', 'fileserver', 'internal-host', 'acme.example');
    }
    for (const fine of ['http://127.0.0.1:4000/v1/messages', '/rig//x', '/usr//bin/git', 'a // b']) {
      const r = leakRun({ note: fine });
      expect(r.status, `${fine}: ${r.stderr}`).toBe(0);
    }
  });

  it.skipIf(USER.length < 4)('fails closed on the user\'s name in any case', () => {
    for (const leak of [`x-${cap(USER)}-y`, `x ${USER.toUpperCase()} y`, USER.toUpperCase()]) expectNamed(leakRun({ note: leak }), '/events/0/payload/note', USER);
  });

  it.skipIf(HOST.length < 4)('fails closed on the host\'s first label in any case', () => {
    for (const leak of [`a ${HOST.toUpperCase()} b`, `a ${cap(HOST)} b`, `a ${HOST} b`]) expectNamed(leakRun({ note: leak }), '/events/0/payload/note', HOST);
  });

  it.skipIf(USER.length < 4)('fails closed on the user\'s name glued to a digit or an underscore, and passes it glued to a letter', () => {
    for (const leak of [`${USER}2`, `3${USER}`, `${USER}_x`, `x_${USER}`]) expectNamed(leakRun({ note: leak }), '/events/0/payload/note', USER);
    const r = leakRun({ note: `${USER}x` });
    expect(r.status, r.stderr).toBe(0);
  });

  it('fails closed on a key-shaped string in any case', () => {
    for (const leak of ['SK-ANT-xyz', 'Sk-Ant-xyz', 'ANTHROPIC=sk-ant-xyz']) expectNamed(leakRun({ note: leak }), '/events/0/payload/note', 'xyz');
    expectNamed(leakRun({ note: 'CCRC-DLG-RIG.x' }), '/events/0/payload/note', 'dlg');
  });

  it('fails closed on a munged foreign path, and on the munged home directory', () => {
    for (const leak of ['-mnt-vol-0000-projects-acme', 'x -home-someone-else-repo', '-Users-x-y', '/rig/-srv-a/b']) {
      expectNamed(leakRun({ note: leak }), '/events/0/payload/note', 'someone-else', 'acme');
    }
    // the home directory is whatever HOME says; give it a shape no fixed pattern names
    const raw = mkTmp('ccrc-dlg-raw.');
    const out = mkTmp('ccrc-dlg-fix-');
    rawBundle(raw, ROOT, '2.1.999', 'leak', [['Stop', 1, { hook_event_name: 'Stop', note: '-weird-sandbox-home-x' }]]);
    const r = spawnSync(process.execPath, [SANITIZE, raw, out], { encoding: 'utf8', env: { ...process.env, HOME: '/weird/sandbox-home' } });
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toContain('2.1.999/leak /events/0/payload/note');
    expect(r.stderr).not.toContain('sandbox');
    expect(fs.readdirSync(out)).toEqual([]);
    // the same string passes when HOME is something else: the finding really is the home spelling
    const ok = spawnSync(process.execPath, [SANITIZE, raw, out], { encoding: 'utf8', env: { ...process.env, HOME: '/rig/h' } });
    expect(ok.status, ok.stderr).toBe(0);
  });

  it.skipIf(USER.length < 4)('scans the decoded spelling of an escaped string: \\uXXXX and %2F', () => {
    const esc = (w: string): string => [...w].map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`).join('');
    for (const leak of ['\\u002fsrv\\u002fx', '{"p":"\\u002fsrv\\u002fx"}', 'x %2Fsrv%2Fx', `x-${esc(USER)}-y`, '\\u002e\\u002e\\u002fx']) {
      expectNamed(leakRun({ note: leak }), '/events/0/payload/note', USER);
    }
  });

  it('finds residue under disk.*, each finding named by place', () => {
    const cases: Array<[string, (d: string) => void, string]> = [
      ['branches', (d) => fs.writeFileSync(path.join(d, 'branches'), 'main\n/srv/box/x\n'), '/disk/branches/1'],
      ['worktrees-left', (d) => fs.writeFileSync(path.join(d, 'worktrees-left'), '/srv/box/x\n'), '/disk/worktreesLeft/0'],
      ['worktree-list', (d) => fs.writeFileSync(path.join(d, 'worktree-list'), 'worktree /srv/box/x\n'), '/disk/worktreeList'],
      ['admin gitdir', (d) => fs.writeFileSync(path.join(d, 'admin', 'agent-abc', 'gitdir'), '/srv/box/x/.git\n'), '/disk/admin/agent-abc/gitdir'],
      ['meta value', (d) => fs.writeFileSync(path.join(d, 'meta', 'cfg', `${MUNGED}-repo`, 'uuid-1', 'subagents', 'agent-abc.meta.json'), JSON.stringify({ worktreePath: '/srv/box/x' })), '/disk/metas/#0/worktreePath'],
      ['snapshot', (d) => fs.writeFileSync(path.join(d, 'snapshots', 'before-kill', 'worktrees'), '/srv/box/x\n'), '/disk/snapshots/before-kill/worktrees/0'],
      ['label', (d) => fs.writeFileSync(path.join(d, 'labels'), '["/srv/box/x"]\n'), '/labels/0'],
      ['note', (d) => fs.writeFileSync(path.join(d, 'notes'), '/srv/box/x\n'), '/notes/0'],
    ];
    for (const [name, plant, ptr] of cases) {
      const raw = mkTmp('ccrc-dlg-raw.');
      const out = mkTmp('ccrc-dlg-fix-');
      plant(rawBundle(raw, ROOT, '2.1.999', 'leak', [['Stop', 1, { hook_event_name: 'Stop' }]]));
      const r = sanitize(raw, out);
      expect(r.status, `${name}: ${r.stderr}`).toBe(1);
      expect(r.stderr, name).toContain(`2.1.999/leak ${ptr}\n`);
      expect(r.stderr, name).not.toContain('srv/box');
      expect(fs.readdirSync(out), name).toEqual([]);
    }
  });

  it('a scenario directory with a bad name, or a residue-bearing one, is a finding named by index', () => {
    const raw = mkTmp('ccrc-dlg-raw.');
    const out = mkTmp('ccrc-dlg-fix-');
    rawBundle(raw, ROOT, '2.1.999', 'clean', [['Stop', 1, { hook_event_name: 'Stop' }]]);
    rawBundle(raw, ROOT, '2.1.999', 'Bad_Name', [['Stop', 1, { hook_event_name: 'Stop' }]]);
    rawBundle(raw, ROOT, '2.1.999', 'ccrc-dlg-rig-x', [['Stop', 1, { hook_event_name: 'Stop' }]]);
    const r = sanitize(raw, out);
    expect(r.status).toBe(1);
    // sorted: Bad_Name (0), ccrc-dlg-rig-x (1), clean (2)
    expect(r.stderr).toContain('2.1.999/#0 (scenario directory name)\n');
    expect(r.stderr).toContain('2.1.999/#1 (scenario directory name)\n');
    expect(r.stderr).not.toContain('#2');
    expect(r.stderr).not.toContain('Bad_Name');
    expect(r.stderr).not.toContain('dlg');
    expect(fs.readdirSync(out)).toEqual([]);
  });

  it('a name that passes the shape test but carries residue (a scenario named for the user) is a finding too', () => {
    const letters = USER.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (letters.length < 4 || !new RegExp(`(^|[^A-Za-z])${letters}($|[^A-Za-z])`, 'i').test(`x-${letters}`) || letters !== USER.toLowerCase()) return;
    const raw = mkTmp('ccrc-dlg-raw.');
    const out = mkTmp('ccrc-dlg-fix-');
    rawBundle(raw, ROOT, '2.1.999', `x-${letters}`, [['Stop', 1, { hook_event_name: 'Stop' }]]);
    const r = sanitize(raw, out);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('2.1.999/#0 (scenario directory name)\n');
    expect(r.stderr.toLowerCase()).not.toContain(letters);
    expect(fs.readdirSync(out)).toEqual([]);
  });

  it('reports a bundle it would otherwise drop: a version directory that is not a version, a scenario directory with no root file', () => {
    const raw = mkTmp('ccrc-dlg-raw.');
    const out = mkTmp('ccrc-dlg-fix-');
    rawBundle(raw, ROOT, '2.1.999', 'clean', [['Stop', 1, { hook_event_name: 'Stop' }]]);
    fs.mkdirSync(path.join(raw, '2.1.999', 'noroot'));
    fs.mkdirSync(path.join(raw, 'latest', 'x'), { recursive: true });
    const r = sanitize(raw, out);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('sanitize: residue in #1 (version directory name)\n');
    expect(r.stderr).toContain('2.1.999/#1 (bundle without a root file)\n');
    expect(r.stderr).not.toContain('latest');
    expect(r.stderr).not.toContain('noroot');
    expect(fs.readdirSync(out)).toEqual([]);
  });

  it('ignores plain files in the raw root (the rig\'s all.log and .done)', () => {
    const raw = mkTmp('ccrc-dlg-raw.');
    const out = mkTmp('ccrc-dlg-fix-');
    rawBundle(raw, ROOT, '2.1.999', 'clean', [['Stop', 1, { hook_event_name: 'Stop' }]]);
    fs.writeFileSync(path.join(raw, '.done'), '2026-10-05T00:00:00Z\n');
    fs.writeFileSync(path.join(raw, 'all.log'), '/srv/not-scanned\n');
    const r = sanitize(raw, out);
    expect(r.status, r.stderr).toBe(0);
    expect(fs.readdirSync(out)).toEqual(['2.1.999']);
  });

  it('writes NOTHING when a later step fails: a file where a version directory would go leaves the fixtures directory as it was', () => {
    const raw = mkTmp('ccrc-dlg-raw.');
    const base = mkTmp('ccrc-dlg-fixbase-');
    const out = path.join(base, 'fix');
    fs.mkdirSync(out);
    rawBundle(raw, ROOT, '2.1.998', 'clean', [['Stop', 1, { hook_event_name: 'Stop' }]]);
    rawBundle(raw, ROOT, '2.1.999', 'clean', [['Stop', 1, { hook_event_name: 'Stop' }]]);
    fs.writeFileSync(path.join(out, '2.1.999'), 'planted');
    const r = sanitize(raw, out);
    expect(r.status).toBe(1);
    expect(r.stderr).not.toContain(base);
    expect(fs.readdirSync(out)).toEqual(['2.1.999']);
    expect(fs.readFileSync(path.join(out, '2.1.999'), 'utf8')).toBe('planted');
    expect(fs.readdirSync(base)).toEqual(['fix']); // and no temp sibling is left behind
  });

  it('an I/O failure prints one fixed line, never the exception or a raw path', () => {
    const missing = path.join(mkTmp('ccrc-dlg-raw.'), 'no-such-raw-root');
    const out = mkTmp('ccrc-dlg-fix-');
    const r = sanitize(missing, out);
    expect(r.status).toBe(1);
    expect(r.stderr).toBe('sanitize: internal error (no detail printed)\n');
    expect(r.stdout).toBe('');
  });

  it('refuses missing arguments with exit 2', () => {
    expect(spawnSync(process.execPath, [SANITIZE], { encoding: 'utf8' }).status).toBe(2);
  });
});

const BUILD = path.join(RIG, 'build-matrix.mjs');
const FIX = path.resolve(__dirname, 'fixtures/delegation');
const SCEN = path.join(RIG, 'scenarios');
const build = (args: string[]): { status: number | null; stdout: string; stderr: string } => {
  const r = spawnSync(process.execPath, [BUILD, ...args], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};
const fixture = (over: Record<string, unknown>): Record<string, unknown> => ({
  v: 1, version: '2.1.1', scenario: 's', labels: [], notes: [], events: [],
  disk: { admin: {}, worktreesLeft: [], branches: [], worktreeList: '', metas: {}, snapshots: {} }, ...over,
});
const ev = (seq: number, event: string, payload: Record<string, unknown>) => ({ seq, dtMs: seq, event, envSid: 'u', payload });

describe('build-matrix.mjs (the corpus -> matrix.json, derived)', () => {
  function corpus(): { fix: string; scen: string } {
    const fix = mkTmp('ccrc-dlg-mx-');
    const scen = mkTmp('ccrc-dlg-sc-');
    for (const s of ['measured', 'failed', 'missing', 'probe']) fs.writeFileSync(path.join(scen, `${s}.json`), '{}');
    for (const v of ['2.1.9', '2.1.10']) {
      fs.mkdirSync(path.join(fix, v), { recursive: true });
      fs.writeFileSync(path.join(fix, v, 'measured.json'), JSON.stringify(fixture({
        version: v, scenario: 'measured', labels: ['b', 'a'],
        events: [
          ev(1, 'SessionStart', { session_id: 'S', source: 'startup' }),
          ev(2, 'PreToolUse', { session_id: 'S', tool_name: 'Agent', tool_input: { isolation: 'worktree' } }),
          ev(3, 'SubagentStart', { session_id: 'S', agent_id: 'x1', agent_type: 'general-purpose' }),
          ev(4, 'PreToolUse', { session_id: 'S', agent_id: 'x1', tool_name: 'Bash', tool_input: { command: 'echo DLG-ACK-1' }, cwd: '/rig/repo/.claude/worktrees/agent-x1' }),
          ev(5, 'SessionStart', { session_id: 'T', source: 'clear' }),
          // a subagent-side Bash event WITHOUT agent_id: found by its DLG-ACK- marker all the same
          ev(6, 'PostToolUse', { session_id: 'S', tool_name: 'Bash', tool_input: { command: 'echo DLG-ACK-1' }, cwd: '/rig/repo/.claude/worktrees/agent-x1' }),
          ev(7, 'SubagentStop', { session_id: 'S', agent_id: 'x1', agent_transcript_path: '/rig/home/agent-x1.jsonl' }),
        ],
        disk: {
          admin: {
            'agent-x1': { files: [], gitdir: '/rig/repo/.claude/worktrees/agent-x1/.git', head: 'h', claudeBase: 'a'.repeat(40), locked: false, firstLogSha: 'a'.repeat(40) },
            'raw-wt': { files: [], gitdir: '/rig/raw-wt/.git', head: 'h', claudeBase: null, locked: false, firstLogSha: 'c'.repeat(40) },
          },
          worktreesLeft: ['agent-x1'], branches: [], worktreeList: '',
          metas: { m: { spawnedWithWorktree: true, worktreePath: '/rig/repo/.claude/worktrees/agent-x1' } },
          snapshots: { 'before-kill': { adminRecords: ['agent-x1', 'raw-wt'], worktrees: ['agent-x1'] } },
        },
      })));
      fs.writeFileSync(path.join(fix, v, 'failed.json'), JSON.stringify(fixture({
        version: v, scenario: 'failed', notes: ['waitLabels ["x"]: timeout'], events: [ev(1, 'SessionStart', { session_id: 'S' })],
      })));
      fs.writeFileSync(path.join(fix, v, 'probe.json'), JSON.stringify(fixture({
        version: v, scenario: 'probe', notes: ['probe ["r1-resumed"]: not reached'], events: [ev(1, 'SessionStart', { session_id: 'S' })],
      })));
    }
    return { fix, scen };
  }

  it('a failed run is unmeasured with no question field; a measured zero is a zero; a missed probe is an outcome', () => {
    const { fix, scen } = corpus();
    const r = build([fix, scen]);
    expect(r.status, r.stderr).toBe(0);
    const m = JSON.parse(r.stdout);
    expect(m.cells['2.1.9/failed']).toEqual({ status: 'unmeasured', reason: 'waitLabels ["x"]: timeout', eventsSeen: { SessionStart: 1 } });
    expect(m.cells['2.1.9/missing']).toEqual({ status: 'unmeasured', reason: 'no fixture' });
    expect(m.cells['2.1.9/probe']).toMatchObject({ status: 'measured', probesMissed: ['r1-resumed'], subagentStarts: 0 });
  });

  it('derives the per-question fields from payloads and disk', () => {
    const { fix, scen } = corpus();
    const c = JSON.parse(build([fix, scen]).stdout).cells['2.1.10/measured'];
    expect(c).toMatchObject({
      labels: ['a', 'b'], agentTool: 'Agent', agentIsolationInInput: true, subagentStarts: 1, subagentTypes: ['general-purpose'],
      agentIdNamesWorktree: true, metaHasWorktreePath: 'all', recordsWithMeta: 'all', claudeBase: 'all', claudeBaseIsFirstLog: 'all',
      delegatedRecordsLeft: 1, otherRecordsLeft: 1, otherClaudeBase: 'none', worktreesLeft: 1,
      sessionEnd: { count: 0, reasons: [] }, sessionIds: 2, sessionStarts: [['startup', 's1'], ['clear', 's2']],
      subagentBash: { count: 2, withAgentId: 1, firstSessionId: 'all', cwdInWorktree: 'all' },
      snapshots: { 'before-kill': ['agent-x1'] },
      transcriptNamesAgent: 'all',
      events: {
        SubagentStop: { count: 1, withAgentId: 1, keys: ['agent_id', 'agent_transcript_path', 'session_id'] },
        PreToolUse: { count: 2, withAgentId: 1, keys: ['agent_id', 'cwd', 'session_id', 'tool_input', 'tool_name'] },
        SessionStart: { count: 2, withAgentId: 0, keys: ['session_id', 'source'] },
      },
    });
  });

  /** One version, one scenario: the fixture's file contents (an object is JSON-encoded, a string written raw). */
  function one(content: unknown): { cell: Record<string, any>; r: ReturnType<typeof build>; fix: string } {
    const fix = mkTmp('ccrc-dlg-mx1-');
    const scen = mkTmp('ccrc-dlg-sc1-');
    fs.writeFileSync(path.join(scen, 's.json'), '{}');
    fs.mkdirSync(path.join(fix, '2.1.1'), { recursive: true });
    fs.writeFileSync(path.join(fix, '2.1.1', 's.json'), typeof content === 'string' ? content : JSON.stringify(content));
    const r = build([fix, scen]);
    expect(r.status, r.stderr).toBe(0);
    return { cell: JSON.parse(r.stdout).cells['2.1.1/s'], r, fix };
  }
  const main = (seq: number, tool: string, input: Record<string, unknown> = {}) => ev(seq, 'PreToolUse', { session_id: 'S', tool_name: tool, tool_input: input });

  it('an event with an unparseable payload makes the cell unmeasured, never a measured zero', () => {
    const { cell } = one(fixture({ events: [ev(1, 'SessionStart', { session_id: 'S' }), { seq: 2, dtMs: 2, event: 'SubagentStart', envSid: 'u', payload: null }] }));
    expect(cell).toEqual({ status: 'unmeasured', reason: 'unparseable payload', eventsSeen: { SessionStart: 1, SubagentStart: 1 } });
  });

  it('a SubagentStop missing either field is counted against transcriptNamesAgent, not skipped', () => {
    const good = ev(1, 'SubagentStop', { session_id: 'S', agent_id: 'a', agent_transcript_path: '/rig/h/agent-a.jsonl' });
    const noId = ev(2, 'SubagentStop', { session_id: 'S', agent_transcript_path: '/rig/h/agent-a.jsonl' });
    const noPath = ev(3, 'SubagentStop', { session_id: 'S', agent_id: 'b' });
    expect(one(fixture({ events: [noId] })).cell.transcriptNamesAgent).toBe('none');
    expect(one(fixture({ events: [noPath] })).cell.transcriptNamesAgent).toBe('none');
    expect(one(fixture({ events: [good, noId] })).cell.transcriptNamesAgent).toBe('some');
    expect(one(fixture({ events: [good] })).cell.transcriptNamesAgent).toBe('all');
    expect(one(fixture({ events: [ev(1, 'SessionStart', { session_id: 'S' })] })).cell.transcriptNamesAgent).toBeNull();
  });

  it('a corrupt fixture is unreadable, not absent', () => {
    expect(one('{ not json').cell).toEqual({ status: 'unmeasured', reason: 'fixture unreadable' });
    expect(one('[]').cell).toEqual({ status: 'unmeasured', reason: 'fixture unreadable' });
    expect(one(fixture({ events: 'x' })).cell).toEqual({ status: 'unmeasured', reason: 'fixture unreadable' });
  });

  it('a non-version directory is skipped with one stderr line that does not name it', () => {
    const fix = mkTmp('ccrc-dlg-mx2-');
    const scen = mkTmp('ccrc-dlg-sc2-');
    fs.writeFileSync(path.join(scen, 's.json'), '{}');
    fs.mkdirSync(path.join(fix, '2.1.1'));
    fs.mkdirSync(path.join(fix, 'home-secret-dir'));
    fs.writeFileSync(path.join(fix, 'matrix.json'), '{}');
    const r = build([fix, scen]);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).versions).toEqual(['2.1.1']);
    expect(r.stderr.trim().split('\n')).toEqual(['build-matrix: skipped a non-version directory (#1)']);
    expect(r.stderr).not.toContain('secret');
  });

  it('a fixture that names another version or scenario than its path is misplaced', () => {
    expect(one(fixture({ version: '2.1.2', scenario: 's', events: [ev(1, 'SessionStart', { session_id: 'S' })] })).cell).toEqual({ status: 'unmeasured', reason: 'fixture misplaced' });
    expect(one(fixture({ version: '2.1.1', scenario: 'other', events: [ev(1, 'SessionStart', { session_id: 'S' })] })).cell).toEqual({ status: 'unmeasured', reason: 'fixture misplaced' });
    expect(one(fixture({ version: '2.1.1', scenario: 's', events: [ev(1, 'SessionStart', { session_id: 'S' })] })).cell.status).toBe('measured');
  });

  it('an empty fixture and a capture-cap fixture are unmeasured with no question field; one under the cap is measured', () => {
    expect(one(fixture({ notes: ['x'] })).cell).toEqual({ status: 'unmeasured', reason: 'x', eventsSeen: {} });
    expect(one(fixture({})).cell).toEqual({ status: 'unmeasured', reason: 'no events captured', eventsSeen: {} });
    const many = (n: number) => Array.from({ length: n }, (_, i) => ev(i + 1, 'SessionStart', { session_id: 'S' }));
    expect(one(fixture({ events: many(200) })).cell).toEqual({ status: 'unmeasured', reason: 'capture cap reached', eventsSeen: { SessionStart: 200 } });
    expect(one(fixture({ events: many(199) })).cell.status).toBe('measured');
  });

  it('agentTool is the MAIN loop\'s Agent call even when a subagent-side call comes first, and a Task call is Task', () => {
    const sub = ev(1, 'PreToolUse', { session_id: 'S', agent_id: 'x1', tool_name: 'Agent', tool_input: {} });
    expect(one(fixture({ events: [sub, main(2, 'Agent', { isolation: 'worktree' })] })).cell).toMatchObject({ agentTool: 'Agent', agentIsolationInInput: true });
    expect(one(fixture({ events: [main(1, 'Task')] })).cell).toMatchObject({ agentTool: 'Task', agentIsolationInInput: false });
    expect(one(fixture({ events: [sub] })).cell).toMatchObject({ agentTool: null, agentIsolationInInput: null });
  });

  it('sorts versions numerically and lists every scenario of the scenarios directory', () => {
    const { fix, scen } = corpus();
    const m = JSON.parse(build([fix, scen]).stdout);
    expect(m.versions).toEqual(['2.1.9', '2.1.10']);
    expect(m.scenarios).toEqual(['failed', 'measured', 'missing', 'probe']);
    expect(Object.keys(m.cells)).toHaveLength(8);
  });

  it('refuses bad arguments with exit 2', () => {
    expect(build([]).status).toBe(2);
    expect(build(['a', 'b', '--bogus']).status).toBe(2);
  });

  it('the committed matrix.json is exactly what the builder derives from the committed corpus', () => {
    const r = build([FIX, SCEN]);
    expect(r.status, r.stderr).toBe(0);
    expect(fs.readFileSync(path.join(FIX, 'matrix.json'), 'utf8')).toBe(r.stdout);
  });

  it('the committed corpus covers every scenario on at least one version, and carries no residue', () => {
    const m = JSON.parse(fs.readFileSync(path.join(FIX, 'matrix.json'), 'utf8'));
    expect(m.versions.length).toBeGreaterThan(0);
    for (const s of m.scenarios) {
      expect(m.versions.some((v: string) => m.cells[`${v}/${s}`].status === 'measured'), s).toBe(true);
    }
    for (const v of m.versions) for (const s of m.scenarios) {
      const f = path.join(FIX, v, `${s}.json`);
      if (!fs.existsSync(f)) continue;
      const text = fs.readFileSync(f, 'utf8');
      // `/rig/tmp/…` is the sanitised spelling of the run's TMPDIR (Claude Code's task output files), not residue: only
      // a `/tmp/` that is not under `/rig` is.
      expect(/(?<!\/rig)\/tmp\//.test(text), `${v}/${s}: /tmp/`).toBe(false);
      for (const bad of ['/home/', '/Users/', '/var/folders/', '/mnt/', 'ccrc-dlg-rig', 'sk-ant-']) expect(text.includes(bad), `${v}/${s}: ${bad}`).toBe(false);
    }
  });
});
