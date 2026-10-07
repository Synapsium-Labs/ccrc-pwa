// Child reclamation, wave 6, Task 8 (spec §5.5): the gone-branch pin.
//
// Whether the child's registry branch exists is read THREE ways, by `git
// show-ref --exists`: 0 present, 2 absent, anything else unmeasured. Measured
// on git 2.43.0: `rev-parse --verify --quiet` and `show-ref --verify --quiet`
// both answer 1 for an absent ref, a corrupt loose ref and a ref under an
// unreadable directory, so neither proves absence. Every arm takes the read in
// one act: the ladder's tip reads (the present arm and the vanished arm), the
// pin, the vanished arm's pin and the tail's step 5. A branch PROVEN absent
// pins HEAD, the WIP commit and every per-worktree ref and reflog commit,
// deletes no branch, and the reclaim proceeds; a read that did not run stops
// wherever it is asked.
//
// FIXTURE HOME ONLY (`makePrHarness`): the unit and pane calls are RECORDED
// (`CHILD_STUBS`, inside the fixture helpers), never made, and every ref this
// file breaks is the fixture repository's. A new file, not an addition to the
// verb suites (the 600 s foreground ceiling).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { eventsOf } from './lifecycleHelpers.js';
import { CHILD_BRANCH, CHILD_ID, childReclaimVerb, evalOf, makeChild, type Child } from './childReclaimFixture.js';
import { verbHelpers } from './childReclaimVerbHelpers.js';
import { parseChildReclaimResult } from '../src/coord/childReclaim.js';
import { CHILD_RECLAIM_PRE_LOCK_TOKEN, childReclaimFailureLine } from '../src/childReclaimSweep.js';

let h: PrHarness;
let locked: string[] = [];
beforeEach(() => { h = makePrHarness('ccrc-child-reclaim-gone-branch-'); });
afterEach(() => {
  // Before the cleanup: `rm` cannot list a mode-000 directory.
  for (const d of locked) fs.chmodSync(d, 0o755);
  locked = [];
  h.cleanup();
});
const { tombOf, atticShas, unsupervised, refusedWith, interrupted, resumeToken, failedPairAgrees } = verbHelpers(() => h);

/** Root reads a mode-000 directory, so the unreadable cases cannot be built as root. */
const ROOT = process.getuid?.() === 0;
const ATTIC_REFLOGS = `refs/ccrc/attic/${CHILD_ID}/reflogs`;
/** `_WS_BRANCH_WHY`, the ladder's and the pins' one detail for a read that did not run. */
const READ_FAILED = new RegExp(`whether refs/heads/${CHILD_BRANCH} exists in .+ could not be read`);
type Broken = 'corrupt' | 'unreadable';
const BROKEN: readonly Broken[] = ['corrupt', 'unreadable'];

/** The child's branch as git stores it: a LOOSE ref in the fixture repository. */
const refFile = (c: Child): string => path.join(c.main, '.git', 'refs', 'heads', ...CHILD_BRANCH.split('/'));

/** A branch that EXISTS but cannot be read: its loose ref overwritten with bytes
 *  that are not a sha, or the directory that holds it made mode 000. */
function breakRef(c: Child, how: Broken): void {
  expect(fs.existsSync(refFile(c)), 'the CONTROL: the branch is a loose ref').toBe(true);
  if (how === 'corrupt') { fs.writeFileSync(refFile(c), 'not a sha\n'); return; }
  const d = path.dirname(refFile(c));
  fs.chmodSync(d, 0o000);
  locked.push(d);
}

/** The broken ref is exactly as `breakRef` left it — nothing deleted or rewrote it.
 *  Restores an unreadable directory's mode first, so assertions after it can read refs. */
function refUntouched(c: Child, how: Broken, sha: string): void {
  if (how === 'unreadable') {
    const d = path.dirname(refFile(c));
    fs.chmodSync(d, 0o755);
    locked = locked.filter((x) => x !== d);
    expect(fs.readFileSync(refFile(c), 'utf8').trim(), 'the unreadable branch still names its commit').toBe(sha);
  } else {
    expect(fs.readFileSync(refFile(c), 'utf8'), 'the corrupt ref was left exactly as it was').toBe('not a sha\n');
  }
}

