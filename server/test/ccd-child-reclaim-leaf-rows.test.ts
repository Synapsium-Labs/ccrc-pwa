// A registry row AT, INSIDE or THROUGH a child's temp root or clips directory
// is NESTED (child reclamation wave 6, spec §5.5 and §5.6). The tail deletes
// three trees — the worktree, `~/.cc-clips/<id>` and `~/.cc-tmp/<id>` — so
// `_ws_reclaim_workdir_shared` compares every other row, standing or recovered,
// against all three in ONE registry pass: literally and resolved, equal or
// inside, and through. Such a row refuses with the nested word that already
// exists, `containment-unproven`, at the ladder (reclaim and expire alike) and
// in `_ws_reclaim_owned`. A leaf PROVEN absent is skipped: nothing of it is
// deleted. A leaf whose absence cannot be proven, or that cannot be resolved,
// is unmeasured — never "nobody inside it". Before this, a standing row rooted
// in the child's temp root was taken with the leaf (measured by review 335's lens).
// FIXTURE HOMES ONLY (`makePrHarness`): the unit and the pane are stubbed
// (`CHILD_STUBS`, `EXP_STUBS`); every repository, row and leaf is under the HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { WS_ADD } from './ccdWsHelpers.js';
import {
  CHILD_ID, childReclaimVerb, evalOf, makeChild, type Child, type LadderAnswer,
} from './childReclaimFixture.js';
import { EXP_ID, expireEvalOf, makeArchived } from './wsExpireFixture.js';

let h: PrHarness;
let restore: [string, number][] = [];
beforeEach(() => { h = makePrHarness('ccrc-leaf-rows-'); restore = []; });
afterEach(() => {
  for (const [p, m] of restore.reverse()) { try { fs.chmodSync(p, m); } catch { /* gone */ } }
  h.cleanup();
});
const ROOT_USER = process.getuid?.() === 0;

const ROW = 'demo2-scratch';
const tmpOf = (id: string): string => path.join(h.home, '.cc-tmp', id);
const clipsOf = (id: string): string => path.join(h.home, '.cc-clips', id);
/** A STANDING registry row of another session: its workdir and its project, as `ccd start` writes them. */
const row = (id: string, workdir: string, project = 'demo2'): void => {
  fs.writeFileSync(path.join(h.home, '.cc-sessions', `${id}.workdir`), workdir);
  fs.writeFileSync(path.join(h.home, '.cc-sessions', `${id}.project`), project);
};
const owned = (id: string, c: Child): { rc: string; why: string } => {
  const [rc = '', why = ''] = h.sh(`_ws_reclaim_owned ${id} "${c.wt}" "${c.main}"; printf '%s\\x1f%s' "$?" "$_WS_OWNED_WHY"`)
    .split('\x1f');
  return { rc, why };
};
/** The ladder refuses with EXACTLY the nested word, naming the row; `_ws_reclaim_owned` refuses too. */
const nested = (r: LadderAnswer, rowId: string, label: string): void => {
  expect(r.verdict, `${label}: ${r.detail}`).toBe('containment-unproven');
  expect(r.detail, label).toContain(`registry row(s) ${rowId} rooted inside`);
  expect(r.token, label).toBe('');
};
const placed = (r: LadderAnswer, label: string): void => {
  expect(r.verdict, `${label}: ${r.detail}`).toBe('reclaimable');
  expect(r.token, label).toMatch(/^[0-9a-f]{64}$/);
};

