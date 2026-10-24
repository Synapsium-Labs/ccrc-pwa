// path-identity W2, Task 5 (path-identity spec §3.5; TR5 C, the worktree half). The reclaim and expiry tail asks the
// mount question before every STANDING forced worktree removal. Nothing measured says git's forced recursive delete
// stops at a mount, and a FUSE daemon outlives the pane kill, so a mount inside a tree the tail removes could be
// emptied through. Each standing nested checkout (step 3) and the child's own tree (step 4) is asked
// `_ws_removal_mounts_clear` directly before its `_ws_reclaim_keep_of` and again directly before its forced removal.
// Step 4 asks with `resolve`: the record's spelling may run through a symlinked ancestor, and the kernel's table names
// the physical mount point. Either answer fails `worktree-remove-failed`, with the breadcrumb and the tree standing.
// The vanished arms ask nothing, and on Darwin the helper's one guard answers before any table is read.
// MOUNTS ARE FAKED, NEVER MADE: `_ws_collect_mountinfo` is pointed at `$HOME/mountinfo` (`MOUNTS_SEAM`), a copy of this
// process's own table (`realMounts`) with lines appended. Nothing here mounts anything.
// FIXTURE HOME ONLY (`makePrHarness`): both verbs run as SOURCED functions with the unit and pane calls recorded
// (`CHILD_STUBS`, `EXP_STUBS`, which `childReclaimVerb` and `expireVerb` prepend), the temp root's in-use probe
// answering "nobody", and every path derived from `h.home`. The cases that read a table run on Linux only; the Darwin
// pins and the source pins run on every host.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CCD } from './ccdWsHelpers.js';
import { eventsOf } from './lifecycleHelpers.js';
import { CHILD_BRANCH, CHILD_ID, childReclaimVerb, evalOf, makeChild, type Child } from './childReclaimFixture.js';
import { verbHelpers } from './childReclaimVerbHelpers.js';
import { EXP_BRANCH, EXP_ID, expireToken, expireVerb, makeArchived } from './wsExpireFixture.js';
import { MOUNTS_SEAM, realMounts } from './wsCollectFixture.js';
import { DARWIN_IDENT_SHIMS, DARWIN_LSOF_STUB } from './worktreeIdentityFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-reclaim-tail-mounts-'); });
afterEach(() => { h.cleanup(); });
const { interrupted, resumeToken, failedPairAgrees } = verbHelpers(() => h);

const LINUX = process.platform === 'linux';
type Run = { code: number; stdout: string; stderr: string };
type Doc = { failed?: string; detail?: string; reclaimed?: string; expired?: string };
const docOf = (r: Run): Doc => JSON.parse(r.stdout) as Doc;

/** A mount point as the kernel's table writes it: space, tab, newline and backslash encoded. */
const encoded = (p: string): string =>
  p.replace(/\\/g, '\\134').replace(/ /g, '\\040').replace(/\t/g, '\\011').replace(/\n/g, '\\012');
/** One line of a mount table naming `p` (physical) as a mount point: Task 4's shape. */
const MOUNT_LINE = (p: string): string => `9999 1 0:99 / ${encoded(p)} rw,relatime - tmpfs tmpfs rw`;
/** Appends a mount at `p` to the faked table now. */
const mountAt = (p: string): void => { fs.appendFileSync(path.join(h.home, 'mountinfo'), `${MOUNT_LINE(p)}\n`); };
/** Arms `KEEP_LOG`: once `_ws_reclaim_keep_of` answers 0 for the path spelled `spelling`, a mount at `p` appears. */
const mountOnceKept = (spelling: string, p: string): void => {
  fs.writeFileSync(path.join(h.home, 'mount-when'), spelling);
  fs.writeFileSync(path.join(h.home, 'mount-later'), `${MOUNT_LINE(p)}\n`);
};
const linesIn = (name: string): string[] => {
  const p = path.join(h.home, name);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
};

