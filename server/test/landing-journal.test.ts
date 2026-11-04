// Landing order, wave 5f, Task 1 steps 1-4: the authority journal's strict parser (L1) and its file adapter (L3), against
// real files under fixture directories (mkTmp), never the live HOME or `~/.ccrc`. Low-level IO faults are injected through
// the adapter's optional second parameter (the fs operations it uses), so a short write, a failing fsync and the open
// flags are observable without touching a real device.
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import {
  chmodSync, closeSync, constants as FS, fstatSync, fsyncSync, mkdirSync, openSync, readFileSync, readSync, renameSync,
  statSync, symlinkSync, writeFileSync, writeSync,
} from 'node:fs';
import path from 'node:path';
import type { BigIntStats } from 'node:fs';
import type { LandingJournalRecord, LandingSubjectRef } from '../../shared/landingLine.js';
import { parseLandingJournal } from '../src/coord/landingJournalPolicy.js';
import { createLandingJournal, type LandingJournalFsOps } from '../src/coord/landingJournal.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(() => removeTmpFixtures());

const LINUX = process.platform === 'linux';
const ROOT_USER = typeof process.getuid === 'function' && process.getuid() === 0;
const H1 = 'a'.repeat(40);
const H2 = 'b'.repeat(40);

const sub = (id: number, project = 'proj-a', pr = id * 10, binding: LandingSubjectRef['binding'] = { kind: 'no-run' }): LandingSubjectRef =>
  ({ id, project, pr, binding });
const entry = (seq: number, id: number, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 1, seq, at: 1000 + seq, setBy: 'lane-a', subject: sub(id), kind: 'entry', claim: { pinnedSha: H1, handoffCommit: H2 }, ...over,
});
const order = (seq: number, id: number, after: LandingSubjectRef[] = [], fixesMain = false, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 1, seq, at: 1000 + seq, setBy: 'lane-a', subject: sub(id), kind: 'order', after, fixesMain, ...over,
});
const text = (...recs: Record<string, unknown>[]): string => recs.map((r) => `${JSON.stringify(r)}\n`).join('');
const bad = (reason: string, record: number | null) => ({ ok: false, reason, record });

