/**
 * The sidecar carry links through a verified common mount (D-4500), and a
 * copy says why and how much (D-4501) — issue #317.
 *
 * THE DEFECT, measured on a real kernel. Each account root on the fleet is its
 * own bind mount of one filesystem, and link(2) answers EXDEV between two
 * vfsmounts even on one superblock, so every first carry's `cp -al` failed and
 * fell back to `cp -a`, and every merge's `os.link` to `copy2` — logged as a
 * bare `(copy)`, or not at all inside a merge's `+N`. ccd never asked whether a
 * third mount — the filesystem mounted whole — exposes both roots, where the
 * same link succeeds.
 *
 * WHAT THIS FILE PINS. `_carry_link_route` reads the mount table, finds a
 * read-write mount of that filesystem under which both trees appear, and hands
 * back the two alias paths ONLY when each one's (st_dev, st_ino) equals its
 * original's; every other answer is a cause word from ccd's closed
 * `CARRY_CAUSES`. The route is lazy — asked only after a direct link failed —
 * and every copy that follows names its cause and its bytes.
 *
 * THE RIG (`fixtures/fakeMountKernel.ts`). A fixture HOME is one directory on
 * one mount, where every link succeeds, so the bind-mount geometry is faked in
 * two halves: a mountinfo TABLE the route reads (the harness hands ccd
 * `CCD_MOUNTINFO`, so no case ever reads the CI host's own table), and a fake
 * KERNEL — a `sitecustomize.py` that makes `os.link` answer EXDEV across the
 * table's mounts, and a `cp()` stub that fails `cp -al` the same way. Every
 * case here runs on macOS too; only the real-kernel case at the foot is Linux,
 * and probe-gated. Fixture HOMEs only.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness, CCD } from './ccdWsHelpers.js';
import { bindFixture, mountRow } from './fixtures/fakeMountKernel.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-carry-route-'); });
afterEach(() => {
  // C8 leaves `vol/home` unsearchable; the cleanup must be able to walk it.
  try { fs.chmodSync(path.join(h.home, 'vol', 'home'), 0o755); } catch { /* not every case has one */ }
  h.cleanup();
});

/** The words ccd's route may answer, read from the one place they are spelled
 *  (empty when ccd spells none, which the census cases then report). */
const carryCauses = (): string[] => {
  const m = /^CARRY_CAUSES = \(([^)]*)\)$/m.exec(fs.readFileSync(CCD, 'utf8'));
  return m ? [...m[1]!.matchAll(/'([a-z-]+)'/g)].map((x) => x[1]!) : [];
};

// The fake kernel's `/dev/shm` — a real second filesystem — exists only on Linux.
const SHM = '/dev/shm';
const crossDevice = ((): boolean => {
  try { return fs.statSync(SHM).isDirectory() && fs.statSync(SHM).dev !== fs.statSync(os.tmpdir()).dev; }
  catch { return false; }
})();

