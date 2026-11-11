// The Overlord's W0 spike (plan docs/superpowers/plans/2026-11-10-overlord/w0-spike.md, Tasks 2 and 3): the capture
// rig learns a launch profile, and gains four dependency-free stubs. Hermetic: no row starts Claude Code, names the
// real HOME, or touches any tmux server. The helpers are this file's own, in the shape of delegation-rig.test.ts's
// (whose helpers are not exported).
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

const RIG = path.resolve(__dirname, 'delegation-rig');
const RIGSH = path.join(RIG, 'rig.sh');

const rigsh = (args: string[], env: NodeJS.ProcessEnv = {}): { status: number | null; stdout: string; stderr: string } => {
  const r = spawnSync('bash', [RIGSH, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 120_000 });
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

  it('the usage names print-launch, and the header still ends on its last line', () => {
    const r = rigsh(['bogus']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('rig.sh print-launch <version> <scenario.json> <root>');
    expect(r.stderr).toContain('(and a box with no /proc, where that cannot be measured, keeps them)');
    expect(r.stderr).not.toContain('set -euo pipefail');
  }, 60_000);
});
