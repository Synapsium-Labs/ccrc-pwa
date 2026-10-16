// The collector switch's durable control state, its PURE half (path-identity spec 2026-10-12 §5.2, §5.4, §5.6, §5.9):
// the row measure, the strict generation-journal grammar, coherence by exact equality, the next generation and the
// write decision the store runs inside its transaction. L1, `server/src/collectLane.ts`. Every read arrives as an
// argument, shaped as the store and the journal adapter hand it over: the store reads with `setReadBigInts(true)`, so
// an INTEGER column is a bigint here. Nothing in this file opens a database or a journal.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COLLECT_LANE_JOURNAL_FAULTS, COLLECT_LANE_JOURNAL_KINDS, COLLECT_LANE_UNMEASURABLE_WHYS, COLLECT_LANE_WRITE_REFUSALS,
  COLLECT_LATCH_OUTCOME_KINDS, collectLaneControl, collectLaneNextGeneration, decideCollectLaneWrite,
  isCollectLaneKebab, measureCollectLaneRow, parseCollectLaneJournal, sameCollectLaneJournal, sameCollectLaneRow,
  type CollectLaneControl, type CollectLaneJournalRead, type CollectLaneRow, type CollectLaneRowField,
  type CollectLaneRowRaw, type CollectLaneRowRead, type CollectLaneUnmeasurable, type CollectLaneWriteDecision,
  type CollectLaneWriteRequest,
} from '../src/collectLane.js';
import { codeOnly } from './sourceScan.js';

const LANE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'collectLane.ts');

/** A value for a case's message. A bigint shows as `<n>n`: `JSON.stringify` throws on one. */
const show = (v: unknown): string =>
  JSON.stringify(v, (_k: string, x: unknown) => (typeof x === 'bigint' ? `${x}n` : x));
/** The seed exactly as the store reads it: every INTEGER a bigint. */
const SEED_RAW: CollectLaneRowRaw = { choice: 'off', fleetNodeId: null, markerRetiredAt: null, generation: 0n, updatedAt: 0n };
/** The row as the store reads it: the seed, with `o` laid over it. */
const raw = (o: Partial<CollectLaneRowRaw> = {}): CollectLaneRowRead => ({ kind: 'row', row: { ...SEED_RAW, ...o } });
/** A parseable journal: its last generation `max`, over `records` records. */
const ok = (max: number, records = 1): CollectLaneJournalRead => ({ kind: 'ok', max, records });
const MISSING: CollectLaneJournalRead = { kind: 'missing' };
/** Two fleet nodes. A stored node is any non-empty string; these take the node-id file's shape for readability. */
const NODE = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const NODE_B = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
/** The write instant (epoch ms), and a latch set before it. */
const AT = 1_790_000_000_000;
const LATCH = 1_789_000_000_000;
const LATCH_N = BigInt(LATCH);
/** Settings Live for NODE at generation `g`, written at 5, its latch unset unless `o` sets it. */
const liveRow = (g: number, o: Partial<CollectLaneRowRaw> = {}): CollectLaneRowRead =>
  raw({ choice: 'live', fleetNodeId: NODE, generation: BigInt(g), updatedAt: 5n, ...o });
const live = (expected: CollectLaneRowRead, expectedJournal: CollectLaneJournalRead,
  fleetNodeId: string = NODE): CollectLaneWriteRequest => ({ kind: 'live', fleetNodeId, expected, expectedJournal });
const retire = (expected: CollectLaneRowRead, expectedJournal: CollectLaneJournalRead): CollectLaneWriteRequest =>
  ({ kind: 'retire', expected, expectedJournal });
const OFF: CollectLaneWriteRequest = { kind: 'off' };
/** A row read beside a journal read, as every consumer derives the control state. */
const control = (row: CollectLaneRowRead, journal: CollectLaneJournalRead): CollectLaneControl =>
  collectLaneControl(measureCollectLaneRow(row), journal);
/** A decision's refusal code, or its kind. */
const verdictOf = (d: CollectLaneWriteDecision): string => (d.kind === 'refuse' ? d.code : d.kind);
/** The seed, measured. */
const SEED_ROW: CollectLaneRow = { choice: 'off', fleetNodeId: null, markerRetiredAt: null, generation: 0, updatedAt: 0 };
/** One field off the seed, each. None of them is the seed. */
const SEED_DEVIATIONS: readonly Partial<CollectLaneRowRaw>[] =
  [{ updatedAt: 1n }, { generation: 1n }, { fleetNodeId: 'n' }, { markerRetiredAt: 5n }, { choice: 'live' }];

