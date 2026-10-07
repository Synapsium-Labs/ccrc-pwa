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
// The rig is Linux-only: claude_pid and procs_under read /proc (and `find -printf`), so a row that needs a
// process found by its working directory is skipped elsewhere. On macOS the reap's ownerless arm fails closed.
const LINUX = process.platform === 'linux';
const TREE = path.resolve(__dirname, '../..');
const rigsh = (args: string[], env: NodeJS.ProcessEnv = {}, cwd?: string, timeoutMs = 120_000): { status: number | null; stdout: string; stderr: string } => {
  const r = spawnSync('bash', [RIGSH, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: timeoutMs, ...(cwd ? { cwd } : {}) });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};
/** The text of rig.sh's own top-level definitions named here, so a row can run them without the case dispatch at
 *  its foot: a function (a one-line body, or through its closing `}` line) or a `NAME=` assignment line. */
function rigText(...names: string[]): string {
  const lines = fs.readFileSync(RIGSH, 'utf8').split('\n');
  return names.map((n) => {
    const i = lines.findIndex((l) => l.startsWith(`${n}() {`) || l.startsWith(`${n}=`));
    expect(i, `rig.sh defines ${n}`).toBeGreaterThanOrEqual(0);
    const first = lines[i] as string;
    if (!first.startsWith(`${n}() {`) || first.trimEnd().endsWith('}')) return first;
    const j = lines.indexOf('}', i);
    expect(j, `${n} closes`).toBeGreaterThan(i);
    return lines.slice(i, j + 1).join('\n');
  }).join('\n');
}
/** A `bash -c` script that runs rig.sh's own cleanup_run, and what it calls, under the script's own strictness, with a
 *  run that has collected already (so no `collect`) and no socket, mock or run root unless `vars` sets one. */
function cleanupScript(vars: string): string {
  return [
    'set -euo pipefail', 'REAL_HOME=$HOME',
    rigText('SOCK_RE', 'SESSION', 'guard_root', 'guard_sock', 'die', 'T', 'procs_under', 'pid_tree', 'kill_if_under', 'pid_live', 'wait_run_quiet', 'cleanup_run'),
    'COLLECTED=1 OUT_DIR="" RUN_R="" SOCK="" MOCK_PID=""', vars, 'cleanup_run',
  ].join('\n');
}

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

  it('guard-root refuses a root under HOME by either spelling: HOME spelled through a symlink refuses the link spelling and the physical path alike (F10b)', () => {
    const real = fs.realpathSync(mkTmp('ccrc-dlg-home-'));
    const outside = fs.realpathSync(mkTmp('ccrc-dlg-out-'));
    const linkHome = path.join(outside, 'home-link');
    fs.symlinkSync(real, linkHome);                       // HOME is the link; the physical directory is `real`
    const guard = (root: string): number | null => rigsh(['guard-root', root], { HOME: linkHome }).status;
    expect(guard(`${linkHome}/ccrc-dlg-rig.x`), 'under HOME by its spelling (the physical HOME arm accepts it)').toBe(1);
    expect(guard(`${real}/ccrc-dlg-rig.x`), 'under HOME by its physical path (the spelling arm accepts it)').toBe(1);
    expect(guard(`${outside}/ccrc-dlg-rig.x`), 'outside both').toBe(0);
  }, 60_000);

  it('setup refuses a root by its SPELLING alone (relative, a `..` segment, a trailing slash) when its physical path is acceptable, and creates nothing there (F10a)', () => {
    const home = mkTmp('ccrc-dlg-home-');
    const base = fs.realpathSync(mkTmp('ccrc-dlg-base-'));
    fs.mkdirSync(path.join(base, 'sub'));
    const cases: Array<[string, string, string]> = [   // [what, the root as spelled, its directory]
      ['a relative root', 'ccrc-dlg-rig.rel', 'ccrc-dlg-rig.rel'],
      ['a `..` segment', `${base}/sub/../ccrc-dlg-rig.dots`, 'ccrc-dlg-rig.dots'],
      ['a trailing slash', `${base}/ccrc-dlg-rig.slash/`, 'ccrc-dlg-rig.slash'],
    ];
    for (const [what, spelled, dir] of cases) {
      fs.mkdirSync(path.join(base, dir));
      // The premise: the physical path passes the guard, so only the spelling guard in cmd_setup can refuse it.
      expect(rigsh(['guard-root', path.join(base, dir)], { HOME: home }).status, `${what}: the physical path is acceptable`).toBe(0);
      const r = rigsh(['setup', spelled], { HOME: home }, base);
      expect.soft(r.status, `${what}: ${r.stderr}`).toBe(2);   // soft: each spelling is measured on its own
      expect.soft(r.stderr, what).toContain('it must be absolute, canonical');
      expect.soft(fs.readdirSync(path.join(base, dir)), `${what}: nothing created under it`).toEqual([]);
    }
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

  it.skipIf(!LINUX)('claude_pid finds the Claude Code process when HOME is spelled through a symlink: /proc/<pid>/exe is physical, so $VERSIONS is compared resolved, and only that one (F10)', async () => {
    const real = fs.realpathSync(mkTmp('ccrc-dlg-home-'));
    const outside = fs.realpathSync(mkTmp('ccrc-dlg-out-'));
    const linkHome = path.join(outside, 'home-link');
    fs.symlinkSync(real, linkHome);                       // HOME is the link; the physical directory is `real`
    // `<v>` is a COPY of a real ELF binary (a stand-in for the Claude Code binary) started from its SYMLINKED spelling, so the kernel
    // reports /proc/<pid>/exe as the physical path. A copy of the same binary outside the versions directory is the foreign process.
    const sleepBin = fs.realpathSync(spawnSync('sh', ['-c', 'command -v sleep'], { encoding: 'utf8' }).stdout.trim());
    const versions = path.join(real, '.local/share/claude/versions');
    fs.mkdirSync(versions, { recursive: true });
    const copy = (to: string): void => { fs.copyFileSync(sleepBin, to); fs.chmodSync(to, 0o755); };
    copy(path.join(versions, '2.1.0'));
    copy(path.join(outside, 'not-claude'));
    const start = (bin: string): number => { const c = spawn(bin, ['60'], { argv0: 'sleep', stdio: 'ignore' }); children.push(c); return c.pid!; };
    const claude = start(path.join(linkHome, '.local/share/claude/versions/2.1.0'));
    const foreign = start(path.join(outside, 'not-claude'));
    await new Promise((r) => setTimeout(r, 200));
    expect(fs.readlinkSync(`/proc/${claude}/exe`), 'the premise: the kernel names the physical path').toBe(path.join(versions, '2.1.0'));
    // rig.sh's own claude_pid, VERSIONS spelled by rig.sh's own line from this HOME; tmux answers `0 <pid>` (a live pane, this pid).
    const script = ['set -euo pipefail', rigText('REAL_HOME', 'VERSIONS', 'SESSION', 'claude_pid'), 'SOCK=dlgx', 'T() { printf \'0 %s\\n\' "$PANE_PID"; }', 'claude_pid'].join('\n');
    const find = (home: string, pid: number): { status: number | null; stdout: string } => {
      const r = spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { ...process.env, HOME: home, PANE_PID: String(pid) }, timeout: 60_000 });
      return { status: r.status, stdout: r.stdout };
    };
    expect(find(real, claude), 'a HOME spelled physically (the control: this always worked)').toEqual({ status: 0, stdout: String(claude) });
    expect(find(linkHome, claude), 'a HOME spelled through a symlink').toEqual({ status: 0, stdout: String(claude) });
    // Fail closed, exactly as before: a process outside the versions directory is not the binary, and a $VERSIONS that cannot be resolved
    // (no such directory) falls back to its spelling, which no /proc/<pid>/exe can match: never every absolute path.
    expect(find(linkHome, foreign), 'a binary outside the versions directory').toEqual({ status: 1, stdout: '' });
    expect(find(mkTmp('ccrc-dlg-home-'), claude), 'a HOME with no versions directory').toEqual({ status: 1, stdout: '' });
  }, 60_000);

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

/** A fixture HOME whose Claude Code versions directory holds `entries`: [name, mode] pairs, each a one-line shell script (a
 *  stand-in no row runs: a row that could reach a binary is one that refuses first). A name may climb out of the directory
 *  (`../x`), which is where a version spelled that way would land. */
function versionsHome(entries: Array<[string, number]>): string {
  const home = mkTmp('ccrc-dlg-home-');
  const dir = path.join(home, '.local/share/claude/versions');
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, mode] of entries) {
    const f = path.join(dir, name);
    fs.writeFileSync(f, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(f, mode);
  }
  return home;
}
/** The same HOME's entries, as most rows below need them: three installed (out of numeric order), one not executable,
 *  and three executables that are not versions (a word, two numbers, trailing text). */
const MIXED: Array<[string, number]> = [['2.1.290', 0o755], ['2.1.9', 0o755], ['10.0.0', 0o755], ['2.1.997', 0o644], ['current', 0o755], ['2.1', 0o755], ['2.1.9x', 0o755]];

describe('rig.sh run and all take only a version that is installed (review 304 F7)', () => {
  const SCENARIO = path.join(RIG, 'scenarios', 'agent-plain.json');
  /** Fresh private directories for what a run would make, so "made nothing" is a directory that stayed empty. */
  const sandbox = () => ({ tmp: mkTmp('ccrc-dlg-tmp-'), tmux: mkTmp('ccrc-dlg-tmux-'), out: path.join(mkTmp('ccrc-dlg-out-'), 'out') });
  const REFUSED: Array<[string, string]> = [   // [what, the version as spelled]; each executable-looking spelling HAS an executable entry
    ['a version with no entry in the versions directory', '2.1.998'],
    ['a version whose entry is not executable', '2.1.997'],
    ['a version spelled with two numbers (an executable entry of that name exists)', '2.1'],
    ['a version that climbs out of the versions directory (an executable file is there)', '../x'],
    ['a version with a leading letter (an executable entry of that name exists)', 'v2.1.9'],
    ['a version with trailing text (an executable entry of that name exists)', '2.1.9x'],
  ];
  for (const [what, ver] of REFUSED) {
    it(`run refuses ${what}, exit 2, before it makes anything: no run root, no tmux directory, no out-dir (F7)`, () => {
      const home = versionsHome([...MIXED, ['../x', 0o755], ['v2.1.9', 0o755]]);
      const { tmp, tmux, out } = sandbox();
      const r = rigsh(['run', ver, SCENARIO, out], { HOME: home, TMPDIR: tmp, TMUX_TMPDIR: tmux }, undefined, 20_000);
      expect.soft(r.status, r.stderr).toBe(2);
      expect.soft(r.stderr).toContain(`'${ver}' is not an installed Claude Code version`);
      expect.soft(fs.readdirSync(tmp), 'no run root').toEqual([]);
      expect.soft(fs.readdirSync(tmux), 'no tmux socket directory').toEqual([]);
      expect.soft(fs.existsSync(out), 'no out-dir').toBe(false);
    }, 60_000);
  }

  it('run asks about the binary first and the scenario second, and an installed version passes the first (F7)', () => {
    const home = versionsHome(MIXED);
    const bad = path.join(mkTmp('ccrc-dlg-sc-'), 'bad.json');
    fs.writeFileSync(bad, '{}');
    const { tmp, tmux, out } = sandbox();
    const env = { HOME: home, TMPDIR: tmp, TMUX_TMPDIR: tmux };
    const installed = rigsh(['run', '2.1.290', bad, out], env, undefined, 20_000);
    expect.soft(installed.status, installed.stderr).toBe(2);
    expect.soft(installed.stderr, 'an installed version reaches the scenario check').toContain('is malformed');
    const missing = rigsh(['run', '2.1.998', bad, out], env, undefined, 20_000);
    expect.soft(missing.status, missing.stderr).toBe(2);
    expect.soft(missing.stderr).toContain("'2.1.998' is not an installed Claude Code version");
    expect.soft(missing.stderr, 'the binary is asked about before the scenario').not.toContain('is malformed');
  }, 60_000);

  const BAD_ALL: Array<[string, string[], string]> = [   // [what, the versions named, the one the refusal must name]
    ['an uninstalled version', ['2.1.998'], '2.1.998'],
    ['a version whose entry is not executable', ['2.1.997'], '2.1.997'],
    ['a malformed version (an executable entry of that name exists)', ['2.1.9x'], '2.1.9x'],
    ['an installed version beside bad ones: the FIRST bad one is named', ['2.1.290', '2.1.998', '2.1.9x'], '2.1.998'],
  ];
  for (const [what, named, first] of BAD_ALL) {
    it(`all refuses ${what}, exit 2, naming it, and makes nothing: no raw root, no run root`, () => {
      const home = versionsHome(MIXED);
      const { tmp, tmux } = sandbox();
      const raw = path.join(mkTmp('ccrc-dlg-rawdir-'), 'raw');
      const r = rigsh(['all', raw, ...named], { HOME: home, TMPDIR: tmp, TMUX_TMPDIR: tmux }, undefined, 20_000);
      expect.soft(r.status, r.stderr).toBe(2);
      expect.soft(r.stderr).toContain(`'${first}' is not an installed Claude Code version`);
      expect.soft(fs.existsSync(raw), 'no raw root, and so no .done').toBe(false);
      expect.soft(fs.readdirSync(tmp), 'no run root').toEqual([]);
    }, 60_000);
  }

  it('all checks the versions it is given before it reaps or removes anything: a dead run root and a leftover .done stay (F7)', () => {
    const home = versionsHome(MIXED);
    const { tmp, tmux } = sandbox();
    const dead = fs.mkdtempSync(path.join(tmp, 'ccrc-dlg-rig.'));
    fs.writeFileSync(path.join(dead, '.owner'), `${spawnSync('true').pid}\n`);   // a finished child's pid: reap would remove it
    const raw = mkTmp('ccrc-dlg-raw-');
    fs.writeFileSync(path.join(raw, '.done'), 'earlier\n');
    const r = rigsh(['all', raw, '2.1.998'], { HOME: home, TMPDIR: tmp, TMUX_TMPDIR: tmux }, undefined, 20_000);
    expect.soft(r.status, r.stderr).toBe(2);
    expect.soft(fs.existsSync(dead), 'reap did not run').toBe(true);
    expect.soft(fs.readFileSync(path.join(raw, '.done'), 'utf8'), 'the earlier .done was not removed').toBe('earlier\n');
  }, 60_000);

  describe('which versions all runs (rig.sh\'s own cmd_all and what it calls, over a stub for `run` and for reap)', () => {
    const sq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
    /** Runs cmd_all with `$0` a stub that logs `run <version> <scenario file> <out-dir under the raw root>` and fails for STUB_FAIL;
     *  HERE a scratch tree with two scenarios. Returns the log, the raw root's entries and its .done. */
    function runAll(home: string, args: string[], failFor = ''): { status: number | null; stderr: string; log: string[]; done: string | null } {
      const dir = mkTmp('ccrc-dlg-all-');
      fs.mkdirSync(path.join(dir, 'scenarios'));
      for (const n of ['a', 'b']) fs.writeFileSync(path.join(dir, 'scenarios', `${n}.json`), '{}');
      const stub = path.join(dir, 'stub.sh');
      fs.writeFileSync(stub, '#!/usr/bin/env bash\nprintf \'%s %s %s %s\\n\' "$1" "$2" "$(basename "$3")" "${4#"$RAW"/}" >> "$LOG"\n[[ $2 != "${STUB_FAIL-}" ]]\n');
      const raw = path.join(dir, 'raw');
      const log = path.join(dir, 'log');
      const script = ['set -euo pipefail', rigText('REAL_HOME', 'VERSIONS', 'VERSION_RE'), `HERE=${sq(dir)}`, `TREE=${sq(path.join(dir, 'tree'))}`,
        'cmd_reap() { printf "reap\\n" >> "$LOG"; }', rigText('die', 'guard_out', 'version_ok', 'need_version', 'VERS', 'pick_versions', 'cmd_all'), 'cmd_all "$@"'].join('\n');
      const r = spawnSync('bash', ['-c', script, stub, raw, ...args], { encoding: 'utf8', env: { ...process.env, HOME: home, LOG: log, RAW: raw, STUB_FAIL: failFor }, timeout: 60_000 });
      const lines = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
      const doneFile = path.join(raw, '.done');
      return { status: r.status, stderr: r.stderr, log: lines, done: fs.existsSync(doneFile) ? fs.readFileSync(doneFile, 'utf8') : null };
    }
    const sweep = (versions: string[]): string[] => ['reap', ...versions.flatMap((v) => ['a', 'b'].map((s) => `run ${v} ${s}.json ${v}/${s}`))];

    it('with no version named, runs every installed, version-shaped, executable entry, in numeric order, each against every scenario, then writes .done', () => {
      const r = runAll(versionsHome(MIXED), []);
      expect(r.status, r.stderr).toBe(0);
      expect(r.log).toEqual(sweep(['2.1.9', '2.1.290', '10.0.0']));
      expect(r.done).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ\n$/);
    }, 60_000);

    it('with versions named, runs only those, in numeric order and once each, then writes .done', () => {
      const r = runAll(versionsHome(MIXED), ['10.0.0', '2.1.9', '10.0.0']);
      expect(r.status, r.stderr).toBe(0);
      expect(r.log).toEqual(sweep(['2.1.9', '10.0.0']));
      expect(r.done).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ\n$/);
    }, 60_000);

    it('a failed run is reported with its rc and does not stop the sweep, and .done is still written', () => {
      const r = runAll(versionsHome(MIXED), ['2.1.9', '10.0.0'], '2.1.9');
      expect(r.status, r.stderr).toBe(0);
      expect(r.log).toEqual(sweep(['2.1.9', '10.0.0']));
      expect(r.stderr).toContain('rig: run 2.1.9 a.json failed rc=1');
      expect(r.stderr).toContain('rig: run 2.1.9 b.json failed rc=1');
      expect(r.stderr).not.toContain('rig: run 10.0.0');
      expect(r.done).not.toBeNull();
    }, 60_000);

    it('refuses a bad version before it reaps or runs anything, and writes no .done', () => {
      const r = runAll(versionsHome(MIXED), ['2.1.9', '2.1.998']);
      expect(r.status, r.stderr).toBe(2);
      expect(r.log).toEqual([]);
      expect(r.done).toBeNull();
    }, 60_000);
  });

  it('an unknown verb prints the header as the usage, exit 2, every verb named down to the last line and not the code after it', () => {
    const r = rigsh(['bogus'], {}, undefined, 20_000);
    expect.soft(r.status).toBe(2);
    for (const line of ['rig.sh all <raw-root> [<version>...]', 'rig.sh versions [<version>...]', 'rig.sh reap', '(and a box with no /proc, where that cannot be measured, keeps them)']) expect.soft(r.stderr, line).toContain(line);
    expect.soft(r.stderr).not.toContain('set -euo pipefail');
  }, 60_000);

  describe('rig.sh versions (the one reader of "installed": all and recapture.sh both ask it)', () => {
    const ask = (home: string, ...named: string[]) => rigsh(['versions', ...named], { HOME: home }, undefined, 20_000);
    it('lists every installed, version-shaped, executable entry, one per line, numerically (a word, a non-executable file and a malformed name left out)', () => {
      const r = ask(versionsHome(MIXED));
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toBe('2.1.9\n2.1.290\n10.0.0\n');
    }, 60_000);

    it('given versions, lists exactly those: numerically, each once', () => {
      const r = ask(versionsHome(MIXED), '10.0.0', '2.1.9', '10.0.0');
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toBe('2.1.9\n10.0.0\n');
    }, 60_000);

    it('refuses the first bad version it is given, exit 2, and lists nothing', () => {
      const r = ask(versionsHome(MIXED), '2.1.9', '2.1.997', '2.1.9x');
      expect.soft(r.status, r.stderr).toBe(2);
      expect.soft(r.stderr).toContain("'2.1.997' is not an installed Claude Code version");
      expect.soft(r.stdout).toBe('');
    }, 60_000);

    it('lists nothing, and succeeds, for an empty versions directory and for a HOME with none', () => {
      expect.soft(ask(versionsHome([])).status).toBe(0);
      expect.soft(ask(versionsHome([])).stdout).toBe('');
      const bare = ask(mkTmp('ccrc-dlg-home-'));
      expect.soft(bare.status, bare.stderr).toBe(0);
      expect.soft(bare.stdout).toBe('');
      expect.soft(bare.stderr, 'a missing versions directory is "none installed", not an error to print').toBe('');
    }, 60_000);
  });
});