describe('the journal parser (shared contract §3)', () => {
  it('accepts a valid history and returns every record with lastSeq', () => {
    const recs = [entry(1, 1), entry(2, 2), order(3, 2, [sub(1)], true)];
    const r = parseLandingJournal(text(...recs));
    expect(r).toEqual({ ok: true, records: recs, lastSeq: 3 });
  });

  it('empty text is empty at no record', () => {
    expect(parseLandingJournal('')).toEqual({ ok: false, reason: 'empty', record: null });
  });

  it('a blank record is blank at its position', () => {
    expect(parseLandingJournal(`${JSON.stringify(entry(1, 1))}\n\n`)).toEqual(bad('blank', 2));
    expect(parseLandingJournal('\n')).toEqual(bad('blank', 1));
    expect(parseLandingJournal(`${JSON.stringify(entry(1, 1))}\n  \n`)).toEqual(bad('blank', 2));
  });

  it('rejects-torn-last-line', () => {
    const one = JSON.stringify(entry(1, 1));
    expect(parseLandingJournal(one)).toMatchObject({ ok: false, reason: 'torn', record: 1 });
    expect(parseLandingJournal(`${one}\n{"v":1,`)).toMatchObject({ ok: false, reason: 'torn', record: 2 });
    // the first violation in file order answers: a bad record before the torn tail wins
    expect(parseLandingJournal(`not json\n${one}`)).toEqual(bad('json', 1));
  });

  it('rejects-unknown-kind', () => {
    expect(parseLandingJournal(text(entry(1, 1), { ...entry(2, 2), kind: 'noop' }))).toEqual(bad('kind', 2));
    expect(parseLandingJournal(text({ ...entry(1, 1), kind: 7 }))).toEqual(bad('kind', 1));
  });

  it('rejects-future-version', () => {
    expect(parseLandingJournal(text(entry(1, 1), { ...entry(2, 2), v: 2 }))).toEqual(bad('version', 2));
    expect(parseLandingJournal(text({ ...entry(1, 1), v: '1' }))).toEqual(bad('version', 1));
  });

  it('version is checked before kind, kind before fields', () => {
    expect(parseLandingJournal(text({ ...entry(1, 1), v: 2, kind: 'x', bogus: 1 }))).toEqual(bad('version', 1));
    expect(parseLandingJournal(text({ ...entry(1, 1), kind: 'x', bogus: 1 }))).toEqual(bad('kind', 1));
  });

  it('json that is not an object is fields', () => {
    expect(parseLandingJournal('[]\n')).toEqual(bad('fields', 1));
    expect(parseLandingJournal('7\n')).toEqual(bad('fields', 1));
    expect(parseLandingJournal('{\n')).toEqual(bad('json', 1));
  });

  it('rejects-sequence-gap', () => {
    expect(parseLandingJournal(text(entry(1, 1), entry(3, 2)))).toEqual(bad('sequence', 2));
  });

  it('rejects-sequence-repeat', () => {
    expect(parseLandingJournal(text(entry(1, 1), entry(1, 2)))).toEqual(bad('sequence', 2));
  });

  it('sequence must start at 1', () => {
    expect(parseLandingJournal(text(entry(2, 1)))).toEqual(bad('sequence', 1));
  });

  it('fields come before sequence, sequence before identity', () => {
    expect(parseLandingJournal(text(entry(1, 1), entry(5, 2, { bogus: 1 })))).toEqual(bad('fields', 2));
    // a gap AND an identity contradiction: sequence answers
    expect(parseLandingJournal(text(entry(1, 1), order(3, 1, [sub(2, 'proj-a', 10)])))).toEqual(bad('sequence', 2));
  });

  it('rejects-invalid-reference-shape', () => {
    const base = (ref: unknown) => text(entry(1, 1), entry(2, 2), { ...order(3, 2), after: [ref] });
    expect(parseLandingJournal(base({ ...sub(1), extra: 1 }))).toEqual(bad('fields', 3));
    expect(parseLandingJournal(base({ ...sub(1), id: '1' }))).toEqual(bad('fields', 3));
    expect(parseLandingJournal(base({ ...sub(1), binding: { kind: 'run' } }))).toEqual(bad('fields', 3));
    expect(parseLandingJournal(base({ ...sub(1), binding: { kind: 'no-run', observedRunId: 3 } }))).toEqual(bad('fields', 3));
    expect(parseLandingJournal(base({ ...sub(1), binding: { kind: 'other' } }))).toEqual(bad('fields', 3));
    expect(parseLandingJournal(base('x'))).toEqual(bad('fields', 3));
    expect(parseLandingJournal(text(entry(1, 1), { ...order(2, 1), after: 'x' }))).toEqual(bad('fields', 2));
  });

  it('a run binding needs a positive safe observedRunId', () => {
    const ok = (b: unknown) => parseLandingJournal(text(entry(1, 1), entry(2, 2), order(3, 2, [{ ...sub(1), binding: b } as LandingSubjectRef])));
    expect(ok({ kind: 'run', observedRunId: 9 })).toMatchObject({ ok: true });
    expect(ok({ kind: 'run', observedRunId: 0 })).toEqual(bad('fields', 3));
    expect(ok({ kind: 'run', observedRunId: 9007199254740992 })).toEqual(bad('fields', 3));
  });

  it('rejects unknown keys at the top level and in every nested object', () => {
    expect(parseLandingJournal(text(entry(1, 1, { x: 1 })))).toEqual(bad('fields', 1));
    expect(parseLandingJournal(text(entry(1, 1, { subject: { ...sub(1), x: 1 } })))).toEqual(bad('fields', 1));
    expect(parseLandingJournal(text(entry(1, 1, { subject: { ...sub(1), binding: { kind: 'no-run', x: 1 } } })))).toEqual(bad('fields', 1));
    expect(parseLandingJournal(text(entry(1, 1, { claim: { pinnedSha: H1, handoffCommit: H2, x: 1 } })))).toEqual(bad('fields', 1));
    expect(parseLandingJournal(text(entry(1, 1, { after: [] })))).toEqual(bad('fields', 1));
    expect(parseLandingJournal(text(entry(1, 1), order(2, 1, [], false, { claim: { pinnedSha: H1, handoffCommit: H2 } })))).toEqual(bad('fields', 2));
    expect(parseLandingJournal(text(entry(1, 1, { claim: undefined })))).toEqual(bad('fields', 1));
  });

  it('numbers: ids, prs and seq are positive safe integers; at is a nonnegative safe integer', () => {
    for (const n of [0, -1, 1.5, 9007199254740992, '3', null]) {
      expect(parseLandingJournal(text(entry(1, 1, { subject: { ...sub(1), id: n } }))), `id ${String(n)}`).toEqual(bad('fields', 1));
      expect(parseLandingJournal(text(entry(1, 1, { subject: { ...sub(1), pr: n } }))), `pr ${String(n)}`).toEqual(bad('fields', 1));
      expect(parseLandingJournal(text(entry(n as number, 1))), `seq ${String(n)}`).toEqual(bad('fields', 1));
    }
    expect(parseLandingJournal(text(entry(1, 1, { at: 0 })))).toMatchObject({ ok: true });
    for (const n of [-1, 1.5, 9007199254740992, '3', null]) {
      expect(parseLandingJournal(text(entry(1, 1, { at: n }))), `at ${String(n)}`).toEqual(bad('fields', 1));
    }
  });

  it('strings are nonblank and trimmed; hashes are lowercase 40-hex', () => {
    for (const s of ['', ' ', ' lane-a', 'lane-a ', 7]) {
      expect(parseLandingJournal(text(entry(1, 1, { setBy: s }))), `setBy ${JSON.stringify(s)}`).toEqual(bad('fields', 1));
      expect(parseLandingJournal(text(entry(1, 1, { subject: { ...sub(1), project: s } }))), `project ${JSON.stringify(s)}`).toEqual(bad('fields', 1));
    }
    for (const h of ['A'.repeat(40), 'a'.repeat(39), 'a'.repeat(41), 'g'.repeat(40), ` ${'a'.repeat(39)}`, 5]) {
      expect(parseLandingJournal(text(entry(1, 1, { claim: { pinnedSha: h, handoffCommit: H2 } }))), `pinned ${String(h)}`).toEqual(bad('fields', 1));
      expect(parseLandingJournal(text(entry(1, 1, { claim: { pinnedSha: H1, handoffCommit: h } }))), `handoff ${String(h)}`).toEqual(bad('fields', 1));
    }
  });

  it('fixesMain is a boolean', () => {
    expect(parseLandingJournal(text(entry(1, 1), order(2, 1, [], 1 as unknown as boolean)))).toEqual(bad('fields', 2));
  });

  it('after is ordered, duplicate-free, same-project and excludes its source', () => {
    const three = [entry(1, 1), entry(2, 2), entry(3, 3)];
    expect(parseLandingJournal(text(...three, order(4, 3, [sub(2), sub(1)])))).toMatchObject({ ok: true });
    expect(parseLandingJournal(text(...three, order(4, 3, [sub(1), sub(1)])))).toEqual(bad('fields', 4));
    expect(parseLandingJournal(text(...three, order(4, 3, [sub(3)])))).toEqual(bad('fields', 4));
    expect(parseLandingJournal(text(...three, order(4, 3, [sub(2, 'proj-b', 20)])))).toEqual(bad('fields', 4));
  });

  it('an entry record is no-run and introduces an identity never mentioned', () => {
    expect(parseLandingJournal(text(entry(1, 1, { subject: sub(1, 'proj-a', 10, { kind: 'run', observedRunId: 4 }) })))).toEqual(bad('fields', 1));
    expect(parseLandingJournal(text(entry(1, 1), entry(2, 1)))).toEqual(bad('identity', 2));
    // mentioned first only as a target: an entry for it is no longer a creation
    expect(parseLandingJournal(text(entry(1, 1), order(2, 1, [sub(2)]), entry(3, 2)))).toEqual(bad('identity', 3));
    // same project/pr under another id
    expect(parseLandingJournal(text(entry(1, 1), entry(2, 2, { subject: sub(2, 'proj-a', 10) })))).toEqual(bad('identity', 2));
  });

  it('a target reference registers a subject without an entry; bindings may change', () => {
    const recs = [
      entry(1, 1), order(2, 1, [sub(2)]),
      order(3, 1, [{ ...sub(2), binding: { kind: 'run', observedRunId: 7 } }]),
      order(4, 2, [], false, { subject: sub(2, 'proj-a', 20, { kind: 'run', observedRunId: 8 }) }),
    ];
    expect(parseLandingJournal(text(...recs))).toEqual({ ok: true, records: recs, lastSeq: 4 });
  });

  it('rejects-id-history-contradiction', () => {
    expect(parseLandingJournal(text(entry(1, 1), order(2, 2, [sub(1, 'proj-a', 11)])))).toEqual(bad('identity', 2));
    expect(parseLandingJournal(text(entry(1, 1), order(2, 1, [], false, { subject: sub(1, 'proj-b', 10) })))).toEqual(bad('identity', 2));
  });

  it('rejects-key-history-contradiction', () => {
    expect(parseLandingJournal(text(entry(1, 1), entry(2, 2), order(3, 2, [sub(3, 'proj-a', 10)])))).toEqual(bad('identity', 3));
  });

  it('validates the whole file before returning records: a bad suffix voids a valid prefix', () => {
    const r = parseLandingJournal(text(entry(1, 1), entry(2, 2), entry(4, 3)));
    expect(r).toEqual(bad('sequence', 3));
    expect(r).not.toHaveProperty('records');
  });
});

