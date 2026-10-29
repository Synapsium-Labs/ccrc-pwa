// Landing order wave 4, Task 1: the lineage decision (`coord/lineage.ts`, spec §5.4's table in its order), the two
// file parsers, and the reader that re-proves wave 3b's regular-file rule through `lstatMeasured`
// (`coord/lineageRead.ts`). Fixtures are neutral; the tmp tree is a fixture HOME only.
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { localIO, type FleetIO, type MeasuredPathKind } from '../src/io.js';
import {
  LAND_PROBE_ENABLED_FRESH_S, LINEAGE_FRESH_S, LINEAGE_MAX_BYTES,
  decideLineage, lineageQualifies, parseEnabled, parseLineage,
  type LineageInput, type LineageRead,
} from '../src/coord/lineage.js';
import { readLandingFacts } from '../src/coord/lineageRead.js';
import { absentReadIO, degradedReadIO } from './ioDoubles.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = Date.parse('2026-10-27T09:00:00Z');
const iso = (offsetS: number): string => new Date(NOW + offsetS * 1000).toISOString();
const sha = (n: number): string => n.toString(16).padStart(40, '0');
const EXPECT = { project: 'proj-a', id: 'lane-a-proj-a-alpha', branch: 'ws/alpha' };

/** A valid three-entry measured doc: tip s1 -> s2 -> s3 -> s4, each step a base merge (p2 = s9). */
const THREE = [
  { merge: sha(1), p1: sha(2), p2: sha(9) },
  { merge: sha(2), p1: sha(3), p2: sha(9) },
  { merge: sha(3), p1: sha(4), p2: sha(9) },
];
const doc = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 1, project: EXPECT.project, id: EXPECT.id, at: iso(0), state: 'measured', branch: EXPECT.branch,
  tip: sha(1), base: sha(9), chain: THREE, stop: 'not-a-merge', ...over,
});
const lin = (over: Record<string, unknown> = {}, nowMs = NOW): LineageRead =>
  parseLineage(JSON.stringify(doc(over)), EXPECT, nowMs);
/** The failed-fetch shape: `base` and `stop` null. */
const FETCH_FAILED = { state: 'unmeasured', why: 'fetch-failed', base: null, stop: null, chain: [] };

describe('parseLineage: unreadable', () => {
  const unreadable = (r: LineageRead): void => { expect(r).toEqual({ ok: false, reason: 'unreadable' }); };

  it('a valid three-entry chain is readable and carries the doc', () => {
    const r = lin();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.doc).toEqual({
        tip: sha(1), base: sha(9), state: 'measured', chain: THREE, stop: 'not-a-merge', branch: 'ws/alpha',
      });
    }
  });

  it('bad JSON', () => { unreadable(parseLineage('{not json', EXPECT, NOW)); });
  it('JSON that is not an object', () => {
    unreadable(parseLineage('[]', EXPECT, NOW));
    unreadable(parseLineage('null', EXPECT, NOW));
  });
  it('v: 2', () => { unreadable(lin({ v: 2 })); });
  it('a foreign project', () => { unreadable(lin({ project: 'proj-b' })); });
  it('a foreign id', () => { unreadable(lin({ id: 'lane-a-proj-a-beta' })); });
  it('an upper-case sha', () => { unreadable(lin({ tip: 'A'.repeat(40), chain: [] })); });
  it('a 39-character sha', () => { unreadable(lin({ base: 'a'.repeat(39) })); });
  it('a non-hex sha in a chain entry', () => {
    unreadable(lin({ chain: [{ ...THREE[0], p2: 'g'.repeat(40) }] }));
  });
  it("state: 'done'", () => { unreadable(lin({ state: 'done' })); });
  it('a measured doc with no base', () => { unreadable(lin({ base: undefined })); });
  it('a measured doc with a null base', () => { unreadable(lin({ base: null })); });
  it('a measured doc with no stop', () => { unreadable(lin({ stop: undefined })); });
  it('a measured doc with a null stop', () => { unreadable(lin({ stop: null })); });
  it('a measured doc with a null tip', () => { unreadable(lin({ tip: null, chain: [] })); });
  it('an unknown stop', () => { unreadable(lin({ stop: 'whatever' })); });
  it('a doc with no tip key at all', () => { unreadable(lin({ tip: undefined, chain: [] })); });
  it('a chain that is not an array', () => { unreadable(lin({ chain: 'x' })); });

  it('nine entries', () => {
    const chain = Array.from({ length: 9 }, (_, i) => ({ merge: sha(i + 1), p1: sha(i + 2), p2: sha(99) }));
    unreadable(lin({ chain }));
    expect(lin({ chain: chain.slice(0, 8) }).ok).toBe(true);
  });

  it('chain[0].merge is not the tip', () => { unreadable(lin({ tip: sha(5) })); });
  it('a broken p1-to-merge link', () => {
    unreadable(lin({ chain: [THREE[0], { ...THREE[1], merge: sha(7) }, THREE[2]] }));
  });
  it('a branch mismatch', () => { unreadable(lin({ branch: 'ws/beta' })); });

  it('a doc larger than LINEAGE_MAX_BYTES (16385 bytes); 16384 reads', () => {
    expect(LINEAGE_MAX_BYTES).toBe(16384);
    const sized = (bytes: number): string => {
      const bare = JSON.stringify(doc({ why: '' }));
      return JSON.stringify(doc({ why: 'x'.repeat(bytes - Buffer.byteLength(bare)) }));
    };
    expect(Buffer.byteLength(sized(16385))).toBe(16385);
    unreadable(parseLineage(sized(16385), EXPECT, NOW));
    expect(Buffer.byteLength(sized(16384))).toBe(16384);
    expect(parseLineage(sized(16384), EXPECT, NOW).ok).toBe(true);
  });
});

