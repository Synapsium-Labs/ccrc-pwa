// Another session's tree `mv`'d into a child's temp root (`~/.cc-tmp/<id>`) or
// clips directory (`~/.cc-clips/<id>`) is not the child's, and the reclaim's
// tail never removes it with the leaf (child reclamation wave 6, spec §5.5 and
// §5.6). "Inside the child" is all three trees the tail deletes — the worktree,
// the clips directory and the temp root — and git's record of a gone
// workspace places its ROW (spec §5.5's recovery) without saying where its
// TREE went. So the removal helper asks, of every directory leaf, whether it
// holds a checkout git links to somewhere else (`_ws_leaf_checkouts`), and
// keeps a leaf that does: the act still completes, and the done row and the
// done document say what was kept (`refused`). Measured before the fix: the
// tail removed the moved tree, its uncommitted file with it.
// FIXTURE HOMES ONLY (`makePrHarness`): the unit and the pane are stubbed
// (`CHILD_STUBS`); every repository, row and leaf is under the HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { WS_ADD } from './ccdWsHelpers.js';
import { eventsOf, measOf } from './lifecycleHelpers.js';
import {
  CHILD_BRANCH, CHILD_ENV, CHILD_ID, childReclaimVerb, evalOf, makeChild, type LadderAnswer,
} from './childReclaimFixture.js';
import { EXP_ID, EXP_STUBS, expireEvalOf, makeArchived } from './wsExpireFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-leaf-moved-'); });
afterEach(() => { h.cleanup(); });

/** The tail's bounded wait for the temp root's users, kept short: nobody uses a fixture leaf. */
const WAIT = 'CCD_RECLAIM_TMPROOT_WAIT_S=2;';
const FOREIGN = 'demo2-still-harbor';
interface Other { main: string; wt: string; admin: string }
/** A plain workspace of ANOTHER repository, minted by the real ws-add, holding an uncommitted file. */
const foreign = (): Other => {
  const main = h.makeGhRepo('demo2', 'o/r2');
  h.sh(`${WS_ADD} CCD_WS_SLUG=still-harbor cmd_ws_add demo2`);
  const wt = path.join(h.home, 'worktrees', 'demo2', 'still-harbor');
  fs.writeFileSync(path.join(wt, 'precious.txt'), 'uncommitted work of the other session\n');
  return { main, wt, admin: h.git(wt, 'rev-parse', '--absolute-git-dir') };
};
const stanza = (main: string, wt: string): string =>
  h.git(main, 'worktree', 'list', '--porcelain').split('\n\n').find((s) => s.startsWith(`worktree ${wt}\n`)) ?? '';
/** `mv` the other tree to `dest` — git's record of it now reads `prunable`. */
const park = (o: Other, dest: string): void => {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(o.wt, dest);
  expect(stanza(o.main, o.wt), 'the CONTROL: the mv leaves git’s record prunable').toContain('\nprunable');
  expect(h.git(dest, 'rev-parse', '--absolute-git-dir'), 'the CONTROL: the moved tree names the recorded admin dir').toBe(o.admin);
};
const tmpOf = (id: string): string => path.join(h.home, '.cc-tmp', id);
const clipsOf = (id: string): string => path.join(h.home, '.cc-clips', id);
const placed = (r: LadderAnswer, label: string): void => {
  expect(r.verdict, `${label}: ${r.detail}`).toBe('reclaimable');
  expect(r.token, label).toMatch(/^[0-9a-f]{64}$/);
};
const doneRow = (act: string): Record<string, unknown> => eventsOf(h.home, act).find((e) => e['outcome'] === 'done')!;
type Doc = Record<string, unknown>;

/** The act COMPLETED, the child gone, and the leaf `which` kept `refused` — on the done row, in its
 *  detail, and in the done document — with the other session's file standing. */
