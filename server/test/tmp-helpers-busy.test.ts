// `removeTmpFixtures` (test/tmpHelpers.ts) on a platform that cannot unlink an
// open file.
//
// POSIX unlinks a file whatever holds it open; Windows refuses with EBUSY while
// any handle lives. Suites that open `~/.ccrc/coord.db` in a fixture home keep
// the `node:sqlite` handle for the worker's life, so the net-underneath cleanup
// threw in `afterAll` and vitest marked whole files failed with every test in
// them green — measured, `fleet.test.ts` 87/87 passed, file FAILED.
//
// The real handle is used, not a stand-in: libuv opens ordinary files with
// FILE_SHARE_DELETE, so a plain `fs.openSync` would NOT reproduce the refusal
// and this file would pass for the wrong reason.
import { describe, it, expect } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const onWin = process.platform === 'win32';

function holdOpenDb(): { dir: string; db: DatabaseSync } {
  const dir = mkTmp('ccrc-busy-');
  const db = new DatabaseSync(path.join(dir, 'coord.db'));
  db.exec('CREATE TABLE t (x INTEGER)');
  return { dir, db };
}

describe('removeTmpFixtures and a handle this process still holds', () => {
  it.skipIf(!onWin)('on win32 leaves the busy directory and REPORTS it, instead of failing the file', () => {
    const { dir, db } = holdOpenDb();
    try {
      expect(removeTmpFixtures()).toEqual([dir]);
      expect(existsSync(dir)).toBe(true);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!onWin)('is scoped to the PLATFORM — the same EBUSY on any other platform still throws', () => {
    // The negative control: a tolerance that swallowed EBUSY everywhere would
    // hide a real leak on a box where unlinking an open file is supposed to work.
    const { dir, db } = holdOpenDb();
    try {
      // `removeTmpFixtures` reads the platform at call time and takes no parameter (vitest's hook form), so the other
      // platform is stubbed for this one call and put back before anything else runs.
      const real = Object.getOwnPropertyDescriptor(process, 'platform')!;
      Object.defineProperty(process, 'platform', { ...real, value: 'linux' });
      try { expect(() => removeTmpFixtures()).toThrow(/EBUSY|EPERM/); } finally { Object.defineProperty(process, 'platform', real); }
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('removes an unheld fixture and reports nothing left, on every platform', () => {
    const dir = mkTmp('ccrc-free-');
    expect(removeTmpFixtures()).toEqual([]);
    expect(existsSync(dir)).toBe(false);
  });
});
