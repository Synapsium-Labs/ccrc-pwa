// The node delegation file port's characterization pin (D-7509; ARCH-05, Task RS6; plan
// 2026-10-29-consolidation-ring-exemption-drain-server.md; spec §5.1 rule 1). RS6 moves `nodeDelegationFilePort` (with
// `wrapHandle` and `isEnoent`) out of the delegation journal into its own module, so the journal becomes L1. This file pins the
// adapter's caller-visible behaviour AS IT IS before the move, so the move proves it carried bytes and nothing else:
//
//   - absence is `null` from `readFile`, `openRead`, `listDir` and `statFile`, and ONLY for ENOENT: any other failure throws, so
//     an unreadable file is never mistaken for an absent one;
//   - `createTemp` and `openAppend` create their file with mode 0600, and `mkdirp` its directories with 0700; `createTemp` cuts an
//     existing file and `openAppend` adds after its bytes; a handle's `write` answers the byte count the OS accepted;
//   - `rename`, `listDir`, `fsyncDir`, `fsyncFile`, `truncate` and the read handle on the happy path.
//
// SAFETY: a temp directory per test (`mkTmp`); nothing here reads or writes the live `~/.ccrc`.
import { describe, it, expect } from 'vitest';
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { nodeDelegationFilePort as port } from '../src/coord/delegation-file-port.js';
import { mkTmp } from './tmpHelpers.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const modeOf = (p: string): number => statSync(p).mode & 0o777;
const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
const codeOf = async (run: () => Promise<unknown>): Promise<string> => {
  try { await run(); return 'resolved'; } catch (err) { return String((err as { code?: unknown }).code); }
};

describe('nodeDelegationFilePort: absence is null only for ENOENT', () => {
  it('readFile: an absent file is null; a present one is its bytes', async () => {
    const dir = mkTmp('dfp-read-');
    expect(await port.readFile(path.join(dir, 'absent'))).toBeNull();
    writeFileSync(path.join(dir, 'f'), 'abc\n');
    expect(Array.from((await port.readFile(path.join(dir, 'f')))!)).toEqual(Array.from(enc('abc\n')));
  });
  it('readFile: any other failure throws (ENOTDIR, EISDIR)', async () => {
    const dir = mkTmp('dfp-read-');
    writeFileSync(path.join(dir, 'f'), 'x');
    expect(await codeOf(() => port.readFile(path.join(dir, 'f', 'child')))).toBe('ENOTDIR');
    expect(await codeOf(() => port.readFile(dir))).toBe('EISDIR');
  });
  it.skipIf(asRoot)('readFile and openRead: EACCES throws, never null', async () => {
    const dir = mkTmp('dfp-read-');
    const f = path.join(dir, 'f');
    writeFileSync(f, 'x');
    chmodSync(f, 0o000);
    try {
      expect(await codeOf(() => port.readFile(f))).toBe('EACCES');
      expect(await codeOf(() => port.openRead(f))).toBe('EACCES');
    } finally {
      chmodSync(f, 0o600);
    }
  });
  it('openRead: an absent file is null; any other failure throws; a present one reads at positions', async () => {
    const dir = mkTmp('dfp-openread-');
    expect(await port.openRead(path.join(dir, 'absent'))).toBeNull();
    writeFileSync(path.join(dir, 'f'), 'x');
    expect(await codeOf(() => port.openRead(path.join(dir, 'f', 'child')))).toBe('ENOTDIR');
    writeFileSync(path.join(dir, 'g'), 'hello world');
    const h = (await port.openRead(path.join(dir, 'g')))!;
    try {
      expect(await h.size()).toBe(11);
      expect(new TextDecoder().decode(await h.read(6, 5))).toBe('world');
      expect(new TextDecoder().decode(await h.read(6, 100)), 'a read past the end is cut to the bytes read').toBe('world');
    } finally {
      await h.close();
    }
  });
  it('listDir and statFile: an absent path is null; any other failure throws', async () => {
    const dir = mkTmp('dfp-list-');
    expect(await port.listDir(path.join(dir, 'absent'))).toBeNull();
    expect(await port.statFile(path.join(dir, 'absent'))).toBeNull();
    writeFileSync(path.join(dir, 'f'), 'x');
    expect(await codeOf(() => port.listDir(path.join(dir, 'f')))).toBe('ENOTDIR');
    expect(await codeOf(() => port.statFile(path.join(dir, 'f', 'child')))).toBe('ENOTDIR');
  });
});

