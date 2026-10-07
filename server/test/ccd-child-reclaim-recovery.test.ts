// Child reclamation wave 6, Task 9 (spec §5.5): the gone-directory alternate-row recovery.
//
// A registry row whose workdir is GONE resolves only as a projection (`absent-suffix`), and since run 208 such a
// row holds every child's reclaim at `unmeasured` (spec §5.5's stated cost of the hold). The recovery lets it stop
// holding ONLY on positive evidence, as a second placement basis, `recorded`, inside `_ws_reclaim_workdir_shared` — the one
// resolver the audit, the verb's locked recomputation and `_ws_reclaim_owned` all ask:
//   - the git-record arm: exactly one `<common>/worktrees/*/gitdir` names `<w>/.git`; git's porcelain list marks
//     that stanza `prunable`; the leaf is the only absent component; the parent resolves `complete` to its
//     literal spelling. The row is then placed by that physical path.
//   - the breadcrumb arm: the row's `.reaping` phase is ws-reap's `branch` or `clips`, or a reclaim's
//     `reclaim:branch` or `reclaim:artifacts` (a `reclaim:` one only beside its tombstone's `worktree: present`), the tombstone's uuid and workdir equal the row's, and git keeps
//     NO record of the tree. Both verbs write those phases over a tree that was moved away too, and only ccd's own
//     removal takes git's record with it.
// The moved-tree hole is closed: no nested checkout of the child, of any repository, may resolve its git
// directory to the admin directory a recovered row named — asked after the ladder's nested scan, and again in
// `_ws_reclaim_owned`. Every item of the recovery's never-list (spec §5.5) has a case here or a line in the scan
// at the foot.
//
// FIXTURE HOME ONLY. `makePrHarness`'s HOME is the isolation boundary: every repository, worktree, registry row,
// tombstone and the git shim live under it, and the verb runs under `CHILD_STUBS`, so no unit or pane is touched.
// A new file, not cases added to the ladder suite, so that no one suite outgrows the 600 s ceiling of a foreground run.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CCD, WS_ADD } from './ccdWsHelpers.js';
import { eventsOf } from './lifecycleHelpers.js';
import {
  CHILD_ENV, CHILD_ID, CHILD_RUN, CHILD_STUBS, childReclaimVerb, evalOf, makeChild, type Child, type LadderAnswer,
} from './childReclaimFixture.js';
import { inheritedEnv } from './gitEnvStrip.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-child-reclaim-recovery-'); });
afterEach(() => { h.cleanup(); });

/** `_ws_reclaim_workdir_shared`'s cannot-be-placed sentence: the row holds the child. */
const HELD = 'name a workdir that cannot be resolved completely';
/** A second CHILD of the child's own repository (`demo`), minted by the real ws-add. */
const SIB = 'demo-still-harbor';
/** A plain workspace of ANOTHER repository (`demo2`): nothing done to ITS git records can touch the child's reads. */
const FOREIGN = 'demo2-still-harbor';

/** `_ws_reclaim_eval`'s answer for any child id — `evalOf` asks `CHILD_ID` alone. */
const evalAs = (id: string): LadderAnswer => {
  const out = h.sh(`${CHILD_STUBS} _ws_reclaim_eval ${id} 0 '' >/dev/null;`
    + ` printf '%s\\x1f%s\\x1f%s' "$REAP_VERDICT" "$REAP_TOKEN" "$REAP_DETAIL"`);
  const [verdict = '', token = '', detail = ''] = out.split('\x1f');
  return { verdict, token, detail };
};
/** `_ws_reclaim_owned` — the tail's re-ask, on every arm — for any id: its rc and its why. */
const ownedOf = (id: string, wt: string, main: string): { rc: string; why: string } => {
  const [rc = '', why = ''] = h.sh(`_ws_reclaim_owned ${id} "${wt}" "${main}"; printf '%s\\x1f%s' "$?" "$_WS_OWNED_WHY"`)
    .split('\x1f');
  return { rc, why };
};
const verbAs = (id: string, token: string): { code: number; stdout: string; stderr: string } =>
  h.run(`${CHILD_STUBS} ${CHILD_ENV} cmd_ws_reclaim --expect ${token} --child-of ${CHILD_RUN} --session ${id}`);
