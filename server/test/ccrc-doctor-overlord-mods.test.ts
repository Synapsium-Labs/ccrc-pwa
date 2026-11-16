// Doctor's `overlord-mods` check (Overlord W1 sandbox, Task 7; plan `w1-sandbox.md` question 6, W0-19 and W0b; spec
// §3.6's deny-set note: an installed mod can approve a call the launch profile denies, so doctor checks every account that
// can serve the Overlord). Every rostered home's settings (`settings.json`, and `settings.local.json` where present) and
// its installed plugins are read; an enabled plugin, an installed plugin or a hook that is not ccrc's is a mod. The level
// is the ruled one: FAIL only for an account that can serve the Overlord while a `profiledigest` stands, WARN on every
// other account and while none stands, and a clean home prints nothing of its own. Fixture HOMEs only (`healthy()`).
import { describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { removeTmpFixturesEachTest } from './tmpHelpers.js';
import {
  BASH, CCRC_SRC, CHECKS_SRC, UPSTREAM, doctorEnv, healthy, installDoctorHooks, plantHookRegistration, shq, writeCcrcEnv,
  writeRoster, type RosterEntry,
} from './ccrc-doctorFixture.js';

removeTmpFixturesEachTest();
installDoctorHooks();

const LANE_A: RosterEntry = { id: 'lane-a', exec: { kind: 'generated' }, telemetry: 'anthropic' } as RosterEntry;
const LANE_B: RosterEntry = { id: 'lane-b', exec: { kind: 'generated' }, telemetry: 'anthropic' } as RosterEntry;

/** A healthy box with three rostered homes (`.claude`, `.lane-a`, `.lane-b`), each registering ccrc's hook and nothing else. */
function box(prefix: string): string {
  const home = healthy(prefix);
  writeRoster(home, [UPSTREAM, LANE_A, LANE_B]);
  plantHookRegistration(home, '.lane-a');
  plantHookRegistration(home, '.lane-b');
  return home;
}
function settings(home: string, suffix: string, file = 'settings.json'): Record<string, any> {
  try { return JSON.parse(readFileSync(join(home, suffix, file), 'utf8')) as Record<string, any>; } catch { return {}; }
}
function edit(home: string, suffix: string, f: (s: Record<string, any>) => void, file = 'settings.json'): void {
  const s = settings(home, suffix, file);
  f(s);
  writeFileSync(join(home, suffix, file), JSON.stringify(s));
}
/** A registry row designated as the Overlord: `profiledigest` standing, its account `wrapper`, and optionally a pool set. */
function designate(home: string, wrapper: string, o: { poolset?: boolean } = {}): void {
  const reg = join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  writeFileSync(join(reg, `${wrapper}-overlord.wrapper`), `${wrapper}\n`);
  writeFileSync(join(reg, `${wrapper}-overlord.profiledigest`), `${'a'.repeat(64)}\n`);
  if (o.poolset) writeFileSync(join(reg, `${wrapper}-overlord.poolset`), 'pool-a\n');
}
function check(home: string): { lines: string[]; code: number } {
  const r = spawnSync(BASH, ['-c', `set -uo pipefail\n. ${shq(CCRC_SRC)}\n. ${shq(CHECKS_SRC)}\n_check_overlord-mods`],
    { env: doctorEnv(home), encoding: 'utf8', timeout: 30_000 });
  return { lines: (r.stdout ?? '').split('\n').filter((l) => l !== ''), code: r.status ?? -1 };
}
const verdicts = (r: { lines: string[] }): string[] => r.lines.filter((l) => /^(PASS|WARN|FAIL|SKIP) overlord-mods: /.test(l));

describe('overlord-mods: what a mod is', () => {
  it('a clean box PASSes, naming the homes it read, with no remedy line', () => {
    const r = check(box('ccrc-doctor-om-clean-'));
    expect(r.lines).toStrictEqual(["PASS overlord-mods: 3/3 rostered homes carry no plugin and no hook but ccrc's"]);
    expect(r.code).toBe(0);
  });
  it.each([
    ['an enabled plugin', (h: string) => edit(h, '.lane-a', (s) => { s.enabledPlugins = { 'their-plugin@market': true, 'off@market': false }; }), 'plugin their-plugin@market'],
    ['an installed plugin', (h: string) => { mkdirSync(join(h, '.lane-a', 'plugins'), { recursive: true }); writeFileSync(join(h, '.lane-a', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'kept@market': [] } })); }, 'installed plugin kept@market'],
    ['a foreign hook on PermissionRequest', (h: string) => edit(h, '.lane-a', (s) => { s.hooks.PermissionRequest = [{ hooks: [{ type: 'command', command: 'bash "$HOME/bin/approve.sh"' }] }]; }), 'hook on PermissionRequest'],
    ['a foreign hook on PreToolUse, beside ccrc\'s own', (h: string) => edit(h, '.lane-a', (s) => { s.hooks.PreToolUse[0].hooks.push({ type: 'command', command: 'bash "$HOME/bin/approve.sh"' }); }), 'hook on PreToolUse'],
    ['a hook in settings.local.json', (h: string) => edit(h, '.lane-a', (s) => { s.hooks = { Stop: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] }; }, 'settings.local.json'), 'hook on Stop'],
  ] as const)('%s is a WARN while no profiledigest stands, naming the account and the mod, never the command', (_n, plant, said) => {
    const home = box('ccrc-doctor-om-warn-');
    plant(home);
    const r = check(home);
    expect(verdicts(r)).toHaveLength(1);
    expect(verdicts(r)[0]).toMatch(/^WARN overlord-mods: /);
    expect(verdicts(r)[0]).toContain(`lane-a: ${said}`);
    expect(r.lines.join('\n')).not.toContain('approve.sh');
    expect(r.lines[1]).toMatch(/^ {2}remedy: .*disable or remove/);
    expect(r.code).toBe(2);
  });
  it("ccrc's own hook on every event passes (the delegation-hooks reader, one definition)", () => {
    const r = check(box('ccrc-doctor-om-own-'));
    expect(verdicts(r)[0]).toMatch(/^PASS /);
  });
  it('an unreadable settings file is its own line, never a pass', () => {
    const home = box('ccrc-doctor-om-unread-');
    writeFileSync(join(home, '.lane-a', 'settings.json'), '{ not json');
    const r = check(home);
    expect(verdicts(r)[0]).toMatch(/^WARN /);
    expect(verdicts(r)[0]).toContain('lane-a: settings.json could not be read');
  });
  it('an unreadable installed-plugins file is its own line, never a pass', () => {
    const home = box('ccrc-doctor-om-unread-plugins-');
    mkdirSync(join(home, '.lane-a', 'plugins'), { recursive: true });
    const f = join(home, '.lane-a', 'plugins', 'installed_plugins.json');
    writeFileSync(f, '{}');
    chmodSync(f, 0o000);
    try {
      const r = check(home);
      expect(verdicts(r)[0]).toContain('lane-a: plugins/installed_plugins.json could not be read');
    } finally { chmodSync(f, 0o600); }
  });
});

