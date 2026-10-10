// Git's SILENCE is asked before it is believed (child reclamation spec §5.5,
// rung 8's rule: a read that failed measured nothing). `git worktree list
// --porcelain` exits 0 and OMITS the stanza of a record whose admin `gitdir` it
// cannot read — and every linked stanza when `worktrees/` cannot be listed,
// and the stanza of an entry whose `gitdir` is empty (measured, git 2.43). So the ladder's "no record" proves nothing until git's
// admin entries are read whole, through `_ws_reclaim_log_of`'s own walk:
//   - an entry that could not be read, or reads empty -> unmeasured (retried);
//   - an entry that names the tree git omitted   -> unmeasured (retried);
//   - no entry names it, every entry read        -> no-worktree-record (TERMINAL), as before.
// The ladder is SHARED: the change reaches `ws-expire` too (a case below). And
// the vanished arm, where "no record" proceeds, takes the same ask. There, too,
// a record git lists with the all-zero HEAD names no commit that was read — git
// prints it for an admin `HEAD` it cannot read, and for a `HEAD` symbolic to a
// branch that no longer exists — so it is unmeasured, never the head the pin
// keeps. The STANDING arm never reads the record's HEAD: with its admin `HEAD`
// unreadable, git cannot resolve the tree's repository, and the ladder answers
// unmeasured before that (a case below measures it).
// FIXTURE HOMEs ONLY: every ccd call runs through the harness, never against $HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { eventsOf } from './lifecycleHelpers.js';
import { CHILD_BRANCH, CHILD_STUBS, CHILD_ID, childReclaimVerb, evalOf, makeChild } from './childReclaimFixture.js';
import { verbHelpers } from './childReclaimVerbHelpers.js';
import { expireAudit, expireEvalOf, makeArchived } from './wsExpireFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-child-reclaim-omission-'); });
afterEach(() => { h.cleanup(); });
const { interrupted, resumeToken, tombOf } = verbHelpers(() => h);

/** git's admin entry for a workspace: `<main>/.git/worktrees/<basename of its tree>`. */
const adminOf = (main: string, slug: string): string => path.join(main, '.git', 'worktrees', slug);
/** Chmod `p` to `mode` for the body, and back to 0755/0644 after, whatever the body did. */
const withMode = <T>(p: string, mode: number, body: () => T): T => {
  const restore = fs.statSync(p).isDirectory() ? 0o755 : 0o644;
  fs.chmodSync(p, mode);
  try { return body(); } finally { fs.chmodSync(p, restore); }
};
/** git's list omits the record although every admin entry reads: the shape no chmod makes, stubbed at its one reader. */
const LIST_OMITS = '_ws_reclaim_record() { RECLAIM_REC_BRANCH=; RECLAIM_REC_HEAD=; RECLAIM_REC_MAIN=0; RECLAIM_REC_PRUNABLE=0; return 1; };';
/** An admin `gitdir` that reads EMPTY (after the matcher's first-line cut). git 2.43 omits the stanza of a truly
 *  empty one with exit 0, as it omits an unreadable one (measured); a lone newline it lists with an empty path. */
const emptyGitdir = (main: string, slug: string, body = ''): void => {
  fs.writeFileSync(path.join(adminOf(main, slug), 'gitdir'), body);
};
const EMPTY_BODIES: [string, string][] = [['empty (`: >`)', ''], ['a lone newline', '\n']];