const keptRefused = (r: { code: number; stdout: string; stderr: string }, precious: string,
  which: 'clipsKept' | 'tmpRootKept', leaf: string): void => {
  expect(fs.existsSync(precious), 'precious gone: the other session’s uncommitted file').toBe(true);
  expect(fs.readFileSync(precious, 'utf8')).toContain('uncommitted');
  expect(r.code, r.stdout + r.stderr).toBe(0);
  const doc = JSON.parse(r.stdout) as Doc;
  expect(doc['reclaimed'], 'the act completed').toBe(CHILD_ID);
  expect(doc[which], 'the done document says the leaf was kept').toBe('refused');
  const done = doneRow('reclaim');
  expect(measOf(done)[which], 'the done row says the leaf was kept').toBe('refused');
  const label = which === 'clipsKept' ? 'clips' : 'temp root';
  expect(String(done['detail'])).toContain(`${label} ${leaf} kept (refused)`);
  expect(String(done['detail'])).toContain('.git');
  expect(h.reg(CHILD_ID, 'uuid'), 'the child’s row is purged').toBeNull();
};

describe('the reviewer’s case (review 335, F1): a foreign workspace with an uncommitted file, moved into a leaf', () => {
  it('into the TEMP ROOT: the reclaim completes, the temp root is kept `refused`, the file stands', () => {
    const c = makeChild(h);
    const o = foreign();
    placed(evalOf(h), 'the CONTROL: with the other tree standing the child is reclaimable');
    h.sh(`_child_tmpdir ${CHILD_ID} >/dev/null`);
    const dest = path.join(tmpOf(CHILD_ID), 'parked', 'still-harbor');
    park(o, dest);
    const e = evalOf(h);
    placed(e, 'the gone row is placed by git’s record');
    const r = childReclaimVerb(h, e.token, { pre: WAIT });
    keptRefused(r, path.join(dest, 'precious.txt'), 'tmpRootKept', tmpOf(CHILD_ID));
    expect(fs.existsSync(c.wt), 'the child’s worktree went').toBe(false);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the child’s branch went').toBe('');
    expect((JSON.parse(r.stdout) as Doc)['clipsKept'], 'nothing else was kept').toBeNull();
  }, 120_000);

  it('into the CLIPS directory: the reclaim completes, the clips directory is kept `refused`, the file stands', () => {
    makeChild(h);
    const o = foreign();
    fs.mkdirSync(clipsOf(CHILD_ID), { recursive: true });
    fs.writeFileSync(path.join(clipsOf(CHILD_ID), 'shot.png'), 'png');
    const dest = path.join(clipsOf(CHILD_ID), 'parked', 'still-harbor');
    park(o, dest);
    const e = evalOf(h);
    placed(e, 'the gone row is placed by git’s record');
    const r = childReclaimVerb(h, e.token, { pre: WAIT });
    keptRefused(r, path.join(dest, 'precious.txt'), 'clipsKept', clipsOf(CHILD_ID));
  }, 120_000);

  it('the clips leaf IS the moved tree (its `.git` at depth 1): kept `refused`', () => {
    makeChild(h);
    const o = foreign();
    fs.mkdirSync(path.join(h.home, '.cc-clips'), { recursive: true });
    park(o, clipsOf(CHILD_ID));
    const e = evalOf(h);
    placed(e, 'the gone row is placed by git’s record');
    const r = childReclaimVerb(h, e.token, { pre: WAIT });
    keptRefused(r, path.join(clipsOf(CHILD_ID), 'precious.txt'), 'clipsKept', clipsOf(CHILD_ID));
  }, 120_000);

  it('the VANISHED-worktree arm: the child’s tree already gone, the moved tree in its temp root — kept `refused`', () => {
    const c = makeChild(h);
    const o = foreign();
    h.sh(`_child_tmpdir ${CHILD_ID} >/dev/null`);
    fs.rmSync(c.wt, { recursive: true, force: true });
    const dest = path.join(tmpOf(CHILD_ID), 'parked', 'still-harbor');
    park(o, dest);
    const e = evalOf(h);
    placed(e, 'the vanished arm, the gone row placed by git’s record');
    const r = childReclaimVerb(h, e.token, { pre: WAIT });
    keptRefused(r, path.join(dest, 'precious.txt'), 'tmpRootKept', tmpOf(CHILD_ID));
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the child’s branch went').toBe('');
  }, 120_000);

  it('the REMOVAL-TIME window: the tree is moved into the temp root after the locked recomputation — kept `refused`', () => {
    makeChild(h);
    const o = foreign();
    h.sh(`_child_tmpdir ${CHILD_ID} >/dev/null`);
    const e = evalOf(h);
    placed(e, 'the CONTROL: nothing is moved yet');
    const dest = path.join(tmpOf(CHILD_ID), 'parked', 'still-harbor');
    // The tail's first act (step 1) is past the verb's in-lock recomputation and its pin.
    const hook = `_ws_unsupervise() { echo "unsupervise $*" >> "$HOME/ccd-calls"; mkdir -p "${path.dirname(dest)}"; mv "${o.wt}" "${dest}"; };`;
    const r = childReclaimVerb(h, e.token, { pre: `${WAIT} ${hook}` });
    expect(fs.existsSync(o.wt), 'the CONTROL: the hook moved the tree away from its own path').toBe(false);
    keptRefused(r, path.join(dest, 'precious.txt'), 'tmpRootKept', tmpOf(CHILD_ID));
  }, 120_000);
});