const resumeTokenOf = (id: string, phase: string): string =>
  h.sh(`_ws_reclaim_resume_eval ${id} 0 ${CHILD_RUN} ${phase} >/dev/null; printf '%s' "$REAP_TOKEN"`);
/** git's porcelain stanza for `wt` in `main`'s list, or '' when git records no worktree there. */
const stanza = (main: string, wt: string): string =>
  h.git(main, 'worktree', 'list', '--porcelain').split('\n\n').find((s) => s.startsWith(`worktree ${wt}\n`)) ?? '';
const held = (r: LadderAnswer, id: string, label: string): void => {
  expect(r.verdict, `${label}: ${r.detail}`).toBe('unmeasured');
  expect(r.detail, label).toContain(`registry row(s) ${id} ${HELD}`);
  expect(r.token, label).toBe('');
};
const placed = (r: LadderAnswer, label: string): void => {
  expect(r.verdict, `${label}: ${r.detail}`).toBe('reclaimable');
  expect(r.token, label).toMatch(/^[0-9a-f]{64}$/);
};

const sibling = (): { wt: string; admin: string } => {
  h.sh(`${WS_ADD} CCD_WS_SLUG=still-harbor cmd_ws_add --child ${CHILD_RUN} demo`);
  const wt = path.join(h.home, 'worktrees', 'demo', 'still-harbor');
  return { wt, admin: h.git(wt, 'rev-parse', '--absolute-git-dir') };
};
const foreign = (): { main: string; wt: string; admin: string } => {
  const main = h.makeGhRepo('demo2', 'o/r2');
  h.sh(`${WS_ADD} CCD_WS_SLUG=still-harbor cmd_ws_add demo2`);
  const wt = path.join(h.home, 'worktrees', 'demo2', 'still-harbor');
  const admin = h.git(wt, 'rev-parse', '--absolute-git-dir');
  expect(h.reg(FOREIGN, 'project'), 'the CONTROL: the row names its own repository').toBe('demo2');
  expect(fs.readFileSync(path.join(admin, 'gitdir'), 'utf8').trim(), 'the CONTROL: git records the tree by its physical path')
    .toBe(`${wt}/.git`);
  return { main, wt, admin };
};
/** The child, the foreign workspace, the CONTROL that it is placed outside while it stands — then its tree gone. */
const goneForeign = (): { c: Child; o: { main: string; wt: string; admin: string } } => {
  const c = makeChild(h);
  const o = foreign();
  placed(evalOf(h), 'the CONTROL: while its tree stands the row is placed outside');
  fs.rmSync(o.wt, { recursive: true, force: true });
  return { c, o };
};
/** A reclaim of `id` that ran its pin phase, wrote its tombstone (`worktree: present`) and a `reclaim:branch`
 *  breadcrumb — the state the tail leaves once its step 4 has removed the tree and step 5 has not run. */
const pinned = (id: string, wt: string, main: string): void => {
  h.sh(`${CHILD_STUBS} export ${CHILD_ENV}; _ws_reclaim_eval ${id} 0 ${CHILD_RUN} >/dev/null`
    + ` && _ws_reclaim_pin ${id} "${wt}" "${main}" "$REAP_BRANCH" ${CHILD_RUN}`
    + ` && _ws_tombstone ${id} '[]' "$(_ws_reclaim_tomb_fields ${CHILD_RUN} present)" >/dev/null`
    + ` && _reg_set ${id} reaping reclaim:branch`);
  expect(h.reg(id, 'reaping'), `the CONTROL: ${id} carries the breadcrumb`).toBe('reclaim:branch');
  const tomb = JSON.parse(fs.readFileSync(path.join(h.home, '.cc-sessions', '.reaped', `${id}.json`), 'utf8')) as
    Record<string, unknown>;
  expect(tomb['worktree'], 'the CONTROL: its tombstone says there was a tree').toBe('present');
  expect(tomb['uuid'], 'the CONTROL: its tombstone is this row’s').toBe(h.reg(id, 'uuid'));
};
/** The tail's own step 4: `git worktree remove --force` on the tree it pinned, which takes git's record with it. */
const removedByTail = (wt: string, main: string): void => {
  h.git(main, 'worktree', 'remove', '--force', wt);
  expect(fs.existsSync(wt)).toBe(false);
};

