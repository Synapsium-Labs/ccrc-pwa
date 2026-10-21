// path-identity W3, Task 3 (path-identity spec §4.5, §4.8 and §4.9; PI3 B, PI6 M4, PI8 B2). The rows rung,
// `_ws_reclaim_workdir_shared`, places another session's registry row by DEVICE AND INODE beside its strings, holds the
// child unmeasured where a mount could give its tree another spelling, and refuses a row reached through a link into
// `/proc`, all in ONE bounded walk (`_ws_reclaim_idwalk`) per call. Every answer only ADDS: a placement (SHARED or
// NESTED, `containment-unproven` at the ladder) or a not-asked arm (`unmeasured`), decided after the loop and
// outranked by any placement. Its callers are all three: the reclaim and expire ladder (L, X), the tail's
// `_ws_reclaim_owned` (O) and the collector's row rule (C).
// A BIND IS STOOD IN BY A SYMLINK (R10): the walk follows links, so `BIND_STANDIN` has the resolver answer a spelling
// under the link unchanged, basis `complete`, as `pwd -P` answers on a real bind, while the walk's `stat` meets the
// tree's device and inode through the link. MOUNTS ARE FAKED, NEVER MADE (R35): the table is `$HOME/mountinfo`
// (`MOUNTS_SEAM`), a copy of this process's own (`realMounts`), with lines appended.
// FIXTURE HOME ONLY (`makePrHarness`): every ccd call is a sourced function in the harness. The verbs run with their
// unit and pane calls recorded (`CHILD_STUBS`, `EXP_STUBS`); the reclaim tail's in-use probe answers "nobody"
// (`NOBODY`), the expiry's process table is a fake root (`FAKE_PROC_SELF`) and the collector's probe is stubbed
// (`PROBE_STUB`), so no case walks the real `/proc` (`PROC_SPY` records any walk, and each verb case asserts none). A
// case whose subject could hang under a mutation runs through `spawnSyncGroup`, with a 20 s group timeout.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CCD } from './ccdWsHelpers.js';
import {
  CHILD_BRANCH, CHILD_ID, CHILD_STUBS, childReclaimVerb, evalOf, makeChild, type Child, type LadderAnswer,
} from './childReclaimFixture.js';
import { verbHelpers } from './childReclaimVerbHelpers.js';
import { EXP_BRANCH, EXP_ID, expireEvalOf, expireToken, expireVerb, makeArchived } from './wsExpireFixture.js';
import {
  COL_ID, GAP_LOG, MOUNTS_SEAM, PROBE_STUB, collectToken, collectVerb, docOf, gaps, inoAt, leafOf, linesOf, makeOrphan,
  realMounts, records, slots,
} from './wsCollectFixture.js';
import { NO_COPY } from './collectRaceFixture.js';
import { BIND_STANDIN, FAKE_PROC_SELF, walkSpy } from './worktreeIdentityFixture.js';
import { CCD_FUNCTION_DEF, bashCodeOf, ccdCallGraph } from './consolidationCensus.js';
import { spawnSyncGroup } from './spawnGroup.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-rows-rung-identity-'); });
afterEach(() => { h.cleanup(); });
const { interrupted, resumeToken, failedPairAgrees } = verbHelpers(() => h);

const LINUX = process.platform === 'linux';
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const linesIn = (name: string): string[] => {
  const p = path.join(h.home, name);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
};

/** The rung's `unproc` clause as this task words it (R15). */
const UNPROC = 'name a workdir under /proc, or one reached through a link into /proc, which names whatever the reading'
  + ' process\'s own cwd or descriptors are, so ccd cannot place them against this child';
/** The lead of the rung's clause for a walk that did not answer (R10). */
const UNWALK = 'the identity walk of the registry rows did not answer for ';
/** The rung's mount-hold clause for `id`, with the walk's word (R13). */
const UNMOUNT = (id: string, word: string): string =>
  `a mount stands at or under ${id}'s tree, or one of its file system's roots lies at or under it (${word}),`
  + ' or the mount table could not place it, so ccd cannot prove which tree a removal would take';

/** Another session's registry row, written by hand: `.uuid` and `.workdir`, and no entry field (a legacy row). */
const row = (id: string, workdir: string): void => {
  fs.writeFileSync(path.join(h.home, '.cc-sessions', `${id}.uuid`), `u-${id}`);
  fs.writeFileSync(path.join(h.home, '.cc-sessions', `${id}.workdir`), workdir);
};
/** A bind stand-in for `tree`: `<tree>/server` made, `$HOME/bindlike` a link to `tree`, and the row `demo-bind`
 *  spelled `$HOME/bindlike/server`. Without `STANDIN` the resolver follows the link, and the row's string places it. */