describe('the ladder’s record check, over a STANDING tree', () => {
  it('the CONTROL: git lists the record, so the child is reclaimable', () => {
    makeChild(h);
    expect(evalOf(h).verdict).toBe('reclaimable');
  }, 60_000);

  it('the admin entry’s gitdir is unreadable: git omits it, and the ladder answers unmeasured — never no-worktree-record', () => {
    const { main } = makeChild(h);
    const r = withMode(path.join(adminOf(main, 'quiet-basin'), 'gitdir'), 0o000, () => evalOf(h));
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.token).toBe('');
    expect(r.detail).toContain('gitdir cannot be read');
  }, 60_000);

  it.each(EMPTY_BODIES)('the admin entry’s gitdir reads %s: unmeasured, as an unreadable one — never no-worktree-record', (_label, body) => {
    const { main } = makeChild(h);
    emptyGitdir(main, 'quiet-basin', body);
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.token).toBe('');
    expect(r.detail).toContain('gitdir is empty, and git');
  }, 60_000);

  it('worktrees/ cannot be listed: git omits every linked record, and the ladder answers unmeasured', () => {
    const { main } = makeChild(h);
    const r = withMode(path.join(main, '.git', 'worktrees'), 0o000, () => evalOf(h));
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.detail).toContain('cannot be listed');
  }, 60_000);

  it('an entry that reads and names the tree, while git’s list printed none: unmeasured — git omitted a record that exists', () => {
    makeChild(h);
    const r = evalOf(h, { pre: LIST_OMITS });
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.detail).toContain('omitted a record that exists');
  }, 60_000);

  it('the STANDING arm with its admin HEAD at mode 000 mints nothing: unmeasured before the record HEAD is read', () => {
    // Spec §5.5. git lists this record as `HEAD 0000…` with no branch line, but
    // the standing arm takes its HEAD from `rev-parse` inside the tree, and
    // that cannot resolve the tree's repository, so no zero id reaches a token.
    const { main } = makeChild(h);
    const r = withMode(path.join(adminOf(main, 'quiet-basin'), 'HEAD'), 0o000, () => evalOf(h));
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.token).toBe('');
    expect(r.detail).toContain("git cannot resolve the directory's repository");
  }, 60_000);

  it('the TERMINAL word stands where nothing names the tree: the admin entry is gone, every other entry read', () => {
    const { main } = makeChild(h);
    fs.rmSync(adminOf(main, 'quiet-basin'), { recursive: true, force: true });
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('no-worktree-record');
  }, 60_000);

  it('the audit journals the unmeasured answer as a failed probe-unmeasured line (retried), never the terminal refusal', () => {
    const { main } = makeChild(h);
    const r = withMode(path.join(adminOf(main, 'quiet-basin'), 'gitdir'), 0o000,
      () => h.run(`${CHILD_STUBS} _session_verdict() { echo gone; }; cmd_ws_audit --session ${CHILD_ID} --reclaim`));
    expect(r.code, r.stdout).toBe(1);
    expect((JSON.parse(r.stdout) as Record<string, unknown>)['verdict']).toBe('unmeasured');
    expect(eventsOf(h.home, 'reclaim').map((e) => [e['outcome'], e['refusal'], e['verb']]))
      .toEqual([['failed', 'probe-unmeasured', 'ws-audit']]);
  }, 60_000);
});