/** `show-ref --exists`'s own answer, through the plain binary (never ccd). */
const existsRc = (repo: string, pre = ''): string =>
  h.sh(`${pre} git -C "${repo}" show-ref --exists "refs/heads/${CHILD_BRANCH}" >/dev/null 2>&1; printf '%s' "$?"`);

/** `_ws_reclaim_branch_state`'s answer and its rc, as `<answer>|<rc>`. */
const stateOf = (repo: string, pre = ''): string =>
  h.sh(`${pre} s=$(_ws_reclaim_branch_state "${repo}" ${CHILD_BRANCH}); printf '%s|%s' "$s" "$?"`);

const reaches = (repo: string, sha: string, ref: string): boolean => {
  try { h.git(repo, 'merge-base', '--is-ancestor', sha, ref); return true; } catch { return false; }
};

/** A child whose branch is PROVEN gone, its worktree standing: HEAD detached first
 *  (`git branch -D` refuses a checked-out branch), then the branch deleted — the live
 *  `expoAI-assistant-calm-mesa` shape (shape A). */
function goneBranch(c: Child): void {
  h.git(c.wt, 'checkout', '-q', '--detach');
  h.git(c.main, 'branch', '-q', '-D', CHILD_BRANCH);
  expect(existsRc(c.main), 'the CONTROL: git show-ref --exists answers absent').toBe('2');
}

/** The ladder's fingerprint INPUTS: `_ws_reclaim_fingerprint` redefined to write what
 *  it was handed into the fixture HOME, then hash exactly as the real one does. */
const FP_CAPTURE = `_ws_reclaim_fingerprint() { printf '%s\\n' "$@" > "$HOME/fp-inputs"; printf '%s\\n' "$@" | _plat_sha256 | cut -d' ' -f1; };`;
const fpInputs = (): string[] => fs.readFileSync(path.join(h.home, 'fp-inputs'), 'utf8').split('\n').filter(Boolean);

/** The FIRST `_ws_reclaim_branch_state` of a process answers for real; every later one
 *  answers `unmeasured`. Inside the verb the in-lock ladder reads first, so the pin
 *  that follows is the read that fails. The count lives in the fixture HOME, because
 *  every read runs in `$( … )`. */
const LATER_READS_UNMEASURED = [
  `eval "$(declare -f _ws_reclaim_branch_state | sed '1s/^_ws_reclaim_branch_state /_ws_real_branch_state /')";`,
  `_ws_reclaim_branch_state() { local n; n=$(cat "$HOME/bs-reads" 2>/dev/null || echo 0); echo $(( n + 1 )) > "$HOME/bs-reads";`,
  ` if (( n == 0 )); then _ws_real_branch_state "$@"; else printf 'unmeasured\\n'; fi; };`,
].join(' ');

/** A git older than 2.43, as far as ccd can tell: a `git` first on PATH whose
 *  `show-ref` rejects `--exists` the way git 2.42 does (exit 129), and which hands
 *  every other call to the real binary. */
function oldGit(): string {
  const real = h.sh('command -v git');
  const dir = path.join(h.home, 'oldgit');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'git'), [
    '#!/bin/sh',
    'case " $* " in *" show-ref "*"--exists "*) echo "error: unknown option exists" >&2; exit 129 ;; esac',
    `exec "${real}" "$@"`,
    '',
  ].join('\n'), { mode: 0o755 });
  return 'PATH="$HOME/oldgit:$PATH";';
}

/** `_ws_reclaim_branch_state` as it would read with NO symbolic-branch guard: `present` whenever rev-parse
 *  peels the name. The guard answers first at every real read, so only this stub lets the tail's step-5 CAS
 *  meet a symbolic branch, and so pins Task 3's `--no-deref` (defence in depth) on its own. */
const PRE_GUARD_READ = `_ws_reclaim_branch_state() { local s; s=$(git -C "$1" rev-parse --verify --quiet "refs/heads/$2^{commit}" 2>/dev/null) && printf 'present %s\\n' "$s" || printf 'unmeasured\\n'; };`;