describe('the git-record arm', () => {
  it('a hand-deleted workspace no longer holds a present child, and the verb reclaims the child', () => {
    const c = makeChild(h);
    const s = sibling();
    placed(evalOf(h), 'the CONTROL: while its tree stands the sibling is placed outside');
    fs.rmSync(s.wt, { recursive: true, force: true });
    expect(stanza(c.main, s.wt), 'the CONTROL: git keeps the record, marked prunable').toContain('\nprunable');
    const r = evalOf(h);
    placed(r, 'git’s record places the gone sibling');
    const v = childReclaimVerb(h, r.token);
    expect(v.code, v.stdout + v.stderr).toBe(0);
    expect((JSON.parse(v.stdout) as { reclaimed: string }).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(c.wt), 'the child’s tree is gone').toBe(false);
    // What the recovery never does (spec §5.5): it only stopped the sibling holding the child.
    expect(fs.existsSync(s.wt), 'no directory was created at the gone path').toBe(false);
    expect(fs.existsSync(s.admin), 'the sibling’s admin directory stands').toBe(true);
    expect(stanza(c.main, s.wt), 'git’s record of the sibling stands, still prunable').toContain('\nprunable');
    expect(h.reg(SIB, 'workdir'), 'the sibling’s row stands').toBe(s.wt);
  }, 120_000);

  it('two hand-deleted children of one repository release each other', () => {
    const c = makeChild(h);
    const s = sibling();
    fs.rmSync(c.wt, { recursive: true, force: true });
    fs.rmSync(s.wt, { recursive: true, force: true });
    for (const wt of [c.wt, s.wt]) {
      expect(stanza(c.main, wt), `the CONTROL: git keeps the record of ${wt}, prunable`).toContain('\nprunable');
    }
    placed(evalOf(h), 'the child, its sibling placed by git’s record');
    placed(evalAs(SIB), 'the sibling, the child placed by git’s record');
    for (const wt of [c.wt, s.wt]) expect(fs.existsSync(wt), `no directory was created at ${wt}`).toBe(false);
  }, 120_000);

  it('two admin entries naming one gone tree keep the hold', () => {
    const { o } = goneForeign();
    const copy = `${o.admin}-copy`;
    fs.cpSync(o.admin, copy, { recursive: true });
    held(evalOf(h), FOREIGN, 'two records name the one path');
    fs.rmSync(copy, { recursive: true, force: true });
    placed(evalOf(h), 'the CONTROL: one record places it');
  }, 120_000);

  it('a locked record is never prunable, and keeps the hold', () => {
    makeChild(h);
    const o = foreign();
    h.git(o.main, 'worktree', 'lock', o.wt);
    fs.rmSync(o.wt, { recursive: true, force: true });
    const st = stanza(o.main, o.wt);
    expect(st, 'the CONTROL: git reads a locked gone record as locked').toContain('\nlocked');
    expect(st, 'the CONTROL: and never as prunable').not.toContain('\nprunable');
    held(evalOf(h), FOREIGN, 'a locked record');
    fs.rmSync(path.join(o.admin, 'locked'));
    expect(stanza(o.main, o.wt)).toContain('\nprunable');
    placed(evalOf(h), 'the CONTROL: unlocked, the same record places it');
  }, 120_000);

  it('a parent that is gone too keeps the hold — the leaf must be the only absent component', () => {
    goneForeign();
    const parent = path.join(h.home, 'worktrees', 'demo2');
    fs.rmSync(parent, { recursive: true, force: true });
    held(evalOf(h), FOREIGN, 'the parent is gone too');
    fs.mkdirSync(parent);
    placed(evalOf(h), 'the CONTROL: with the parent back, only the leaf is absent');
  }, 120_000);

  it('a parent spelled through a link keeps the hold — it must resolve complete to its literal spelling', () => {
    makeChild(h);
    const o = foreign();
    fs.symlinkSync(path.join(h.home, 'worktrees'), path.join(h.home, 'wtlink'));
    const linked = path.join(h.home, 'wtlink', 'demo2', 'still-harbor');
    const row = path.join(h.home, '.cc-sessions', `${FOREIGN}.workdir`);
    fs.writeFileSync(row, linked);
    placed(evalOf(h), 'the CONTROL: while the tree stands, the linked spelling resolves completely, outside');
    fs.rmSync(o.wt, { recursive: true, force: true });
    const r = evalOf(h);
    held(r, FOREIGN, 'the row is spelled through a link');
    expect(r.detail, 'by id only').not.toContain(linked);
    fs.writeFileSync(row, o.wt);
    placed(evalOf(h), 'the CONTROL: spelled physically, the same record places it');
  }, 120_000);

  it('an unreadable worktrees/ directory or gitdir file keeps the hold — never read as no record', (ctx) => {
    if (process.getuid?.() === 0) { ctx.skip(); return; }
    const { o } = goneForeign();
    const dir = path.dirname(o.admin);
    fs.chmodSync(dir, 0o000);
    try { held(evalOf(h), FOREIGN, 'worktrees/ cannot be listed'); } finally { fs.chmodSync(dir, 0o755); }
    placed(evalOf(h), 'the CONTROL: listable again, the record places it');
    const gitdir = path.join(o.admin, 'gitdir');
    fs.chmodSync(gitdir, 0o000);
    try { held(evalOf(h), FOREIGN, 'its gitdir cannot be read'); } finally { fs.chmodSync(gitdir, 0o644); }
    placed(evalOf(h), 'the CONTROL: readable again, the record places it');
  }, 120_000);

  it('a lifecycle create row alone keeps the hold — it never decides', () => {
    // Passes before the implementation too, by construction: it pins that the implementation never makes the
    // journal's `create` row sufficient (spec §5.5: it only corroborates).
    const { o } = goneForeign();
    h.git(o.main, 'worktree', 'prune');   // the FIXTURE removes git's record; ccd never runs this
    expect(stanza(o.main, o.wt), 'the CONTROL: git records nothing').toBe('');
    expect(eventsOf(h.home, 'create').some((e) => e['id'] === FOREIGN && e['outcome'] === 'done'
      && (e['meas'] as { workdir?: unknown } | undefined)?.workdir === o.wt),
    'the CONTROL: the journal holds the row’s create, naming its workdir').toBe(true);
    held(evalOf(h), FOREIGN, 'a create row and nothing else');
  }, 120_000);
});

