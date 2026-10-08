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
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness, CCD } from './ccdWsHelpers.js';
import { bindFixture, mountRow, plantFakeKernel, type BindOpts } from './fixtures/fakeMountKernel.js';
import { IS_LINUX } from './platformFixtures.js';

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

// A REAL second filesystem for R9 — `/dev/shm`, a tmpfs — exists only on Linux.
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

// ── the carry ─────────────────────────────────────────────────────────────────
const UUID = 'b7001948-3333-4bcc-b60b-0cfc0dc3d199';
const PDIR = '-w-quiet-mesa';
const R_JSON = 'tool-results/r.json';
const BODY = 'RESULT\n';   // 7 bytes

const side = (root: string, rel = ''): string => path.join(h.home, root, 'projects', PDIR, UUID, rel);
const ino = (p: string): number => fs.statSync(p).ino;
const put = (p: string, body: string): string => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  return p;
};
/** A source sidecar with one tool result, and the destination's project dir. */
const plantSource = (): void => {
  put(side('.claude', R_JSON), BODY);
  fs.mkdirSync(path.join(h.home, '.claude-d', 'projects', PDIR), { recursive: true });
};
/** The geometry plus the fake kernel: the env and the `cp()` stub every faked case runs under. */
const rig = (o: BindOpts = {}): { env: Record<string, string>; stub: string } => {
  const k = plantFakeKernel(h.home);
  return { env: { ...bindFixture(h.home, o), ...k.env }, stub: k.cpStub };
};
const carry = (r: { env: Record<string, string>; stub?: string }): void => {
  h.sh(`${r.stub ?? ''} _swap_carry_sidecars "$HOME/.claude" "$HOME/.claude-d" ${UUID} 2>>"$HOME/carry.stderr"`, r.env);
};
const swapLog = (): string => {
  const p = path.join(h.home, '.cc-sessions', 'swap.log');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
};
const stderr = (): string => {
  const p = path.join(h.home, 'carry.stderr');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
};
/** The one verdict for our destination, `(…)`. */
const verdict = (): string => {
  const rows = swapLog().split('\n').filter((l) => l.includes(` sidecar ${UUID} -> ${side('.claude-d')} (`))
    .map((l) => l.replace(/^.* \(/, '('));
  expect(rows, swapLog()).toHaveLength(1);
  return rows[0]!;
};
/** `(copy: <cause> <N> bytes)` -> [cause, N]; fails the case on any other shape. */
const copied = (): [string, number] => {
  const m = /^\(copy: ([a-z-]+) (\d+) bytes\)$/.exec(verdict());
  expect(m, verdict()).not.toBeNull();
  return [m![1]!, Number(m![2])];
};
/** Every entry under a directory, relative, with a trailing `/` on directories. */
const listing = (dir: string): string[] =>
  fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)) + (e.isDirectory() ? '/' : ''))
    .sort();

