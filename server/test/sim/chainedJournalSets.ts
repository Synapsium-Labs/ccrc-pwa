// The chained-journal kernel's case suite and mutant sets (Overlord W1, journal kernel plan Task 4; the floors rule is D-8217):
// `decodeChainedLine`, `ChainVerifier` and `chainedTailHealPlan`, each run against the suite cases that load the mutated copy of
// server/src/chainedJournal.ts. Registered in mutation-floors.test.ts's MUTANT_SETS, with a floor each in mutation-floors.json.
//
// The suite takes the kernel as a MODULE (`chainedKernelSuite(m)`), so `chained-journal.test.ts` runs it against the real kernel
// and the mutant sets run it against a mutated copy. It drives the kernel through a SECOND format, a fixture ("probe") with its
// own refusal class and its own json error class, so nothing in it can pass by reaching for the delegation journal's.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import * as RealKernel from '../../src/chainedJournal.js';
import type { ChainedJournalErrorCode, ChainedJournalFormat, ChainedJournalRecord, ChainedPosition } from '../../src/chainedJournal.js';
import type { MutantSet, SuiteCase } from './mutate.js';

type Kernel = typeof RealKernel;
type Cases = Record<string, SuiteCase>;
const KERNEL_TS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/chainedJournal.ts');
export const CHAINED_DECODE_KEY = 'server/src/chainedJournal.ts#decodeChainedLine';
export const CHAINED_VERIFIER_KEY = 'server/src/chainedJournal.ts#ChainVerifier';
export const CHAINED_HEAL_KEY = 'server/src/chainedJournal.ts#chainedTailHealPlan';

// ── The fixture formats ──────────────────────────────────────────────────────────────────────────────────────────────

/** The fixture journal's refusal class: not the delegation journal's, so a kernel that threw its own would be seen. */
export class ProbeJournalError extends Error {
  constructor(readonly code: string, detail: string, readonly where?: { line?: number; offset?: number }) {
    super(`probe journal ${code}: ${detail}`);
    this.name = 'ProbeJournalError';
  }
}
/** The fixture journal's canonical-writer error class. */
export class ProbeJsonError extends Error {
  constructor(detail: string) {
    super(`probe canonical JSON: ${detail}`);
    this.name = 'ProbeJsonError';
  }
}

export interface ProbeEntry { kind: 'probe'; n: number }
type Fmt<E> = ChainedJournalFormat<E, ProbeJournalError>;

function formatOver<E>(kinds: readonly string[], entry: (raw: unknown, fmt: Fmt<E>) => E): Fmt<E> {
  const fmt: Fmt<E> = {
    kinds,
    entry: (raw) => entry(raw, fmt),
    fail: (code, detail, where) => new ProbeJournalError(code, detail, where),
    jsonError: (detail) => new ProbeJsonError(detail),
  };
  return fmt;
}

/** The fixture format: kinds `['probe']`, entry `{ kind: 'probe', n }` with `n` a positive safe integer, over kernel `m`. */
export function probeFormat(m: Kernel): Fmt<ProbeEntry> {
  return formatOver<ProbeEntry>(['probe'], (raw, fmt) => {
    if (!m.isRecord(raw)) throw fmt.fail('bad-field', 'a probe entry is not an object');
    m.chainedExactKeys(fmt, raw, ['kind', 'n'], 'a probe entry');
    if (raw['kind'] !== 'probe') throw fmt.fail('bad-field', `a probe entry has kind ${JSON.stringify(raw['kind'])}, not "probe"`);
    const n = raw['n'];
    if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1) throw fmt.fail('bad-field', 'n is not a positive safe integer');
    return { kind: 'probe', n };
  });
}

/** The fixture format over the real kernel, for the kinds census. A later journal's piece registers its own beside it. */
export const PROBE_JOURNAL_FORMAT: Fmt<ProbeEntry> = probeFormat(RealKernel);

// ── Fixture bytes ────────────────────────────────────────────────────────────────────────────────────────────────────

const HEX_A = 'a'.repeat(64);
const HEX_B = 'b'.repeat(64);
const ENC = new TextEncoder();
const DEC = new TextDecoder();
const at = (i: number): string => `2026-11-14T10:00:${String(i % 60).padStart(2, '0')}.000Z`;
const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
const sans = (bytes: Uint8Array): Uint8Array => bytes.subarray(0, bytes.length - 1);
const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
};

/** `count` chained records from `first`; a first above 1 carries a made-up previousDigest, as a compacted journal's would. */
function chainOf(m: Kernel, fmt: Fmt<ProbeEntry>, count: number, first = 1): ChainedJournalRecord<ProbeEntry>[] {
  const out: ChainedJournalRecord<ProbeEntry>[] = [];
  for (let i = 0; i < count; i++) {
    const sequence = first + i;
    const previousDigest = i > 0 ? out[i - 1]!.digest : first === 1 ? null : HEX_A;
    out.push(m.buildChainedRecord(fmt, { sequence, acceptedAt: at(sequence), previousDigest, entry: { kind: 'probe', n: sequence } }));
  }
  return out;
}
const bytesOf = (m: Kernel, fmt: Fmt<ProbeEntry>, rs: readonly ChainedJournalRecord<ProbeEntry>[]): Uint8Array =>
  concat(...rs.map((r) => m.encodeChainedRecord(fmt, r)));