describe('the vanished arm: "no record" proceeds there, so it takes the same ask', () => {
  it('the CONTROL: a gone tree git still records (prunable) is reclaimable over what is left', () => {
    const { wt } = makeChild(h);
    fs.rmSync(wt, { recursive: true, force: true });
    expect(evalOf(h).verdict).toBe('reclaimable');
  }, 60_000);

  it('a gone tree whose admin gitdir is unreadable: unmeasured — today it read reclaimable with record=1', () => {
    const { main, wt } = makeChild(h);
    fs.rmSync(wt, { recursive: true, force: true });
    const r = withMode(path.join(adminOf(main, 'quiet-basin'), 'gitdir'), 0o000, () => evalOf(h));
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.token).toBe('');
  }, 60_000);

  it('a gone tree whose admin gitdir reads EMPTY: unmeasured, and no token is minted — head=\'\' is never bound', () => {
    const { main, wt } = makeChild(h);
    fs.rmSync(wt, { recursive: true, force: true });
    emptyGitdir(main, 'quiet-basin');
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.token).toBe('');
    expect(r.detail).toContain('gitdir is empty');
    const a = h.run(`${CHILD_STUBS} _session_verdict() { echo gone; }; cmd_ws_audit --session ${CHILD_ID} --reclaim`);
    expect(a.code, a.stdout + a.stderr).toBe(1);
    const doc = JSON.parse(a.stdout) as Record<string, unknown>;
    expect(doc['verdict']).toBe('unmeasured');
    expect(doc['token'], 'the audit prints no token').toBeUndefined();
  }, 60_000);

  it('a gone tree with worktrees/ unlistable: unmeasured', () => {
    const { main, wt } = makeChild(h);
    fs.rmSync(wt, { recursive: true, force: true });
    const r = withMode(path.join(main, '.git', 'worktrees'), 0o000, () => evalOf(h));
    expect(r.verdict, r.detail).toBe('unmeasured');
  }, 60_000);

  it('a gone tree whose record git lists with the all-zero HEAD (its admin HEAD unreadable): unmeasured, never pinned', () => {
    const { main, wt } = makeChild(h);
    fs.rmSync(wt, { recursive: true, force: true });
    const r = withMode(path.join(adminOf(main, 'quiet-basin'), 'HEAD'), 0o000, () => evalOf(h));
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.token).toBe('');
    expect(r.detail).toContain('all-zero HEAD');
  }, 60_000);

  it('a gone tree whose HEAD names a branch that no longer exists (git lists the all-zero HEAD with its branch line): unmeasured, never pinned', () => {
    const { main, wt } = makeChild(h);
    fs.rmSync(wt, { recursive: true, force: true });
    h.git(main, 'update-ref', '-d', `refs/heads/${CHILD_BRANCH}`);
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.token).toBe('');
    expect(r.detail).toContain('all-zero HEAD');
    expect(r.detail).toContain('names a branch that no longer exists');
  }, 60_000);

  it('a gone tree git truly no longer records (pruned), every entry read: still reclaimable', () => {
    const { main, wt } = makeChild(h);
    fs.rmSync(wt, { recursive: true, force: true });
    h.git(main, 'worktree', 'prune');
    expect(evalOf(h).verdict).toBe('reclaimable');
  }, 60_000);
});

describe('`_ws_reclaim_log_of`’s gone arm asks the SAME walk it always did', () => {
  it('a gone checkout whose admin gitdir is unreadable fails to locate its reflog (rc 1)', () => {
    const { main, wt } = makeChild(h);
    fs.rmSync(wt, { recursive: true, force: true });
    const out = withMode(path.join(adminOf(main, 'quiet-basin'), 'gitdir'), 0o000,
      () => h.sh(`_WS_LOGS=(); _ws_reclaim_log_of "${main}" tree "${wt}" 0; printf '%s' "$?"`));
    expect(out).toBe('1');
  }, 60_000);

  it('a gone checkout whose admin gitdir reads EMPTY fails to locate its reflog too (rc 1): the ONE matcher', () => {
    const { main, wt } = makeChild(h);
    fs.rmSync(wt, { recursive: true, force: true });
    emptyGitdir(main, 'quiet-basin');
    const [rc = '', why = ''] = h.sh(`_WS_LOGS=(); _ws_reclaim_log_of "${main}" tree "${wt}" 0; printf '%s\\x1f%s' "$?" "$_WS_KEEP_WHY"`)
      .split('\x1f');
    expect(rc).toBe('1');
    expect(why).toContain('gitdir is empty');
  }, 60_000);
});

describe('ws-expire runs the same ladder, so it answers the same', () => {
  it('an archived workspace whose admin gitdir is unreadable: expiry unmeasured (exit 1, journaled nowhere), never no-worktree-record', () => {
    const { main } = makeArchived(h);
    const gitdir = path.join(adminOf(main, 'quiet-dune'), 'gitdir');
    const r = withMode(gitdir, 0o000, () => expireEvalOf(h));
    expect(r.verdict, r.detail).toBe('unmeasured');
    const a = withMode(gitdir, 0o000, () => expireAudit(h));
    expect(a.code, a.stdout).toBe(1);
    expect((JSON.parse(a.stdout) as Record<string, unknown>)['verdict']).toBe('unmeasured');
    expect(eventsOf(h.home, 'expire'), 'an expiry’s unmeasured answer is journaled nowhere').toEqual([]);
  }, 90_000);

  it('an archived workspace whose admin gitdir reads EMPTY: expiry unmeasured (exit 1, journaled nowhere), never no-worktree-record', () => {
    const { main } = makeArchived(h);
    emptyGitdir(main, 'quiet-dune');
    const r = expireEvalOf(h);
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.detail).toContain('gitdir is empty');
    const a = expireAudit(h);
    expect(a.code, a.stdout).toBe(1);
    expect((JSON.parse(a.stdout) as Record<string, unknown>)['verdict']).toBe('unmeasured');
    expect(eventsOf(h.home, 'expire'), 'an expiry’s unmeasured answer is journaled nowhere').toEqual([]);
  }, 90_000);
});

