// path-identity W3, Task 10 (path-identity spec §4.6; R23, R24): a process working inside the tree stops the forced
// removal. The reclaim and expiry tail asks the one cwd probe, `_ws_cwd_users`, in two places. Inside the post-kill
// bounded wait, which ONLY WAITS: `_ws_reclaim_tmproot_quiet` is given the tree the tombstone names, asks the probe
// beside the temp root's, and ends early only when both say nobody. And at each STANDING forced removal, ahead of
// W2's mount ask, twice a site: before the checkout's or the tree's `_ws_reclaim_keep_of`, and again before its
// `git worktree remove --force`. Step (3) asks of the CHILD's whole tree, a superset of the checkout. A process inside,
// found by its cwd link's string against the tree's physical spelling or by device and inode ancestry, or a probe that
// could not be asked, fails `worktree-remove-failed`, with the breadcrumb, the tree and the branch standing, and the
// probe's reason cut by `_ws_leaf_why_line`. Process state never grants: nobody only lets the mount ask be asked.
// FIXTURE HOME ONLY (`makePrHarness`): both verbs run as sourced functions with the unit and pane calls recorded
// (`CHILD_STUBS`, `EXP_STUBS`), and every path is derived from `h.home`. The processes in the trees are REAL — spawned
// by vitest (`holdProc`), or started inside the verb's own shell by a wrapper with their pid recorded, and killed after
// each case — or FAKE, in a fixture process root (`FAKE_PROC_SELF`). So the Linux cases walk the real `/proc`, and
// CLAUDE.md lists this file as a load flake. The Darwin cases force `CCD_OS=darwin` and name lsof's listing exactly.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { ccdSource } from './ccdWsHelpers.js';
import { eventsOf } from './lifecycleHelpers.js';
import { CHILD_BRANCH, CHILD_ID, childReclaimVerb, evalOf, makeChild, type Child } from './childReclaimFixture.js';
import { verbHelpers } from './childReclaimVerbHelpers.js';
import { EXP_BRANCH, EXP_ID, expireToken, expireVerb, makeArchived } from './wsExpireFixture.js';
import { holdProc, type Held } from './pathUsersFixture.js';
import { DARWIN_IDENT_SHIMS, DARWIN_LSOF_STUB, FAKE_PROC_SELF } from './worktreeIdentityFixture.js';
import { SENTENCES } from '../src/wsaudit.js';

let h: PrHarness;
let held: Held[] = [];
beforeEach(() => { h = makePrHarness('ccrc-reclaim-tail-cwd-'); held = []; });
afterEach(() => { for (const p of held) p.stop(); killEntered(); h.cleanup(); });
const { interrupted, resumeToken, failedPairAgrees } = verbHelpers(() => h);
const hold = (o: Parameters<typeof holdProc>[0]): Held => { const p = holdProc(o); held.push(p); return p; };

const LINUX = process.platform === 'linux';
type Run = { code: number; stdout: string; stderr: string };
type Doc = { failed?: string; detail?: string; reclaimed?: string; expired?: string };
const docOf = (r: Run): Doc => JSON.parse(r.stdout) as Doc;
const linesIn = (name: string): string[] => {
  const p = path.join(h.home, name);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
};

/** `_ws_cwd_users`, wrapped: runs the real one, then logs `<caller>|<dir>|<rc>` to `$HOME/cwd-calls`, and
 *  `<caller>|<reason>`, its reason uncut ('' when it answered 0), to `$HOME/cwd-whys`. */
const CWD_LOG = 'eval "_t_cwd_real()$(declare -f _ws_cwd_users | tail -n +2)";'
  + ' _ws_cwd_users() { local r; _t_cwd_real "$@"; r=$?;'
  + ' printf \'%s|%s|%s\\n\' "${FUNCNAME[1]-}" "$1" "$r" >> "$HOME/cwd-calls";'
  + ' printf \'%s|%s\\n\' "${FUNCNAME[1]-}" "$_WS_CWD_USERS_WHY" >> "$HOME/cwd-whys"; return "$r"; };';
/** `_ws_reclaim_keep_of`, wrapped: logs its `$4` (the path or branch it keeps for) to `$HOME/keep-calls`, runs the
 *  real one, and, once that answered 0 for the spelling in `$HOME/enter-when`, starts a process whose working
 *  directory is that path (`exec sleep 60`, stdio detached, its pid in `$HOME/entered-pid`): a process that enters
 *  between a site's two asks. */
const KEEP_ENTERS = 'eval "_t_keep_real()$(declare -f _ws_reclaim_keep_of | tail -n +2)";'
  + ' _ws_reclaim_keep_of() { local r; printf \'%s\\n\' "$4" >> "$HOME/keep-calls"; _t_keep_real "$@"; r=$?;'
  + ' if (( r == 0 )) && [[ -f "$HOME/enter-when" ]] && [[ "$4" == "$(cat "$HOME/enter-when")" ]]; then'
  + ' ( cd -- "$4" || exit 0; exec sleep 60 </dev/null >/dev/null 2>&1 & echo "$!" > "$HOME/entered-pid" ); fi; return "$r"; };';