/** A record's line (no LF) with `edit` applied to its parsed object, then written as plain JSON. */
function edited(m: Kernel, fmt: Fmt<ProbeEntry>, edit: (o: Record<string, unknown>) => void, r = chainOf(m, fmt, 1)[0]!): Uint8Array {
  const o = JSON.parse(DEC.decode(sans(m.encodeChainedRecord(fmt, r)))) as Record<string, unknown>;
  edit(o);
  return ENC.encode(JSON.stringify(o));
}
const lineText = (m: Kernel, fmt: Fmt<ProbeEntry>, r: ChainedJournalRecord<ProbeEntry>): string => DEC.decode(sans(m.encodeChainedRecord(fmt, r)));
/** The canonical line with one space after its opening brace: valid JSON, the same record, but not the canonical bytes. */
const spacedLine = (text: string): string => {
  if (!text.startsWith('{')) throw new Error(`a canonical line opens with '{', not ${JSON.stringify(text.slice(0, 1))}`);
  return `{ ${text.slice(1)}`;
};
const position = (r: ChainedJournalRecord<ProbeEntry>): ChainedPosition => ({ sequence: r.sequence, journalId: r.journalId, digest: r.digest });

function thrown(fn: () => unknown): unknown {
  try { fn(); } catch (err) { return err; }
  throw new Error('nothing was thrown');
}
function refusal(e: unknown, code: string, where?: { line?: number; offset?: number }): void {
  expect(e).toBeInstanceOf(ProbeJournalError);
  expect((e as ProbeJournalError).code).toBe(code);
  if (where !== undefined) expect((e as ProbeJournalError).where).toEqual(where);
}

/** A hand-written line whose entry holds a lone surrogate: every envelope field is valid, so only the entry can be refused. */
const LONE_SURROGATE_LINE = ENC.encode(
  `{"acceptedAt":"${at(1)}","digest":"${HEX_A}","entry":{"s":"\\ud800"},"journalId":"${HEX_A}","previousDigest":null,"sequence":1,"v":1}`);

// ── Every code, reached ──────────────────────────────────────────────────────────────────────────────────────────────

/** For each `ChainedJournalErrorCode`, the way to reach it through the kernel; the error thrown, or (the torn tail) returned. */
export function reaches(m: Kernel): Record<ChainedJournalErrorCode, () => unknown> {
  const fmt = probeFormat(m);
  const loose = formatOver<unknown>(['loose'], (raw) => raw);
  const [r1, r2, r3] = chainOf(m, fmt, 3) as [ChainedJournalRecord<ProbeEntry>, ChainedJournalRecord<ProbeEntry>, ChainedJournalRecord<ProbeEntry>];
  const line1 = sans(m.encodeChainedRecord(fmt, r1));
  const feed = (rs: readonly ChainedJournalRecord<ProbeEntry>[], opts?: RealKernel.ChainOptions) => (): unknown => {
    const v = new m.ChainVerifier(fmt, opts);
    for (const r of rs) v.accept(r);
    return v.finish();
  };
  const dec = (bytes: Uint8Array) => (): unknown => m.decodeChainedLine(fmt, bytes);
  const otherDigest = { ...r1, digest: HEX_B };
  return {
    bom: dec(concat(new Uint8Array([0xef, 0xbb, 0xbf]), line1)),
    crlf: dec(concat(line1, new Uint8Array([0x0d]))),
    'blank-line': dec(new Uint8Array(0)),
    'torn-tail': () => m.chainedTornTailError(fmt, line1.subarray(0, 20)),
    'missing-final-lf': () => m.chainedTornTailError(fmt, line1),
    'invalid-utf8': dec(new Uint8Array([0xff, 0xfe])),
    'malformed-json': dec(ENC.encode('{')),
    'duplicate-key': dec(ENC.encode(lineText(m, fmt, r1).replace('"n":1}', '"n":1,"n":1}'))),
    'unknown-key': dec(edited(m, fmt, (o) => { o['extra'] = 1; })),
    'bad-field': dec(edited(m, fmt, (o) => { o['v'] = 2; })),
    'invalid-domain': () => m.decodeChainedLine(loose, LONE_SURROGATE_LINE),
    noncanonical: dec(ENC.encode(spacedLine(lineText(m, fmt, r1)))),
    'sequence-domain': dec(edited(m, fmt, (o) => { o['sequence'] = 0; })),
    'sequence-start': feed([r2], { completeFromStart: true }),
    'sequence-duplicate': feed([r1, r1]),
    'sequence-descent': feed([r2, r3, r2]),
    'sequence-gap': feed([r1, r3]),
    'previous-digest': feed([r1, { ...r2, previousDigest: HEX_B }]),
    'journal-id-mismatch': dec(edited(m, fmt, (o) => { o['journalId'] = HEX_B; })),
    'digest-mismatch': dec(edited(m, fmt, (o) => { o['digest'] = HEX_B; })),
    'anchor-sequence': feed([r1], { anchor: { ...position(r1), sequence: 5 } }),
    'anchor-journal-id': feed([r1], { anchor: { ...position(r1), journalId: HEX_B } }),
    'anchor-digest': feed([r1], { anchor: position(otherDigest) }),
    'anchor-missing': feed([r1], { anchor: { sequence: 9, journalId: HEX_B, digest: HEX_B } }),
  };
}