describe('the breadcrumb arm', () => {
  it('two interrupted children whose trees the tail removed release each other', () => {
    const c = makeChild(h);
    const s = sibling();
    // Both pinned before either tree goes, so no setup step leans on the recovery under test.
    pinned(CHILD_ID, c.wt, c.main);
    pinned(SIB, s.wt, c.main);
    removedByTail(c.wt, c.main);
    removedByTail(s.wt, c.main);
    for (const wt of [c.wt, s.wt]) {
      expect(stanza(c.main, wt), 'the CONTROL: git keeps no record — the git-record arm cannot fire').toBe('');
    }
    const mine = ownedOf(CHILD_ID, c.wt, c.main);
    expect(mine.rc, mine.why).toBe('0');
    const theirs = ownedOf(SIB, s.wt, c.main);
    expect(theirs.rc, theirs.why).toBe('0');
    const a = verbAs(CHILD_ID, resumeTokenOf(CHILD_ID, 'branch'));
    expect(a.code, a.stdout + a.stderr).toBe(0);
    expect((JSON.parse(a.stdout) as { reclaimed: string }).reclaimed).toBe(CHILD_ID);
    const b = verbAs(SIB, resumeTokenOf(SIB, 'branch'));
    expect(b.code, b.stdout + b.stderr).toBe(0);
    expect((JSON.parse(b.stdout) as { reclaimed: string }).reclaimed).toBe(SIB);
    for (const wt of [c.wt, s.wt]) expect(fs.existsSync(wt), `no directory was created at ${wt}`).toBe(false);
  }, 180_000);

  const patchTomb = (id: string, doc: Record<string, unknown>): void => {
    h.sh(`_ws_tombstone_patch ${id} '${JSON.stringify(doc)}'`);
  };
  const crumb = (id: string, v: string): void => {
    fs.writeFileSync(path.join(h.home, '.cc-sessions', `${id}.reaping`), v);
  };
  const VARIANTS: readonly [string, (wt: string) => void, (wt: string) => void][] = [
    ['a tombstone of another session (its uuid)',
      () => patchTomb(SIB, { uuid: 'an-earlier-child' }), () => patchTomb(SIB, { uuid: h.reg(SIB, 'uuid') })],
    ['a tombstone naming another workdir',
      () => patchTomb(SIB, { workdir: path.join(h.home, 'worktrees', 'demo', 'elsewhere') }),
      (wt) => patchTomb(SIB, { workdir: wt })],
    ['a reclaim tombstone saying worktree: absent',
      () => patchTomb(SIB, { worktree: 'absent' }), () => patchTomb(SIB, { worktree: 'present' })],
    ['a breadcrumb written before the removal (reclaim:worktree)',
      () => crumb(SIB, 'reclaim:worktree'), () => crumb(SIB, 'reclaim:branch')],
    ['an expiry’s breadcrumb (expire:branch)',
      () => crumb(SIB, 'expire:branch'), () => crumb(SIB, 'reclaim:branch')],
    ['a link planted at the gone path',
      (wt) => fs.symlinkSync(path.join(h.home, 'nowhere'), wt), (wt) => fs.unlinkSync(wt)],
  ];
  it.each(VARIANTS)('%s keeps the hold', (label, apply, restore) => {
    const c = makeChild(h);
    const s = sibling();
    pinned(SIB, s.wt, c.main);
    removedByTail(s.wt, c.main);
    expect(stanza(c.main, s.wt), 'the CONTROL: git keeps no record — only the breadcrumb can place it').toBe('');
    placed(evalOf(h), 'the CONTROL: the breadcrumb and its tombstone place the sibling');
    apply(s.wt);
    held(evalOf(h), SIB, label);
    restore(s.wt);
    placed(evalOf(h), 'the CONTROL: restored, the breadcrumb places it again');
  }, 120_000);

  it('a breadcrumb never places a row git still records — a tree moved away, its record locked', (ctx) => {
    const c = makeChild(h);
    const s = sibling();
    pinned(SIB, s.wt, c.main);
    h.git(c.main, 'worktree', 'lock', s.wt);
    // The tail's own state between its steps 4 and 5: `reclaim:branch` over a tree that was MOVED, not removed.
    fs.renameSync(s.wt, path.join(h.home, 'moved-away'));
    expect(fs.existsSync(s.wt), 'the CONTROL: nothing stands at the row’s path').toBe(false);
    expect(stanza(c.main, s.wt), 'the CONTROL: git still records the tree, locked').toContain('\nlocked');
    held(evalOf(h), SIB, 'a breadcrumb over a record git keeps');
    fs.rmSync(path.join(s.admin, 'locked'));
    expect(stanza(c.main, s.wt), 'the CONTROL: unlocked, git marks the record prunable').toContain('\nprunable');
    placed(evalOf(h), 'the CONTROL: unlocked, the git arm places it');
    // The arm asks git's list AND the admin entries, and each sees a record the other cannot. git lists a record
    // whose `gitdir` is spelled other than `<w>/.git` (measured, git 2.43: no suffix to strip, listed as is,
    // prunable), which the admin-entry reader, matching `<w>/.git`, never names.
    const gitdir = path.join(s.admin, 'gitdir');
    fs.writeFileSync(gitdir, `${s.wt}\n`);
    expect(stanza(c.main, s.wt), 'the CONTROL: git still lists the record, prunable').toContain('\nprunable');
    held(evalOf(h), SIB, 'a breadcrumb over a record only git’s list names');
    fs.writeFileSync(gitdir, `${s.wt}/.git\n`);
    placed(evalOf(h), 'the CONTROL: respelled, the git arm places it');
    // AN ADMIN ENTRY THAT NAMES THE TREE WHILE GIT'S LIST DOES NOT (spec §5.5): the reader of the entries takes the
    // FIRST line of a `gitdir` file, but git lists its whole text as the path — a two-line file, `<w>/.git` and then
    // `extra`, prints `worktree <w>/.git` and an `extra` line (measured, git 2.43), and the list's exact match finds
    // no record at `<w>`. So the arm's "git keeps no record" is true of the list and false of the entry, and only
    // its `gitdir:` loop keeps the hold. This runs as root too: nothing here is a permission.
    fs.writeFileSync(gitdir, `${s.wt}/.git\nextra\n`);
    expect(h.git(c.main, 'worktree', 'list', '--porcelain'), 'the CONTROL: git lists the record under another path')
      .toContain(`worktree ${s.wt}/.git\nextra\n`);
    expect(stanza(c.main, s.wt), 'the CONTROL: so git’s list has no stanza at the row’s path').toBe('');
    expect(h.sh(`_ws_reclaim_record "${c.main}" "${s.wt}"; printf '%s' "$?"`),
      'the CONTROL: the record reader answers "no record" — the loop alone sees the entry').toBe('1');
    const logged = h.sh(`_WS_LOGS=(); _ws_reclaim_log_of "${c.main}" tree "${s.wt}" 0; printf '%s\\n' "$?" "\${_WS_LOGS[@]}"`).split('\n');
    expect(logged[0], 'the CONTROL: the entry reader found the entry and answered rc 0').toBe('0');
    expect(logged.filter((l) => l.startsWith('gitdir:')), 'the CONTROL: and names the admin directory')
      .toEqual([`gitdir:${s.admin}`]);
    held(evalOf(h), SIB, 'a breadcrumb over an admin entry git’s list cannot match');
    fs.writeFileSync(gitdir, `${s.wt}/.git\n`);
    placed(evalOf(h), 'the CONTROL: one line again, the git arm places it');
    // NEVER READ AS "NO RECORD" (spec §5.5): git's list exits 0 and silently OMITS a record whose `gitdir` it cannot
    // read, and every linked record when `worktrees/` cannot be listed — the breadcrumb's "git keeps no record" there
    // would be a record nobody read. Both shapes hold.
    if (process.getuid?.() === 0) { ctx.skip(); return; }
    fs.chmodSync(gitdir, 0o000);
    try {
      expect(stanza(c.main, s.wt), 'the CONTROL: git’s list omits the record it cannot read').toBe('');
      held(evalOf(h), SIB, 'a breadcrumb over a gitdir git could not read');
    } finally { fs.chmodSync(gitdir, 0o644); }
    placed(evalOf(h), 'the CONTROL: readable again, the git arm places it');
    const wts = path.dirname(s.admin);
    fs.chmodSync(wts, 0o311);
    try {
      expect(stanza(c.main, s.wt), 'the CONTROL: git’s list omits every linked record').toBe('');
      held(evalOf(h), SIB, 'a breadcrumb over a worktrees/ git could not list');
    } finally { fs.chmodSync(wts, 0o755); }
    placed(evalOf(h), 'the CONTROL: listable again, the git arm places it');
  }, 120_000);

  // The phases the arm accepts beside `reclaim:branch`, each against the phase written BEFORE ccd's removal step,
  // which proves nothing: ws-reap's `branch` and `clips` over ws-reap's own tombstone (`uuid` and `workdir`, no
  // `worktree`), and the tail's `reclaim:artifacts` beside its tombstone's `worktree: present`.
  it.each([
    ['ws-reap’s branch', 'worktree', 'branch'],
    ['ws-reap’s clips', 'worktree', 'clips'],
    ['the tail’s reclaim:artifacts', 'reclaim:worktree', 'reclaim:artifacts'],
  ] as const)('%s places the gone row', (label, before, phase) => {
    const c = makeChild(h);
    const s = sibling();
    if (phase.startsWith('reclaim:')) {
      pinned(SIB, s.wt, c.main);
    } else {
      h.sh(`_ws_reap_reset; _ws_tombstone ${SIB} '[]' >/dev/null`);
      const tomb = JSON.parse(fs.readFileSync(path.join(h.home, '.cc-sessions', '.reaped', `${SIB}.json`), 'utf8')) as
        Record<string, unknown>;
      expect([tomb['uuid'], tomb['workdir'], 'worktree' in tomb], 'the CONTROL: ws-reap’s own tombstone')
        .toEqual([h.reg(SIB, 'uuid'), s.wt, false]);
    }
    removedByTail(s.wt, c.main);
    expect(stanza(c.main, s.wt), 'the CONTROL: git keeps no record — only the breadcrumb can place it').toBe('');
    crumb(SIB, before);
    held(evalOf(h), SIB, `the CONTROL: ${before}, written before the removal, proves nothing`);
    crumb(SIB, phase);
    placed(evalOf(h), label);
  }, 120_000);
});

