// Landing order wave 5i, Task 2: the control bundle (lander marker, radar probe, main health) and its readers. The
// parsers are fed producer-shaped documents (`ccd/ccd-land-probe`'s `health_doc`, `reconcile_enabled`), never a second
// judgement of the forge's checks. The adapter cases run on real files through `localIO`, with an io double only where a
// fault cannot be made on disk. Fixed clock, neutral names.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readLandingControl, readRegular } from '../src/coord/lineageRead.js';
import { parseLander, parseMainHealth, parseProbe, RADAR_PROBE_MAX_BYTES, type ProbeRead } from '../src/coord/radar.js';
import { localIO, type FleetIO } from '../src/io.js';
import { READ_FROM_MAX_BYTES } from '../../shared/agent-protocol.js';
import { CONTROL_BASE_SHA, CONTROL_HEAD_SHA, CONTROL_NOW as now, controlRead } from './landingFixture.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { openCoordDb } from '../src/coord/db.js';
import type { CoordStore } from '../src/coord/store.js';
import { landingStoreOver } from './landingFixture.js';
import { landingBindingOf, mainRedNext } from '../src/coord/landingLine.js';
import type { LandingMutationFacts } from '../src/coord/landingWrites.js';
import type { LandingEntry } from '../../shared/landingLine.js';

const iso = (offsetS: number): string => new Date(now + offsetS * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const P = 'project-a';

const health = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 1, project: P, at: iso(0), sha: CONTROL_BASE_SHA, state: 'green',
  required: [{ name: 'required-a', app: null }], failing: [], pending: [], ...over,
});
const lander = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 1, project: P, lander: 'coordinator', at: iso(-2), ...over,
});
const probeDoc = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 1, project: P, at: iso(-1), state: 'measured', base: { ref: 'main', sha: CONTROL_BASE_SHA },
  heads: [{ pr: 7, head: CONTROL_HEAD_SHA, branch: 'ws/alpha', id: null, base: { state: 'clean' } }],
  headsCut: false, pairs: [], pairHeads: [], pairsCut: false, ...over,
});
const text = (v: unknown): string => JSON.stringify(v);

describe('parseMainHealth: the producer-shaped documents', () => {
  it('green, red, and the unmeasured shapes read; the producer state is authoritative', () => {
    expect(parseMainHealth(text(health()), P, now)).toMatchObject({ ok: true, doc: { state: 'green', sha: CONTROL_BASE_SHA } });
    expect(parseMainHealth(text(health({ state: 'red', failing: ['required-a'] })), P, now))
      .toMatchObject({ ok: true, doc: { state: 'red', failing: ['required-a'], pending: [] } });
    expect(parseMainHealth(text(health({ state: 'red', failing: ['required-a'], required: [{ name: 'required-a', app: 5 }, { name: 'required-b', app: null }], pending: ['required-b'] })), P, now))
      .toMatchObject({ ok: true, doc: { state: 'red', pending: ['required-b'] } });
    const noRequired = { state: 'unmeasured', why: 'no-required-set', required: [], failing: [], pending: [] };
    expect(parseMainHealth(text(health(noRequired)), P, now))
      .toMatchObject({ ok: true, doc: { state: 'unmeasured', why: 'no-required-set', required: [] } });
    expect(parseMainHealth(text(health({ ...noRequired, sha: null, why: 'fetch-failed' })), P, now))
      .toMatchObject({ ok: true, doc: { state: 'unmeasured', sha: null, why: 'fetch-failed' } });
    expect(parseMainHealth(text(health({ state: 'unmeasured', why: 'pending', pending: ['required-a'] })), P, now))
      .toMatchObject({ ok: true, doc: { state: 'unmeasured', why: 'pending', pending: ['required-a'], required: [{ name: 'required-a', app: null }] } });
  });

  it('CONTROL-name-collision: the same rendered name in failing and pending is a valid red doc', () => {
    const doc = health({
      state: 'red', failing: ['same-name'], pending: ['same-name'],
      required: [{ name: 'same-name', app: null }, { name: 'same-name', app: 9 }],
    });
    expect(parseMainHealth(text(doc), P, now)).toMatchObject({ ok: true, doc: { state: 'red', failing: ['same-name'], pending: ['same-name'] } });
  });

  it('inconsistent or unknown shapes are malformed, never a recreated verdict', () => {
    const bads: Record<string, unknown>[] = [
      health({ state: 'amber' }), health({ state: 'green', failing: ['required-a'] }), health({ state: 'green', pending: ['required-a'] }),
      health({ state: 'red' }), health({ state: 'red', failing: ['not-required'] }), health({ state: 'green', required: [] }),
      health({ state: 'green', sha: null }), health({ state: 'green', sha: 'abc' }), health({ state: 'green', why: 'x' }),
      health({ state: 'unmeasured' }), health({ state: 'unmeasured', why: '' }), health({ state: 'unmeasured', why: 'x'.repeat(65) }),
      health({ required: [{ name: '', app: null }] }), health({ required: [{ name: 'required-a', app: 0 }] }),
      health({ required: [{ name: 'required-a', app: 1.5 }] }), health({ required: [{ name: 'required-a', app: Number.MAX_SAFE_INTEGER + 1 }] }),
      health({ required: [{ name: 'required-a' }] }), health({ failing: [''] }), health({ pending: 'required-a' }),
      health({ v: 2 }), health({ at: 'yesterday' }), health({ at: '2026-11-14T12:00:00.000Z' }),
    ];
    for (const b of bads) expect(parseMainHealth(text(b), P, now), JSON.stringify(b)).toEqual({ ok: false, reason: 'malformed' });
    for (const raw of ['', '{', '[]', 'null', '"x"', '1']) expect(parseMainHealth(raw, P, now), raw).toEqual({ ok: false, reason: 'malformed' });
  });

  it('a foreign project is malformed, and stale is told apart from malformed only after structure', () => {
    expect(parseMainHealth(text(health({ project: 'project-b' })), P, now)).toEqual({ ok: false, reason: 'malformed' });
    expect(parseMainHealth(text(health({ at: iso(-1201) })), P, now)).toEqual({ ok: false, reason: 'stale' });
    expect(parseMainHealth(text(health({ at: iso(-1200) })), P, now).ok, 'the freshWithin boundary').toBe(true);
    expect(parseMainHealth(text(health({ at: iso(61) })), P, now)).toEqual({ ok: false, reason: 'stale' });
    expect(parseMainHealth(text(health({ at: iso(-1201), state: 'amber' })), P, now)).toEqual({ ok: false, reason: 'malformed' });
  });
});

