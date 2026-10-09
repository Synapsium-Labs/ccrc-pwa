// The moved-tree question asked where no ladder runs first: a RESUMED tail,
// and a sibling's own interrupted reclaim (child reclamation wave 6, spec §5.5
// and §5.6). The removal helper asks it at the instant of removal, so a tail
// entering at `reclaim:artifacts` or `expire:artifacts` keeps a leaf holding
// another session's tree exactly as a fresh one does. Two children's own
// scratch checkouts never hold each other, and a leaf the scan cannot measure
// is kept `unmeasured` while the act completes.
// FIXTURE HOMES ONLY (`makePrHarness`): the unit and the pane are stubbed
// (`CHILD_STUBS`, `EXP_STUBS`); every repository, row and leaf is under the HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { WS_ADD } from './ccdWsHelpers.js';
import { eventsOf, measOf } from './lifecycleHelpers.js';
import { inheritedEnv } from './gitEnvStrip.js';
import {
  CHILD_BRANCH, CHILD_ENV, CHILD_ID, CHILD_RUN, CHILD_STUBS, evalOf, makeChild, type Child,
} from './childReclaimFixture.js';
import { EXP_BRANCH, EXP_ID, EXP_STUBS, expireVerb, makeArchived, type Archived } from './wsExpireFixture.js';

let h: PrHarness;
let restore: [string, number][] = [];
beforeEach(() => { h = makePrHarness('ccrc-leaf-moved-res-'); restore = []; });
afterEach(() => {
  for (const [p, m] of restore.reverse()) { try { fs.chmodSync(p, m); } catch { /* gone */ } }
  h.cleanup();
});
const ROOT_USER = process.getuid?.() === 0;

const WAIT = 'CCD_RECLAIM_TMPROOT_WAIT_S=2;';
const SIB = 'demo-still-harbor';
type Doc = Record<string, unknown>;
type Run = { code: number; stdout: string; stderr: string };
const tmpOf = (id: string): string => path.join(h.home, '.cc-tmp', id);
const clipsOf = (id: string): string => path.join(h.home, '.cc-clips', id);
const tombOf = (id: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(h.home, '.cc-sessions', '.reaped', `${id}.json`), 'utf8')) as Record<string, unknown>;
const verbAs = (id: string, token: string, pre = ''): Run =>
  h.run(`${CHILD_STUBS} ${WAIT} ${pre} ${CHILD_ENV} cmd_ws_reclaim --expect ${token} --child-of ${CHILD_RUN} --session ${id}`);
const tokenOf = (id: string): string =>
  h.sh(`${CHILD_STUBS} _ws_reclaim_eval ${id} 0 '' >/dev/null; printf '%s' "$REAP_TOKEN"`);
const resumeTokenOf = (id: string, phase: string): string =>
  h.sh(`${CHILD_STUBS} _ws_reclaim_resume_eval ${id} 0 ${CHILD_RUN} ${phase} >/dev/null; printf '%s' "$REAP_TOKEN"`);
const doneOf = (act: string, id: string): Record<string, unknown> =>
  eventsOf(h.home, act).find((e) => e['outcome'] === 'done' && e['id'] === id)
  ?? eventsOf(h.home, act).filter((e) => e['outcome'] === 'done').pop()!;