/** A process that enters `dir` at the tail's first act (`_ws_unsupervise`), after every ladder has asked. */
const ENTER_AT_THE_TAIL = (dir: string): string =>
  '_ws_unsupervise() { echo "unsupervise $*" >> "$HOME/ccd-calls";'
  + ` ( cd -- '${dir}' || exit 0; exec sleep 60 </dev/null >/dev/null 2>&1 & echo "$!" > "$HOME/entered-pid" ); };`;
/** A fake process `$1` of the fixture process root: its cwd link at `$2`, its parent `$3` (the expiry suites' `_fp`,
 *  named `fakep` here as in `ccd-cwd-users.test.ts`: an unshipped `_x() {` reds `ccd-harness-integrity`). */
const FP = 'fakep() { mkdir -p "$HOME/fp/$1"; ln -sfn "$2" "$HOME/fp/$1/cwd"; printf "%s (a b) S %s 1 1 0\\n" "$1" "$3" > "$HOME/fp/$1/stat"; };';
/** The process root missing whole: the probe cannot list it. */
const NO_ROOT = '_ws_expire_proc_root() { printf %s "$HOME/no-such-proc"; };';
/** The probe's process root, counted: each read appends `walk` to `$HOME/proc-walks`, and the real root answers. */
const PROC_SPY = 'eval "_t_root_real()$(declare -f _ws_expire_proc_root | tail -n +2)";'
  + ' _ws_expire_proc_root() { echo walk >> "$HOME/proc-walks"; _t_root_real; };';
/** `_ws_cwd_users`, answering IN USE for the tail's asks only, with a reason a person cannot read raw — a tab, a byte
 *  0xFF and 400 more of those (`ccd-child-reclaim-tmproot-wait.test.ts`'s `dirtyWhy`) — and the real answer to the
 *  wait. Never composed with `CWD_LOG`. */
const DIRTY_AT_THE_TAIL = 'eval "_t_cwd_inner()$(declare -f _ws_cwd_users | tail -n +2)";'
  + ' _ws_cwd_users() { if [[ "${FUNCNAME[1]-}" != _ws_reclaim_tail ]]; then _t_cwd_inner "$@"; return; fi;'
  + ' _WS_CWD_USERS_PIDS=4242; _WS_CWD_USERS_RECS=();'
  + ' _WS_CWD_USERS_WHY="process 4242 (x) has its working directory at $1"$\'\\t\\xff\'"$(printf \'\\xff%.0s\' {1..400})";'
  + ' return 1; };';
/** Every verb case: the wait asks once (its bound 0), and both wrappers log. */
const PRE = `CCD_RECLAIM_TMPROOT_WAIT_S=0; ${CWD_LOG} ${KEEP_ENTERS}`;

/** What `fn`'s cwd asks answered, in order: `<dir>|<rc>`. */
const asksFrom = (fn: string): string[] =>
  linesIn('cwd-calls').filter((l) => l.startsWith(`${fn}|`)).map((l) => l.slice(fn.length + 1));
const tailAsks = (): string[] => asksFrom('_ws_reclaim_tail');
const waitAsks = (): string[] => asksFrom('_ws_reclaim_tmproot_quiet');
const enteredPid = (): number => {
  const f = path.join(h.home, 'entered-pid');
  expect(fs.existsSync(f), 'the CONTROL: the process entered').toBe(true);
  return Number(fs.readFileSync(f, 'utf8').trim());
};
/** Kills the process a wrapper started, and only while it still works under this fixture HOME: never a pid recycled. */
function killEntered(): void {
  const f = path.join(h.home, 'entered-pid');
  if (!fs.existsSync(f)) return;
  const pid = Number(fs.readFileSync(f, 'utf8').trim());
  try {
    if (fs.readlinkSync(`/proc/${pid}/cwd`).startsWith(fs.realpathSync(h.home))) process.kill(pid, 'SIGKILL');
  } catch { /* gone, or not ours */ }
}

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
/** Exit 1 and `worktree-remove-failed`: the document a cwd answer leaves. */
const cwdFailed = (r: Run): { detail: string } => {
  expect(r.code, r.stdout + r.stderr).toBe(1);
  const o = docOf(r);
  expect(o.failed).toBe('worktree-remove-failed');
  return { detail: String(o.detail) };
};
const atTree = (wd: string): string => ` — the tree at ${wd} stands, and nothing further was deleted`;
const atCheckout = (cpath: string): string => ` — the checkout at ${cpath} stands, and nothing further was deleted`;
/** The reason the tail cut, before the words ccd appends after it. */
const reasonOf = (detail: string, tail: string): string => {
  expect(detail.endsWith(tail), detail).toBe(true);
  return detail.slice(0, -tail.length);
};
/** One short clean line: printable ASCII, at most 300 bytes before the cut's `…`. */
const cutClean = (reason: string): void => {
  const body = reason.endsWith('…') ? reason.slice(0, -1) : reason;
  expect(body, 'printable ASCII only').toMatch(/^[ -~]*$/);
  expect(Buffer.byteLength(body, 'utf8'), 'cut at 300 bytes').toBeLessThanOrEqual(300);
};
const IN_USE = (pid: number | string): string => `a process works inside it: process ${pid} `;

