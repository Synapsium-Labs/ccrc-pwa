// Overlord W1, authority journal plan Task 2 Step 4 (PR A0): the shared chained-journal file adapter
// (`server/src/chainedJournalFile.ts`) and the append-only port's one cut (`server/src/appendOnlyFile.ts#appendOnlyFileAt`'s
// `cutAside`), driven through the kernel's fixture format (`PROBE_JOURNAL_FORMAT`), so nothing here leans on a real journal's
// grammar. Real files under fixture directories (`mkTmp`), never the live HOME; faults are injected through the port's
// fs-operations seam. Also `chainNext`, the kernel's next-record arithmetic.
import { afterEach, describe, expect, it } from 'vitest';
import {
  chmodSync, closeSync, constants as FS, fchmodSync, ftruncateSync, fstatSync, fsyncSync, mkdirSync, openSync, readFileSync, readSync, readdirSync,
  renameSync, statSync, symlinkSync, writeFileSync, writeSync, appendFileSync, type BigIntStats,
} from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  buildChainedRecord, chainNext, chainedTailHealPlan, encodeChainedRecord, parseChainedBytes, type ChainedJournalRecord,
} from '../src/chainedJournal.js';
import { chainedJournalFileAt, wholeCutName, type ChainedFileSeen } from '../src/chainedJournalFile.js';
import { appendOnlyFileAt, NODE_APPEND_ONLY_FS, type AppendOnlyFsOps } from '../src/appendOnlyFile.js';
import { PROBE_JOURNAL_FORMAT, ProbeJournalError, type ProbeEntry } from './sim/chainedJournalSets.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(() => removeTmpFixtures());

const FMT = PROBE_JOURNAL_FORMAT;
const BASE = 'probe.jsonl';
const ASIDE = 'probe-torn';
const at = (n: number): string => `2026-11-15T10:00:${String(n).padStart(2, '0')}.000Z`;
const go = (n: number) => ({ go: { entry: { kind: 'probe', n } as ProbeEntry, acceptedAt: at(n) } });
const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
const cat = (...parts: Uint8Array[]): Buffer => Buffer.concat(parts.map((p) => Buffer.from(p)));

/** `count` records chained from sequence 1, built by the kernel directly (not through the adapter). */
const chain = (count: number): ChainedJournalRecord<ProbeEntry>[] => {
  const out: ChainedJournalRecord<ProbeEntry>[] = [];
  for (let i = 1; i <= count; i++) {
    const prev = out[i - 2];
    out.push(buildChainedRecord(FMT, {
      ...chainNext(prev === undefined ? null : prev), acceptedAt: at(i), entry: { kind: 'probe', n: i },
    }));
  }
  return out;
};
const enc = (r: ChainedJournalRecord<ProbeEntry>): Uint8Array => encodeChainedRecord(FMT, r);

interface Fx { dir: string; leaf: string; aside: string }
const fx = (content?: Uint8Array | string): Fx => {
  const dir = mkTmp('ccrc-chained-file-');
  const leaf = path.join(dir, BASE);
  if (content !== undefined) writeFileSync(leaf, content);
  return { dir, leaf, aside: path.join(dir, ASIDE) };
};

type Fault = Partial<{
  open: (p: string, flags: number) => void;
  write: (label: string, len: number) => number | undefined;
  fsync: (label: string) => void;
  mkdir: (p: string) => void;
  rename: (from: string, to: string) => void;
  /** Runs after the real rename: another writer acting in the window before the truncate. */
  afterRename: (from: string, to: string) => void;
  ftruncate: (label: string) => void;
  /** Runs after the real truncate: another writer acting in the window before the post-proof. */
  afterTruncate: (label: string) => void;
  fstat: (label: string) => void;
  fchmod: (label: string, mode: number) => void;
}>;
/** A tracing fs over all ten operations: each call one word line, by the role of the path it touches. */
const tracing = (f: Fx, fault: Fault = {}): { ops: AppendOnlyFsOps; trace: string[] } => {
  const trace: string[] = [];
  const role = new Map<number, string>();
  const name = (p: string): string => (p === f.dir ? 'dir' : p === f.leaf ? 'leaf' : p === f.aside ? 'aside'
    : p.startsWith(`${f.aside}${path.sep}`) ? `aside/${path.basename(p).endsWith('.partial') ? 'partial' : 'kept'}` : p);
  const ops: AppendOnlyFsOps = {
    openSync(p, flags, mode) {
      trace.push(`open ${name(p)}`);
      let fd: number;
      try {
        fault.open?.(p, flags);
        fd = openSync(p, flags, mode);
      } catch (err) {
        trace[trace.length - 1] = `failed-open ${name(p)}`;
        throw err;
      }
      role.set(fd, name(p));
      return fd;
    },
    fstatSync: (fd, o): BigIntStats => { fault.fstat?.(role.get(fd) ?? ''); return fstatSync(fd, o); },
    readSync: (fd, b, o, l, p) => readSync(fd, b, o, l, p),
    writeSync(fd, b, o, l) {
      trace.push(`write ${role.get(fd)}`);
      const forced = fault.write?.(role.get(fd) ?? '', l);
      return forced !== undefined ? forced : writeSync(fd, b, o, l);
    },
    fsyncSync(fd) { trace.push(`fsync ${role.get(fd)}`); fault.fsync?.(role.get(fd) ?? ''); fsyncSync(fd); },
    closeSync(fd) { trace.push(`close ${role.get(fd)}`); closeSync(fd); },
    ftruncateSync(fd, len) {
      trace.push(`ftruncate ${role.get(fd)} ${len}`);
      fault.ftruncate?.(role.get(fd) ?? '');
      ftruncateSync(fd, len);
      fault.afterTruncate?.(role.get(fd) ?? '');
    },
    mkdirSync(p, mode) { trace.push(`mkdir ${name(p)} ${mode.toString(8)}`); fault.mkdir?.(p); mkdirSync(p, mode); },
    renameSync(from, to) {
      trace.push(`rename ${name(from)} ${name(to)}`);
      fault.rename?.(from, to);
      renameSync(from, to);
      fault.afterRename?.(from, to);
    },
    fchmodSync(fd, mode) { trace.push(`fchmod ${role.get(fd)} ${mode.toString(8)}`); fault.fchmod?.(role.get(fd) ?? '', mode); fchmodSync(fd, mode); },
  };
  return { ops, trace };
};
const errno = (code: string): Error => Object.assign(new Error(code), { code });
/** Every open has a matching close. */
const balanced = (trace: readonly string[]): void => {
  expect(trace.filter((t) => t.startsWith('open ')).length).toBe(trace.filter((t) => t.startsWith('close ')).length);
};

