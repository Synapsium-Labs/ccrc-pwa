// Older chat record framing (desktop polish run 3531, isolated slice): `readOlderRange` walks complete transcript records
// backward from a line-start cursor in bounded pages, over the existing backward walker and the FleetIO range read. Every
// fixture is synthetic; the one real-file case writes its own temp file.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { localIO, type FleetIO, type ReadFailure } from '../src/io.js';
import {
  OLDER_RANGE_LIMITS, readOlderRange, type OlderRangeCursor, type OlderRangeLimits, type OlderRangeRead, type OlderRecord,
} from '../src/transcript/olderRange.js';
import { READ_FROM_MAX_BYTES } from '../../shared/agent-protocol.js';
import { mkTmp } from './tmpHelpers.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

type Fault = { at: number; reason: ReadFailure };

/** A FleetIO whose one file is `data`, honouring the range read's contract: an ok read is exactly
 *  `min(maxBytes, size - offset)` bytes and an offset past the size is `unreadable`. `fault` makes the read numbered `at`
 *  (1-based) fail. Every read is logged as [offset, maxBytes]. */
const memIO = (data: Uint8Array, fault?: Fault): FleetIO & { reads: Array<[number, number]> } => {
  const reads: Array<[number, number]> = [];
  return {
    ...localIO,
    reads,
    readFileFromBytesMeasured: async (_p, offset, maxBytes) => {
      reads.push([offset, maxBytes]);
      if (fault !== undefined && reads.length === fault.at) return { ok: false, reason: fault.reason };
      if (offset > data.length) return { ok: false, reason: 'unreadable' };
      return { ok: true, bytes: data.slice(offset, offset + maxBytes), size: data.length };
    },
  };
};

/** `memIO` whose file is cut to `to` bytes right after read number `after` (1-based) answers, so a LATER read of the same
 *  page sees the shorter file, under the same contract (an offset past the size is `unreadable`). */
const shrinkingIO = (data: Uint8Array, after: number, to: number): FleetIO & { reads: Array<[number, number]> } => {
  const reads: Array<[number, number]> = [];
  let now = data;
  return {
    ...localIO,
    reads,
    readFileFromBytesMeasured: async (_p, offset, maxBytes) => {
      reads.push([offset, maxBytes]);
      const r = offset > now.length
        ? { ok: false as const, reason: 'unreadable' as const }
        : { ok: true as const, bytes: now.slice(offset, offset + maxBytes), size: now.length };
      if (reads.length === after) now = data.slice(0, to);
      return r;
    },
  };
};

const lim = (chunkBytes: number, chunks = 4, records = 50): OlderRangeLimits => ({ chunkBytes, chunks, records });
const lineStart = (before: number): OlderRangeCursor => ({ kind: 'line-start', before });
const text = (r: OlderRecord): string => dec.decode(r.bytes);
const okRead = (r: OlderRangeRead): Extract<OlderRangeRead, { ok: true }> => {
  if (!r.ok) throw new Error(`refused: ${r.reason}`);
  return r;
};

/** Every record a file yields, from EOF back to its start, page by page, with each gap marker in place, plus the reads.
 *  Asserts on every page: reads stay below the page's cursor and inside the limits, records stay inside the cap, and
 *  the next cursor is strictly lower than this one. */
async function pageAll(data: Uint8Array, limits: OlderRangeLimits, maxPages = 500): Promise<{
  items: Array<OlderRecord | { gap: number }>; pages: number;
}> {
  return pageAllFrom(data, lineStart(data.length), limits, maxPages);
}

/** `pageAll` from a given first cursor. */
async function pageAllFrom(data: Uint8Array, first: OlderRangeCursor, limits: OlderRangeLimits, maxPages = 500): Promise<{
  items: Array<OlderRecord | { gap: number }>; pages: number;
}> {
  const items: Array<OlderRecord | { gap: number }> = [];
  let cursor = first;
  for (let page = 1; page <= maxPages; page += 1) {
    const io = memIO(data);
    const r = okRead(await readOlderRange(io, 'f', cursor, limits));
    expect(io.reads.length).toBeLessThanOrEqual(limits.chunks);
    for (const [offset, max] of io.reads) {
      expect(max).toBeLessThanOrEqual(limits.chunkBytes);
      expect(offset + max).toBeLessThanOrEqual(cursor.before);
    }
    expect(r.records.length).toBeLessThanOrEqual(limits.records);
    items.unshift(...r.records);
    if (r.continuation.kind === 'start') return { items, pages: page };
    if (r.continuation.kind === 'gap') items.unshift({ gap: r.continuation.cursor.before });
    expect(r.continuation.cursor.before).toBeLessThan(cursor.before);
    cursor = r.continuation.cursor;
  }
  throw new Error('no start within maxPages');
}

