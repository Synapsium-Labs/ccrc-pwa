// `ws-reclaim` — the destructive verb for a CHILD (spec 2026-09-22 §5.5-§5.6).
// Every case builds a real child in a fixture HOME and runs the sourced
// function with the unit and pane calls RECORDED, never made. What is asserted
// is what is left on disk and in git afterwards — never what the verb says.
//
// Split (task 1b, wave 4) so each file fits the 600s foreground ceiling; the
// shared fixtures live in `childReclaimVerbHelpers.ts`. This file (part 2 of
// 3, continuing `ccd-child-reclaim-verb.test.ts`) is the TAIL's proofs: nested
// checkouts and artifacts, the vanished-worktree arm, the tail re-proving the
// tree is the child's own at removal time on every arm, an OTHER row that is
// not absolute or resolves through `//`, a nested checkout proven inside the
// child's tree, the windows each rung's proof is asked in, a vanished child
// tree's nested-line "gone" proof, a nested branch's CAS, "gone" proven for an
// unsearchable path, the residue probe's default TMPDIR root, and the tail's
// final own-tree/own-branch probes — continued by `-reflogs.test.ts`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { eventsOf, refusalsOf } from './lifecycleHelpers.js';
import {
  CHILD_BRANCH, CHILD_ID, CHILD_RUN, childReclaimVerb, evalOf, makeChild, otherSnapshot, type Child,
} from './childReclaimFixture.js';
import { verbHelpers } from './childReclaimVerbHelpers.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-child-reclaim-verb-'); });
afterEach(() => { h.cleanup(); });
const { reg, tombOf, atticShas, KILL, unsupervised, intact, refusedWith, interrupted, resumeToken, repoint, failedPairAgrees, treeOf } = verbHelpers(() => h);

describe('nested checkouts and artifacts', () => {
  it('pins and removes a nested worktree of this repository, and removes a proven-clean one of another', () => {
    const c = makeChild(h);
    const inner = path.join(c.wt, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
    fs.writeFileSync(path.join(inner, 'dirty.txt'), 'dirty');
    const origin = path.join(h.home, 'origins', 'other.git');
    // Through the harness's git (HOME = the fixture HOME), never the vitest
    // process's own environment and its real git configuration.
    h.git(h.home, 'init', '--bare', '-q', '-b', 'main', origin);
    const seedRepo = path.join(h.home, 'seed-other');
    h.git(h.home, 'init', '-q', '-b', 'main', seedRepo);
    fs.writeFileSync(path.join(seedRepo, 'r'), 'r');
    h.git(seedRepo, 'add', 'r'); h.git(seedRepo, 'commit', '-m', 'r');
    h.git(seedRepo, 'remote', 'add', 'origin', origin); h.git(seedRepo, 'push', '-q', 'origin', 'main');
    h.git(h.home, 'clone', '-q', origin, path.join(c.wt, 'vendor', 'other'));
    const r = childReclaimVerb(h, evalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(fs.existsSync(c.wt)).toBe(false);
    expect(h.git(c.main, 'branch', '--list', 'ws/nested'), 'the nested branch went too').toBe('');
    const nestedWip = atticShas(c).find((sha) => {
      try { return h.git(c.main, 'ls-tree', '-r', '--name-only', sha).split('\n').includes('dirty.txt'); } catch { return false; }
    });
    expect(nestedWip, 'the nested checkout’s uncommitted work is in the attic').toBeDefined();
    const tomb = tombOf() as { containment: { sameRepository: string[]; foreignProven: string[] } };
    expect(tomb.containment.sameRepository.some((p) => p.endsWith('/inner'))).toBe(true);
    expect(tomb.containment.foreignProven.some((p) => p.endsWith('/vendor/other'))).toBe(true);
  }, 90_000);

  it('a nested line with NO recorded head fails branch-moved — an empty head is never handed to the CAS', () => {
    // The pin never records one (it fails instead), but the tail reads the
    // TOMBSTONE, which is a file on disk: an empty head there is a line that
    // does not say which commit its branch may be deleted at.
    const c = makeChild(h);
    const inner = path.join(c.wt, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
    interrupted(c, 'children');
    const line = (tombOf()['children'] as string[]).find((l) => l.split('\t')[1] === 'ws/nested')!;
    expect(line, 'the CONTROL: the pin recorded the nested line').toBeDefined();
    const emptied = JSON.stringify({ children: [`${line.split('\t')[0]}\tws/nested\t`] });
    h.sh(`_ws_tombstone_patch ${CHILD_ID} '${emptied}'`);
    fs.rmSync(inner, { recursive: true, force: true });     // so the settle has no head to re-record
    const r = childReclaimVerb(h, resumeToken('children'));
    // `git update-ref -d <ref> ""` DELETES, unconditionally (measured, git
    // 2.43: rc 0, the branch gone) — an empty old value is no compare at all.
    expect(h.git(c.main, 'branch', '--list', 'ws/nested'), 'the nested branch survives').toContain('ws/nested');
    expect(fs.existsSync(c.wt), 'the child’s tree survives').toBe(true);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('branch-moved');
    expect(o.detail).toContain('ws/nested');
    expect(h.reg(CHILD_ID, 'reaping')).toBe('reclaim:children');
  }, 90_000);

  it('a nested checkout swapped for a LINK to another worktree is never removed through it', () => {
    // git's record is matched by the RESOLVED path too (so a symlinked ancestor
    // cannot hide it), and a link standing at the nested path resolves to the
    // OTHER worktree's record: `worktree remove` handed that path would take
    // the other tree. So the nested leaf is re-judged before git is asked.
    const c = makeChild(h);
    const inner = path.join(c.wt, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
    interrupted(c, 'children');
    const tok = resumeToken('children');
    const other = path.join(h.home, 'other');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/other', other);
    fs.writeFileSync(path.join(other, 'dirty.txt'), 'uncommitted work of another session\n');
    fs.rmSync(inner, { recursive: true, force: true });
    fs.rmSync(path.join(c.main, '.git', 'worktrees', 'inner'), { recursive: true, force: true });
    fs.symlinkSync(other, inner);
    const before = otherSnapshot(h, c, other);
    const r = childReclaimVerb(h, tok);
    expect(otherSnapshot(h, c, other), '`other` was not removed through the link').toEqual(before);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('worktree-remove-failed');
    expect(o.detail).toContain('symbolic link');
    expect(fs.existsSync(path.join(c.wt, 'f1.txt')), 'the child’s tree survives').toBe(true);
    expect(h.reg(CHILD_ID, 'reaping')).toBe('reclaim:children');
  }, 90_000);

  for (const [label, pre] of [
    ['git’s list (the tail’s own identity rung reads it first)', 'git() { case "$*" in *"worktree list"*) return 128 ;; esac; command git "$@"; };'],
    ['the nested step’s own read of it', '_ws_reclaim_nested_record() { return 2; };'],
  ] as const) it(`a worktree list that could not be READ stops the tail before the child’s tree goes — never "no record": ${label}`, () => {
    const c = makeChild(h);
    const inner = path.join(c.wt, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
    interrupted(c, 'children');
    const tok = resumeToken('children');
    const r = childReclaimVerb(h, tok, { pre });
    expect(fs.existsSync(path.join(c.wt, 'f1.txt')), 'the child’s tree survives').toBe(true);
    expect(fs.existsSync(inner), 'the nested checkout survives').toBe(true);
    expect(h.git(c.main, 'branch', '--list', 'ws/nested')).toContain('ws/nested');
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('worktree-remove-failed');
    expect(o.detail).toContain('worktree list');
    expect(h.reg(CHILD_ID, 'reaping')).toBe('reclaim:children');
  }, 90_000);

  it('never follows a temp root that is a symlink out of ~/.cc-tmp', () => {
    makeChild(h);
    const outside = path.join(h.home, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'keep'), 'not the child’s');
    fs.mkdirSync(path.join(h.home, '.cc-tmp'), { recursive: true });
    fs.symlinkSync(outside, path.join(h.home, '.cc-tmp', CHILD_ID));
    expect(JSON.parse(childReclaimVerb(h, evalOf(h).token).stdout).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(path.join(outside, 'keep')), 'the target is never followed').toBe(true);
    // …and the LINK itself is collected: wave 1's `_child_tmpdir` rc 2 leaves
    // this leaf in place, and a recycled slug would meet it on every spawn.
    expect(() => fs.lstatSync(path.join(h.home, '.cc-tmp', CHILD_ID)), 'the leaf symlink is unlinked').toThrow();
  }, 90_000);

  it('unlinks a temp-root leaf that is a regular FILE — the other shape wave 1 leaves behind', () => {
    makeChild(h);
    fs.mkdirSync(path.join(h.home, '.cc-tmp'), { recursive: true });
    fs.writeFileSync(path.join(h.home, '.cc-tmp', CHILD_ID), 'a file where the root should be');
    expect(JSON.parse(childReclaimVerb(h, evalOf(h).token).stdout).reclaimed).toBe(CHILD_ID);
    expect(() => fs.lstatSync(path.join(h.home, '.cc-tmp', CHILD_ID)), 'the leaf file is unlinked').toThrow();
    expect(fs.existsSync(path.join(h.home, '.cc-tmp')), 'the root itself stays').toBe(true);
  }, 90_000);

  // Mode-000 normalise is POSIX-portable (see
  // ccd-child-reclaim-ladder.test.ts's rung-8 cases): a non-root user is
  // denied, and the `find -exec chmod` pass fixes it, identically on Darwin.
  it('removes a clips directory holding a mode-000 subdirectory — normalised, then removed', () => {
    makeChild(h);
    const locked = path.join(h.home, '.cc-clips', CHILD_ID, 'locked');
    fs.mkdirSync(locked, { recursive: true });
    fs.writeFileSync(path.join(locked, 'x'), 'x');
    fs.chmodSync(locked, 0o000);
    try {
      expect(JSON.parse(childReclaimVerb(h, evalOf(h).token).stdout).reclaimed).toBe(CHILD_ID);
      expect(fs.existsSync(path.join(h.home, '.cc-clips', CHILD_ID))).toBe(false);
    } finally { if (fs.existsSync(locked)) fs.chmodSync(locked, 0o755); }
  }, 90_000);
});

describe('a vanished worktree is reclaimed from what is left; a directory git does not record is refused (spec §5.5)', () => {
  it('pins the branch tip and its stashes, then removes branch, clips, temp root and row — the tombstone saying absent', () => {
    const c = makeChild(h);
    fs.appendFileSync(path.join(c.wt, 'f1.txt'), 'stashed\n');
    h.git(c.wt, 'stash', 'push', '-m', 'kept');
    const stash = h.git(c.main, 'rev-parse', 'refs/stash');
    fs.mkdirSync(path.join(h.home, '.cc-clips', CHILD_ID), { recursive: true });
    fs.writeFileSync(path.join(h.home, '.cc-clips', CHILD_ID, 'shot.png'), 'png');
    fs.mkdirSync(path.join(h.home, '.cc-tmp', CHILD_ID, 'cdk.out'), { recursive: true });
    fs.rmSync(c.wt, { recursive: true, force: true });
    // The CONTROL: git still RECORDS the vanished worktree (`prunable`), and
    // that record names the branch — the tail must clear it before its CAS.
    expect(h.git(c.main, 'worktree', 'list', '--porcelain')).toMatch(/^prunable /m);

    const r = childReclaimVerb(h, evalOf(h).token, { extra: "--surface agent --actor 'run:7 reclaim sweep'" });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const out = JSON.parse(r.stdout) as { reclaimed: string; wip: string | null; attic: number };
    expect(out.reclaimed).toBe(CHILD_ID);
    expect(out.wip, 'no tree, so no WIP commit').toBeNull();
    expect((out as unknown as { secretsDropped: unknown }).secretsDropped, 'no tree, so nothing dropped').toBe(0);

    const attic = atticShas(c);
    expect(attic, 'the branch tip is pinned').toContain(c.tip);
    expect(attic, 'the stash attributed to the branch is pinned').toContain(stash);
    expect(out.attic).toBe(attic.length);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'branch').toBe('');
    expect(h.git(c.main, 'worktree', 'list', '--porcelain'), 'git’s stale record was cleared').not.toMatch(/^prunable /m);
    expect(fs.existsSync(path.join(h.home, '.cc-clips', CHILD_ID)), 'clips').toBe(false);
    // Darwin keeps the temp root: the in-use probe answers unmeasured there (spec §5.6).
    if (process.platform !== 'darwin') expect(fs.existsSync(path.join(h.home, '.cc-tmp', CHILD_ID)), 'temp root').toBe(false);
    for (const field of ['uuid', 'child', 'reaping', 'workdir']) expect(h.reg(CHILD_ID, field), field).toBeNull();
    // Unsupervise and the ANCHORED kill run FIRST on this arm too (spec §5.6).
    expect(unsupervised()).toEqual([`unsupervise ${CHILD_ID} agent agent`]);
    expect(h.calls()).toContain(KILL);

    const tomb = tombOf();
    expect(tomb['worktree']).toBe('absent');
    expect(tomb['tip'], 'the tip the branch was deleted at').toBe(c.tip);
    expect(tomb['wip']).toBeNull();
    expect(eventsOf(h.home, 'reclaim').map((e) => e['outcome'])).toEqual(['intent', 'done']);
  }, 90_000);

  it('with git’s record already gone too, the registry’s branch is reclaimed and its tip is what is pinned', () => {
    const c = makeChild(h);
    fs.rmSync(c.wt, { recursive: true, force: true });
    h.git(c.main, 'worktree', 'prune');                     // the fixture repository only
    const r = childReclaimVerb(h, evalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(atticShas(c), 'the branch tip is pinned — no record is left to name it').toContain(c.tip);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH)).toBe('');
    expect(tombOf()['worktree']).toBe('absent');
  }, 90_000);

  it('pins a DETACHED child’s last commit — reachable from git’s record alone — before the record is cleared', () => {
    const c = makeChild(h);
    h.git(c.wt, 'checkout', '--detach');
    fs.writeFileSync(path.join(c.wt, 'detached.txt'), 'on no branch');
    h.git(c.wt, 'add', 'detached.txt');
    h.git(c.wt, 'commit', '-m', 'detached work');
    const detached = h.git(c.wt, 'rev-parse', 'HEAD');
    fs.rmSync(c.wt, { recursive: true, force: true });
    const r = childReclaimVerb(h, evalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(atticShas(c), 'the detached commit is in the attic').toContain(detached);
    expect(h.git(c.main, 'cat-file', '-t', detached)).toBe('commit');
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the registry’s branch went, at the tip it had').toBe('');
    expect(tombOf()['worktree']).toBe('absent');
  }, 90_000);

  it('a pin it cannot take stops the vanished arm before anything is touched — pin-failed, no breadcrumb', () => {
    const c = makeChild(h);
    fs.rmSync(c.wt, { recursive: true, force: true });
    const pre = `_ws_reclaim_stash_shas() { echo ${'d'.repeat(40)}; };`;
    const r = childReclaimVerb(h, evalOf(h, { pre }).token, { pre });
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).failed).toBe('pin-failed');
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the branch survives').toContain(CHILD_BRANCH);
    expect(h.reg(CHILD_ID, 'uuid'), 'the registry row survives').not.toBeNull();
    expect(h.reg(CHILD_ID, 'reaping'), 'no breadcrumb').toBeNull();
    expect(unsupervised(), 'the unit was not touched').toEqual([]);
  }, 60_000);

  it('the vanished arm’s pins run hook-free — a repository hook never sees an attic ref being written', () => {
    // `_ws_reclaim_pin_absent` runs under the SAME containment as the pin
    // phase (`_ws_reclaim_contained`): every `update-ref` fires
    // reference-transaction, a program the repository names.
    const c = makeChild(h);
    const hook = path.join(c.main, '.git', 'hooks', 'reference-transaction');
    fs.writeFileSync(hook, '#!/bin/sh\nin=$(cat)\ncase "$in" in *refs/ccrc/attic/*) echo ran >> "$HOME/attic-hook-runs" ;; esac\nexit 0\n',
      { mode: 0o755 });
    fs.rmSync(c.wt, { recursive: true, force: true });
    const r = childReclaimVerb(h, evalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(atticShas(c), 'the CONTROL: attic refs WERE written').toContain(c.tip);
    expect(fs.existsSync(path.join(h.home, 'attic-hook-runs')), 'a repository hook ran inside the pin').toBe(false);
  }, 90_000);

  it('a unit STILL UP stops the vanished arm before the branch goes — the tail starts at the branch, unit first', () => {
    const c = makeChild(h);
    fs.rmSync(c.wt, { recursive: true, force: true });
    const r = childReclaimVerb(h, evalOf(h).token, { pre: `_svc_is_active() { printf active; };` });
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).failed).toBe('unit-still-active');
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'nothing was deleted').toContain(CHILD_BRANCH);
    expect(h.reg(CHILD_ID, 'reaping'), 'the vanished arm resumes from the branch').toBe('reclaim:branch');
    expect(tombOf()['worktree']).toBe('absent');
  }, 60_000);

  it('refuses no-worktree-record — TERMINAL, journaled — for a directory git does not record, and deletes nothing', () => {
    const c = makeChild(h);
    const admin = path.join(c.main, '.git', 'worktrees', 'quiet-basin');
    expect(fs.existsSync(admin), 'the CONTROL: git names the admin directory after the worktree basename').toBe(true);
    fs.rmSync(admin, { recursive: true, force: true });
    expect(refusedWith(childReclaimVerb(h, 'f'.repeat(64)))).toBe('no-worktree-record');
    intact(c);
    expect(refusalsOf(h.home)).toContainEqual({ act: 'reclaim', token: 'no-worktree-record' });
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', '.reaped', `${CHILD_ID}.json`)), 'no tombstone').toBe(false);
  }, 60_000);
});

