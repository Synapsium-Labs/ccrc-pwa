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
    // Fix round 2 (R13 audit): the bare `toMatch(/forked/)` this test had is
    // the SAME vacuous shape the reviewer found in the dangling-link test —
    // the summary line always contains the literal substring "forked", so
    // this half of the assertion passed regardless of the row. The negative
    // below is what actually caught M2 (and still does); anchor the positive
    // to the row too so it carries real signal on its own.
    expect(out).toMatch(/-p-demo\s+forked$/m);
    expect(out).not.toMatch(/-p-demo\s+converged$/m);
  });

  // Fix round 1, Important 1 (R10): `[ -e "${d}memory" ]` DEREFERENCES, so a
  // dangling symlink — a link written before its store existed, or whose
  // store was later deleted — is invisible to `-e` and was being `continue`d
  // past before this fix, even though `_mem_state`'s own `-L` branch already
  // classifies it correctly. The caller was narrowing a distinction the
  // callee provides: a broken link and a genuinely empty slug are two
  // different facts, and only this case (target absent) tells them apart.
  // Seed the link's TARGET path without ever creating the store directory.
  //
  // Fix round 2 (R13): the original version of this test asserted
  // `toMatch(/forked/)` against the WHOLE output, which is vacuous — the
  // summary line (`printf '\n%s pairs, %s forked\n'`) always contains the
  // literal substring "forked" (e.g. "0 forked"), so the assertion passed
  // even while the row itself was silently dropped. Assert against the ROW
  // (slug followed by its state at end of line) and carry the negative, the
  // same shape the sibling wrong-target test above already uses. This is
  // also the test that must go RED on R12's fix (`_mem_state` requiring
  // `[ -d "$store" ]` for `converged`, not just a matching link target) —
  // without the row-level negative, a `_mem_state` that reports this
  // dangling link as `converged` would slip through unnoticed.
  it('reports a dangling symlink as forked, not as no memory at all', () => {
    const d = path.join(home, '.claude', 'projects', '-p-demo');
    fs.mkdirSync(d, { recursive: true });
    fs.symlinkSync(path.join(home, '.ccrc', 'memory', '-p-demo'), path.join(d, 'memory'));
    const out = run(['memory']).out;
    expect(out).toMatch(/-p-demo\s+forked$/m);
    expect(out).not.toMatch(/-p-demo\s+converged$/m);
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

describe('ccrc memory --apply — the union', () => {
  const storeDir = (): string => path.join(home, '.ccrc', 'memory', '-p-demo');
  const linkOf = (h: string): string =>
    path.join(home, h, 'projects', '-p-demo', 'memory');

  it('moves a file unique to one home into the store, and symlinks the home', () => {
    seed('.claude', '-p-demo', { 'only-here.md': 'body' });
    expect(run(['memory', '--apply']).code).toBe(0);
    expect(fs.readFileSync(path.join(storeDir(), 'only-here.md'), 'utf8')).toBe('body');
    expect(fs.lstatSync(linkOf('.claude')).isSymbolicLink()).toBe(true);
  });

  it('unions two homes that hold different files', () => {
    seed('.claude', '-p-demo', { 'a.md': 'A' });
    seed('.claude-corp', '-p-demo', { 'b.md': 'B' });
    run(['memory', '--apply']);
    expect(fs.readFileSync(path.join(storeDir(), 'a.md'), 'utf8')).toBe('A');
    expect(fs.readFileSync(path.join(storeDir(), 'b.md'), 'utf8')).toBe('B');
  });

  it('KEEPS BOTH when the same filename differs — never picks a winner', () => {
    seed('.claude', '-p-demo', { 'same.md': 'first' });
    seed('.claude-corp', '-p-demo', { 'same.md': 'second' });
    run(['memory', '--apply']);
    const names = fs.readdirSync(storeDir()).sort();
    expect(names).toContain('same.md');
    expect(names.some((n) => n.startsWith('same.') && n.includes('claude-corp'))).toBe(true);
    const bodies = names.filter((n) => n.startsWith('same.'))
      .map((n) => fs.readFileSync(path.join(storeDir(), n), 'utf8')).sort();
    expect(bodies).toEqual(['first', 'second']);
  });

  it('deduplicates a byte-identical collision into ONE file', () => {
    seed('.claude', '-p-demo', { 'same.md': 'identical' });
    seed('.claude-corp', '-p-demo', { 'same.md': 'identical' });
    run(['memory', '--apply']);
    expect(fs.readdirSync(storeDir()).filter((n) => n.startsWith('same.')))
      .toEqual(['same.md']);
  });

  it('rebuilds MEMORY.md from frontmatter rather than merging it', () => {
    seed('.claude', '-p-demo', {
      'one.md': '---\nname: one\ndescription: the first\n---\nbody\n',
      'MEMORY.md': '- stale line that mentions nothing real\n',
    });
    seed('.claude-corp', '-p-demo', {
      'two.md': '---\nname: two\ndescription: the second\n---\nbody\n',
      'MEMORY.md': '- a different stale line\n',
    });
    run(['memory', '--apply']);
    const idx = fs.readFileSync(path.join(storeDir(), 'MEMORY.md'), 'utf8');
    expect(idx).toContain('one.md');
    expect(idx).toContain('the first');
    expect(idx).toContain('two.md');
    expect(idx).toContain('the second');
    expect(idx).not.toContain('stale line');
    expect(fs.readdirSync(storeDir()).filter((n) => n.startsWith('MEMORY.')))
      .toEqual(['MEMORY.md']);
  });

  it('backs up each source directory before replacing it', () => {
    seed('.claude', '-p-demo', { 'a.md': 'A' });
    run(['memory', '--apply']);
    const parent = path.join(home, '.claude', 'projects', '-p-demo');
    expect(fs.readdirSync(parent).some((n) => n.startsWith('memory.pre-ccrc-'))).toBe(true);
  });

  it('re-points a symlink that targets another HOME, not the store', () => {
    const other = path.join(home, '.claude', 'projects', '-p-demo', 'memory');
    fs.mkdirSync(other, { recursive: true });
    fs.writeFileSync(path.join(other, 'a.md'), 'A');
    const d = path.join(home, '.claude-corp', 'projects', '-p-demo');
    fs.mkdirSync(d, { recursive: true });
    fs.symlinkSync(other, path.join(d, 'memory'));
    run(['memory', '--apply']);
    expect(fs.readlinkSync(path.join(d, 'memory'))).toBe(storeDir());
    expect(fs.readFileSync(path.join(storeDir(), 'a.md'), 'utf8')).toBe('A');
  });

  it('is idempotent — a second run changes nothing and reports zero forked', () => {
    seed('.claude', '-p-demo', { 'a.md': 'A' });
    run(['memory', '--apply']);
    const before = fs.readdirSync(storeDir()).sort();
    const r = run(['memory', '--apply']);
    expect(fs.readdirSync(storeDir()).sort()).toEqual(before);
    expect(r.out).toMatch(/0 forked/);
  });

  // R12/R10: `_mem_state` (Task 2) classifies a link whose TARGET TEXT matches
  // the canonical store, but whose store directory does not exist, as
  // `forked` (not `converged`) — a link written before its store, or orphaned
  // when the store was deleted. `_mem_apply` must repair this pair rather
  // than skip it. Two things have to be true at once for that: the top-of-
  // loop gate must not `continue` past a dangling link (R10 — `[ -e "$link" ]`
  // alone DEREFERENCES and is false for a dangling link, exactly like the
  // census's own `[ -e ] || [ -L ] || continue` fix in Task 2's `cmd_memory`),
  // and once past the gate the existing `[ -L "$link" ]` arm must create the
  // store, absorb nothing from the (non-existent) target, drop the dangling
  // link and re-point it at the store it just created. Seed the link pointing
  // at the exact canonical path with nothing behind it yet.
  it('repairs a dangling link whose target already looks correct (R12/R10)', () => {
    const d = path.join(home, '.claude', 'projects', '-p-demo');
    fs.mkdirSync(d, { recursive: true });
    fs.symlinkSync(storeDir(), path.join(d, 'memory'));
    expect(fs.existsSync(storeDir())).toBe(false); // sanity: genuinely dangling, not merely unusual
    const r = run(['memory', '--apply']);
    expect(r.code).toBe(0);
    expect(fs.statSync(storeDir()).isDirectory()).toBe(true);
    expect(fs.readlinkSync(path.join(d, 'memory'))).toBe(storeDir());
  });

  // R9: the brief's `cmd_memory` called `_mem_apply` and returned a flat 0,
  // discarding its status — so a migration that stopped halfway (a `mkdir`,
  // backup `mv` or `ln` failure) would read as a clean exit. Drive a REAL
  // failure: make the store's parent unwritable so `mkdir -p "$store"` fails
  // partway through the run, and require both the exit code and the stderr
  // message to survive up through `cmd_memory`. Restore the mode before the
  // assertions so `afterEach`'s `rm -rf` of the fixture home can still work.
  it('a failure inside --apply is not swallowed as a false success', () => {
    seed('.claude', '-p-demo', { 'a.md': 'A' });
    const memRoot = path.join(home, '.ccrc', 'memory');
    fs.mkdirSync(memRoot, { recursive: true });
    fs.chmodSync(memRoot, 0o500);
    let r: { code: number; out: string };
    try {
      r = run(['memory', '--apply']);
    } finally {
      fs.chmodSync(memRoot, 0o700);
    }
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('cannot create');
  });
});
