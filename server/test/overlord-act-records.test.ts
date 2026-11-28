// Overlord W2, act journal plan Task A1: the act journal's grammar, its canonical form and its fold. The mutant sets run the same
// case tables (`sim/overlordActJournalSets.ts`); this file adds the kernel round trip, the no-words proof and the canonical form.
import { describe, expect, it } from 'vitest';
import { buildChainedRecord, decodeChainedLine, encodeChainedRecord } from '../src/chainedJournal.js';
import * as grammar from '../src/coord/overlordActRecords.js';
import {
  OVERLORD_ACTS_BASENAME, OVERLORD_ACTS_FORMAT, OVERLORD_ACTS_TORN_DIR, OverlordActRecordError, actRecordEntry, canonicalActRecord,
  isOverlordActsKebab, type OverlordActRecord,
} from '../src/coord/overlordActRecords.js';
import {
  INTENT, OPEN, SETTLE, actJournalFoldCases, actJournalHighestCases, actRecordEntryCases,
} from './sim/overlordActJournalSets.js';

type R = OverlordActRecord;
const AT = '2026-11-28T10:00:00.000Z';
const bytes = (entry: R): string =>
  new TextDecoder().decode(encodeChainedRecord(OVERLORD_ACTS_FORMAT, buildChainedRecord(OVERLORD_ACTS_FORMAT, { sequence: 1, acceptedAt: AT, previousDigest: null, entry })));

describe('the grammar', () => {
  for (const [name, run] of Object.entries(actRecordEntryCases(grammar))) it(name, run);

  it('names the file and its quarantine directory beside the authority journal\'s, one path component each', () => {
    expect([OVERLORD_ACTS_BASENAME, OVERLORD_ACTS_TORN_DIR]).toEqual(['overlord-acts.jsonl', 'overlord-acts-torn']);
    expect(OVERLORD_ACTS_FORMAT.kinds).toEqual(['act-intent', 'act-settle', 'act-open-request']);
  });

  it('a sample of each kind round-trips through the kernel, byte for byte', () => {
    for (const entry of [INTENT, SETTLE, OPEN] as R[]) {
      const line = encodeChainedRecord(OVERLORD_ACTS_FORMAT, buildChainedRecord(OVERLORD_ACTS_FORMAT, { sequence: 1, acceptedAt: AT, previousDigest: null, entry }));
      const back = decodeChainedLine(OVERLORD_ACTS_FORMAT, line.subarray(0, line.length - 1));
      expect(back.entry, entry.kind).toEqual(entry);
      expect(encodeChainedRecord(OVERLORD_ACTS_FORMAT, back)).toEqual(line);
    }
  });

  it('a line whose entry the grammar refuses does not decode, as this journal\'s own class', () => {
    const line = new TextEncoder().encode(bytes(OPEN as R).replace('"requestId":9', '"requestId":-9'));
    expect(() => decodeChainedLine(OVERLORD_ACTS_FORMAT, line.subarray(0, line.length - 1))).toThrow(OverlordActRecordError);
  });
});

