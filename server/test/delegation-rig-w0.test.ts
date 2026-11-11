// The Overlord's W0 spike (plan docs/superpowers/plans/2026-11-10-overlord/w0-spike.md, Tasks 2 and 3): the capture
// rig learns a launch profile, and gains four dependency-free stubs. Hermetic: no row starts Claude Code, names the
// real HOME, or touches any tmux server. The helpers are this file's own, in the shape of delegation-rig.test.ts's
// (whose helpers are not exported).
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { spawnSyncGroup } from './spawnGroup.js';

const RIG = path.resolve(__dirname, 'delegation-rig');
const RIGSH = path.join(RIG, 'rig.sh');

const rigsh = (args: string[], env: NodeJS.ProcessEnv = {}): { status: number | null; stdout: string; stderr: string } => {
  const r = spawnSyncGroup('bash', [RIGSH, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 120_000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};
/** A scenario file at <tmp>/<dir>/<name>.json: `{ steps, entries: [], ...top }`, so `top.steps` replaces `steps`. */
function scen(dir: string, name: string, steps: object[], top: object = {}): string {
  const d = path.join(mkTmp('ccrc-dlg-w0-'), dir);
  fs.mkdirSync(d, { recursive: true });
  const f = path.join(d, `${name}.json`);
  fs.writeFileSync(f, JSON.stringify({ steps, entries: [], ...top }));
  return f;
}
/** A single-quoted space-separated list defined once in rig.sh, read from its source and never restated here. */
function rigList(name: string): string[] {
  const m = new RegExp(`^${name}='([^']*)'$`, 'm').exec(fs.readFileSync(RIGSH, 'utf8'));
  return m ? (m[1] as string).split(/\s+/).filter(Boolean) : [];
}
function firstEnvName(): string {
  const n = rigList('RIG_LAUNCH_ENV')[0];
  if (n === undefined) throw new Error('rig.sh defines no RIG_LAUNCH_ENV list');
  return n;
}
/** A fixture HOME holding one executable "installed" build, as delegation-rig.test.ts's versionsHome makes it. */
function versionsHome(version: string): string {
  const home = mkTmp('ccrc-dlg-home-');
  const dir = path.join(home, '.local/share/claude/versions');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, version), '#!/bin/sh\nexit 0\n');
  fs.chmodSync(path.join(dir, version), 0o755);
  return home;
}
let cfg = '';
/** print-launch's line for a scenarios-overlord scenario carrying `launch`; sets `cfg` to that run root's config dir. */
function launchLine(launch: object, top: object = {}): string {
  const f = scen('scenarios-overlord', 'pl', [{ waitReady: 60 }], { launch, ...top });
  const root = path.join(mkTmp('ccrc-dlg-pl-'), 'ccrc-dlg-rig.t');
  cfg = path.join(root, 'fixhome', 'cfg');
  const r = rigsh(['print-launch', '2.1.290', f, root], { HOME: versionsHome('2.1.290') });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout;
}

