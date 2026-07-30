// ws-rename renames a workspace branch before it is pushed. Sourced under an
// isolated HOME, so nothing here can reach the real registry or a real repo.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { makeCcdHarness, CCD, WS_ADD, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-rename-'); });
afterEach(() => { h.cleanup(); });

/** A workspace on ws/quiet-mesa. Returns its worktree path. */
const addOne = (): string => {
  h.makeRepo('demo');
  h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
  return path.join(h.home, 'worktrees', 'demo', 'quiet-mesa');
};

describe('_ws_branch_valid', () => {
  const ok = (s: string): boolean =>
    h.sh(`_ws_branch_valid '${s}' && echo yes || echo no`) === 'yes';

  it('accepts the type/slug shape every repo here uses', () => {
    expect(ok('feat/int-7-mcp-image-attachments')).toBe(true);
    expect(ok('ccrc/attachment-tray')).toBe(true);
    expect(ok('fix/MEK-995.cleanup')).toBe(true);
  });

  it('rejects a leading dash — git would read it as an option', () => {
    expect(ok('--force')).toBe(false);
  });

  it('rejects the ref-format traps git itself rejects', () => {
    expect(ok('feat/../escape')).toBe(false);
    expect(ok('/leading')).toBe(false);
    expect(ok('trailing/')).toBe(false);
    expect(ok('feat/thing.lock')).toBe(false);
    expect(ok('feat/thing.lock/more')).toBe(false);   // any COMPONENT, not just the suffix
  });

  it('rejects spaces, colons and glob characters', () => {
    expect(ok('feat/two words')).toBe(false);
    expect(ok('feat:thing')).toBe(false);
    expect(ok('feat/*')).toBe(false);
  });

  it('rejects the empty name', () => {
    expect(ok('')).toBe(false);
  });
});

