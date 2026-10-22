// path-identity W3, Task 8 (path-identity spec §4.8, PI10 O2): the main-checkout and record checks refuse a tree by its
// identity, and never grant one. `_ws_reclaim_record` reads git's worktree records by string, and a string hit GRANTS:
// at the ladder it passes the terminal `no-worktree-record` and names the branch, and in `_ws_reclaim_owned` it passes a
// standing tree. So device and inode never set a hit. Once the strings are read, and only while the tree stands, each
// stanza path git listed but the string-matched one is compared with it by `-ef`: git's first stanza (the main
// checkout) sets `RECLAIM_REC_MAIN`, and any other answers 2 with its reason in `_WS_REC_WHY`, unless git's main stanza
// already named the tree, whose terminal refusal then stands (REC-9). Every rc 2 carries that
// reason now; the list failure's keeps its words, and the reader's three callers continue it as before. The ladder's
// main-checkout compare gains `-ef` beside its string compare, and `_ws_reclaim_owned` measures the project directory's
// identity and the standing tree's LAST, after every proof (`_ws_path_ident`): equal devices and inodes are a proof
// (1), a measure that fails is 2, and both identities are kept for the tail.
// `_ws_realpath() { printf '%s\n' "$1"; }` stands in for the ambient resolver failing (its own header's weakness: it
// answers its input when its `cd` fails), and a symbolic link stands in for a bind spelling; nothing is mounted.
// FIXTURE HOME ONLY (`makePrHarness`): every repository, row, admin entry and link is under the HOME, and the reader,
// the ladder and the owned check run as sourced functions. The two forced-Darwin cases run the reclaim verb with the
// unit and pane calls recorded (`CHILD_STUBS`) and assert that no process table was walked (`PROC_SPY`): on Darwin the
// temp root's probe answers before it reads one, and no other case here runs a tail but EXP-2's last step. The two EXP
// cases (R75) run ws-expire's audit and verb in the record reader's two rc-2 shapes, with the expiry's probe on a
// fixture process root (`FAKE_PROC_SELF`): each answers before the tail. EXP-2 then runs the expiry to the end on its
// fresh token, the tail's in-use probe on that root too (`_ws_path_users_proc_root`), and none walks the host's /proc.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CCD } from './ccdWsHelpers.js';
import { CHILD_BRANCH, CHILD_ID, childReclaimVerb, evalOf, makeChild, type Child } from './childReclaimFixture.js';
import { verbHelpers } from './childReclaimVerbHelpers.js';
import { DARWIN_IDENT_SHIMS, DARWIN_LSOF_STUB, FAKE_PROC_SELF } from './worktreeIdentityFixture.js';
import {
  EXP_BRANCH, EXP_ID, expireAudit, expireEvalOf, expireToken, expireVerb, makeArchived, type Archived,
} from './wsExpireFixture.js';
import { refusalsOf } from './lifecycleHelpers.js';
import { parseExpireAudit, parseExpireResult } from '../src/archivedExpiry.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-reclaim-main-identity-'); });
afterEach(() => { h.cleanup(); });
const { failedPairAgrees } = verbHelpers(() => h);

/** Identity's one format (path-identity spec §4.5): `<dev>:<ino>:<btime or ->`. */
const IDENT = /^[0-9]+:[0-9]+:([1-9][0-9]*|-)$/;
/** A directory's device and inode as node reads them. */
const devino = (p: string): string => { const s = fs.statSync(p, { bigint: true }); return `${s.dev}:${s.ino}`; };
/** An identity's device and inode, its birth time dropped. */
const devinoOf = (ident: string): string => ident.split(':').slice(0, 2).join(':');

/** The ambient resolver answering its input, as it does when its `cd` fails. */
const REALPATH_ECHOES = "_ws_realpath() { printf '%s\\n' \"$1\"; };";
/** git's worktree list cannot be read (`ccd-reclaim-owned-rc.test.ts`'s shape). */
const LIST_FAILS = 'git() { case "$*" in *"worktree list"*) return 128 ;; esac; command git "$@"; };';
/** `_ws_reclaim_record`, wrapped: each call logs the path it was asked to `$HOME/rec-calls`, then the real one answers. */
const REC_SPY = 'eval "_t_rec_real()$(declare -f _ws_reclaim_record | tail -n +2)";'
  + ' _ws_reclaim_record() { printf \'%s\\n\' "$2" >> "$HOME/rec-calls"; _t_rec_real "$@"; };';
/** `_plat_devino` or `_plat_btime` failing for ONE directory, under any spelling (`-ef`), and the real one elsewhere. */
const FAILS_AT = (fn: '_plat_devino' | '_plat_btime', dir: string): string =>
  `eval "_t${fn}_real()$(declare -f ${fn} | tail -n +2)"; ${fn}() { [[ "$1" -ef '${dir}' ]] && return 1; _t${fn}_real "$@"; };`;
