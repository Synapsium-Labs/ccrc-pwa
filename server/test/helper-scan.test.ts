// Session helpers H1c (D-8873): the bounded start scan (spec 2026-11-19-session-helpers-design §3.1 "The start scan", §5).
// Once per reader, the session transcript is read BACKWARDS from the stream's seam for helper facts only, in reads of
// READ_FROM_MAX_BYTES (review 2900 F10), at most HELPER_SCAN_CHUNKS_PER_READING a reading and never awaited by one, until
// it passes the time bound, HELPER_SCAN_BYTES, or the file's start. It ends at the seam so no byte is read twice, and it
// parses the line the backlog's window cut (review 2900 F4). And the fold of the scan's, the backlog's and the tail's facts
// gives the same rows in any order (review 2900 F4). Real files in a fixture dir, neutral names, a FleetIO wrapper that
// records every range read.
//
// RED FIRST: committed before the code, against origin/main, where none of it exists.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendFileSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { localIO, type FleetIO } from '../src/io.js';
import { READ_FROM_MAX_BYTES } from '../../shared/agent-protocol.js';
import { HELPER_FINISHED_KEEP_MS } from '../../shared/workflows.js';
import {
  HELPER_SCAN_BYTES,
  HELPER_SCAN_CHUNKS,
  HELPER_SCAN_CHUNKS_PER_READING,
  HelperStartScan,
  scanCutoff,
  type HelperScanSeam,
} from '../src/workflows/helperScan.js';
import { readBacklog } from '../src/transcript/tail.js';
import { helperFactsOf, type HelperFact } from '../src/transcript/parse.js';
import { decideAgentHelpers, emptyHelperMemory, foldHelperFacts, type HelperMeta, type RosterInput } from '../src/workflows/model.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = Date.parse('2026-11-21T10:00:00.000Z');
const iso = (ms: number): string => new Date(ms).toISOString();
const line = (o: unknown): string => `${JSON.stringify(o)}\n`;
const KIB = 1024;
const MIB = 1024 * KIB;

/** A plain user line of about `bytes` bytes. */
const filler = (at: number, bytes = 4 * KIB): string =>
  line({ type: 'user', uuid: `f-${at}`, timestamp: iso(at), message: { role: 'user', content: 'x'.repeat(Math.max(1, bytes - 120)) } });