describe('parseLineage: readable unmeasured shapes', () => {
  it("a failed fetch's shape with a sha tip, base: null and stop: null", () => {
    const r = lin({ ...FETCH_FAILED, tip: sha(1) });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.doc.tip).toBe(sha(1));
      expect(r.doc.base).toBeUndefined();
      expect(r.doc.stop).toBeUndefined();
      expect(r.doc.state).toBe('unmeasured');
    }
  });

  it("a failed fetch's shape with a null tip", () => {
    const r = lin({ ...FETCH_FAILED, tip: null });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.tip).toBeNull();
  });

  it('the same shapes with the keys absent, and no branch key', () => {
    const r = lin({ ...FETCH_FAILED, base: undefined, stop: undefined, branch: undefined });
    expect(r.ok).toBe(true);
  });

  it('a null tip beside a non-empty chain is unreadable (chain[0].merge cannot be the tip)', () => {
    expect(lin({ ...FETCH_FAILED, tip: null, chain: [THREE[0]] })).toEqual({ ok: false, reason: 'unreadable' });
  });

  it("a walk-cut unmeasured doc: a sha base, stop: 'unmeasured', a why and a two-entry chain", () => {
    const r = lin({ state: 'unmeasured', why: 'merge-tree-timeout', stop: 'unmeasured', chain: THREE.slice(0, 2) });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.doc.state).toBe('unmeasured');
      expect(r.doc.base).toBe(sha(9));
      expect(r.doc.stop).toBe('unmeasured');
      expect(r.doc.chain).toHaveLength(2);
    }
  });
});

describe('parseLineage: stale', () => {
  const stale = (r: LineageRead): void => { expect(r).toEqual({ ok: false, reason: 'stale' }); };

  it('an otherwise valid doc 2401 s old', () => {
    expect(LINEAGE_FRESH_S).toBe(2400);
    stale(lin({ at: iso(-2401) }));
  });
  it('2399 s old is readable', () => { expect(lin({ at: iso(-2399) }).ok).toBe(true); });
  it('61 s in the future', () => { stale(lin({ at: iso(61) })); });
  it('59 s in the future is readable', () => { expect(lin({ at: iso(59) }).ok).toBe(true); });
  it('an `at` that does not parse', () => { stale(lin({ at: 'not a date' })); });
  it('an `at` that is not a string', () => {
    stale(lin({ at: NOW }));
    stale(lin({ at: undefined }));
  });
  it('an unreadable doc is unreadable before it is stale', () => {
    expect(lin({ v: 2, at: iso(-9999) })).toEqual({ ok: false, reason: 'unreadable' });
  });
});