describe('_ws_reclaim_branch_state reads three ways (spec §5.5)', () => {
  it('answers present <sha>, absent, and unmeasured outside a repository — rc 0 each time', () => {
    const c = makeChild(h);
    expect(stateOf(c.main)).toBe(`present ${c.tip}|0`);
    goneBranch(c);
    expect(stateOf(c.main)).toBe('absent|0');
    expect(stateOf(path.join(h.home, 'not-a-repository')), 'no repository is no proof of absence').toBe('unmeasured|0');
  }, 60_000);

  it('a CORRUPT loose ref is unmeasured, never absent', () => {
    const c = makeChild(h);
    h.git(c.wt, 'checkout', '-q', '--detach');
    breakRef(c, 'corrupt');
    expect(existsRc(c.main), 'the CONTROL: git answers neither 0 nor 2').toBe('1');
    expect(stateOf(c.main)).toBe('unmeasured|0');
  }, 60_000);

  it.skipIf(ROOT)('an UNREADABLE refs/heads directory is unmeasured, never absent', () => {
    const c = makeChild(h);
    h.git(c.wt, 'checkout', '-q', '--detach');
    breakRef(c, 'unreadable');
    expect(existsRc(c.main), 'the CONTROL: git answers neither 0 nor 2').toBe('1');
    expect(stateOf(c.main)).toBe('unmeasured|0');
  }, 60_000);

  it('a git that rejects --exists reads a standing branch present and a gone one unmeasured, never absent (the positive fallback)', () => {
    const c = makeChild(h);
    const pre = oldGit();
    expect(existsRc(c.main, pre), 'the CONTROL: the shim rejects the flag').toBe('129');
    expect(stateOf(c.main, pre), 'rev-parse peels the standing branch').toBe(`present ${c.tip}|0`);
    goneBranch(c);
    expect(existsRc(c.main, pre), 'the CONTROL: the shim still rejects the flag').toBe('129');
    expect(stateOf(c.main, pre), 'only --exists rc 2 ever proves absent').toBe('unmeasured|0');
  }, 60_000);

  it('reads the repository it is NAMED — an inherited GIT_DIR cannot answer for another', () => {
    const c = makeChild(h);
    const other = h.makeRepo('other');                 // a repository with no such branch
    const pre = `export GIT_DIR="${other}/.git";`;
    expect(existsRc(c.main, pre), 'the CONTROL: uncontained, git reads the inherited repository').toBe('2');
    expect(stateOf(c.main, pre)).toBe(`present ${c.tip}|0`);
  }, 60_000);

  it('a SYMBOLIC registry branch is unmeasured, never present: update-ref -d would delete the branch it names', () => {
    const c = makeChild(h);
    goneBranch(c);
    const absentToken = evalOf(h).token;
    expect(absentToken, 'the CONTROL: a proven absence mints a token').toMatch(/^[0-9a-f]{64}$/);
    const mainTip = h.git(c.main, 'rev-parse', 'refs/heads/main');
    h.git(c.main, 'symbolic-ref', `refs/heads/${CHILD_BRANCH}`, 'refs/heads/main');
    expect(existsRc(c.main), 'the CONTROL: git answers that the ref exists').toBe('0');
    expect(h.git(c.main, 'rev-parse', '--verify', '--quiet', `refs/heads/${CHILD_BRANCH}^{commit}`),
      'the CONTROL: rev-parse peels it to main’s commit').toBe(mainTip);
    expect(stateOf(c.main)).toBe('unmeasured|0');
    const a = evalOf(h);
    expect(a.verdict).toBe('unmeasured');
    expect(a.token, 'no token is minted over a symbolic branch').toBe('');
    expect(a.detail).toMatch(READ_FAILED);
    const r = childReclaimVerb(h, absentToken);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect((JSON.parse(r.stdout) as { failed: string }).failed).toBe('probe-unmeasured');
    expect(h.git(c.main, 'rev-parse', 'refs/heads/main'), 'main did not move').toBe(mainTip);
    expect(h.git(c.main, 'symbolic-ref', `refs/heads/${CHILD_BRANCH}`), 'the symbolic branch stands as it was').toBe('refs/heads/main');
    expect(fs.existsSync(c.wt), 'the tree stands').toBe(true);
    expect(h.reg(CHILD_ID, 'uuid'), 'the row stands').not.toBeNull();
    expect(h.reg(CHILD_ID, 'reaping'), 'no breadcrumb').toBeNull();
  }, 90_000);
});