const records = (items: Array<OlderRecord | { gap: number }>): OlderRecord[] =>
  items.filter((i): i is OlderRecord => 'bytes' in i);

/** The records a whole file holds, framed directly: every `\n`-terminated piece, blank ones included. */
const expected = (data: Uint8Array): Array<{ start: number; end: number; text: string }> => {
  const out: Array<{ start: number; end: number; text: string }> = [];
  let from = 0;
  for (let i = 0; i < data.length; i += 1) {
    if (data[i] === 10) { out.push({ start: from, end: i + 1, text: dec.decode(data.slice(from, i)) }); from = i + 1; }
  }
  return out;
};
const spans = (rs: OlderRecord[]): Array<{ start: number; end: number; text: string }> =>
  rs.map((r) => ({ start: r.start, end: r.end, text: text(r) }));

describe('readOlderRange: complete records', () => {
  it('a multilingual line split across chunks keeps its exact byte span and bytes', async () => {
    const data = enc.encode('a\nпривет 世界 🙂 ünï\nb\n');
    // The 31-byte line fits the window (4 reads of 8 bytes or more); every size splits a multibyte character somewhere.
    for (const chunk of [8, 9, 10, 11, 13]) {
      const { items } = await pageAll(data, lim(chunk));
      expect(spans(records(items))).toEqual(expected(data));
      const mid = records(items)[1]!;
      expect(Buffer.from(mid.bytes).equals(Buffer.from(enc.encode('привет 世界 🙂 ünï')))).toBe(true);
    }
  });

  it('CRLF bytes stay in the record and do not shift a span', async () => {
    const data = enc.encode('one\r\ntwo\r\n\r\n');
    const r = okRead(await readOlderRange(memIO(data), 'f', lineStart(data.length), lim(4)));
    expect(spans(r.records)).toEqual([
      { start: 0, end: 5, text: 'one\r' }, { start: 5, end: 10, text: 'two\r' }, { start: 10, end: 12, text: '\r' },
    ]);
    expect(r.continuation).toEqual({ kind: 'start' });
  });

  it('blank rows are records with empty bytes, each at its own offset', async () => {
    const data = enc.encode('a\n\n\nb\n');
    const r = okRead(await readOlderRange(memIO(data), 'f', lineStart(data.length), lim(2)));
    expect(spans(r.records)).toEqual([
      { start: 0, end: 2, text: 'a' }, { start: 2, end: 3, text: '' }, { start: 3, end: 4, text: '' }, { start: 4, end: 6, text: 'b' },
    ]);
  });

  it('a delimiter on a chunk edge (last byte or first byte of a chunk) skips no neighbouring record', async () => {
    for (const [s, chunk] of [['ab\ncd\nef\n', 3], ['ab\ncde\n', 5], ['abc\nde\n', 3], ['\n\nx\n', 1]] as const) {
      const data = enc.encode(s);
      const { items } = await pageAll(data, lim(chunk, 4));
      expect(spans(records(items))).toEqual(expected(data));
      expect(items.some((i) => 'gap' in i)).toBe(false);
    }
  });

  it('consecutive pages across a record cap are exact: no overlap, no gap, and start only at offset zero', async () => {
    const data = enc.encode(['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'].map((x) => `${x}\n`).join(''));
    const first = okRead(await readOlderRange(memIO(data), 'f', lineStart(data.length), lim(64, 4, 3)));
    expect(first.records.map(text)).toEqual(['r5', 'r6', 'r7']);
    expect(first.continuation).toEqual({ kind: 'more', cursor: lineStart(12) });
    const second = okRead(await readOlderRange(memIO(data), 'f', lineStart(12), lim(64, 4, 3)));
    expect(second.records.map(text)).toEqual(['r2', 'r3', 'r4']);
    expect(second.continuation).toEqual({ kind: 'more', cursor: lineStart(3) });
    const third = okRead(await readOlderRange(memIO(data), 'f', lineStart(3), lim(64, 4, 3)));
    expect(third.records.map(text)).toEqual(['r1']);
    expect(third.continuation).toEqual({ kind: 'start' });
    const { items } = await pageAll(data, lim(2, 4, 3));
    expect(spans(records(items))).toEqual(expected(data));
  });

  it('a cap reached exactly at the record that starts at offset zero answers start', async () => {
    const data = enc.encode('a\nb\n');
    const r = okRead(await readOlderRange(memIO(data), 'f', lineStart(4), lim(64, 4, 2)));
    expect(r.records.map(text)).toEqual(['a', 'b']);
    expect(r.continuation).toEqual({ kind: 'start' });
  });

  it('a page that runs out of reads before offset zero answers more, never start', async () => {
    const data = enc.encode('aa\nbb\ncc\ndd\n');
    const r = okRead(await readOlderRange(memIO(data), 'f', lineStart(data.length), lim(3, 2)));
    expect(r.records.map(text)).toEqual(['dd']);
    expect(r.continuation).toEqual({ kind: 'more', cursor: lineStart(9) });
  });

  it('reads stay below the cursor, inside the caps, and never touch the record that starts at the cursor', async () => {
    const data = enc.encode('x'.repeat(10) + '\n' + 'y'.repeat(10) + '\n' + 'tail-not-read\n');
    const io = memIO(data);
    const r = okRead(await readOlderRange(io, 'f', lineStart(22), lim(4, 4)));
    for (const [offset, max] of io.reads) expect(offset + max).toBeLessThanOrEqual(22);
    expect(io.reads.length).toBeLessThanOrEqual(4);
    expect(r.records.map(text)).not.toContain('tail-not-read');
  });

  it('production caps are four reads of the agent range cap and fifty records', () => {
    expect(OLDER_RANGE_LIMITS).toEqual({ chunkBytes: READ_FROM_MAX_BYTES, chunks: 4, records: 50 });
    expect(OLDER_RANGE_LIMITS.chunkBytes * OLDER_RANGE_LIMITS.chunks).toBe(1024 * 1024);
  });

  // The byte half of the caps is pinned by the constant above and by the refusal rows; this fixture is far below 1 MiB.
  it('under the production caps a page stops at 50 records', async () => {
    const data = enc.encode(Array.from({ length: 120 }, (_, i) => `{"n":${i}}\n`).join(''));
    const io = memIO(data);
    const r = okRead(await readOlderRange(io, 'f', lineStart(data.length)));
    expect(r.records).toHaveLength(50);
    expect(io.reads.reduce((n, [, m]) => n + m, 0)).toBeLessThanOrEqual(1024 * 1024);
  });

  it('a real file through the local adapter pages exactly', async () => {
    const dir = mkTmp('older-range-');
    const file = path.join(dir, 't.jsonl');
    const data = enc.encode(['{"a":1}', '', 'ünï 🙂', '{"b":2}'].map((x) => `${x}\n`).join(''));
    writeFileSync(file, data);
    const all: OlderRecord[] = [];
    let cursor = lineStart(data.length);
    for (;;) {
      const r = okRead(await readOlderRange(localIO, file, cursor, lim(4, 4, 2)));
      all.unshift(...r.records);
      if (r.continuation.kind === 'start') break;
      cursor = r.continuation.cursor;
    }
    expect(spans(all)).toEqual(expected(data));
  });
});