describe('parseEnabled', () => {
  const marker = (over: Record<string, unknown> = {}): string =>
    JSON.stringify({ v: 1, project: 'proj-a', at: iso(0), ...over });

  it('valid and fresh', () => { expect(parseEnabled(marker(), 'proj-a', NOW)).toBe('trusted'); });
  it('1199 s old is trusted, 1201 s old is stale', () => {
    expect(LAND_PROBE_ENABLED_FRESH_S).toBe(1200);
    expect(parseEnabled(marker({ at: iso(-1199) }), 'proj-a', NOW)).toBe('trusted');
    expect(parseEnabled(marker({ at: iso(-1201) }), 'proj-a', NOW)).toBe('stale');
  });
  it('61 s in the future is stale; 59 s is trusted', () => {
    expect(parseEnabled(marker({ at: iso(61) }), 'proj-a', NOW)).toBe('stale');
    expect(parseEnabled(marker({ at: iso(59) }), 'proj-a', NOW)).toBe('trusted');
  });
  it('an `at` that does not parse, or is missing, is stale', () => {
    expect(parseEnabled(marker({ at: 'x' }), 'proj-a', NOW)).toBe('stale');
    expect(parseEnabled(marker({ at: undefined }), 'proj-a', NOW)).toBe('stale');
  });
  it('a foreign project is unreadable', () => {
    expect(parseEnabled(marker({ project: 'proj-b' }), 'proj-a', NOW)).toBe('unreadable');
  });
  it('bad JSON, a non-object and v: 2 are unreadable', () => {
    expect(parseEnabled('{nope', 'proj-a', NOW)).toBe('unreadable');
    expect(parseEnabled('[]', 'proj-a', NOW)).toBe('unreadable');
    expect(parseEnabled(marker({ v: 2 }), 'proj-a', NOW)).toBe('unreadable');
  });
});

