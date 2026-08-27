// ws-gc enumerates every worktree on the box. Sourced under an isolated HOME:
// PROJECTS_ROOT and WORKTREES_ROOT derive from it, so the scan below can only
// ever see the fixtures this file builds.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { makeCcdHarness, CCD, WS_ADD, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-gc-'); });
afterEach(() => { h.cleanup(); });

interface Row { state: string; project: string; slug: string; bytes: string; age: string; path: string }

const scan = (): Row[] =>
  h.sh('_ws_gc_scan').split('\n').filter(Boolean).map((l) => {
    const [state, project, slug, bytes, age, p] = l.split('\t');
    return { state, project, slug, bytes, age, path: p };
  });

const find = (rows: Row[], slug: string): Row | undefined => rows.find((r) => r.slug === slug);

/** A tracked workspace on ws/<slug>. Returns its worktree path. */
const addWs = (project: string, slug: string): string => {
  h.sh(`${WS_ADD} CCD_WS_SLUG=${slug} cmd_ws_add ${project}`);
  return path.join(h.home, 'worktrees', project, slug);
};

/** A worktree under WORKTREES_ROOT with no registry entry. */
const addOrphan = (project: string, slug: string): string => {
  const wt = addWs(project, slug);
  fs.rmSync(path.join(h.home, '.cc-sessions', `${project}-${slug}.uuid`));
  return wt;
};

describe('_ws_gc_scan', () => {
  // Every state below is decided by comparing git's paths against $wsroot and
  // $mainreal, and both used to be resolved by CAPTURING a `cd`. A `cd` defined
  // as a shell function and exported with `export -f` reaches this script through
  // the environment and echoes into that capture: both roots come back with an
  // embedded newline, every prefix test fails, and every workspace ccd owns is
  // reported `foreign` instead of `tracked`. `ws-gc --prune` declines foreign
  // rows, so nothing is destroyed — but the fleet silently stops seeing its own
  // reclaimable space. The scan must not depend on the caller's shell at all.
  it('classifies identically when cd has been shadowed and made chatty', () => {
    h.makeRepo('demo');
    addWs('demo', 'quiet-mesa');
    const plain = h.sh('_ws_gc_scan');
    expect(plain).toContain('tracked');
    expect(h.sh('_ws_gc_scan',
      { 'BASH_FUNC_cd%%': '() { builtin cd "$@" && echo "[cd hook] now in $PWD"; }' }))
      .toBe(plain);
  });

  it('reports nothing for a project with only its main checkout', () => {
    h.makeRepo('demo');
    expect(scan()).toEqual([]);
  });

  it('classifies a healthy workspace as tracked', () => {
    h.makeRepo('demo');
    addWs('demo', 'quiet-mesa');
    const r = find(scan(), 'quiet-mesa')!;
    expect(r.state).toBe('tracked');
    expect(r.project).toBe('demo');
    expect(r.bytes).toMatch(/^\d+$/);
    expect(r.age).toMatch(/^\d+$/);
  });

  it('classifies a workspace with uncommitted changes as dirty', () => {
    h.makeRepo('demo');
    const wt = addWs('demo', 'quiet-mesa');
    fs.writeFileSync(path.join(wt, 'scratch.txt'), 'unsaved\n');
    expect(find(scan(), 'quiet-mesa')!.state).toBe('dirty');
  });

  it('counts untracked files as dirty — git worktree remove objects to them too', () => {
    h.makeRepo('demo');
    const wt = addWs('demo', 'quiet-mesa');
    fs.writeFileSync(path.join(wt, 'notes.md'), 'draft\n');
    expect(find(scan(), 'quiet-mesa')!.state).toBe('dirty');
  });

  it('classifies a worktree with no registry entry as an orphan', () => {
    h.makeRepo('demo');
    addOrphan('demo', 'still-cove');
    expect(find(scan(), 'still-cove')!.state).toBe('orphan');
  });

  it('classifies a worktree outside WORKTREES_ROOT as foreign', () => {
    const main = h.makeRepo('demo');
    // Exactly the shape of the live handoff worktree on this box: registered
    // against one of our projects, living somewhere else entirely.
    const elsewhere = path.join(h.home, '.handoff', 'wt', 'demo-something');
    h.git(main, 'worktree', 'add', '-b', 'handoff/something', elsewhere);
    const r = find(scan(), 'demo-something')!;
    expect(r.state).toBe('foreign');
    // RESOLVED, because `_ws_realpath` is: ccd reports a worktree by its
    // real path, deliberately. On macOS the harness home lives under
    // /var/folders, which is a symlink to /private/var/folders — so an
    // unresolved expectation compares two spellings of one directory and
    // fails on that platform only. `realpathSync` is a no-op wherever the
    // path has no symlink in it, which is why it is correct on both.
    expect(r.path).toBe(fs.realpathSync(elsewhere));
  });

  it('classifies a git registration whose directory is gone as stale-meta', () => {
    h.makeRepo('demo');
    const wt = addWs('demo', 'quiet-mesa');
    fs.rmSync(wt, { recursive: true, force: true });
    // Deleting the directory by hand leaves BOTH a stale git registration and a
    // registry entry pointing at nothing. Assert both, rather than letting
    // `find` silently return whichever happens to be emitted first.
    const states = scan().filter((r) => r.slug === 'quiet-mesa').map((r) => r.state).sort();
    expect(states).toEqual(['dead-reg', 'stale-meta']);
  });

  // FINDING 1: ownership must be settled BEFORE a prunable registration is
  // classified. A foreign worktree whose directory disappeared is still
  // foreign — its stale git metadata is the owning tool's, and `git worktree
  // repair` may be its only way back to it. Reported here, never as
  // stale-meta, so --prune (below) never touches it.
  it('classifies a foreign worktree whose directory is gone as foreign-stale, not stale-meta', () => {
    const main = h.makeRepo('demo');
    const elsewhere = path.join(h.home, '.handoff', 'wt', 'demo-foreign');
    h.git(main, 'worktree', 'add', '-b', 'handoff/foreign', elsewhere);
    fs.rmSync(elsewhere, { recursive: true, force: true });
    const r = find(scan(), 'demo-foreign')!;
    expect(r.state).toBe('foreign-stale');
  });

  // FINDING 2: ours is EXACTLY one level below $WORKTREES_ROOT/$project.
  // ws-add never nests deeper, so a worktree two levels down is a hand-placed
  // or foreign-tool worktree, not one of ours — orphan would let --prune
  // remove it and its branch on nothing more than a directory-depth guess.
  it('classifies a worktree nested more than one level under WORKTREES_ROOT as foreign, not orphan', () => {
    const main = h.makeRepo('demo');
    const deep = path.join(h.home, 'worktrees', 'demo', 'sub', 'deep');
    h.git(main, 'worktree', 'add', '-b', 'ws/deep', deep);
    const r = find(scan(), 'deep')!;
    expect(r.state).toBe('foreign');
    // RESOLVED, because `_ws_realpath` is: ccd reports a worktree by its
    // real path, deliberately. On macOS the harness home lives under
    // /var/folders, which is a symlink to /private/var/folders — so an
    // unresolved expectation compares two spellings of one directory and
    // fails on that platform only. `realpathSync` is a no-op wherever the
    // path has no symlink in it, which is why it is correct on both.
    expect(r.path).toBe(fs.realpathSync(deep));
  });

  it('treats a worktree it cannot read as dirty, not as clean', () => {
    // A tree whose git metadata is unreadable produces no `status --porcelain`
    // output. If that were taken as "clean", --prune would delete exactly the
    // trees it understands least.
    h.makeRepo('demo');
    const wt = addWs('demo', 'quiet-mesa');
    fs.rmSync(path.join(wt, '.git'));    // the worktree's gitfile
    expect(h.sh(`_ws_gc_dirty '${wt}' && echo dirty || echo clean`)).toBe('dirty');
  });

  it('classifies a registry entry whose workdir is gone as dead-reg', () => {
    h.makeRepo('demo');
    const wt = addWs('demo', 'quiet-mesa');
    // Remove the worktree properly, so git has no registration left at all —
    // the entry is then invisible to `git worktree list` and only the registry
    // knows it ever existed.
    h.git(path.join(h.home, 'projects', 'demo'), 'worktree', 'remove', wt);
    const r = find(scan(), 'quiet-mesa')!;
    expect(r.state).toBe('dead-reg');
    expect(r.path).toBe(wt);
  });

  it('never reports the main checkout as a workspace', () => {
    h.makeRepo('demo');
    addWs('demo', 'quiet-mesa');
    // The main checkout is the first record in `worktree list --porcelain`, and
    // its path is fully resolved (~/projects -> /data/projects -> /mnt/...), so
    // a plain string comparison against $PROJECTS_ROOT/demo would miss it.
    expect(scan().some((r) => r.slug === 'demo')).toBe(false);
  });

  it('spans every project, not just one', () => {
    h.makeRepo('alpha');
    h.makeRepo('beta');
    addWs('alpha', 'quiet-mesa');
    addOrphan('beta', 'still-cove');
    const rows = scan();
    expect(find(rows, 'quiet-mesa')!.project).toBe('alpha');
    expect(find(rows, 'still-cove')!.project).toBe('beta');
  });

  it('survives a non-repo directory under PROJECTS_ROOT', () => {
    fs.mkdirSync(path.join(h.home, 'projects', 'not-a-repo'), { recursive: true });
    h.makeRepo('demo');
    addWs('demo', 'quiet-mesa');
    expect(find(scan(), 'quiet-mesa')!.state).toBe('tracked');
  });
});