// ── The cases, in three groups: the mutant sets run the groups that bear on them ────────────────────────────────────────

function groups(m: Kernel): { shared: Cases; decode: Cases; chain: Cases; heal: Cases } {
  const fmt = probeFormat(m);
  const reach = reaches(m);
  const records = chainOf(m, fmt, 3);
  const [r1, r2, r3] = records as [ChainedJournalRecord<ProbeEntry>, ChainedJournalRecord<ProbeEntry>, ChainedJournalRecord<ProbeEntry>];
  const W = { line: 7 };

  const shared: Cases = {
    'the error-code table is total and every code is reached': () => {
      expect(Object.keys(reach).sort()).toEqual(Object.keys(m.CHAINED_JOURNAL_ERROR_CODES).sort());
      expect(Object.keys(m.CHAINED_JOURNAL_ERROR_CODES)).toHaveLength(24);
    },
    'a record is built to the two exact preimages': () => {
      const entry = '{"kind":"probe","n":1}';
      const id = sha(`{"acceptedAt":"${at(1)}","entry":${entry},"previousDigest":null,"sequence":1,"v":1}`);
      const digest = sha(`{"acceptedAt":"${at(1)}","entry":${entry},"journalId":"${id}","previousDigest":null,"sequence":1,"v":1}`);
      expect(r1).toEqual({ v: 1, sequence: 1, journalId: id, acceptedAt: at(1), previousDigest: null, entry: { kind: 'probe', n: 1 }, digest });
      expect(m.chainedRecordId(fmt, r1)).toBe(id);
      expect(m.chainedRecordDigest(fmt, r1)).toBe(digest);
      expect(r2.previousDigest).toBe(r1.digest);
    },
    'a record is encoded as its canonical JSON and one LF': () => {
      const bytes = m.encodeChainedRecord(fmt, r1);
      expect(bytes[bytes.length - 1]).toBe(0x0a);
      expect(DEC.decode(sans(bytes))).toBe(JSON.stringify({
        acceptedAt: r1.acceptedAt, digest: r1.digest, entry: { kind: 'probe', n: 1 }, journalId: r1.journalId,
        previousDigest: null, sequence: 1, v: 1,
      }));
    },
    'a built record decodes to itself, and the entry is rebuilt by the format': () => {
      for (const r of records) expect(m.decodeChainedLine(fmt, sans(m.encodeChainedRecord(fmt, r)))).toEqual(r);
    },
    'building refuses what the decoder would refuse, as the fixture class': () => {
      const f = { sequence: 1, acceptedAt: at(1), previousDigest: null, entry: { kind: 'probe' as const, n: 1 } };
      refusal(thrown(() => m.buildChainedRecord(fmt, { ...f, sequence: 0 })), 'sequence-domain');
      refusal(thrown(() => m.buildChainedRecord(fmt, { ...f, sequence: 1.5 })), 'sequence-domain');
      refusal(thrown(() => m.buildChainedRecord(fmt, { ...f, acceptedAt: '2026-11-14T10:00:00Z' })), 'bad-field');
      refusal(thrown(() => m.buildChainedRecord(fmt, { ...f, previousDigest: 'abc' })), 'bad-field');
      refusal(thrown(() => m.buildChainedRecord(fmt, { ...f, entry: { kind: 'probe', n: 0 } })), 'bad-field');
    },
    'an entry outside the canonical domain is the format\'s json error on build and encode, never a refusal': () => {
      const loose = formatOver<unknown>(['loose'], (raw) => raw);
      const e = thrown(() => m.buildChainedRecord(loose, { sequence: 1, acceptedAt: at(1), previousDigest: null, entry: { x: Number.NaN } }));
      expect(e).toBeInstanceOf(ProbeJsonError);
      expect(e).not.toBeInstanceOf(ProbeJournalError);
      const ok = m.buildChainedRecord(loose, { sequence: 1, acceptedAt: at(1), previousDigest: null, entry: { x: 1 } });
      const e2 = thrown(() => m.encodeChainedRecord(loose, { ...ok, entry: { x: 2 ** 60 } }));
      expect(e2).toBeInstanceOf(ProbeJsonError);
    },
    'the shared field checks refuse as the fixture class, with no position': () => {
      refusal(thrown(() => m.chainedExactKeys(fmt, { a: 1, b: 2 }, ['a'], 'x')), 'unknown-key');
      refusal(thrown(() => m.chainedExactKeys(fmt, { a: 1 }, ['a', 'b'], 'x')), 'bad-field');
      expect(() => m.chainedExactKeys(fmt, { a: 1, b: 2 }, ['a', 'b'], 'x')).not.toThrow();
      expect(m.chainedHex64(fmt, HEX_A, 'h')).toBe(HEX_A);
      for (const bad of ['A'.repeat(64), 'a'.repeat(63), 7, null]) refusal(thrown(() => m.chainedHex64(fmt, bad, 'h')), 'bad-field');
      for (const bad of ['2026-11-14T10:00:00Z', '2026-02-30T00:00:00.000Z', '2026-11-14 10:00:00.000Z', 5]) {
        const e = thrown(() => m.chainedAssertInstant(fmt, bad, 'at'));
        refusal(e, 'bad-field');
        expect((e as ProbeJournalError).where).toBeUndefined();
        expect((e as ProbeJournalError).message).toContain('at is not a canonical UTC millisecond instant');
      }
      expect(() => m.chainedAssertInstant(fmt, at(1), 'at')).not.toThrow();
      expect(m.isRecord({})).toBe(true);
      expect([m.isRecord([]), m.isRecord(null), m.isRecord('x')]).toEqual([false, false, false]);
    },
  };

  const decode: Cases = {};
  for (const code of Object.keys(m.CHAINED_JOURNAL_ERROR_CODES) as ChainedJournalErrorCode[]) {
    decode[`${code} is reached and thrown as the fixture class`] = () => {
      const e = thrown(() => { const v = reach[code](); if (code === 'torn-tail' || code === 'missing-final-lf') throw v; });
      refusal(e, code);
      expect(e).not.toBeInstanceOf(ProbeJsonError);
    };
  }
  Object.assign(decode, {
    'a decode refusal carries the position it was given': () => {
      const line = (bytes: Uint8Array): unknown => thrown(() => m.decodeChainedLine(fmt, bytes, W));
      refusal(line(concat(new Uint8Array([0xef, 0xbb, 0xbf]), sans(m.encodeChainedRecord(fmt, r1)))), 'bom', W);
      refusal(line(new Uint8Array(0)), 'blank-line', W);
      refusal(line(concat(sans(m.encodeChainedRecord(fmt, r1)), new Uint8Array([0x0d]))), 'crlf', W);
      // A BOM and a CR on one line: the BOM is checked first, so it is what the line is refused for.
      refusal(line(concat(new Uint8Array([0xef, 0xbb, 0xbf]), sans(m.encodeChainedRecord(fmt, r1)), new Uint8Array([0x0d]))), 'bom', W);
      refusal(line(new Uint8Array([0xff])), 'invalid-utf8', W);
      refusal(line(ENC.encode('{')), 'malformed-json', W);
      refusal(line(ENC.encode('[]')), 'bad-field', W);
      refusal(line(edited(m, fmt, (o) => { o['v'] = 2; })), 'bad-field', W);
      refusal(line(ENC.encode(spacedLine(lineText(m, fmt, r1)))), 'noncanonical', W);
      refusal(line(ENC.encode(lineText(m, fmt, r1).replace('"n":1}', '"n":1,"n":1}'))), 'duplicate-key', W);
      refusal(line(edited(m, fmt, (o) => { o['journalId'] = HEX_B; })), 'journal-id-mismatch', W);
      refusal(line(edited(m, fmt, (o) => { o['digest'] = HEX_B; })), 'digest-mismatch', W);
      refusal(line(edited(m, fmt, (o) => { o['previousDigest'] = 'zz'; })), 'bad-field', W);
    },
    'a record missing a key is bad-field, an extra key is unknown-key': () => {
      refusal(thrown(() => m.decodeChainedLine(fmt, edited(m, fmt, (o) => { delete o['digest']; }))), 'bad-field');
      refusal(thrown(() => m.decodeChainedLine(fmt, edited(m, fmt, (o) => { o['x'] = 1; }))), 'unknown-key');
    },
    'a decode refuses a previousDigest and a journalId that are not lowercase hex': () => {
      refusal(thrown(() => m.decodeChainedLine(fmt, edited(m, fmt, (o) => { o['previousDigest'] = 'zz'; }))), 'bad-field');
      refusal(thrown(() => m.decodeChainedLine(fmt, edited(m, fmt, (o) => { o['journalId'] = 'A'.repeat(64); }))), 'bad-field');
      refusal(thrown(() => m.decodeChainedLine(fmt, edited(m, fmt, (o) => { o['acceptedAt'] = '2026-11-14T10:00:00Z'; }))), 'bad-field');
      refusal(thrown(() => m.decodeChainedLine(fmt, edited(m, fmt, (o) => { o['sequence'] = 1.5; }))), 'sequence-domain');
    },
    'a decode refuses an entry the grammar refuses, even with its hashes right': () => {
      const loose = formatOver<unknown>(['loose'], (raw) => raw);
      const forged = m.buildChainedRecord(loose, { sequence: 1, acceptedAt: at(1), previousDigest: null, entry: { kind: 'probe', n: 0 } });
      refusal(thrown(() => m.decodeChainedLine(fmt, sans(m.encodeChainedRecord(loose, forged)))), 'bad-field');
    },
    'invalid-domain keeps the format\'s json error message': () => {
      const loose = formatOver<unknown>(['loose'], (raw) => raw);
      const e = thrown(() => m.decodeChainedLine(loose, LONE_SURROGATE_LINE, W));
      refusal(e, 'invalid-domain', W);
      expect((e as Error).message).toContain('probe canonical JSON: $.entry.s holds a lone surrogate');
      const big = ENC.encode(`{"acceptedAt":"${at(1)}","digest":"${HEX_A}","entry":{"s":9007199254740993},"journalId":"${HEX_A}","previousDigest":null,"sequence":1,"v":1}`);
      refusal(thrown(() => m.decodeChainedLine(loose, big)), 'invalid-domain');
    },
    'an ownKeys failure inside the entry is the writer\'s refusal, invalid-domain': () => {
      const forgedLine = sans(m.encodeChainedRecord(fmt, r1));
      const hostile = formatOver<unknown>(['probe'], () => new Proxy({}, { ownKeys() { throw new TypeError('ownKeys trap'); } }));
      const e = thrown(() => m.decodeChainedLine(hostile, forgedLine));
      refusal(e, 'invalid-domain');
      expect((e as Error).message).toContain('cannot enumerate its keys');
    },
    'an error that is not the kernel\'s own is rethrown unchanged, never invalid-domain': () => {
      const forgedLine = sans(m.encodeChainedRecord(fmt, r1));
      const boom = new TypeError('getPrototypeOf trap');
      const hostile = formatOver<unknown>(['probe'], () => new Proxy({}, { getPrototypeOf() { throw boom; } }));
      const e = thrown(() => m.decodeChainedLine(hostile, forgedLine));
      expect(e).toBe(boom);
      expect(e).not.toBeInstanceOf(ProbeJournalError);
    },
    'the scanner finds a repeated key at any depth, and a syntax error is not a pass': () => {
      expect(m.findJsonDefect('{"a":1,"a":2}')).toBe('duplicate-key');
      expect(m.findJsonDefect('{"a":[{"b":1,"b":2}]}')).toBe('duplicate-key');
      expect(m.findJsonDefect('{"a":{"b":1},"c":{"b":2}}')).toBeNull();
      expect(m.findJsonDefect('{"a":1')).toBe('malformed-json');
      expect(m.findJsonDefect('{"a":1} x')).toBe('malformed-json');
      expect(m.findJsonDefect('[1,2,{"k":"v"}]')).toBeNull();
      expect(m.findJsonDefect(`${'['.repeat(70)}${']'.repeat(70)}`)).toBe('malformed-json');
    },
    'the splitter returns complete lines across chunks and keeps the leftover': () => {
      const s = new m.ChainedLineSplitter();
      expect(s.push(ENC.encode('ab\ncd'))).toEqual([ENC.encode('ab')]);
      expect(DEC.decode(s.leftover())).toBe('cd');
      expect(s.push(ENC.encode('e\n\nfg')).map((l) => DEC.decode(l))).toEqual(['cde', '']);
      expect(DEC.decode(s.leftover())).toBe('fg');
      expect(s.push(ENC.encode('\n')).map((l) => DEC.decode(l))).toEqual(['fg']);
      expect(s.leftover()).toHaveLength(0);
    },
  });

  const chain: Cases = {
    'a chain of records is accepted and its coverage reports the head': () => {
      const v = new m.ChainVerifier(fmt, { completeFromStart: true });
      expect([v.head(), v.recordCount(), v.firstRecord()]).toEqual([null, 0, null]);
      for (const r of records) v.accept(r);
      expect(v.head()).toEqual(position(r3));
      expect(v.recordCount()).toBe(3);
      expect(v.firstRecord()).toEqual({ sequence: 1, previousDigest: null });
      expect(v.finish()).toEqual({ firstSequence: 1, lastSequence: 3, recordCount: 3, firstPreviousDigest: null, copiedEof: position(r3) });
    },
    'an empty journal has an empty coverage': () => {
      expect(new m.ChainVerifier(fmt).finish()).toEqual({ firstSequence: null, lastSequence: null, recordCount: 0, firstPreviousDigest: null, copiedEof: null });
    },
    'a journal that was compacted may begin later, and reports its first previousDigest': () => {
      const later = chainOf(m, fmt, 2, 5);
      const v = new m.ChainVerifier(fmt);
      for (const r of later) v.accept(r);
      expect(v.finish()).toEqual({ firstSequence: 5, lastSequence: 6, recordCount: 2, firstPreviousDigest: HEX_A, copiedEof: position(later[1]!) });
    },
    'a complete journal begins at sequence 1 with a null previousDigest': () => {
      refusal(thrown(() => new m.ChainVerifier(fmt, { completeFromStart: true }).accept(r2)), 'sequence-start');
      const bad = m.buildChainedRecord(fmt, { sequence: 1, acceptedAt: at(1), previousDigest: HEX_A, entry: { kind: 'probe' as const, n: 1 } });
      refusal(thrown(() => new m.ChainVerifier(fmt, { completeFromStart: true }).accept(bad)), 'previous-digest');
      new m.ChainVerifier(fmt, { completeFromStart: false }).accept(r2);
    },
    'each chain refusal is thrown as the fixture class': () => {
      const run = (rs: ChainedJournalRecord<ProbeEntry>[]): unknown => thrown(() => { const v = new m.ChainVerifier(fmt); for (const r of rs) v.accept(r); });
      refusal(run([r1, r1]), 'sequence-duplicate');
      refusal(run([r2, r3, r2]), 'sequence-descent');
      refusal(run([r3, r2]), 'sequence-descent');
      refusal(run([r1, r3]), 'sequence-gap');
      refusal(run([r1, { ...r2, previousDigest: HEX_B }]), 'previous-digest');
      refusal(thrown(() => new m.ChainVerifier(fmt).accept({ ...r1, sequence: 0 })), 'sequence-domain');
    },
    'the anchor must match in all three parts, and may sit at any record': () => {
      for (const anchor of [position(r1), position(r2), position(r3)]) {
        const v = new m.ChainVerifier(fmt, { anchor });
        for (const r of records) v.accept(r);
        expect(v.anchorWasSeen()).toBe(true);
        expect(v.finish().recordCount).toBe(3);
      }
      const run = (anchor: ChainedPosition): unknown => thrown(() => { const v = new m.ChainVerifier(fmt, { anchor }); for (const r of records) v.accept(r); v.finish(); });
      refusal(run({ ...position(r2), journalId: HEX_B }), 'anchor-journal-id');
      refusal(run({ ...position(r2), digest: HEX_B }), 'anchor-digest');
      refusal(run({ ...position(r1), sequence: 2 }), 'anchor-sequence');
      refusal(run({ sequence: 9, journalId: HEX_B, digest: HEX_B }), 'anchor-missing');
      const none = new m.ChainVerifier(fmt, { anchor: position(r3) });
      none.accept(r1);
      expect(none.anchorWasSeen()).toBe(false);
      refusal(thrown(() => none.finish()), 'anchor-missing');
    },
    'verifyChainedBytes visits each record once, in order, and keeps none': () => {
      const visited: number[] = [];
      const cov = m.verifyChainedBytes(fmt, bytesOf(m, fmt, records), { completeFromStart: true }, (r) => { visited.push(r.sequence); });
      expect(visited).toEqual([1, 2, 3]);
      expect(cov).toEqual({ firstSequence: 1, lastSequence: 3, recordCount: 3, firstPreviousDigest: null, copiedEof: position(r3) });
      expect(Object.keys(cov).sort()).toEqual(['copiedEof', 'firstPreviousDigest', 'firstSequence', 'lastSequence', 'recordCount']);
      expect(m.verifyChainedBytes(fmt, new Uint8Array(0)).recordCount).toBe(0);
    },
    'verifyChainedBytes numbers the line of a refusal': () => {
      const bad = concat(m.encodeChainedRecord(fmt, r1), ENC.encode('{\n'));
      refusal(thrown(() => m.verifyChainedBytes(fmt, bad)), 'malformed-json', { line: 2 });
      refusal(thrown(() => m.verifyChainedBytes(fmt, bytesOf(m, fmt, [r1, r3]))), 'sequence-gap');
    },
    'verifyChainedBytes: a tail after the last LF is torn-tail or missing-final-lf at the next line': () => {
      const two = bytesOf(m, fmt, [r1, r2]);
      refusal(thrown(() => m.verifyChainedBytes(fmt, concat(two, ENC.encode('{"v"')))), 'torn-tail', { line: 3 });
      refusal(thrown(() => m.verifyChainedBytes(fmt, concat(two, sans(m.encodeChainedRecord(fmt, r3))))), 'missing-final-lf', { line: 3 });
    },
    'verifyChainedBytes ends with the anchor check': () => {
      refusal(thrown(() => m.verifyChainedBytes(fmt, bytesOf(m, fmt, [r1]), { anchor: position(r2) })), 'anchor-missing');
      expect(m.verifyChainedBytes(fmt, bytesOf(m, fmt, records), { anchor: position(r2) }).recordCount).toBe(3);
    },
    'parseChainedBytes returns every record': () => {
      expect(m.parseChainedBytes(fmt, bytesOf(m, fmt, records), { completeFromStart: true })).toEqual(records);
      refusal(thrown(() => m.parseChainedBytes(fmt, bytesOf(m, fmt, [r2]), { completeFromStart: true })), 'sequence-start');
    },
  };

  const tailOf = (code: 'torn-tail' | 'missing-final-lf', offset = 120): RealKernel.ChainedTail =>
    ({ offset, bytes: ENC.encode('twelve bytes'), sha256: HEX_B, code });
  const heal: Cases = {
    'a journal with no tail has no heal': () => {
      expect(m.chainedTailHealPlan(null, true)).toBeNull();
      expect(m.chainedTailHealPlan(null, false)).toBeNull();
    },
    'a tail is not healed when the prefix is unsound': () => {
      for (const code of ['torn-tail', 'missing-final-lf'] as const) expect(m.chainedTailHealPlan(tailOf(code), false)).toBeNull();
    },
    'a tail of either code heals by the exact plan, named by offset and digest': () => {
      for (const code of ['torn-tail', 'missing-final-lf'] as const) {
        expect(m.chainedTailHealPlan(tailOf(code, 120), true)).toEqual({ offset: 120, bytes: 12, sha256: HEX_B, code, name: `120-${HEX_B}.tail` });
      }
      expect(m.chainedTailHealPlan(tailOf('torn-tail', 0), true)!.name).toBe(`0-${HEX_B}.tail`);
    },
    'bytes after the last LF: one complete record is missing-final-lf, anything else torn-tail, as the fixture class': () => {
      const whole = sans(m.encodeChainedRecord(fmt, r1));
      const a = m.chainedTornTailError(fmt, whole, { offset: 5 });
      expect(a).toBeInstanceOf(ProbeJournalError);
      expect([a.code, a.where]).toEqual(['missing-final-lf', { offset: 5 }]);
      const b = m.chainedTornTailError(fmt, whole.subarray(0, 10), { offset: 5 });
      expect(b).toBeInstanceOf(ProbeJournalError);
      expect([b.code, b.where]).toEqual(['torn-tail', { offset: 5 }]);
      expect(b.message).toContain('10 bytes follow the last LF');
      expect(m.chainedTornTailError(fmt, new Uint8Array([0xff])).code).toBe('torn-tail');
      expect(m.chainedTornTailError(fmt, ENC.encode('{}')).code).toBe('torn-tail');
    },
  };
  return { shared, decode, chain, heal };
}