describe('ws-rename', () => {
  it('renames the branch and records it', () => {
    const wt = addOne();
    const out = h.sh(`cmd_ws_rename demo-quiet-mesa feat/real-name`);
    expect(out).toContain('ws/quiet-mesa');
    expect(out).toContain('feat/real-name');
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feat/real-name');
    expect(h.reg('demo-quiet-mesa', 'branch')).toBe('feat/real-name');
  });

  it('leaves the workspace slug, directory and id alone', () => {
    const wt = addOne();
    h.sh(`cmd_ws_rename demo-quiet-mesa feat/real-name`);
    expect(fs.existsSync(wt)).toBe(true);
    expect(h.reg('demo-quiet-mesa', 'workspace')).toBe('quiet-mesa');
    expect(h.reg('demo-quiet-mesa', 'uuid')).not.toBeNull();
  });

  it('refuses once the branch has an upstream — the remote already has the old name', () => {
    const wt = addOne();
    h.git(wt, 'push', '-u', 'origin', 'HEAD:refs/heads/ws/quiet-mesa');
    expect(() => h.sh(`cmd_ws_rename demo-quiet-mesa feat/real-name`)).toThrow();
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('ws/quiet-mesa');
    expect(h.reg('demo-quiet-mesa', 'branch')).toBe('ws/quiet-mesa');
  });

  it('refuses a name that already exists locally', () => {
    const wt = addOne();
    h.git(path.join(h.home, 'projects', 'demo'), 'branch', 'feat/taken');
    expect(() => h.sh(`cmd_ws_rename demo-quiet-mesa feat/taken`)).toThrow();
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('ws/quiet-mesa');
  });

  it('refuses a name that already exists on the remote', () => {
    const wt = addOne();
    // On origin but not local: exactly the case a local-only check would miss.
    h.git(wt, 'push', 'origin', 'HEAD:refs/heads/feat/taken-upstream');
    expect(() => h.sh(`cmd_ws_rename demo-quiet-mesa feat/taken-upstream`)).toThrow();
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('ws/quiet-mesa');
  });

  it('renames anyway when origin is unreachable, and says so', () => {
    // Unreachable is not the same as taken. Refusing here would make ws-rename
    // unusable offline for a branch that has never been pushed.
    const wt = addOne();
    h.git(path.join(h.home, 'projects', 'demo'), 'remote', 'set-url', 'origin',
      path.join(h.home, 'origins', 'gone.git'));
    const out = h.sh(`cmd_ws_rename demo-quiet-mesa feat/real-name 2>&1`);
    expect(out).toContain('could not reach origin');
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feat/real-name');
  });

  it('refuses an invalid name without touching the branch', () => {
    const wt = addOne();
    expect(() => h.sh(`cmd_ws_rename demo-quiet-mesa 'feat/../escape'`)).toThrow();
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('ws/quiet-mesa');
  });

  it('refuses a session that is not a workspace', () => {
    h.sh(`_reg_set claude2-demo wrapper claude2
          _reg_set claude2-demo project demo
          _reg_set claude2-demo workdir ${path.join(h.home, 'projects', 'demo')}
          _reg_set claude2-demo uuid abc`);
    expect(() => h.sh(`cmd_ws_rename claude2-demo feat/real-name`)).toThrow();
  });

  it('refuses an unknown id', () => {
    expect(() => h.sh(`cmd_ws_rename nope-nothing feat/real-name`)).toThrow();
  });

  it('refuses when the name is unchanged', () => {
    addOne();
    expect(() => h.sh(`cmd_ws_rename demo-quiet-mesa ws/quiet-mesa`)).toThrow();
  });

  it('is reachable as a subcommand', () => {
    addOne();
    expect(h.sh(`"${CCD}" ws-rename demo-quiet-mesa feat/real-name`)).toContain('feat/real-name');
  });

  // ── the branch name comes from git's worktree record, not from the directory ──
  // Every read and every write below used to be aimed at $workdir, i.e. at
  // whatever repository owns that DIRECTORY. Hand-delete the worktree and let
  // anything else land at that path and ws-rename read a STRANGER's branch name
  // and then renamed the stranger's branch, after which the registry recorded
  // the stranger's new name as ccrc's own.
  const mainDir = (): string => path.join(h.home, 'projects', 'demo');
  const branches = (glob: string): string => h.git(mainDir(), 'branch', '--list', glob);

  it('refuses a stale record whose directory came back as its own repository, and renames nothing', () => {
    const wt = addOne();
    fs.rmSync(wt, { recursive: true, force: true });   // NO `worktree prune`: the record stands
    h.git(h.home, 'init', '-b', 'stranger', wt);
    fs.writeFileSync(path.join(wt, 'PRECIOUS'), 'not ccd’s to rename\n');
    h.git(wt, 'add', 'PRECIOUS');
    h.git(wt, 'commit', '-m', 'someone else lives here');

    expect(() => h.sh(`cmd_ws_rename demo-quiet-mesa feat/real-name`)).toThrow();
    // The stranger keeps its own branch, and never gains ours.
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('stranger');
    expect(h.git(wt, 'branch', '--list', 'feat/real-name')).toBe('');
    // ...and ccrc's own branch and registry row are exactly as they were.
    expect(branches('ws/quiet-mesa')).not.toBe('');
    expect(branches('feat/real-name')).toBe('');
    expect(h.reg('demo-quiet-mesa', 'branch')).toBe('ws/quiet-mesa');
  });

  it('refuses a stale record whose directory came back as ANOTHER repo’s worktree', () => {
    const wt = addOne();
    fs.rmSync(wt, { recursive: true, force: true });   // NO `worktree prune`
    h.makeRepo('other');
    h.git(path.join(h.home, 'projects', 'other'), 'worktree', 'add', '-b', 'ws/borrowed', wt);

    expect(() => h.sh(`cmd_ws_rename demo-quiet-mesa feat/real-name`)).toThrow();
    expect(h.git(path.join(h.home, 'projects', 'other'), 'branch', '--list', 'ws/borrowed'))
      .not.toBe('');
    expect(h.git(path.join(h.home, 'projects', 'other'), 'branch', '--list', 'feat/real-name'))
      .toBe('');
    expect(branches('ws/quiet-mesa')).not.toBe('');
    expect(h.reg('demo-quiet-mesa', 'branch')).toBe('ws/quiet-mesa');
  });

  // Rung 2 of three. Git HAS a registration for the path and it says `detached`:
  // a real state with a real, different remedy from rung 3, so it gets its own
  // words.
  it('refuses a recorded detached HEAD', () => {
    const wt = addOne();
    h.git(wt, 'checkout', '--detach');
    expect(() => h.sh(`cmd_ws_rename demo-quiet-mesa feat/real-name`)).toThrow(/detached HEAD/);
    expect(branches('ws/quiet-mesa')).not.toBe('');
    expect(h.reg('demo-quiet-mesa', 'branch')).toBe('ws/quiet-mesa');
  });

  // Rung 3 of three: no registration at all. Reachable by hand — a botched
  // manual cleanup that deletes the worktree's admin directory leaves the
  // checkout in place with nothing in $main naming it. Nothing corroborates the
  // registry's branch name any more, so there is no name to rename; that is a
  // different sentence from "recorded, detached".
  it('refuses when git has no worktree record for the path', () => {
    addOne();
    fs.rmSync(path.join(mainDir(), '.git', 'worktrees', 'quiet-mesa'),
      { recursive: true, force: true });
    expect(() => h.sh(`cmd_ws_rename demo-quiet-mesa feat/real-name`))
      .toThrow(/no worktree record/);
    expect(branches('ws/quiet-mesa')).not.toBe('');
    expect(h.reg('demo-quiet-mesa', 'branch')).toBe('ws/quiet-mesa');
  });

  // Rung 1, stated against the record rather than against the directory: the
  // rename runs in $main, and git's own registration for the worktree must come
  // out of it naming the new branch — that is what ws-rm later reads.
  it('renames in the project and leaves git’s record naming the new branch', () => {
    const wt = addOne();
    const out = h.sh(`cmd_ws_rename demo-quiet-mesa feat/real-name`);
    expect(out).toBe('renamed demo-quiet-mesa: ws/quiet-mesa -> feat/real-name');
    expect(h.sh(`_ws_wt_branch "${mainDir()}" "${wt}"`)).toBe('feat/real-name');
    expect(branches('ws/quiet-mesa')).toBe('');
  });

  // ── the DIRECTORY can disagree with the record while still passing the guard ──
  // The stale-record cases above are caught by the identity guard, so they never
  // reach the rename itself. This fixture is the one that does: our workspace
  // directory has been restored from a copy of a SIBLING workspace of the same
  // project (a restore or an rsync that puts back the wrong one), so its `.git`
  // points at the sibling's admin directory and every in-DIRECTORY question
  // answers `ws/second-slug` — while git's record in $main still says the path is
  // ours on ws/quiet-mesa. Both worktrees belong to $main, so `_ws_common_dir`
  // sees one common directory on both sides and the guard passes, correctly:
  // nothing here is a stranger's. What is left to get right is which branch the
  // remaining reads and the write actually name.
  /** Returns [our workspace's directory, the sibling's]. */
  const restoredFromSibling = (): [string, string] => {
    h.makeRepo('demo');
    h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    h.sh(`${WS_ADD} CCD_WS_SLUG=second-slug cmd_ws_add demo`);
    const ours = path.join(h.home, 'worktrees', 'demo', 'quiet-mesa');
    const sibling = path.join(h.home, 'worktrees', 'demo', 'second-slug');
    fs.rmSync(ours, { recursive: true, force: true });
    fs.cpSync(sibling, ours, { recursive: true });
    return [ours, sibling];
  };

  // The rename runs in $main and names BOTH ends, so it can only ever move the
  // branch git's record named. One-arg `git -C "$workdir" branch -m "$new"`
  // renames the current branch of whatever repository owns the DIRECTORY — here
  // the sibling's registration — so it moves the sibling's branch, leaves ours
  // where it was, and still prints our name and records the new one.
  it('renames the recorded branch in the project, not the branch the directory has checked out', () => {
    const [ours, sibling] = restoredFromSibling();
    // The fixture: the two answers disagree, and only one of them is evidence.
    expect(h.git(ours, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('ws/second-slug');
    expect(h.sh(`_ws_wt_branch "${mainDir()}" "${ours}"`)).toBe('ws/quiet-mesa');

    const out = h.sh(`cmd_ws_rename demo-quiet-mesa feat/real-name`);
    expect(out).toBe('renamed demo-quiet-mesa: ws/quiet-mesa -> feat/real-name');
    // Ours moved, so the line it printed is true...
    expect(branches('ws/quiet-mesa')).toBe('');
    expect(branches('feat/real-name')).not.toBe('');
    // ...and the sibling workspace still has its own branch and its own record.
    expect(branches('ws/second-slug')).not.toBe('');
    expect(h.sh(`_ws_wt_branch "${mainDir()}" "${sibling}"`)).toBe('ws/second-slug');
  });

  // The upstream check is asked in $main and about $old BY NAME, which is the
  // only way it can be about the branch this rename is about. In-worktree
  // `@{u}` asks after the DIRECTORY's current branch instead: here that is the
  // sibling's, which has never been pushed, so the one guard that exists to stop
  // a rename after a push answers about the wrong branch and waves ours through.
  it('refuses because OUR branch has an upstream, though the directory’s branch has none', () => {
    const [ours] = restoredFromSibling();
    h.git(mainDir(), 'push', '-u', 'origin', 'ws/quiet-mesa');
    // The fixture: in the directory there is no upstream to find.
    expect(() => h.git(ours, 'rev-parse', '--abbrev-ref', '@{u}')).toThrow();

    expect(() => h.sh(`cmd_ws_rename demo-quiet-mesa feat/real-name`))
      .toThrow(/has an upstream/);
    expect(branches('ws/quiet-mesa')).not.toBe('');
    expect(branches('feat/real-name')).toBe('');
    expect(h.reg('demo-quiet-mesa', 'branch')).toBe('ws/quiet-mesa');
  });

  // The ruling on the missing-directory guard, pinned: ws-rename still REFUSES.
  // See the comment on the guard itself for why.
  it('refuses when the worktree directory is gone, though the record survives', () => {
    const wt = addOne();
    fs.rmSync(wt, { recursive: true, force: true });
    expect(() => h.sh(`cmd_ws_rename demo-quiet-mesa feat/real-name`))
      .toThrow(/worktree is gone/);
    expect(branches('ws/quiet-mesa')).not.toBe('');
    expect(branches('feat/real-name')).toBe('');
    expect(h.reg('demo-quiet-mesa', 'branch')).toBe('ws/quiet-mesa');
  });
});
