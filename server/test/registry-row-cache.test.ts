import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readRegistryMeasured, type SessionRecord } from '../src/registry.js';
import { RegistryRowCache } from '../src/registryRowCache.js';
import { rowTemperature, type RowKey } from '../src/rowTemperature.js';
import type { SessionVerdict } from '../src/exec.js';
import { countingIO, fleetFixture, edgeFixture, fixtureConfig } from './registryCountingIO.js';

const gone: SessionVerdict = { verdict: 'gone' };
const rec = (over: Partial<SessionRecord> = {}): SessionRecord => ({
  hibernatedAt: null, namedByOperator: false, title: null,
  id: 'sess-a', wrapper: 'lane-a', project: 'project-a', projectEvidence: 'measured', workdir: '/w/sess-a', uuid: 'u-sess-a',
  started: true, home: null, pool: null, lastswap: null,
  workspace: 'sess-a', branch: 'ws/sess-a', branchEvidence: 'named', base: 'origin/main',
  prPhase: null, prNumber: null, prCheckedAt: null, archivedAt: null, archivedBytes: null, held: null,
  substrate: null, stopped: { at: 1, surface: 'cli' } as SessionRecord['stopped'], supervisedAt: null,
  swapBlocked: null, stranded: null, spawn: null, lastEnd: null, lifecycleUnmeasured: [],
  unmeasured: [], route: null, child: { kind: 'none' },
  ...over,
});
const key: RowKey = { names: ['sess-a.uuid'], times: null };

describe('RegistryRowCache', () => {
  it('get returns a copy', () => {
    const c = new RegistryRowCache();
    c.put('sess-a', rec(), key, 5);
    const first = c.get('sess-a')!;
    first.record.unmeasured = ['wrapper'];
    (first.key.names as string[]).push('x');
    const again = c.get('sess-a')!;
    expect(again.record.unmeasured).toEqual([]);
    expect(again.key.names).toEqual(['sess-a.uuid']);
    expect(again.readAt).toBe(5);
  });
  it('put refuses an unclean record', () => {
    const c = new RegistryRowCache();
    c.put('sess-a', rec({ unmeasured: ['wrapper'] }), key, 5);
    expect(c.get('sess-a')).toBeUndefined();
    c.put('sess-a', rec(), key, 5);
    expect(c.get('sess-a')).toBeDefined();
    c.put('sess-a', rec({ lifecycleUnmeasured: ['stopped'] }), key, 6);   // evicts the older clean entry
    expect(c.get('sess-a')).toBeUndefined();
  });
  it('prune drops ids no longer listed', () => {
    const c = new RegistryRowCache();
    c.put('sess-a', rec(), key, 5);
    c.put('sess-b', rec({ id: 'sess-b' }), key, 5);
    c.prune(new Set(['sess-b']));
    expect(c.get('sess-a')).toBeUndefined();
    expect(c.get('sess-b')).toBeDefined();
  });
  it('a rewrite in place changes the key', () => {
    const c = new RegistryRowCache();
    const k1: RowKey = { names: ['sess-a.uuid', 'sess-a.wrapper'], times: [10, 20] };
    c.put('sess-a', rec(), k1, 1000);
    const k2: RowKey = { names: k1.names, times: [11, 20] };   // .uuid rewritten in place
    expect(rowTemperature(c.get('sess-a'), gone, k1, 2000)).toBe('cold');
    expect(rowTemperature(c.get('sess-a'), gone, k2, 2000)).toBe('hot');
  });
});

const idsOf = (reg: { files: Map<string, string> }): string[] =>
  [...reg.files.keys()].filter((k) => k.endsWith('.uuid')).map((k) => path.basename(k).slice(0, -5));