describe('chainNext: the next record from a head', () => {
  it('before the first record: sequence 1, no previous digest', () => {
    expect(chainNext(null)).toEqual({ sequence: 1, previousDigest: null });
  });
  it('after a head: its sequence plus one, and its digest', () => {
    expect(chainNext({ sequence: 41, journalId: 'a'.repeat(64), digest: 'b'.repeat(64) })).toEqual({ sequence: 42, previousDigest: 'b'.repeat(64) });
  });
});

describe('read: each kind', () => {
  it('absent: no file; and a read holds no snapshot (every descriptor closed)', () => {
    const f = fx();
    const { ops, trace } = tracing(f);
    expect(chainedJournalFileAt(FMT, f.dir, BASE, ops).read()).toEqual({ kind: 'absent' });
    balanced(trace);
  });

  it('records: an empty file is no records and no tail; two records read back in order', () => {
    expect(chainedJournalFileAt(FMT, fx('').dir, BASE).read()).toEqual({ kind: 'records', records: [], tail: null });
    const rs = chain(2);
    const f = fx(cat(enc(rs[0]!), enc(rs[1]!)));
    const { ops, trace } = tracing(f);
    expect(chainedJournalFileAt(FMT, f.dir, BASE, ops).read()).toEqual({ kind: 'records', records: rs, tail: null });
    balanced(trace);
  });

  it('records with a torn tail: the bytes after the last LF, their offset, SHA-256 and code', () => {
    const rs = chain(2);
    const torn = enc(rs[1]!).subarray(0, 20);
    const f = fx(cat(enc(rs[0]!), torn));
    const r = chainedJournalFileAt(FMT, f.dir, BASE).read();
    expect(r).toEqual({
      kind: 'records', records: [rs[0]],
      tail: { offset: enc(rs[0]!).length, bytes: new Uint8Array(torn), sha256: sha(torn), code: 'torn-tail' },
    });
    const whole = enc(rs[1]!);
    const noLf = fx(cat(enc(rs[0]!), whole.subarray(0, whole.length - 1)));
    const r2 = chainedJournalFileAt(FMT, noLf.dir, BASE).read();
    expect(r2.kind === 'records' && r2.tail?.code).toBe('missing-final-lf');
  });

  it('malformed: the kernel\'s code and message, and lines counts every LF byte', () => {
    const rs = chain(3);
    const f = fx(cat(enc(rs[0]!), enc(rs[2]!), enc(rs[1]!)));
    const r = chainedJournalFileAt(FMT, f.dir, BASE).read();
    expect(r).toEqual({ kind: 'malformed', code: 'sequence-gap', detail: 'probe journal sequence-gap: sequence 3 follows 1', lines: 3 });
    const bom = fx(cat(new Uint8Array([0xef, 0xbb, 0xbf]), enc(rs[0]!)));
    expect(chainedJournalFileAt(FMT, bom.dir, BASE).read()).toMatchObject({ kind: 'malformed', code: 'bom', lines: 1 });
    // a journal that does not begin at sequence 1 is malformed: none of these is ever compacted
    const late = fx(enc(rs[1]!));
    expect(chainedJournalFileAt(FMT, late.dir, BASE).read()).toMatchObject({ kind: 'malformed', code: 'sequence-start', lines: 1 });
    // lines counts the LF bytes of the whole file, a torn tail's included
    const tail = fx(cat(enc(rs[1]!), new TextEncoder().encode('x\ny')));
    expect(chainedJournalFileAt(FMT, tail.dir, BASE).read()).toMatchObject({ kind: 'malformed', lines: 2 });
  });

  it('unmeasured: a missing directory, or a symlinked file, is unreadable and never absent', () => {
    const f = fx();
    expect(chainedJournalFileAt(FMT, path.join(f.dir, 'nope'), BASE).read()).toEqual({ kind: 'unmeasured', why: 'unreadable' });
    const target = path.join(f.dir, 'target');
    writeFileSync(target, enc(chain(1)[0]!));
    symlinkSync(target, f.leaf);
    expect(chainedJournalFileAt(FMT, f.dir, BASE).read()).toEqual({ kind: 'unmeasured', why: 'unreadable' });
  });

  it('a defect that is not the format\'s refusal is rethrown, never read as malformed', () => {
    const f = fx(enc(chain(1)[0]!));
    const throwing = { ...FMT, entry: (): never => { throw new TypeError('a grammar defect'); } };
    expect(() => chainedJournalFileAt(throwing, f.dir, BASE).read()).toThrow(TypeError);
  });
});