const bindRow = (tree: string): void => {
  fs.mkdirSync(path.join(tree, 'server'), { recursive: true });
  fs.symlinkSync(tree, path.join(h.home, 'bindlike'));
  row('demo-bind', path.join(h.home, 'bindlike', 'server'));
};
const STANDIN = BIND_STANDIN('$HOME/bindlike');
/** `_ws_reclaim_owned`'s answer: its rc and its why. */
const owned = (wd: string, main: string, pre = ''): { rc: string; why: string } => {
  const [rc = '', why = ''] = h.sh(`${pre} _ws_reclaim_owned ${CHILD_ID} "${wd}" "${main}"; printf '%s\\x1f%s' "$?" "$_WS_OWNED_WHY"`)
    .split('\x1f');
  return { rc, why };
};
/** `_ws_collect_rows_clear` asked of `leaf` for the collector's id: `[rc=<n>] <why>`. */
const collectRows = (leaf: string, pre = ''): string =>
  h.sh(`${pre} _ws_collect_rows_clear ${COL_ID} "${leaf}"; printf '[rc=%s] %s' "$?" "$_WS_COLLECT_ROWS_WHY"`);

/** `snippet` in the harness's own shell and environment: `h.sh`'s `bash -c` text and `h.env()`, the contained
 *  environment with the gh, systemd and tmux poisons. It runs in a process group of its own, bounded at 20 s
 *  (`spawnSyncGroup`), so a subject that hangs under a mutation reds on the clock instead of hanging the suite. */
