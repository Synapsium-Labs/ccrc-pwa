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
});
