// C13's reach to ANOTHER admin entry (path-identity spec §3.9, item 34; child reclamation spec §5.5, rung 8's rule:
// a read that failed measured nothing). `_ws_reclaim_admin_entries`, the ONE matcher of git's admin entries to a path,
// tests each entry's `gitdir` for a blank first line BEFORE it compares that entry with the path. So one blank entry
// anywhere in a repository's `worktrees/` makes every walk of that repository answer "never asked": the matcher
// cannot tell whether the blank entry was the path's record. Two walks reach it:
//   - the gone walk (`_ws_reclaim_log_of`'s absent arm), which the vanished arm's PIN runs. The verb stops
//     `pin-failed` before the tombstone, the breadcrumb or any delete, while the ladder, which never walks a record
//     git listed, still mints its token: the stated residual `corrupt-admin-entry-holds-the-repository`;
//   - the ladder's "no record" ask (`_ws_reclaim_no_record`), when git's list printed no record of the tree.
// A STANDING child whose own record git lists runs neither walk. `ccd-child-reclaim-silent-omission.test.ts` pins a
// blank OWN entry; this file pins a blank SIBLING beside an intact own entry.
// FIXTURE HOMEs ONLY (`makePrHarness`): every ccd call runs through the harness, never against $HOME. The unit and the
// pane are stubbed (`CHILD_STUBS`, inside `evalOf` and `childReclaimVerb`), and so is the /proc walk (`NOBODY`).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CHILD_BRANCH, CHILD_ID, childReclaimVerb, evalOf, makeChild } from './childReclaimFixture.js';
import { verbHelpers } from './childReclaimVerbHelpers.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-child-reclaim-sibling-'); });
afterEach(() => { h.cleanup(); });
const { unsupervised } = verbHelpers(() => h);

/** git's admin entry for a checkout: `<main>/.git/worktrees/<basename of its tree>`. */
const adminOf = (main: string, slug: string): string => path.join(main, '.git', 'worktrees', slug);
/** An admin `gitdir` rewritten with `body`. */
const emptyGitdir = (main: string, slug: string, body: string): void => {
  fs.writeFileSync(path.join(adminOf(main, slug), 'gitdir'), body);
};
/** A first line that names NO PATH: empty, or blank once git right-trims it. */
const EMPTY_BODIES: [string, string][] = [
  ['empty (`: >`)', ''], ['a lone newline', '\n'], ['spaces', '   '], ['a space and a newline', ' \n'], ['a tab', '\t'],
  ['a blank first line over a second', '\nnot-a-path\n'], ['a carriage return and a newline', '\r\n'],
];
const NAMES_NO_PATH = 'gitdir names no path on its first line';
/** git's list omits the record although every admin entry reads: stubbed at its one reader. */
const LIST_OMITS = '_ws_reclaim_record() { RECLAIM_REC_BRANCH=; RECLAIM_REC_HEAD=; RECLAIM_REC_MAIN=0; RECLAIM_REC_PRUNABLE=0; return 1; };';
/** No process uses any path: the tail's /proc walk, stubbed, so no case here shells it. */
const NOBODY = '_ws_path_users() { _WS_PATH_USERS_PIDS=""; _WS_PATH_USERS_WHY=""; return 0; };';
const SIBLING_BRANCH = 'ws/other';

/** A sibling checkout of the child's OWN repository, at `<HOME>/worktrees/demo/other` on `ws/other`. git names its
 *  admin entry `other`. Answers its path. */
const addSibling = (main: string): string => {
  const other = path.join(h.home, 'worktrees', 'demo', 'other');
  h.git(main, 'worktree', 'add', '-q', '-b', SIBLING_BRANCH, other);
  return other;
};
/** `_ws_reclaim_log_of`'s walk of a gone tree, asked as the vanished arm's pin asks it (`recorded` 1). */
const walk = (main: string, wt: string): { rc: string; why: string; logs: string[] } => {
  const [rc = '', why = '', logs = ''] = h.sh(`_WS_LOGS=(); _WS_KEEP_WHY=''; _ws_reclaim_log_of '${main}' tree '${wt}' 1;`
    + ' printf \'%s\\x1f%s\\x1f\' "$?" "$_WS_KEEP_WHY"; printf \'%s\\n\' ${_WS_LOGS[@]+"${_WS_LOGS[@]}"}').split('\x1f');
  return { rc, why, logs: logs.split('\n').filter(Boolean) };
};
/** `_ws_reclaim_no_record`'s answer, its reason uncut. */
const noRecord = (main: string, wt: string): { rc: string; why: string } => {
  const [rc = '', why = ''] = h.sh(`_ws_reclaim_no_record "$(_ws_common_dir '${main}')" '${wt}';`
    + ' printf \'%s\\x1f%s\' "$?" "$_WS_NOREC_WHY"').split('\x1f');
  return { rc, why };
};