describe('the first carry: a failed cp -al routes before it copies (D-4500), and a copy says why (D-4501)', () => {
  it('C1 links through the common mount: (link: via-mount), one inode, no nest, no warning', () => {
    plantSource();
    carry(rig());
    expect(verdict()).toBe('(link: via-mount)');
    expect(ino(side('.claude-d', R_JSON))).toBe(ino(side('.claude', R_JSON)));
    expect(fs.existsSync(side('.claude-d', UUID)), 'a <uuid>/<uuid> nest').toBe(false);
    expect(stderr()).not.toContain('COPY');
  });

  it('C2 no second mount of the filesystem: (copy: exdev-no-root N bytes), N at least what was planted', () => {
    plantSource();
    carry(rig({ common: 'none' }));
    const [cause, n] = copied();
    expect(cause).toBe('exdev-no-root');
    expect(n).toBeGreaterThanOrEqual(BODY.length);
    expect(fs.readFileSync(side('.claude-d', R_JSON), 'utf8')).toBe(BODY);
    expect(ino(side('.claude-d', R_JSON))).not.toBe(ino(side('.claude', R_JSON)));
  });

  it('C3 the second mount is read-only: exdev-no-root', () => {
    plantSource();
    carry(rig({ common: 'ro' }));
    expect(copied()[0]).toBe('exdev-no-root');
  });

  it('C4 the alias is a DECOY of the right shape: root-mismatch, the real bytes land, the decoy is untouched', () => {
    plantSource();
    const r = rig({ decoy: true });
    const before = listing(path.join(h.home, 'vol'));
    carry(r);
    expect(copied()[0]).toBe('root-mismatch');
    expect(fs.readFileSync(side('.claude-d', R_JSON), 'utf8')).toBe(BODY);
    expect(listing(path.join(h.home, 'vol')), 'nothing was written through the alias').toEqual(before);
    expect(before.filter((e) => !e.endsWith('/')), 'the decoy holds no file').toEqual([]);
  });

  it('C5 no mount table: mounts-absent', () => {
    plantSource();
    const r = rig();
    carry({ ...r, env: { ...r.env, CCD_MOUNTINFO: path.join(h.home, 'no-such-table') } });
    expect(copied()[0]).toBe('mounts-absent');
  });

  it('C6 a mount point holding a space and a backslash is decoded (\\040, \\134): via-mount', () => {
    plantSource();
    carry(rig({ vol: 'my vol\\x' }));
    expect(verdict()).toBe('(link: via-mount)');
  });

  it('C7 a mount INSIDE the source sidecar rules the alias out: root-mismatch, the content still lands', () => {
    plantSource();
    carry(rig({ extra: [mountRow({ id: 40, parent: 31, majmin: '0:99',
      root: `/home/.claude/projects/${PDIR}/${UUID}/tool-results`, target: side('.claude', 'tool-results') })] }));
    expect(copied()[0]).toBe('root-mismatch');
    expect(fs.readFileSync(side('.claude-d', R_JSON), 'utf8')).toBe(BODY);
  });

  it.skipIf(process.getuid?.() === 0)('C8 the alias cannot be stat\'ed (no search permission): root-unreachable', () => {
    plantSource();
    const r = rig();
    fs.chmodSync(path.join(h.home, 'vol', 'home'), 0o000);
    carry(r);
    expect(copied()[0]).toBe('root-unreachable');
  });

  it('C9 the link through a PROVED alias fails too: root-failed, the destination cleared again (no nest), the content lands', () => {
    plantSource();
    const r = rig();
    carry({ ...r, env: { ...r.env, FAKE_CP_AL_FAIL: '1' } });
    expect(copied()[0]).toBe('root-failed');
    expect(fs.existsSync(side('.claude-d', UUID)), 'a <uuid>/<uuid> nest').toBe(false);
    expect(fs.readFileSync(side('.claude-d', R_JSON), 'utf8')).toBe(BODY);
  });

  it('C10 LAZY: a direct cp -al that works is never routed, even over a routable table — (link)', () => {
    plantSource();
    carry({ env: bindFixture(h.home) });
    expect(verdict()).toBe('(link)');
    expect(ino(side('.claude-d', R_JSON))).toBe(ino(side('.claude', R_JSON)));
  });

  it('C11 a copy says so on stderr, with its cause and its bytes', () => {
    plantSource();
    carry(rig({ common: 'none' }));
    const [cause, n] = copied();
    expect(stderr()).toContain(`ccd: warn: sidecar ${UUID} carried to ${side('.claude-d')} as a COPY (${cause}, ${n} bytes)`);
  });
});

describe('the merge walk: an absent file that will not link routes on EXDEV (D-4500), and its copies are counted by cause (D-4501)', () => {
  /** A return visit: the destination `<uuid>/` already exists, so the walk runs. */
  const plantReturn = (): void => {
    put(side('.claude', R_JSON), BODY);
    fs.mkdirSync(side('.claude-d'), { recursive: true });
  };

  it('M1 an absent file links via the common mount: (merged +1 ~0 !0, via-mount 1), one inode', () => {
    plantReturn();
    carry(rig());
    expect(verdict()).toBe('(merged +1 ~0 !0, via-mount 1)');
    expect(ino(side('.claude-d', R_JSON))).toBe(ino(side('.claude', R_JSON)));
    expect(stderr()).not.toContain('COPIES');
  });

  it('M2 no second mount: the copy is counted by cause, files and bytes — and said on stderr', () => {
    plantReturn();
    carry(rig({ common: 'none' }));
    expect(verdict()).toBe('(merged +1 ~0 !0, copy: exdev-no-root 1 files 7 bytes)');
    expect(fs.readFileSync(side('.claude-d', R_JSON), 'utf8')).toBe(BODY);
    expect(stderr()).toContain(`ccd: warn: sidecar ${UUID} merged into ${side('.claude-d')} with COPIES (copy: exdev-no-root 1 files 7 bytes)`);
  });

  it('M3 only EXDEV routes: a link refused for another reason (EMLINK) is link-failed, never routed', () => {
    plantReturn();
    const r = rig();
    carry({ ...r, env: { ...r.env, FAKE_LINK_ERRNO: 'EMLINK' } });
    expect(verdict()).toBe('(merged +1 ~0 !0, copy: link-failed 1 files 7 bytes)');
  });

  it('M4 the diverged rows still name the ACCOUNT paths, never the aliases', () => {
    plantReturn();
    put(side('.claude', 'tool-results/x.json'), 'A LONGER SOURCE\n');
    put(side('.claude-d', 'tool-results/x.json'), 'KEPT\n');
    carry(rig());
    expect(verdict()).toBe('(merged +1 ~0 !1, via-mount 1)');
    expect(swapLog()).toContain(
      `sidecar ${UUID} diverged ${side('.claude-d', 'tool-results/x.json')} longer ${side('.claude', 'tool-results/x.json')}`);
  });

  it('M5 a route that crashes inside the walk is contained: route-error, and the merge still lands', () => {
    plantReturn();
    const r = rig();
    carry({ ...r, env: { ...r.env, FAKE_ROUTE_CRASH: '1' } });
    expect(verdict()).toBe('(merged +1 ~0 !0, copy: route-error 1 files 7 bytes)');
    expect(fs.readFileSync(side('.claude-d', R_JSON), 'utf8')).toBe(BODY);
    expect(stderr()).toContain('ccd: carry route failed:');
  });

  it('M6 copies of one cause are one clause, their files and bytes summed', () => {
    plantReturn();
    put(side('.claude', 'tool-results/q.json'), 'Q\n');
    carry(rig({ common: 'none' }));
    expect(verdict()).toBe('(merged +2 ~0 !0, copy: exdev-no-root 2 files 9 bytes)');
  });
});