describe('overlord-mods: the scope (ruled, fix round 2)', () => {
  const plugin = (h: string, suffix: string): void => edit(h, suffix, (s) => { s.enabledPlugins = { 'p@m': true }; });
  it('FAILs on the designated account while a profiledigest stands, and WARNs on the others', () => {
    const home = box('ccrc-doctor-om-fail-');
    plugin(home, '.lane-a'); plugin(home, '.lane-b');
    designate(home, 'lane-a');
    const r = check(home);
    const v = verdicts(r);
    expect(v).toHaveLength(2);
    expect(v[0]).toMatch(/^FAIL overlord-mods: .*lane-a: plugin p@m/);
    expect(v[0]).not.toContain('lane-b');
    expect(v[1]).toMatch(/^WARN overlord-mods: .*lane-b: plugin p@m/);
    expect(r.code).toBe(1);
  });
  it('a clean designated account passes while another account carries a mod (a WARN)', () => {
    const home = box('ccrc-doctor-om-clean-des-');
    plugin(home, '.lane-b');
    designate(home, 'lane-a');
    const r = check(home);
    expect(verdicts(r).map((l) => l.split(':')[0])).toStrictEqual(['WARN overlord-mods']);
    expect(r.code).toBe(2);
  });
  it('a designated row with a pool set reads every account as able to serve it (the doctor does not resolve pools)', () => {
    const home = box('ccrc-doctor-om-poolset-');
    plugin(home, '.lane-b');
    designate(home, 'lane-a', { poolset: true });
    const r = check(home);
    expect(verdicts(r)[0]).toMatch(/^FAIL overlord-mods: .*lane-b: plugin p@m/);
  });
  it('an unreadable settings file on the designated account FAILs', () => {
    const home = box('ccrc-doctor-om-unread-des-');
    writeFileSync(join(home, '.lane-a', 'settings.json'), '[');
    designate(home, 'lane-a');
    expect(verdicts(check(home))[0]).toMatch(/^FAIL overlord-mods: .*lane-a: settings.json could not be read/);
  });
  it('a server box SKIPs', () => {
    const home = box('ccrc-doctor-om-server-');
    plugin(home, '.lane-a');
    writeCcrcEnv(home, 'CCRC_ROLE=server\n');
    const r = check(home);
    expect(verdicts(r)[0]).toMatch(/^SKIP overlord-mods: this box records CCRC_ROLE=server/);
    expect(r.code).toBe(3);
  });
});