/** Every /proc walk the tail could start, recorded before it reads: the forced-Darwin cases assert none ran. */
const PROC_SPY = '_ws_path_users_proc_root() { echo walk >> "$HOME/proc-walks"; printf "%s" /proc; };'
  + ' _ws_expire_proc_root() { echo walk >> "$HOME/proc-walks"; printf "%s" /proc; };';
const FORCED_DARWIN = `CCD_OS=darwin; CCD_RECLAIM_TMPROOT_WAIT_S=0; ${DARWIN_LSOF_STUB}`;

const sessions = (): string => path.join(h.home, '.cc-sessions');
const linesIn = (name: string): string[] => {
  const p = path.join(h.home, name);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
};
/** git's admin directory for a checkout: `<main>/.git/worktrees/<name>`. */
const adminOf = (main: string, name: string): string => path.join(main, '.git', 'worktrees', name);
/** A second admin entry: a copy of the child's own, its `gitdir` naming `<spelling>/.git`, its HEAD DETACHED at the
 *  child's tip (so no later rung sees the child's branch held twice, and the ladder before path-identity W3 mints). */
const plantEntry = (c: Child, name: string, spelling: string): void => {
  fs.cpSync(adminOf(c.main, 'quiet-basin'), adminOf(c.main, name), { recursive: true });
  fs.writeFileSync(path.join(adminOf(c.main, name), 'gitdir'), `${spelling}/.git\n`);
  fs.writeFileSync(path.join(adminOf(c.main, name), 'HEAD'), `${c.tip}\n`);
};
/** `$HOME/wtalias`, a link to the worktrees root the child lives under; answers the child spelled through it. */
const wtAlias = (): string => {
  const alias = path.join(h.home, 'wtalias');
  fs.symlinkSync(path.join(h.home, 'worktrees', 'demo'), alias);
  return path.join(alias, 'quiet-basin');
};
/** Every path git's porcelain list names, in its order. */
const stanzas = (main: string): string[] => h.git(main, 'worktree', 'list', '--porcelain').split('\n')
  .filter((l) => l.startsWith('worktree ')).map((l) => l.slice('worktree '.length));
/** A project directory that is itself a LINKED worktree of the child's repository (`ccd-reclaim-owned-rc.test.ts`'s
 *  shape), and `projects/demo2-link`, a link to it: the project directory under another spelling. */
const linkedProject = (c: Child): { dir: string; link: string } => {
  const dir = path.join(h.home, 'projects', 'demo2');
  h.git(c.main, 'worktree', 'add', '-q', '-b', 'proj2-main', dir);
  const link = path.join(h.home, 'projects', 'demo2-link');
  fs.symlinkSync(dir, link);
  return { dir, link };
};
const row = (id: string, workdir: string): void => {
  fs.writeFileSync(path.join(sessions(), `${id}.uuid`), `u-${id}`);
  fs.writeFileSync(path.join(sessions(), `${id}.workdir`), workdir);
};

interface Rec { rc: string; main: string; prunable: string; why: string }
/** The record reader's answer: its rc, `RECLAIM_REC_MAIN`, `RECLAIM_REC_PRUNABLE` and `_WS_REC_WHY` (`<unset>` when
 *  the name does not exist). */
const rec = (main: string, p: string, pre = ''): Rec => {
  const [rc = '', m = '', prunable = '', why = ''] = h.sh(`${pre} _ws_reclaim_record "${main}" "${p}";`
    + ` printf '%s\\x1f%s\\x1f%s\\x1f%s' "$?" "$RECLAIM_REC_MAIN" "$RECLAIM_REC_PRUNABLE" "\${_WS_REC_WHY-<unset>}"`).split('\x1f');
  return { rc, main: m, prunable, why };
};
interface Owned { rc: string; why: string; mainid: string; wdid: string }
/** `_ws_reclaim_owned`'s answer and the two identities it keeps (`<unset>` when a name does not exist). */
const owned = (wd: string, main: string, pre = ''): Owned => {
  const [rc = '', why = '', mainid = '', wdid = ''] = h.sh(`${pre} _ws_reclaim_owned ${CHILD_ID} "${wd}" "${main}";`
    + ` printf '%s\\x1f%s\\x1f%s\\x1f%s' "$?" "$_WS_OWNED_WHY" "\${_WS_OWNED_MAINID-<unset>}" "\${_WS_OWNED_WDID-<unset>}"`)
    .split('\x1f');
  return { rc, why, mainid, wdid };
};

