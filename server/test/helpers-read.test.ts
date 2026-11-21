// Session helpers H1b (D-8862): the reads of an Agent helper BY ID, inside the helper tier's own budget (spec §3.1, §5 "The
// helper tier"), against real files in a fixture dir with neutral names, and a FleetIO wrapper that counts every call so
// the order and the bound are measured, not asserted in prose. The reader never lists the helpers' directory: it reads
// each id the roster or the transcript's facts name. Per reading, at most HELPER_READS_PER_TICK (12) reads, spent in
// this order: (1) a meta read for each id first known, (2) a meta read for each drop seen, (3) for each helper not final,
// a stat of its transcript and, when it grew, a read of the new bytes, rotated so the helpers left unread come first next
// time, (4) a meta stat every RESTAT_EVERY readings until the helper is final, and (5) for a helper first seen final, one
// tail read for its last write. And a `finished` row whose last write is not read yet is HELD, never drawn with no end
// time and then drawn again (review 2961 F10c).
//
// RED FIRST: committed before the code, against origin/main, where none of it exists.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendFileSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { localIO, type FleetIO } from '../src/io.js';
import { HELPER_READS_PER_TICK, RESTAT_EVERY, SessionHelpers, SessionWorkflows, TAIL_BYTES, type HelpersRead } from '../src/workflows/read.js';
import type { Proc, RosterInput } from '../src/workflows/model.js';
import type { HelperFact } from '../src/transcript/parse.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = Date.parse('2026-11-20T10:00:00.000Z');
const LIVE: Proc = { kind: 'live', startedAt: NOW - 3_600_000 };
const iso = (ms: number): string => new Date(ms).toISOString();
const line = (o: unknown): string => `${JSON.stringify(o)}\n`;
const usageLine = (ms: number, input: number): string =>
  line({ type: 'assistant', timestamp: iso(ms), message: { usage: { input_tokens: input, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 3 } } });
const plainLine = (ms: number): string => line({ type: 'user', timestamp: iso(ms), message: { role: 'user', content: 'x' } });

interface Counted extends FleetIO { calls: Array<{ op: string; file: string }>; ranges: Array<{ file: string; offset: number; max: number }>; fail: (op: string, file: string) => boolean }
const counted = (inner: FleetIO): Counted => {
  const calls: Counted['calls'] = [];
  const ranges: Counted['ranges'] = [];
  const name = (p: string): string => path.basename(p);
  const io: Counted = {
    ...inner,
    calls,
    ranges,
    fail: () => false,
    readdirMeasured: async (p, ...rest) => { calls.push({ op: 'readdir', file: name(p) }); return inner.readdirMeasured(p, ...rest); },
    statMeasured: async (p) => { calls.push({ op: 'stat', file: name(p) }); return inner.statMeasured(p); },
    readFileMeasured: async (p, ...rest) => {
      calls.push({ op: 'read', file: name(p) });
      return io.fail('read', name(p)) ? { ok: false, reason: 'unreadable' } : inner.readFileMeasured(p, ...rest);
    },
    readFileFromBytesMeasured: async (p, o, m, ...rest) => {
      calls.push({ op: 'range', file: name(p) });
      ranges.push({ file: name(p), offset: o, max: m });
      return io.fail('range', name(p)) ? { ok: false, reason: 'unreadable' } : inner.readFileFromBytesMeasured(p, o, m, ...rest);
    },
  };
  return io;
};