const bounded = (snippet: string): { out: string; timedOut: boolean } => {
  const r = spawnSyncGroup('bash', ['-c', 'ccd_h_src=$CCD_HARNESS_SRC ccd_h_snippet=$CCD_HARNESS_SNIPPET; '
    + 'unset CCD_HARNESS_SRC CCD_HARNESS_SNIPPET; source "$ccd_h_src"; eval "$ccd_h_snippet"'],
  { encoding: 'utf8', cwd: h.home, timeout: 20_000,
    env: { ...h.env(), CCD_HARNESS_SRC: CCD, CCD_HARNESS_SNIPPET: snippet } });
  return { out: String(r.stdout ?? '').trim(),
    timedOut: (r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT' };
};
/** `evalOf`'s answer, through `bounded`. */
const ladderBounded = (pre: string): LadderAnswer & { timedOut: boolean } => {
  const b = bounded(`${CHILD_STUBS} ${pre} _ws_reclaim_eval ${CHILD_ID} 0 '' >/dev/null;`
    + ' printf \'%s\\x1f%s\\x1f%s\' "$REAP_VERDICT" "$REAP_TOKEN" "$REAP_DETAIL"');
  const [verdict = '', token = '', detail = ''] = b.out.split('\x1f');
  return { verdict, token, detail, timedOut: b.timedOut };
};
/** The table is a FIFO with no writer, and the walk is bounded at 1 s: opening the table blocks until the bound. */
const FIFO_SEAM = '_ws_collect_mountinfo() { printf \'%s\' "$HOME/mi-fifo"; }; WS_RECLAIM_WALK_S=1;';
const fifo = (): void => { h.sh('mkfifo "$HOME/mi-fifo"'); };

const tableOf = (): string => path.join(h.home, 'mountinfo');
/** A path as the kernel's table writes it: space, tab, newline and backslash encoded. */
const encoded = (p: string): string =>
  p.replace(/\\/g, '\\134').replace(/ /g, '\\040').replace(/\t/g, '\\011').replace(/\n/g, '\\012');
/** A mount point at `p` (physical), on a device no fixture file is on. */
const MOUNT_LINE = (p: string): string => `9999 1 0:99 / ${encoded(p)} rw,relatime - tmpfs tmpfs rw`;
const mountAt = (p: string): void => { fs.appendFileSync(tableOf(), `${MOUNT_LINE(p)}\n`); };
/** A mount of device `majmin` whose root (field 4) is `root`, mounted far from any fixture. */
const ROOT_LINE = (majmin: string, root: string): string =>
  `9998 1 ${majmin} ${root} /w3-nowhere/bind rw,relatime - ext4 /dev/w3 rw`;
/** The copied table's line that holds `p` (physical): the longest mount point at or above it by whole components,
 *  the last listed on a tie (§Interfaces' rule for the walk). */
const containing = (p: string): { at: number; majmin: string; root: string; mp: string } => {
  const e = encoded(p);
  const lines = fs.readFileSync(tableOf(), 'utf8').split('\n');
  let at = -1;
  let len = -1;
  lines.forEach((l, i) => {
    const f = l.split(' ');
    if (!l.includes(' - ') || f.length < 5) return;
    const mp = f[4]!;
    if ((mp === '/' || e === mp || e.startsWith(`${mp}/`)) && mp.length >= len) { at = i; len = mp.length; }
  });
  expect(at, `the CONTROL: the copied table holds a line containing ${p}`).toBeGreaterThan(-1);
  const f = lines[at]!.split(' ');
  return { at, majmin: f[2]!, root: f[3]!, mp: f[4]! };
};
/** `p`'s device-relative path: its containing line's root, then the rest of `p` below that line's mount point. */
const devRel = (p: string): string => {
  const c = containing(p);
  const rest = c.mp === '/' ? encoded(p) : encoded(p).slice(c.mp.length);
  return `${c.root === '/' ? '' : c.root}${rest}`;
};
/** The mount hold answered: unmeasured, no token, the clause with `word`. */
const held = (r: LadderAnswer, id: string, word: string): void => {
  expect(r.verdict, r.detail).toBe('unmeasured');
  expect(r.token).toBe('');
  expect(r.detail).toContain(UNMOUNT(id, word));
};

/** The reclaim tail's in-use probe answering "nobody", so its post-kill wait never walks the real `/proc`. */
const NOBODY = '_ws_path_users() { _WS_PATH_USERS_PIDS=""; _WS_PATH_USERS_WHY=""; return 0; };';
/** Records any walk of the in-use probe's process table to `$HOME/proc-walks`. */
const PROC_SPY = '_ws_path_users_proc_root() { echo walk >> "$HOME/proc-walks"; printf "%s" /proc; };';
/** W2's helper, wrapped: logs `<dir>|<mode>` to `$HOME/ask-calls`, then asks the real one. */
const ASK_LOG = 'eval "_t_ask_real()$(declare -f _ws_removal_mounts_clear | tail -n +2)";'
  + ' _ws_removal_mounts_clear() { printf \'%s|%s\\n\' "$1" "${2-}" >> "$HOME/ask-calls"; _t_ask_real "$@"; };';
/** `_ws_reclaim_keep_of`, wrapped: logs its `$4` to `$HOME/keep-calls`, then runs the real one. */
const KEEP_LOG = 'eval "_t_keep_real()$(declare -f _ws_reclaim_keep_of | tail -n +2)";'
  + ' _ws_reclaim_keep_of() { printf \'%s\\n\' "$4" >> "$HOME/keep-calls"; _t_keep_real "$@"; };';
/** Any read of the table is recorded in `$HOME/mi-called`, and the table it names cannot be read. */
const POISON = '_ws_collect_mountinfo() { echo x >> "$HOME/mi-called"; printf "%s" "$HOME/no-such-table"; };';
/** The CONTROL after a Darwin subject: the poison records a read, so its absence there means none was made. */
const poisonIsLive = (): void => {
  expect(h.sh(`${POISON} _ws_collect_mounts_clear "$HOME"; printf '[rc=%s]' "$?"`)).toBe('[rc=2]');
  expect(fs.existsSync(path.join(h.home, 'mi-called')), 'the poison records a read').toBe(true);
};
/** `_ws_collect_mounts_clear`, wrapped (the reprove suite's seam): every reason it sets lands in `$HOME/mounts-why`. */
const MOUNTS_WHY = 'eval "_real_mounts_clear() $(declare -f _ws_collect_mounts_clear | tail -n +2)";'
  + ' _ws_collect_mounts_clear() { _real_mounts_clear "$@"; local r=$?;'
  + ' printf \'%s\\n\' "$_WS_MOUNTS_WHY" >> "$HOME/mounts-why"; return $r; };';
const reclaimToken = (): string => {
  const a = evalOf(h);
  expect(a.token, `the CONTROL: the ladder passes — ${a.verdict}: ${a.detail}`).toMatch(/^[0-9a-f]{64}$/);
  return a.token;
};
/** A standing nested checkout of the child's own repository, holding a file of its own. */
const nested = (c: Child): string => {
  const inner = path.join(c.wt, 'inner');
  h.git(c.main, 'worktree', 'add', '-b', 'ws/nested', inner);
  fs.writeFileSync(path.join(inner, 'f'), 'nested work\n');
  return inner;
};

describe('the rows rung places a row by device and inode, at every caller (path-identity spec §4.5)', () => {
  const NESTED = 'has registry row(s) demo-bind rooted inside it';

  it('I1 L: a row spelled through a bind stand-in is NESTED at the reclaim ladder, containment-unproven and no token', () => {
    const c = makeChild(h);
    bindRow(c.wt);
    const r = evalOf(h, { pre: STANDIN });
    expect(r.verdict, r.detail).toBe('containment-unproven');
    expect(r.token).toBe('');
    expect(r.detail).toContain(NESTED);
  }, 60_000);

  it('I1 CONTROL: without the stand-in the same row resolves through the link, and its string places it', () => {
    const c = makeChild(h);
    bindRow(c.wt);
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('containment-unproven');
    expect(r.detail).toContain(NESTED);
  }, 60_000);

  it('I1 X: the same row is NESTED at the expire ladder', () => {
    const a = makeArchived(h);
    bindRow(a.wt);
    const r = expireEvalOf(h, { pre: `${FAKE_PROC_SELF} ${STANDIN}` });
    expect(r.verdict, r.detail).toBe('containment-unproven');
    expect(r.token).toBe('');
    expect(r.detail).toContain(NESTED);
  }, 60_000);

  it('I1 O: the same row makes the tail’s owned call answer 1', () => {
    const c = makeChild(h);
    bindRow(c.wt);
    const a = owned(c.wt, c.main, STANDIN);
    expect(a.rc, a.why).toBe('1');
    expect(a.why).toContain(NESTED);
  }, 60_000);

  it('I1 SHARED: a row spelled as the stand-in itself IS the child, SHARED', () => {
    const c = makeChild(h);
    fs.symlinkSync(c.wt, path.join(h.home, 'bindlike'));
    row('demo-bind', path.join(h.home, 'bindlike'));
    const r = evalOf(h, { pre: STANDIN });
    expect(r.verdict, r.detail).toBe('containment-unproven');
    expect(r.detail).toContain('is also named by registry row(s) demo-bind');
  }, 60_000);

  it('I1 leaf: a row spelled through a stand-in into the temp root leaf is NESTED', () => {
    makeChild(h);
    const leaf = path.join(h.home, '.cc-tmp', CHILD_ID);
    fs.mkdirSync(path.join(leaf, 'x'), { recursive: true });
    fs.symlinkSync(leaf, path.join(h.home, 'tmplike'));
    row('demo-tmp', path.join(h.home, 'tmplike', 'x'));
    const r = evalOf(h, { pre: BIND_STANDIN('$HOME/tmplike') });
    expect(r.verdict, r.detail).toBe('containment-unproven');
    expect(r.detail).toContain('has registry row(s) demo-tmp rooted inside it, or in its clips directory or temp root');
  }, 60_000);
});

describe.skipIf(!LINUX)('m1: a row reached through a link into /proc is unplaced (path-identity spec §4.8)', () => {
  it.each([['/proc/self/cwd'], ['//proc/self/cwd'], ['///proc/self/cwd']] as const)('I7 raw %s: unmeasured, the reworded unproc clause, no token', (target) => {
    makeChild(h);
    fs.mkdirSync(path.join(h.home, 'elsewhere'));
    expect(evalOf(h).verdict, 'the CONTROL: without the row').toBe('reclaimable');
    fs.symlinkSync(target, path.join(h.home, 'pl'));
    row('demo-pl', path.join(h.home, 'pl', 'elsewhere'));
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.token).toBe('');
    expect(r.detail).toContain(`registry row(s) demo-pl ${UNPROC}`);
  }, 60_000);

  it('I7 position: a RELATIVE link whose walk enters /proc by its physical position is the same', () => {
    makeChild(h);
    fs.mkdirSync(path.join(h.home, 'elsewhere'));
    const dir = path.join(h.home, 'a', 'b');
    fs.mkdirSync(dir, { recursive: true });
    const depth = fs.realpathSync(dir).split('/').filter(Boolean).length;
    const target = `${'../'.repeat(depth + 2)}proc/self/cwd`;
    expect(target.startsWith('/'), 'the CONTROL: no raw /proc in the target').toBe(false);
    fs.symlinkSync(target, path.join(dir, 'pl'));
    row('demo-pl', path.join(dir, 'pl', 'elsewhere'));
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.detail).toContain(`registry row(s) demo-pl ${UNPROC}`);
  }, 60_000);

  it('I7 CONTROL: the plain row at the same directory is reclaimable', () => {
    makeChild(h);
    fs.mkdirSync(path.join(h.home, 'elsewhere'));
    row('demo-plain', path.join(h.home, 'elsewhere'));
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('reclaimable');
  }, 60_000);

  it('I7 outranked: a row rooted inside the child in the same pass outranks the link row', () => {
    const { wt } = makeChild(h);
    fs.mkdirSync(path.join(h.home, 'elsewhere'));
    fs.mkdirSync(path.join(wt, 'server'));
    fs.symlinkSync('/proc/self/cwd', path.join(h.home, 'pl'));
    row('demo-pl', path.join(h.home, 'pl', 'elsewhere'));
    row('demo-nested', path.join(wt, 'server'));
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('containment-unproven');
    expect(r.detail).toContain('registry row(s) demo-nested rooted inside');
  }, 60_000);
});