describe('appendNext: re-read and verify on every call', () => {
  it('two records appended in a row, each through its own appendNext, chain; the second re-reads the file and sees the first', () => {
    const f = fx();
    const j = chainedJournalFileAt(FMT, f.dir, BASE);
    const seen: ChainedFileSeen<ProbeEntry>[] = [];
    const a = j.appendNext((s) => { seen.push(s); return go(1); });
    const b = j.appendNext((s) => { seen.push(s); return go(2); });
    const rs = chain(2);
    expect(a).toEqual({ ok: true, record: rs[0] });
    expect(b).toEqual({ ok: true, record: rs[1] });
    expect(seen).toEqual([{ kind: 'absent' }, { kind: 'records', records: [rs[0]], tail: null }]);
    expect(readFileSync(f.leaf).equals(cat(enc(rs[0]!), enc(rs[1]!)))).toBe(true);
    expect(parseChainedBytes(FMT, readFileSync(f.leaf), { completeFromStart: true })).toEqual(rs);
  });

  it('a file changed between two calls is read afresh: the next record follows what the file now holds, not an old head', () => {
    const f = fx();
    const j = chainedJournalFileAt(FMT, f.dir, BASE);
    expect(j.appendNext(() => go(1))).toMatchObject({ ok: true });
    const rs = chain(3);
    appendFileSync(f.leaf, enc(rs[1]!)); // another writer's record 2, between the calls
    const r = j.appendNext((s) => { expect(s).toEqual({ kind: 'records', records: [rs[0], rs[1]], tail: null }); return go(3); });
    expect(r).toEqual({ ok: true, record: rs[2] });
    expect(readFileSync(f.leaf).equals(cat(enc(rs[0]!), enc(rs[1]!), enc(rs[2]!)))).toBe(true);
  });

  it('check sees the verified head and can stop: nothing is appended, its answer comes back, and no descriptor stays open', () => {
    const rs = chain(1);
    const f = fx(enc(rs[0]!));
    const { ops, trace } = tracing(f);
    const r = chainedJournalFileAt(FMT, f.dir, BASE, ops).appendNext((s) => {
      expect(s.kind === 'records' && s.records.at(-1)?.digest).toBe(rs[0]!.digest);
      return { stop: 'head-row-behind' as const };
    });
    expect(r).toEqual({ ok: false, stopped: 'head-row-behind' });
    expect(readFileSync(f.leaf).equals(Buffer.from(enc(rs[0]!)))).toBe(true);
    expect(trace.some((t) => t.startsWith('write'))).toBe(false);
    balanced(trace);
  });

  it('a check that throws releases the snapshot and rethrows', () => {
    const f = fx(enc(chain(1)[0]!));
    const { ops, trace } = tracing(f);
    expect(() => chainedJournalFileAt(FMT, f.dir, BASE, ops).appendNext(() => { throw new Error('boom'); })).toThrow('boom');
    balanced(trace);
  });

  it('go over a malformed file, or one ending in a torn tail, is malformed before any write; check still sees it', () => {
    const rs = chain(3);
    const bad = fx(cat(enc(rs[0]!), enc(rs[2]!)));
    const seen: string[] = [];
    expect(chainedJournalFileAt(FMT, bad.dir, BASE).appendNext((s) => { seen.push(s.kind); return go(9); }))
      .toEqual({ ok: false, error: 'malformed', mayApply: false });
    expect(seen).toEqual(['malformed']);
    const tornBytes = cat(enc(rs[0]!), enc(rs[1]!).subarray(0, 9));
    const torn = fx(tornBytes);
    expect(chainedJournalFileAt(FMT, torn.dir, BASE).appendNext(() => go(2))).toEqual({ ok: false, error: 'malformed', mayApply: false });
    expect(readFileSync(torn.leaf).equals(tornBytes)).toBe(true);
  });

  it('an unreadable file answers unreadable before check runs, with mayApply false', () => {
    const f = fx();
    let asked = false;
    expect(chainedJournalFileAt(FMT, path.join(f.dir, 'nope'), BASE).appendNext(() => { asked = true; return go(1); }))
      .toEqual({ ok: false, error: 'unreadable', mayApply: false });
    expect(asked).toBe(false);
  });

  it('the port\'s failures once the append is entered carry mayApply true: a failed fsync is durability', () => {
    const f = fx();
    const { ops } = tracing(f, { fsync: (l) => { if (l === 'leaf') throw errno('EIO'); } });
    expect(chainedJournalFileAt(FMT, f.dir, BASE, ops).appendNext(() => go(1))).toEqual({ ok: false, error: 'durability', mayApply: true });
  });

  it('a file changed inside the call, after the read, is changed with mayApply true, and the change stands', () => {
    const rs = chain(2);
    const f = fx(enc(rs[0]!));
    const r = chainedJournalFileAt(FMT, f.dir, BASE).appendNext(() => { appendFileSync(f.leaf, enc(rs[1]!)); return go(2); });
    expect(r).toEqual({ ok: false, error: 'changed', mayApply: true });
    expect(readFileSync(f.leaf).equals(cat(enc(rs[0]!), enc(rs[1]!)))).toBe(true);
  });
});