const RECAPTURE = path.join(RIG, 'recapture.sh');

/** A scratch copy of the tree recapture.sh finds from its own location: the script itself; a rig.sh that answers `versions`
 *  with the REAL rig.sh (so "installed" is the rig's own answer) and logs `all` instead of running it; a sanitiser and a matrix
 *  builder that log their argv; a corpus of empty version directories. Whatever a row runs for real, it writes only under `dir`. */
function recaptureTree(corpus: string[] = ['2.1.290', '2.1.291']): { dir: string; rig: string; fix: string; scen: string; script: string; log: string } {
  const dir = mkTmp('ccrc-dlg-rc-');
  const rig = path.join(dir, 'server/test/delegation-rig');
  const fix = path.join(dir, 'server/test/fixtures/delegation');
  const scen = path.join(rig, 'scenarios');
  fs.mkdirSync(scen, { recursive: true });
  for (const v of corpus) fs.mkdirSync(path.join(fix, v), { recursive: true });
  fs.copyFileSync(RECAPTURE, path.join(rig, 'recapture.sh'));
  const put = (name: string, text: string): void => { fs.writeFileSync(path.join(rig, name), text); fs.chmodSync(path.join(rig, name), 0o755); };
  put('rig.sh', [
    '#!/usr/bin/env bash',
    'case ${1-} in',
    '  versions) shift; exec bash "$REAL_RIG" versions "$@" ;;',
    '  all)      shift; raw=$1; shift; printf "all %s\\n" "$raw $*" >> "$LOG"',
    '            echo "stdout line from all"; echo "stderr line from all" >&2',
    '            [[ ${STUB_ALL_RC:-0} == 0 ]] || exit "$STUB_ALL_RC"',
    '            [[ -z ${STAGED-} ]] || cp -R "$STAGED/." "$raw/"',
    '            [[ -n ${STUB_NO_DONE-} ]] || echo 2026-01-01T00:00:00Z > "$raw/.done" ;;',
    'esac', '',
  ].join('\n'));
  const logger = (tag: string, rcVar: string, scanVar = ''): string => [
    "import fs from 'node:fs';", 'const a = process.argv.slice(2);',
    `fs.appendFileSync(process.env.LOG, \`${tag} \${a.join(' ')}\\n\`);`,
    `process.exit(Number((${scanVar ? `a[0] === '--scan' ? process.env.${scanVar} : ` : ''}process.env.${rcVar}) || 0));`, '',
  ].join('\n');
  put('sanitize.mjs', logger('sanitize', 'STUB_SANITIZE_RC', 'STUB_SCAN_RC'));
  put('build-matrix.mjs', logger('matrix', 'STUB_MATRIX_RC'));
  return { dir, rig, fix, scen, script: path.join(rig, 'recapture.sh'), log: path.join(dir, 'log') };
}
type Tree = ReturnType<typeof recaptureTree>;

/** Every path under `dir` (files and directories), sorted: what a run left behind. */
function treeListing(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); out.push(f); if (e.isDirectory()) walk(f); } };
  walk(dir);
  return out.sort();
}