/** The temp root's in-use probe answering "nobody", so the tail's wait never runs the real walk of /proc. */
const NOBODY = '_ws_path_users() { _WS_PATH_USERS_PIDS=""; _WS_PATH_USERS_WHY=""; return 0; };';
/** Task 4's poison: any read of the mount table is recorded in `$HOME/mi-called`, and the table cannot be read. */
const POISON = '_ws_collect_mountinfo() { echo x >> "$HOME/mi-called"; printf "%s" "$HOME/no-such-table"; };';
/** `_ws_reclaim_keep_of`, wrapped: logs its `$4` (the path or branch it keeps for) to `$HOME/keep-calls`, runs the
 *  real one, and, once that answered 0 for the spelling in `$HOME/mount-when`, appends `$HOME/mount-later` to the
 *  faked table: a mount that appears between the two asks. */
const KEEP_LOG = 'eval "_t_keep_real()$(declare -f _ws_reclaim_keep_of | tail -n +2)";'
  + ' _ws_reclaim_keep_of() { local r; printf \'%s\\n\' "$4" >> "$HOME/keep-calls"; _t_keep_real "$@"; r=$?;'
  + ' if (( r == 0 )) && [[ -f "$HOME/mount-when" ]] && [[ "$4" == "$(cat "$HOME/mount-when")" ]]; then'
  + ' cat "$HOME/mount-later" >> "$HOME/mountinfo"; fi; return "$r"; };';
/** `_ws_removal_mounts_clear`, wrapped: logs `<dir>|<mode>` to `$HOME/ask-calls`, then asks the real one. */
const ASK_LOG = 'eval "_t_ask_real()$(declare -f _ws_removal_mounts_clear | tail -n +2)";'
  + ' _ws_removal_mounts_clear() { printf \'%s|%s\\n\' "$1" "${2-}" >> "$HOME/ask-calls"; _t_ask_real "$@"; };';
/** `_ws_removal_mounts_clear`, wrapped: directly before its `nth` call for the path spelled `spelling`, a mount at `p`
 *  (`MOUNT_LINE`) is appended to the faked table, then the real one is asked. Since path-identity W3 the rows rung
 *  reads the same table at the verb's in-lock recompute and at the tail's owned call, and holds the child there, so a
 *  mount planted before the verb is caught before any of these asks (`w2-mount-asks-shadowed-by-the-reask`). A case
 *  that pins one of the tail's own asks plants its mount at that ask. With `ASK_LOG`, it goes first, so `ASK_LOG`
 *  wraps it and logs each call once. */
const MOUNT_AT_ASK = (spelling: string, p: string, nth: number): string =>
  'eval "_t_at_ask_real()$(declare -f _ws_removal_mounts_clear | tail -n +2)";'
  + ` _ws_removal_mounts_clear() { if [[ "$1" == '${spelling}' ]]; then _T_AT_ASK_N=$(( \${_T_AT_ASK_N:-0} + 1 ));`
  + ` (( _T_AT_ASK_N != ${nth} )) || printf '%s\\n' '${MOUNT_LINE(p)}' >> "$HOME/mountinfo"; fi; _t_at_ask_real "$@"; };`;
/** `_ws_dir_physical` failing for the mount helper's `resolve` only: every other caller asks the real one. */
const PHYS_FAILS_AT_THE_ASK = 'eval "_t_phys_real()$(declare -f _ws_dir_physical | tail -n +2)";'
  + ' _ws_dir_physical() { if [[ "${FUNCNAME[1]-}" == _ws_removal_mounts_clear ]]; then'
  + ' _WS_PHYS=""; _WS_PHYS_WHY="stub: $1 could not be entered"; return 1; fi; _t_phys_real "$@"; };';
const LINUX_PRE = `${MOUNTS_SEAM} ${NOBODY} ${KEEP_LOG}`;
const DARWIN_PRE = `CCD_OS=darwin; ${DARWIN_IDENT_SHIMS} ${POISON} ${ASK_LOG} ${DARWIN_LSOF_STUB}`;

/** How many times the helper was asked of `spelling` in `mode` ('' or 'resolve'). */
const asked = (spelling: string, mode = ''): number =>
  linesIn('ask-calls').filter((l) => l === `${spelling}|${mode}`).length;