describe('_ws_reclaim_record: identity only refuses (path-identity spec §4.8, PI10 O2)', () => {
  it('REC-1 two records name the standing child: the reader answers 2 with its reason, the ladder unmeasured with no token, owned 2', () => {
    const c = makeChild(h);
    const alias = wtAlias();
    plantEntry(c, 'qb-alias', alias);
    expect(stanzas(c.main), 'the CONTROL: git lists the alias record').toContain(alias);
    expect(stanzas(c.main), 'the CONTROL: and the child’s own').toContain(c.wt);
    const why = `two of ${c.main}'s worktree records name the tree at ${c.wt}, so which one is its record was never settled`;
    expect(rec(c.main, c.wt)).toEqual({ rc: '2', main: '0', prunable: '0', why });
    const wd = h.reg(CHILD_ID, 'workdir')!;
    const e = evalOf(h);
    expect(e.verdict, e.detail).toBe('unmeasured');
    expect(e.token).toBe('');
    expect(e.detail).toBe(`two of ${c.main}'s worktree records name the tree at ${wd}, so which one is its record was never settled,`
      + ` so whether git records ${wd} was never asked`);
    const o = owned(c.wt, c.main);
    expect(o.rc, o.why).toBe('2');
    expect(o.why).toBe(`${why}, so whether git records ${c.wt} was never asked`);
  }, 120_000);

  it('REC-2 only another spelling records the standing child: the reader answers 2, the ladder unmeasured, never a hit', () => {
    const c = makeChild(h);
    const alias = wtAlias();
    fs.writeFileSync(path.join(adminOf(c.main, 'quiet-basin'), 'gitdir'), `${alias}/.git\n`);
    expect(stanzas(c.main), 'the CONTROL: git lists the child under the alias spelling').toContain(alias);
    expect(stanzas(c.main), 'the CONTROL: and under no other').not.toContain(c.wt);
    const why = `${c.main}'s worktree records name the tree at ${c.wt} only under another spelling, so which one is its record was never settled`;
    expect(rec(c.main, c.wt)).toEqual({ rc: '2', main: '0', prunable: '0', why });
    const wd = h.reg(CHILD_ID, 'workdir')!;
    const e = evalOf(h);
    expect(e.verdict, e.detail).toBe('unmeasured');
    expect(e.token).toBe('');
    expect(e.detail).toBe(`${c.main}'s worktree records name the tree at ${wd} only under another spelling, so which one is its`
      + ` record was never settled, so whether git records ${wd} was never asked`);
    const o = owned(c.wt, c.main);
    expect(o.rc, o.why).toBe('2');
    expect(o.why).toBe(`${why}, so whether git records ${c.wt} was never asked`);
  }, 120_000);

  it('REC-3 the main checkout under another spelling: RECLAIM_REC_MAIN by device and inode, and the ladder answers not-a-workspace', () => {
    const c = makeChild(h);
    const plink = path.join(h.home, 'plink');
    fs.symlinkSync(path.join(h.home, 'projects'), plink);
    const spelled = path.join(plink, 'demo');
    plantEntry(c, 'qb-main', spelled);
    expect(stanzas(c.main), 'the CONTROL: a linked record names the main checkout through the link').toContain(spelled);
    expect(rec(c.main, spelled, REALPATH_ECHOES)).toEqual({ rc: '0', main: '1', prunable: '0', why: '' });
    fs.writeFileSync(path.join(sessions(), `${CHILD_ID}.workdir`), spelled);
    const control = evalOf(h);
    expect(control.verdict, `the CONTROL: the ambient resolver sees through the link — ${control.detail}`).toBe('not-a-workspace');
    const e = evalOf(h, { pre: REALPATH_ECHOES });
    expect(e.verdict, e.detail).toBe('not-a-workspace');
    expect(e.token).toBe('');
    expect(e.detail).toBe(`${spelled} is ${c.main}'s main checkout, not a workspace of ${CHILD_ID}`);
  }, 120_000);

  it('REC-4 CONTROL: the child gone, the same alias record planted: the reader answers as it did before path-identity W3', () => {
    const c = makeChild(h);
    plantEntry(c, 'qb-alias', wtAlias());
    fs.rmSync(c.wt, { recursive: true, force: true });
    const r = rec(c.main, c.wt);
    expect({ rc: r.rc, main: r.main, prunable: r.prunable }).toEqual({ rc: '0', main: '0', prunable: '1' });
  }, 120_000);

  it('REC-5a a list that cannot be read: rc 2, and the reason keeps its words', () => {
    const c = makeChild(h);
    expect(rec(c.main, c.wt, LIST_FAILS)).toEqual({ rc: '2', main: '0', prunable: '0', why: `could not read ${c.main}'s worktree list` });
  }, 120_000);

  it('REC-5b CONTROL: the three callers print the sentence they printed before, byte for byte', () => {
    const c = makeChild(h);
    const wd = h.reg(CHILD_ID, 'workdir')!;
    const e = evalOf(h, { pre: LIST_FAILS });
    expect(e.verdict, e.detail).toBe('unmeasured');
    expect(e.detail).toBe(`could not read ${c.main}'s worktree list, so whether git records ${wd} was never asked`);
    const o = owned(c.wt, c.main, LIST_FAILS);
    expect(o.rc, o.why).toBe('2');
    expect(o.why).toBe(`could not read ${c.main}'s worktree list, so whether git records ${c.wt} was never asked`);
    fs.rmSync(c.wt, { recursive: true, force: true });
    const g = evalOf(h, { pre: LIST_FAILS });
    expect(g.verdict, g.detail).toBe('unmeasured');
    expect(g.detail).toBe(`could not read ${c.main}'s worktree list, so whether git still records ${wd} was never asked`);
  }, 120_000);

  it('REC-6 the git arm shadows the reason: asking `_ws_reclaim_recorded_git` never changes what a caller read', () => {
    const c = makeChild(h);
    fs.rmSync(c.wt, { recursive: true, force: true });
    const out = h.sh(`${LIST_FAILS} ${REC_SPY} _WS_REC_WHY=sentinel; _ws_reclaim_recorded_git ${CHILD_ID} "${c.wt}";`
      + ' printf \'[rc=%s] %s\' "$?" "$_WS_REC_WHY"');
    expect(linesIn('rec-calls'), 'the CONTROL: the arm reached the reader, once').toEqual([c.wt]);
    expect(out).toBe('[rc=1] sentinel');
  }, 120_000);

  it('REC-7 the breadcrumb arm shadows the reason too', () => {
    const c = makeChild(h);
    fs.rmSync(c.wt, { recursive: true, force: true });
    fs.writeFileSync(path.join(sessions(), `${CHILD_ID}.reaping`), 'branch');
    fs.mkdirSync(path.join(sessions(), '.reaped'), { recursive: true });
    fs.writeFileSync(path.join(sessions(), '.reaped', `${CHILD_ID}.json`),
      JSON.stringify({ id: CHILD_ID, uuid: h.reg(CHILD_ID, 'uuid'), workdir: c.wt }));
    const out = h.sh(`${LIST_FAILS} ${REC_SPY} _WS_REC_WHY=sentinel; _ws_reclaim_recorded_crumb ${CHILD_ID} "${c.wt}";`
      + ' printf \'[rc=%s] %s\' "$?" "$_WS_REC_WHY"');
    expect(linesIn('rec-calls'), 'the CONTROL: the arm reached the reader, once').toEqual([c.wt]);
    expect(out).toBe('[rc=1] sentinel');
  }, 120_000);

  it('REC-8 _ws_reclaim_reset clears the reason', () => {
    expect(h.sh('_WS_REC_WHY=x; _ws_reclaim_reset; printf "[%s]" "${_WS_REC_WHY-<unset>}"')).toBe('[]');
  }, 60_000);

  it('REC-9 a string hit on git’s main stanza, beside a record naming the main checkout under another spelling: rc 0 with RECLAIM_REC_MAIN, and the ladder keeps not-a-workspace', () => {
    const c = makeChild(h);
    const plink = path.join(h.home, 'plink');
    fs.symlinkSync(path.join(h.home, 'projects'), plink);
    const spelled = path.join(plink, 'demo');
    plantEntry(c, 'qb-main', spelled);
    expect(stanzas(c.main), 'the CONTROL: a linked record names the main checkout through the link').toContain(spelled);
    expect(rec(c.main, c.main)).toEqual({ rc: '0', main: '1', prunable: '0', why: '' });
    fs.writeFileSync(path.join(sessions(), `${CHILD_ID}.workdir`), c.main);
    const e = evalOf(h);
    expect(e.verdict, e.detail).toBe('not-a-workspace');
    expect(e.token).toBe('');
    expect(e.detail).toBe(`${c.main} is ${c.main}'s main checkout, not a workspace of ${CHILD_ID}`);
    const o = owned(c.main, c.main);
    expect(o.rc, o.why).toBe('1');
    expect(o.why, 'the main-checkout proof answered, not the realpath compare after it').toBe(`${c.main} is ${c.main}'s main checkout`);
  }, 120_000);
});