describe('ws-gc report', () => {
  const gc = (args = ''): string =>
    h.sh(`cmd_ws_gc ${args}`);

  it('prints a row per finding with its state and path', () => {
    h.makeRepo('demo');
    const wt = addWs('demo', 'quiet-mesa');
    const out = gc();
    expect(out).toContain('tracked');
    expect(out).toContain('quiet-mesa');
    expect(out).toContain(wt);
  });

  it('prints a total, and says why it can be smaller than the rows sum', () => {
    h.makeRepo('demo');
    addWs('demo', 'quiet-mesa');
    const out = gc();
    expect(out).toMatch(/total\s+\S+\s+across 1 worktree/);
    expect(out).toContain('hardlink');
  });

  it('gives no grand total at all when du could not read every worktree', () => {
    // Round-3 item 3, the `du` sweep. `du -scb` over a set containing a
    // partially readable tree exits 1, writes to stderr, and STILL prints a
    // `total` line holding a partial sum — measured below and, outside the
    // suite, on GNU coreutils 9.4 (5000 for a tree holding 14000).
    // `_ws_gc_human` only answers `-` for a NON-numeric input, so that partial
    // sum used to render as a figure under the words "what removing all of
    // them would free".
    h.makeRepo('demo');
    const wt = addWs('demo', 'quiet-mesa');
    const locked = path.join(wt, 'locked');
    fs.mkdirSync(locked, { recursive: true });
    fs.writeFileSync(path.join(locked, 'big.bin'), 'x'.repeat(9000));
    fs.writeFileSync(path.join(wt, 'visible.bin'), 'v'.repeat(5000));
    fs.chmodSync(locked, 0o000);
    try {
      // THE PREMISE, against the tool ccd actually calls. `du -scb` is
      // GNU-only (BSD's du has no `-b` at all), so probing it directly made
      // this premise fail on macOS and take the real assertions with it.
      // `_plat_bytes` keeps the property those assertions depend on, on both
      // platforms: a partial read STILL PRINTS a total and reports the
      // partiality through the exit status — which is exactly why
      // `_ws_gc_human` must not render that number.
      const probe = h.sh(`_plat_bytes "${wt}" >"$HOME/du-out" 2>"$HOME/du-err"; echo "rc=$?"; `
        + `echo "out=[$(cat "$HOME/du-out")]"`);
      expect(probe, probe).toContain('rc=1');            // it refused…
      expect(probe, probe).toMatch(/out=\[\d+\]/);        // …and still printed a partial total

      const out = gc();
      expect(out, out).toContain('total unmeasured across 1 worktree');
      expect(out, out).toContain('du could not read all of them');
      expect(out, out).not.toContain('what removing all of them would free');
    } finally {
      fs.chmodSync(locked, 0o755);
    }
  }, 30000);

  it('says so plainly when there is nothing to report', () => {
    h.makeRepo('demo');
    expect(gc()).toContain('nothing to report');
  });

  it('MODIFIES NOTHING — the whole tree is byte-identical afterwards', () => {
    // This is the load-bearing property of the default invocation. A gc that
    // deletes by default is one typo from destroying work.
    h.makeRepo('demo');
    const wt = addWs('demo', 'quiet-mesa');
    addOrphan('demo', 'still-cove');
    fs.rmSync(path.join(h.home, 'worktrees', 'demo', 'quiet-mesa', 'README.md'));  // make it dirty
    // WALKED IN NODE, not by `find -printf`: that flag is GNU-only and BSD's
    // find rejects it outright, so on macOS the SNAPSHOT failed rather than
    // the thing under test. The three fields are the ones `%P %s %y` produced
    // — path relative to the root, size, type letter — and `lstat` keeps a
    // symlink reported as a symlink rather than as its target.
    const snapshot = (): string => {
      const lines: string[] = [];
      const walk = (dir: string): void => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const abs = path.join(dir, e.name);
          const st = fs.lstatSync(abs);
          const type = st.isDirectory() ? 'd' : st.isSymbolicLink() ? 'l' : 'f';
          lines.push(`${path.relative(h.home, abs)} ${st.size} ${type}`);
          if (type === 'd') walk(abs);
        }
      };
      walk(h.home);
      return lines.sort().join('\n');
    };
    const before = snapshot();
    gc();
    expect(snapshot()).toBe(before);
    expect(fs.existsSync(wt)).toBe(true);
  });

  it('refuses an unrecognised argument rather than guessing', () => {
    h.makeRepo('demo');
    expect(() => gc('--purge')).toThrow();
  });

  it('is reachable as a subcommand', () => {
    h.makeRepo('demo');
    addWs('demo', 'quiet-mesa');
    expect(h.sh(`"${CCD}" ws-gc`)).toContain('quiet-mesa');
  });
});

