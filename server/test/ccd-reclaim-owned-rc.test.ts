// `_ws_reclaim_owned` answers THREE ways (child reclamation wave 7, spec §5.6):
// 0, the tree at the workdir is provably the child's own; 1, it is PROVEN not
// to be; 2, that could not be asked. The shared tail of ws-reclaim and ws-expire
// names the two refusals apart (`containment-refuted`, `worktree-remove-failed`),
// so each arm is pinned to its own answer here, and no question that was not
// asked may answer 1. The tail's word is pinned end to end in
// `ccd-reclaim-tail-refuted.test.ts` and `ccd-expire-tail-refuted.test.ts`.
// FIXTURE HOME ONLY (`makePrHarness`): nothing here runs a verb; every
// repository, row and leaf is under the HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { WS_ADD } from './ccdWsHelpers.js';
import { CHILD_ID, makeChild, type Child } from './childReclaimFixture.js';

let h: PrHarness;
let restore: [string, number][] = [];
beforeEach(() => { h = makePrHarness('ccrc-owned-rc-'); restore = []; });
afterEach(() => {
  for (const [p, m] of restore.reverse()) { try { fs.chmodSync(p, m); } catch { /* gone */ } }
  h.cleanup();
});
const ROOT_USER = process.getuid?.() === 0;
const shut = (p: string, mode = 0o000): void => { restore.push([p, fs.statSync(p).mode & 0o7777]); fs.chmodSync(p, mode); };

interface Answer { rc: string; why: string }
const owned = (wd: string, main: string, pre = ''): Answer => {
  const [rc = '', why = ''] = h.sh(`${pre} _ws_reclaim_owned ${CHILD_ID} "${wd}" "${main}"; printf '%s\\x1f%s' "$?" "$_WS_OWNED_WHY"`)
    .split('\x1f');
  return { rc, why };
};
const row = (id: string, workdir: string): void => {
  fs.writeFileSync(path.join(h.home, '.cc-sessions', `${id}.uuid`), `u-${id}`);
  fs.writeFileSync(path.join(h.home, '.cc-sessions', `${id}.workdir`), workdir);
};
/** A plain workspace of ANOTHER repository, `demo2-still-harbor`, with its own registry row; its tree. */
const foreign = (): string => {
  h.makeGhRepo('demo2', 'o/r2');
  h.sh(`${WS_ADD} CCD_WS_SLUG=still-harbor cmd_ws_add demo2`);
  return path.join(h.home, 'worktrees', 'demo2', 'still-harbor');
};
/** A gone row placed on git's record, so the moved-tree question is asked at all. */
const goneForeign = (c: Child): void => {
  const wt2 = foreign();
  expect(owned(c.wt, c.main).rc, 'the CONTROL: while the other tree stands nothing is scanned').toBe('0');
  fs.rmSync(wt2, { recursive: true, force: true });
};
const linkedProject = (c: Child): string => {
  const demo2 = path.join(h.home, 'projects', 'demo2');
  h.git(c.main, 'worktree', 'add', '-q', '-b', 'proj2-main', demo2);
  return demo2;
};
const proven = (a: Answer, why: string): void => { expect(a.rc, a.why).toBe('1'); expect(a.why).toContain(why); };
const unasked = (a: Answer, why: string): void => { expect(a.rc, a.why).toBe('2'); expect(a.why).toContain(why); };

describe('_ws_reclaim_owned — 0: the child’s own', () => {
  it('CONTROL: the child’s own tree answers 0', () => {
    const c = makeChild(h);
    const a = owned(c.wt, c.main);
    expect(a.rc, a.why).toBe('0');
    expect(a.why).toBe('');
  }, 120_000);
});