describe('no field carries text, and no refusal echoes one (point 2)', () => {
  const MARKER = 'Planted Marker 7e1f: the operator said';
  /** Every path to a string value inside a sample, so each can be swapped for the marker. */
  function stringPaths(v: unknown, at: (string | number)[] = []): (string | number)[][] {
    if (typeof v === 'string') return [at];
    if (Array.isArray(v)) return v.flatMap((x, i) => stringPaths(x, [...at, i]));
    if (typeof v === 'object' && v !== null) return Object.entries(v).flatMap(([k, x]) => stringPaths(x, [...at, k]));
    return [];
  }
  const swapped = (sample: unknown, at: (string | number)[], value: unknown): unknown => {
    const copy = structuredClone(sample) as Record<string | number, unknown>;
    let o = copy;
    for (const k of at.slice(0, -1)) o = o[k] as Record<string | number, unknown>;
    o[at.at(-1)!] = value;
    return copy;
  };
  const thrown = (raw: unknown): Error | null => { try { actRecordEntry(raw); return null; } catch (e) { return e as Error; } };

  for (const sample of [INTENT, SETTLE, OPEN]) {
    it(`every string field of ${sample.kind}, the kind included, refuses the marker, and the refusal never holds it`, () => {
      const paths = stringPaths(sample);
      expect(paths.length).toBeGreaterThan(sample.kind === 'act-open-request' ? 1 : 10);
      for (const at of paths) {
        const err = thrown(swapped(sample, at, MARKER));
        expect(err, at.join('.')).toBeInstanceOf(OverlordActRecordError);
        expect(err!.message, at.join('.')).not.toContain('Marker');
      }
    });
    it(`every null and number field of ${sample.kind} refuses the marker too`, () => {
      const scalar = Object.entries(sample).filter(([, v]) => v === null || typeof v === 'number').map(([k]) => k);
      expect(scalar.length).toBeGreaterThan(0);
      for (const k of scalar) expect(thrown({ ...sample, [k]: MARKER }), k).toBeInstanceOf(OverlordActRecordError);
    });
  }

  it('a marker as an unknown key is refused unknown-key, and its message does not hold it', () => {
    const err = thrown({ ...INTENT, [MARKER]: 1 });
    expect((err as OverlordActRecordError).code).toBe('unknown-key');
    expect(err!.message).not.toContain('Marker');
    // a kebab key is still named, so a reader learns which key it was
    expect(thrown({ ...INTENT, summary: 'x' })!.message).toContain('"summary"');
  });

  it('the one exception: an operator subject is the row\'s text, held in the record\'s actor field and nowhere else in its bytes (call 2007)', () => {
    const entry = { ...INTENT, actor: { kind: 'operator', subject: `device:${MARKER}` } } as R;
    expect(thrown(entry)).toBeNull();
    const line = bytes(canonicalActRecord(entry));
    expect(line.split('Marker').length - 1).toBe(1);
    const parsed = JSON.parse(line) as { entry: { actor: { subject: string } } };
    expect(parsed.entry.actor.subject).toContain('Marker');
    // the same text in any other field is refused, and the refusal does not echo it
    const err = thrown({ ...entry, authority: `device:${MARKER}` });
    expect(err).toBeInstanceOf(OverlordActRecordError);
    expect(err!.message).not.toContain('Marker');
  });

  it('a session subject that is not a session id, and a server subject out of the lane form, are refused without echoing them', () => {
    for (const actor of [{ kind: 'session', subject: MARKER }, { kind: 'server', subject: `ccrc server: ${MARKER}` }, { kind: 'operator', subject: `${MARKER}\n` }]) {
      const err = thrown({ ...INTENT, actor });
      expect(err, actor.kind).toBeInstanceOf(OverlordActRecordError);
      expect(err!.message).not.toContain('Marker');
    }
  });
});

describe('the canonical form the writer appends', () => {
  it('sorts targets, so two orders give one byte string', () => {
    const a = canonicalActRecord(INTENT as R);
    const b = canonicalActRecord({ ...INTENT, targets: [...INTENT.targets].reverse() } as R);
    expect(bytes(b)).toBe(bytes(a));
    expect(actRecordEntry(a)).toEqual(a);
  });

  it('puts the keys in one order, so a record built in another key order is the same bytes', () => {
    const shuffled = Object.fromEntries(Object.entries(SETTLE).reverse()) as unknown as R;
    expect(bytes(canonicalActRecord(shuffled))).toBe(bytes(canonicalActRecord(SETTLE as R)));
    const openShuffled = Object.fromEntries(Object.entries(OPEN).reverse()) as unknown as R;
    expect(Object.keys(canonicalActRecord(openShuffled))).toEqual(['kind', 'opKey', 'requestId', 'actId']);
  });

  it('carries every actor\'s subject as it came (call 2007), keeps the actor\'s two keys and the grammar\'s key order, and is idempotent', () => {
    const op = canonicalActRecord({ ...INTENT, actor: { kind: 'operator', subject: 'device:phone' } } as R) as Extract<R, { kind: 'act-intent' }>;
    expect(op.actor).toEqual({ kind: 'operator', subject: 'device:phone' });
    expect(canonicalActRecord(op)).toEqual(op);
    const srv = canonicalActRecord({ ...SETTLE, actor: { kind: 'server', subject: 'ccrc server: act-head-sign' } } as R) as Extract<R, { kind: 'act-settle' }>;
    expect(srv.actor.subject).toBe('ccrc server: act-head-sign');
    expect(Object.keys((canonicalActRecord(SETTLE as R) as Extract<R, { kind: 'act-settle' }>))).toEqual([
      'kind', 'opKey', 'actId', 'act', 'effect', 'natural', 'targets', 'requestId', 'authority', 'term', 'generationId', 'actor',
      'identityStrength', 'isolation', 'from', 'to']);
  });
});

describe('the fold', () => {
  for (const [name, run] of Object.entries(actJournalFoldCases(grammar))) it(name, run);
});

describe('the highest ids the writer reads', () => {
  for (const [name, run] of Object.entries(actJournalHighestCases(grammar))) it(name, run);
});

describe('the kebab words', () => {
  it('admits the record kinds and the file stems, and nothing else', () => {
    expect(['act-intent', 'act-settle', 'act-open-request', 'overlord-acts', 'overlord-acts-torn'].every(isOverlordActsKebab)).toBe(true);
    expect(['act-close', 'overlord-authority', 'done'].some(isOverlordActsKebab)).toBe(false);
  });
});