describe('parseLander', () => {
  it('a version-1 coordinator marker reads; every other shape is malformed; stale only after structure', () => {
    expect(parseLander(text(lander()), P, now)).toEqual({ ok: true, doc: { project: P, lander: 'coordinator', at: iso(-2) } });
    for (const b of [lander({ project: 'project-b' }), lander({ lander: 'creator' }), lander({ v: 2 }), lander({ at: 'x' }), { v: 1 }]) {
      expect(parseLander(text(b), P, now), JSON.stringify(b)).toEqual({ ok: false, reason: 'malformed' });
    }
    expect(parseLander('{', P, now)).toEqual({ ok: false, reason: 'malformed' });
    expect(parseLander(text(lander({ at: iso(-1201) })), P, now)).toEqual({ ok: false, reason: 'stale' });
    expect(parseLander(text(lander({ project: 'project-b', at: iso(-1201) })), P, now)).toEqual({ ok: false, reason: 'malformed' });
  });
});

describe('parseProbe retains the producer base', () => {
  it('baseSha is the validated base.sha', () => {
    const r = parseProbe(text(probeDoc()), P, now);
    expect(r.ok && r.doc.baseSha).toBe(CONTROL_BASE_SHA);
  });
});

describe('controlRead: the shared fixture', () => {
  it('is the baseline table, and a perturbation replaces one document', () => {
    const c = controlRead();
    expect(c.lander).toMatchObject({ ok: true, doc: { project: P, at: iso(-2) } });
    expect(c.probe).toMatchObject({ ok: true, doc: { project: P, at: iso(-1), baseSha: CONTROL_BASE_SHA, heads: [{ pr: 7, head: CONTROL_HEAD_SHA }] } });
    expect(c.health).toMatchObject({ ok: true, doc: { at: iso(0), sha: CONTROL_BASE_SHA, state: 'green', required: [{ name: 'required-a', app: null }] } });
    expect(controlRead({ lander: { ok: false, reason: 'absent' } }).lander).toEqual({ ok: false, reason: 'absent' });
  });
});

