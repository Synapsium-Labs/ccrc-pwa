// path-identity W3 (PI3 step 4, R18): R54's gone-row recovery gains an identity moved-check (path-identity spec §4.5,
// step 4). A gone row the breadcrumb arm places leaves no admin directory in `_WS_RECORDED_GDIRS`: git keeps no record
// of its tree, so the git-directory compare of `_ws_reclaim_moved_check` never sees that tree once it is moved inside the
// child. The row's entry field (`$REG/<id>.workdirid`) recorded the identity of the directory its session entered, and a
// moved directory keeps its inode and its birth time. So the rows rung keeps that identity, for every row either R54 arm
// places whose field is valid, in `_WS_RECORDED_IDS`, and the moved-check compares each nested checkout's identity
// (`_ws_path_ident`) with it by the one identity rule (`_ws_ident_eq`). A match HOLDS the child, at the ladder (reclaim
// and expiry) and in `_ws_reclaim_owned` (the tail's re-ask); nothing is ever released; a measure that fails is
// unmeasured. The stated limit, `moved-check-misses-a-subdirectory-of-a-moved-tree`: a row that entered a subdirectory
// of the moved tree recorded that subdirectory, which is no checkout's root.
// FIXTURE HOME ONLY (`makePrHarness`): every repository, worktree, registry row, field and tombstone lives under the
// harness's HOME. The unit and the pane are stubbed (`CHILD_STUBS`), the expiry ladder reads the fake process root
// `FAKE_PROC_SELF`, and nothing runs ccd against the live HOME. One case (B2) runs the real reclaim verb's tail, whose
// post-kill wait walks the real `/proc` twice a pass: by `_ws_path_users` (`PROC_SPY` counts it) and by the
// working-directory probe, `_ws_cwd_users`. So CLAUDE.md lists this file as a load flake. The wait only waits, and B2
// refuses at the tail's first ownership check, before any standing forced removal asks the probe, so a walk past its
// bound, or the probe's unmeasured answer under process churn (`the processes of this box could not be measured
// (/proc, exit 3)`), only lengthens the wait: under load B2 fails as vitest's `Test timed out in <n>ms`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { ccdSource } from './ccdWsHelpers.js';
import { CHILD_BRANCH, CHILD_ID, childReclaimVerb, evalOf, makeChild } from './childReclaimFixture.js';
import { verbHelpers } from './childReclaimVerbHelpers.js';
import { assertRefuted, type Shape, type Target } from './containmentRefutedFamilies.js';
import { expireEvalOf, makeArchived } from './wsExpireFixture.js';
import { FAKE_PROC_SELF, writeField } from './worktreeIdentityFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-moved-identity-'); });
afterEach(() => { h.cleanup(); });
const { interrupted, resumeToken } = verbHelpers(() => h);

/** The other session's registry row: gone, placed by the breadcrumb arm, its entry field written while it stood. */
const OTHER = 'demo-moved';
/** The grammar `_ws_path_ident` answers in (path-identity spec §4.5): dev:ino, then a birth time or `-`. */
const IDENT = /^\d+:\d+:([1-9]\d*|-)$/;
const WAIT = 'CCD_RECLAIM_TMPROOT_WAIT_S=2;';
/** Every walk of the real `/proc` that `_ws_path_users` makes, through its seam, logged to `$HOME/proc-walks`. */
const PROC_SPY = '_ws_path_users_proc_root() { echo walk >> "$HOME/proc-walks"; printf "%s" /proc; };';
/** `_ws_path_ident`, wrapped: every path it is asked is logged to `$HOME/ident-calls`, then the real one answers. */
const SPY_IDENT = 'eval "_t_ident_real()$(declare -f _ws_path_ident | tail -n +2)";'
  + ' _ws_path_ident() { printf \'%s\\n\' "$1" >> "$HOME/ident-calls"; _t_ident_real "$@"; };';
/** `_ws_path_ident`, wrapped: asked of `p` it fails as a failed stat makes it fail (rc 2, its why set); every other
 *  path is the real one's. The rung's walk never asks it, so only the moved-check sees the failure. */