describe('the moved-tree hole', () => {
  it('a moved checkout of ANOTHER repository inside the child keeps it — after the nested scan, and in _ws_reclaim_owned', () => {
    const c = makeChild(h);
    const o = foreign();
    placed(evalOf(h), 'the CONTROL: the other session’s tree stands outside the child');
    const moved = path.join(c.wt, 'vendor', 'still-harbor');
    fs.mkdirSync(path.dirname(moved));
    fs.renameSync(o.wt, moved);
    expect(stanza(o.main, o.wt), 'the CONTROL: an mv leaves git’s record as an rm does').toContain('\nprunable');
    expect(h.git(moved, 'rev-parse', '--absolute-git-dir'), 'the CONTROL: the moved tree names the recorded admin directory')
      .toBe(o.admin);
    expect(h.sh(`_ws_reclaim_foreign_clean "${moved}"; printf '%s' "$?"`),
      'the CONTROL: rung 9 alone would pass it — clean, every commit on its remote').toBe('0');
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('containment-unproven');
    expect(r.detail).toContain(`registry row ${FOREIGN}, whose workdir is gone`);
    expect(r.token).toBe('');
    const owned = ownedOf(CHILD_ID, c.wt, c.main);
    expect(owned.rc, `the tail asks it again: ${owned.why}`).toBe('1');
    expect(owned.why).toContain(`registry row ${FOREIGN}, whose workdir is gone`);
    expect(fs.readFileSync(path.join(moved, 'README.md'), 'utf8'), 'the moved tree stands').toBe('hi\n');
  }, 120_000);

  it('a moved checkout of the child’s own repository: rung 9 refuses it in the ladder, and _ws_reclaim_owned refuses it too', () => {
    const c = makeChild(h);
    const s = sibling();
    const moved = path.join(c.wt, 'inner-moved');
    fs.renameSync(s.wt, moved);
    expect(stanza(c.main, s.wt), 'the CONTROL: git reads the record as gone').toContain('\nprunable');
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('containment-unproven');
    expect(r.detail, 'rung 9’s own reader of the record answers first').toContain('another checkout');
    const owned = ownedOf(CHILD_ID, c.wt, c.main);
    expect(owned.rc, owned.why).toBe('1');
    expect(owned.why).toContain(`registry row ${SIB}, whose workdir is gone`);
    expect(fs.existsSync(path.join(moved, '.git')), 'the moved tree stands').toBe(true);
  }, 120_000);

  // `_ws_reclaim_owned` asks the moved-tree question with nothing in front of it: in the ladder the nested loop's own
  // repository read fails first, so these are its only reach. A git directory it cannot read, or cannot resolve
  // completely, is unmeasured — never "not that tree" (spec §5.5).
  it('_ws_reclaim_owned: a checkout inside the child whose git directory cannot be read, or resolved completely, is unmeasured', () => {
    const c = makeChild(h);
    const o = foreign();
    const bogus = path.join(c.wt, 'bogus');
    fs.mkdirSync(bogus);
    fs.writeFileSync(path.join(bogus, '.git'), 'gitdir: /nowhere\n');
    const tabbed = path.join(h.home, 'sep\tgit');
    const inner = path.join(c.wt, 'inner');
    const ok = ownedOf(CHILD_ID, c.wt, c.main);
    expect(ok.rc, `the CONTROL: while the other tree stands nothing is scanned — ${ok.why}`).toBe('0');
    fs.rmSync(o.wt, { recursive: true, force: true });
    const r = ownedOf(CHILD_ID, c.wt, c.main);
    expect(r.rc, r.why).toBe('1');
    expect(r.why).toContain(`could not read the git directory of the checkout at ${bogus}`);
    fs.rmSync(bogus, { recursive: true, force: true });
    h.git(h.home, 'init', '-q', `--separate-git-dir=${tabbed}`, inner);
    expect(h.git(inner, 'rev-parse', '--absolute-git-dir'), 'the CONTROL: git reads it, a tab in its name').toBe(tabbed);
    const t = ownedOf(CHILD_ID, c.wt, c.main);
    expect(t.rc, t.why).toBe('1');
    expect(t.why).toContain(`could not resolve the git directory of the checkout at ${inner} completely`);
  }, 120_000);

  it('_ws_reclaim_owned: a child it cannot scan for a gone row’s moved tree is unmeasured', (ctx) => {
    if (process.getuid?.() === 0) { ctx.skip(); return; }
    const c = makeChild(h);
    const o = foreign();
    const shut = path.join(c.wt, 'shut');
    fs.mkdirSync(shut);
    fs.chmodSync(shut, 0o000);
    try {
      const ok = ownedOf(CHILD_ID, c.wt, c.main);
      expect(ok.rc, `the CONTROL: while the other tree stands nothing is scanned — ${ok.why}`).toBe('0');
      fs.rmSync(o.wt, { recursive: true, force: true });
      const r = ownedOf(CHILD_ID, c.wt, c.main);
      expect(r.rc, r.why).toBe('1');
      expect(r.why).toBe(`could not scan ${c.wt} for a gone row's moved tree`);
    } finally { fs.chmodSync(shut, 0o755); }
  }, 120_000);
});