describe('ws-gc --prune', () => {
  const prune = (): string => h.sh(`cmd_ws_gc --prune 2>&1`);

  it('removes a clean orphan whose branch is merged', () => {
    h.makeRepo('demo');
    const wt = addOrphan('demo', 'still-cove');
    // Branch is at origin/HEAD with no commits of its own: merged by definition.
    expect(prune()).toContain('removed orphan worktree');
    expect(fs.existsSync(wt)).toBe(false);
    const branches = h.git(path.join(h.home, 'projects', 'demo'), 'branch', '--list', 'ws/still-cove');
    expect(branches).toBe('');
  });

  it('declines to prune an orphan that holds a nested checkout (D1)', () => {
    // Build the file's standard orphan (registered worktree, registry row gone),
    // then git init a child inside it. The decline must name the reason and
    // the child must survive a full `ws-gc --prune`.
    h.makeRepo('demo');
    const wt = addOrphan('demo', 'still-cove');
    // Exclude the child via the untracked `info/exclude`, not a committed
    // .gitignore: a commit here would move the branch tip past origin/HEAD and
    // trip the unmerged-branch gate before the nested-checkout guard is ever
    // reached. This proves the new guard fires on its own, not riding the dirty
    // check that a plain untracked directory would otherwise trigger.
    fs.appendFileSync(path.join(h.home, 'projects', 'demo', '.git', 'info', 'exclude'), 'nested/\n');
    execFileSync('git', ['init', '-q', path.join(wt, 'nested')]);
    const out = prune();
    expect(out, out).toMatch(/nested checkout/);
    expect(out, out).not.toContain('removed orphan worktree');
    expect(fs.existsSync(wt), 'the orphan is still on disk').toBe(true);
  }, 30000);

  it('leaves an orphan alone when it cannot resolve origin/HEAD at all', () => {
    // No origin means no base to compare against, so "merged" is unprovable.
    // Unprovable must resolve to declining, not to deleting.
    //
    // ROUND 3, P2 class sweep — and it must not resolve to CLAIMING either.
    // This test used to assert the report said `unmerged`, which is the same
    // wrong-diagnosis shape as `_ws_gc_dirty`'s: nothing was compared, so
    // "the branch has unmerged commits" is a sentence about a comparison that
    // never ran. The test below, where the branch really is ahead, is what pins
    // the affirmative wording — and the two must not read alike.
    const main = h.makeRepo('demo');
    const wt = addOrphan('demo', 'still-cove');
    h.git(main, 'remote', 'remove', 'origin');
    const out = prune();
    expect(out, out).toContain('could not tell whether branch ws/still-cove is merged');
    expect(out, out).toContain('refusing to remove');
    expect(out, out).not.toContain('is on unmerged branch');
    expect(fs.existsSync(wt)).toBe(true);
  });

  it('leaves an orphan whose branch has unmerged commits, and says why', () => {
    h.makeRepo('demo');
    const wt = addOrphan('demo', 'still-cove');
    fs.writeFileSync(path.join(wt, 'work.txt'), 'ahead\n');
    h.git(wt, 'add', 'work.txt');
    h.git(wt, 'commit', '-m', 'ahead of base');
    const out = prune();
    // The affirmative sentence, and it is only ever printed on a comparison
    // that actually returned "not an ancestor" (round-3 P2 class sweep).
    expect(out, out).toContain('is on unmerged branch ws/still-cove');
    expect(out, out).not.toContain('could not tell whether');
    expect(fs.existsSync(wt)).toBe(true);
  });

  it('leaves an orphan with uncommitted changes, and says why', () => {
    h.makeRepo('demo');
    const wt = addOrphan('demo', 'still-cove');
    fs.writeFileSync(path.join(wt, 'scratch.txt'), 'unsaved\n');
    const out = prune();
    expect(out).toContain('uncommitted');
    expect(fs.existsSync(wt)).toBe(true);
    expect(fs.readFileSync(path.join(wt, 'scratch.txt'), 'utf8')).toBe('unsaved\n');
  });

  /* ── F1: the gate was INVERTED for the detached HEAD ──────────────────────
   *
   * Final-round destructive review, and the one counter-example on this branch
   * to "nothing is destroyed without a human first seeing an accurate
   * description of what would be destroyed". `rev-parse --abbrev-ref HEAD`
   * answers the literal string `HEAD` for a detached worktree, and
   * `[[ -n "$branch" && "$branch" != HEAD ]] && ! _ws_gc_merged …` therefore
   * ran the mergedness proof ONLY when a branch survives the removal — the
   * case where nothing is lost either way — and SKIPPED it for the case where
   * `worktree remove` deletes `$main/.git/worktrees/<slug>/` with its HEAD
   * reflog and leaves the commit referenced by nothing at all.
   *
   * `grep -n detach` over this file returned nothing before these three cases,
   * across all 96 of its tests: the FALSE arm of that conjunct — the arm that
   * skipped the only proof standing in front of the delete — had never been
   * exercised.
   *
   * The pair is deliberate. Both fixtures hold ONE commit of the same file and
   * differ only in whether a ref names it, so the assertions are about the
   * gate and not about anything else in the row.
   */
  const detachedOrphan = (project: string, slug: string): string => {
    const wt = addOrphan(project, slug);
    fs.writeFileSync(path.join(wt, 'work.txt'), 'one hour of it\n');
    h.git(wt, 'add', 'work.txt');
    h.git(wt, 'commit', '-m', 'committed, and about to be unreferenced');
    // The branch is what makes the commit survive `worktree remove`. Detaching
    // and deleting it is the ordinary shape of a throwaway inspection tree —
    // `git worktree add --detach` makes one directly — and it is the state in
    // which the worktree's own HEAD reflog is the only reference left.
    h.git(wt, 'checkout', '--detach');
    h.git(path.join(h.home, 'projects', project), 'branch', '-D', `ws/${slug}`);
    return wt;
  };

  it('leaves a DETACHED orphan alone, and says it cannot prove the commits are reachable', () => {
    h.makeRepo('demo');
    const wt = detachedOrphan('demo', 'still-cove');
    const head = h.git(wt, 'rev-parse', 'HEAD');
    const out = prune();
    expect(out, out).toContain('is on a detached HEAD');
    expect(out, out).toContain('cannot prove anything else reaches them');
    expect(out, out).not.toContain('removed orphan worktree');
    expect(fs.existsSync(wt), 'the detached orphan is still on disk').toBe(true);
    // The point of the refusal, stated as the fact it protects: the commit is
    // still reachable, from the one reference `worktree remove` would delete.
    expect(h.git(path.join(h.home, 'projects', 'demo'), 'rev-parse', '--verify', `${head}^{commit}`))
      .toBe(head);
  });

  it('never claims the commits are unreferenced — it does not look at refs, and says the same thing when they exist', () => {
    // THE FIFTEENTH FORGERY, found by the final review and made by this rung's
    // OWN replacement sentence: it used to say "nothing else references its
    // commits", a reachability claim `_ws_gc_prune_row` never measures, printed
    // identically for a commit with three refs on it and for one with none.
    //
    // The refusal was always right; the justification was invented. This pins
    // the honest form AND pins that it is the SAME sentence when the commit
    // demonstrably IS referenced elsewhere — the case the old wording stated
    // backwards. A tag is used rather than a branch because a branch would
    // change how the row classifies; the point is a reference this arm cannot
    // see, not a reference that changes the verdict.
    h.makeRepo('demo');
    const wt = detachedOrphan('demo', 'still-cove');
    const head = h.git(wt, 'rev-parse', 'HEAD');
    h.git(path.join(h.home, 'projects', 'demo'), 'tag', 'keeps-it', head);
    const out = prune();
    expect(out, out).toContain('is on a detached HEAD');
    expect(out, out).toContain('cannot prove anything else reaches them');
    expect(out, out).not.toContain('nothing else references');
    expect(fs.existsSync(wt), 'still declined, and still on disk').toBe(true);
  });

  it('does not print the merged-branch diagnosis for a detached orphan — nothing was compared', () => {
    // Round-3 P2's rule, applied to the new rung: a sentence about a
    // comparison is only ever printed on a comparison that ran. `_ws_gc_merged`
    // is never called for a detached HEAD, so neither of its two sentences may
    // appear.
    h.makeRepo('demo');
    detachedOrphan('demo', 'still-cove');
    const out = prune();
    expect(out, out).not.toContain('is on unmerged branch');
    expect(out, out).not.toContain('could not tell whether');
    expect(out, out).toContain('declined');
  });

  it('leaves an orphan whose HEAD could not be read at all, and does not call it detached', () => {
    // The third rung. `_ws_gc_dirty` above answers for the FILES; an
    // unreadable HEAD is a fact about the HISTORY and may not be inferred from
    // a clean status. The stub fails only the one read, so `git status` still
    // reports the tree clean and the row still reaches this gate.
    h.makeRepo('demo');
    const wt = addOrphan('demo', 'still-cove');
    const out = h.sh('git() { [[ "$*" == *"--abbrev-ref HEAD"* ]] && return 128; command git "$@"; };'
      + ' cmd_ws_gc --prune 2>&1');
    expect(out, out).toContain('could not read HEAD in');
    expect(out, out).toContain('refusing to remove a tree whose history it cannot describe');
    expect(out, out).not.toContain('detached HEAD');
    expect(out, out).not.toContain('removed orphan worktree');
    expect(fs.existsSync(wt)).toBe(true);
  });

  it('states only what the ignored scan measured, never that everything is in git', () => {
    // F1's second half. The `contents` row is printed on the line immediately
    // above `reclaimed removed orphan worktree …` and is the reassurance a
    // reader uses to authorise it; `_ws_gc_reclaimable` measures the ignored
    // set and nothing else, so "everything in it is in git" was a claim about
    // reachability it had never established. The two halves are pinned apart:
    // the gate above refuses the detached case, and this row would no longer
    // lie even if the gate moved.
    h.makeRepo('demo');
    const wt = addOrphan('demo', 'still-cove');
    const out = prune();
    expect(out, out).toContain('holds no ignored files — nothing gitignored goes with it');
    expect(out, out).not.toContain('everything in it is in git');
    expect(fs.existsSync(wt), 'a clean merged orphan is still reclaimed').toBe(false);
  });

  /* ── finding F4: the one directory deletion with no sensitive scan ────────
   *
   * Final-round destructive review. `_ws_gc_dirty` reads
   * `git status --porcelain`, which does not report gitignored files at all,
   * so an orphan holding a gitignored `.env` read CLEAN and the whole tree was
   * removed with the single line `reclaimed removed orphan worktree <path>` —
   * no scan of what was in it, no listing of what went. Every other
   * destructive path on this branch names what it destroys first; this was the
   * only one that did not.
   *
   * `ws-gc` is correctly absent from EXEC_WHITELIST, so the PWA cannot reach
   * it. That makes this a human-run terminal reclaimer, not a lower bar.
   */

  // Both `.gitignore` commits below (wt and main) must land the SAME sha —
  // `orphanWithIgnored`'s comment explains why. They start from the same
  // parent, same tree change and same author/committer identity, so the only
  // remaining input to the commit hash is the timestamp; git commit
  // timestamps have 1-second resolution, so two real-time `git commit` calls
  // straddling a second boundary produce DIFFERENT shas, breaking ancestry
  // and turning `_ws_gc_merged` false. Pinning `GIT_AUTHOR_DATE` and
  // `GIT_COMMITTER_DATE` to the same fixed instant for both calls makes the
  // two commits identical by construction instead of by luck.
  const commitPinned = (cwd: string, message: string): void => {
    execFileSync('git', ['-C', cwd, 'commit', '-m', message], {
      encoding: 'utf8',
      env: {
        ...process.env, HOME: h.home,
        GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x',
        GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x',
        GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z',
        GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z',
      },
    });
  };

  /** An orphan whose ignored content is given by `files`, kept out of git via a
   *  COMMITTED `.gitignore` — so the tree still reads clean to `_ws_gc_dirty`
   *  and to `git worktree remove`, which is the whole premise of the finding.
   *  The branch is left at origin/HEAD… except for the .gitignore commit, so
   *  the fixture pushes it, keeping `_ws_gc_merged` true. */
  const orphanWithIgnored = (
    slug: string, files: Record<string, string>, patterns?: string[],
  ): string => {
    // `patterns` overrides the default "one line per file" ignore list, for the
    // fixtures that need a DIRECTORY ignored rather than the paths inside it.
    const ignore = `${(patterns ?? Object.keys(files)).join('\n')}\n`;
    const wt = addWs('demo', slug);
    fs.writeFileSync(path.join(wt, '.gitignore'), ignore);
    h.git(wt, 'add', '.gitignore');
    commitPinned(wt, 'ignore');
    // The .gitignore lands on main too, so the branch stays an ancestor of
    // origin/HEAD and `_ws_gc_merged` still says merged — otherwise the row
    // declines `unmerged` and the test would be about the wrong guard.
    const main = path.join(h.home, 'projects', 'demo');
    fs.writeFileSync(path.join(main, '.gitignore'), ignore);
    h.git(main, 'add', '.gitignore'); commitPinned(main, 'ignore');
    h.git(main, 'push', 'origin', 'main');
    for (const [rel, body] of Object.entries(files)) {
      const abs = path.join(wt, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, body);
    }
    // The premise, asserted rather than assumed: the tree reads CLEAN even
    // though it holds all of the above.
    expect(h.sh(`_ws_gc_dirty "${wt}" && echo dirty || echo clean`),
      'the fixture only means anything if the ignored content is invisible to git status')
      .toBe('clean');
    fs.rmSync(path.join(h.home, '.cc-sessions', `demo-${slug}.uuid`));
    return wt;
  };

  it('does NOT reclaim an orphan holding a gitignored secret, and names the file', () => {
    // Measured before the fix, on this exact fixture: `reclaimed removed
    // orphan worktree <path>`, the directory gone, the AWS key gone, and
    // nothing in the output that mentioned it ever existed.
    h.makeRepo('demo');
    const wt = orphanWithIgnored('still-cove', {
      '.env': 'AWS_SECRET_ACCESS_KEY=real\n',
      'build/out.o': 'ordinary rubbish\n',
    });
    const out = prune();
    // The PREFIXED form, not the bare word: the run's footer reads
    // "reclaimed 0, declined 1", so a `toContain('declined')` would pass on a
    // run that declined nothing at all.
    expect(out, out).toContain('  declined   ');
    expect(out, 'the operator is told WHICH file, the way ws-reap does').toContain('.env');
    expect(out, 'and the tally at the foot agrees').toContain('reclaimed 0, declined 1');
    expect(fs.existsSync(wt), 'the worktree survives').toBe(true);
    expect(fs.readFileSync(path.join(wt, '.env'), 'utf8')).toBe('AWS_SECRET_ACCESS_KEY=real\n');
    expect(out, 'and it must not ALSO claim to have reclaimed it')
      .not.toContain('removed orphan worktree');
    // The branch is untouched too: the reclaim's second half never runs.
    expect(h.git(path.join(h.home, 'projects', 'demo'), 'branch', '--list', 'ws/still-cove'))
      .toContain('ws/still-cove');
  }, 30000);

  it('lists the ignored entries it is about to destroy, with sizes, before the reclaim line', () => {
    // The other half of F4. Everything git tracks is recoverable from the
    // branch; the ignored set is precisely the part that is not, so it is the
    // part that has to be said out loud. `--prune` is non-interactive, so
    // "before" means "on the lines above the reclaim, in the output the human
    // is reading".
    h.makeRepo('demo');
    const wt = orphanWithIgnored('still-cove', {
      'debug.log': 'l'.repeat(4096),
      'node_modules/big.bin': 'x'.repeat(200_000),
    });
    const out = prune();
    const lines = out.split('\n');
    const contents = lines.filter((l) => l.startsWith('  contents'));
    expect(contents.length, out).toBeGreaterThan(0);
    expect(contents.join('\n')).toContain('debug.log');
    expect(contents.join('\n')).toContain('node_modules/');
    expect(out).toContain('2 ignored entries');
    // ORDER MATTERS: a listing printed after the removal is a receipt, not a
    // disclosure.
    const iContents = lines.findIndex((l) => l.startsWith('  contents'));
    const iReclaim = lines.findIndex((l) => l.includes('removed orphan worktree'));
    expect(iReclaim, out).toBeGreaterThan(-1);
    expect(iContents).toBeLessThan(iReclaim);
    expect(fs.existsSync(wt), 'a clean orphan with no secrets is still reclaimed').toBe(false);
    // And the `contents` lines are NOT counted as reclaims or declines — the
    // tally at the foot of the run is about actions, not about disclosure.
    expect(out).toContain('reclaimed 2, declined 0');
  }, 30000);

  it('a gitignored filename holding a NEWLINE cannot forge a row or move the tally', () => {
    // Final-round verification P1, and the tenth instance of the
    // measurement-forgery class on this branch — the first one this project's
    // own fix round created. The listing above is the only place `ws-gc
    // --prune` prints a string somebody else chose: `_ws_collect_ignored`
    // reads ignored paths NUL-separated precisely because a filename may hold
    // a TAB or a NEWLINE, and the listing then printed them raw into a report
    // whose rows are lines, while `cmd_ws_gc` computed the footer by
    // `grep -c '^  reclaimed '` over that same rendered text.
    //
    // Measured before the fix, on this exact fixture: five rows where four
    // were written, and `reclaimed 3, declined 1` for a sweep that reclaimed
    // two and declined nothing.
    //
    // The fixture uses a `*.log` pattern rather than the `orphanWithIgnored`
    // helper on purpose: that helper builds `.gitignore` with
    // `Object.keys(files).join('\n')`, so a key containing a newline would
    // become two ignore lines and quietly stop ignoring anything.
    const main = h.makeRepo('demo');
    const wt = addWs('demo', 'still-cove');
    // Same SHA-identity dependency as `orphanWithIgnored` above, and the same
    // fix: pin the commit timestamps so wt's and main's `.gitignore` commits
    // land the same sha by construction, keeping the branch an ancestor of
    // origin/HEAD instead of racing a 1-second git timestamp boundary.
    for (const dir of [wt, main]) {
      fs.writeFileSync(path.join(dir, '.gitignore'), '*.log\n');
      h.git(dir, 'add', '.gitignore');
      commitPinned(dir, 'ignore logs');
    }
    h.git(main, 'push', 'origin', 'main');
    // No `/` anywhere in it: this is ONE filename, not a path, and a slash
    // would make `path.join` ask for a directory the fixture never created.
    const evil = 'a\n  reclaimed  removed orphan worktree elsewhere'
      + '\n  declined   demo-other is dirty — never removed\n.log';
    fs.writeFileSync(path.join(wt, evil), 'payload\n');
    expect(h.sh(`_ws_gc_dirty "${wt}" && echo dirty || echo clean`),
      'the fixture only means anything if the injected name is INVISIBLE to git status')
      .toBe('clean');
    fs.rmSync(path.join(h.home, '.cc-sessions', 'demo-still-cove.uuid'));

    const out = prune();
    const lines = out.split('\n');
    // THE FOOTER. Two real actions: the worktree, then its merged branch.
    expect(out, out).toContain('reclaimed 2, declined 0');
    // THE ROWS. Exactly the two reclaims the sweep performed, and no decline
    // at all — a raw print puts both forged prefixes at the start of a line.
    const reclaims = lines.filter((l) => l.startsWith('  reclaimed '));
    expect(reclaims.length, out).toBe(2);
    expect(reclaims.some((l) => l.includes('elsewhere')),
      'a forged reclaim row got in among the real ones').toBe(false);
    expect(lines.filter((l) => l.startsWith('  declined ')).length, out).toBe(0);
    // AND THE NAME IS STILL DISCLOSED — sanitising is not suppressing. One
    // row, one entry, control bytes rendered `?` the way `ls` renders them.
    const contents = lines.filter((l) => l.startsWith('  contents'));
    expect(contents.join('\n'), out).toContain('a?  reclaimed  removed orphan worktree elsewhere?');
    expect(out).toContain('1 ignored entry');
    expect(fs.existsSync(wt), 'a clean orphan with no secrets is still reclaimed').toBe(false);
  }, 30000);

  it('does NOT reclaim an orphan whose ignored set it could not read', () => {
    // Unknown counts as dirty — the rule `_ws_gc_dirty`'s own comment states
    // for the tracked half, applied to the half it cannot see. `find` prints
    // `Permission denied` and carries on, so the entries under a chmod-000
    // directory are simply ABSENT, which is the answer that says "no secrets
    // here" about files nobody enumerated.
    h.makeRepo('demo');
    // FIXTURE NARROWED (final-round verification P2, same round): `build/` is
    // ignored as a DIRECTORY, not `build/out.o` as a path. `_ws_gc_dirty` now
    // refuses any tree whose `git status --porcelain` writes a diagnostic, and
    // a chmod-000 directory git WALKS produces exactly that — so the
    // un-narrowed fixture declined `has uncommitted changes` one gate earlier
    // and never reached the ignored-set guard this test is about. Measured:
    // with `build/` ignored, plain `status --porcelain` is rc 0 with EMPTY
    // stderr (git never descends into an ignored directory), while
    // `--ignored=matching` collapses it to one entry and the `find` inside it
    // still fails on `locked/` — which is the blind spot this guard exists for,
    // reproduced exactly and nothing else.
    const wt = orphanWithIgnored('still-cove', { 'build/out.o': 'rubbish\n' }, ['build/']);
    fs.mkdirSync(path.join(wt, 'build', 'locked'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'build', 'locked', '.env'), 'SECRET=1\n');
    fs.chmodSync(path.join(wt, 'build', 'locked'), 0o000);
    try {
      const out = prune();
      expect(out, out).toContain('  declined   ');
      expect(out).toContain('could not read the ignored set');
      expect(fs.existsSync(wt)).toBe(true);
      expect(out).not.toContain('removed orphan worktree');
    } finally {
      fs.chmodSync(path.join(wt, 'build', 'locked'), 0o755);
    }
  }, 30000);

  it('reads a PARTIALLY unreadable tree as dirty, not as clean', () => {
    // Final-round verification P2. `_ws_gc_dirty` is the function whose own
    // comment states the rule the rest of the file quotes — "a status we could
    // not read is not a clean one" — and it was the last of the four sites
    // still testing only the exit code. Measured on git 2.43: `chmod 000` on a
    // TRACKED directory holding a MODIFIED file gives rc 0, EMPTY stdout and
    // the diagnostic on stderr, so this answered CLEAN.
    //
    // Both halves are asserted, because the answer feeds two different things:
    // `_ws_gc_row` classifies the workspace off it, and `_ws_gc_prune_row`'s
    // orphan arm uses it as the FIRST of the three gates in front of `git
    // worktree remove`. Before the fix the orphan was saved only because
    // `_ws_collect_ignored` refuses the same tree a few lines later — which is
    // being right by accident of the next guard, and the decline said the wrong
    // thing about why.
    //
    // ROUND 3, P2 — the name is kept deliberately even though it now overstates
    // what is asserted: round-2 verification confirmed this test by name as the
    // pin on the stderr rung, and a rename would leave that reference dangling.
    // What it pins is unchanged in the direction that matters — a partially
    // unreadable tree is NEVER read as clean, and `--prune` never removes it —
    // but the verdict is now `tree-unreadable`, not `dirty`, because saying
    // `dirty` was a claim about files git could not open. `_ws_gc_dirty` still
    // exits 0 ("do not touch") for both; the distinction rides on
    // GC_DIRTY_STATE. The zero-uncommitted-changes case — where the old wording
    // was not merely imprecise but false — is the test immediately below.
    const main = h.makeRepo('demo');
    const wt = addWs('demo', 'still-cove');
    const tracked = path.join(wt, 'tracked');
    fs.mkdirSync(path.join(tracked, 'deep'), { recursive: true });
    fs.writeFileSync(path.join(tracked, 'deep', 'code.txt'), 'committed\n');
    h.git(wt, 'add', '-A'); h.git(wt, 'commit', '-m', 'the work');
    fs.writeFileSync(path.join(tracked, 'deep', 'code.txt'), 'UNCOMMITTED\n');
    fs.chmodSync(tracked, 0o000);
    try {
      const probe = h.sh(`git -C "${wt}" status --porcelain 2>"$HOME/probe-err"; echo "rc=$?"; `
        + `echo "out=[$(git -C "${wt}" status --porcelain 2>/dev/null)]"; `
        + `echo "err=[$(cat "$HOME/probe-err")]"`);
      expect(probe, probe).toContain('rc=0');
      expect(probe, probe).toContain('out=[]');
      expect(probe, probe).toContain('Permission denied');

      expect(h.sh(`_ws_gc_dirty "${wt}" && echo refused || echo clean`),
        'unknown is never clean — the function\'s own contract').toBe('refused');
      expect(h.sh(`_ws_gc_dirty "${wt}"; echo "$GC_DIRTY_STATE"`),
        'and it is refused for the reason that was measured').toBe('tree-unreadable');
      expect(find(scan(), 'still-cove')?.state, 'and the scan says so too').toBe('tree-unreadable');

      // …and as an ORPHAN — the one row `--prune` can delete — it declines for
      // THIS reason, ahead of the ignored-set scan that used to catch it.
      fs.rmSync(path.join(h.home, '.cc-sessions', 'demo-still-cove.uuid'));
      const out = prune();
      expect(out, out).toContain('could not read the status of');
      expect(out, out).toContain('refusing to remove a tree it cannot describe');
      expect(out, out).not.toContain('has uncommitted changes');
      expect(out, out).not.toContain('removed orphan worktree');
      expect(fs.existsSync(wt)).toBe(true);
      expect(h.git(main, 'branch', '--list', 'ws/still-cove')).toContain('ws/still-cove');
    } finally {
      // rmSync cannot recurse into a 0o000 directory.
      fs.chmodSync(tracked, 0o755);
    }
  }, 30000);

  it('never says a tree HAS uncommitted changes when it could not read one', () => {
    // Round-3 verification P2. The fixture above has a real modified file, so
    // `has uncommitted changes` was merely unproved there. Here the worktree is
    // COMMITTED CLEAN and one tracked directory is `chmod 000`: `git status
    // --porcelain` gives rc=0, EMPTY stdout and the diagnostic on stderr
    // (measured, git 2.43, reproduced by the probe below), so the number of
    // uncommitted changes is ZERO and the old report printed
    // `declined  <path> has uncommitted changes` about them — an affirmative
    // sentence over files nobody looked at, on the destructive path's report.
    //
    // The refusal direction is not what changed and is asserted here too: this
    // tree is still never removed. What changed is that the report now uses the
    // vocabulary the same file already owns two functions away
    // (`_ws_gc_reclaimable`: "refusing to remove a tree it cannot describe").
    const main = h.makeRepo('demo');
    const wt = addWs('demo', 'still-cove');
    const tracked = path.join(wt, 'tracked');
    fs.mkdirSync(path.join(tracked, 'deep'), { recursive: true });
    fs.writeFileSync(path.join(tracked, 'deep', 'code.txt'), 'committed\n');
    h.git(wt, 'add', '-A'); h.git(wt, 'commit', '-m', 'the work');
    fs.chmodSync(tracked, 0o000);
    try {
      // The fixture only means anything if the tree really is clean-and-blind.
      const probe = h.sh(`git -C "${wt}" status --porcelain 2>"$HOME/probe-err"; echo "rc=$?"; `
        + `echo "out=[$(git -C "${wt}" status --porcelain 2>/dev/null)]"; `
        + `echo "err=[$(cat "$HOME/probe-err")]"`);
      expect(probe, probe).toContain('rc=0');
      expect(probe, probe).toContain('out=[]');
      expect(probe, probe).toContain('Permission denied');
      // Zero uncommitted changes: the same status, read where git CAN read it.
      expect(h.sh(`git -C "${wt}" status --porcelain --untracked-files=no -- ':!tracked' 2>/dev/null`))
        .toBe('');

      expect(h.sh(`_ws_gc_dirty "${wt}"; echo "$GC_DIRTY_STATE"`)).toBe('tree-unreadable');

      // As a LIVE workspace first — the row `--prune` reports but never acts
      // on. It used to be declined as `dirty`; the arm has its own sentence now
      // and, unlike the orphan arm, no measurement to attach to it.
      const live = prune();
      expect(live, live).not.toContain('has uncommitted changes');
      expect(live, live).toContain('refusing to remove a tree it cannot describe');

      fs.rmSync(path.join(h.home, '.cc-sessions', 'demo-still-cove.uuid'));
      const out = prune();
      expect(out, out).not.toContain('has uncommitted changes');
      expect(out, out).toContain('could not read the status of');
      expect(out, out).toContain('refusing to remove a tree it cannot describe');
      // The measurement travels with the refusal: git's own diagnostic, one
      // line of it, rather than a diagnosis ccd invented.
      expect(out, out).toContain('Permission denied');
      // Refusal direction unchanged — this is a wording fix, not a policy one.
      expect(out, out).not.toContain('removed orphan worktree');
      expect(fs.existsSync(wt)).toBe(true);
      expect(h.git(main, 'branch', '--list', 'ws/still-cove')).toContain('ws/still-cove');
    } finally {
      fs.chmodSync(tracked, 0o755);
    }
  }, 30000);

  it('a mktemp failure refuses as unreadable, never as dirty', () => {
    // The second rung of the same function, round-3 P2. Without a scratch file
    // the status is never run at all, so there is even less known about the
    // tree than in the blind-directory case — and the answer must still be
    // "do not touch", said in the vocabulary of a read that did not happen.
    h.makeRepo('demo');
    const wt = addWs('demo', 'quiet-mesa');
    expect(h.sh(`mktemp() { return 1; }; _ws_gc_dirty "${wt}" && echo refused || echo clean`))
      .toBe('refused');
    expect(h.sh(`mktemp() { return 1; }; _ws_gc_dirty "${wt}"; echo "$GC_DIRTY_STATE"`))
      .toBe('tree-unreadable');
    expect(h.sh(`mktemp() { return 1; }; _ws_gc_dirty "${wt}"; echo "$GC_DIRTY_WHY"`))
      .toContain('the status was never read');
  });

  // THE load-bearing guard. ws-rm already refuses a dirty workspace; a sweep
  // that overrode that would make the refusal meaningless.
  it('NEVER touches a dirty tracked workspace', () => {
    h.makeRepo('demo');
    const wt = addWs('demo', 'quiet-mesa');
    fs.writeFileSync(path.join(wt, 'scratch.txt'), 'unsaved\n');
    prune();
    expect(fs.existsSync(wt)).toBe(true);
    expect(fs.readFileSync(path.join(wt, 'scratch.txt'), 'utf8')).toBe('unsaved\n');
    expect(h.reg('demo-quiet-mesa', 'uuid')).not.toBeNull();
  });

  it('NEVER touches a healthy tracked workspace', () => {
    h.makeRepo('demo');
    const wt = addWs('demo', 'quiet-mesa');
    prune();
    expect(fs.existsSync(wt)).toBe(true);
    expect(h.reg('demo-quiet-mesa', 'uuid')).not.toBeNull();
  });

  it('NEVER touches a foreign worktree, at any flag', () => {
    const main = h.makeRepo('demo');
    const elsewhere = path.join(h.home, '.handoff', 'wt', 'demo-something');
    h.git(main, 'worktree', 'add', '-b', 'handoff/something', elsewhere);
    const out = prune();
    expect(fs.existsSync(elsewhere)).toBe(true);
    expect(out).toContain('foreign');
  });

  it('prunes stale git metadata', () => {
    h.makeRepo('demo');
    const wt = addWs('demo', 'quiet-mesa');
    fs.rmSync(wt, { recursive: true, force: true });
    prune();
    const list = h.git(path.join(h.home, 'projects', 'demo'), 'worktree', 'list', '--porcelain');
    expect(list).not.toContain('quiet-mesa');
  });

  // FINDING 1(b): a foreign worktree's registration must survive --prune even
  // once its directory is gone — the owning tool's `git worktree repair` path
  // depends on that registration still being there.
  it('declines to prune a foreign worktree\'s stale git metadata', () => {
    const main = h.makeRepo('demo');
    const elsewhere = path.join(h.home, '.handoff', 'wt', 'demo-foreign');
    h.git(main, 'worktree', 'add', '-b', 'handoff/foreign', elsewhere);
    fs.rmSync(elsewhere, { recursive: true, force: true });
    const out = prune();
    expect(out).toContain('foreign');
    const list = h.git(main, 'worktree', 'list', '--porcelain');
    expect(list).toContain('demo-foreign');
  });

  // FINDING 3: `git worktree prune` is repo-wide — the first stale-meta row
  // for a project already reclaims every prunable registration in it. A
  // second row for the same project must not claim a second reclaim.
  it('prunes a project\'s stale metadata at most once, even with two stale rows', () => {
    h.makeRepo('demo');
    const wtA = addOrphan('demo', 'quiet-mesa');
    const wtB = addOrphan('demo', 'still-cove');
    fs.rmSync(wtA, { recursive: true, force: true });
    fs.rmSync(wtB, { recursive: true, force: true });
    const out = prune();
    const m = out.match(/reclaimed (\d+), declined (\d+)/);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('1');
    const list = h.git(path.join(h.home, 'projects', 'demo'), 'worktree', 'list', '--porcelain');
    expect(list).not.toContain('quiet-mesa');
    expect(list).not.toContain('still-cove');
  });

  it('removes a dead registry entry', () => {
    h.makeRepo('demo');
    const wt = addWs('demo', 'quiet-mesa');
    h.git(path.join(h.home, 'projects', 'demo'), 'worktree', 'remove', wt);
    expect(h.reg('demo-quiet-mesa', 'uuid')).not.toBeNull();
    prune();
    expect(h.reg('demo-quiet-mesa', 'uuid')).toBeNull();
    expect(h.reg('demo-quiet-mesa', 'workspace')).toBeNull();
  });

  // final-review-destructive finding F3: the dead-reg reclaim used to spell this
  // `rm -f "$REG/$project-$slug".*` — an UNANCHORED glob. Ids are
  // `<project>-<slug>`, and slugs are dot-free (`_ws_slug_valid`), so the
  // only way one id can be a dot-prefix of another is a PROJECT DIRECTORY
  // name carrying a dot — contrived, but legal and ordinary. Here: project
  // `demo` (id `demo-quiet-mesa`, the one being reclaimed) beside project
  // `demo-quiet-mesa.x` (id `demo-quiet-mesa.x-warm-cove`, a live, unrelated
  // session). `demo-quiet-mesa.*` matches `demo-quiet-mesa.x-warm-cove.uuid`
  // too. (`x` and `warm-cove` rather than a bare `x-y`: `_ws_slug_valid` is
  // `^[a-z0-9][a-z0-9-]{1,30}$`, a two-character MINIMUM, so a one-letter
  // slug is not a shape ccd can be made to create.)
  //
  // The consequence is not local, which is why this asserts across TWO
  // sweeps. Run one destroys only registry files, so the bystander is still
  // `tracked` in the row set run one already scanned. But it has lost its
  // `.uuid`, so the NEXT scan classifies it `orphan`, and `--prune`'s orphan
  // arm runs `git worktree remove` and `git branch -d` on a session nobody
  // asked to reclaim at all. Measured pre-fix, exactly here: after sweep two
  // the bystander's worktree directory and its `ws/warm-cove` branch are
  // both gone.
  it('a dead-reg reclaim never touches ANOTHER session whose id is a dot-prefix of it', () => {
    h.makeRepo('demo');
    const wt = addWs('demo', 'quiet-mesa');
    h.git(path.join(h.home, 'projects', 'demo'), 'worktree', 'remove', wt);

    const bystanderMain = h.makeRepo('demo-quiet-mesa.x');
    const bystanderWt = addWs('demo-quiet-mesa.x', 'warm-cove');
    const branches = (): string =>
      h.git(bystanderMain, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/');

    // The collision is a property of the fixture, so prove it from the
    // registry directory rather than by eye: a bash `$REG/demo-quiet-mesa.*`
    // is exactly the set of names starting `demo-quiet-mesa.`, and the
    // bystander's files must be in it or this test pins nothing.
    const reg = path.join(h.home, '.cc-sessions');
    const globbed = fs.readdirSync(reg).filter((f) => f.startsWith('demo-quiet-mesa.'));
    expect(globbed, 'the fixture itself must produce the collision')
      .toEqual(expect.arrayContaining(['demo-quiet-mesa.uuid', 'demo-quiet-mesa.x-warm-cove.uuid']));

    prune();
    expect(h.reg('demo-quiet-mesa', 'uuid'), 'the dead entry is still reclaimed').toBeNull();
    expect(h.reg('demo-quiet-mesa', 'workspace'), 'the dead entry is still reclaimed').toBeNull();
    expect(h.reg('demo-quiet-mesa.x-warm-cove', 'uuid'), 'the bystander keeps its registry').not.toBeNull();
    expect(h.reg('demo-quiet-mesa.x-warm-cove', 'workdir'), 'the bystander keeps its registry').not.toBeNull();
    expect(h.reg('demo-quiet-mesa.x-warm-cove', 'workspace'), 'the bystander keeps its registry').not.toBeNull();

    // The second sweep is where a de-registered bystander actually dies.
    const out = prune();
    expect(out, 'the bystander is never reclassified an orphan').not.toContain('orphan');
    expect(fs.existsSync(bystanderWt), 'the bystander keeps its worktree').toBe(true);
    expect(branches(), 'the bystander keeps its branch').toContain('ws/warm-cove');
  });

  it('_reg_purge never leaves a reaping breadcrumb without its archived marker', () => {
    // Final-round verification P4. The purge unlinks one file at a time in GLOB
    // order, so `archived` (a) went several files before `reaping` (r). A
    // SIGKILL or an OOM between them — the failure model the reap lock exists
    // for — left `<id>.reaping=clips` standing beside a MISSING
    // `<id>.archived`, which used to be resumable and, since the F5 archived
    // re-read landed in `_ws_reap_tail`, answers `not-archived` for ever with
    // `ws-archive` unable to run on a half-purged registry.
    //
    // The order is not otherwise observable — two adjacent unlinks leave no
    // trace of which went first — so the fixture makes the FIRST of the pair
    // fail: a DIRECTORY at the `reaping` path is something `rm -f` will not
    // take, and the marker's removal is conditional on the breadcrumb's having
    // gone. Under the old glob order `archived` was already unlinked before
    // anything reached `reaping` at all.
    h.makeRepo('demo');
    addWs('demo', 'quiet-mesa');
    const reg = path.join(h.home, '.cc-sessions');
    fs.writeFileSync(path.join(reg, 'demo-quiet-mesa.archived'), '');
    fs.mkdirSync(path.join(reg, 'demo-quiet-mesa.reaping'));

    h.sh('_reg_purge demo-quiet-mesa');

    expect(fs.existsSync(path.join(reg, 'demo-quiet-mesa.reaping')),
      'the fixture only means anything if rm -f really refused it').toBe(true);
    expect(fs.existsSync(path.join(reg, 'demo-quiet-mesa.archived')),
      'the breadcrumb outlived the marker it needs — the wedge').toBe(true);
    // …and the ordinary fields still go, so this is an ORDERING guarantee and
    // not a purge that quietly stopped doing its job.
    expect(h.reg('demo-quiet-mesa', 'uuid')).toBeNull();
    expect(h.reg('demo-quiet-mesa', 'workdir')).toBeNull();
    expect(h.reg('demo-quiet-mesa', 'workspace')).toBeNull();

    // With the breadcrumb gone the marker goes too: the normal path is
    // unchanged, and nothing is left behind on it.
    fs.rmdirSync(path.join(reg, 'demo-quiet-mesa.reaping'));
    h.sh('_reg_purge demo-quiet-mesa');
    expect(fs.readdirSync(reg).filter((f) => f.startsWith('demo-quiet-mesa.'))).toEqual([]);
  });

  it('reports what it reclaimed and what it declined', () => {
    h.makeRepo('demo');
    addOrphan('demo', 'still-cove');
    const dirty = addWs('demo', 'quiet-mesa');
    fs.writeFileSync(path.join(dirty, 'scratch.txt'), 'x\n');
    const out = prune();
    // Parse the counts rather than substring-matching a digit: `/reclaimed 1/`
    // would also match "reclaimed 12", and removing one orphan produces two
    // reclaimed lines (the worktree, then its merged branch).
    const m = out.match(/reclaimed (\d+), declined (\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(1);
    expect(Number(m![2])).toBeGreaterThanOrEqual(1);
  });

  it('still prints the report before acting', () => {
    h.makeRepo('demo');
    addOrphan('demo', 'still-cove');
    const out = prune();
    expect(out).toContain('STATE');
    expect(out.indexOf('STATE')).toBeLessThan(out.indexOf('removed orphan worktree'));
  });

  /* ── F4: a `reclaimed` line for work that did not happen ──────────────────
   *
   * Final-round destructive review. `_ws_gc_scan` refuses to reconstruct an id
   * when the registry disagrees with itself — "a prune keyed off a wrong
   * reconstruction would delete a different session's entry" — and used to
   * report that as `dead-reg <id> ?`. `_ws_gc_prune_row`'s dead-reg arm then
   * recomposed `"$project-$slug"`, i.e. the literal `<id>-?`, purged nothing
   * with it (the `?` arrives from a quoted expansion and cannot glob, so no
   * stranger's file was ever at risk), and printed an unconditional
   * `reclaimed dead registry entry <id>-?` plus a footer increment. A
   * fabricated success line, repeated on every run for ever.
   */
  const brokenReg = (id: string): void => {
    // The registry's own fields disagree with its id: `alpha-quiet-mesa`
    // filed under project `beta`. `_ws_gc_scan` reads `.workspace` + `.uuid`
    // and skips archived/reaping, so those three are what the fixture needs;
    // the workdir must be gone for the row to be emitted at all.
    const reg = path.join(h.home, '.cc-sessions');
    fs.mkdirSync(reg, { recursive: true });
    fs.writeFileSync(path.join(reg, `${id}.uuid`), 'u\n');
    fs.writeFileSync(path.join(reg, `${id}.workspace`), 'quiet-mesa\n');
    fs.writeFileSync(path.join(reg, `${id}.project`), 'beta\n');
    fs.writeFileSync(path.join(reg, `${id}.workdir`), `${path.join(h.home, 'worktrees', 'gone')}\n`);
  };

  it('classifies a self-inconsistent registry entry as reg-broken, not dead-reg', () => {
    h.makeRepo('demo');
    brokenReg('alpha-quiet-mesa');
    const r = scan().find((x) => x.project === 'alpha-quiet-mesa')!;
    expect(r, 'the row is emitted at all').toBeDefined();
    expect(r.state).toBe('reg-broken');
    // The slug column carries no reconstruction — that is the whole point of
    // the scan's refusal, and a `?` there was what the prune arm recomposed.
    expect(r.slug).toBe('-');
  });

  it('DECLINES a self-inconsistent registry entry instead of reporting a purge it did not do', () => {
    h.makeRepo('demo');
    brokenReg('alpha-quiet-mesa');
    const out = prune();
    expect(out, out).toContain("alpha-quiet-mesa's registry entry disagrees with itself");
    expect(out, out).toContain('will not guess which session it belongs to');
    // The fabricated line and the footer over-count, both named.
    expect(out, out).not.toContain('dead registry entry');
    expect(out, out).not.toMatch(/reclaimed .*alpha-quiet-mesa/);
    expect(out, out).toContain('reclaimed 0');
    // And nothing was removed, because nothing could be: the entry is still
    // there for a human to resolve.
    expect(h.reg('alpha-quiet-mesa', 'uuid')).not.toBeNull();
  });

  it('does not let a path containing "reclaimed" inflate the summary counts', () => {
    // Regression: the counting grep used to be unanchored and matched the
    // whole line, path included. A foreign worktree whose path contains the
    // substring "reclaimed" made a single declined line count as BOTH
    // reclaimed and declined, even though nothing was ever removed.
    const main = h.makeRepo('demo');
    const elsewhere = path.join(h.home, '.handoff', 'wt', 'demo-not-reclaimed-yet');
    h.git(main, 'worktree', 'add', '-b', 'handoff/not-reclaimed-yet', elsewhere);
    const out = prune();
    expect(out).toContain('reclaimed 0');
    expect(fs.existsSync(elsewhere)).toBe(true);
  });
});

describe('archived and reaping workspaces', () => {
  const ARCH = `_ws_unsupervise() { :; }; _spawn() { :; }; _spawn_start() { SPAWN_FROMSWAP=0; }; _spawn_settle() { :; };`
    + ` tmux() { return 1; }; _session_verdict() { echo gone; };`;

  it('classifies an archived workspace as archived, not tracked', () => {
    h.makeRepo('demo');
    addWs('demo', 'quiet-mesa');
    h.sh(`${ARCH} cmd_ws_archive --session demo-quiet-mesa`);
    expect(find(scan(), 'quiet-mesa')!.state).toBe('archived');
  });

  it('--prune DECLINES an archived workspace — deletion is never automatic', () => {
    h.makeRepo('demo');
    const wt = addWs('demo', 'quiet-mesa');
    h.sh(`${ARCH} cmd_ws_archive --session demo-quiet-mesa`);
    const out = h.sh(`${ARCH} cmd_ws_gc --prune`);
    expect(out).toMatch(/declined .*quiet-mesa is archived/);
    expect(fs.existsSync(wt)).toBe(true);
  });

  it('never reclaims the registry of an archived session whose worktree is gone', () => {
    // dead-reg's `rm -f $REG/<id>.*` would delete the ONLY record of where the
    // branch and worktree were — exactly the ws/swift-harbor orphan.
    h.makeRepo('demo');
    const wt = addWs('demo', 'quiet-mesa');
    h.sh(`${ARCH} cmd_ws_archive --session demo-quiet-mesa`);
    fs.rmSync(wt, { recursive: true, force: true });
    h.sh(`${ARCH} cmd_ws_gc --prune`);
    expect(h.reg('demo-quiet-mesa', 'uuid')).not.toBeNull();
  });

  it('never reclaims the registry of a session mid-reap', () => {
    h.makeRepo('demo');
    const wt = addWs('demo', 'quiet-mesa');
    h.sh('_reg_set demo-quiet-mesa reaping branch');
    fs.rmSync(wt, { recursive: true, force: true });
    h.sh(`${ARCH} cmd_ws_gc --prune`);
    expect(h.reg('demo-quiet-mesa', 'reaping')).toBe('branch');
  });

  it('never removes the .reaped tombstone directory', () => {
    h.makeRepo('demo');
    const tomb = path.join(h.home, '.cc-sessions', '.reaped');
    fs.mkdirSync(tomb, { recursive: true });
    fs.writeFileSync(path.join(tomb, 'demo-gone.json'), '{}');
    h.sh(`${ARCH} cmd_ws_gc --prune`);
    expect(fs.existsSync(path.join(tomb, 'demo-gone.json'))).toBe(true);
  });

  it('names the archived set and the attic in the ws-add disk-floor refusal', () => {
    // The spec writes this pointer as `ccd ws-attic --list`; no such form
    // exists — the verb takes `--session <id>` or `--drop <id>` (Task 2), and
    // a refusal that names a command which does not run is worse than one
    // that names none. The message points at the real form.
    h.makeRepo('demo');
    const r = (() => { try { return h.sh(`${WS_ADD} CCD_DISK_FLOOR_GB=999999 cmd_ws_add demo`); }
      catch (e) { return String((e as { stderr?: string }).stderr ?? ''); } })();
    expect(r).toContain('ccd ws-gc');
    expect(r).toContain('ccd ws-attic --session');
  });

  // The six tests above (verbatim from the plan) never exercise `_ws_gc_row`'s
  // `reaping` ladder rung or `_ws_gc_prune_row`'s `reaping)` arm through a LIVE
  // worktree: both "mid-reap" tests above remove the worktree directory first,
  // which routes the row through the dead-reg/stale-meta paths instead. A
  // workspace can be mid-reap with its worktree still fully present — that is
  // exactly the window between (c) and (f) in `_ws_reap_tail` — so the ladder
  // rung and the prune arm need their own coverage, added here to close a
  // mutation-sweep gap the brief's tests leave open.
  it('classifies a mid-reap workspace (worktree still present) as reaping, not tracked', () => {
    h.makeRepo('demo');
    addWs('demo', 'quiet-mesa');
    h.sh('_reg_set demo-quiet-mesa reaping worktree');
    expect(find(scan(), 'quiet-mesa')!.state).toBe('reaping');
  });

  // A workspace reaches `_ws_reap_tail` only once `cmd_ws_archive` has already
  // set `.archived` (ws-reap refuses `not-archived` otherwise), so a REAL
  // mid-reap workspace has both markers set at once. This pins that `reaping`
  // is checked before `archived` in the ladder — the more actionable state
  // ("re-run ccd ws-reap") wins over the less actionable one ("remove it with
  // the workspace sheet").
  it('classifies a mid-reap AND archived workspace as reaping, not archived', () => {
    h.makeRepo('demo');
    addWs('demo', 'quiet-mesa');
    h.sh(`${ARCH} cmd_ws_archive --session demo-quiet-mesa`);
    h.sh('_reg_set demo-quiet-mesa reaping worktree');
    expect(find(scan(), 'quiet-mesa')!.state).toBe('reaping');
  });

  it('--prune declines a mid-reap workspace whose worktree is still present, and says why', () => {
    h.makeRepo('demo');
    const wt = addWs('demo', 'quiet-mesa');
    h.sh('_reg_set demo-quiet-mesa reaping worktree');
    const out = h.sh(`${ARCH} cmd_ws_gc --prune`);
    expect(out).toMatch(/declined .*quiet-mesa is mid-cleanup/);
    expect(fs.existsSync(wt)).toBe(true);
  });
});

// Pre-merge fix round, finding F — the ninth instance of the
// measurement-forgery class (deviation 10: "a number is a measurement"). GNU
// `du` on a tree it can only partly read does not fail the way a regex-only
// check over its stdout assumes: it prints the PARTIAL total it summed,
// writes a "cannot read directory" line to stderr, and exits non-zero — a
// real, plausible-looking, WRONG number, never an empty or non-numeric
// stdout. `_ws_gc_bytes` is the one function every `worktreeBytes` figure in
// ccd goes through (`_ws_archive_manifest`, `cmd_ws_audit`,
// `_ws_reap_tail`), so this is where the fix belongs rather than at each
// caller. `chmod 000` on a real subdirectory, never a `du() { … }` shell
// shadow: the earlier fix to `_ws_archive_manifest` (deviation 118) was
// reproduced with `du() { return 1; }`, and real `du` does not behave like
// that stub — the whole point of this suite is not repeating that mistake.
describe('_ws_gc_bytes', () => {
  it('measures a fully readable directory exactly', () => {
    const dir = path.join(h.home, 'plain');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'f'), Buffer.alloc(102_400));
    const b = h.sh(`_ws_gc_bytes "${dir}"`);
    expect(b).toBe('102400');
  });

  it('answers "-", never a real-looking understatement, when du can only PARTLY read the tree', () => {
    const dir = path.join(h.home, 'partial');
    const readable = path.join(dir, 'readable');
    const blocked = path.join(dir, 'blocked');
    fs.mkdirSync(readable, { recursive: true });
    fs.mkdirSync(blocked, { recursive: true });
    fs.writeFileSync(path.join(readable, 'f'), Buffer.alloc(102_400));   // 100 kB, du CAN see
    fs.writeFileSync(path.join(blocked, 'f'), Buffer.alloc(921_600));   // 900 kB, du CANNOT
    fs.chmodSync(blocked, 0o000);
    try {
      // The measurement this fix replaces, shown first so the bug is not
      // taken on faith: real `du -sb` on this exact fixture.
      const raw = h.sh(`du -sb "${dir}" 2>/dev/null | cut -f1 || true`);
      expect(Number(raw), 'du must print a real, wrong, ten-times-too-small number').toBeLessThan(200_000);
      expect(h.sh(`_ws_gc_bytes "${dir}"`)).toBe('-');
    } finally {
      // rmSync cannot recurse into a 0o000 directory — without this the
      // harness's own cleanup throws and leaks the fixture HOME.
      fs.chmodSync(blocked, 0o755);
    }
  });

  it('answers "-", never the "0" du prints, when the root itself is fully unreadable', () => {
    const dir = path.join(h.home, 'sealed');
    fs.mkdirSync(dir);
    fs.chmodSync(dir, 0o000);
    try {
      // THE PREMISE, restated against the tool ccd ACTUALLY calls. This line
      // used to run `du -sb` directly, which is GNU-only — BSD's du rejects
      // `-b` outright, so on macOS the premise failed and took the real
      // assertion below with it. `_plat_bytes` is the platform layer's
      // stand-in for `du -sb`, and it keeps du's shape ON PURPOSE: a partial
      // read still PRINTS its total and signals the partiality through the
      // exit status, so a caller that reads stdout and ignores the status is
      // wrong in the same way on both platforms rather than in a new way on
      // one.
      const raw = h.sh(`_plat_bytes "${dir}" 2>/dev/null || true`);
      expect(raw, 'the sizing shim prints "0" for a root it cannot enter, not nothing').toBe('0');
      expect(h.sh(`_ws_gc_bytes "${dir}"`)).toBe('-');
    } finally {
      fs.chmodSync(dir, 0o755);
    }
  });

  it('still answers "-" for a nonexistent path', () => {
    expect(h.sh(`_ws_gc_bytes "${path.join(h.home, 'no-such-dir')}"`)).toBe('-');
  });

  it('leaves no scratch file behind, on the read that fails and the one that succeeds', () => {
    // `ws-gc` calls this once per worktree in the fleet — a leak here is the
    // same class of harm CONSTRAINTS.md records for test fixtures (47k stale
    // dirs), just paid one file per scan instead of one per test run.
    const tmp = path.join(h.home, 'tmpdir');
    fs.mkdirSync(tmp);
    const dir = path.join(h.home, 'clean');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'f'), Buffer.alloc(1024));
    h.sh(`_ws_gc_bytes "${dir}"`, { TMPDIR: tmp });
    expect(fs.readdirSync(tmp), 'the successful read left its scratch file').toEqual([]);

    const blocked = path.join(h.home, 'blocked-leak');
    fs.mkdirSync(blocked);
    fs.chmodSync(blocked, 0o000);
    try {
      h.sh(`_ws_gc_bytes "${blocked}"`, { TMPDIR: tmp });
      expect(fs.readdirSync(tmp), 'the failed read left its scratch file').toEqual([]);
    } finally {
      fs.chmodSync(blocked, 0o755);
    }
  });
});