/** About `total` bytes of filler lines, all at `at`. */
const fillerBlock = (at: number, total: number, each = 64 * KIB): string => {
  const one = filler(at, each);
  return one.repeat(Math.max(1, Math.ceil(total / one.length)));
};
const launchLine = (id: string, at: number, pad = 0): string => line({
  type: 'user', uuid: `l-${id}`, timestamp: iso(at),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_${id}`, content: `launched${'p'.repeat(pad)}` }] },
  toolUseResult: { isAsync: true, status: 'async_launched', agentId: id, description: 'd', resolvedModel: 'model-b', prompt: 'p' },
});
const noticeLine = (id: string, at: number, summary = 'all done'): string => line({
  type: 'user', uuid: `n-${id}`, timestamp: iso(at), origin: { kind: 'task-notification' },
  message: { role: 'user', content: `<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>\n<summary>${summary}</summary>\n<result>the report</result>\n</task-notification>` },
});

interface Ranged extends FleetIO { ranges: Array<{ offset: number; max: number }>; failAt: number }
const ranged = (inner: FleetIO = localIO): Ranged => {
  const io: Ranged = {
    ...inner,
    ranges: [],
    failAt: -1,
    readFileFromBytesMeasured: async (p, o, m, ...rest) => {
      io.ranges.push({ offset: o, max: m });
      return io.ranges.length - 1 === io.failAt ? { ok: false, reason: 'unreadable' } : inner.readFileFromBytesMeasured(p, o, m, ...rest);
    },
  };
  return io;
};

let home: string;
let file: string;
beforeEach(() => {
  home = mkTmp('ccrc-helper-scan-');
  const dir = path.join(home, '.claude-a', 'projects', '-work-project-a');
  mkdirSync(dir, { recursive: true });
  file = path.join(dir, 'session-uuid-a.jsonl');
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const NO_ROSTER: RosterInput = { kind: 'unusable', why: { why: 'absent' } };
const size = (): number => statSync(file).size;
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 2));

/** Wait until the reads this reading granted have ended. */
async function pumped(scan: HelperStartScan): Promise<void> {
  for (let k = 0; k < 50 && (scan as unknown as { pumping: boolean }).pumping; k++) await tick();
}

/** Step the scan as readings would, at least once and until it stops (or `max` readings), and every fact it handed over.
 *  At least once, so a seam handed to a stopped scan is seen (HF1: a restart, a lowered cutoff). */
async function drain(scan: HelperStartScan, seam: HelperScanSeam, o: { roster?: RosterInput; now?: number; max?: number } = {}): Promise<{ facts: HelperFact[]; readings: number }> {
  const facts: HelperFact[] = [];
  const step = (): void => { facts.push(...scan.step({ scan: seam, roster: o.roster ?? NO_ROSTER, now: o.now ?? NOW })); };
  let readings = 0;
  do {
    step();
    readings++;
    await pumped(scan);
  } while (readings < (o.max ?? 200) && !scan.done);
  step();
  return { facts, readings };
}

describe('the time it reads back to (scanCutoff)', () => {
  it('ten minutes before now, or the earliest start of a listed Agent helper when that is earlier', () => {
    expect(scanCutoff(NO_ROSTER, NOW)).toBe(NOW - HELPER_FINISHED_KEEP_MS);
    const roster: RosterInput = { kind: 'usable', at: NOW, entries: [
      { id: 'a1', name: 'Explore', startedAt: NOW - 60_000 },
      { id: 'a2', name: 'Explore', startedAt: NOW - 3_600_000 },
    ] };
    expect(scanCutoff(roster, NOW)).toBe(NOW - 3_600_000);
    expect(scanCutoff({ kind: 'usable', at: NOW, entries: [{ id: 'a1', name: 'Explore', startedAt: NOW - 60_000 }] }, NOW)).toBe(NOW - HELPER_FINISHED_KEEP_MS);
  });

  it('a workflow\'s agent, an entry with no id and one with no start do not move it', () => {
    const roster: RosterInput = { kind: 'usable', at: NOW, entries: [
      { id: 'w1', name: 'workflow-subagent', startedAt: NOW - 7_200_000 },
      { id: null, name: 'Explore', startedAt: NOW - 7_200_000 },
      { id: 'a3', name: 'Explore', startedAt: null },
    ] };
    expect(scanCutoff(roster, NOW)).toBe(NOW - HELPER_FINISHED_KEEP_MS);
  });
});

describe('where it reads: backwards from the seam, in READ_FROM_MAX_BYTES reads, no byte twice', () => {
  it('every read is at most READ_FROM_MAX_BYTES, ends at or before the seam, and the reads tile the file below it exactly once', async () => {
    writeFileSync(file, fillerBlock(NOW - 60_000, 2 * MIB));
    const end = size() - 300 * KIB;
    const io = ranged();
    const scan = new HelperStartScan(io, file);
    await drain(scan, { file, end });
    expect(scan.cost.stop).toBe('start');
    expect(io.ranges.every((r) => r.max <= READ_FROM_MAX_BYTES && r.max > 0)).toBe(true);
    expect(Math.max(...io.ranges.map((r) => r.offset + r.max))).toBe(end);
    const sorted = [...io.ranges].sort((a, b) => a.offset - b.offset);
    expect(sorted[0]!.offset).toBe(0);
    for (let k = 1; k < sorted.length; k++) expect(sorted[k]!.offset).toBe(sorted[k - 1]!.offset + sorted[k - 1]!.max);
    expect(scan.cost.bytes).toBe(end);
    expect(scan.cost.reads).toBe(Math.ceil(end / READ_FROM_MAX_BYTES));
    expect(HELPER_SCAN_CHUNKS * READ_FROM_MAX_BYTES).toBe(HELPER_SCAN_BYTES);
  });

  it('the facts it finds are those below the seam, and none above it', async () => {
    writeFileSync(file, launchLine('a1', NOW - 120_000) + fillerBlock(NOW - 100_000, 600 * KIB));
    const end = size();
    appendFileSync(file, launchLine('a2', NOW - 10_000));
    const { facts } = await drain(new HelperStartScan(localIO, file), { file, end });
    expect(facts.map((f) => f.id)).toEqual(['a1']);
  });

  it('the line the backlog\'s window cut is parsed once, by the scan: its head from the scan, its rest from the backlog', async () => {
    // A launch line that straddles the backlog window's first byte (the window is the file's last 1 MiB).
    const tail = fillerBlock(NOW - 30_000, MIB - 2_000);
    const straddler = launchLine('a1', NOW - 60_000, 6_000);
    writeFileSync(file, fillerBlock(NOW - 90_000, 400 * KIB) + straddler + tail);
    const b = await readBacklog(localIO, file, 50);
    expect(b.scanEnd).toBe(size() - MIB);
    expect(b.cut !== undefined && b.cut.length > 0).toBe(true);
    expect(b.helpers ?? []).toEqual([]); // the backlog drops the line it starts inside
    const io = ranged();
    const { facts } = await drain(new HelperStartScan(io, file), { file, end: b.scanEnd!, cut: b.cut });
    expect(facts.filter((f) => f.id === 'a1')).toHaveLength(1);
    expect(Math.max(...io.ranges.map((r) => r.offset + r.max))).toBe(b.scanEnd);
  });

  it('a seam on a line boundary: the backlog\'s cut is that whole line, and the scan parses it', async () => {
    const head = fillerBlock(NOW - 90_000, 300 * KIB);
    const l = launchLine('a1', NOW - 60_000);
    const rest = fillerBlock(NOW - 30_000, MIB);
    writeFileSync(file, head + l + rest);
    const { facts } = await drain(new HelperStartScan(localIO, file), { file, end: Buffer.byteLength(head), cut: l.slice(0, -1) });
    expect(facts.map((f) => f.id)).toEqual(['a1']);
  });

  it('(added after the first mutation round) a seam line longer than one read: the newest read holds no newline, and the line is still joined once', async () => {
    const big = launchLine('a1', NOW - 60_000, 400 * KIB);
    const tail = filler(NOW - 30_000, MIB - 50 * KIB);
    writeFileSync(file, fillerBlock(NOW - 90_000, 200 * KIB) + big + tail);
    const b = await readBacklog(localIO, file, 50);
    const seamInBig = size() - MIB - (size() - Buffer.byteLength(big) - Buffer.byteLength(tail));
    expect(seamInBig).toBeGreaterThan(READ_FROM_MAX_BYTES); // the newest read lies wholly inside the line
    const { facts } = await drain(new HelperStartScan(localIO, file), { file, end: b.scanEnd!, cut: b.cut });
    expect(facts.filter((f) => f.id === 'a1')).toHaveLength(1);
  });

  it('a resumed stream\'s seam (the client\'s offset, no cut) reads only below it', async () => {
    writeFileSync(file, launchLine('a1', NOW - 60_000) + fillerBlock(NOW - 30_000, 500 * KIB));
    const end = size();
    appendFileSync(file, noticeLine('a1', NOW - 5_000));
    const { facts } = await drain(new HelperStartScan(localIO, file), { file, end });
    expect(facts.map((f) => `${f.id}:${f.status}`)).toEqual(['a1:async_launched']);
  });
});

describe('when it stops: time, bytes, the file\'s start, a failed read', () => {
  it('time: a segment whose oldest line is older than the cutoff is the last; older bytes are not read', async () => {
    writeFileSync(file, fillerBlock(NOW - 3_600_000, 2 * MIB) + fillerBlock(NOW - 60_000, 600 * KIB));
    const io = ranged();
    const scan = new HelperStartScan(io, file);
    await drain(scan, { file, end: size() });
    expect(scan.cost.stop).toBe('time');
    expect(scan.cost.bytes).toBeLessThan(size());
    expect(scan.cost.reads).toBeLessThanOrEqual(Math.ceil((600 * KIB) / READ_FROM_MAX_BYTES) + 1);
  });

  it('time: a listed helper that started an hour ago moves the cutoff back, so its launch is found', async () => {
    writeFileSync(file, launchLine('a1', NOW - 3_600_000) + fillerBlock(NOW - 3_000_000, 2 * MIB) + fillerBlock(NOW - 60_000, 600 * KIB));
    const roster: RosterInput = { kind: 'usable', at: NOW, entries: [{ id: 'a1', name: 'Explore', startedAt: NOW - 3_600_000 }] };
    const scan = new HelperStartScan(localIO, file);
    const { facts } = await drain(scan, { file, end: size() }, { roster });
    expect(facts.map((f) => f.id)).toEqual(['a1']);
    expect(scan.cost.stop).toBe('start');
    const unlisted = new HelperStartScan(localIO, file);
    expect((await drain(unlisted, { file, end: size() })).facts).toEqual([]);
    expect(unlisted.cost.stop).toBe('time');
  });

  it('bytes: HELPER_SCAN_BYTES is the most it reads; a launch beyond it is not found, one inside it is', async () => {
    writeFileSync(file, launchLine('far', NOW - 60_000) + fillerBlock(NOW - 50_000, HELPER_SCAN_BYTES + 64 * KIB)
      + launchLine('near', NOW - 40_000) + fillerBlock(NOW - 30_000, 512 * KIB));
    const io = ranged();
    const scan = new HelperStartScan(io, file);
    const { facts, readings } = await drain(scan, { file, end: size() });
    expect(scan.cost.stop).toBe('bytes');
    expect(scan.cost.bytes).toBe(HELPER_SCAN_BYTES);
    expect(scan.cost.reads).toBe(HELPER_SCAN_CHUNKS);
    expect(readings).toBe(Math.ceil(HELPER_SCAN_CHUNKS / HELPER_SCAN_CHUNKS_PER_READING));
    expect(facts.map((f) => f.id)).toEqual(['near']);
  });

  it('the file\'s start: a seam at 0 reads nothing', async () => {
    writeFileSync(file, launchLine('a1', NOW - 60_000));
    const io = ranged();
    const scan = new HelperStartScan(io, file);
    expect((await drain(scan, { file, end: 0 })).facts).toEqual([]);
    expect(scan.cost).toEqual({ bytes: 0, reads: 0, stop: 'start' });
    expect(io.ranges).toEqual([]);
  });

  it('a failed read ends the scan, and the facts it found before stand', async () => {
    writeFileSync(file, launchLine('old', NOW - 60_000) + fillerBlock(NOW - 50_000, 600 * KIB) + launchLine('new', NOW - 40_000) + fillerBlock(NOW - 30_000, 100 * KIB));
    const io = ranged();
    io.failAt = 1;
    const scan = new HelperStartScan(io, file);
    const { facts } = await drain(scan, { file, end: size() });
    expect(scan.cost.stop).toBe('unreadable');
    expect(scan.cost.reads).toBe(2);
    expect(facts.map((f) => f.id)).toEqual(['new']);
  });

  it('(HF1, review 3067 F2) a range read that REJECTS ends the scan unreadable, keeps what it found, and no rejection goes unhandled', async () => {
    writeFileSync(file, launchLine('old', NOW - 60_000) + fillerBlock(NOW - 50_000, 600 * KIB) + launchLine('new', NOW - 40_000) + fillerBlock(NOW - 30_000, 100 * KIB));
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown): void => { unhandled.push(e); };
    process.on('unhandledRejection', onUnhandled);
    try {
      let n = 0;
      const io: FleetIO = {
        ...localIO,
        readFileFromBytesMeasured: async (p, o, m, ...rest) => {
          if (n++ === 1) throw new Error('the link dropped the read');
          return localIO.readFileFromBytesMeasured(p, o, m, ...rest);
        },
      };
      const scan = new HelperStartScan(io, file);
      const { facts } = await drain(scan, { file, end: size() }, { max: 5 });
      await new Promise((r) => setImmediate(r)); // a rejection nobody handled is reported after the microtasks drain
      expect(scan.cost.stop).toBe('unreadable');
      expect(scan.cost.reads).toBe(2);
      expect(facts.map((f) => f.id)).toEqual(['new']);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('(HF1, review 3067 F3) time: a read whose OLDEST line alone is older than the cutoff is the last read', async () => {
    const below = fillerBlock(NOW - 50_000, MIB); // 64 KiB lines, all newer than the cutoff
    const old = filler(NOW - 3_600_000, 4 * KIB); // the one line older than it
    const top = fillerBlock(NOW - 30_000, 150 * KIB);
    writeFileSync(file, below + old + top);
    // The newest read starts inside `below`'s last line, so its whole lines are `old`, then `top`'s, all newer.
    expect(Buffer.byteLength(old + top)).toBeLessThan(READ_FROM_MAX_BYTES);
    expect(Buffer.byteLength(filler(NOW - 50_000, 64 * KIB) + old + top)).toBeGreaterThan(READ_FROM_MAX_BYTES);
    const io = ranged();
    const scan = new HelperStartScan(io, file);
    await drain(scan, { file, end: size() });
    expect(scan.cost).toEqual({ bytes: READ_FROM_MAX_BYTES, reads: 1, stop: 'time' });
    expect(io.ranges).toHaveLength(1);
  });

  it('a seam for another transcript does not start it', async () => {
    writeFileSync(file, launchLine('a1', NOW - 60_000));
    const io = ranged();
    const scan = new HelperStartScan(io, `${file}.other`);
    expect((await drain(scan, { file, end: size() }, { max: 3 })).facts).toEqual([]);
    expect(io.ranges).toEqual([]);
    expect(scan.done).toBe(false);
  });
});

describe('its pace: outside the feed\'s polling gate (review 2900 F10)', () => {
  /** A FleetIO whose range reads wait until the test releases them. */
  const held = (): FleetIO & { pending: Array<() => void>; started: number } => {
    const io = {
      ...localIO,
      pending: [] as Array<() => void>,
      started: 0,
      readFileFromBytesMeasured: (p: string, o: number, m: number) => {
        io.started++;
        return new Promise<Awaited<ReturnType<FleetIO['readFileFromBytesMeasured']>>>((resolve) => {
          io.pending.push(() => { void localIO.readFileFromBytesMeasured(p, o, m).then(resolve); });
        });
      },
    };
    return io as FleetIO & { pending: Array<() => void>; started: number };
  };

  it('a step never waits for a read: it returns at once, with the read still in flight', () => {
    writeFileSync(file, fillerBlock(NOW - 60_000, 2 * MIB));
    const io = held();
    const scan = new HelperStartScan(io, file);
    expect(scan.step({ scan: { file, end: size() }, roster: NO_ROSTER, now: NOW })).toEqual([]);
    expect(io.started).toBe(1);
    expect(io.pending).toHaveLength(1);
  });

  it('one read at a time, at most HELPER_SCAN_CHUNKS_PER_READING a reading, and a scan nobody steps stops after its grant', async () => {
    writeFileSync(file, fillerBlock(NOW - 60_000, 3 * MIB));
    const io = held();
    const scan = new HelperStartScan(io, file);
    scan.step({ scan: { file, end: size() }, roster: NO_ROSTER, now: NOW });
    scan.step({ scan: { file, end: size() }, roster: NO_ROSTER, now: NOW }); // a second reading while the first read waits
    for (let k = 0; k < 20; k++) {
      expect(io.pending.length).toBeLessThanOrEqual(1);
      const release = io.pending.shift();
      if (release === undefined) { await tick(); continue; }
      release();
      await tick();
    }
    expect(io.started).toBe(HELPER_SCAN_CHUNKS_PER_READING);
    expect(scan.done).toBe(false);
    scan.step({ scan: { file, end: size() }, roster: NO_ROSTER, now: NOW });
    for (let k = 0; k < 20; k++) { io.pending.shift()?.(); await tick(); }
    expect(io.started).toBe(2 * HELPER_SCAN_CHUNKS_PER_READING);
  });

  it('it starts once: a later seam (a second backlog on the same transcript) does not restart it', async () => {
    writeFileSync(file, launchLine('a1', NOW - 60_000) + fillerBlock(NOW - 50_000, 300 * KIB));
    const io = ranged();
    const scan = new HelperStartScan(io, file);
    await drain(scan, { file, end: size() });
    const reads = io.ranges.length;
    expect(scan.step({ scan: { file, end: size() }, roster: NO_ROSTER, now: NOW })).toEqual([]);
    await tick();
    expect(io.ranges.length).toBe(reads);
  });
});

describe('the fold of the scan\'s, the backlog\'s and the tail\'s facts is the same in any order (review 2900 F4)', () => {
  const fact = (o: Partial<HelperFact> & Pick<HelperFact, 'id' | 'source' | 'status'>): HelperFact =>
    ({ at: null, model: null, durationMs: null, summary: null, report: null, reportCut: false, ...o });
  // Three groups as the three sources would hand them over, with ties the order used to decide: two launches of one id at
  // one time and none, two ends of one outcome at one time, two ends with no time, and a notification and a foreground
  // completed result at one time.
  const scanned: HelperFact[] = [
    fact({ id: 'a1', source: 'launch', status: 'async_launched', at: NOW - 300_000, model: 'model-a' }),
    fact({ id: 'a2', source: 'launch', status: 'async_launched', at: null, model: 'model-a' }),
    fact({ id: 'a3', source: 'notification', status: 'completed', at: NOW - 60_000, summary: 'first' }),
    fact({ id: 'a4', source: 'notification', status: 'failed', at: null, summary: 'x' }),
    fact({ id: 'a5', source: 'launch', status: 'completed', at: NOW - 30_000, report: 'r', durationMs: 5_000 }),
  ];
  const backlog: HelperFact[] = [
    fact({ id: 'a1', source: 'launch', status: 'async_launched', at: NOW - 300_000, model: 'model-b' }),
    fact({ id: 'a2', source: 'launch', status: 'async_launched', at: null, model: 'model-b' }),
    fact({ id: 'a3', source: 'notification', status: 'completed', at: NOW - 60_000, summary: 'second', report: 'r' }),
    fact({ id: 'a3', source: 'launch', status: 'async_launched', at: NOW - 200_000 }),
  ];
  const tail: HelperFact[] = [
    fact({ id: 'a4', source: 'notification', status: 'failed', at: null, summary: 'y', report: 'r' }),
    fact({ id: 'a5', source: 'notification', status: 'completed', at: NOW - 30_000, summary: 's' }),
    fact({ id: 'a4', source: 'launch', status: 'async_launched', at: NOW - 100_000 }),
    fact({ id: 'a2', source: 'notification', status: 'completed', at: NOW - 20_000, summary: 'done' }),
  ];
  const orders = <T>(xs: T[]): T[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => orders([...xs.slice(0, i), ...xs.slice(i + 1)]).map((r) => [x, ...r])));
  const metas = new Map<string, HelperMeta>(['a1', 'a2', 'a3', 'a4', 'a5'].map((id) => [id, {
    path: 'agent', agentType: 'Explore', description: `look at ${id}`, model: null, effort: null, finished: false, lastWriteAt: null, tokens: null,
  }]));
  const roster: RosterInput = { kind: 'usable', at: NOW, entries: [{ id: 'a1', name: 'Explore', startedAt: NOW - 300_000 }] };
  const rowsOf = (folded: ReturnType<typeof foldHelperFacts>) =>
    decideAgentHelpers({ now: NOW, roster, proc: { kind: 'live', startedAt: NOW - 3_600_000 }, facts: folded, metas, memory: emptyHelperMemory() }).agents;
  const byId = (m: ReturnType<typeof foldHelperFacts>) => Object.fromEntries([...m].sort(([a], [b]) => (a < b ? -1 : 1)));

  it('every order of the three groups, folded in one reading or across three, gives the same facts and the same rows', () => {
    const want = foldHelperFacts(new Map(), [...scanned, ...backlog, ...tail]);
    for (const order of orders([scanned, backlog, tail])) {
      const one = foldHelperFacts(new Map(), order.flat());
      const three = order.reduce((m, g) => foldHelperFacts(m, g), new Map() as ReturnType<typeof foldHelperFacts>);
      for (const got of [one, three]) {
        expect(byId(got)).toEqual(byId(want));
        expect(rowsOf(got)).toEqual(rowsOf(want));
      }
    }
  });

  it('every order of the single facts gives the same facts, reversed and rotated included', () => {
    const all = [...scanned, ...backlog, ...tail];
    const want = byId(foldHelperFacts(new Map(), all));
    for (let k = 0; k < all.length; k++) {
      const rotated = [...all.slice(k), ...all.slice(0, k)];
      expect(byId(foldHelperFacts(new Map(), rotated))).toEqual(want);
      expect(byId(foldHelperFacts(new Map(), [...rotated].reverse()))).toEqual(want);
    }
  });

  it('the ties are decided by content: the earlier launch, the later end, and between equals one rule', () => {
    const m = foldHelperFacts(new Map(), [...scanned, ...backlog, ...tail]);
    expect(m.get('a1')!.launch).toEqual({ at: NOW - 300_000, model: 'model-b', async: true, durationMs: null });
    expect(m.get('a3')!.end).toMatchObject({ outcome: 'done', at: NOW - 60_000, summary: 'second', hasReport: true });
    expect(m.get('a4')!.end).toMatchObject({ outcome: 'failed', at: null, summary: 'y', hasReport: true });
    expect(m.get('a5')!.end).toMatchObject({ outcome: 'done', at: NOW - 30_000, summary: 's', from: 'notification' }); // a summary first
  });

  it('(added after the first mutation round) a summary ranks above a report, and a report above content', () => {
    const at = NOW - 60_000;
    const withReport = fact({ id: 'a6', source: 'notification', status: 'completed', at, summary: 'a', report: 'r' });
    const without = fact({ id: 'a6', source: 'notification', status: 'completed', at, summary: 'z' });
    for (const order of [[withReport, without], [without, withReport]]) {
      expect(foldHelperFacts(new Map(), order).get('a6')!.end).toMatchObject({ summary: 'a', hasReport: true });
    }
    const summarised = fact({ id: 'a7', source: 'notification', status: 'completed', at, summary: 'a' });
    const reported = fact({ id: 'a7', source: 'launch', status: 'completed', at, report: 'r' });
    for (const order of [[summarised, reported], [reported, summarised]]) {
      expect(foldHelperFacts(new Map(), order).get('a7')!.end).toMatchObject({ summary: 'a', hasReport: false });
    }
  });

  it('past HELPER_FACTS_MAX ids the fold keeps the newest by fact time, whatever the order', () => {
    const many = Array.from({ length: 300 }, (_, k) => fact({ id: `m${k}`, source: 'launch', status: 'async_launched', at: NOW - 1_000_000 + k * 1_000 }));
    const want = [...foldHelperFacts(new Map(), many).keys()].sort();
    expect(want).toHaveLength(256);
    expect(want).not.toContain('m0');
    expect(want).toContain('m299');
    expect([...foldHelperFacts(new Map(), [...many].reverse()).keys()].sort()).toEqual(want);
  });

  it('(added after the first mutation round) past the bound, ids whose newest facts tie in time are kept by id, whatever the order', () => {
    const tied = Array.from({ length: 300 }, (_, k) => fact({ id: `t${k}`, source: 'launch', status: 'async_launched', at: NOW }));
    const want = [...foldHelperFacts(new Map(), tied).keys()].sort();
    expect([...foldHelperFacts(new Map(), [...tied].reverse()).keys()].sort()).toEqual(want);
    expect([...foldHelperFacts(new Map(), [...tied.slice(150), ...tied.slice(0, 150)]).keys()].sort()).toEqual(want);
  });

  it('(HF1, review 3067 F4) past the bound an id ranks by the NEWER of its two facts: an old launch with a new end is kept, and the reverse', () => {
    const many = Array.from({ length: 300 }, (_, k) => fact({ id: `m${k}`, source: 'launch', status: 'async_launched', at: NOW - 1_000_000 + k * 1_000 }));
    // x: launched long before every other id, ended after all of them. y: the reverse (its end older than its launch).
    const x = [fact({ id: 'x', source: 'launch', status: 'async_launched', at: NOW - 5_000_000 }), fact({ id: 'x', source: 'notification', status: 'completed', at: NOW, summary: 's' })];
    const y = [fact({ id: 'y', source: 'launch', status: 'async_launched', at: NOW }), fact({ id: 'y', source: 'notification', status: 'completed', at: NOW - 5_000_000, summary: 's' })];
    for (const order of [[...x, ...y, ...many], [...many, ...y, ...x], [x[1]!, y[0]!, ...many, y[1]!, x[0]!]]) {
      const kept = foldHelperFacts(new Map(), order);
      expect(kept.size).toBe(256);
      expect(kept.get('x')).toMatchObject({ launch: { at: NOW - 5_000_000 }, end: { at: NOW } });
      expect(kept.get('y')).toMatchObject({ launch: { at: NOW }, end: { at: NOW - 5_000_000 } });
      expect(kept.has('m45')).toBe(false); // the two kept in their place are the two oldest of the rest
      expect(kept.has('m46')).toBe(true);
    }
  });
});

describe('(HF1) a new seam after a failed read, and a later roster (review 3067 F6, F7)', () => {
  const listed = (startedAt: number): RosterInput => ({ kind: 'usable', at: NOW, entries: [{ id: 'a1', name: 'Explore', startedAt }] });
  /** The file the F7 cases read: a1's launch an hour back, 2 MiB of lines older than ten minutes, then 600 KiB of new ones. */
  const hourBack = (): void => {
    writeFileSync(file, launchLine('a1', NOW - 3_600_000) + fillerBlock(NOW - 3_000_000, 2 * MIB) + fillerBlock(NOW - 60_000, 600 * KIB));
  };
  const tiles = (io: Ranged, end: number): void => {
    const sorted = [...io.ranges].sort((a, b) => a.offset - b.offset);
    expect(sorted[0]!.offset).toBe(0);
    for (let k = 1; k < sorted.length; k++) expect(sorted[k]!.offset).toBe(sorted[k - 1]!.offset + sorted[k - 1]!.max);
    expect(Math.max(...io.ranges.map((r) => r.offset + r.max))).toBe(end);
  };

  it('F6: a new seam restarts a scan that stopped unreadable, once per seam; the same seam again does not', async () => {
    writeFileSync(file, launchLine('a1', NOW - 60_000) + fillerBlock(NOW - 50_000, 300 * KIB));
    const first = size();
    appendFileSync(file, launchLine('a2', NOW - 40_000) + fillerBlock(NOW - 30_000, 100 * KIB));
    const io = ranged();
    io.failAt = 0;
    const scan = new HelperStartScan(io, file);
    expect((await drain(scan, { file, end: first })).facts).toEqual([]);
    expect(scan.cost.stop).toBe('unreadable');
    expect((await drain(scan, { file, end: first }, { max: 3 })).facts).toEqual([]); // the same seam, a new object: no restart
    expect(io.ranges).toHaveLength(1);
    const again = await drain(scan, { file, end: size() }); // a new seam (the stream's next backlog): one restart
    expect(scan.cost.stop).toBe('start');
    expect(again.facts.map((f) => f.id).sort()).toEqual(['a1', 'a2']);
    expect(Math.max(...io.ranges.slice(1).map((r) => r.offset + r.max))).toBe(size());
  });

  it('F6: a restarted scan that fails again waits for the next new seam; a scan that stopped on any other word never restarts', async () => {
    writeFileSync(file, launchLine('a1', NOW - 60_000) + fillerBlock(NOW - 50_000, 300 * KIB));
    const io = ranged();
    io.failAt = 0;
    const scan = new HelperStartScan(io, file);
    await drain(scan, { file, end: size() - 10 });
    io.failAt = 1;
    await drain(scan, { file, end: size() - 5 });
    expect(scan.cost.stop).toBe('unreadable');
    expect(io.ranges).toHaveLength(2);
    await drain(scan, { file, end: size() - 5 }, { max: 2 });
    expect(io.ranges).toHaveLength(2);
    io.failAt = -1;
    await drain(scan, { file, end: size() });
    expect(scan.cost.stop).toBe('start');
    const reads = io.ranges.length;
    await drain(scan, { file, end: size() - 1 }, { max: 2 }); // stopped at the file's start: a new seam restarts nothing
    expect(io.ranges).toHaveLength(reads);
  });

  it('F7: a later usable roster lowers the cutoff, so a scan that stopped on time reads on, from where it stopped, to the earlier start', async () => {
    hourBack();
    const io = ranged();
    const scan = new HelperStartScan(io, file);
    expect((await drain(scan, { file, end: size() })).facts).toEqual([]); // no usable roster yet: ten minutes back
    expect(scan.cost.stop).toBe('time');
    const later = await drain(scan, { file, end: size() }, { roster: listed(NOW - 3_600_000) });
    expect(later.facts.map((f) => f.id)).toEqual(['a1']);
    expect(scan.cost.stop).toBe('start');
    expect(scan.cost.bytes).toBe(size());
    tiles(io, size()); // no byte twice
  });

  it('F7: the cutoff only falls: a later roster that starts no earlier, or a roster read again, leaves a time stop standing', async () => {
    hourBack();
    const io = ranged();
    const scan = new HelperStartScan(io, file);
    await drain(scan, { file, end: size() });
    const reads = io.ranges.length;
    await drain(scan, { file, end: size() }, { roster: listed(NOW - 60_000), max: 2 });
    await drain(scan, { file, end: size() }, { roster: listed(NOW - 60_000), now: NOW + 3_600_000, max: 2 });
    await drain(scan, { file, end: size() }, { now: NOW - 3_600_000, max: 2 }); // a clock stepped back, with no usable roster
    expect(io.ranges).toHaveLength(reads);
    expect(scan.cost.stop).toBe('time');
  });

  it('F7: the minimum of old and new: a running scan keeps an earlier cutoff when a later reading\'s cutoff is later', async () => {
    hourBack();
    const scan = new HelperStartScan(localIO, file);
    const facts = scan.step({ scan: { file, end: size() }, roster: listed(NOW - 3_600_000), now: NOW });
    await pumped(scan);
    facts.push(...(await drain(scan, { file, end: size() }, { roster: listed(NOW - 60_000), now: NOW + 60_000 })).facts);
    expect(facts.map((f) => f.id)).toEqual(['a1']);
    expect(scan.cost.stop).toBe('start');
  });
});

describe('a real scan\'s facts are the tailer\'s (one parser)', () => {
  it('the facts the scan hands over are exactly helperFactsOf of the lines it read', async () => {
    const lines = [launchLine('a1', NOW - 90_000), noticeLine('a1', NOW - 80_000), launchLine('a2', NOW - 70_000)];
    writeFileSync(file, lines.join('') + fillerBlock(NOW - 60_000, 300 * KIB));
    const { facts } = await drain(new HelperStartScan(localIO, file), { file, end: size() });
    expect(facts).toEqual(lines.flatMap((l) => helperFactsOf(l.slice(0, -1))));
  });
});