describe('a STANDING row at or inside a leaf is nested', () => {
  it('a row EQUAL to the temp root: the ladder refuses `containment-unproven`, owned refuses, the verb refuses and keeps the leaf', () => {
    const c = makeChild(h);
    h.sh(`_child_tmpdir ${CHILD_ID} >/dev/null`);
    const T0 = evalOf(h).token;
    fs.writeFileSync(path.join(tmpOf(CHILD_ID), 'precious.txt'), 'the other session works here\n');
    row(ROW, tmpOf(CHILD_ID));
    nested(evalOf(h), ROW, 'a row at the temp root');
    const o = owned(CHILD_ID, c);
    expect(o.rc, o.why).toBe('1');
    expect(o.why).toContain(`registry row(s) ${ROW} rooted inside`);
    const r = childReclaimVerb(h, T0, { pre: 'CCD_RECLAIM_TMPROOT_WAIT_S=2;' });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect((JSON.parse(r.stdout) as Record<string, unknown>)['refused']).toBe('containment-unproven');
    expect(fs.existsSync(path.join(tmpOf(CHILD_ID), 'precious.txt'))).toBe(true);
    expect(fs.existsSync(c.wt), 'the child stands').toBe(true);
  }, 120_000);

  it('under ws-expire the ladder answers exactly `containment-unproven` for a row at the archived workspace’s temp root', () => {
    makeArchived(h);
    fs.mkdirSync(tmpOf(EXP_ID), { recursive: true });
    row(ROW, tmpOf(EXP_ID));
    const r = expireEvalOf(h);
    expect(r.verdict, r.detail).toBe('containment-unproven');
    expect(r.detail).toContain(`registry row(s) ${ROW} rooted inside`);
  }, 120_000);

  it('under ws-expire, a row inside the archived workspace’s clips directory: `containment-unproven`', () => {
    makeArchived(h);
    fs.mkdirSync(path.join(clipsOf(EXP_ID), 'wt'), { recursive: true });
    row(ROW, path.join(clipsOf(EXP_ID), 'wt'));
    const r = expireEvalOf(h);
    expect(r.verdict, r.detail).toBe('containment-unproven');
  }, 120_000);

  it('a row strictly inside the temp root by its RESOLVED spelling only (through a link outside the child)', () => {
    makeChild(h);
    h.sh(`_child_tmpdir ${CHILD_ID} >/dev/null`);
    fs.mkdirSync(path.join(tmpOf(CHILD_ID), 'wt'));
    fs.symlinkSync(tmpOf(CHILD_ID), path.join(h.home, 'alias'));
    row(ROW, path.join(h.home, 'alias', 'wt'));
    nested(evalOf(h), ROW, 'a row resolved inside the temp root');
  }, 120_000);

  it('a row spelled THROUGH a link inside the clips directory (it resolves outside, yet its spelling goes with the leaf)', () => {
    makeChild(h);
    fs.mkdirSync(clipsOf(CHILD_ID), { recursive: true });
    fs.mkdirSync(path.join(h.home, 'outside', 'wt'), { recursive: true });
    fs.symlinkSync(path.join(h.home, 'outside'), path.join(clipsOf(CHILD_ID), 'lnk'));
    row(ROW, path.join(clipsOf(CHILD_ID), 'lnk', 'wt'));
    nested(evalOf(h), ROW, 'a row through a link inside clips');
  }, 120_000);
});

