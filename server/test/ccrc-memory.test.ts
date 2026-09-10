import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

const CCRC = path.resolve(__dirname, '../../ccd/ccrc');
let home: string;
beforeEach(() => { home = mkTmp('ccrc-memory-'); });
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const run = (args: string[], extraEnv: Record<string, string> = {})
  : { code: number; out: string } => {
  const r = spawnSync('bash', [CCRC, ...args],
    { env: { ...process.env, HOME: home, ...extraEnv }, encoding: 'utf8' });
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

/** A home with one memory dir for one project. */
function seed(homeSuffix: string, slug: string, files: Record<string, string>): void {
  const d = path.join(home, homeSuffix, 'projects', slug, 'memory');
  fs.mkdirSync(d, { recursive: true });
  for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(d, n), c);
}

/** FOUR PREFIXES, ONE RULE — "the OS scratch root", which the two platforms
 *  ccrc ships to do not spell alike: `/tmp` on Linux; on Darwin `/tmp` is a
 *  symlink to `/private/tmp` and `$TMPDIR` is a per-user
 *  `/var/folders/<x>/<y>/T`. D-2375.
 *
 *  SEEDED AS LITERAL SLUGS, and that is exactly what makes the Darwin
 *  spellings measurable HERE, on a Linux runner: the census and `--apply`
 *  read a directory NAME the harness already wrote, never a live cwd. The
 *  hook's copy of this guard derives its slug from a real path with `pwd -P`,
 *  so it can only ever be measured on the platform it runs on — which is how
 *  a Linux-only guard shipped past five reviews, and what `test-macos`
 *  caught. */
const SCRATCH_SLUGS = ['-tmp-scratch', '-private-tmp-scratch',
  '-var-folders-zz-8gk0000gn-T-scratch', '-private-var-folders-zz-8gk0000gn-T-scratch'];

/** THE NEGATIVE CONTROL for that list, and the prefix a careless widening
 *  sweeps up first. `/var/tmp` is POSIX *persistent* scratch — it survives a
 *  reboot, unlike `/tmp` — so it is not the OS scratch root, and
 *  `session-hook.test.ts` roots every project fixture it owns there. A guard
 *  that skipped it would drop those fixtures, and any real project kept
 *  there, out of the census in silence. */