/** The whole suite, for the kernel module `m`: the real one in `chained-journal.test.ts`, a mutated copy in the sets. */
export function chainedKernelSuite(m: Kernel): Record<string, SuiteCase> {
  const g = groups(m);
  return { ...g.shared, ...g.decode, ...g.chain, ...g.heal };
}

// ── The mutant sets ──────────────────────────────────────────────────────────────────────────────────────────────────

const DECODE_SET: MutantSet<Kernel> = {
  modulePath: KERNEL_TS,
  mutants: [
    { id: 'D1 bom code swapped', old: "line[2] === 0xbf) refuse(fmt, 'bom'", new: "line[2] === 0xbf) refuse(fmt, 'bad-field'" },
    { id: 'D2 blank line passes', old: "if (line.length === 0) refuse(fmt, 'blank-line', 'an empty line', w);", new: '' },
    { id: 'D3 crlf passes', old: "if (line[line.length - 1] === 0x0d) refuse(fmt, 'crlf'", new: "if (false) refuse(fmt, 'crlf'" },
    { id: 'D4 utf-8 not fatal', old: '{ fatal: true, ignoreBOM: true }', new: '{ fatal: false, ignoreBOM: true }' },
    { id: 'D5 position dropped from malformed-json', old: "'the line is not JSON', w)", new: "'the line is not JSON')" },
    { id: 'D6 record keys lose digest', old: "'entry', 'digest'] as const", new: "'entry'] as const" },
    { id: 'D7 v not checked', old: "if (parsed['v'] !== 1) refuse(fmt, 'bad-field', 'v is not 1', w);", new: '' },
    { id: 'D8 previousDigest shape not checked', old: "if (previousDigest !== null && !isLowerHex64(previousDigest)) refuse(fmt, 'bad-field', 'previousDigest is neither null nor a lowercase 64-hex SHA-256', w);", new: '' },
    { id: 'D9 entry not rebuilt by the format', old: "const entry = fmt.entry(parsed['entry']);", new: "const entry = parsed['entry'] as E;" },
    { id: 'D10 invalid-domain maps every error', old: "if (mine.has(err as Error)) return refuse(fmt, 'invalid-domain'", new: "if (true) return refuse(fmt, 'invalid-domain'" },
    { id: 'D11 invalid-domain maps none', old: "if (mine.has(err as Error)) return refuse(fmt, 'invalid-domain'", new: "if (false) return refuse(fmt, 'invalid-domain'" },
    { id: 'D12 invalid-domain message dropped', old: "return refuse(fmt, 'invalid-domain', (err as Error).message, w);", new: "return refuse(fmt, 'invalid-domain', 'outside the domain', w);" },
    { id: 'D13 duplicate-key never named', old: "if (findJsonDefect(text) === 'duplicate-key') refuse(fmt, 'duplicate-key'", new: "if (false) refuse(fmt, 'duplicate-key'" },
    { id: 'D14 noncanonical code swapped', old: "refuse(fmt, 'noncanonical', ", new: "refuse(fmt, 'bad-field', " },
    { id: 'D15 canonical comparison dropped', old: 'if (canonical !== text) {', new: 'if (false) {' },
    { id: 'D16 journalId not checked', old: "if (chainedRecordId(fmt, record) !== journalId) refuse(", new: 'if (false) refuse(' },
    { id: 'D17 digest not checked', old: "if (chainedRecordDigest(fmt, record) !== digest) refuse(", new: 'if (false) refuse(' },
    { id: 'D18 digest code swapped', old: "refuse(fmt, 'digest-mismatch'", new: "refuse(fmt, 'journal-id-mismatch'" },
    { id: 'D19 scanner misses a nested duplicate', old: 'if (keys.has(k)) {', new: 'if (depth === 0 && keys.has(k)) {' },
    {
      id: 'D20 CR checked before the BOM',
      old: "  if (line.length >= 3 && line[0] === 0xef && line[1] === 0xbb && line[2] === 0xbf) refuse(fmt, 'bom', 'a byte-order mark', w);\n"
        + "  if (line.length === 0) refuse(fmt, 'blank-line', 'an empty line', w);\n"
        + "  if (line[line.length - 1] === 0x0d) refuse(fmt, 'crlf', 'a line ends in CR before its LF', w);\n",
      new: "  if (line[line.length - 1] === 0x0d) refuse(fmt, 'crlf', 'a line ends in CR before its LF', w);\n"
        + "  if (line.length >= 3 && line[0] === 0xef && line[1] === 0xbb && line[2] === 0xbf) refuse(fmt, 'bom', 'a byte-order mark', w);\n"
        + "  if (line.length === 0) refuse(fmt, 'blank-line', 'an empty line', w);\n",
    },
  ],
  suite(m) { const g = groups(m); return { ...g.shared, ...g.decode }; },
};