describe('_ws_reclaim_tmproot_quiet, given the tree: it asks both, and only waits (path-identity spec §4.6)', () => {
  /** `fn`, stubbed: each call appends `tag` to `$HOME/quiet-calls` and answers the next of `answers` (the last repeats). */
  const SEQ = (fn: string, tag: string, answers: readonly number[]): string =>
    `${fn}() { echo ${tag} >> "$HOME/quiet-calls"; local n a=(${answers.join(' ')});`
    + ` n=$(grep -c '^${tag}$' "$HOME/quiet-calls"); (( n <= \${#a[@]} )) || n=\${#a[@]}; return "\${a[n-1]}"; };`;
  const calls = (tag: string): number => linesIn('quiet-calls').filter((l) => l === tag).length;
  /** The wait, its answer and the tree's last answer on one line: `<rc> <_WS_QUIET_TREE>`. */
  const quiet = (pre: string, tree = true): string =>
    h.sh(`${pre} _ws_reclaim_tmproot_quiet "$HOME/.cc-tmp/x"${tree ? ' "$HOME/tree"' : ''}; printf '%s %s' "$?" "$_WS_QUIET_TREE"`);

  it('Q1: one argument, as every caller before W3: the tree is never asked, and the answer is the temp root’s', () => {
    expect(quiet(`CCD_OS=linux; CCD_RECLAIM_TMPROOT_WAIT_S=5; ${SEQ('_ws_path_users', 'path', [1, 0])} ${SEQ('_ws_cwd_users', 'cwd', [1])}`, false))
      .toBe('0 0');
    expect(calls('path')).toBe(2);
    expect(calls('cwd'), 'never asked').toBe(0);
  }, 60_000);

  it('Q2: with a tree, the wait ends early only when both say nobody — the temp root at once, the tree on its third ask', () => {
    expect(quiet(`CCD_OS=linux; CCD_RECLAIM_TMPROOT_WAIT_S=5; ${SEQ('_ws_path_users', 'path', [0])} ${SEQ('_ws_cwd_users', 'cwd', [1, 1, 0])}`))
      .toBe('0 0');
    expect(calls('path')).toBe(3);
    expect(calls('cwd')).toBe(3);
  }, 60_000);

  it('Q3: a clock that never advances, and a tree that never leaves: it still ends after bound*4+1 asks of each, answering the temp root’s 0', () => {
    const FROZEN = '_plat_epoch_ms() { echo x >> "$HOME/clock-reads";'
      + ' if (( $(wc -l < "$HOME/clock-reads") > 40 )); then echo clock-escape >> "$HOME/quiet-calls"; printf 9999999999999;'
      + ' else printf 1000000000000; fi; };';
    expect(quiet(`CCD_OS=linux; CCD_RECLAIM_TMPROOT_WAIT_S=1; ${FROZEN} ${SEQ('_ws_path_users', 'path', [0])} ${SEQ('_ws_cwd_users', 'cwd', [1])}`))
      .toBe('0 1');
    expect(linesIn('quiet-calls'), 'the count ended it, not the escape').not.toContain('clock-escape');
    expect(calls('path')).toBe(5);
    expect(calls('cwd')).toBe(5);
  }, 60_000);

  it('Q4: on Darwin, with a tree, each is asked ONCE — the temp root’s answer never looks, and the tree’s is read once', () => {
    const t0 = Date.now();
    expect(quiet(`CCD_OS=darwin; CCD_RECLAIM_TMPROOT_WAIT_S=5; ${SEQ('_ws_path_users', 'path', [2])} ${SEQ('_ws_cwd_users', 'cwd', [1])}`))
      .toBe('2 1');
    expect(calls('path')).toBe(1);
    expect(calls('cwd')).toBe(1);
    expect(Date.now() - t0, 'it did not sit out the bound').toBeLessThan(4_000);
  }, 60_000);

  it('Q5: CONTROL: a tree that says nobody never shortens the temp root’s own wait', () => {
    expect(quiet(`CCD_OS=linux; CCD_RECLAIM_TMPROOT_WAIT_S=5; ${SEQ('_ws_path_users', 'path', [1, 1, 0])} ${SEQ('_ws_cwd_users', 'cwd', [0])}`))
      .toBe('0 0');
    expect(calls('path')).toBe(3);
    expect(calls('cwd')).toBe(3);
  }, 60_000);
});