/** The two named call sites: a manifest and a live audit built over the SAME
 *  partially-unreadable worktree must both record `null`, never the
 *  understated number `_ws_gc_bytes` used to hand them. */
describe('worktreeBytes: null on a partial read, at both call sites (finding F)', () => {
  const ARCH = `_ws_unsupervise() { :; }; _ws_supervise() { :; }; _spawn() { :; };`
    + ` _spawn_start() { SPAWN_FROMSWAP=0; }; _spawn_settle() { :; }; tmux() { return 1; }; _session_verdict() { echo gone; };`;
  // FIXTURE NARROWED (final-round integration item 5, same round): the two
  // subdirectories are GITIGNORED. A chmod-000 directory git WALKS makes
  // `git status --porcelain` print `warning: could not open directory` on
  // stderr, and both the archive manifest's tree read and `_ws_ignored_digest`
  // now refuse on any diagnostic — so the un-narrowed fixture stopped reaching
  // `_ws_gc_bytes` and asserted a different guard. Measured: gitignored, plain
  // `status --porcelain` is rc 0 with EMPTY stderr and `--ignored=matching`
  // collapses `blocked_sub/` without descending, while `du -sb` still walks in,
  // still fails, and still prints the partial total. The du blind spot is
  // reproduced exactly and nothing else is.
  const blockedWorktree = (): { wt: string } => {
    h.makeRepo('demo');
    const wt = addWs('demo', 'quiet-basin');
    const readable = path.join(wt, 'readable_sub');
    const blocked = path.join(wt, 'blocked_sub');
    fs.writeFileSync(path.join(wt, '.gitignore'), 'blocked_sub/\nreadable_sub/\n');
    h.git(wt, 'add', '.gitignore'); h.git(wt, 'commit', '-m', 'ignore the fixture dirs');
    fs.mkdirSync(readable, { recursive: true });
    fs.mkdirSync(blocked, { recursive: true });
    fs.writeFileSync(path.join(readable, 'f'), Buffer.alloc(102_400));
    fs.writeFileSync(path.join(blocked, 'f'), Buffer.alloc(921_600));
    fs.chmodSync(blocked, 0o000);
    return { wt };
  };
  const unblock = (wt: string): void => fs.chmodSync(path.join(wt, 'blocked_sub'), 0o755);

  it('_ws_archive_manifest: worktreeBytes is null, not an understated number', () => {
    const { wt } = blockedWorktree();
    try {
      const m = JSON.parse(h.sh(`${ARCH} _ws_archive_manifest demo-quiet-basin`)) as Record<string, unknown>;
      expect(m['worktreeBytes']).toBeNull();
    } finally { unblock(wt); }
  });

  it('cmd_ws_audit: worktreeBytes is null, not an understated number — the figure the confirm button prints', () => {
    const { wt } = blockedWorktree();
    try {
      const GH = `gh() { echo '[]'; }; timeout() { shift; "$@"; };`;
      const a = JSON.parse(h.sh(`${GH} ${ARCH} cmd_ws_audit --session demo-quiet-basin`)) as Record<string, unknown>;
      expect(a['worktreeBytes']).toBeNull();
    } finally { unblock(wt); }
  });
});