describe('ws-expire in the record reader’s two rc-2 shapes: answered before the tail, asked afresh, never parked (R75)', () => {
  /** The host's process-table walks recorded (`PROC_SPY`), then the expiry's probe pointed at a fixture root
   *  (`FAKE_PROC_SELF`, after the spy, so its root wins): no case here walks the host's /proc. */
  const EXP_PRE = `${PROC_SPY} ${FAKE_PROC_SELF}`;
  /** The tail's in-use probe on the same fixture root: `_ws_path_users_proc_root`, ccd's own seam for it, redefined
   *  after `EXP_PRE` (a later definition wins) to log each ask to `$HOME/fake-walks` and answer `$HOME/fp`, the root
   *  `FAKE_PROC_SELF` plants. Its one entry is ccd's own pid, which the walk skips, so it answers that nobody uses the
   *  temp root without reading the host's /proc (consent 7455's completed expiry, EXP-2). */
  const FAKE_USERS_ROOT = '_ws_path_users_proc_root() { echo walk >> "$HOME/fake-walks"; printf "%s" "$HOME/fp"; };';
  /** A second admin entry for the archived tree: a copy of its own, its `gitdir` naming `<spelling>/.git`, its HEAD
   *  DETACHED at the tree's tip, as `plantEntry` plants one for the child. */
  const plantExpEntry = (a: Archived, name: string, spelling: string): void => {
    fs.cpSync(adminOf(a.main, 'quiet-dune'), adminOf(a.main, name), { recursive: true });
    fs.writeFileSync(path.join(adminOf(a.main, name), 'gitdir'), `${spelling}/.git\n`);
    fs.writeFileSync(path.join(adminOf(a.main, name), 'HEAD'), `${a.tip}\n`);
  };
  /** Everything an unmeasured answer or a refusal leaves standing, and no walk of the host's /proc. */
  const intact = (a: Archived): void => {
    expect(fs.existsSync(path.join(a.wt, 'f1.txt')), 'the archived tree stands').toBe(true);
    expect(h.git(a.main, 'branch', '--list', EXP_BRANCH), 'its branch stands').toContain(EXP_BRANCH);
    expect(h.reg(EXP_ID, 'archived'), 'the archive stands').not.toBeNull();
    expect(h.reg(EXP_ID, 'reaping'), 'no breadcrumb was written').toBeNull();
    expect(fs.existsSync(path.join(sessions(), '.reaped', `${EXP_ID}.json`)), 'no tombstone: nothing was pinned').toBe(false);
    expect(h.calls().filter((l) => l.startsWith('unsupervise')), 'the unit was not touched').toEqual([]);
    expect(h.calls(), 'the pane was not touched').not.toContain(`tmux kill-session -t =cc-${EXP_ID}:`);
    expect(linesIn('proc-walks'), 'no walk of the host’s /proc').toEqual([]);
  };

  it('EXP-1 two records name the archived tree (REC-1’s shape): ws-expire answers unmeasured, removes nothing and mints no token', () => {
    const a = makeArchived(h);
    const wd = h.reg(EXP_ID, 'workdir')!;
    expect(fs.existsSync(adminOf(a.main, 'quiet-dune')), 'the CONTROL: git’s admin entry for the tree').toBe(true);
    const tok = expireToken(h, { pre: EXP_PRE });
    expect(tok, 'the CONTROL: the expiry ladder passes before the plant').toMatch(/^[0-9a-f]{64}$/);
    const alias = path.join(path.dirname(wtAlias()), 'quiet-dune');
    plantExpEntry(a, 'qd-alias', alias);
    expect(stanzas(a.main), 'the CONTROL: git lists the alias record').toContain(alias);
    expect(stanzas(a.main), 'the CONTROL: and the tree’s own').toContain(a.wt);
    const e = expireEvalOf(h, { pre: EXP_PRE });
    expect(e.verdict, e.detail).toBe('unmeasured');
    expect(e.token).toBe('');
    expect(e.detail).toBe(`two of ${a.main}'s worktree records name the tree at ${wd}, so which one is its record was never settled,`
      + ` so whether git records ${wd} was never asked`);
    const audit = expireAudit(h, { pre: EXP_PRE });
    expect(audit.code, 'an unmeasured audit exits 1').toBe(1);
    const doc = JSON.parse(audit.stdout) as Record<string, unknown>;
    expect(doc['verdict']).toBe('unmeasured');
    expect(doc['token'], 'no token is minted').toBeUndefined();
    expect(doc['detail']).toBe(e.detail);
    const r = expireVerb(h, tok, { pre: EXP_PRE });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(JSON.parse(r.stdout), 'the token minted before the plant carries nothing: the lock asks the ladder again')
      .toEqual({ failed: 'probe-unmeasured', detail: e.detail, crumb: false });
    intact(a);
  }, 120_000);

  it('EXP-2 only another spelling records the archived tree (REC-2’s shape): each pass asks afresh, the lane reads unmeasured with its why, and nothing carries to the next pass', () => {
    const a = makeArchived(h);
    const wd = h.reg(EXP_ID, 'workdir')!;
    const own = path.join(adminOf(a.main, 'quiet-dune'), 'gitdir');
    const recorded = fs.readFileSync(own, 'utf8');
    const tok = expireToken(h, { pre: EXP_PRE });
    expect(tok, 'the CONTROL: the expiry ladder passes before the plant').toMatch(/^[0-9a-f]{64}$/);
    const alias = path.join(path.dirname(wtAlias()), 'quiet-dune');
    fs.writeFileSync(own, `${alias}/.git\n`);
    expect(stanzas(a.main), 'the CONTROL: git lists the tree under the alias spelling').toContain(alias);
    expect(stanzas(a.main), 'the CONTROL: and under no other').not.toContain(a.wt);
    const why = `${a.main}'s worktree records name the tree at ${wd} only under another spelling, so which one is its`
      + ` record was never settled, so whether git records ${wd} was never asked`;
    // Pass 1, audited twice as the lane audits on each of its passes: each audit asks the whole ladder, mints no token
    // and exits 1, which the lane reads as unmeasured with its why, never as a terminal refusal it would park.
    for (const n of [1, 2]) {
      const audit = expireAudit(h, { pre: EXP_PRE });
      expect(audit.code, `audit ${n} exits 1: unmeasured`).toBe(1);
      const doc = JSON.parse(audit.stdout) as Record<string, unknown>;
      expect(doc['verdict'], `audit ${n}`).toBe('unmeasured');
      expect(doc['token'], `audit ${n} mints no token`).toBeUndefined();
      expect(parseExpireAudit(EXP_ID, audit.code === 0, audit.stdout), `the lane's read of audit ${n}`)
        .toEqual({ kind: 'unreadable', detail: `ws-audit --expire measured nothing: ${why}` });
    }
    expect(refusalsOf(h.home), 'never journaled as the terminal no-worktree-record')
      .not.toContainEqual({ act: 'expire', token: 'no-worktree-record' });
    // The token minted before the plant carries nothing into this state: the verb asks the whole ladder again in its lock.
    const r1 = expireVerb(h, tok, { pre: EXP_PRE });
    expect(r1.code, r1.stdout + r1.stderr).toBe(1);
    expect(parseExpireResult(EXP_ID, r1.stdout, r1.stderr), 'the lane starts its next pass from a fresh audit')
      .toEqual({ kind: 'restart', detail: `probe-unmeasured: ${why}` });
    intact(a);
    // Pass 2: git's record names the tree by its string again. A fresh audit asks the whole ladder and mints its own
    // token, and the verb re-proves the token it is given inside its lock, so one this pass did not mint refuses.
    fs.writeFileSync(own, recorded);
    expect(stanzas(a.main), 'the CONTROL: git lists the tree by its own spelling again').toContain(a.wt);
    const audit2 = expireAudit(h, { pre: EXP_PRE });
    expect(audit2.code, audit2.stdout + audit2.stderr).toBe(0);
    const read2 = parseExpireAudit(EXP_ID, true, audit2.stdout);
    expect(read2.kind === 'document' ? read2.verdict.kind : read2.kind, 'the whole ladder passes, asked afresh').toBe('expirable');
    const r2 = expireVerb(h, 'f'.repeat(64), { pre: EXP_PRE });
    expect(r2.code, r2.stdout + r2.stderr).toBe(0);
    expect((JSON.parse(r2.stdout) as Record<string, unknown>)['refused'], 'a token this pass did not mint').toBe('state-changed');
    intact(a);
    // The token this pass minted completes it: the verb runs the tail to the end, so a row the terminal
    // no-worktree-record would have parked expires once git's record names the tree by its string (consent 7455).
    const fresh = read2.kind === 'document' && read2.verdict.kind === 'expirable' ? read2.verdict.token : '';
    expect(fresh, 'the CONTROL: the fresh audit minted its own token').toMatch(/^[0-9a-f]{64}$/);
    const r3 = expireVerb(h, fresh, { pre: `${EXP_PRE} ${FAKE_USERS_ROOT}` });
    expect(r3.code, r3.stdout + r3.stderr).toBe(0);
    expect(parseExpireResult(EXP_ID, r3.stdout, r3.stderr).kind, r3.stdout).toBe('expired');
    expect((JSON.parse(r3.stdout) as Record<string, unknown>)['expired']).toBe(EXP_ID);
    expect(fs.existsSync(a.wt), 'the worktree went').toBe(false);
    expect(h.git(a.main, 'branch', '--list', EXP_BRANCH), 'the branch went').toBe('');
    for (const field of ['uuid', 'archived', 'reaping', 'workdir']) expect(h.reg(EXP_ID, field), field).toBeNull();
    const attic = h.git(a.main, 'for-each-ref', '--format=%(refname)', `refs/ccrc/attic/${EXP_ID}/`).split('\n').filter(Boolean);
    expect(attic.length ? h.git(a.main, 'rev-list', ...attic).split('\n') : [], 'the branch tip is kept in the attic')
      .toContain(a.tip);
    // Host-dependent: this fake root is only walked on a host that reads a /proc; a real Darwin host asks lsof instead.
    expect(linesIn('fake-walks').length > 0, 'the CONTROL: the in-use probe walked the fixture root').toBe(process.platform !== 'darwin');
    expect(linesIn('proc-walks'), 'no walk of the host’s /proc').toEqual([]);
  }, 180_000);
});