describe('readOlderRange: refusals', () => {
  it('a line-start cursor whose byte before is not a newline refuses invalid-boundary', async () => {
    const data = enc.encode('abc\ndef\n');
    expect(await readOlderRange(memIO(data), 'f', lineStart(6), lim(4))).toEqual({ ok: false, reason: 'invalid-boundary' });
  });

  it('a short range read (the file no longer reaches the cursor) refuses invalid-boundary, never start', async () => {
    const data = enc.encode('aa\nbb\n');
    expect(await readOlderRange(memIO(data), 'f', lineStart(8), lim(4))).toEqual({ ok: false, reason: 'invalid-boundary' });
  });

  it('a LATER read shortened after an earlier read succeeded refuses invalid-boundary, after exactly these reads', async () => {
    // 'aa\nbb\ncc\ndd\n', windows of 3 from the end: read 1 [9,12) reads 'dd\n', which frames nothing until the bytes before
    // it are read; then the file is cut to 7 bytes, so read 2 [6,9) answers one byte where three were asked.
    const io = shrinkingIO(enc.encode('aa\nbb\ncc\ndd\n'), 1, 7);
    expect(await readOlderRange(io, 'f', lineStart(12), lim(3, 4))).toEqual({ ok: false, reason: 'invalid-boundary' });
    expect(io.reads).toEqual([[9, 3], [6, 3]]);
  });

  it('a file shrunk BELOW a later read\'s offset answers the adapter\'s own unreadable, after exactly these reads', async () => {
    const io = shrinkingIO(enc.encode('aa\nbb\ncc\ndd\n'), 1, 5);
    expect(await readOlderRange(io, 'f', lineStart(12), lim(3, 4))).toEqual({ ok: false, reason: 'unreadable' });
    expect(io.reads).toEqual([[9, 3], [6, 3]]);
  });

  it('a file with no trailing newline: line-start at its size refuses, skip-record at its size answers the records before', async () => {
    const data = enc.encode('aa\nbb\nunterminated');
    expect(await readOlderRange(memIO(data), 'f', lineStart(data.length), lim(64))).toEqual({ ok: false, reason: 'invalid-boundary' });
    for (const limits of [lim(64), lim(4, 4)]) {
      const { items } = await pageAllFrom(data, { kind: 'skip-record', before: data.length }, limits);
      expect(items.filter((i) => 'gap' in i)).toEqual([]);
      expect(records(items).map(text)).toEqual(['aa', 'bb']);
      for (const r of records(items)) expect(text(r)).not.toContain('unterminated');
    }
  });

  it('a later absent or unreadable read discards the records an earlier read framed', async () => {
    const data = enc.encode('aa\nbb\ncc\ndd\n');
    for (const reason of ['absent', 'unreadable'] as const) {
      const io = memIO(data, { at: 2, reason });
      expect(await readOlderRange(io, 'f', lineStart(data.length), lim(3, 4))).toEqual({ ok: false, reason });
      expect(io.reads).toHaveLength(2);
    }
  });

  it('a first read that fails answers its own reason', async () => {
    const data = enc.encode('aa\n');
    expect(await readOlderRange(memIO(data, { at: 1, reason: 'absent' }), 'f', lineStart(3), lim(4)))
      .toEqual({ ok: false, reason: 'absent' });
  });

  it('a cursor or limits outside the bounds refuse invalid-boundary without a read', async () => {
    const data = enc.encode('aa\n');
    const bad: Array<[OlderRangeCursor, OlderRangeLimits]> = [
      [lineStart(-1), lim(4)], [lineStart(1.5), lim(4)], [lineStart(Number.NaN), lim(4)],
      [{ kind: 'other' as never, before: 3 }, lim(4)],
      [lineStart(3), lim(READ_FROM_MAX_BYTES + 1)], [lineStart(3), lim(4, 5)], [lineStart(3), lim(4, 4, 51)],
      [lineStart(3), lim(0)], [lineStart(3), lim(4, 0)], [lineStart(3), lim(4, 4, 0)], [lineStart(3), lim(2.5)],
    ];
    for (const [cursor, limits] of bad) {
      const io = memIO(data);
      expect(await readOlderRange(io, 'f', cursor, limits)).toEqual({ ok: false, reason: 'invalid-boundary' });
      expect(io.reads).toHaveLength(0);
    }
  });

  it('offset zero in line-start mode answers start without a read', async () => {
    const io = memIO(enc.encode('aa\n'));
    expect(await readOlderRange(io, 'f', lineStart(0), lim(4))).toEqual({ ok: true, records: [], continuation: { kind: 'start' } });
    expect(io.reads).toHaveLength(0);
  });
});