describe('decideLineage', () => {
  const A = sha(2); // the claim: the step before the live tip
  const LIVE = sha(1);
  const good: LineageRead = lin();
  const input = (over: Partial<LineageInput> = {}): LineageInput => ({
    claim: A, live: LIVE, marker: 'trusted', globalPause: 'running', projectPause: 'running', qualifies: true,
    lineage: good, ...over,
  });

  it('row 1: marker absent -> today, no detail', () => {
    expect(decideLineage(input({ marker: 'absent' }))).toEqual({ answer: 'today' });
  });
  it('row 2: marker unreadable -> today, landing-marker-unreadable', () => {
    expect(decideLineage(input({ marker: 'unreadable' }))).toEqual({ answer: 'today', detail: 'landing-marker-unreadable' });
  });
  it('row 3: marker stale -> today, landing-marker-stale', () => {
    expect(decideLineage(input({ marker: 'stale' }))).toEqual({ answer: 'today', detail: 'landing-marker-stale' });
  });
  it('row 4: a paused or unknown global pause -> today', () => {
    expect(decideLineage(input({ globalPause: 'paused' }))).toEqual({ answer: 'today' });
    expect(decideLineage(input({ globalPause: 'unknown' }))).toEqual({ answer: 'today' });
  });
  it('row 4: a paused or unknown project pause -> today', () => {
    expect(decideLineage(input({ projectPause: 'paused' }))).toEqual({ answer: 'today' });
    expect(decideLineage(input({ projectPause: 'unknown' }))).toEqual({ answer: 'today' });
  });
  it('row 5: qualifies === false -> today, lineage-not-expected', () => {
    expect(decideLineage(input({ qualifies: false }))).toEqual({ answer: 'today', detail: 'lineage-not-expected' });
  });
  it('row 6: lineage absent -> unmeasured, not-yet-measured', () => {
    expect(decideLineage(input({ lineage: { ok: false, reason: 'absent' } })))
      .toEqual({ answer: 'unmeasured', detail: 'not-yet-measured' });
  });
  it('row 7: lineage unreadable -> unmeasured, lineage-unreadable', () => {
    expect(decideLineage(input({ lineage: { ok: false, reason: 'unreadable' } })))
      .toEqual({ answer: 'unmeasured', detail: 'lineage-unreadable' });
  });
  it('row 8: lineage stale -> unmeasured, lineage-stale', () => {
    expect(decideLineage(input({ lineage: { ok: false, reason: 'stale' } })))
      .toEqual({ answer: 'unmeasured', detail: 'lineage-stale' });
  });
  it('row 9: a null doc tip -> unmeasured, tip-unmeasured (never lineage-unreadable)', () => {
    const lineage = lin({ ...FETCH_FAILED, tip: null });
    expect(lineage.ok).toBe(true);
    expect(decideLineage(input({ lineage }))).toEqual({ answer: 'unmeasured', detail: 'tip-unmeasured' });
  });
  it('row 10: a doc tip older than the live tip -> unmeasured, older-than-the-live-tip, even when the claim is in its chain', () => {
    expect(decideLineage(input({ live: sha(77) }))).toEqual({ answer: 'unmeasured', detail: 'older-than-the-live-tip' });
  });
  it('row 11: the claim is a chain entry p1, tip is live -> accept', () => {
    expect(decideLineage(input())).toEqual({ answer: 'accept' });
    expect(decideLineage(input({ claim: sha(3) }))).toEqual({ answer: 'accept' });
    expect(decideLineage(input({ claim: sha(4) }))).toEqual({ answer: 'accept' });
  });
  it('row 11: a partly-measured doc accepts a claim found in its chain (D-7106)', () => {
    const lineage = lin({ state: 'unmeasured', why: 'merge-tree-timeout', stop: 'unmeasured', chain: THREE.slice(0, 2) });
    expect(decideLineage(input({ lineage, claim: sha(3) }))).toEqual({ answer: 'accept' });
  });
  it("row 12: an unmeasured doc without the claim -> unmeasured, partly-measured", () => {
    const lineage = lin({ state: 'unmeasured', why: 'merge-tree-timeout', stop: 'unmeasured', chain: THREE.slice(0, 2) });
    expect(decideLineage(input({ lineage, claim: sha(50) }))).toEqual({ answer: 'unmeasured', detail: 'partly-measured' });
  });
  it('row 13: a measured doc without the claim -> today (no such chain)', () => {
    expect(decideLineage(input({ claim: sha(50) }))).toEqual({ answer: 'today' });
  });
  it('the claim is matched against p1 only, never merge or p2', () => {
    expect(decideLineage(input({ claim: sha(1) }))).toEqual({ answer: 'today' });
    expect(decideLineage(input({ claim: sha(9) }))).toEqual({ answer: 'today' });
  });

  describe('precedence', () => {
    it('an unreadable marker with an accepting lineage still answers today', () => {
      expect(decideLineage(input({ marker: 'unreadable' }))).toEqual({ answer: 'today', detail: 'landing-marker-unreadable' });
    });
    it('qualifies === false with an accepting lineage still answers today', () => {
      expect(decideLineage(input({ qualifies: false }))).toEqual({ answer: 'today', detail: 'lineage-not-expected' });
    });
    it('a marker row beats a lineage row: a stale marker with an absent lineage is today, not unmeasured', () => {
      expect(decideLineage(input({ marker: 'stale', lineage: { ok: false, reason: 'absent' } })))
        .toEqual({ answer: 'today', detail: 'landing-marker-stale' });
    });
    it('a pause beats a lineage row, an unknown pause with an accepting lineage is today', () => {
      expect(decideLineage(input({ globalPause: 'unknown' }))).toEqual({ answer: 'today' });
      expect(decideLineage(input({ projectPause: 'unknown', lineage: { ok: false, reason: 'absent' } })))
        .toEqual({ answer: 'today' });
    });
    it('a pause beats qualifies: a paused project that does not qualify is today with no detail', () => {
      expect(decideLineage(input({ projectPause: 'paused', qualifies: false }))).toEqual({ answer: 'today' });
    });
    it('qualifies beats the lineage rows: a non-qualifying row with an absent lineage is today', () => {
      expect(decideLineage(input({ qualifies: false, lineage: { ok: false, reason: 'absent' } })))
        .toEqual({ answer: 'today', detail: 'lineage-not-expected' });
    });
  });
});