describe('the journal grammar is strict (path-identity spec §5.2, §5.9)', () => {
  it('a final newline is allowed, and its absence too', () => {
    expect(parseCollectLaneJournal('{"generation":1}\n')).toEqual({ kind: 'ok', max: 1, records: 1 });
    expect(parseCollectLaneJournal('{"generation":1}')).toEqual({ kind: 'ok', max: 1, records: 1 });
    expect(parseCollectLaneJournal('{"generation":1}\n{"generation":2}\n{"generation":7}\n'))
      .toEqual({ kind: 'ok', max: 7, records: 3 });
  });

  it('empty, whitespace and blank records are malformed', () => {
    expect(parseCollectLaneJournal('')).toEqual({ kind: 'malformed', fault: 'empty', record: 1 });
    const rows: [string, number][] = [
      [' ', 1], ['\t', 1], ['\n', 1], ['\n\n', 1], ['{"generation":1}\n\n', 2],
      ['{"generation":1}\n\n{"generation":2}\n', 2], ['{"generation":1}\n \n{"generation":2}', 2],
    ];
    for (const [text, record] of rows) {
      expect(parseCollectLaneJournal(text), JSON.stringify(text)).toEqual({ kind: 'malformed', fault: 'blank', record });
    }
  });

  it('CR and surrounding whitespace are malformed', () => {
    const rows: [string, number][] = [
      ['{"generation":1}\r\n', 1], [' {"generation":1}', 1], ['{"generation":1} ', 1], ['\t{"generation":1}\n', 1],
      ['{"generation":1}\n{"generation":2}\r\n', 2], ['{"generation":1,\r"x":2}', 1], ['\ufeff{"generation":1}', 1],
    ];
    for (const [text, record] of rows) {
      expect(parseCollectLaneJournal(text), JSON.stringify(text)).toEqual({ kind: 'malformed', fault: 'blank', record });
    }
  });

  it('truncation and non-objects are malformed', () => {
    const rows: [string, 'json' | 'shape', number][] = [
      ['{"generation":', 'json', 1], ['{"generation":1', 'json', 1], ['{"generation":1}\n{"gen', 'json', 2],
      ['[1]', 'shape', 1], ['null', 'shape', 1], ['"x"', 'shape', 1], ['7', 'shape', 1], ['[{"generation":1}]', 'shape', 1],
    ];
    for (const [text, fault, record] of rows) {
      expect(parseCollectLaneJournal(text), JSON.stringify(text)).toEqual({ kind: 'malformed', fault, record });
    }
  });

  it('every generation not a positive safe integer is malformed', () => {
    const rows = ['{"generation":0}', '{"generation":-1}', '{"generation":1.5}', '{"generation":"1"}',
      '{"generation":9007199254740993}', '{"generation":1e400}', '{"generation":null}', '{"generation":true}', '{}',
      '{"Generation":1}', '{"__proto__":{"generation":1}}'];
    for (const text of rows) {
      expect(parseCollectLaneJournal(text), text).toEqual({ kind: 'malformed', fault: 'generation', record: 1 });
    }
    expect(parseCollectLaneJournal('{"generation":3}\n{"generation":0}\n'))
      .toEqual({ kind: 'malformed', fault: 'generation', record: 2 });
  });

  it('duplicate and non-increasing generations are malformed', () => {
    expect(parseCollectLaneJournal('{"generation":1}\n{"generation":1}\n'))
      .toEqual({ kind: 'malformed', fault: 'order', record: 2 });
    expect(parseCollectLaneJournal('{"generation":2}\n{"generation":1}\n'))
      .toEqual({ kind: 'malformed', fault: 'order', record: 2 });
    expect(parseCollectLaneJournal('{"generation":1}\n{"generation":3}\n{"generation":2}\n'))
      .toEqual({ kind: 'malformed', fault: 'order', record: 3 });
    expect(parseCollectLaneJournal('{"generation":1}\n{"generation":4}\n'), 'a gap is a repair above both maxima')
      .toEqual({ kind: 'ok', max: 4, records: 2 });
  });

  it('extra properties are ignored', () => {
    expect(parseCollectLaneJournal('{"generation":2,"x":1}\n')).toEqual({ kind: 'ok', max: 2, records: 1 });
    expect(parseCollectLaneJournal('{"x":{"y":[1]},"generation":3}')).toEqual({ kind: 'ok', max: 3, records: 1 });
  });

  it('it is total: hostile text answers malformed and never throws', () => {
    const rows = ['\u0000', '{"generation":1}\u2028', '}{', '{"generation":1}{"generation":2}\n', 'x'.repeat(4096)];
    for (const text of rows) expect(parseCollectLaneJournal(text).kind, JSON.stringify(text.slice(0, 40))).toBe('malformed');
  });
});