describe.skipIf(!LINUX)('the mount hold: a mount that could give the child another spelling holds it (path-identity spec §4.5)', () => {
  it('I8 point: a mount point under the child, with no other row at all, holds it (before this, the ladder minted a token)', () => {
    const c = makeChild(h);
    realMounts(h);
    mountAt(path.join(fs.realpathSync(c.wt), 'm'));
    held(evalOf(h, { pre: MOUNTS_SEAM }), CHILD_ID, 'point');
  }, 60_000);

  it('I8 root: a mount of its file system whose root lies under its device-relative path holds it', () => {
    const c = makeChild(h);
    realMounts(h);
    const real = fs.realpathSync(c.wt);
    fs.appendFileSync(tableOf(), `${ROOT_LINE(containing(real).majmin, `${devRel(real)}/sub`)}\n`);
    held(evalOf(h, { pre: MOUNTS_SEAM }), CHILD_ID, 'root');
  }, 60_000);

  it('I8 deleted: the same root marked //deleted holds it', () => {
    const c = makeChild(h);
    realMounts(h);
    const real = fs.realpathSync(c.wt);
    fs.appendFileSync(tableOf(), `${ROOT_LINE(containing(real).majmin, `${devRel(real)}/sub//deleted`)}\n`);
    held(evalOf(h, { pre: MOUNTS_SEAM }), CHILD_ID, 'deleted');
  }, 60_000);

  it('I8 devmismatch: a containing line whose major:minor is not the child’s device holds it (fails closed)', () => {
    const c = makeChild(h);
    realMounts(h);
    const { at } = containing(fs.realpathSync(c.wt));
    const lines = fs.readFileSync(tableOf(), 'utf8').split('\n');
    const f = lines[at]!.split(' ');
    f[2] = '0:999';
    lines[at] = f.join(' ');
    fs.writeFileSync(tableOf(), lines.join('\n'));
    held(evalOf(h, { pre: MOUNTS_SEAM }), CHILD_ID, 'devmismatch');
  }, 60_000);

  it('I8 slashes: a child under a root that resolves to `//` is asked by its collapsed spelling, and a mount under it holds', () => {
    const c = makeChild(h);
    fs.renameSync(path.join(h.home, 'worktrees'), path.join(h.home, 'wtreal'));
    fs.symlinkSync(`/${path.join(h.home, 'wtreal')}`, path.join(h.home, 'worktrees'));
    const real = fs.realpathSync(c.wt);
    expect(h.sh(`_ws_dir_physical '${c.wt}'; printf '%s' "$_WS_PHYS"`),
      'the CONTROL: bash keeps the link target’s leading `//`').toBe(`/${real}`);
    realMounts(h);
    expect(evalOf(h, { pre: MOUNTS_SEAM }).verdict, 'the CONTROL: with no mount, the `//` child reclaims').toBe('reclaimable');
    mountAt(path.join(real, 'sub'));
    held(evalOf(h, { pre: MOUNTS_SEAM }), CHILD_ID, 'point');
  }, 60_000);

  it('I8 CONTROL live: the kernel’s own table, unaltered, reclaims (on CI, the device match R13 asks)', () => {
    makeChild(h);
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('reclaimable');
  }, 60_000);

  it('I8 CONTROL sibling: the copied table with a mount beside the child, at `<child>-x`, reclaims', () => {
    const c = makeChild(h);
    realMounts(h);
    mountAt(`${fs.realpathSync(c.wt)}-x`);
    const r = evalOf(h, { pre: MOUNTS_SEAM });
    expect(r.verdict, r.detail).toBe('reclaimable');
  }, 60_000);
});

describe.skipIf(!LINUX)('the earlier catches: the in-lock recompute and the tail’s owned call read the table first (P19)', () => {
  it('MB1: a mount under a standing nested checkout, planted after the token, fails probe-unmeasured at the in-lock recompute; nothing written or removed, W2’s ask never reached', () => {
    const c = makeChild(h);
    const inner = nested(c);
    const realInner = fs.realpathSync(inner);
    const tok = reclaimToken();
    realMounts(h);
    mountAt(path.join(realInner, 'mnt'));
    const r = childReclaimVerb(h, tok, { pre: `${MOUNTS_SEAM} ${NOBODY} ${ASK_LOG} ${KEEP_LOG} ${PROC_SPY}` });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const d = docOf(r.stdout);
    expect(d['failed']).toBe('probe-unmeasured');
    expect(String(d['detail'])).toContain(UNMOUNT(CHILD_ID, 'point'));
    expect(h.reg(CHILD_ID, 'reaping'), 'no breadcrumb was written').toBeNull();
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', '.reaped', `${CHILD_ID}.json`)), 'no tombstone: nothing was pinned').toBe(false);
    expect(fs.readFileSync(path.join(inner, 'f'), 'utf8'), 'the nested checkout stands').toBe('nested work\n');
    expect(h.git(c.main, 'branch', '--list', 'ws/nested'), 'its branch stands').toContain('ws/nested');
    expect(fs.existsSync(path.join(c.wt, 'f1.txt')), 'the child’s tree stands').toBe(true);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH), 'the child’s branch stands').toContain(CHILD_BRANCH);
    expect(linesIn('ask-calls'), 'W2’s ask was never reached').toEqual([]);
    expect(linesIn('keep-calls'), 'keep_of was never asked').toEqual([]);
    expect(linesIn('proc-walks'), 'no walk of the real /proc').toEqual([]);
  }, 120_000);

  it('MB2: the same under the archived tree, through ws-expire: failed probe-unmeasured; the tree and its branch stand', () => {
    const a = makeArchived(h);
    const tok = expireToken(h, { pre: FAKE_PROC_SELF });
    expect(tok, 'the CONTROL: the expiry ladder passes').toMatch(/^[0-9a-f]{64}$/);
    realMounts(h);
    mountAt(path.join(fs.realpathSync(a.wt), 'sub'));
    const r = expireVerb(h, tok, { pre: `${FAKE_PROC_SELF} ${MOUNTS_SEAM} ${NOBODY} ${ASK_LOG} ${PROC_SPY}` });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const d = docOf(r.stdout);
    expect(d['failed']).toBe('probe-unmeasured');
    expect(String(d['detail'])).toContain(UNMOUNT(EXP_ID, 'point'));
    expect(h.reg(EXP_ID, 'reaping'), 'no breadcrumb was written').toBeNull();
    expect(fs.existsSync(path.join(a.wt, 'f1.txt')), 'the archived tree stands').toBe(true);
    expect(h.git(a.main, 'branch', '--list', EXP_BRANCH), 'its branch stands').toContain(EXP_BRANCH);
    expect(linesIn('ask-calls'), 'W2’s ask was never reached').toEqual([]);
    expect(linesIn('proc-walks'), 'no walk of the real /proc').toEqual([]);
  }, 120_000);

  it('MB3: a tail resumed at worktree with a mount under the child: owned’s rung holds it, worktree-remove-failed, the breadcrumb kept, keep_of never asked', () => {
    const c = makeChild(h);
    const wd = h.reg(CHILD_ID, 'workdir')!;
    interrupted(c, 'worktree');
    const tok = resumeToken('worktree');
    realMounts(h);
    mountAt(path.join(fs.realpathSync(c.wt), 'sub'));
    const r = childReclaimVerb(h, tok, { pre: `${MOUNTS_SEAM} ${NOBODY} ${KEEP_LOG} ${ASK_LOG} ${PROC_SPY}` });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const d = docOf(r.stdout);
    expect(d['failed']).toBe('worktree-remove-failed');
    expect(String(d['detail'])).toMatch(new RegExp(`^could not ask whether another registry row names ${esc(wd)} or a path inside it: `));
    expect(String(d['detail'])).toContain(UNMOUNT(CHILD_ID, 'point'));
    expect(h.reg(CHILD_ID, 'reaping'), 'the breadcrumb stays').toBe('reclaim:worktree');
    expect(fs.existsSync(path.join(c.wt, 'f1.txt')), 'the tree stands').toBe(true);
    expect(linesIn('keep-calls').filter((l) => l === wd), 'keep_of was never asked of the tree').toEqual([]);
    expect(linesIn('ask-calls'), 'W2’s ask was never reached').toEqual([]);
    expect(linesIn('proc-walks'), 'no walk of the real /proc').toEqual([]);
    failedPairAgrees(r);
  }, 120_000);
});

