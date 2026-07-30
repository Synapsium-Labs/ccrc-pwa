import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { WS_ADD } from './ccdWsHelpers.js';
import { CFG_DIR, GH_STUB, makePrHarness, mergedRow, type PrHarness } from './ccdPrHelpers.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-ccd-audit-'); });
afterEach(() => { h.cleanup(); });

const ARCH = `_ws_unsupervise() { :; }; _ws_supervise() { :; }; _spawn() { :; };
  tmux() { return 1; }; _alive() { return 1; };`;

interface Built { main: string; wt: string; tip: string; merge: string }

/**
 * A GENUINE SQUASH MERGE WITH A MOVED BASE — the case the whole ladder exists
 * for, and the first thing the definition of done names. main gains an
 * unrelated commit after the branch is cut, then the branch's three commits
 * land on main as one squashed commit. `ancestor` says no; `tree` says no
 * (the base moved); `patch-id` is what passes.
 *
 * `makeGhRepo` is mandatory here: Phase C refuses `no-remote` before the
 * ladder is ever reached against `makeRepo`'s local-path origin, and its
 * `insteadOf` rewrite is what keeps `_ws_reap_eval`'s mandatory
 * `git fetch origin` off the network.
 *
 * `ignore` writes a `.gitignore` INTO THE MERGED WORK — into the branch's
 * commits and into main's squash of them, so both sides carry it and the
 * patch-ids still match. It is a parameter rather than three lines in each
 * caller because the obvious alternative is wrong in a way that hides itself:
 * committing `.gitignore` to the branch AFTER the squash landed adds a commit
 * that is genuinely not in the merge, so the ladder refuses `tree-differs`
 * before any question about ignored content is reached. Measured: the
 * `LISTS non-sensitive ignored content` case failed outright that way, and
 * `changes the token when ANY fingerprinted fact moves` PASSED — vacuously,
 * comparing a 64-hex token against the `undefined` a refusal hands out.
 */