const reclaimToken = (): string => {
  const a = evalOf(h);
  expect(a.token, `the CONTROL: the ladder passes — ${a.verdict}: ${a.detail}`).toMatch(/^[0-9a-f]{64}$/);
  return a.token;
};
const workdirOf = (id: string): string => {
  const w = h.reg(id, 'workdir');
  expect(w, 'the CONTROL: the registry row names a workdir').not.toBeNull();
  return w!;
};
/** A standing nested checkout of the child's own repository, holding a file of its own. */
const nested = (c: Child): string => {
  const inner = path.join(c.wt, 'inner');
  h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
  fs.writeFileSync(path.join(inner, 'f'), 'nested work\n');
  return inner;
};
/** The fleet's layout, made BEFORE the child: `$HOME/worktrees` a link to `$HOME/wtreal`. */
const linkedRoot = (): void => {
  const real = path.join(h.home, 'wtreal');
  fs.mkdirSync(real);
  fs.symlinkSync(real, path.join(h.home, 'worktrees'));
};
/** Exit 1 and `worktree-remove-failed`: the document a mount answer leaves. */
const mountFailed = (r: Run): Doc => {
  expect(r.code, r.stdout + r.stderr).toBe(1);
  const o = docOf(r);
  expect(o.failed).toBe('worktree-remove-failed');
  return o;
};
/** The CONTROL, after a Darwin subject: the poison records a read, so its absence there means none was made. */
const poisonIsLive = (): void => {
  expect(h.sh(`${POISON} _ws_collect_mounts_clear "$HOME"; printf '[rc=%s]' "$?"`)).toBe('[rc=2]');
  expect(fs.existsSync(path.join(h.home, 'mi-called')), 'the poison records a read').toBe(true);
};