const PERSISTENT_SLUG = '-var-tmp-project';

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

  // `.claude-docserver` is NO LONGER special-cased (final whole-branch
  // review): the old named skip in `_mem_homes` hard-coded a single
  // operator's box-local tool name into shipped, public-release-bound
  // source — identity residue CLAUDE.md bans — and it was provably dead code
  // (the very next `[ -d "${d}projects" ]` line already excludes a real
  // docserver home, which has no `projects/`). The doctor side of this is
  // pinned by an INVERTED test (`ccrc-doctor.test.ts`, "no longer
  // special-cases .claude-docserver"); this is the matching census-side pin
  // — a `.claude-docserver` home with a real `projects/` dir must be
  // reported like any other home, not silently skipped.
  it('no longer special-cases .claude-docserver — a projects/ dir there is reported like any other home', () => {
    seed('.claude-docserver', '-p-demo', { 'a.md': 'x' });
    expect(run(['memory']).out).toContain('.claude-docserver');
  });

  it('reports a converged pair as converged, not as work to do', () => {
    const store = path.join(home, '.ccrc', 'memory', '-p-demo');
    fs.mkdirSync(store, { recursive: true });
    const d = path.join(home, '.claude', 'projects', '-p-demo');
    fs.mkdirSync(d, { recursive: true });
    fs.symlinkSync(store, path.join(d, 'memory'));
    expect(run(['memory']).out).toMatch(/converged/);
  });

  // R20 (fix round 2, Important 1): a RELATIVE link that genuinely resolves
  // to the canonical store used to read as `forked` under the old `readlink`
  // raw-text-vs-absolute-store comparison — the memory really is shared into
  // one store, only the link's own spelling differs. `[ "$link" -ef "$store" ]`
  // (device+inode, followed through the symlink) answers the real question
  // regardless of how the target is spelled, closing a Minor deferred from
  // Task 2.
  it('reports a RELATIVE symlink that correctly resolves to the canonical store as converged (R20)', () => {
    const store = path.join(home, '.ccrc', 'memory', '-p-demo');
    fs.mkdirSync(store, { recursive: true });
    const d = path.join(home, '.claude', 'projects', '-p-demo');
    fs.mkdirSync(d, { recursive: true });
    fs.symlinkSync(path.relative(d, store), path.join(d, 'memory'));
    const out = run(['memory']).out;
    expect(out).toMatch(/-p-demo\s+converged$/m);
    expect(out).not.toMatch(/-p-demo\s+forked$/m);
  });

  // R20 (fix round 2, Important 1 — the WORSE of the two measured bugs): a
  // link resolving to something that EXISTS but is a plain FILE, not a
  // directory, passed a bare `-ef`/existence check while being just as
  // unusable a memory store as a dangling link — and unlike a dangling link,
  // it does not even LOOK broken. `[ -d "$store" ]` is the SEPARATE,
  // independently mutable conjunct this test pins: deleting it alone
  // (leaving `-ef` in place) reproduces exactly this false `converged`.
  it('reports a link to a store that is a regular FILE, not a directory, as forked (R20)', () => {
    const store = path.join(home, '.ccrc', 'memory', '-p-demo');
    fs.mkdirSync(path.dirname(store), { recursive: true });
    fs.writeFileSync(store, '');   // the "store" is a FILE, not a directory
    const d = path.join(home, '.claude', 'projects', '-p-demo');
    fs.mkdirSync(d, { recursive: true });
    fs.symlinkSync(store, path.join(d, 'memory'));
    const out = run(['memory']).out;
    expect(out).toMatch(/-p-demo\s+forked$/m);
    expect(out).not.toMatch(/-p-demo\s+converged$/m);
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

  for (const slug of SCRATCH_SLUGS) {
    it(`ignores the scratch slug ${slug}`, () => {
      seed('.claude', slug, { 'a.md': 'x' });
      expect(run(['memory']).out).not.toContain(slug);
    });
  }

  it('does NOT ignore a /var/tmp slug — persistent scratch is not the scratch root', () => {
    seed('.claude', PERSISTENT_SLUG, { 'a.md': 'x' });
    expect(run(['memory']).out).toContain(PERSISTENT_SLUG);
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

  // Final whole-branch review (Minor): usage() used to advertise a third
  // census state, "absent", that no shipped call site can ever elicit — both
  // callers of `_mem_state` gate on `[ -e ] || [ -L ]` first, so `_mem_state`
  // never returns `absent` to either of them. README already got this
  // right; usage() did not.
  it('usage text does not advertise an "absent" census state the census can never print', () => {
    const r = run(['memory', '-h']);
    expect(r.out).not.toMatch(/absent/);
  });

  // Minor (R13 audit, final whole-branch review): the summary's `forked`
  // count had no assertion able to fail on a dead counter — `toMatch(/0
  // forked/)` elsewhere in this file is satisfied by a counter that is
  // permanently zero. Assert a NON-zero count against a fixture that is
  // genuinely forked twice.
  it('the summary forked count is a real count, not a permanently-zero counter', () => {
    seed('.claude', '-p-a', { 'a.md': 'A' });
    seed('.claude', '-p-b', { 'b.md': 'B' });
    expect(run(['memory']).out).toMatch(/\n2 pairs, 2 forked\n/);
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

  // The `ln -sfn` guard (NOT bare `ln -s`) at the end of the plain-directory
  // arm: without `-n`, a concurrent writer (another `--apply`, or the
  // session hook) that wins a race and lands `$link` as a symlink to the
  // store BETWEEN this pair's own backup `mv` and the `ln` a few lines below
  // it makes a bare `ln -s` DEREFERENCE that symlink-to-a-directory and
  // plant `$store/<slug>` — a symlink INSIDE the shared store pointing at
  // itself — silently, exit 0.
  //
  // THE RACE IS MADE DETERMINISTIC by a one-shot `mv` stub: `mv` is the
  // external binary sitting in exactly that window (the pair's own backup
  // `mv` runs, then this stub plants the racing symlink), so this pins the
  // race in milliseconds rather than needing a flaky concurrent run. Same
  // technique `server/test/session-hook.test.ts` uses (a `mkdir` stub) for
  // the sibling guard in the session hook.
  it('never plants a symlink inside the store when a concurrent writer lands the link mid-race (ln -sfn)', () => {
    seed('.claude', '-p-demo', { 'only-here.md': 'body' });
    const link = linkOf('.claude');
    const store = storeDir();
    const bin = path.join(home, 'race-bin');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'mv'),
      '#!/bin/sh\n/bin/mv "$@"; rc=$?\n'
      + 'for a in "$@"; do [ "$a" = "$RACE_LINK" ] && ln -s "$RACE_STORE" "$RACE_LINK" 2>/dev/null; done\n'
      + 'exit $rc\n', { mode: 0o755 });
    const r = run(['memory', '--apply'], {
      PATH: `${bin}:${process.env['PATH'] ?? ''}`,
      RACE_LINK: link, RACE_STORE: store,
    });
    expect(r.code, r.out).toBe(0);
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(link)).toBe(store);
    // nothing planted INSIDE the store — the self-referential loop a bare
    // `ln -s` would have created there when `$link` resolved to a directory
    expect(fs.readdirSync(store)).not.toContain(path.basename(store));
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

  // R30 (Critical, final whole-branch review): `_mem_index_line` used to
  // return silently (rc 0) for a file with no `name:` frontmatter, and
  // `_mem_rebuild_index` overwrote MEMORY.md with whatever survived — the
  // file stayed on disk but vanished from the artefact actually loaded into
  // context, with no count, no warning, exit 0. The fix is a COUNT, never a
  // basename fallback: inventing a name for a file whose author did not
  // write one is the same silent-decision defect this branch forbids for a
  // conflict winner.
  it('R30: a memory file with no name: frontmatter is COUNTED and named in a NOTE, never silently dropped', () => {
    seed('.claude', '-p-demo', {
      'kept.md': '---\nname: Kept\ndescription: has frontmatter\n---\nbody\n',
      'nofm.md': 'plain prose with no name: frontmatter at all\n',
    });
    const r = run(['memory', '--apply']);
    expect(r.code).toBe(0);
    // the file is on disk, in the store — never lost
    expect(fs.existsSync(path.join(storeDir(), 'nofm.md'))).toBe(true);
    const idx = fs.readFileSync(path.join(storeDir(), 'MEMORY.md'), 'utf8');
    expect(idx).toContain('Kept');
    expect(idx).not.toContain('nofm.md');
    // …and the run says so, unlike the shipped-before-this-fix behaviour
    expect(r.out).toMatch(/NOTE: 1 file not indexed in MEMORY\.md \(no name: frontmatter\)/);
  });

  // R30 sibling (Critical): `mv -f -- "$tmp" "$store/MEMORY.md"` SUCCEEDS
  // when the destination is a DIRECTORY — it moves $tmp INSIDE it — so a
  // `MEMORY.md` that is somehow a directory used to swallow the whole index
  // silently, rc 0, and the call site discarded even a real failure with
  // `|| true`. Refuse the pair instead of claiming `converged` over a store
  // whose index just failed to write.
  it('R30 sibling: a MEMORY.md that is a DIRECTORY is refused, not silently swallowed by mv -f', () => {
    seed('.claude', '-p-demo', { 'a.md': 'A' });
    fs.mkdirSync(path.join(storeDir(), 'MEMORY.md'), { recursive: true });
    const r = run(['memory', '--apply']);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('is a directory, not a file');
    expect(r.out).not.toMatch(/converged \.claude -p-demo/);
  });

  // Final whole-branch review (Important): `_mem_absorb`'s generic
  // non-`.md`/directory counters do not check whether `$dest` is the SAME
  // path as `$f` — so a self-resolving source (src -ef store, the R12
  // dangling-correctly-spelled-link repair shape below) used to count the
  // store's OWN pre-existing non-memory entries as "left behind, not
  // migrated", exactly backwards. Exercise `_mem_absorb` directly (the
  // file's own documented source-able idiom) with src==store holding
  // exactly that shape.
  it('_mem_absorb short-circuits when src and store are the SAME directory — no false "left behind" count', () => {
    const store = storeDir();
    fs.mkdirSync(store, { recursive: true });
    fs.writeFileSync(path.join(store, 'a.md'), 'A');
    fs.writeFileSync(path.join(store, 'notes.txt'), 'an operator note, not a memory file');
    fs.mkdirSync(path.join(store, 'sub'));
    const r = spawnSync('bash', ['-c',
      'source "$1"; left=$(_mem_absorb "$2" "$2" corp) && printf \'left=%s\\n\' "$left"',
      'wrapper', CCRC, store],
      { env: { ...process.env, HOME: home }, encoding: 'utf8' });
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);
    expect(r.stdout.trim()).toBe('left=0');
    // nothing in the store was touched by the self-absorb
    expect(fs.readdirSync(store).sort()).toEqual(['a.md', 'notes.txt', 'sub']);
  });

  // I5 (review round 1): the original assertion here checked for a directory
  // NAME starting with `memory.pre-ccrc-` and nothing else — it passed
  // against a mutation that did `mkdir -p "$bk"; rm -rf "$link"` (an EMPTY
  // backup and a deleted source), because an empty directory still has the
  // right name. The backup is the sole recovery path for C1, C2 and I3, so
  // this is the assertion that most needs to check a byte actually arrived.
  //
  // Retitled (final whole-branch review, Minor): the old name — "backs up
  // EACH source directory" — was a universal this suite never checked; it
  // seeds and asserts on exactly one PLAIN-DIRECTORY pair. Only that arm
  // ever takes a backup at all (README's own documented distinction); the
  // symlink arm's sibling behaviour is its own test right below.
  it('backs up the source directory before replacing it, with the bytes intact (plain-directory arm)', () => {
    seed('.claude', '-p-demo', { 'a.md': 'A' });
    run(['memory', '--apply']);
    const parent = path.join(home, '.claude', 'projects', '-p-demo');
    const backupName = fs.readdirSync(parent).find((n) => n.startsWith('memory.pre-ccrc-'));
    expect(backupName).toBeDefined();
    expect(fs.readFileSync(path.join(parent, backupName!, 'a.md'), 'utf8')).toBe('A');
  });

  // The other half of the same distinction: the symlink arm's target is
  // never renamed away, never backed up — the ONLY change on that arm is
  // the link itself. Without a test naming this directly, "backs up EACH
  // source directory" could regress into also backing up a symlink's
  // target and nothing here would notice.
  it('the symlink arm never takes a backup of its (untouched) target directory', () => {
    const foreignTarget = path.join(home, 'foreign-memory');
    fs.mkdirSync(foreignTarget, { recursive: true });
    fs.writeFileSync(path.join(foreignTarget, 'z.md'), 'Z');
    const d = path.join(home, '.claude', 'projects', '-p-demo');
    fs.mkdirSync(d, { recursive: true });
    fs.symlinkSync(foreignTarget, path.join(d, 'memory'));
    const r = run(['memory', '--apply']);
    expect(r.code).toBe(0);
    expect(fs.readdirSync(foreignTarget).sort()).toEqual(['z.md']);
    expect(r.out).not.toContain('(backup:');
  });

  // THE STAR ASSERTION, RESTORED (R27) — and the story of why it left is the
  // reason it is back. The previous round weakened this line from
  // `readlinkSync(...) === storeDir()` to `realpathSync` equality, reasoning
  // that once `-ef` follows a chain, `.claude-corp`'s link "already resolves
  // to the store" and `--apply` may leave it alone. That reasoning accepted a
  // CHAIN as a spelling. It is not: `.claude` sorts before `.claude-corp`, so
  // `.claude`'s plain-directory pair converges first and turns `other` into a
  // link to the store, and `.claude-corp` is then left pointing at
  // `.claude`'s link — one account's link load-bearing for another's, exactly
  // the "`.claude` is the master" failure the spec names as the second defect
  // of the prior art. `realpathSync` equality cannot see the difference; it
  // passes even if `--apply` touched `.claude-corp` at all. So the assertion
  // that pins the SHAPE is the one that belongs here, and R27's normalise in
  // `_mem_apply` is what makes it true again.
  it('re-points a symlink that targets another HOME straight at the store (R27)', () => {
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

  // R27, the chain shape itself — the state the test above only produces as a
  // side effect, seeded directly so it cannot stop being covered if home
  // collation order ever changes. A -> B's link -> store is the shape a real
  // box already carries (the spec's prior art: every pre-existing symlink on
  // this box points at `~/.claude`), and the invariant is a STAR, not a
  // chain: after `--apply` BOTH homes must name the store directly, so that
  // no home's link is load-bearing for another's and retiring `.claude`
  // cannot take the other home's memory with it.
  //
  // THE THIRD ASSERTION PINS THAT NORMALISING MOVES NOTHING — but be precise
  // about what it does and does not catch, because the first version of this
  // comment overclaimed and the overclaim was measured false. It does NOT
  // detect an `_mem_absorb` inserted on the normalise path: the source there
  // resolves to the store, and `_mem_absorb` dedupes byte-identical files with
  // `cmp -s`, so a self-absorb adds nothing and this listing is unchanged
  // (mutation M10: absorb inserted, suite green). What it does catch is any
  // change that makes the re-point WRITE into the store — a future absorb whose
  // dedupe rule changed, a stray index rebuild, a copy that lands a conflict
  // slot. That is worth pinning even though today's absorb slips past it.
  //
  // The expected listing is bare `a.md` with NO `MEMORY.md`, and that is its
  // own statement about the new path: `_mem_rebuild_index` runs only on the
  // repair arm, and R27's arm changes no file in the store, so it correctly
  // does not run here.
  it('converts a chain into a star — A -> B\'s link -> store leaves BOTH naming the store (R27)', () => {
    const store = storeDir();
    fs.mkdirSync(store, { recursive: true });
    fs.writeFileSync(path.join(store, 'a.md'), 'A');
    // B: a home whose link already names the store directly.
    const b = path.join(home, '.claude', 'projects', '-p-demo');
    fs.mkdirSync(b, { recursive: true });
    fs.symlinkSync(store, path.join(b, 'memory'));
    // A: a home whose link names B's LINK, not the store — the chain.
    const a = path.join(home, '.claude-corp', 'projects', '-p-demo');
    fs.mkdirSync(a, { recursive: true });
    fs.symlinkSync(path.join(b, 'memory'), path.join(a, 'memory'));
    run(['memory', '--apply']);
    expect(fs.readlinkSync(path.join(a, 'memory'))).toBe(store);
    expect(fs.readlinkSync(path.join(b, 'memory'))).toBe(store);
    expect(fs.readdirSync(store).sort()).toEqual(['a.md']);
    expect(fs.readFileSync(path.join(store, 'a.md'), 'utf8')).toBe('A');
  });

  it('is idempotent — a second run changes nothing and reports zero forked', () => {
    seed('.claude', '-p-demo', { 'a.md': 'A' });
    run(['memory', '--apply']);
    const before = fs.readdirSync(storeDir()).sort();
    const r = run(['memory', '--apply']);
    expect(fs.readdirSync(storeDir()).sort()).toEqual(before);
    expect(r.out).toMatch(/0 forked/);
  });

  // Important (final whole-branch review): the census's own `-tmp*` skip
  // (ccd/ccrc:2965-ish) has a red test ('ignores scratch slugs' above); its
  // sibling in `_mem_apply` did not — deleting the apply-side guard left
  // the whole suite green while `--apply` happily converged a throwaway
  // scratch slug into the shared store.
  for (const slug of SCRATCH_SLUGS) {
    it(`--apply ignores the scratch slug ${slug} — never converges it`, () => {
      seed('.claude', slug, { 'a.md': 'A' });
      const r = run(['memory', '--apply']);
      expect(r.code).toBe(0);
      expect(fs.existsSync(path.join(home, '.ccrc', 'memory', slug))).toBe(false);
      expect(fs.lstatSync(path.join(home, '.claude', 'projects', slug, 'memory'))
        .isSymbolicLink()).toBe(false);
    });
  }

  it('--apply DOES converge a /var/tmp slug — the negative control for that list', () => {
    seed('.claude', PERSISTENT_SLUG, { 'a.md': 'A' });
    const r = run(['memory', '--apply']);
    expect(r.code).toBe(0);
    expect(fs.existsSync(path.join(home, '.ccrc', 'memory', PERSISTENT_SLUG, 'a.md'))).toBe(true);
    expect(fs.lstatSync(path.join(home, '.claude', 'projects', PERSISTENT_SLUG, 'memory'))
      .isSymbolicLink()).toBe(true);
  });

  // Important (final whole-branch review): R27's "already canonical, do
  // nothing" short-circuit (`[ "$(readlink -- "$link")" = "$store" ] &&
  // continue`) had NO test at all — deleting it left the whole suite green
  // while every `--apply` on a fully converged box silently re-wrote every
  // home's symlink and printed a `normalised …` line for pairs that needed
  // no repair, breaking the "one-time operator act" idempotence README
  // promises.
  it('R27: a canonically-spelled converged pair is left untouched by a second --apply — no normalise line, same link', () => {
    seed('.claude', '-p-demo', { 'a.md': 'A' });
    run(['memory', '--apply']);
    const before = fs.readlinkSync(linkOf('.claude'));
    const beforeStat = fs.lstatSync(linkOf('.claude'));
    const r2 = run(['memory', '--apply']);
    expect(r2.code).toBe(0);
    expect(fs.readlinkSync(linkOf('.claude'))).toBe(before);
    expect(fs.lstatSync(linkOf('.claude')).ino).toBe(beforeStat.ino);
    expect(r2.out).not.toMatch(/normalised/);
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

  // R17 (review round 2, Important — new, introduced by the round-1 rewrite):
  // the glob in `_mem_absorb` expands to NOTHING when the source directory
  // cannot be READ, not just when it is empty — `readdir` needs read
  // permission. Measured: a mode-0300 source (writable, searchable, NOT
  // readable) produced `left=0`, `err=0`, a `converged` line, and an EMPTY
  // store, with the real file reachable only through the backup. This is
  // C1's own defect in the one condition C1's `cp` check can never see,
  // because the loop that would catch it never runs.
  //
  // Cleanup is deliberately defensive: on a REGRESSION of this fix,
  // `_mem_apply` renames the still-unreadable directory into a
  // `memory.pre-ccrc-*` backup before this test ever gets a chance to
  // restore its mode, and `afterEach`'s recursive `rmSync` cannot delete an
  // unreadable directory's contents — chmod every entry under `parent`, not
  // just the original path, so a future regression fails its OWN assertion
  // instead of also wedging this file's fixture cleanup.
  it('R17: an unreadable source directory is refused, not treated as empty', () => {
    const parent = path.join(home, '.claude', 'projects', '-p-demo');
    const dir = path.join(parent, 'memory');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'a.md'), 'A');
    fs.chmodSync(dir, 0o300);
    let r: { code: number; out: string };
    try {
      r = run(['memory', '--apply']);
    } finally {
      for (const n of fs.readdirSync(parent)) {
        const p = path.join(parent, n);
        if (fs.lstatSync(p).isDirectory()) fs.chmodSync(p, 0o700);
      }
    }
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('cannot read');
    // refuse to move the source away, or to claim an empty store converged
    expect(fs.lstatSync(dir).isSymbolicLink()).toBe(false);
    expect(fs.existsSync(path.join(storeDir(), 'a.md'))).toBe(false);
  });

  // Important (final whole-branch review): R17's guard (`[ ! -r "$src" ]`)
  // does not cover the SIBLING mode — mode 0400 is READABLE but not
  // SEARCHABLE. `readdir` (what `-r` guards) succeeds, so the glob still
  // expands every name, but every per-entry `[ -e ]`/`[ -L ]` stat then
  // fails for want of search permission, so the loop body never runs:
  // `left=0`, `err=0`, a silent `converged` over an EMPTY store — the same
  // defect R17 closed for mode 0300, in the one shape its own guard cannot
  // see.
  it('a READABLE but not SEARCHABLE source directory (mode 0400) is refused, not treated as empty', () => {
    const parent = path.join(home, '.claude', 'projects', '-p-demo');
    const dir = path.join(parent, 'memory');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'keep.md'), 'K');
    fs.chmodSync(dir, 0o400);
    let r: { code: number; out: string };
    try {
      r = run(['memory', '--apply']);
    } finally {
      for (const n of fs.readdirSync(parent)) {
        const p = path.join(parent, n);
        if (fs.lstatSync(p).isDirectory()) fs.chmodSync(p, 0o700);
      }
    }
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('cannot read');
    expect(fs.lstatSync(dir).isSymbolicLink()).toBe(false);
    expect(fs.existsSync(path.join(storeDir(), 'keep.md'))).toBe(false);
  });

  // The other shape the old guard could not see at all: `$src` is not a
  // directory — a plain FILE (or a symlink resolving to one) sitting at the
  // memory path. The glob simply does not expand; same silent `left=0`,
  // `err=0`, `converged` over an empty store.
  it('a source that is a plain FILE, not a directory, is refused, not treated as empty', () => {
    const parent = path.join(home, '.claude', 'projects', '-p-demo');
    fs.mkdirSync(parent, { recursive: true });
    fs.writeFileSync(path.join(parent, 'memory'), 'two lines of prose\nnot a directory\n');
    const r = run(['memory', '--apply']);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('cannot read');
    // the source is untouched — still a plain file, same bytes, never
    // renamed into a backup (the `mkdir -p "$store"` a few lines earlier in
    // `_mem_apply` runs unconditionally, so the store DIRECTORY may exist —
    // it must simply hold nothing, never a stray "converged" claim)
    expect(fs.readFileSync(path.join(parent, 'memory'), 'utf8'))
      .toBe('two lines of prose\nnot a directory\n');
    expect(r.out).not.toMatch(/converged/);
  });

  // R18 (review round 2): the `bk=""` reset added in round 1 to stop a
  // symlink pair from printing the PREVIOUS pair's backup path ships with no
  // test that goes red on its own deletion — exactly the gap this branch's
  // mutation-table discipline exists to forbid. Two cases, both needing a
  // symlink pair to sit in the SAME `_mem_apply` run as another pair (or as
  // the pair reached first), which is why they live here rather than as one
  // test: slugs sort ASCII-betically within one home's `projects/*/` glob,
  // so `-p-aaa` (a plain directory — sets `bk`) is reached before `-p-zzz`
  // (a symlink to a genuinely foreign directory — never sets `bk`).
  it('R18a: a symlink pair after a plain-directory pair does not inherit its backup path', () => {
    seed('.claude', '-p-aaa', { 'a.md': 'A' });
    const foreignTarget = path.join(home, 'foreign-memory');
    fs.mkdirSync(foreignTarget, { recursive: true });
    fs.writeFileSync(path.join(foreignTarget, 'z.md'), 'Z');
    const zDir = path.join(home, '.claude', 'projects', '-p-zzz');
    fs.mkdirSync(zDir, { recursive: true });
    fs.symlinkSync(foreignTarget, path.join(zDir, 'memory'));
    const r = run(['memory', '--apply']);
    expect(r.code).toBe(0);
    const lines = r.out.split('\n');
    const aLine = lines.find((l) => l.includes('converged .claude -p-aaa'));
    const zLine = lines.find((l) => l.includes('converged .claude -p-zzz'));
    expect(aLine).toContain('(backup:');
    expect(zLine).toBeDefined();
    expect(zLine).not.toContain('(backup:');
  });

  // R18b: the re-reviewer's measurement was worse than cosmetic — with
  // `bk=""` deleted, a symlink pair reached FIRST (so `bk` was never
  // assigned even once) with `left > 0` hits `[ -n "$bk" ]` on a genuinely
  // UNSET local variable under `set -u`, and the whole script aborts
  // mid-fleet rather than merely mislabeling a line. `left > 0` matters:
  // `[ "$left" -gt 0 ] && [ -n "$bk" ]` short-circuits before ever reading
  // `$bk` when `left` is 0, so this needs a foreign directory holding both a
  // memory file (to converge) and a non-memory entry (to make `left` 1).
  it('R18b: a symlink pair reached first, with something left behind, does not crash on an unset $bk', () => {
    const foreignTarget = path.join(home, 'foreign-memory');
    fs.mkdirSync(foreignTarget, { recursive: true });
    fs.writeFileSync(path.join(foreignTarget, 'z.md'), 'Z');
    fs.writeFileSync(path.join(foreignTarget, 'scratch.txt'), 'left behind');
    const d = path.join(home, '.claude', 'projects', '-p-only');
    fs.mkdirSync(d, { recursive: true });
    fs.symlinkSync(foreignTarget, path.join(d, 'memory'));
    const r = run(['memory', '--apply']);
    expect(r.code).toBe(0);
    expect(r.out).not.toContain('unbound variable');
    expect(fs.readFileSync(path.join(home, '.ccrc', 'memory', '-p-only', 'z.md'), 'utf8')).toBe('Z');
  });

  // Critical (final whole-branch review): the symlink arm computed `left`
  // (what it deliberately did not absorb — non-`.md` files, subdirectories)
  // and then threw it away, because the NOTE that prints it was gated on
  // `$bk`, which only the plain-directory arm ever sets. `rm -f -- "$link"`
  // then deleted the only reference to the target directory, so an operator
  // got a bare `converged <home> <slug>` naming no path while real,
  // untouched content sat at a location the run never printed. Fix: the
  // symlink arm names its own resolved source (`$src`) instead of a backup
  // path when something was left behind.
  it('a symlink pair also reports NOTE with its OWN location when something is left behind — not gated on a backup path', () => {
    const foreignTarget = path.join(home, 'shared-mem');
    fs.mkdirSync(path.join(foreignTarget, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(foreignTarget, 'shared.md'), 'S');
    fs.writeFileSync(path.join(foreignTarget, 'orphan.txt'), 'left behind');
    fs.writeFileSync(path.join(foreignTarget, 'sub', 'subdeep.md'), 'deep, not top-level');
    const d = path.join(home, '.claude-zzz', 'projects', '-p-demo');
    fs.mkdirSync(d, { recursive: true });
    fs.symlinkSync(foreignTarget, path.join(d, 'memory'));
    const r = run(['memory', '--apply']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/converged \.claude-zzz -p-demo$/m);
    expect(r.out).not.toMatch(/\(backup:/);
    // left = 2 (orphan.txt, sub/) — and now NAMED, not silently discarded
    const escaped = foreignTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expect(r.out).toMatch(new RegExp(`NOTE: 2 entries not migrated, left in ${escaped}`));
    // the target directory itself still holds exactly what was not taken —
    // it was never moved, only its link was
    expect(fs.readFileSync(path.join(foreignTarget, 'orphan.txt'), 'utf8')).toBe('left behind');
    expect(fs.readFileSync(path.join(foreignTarget, 'sub', 'subdeep.md'), 'utf8'))
      .toBe('deep, not top-level');
  });

  // R19a (review round 2, Minor promoted): `[ -e "$f" ]` alone dereferences,
  // so a dangling entry (a broken symlink) inside the source was invisible
  // to the `left` counter — measured: `dangling.md` and `dangling.txt` both
  // landed only in the backup with no NOTE at all. `dangling.txt` (not
  // `.md`) should now fall into `left`; `dangling.md` reaches the `cp`
  // instead, which fails cleanly on a broken symlink and is refused via
  // `err` (C1's mechanism) rather than silently vanishing either way.
  it('R19a: a dangling entry in the source is counted, never silently dropped', () => {
    const dir = path.join(home, '.claude', 'projects', '-p-demo', 'memory');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'a.md'), 'A');
    fs.symlinkSync(path.join(dir, 'nowhere'), path.join(dir, 'dangling.txt'));
    const r = run(['memory', '--apply']);
    expect(r.code).toBe(0);
    expect(fs.readFileSync(path.join(storeDir(), 'a.md'), 'utf8')).toBe('A');
    expect(r.out).toMatch(/NOTE: 1 entry not migrated, left in (\S+)/);
  });

  // R19b (review round 2, Minor promoted): a `cp` that fails PARTWAY
  // (ENOSPC/EIO) can still have created `$dest` with truncated bytes before
  // dying — left in place, that debris becomes the canonical `a.md`, and a
  // re-run would file the REAL content in behind it under a suffixed name.
  // `ulimit -f` reliably reproduces a genuine truncating failure: the
  // process (and every child it `exec`s or forks, `cp` included) is capped
  // to a tiny max file size, so writing a multi-KB source is interrupted by
  // SIGXFSZ partway through, leaving a real partial file — not merely an
  // instant, empty-handed failure the way an unwritable directory would.
  it('R19b: a failed copy does not leave debris that becomes canonical', () => {
    seed('.claude', '-p-demo', { 'a.md': 'x'.repeat(5000) });
    const link = path.join(home, '.claude', 'projects', '-p-demo', 'memory');
    const r = spawnSync(
      'bash',
      ['-c', 'ulimit -c 0; ulimit -f 1; exec bash "$1" memory --apply', 'wrapper', CCRC],
      { env: { ...process.env, HOME: home }, encoding: 'utf8' },
    );
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    expect(r.status).not.toBe(0);
    expect(out).toContain('could not copy');
    // no truncated debris at the canonical destination name
    expect(fs.existsSync(path.join(storeDir(), 'a.md'))).toBe(false);
    // absorb failed, so the source was refused a move — still there, whole
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(path.join(link, 'a.md'), 'utf8')).toBe('x'.repeat(5000));
  });

  // Minor (final whole-branch review): R19b's own guard (`rm -f -- "$sdest"`
  // on a failed copy) ships at TWO sites — the primary `$dest` slot above,
  // and the SUFFIXED conflict slot below it — but the `ulimit -f 1` fixture
  // above only ever reaches the primary arm (it seeds one home with one
  // file, so no conflict slot is ever computed). Force a real conflict
  // FIRST (two pre-existing store entries occupying `same.md` and
  // `same.claude-corp.md`), so the incoming differing file must walk to the
  // SUFFIXED `.2.md` slot, and let `ulimit -f` fail the copy there instead.
  it('R19b (second site): a failed copy to a SUFFIXED conflict slot does not leave debris either', () => {
    fs.mkdirSync(storeDir(), { recursive: true });
    fs.writeFileSync(path.join(storeDir(), 'same.md'), 'primary');
    fs.writeFileSync(path.join(storeDir(), 'same.claude-corp.md'), 'already-taken-slot');
    seed('.claude-corp', '-p-demo', { 'same.md': 'x'.repeat(5000) });
    const r = spawnSync(
      'bash',
      ['-c', 'ulimit -c 0; ulimit -f 1; exec bash "$1" memory --apply', 'wrapper', CCRC],
      { env: { ...process.env, HOME: home }, encoding: 'utf8' },
    );
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    expect(r.status).not.toBe(0);
    expect(out).toContain('could not copy');
    // no truncated debris at the NEXT free (suffixed, numbered) slot
    expect(fs.existsSync(path.join(storeDir(), 'same.claude-corp.2.md'))).toBe(false);
    // the two pre-existing files survive completely untouched
    expect(fs.readFileSync(path.join(storeDir(), 'same.md'), 'utf8')).toBe('primary');
    expect(fs.readFileSync(path.join(storeDir(), 'same.claude-corp.md'), 'utf8'))
      .toBe('already-taken-slot');
  });
});
