import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { localIO, type FleetIO } from '../src/io.js';
import { readRegistry, readSessionRecord, HOLD_UNREADABLE } from '../src/registry.js';
import { mkTmp } from './tmpHelpers.js';

const seed = (dir: string, id: string, fields: Record<string, string>) => {
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(dir, `${id}.${k}`), v);
};

describe('readRegistry', () => {
  let home: string;
  beforeEach(() => {
    home = mkTmp('ccrc-');
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

  it('reads the branch a workspace was created on', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'demo-quiet-mesa', {
      wrapper: 'claude', project: 'demo',
      workdir: '/home/x/worktrees/demo/quiet-mesa', uuid: 'c'.repeat(36), started: '1',
      workspace: 'quiet-mesa', branch: 'ws/quiet-mesa',
    });
    const out = await readRegistry(localIO, loadConfig({ CCRC_HOME: home }));
    expect(out[0].branch).toBe('ws/quiet-mesa');
  });

  it('leaves branch null for a main checkout that never had one written', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'claude-demo', {
      wrapper: 'claude', project: 'demo',
      workdir: '/data/projects/demo', uuid: 'd'.repeat(36), started: '1',
    });
    const out = await readRegistry(localIO, loadConfig({ CCRC_HOME: home }));
    expect(out[0].branch).toBeNull();
  });
});

