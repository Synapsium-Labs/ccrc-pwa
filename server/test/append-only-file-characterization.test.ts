// Overlord W1, authority journal plan Task 2 Step 1 (PR A0): a characterization of the landing journal adapter's FILE
// behaviour, written and green on `main` before its mechanics move into the byte-level append-only port
// (`server/src/appendOnlyFile.ts`), and unchanged after: the move commit may edit only this file's imports, and an intended
// behaviour change is a commit of its own.
//
// Every expected value is a LITERAL measured on `main` and pasted in. The file reaches the code only through
// `createLandingJournal` and its fs-operations seam (`LandingJournalFsOps`), so it pins what the landing port's callers and
// the operating system can see: the open flags of each mode, the exact order of every call (open, fstat, read, write,
// fsync, close) by the path it touches, the short-write loop and the zero-byte refusal, each failure word with `mayApply`,
// the replaced, symlinked and spent cases, an empty file, a byte-order mark, invalid UTF-8 (the fatal decode), and the exact
// bytes appended for a record. Fixture directories only (`mkTmp`), never the live HOME.
import { afterEach, describe, expect, it } from 'vitest';
import {
  closeSync, constants as FS, fstatSync, fsyncSync, openSync, readFileSync, readSync, renameSync, statSync, symlinkSync,
  writeFileSync, writeSync, type BigIntStats,
} from 'node:fs';
import path from 'node:path';
import type { LandingJournalRecord } from '../../shared/landingLine.js';
import { createLandingJournal, type LandingJournalFsOps } from '../src/coord/landingJournal.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(() => removeTmpFixtures());

const REC = {
  v: 1, seq: 1, at: 1001, setBy: 'lane-a', subject: { id: 1, project: 'project-a', pr: 10, binding: { kind: 'no-run' } },
  kind: 'entry', claim: { pinnedSha: 'a'.repeat(40), handoffCommit: 'b'.repeat(40) },
} as unknown as LandingJournalRecord;
const REC2 = { ...(REC as unknown as Record<string, unknown>), seq: 2, at: 1002 } as unknown as LandingJournalRecord;
/** The exact line the adapter appends for `REC`, measured on `main`. */
const LINE = '{"v":1,"seq":1,"at":1001,"setBy":"lane-a","subject":{"id":1,"project":"project-a","pr":10,"binding":{"kind":"no-run"}},'
  + '"kind":"entry","claim":{"pinnedSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","handoffCommit":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}}\n';

interface Fx { dir: string; leaf: string }
const fx = (content?: string | Buffer): Fx => {
  const dir = mkTmp('ccrc-append-only-char-');
  const leaf = path.join(dir, 'landing.log');
  if (content !== undefined) writeFileSync(leaf, content);
  return { dir, leaf };
};

/** The open flags as words, so a trace reads the same on every platform: the access mode, then each set flag. */
const FLAG_WORDS: readonly (readonly [string, number])[] = [
  ['APPEND', FS.O_APPEND], ['CREAT', FS.O_CREAT], ['EXCL', FS.O_EXCL], ['NOFOLLOW', FS.O_NOFOLLOW], ['NONBLOCK', FS.O_NONBLOCK],
  ['DIRECTORY', FS.O_DIRECTORY], ['TRUNC', FS.O_TRUNC],
];
const flagWords = (flags: number): string => {
  const access = (flags & FS.O_RDWR) !== 0 ? 'RDWR' : (flags & FS.O_WRONLY) !== 0 ? 'WRONLY' : 'RDONLY';
  return [access, ...FLAG_WORDS.filter(([, bit]) => (flags & bit) !== 0).map(([w]) => w)].join('|');
};

type Fault = Partial<{
  open: (p: string, flags: number, mode: number | undefined, real: () => number) => number;
  write: (fd: number, b: Uint8Array, o: number, l: number, real: () => number) => number;
  fsync: (label: string, real: () => void) => void;
}>;

/** A tracing fs: each call logged as one word line, by the role of the path it touches (`dir`, `leaf`), with the open flags
 *  and mode, the write length, and every close. */