describe('the permission pass and the walk, each answering for its own bound', () => {
  /** Every `_plat_timeout` answers `code` except the walk's, whose second word is `"$BASH"` (its one bounded exec):
   *  that one runs under the real bound. */
  const ONLY_THE_WALK = (code: number): string =>
    'eval "_t_pt_real()$(declare -f _plat_timeout | tail -n +2)";'
    + ' _plat_timeout() { if [[ "${2-}" == "$BASH" ]]; then _t_pt_real "$@"; return; fi; return ' + String(code) + '; };';

  it.each([[124], [125], [126], [127], [137]] as const)('rung 8 own %i: every bound but the walk’s answers it, so the permission pass answers, never the walk', (code) => {
    const { wt } = makeChild(h);
    const a = path.join(wt, 'a');
    fs.mkdirSync(a);
    fs.chmodSync(a, 0o000);
    try {
      const r = evalOf(h, { pre: ONLY_THE_WALK(code) });
      expect(r.verdict, r.detail).toBe('unmeasured');
      expect(r.token).toBe('');
      expect(r.detail).toContain(`the permission pass over ${wt} could not run`);
      expect(r.detail).not.toContain('identity walk');
    } finally { fs.chmodSync(a, 0o755); }
  }, 60_000);

  it.each([[124], [137]] as const)('rung 8 family %i: the ladder suite’s global stub, where the walk answers first, out of time', (code) => {
    makeChild(h);
    const r = evalOf(h, { pre: `_plat_timeout() { return ${code}; };` });
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.detail).toContain(`${UNWALK}any row (the identity walk did not finish within 5s)`);
  }, 60_000);

  it.each([[125], [126], [127]] as const)('rung 8 family %i: the ladder suite’s global stub, where the walk answers first, not measured', (code) => {
    makeChild(h);
    const r = evalOf(h, { pre: `_plat_timeout() { return ${code}; };` });
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.detail).toContain(`${UNWALK}any row (the identity walk could not be measured (exit ${code}))`);
  }, 60_000);
});

