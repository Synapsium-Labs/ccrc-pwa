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
   *  assertion that `git branch -m` failing is the one REFUSAL path that keeps
   *  a non-zero exit. It is not the only non-zero path in the function: the
   *  `_json_str probe` at the top (ccd:1379-1380) is a FAULT for the same
   *  reason, and on a python3-less box every refusal case below would throw at
   *  the probe before ever reaching its own printf — this harness runs with
   *  python3 present, which is what keeps that case from being vacuous here. */
  const rename = (id: string, branch: string): Record<string, unknown> =>
    JSON.parse(h.sh(`cmd_ws_rename --session '${id}' --branch '${branch}'`)) as Record<string, unknown>;

  // `paths` is asserted on the PARSED object, never by substring on the raw
  // text — a mutant that widened the printf's `%s` slot to something other
  // than the literal `[]` (or dropped the field) would still contain the
  // six characters `"paths"` somewhere in the string. Every refusal here
  // routes through this helper, so this is the one place that needs to say
  // it: `cmd_ws_rename` never has paths to report — that field exists on
  // this envelope only because `cmd_ws_reap`'s shares the shape.
  const refusal = (id: string, branch: string): string => {
    const o = rename(id, branch);
    expect(o.refused, `expected a refusal, got ${JSON.stringify(o)}`).toBeTruthy();
    expect(o.paths, `expected "paths":[] on a refusal, got ${JSON.stringify(o)}`).toEqual([]);
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
      // Single-clause mutants: `[[ $# -ne 4 || $1 != --session || $3 != --branch ]]`
      // has three clauses, and the case above flips BOTH flag positions at
      // once, so it cannot tell "the $1 check is gone" from "the $3 check is
      // gone" apart — either alone still catches it. These two are arity 4
      // with exactly one flag name wrong, so each kills only its own clause.
      '--sess demo-quiet-mesa --branch feat/real-name',    // only $1 wrong
      '--session demo-quiet-mesa --brnch feat/real-name',  // only $3 wrong
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

  // `project` and `workdir` alone do not discriminate this guard: the fixture
  // above is missing all three fields, so a check that forgot `branch`
  // entirely would still pass it. This one is complete but for `branch`,
  // which the registry-branch-drift rung two guards down reads
  // unconditionally — without this check the row falls through and answers
  // `{"refused":"registry-branch-drift","detail":"the registry says , git's
  // worktree record for … says ws/quiet-mesa …"}`, a detail with a blank
  // clause standing in for a refusal that actually names the gap.
  it('refuses a registry row missing branch, though project and workdir are present', () => {
    addOne();
    fs.rmSync(path.join(h.home, '.cc-sessions', 'demo-quiet-mesa.branch'));
    const o = rename('demo-quiet-mesa', 'feat/real-name');
    expect(o.refused).toBe('incomplete-registry');
    expect(String(o.detail)).not.toContain('registry says ,');
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

  // The gap the `@{u}` check alone leaves: `git push origin <branch>` with no
  // `-u` puts the branch on origin without writing any tracking config, so
  // `@{u}` answers "no upstream configured" for a branch that has, in fact,
  // been pushed — exactly the false negative that let a naming sweep push
  // origin into carrying both the old and the new name. `has-upstream` must
  // catch this the same way it catches a tracked push, since it is the same
  // fact by a different route.
  it('refuses has-upstream for a branch pushed WITHOUT a tracking upstream (no `-u`)', () => {
    const wt = addOne();
    h.git(wt, 'push', 'origin', 'ws/quiet-mesa');
    expect(() => h.git(wt, 'rev-parse', '--abbrev-ref', 'ws/quiet-mesa@{u}')).toThrow();
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

  // The OTHER non-zero path in this function: `_json_str probe`, checked ONCE
  // up front, before even the arity check, so python3 missing is a FAULT —
  // the verb cannot answer at all — rather than a swallowed status inside one
  // of the refusals' own `$(_json_str …)` printing a document with a hole in
  // it. Same shim idiom as `ccd-ws-audit.test.ts`'s python3-unrunnable case:
  // `-c` is `_json_str`'s own invocation form and nothing else's here, so this
  // breaks quoting without touching anything else that shells out to python3.
  it('REFUSES outright when python3 cannot quote — a fault, not a refusal', () => {
    addOne();
    const NOPY = `python3() { [[ "\${1-}" == -c ]] && return 127; command python3 "$@"; };`;
    expect(h.sh(`${NOPY} ( cmd_ws_rename --session demo-quiet-mesa --branch feat/real-name ) `
      + `>out.json 2>err.txt; echo "exit=$?"`)).toBe('exit=1');
    expect(fs.readFileSync(path.join(h.home, 'out.json'), 'utf8'),
      'a fault must print no document, not a document with a hole in it').toBe('');
    expect(fs.readFileSync(path.join(h.home, 'err.txt'), 'utf8')).toContain('python3');
    expect(h.git(path.join(h.home, 'projects', 'demo'), 'branch', '--list', 'ws/quiet-mesa'))
      .not.toBe('');
  });

  // `git branch -m` failing is the one REFUSAL path that keeps a non-zero exit
  // — the only other non-zero path in the function is the `_json_str probe` at
  // the top (ccd:1379-1380), also a fault rather than a verdict on the request.
  // This one: nothing about the request was wrong, so it is a fault and not a
  // refusal — the caller must not read it as a REFUSAL ANSWER (no token, no
  // refusalSentence), but the pair IS still marked attempted, like every other
  // non-ok CcdResult. The shim spells its own `command git` passthrough, as
  // every git stub here does.
  it('exits non-zero when the rename itself fails — a fault, not a refusal', () => {
    const wt = addOne();
    const NOMV = `git() { [[ "$*" == *"branch -m"* ]] && { echo "fatal: nope" >&2; return 1; }; command git "$@"; };`;
    expect(() => h.sh(`${NOMV} cmd_ws_rename --session demo-quiet-mesa --branch feat/real-name`))
      .toThrow();
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('ws/quiet-mesa');
    expect(h.reg('demo-quiet-mesa', 'branch')).toBe('ws/quiet-mesa');
  });

  // ── Wave 3 §3.1: POLICY REVERSAL, recorded rather than quietly swapped ──
  // Build 2.5's ruling was that a rename is not destructive and therefore needs
  // no hold rung, and that a rung here "would refuse the only moment automatic
  // naming ever fires". That second half is now the POINT: the moment automatic
  // naming fires on a claimed workspace is the moment a coordinator's ledger,
  // its brief and every fleet surface stop agreeing on what the worker is
  // called. `FleetWatcher.sweepNames` skips a claimed row before it ever calls
  // this verb; this rung is defence in depth, because the sweep is not the only
  // caller and a hold can land inside the sweep's read-then-call window.
  // prhistory is unchanged by either outcome and is still asserted here.
  it('refuses a HELD workspace, renames nothing, and leaves hold and prhistory alone', () => {
    const wt = addOne();
    h.sh(`cmd_ws_hold --session demo-quiet-mesa --reason "program:agent-evals wave:1/4"`);
    expect(refusal('demo-quiet-mesa', 'feat/real-name')).toBe('held');
    // The refusal is an ANSWER, not a fault: exit 0 (h.sh would throw otherwise,
    // which `refusal()` going through `rename()` already proves) and nothing moved.
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('ws/quiet-mesa');
    expect(h.reg('demo-quiet-mesa', 'branch')).toBe('ws/quiet-mesa');
    expect(h.reg('demo-quiet-mesa', 'hold')).toBe('program:agent-evals wave:1/4');
    expect(h.reg('demo-quiet-mesa', 'prhistory')).toBeNull();
    expect(h.reg('demo-quiet-mesa', 'prnumber')).toBeNull();
  });

  // `-e` not `-f`, matching the four existing hold readers (`cmd_ws_rm`,
  // `cmd_ws_reap`, `cmd_forget`, and `ws-release`'s own): doubt reads as HELD.
  // A directory at `$REG/<id>.hold` is the cheapest present-but-unreadable
  // shape a test can build, and `-f` would sail straight past it.
  it('refuses on a present-but-unreadable hold — doubt reads as held', () => {
    addOne();
    h.sh(`mkdir "$HOME/.cc-sessions/demo-quiet-mesa.hold"`);
    expect(refusal('demo-quiet-mesa', 'feat/real-name')).toBe('held');
  });

  // The other direction, so the rung is a refusal rather than an outage.
  it('renames an UNHELD workspace exactly as before, and after a release', () => {
    const wt = addOne();
    h.sh(`cmd_ws_hold --session demo-quiet-mesa --reason "program:agent-evals wave:1/4"`);
    h.sh(`cmd_ws_release --session demo-quiet-mesa`);
    expect(rename('demo-quiet-mesa', 'feat/real-name').new).toBe('feat/real-name');
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feat/real-name');
  });

  // PLACEMENT, pinned: before any git work. Learning a workspace is off-limits
  // must not cost an `ls-remote` to origin — the same rule `cmd_ws_reap`'s copy
  // of this rung states for itself ("before, because learning a workspace is
  // off-limits must not cost a gh call, a fetch, or a lock left behind"). The
  // poisoned `gh` and a refused rename share one property: neither should have
  // run at all.
  it('refuses before it touches git or the network', () => {
    addOne();
    h.sh(`cmd_ws_hold --session demo-quiet-mesa --reason "program:agent-evals wave:1/4"`);
    // A `git` that records every call and then refuses: if the rung is placed
    // after the worktree/upstream probes, one of them fires and this reds.
    const NOGIT = `git() { echo "git $*" >> "$HOME/ccd-calls"; return 1; };`;
    const o = JSON.parse(
      h.sh(`${NOGIT} cmd_ws_rename --session demo-quiet-mesa --branch feat/real-name`),
    ) as { refused?: string };
    expect(o.refused).toBe('held');
    expect(h.calls().filter((c) => c.startsWith('git ')), 'a refused rename runs no git')
      .toEqual([]);
    expect(h.ghPoison(), 'a refused rename reaches no gh').toEqual([]);
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

  // A hand `git branch -m` bypasses ws-rename, so the registry keeps the OLD
  // name while git's own record moves — the exact drift `cmd_ws_reap` already
  // refuses on (`registry-branch-drift`) and the naming sweep's own condition
  // 2 cannot see, because it reads the registry only. Without this check,
  // ws-rename would derive `$old` from git (the NEW, hand-chosen name) and
  // rename THAT to whatever the sweep derived — silently renaming a branch a
  // human chose on purpose. This is what fails loudly if anyone "simplifies"
  // the fix to "use the registry field" instead of corroborating both.
  it('refuses when a hand `git branch -m` has moved git away from what the registry still says', () => {
    const wt = addOne();
    h.git(mainDir(), 'branch', '-m', 'ws/quiet-mesa', 'renamed-by-hand');
    expect(h.sh(`_ws_wt_branch "${mainDir()}" "${wt}"`)).toBe('renamed-by-hand');
    expect(h.reg('demo-quiet-mesa', 'branch')).toBe('ws/quiet-mesa');

    const o = rename('demo-quiet-mesa', 'feat/real-name');
    expect(o.refused).toBe('registry-branch-drift');
    expect(String(o.detail)).toContain('renamed-by-hand');
    expect(String(o.detail)).toContain('ws/quiet-mesa');
    // Nothing renamed on either side, and the registry is untouched.
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('renamed-by-hand');
    expect(branches('feat/real-name')).toBe('');
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

  // The token must be an INLINE literal in ccd, not a helper argument:
  // `server/test/wsaudit.test.ts` harvests `/"refused":"([a-zA-Z0-9-]+)"/` out
  // of this file's source and asserts set equality in BOTH directions against
  // `wsaudit.ts`'s SENTENCES. `held` already HAS a sentence (cmd_ws_reap emits
  // it), so nothing new is owed there — but a helper-ised emission would
  // contribute no token at all and the reverse direction would go red for a
  // reason whose author would never guess it.
  it('emits the held token as an inline literal inside cmd_ws_rename', () => {
    const src = fs.readFileSync(CCD, 'utf8');
    const from = src.indexOf('cmd_ws_rename() {');
    const to = src.indexOf('\ncmd_', from + 1);
    const body = src.slice(from, to === -1 ? undefined : to);
    expect(body).toContain('"refused":"held"');
  });
});