const tracing = (f: Fx, fault: Fault = {}): { ops: LandingJournalFsOps; trace: string[] } => {
  const trace: string[] = [];
  const role = new Map<number, string>();
  const name = (p: string): string => (p === f.dir ? 'dir' : p === f.leaf ? 'leaf' : p);
  const ops: LandingJournalFsOps = {
    openSync(p, flags, mode) {
      const line = `open ${name(p)} ${flagWords(flags)}${mode === undefined ? '' : ` mode=${mode.toString(8)}`}`;
      let fd: number;
      try {
        fd = fault.open !== undefined ? fault.open(p, flags, mode, () => openSync(p, flags, mode)) : openSync(p, flags, mode);
      } catch (err) {
        trace.push(`${line} -> ${(err as { code?: string }).code ?? 'throw'}`);
        throw err;
      }
      trace.push(line);
      role.set(fd, name(p));
      return fd;
    },
    fstatSync(fd, o): BigIntStats { trace.push(`fstat ${role.get(fd)}`); return fstatSync(fd, o); },
    readSync(fd, b, o, l, p) { const n = readSync(fd, b, o, l, p); trace.push(`read ${role.get(fd)} @${String(p)} =${n}`); return n; },
    writeSync(fd, b, o, l) {
      const n = fault.write !== undefined ? fault.write(fd, b, o, l, () => writeSync(fd, b, o, l)) : writeSync(fd, b, o, l);
      trace.push(`write ${role.get(fd)} ${l} =${n}`);
      return n;
    },
    fsyncSync(fd) {
      trace.push(`fsync ${role.get(fd)}`);
      if (fault.fsync !== undefined) fault.fsync(role.get(fd) ?? '', () => fsyncSync(fd)); else fsyncSync(fd);
    },
    closeSync(fd) { trace.push(`close ${role.get(fd)}`); closeSync(fd); },
  };
  return { ops, trace };
};

const readOk = (r: ReturnType<ReturnType<typeof createLandingJournal>['read']>) => {
  if (!r.ok) throw new Error(`read refused: ${r.error}`);
  return r;
};

