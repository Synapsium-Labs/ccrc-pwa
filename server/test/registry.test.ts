import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { localIO, type FleetIO } from '../src/io.js';
import {
  readRegistry, readRegistryMeasured, readSessionRecord, measuredIdentity,
  HOLD_UNREADABLE, REGISTRY_UNMEASURED_STUCK_MS,
} from '../src/registry.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';

const seed = (dir: string, id: string, fields: Record<string, string>) => {
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(dir, `${id}.${k}`), v);
};

describe('readRegistry', () => {
  let home: string;
  beforeEach(() => {
    home = mkTmp('ccrc-');
    seedRoster(home);
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
    const out = await readRegistry(localIO, loadConfig({
      CCRC_HOME: path.join(home, 'nope'), CCRC_ACCOUNTS: path.join(home, '.ccrc', 'accounts.json'),
    }));
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
    seedRoster(home);
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
    seedRoster(home);
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
    seedRoster(home);
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
    seedRoster(home);
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
    seedRoster(home);
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
    seedRoster(home);
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

    expect(single).toEqual({ found: true, record: whole.find((r) => r.id === 'claude2-MekWarLive') });
    expect(single.found && single.record.pool).toEqual(['claude', 'claude2']);
    expect(single.found && single.record.lastswap).toBe(1784500000);
  });

  it('answers {found:false, reason:\'absent\'} for an id with no .uuid in the registry, without reading any of its fields', async () => {
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
    expect(rec).toEqual({ found: false, reason: 'absent' });
    // A miss must not fire the 17-field Promise.all `buildRecord` would — the
    // whole point of checking the listing FIRST.
    expect(fieldReads).toBe(0);
  });

  it('answers {found:false, reason:\'unlistable\'} when the registry dir cannot be listed', async () => {
    const cfg = loadConfig({
      CCRC_HOME: path.join(home, 'nope'), CCRC_ACCOUNTS: path.join(home, '.ccrc', 'accounts.json'),
    });
    expect(await readSessionRecord(localIO, cfg, 'claude-demo')).toEqual({ found: false, reason: 'unlistable' });
  });

  it('answers {found:false, reason:\'absent\'} for an incomplete entry (own field never written, not just ' +
     'unreadable), same as readRegistry dropping it', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'claude-demo', { uuid: 'c'.repeat(36), wrapper: 'claude' }); // no workdir file at all
    const cfg = loadConfig({ CCRC_HOME: home });
    expect(await readSessionRecord(localIO, cfg, 'claude-demo')).toEqual({ found: false, reason: 'absent' });
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
    expect(rec.found && rec.record.held).toBe(HOLD_UNREADABLE);
  });
});