let home: string;
let S: string;
let sub: string;
beforeEach(() => {
  home = mkTmp('ccrc-helpers-read-');
  S = path.join(home, '.claude-a', 'projects', '-work-project-a', 'session-uuid-a');
  sub = path.join(S, 'subagents');
  mkdirSync(sub, { recursive: true });
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const seedMeta = (id: string, o: Record<string, unknown> = {}): void =>
  writeFileSync(path.join(sub, `agent-${id}.meta.json`), JSON.stringify({
    agentType: 'Explore', description: `look at ${id}`, model: 'model-a', effort: 'high', toolUseId: `toolu_${id}`, spawnDepth: 1, ...o,
  }));
const seedTranscript = (id: string, body: string): void => writeFileSync(path.join(sub, `agent-${id}.jsonl`), body);
const grow = (id: string, body: string): void => appendFileSync(path.join(sub, `agent-${id}.jsonl`), body);

const listed = (ids: string[], at = NOW - 1_000, name = 'Explore'): RosterInput =>
  ({ kind: 'usable', at, entries: ids.map((id, i) => ({ id, name, startedAt: NOW - 600_000 + i })) });

const read = (r: SessionHelpers, roster: RosterInput, o: { facts?: HelperFact[]; now?: number; proc?: Proc } = {}): Promise<HelpersRead> =>
  r.read({ roster, facts: o.facts ?? [], proc: o.proc ?? LIVE, now: o.now ?? NOW });
const helperCalls = (io: Counted): Counted['calls'] => io.calls.filter((c) => c.file.startsWith('agent-'));

describe('reads by id: the meta and the transcript of each helper the roster lists', () => {
  it('a listed helper is decided from its meta and its transcript: kind, model, effort, last write and tokens', async () => {
    seedMeta('a1');
    seedTranscript('a1', plainLine(NOW - 60_000) + usageLine(NOW - 30_000, 4321));
    const r = new SessionHelpers(localIO, S);
    const { arm } = await read(r, listed(['a1']));
    expect(arm.agents).toEqual([expect.objectContaining({
      id: 'a1', state: 'running', description: 'look at a1', agentType: 'Explore', model: 'model-a', effort: 'high',
      lastActivityAt: NOW - 30_000, tokens: 4321, endedAt: null,
    })]);
  });

  it('the reader never lists the helpers\' directory', async () => {
    seedMeta('a1');
    seedTranscript('a1', plainLine(NOW - 1_000));
    const io = counted(localIO);
    const r = new SessionHelpers(io, S);
    await read(r, listed(['a1']));
    await read(r, listed(['a1']));
    expect(io.calls.filter((c) => c.op === 'readdir')).toEqual([]);
  });

  it('a roster entry named workflow-subagent is ruled out WITHOUT a read; an entry with no id costs nothing', async () => {
    seedMeta('w1', { agentType: 'workflow-subagent' });
    const io = counted(localIO);
    const r = new SessionHelpers(io, S);
    const roster: RosterInput = { kind: 'usable', at: NOW - 1_000, entries: [{ id: 'w1', name: 'workflow-subagent', startedAt: NOW - 5_000 }, { id: null, name: 'Explore', startedAt: NOW - 4_000 }] };
    const { arm } = await read(r, roster);
    expect(helperCalls(io)).toEqual([]);
    expect(arm.agents).toEqual([]);
    expect(arm.known).toBe(0);
  });

  it('a meta read once is not read again while nothing changed (a reading costs the transcript stat, not the meta)', async () => {
    seedMeta('a1');
    seedTranscript('a1', plainLine(NOW - 1_000));
    const io = counted(localIO);
    const r = new SessionHelpers(io, S);
    await read(r, listed(['a1']));
    io.calls.length = 0;
    await read(r, listed(['a1']));
    expect(helperCalls(io)).toEqual([{ op: 'stat', file: 'agent-a1.jsonl' }]);
  });

  it('an id a launch result names, which the roster does not list yet, is read and decided (launched)', async () => {
    seedMeta('a2');
    const launch: HelperFact = { source: 'launch', id: 'a2', status: 'async_launched', at: NOW - 500, model: 'model-b', durationMs: null, summary: null, report: null, reportCut: false };
    const r = new SessionHelpers(localIO, S);
    const { arm } = await read(r, listed([], NOW - 1_000), { facts: [launch] });
    expect(arm.agents).toEqual([expect.objectContaining({ id: 'a2', state: 'launched', startedAt: NOW - 500, description: 'look at a2', agentType: 'Explore' })]);
  });

  it('facts fold across readings: a notification read after its launch ends the row, with its summary', async () => {
    seedMeta('a3');
    seedTranscript('a3', plainLine(NOW - 2_000));
    const r = new SessionHelpers(localIO, S);
    await read(r, listed(['a3']));
    const notice: HelperFact = { source: 'notification', id: 'a3', status: 'completed', at: NOW - 100, model: null, durationMs: null, summary: 'ok', report: 'r', reportCut: false };
    const { arm } = await read(r, listed(['a3']), { facts: [notice] });
    expect(arm.agents).toEqual([expect.objectContaining({ id: 'a3', state: 'done', endedAt: NOW - 100, summary: 'ok', hasReport: true })]);
  });

  it('a transcript that grew is read from where it was, and its newest timestamped line is the last activity', async () => {
    seedMeta('a1');
    seedTranscript('a1', plainLine(NOW - 60_000));
    const io = counted(localIO);
    const r = new SessionHelpers(io, S);
    expect((await read(r, listed(['a1']))).arm.agents[0]!.lastActivityAt).toBe(NOW - 60_000);
    grow('a1', plainLine(NOW - 10_000) + line({ type: 'progress' }));
    io.calls.length = 0;
    expect((await read(r, listed(['a1']))).arm.agents[0]!.lastActivityAt).toBe(NOW - 10_000);
    expect(helperCalls(io).map((c) => c.op)).toEqual(['stat', 'range']);
  });

  it('new bytes with no timestamped line and no usage keep the last activity and tokens read before', async () => {
    seedMeta('a1');
    seedTranscript('a1', usageLine(NOW - 60_000, 900));
    const r = new SessionHelpers(localIO, S);
    await read(r, listed(['a1']));
    grow('a1', line({ type: 'progress' }));
    expect((await read(r, listed(['a1']))).arm.agents[0]).toMatchObject({ lastActivityAt: NOW - 60_000, tokens: 900 });
  });
});

describe('the helper tier: at most HELPER_READS_PER_TICK reads a reading, spent in its order', () => {
  it('the budget is the spec\'s 12', () => { expect(HELPER_READS_PER_TICK).toBe(12); });

  it('(1) first: one meta read for each id first known; ids past the budget wait for the next reading', async () => {
    const ids = Array.from({ length: 14 }, (_, i) => `a${i}`);
    for (const id of ids) { seedMeta(id); seedTranscript(id, plainLine(NOW - 5_000)); }
    const io = counted(localIO);
    const r = new SessionHelpers(io, S);
    await read(r, listed(ids));
    expect(helperCalls(io)).toEqual(ids.slice(0, 12).map((id) => ({ op: 'read', file: `agent-${id}.meta.json` })));
    io.calls.length = 0;
    await read(r, listed(ids));
    const calls = helperCalls(io);
    expect(calls.length).toBeLessThanOrEqual(HELPER_READS_PER_TICK);
    expect(calls.slice(0, 2)).toEqual([{ op: 'read', file: 'agent-a12.meta.json' }, { op: 'read', file: 'agent-a13.meta.json' }]);
    expect(calls.slice(2).every((c) => c.file.endsWith('.jsonl'))).toBe(true);
  });

  it('(2) next: a drop this reader SAW re-reads that helper\'s meta at once, so a helper that finished moves straight to finished', async () => {
    for (const id of ['a1', 'a2', 'a3']) { seedMeta(id); seedTranscript(id, plainLine(NOW - 50_000)); }
    const r = new SessionHelpers(localIO, S);
    await read(r, listed(['a1', 'a2', 'a3']));
    await read(r, listed(['a1', 'a2', 'a3']));
    seedMeta('a2', { finished: true });
    const io = counted(localIO);
    const r2 = r; (r2 as unknown as { io: FleetIO }).io = io;
    const { arm } = await read(r2, listed(['a1', 'a3']));
    expect(helperCalls(io)[0]).toEqual({ op: 'read', file: 'agent-a2.meta.json' });
    expect(arm.agents.find((a) => a.id === 'a2')).toMatchObject({ state: 'finished', endedAt: NOW - 50_000 });
  });

  it('(3) the transcripts: a stat each, a read only when it grew, and never more than the budget', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `b${i}`);
    for (const id of ids) { seedMeta(id); seedTranscript(id, plainLine(NOW - 9_000)); }
    const io = counted(localIO);
    const r = new SessionHelpers(io, S);
    await read(r, listed(ids));            // ten meta reads, then two of the transcripts
    await read(r, listed(ids));
    for (const id of ids) grow(id, plainLine(NOW - 1_000));
    io.calls.length = 0;
    const out = await read(r, listed(ids));
    const calls = helperCalls(io);
    expect(calls.length).toBe(HELPER_READS_PER_TICK);
    // every growing helper costs a stat and a read: floor(12 / 2) = 6 of them this reading
    expect(calls.filter((c) => c.op === 'stat')).toHaveLength(6);
    expect(calls.filter((c) => c.op === 'range')).toHaveLength(6);
    expect(out.readEvery).toEqual({ refreshed: 6, of: 10 });
  });

  it('rotation reaches every growing helper: none waits more than two readings, and each is read in turn', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `c${i}`);
    for (const id of ids) { seedMeta(id); seedTranscript(id, plainLine(NOW - 9_000)); }
    const io = counted(localIO);
    const r = new SessionHelpers(io, S);
    await read(r, listed(ids));
    const lastRead = new Map<string, number>();
    for (let k = 0; k < 6; k++) {
      for (const id of ids) grow(id, plainLine(NOW - 1_000 + k));
      io.calls.length = 0;
      await read(r, listed(ids));
      for (const c of helperCalls(io)) if (c.op === 'range') lastRead.set(c.file, k);
      for (const id of ids) {
        const at = lastRead.get(`agent-${id}.jsonl`);
        if (k >= 2) expect(at, `${id} at reading ${k}`).toBeGreaterThanOrEqual(k - 1);
      }
    }
    expect(lastRead.size).toBe(10);
  });

  it('readEvery is said only when the tier rotates: every helper refreshed says nothing', async () => {
    for (const id of ['d1', 'd2']) { seedMeta(id); seedTranscript(id, plainLine(NOW - 9_000)); }
    const r = new SessionHelpers(localIO, S);
    await read(r, listed(['d1', 'd2']));
    grow('d1', plainLine(NOW - 1_000));
    grow('d2', plainLine(NOW - 1_000));
    expect((await read(r, listed(['d1', 'd2']))).readEvery).toBeNull();
  });

  it('(4) a meta stat every RESTAT_EVERY readings until the helper is final: a meta that turned finished is read and decided', async () => {
    seedMeta('e1');
    seedTranscript('e1', plainLine(NOW - 40_000));
    const io = counted(localIO);
    const r = new SessionHelpers(io, S);
    await read(r, listed(['e1']));
    seedMeta('e1', { finished: true });
    let metaStats = 0;
    let finishedAt = -1;
    for (let k = 1; k <= RESTAT_EVERY + 1; k++) {
      io.calls.length = 0;
      const { arm } = await read(r, { kind: 'usable', at: NOW - 1_000, entries: [] }, { proc: { kind: 'unmeasured' } });
      metaStats += helperCalls(io).filter((c) => c.op === 'stat' && c.file.endsWith('.meta.json')).length;
      if (finishedAt < 0 && arm.agents[0]?.state === 'finished') finishedAt = k;
    }
    expect(metaStats).toBe(1);
    expect(finishedAt).toBe(RESTAT_EVERY);
  });

  it.each([{ count: 11, growing: false }, { count: 6, growing: true }])(
    'steps 4 and 5 make progress beside $count open helpers (growing: $growing)', async ({ count, growing }) => {
      const ids = Array.from({ length: count }, (_, n) => `b${n}`);
      for (const id of ids) { seedMeta(id); seedTranscript(id, plainLine(NOW - 10_000)); }
      const io = counted(localIO);
      const reader = new SessionHelpers(io, S);
      for (let tick = 1; tick <= RESTAT_EVERY; tick++) await read(reader, listed(ids));

      const finalId = 'f1';
      seedMeta(finalId, { finished: true });
      seedTranscript(finalId, plainLine(NOW - 2_000));
      // At the first due reading, step 4 can stat but has no slot to read that meta. Step 5 gets its two calls.
      io.calls.length = 0;
      if (growing) for (const id of ids) grow(id, plainLine(NOW - 5_000));
      const first = await read(reader, listed([...ids, finalId]));
      const calls = helperCalls(io);
      expect(calls.length).toBeLessThanOrEqual(12);
      expect(calls.filter((c) => c.file === 'agent-b0.meta.json')).toEqual([{ op: 'stat', file: 'agent-b0.meta.json' }]);
      expect(calls.slice(-2)).toEqual([{ op: 'stat', file: 'agent-f1.jsonl' }, { op: 'range', file: 'agent-f1.jsonl' }]);
      expect(first.arm.agents.find((a) => a.id === finalId)).toMatchObject({ state: 'finished', endedAt: NOW - 2_000 });

      io.calls.length = 0;
      if (growing) for (const id of ids) grow(id, plainLine(NOW - 4_000));
      await read(reader, listed([...ids, finalId]));
      expect(helperCalls(io).length).toBeLessThanOrEqual(12);
      expect(helperCalls(io).filter((c) => c.file === 'agent-b0.meta.json')).toEqual([{ op: 'read', file: 'agent-b0.meta.json' }]);

      const reRead = new Set(['agent-b0.meta.json']);
      for (let k = 2; k < 2 * count; k++) {
        if (growing) for (const id of ids) grow(id, plainLine(NOW - 3_000 + k));
        io.calls.length = 0;
        await read(reader, listed([...ids, finalId]));
        expect(helperCalls(io).length).toBeLessThanOrEqual(12);
        for (const c of helperCalls(io)) if (c.op === 'read' && c.file.endsWith('.meta.json')) reRead.add(c.file);
      }
      expect(reRead).toEqual(new Set(ids.map((id) => `agent-${id}.meta.json`)));
    },
  );

  it('step 4 defers a range-budget-edge meta read instead of making a thirteenth call', async () => {
    const ids = Array.from({ length: 6 }, (_, i) => `b${i}`);
    for (const id of ids) { seedMeta(id); seedTranscript(id, plainLine(NOW - 10_000)); }
    const io = counted(localIO);
    const reader = new SessionHelpers(io, S);
    for (let tick = 1; tick <= RESTAT_EVERY; tick++) await read(reader, listed(ids));
    for (const id of ids) grow(id, plainLine(NOW - 5_000));
    io.calls.length = 0;
    await read(reader, listed(ids));
    expect(helperCalls(io)).toHaveLength(12);
    expect(helperCalls(io).at(-1)).toEqual({ op: 'stat', file: 'agent-b0.meta.json' });
  });

  it('step 4 discovers a listed id whose meta was absent and later appeared', async () => {
    const io = counted(localIO);
    const reader = new SessionHelpers(io, S);
    const roster = listed(['a1']);
    expect((await read(reader, roster)).arm.agents).toEqual([]);
    seedMeta('a1');
    for (let tick = 1; tick < RESTAT_EVERY; tick++) await read(reader, roster);
    const { arm } = await read(reader, roster);
    expect(arm.agents).toEqual([expect.objectContaining({ id: 'a1', state: 'running' })]);
  });

  it('(5) a helper first seen already final costs one tail read for its last write, and nothing after', async () => {
    seedMeta('f1', { finished: true });
    seedTranscript('f1', plainLine(NOW - 70_000) + plainLine(NOW - 20_000));
    const io = counted(localIO);
    const r = new SessionHelpers(io, S);
    const first = await read(r, listed(['f1']));
    expect(first.arm.agents).toEqual([expect.objectContaining({ id: 'f1', state: 'finished', endedAt: NOW - 20_000, lastActivityAt: NOW - 20_000 })]);
    expect(helperCalls(io).map((c) => `${c.op} ${c.file}`)).toEqual(['read agent-f1.meta.json', 'stat agent-f1.jsonl', 'range agent-f1.jsonl']);
    io.calls.length = 0;
    for (let k = 0; k < RESTAT_EVERY + 2; k++) await read(r, listed(['f1']));
    expect(helperCalls(io)).toEqual([]);
  });

  it('a long transcript\'s last write is read from its last TAIL_BYTES, not from its start', async () => {
    seedMeta('g1', { finished: true });
    seedTranscript('g1', plainLine(NOW - 90_000) + 'x'.repeat(TAIL_BYTES * 2) + '\n' + plainLine(NOW - 15_000));
    const r = new SessionHelpers(localIO, S);
    expect((await read(r, listed(['g1']))).arm.agents[0]).toMatchObject({ state: 'finished', endedAt: NOW - 15_000 });
  });
});

