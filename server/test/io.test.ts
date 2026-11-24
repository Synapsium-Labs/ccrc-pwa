import { describe, it, expect, vi, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync, chmodSync, constants as fsConstants, linkSync, mkdirSync, renameSync, statSync, symlinkSync, truncateSync,
  writeFileSync, type BigIntStats,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { localIO, type FleetIO } from '../src/io.js';
import { mkTmp } from './tmpHelpers.js';
import { MAX_READ_B64_BYTES, readFromMeasured } from '../../agent/src/fileops.js';

// R99's one seam. `readFileFromBytesMeasured` stats the file, then reads the range it was promised, and a file that shrinks
// in between is the case its length check exists for. The real `stat` is wrapped, never replaced: a row arms `afterStat`, and
// the wrapper lets the real answer through and THEN runs it, so the shrink is the real filesystem's, at the one moment a
// test cannot otherwise reach. Disarmed, the wrapper is the real `stat`, which is what every other row in this file sees.
const afterStat = vi.hoisted(() => ({ run: null as null | ((p: string) => void) }));
// The byte-read identity's seam (run 3531), the same pattern: the real `open` is wrapped, never replaced. `afterOpen` acts on
// the handle just opened, before anything reads it (a rename-over, controlled bigint stat facts, a short read), and `opens`
// counts the opens of each path, so a test can prove an answer opened nothing; `flags` keeps each path's last open flags.
// Disarmed, it is the real `open`.
const afterOpen = vi.hoisted(() => ({
  run: null as null | ((p: string, fh: import('node:fs/promises').FileHandle) => void), opens: new Map<string, number>(),
  flags: new Map<string, unknown>(),
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    stat: (async (p: Parameters<typeof actual.stat>[0], opts?: Parameters<typeof actual.stat>[1]) => {
      const answer = await actual.stat(p, opts as never);
      afterStat.run?.(String(p));
      return answer;
    }) as typeof actual.stat,
    open: (async (...a: Parameters<typeof actual.open>) => {
      const fh = await actual.open(...a);
      afterOpen.opens.set(String(a[0]), (afterOpen.opens.get(String(a[0])) ?? 0) + 1);
      afterOpen.flags.set(String(a[0]), a[1]);
      afterOpen.run?.(String(a[0]), fh);
      return fh;
    }) as typeof actual.open,
  };
});

const mktempDir = (): string => mkTmp('ccrc-io-');
const tmpFile = (name = 'x.txt'): string => path.join(mktempDir(), name);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

type Handle = import('node:fs/promises').FileHandle;
/** Controlled facts for one handle's BIGINT stat (the identity's), the real answer otherwise; `fail` rejects it. */
interface Facts { birth?: bigint; change?: bigint; ino?: bigint; regular?: boolean; fail?: boolean }
const withFacts = (fh: Handle, f: Facts): void => {
  const real = fh.stat.bind(fh) as (o?: { bigint?: boolean }) => Promise<unknown>;
  fh.stat = (async (o?: { bigint?: boolean }) => {
    if (o?.bigint !== true) return real(o);
    if (f.fail === true) throw Object.assign(new Error('EIO: stat failed'), { code: 'EIO' });
    const st = (await real({ bigint: true })) as BigIntStats;
    if (f.birth !== undefined) st.birthtimeNs = f.birth;
    if (f.change !== undefined) st.ctimeNs = f.change;
    if (f.ino !== undefined) st.ino = f.ino;
    if (f.regular === false) st.isFile = () => false;
    return st;
  }) as Handle['stat'];
};
/** The token as the contract states it, derived independently of the code under test. */
const tokenOf = (dev: bigint, ino: bigint, birth: bigint): string =>
  createHash('sha256').update(`read-ident-v1\0${dev}\0${ino}\0${birth}`).digest('hex');
/** A bounded answer without its optional token, which a one-call fixture file may or may not carry (its birth and change
 *  times can fall in one tick or two): present, it must be 64 hex. */
const sansIdent = <T extends object>(r: T): T => {
  if (!('ident' in r)) return r;
  expect((r as { ident: unknown }).ident).toMatch(/^[0-9a-f]{64}$/);
  const { ident: _ident, ...rest } = r as T & { ident?: unknown };
  return rest as T;
};
const u8 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s));