describe('negative controls: the leaf’s OWN scratch checkouts go with it', () => {
  it('a scratch clone and a scratch linked worktree inside the temp root: reclaimed, the leaf removed, nothing kept', () => {
    const c = makeChild(h);
    h.sh(`_child_tmpdir ${CHILD_ID} >/dev/null`);
    h.makeRepo('up');
    h.git(h.home, 'clone', '-q', path.join(h.home, 'origins', 'up.git'), path.join(tmpOf(CHILD_ID), 'clone'));
    h.git(c.main, 'worktree', 'add', '-q', '-b', 'scratch', path.join(tmpOf(CHILD_ID), 'scratch-wt'));
    const e = evalOf(h);
    placed(e, 'the CONTROL: the scratch is not a registry row');
    const r = childReclaimVerb(h, e.token, { pre: WAIT });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const doc = JSON.parse(r.stdout) as Doc;
    expect(doc['reclaimed']).toBe(CHILD_ID);
    expect(doc['tmpRootKept'], 'nothing kept').toBeNull();
    expect(doc['clipsKept']).toBeNull();
    expect(fs.existsSync(tmpOf(CHILD_ID)), 'the temp root went, its scratch with it').toBe(false);
    expect(measOf(doneRow('reclaim'))).not.toHaveProperty('tmpRootKept');
  }, 120_000);
});

describe('the lens’s controls (review 335, rows #101 and #103) still hold', () => {
  it('#101: the tree mv’d into the temp root with its record LOCKED — no recovery, the child is held, nothing removed', () => {
    makeChild(h);
    const o = foreign();
    const T0 = evalOf(h).token;
    h.sh(`_child_tmpdir ${CHILD_ID} >/dev/null`);
    h.git(o.main, 'worktree', 'lock', o.wt);
    const dest = path.join(tmpOf(CHILD_ID), 'parked', 'still-harbor');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(o.wt, dest);
    const a = evalOf(h);
    expect(a.verdict, a.detail).toBe('unmeasured');
    const r = childReclaimVerb(h, T0, { pre: WAIT });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect((JSON.parse(r.stdout) as Doc)['failed']).toBe('probe-unmeasured');
    expect(fs.readFileSync(path.join(dest, 'precious.txt'), 'utf8')).toContain('uncommitted');
  }, 120_000);

  it('#103: ws-expire, the tree mv’d into the archived workspace’s clips with its record LOCKED — held, nothing removed', () => {
    makeArchived(h);
    const o = foreign();
    const e0 = expireEvalOf(h);
    expect(e0.verdict, e0.detail).toBe('expirable');
    h.git(o.main, 'worktree', 'lock', o.wt);
    const dest = path.join(clipsOf(EXP_ID), 'parked', 'still-harbor');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(o.wt, dest);
    const a = expireEvalOf(h);
    expect(a.verdict, a.detail).toBe('unmeasured');
    const r = h.run(`${EXP_STUBS} ${WAIT} ${CHILD_ENV} cmd_ws_expire --expect ${e0.token} --session ${EXP_ID}`);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect((JSON.parse(r.stdout) as Doc)['failed']).toBe('probe-unmeasured');
    expect(fs.readFileSync(path.join(dest, 'precious.txt'), 'utf8')).toContain('uncommitted');
  }, 120_000);
});