describe.skipIf(!LINUX)('the tail asks the mount question before every standing forced worktree removal (path-identity spec §3.5)', () => {
  it('N1: a mount under a standing nested checkout fails worktree-remove-failed before its keep_of; the checkout and its branch stand', () => {
    const c = makeChild(h);
    const inner = nested(c);
    const realInner = fs.realpathSync(inner);
    realMounts(h);
    const r = childReclaimVerb(h, reclaimToken(), { pre: `${LINUX_PRE} ${MOUNT_AT_ASK(realInner, path.join(realInner, 'mnt'), 1)}` });
    const o = mountFailed(r);
    expect(o.detail).toMatch(/^something is mounted at /);
    expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays at the step that failed').toBe('reclaim:children');
    expect(fs.readFileSync(path.join(inner, 'f'), 'utf8'), 'the nested checkout stands').toBe('nested work\n');
    expect(h.git(c.main, 'branch', '--list', 'ws/nested'), 'its branch stands').toContain('ws/nested');
    expect(fs.existsSync(path.join(c.wt, 'f1.txt')), 'the child’s tree stands').toBe(true);
    expect(linesIn('keep-calls').filter((l) => l === realInner), 'keep_of was never asked of the checkout').toEqual([]);
    failedPairAgrees(r);
  }, 120_000);

  it('N2: a mount that appears during the checkout’s keep_of is caught by the second ask, before the forced removal', () => {
    const c = makeChild(h);
    const inner = nested(c);
    const realInner = fs.realpathSync(inner);
    realMounts(h);
    const r = childReclaimVerb(h, reclaimToken(), { pre: `${LINUX_PRE} ${MOUNT_AT_ASK(realInner, path.join(realInner, 'mnt'), 2)}` });
    const o = mountFailed(r);
    expect(o.detail).toMatch(/^something is mounted at /);
    expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays at the step that failed').toBe('reclaim:children');
    expect(fs.existsSync(path.join(inner, 'f')), 'the nested checkout’s file stands').toBe(true);
    expect(h.git(c.main, 'branch', '--list', 'ws/nested'), 'its branch stands').toContain('ws/nested');
    expect(linesIn('keep-calls'), 'the CONTROL: keep_of ran for the checkout, and the mount appeared inside it').toContain(realInner);
    failedPairAgrees(r);
  }, 120_000);

  it('C1: a mount under the child’s own tree fails worktree-remove-failed before its keep_of; the tree and its branch stand', () => {
    const c = makeChild(h);
    const wd = workdirOf(CHILD_ID);
    realMounts(h);
    const r = childReclaimVerb(h, reclaimToken(), { pre: `${LINUX_PRE} ${MOUNT_AT_ASK(wd, path.join(fs.realpathSync(c.wt), 'sub'), 1)}` });
    const o = mountFailed(r);
    expect(o.detail).toMatch(/^something is mounted at /);
    expect(h.reg(CHILD_ID, 'reaping'), 'step 3 completed; step 4 failed').toBe('reclaim:worktree');
    expect(fs.existsSync(path.join(c.wt, 'f1.txt')), 'the tree stands').toBe(true);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the branch stands').toContain(CHILD_BRANCH);
    expect(linesIn('keep-calls').filter((l) => l === wd), 'keep_of was never asked of the tree').toEqual([]);
    failedPairAgrees(r);
  }, 120_000);

  it('C2: a mount that appears during the tree’s keep_of is caught by the second ask', () => {
    const c = makeChild(h);
    const wd = workdirOf(CHILD_ID);
    realMounts(h);
    const r = childReclaimVerb(h, reclaimToken(), { pre: `${LINUX_PRE} ${MOUNT_AT_ASK(wd, path.join(fs.realpathSync(c.wt), 'sub'), 2)}` });
    const o = mountFailed(r);
    expect(o.detail).toMatch(/^something is mounted at /);
    expect(h.reg(CHILD_ID, 'reaping')).toBe('reclaim:worktree');
    expect(fs.existsSync(path.join(c.wt, 'f1.txt')), 'the tree stands').toBe(true);
    expect(linesIn('keep-calls'), 'the CONTROL: keep_of ran for the tree, and the mount appeared inside it').toContain(wd);
    failedPairAgrees(r);
  }, 120_000);

  it('C3: a tree reached through a linked worktrees root is asked by its physical spelling (resolve)', () => {
    linkedRoot();
    const c = makeChild(h);
    const wd = workdirOf(CHILD_ID);
    expect(fs.realpathSync(wd), 'the CONTROL: the record’s spelling is not the physical one').not.toBe(wd);
    const tok = reclaimToken();
    realMounts(h);
    const r = childReclaimVerb(h, tok, { pre: `${LINUX_PRE} ${MOUNT_AT_ASK(wd, path.join(fs.realpathSync(c.wt), 'sub'), 1)}` });
    const o = mountFailed(r);
    expect(o.detail).toMatch(/^something is mounted at /);
    expect(h.reg(CHILD_ID, 'reaping')).toBe('reclaim:worktree');
    expect(fs.existsSync(path.join(fs.realpathSync(c.wt), 'f1.txt')), 'the tree stands').toBe(true);
    expect(linesIn('keep-calls').filter((l) => l === wd), 'keep_of was never asked of the tree').toEqual([]);
    failedPairAgrees(r);
  }, 120_000);

  it('C4: a tail resumed at worktree asks too', () => {
    const c = makeChild(h);
    const wd = workdirOf(CHILD_ID);
    interrupted(c, 'worktree');
    const tok = resumeToken('worktree');
    realMounts(h);
    const r = childReclaimVerb(h, tok, { pre: `${LINUX_PRE} ${MOUNT_AT_ASK(wd, path.join(fs.realpathSync(c.wt), 'sub'), 1)}` });
    const o = mountFailed(r);
    expect(o.detail).toMatch(/^something is mounted at /);
    expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays').toBe('reclaim:worktree');
    expect(fs.existsSync(path.join(c.wt, 'f1.txt')), 'the tree stands').toBe(true);
    expect(linesIn('keep-calls').filter((l) => l === wd), 'keep_of was never asked of the tree').toEqual([]);
    failedPairAgrees(r);
  }, 120_000);

  it('C5: a standing tree that cannot be resolved fails before its keep_of (step-4-unresolvable-workdir-fails-before-keep-of)', () => {
    const c = makeChild(h);
    const wd = workdirOf(CHILD_ID);
    realMounts(h);
    const r = childReclaimVerb(h, reclaimToken(), { pre: `${LINUX_PRE} ${PHYS_FAILS_AT_THE_ASK}` });
    const o = mountFailed(r);
    expect(String(o.detail).startsWith(`${wd} cannot be resolved (stub: `), String(o.detail)).toBe(true);
    expect(h.reg(CHILD_ID, 'reaping')).toBe('reclaim:worktree');
    expect(fs.existsSync(path.join(c.wt, 'f1.txt')), 'the tree stands').toBe(true);
    expect(linesIn('keep-calls').filter((l) => l === wd), 'keep_of was never asked of the tree').toEqual([]);
    failedPairAgrees(r);
  }, 120_000);

  it('C6: a tree whose worktrees root resolves to a `//` spelling is asked by its collapsed physical spelling', () => {
    const c = makeChild(h);
    // The hardening suite's layout: `$HOME/worktrees` moved to `$HOME/wtreal`, then linked back as `/` + its path.
    fs.renameSync(path.join(h.home, 'worktrees'), path.join(h.home, 'wtreal'));
    fs.symlinkSync(`/${path.join(h.home, 'wtreal')}`, path.join(h.home, 'worktrees'));
    const wd = workdirOf(CHILD_ID);
    const real = fs.realpathSync(c.wt);
    expect(h.sh(`_ws_dir_physical '${wd}'; printf '%s' "$_WS_PHYS"`),
      'the CONTROL: bash keeps the link target’s leading `//`').toBe(`/${real}`);
    const tok = reclaimToken();
    realMounts(h);
    const r = childReclaimVerb(h, tok, { pre: `${LINUX_PRE} ${MOUNT_AT_ASK(wd, path.join(real, 'sub'), 1)} ${ASK_LOG}` });
    const o = mountFailed(r);
    expect(o.detail).toMatch(/^something is mounted at /);
    expect(h.reg(CHILD_ID, 'reaping')).toBe('reclaim:worktree');
    expect(fs.existsSync(path.join(real, 'f1.txt')), 'the tree stands').toBe(true);
    expect(asked(wd, 'resolve'), 'the tree was asked once, resolved, and failed there').toBe(1);
    expect(linesIn('keep-calls').filter((l) => l === wd), 'keep_of was never asked of the tree').toEqual([]);
    failedPairAgrees(r);
  }, 120_000);

  it('E1: ws-expire, through the same tail, fails worktree-remove-failed and keeps the archived tree', () => {
    const a = makeArchived(h);
    const wd = workdirOf(EXP_ID);
    const tok = expireToken(h);
    expect(tok, 'the CONTROL: the expiry ladder passes').toMatch(/^[0-9a-f]{64}$/);
    realMounts(h);
    const r = expireVerb(h, tok, { pre: `${LINUX_PRE} ${MOUNT_AT_ASK(wd, path.join(fs.realpathSync(a.wt), 'sub'), 1)}` });
    const o = mountFailed(r);
    expect(o.detail).toMatch(/^something is mounted at /);
    expect(h.reg(EXP_ID, 'reaping'), 'the breadcrumb stays at the step that failed').toBe('expire:worktree');
    expect(fs.existsSync(path.join(a.wt, 'f1.txt')), 'the archived tree stands').toBe(true);
    expect(h.git(a.main, 'branch', '--list', EXP_BRANCH), 'its branch stands').toContain(EXP_BRANCH);
    expect(linesIn('keep-calls').filter((l) => l === wd), 'keep_of was never asked of the tree').toEqual([]);
    const row = eventsOf(h.home, 'expire').filter((e) => e['outcome'] === 'failed').pop();
    expect(row?.['refusal'], 'the journal names the failure the document names').toBe('worktree-remove-failed');
    expect(row?.['detail'], 'the journal and the document carry one detail').toBe(o.detail);
  }, 120_000);
});

