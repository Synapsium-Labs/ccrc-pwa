import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

const CCRC = path.resolve(__dirname, '../../ccd/ccrc');
let home: string;
beforeEach(() => { home = mkTmp('ccrc-memory-'); });
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const run = (args: string[]): { code: number; out: string } => {
  const r = spawnSync('bash', [CCRC, ...args],
    { env: { ...process.env, HOME: home }, encoding: 'utf8' });
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

/** A home with one memory dir for one project. */
function seed(homeSuffix: string, slug: string, files: Record<string, string>): void {
  const d = path.join(home, homeSuffix, 'projects', slug, 'memory');
  fs.mkdirSync(d, { recursive: true });
  for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(d, n), c);
}

describe('ccrc memory — the census', () => {
  it('names a home that holds a plain memory directory', () => {
    seed('.claude', '-p-demo', { 'a.md': 'x' });
    const r = run(['memory']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('.claude');
    expect(r.out).toContain('-p-demo');
  });

  it('enumerates homes from the FILESYSTEM, not the roster', () => {
    // `.claude-glm` is in no roster entry; it must still be reported.
    seed('.claude-glm', '-p-demo', { 'a.md': 'x' });
    expect(run(['memory']).out).toContain('.claude-glm');
  });

  it('reports a converged pair as converged, not as work to do', () => {
    const store = path.join(home, '.ccrc', 'memory', '-p-demo');
    fs.mkdirSync(store, { recursive: true });
    const d = path.join(home, '.claude', 'projects', '-p-demo');
    fs.mkdirSync(d, { recursive: true });
    fs.symlinkSync(store, path.join(d, 'memory'));
    expect(run(['memory']).out).toMatch(/converged/);
  });

  // Ruling R4: the brief's mutation M2 ("`_mem_state` returns `converged` for
  // any symlink, ignoring the target") has nothing to go RED on without this
  // case — the test above only ever seeds a CORRECT link. A symlink that
  // exists and a symlink that points at the right place are two different
  // facts; collapsing them is exactly the "overloaded null at a seam" this
  // project forbids. Seed a link to some OTHER directory and require `forked`.
  it('reports a wrong-target symlink as forked, not converged', () => {
    const wrongTarget = path.join(home, 'somewhere-else');
    fs.mkdirSync(wrongTarget, { recursive: true });
    const d = path.join(home, '.claude', 'projects', '-p-demo');
    fs.mkdirSync(d, { recursive: true });
    fs.symlinkSync(wrongTarget, path.join(d, 'memory'));
    const out = run(['memory']).out;
    expect(out).toMatch(/forked/);
    expect(out).not.toMatch(/converged/);
  });

  // Fix round 1, Important 1 (R10): `[ -e "${d}memory" ]` DEREFERENCES, so a
  // dangling symlink — a link written before its store existed, or whose
  // store was later deleted — is invisible to `-e` and was being `continue`d
  // past before this fix, even though `_mem_state`'s own `-L` branch already
  // classifies it correctly. The caller was narrowing a distinction the
  // callee provides: a broken link and a genuinely empty slug are two
  // different facts, and only this case (target absent) tells them apart.
  // Seed the link's TARGET path without ever creating the store directory.
  it('reports a dangling symlink as forked, not as no memory at all', () => {
    const d = path.join(home, '.claude', 'projects', '-p-demo');
    fs.mkdirSync(d, { recursive: true });
    fs.symlinkSync(path.join(home, '.ccrc', 'memory', '-p-demo'), path.join(d, 'memory'));
    const out = run(['memory']).out;
    expect(out).toContain('-p-demo');
    expect(out).toMatch(/forked/);
  });

  it('changes nothing on disk — the census is read-only', () => {
    seed('.claude', '-p-demo', { 'a.md': 'x' });
    run(['memory']);
    expect(fs.lstatSync(path.join(home, '.claude', 'projects', '-p-demo', 'memory'))
      .isSymbolicLink()).toBe(false);
    expect(fs.existsSync(path.join(home, '.ccrc', 'memory'))).toBe(false);
  });

  it('ignores scratch slugs', () => {
    seed('.claude', '-tmp-scratch', { 'a.md': 'x' });
    expect(run(['memory']).out).not.toContain('-tmp-scratch');
  });

  // Fix round 1, Important 2a (R11): `_ccrc_usage_die` (ccd/ccrc:1162)
  // already supplies the "$PROG: unknown argument: " prefix — passing it a
  // phrase rather than the bare offending token doubles the words. Assert
  // the doubled form is ABSENT, not just that some error text is present,
  // or a regression back to the phrase-passing bug would go unnoticed.
  it('an unknown flag is a usage error, printed once — not doubled', () => {
    const r = run(['memory', '--bogus']);
    expect(r.code).toBe(2);
    expect(r.out).toContain('unknown argument: --bogus');
    expect(r.out).not.toContain('unknown argument: unknown argument');
  });

  // Fix round 1, Important 2b (R11): every flag-taking verb in this file
  // carries `-h|--help) usage; exit 0 ;;` as its first arm (ccd/ccrc:6627's
  // documented rule) — `memory` advertises `[--apply]` in `usage()` and so
  // must follow it too, rather than falling through to the usage-error arm.
  it('-h prints usage and exits 0', () => {
    const r = run(['memory', '-h']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/usage: ccrc/);
  });
});
