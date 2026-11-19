// ccd/lib/door.sh — the Overlord's door process, ccd's side (spec 2026-11-09 §3.6 H1; plan w1-door-process.md PR A1):
// `_door_prog_ok` (the door program's pin check) and `_door_purge` (the purge of `$REG/.door/<id>/`, called by `_reg_purge`).
//
// FIXTURE HOME ONLY (`makeCcdHarness`): `$REG` is `$HOME/.cc-sessions`, so nothing here can reach the live registry, and no
// case starts, stops or hibernates a session. The library is exercised in source mode (the harness sources ccd, which loads
// door.sh at its foot); the installed layout is modelled by setting the loader's published words (`__CCD_LAYOUT`,
// `__CCD_HASH_CMD`) and the program pin in the snippet, as the loader and the installer would have left them.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-door-lib-'); });
afterEach(() => {
  // A read-only door directory would stop the harness's own cleanup.
  try { fs.chmodSync(doorDir(), 0o755); } catch { /* absent */ }
  h.cleanup();
});

const ID = 'lane-a-project-a';
const REG = (): string => path.join(h.home, '.cc-sessions');
const doorRoot = (): string => path.join(REG(), '.door');
const doorDir = (id = ID): string => path.join(doorRoot(), id);
const NAMED = ['mcp.json', 'mcp.json.tmp', 'delta', 'delta.tmp'] as const;
const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

const plantDir = (id = ID, names: readonly string[] = NAMED): void => {
  fs.mkdirSync(doorDir(id), { recursive: true });
  for (const n of names) fs.writeFileSync(path.join(doorDir(id), n), 'secret-not-printed\n');
};

/** The program under test, planted in the fixture HOME. */
const PROG = (): string => path.join(h.home, 'door-process.mjs');
const plantProg = (text = '// the door program\n'): string => { fs.writeFileSync(PROG(), text); return PROG(); };

/** `_door_prog_ok <path>` as the INSTALLED layout: the layout word and the hashing command the loader publishes, and the pin. */
const installed = (p: string, pin: string): number => {
  const out = h.sh(`__CCD_LAYOUT=installed; __CCD_HASH_CMD=(sha256sum); __CCD_DOOR_SHA256='${pin}'; _door_prog_ok '${p}'; echo "rc=$?"`);
  return Number(/rc=(\d+)/.exec(out)?.[1]);
};
/** The same in the SOURCE layout (the harness sources the committed file, so the layout is `source`). */
const source = (p: string): number => Number(/rc=(\d+)/.exec(h.sh(`_door_prog_ok '${p}'; echo "rc=$?"`))?.[1]);

describe('_door_prog_ok: the door program\'s pin check', () => {
  it('the installed layout passes a regular file whose SHA-256 is the pin', () => {
    const p = plantProg('// pinned bytes\n');
    expect(installed(p, sha(fs.readFileSync(p)))).toBe(0);
  });

  it('the installed layout refuses a file changed after the pin was taken', () => {
    const p = plantProg('// pinned bytes\n');
    const pin = sha(fs.readFileSync(p));
    fs.appendFileSync(p, '// one more line\n');
    expect(installed(p, pin)).toBe(1);
  });

  it('the installed layout refuses a missing file', () => {
    expect(installed(path.join(h.home, 'absent.mjs'), sha('x'))).toBe(1);
  });

  it('the installed layout refuses a symbolic link, even to the pinned bytes', () => {
    const real = plantProg('// pinned bytes\n');
    const link = path.join(h.home, 'door-link.mjs');
    fs.symlinkSync(real, link);
    expect(installed(link, sha(fs.readFileSync(real)))).toBe(1);
  });

  it('the installed layout refuses while the pin is still the install-time placeholder', () => {
    const p = plantProg();
    expect(installed(p, 'stamp-at-install')).toBe(1);
  });

  it('the installed layout refuses an empty argument and a directory', () => {
    expect(installed('', sha('x'))).toBe(1);
    expect(installed(h.home, sha('x'))).toBe(1);
  });

  it('the source layout passes a readable regular file without any pin', () => {
    expect(source(plantProg())).toBe(0);
  });

  it('the source layout still refuses a missing file and a symbolic link', () => {
    expect(source(path.join(h.home, 'absent.mjs'))).toBe(1);
    const link = path.join(h.home, 'door-link.mjs');
    fs.symlinkSync(plantProg(), link);
    expect(source(link)).toBe(1);
  });
});

/** Run `_door_purge <id>` and say its rc and the unremoved record (never a file's contents). */
const purge = (id: string): { rc: number; unremoved: string } => {
  const out = h.sh(`REG_PURGE_UNREMOVED=''; _door_purge '${id}'; echo "rc=$?"; echo "unremoved=$REG_PURGE_UNREMOVED"`);
  return { rc: Number(/rc=(\d+)/.exec(out)?.[1]), unremoved: /unremoved=(.*)/.exec(out)?.[1] ?? '' };
};