describe.skipIf(!LINUX)('the post-kill wait waits for a process in the tree, and only waits (R23)', () => {
  /** A straggler in the tree: it leaves once the WAIT has asked about the tree twice — in use at the wait's first two
   *  asks, gone by its third — and after 30 s whatever happens. Spawned by vitest, never by ccd. */
  const LEAVES_AFTER_TWO_WAIT_ASKS = [
    'f="$1"; i=0',
    'while [ "$i" -lt 600 ]; do',
    '  n=$(grep -c "^_ws_reclaim_tmproot_quiet|" "$f" 2>/dev/null) || :',
    '  [ "${n:-0}" -ge 2 ] && exit 0',
    '  sleep 0.05; i=$((i+1))',
    'done',
  ].join('\n');

  it('B1: a process in the tree that leaves during the wait is waited for, and the tree goes after it, asked nobody twice at step (4)', async () => {
    const c = makeChild(h);
    const wd = workdirOf(CHILD_ID);
    const s = hold({ cwd: c.wt, script: LEAVES_AFTER_TWO_WAIT_ASKS, args: [path.join(h.home, 'cwd-calls')] });
    const r = childReclaimVerb(h, reclaimToken(), { pre: `CCD_RECLAIM_TMPROOT_WAIT_S=5; ${CWD_LOG}` });
    const waited = waitAsks();
    expect(waited.length, 'the wait asked the tree until it said nobody').toBeGreaterThanOrEqual(3);
    expect(waited.slice(0, 2), 'in use at its first two asks').toEqual([`${wd}|1`, `${wd}|1`]);
    expect(waited.at(-1), 'and nobody at its last').toBe(`${wd}|0`);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r).reclaimed).toBe(CHILD_ID);
    expect(tailAsks(), 'then step (4) asked twice, nobody both times').toEqual([`${wd}|0`, `${wd}|0`]);
    const order = linesIn('cwd-calls');
    const lastWait = order.reduce((a, l, i) => (l.startsWith('_ws_reclaim_tmproot_quiet|') ? i : a), -1);
    expect(order.findIndex((l) => l.startsWith('_ws_reclaim_tail|')), 'the wait came first').toBeGreaterThan(lastWait);
    await s.exited;
    expect(fs.existsSync(c.wt), 'the tree went').toBe(false);
  }, 120_000);
});

