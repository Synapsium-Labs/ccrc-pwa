// The same moved-tree shapes under `ws-expire`, which takes the reclaim's tail
// and its removal helper (child reclamation wave 6, spec §5.5 and §5.6): a
// foreign workspace `mv`'d into an ARCHIVED workspace's clips directory or
// temp root is kept, `refused`, while the expiry completes. Review 335's lens
// measured the expiry deleting it (row #102).
// FIXTURE HOMES ONLY (`makePrHarness`): the unit and the pane are stubbed
// (`EXP_STUBS`); every repository, row and leaf is under the HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { WS_ADD } from './ccdWsHelpers.js';
import { eventsOf, measOf } from './lifecycleHelpers.js';
import { EXP_BRANCH, EXP_ID, expireEvalOf, expireVerb, makeArchived } from './wsExpireFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-leaf-moved-exp-'); });
afterEach(() => { h.cleanup(); });

const WAIT = 'CCD_RECLAIM_TMPROOT_WAIT_S=2;';
interface Other { main: string; wt: string; admin: string }
const foreign = (): Other => {
  const main = h.makeGhRepo('demo2', 'o/r2');
  h.sh(`${WS_ADD} CCD_WS_SLUG=still-harbor cmd_ws_add demo2`);
  const wt = path.join(h.home, 'worktrees', 'demo2', 'still-harbor');
  fs.writeFileSync(path.join(wt, 'precious.txt'), 'uncommitted work of the other session\n');
  return { main, wt, admin: h.git(wt, 'rev-parse', '--absolute-git-dir') };
};
const stanza = (main: string, wt: string): string =>
  h.git(main, 'worktree', 'list', '--porcelain').split('\n\n').find((s) => s.startsWith(`worktree ${wt}\n`)) ?? '';
const park = (o: Other, dest: string): void => {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(o.wt, dest);
  expect(stanza(o.main, o.wt), 'the CONTROL: the mv leaves git’s record prunable').toContain('\nprunable');
};
const tmpOf = (id: string): string => path.join(h.home, '.cc-tmp', id);
const clipsOf = (id: string): string => path.join(h.home, '.cc-clips', id);
type Doc = Record<string, unknown>;

const keptRefused = (r: { code: number; stdout: string; stderr: string }, precious: string,
  which: 'clipsKept' | 'tmpRootKept', leaf: string): void => {
  expect(fs.existsSync(precious), 'precious gone: the other session’s uncommitted file').toBe(true);
  expect(r.code, r.stdout + r.stderr).toBe(0);
  const doc = JSON.parse(r.stdout) as Doc;
  expect(doc['expired'], 'the act completed').toBe(EXP_ID);
  expect(doc[which], 'the done document says the leaf was kept').toBe('refused');
  const done = eventsOf(h.home, 'expire').find((e) => e['outcome'] === 'done')!;
  expect(measOf(done)[which]).toBe('refused');
  expect(String(done['detail'])).toContain(`${which === 'clipsKept' ? 'clips' : 'temp root'} ${leaf} kept (refused)`);
  expect(h.reg(EXP_ID, 'uuid'), 'the archived row is purged').toBeNull();
};
const expirable = (): string => {
  const e = expireEvalOf(h);
  expect(e.verdict, e.detail).toBe('expirable');
  return e.token;
};

describe('ws-expire keeps a leaf holding another session’s moved tree, and completes', () => {
  it('row #102: into the archived workspace’s CLIPS directory — kept `refused`, the file stands', () => {
    const a = makeArchived(h);
    const o = foreign();
    const dest = path.join(clipsOf(EXP_ID), 'parked', 'still-harbor');
    park(o, dest);
    const r = expireVerb(h, expirable(), { pre: WAIT });
    keptRefused(r, path.join(dest, 'precious.txt'), 'clipsKept', clipsOf(EXP_ID));
    expect(fs.existsSync(a.wt), 'the archived worktree went').toBe(false);
    expect(h.git(a.main, 'branch', '--list', EXP_BRANCH), 'its branch went').toBe('');
  }, 120_000);

  it('into the archived workspace’s TEMP ROOT — kept `refused`, the file stands', () => {
    makeArchived(h);
    const o = foreign();
    const dest = path.join(tmpOf(EXP_ID), 'parked', 'still-harbor');
    park(o, dest);
    const r = expireVerb(h, expirable(), { pre: WAIT });
    keptRefused(r, path.join(dest, 'precious.txt'), 'tmpRootKept', tmpOf(EXP_ID));
  }, 120_000);

  it('the VANISHED-worktree arm: the archived tree already gone, the moved tree in its clips — kept `refused`', () => {
    const a = makeArchived(h);
    const o = foreign();
    fs.rmSync(a.wt, { recursive: true, force: true });
    const dest = path.join(clipsOf(EXP_ID), 'parked', 'still-harbor');
    park(o, dest);
    const r = expireVerb(h, expirable(), { pre: WAIT });
    keptRefused(r, path.join(dest, 'precious.txt'), 'clipsKept', clipsOf(EXP_ID));
  }, 120_000);
});
