// The chained-journal file adapter's verified-head cache (Overlord lane C; the act journal plan's question 10, slug
// `act-journal-ships-the-head-cache`, ruling F16 of review 2275): its case suites and mutant sets. The suites take the
// adapter as a MODULE, so `chained-journal-file-head-cache.test.ts` runs them against the real adapter and the mutant sets
// run them against a mutated copy of server/src/chainedJournalFile.ts.
// - `verifiedHeadHolds`, the cache's one decision, pure: `HEAD_HOLDS_SET`, registered in mutation-floors.test.ts's
//   MUTANT_SETS with a floor in mutation-floors.json.
// - The adapter's use of it (`chainedJournalFileAt`'s hit, the bytes after the head, the key it keeps): `HEAD_CACHE_SET`,
//   run by the head-cache test, every mutant killed. Its cases write real files under fixture directories (`mkTmp`), never a
//   real journal, so the caller removes them (`removeTmpFixtures`).
// Every adapter case answers exactly as a cold instance (today's whole-file verify) answers on the same bytes, and counts the
// records the format decoded, so a cache that trusted changed bytes, or that skipped nothing, is seen.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  closeSync, fstatSync, ftruncateSync, linkSync, openSync, readFileSync, renameSync, writeFileSync, writeSync, appendFileSync,
  type BigIntStats,
} from 'node:fs';
import { expect } from 'vitest';
import type * as RealAdapter from '../../src/chainedJournalFile.js';
import {
  buildChainedRecord, chainNext, chainedTailHealPlan, encodeChainedRecord, type ChainedJournalRecord,
} from '../../src/chainedJournal.js';
import { NODE_APPEND_ONLY_FS, type AppendOnlyFsOps } from '../../src/appendOnlyFile.js';
import { PROBE_JOURNAL_FORMAT, type ProbeEntry, type ProbeJournalError } from './chainedJournalSets.js';
import { mkTmp } from '../tmpHelpers.js';
import type { MutantSet, SuiteCase } from './mutate.js';

type Adapter = typeof RealAdapter;
type Cases = Record<string, SuiteCase>;
const ADAPTER_TS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/chainedJournalFile.ts');
export const HEAD_HOLDS_KEY = 'server/src/chainedJournalFile.ts#verifiedHeadHolds';

const FMT = PROBE_JOURNAL_FORMAT;
const BASE = 'probe.jsonl';
const ASIDE = 'probe-torn';
const at = (n: number): string => `2026-11-17T10:00:${String(n).padStart(2, '0')}.000Z`;
const go = (n: number) => ({ go: { entry: { kind: 'probe', n } as ProbeEntry, acceptedAt: at(n) } });
const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

/** Records chained from sequence 1 whose entries carry `ns`, in order: equal-length `ns` give equal-length files. */
const chainOf = (ns: readonly number[]): ChainedJournalRecord<ProbeEntry>[] => {
  const out: ChainedJournalRecord<ProbeEntry>[] = [];
  ns.forEach((n, i) => {
    const prev = out[i - 1];
    out.push(buildChainedRecord(FMT, { ...chainNext(prev ?? null), acceptedAt: at(i + 1), entry: { kind: 'probe', n } }));
  });
  return out;
};
const lineOf = (r: ChainedJournalRecord<ProbeEntry>): Buffer => Buffer.from(encodeChainedRecord(FMT, r));
const bytesOf = (rs: readonly ChainedJournalRecord<ProbeEntry>[]): Buffer => Buffer.concat(rs.map(lineOf));

/** The probe format, counting the entries it decodes: one per record the adapter verified, one per record an append builds
 *  (`buildChainedRecord` checks its entry by the grammar), and one per torn-tail probe. */
const counting = () => {
  const c = { n: 0 };
  const fmt = { ...FMT, entry: (raw: unknown): ProbeEntry => { c.n++; return FMT.entry(raw); } };
  const decodes = <T>(act: () => T): { value: T; decoded: number } => {
    const before = c.n;
    const value = act();
    return { value, decoded: c.n - before };
  };
  return { fmt, decodes };
};