describe('the open flags and the call order of each mode', () => {
  it('read of a present file: parent, leaf, identity, parent re-proved, every byte; the snapshot holds both descriptors', () => {
    const f = fx(LINE);
    const { ops, trace } = tracing(f);
    const r = readOk(createLandingJournal(f.dir, ops).read());
    expect(trace).toEqual([
      'open dir RDONLY|DIRECTORY', 'fstat dir',
      'open leaf RDONLY|NOFOLLOW|NONBLOCK', 'fstat leaf',
      'open dir RDONLY|DIRECTORY', 'fstat dir', 'close dir',
      `read leaf @0 =${LINE.length}`, `read leaf @${LINE.length} =0`,
    ]);
    r.snapshot.release();
    expect(trace.slice(-2)).toEqual(['close leaf', 'close dir']);
  });

  it('read of an absent file: the leaf open is ENOENT and no leaf descriptor is held', () => {
    const f = fx();
    const { ops, trace } = tracing(f);
    const r = readOk(createLandingJournal(f.dir, ops).read());
    expect(r.kind).toBe('absent');
    expect(trace).toEqual([
      'open dir RDONLY|DIRECTORY', 'fstat dir',
      'open leaf RDONLY|NOFOLLOW|NONBLOCK -> ENOENT',
      'open dir RDONLY|DIRECTORY', 'fstat dir', 'close dir',
    ]);
    r.snapshot.release();
    expect(trace.slice(-1)).toEqual(['close dir']);
  });

  it('append to a present file: re-prove, open O_APPEND, compare, write, fsync file then parent, re-prove the whole bytes', () => {
    const f = fx(LINE);
    const { ops, trace } = tracing(f);
    const j = createLandingJournal(f.dir, ops);
    const r = readOk(j.read());
    const mark = trace.length;
    expect(j.append(r.snapshot, REC2)).toEqual({ ok: true });
    const L2 = LINE.length * 2; // REC2's line has the same length as REC's: two digits differ
    expect(trace.slice(mark)).toEqual([
      // 1. re-prove the snapshot
      'open dir RDONLY|DIRECTORY', 'fstat dir', 'close dir',
      'open leaf RDONLY|NOFOLLOW|NONBLOCK', 'fstat leaf', `read leaf @0 =${LINE.length}`, `read leaf @${LINE.length} =0`, 'close leaf',
      // 2. open to write through, and compare
      'open leaf RDWR|APPEND|NOFOLLOW|NONBLOCK mode=600', 'fstat leaf', `read leaf @0 =${LINE.length}`, `read leaf @${LINE.length} =0`,
      // 3. one record
      `write leaf ${LINE.length} =${LINE.length}`,
      // 4. the file, then its parent
      'fsync leaf', 'fsync dir',
      // 5. the pathname still denotes the file written, holding the complete bytes
      'open dir RDONLY|DIRECTORY', 'fstat dir', 'close dir',
      'open leaf RDONLY|NOFOLLOW|NONBLOCK', 'fstat leaf', 'fstat leaf', `read leaf @0 =${L2}`, `read leaf @${L2} =0`, 'close leaf',
      // the write descriptor, then the snapshot's two
      'close leaf', 'close leaf', 'close dir',
    ]);
    r.snapshot.release();
    expect(readFileSync(f.leaf, 'utf8')).toBe(`${LINE}${LINE.replace('"seq":1,"at":1001', '"seq":2,"at":1002')}`);
  });

  it('append to an absent file: an exclusive create with mode 0600, and no parent created', () => {
    const f = fx();
    const { ops, trace } = tracing(f);
    const j = createLandingJournal(f.dir, ops);
    const r = readOk(j.read());
    const mark = trace.length;
    expect(j.append(r.snapshot, REC)).toEqual({ ok: true });
    expect(trace.slice(mark)).toEqual([
      'open dir RDONLY|DIRECTORY', 'fstat dir', 'close dir',
      'open leaf RDONLY|NOFOLLOW|NONBLOCK -> ENOENT',
      'open leaf RDWR|APPEND|CREAT|EXCL|NOFOLLOW|NONBLOCK mode=600', 'fstat leaf',
      `write leaf ${LINE.length} =${LINE.length}`,
      'fsync leaf', 'fsync dir',
      'open dir RDONLY|DIRECTORY', 'fstat dir', 'close dir',
      'open leaf RDONLY|NOFOLLOW|NONBLOCK', 'fstat leaf', 'fstat leaf', `read leaf @0 =${LINE.length}`, `read leaf @${LINE.length} =0`, 'close leaf',
      'close leaf', 'close dir',
    ]);
    expect(statSync(f.leaf).mode & 0o777).toBe(0o600);
  });

  it('confirmDurable of a present snapshot: re-prove, fsync the RETAINED file then parent, re-prove; the snapshot stays live', () => {
    const f = fx(LINE);
    const { ops, trace } = tracing(f);
    const j = createLandingJournal(f.dir, ops);
    const r = readOk(j.read());
    const mark = trace.length;
    expect(j.confirmDurable(r.snapshot)).toEqual({ ok: true });
    const reprove = [
      'open dir RDONLY|DIRECTORY', 'fstat dir', 'close dir',
      'open leaf RDONLY|NOFOLLOW|NONBLOCK', 'fstat leaf', `read leaf @0 =${LINE.length}`, `read leaf @${LINE.length} =0`, 'close leaf',
    ];
    expect(trace.slice(mark)).toEqual([...reprove, 'fsync leaf', 'fsync dir', ...reprove]);
    expect(j.confirmDurable(r.snapshot)).toEqual({ ok: true });
    r.snapshot.release();
  });

  it('confirmDurable of an absence: fsync the parent only, re-prove the absence, create nothing', () => {
    const f = fx();
    const { ops, trace } = tracing(f);
    const j = createLandingJournal(f.dir, ops);
    const r = readOk(j.read());
    const mark = trace.length;
    expect(j.confirmDurable(r.snapshot)).toEqual({ ok: true });
    const reprove = ['open dir RDONLY|DIRECTORY', 'fstat dir', 'close dir', 'open leaf RDONLY|NOFOLLOW|NONBLOCK -> ENOENT'];
    expect(trace.slice(mark)).toEqual([...reprove, 'fsync dir', ...reprove]);
    r.snapshot.release();
    expect(() => statSync(f.leaf)).toThrow();
  });
});

