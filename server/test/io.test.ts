import { describe, it, expect, vi } from 'vitest';
import { appendFileSync, chmodSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { localIO, type FleetIO } from '../src/io.js';
import { mkTmp } from './tmpHelpers.js';

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