describe.skipIf(!LINUX || !NO_COPY)('the collector before its move', () => {
  it('C7: a table that cannot be read holds the leaf where it stands: failed probe-unmeasured before the move, no slot, no record, step 5 never reached', () => {
    const o = makeOrphan(h);
    const tok = collectToken(h, { pre: PROBE_STUB });
    const r = collectVerb(h, tok, { pre: `${PROBE_STUB} ${PROC_SPY} ${GAP_LOG} ${MOUNTS_WHY}`
      + ' _ws_collect_mountinfo() { printf \'%s\' "$HOME/no-such-table"; };' });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(docOf(r.stdout)['failed']).toBe('probe-unmeasured');
    expect(gaps(h), 'refused inside the lock, before its consent').not.toContain('consented');
    expect(gaps(h), 'never moved').not.toContain('moved');
    expect(slots(h), 'no slot').toEqual([]);
    expect(records(h), 'no record').toEqual([]);
    expect(inoAt(o.leaf), 'the leaf at its own path, the same inode').toBe(o.ino);
    expect(linesOf(h, 'mounts-why'), 'step 5’s mount question was never reached').toEqual([]);
    expect(linesIn('proc-walks'), 'no walk of the real /proc').toEqual([]);
  }, 60_000);
});

describe('no mount table is asked on Darwin, and ancestry stands alone there', () => {
  const DARWIN = `CCD_OS=darwin; ${POISON}`;

  it('Darwin stand-in: a row through the stand-in is NESTED by ancestry, and no table was read', () => {
    const c = makeChild(h);
    bindRow(c.wt);
    const r = evalOf(h, { pre: `${DARWIN} ${STANDIN}` });
    expect(r.verdict, r.detail).toBe('containment-unproven');
    expect(r.detail).toContain('has registry row(s) demo-bind rooted inside it');
    expect(fs.existsSync(path.join(h.home, 'mi-called')), 'no mount table was read').toBe(false);
    poisonIsLive();
  }, 60_000);

  it('Darwin clean: a clean child reclaims, and no table was read', () => {
    makeChild(h);
    const r = evalOf(h, { pre: DARWIN });
    expect(r.verdict, r.detail).toBe('reclaimable');
    expect(fs.existsSync(path.join(h.home, 'mi-called')), 'no mount table was read').toBe(false);
    poisonIsLive();
  }, 60_000);
});

