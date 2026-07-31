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
    expect(r.path).toBe(elsewhere);
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
    expect(r.path).toBe(deep);
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
    const snapshot = (): string =>
      execFileSync('find', [h.home, '-printf', '%P %s %y\\n'], { encoding: 'utf8' })
        .split('\n').sort().join('\n');
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

  it('leaves an orphan alone when it cannot resolve origin/HEAD at all', () => {
    // No origin means no base to compare against, so "merged" is unprovable.
    // Unprovable must resolve to declining, not to deleting.
    const main = h.makeRepo('demo');
    const wt = addOrphan('demo', 'still-cove');
    h.git(main, 'remote', 'remove', 'origin');
    const out = prune();
    expect(out).toContain('unmerged');
    expect(fs.existsSync(wt)).toBe(true);
  });

  it('leaves an orphan whose branch has unmerged commits, and says why', () => {
    h.makeRepo('demo');
    const wt = addOrphan('demo', 'still-cove');
    fs.writeFileSync(path.join(wt, 'work.txt'), 'ahead\n');
    h.git(wt, 'add', 'work.txt');
    h.git(wt, 'commit', '-m', 'ahead of base');
    const out = prune();
    expect(out).toContain('unmerged');
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
  const ARCH = `_ws_unsupervise() { :; }; _spawn() { :; }; tmux() { return 1; }; _alive() { return 1; };`;

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