// Architecture doc, increment 1's second half (spec:
// docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md):
// DEGRADE-AND-HEAL for a listed-but-unreadable identity field, narrowed
// (logged) DROP for a field that is neither readable nor listed, or reads
// back measured-empty. `registry.ts:123`'s old blanket rule ("missing
// wrapper/workdir/uuid" -> drop) had NO pin before this file — these tests
// are written FIRST and confirmed red against that old rule (a triple member
// null+listed used to drop the whole row; here it must degrade it instead).
describe('the identity ladder (unmeasured evidence)', () => {
  let home: string;
  beforeEach(() => {
    home = mkTmp('ccrc-');
    seedRoster(home);
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  });

  /** `localIO` with every read of `<id>.<field>` failing — the file is still
   *  LISTED (a real, present file on disk), only its bytes never come back —
   *  the shape `remote/io.ts` produces on one dropped agent-WS round trip
   *  among the ~17 a session's read fires in parallel. */
  const unreadableField = (id: string, field: string): FleetIO => ({
    ...localIO,
    readFile: async (p) => (p.endsWith(`${id}.${field}`) ? null : localIO.readFile(p)),
  });

  it('degrades — never drops — a row whose wrapper is listed but unreadable', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'demo-quiet-basin', { wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'e'.repeat(36) });
    const cfg = loadConfig({ CCRC_HOME: home });
    const out = await readRegistry(unreadableField('demo-quiet-basin', 'wrapper'), cfg);
    expect(out).toHaveLength(1);
    const rec = out[0]!;
    expect(rec.unmeasured).toEqual(['wrapper']);
    // A degraded field's OWN value is '' — never null, and never any real
    // wrapper — so a stray `=== ''` comparison can never be fooled by it,
    // and every OTHER field (measured) stays exactly what was written.
    expect(rec.wrapper).toBe('');
    expect(rec.uuid).toBe('e'.repeat(36));
    expect(rec.workdir).toBe('/w');
  });

  it('degrades a row whose uuid is listed but unreadable — the case guaranteed reachable by construction', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'demo-quiet-basin', { wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'e'.repeat(36) });
    const cfg = loadConfig({ CCRC_HOME: home });
    const out = await readRegistry(unreadableField('demo-quiet-basin', 'uuid'), cfg);
    expect(out).toHaveLength(1);
    expect(out[0]!.unmeasured).toEqual(['uuid']);
    expect(out[0]!.uuid).toBe('');
  });

  it('drops (still, now logged) a row whose workdir file was never written at all', async () => {
    const reg = path.join(home, '.cc-sessions');
    // No `.workdir` file on disk — genuinely absent, not merely unreadable.
    seed(reg, 'demo-quiet-basin', { wrapper: 'claude', project: 'demo', uuid: 'e'.repeat(36) });
    const cfg = loadConfig({ CCRC_HOME: home });
    const out = await readRegistry(localIO, cfg);
    expect(out).toEqual([]);
  });

  it('drops (still, now logged) a row whose wrapper reads back measured-empty — a permanent fault, not a read failure', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'demo-quiet-basin', { wrapper: '   ', project: 'demo', workdir: '/w', uuid: 'e'.repeat(36) });
    const cfg = loadConfig({ CCRC_HOME: home });
    const out = await readRegistry(localIO, cfg);
    expect(out).toEqual([]);
  });

  it('measuredIdentity returns the bundled triple when fully measured, and null the instant any member is degraded', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'demo-quiet-basin', { wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'e'.repeat(36) });
    const cfg = loadConfig({ CCRC_HOME: home });

    const clean = (await readRegistry(localIO, cfg))[0]!;
    expect(measuredIdentity(clean)).toEqual({ uuid: 'e'.repeat(36), wrapper: 'claude', workdir: '/w' });

    const degraded = (await readRegistry(unreadableField('demo-quiet-basin', 'workdir'), cfg))[0]!;
    expect(measuredIdentity(degraded)).toBeNull();
  });

  it('twice-observed absence retires a degraded row within the SAME readRegistry call', async () => {
    // First listing: `.wrapper` is there but unreadable — degraded. By the
    // time the second (confirmatory) listing runs, the WHOLE session has
    // been reaped — `.uuid` itself is gone. That is proof, not a guess: the
    // row is dropped from the result rather than kept degraded forever.
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'demo-quiet-basin', { wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'e'.repeat(36) });
    const cfg = loadConfig({ CCRC_HOME: home });
    let listings = 0;
    const reapedMidRead: FleetIO = {
      ...localIO,
      readdir: async (p) => {
        const names = await localIO.readdir(p);
        if (names === null) return names;
        listings += 1;
        if (listings === 1) return names;
        return names.filter((n) => !n.startsWith('demo-quiet-basin.'));
      },
      readFile: async (p) => (p.endsWith('.wrapper') ? null : localIO.readFile(p)),
    };
    const out = await readRegistry(reapedMidRead, cfg);
    expect(out).toEqual([]);
    expect(listings).toBe(2);
  });

  it('a second listing that FAILS proves nothing and changes nothing — the degraded row stays, fail-shut', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'demo-quiet-basin', { wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'e'.repeat(36) });
    const cfg = loadConfig({ CCRC_HOME: home });
    let listings = 0;
    const secondListingFails: FleetIO = {
      ...localIO,
      readdir: async (p) => {
        listings += 1;
        if (listings === 1) return localIO.readdir(p);
        return null;
      },
      readFile: async (p) => (p.endsWith('.wrapper') ? null : localIO.readFile(p)),
    };
    const out = await readRegistry(secondListingFails, cfg);
    expect(out).toHaveLength(1);
    expect(out[0]!.unmeasured).toEqual(['wrapper']);
    expect(listings).toBe(2);
  });

  it('readSessionRecord retires a degraded row to {found:false, reason:\'absent\'} on twice-observed absence', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'demo-quiet-basin', { wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'e'.repeat(36) });
    const cfg = loadConfig({ CCRC_HOME: home });
    let listings = 0;
    const reapedMidRead: FleetIO = {
      ...localIO,
      readdir: async (p) => {
        const names = await localIO.readdir(p);
        if (names === null) return names;
        listings += 1;
        if (listings === 1) return names;
        return names.filter((n) => !n.startsWith('demo-quiet-basin.'));
      },
      readFile: async (p) => (p.endsWith('.wrapper') ? null : localIO.readFile(p)),
    };
    expect(await readSessionRecord(reapedMidRead, cfg, 'demo-quiet-basin')).toEqual({ found: false, reason: 'absent' });
  });
});

