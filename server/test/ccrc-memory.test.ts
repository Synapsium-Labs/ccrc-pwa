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

  // I6 (review round 1): home order is glob-COLLATION order, not a fixed
  // alphabetical order — `.claude` sorts before `.claude-corp` under
  // `en_US.UTF-8`, but `-` (0x2D) sorts AFTER `/` (0x2F, the path separator
  // ending a glob candidate) is irrelevant here; what matters is that under
  // `LC_ALL=C`, `.claude-corp` sorts BEFORE `.claude` (`-` 0x2D < nothing —
  // the shorter string is a prefix under byte-order too, but `C` and
  // `en_US.UTF-8` do not always agree on multi-byte/punctuation ordering in
  // general, and this suite's own `ccrc-doctor.test.ts` already runs its
  // `doctorEnv` under `LC_ALL: 'C'`). Measured: the original version of this
  // test — asserting `n.includes('claude-corp')` on the suffixed name — went
  // RED under `LC_ALL=C ./node_modules/.bin/vitest run test/ccrc-memory.test.ts
  // -t 'KEEPS BOTH'`, because under `C` collation `.claude-corp` is absorbed
  // FIRST and the suffix names `.claude` instead. The RULE (both bodies
  // survive, never one silently) holds under either order; only the identity
  // of which home's copy is unsuffixed depends on order. Assert the rule, not
  // an order this test does not control.
  it('KEEPS BOTH when the same filename differs — never picks a winner', () => {
    seed('.claude', '-p-demo', { 'same.md': 'first' });
    seed('.claude-corp', '-p-demo', { 'same.md': 'second' });
    run(['memory', '--apply']);
    const names = fs.readdirSync(storeDir()).filter((n) => n.startsWith('same.')).sort();
    expect(names).toHaveLength(2);
    expect(names.every((n) => /^same\.(claude|claude-corp)\.md$/.test(n) || n === 'same.md')).toBe(true);
    const bodies = names.map((n) => fs.readFileSync(path.join(storeDir(), n), 'utf8')).sort();
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

  // I5 (review round 1): the original assertion here checked for a directory
  // NAME starting with `memory.pre-ccrc-` and nothing else — it passed
  // against a mutation that did `mkdir -p "$bk"; rm -rf "$link"` (an EMPTY
  // backup and a deleted source), because an empty directory still has the
  // right name. The backup is the sole recovery path for C1, C2 and I3, so
  // this is the assertion that most needs to check a byte actually arrived.
  it('backs up each source directory before replacing it, with the bytes intact', () => {
    seed('.claude', '-p-demo', { 'a.md': 'A' });
    run(['memory', '--apply']);
    const parent = path.join(home, '.claude', 'projects', '-p-demo');
    const backupName = fs.readdirSync(parent).find((n) => n.startsWith('memory.pre-ccrc-'));
    expect(backupName).toBeDefined();
    expect(fs.readFileSync(path.join(parent, backupName!, 'a.md'), 'utf8')).toBe('A');
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

  // C1 (review round 1, Critical): no `cp` inside `_mem_absorb` was checked,
  // so a copy failure was invisible and `_mem_apply` went on to back up,
  // relink and print `converged` anyway — measured live: a store at mode
  // 0500 produced `cp: … Permission denied` on stderr, then `ccrc memory:
  // converged .claude -p-demo`, exit 0, an EMPTY store, and the only trace
  // of the original file was a `memory.pre-ccrc-*` backup whose path was
  // never printed. Pre-create the store (so `mkdir -p` on it is a no-op,
  // unlike the R9 test above which targets the store's PARENT) and strip
  // write permission from the store itself, so `mkdir -p` succeeds but every
  // `cp` into it fails. Restore the mode so `afterEach` can still clean up.
  it('C1: a failed copy is refused, not reported as a false success', () => {
    seed('.claude', '-p-demo', { 'a.md': 'A' });
    fs.mkdirSync(storeDir(), { recursive: true });
    fs.chmodSync(storeDir(), 0o500);
    let r: { code: number; out: string };
    try {
      r = run(['memory', '--apply']);
    } finally {
      fs.chmodSync(storeDir(), 0o700);
    }
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('could not absorb');
    // refuse to `mv` the source away when absorb failed: the original
    // directory must still be a real directory, not a symlink, with its
    // file still in it — not renamed into an unannounced backup.
    const link = path.join(home, '.claude', 'projects', '-p-demo', 'memory');
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(path.join(link, 'a.md'), 'utf8')).toBe('A');
  });

  // C2 (review round 1, Critical): the conflict-suffix `cp` overwrote its
  // destination unconditionally — M1's forbidden silent winner, one filename
  // later. This needs to be deterministic regardless of home glob/collation
  // order (I6's lesson, applied here too), so it deliberately involves only
  // ONE home: pre-populate the store as if an EARLIER absorption already
  // happened — a `same.md` from whoever converged first, and a
  // `same.claude-corp.md` that already occupies the EXACT slot
  // `.claude-corp`'s own differing `same.md` would compute below. Then let
  // `.claude-corp` (forked — its `memory` entry is a plain, unconverted
  // directory) absorb its differing `same.md`. The old code computed that
  // same destination and clobbered the pre-existing file with no check at
  // all; the fix must walk to the next free — or byte-identical — numbered
  // slot instead.
  it('C2: never overwrites a pre-existing suffixed file — the same rule, one filename later', () => {
    fs.mkdirSync(storeDir(), { recursive: true });
    fs.writeFileSync(path.join(storeDir(), 'same.md'), 'already-unioned');
    fs.writeFileSync(path.join(storeDir(), 'same.claude-corp.md'), 'pre-existing, unrelated');
    seed('.claude-corp', '-p-demo', { 'same.md': 'from-claude-corp' });
    const r = run(['memory', '--apply']);
    expect(r.code).toBe(0);
    expect(fs.readFileSync(path.join(storeDir(), 'same.md'), 'utf8')).toBe('already-unioned');
    // the pre-existing file must survive completely untouched
    expect(fs.readFileSync(path.join(storeDir(), 'same.claude-corp.md'), 'utf8'))
      .toBe('pre-existing, unrelated');
    // .claude-corp's differing same.md must still land somewhere — the next free slot
    expect(fs.readFileSync(path.join(storeDir(), 'same.claude-corp.2.md'), 'utf8'))
      .toBe('from-claude-corp');
  });

  // I3 (review round 1, Important): anything in the source directory that
  // isn't a top-level `*.md` file is out of scope for the union by design
  // (a "memory file" is a top-level `.md` file) — but that was previously
  // silent: the run said `converged` and named nothing. Seed a plain file, a
  // README with no extension, and a SUBDIRECTORY holding its own `.md` file
  // (a real memory file, just not a top-level one) — none of the three
  // should reach the store, but the run must now say how many were left and
  // where, and the bytes must actually be sitting there.
  it('I3: leftover non-top-level entries are counted, and the backup path is always named', () => {
    const dir = path.join(home, '.claude', 'projects', '-p-demo', 'memory');
    fs.mkdirSync(path.join(dir, 'notes'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'a.md'), 'A');
    fs.writeFileSync(path.join(dir, 'scratch.txt'), 'not a memory file');
    fs.writeFileSync(path.join(dir, 'README'), 'not a memory file either');
    fs.writeFileSync(path.join(dir, 'notes', 'deep.md'), 'a real memory file, just not top-level');
    const r = run(['memory', '--apply']);
    expect(r.code).toBe(0);
    expect(fs.readFileSync(path.join(storeDir(), 'a.md'), 'utf8')).toBe('A');
    // three top-level entries were left behind: scratch.txt, README, notes/
    expect(r.out).toMatch(/NOTE: 3 entries not migrated, left in (\S+)/);
    const backup = /NOTE: 3 entries not migrated, left in (\S+)/.exec(r.out)?.[1];
    expect(backup).toBeDefined();
    expect(fs.readFileSync(path.join(backup!, 'scratch.txt'), 'utf8')).toBe('not a memory file');
    expect(fs.readFileSync(path.join(backup!, 'notes', 'deep.md'), 'utf8'))
      .toBe('a real memory file, just not top-level');
    // the backup path is also named on the plain "converged" line, regardless of NOTE
    expect(r.out).toMatch(new RegExp(`converged .* \\(backup: ${backup!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`));
  });

  // I4 (review round 1, Important): `readlink`'s raw text is meaningless on
  // its own for a RELATIVE symlink target — it means something different
  // resolved from the link's own directory than from this process's CWD.
  // Measured: a link `../../../shared-memory` (relative) holding a real
  // memory file absorbed NOTHING, the link was still re-pointed and the run
  // still said `converged`, and the only reference to the real data
  // vanished. Build a genuinely relative symlink with `path.relative` so
  // this test does not depend on where the process happens to be run from.
  it('I4: a RELATIVE symlink target resolves against the link, not the process CWD', () => {
    const shared = path.join(home, 'shared-memory');
    fs.mkdirSync(shared, { recursive: true });
    fs.writeFileSync(path.join(shared, 'shared.md'), 'S');
    const d = path.join(home, '.claude', 'projects', '-p-demo');
    fs.mkdirSync(d, { recursive: true });
    fs.symlinkSync(path.relative(d, shared), path.join(d, 'memory'));
    const r = run(['memory', '--apply']);
    expect(r.code).toBe(0);
    expect(fs.readFileSync(path.join(storeDir(), 'shared.md'), 'utf8')).toBe('S');
  });
});