describe('_door_purge: the door process\'s registry directory', () => {
  it('removes the four named files and then the empty directory', () => {
    plantDir();
    expect(purge(ID)).toEqual({ rc: 0, unremoved: '' });
    expect(fs.existsSync(doorDir())).toBe(false);
    expect(fs.existsSync(doorRoot()), 'the shared parent stays').toBe(true);
  });

  it('removes whichever of the four exist and the directory once empty', () => {
    plantDir(ID, ['mcp.json', 'delta.tmp']);
    expect(purge(ID).rc).toBe(0);
    expect(fs.existsSync(doorDir())).toBe(false);
  });

  it('leaves a planted extra file, and therefore the directory, while still removing the named files', () => {
    plantDir(ID, [...NAMED, 'planted.txt']);
    expect(purge(ID).rc).toBe(0);
    expect(fs.readdirSync(doorDir())).toEqual(['planted.txt']);
  });

  it('is a no-op success when the session has no door directory', () => {
    expect(purge(ID)).toEqual({ rc: 0, unremoved: '' });
  });

  it('touches only the named session\'s directory', () => {
    plantDir(ID);
    plantDir('lane-a-project-b');
    expect(purge(ID).rc).toBe(0);
    expect(fs.existsSync(doorDir('lane-a-project-b'))).toBe(true);
    expect(fs.readdirSync(doorDir('lane-a-project-b')).sort()).toEqual([...NAMED].sort());
  });

  it.each(['../x', '-x', 'a/b', '', 'a b'])('refuses the bad id %j with rc 1 and removes nothing', (bad) => {
    plantDir(ID);
    plantDir('x');
    const r = purge(bad);
    expect(r.rc).toBe(1);
    expect(fs.readdirSync(doorDir(ID)).sort()).toEqual([...NAMED].sort());
    expect(fs.readdirSync(doorDir('x')).sort()).toEqual([...NAMED].sort());
  });

  it.each(['.', '..'])('refuses the dot id %j, which _reg_id_ok admits: nothing under $REG/.door or $REG itself is removed', (bad) => {
    plantDir(ID);
    const reg = path.dirname(doorRoot());
    for (const n of NAMED) fs.writeFileSync(path.join(reg, n), 'x\n');
    for (const n of NAMED) fs.writeFileSync(path.join(doorRoot(), n), 'x\n');
    expect(purge(bad).rc).toBe(1);
    for (const n of NAMED) {
      expect(fs.existsSync(path.join(reg, n)), `$REG/${n}`).toBe(true);
      expect(fs.existsSync(path.join(doorRoot(), n)), `$REG/.door/${n}`).toBe(true);
    }
    expect(fs.readdirSync(doorDir(ID)).sort()).toEqual([...NAMED].sort());
  });

  it('refuses when $REG/.door is a symbolic link: nothing is removed through it, and the path is recorded', () => {
    const elsewhere = path.join(h.home, 'elsewhere');
    fs.mkdirSync(path.join(elsewhere, ID), { recursive: true });
    for (const n of NAMED) fs.writeFileSync(path.join(elsewhere, ID, n), 'x\n');
    fs.symlinkSync(elsewhere, doorRoot());
    const r = purge(ID);
    expect(r.rc).toBe(1);
    expect(r.unremoved).toBe(doorDir());
    expect(fs.readdirSync(path.join(elsewhere, ID)).sort()).toEqual([...NAMED].sort());
  });

  it('refuses when $REG/.door/<id> is a symbolic link: nothing is removed through it, and the path is recorded', () => {
    const elsewhere = path.join(h.home, 'elsewhere');
    fs.mkdirSync(elsewhere, { recursive: true });
    for (const n of NAMED) fs.writeFileSync(path.join(elsewhere, n), 'x\n');
    fs.mkdirSync(doorRoot(), { recursive: true });
    fs.symlinkSync(elsewhere, doorDir());
    const r = purge(ID);
    expect(r.rc).toBe(1);
    expect(r.unremoved).toBe(doorDir());
    expect(fs.readdirSync(elsewhere).sort()).toEqual([...NAMED].sort());
  });

  it.skipIf(isRoot)('reports a file it cannot unlink through _reg_purge_unremoved, still removes the others, and leaves the directory', () => {
    plantDir();
    fs.chmodSync(doorDir(), 0o555);   // the entries cannot be unlinked
    const r = purge(ID);
    fs.chmodSync(doorDir(), 0o755);
    expect(r.unremoved.split(', ').sort()).toEqual(NAMED.map((n) => path.join(doorDir(), n)).sort());
    expect(fs.readdirSync(doorDir()).sort()).toEqual([...NAMED].sort());
  });
});

describe('_reg_purge reaches the door directory', () => {
  it('_reg_purge <id> removes $REG/.door/<id>/ along with the row\'s registry files', () => {
    plantDir();
    fs.writeFileSync(path.join(REG(), `${ID}.uuid`), '00000000-0000-4000-8000-000000000001\n');
    h.sh(`_reg_purge '${ID}'`);
    expect(fs.existsSync(doorDir()), 'the door directory went with the row').toBe(false);
    expect(fs.existsSync(path.join(REG(), `${ID}.uuid`)), 'the row\'s own field went too').toBe(false);
  });

  it('_reg_purge leaves another session\'s door directory alone', () => {
    plantDir();
    plantDir('lane-a-project-b');
    h.sh(`_reg_purge '${ID}'`);
    expect(fs.existsSync(doorDir('lane-a-project-b'))).toBe(true);
  });
});