describe('a blank SIBLING admin entry holds every gone walk of its repository (item 34)', () => {
  it('the CONTROL: an intact sibling, the child’s tree gone: the walk finds the child’s own entry alone, the ladder mints, and the verb reclaims without touching the sibling', () => {
    const { main, wt } = makeChild(h);
    const other = addSibling(main);
    const siblingGitdir = fs.readFileSync(path.join(adminOf(main, 'other'), 'gitdir'), 'utf8');
    const siblingTip = h.git(main, 'rev-parse', `refs/heads/${SIBLING_BRANCH}`);
    fs.rmSync(wt, { recursive: true, force: true });
    const w = walk(main, wt);
    expect(w.rc, w.why).toBe('0');
    expect(w.logs).toEqual([path.join(adminOf(main, 'quiet-basin'), 'logs', 'HEAD'), `gitdir:${adminOf(main, 'quiet-basin')}`]);
    const e = evalOf(h);
    expect(e.verdict, e.detail).toBe('reclaimable');
    const r = childReclaimVerb(h, e.token, { pre: NOBODY });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect((JSON.parse(r.stdout) as Record<string, unknown>)['reclaimed']).toBe(CHILD_ID);
    expect(fs.existsSync(other), 'the sibling’s tree stands').toBe(true);
    expect(h.git(main, 'rev-parse', `refs/heads/${SIBLING_BRANCH}`), 'the sibling’s branch stands').toBe(siblingTip);
    expect(fs.readFileSync(path.join(adminOf(main, 'other'), 'gitdir'), 'utf8'), 'the sibling’s admin entry stands')
      .toBe(siblingGitdir);
  }, 120_000);

  it('the CONTROL: an intact sibling, and git’s list omits the standing child’s record: unmeasured, naming the child’s own entry', () => {
    const { main, wt } = makeChild(h);
    addSibling(main);
    const e = evalOf(h, { pre: LIST_OMITS });
    expect(e.verdict, e.detail).toBe('unmeasured');
    expect(e.token).toBe('');
    expect(e.detail).toMatch(/^git's worktree list omitted a record that exists: /);
    const n = noRecord(main, wt);
    expect(n.rc).toBe('1');
    expect(n.why).toBe(`git's worktree list omitted a record that exists: it printed no record of ${wt},`
      + ` but ${adminOf(main, 'quiet-basin')} names ${wt}/.git`);
  }, 60_000);

  it.each(EMPTY_BODIES)('the SIBLING’s gitdir reads %s, the child’s own entry intact, its tree gone: the walk is never asked, the ladder still mints, and the pin refuses with nothing destroyed', (_label, body) => {
    const { main, wt, tip } = makeChild(h);
    addSibling(main);
    fs.rmSync(wt, { recursive: true, force: true });
    emptyGitdir(main, 'other', body);
    const lead = `${adminOf(main, 'other')}/${NAMES_NO_PATH}`;
    // The gone walk, as the pin asks it: the blank sibling answers before the child's own entry is compared.
    const w = walk(main, wt);
    expect(w.rc, w.why).toBe('1');
    expect(w.why.startsWith(lead), w.why).toBe(true);
    // The ladder never walks a record git listed, so it mints (`corrupt-admin-entry-holds-the-repository`) ...
    const e = evalOf(h);
    expect(e.verdict, e.detail).toBe('reclaimable');
    // ... and the pin refuses that token, before the tombstone, the breadcrumb or any delete.
    const r = childReclaimVerb(h, e.token, { pre: NOBODY });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('pin-failed');
    expect(o.detail.startsWith(lead), o.detail).toBe(true);
    expect(h.git(main, 'rev-parse', `refs/heads/${CHILD_BRANCH}`), 'the branch stands').toBe(tip);
    expect(h.reg(CHILD_ID, 'uuid'), 'the registry row stands').not.toBeNull();
    expect(h.reg(CHILD_ID, 'reaping'), 'no breadcrumb').toBeNull();
    expect(unsupervised(), 'the unit was not touched').toEqual([]);
    expect(fs.existsSync(adminOf(main, 'quiet-basin')), 'git’s record of the child stands').toBe(true);
    expect(fs.readFileSync(path.join(adminOf(main, 'other'), 'gitdir'), 'utf8'), 'the sibling’s entry, as it was').toBe(body);
  }, 120_000);

  it.each(EMPTY_BODIES)('the SIBLING’s gitdir reads %s and git’s list omits the standing child’s record: unmeasured, no token, naming the sibling — never no-worktree-record', (_label, body) => {
    const { main, wt } = makeChild(h);
    addSibling(main);
    emptyGitdir(main, 'other', body);
    const lead = `${adminOf(main, 'other')}/${NAMES_NO_PATH}`;
    const e = evalOf(h, { pre: LIST_OMITS });
    expect(e.verdict, e.detail).toBe('unmeasured');
    expect(e.token).toBe('');
    expect(e.detail.startsWith(lead), e.detail).toBe(true);
    const n = noRecord(main, wt);
    expect(n.rc).toBe('2');
    expect(n.why.startsWith(lead), n.why).toBe(true);
    expect(n.why).toContain(`so its silence about ${wt} measured nothing`);
  }, 60_000);

  it('the STANDING child, its own record listed, beside the same blank sibling: reclaimable — the reach is the gone walk and the no-record ask only', () => {
    const { main } = makeChild(h);
    addSibling(main);
    emptyGitdir(main, 'other', '\n');
    const e = evalOf(h);
    expect(e.verdict, e.detail).toBe('reclaimable');
    expect(e.token).toMatch(/^[0-9a-f]{64}$/);
  }, 60_000);
});