describe('the tail’s compare-and-swap never takes the all-zero id as its old value (spec §5.6)', () => {
  // `git update-ref -d --no-deref <ref> <forty zeros>` exits 0 and DELETES the
  // ref whatever it names (measured, git 2.43): the all-zero old value is no
  // compare at all. The tail reads both values it deletes a branch at from the
  // TOMBSTONE, a file on disk; so a recorded value that is the all-zero id is
  // unmeasured, and the tail stops before anything further is deleted.
  const ZERO = '0'.repeat(40);

  it('a tombstone whose tip is the all-zero id: failed branch-unmeasured, and the branch stands unmoved', () => {
    // At the branch step the tree is already gone — the earlier attempt's step
    // (4) removed it with its record — so nothing holds the branch, and the
    // next act would be the compare-and-swap itself.
    const c = makeChild(h);
    interrupted(c, 'branch');
    expect(tombOf()['tip'], 'the CONTROL: the pin recorded the branch tip').toBe(c.tip);
    h.git(c.main, 'worktree', 'remove', '--force', c.wt);
    h.sh(`_ws_tombstone_patch ${CHILD_ID} '${JSON.stringify({ tip: ZERO })}'`);
    const r = childReclaimVerb(h, resumeToken('branch'));
    expect(h.git(c.main, 'rev-parse', '--verify', '--quiet', `refs/heads/${CHILD_BRANCH}`), 'the branch stands, unmoved').toBe(c.tip);
    expect(h.reg(CHILD_ID, 'uuid'), 'the registry row stands').not.toBeNull();
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('branch-unmeasured');
    expect(o.detail).toContain('all-zero id');
    expect(o.detail).toContain(CHILD_BRANCH);
    expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays at the branch step').toBe('reclaim:branch');
    expect(eventsOf(h.home, 'reclaim').filter((e) => e['outcome'] === 'failed').map((e) => e['refusal']))
      .toEqual(['branch-unmeasured']);
  }, 90_000);

  it('a nested line whose recorded head is the all-zero id: failed branch-unmeasured, the nested branch and the child’s tree stand', () => {
    const c = makeChild(h);
    const inner = path.join(c.wt, 'inner');
    h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
    const nestedTip = h.git(c.main, 'rev-parse', 'refs/heads/ws/nested');
    interrupted(c, 'children');
    const line = (tombOf()['children'] as string[]).find((l) => l.split('\t')[1] === 'ws/nested')!;
    expect(line, 'the CONTROL: the pin recorded the nested line').toBeDefined();
    h.sh(`_ws_tombstone_patch ${CHILD_ID} '${JSON.stringify({ children: [`${line.split('\t')[0]}\tws/nested\t${ZERO}`] })}'`);
    fs.rmSync(inner, { recursive: true, force: true });     // so the settle has no head to re-record
    const r = childReclaimVerb(h, resumeToken('children'));
    expect(h.git(c.main, 'rev-parse', '--verify', '--quiet', 'refs/heads/ws/nested'), 'the nested branch stands, unmoved').toBe(nestedTip);
    expect(fs.existsSync(path.join(c.wt, 'f1.txt')), 'the child’s tree stands').toBe(true);
    expect(fs.existsSync(adminOf(c.main, 'inner')), 'git’s admin record of the nested line stands').toBe(true);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('branch-unmeasured');
    expect(o.detail).toContain('all-zero id');
    expect(o.detail).toContain('ws/nested');
    expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays at the children step').toBe('reclaim:children');
  }, 90_000);
});