describe('the tier\'s accounting (cases added after the first mutation round)', () => {
  const launchOf = (id: string): HelperFact => ({ source: 'launch', id, status: 'async_launched', at: NOW - 500, model: 'model-b', durationMs: null, summary: null, report: null, reportCut: false });

  it('(1) the roster\'s new ids are read before a launch\'s: thirteen listed and one launched, the twelve first listed come first', async () => {
    const ids = Array.from({ length: 13 }, (_, i) => `r${i}`);
    for (const id of [...ids, 'l1']) seedMeta(id);
    const io = counted(localIO);
    const r = new SessionHelpers(io, S);
    await read(r, listed(ids), { facts: [launchOf('l1')] });
    expect(helperCalls(io).map((c) => c.file)).toEqual(ids.slice(0, 12).map((id) => `agent-${id}.meta.json`));
  });

  it('an id that is no Agent helper (no meta at the Agent path, no launch) costs its one meta read and nothing after', async () => {
    const notice: HelperFact = { source: 'notification', id: 'x1', status: 'completed', at: NOW - 100, model: null, durationMs: null, summary: 's', report: null, reportCut: false };
    const io = counted(localIO);
    const r = new SessionHelpers(io, S);
    await read(r, listed([]), { facts: [notice] });
    expect(helperCalls(io)).toEqual([{ op: 'read', file: 'agent-x1.meta.json' }]);
    io.calls.length = 0;
    for (let k = 0; k < RESTAT_EVERY + 1; k++) await read(r, listed([]));
    expect(helperCalls(io)).toEqual([]);
  });

  it('a helper whose transcript did not grow costs ONE read of the budget: twelve quiet helpers are all looked at in one reading', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `q${i}`);
    for (const id of ids) { seedMeta(id); seedTranscript(id, plainLine(NOW - 9_000)); }
    const io = counted(localIO);
    const r = new SessionHelpers(io, S);
    await read(r, listed(ids));                 // twelve metas
    await read(r, listed(ids));                 // six transcripts first read
    await read(r, listed(ids));                 // the other six
    io.calls.length = 0;
    const out = await read(r, listed(ids));     // nothing grew
    expect(helperCalls(io)).toEqual(ids.map((id) => ({ op: 'stat', file: `agent-${id}.jsonl` })).slice(0, 12));
    expect(out.readEvery).toBeNull();
  });

  it('an odd budget never overspends: the last stat\'s read waits, and that helper is the next reading\'s FIRST', async () => {
    const ids = Array.from({ length: 8 }, (_, i) => `o${i}`);
    for (const id of ids) { seedMeta(id); seedTranscript(id, plainLine(NOW - 9_000)); }
    seedMeta('o8');
    const io = counted(localIO);
    const r = new SessionHelpers(io, S);
    await read(r, listed(ids));                 // eight metas, then two transcripts (o0, o1)
    for (const id of ids) grow(id, plainLine(NOW - 1_000));
    io.calls.length = 0;
    await read(r, listed([...ids, 'o8']));      // one new meta (o8), then 11 left: five helpers read, a sixth stat'ed
    const calls = helperCalls(io);
    expect(calls).toHaveLength(HELPER_READS_PER_TICK);
    expect(calls[0]).toEqual({ op: 'read', file: 'agent-o8.meta.json' });
    const lastStat = calls.at(-1)!;
    expect(lastStat.op).toBe('stat');
    io.calls.length = 0;
    await read(r, listed([...ids, 'o8']));
    expect(helperCalls(io)[0]).toEqual(lastStat);
    expect(helperCalls(io)[1]).toEqual({ op: 'range', file: lastStat.file });
  });
});