describe('workspace on the wire', () => {
  let home: string;
  beforeEach(() => {
    home = mkTmp('ccrc-');
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

describe('PR and archive fields', () => {
  it('reads base, prphase, prnumber, prcheckedat and archived off disk', async () => {
    const home = mkTmp('ccrc-');
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    const put = (f: string, v: string): void => writeFileSync(path.join(reg, `demo-quiet-basin.${f}`), v);
    put('uuid', 'u'); put('wrapper', 'claude'); put('workdir', '/w'); put('project', 'demo');
    put('workspace', 'quiet-basin'); put('branch', 'ws/quiet-basin');
    put('base', 'origin/main'); put('prphase', 'merged'); put('prnumber', '42');
    put('prcheckedat', '1785300000000'); put('archived', '1785300123');
    const [r] = await readRegistry(localIO, loadConfig({ CCRC_HOME: home }));
    expect(r!.base).toBe('origin/main');
    expect(r!.prPhase).toBe('merged');
    expect(r!.prNumber).toBe(42);
    expect(r!.prCheckedAt).toBe(1785300000000);
    expect(r!.archivedAt).toBe(1785300123);
  });

  it('nulls a prphase that is not one of the eight known phases', async () => {
    // The file is written by ccd on another box. A version skew that writes a
    // phase this build does not know must degrade to "unchecked", never leak a
    // string the PWA will switch on and render as nothing.
    const home = mkTmp('ccrc-');
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    for (const [f, v] of [['uuid', 'u'], ['wrapper', 'claude'], ['workdir', '/w'], ['prphase', 'exploded']]) {
      writeFileSync(path.join(reg, `demo-x.${f}`), v!);
    }
    const [r] = await readRegistry(localIO, loadConfig({ CCRC_HOME: home }));
    expect(r!.prPhase).toBeNull();
  });

  it('nulls a zero-byte or non-numeric field instead of 0 / NaN', async () => {
    // Both of numOrNull's guards, which nothing else pins. An interrupted
    // `_reg_set` leaves a zero-byte field, and `Number('')` is 0 — `archivedAt: 0`
    // reads as archived-in-1970, so the UI would offer "clean up workspace" on a
    // workspace whose archive never finished. A non-numeric field is NaN, which
    // JSON.stringify puts on the wire as `null` while the type still says
    // `number` — the silent lie the comment on numOrNull claims to prevent.
    const home = mkTmp('ccrc-');
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    const put = (f: string, v: string): void => writeFileSync(path.join(reg, `demo-quiet-basin.${f}`), v);
    put('uuid', 'u'); put('wrapper', 'claude'); put('workdir', '/w'); put('project', 'demo');
    put('archived', ''); put('prcheckedat', 'oops'); put('prnumber', '  ');

    const [r] = await readRegistry(localIO, loadConfig({ CCRC_HOME: home }));
    expect(r!.archivedAt).toBeNull();
    expect(r!.prCheckedAt).toBeNull();
    expect(r!.prNumber).toBeNull();
  });

  it('leaves every new field null on a session that has none of them', async () => {
    const home = mkTmp('ccrc-');
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    for (const [f, v] of [['uuid', 'u'], ['wrapper', 'claude'], ['workdir', '/w']]) {
      writeFileSync(path.join(reg, `claude-demo.${f}`), v!);
    }
    const [r] = await readRegistry(localIO, loadConfig({ CCRC_HOME: home }));
    expect([r!.base, r!.prPhase, r!.prNumber, r!.prCheckedAt, r!.archivedAt])
      .toEqual([null, null, null, null, null]);
  });
});

// C0.3: readSessionRecord is the SAME parser (buildRecord) as readRegistry,
// narrowed to one id — one readdir plus that id's 17 field reads instead of
// a whole-fleet sweep. These pin that it agrees with readRegistry's own
// per-record answer, id-by-id, rather than re-testing every field this file
// already covers above.
describe('readSessionRecord', () => {
  let home: string;
  beforeEach(() => {
    home = mkTmp('ccrc-');
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  });

  it('reads the same record readRegistry would, for one id among several', async () => {
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
    const cfg = loadConfig({ CCRC_HOME: home });

    const whole = await readRegistry(localIO, cfg);
    const single = await readSessionRecord(localIO, cfg, 'claude2-MekWarLive');

    expect(single).toEqual(whole.find((r) => r.id === 'claude2-MekWarLive'));
    expect(single?.pool).toEqual(['claude', 'claude2']);
    expect(single?.lastswap).toBe(1784500000);
  });

  it('returns null for an id with no .uuid in the registry, without reading any of its fields', async () => {
    const reg = path.join(home, '.cc-sessions');
    let fieldReads = 0;
    const countingIO: FleetIO = {
      ...localIO,
      readFile: async (p) => { fieldReads++; return localIO.readFile(p); },
    };
    seed(reg, 'claude2-MekWarLive', {
      wrapper: 'claude2', project: 'MekWarLive', workdir: '/data/projects/MekWarLive',
      uuid: 'a'.repeat(36),
    });
    const cfg = loadConfig({ CCRC_HOME: home });

    const rec = await readSessionRecord(countingIO, cfg, 'nope');
    expect(rec).toBeNull();
    // A miss must not fire the 17-field Promise.all `buildRecord` would — the
    // whole point of checking the listing FIRST.
    expect(fieldReads).toBe(0);
  });

  it('returns null when the registry dir cannot be listed', async () => {
    const cfg = loadConfig({ CCRC_HOME: path.join(home, 'nope') });
    expect(await readSessionRecord(localIO, cfg, 'claude-demo')).toBeNull();
  });

  it('returns null for an incomplete entry (own field unreadable), same as readRegistry dropping it', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'claude-demo', { uuid: 'c'.repeat(36), wrapper: 'claude' }); // no workdir
    const cfg = loadConfig({ CCRC_HOME: home });
    expect(await readSessionRecord(localIO, cfg, 'claude-demo')).toBeNull();
  });

  it('costs exactly one readdir plus the one id\'s 17 field reads — never a per-session Promise.all for a sibling', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'claude2-MekWarLive', {
      wrapper: 'claude2', project: 'MekWarLive', workdir: '/data/projects/MekWarLive', uuid: 'a'.repeat(36),
    });
    seed(reg, 'claude-corp-orchard-api', {
      wrapper: 'claude-corp', project: 'orchard-api',
      workdir: '/data/projects/orchard-api', uuid: 'b'.repeat(36),
    });
    let readdirCalls = 0;
    let fieldReads: string[] = [];
    const countingIO: FleetIO = {
      ...localIO,
      readdir: async (p) => { readdirCalls++; return localIO.readdir(p); },
      readFile: async (p) => { fieldReads.push(p); return localIO.readFile(p); },
    };
    const cfg = loadConfig({ CCRC_HOME: home });

    await readSessionRecord(countingIO, cfg, 'claude2-MekWarLive');

    expect(readdirCalls).toBe(1);
    expect(fieldReads).toHaveLength(17);
    expect(fieldReads.every((p) => p.includes('claude2-MekWarLive'))).toBe(true);
  });

  it('re-confirms a still-unreadable hold with one second listing, same as readRegistry', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'demo-quiet-basin', {
      wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'd'.repeat(36),
    });
    writeFileSync(path.join(reg, 'demo-quiet-basin.hold'), 'program:agent-evals wave:1/4');
    const holdUnreadableIO: FleetIO = {
      ...localIO,
      readFile: async (p) => (p.endsWith('.hold') ? null : localIO.readFile(p)),
    };
    const cfg = loadConfig({ CCRC_HOME: home });
    const rec = await readSessionRecord(holdUnreadableIO, cfg, 'demo-quiet-basin');
    expect(rec?.held).toBe(HOLD_UNREADABLE);
  });
});