const IDENT_FAILS = (p: string): string =>
  'eval "_t_ident_real()$(declare -f _ws_path_ident | tail -n +2)";'
  + ` _ws_path_ident() { if [[ "$1" == "${p}" ]]; then _WS_IDENT=''; _WS_IDENT_KIND=''; _WS_IDENT_WHY='stubbed: its stat failed'; return 2; fi; _t_ident_real "$@"; };`;
/** A birth time every path reads as 1000, one line per path, so a case sets the recorded one against it on any file
 *  system (one that keeps none would read `-`, which compares dev:ino alone). Only for direct calls: no walk runs. */
const BT = '_plat_btime() { local p; for p in "$@"; do echo 1000; done; };';

const reg = (f: string): string => path.join(h.home, '.cc-sessions', f);
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const lines = (name: string): string[] => {
  const p = path.join(h.home, name);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
};
const identOf = (p: string): string => {
  const id = h.sh(`_ws_path_ident "${p}"; printf '%s' "$_WS_IDENT"`);
  expect(id, `the CONTROL: ${p} measures an identity`).toMatch(IDENT);
  return id;
};
/** git's porcelain stanza for `wt` in `main`'s list, or '' when git records no worktree there. */
const stanza = (main: string, wt: string): string =>
  h.git(main, 'worktree', 'list', '--porcelain').split('\n\n').find((s) => s.startsWith(`worktree ${wt}\n`)) ?? '';
/** `_ws_reclaim_owned` for the child: its rc and its why. */
const owned = (wd: string, main: string, pre = ''): { rc: string; why: string } => {
  const [rc = '', why = ''] = h.sh(`${pre} _ws_reclaim_owned ${CHILD_ID} "${wd}" "${main}"; printf '%s\\x1f%s' "$?" "$_WS_OWNED_WHY"`)
    .split('\x1f');
  return { rc, why };
};
/** The rows rung's own answer for a subject, and the two lists it keeps for the moved-check. */
const rungOf = (id: string, wt: string): string =>
  h.sh(`_ws_reclaim_workdir_shared ${id} "${wt}"; printf '[rc=%s] [%s|%s|%s] gdirs=[%s] ids=[%s]' "$?"`
    + ` "$_WS_SHARED_ROWS" "$_WS_NESTED_ROWS" "$_WS_THROUGH_ROWS" "$_WS_RECORDED_GDIRS" "\${_WS_RECORDED_IDS-}"`);
/** `_ws_reclaim_moved_check` asked directly, its two lists set by hand: its rc and its why. */
const movedCheck = (nested: string, gdirs: string, ids: string, pre = ''): string =>
  h.sh(`${pre} _WS_RECORDED_GDIRS="$T_GDIRS"; _WS_RECORDED_IDS="$T_IDS"; _ws_reclaim_moved_check "$T_NESTED";`
    + ' printf \'[rc=%s] %s\' "$?" "$_WS_MOVED_WHY"', { T_GDIRS: gdirs, T_IDS: ids, T_NESTED: nested });
const MOVED_WHY = (p: string, o: string = OTHER): string =>
  `the checkout at ${p} is the directory registry row ${o} entered, whose workdir is gone — that row's tree was moved`
  + ' inside this child, so ccd cannot prove the tree is this child\'s own';

interface Other { tree: string; w: string; moved: string; ident: string }
/** Another session's tree, standing OUTSIDE the subject: a linked worktree of ANOTHER repository (`demo2`), detached at
 *  its pushed `main`, so it is clean with every commit on its remote and rung 9 alone passes it inside the subject. Its
 *  row, `demo-moved`, names the subject's project (`demo`), whose git keeps NO record of the tree, so once the tree is
 *  gone only the breadcrumb arm can place the row, and `_WS_RECORDED_GDIRS` stays empty. The row's workdir is the tree,
 *  or `sub` inside it (an empty directory, which git status never lists). With `field`, its entry field is written while
 *  the tree stands, with the identity `_ws_path_ident` measures there; without it the row is legacy. */
