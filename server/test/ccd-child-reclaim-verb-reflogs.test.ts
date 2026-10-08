// `ws-reclaim` — the destructive verb for a CHILD (spec 2026-09-22 §5.5-§5.6).
// Every case builds a real child in a fixture HOME and runs the sourced
// function with the unit and pane calls RECORDED, never made. What is asserted
// is what is left on disk and in git afterwards — never what the verb says.
//
// Split (task 1b, wave 4) so each file fits the 600s foreground ceiling; the
// shared fixtures live in `childReclaimVerbHelpers.ts`. This file (part 3 of
// 3, continuing `ccd-child-reclaim-verb.test.ts` and `-tail.test.ts`) is the
// child's own reflogs and every other thing its git directory names, kept
// before the acts that would delete them, plus the hidden-flag edit rules.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import {
  CHILD_BRANCH, CHILD_ID, CHILD_RUN, appendReflog, atticReach, childReclaimVerb, evalOf, gcNow,
  hasCommit, highCommit, looseCommits, makeChild, plantReflogNoise, type Child,
} from './childReclaimFixture.js';
import { verbHelpers } from './childReclaimVerbHelpers.js';
import { inheritedEnv } from './gitEnvStrip.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-child-reclaim-verb-'); });
afterEach(() => { h.cleanup(); });
const { reg, tombOf, unsupervised, intact, refusedWith, interrupted, resumeToken, failedPairAgrees, treeOf } = verbHelpers(() => h);