describe.skipIf(!LINUX)('a walk that does not finish is unmeasured, never "no row"', () => {
  it('FIFO: the table a FIFO with no writer, the walk bounded at 1 s: unmeasured, naming the walk', () => {
    makeChild(h);
    fifo();
    const r = ladderBounded(FIFO_SEAM);
    expect(r.timedOut, 'the walk was bounded: the group never reached its 20 s timeout').toBe(false);
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.token).toBe('');
    expect(r.detail).toContain(`${UNWALK}any row (the identity walk did not finish within 1s)`);
  }, 60_000);

  it('FIFO outranked: the same beside a row that names the child is containment-unproven, because a placement outranks the walk', () => {
    makeChild(h);
    fifo();
    row('demo-shared', h.reg(CHILD_ID, 'workdir')!);
    const r = ladderBounded(FIFO_SEAM);
    expect(r.timedOut).toBe(false);
    expect(r.verdict, r.detail).toBe('containment-unproven');
    expect(r.detail).toContain('is also named by registry row(s) demo-shared');
  }, 60_000);
});

describe('the vanished child', () => {
  it('vanished: R19’s answer is unchanged, and the walk asks neither the child nor the table', () => {
    const { wt } = makeChild(h);
    fs.rmSync(wt, { recursive: true, force: true });
    const r = evalOf(h, { pre: walkSpy });
    expect(r.verdict, r.detail).toBe('reclaimable');
    const calls = linesIn('walk-calls');
    expect(calls, 'one walk').toHaveLength(1);
    const toks = calls[0]!.split(' ');
    expect(toks, 'no target 0').not.toContain('T0');
    expect(toks, 'no table').not.toContain('M0');
  }, 60_000);
});

describe.skipIf(!LINUX)('the collector’s row rule asks the same rung, with its leaf as the child', () => {
  it('collector I1: a row through a stand-in into the leaf is inside it: rc 1', () => {
    makeOrphan(h);
    bindRow(leafOf(h));
    const out = collectRows(leafOf(h), STANDIN);
    expect(out).toMatch(/^\[rc=1\] registry row\(s\) lie at, inside or through /);
    expect(out).toContain('inside: demo-bind;');
  }, 60_000);

  it('collector FIFO: a walk that did not finish is rc 2, never "no row"', () => {
    makeOrphan(h);
    fifo();
    const b = bounded(`${FIFO_SEAM} _ws_collect_rows_clear ${COL_ID} "$HOME/.cc-tmp/${COL_ID}";`
      + ' printf \'[rc=%s] %s\' "$?" "$_WS_COLLECT_ROWS_WHY"');
    expect(b.timedOut).toBe(false);
    expect(b.out).toMatch(/^\[rc=2\] asked with /);
    expect(b.out).toContain(`${UNWALK}any row (the identity walk did not finish within 1s)`);
  }, 60_000);
});

describe('one walk per pass', () => {
  it.each([[0], [1], [10]] as const)('one walk with %i other row(s): evalOf walks once, one link walk and one ancestry per row', (n) => {
    makeChild(h);
    for (let i = 0; i < n; i++) {
      const d = path.join(h.home, `elsewhere-${i}`);
      fs.mkdirSync(d);
      row(`demo-r${i}`, d);
    }
    const r = evalOf(h, { pre: walkSpy });
    expect(r.verdict, r.detail).toBe('reclaimable');
    const calls = linesIn('walk-calls');
    expect(calls, 'one walk').toHaveLength(1);
    const toks = calls[0]!.split(' ').slice(1);
    expect(toks.filter((t) => t.startsWith('P')), 'one link walk per row').toHaveLength(n);
    expect(toks.filter((t) => t.startsWith('A')), 'one ancestry per row').toHaveLength(n);
    expect(toks).toContain('T0');
    if (LINUX) expect(toks).toContain('M0');
    else expect(toks).not.toContain('M0');
  }, 60_000);
});