describe('the tail proves the tree is the child’s own at removal time, on EVERY arm — from the record the pin wrote (spec §5.5-§5.6)', () => {
  for (const phase of ['worktree', 'children'] as const) {
    it(`P1: a registry row re-pointed at ANOTHER worktree is never followed on a resume at \`${phase}\``, () => {
      // The review's probe P1. The row is a file on disk a resume re-reads
      // after an arbitrary gap; the tail takes the workdir from the RECORD the
      // pin wrote, and a row that no longer agrees with it stops the tail.
      const c = makeChild(h);
      interrupted(c, phase);
      const tok = resumeToken(phase);
      const other = path.join(h.home, 'worktrees', 'demo', 'other');
      h.git(c.main, 'worktree', 'add', '--detach', other, 'main');
      fs.writeFileSync(path.join(other, 'dirty.txt'), 'another session\n');
      const before = treeOf(other);
      fs.writeFileSync(reg('workdir'), other);
      const r = childReclaimVerb(h, tok);
      expect(treeOf(other), 'the other worktree was not removed').toEqual(before);
      expect(fs.existsSync(path.join(c.wt, 'f1.txt')), 'nor was the child’s').toBe(true);
      expect(r.code, r.stdout + r.stderr).toBe(1);
      const o = JSON.parse(r.stdout) as { failed: string; detail: string };
      expect(o.failed).toBe('worktree-remove-failed');
      expect(o.detail).toContain('disagree');
      failedPairAgrees(r);
      expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays').toBe(`reclaim:${phase}`);
    }, 90_000);
  }

  it('a record that does not say it is THIS child’s stops the tail before anything is deleted', () => {
    const c = makeChild(h);
    interrupted(c, 'worktree');
    h.sh(`_ws_tombstone_patch ${CHILD_ID} '{"id":"demo-someone-else"}'`);
    const r = childReclaimVerb(h, resumeToken('worktree'));
    expect(fs.existsSync(path.join(c.wt, 'f1.txt')), 'the tree survives').toBe(true);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(JSON.parse(r.stdout).failed).toBe('tombstone-unwritable');
  }, 90_000);

  it('another registry row naming the same workdir stops a RESUMED tail, asked again on that arm, and an unlistable registry does too', () => {
    const c = makeChild(h);
    interrupted(c, 'worktree');
    const tok = resumeToken('worktree');
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'demo-twin.uuid'), 'u-twin');
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'demo-twin.workdir'), c.wt);
    let r = childReclaimVerb(h, tok);
    expect(fs.existsSync(path.join(c.wt, 'f1.txt')), 'the tree the other row names survives').toBe(true);
    expect(JSON.parse(r.stdout).failed).toBe('worktree-remove-failed');
    expect(JSON.parse(r.stdout).detail).toContain('demo-twin');
    fs.rmSync(path.join(h.home, '.cc-sessions', 'demo-twin.uuid'));
    fs.rmSync(path.join(h.home, '.cc-sessions', 'demo-twin.workdir'));
    const regdir = path.join(h.home, '.cc-sessions');
    fs.chmodSync(regdir, 0o300);
    try {
      r = childReclaimVerb(h, tok);
    } finally { fs.chmodSync(regdir, 0o755); }
    expect(fs.existsSync(path.join(c.wt, 'f1.txt')), 'an unlistable registry proved nothing, and nothing went').toBe(true);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(JSON.parse(r.stdout).detail).toContain('another registry row');
  }, 90_000);

  // The resumed arm has no ladder in front of it, so this is where the tail's
  // own re-proof is the only thing between a row rooted inside the child and
  // `git worktree remove --force` — the review's two shapes, on a resume.
  for (const shape of ['inner', 'server'] as const) {
    it(`a registry row rooted INSIDE the child (\`<child>/${shape}\`) stops a RESUMED tail — nothing further is deleted`, () => {
      const c = makeChild(h);
      interrupted(c, 'worktree');
      const root = path.join(c.wt, shape);
      if (shape === 'inner') {
        h.git(c.main, 'worktree', 'add', '-b', 'ws/other-live', root);
        fs.writeFileSync(path.join(root, 'live.txt'), 'another session’s uncommitted work\n');
      } else fs.mkdirSync(root);
      const tok = resumeToken('worktree');
      fs.writeFileSync(path.join(h.home, '.cc-sessions', 'demo-nested.uuid'), 'u-nested');
      fs.writeFileSync(path.join(h.home, '.cc-sessions', 'demo-nested.workdir'), root);
      const before = treeOf(c.wt);
      const r = childReclaimVerb(h, tok);
      expect(treeOf(c.wt), 'the child’s tree, and the other session’s inside it, survive byte for byte').toEqual(before);
      expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the child’s branch survives').toContain(CHILD_BRANCH);
      if (shape === 'inner') {
        expect(h.git(c.main, 'branch', '--list', 'ws/other-live'), 'the other session’s branch survives').toContain('ws/other-live');
      }
      expect(r.code, r.stdout + r.stderr).toBe(1);
      const o = JSON.parse(r.stdout) as { failed: string; detail: string };
      expect(o.failed).toBe('worktree-remove-failed');
      expect(o.detail, 'the detail names the session to end or purge').toContain('demo-nested');
      expect(o.detail).toContain('rooted inside');
      failedPairAgrees(r);
      expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays').toBe('reclaim:worktree');
    }, 90_000);
  }

  it('a registry row spelled THROUGH the child (`<child>/..`) stops a RESUMED tail, and its detail says so — nothing further is deleted', () => {
    const c = makeChild(h);
    interrupted(c, 'worktree');
    const tok = resumeToken('worktree');
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'demo-up.uuid'), 'u-up');
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'demo-up.workdir'), `${c.wt}/..`);
    const before = treeOf(c.wt);
    const r = childReclaimVerb(h, tok);
    expect(treeOf(c.wt), 'the child’s tree survives byte for byte').toEqual(before);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the child’s branch survives').toContain(CHILD_BRANCH);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('worktree-remove-failed');
    expect(o.detail).toContain(`registry row(s) demo-up spell their workdir through ${c.wt}, not as one plain path`);
    expect(o.detail).not.toContain('rooted inside');
    failedPairAgrees(r);
    expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays').toBe('reclaim:worktree');
  }, 90_000);

  it('the same row stops a RESUMED tail whose tree is already GONE, and still says spelled through — never "rooted inside"', () => {
    // A resume past `worktree`: the child's tree was removed before the
    // interruption, so `<child>/..` no longer resolves and `_ws_realpath`
    // hands it back as written — below the child as a string, and not plain.
    const c = makeChild(h);
    interrupted(c, 'branch');
    fs.rmSync(c.wt, { recursive: true, force: true });
    const tok = resumeToken('branch');
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'demo-up.uuid'), 'u-up');
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'demo-up.workdir'), `${c.wt}/..`);
    const r = childReclaimVerb(h, tok);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the child’s branch survives').toContain(CHILD_BRANCH);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('worktree-remove-failed');
    expect(o.detail).toContain(`registry row(s) demo-up spell their workdir through ${c.wt}, not as one plain path`);
    expect(o.detail).not.toContain('rooted inside');
    failedPairAgrees(r);
    expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays').toBe('reclaim:branch');
  }, 90_000);

  it('a tree that stands with NO record in git of it is not removed by a resumed tail', () => {
    // The ladder's `no-worktree-record`, re-asked on every arm: a directory
    // $main does not record is not provably one of its worktrees.
    const c = makeChild(h);
    interrupted(c, 'worktree');
    const tok = resumeToken('worktree');
    fs.rmSync(path.join(c.main, '.git', 'worktrees', 'quiet-basin'), { recursive: true, force: true });
    const r = childReclaimVerb(h, tok);
    expect(fs.existsSync(path.join(c.wt, 'f1.txt')), 'the tree survives').toBe(true);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(JSON.parse(r.stdout).failed).toBe('worktree-remove-failed');
    expect(JSON.parse(r.stdout).detail).toContain('no worktree record');
  }, 90_000);

  it('a workdir that is the project’s MAIN checkout, or the project directory itself, is never removed — both rungs', () => {
    // The ladder's two not-a-workspace rungs, re-asked by the tail. The record
    // and the row are re-pointed TOGETHER, so the agreement rung passes.
    const c = makeChild(h);
    interrupted(c, 'worktree');
    const tok = resumeToken('worktree');
    // (a) the first stanza: the project is a LINKED worktree (`demo2`), and
    // the row names the repository's REAL main checkout — only git's first
    // stanza says what it is.
    const demo2 = path.join(h.home, 'projects', 'demo2');
    h.git(c.main, 'worktree', 'add', '-b', 'proj2-main', demo2);
    fs.writeFileSync(path.join(c.main, 'main-work.txt'), 'the project’s own uncommitted work\n');
    repoint('demo2', c.main);
    let r = childReclaimVerb(h, tok);
    expect(fs.existsSync(path.join(c.main, 'main-work.txt')), 'the main checkout survives').toBe(true);
    expect(JSON.parse(r.stdout).failed).toBe('worktree-remove-failed');
    expect(JSON.parse(r.stdout).detail).toContain('main checkout');
    // (b) the resolved path: the row names the project directory, a linked
    // worktree that is not the first stanza.
    fs.writeFileSync(path.join(demo2, 'proj-work.txt'), 'the project’s own uncommitted work\n');
    repoint('demo2', demo2);
    r = childReclaimVerb(h, tok);
    expect(fs.existsSync(path.join(demo2, 'proj-work.txt')), 'the project directory survives').toBe(true);
    expect(JSON.parse(r.stdout).failed).toBe('worktree-remove-failed');
    expect(JSON.parse(r.stdout).detail).toContain('project directory');
  }, 90_000);
});