const standing = (subjectWt: string, sub = '', field = true): Other => {
  const main2 = h.makeGhRepo('demo2', 'o/r2');
  const tree = path.join(h.home, 'elsewhere', 'still-moved');
  fs.mkdirSync(path.dirname(tree), { recursive: true });
  h.git(main2, 'worktree', 'add', '-q', '--detach', tree);
  const w = sub ? path.join(tree, sub) : tree;
  if (sub) fs.mkdirSync(w);
  fs.writeFileSync(reg(`${OTHER}.uuid`), `u-${OTHER}`);
  fs.writeFileSync(reg(`${OTHER}.workdir`), w);
  fs.writeFileSync(reg(`${OTHER}.project`), 'demo');
  const ident = identOf(w);
  if (field) writeField(h, OTHER, `v1\t${ident}\t${Date.now()}\t${fs.realpathSync(w)}\t${w}`);
  expect(h.sh(`_ws_workdirid_read ${OTHER} "${w}"; printf '[rc=%s] %s|%s' "$?" "$_WS_WDID_STATE" "$_WS_WDID_IDENT"`),
    'the CONTROL: the field reads as written').toBe(field ? `[rc=0] valid|${ident}` : '[rc=1] legacy-absent|');
  return { tree, w, moved: path.join(subjectWt, 'vendor', 'still-moved'), ident };
};
/** The move, then ccd's own records of the row's gone tree: ws-reap's `branch` breadcrumb over a tombstone whose uuid
 *  and workdir are the row's, which both verbs leave over a workdir that was moved away. Bash, so a case can run it
 *  between a resume token and the verb. */
const goneSh = (o: Other): string =>
  `mkdir -p "${path.dirname(o.moved)}"; mv "${o.tree}" "${o.moved}"; printf '%s' branch > "${reg(`${OTHER}.reaping`)}";`
  + ` mkdir -p "${reg('.reaped')}"; printf '%s' '${JSON.stringify({ uuid: `u-${OTHER}`, workdir: o.w })}' > "${reg(`.reaped/${OTHER}.json`)}";`;

describe('the identity moved-check holds the child (path-identity spec §4.5, step 4)', () => {
  it('A1 ladder: a checkout inside the child that IS the directory a breadcrumb-placed gone row entered — containment-unproven, never a token', () => {
    const c = makeChild(h);
    const o = standing(c.wt);
    const before = evalOf(h);
    expect(before.verdict, `the CONTROL: while the other tree stands outside, the child is reclaimable — ${before.detail}`)
      .toBe('reclaimable');
    h.sh(goneSh(o));
    const moved = fs.realpathSync(o.moved);
    expect(stanza(c.main, o.w), 'the CONTROL: the row’s own project keeps no record of its tree').toBe('');
    expect(h.sh(`_ws_reclaim_foreign_clean "${moved}"; printf '%s' "$?"`), 'the CONTROL: rung 9 alone passes it').toBe('0');
    expect(identOf(moved), 'the CONTROL: the moved tree kept the identity the row recorded').toBe(o.ident);
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('containment-unproven');
    expect(r.detail).toContain(MOVED_WHY(moved));
    expect(r.token).toBe('');
    expect(rungOf(CHILD_ID, c.wt), 'the breadcrumb arm placed the row: no admin directory, its identity kept')
      .toBe(`[rc=0] [||] gdirs=[] ids=[${OTHER}\t${o.ident}\n]`);
    expect(fs.readFileSync(path.join(o.moved, 'README.md'), 'utf8'), 'the moved tree stands').toBe('hi\n');
  }, 120_000);

  it('A2 expiry: ws-expire’s ladder asks the same moved-check — containment-unproven, never a token', () => {
    const a = makeArchived(h);
    const o = standing(a.wt);
    const before = expireEvalOf(h, { pre: FAKE_PROC_SELF });
    expect(before.verdict, `the CONTROL: while the other tree stands outside, the archive expires — ${before.detail}`)
      .toBe('expirable');
    h.sh(goneSh(o));
    const moved = fs.realpathSync(o.moved);
    const r = expireEvalOf(h, { pre: FAKE_PROC_SELF });
    expect(r.verdict, r.detail).toBe('containment-unproven');
    expect(r.detail).toContain(MOVED_WHY(moved));
    expect(r.token).toBe('');
  }, 120_000);

  it('B1 owned: _ws_reclaim_owned, the tail’s re-ask, PROVES it — rc 1, with the moved-check’s why', () => {
    const c = makeChild(h);
    const o = standing(c.wt);
    expect(owned(c.wt, c.main).rc, 'the CONTROL: while the other tree stands outside, nothing is scanned').toBe('0');
    h.sh(goneSh(o));
    const moved = fs.realpathSync(o.moved);
    const a = owned(c.wt, c.main);
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toBe(MOVED_WHY(moved));
  }, 120_000);

  it('B2 verb: the reclaim tail resumed at `worktree` — containment-refuted, the other session’s moved tree standing', () => {
    const c = makeChild(h);
    const o = standing(c.wt);
    const t: Target = { act: 'reclaim', id: CHILD_ID, wt: c.wt, main: c.main, branch: CHILD_BRANCH };
    interrupted(c, 'worktree');
    const tok = resumeToken('worktree');
    expect(tok, 'the CONTROL: the resume token was minted while the other tree stood outside').toMatch(/^[0-9a-f]{64}$/);
    h.sh(goneSh(o));
    const shape: Shape = {
      plant: '', why: `is the directory registry row ${OTHER} entered, whose workdir is gone`,
      keeps: [path.join(o.moved, 'README.md')], treeStands: true,
    };
    assertRefuted(h, childReclaimVerb(h, tok, { pre: WAIT + PROC_SPY }), t, shape, 'worktree');
    if (process.platform !== 'darwin') {
      expect(lines('proc-walks').length, 'PROC_SPY: the tail’s post-kill wait walked the real /proc (CLAUDE.md lists this file)')
        .toBeGreaterThan(0);
    }
  }, 180_000);
});