const fx = (content?: Uint8Array): { dir: string; leaf: string } => {
  const dir = mkTmp('ccrc-head-cache-');
  const leaf = path.join(dir, BASE);
  if (content !== undefined) writeFileSync(leaf, content);
  return { dir, leaf };
};
/** Overwrites the file's bytes in place: the same inode, never truncated. */
const overwriteInPlace = (leaf: string, bytes: Uint8Array, position = 0): void => {
  const fd = openSync(leaf, 'r+');
  try { writeSync(fd, bytes, 0, bytes.length, position); } finally { closeSync(fd); }
};
const truncateTo = (leaf: string, len: number): void => {
  const fd = openSync(leaf, 'r+');
  try { ftruncateSync(fd, len); } finally { closeSync(fd); }
};

/** The decision's cases: pure, no file. */
export function headHoldsSuite(m: Adapter): Cases {
  const rs = chainOf([1, 2]);
  const bytes = bytesOf(rs);
  const one = lineOf(rs[0]!);
  const k = { dev: 5n, ino: 7n, size: one.length, sha256: sha(one) };
  const leaf = { dev: 5n, ino: 7n };
  return {
    'holds on the same device and inode, with the same bytes before the head, and any bytes after it': () => {
      expect(m.verifiedHeadHolds(k, leaf, bytes)).toBe(true);
      expect(m.verifiedHeadHolds(k, leaf, one)).toBe(true);
      const after = Buffer.from(bytes);
      after[one.length + 3] = after[one.length + 3]! ^ 1;
      expect(m.verifiedHeadHolds(k, leaf, after)).toBe(true);
    },
    'no key never holds': () => { expect(m.verifiedHeadHolds(null, leaf, bytes)).toBe(false); },
    'another device or another inode never holds': () => {
      expect(m.verifiedHeadHolds(k, { dev: 6n, ino: 7n }, bytes)).toBe(false);
      expect(m.verifiedHeadHolds(k, { dev: 5n, ino: 8n }, bytes)).toBe(false);
    },
    'a file shorter than the head never holds': () => {
      expect(m.verifiedHeadHolds(k, leaf, one.subarray(0, one.length - 1))).toBe(false);
      expect(m.verifiedHeadHolds(k, leaf, new Uint8Array(0))).toBe(false);
    },
    'one changed byte before the head, first or last, never holds': () => {
      for (const i of [0, one.length - 2, one.length - 1]) {
        const changed = Buffer.from(bytes);
        changed[i] = changed[i]! ^ 1;
        expect(m.verifiedHeadHolds(k, leaf, changed)).toBe(false);
      }
    },
    'an empty head skips nothing, so it never holds': () => {
      expect(m.verifiedHeadHolds({ ...k, size: 0, sha256: sha(new Uint8Array(0)) }, leaf, bytes)).toBe(false);
    },
  };
}