describe('_ws_reclaim_owned: the project directory by device and inode, asked last (path-identity spec §4.8)', () => {
  it('OWN-1 the tree is the project directory under another spelling: 1, by device and inode', () => {
    const c = makeChild(h);
    const p = linkedProject(c);
    const control = owned(p.dir, p.link);
    expect(control.rc, `the CONTROL: the ambient resolver sees through the link — ${control.why}`).toBe('1');
    const o = owned(p.dir, p.link, REALPATH_ECHOES);
    expect(o.rc, o.why).toBe('1');
    expect(o.why).toBe(`${p.dir} is the project directory ${p.link} itself, under another spelling`);
  }, 120_000);

  it('OWN-2 the project directory cannot be stat’d: 2, never a pass and never a proof', () => {
    const c = makeChild(h);
    const o = owned(c.wt, c.main, FAILS_AT('_plat_devino', c.main));
    expect(o.rc, o.why).toBe('2');
    expect(o.why).toContain(`the identity of the project directory ${c.main} could not be measured`);
    expect(o.mainid).toBe('');
  }, 120_000);

  it('OWN-3 a birth time that is not a number: 2', () => {
    const c = makeChild(h);
    const o = owned(c.wt, c.main, '_plat_btime() { echo x; };');
    expect(o.rc, o.why).toBe('2');
    expect(o.why).toContain(`the identity of the project directory ${c.main} could not be measured`);
  }, 120_000);

  it('OWN-4 the tree’s own identity cannot be measured: 2, the project directory’s kept', () => {
    const c = makeChild(h);
    const o = owned(c.wt, c.main, FAILS_AT('_plat_btime', c.wt));
    expect(o.rc, o.why).toBe('2');
    expect(o.why).toContain(`the identity of the tree at ${c.wt} could not be measured`);
    expect(o.mainid).toMatch(IDENT);
    expect(o.wdid).toBe('');
  }, 120_000);

  it('OWN-5 the order: a proof stands before a measure that fails, so a SHARED row is still 1', () => {
    const c = makeChild(h);
    row('demo-twin', c.wt);
    const o = owned(c.wt, c.main, FAILS_AT('_plat_devino', c.main));
    expect(o.rc, o.why).toBe('1');
    expect(o.why).toBe(`${c.wt} is also named by registry row(s) demo-twin`);
  }, 120_000);

  it('OWN-6 CONTROL: the child’s own tree is 0, and both identities are kept, each its own directory’s', () => {
    const c = makeChild(h);
    const o = owned(c.wt, c.main);
    expect(o.rc, o.why).toBe('0');
    expect(o.why).toBe('');
    expect(o.mainid).toMatch(IDENT);
    expect(o.wdid).toMatch(IDENT);
    expect(devinoOf(o.mainid)).toBe(devino(c.main));
    expect(devinoOf(o.wdid)).toBe(devino(c.wt));
  }, 120_000);

  it('OWN-7 a vanished tree: 0, the project directory measured and the tree’s identity empty', () => {
    const c = makeChild(h);
    fs.rmSync(c.wt, { recursive: true, force: true });
    const o = owned(c.wt, c.main);
    expect(o.rc, o.why).toBe('0');
    expect(o.wdid).toBe('');
    expect(o.mainid).toMatch(IDENT);
  }, 120_000);

  it('OWN-8 each call clears both identities first: an answer given before the measures leaves them empty', () => {
    const c = makeChild(h);
    const out = h.sh(`_ws_reclaim_owned ${CHILD_ID} "${c.wt}" "${c.main}"; _ws_reclaim_owned ${CHILD_ID} "${c.wt}/" "${c.main}";`
      + ' printf \'%s|%s|%s\' "$?" "${_WS_OWNED_MAINID-<unset>}" "${_WS_OWNED_WDID-<unset>}"');
    expect(out).toBe('1||');
  }, 120_000);
});