describe('a RECOVERED row (its workdir gone) at or inside a leaf', () => {
  it('git’s record places it inside a STANDING temp root (the root a link onto a volume): nested', () => {
    makeChild(h);
    const vol = path.join(h.home, 'vol');
    fs.mkdirSync(path.join(vol, CHILD_ID), { recursive: true });
    fs.symlinkSync(vol, path.join(h.home, '.cc-tmp'));
    const main2 = h.makeGhRepo('demo2', 'o/r2');
    const wt = path.join(vol, CHILD_ID, 'wt');
    h.git(main2, 'worktree', 'add', '-q', '-b', 'ws/scratch', wt);
    row(ROW, wt);
    nested(evalOf(h), ROW, 'the CONTROL: while it stands, it is inside');
    fs.rmSync(wt, { recursive: true, force: true });
    expect(h.sh(`_ws_reclaim_recorded ${ROW} "${wt}"; printf '%s' "$?"`), 'the CONTROL: git’s record places it').toBe('0');
    nested(evalOf(h), ROW, 'a recovered row inside the standing temp root');
  }, 120_000);

  it('a gone row spelled literally inside a standing temp root: nested', () => {
    makeChild(h);
    h.sh(`_child_tmpdir ${CHILD_ID} >/dev/null`);
    const main2 = h.makeGhRepo('demo2', 'o/r2');
    const wt = path.join(tmpOf(CHILD_ID), 'wt');
    h.git(main2, 'worktree', 'add', '-q', '-b', 'ws/scratch', wt);
    row(ROW, wt);
    fs.rmSync(wt, { recursive: true, force: true });
    nested(evalOf(h), ROW, 'a gone row literally inside the temp root');
  }, 120_000);

  it('a recovered row inside an ABSENT leaf does NOT hold: nothing of that leaf is deleted — and once the leaf stands, it is nested', () => {
    makeChild(h);
    h.makeGhRepo('demo2', 'o/r2');
    const S = 'demo2-still-harbor';
    h.sh(`${WS_ADD} CCD_WS_SLUG=still-harbor cmd_ws_add demo2`);
    const swt = path.join(h.home, 'worktrees', 'demo2', 'still-harbor');
    h.git(path.join(h.home, 'projects', 'demo2'), 'worktree', 'remove', '--force', swt);
    // The row names a path inside the child's temp root, and ccd's own records say ccd took it.
    const w = path.join(tmpOf(CHILD_ID), 'wt');
    fs.writeFileSync(path.join(h.home, '.cc-sessions', `${S}.workdir`), w);
    h.sh(`_ws_reclaim_reset; _ws_tombstone ${S} '[]' >/dev/null`);
    fs.writeFileSync(path.join(h.home, '.cc-sessions', `${S}.reaping`), 'branch');
    expect(fs.existsSync(tmpOf(CHILD_ID)), 'the CONTROL: the leaf is absent').toBe(false);
    expect(h.sh(`_ws_reclaim_recorded ${S} "${w}"; printf '%s' "$?"`), 'the CONTROL: the breadcrumb arm places it').toBe('0');
    const e = evalOf(h);
    placed(e, 'a recovered row inside an absent leaf');
    fs.mkdirSync(tmpOf(CHILD_ID), { recursive: true });
    nested(evalOf(h), S, 'the same row once the leaf stands');
    fs.rmSync(tmpOf(CHILD_ID), { recursive: true });
    const r = childReclaimVerb(h, e.token, { pre: 'CCD_RECLAIM_TMPROOT_WAIT_S=2;' });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect((JSON.parse(r.stdout) as Record<string, unknown>)['reclaimed']).toBe(CHILD_ID);
  }, 180_000);
});

describe('a leaf that cannot be measured is UNMEASURED — never "no row inside it"', () => {
  it.skipIf(ROOT_USER)('a temp root whose absence cannot be proven (`~/.cc-tmp` cannot be searched)', () => {
    makeChild(h);
    h.sh(`_child_tmpdir ${CHILD_ID} >/dev/null`);
    const root = path.join(h.home, '.cc-tmp');
    restore.push([root, fs.statSync(root).mode & 0o7777]);
    fs.chmodSync(root, 0o000);
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.detail).toContain(tmpOf(CHILD_ID));
    expect(r.token).toBe('');
  }, 120_000);

  it('a temp root under a root that cannot be resolved (a physical path holding a newline)', () => {
    makeChild(h);
    const vol = path.join(h.home, 'vol\n');
    fs.mkdirSync(path.join(vol, CHILD_ID), { recursive: true });
    fs.symlinkSync(vol, path.join(h.home, '.cc-tmp'));
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.detail).toContain(tmpOf(CHILD_ID));
  }, 120_000);

  it.skipIf(ROOT_USER)('under ws-expire too', () => {
    makeArchived(h);
    fs.mkdirSync(tmpOf(EXP_ID), { recursive: true });
    const root = path.join(h.home, '.cc-tmp');
    restore.push([root, fs.statSync(root).mode & 0o7777]);
    fs.chmodSync(root, 0o000);
    const r = expireEvalOf(h);
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.detail).toContain(tmpOf(EXP_ID));
  }, 120_000);

  it('the CONTROL: a link or a file standing as the leaf is no tree the helper removes — the child is reclaimable', () => {
    makeChild(h);
    fs.mkdirSync(path.join(h.home, '.cc-tmp'), { recursive: true });
    fs.writeFileSync(tmpOf(CHILD_ID), 'a file where the leaf should be');
    fs.mkdirSync(path.join(h.home, '.cc-clips'), { recursive: true });
    fs.symlinkSync(path.join(h.home, 'nowhere'), clipsOf(CHILD_ID));
    placed(evalOf(h), 'a file temp root and a dangling-link clips leaf');
  }, 120_000);
});