describe('readRegistryMeasured / RegistryRead', () => {
  let home: string;
  beforeEach(() => {
    home = mkTmp('ccrc-');
    seedRoster(home);
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  });

  it('answers {listed:true, records} on an ordinary read, and readRegistry unwraps it', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'demo-quiet-basin', { wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'e'.repeat(36) });
    const cfg = loadConfig({ CCRC_HOME: home });
    const read = await readRegistryMeasured(localIO, cfg);
    expect(read.listed).toBe(true);
    expect(read.listed && read.records.map((r) => r.id)).toEqual(['demo-quiet-basin']);
    expect(await readRegistry(localIO, cfg)).toEqual(read.listed ? read.records : []);
  });

  it('answers {listed:false} — the whole-fleet collapse — distinct from a registry that genuinely lists ' +
     'nobody, and readRegistry\'s old signature still collapses it to []', async () => {
    const cfg = loadConfig({
      CCRC_HOME: path.join(home, 'nope'), CCRC_ACCOUNTS: path.join(home, '.ccrc', 'accounts.json'),
    });
    const read = await readRegistryMeasured(localIO, cfg);
    expect(read).toEqual({ listed: false });
    expect(await readRegistry(localIO, cfg)).toEqual([]);
  });

  // BUILD 4, D-B4-10. `watch.ts`'s `emitCoord` needs a NON-session fact out of
  // this same directory — `coordinator-paused` and `mail-disabled`, neither of
  // which is a `*.uuid` and so neither of which survives into `records`. A
  // second `readdir` for that would be a second clock for one fact, and the two
  // would disagree on exactly the ticks that matter.
  it('carries the RAW listing it derived the records from, so a caller needing a non-session '
     + 'fact out of the same directory shares the one readdir', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'demo-quiet-basin', { wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'e'.repeat(36) });
    writeFileSync(path.join(reg, 'coordinator-paused'), '');
    const cfg = loadConfig({ CCRC_HOME: home });
    let listings = 0;
    const counted: FleetIO = {
      ...localIO,
      readdir: async (p) => { listings += 1; return localIO.readdir(p); },
    };
    const read = await readRegistryMeasured(counted, cfg);
    expect(read.listed).toBe(true);
    expect(read.listed && [...read.names].sort()).toEqual(
      (await localIO.readdir(reg))!.sort(),
    );
    // The marker is IN it — the whole point, and the thing `records` cannot say.
    expect(read.listed && read.names).toContain('coordinator-paused');
    // …and it cost exactly the one listing this function always took.
    expect(listings).toBe(1);
  });

  it('carries the FIRST listing even when the reap-race re-listing ran', async () => {
    // The second read (`registry.ts`'s hold/identity resolution) exists to
    // settle a per-row reap race, runs on SOME calls only, and hanging the
    // markers' clock on it would make the pause banner's cadence depend on
    // whether an unrelated session happened to be mid-reap.
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'demo-quiet-basin', { wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'e'.repeat(36) });
    writeFileSync(path.join(reg, 'coordinator-paused'), '');
    const cfg = loadConfig({ CCRC_HOME: home });
    let listings = 0;
    const markerVanishesOnRelist: FleetIO = {
      ...localIO,
      readdir: async (p) => {
        const names = await localIO.readdir(p);
        if (names === null) return names;
        listings += 1;
        // The first listing is the honest one; the second drops the marker AND
        // the row's `.uuid`, which is what forces the re-listing branch to run
        // at all (an unmeasured identity triple + a twice-observed absence).
        return listings === 1 ? names : names.filter((n) => n !== 'coordinator-paused' && !n.endsWith('.uuid'));
      },
      readFile: async (p) => (p.endsWith('.wrapper') ? null : localIO.readFile(p)),
    };
    const read = await readRegistryMeasured(markerVanishesOnRelist, cfg);
    expect(listings).toBe(2);          // the re-listing really did run
    expect(read.listed).toBe(true);
    expect(read.listed && read.names).toContain('coordinator-paused');
  });
});

