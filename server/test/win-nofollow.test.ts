// The Windows port, B9: `constants.O_NOFOLLOW` is undefined on Windows and ORed in as 0, so every open that meant to
// refuse a symlink followed it. `shared/nofollow.mjs` is the one helper: on Windows its `O_NOFOLLOW` is a marker its
// `openSync`/`open` read, `lstat`ing before the open and comparing dev/ino with the descriptor's `fstat` after it.
// Rows run on Windows (POSIX's own O_NOFOLLOW is pinned by every site's suite); each makes a real symlink.
import { afterEach, describe, expect, it } from 'vitest';
import { closeSync, constants as FS, existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { O_NOFOLLOW, open, openSync } from '../../shared/nofollow.mjs';
import { appendOnlyFileAt } from '../src/appendOnlyFile.js';
import { mkTmp } from './tmpHelpers.js';

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });
function dir(): string { const d = mkTmp('win-nofollow-'); roots.push(d); return d; }

describe.skipIf(process.platform !== 'win32')('shared/nofollow.mjs on Windows (B9)', () => {
  it('a symlink at the last component is ELOOP, sync and async; its target is never opened', async () => {
    const d = dir();
    const target = path.join(d, 'target');
    writeFileSync(target, 'secret');
    const link = path.join(d, 'link');
    symlinkSync(target, link, 'file');
    expect(() => openSync(link, FS.O_RDONLY | O_NOFOLLOW)).toThrow(expect.objectContaining({ code: 'ELOOP' }));
    await expect(open(link, FS.O_RDONLY | O_NOFOLLOW)).rejects.toMatchObject({ code: 'ELOOP' });
  });

  it('a dangling symlink is ELOOP even under O_CREAT, and nothing is created through it', () => {
    const d = dir();
    const gone = path.join(d, 'gone');
    const link = path.join(d, 'link');
    symlinkSync(gone, link, 'file');
    expect(() => openSync(link, FS.O_WRONLY | FS.O_CREAT | O_NOFOLLOW, 0o600)).toThrow(expect.objectContaining({ code: 'ELOOP' }));
    expect(existsSync(gone)).toBe(false);
  });

  it('CONTROL: a regular file opens, and an absent one is created under O_CREAT', () => {
    const d = dir();
    const f = path.join(d, 'f');
    writeFileSync(f, 'x');
    closeSync(openSync(f, FS.O_RDONLY | O_NOFOLLOW));
    const n = path.join(d, 'new');
    closeSync(openSync(n, FS.O_WRONLY | FS.O_CREAT | FS.O_EXCL | O_NOFOLLOW, 0o600));
    expect(existsSync(n)).toBe(true);
  });

  it('the append-only journal refuses a symlinked leaf, and never writes its target', () => {
    const d = dir();
    const target = path.join(d, 'elsewhere');
    writeFileSync(target, '{"a":1}\n');
    symlinkSync(target, path.join(d, 'journal.log'), 'file');
    expect(appendOnlyFileAt(d, 'journal.log').read()).toEqual({ ok: false, error: 'unreadable' });
    expect(readFileSync(target, 'utf8')).toBe('{"a":1}\n');
  });
});