describe('nodeDelegationFilePort: modes and the bytes each open writes', () => {
  it('createTemp creates its file 0600 and cuts an existing one; write answers the bytes accepted', async () => {
    const dir = mkTmp('dfp-temp-');
    const f = path.join(dir, 'cp.tmp');
    const h = await port.createTemp(f);
    expect(await h.write(enc('first'))).toBe(5);
    await h.sync();
    await h.close();
    expect(modeOf(f)).toBe(0o600);
    expect(readFileSync(f, 'utf8')).toBe('first');
    const again = await port.createTemp(f);
    expect(await again.write(enc('ab'))).toBe(2);
    await again.close();
    expect(readFileSync(f, 'utf8'), 'O_TRUNC: the old bytes are gone').toBe('ab');
  });
  it('openAppend creates its file 0600 and adds after the bytes already there', async () => {
    const dir = mkTmp('dfp-append-');
    const f = path.join(dir, 'journal.log');
    const h = await port.openAppend(f);
    expect(await h.write(enc('one\n'))).toBe(4);
    await h.sync();
    await h.close();
    expect(modeOf(f)).toBe(0o600);
    const again = await port.openAppend(f);
    await again.write(enc('two\n'));
    await again.close();
    expect(readFileSync(f, 'utf8'), 'O_APPEND: nothing is cut').toBe('one\ntwo\n');
  });
  it('mkdirp creates every missing directory 0700 and is idempotent', async () => {
    const dir = mkTmp('dfp-mkdirp-');
    const deep = path.join(dir, 'a', 'b');
    await port.mkdirp(deep);
    expect(modeOf(path.join(dir, 'a'))).toBe(0o700);
    expect(modeOf(deep)).toBe(0o700);
    await port.mkdirp(deep);
    expect(statSync(deep).isDirectory()).toBe(true);
  });
});

describe('nodeDelegationFilePort: the happy path of the rest', () => {
  it('rename moves a file over another; listDir names the entries; statFile answers size and mtime', async () => {
    const dir = mkTmp('dfp-rename-');
    writeFileSync(path.join(dir, 'a.tmp'), 'new');
    writeFileSync(path.join(dir, 'a'), 'old');
    await port.rename(path.join(dir, 'a.tmp'), path.join(dir, 'a'));
    expect(readFileSync(path.join(dir, 'a'), 'utf8')).toBe('new');
    expect((await port.listDir(dir))!.sort()).toEqual(['a']);
    const st = (await port.statFile(path.join(dir, 'a')))!;
    expect(st.size).toBe(3);
    expect(st.mtimeMs).toBe(statSync(path.join(dir, 'a')).mtimeMs);
    expect(Object.keys(st).sort()).toEqual(['mtimeMs', 'size']);
  });
  it('fsyncDir and fsyncFile resolve on an existing path and change nothing; fsyncDir throws on an absent one', async () => {
    const dir = mkTmp('dfp-fsync-');
    mkdirSync(path.join(dir, 'sub'));
    writeFileSync(path.join(dir, 'f'), 'keep');
    expect(await port.fsyncDir(dir)).toBeUndefined();
    expect(await port.fsyncFile(path.join(dir, 'f'))).toBeUndefined();
    expect(readFileSync(path.join(dir, 'f'), 'utf8')).toBe('keep');
    expect((await port.listDir(dir))!.sort()).toEqual(['f', 'sub']);
    expect(await codeOf(() => port.fsyncDir(path.join(dir, 'absent')))).toBe('ENOENT');
  });
  it('truncate cuts a file to the length it is given', async () => {
    const dir = mkTmp('dfp-truncate-');
    writeFileSync(path.join(dir, 'f'), 'complete\ntorn');
    await port.truncate(path.join(dir, 'f'), 9);
    expect(readFileSync(path.join(dir, 'f'), 'utf8')).toBe('complete\n');
  });
});