describe('observability (warnOnce, escalation, the whole-fleet episode)', () => {
  let home: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    home = mkTmp('ccrc-obs-');
    seedRoster(home);
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    vi.useRealTimers();
  });

  const unreadableField = (id: string, field: string): FleetIO => ({
    ...localIO,
    readFile: async (p) => (p.endsWith(`${id}.${field}`) ? null : localIO.readFile(p)),
  });

  it('warns once on entry to degraded, and stays silent on an immediate repeat within the cooldown', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'obs-warnonce-a', { wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'f'.repeat(36) });
    const cfg = loadConfig({ CCRC_HOME: home });
    const io = unreadableField('obs-warnonce-a', 'wrapper');

    await readRegistry(io, cfg);
    const afterFirst = warnSpy.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);

    await readRegistry(io, cfg);
    // Still within the 60s cooldown — no NEW warn line for the same id#field.
    expect(warnSpy.mock.calls.length).toBe(afterFirst);
  });

  it('warns again once the cooldown has elapsed', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'obs-warnonce-b', { wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'f'.repeat(36) });
    const cfg = loadConfig({ CCRC_HOME: home });
    const io = unreadableField('obs-warnonce-b', 'wrapper');

    await readRegistry(io, cfg);
    const afterFirst = warnSpy.mock.calls.length;
    vi.setSystemTime(Date.now() + 61_000);
    await readRegistry(io, cfg);
    expect(warnSpy.mock.calls.length).toBeGreaterThan(afterFirst);
  });

  it('escalates to console.error exactly once per stuck episode, after REGISTRY_UNMEASURED_STUCK_MS', async () => {
    const reg = path.join(home, '.cc-sessions');
    seed(reg, 'obs-escalate', { wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'f'.repeat(36) });
    const cfg = loadConfig({ CCRC_HOME: home });
    const io = unreadableField('obs-escalate', 'wrapper');

    await readRegistry(io, cfg);
    expect(errorSpy).not.toHaveBeenCalled();
    // Short of the ceiling: still just a warn.
    vi.setSystemTime(Date.now() + REGISTRY_UNMEASURED_STUCK_MS - 1_000);
    await readRegistry(io, cfg);
    expect(errorSpy).not.toHaveBeenCalled();
    // Past the ceiling: exactly one error.
    vi.setSystemTime(Date.now() + 2_000);
    await readRegistry(io, cfg);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    // And it does not repeat on the very next read.
    vi.setSystemTime(Date.now() + 1_000);
    await readRegistry(io, cfg);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('prunes a degraded id\'s warn state once it is no longer listed at all — a RECYCLED id (`ws-reap` ' +
     'draws only from free slugs, so the same id can name a wholly different incarnation later) does not ' +
     'inherit the retired incarnation\'s escalation clock', async () => {
    const reg = path.join(home, '.cc-sessions');
    const id = 'obs-prune-recycled';
    seed(reg, id, { wrapper: 'claude', project: 'demo', workdir: '/w', uuid: 'f'.repeat(36) });
    const cfg = loadConfig({ CCRC_HOME: home });
    const io = unreadableField(id, 'wrapper');
    await readRegistry(io, cfg);   // degrades id#wrapper#degraded, firstAt = T0
    expect(errorSpy).not.toHaveBeenCalled();

    // The incarnation is torn down — every registry file for `id` removed,
    // the ordinary shape of a reap.
    for (const f of ['wrapper', 'project', 'workdir', 'uuid']) {
      rmSync(path.join(reg, `${id}.${f}`), { force: true });
    }
    // A read while `id` is absent from the listing is what prunes its entry
    // — this call must not itself re-create one (nothing to build for an id
    // with no `.uuid`).
    await readRegistry(io, cfg);

    // Time passes well beyond the escalation ceiling, THEN the SAME id is
    // reused for a wholly unrelated NEW incarnation, ALSO wrapper-degraded.
    vi.setSystemTime(Date.now() + REGISTRY_UNMEASURED_STUCK_MS + 1_000);
    seed(reg, id, { wrapper: 'claude', project: 'other-project', workdir: '/w2', uuid: 'g'.repeat(36) });
    await readRegistry(io, cfg);
    // Without pruning, the stale entry's `firstAt` (T0) is still on file, and
    // `now - firstAt` already exceeds the ceiling — this would escalate on
    // what is, in truth, a BRAND NEW incarnation's very first observation.
    // Pruned correctly, this degrade starts its own clock and must not.
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('logs the whole-fleet unlistable episode on entry and exit, never per tick', async () => {
    const cfg = loadConfig({ CCRC_HOME: home });   // registry dir exists — deleted below
    const listable = { ...localIO };
    const unlistable: FleetIO = { ...localIO, readdir: async () => null };

    await readRegistry(listable, cfg);   // baseline: an ordinary, listable read logs nothing about this
    const before = errorSpy.mock.calls.length;

    await readRegistry(unlistable, cfg);
    await readRegistry(unlistable, cfg);
    await readRegistry(unlistable, cfg);
    // ENTRY: exactly one error, however many ticks stayed unlistable.
    expect(errorSpy.mock.calls.length).toBe(before + 1);

    const warnsBefore = warnSpy.mock.calls.length;
    await readRegistry(listable, cfg);
    // EXIT: exactly one warn.
    expect(warnSpy.mock.calls.length).toBe(warnsBefore + 1);
    await readRegistry(listable, cfg);
    await readRegistry(listable, cfg);
    // No further exit logging on subsequent, already-recovered reads.
    expect(warnSpy.mock.calls.length).toBe(warnsBefore + 1);
  });
});