describe.skipIf(!LINUX)('CONTROLs: a mount beside the tree, at `<tree>-x`, is not under it, and the act completes', () => {
  it('CONTROL N: with a nested checkout, reclaimed; each site asked twice', () => {
    const c = makeChild(h);
    const inner = nested(c);
    const realInner = fs.realpathSync(inner);
    const wd = workdirOf(CHILD_ID);
    realMounts(h);
    mountAt(`${fs.realpathSync(c.wt)}-x`);
    const r = childReclaimVerb(h, reclaimToken(), { pre: `${LINUX_PRE} ${ASK_LOG}` });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(c.wt), 'the tree went').toBe(false);
    expect(h.git(c.main, 'branch', '--list', 'ws/nested'), 'the nested branch went').toBe('');
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the child’s branch went').toBe('');
    expect(asked(realInner), 'the checkout was asked twice').toBe(2);
    expect(asked(wd, 'resolve'), 'the tree was asked twice, resolved').toBe(2);
    expect(linesIn('keep-calls'), 'the CONTROL: KEEP_LOG sees the checkout’s keep').toContain(realInner);
  }, 120_000);

  it('CONTROL C: with no nested checkout, reclaimed; the tree asked twice', () => {
    const c = makeChild(h);
    const wd = workdirOf(CHILD_ID);
    realMounts(h);
    mountAt(`${fs.realpathSync(c.wt)}-x`);
    const r = childReclaimVerb(h, reclaimToken(), { pre: `${LINUX_PRE} ${ASK_LOG}` });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(c.wt), 'the tree went').toBe(false);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the branch went').toBe('');
    expect(asked(wd, 'resolve'), 'the tree was asked twice, resolved').toBe(2);
  }, 120_000);

  it('CONTROL C3 layout: the linked worktrees root, reclaimed; the tree asked twice, resolved', () => {
    linkedRoot();
    const c = makeChild(h);
    const wd = workdirOf(CHILD_ID);
    const tok = reclaimToken();
    realMounts(h);
    mountAt(`${fs.realpathSync(c.wt)}-x`);
    const r = childReclaimVerb(h, tok, { pre: `${LINUX_PRE} ${ASK_LOG}` });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(path.join(h.home, 'wtreal', 'demo', 'quiet-basin')), 'the tree went').toBe(false);
    expect(asked(wd, 'resolve'), 'the tree was asked twice, resolved').toBe(2);
  }, 120_000);

  it('CONTROL E: ws-expire, expired; the tree asked twice, resolved', () => {
    const a = makeArchived(h);
    const wd = workdirOf(EXP_ID);
    const tok = expireToken(h);
    expect(tok, 'the CONTROL: the expiry ladder passes').toMatch(/^[0-9a-f]{64}$/);
    realMounts(h);
    mountAt(`${fs.realpathSync(a.wt)}-x`);
    const r = expireVerb(h, tok, { pre: `${LINUX_PRE} ${ASK_LOG}` });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r).expired).toBe(EXP_ID);
    expect(fs.existsSync(a.wt), 'the archived tree went').toBe(false);
    expect(h.git(a.main, 'branch', '--list', EXP_BRANCH), 'its branch went').toBe('');
    expect(asked(wd, 'resolve'), 'the tree was asked twice, resolved').toBe(2);
  }, 120_000);
});

