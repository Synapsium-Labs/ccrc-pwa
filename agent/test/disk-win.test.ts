// The Windows port, B11: the `claude-tmp` root was built from `${TMPDIR:-/tmp}` and `/tmp`, and native Node resolves a
// bare `/tmp` onto the cwd's drive (`C:\tmp`), a directory nothing uses, while Claude Code's temp dir is the OS one
// (%TEMP%). On win32 both templates now resolve to `os.tmpdir()`, and with no mountinfo the mount named is the drive
// root statfs measured, not the first root's path. Every disk read is injected: no real root is statted.
import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { measureDisk, type DiskSeams, type DiskStatfs } from '../src/disk.js';

const FS: DiskStatfs = { bsize: 4096, blocks: 1000, bfree: 100, bavail: 100, files: 0, ffree: 0 };
const enoent = (): Error => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });

describe.skipIf(process.platform !== 'win32')('measureDisk on Windows (B11)', () => {
  it('claude-tmp is the OS temp dir, never <drive>:\\tmp, even with an MSYS TMPDIR=/tmp; the mount is the drive root', async () => {
    const home = path.join(os.tmpdir(), 'disk-win-home');
    const statted: string[] = [];
    const seams: Partial<DiskSeams> = {
      statfs: async () => FS,
      stat: async (p) => { statted.push(p); return { dev: 7 }; },
      readMountinfo: () => null,
      readFile: () => { throw enoent(); },
      env: { TMPDIR: '/tmp' },
      deadlineMs: 1000,
    };
    const out = await measureDisk(home, seams);
    expect(statted).toContain(os.tmpdir());
    expect(statted).not.toContain(path.resolve('/tmp'));
    expect(statted).not.toContain('/tmp');
    expect(out.missing.map((m) => m.label)).not.toContain('claude-tmp');
    expect(out.filesystems).toHaveLength(1);
    expect(out.filesystems[0]).toMatchObject({ mount: path.parse(home).root, fsType: 'unknown' });
  });
});