describe('the ladder, present arm', () => {
  it('present arm: absence mints tip= and branchState=absent; a standing branch its sha and branchState=present', () => {
    const c = makeChild(h);
    h.git(c.wt, 'checkout', '-q', '--detach');
    const p = evalOf(h, { pre: FP_CAPTURE });
    expect(p.verdict, p.detail).toBe('reclaimable');
    expect(fpInputs()).toEqual(expect.arrayContaining(['worktree=present', `tip=${c.tip}`, 'branchState=present']));
    h.git(c.main, 'branch', '-q', '-D', CHILD_BRANCH);
    const a = evalOf(h, { pre: FP_CAPTURE });
    expect(a.verdict, a.detail).toBe('reclaimable');
    expect(fpInputs()).toEqual(expect.arrayContaining(['worktree=present', 'tip=', 'branchState=absent']));
    expect(fpInputs().filter((l) => l.startsWith('branchState=')), 'one branchState input, never two').toHaveLength(1);
  }, 60_000);

  for (const how of BROKEN) {
    it.skipIf(how === 'unreadable' && ROOT)(`present arm: a ${how} branch is unmeasured, and a token minted over its absence is never spent over it`, () => {
      const c = makeChild(h);
      goneBranch(c);
      const absentToken = evalOf(h).token;
      expect(absentToken, 'the CONTROL: a proven absence mints a token').toMatch(/^[0-9a-f]{64}$/);
      h.git(c.main, 'branch', CHILD_BRANCH, c.tip);    // the branch is back, and then cannot be read
      breakRef(c, how);
      const a = evalOf(h);
      expect(a.verdict).toBe('unmeasured');
      expect(a.token, 'no token is minted over a read that did not run').toBe('');
      expect(a.detail).toMatch(READ_FAILED);
      const r = childReclaimVerb(h, absentToken);
      expect(r.code, r.stdout + r.stderr).toBe(1);
      expect((JSON.parse(r.stdout) as { failed: string }).failed).toBe('probe-unmeasured');
      refUntouched(c, how, c.tip);
      expect(fs.existsSync(c.wt), 'the tree stands').toBe(true);
      expect(h.reg(CHILD_ID, 'uuid'), 'the row stands').not.toBeNull();
      expect(h.reg(CHILD_ID, 'reaping'), 'no breadcrumb').toBeNull();
      expect(unsupervised(), 'the unit was not touched').toEqual([]);
      expect(atticShas(c), 'nothing was pinned').toEqual([]);
    }, 90_000);
  }
});