// ---------------------------------------------------------------- the adapter

interface Fx { dir: string; leaf: string }
const fx = (): Fx => {
  const dir = mkTmp('ccrc-landing-journal-');
  return { dir, leaf: path.join(dir, 'landing.log') };
};
const planted = (content: string | Buffer): Fx => {
  const f = fx();
  writeFileSync(f.leaf, content);
  return f;
};
const REC = entry(1, 1) as unknown as LandingJournalRecord;
const LINE = `${JSON.stringify(REC)}\n`;
const REC2 = entry(2, 2) as unknown as LandingJournalRecord;

/** A recording fs: every call logged by name with its path (open) or the path its fd was opened on. */
interface Call { op: string; path?: string; flags?: number; fd?: number; label?: string }
const recording = (fault: Partial<{
  openSync: LandingJournalFsOps['openSync']; writeSync: LandingJournalFsOps['writeSync'];
  fsyncSync: (fd: number, real: () => void, label: string) => void;
  fstatSync: (fd: number, real: () => BigIntStats, label: string) => BigIntStats;
  readSync: (fd: number, real: () => number, label: string) => number;
}> = {}): { ops: LandingJournalFsOps; calls: Call[] } => {
  const calls: Call[] = [];
  const labelOf = new Map<number, string>();
  const ops: LandingJournalFsOps = {
    openSync(p, flags, mode) {
      // logged BEFORE the open, so a refused open (ELOOP, ENXIO) is still observed with its flags
      const call: Call = { op: 'open', path: p, flags };
      calls.push(call);
      const fd = fault.openSync !== undefined ? fault.openSync(p, flags, mode) : openSync(p, flags, mode);
      labelOf.set(fd, p);
      call.fd = fd;
      return fd;
    },
    fstatSync: (fd, o) => (fault.fstatSync !== undefined
      ? fault.fstatSync(fd, () => fstatSync(fd, o), labelOf.get(fd) ?? '') : fstatSync(fd, o)),
    readSync: (fd, buf, off, len, pos) => (fault.readSync !== undefined
      ? fault.readSync(fd, () => readSync(fd, buf, off, len, pos), labelOf.get(fd) ?? '') : readSync(fd, buf, off, len, pos)),
    writeSync(fd, buf, off, len) {
      calls.push({ op: 'write', fd, label: labelOf.get(fd) });
      return fault.writeSync !== undefined ? fault.writeSync(fd, buf, off, len) : writeSync(fd, buf, off, len);
    },
    fsyncSync(fd) {
      calls.push({ op: 'fsync', fd, label: labelOf.get(fd) });
      if (fault.fsyncSync !== undefined) fault.fsyncSync(fd, () => fsyncSync(fd), labelOf.get(fd) ?? '');
      else fsyncSync(fd);
    },
    closeSync(fd) { calls.push({ op: 'close', fd, label: labelOf.get(fd) }); closeSync(fd); },
  };
  return { ops, calls };
};

