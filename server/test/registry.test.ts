import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { localIO } from '../src/io.js';
import { readRegistry } from '../src/registry.js';

const seed = (dir: string, id: string, fields: Record<string, string>) => {
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(dir, `${id}.${k}`), v);
};

describe('readRegistry', () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), 'ccrc-'));
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  });

  it('reads sessions enumerated by *.uuid with optional fields', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'claude2-MekWarLive', {
      wrapper: 'claude2', project: 'MekWarLive', workdir: '/data/projects/MekWarLive',
      uuid: 'a0b5791d-0000-0000-0000-000000000001', started: '1',
      pool: 'claude claude2', lastswap: '1784500000',
    });
    seed(reg, 'claude-corp-orchard-api', {
      wrapper: 'claude-corp', project: 'orchard-api',
      workdir: '/data/projects/orchard-api', uuid: 'b'.repeat(36), started: '1',
    });
    writeFileSync(path.join(reg, 'gpt-disabled'), '');   // noise: not a session file
    writeFileSync(path.join(reg, 'swap.log'), 'x');      // noise

    const out = await readRegistry(localIO, loadConfig({ CCRC_HOME: home }));
    expect(out.map((s) => s.id)).toEqual(['claude-corp-orchard-api', 'claude2-MekWarLive']);
    const mek = out[1];
    expect(mek.pool).toEqual(['claude', 'claude2']);
    expect(mek.lastswap).toBe(1784500000);
    expect(out[0].pool).toBeNull();
    expect(out[0].home).toBeNull();
  });

  it('returns [] when registry dir missing', async () => {
    const out = await readRegistry(localIO, loadConfig({ CCRC_HOME: path.join(home, 'nope') }));
    expect(out).toEqual([]);
  });
});

describe('workspace on the wire', () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), 'ccrc-'));
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  });

  it('reads the workspace field when present', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'demo-quiet-mesa', {
      wrapper: 'claude2', project: 'demo', workdir: '/w/demo/quiet-mesa',
      uuid: 'a'.repeat(36), workspace: 'quiet-mesa',
    });
    const [rec] = await readRegistry(localIO, loadConfig({ CCRC_HOME: home }));
    expect(rec.workspace).toBe('quiet-mesa');
  });

  it('leaves workspace null for a legacy main-checkout session', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'claude2-demo', {
      wrapper: 'claude2', project: 'demo', workdir: '/p/demo', uuid: 'b'.repeat(36),
    });
    const [rec] = await readRegistry(localIO, loadConfig({ CCRC_HOME: home }));
    expect(rec.workspace).toBeNull();
  });
});