describe('localIO.readFile', () => {
  it('returns file content, null when missing', async () => {
    const file = tmpFile();
    writeFileSync(file, 'hello world');
    expect(await localIO.readFile(file)).toBe('hello world');
    expect(await localIO.readFile(path.join(path.dirname(file), 'nope.txt'))).toBeNull();
  });
});

describe('localIO.readFileMeasured', () => {
  it('returns {ok:true, content} for a readable file', async () => {
    const file = tmpFile();
    writeFileSync(file, 'hello world');
    expect(await localIO.readFileMeasured(file)).toEqual({ ok: true, content: 'hello world' });
  });

  it('a missing path (ENOENT) reads as {ok:false, reason:"absent"}', async () => {
    const dir = mktempDir();
    expect(await localIO.readFileMeasured(path.join(dir, 'nope.txt'))).toEqual({
      ok: false,
      reason: 'absent',
    });
  });

  it('a DIRECTORY path (EISDIR, not ENOENT) reads as {ok:false, reason:"unreadable"}', async () => {
    const dir = mktempDir();
    const sub = path.join(dir, 'a-directory');
    mkdirSync(sub);
    expect(await localIO.readFileMeasured(sub)).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('forwards an AbortSignal into the real local read and fails shut on ABORT_ERR', async () => {
    const file = tmpFile();
    writeFileSync(file, 'readable');
    const controller = new AbortController();
    controller.abort();

    expect(await localIO.readFileMeasured(file, 1_000, controller.signal)).toEqual({
      ok: false,
      reason: 'unreadable',
    });
  });

  it.skipIf(process.getuid?.() === 0)(
    'a chmod 000 file (EACCES, not ENOENT) reads as {ok:false, reason:"unreadable"}',
    async () => {
      const file = tmpFile();
      writeFileSync(file, 'secret');
      chmodSync(file, 0o000);
      try {
        expect(await localIO.readFileMeasured(file)).toEqual({ ok: false, reason: 'unreadable' });
      } finally {
        chmodSync(file, 0o644); // let fixture cleanup remove it without fighting perms
      }
    },
  );
});

describe('localIO.readFileFrom', () => {
  it('reads from a byte offset and reports the full size', async () => {
    const file = tmpFile();
    writeFileSync(file, 'abcdefghij');
    const out = await localIO.readFileFrom(file, 4);
    expect(out).toEqual({ data: 'efghij', size: 10 });
  });

  it('offset at or past size returns empty data with the real size', async () => {
    const file = tmpFile();
    writeFileSync(file, 'abc');
    expect(await localIO.readFileFrom(file, 3)).toEqual({ data: '', size: 3 });
    expect(await localIO.readFileFrom(file, 99)).toEqual({ data: '', size: 3 });
  });

  it('missing file returns null', async () => {
    const file = tmpFile();
    expect(await localIO.readFileFrom(file, 0)).toBeNull();
  });
});

describe('localIO.readFileFromMeasured', () => {
  it('EOF is a POSITIVE answer: {ok:true, data:"", size}', async () => {
    const file = tmpFile();
    writeFileSync(file, 'abc');
    expect(await localIO.readFileFromMeasured(file, 3)).toEqual({ ok: true, data: '', size: 3 });
    expect(await localIO.readFileFromMeasured(file, 99)).toEqual({ ok: true, data: '', size: 3 });
  });

  it('a missing file is {ok:false, reason:"absent"}; a DIRECTORY (stat ok, range read EISDIR) is "unreadable"', async () => {
    const dir = mktempDir();
    expect(await localIO.readFileFromMeasured(path.join(dir, 'nope'), 0)).toEqual({ ok: false, reason: 'absent' });
    expect(await localIO.readFileFromMeasured(dir, 0)).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('readFileFrom DERIVES: both failure reasons still answer null, EOF still answers {data:"",size}', async () => {
    const file = tmpFile();
    writeFileSync(file, 'abc');
    expect(await localIO.readFileFrom(file, 3)).toEqual({ data: '', size: 3 });
    expect(await localIO.readFileFrom(path.join(path.dirname(file), 'nope'), 0)).toBeNull();
  });
});

describe('localIO.readFileFromBytesMeasured', () => {
  it('returns the bytes of the range and the whole file\'s size; the EOF arm is a positive answer, not a miss', async () => {
    const file = tmpFile();
    writeFileSync(file, '0123456789');
    expect(sansIdent(await localIO.readFileFromBytesMeasured(file, 3, 4))).toEqual({ ok: true, bytes: new Uint8Array(Buffer.from('3456')), size: 10 });
    expect(sansIdent(await localIO.readFileFromBytesMeasured(file, 8, 99))).toEqual({ ok: true, bytes: new Uint8Array(Buffer.from('89')), size: 10 });
    expect(await localIO.readFileFromBytesMeasured(file, 10, 4)).toEqual({ ok: true, bytes: new Uint8Array(0), size: 10 });
  });

  // [label, offset, maxBytes, the size the file shrinks to once the stat has answered 10]
  it.each([
    ['partway through the range', 0, 10, 4],
    ['partway through a range that starts inside the file', 3, 7, 6],
    ['to before the offset: nothing at all is left to read', 6, 4, 2],
    ['to empty', 0, 10, 0],
  ] as const)('a file that SHRINKS between the stat and the read answers "unreadable", never ok with the short bytes it left (R99): %s', async (label, offset, maxBytes, shrunk) => {
    const file = tmpFile();
    writeFileSync(file, '0123456789');
    let fired = 0;
    afterStat.run = (p) => { if (p === file) { fired += 1; truncateSync(file, shrunk); } };
    try {
      expect(await localIO.readFileFromBytesMeasured(file, offset, maxBytes), label).toEqual({ ok: false, reason: 'unreadable' });
    } finally { afterStat.run = null; }
    expect(fired, 'the shrink happened between the stat and the read').toBe(1);
    expect(statSync(file).size, 'the file really is that short now').toBe(shrunk);
  });
});

// ── run 3531: the byte-read identity on the local adapter ──
describe('localIO.readFileFromBytesMeasured: one regular handle for bytes, size and identity; EOF still opens nothing', () => {
  afterEach(() => { afterOpen.run = null; afterStat.run = null; });
  const opens = (p: string): number => afterOpen.opens.get(p) ?? 0;
  const fileWith = (content: string, name = 'x.txt'): { file: string; dev: bigint; ino: bigint } => {
    const file = tmpFile(name);
    writeFileSync(file, content);
    const st = statSync(file, { bigint: true });
    return { file, dev: st.dev, ino: st.ino };
  };

  it('EOF answers from the path stat without opening the file, and carries no token', async () => {
    const { file } = fileWith('0123456789');
    afterOpen.run = (_p, fh) => withFacts(fh, { birth: 5n, change: 9n });
    expect(await localIO.readFileFromBytesMeasured(file, 10, 4)).toEqual({ ok: true, bytes: new Uint8Array(0), size: 10 });
    expect(opens(file)).toBe(0);
  });

  it.skipIf(process.getuid?.() === 0)('EOF of a file it may not read: ok empty, as before, never opened', async () => {
    const { file } = fileWith('abc', 'locked.txt');
    chmodSync(file, 0o000);
    try {
      expect(await localIO.readFileFromBytesMeasured(file, 3, 4)).toEqual({ ok: true, bytes: new Uint8Array(0), size: 3 });
    } finally { chmodSync(file, 0o644); }
    expect(opens(file)).toBe(0);
  });

  it('EOF of a directory at its exact size: ok empty, as before, never opened', async () => {
    const dir = mktempDir();
    const dirSize = statSync(dir).size;
    expect(await localIO.readFileFromBytesMeasured(dir, dirSize, 4)).toEqual({ ok: true, bytes: new Uint8Array(0), size: dirSize });
    expect(opens(dir)).toBe(0);
  });

  it('a FIFO at offset 0: ok empty, as before, never opened (so it cannot hang)', async (ctx) => {
    const fifo = path.join(mktempDir(), 'fifo');
    if (spawnSync('mkfifo', [fifo]).status !== 0) ctx.skip();
    expect(await localIO.readFileFromBytesMeasured(fifo, 0, 4)).toEqual({ ok: true, bytes: new Uint8Array(0), size: 0 });
    expect(opens(fifo)).toBe(0);
  });

  it('bytes are read through exactly one open, and carry the token of that handle when the facts are usable', async () => {
    const { file, dev, ino } = fileWith('0123456789');
    afterOpen.run = (p, fh) => { if (p === file) withFacts(fh, { birth: 5n, change: 9n }); };
    expect(await localIO.readFileFromBytesMeasured(file, 3, 4))
      .toEqual({ ok: true, bytes: u8('3456'), size: 10, ident: tokenOf(dev, ino, 5n) });
    expect(opens(file)).toBe(1);
  });

  it('the bytes arm opens read-only and NONBLOCKING, so a FIFO raced in after the path stat cannot hang the open', async () => {
    const { file } = fileWith('0123456789');
    expect(sansIdent(await localIO.readFileFromBytesMeasured(file, 0, 4))).toEqual({ ok: true, bytes: u8('0123'), size: 10 });
    const flags = afterOpen.flags.get(file);
    expect(typeof flags).toBe('number');
    expect((flags as number) & fsConstants.O_NONBLOCK).toBe(fsConstants.O_NONBLOCK);
    expect((flags as number) & (fsConstants.O_WRONLY | fsConstants.O_RDWR)).toBe(0);
  });

  it.each([
    ['birth time 0', { birth: 0n, change: 9n }],
    ['birth time negative', { birth: -1n, change: 9n }],
    ['birth equal to change', { birth: 7n, change: 7n }],
    ['birth after change', { birth: 9n, change: 5n }],
    ['inode 0', { birth: 5n, change: 9n, ino: 0n }],
  ] as const)('%s: the same bytes and size, and no token', async (_label, f) => {
    const { file } = fileWith('0123456789');
    afterOpen.run = (p, fh) => { if (p === file) withFacts(fh, f); };
    const r = await localIO.readFileFromBytesMeasured(file, 3, 4);
    expect(r).toEqual({ ok: true, bytes: u8('3456'), size: 10 });
    expect(r).not.toHaveProperty('ident');
  });

  it('a handle that is not a regular file is unreadable, and no byte is read from it', async () => {
    const { file } = fileWith('0123456789');
    let reads = 0;
    afterOpen.run = (p, fh) => {
      if (p !== file) return;
      withFacts(fh, { regular: false });
      const real = fh.read.bind(fh);
      fh.read = ((...a: Parameters<Handle['read']>) => { reads += 1; return real(...(a as [never])); }) as Handle['read'];
    };
    expect(await localIO.readFileFromBytesMeasured(file, 0, 4)).toEqual({ ok: false, reason: 'unreadable' });
    expect(reads).toBe(0);
  });

  it('a directory below its size is still unreadable', async () => {
    const dir = mktempDir();
    expect(await localIO.readFileFromBytesMeasured(dir, 0, 4)).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('a failed stat of the open handle is unreadable on this adapter (it supplies the size and the type)', async () => {
    const { file } = fileWith('0123456789');
    afterOpen.run = (p, fh) => { if (p === file) withFacts(fh, { fail: true }); };
    expect(await localIO.readFileFromBytesMeasured(file, 0, 4)).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('a rename-over AFTER the open: the old bytes with the old token, then the new bytes with a new token', async () => {
    const { file, dev, ino } = fileWith('OLD-BYTES\n');
    const next = path.join(path.dirname(file), 'next.txt');
    writeFileSync(next, 'NEW-BYTES-LONGER\n');
    const nextIno = statSync(next, { bigint: true }).ino;
    let swaps = 0;
    afterOpen.run = (p, fh) => {
      if (p !== file) return;
      withFacts(fh, { birth: 1n, change: 2n });
      if (swaps === 0) { swaps += 1; renameSync(next, file); }
    };
    expect(await localIO.readFileFromBytesMeasured(file, 0, 9)).toEqual({ ok: true, bytes: u8('OLD-BYTES'), size: 10, ident: tokenOf(dev, ino, 1n) });
    expect(swaps).toBe(1);
    expect(await localIO.readFileFromBytesMeasured(file, 0, 9)).toEqual({ ok: true, bytes: u8('NEW-BYTES'), size: 17, ident: tokenOf(dev, nextIno, 1n) });
  });

  it('a short read and a shrink after the open are unreadable, never short bytes', async () => {
    const { file } = fileWith('0123456789');
    afterOpen.run = (p, fh) => { if (p === file) fh.read = (async () => ({ bytesRead: 0, buffer: Buffer.alloc(0) })) as never; };
    expect(await localIO.readFileFromBytesMeasured(file, 0, 4)).toEqual({ ok: false, reason: 'unreadable' });
    afterOpen.run = (p) => { if (p === file) truncateSync(file, 2); };
    expect(await localIO.readFileFromBytesMeasured(file, 0, 10)).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('a file that GREW between the path stat and the open answers the handle\'s size and bytes (the named change)', async () => {
    const { file } = fileWith('0123456789');
    afterStat.run = (p) => { if (p === file) { afterStat.run = null; appendFileSync(file, 'XYZ'); } };
    expect(sansIdent(await localIO.readFileFromBytesMeasured(file, 8, 99))).toEqual({ ok: true, bytes: u8('89XYZ'), size: 13 });
  });

  it('the local and the agent derivations give the same token for the same file and facts', async () => {
    const { file, dev, ino } = fileWith('0123456789');
    afterOpen.run = (_p, fh) => withFacts(fh, { birth: 5n, change: 9n });
    const local = await localIO.readFileFromBytesMeasured(file, 0, 4);
    const agent = await readFromMeasured(file, 0, 4);
    expect(local.ok && local.ident).toBe(tokenOf(dev, ino, 5n));
    expect(agent.ok && agent.ident).toBe(tokenOf(dev, ino, 5n));
  });
});

describe('localIO.readFileB64Measured — the round trip', () => {
  it('reads a binary file back as base64, and absent when missing', async () => {
    const dir = mktempDir();
    const file = path.join(dir, 'clip.png');
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    writeFileSync(file, bytes);
    expect(await localIO.readFileB64Measured(file)).toEqual({ ok: true, dataB64: bytes.toString('base64') });
    expect(await localIO.readFileB64Measured(path.join(dir, 'nope.png'))).toEqual({ ok: false, reason: 'absent' });
  });
});

describe('localIO.readFileB64Measured', () => {
  it('round-trips bytes; a missing file is "absent"; a DIRECTORY is "unreadable"', async () => {
    const dir = mktempDir();
    const file = path.join(dir, 'clip.png');
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    writeFileSync(file, bytes);
    expect(await localIO.readFileB64Measured(file)).toEqual({ ok: true, dataB64: bytes.toString('base64') });
    expect(await localIO.readFileB64Measured(path.join(dir, 'nope.png'))).toEqual({ ok: false, reason: 'absent' });
    expect(await localIO.readFileB64Measured(dir)).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('has NO cap, deliberately — the cap is the agent WS round trip, not the file', async () => {
    // localIO must keep serving a clip the agent would refuse, or this seam
    // starts refusing files the server serves today. The divergence is
    // REPORTED (remote answers too-large, local answers the bytes), never
    // equalised — see MAX_READ_B64_BYTES's docstring in agent/src/fileops.ts.
    const dir = mktempDir();
    const file = path.join(dir, 'huge.png');
    writeFileSync(file, '');
    truncateSync(file, MAX_READ_B64_BYTES + 1);
    const r = await localIO.readFileB64Measured(file);
    expect(r.ok).toBe(true);
  });
});

describe('localIO.readdir', () => {
  it('lists entry names, null when missing/not a directory', async () => {
    const dir = mktempDir();
    writeFileSync(path.join(dir, 'a.txt'), 'x');
    writeFileSync(path.join(dir, 'b.txt'), 'y');
    const names = await localIO.readdir(dir);
    expect(names?.slice().sort()).toEqual(['a.txt', 'b.txt']);
    expect(await localIO.readdir(path.join(dir, 'nope'))).toBeNull();
    expect(await localIO.readdir(path.join(dir, 'a.txt'))).toBeNull(); // not a directory
  });
});

describe('localIO.stat', () => {
  it('reports mtimeMs + size, null when missing', async () => {
    const file = tmpFile();
    writeFileSync(file, 'abcd');
    const s = await localIO.stat(file);
    expect(s).not.toBeNull();
    expect(s!.size).toBe(4);
    expect(typeof s!.mtimeMs).toBe('number');
    expect(await localIO.stat(path.join(path.dirname(file), 'nope'))).toBeNull();
  });
});

/** `lstatMeasured` answers about the PATH; every other read on this interface
 *  answers about what the path RESOLVES TO. The pair below is the whole
 *  difference, on one fixture: `stat` follows the link and reports the target's
 *  size, `lstat` reports that the path is a link and never looks past it. */
describe('localIO.lstatMeasured', () => {
  const linkTo = (targetBytes: string): { link: string; target: string } => {
    const dir = mktempDir();
    const target = path.join(dir, 'target.txt');
    const link = path.join(dir, 'link.txt');
    writeFileSync(target, targetBytes);
    symlinkSync(target, link);
    return { link, target };
  };

  it('a plain file is `regular`', async () => {
    const file = tmpFile();
    writeFileSync(file, 'abcd');
    expect(await localIO.lstatMeasured(file)).toEqual({ ok: true, kind: 'regular' });
  });

  it('a LIVE symlink is `symlink`, and statMeasured on the same path still answers about the TARGET', async () => {
    const { link } = linkTo('abcd');
    expect(await localIO.lstatMeasured(link)).toEqual({ ok: true, kind: 'symlink' });
    // The contrast IS the reason this member exists: nothing already on this
    // interface could have told the caller what `lstatMeasured` just did.
    expect(await localIO.statMeasured(link)).toMatchObject({ ok: true, size: 4 });
  });

  it('a DANGLING symlink is still `symlink` — the link exists even though its target does not', async () => {
    const dir = mktempDir();
    const link = path.join(dir, 'dangling');
    symlinkSync(path.join(dir, 'no-such-target'), link);
    expect(await localIO.lstatMeasured(link)).toEqual({ ok: true, kind: 'symlink' });
    // And this is the residual `agent/src/fileops.ts`'s `StatResult` docstring
    // names: `stat` follows, the TARGET's ENOENT throws, and the path reads as
    // absent though its name is right there in the directory.
    expect(await localIO.statMeasured(link)).toEqual({ ok: false, reason: 'absent' });
  });

  it('a directory is `other` — never borrowing one of the two kinds that decide something', async () => {
    const dir = mktempDir();
    expect(await localIO.lstatMeasured(dir)).toEqual({ ok: true, kind: 'other' });
  });

  it('a missing path is {ok:false, reason:"absent"}, and a path THROUGH a file is "unreadable"', async () => {
    const file = tmpFile();
    writeFileSync(file, 'abcd');
    expect(await localIO.lstatMeasured(path.join(path.dirname(file), 'nope')))
      .toEqual({ ok: false, reason: 'absent' });
    expect(await localIO.lstatMeasured(path.join(file, 'child')))
      .toEqual({ ok: false, reason: 'unreadable' });
  });

  it('localIO NEVER answers `unmeasured` — that reason belongs to an io that cannot ask', async () => {
    // The fourth reason exists for the remote arm against an agent too old to
    // implement the op. This box can always ask, so a local `unmeasured` would
    // mean the reason had leaked into a position it cannot occupy.
    const dir = mktempDir();
    const file = path.join(dir, 'f.txt');
    writeFileSync(file, 'x');
    const link = path.join(dir, 'l');
    symlinkSync(file, link);
    for (const p of [file, link, dir, path.join(dir, 'nope'), path.join(file, 'child')]) {
      const r = await localIO.lstatMeasured(p);
      if (!r.ok) expect(r.reason, p).not.toBe('unmeasured');
    }
  });
});

describe('localIO.statMeasured', () => {
  it('reports {ok:true, mtimeMs, size} for a real file', async () => {
    const file = tmpFile();
    writeFileSync(file, 'abcd');
    const r = await localIO.statMeasured(file);
    expect(r.ok).toBe(true);
    expect(r).toMatchObject({ ok: true, size: 4 });
  });

  it('a missing path (ENOENT) reads as {ok:false, reason:"absent"}', async () => {
    const dir = mktempDir();
    expect(await localIO.statMeasured(path.join(dir, 'nope'))).toEqual({ ok: false, reason: 'absent' });
  });

  it('a path THROUGH a file (ENOTDIR, not ENOENT) reads as {ok:false, reason:"unreadable"}', async () => {
    const file = tmpFile();
    writeFileSync(file, 'abcd');
    expect(await localIO.statMeasured(path.join(file, 'child'))).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('stat DERIVES from statMeasured — both failure reasons still collapse to null for every existing caller', async () => {
    const file = tmpFile();
    writeFileSync(file, 'abcd');
    expect(await localIO.stat(path.join(path.dirname(file), 'nope'))).toBeNull();
    expect(await localIO.stat(path.join(file, 'child'))).toBeNull();
    // And the derivation is real, not a copy: a double that overrides ONLY
    // the measured method must reach the derived one (ioDoubles.ts's rule).
    const io: FleetIO = { ...localIO, statMeasured: async () => ({ ok: false, reason: 'unreadable' }) };
    expect(await io.stat(file)).toBeNull();
  });
});

describe('localIO.writeFileB64', () => {
  it('mkdir -ps the parent and writes the decoded bytes', async () => {
    const base = mktempDir();
    const file = path.join(base, 'deep', 'nested', 'clip.png');
    const data = Buffer.from('89504e470d0a1a0a', 'hex');
    await localIO.writeFileB64(file, data.toString('base64'));
    expect(await readFile(file)).toEqual(data);
  });
});

describe('localIO.tailFile', () => {
  it('emits appended bytes as they land', async () => {
    const file = tmpFile('t.log');
    writeFileSync(file, 'one\n');
    const chunks: Buffer[] = [];
    const resets: number[] = [];
    const close = await localIO.tailFile(
      file,
      statSync(file).size,
      (c) => chunks.push(c),
      (size) => resets.push(size),
    );
    try {
      appendFileSync(file, 'two\n');
      await vi.waitFor(() => expect(chunks.map((c) => c.toString('utf8')).join('')).toBe('two\n'), { timeout: 3000 });
      appendFileSync(file, 'three\n');
      await vi.waitFor(
        () => expect(chunks.map((c) => c.toString('utf8')).join('')).toBe('two\nthree\n'),
        { timeout: 3000 },
      );
      expect(resets).toEqual([]);
    } finally {
      close();
    }
  });

  it('emits a reset (with the size at truncation-detection time) when the file shrinks', async () => {
    const file = tmpFile('t.log');
    writeFileSync(file, 'one\ntwo\nthree\n');
    const startSize = statSync(file).size;
    const resets: number[] = [];
    const close = await localIO.tailFile(
      file,
      startSize,
      () => {},
      (size) => resets.push(size),
    );
    try {
      writeFileSync(file, 'x\n'); // shorter than before -> truncation/rotation
      await vi.waitFor(() => expect(resets).toHaveLength(1), { timeout: 3000 });
      // The exact byte count observed at the truncate instant is racy at the OS
      // fs-event layer (truncate and the rewrite can surface as separate
      // events) — callers (TranscriptTailer) treat any reset as "resync from
      // scratch" and re-read the file's current content afterward, so only
      // "smaller than where we started" is a load-bearing guarantee here.
      expect(resets[0]).toBeLessThan(startSize);
    } finally {
      close();
    }
  });

  it('close() stops further callbacks', async () => {
    const file = tmpFile('t.log');
    writeFileSync(file, 'one\n');
    const chunks: Buffer[] = [];
    const close = await localIO.tailFile(file, statSync(file).size, (c) => chunks.push(c), () => {});
    close();
    appendFileSync(file, 'two\n');
    await sleep(1800); // longer than the internal poll interval
    expect(chunks).toEqual([]);
  });
});

// D-6058 (1), accounts plan Task A12: the local arm reads as the agent's `read` op does. A FIFO is `unreadable` at once
// and its bytes stay for whoever holds it; a name directly in `~/.cc-sessions/.accounts` is opened with `O_NOFOLLOW`, so
// a symlink planted there is `unreadable`, while the same link anywhere else is still followed.
describe('localIO.readFileMeasured reads regular files only (D-6058)', () => {
  it('a FIFO a writer holds is unreadable at once, and its bytes stay in it', async () => {
    const { execFileSync } = await import('node:child_process');
    const { closeSync, constants, openSync, readSync, writeSync } = await import('node:fs');
    const fifo = path.join(mktempDir(), 'in');
    execFileSync('mkfifo', [fifo]);
    const reader = openSync(fifo, constants.O_RDONLY | constants.O_NONBLOCK);
    const writer = openSync(fifo, constants.O_WRONLY | constants.O_NONBLOCK);
    try {
      writeSync(writer, 'the-relayed-code');
      const t0 = Date.now();
      expect(await localIO.readFileMeasured(fifo)).toEqual({ ok: false, reason: 'unreadable' });
      expect(Date.now() - t0).toBeLessThan(1_000);
      const buf = Buffer.alloc(64);
      expect(buf.subarray(0, readSync(reader, buf, 0, 64, null)).toString('utf8')).toBe('the-relayed-code');
    } finally {
      closeSync(writer);
      closeSync(reader);
    }
  }, 4_000);

  it('a symlink at a lane-state name is unreadable; the same link elsewhere is followed', async () => {
    const home = mktempDir();
    const dir = path.join(home, '.cc-sessions', '.accounts');
    mkdirSync(dir, { recursive: true });
    const target = path.join(home, 'target.json');
    writeFileSync(target, '{"identity":"the-target"}');
    symlinkSync(target, path.join(dir, 'lane-a.json'));
    symlinkSync(target, path.join(home, '.cc-sessions', 'elsewhere.json'));
    expect(await localIO.readFileMeasured(path.join(dir, 'lane-a.json'))).toEqual({ ok: false, reason: 'unreadable' });
    expect(await localIO.readFileMeasured(path.join(home, '.cc-sessions', 'elsewhere.json')))
      .toEqual({ ok: true, content: '{"identity":"the-target"}' });
    expect(await localIO.readFileMeasured(path.join(dir, 'lane-b.json'))).toEqual({ ok: false, reason: 'absent' });
  });
  it('a FIFO with no writer is unreadable at once: the open never waits for one', async () => {
    const { execFileSync } = await import('node:child_process');
    const { closeSync, constants, openSync } = await import('node:fs');
    const fifo = path.join(mktempDir(), 'in');
    execFileSync('mkfifo', [fifo]);
    try {
      const t0 = Date.now();
      const r = await Promise.race([
        localIO.readFileMeasured(fifo),
        new Promise<'blocked'>((res) => setTimeout(() => res('blocked'), 1_000)),
      ]);
      expect(r).toEqual({ ok: false, reason: 'unreadable' });
      expect(Date.now() - t0).toBeLessThan(1_000);
    } finally {
      // A blocked open (the mutant) is released by a writer; with none blocked there is no reader, and ENXIO is fine.
      try { closeSync(openSync(fifo, constants.O_WRONLY | constants.O_NONBLOCK)); } catch { /* no reader waiting */ }
    }
  }, 4_000);

  it('a hardlink at a lane-state name is unreadable, never the other file\'s bytes; the other file still reads', async () => {
    const home = mktempDir();
    const dir = path.join(home, '.cc-sessions', '.accounts');
    mkdirSync(dir, { recursive: true });
    const other = path.join(home, '.claude', 'x.json');
    mkdirSync(path.dirname(other), { recursive: true });
    writeFileSync(other, '{"identity":"the-other-file"}');
    linkSync(other, path.join(dir, 'lane-a.json'));
    expect(await localIO.readFileMeasured(path.join(dir, 'lane-a.json'))).toEqual({ ok: false, reason: 'unreadable' });
    expect(await localIO.readFileMeasured(other)).toEqual({ ok: true, content: '{"identity":"the-other-file"}' });
  });

  it('a `.accounts` directory that is a symlink reads as unreadable, never the file it points at', async () => {
    const home = mktempDir();
    const away = path.join(mktempDir(), 'accounts-elsewhere');
    mkdirSync(away, { recursive: true });
    writeFileSync(path.join(away, 'lane-a.json'), '{"identity":"the-outside"}');
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    symlinkSync(away, path.join(home, '.cc-sessions', '.accounts'));
    expect(await localIO.readFileMeasured(path.join(home, '.cc-sessions', '.accounts', 'lane-a.json')))
      .toEqual({ ok: false, reason: 'unreadable' });
  });
});