/** Every descriptor a call log opened was closed exactly once, and nothing else was closed. */
const expectBalanced = (calls: Call[]): void => {
  const open = new Set<number>();
  for (const c of calls) {
    if (c.op === 'open' && c.fd !== undefined) open.add(c.fd);
    if (c.op === 'close') {
      expect(open.has(c.fd as number), `close of fd ${String(c.fd)} that is open`).toBe(true);
      open.delete(c.fd as number);
    }
  }
  expect([...open], 'descriptors left open').toEqual([]);
};

/** A child that opens a writer on the FIFO from 2 s on, repeatedly, so a BLOCKING reader open is released in bounded time
 *  (a synchronous open of a FIFO with no writer cannot be rescued by a vitest timeout). */
const spawnFifoWriter = (leaf: string) => spawn(process.execPath, ['-e',
  "const fs = require('node:fs'); let n = 0; setTimeout(() => { const t = setInterval(() => { " +
  "try { fs.closeSync(fs.openSync(process.argv[1], fs.constants.O_WRONLY | fs.constants.O_NONBLOCK)); } catch {} " +
  "if (++n > 12) clearInterval(t); }, 250); }, 2000);", leaf], { stdio: 'ignore' });

describe('the journal adapter read (shared contract §2)', () => {
  it('leaf ENOENT with a measured parent is absent, and reading creates nothing', () => {
    const f = fx();
    const r = createLandingJournal(f.dir).read();
    expect(r).toMatchObject({ ok: true, kind: 'absent' });
    if (r.ok) r.snapshot.release();
    expect(() => statSync(f.leaf)).toThrow();
  });

  it('a missing parent directory is unreadable, never absence, and is not created', () => {
    const f = fx();
    const missing = path.join(f.dir, 'nope');
    expect(createLandingJournal(missing).read()).toEqual({ ok: false, error: 'unreadable' });
    expect(() => statSync(missing)).toThrow();
  });

  it('a present file answers its exact text', () => {
    const f = planted(LINE);
    const r = createLandingJournal(f.dir).read();
    expect(r).toMatchObject({ ok: true, kind: 'present', text: LINE });
    if (r.ok) r.snapshot.release();
  });

  it('an existing empty file is present with empty text, never absent', () => {
    const f = planted('');
    const r = createLandingJournal(f.dir).read();
    expect(r).toMatchObject({ ok: true, kind: 'present', text: '' });
    if (r.ok) r.snapshot.release();
  });

  it('a byte-order mark is kept in the text, never stripped', () => {
    const f = planted(`﻿${LINE}`);
    const r = createLandingJournal(f.dir).read();
    expect(r).toMatchObject({ ok: true, kind: 'present', text: `﻿${LINE}` });
    if (r.ok) r.snapshot.release();
  });

  it('invalid UTF-8 is unreadable', () => {
    const f = planted(Buffer.from([0x7b, 0xff, 0xfe, 0x0a]));
    expect(createLandingJournal(f.dir).read()).toEqual({ ok: false, error: 'unreadable' });
  });

  it.skipIf(ROOT_USER)('permission-failure-is-unreadable', () => {
    const f = planted(LINE);
    chmodSync(f.leaf, 0o000);
    try {
      expect(createLandingJournal(f.dir).read()).toEqual({ ok: false, error: 'unreadable' });
    } finally {
      chmodSync(f.leaf, 0o600);
    }
  });

  it('directory-is-unreadable', () => {
    const f = fx();
    mkdirSync(f.leaf);
    expect(createLandingJournal(f.dir).read()).toEqual({ ok: false, error: 'unreadable' });
  });

  it('symlink-journal-refuses', () => {
    const f = fx();
    const target = path.join(f.dir, 'elsewhere.log');
    writeFileSync(target, LINE);
    symlinkSync(target, f.leaf);
    const { ops, calls } = recording();
    expect(createLandingJournal(f.dir, ops).read(), 'a link to a real journal is not read').toEqual({ ok: false, error: 'unreadable' });
    const leafOpens = calls.filter((c) => c.op === 'open' && c.path === f.leaf);
    expect(leafOpens.length).toBeGreaterThan(0);
    for (const c of leafOpens) expect((c.flags ?? 0) & FS.O_NOFOLLOW, 'the leaf open is no-follow').toBe(FS.O_NOFOLLOW);
    // append through a dangling link never writes the target either
    const dangling = fx();
    symlinkSync(path.join(dangling.dir, 'gone.log'), dangling.leaf);
    expect(createLandingJournal(dangling.dir).read()).toEqual({ ok: false, error: 'unreadable' });
    expect(() => statSync(path.join(dangling.dir, 'gone.log'))).toThrow();
  });

  it.skipIf(!LINUX)('nonregular-journal-refuses', () => {
    const f = fx();
    execFileSync('mkfifo', [f.leaf]);
    const child = spawnFifoWriter(f.leaf);
    try {
      const t0 = Date.now();
      const { ops, calls } = recording();
      expect(createLandingJournal(f.dir, ops).read()).toEqual({ ok: false, error: 'unreadable' });
      expect(Date.now() - t0, 'the read waited for a writer').toBeLessThan(1000);
      expectBalanced(calls);
    } finally {
      child.kill();
    }
  });

  it.skipIf(!LINUX)('fifo-journal-refuses-without-blocking', () => {
    const f = fx();
    execFileSync('mkfifo', [f.leaf]);
    // The writer child is started BEFORE the read: were the open blocking, the child would release it after about 2 s and the
    // elapsed time (and the flag check) turn red, instead of the event loop hanging for ever.
    const child = spawnFifoWriter(f.leaf);
    try {
      const t0 = Date.now();
      const { ops, calls } = recording();
      expect(createLandingJournal(f.dir, ops).read()).toEqual({ ok: false, error: 'unreadable' });
      expect(Date.now() - t0, 'the read waited for a writer').toBeLessThan(1000);
      // The fixture opener observes the flags too.
      const leafOpens = calls.filter((c) => c.op === 'open' && c.path === f.leaf);
      expect(leafOpens.length).toBeGreaterThan(0);
      for (const c of leafOpens) expect((c.flags ?? 0) & FS.O_NONBLOCK, 'the leaf open is nonblocking').toBe(FS.O_NONBLOCK);
      expectBalanced(calls);
    } finally {
      child.kill();
    }
  });

  it('a nonregular leaf (injected fstat) is unreadable and closes its descriptors', () => {
    const f = planted(LINE);
    const { ops, calls } = recording({
      fstatSync: (_fd, real, label) => {
        const st = real();
        if (label !== f.leaf) return st;
        return { dev: st.dev, ino: st.ino, size: st.size, isFile: () => false, isDirectory: () => false } as unknown as BigIntStats;
      },
    });
    expect(createLandingJournal(f.dir, ops).read()).toEqual({ ok: false, error: 'unreadable' });
    expectBalanced(calls);
  });

  it('invalid UTF-8, a directory and a throwing read each close every descriptor', () => {
    const bad8 = planted(Buffer.from([0x7b, 0xff, 0xfe, 0x0a]));
    const a = recording();
    expect(createLandingJournal(bad8.dir, a.ops).read()).toEqual({ ok: false, error: 'unreadable' });
    expectBalanced(a.calls);

    const dir = fx();
    mkdirSync(dir.leaf);
    const b = recording();
    expect(createLandingJournal(dir.dir, b.ops).read()).toEqual({ ok: false, error: 'unreadable' });
    expectBalanced(b.calls);

    const thrown = planted(LINE);
    const c = recording({ readSync: (_fd, _real, label) => { if (label === thrown.leaf) throw Object.assign(new Error('x'), { code: 'EIO' }); return 0; } });
    expect(createLandingJournal(thrown.dir, c.ops).read()).toEqual({ ok: false, error: 'unreadable' });
    expectBalanced(c.calls);
  });

  it('a parent swapped while the leaf is opened is unreadable, whether the leaf is present or absent', () => {
    for (const present of [true, false]) {
      const f = fx();
      const dir = path.join(f.dir, 'sub');
      mkdirSync(dir);
      if (present) writeFileSync(path.join(dir, 'landing.log'), LINE);
      let swapped = false;
      const swap = (): void => {
        if (swapped) return;
        swapped = true;
        renameSync(dir, path.join(f.dir, 'sub-moved'));
        mkdirSync(dir);
      };
      const { ops, calls } = recording({
        openSync: (p, flags, mode) => {
          if (p !== path.join(dir, 'landing.log')) return openSync(p, flags, mode);
          try { return openSync(p, flags, mode); } finally { swap(); }
        },
      });
      expect(createLandingJournal(dir, ops).read(), present ? 'present leaf' : 'absent leaf').toEqual({ ok: false, error: 'unreadable' });
      expect(swapped).toBe(true);
      expectBalanced(calls);
    }
  });
});

