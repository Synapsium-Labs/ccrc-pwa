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
  // ── the branch name comes from git's worktree record, not from the directory ──
  // Every read and every write below used to be aimed at $workdir, i.e. at
  // whatever repository owns that DIRECTORY. Hand-delete the worktree and let
  // anything else land at that path and ws-rename read a STRANGER's branch name
  // and then renamed the stranger's branch, after which the registry recorded
  // the stranger's new name as ccrc's own.
  //
  // Declared at the TOP of the describe (TDZ, not hoisting) — some `it`s above
  // the fixtures that build on them still need `branches`.
  const mainDir = (): string => path.join(h.home, 'projects', 'demo');
  const branches = (glob: string): string => h.git(mainDir(), 'branch', '--list', glob);

  /** Every refusal is an ANSWER now: one JSON object on stdout at exit 0. `h.sh`
   *  throws on a non-zero exit, so reading refusals THROUGH it is also the
   *  assertion that only `git branch -m` failing may exit non-zero. */
  const rename = (id: string, branch: string): Record<string, unknown> =>
    JSON.parse(h.sh(`cmd_ws_rename --session '${id}' --branch '${branch}'`)) as Record<string, unknown>;

  const refusal = (id: string, branch: string): string => {
    const o = rename(id, branch);
    expect(o.refused, `expected a refusal, got ${JSON.stringify(o)}`).toBeTruthy();
    return String(o.refused);
  };

  it('renames the branch and records it', () => {
    const wt = addOne();
    expect(rename('demo-quiet-mesa', 'feat/real-name')).toEqual({
      renamed: 'demo-quiet-mesa', old: 'ws/quiet-mesa', new: 'feat/real-name',
    });
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feat/real-name');
    expect(h.reg('demo-quiet-mesa', 'branch')).toBe('feat/real-name');
  });

  it('leaves the workspace slug, directory and id alone', () => {
    const wt = addOne();
    rename('demo-quiet-mesa', 'feat/real-name');
    expect(fs.existsSync(wt)).toBe(true);
    expect(h.reg('demo-quiet-mesa', 'workspace')).toBe('quiet-mesa');
    expect(h.reg('demo-quiet-mesa', 'uuid')).not.toBeNull();
  });

  // ── arity and id validation: the whole point of leaving the positional
  // generation. `${1:?}`/`${2:?}` was a MINIMUM-arity guard whose usage line
  // was bash's, and extra argv was silently ignored.
  it('refuses anything but the exact four-token argv', () => {
    addOne();
    for (const argv of [
      '',
      '--session demo-quiet-mesa',
      '--branch feat/real-name',
      'demo-quiet-mesa feat/real-name',
      '--session demo-quiet-mesa --branch feat/real-name --draft true',
      '--branch feat/real-name --session demo-quiet-mesa',
    ]) {
      const o = JSON.parse(h.sh(`cmd_ws_rename ${argv}`)) as Record<string, unknown>;
      expect(o.refused, `ccd ws-rename ${argv}`).toBe('bad-args');
    }
  });

  it('refuses a session id that is not a session id, before any git command sees it', () => {
    addOne();
    expect(refusal('../../etc/passwd', 'feat/real-name')).toBe('bad-args');
    expect(refusal('demo quiet mesa', 'feat/real-name')).toBe('bad-args');
    expect(h.git(path.join(h.home, 'projects', 'demo'), 'branch', '--list', 'feat/real-name')).toBe('');
  });

  it('refuses an unknown id', () => {
    expect(refusal('nope-nothing', 'feat/real-name')).toBe('no-such-session');
  });

  it('refuses a session that is not a workspace', () => {
    h.sh(`_reg_set claude2-demo wrapper claude2
          _reg_set claude2-demo project demo
          _reg_set claude2-demo workdir ${path.join(h.home, 'projects', 'demo')}
          _reg_set claude2-demo uuid abc`);
    expect(refusal('claude2-demo', 'feat/real-name')).toBe('not-a-workspace');
  });

  it('refuses a registry row with no project or workdir', () => {
    h.sh(`_reg_set half-row uuid abc
          _reg_set half-row workspace quiet-mesa`);
    expect(refusal('half-row', 'feat/real-name')).toBe('incomplete-registry');
  });

  // The ruling on the missing-directory guard, pinned: ws-rename still REFUSES.
  // See the comment on the guard itself for why.
  it('refuses when the worktree directory is gone, though the record survives', () => {
    const wt = addOne();
    fs.rmSync(wt, { recursive: true, force: true });
    expect(refusal('demo-quiet-mesa', 'feat/real-name')).toBe('worktree-missing');
    expect(branches('ws/quiet-mesa')).not.toBe('');
    expect(branches('feat/real-name')).toBe('');
    expect(h.reg('demo-quiet-mesa', 'branch')).toBe('ws/quiet-mesa');
  });

  it('refuses an invalid name without touching the branch', () => {
    const wt = addOne();
    expect(refusal('demo-quiet-mesa', 'feat/../escape')).toBe('bad-branch');
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('ws/quiet-mesa');
  });

  it('refuses when the name is unchanged', () => {
    addOne();
    expect(refusal('demo-quiet-mesa', 'ws/quiet-mesa')).toBe('unchanged');
  });

  it('refuses once the branch has an upstream — the remote already has the old name', () => {
    const wt = addOne();
    h.git(wt, 'push', '-u', 'origin', 'HEAD:refs/heads/ws/quiet-mesa');
    expect(refusal('demo-quiet-mesa', 'feat/real-name')).toBe('has-upstream');
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('ws/quiet-mesa');
    expect(h.reg('demo-quiet-mesa', 'branch')).toBe('ws/quiet-mesa');
  });

  it('refuses a name that already exists locally', () => {
    const wt = addOne();
    h.git(path.join(h.home, 'projects', 'demo'), 'branch', 'feat/taken');
    expect(refusal('demo-quiet-mesa', 'feat/taken')).toBe('name-taken-local');
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('ws/quiet-mesa');
  });

  it('refuses a name that already exists on the remote', () => {
    const wt = addOne();
    // On origin but not local: exactly the case a local-only check would miss.
    h.git(wt, 'push', 'origin', 'HEAD:refs/heads/feat/taken-upstream');
    expect(refusal('demo-quiet-mesa', 'feat/taken-upstream')).toBe('name-taken-origin');
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('ws/quiet-mesa');
  });

  it('renames anyway when origin is unreachable, and says so', () => {
    // Unreachable is not the same as taken. Refusing here would make ws-rename
    // unusable offline for a branch that has never been pushed. The warn goes to
    // stderr, so this one reads the merged stream and does not JSON.parse it.
    const wt = addOne();
    h.git(path.join(h.home, 'projects', 'demo'), 'remote', 'set-url', 'origin',
      path.join(h.home, 'origins', 'gone.git'));
    const out = h.sh(`cmd_ws_rename --session demo-quiet-mesa --branch feat/real-name 2>&1`);
    expect(out).toContain('could not reach origin');
    expect(out).toContain('"renamed"');
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feat/real-name');
  });

  it('is reachable as a subcommand', () => {
    addOne();
    const o = JSON.parse(
      h.sh(`"${CCD}" ws-rename --session demo-quiet-mesa --branch feat/real-name`),
    ) as Record<string, unknown>;
    expect(o.new).toBe('feat/real-name');
  });

  // `git branch -m` failing is THE one path that keeps a non-zero exit: nothing
  // about the request was wrong, so it is a fault and not a refusal, and the
  // caller must not mark the pair attempted-and-answered on the strength of it.
  // The shim spells its own `command git` passthrough, as every git stub here does.
  it('exits non-zero when the rename itself fails — a fault, not a refusal', () => {
    const wt = addOne();
    const NOMV = `git() { [[ "$*" == *"branch -m"* ]] && { echo "fatal: nope" >&2; return 1; }; command git "$@"; };`;
    expect(() => h.sh(`${NOMV} cmd_ws_rename --session demo-quiet-mesa --branch feat/real-name`))
      .toThrow();
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('ws/quiet-mesa');
    expect(h.reg('demo-quiet-mesa', 'branch')).toBe('ws/quiet-mesa');
  });

  // ── Build 2.5 interaction, ASSERTED rather than assumed (rider delta 7) ──
  // A rename is not a destructive act and has no hold rung: `cmd_ws_rm` and
  // `cmd_ws_reap` refuse a held workspace because they DELETE, and this moves a
  // ref on a branch that by definition has never been pushed. A hold rung here
  // would refuse the only moment automatic naming ever fires — a workspace an
  // orchestrator claimed for wave 1 is exactly the one whose first turn is
  // landing. And prhistory is appended at exactly one chokepoint, the
  // `prnumber` replacement inside `_pr_py` (ccd:759, :852); a rename precedes
  // any PR, so it must leave that file absent.
  it('renames a HELD workspace, and leaves the hold and the prhistory alone', () => {
    addOne();
    h.sh(`cmd_ws_hold --session demo-quiet-mesa --reason "program:agent-evals wave:1/4"`);
    expect(rename('demo-quiet-mesa', 'feat/real-name').new).toBe('feat/real-name');
    expect(h.reg('demo-quiet-mesa', 'hold')).toBe('program:agent-evals wave:1/4');
    expect(h.reg('demo-quiet-mesa', 'prhistory')).toBeNull();
    expect(h.reg('demo-quiet-mesa', 'prnumber')).toBeNull();
  });

  it('refuses a stale record whose directory came back as its own repository, and renames nothing', () => {
    const wt = addOne();
    fs.rmSync(wt, { recursive: true, force: true });   // NO `worktree prune`: the record stands
    h.git(h.home, 'init', '-b', 'stranger', wt);
    fs.writeFileSync(path.join(wt, 'PRECIOUS'), 'not ccd’s to rename\n');
    h.git(wt, 'add', 'PRECIOUS');
    h.git(wt, 'commit', '-m', 'someone else lives here');

    expect(refusal('demo-quiet-mesa', 'feat/real-name')).toBe('worktree-foreign');
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

    expect(refusal('demo-quiet-mesa', 'feat/real-name')).toBe('worktree-foreign');
    expect(h.git(path.join(h.home, 'projects', 'other'), 'branch', '--list', 'ws/borrowed'))
      .not.toBe('');
    expect(h.git(path.join(h.home, 'projects', 'other'), 'branch', '--list', 'feat/real-name'))
      .toBe('');
    expect(branches('ws/quiet-mesa')).not.toBe('');
    expect(h.reg('demo-quiet-mesa', 'branch')).toBe('ws/quiet-mesa');
  });

  // Rung 2 of three. Git HAS a registration for the path and it says `detached`:
  // a real state with a real, different remedy from rung 3, so it gets its own
  // words — and now its own token.
  it('refuses a recorded detached HEAD', () => {
    const wt = addOne();
    h.git(wt, 'checkout', '--detach');
    const o = rename('demo-quiet-mesa', 'feat/real-name');
    expect(o.refused).toBe('detached');
    expect(String(o.detail)).toContain('detached HEAD');
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
    const o = rename('demo-quiet-mesa', 'feat/real-name');
    expect(o.refused).toBe('worktree-unregistered');
    expect(String(o.detail)).toContain('no worktree record');
    expect(branches('ws/quiet-mesa')).not.toBe('');
    expect(h.reg('demo-quiet-mesa', 'branch')).toBe('ws/quiet-mesa');
  });

  // Rung 1, stated against the record rather than against the directory: the
  // rename runs in $main, and git's own registration for the worktree must come
  // out of it naming the new branch — that is what ws-rm later reads.
  it('renames in the project and leaves git’s record naming the new branch', () => {
    const wt = addOne();
    expect(rename('demo-quiet-mesa', 'feat/real-name')).toEqual({
      renamed: 'demo-quiet-mesa', old: 'ws/quiet-mesa', new: 'feat/real-name',
    });
    expect(h.sh(`_ws_wt_branch "${mainDir()}" "${wt}"`)).toBe('feat/real-name');
    expect(branches('ws/quiet-mesa')).toBe('');
  });

  // ── the DIRECTORY can disagree with the record while still passing the guard ──
  // The stale-record cases above are caught by the identity guard, so they never
  // reach the rename itself. This fixture is the one that does: our workspace
  // directory has been restored from a copy of a SIBLING workspace of the same
  // project (a restore or an rsync that puts back the wrong one), so its `.git`
  // points at the sibling's admin directory and every in-DIRECTORY question
  // answers `ws/second-slug` — while git's record in $main still says the path
  // is ours on ws/quiet-mesa. Both worktrees belong to $main, so
  // `_ws_common_dir` sees one common directory on both sides and the guard
  // passes, correctly: nothing here is a stranger's. What is left to get right
  // is which branch the remaining reads and the write actually name.
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

  it('renames the recorded branch in the project, not the branch the directory has checked out', () => {
    const [ours, sibling] = restoredFromSibling();
    // The fixture: the two answers disagree, and only one of them is evidence.
    expect(h.git(ours, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('ws/second-slug');
    expect(h.sh(`_ws_wt_branch "${mainDir()}" "${ours}"`)).toBe('ws/quiet-mesa');

    expect(rename('demo-quiet-mesa', 'feat/real-name')).toEqual({
      renamed: 'demo-quiet-mesa', old: 'ws/quiet-mesa', new: 'feat/real-name',
    });
    // Ours moved, so the object it printed is true...
    expect(branches('ws/quiet-mesa')).toBe('');
    expect(branches('feat/real-name')).not.toBe('');
    // ...and the sibling workspace still has its own branch and its own record.
    expect(branches('ws/second-slug')).not.toBe('');
    expect(h.sh(`_ws_wt_branch "${mainDir()}" "${sibling}"`)).toBe('ws/second-slug');
  });

  // The upstream check is asked in $main and about $old BY NAME, which is the
  // only way it can be about the branch this rename is about. In-worktree
  // `@{u}` asks after the DIRECTORY's current branch instead: here that is the
  // sibling's, which has never been pushed, so the one guard that exists to
  // stop a rename after a push answers about the wrong branch and waves ours
  // through.
  it('refuses because OUR branch has an upstream, though the directory’s branch has none', () => {
    const [ours] = restoredFromSibling();
    h.git(mainDir(), 'push', '-u', 'origin', 'ws/quiet-mesa');
    // The fixture: in the directory there is no upstream to find.
    expect(() => h.git(ours, 'rev-parse', '--abbrev-ref', '@{u}')).toThrow();

    expect(refusal('demo-quiet-mesa', 'feat/real-name')).toBe('has-upstream');
    expect(branches('ws/quiet-mesa')).not.toBe('');
    expect(branches('feat/real-name')).toBe('');
    expect(h.reg('demo-quiet-mesa', 'branch')).toBe('ws/quiet-mesa');
  });
});