/** The adapter's cases: real files in fixture directories, each answer compared with a cold instance's. */
export function headCacheSuite(m: Adapter): Cases {
  const cold = (dir: string) => m.chainedJournalFileAt(FMT, dir, BASE).read();
  return {
    'two appends in a row: the first verifies the whole file, the second only the record the first wrote': () => {
      const f = fx(bytesOf(chainOf([1, 2, 3, 4, 5])));
      const { fmt, decodes } = counting();
      const j = m.chainedJournalFileAt(fmt, f.dir, BASE);
      const a = decodes(() => j.appendNext(() => go(6)));
      const b = decodes(() => j.appendNext(() => go(7)));
      expect(a.value).toEqual({ ok: true, record: chainOf([1, 2, 3, 4, 5, 6])[5] });
      expect(b.value).toEqual({ ok: true, record: chainOf([1, 2, 3, 4, 5, 6, 7])[6] });
      expect(a.decoded).toBe(5 + 1);
      expect(b.decoded).toBe(1 + 1);
      // the head read after them verifies only the record the second wrote, and reads what a cold instance reads
      const r = decodes(() => j.read());
      expect(r.decoded).toBe(1);
      expect(r.value).toEqual({ kind: 'records', records: chainOf([1, 2, 3, 4, 5, 6, 7]), tail: null });
      // and a read of an unchanged file verifies nothing
      expect(decodes(() => j.read())).toEqual({ value: cold(f.dir), decoded: 0 });
    },

    'a same-size rewrite of an earlier record, on the same inode: a full verify, answering as a cold read': () => {
      const rs = chainOf([1, 2, 3]);
      const f = fx(bytesOf(rs));
      const { fmt, decodes } = counting();
      const j = m.chainedJournalFileAt(fmt, f.dir, BASE);
      j.read();
      // record 1's entry changed in place, one byte, the length kept: its journalId no longer matches
      const at1 = lineOf(rs[0]!).indexOf('"n":1');
      expect(at1).toBeGreaterThan(0);
      overwriteInPlace(f.leaf, Buffer.from('"n":7'), at1);
      const r = decodes(() => j.read());
      expect(r.value).toEqual(cold(f.dir));
      expect(r.value).toMatchObject({ kind: 'malformed', code: 'journal-id-mismatch', lines: 3 });
      // a whole valid chain of the same size over the same inode reads as the NEW chain, never the cached one
      overwriteInPlace(f.leaf, bytesOf(chainOf([7, 8, 9])));
      expect(decodes(() => j.read())).toEqual({ value: { kind: 'records', records: chainOf([7, 8, 9]), tail: null }, decoded: 3 });
      // and once it verifies, a same-size rewrite of the head itself is seen too
      overwriteInPlace(f.leaf, bytesOf(chainOf([7, 8, 1])));
      expect(decodes(() => j.read())).toEqual({ value: { kind: 'records', records: chainOf([7, 8, 1]), tail: null }, decoded: 3 });
    },

    'a truncate and regrow to the same size, or shorter and past the head: a full verify, reading the new bytes': () => {
      const f = fx(bytesOf(chainOf([1, 2, 3])));
      const { fmt, decodes } = counting();
      const j = m.chainedJournalFileAt(fmt, f.dir, BASE);
      j.read();
      truncateTo(f.leaf, 0);
      appendFileSync(f.leaf, bytesOf(chainOf([4, 5, 6])));
      expect(decodes(() => j.read())).toEqual({ value: { kind: 'records', records: chainOf([4, 5, 6]), tail: null }, decoded: 3 });
      truncateTo(f.leaf, 10);
      expect(j.read()).toEqual(cold(f.dir));
      appendFileSync(f.leaf, bytesOf(chainOf([1, 2, 3, 4])).subarray(10));
      expect(decodes(() => j.read())).toEqual({ value: { kind: 'records', records: chainOf([1, 2, 3, 4]), tail: null }, decoded: 4 });
    },

    'a rename-swap to another inode, even holding identical bytes: a full verify': () => {
      const rs = chainOf([1, 2, 3]);
      const f = fx(bytesOf(rs));
      const { fmt, decodes } = counting();
      const j = m.chainedJournalFileAt(fmt, f.dir, BASE);
      j.read();
      const swap = path.join(f.dir, 'swap.tmp');
      writeFileSync(swap, bytesOf(rs));
      renameSync(swap, f.leaf);
      expect(decodes(() => j.read())).toEqual({ value: { kind: 'records', records: rs, tail: null }, decoded: 3 });
      const four = chainOf([1, 2, 3, 4]);
      writeFileSync(swap, bytesOf(four));
      renameSync(swap, f.leaf);
      expect(decodes(() => j.read())).toEqual({ value: { kind: 'records', records: four, tail: null }, decoded: 4 });
    },

    'the same inode number reported on another device: a full verify': () => {
      const rs = chainOf([1, 2, 3]);
      const f = fx(bytesOf(rs));
      const shifted = { on: false };
      const leafFds = new Set<number>();
      const ops: AppendOnlyFsOps = {
        ...NODE_APPEND_ONLY_FS,
        openSync(p, flags, mode) {
          const fd = NODE_APPEND_ONLY_FS.openSync(p, flags, mode);
          if (p === f.leaf) leafFds.add(fd); else leafFds.delete(fd);
          return fd;
        },
        fstatSync(fd, o): BigIntStats {
          const st = fstatSync(fd, o);
          if (!shifted.on || !leafFds.has(fd)) return st;
          return Object.assign(Object.create(Object.getPrototypeOf(st) as object) as BigIntStats, st, { dev: st.dev + 1n });
        },
      };
      const { fmt, decodes } = counting();
      const j = m.chainedJournalFileAt(fmt, f.dir, BASE, ops);
      expect(decodes(() => j.read()).decoded).toBe(3);
      expect(decodes(() => j.read()).decoded).toBe(0);
      shifted.on = true;
      expect(decodes(() => j.read())).toEqual({ value: { kind: 'records', records: rs, tail: null }, decoded: 3 });
    },

    'after the head, a record that skips a sequence or names another previous digest answers as a cold read': () => {
      const rs = chainOf([1, 2, 3]);
      const head = rs[2]!;
      const gap = buildChainedRecord<ProbeEntry, ProbeJournalError>(FMT, { sequence: 5, previousDigest: head.digest, acceptedAt: at(5), entry: { kind: 'probe', n: 5 } });
      const fork = buildChainedRecord<ProbeEntry, ProbeJournalError>(FMT, { sequence: 4, previousDigest: rs[1]!.digest, acceptedAt: at(4), entry: { kind: 'probe', n: 4 } });
      for (const [bad, code] of [[gap, 'sequence-gap'], [fork, 'previous-digest']] as const) {
        const f = fx(bytesOf(rs));
        const j = m.chainedJournalFileAt(FMT, f.dir, BASE);
        j.read();
        appendFileSync(f.leaf, lineOf(bad));
        const r = j.read();
        expect(r).toEqual(cold(f.dir));
        expect(r).toMatchObject({ kind: 'malformed', code, lines: 4 });
      }
    },

    'a torn tail after the cached head: read as a cold read reads it, healed by the one cut, then appended after': () => {
      const rs = chainOf([1, 2, 3]);
      const f = fx(bytesOf(rs));
      const { fmt, decodes } = counting();
      const j = m.chainedJournalFileAt(fmt, f.dir, BASE);
      j.read();
      const four = chainOf([1, 2, 3, 4]);
      appendFileSync(f.leaf, lineOf(four[3]!).subarray(0, 25));
      const r = j.read();
      expect(r).toEqual(cold(f.dir));
      expect(r.kind === 'records' && r.tail?.code).toBe('torn-tail');
      // the check sees the tail too, and an append past it refuses `malformed`, appending nothing
      expect(j.appendNext(() => go(4))).toEqual({ ok: false, error: 'malformed', mayApply: false });
      const plan = chainedTailHealPlan(r.kind === 'records' ? r.tail : null, true);
      expect(plan).not.toBeNull();
      expect(j.cutAside({ kind: 'tail', plan: plan! }, ASIDE)).toEqual({ ok: true });
      expect(readFileSync(f.leaf)).toEqual(bytesOf(rs));
      const a = decodes(() => j.appendNext(() => go(4)));
      expect(a).toEqual({ value: { ok: true, record: four[3] }, decoded: 0 + 1 });
      expect(decodes(() => j.read())).toEqual({ value: cold(f.dir), decoded: 1 });
    },

    'never shared: a second instance, on another path to the same inode or on the same path with another format, verifies in full': () => {
      const f = fx(bytesOf(chainOf([1, 2, 3])));
      const { fmt, decodes } = counting();
      m.chainedJournalFileAt(fmt, f.dir, BASE).read();
      const g = fx();
      linkSync(f.leaf, g.leaf);
      expect(decodes(() => m.chainedJournalFileAt(fmt, g.dir, BASE).read()).decoded).toBe(3);
      const strict = { ...FMT, entry: (): never => { throw FMT.fail('bad-field', 'another journal\'s grammar'); } };
      expect(m.chainedJournalFileAt(strict, f.dir, BASE).read()).toMatchObject({ kind: 'malformed', code: 'bad-field' });
    },

    'a process restart: the cache is in memory only, so a fresh instance verifies in full': () => {
      const f = fx(bytesOf(chainOf([1, 2, 3, 4])));
      const { fmt, decodes } = counting();
      const first = m.chainedJournalFileAt(fmt, f.dir, BASE);
      first.read();
      expect(decodes(() => first.read()).decoded).toBe(0);
      expect(decodes(() => m.chainedJournalFileAt(fmt, f.dir, BASE).read()).decoded).toBe(4);
    },

    'a record handed out, from a full verify or a hit, is frozen, so a caller cannot change what the next hit hands back': () => {
      const f = fx(bytesOf(chainOf([1, 2])));
      const j = m.chainedJournalFileAt(FMT, f.dir, BASE);
      appendFileSync(f.leaf, lineOf(chainOf([1, 2, 3])[2]!));
      const cold1 = j.read();
      expect(j.appendNext(() => go(4)).ok).toBe(true);
      const hit = j.read();
      for (const r of [cold1, hit]) {
        const recs = r.kind === 'records' ? r.records : [];
        expect(recs.length).toBeGreaterThan(0);
        expect(() => { (recs as unknown[]).push(null); }).toThrow(TypeError);
        for (const rec of recs) {
          expect(() => { (rec as { sequence: number }).sequence = 9; }).toThrow(TypeError);
          expect(() => { (rec.entry as { n: number }).n = 9; }).toThrow(TypeError);
        }
      }
      expect(j.read()).toEqual(cold(f.dir));
    },
  };
}