describe('the write loop', () => {
  it('a short write continues from where it stopped, as one record', () => {
    const f = fx(LINE);
    let first = true;
    // the first write puts down ten bytes only, through the adapter's own descriptor, as a short write would
    const { ops, trace } = tracing(f, { write: (fd, b, o, l, real) => { if (first) { first = false; return writeSync(fd, b, o, 10); } return real(); } });
    const j = createLandingJournal(f.dir, ops);
    const r = readOk(j.read());
    expect(j.append(r.snapshot, REC)).toEqual({ ok: true });
    expect(trace.filter((t) => t.startsWith('write'))).toEqual([`write leaf ${LINE.length} =10`, `write leaf ${LINE.length - 10} =${LINE.length - 10}`]);
    expect(readFileSync(f.leaf, 'utf8')).toBe(`${LINE}${LINE}`);
  });

  it('a zero-byte write is unwritable with mayApply, and is not retried', () => {
    const f = fx(LINE);
    const { ops, trace } = tracing(f, { write: () => 0 });
    const j = createLandingJournal(f.dir, ops);
    const r = readOk(j.read());
    expect(j.append(r.snapshot, REC)).toEqual({ ok: false, error: 'unwritable', mayApply: true });
    expect(trace.filter((t) => t.startsWith('write'))).toEqual([`write leaf ${LINE.length} =0`]);
    expect(trace.some((t) => t.startsWith('fsync'))).toBe(false);
    expect(readFileSync(f.leaf, 'utf8')).toBe(LINE);
  });
});

describe('each failure word, with mayApply', () => {
  it('append: a throwing write is unwritable; an EACCES open for append is unwritable; a failed fsync is durability', () => {
    const write = fx(LINE);
    const w = tracing(write, { write: () => { throw Object.assign(new Error('EIO'), { code: 'EIO' }); } });
    const jw = createLandingJournal(write.dir, w.ops);
    expect(jw.append(readOk(jw.read()).snapshot, REC)).toEqual({ ok: false, error: 'unwritable', mayApply: true });

    const acc = fx(LINE);
    const a = tracing(acc, {
      open: (p, flags, mode, real) => {
        if ((flags & FS.O_APPEND) !== 0) throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
        return real();
      },
    });
    const ja = createLandingJournal(acc.dir, a.ops);
    expect(ja.append(readOk(ja.read()).snapshot, REC)).toEqual({ ok: false, error: 'unwritable', mayApply: true });

    for (const which of ['leaf', 'dir']) {
      const dur = fx(LINE);
      const d = tracing(dur, { fsync: (label, real) => { if (label === which) throw new Error('EIO'); real(); } });
      const jd = createLandingJournal(dur.dir, d.ops);
      expect(jd.append(readOk(jd.read()).snapshot, REC), which).toEqual({ ok: false, error: 'durability', mayApply: true });
    }
  });

  it('append: an open for append that fails another way is unreadable, with mayApply', () => {
    const f = fx(LINE);
    const { ops } = tracing(f, {
      open: (p, flags, mode, real) => {
        if ((flags & FS.O_APPEND) !== 0) throw Object.assign(new Error('EIO'), { code: 'EIO' });
        return real();
      },
    });
    const j = createLandingJournal(f.dir, ops);
    expect(j.append(readOk(j.read()).snapshot, REC)).toEqual({ ok: false, error: 'unreadable', mayApply: true });
  });

  it('confirmDurable: a failed fsync is durability; a changed byte is changed; a spent snapshot is unreadable', () => {
    const f = fx(LINE);
    const { ops } = tracing(f, { fsync: () => { throw new Error('EIO'); } });
    const j = createLandingJournal(f.dir, ops);
    const r = readOk(j.read());
    expect(j.confirmDurable(r.snapshot)).toEqual({ ok: false, error: 'durability' });
    writeFileSync(f.leaf, LINE.replace('lane-a', 'lane-b'));
    expect(j.confirmDurable(r.snapshot)).toEqual({ ok: false, error: 'changed' });
    r.snapshot.release();
    expect(j.confirmDurable(r.snapshot)).toEqual({ ok: false, error: 'unreadable' });
  });
});