describe('an OTHER row whose workdir is not absolute, or opens with or resolves to `//`, stops the verb, fresh or resumed — it cannot be placed against the child (spec §5.5, rung 9)', () => {
  // The review's measured shape, end to end: a row `quiet-basin/server` (what
  // an older `ccd start … quiet-basin/server` stored when typed in
  // `~/worktrees/demo`), read by a reclaim whose cwd is `$HOME`. It resolved
  // outside the child, and the verb removed `<child>/server` with the other
  // session's files in it. Now it is unplaced: never terminal, never a pass.
  const plantNested = (c: Child): string => {
    const sub = path.join(c.wt, 'server');
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, 'live.txt'), 'another session’s uncommitted work\n');
    return sub;
  };
  // Two spellings of an unplaceable row: the relative one, and one opening
  // with `//` — bash's `pwd -P`, which `_ws_realpath` answers with, keeps a
  // leading `//`, so `//<child>/server` resolved to no prefix of the child's
  // and the verb removed `live.txt` (review fr171-B C1, measured).
  const SPELLINGS: ReadonlyArray<[string, (c: Child) => string]> = [
    ['a relative row `quiet-basin/server`', () => 'quiet-basin/server'],
    ['a row `//<child>/server`', (c) => `/${c.wt}/server`],
    // A plain absolute row that RESOLVES to `//<child>/server` through a link
    // whose target opens with `//` (rereview fr171-B-r1 N1): the verb removed
    // `live.txt` through it too. Where `pwd -P` keeps that `//` (bash on
    // Linux, measured; the ladder suite reads it per platform) it is unplaced.
    ['a row through a link whose target opens with `//`', (c) => {
      fs.mkdirSync(path.join(h.home, 'elsewhere'), { recursive: true });
      fs.symlinkSync(`/${c.wt}`, path.join(h.home, 'elsewhere', 'dslink'));
      return path.join(h.home, 'elsewhere', 'dslink', 'server');
    }],
  ];
  const plantRow = (value: string): void => {
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'demo-nested.uuid'), 'u-nested');
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'demo-nested.workdir'), value);
  };

  /** Whether the reader cannot place this value ON THIS PLATFORM — read, not
   *  assumed: a link target's leading `//` survives bash's `pwd -P` on Linux
   *  (measured), and every spelling here must be unplaceable there. Where a
   *  platform collapsed it, the row would place inside the child and be
   *  refused instead — nothing removed either way. */
  const unplaceable = (value: string): boolean => {
    const u = !value.startsWith('/') || /^\/\/[^/]/.test(value) || /^\/\/[^/]/.test(h.sh(`_ws_realpath "${value}"`));
    if (process.platform !== 'darwin') expect(u, `${value} is unplaceable on this platform`).toBe(true);
    return u;
  };

  for (const [label, spell] of SPELLINGS) {
    it(`${label}: the fresh arm answers \`probe-unmeasured\` at exit 1, and \`<child>/server\` stands with its files`, () => {
      const c = makeChild(h);
      const sub = plantNested(c);
      const tok = evalOf(h).token;
      expect(tok, 'the audit minted a token before the other row existed').toMatch(/^[0-9a-f]{64}$/);
      const value = spell(c);
      plantRow(value);
      const before = treeOf(c.wt);
      const r = childReclaimVerb(h, tok);
      // What is on disk FIRST: a reclaim that went ahead shows here.
      expect(treeOf(c.wt), 'the child’s tree, and the other session’s inside it, survive byte for byte').toEqual(before);
      expect(fs.readFileSync(path.join(sub, 'live.txt'), 'utf8')).toContain('uncommitted');
      if (!unplaceable(value)) { expect(refusedWith(r)).toBe('containment-unproven'); intact(c); return; }
      expect(r.code, r.stdout + r.stderr).toBe(1);
      const o = JSON.parse(r.stdout) as Record<string, unknown>;
      expect(o['failed']).toBe('probe-unmeasured');
      expect(o['refused'], 'not a refusal: the fault is another row’s').toBeUndefined();
      expect(String(o['detail'])).toContain('registry row(s) demo-nested name no plain absolute workdir');
      expect(atticShas(c), 'nothing was pinned').toEqual([]);
      expect(h.reg(CHILD_ID, 'reaping'), 'nothing started: no breadcrumb').toBeNull();
      intact(c);
    }, 90_000);

    it(`${label}: the same row stops a RESUMED tail with \`worktree-remove-failed\` — the tree byte-identical, the breadcrumb kept`, () => {
      const c = makeChild(h);
      plantNested(c);
      interrupted(c, 'worktree');
      const tok = resumeToken('worktree');
      const value = spell(c);
      plantRow(value);
      const before = treeOf(c.wt);
      const r = childReclaimVerb(h, tok);
      expect(treeOf(c.wt), 'the child’s tree, and the other session’s inside it, survive byte for byte').toEqual(before);
      expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the child’s branch survives').toContain(CHILD_BRANCH);
      expect(r.code, r.stdout + r.stderr).toBe(1);
      const o = JSON.parse(r.stdout) as { failed: string; detail: string };
      expect(o.failed).toBe('worktree-remove-failed');
      expect(o.detail).toContain(unplaceable(value)
        ? 'registry row(s) demo-nested name no plain absolute workdir' : 'registry row(s) demo-nested rooted inside');
      expect(o.detail, 'the row’s value is never printed').not.toContain(value);
      expect(h.calls(), 'it stops AFTER the kill: the child’s pane is down, nothing deleted').toContain(KILL);
      failedPairAgrees(r);
      expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays').toBe('reclaim:worktree');
    }, 90_000);
  }

  /** The child's OWN workdir resolved to a `//` spelling: `$HOME/worktrees`
   *  becomes a link to `/` + `$HOME/wtreal`, and the other session's row names
   *  the REAL path inside the child (rereview fr171-B-r2 I1). Returns that
   *  row's value, and whether this platform's `pwd -P` kept the `//` (read,
   *  never assumed; mandatory off Darwin). */
  const relinkChild = (c: Child): { real: string; kept: boolean } => {
    fs.renameSync(path.join(h.home, 'worktrees'), path.join(h.home, 'wtreal'));
    fs.symlinkSync(`/${path.join(h.home, 'wtreal')}`, path.join(h.home, 'worktrees'));
    const kept = h.sh(`_ws_realpath "${c.wt}"`).startsWith('//');
    if (process.platform !== 'darwin') expect(kept, 'the child resolves to a `//` spelling').toBe(true);
    return { real: path.join(h.home, 'wtreal', 'demo', 'quiet-basin', 'server'), kept };
  };

  it('a CHILD whose own workdir resolves through a `//` link: the fresh arm answers `probe-unmeasured`, and the other session’s files stand', () => {
    const c = makeChild(h);
    plantNested(c);
    const { real, kept } = relinkChild(c);
    const tok = evalOf(h).token;
    expect(tok, 'with no other row the audit mints a token').toMatch(/^[0-9a-f]{64}$/);
    plantRow(real);
    const before = treeOf(c.wt);
    const r = childReclaimVerb(h, tok);
    expect(treeOf(c.wt), 'the child’s tree, and the other session’s inside it, survive byte for byte').toEqual(before);
    expect(fs.readFileSync(path.join(real, 'live.txt'), 'utf8')).toContain('uncommitted');
    if (!kept) { expect(refusedWith(r)).toBe('containment-unproven'); intact(c); return; }
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(o['failed']).toBe('probe-unmeasured');
    expect(String(o['detail'])).toContain(`registry row(s) demo-nested cannot be placed against this child: ${CHILD_ID}'s own workdir resolves to a path opening with //`);
    expect(String(o['detail']), 'the row’s value is never printed').not.toContain(real);
    expect(h.reg(CHILD_ID, 'reaping'), 'nothing started: no breadcrumb').toBeNull();
    intact(c);
  }, 90_000);

  it('the same child stops a RESUMED tail with `worktree-remove-failed` — the tree byte-identical, the breadcrumb kept', () => {
    const c = makeChild(h);
    plantNested(c);
    interrupted(c, 'worktree');
    const tok = resumeToken('worktree');
    const { real, kept } = relinkChild(c);
    plantRow(real);
    const before = treeOf(c.wt);
    const r = childReclaimVerb(h, tok);
    expect(treeOf(c.wt), 'the child’s tree, and the other session’s inside it, survive byte for byte').toEqual(before);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('worktree-remove-failed');
    if (kept) expect(o.detail).toContain(`${CHILD_ID}'s own workdir resolves to a path opening with //`);
    expect(h.calls(), 'it stops AFTER the kill: the child’s pane is down, nothing deleted').toContain(KILL);
    failedPairAgrees(r);
    expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays').toBe('reclaim:worktree');
  }, 90_000);
});

