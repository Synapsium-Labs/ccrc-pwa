// The backward walker (D-6434): the segments a walk from EOF yields, cut where a chunk starts mid-line.
import { describe, expect, it } from 'vitest';
import { localIO, type FleetIO } from '../src/io.js';
import { walkBack, wholeLines, type BackSegment } from '../src/backread.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

/** A FleetIO whose one file is `data`; `fail` names the offsets whose read does not answer. */
const memIO = (data: Uint8Array, fail: ReadonlySet<number> = new Set()): FleetIO & { reads: Array<[number, number]> } => {
  const reads: Array<[number, number]> = [];
  return {
    ...localIO,
    reads,
    readFileFromBytesMeasured: async (_p, offset, max) => {
      reads.push([offset, max]);
      if (fail.has(offset)) return { ok: false, reason: 'unreadable' };
      return { ok: true, bytes: data.slice(offset, offset + max), size: data.length } as never;
    },
  };
};

const drain = async (io: FleetIO, size: number, sizes: number[]): Promise<BackSegment[]> => {
  const walk = walkBack(io, 'f', size, sizes);
  const out: BackSegment[] = [];
  while (walk.more()) {
    const r = await walk.next();
    if (!r.ok) throw new Error(r.reason);
    out.push(r.segment);
  }
  return out;
};
const lines = (s: BackSegment): string[] => wholeLines(s).map((l) => dec.decode(l));

describe('walkBack', () => {
  it('a file inside one chunk is one segment from offset 0 whose first line is whole', async () => {
    const data = enc.encode('aa\nbb\ncc\n');
    const segs = await drain(memIO(data), data.length, [100]);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ cut: 0, start: 0 });
    expect(lines(segs[0]!)).toEqual(['aa', 'bb', 'cc']);
  });

  it('a line straddling a boundary is whole in the older segment, which carries the newer chunk\'s first piece', async () => {
    const data = enc.encode('aaaa\nbbbb\ncccc\ndddd\n'); // 20 bytes
    const segs = await drain(memIO(data), data.length, [8, 8, 8]);
    // newest: bytes 12..20 = "ccc\ndddd\n" is cut at 'c'... its leading piece is the cut one
    expect(segs.map((s) => s.start)).toEqual([12, 4, 0]);
    expect(lines(segs[0]!)).toEqual(['dddd']);
    expect(lines(segs[1]!)).toEqual(['bbbb', 'cccc']);
    expect(lines(segs[2]!)).toEqual(['aaaa']);
    expect(segs[2]!.cut).toBe(0);
  });

  it('a chunk with no newline is all cut and its bytes ride into the next segment', async () => {
    const data = enc.encode('x\n' + 'y'.repeat(30) + '\nz\n');
    const segs = await drain(memIO(data), data.length, [4, 10, 10, 10, 10]);
    const mid = segs.find((s) => s.cut === s.bytes.length);
    expect(mid).toBeDefined();
    // every line of the file is whole in exactly one segment
    const all = segs.flatMap(lines);
    expect(all.sort()).toEqual(['x', 'y'.repeat(30), 'z'].sort());
  });

  it('stops at offset 0, and at the end of the sizes', async () => {
    const data = enc.encode('a\nb\nc\nd\n');
    const w = walkBack(memIO(data), 'f', data.length, [4, 4, 4, 4]);
    let n = 0;
    while (w.more()) { await w.next(); n++; }
    expect(n).toBe(2);
    const short = walkBack(memIO(data), 'f', data.length, [2]);
    await short.next();
    expect(short.more()).toBe(false);
  });

  it('reads each chunk with max(1, end - start) bytes from max(0, end - size)', async () => {
    const data = enc.encode('a\nb\nc\nd\n');
    const io = memIO(data);
    await drain(io, data.length, [6, 6]);
    expect(io.reads).toEqual([[2, 6], [0, 2]]);
  });

  it('a failed read answers its reason', async () => {
    const data = enc.encode('a\nb\nc\nd\n');
    const w = walkBack(memIO(data, new Set([2])), 'f', data.length, [6, 6]);
    const r = await w.next();
    expect(r).toEqual({ ok: false, reason: 'unreadable' });
  });
});

describe('wholeLines', () => {
  it('splits the bytes after the cut on the newline byte, oldest first, without the empty tail', () => {
    const bytes = enc.encode('cut\nlive\nmore\n');
    expect(wholeLines({ bytes, cut: 4, start: 5 }).map((l) => dec.decode(l))).toEqual(['live', 'more']);
  });
  it('a segment with no newline after its cut has no lines', () => {
    const bytes = enc.encode('abc');
    expect(wholeLines({ bytes, cut: 3, start: 5 })).toEqual([]);
  });
});