describe('on Darwin the helper’s one guard answers before any table is read, and the removals happen as before (R9)', () => {
  it('D2: forced Darwin, a nested checkout: both sites call the helper, no table is read, and both trees and both branches go', () => {
    const c = makeChild(h);
    const inner = nested(c);
    const realInner = fs.realpathSync(inner);
    const wd = workdirOf(CHILD_ID);
    const r = childReclaimVerb(h, reclaimToken(), { pre: DARWIN_PRE });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(inner), 'the nested checkout went').toBe(false);
    expect(fs.existsSync(c.wt), 'the tree went').toBe(false);
    expect(h.git(c.main, 'branch', '--list', 'ws/nested'), 'the nested branch went').toBe('');
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the child’s branch went').toBe('');
    expect(fs.existsSync(path.join(h.home, 'mi-called')), 'no mount table was read').toBe(false);
    expect(asked(realInner), 'the checkout’s two sites called the helper').toBe(2);
    expect(asked(wd, 'resolve'), 'the tree’s two sites called it, with resolve').toBe(2);
    poisonIsLive();
  }, 120_000);

  it('D3: forced Darwin, no nested checkout: the child’s own forced removal is reached, and no table is read', () => {
    const c = makeChild(h);
    const wd = workdirOf(CHILD_ID);
    const r = childReclaimVerb(h, reclaimToken(), { pre: DARWIN_PRE });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(c.wt), 'the tree went').toBe(false);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the branch went').toBe('');
    expect(fs.existsSync(path.join(h.home, 'mi-called')), 'no mount table was read').toBe(false);
    expect(asked(wd, 'resolve'), 'the tree’s two sites called it, with resolve').toBe(2);
    poisonIsLive();
  }, 120_000);
});