describe('a request stream cut short is unmeasured, never "no row"', () => {
  /** `_ws_reclaim_idwalk`, wrapped: it hands the real walk only the FIRST request it was given, target 0, as a
   *  request stream whose writer stopped after one record would reach it, so the table's `M` (on Linux) and the row's
   *  `P` and `A` are dropped (R64). The walk answers that one request whole, rc 0. */
  const FIRST_ONLY = 'eval "_t_walk_real()$(declare -f _ws_reclaim_idwalk | tail -n +2)";'
    + ' _ws_reclaim_idwalk() { local _t_q=\'\'; IFS= read -r -d \'\' _t_q || :;'
    + ' _t_walk_real "$@" < <(printf \'%s\\0\' "$_t_q"); };';

  it('short stream: the walk handed target 0 alone answers it whole, and the rung, matching the reply with its own requests, holds every row', () => {
    makeChild(h);
    const d = path.join(h.home, 'elsewhere-0');
    fs.mkdirSync(d);
    row('demo-r0', d);
    const r = evalOf(h, { pre: FIRST_ONLY });
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.token).toBe('');
    expect(r.detail).toContain(`${UNWALK}any row (the walk answered a request list it was not given whole)`);
  }, 60_000);
});

describe.skipIf(!LINUX)('parity: the walk’s mount point arm answers what `_ws_collect_mounts_clear` answers, on the same tables (R13)', () => {
  /** One copied table plus `lines`, then the walk asked T0 and M of `child`, and the collector's own reader asked of
   *  `child`: `[<walk rc>, <its M line>, <_ws_collect_mounts_clear rc>]`. */
  const both = (child: string, lines: string[]): string[] => {
    realMounts(h);
    for (const l of lines) mountAt(l);
    return h.sh(`${MOUNTS_SEAM} MI=$(_ws_collect_mountinfo);`
      + ' _ws_reclaim_idwalk "$MI" < <(printf \'T\\t0\\t%s\\0M\\t0\\t%s\\0\' "$W3_CHILD" "$MI"); w=$?;'
      + ' m=$(printf \'%s\\n\' "$_WS_IDWALK_OUT" | grep \'^M 0 \'); _ws_collect_mounts_clear "$W3_CHILD";'
      + ' printf \'%s|%s|%s\' "$w" "$m" "$?"', { W3_CHILD: child }).split('|');
  };
  const expectParity = (got: string[], want: 'point' | 'clear'): void => {
    const [w = '', m = '', rc = ''] = got;
    expect(w, 'the walk answered').toBe('0');
    if (want === 'point') {
      expect(m).toBe('M 0 hold point');
      expect(rc, '_ws_collect_mounts_clear: a mount stands').toBe('1');
    } else {
      expect(m).toMatch(/^M 0 clear \d+$/);
      expect(rc, '_ws_collect_mounts_clear: none').toBe('0');
    }
  };

  it.each([
    ['clean', (_c: string): string[] => [], 'clear'],
    ['a mount point AT the child', (c: string): string[] => [c], 'point'],
    ['a mount point UNDER it', (c: string): string[] => [`${c}/m`], 'point'],
    ['a SIBLING, `<child>-x`', (c: string): string[] => [`${c}-x`], 'clear'],
  ] as const)('parity %s', (_what, plant, want) => {
    const child = path.join(h.home, 'pc', 'c');
    fs.mkdirSync(child, { recursive: true });
    expectParity(both(child, plant(child)), want);
  });

  it('parity a child spelled with a space, compared encoded', () => {
    const child = path.join(h.home, 'sp ace', 'c');
    fs.mkdirSync(child, { recursive: true });
    expectParity(both(child, [`${child}/m`]), 'point');
  });
});

describe('the mount table has exactly two readers, both through its one seam (R13)', () => {
  it('two readers: the call graph’s callers of `_ws_collect_mountinfo` are `_ws_collect_mounts_clear` and the rows rung', () => {
    const callers = ccdCallGraph().filter((e) => e.callee === '_ws_collect_mountinfo').map((e) => e.caller).sort();
    expect(callers).toEqual(['_ws_collect_mounts_clear', '_ws_reclaim_workdir_shared']);
  });

  it('one literal: /proc/self/mountinfo stands in ccd’s code only in the seam and in `_carry_py`’s own CCD_MOUNTINFO reader', () => {
    const holders = new Set<string>();
    let fn = '';
    for (const l of fs.readFileSync(CCD, 'utf8').split('\n')) {
      const m = CCD_FUNCTION_DEF.exec(l);
      if (m) fn = m[1]!;
      if (bashCodeOf(l).includes('/proc/self/mountinfo')) holders.add(fn);
    }
    expect([...holders].sort()).toEqual(['_carry_py', '_ws_collect_mountinfo']);
  });
});