describe('what it never does', () => {
  it('C1 limit: a row that entered a SUBDIRECTORY of the moved tree matches no checkout root — the child stays reclaimable (moved-check-misses-a-subdirectory-of-a-moved-tree)', () => {
    const c = makeChild(h);
    const o = standing(c.wt, 'server');
    h.sh(goneSh(o));
    const moved = fs.realpathSync(o.moved);
    expect(rungOf(CHILD_ID, c.wt), 'the CONTROL: placed, and the identity of the subdirectory it entered is kept')
      .toBe(`[rc=0] [||] gdirs=[] ids=[${OTHER}\t${o.ident}\n]`);
    expect(identOf(moved), 'the CONTROL: the checkout root is not the directory the row entered').not.toBe(o.ident);
    const r = evalOf(h);
    expect(r.verdict, `the stated limit: ${r.detail}`).toBe('reclaimable');
    expect(owned(c.wt, c.main).rc, 'and owned answers as the ladder does').toBe('0');
  }, 120_000);

  it('C2 legacy: a gone row with no entry field leaves no identity, and the moved-check answers as it did (path-identity spec §4.4)', () => {
    const c = makeChild(h);
    const o = standing(c.wt, '', false);
    h.sh(goneSh(o));
    expect(rungOf(CHILD_ID, c.wt)).toBe('[rc=0] [||] gdirs=[] ids=[]');
    const r = evalOf(h);
    expect(r.verdict, `today's answer for a legacy row: ${r.detail}`).toBe('reclaimable');
  }, 120_000);

  it('C3 per call: _WS_RECORDED_IDS lives for one rung call — the row purged, the next ask holds nothing', () => {
    const c = makeChild(h);
    const o = standing(c.wt);
    h.sh(goneSh(o));
    const parked = path.join(h.home, `${OTHER}.workdir.parked`);
    const out = h.sh(`_ws_reclaim_owned ${CHILD_ID} "${c.wt}" "${c.main}"; echo "[1:$?]";`
      + ` mv -- "${reg(`${OTHER}.workdir`)}" "${parked}";`
      + ` _ws_reclaim_owned ${CHILD_ID} "${c.wt}" "${c.main}"; printf '[2:%s] ids=[%s]' "$?" "\${_WS_RECORDED_IDS-}"`);
    expect(out).toBe('[1:1]\n[2:0] ids=[]');
  }, 120_000);
});

