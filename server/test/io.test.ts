import { describe, it, expect, vi } from 'vitest';
import { appendFileSync, chmodSync, mkdirSync, statSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { localIO, type FleetIO } from '../src/io.js';
import { mkTmp } from './tmpHelpers.js';
import { MAX_READ_B64_BYTES } from '../../agent/src/fileops.js';

const mktempDir = (): string => mkTmp('ccrc-io-');
const tmpFile = (name = 'x.txt'): string => path.join(mktempDir(), name);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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

describe('localIO.readFileB64', () => {
  it('reads a binary file back as base64, and null when missing', async () => {
    const dir = mktempDir();
    const file = path.join(dir, 'clip.png');
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    writeFileSync(file, bytes);
    expect(await localIO.readFileB64(file)).toBe(bytes.toString('base64'));
    expect(await localIO.readFileB64(path.join(dir, 'nope.png'))).toBeNull();
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