describe('a nested checkout is PROVEN inside the child’s tree before it is removed — every component, and git’s record (spec §5.5)', () => {
  /** The review's probe P2b: a nested worktree at `wt/sub/inner`, a sibling
   *  worktree `other2` at `$HOME/x/inner` holding uncommitted work, and
   *  `wt/sub` swapped for a link to `$HOME/x` with the nested record pruned —
   *  so a string-prefix test passes and git resolves the path to `other2`. */
  const nestedBehindLink = (c: Child): { other2: string; swap: string } => {
    fs.mkdirSync(path.join(c.wt, 'sub'));
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', path.join(c.wt, 'sub', 'inner'));
    const x = path.join(h.home, 'x');
    fs.mkdirSync(x);
    const other2 = path.join(x, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/other2', other2);
    fs.writeFileSync(path.join(other2, 'keep.txt'), 'another session\n');
    const sub = path.join(c.wt, 'sub');
    return { other2, swap: `rm -rf "${sub}"; command git -C "${c.main}" worktree prune; ln -s "${x}" "${sub}";` };
  };

  it('P2b, the fresh arm: a directory between the child and its nested checkout swapped for a link — nothing of the other worktree goes', () => {
    const c = makeChild(h);
    const { other2, swap } = nestedBehindLink(c);
    const before = treeOf(other2);
    const late = `_ws_unsupervise() { echo "unsupervise $*" >> "$HOME/ccd-calls"; ${swap} };`;
    const r = childReclaimVerb(h, evalOf(h).token, { pre: late });
    expect(treeOf(other2), 'the other worktree was not removed through the link').toEqual(before);
    expect(h.git(c.main, 'branch', '--list', 'ws/other2')).toContain('ws/other2');
    expect(fs.existsSync(path.join(c.wt, 'f1.txt')), 'the child’s tree stands: the tail stopped').toBe(true);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('worktree-remove-failed');
    expect(o.detail).toContain('symbolic link');
    failedPairAgrees(r);
    expect(h.reg(CHILD_ID, 'reaping')).toBe('reclaim:children');
  }, 90_000);

  it('P2b, a resume at the nested phase: the same swap, made while the act was down', () => {
    const c = makeChild(h);
    const { other2, swap } = nestedBehindLink(c);
    interrupted(c, 'children');
    const tok = resumeToken('children');
    h.sh(swap);
    const before = treeOf(other2);
    const r = childReclaimVerb(h, tok);
    expect(treeOf(other2), 'the other worktree was not removed through the link').toEqual(before);
    expect(fs.existsSync(path.join(c.wt, 'f1.txt')), 'the child’s tree stands').toBe(true);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(JSON.parse(r.stdout).failed).toBe('worktree-remove-failed');
    expect(JSON.parse(r.stdout).detail).toContain('symbolic link');
  }, 90_000);

  it('a nested line whose path is NOT inside the child’s tree is never acted on — a clean sibling worktree survives', () => {
    // The record is a file on disk: a line naming a path outside the child's
    // resolved tree is not a nested checkout of this child, however its string
    // begins. Without the strict-descendant rung the walk finds nothing and
    // reads the path as "already gone", and git would clear — and, for a clean
    // tree, REMOVE — the worktree that line names.
    const c = makeChild(h);
    const inner = path.join(c.wt, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
    interrupted(c, 'children');
    const tok = resumeToken('children');
    const sibling = path.join(h.home, 'worktrees', 'demo', 'sibling');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/sibling', sibling);
    const head = h.git(sibling, 'rev-parse', 'HEAD');
    h.sh(`_ws_tombstone_patch ${CHILD_ID} '${JSON.stringify({ children: [`${fs.realpathSync(sibling)}\tws/sibling\t${head}`] })}'`);
    const before = treeOf(sibling);
    const r = childReclaimVerb(h, tok);
    expect(treeOf(sibling), 'the sibling worktree survives').toEqual(before);
    expect(h.git(c.main, 'branch', '--list', 'ws/sibling')).toContain('ws/sibling');
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(JSON.parse(r.stdout).failed).toBe('worktree-remove-failed');
    expect(JSON.parse(r.stdout).detail).toContain('strictly inside');
  }, 90_000);

  it('a nested directory that stands but that git no longer records as a worktree is not removed as one', () => {
    // Its `.git` and git's admin entry both gone: the settle sees an ordinary
    // directory of the child (and pins its files into the child's WIP), and the
    // nested step — which would `worktree remove --force` the recorded path —
    // finds no record of it and stops. git's own "is not a working tree" stands
    // behind this rung; the rung is what says why.
    const c = makeChild(h);
    const inner = path.join(c.wt, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
    interrupted(c, 'children');
    const tok = resumeToken('children');
    fs.writeFileSync(path.join(inner, 'unpinned.txt'), 'written after the pin\n');
    fs.rmSync(path.join(inner, '.git'), { force: true });
    fs.rmSync(path.join(c.main, '.git', 'worktrees', 'inner'), { recursive: true, force: true });
    const r = childReclaimVerb(h, tok);
    expect(fs.existsSync(path.join(inner, 'unpinned.txt')), 'the unrecorded checkout survives').toBe(true);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(JSON.parse(r.stdout).failed).toBe('worktree-remove-failed');
    expect(JSON.parse(r.stdout).detail).toContain('missing');
  }, 90_000);

  it('a nested branch another checkout still holds is KEPT — and recorded as kept, in the record and on the done row', () => {
    const c = makeChild(h);
    const inner = path.join(c.wt, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
    // A second checkout of the same branch, outside the child (`-f`: git
    // allows it only when told to).
    h.git(c.main, 'worktree', 'add', '-f', path.join(h.home, 'elsewhere'), 'ws/nested');
    const r = childReclaimVerb(h, evalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(h.git(c.main, 'branch', '--list', 'ws/nested'), 'the held branch was kept').toContain('ws/nested');
    expect((tombOf()['keptBranches'] as string[]).join('\n')).toContain('ws/nested');
    const done = eventsOf(h.home, 'reclaim').find((e) => e['outcome'] === 'done')!;
    expect(String(done['detail']), 'the done row says what it kept').toContain('ws/nested');
  }, 90_000);
});

describe('the windows the proofs are asked in — each rung stands for the one after the check before it (spec §5.5)', () => {
  for (const prune of [false, true]) {
    it(`N1: the workdir swapped for a link from INSIDE the settle is stopped at the removal step (git's record ${prune ? 'pruned' : 'standing'})`, () => {
      // `_ws_reclaim_owned` asked the leaf before the settle; the settle and the
      // nested steps run after it. The suite's function-override device reaches
      // that window: `_ws_reclaim_children_merge` runs inside the settle.
      const c = makeChild(h);
      interrupted(c, 'worktree');
      const tok = resumeToken('worktree');
      const other = path.join(h.home, 'other');
      h.git(c.main, 'worktree', 'add', '-b', 'ws/other', other);
      fs.writeFileSync(path.join(other, 'dirty.txt'), 'another session’s uncommitted work\n');
      const before = treeOf(other);
      const pre = `_ws_reclaim_children_merge() { rm -rf "${c.wt}"; ${prune ? `command git -C "${c.main}" worktree prune;` : ''}`
        + ` ln -s "${other}" "${c.wt}"; printf '%s' "$1"; };`;
      const r = childReclaimVerb(h, tok, { pre });
      expect(treeOf(other), 'the other worktree was not removed through the link').toEqual(before);
      expect(h.git(c.main, 'branch', '--list', 'ws/other')).toContain('ws/other');
      expect(r.code, r.stdout + r.stderr).toBe(1);
      const o = JSON.parse(r.stdout) as { failed: string; detail: string };
      expect(o.failed).toBe('worktree-remove-failed');
      expect(o.detail).toContain('symbolic link');
      expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays at the worktree step').toBe('reclaim:worktree');
    }, 90_000);
  }

  it('the child’s tree swapped for a link AFTER its resolved path was taken is stopped by the nested checkout’s own resolution', () => {
    // The component walk starts BELOW the resolved root and never re-asks the
    // root itself; a nested checkout that stands must then resolve (`pwd -P`)
    // to exactly its recorded path, which a swapped root cannot. git's record
    // and git's own validation stand behind this rung too.
    const c = makeChild(h);
    const inner = path.join(c.wt, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
    const x = path.join(h.home, 'x');
    fs.mkdirSync(x);
    const other2 = path.join(x, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/other2', other2);
    fs.writeFileSync(path.join(other2, 'keep.txt'), 'another session\n');
    const before = treeOf(other2);
    const aside = path.join(h.home, 'aside');
    const pre = `eval "$(declare -f _ws_reclaim_nested_proven | sed '1s/_ws_reclaim_nested_proven/_orig_np/')";`
      + ` _ws_reclaim_nested_proven() { [[ -L "${c.wt}" ]] || { mv "${c.wt}" "${aside}"; ln -s "${x}" "${c.wt}"; }; _orig_np "$@"; };`;
    const r = childReclaimVerb(h, evalOf(h).token, { pre });
    expect(treeOf(other2), 'the other worktree survives').toEqual(before);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('worktree-remove-failed');
    expect(o.detail).toContain('not to itself');
  }, 90_000);

  it('N2: a resume at `children` whose child tree has VANISHED finishes — the nested records cleared by path, nothing outside the child touched', () => {
    const c = makeChild(h);
    const inner = path.join(c.wt, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
    interrupted(c, 'children');
    const tok = resumeToken('children');
    const sibling = path.join(h.home, 'worktrees', 'demo', 'sibling');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/sibling', sibling);
    fs.writeFileSync(path.join(sibling, 'dirty.txt'), 'another session\n');
    const before = treeOf(sibling);
    fs.rmSync(c.wt, { recursive: true, force: true });
    const r = childReclaimVerb(h, tok);
    expect(treeOf(sibling), 'the sibling worktree is untouched').toEqual(before);
    expect(h.git(c.main, 'branch', '--list', 'ws/sibling')).toContain('ws/sibling');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).reclaimed).toBe(CHILD_ID);
    const list = h.git(c.main, 'worktree', 'list', '--porcelain');
    expect(list, 'the nested checkout’s stale record was cleared').not.toContain(inner);
    expect(list, 'and the child’s own').not.toContain(`worktree ${c.wt}\n`);
    expect(list, 'the sibling’s record stands').toContain(sibling);
    expect(h.git(c.main, 'branch', '--list', 'ws/nested'), 'the nested branch went, at its pinned head').toBe('');
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH)).toBe('');
    expect(unsupervised(), 'unsupervise still ran first').toHaveLength(1);
  }, 90_000);
});

describe('a vanished child tree lets a nested line count as gone ONLY when that is proven — inside the tree, and nothing standing (spec §5.5)', () => {
  it('G1: a symlinked ANCESTOR re-pointed since the interrupt — the child’s tree and its nested checkout still stand at the resolved path, and nothing is removed', () => {
    // The literal workdir is absent (so the vanished-tree arm is taken), but
    // the nested lines name RESOLVED paths, under the old target, where the
    // tree still stands. Not inside the workdir's resolved root: refused.
    const real = path.join(h.home, 'wtreal');
    fs.mkdirSync(real);
    fs.symlinkSync(real, path.join(h.home, 'worktrees'));
    const c = makeChild(h);
    const inner = path.join(c.wt, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
    interrupted(c, 'children');
    const tok = resumeToken('children');
    fs.unlinkSync(path.join(h.home, 'worktrees'));
    fs.mkdirSync(path.join(h.home, 'worktrees'));
    const realInner = path.join(real, 'demo', 'quiet-basin', 'inner');
    const before = treeOf(realInner);
    const r = childReclaimVerb(h, tok);
    expect(treeOf(realInner), 'the standing nested checkout was not removed').toEqual(before);
    expect(h.git(c.main, 'branch', '--list', 'ws/nested'), 'its branch survives').toContain('ws/nested');
    expect(fs.existsSync(path.join(real, 'demo', 'quiet-basin', 'f1.txt')), 'the child’s tree stands').toBe(true);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('worktree-remove-failed');
    expect(o.detail).toContain('strictly inside');
    expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays').toBe('reclaim:children');
  }, 90_000);

  it('G2u: a record line naming a sibling worktree, the child’s tree gone — the sibling, its branch and its unique commit survive', () => {
    // The same line with the tree PRESENT is the "NOT inside the child’s tree"
    // case above (G2c); both are refused by the one proof.
    const c = makeChild(h);
    interrupted(c, 'children');
    const tok = resumeToken('children');
    const sib = path.join(h.home, 'worktrees', 'demo', 'sibling');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/sibling', sib);
    fs.writeFileSync(path.join(sib, 'uniq.txt'), 'unique committed work\n');
    h.git(sib, 'add', 'uniq.txt'); h.git(sib, 'commit', '-m', 'uniq');
    const sha = h.git(sib, 'rev-parse', 'HEAD');
    h.sh(`_ws_tombstone_patch ${CHILD_ID} '${JSON.stringify({ children: [`${fs.realpathSync(sib)}\tws/sibling\t${sha}`] })}'`);
    const before = treeOf(sib);
    fs.rmSync(c.wt, { recursive: true, force: true });
    const r = childReclaimVerb(h, tok);
    expect(treeOf(sib), 'the sibling worktree survives').toEqual(before);
    expect(h.git(c.main, 'branch', '--list', 'ws/sibling')).toContain('ws/sibling');
    expect(h.git(c.main, 'for-each-ref', '--contains', sha, '--format=%(refname)'), 'its unique commit is still reachable')
      .toContain('refs/heads/ws/sibling');
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(JSON.parse(r.stdout).failed).toBe('worktree-remove-failed');
    expect(JSON.parse(r.stdout).detail).toContain('strictly inside');
  }, 90_000);

  it('a checkout that REAPPEARS at a nested path while the tree is gone is refused, never removed as a stale record', () => {
    // Reached with the suite's function-override device: the proof's own call
    // is the moment a writer creates the path.
    const c = makeChild(h);
    const inner = path.join(c.wt, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
    interrupted(c, 'children');
    const tok = resumeToken('children');
    fs.rmSync(c.wt, { recursive: true, force: true });
    const pre = `eval "$(declare -f _ws_reclaim_nested_proven | sed '1s/_ws_reclaim_nested_proven/_orig_np/')";`
      + ` _ws_reclaim_nested_proven() { mkdir -p "${inner}"; echo late > "${inner}/keep.txt"; _orig_np "$@"; };`;
    const r = childReclaimVerb(h, tok, { pre });
    expect(fs.existsSync(path.join(inner, 'keep.txt')), 'what stands at the path survives').toBe(true);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(JSON.parse(r.stdout).failed).toBe('worktree-remove-failed');
    expect(JSON.parse(r.stdout).detail).toContain('stands at');
  }, 90_000);
});

describe('a nested branch on a line counted as gone is deleted only when it is provably the line’s, and never unpinned (spec §5.5)', () => {
  /** A commit no ref but `ws/parked` holds, made after the pin phase — so no
   *  pin the act took before its interrupt can cover it. */
  const parkedCommit = (c: Child, at: string, record: boolean): string => {
    h.git(c.main, 'worktree', 'add', '-q', '-b', 'ws/parked', at);
    fs.writeFileSync(path.join(at, 'p.txt'), 'parked\n');
    h.git(at, 'add', 'p.txt'); h.git(at, 'commit', '-q', '-m', 'parked unique');
    const sha = h.git(at, 'rev-parse', 'HEAD');
    if (!record) h.git(c.main, 'worktree', 'remove', at);
    return sha;
  };
  const containing = (c: Child, sha: string): string => h.git(c.main, 'for-each-ref', '--contains', sha, '--format=%(refname)');

  it('S3-gone: a wrong line naming an absent path inside the vanished tree, which git records no checkout at, keeps the unheld branch it names', () => {
    const c = makeChild(h);
    interrupted(c, 'children');
    const tok = resumeToken('children');
    const sha = parkedCommit(c, path.join(h.home, 'parkwt'), false);
    const ghost = path.join(fs.realpathSync(c.wt), 'ghost');
    h.sh(`_ws_tombstone_patch ${CHILD_ID} '${JSON.stringify({ children: [`${ghost}\tws/parked\t${sha}`] })}'`);
    fs.rmSync(c.wt, { recursive: true, force: true });
    const r = childReclaimVerb(h, tok);
    // Reachability FIRST, so a red names the loss the probe measured (the
    // commit reachable from nothing), not only a branch that went.
    expect(containing(c, sha), 'its unique commit is still reachable').not.toBe('');
    expect(h.git(c.main, 'branch', '--list', 'ws/parked'), 'the branch no record ties to that path was kept').toContain('ws/parked');
    expect(containing(c, sha), 'and reachable from the branch itself').toContain('refs/heads/ws/parked');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).reclaimed).toBe(CHILD_ID);
    expect((tombOf()['keptBranches'] as string[]).join('; ')).toContain('ws/parked (git records no checkout of it at');
  }, 90_000);

  it('a line counted as gone whose branch IS git’s record there has its head pinned in the attic before the branch is deleted', () => {
    // The same wrong-line class with git's record standing: every proof
    // passes, and the head was never pinned — the tree's settle re-pin never
    // ran, and the checkout appeared after the pin phase.
    const c = makeChild(h);
    interrupted(c, 'children');
    const tok = resumeToken('children');
    const ghost = path.join(fs.realpathSync(c.wt), 'ghost');
    const sha = parkedCommit(c, ghost, true);
    h.sh(`_ws_tombstone_patch ${CHILD_ID} '${JSON.stringify({ children: [`${ghost}\tws/parked\t${sha}`] })}'`);
    fs.rmSync(c.wt, { recursive: true, force: true });
    const r = childReclaimVerb(h, tok);
    expect(containing(c, sha), 'the deleted branch’s commit is pinned, not lost')
      .toContain(`refs/ccrc/attic/${CHILD_ID}/${sha}`);
    expect(h.git(c.main, 'branch', '--list', 'ws/parked'), 'the branch went, at its pinned head').toBe('');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).reclaimed).toBe(CHILD_ID);
  }, 90_000);

  it('a gone line whose git record names ANOTHER branch deletes nothing — the branch the line names stands', () => {
    const c = makeChild(h);
    interrupted(c, 'children');
    const tok = resumeToken('children');
    const ghost = path.join(fs.realpathSync(c.wt), 'ghost');
    parkedCommit(c, ghost, true);
    h.git(c.main, 'branch', 'ws/bystander', c.tip);
    h.sh(`_ws_tombstone_patch ${CHILD_ID} '${JSON.stringify({ children: [`${ghost}\tws/bystander\t${c.tip}`] })}'`);
    fs.rmSync(c.wt, { recursive: true, force: true });
    const r = childReclaimVerb(h, tok);
    expect(h.git(c.main, 'branch', '--list', 'ws/bystander'), 'the line’s branch stands').toContain('ws/bystander');
    expect(h.git(c.main, 'branch', '--list', 'ws/parked'), 'and the recorded one').toContain('ws/parked');
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('worktree-remove-failed');
    expect(o.detail).toContain("is on 'ws/parked', not 'ws/bystander'");
    expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays').toBe('reclaim:children');
  }, 90_000);

  it('a gone line naming $main’s own line (origin/HEAD’s branch, with the main checkout elsewhere) keeps that branch', () => {
    const c = makeChild(h);
    interrupted(c, 'children');
    const tok = resumeToken('children');
    h.git(c.main, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
    h.git(c.main, 'checkout', '-q', '-b', 'side');
    const ghost = path.join(fs.realpathSync(c.wt), 'ghost');
    h.git(c.main, 'worktree', 'add', '-q', ghost, 'main');
    const sha = h.git(ghost, 'rev-parse', 'HEAD');
    h.sh(`_ws_tombstone_patch ${CHILD_ID} '${JSON.stringify({ children: [`${ghost}\tmain\t${sha}`] })}'`);
    fs.rmSync(c.wt, { recursive: true, force: true });
    const r = childReclaimVerb(h, tok);
    expect(h.git(c.main, 'branch', '--list', 'main'), 'the main line stands').toContain('main');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect((tombOf()['keptBranches'] as string[]).join('; ')).toContain('main (the main line of');
  }, 90_000);

  it('a gone line’s head that cannot be pinned fails the tail pin-failed — the branch stands, and nothing further is deleted', () => {
    const c = makeChild(h);
    interrupted(c, 'children');
    const tok = resumeToken('children');
    const ghost = path.join(fs.realpathSync(c.wt), 'ghost');
    const sha = parkedCommit(c, ghost, true);
    h.sh(`_ws_tombstone_patch ${CHILD_ID} '${JSON.stringify({ children: [`${ghost}\tws/parked\t${sha}`] })}'`);
    fs.rmSync(c.wt, { recursive: true, force: true });
    // The tree is gone, so no settle runs: this is the only pin the resume takes.
    const r = childReclaimVerb(h, tok, { pre: '_ws_reclaim_attic_extra() { return 1; };' });
    expect(containing(c, sha), 'the unpinned head is still the branch’s').toContain('refs/heads/ws/parked');
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'nothing further: the child’s own branch stands').toContain(CHILD_BRANCH);
    expect(h.reg(CHILD_ID, 'uuid'), 'and its registry row').not.toBeNull();
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('pin-failed');
    expect(o.detail).toContain('a branch is never deleted unpinned');
    expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays').toBe('reclaim:children');
    failedPairAgrees(r);
  }, 90_000);
});

describe('"gone" is PROVEN — a path that could not be looked at is never read as absent (spec §5.5)', () => {
  // `artifacts` too: no step (3)-(5) proof runs there, so the removal-time
  // identity check (`_ws_reclaim_owned`) is the only rung before the row goes.
  for (const phase of ['children', 'worktree', 'branch', 'artifacts']) {
    it(`S1d: the child’s parent directory made unsearchable on a resume at \`${phase}\` stops the tail — both trees, both records, both branches stand`, () => {
      const c = makeChild(h);
      const inner = path.join(c.wt, 'inner');
      h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
      fs.writeFileSync(path.join(inner, 'late.txt'), 'uncommitted nested work\n');
      interrupted(c, phase);
      const tok = resumeToken(phase);
      const demo = path.join(h.home, 'worktrees', 'demo');
      const nestedGit = fs.readFileSync(path.join(inner, '.git'), 'utf8');
      let r: { code: number; stdout: string; stderr: string };
      fs.chmodSync(demo, 0o000);
      try { r = childReclaimVerb(h, tok); } finally { fs.chmodSync(demo, 0o755); }
      expect(fs.readFileSync(path.join(inner, 'late.txt'), 'utf8'), 'the nested tree’s work stands').toBe('uncommitted nested work\n');
      expect(fs.readFileSync(path.join(inner, '.git'), 'utf8'), 'still a checkout').toBe(nestedGit);
      expect(fs.existsSync(path.join(c.wt, 'f1.txt')), 'the child’s tree stands').toBe(true);
      const list = h.git(c.main, 'worktree', 'list', '--porcelain');
      expect(list, 'the nested record stands').toContain(`branch refs/heads/ws/nested`);
      expect(h.git(c.main, 'branch', '--list', 'ws/nested')).toContain('ws/nested');
      expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH)).toContain(CHILD_BRANCH);
      expect(h.reg(CHILD_ID, 'uuid'), 'the registry row stands').not.toBeNull();
      expect(r.code, r.stdout + r.stderr).toBe(1);
      const o = JSON.parse(r.stdout) as { failed: string; detail: string };
      expect(o.failed).toBe('worktree-remove-failed');
      expect(o.detail).toContain(`${demo} cannot be searched`);
      expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays').toBe(`reclaim:${phase}`);
      // Not a wedge: once the directory can be searched, the same act finishes.
      // (Not asked at `branch` or `artifacts`: a tree still standing there is no
      // state the tail leaves — step (4) removed it.)
      if (phase === 'branch' || phase === 'artifacts') return;
      const again = childReclaimVerb(h, resumeToken(phase));
      expect(again.code, again.stdout + again.stderr).toBe(0);
      expect(JSON.parse(again.stdout).reclaimed).toBe(CHILD_ID);
    }, 90_000);
  }

  it('a nested checkout whose own parent turns unsearchable after the settle is never counted as gone', () => {
    const c = makeChild(h);
    const sub = path.join(c.wt, 'sub');
    fs.mkdirSync(sub);
    const inner = path.join(sub, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
    fs.writeFileSync(path.join(inner, 'late.txt'), 'uncommitted nested work\n');
    interrupted(c, 'children');
    const tok = resumeToken('children');
    const pre = `eval "$(declare -f _ws_reclaim_children_merge | sed '1s/_ws_reclaim_children_merge/_orig_cm/')";`
      + ` _ws_reclaim_children_merge() { chmod 000 "${sub}"; _orig_cm "$@"; };`;
    let r: { code: number; stdout: string; stderr: string };
    try { r = childReclaimVerb(h, tok, { pre }); } finally { fs.chmodSync(sub, 0o755); }
    expect(fs.readFileSync(path.join(inner, 'late.txt'), 'utf8'), 'the nested tree’s work stands').toBe('uncommitted nested work\n');
    expect(h.git(c.main, 'worktree', 'list', '--porcelain'), 'its record stands').toContain('branch refs/heads/ws/nested');
    expect(h.git(c.main, 'branch', '--list', 'ws/nested')).toContain('ws/nested');
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('worktree-remove-failed');
    expect(o.detail).toContain(`${fs.realpathSync(sub)} cannot be searched`);
  }, 90_000);

  it('the fresh ladder: a workdir under an unsearchable directory is unmeasured, never the vanished arm', () => {
    makeChild(h);
    const demo = path.join(h.home, 'worktrees', 'demo');
    let a: { verdict: string; token: string; detail: string };
    fs.chmodSync(demo, 0o000);
    try { a = evalOf(h, { childOf: String(CHILD_RUN) }); } finally { fs.chmodSync(demo, 0o755); }
    expect(a.verdict).toBe('unmeasured');
    expect(a.detail).toContain(`${demo} cannot be searched`);
  }, 90_000);

  it('`_ws_reclaim_absent` answers 0 only for ENOENT under a directory it can search, 1 for anything standing, 2 for a look that failed', () => {
    const d = path.join(h.home, 'absent-probe');
    fs.mkdirSync(d);
    fs.writeFileSync(path.join(d, 'file'), 'x');
    fs.symlinkSync(path.join(d, 'nowhere'), path.join(d, 'dangling'));
    const locked = path.join(d, 'locked');
    fs.mkdirSync(locked);
    const ask = (p: string): string => h.sh(`_ws_reclaim_absent '${p}'; printf '%s' "$?"`);
    expect(ask(path.join(d, 'missing')), 'ENOENT').toBe('0');
    expect(ask(path.join(d, 'missing', 'deeper')), 'ENOENT of the first missing component').toBe('0');
    expect(ask(path.join(d, 'file')), 'a file stands').toBe('1');
    expect(ask(path.join(d, 'dangling')), 'a dangling link stands').toBe('1');
    expect(ask(path.join(d, 'file', 'below')), 'a parent that is a file is no directory to look in').toBe('2');
    // A searchable parent and a stat that fails for another reason than
    // ENOENT: `[[ -e ]]` is false here exactly as it is on ENOENT.
    expect(ask(path.join(d, 'n'.repeat(300))), 'ENAMETOOLONG is not absence').toBe('2');
    fs.chmodSync(locked, 0o000);
    try { expect(ask(path.join(locked, 'inner')), 'EACCES is not absence').toBe('2'); } finally { fs.chmodSync(locked, 0o755); }
  }, 30_000);

  describe('`_ws_reclaim_hidden` over a flagged path a sparse checkout has no entry for', () => {
    /** A repo with `sub/f.txt` committed and then flagged skip-worktree, so
     *  `_ws_reclaim_hidden_contained`'s sparse skip is the only thing between
     *  `f.txt`'s flagged entry and a verdict. */
    const flaggedRepo = (name: string): string => {
      const main = h.makeRepo(name);
      fs.mkdirSync(path.join(main, 'sub'));
      fs.writeFileSync(path.join(main, 'sub', 'f.txt'), 'password: template\n');
      h.git(main, 'add', 'sub/f.txt'); h.git(main, 'commit', '-m', 'add sub/f.txt');
      h.git(main, 'update-index', '--skip-worktree', 'sub/f.txt');
      return main;
    };
    const hiddenOf = (main: string): { rc: string; why: string; paths: string[] } => {
      const out = h.sh(
        `_ws_reclaim_hidden '${main}'; rc=$?;`
        + ` printf '%s\\x1f%s\\x1f%s' "$rc" "$_WS_HIDDEN_WHY" "$(printf '%s\\n' \${_WS_HIDDEN_PATHS[@]+"\${_WS_HIDDEN_PATHS[@]}"})"`,
      );
      const [rc = '', why = '', paths = ''] = out.split('\x1f');
      return { rc, why, paths: paths.split('\n').filter(Boolean) };
    };

    it('a mode-000 directory holding the flagged path answers UNMEASURED — never "no edit" (today: skipped, no path)', () => {
      const main = flaggedRepo('sparse-hidden');
      // A real skip-worktree EDIT, as the ruling's case holds: git reads the
      // index blob, so only the edited bytes make "no edit" a lost edit.
      fs.writeFileSync(path.join(main, 'sub', 'f.txt'), 'password: zzzzzzzz\n');
      fs.chmodSync(path.join(main, 'sub'), 0o000);
      let a: { rc: string; why: string; paths: string[] };
      try { a = hiddenOf(main); } finally { fs.chmodSync(path.join(main, 'sub'), 0o755); }
      expect(a.rc, a.why).toBe('1');
      expect(a.why).toContain('cannot be searched');
      expect(a.paths).toEqual([]);
    }, 30_000);

    it('CONTROL: an out-of-cone path under a directory that is simply MISSING is skipped, no path recorded', () => {
      const main = flaggedRepo('sparse-hidden-missing');
      fs.rmSync(path.join(main, 'sub'), { recursive: true, force: true });
      const a = hiddenOf(main);
      expect(a.rc, a.why).toBe('0');
      expect(a.paths).toEqual([]);
    }, 30_000);

    it('CONTROL: an untracked FILE standing at the flagged path’s directory name is skipped, no path recorded', () => {
      const main = flaggedRepo('sparse-hidden-shadowed');
      fs.rmSync(path.join(main, 'sub'), { recursive: true, force: true });
      fs.writeFileSync(path.join(main, 'sub'), 'not a directory\n');
      const a = hiddenOf(main);
      expect(a.rc, a.why).toBe('0');
      expect(a.paths).toEqual([]);
    }, 30_000);
  });

  for (const phase of ['children', 'worktree']) {
    it(`the child’s parent turning unsearchable AFTER the removal-time identity check, on a resume at \`${phase}\`, stops the tail at that step`, () => {
      // `_ws_reclaim_owned` asks before the settle; this makes the directory
      // unsearchable inside the settle, so the step's own proof is the rung.
      const c = makeChild(h);
      const inner = path.join(c.wt, 'inner');
      if (phase === 'children') {
        h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
        fs.writeFileSync(path.join(inner, 'late.txt'), 'uncommitted nested work\n');
      }
      interrupted(c, phase);
      const tok = resumeToken(phase);
      const demo = path.join(h.home, 'worktrees', 'demo');
      const pre = `eval "$(declare -f _ws_reclaim_children_merge | sed '1s/_ws_reclaim_children_merge/_orig_cm/')";`
        + ` _ws_reclaim_children_merge() { chmod 000 "${demo}"; _orig_cm "$@"; };`;
      let r: { code: number; stdout: string; stderr: string };
      try { r = childReclaimVerb(h, tok, { pre }); } finally { fs.chmodSync(demo, 0o755); }
      expect(fs.existsSync(path.join(c.wt, 'f1.txt')), 'the child’s tree stands').toBe(true);
      expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH)).toContain(CHILD_BRANCH);
      if (phase === 'children') {
        expect(fs.readFileSync(path.join(inner, 'late.txt'), 'utf8'), 'the nested tree’s work stands').toBe('uncommitted nested work\n');
        expect(h.git(c.main, 'branch', '--list', 'ws/nested')).toContain('ws/nested');
      }
      expect(r.code, r.stdout + r.stderr).toBe(1);
      const o = JSON.parse(r.stdout) as { failed: string; detail: string };
      expect(o.failed).toBe('worktree-remove-failed');
      expect(o.detail).toContain(`${demo} cannot be searched`);
      expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays at the step that stopped').toBe(`reclaim:${phase}`);
    }, 90_000);
  }

  it('a residue root that cannot be searched is unmeasured — null, never a measured 0', () => {
    const c = makeChild(h);
    const root = path.join(h.home, 'residue');
    fs.mkdirSync(root);
    const tok = evalOf(h).token;
    let r: { code: number; stdout: string; stderr: string };
    fs.chmodSync(root, 0o000);
    try { r = childReclaimVerb(h, tok); } finally { fs.chmodSync(root, 0o755); }
    expect(fs.existsSync(c.wt), 'the reclaim itself ran').toBe(false);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).residueBytes).toBeNull();
  }, 90_000);
});