interface Other { main: string; wt: string }
const foreign = (): Other => {
  const main = h.makeGhRepo('demo2', 'o/r2');
  h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-ridge cmd_ws_add demo2`);
  const wt = path.join(h.home, 'worktrees', 'demo2', 'quiet-ridge');
  fs.writeFileSync(path.join(wt, 'precious.txt'), 'uncommitted work of the other session\n');
  return { main, wt };
};
const park = (wt: string, dest: string): void => {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(wt, dest);
};

/** A reclaim of `id` (a child of run 7) interrupted at `reclaim:artifacts`: pinned, tombstoned
 *  (`worktree: present`), and the tail's steps 4 and 5 done — its tree and its branch gone. */
const interruptedAtArtifacts = (id: string, wt: string, main: string, branch: string): void => {
  h.sh(`${CHILD_STUBS} export ${CHILD_ENV}; _ws_reclaim_eval ${id} 0 ${CHILD_RUN} >/dev/null`
    + ` && _ws_reclaim_pin ${id} "${wt}" "${main}" "$REAP_BRANCH" ${CHILD_RUN}`
    + ` && _ws_tombstone ${id} '[]' "$(_ws_reclaim_tomb_fields ${CHILD_RUN} present)" >/dev/null`
    + ` && _reg_set ${id} reaping reclaim:artifacts`);
  expect(h.reg(id, 'reaping'), `the CONTROL: ${id} carries the breadcrumb`).toBe('reclaim:artifacts');
  h.git(main, 'worktree', 'remove', '--force', wt);
  h.git(main, 'update-ref', '-d', `refs/heads/${branch}`);
};
/** The leaf's own scratch: a clone, and a linked worktree of the child's own repository. */
const scratch = (leaf: string, main: string, tag: string): void => {
  const origin = path.join(h.home, 'origins', 'up.git');
  if (!fs.existsSync(origin)) h.makeRepo('up');
  execFileSync('git', ['clone', '-q', origin, path.join(leaf, 'clone')], { env: { ...inheritedEnv(), HOME: h.home } });
  h.git(main, 'worktree', 'add', '-q', '-b', `scratch-${tag}`, path.join(leaf, 'scratch-wt'));
};

describe('lens row #98: a sibling interrupted at `reclaim:branch`, its tree moved into C’s temp root', () => {
  it('the sibling is resumed to completion, then C is reclaimed — the sibling’s late file still stands', () => {
    const c: Child = makeChild(h);
    h.sh(`${WS_ADD} CCD_WS_SLUG=still-harbor cmd_ws_add --child ${CHILD_RUN} demo`);
    const swt = path.join(h.home, 'worktrees', 'demo', 'still-harbor');
    fs.writeFileSync(path.join(swt, 'committed.txt'), 'x\n');
    h.git(swt, 'add', 'committed.txt'); h.git(swt, 'commit', '-q', '-m', 'sib work');
    h.sh(`_child_tmpdir ${CHILD_ID} >/dev/null`);
    const dest = path.join(tmpOf(CHILD_ID), 'parked', 'still-harbor');
    const mainTip = h.git(c.main, 'rev-parse', 'main');
    // At S's own tail: its tree is MOVED into C (with a file written after the pin), and its branch
    // moves, so S's step 4 clears git's record of the missing tree and its step 5 stops `branch-moved`.
    const hook = `_ws_unsupervise() { echo "unsupervise $*" >> "$HOME/ccd-calls"; mkdir -p "${path.dirname(dest)}";`
      + ` echo late > "${swt}/sib-late-work.txt"; mv "${swt}" "${dest}";`
      + ` command git -C "${c.main}" update-ref refs/heads/ws/still-harbor ${mainTip}; };`;
    const rs = verbAs(SIB, tokenOf(SIB), hook);
    expect(rs.code, rs.stdout + rs.stderr).toBe(1);
    expect((JSON.parse(rs.stdout) as Doc)['failed'], 'the CONTROL: S stopped at its branch step').toBe('branch-moved');
    expect(h.reg(SIB, 'reaping')).toBe('reclaim:branch');
    expect(fs.existsSync(path.join(dest, 'sib-late-work.txt')), 'the CONTROL: S’s tree stands in C’s temp root').toBe(true);
    // S resumed to completion: its branch back at the tip its pin recorded.
    h.git(c.main, 'update-ref', 'refs/heads/ws/still-harbor', String(tombOf(SIB)['tip']));
    const rr = verbAs(SIB, resumeTokenOf(SIB, 'branch'));
    expect(rr.code, rr.stdout + rr.stderr).toBe(0);
    expect((JSON.parse(rr.stdout) as Doc)['reclaimed'], 'the CONTROL: S completed').toBe(SIB);
    // Then C.
    const e = evalOf(h);
    expect(e.verdict, e.detail).toBe('reclaimable');
    const r = verbAs(CHILD_ID, e.token);
    expect(fs.existsSync(path.join(dest, 'sib-late-work.txt')), 'the sibling’s late file is gone').toBe(true);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const doc = JSON.parse(r.stdout) as Doc;
    expect(doc['reclaimed']).toBe(CHILD_ID);
    expect(doc['tmpRootKept']).toBe('refused');
    expect(measOf(doneOf('reclaim', CHILD_ID))['tmpRootKept']).toBe('refused');
  }, 300_000);
});

describe('a RESUMED tail asks it too, entering at artifacts', () => {
  it('`reclaim:artifacts`: a foreign tree in the temp root is kept `refused`, and the act completes', () => {
    const c = makeChild(h);
    const o = foreign();
    h.sh(`_child_tmpdir ${CHILD_ID} >/dev/null`);
    interruptedAtArtifacts(CHILD_ID, c.wt, c.main, CHILD_BRANCH);
    const dest = path.join(tmpOf(CHILD_ID), 'parked', 'quiet-ridge');
    park(o.wt, dest);
    const tok = resumeTokenOf(CHILD_ID, 'artifacts');
    expect(tok, 'the CONTROL: a resume token').toMatch(/^[0-9a-f]{64}$/);
    const r = verbAs(CHILD_ID, tok);
    expect(fs.existsSync(path.join(dest, 'precious.txt')), 'precious gone').toBe(true);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const doc = JSON.parse(r.stdout) as Doc;
    expect(doc['reclaimed']).toBe(CHILD_ID);
    expect(doc['tmpRootKept']).toBe('refused');
    expect(measOf(doneOf('reclaim', CHILD_ID))['tmpRootKept']).toBe('refused');
  }, 180_000);

  it('`expire:artifacts`: a foreign tree in the archived workspace’s clips is kept `refused`, and the act completes', () => {
    const a: Archived = makeArchived(h);
    const o = foreign();
    h.sh(`${EXP_STUBS} _WS_RCL_ACT=expire; _ws_expire_eval ${EXP_ID} >/dev/null`
      + ` && _ws_reclaim_pin ${EXP_ID} "${a.wt}" "${a.main}" "$REAP_BRANCH" "$EXPIRE_ARCHIVED_AT"`
      + ` && _ws_tombstone ${EXP_ID} '[]' "$(_ws_reclaim_tomb_fields "$EXPIRE_ARCHIVED_AT" present)" >/dev/null`
      + ` && _reg_set ${EXP_ID} reaping expire:artifacts`);
    expect(h.reg(EXP_ID, 'reaping')).toBe('expire:artifacts');
    h.git(a.main, 'worktree', 'remove', '--force', a.wt);
    h.git(a.main, 'update-ref', '-d', `refs/heads/${EXP_BRANCH}`);
    const dest = path.join(clipsOf(EXP_ID), 'parked', 'quiet-ridge');
    park(o.wt, dest);
    const tok = h.sh(`${EXP_STUBS} _WS_RCL_ACT=expire; _ws_expire_resume_eval ${EXP_ID} artifacts >/dev/null; printf '%s' "$REAP_TOKEN"`);
    expect(tok, 'the CONTROL: a resume token').toMatch(/^[0-9a-f]{64}$/);
    const r = expireVerb(h, tok, { pre: WAIT });
    expect(fs.existsSync(path.join(dest, 'precious.txt')), 'precious gone').toBe(true);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const doc = JSON.parse(r.stdout) as Doc;
    expect(doc['expired']).toBe(EXP_ID);
    expect(doc['clipsKept']).toBe('refused');
    expect(measOf(doneOf('expire', EXP_ID))['clipsKept']).toBe('refused');
  }, 180_000);

  it('NO MUTUAL HOLD: two children, each with its own scratch checkouts, both resumed at artifacts — both complete, both leaves gone', () => {
    const c = makeChild(h);
    h.sh(`${WS_ADD} CCD_WS_SLUG=still-harbor cmd_ws_add --child ${CHILD_RUN} demo`);
    const swt = path.join(h.home, 'worktrees', 'demo', 'still-harbor');
    for (const id of [CHILD_ID, SIB]) h.sh(`_child_tmpdir ${id} >/dev/null`);
    scratch(tmpOf(CHILD_ID), c.main, 'c');
    scratch(tmpOf(SIB), c.main, 's');
    interruptedAtArtifacts(CHILD_ID, c.wt, c.main, CHILD_BRANCH);
    interruptedAtArtifacts(SIB, swt, c.main, 'ws/still-harbor');
    for (const id of [CHILD_ID, SIB]) {
      const tok = resumeTokenOf(id, 'artifacts');
      expect(tok, `the CONTROL: ${id} has a resume token`).toMatch(/^[0-9a-f]{64}$/);
      const r = verbAs(id, tok);
      expect(r.code, `${id}: ${r.stdout}${r.stderr}`).toBe(0);
      const doc = JSON.parse(r.stdout) as Doc;
      expect(doc['reclaimed']).toBe(id);
      expect(doc['tmpRootKept'], `${id}: nothing kept`).toBeNull();
      expect(fs.existsSync(tmpOf(id)), `${id}: its temp root went`).toBe(false);
    }
  }, 300_000);
});

describe('a leaf the scan cannot measure is kept `unmeasured` while the act completes', () => {
  it.skipIf(ROOT_USER)('a mode-000 directory in the temp root', () => {
    makeChild(h);
    h.sh(`_child_tmpdir ${CHILD_ID} >/dev/null`);
    const locked = path.join(tmpOf(CHILD_ID), 'locked');
    fs.mkdirSync(locked);
    fs.writeFileSync(path.join(locked, 'x'), 'x');
    restore.push([locked, 0o755]);
    fs.chmodSync(locked, 0o000);
    const r = verbAs(CHILD_ID, evalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const doc = JSON.parse(r.stdout) as Doc;
    expect(doc['reclaimed']).toBe(CHILD_ID);
    expect(doc['tmpRootKept']).toBe('unmeasured');
    const done = doneOf('reclaim', CHILD_ID);
    expect(measOf(done)['tmpRootKept']).toBe('unmeasured');
    expect(String(done['detail'])).toContain('could not read all of');
    expect(fs.existsSync(locked), 'the temp root stands').toBe(true);
    expect((fs.statSync(locked).mode & 0o777).toString(8), 'the permission pass never ran').toBe('0');
  }, 120_000);

  it('a scan that outruns a lowered REAP_SCAN_SECONDS (a real `find` that hangs, killed by the bound)', () => {
    makeChild(h);
    h.sh(`_child_tmpdir ${CHILD_ID} >/dev/null`);
    fs.mkdirSync(path.join(tmpOf(CHILD_ID), 'cdk.out'));
    const realFind = execFileSync('sh', ['-c', 'command -v find'], { encoding: 'utf8', env: inheritedEnv() }).trim();
    const shim = path.join(h.home, 'shim');
    fs.mkdirSync(shim);
    fs.writeFileSync(path.join(shim, 'find'), `#!/bin/sh\ncase " $* " in *" -xdev "*" .git "*) exec sleep 30 ;; esac\nexec '${realFind}' "$@"\n`,
      { mode: 0o755 });
    const tok = evalOf(h).token;
    // Lowered at the tail's first act, so the ladder's own scans keep their bound.
    const hook = '_ws_unsupervise() { echo "unsupervise $*" >> "$HOME/ccd-calls"; REAP_SCAN_SECONDS=1; CCD_TIMEOUT_KILL_AFTER=2; };';
    const r = verbAs(CHILD_ID, tok, `PATH="${shim}:$PATH"; hash -r; ${hook}`);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const doc = JSON.parse(r.stdout) as Doc;
    expect(doc['reclaimed']).toBe(CHILD_ID);
    expect(doc['tmpRootKept']).toBe('unmeasured');
    expect(String(doneOf('reclaim', CHILD_ID)['detail'])).toContain('did not finish within 1s');
    expect(fs.existsSync(path.join(tmpOf(CHILD_ID), 'cdk.out')), 'the temp root stands').toBe(true);
  }, 120_000);
});