describe('_ws_reclaim_ladder: -ef beside its string compare of the project directory (R17)', () => {
  it('LAD-1 a row naming the project directory under another spelling: not-a-workspace, by device and inode', () => {
    const c = makeChild(h);
    const p = linkedProject(c);
    fs.writeFileSync(path.join(sessions(), `${CHILD_ID}.project`), 'demo2-link');
    fs.writeFileSync(path.join(sessions(), `${CHILD_ID}.workdir`), p.dir);
    const control = evalOf(h);
    expect(control.verdict, `the CONTROL: the ambient resolver sees through the link — ${control.detail}`).toBe('not-a-workspace');
    expect(control.detail).toBe(`${p.dir} is the project directory ${p.link} itself, not a workspace of ${CHILD_ID}`);
    const e = evalOf(h, { pre: REALPATH_ECHOES });
    expect(e.verdict, e.detail).toBe('not-a-workspace');
    expect(e.token).toBe('');
    expect(e.detail).toBe(`${p.dir} is the project directory ${p.link} itself, under another spelling, not a workspace of ${CHILD_ID}`);
  }, 120_000);
});

describe('forced Darwin: the owned check measures through `_plat_devino` and `_plat_btime` (P13)', () => {
  it('DAR-1 CONTROL: with the identity shims the child is reclaimed, and no process table is walked', () => {
    const c = makeChild(h);
    const r = childReclaimVerb(h, evalOf(h).token, { pre: `${FORCED_DARWIN} ${DARWIN_IDENT_SHIMS} ${PROC_SPY}` });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect((JSON.parse(r.stdout) as { reclaimed: string }).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(c.wt), 'the tree went').toBe(false);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the branch went').toBe('');
    expect(linesIn('proc-walks'), 'no process table was walked').toEqual([]);
  }, 120_000);

  it.skipIf(process.platform === 'darwin')('DAR-2 without them on a GNU host: the owned check cannot measure, so worktree-remove-failed and nothing further deleted', () => {
    const c = makeChild(h);
    const r = childReclaimVerb(h, evalOf(h).token, { pre: `${FORCED_DARWIN} ${PROC_SPY}` });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('worktree-remove-failed');
    expect(o.detail).toContain(`the identity of the project directory ${c.main} could not be measured`);
    failedPairAgrees(r);
    expect(fs.existsSync(c.wt), 'the tree stands').toBe(true);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the branch stands').toContain(CHILD_BRANCH);
    expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays, for the retry').toBe('reclaim:children');
    expect(linesIn('proc-walks'), 'no process table was walked').toEqual([]);
  }, 120_000);
});