const VERIFIER_SET: MutantSet<Kernel> = {
  modulePath: KERNEL_TS,
  mutants: [
    { id: 'V1 gap off by one', old: "+ 1) refuse(fmt, 'sequence-gap'", new: "+ 2) refuse(fmt, 'sequence-gap'" },
    { id: 'V2 descent by one is a gap', old: 'if (record.sequence < this.last.sequence) refuse', new: 'if (record.sequence < this.last.sequence - 1) refuse' },
    { id: 'V3 duplicate passes', old: 'if (record.sequence === this.last.sequence) refuse(', new: 'if (false) refuse(' },
    { id: 'V4 previousDigest not chained', old: 'if (record.previousDigest !== this.last.digest) refuse(', new: 'if (false) refuse(' },
    { id: 'V5 complete journal may begin anywhere', old: "if (record.sequence !== 1) refuse(fmt, 'sequence-start'", new: "if (false) refuse(fmt, 'sequence-start'" },
    { id: 'V6 complete journal may begin with a previousDigest', old: "if (record.previousDigest !== null) refuse(fmt, 'previous-digest'", new: "if (false) refuse(fmt, 'previous-digest'" },
    { id: 'V7 completeFromStart ignored', old: 'if (this.opts.completeFromStart === true) {', new: 'if (false) {' },
    { id: 'V8 sequence domain not checked', old: 'assertSequence(fmt, record.sequence);\n    const anchor', new: 'const anchor' },
    { id: 'V9 anchor journalId not checked', old: "if (record.journalId !== anchor.journalId) refuse(fmt, 'anchor-journal-id'", new: "if (false) refuse(fmt, 'anchor-journal-id'" },
    { id: 'V10 anchor digest not checked', old: "if (record.digest !== anchor.digest) refuse(fmt, 'anchor-digest'", new: "if (false) refuse(fmt, 'anchor-digest'" },
    { id: 'V11 anchor elsewhere not refused', old: '} else if (record.journalId === anchor.journalId) {', new: '} else if (false) {' },
    { id: 'V12 anchor never seen', old: 'this.anchorSeen = true;', new: '' },
    { id: 'V13 missing anchor passes', old: "if (anchor !== null && !this.anchorSeen) refuse(this.fmt, 'anchor-missing'", new: "if (false) refuse(this.fmt, 'anchor-missing'" },
    { id: 'V14 anchor matched from its sequence on', old: 'if (record.sequence === anchor.sequence) {', new: 'if (record.sequence >= anchor.sequence) {' },
    { id: 'V15 first previousDigest not reported', old: 'firstPreviousDigest: this.first?.previousDigest ?? null,', new: 'firstPreviousDigest: null,' },
    { id: 'V16 record count not kept', old: 'this.count++;', new: '' },
    { id: 'V17 head not kept', old: 'head(): ChainedPosition | null { return this.last; }', new: 'head(): ChainedPosition | null { return null; }' },
    { id: 'V18 visit never called', old: 'visit?.(record);', new: '' },
    { id: 'V19 tail position off by one', old: '{ line: lineNo + 1 }', new: '{ line: lineNo }' },
    { id: 'V20 refusal position not numbered', old: 'decodeChainedLine(fmt, line, { line: lineNo })', new: 'decodeChainedLine(fmt, line)' },
  ],
  suite(m) { const g = groups(m); return { ...g.shared, ...g.chain }; },
};