describe('the row is measured exactly (§5.2)', () => {
  it('the exact seed, read as bigints, is the seed', () => {
    expect(measureCollectLaneRow(raw())).toEqual({ kind: 'seed', row: SEED_ROW });
    expect(measureCollectLaneRow(raw({ generation: 0, updatedAt: 0 })), 'the same values as numbers')
      .toEqual({ kind: 'seed', row: SEED_ROW });
  });

  it('each single-field deviation is a row, not the seed', () => {
    const rows: [Partial<CollectLaneRowRaw>, Partial<CollectLaneRow>][] = [
      [{ updatedAt: 1n }, { updatedAt: 1 }], [{ generation: 1n }, { generation: 1 }],
      [{ fleetNodeId: 'n' }, { fleetNodeId: 'n' }], [{ markerRetiredAt: 5n }, { markerRetiredAt: 5 }],
      [{ choice: 'live' }, { choice: 'live' }],
    ];
    for (const [o, want] of rows) {
      expect(measureCollectLaneRow(raw(o)), show(o)).toEqual({ kind: 'row', row: { ...SEED_ROW, ...want } });
    }
  });

  it('malformed fields are named', () => {
    const rows: [Partial<CollectLaneRowRaw>, CollectLaneRowField][] = [
      [{ generation: '0' }, 'generation'], [{ generation: -1n }, 'generation'],
      [{ generation: 9223372036854775807n }, 'generation'], [{ generation: 1.5 }, 'generation'],
      [{ generation: null }, 'generation'],
      [{ choice: 1 }, 'choice'], [{ choice: null }, 'choice'], [{ choice: 1n }, 'choice'],
      [{ fleetNodeId: '' }, 'fleetNodeId'], [{ fleetNodeId: 7n }, 'fleetNodeId'],
      [{ markerRetiredAt: 0n }, 'markerRetiredAt'], [{ markerRetiredAt: -5n }, 'markerRetiredAt'],
      [{ markerRetiredAt: '5' }, 'markerRetiredAt'], [{ markerRetiredAt: 9223372036854775807n }, 'markerRetiredAt'],
      [{ updatedAt: -1n }, 'updatedAt'], [{ updatedAt: 9223372036854775807n }, 'updatedAt'], [{ updatedAt: null }, 'updatedAt'],
    ];
    for (const [o, field] of rows) expect(measureCollectLaneRow(raw(o)), show(o)).toEqual({ kind: 'malformed', field });
  });

  it('a future choice token is readable', () => {
    for (const choice of ['LIVE', 'toString', 'shadowed', '', ' live']) {
      expect(measureCollectLaneRow(raw({ choice })), JSON.stringify(choice)).toEqual({ kind: 'row', row: { ...SEED_ROW, choice } });
    }
  });

  it('absent and unreadable pass through, never folded', () => {
    expect(measureCollectLaneRow({ kind: 'absent' })).toEqual({ kind: 'absent' });
    expect(measureCollectLaneRow({ kind: 'unreadable', detail: 'no such table: collect_lane_settings' }))
      .toEqual({ kind: 'unreadable', detail: 'no such table: collect_lane_settings' });
  });
});