describe('the asks, read from the source (path-identity spec §3.5)', () => {
  /** `_ws_reclaim_tail`'s code: whole-line comments dropped, continuations joined (the six-calls census's own reading),
   *  so each two-line statement is one line. */
  const tailCode = (): string[] => {
    const src = fs.readFileSync(CCD, 'utf8');
    const tail = src.slice(src.indexOf('\n_ws_reclaim_tail() {'), src.indexOf('\ncmd_ws_reclaim() {'));
    expect(tail.length, 'the CONTROL: the tail was found').toBeGreaterThan(1000);
    return tail.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n').replace(/\s*\\\n\s*/g, ' ').split('\n');
  };
  const SITES = /_ws_removal_mounts_clear|_ws_reclaim_keep_of "\$main" "\$id" tree "\$(cpath|workdir)"(?! 1)|worktree remove --force/;
  const label = (l: string): string => {
    let m = /_ws_removal_mounts_clear "\$(\w+)"( resolve)?/.exec(l);
    if (m) return `mounts ${m[1]}${m[2] ?? ''}`;
    m = /_ws_reclaim_keep_of "\$main" "\$id" tree "\$(\w+)"/.exec(l);
    if (m) return `keep ${m[1]}`;
    m = /worktree remove --force "\$(\w+)"/.exec(l);
    if (m) return `remove ${m[1]}`;
    return `unlabelled: ${l.trim()}`;
  };

  it('in order: before keep_of and again before the forced removal, at the nested checkout and then at the tree, the tree resolved', () => {
    expect(tailCode().filter((l) => SITES.test(l)).map(label)).toEqual([
      'mounts cpath', 'keep cpath', 'mounts cpath', 'remove cpath',
      'mounts workdir resolve', 'keep workdir', 'mounts workdir resolve', 'remove workdir',
    ]);
  });

  it('each ask stands directly before a keep_of or the forced removal of its own path, so no vanished arm holds one', () => {
    const code = tailCode();
    const at = code.flatMap((l, i) => (/_ws_removal_mounts_clear /.test(l) ? [i] : []));
    expect(at.length, 'four asks in the tail').toBe(4);
    for (const i of at) {
      const p = /_ws_removal_mounts_clear "\$(cpath|workdir)"/.exec(code[i]!)?.[1] ?? '?';
      const next = code.slice(i + 1).find((l) => l.trim() !== '') ?? '';
      const keep = `_ws_reclaim_keep_of "$main" "$id" tree "$${p}" ||`;
      const rm = `worktree remove --force "$${p}" 2>&1)`;
      expect(next.includes(keep) || next.includes(rm), `after ${code[i]!.trim().slice(0, 60)}: ${next.trim()}`).toBe(true);
    }
    // No ask spells git, so the tail's six destructive git calls stay six (`ccd-child-reclaim-tail-contained`).
    expect(code.filter((l) => /_ws_removal_mounts_clear /.test(l) && /\bgit\b/.test(l)), 'an ask that spells git').toEqual([]);
  });
});