describe('the replaced, symlinked and spent cases', () => {
  it('a leaf replaced between read and append is changed, with mayApply, and the replacement is untouched', () => {
    const f = fx(LINE);
    const j = createLandingJournal(f.dir);
    const r = readOk(j.read());
    const other = path.join(f.dir, 'other');
    writeFileSync(other, LINE);
    renameSync(other, f.leaf);
    expect(j.append(r.snapshot, REC2)).toEqual({ ok: false, error: 'changed', mayApply: true });
    expect(readFileSync(f.leaf, 'utf8')).toBe(LINE);
  });

  it('a symlinked leaf is unreadable, and its target is never read or written', () => {
    const f = fx();
    const target = path.join(f.dir, 'target');
    writeFileSync(target, LINE);
    symlinkSync(target, f.leaf);
    const { ops, trace } = tracing(f);
    expect(createLandingJournal(f.dir, ops).read()).toEqual({ ok: false, error: 'unreadable' });
    expect(trace).toEqual([
      'open dir RDONLY|DIRECTORY', 'fstat dir', `open leaf RDONLY|NOFOLLOW|NONBLOCK -> ${trace[2]!.split(' -> ')[1]}`, 'close dir',
    ]);
    expect(['ELOOP', 'EMLINK']).toContain(trace[2]!.split(' -> ')[1]);
    expect(readFileSync(target, 'utf8')).toBe(LINE);
  });

  it('a snapshot used after an append, and after a release, is refused as unreadable with mayApply, writing nothing', () => {
    const f = fx(LINE);
    const j = createLandingJournal(f.dir);
    const r = readOk(j.read());
    expect(j.append(r.snapshot, REC2)).toEqual({ ok: true });
    const after = readFileSync(f.leaf);
    expect(j.append(r.snapshot, REC2)).toEqual({ ok: false, error: 'unreadable', mayApply: true });
    expect(j.confirmDurable(r.snapshot)).toEqual({ ok: false, error: 'unreadable' });
    const r2 = readOk(j.read());
    r2.snapshot.release();
    r2.snapshot.release();
    expect(j.append(r2.snapshot, REC2)).toEqual({ ok: false, error: 'unreadable', mayApply: true });
    expect(readFileSync(f.leaf).equals(after)).toBe(true);
  });

  it('a snapshot another adapter issued is refused', () => {
    const f = fx(LINE);
    const r = readOk(createLandingJournal(f.dir).read());
    expect(createLandingJournal(f.dir).append(r.snapshot, REC2)).toEqual({ ok: false, error: 'unreadable', mayApply: true });
    r.snapshot.release();
  });
});

describe('what read answers', () => {
  it('an empty file is present with empty text, never absent', () => {
    const f = fx('');
    const r = readOk(createLandingJournal(f.dir).read());
    expect(r).toMatchObject({ ok: true, kind: 'present', text: '' });
    r.snapshot.release();
  });

  it('a file that starts with a byte-order mark answers the mark in its text', () => {
    const f = fx(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(LINE, 'utf8')]));
    const r = readOk(createLandingJournal(f.dir).read());
    expect(r.kind === 'present' && r.text.charCodeAt(0)).toBe(0xfeff);
    expect(r.kind === 'present' && r.text.slice(1)).toBe(LINE);
    r.snapshot.release();
  });

  it('invalid UTF-8 is unreadable (the decode is fatal), and closes both descriptors', () => {
    const f = fx(Buffer.from([0x7b, 0xff, 0xfe, 0x0a]));
    const { ops, trace } = tracing(f);
    expect(createLandingJournal(f.dir, ops).read()).toEqual({ ok: false, error: 'unreadable' });
    expect(trace.slice(-2)).toEqual(['close leaf', 'close dir']);
  });

  it('the exact bytes appended for a record: JSON.stringify of the record, then one LF', () => {
    const f = fx();
    const j = createLandingJournal(f.dir);
    expect(j.append(readOk(j.read()).snapshot, REC)).toEqual({ ok: true });
    expect(readFileSync(f.leaf).toString('hex')).toBe(Buffer.from(LINE, 'utf8').toString('hex'));
  });
});