describe('the snapshot and confirmation', () => {
  it('confirmDurable on a present snapshot fsyncs the file descriptor and the parent, and does not consume the snapshot', () => {
    const f = planted(LINE);
    const { ops, calls } = recording();
    const j = createLandingJournal(f.dir, ops);
    const r = j.read();
    if (!r.ok) throw new Error('read');
    expect(j.confirmDurable(r.snapshot)).toEqual({ ok: true });
    expect(calls.filter((c) => c.op === 'fsync')).toHaveLength(2);
    expect(j.confirmDurable(r.snapshot), 'a confirmation does not consume the snapshot').toEqual({ ok: true });
    r.snapshot.release();
  });

  it('confirmDurable of absence fsyncs the parent, re-proves absence and creates no file', () => {
    const f = fx();
    const { ops, calls } = recording();
    const j = createLandingJournal(f.dir, ops);
    const r = j.read();
    if (!r.ok) throw new Error('read');
    expect(j.confirmDurable(r.snapshot)).toEqual({ ok: true });
    expect(calls.filter((c) => c.op === 'fsync')).toHaveLength(1);
    expect(() => statSync(f.leaf)).toThrow();
    r.snapshot.release();
  });

  it('confirmDurable reports a failed fsync as durability', () => {
    const f = planted(LINE);
    const { ops } = recording({ fsyncSync: () => { throw Object.assign(new Error('x'), { code: 'EIO' }); } });
    const j = createLandingJournal(f.dir, ops);
    const r = j.read();
    if (!r.ok) throw new Error('read');
    expect(j.confirmDurable(r.snapshot)).toEqual({ ok: false, error: 'durability' });
    r.snapshot.release();
  });

  it('exact-snapshot-refuses-replacement', () => {
    const f = planted(LINE);
    const j = createLandingJournal(f.dir);
    const r = j.read();
    if (!r.ok) throw new Error('read');
    // a pathname replacement with IDENTICAL bytes: a different file, so changed
    renameSync(f.leaf, path.join(f.dir, 'old.log'));
    writeFileSync(f.leaf, LINE);
    expect(j.confirmDurable(r.snapshot)).toEqual({ ok: false, error: 'changed' });
    expect(j.append(r.snapshot, REC2)).toMatchObject({ ok: false, error: 'changed', mayApply: true });
    expect(readFileSync(f.leaf, 'utf8'), 'the replacement was not written').toBe(LINE);
    r.snapshot.release();
  });

  it('a changed byte under the same file is changed', () => {
    const f = planted(LINE);
    const j = createLandingJournal(f.dir);
    const r = j.read();
    if (!r.ok) throw new Error('read');
    writeFileSync(f.leaf, LINE.replace('lane-a', 'lane-b'));
    expect(j.confirmDurable(r.snapshot)).toEqual({ ok: false, error: 'changed' });
    r.snapshot.release();
  });

  it('a journal appearing after an absence snapshot is changed, and is never confirmed', () => {
    const f = fx();
    const j = createLandingJournal(f.dir);
    const r = j.read();
    if (!r.ok) throw new Error('read');
    writeFileSync(f.leaf, LINE);
    expect(j.confirmDurable(r.snapshot)).toEqual({ ok: false, error: 'changed' });
    expect(j.append(r.snapshot, REC)).toMatchObject({ ok: false, error: 'changed', mayApply: true });
    expect(readFileSync(f.leaf, 'utf8')).toBe(LINE);
    r.snapshot.release();
  });

  it('a replaced parent directory is changed', () => {
    const f = fx();
    const sub = path.join(f.dir, 'sub');
    mkdirSync(sub);
    const j = createLandingJournal(sub);
    const r = j.read();
    if (!r.ok) throw new Error('read');
    renameSync(sub, path.join(f.dir, 'sub-moved'));
    mkdirSync(sub);
    expect(j.confirmDurable(r.snapshot)).toEqual({ ok: false, error: 'changed' });
    r.snapshot.release();
  });

  it('release is idempotent, writes nothing, and makes the snapshot unusable', () => {
    const f = planted(LINE);
    const { ops, calls } = recording();
    const j = createLandingJournal(f.dir, ops);
    const r = j.read();
    if (!r.ok) throw new Error('read');
    r.snapshot.release();
    r.snapshot.release();
    const opens = calls.filter((c) => c.op === 'open').length;
    const closes = calls.filter((c) => c.op === 'close').length;
    expect(closes, 'every descriptor the read opened is closed exactly once').toBe(opens);
    expect(calls.some((c) => c.op === 'write')).toBe(false);
    expect(j.confirmDurable(r.snapshot)).toMatchObject({ ok: false });
    expect(j.append(r.snapshot, REC2)).toMatchObject({ ok: false, mayApply: true });
    expect(readFileSync(f.leaf, 'utf8')).toBe(LINE);
  });

  it('a snapshot from another journal, or a forged one, is refused', () => {
    const a = planted(LINE);
    const b = planted(LINE);
    const ra = createLandingJournal(a.dir).read();
    if (!ra.ok) throw new Error('read');
    const jb = createLandingJournal(b.dir);
    expect(jb.confirmDurable(ra.snapshot)).toMatchObject({ ok: false });
    expect(jb.confirmDurable({ release() { /* forged */ } })).toMatchObject({ ok: false });
    expect(jb.append({ release() { /* forged */ } }, REC2)).toMatchObject({ ok: false, mayApply: true });
    expect(readFileSync(b.leaf, 'utf8')).toBe(LINE);
    ra.snapshot.release();
  });
});