describe('unmeasured, never "not that tree"', () => {
  it('D1 unmeasured: a checkout whose identity cannot be measured — unmeasured at the ladder, 2 in _ws_reclaim_owned', () => {
    const c = makeChild(h);
    const o = standing(c.wt);
    h.sh(goneSh(o));
    const moved = fs.realpathSync(o.moved);
    const why = `could not read the identity of the checkout at ${moved} (stubbed: its stat failed), so whether it is a`
      + ' gone row\'s moved tree was never asked';
    const r = evalOf(h, { pre: IDENT_FAILS(moved) });
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.detail).toContain(why);
    expect(r.token).toBe('');
    const a = owned(c.wt, c.main, IDENT_FAILS(moved));
    expect(a.rc, a.why).toBe('2');
    expect(a.why).toBe(why);
  }, 120_000);
});

describe('_ws_reclaim_moved_check, asked directly', () => {
  it('U1 a nested directory that IS a recorded identity answers 1 and names its row; git is never asked while no admin directory was recorded', () => {
    const d = path.join(h.home, 'd');
    const e = path.join(h.home, 'e');
    fs.mkdirSync(d);
    fs.mkdirSync(e);
    expect(h.run(`git -C "${d}" rev-parse --absolute-git-dir`).code, 'the CONTROL: d lies in no repository, so a git read of it fails')
      .not.toBe(0);
    expect(movedCheck(`${e}\n${d}`, '', `demo-b\t${identOf(d)}\n`)).toBe(`[rc=1] ${MOVED_WHY(d, 'demo-b')}`);
  });

  const U2_ROWS: readonly [string, (di: string) => string, string][] = [
    ['the same dev:ino and the same birth time: its moved tree', (di) => `${di}:1000`, '1'],
    ['a recorded "-" birth time compares dev:ino alone', (di) => `${di}:-`, '1'],
    ['the same dev:ino, another birth time: another directory on a recycled inode', (di) => `${di}:2000`, '0'],
    ['another inode, the same birth time', (di) => { const [dev, ino] = di.split(':'); return `${dev}:${BigInt(ino) + 1n}:1000`; }, '0'],
  ];
  it.each(U2_ROWS)('U2 %s', (_what, recorded, rc) => {
    const d = path.join(h.home, 'd');
    fs.mkdirSync(d);
    const di = h.sh(`_plat_devino "${d}"`);
    expect(di, 'the CONTROL: the platform reads a dev:ino').toMatch(/^\d+:\d+$/);
    expect(h.sh(`${BT} _ws_path_ident "${d}"; printf '%s' "$_WS_IDENT"`), 'the CONTROL: the measure reads the stubbed birth time')
      .toBe(`${di}:1000`);
    expect(movedCheck(d, '', `demo-b\t${recorded(di)}\n`, BT)).toMatch(new RegExp(`^\\[rc=${rc}\\]`));
  });

  it('U3 a recorded identity the rule cannot compare (it does not parse) is unmeasured, never "not that tree"', () => {
    const d = path.join(h.home, 'd');
    fs.mkdirSync(d);
    expect(movedCheck(d, '', 'demo-b\tjunk\n')).toBe(`[rc=2] the identity registry row demo-b recorded for the directory it`
      + ` entered could not be compared with the checkout at ${d} (the identity rule answered 2), so whether that checkout`
      + ' is the row\'s moved tree was never asked');
  });

  it('U4 a checkout that cannot be measured (gone by the time it is asked) is unmeasured', () => {
    const e = path.join(h.home, 'e');
    fs.mkdirSync(e);
    const gone = path.join(h.home, 'gone');
    expect(movedCheck(gone, '', `demo-b\t${identOf(e)}\n`)).toMatch(new RegExp(`^\\[rc=2\\] could not read the identity of`
      + ` the checkout at ${esc(gone)} \\(.+\\), so whether it is a gone row's moved tree was never asked$`));
  });

  it('U5 with no recorded identity no identity is measured: every other tail asks what it asked before', () => {
    const real = fs.realpathSync(h.makeRepo('u'));
    expect(movedCheck(real, `demo-g\t${path.join(h.home, 'nowhere')}\n`, '', SPY_IDENT), 'an admin directory recorded, no identity')
      .toBe('[rc=0]');
    expect(movedCheck(real, '', '', SPY_IDENT), 'neither list holds any').toBe('[rc=0]');
    expect(lines('ident-calls'), 'no identity was measured').toEqual([]);
    expect(movedCheck(real, '', `demo-b\t${identOf(h.home)}\n`, SPY_IDENT)).toBe('[rc=0]');
    expect(lines('ident-calls'), 'the CONTROL: with one recorded, the checkout is measured once').toEqual([real]);
  });

  it('U6 a checkout whose identity cannot be measured never pre-empts a later checkout’s git-directory proof: 1, naming that row (P21)', () => {
    const p1 = fs.realpathSync(h.makeRepo('u1'));
    const p2 = fs.realpathSync(h.makeRepo('u2'));
    const gone = path.join(h.home, 'gone');
    const gdirs = `demo-g\t${fs.realpathSync(path.join(p2, '.git'))}\n`;
    const ids = `demo-b\t${identOf(h.home)}\n`;
    const why = (p: string): string =>
      `could not read the identity of the checkout at ${p} (stubbed: its stat failed), so whether it is a gone row's moved tree was never asked`;
    expect(movedCheck(p1, gdirs, ''), 'the CONTROL: p1’s git directory reads, resolves, and is not the one recorded').toBe('[rc=0]');
    expect(movedCheck(p1, '', ids, IDENT_FAILS(p1)), 'the CONTROL: the stub fails p1’s measure').toBe(`[rc=2] ${why(p1)}`);
    expect(movedCheck(`${p1}\n${p2}`, gdirs, ids, IDENT_FAILS(p1))).toBe(`[rc=1] the checkout at ${p2} uses the git directory`
      + ' git records for registry row demo-g, whose workdir is gone — that row\'s tree was moved inside this child, so ccd'
      + ' cannot prove the tree is this child\'s own');
    expect(movedCheck(`${p1}\n${gone}`, '', ids, IDENT_FAILS(p1)), 'with nothing proving, the first failure stands')
      .toBe(`[rc=2] ${why(p1)}`);
  });

  it('U7 a recorded identity the rule cannot compare never pre-empts a later recorded identity equal to the checkout: 1, naming that row (P21)', () => {
    const d = path.join(h.home, 'd');
    fs.mkdirSync(d);
    expect(movedCheck(d, '', 'demo-b\tjunk\n'), 'the CONTROL: the first recorded identity is one the rule cannot compare')
      .toMatch(/^\[rc=2\] the identity registry row demo-b /);
    expect(movedCheck(d, '', `demo-b\tjunk\ndemo-c\t${identOf(d)}\n`)).toBe(`[rc=1] ${MOVED_WHY(d, 'demo-c')}`);
    expect(movedCheck(d, '', 'demo-b\tjunk\ndemo-c\tjunk\n'), 'with nothing proving, the first failure stands')
      .toMatch(/^\[rc=2\] the identity registry row demo-b /);
  });
});

describe('the source', () => {
  it('S1 one identity measure and one identity rule in the moved-check, and the rung records only a valid field', () => {
    const src = ccdSource();
    const code = (name: string): string => {
      const from = src.indexOf(`\n${name}() {`);
      expect(from, `${name} is defined`).toBeGreaterThan(-1);
      return src.slice(from, src.indexOf('\n}\n', from)).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    };
    const mc = code('_ws_reclaim_moved_check');
    expect(mc.match(/_ws_path_ident "\$p"/g) ?? [], 'one measure, of each checkout').toHaveLength(1);
    expect(mc.match(/\b_ws_ident_eq\b/g) ?? [], 'one rule').toHaveLength(1);
    expect(mc, 'no second spelling of the measure or the rule').not.toMatch(/_ws_collect_ident|_plat_devino|_plat_btime/);
    const rung = code('_ws_reclaim_workdir_shared');
    expect(rung.match(/_WS_RECORDED_IDS\+=/g) ?? [], 'one recording site').toHaveLength(1);
    expect(rung).toContain(`[[ "$efst" != valid ]] || _WS_RECORDED_IDS+="$o"$'\\t'"$efid"$'\\n'`);
  });
});