describe('what the recovery never does', () => {
  it('git worktree prune never runs: a git shim that fails on it sees no call through the audit, the verb and the tail', () => {
    const c = makeChild(h);
    const s = sibling();
    const shimDir = path.join(h.home, 'prune-shim');
    fs.mkdirSync(shimDir);
    const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8', env: inheritedEnv() }).trim();
    fs.writeFileSync(path.join(shimDir, 'git'), [
      '#!/bin/sh',
      'prev=',
      'for a in "$@"; do',
      '  if [ "$prev" = worktree ] && [ "$a" = prune ]; then printf \'%s\\n\' "$*" >> "$HOME/prune-calls"; exit 97; fi',
      '  prev=$a',
      'done',
      `exec '${realGit}' "$@"`,
      '',
    ].join('\n'), { mode: 0o755 });
    const SHIM = `PATH="${shimDir}:$PATH";`;
    const calls = path.join(h.home, 'prune-calls');
    // The CONTROL: the shim is the git ccd finds, and it catches what it claims to — running nothing.
    expect(h.sh(`${SHIM} command -v git`)).toBe(path.join(shimDir, 'git'));
    const probe = h.run(`${SHIM} git -C "${c.main}" worktree prune`);
    expect(probe.code).toBe(97);
    expect(fs.readFileSync(calls, 'utf8')).toContain('worktree prune');
    fs.rmSync(calls);
    fs.rmSync(s.wt, { recursive: true, force: true });
    const r = evalOf(h, { pre: SHIM });
    placed(r, 'git’s record places the gone sibling, under the shim');
    const v = childReclaimVerb(h, r.token, { pre: SHIM });
    expect(v.code, v.stdout + v.stderr).toBe(0);
    expect(fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : '', 'git worktree prune never ran').toBe('');
    expect(fs.existsSync(s.admin), 'the sibling’s admin directory stands').toBe(true);
    expect(stanza(c.main, s.wt)).toContain('\nprunable');
  }, 120_000);

  it('its four bodies never create, prune or remove anything, never read process, pane or unit state, and never read the journal', () => {
    const src = fs.readFileSync(CCD, 'utf8');
    const FORBIDDEN: readonly [string, RegExp][] = [
      ['creates a directory', /\bmkdir\b/],
      ['prunes git’s records', /\bprune\b|\bgc\b/],
      ['removes something', /\brm\b|\brmdir\b|\bunlink\b|_reg_purge|update-ref|worktree +remove/],
      ['reads process, pane or unit state', /\/proc\b|\btmux\b|_session_probe|_svc_|systemctl|launchctl|pane_/],
      ['reads the lifecycle journal', /_LC_DIR|\.lifecycle|journal-/],
    ];
    const hits: string[] = [];
    for (const name of ['_ws_reclaim_recorded', '_ws_reclaim_recorded_git', '_ws_reclaim_recorded_crumb',
      '_ws_reclaim_moved_check']) {
      const from = src.indexOf(`\n${name}() {`);
      expect(from, `${name} is defined`).toBeGreaterThan(-1);
      const code = src.slice(from, src.indexOf('\n}\n', from)).split('\n').filter((l) => !/^\s*#/.test(l));
      for (const line of code) {
        for (const [what, re] of FORBIDDEN) if (re.test(line)) hits.push(`${name} ${what}: ${line.trim()}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