describe('readRegular (bounded): byte ranges, bounds and distinctions', () => {
  let dir: string;
  beforeEach(() => { dir = mkTmp('ccrc-control-'); });
  afterEach(() => { vi.restoreAllMocks(); });

  const plant = (name: string, body: string | Buffer): string => { const f = path.join(dir, name); writeFileSync(f, body); return f; };
  type BoundedIO = Pick<FleetIO, 'lstatMeasured' | 'statMeasured' | 'readFileFromBytesMeasured'>;
  const spied = (over: Partial<BoundedIO> = {}): { io: BoundedIO; ranges: Array<[number, number]>; reads: ReturnType<typeof vi.fn> } => {
    const ranges: Array<[number, number]> = [];
    const reads = vi.fn();
    const io: BoundedIO = {
      lstatMeasured: (p) => localIO.lstatMeasured(p),
      statMeasured: (p) => localIO.statMeasured(p),
      readFileFromBytesMeasured: (p, o, m, t, s) => { ranges.push([o, m]); reads(); return localIO.readFileFromBytesMeasured(p, o, m, t, s); },
      ...over,
    };
    return { io, ranges, reads };
  };

  it('a 524288-byte probe takes two ranges, each at most 262144, and decodes once', async () => {
    const body = text(health());
    const f = plant('big', body + ' '.repeat(RADAR_PROBE_MAX_BYTES - body.length));
    const s = spied();
    const r = await readRegular(s.io, f, undefined, RADAR_PROBE_MAX_BYTES);
    expect(r.ok && Buffer.byteLength(r.content)).toBe(RADAR_PROBE_MAX_BYTES);
    expect(s.ranges).toEqual([[0, READ_FROM_MAX_BYTES], [READ_FROM_MAX_BYTES, RADAR_PROBE_MAX_BYTES - READ_FROM_MAX_BYTES]]);
    expect(READ_FROM_MAX_BYTES).toBe(262144);
  });

  it('CONTROL-oversize: a pre-stat above the cap makes zero byte reads and keeps the measured size', async () => {
    const f = plant('over', 'x'.repeat(17));
    const s = spied();
    expect(await readRegular(s.io, f, undefined, 16)).toEqual({ ok: false, reason: 'oversize', size: 17 });
    expect(s.reads).not.toHaveBeenCalled();
  });

  it('an empty file is an empty measurement with no read', async () => {
    const s = spied();
    expect(await readRegular(s.io, plant('empty', ''), undefined, 16)).toEqual({ ok: true, content: '' });
    expect(s.reads).not.toHaveBeenCalled();
  });

  it('CONTROL-growth: a file that grows between ranges is unmeasured, never a parsed partial', async () => {
    const f = plant('grow', 'y'.repeat(300_000));
    let calls = 0;
    const s = spied({
      readFileFromBytesMeasured: async (p, o, m, t, sig) => {
        calls += 1;
        const r = await localIO.readFileFromBytesMeasured(p, o, m, t, sig);
        if (calls === 1) writeFileSync(f, 'y'.repeat(300_100));
        return r;
      },
    });
    expect(await readRegular(s.io, f, undefined, RADAR_PROBE_MAX_BYTES)).toEqual({ ok: false, reason: 'unmeasured' });
  });

  it('a size change after the last range (same bytes read) is unmeasured', async () => {
    const f = plant('tail', 'z'.repeat(100));
    let first = true;
    const s = spied({
      statMeasured: async (p) => {
        const r = await localIO.statMeasured(p);
        if (!first && r.ok) return { ok: true, mtimeMs: r.mtimeMs + 5, size: r.size };
        first = false;
        return r;
      },
    });
    expect(await readRegular(s.io, f, undefined, 1000)).toEqual({ ok: false, reason: 'unmeasured' });
  });

  it('a short range, a range with more than asked, and invalid UTF-8 are unreadable', async () => {
    const f = plant('short', 'q'.repeat(100));
    const shortIO = spied({ readFileFromBytesMeasured: async () => ({ ok: true, bytes: new Uint8Array(40), size: 100 }) });
    expect(await readRegular(shortIO.io, f, undefined, 1000)).toEqual({ ok: false, reason: 'unreadable' });
    const longIO = spied({ readFileFromBytesMeasured: async () => ({ ok: true, bytes: new Uint8Array(101), size: 100 }) });
    expect(await readRegular(longIO.io, f, undefined, 1000)).toEqual({ ok: false, reason: 'unreadable' });
    const eofIO = spied({ readFileFromBytesMeasured: async () => ({ ok: true, bytes: new Uint8Array(0), size: 100 }) });
    expect(await readRegular(eofIO.io, f, undefined, 1000)).toEqual({ ok: false, reason: 'unreadable' });
    const bad = plant('badutf8', Buffer.from([0x7b, 0xff, 0xfe, 0x7d]));
    expect(await readRegular(spied().io, bad, undefined, 1000)).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('absence, a symlink, an io that cannot lstat, and read faults keep their own reasons', async () => {
    const f = plant('ok', '{}');
    expect(await readRegular(spied().io, path.join(dir, 'missing'), undefined, 16)).toEqual({ ok: false, reason: 'absent' });
    const link = path.join(dir, 'link'); symlinkSync(f, link);
    expect(await readRegular(spied().io, link, undefined, 16)).toEqual({ ok: false, reason: 'unreadable' });
    const old = spied({ lstatMeasured: async () => ({ ok: false, reason: 'unmeasured' }) });
    expect(await readRegular(old.io, f, undefined, 16), 'CONTROL-old-peer').toEqual({ ok: false, reason: 'unmeasured' });
    const unread = spied({ lstatMeasured: async () => ({ ok: false, reason: 'unreadable' }) });
    expect(await readRegular(unread.io, f, undefined, 16)).toEqual({ ok: false, reason: 'unreadable' });
    const fault = spied({ readFileFromBytesMeasured: async () => ({ ok: false, reason: 'unreadable' }) });
    expect(await readRegular(fault.io, f, undefined, 16)).toEqual({ ok: false, reason: 'unreadable' });
    const raced = spied({ readFileFromBytesMeasured: async () => ({ ok: false, reason: 'absent' }) });
    expect(await readRegular(raced.io, f, undefined, 16)).toEqual({ ok: false, reason: 'absent' });
    const fifo = path.join(dir, 'fifo'); execFileSync('mkfifo', [fifo]);
    expect(await readRegular(spied().io, fifo, undefined, 16)).toEqual({ ok: false, reason: 'unreadable' });
  });
});

describe('readLandingControl', () => {
  let reg: string;
  beforeEach(() => { reg = path.join(mkTmp('ccrc-control-reg-'), '.cc-sessions'); mkdirSync(path.join(reg, 'landing', P), { recursive: true }); });
  const file = (name: string): string => path.join(reg, 'landing', P, name);
  const probeRead = (): ProbeRead => parseProbe(text(probeDoc()), P, now);

  it('CONTROL-prepass: a marker older than the probe is ready when each window passes', async () => {
    writeFileSync(file('lander'), text(lander({ at: iso(-1100) })));
    writeFileSync(file('main-health'), text(health({ at: iso(-5) })));
    const c = await readLandingControl(localIO, reg, P, probeRead(), now);
    expect(c.lander).toMatchObject({ ok: true, doc: { at: iso(-1100) } });
    expect(c.health).toMatchObject({ ok: true, doc: { at: iso(-5), state: 'green' } });
    expect(c.probe).toMatchObject({ ok: true, doc: { baseSha: CONTROL_BASE_SHA } });
  });

  it('takes the probe it is given and reads it never again', async () => {
    const seen: string[] = [];
    const io: FleetIO = { ...localIO, readFileFromBytesMeasured: (p, o, m, t, s) => { seen.push(p); return localIO.readFileFromBytesMeasured(p, o, m, t, s); } };
    writeFileSync(file('lander'), text(lander())); writeFileSync(file('main-health'), text(health())); writeFileSync(file('probe'), text(probeDoc()));
    const given = { ok: false, reason: 'oversize', size: 9 } as const;
    expect((await readLandingControl(io, reg, P, given, now)).probe).toBe(given);
    expect(seen.map((p) => path.basename(p)).sort()).toEqual(['lander', 'main-health']);
  });

  it('absent, oversize, malformed, stale and unreadable stay apart per document', async () => {
    const none = await readLandingControl(localIO, reg, P, { ok: false, reason: 'absent' }, now);
    expect(none.lander).toEqual({ ok: false, reason: 'absent' });
    expect(none.health).toEqual({ ok: false, reason: 'absent' });
    writeFileSync(file('lander'), 'x'.repeat(4097));
    writeFileSync(file('main-health'), text(health({ at: iso(-5000) })));
    const c = await readLandingControl(localIO, reg, P, probeRead(), now);
    expect(c.lander).toEqual({ ok: false, reason: 'oversize', size: 4097 });
    expect(c.health).toEqual({ ok: false, reason: 'stale' });
    writeFileSync(file('lander'), '{"v":1}'); writeFileSync(file('main-health'), '{');
    const m = await readLandingControl(localIO, reg, P, probeRead(), now);
    expect(m.lander).toEqual({ ok: false, reason: 'malformed' });
    expect(m.health).toEqual({ ok: false, reason: 'malformed' });
    writeFileSync(file('lander'), Buffer.from([0xff]));
    expect((await readLandingControl(localIO, reg, P, probeRead(), now)).lander).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('CONTROL-old-peer: an io that cannot lstat is unmeasured, never absent', async () => {
    const io: FleetIO = { ...localIO, lstatMeasured: async () => ({ ok: false, reason: 'unmeasured' }) };
    const c = await readLandingControl(io, reg, P, probeRead(), now);
    expect(c.lander).toEqual({ ok: false, reason: 'unmeasured' });
    expect(c.health).toEqual({ ok: false, reason: 'unmeasured' });
  });

  it('a project that is not a safe segment is refused with no io', async () => {
    const spy = vi.fn();
    const io = new Proxy(localIO, { get: (t, k) => { spy(String(k)); return (t as never)[k]; } }) as FleetIO;
    const c = await readLandingControl(io, reg, '../x', { ok: false, reason: 'refused' }, now);
    expect(c.lander).toEqual({ ok: false, reason: 'refused' });
    expect(c.health).toEqual({ ok: false, reason: 'refused' });
    expect(spy).not.toHaveBeenCalled();
  });

  describe('the marker ancestors, from the registry boundary through landing/<project>', () => {
    const arm = (): void => { writeFileSync(file('lander'), text(lander())); };
    const spyIO = (over: Partial<FleetIO> = {}): { io: FleetIO; bytes: ReturnType<typeof vi.fn> } => {
      const bytes = vi.fn();
      return { bytes, io: { ...localIO, readFileFromBytesMeasured: (p, o, m, t, s) => { bytes(p); return localIO.readFileFromBytesMeasured(p, o, m, t, s); }, ...over } };
    };

    it('a symlinked landing directory is absent for the marker, and no target byte is read', async () => {
      arm();
      const target = path.join(path.dirname(reg), 'target');
      mkdirSync(path.join(target, P), { recursive: true });
      writeFileSync(path.join(target, P, 'lander'), text(lander()));
      const before = readFileSync(path.join(target, P, 'lander'), 'utf8');
      const moved = path.join(path.dirname(reg), 'real-landing');
      execFileSync('mv', [path.join(reg, 'landing'), moved]);
      symlinkSync(target, path.join(reg, 'landing'));
      const s = spyIO();
      expect((await readLandingControl(s.io, reg, P, probeRead(), now)).lander).toEqual({ ok: false, reason: 'absent' });
      expect(s.bytes, 'no target bytes through a symlinked ancestor').not.toHaveBeenCalledWith(expect.stringContaining('lander'));
      expect(readFileSync(path.join(target, P, 'lander'), 'utf8')).toBe(before);
    });

    it('a symlinked project directory is absent for the marker', async () => {
      const target = path.join(path.dirname(reg), 'target-project');
      mkdirSync(target, { recursive: true });
      writeFileSync(path.join(target, 'lander'), text(lander()));
      execFileSync('mv', [path.join(reg, 'landing', P), path.join(path.dirname(reg), 'moved-project')]);
      symlinkSync(target, path.join(reg, 'landing', P));
      const s = spyIO();
      expect((await readLandingControl(s.io, reg, P, probeRead(), now)).lander).toEqual({ ok: false, reason: 'absent' });
      expect(s.bytes).not.toHaveBeenCalledWith(expect.stringContaining('lander'));
    });

    it('an unmeasurable component is unmeasured; a non-directory is unreadable; a missing project directory is absent', async () => {
      arm();
      const blind: FleetIO = { ...localIO, lstatMeasured: async (p) => (p.endsWith(`${path.sep}landing`) ? { ok: false, reason: 'unmeasured' } : localIO.lstatMeasured(p)) };
      expect((await readLandingControl(blind, reg, P, probeRead(), now)).lander).toEqual({ ok: false, reason: 'unmeasured' });
      const fault: FleetIO = { ...localIO, lstatMeasured: async (p) => (p.endsWith(`${path.sep}${P}`) ? { ok: false, reason: 'unreadable' } : localIO.lstatMeasured(p)) };
      expect((await readLandingControl(fault, reg, P, probeRead(), now)).lander).toEqual({ ok: false, reason: 'unreadable' });
      const asFile = path.join(path.dirname(reg), 'p-file');
      writeFileSync(asFile, 'x');
      const regular: FleetIO = { ...localIO, lstatMeasured: async (p) => (p.endsWith(`${path.sep}${P}`) ? { ok: true, kind: 'regular' } : localIO.lstatMeasured(p)) };
      expect((await readLandingControl(regular, reg, P, probeRead(), now)).lander).toEqual({ ok: false, reason: 'unreadable' });
      execFileSync('rm', ['-r', path.join(reg, 'landing', P)]);
      expect((await readLandingControl(localIO, reg, P, probeRead(), now)).lander).toEqual({ ok: false, reason: 'absent' });
    });

    it("lstat 'other' is not proof of a directory: a FIFO in the chain fails closed, and a listing that fails fails closed", async () => {
      arm();
      const spy = spyIO({ lstatMeasured: async (p) => (p.endsWith(`${path.sep}${P}`) ? { ok: true, kind: 'other' } : localIO.lstatMeasured(p)), readdirMeasured: async (p) => (p.endsWith(`${path.sep}${P}`) ? { ok: false, reason: 'unreadable' } : localIO.readdirMeasured(p)) });
      expect((await readLandingControl(spy.io, reg, P, probeRead(), now)).lander).toEqual({ ok: false, reason: 'unreadable' });
      expect(spy.bytes).not.toHaveBeenCalledWith(expect.stringContaining('lander'));
    });

    it('the chain is rechecked after the read: a symlink swapped in meanwhile is absent', async () => {
      arm();
      const swapped = path.join(path.dirname(reg), 'elsewhere');
      mkdirSync(swapped, { recursive: true });
      let swappedIn = false;
      const io: FleetIO = {
        ...localIO,
        readFileFromBytesMeasured: async (p, o, m, t, s) => {
          const r = await localIO.readFileFromBytesMeasured(p, o, m, t, s);
          if (p.endsWith('lander') && !swappedIn) {
            swappedIn = true;
            execFileSync('mv', [path.join(reg, 'landing', P), path.join(path.dirname(reg), 'aside')]);
            symlinkSync(swapped, path.join(reg, 'landing', P));
          }
          return r;
        },
      };
      expect((await readLandingControl(io, reg, P, probeRead(), now)).lander).toEqual({ ok: false, reason: 'absent' });
    });
  });
});

// ---- wave 5i, Task 3: the binding head and the main-red transition (pure L1, `coord/landingLine.ts`) -------------------
const entry = (pr: number, over: Partial<LandingEntry> = {}): LandingEntry => ({
  id: pr + 100, project: P, pr, pinnedSha: CONTROL_HEAD_SHA, handoffCommit: CONTROL_HEAD_SHA, runId: pr * 10, state: 'pinned',
  baseSha: null, ejectionKind: null, ejections: 0, afterIds: [], fixesMain: false, setBy: 'coordinator-a', pinnedAt: now - 3000 + pr, ...over,
});
const factsOf = (entries: LandingEntry[] = [entry(7)], over: Partial<LandingMutationFacts> = {}): LandingMutationFacts => ({
  project: P, flags: { operatorPaused: false, mainRedHold: false }, entries,
  projections: entries.map((x) => ({ id: x.id, value: { kind: 'readable' as const, quarantine: null } })),
  dependencies: entries.map((x) => ({ id: x.id, value: { kind: 'readable' as const, afterIds: x.afterIds } })),
  recovery: { subjects: [], hold: null }, nextId: 200, foreignIds: [],
  coordinators: entries.map((x) => ({ id: x.id, value: { kind: 'no-run' as const } })), terminalRepairs: [], creations: [], ...over,
});
const probeWith = (over: Record<string, unknown> = {}, headOver: Record<string, unknown> = {}) => {
  const base = controlRead();
  if (!base.probe.ok) throw new Error('fixture');
  const doc = base.probe.doc;
  return { ok: true as const, doc: { ...doc, ...over, heads: over.heads ?? [{ ...doc.heads[0]!, ...headOver }] } } as ProbeRead;
};
const healthWith = (over: Record<string, unknown> = {}) => {
  const base = controlRead();
  if (!base.health.ok) throw new Error('fixture');
  return { ok: true as const, doc: { ...base.health.doc, ...over } } as typeof base.health;
};
const RED_HEALTH = { state: 'red', failing: ['required-a'] };
const OTHER_BASE = 'c'.repeat(40);

describe('landingBindingOf: precedence and the evidence it binds', () => {
  it('baseline: ready, with every fact the cue needs and no persisted readiness', () => {
    expect(landingBindingOf(factsOf(), controlRead(), now)).toEqual({
      mode: 'ready', entryId: 107, pr: 7, pinnedSha: CONTROL_HEAD_SHA, baseSha: CONTROL_BASE_SHA,
      landerAt: '2026-11-14T11:59:58Z', probeAt: '2026-11-14T11:59:59Z', healthAt: '2026-11-14T12:00:00Z', fixesMain: false,
    });
  });
  it('proven marker absence is inert; every other marker failure holds opt-in-unknown; undefined control is unmeasured', () => {
    expect(landingBindingOf(factsOf(), controlRead({ lander: { ok: false, reason: 'absent' } }), now)).toEqual({ mode: 'inert' });
    for (const reason of ['unreadable', 'oversize', 'malformed', 'stale', 'unmeasured', 'late', 'refused'] as const) {
      expect(landingBindingOf(factsOf(), controlRead({ lander: { ok: false, reason } }), now), reason)
        .toEqual({ mode: 'held', reason: 'opt-in-unknown', entryId: 107 });
    }
    expect(landingBindingOf(factsOf(), undefined, now)).toEqual({ mode: 'held', reason: 'opt-in-unknown', entryId: 107 });
    expect(landingBindingOf(factsOf([]), undefined, now)).toEqual({ mode: 'held', reason: 'opt-in-unknown', entryId: null });
  });
  it('CONTROL-foreign: documents of another project hold; a stale marker at decision time holds opt-in-unknown', () => {
    const other = (r: { ok: true; doc: object }) => ({ ...r, doc: { ...r.doc, project: 'project-b' } });
    const c = controlRead();
    const foreign = { lander: other(c.lander as { ok: true; doc: object }), probe: other(c.probe as { ok: true; doc: object }), health: other(c.health as { ok: true; doc: object }) } as unknown as typeof c;
    expect(landingBindingOf(factsOf(), foreign, now)).toMatchObject({ mode: 'held', reason: 'opt-in-unknown' });
    expect(landingBindingOf(factsOf(), controlRead(), now + 1300 * 1000)).toMatchObject({ mode: 'held' });
    const lonely = controlRead({ probe: other(c.probe as { ok: true; doc: object }) as never });
    expect(landingBindingOf(factsOf(), lonely, now)).toMatchObject({ mode: 'held', reason: 'probe-unmeasured' });
    const lonelyH = controlRead({ health: other(c.health as { ok: true; doc: object }) as never });
    expect(landingBindingOf(factsOf(), lonelyH, now)).toMatchObject({ mode: 'held', reason: 'health-unmeasured' });
  });
  it('CONTROL-prepass: a marker many seconds older than the probe is ready while every window passes', () => {
    const c = controlRead();
    const old = { ok: true as const, doc: { ...(c.lander as { ok: true; doc: { project: string; lander: 'coordinator'; at: string } }).doc, at: '2026-11-14T11:55:00Z' } };
    expect(landingBindingOf(factsOf(), controlRead({ lander: old }), now)).toMatchObject({ mode: 'ready', landerAt: '2026-11-14T11:55:00Z' });
  });
  it('an operator pause holds paused, after the marker and before recovery', () => {
    const paused = factsOf([entry(7)], { flags: { operatorPaused: true, mainRedHold: false } });
    expect(landingBindingOf(paused, controlRead(), now)).toEqual({ mode: 'held', reason: 'paused', entryId: 107 });
    expect(landingBindingOf(paused, controlRead({ lander: { ok: false, reason: 'unmeasured' } }), now)).toMatchObject({ reason: 'opt-in-unknown' });
    expect(landingBindingOf(paused, controlRead({ lander: { ok: false, reason: 'absent' } }), now)).toEqual({ mode: 'inert' });
    const both = factsOf([entry(7)], { flags: { operatorPaused: true, mainRedHold: false }, recovery: { subjects: [], hold: { reason: 'landing-recovery-unresolved', subjectIds: [107] } } });
    expect(landingBindingOf(both, controlRead(), now)).toMatchObject({ reason: 'paused' });
  });
  it('recovery holds with no head to bind; an unreadable open projection holds independently of the journal', () => {
    const rec = factsOf([entry(7)], { recovery: { subjects: [], hold: { reason: 'landing-recovery-unresolved', subjectIds: [107] } } });
    expect(landingBindingOf(rec, controlRead(), now)).toEqual({ mode: 'held', reason: 'recovery', entryId: 107 });
    const bad = factsOf([entry(7), entry(9, { state: 'unknown' })], {
      projections: [{ id: 107, value: { kind: 'readable', quarantine: null } }, { id: 109, value: { kind: 'unreadable' } }] });
    expect(landingBindingOf(bad, controlRead(), now)).toMatchObject({ mode: 'held', reason: 'projection-unreadable' });
    const missing = factsOf([entry(7)], { projections: [] });
    expect(landingBindingOf(missing, controlRead(), now)).toMatchObject({ reason: 'projection-unreadable' });
    const dep = factsOf([entry(7)], { dependencies: [{ id: 107, value: { kind: 'unreadable' } }] });
    expect(landingBindingOf(dep, controlRead(), now)).toMatchObject({ reason: 'projection-unreadable' });
  });
  it('ORDER-unknown: an unreadable terminal row is not an open blocker, an unreadable open one is', () => {
    const terminal = factsOf([entry(7), entry(5, { state: 'landed' })], {
      projections: [{ id: 107, value: { kind: 'readable', quarantine: null } }, { id: 105, value: { kind: 'unreadable' } }] });
    expect(landingBindingOf(terminal, controlRead(), now).mode).toBe('ready');
    const open = factsOf([entry(7), entry(8, { state: 'ejected', ejections: 1 })], {
      projections: [{ id: 107, value: { kind: 'readable', quarantine: null } }, { id: 108, value: { kind: 'unreadable' } }] });
    expect(landingBindingOf(open, controlRead(), now)).toMatchObject({ reason: 'projection-unreadable' });
  });
  it('ORDER-unknown (fix round 1): a nonterminal unknown row holds, quarantined or clean; a terminal damaged row does not', () => {
    const quarantined = factsOf([entry(7), entry(9, { state: 'unknown' })], {
      projections: [{ id: 107, value: { kind: 'readable', quarantine: null } }, { id: 109, value: { kind: 'readable', quarantine: 'stale-episode-head' } }] });
    expect(landingBindingOf(quarantined, controlRead(), now)).toEqual({ mode: 'held', reason: 'projection-unreadable', entryId: 107 });
    const cleanUnknown = factsOf([entry(7), entry(9, { state: 'unknown' })]);
    expect(landingBindingOf(cleanUnknown, controlRead(), now)).toMatchObject({ mode: 'held', reason: 'projection-unreadable' });
    const quarantinedPinned = factsOf([entry(7)], { projections: [{ id: 107, value: { kind: 'readable', quarantine: 'stale-episode-head' } }] });
    expect(landingBindingOf(quarantinedPinned, controlRead(), now)).toMatchObject({ reason: 'projection-unreadable' });
    const closed = factsOf([entry(7), entry(5, { state: 'closed' })], {
      projections: [{ id: 107, value: { kind: 'readable', quarantine: null } }, { id: 105, value: { kind: 'unreadable' } }] });
    expect(landingBindingOf(closed, controlRead(), now).mode).toBe('ready');
  });
  it('ORDER-unknown (fix round 2): an open row in an unrecognised state word holds even with a clean projection', () => {
    const f = factsOf([entry(7), entry(9, { state: 'mystery' as LandingEntry['state'] })]);
    expect(landingBindingOf(f, controlRead(), now)).toMatchObject({ mode: 'held', reason: 'projection-unreadable' });
  });
  it('an empty line or a blocked remainder holds empty-or-blocked with no entry', () => {
    expect(landingBindingOf(factsOf([]), controlRead(), now)).toEqual({ mode: 'held', reason: 'empty-or-blocked', entryId: null });
    const cyc = factsOf([entry(1, { afterIds: [102] }), entry(2, { afterIds: [101] })]);
    expect(landingBindingOf(cyc, controlRead(), now)).toEqual({ mode: 'held', reason: 'empty-or-blocked', entryId: null });
  });
  it('probe and health availability: every failure, a cut head list and a stale reading hold their own reason', () => {
    for (const reason of ['absent', 'unreadable', 'oversize', 'malformed', 'stale', 'unmeasured', 'late', 'refused'] as const) {
      expect(landingBindingOf(factsOf(), controlRead({ probe: { ok: false, reason } as never }), now), `probe ${reason}`)
        .toEqual({ mode: 'held', reason: 'probe-unmeasured', entryId: 107 });
      expect(landingBindingOf(factsOf(), controlRead({ health: { ok: false, reason } }), now), `health ${reason}`)
        .toEqual({ mode: 'held', reason: 'health-unmeasured', entryId: 107 });
    }
    expect(landingBindingOf(factsOf(), controlRead({ probe: probeWith({ headsCut: true }) }), now)).toMatchObject({ reason: 'probe-unmeasured' });
    expect(landingBindingOf(factsOf(), controlRead({ probe: probeWith({ at: '2026-11-14T11:30:00Z' }) }), now)).toMatchObject({ reason: 'probe-unmeasured' });
    expect(landingBindingOf(factsOf(), controlRead({ health: healthWith({ at: '2026-11-14T11:30:00Z' }) }), now)).toMatchObject({ reason: 'health-unmeasured' });
    expect(landingBindingOf(factsOf(), controlRead({ health: healthWith({ state: 'unmeasured', why: 'pending', pending: ['required-a'] }) }), now)).toMatchObject({ reason: 'health-unmeasured' });
    expect(landingBindingOf(factsOf(), controlRead({ health: healthWith({ state: 'unmeasured', sha: null, why: 'fetch-failed' }) }), now)).toMatchObject({ reason: 'health-unmeasured' });
  });
  it('freshness rechecked at use: a boundary reading follows freshWithin, a future one is refused', () => {
    expect(landingBindingOf(factsOf(), controlRead({ probe: probeWith({ at: '2026-11-14T11:40:00Z' }) }), now).mode).toBe('ready');
    expect(landingBindingOf(factsOf(), controlRead({ probe: probeWith({ at: '2026-11-14T11:39:59Z' }) }), now)).toMatchObject({ reason: 'probe-unmeasured' });
    expect(landingBindingOf(factsOf(), controlRead({ health: healthWith({ at: '2026-11-14T13:00:00Z' }) }), now)).toMatchObject({ reason: 'health-unmeasured' });
  });
  it('base mismatch: health and probe must name the same full base sha', () => {
    expect(landingBindingOf(factsOf(), controlRead({ health: healthWith({ sha: OTHER_BASE }) }), now)).toEqual({ mode: 'held', reason: 'base-mismatch', entryId: 107 });
    expect(landingBindingOf(factsOf(), controlRead({ probe: probeWith({ baseSha: OTHER_BASE }) }), now)).toMatchObject({ reason: 'base-mismatch' });
  });
  it('head mismatch: the exact PR and full pinned sha; absent, other or doubled heads hold', () => {
    expect(landingBindingOf(factsOf(), controlRead({ probe: probeWith({}, { head: 'd'.repeat(40) }) }), now)).toEqual({ mode: 'held', reason: 'head-mismatch', entryId: 107 });
    expect(landingBindingOf(factsOf(), controlRead({ probe: probeWith({}, { pr: 8 }) }), now)).toMatchObject({ reason: 'head-mismatch' });
    expect(landingBindingOf(factsOf(), controlRead({ probe: probeWith({ heads: [] }) }), now)).toMatchObject({ reason: 'head-mismatch' });
    const h = { pr: 7, head: CONTROL_HEAD_SHA, branch: 'ws/alpha', id: null, base: { state: 'clean' } };
    expect(landingBindingOf(factsOf(), controlRead({ probe: probeWith({ heads: [h, { ...h, branch: 'ws/beta' }] }) }), now)).toMatchObject({ reason: 'head-mismatch' });
  });
  it('a no-run head (id null) binds by PR and full sha; the entry id still comes from the line', () => {
    const noRun = factsOf([entry(7, { runId: null })]);
    expect(landingBindingOf(noRun, controlRead({ probe: probeWith({}, { id: null }) }), now)).toMatchObject({ mode: 'ready', entryId: 107, pr: 7 });
  });
  it('ORDER-no-skip: a conflicting selected head holds on its own entry and never searches the next PR', () => {
    const f = factsOf([entry(7), entry(8)]);
    const probe = probeWith({ heads: [
      { pr: 7, head: CONTROL_HEAD_SHA, branch: 'ws/a', id: null, base: { state: 'conflict', paths: ['x'], pathsCut: false } },
      { pr: 8, head: CONTROL_HEAD_SHA, branch: 'ws/b', id: null, base: { state: 'clean' } }] });
    expect(landingBindingOf(f, controlRead({ probe }), now)).toEqual({ mode: 'held', reason: 'composition-not-clean', entryId: 107 });
    const unmeasured = probeWith({}, { base: { state: 'unmeasured' } });
    expect(landingBindingOf(factsOf(), controlRead({ probe: unmeasured }), now)).toMatchObject({ reason: 'composition-not-clean' });
  });
  it('pairwise annotations select no successor and need no unrelated pending PR to pass', () => {
    const probe = probeWith({ pairsCut: true, pairHeads: [7, 8], pairs: [{ a: 7, b: 8, answer: { state: 'conflict', paths: [], pathsCut: false } }] });
    expect(landingBindingOf(factsOf([entry(7), entry(8)]), controlRead({ probe }), now)).toMatchObject({ mode: 'ready', pr: 7 });
  });
  it('health policy: red holds main-red for an ordinary head; only the selected fixesMain head is ready under red', () => {
    const red = controlRead({ health: healthWith(RED_HEALTH) });
    expect(landingBindingOf(factsOf(), red, now)).toEqual({ mode: 'held', reason: 'main-red', entryId: 107 });
    const fix = factsOf([entry(6), entry(7, { fixesMain: true })], { flags: { operatorPaused: false, mainRedHold: true } });
    expect(landingBindingOf(fix, red, now)).toMatchObject({ mode: 'ready', pr: 7, fixesMain: true });
    expect(landingBindingOf(fix, controlRead({ health: healthWith({ state: 'unmeasured', why: 'pending', pending: ['required-a'] }) }), now))
      .toMatchObject({ mode: 'held', reason: 'health-unmeasured' });
    const behind = factsOf([entry(6), entry(7, { fixesMain: true, afterIds: [106] })]);
    const two = probeWith({ heads: [
      { pr: 6, head: CONTROL_HEAD_SHA, branch: 'ws/a', id: null, base: { state: 'clean' } },
      { pr: 7, head: CONTROL_HEAD_SHA, branch: 'ws/b', id: null, base: { state: 'clean' } }] });
    expect(landingBindingOf(behind, controlRead({ probe: two, health: healthWith(RED_HEALTH) }), now)).toEqual({ mode: 'held', reason: 'main-red', entryId: 106 });
  });
  it('a persisted flag is a fact, not a gate: green evidence with the flag still set binds ready for the same head', () => {
    const stale = factsOf([entry(7)], { flags: { operatorPaused: false, mainRedHold: true } });
    expect(landingBindingOf(stale, controlRead(), now).mode).toBe('ready');
    expect(landingBindingOf(stale, controlRead({ health: { ok: false, reason: 'unmeasured' } }), now)).toMatchObject({ reason: 'health-unmeasured' });
  });
});

describe('mainRedNext: the transition matrix', () => {
  const RED_CTL = controlRead({ health: healthWith(RED_HEALTH) });
  const PENDING = controlRead({ health: healthWith({ state: 'unmeasured', why: 'pending', pending: ['required-a'] }) });
  it('green is the only clearing input; red sets; a no-change reading keeps', () => {
    expect(mainRedNext(true, controlRead(), now, P)).toEqual({ kind: 'set', value: false, sha: CONTROL_BASE_SHA, at: '2026-11-14T12:00:00Z' });
    expect(mainRedNext(false, RED_CTL, now, P)).toEqual({ kind: 'set', value: true, sha: CONTROL_BASE_SHA, at: '2026-11-14T12:00:00Z' });
    expect(mainRedNext(true, RED_CTL, now, P)).toEqual({ kind: 'keep', value: true });
    expect(mainRedNext(false, controlRead(), now, P)).toEqual({ kind: 'keep', value: false });
  });
  it('pending and unmeasured readings keep either prior value', () => {
    for (const prev of [true, false]) {
      expect(mainRedNext(prev, PENDING, now, P)).toEqual({ kind: 'keep', value: prev });
      expect(mainRedNext(prev, controlRead({ health: healthWith({ state: 'unmeasured', sha: null, why: 'fetch-failed' }) }), now, P)).toEqual({ kind: 'keep', value: prev });
    }
  });
  it('every failure of any document keeps the prior value', () => {
    for (const prev of [true, false]) {
      for (const reason of ['absent', 'unreadable', 'oversize', 'malformed', 'stale', 'unmeasured', 'late', 'refused'] as const) {
        const keep = { kind: 'keep', value: prev };
        expect(mainRedNext(prev, controlRead({ health: { ok: false, reason } }), now, P), `health ${reason}`).toEqual(keep);
        expect(mainRedNext(prev, controlRead({ probe: { ok: false, reason } as never, health: healthWith(RED_HEALTH) }), now, P), `probe ${reason}`).toEqual(keep);
        expect(mainRedNext(prev, controlRead({ lander: { ok: false, reason }, health: healthWith(RED_HEALTH) }), now, P), `lander ${reason}`).toEqual(keep);
      }
    }
  });
  it('a mismatched base, a stale or future reading, or a foreign project keeps the prior value', () => {
    expect(mainRedNext(true, controlRead({ health: healthWith({ sha: OTHER_BASE }) }), now, P)).toEqual({ kind: 'keep', value: true });
    expect(mainRedNext(false, controlRead({ health: healthWith({ ...RED_HEALTH, sha: OTHER_BASE }) }), now, P)).toEqual({ kind: 'keep', value: false });
    expect(mainRedNext(true, controlRead({ health: healthWith({ at: '2026-11-14T11:30:00Z' }) }), now, P)).toEqual({ kind: 'keep', value: true });
    expect(mainRedNext(false, controlRead({ probe: probeWith({ at: '2026-11-14T11:30:00Z' }), health: healthWith(RED_HEALTH) }), now, P)).toEqual({ kind: 'keep', value: false });
    expect(mainRedNext(false, controlRead({ health: healthWith({ ...RED_HEALTH, at: '2026-11-14T13:00:00Z' }) }), now, P)).toEqual({ kind: 'keep', value: false });
  });
  it('CONTROL-foreign: documents of another project keep the previous red', () => {
    expect(mainRedNext(true, controlRead(), now, 'project-b')).toEqual({ kind: 'keep', value: true });
    expect(mainRedNext(false, RED_CTL, now, 'project-b')).toEqual({ kind: 'keep', value: false });
    expect(mainRedNext(true, controlRead({ health: healthWith({ project: 'project-b' }) }), now, P)).toEqual({ kind: 'keep', value: true });
  });
  it('a positive lander reading is required: absent opt-in keeps the flags', () => {
    expect(mainRedNext(false, controlRead({ lander: { ok: false, reason: 'absent' }, health: healthWith(RED_HEALTH) }), now, P)).toEqual({ kind: 'keep', value: false });
    expect(mainRedNext(true, controlRead({ lander: { ok: false, reason: 'absent' } }), now, P)).toEqual({ kind: 'keep', value: true });
  });
});

describe('applyLandingControl: the measured health writes mainRedHold and never operatorPaused (M13, M14)', () => {
  afterEach(() => removeTmpFixtures());
  let store: CoordStore;
  beforeEach(() => {
    const dbPath = path.join(mkTmp('ccrc-control-flags-'), '.ccrc', 'coord.db');
    store = landingStoreOver(openCoordDb(dbPath), dbPath);
  });
  const flagsOf = (): { operatorPaused: boolean; mainRedHold: boolean } => {
    const r = store.db.prepare('SELECT operatorPaused, mainRedHold FROM landing_projects WHERE project = ?').get(P) as { operatorPaused: number; mainRedHold: number } | undefined;
    return { operatorPaused: (r?.operatorPaused ?? 0) !== 0, mainRedHold: (r?.mainRedHold ?? 0) !== 0 };
  };
  const apply = (control: ReturnType<typeof controlRead>) => store.applyLandingControl({ project: P, control, nowMs: now });
  const redCtl = controlRead({ health: healthWith(RED_HEALTH) });
  const pause = (on: boolean): void => {
    store.db.prepare('INSERT INTO landing_projects (project, operatorPaused) VALUES (?, ?) ON CONFLICT(project) DO UPDATE SET operatorPaused = excluded.operatorPaused').run(P, on ? 1 : 0);
  };

  it('red sets the flag, green clears it, and each reports exactly the change it committed', () => {
    expect(apply(redCtl)).toMatchObject({ holdChanged: true });
    expect(flagsOf()).toEqual({ operatorPaused: false, mainRedHold: true });
    expect(apply(redCtl)).toMatchObject({ holdChanged: false });
    expect(apply(controlRead())).toMatchObject({ holdChanged: true });
    expect(flagsOf()).toEqual({ operatorPaused: false, mainRedHold: false });
    expect(apply(controlRead())).toMatchObject({ holdChanged: false });
  });

  it('M14: a pause standing before red to green is still standing after', () => {
    pause(true);
    expect(apply(redCtl)).toMatchObject({ holdChanged: true });
    expect(flagsOf()).toEqual({ operatorPaused: true, mainRedHold: true });
    expect(apply(controlRead())).toMatchObject({ holdChanged: true });
    expect(flagsOf()).toEqual({ operatorPaused: true, mainRedHold: false });
  });

  it('M14: a pause placed between red and green is kept by the green transition', () => {
    expect(apply(redCtl)).toMatchObject({ holdChanged: true });
    pause(true);
    expect(apply(controlRead())).toMatchObject({ holdChanged: true });
    expect(flagsOf()).toEqual({ operatorPaused: true, mainRedHold: false });
  });

  it('M13: pending and unmeasured health never clear red, and a clear flag stays clear', () => {
    const unmeasured = controlRead({ health: healthWith({ state: 'unmeasured', why: 'pending', failing: [], pending: ['required-a'] }) });
    expect(apply(redCtl)).toMatchObject({ holdChanged: true });
    expect(apply(unmeasured)).toMatchObject({ holdChanged: false });
    expect(flagsOf().mainRedHold).toBe(true);
    expect(apply(controlRead({ health: { ok: false, reason: 'absent' } }))).toMatchObject({ holdChanged: false });
    expect(flagsOf().mainRedHold).toBe(true);
    expect(apply(controlRead())).toMatchObject({ holdChanged: true });
    expect(apply(unmeasured)).toMatchObject({ holdChanged: false });
    expect(flagsOf()).toEqual({ operatorPaused: false, mainRedHold: false });
  });

  it('M13: unknown health holds the mail independently when the flag was false, and moves no flag', () => {
    expect(store.writeLandingAuthority({ kind: 'entry', project: P, pr: 7, pinnedSha: CONTROL_HEAD_SHA, handoffCommit: 'c'.repeat(40), setBy: 'creator-a' }, 1000)).toMatchObject({ ok: true });
    expect(apply(controlRead({ health: { ok: false, reason: 'absent' } }))).toEqual({ kind: 'no-send', reason: 'health-unmeasured', holdChanged: false });
    expect(flagsOf()).toEqual({ operatorPaused: false, mainRedHold: false });
  });

  it('a foreign bundle keeps the previous red and a failed fact read writes nothing', () => {
    expect(apply(redCtl)).toMatchObject({ holdChanged: true });
    const foreign = controlRead({ health: healthWith({ ...RED_HEALTH, project: 'project-b' }) });
    expect(apply(foreign)).toMatchObject({ holdChanged: false });
    expect(flagsOf().mainRedHold).toBe(true);
  });
});