describe('readOlderRange: bounded skip of an oversized record', () => {
  const FAKE = '{"type":"user","uuid":"fake-suffix","message":{"content":"looks whole"}}';

  it('an oversized record with a valid-looking JSON suffix yields one gap and both neighbours once', async () => {
    const big = '{"type":"assistant","pad":"' + 'p'.repeat(60) + '",' + FAKE;
    const data = enc.encode(`{"first":1}\n${big}\n{"last":2}\n`);
    for (const [chunk, chunks] of [[8, 2], [5, 3], [16, 1], [7, 4]] as const) {
      const { items } = await pageAll(data, lim(chunk, chunks, 50));
      const gaps = items.filter((i) => 'gap' in i);
      expect(gaps).toHaveLength(1);
      expect(records(items).map(text)).toEqual(['{"first":1}', '{"last":2}']);
      for (const r of records(items)) expect(text(r)).not.toContain('fake-suffix');
      expect(items[1]).toEqual(gaps[0]);   // the gap sits between the two neighbours
    }
  });

  it('a skip that reaches offset zero answers start with no older record', async () => {
    const data = enc.encode('x'.repeat(40) + FAKE + '\nlast\n');
    const { items } = await pageAll(data, lim(8, 2));
    expect(records(items).map(text)).toEqual(['last']);
    expect(items.filter((i) => 'gap' in i)).toHaveLength(1);
  });

  it('a delimiter immediately before the skip offset drops nothing and returns the records before it', async () => {
    const data = enc.encode('aa\nbb\ncc\n');
    const r = okRead(await readOlderRange(memIO(data), 'f', { kind: 'skip-record', before: 6 }, lim(64)));
    expect(r.records.map(text)).toEqual(['aa', 'bb']);
    expect(r.continuation).toEqual({ kind: 'start' });
  });

  it('a skip cursor mid-record drops only the partial record and resumes with whole records before it', async () => {
    const data = enc.encode('aa\nbb\n' + 'z'.repeat(9) + FAKE + '\n');
    const r = okRead(await readOlderRange(memIO(data), 'f', { kind: 'skip-record', before: data.length - 5 }, lim(64)));
    expect(r.records.map(text)).toEqual(['aa', 'bb']);
    expect(r.continuation).toEqual({ kind: 'start' });
  });

  it('a skip page that finds no delimiter carries a lower skip cursor and returns no record', async () => {
    const data = enc.encode('aa\n' + 'z'.repeat(40) + '\n');
    const r = okRead(await readOlderRange(memIO(data), 'f', { kind: 'skip-record', before: 40 }, lim(8, 2)));
    expect(r.records).toEqual([]);
    expect(r.continuation).toEqual({ kind: 'more', cursor: { kind: 'skip-record', before: 24 } });
  });

  it('a skip page whose scan reaches offset zero with no delimiter answers start itself, after reading byte zero', async () => {
    const data = enc.encode('z'.repeat(20) + FAKE + '\n');
    const io = memIO(data);
    const r = okRead(await readOlderRange(io, 'f', { kind: 'skip-record', before: 30 }, lim(8, 4)));
    expect(r).toEqual({ ok: true, records: [], continuation: { kind: 'start' } });
    expect(io.reads.at(-1)![0]).toBe(0);
  });

  it('a skip page that runs out of reads above offset zero never answers start', async () => {
    const data = enc.encode('z'.repeat(20) + FAKE + '\n');
    const r = okRead(await readOlderRange(memIO(data), 'f', { kind: 'skip-record', before: 30 }, lim(8, 3)));
    expect(r.continuation).toEqual({ kind: 'more', cursor: { kind: 'skip-record', before: 6 } });
  });

  it('skip mode at offset zero answers start without a read', async () => {
    const io = memIO(enc.encode('aa\n'));
    expect(await readOlderRange(io, 'f', { kind: 'skip-record', before: 0 }, lim(4)))
      .toEqual({ ok: true, records: [], continuation: { kind: 'start' } });
    expect(io.reads).toHaveLength(0);
  });

  it('a record exactly one window long (newline included) is reported as a gap, though every byte was read', async () => {
    // 'a\nbbb\n': the record 'bbb\n' is 4 bytes, the window two reads of 2. The page cannot prove byte 2 starts a line.
    const data = enc.encode('a\nbbb\n');
    const r = okRead(await readOlderRange(memIO(data), 'f', lineStart(6), lim(2, 2)));
    expect(r).toEqual({ ok: true, records: [], continuation: { kind: 'gap', cursor: { kind: 'skip-record', before: 2 } } });
    // One byte shorter than the window, the same record is framed.
    const fits = okRead(await readOlderRange(memIO(enc.encode('a\nbb\n')), 'f', lineStart(5), lim(2, 2)));
    expect(fits.records.map(text)).toEqual(['bb']);
  });

  it('a record that fits a fresh window after a skip used part of the budget is read next page, not skipped', async () => {
    // The skip's fragment uses most of the window; the older record (20 bytes) fits a fresh 24-byte window.
    const older = 'o'.repeat(19);
    const data = enc.encode(`${older}\n` + 'z'.repeat(60) + '\n');
    const r = okRead(await readOlderRange(memIO(data), 'f', { kind: 'skip-record', before: 30 }, lim(8, 3)));
    expect(r.records).toEqual([]);
    expect(r.continuation).toEqual({ kind: 'more', cursor: lineStart(20) });
    const next = okRead(await readOlderRange(memIO(data), 'f', lineStart(20), lim(8, 3)));
    expect(next.records.map(text)).toEqual([older]);
    expect(next.continuation).toEqual({ kind: 'start' });
  });
});