describe('the child’s own reflogs are kept, completely, before the acts that delete them (spec §5.5)', () => {
  // The tail deletes four kinds of reflog: the child's HEAD reflog (with its
  // worktree record), its branch's (with the branch), and each nested
  // checkout's and nested branch's. A commit only one of them names is kept
  // by `refs/ccrc/attic/<id>/reflogs`, and nothing ANOTHER session's reflog
  // names is. Asserted by reading git after the act — and after `git gc
  // --prune=now`, which leaves a commit only when a ref reaches it.
  const branchLog = (c: Child): string =>
    h.git(c.main, 'rev-parse', '--path-format=absolute', '--git-path', `logs/refs/heads/${CHILD_BRANCH}`);
  /** Moves `ref` to `id` and back, from the MAIN checkout — so only that
   *  ref's own reflog names `id` (main's HEAD is on `main`, not on it). */
  const movedAndBack = (c: Child, ref: string, id: string): void => {
    const was = h.git(c.main, 'rev-parse', ref);
    h.git(c.main, 'update-ref', '-m', 'moved away', ref, id);
    h.git(c.main, 'update-ref', '-m', 'moved back', ref, was);
  };
  /** After the act: kept by the attic, and still kept once gc has pruned
   *  everything no ref reaches — with the CONTROL that gc did prune. */
  const keptThroughGc = (c: Child, id: string): void => {
    expect(atticReach(h, c), `${id} is not kept by the attic`).toContain(id);
    const dangling = h.git(c.main, 'commit-tree', `${c.tip}^{tree}`, '-m', 'referenced by nothing');
    gcNow(h, c.main);
    expect(hasCommit(h, c.main, dangling), 'the CONTROL: gc pruned a commit no ref reaches').toBe(false);
    expect(hasCommit(h, c.main, id), `${id} did not survive git gc --prune=now`).toBe(true);
    expect(atticReach(h, c)).toContain(id);
  };
  const rankAmongAllReflogs = (dir: string, id: string): number =>
    [...new Set(h.git(dir, 'reflog', 'show', '--all', '--format=%H').split('\n'))].sort().indexOf(id);

  it('(1) the review’s shape: a commit only the child’s reflogs name, past 650 unrelated reflog entries, is kept and survives gc', () => {
    const c = makeChild(h);
    plantReflogNoise(h, c.main, 650);
    const lost = highCommit(h, c.wt, 'committed, then reset away');
    h.git(c.wt, 'reset', '-q', '--hard', lost);
    h.git(c.wt, 'reset', '-q', '--hard', c.tip);
    h.git(c.wt, 'reset', '-q', '--hard', 'HEAD');   // and moved on: ORIG_HEAD no longer names it
    // The CONTROLS: no branch and no operation head reaches it, and at least
    // 200 other reflog ids sort below it — a keep of the 200 lowest never
    // reached it.
    expect(h.git(c.main, 'branch', '--contains', lost)).toBe('');
    expect(h.git(c.wt, 'rev-parse', 'ORIG_HEAD')).toBe(c.tip);
    expect(rankAmongAllReflogs(c.wt, lost)).toBeGreaterThanOrEqual(200);
    const r = childReclaimVerb(h, evalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(fs.existsSync(c.wt), 'the worktree — and its HEAD reflog — went').toBe(false);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the branch — and its reflog — went').toBe('');
    keptThroughGc(c, lost);
  }, 120_000);

  it('keeps a commit only the child’s HEAD reflog names — a detached commit left behind', () => {
    const c = makeChild(h);
    h.git(c.wt, 'checkout', '-q', '--detach');
    fs.writeFileSync(path.join(c.wt, 'detached.txt'), 'left behind');
    h.git(c.wt, 'add', 'detached.txt'); h.git(c.wt, 'commit', '-q', '-m', 'detached, then left');
    const lost = h.git(c.wt, 'rev-parse', 'HEAD');
    h.git(c.wt, 'checkout', '-q', CHILD_BRANCH);
    expect(h.git(c.main, 'reflog', 'show', '--format=%H', `refs/heads/${CHILD_BRANCH}`), 'the CONTROL: no branch reflog').not.toContain(lost);
    const r = childReclaimVerb(h, evalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    keptThroughGc(c, lost);
  }, 120_000);

  it('keeps a commit only the child’s BRANCH reflog names — a branch moved and moved back', () => {
    const c = makeChild(h);
    const lost = h.git(c.main, 'commit-tree', `${c.tip}^{tree}`, '-p', c.tip, '-m', 'the branch stood here once');
    movedAndBack(c, `refs/heads/${CHILD_BRANCH}`, lost);
    expect(h.git(c.wt, 'reflog', 'show', '--format=%H', 'HEAD'), 'the CONTROL: the HEAD reflog does not name it').not.toContain(lost);
    const r = childReclaimVerb(h, evalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    keptThroughGc(c, lost);
  }, 120_000);

  it('(2) a mode-000 child BRANCH reflog fails pin-failed — the branch, the tree and the row untouched, no breadcrumb', () => {
    const c = makeChild(h);
    fs.writeFileSync(path.join(c.wt, 'notes.txt'), 'uncommitted work');
    const log = branchLog(c);
    expect(fs.statSync(log).isFile(), 'the CONTROL: the branch has a reflog').toBe(true);
    const tok = evalOf(h).token;
    const before = treeOf(c.wt);
    let r: { code: number; stdout: string; stderr: string };
    fs.chmodSync(log, 0o000);
    try { r = childReclaimVerb(h, tok); } finally { fs.chmodSync(log, 0o644); }
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('pin-failed');
    expect(o.detail).toContain(`the reflog ${log} cannot be read`);
    failedPairAgrees(r);
    intact(c);
    expect(treeOf(c.wt), 'the tree is byte-identical').toEqual(before);
    expect(h.git(c.main, 'rev-parse', `refs/heads/${CHILD_BRANCH}`), 'the branch did not move').toBe(c.tip);
    expect(h.reg(CHILD_ID, 'reaping'), 'no breadcrumb').toBeNull();
  }, 90_000);

  it('(2) the same reflog unreadable on a RESUME at the branch step stops the tail there — the branch stands, the breadcrumb stays — and it is no wedge', () => {
    const c = makeChild(h);
    interrupted(c, 'branch');
    h.git(c.main, 'worktree', 'remove', '--force', c.wt);
    const log = branchLog(c);
    let r: { code: number; stdout: string; stderr: string };
    fs.chmodSync(log, 0o000);
    try { r = childReclaimVerb(h, resumeToken('branch')); } finally { fs.chmodSync(log, 0o644); }
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('pin-failed');
    expect(o.detail).toContain(`the reflog ${log} cannot be read`);
    expect(o.detail).toContain(`${CHILD_BRANCH} stands, and nothing further was deleted`);
    expect(h.git(c.main, 'rev-parse', `refs/heads/${CHILD_BRANCH}`), 'the branch stands').toBe(c.tip);
    expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays').toBe('reclaim:branch');
    const again = childReclaimVerb(h, resumeToken('branch'));
    expect(again.code, again.stdout + again.stderr).toBe(0);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH)).toBe('');
  }, 90_000);

  it('(2) on the VANISHED arm too: a mode-000 branch reflog fails pin-failed before anything is touched — no breadcrumb, the unit untouched', () => {
    const c = makeChild(h);
    fs.rmSync(c.wt, { recursive: true, force: true });
    const log = branchLog(c);
    const tok = evalOf(h).token;
    let r: { code: number; stdout: string; stderr: string };
    fs.chmodSync(log, 0o000);
    try { r = childReclaimVerb(h, tok); } finally { fs.chmodSync(log, 0o644); }
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('pin-failed');
    expect(o.detail).toContain(`the reflog ${log} cannot be read`);
    expect(h.git(c.main, 'rev-parse', `refs/heads/${CHILD_BRANCH}`), 'the branch stands').toBe(c.tip);
    expect(h.git(c.main, 'worktree', 'list', '--porcelain'), 'git’s record of the tree stands').toMatch(/^prunable /m);
    expect(h.reg(CHILD_ID, 'reaping'), 'no breadcrumb').toBeNull();
    expect(unsupervised(), 'the unit was not touched').toEqual([]);
  }, 90_000);

  it('(3) a NESTED branch whose reflog alone holds a commit: the branch is deleted, the commit is kept and survives gc', () => {
    const c = makeChild(h);
    plantReflogNoise(h, c.main, 650);
    const inner = path.join(c.wt, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
    const lost = highCommit(h, inner, 'the nested branch stood here once');
    movedAndBack(c, 'refs/heads/ws/nested', lost);
    expect(h.git(inner, 'reflog', 'show', '--format=%H', 'HEAD'), 'the CONTROL: the nested HEAD reflog does not name it').not.toContain(lost);
    expect(rankAmongAllReflogs(c.wt, lost)).toBeGreaterThanOrEqual(200);
    const r = childReclaimVerb(h, evalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(fs.existsSync(inner), 'the nested checkout went').toBe(false);
    expect(h.git(c.main, 'branch', '--list', 'ws/nested'), 'the nested branch — and its reflog — went').toBe('');
    keptThroughGc(c, lost);
  }, 120_000);

  it('(4) the attic keeps NOTHING only another session’s reflogs name — its HEAD’s, its branch’s, or main’s', () => {
    const c = makeChild(h);
    const other = path.join(h.home, 'other');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/other', other);
    h.git(other, 'checkout', '-q', '--detach');
    fs.writeFileSync(path.join(other, 'o.txt'), 'another session’s');
    h.git(other, 'add', 'o.txt'); h.git(other, 'commit', '-q', '-m', 'another session, detached');
    const otherHead = h.git(other, 'rev-parse', 'HEAD');
    h.git(other, 'checkout', '-q', 'ws/other');
    const otherBranch = h.git(c.main, 'commit-tree', `${c.tip}^{tree}`, '-m', 'another session’s branch stood here');
    movedAndBack(c, 'refs/heads/ws/other', otherBranch);
    const mainLine = h.git(c.main, 'commit-tree', `${c.tip}^{tree}`, '-m', 'main stood here');
    movedAndBack(c, 'refs/heads/main', mainLine);
    const all = h.git(c.wt, 'reflog', 'show', '--all', '--format=%H');
    for (const id of [otherHead, otherBranch, mainLine]) expect(all, `the CONTROL: a reflog names ${id}`).toContain(id);
    const r = childReclaimVerb(h, evalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const kept = atticReach(h, c);
    expect(kept, 'the CONTROL: the attic keeps the child’s own tip').toContain(c.tip);
    for (const id of [otherHead, otherBranch, mainLine]) expect(kept, `${id} is another session’s`).not.toContain(id);
  }, 120_000);

  it('(5) the VANISHED arm keeps a commit only the branch’s reflog names', () => {
    const c = makeChild(h);
    const lost = h.git(c.main, 'commit-tree', `${c.tip}^{tree}`, '-p', c.tip, '-m', 'the branch stood here once');
    movedAndBack(c, `refs/heads/${CHILD_BRANCH}`, lost);
    fs.rmSync(c.wt, { recursive: true, force: true });
    const r = childReclaimVerb(h, evalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(tombOf()['worktree'], 'the CONTROL: the vanished arm ran').toBe('absent');
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH)).toBe('');
    keptThroughGc(c, lost);
  }, 120_000);

  it('(5) the VANISHED arm keeps a commit only the vanished tree’s HEAD reflog names — found through git’s `gitdir` record', () => {
    const c = makeChild(h);
    h.git(c.wt, 'checkout', '-q', '--detach');
    fs.writeFileSync(path.join(c.wt, 'detached.txt'), 'left behind');
    h.git(c.wt, 'add', 'detached.txt'); h.git(c.wt, 'commit', '-q', '-m', 'detached, then left');
    const lost = h.git(c.wt, 'rev-parse', 'HEAD');
    h.git(c.wt, 'checkout', '-q', CHILD_BRANCH);
    fs.rmSync(c.wt, { recursive: true, force: true });
    expect(h.git(c.main, 'worktree', 'list', '--porcelain'), 'the CONTROL: git still records the tree').toMatch(/^prunable /m);
    const r = childReclaimVerb(h, evalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(h.git(c.main, 'worktree', 'list', '--porcelain'), 'the record — and its HEAD reflog — went').not.toMatch(/^prunable /m);
    keptThroughGc(c, lost);
  }, 120_000);

  it('ORDER: an entry written after the pin, on a RESUME at the branch step, is kept before the CAS deletes the reflog', () => {
    // No settle runs on this arm: the only keep in front of the branch's
    // deletion is the tail's own, just before its CAS.
    const c = makeChild(h);
    interrupted(c, 'branch');
    h.git(c.main, 'worktree', 'remove', '--force', c.wt);
    const late = h.git(c.main, 'commit-tree', `${c.tip}^{tree}`, '-p', c.tip, '-m', 'moved after the pin, and back');
    movedAndBack(c, `refs/heads/${CHILD_BRANCH}`, late);
    expect(atticReach(h, c), 'the CONTROL: the pin phase ran before it existed').not.toContain(late);
    const r = childReclaimVerb(h, resumeToken('branch'));
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH)).toBe('');
    keptThroughGc(c, late);
  }, 120_000);

  // EACH OF THE TAIL'S KEEPS HAS A CASE OF ITS OWN: an entry written into the
  // one reflog that act deletes, AFTER every earlier keep, so only that keep
  // stands between the entry and its loss. Where a settle runs in the same
  // invocation (a standing tree), the entry is written from INSIDE the settle
  // — after its re-pin — through `_ws_reclaim_children_merge`, the device N1
  // uses; where none runs (a resume past it, a tree already gone), it is
  // written between the interrupted act and the resume.
  /** Runs `snippet` inside the settle, after its re-pin, then the real merge. */
  const afterSettle = (snippet: string): string =>
    `eval "$(declare -f _ws_reclaim_children_merge | sed '1s/_ws_reclaim_children_merge/_frd_orig_merge/')";`
    + ` _ws_reclaim_children_merge() { ${snippet} _frd_orig_merge "$@"; };`;
  /** Bash that appends an entry to `log` naming `id`, and one back to `cur`. */
  const lateEntry = (log: string, cur: string, id: string): string =>
    `printf '%s %s T <t@x> 1700000000 +0000\\tfixture: late\\n%s %s T <t@x> 1700000000 +0000\\tfixture: back\\n'`
    + ` ${cur} ${id} ${id} ${cur} >> "${log}";`;
  const headLog = (dir: string): string => h.git(dir, 'rev-parse', '--path-format=absolute', '--git-path', 'logs/HEAD');

  it('KEEP before a standing NESTED checkout’s removal: an entry its HEAD reflog gains after the settle is kept', () => {
    const c = makeChild(h);
    const inner = path.join(c.wt, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
    const [late] = looseCommits(h, c.main, 1, 'nested head late');
    const pre = afterSettle(lateEntry(headLog(inner), h.git(inner, 'rev-parse', 'HEAD'), late!));
    const r = childReclaimVerb(h, evalOf(h).token, { pre });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(fs.existsSync(inner), 'the nested checkout — and its HEAD reflog — went').toBe(false);
    keptThroughGc(c, late!);
  }, 120_000);

  it('KEEP before a GONE nested checkout’s record is cleared (resume at `children`, the tree gone): its HEAD reflog’s late entry is kept', () => {
    const c = makeChild(h);
    const inner = path.join(c.wt, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
    interrupted(c, 'children');
    const [late] = looseCommits(h, c.main, 1, 'gone nested head late');
    appendReflog(h, inner, 'HEAD', [late!]);
    fs.rmSync(c.wt, { recursive: true, force: true });
    expect(h.git(c.main, 'worktree', 'list', '--porcelain'), 'the CONTROL: git still records the nested checkout')
      .toContain(`worktree ${inner}\n`);
    const r = childReclaimVerb(h, resumeToken('children'));
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(h.git(c.main, 'worktree', 'list', '--porcelain'), 'the nested record went').not.toContain(`worktree ${inner}\n`);
    keptThroughGc(c, late!);
  }, 120_000);

  it('KEEP before a nested branch’s CAS (resume at `children`, the tree gone): its reflog’s late entry is kept', () => {
    const c = makeChild(h);
    const inner = path.join(c.wt, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
    interrupted(c, 'children');
    const [late] = looseCommits(h, c.main, 1, 'nested branch late');
    appendReflog(h, c.main, 'refs/heads/ws/nested', [late!]);
    fs.rmSync(c.wt, { recursive: true, force: true });
    const r = childReclaimVerb(h, resumeToken('children'));
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(h.git(c.main, 'branch', '--list', 'ws/nested'), 'the nested branch — and its reflog — went').toBe('');
    keptThroughGc(c, late!);
  }, 120_000);

  it('KEEP before step 4 removes the standing tree: an entry the child’s HEAD reflog gains after the settle is kept', () => {
    const c = makeChild(h);
    const [late] = looseCommits(h, c.main, 1, 'child head late');
    const pre = afterSettle(lateEntry(headLog(c.wt), c.tip, late!));
    const r = childReclaimVerb(h, evalOf(h).token, { pre });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(fs.existsSync(c.wt), 'the tree — and its HEAD reflog — went').toBe(false);
    keptThroughGc(c, late!);
  }, 120_000);

  it('KEEP before step 5 clears a VANISHED tree’s record (resume at `branch`, the record standing): a detached commit made after the pin is kept', () => {
    // The review's probe: no settle runs at `branch`, and the tree is gone, so
    // only the keep in front of `worktree remove` of the record reads its log.
    const c = makeChild(h);
    interrupted(c, 'branch');
    h.git(c.wt, 'checkout', '-q', '--detach');
    fs.writeFileSync(path.join(c.wt, 'late.txt'), 'after the pin');
    h.git(c.wt, 'add', 'late.txt'); h.git(c.wt, 'commit', '-q', '-m', 'detached, after the pin');
    const late = h.git(c.wt, 'rev-parse', 'HEAD');
    h.git(c.wt, 'checkout', '-q', CHILD_BRANCH);
    fs.rmSync(c.wt, { recursive: true, force: true });
    expect(h.git(c.main, 'worktree', 'list', '--porcelain'), 'the CONTROL: git still records the tree').toMatch(/^prunable /m);
    const r = childReclaimVerb(h, resumeToken('branch'));
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(h.git(c.main, 'worktree', 'list', '--porcelain'), 'the record — and its HEAD reflog — went').not.toMatch(/^prunable /m);
    keptThroughGc(c, late);
  }, 120_000);

  it('a record git HOLDS whose admin entry cannot be found is UNMEASURED — pin-failed, the record and the breadcrumb stand', () => {
    // git 2.43 prints a `gitdir` entry verbatim, so there `worktree list` and
    // the `gitdir` scan miss a respelled entry together. A git that writes
    // RELATIVE worktree paths (`worktree.useRelativePaths`, 2.48+; not on this
    // box) resolves one — so the record is found and the admin entry is not.
    // The entry is respelled relative, and the record read answers as that git.
    const c = makeChild(h);
    interrupted(c, 'branch');
    const admin = h.git(c.wt, 'rev-parse', '--path-format=absolute', '--git-dir');
    fs.rmSync(c.wt, { recursive: true, force: true });
    fs.writeFileSync(path.join(admin, 'gitdir'), `${path.relative(admin, path.join(c.wt, '.git'))}\n`);
    const pre = `eval "$(declare -f _ws_reclaim_record | sed '1s/_ws_reclaim_record/_frd_orig_record/')";`
      + ` _ws_reclaim_record() { _frd_orig_record "$@"; local rc=$?;`
      + ` if (( rc == 1 )) && [[ "$2" == "${c.wt}" ]]; then RECLAIM_REC_BRANCH=${CHILD_BRANCH}; RECLAIM_REC_HEAD=${c.tip};`
      + ` RECLAIM_REC_MAIN=0; return 0; fi; return $rc; };`;
    const tok = h.sh(`${pre} _ws_reclaim_resume_eval ${CHILD_ID} 0 ${CHILD_RUN} branch >/dev/null; printf '%s' "$REAP_TOKEN"`);
    const r = childReclaimVerb(h, tok, { pre });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('pin-failed');
    expect(o.detail).toContain(`git records a checkout at ${c.wt}, but no`);
    expect(o.detail).toContain(`git's record of ${c.wt} stands, and nothing further was deleted`);
    expect(fs.existsSync(path.join(admin, 'gitdir')), 'the record stands').toBe(true);
    expect(h.git(c.main, 'rev-parse', `refs/heads/${CHILD_BRANCH}`), 'the branch stands').toBe(c.tip);
    expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays').toBe('reclaim:branch');
  }, 90_000);

  it('the same for a GONE NESTED checkout’s record (resume at `children`) — pin-failed, its record, its branch and the breadcrumb stand', () => {
    // The nested gone-record keep passes `recorded` too; the same relative
    // respelling, with the nested record read answering as that git would.
    const c = makeChild(h);
    const inner = path.join(c.wt, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
    interrupted(c, 'children');
    const admin = h.git(inner, 'rev-parse', '--path-format=absolute', '--git-dir');
    fs.rmSync(c.wt, { recursive: true, force: true });
    fs.writeFileSync(path.join(admin, 'gitdir'), `${path.relative(admin, path.join(inner, '.git'))}\n`);
    const pre = `eval "$(declare -f _ws_reclaim_nested_record | sed '1s/_ws_reclaim_nested_record/_frd_orig_nrec/')";`
      + ` _ws_reclaim_nested_record() { _frd_orig_nrec "$@"; local rc=$?;`
      + ` if (( rc == 1 )) && [[ "$2" == "${inner}" ]]; then _WS_NREC_BRANCH=ws/nested; return 0; fi; return $rc; };`;
    const tok = h.sh(`${pre} _ws_reclaim_resume_eval ${CHILD_ID} 0 ${CHILD_RUN} children >/dev/null; printf '%s' "$REAP_TOKEN"`);
    const r = childReclaimVerb(h, tok, { pre });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('pin-failed');
    expect(o.detail).toContain(`git records a checkout at ${inner}, but no`);
    expect(o.detail).toContain(`git's record of ${inner} stands, and nothing further was deleted`);
    expect(fs.existsSync(path.join(admin, 'gitdir')), 'the nested record stands').toBe(true);
    expect(h.git(c.main, 'branch', '--list', 'ws/nested'), 'the nested branch stands').toContain('ws/nested');
    expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays').toBe('reclaim:children');
  }, 90_000);

  // THE CHILD'S OWN GIT DIRECTORY G (`<common>/worktrees/<name>`), which
  // `git worktree remove` deletes WHOLE, for the child and for each nested
  // same-repository checkout the tail removes: every commit its per-worktree
  // refs, its reflogs and its named files (the op heads, the autostash files)
  // name is kept first, read from the FILES. Each holder below is the ONLY
  // thing naming its commit — a loose commit no shared ref reaches — and
  // "kept" is read from git after `git gc --prune=now`. Under the DEFAULT
  // config git's own gc would already prune a commit only a per-worktree ref
  // names (measured, git 2.43), so no fixture runs gc before the reclaim.
  describe('and everything the child’s own git directory names, before `git worktree remove` deletes it (spec §5.5)', () => {
    const gitDir = (dir: string): string => h.git(dir, 'rev-parse', '--absolute-git-dir');
    const always = (c: Child): void => { h.git(c.main, 'config', 'core.logAllRefUpdates', 'always'); };
    /** The CONTROL every case asserts: no ref of the SHARED repository reaches it. */
    const inNoSharedRef = (c: Child, id: string): void => {
      expect(h.git(c.main, 'for-each-ref', '--contains', id), `the CONTROL: a shared ref reaches ${id}`).toBe('');
    };
    const reclaimed = (c: Child, r: { code: number; stdout: string; stderr: string }): void => {
      expect(r.code, r.stdout + r.stderr).toBe(0);
      expect(fs.existsSync(c.wt), 'the worktree — and its git directory — went').toBe(false);
    };
    /** A fail-closed answer: pin-failed, nothing destroyed. */
    const pinFailedIntact = (c: Child, r: { code: number; stdout: string; stderr: string }, before: string[] | 'gone', why: string): void => {
      expect(r.code, r.stdout + r.stderr).toBe(1);
      const o = JSON.parse(r.stdout) as { failed: string; detail: string };
      expect(o.failed).toBe('pin-failed');
      expect(o.detail).toContain(why);
      failedPairAgrees(r);
      intact(c);
      expect(treeOf(c.wt), 'the tree is byte-identical').toEqual(before);
      expect(h.git(c.main, 'rev-parse', `refs/heads/${CHILD_BRANCH}`), 'the branch did not move').toBe(c.tip);
      expect(h.reg(CHILD_ID, 'reaping'), 'no breadcrumb').toBeNull();
    };

    it.each([['the default config', false], ['core.logAllRefUpdates=always', true]] as const)(
      'keeps a commit only `refs/worktree/keep` names, under %s', (_what, logAll) => {
        const c = makeChild(h);
        if (logAll) always(c);
        const [x] = looseCommits(h, c.main, 1, 'worktree keep');
        h.git(c.wt, 'update-ref', 'refs/worktree/keep', x!);
        expect(fs.readFileSync(path.join(gitDir(c.wt), 'refs', 'worktree', 'keep'), 'utf8').trim(), 'the CONTROL: a file in G').toBe(x);
        inNoSharedRef(c, x!);
        reclaimed(c, childReclaimVerb(h, evalOf(h).token));
        keptThroughGc(c, x!);
      }, 120_000);

    it('keeps a commit only `refs/bisect/bad` names', () => {
      const c = makeChild(h);
      const [x] = looseCommits(h, c.main, 1, 'bisect bad');
      h.git(c.wt, 'update-ref', 'refs/bisect/bad', x!);
      inNoSharedRef(c, x!);
      reclaimed(c, childReclaimVerb(h, evalOf(h).token));
      keptThroughGc(c, x!);
    }, 120_000);

    it('keeps a commit only a per-worktree ref’s REFLOG names, after the ref moved on (`always`)', () => {
      const c = makeChild(h);
      always(c);
      const [x] = looseCommits(h, c.main, 1, 'per-worktree reflog');
      h.git(c.wt, 'update-ref', 'refs/worktree/keep', x!);
      h.git(c.wt, 'update-ref', 'refs/worktree/keep', c.tip);
      expect(fs.readFileSync(path.join(gitDir(c.wt), 'logs', 'refs', 'worktree', 'keep'), 'utf8'), 'the CONTROL: G’s reflog names it')
        .toContain(x);
      inNoSharedRef(c, x!);
      reclaimed(c, childReclaimVerb(h, evalOf(h).token));
      keptThroughGc(c, x!);
    }, 120_000);

    it('the same in a NESTED same-repository checkout the tail removes: its per-worktree ref’s reflog is kept', () => {
      const c = makeChild(h);
      always(c);
      const inner = path.join(c.wt, 'inner');
      h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
      const [x] = looseCommits(h, c.main, 1, 'nested per-worktree reflog');
      h.git(inner, 'update-ref', 'refs/worktree/keep', x!);
      h.git(inner, 'update-ref', 'refs/worktree/keep', h.git(inner, 'rev-parse', 'HEAD'));
      expect(fs.readFileSync(path.join(gitDir(inner), 'logs', 'refs', 'worktree', 'keep'), 'utf8')).toContain(x);
      inNoSharedRef(c, x!);
      reclaimed(c, childReclaimVerb(h, evalOf(h).token));
      expect(fs.existsSync(inner), 'the nested checkout — and its git directory — went').toBe(false);
      keptThroughGc(c, x!);
    }, 120_000);

    it('keeps a commit only `logs/ORIG_HEAD` names, as an entry’s OLD side (`always`)', () => {
      const c = makeChild(h);
      always(c);
      const [x] = looseCommits(h, c.main, 1, 'orig head log');
      h.git(c.wt, 'update-ref', 'ORIG_HEAD', x!);
      h.git(c.wt, 'update-ref', 'ORIG_HEAD', c.tip);
      // The entry that CREATED it at x goes, as an expiry leaves it: x is
      // left only as the value the next entry moved FROM.
      const log = path.join(gitDir(c.wt), 'logs', 'ORIG_HEAD');
      const lines = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
      fs.writeFileSync(log, `${lines.filter((l) => l.split(' ')[1] !== x).join('\n')}\n`);
      expect(fs.readFileSync(log, 'utf8'), 'the CONTROL: x is an old side there').toContain(`${x} ${c.tip} `);
      expect(h.git(c.wt, 'rev-parse', 'ORIG_HEAD'), 'the CONTROL: ORIG_HEAD itself names the tip').toBe(c.tip);
      inNoSharedRef(c, x!);
      reclaimed(c, childReclaimVerb(h, evalOf(h).token));
      keptThroughGc(c, x!);
    }, 120_000);

    it('keeps a commit only REVERT_HEAD names — a revert left mid-way, reclaimed with --defer-expired', () => {
      const c = makeChild(h);
      const [x] = looseCommits(h, c.main, 1, 'revert head');
      h.git(c.wt, 'update-ref', 'REVERT_HEAD', x!);
      inNoSharedRef(c, x!);
      const d = evalOf(h, { childOf: String(CHILD_RUN), defer: 1 });
      expect(d.verdict, d.detail).toBe('reclaimable');
      reclaimed(c, childReclaimVerb(h, d.token, { extra: '--defer-expired' }));
      keptThroughGc(c, x!);
    }, 120_000);

    it('keeps a commit only BISECT_HEAD names — a bisect in progress is no refusal', () => {
      const c = makeChild(h);
      const [x] = looseCommits(h, c.main, 1, 'bisect head');
      h.git(c.wt, 'update-ref', 'BISECT_HEAD', x!);
      inNoSharedRef(c, x!);
      reclaimed(c, childReclaimVerb(h, evalOf(h).token));
      keptThroughGc(c, x!);
    }, 120_000);

    it('keeps an AUTOSTASH — `pull --rebase` stopped on a conflict — and the uncommitted edit it holds is reachable from the attic', () => {
      const c = makeChild(h);
      fs.writeFileSync(path.join(c.main, 'f1.txt'), 'theirs\n');
      h.git(c.main, 'add', 'f1.txt'); h.git(c.main, 'commit', '-q', '-m', 'theirs');
      fs.appendFileSync(path.join(c.wt, 'README.md'), 'an uncommitted edit, set aside\n');
      const pull = h.run(`GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@x GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@x`
        + ` git -C "${c.wt}" -c rebase.autoStash=true pull -q --rebase . main`);
      expect(pull.code, 'the CONTROL: the rebase stopped on its conflict').not.toBe(0);
      const stash = fs.readFileSync(path.join(gitDir(c.wt), 'rebase-merge', 'autostash'), 'utf8').trim();
      expect(h.git(c.main, 'show', `${stash}:README.md`), 'the CONTROL: the autostash holds the edit').toContain('set aside');
      expect(fs.readFileSync(path.join(c.wt, 'README.md'), 'utf8'), 'the CONTROL: the tree does not').not.toContain('set aside');
      inNoSharedRef(c, stash);
      const d = evalOf(h, { childOf: String(CHILD_RUN), defer: 1 });
      expect(d.verdict, d.detail).toBe('reclaimable');
      reclaimed(c, childReclaimVerb(h, d.token, { extra: '--defer-expired' }));
      keptThroughGc(c, stash);
      expect(h.git(c.main, 'show', `${stash}:README.md`)).toContain('an uncommitted edit, set aside');
    }, 120_000);

    it('the VANISHED arm: a `refs/worktree/` ref and a `logs/ORIG_HEAD` left in the tree’s record are both kept before the record is cleared', () => {
      const c = makeChild(h);
      always(c);
      const [ref, orig] = looseCommits(h, c.main, 2, 'vanished holder');
      h.git(c.wt, 'update-ref', 'refs/worktree/keep', ref!);
      h.git(c.wt, 'update-ref', 'ORIG_HEAD', orig!);
      h.git(c.wt, 'update-ref', 'ORIG_HEAD', c.tip);
      const g = gitDir(c.wt);
      fs.rmSync(c.wt, { recursive: true, force: true });
      expect(fs.readFileSync(path.join(g, 'logs', 'ORIG_HEAD'), 'utf8'), 'the CONTROL: the record’s log names it').toContain(orig);
      for (const x of [ref!, orig!]) inNoSharedRef(c, x);
      const r = childReclaimVerb(h, evalOf(h).token);
      expect(r.code, r.stdout + r.stderr).toBe(0);
      expect(tombOf()['worktree'], 'the CONTROL: the vanished arm ran').toBe('absent');
      expect(fs.existsSync(g), 'the record — and all it held — went').toBe(false);
      for (const x of [ref!, orig!]) keptThroughGc(c, x);
    }, 120_000);

    it.each([
      ['a mode-000 per-worktree REF file — which `for-each-ref` passes at rc 0', 'refs/worktree/keep', false, 'cannot be read'],
      ['a mode-000 `refs/bisect/` directory', 'refs/bisect', false, 'cannot be listed and searched'],
      ['a mode-000 per-worktree REFLOG file', 'logs/refs/worktree/keep', true, 'cannot be read'],
    ] as const)('FAILS pin-failed on %s — the tree, the branch and the row untouched, no breadcrumb', (_what, rel, logAll, why) => {
      const c = makeChild(h);
      if (logAll) always(c);
      const [x] = looseCommits(h, c.main, 1, 'unreadable holder');
      h.git(c.wt, 'update-ref', rel.includes('bisect') ? 'refs/bisect/bad' : 'refs/worktree/keep', x!);
      fs.writeFileSync(path.join(c.wt, 'notes.txt'), 'uncommitted work');
      const target = path.join(gitDir(c.wt), rel);
      expect(fs.existsSync(target), 'the CONTROL: it stands').toBe(true);
      const tok = evalOf(h).token;
      const before = treeOf(c.wt);
      let r: { code: number; stdout: string; stderr: string };
      fs.chmodSync(target, 0o000);
      // Restored only if it still stands: a reclaim that read nothing deletes it with G.
      try { r = childReclaimVerb(h, tok); } finally {
        if (fs.existsSync(target)) fs.chmodSync(target, fs.statSync(target).isDirectory() ? 0o755 : 0o644);
      }
      pinFailedIntact(c, r, before, `${target} ${why}`);
    }, 90_000);

    it('reclaims through the residue git leaves — an EMPTY `refs/bisect/` and an empty `logs/refs/worktree/`', () => {
      const c = makeChild(h);
      const g = gitDir(c.wt);
      fs.mkdirSync(path.join(g, 'refs', 'bisect'), { recursive: true });
      fs.mkdirSync(path.join(g, 'logs', 'refs', 'worktree'), { recursive: true });
      reclaimed(c, childReclaimVerb(h, evalOf(h).token));
    }, 120_000);

    it('reclaims through a `refs/worktree/` ref naming an object git no longer has — skipped, never a failure', () => {
      const c = makeChild(h);
      const g = gitDir(c.wt);
      fs.mkdirSync(path.join(g, 'refs', 'worktree'), { recursive: true });
      fs.writeFileSync(path.join(g, 'refs', 'worktree', 'gone'), `${'d'.repeat(40)}\n`);
      expect(hasCommit(h, c.main, 'd'.repeat(40)), 'the CONTROL: git has no such object').toBe(false);
      reclaimed(c, childReclaimVerb(h, evalOf(h).token));
    }, 120_000);

    it('reclaims through a SYMBOLIC ref and a stale empty `.lock` — neither is a ref to read', () => {
      const c = makeChild(h);
      const g = gitDir(c.wt);
      fs.mkdirSync(path.join(g, 'refs', 'worktree'), { recursive: true });
      fs.writeFileSync(path.join(g, 'refs', 'worktree', 'sym'), `ref: refs/heads/${CHILD_BRANCH}\n`);
      fs.writeFileSync(path.join(g, 'refs', 'worktree', 'keep.lock'), '');
      reclaimed(c, childReclaimVerb(h, evalOf(h).token));
    }, 120_000);

    it('a tree whose `.git` is re-pointed at the SHARED directory after the settle stops step 4 pin-failed — G is only ever a directory under `worktrees/`', () => {
      // After the settle's re-pin, the tail's ownership proof has already run
      // and reads git's RECORD of the path, which still stands: only step 4's
      // keep sees that the tree's git directory is now the common one, whose
      // refs and reflogs are every session's.
      const c = makeChild(h);
      const common = h.git(c.main, 'rev-parse', '--absolute-git-dir');
      const pre = afterSettle(`printf 'gitdir: %s\\n' "${common}" > "${path.join(c.wt, '.git')}";`);
      const r = childReclaimVerb(h, evalOf(h).token, { pre });
      expect(r.code, r.stdout + r.stderr).toBe(1);
      const o = JSON.parse(r.stdout) as { failed: string; detail: string };
      expect(o.failed).toBe('pin-failed');
      expect(o.detail).toContain(`is ${common}, which is none of ${common}'s worktree records, so it was never read`);
      expect(fs.existsSync(c.wt), 'the tree stands').toBe(true);
      expect(gitDir(c.wt), 'the CONTROL: the tree resolves to the common dir').toBe(common);
      expect(h.git(c.main, 'rev-parse', `refs/heads/${CHILD_BRANCH}`), 'the branch stands').toBe(c.tip);
      expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays').toBe('reclaim:worktree');
    }, 90_000);

    it('a tree whose `.git` is re-pointed at ANOTHER checkout’s git directory after the settle stops step 4 pin-failed — that session’s refs are never read into this attic', () => {
      // `worktrees/other` IS a directory directly under `worktrees/`, so only
      // G's own `gitdir` file — which names `other/.git`, not this tree's —
      // tells it is another session's.
      const c = makeChild(h);
      const other = path.join(h.home, 'other');
      h.git(c.main, 'worktree', 'add', '-b', 'ws/other', other);
      const [y] = looseCommits(h, c.main, 1, 'another session’s per-worktree ref');
      h.git(other, 'update-ref', 'refs/worktree/keep', y!);
      const ownG = gitDir(c.wt);
      const otherG = gitDir(other);
      const pre = afterSettle(`printf 'gitdir: %s\\n' "${otherG}" > "${path.join(c.wt, '.git')}";`);
      const r = childReclaimVerb(h, evalOf(h).token, { pre });
      expect(r.code, r.stdout + r.stderr).toBe(1);
      const o = JSON.parse(r.stdout) as { failed: string; detail: string };
      expect(o.failed).toBe('pin-failed');
      expect(o.detail).toContain(`is ${otherG}, which git records as`);
      expect(o.detail).toContain("another checkout's, so it was never read");
      expect(gitDir(c.wt), 'the CONTROL: the tree resolves to the other admin directory').toBe(otherG);
      expect(atticReach(h, c), 'another session’s commit was kept in this child’s attic').not.toContain(y);
      for (const g of [ownG, otherG]) expect(fs.existsSync(g), `${g} stands`).toBe(true);
      expect(fs.existsSync(c.wt), 'the tree stands').toBe(true);
      expect(h.git(c.main, 'rev-parse', `refs/heads/${CHILD_BRANCH}`), 'the branch stands').toBe(c.tip);
      expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays').toBe('reclaim:worktree');
    }, 90_000);

    it('a directory whose LISTING fails is never read as empty — pin-failed, whatever a check before it said', () => {
      // No fixture can make a directory unreadable between a test and its
      // listing on cue, so the lister is stubbed to fail for this one
      // directory, which stays readable throughout: the listing's own answer
      // is the only thing that can stop it.
      const c = makeChild(h);
      const [x] = looseCommits(h, c.main, 1, 'listing fails');
      h.git(c.wt, 'update-ref', 'refs/worktree/keep', x!);
      const dir = path.join(gitDir(c.wt), 'refs', 'worktree');
      const pre = `find() { if [[ "$1" == "${dir}" ]]; then echo "find: $1: Input/output error" >&2; return 1; fi; command find "$@"; };`;
      const tok = evalOf(h, { pre }).token;
      const before = treeOf(c.wt);
      const r = childReclaimVerb(h, tok, { pre });
      pinFailedIntact(c, r, before, `${dir} cannot be listed and searched (find answered 1: find: ${dir}: Input/output error)`);
    }, 90_000);

    it('FAILS pin-failed on a directory that can be LISTED but not searched — an entry that no longer answers is never assumed gone', () => {
      // Mode 600: a lister may name its entries without error (measured, this
      // box's `find`), yet none can be looked at, so none is proven absent.
      const c = makeChild(h);
      const [x] = looseCommits(h, c.main, 1, 'unsearchable holder');
      h.git(c.wt, 'update-ref', 'refs/worktree/keep', x!);
      const dir = path.join(gitDir(c.wt), 'refs', 'worktree');
      const tok = evalOf(h).token;
      const before = treeOf(c.wt);
      let r: { code: number; stdout: string; stderr: string };
      fs.chmodSync(dir, 0o600);
      try { r = childReclaimVerb(h, tok); } finally { if (fs.existsSync(dir)) fs.chmodSync(dir, 0o755); }
      pinFailedIntact(c, r, before, dir);
    }, 90_000);

    it.each([
      ['G/refs/', ['refs', 'worktree', 'lnk'], (x: string, _c: Child) => `${x}\n`],
      ['G/logs/', ['logs', 'refs', 'worktree', 'lnk'], (x: string, c: Child) => `${c.tip} ${x} T <t@x> 1700000000 +0000\tfixture\n`],
    ] as const)('FAILS pin-failed on a SYMBOLIC LINK under %s — never followed, and what it points at is not kept', (_where, rel, body) => {
      const c = makeChild(h);
      const [x] = looseCommits(h, c.main, 1, 'behind a link');
      const target = path.join(h.home, 'link-target');
      fs.writeFileSync(target, body(x!, c));
      const link = path.join(gitDir(c.wt), ...rel);
      fs.mkdirSync(path.dirname(link), { recursive: true });
      fs.symlinkSync(target, link);
      const before = treeOf(c.wt);
      const r = childReclaimVerb(h, evalOf(h).token);
      pinFailedIntact(c, r, before, `${link} is a symbolic link`);
      expect(atticReach(h, c), 'the link was followed').not.toContain(x);
    }, 90_000);

    it('FAILS pin-failed on an EMPTY per-worktree ref file — it names nothing git could have written', () => {
      const c = makeChild(h);
      const empty = path.join(gitDir(c.wt), 'refs', 'worktree', 'empty');
      fs.mkdirSync(path.dirname(empty), { recursive: true });
      fs.writeFileSync(empty, '');
      const before = treeOf(c.wt);
      const r = childReclaimVerb(h, evalOf(h).token);
      pinFailedIntact(c, r, before, `${empty} names neither a ref nor an object id`);
    }, 90_000);

    it.each(['ORIG_HEAD', 'MERGE_AUTOSTASH'])('FAILS pin-failed on a mode-000 %s in G — a named file that stands and cannot be read', (name) => {
      // Made unreadable BEFORE the audit: the fingerprint reads the op heads,
      // so a change after it is refused `state-changed`, not this.
      const c = makeChild(h);
      const [x] = looseCommits(h, c.main, 1, `unreadable ${name}`);
      const file = path.join(gitDir(c.wt), name);
      fs.writeFileSync(file, `${x}\n`);
      fs.writeFileSync(path.join(c.wt, 'notes.txt'), 'uncommitted work');
      let r: { code: number; stdout: string; stderr: string };
      let before: string[] | 'gone';
      fs.chmodSync(file, 0o000);
      try {
        const tok = evalOf(h).token;
        before = treeOf(c.wt);
        r = childReclaimVerb(h, tok);
      } finally { if (fs.existsSync(file)) fs.chmodSync(file, 0o644); }
      pinFailedIntact(c, r, before, `${file} cannot be read`);
    }, 90_000);

    it('keeps the COMMIT a per-worktree ref reaches through an annotated TAG', () => {
      const c = makeChild(h);
      const [x] = looseCommits(h, c.main, 1, 'tagged');
      h.git(c.main, 'tag', '-a', '-m', 'a tag object', 'fixture-tag', x!);
      const tag = h.git(c.main, 'rev-parse', 'refs/tags/fixture-tag');
      h.git(c.main, 'tag', '-d', 'fixture-tag');
      h.git(c.wt, 'update-ref', 'refs/worktree/tagged', tag);
      expect(h.git(c.main, 'cat-file', '-t', tag), 'the CONTROL: it names a tag object').toBe('tag');
      inNoSharedRef(c, x!);
      reclaimed(c, childReclaimVerb(h, evalOf(h).token));
      keptThroughGc(c, x!);
    }, 120_000);
  });
});

describe('a hidden-flag edit is kept, or dropped and RECORDED — never deleted in silence (spec §5.5 step 2)', () => {
  /** `f`, committed as a template, flagged skip-worktree. */
  const hide = (c: Child, f: string): void => {
    fs.writeFileSync(path.join(c.wt, f), 'KEY=template\n');
    h.git(c.wt, 'add', f); h.git(c.wt, 'commit', '-m', `add ${f}`);
    h.git(c.wt, 'update-index', '--skip-worktree', f);
  };

  it('a hidden SECRET edit, and nothing else: no WIP, and the answer and the record both say one path was dropped', () => {
    const c = makeChild(h);
    hide(c, '.env');
    fs.writeFileSync(path.join(c.wt, '.env'), 'KEY=live\n');
    const r = childReclaimVerb(h, evalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const out = JSON.parse(r.stdout) as { reclaimed: string; wip: string | null; secretsDropped: unknown };
    expect(out.reclaimed).toBe(CHILD_ID);
    expect(out.wip, 'nothing but a secret was uncommitted').toBeNull();
    expect(out.secretsDropped, 'the answer must not read as "nothing was left"').toBe(1);
    expect(tombOf()['secretsDropped']).toEqual(['.env']);
  }, 120_000);

  it('a hidden NON-SECRET edit is in the WIP the verb pins, read back from git after the tree is gone', () => {
    const c = makeChild(h);
    fs.writeFileSync(path.join(c.wt, 'db.yml'), 'password: template\n');
    h.git(c.wt, 'add', 'db.yml'); h.git(c.wt, 'commit', '-m', 'db');
    h.git(c.wt, 'update-index', '--assume-unchanged', 'db.yml');
    fs.writeFileSync(path.join(c.wt, 'db.yml'), 'password: local\n');
    const r = childReclaimVerb(h, evalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const out = JSON.parse(r.stdout) as { wip: string | null; secretsDropped: unknown };
    expect(out.wip).toMatch(/^[0-9a-f]{40}$/);
    expect(out.secretsDropped).toBe(0);
    expect(fs.existsSync(c.wt), 'the CONTROL: the tree is gone').toBe(false);
    expect(h.git(c.main, 'show', `${out.wip!}:db.yml`)).toBe('password: local');
  }, 120_000);

  it('refuses state-changed when a hidden path starts differing after the audit — and deletes nothing', () => {
    const c = makeChild(h);
    hide(c, 'cfg.yml');
    const tok = evalOf(h).token;
    fs.writeFileSync(path.join(c.wt, 'cfg.yml'), 'KEY=local\n');
    expect(refusedWith(childReclaimVerb(h, tok))).toBe('state-changed');
    intact(c);
  }, 90_000);

  it('refuses — deletes nothing — a checkout of ANOTHER repository holding a hidden-flag edit (the review’s measured shape)', () => {
    const c = makeChild(h);
    const origin = path.join(h.home, 'origins', 'other.git');
    execFileSync('git', ['init', '--bare', '-q', '-b', 'main', origin], { env: inheritedEnv() });
    const seedRepo = path.join(h.home, 'seed-other');
    execFileSync('git', ['init', '-q', '-b', 'main', seedRepo], { env: inheritedEnv() });
    fs.writeFileSync(path.join(seedRepo, 'cfg.yml'), 'orig\n');
    h.git(seedRepo, 'add', 'cfg.yml'); h.git(seedRepo, 'commit', '-m', 'cfg');
    h.git(seedRepo, 'remote', 'add', 'origin', origin); h.git(seedRepo, 'push', '-q', 'origin', 'main');
    const clone = path.join(c.wt, 'vendor', 'other');
    execFileSync('git', ['clone', '-q', origin, clone], { env: inheritedEnv() });
    h.git(clone, 'update-index', '--skip-worktree', 'cfg.yml');
    // The token is minted while the file is unchanged — the audit's own
    // answer then; the verb's ladder, inside the lock, must refuse on its own.
    const tok = evalOf(h).token;
    expect(tok, 'the CONTROL: flagged but unchanged, the audit mints a token').toMatch(/^[0-9a-f]{64}$/);
    fs.writeFileSync(path.join(clone, 'cfg.yml'), 'LOCAL-EDIT-ONLY-COPY\n');
    expect(refusedWith(childReclaimVerb(h, tok))).toBe('containment-unproven');
    intact(c);
    expect(fs.readFileSync(path.join(clone, 'cfg.yml'), 'utf8'), 'the only copy of the edit').toBe('LOCAL-EDIT-ONLY-COPY\n');
  }, 120_000);

  it('the SETTLE records a hidden secret edit made after the pin, even when nothing else moved', () => {
    // `_ws_unsupervise` is the tail's first act, after the pin and before the
    // settle: the edit lands in exactly the window only the settle can see.
    const c = makeChild(h);
    hide(c, '.env');
    const pre = `_ws_unsupervise() { echo "unsupervise $*" >> "$HOME/ccd-calls"; printf 'KEY=late\\n' > "${c.wt}/.env"; };`;
    const r = childReclaimVerb(h, evalOf(h).token, { pre });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(fs.readFileSync(path.join(h.home, 'ccd-calls'), 'utf8'), 'the CONTROL: the late edit ran').toContain('unsupervise');
    const out = JSON.parse(r.stdout) as { wip: string | null; secretsDropped: unknown };
    expect(out.wip).toBeNull();
    expect(tombOf()['secretsDropped'], 'the settle dropped it and left no record').toEqual(['.env']);
    expect(out.secretsDropped).toBe(1);
  }, 120_000);
});