const HEAL_SET: MutantSet<Kernel> = {
  modulePath: KERNEL_TS,
  mutants: [
    { id: 'H1 an unsound prefix heals', old: 'if (tail === null || !prefixSound) return null;', new: 'if (tail === null) return null;' },
    { id: 'H2 no tail heals', old: 'if (tail === null || !prefixSound) return null;', new: 'if (!prefixSound) return null;' },
    { id: 'H3 a sound prefix does not heal', old: 'if (tail === null || !prefixSound) return null;', new: 'if (tail === null || prefixSound) return null;' },
    { id: 'H4 name digest first', old: '`${tail.offset}-${tail.sha256}.tail`', new: '`${tail.sha256}-${tail.offset}.tail`' },
    { id: 'H5 name loses its suffix', old: '.tail` };', new: '` };' },
    { id: 'H6 bytes is the offset', old: 'bytes: tail.bytes.length', new: 'bytes: tail.offset' },
    { id: 'H7 code fixed', old: 'sha256: tail.sha256, code: tail.code, name:', new: "sha256: tail.sha256, code: 'torn-tail', name:" },
    { id: 'H8 offset zero', old: 'return { offset: tail.offset, bytes:', new: 'return { offset: 0, bytes:' },
    { id: 'H9 complete record is a torn tail', old: "return fmt.fail('missing-final-lf'", new: "return fmt.fail('torn-tail'" },
    { id: 'H10 torn tail position dropped', old: 'are not a complete record`, where)', new: 'are not a complete record`)' },
  ],
  suite(m) { const g = groups(m); return { ...g.shared, ...g.heal }; },
};

export const CHAINED_JOURNAL_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [CHAINED_DECODE_KEY]: DECODE_SET as MutantSet<never>,
  [CHAINED_VERIFIER_KEY]: VERIFIER_SET as MutantSet<never>,
  [CHAINED_HEAL_KEY]: HEAL_SET as MutantSet<never>,
};