describe.skipIf(!LINUX)('each standing forced removal asks first who works inside the tree (path-identity spec §4.6, R23)', () => {
  it('N1: a process in a standing nested checkout fails worktree-remove-failed before its keep_of; the checkout, its branch and the tree stand', () => {
    const c = makeChild(h);
    const inner = nested(c);
    const realInner = fs.realpathSync(inner);
    const wd = workdirOf(CHILD_ID);
    const s = hold({ cwd: inner });
    const r = childReclaimVerb(h, reclaimToken(), { pre: PRE });
    const o = cwdFailed(r);
    const why = reasonOf(o.detail, atCheckout(realInner));
    expect(why.startsWith(IN_USE(s.pid)), `the pid, within the cut: ${why}`).toBe(true);
    expect(why).toContain(`has its working directory at ${realInner}`);
    cutClean(why);
    expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays at the step that failed').toBe('reclaim:children');
    expect(fs.readFileSync(path.join(inner, 'f'), 'utf8'), 'the nested checkout stands').toBe('nested work\n');
    expect(h.git(c.main, 'branch', '--list', 'ws/nested'), 'its branch stands').toContain('ws/nested');
    expect(fs.existsSync(path.join(c.wt, 'f1.txt')), 'the child’s tree stands').toBe(true);
    expect(linesIn('keep-calls').filter((l) => l === realInner), 'keep_of was never asked of the checkout').toEqual([]);
    expect(tailAsks(), 'step (3) asked the child once').toEqual([`${wd}|1`]);
    failedPairAgrees(r);
  }, 120_000);

  it('N2: a process that enters the nested checkout during its keep_of is caught by the second ask, before its forced removal', () => {
    const c = makeChild(h);
    const inner = nested(c);
    const realInner = fs.realpathSync(inner);
    const wd = workdirOf(CHILD_ID);
    fs.writeFileSync(path.join(h.home, 'enter-when'), realInner);
    const r = childReclaimVerb(h, reclaimToken(), { pre: PRE });
    const o = cwdFailed(r);
    const why = reasonOf(o.detail, atCheckout(realInner));
    expect(why.startsWith(IN_USE(enteredPid())), why).toBe(true);
    expect(why).toContain(`has its working directory at ${realInner}`);
    expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays at the step that failed').toBe('reclaim:children');
    expect(fs.existsSync(path.join(inner, 'f')), 'the nested checkout stands').toBe(true);
    expect(h.git(c.main, 'branch', '--list', 'ws/nested'), 'its branch stands').toContain('ws/nested');
    expect(linesIn('keep-calls'), 'the CONTROL: keep_of ran for the checkout, and the process entered then').toContain(realInner);
    expect(tailAsks(), 'nobody before the keep, in use after it').toEqual([`${wd}|0`, `${wd}|1`]);
    failedPairAgrees(r);
  }, 120_000);

  it('C1: a process in the child’s own tree, with no nested checkout, fails at step (4) before its keep_of; the tree and its branch stand', () => {
    const c = makeChild(h);
    const wd = workdirOf(CHILD_ID);
    const s = hold({ cwd: c.wt });
    const r = childReclaimVerb(h, reclaimToken(), { pre: PRE });
    const o = cwdFailed(r);
    const why = reasonOf(o.detail, atTree(wd));
    expect(why.startsWith(IN_USE(s.pid)), why).toBe(true);
    cutClean(why);
    expect(h.reg(CHILD_ID, 'reaping'), 'step (3) completed; step (4) failed').toBe('reclaim:worktree');
    expect(fs.existsSync(path.join(c.wt, 'f1.txt')), 'the tree stands').toBe(true);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the branch stands').toContain(CHILD_BRANCH);
    expect(linesIn('keep-calls').filter((l) => l === wd), 'keep_of was never asked of the tree').toEqual([]);
    expect(tailAsks()).toEqual([`${wd}|1`]);
    failedPairAgrees(r);
  }, 120_000);

  it('C1b: with a nested checkout standing, a process in the child outside it fails at step (3) — step (3) asks the child', () => {
    const c = makeChild(h);
    const inner = nested(c);
    const realInner = fs.realpathSync(inner);
    const wd = workdirOf(CHILD_ID);
    const s = hold({ cwd: c.wt });
    const r = childReclaimVerb(h, reclaimToken(), { pre: PRE });
    const o = cwdFailed(r);
    expect(reasonOf(o.detail, atCheckout(realInner)).startsWith(IN_USE(s.pid)), o.detail).toBe(true);
    expect(h.reg(CHILD_ID, 'reaping')).toBe('reclaim:children');
    expect(fs.existsSync(path.join(inner, 'f')), 'the nested checkout stands').toBe(true);
    expect(linesIn('keep-calls').filter((l) => l === realInner), 'keep_of was never asked of the checkout').toEqual([]);
    expect(tailAsks(), 'the child was asked, not the checkout').toEqual([`${wd}|1`]);
    failedPairAgrees(r);
  }, 120_000);

  it('C2: a process that enters the tree during its keep_of is caught by the second ask', () => {
    const c = makeChild(h);
    const wd = workdirOf(CHILD_ID);
    fs.writeFileSync(path.join(h.home, 'enter-when'), wd);
    const r = childReclaimVerb(h, reclaimToken(), { pre: PRE });
    const o = cwdFailed(r);
    expect(reasonOf(o.detail, atTree(wd)).startsWith(IN_USE(enteredPid())), o.detail).toBe(true);
    expect(h.reg(CHILD_ID, 'reaping')).toBe('reclaim:worktree');
    expect(fs.existsSync(path.join(c.wt, 'f1.txt')), 'the tree stands').toBe(true);
    expect(linesIn('keep-calls'), 'the CONTROL: keep_of ran for the tree, and the process entered then').toContain(wd);
    expect(tailAsks()).toEqual([`${wd}|0`, `${wd}|1`]);
    failedPairAgrees(r);
  }, 120_000);

  it('C3: a cwd that reaches the tree only through an alias is refused by device and inode at step (4)', () => {
    const c = makeChild(h);
    const wd = workdirOf(CHILD_ID);
    fs.mkdirSync(path.join(c.wt, 'sub'));
    fs.symlinkSync(c.wt, path.join(h.home, 'alias'));
    const r = childReclaimVerb(h, reclaimToken(), { pre: `${PRE} ${FAKE_PROC_SELF} ${FP} fakep 4242 "$HOME/alias/sub" 1;` });
    const o = cwdFailed(r);
    const why = reasonOf(o.detail, atTree(wd));
    expect(why.startsWith(IN_USE(4242)), why).toBe(true);
    expect(linesIn('cwd-whys').filter((l) => l.startsWith('_ws_reclaim_tail|')),
      'the string missed it; the ancestry found it (the probe’s own reason, before the 300-byte cut)')
      .toEqual([expect.stringMatching(/^_ws_reclaim_tail\|process 4242 .* by device and inode$/)]);
    expect(h.reg(CHILD_ID, 'reaping')).toBe('reclaim:worktree');
    expect(fs.existsSync(path.join(c.wt, 'f1.txt')), 'the tree stands').toBe(true);
    expect(tailAsks()).toEqual([`${wd}|1`]);
    failedPairAgrees(r);
  }, 120_000);

  it('C3b: the fleet’s layout — a linked worktrees root — and a real process in the tree: refused by its physical spelling', () => {
    linkedRoot();
    const c = makeChild(h);
    const wd = workdirOf(CHILD_ID);
    const real = fs.realpathSync(c.wt);
    expect(real, 'the CONTROL: the record’s spelling is not the physical one').not.toBe(wd);
    const tok = reclaimToken();
    const s = hold({ cwd: c.wt });
    const r = childReclaimVerb(h, tok, { pre: PRE });
    const o = cwdFailed(r);
    const why = reasonOf(o.detail, atTree(wd));
    expect(why.startsWith(IN_USE(s.pid)), why).toBe(true);
    expect(why, 'the string of its cwd link, against the tree’s physical spelling').toContain(`has its working directory at ${real}`);
    expect(why, 'not by identity alone').not.toContain('by device and inode');
    expect(h.reg(CHILD_ID, 'reaping')).toBe('reclaim:worktree');
    expect(fs.existsSync(path.join(real, 'f1.txt')), 'the tree stands').toBe(true);
    failedPairAgrees(r);
  }, 120_000);

  it('C4: a tail resumed at worktree asks too', () => {
    const c = makeChild(h);
    const wd = workdirOf(CHILD_ID);
    interrupted(c, 'worktree');
    const tok = resumeToken('worktree');
    const s = hold({ cwd: c.wt });
    const r = childReclaimVerb(h, tok, { pre: PRE });
    const o = cwdFailed(r);
    expect(reasonOf(o.detail, atTree(wd)).startsWith(IN_USE(s.pid)), o.detail).toBe(true);
    expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays').toBe('reclaim:worktree');
    expect(fs.existsSync(path.join(c.wt, 'f1.txt')), 'the tree stands').toBe(true);
    expect(linesIn('keep-calls').filter((l) => l === wd), 'keep_of was never asked of the tree').toEqual([]);
    failedPairAgrees(r);
  }, 120_000);

  it('C5: a process table that cannot be read is unmeasured, never nobody: worktree-remove-failed, its reason clean', () => {
    const c = makeChild(h);
    const wd = workdirOf(CHILD_ID);
    const r = childReclaimVerb(h, reclaimToken(), { pre: `${PRE} ${NO_ROOT}` });
    const o = cwdFailed(r);
    const why = reasonOf(o.detail, atTree(wd));
    expect(why.startsWith('a process works inside it: '), `unmeasured is not in use: ${why}`).toBe(false);
    cutClean(why);
    expect(h.reg(CHILD_ID, 'reaping')).toBe('reclaim:worktree');
    expect(fs.existsSync(path.join(c.wt, 'f1.txt')), 'the tree stands').toBe(true);
    expect(linesIn('keep-calls').filter((l) => l === wd), 'keep_of was never asked of the tree').toEqual([]);
    expect(tailAsks()).toEqual([`${wd}|2`]);
    failedPairAgrees(r);
  }, 120_000);

  it('C5b: a long reason a person cannot read raw is cut to one short clean line, and the row is never cut down to fit', () => {
    const c = makeChild(h);
    const wd = workdirOf(CHILD_ID);
    const r = childReclaimVerb(h, reclaimToken(), { pre: `CCD_RECLAIM_TMPROOT_WAIT_S=0; ${KEEP_ENTERS} ${DIRTY_AT_THE_TAIL}` });
    const o = cwdFailed(r);
    const why = reasonOf(o.detail, atTree(wd));
    expect(why.startsWith(`${IN_USE(4242)}(x) has its working directory at ${wd}??`), why).toBe(true);
    expect(why.endsWith('…'), 'a cut is marked').toBe(true);
    cutClean(why);
    const row = eventsOf(h.home, 'reclaim').filter((e) => e['outcome'] === 'failed').pop()!;
    expect(row['truncated'], 'the row was never cut down to fit').toBeUndefined();
    expect(fs.existsSync(path.join(c.wt, 'f1.txt')), 'the tree stands').toBe(true);
    failedPairAgrees(r);
  }, 120_000);

  it('E1: ws-expire, through the same tail: a process that enters the archived tree after the expiry ladder asked fails worktree-remove-failed', () => {
    const a = makeArchived(h);
    const wd = workdirOf(EXP_ID);
    const tok = expireToken(h);
    expect(tok, 'the CONTROL: the expiry ladder passes').toMatch(/^[0-9a-f]{64}$/);
    const r = expireVerb(h, tok, { pre: `${PRE} ${ENTER_AT_THE_TAIL(wd)}` });
    const o = cwdFailed(r);
    expect(reasonOf(o.detail, atTree(wd)).startsWith(IN_USE(enteredPid())), o.detail).toBe(true);
    expect(h.reg(EXP_ID, 'reaping'), 'the breadcrumb stays at the step that failed').toBe('expire:worktree');
    expect(fs.existsSync(path.join(a.wt, 'f1.txt')), 'the archived tree stands').toBe(true);
    expect(h.git(a.main, 'branch', '--list', EXP_BRANCH), 'its branch stands').toContain(EXP_BRANCH);
    expect(tailAsks()).toEqual([`${wd}|1`]);
    const row = eventsOf(h.home, 'expire').filter((e) => e['outcome'] === 'failed').pop();
    expect(row?.['refusal'], 'the journal names the failure the document names').toBe('worktree-remove-failed');
    expect(row?.['detail'], 'the journal and the document carry one detail').toBe(o.detail);
  }, 120_000);
});