describe('_carry_link_route: the geometry', () => {
  const A = (): string => path.join(h.home, '.claude', 'projects', 'P');
  const B = (): string => path.join(h.home, '.claude-d', 'projects', 'P');
  const COMMON = (): string => mountRow({ id: 29, majmin: '0:99', root: '/', target: path.join(h.home, 'vol') });
  /** The two account roots, each its own mount of 0:99, plus `rows`; `vol/home/<root>` symlinked. */
  const table = (...rows: string[]): void => {
    fs.mkdirSync(A(), { recursive: true });
    fs.mkdirSync(B(), { recursive: true });
    bindFixture(h.home, { common: 'none', extra: rows });
  };
  /** `CARRY_ROUTE|CARRY_A2|CARRY_B2` after one call. */
  const route = (a = A(), b = B(), env: NodeJS.ProcessEnv = {}): string =>
    h.sh(`_carry_link_route "${a}" "${b}"; printf '%s|%s|%s' "$CARRY_ROUTE" "$CARRY_A2" "$CARRY_B2"`, env);
  const word = (r: string): string => r.split('|')[0]!;
  const seen: string[] = [];
  const routed = (r: string): string => { seen.push(word(r)); return r; };

  it('R1 a read-write mount of the whole filesystem exposes both trees: via, with the exact alias paths', () => {
    table(COMMON());
    expect(routed(route())).toBe(`via|${h.home}/vol/home/.claude/projects/P|${h.home}/vol/home/.claude-d/projects/P`);
  });

  it('R2 a path reached through a symlink still routes (the holding mount is found for the RESOLVED path)', () => {
    table(COMMON());
    fs.symlinkSync(h.home, path.join(h.home, 'hl'));
    expect(word(routed(route(path.join(h.home, 'hl', '.claude', 'projects', 'P'), path.join(h.home, 'hl', '.claude-d', 'projects', 'P')))))
      .toBe('via');
  });

  it('R3 a mount rooted at /home/.cl is not an ancestor of /home/.claude (component boundary): exdev-no-root', () => {
    table(mountRow({ id: 33, majmin: '0:99', root: '/home/.cl', target: path.join(h.home, 'trap') }));
    expect(word(routed(route()))).toBe('exdev-no-root');
  });

  it('R4 two rows on one target, read-only then read-write: the LATER row is the mount on top, so via', () => {
    const vol = path.join(h.home, 'vol');
    table(mountRow({ id: 29, majmin: '0:99', root: '/', target: vol, opts: 'ro' }),
      mountRow({ id: 30, majmin: '0:99', root: '/', target: vol, opts: 'rw' }));
    expect(word(routed(route()))).toBe('via');
  });

  it('R5 another mount stacked over the alias path rules the candidate out: exdev-no-root', () => {
    table(COMMON(), mountRow({ id: 34, parent: 29, majmin: '0:55', root: '/', target: path.join(h.home, 'vol', 'home') }));
    expect(word(routed(route()))).toBe('exdev-no-root');
  });

  it('R6 one mount holds both trees, so the link failed for another reason: link-failed', () => {
    fs.mkdirSync(A(), { recursive: true });
    fs.mkdirSync(B(), { recursive: true });
    fs.writeFileSync(path.join(h.home, '.fixture-mountinfo'), `${mountRow({ id: 20, parent: 1, majmin: '8:1', root: '/', target: '/' })}\n`);
    expect(word(routed(route()))).toBe('link-failed');
  });

  it('R7 a table with no line that parses: mounts-unreadable', () => {
    table();
    fs.writeFileSync(path.join(h.home, '.fixture-mountinfo'), 'garbage\nmore garbage\n');
    expect(word(routed(route()))).toBe('mounts-unreadable');
  });

  it('R7b a table in which no mount holds the path: mounts-unreadable', () => {
    table();
    fs.writeFileSync(path.join(h.home, '.fixture-mountinfo'),
      `${mountRow({ id: 40, majmin: '0:99', root: '/', target: path.join(h.home, 'elsewhere') })}\n`);
    expect(word(routed(route()))).toBe('mounts-unreadable');
  });

  it('R8 no table at all (macOS, or no /proc): mounts-absent — the harness default', () => {
    fs.mkdirSync(A(), { recursive: true });
    fs.mkdirSync(B(), { recursive: true });
    expect(routed(route())).toBe('mounts-absent||');
  });

  it.skipIf(!crossDevice)('R9 two different filesystems, by stat: exdev-other-fs', () => {
    table(COMMON());
    const other = fs.mkdtempSync(path.join(SHM, 'ccrc-carry-route-'));
    try {
      expect(word(routed(route(A(), other)))).toBe('exdev-other-fs');
    } finally { fs.rmSync(other, { recursive: true, force: true }); }
  });

  it('R9b the two holding mounts name different devices in the table: exdev-other-fs', () => {
    fs.mkdirSync(A(), { recursive: true });
    fs.mkdirSync(B(), { recursive: true });
    bindFixture(h.home, { common: 'none', roots: ['.claude'] });
    fs.appendFileSync(path.join(h.home, '.fixture-mountinfo'),
      `${mountRow({ id: 32, majmin: '0:98', root: '/', target: path.join(h.home, '.claude-d') })}\n`);
    expect(word(routed(route()))).toBe('exdev-other-fs');
  });

  it('R10 every word the cases above answered is one of ccd\'s CARRY_CAUSES (or via)', () => {
    expect(seen.length, 'the cases above ran first, in this file').toBeGreaterThanOrEqual(9);
    const causes = carryCauses();
    expect(causes).toContain('route-error');
    for (const w of seen) expect(['via', ...causes], w).toContain(w);
  });

  it('R10b census: every cause word the bash side spells is one of CARRY_CAUSES', () => {
    // `CARRY_CAUSES` is spelled once, in the carry's Python; the bash side may
    // set only words from it (its `route-error` default, `root-failed`).
    const words = [...fs.readFileSync(CCD, 'utf8').matchAll(/\bCARRY_ROUTE=([a-z][a-z-]*)/g)].map((m) => m[1]!);
    expect(words.length, 'the bash side sets at least its default').toBeGreaterThanOrEqual(1);
    const causes = carryCauses();
    expect(causes.length, 'ccd spells CARRY_CAUSES').toBeGreaterThan(0);
    for (const w of new Set(words)) expect([...causes, 'via'], w).toContain(w);
  });
});