describe('rig.sh: a scenario may carry a launch profile (W0 Task 2)', () => {
  it('check-scenario accepts a launch block whose flags and env names are on the lists', () => {
    const f = scen('scenarios-overlord', 'ok', [{ waitReady: 60 }],
      { launch: { args: ['--setting-sources', 'project'], env: { [firstEnvName()]: 'x' } }, capS: 600, requests: true });
    expect(rigsh(['check-scenario', f]).status).toBe(0);
  }, 60_000);

  it.each([
    ['a flag off the list', { launch: { args: ['--no-such-flag'] } }],
    ['a value with no flag before it', { launch: { args: ['project'] } }],
    ['a reserved env name', { launch: { env: { HOME: '/x' } } }],
    ['an ANTHROPIC_ name', { launch: { env: { ANTHROPIC_BASE_URL: 'http://x' } } }],
    ['an env name off the list', { launch: { env: { NOT_ON_THE_LIST: 'x' } } }],
    ['an unknown launch key', { launch: { argv: [] } }],
    ['an absolute file path', { launch: { files: [{ in: 'repo', path: '/etc/x', text: '' }] } }],
    ['a .. segment', { launch: { files: [{ in: 'cfg', path: 'a/../../x', text: '' }] } }],
    ['a file target that is neither cfg nor repo', { launch: { files: [{ in: 'home', path: 'x', text: '' }] } }],
    ['a capS over 5400', { capS: 5401 }],
    ['a capS under 60', { capS: 59 }],
    ['a relaunch mode that is not fresh or fork', { steps: [{ relaunch: { mode: 'other' } }] }],
    ['a sessionsSnap name with a slash', { steps: [{ sessionsSnap: 'a/b' }] }],
  ])('check-scenario refuses %s, exit 2', (_w, top) => {
    expect(rigsh(['check-scenario', scen('scenarios-overlord', 'bad', [{ waitReady: 60 }], top)]).status).toBe(2);
  }, 60_000);

  it('check-scenario accepts the three relaunch forms and a sessionsSnap step', () => {
    const f = scen('scenarios-overlord', 'rl', [{ relaunch: true }, { relaunch: { mode: 'fresh' } }, { relaunch: { mode: 'fork' } },
      { sessionsSnap: 'before-compact' }]);
    expect(rigsh(['check-scenario', f]).status).toBe(0);
  }, 60_000);

  it.each([
    ['the flag', { launch: { args: ['--dangerously-skip-permissions'] } }],
    ['the permission mode', { launch: { args: ['--permission-mode', 'bypassPermissions'] } }],
    ['the settings mode', { launch: { settings: { permissions: { defaultMode: 'bypassPermissions' } } } }],
  ])('a bypass by %s passes in scenarios-overlord and is refused in scenarios', (_w, top) => {
    expect(rigsh(['check-scenario', scen('scenarios-overlord', 'b', [{ waitReady: 60 }], top)]).status).toBe(0);
    expect(rigsh(['check-scenario', scen('scenarios', 'b', [{ waitReady: 60 }], top)]).status).toBe(2);
  }, 60_000);

  it('no file in the delegation corpus names a bypass flag', () => {
    for (const f of fs.readdirSync(path.join(RIG, 'scenarios')))
      expect(fs.readFileSync(path.join(RIG, 'scenarios', f), 'utf8')).not.toMatch(/skip-permissions|bypassPermissions/);
  });

  it('launch_cmd quotes a launch value and substitutes only the five placeholders', () => {
    const line = launchLine({ args: ['--settings', '@RIG_CFG@/p.json; touch x'], env: { [firstEnvName()]: 'a b; touch y' } });
    expect(line).toContain(`${cfg}/p.json\\;\\ touch\\ x`);
    expect(line).toContain(`${firstEnvName()}=a\\ b\\;\\ touch\\ y`);
    expect(line).not.toMatch(/@RIG_[A-Z]+@/);
  }, 60_000);

  it('print-launch carries every checked flag, value and env name onto the command line (Review Focus 1)', () => {
    const env = { [firstEnvName()]: '@RIG_ROOT@/logs/emit.ndjson' };
    const line = launchLine({ args: ['--setting-sources', 'project', '--strict-mcp-config'], env });
    expect(line).toContain(' --setting-sources project --strict-mcp-config');
    expect(line).toContain(`${firstEnvName()}=${path.dirname(path.dirname(cfg))}/logs/emit.ndjson`);
  }, 60_000);

  it('cmd_setup merges launch.settings over the fixture and appends hooks, so ccrc\'s own hook stays; files land under cfg and repo', () => {
    launchLine({
      settings: { env: { W0_X: '1' }, hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node @RIG_STUBS@/emit-context.mjs' }] }] } },
      files: [{ in: 'cfg', path: 'skills/w0/SKILL.md', text: 'canary @RIG_REPO@' }, { in: 'repo', path: 'CLAUDE.md', text: 'W0', exec: true }],
    });
    const s = JSON.parse(fs.readFileSync(path.join(cfg, 'settings.json'), 'utf8'));
    expect(s.env).toMatchObject({ DISABLE_AUTOUPDATER: '1', W0_X: '1' });
    const ss = JSON.stringify(s.hooks.SessionStart);
    expect(ss).toContain('/session-hook.sh');
    expect(ss).toContain(`node ${RIG}/stubs/emit-context.mjs`);
    expect(s.permissions.defaultMode).toBe('default');
    const root = path.dirname(path.dirname(cfg));
    expect(fs.readFileSync(path.join(cfg, 'skills/w0/SKILL.md'), 'utf8')).toBe(`canary ${root}/repo`);
    expect(fs.statSync(path.join(root, 'repo/CLAUDE.md')).mode & 0o111).not.toBe(0);
  }, 60_000);

  it('a launch file path may name @RIG_PROJECT@, the project directory Claude Code derives from the fixture repo; cfg2 files wait for swapConfig', () => {
    launchLine({ files: [{ in: 'cfg', path: 'projects/@RIG_PROJECT@/memory/MEMORY.md', text: 'W0-MEM-A' },
      { in: 'cfg2', path: 'projects/@RIG_PROJECT@/memory/MEMORY.md', text: 'W0-MEM-B' }] });
    const root = path.dirname(path.dirname(cfg));
    const project = path.join(root, 'repo').replace(/[^A-Za-z0-9]/g, '-');
    expect(fs.readFileSync(path.join(cfg, 'projects', project, 'memory/MEMORY.md'), 'utf8')).toBe('W0-MEM-A');
    expect(fs.existsSync(path.join(root, 'fixhome/cfg2')), 'cfg2 is written by swapConfig, never at setup').toBe(false);
  }, 60_000);

  it.each([
    ['a placeholder other than @RIG_PROJECT@ in a path', { launch: { files: [{ in: 'cfg', path: 'projects/@RIG_ROOT@/x', text: '' }] } }],
    ['a paneSnap name with a slash', { steps: [{ paneSnap: 'a/b' }] }],
  ])('check-scenario refuses %s, exit 2', (_w, top) => {
    expect(rigsh(['check-scenario', scen('scenarios-overlord', 'bad2', [{ waitReady: 60 }], top)]).status).toBe(2);
  }, 60_000);

  it('check-scenario accepts a paneSnap step and a cfg2 file', () => {
    const f = scen('scenarios-overlord', 'ps', [{ paneSnap: 'after-model' }], { launch: { files: [{ in: 'cfg2', path: 'CLAUDE.md', text: 'x' }] } });
    expect(rigsh(['check-scenario', f]).status).toBe(0);
  }, 60_000);

  it('the usage names print-launch, and the header still ends on its last line', () => {
    const r = rigsh(['bogus']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('rig.sh print-launch <version> <scenario.json> <root>');
    expect(r.stderr).toContain('(and a box with no /proc, where that cannot be measured, keeps them)');
    expect(r.stderr).not.toContain('set -euo pipefail');
  }, 60_000);
});

const STUBS = path.join(RIG, 'stubs');
/** Run one stub with `args`, `stdin` and extra env; stdout and the exit status. */
function runStub(stub: string, args: string[], stdin: string, env: NodeJS.ProcessEnv = {}): { stdout: string; status: number | null } {
  const r = spawnSync(process.execPath, [path.join(STUBS, stub), ...args], { input: stdin, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 30_000 });
  return { stdout: r.stdout, status: r.status };
}
const run = (stub: string, args: string[], stdin: string): string => runStub(stub, args, stdin).stdout;
const runRc = (stub: string, stdin: string): number | null => runStub(stub, [], stdin).status;
/** The door stub fed one JSON-RPC 2.0 request line per call (id = its index), stdin then closed: its replies, in order, and its log. */
async function door(calls: Array<string | [string, object]>, env: NodeJS.ProcessEnv): Promise<{ replies: Array<Record<string, any>>; log: string }> {
  const log = path.join(mkTmp('ccrc-dlg-door-'), 'door.ndjson');
  const input = calls.map((c, id) => {
    const [method, params] = typeof c === 'string' ? [c, {}] : c;
    return JSON.stringify({ jsonrpc: '2.0', id, method, params });
  }).join('\n') + '\n';
  const r = runStub('door-stub.mjs', [], input, { ...env, DOOR_LOG: log });
  return { replies: r.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l)), log: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '' };
}
/** statusline-capture.mjs fed `payload`: its log's last line, parsed. */
function capture(payload: object): Record<string, unknown> {
  const log = path.join(mkTmp('ccrc-dlg-sl-'), 'status.ndjson');
  runStub('statusline-capture.mjs', [], JSON.stringify(payload), { RIG_STATUS_LOG: log });
  const lines = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
  return JSON.parse(lines[lines.length - 1] as string);
}