describe.skipIf(!LINUX)('CONTROLs: nobody inside, and the acts complete — two asks a site, the wait one, the real /proc walked', () => {
  it('CONTROL N: a nested checkout, reclaimed; the child asked twice at each of the two sites and once by the wait, all nobody', () => {
    const c = makeChild(h);
    nested(c);
    const wd = workdirOf(CHILD_ID);
    const r = childReclaimVerb(h, reclaimToken(), { pre: `${CWD_LOG} ${PROC_SPY}` });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(c.wt), 'the tree went').toBe(false);
    expect(waitAsks(), 'the wait asked the tree once').toEqual([`${wd}|0`]);
    expect(tailAsks(), 'two asks at the nested checkout, two at the tree').toEqual(Array(4).fill(`${wd}|0`));
    expect(linesIn('proc-walks').length, 'PROC_SPY: the real /proc was walked at every ask').toBeGreaterThanOrEqual(5);
  }, 120_000);

  it('CONTROL C: no nested checkout, reclaimed; the tree asked twice', () => {
    const c = makeChild(h);
    const wd = workdirOf(CHILD_ID);
    const r = childReclaimVerb(h, reclaimToken(), { pre: CWD_LOG });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(c.wt), 'the tree went').toBe(false);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the branch went').toBe('');
    expect(tailAsks()).toEqual([`${wd}|0`, `${wd}|0`]);
  }, 120_000);

  it('CONTROL E: ws-expire, expired; the tree asked twice', () => {
    const a = makeArchived(h);
    const wd = workdirOf(EXP_ID);
    const tok = expireToken(h);
    expect(tok, 'the CONTROL: the expiry ladder passes').toMatch(/^[0-9a-f]{64}$/);
    const r = expireVerb(h, tok, { pre: CWD_LOG });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r).expired).toBe(EXP_ID);
    expect(fs.existsSync(a.wt), 'the archived tree went').toBe(false);
    expect(tailAsks()).toEqual([`${wd}|0`, `${wd}|0`]);
  }, 120_000);
});

