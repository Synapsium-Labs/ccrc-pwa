// D-8270 (ruling Q8): the one tmux socket lookup, its TypeScript half. One shared tmux server stays; every tmux call is
// routed through `tmuxCommand` (the spawns) or `tmuxRoute` (the generic executors), reading `<home>/.ccrc/tmux-socket`,
// so moving the fleet to another server is a change of setting. The bash twin and the census are in
// `tmux-socket-census.test.ts`.
import { describe, expect, it, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import {
  TMUX_REFUSE_SH, readTmuxSocketSetting, tmuxCommand, tmuxRoute, tmuxSocketPath, type TmuxSocketSetting,
} from '../../shared/tmux-target.js';

const ptySpawn = vi.hoisted(() => vi.fn(() => ({
  onData: () => ({ dispose: () => {} }), write: () => {}, resize: () => {}, kill: () => {},
})));
vi.mock('node-pty', () => ({ spawn: ptySpawn }));

const ABSENT: TmuxSocketSetting = { kind: 'absent' };
const text = (t: string): TmuxSocketSetting => ({ kind: 'text', text: t });

/** A home whose `.ccrc/tmux-socket` holds `body` (or nothing, when `body` is null). */
function homeWith(body: string | null): string {
  const home = mkTmp('ccrc-tmux-socket-');
  fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  if (body !== null) fs.writeFileSync(path.join(home, '.ccrc', 'tmux-socket'), body);
  return home;
}

describe('D-8270 — tmuxCommand: the default leaves every argv as it was; a socket name leads every call', () => {
  const ARGV = ['has-session', '-t', '=cc-demo:'];

  it('no setting, or an empty first line, is tmux\'s own default server and adds no flag', () => {
    expect(tmuxCommand(ABSENT, ARGV)).toEqual({ file: 'tmux', args: ARGV });
    expect(tmuxCommand(text(''), ARGV)).toEqual({ file: 'tmux', args: ARGV });
  });

  it('a socket name puts `-L <name>` ahead of the call', () => {
    expect(tmuxCommand(text('fleet-a'), ARGV)).toEqual({ file: 'tmux', args: ['-L', 'fleet-a', ...ARGV] });
    expect(tmuxCommand(text('a_B-9'), ['attach'])).toEqual({ file: 'tmux', args: ['-L', 'a_B-9', 'attach'] });
  });

  it('anything that is not a name is refused: tmux is not asked, and the answer is never "can\'t find session"', () => {
    for (const bad of ['../x', 'a b', ' fleet', 'fleet\r', 'x'.repeat(65), '-L', 'a/b']) {
      const c = tmuxCommand(text(bad), ARGV);
      expect(c.file, bad).toBe('sh');
      expect(c.args.slice(0, 2)).toEqual(['-c', TMUX_REFUSE_SH]);
      expect(c.args[2]).toMatch(/^ccrc: tmux was not asked: \.ccrc\/tmux-socket does not hold a socket name/);
    }
    const u = tmuxCommand({ kind: 'unreadable', why: '/h/.ccrc/tmux-socket cannot be read' }, ARGV);
    expect(u).toEqual({ file: 'sh', args: ['-c', TMUX_REFUSE_SH, 'ccrc: tmux was not asked: /h/.ccrc/tmux-socket cannot be read', ...ARGV] });
  });

  it('the refusal really runs: exit 1, the sentence on stderr, nothing a classifier reads as gone', async () => {
    const { realRunner } = await import('../src/exec.js');
    const c = tmuxCommand(text('a b'), ARGV);
    const r = await realRunner(c.file, [...c.args]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: tmux was not asked: /);
    expect(r.stderr).not.toContain("can't find session");
    expect(r.stderr).not.toContain('no server running');
  });

  it('tmuxRoute routes tmux and leaves every other command, and its setting, untouched', () => {
    const read = vi.fn(() => text('fleet-a'));
    expect(tmuxRoute('ccd', ['caps'], read)).toEqual({ file: 'ccd', args: ['caps'] });
    expect(read).not.toHaveBeenCalled();
    expect(tmuxRoute('tmux', ['list-sessions'], read)).toEqual({ file: 'tmux', args: ['-L', 'fleet-a', 'list-sessions'] });
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe('D-8270 — readTmuxSocketSetting reads `<home>/.ccrc/tmux-socket` the way the bash twin does', () => {
  it('absent; a name; only the first line; an empty file', () => {
    expect(readTmuxSocketSetting(homeWith(null), fs)).toEqual({ kind: 'absent' });
    expect(readTmuxSocketSetting(homeWith('fleet-a\n'), fs)).toEqual({ kind: 'text', text: 'fleet-a' });
    expect(readTmuxSocketSetting(homeWith('fleet-a\nignored\n'), fs)).toEqual({ kind: 'text', text: 'fleet-a' });
    expect(readTmuxSocketSetting(homeWith(''), fs)).toEqual({ kind: 'text', text: '' });
  });

  it('a directory and a dangling link are unreadable, never absent', () => {
    const dir = homeWith(null);
    fs.mkdirSync(tmuxSocketPath(dir));
    expect(readTmuxSocketSetting(dir, fs)).toEqual({ kind: 'unreadable', why: `${tmuxSocketPath(dir)} cannot be read` });
    const dangling = homeWith(null);
    fs.symlinkSync(path.join(dangling, 'nowhere'), tmuxSocketPath(dangling));
    expect(readTmuxSocketSetting(dangling, fs).kind).toBe('unreadable');
  });

  it('the path is `<home>/.ccrc/tmux-socket`, a trailing slash on the home dropped', () => {
    expect(tmuxSocketPath('/h')).toBe('/h/.ccrc/tmux-socket');
    expect(tmuxSocketPath('/h/')).toBe('/h/.ccrc/tmux-socket');
  });
});

describe('D-8270 — the server\'s tmux spawns read the setting of the HOME ccd reads', () => {
  const savedHome = process.env['HOME'];
  const savedPath = process.env['PATH'];
  afterEach(() => { process.env['HOME'] = savedHome; process.env['PATH'] = savedPath; ptySpawn.mockClear(); });

  /** A `tmux` on PATH that prints the argv it was handed. */
  function echoTmux(): void {
    const bin = mkTmp('ccrc-tmux-socket-bin-');
    fs.writeFileSync(path.join(bin, 'tmux'), '#!/bin/sh\nprintf "%s\\n" "$*"\n', { mode: 0o755 });
    process.env['PATH'] = `${bin}${path.delimiter}${savedPath ?? ''}`;
  }

  it('realRunner (the local Tmux adapter\'s runner): unchanged by default, `-L` once the setting names a socket', async () => {
    const { realRunner, Tmux } = await import('../src/exec.js');
    echoTmux();
    process.env['HOME'] = homeWith(null);
    expect((await realRunner('tmux', ['list-sessions'])).stdout).toBe('list-sessions\n');
    process.env['HOME'] = homeWith('fleet-a\n');
    expect((await realRunner('tmux', ['list-sessions'])).stdout).toBe('-L fleet-a list-sessions\n');
    // Through the adapter itself: the capture's argv moved with the setting.
    expect(await new Tmux(realRunner).capture('demo')).toBe('-L fleet-a capture-pane -t =cc-demo: -p\n');
  });

  it('attachPty (the local drawer): unchanged by default, `-L` once the setting names a socket', async () => {
    const { attachPty } = await import('../src/pty.js');
    process.env['HOME'] = homeWith(null);
    attachPty('demo', 80, 24);
    process.env['HOME'] = homeWith('fleet-a');
    attachPty('demo', 80, 24);
    const calls = ptySpawn.mock.calls as unknown as [string, string[]][];
    expect(calls.map((c) => [c[0], c[1]])).toEqual([
      ['tmux', ['attach', '-t', '=cc-demo:']],
      ['tmux', ['-L', 'fleet-a', 'attach', '-t', '=cc-demo:']],
    ]);
  });
});