describe('recapture.sh (review 304 F12: the corpus\'s one re-capture script)', () => {
  /** HOME, TMPDIR and the stubs' log for one run of the tree's script. */
  const ctx = (t: Tree, entries: Array<[string, number]>) => ({ home: versionsHome(entries), tmp: mkTmp('ccrc-dlg-tmp-'), t });
  const recapture = (c: ReturnType<typeof ctx>, args: string[], env: NodeJS.ProcessEnv = {}, cwd?: string) => {
    const r = spawnSync('bash', [c.t.script, ...args], { encoding: 'utf8', timeout: 60_000, ...(cwd ? { cwd } : {}),
      env: { ...process.env, HOME: c.home, TMPDIR: c.tmp, LOG: c.t.log, REAL_RIG: RIGSH, ...env } });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  const stepLines = (stdout: string): string[] => stdout.split('\n').filter((l) => /^ {2}\d+\. /.test(l));
  const logLines = (t: Tree): string[] => (fs.existsSync(t.log) ? fs.readFileSync(t.log, 'utf8').split('\n').filter(Boolean) : []);
  /** The five steps as the script prints them for `vs`, `<raw>` standing for the raw root. */
  const FIVE = (t: Tree, vs: string[]): string[] => [
    `  1. RAW=$(mktemp -d "\${TMPDIR:-/tmp}/ccrc-dlg-raw.XXXXXX") && { printf "# started %s\\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"; printf "%s\\n" ${vs.join(' ')}; } > <raw>/versions-at-start`,
    `  2. bash ${t.rig}/rig.sh all <raw> ${vs.join(' ')} 2>&1 | tee <raw>/all.log && [[ -e <raw>/.done ]]`,
    `  3. node ${t.rig}/sanitize.mjs <raw> ${t.fix}`,
    `  4. node ${t.rig}/build-matrix.mjs ${t.fix} ${t.scen} --write`,
    `  5. node ${t.rig}/sanitize.mjs --scan ${t.fix}`,
  ];
  // 2.1.290 and 2.1.291 are in the tree's corpus; 2.1.999 and the rest are not. 2.1.998 is not executable; the last two are no versions.
  const ENTRIES: Array<[string, number]> = [['2.1.290', 0o755], ['2.1.999', 0o755], ['2.1.9', 0o755], ['10.0.0', 0o755], ['2.1.998', 0o644], ['current', 0o755], ['2.1.9x', 0o755]];
  const FEW: Array<[string, number]> = [['2.1.290', 0o755], ['2.1.999', 0o755], ['2.1.998', 0o644], ['current', 0o755]];

  it('is an executable bash script, and names the committed corpus and the rig\'s scenarios directory as its own', () => {
    const text = fs.readFileSync(RECAPTURE, 'utf8');
    expect(text.startsWith('#!/usr/bin/env bash\n')).toBe(true);
    expect(text).toContain('\nset -euo pipefail\n');
    expect(fs.statSync(RECAPTURE).mode & 0o111, 'executable by someone').not.toBe(0);
    expect(text).toContain('\nFIX=$TREE/server/test/fixtures/delegation\n');
    expect(text).toContain('\nSCEN=$HERE/scenarios\n');
    expect(fs.existsSync(path.join(TREE, 'server/test/fixtures/delegation/matrix.json')), 'the corpus is where the script says').toBe(true);
    expect(fs.existsSync(path.join(RIG, 'scenarios')), 'the scenarios are where the script says').toBe(true);
  });

  it('--dry-run, no version named: every installed, version-shaped, executable entry in numeric order, then the five steps in order, each naming the directories it acts on', () => {
    const t = recaptureTree();
    const r = recapture(ctx(t, ENTRIES), ['--dry-run']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr, 'a clean run says nothing on stderr').toBe('');
    const out = r.stdout.split('\n');
    expect(out.slice(0, 4)).toEqual([
      'recapture: dry run: nothing is made and nothing is run',
      'recapture: 4 version(s), as installed now: 2.1.9 2.1.290 2.1.999 10.0.0',
      `recapture: fixtures dir:  ${t.fix}`,
      `recapture: scenarios dir: ${t.scen}`,
    ]);
    expect(stepLines(r.stdout)).toEqual(FIVE(t, ['2.1.9', '2.1.290', '2.1.999', '10.0.0']));
    expect(out.slice(-3)).toEqual([
      'recapture: raw root: <raw>',
      'recapture: it holds UNSANITISED bundles: never commit it, never copy it off the box, remove it by hand once nothing needs it: rm -rf <raw>',
      '',
    ]);
  }, 60_000);

  it('--dry-run --missing selects the installed versions the corpus has no directory for: 2.1.999, and not 2.1.290', () => {
    const t = recaptureTree();
    const r = recapture(ctx(t, FEW), ['--dry-run', '--missing']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('recapture: 1 version(s), as installed now: 2.1.999\n');
    expect(stepLines(r.stdout)).toEqual(FIVE(t, ['2.1.999']));
    expect(r.stdout, 'a version the corpus holds is not named anywhere').not.toContain('2.1.290');
  }, 60_000);

  it('--missing with every installed version already in the corpus says so, exits 0 and makes nothing, dry run or not', () => {
    const t = recaptureTree();
    const before = treeListing(t.dir);
    for (const args of [['--dry-run', '--missing'], ['--missing']]) {
      const c = ctx(t, [['2.1.290', 0o755], ['2.1.291', 0o755]]);
      const r = recapture(c, args);
      expect.soft(r.status, `${args.join(' ')}: ${r.stderr}`).toBe(0);
      expect.soft(r.stdout, args.join(' ')).toBe('recapture: the corpus already covers every installed version (2.1.290 2.1.291); nothing to capture\n');
      expect.soft(fs.readdirSync(c.tmp), `${args.join(' ')}: no raw root`).toEqual([]);
      expect.soft(logLines(t), `${args.join(' ')}: nothing ran`).toEqual([]);
      expect.soft(treeListing(t.dir), `${args.join(' ')}: the tree is as it was`).toEqual(before);
    }
  }, 60_000);

  it('--dry-run with versions named selects exactly those: a named version already in the corpus too, in numeric order, each once', () => {
    const t = recaptureTree();
    const one = recapture(ctx(t, ENTRIES), ['--dry-run', '2.1.999']);
    expect.soft(one.status, one.stderr).toBe(0);
    expect.soft(one.stdout).toContain('recapture: 1 version(s), as installed now: 2.1.999\n');
    expect.soft(stepLines(one.stdout)).toEqual(FIVE(t, ['2.1.999']));
    const many = recapture(ctx(t, ENTRIES), ['--dry-run', '2.1.999', '2.1.290', '2.1.999']);
    expect.soft(many.status, many.stderr).toBe(0);
    expect.soft(stepLines(many.stdout)).toEqual(FIVE(t, ['2.1.290', '2.1.999']));
  }, 60_000);

  const REFUSED: Array<[string, string[], string]> = [   // [what, the arguments, the text the refusal must carry]
    ['a version that is not installed', ['2.1.5'], "'2.1.5' is not an installed Claude Code version"],
    ['a version whose entry is not executable', ['2.1.998'], "'2.1.998' is not an installed Claude Code version"],
    ['a malformed version (an executable entry of that name exists)', ['2.1.9x'], "'2.1.9x' is not an installed Claude Code version"],
    ['the first bad version among good ones', ['2.1.999', '2.1.5', '2.1.998'], "'2.1.5' is not an installed Claude Code version"],
    ['--missing together with a version', ['--missing', '2.1.999'], '--missing and named versions do not mix'],
    ['an option it does not know', ['--bogus'], "unknown option '--bogus'"],
  ];
  for (const [what, args, text] of REFUSED) {
    for (const dry of [true, false]) {
      it(`${dry ? '--dry-run ' : ''}${args.join(' ')} (${what}): exit 2, the refusal named, and nothing made or run`, () => {
        const t = recaptureTree();
        const c = ctx(t, ENTRIES);
        const before = treeListing(t.dir);
        const r = recapture(c, [...(dry ? ['--dry-run'] : []), ...args]);
        expect.soft(r.status, r.stderr).toBe(2);
        expect.soft(r.stderr).toContain(text);
        expect.soft(r.stderr, 'rig.sh\'s refusal stops this script; it is not read as "nothing installed"').not.toContain('no Claude Code version is installed');
        expect.soft(r.stdout).toBe('');
        expect.soft(fs.readdirSync(c.tmp), 'no raw root').toEqual([]);
        expect.soft(logLines(t), 'nothing ran').toEqual([]);
        expect.soft(treeListing(t.dir), 'the tree is as it was').toEqual(before);
      }, 60_000);
    }
  }

  it('with no Claude Code version installed it refuses, exit 2, and makes nothing', () => {
    const t = recaptureTree();
    const c = ctx(t, [['2.1.998', 0o644], ['current', 0o755]]);
    const r = recapture(c, []);
    expect.soft(r.status, r.stderr).toBe(2);
    expect.soft(r.stderr).toContain('no Claude Code version is installed to capture');
    expect.soft(fs.readdirSync(c.tmp)).toEqual([]);
    expect.soft(logLines(t)).toEqual([]);
  }, 60_000);

  it('--dry-run makes nothing and runs nothing: TMPDIR stays empty, the tree is unchanged, no step ran', () => {
    const t = recaptureTree();
    const c = ctx(t, ENTRIES);
    const before = treeListing(t.dir);
    const r = recapture(c, ['--dry-run']);
    expect.soft(r.status, r.stderr).toBe(0);
    expect.soft(fs.readdirSync(c.tmp), 'no raw root').toEqual([]);
    expect.soft(treeListing(t.dir), 'the tree is as it was').toEqual(before);
    expect.soft(logLines(t), 'no step ran').toEqual([]);
  }, 60_000);

  it('a real run makes the raw root, runs the five steps in the printed order on it, never deletes it, and ends by naming it', () => {
    const t = recaptureTree();
    const c = ctx(t, ENTRIES);
    const dry = recapture(c, ['--dry-run', '2.1.999', '2.1.9']);
    const r = recapture(c, ['2.1.999', '2.1.9']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr, 'a clean run says nothing on stderr').toBe('');
    const made = fs.readdirSync(c.tmp);
    expect(made, 'exactly one raw root, nothing else in TMPDIR').toHaveLength(1);
    const raw = path.join(c.tmp, made[0] as string);
    expect(path.basename(raw)).toMatch(/^ccrc-dlg-raw\.[A-Za-z0-9]{6}$/);
    expect(fs.statSync(raw).mode & 0o777, 'mktemp -d: 0700').toBe(0o700);
    // the steps ran on that root, with the versions it recorded, in order, each with its directories
    expect(logLines(t).map((l) => l.split(raw).join('<raw>'))).toEqual([
      'all <raw> 2.1.9 2.1.999',
      `sanitize <raw> ${t.fix}`,
      `matrix ${t.fix} ${t.scen} --write`,
      `sanitize --scan ${t.fix}`,
    ]);
    // the very list a dry run prints is the list that ran, and the root's path is told as soon as it exists
    expect(stepLines(r.stdout)).toEqual(stepLines(dry.stdout));
    const out = r.stdout.split('\n');
    expect(out.indexOf(`recapture: raw root: ${raw}`), 'told right after step 1, before step 2').toBe(out.findIndex((l) => l.startsWith('  1. ')) + 1);
    expect(out.slice(-3)).toEqual([
      `recapture: raw root: ${raw}`,
      `recapture: it holds UNSANITISED bundles: never commit it, never copy it off the box, remove it by hand once nothing needs it: rm -rf ${raw}`,
      '',
    ]);
    // the raw root's own record: the start time, then the versions, one per line; and the capture's output, both streams
    expect(fs.readFileSync(path.join(raw, 'versions-at-start'), 'utf8')).toMatch(/^# started \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ\n2\.1\.9\n2\.1\.999\n$/);
    expect(fs.readFileSync(path.join(raw, 'all.log'), 'utf8')).toBe('stdout line from all\nstderr line from all\n');
    expect(r.stdout, 'the capture\'s output reaches the operator too').toContain('stdout line from all\n');
    expect(fs.existsSync(path.join(raw, '.done')), 'the raw root and what it holds are still there').toBe(true);
  }, 60_000);

  const kinds = (t: Tree): string[] => logLines(t).map((l) => (l.startsWith('sanitize --scan') ? 'scan' : (l.split(' ')[0] as string)));
  const FAILS: Array<[string, NodeJS.ProcessEnv, number, string[], string]> = [   // [what, env, the script's exit, the steps that ran, the failure it reports]
    ['rig.sh all failing with its own status', { STUB_ALL_RC: '2' }, 2, ['all'], 'step 2 failed (exit 2): capture every version against every scenario (rig.sh all; its .done must exist)'],
    ['rig.sh all finishing without its .done', { STUB_NO_DONE: '1' }, 1, ['all'], 'step 2 failed (exit 1): capture every version against every scenario (rig.sh all; its .done must exist)'],
    ['the sanitiser refusing (it fails closed), whatever its status', { STUB_SANITIZE_RC: '3' }, 3, ['all', 'sanitize'], 'step 3 failed (exit 3): sanitise the raw bundles into the corpus (fails closed on any residue)'],
    ['the matrix builder failing', { STUB_MATRIX_RC: '4' }, 4, ['all', 'sanitize', 'matrix'], 'step 4 failed (exit 4): rebuild matrix.json from the corpus'],
    ['the corpus scan finding residue', { STUB_SCAN_RC: '5' }, 5, ['all', 'sanitize', 'matrix', 'scan'], 'step 5 failed (exit 5): scan the committed corpus for residue'],
  ];
  for (const [what, env, code, ran, failed] of FAILS) {
    it(`stops at ${what}: exit ${code}, the later steps not run, the raw root kept and named`, () => {
      const t = recaptureTree();
      const c = ctx(t, ENTRIES);
      const r = recapture(c, ['2.1.999'], env);
      expect.soft(r.status, r.stderr).toBe(code);
      expect.soft(kinds(t), 'the steps that ran').toEqual(ran);
      const made = fs.readdirSync(c.tmp);
      expect.soft(made, 'the raw root is kept').toHaveLength(1);
      const raw = path.join(c.tmp, made[0] as string);
      expect.soft(r.stderr).toContain(failed);
      expect.soft(r.stderr).toContain(`recapture: the raw root ${raw} is kept; it holds UNSANITISED bundles`);
    }, 60_000);
  }

  it('a failure before the raw root exists (no usable TMPDIR) stops at step 1 and names no root', () => {
    const t = recaptureTree();
    const c = ctx(t, ENTRIES);
    const r = recapture(c, ['2.1.999'], { TMPDIR: path.join(c.tmp, 'no-such-dir') });
    expect.soft(r.status, r.stderr).not.toBe(0);
    expect.soft(r.stderr).toContain(`step 1 failed (exit ${r.status}): make the raw root and record the versions and the start time`);
    expect.soft(r.stderr).not.toContain('is kept');
    expect.soft(logLines(t), 'nothing ran').toEqual([]);
  }, 60_000);

  it('end to end over the REAL sanitiser and matrix builder: the capture\'s bundle becomes a fixture, matrix.json is rebuilt to hold it, and the corpus scan passes', () => {
    const t = recaptureTree([]);
    for (const n of ['sanitize.mjs', 'build-matrix.mjs']) fs.copyFileSync(path.join(RIG, n), path.join(t.rig, n));   // the real ones over the logging stubs
    fs.cpSync(path.join(RIG, 'scenarios'), t.scen, { recursive: true });
    const ROOT = '/tmp/ccrc-dlg-rig.Zz99Yy';
    const staged = mkTmp('ccrc-dlg-stage-');   // what rig.sh all would have left in the raw root: one bundle, the run root spelled in it
    rawBundle(staged, ROOT, '2.1.999', 'agent-plain', [
      ['SessionStart', 10, { hook_event_name: 'SessionStart', session_id: 's', cwd: `${ROOT}/repo`, transcript_path: `${ROOT}/fixhome/cfg/projects/${ROOT.replace(/[^A-Za-z0-9]/g, '-')}-repo/s.jsonl` }],
      ['Stop', 20, { hook_event_name: 'Stop', session_id: 's' }],
    ]);
    const c = ctx(t, [['2.1.999', 0o755]]);
    const r = recapture(c, ['--missing'], { STAGED: staged });
    expect(r.status, r.stderr).toBe(0);
    const fixture = JSON.parse(fs.readFileSync(path.join(t.fix, '2.1.999', 'agent-plain.json'), 'utf8'));
    expect(fixture).toMatchObject({ v: 1, version: '2.1.999', scenario: 'agent-plain' });
    expect(fixture.events[0].payload.cwd, 'the run root became /rig').toBe('/rig/repo');
    const matrix = JSON.parse(fs.readFileSync(path.join(t.fix, 'matrix.json'), 'utf8'));
    expect(matrix.versions).toEqual(['2.1.999']);
    expect(r.stdout).toContain('sanitize: scanned 2 file(s)');
    expect(r.stdout).toContain('no residue');
    expect(fs.existsSync(path.join(c.tmp, fs.readdirSync(c.tmp)[0] as string, '2.1.999/agent-plain/version')), 'the raw root is kept').toBe(true);
  }, 60_000);

  it('--dry-run needs no tmux, no node and no mock: it runs with a PATH of bash, ls, sort, uniq and dirname alone', () => {
    const t = recaptureTree();
    const c = ctx(t, ENTRIES);
    const bin = mkTmp('ccrc-dlg-bin-');
    const found = spawnSync('sh', ['-c', 'for t in bash ls sort uniq dirname; do command -v "$t"; done'], { encoding: 'utf8' }).stdout.trim().split('\n');
    expect(found, 'the five tools are on this box').toHaveLength(5);
    for (const f of found) fs.symlinkSync(f, path.join(bin, path.basename(f)));
    const r = spawnSync(path.join(bin, 'bash'), [t.script, '--dry-run', '2.1.999'], { encoding: 'utf8', timeout: 60_000,
      env: { PATH: bin, HOME: c.home, TMPDIR: c.tmp, LOG: t.log, REAL_RIG: RIGSH } });
    expect.soft(r.status, r.stderr).toBe(0);
    expect.soft(stepLines(r.stdout)).toEqual(FIVE(t, ['2.1.999']));
    expect.soft(r.stderr).toBe('');
  }, 60_000);

  it('resolves every path from its own location, never from the caller\'s directory', () => {
    const t = recaptureTree();
    const c = ctx(t, ENTRIES);
    const elsewhere = mkTmp('ccrc-dlg-cwd-');
    const r = recapture(c, ['--dry-run', '2.1.999'], {}, elsewhere);
    expect(r.status, r.stderr).toBe(0);
    expect(stepLines(r.stdout)).toEqual(FIVE(t, ['2.1.999']));
    expect(r.stdout).toContain(`recapture: fixtures dir:  ${t.fix}\n`);
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

  it.skipIf(!LINUX)('removes one whose newest mtime is older than 10 minutes', () => {
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

  it.skipIf(!LINUX)('keeps an aged one while a process has its working directory under it', () => {
    const tmp = mkTmp('ccrc-dlg-tmp-');
    const root = ownerless(tmp);
    ageTree(root, old);
    const holder = spawn('sleep', ['60'], { cwd: path.join(root, 'fixhome'), stdio: 'ignore' });
    children.push(holder);
    const r = reapIn(tmp);
    expect(r.status, r.stderr).toBe(0);
    expect(fs.existsSync(root)).toBe(true);
  }, 60_000);

  it('keeps an aged one when there is no /proc to measure by (fails closed), and removes it when there is', () => {
    const tmp = mkTmp('ccrc-dlg-tmp-');
    const root = ownerless(tmp);
    ageTree(root, old);
    const env = { TMPDIR: tmp, TMUX_TMPDIR: mkTmp('ccrc-dlg-tmux-'), HOME: mkTmp('ccrc-dlg-home-') };
    const blind = rigsh(['reap'], { ...env, RIG_PROC_ROOT: path.join(tmp, 'no-such-proc') });
    expect(blind.status, blind.stderr).toBe(0);
    expect(fs.existsSync(root)).toBe(true);
    if (LINUX) {   // the same root, with the real /proc, is cleared: the guard is what held it
      const sighted = rigsh(['reap'], env);
      expect(sighted.status, sighted.stderr).toBe(0);
      expect(fs.existsSync(root)).toBe(false);
    }
  }, 60_000);
});

describe.skipIf(!LINUX)('rig.sh wait_run_quiet (cleanup_run waits out a process still under the run root)', () => {
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

  it('kill_if_under re-reads the cwd right before the signal: a pid whose cwd is outside the root survives', async () => {
    const text = fs.readFileSync(RIGSH, 'utf8');
    const from = text.indexOf('procs_under() {');
    const to = text.indexOf('cleanup_run() {');
    expect(from).toBeGreaterThan(0);
    expect(to).toBeGreaterThan(from);
    const root = mkTmp('ccrc-dlg-rig.');
    const outside = spawn('sleep', ['60'], { cwd: mkTmp('ccrc-dlg-else-'), stdio: 'ignore' });
    children.push(outside);
    try {
      await new Promise((r) => setTimeout(r, 200));
      expect(alive(outside.pid!)).toBe(true);
      const r = spawnSync('bash', ['-c', `${text.slice(from, to)}\nkill_if_under "$2" "$1"`, 'x', root, String(outside.pid)], { encoding: 'utf8', timeout: 60_000 });
      expect(r.status, r.stderr).toBe(0);
      await new Promise((res) => setTimeout(res, 300));
      expect(alive(outside.pid!)).toBe(true);
    } finally {
      outside.kill('SIGKILL');
    }
  }, 60_000);

  it('wait_run_quiet WAITS, within its bound, for a process under the root that exits on its own: it is never signalled (F10d)', async () => {
    const root = mkTmp('ccrc-dlg-rig.');
    const aux = mkTmp('ccrc-dlg-aux-');
    const go = path.join(aux, 'go'); const mark = path.join(aux, 'mark');
    // Waits for the go file, lives two seconds more, then writes its marker and exits: only a process left alone gets that far.
    const holder = spawn('bash', ['-c', 'while [ ! -e "$GO" ]; do sleep 0.1; done; sleep 2; echo ok > "$MARK"'], { cwd: root, env: { ...process.env, GO: go, MARK: mark }, stdio: 'ignore' });
    children.push(holder);
    await new Promise((r) => setTimeout(r, 200));
    // The harness times the call itself (F8): the holder finishes on its own whether or not anything waits for it, so the marker
    // and `gone` alone cannot tell a wait that waited from one that returned at once. The timer starts BEFORE the go file is raised (M1):
    // the holder cannot exit sooner than two seconds after that file exists, so a wait that waited for it reads at least 2000 ms
    // whatever the load did between the two lines.
    const script = ['set -euo pipefail', rigText('procs_under', 'kill_if_under', 'pid_live', 'wait_run_quiet'),
      't0=$(date +%s%N)', ': > "$GO"', 'wait_run_quiet "$ROOT" ""', 't1=$(date +%s%N)', 'echo "waited_ms=$(( (t1 - t0) / 1000000 ))"'].join('\n');
    // The bound (8 s) is far above the holder's lifetime (about 2 s): a wait that honours it returns when the holder is gone.
    const r = spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { ...process.env, GO: go, ROOT: root, RUN_QUIET_S: '8' }, timeout: 60_000 });
    expect(r.status, r.stderr).toBe(0);
    expect(await gone(holder.pid!)).toBe(true);
    expect(fs.existsSync(mark), 'the process was killed before it could finish; the wait did not wait').toBe(true);
    expect(r.stderr).not.toContain('still hold run root');
    // A LOWER bound: a wait that waited reads at least 2000 ms, and load only makes it longer, so it cannot redden this. The 100 ms
    // under that is slack for the wall clock `date` reads, not for load.
    const waited = Number(/^waited_ms=(\d+)$/m.exec(r.stdout)?.[1]);
    expect(waited, `wait_run_quiet returned after ${waited} ms, before the holder (2 s) could have exited on its own: it did not wait`).toBeGreaterThanOrEqual(1900);
  }, 60_000);

  describe('cleanup_run (F10c: it calls wait_run_quiet, and it never removes a root it could not measure)', () => {
    const env = (extra: Record<string, string>): NodeJS.ProcessEnv => ({ ...process.env, HOME: mkTmp('ccrc-dlg-home-'), ...extra });

    it('removes the root only after wait_run_quiet: a process under it that exits on its own finds the root still there', async () => {
      const root = mkTmp('ccrc-dlg-rig.');
      const aux = mkTmp('ccrc-dlg-aux-');
      const go = path.join(aux, 'go'); const mark = path.join(aux, 'mark');
      // On the go file it records whether its run root still exists, then exits. The harness raises the go file one second in.
      const holder = spawn('bash', ['-c', 'while [ ! -e "$GO" ]; do sleep 0.1; done; if [ -d "$ROOT" ]; then echo present > "$MARK"; else echo absent > "$MARK"; fi'],
        { cwd: root, env: { ...process.env, GO: go, MARK: mark, ROOT: root }, stdio: 'ignore' });
      children.push(holder);
      await new Promise((r) => setTimeout(r, 200));
      const r = spawnSync('bash', ['-c', `( sleep 1; : > "$GO" ) &\n${cleanupScript('RUN_R=$ROOT')}`], { encoding: 'utf8', env: env({ GO: go, ROOT: root, RUN_QUIET_S: '8' }), timeout: 60_000 });
      expect(r.status, r.stderr).toBe(0);
      expect(await gone(holder.pid!)).toBe(true);
      expect(fs.existsSync(mark), 'the holder was killed, not waited for: it never wrote its marker').toBe(true);
      expect(fs.readFileSync(mark, 'utf8').trim(), 'the root was removed under a process still holding it').toBe('present');
      expect(fs.existsSync(root), 'and once the process was gone, the root was removed').toBe(false);
    }, 60_000);

    it('leaves the root, and says so, when there is no /proc to measure by; with a /proc the same root is removed', () => {
      const root = mkTmp('ccrc-dlg-rig.');
      fs.writeFileSync(path.join(root, 'keep'), 'x');
      const blind = spawnSync('bash', ['-c', cleanupScript('RUN_R=$ROOT')], { encoding: 'utf8', env: env({ ROOT: root, RIG_PROC_ROOT: mkTmp('ccrc-dlg-noproc-'), RUN_QUIET_S: '2' }), timeout: 60_000 });
      expect(blind.status, blind.stderr).toBe(0);
      expect(fs.existsSync(path.join(root, 'keep')), 'the root was removed although no process under it could be measured').toBe(true);
      expect(blind.stderr).toContain(`rig: no /proc to measure processes under run root ${path.basename(root)}; leaving it`);
      const sighted = spawnSync('bash', ['-c', cleanupScript('RUN_R=$ROOT')], { encoding: 'utf8', env: env({ ROOT: root, RUN_QUIET_S: '2' }), timeout: 60_000 });
      expect(sighted.status, sighted.stderr).toBe(0);
      expect(fs.existsSync(root), 'with /proc present the guard was the only thing that held it').toBe(false);
    }, 120_000);
  });
});

describe('rig.sh reap, sockets and scenario text', () => {
  /** A socket file whose listener is gone: bind, then die without unlinking. */
  const staleSocket = (dir: string, name: string): void => {
    const code = `require('node:net').createServer().listen(${JSON.stringify(path.join(dir, name))}, () => process.kill(process.pid, 'SIGKILL'))`;
    spawnSync(process.execPath, ['-e', code], { timeout: 10_000 });
  };
  it('reap removes only the private socket of a dead owner (never `default`, never a live owner\'s)', () => {
    const tmuxTmp = fs.mkdtempSync('/tmp/dlgt-');   // short: a unix socket path is capped near 108 bytes
    try {
      const dir = path.join(tmuxTmp, `tmux-${os.userInfo().uid}`);
      fs.mkdirSync(dir);
      const deadPid = spawnSync('true').pid;
      for (const n of [`dlg${deadPid}`, `dlg${process.pid}`, 'default']) staleSocket(dir, n);
      for (const n of [`dlg${deadPid}`, `dlg${process.pid}`, 'default']) expect(fs.statSync(path.join(dir, n)).isSocket(), n).toBe(true);
      const r = rigsh(['reap'], { TMUX_TMPDIR: tmuxTmp, TMPDIR: mkTmp('ccrc-dlg-tmp-'), HOME: mkTmp('ccrc-dlg-home-') });
      expect(r.status, r.stderr).toBe(0);
      expect(fs.readdirSync(dir).sort()).toEqual(['default', `dlg${process.pid}`].sort());
    } finally { fs.rmSync(tmuxTmp, { recursive: true, force: true }); }
  }, 60_000);

  it('reap keeps a socket named dlg plus anything but digits: only a numeric pid can name a dead owner (F10h)', () => {
    const tmuxTmp = fs.mkdtempSync('/tmp/dlgt-');
    try {
      const dir = path.join(tmuxTmp, `tmux-${os.userInfo().uid}`);
      fs.mkdirSync(dir);
      const names = ['dlgabc', 'dlg12x', 'dlg'];   // each passes guard-sock; none is a pid, so `kill -0` would call its owner dead
      for (const n of names) staleSocket(dir, n);
      for (const n of names) expect(fs.statSync(path.join(dir, n)).isSocket(), n).toBe(true);
      const r = rigsh(['reap'], { TMUX_TMPDIR: tmuxTmp, TMPDIR: mkTmp('ccrc-dlg-tmp-'), HOME: mkTmp('ccrc-dlg-home-') });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stderr).not.toContain('reaped private server');
      expect(fs.readdirSync(dir).sort()).toEqual([...names].sort());
    } finally { fs.rmSync(tmuxTmp, { recursive: true, force: true }); }
  }, 60_000);

  it('cleanup_run\'s rm removes its own socket file, and only that one: a neighbour\'s and `default` stay (F10g)', () => {
    const tmuxTmp = fs.mkdtempSync('/tmp/dlgt-');
    try {
      const dir = path.join(tmuxTmp, `tmux-${os.userInfo().uid}`);
      fs.mkdirSync(dir);
      // No server runs here: the files are stale sockets, and the directory is 0775, which tmux refuses before it connects.
      // So kill-server reaches nothing and the `rm` is the only thing that can take the file away.
      for (const n of ['dlg4242', 'dlg4243', 'default']) staleSocket(dir, n);
      const env: NodeJS.ProcessEnv = { ...process.env, HOME: mkTmp('ccrc-dlg-home-'), TMUX_TMPDIR: tmuxTmp };
      delete env.TMUX;
      const r = spawnSync('bash', ['-c', cleanupScript('SOCK=dlg4242')], { encoding: 'utf8', env, timeout: 60_000 });
      expect(r.status, r.stderr).toBe(0);
      expect(fs.readdirSync(dir).sort()).toEqual(['default', 'dlg4243']);
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

describe('rig.sh wait_ready (F10g: the ready prompt is its footer, never the version banner)', () => {
  /** rig.sh's own wait_ready, with `pane` replaced by a fixed screen and a 1 s bound: its exit status. */
  const ready = (screen: string): number | null => {
    const script = ['set -uo pipefail', rigText('wait_ready'), 'pane() { printf \'%s\\n\' "$SCREEN"; }', 'wait_ready 1'].join('\n');
    return spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { ...process.env, SCREEN: screen }, timeout: 60_000 }).status;
  };
  const BANNER = ' Claude Code v2.1.289\n Rig Fixture\n /rig/repo';

  it('is ready on "? for shortcuts" (older builds) and on each "<mode> on" footer line (2.1.289 and after)', () => {
    for (const footer of ['  ? for shortcuts', '  manual mode on (shift+tab to cycle)', '  plan mode on (shift+tab to cycle)', '  auto mode on (shift+tab to cycle)', '  accept edits on (shift+tab to cycle)']) {
      expect.soft(ready(`${BANNER}\n${footer}`), footer).toBe(0);   // soft: each alternative is measured on its own
    }
  }, 60_000);

  it('is not ready on the version banner alone: the input box follows it', () => {
    expect(ready(BANNER), 'the banner').toBe(1);
    expect(ready(''), 'a blank screen').toBe(1);
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
    expect(s.permissions.disableAutoMode, 'an unanswered auto-mode modal must not be able to block a run (D-4004)').toBe('disable');
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
    for (const prompt of ['a</srv/x', 'done</mnt/x/y', 'wc -l</etc/hosts', '<x></opt/app/conf></x>', 'sort</srv/data/list', '</srv.corp:8080>', '</a.b>']) {
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

  it('fails closed on a `..` path segment at the string\'s start or right after a `/`, however the path before it reads (review 304 F1)', () => {
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
    for (const fine of ['http://127.0.0.1:4000', '/rig//x', '/usr//bin/git', 'a // b']) {
      const r = leakRun({ note: fine });
      expect(r.status, `${fine}: ${r.stderr}`).toBe(0);
    }
  });

  it('scans the path after an allowed loopback host and port like any absolute path (F1a): `http://127.0.0.1:4000/home/…` is residue, a bare loopback URL is not', () => {
    for (const leak of ['http://127.0.0.1:4000/home/someone-else/x', 'http://127.0.0.1/srv/acme', 'curl //127.0.0.1:4000/mnt/vol/client',
      'http://127.0.0.1:4000//srv/acme', 'http://127.0.0.1:4000/v1/messages', 'http://127.0.0.1:4000/dev/null/srv/acme']) {
      expectNamed(leakRun({ note: leak }), '/events/0/payload/note', 'someone-else', 'srv/acme', 'vol/client');
    }
    for (const fine of ['http://127.0.0.1:4000', 'http://127.0.0.1', 'ANTHROPIC_BASE_URL=http://127.0.0.1:4000 x', 'http://127.0.0.1:4000/', 'http://127.0.0.1:4000/rig/state', 'http://127.0.0.1:4000/usr/bin']) {
      const r = leakRun({ note: fine });
      expect(r.status, `${fine}: ${r.stderr}`).toBe(0);
    }
  }, 60_000);

  // Round 2 of F1(a): after an allowed loopback host the ONLY accepted continuations are the end of the URL, `:<digits>`
  // then the end or a `/`-path, or a `/`-path. Any other continuation is residue (fail closed), however benign what follows.
  it('a loopback host followed by userinfo (`@`) is residue: the real host is whatever follows the `@`', () => {
    for (const leak of ['http://127.0.0.1@evil.example/home/x', 'http://127.0.0.1:4000@evil.example', 'http://127.0.0.1@evil.example']) {
      expectNamed(leakRun({ note: leak }), '/events/0/payload/note', 'evil.example', 'home/x');
    }
  });

  it('a loopback host with a port that is not digits is residue, even when the path after it is an allowed one', () => {
    for (const leak of ['http://127.0.0.1:abc/home/x', 'http://127.0.0.1:abc', 'http://127.0.0.1:abc/rig/x', 'http://127.0.0.1:', 'http://127.0.0.1:4000x', 'http://127.0.0.1:4000:x']) {
      expectNamed(leakRun({ note: leak }), '/events/0/payload/note', 'home/x');
    }
  });

  it('a name glued onto the loopback address with `.`, `-` or `_` is another host, not the loopback', () => {
    for (const leak of ['http://127.0.0.1.evil.example/x', 'http://127.0.0.1.evil.example', 'http://127.0.0.1-x.example/p', 'http://127.0.0.1_x', '//127.0.0.1.1']) {
      expectNamed(leakRun({ note: leak }), '/events/0/payload/note', 'evil.example', 'x.example');
    }
  });

  it('a query, a fragment or a backslash straight after the loopback host or its port is residue (a backslash is a path separator to a browser)', () => {
    for (const leak of ['http://127.0.0.1?x=1', 'http://127.0.0.1:4000#f', 'http://127.0.0.1:4000?x=1', 'http://127.0.0.1:4000\\srv\\acme']) {
      expectNamed(leakRun({ note: leak }), '/events/0/payload/note', 'srv');
    }
  });

  it('the characters that END a loopback URL (whitespace, a quote, a closer, `<`, `>`, `,`, `;`) pass; every other character after it is residue', () => {
    const ends = [' ', '\t', '\n', '"', "'", '`', ')', ']', '}', '<', '>', ',', ';'];
    const continues = ['.', ':', '?', '#', '@', '\\', '!', '=', '&', '|', '(', '[', '{', '%', '~', '*', '+', '$'];
    for (const url of ['http://127.0.0.1', 'http://127.0.0.1:4000']) {
      const end = leakRun({ note: `x ${url}` });
      expect(end.status, `${url} at the end of the string: ${end.stderr}`).toBe(0);
      for (const ch of ends) {
        const r = leakRun({ note: `x ${url}${ch}y` });
        expect(r.status, `${url} then ${JSON.stringify(ch)}: ${r.stderr}`).toBe(0);
      }
      for (const ch of continues) expectNamed(leakRun({ note: `x ${url}${ch}y` }), '/events/0/payload/note');
    }
  }, 120_000);

  it('a `//`-led path whose first segment is an allowed top passes (`file:///rig/…`), and one that is not still fails closed', () => {
    for (const fine of ['file:///rig/tmp/x.output', '//usr/bin/git', 'file:///usr/bin/git', 'x //bin y', 'http://rig']) {
      const r = leakRun({ note: fine });
      expect(r.status, `${fine}: ${r.stderr}`).toBe(0);
    }
    expectNamed(leakRun({ note: 'file:///rigx/tmp/x' }), '/events/0/payload/note', 'rigx');
  });

  // I3(a): an allowed TOP at a host position (`http://rig…`) is read like the loopback host, except that it has no port: after
  // `//<top>` only the end of the URL or a `/`-path whose first segment the allowlist accepts may follow.
  it('an allowed top used as a HOST gets the loopback rule without a port: `http://rig:4000/…`, `http://rig@evil…` and a backslash are residue (I3a)', () => {
    for (const leak of ['http://rig:4000/home/someone-else/x', 'http://rig@evil.example/srv/acme', 'http://rig\\srv\\acme', 'http://usr:80', 'http://bin:1/x',
      'http://rig?x=/rig', 'http://rig#f', 'x //bin/sh y', '//rig/home/someone-else/x', 'http://rig/srv/acme', 'http://rig//srv/acme', 'http://rig/~/srv/acme']) {
      expectNamed(leakRun({ note: leak }), '/events/0/payload/note', 'someone-else', 'evil.example', 'srv/acme', 'srv');
    }
    for (const fine of ['http://rig/rig/x', 'http://usr/bin/git', 'http://rig/', 'http://rig, x', '(//bin)', 'file:///rig/x', '/rig//x']) {
      const r = leakRun({ note: fine });
      expect(r.status, `${fine}: ${r.stderr}`).toBe(0);
    }
  }, 60_000);

  // I3(b): a `//` at a host position followed by a character that cannot start a name hides whatever follows it. CHOSEN: `//`
  // followed by whitespace, a quote, a backtick, a closer `)` `]` `}`, `<`, `>`, `,` `;` or the end stays allowed (a comment
  // `// x`), and `//` followed by `/` is a longer run of slashes; every other character after `//` is residue.
  it('a `//` at a host position followed by a character that cannot start a name is residue: `[`, `@`, `%`, `~`, `:`, `\\` and the like (I3b)', () => {
    for (const leak of ['http://[fd00::abcd]:8080/home/someone-else/x', 'http://[::1]:4000/srv/acme', 'http://@evil.example/srv/acme', 'http://%65vil.example/home/someone-else',
      'smb://$share/mnt/vol/client', '//~/srv/acme', '//:4000/srv/acme', '//\\share\\x', 'x //!y', 'x //=y', 'x //(y', 'x //|y', 'x //?y', 'x //#y', 'x //*y', 'x //+y', 'x //&y', 'x //^y', 'x //{y', 'x //éy']) {
      expectNamed(leakRun({ note: leak }), '/events/0/payload/note', 'someone-else', 'evil.example', 'srv/acme', 'vol/client');
    }
    // I4: a RUN of slashes is judged where it ends (the lookbehind leaves `/` out on purpose), so a host that starts outside a
    // name class behind three or four slashes is just as residue; adding `/` to the lookbehind would let all of these through
    for (const leak of ['http:///[fd00::abcd]:8080/home/someone-else/x', 'http:///@evil.example/home/someone-else/x', '///~/srv/acme', 'file:///%65vil.example/home/someone-else',
      'x ////[::1]:4000/srv/acme', '///:4000/srv/acme']) {
      expectNamed(leakRun({ note: leak }), '/events/0/payload/note', 'someone-else', 'evil.example', 'srv/acme');
    }
    // and a `//` INSIDE a path or a word (preceded by a name character, `.`, `_`, `-` or `~`) is a join artefact, not a host position
    for (const fine of ['a // b', 'x //', '// x', 'x //\ny', 'a //, b', '"//"', '(//)', '<//>', '///', 'x //; y', 'a //\ty', "'//'", '`//`', '[//]', '{//}',
      '/rig//[x]', '/rig//~x', 'a//@b', 'a.//(b)', 'a_//%b', 'a-//$b', 'a~//|b']) {
      const r = leakRun({ note: fine });
      expect(r.status, `${JSON.stringify(fine)}: ${r.stderr}`).toBe(0);
    }
  }, 120_000);

  it('`/dev/null` is exempt only as the WHOLE path: a path under it is residue (F1b)', () => {
    for (const leak of ['/dev/null/srv/acme', '2>/dev/null/mnt/vol/client', 'cmd >/dev/null/home/someone-else/x']) {
      expectNamed(leakRun({ note: leak }), '/events/0/payload/note', 'srv/acme', 'vol/client', 'someone-else');
    }
  });

  it('`/dev/null` is exempt only when nothing path-like follows it: near misses fail closed, the plain spellings pass (F2a)', () => {
    for (const leak of ['/dev/nullsrv', '/dev/null.d', '/dev/null-x', '/dev/null_x', '/dev/null0', '2>/dev/nullsrv']) {
      expectNamed(leakRun({ note: leak }), '/events/0/payload/note', 'nullsrv');
    }
    for (const fine of ['/dev/null', '2>/dev/null', 'cmd >/dev/null 2>&1', '(/dev/null)', '/dev/null,']) {
      const r = leakRun({ note: fine });
      expect(r.status, `${fine}: ${r.stderr}`).toBe(0);
    }
  }, 60_000);

  it('fails closed on a JSON-escaped slash: a payload string holding a literal backslash-slash spelling of a foreign path (F2b)', () => {
    // These are the characters backslash, slash — in the capture file they read `\\/srv\\/acme`.
    // `x\/srv\/acme` (a name character before the backslash) is the shape ONLY ABS's own scan of the raw string refuses: once
    // the escape is decoded to `x/srv/acme` the `/srv` follows a name character and reads as a relative path
    for (const leak of ['\\/srv\\/acme', 'x \\/mnt\\/vol-0000\\/client', 'x\\/srv\\/acme']) {
      expect(leak).toContain('\\/');
      expectNamed(leakRun({ note: leak }), '/events/0/payload/note', 'srv', 'vol-0000');
    }
  });

  // N1: a JSON-escaped slash is decoded like `\uXXXX` and `%2F`, so a `//` host written `\/\/` is scanned as the `//` it is. ABS
  // cannot start a segment at `[` or `@`, so only the decoded spelling shows the host of a path-less URL.
  it('scans the decoded spelling of a JSON-escaped slash: `http:\\/\\/[fd00::abcd]:8080` and `http:\\/\\/@evil.example` are residue (N1)', () => {
    for (const leak of ['http:\\/\\/[fd00::abcd]:8080', 'http:\\/\\/@evil.example', 'http:\\/\\/%65vil.example', 'smb:\\/\\/$share', 'x \\/\\/~', 'http:\\/\\/rig:4000']) {
      expect(leak).toContain('\\/');
      expectNamed(leakRun({ note: leak }), '/events/0/payload/note', 'evil.example', 'fd00');
    }
    for (const fine of ['a \\/\\/ b', 'x \\/\\/', 'a \\/\\/\\/', '\\/\\/']) {
      const r = leakRun({ note: fine });
      expect(r.status, `${fine}: ${r.stderr}`).toBe(0);
    }
  }, 60_000);

  // I1: a path's FIRST segment is the whole segment. ABS's segment class stops at `~`, `@`, `+`, `%`..., and a `/` after one of
  // those is never scanned, so after an allowed top and after `/dev/null` the next character must be `/` (not for `/dev/null`),
  // `:` (a PATH separator), the end, or a character that ends a URL or a word. Anything else is residue.
  const NOTE = '/events/0/payload/note';
  const GLUE = ['~', '@x', '+x', '%x', '=x', '?x', '#x', '!x', '$x', '*x', '^x', '&x', '|x', '\\x'];
  it('an allowed top glued to a character outside the segment class is residue, not an allowed first segment (I1)', () => {
    for (const leak of ['/rig~/srv/acme', '/usr~/home/someone-else/x', '/bin~/mnt/vol/client', '/rig@x/srv/acme', '/rig+x/home/someone-else/x', '/usr%x/mnt/vol/client',
      '/bin=x/srv/acme', '/rig?x/srv/acme', '/rig#x/mnt/vol/client']) {
      expectNamed(leakRun({ note: leak }), NOTE, 'srv/acme', 'someone-else', 'vol/client');
    }
    for (const top of ['rig', 'usr', 'bin']) for (const g of GLUE) expectNamed(leakRun({ note: `x /${top}${g}/srv/acme y` }), NOTE, 'srv/acme');
  }, 120_000);

  it('what may follow an allowed top: `/`, `:`, the end and a URL/word ender pass (I1)', () => {
    for (const fine of ['/rig', '/rig/x', '/usr/bin/git', '/bin:/usr', '/rig:y', 'x /bin y', '/rig)', '/usr"', '(/rig)', '/rig,', '/rig;', '/bin]', '/usr}', '/rig<', '/rig>', "'/rig'", '`/rig`', '/rig\t', '/rig\n']) {
      const r = leakRun({ note: fine });
      expect(r.status, `${JSON.stringify(fine)}: ${r.stderr}`).toBe(0);
    }
  }, 60_000);

  it('`/dev/null` glued to a character outside the segment class is residue (I1)', () => {
    for (const leak of ['/dev/null~/srv/acme', '2>/dev/null~/home/someone-else/x', '/dev/null@x/srv/acme', '/dev/null+x/home/someone-else/x', '/dev/null%x/mnt/vol/client',
      '/dev/null=x/srv/acme', '/dev/null#x/srv/acme', '/dev/null?x/srv/acme']) {
      expectNamed(leakRun({ note: leak }), NOTE, 'srv/acme', 'someone-else', 'vol/client');
    }
    for (const g of GLUE) expectNamed(leakRun({ note: `x /dev/null${g}/srv/acme y` }), NOTE, 'srv/acme');
    for (const fine of ['/dev/null:y', '/dev/null)', '/dev/null;', '"/dev/null"', '/dev/null\n', '/dev/null>', '/dev/null]']) {
      const r = leakRun({ note: fine });
      expect(r.status, `${JSON.stringify(fine)}: ${r.stderr}`).toBe(0);
    }
  }, 60_000);

  it('a path after the loopback `/` whose first segment is outside the allowlist or glued to a character outside the class is residue (I1)', () => {
    for (const leak of ['http://127.0.0.1:4000/~/home/someone-else/x', 'http://127.0.0.1/~/srv/acme', 'http://127.0.0.1:4000/@x/srv/acme', 'http://127.0.0.1:4000/+x/home/someone-else',
      'http://127.0.0.1:4000/%7Ex/mnt/vol/client', 'http://127.0.0.1:4000/?x/srv/acme', 'http://127.0.0.1:4000/#x/home/someone-else', 'http://127.0.0.1:4000/rig~/mnt/vol/client',
      'http://127.0.0.1:4000/rig?x/srv/acme', 'http://127.0.0.1:4000/usr@x/srv/acme', 'http://127.0.0.1:4000/dev/null~/srv/acme']) {
      expectNamed(leakRun({ note: leak }), NOTE, 'srv/acme', 'someone-else', 'vol/client');
    }
    for (const g of GLUE) expectNamed(leakRun({ note: `http://127.0.0.1:4000/rig${g}/srv/acme` }), NOTE, 'srv/acme');
    for (const fine of ['http://127.0.0.1:4000/', 'http://127.0.0.1:4000/ y', 'http://127.0.0.1:4000/rig, y', 'http://127.0.0.1:4000/dev/null', 'http://127.0.0.1:4000//rig/x']) {
      const r = leakRun({ note: fine });
      expect(r.status, `${fine}: ${r.stderr}`).toBe(0);
    }
  }, 60_000);

  // I2: the leak-direction sub-arms of the guards above, each pinned by an input that only that arm refuses.
  it('`/dev/null` is a first segment exemption only: `/dev/shm/null`, `/srv/null` and the loopback `/srv/null` are residue (I2)', () => {
    for (const leak of ['/dev/shm/null', '/dev/disk/by-id/x/null', '/srv/null', '/home/null', '/mnt/null', 'http://127.0.0.1:4000/srv/null', 'http://127.0.0.1:4000/dev/shm/null']) {
      expectNamed(leakRun({ note: leak }), NOTE, 'srv', 'home', 'mnt');
    }
  });

  it('the loopback port is read AT the host, not anywhere after it: `http://127.0.0.1@x/rig:1` and `http://127.0.0.1?a/rig:1` are residue (I2)', () => {
    for (const leak of ['http://127.0.0.1@x/rig:1', 'http://127.0.0.1?a/rig:1', 'http://127.0.0.1/:1']) {
      expectNamed(leakRun({ note: leak }), NOTE);
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

  // F12 (review 296): MUNGED_FOREIGN is a DENYLIST of ten tops, case-sensitive, not a class. These rows PIN that as the header declares
  // it, so a change that widens the list (or makes it an allowlist) must change the header with it. They are not a guarantee.
  it('a munged foreign path whose top MUNGED_FOREIGN does not list passes (declared limit, not a guarantee): `-data-…`, `-media-…`, `-Home-…` (F12)', () => {
    for (const fine of ['-media-vol-client', '-data-acme-client-proj', '-Home-x', 'x -Mnt-vol-0000']) {
      const r = leakRun({ note: fine });
      expect(r.status, `${fine}: ${r.stderr}`).toBe(0);
    }
    // while every listed top is refused, so the pin above is about the LIST and not about the shape
    for (const top of ['home', 'mnt', 'tmp', 'srv', 'opt', 'var', 'root', 'Users', 'private', 'proc']) expectNamed(leakRun({ note: `-${top}-x-y` }), NOTE);
  }, 60_000);

  // The header's first KNOWN LIMIT: an encoding the decode does not know is neither decoded nor chased. Pinned as declared.
  it('base64 of residue is not decoded (declared limit, not a guarantee): a base64 foreign path and a base64 `//` URL pass', () => {
    for (const text of ['/srv/acme/x', 'http://srv.corp/x', '/home/someone-else/acme']) {
      const fine = Buffer.from(text).toString('base64');
      const r = leakRun({ note: `x ${fine} y` });
      expect(r.status, `${fine}: ${r.stderr}`).toBe(0);
    }
  });

  // F11 (review 296): ABS's lookbehind skips a `/` after a letter, a digit, `.`, `_`, `~`, `-` (and `/`, a run of slashes, read where it
  // ends), so a path glued after one of them is never scanned. The header names every one of them and `~/…`. Pinned as declared.
  it('a `/` glued after a letter, a digit, `.`, `_`, `~` or `-` is not scanned (declared limit, not a guarantee): `~/srv/acme`, `./srv/acme`, `a_/srv/acme` (F11)', () => {
    for (const fine of ['~/srv/acme', './srv/acme', 'a_/srv/acme', 'x/srv/acme', '1/srv/acme', 'a-/srv/acme', '127.0.0.1:4000/home/x']) {
      const r = leakRun({ note: fine });
      expect(r.status, `${fine}: ${r.stderr}`).toBe(0);
    }
    // a `/` after anything ELSE is scanned: the declared set is exactly that lookbehind
    for (const leak of [' /srv/acme', '=/srv/acme', ':/srv/acme', '"/srv/acme"', '(/srv/acme)', '@/srv/acme']) expectNamed(leakRun({ note: leak }), NOTE, 'srv/acme');
  }, 60_000);

  // Review 296 m2: the one exception to "a `/` after any other character is scanned" is the `/` of a COMPLETE closing tag `</name>` (ABS's
  // negative lookahead): a tag, not a path. It hides one bare segment at most. Pinned as declared; the first row of this block pins that
  // a foreign path INSIDE tags still fails closed.
  it('a complete closing tag `</name>` is a tag, not a path (declared limit, not a guarantee): `x </srv> y` passes, `</srv/x>` and `</srv.corp>` do not (m2)', () => {
    for (const fine of ['x </srv> y', '</srv>', '%3C%2Fsrv%3E']) {
      const r = leakRun({ note: fine });
      expect(r.status, `${fine}: ${r.stderr}`).toBe(0);
    }
    for (const leak of ['x </srv/x> y', '</srv.corp>', 'x </srv y', 'x /srv> y']) expectNamed(leakRun({ note: leak }), NOTE, 'srv');
  });

  // Review 304 F1 (ruled: narrow the claim, pin the limit; DOTDOT is NOT widened). DOTDOT is `(^|/)\.\.(/|$)`: a `..` segment is caught
  // only at the string's START or right after a `/`. A `..` after a space, `=` or a quote is not, and the `/` behind it follows a `.`
  // (ABS's lookbehind skips it), so the path after it is not scanned either. The committed corpus holds such strings, raw-worktree's own
  // ` ../raw-wt` (the rig's relative path to its own raw worktree), so widening DOTDOT to `[^A-Za-z0-9._~-]` before the `..` reds this
  // row, the corpus row and the `--scan` file-index row. The `..` row near the top of this block pins what IS caught.
  it('a `..` that is not at the start of the string or right after a `/` is not scanned (declared limit, not a guarantee): `x ../srv/acme`, `x=../srv/acme`, `cmd ../raw-wt` (review 304 F1)', () => {
    for (const fine of ['x ../srv/acme', 'x=../srv/acme', 'cmd ../raw-wt', 'x ..', 'x "../srv/acme" y']) {
      const r = leakRun({ note: fine });
      expect(r.status, `${fine}: ${r.stderr}`).toBe(0);
      expect(r.written, fine).toEqual(['2.1.999']);
    }
    // while the same path behind a `..` at the start, or behind a `/`, is refused: the pin is about WHERE the `..` stands
    for (const leak of ['../srv/acme', 'cd ../../srv/acme']) expectNamed(leakRun({ note: leak }), NOTE, 'srv/acme');
    // and the header's sentence that the committed corpus holds this shape is true: raw-worktree's command, in the fixtures
    const corpus = path.resolve(__dirname, 'fixtures/delegation');
    const holders = fs.readdirSync(corpus, { recursive: true }).map(String)
      .filter((n) => n.endsWith('.json') && fs.readFileSync(path.join(corpus, n), 'utf8').includes(' ../raw-wt'));
    expect(holders.length, 'fixtures holding " ../raw-wt"').toBeGreaterThan(0);
  }, 60_000);

  // Review 304 F4 (ruled: a known limit, pinned). ABS is a `/` followed by `[A-Za-z0-9._-]+`, so the FIRST segment of an absolute path
  // that starts with any other character is never scanned: what FOLLOWS the `/` is a second exception to "a `/` after any other
  // character is scanned". The control, the same path with a plain first segment, is refused.
  it('an absolute path whose first segment starts outside `[A-Za-z0-9._-]` is not scanned (declared limit, not a guarantee): `/~someone-else/acme`, `/@scope/srv/acme`, `/$HOME/srv/acme` (review 304 F4)', () => {
    for (const fine of ['x /~someone-else/acme', '"/~someone-else/acme"', 'cd /~someone-else/acme && ls', 'x /@scope/srv/acme', 'x /$HOME/srv/acme',
      'x /+x/srv/acme', 'x /=x/srv/acme', 'x /%7Esomeone-else/acme']) {
      const r = leakRun({ note: fine });
      expect(r.status, `${fine}: ${r.stderr}`).toBe(0);
      expect(r.written, fine).toEqual(['2.1.999']);
    }
    // while a first segment inside the class is refused: the pin is about the FIRST CHARACTER of the segment
    expectNamed(leakRun({ note: 'x /srv/acme' }), NOTE, 'srv/acme');
    // and only about the FIRST segment: a LATER `/` is scanned like any other, so the path escapes only where that `/` follows a name
    // character (the glued-slash limit, F11), as it does in every probe above; after `@`, `:`, `=`, or behind a `//`, it is residue
    for (const leak of ['x /@/srv/acme', 'x /~x:/srv/acme', 'x /~x@/srv/acme', 'x /~x=/srv/acme', 'x //~someone/acme']) expectNamed(leakRun({ note: leak }), NOTE, 'srv/acme');
  }, 60_000);

  it.skipIf(USER.length < 4)('scans the decoded spelling of an escaped string: \\uXXXX and %2F', () => {
    const esc = (w: string): string => [...w].map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`).join('');
    for (const leak of ['\\u002fsrv\\u002fx', '{"p":"\\u002fsrv\\u002fx"}', 'x %2Fsrv%2Fx', `x-${esc(USER)}-y`, '\\u002e\\u002e\\u002fx']) {
      expectNamed(leakRun({ note: leak }), '/events/0/payload/note', USER);
    }
  });

  // F1 (review 296): the decoded spelling turns EVERY `%XX` (two hex digits, either case) into its character, ONCE. With only `%2F`
  // decoded, the `/` of `cat%20%2Fhome…` landed right after a name character, where both lookbehinds skip it.
  const PCT_VALUES: Array<[string, string]> = [
    ['a foreign path behind another escape', 'cat%20%2Fhome%2Fsomeone-else%2Facme'],
    ['a non-loopback URL', 'redirect=http%3A%2F%2Fsrv.corp%2Fx'],
    ['a foreign path behind a loopback URL', 'u=http%3A%2F%2F127.0.0.1%3A4000%2Fhome%2Fsomeone-else'],
  ];
  it.each(PCT_VALUES)('a percent-escaped spelling of %s is residue as a value, named by place, nothing written (F1)', (_name, leak) => {
    expectNamed(leakRun({ note: leak }), NOTE, 'someone-else', 'srv.corp', 'acme');
  });

  it('the same percent-escaped string as a KEY is residue, named by index and never printed (F1)', () => {
    // As in the KEY row above, the value carries residue too, so a pointer that printed the key's text would show it there.
    const r = leakRun({ tool_response: { 'cat%20%2Fhome%2Fsomeone-else%2Facme': '/srv/x' } });
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toContain('2.1.999/leak /events/0/payload/tool_response/#0 (key)\n');
    expect(r.stderr).toContain('2.1.999/leak /events/0/payload/tool_response/#0\n');
    for (const secret of ['someone-else', 'acme', '%2F', 'cat%20']) expect(r.stderr).not.toContain(secret);
    expect(r.written).toEqual([]);
  });

  it('decodes every `%XX`, in either case, not only an upper-case `%2F` (F1): `%2e%2e%2f` is a `..` segment and a lower-case `%2f` is a slash', () => {
    for (const leak of ['%2e%2e%2fsrv', 'cat%20%2fhome%2fsomeone-else', '%2E%2E%2Fsrv%2Facme']) {
      expectNamed(leakRun({ note: leak }), NOTE, 'someone-else', 'srv', 'acme');
    }
  });

  it.skipIf(USER.length < 4)('the user\'s name with its first letter percent-escaped is residue (F1)', () => {
    const hex = USER.charCodeAt(0).toString(16).padStart(2, '0');
    for (const leak of [`x-%${hex}${USER.slice(1)}-y`, `x-%${hex.toUpperCase()}${USER.slice(1)}-y`]) expectNamed(leakRun({ note: leak }), NOTE, USER);
  });

  it('what the percent decode leaves alone passes: a `%` not followed by two hex digits, a benign escape, and a malformed run that would throw decodeURIComponent (F1)', () => {
    for (const fine of ['100%25 done', 'a%20b', '50% off', '%zz', '%2', '%', 'x%', '%E0%A4%A', '%E0%A4%A.', '%C3%28', '%ff%fe']) {
      const r = leakRun({ note: fine });
      expect(r.status, `${JSON.stringify(fine)}: ${r.stderr}`).toBe(0);
    }
  }, 60_000);

  it('controls: `path=%2Fhome%2Fx` and a bare `%2Fhome%2F…` stay refused (F1)', () => {
    for (const leak of ['path=%2Fhome%2Fx', '%2Fhome%2Fsomeone-else%2Facme']) expectNamed(leakRun({ note: leak }), NOTE, 'someone-else', 'acme');
  });

  // The decode is ONE pass per kind in the fixed order `\uXXXX` -> `%XX` -> `\/` (review 296 m1). An escape is chased only where an EARLIER
  // pass produces a LATER kind (the next row); the same kind twice, and a later kind producing an earlier one, are not chased.
  it('a double-encoded spelling is NOT chased: `%252F` reads `%2F`, `\\u005Cu002F` reads `\\u002F`, `%5Cu002F` reads `\\u002F` (declared limit, not a guarantee) (F1, m1)', () => {
    for (const fine of [
      '%252Fhome%252Fsomeone-else', 'cat%20%252Fhome%252Fx', // the percent kind twice
      'cat \\u005Cu002Fhome\\u005Cu002Fsomeone-else\\u005Cu002Facme', // the \u kind twice: `\` is a backslash, then `u002F` follows it
      'cat %5Cu002Fhome%5Cu002Fsomeone-else%5Cu002Facme', // a percent escape producing a \u escape: a later pass producing an earlier kind
    ]) {
      expect(fine).toMatch(/%25|\\u005C|%5C/);
      const r = leakRun({ note: fine });
      expect(r.status, `${fine}: ${r.stderr}`).toBe(0);
    }
  });

  it('an escape IS chased where an earlier pass produces a later kind: `\\u0025` then `2F`, and `%5C%2F` then a `\\/` pass (m1)', () => {
    for (const leak of ['x \\u00252Fhome\\u00252Fsomeone-else', 'http:%5C%2F%5C%2F[fd00::abcd]:8080']) {
      expectNamed(leakRun({ note: leak }), NOTE, 'someone-else', 'fd00');
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
    // the EXACT line, so that the version-directory pre-check is what refused (M4): without it destKind's ENOTDIR reaches the
    // internal-error line, which also exits 1
    expect(r.stderr).toBe('sanitize: 2.1.999 exists in the fixtures directory and is not a directory\n');
    expect(r.stderr).not.toContain(base);
    expect(fs.readdirSync(out)).toEqual(['2.1.999']);
    expect(fs.readFileSync(path.join(out, '2.1.999'), 'utf8')).toBe('planted');
    expect(fs.readdirSync(base)).toEqual(['fix']); // and no temp sibling is left behind
  });

  // F13: the move into the fixtures directory is one `renameSync` per file, so EVERY destination is checked first.
  // Two versions are fed; the later (2.1.999) is the one whose destination is planted, and the earlier (2.1.998)
  // sorts first, so a per-file check that only runs as each version is reached has already moved it in.
  const halfMove = (plant: (out: string, base: string) => void, undo?: (out: string) => void): { r: ReturnType<typeof sanitize>; out: string; base: string } => {
    const raw = mkTmp('ccrc-dlg-raw.');
    const base = mkTmp('ccrc-dlg-fixbase-');
    const out = path.join(base, 'fix');
    fs.mkdirSync(path.join(out, '2.1.999'), { recursive: true });
    plant(out, base);
    rawBundle(raw, ROOT, '2.1.998', 'clean', [['Stop', 1, { hook_event_name: 'Stop' }]]);
    rawBundle(raw, ROOT, '2.1.999', 'clean', [['Stop', 1, { hook_event_name: 'Stop' }]]);
    try {
      const r = sanitize(raw, out);
      expect(fs.existsSync(path.join(out, '2.1.998')), 'the earlier version received nothing').toBe(false);
      return { r, out, base };
    } finally { undo?.(out); }
  };

  it('writes NOTHING when a later version directory holds a directory or a link where a fixture file would go: no earlier version is moved in first (F13)', () => {
    const shapes: Array<[string, (out: string, base: string) => void]> = [
      ['a directory', (out) => fs.mkdirSync(path.join(out, '2.1.999', 'clean.json'))],
      ['a symbolic link to a regular file', (out, base) => { fs.writeFileSync(path.join(base, 'elsewhere'), 'x'); fs.symlinkSync(path.join(base, 'elsewhere'), path.join(out, '2.1.999', 'clean.json')); }],
    ];
    for (const [name, plant] of shapes) {
      const { r, out, base } = halfMove(plant);
      expect(r.status, name).toBe(1);
      expect(r.stderr, name).toBe('sanitize: 2.1.999 holds an entry that is not a regular file where a fixture would go\n');
      expect(r.stderr, name).not.toContain(base);
      expect(r.stdout, name).toBe('');
      expect(fs.readdirSync(out), name).toEqual(['2.1.999']);
      expect(fs.readdirSync(path.join(out, '2.1.999')), name).toEqual(['clean.json']);
      expect(fs.readdirSync(base).sort(), name).toEqual(name === 'a directory' ? ['fix'] : ['elsewhere', 'fix']); // and no temp sibling is left behind
    }
  });

  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  it.skipIf(isRoot)('a destination it cannot look at is not an absent one: the run stops with its fixed line and nothing is moved (F13)', () => {
    // mode 0200: writable (the writability pre-check passes) but not searchable, so looking at `clean.json` inside it is EACCES
    const { r, base } = halfMove((out) => fs.chmodSync(path.join(out, '2.1.999'), 0o200), (out) => fs.chmodSync(path.join(out, '2.1.999'), 0o755));
    expect(r.status).toBe(1);
    expect(r.stderr).toBe('sanitize: internal error (no detail printed)\n');
    expect(r.stderr).not.toContain(base);
    expect(fs.readdirSync(base)).toEqual(['fix']); // no temp sibling is left behind
  });

  // N2: a version directory that is a symbolic link is refused (lstat, not stat), before any version moves. Followed, a link
  // onto another filesystem half-moves (EXDEV on the second rename) and a link on this one writes outside the fixtures directory.
  it('refuses a symbolic link where a version directory would go, before any version moves: to a directory and dangling (N2)', () => {
    const shapes: Array<[string, (out: string, base: string) => void]> = [
      ['a link to a directory', (out, base) => { fs.mkdirSync(path.join(base, 'target')); fs.rmdirSync(path.join(out, '2.1.999')); fs.symlinkSync(path.join(base, 'target'), path.join(out, '2.1.999')); }],
      ['a dangling link', (out, base) => { fs.rmdirSync(path.join(out, '2.1.999')); fs.symlinkSync(path.join(base, 'no-such-target'), path.join(out, '2.1.999')); }],
    ];
    for (const [name, plant] of shapes) {
      const { r, out, base } = halfMove(plant);
      expect(r.status, name).toBe(1);
      expect(r.stderr, name).toBe('sanitize: 2.1.999 in the fixtures directory is a symbolic link\n');
      expect(r.stderr, name).not.toContain(base);
      expect(r.stdout, name).toBe('');
      expect(fs.readdirSync(out), name).toEqual(['2.1.999']);
      expect(fs.lstatSync(path.join(out, '2.1.999')).isSymbolicLink(), name).toBe(true);
      if (name === 'a link to a directory') expect(fs.readdirSync(path.join(base, 'target')), 'the link target received nothing').toEqual([]);
      expect(fs.readdirSync(base).sort(), name).toEqual(name === 'a link to a directory' ? ['fix', 'target'] : ['fix']); // and no temp sibling is left behind
    }
  });

  it.skipIf(isRoot)('a version directory that exists but cannot be written is refused before any version moves (M2)', () => {
    const { r, base } = halfMove((out) => fs.chmodSync(path.join(out, '2.1.999'), 0o555), (out) => fs.chmodSync(path.join(out, '2.1.999'), 0o755));
    expect(r.status).toBe(1);
    expect(r.stderr).toBe('sanitize: 2.1.999 in the fixtures directory is not writable\n');
    expect(r.stderr).not.toContain(base);
    expect(r.stdout).toBe('');
    expect(fs.readdirSync(base)).toEqual(['fix']); // no temp sibling is left behind
  });

  it.skipIf(isRoot)('a fixtures directory that cannot be written, when a version directory has to be created in it, is refused before any version moves (M2)', () => {
    const raw = mkTmp('ccrc-dlg-raw.');
    const base = mkTmp('ccrc-dlg-fixbase-');
    const out = path.join(base, 'fix');
    fs.mkdirSync(path.join(out, '2.1.998'), { recursive: true }); // writable, and present: it would take its file
    rawBundle(raw, ROOT, '2.1.998', 'clean', [['Stop', 1, { hook_event_name: 'Stop' }]]);
    rawBundle(raw, ROOT, '2.1.999', 'clean', [['Stop', 1, { hook_event_name: 'Stop' }]]); // absent: its directory cannot be created
    fs.chmodSync(out, 0o555);
    try {
      const r = sanitize(raw, out);
      expect(fs.readdirSync(path.join(out, '2.1.998')), 'the earlier version received nothing').toEqual([]);
      expect(r.status).toBe(1);
      expect(r.stderr).toBe('sanitize: the fixtures directory is not writable\n');
      expect(r.stderr).not.toContain(base);
    } finally { fs.chmodSync(out, 0o755); }
    expect(fs.readdirSync(base)).toEqual(['fix']); // no temp sibling is left behind
  });

  it('a second run into a fixtures directory that already holds the corpus replaces its files and exits 0 (M3: a regular file is a destination)', () => {
    const raw = mkTmp('ccrc-dlg-raw.');
    const base = mkTmp('ccrc-dlg-fixbase-');
    const out = path.join(base, 'fix');
    const d = rawBundle(raw, ROOT, '2.1.999', 'clean', [['Stop', 1, { hook_event_name: 'Stop' }]]);
    const first = sanitize(raw, out);
    expect(first.status, first.stderr).toBe(0);
    const before = fs.readFileSync(path.join(out, '2.1.999', 'clean.json'), 'utf8');
    fs.writeFileSync(path.join(d, 'notes'), 'a note\n');
    const second = sanitize(raw, out);
    expect(second.status, second.stderr).toBe(0);
    expect(second.stderr).toBe('');
    const after = JSON.parse(fs.readFileSync(path.join(out, '2.1.999', 'clean.json'), 'utf8'));
    expect(after.notes).toEqual(['a note']);
    expect(JSON.parse(before).notes).toEqual([]);
    expect(fs.readdirSync(base)).toEqual(['fix']); // no temp sibling is left behind
  });

  it('an I/O failure prints one fixed line, never the exception or a raw path', () => {
    const missing = path.join(mkTmp('ccrc-dlg-raw.'), 'no-such-raw-root');
    const out = mkTmp('ccrc-dlg-fix-');
    const r = sanitize(missing, out);
    expect(r.status).toBe(1);
    expect(r.stderr).toBe('sanitize: internal error (no detail printed)\n');
    expect(r.stdout).toBe('');
  });

  it('refuses missing arguments with exit 2, and a surplus one, and an empty one (m4)', () => {
    const run = (...a: string[]): number | null => spawnSync(process.execPath, [SANITIZE, ...a], { encoding: 'utf8' }).status;
    const raw = mkTmp('ccrc-dlg-raw.');
    const out = path.join(mkTmp('ccrc-dlg-fix-'), 'fix');
    expect(run()).toBe(2);
    expect(run(raw), 'ONE argument').toBe(2);
    expect(run(raw, out, 'extra'), 'THREE arguments').toBe(2);
    expect(run('', out), 'an empty raw root').toBe(2);
    expect(run(raw, ''), 'an empty fixtures directory').toBe(2);
    expect(fs.existsSync(out), 'nothing was written').toBe(false);
  });

  // F9 (review 296): `--scan <fixtures-dir>` applies the sanitiser's OWN scan (the same residue() over every string value and every
  // key, the same pointers) to committed fixture JSON, and writes nothing. The corpus is clean, so only a PLANTED residue shows
  // that the scan bites; the build-matrix block's corpus row runs it over the committed directory.
  const CORPUS = path.resolve(__dirname, 'fixtures/delegation');
  const scanRun = (...args: string[]): { status: number | null; stdout: string; stderr: string } => {
    const r = spawnSync(process.execPath, [SANITIZE, ...args], { encoding: 'utf8' });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  /** Every path under `d` with its size (a directory is `d`), so a row can show a scan left the tree as it found it. */
  const snap = (d: string): string => JSON.stringify(fs.readdirSync(d, { recursive: true }).map(String).sort().map((n) => [n, fs.statSync(path.join(d, n)).isDirectory() ? 'd' : fs.statSync(path.join(d, n)).size]));
  const jsonCount = (v: unknown): { strings: number; keys: number } => {
    if (typeof v === 'string') return { strings: 1, keys: 0 };
    const kids = Array.isArray(v) ? v : v !== null && typeof v === 'object' ? Object.values(v) : [];
    const own = v !== null && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).length : 0;
    return kids.reduce((a: { strings: number; keys: number }, k) => { const c = jsonCount(k); return { strings: a.strings + c.strings, keys: a.keys + c.keys }; }, { strings: 0, keys: own });
  };
  /** A temp fixtures directory holding a copy of one COMMITTED fixture (the newest version's agent-plain), after `plant` changed it.
   *  `where` is how `--scan` names that file: `<version>/#<index>`, never its name (m3). */
  const plantedCorpus = (plant: (f: Record<string, any>) => void): { base: string; dir: string; v: string; where: string; f: Record<string, any> } => {
    const versions = fs.readdirSync(CORPUS).filter((n) => /^[0-9]+\.[0-9]+\.[0-9]+$/.test(n)).sort();
    const v = versions[versions.length - 1] as string;
    const f = JSON.parse(fs.readFileSync(path.join(CORPUS, v, 'agent-plain.json'), 'utf8')) as Record<string, any>;
    plant(f);
    const base = mkTmp('ccrc-dlg-scan-');
    const dir = path.join(base, 'fix');
    fs.mkdirSync(path.join(dir, v), { recursive: true });
    fs.writeFileSync(path.join(dir, v, 'agent-plain.json'), `${JSON.stringify(f, null, 1)}\n`);
    return { base, dir, v, where: `${v}/#0`, f };
  };

  it('--scan of an unplanted copy of a committed fixture is clean, writes nothing, and reports what it read: its strings and keys, counted independently (F9)', () => {
    const { base, dir, f } = plantedCorpus(() => {});
    const before = snap(base);
    const r = scanRun('--scan', dir);
    const n = jsonCount(f);
    expect(n.strings).toBeGreaterThan(50);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe(`sanitize: scanned 1 file(s), ${n.strings} string(s), ${n.keys} key(s): no residue\n`);
    expect(r.stderr).toBe('');
    expect(snap(base)).toBe(before);
  });

  it.each([['a foreign path', 'x /opt/acme/x'], ['a munged foreign path', 'x -mnt-data-x']])('--scan names the file and the pointer of %s planted in one string value of a committed fixture: exit 1, the value never printed, nothing written (F9)', (_name, bad) => {
    const { base, dir, where } = plantedCorpus((f) => { f.events[0].payload.cwd = bad; });
    const before = snap(base);
    const r = scanRun('--scan', dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toBe(`sanitize: residue in ${where} /events/0/payload/cwd\n`);
    expect(r.stdout).toBe('');
    expect(snap(base)).toBe(before);
  });

  // The index is the file's place among its directory's `*.json` REGULAR FILES in CODE-UNIT order (the order `LC_ALL=C ls` gives over
  // them; an entry that is not a regular file is not counted: the F6 rows below). Every one of a version's
  // fixtures is copied in with residue planted under a key that names it, so each finding pairs an index with a file: an index
  // taken in another order (a locale's punctuation-blind order swaps `wf-iso-resume.json` and `wf-iso.json`: `-` < `.` by code
  // unit), or a fixed one, misnames a file. Deleting `jsonIn`'s `.sort()` is an EQUIVALENT mutant under Node: `readdirSync`
  // already returns names in `strcmp` order (libuv sorts scandir; measured: `ls -U` lists the same directory otherwise), so no
  // row can red it; the `.sort()` states the order the index promises (per-task re-review n1/n2 and re-review 2 m2).
  it('--scan names a file by its place in the code-unit-sorted list of its directory: every fixture of a version, each planted, pairs index and file exactly (F9)', () => {
    const { dir, v } = plantedCorpus(() => {});
    const names = fs.readdirSync(path.join(CORPUS, v)).filter((n) => n.endsWith('.json'));
    expect(names.length).toBeGreaterThanOrEqual(14);
    const sorted = [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const n of names) {
      const f = JSON.parse(fs.readFileSync(path.join(CORPUS, v, n), 'utf8')) as Record<string, any>;
      f[`p_${n.slice(0, -'.json'.length)}`] = 'x /opt/acme/x';
      fs.writeFileSync(path.join(dir, v, n), `${JSON.stringify(f, null, 1)}\n`);
    }
    expect(sorted.indexOf('wf-iso-resume.json')).toBeLessThan(sorted.indexOf('wf-iso.json'));
    const r = scanRun('--scan', dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toBe(sorted.map((n, i) => `sanitize: residue in ${v}/#${i} /p_${n.slice(0, -'.json'.length)}\n`).join(''));
  });

  // Review 304 F6 (wording, as the code behaves): the index counts the directory's `*.json` entries that are REGULAR FILES. An entry of that
  // name that is not one (a directory, a dangling link) is neither counted nor named, so a later file keeps the index `ls` would not give it.
  it('--scan skips a `*.json` entry that is not a regular file, uncounted and unnamed: a later file keeps its index among the regular files (review 304 F6)', () => {
    const { dir, v } = plantedCorpus(() => {});
    const vdir = path.join(dir, v);
    fs.mkdirSync(path.join(vdir, 'a-dir.json'));                                  // sorts before agent-plain.json
    fs.symlinkSync(path.join(vdir, 'no-such-target'), path.join(vdir, 'ab-link.json'));   // a dangling link, sorts before it too
    const clean = scanRun('--scan', dir);
    expect(clean.status, clean.stderr).toBe(0);
    expect(clean.stdout).toMatch(/^sanitize: scanned 1 file\(s\), /);
    expect(clean.stderr).toBe('');
    fs.writeFileSync(path.join(vdir, 'zz.json'), `${JSON.stringify({ p: 'x /opt/acme/x' })}\n`);
    const r = scanRun('--scan', dir);
    expect(r.status).toBe(1);
    expect(r.stderr, 'agent-plain.json is #0 and zz.json #1: the two skipped entries are not counted').toBe(`sanitize: residue in ${v}/#1 /p\n`);
  });

  // Review 304 F6, the header's "a stat, so a link to one counts": `jsonIn` stats each `*.json` entry, so a symbolic link to a regular file is
  // a file of its directory, counted in the index and READ. With an lstat the link would be skipped, and residue behind it would pass unread.
  it('--scan counts a link to a regular file and reads it: residue behind the link is named by the link\'s index among the regular files (review 304 F6)', () => {
    const { base, dir, v } = plantedCorpus(() => {});
    const target = path.join(base, 'target.json');
    fs.writeFileSync(target, `${JSON.stringify({ p: 'fine' })}\n`);
    fs.symlinkSync(target, path.join(dir, v, 'zz-link.json'));
    const clean = scanRun('--scan', dir);
    expect(clean.status, clean.stderr).toBe(0);
    expect(clean.stdout, 'agent-plain.json and the link').toMatch(/^sanitize: scanned 2 file\(s\), /);
    fs.writeFileSync(target, `${JSON.stringify({ p: 'x /opt/acme/x' })}\n`);
    const r = scanRun('--scan', dir);
    expect(r.status).toBe(1);
    expect(r.stderr, 'agent-plain.json is #0 and the link #1').toBe(`sanitize: residue in ${v}/#1 /p\n`);
  });

  // Review 304 F6, the header's "one in the top directory is judged as a version directory": a directory named `*.json` in the TOP directory
  // is not skipped as a non-file (`jsonIn` drops it) but read as a version directory, whose name fails VERSION: a finding, named by index.
  it('--scan judges a directory named `*.json` in the top directory as a version directory: a finding named by index, never skipped (review 304 F6)', () => {
    const { dir, v } = plantedCorpus(() => {});
    fs.mkdirSync(path.join(dir, 'a.json'));
    const r = scanRun('--scan', dir);
    expect(r.status).toBe(1);
    expect(r.stderr, `${v} is #0 among the directories and a.json #1: no name printed`).toBe('sanitize: residue in #1 (version directory name)\n');
  });

  it('--scan reads KEYS too: a residue-bearing key of a committed fixture is named by index, never by its text (F9)', () => {
    const { dir, where } = plantedCorpus((f) => { f.extra = { '-mnt-data-x': 'v', '/opt/acme/x': 'w' }; });
    const r = scanRun('--scan', dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toBe(`sanitize: residue in ${where} /extra/#0 (key)\nsanitize: residue in ${where} /extra/#1 (key)\n`);
  });

  it('--scan reads the matrix.json at the top of the fixtures directory as well as the version directories (F9)', () => {
    const m = JSON.parse(fs.readFileSync(path.join(CORPUS, 'matrix.json'), 'utf8')) as { scenarios: string[] };
    m.scenarios[0] = 'x /opt/acme/x';
    const dir = mkTmp('ccrc-dlg-scan-');
    fs.writeFileSync(path.join(dir, 'matrix.json'), JSON.stringify(m));
    const r = scanRun('--scan', dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toBe('sanitize: residue in #0 /scenarios/0\n');
    expect(r.stderr).not.toContain('matrix');
  });

  it('--scan fails closed on a fixture file that is not JSON: a finding, not a skipped file (F9)', () => {
    const { dir } = plantedCorpus(() => {});
    const v = fs.readdirSync(dir)[0] as string;
    fs.writeFileSync(path.join(dir, v, 'broken.json'), '{"notes": ["/opt/acme/x"');
    const r = scanRun('--scan', dir);
    expect(r.status).toBe(1);
    // sorted: agent-plain.json (#0), broken.json (#1): the unreadable file is named by index, never by its name (m3)
    expect(r.stderr).toBe(`sanitize: residue in ${v}/#1 (unreadable JSON)\n`);
    expect(r.stderr).not.toContain('acme');
    expect(r.stderr).not.toContain('broken');
  });

  it('--scan fails closed on a directory that is not a version and on a fixture file whose name is not a name: named by index, never by text (F9)', () => {
    const { dir } = plantedCorpus(() => {});
    const v = fs.readdirSync(dir)[0] as string;
    fs.mkdirSync(path.join(dir, 'latest'));
    fs.writeFileSync(path.join(dir, v, 'Bad_Name.json'), '{}');
    const r = scanRun('--scan', dir);
    expect(r.status).toBe(1);
    // sorted: `2.1.x` (the version) comes before `latest`; Bad_Name sorts before agent-plain
    expect(r.stderr).toContain('sanitize: residue in #1 (version directory name)\n');
    expect(r.stderr).toContain(`sanitize: residue in ${v}/#0 (fixture file name)\n`);
    expect(r.stderr).not.toContain('latest');
    expect(r.stderr).not.toContain('Bad_Name');
  });

  // Review 296 m3: `main` refuses a scenario name on `!NAME.test(s) || residue(s)`; `--scan` judges a fixture file's name the same way, so a
  // name that fits NAME's shape but carries residue is a finding named by index, and the file's body is not read (as `main` does not
  // read a refused bundle).
  it('--scan refuses a fixture file whose name passes the shape test but carries residue, named by index and never by its text (m3)', () => {
    const { dir, v } = plantedCorpus(() => {});
    fs.renameSync(path.join(dir, v, 'agent-plain.json'), path.join(dir, v, '-home-someone-else.json'));
    expect(path.basename('-home-someone-else.json', '.json')).toMatch(/^[a-z0-9-]{1,40}$/);
    const clean = scanRun('--scan', dir);
    expect(clean.status).toBe(1);
    expect(clean.stderr).toBe(`sanitize: residue in ${v}/#0 (fixture file name)\n`);
    expect(clean.stderr).not.toContain('someone-else');
    // with residue in the body as well, the name is still the ONE finding: the body of a refused name is not scanned or printed
    const planted = plantedCorpus((f) => { f.events[0].payload.cwd = 'x /opt/acme/x'; });
    fs.renameSync(path.join(planted.dir, v, 'agent-plain.json'), path.join(planted.dir, v, '-home-someone-else.json'));
    const both = scanRun('--scan', planted.dir);
    expect(both.status).toBe(1);
    expect(both.stderr).toBe(`sanitize: residue in ${v}/#0 (fixture file name)\n`);
  });

  it('--scan of a directory with nothing to scan fails (a mistyped path must not pass): exit 1, one fixed line (F9)', () => {
    const dir = mkTmp('ccrc-dlg-scan-');
    fs.writeFileSync(path.join(dir, 'README.md'), 'not json\n');
    fs.mkdirSync(path.join(dir, '2.1.999'));
    const r = scanRun('--scan', dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toBe('sanitize: nothing to scan in the fixtures directory\n');
    expect(r.stdout).toBe('');
  });

  it('--scan of a path that is not a readable directory prints the one fixed line, never the exception or the path (F9)', () => {
    const missing = path.join(mkTmp('ccrc-dlg-scan-'), 'no-such-fixtures-dir');
    const r = scanRun('--scan', missing);
    expect(r.status).toBe(1);
    expect(r.stderr).toBe('sanitize: internal error (no detail printed)\n');
    expect(r.stdout).toBe('');
  });

  it('--scan refuses a missing directory argument and a surplus one with exit 2 (F9)', () => {
    expect(scanRun('--scan').status).toBe(2);
    expect(scanRun('--scan', mkTmp('ccrc-dlg-scan-'), 'extra').status).toBe(2);
    expect(scanRun('--scan', mkTmp('ccrc-dlg-scan-'), mkTmp('ccrc-dlg-scan-')).status).toBe(2);
  });

  // Review 304 F5: `--scan ''` passed the argument check, reached `readdirSync('')` and printed the internal-error line, so a usage
  // error and an I/O fault gave the same answer. An empty directory argument is a usage error, as `--scan` alone and main mode's empty one are.
  it('--scan refuses an EMPTY directory argument with exit 2 and the usage text, not the internal-error line (review 304 F5)', () => {
    const USAGE = 'usage: node sanitize.mjs <raw-root> <fixtures-dir>\n       node sanitize.mjs --scan <fixtures-dir>\n';
    const empty = scanRun('--scan', '');
    expect(empty.status).toBe(2);
    expect(empty.stderr).toBe(USAGE);
    expect(empty.stdout).toBe('');
    expect(scanRun('--scan').stderr, 'the same text a missing argument gets').toBe(USAGE);
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

  it('a probe whose label merely contains "timeout" is still an outcome (FAIL_NOTE is anchored to rig.sh\'s own note shapes)', () => {
    const fix = mkTmp('ccrc-dlg-mx-');
    const scen = mkTmp('ccrc-dlg-sc-');
    fs.writeFileSync(path.join(scen, 'probe.json'), '{}');
    fs.mkdirSync(path.join(fix, '2.1.9'), { recursive: true });
    fs.writeFileSync(path.join(fix, '2.1.9', 'probe.json'), JSON.stringify(fixture({
      version: '2.1.9', scenario: 'probe', notes: ['probe ["x-timeout"]: not reached', 'dialog answered: no ready prompt?'], events: [ev(1, 'SessionStart', { session_id: 'S' })],
    })));
    const r = build([fix, scen]);
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).cells['2.1.9/probe']).toMatchObject({ status: 'measured', probesMissed: ['x-timeout'] });
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

  // shaped()'s remaining clauses (D-4009). Each fixture below is otherwise MEASURABLE (one parseable event, no failure note), so
  // a clause that stops refusing lets the builder reach the field and either crash on it or return a measured cell of garbage.
  const live = [ev(1, 'SessionStart', { session_id: 'S' })];
  const diskOf = (over: Record<string, unknown>): Record<string, unknown> =>
    ({ admin: {}, worktreesLeft: [], branches: [], worktreeList: '', metas: {}, snapshots: {}, ...over });
  // `undefined` is a MISSING key: JSON.stringify drops it. null and 'x' (a string, which Object.entries/values and [...] and .length
  // all accept without crashing) tell the `!== null` clauses from the `typeof … === 'object'` and Array.isArray ones.
  // [field, the fixture over-rides for one value of it, the values that are not the right shape, a value that is].
  const shapedCases: Array<[string, (v: unknown) => Record<string, unknown>, unknown[], unknown]> = [
    ['notes', (v) => ({ notes: v }), ['x', null, undefined], []],
    ['labels', (v) => ({ labels: v }), ['x', null, undefined], []],
    ['disk', (v) => ({ disk: v }), [null, undefined, 'x'], diskOf({})],
    ['disk.admin', (v) => ({ disk: diskOf({ admin: v }) }), [null, undefined, 'x'], {}],
    ['disk.worktreesLeft', (v) => ({ disk: diskOf({ worktreesLeft: v }) }), ['x', null, undefined], []],
    ['disk.metas', (v) => ({ disk: diskOf({ metas: v }) }), [null, undefined, 'x'], {}],
  ];

  it('each shaped() row\'s fixture, with the right shape in the field, is measured (so no row can pass for another reason)', () => {
    for (const [field, mk, , good] of shapedCases) expect(one(fixture({ events: live, ...mk(good) })).cell.status, field).toBe('measured');
  });

  it.each(shapedCases)('a fixture whose %s is missing, null or mistyped is unreadable, not a measured cell and not a crash', (field, mk, bads) => {
    for (const bad of bads) {
      expect(one(fixture({ events: live, ...mk(bad) })).cell, `${field} = ${bad === undefined ? '(missing)' : JSON.stringify(bad)}`).toEqual({ status: 'unmeasured', reason: 'fixture unreadable' });
    }
  });

  // FAIL_NOTE (F9): the notes rig.sh writes when a run did not go as scripted. Every row below is fed from rig.sh's OWN text, never a
  // hand copy: the `note "…"` calls are read out of it, their shell expansions substituted, and each note goes through the builder.
  /** The raw template (between the quotes) of every `note "…"` call in text, in source order. A `$(…)` inside a template may quote. */
  function noteTemplates(text: string): string[] {
    const found: string[] = [];
    const re = /\bnote "/g;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const start = m.index + m[0].length;
      let i = start;
      let depth = 0;
      for (; i < text.length; i += 1) {
        const c = text[i];
        if (c === '\\') { i += 1; continue; }
        if (depth === 0 && c === '"') break;
        if (c === '$' && text[i + 1] === '(') { depth += 1; i += 1; continue; }
        if (depth > 0 && c === ')') { depth -= 1; continue; }
        if (depth > 0 && c === '"') { for (i += 1; i < text.length && text[i] !== '"'; i += 1) if (text[i] === '\\') i += 1; }
      }
      if (i >= text.length) throw new Error('rig.sh: a note "… never closes');
      // the call must end there: a second argument would be one more string `note` joins and this scan would not see
      if (!/^[ \t]*(?:[;&|)}]|\n|$)/.test(text.slice(i + 1))) throw new Error(`rig.sh: a note call continues after its first string: ${text.slice(start, i)}`);
      found.push(text.slice(start, i));
      re.lastIndex = i + 1;
    }
    return found;
  }
  /** rig.sh's note calls and its `note` call sites (not the `note()` definition, not a comment line): the two must agree. */
  const rigNoteScan = (): { templates: string[]; sites: number } => {
    const code = fs.readFileSync(RIGSH, 'utf8').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    return { templates: noteTemplates(code), sites: (code.match(/\bnote\b(?!\()/g) ?? []).length };
  };
  /** The non-comment rig.sh lines that name the notes file and are not one of its two known touches: `note()`'s own definition (the one
   *  writer) and collect's `cp` of it into the bundle. A note written there by any other route (a printf, an echo, a tee) would reach
   *  the fixtures without passing the `note "…"` census, so it is a line to decide on here. */
  const strayNoteWriters = (): string[] => fs.readFileSync(RIGSH, 'utf8').split('\n')
    .filter((l) => !/^\s*#/.test(l) && /\/notes\b/.test(l))
    .filter((l) => !/^note\(\) \{ printf '%s\\n' "\$\*" >> "\$RUN_R\/notes"; \}$/.test(l)
      && !/^\s*if \[\[ -f \$RUN_R\/notes \]\]; then cp "\$RUN_R\/notes" "\$O\/notes"; else : > "\$O\/notes"; fi$/.test(l));
  /** One template as rig.sh would print it. Every expansion in a note is decided here; one this does not know throws. */
  function concreteNote(template: string, v: { waitLabels?: string; probeLabels?: string; dialog?: string; verb?: string } = {}): string {
    const known: Record<string, string> = {
      'jq -c .waitLabels <<<"$step"': v.waitLabels ?? '["x","y"]',
      'jq -c .probeLabels <<<"$step"': v.probeLabels ?? '["r1-resumed"]',
      'jq -r .answerDialog <<<"$step"': v.dialog ?? 'Background work is running',
    };
    if (template.includes('\\')) throw new Error(`rig.sh note carries a backslash this test does not unescape: ${template}`);
    return template.replace(/\$\(([^)]*)\)|\$(\w+)/g, (_m, cmd: string | undefined, name: string | undefined) => {
      if (cmd !== undefined) {
        const val = known[cmd];
        if (val === undefined) throw new Error(`rig.sh note expands a command this test has no value for: $(${cmd})`);
        return val;
      }
      if (name !== 'verb') throw new Error(`rig.sh note expands a variable this test has no value for: $${name}`);
      return v.verb ?? 'bogus';
    });
  }
  // The decision, made once: an OUTCOME is a note about something the run observed (a probe that was not reached, a dialog that was
  // answered); every other note says the run did not go as scripted. A new note in rig.sh with neither shape reads as a failure here.
  const isOutcome = (template: string): boolean => template.startsWith('probe ') || template.startsWith('dialog answered: ');
  // The collection-time lists below must never throw (a throw would fail the whole file at collection): a note this test cannot read is
  // left out of them, and the first row, which does not catch, is the one that goes red naming it.
  const scanned = ((): string[] => { try { return rigNoteScan().templates; } catch { return []; } })();
  // The scenarios wait on one label or on two, so a waitLabels note is fed BOTH shapes (a note that names no labels comes out once).
  const LABEL_SHAPES = ['["x"]', '["x","y"]'];
  const readable = (ts: string[]): string[] => [...new Set(ts.flatMap((t) => LABEL_SHAPES.flatMap((waitLabels) => {
    try { return [concreteNote(t, { waitLabels })]; } catch { return []; }
  })))];
  const failureNotes = readable(scanned.filter((t) => !isOutcome(t)));
  const outcomeNotes = readable(scanned.filter(isOutcome));
  const outcomeTemplates = scanned.filter(isOutcome);

  it('rig.sh writes nine notes, every one read here, each decided: two outcomes (a probe, a dialog) and seven failures', () => {
    const { templates, sites } = rigNoteScan();
    expect(templates, 'every `note` in rig.sh reads as a note "…" call this test can parse').toHaveLength(sites);
    const concrete = templates.map((t) => concreteNote(t));
    expect(concrete.every((n) => n.length > 0 && !n.includes('$')), 'every expansion was substituted').toBe(true);
    expect(templates.filter(isOutcome).map((t) => t.split(' ')[0]), 'the outcomes').toEqual(['probe', 'dialog']);
    expect(templates.filter((t) => !isOutcome(t)), 'a new note needs a decision here: an outcome joins isOutcome, a failure joins build-matrix.mjs\'s FAIL_NOTE').toHaveLength(7);
    expect(new Set(concrete).size, 'no two calls write the same note').toBe(concrete.length);
    expect(strayNoteWriters(), 'the notes file is written by note() alone: any other line that names it is a note this census cannot see').toEqual([]);
  });

  // answerDialog (review 296 F2). It is the one verb whose SUCCESS is an outcome note (`dialog answered: …`), and its failure used to leave no
  // note at all: an interrupt-exit run whose dialog never came built `measured` with a SessionEnd count of zero, the same cell as an exit that
  // fired no SessionEnd. These rows run rig.sh's own run_steps over a one-step scenario, `wait_text` stubbed to see the dialog or not, and pass
  // what it actually wrote through the builder: no note text is copied here.
  const answerDialog = (seen: boolean): { notes: string[]; tmux: string[] } => {
    const dir = mkTmp('ccrc-dlg-ans-');
    const scen = path.join(dir, 'scen.json');
    fs.writeFileSync(scen, JSON.stringify({ steps: [{ answerDialog: 'Background work is running', timeoutS: 1 }], entries: [] }));
    const script = ['set -euo pipefail', rigText('SESSION', 'note', 'run_steps'),
      `wait_text() { return ${seen ? 0 : 1}; }`, 'T() { printf \'%s\\n\' "$*" >> "$RUN_R/tmux-calls"; }', 'run_steps'].join('\n');
    const r = spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { ...process.env, RUN_R: dir, SCEN: scen, SOCK: 'dlgx' }, timeout: 60_000 });
    expect(r.status, r.stderr).toBe(0);
    const read = (n: string): string[] => (fs.existsSync(path.join(dir, n)) ? fs.readFileSync(path.join(dir, n), 'utf8').split('\n').filter(Boolean) : []);
    return { notes: read('notes'), tmux: read('tmux-calls') };
  };

  it('answerDialog: a dialog that appears is answered with Enter and noted as an outcome, so the run stays measured', () => {
    const { notes, tmux } = answerDialog(true);
    expect(tmux, 'Enter, once, into the private session').toEqual(['dlgx send-keys -t cc-rig-hookcap Enter']);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/^dialog answered: /);
    expect(one(fixture({ notes, events: live })).cell.status).toBe('measured');
  });

  it('answerDialog: a dialog that never appears sends no key and writes a failure note, so the run is unmeasured and not a measured zero (F2)', () => {
    const { notes, tmux } = answerDialog(false);
    expect(tmux, 'no Enter into a pane that showed no dialog').toEqual([]);
    expect(notes, 'one note').toHaveLength(1);
    expect(notes[0], 'and not the success one').not.toMatch(/^dialog answered/);
    expect(one(fixture({ notes, events: live })).cell).toMatchObject({ status: 'unmeasured', reason: notes[0] });
  });

  // The cost of that else arm, pinned (review C1). An answerDialog step is a promise that its dialog appears: one whose dialog never shows
  // writes a failure note, and every later capture of its scenario builds unmeasured. Four wf-* scenarios once carried a step for a dialog
  // the rig's `Workflow` grant never lets appear (no committed workflow fixture held an answered note). Derived from the committed
  // scenarios and fixtures, over every version directory the corpus has: no list of versions or scenarios here, and the answered note is
  // rig.sh's own `dialog answered: …` template filled with the step's own text.
  it('a scenario carries an answerDialog step only if EVERY committed fixture of it holds that dialog\'s answered note, and interrupt-exit\'s step is answered in every version (C1)', () => {
    const versions = fs.readdirSync(FIX).filter((n) => /^\d+\.\d+\.\d+$/.test(n) && fs.statSync(path.join(FIX, n)).isDirectory()).sort();
    expect(versions.length, 'the corpus has version directories').toBeGreaterThan(0);
    const template = outcomeTemplates.find((t) => t.startsWith('dialog answered: '));
    expect(template, 'rig.sh writes a dialog note').toBeDefined();
    const steps: Array<[string, string]> = [];   // [scenario, the dialog text its step waits for]
    for (const f of fs.readdirSync(SCEN).filter((n) => n.endsWith('.json')).sort()) {
      const s = JSON.parse(fs.readFileSync(path.join(SCEN, f), 'utf8')) as { steps: Array<Record<string, unknown>> };
      for (const st of s.steps) if (typeof st.answerDialog === 'string') steps.push([f.replace(/\.json$/, ''), st.answerDialog]);
    }
    const unanswered: string[] = [];   // `<version>/<scenario>`: a fixture whose notes lack the step's answered note
    const checked = new Map<string, number>();   // scenario -> fixtures read
    for (const [scenario, text] of steps) {
      const want = concreteNote(template as string, { dialog: text });
      for (const v of versions) {
        const file = path.join(FIX, v, `${scenario}.json`);
        if (!fs.existsSync(file)) continue;
        checked.set(scenario, (checked.get(scenario) ?? 0) + 1);
        const notes = (JSON.parse(fs.readFileSync(file, 'utf8')) as { notes?: unknown }).notes;
        if (!Array.isArray(notes) || !notes.includes(want)) unanswered.push(`${v}/${scenario}`);
      }
    }
    expect(unanswered, 'a scenario whose answerDialog step was never answered in a committed fixture would build every capture of it unmeasured').toEqual([]);
    // The converse, so the row cannot pass for want of steps or of fixtures: interrupt-exit has its step, and a fixture of it in every version.
    expect(steps.filter(([s]) => s === 'interrupt-exit'), 'interrupt-exit answers one dialog').toHaveLength(1);
    expect(checked.get('interrupt-exit'), 'and was read in every version directory').toBe(versions.length);
  });

  it('the scanner reads a quoted string inside a $(…), an escaped quote and the end of a call, and refuses a call that goes on', () => {
    // `)` and `"` inside the substitution's own quotes belong to it; a note ends at the first unescaped quote outside any $(…)
    expect(noteTemplates('a || note "x $(jq -r ".k)\\"" <<<"$s") y" ;;\nnote "z"; fi\n')).toEqual(['x $(jq -r ".k)\\"" <<<"$s") y', 'z']);
    expect(noteTemplates('note "a\\"b" ;;')).toEqual(['a\\"b']);
    expect(noteTemplates('note "last"')).toEqual(['last']);
    expect(() => noteTemplates('note "a" "b"')).toThrow(/continues after its first string/);
    expect(() => noteTemplates('note "never closes')).toThrow(/never closes/);
  });

  it.each(failureNotes.map((n) => [n]))('rig.sh writes %j: a run carrying it is unmeasured, with that note as its reason and no question field', (note) => {
    expect(one(fixture({ notes: [note], events: live })).cell).toEqual({ status: 'unmeasured', reason: note, eventsSeen: { SessionStart: 1 } });
  });

  // FAIL_NOTE is anchored at the start only: text after a failure note (a rig.sh that appends a detail to one) leaves it a failure. An end
  // anchor could only turn such a note into "measured", so a failed run's zeros would read as observed.
  it.each(failureNotes.map((n) => [n]))('rig.sh writes %j with text after it: the run is still unmeasured', (note) => {
    const extended = `${note} (x)`;
    expect(one(fixture({ notes: [extended], events: live })).cell).toEqual({ status: 'unmeasured', reason: extended, eventsSeen: { SessionStart: 1 } });
  });

  // A probe note must also be READ (PROBE_NOTE copies its wording too): a reworded one would leave the run measured with probesMissed
  // empty, a missed probe silently recorded as reached.
  it.each(outcomeNotes.map((n) => [n, n.startsWith('probe ') ? ['r1-resumed'] : []] as const))('rig.sh writes %j: an outcome, so the run stays measured (probesMissed %j)', (note, missed) => {
    expect(one(fixture({ notes: [note], events: live })).cell).toMatchObject({ status: 'measured', subagentStarts: 0, probesMissed: missed });
  });

  it.each(failureNotes.map((n) => [n]))('FAIL_NOTE is anchored: %j quoted inside a dialog\'s text or a probe\'s label does not make the run unmeasured', (failure) => {
    const [probe, dialog] = ['probe ', 'dialog answered: '].map((p) => outcomeTemplates.find((t) => t.startsWith(p)));
    expect(probe, 'rig.sh writes a probe note').toBeDefined();
    expect(dialog, 'rig.sh writes a dialog note').toBeDefined();
    const notes = [concreteNote(probe as string, { probeLabels: JSON.stringify([failure]) }), concreteNote(dialog as string, { dialog: failure })];
    // the dialog carries the failure note verbatim; the probe carries it as a JSON label, which is what rig.sh's `jq -c` prints
    expect(notes[0], 'the probe carries it as a label').toContain(JSON.stringify(failure));
    expect(notes[1], 'the dialog carries it as its text').toContain(failure);
    expect(one(fixture({ notes, events: live })).cell).toMatchObject({ status: 'measured', probesMissed: [failure] });
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
    // F9: and the sanitiser's OWN scan (its residue() over every string value and every key, the allowlist and the user and host
    // names included) over every committed fixture AND matrix.json. The directory is READ, never a fixed list, and the count it
    // reports is checked against an independent walk, so a scan that skipped files would not pass for a clean one. The literals
    // above stay as a second net that shares no code with it.
    const jsonOnDisk = fs.readdirSync(FIX, { recursive: true }).map(String).filter((n) => n.endsWith('.json')).length;
    const scanned = spawnSync(process.execPath, [SANITIZE, '--scan', FIX], { encoding: 'utf8' });
    expect(scanned.status, scanned.stderr).toBe(0);
    expect(scanned.stderr).toBe('');
    const stats = /^sanitize: scanned (\d+) file\(s\), (\d+) string\(s\), (\d+) key\(s\): no residue\n$/.exec(scanned.stdout);
    expect(stats, scanned.stdout).not.toBeNull();
    expect(Number(stats?.[1])).toBe(jsonOnDisk);
    expect(jsonOnDisk).toBeGreaterThan(m.versions.length);
    expect(Number(stats?.[2])).toBeGreaterThan(0);
    expect(Number(stats?.[3])).toBeGreaterThan(0);
  });
});

describe('one capture-file-name grammar', () => {
  it('sanitize.mjs\'s CAP_NAME is the same literal as deploy/hook-capture-reduce.mjs\'s', () => {
    const grammar = (file: string): string[] => [...fs.readFileSync(file, 'utf8').matchAll(/^const CAP_NAME = (\/.*\/[a-z]*);$/gm)].map((m) => m[1] as string);
    const a = grammar(path.join(RIG, 'sanitize.mjs'));
    const b = grammar(path.join(TREE, 'deploy/hook-capture-reduce.mjs'));
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a).toEqual(b);
  });
});