// THE REAL KERNEL, where it can be had: an unprivileged user namespace with its
// own mount namespace mounts a tmpfs whole and binds two of its directories as
// the account roots — the fleet's geometry — and ccd reads that namespace's own
// `/proc/self/mountinfo` (`CCD_MOUNTINFO=''`). Probe-gated: GitHub's
// ubuntu-24.04 runners restrict unprivileged user namespaces, so CI skips it,
// and macOS has none.
const userns = ((): boolean => {
  if (!IS_LINUX) return false;
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ccrc-userns-'));
  try {
    execFileSync('unshare', ['-Urm', 'sh', '-c', 'mount -t tmpfs t "$1"', '_', d], { stdio: 'ignore' });
    return true;
  } catch { return false; } finally { fs.rmSync(d, { recursive: true, force: true }); }
})();

describe('the real kernel (Linux, unprivileged user namespaces only)', () => {
  it.skipIf(!userns)('binds of one tmpfs: a direct ln is EXDEV, and both the first carry and a merge link via the whole mount', () => {
    const script = path.join(h.home, 'realk.sh');
    fs.writeFileSync(script, [
      'set -u',
      'W="$HOME/whole vol"; S="projects/' + PDIR + '/' + UUID + '"',
      'mkdir -p "$W" "$HOME/.claude" "$HOME/.claude-d"',
      'mount -t tmpfs t "$W"',
      'mkdir -p "$W/home/.claude/$S/tool-results" "$W/home/.claude-d/projects/' + PDIR + '"',
      'printf RESULT > "$W/home/.claude/$S/tool-results/r.json"',
      'mount --bind "$W/home/.claude" "$HOME/.claude"',
      'mount --bind "$W/home/.claude-d" "$HOME/.claude-d"',
      'if ln "$HOME/.claude/$S/tool-results/r.json" "$HOME/.claude-d/direct" 2>/dev/null; then echo "control: linked"; else echo "control: refused"; fi',
      'source "$1"',
      'CCD_MOUNTINFO="" _swap_carry_sidecars "$HOME/.claude" "$HOME/.claude-d" ' + UUID,
      'printf NEW > "$HOME/.claude/$S/tool-results/s.json"',
      'CCD_MOUNTINFO="" _swap_carry_sidecars "$HOME/.claude" "$HOME/.claude-d" ' + UUID,
      'for f in r s; do echo "$f $(stat -c %i "$HOME/.claude/$S/tool-results/$f.json") $(stat -c %i "$HOME/.claude-d/$S/tool-results/$f.json")"; done',
    ].join('\n'));
    const out = h.sh(`unshare -Urm bash "${script}" "${CCD}" 2>&1`);
    expect(out).toContain('control: refused');
    for (const f of ['r', 's']) {
      const m = new RegExp(`^${f} (\\d+) (\\d+)$`, 'm').exec(out);
      expect(m, out).not.toBeNull();
      expect(m![1], `${f}.json shares one inode`).toBe(m![2]);
    }
    const modes = swapLog().split('\n').filter((l) => l.includes(` sidecar ${UUID} -> `)).map((l) => l.replace(/^.* \(/, '('));
    expect(modes).toEqual(['(link: via-mount)', '(merged +1 ~0 !0, via-mount 1)']);
  });
});