describe('the ladder, vanished arm (spec §5.5)', () => {
  it('vanished arm: absence mints branchState=absent, and the verb reclaims from what is left', () => {
    const c = makeChild(h);
    goneBranch(c);
    fs.rmSync(c.wt, { recursive: true, force: true });
    expect(h.git(c.main, 'worktree', 'list', '--porcelain'), 'the CONTROL: git still records the tree, detached').toMatch(/^detached$/m);
    const a = evalOf(h, { pre: FP_CAPTURE });
    expect(a.verdict, a.detail).toBe('reclaimable');
    expect(fpInputs()).toEqual(expect.arrayContaining(['worktree=absent', 'tip=', 'branchState=absent']));
    const mainTip = h.git(c.main, 'rev-parse', 'refs/heads/main');
    const r = childReclaimVerb(h, a.token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(atticShas(c), 'the HEAD git’s record named is pinned').toContain(c.tip);
    expect(h.git(c.main, 'worktree', 'list', '--porcelain'), 'git’s stale record was cleared').not.toMatch(/^prunable /m);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'no branch was made or left').toBe('');
    expect(h.git(c.main, 'rev-parse', 'refs/heads/main'), 'no other branch moved').toBe(mainTip);
    expect(h.reg(CHILD_ID, 'uuid'), 'the row was purged').toBeNull();
    const tomb = tombOf();
    expect(tomb['worktree']).toBe('absent');
    expect(tomb['tip'], 'no tip: there was no branch to delete').toBe('');
    expect(eventsOf(h.home, 'reclaim').map((e) => e['outcome'])).toEqual(['intent', 'done']);
  }, 90_000);

  for (const how of BROKEN) {
    it.skipIf(how === 'unreadable' && ROOT)(`vanished arm: a ${how} branch is unmeasured, and the row is never purged over it`, () => {
      const c = makeChild(h);
      goneBranch(c);
      fs.rmSync(c.wt, { recursive: true, force: true });
      const absentToken = evalOf(h).token;
      expect(absentToken, 'the CONTROL: a proven absence mints a token').toMatch(/^[0-9a-f]{64}$/);
      h.git(c.main, 'branch', CHILD_BRANCH, c.tip);
      breakRef(c, how);
      const a = evalOf(h);
      expect(a.verdict).toBe('unmeasured');
      expect(a.detail).toMatch(READ_FAILED);
      const r = childReclaimVerb(h, absentToken);
      expect(r.code, r.stdout + r.stderr).toBe(1);
      expect((JSON.parse(r.stdout) as { failed: string }).failed).toBe('probe-unmeasured');
      refUntouched(c, how, c.tip);
      expect(h.git(c.main, 'worktree', 'list', '--porcelain'), 'git’s record of the vanished tree stands').toMatch(/^prunable /m);
      expect(h.reg(CHILD_ID, 'uuid'), 'the row stands').not.toBeNull();
      expect(h.reg(CHILD_ID, 'reaping'), 'no breadcrumb').toBeNull();
      expect(unsupervised(), 'the unit was not touched').toEqual([]);
    }, 90_000);
  }
});