describe('the append (shared contract §2)', () => {
  it('appends one JSON record plus LF to a present journal', () => {
    const f = planted(LINE);
    const j = createLandingJournal(f.dir);
    const r = j.read();
    if (!r.ok) throw new Error('read');
    expect(j.append(r.snapshot, REC2)).toEqual({ ok: true });
    expect(readFileSync(f.leaf, 'utf8')).toBe(`${LINE}${JSON.stringify(REC2)}\n`);
    r.snapshot.release();
  });

  it('creates an absent journal exclusively with mode 0600, in a directory it does not create', () => {
    const f = fx();
    const { ops, calls } = recording();
    const j = createLandingJournal(f.dir, ops);
    const r = j.read();
    if (!r.ok) throw new Error('read');
    expect(j.append(r.snapshot, REC)).toEqual({ ok: true });
    expect(readFileSync(f.leaf, 'utf8')).toBe(LINE);
    expect(statSync(f.leaf).mode & 0o777).toBe(0o600);
    const create = calls.find((c) => c.op === 'open' && c.path === f.leaf && ((c.flags ?? 0) & FS.O_CREAT) !== 0);
    expect(create, 'the creating open').toBeDefined();
    expect((create!.flags ?? 0) & FS.O_EXCL).toBe(FS.O_EXCL);
    expect((create!.flags ?? 0) & FS.O_NOFOLLOW).toBe(FS.O_NOFOLLOW);
    r.snapshot.release();
  });

  it('an absent-journal append refuses when the leaf was created meanwhile', () => {
    const f = fx();
    const j = createLandingJournal(f.dir);
    const r = j.read();
    if (!r.ok) throw new Error('read');
    writeFileSync(f.leaf, 'other\n');
    expect(j.append(r.snapshot, REC)).toMatchObject({ ok: false, error: 'changed', mayApply: true });
    expect(readFileSync(f.leaf, 'utf8')).toBe('other\n');
    r.snapshot.release();
  });

  it('append-file-sync-before-ack', () => {
    const f = planted(LINE);
    const { ops, calls } = recording();
    const j = createLandingJournal(f.dir, ops);
    const r = j.read();
    if (!r.ok) throw new Error('read');
    const mark = calls.length;
    expect(j.append(r.snapshot, REC2)).toEqual({ ok: true });
    const after = calls.slice(mark);
    const w = after.findIndex((c) => c.op === 'write');
    const fileSync = after.findIndex((c) => c.op === 'fsync' && c.label === f.leaf);
    expect(w, 'a write').toBeGreaterThanOrEqual(0);
    expect(fileSync, 'the file descriptor the record was written through is synced').toBeGreaterThan(w);
    expect(after[fileSync]!.fd, 'the same descriptor').toBe(after[w]!.fd);
    // and a failing file fsync is never an ack
    const g = planted(LINE);
    const faulty = recording({ fsyncSync: (_fd, real, label) => { if (label === g.leaf) throw Object.assign(new Error('x'), { code: 'EIO' }); real(); } });
    const jg = createLandingJournal(g.dir, faulty.ops);
    const rg = jg.read();
    if (!rg.ok) throw new Error('read');
    expect(jg.append(rg.snapshot, REC2)).toMatchObject({ ok: false, error: 'durability', mayApply: true });
    rg.snapshot.release();
    r.snapshot.release();
  });

  it('append-directory-sync-before-ack', () => {
    const f = planted(LINE);
    const { ops, calls } = recording();
    const j = createLandingJournal(f.dir, ops);
    const r = j.read();
    if (!r.ok) throw new Error('read');
    const mark = calls.length;
    expect(j.append(r.snapshot, REC2)).toEqual({ ok: true });
    const after = calls.slice(mark);
    const fileSync = after.findIndex((c) => c.op === 'fsync' && c.label === f.leaf);
    const dirSync = after.findIndex((c) => c.op === 'fsync' && c.label === f.dir);
    expect(dirSync, 'the parent directory is synced').toBeGreaterThan(fileSync);
    const g = planted(LINE);
    const faulty = recording({ fsyncSync: (_fd, real, label) => { if (label === g.dir) throw Object.assign(new Error('x'), { code: 'EIO' }); real(); } });
    const jg = createLandingJournal(g.dir, faulty.ops);
    const rg = jg.read();
    if (!rg.ok) throw new Error('read');
    expect(jg.append(rg.snapshot, REC2)).toMatchObject({ ok: false, error: 'durability', mayApply: true });
    expect(readFileSync(g.leaf, 'utf8'), 'nothing is rolled back').toBe(`${LINE}${JSON.stringify(REC2)}\n`);
    rg.snapshot.release();
    r.snapshot.release();
  });

  it('a short write is completed, never retried as a second record', () => {
    const f = planted(LINE);
    const { ops, calls } = recording({ writeSync: (fd, buf, off, len) => writeSync(fd, buf, off, Math.min(len, 7)) });
    const j = createLandingJournal(f.dir, ops);
    const r = j.read();
    if (!r.ok) throw new Error('read');
    expect(j.append(r.snapshot, REC2)).toEqual({ ok: true });
    expect(readFileSync(f.leaf, 'utf8')).toBe(`${LINE}${JSON.stringify(REC2)}\n`);
    expect(calls.filter((c) => c.op === 'write').length).toBeGreaterThan(1);
    r.snapshot.release();
  });

  it('a failed write is unwritable with mayApply, and truncates nothing', () => {
    const f = planted(LINE);
    let n = 0;
    const { ops } = recording({
      writeSync: (fd, buf, off, len) => {
        n += 1;
        if (n === 1) return writeSync(fd, buf, off, 5);
        throw Object.assign(new Error('x'), { code: 'ENOSPC' });
      },
    });
    const j = createLandingJournal(f.dir, ops);
    const r = j.read();
    if (!r.ok) throw new Error('read');
    expect(j.append(r.snapshot, REC2)).toEqual({ ok: false, error: 'unwritable', mayApply: true });
    expect(readFileSync(f.leaf, 'utf8').length, 'the partial bytes stay').toBe(LINE.length + 5);
    r.snapshot.release();
  });

  it('a zero-byte write is unwritable, not an endless loop', () => {
    const f = planted(LINE);
    const { ops } = recording({ writeSync: () => 0 });
    const j = createLandingJournal(f.dir, ops);
    const r = j.read();
    if (!r.ok) throw new Error('read');
    expect(j.append(r.snapshot, REC2)).toEqual({ ok: false, error: 'unwritable', mayApply: true });
    r.snapshot.release();
  });

  it('the snapshot is unusable after an append', () => {
    const f = planted(LINE);
    const j = createLandingJournal(f.dir);
    const r = j.read();
    if (!r.ok) throw new Error('read');
    expect(j.append(r.snapshot, REC2)).toEqual({ ok: true });
    expect(j.append(r.snapshot, entry(3, 3) as unknown as LandingJournalRecord)).toMatchObject({ ok: false, mayApply: true });
    expect(j.confirmDurable(r.snapshot)).toMatchObject({ ok: false });
    expect(readFileSync(f.leaf, 'utf8')).toBe(`${LINE}${JSON.stringify(REC2)}\n`);
    r.snapshot.release();
  });

  it('refuses an append to a journal whose bytes changed since the snapshot', () => {
    const f = planted(LINE);
    const j = createLandingJournal(f.dir);
    const r = j.read();
    if (!r.ok) throw new Error('read');
    writeFileSync(f.leaf, `${LINE}${LINE}`);
    expect(j.append(r.snapshot, REC2)).toMatchObject({ ok: false, error: 'changed', mayApply: true });
    expect(readFileSync(f.leaf, 'utf8')).toBe(`${LINE}${LINE}`);
    r.snapshot.release();
  });
});