describe('coherence is exact equality; the seed with no journal is the one bootstrap (§5.2)', () => {
  it('seed and missing is coherent at 0, bootstrap', () => {
    expect(control(raw(), MISSING)).toEqual({ kind: 'coherent', row: SEED_ROW, generation: 0, bootstrap: true });
  });

  it('a non-seed row with a missing journal is journal-missing', () => {
    for (const o of [...SEED_DEVIATIONS, { choice: 'LIVE' }]) {
      expect(control(raw(o), MISSING), show(o)).toEqual({ kind: 'unmeasurable', why: 'journal-missing' });
    }
  });

  it('{journal:4,row:5} and {journal:5,row:4} are mismatches', () => {
    expect(control(liveRow(5), ok(4)), 'the named regression: row == max(journal, row) would call this coherent')
      .toMatchObject({ kind: 'mismatch', journalMax: 4, rowGeneration: 5 });
    expect(control(liveRow(4), ok(5))).toMatchObject({ kind: 'mismatch', journalMax: 5, rowGeneration: 4 });
    expect(control(raw(), ok(1)), 'the seed beside a used journal: a database restored to its seed')
      .toMatchObject({ kind: 'mismatch', journalMax: 1, rowGeneration: 0 });
  });

  it('equal is coherent', () => {
    expect(control(liveRow(5), ok(5, 5))).toEqual({
      kind: 'coherent', generation: 5, bootstrap: false,
      row: { choice: 'live', fleetNodeId: NODE, markerRetiredAt: null, generation: 5, updatedAt: 5 },
    });
  });

  it('each journal arm maps to its own why', () => {
    const rows: [CollectLaneJournalRead, CollectLaneUnmeasurable][] = [
      [{ kind: 'malformed', fault: 'json', record: 2 }, 'journal-malformed'],
      [{ kind: 'unreadable', code: 'EACCES' }, 'journal-unreadable'],
      [{ kind: 'not-regular', fileKind: 'symlink' }, 'journal-not-regular'],
      [{ kind: 'not-configured' }, 'journal-not-configured'],
    ];
    for (const [journal, why] of rows) {
      expect(control(raw(), journal), `${journal.kind} beside the seed`).toEqual({ kind: 'unmeasurable', why });
      expect(control(liveRow(3), journal), `${journal.kind} beside a used row`).toEqual({ kind: 'unmeasurable', why });
    }
  });

  it('an ok journal beside an absent row is row-absent', () => {
    expect(control({ kind: 'absent' }, ok(3))).toEqual({ kind: 'unmeasurable', why: 'row-absent' });
    expect(control({ kind: 'absent' }, MISSING), 'never the bootstrap').toEqual({ kind: 'unmeasurable', why: 'row-absent' });
    expect(control({ kind: 'unreadable', detail: 'x' }, ok(3))).toEqual({ kind: 'unmeasurable', why: 'row-unreadable' });
    expect(control(raw({ generation: '3' }), ok(3))).toEqual({ kind: 'unmeasurable', why: 'row-malformed' });
  });

  it('the next generation is max plus one, null past the safe range', () => {
    const next = (c: CollectLaneControl): number | null => {
      if (c.kind === 'unmeasurable') throw new Error(`expected a measured control state, got ${c.why}`);
      return collectLaneNextGeneration(c);
    };
    const MAX = Number.MAX_SAFE_INTEGER;
    expect(next(control(raw(), MISSING)), 'the bootstrap').toBe(1);
    expect(next(control(liveRow(3), ok(3)))).toBe(4);
    expect(next(control(liveRow(5), ok(4))), 'above the row').toBe(6);
    expect(next(control(liveRow(3), ok(7))), 'above the journal').toBe(8);
    expect(next(control(liveRow(MAX - 1), ok(MAX - 1)))).toBe(MAX);
    expect(next(control(liveRow(MAX), ok(MAX)))).toBeNull();
    expect(next(control(liveRow(3), ok(MAX)))).toBeNull();
  });
});

describe('the two reads compare as read, before any measure (path-identity spec §5.6)', () => {
  it('rows compare every raw value, a bigint meeting a bigint, and other reads by kind', () => {
    expect(sameCollectLaneRow(liveRow(3), liveRow(3))).toBe(true);
    const variants: Partial<CollectLaneRowRaw>[] =
      [{ choice: 'off' }, { fleetNodeId: NODE_B }, { markerRetiredAt: 1n }, { generation: 4n }, { updatedAt: 6n }];
    for (const v of variants) expect(sameCollectLaneRow(liveRow(3), liveRow(3, v)), show(v)).toBe(false);
    expect(sameCollectLaneRow(liveRow(3), liveRow(3, { generation: 3 })), 'a number never meets a bigint').toBe(false);
    expect(sameCollectLaneRow({ kind: 'absent' }, { kind: 'absent' })).toBe(true);
    expect(sameCollectLaneRow({ kind: 'unreadable', detail: 'a' }, { kind: 'unreadable', detail: 'b' }), 'by kind').toBe(true);
    expect(sameCollectLaneRow({ kind: 'absent' }, { kind: 'unreadable', detail: 'a' })).toBe(false);
    expect(sameCollectLaneRow({ kind: 'absent' }, raw())).toBe(false);
  });

  it('journals compare by kind and every field of their arm', () => {
    const reads: CollectLaneJournalRead[] = [
      MISSING, ok(3, 3), ok(3, 2), ok(4, 3),
      { kind: 'malformed', fault: 'json', record: 1 }, { kind: 'malformed', fault: 'json', record: 2 },
      { kind: 'malformed', fault: 'blank', record: 1 },
      { kind: 'unreadable', code: 'EACCES' }, { kind: 'unreadable', code: 'EFBIG' },
      { kind: 'not-regular', fileKind: 'symlink' }, { kind: 'not-regular', fileKind: 'directory' },
      { kind: 'not-configured' },
    ];
    reads.forEach((a, i) => reads.forEach((b, j) => {
      expect(sameCollectLaneJournal(a, b), `${show(a)} vs ${show(b)}`).toBe(i === j);
    }));
    expect(sameCollectLaneJournal({ kind: 'ok', max: 3, records: 3 }, ok(3, 3)), 'a structural copy').toBe(true);
  });
});