describe('readLandingFacts', () => {
  const ENABLED = (): string => JSON.stringify({ v: 1, project: 'proj-a', at: iso(0) });
  const LINEAGE = (): string => JSON.stringify(doc());

  /** A fixture `$REG` with the files named, as real regular files. */
  function reg(files: { enabled?: boolean; lineage?: boolean; globalPause?: boolean; projectPause?: boolean } = {}): string {
    const dir = mkTmp('ccrc-lineage-');
    const proj = path.join(dir, 'landing', 'proj-a');
    mkdirSync(proj, { recursive: true });
    if (files.enabled) writeFileSync(path.join(proj, 'enabled'), ENABLED());
    if (files.lineage) writeFileSync(path.join(proj, `${EXPECT.id}.lineage`), LINEAGE());
    if (files.globalPause) writeFileSync(path.join(dir, 'land-probe-paused'), '');
    if (files.projectPause) writeFileSync(path.join(proj, 'paused'), '');
    return dir;
  }
  const facts = (io: Pick<FleetIO, 'readFileMeasured' | 'lstatMeasured'>, dir: string) =>
    readLandingFacts(io, dir, EXPECT.project, EXPECT.id, EXPECT.branch, NOW);
  /** Every lstat of a path ending in `suffix` answers `answer`; everything else is the real one. */
  const lstatAnswering = (suffix: string, answer: MeasuredPathKind): FleetIO => ({
    ...localIO,
    lstatMeasured: async (p) => (p.endsWith(suffix) ? answer : localIO.lstatMeasured(p)),
  });

  it('nothing written: marker absent, both pauses running, lineage absent', async () => {
    expect(await facts(localIO, reg())).toEqual({
      marker: 'absent', globalPause: 'running', projectPause: 'running', lineage: { ok: false, reason: 'absent' },
    });
  });

  it('every file in place: trusted, running, running and a readable lineage', async () => {
    const f = await facts(localIO, reg({ enabled: true, lineage: true }));
    expect(f.marker).toBe('trusted');
    expect(f.globalPause).toBe('running');
    expect(f.projectPause).toBe('running');
    expect(f.lineage.ok).toBe(true);
  });

  it('reads the paths the probe writes: a lineage for another id is not this row\'s', async () => {
    const dir = reg({ enabled: true });
    writeFileSync(path.join(dir, 'landing', 'proj-a', 'lane-a-proj-a-beta.lineage'), LINEAGE());
    expect((await facts(localIO, dir)).lineage).toEqual({ ok: false, reason: 'absent' });
  });

  it('an enabled marker for another project dir is not read', async () => {
    const dir = reg();
    mkdirSync(path.join(dir, 'landing', 'proj-b'), { recursive: true });
    writeFileSync(path.join(dir, 'landing', 'proj-b', 'enabled'), JSON.stringify({ v: 1, project: 'proj-b', at: iso(0) }));
    expect((await facts(localIO, dir)).marker).toBe('absent');
  });

  it('the parsers see the nowMs it is given: an old marker and lineage read stale', async () => {
    const dir = reg({ enabled: true, lineage: true });
    const f = await readLandingFacts(localIO, dir, EXPECT.project, EXPECT.id, EXPECT.branch, NOW + 3000 * 1000);
    expect(f.marker).toBe('stale');
    expect(f.lineage).toEqual({ ok: false, reason: 'stale' });
  });

  it('a lineage written for a foreign branch is unreadable', async () => {
    const dir = reg({ enabled: true, lineage: true });
    const f = await readLandingFacts(localIO, dir, EXPECT.project, EXPECT.id, 'ws/other', NOW);
    expect(f.lineage).toEqual({ ok: false, reason: 'unreadable' });
  });

  describe('the marker: absent and unreadable are kept apart', () => {
    it('a read that proves absence is absent', async () => {
      const dir = reg({ enabled: true });
      expect((await facts(absentReadIO((p) => p.endsWith('/enabled')), dir)).marker).toBe('absent');
    });
    it('a read that fails otherwise is unreadable', async () => {
      const dir = reg({ enabled: true });
      expect((await facts(degradedReadIO((p) => p.endsWith('/enabled')), dir)).marker).toBe('unreadable');
    });
    it('a lstat that proves absence is absent', async () => {
      const dir = reg({ enabled: true });
      expect((await facts(lstatAnswering('/enabled', { ok: false, reason: 'absent' }), dir)).marker).toBe('absent');
    });
    it('a lstat that fails otherwise is unreadable', async () => {
      const dir = reg({ enabled: true });
      expect((await facts(lstatAnswering('/enabled', { ok: false, reason: 'unreadable' }), dir)).marker).toBe('unreadable');
    });
    it('an unmeasured lstat is unreadable, not absent', async () => {
      const dir = reg({ enabled: true });
      expect((await facts(lstatAnswering('/enabled', { ok: false, reason: 'unmeasured' }), dir)).marker).toBe('unreadable');
    });
    it('a symlinked enabled marker is unreadable, even to a valid file, and is never read', async () => {
      const dir = reg();
      const target = path.join(dir, 'real-enabled');
      writeFileSync(target, ENABLED());
      symlinkSync(target, path.join(dir, 'landing', 'proj-a', 'enabled'));
      const read: string[] = [];
      const io: FleetIO = {
        ...localIO,
        readFileMeasured: async (p, t, s) => { read.push(p); return localIO.readFileMeasured(p, t, s); },
      };
      expect((await facts(io, dir)).marker).toBe('unreadable');
      expect(read.filter((p) => p.endsWith('/enabled'))).toEqual([]);
    });
    it('an enabled that is a directory is unreadable', async () => {
      const dir = reg();
      mkdirSync(path.join(dir, 'landing', 'proj-a', 'enabled'));
      expect((await facts(localIO, dir)).marker).toBe('unreadable');
    });
    it('a regular file the read then fails on as unreadable is unreadable', async () => {
      const dir = reg({ enabled: true });
      const io = degradedReadIO((p) => p.endsWith('/enabled'));
      expect((await facts(io, dir)).marker).toBe('unreadable');
    });
  });

  describe('the lineage: absent and unreadable are kept apart', () => {
    const file = `/${EXPECT.id}.lineage`;
    it('a read that proves absence is absent', async () => {
      const dir = reg({ lineage: true });
      expect((await facts(absentReadIO((p) => p.endsWith(file)), dir)).lineage).toEqual({ ok: false, reason: 'absent' });
    });
    it('a read that fails otherwise is unreadable', async () => {
      const dir = reg({ lineage: true });
      expect((await facts(degradedReadIO((p) => p.endsWith(file)), dir)).lineage).toEqual({ ok: false, reason: 'unreadable' });
    });
    it('a lstat that proves absence is absent', async () => {
      const dir = reg({ lineage: true });
      expect((await facts(lstatAnswering(file, { ok: false, reason: 'absent' }), dir)).lineage)
        .toEqual({ ok: false, reason: 'absent' });
    });
    it('an unmeasured lstat is unreadable, not absent', async () => {
      const dir = reg({ lineage: true });
      expect((await facts(lstatAnswering(file, { ok: false, reason: 'unmeasured' }), dir)).lineage)
        .toEqual({ ok: false, reason: 'unreadable' });
    });
    it('a lstat that fails otherwise is unreadable', async () => {
      const dir = reg({ lineage: true });
      expect((await facts(lstatAnswering(file, { ok: false, reason: 'unreadable' }), dir)).lineage)
        .toEqual({ ok: false, reason: 'unreadable' });
    });
    it('a symlinked lineage is unreadable, even to a valid file', async () => {
      const dir = reg();
      const target = path.join(dir, 'real.lineage');
      writeFileSync(target, LINEAGE());
      symlinkSync(target, path.join(dir, 'landing', 'proj-a', `${EXPECT.id}.lineage`));
      expect((await facts(localIO, dir)).lineage).toEqual({ ok: false, reason: 'unreadable' });
    });
  });

  describe('the pause markers: lstat alone decides', () => {
    const GLOBAL = '/land-probe-paused';
    const PROJECT = '/landing/proj-a/paused';
    it('a regular file pauses, each', async () => {
      const f = await facts(localIO, reg({ globalPause: true, projectPause: true }));
      expect(f.globalPause).toBe('paused');
      expect(f.projectPause).toBe('paused');
    });
    it('only the global one present pauses only the global', async () => {
      const f = await facts(localIO, reg({ globalPause: true }));
      expect([f.globalPause, f.projectPause]).toEqual(['paused', 'running']);
    });
    it('only the project one present pauses only the project', async () => {
      const f = await facts(localIO, reg({ projectPause: true }));
      expect([f.globalPause, f.projectPause]).toEqual(['running', 'paused']);
    });
    it('a dangling symlink pauses, each', async () => {
      const dir = reg();
      symlinkSync(path.join(dir, 'nowhere'), path.join(dir, 'land-probe-paused'));
      symlinkSync(path.join(dir, 'nowhere'), path.join(dir, 'landing', 'proj-a', 'paused'));
      const f = await facts(localIO, dir);
      expect(f.globalPause).toBe('paused');
      expect(f.projectPause).toBe('paused');
    });
    it('a directory pauses, each (any kind of entry)', async () => {
      const dir = reg();
      mkdirSync(path.join(dir, 'land-probe-paused'));
      mkdirSync(path.join(dir, 'landing', 'proj-a', 'paused'));
      const f = await facts(localIO, dir);
      expect([f.globalPause, f.projectPause]).toEqual(['paused', 'paused']);
    });
    it('a lstat that proves absence reads running, each', async () => {
      const f = await facts(lstatAnswering('paused', { ok: false, reason: 'absent' }), reg({ globalPause: true, projectPause: true }));
      expect([f.globalPause, f.projectPause]).toEqual(['running', 'running']);
    });
    it('a lstat that fails otherwise reads unknown, each', async () => {
      const dir = reg();
      for (const suffix of [GLOBAL, PROJECT]) {
        const f = await facts(lstatAnswering(suffix, { ok: false, reason: 'unreadable' }), dir);
        expect(suffix === GLOBAL ? f.globalPause : f.projectPause).toBe('unknown');
      }
    });
    it('an unmeasured lstat reads unknown, each, and never running', async () => {
      const dir = reg();
      for (const suffix of [GLOBAL, PROJECT]) {
        const f = await facts(lstatAnswering(suffix, { ok: false, reason: 'unmeasured' }), dir);
        expect(suffix === GLOBAL ? f.globalPause : f.projectPause).toBe('unknown');
      }
    });
    it('a pause marker is never read, only lstat-ed', async () => {
      const dir = reg({ globalPause: true, projectPause: true });
      const read: string[] = [];
      const io: FleetIO = {
        ...localIO,
        readFileMeasured: async (p, t, s) => { read.push(p); return localIO.readFileMeasured(p, t, s); },
      };
      await facts(io, dir);
      expect(read.filter((p) => p.endsWith('paused'))).toEqual([]);
    });
  });

  it('never reads `probe` or `main-health`', async () => {
    const dir = reg({ enabled: true, lineage: true });
    const read: string[] = [];
    const io: FleetIO = {
      ...localIO,
      readFileMeasured: async (p, t, s) => { read.push(p); return localIO.readFileMeasured(p, t, s); },
    };
    await facts(io, dir);
    expect(read.filter((p) => /probe$|main-health/.test(p))).toEqual([]);
  });
});

// Final review F-D: the probe's own predicate (D-7105), restated once, in L1: a registry record naming this run's
// project, on a `ws/` branch. Anything else is a row the radar never measures.
describe('lineageQualifies: the predicate the radar measures by', () => {
  it.each([
    ['a record project of null', null, 'proj-a', 'ws/alpha', false],
    ['a record project that is not the run\'s', 'proj-b', 'proj-a', 'ws/alpha', false],
    ['a branch that is not under ws/', 'proj-a', 'proj-a', 'feature/alpha', false],
    ['a branch that only contains ws/', 'proj-a', 'proj-a', 'x/ws/alpha', false],
    ['an empty branch', 'proj-a', 'proj-a', '', false],
    ['the same project on a ws/ branch', 'proj-a', 'proj-a', 'ws/alpha', true],
  ] as const)('%s -> %s', (_name, recordProject, runProject, branch, want) => {
    expect(lineageQualifies(recordProject, runProject, branch)).toBe(want);
  });
});