describe('the append: descriptor balance and open failures', () => {
  it('a successful read-release and a successful append close every descriptor', () => {
    const f = planted(LINE);
    const a = recording();
    const ja = createLandingJournal(f.dir, a.ops);
    const ra = ja.read();
    if (!ra.ok) throw new Error('read');
    expect(ja.append(ra.snapshot, REC2)).toEqual({ ok: true });
    expectBalanced(a.calls);
  });

  it('a failed append (fsync failure) closes every descriptor', () => {
    const f = planted(LINE);
    const { ops, calls } = recording({ fsyncSync: (_fd, real, label) => { if (label === f.leaf) throw Object.assign(new Error('x'), { code: 'EIO' }); real(); } });
    const j = createLandingJournal(f.dir, ops);
    const r = j.read();
    if (!r.ok) throw new Error('read');
    expect(j.append(r.snapshot, REC2)).toMatchObject({ ok: false, error: 'durability', mayApply: true });
    expectBalanced(calls);
  });

  it('a changed append (replacement) closes every descriptor', () => {
    const f = planted(LINE);
    const { ops, calls } = recording();
    const j = createLandingJournal(f.dir, ops);
    const r = j.read();
    if (!r.ok) throw new Error('read');
    renameSync(f.leaf, path.join(f.dir, 'old.log'));
    writeFileSync(f.leaf, LINE);
    expect(j.append(r.snapshot, REC2)).toMatchObject({ ok: false, error: 'changed', mayApply: true });
    expectBalanced(calls);
  });

  it('EACCES, EPERM and EROFS opening an existing journal for append are unwritable, with mayApply', () => {
    for (const code of ['EACCES', 'EPERM', 'EROFS']) {
      const f = planted(LINE);
      const { ops, calls } = recording({
        openSync: (p, flags, mode) => {
          if (p === f.leaf && (flags & FS.O_APPEND) !== 0) throw Object.assign(new Error('x'), { code });
          return openSync(p, flags, mode);
        },
      });
      const j = createLandingJournal(f.dir, ops);
      const r = j.read();
      if (!r.ok) throw new Error('read');
      expect(j.append(r.snapshot, REC2), code).toEqual({ ok: false, error: 'unwritable', mayApply: true });
      expect(readFileSync(f.leaf, 'utf8')).toBe(LINE);
      expectBalanced(calls);
    }
  });
});

describe('the parser: pinned edge words', () => {
  it('a record missing v is a version failure', () => {
    const { v: _v, ...noV } = entry(1, 1);
    expect(parseLandingJournal(text(noV))).toEqual(bad('version', 1));
  });

  it('a whitespace-only tail with no newline is torn', () => {
    expect(parseLandingJournal(`${JSON.stringify(entry(1, 1))}\n  `)).toEqual(bad('torn', 2));
  });
});