describe('the rig\'s W0 stubs (W0 Task 3)', () => {
  it('the door stub lists card, read and act, and logs the nonce as present, never its value', async () => {
    const { replies, log } = await door(['initialize', 'tools/list', ['tools/call', { name: 'card', arguments: {} }]],
      { DOOR_NONCE: 'n-7f3a' });
    expect(replies[1]!.result.tools.map((t: { name: string }) => t.name).sort()).toEqual(['act', 'card', 'read']);
    expect(JSON.stringify(replies[2])).toContain('W0-CARD-CANARY');
    expect(log).toContain('"nonce":"present"');
    expect(log).not.toContain('n-7f3a');
  }, 60_000);

  it('the door stub answers read with a record and act with ok, and logs the nonce absent when none is set', async () => {
    const { replies, log } = await door(['initialize', ['tools/call', { name: 'read', arguments: {} }], ['tools/call', { name: 'act', arguments: {} }]], { DOOR_NONCE: '' });
    expect(replies[1]!.result.content[0].text).toBe('{"kind":"record","id":"r-1"}');
    expect(replies[2]!.result.content[0].text).toBe('ok');
    expect(log).toContain('"nonce":"absent"');
  }, 60_000);

  it.each([9951, 10000, 10001, 12000])('emit-context prints exactly %i characters between its canaries', (n) => {
    const t = JSON.parse(run('emit-context.mjs', ['--event', 'SessionStart', '--chars', String(n)], '{"source":"startup"}'))
      .hookSpecificOutput.additionalContext as string;
    expect(t.length).toBe(n);
    expect(t.startsWith(`W0-HEAD-${n}-`) && t.endsWith(`-W0-TAIL-${n}`)).toBe(true);
  }, 60_000);

  it('emit-context\'s wide filler is two UTF-8 bytes a character, and its log names the event and the source', () => {
    const log = path.join(mkTmp('ccrc-dlg-emit-'), 'emit.ndjson');
    const out = runStub('emit-context.mjs', ['--event', 'SessionStart', '--chars', '6000', '--fill', 'wide'], '{"source":"clear"}', { RIG_EMIT_LOG: log }).stdout;
    const t = JSON.parse(out).hookSpecificOutput.additionalContext as string;
    expect(t.length).toBe(6000);
    expect(Buffer.byteLength(t, 'utf8')).toBeGreaterThan(11_900);
    expect(JSON.parse(fs.readFileSync(log, 'utf8').trim())).toMatchObject({ event: 'SessionStart', source: 'clear' });
  }, 60_000);

  it('emit-context --tag-source puts the payload\'s source inside both canaries, so each start is told apart in a request', () => {
    const t = JSON.parse(run('emit-context.mjs', ['--event', 'SessionStart', '--chars', '200', '--tag-source'], '{"source":"compact"}'))
      .hookSpecificOutput.additionalContext as string;
    expect(t.length).toBe(200);
    expect(t.startsWith('W0-HEAD-200-compact-') && t.endsWith('-compact-W0-TAIL-200')).toBe(true);
  }, 60_000);

  it('emit-context --log-payload logs the payload\'s keys, token-like values as they are, and no free text', () => {
    const log = path.join(mkTmp('ccrc-dlg-emit-'), 'emit.ndjson');
    runStub('emit-context.mjs', ['--event', 'PostModelSwitch', '--chars', '100', '--log-payload'],
      JSON.stringify({ model: 'claude-sonnet-5-5', prompt: 'a private sentence', n: 3, cwd: '/w0/x' }), { RIG_EMIT_LOG: log });
    const o = JSON.parse(fs.readFileSync(log, 'utf8').trim());
    expect(o.payload).toEqual({ model: 'claude-sonnet-5-5', prompt: '<string>', n: 3, cwd: '<string>' });
  }, 60_000);

  it('precompact-refuse blocks auto and passes manual', () => {
    expect(runRc('precompact-refuse.mjs', '{"trigger":"auto"}')).toBe(2);
    expect(runRc('precompact-refuse.mjs', '{"trigger":"manual"}')).toBe(0);
  }, 60_000);

  it('statusline capture keeps numbers and key paths, never a string value but the model id', () => {
    const o = capture({ model: { id: 'm-1', display_name: 'private-x' }, cwd: '/w0/cwd/p',
      context_window: { total_input_tokens: 1200, context_window_size: 200000 } });
    expect(o['context_window.total_input_tokens']).toBe(1200);
    expect(o['model.id']).toBe('m-1');
    expect(o['cwd']).toBe('<string>');
    expect(JSON.stringify(o)).not.toMatch(/private-x|\/w0\/cwd/);
  }, 60_000);
});