describe('the write decision (§5.2, §5.4, §5.6)', () => {
  const decide = (req: CollectLaneWriteRequest, before: CollectLaneRowRead, journal: CollectLaneJournalRead,
    at: number = AT): CollectLaneWriteDecision => decideCollectLaneWrite(req, before, journal, at);
  /** The latch, set. */
  const L: Partial<CollectLaneRowRaw> = { markerRetiredAt: LATCH_N };

  describe('live', () => {
    it('conflicts on a raw row change', () => {
      const naming = expect.stringMatching(/\brow\b/);
      expect(decide(live(liveRow(3), ok(3)), liveRow(3, { updatedAt: 6n }), ok(3)), 'one raw value moved')
        .toMatchObject({ kind: 'refuse', code: 'conflict', detail: naming });
      expect(decide(live(raw(), MISSING), liveRow(1), MISSING), 'the seed the route read is gone')
        .toMatchObject({ kind: 'refuse', code: 'conflict', detail: naming });
      expect(decide(live(liveRow(3, { generation: 3 }), ok(3)), liveRow(3), ok(3)), 'compared as read, never parsed')
        .toMatchObject({ kind: 'refuse', code: 'conflict', detail: naming });
    });

    it('conflicts on a journal change', () => {
      const naming = expect.stringMatching(/\bjournal\b/);
      expect(decide(live(liveRow(3), ok(3)), liveRow(3), ok(4, 2)))
        .toMatchObject({ kind: 'refuse', code: 'conflict', detail: naming });
      expect(decide(live(raw(), MISSING), raw(), ok(1)), 'a journal appeared beside the seed')
        .toMatchObject({ kind: 'refuse', code: 'conflict', detail: naming });
      expect(decide(live(liveRow(3), ok(3, 3)), liveRow(3), ok(3, 2)), 'the same maximum over other records')
        .toMatchObject({ kind: 'refuse', code: 'conflict', detail: naming });
    });

    it('is unchanged when coherent and exactly live for that node', () => {
      expect(decide(live(liveRow(3), ok(3)), liveRow(3), ok(3))).toEqual({ kind: 'unchanged' });
      expect(decide(live(liveRow(3, L), ok(3)), liveRow(3, L), ok(3)), 'latch set').toEqual({ kind: 'unchanged' });
    });

    it('otherwise writes live for the node at the next generation, the latch kept', () => {
      expect(decide(live(raw(), MISSING), raw(), MISSING), 'the bootstrap seed')
        .toEqual({ kind: 'write', generation: 1, next: { choice: 'live', fleetNodeId: NODE, markerRetiredAt: null } });
      const offRow = raw({ markerRetiredAt: LATCH_N, generation: 2n, updatedAt: 9n });
      expect(decide(live(offRow, ok(2)), offRow, ok(2)), 'over a latched off')
        .toEqual({ kind: 'write', generation: 3, next: { choice: 'live', fleetNodeId: NODE, markerRetiredAt: LATCH } });
      expect(decide(live(liveRow(3), ok(3), NODE_B), liveRow(3), ok(3)), 'for another node')
        .toEqual({ kind: 'write', generation: 4, next: { choice: 'live', fleetNodeId: NODE_B, markerRetiredAt: null } });
    });

    it('repairs a mismatch at max+1', () => {
      expect(decide(live(liveRow(5), ok(4)), liveRow(5), ok(4)), 'a journal behind, the row already live for the node')
        .toEqual({ kind: 'write', generation: 6, next: { choice: 'live', fleetNodeId: NODE, markerRetiredAt: null } });
      expect(decide(live(liveRow(3), ok(7)), liveRow(3), ok(7)), 'a journal ahead')
        .toEqual({ kind: 'write', generation: 8, next: { choice: 'live', fleetNodeId: NODE, markerRetiredAt: null } });
      expect(decide(live(liveRow(5, L), ok(4)), liveRow(5, L), ok(4)), 'the latch kept')
        .toEqual({ kind: 'write', generation: 6, next: { choice: 'live', fleetNodeId: NODE, markerRetiredAt: LATCH } });
    });

    it('refuses state-unmeasurable when control is unmeasurable', () => {
      const cases: [CollectLaneRowRead, CollectLaneJournalRead][] = [
        [liveRow(3), { kind: 'malformed', fault: 'blank', record: 1 }],
        [liveRow(3), { kind: 'unreadable', code: 'EACCES' }],
        [liveRow(3), { kind: 'not-regular', fileKind: 'directory' }],
        [raw(), { kind: 'not-configured' }],
        [liveRow(3), MISSING],
        [{ kind: 'absent' }, ok(3)],
        [{ kind: 'unreadable', detail: 'disk I/O error' }, ok(3)],
        [raw({ generation: -1n }), ok(3)],
      ];
      for (const [row, journal] of cases) {
        expect(decide(live(row, journal), row, journal), `${show(row)} beside ${show(journal)}`)
          .toMatchObject({ kind: 'refuse', code: 'state-unmeasurable' });
      }
    });

    it('refuses an empty node: no row the reader calls malformed is ever written', () => {
      expect(decide(live(raw(), MISSING, ''), raw(), MISSING)).toMatchObject({ kind: 'refuse', code: 'state-unmeasurable' });
    });
  });

  describe('off', () => {
    it('refuses marker-still-controls while the latch is null, coherent or mismatched', () => {
      const refused = { kind: 'refuse', code: 'marker-still-controls' };
      expect(decide(OFF, raw(), MISSING), 'the seed').toMatchObject(refused);
      expect(decide(OFF, liveRow(3), ok(3)), 'coherent Live').toMatchObject(refused);
      expect(decide(OFF, liveRow(5), ok(4)), 'a journal behind').toMatchObject(refused);
      expect(decide(OFF, liveRow(3), ok(7)), 'a journal ahead').toMatchObject(refused);
    });

    it('is unchanged on a coherent off with a null node', () => {
      const offRow = raw({ markerRetiredAt: LATCH_N, generation: 2n, updatedAt: 9n });
      expect(decide(OFF, offRow, ok(2))).toEqual({ kind: 'unchanged' });
    });

    it('otherwise writes off, no node and the latch kept, at max+1', () => {
      const next = { choice: 'off', fleetNodeId: null, markerRetiredAt: LATCH };
      expect(decide(OFF, liveRow(3, L), ok(3)), 'coherent Live').toEqual({ kind: 'write', generation: 4, next });
      expect(decide(OFF, liveRow(5, L), ok(4)), 'a journal behind, repaired').toEqual({ kind: 'write', generation: 6, next });
      expect(decide(OFF, liveRow(3, L), ok(7)), 'a journal ahead, repaired').toEqual({ kind: 'write', generation: 8, next });
      expect(decide(OFF, raw({ markerRetiredAt: LATCH_N, generation: 2n, fleetNodeId: NODE }), ok(2)), 'off with a node')
        .toEqual({ kind: 'write', generation: 3, next });
      expect(decide(OFF, raw({ choice: 'LIVE', markerRetiredAt: LATCH_N, generation: 2n }), ok(2)), 'a future token')
        .toEqual({ kind: 'write', generation: 3, next });
      expect(decide(OFF, raw({ markerRetiredAt: LATCH_N, generation: 2n }), ok(3)), 'an off row behind its journal')
        .toEqual({ kind: 'write', generation: 4, next });
    });

    it('takes no expected compare, so it wins over a stale live', () => {
      // The route read Live for NODE at generation 3; a Live for NODE_B landed at 4 before this transaction.
      const routeRead = liveRow(3, L);
      const now = liveRow(4, { fleetNodeId: NODE_B, markerRetiredAt: LATCH_N });
      expect(decide(live(routeRead, ok(3)), now, ok(4)), 'a Live on that stale read conflicts')
        .toMatchObject({ kind: 'refuse', code: 'conflict' });
      expect(decide(OFF, now, ok(4)), 'Off writes over it')
        .toEqual({ kind: 'write', generation: 5, next: { choice: 'off', fleetNodeId: null, markerRetiredAt: LATCH } });
      expect(Object.keys(OFF), 'Off carries no expectation').toEqual(['kind']);
    });
  });

  describe('retire', () => {
    it('conflicts on a changed expectation', () => {
      expect(decide(retire(raw(), MISSING), raw({ choice: 'live', fleetNodeId: NODE, generation: 1n, updatedAt: 5n }), ok(1)),
        'the row').toMatchObject({ kind: 'refuse', code: 'conflict' });
      expect(decide(retire(liveRow(3), ok(3)), liveRow(3), ok(4, 2)), 'the journal')
        .toMatchObject({ kind: 'refuse', code: 'conflict' });
    });

    it('refuses not-coherent on either direction of mismatch', () => {
      const refused = { kind: 'refuse', code: 'not-coherent' };
      expect(decide(retire(liveRow(5), ok(4)), liveRow(5), ok(4)), 'a journal behind').toMatchObject(refused);
      expect(decide(retire(liveRow(4), ok(5)), liveRow(4), ok(5)), 'a journal ahead').toMatchObject(refused);
      expect(decide(retire(raw(), ok(1)), raw(), ok(1)), 'a seed beside a used journal').toMatchObject(refused);
    });

    it('is unchanged when the latch is already set', () => {
      const row = liveRow(3, L);
      expect(decide(retire(row, ok(3)), row, ok(3))).toEqual({ kind: 'unchanged' });
    });

    it('otherwise writes the latch at at, keeping the choice and node, a future token included', () => {
      expect(decide(retire(raw(), MISSING), raw(), MISSING), 'the bootstrap seed')
        .toEqual({ kind: 'write', generation: 1, next: { choice: 'off', fleetNodeId: null, markerRetiredAt: AT } });
      expect(decide(retire(liveRow(3), ok(3)), liveRow(3), ok(3)))
        .toEqual({ kind: 'write', generation: 4, next: { choice: 'live', fleetNodeId: NODE, markerRetiredAt: AT } });
      const future = raw({ choice: 'LIVE', fleetNodeId: NODE, generation: 2n, updatedAt: 7n });
      expect(decide(retire(future, ok(2)), future, ok(2)))
        .toEqual({ kind: 'write', generation: 3, next: { choice: 'LIVE', fleetNodeId: NODE, markerRetiredAt: AT } });
    });

    it('refuses state-unmeasurable on an unmeasurable state, and writes nothing there', () => {
      const bad: CollectLaneJournalRead = { kind: 'malformed', fault: 'order', record: 2 };
      expect(decide(retire(liveRow(3), bad), liveRow(3), bad)).toMatchObject({ kind: 'refuse', code: 'state-unmeasurable' });
      expect(decide(retire({ kind: 'absent' }, MISSING), { kind: 'absent' }, MISSING))
        .toMatchObject({ kind: 'refuse', code: 'state-unmeasurable' });
    });
  });

  it('at below 1 refuses state-unmeasurable', () => {
    // No latch, and no updatedAt, the reader would call malformed is ever written.
    const latched = liveRow(3, L);
    for (const at of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(verdictOf(decide(retire(raw(), MISSING), raw(), MISSING, at)), `retire at ${at}`).toBe('state-unmeasurable');
      expect(verdictOf(decide(live(raw(), MISSING), raw(), MISSING, at)), `live at ${at}`).toBe('state-unmeasurable');
      expect(verdictOf(decide(OFF, latched, ok(3), at)), `off at ${at}`).toBe('state-unmeasurable');
    }
    expect(verdictOf(decide(retire(raw(), MISSING), raw(), MISSING, 1)), 'the floor itself writes').toBe('write');
  });

  it('no arm writes markerRetiredAt null over a set value', () => {
    const bases: Partial<CollectLaneRowRaw>[] = [
      {}, { choice: 'live', fleetNodeId: NODE, generation: 3n, updatedAt: 5n },
      { choice: 'live', fleetNodeId: NODE, generation: 5n, updatedAt: 5n }, { choice: 'LIVE', generation: 3n },
      { fleetNodeId: NODE, generation: 3n },
    ];
    const journals: CollectLaneJournalRead[] = [MISSING, ok(3), ok(4), ok(5), ok(7)];
    let overASetLatch = 0;
    for (const base of bases) {
      for (const latch of [null, LATCH_N, 1n]) {
        const before = raw({ ...base, markerRetiredAt: latch });
        for (const journal of journals) {
          for (const req of [OFF, live(before, journal), live(before, journal, NODE_B), retire(before, journal)]) {
            const d = decide(req, before, journal);
            if (d.kind !== 'write') continue;
            const why = `${req.kind} over ${show(latch)} beside ${show(journal)}`;
            if (latch === null) {
              expect(d.next.markerRetiredAt, why).toBe(req.kind === 'retire' ? AT : null);
            } else {
              overASetLatch += 1;
              expect(d.next.markerRetiredAt, why).toBe(Number(latch));
            }
          }
        }
      }
    }
    expect(overASetLatch, 'the loop reaches writes over a set latch (116 when drafted)').toBeGreaterThanOrEqual(100);
  });

  it('isCollectLaneKebab admits every word the tables declare, and nothing else', () => {
    // The words as test DATA, bound to the derived lists first: a guard read from the lists alone would admit nothing,
    // and stay green, on a tree where a table lost its keys.
    const JOURNAL_KINDS = ['missing', 'ok', 'malformed', 'unreadable', 'not-regular', 'not-configured'];
    const FAULTS = ['empty', 'blank', 'json', 'shape', 'generation', 'order'];
    const WHYS = ['row-absent', 'row-unreadable', 'row-malformed', 'journal-missing', 'journal-malformed',
      'journal-unreadable', 'journal-not-regular', 'journal-not-configured'];
    const REFUSALS = ['conflict', 'marker-still-controls', 'state-unmeasurable', 'not-coherent'];
    const LATCH_KINDS = ['not-due', 'retired', 'refused', 'failed', 'store-threw'];
    expect([...COLLECT_LANE_JOURNAL_KINDS].sort()).toEqual([...JOURNAL_KINDS].sort());
    expect([...COLLECT_LANE_JOURNAL_FAULTS].sort()).toEqual([...FAULTS].sort());
    expect([...COLLECT_LANE_UNMEASURABLE_WHYS].sort()).toEqual([...WHYS].sort());
    expect([...COLLECT_LANE_WRITE_REFUSALS].sort()).toEqual([...REFUSALS].sort());
    expect([...COLLECT_LATCH_OUTCOME_KINDS].sort()).toEqual([...LATCH_KINDS].sort());
    for (const w of [...LATCH_KINDS, ...JOURNAL_KINDS, ...FAULTS, ...WHYS, ...REFUSALS]) {
      expect(isCollectLaneKebab(w), w).toBe(true);
    }
    for (const w of ['', 'toString', 'constructor', '__proto__', 'hasOwnProperty', 'confirm-stale', 'confirm-required',
      'not-asked', 'run-open', 'Not-due', 'not-due ', 'not_due', 'journal']) {
      expect(isCollectLaneKebab(w), JSON.stringify(w)).toBe(false);
    }
  });

  it('every list is derived from its table, never a hand list', () => {
    const derived = (list: string, table: string): RegExp =>
      new RegExp(`export const ${list}: [^=]+=\\s*Object\\.keys\\(${table}\\) as `);
    expect(derived('X', 'X_TABLE').test('export const X: readonly string[] =\n  Object.keys(X_TABLE) as string[];'), 'CONTROL')
      .toBe(true);
    expect(derived('X', 'X_TABLE').test("export const X: readonly string[] = ['a', 'b'];"), 'CONTROL: a hand list')
      .toBe(false);
    const code = codeOnly(readFileSync(LANE, 'utf8'));
    const PAIRS: [string, string][] = [
      ['COLLECT_LANE_JOURNAL_KINDS', 'COLLECT_LANE_JOURNAL_KIND_TABLE'],
      ['COLLECT_LANE_JOURNAL_FAULTS', 'COLLECT_LANE_JOURNAL_FAULT_TABLE'],
      ['COLLECT_LANE_UNMEASURABLE_WHYS', 'COLLECT_LANE_UNMEASURABLE_TABLE'],
      ['COLLECT_LANE_WRITE_REFUSALS', 'COLLECT_LANE_WRITE_REFUSAL_TABLE'],
      ['COLLECT_LATCH_OUTCOME_KINDS', 'COLLECT_LATCH_OUTCOME_KIND_TABLE'],
    ];
    for (const [list, table] of PAIRS) expect(code, list).toMatch(derived(list, table));
  });
});