describe('the source: identity only refuses, and the owned check measures last (path-identity spec §4.8)', () => {
  const src = fs.readFileSync(CCD, 'utf8');
  /** `name`'s body, from its head line to its first closing brace at column 0, or '' when it is not defined. */
  const bodyOf = (name: string): string => {
    const a = src.indexOf(`\n${name}() {`);
    const b = a > -1 ? src.indexOf('\n}\n', a) : -1;
    return b > a ? src.slice(a, b) : '';
  };
  const codeOf = (name: string): string[] => bodyOf(name).split('\n').filter((l) => !/^\s*#/.test(l));

  it('SRC-1 the record reader asks -ef once, only under [[ -d "$path" ]], and never sets a hit from it', () => {
    const code = codeOf('_ws_reclaim_record');
    expect(code.length, 'the reader could not be sliced').toBeGreaterThan(20);
    const open = code.findIndex((l) => l.startsWith('  if [[ -d "$path" ]]; then'));
    expect(open, 'the identity pass is guarded by -d').toBeGreaterThan(-1);
    const close = code.findIndex((l, i) => i > open && l === '  fi');
    expect(close).toBeGreaterThan(open);
    const efs = code.flatMap((l, i) => (/\s-ef\s/.test(l) ? [i] : []));
    expect(efs, 'one -ef').toHaveLength(1);
    expect(efs[0]).toBeGreaterThan(open);
    expect(efs[0]).toBeLessThan(close);
    const pass = code.slice(open, close + 1).join('\n');
    expect(pass, 'identity sets no hit, no stanza and no value read from one')
      .not.toMatch(/\b(?:hit|hitn|m)=|RECLAIM_REC_(?:BRANCH|HEAD|PRUNABLE)=/);
    expect(pass).toContain('RECLAIM_REC_MAIN=1');
    expect(pass).toMatch(/\breturn 2\b/);
  });

  it('SRC-2 the ladder asks -ef directly after its string compare of the project directory', () => {
    const code = codeOf('_ws_reclaim_ladder');
    const str = code.findIndex((l) => l.includes('[[ "$(_ws_realpath "$workdir")" != "$(_ws_realpath "$main")" ]]'));
    expect(str).toBeGreaterThan(-1);
    expect(code[str + 2]).toBe('  [[ ! "$workdir" -ef "$main" ]] \\');
    expect(code[str + 3]).toContain(
      '_reap_refuse not-a-workspace "$workdir is the project directory $main itself, under another spelling, not a workspace of $id"');
  });

  it('SRC-3 the owned check measures the two identities after its moved-tree check, directly before its last return 0 (P21)', () => {
    const code = codeOf('_ws_reclaim_owned');
    const rows = code.findIndex((l) => l.startsWith('  _ws_reclaim_workdir_shared "$id" "$wd"'));
    const moved = code.findIndex((l) => l.includes('_ws_reclaim_moved_check '));
    const measures = code.flatMap((l, i) => (l.includes('_ws_path_ident ') ? [i] : []));
    expect(rows).toBeGreaterThan(-1);
    expect(moved).toBeGreaterThan(rows);
    expect(measures, 'two measures: the project directory, followed, and the tree').toHaveLength(2);
    expect(code[measures[0]!]).toBe('  _ws_path_ident "$main" follow \\');
    expect(code[measures[1]!]).toBe('    _ws_path_ident "$wd" \\');
    expect(measures[0]).toBeGreaterThan(moved);
    expect(code[code.length - 1]).toBe('  return 0');
  });
});