describe('the residue probe’s DEFAULT root is the BOX’s own TMPDIR, never a bare /tmp (macOS scan, mail 2375)', () => {
  it('derives ${TMPDIR:-/tmp}/claude-<uid> — the same derivation ccd-tmp-sweep uses — with no override set', () => {
    // Every other case in this file drives `_ws_reclaim_residue` through
    // `CCD_RECLAIM_RESIDUE_ROOT` (`CHILD_ENV`, the fixture's own override for
    // exactly this reason: the real default must never be read in a test). This
    // is the one case that reads the DEFAULT, so it plants under a fixture
    // TMPDIR rather than the real `/tmp` — never against the live box.
    const c = makeChild(h);
    const uid = h.sh('id -u');
    const boxTmp = path.join(h.home, 'box-tmp');
    fs.mkdirSync(boxTmp, { recursive: true });
    const residue = path.join(boxTmp, `claude-${uid}`, c.wt.replaceAll('/', '-'));
    fs.mkdirSync(residue, { recursive: true });
    fs.writeFileSync(path.join(residue, 'scratch.txt'), 'scratch under the box TMPDIR, not /tmp');
    const expected = Number(h.sh(`_plat_bytes "${residue}"`));
    expect(expected).toBeGreaterThan(0);
    const out = Number(h.sh(`_ws_reclaim_residue "${c.wt}"`, { TMPDIR: boxTmp }));
    expect(out, 'measured under $TMPDIR/claude-<uid>, never a bare /tmp/claude-<uid>').toBe(expected);
  });
});