describe('the tier\'s finality, re-stats, eviction and tail reads (cases added after the first mutation round)', () => {
  it('"not final" is the LAST DECISION\'s word: a helper continued after its end (listed with a later start) keeps its transcript read', async () => {
    seedMeta('c1');
    seedTranscript('c1', plainLine(NOW - 60_000));
    const end: HelperFact = { source: 'notification', id: 'c1', status: 'completed', at: NOW - 15 * 60_000, model: null, durationMs: null, summary: 's', report: null, reportCut: false };
    const roster: RosterInput = { kind: 'usable', at: NOW - 1_000, entries: [{ id: 'c1', name: 'Explore', startedAt: NOW - 60_000 }] };
    const r = new SessionHelpers(localIO, S);
    expect((await read(r, roster, { facts: [end] })).arm.agents[0]).toMatchObject({ state: 'running', lastActivityAt: NOW - 60_000 });
    grow('c1', plainLine(NOW - 2_000));
    expect((await read(r, roster)).arm.agents[0]).toMatchObject({ state: 'running', lastActivityAt: NOW - 2_000 });
  });

  it('a helper first seen final has its last write read in step 5, AFTER the open helpers\' transcripts', async () => {
    seedMeta('f9', { finished: true });
    seedTranscript('f9', plainLine(NOW - 70_000));
    seedMeta('a9');
    seedTranscript('a9', plainLine(NOW - 5_000));
    const io = counted(localIO);
    const r = new SessionHelpers(io, S);
    await read(r, listed(['f9', 'a9']));
    expect(helperCalls(io).map((c) => `${c.op} ${c.file}`)).toEqual([
      'read agent-f9.meta.json', 'read agent-a9.meta.json',
      'stat agent-a9.jsonl', 'range agent-a9.jsonl',
      'stat agent-f9.jsonl', 'range agent-f9.jsonl',
    ]);
  });

  it('step 5 never overspends: with one read left it waits for the next reading', async () => {
    const ids = Array.from({ length: 11 }, (_, i) => `z${i}`);
    for (const id of ids) { seedMeta(id, { finished: true }); seedTranscript(id, plainLine(NOW - 30_000)); }
    const io = counted(localIO);
    const r = new SessionHelpers(io, S);
    await read(r, listed(ids));
    expect(helperCalls(io)).toHaveLength(11);
  });

  it('(4) a meta that did not change since its last re-stat is not read again', async () => {
    seedMeta('m1');
    seedTranscript('m1', plainLine(NOW - 40_000));
    const io = counted(localIO);
    const r = new SessionHelpers(io, S);
    for (let k = 0; k < 2 * RESTAT_EVERY + 2; k++) await read(r, { kind: 'usable', at: NOW - 1_000, entries: k === 0 ? [{ id: 'm1', name: 'Explore', startedAt: NOW - 50_000 }] : [] }, { proc: { kind: 'unmeasured' } });
    const metaCalls = helperCalls(io).filter((c) => c.file.endsWith('.meta.json'));
    // the first read; the first re-stat reads it once (nothing was stored to compare with); the second finds it unchanged
    expect(metaCalls.map((c) => c.op)).toEqual(['read', 'stat', 'read', 'stat']);
  });

  it('an id the roster lists that is no Agent helper (a workflow\'s meta) is read once and kept, not read again each reading', async () => {
    seedMeta('w2', { agentType: 'workflow-subagent' });
    const io = counted(localIO);
    const r = new SessionHelpers(io, S);
    for (let k = 0; k < 5; k++) await read(r, listed(['w2']));
    expect(helperCalls(io)).toEqual([{ op: 'read', file: 'agent-w2.meta.json' }]);
  });

  it('a transcript that grew by more than TAIL_BYTES is read from its last TAIL_BYTES only', async () => {
    seedMeta('t1');
    seedTranscript('t1', plainLine(NOW - 60_000));
    const io = counted(localIO);
    const r = new SessionHelpers(io, S);
    await read(r, listed(['t1']));
    grow('t1', `${'y'.repeat(TAIL_BYTES * 2)}\n${plainLine(NOW - 3_000)}`);
    io.ranges.length = 0;
    expect((await read(r, listed(['t1']))).arm.agents[0]!.lastActivityAt).toBe(NOW - 3_000);
    expect(io.ranges).toHaveLength(1);
    expect(io.ranges[0]!.max).toBeLessThanOrEqual(TAIL_BYTES);
  });

  it('a transcript rewritten SMALLER is read again from its tail, not left at the old size', async () => {
    seedMeta('s1');
    seedTranscript('s1', plainLine(NOW - 60_000) + plainLine(NOW - 50_000) + plainLine(NOW - 40_000));
    const r = new SessionHelpers(localIO, S);
    await read(r, listed(['s1']));
    seedTranscript('s1', plainLine(NOW - 1_000));
    expect((await read(r, listed(['s1']))).arm.agents[0]!.lastActivityAt).toBe(NOW - 1_000);
  });

  it('a meta re-read that fails keeps what was read before: the row stays', async () => {
    for (const id of ['u1', 'u2', 'u3']) { seedMeta(id); seedTranscript(id, plainLine(NOW - 50_000)); }
    const io = counted(localIO);
    const r = new SessionHelpers(io, S);
    await read(r, listed(['u1', 'u2', 'u3']));
    await read(r, listed(['u1', 'u2', 'u3']));
    io.fail = (op, file) => op === 'read' && file === 'agent-u2.meta.json';
    const { arm } = await read(r, listed(['u1', 'u3']));   // a seen drop re-reads u2's meta, which fails
    expect(helperCalls(io).filter((c) => c.file === 'agent-u2.meta.json').at(-1)).toEqual({ op: 'read', file: 'agent-u2.meta.json' });
    expect(arm.agents.find((a) => a.id === 'u2')).toMatchObject({ state: 'unlisted', description: 'look at u2' });
  });

  it('a read deferred for the budget re-arms the hold: a meta that turned finished waits for that write, not the stale one', async () => {
    const ids = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'];
    for (const id of ids) { seedMeta(id); seedTranscript(id, plainLine(NOW - 90_000)); }
    const r = new SessionHelpers(localIO, S);
    await read(r, listed(ids));        // six metas, three transcripts (p0..p2); the rotation's cursor at p3
    await read(r, listed(ids));        // p3..p5 read, p0..p2 stat'ed; the cursor back at p3
    for (const id of ids) grow(id, plainLine(NOW - 2_000));
    seedMeta('p1', { finished: true });
    seedMeta('p2', { finished: true });
    // Both drop behind p0. Step 3 spends eight slots on p3, p4, p5 and p0; step 5 has room for p1, but not p2.
    const held = await read(r, listed(['p0', 'p3', 'p4', 'p5']));
    expect(held.arm.agents.find((a) => a.id === 'p1')).toMatchObject({ state: 'finished', endedAt: NOW - 2_000 });
    expect(held.arm.agents.find((a) => a.id === 'p2')?.state).not.toBe('finished');
    const next = await read(r, listed(['p0', 'p3', 'p4', 'p5']));
    expect(next.arm.agents.find((a) => a.id === 'p2')).toMatchObject({ state: 'finished', endedAt: NOW - 2_000 });
  });
});

