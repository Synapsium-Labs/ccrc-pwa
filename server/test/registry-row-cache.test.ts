import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readRegistryMeasured, type SessionRecord } from '../src/registry.js';
import { RegistryRowCache } from '../src/registryRowCache.js';
import { rowTemperature, type RowKey } from '../src/rowTemperature.js';
import type { SessionVerdict } from '../src/exec.js';
import { createIo } from '../src/remote/io.js';
import { READDIR_MTIMES_OP } from '../../shared/agent-protocol.js';
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
  it('a record with child: unreadable is never stored', () => {
    const c = new RegistryRowCache();
    c.put('sess-a', rec({ child: { kind: 'unreadable' } }), key, 5);
    expect(c.get('sess-a')).toBeUndefined();
    c.put('sess-a', rec(), key, 5);
    c.put('sess-a', rec({ child: { kind: 'unreadable' } }), key, 6);   // evicts the older clean entry
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

  it('a cold row reused at +20 s is still read in full at +40 s from its first read', async () => {
    const reg = fleetFixture(20);
    const c = countingIO(reg);
    const cache = new RegistryRowCache();
    const verdicts = (): SessionVerdict => gone;
    const stoppedId = 'lane-a-project-017';
    await readRegistryMeasured(c.io, fixtureConfig(), { cache, verdicts, nowMs: 1000 });
    const mid = await readRegistryMeasured(c.io, fixtureConfig(), { cache, verdicts, nowMs: 21_000 });
    expect(mid.listed && mid.cold.has(stoppedId)).toBe(true);
    const before = c.requests.length;
    const late = await readRegistryMeasured(c.io, fixtureConfig(), { cache, verdicts, nowMs: 41_000 });
    // age since the FIRST full read is 40 s: a reuse must not have refreshed it
    expect(late.listed && late.cold.has(stoppedId)).toBe(false);
    expect(c.requests.slice(before).some((q) => q.path.includes(`${stoppedId}.`))).toBe(true);
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

// Console speed S1, the times arm: keys that carry modification times when the agent can report them.
describe('readRegistryMeasured with modification times', () => {
  const withTimes = (reg: ReturnType<typeof fleetFixture>) => { reg.mtimes = new Map(); return reg; };
  const rowReads = (c: ReturnType<typeof countingIO>, from: number, id: string) =>
    c.requests.slice(from).filter((q) => path.basename(q.path).startsWith(`${id}.`));

  it('an agent without the cap is never asked for times', async () => {
    const sent: Record<string, unknown>[] = [];
    const client = {
      state: { agentOps: ['update', 'disk'] },
      request: async (req: Record<string, unknown>) => { sent.push(req); return { names: ['sess-a.uuid'] }; },
    };
    const io = createIo(client as never);
    expect(io.readdirWithTimesMeasured).toBeDefined();
    const r = await io.readdirWithTimesMeasured!('/x');
    expect(r).toEqual({ ok: true, entries: ['sess-a.uuid'] });
    expect(sent).toEqual([{ t: 'req', op: 'readdir', path: '/x' }]);
    expect('times' in sent[0]!).toBe(false);
    // With the word it asks, and reads the answer through one reader.
    sent.length = 0;
    const capable = createIo({ state: { agentOps: [READDIR_MTIMES_OP] }, request: async (req: Record<string, unknown>) => { sent.push(req); return { names: ['a.uuid', 'a.hold'], times: { 'a.uuid': 5, 'a.hold': 6 } }; } } as never);
    const t = await capable.readdirWithTimesMeasured!('/x');
    expect(sent[0]).toMatchObject({ op: 'readdir', times: true });
    expect(t).toEqual({ ok: true, entries: ['a.uuid', 'a.hold'], times: new Map([['a.uuid', 5], ['a.hold', 6]]) });
  });

  it('an answer without times falls back to names-only keys', async () => {
    const reg = withTimes(fleetFixture(20));
    reg.answerTimes = false;
    const c = countingIO(reg);
    const cache = new RegistryRowCache();
    const verdicts = (): SessionVerdict => gone;
    await readRegistryMeasured(c.io, fixtureConfig(), { cache, verdicts, nowMs: 1000 });
    expect(cache.get('lane-a-project-017')!.key.times).toBeNull();
    // A hot row (no .stopped) is never reused on a names-only key.
    const before = c.requests.length;
    const r = await readRegistryMeasured(c.io, fixtureConfig(), { cache, verdicts, nowMs: 2000 });
    expect(rowReads(c, before, 'lane-a-project-001').length).toBeGreaterThan(0);
    expect(r.listed && r.reused.has('lane-a-project-001')).toBe(false);
    // A malformed times answer is no times either (the remote reader's one rule).
    const bad = createIo({ state: { agentOps: [READDIR_MTIMES_OP] }, request: async () => ({ names: ['a.uuid'], times: { 'a.uuid': 'x' } }) } as never);
    expect(await bad.readdirWithTimesMeasured!('/x')).toEqual({ ok: true, entries: ['a.uuid'] });
  });

  it('a hot row whose key is unchanged is reused when times are known', async () => {
    const reg = withTimes(fleetFixture(20));
    const c = countingIO(reg);
    const cache = new RegistryRowCache();
    const verdicts = (): SessionVerdict => ({ verdict: 'live' });
    const first = await readRegistryMeasured(c.io, fixtureConfig(), { cache, verdicts, nowMs: 1000 });
    expect(first.listed && first.reused.size).toBe(0);
    const before = c.requests.length;
    const second = await readRegistryMeasured(c.io, fixtureConfig(), { cache, verdicts, nowMs: 2000 });
    expect(rowReads(c, before, 'lane-a-project-001')).toEqual([]);
    expect(second.listed && second.reused.has('lane-a-project-001')).toBe(true);
    expect(second.listed && second.cold.has('lane-a-project-001')).toBe(false);
    expect(second.listed && second.records.length).toBe(20);
  });

  it('a hot row reused by key is re-read once its read is 30 s old', async () => {
    const reg = withTimes(fleetFixture(20));
    const c = countingIO(reg);
    const cache = new RegistryRowCache();
    const verdicts = (): SessionVerdict => ({ verdict: 'live' });
    await readRegistryMeasured(c.io, fixtureConfig(), { cache, verdicts, nowMs: 1000 });
    let before = c.requests.length;
    const young = await readRegistryMeasured(c.io, fixtureConfig(), { cache, verdicts, nowMs: 1000 + 29_999 });
    expect(rowReads(c, before, 'lane-a-project-001')).toEqual([]);
    expect(young.listed && young.reused.has('lane-a-project-001')).toBe(true);
    before = c.requests.length;
    const old = await readRegistryMeasured(c.io, fixtureConfig(), { cache, verdicts, nowMs: 1000 + 30_000 });
    expect(rowReads(c, before, 'lane-a-project-001').length).toBeGreaterThan(0);
    expect(old.listed && old.reused.has('lane-a-project-001')).toBe(false);
  });

  it('a .uuid mtime change re-reads the row', async () => {
    const reg = withTimes(fleetFixture(20));
    const dir = fixtureConfig().registryDir;
    const c = countingIO(reg);
    const cache = new RegistryRowCache();
    const verdicts = (): SessionVerdict => ({ verdict: 'live' });
    await readRegistryMeasured(c.io, fixtureConfig(), { cache, verdicts, nowMs: 1000 });
    reg.mtimes!.set(path.join(dir, 'lane-a-project-001.uuid'), 99);   // rewritten in place, same names
    const before = c.requests.length;
    const r = await readRegistryMeasured(c.io, fixtureConfig(), { cache, verdicts, nowMs: 2000 });
    expect(rowReads(c, before, 'lane-a-project-001').length).toBeGreaterThan(0);
    expect(r.listed && r.reused.has('lane-a-project-001')).toBe(false);
    expect(r.listed && r.reused.has('lane-a-project-002')).toBe(true);
  });

  it('an unclean read evicts, so a gone verdict next tick still reads the row in full', async () => {
    const reg = withTimes(edgeFixture());
    const c = countingIO(reg);
    const cache = new RegistryRowCache();
    const id = 'edge-stopped-unreadable';   // a stopped row whose .stopped read fails: an unclean record
    await readRegistryMeasured(c.io, fixtureConfig(), { cache, verdicts: () => gone, nowMs: 1000 });
    expect(cache.get(id)).toBeUndefined();
    const before = c.requests.length;
    const r = await readRegistryMeasured(c.io, fixtureConfig(), { cache, verdicts: () => gone, nowMs: 2000 });
    expect(rowReads(c, before, id).length).toBeGreaterThan(0);
    expect(r.listed && r.reused.has(id)).toBe(false);
  });
});
