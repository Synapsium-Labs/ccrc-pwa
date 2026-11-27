// The hook's mode (Go core wave 2, Task 9a; spec 2026-11-24 §4). `core/entries.json`'s `hook` row is a MODE, never a verb:
//   - the installer renders `"hook":"go"` into the launcher's table and never `hook` into its `verbs`, so the launcher
//     routes nothing to it and `ccd caps` lists no `go:hook`;
//   - the launcher answers the session-hook installer's one question (`--ccrc-entry-hook-mode`) from that table, the
//     operator's `ccd-go-off` and the binary's digest;
//   - the installer registers the core's command only on `go`, and BOTH commands are the managed hook, so a box that
//     moves between modes ends with exactly one hook per event and no orphan of the other mode.
// Off Windows the tree is installed as windows through the installer's test seam, with a stub for the binary
// (`ccd-core-entry.test.ts` does the same); on Windows the real binary is installed.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkTmp } from './tmpHelpers.js';
import { plantEntryTree, runEntryInstall, spawnEntry } from './entryFixture.js';
import { CORE_GOARCH, coreExe } from './coreBuild.js';
import { ghContainedEnv } from './ccdWsHelpers.js';

const WIN = process.platform === 'win32';
const INSTALLER = path.resolve(__dirname, '../../ccd/install-session-hooks.sh');
const BASH_CMD = 'bash "$HOME/.cc-sessions/session-hook.sh"';
const GO_CMD = '"$HOME/.local/libexec/ccrc/core/ccrc-core" hook';
let home: string;
const entry = () => path.join(home, '.local', 'bin', 'ccd');
const off = () => path.join(home, '.cc-sessions', 'ccd-go-off');
const settings = () => path.join(home, 'cfg', 'settings.json');
const ccd = (argv: string[]) => spawnEntry(entry(), argv, { env: { ...process.env, HOME: home } });
const mode = () => ccd(['--ccrc-entry-hook-mode']);
const table = (): { verbs: string[]; files: Record<string, string>; hook?: string } =>
  JSON.parse(/^CORE_JSON = '(.*)'$/m.exec(fs.readFileSync(entry(), 'utf8'))![1]!) as { verbs: string[]; files: Record<string, string>; hook?: string };

/** Plants the tree with the hook row in go mode on this platform (or, with `hookGo` false, in bash mode everywhere, whatever the
 *  table ships: it ships `windows: go` since Task 9b), installs. */