describe('readRegistryMeasured over a cache', () => {
  it('with no opts, readRegistryMeasured makes today\'s request count', async () => {
    const reg = fleetFixture(80);
    const c = countingIO(reg);
    const r = await readRegistryMeasured(c.io, fixtureConfig());
    expect(r.listed && r.records.length).toBe(80);
    expect(c.requests.length).toBe(849);
    if (r.listed) { expect(r.reused.size).toBe(0); expect(r.cold.size).toBe(0); }
  });

  it('a cold row costs zero field reads on a quiet tick', async () => {
    const reg = fleetFixture(80);
    const c = countingIO(reg);
    const cache = new RegistryRowCache();
    const verdicts = (): SessionVerdict => gone;
    const first = await readRegistryMeasured(c.io, fixtureConfig(), { cache, verdicts, nowMs: 1000 });
    const stoppedId = 'lane-a-project-017';
    expect(first.listed && first.records.find((r) => r.id === stoppedId)?.stopped).not.toBeNull();
    const before = c.requests.length;
    const second = await readRegistryMeasured(c.io, fixtureConfig(), { cache, verdicts, nowMs: 2000 });
    const mine = c.requests.slice(before).filter((q) => q.path.includes(`${stoppedId}.`));
    expect(mine).toEqual([]);
    expect(second.listed && second.cold.has(stoppedId)).toBe(true);
    expect(second.listed && second.reused.has(stoppedId)).toBe(true);
    // a row that is not stopped is still read in full
    expect(c.requests.slice(before).some((q) => q.path.includes('lane-a-project-001.'))).toBe(true);
    // 30 s later the cold row is read again
    const before3 = c.requests.length;
    await readRegistryMeasured(c.io, fixtureConfig(), { cache, verdicts, nowMs: 2000 + 30_000 });
    expect(c.requests.slice(before3).some((q) => q.path.includes(`${stoppedId}.`))).toBe(true);
  });

  it('a cold row whose .stopped left the listing is read in full', async () => {
    const reg = fleetFixture(20);
    const dir = fixtureConfig().registryDir;
    const c = countingIO(reg);
    const cache = new RegistryRowCache();
    const verdicts = (): SessionVerdict => gone;
    await readRegistryMeasured(c.io, fixtureConfig(), { cache, verdicts, nowMs: 1000 });
    reg.files.delete(path.join(dir, 'lane-a-project-017.stopped'));
    const before = c.requests.length;
    const r = await readRegistryMeasured(c.io, fixtureConfig(), { cache, verdicts, nowMs: 2000 });
    expect(c.requests.slice(before).some((q) => q.path.includes('lane-a-project-017.'))).toBe(true);
    expect(r.listed && r.cold.has('lane-a-project-017')).toBe(false);
    expect(r.listed && r.records.find((x) => x.id === 'lane-a-project-017')?.stopped).toBeNull();
  });

  it('the second listing still retires a twice-absent hot row', async () => {
    const reg = edgeFixture();
    const dir = fixtureConfig().registryDir;
    const victim = 'edge-wrapper-unreadable';   // unreadable identity member: needs the second listing
    const c = countingIO(reg);
    let listings = 0;
    const io = { ...c.io, async readdir(d: string) {
      const names = await c.io.readdir(d);
      listings += 1;
      return listings >= 2 && names !== null ? names.filter((n) => n !== `${victim}.uuid`) : names;
    } };
    const cache = new RegistryRowCache();
    const r = await readRegistryMeasured(io, fixtureConfig(), { cache, verdicts: () => null, nowMs: 1000 });
    expect(listings).toBe(2);
    expect(r.listed && r.records.some((x) => x.id === victim)).toBe(false);
    expect(cache.get(victim)).toBeUndefined();
    expect(path.dirname(path.join(dir, 'x'))).toBe(dir);
  });

  it('a refused id is never cached and never read', async () => {
    const reg = edgeFixture();
    const c = countingIO(reg);
    const cache = new RegistryRowCache();
    const r = await readRegistryMeasured(c.io, fixtureConfig(), { cache, verdicts: () => gone, nowMs: 1000 });
    expect(r.listed && r.refused.has('-flag')).toBe(true);
    expect(c.requests.filter((q) => path.basename(q.path).startsWith('-flag.'))).toEqual([]);
    expect(cache.get('-flag')).toBeUndefined();
    expect(r.listed && r.reused.has('-flag')).toBe(false);
    expect(r.listed && r.cold.has('-flag')).toBe(false);
    expect(idsOf(reg)).toContain('-flag');
  });
});