describe('cutAside: the one cut', () => {
  const tornFile = (): { f: Fx; rs: ChainedJournalRecord<ProbeEntry>[]; torn: Uint8Array; all: Buffer } => {
    const rs = chain(2);
    const torn = enc(rs[1]!).subarray(0, 17);
    const all = cat(enc(rs[0]!), torn);
    return { f: fx(all), rs, torn, all };
  };
  const planOf = (j: ReturnType<typeof chainedJournalFileAt<ProbeEntry, ProbeJournalError>>) => {
    const r = j.read();
    if (r.kind !== 'records') throw new Error(`not records: ${r.kind}`);
    const plan = chainedTailHealPlan(r.tail, true);
    if (plan === null) throw new Error('no plan');
    return plan;
  };

  it('a tail plan keeps the torn bytes in a directory it creates (mode 0700) under the plan\'s name, and truncates', () => {
    const { f, rs, torn } = tornFile();
    const j = chainedJournalFileAt(FMT, f.dir, BASE);
    const plan = planOf(j);
    expect(j.cutAside({ kind: 'tail', plan }, ASIDE)).toEqual({ ok: true });
    expect(statSync(f.aside).mode & 0o777).toBe(0o700);
    expect(readdirSync(f.aside)).toEqual([plan.name]);
    expect(readFileSync(path.join(f.aside, plan.name)).equals(Buffer.from(torn))).toBe(true);
    expect(readFileSync(f.leaf).equals(Buffer.from(enc(rs[0]!)))).toBe(true);
    expect(j.read()).toEqual({ kind: 'records', records: [rs[0]], tail: null });
    // the same plan again finds no tail: changed, before any cut
    expect(j.cutAside({ kind: 'tail', plan }, ASIDE)).toEqual({ ok: false, error: 'changed', mayApply: false });
  });

  it('the call order: no kept file yet, kept bytes written, fsynced and renamed, the quarantine path re-proved, both directories fsynced, then the truncate, the file and the parent', () => {
    const { f } = tornFile();
    const { ops, trace } = tracing(f);
    const j = chainedJournalFileAt(FMT, f.dir, BASE, ops);
    const plan = planOf(j);
    const mark = trace.length;
    expect(j.cutAside({ kind: 'tail', plan }, ASIDE)).toEqual({ ok: true });
    // the re-proofs' opens and closes of the parent and the leaf are left out: what is pinned is the order of the effects
    const t = trace.slice(mark).filter((x) => /^(mkdir|rename|ftruncate|fsync|write)/.test(x) || x.includes('aside'));
    expect(t).toEqual([
      'mkdir aside 700', 'open aside', 'failed-open aside/kept',
      'open aside/partial', 'write aside/partial', 'fsync aside/partial', 'close aside/partial',
      'rename aside/partial aside/kept', 'open aside', 'close aside', 'fsync aside', 'fsync dir',
      `ftruncate leaf ${plan.offset}`, 'fsync leaf', 'fsync dir',
      'close aside',
    ]);
    balanced(trace);
  });

  it('whole keeps every byte under its content-addressed name and leaves an empty file, even a malformed one', () => {
    const rs = chain(3);
    const bytes = cat(enc(rs[0]!), enc(rs[2]!), new TextEncoder().encode('torn'));
    const f = fx(bytes);
    const j = chainedJournalFileAt(FMT, f.dir, BASE);
    expect(j.read().kind).toBe('malformed');
    expect(j.cutAside({ kind: 'whole' }, ASIDE)).toEqual({ ok: true });
    const name = `${bytes.length}-${sha(bytes)}.whole`;
    expect(wholeCutName(bytes)).toBe(name);
    expect(readdirSync(f.aside)).toEqual([name]);
    expect(readFileSync(path.join(f.aside, name)).equals(bytes)).toBe(true);
    expect(readFileSync(f.leaf).length).toBe(0);
    expect(j.read()).toEqual({ kind: 'records', records: [], tail: null });
    // a new chain starts at record 1
    expect(j.appendNext(() => go(1))).toEqual({ ok: true, record: chain(1)[0] });
  });

  it('two whole cuts of different bytes keep two files; the same bytes again are an idempotent retry', () => {
    const f = fx('first\n');
    const j = chainedJournalFileAt(FMT, f.dir, BASE);
    expect(j.cutAside({ kind: 'whole' }, ASIDE)).toEqual({ ok: true });
    writeFileSync(f.leaf, 'second\n');
    expect(j.cutAside({ kind: 'whole' }, ASIDE)).toEqual({ ok: true });
    writeFileSync(f.leaf, 'first\n');
    expect(j.cutAside({ kind: 'whole' }, ASIDE)).toEqual({ ok: true });
    const names = [wholeCutName(Buffer.from('first\n')), wholeCutName(Buffer.from('second\n'))].sort();
    expect(readdirSync(f.aside).sort()).toEqual(names);
    expect(readFileSync(path.join(f.aside, wholeCutName(Buffer.from('first\n'))), 'utf8')).toBe('first\n');
    expect(readFileSync(path.join(f.aside, wholeCutName(Buffer.from('second\n'))), 'utf8')).toBe('second\n');
    expect(readFileSync(f.leaf).length).toBe(0);
  });

  it('an existing quarantine directory is reused and set to 0700 through its descriptor; a symlink at its name is unwritable', () => {
    const { f, torn } = tornFile();
    mkdirSync(f.aside, 0o755);
    chmodSync(f.aside, 0o755);
    const j = chainedJournalFileAt(FMT, f.dir, BASE);
    const plan = planOf(j);
    expect(j.cutAside({ kind: 'tail', plan }, ASIDE)).toEqual({ ok: true });
    expect(statSync(f.aside).mode & 0o777).toBe(0o700);
    expect(readFileSync(path.join(f.aside, plan.name)).equals(Buffer.from(torn))).toBe(true);

    const second = tornFile();
    const elsewhere = path.join(second.f.dir, 'elsewhere');
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, second.f.aside);
    const j2 = chainedJournalFileAt(FMT, second.f.dir, BASE);
    expect(j2.cutAside({ kind: 'tail', plan: planOf(j2) }, ASIDE)).toEqual({ ok: false, error: 'unwritable', mayApply: true });
    expect(readdirSync(elsewhere)).toEqual([]);
    expect(readFileSync(second.f.leaf).equals(second.all)).toBe(true);
  });

  it('a tail plan the file no longer matches is changed, before any cut', () => {
    const { f, all } = tornFile();
    const j = chainedJournalFileAt(FMT, f.dir, BASE);
    const plan = planOf(j);
    appendFileSync(f.leaf, 'more');
    expect(j.cutAside({ kind: 'tail', plan }, ASIDE)).toEqual({ ok: false, error: 'changed', mayApply: false });
    expect(readFileSync(f.leaf).equals(Buffer.concat([all, Buffer.from('more')]))).toBe(true);
    expect(() => statSync(f.aside)).toThrow();
  });

  it('an absent file is changed, and an unreadable one unreadable, both with mayApply false', () => {
    const f = fx();
    const plan = { offset: 0, bytes: 1, sha256: 'a'.repeat(64), code: 'torn-tail' as const, name: 'x.tail' };
    expect(chainedJournalFileAt(FMT, f.dir, BASE).cutAside({ kind: 'tail', plan }, ASIDE)).toEqual({ ok: false, error: 'changed', mayApply: false });
    expect(chainedJournalFileAt(FMT, path.join(f.dir, 'nope'), BASE).cutAside({ kind: 'whole' }, ASIDE))
      .toEqual({ ok: false, error: 'unreadable', mayApply: false });
  });

  // Each step's fault answers its word with mayApply true; every one before the truncate leaves the journal's bytes whole.
  let asideOpens = 0;
  const firstAsideOpen = (code: string) => (p: string): void => { if (p.endsWith(ASIDE) && asideOpens++ === 0) throw errno(code); };
  const opensWith = (want: (p: string, flags: number) => boolean, code: string) => (p: string, flags: number): void => {
    if (want(p, flags)) throw errno(code);
  };
  const cutOpen = (p: string, flags: number): boolean => p.endsWith(BASE) && (flags & FS.O_RDWR) !== 0 && (flags & FS.O_APPEND) === 0;
  let cutDone = false;
  const STEPS: readonly (readonly [string, Fault, string, boolean])[] = [
    ['the directory\'s create (EACCES)', { mkdir: () => { throw errno('EACCES'); } }, 'unwritable', true],
    ['the directory\'s create (ENOSPC)', { mkdir: () => { throw errno('ENOSPC'); } }, 'unwritable', true],
    ['the directory\'s create (EDQUOT)', { mkdir: () => { throw errno('EDQUOT'); } }, 'unwritable', true],
    ['the directory\'s create (EIO)', { mkdir: () => { throw errno('EIO'); } }, 'unreadable', true],
    ['the directory\'s open (EACCES)', { open: firstAsideOpen('EACCES') }, 'unwritable', true],
    ['the directory\'s open (EIO)', { open: firstAsideOpen('EIO') }, 'unreadable', true],
    ['the directory\'s fchmod', { mkdir: (p) => { mkdirSync(p, 0o755); chmodSync(p, 0o755); throw errno('EEXIST'); }, fchmod: (l) => { if (l === 'aside') throw errno('EPERM'); } }, 'unwritable', true],
    ['the kept file\'s open (EACCES)', { open: opensWith((p) => p.endsWith('.partial'), 'EACCES') }, 'unwritable', true],
    ['the kept file\'s open (ENOSPC)', { open: opensWith((p) => p.endsWith('.partial'), 'ENOSPC') }, 'unwritable', true],
    ['the kept file\'s open (EIO)', { open: opensWith((p) => p.endsWith('.partial'), 'EIO') }, 'unreadable', true],
    ['the kept file\'s write', { write: (l) => (l === 'aside/partial' ? 0 : undefined) }, 'unwritable', true],
    ['the kept file\'s fsync', { fsync: (l) => { if (l === 'aside/partial') throw errno('EIO'); } }, 'durability', true],
    ['the rename into place', { rename: () => { throw errno('EIO'); } }, 'unwritable', true],
    ['the quarantine directory\'s fsync', { fsync: (l) => { if (l === 'aside') throw errno('EIO'); } }, 'durability', true],
    ['the parent\'s fsync before the truncate', { fsync: (l) => { if (l === 'dir') throw errno('EIO'); } }, 'durability', true],
    ['the leaf\'s open for the cut (EIO)', { open: opensWith(cutOpen, 'EIO') }, 'unreadable', true],
    ['the truncate', { ftruncate: () => { throw errno('EIO'); } }, 'unwritable', true],
    ['the file\'s fsync after the truncate', { fsync: (l) => { if (l === 'leaf') throw errno('EIO'); } }, 'durability', false],
    ['the post-proof\'s open', { ftruncate: () => { cutDone = true; }, open: (p) => { if (cutDone && p.endsWith(BASE)) throw errno('EIO'); } }, 'unreadable', false],
  ];
  for (const [what, fault, word, whole] of STEPS) {
    it(`a failure at ${what} is ${word}, with mayApply`, () => {
      asideOpens = 0;
      cutDone = false;
      const { f, all, rs } = tornFile();
      const plan = planOf(chainedJournalFileAt(FMT, f.dir, BASE));
      const { ops, trace } = tracing(f, fault);
      expect(chainedJournalFileAt(FMT, f.dir, BASE, ops).cutAside({ kind: 'tail', plan }, ASIDE)).toEqual({ ok: false, error: word, mayApply: true });
      expect(readFileSync(f.leaf).equals(whole ? all : Buffer.from(enc(rs[0]!)))).toBe(true);
      balanced(trace);
    });
  }

  it('a failure at the parent\'s fsync after the truncate is durability, with mayApply', () => {
    const { f } = tornFile();
    const plan = planOf(chainedJournalFileAt(FMT, f.dir, BASE));
    let truncated = false;
    const { ops } = tracing(f, {
      ftruncate: () => { truncated = true; },
      fsync: (l) => { if (l === 'dir' && truncated) throw errno('EIO'); },
    });
    expect(chainedJournalFileAt(FMT, f.dir, BASE, ops).cutAside({ kind: 'tail', plan }, ASIDE)).toEqual({ ok: false, error: 'durability', mayApply: true });
  });

  // Another writer in the windows the cut re-proves: each answers `changed`, and nothing it wrote is cut away.
  const cutWith = (f: Fx, fault: Fault): unknown => {
    const plan = planOf(chainedJournalFileAt(FMT, f.dir, BASE));
    return chainedJournalFileAt(FMT, f.dir, BASE, tracing(f, fault).ops).cutAside({ kind: 'tail', plan }, ASIDE);
  };
  const replaceLeaf = (f: Fx, bytes: Uint8Array): void => {
    const other = path.join(f.dir, 'other');
    writeFileSync(other, bytes);
    renameSync(other, f.leaf);
  };
  const CHANGED = { ok: false, error: 'changed', mayApply: true };

  it('an append to the leaf after the rename (before the truncate) is changed, and the file is untouched', () => {
    const { f, all } = tornFile();
    expect(cutWith(f, { afterRename: () => appendFileSync(f.leaf, 'late\n') })).toEqual(CHANGED);
    expect(readFileSync(f.leaf).equals(Buffer.concat([all, Buffer.from('late\n')]))).toBe(true);
  });

  it('the leaf replaced after the rename, by the same bytes, is changed, and the replacement is untouched', () => {
    const { f, all } = tornFile();
    expect(cutWith(f, { afterRename: () => replaceLeaf(f, all) })).toEqual(CHANGED);
    expect(readFileSync(f.leaf).equals(all)).toBe(true);
  });

  it('the leaf replaced by a symlink after the rename is changed at the cut\'s open (ELOOP), and nothing is truncated', () => {
    const { f, all } = tornFile();
    const copy = path.join(f.dir, 'copy');
    writeFileSync(copy, all);
    expect(cutWith(f, { afterRename: () => { renameSync(f.leaf, path.join(f.dir, 'was')); symlinkSync(copy, f.leaf); } })).toEqual(CHANGED);
    expect(readFileSync(copy).equals(all)).toBe(true);
  });

  it('an append between the compare and the truncate is caught by the size check: changed, and the appended bytes stand', () => {
    const { f, all } = tornFile();
    let renamed = false;
    let leafStats = 0;
    expect(cutWith(f, {
      afterRename: () => { renamed = true; },
      fstat: (l) => { if (renamed && l === 'leaf' && ++leafStats === 2) appendFileSync(f.leaf, 'late\n'); },
    })).toEqual(CHANGED);
    expect(readFileSync(f.leaf).equals(Buffer.concat([all, Buffer.from('late\n')]))).toBe(true);
  });

  it('an append after the truncate is changed by the post-proof, and the appended bytes stand', () => {
    const { f, rs } = tornFile();
    expect(cutWith(f, { afterTruncate: () => appendFileSync(f.leaf, 'late\n') })).toEqual(CHANGED);
    expect(readFileSync(f.leaf).equals(Buffer.concat([Buffer.from(enc(rs[0]!)), Buffer.from('late\n')]))).toBe(true);
  });

  it('the leaf replaced after the truncate, by the cut bytes, is changed by the post-proof\'s identity check', () => {
    const { f, rs } = tornFile();
    expect(cutWith(f, { afterTruncate: () => replaceLeaf(f, enc(rs[0]!)) })).toEqual(CHANGED);
  });

  it('the quarantine directory swapped after the rename is changed, and nothing is truncated', () => {
    const { f, all } = tornFile();
    expect(cutWith(f, { afterRename: () => { renameSync(f.aside, `${f.aside}-moved`); mkdirSync(f.aside); } })).toEqual(CHANGED);
    expect(readFileSync(f.leaf).equals(all)).toBe(true);
  });

  it('a leftover temporary file keeps no wider mode: the kept file is 0600; a failed fchmod of it is unwritable', () => {
    const { f, all } = tornFile();
    const plan = planOf(chainedJournalFileAt(FMT, f.dir, BASE));
    mkdirSync(f.aside, 0o700);
    writeFileSync(path.join(f.aside, `${plan.name}.partial`), 'stale', { mode: 0o644 });
    chmodSync(path.join(f.aside, `${plan.name}.partial`), 0o644);
    expect(chainedJournalFileAt(FMT, f.dir, BASE, tracing(f, { fchmod: () => { throw errno('EPERM'); } }).ops).cutAside({ kind: 'tail', plan }, ASIDE))
      .toEqual({ ok: false, error: 'unwritable', mayApply: true });
    expect(readFileSync(f.leaf).equals(all)).toBe(true);
    expect(chainedJournalFileAt(FMT, f.dir, BASE).cutAside({ kind: 'tail', plan }, ASIDE)).toEqual({ ok: true });
    expect(statSync(path.join(f.aside, plan.name)).mode & 0o777).toBe(0o600);
  });

  it('a temporary name that is a directory, a kept name that is a directory, and one that is a symlink are each unwritable', () => {
    for (const plant of ['partial-dir', 'kept-dir', 'kept-link'] as const) {
      const { f, all } = tornFile();
      const plan = planOf(chainedJournalFileAt(FMT, f.dir, BASE));
      mkdirSync(f.aside, 0o700);
      if (plant === 'partial-dir') mkdirSync(path.join(f.aside, `${plan.name}.partial`));
      if (plant === 'kept-dir') mkdirSync(path.join(f.aside, plan.name));
      if (plant === 'kept-link') symlinkSync(path.join(f.dir, 'nowhere'), path.join(f.aside, plan.name));
      expect(chainedJournalFileAt(FMT, f.dir, BASE).cutAside({ kind: 'tail', plan }, ASIDE), plant).toEqual({ ok: false, error: 'unwritable', mayApply: true });
      expect(readFileSync(f.leaf).equals(all), plant).toBe(true);
    }
  });
});