describe('_ws_reclaim_owned — 1: PROVEN not the child’s own', () => {
  it('1: a workdir that is not one plain path', () => {
    const c = makeChild(h);
    proven(owned(`${c.wt}/`, c.main), 'not one plain absolute path');
  }, 120_000);

  it('1: a symbolic link at the workdir', () => {
    const c = makeChild(h);
    fs.rmSync(c.wt, { recursive: true, force: true });
    fs.symlinkSync(path.join(h.home, 'nowhere'), c.wt);
    proven(owned(c.wt, c.main), `${c.wt} is a symbolic link`);
  }, 120_000);

  it('1: something that is not a directory at the workdir', () => {
    const c = makeChild(h);
    fs.rmSync(c.wt, { recursive: true, force: true });
    fs.writeFileSync(c.wt, 'not a tree');
    proven(owned(c.wt, c.main), `something that is not a directory stands at ${c.wt}`);
  }, 120_000);

  it('1: the workdir is the project’s main checkout', () => {
    const c = makeChild(h);
    const demo2 = linkedProject(c);
    proven(owned(c.main, demo2), `${c.main} is ${demo2}'s main checkout`);
  }, 120_000);

  it('1: the workdir is the project directory itself', () => {
    const c = makeChild(h);
    const demo2 = linkedProject(c);
    proven(owned(demo2, demo2), `${demo2} is the project directory ${demo2} itself`);
  }, 120_000);

  it('1: SHARED — another registry row names the workdir', () => {
    const c = makeChild(h);
    row('demo-twin', c.wt);
    proven(owned(c.wt, c.main), `${c.wt} is also named by registry row(s) demo-twin`);
  }, 120_000);

  it('1: NESTED — a registry row rooted inside the worktree', () => {
    const c = makeChild(h);
    fs.mkdirSync(path.join(c.wt, 'server'));
    row('demo-nested', path.join(c.wt, 'server'));
    proven(owned(c.wt, c.main), 'registry row(s) demo-nested rooted inside');
  }, 120_000);

  it('1: NESTED — a registry row inside the clips directory, a leaf the tail removes', () => {
    const c = makeChild(h);
    const leafwt = path.join(h.home, '.cc-clips', CHILD_ID, 'wt');
    fs.mkdirSync(leafwt, { recursive: true });
    row('demo-nested', leafwt);
    proven(owned(c.wt, c.main), 'registry row(s) demo-nested rooted inside');
  }, 120_000);

  it('1: THROUGH — a registry row spelled through the workdir', () => {
    const c = makeChild(h);
    row('demo-up', `${c.wt}/..`);
    proven(owned(c.wt, c.main), `registry row(s) demo-up spell their workdir through ${c.wt}, not as one plain path`);
  }, 120_000);

  it('1: a gone row’s tree moved inside the child', () => {
    const c = makeChild(h);
    const wt2 = foreign();
    expect(owned(c.wt, c.main).rc, 'the CONTROL: the other tree stands outside the child').toBe('0');
    fs.mkdirSync(path.join(c.wt, 'vendor'));
    fs.renameSync(wt2, path.join(c.wt, 'vendor', 'still-harbor'));
    proven(owned(c.wt, c.main), 'registry row demo2-still-harbor, whose workdir is gone');
  }, 120_000);
});

describe('_ws_reclaim_owned — 2: could not be asked, never folded into 1', () => {
  it('2: the workdir’s absence cannot be proven', (ctx) => {
    if (ROOT_USER) { ctx.skip(); return; }
    const c = makeChild(h);
    const demo = path.join(h.home, 'worktrees', 'demo');
    shut(demo);
    unasked(owned(c.wt, c.main), 'was never asked');
  }, 120_000);

  it('2: git’s worktree list cannot be read', () => {
    const c = makeChild(h);
    unasked(owned(c.wt, c.main, 'git() { case "$*" in *"worktree list"*) return 128 ;; esac; command git "$@"; };'),
      `could not read ${c.main}'s worktree list`);
  }, 120_000);

  it('2, never 1: a tree that stands with no worktree record (git omits a record it cannot read)', () => {
    const c = makeChild(h);
    fs.rmSync(path.join(c.main, '.git', 'worktrees', 'quiet-basin'), { recursive: true, force: true });
    unasked(owned(c.wt, c.main), `${c.main} has no worktree record for the tree at ${c.wt}`);
  }, 120_000);

  it('2: another row that cannot be placed', () => {
    const c = makeChild(h);
    row('demo-nested', 'quiet-basin/server');
    const a = owned(c.wt, c.main);
    unasked(a, 'could not ask whether another registry row names');
    expect(a.why).toContain('registry row(s) demo-nested name no plain absolute workdir');
  }, 120_000);

  it('2: a registry that cannot be listed', (ctx) => {
    if (ROOT_USER) { ctx.skip(); return; }
    const c = makeChild(h);
    shut(path.join(h.home, '.cc-sessions'), 0o300);
    unasked(owned(c.wt, c.main), 'could not list');
  }, 120_000);

  it('2: a child that cannot be scanned for a gone row’s moved tree', (ctx) => {
    if (ROOT_USER) { ctx.skip(); return; }
    const c = makeChild(h);
    goneForeign(c);
    const s = path.join(c.wt, 'shut');
    fs.mkdirSync(s);
    shut(s);
    unasked(owned(c.wt, c.main), `could not scan ${c.wt} for a gone row's moved tree`);
  }, 120_000);

  it('2, never 1: a nested checkout whose git directory cannot be read', () => {
    const c = makeChild(h);
    goneForeign(c);
    fs.mkdirSync(path.join(c.wt, 'bogus'));
    fs.writeFileSync(path.join(c.wt, 'bogus', '.git'), 'gitdir: /nowhere\n');
    unasked(owned(c.wt, c.main), `could not read the git directory of the checkout at ${path.join(c.wt, 'bogus')}`);
  }, 120_000);

  it('2, never 1: an answer the moved-tree check never gives', () => {
    const c = makeChild(h);
    goneForeign(c);
    unasked(owned(c.wt, c.main, '_ws_reclaim_moved_check() { return 7; };'), 'answered 7');
  }, 120_000);
});