describe('mockapi.mjs: a padded reply, for W0\'s renewal-time transcripts (W0 Task 5)', () => {
  it('appends exactly `pad` filler characters to an entry\'s text and streams it in `chunk_chars` pieces', async () => {
    const dir = mkTmp('ccrc-dlg-pad-');
    const file = path.join(dir, 'script.json');
    fs.writeFileSync(file, JSON.stringify({ entries: [{ match: 'any', text: 'W0-PAD', pad: 1000, chunk_chars: 100, chunk_ms: 0 }] }));
    const env: NodeJS.ProcessEnv = { ...process.env, MOCK_PORT: '0', MOCK_SCRIPT: file };
    delete env.MOCK_LOG; delete env.MOCK_REQDIR;
    const { spawn } = await import('node:child_process');
    const child = spawn(process.execPath, [path.join(RIG, 'mockapi.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      const port = await new Promise<string>((resolve, reject) => {
        let out = '';
        const t = setTimeout(() => reject(new Error('mock did not start')), 10_000);
        child.stdout!.on('data', (b: Buffer) => { out += b.toString(); const m = /listening 127\.0\.0\.1:(\d+)/.exec(out); if (m) { clearTimeout(t); resolve(m[1] as string); } });
      });
      const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stream: true, model: 'm', tools: [{ name: 'Bash' }], system: 'You are an interactive agent', messages: [{ role: 'user', content: 'x' }] }) });
      const deltas = (await r.text()).split('\n\n').filter((b) => b.includes('text_delta'))
        .map((b) => JSON.parse(b.slice(b.indexOf('data: ') + 6)).delta.text as string);
      expect(deltas.join('').length).toBe('W0-PAD'.length + 1000);
      expect(deltas.join('').startsWith('W0-PAD')).toBe(true);
      expect(deltas).toHaveLength(Math.ceil(1006 / 100));
    } finally { child.kill('SIGKILL'); }
  }, 60_000);
});