describe('forced Darwin: the probe reads lsof’s listing, and the tail asks it as on Linux', () => {
  it('D1: lsof names a live process in the tree: worktree-remove-failed at step (4), the tree standing', () => {
    const c = makeChild(h);
    const wd = workdirOf(CHILD_ID);
    const tok = reclaimToken();
    const s = hold({ cwd: h.home });
    const listing = `_ws_expire_lsof() { printf 'p%s\\nn%s\\np%s\\nn%s\\n' "$$" "$HOME" "${s.pid}" "${fs.realpathSync(c.wt)}"; };`;
    const r = childReclaimVerb(h, tok, { pre: `CCD_OS=darwin; ${DARWIN_IDENT_SHIMS} ${PRE} ${listing}` });
    const o = cwdFailed(r);
    expect(reasonOf(o.detail, atTree(wd)).startsWith(IN_USE(s.pid)), o.detail).toBe(true);
    expect(h.reg(CHILD_ID, 'reaping')).toBe('reclaim:worktree');
    expect(fs.existsSync(path.join(c.wt, 'f1.txt')), 'the tree stands').toBe(true);
    expect(waitAsks(), 'the wait asked once').toEqual([`${wd}|1`]);
    expect(tailAsks()).toEqual([`${wd}|1`]);
  }, 120_000);

  it('D2: lsof names nobody in the tree: reclaimed; the wait asked once, the tree twice', () => {
    const c = makeChild(h);
    const wd = workdirOf(CHILD_ID);
    const r = childReclaimVerb(h, reclaimToken(), { pre: `CCD_OS=darwin; ${DARWIN_IDENT_SHIMS} ${PRE} ${DARWIN_LSOF_STUB}` });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(docOf(r).reclaimed).toBe(CHILD_ID);
    expect(fs.existsSync(c.wt), 'the tree went').toBe(false);
    expect(waitAsks()).toEqual([`${wd}|0`]);
    expect(tailAsks()).toEqual([`${wd}|0`, `${wd}|0`]);
  }, 120_000);
});