describe('the port\'s cut operation', () => {
  it('refuses a spent snapshot, a released one and a foreign one, cutting nothing', () => {
    const bytes = cat(enc(chain(1)[0]!), new TextEncoder().encode('torn'));
    const f = fx(bytes);
    const file = appendOnlyFileAt(f.dir, BASE);
    const cut = { offset: bytes.length - 4, asideDir: ASIDE, asideName: 'x.tail' };
    const spent = file.read();
    if (!spent.ok) throw new Error('read');
    expect(file.cutAside(spent.snapshot, { ...cut, offset: bytes.length })).toEqual({ ok: true });
    expect(file.cutAside(spent.snapshot, cut)).toEqual({ ok: false, error: 'unreadable', mayApply: true });
    const released = file.read();
    if (!released.ok) throw new Error('read');
    released.snapshot.release();
    expect(file.cutAside(released.snapshot, cut)).toEqual({ ok: false, error: 'unreadable', mayApply: true });
    const foreign = appendOnlyFileAt(f.dir, BASE).read();
    if (!foreign.ok) throw new Error('read');
    expect(file.cutAside(foreign.snapshot, cut)).toEqual({ ok: false, error: 'unreadable', mayApply: true });
    foreign.snapshot.release();
    expect(readFileSync(f.leaf).equals(bytes)).toBe(true);
  });

  it('an append spends the snapshot for a cut, and a cut spends it for an append', () => {
    const f = fx('a\n');
    const file = appendOnlyFileAt(f.dir, BASE);
    const r = file.read();
    if (!r.ok) throw new Error('read');
    expect(file.appendLine(r.snapshot, new TextEncoder().encode('b\n'))).toEqual({ ok: true });
    expect(file.cutAside(r.snapshot, { offset: 0, asideDir: ASIDE, asideName: 'w' })).toEqual({ ok: false, error: 'unreadable', mayApply: true });
    const r2 = file.read();
    if (!r2.ok) throw new Error('read');
    expect(file.cutAside(r2.snapshot, { offset: 2, asideDir: ASIDE, asideName: 'w' })).toEqual({ ok: true });
    expect(file.appendLine(r2.snapshot, new TextEncoder().encode('c\n'))).toEqual({ ok: false, error: 'unreadable', mayApply: true });
    expect(readFileSync(f.leaf, 'utf8')).toBe('a\n');
    expect(readFileSync(path.join(f.aside, 'w'), 'utf8')).toBe('b\n');
  });

  it('a kept name that holds other bytes is changed and is never replaced; the same bytes are an idempotent retry', () => {
    const f = fx('a\nb\n');
    const file = appendOnlyFileAt(f.dir, BASE);
    mkdirSync(f.aside, 0o700);
    writeFileSync(path.join(f.aside, 'w'), 'other\n');
    const r = file.read();
    if (!r.ok) throw new Error('read');
    expect(file.cutAside(r.snapshot, { offset: 2, asideDir: ASIDE, asideName: 'w' })).toEqual({ ok: false, error: 'changed', mayApply: true });
    expect(readFileSync(path.join(f.aside, 'w'), 'utf8')).toBe('other\n');
    expect(readFileSync(f.leaf, 'utf8')).toBe('a\nb\n');
    writeFileSync(path.join(f.aside, 'w'), 'b\n');
    const r2 = file.read();
    if (!r2.ok) throw new Error('read');
    expect(file.cutAside(r2.snapshot, { offset: 2, asideDir: ASIDE, asideName: 'w' })).toEqual({ ok: true });
    expect(readFileSync(path.join(f.aside, 'w'), 'utf8')).toBe('b\n');
    expect(readFileSync(f.leaf, 'utf8')).toBe('a\n');
  });

  it('a file changed since the snapshot is changed, before anything is created', () => {
    const f = fx('a\nb');
    const file = appendOnlyFileAt(f.dir, BASE);
    const r = file.read();
    if (!r.ok) throw new Error('read');
    appendFileSync(f.leaf, 'c');
    expect(file.cutAside(r.snapshot, { offset: 2, asideDir: ASIDE, asideName: 'w' })).toEqual({ ok: false, error: 'changed', mayApply: true });
    expect(() => statSync(f.aside)).toThrow();
    expect(readFileSync(f.leaf, 'utf8')).toBe('a\nbc');
  });

  it('refuses arguments outside its contract as a RangeError before any I/O, and spends the snapshot first', () => {
    const f = fx('a\n');
    const file = appendOnlyFileAt(f.dir, BASE);
    const line = new TextEncoder().encode('b\n');
    for (const bad of [
      { offset: -1, asideDir: ASIDE, asideName: 'w' }, { offset: 3, asideDir: ASIDE, asideName: 'w' },
      { offset: 0.5, asideDir: ASIDE, asideName: 'w' }, { offset: 0, asideDir: '../out', asideName: 'w' },
      { offset: 0, asideDir: ASIDE, asideName: 'a/b' }, { offset: 0, asideDir: '..', asideName: 'w' },
      { offset: 0, asideDir: ASIDE, asideName: '' }, { offset: 0, asideDir: ASIDE, asideName: 'w.partial' },
    ]) {
      const r = file.read();
      if (!r.ok) throw new Error('read');
      expect(() => file.cutAside(r.snapshot, bad), JSON.stringify(bad)).toThrow(RangeError);
      expect(file.appendLine(r.snapshot, line), JSON.stringify(bad)).toEqual({ ok: false, error: 'unreadable', mayApply: true });
    }
    expect(() => statSync(f.aside)).toThrow();
    const missing = appendOnlyFileAt(f.dir, 'missing');
    const absent = missing.read();
    if (!absent.ok) throw new Error('read');
    expect(() => missing.cutAside(absent.snapshot, { offset: 0, asideDir: ASIDE, asideName: 'w' })).toThrow(RangeError);
    expect(missing.appendLine(absent.snapshot, line)).toEqual({ ok: false, error: 'unreadable', mayApply: true });
    expect(readFileSync(f.leaf, 'utf8')).toBe('a\n');
  });

  it('the default fs operations are node:fs', () => {
    expect(Object.keys(NODE_APPEND_ONLY_FS).sort()).toEqual([
      'closeSync', 'fchmodSync', 'fstatSync', 'fsyncSync', 'ftruncateSync', 'mkdirSync', 'openSync', 'readSync', 'renameSync', 'writeSync',
    ]);
    expect(FS.O_NOFOLLOW).toBeGreaterThan(0);
  });
});
