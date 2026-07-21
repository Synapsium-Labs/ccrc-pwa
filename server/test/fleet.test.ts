import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { assembleFleet, idHomeWrapper } from '../src/fleet.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';

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