describe('a workflow row carries lastActivityAt: the newest write the reader measured', () => {
  it('a running workflow: its running agent\'s transcript, written after the journal, is the last activity', async () => {
    const RUN = 'wf_00000000-aaa';
    const dir = path.join(S, 'subagents', 'workflows', RUN);
    mkdirSync(dir, { recursive: true });
    const at = (f: string, ms: number): void => utimesSync(f, new Date(ms), new Date(ms));
    writeFileSync(path.join(dir, 'agent-w1.meta.json'), JSON.stringify({ agentType: 'workflow-subagent', description: 'w' }));
    at(path.join(dir, 'agent-w1.meta.json'), NOW - 60_000);
    writeFileSync(path.join(dir, 'agent-w1.jsonl'), plainLine(NOW - 5_000));
    at(path.join(dir, 'agent-w1.jsonl'), NOW - 5_000);
    const j = path.join(dir, 'journal.jsonl');
    writeFileSync(j, line({ type: 'started', key: `v2:${'1'.padStart(64, '0')}`, agentId: 'w1', label: 'l', phase: null }));
    at(j, NOW - 30_000);
    const w = new SessionWorkflows(localIO, S);
    await w.read(LIVE, NOW);
    const second = await w.read(LIVE, NOW);
    expect(second.kind === 'read' ? second.workflows[0]?.lastActivityAt : undefined).toBe(NOW - 5_000);
  });
});