const HEAD_HOLDS_SET: MutantSet<Adapter> = {
  modulePath: ADAPTER_TS,
  mutants: [
    { id: 'D1 an empty head holds', old: 'key !== null && key.size > 0 && ', new: 'key !== null && ' },
    { id: 'D2 the device is not compared', old: 'key.dev === leaf.dev && ', new: '' },
    { id: 'D3 the inode is not compared', old: 'key.ino === leaf.ino && ', new: '' },
    { id: 'D4 a file exactly the head\'s length misses', old: 'bytes.length >= key.size', new: 'bytes.length > key.size' },
    { id: 'D5 the digest is not compared', old: '\n    && sha256Hex(bytes.subarray(0, key.size)) === key.sha256;', new: ';' },
    { id: 'D6 the digest leaves out the head\'s LF', old: 'sha256Hex(bytes.subarray(0, key.size)) === key.sha256', new: 'sha256Hex(bytes.subarray(0, key.size - 1)) === key.sha256' },
  ],
  suite: headHoldsSuite,
};

/** The adapter's use of the decision: run by the head-cache test, not a floor row. */
export const HEAD_CACHE_SET: MutantSet<Adapter> = {
  modulePath: ADAPTER_TS,
  mutants: [
    { id: 'A1 the decision is not asked', old: 'verified !== null && verifiedHeadHolds(verified.key, leaf, bytes) ? verified : null', new: 'verified' },
    { id: 'A2 the next sequence is not checked', old: 'first.sequence !== next.sequence || ', new: '' },
    { id: 'A3 the previous digest is not checked', old: ' || first.previousDigest !== next.previousDigest', new: '' },
    { id: 'A4 the next head is chained from the first record', old: 'chainNext(held.records[held.records.length - 1]!)', new: 'chainNext(held.records[0]!)' },
    { id: 'A5 the bytes after the head start one late', old: 'bytes.subarray(held.key.size, cut)', new: 'bytes.subarray(held.key.size + 1, cut)' },
    { id: 'A6 new records are dropped on a hit', old: 'fresh.length === 0 ? held.records :', new: 'true ? held.records :' },
    { id: 'A7 the key never moves past the first head', old: 'held !== null && held.key.size === size ? held.key :', new: 'held !== null ? held.key :' },
    { id: 'A8 the key covers a torn tail', old: 'const size = seen.tail === null ? bytes.length : seen.tail.offset;', new: 'const size = bytes.length;' },
    { id: 'A9 the key names another device', old: '{ dev: leaf.dev, ino: leaf.ino, size,', new: '{ dev: 0n, ino: leaf.ino, size,' },
    { id: 'A10 a full verify hands out records unfrozen', old: 'records: frozen(records), tail', new: 'records, tail' },
    { id: 'A11 a hit hands out new records unfrozen', old: '...fresh.map(frozen)', new: '...fresh' },
    { id: 'A12 a hit hands out an unfrozen list', old: 'Object.freeze([...held.records, ...fresh.map(frozen)])', new: '[...held.records, ...fresh.map(frozen)]' },
  ],
  suite: headCacheSuite,
};

export const CHAINED_JOURNAL_FILE_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [HEAD_HOLDS_KEY]: HEAD_HOLDS_SET as MutantSet<never>,
};
