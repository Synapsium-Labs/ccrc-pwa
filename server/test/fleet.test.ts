import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { assembleFleet, idHomeWrapper } from '../src/fleet.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import type { Statusline } from '../src/pane/statusline.js';

const seedSession = (home: string, id: string, wrapper: string, extra: Record<string, string> = {}) => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper, project: id, workdir: `/data/projects/${id}`, uuid: '1'.repeat(36), started: '1', ...extra };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

describe('idHomeWrapper', () => {
  it('longest prefix wins', () => {
    expect(idHomeWrapper('claude-corp-orchard-api')).toBe('claude-corp');
    expect(idHomeWrapper('claude2-MekWarLive')).toBe('claude2');
    expect(idHomeWrapper('claude-synapsium-platform')).toBe('claude');
    expect(idHomeWrapper('gpt-foo')).toBe('gpt');
  });
});

describe('assembleFleet', () => {
  it('joins registry, live state, limits, and tmux aliveness', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'ccrc-'));
    seedSession(home, 'claude2-MekWarLive', 'claude2');
    seedSession(home, 'claude-dead-proj', 'claude');
    mkdirSync(path.join(home, '.claude-personal', 'sessions'), { recursive: true });
    writeFileSync(path.join(home, '.claude-personal', 'sessions', '40613.json'), JSON.stringify({
      pid: 40613, sessionId: '1'.repeat(36), cwd: '/data/projects/MekWarLive',
      name: 'mekwar-a1', status: 'busy', statusUpdatedAt: 1784582728369, version: '2.1.210',
    }));
    mkdirSync(path.join(home, '.cc-limits'), { recursive: true });
    const now = 1784600000;
    writeFileSync(path.join(home, '.cc-limits', 'claude2.json'), JSON.stringify({ five: 55, seven: 70, ts: now - 60 }));

    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: args.includes('cc-claude2-MekWarLive') ? 0 : 1, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: '40613\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };

    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(run), now);
    const mek = fleet.find((s) => s.id === 'claude2-MekWarLive')!;
    expect(mek.status).toBe('busy');
    expect(mek.name).toBe('mekwar-a1');
    expect(mek.limits).toEqual({ five: 55, seven: 70 });
    expect(mek.home).toBe('claude2');
    const dead = fleet.find((s) => s.id === 'claude-dead-proj')!;
    expect(dead.status).toBe('dead');
    expect(dead.name).toBeNull();
  });
});

describe('branch precedence', () => {
  const setup = (): { home: string; run: Runner } => {
    const home = mkdtempSync(path.join(tmpdir(), 'ccrc-'));
    seedSession(home, 'demo-quiet-mesa', 'claude', {
      project: 'demo', workspace: 'quiet-mesa', branch: 'ws/quiet-mesa',
    });
    // Alive, but with no live-state file — so no statusline can have been
    // derived yet. This is a workspace in the seconds after ws-add.
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: '', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    return { home, run };
  };

  it('falls back to the registry branch before any pane capture has landed', async () => {
    const { home, run } = setup();
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(run), 1784600000);
    expect(fleet.find((s) => s.id === 'demo-quiet-mesa')!.branch).toBe('ws/quiet-mesa');
  });

  it('prefers the statusline branch — it reflects a manual checkout the registry cannot know about', async () => {
    const { home, run } = setup();
    const sl = new Map<string, Statusline>([
      ['demo-quiet-mesa', { branch: 'feat/actually-here', ultracode: false, workflowActive: false }],
    ]);
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), new Tmux(run), 1784600000, undefined, sl);
    expect(fleet.find((s) => s.id === 'demo-quiet-mesa')!.branch).toBe('feat/actually-here');
  });

  it('is null when neither source has one', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'ccrc-'));
    seedSession(home, 'claude-demo', 'claude');
    const run: Runner = async () => ({ code: 1, stdout: '', stderr: '' });
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(run), 1784600000);
    expect(fleet.find((s) => s.id === 'claude-demo')!.branch).toBeNull();
  });
});

describe('derived session handles', () => {
  const build = async (live: Record<string, unknown>) => {
    const home = mkdtempSync(path.join(tmpdir(), 'ccrc-'));
    seedSession(home, 'claude2-MekWarLive', 'claude2');
    mkdirSync(path.join(home, '.claude-personal', 'sessions'), { recursive: true });
    writeFileSync(
      path.join(home, '.claude-personal', 'sessions', '40613.json'),
      JSON.stringify({ pid: 40613, sessionId: '1'.repeat(36), cwd: '/d', status: 'idle', ...live }),
    );
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: '40613\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(run));
    return fleet.find((s) => s.id === 'claude2-MekWarLive')!;
  };

  it('drops a name Claude Code declares derived', async () => {
    expect((await build({ name: 'mekwarlive-e7', nameSource: 'derived' })).name).toBeNull();
  });

  it('keeps a name with no nameSource at all — an older file, chosen by a human', async () => {
    // The ONE live session that carries a real name is exactly this shape.
    // An implementation testing `=== 'chosen'` passes the case above and fails here.
    expect((await build({ name: 'add-mcp-image-attachments' })).name)
      .toBe('add-mcp-image-attachments');
  });

  it('keeps a name whose nameSource is anything but derived', async () => {
    expect((await build({ name: 'refactor-auth', nameSource: 'user' })).name).toBe('refactor-auth');
  });
});