describe('a finished row whose last write is read one reading late is held, not drawn twice (review 2961 F10c)', () => {
  it('twelve helpers first seen finished: no reading draws one finished with no end time; each is drawn once its last write is read', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `h${i}`);
    for (const id of ids) { seedMeta(id, { finished: true }); seedTranscript(id, plainLine(NOW - 30_000)); }
    const r = new SessionHelpers(localIO, S);
    const drawn = new Map<string, number>();
    for (let k = 0; k < 4; k++) {
      const { arm } = await read(r, listed(ids));
      for (const a of arm.agents) {
        if (a.state !== 'finished') continue;
        expect(a.endedAt, `${a.id} at reading ${k}`).toBe(NOW - 30_000);
        drawn.set(a.id, (drawn.get(a.id) ?? 0) + 1);
      }
    }
    // reading 0 spends the budget on the twelve metas (each row held: the roster lists it, so it reads running); readings
    // 1 and 2 read six last writes each
    expect([...drawn.keys()].sort()).toEqual([...ids].sort());
  });

  it('a repeated range failure releases a finished row on the first attempt even when the stat succeeds', async () => {
    seedMeta('k1', { finished: true });
    seedTranscript('k1', plainLine(NOW - 10_000));
    const io = counted(localIO);
    io.fail = (op, file) => op === 'range' && file === 'agent-k1.jsonl';
    const r = new SessionHelpers(io, S);
    const first = await read(r, listed(['k1']));
    expect(first.arm.agents).toEqual([expect.objectContaining({ id: 'k1', state: 'finished', endedAt: null, lastActivityAt: null })]);
    expect(io.ranges.map((call) => call.file)).toEqual(['agent-k1.jsonl']);
    expect((await read(r, listed(['k1']))).arm.agents).toEqual([]);
    expect(io.ranges).toHaveLength(1);
  });

  it('an empty finished transcript does not issue a zero-length range call', async () => {
    seedMeta('k1', { finished: true });
    seedTranscript('k1', '');
    const io = counted(localIO);
    const { arm } = await read(new SessionHelpers(io, S), listed(['k1']));
    expect(arm.agents).toEqual([expect.objectContaining({ id: 'k1', state: 'finished', endedAt: null })]);
    expect(io.ranges).toEqual([]);
  });

  it('a failed stat releases a finished row with no end time (drawn once)', async () => {
    seedMeta('k1', { finished: true });
    const r = new SessionHelpers(localIO, S);
    const first = await read(r, listed(['k1']));
    expect(first.arm.agents).toEqual([expect.objectContaining({ id: 'k1', state: 'finished', endedAt: null })]);
    expect((await read(r, listed(['k1']))).arm.agents).toEqual([]);
  });
});