function install(hookGo: boolean): void {
  plantEntryTree(home);
  const tree = path.join(home, 'ccrc');
  if (!WIN) {
    fs.writeFileSync(path.join(tree, '.ccrc-test-fixture'), '');
    const bin = path.join(tree, 'core', 'bin', `windows-${CORE_GOARCH}`);
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, coreExe('windows')), '#!/bin/sh\necho "core-stub $*"\n', { mode: 0o755 });
  }
  const p = path.join(tree, 'core', 'entries.json');
  const t = JSON.parse(fs.readFileSync(p, 'utf8')) as { entries: Record<string, { mode: Record<string, string> }> };
  t.entries['hook']!.mode = hookGo ? { windows: 'go' } : {};
  fs.writeFileSync(p, JSON.stringify(t, null, 2));
  runEntryInstall(home, WIN ? {} : { CCRC_CORE_PLATFORM: 'windows' });
  fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
}
/** The installer, against the fixture HOME and the launcher installed there. */
const runInstaller = (...args: string[]): void => {
  // ghContainedEnv: the gh, systemd and tmux poisons every ccd test's bash spawn carries (ccd-workspaces' scan), and the
  // Windows fence (pathFence.ts) with them.
  execFileSync('bash', [INSTALLER, ...args, '--homes', path.join(home, 'cfg')],
    { env: ghContainedEnv(home, { ...process.env, HOME: home }, { systemd: true, tmux: true }) });
};
type Hook = { type: string; command: string; timeout?: number };
type Group = { matcher?: string; hooks: Hook[] };
const hooks = (): Record<string, Group[]> => (JSON.parse(fs.readFileSync(settings(), 'utf8')) as { hooks?: Record<string, Group[]> }).hooks ?? {};
/** Every command registered under every event, in order. */
const commands = (): string[] => Object.values(hooks()).flatMap((gs) => gs.flatMap((g) => g.hooks.map((h) => h.command)));
const FOREIGN: Hook = { type: 'command', command: '/home/u/.project-w/foreign.sh' };
beforeEach(() => {
  home = mkTmp('ccrc-hook-mode-');
  fs.mkdirSync(path.join(home, 'cfg'), { recursive: true });
  fs.mkdirSync(path.join(home, 'ccrc-backups'), { recursive: true });
  fs.writeFileSync(settings(), JSON.stringify({ hooks: { SessionStart: [{ hooks: [FOREIGN] }] } }, null, 2));
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

describe('the hook row is a mode, never a verb', () => {
  it('in go mode the table says hook:go and lists only caps as a verb, and `ccd caps` prints no go:hook', () => {
    install(true);
    expect(table().verbs).toEqual(['caps']);
    expect(table().hook).toBe('go');
    expect(Object.keys(table().files)).toEqual([coreExe('windows')]);
    const caps = ccd(['caps']);
    expect(caps.status, caps.stderr).toBe(0);
    expect(caps.stdout).not.toContain('go:hook');
  });
  it('`ccd hook` is no route: it starts bash (a usage refusal), never the core', () => {
    install(true);
    const r = ccd(['hook']);
    expect(r.stdout + r.stderr).not.toContain('core-stub');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/^usage: ccd /m);
  });
  it('a table whose only go row is the hook still lists the one binary, and routes no verb', () => {
    install(true);
    const p = path.join(home, 'ccrc', 'core', 'entries.json');
    const t = JSON.parse(fs.readFileSync(p, 'utf8')) as { entries: Record<string, { mode: Record<string, string> }> };
    t.entries['caps']!.mode = {};
    fs.writeFileSync(p, JSON.stringify(t));
    runEntryInstall(home, WIN ? {} : { CCRC_CORE_PLATFORM: 'windows' });
    expect(table().verbs).toEqual([]);
    expect(table().hook).toBe('go');
    expect(Object.keys(table().files)).toEqual([coreExe('windows')]);
    expect(mode().stdout).toBe('go\n');
  });
  it('with the hook row in bash, no hook key is rendered and the answer is bash', () => {
    install(false);
    expect(table()).not.toHaveProperty('hook');
    expect(mode()).toMatchObject({ status: 0, stdout: 'bash\n' });
  });
});

describe('the launcher answers the installer from the table, ccd-go-off and the binary\'s digest', () => {
  beforeEach(() => install(true));
  it('go', () => { expect(mode()).toMatchObject({ status: 0, stdout: 'go\n' }); });
  it('an empty ccd-go-off, or one naming hook, answers bash; one naming other verbs leaves go', () => {
    fs.writeFileSync(off(), '');
    expect(mode().stdout).toBe('bash\n');
    fs.writeFileSync(off(), 'caps\nhook\n');
    expect(mode().stdout).toBe('bash\n');
    fs.writeFileSync(off(), 'caps\n');
    expect(mode().stdout).toBe('go\n');
  });
  it('a binary that does not match its digest refuses, and never answers go', () => {
    fs.appendFileSync(path.join(home, '.local', 'libexec', 'ccrc', 'core', coreExe('windows')), '\n# changed\n');
    const r = mode();
    expect(r.status).toBe(125);
    expect(r.stdout).not.toContain('go');
    expect(r.stderr).toMatch(/^ccd: refused \(entry-core-digest\): /);
  });
});

describe('the installer registers the command the mode names, and both commands are the managed hook', () => {
  const managed = (): string[] => commands().filter((c) => c !== FOREIGN.command);
  it('go: every managed entry is the core\'s command, PreToolUse carries its matcher, the foreign hook survives', () => {
    install(true);
    runInstaller();
    expect(managed().length).toBe(14);
    expect(new Set(managed())).toEqual(new Set([GO_CMD]));
    expect(hooks()['PreToolUse']).toEqual([{ matcher: '*', hooks: [{ type: 'command', command: GO_CMD, timeout: 600 }] }]);
    expect(hooks()['SessionStart']![0]).toEqual({ hooks: [FOREIGN] });
  });
  it('bash: the bash command everywhere, as before', () => {
    install(false);
    runInstaller();
    expect(managed().length).toBe(14);
    expect(new Set(managed())).toEqual(new Set([BASH_CMD]));
  });
  it('no launcher at all is bash', () => {
    install(true);
    fs.rmSync(entry());
    runInstaller();
    expect(new Set(managed())).toEqual(new Set([BASH_CMD]));
  });
  it('a launcher that refuses (a changed binary) is bash: the installer never registers a core it cannot vouch for', () => {
    install(true);
    fs.appendFileSync(path.join(home, '.local', 'libexec', 'ccrc', 'core', coreExe('windows')), '\n# changed\n');
    runInstaller();
    expect(new Set(managed())).toEqual(new Set([BASH_CMD]));
  });
  it('switching mode both ways converges on one hook per event: no second hook, no orphan, the foreign hook untouched', () => {
    install(true);
    const seen: string[] = [];
    for (const step of ['go', 'bash', 'go', 'bash'] as const) {
      // `ccd-go-off` naming hook is the operator's way back to bash; removing it is the way forward again.
      if (step === 'bash') fs.writeFileSync(off(), 'hook\n'); else fs.rmSync(off(), { force: true });
      runInstaller();
      const want = step === 'go' ? GO_CMD : BASH_CMD;
      expect(new Set(managed()), step).toEqual(new Set([want]));
      expect(managed().length, `${step}: one managed hook per event`).toBe(14);
      expect(hooks()['SessionStart']![0], step).toEqual({ hooks: [FOREIGN] });
      seen.push(step);
      const again = fs.readFileSync(settings(), 'utf8');
      runInstaller();
      expect(fs.readFileSync(settings(), 'utf8'), `${step}: a second run is a byte no-op`).toBe(again);
    }
    expect(seen).toEqual(['go', 'bash', 'go', 'bash']);
  });
  it('--remove takes the core\'s entries out too, and a bash entry beside them, leaving the foreign hook', () => {
    install(true);
    runInstaller();
    // A bash-mode entry left from before the move, added beside the core's.
    const j = JSON.parse(fs.readFileSync(settings(), 'utf8')) as { hooks: Record<string, Group[]> };
    j.hooks['Stop']!.push({ hooks: [{ type: 'command', command: BASH_CMD }] });
    fs.writeFileSync(settings(), JSON.stringify(j));
    runInstaller('--remove');
    expect(commands()).toEqual([FOREIGN.command]);
  });
  it('an upgrade run sweeps the other mode\'s stale hook, including one under an old path', () => {
    install(true);
    const j = JSON.parse(fs.readFileSync(settings(), 'utf8')) as { hooks: Record<string, Group[]> };
    j.hooks['Stop'] = [{ hooks: [{ type: 'command', command: 'bash "$HOME/.old-location/session-hook.sh"' }] }];
    j.hooks['SessionEnd'] = [{ hooks: [{ type: 'command', command: '"/old/libexec/ccrc/core/ccrc-core" hook' }] }];
    fs.writeFileSync(settings(), JSON.stringify(j));
    runInstaller();
    expect(new Set(managed())).toEqual(new Set([GO_CMD]));
    expect(managed().length).toBe(14);
  });
});