describe('the pin and the tail', () => {
  it('the live expoAI-assistant-calm-mesa shape reclaims, HEAD and every reflog commit kept', () => {
    const c = makeChild(h);
    // The work landed on main: the live HEAD and every reflog commit are on origin/main.
    h.git(c.main, 'merge', '-q', '--ff-only', CHILD_BRANCH);
    h.git(c.main, 'push', '-q', 'origin', 'main');
    // A reset away and back leaves ORIG_HEAD in the worktree's own git directory, as the live one holds.
    h.git(c.wt, 'reset', '-q', '--hard', 'HEAD~1');
    h.git(c.wt, 'reset', '-q', '--hard', c.tip);
    const origHead = h.git(c.wt, 'rev-parse', 'ORIG_HEAD');
    goneBranch(c);
    const reflog = [...new Set(h.git(c.wt, 'reflog', 'show', '--format=%H', 'HEAD').split('\n').filter(Boolean))];
    // The CONTROLS: the live shape, measured.
    expect(h.git(c.wt, 'status', '--porcelain'), 'the tree is clean').toBe('');
    expect(reflog.length, 'the reflog names more than HEAD').toBeGreaterThan(1);
    for (const sha of [c.tip, origHead, ...reflog]) {
      expect(reaches(c.main, sha, 'refs/remotes/origin/main'), `${sha} is on origin/main`).toBe(true);
    }
    const mainTip = h.git(c.main, 'rev-parse', 'refs/heads/main');
    const a = evalOf(h);
    expect(a.verdict, a.detail).toBe('reclaimable');
    const r = childReclaimVerb(h, a.token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect((JSON.parse(r.stdout) as { reclaimed: string }).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(c.wt), 'the tree is gone').toBe(false);
    expect(atticShas(c), 'HEAD is pinned by sha').toContain(c.tip);
    for (const sha of new Set([origHead, ...reflog])) {
      expect(reaches(c.main, sha, ATTIC_REFLOGS), `${sha} is kept under ${ATTIC_REFLOGS}`).toBe(true);
    }
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'no branch was made').toBe('');
    expect(h.git(c.main, 'rev-parse', 'refs/heads/main'), 'main did not move').toBe(mainTip);
    expect(h.reg(CHILD_ID, 'uuid'), 'the row was purged').toBeNull();
    const tomb = tombOf();
    expect(tomb['worktree']).toBe('present');
    expect(tomb['tip'], 'no tip: there was no branch to delete').toBe('');
    expect(eventsOf(h.home, 'reclaim').map((e) => e['outcome'])).toEqual(['intent', 'done']);
  }, 90_000);

  it('a HEAD still symbolic to the gone branch stays pin-failed, nothing pinned', () => {
    const c = makeChild(h);
    fs.appendFileSync(path.join(c.wt, 'f1.txt'), 'uncommitted\n');
    // Shape B: `git branch -D` refuses a checked-out branch, but `update-ref -d` does not.
    h.git(c.main, 'update-ref', '-d', `refs/heads/${CHILD_BRANCH}`);
    expect(h.git(c.wt, 'symbolic-ref', 'HEAD'), 'the CONTROL: HEAD still names the branch').toBe(`refs/heads/${CHILD_BRANCH}`);
    expect(h.git(c.main, 'worktree', 'list', '--porcelain'), 'the CONTROL: git lists HEAD as zeros').toMatch(/^HEAD 0{40}$/m);
    const a = evalOf(h);
    // If this CONTROL is red, STOP and report: spec §5.5 rules this shape stays pin-failed; never change the ladder to meet it.
    expect(a.verdict, `the CONTROL: the ladder passes this shape (${a.detail})`).toBe('reclaimable');
    const r = childReclaimVerb(h, a.token);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('pin-failed');
    expect(o.detail).toMatch(new RegExp(`still has ${CHILD_BRANCH} checked out, but ${CHILD_BRANCH} is gone`));
    expect(fs.readFileSync(path.join(c.wt, 'f1.txt'), 'utf8'), 'the uncommitted work stands').toContain('uncommitted');
    expect(atticShas(c), 'nothing was pinned').toEqual([]);
    expect(h.reg(CHILD_ID, 'uuid'), 'the row stands').not.toBeNull();
    expect(h.reg(CHILD_ID, 'reaping'), 'no breadcrumb').toBeNull();
    expect(unsupervised(), 'the unit was not touched').toEqual([]);
  }, 90_000);

  it('a branch that reappears after the tombstone is kept: branch-moved', () => {
    const c = makeChild(h);
    goneBranch(c);
    interrupted(c, 'children');                      // pin and tombstone over the proven absence
    expect(tombOf()['tip'], 'the CONTROL: the record names no tip').toBe('');
    h.git(c.main, 'branch', CHILD_BRANCH, c.tip);    // re-created by someone else, after the record
    const r = childReclaimVerb(h, resumeToken('children'));
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect((JSON.parse(r.stdout) as { failed: string }).failed).toBe('branch-moved');
    expect(h.git(c.main, 'rev-parse', `refs/heads/${CHILD_BRANCH}`), 'the reappeared branch stands where it was made').toBe(c.tip);
    expect(tombOf()['tip'], 'the settle did not adopt its tip').toBe('');
    expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stops at the branch').toBe('reclaim:branch');
    expect(h.reg(CHILD_ID, 'uuid'), 'the row stands').not.toBeNull();
  }, 90_000);

  it('the settle reads the branch itself: a ref broken after the pin is pin-failed, the tree standing', () => {
    const c = makeChild(h);
    h.git(c.wt, 'checkout', '-q', '--detach');
    interrupted(c, 'children');
    expect(tombOf()['tip'], 'the CONTROL: the pin recorded the tip').toBe(c.tip);
    breakRef(c, 'corrupt');
    const r = childReclaimVerb(h, resumeToken('children'));
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('pin-failed');
    expect(o.detail).toMatch(READ_FAILED);
    refUntouched(c, 'corrupt', c.tip);
    expect(fs.existsSync(c.wt), 'the tree stands').toBe(true);
    expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb is where it was').toBe('reclaim:children');
  }, 90_000);

  it('step 5: a branch the tail cannot read stops it as branch-unmeasured, journaled failed, the row kept', () => {
    const c = makeChild(h);
    h.git(c.wt, 'checkout', '-q', '--detach');
    fs.mkdirSync(path.join(h.home, '.cc-clips', CHILD_ID), { recursive: true });
    fs.writeFileSync(path.join(h.home, '.cc-clips', CHILD_ID, 'shot.png'), 'png');
    interrupted(c, 'children');
    // The tail died after step (4): the tree and git's record of it are gone, and the breadcrumb says `branch`.
    h.git(c.main, 'worktree', 'remove', '--force', c.wt);
    h.sh(`_reg_set ${CHILD_ID} reaping reclaim:branch`);
    breakRef(c, 'corrupt');
    const r = childReclaimVerb(h, resumeToken('branch'));
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('branch-unmeasured');
    expect(o.detail).toMatch(new RegExp(`whether ${CHILD_BRANCH} exists in .+ could not be read`));
    // ONE failed line, never a refusal, carrying the document's own detail: a new failure word is classified where it is added.
    failedPairAgrees(r);
    const last = eventsOf(h.home, 'reclaim').pop()!;
    expect([last['outcome'], last['refusal'], last['verb']]).toEqual(['failed', 'branch-unmeasured', 'ws-reclaim']);
    expect(childReclaimFailureLine({ outcome: String(last['outcome']), refusal: String(last['refusal']) }),
      'wave 5’s reader counts it a failure').toBe(true);
    expect(Object.values(CHILD_RECLAIM_PRE_LOCK_TOKEN), 'a failed line needs no pre-lock entry').not.toContain('branch-unmeasured');
    // The tail's real state at step 5: the breadcrumb stands at the branch, so the retry resumes there.
    expect(parseChildReclaimResult(CHILD_ID, r.stdout, r.stderr))
      .toMatchObject({ kind: 'failed', resume: 'resumable', token: 'branch-unmeasured' });
    refUntouched(c, 'corrupt', c.tip);
    expect(h.reg(CHILD_ID, 'uuid'), 'the row stands').not.toBeNull();
    expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays at the branch').toBe('reclaim:branch');
    expect(fs.existsSync(path.join(h.home, '.cc-clips', CHILD_ID, 'shot.png')), 'the artifacts step never ran').toBe(true);
  }, 90_000);

  it('the tail deletes the registry branch itself, never the branch a symbolic one names (--no-deref)', () => {
    const c = makeChild(h);
    h.git(c.wt, 'checkout', '-q', '--detach');
    interrupted(c, 'children');
    expect(tombOf()['tip'], 'the CONTROL: the pin recorded the tip').toBe(c.tip);
    // The tail died after step (4), as in the step-5 case above.
    h.git(c.main, 'worktree', 'remove', '--force', c.wt);
    h.sh(`_reg_set ${CHILD_ID} reaping reclaim:branch`);
    // The registry branch becomes SYMBOLIC, naming another branch at the same commit.
    h.git(c.main, 'branch', 'ws/target', c.tip);
    h.git(c.main, 'symbolic-ref', `refs/heads/${CHILD_BRANCH}`, 'refs/heads/ws/target');
    expect(h.git(c.main, 'symbolic-ref', `refs/heads/${CHILD_BRANCH}`), 'the CONTROL: the registry branch is symbolic')
      .toBe('refs/heads/ws/target');
    // The real read answers `unmeasured` here (the case above), so the read is stubbed to its pre-guard self:
    // the CAS's own `--no-deref` is the only guard left.
    const r = childReclaimVerb(h, resumeToken('branch'), { pre: PRE_GUARD_READ });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect((JSON.parse(r.stdout) as { reclaimed: string }).reclaimed).toBe(CHILD_ID);
    expect(h.git(c.main, 'for-each-ref', '--format=%(objectname)', 'refs/heads/ws/target'),
      'the branch the symbolic one named stands').toBe(c.tip);
    expect(h.git(c.main, 'for-each-ref', '--format=%(refname)', `refs/heads/${CHILD_BRANCH}`),
      'the symbolic registry branch itself was deleted').toBe('');
  }, 90_000);

  it('the fresh pin reads the branch itself: unmeasured there is pin-failed', () => {
    const c = makeChild(h);
    h.git(c.wt, 'checkout', '-q', '--detach');
    const r = childReclaimVerb(h, evalOf(h).token, { pre: LATER_READS_UNMEASURED });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('pin-failed');
    expect(o.detail).toMatch(READ_FAILED);
    expect(fs.readFileSync(path.join(h.home, 'bs-reads'), 'utf8').trim(), 'the CONTROL: the ladder read, then the pin').toBe('2');
    expect(atticShas(c), 'nothing was pinned').toEqual([]);
    expect(fs.existsSync(c.wt), 'the tree stands').toBe(true);
    expect(h.git(c.main, 'rev-parse', `refs/heads/${CHILD_BRANCH}`), 'the branch stands').toBe(c.tip);
    expect(h.reg(CHILD_ID, 'reaping'), 'no breadcrumb').toBeNull();
  }, 90_000);

  it('the vanished arm’s pin reads it too: unmeasured there is pin-failed', () => {
    const c = makeChild(h);
    fs.rmSync(c.wt, { recursive: true, force: true });
    const r = childReclaimVerb(h, evalOf(h).token, { pre: LATER_READS_UNMEASURED });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('pin-failed');
    expect(o.detail).toMatch(READ_FAILED);
    expect(fs.readFileSync(path.join(h.home, 'bs-reads'), 'utf8').trim(), 'the CONTROL: the ladder read, then the pin').toBe('2');
    expect(h.git(c.main, 'rev-parse', `refs/heads/${CHILD_BRANCH}`), 'the branch stands').toBe(c.tip);
    expect(h.git(c.main, 'worktree', 'list', '--porcelain'), 'git’s record stands').toMatch(/^prunable /m);
    expect(h.reg(CHILD_ID, 'reaping'), 'no breadcrumb').toBeNull();
  }, 90_000);

  it('a git older than 2.43 fails closed: unmeasured audit, probe-unmeasured verb', () => {
    const c = makeChild(h);
    goneBranch(c);
    const token = evalOf(h).token;                   // minted by the real git, over the proven absence
    const pre = oldGit();
    const a = evalOf(h, { pre });
    expect(a.verdict).toBe('unmeasured');
    expect(a.detail).toMatch(READ_FAILED);
    const r = childReclaimVerb(h, token, { pre });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect((JSON.parse(r.stdout) as { failed: string }).failed).toBe('probe-unmeasured');
    expect(fs.existsSync(c.wt), 'the tree stands').toBe(true);
    expect(h.reg(CHILD_ID, 'uuid'), 'the row stands').not.toBeNull();
    expect(h.reg(CHILD_ID, 'reaping'), 'no breadcrumb').toBeNull();
    expect(unsupervised(), 'the unit was not touched').toEqual([]);
  }, 90_000);

  it('a git older than 2.43 reclaims a standing branch exactly as today (the positive fallback)', () => {
    const c = makeChild(h);
    const pre = oldGit();
    const a = evalOf(h, { pre });
    expect(a.verdict, a.detail).toBe('reclaimable');
    const r = childReclaimVerb(h, a.token, { pre });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect((JSON.parse(r.stdout) as { reclaimed: string }).reclaimed).toBe(CHILD_ID);
    expect(atticShas(c), 'the tip is pinned').toContain(c.tip);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the branch was deleted at its tip').toBe('');
    expect(h.reg(CHILD_ID, 'uuid'), 'the row was purged').toBeNull();
  }, 90_000);

  it('a token minted over absence is refused once the branch reappears: state-changed', () => {
    const c = makeChild(h);
    goneBranch(c);
    const token = evalOf(h).token;
    h.git(c.main, 'branch', CHILD_BRANCH, c.tip);
    expect(refusedWith(childReclaimVerb(h, token))).toBe('state-changed');
    expect(fs.existsSync(c.wt), 'the tree stands').toBe(true);
    expect(h.git(c.main, 'rev-parse', `refs/heads/${CHILD_BRANCH}`), 'the branch stands').toBe(c.tip);
  }, 90_000);
});