describe('the tail never deletes, and the pin never writes, what is not provably the child’s own (spec §5.5; the final review’s probes)', () => {
  const tombKept = (): string => ((tombOf()['keptBranches'] as string[] | undefined) ?? []).join('; ');
  const done = (): Record<string, unknown> => {
    const rows = eventsOf(h.home, 'reclaim').filter((e) => e['outcome'] === 'done');
    expect(rows).toHaveLength(1);
    return rows[0]!;
  };

  it('P1: a child drifted onto `main` (its main checkout elsewhere) keeps `main`, records it, and deletes only its own branch', () => {
    const c = makeChild(h);
    expect(h.git(c.main, 'symbolic-ref', '-q', 'refs/remotes/origin/HEAD'), 'the fixture names the main line').toBe('refs/remotes/origin/main');
    h.git(c.main, 'checkout', '-q', '-b', 'side');
    h.git(c.wt, 'checkout', '-q', 'main');
    const mainTip = h.git(c.main, 'rev-parse', 'refs/heads/main');
    fs.writeFileSync(path.join(c.wt, 'wip.txt'), 'uncommitted\n');
    const e = evalOf(h, { childOf: String(CHILD_RUN) });
    expect(e.verdict, e.detail).toBe('reclaimable');
    const r = childReclaimVerb(h, e.token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const out = JSON.parse(r.stdout) as { reclaimed?: string; wip: string };
    expect(out.reclaimed).toBe(CHILD_ID);
    expect(h.git(c.main, 'rev-parse', 'refs/heads/main'), 'the project’s main line was deleted or written').toBe(mainTip);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the child’s own branch was left').toBe('');
    expect(atticShas(c)).toContain(c.tip);
    expect(atticShas(c)).toContain(out.wip);
    expect(h.git(c.main, 'log', '-1', '--format=%P', out.wip)).toBe(mainTip);
    expect(h.git(c.main, 'show', `${out.wip}:wip.txt`)).toBe('uncommitted');
    expect(tombOf()['branch']).toBe(CHILD_BRANCH);
    expect(tombKept()).toContain(`main (checked out at ${c.wt} in place of ${CHILD_BRANCH})`);
    expect(String(done()['detail'])).toContain('kept branch(es): main (');
  }, 90_000);

  it('P1, vanished: a record left on `main` keeps `main` — the registry’s branch is the one deleted', () => {
    const c = makeChild(h);
    h.git(c.main, 'checkout', '-q', '-b', 'side');
    h.git(c.wt, 'checkout', '-q', 'main');
    const mainTip = h.git(c.main, 'rev-parse', 'refs/heads/main');
    fs.rmSync(c.wt, { recursive: true, force: true });
    const e = evalOf(h, { childOf: String(CHILD_RUN) });
    expect(e.verdict, e.detail).toBe('reclaimable');
    const r = childReclaimVerb(h, e.token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(h.git(c.main, 'rev-parse', 'refs/heads/main'), 'the project’s main line was deleted').toBe(mainTip);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH)).toBe('');
    expect(tombKept()).toContain(`main (git's record of ${c.wt} named it in place of ${CHILD_BRANCH})`);
  }, 90_000);

  it('the ladder refuses branch-elsewhere — terminal, nothing touched — when the child’s own branch is the main line, or that cannot be told', () => {
    const c = makeChild(h);
    h.git(c.main, 'update-ref', `refs/remotes/origin/${CHILD_BRANCH}`, c.tip);
    h.git(c.main, 'symbolic-ref', 'refs/remotes/origin/HEAD', `refs/remotes/origin/${CHILD_BRANCH}`);
    const line = evalOf(h, { childOf: String(CHILD_RUN) });
    expect(line.verdict).toBe('branch-elsewhere');
    expect(line.detail).toContain(`${CHILD_BRANCH} is the main line of`);
    h.git(c.main, 'symbolic-ref', '-d', 'refs/remotes/origin/HEAD');
    const unset = evalOf(h, { childOf: String(CHILD_RUN) });
    expect(unset.verdict, 'an unset origin/HEAD proves nothing — never 1, never a delete').toBe('branch-elsewhere');
    expect(unset.detail).toContain('could not be told');
    expect(refusedWith(childReclaimVerb(h, line.token || '0'.repeat(64)))).toBe('branch-elsewhere');
    intact(c);
  }, 90_000);

  it('the VANISHED arm’s ladder refuses branch-elsewhere the same way — the main line, or an unset origin/HEAD', () => {
    const c = makeChild(h);
    h.git(c.main, 'update-ref', `refs/remotes/origin/${CHILD_BRANCH}`, c.tip);
    h.git(c.main, 'symbolic-ref', 'refs/remotes/origin/HEAD', `refs/remotes/origin/${CHILD_BRANCH}`);
    fs.rmSync(c.wt, { recursive: true, force: true });
    const line = evalOf(h, { childOf: String(CHILD_RUN) });
    expect(line.verdict, line.detail).toBe('branch-elsewhere');
    expect(line.detail).toContain(`${CHILD_BRANCH} is the main line of`);
    h.git(c.main, 'symbolic-ref', '-d', 'refs/remotes/origin/HEAD');
    const unset = evalOf(h, { childOf: String(CHILD_RUN) });
    expect(unset.verdict, unset.detail).toBe('branch-elsewhere');
    expect(unset.detail).toContain('could not be told');
    expect(refusedWith(childReclaimVerb(h, '0'.repeat(64)))).toBe('branch-elsewhere');
    expect(h.git(c.main, 'rev-parse', `refs/heads/${CHILD_BRANCH}`), 'the branch was deleted').toBe(c.tip);
    expect(h.reg(CHILD_ID, 'uuid'), 'the registry row was purged').not.toBeNull();
  }, 90_000);

  it('the tail keeps the branch when it becomes unprovable between the pin and step (5) — a breadcrumb, never a delete', () => {
    const c = makeChild(h);
    const late = `_ws_unsupervise() { echo "unsupervise $*" >> "$HOME/ccd-calls"; git -C "${c.main}" symbolic-ref -d refs/remotes/origin/HEAD; };`;
    const r = childReclaimVerb(h, evalOf(h).token, { pre: late });
    expect(r.code).toBe(1);
    expect((JSON.parse(r.stdout) as { failed: string; detail: string }).failed).toBe('branch-elsewhere');
    expect(r.stdout).toContain('could not be told');
    expect(h.git(c.main, 'rev-parse', `refs/heads/${CHILD_BRANCH}`), 'the branch was deleted').toBe(c.tip);
    expect(h.reg(CHILD_ID, 'reaping')).toBe('reclaim:branch');
  }, 90_000);

  it('P4: a COPY of another worktree inside the child refuses containment-unproven, and the other session’s branch and index are untouched', () => {
    const c = makeChild(h);
    const other = path.join(h.home, 'other');
    h.git(c.main, 'worktree', 'add', '-q', '-b', 'ws/other', other);
    const otherTip = h.git(c.main, 'rev-parse', 'refs/heads/ws/other');
    fs.cpSync(other, path.join(c.wt, 'copy'), { recursive: true });
    fs.writeFileSync(path.join(c.wt, 'copy', 'dirty.txt'), 'x\n');
    const e = evalOf(h, { childOf: String(CHILD_RUN) });
    expect(e.verdict).toBe('containment-unproven');
    expect(e.detail).toContain(`${path.join(c.wt, 'copy')}`);
    expect(refusedWith(childReclaimVerb(h, '0'.repeat(64)))).toBe('containment-unproven');
    expect(h.git(c.main, 'rev-parse', 'refs/heads/ws/other'), 'another session’s branch was written').toBe(otherTip);
    expect(h.git(other, 'status', '--porcelain'), 'another session’s index was changed').toBe('');
    intact(c);
  }, 90_000);

  it('P8: a child whose `.git` names a DETACHED sibling’s admin directory refuses containment-unproven, and the sibling is untouched', () => {
    const c = makeChild(h);
    const other = path.join(h.home, 'other');
    h.git(c.main, 'worktree', 'add', '-q', '--detach', other, 'main');
    const otherHead = h.git(other, 'rev-parse', 'HEAD');
    fs.writeFileSync(path.join(c.wt, '.git'), fs.readFileSync(path.join(other, '.git')));
    fs.writeFileSync(path.join(c.wt, 'child-work.txt'), 'x\n');
    const e = evalOf(h, { childOf: String(CHILD_RUN) });
    expect(e.verdict).toBe('containment-unproven');
    expect(e.detail).toContain('another checkout');
    expect(refusedWith(childReclaimVerb(h, '0'.repeat(64)))).toBe('containment-unproven');
    expect(h.git(other, 'rev-parse', 'HEAD'), 'the sibling’s HEAD moved').toBe(otherHead);
    expect(h.git(other, 'status', '--porcelain'), 'the sibling’s index was changed').toBe('');
  }, 90_000);

  it('P5: a registered nested worktree ON `main` is pinned without writing `main`, and `main` is kept', () => {
    const c = makeChild(h);
    h.git(c.main, 'checkout', '-q', '-b', 'side');
    const nest = path.join(c.wt, 'nest');
    h.git(c.main, 'worktree', 'add', '-q', nest, 'main');
    const mainTip = h.git(c.main, 'rev-parse', 'refs/heads/main');
    fs.writeFileSync(path.join(nest, 'nwip.txt'), 'nested uncommitted\n');
    const r = childReclaimVerb(h, evalOf(h, { childOf: String(CHILD_RUN) }).token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(h.git(c.main, 'rev-parse', 'refs/heads/main'), 'the project’s main line was written').toBe(mainTip);
    const nestedWip = atticShas(c).find((sha) => {
      try { return h.git(c.main, 'ls-tree', '-r', '--name-only', sha).split('\n').includes('nwip.txt'); } catch { return false; }
    });
    expect(nestedWip, 'the nested work is not in the attic').toBeDefined();
    expect(tombKept()).toContain('main (the main line of');
  }, 90_000);

  it('P2: a stale index.lock defers tree-busy on the fresh arm, and --defer-expired reclaims through it — never pin-failed for good', () => {
    const c = makeChild(h);
    const lock = `${h.git(c.wt, 'rev-parse', '--path-format=absolute', '--git-path', 'index')}.lock`;
    fs.writeFileSync(lock, '');
    fs.writeFileSync(path.join(c.wt, 'wip.txt'), 'w\n');
    const e = evalOf(h, { childOf: String(CHILD_RUN) });
    expect(e.verdict).toBe('tree-busy');
    expect(e.detail).toContain('index lock');
    expect(refusedWith(childReclaimVerb(h, '0'.repeat(64)))).toBe('tree-busy');
    intact(c);
    const d = evalOf(h, { childOf: String(CHILD_RUN), defer: 1 });
    expect(d.verdict, d.detail).toBe('reclaimable');
    const r = childReclaimVerb(h, d.token, { extra: '--defer-expired' });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const out = JSON.parse(r.stdout) as { wip: string };
    expect(h.git(c.main, 'show', `${out.wip}:wip.txt`)).toBe('w');
    expect(fs.existsSync(c.wt)).toBe(false);
  }, 90_000);

  it('P3: an index.lock the pane kill leaves behind does not fail the settle — the reclaim completes', () => {
    const c = makeChild(h);
    const lock = `${h.git(c.wt, 'rev-parse', '--path-format=absolute', '--git-path', 'index')}.lock`;
    // No session to find, in tmux's words: rung 5 and the tail's re-measure
    // read an rc 1 with no message as "could not be asked", which stops them.
    const pre = `tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; [[ "$1" == kill-session ]] && : > "${lock}";`
      + ` echo "can't find session: cc-${CHILD_ID}" >&2; return 1; };`;
    fs.writeFileSync(path.join(c.wt, 'wip.txt'), 'w\n');
    const r = childReclaimVerb(h, evalOf(h).token, { pre });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(h.calls()).toContain(KILL);
    expect(fs.existsSync(c.wt)).toBe(false);
    expect(h.reg(CHILD_ID, 'uuid')).toBeNull();
  }, 90_000);
});