describe('the asks, read from the source (path-identity spec §4.6)', () => {
  const src = ccdSource();
  /** Whole-line comments dropped, continuations joined (the six-calls census's own reading). */
  const codeOf = (body: string): string[] =>
    body.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n').replace(/\s*\\\n\s*/g, ' ').split('\n');
  const tailCode = (): string[] => {
    const tail = src.slice(src.indexOf('\n_ws_reclaim_tail() {'), src.indexOf('\ncmd_ws_reclaim() {'));
    expect(tail.length, 'the CONTROL: the tail was found').toBeGreaterThan(1000);
    return codeOf(tail);
  };
  const CWD = '_ws_cwd_users "$workdir"; cwrc=$?';
  const MAPPING = `(( cwrc == 0 )) || { _ws_reclaim_fail "$id" "$lctx" worktree-remove-failed "$(_ws_leaf_why_line "$( (( cwrc == 1 )) && printf 'a process works inside it: ' )$_WS_CWD_USERS_WHY") — the `;
  const SITES = /_ws_cwd_users "\$workdir"; cwrc=\$\?|_ws_removal_mounts_clear|_ws_reclaim_keep_of "\$main" "\$id" tree "\$(cpath|workdir)"(?! 1)|worktree remove --force/;
  const label = (l: string): string => {
    if (l.includes(CWD)) return 'cwd';
    let m = /_ws_removal_mounts_clear "\$(\w+)"( resolve)?/.exec(l);
    if (m) return `mounts ${m[1]}${m[2] ?? ''}`;
    m = /_ws_reclaim_keep_of "\$main" "\$id" tree "\$(\w+)"/.exec(l);
    if (m) return `keep ${m[1]}`;
    m = /worktree remove --force "\$(\w+)"/.exec(l);
    if (m) return `remove ${m[1]}`;
    return `unlabelled: ${l.trim()}`;
  };

  it('S1: in order — one cwd ask before each mount ask, at the nested checkout and then at the tree', () => {
    expect(tailCode().filter((l) => SITES.test(l)).map(label)).toEqual([
      'cwd', 'mounts cpath', 'keep cpath', 'cwd', 'mounts cpath', 'remove cpath',
      'cwd', 'mounts workdir resolve', 'keep workdir', 'cwd', 'mounts workdir resolve', 'remove workdir',
    ]);
  });

  it('S2: each cwd ask is followed by its own mapping, which cuts its reason, then by the mount ask of its site’s path; none spells git', () => {
    const code = tailCode();
    const at = code.flatMap((l, i) => (l.trim() === CWD ? [i] : []));
    expect(at.length, 'four asks, each a statement of its own').toBe(4);
    const paths = ['cpath', 'cpath', 'workdir', 'workdir'] as const;
    at.forEach((i, k) => {
      const rest = code.slice(i + 1).filter((l) => l.trim() !== '');
      expect(rest[0]!.trim().startsWith(MAPPING), rest[0]).toBe(true);
      expect(rest[0], 'the mapping names its own site').toContain(paths[k] === 'cpath'
        ? ' — the checkout at $cpath stands, and nothing further was deleted"; return 1; }'
        : ' — the tree at $workdir stands, and nothing further was deleted"; return 1; }');
      // The tail's re-ask (its call and its two maps, path-identity spec §4.7) may stand between the map and the mount ask.
      const ask = rest.slice(1).find((l) => !/^\s*(_ws_reclaim_reask |\(\( rarc (!= 1|== 0) \)\) \|\| \{)/.test(l));
      expect(ask!.trim().startsWith(`_ws_removal_mounts_clear "$${paths[k]}"`), ask).toBe(true);
    });
    expect(code.filter((l) => /_ws_cwd_users |cwrc/.test(l) && /\bgit\b/.test(l)), 'a cwd line that spells git').toEqual([]);
  });

  it('S3: the wait is given the tree the tombstone names, read before the tombstone is validated, and its answers are read by nothing', () => {
    const code = tailCode().map((l) => l.trim());
    const q = code.indexOf(`qwd=$(_ws_tomb_str "$tomb" workdir 2>/dev/null) || qwd=''`);
    expect(q, 'the early read').toBeGreaterThan(-1);
    expect(code[q + 1]!.startsWith('_ws_reclaim_tmproot_quiet "$HOME/.cc-tmp/$id" ${qwd:+"$qwd"} || :'), code[q + 1]).toBe(true);
    const full = code.findIndex((l) => l.startsWith('if ! tid=$(_ws_tomb_str "$tomb" id)'));
    expect(full, 'the full read follows the wait').toBeGreaterThan(q + 1);
    expect(code.filter((l) => l.includes('_ws_reclaim_tmproot_quiet ')), 'one wait').toHaveLength(1);
    expect(code.filter((l) => l.includes('_WS_QUIET_TREE')), 'the tail reads nothing the wait answered').toEqual([]);
  });
});

describe('R24: the failure word’s one sentence stays true of a process inside the tree', () => {
  it('R24: it names a process, and still reads as the reused reap word', () => {
    expect(SENTENCES['worktree-remove-failed']).toBe('ccrc stopped: git refused to remove a worktree, or ccrc could not prove that the tree at this workspace’s path — or a checkout inside it — is its own, or a process still works inside it. The session is stopped and nothing further was deleted.');
    expect(SENTENCES['worktree-remove-failed']).toMatch(/could not prove that the tree at this workspace’s path — or a checkout inside it — is its own/);
    expect(SENTENCES['worktree-remove-failed']).not.toMatch(/before removing a worktree/);
  });
});