function squashMovedBase(ignore: string[] = []): Built {
  const main = h.makeGhRepo('demo');
  h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
  const wt = path.join(h.home, 'worktrees', 'demo', 'quiet-basin');
  for (const n of ['1', '2', '3']) {
    fs.writeFileSync(path.join(wt, `f${n}.txt`), `work ${n}\n`);
    h.git(wt, 'add', `f${n}.txt`);
    h.git(wt, 'commit', '-m', `work ${n}`);
  }
  if (ignore.length) {
    fs.writeFileSync(path.join(wt, '.gitignore'), `${ignore.join('\n')}\n`);
    h.git(wt, 'add', '.gitignore');
    h.git(wt, 'commit', '-m', 'ignore');
  }
  const tip = h.git(wt, 'rev-parse', 'HEAD');
  // main moves underneath, THEN the squash lands on top of that.
  fs.writeFileSync(path.join(main, 'other.txt'), 'someone else\n');
  h.git(main, 'add', 'other.txt');
  h.git(main, 'commit', '-m', 'unrelated');
  for (const n of ['1', '2', '3']) fs.writeFileSync(path.join(main, `f${n}.txt`), `work ${n}\n`);
  if (ignore.length) fs.writeFileSync(path.join(main, '.gitignore'), `${ignore.join('\n')}\n`);
  h.git(main, 'add', '-A');
  h.git(main, 'commit', '-m', 'squash of the work (#42)');
  const merge = h.git(main, 'rev-parse', 'HEAD');
  h.git(main, 'push', 'origin', 'main');
  h.git(wt, 'push', '-u', 'origin', 'ws/quiet-basin');
  h.ghRows([mergedRow({ headRefOid: tip, mergeCommit: { oid: merge } })]);
  h.sh(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
  return { main, wt, tip, merge };
}

/**
 * A REBASE MERGE — the fourth rung, and the one no other fixture reaches.
 * main gains an unrelated commit, then the branch's three commits are REPLAYED
 * onto it (`cherry-pick`, i.e. exactly what "Rebase and merge" does) and main
 * ends on the replayed copies. `ancestor` says no (our shas were rewritten);
 * `tree` says no (main carries `other.txt`, our tip does not); `patch-id` says
 * no (`M^1..M` is one commit's worth of diff against our three); `cherry` is
 * what passes, because every one of our commits has a patch-id equivalent in
 * `M`'s history.
 */
function rebaseMerged(): Built {
  const main = h.makeGhRepo('demo');
  h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
  const wt = path.join(h.home, 'worktrees', 'demo', 'quiet-basin');
  for (const n of ['1', '2', '3']) {
    fs.writeFileSync(path.join(wt, `f${n}.txt`), `work ${n}\n`);
    h.git(wt, 'add', `f${n}.txt`); h.git(wt, 'commit', '-m', `work ${n}`);
  }
  const tip = h.git(wt, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(main, 'other.txt'), 'someone else\n');
  h.git(main, 'add', 'other.txt'); h.git(main, 'commit', '-m', 'unrelated');
  // The replay. Same patches, new shas, on a base our tip does not descend
  // from — which is precisely when `cherry` is the only rung left.
  h.git(main, 'cherry-pick', `${tip}~2`, `${tip}~1`, tip);
  const merge = h.git(main, 'rev-parse', 'HEAD');
  h.git(main, 'push', 'origin', 'main');
  h.git(wt, 'push', '-u', 'origin', 'ws/quiet-basin');
  h.ghRows([mergedRow({ headRefOid: tip, mergeCommit: { oid: merge } })]);
  h.sh(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
  return { main, wt, tip, merge };
}

/** `pre` is sourced BEFORE the verb, which is the only way to fail one specific
 *  git read: every stub in this file shadows a function or a command rather than
 *  patching ccd. */
const audit = (pre = ''): Record<string, any> =>
  JSON.parse(h.sh(`${GH_STUB} ${ARCH} ${pre} cmd_ws_audit --session demo-quiet-basin`));

/**
 * Read EVERY refusal through this. `ws-audit` is read-only, so a verdict that
 * is not `reapable` must leave the worktree on disk — the definition of done
 * names that explicitly ("every negative case asserts the worktree still
 * exists afterwards") and a checklist item is not an executable assertion.
 * It also asserts `token` is absent, because a refusal that still handed out a
 * token would let the very next reap through.
 *
 * The two identity cases that delete the worktree THEMSELVES
 * (`worktree-missing` and the breadcrumb case) call `audit()` directly and say
 * so inline; everything else goes through here.
 */
const refusal = (wt: string, pre = ''): Record<string, any> => {
  const a = audit(pre);
  expect(a.verdict, `expected a refusal, got ${a.verdict}`).not.toBe('reapable');
  expect(a.token, 'a refusal must not hand out a reap token').toBeUndefined();
  expect(fs.existsSync(wt), 'a read-only audit must never remove the worktree').toBe(true);
  return a;
};

describe('the proof ladder', () => {
  it('proves a MULTI-COMMIT SQUASH WITH A MOVED BASE via patch-id', () => {
    // Tree-equality alone holds only when the base did not move between
    // branch point and merge. On a busy repo that is the minority case, and a
    // tree-only design false-refuses almost every real squash — which is
    // exactly what pushes people onto a one-tap unguarded delete.
    squashMovedBase();
    const a = audit();
    expect(a.verdict).toBe('reapable');
    expect(a.merge.proof).toBe('patch-id');
    expect(a.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('proves a squash whose base did NOT move via tree equality', () => {
    const main = h.makeGhRepo('demo');
    h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
    const wt = path.join(h.home, 'worktrees', 'demo', 'quiet-basin');
    fs.writeFileSync(path.join(wt, 'f.txt'), 'work\n');
    h.git(wt, 'add', 'f.txt'); h.git(wt, 'commit', '-m', 'work');
    const tip = h.git(wt, 'rev-parse', 'HEAD');
    fs.writeFileSync(path.join(main, 'f.txt'), 'work\n');
    h.git(main, 'add', '-A'); h.git(main, 'commit', '-m', 'squash');
    const merge = h.git(main, 'rev-parse', 'HEAD');
    h.git(main, 'push', 'origin', 'main'); h.git(wt, 'push', '-u', 'origin', 'ws/quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip, mergeCommit: { oid: merge } })]);
    h.sh(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
    expect(audit().merge.proof).toBe('tree');
  });

  it('proves a TRUE merge via ancestor', () => {
    const main = h.makeGhRepo('demo');
    h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
    const wt = path.join(h.home, 'worktrees', 'demo', 'quiet-basin');
    fs.writeFileSync(path.join(wt, 'f.txt'), 'work\n');
    h.git(wt, 'add', 'f.txt'); h.git(wt, 'commit', '-m', 'work');
    const tip = h.git(wt, 'rev-parse', 'HEAD');
    h.git(main, 'merge', '--no-ff', '-m', 'Merge PR #42', 'ws/quiet-basin');
    const merge = h.git(main, 'rev-parse', 'HEAD');
    h.git(main, 'push', 'origin', 'main'); h.git(wt, 'push', '-u', 'origin', 'ws/quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip, mergeCommit: { oid: merge } })]);
    h.sh(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
    expect(audit().merge.proof).toBe('ancestor');
  });

  it('proves a REBASE MERGE via cherry — the rung nothing else reaches', () => {
    // The fourth rung, and the DoD names it. Every earlier rung must fail
    // here: our shas were rewritten (not an ancestor), main carries
    // `other.txt` that our tip does not (tree differs), and `M^1..M` is one
    // replayed commit against our three (patch-ids differ). If this comes back
    // `ancestor`, the fixture fast-forwarded instead of replaying — read the
    // fixture, do not relax the assertion.
    rebaseMerged();
    const a = audit();
    expect(a.verdict).toBe('reapable');
    expect(a.merge.proof).toBe('cherry');
    expect(a.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('REFUSES the control case: squash plus one genuinely unmerged commit', () => {
    // The entire point. All four rungs must reject this, and the sheet must
    // say so rather than offer an override, because there is none.
    const { wt } = squashMovedBase();
    fs.writeFileSync(path.join(wt, 'later.txt'), 'not in the merge\n');
    h.git(wt, 'add', 'later.txt');
    h.git(wt, 'commit', '-m', 'a real follow-up');
    h.git(wt, 'push', 'origin', 'ws/quiet-basin');
    const a = refusal(wt);
    expect(a.verdict).toBe('tree-differs');
    expect(a.detail).toContain('later.txt');
  });

  it('never uses the fail-open `git diff --quiet -- A B` form', () => {
    // Verified in this worktree: `-- A B` exits 0 for ANY two shas (the
    // revisions become pathspecs) while `A B --` exits 1 correctly. A grep is
    // the only assertion that catches the wrong form being reintroduced.
    const src = fs.readFileSync(path.resolve(__dirname, '../../../ccrc-portability/ccd'), 'utf8');
    expect(src).not.toMatch(/diff --quiet\s+--\s+"/);
    expect(src).toContain('diff --quiet "$M" "$tip" --');
  });
});

describe('binding refusals', () => {
  it('refuses when the PR head is not reachable from our tip', () => {
    const { wt } = squashMovedBase();
    h.ghRows([mergedRow({ headRefOid: '0'.repeat(40), mergeCommit: { oid: 'aaaaaaa' } })]);
    expect(refusal(wt).verdict).toBe('pr-head-not-ours');
  });

  it('refuses a fork PR outright', () => {
    const { wt, tip, merge } = squashMovedBase();
    h.ghRows([mergedRow({ headRefOid: tip, mergeCommit: { oid: merge }, isCrossRepository: true })]);
    expect(refusal(wt).verdict).toBe('no-bound-pr');
  });

  it('refuses when the fetch fails — never a claim about the user commits', () => {
    // The bare repo is the FETCH target too, because makeGhRepo's insteadOf
    // rewrites https://github.com/o/r back to it. Deleting it fails the fetch
    // locally and instantly — no network, and no chance of passing because
    // some unrelated remote 404'd.
    const { wt } = squashMovedBase();
    fs.rmSync(path.join(h.home, 'origins', 'demo.git'), { recursive: true, force: true });
    expect(refusal(wt).verdict).toBe('fetch-failed');
  });
});

describe('local-loss refusals', () => {
  // The `ignore` column goes into the MERGED work, so each row's ONLY reason to
  // refuse is the mutation it makes. `.gitignore` committed after the merge
  // would refuse `tree-differs` first and these rows would pass without ever
  // reaching the guard they name.
  const cases: [string, string[], (wt: string) => void, string][] = [
    ['dirty-tree', [], (wt) => fs.writeFileSync(path.join(wt, 'f1.txt'), 'edited\n'), 'dirty-tree'],
    ['untracked', [], (wt) => fs.writeFileSync(path.join(wt, 'new.txt'), 'new\n'), 'dirty-tree'],
    ['sensitive ignored', ['.env'],
      (wt) => fs.writeFileSync(path.join(wt, '.env'), 'SECRET_API_KEY=1\n'), 'sensitive-ignored'],
  ];

  it.each(cases)('refuses on %s', (_name, ignore, mutate, verdict) => {
    const { wt } = squashMovedBase(ignore);
    mutate(wt);
    // `refusal` carries the worktree-still-exists assertion for every negative
    // case in this file, not just this block.
    expect(refusal(wt).verdict).toBe(verdict);
  });

  it('refuses a tree it could not READ, rather than counting it clean', () => {
    // The two Phase B reads carry the same failure and the same forgery. A
    // `status --porcelain | grep -c .` counts ZERO lines for a worktree nobody
    // could read, and a failed ignored-set read leaves REAP_SENSITIVE empty, so
    // BOTH guards §5.3 forbids overriding pass on a read that never happened.
    // Only `--ignored=matching` is failed here, so `dirty-tree` is not what
    // catches it; a second case fails `status --porcelain` instead. Measured with
    // the plan's own earlier text: both sides recorded ignoredDigest='' and the
    // fingerprints matched, which is the token that authorises the delete.
    const { wt } = squashMovedBase();
    const NOIGN = `git() { [[ "$*" == *"--ignored=matching"* ]] && return 128; command git "$@"; };`;
    expect(refusal(wt, NOIGN).verdict).toBe('tree-unreadable');
    // The pattern ENDS at `status --porcelain`, so it fails the tree read and
    // neither `worktree list --porcelain` nor `--ignored=matching` (same form the
    // Task 2 test uses).
    const NOSTAT = `git() { [[ "$*" == *"status --porcelain" ]] && return 128; command git "$@"; };`;
    expect(refusal(wt, NOSTAT).verdict).toBe('tree-unreadable');
  });

  it('names the sensitive paths so they can be moved, and offers no override', () => {
    const { wt } = squashMovedBase(['.env', 'id_rsa']);
    fs.writeFileSync(path.join(wt, '.env'), 'SECRET=1\n');
    fs.writeFileSync(path.join(wt, 'id_rsa'), 'k\n');
    const a = refusal(wt);
    expect(a.verdict).toBe('sensitive-ignored');
    expect(a.sensitive).toEqual(expect.arrayContaining(['.env', 'id_rsa']));
    expect(a.detail).toContain('.env');
  });

  it('LISTS non-sensitive ignored content with sizes instead of refusing on it', () => {
    // node_modules/, dist/ and .ccrc/ are named, sized and destroyed on
    // confirm. Refusing on all ignored content would make the gate unpassable
    // within minutes of ws-add and push the escape hatch into a config file.
    const { wt } = squashMovedBase(['node_modules/']);
    fs.mkdirSync(path.join(wt, 'node_modules', 'x'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'node_modules', 'x', 'big'), 'x'.repeat(4096));
    const a = audit();
    expect(a.verdict).toBe('reapable');
    expect(a.ignored.map((e: { path: string }) => e.path)).toContain('node_modules/');
    expect(a.ignoredCount).toBeGreaterThan(0);
    expect(a.ignoredBytes).toBeGreaterThan(4000);
  });

  it('refuses stashes and unpushed commits', () => {
    const { wt } = squashMovedBase();
    fs.writeFileSync(path.join(wt, 'f1.txt'), 'wip\n');
    h.sh(`cd "${wt}" && git stash push -q -m wip`);
    expect(refusal(wt).verdict).toBe('stashes-present');
    h.sh(`cd "${wt}" && git stash drop -q`);
    fs.writeFileSync(path.join(wt, 'z.txt'), 'unpushed\n');
    h.git(wt, 'add', 'z.txt'); h.git(wt, 'commit', '-m', 'unpushed');
    expect(refusal(wt).verdict).toBe('unpushed-commits');
  });
});

describe('identity refusals', () => {
  it('refuses a workspace that was never archived — archive IS the staging', () => {
    h.makeGhRepo('demo');
    h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
    h.ghRows([]);
    expect(refusal(path.join(h.home, 'worktrees', 'demo', 'quiet-basin')).verdict).toBe('not-archived');
  });

  it('refuses a detached HEAD as GIT records it — empty name, exit 0', () => {
    // `_ws_wt_branch`'s middle rung. Verified against git 2.43 in a scratch
    // repo: after `git checkout --detach` inside a linked worktree,
    // `git -C "$main" worktree list --porcelain` prints a bare `detached` line
    // for that path — so $main can see this without asking the directory, and
    // the helper answers empty-with-exit-0, which is NOT the same as exit 1.
    // The next two tests are the other two rungs.
    const { wt } = squashMovedBase();
    h.sh(`cd "${wt}" && git checkout -q --detach`);
    expect(refusal(wt).verdict).toBe('detached-head');
  });

  it('refuses when git’s record and the registry name different branches, printing both', () => {
    // Verified against git 2.43: `git checkout -b feat/x` inside a linked
    // worktree rewrites `$GIT_DIR/worktrees/<slug>/HEAD`, so `worktree list
    // --porcelain` read from $main reports `branch refs/heads/feat/x`. The
    // divergence this refuses is therefore between two RECORDS — ccrc's
    // registry and git's registration — and both names go in the detail,
    // because the remedy is to reconcile them and neither one is guessable
    // from the other.
    const { wt, tip } = squashMovedBase();
    h.sh(`cd "${wt}" && git checkout -q -b feat/x`);
    const a = refusal(wt);
    expect(a.verdict).toBe('registry-branch-drift');
    expect(a.detail).toContain('ws/quiet-basin');
    expect(a.detail).toContain('feat/x');
    expect(tip).toMatch(/^[0-9a-f]{40}$/);
  });

  it('asks $main for the branch, so a stray git init cannot speak for us', () => {
    // THE case the unified read exists for, and it is written so it can fail:
    // with `rev-parse --abbrev-ref HEAD` inside the directory — the form the
    // spec's A6/A7 spell and an earlier draft of this plan used — this comes
    // back as a DRIFT refusal printing `attacker/main`, a stranger's branch
    // name, in our refusal, decided by a repository that is not $main. With
    // `_ws_wt_branch` the name cannot come from there at all, the drift rung
    // passes on $main's own record, and what refuses is the guard that is
    // actually about the directory.
    //
    // Measured on git 2.43: the stranger needs a COMMIT. On an unborn branch
    // `rev-parse --abbrev-ref HEAD` prints the literal `HEAD` and the fixture
    // would prove nothing about names. Also measured: $main's record for the
    // path stays and is NOT marked `prunable`, because the record's gitdir file
    // now points at the stranger's own `.git` — which is exactly why
    // `registered` cannot decide the foreign-worktree question by itself.
    const { wt, main } = squashMovedBase();
    fs.rmSync(wt, { recursive: true, force: true });
    fs.mkdirSync(wt, { recursive: true });
    h.git(wt, 'init', '-q', '-b', 'attacker/main');
    fs.writeFileSync(path.join(wt, 'theirs.txt'), 'not ours\n');
    h.git(wt, 'add', 'theirs.txt');
    h.git(wt, 'commit', '-m', 'stranger');
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', 'HEAD'),
      'the fixture must actually present a different branch name to the directory read',
    ).toBe('attacker/main');
    const a = refusal(wt);
    expect(a.verdict).toBe('foreign-worktree');
    expect(a.detail, 'no stranger’s branch name may appear in our refusal').not.toContain('attacker/');
    // $main's record still names OUR branch — which is the only reason the
    // drift rung passed, and is the whole claim of the unified read.
    expect(h.git(main, 'worktree', 'list', '--porcelain')).toContain('branch refs/heads/ws/quiet-basin');
  });

  it('refuses no-worktree-record when git’s registration was removed by hand', () => {
    // `_ws_wt_branch`'s exit-1 rung: $main holds no evidence at all about this
    // path. Measured on git 2.43: deleting `$main/.git/worktrees/<slug>` leaves
    // the directory and `refs/heads/ws/quiet-basin` both intact while every
    // read of the directory fails with `not a git repository` — so the OLD
    // `rev-parse` form answered nothing here and the refusal said
    // `detached-head` about a HEAD it never saw. "No record" and "detached" are
    // different states with different remedies and must not share a token.
    const { wt, main } = squashMovedBase();
    const admin = path.join(main, '.git', 'worktrees', 'quiet-basin');
    expect(fs.existsSync(admin),
      'git names the admin directory after the worktree basename — if that changed, fix the fixture',
    ).toBe(true);
    fs.rmSync(admin, { recursive: true, force: true });
    expect(refusal(wt).verdict).toBe('no-worktree-record');
    // Nothing was deleted for want of a record — the branch is still here, and
    // `refusal` already asserted the worktree is.
    expect(h.git(main, 'show-ref', '--verify', 'refs/heads/ws/quiet-basin')).toContain('ws/quiet-basin');
  });

  it('reports the breadcrumb explicitly rather than "0 files" when one exists', () => {
    // Retry after a killed reap used to certify an empty workspace as clean.
    // NOT read through `refusal`: this test removes the worktree ITSELF, so
    // asserting it still exists would assert the opposite of the fixture.
    const { wt } = squashMovedBase();
    h.sh('_reg_set demo-quiet-basin reaping worktree');
    fs.rmSync(wt, { recursive: true, force: true });
    const a = audit();
    expect(a.reaping).toBe('worktree');
    expect(a.exists).toBe(false);
    expect(a.token).toBeUndefined();
  });

  it('refuses worktree-missing when there is NO breadcrumb to explain it', () => {
    // Also not read through `refusal`, and for the same reason: the fixture
    // deleted the worktree on purpose.
    const { wt } = squashMovedBase();
    fs.rmSync(wt, { recursive: true, force: true });
    const a = audit();
    expect(a.verdict).toBe('worktree-missing');
    expect(a.token).toBeUndefined();
  });
});

describe('the manifest', () => {
  it('carries the transcript path, the stash count and the worktree size', () => {
    squashMovedBase();
    const a = audit();
    // `_cfg_dir` maps the wrapper `_ws_least_loaded` picked to its config dir
    // (claude -> ~/.claude, claude2 -> ~/.claude-personal, …), so the assertion
    // is derived, never hardcoded to `.claude`.
    expect(a.transcript).toContain(`${CFG_DIR[h.reg('demo-quiet-basin', 'wrapper')!]}/projects/`);
    expect(a.stashes).toBe(0);
    expect(a.worktreeBytes).toBeGreaterThan(0);
    expect(a.commitsAheadOfBase).toBe(3);
    expect(a.pr.number).toBe(42);
  });

  it('changes the token when ANY fingerprinted fact moves', () => {
    // BOTH halves, and the first one is what makes the second mean anything.
    // `ws-reap --expect <token>` re-proves against this string at the instant
    // of deletion, so a token that drifted on its own would refuse every honest
    // confirmation, and a token that did not move would authorise a delete over
    // facts the human was never shown. `.gitignore` is part of the MERGED work
    // here (see `squashMovedBase`): committing it afterwards turns the verdict
    // into `tree-differs`, and comparing `undefined` against a hex string is a
    // green test that pins nothing — which is exactly what this test did.
    const { wt } = squashMovedBase(['dist/']);
    const first = audit().token;
    expect(first, 'the fixture must be reapable or there is no token to compare').toMatch(/^[0-9a-f]{64}$/);
    expect(audit().token, 'same world, same token — determinism first').toBe(first);
    // One fingerprinted fact moves and NOTHING else: `dist/` is ignored, so the
    // tree stays clean, the branch stays level with the remote and the proof
    // stays `patch-id`. `ignoredDigest` is the only input that can differ.
    fs.mkdirSync(path.join(wt, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'dist', 'a'), 'a');
    const second = audit();
    expect(second.verdict, 'ignored content is listed, never a refusal').toBe('reapable');
    expect(second.token).toMatch(/^[0-9a-f]{64}$/);
    expect(second.token).not.toBe(first);
  });
});
