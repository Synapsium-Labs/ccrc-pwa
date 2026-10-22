// path-identity W3, Task 11 (path-identity spec §4.7; PI5 A, PI10 O2). The reclaim and expiry tail re-proves what it is
// about to delete directly before every standing forced removal. `_ws_reclaim_owned` used to be asked once, before the
// settle, and the settle and the nested steps ran after it, so none of these was asked again before
// `git worktree remove --force`: a row another session wrote inside the child, a checkout or the child swapped for a
// copy, an ancestor re-pointed, a mount that appeared, a tree that stood again after the act proved it gone. Now
// `_ws_reclaim_reask` runs directly before each standing nested checkout's and the child's `_ws_reclaim_keep_of`, and
// again directly before each forced removal: `_ws_reclaim_owned` whole and fresh (its proof is `containment-refuted`),
// then the project directory, the tree and the checkout against the identities the act recorded (anything else is
// `worktree-remove-failed`). It stands after the working-directory probe and directly before the mount question at each site, and the
// breadcrumb, the tree and its branch stand after every refusal.
// FIXTURE HOME ONLY (`makePrHarness`): both verbs run as sourced functions with the unit and pane calls recorded
// (`CHILD_STUBS`, `EXP_STUBS`, which `childReclaimVerb` and `expireVerb` prepend), every path is derived from `h.home`,
// and every change made inside the tail is made by a wrapper of a real ccd function (`declare -f`), never by racing
// it. MOUNTS ARE FAKED, NEVER MADE (`MOUNTS_SEAM`). The tail's post-kill wait and its working-directory probe walk the
// real /proc in every verb case, so this file is a CLAUDE.md load flake. The verb cases run on Linux only; the Darwin
// case (forced, with the identity shims), the unit rows and the source pins run on every host.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CCD } from './ccdWsHelpers.js';
import { eventsOf } from './lifecycleHelpers.js';
import { CHILD_BRANCH, CHILD_ID, childReclaimVerb, evalOf, makeChild, type Child } from './childReclaimFixture.js';
import { verbHelpers } from './childReclaimVerbHelpers.js';
import {
  EXP_BRANCH, EXP_ID, EXP_STUBS, expireToken, expireVerb, makeArchived, type Archived,
} from './wsExpireFixture.js';
import { MOUNTS_SEAM, realMounts } from './wsCollectFixture.js';
import { DARWIN_IDENT_SHIMS, DARWIN_LSOF_STUB } from './worktreeIdentityFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-tw-'); });
afterEach(() => { h.cleanup(); });
const { interrupted, resumeToken, failedPairAgrees } = verbHelpers(() => h);

const LINUX = process.platform === 'linux';
type Run = { code: number; stdout: string; stderr: string };
type Doc = { failed?: string; detail?: string; refused?: string; reclaimed?: string; expired?: string };
const docOf = (r: Run): Doc => JSON.parse(r.stdout) as Doc;
/** The post-kill wait's bound, lowered: nothing here works in the temp root, so the first ask already ends it. */
const WAIT = 'CCD_RECLAIM_TMPROOT_WAIT_S=2;';
const IDENT = /^[0-9]+:[0-9]+:([1-9][0-9]*|-)$/;
const reg = (f: string): string => path.join(h.home, '.cc-sessions', f);
const linesIn = (name: string): string[] => {
  const p = path.join(h.home, name);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
};
/** A file of bash that one of the wrappers below sources, ONCE. */
const hook = (name: string, body: string): void => { fs.writeFileSync(path.join(h.home, name), body); };
/** Another session's STANDING registry row, its two files as `ccd start` writes them, and work of its own: bash. */
const rowSh = (id: string, workdir: string): string =>
  `mkdir -p "${workdir}"; printf live > "${workdir}/live.txt";`
  + ` printf '%s' 'u-${id}' > "${reg(`${id}.uuid`)}"; printf '%s' "${workdir}" > "${reg(`${id}.workdir`)}";\n`;
/** A directory swapped for a copy of itself (a new inode, the same bytes, the same `.git` file): bash. */
const swapSh = (p: string): string => `mv "${p}" "${p}.orig" && cp -a "${p}.orig" "${p}";\n`;
/** A mount point as the kernel's table writes it, and one table line naming `p` as a mount point (W2's shape). */
const encoded = (p: string): string =>
  p.replace(/\\/g, '\\134').replace(/ /g, '\\040').replace(/\t/g, '\\011').replace(/\n/g, '\\012');
const MOUNT_LINE = (p: string): string => `9999 1 0:99 / ${encoded(p)} rw,relatime - tmpfs tmpfs rw`;

/** `_ws_reclaim_keep_of`, wrapped: logs its `$4` (the path or branch it keeps for) to `$HOME/keep-calls`, runs the real
 *  one, and once that answered 0 for the spelling in `$HOME/act-when`, sources `$HOME/act.sh` ONCE. */
const KEEP_HOOK = 'eval "_t_keep_real()$(declare -f _ws_reclaim_keep_of | tail -n +2)";'
  + ' _ws_reclaim_keep_of() { local r; printf \'%s\\n\' "$4" >> "$HOME/keep-calls"; _t_keep_real "$@"; r=$?;'
  + ' if (( r == 0 )) && [[ -f "$HOME/act-when" && ! -e "$HOME/act-ran" ]] && [[ "$4" == "$(cat "$HOME/act-when")" ]]; then'
  + ' : > "$HOME/act-ran"; . "$HOME/act.sh"; fi; return "$r"; };';
/** Arms `KEEP_HOOK`: once `_ws_reclaim_keep_of` answered 0 for `spelling`, `body` runs. */
const afterKeep = (spelling: string, body: string): void => { hook('act-when', spelling); hook('act.sh', body); };
/** `_reg_set`, wrapped: once it has written the breadcrumb `<act>:worktree` (step 3 is done and step 4 has asked nothing
 *  yet), sources `$HOME/at-worktree.sh` ONCE. */
const AT_WORKTREE = 'eval "_t_regset_real()$(declare -f _reg_set | tail -n +2)";'
  + ' _reg_set() { local r; _t_regset_real "$@"; r=$?;'
  + ' if [[ "${2-}" == reaping && "${3-}" == *:worktree && -f "$HOME/at-worktree.sh" && ! -e "$HOME/at-worktree-ran" ]]; then'
  + ' : > "$HOME/at-worktree-ran"; . "$HOME/at-worktree.sh"; fi; return "$r"; };';
/** `_ws_reclaim_nested_record`, wrapped: sources `$HOME/at-nrec.sh` ONCE before the real one runs, inside step 3, after
 *  the checkout was proven and before its first re-ask. */
const AT_NREC = 'eval "_t_nrec_real()$(declare -f _ws_reclaim_nested_record | tail -n +2)";'
  + ' _ws_reclaim_nested_record() { if [[ -f "$HOME/at-nrec.sh" && ! -e "$HOME/at-nrec-ran" ]]; then'
  + ' : > "$HOME/at-nrec-ran"; . "$HOME/at-nrec.sh"; fi; _t_nrec_real "$@"; };';
/** `_ws_reclaim_nested_proven`, wrapped: once the real one PROVED a standing checkout, and so measured its identity,
 *  sources `$HOME/at-nproof.sh` ONCE. */
const AT_NPROOF = 'eval "_t_nproof_real()$(declare -f _ws_reclaim_nested_proven | tail -n +2)";'
  + ' _ws_reclaim_nested_proven() { local r; _t_nproof_real "$@"; r=$?;'
  + ' if (( r == 0 && ! _WS_NPROOF_GONE )) && [[ -f "$HOME/at-nproof.sh" && ! -e "$HOME/at-nproof-ran" ]]; then'
  + ' : > "$HOME/at-nproof-ran"; . "$HOME/at-nproof.sh"; fi; return "$r"; };';
/** `_ws_dir_physical`, wrapped: counts the RE-ASK's own asks of it (`FUNCNAME[1]`: the second nested proof's root, asked
 *  directly after the checkout's identity compare and directly before that proof) in `$HOME/at-phys-n`, and at the SECOND
 *  such ask, the re-ask directly before the checkout's forced removal, sources `$HOME/at-phys.sh` ONCE, then asks the real
 *  one. A fixture's wrap of a real ccd function, never a seam of the shipped code. */
const AT_PHYS = 'eval "_t_phys_real()$(declare -f _ws_dir_physical | tail -n +2)";'
  + ' _ws_dir_physical() { if [[ "${FUNCNAME[1]-}" == _ws_reclaim_reask && -f "$HOME/at-phys.sh" && ! -e "$HOME/at-phys-ran" ]]; then'
  + ' local n=0; [[ ! -f "$HOME/at-phys-n" ]] || n=$(cat "$HOME/at-phys-n"); n=$((n + 1)); printf \'%s\' "$n" > "$HOME/at-phys-n";'
  + ' if (( n == 2 )); then : > "$HOME/at-phys-ran"; . "$HOME/at-phys.sh"; fi; fi; _t_phys_real "$@"; };';
/** `_ws_reclaim_owned`, wrapped: logs its `$2` to `$HOME/owned-calls`, runs the real one, and after that FIRST answer
 *  (the tail's own call: the ladder never asks owned) sources `$HOME/after-owned.sh` ONCE. */
const OWNED_HOOK = 'eval "_t_owned_real()$(declare -f _ws_reclaim_owned | tail -n +2)";'
  + ' _ws_reclaim_owned() { local r; printf \'%s\\n\' "$2" >> "$HOME/owned-calls"; _t_owned_real "$@"; r=$?;'
  + ' if [[ -f "$HOME/after-owned.sh" && ! -e "$HOME/after-owned-ran" ]]; then'
  + ' : > "$HOME/after-owned-ran"; . "$HOME/after-owned.sh"; fi; return "$r"; };';
/** `_ws_reclaim_reask`, wrapped: logs `<workdir>|<cpath>|<answer>` to `$HOME/reask-calls`. */
const REASK_LOG = 'eval "_t_reask_real()$(declare -f _ws_reclaim_reask | tail -n +2)";'
  + ' _ws_reclaim_reask() { local r; _t_reask_real "$@"; r=$?;'
  + ' printf \'%s|%s|%s\\n\' "$2" "${6-}" "$r" >> "$HOME/reask-calls"; return "$r"; };';
/** `_ws_removal_mounts_clear`, wrapped: logs `<dir>|<mode>` to `$HOME/ask-calls`, then asks the real one. */
const ASK_LOG = 'eval "_t_ask_real()$(declare -f _ws_removal_mounts_clear | tail -n +2)";'
  + ' _ws_removal_mounts_clear() { printf \'%s|%s\\n\' "$1" "${2-}" >> "$HOME/ask-calls"; _t_ask_real "$@"; };';
const asked = (spelling: string, mode = ''): number =>
  linesIn('ask-calls').filter((l) => l === `${spelling}|${mode}`).length;
/** `_ws_reclaim_idwalk`, wrapped: logs `<answer>|<why>` to `$HOME/walk-answers`. */
const WALK_ANSWERS = 'eval "_t_walk_real()$(declare -f _ws_reclaim_idwalk | tail -n +2)";'
  + ' _ws_reclaim_idwalk() { local r; _t_walk_real "$@"; r=$?;'
  + ' printf \'%s|%s\\n\' "$r" "${_WS_IDWALK_WHY-}" >> "$HOME/walk-answers"; return "$r"; };';
/** The mount table's seam: the faked table for every reader, except that once `$HOME/walk-fifo` stands, the rows rung
 *  (and only it: `FUNCNAME[1]`) is handed that FIFO, which no process ever writes, so only the walk's own bound ends its
 *  read. The mount question (`_ws_collect_mounts_clear`) still reads the faked table, so no mutant can block on it. */
const WALK_FIFO_SEAM = '_ws_collect_mountinfo() { if [[ -p "$HOME/walk-fifo" && "${FUNCNAME[1]-}" == _ws_reclaim_workdir_shared ]];'
  + ' then printf \'%s\' "$HOME/walk-fifo"; else printf \'%s\' "$HOME/mountinfo"; fi; };';
/** Every walk of /proc the tail makes, counted: the temp root's probe and the working-directory probe. */
const PROC_SPY = '_ws_path_users_proc_root() { echo walk >> "$HOME/proc-walks"; printf "%s" /proc; };'
  + ' _ws_expire_proc_root() { echo walk >> "$HOME/proc-walks"; printf "%s" /proc; };';
/** Any read of the mount table is recorded in `$HOME/mi-called`, and the table cannot be read (W2's poison). */
const POISON = '_ws_collect_mountinfo() { echo x >> "$HOME/mi-called"; printf "%s" "$HOME/no-such-table"; };';

const reclaimToken = (): string => {
  const a = evalOf(h);
  expect(a.token, `the CONTROL: the ladder passes — ${a.verdict}: ${a.detail}`).toMatch(/^[0-9a-f]{64}$/);
  return a.token;
};
const expiryToken = (): string => {
  const t = expireToken(h);
  expect(t, 'the CONTROL: the expiry ladder passes').toMatch(/^[0-9a-f]{64}$/);
  return t;
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
/** A standing nested checkout one directory down, `<wt>/<dir>/inner`, so a directory sits between it and the child. */
const nestedBelow = (c: Child, dir: string): string => {
  const inner = path.join(c.wt, dir, 'inner');
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
interface Subject { act: 'reclaim' | 'expire'; id: string; wt: string; main: string; branch: string }
const R = (c: Child): Subject => ({ act: 'reclaim', id: CHILD_ID, wt: c.wt, main: c.main, branch: CHILD_BRANCH });
const X = (a: Archived): Subject => ({ act: 'expire', id: EXP_ID, wt: a.wt, main: a.main, branch: EXP_BRANCH });
const keptFor = (p: string): string[] => linesIn('keep-calls').filter((l) => l === p);
/** The tail stopped past its kill. What stands is asserted first: the tree, its branch, the tombstone, the row and the
 *  breadcrumb at `phase`. Then exit 1 and `failed: <word>`, never a refusal, with `why` in its detail. Then the journal
 *  row and the document carry one word and one detail. */
const stoppedAt = (r: Run, t: Subject, word: string, phase: string, why: string): Doc => {
  for (const f of ['f1.txt', 'f2.txt']) {
    expect(fs.existsSync(path.join(t.wt, f)), `the ${t.act}’s ${f} stands — ${r.stdout}`).toBe(true);
  }
  expect(h.git(t.main, 'branch', '--list', t.branch), 'its branch stands').toContain(t.branch);
  expect(fs.existsSync(reg(path.join('.reaped', `${t.id}.json`))), 'the tombstone stands').toBe(true);
  expect(h.reg(t.id, 'uuid'), 'the registry row stands').not.toBeNull();
  expect(h.reg(t.id, 'reaping'), 'the breadcrumb stays at the step that failed').toBe(`${t.act}:${phase}`);
  expect(h.calls(), 'the session was stopped first').toContain(`tmux kill-session -t =cc-${t.id}:`);
  expect(r.code, r.stdout + r.stderr).toBe(1);
  const o = docOf(r);
  expect(o.failed, String(o.detail)).toBe(word);
  expect(o.refused, 'a failure after the act started, never a refusal').toBeUndefined();
  expect(String(o.detail)).toContain(why);
  expect(String(o.detail)).toContain('nothing further was deleted');
  const row = eventsOf(h.home, t.act).filter((e) => e['outcome'] === 'failed').pop();
  expect(row, 'the failure is journaled').toBeDefined();
  expect([row!['refusal'], row!['verb'], row!['detail']], 'the journal row and the document say one word and one detail')
    .toEqual([word, `ws-${t.act}`, o.detail]);
  return o;
};
/** The act completed: exit 0, its document, the tree and its branch gone. */
const done = (r: Run, t: Subject): void => {
  expect(r.code, r.stdout + r.stderr).toBe(0);
  const o = docOf(r);
  expect(t.act === 'reclaim' ? o.reclaimed : o.expired).toBe(t.id);
  expect(fs.existsSync(t.wt), 'the tree went').toBe(false);
  expect(h.git(t.main, 'branch', '--list', t.branch), 'its branch went').toBe('');
};
/** An expiry interrupted after its pin, its breadcrumb at `worktree` (the expiry-tail suite's shape); its resume token. */
const expiryAtWorktree = (a: Archived): string => {
  h.sh(`${EXP_STUBS} _WS_RCL_ACT=expire; _ws_expire_eval ${EXP_ID} >/dev/null`
    + ` && _ws_reclaim_pin ${EXP_ID} "${a.wt}" "${a.main}" "$REAP_BRANCH" "$EXPIRE_ARCHIVED_AT"`
    + ` && _ws_tombstone ${EXP_ID} '[]' "$(_ws_reclaim_tomb_fields "$EXPIRE_ARCHIVED_AT" present)" >/dev/null`
    + ` && _reg_set ${EXP_ID} reaping expire:worktree`);
  expect(h.reg(EXP_ID, 'reaping'), 'the CONTROL: interrupted at `worktree`').toBe('expire:worktree');
  const tok = h.sh(`${EXP_STUBS} _WS_RCL_ACT=expire; _ws_expire_resume_eval ${EXP_ID} worktree >/dev/null; printf '%s' "$REAP_TOKEN"`);
  expect(tok, 'the CONTROL: the resume token').toMatch(/^[0-9a-f]{64}$/);
  return tok;
};

describe.skipIf(!LINUX)('the tail re-proves the tree, the rows and the main checkout before every standing forced removal (path-identity spec §4.7)', () => {
  it('W1: a row written inside the child after the owned call, before the nested checkout’s keep_of: containment-refuted, keep_of never asked of the checkout', () => {
    const c = makeChild(h);
    const inner = nested(c);
    const realInner = fs.realpathSync(inner);
    const plant = path.join(c.wt, 'inner2');
    hook('at-nrec.sh', rowSh('demo-inner2', plant));
    const r = childReclaimVerb(h, reclaimToken(), { pre: `${WAIT} ${KEEP_HOOK} ${AT_NREC}` });
    expect(fs.existsSync(path.join(h.home, 'at-nrec-ran')), 'the CONTROL: the row was planted inside the tail').toBe(true);
    stoppedAt(r, R(c), 'containment-refuted', 'children', 'registry row(s) demo-inner2 rooted inside');
    expect(fs.readFileSync(path.join(inner, 'f'), 'utf8'), 'the nested checkout stands').toBe('nested work\n');
    expect(h.git(c.main, 'branch', '--list', 'ws/nested'), 'its branch stands').toContain('ws/nested');
    expect(fs.existsSync(path.join(plant, 'live.txt')), 'the other session’s work stands').toBe(true);
    expect(keptFor(realInner), 'keep_of was never asked of the checkout').toEqual([]);
    failedPairAgrees(r);
  }, 120_000);

  it('W2: a row written during the nested checkout’s keep_of: the second re-ask refuses before its forced removal', () => {
    const c = makeChild(h);
    const inner = nested(c);
    const realInner = fs.realpathSync(inner);
    const plant = path.join(c.wt, 'inner2');
    afterKeep(realInner, rowSh('demo-inner2', plant));
    const r = childReclaimVerb(h, reclaimToken(), { pre: `${WAIT} ${KEEP_HOOK}` });
    stoppedAt(r, R(c), 'containment-refuted', 'children', 'registry row(s) demo-inner2 rooted inside');
    expect(fs.readFileSync(path.join(inner, 'f'), 'utf8'), 'the nested checkout stands').toBe('nested work\n');
    expect(h.git(c.main, 'branch', '--list', 'ws/nested'), 'its branch stands').toContain('ws/nested');
    expect(fs.existsSync(path.join(plant, 'live.txt')), 'the other session’s work stands').toBe(true);
    expect(keptFor(realInner), 'keep_of was asked of the checkout once').toHaveLength(1);
    failedPairAgrees(r);
  }, 120_000);

  it('W3: a row written inside the child once step 3 is done: containment-refuted before the tree’s keep_of', () => {
    const c = makeChild(h);
    const wd = workdirOf(CHILD_ID);
    const plant = path.join(c.wt, 'inner2');
    hook('at-worktree.sh', rowSh('demo-inner2', plant));
    const r = childReclaimVerb(h, reclaimToken(), { pre: `${WAIT} ${KEEP_HOOK} ${AT_WORKTREE}` });
    expect(fs.existsSync(path.join(h.home, 'at-worktree-ran')), 'the CONTROL: the row was planted inside the tail').toBe(true);
    stoppedAt(r, R(c), 'containment-refuted', 'worktree', 'registry row(s) demo-inner2 rooted inside');
    expect(fs.existsSync(path.join(plant, 'live.txt')), 'the other session’s work stands').toBe(true);
    expect(keptFor(wd), 'keep_of was never asked of the tree').toEqual([]);
    failedPairAgrees(r);
  }, 120_000);

  it('W4: a row written during the tree’s keep_of: the second re-ask refuses before the forced removal', () => {
    const c = makeChild(h);
    const wd = workdirOf(CHILD_ID);
    const plant = path.join(c.wt, 'inner2');
    afterKeep(wd, rowSh('demo-inner2', plant));
    const r = childReclaimVerb(h, reclaimToken(), { pre: `${WAIT} ${KEEP_HOOK}` });
    stoppedAt(r, R(c), 'containment-refuted', 'worktree', 'registry row(s) demo-inner2 rooted inside');
    expect(fs.existsSync(path.join(plant, 'live.txt')), 'the other session’s work stands').toBe(true);
    expect(keptFor(wd), 'keep_of was asked of the tree once').toHaveLength(1);
    failedPairAgrees(r);
  }, 120_000);

  it('I1: a nested checkout swapped for a copy after its proof: worktree-remove-failed, and both stand', () => {
    const c = makeChild(h);
    const realInner = fs.realpathSync(nested(c));
    hook('at-nproof.sh', swapSh(realInner));
    const r = childReclaimVerb(h, reclaimToken(), { pre: `${WAIT} ${KEEP_HOOK} ${AT_NPROOF}` });
    expect(fs.existsSync(path.join(h.home, 'at-nproof-ran')), 'the CONTROL: the checkout was swapped inside the tail').toBe(true);
    stoppedAt(r, R(c), 'worktree-remove-failed', 'children', `the checkout is not the one proven inside the tree: ${realInner} measures`);
    expect(fs.readFileSync(path.join(realInner, 'f'), 'utf8'), 'the copy stands').toBe('nested work\n');
    expect(fs.readFileSync(path.join(`${realInner}.orig`, 'f'), 'utf8'), 'the checkout the act proved stands').toBe('nested work\n');
    expect(keptFor(realInner), 'keep_of was never asked of the checkout').toEqual([]);
    failedPairAgrees(r);
  }, 120_000);

  it('I5: a nested checkout moved out of the child with a link left in its parent path after its proof: worktree-remove-failed, and the moved checkout stands', () => {
    const c = makeChild(h);
    const realInner = fs.realpathSync(nestedBelow(c, 'sub'));
    const sub = path.dirname(realInner);
    const moved = path.join(h.home, 'moved-sub');
    hook('at-nproof.sh', `mv "${sub}" "${moved}" && ln -s "${moved}" "${sub}";\n`);
    const r = childReclaimVerb(h, reclaimToken(), { pre: `${WAIT} ${KEEP_HOOK} ${AT_NPROOF}` });
    expect(fs.existsSync(path.join(h.home, 'at-nproof-ran')), 'the CONTROL: the checkout’s parent was moved and linked inside the tail').toBe(true);
    stoppedAt(r, R(c), 'worktree-remove-failed', 'children', `the checkout is no longer proven inside the tree: ${sub} is a symbolic link`);
    expect(fs.lstatSync(sub).isSymbolicLink(), 'the link stands where the parent was').toBe(true);
    expect(fs.readFileSync(path.join(moved, 'inner', 'f'), 'utf8'), 'the moved checkout stands, with its files').toBe('nested work\n');
    expect(h.git(c.main, 'branch', '--list', 'ws/nested'), 'its branch stands').toContain('ws/nested');
    expect(keptFor(realInner), 'keep_of was never asked of the checkout').toEqual([]);
    failedPairAgrees(r);
  }, 120_000);

  it('I6: a nested checkout that vanishes between the pre-removal re-ask’s identity compare and its second proof: worktree-remove-failed, and its branch stands', () => {
    const c = makeChild(h);
    const realInner = fs.realpathSync(nested(c));
    hook('at-phys.sh', `rm -rf "${realInner}";\n`);
    const r = childReclaimVerb(h, reclaimToken(), { pre: `${WAIT} ${KEEP_HOOK} ${AT_PHYS}` });
    expect(fs.existsSync(path.join(h.home, 'at-phys-ran')), 'the CONTROL: the checkout vanished inside the re-ask before its forced removal').toBe(true);
    expect(fs.readFileSync(path.join(h.home, 'at-phys-n'), 'utf8'), 'the CONTROL: it was the re-ask’s second ask').toBe('2');
    expect(fs.existsSync(realInner), 'the CONTROL: it is gone').toBe(false);
    stoppedAt(r, R(c), 'worktree-remove-failed', 'children', `the checkout at ${realInner} vanished after its identity was compared`);
    expect(h.git(c.main, 'branch', '--list', 'ws/nested'), 'its branch stands').toContain('ws/nested');
    expect(keptFor(realInner), 'keep_of was asked of the checkout once, before the vanish, and not again').toHaveLength(1);
    failedPairAgrees(r);
  }, 120_000);

  it('I2: the child’s tree swapped for a copy once step 3 is done: worktree-remove-failed, and both stand', () => {
    const c = makeChild(h);
    const wd = workdirOf(CHILD_ID);
    const real = fs.realpathSync(c.wt);
    hook('at-worktree.sh', swapSh(real));
    const r = childReclaimVerb(h, reclaimToken(), { pre: `${WAIT} ${KEEP_HOOK} ${AT_WORKTREE}` });
    stoppedAt(r, R(c), 'worktree-remove-failed', 'worktree', `the tree is not the one the act proved when it began: ${wd} measures`);
    expect(fs.existsSync(path.join(`${real}.orig`, 'f1.txt')), 'the tree the act proved stands').toBe(true);
    expect(keptFor(wd), 'keep_of was never asked of the tree').toEqual([]);
    failedPairAgrees(r);
  }, 120_000);

  it('I3: the linked worktrees root re-pointed at a copy: refused before the tree’s keep_of (owned’s record rung answers)', () => {
    linkedRoot();
    const c = makeChild(h);
    const wd = workdirOf(CHILD_ID);
    const tok = reclaimToken();
    const real = path.join(h.home, 'wtreal');
    const copy = path.join(h.home, 'wtreal2');
    hook('at-worktree.sh', `cp -a "${real}" "${copy}" && ln -sfn "${copy}" "${path.join(h.home, 'worktrees')}";\n`);
    const r = childReclaimVerb(h, tok, { pre: `${WAIT} ${KEEP_HOOK} ${AT_WORKTREE}` });
    stoppedAt(r, R(c), 'worktree-remove-failed', 'worktree', `${c.main} has no worktree record for the tree at `);
    expect(fs.existsSync(path.join(real, 'demo', 'quiet-basin', 'f1.txt')), 'the tree the act proved stands').toBe(true);
    expect(fs.existsSync(path.join(copy, 'demo', 'quiet-basin', 'f1.txt')), 'the copy stands').toBe(true);
    expect(keptFor(wd), 'keep_of was never asked of the tree').toEqual([]);
    failedPairAgrees(r);
  }, 120_000);

  it('I4: a tree that stands again after the owned call proved it gone is refused (reappeared-tree-refuses)', () => {
    const c = makeChild(h);
    const wd = workdirOf(CHILD_ID);
    interrupted(c, 'worktree');
    const tok = resumeToken('worktree');
    fs.renameSync(c.wt, `${c.wt}.aside`);
    hook('after-owned.sh', `mv "${c.wt}.aside" "${c.wt}";\n`);
    const r = childReclaimVerb(h, tok, { pre: `${WAIT} ${KEEP_HOOK} ${OWNED_HOOK}` });
    expect(fs.existsSync(path.join(h.home, 'after-owned-ran')), 'the CONTROL: the tree came back after the owned call').toBe(true);
    stoppedAt(r, R(c), 'worktree-remove-failed', 'worktree', `a tree stands again where the act proved none when it began, at ${wd}`);
    expect(linesIn('owned-calls'), 'the tail’s owned call, then the first re-ask’s').toEqual([wd, wd]);
    expect(keptFor(wd), 'keep_of was never asked of the tree').toEqual([]);
    failedPairAgrees(r);
  }, 120_000);

  it('MR1: a mount that appears during the tree’s keep_of is caught by the re-ask, and the mount ask is asked once', () => {
    const c = makeChild(h);
    const wd = workdirOf(CHILD_ID);
    const tok = reclaimToken();
    realMounts(h);
    afterKeep(wd, `printf '%s\\n' '${MOUNT_LINE(path.join(fs.realpathSync(c.wt), 'sub'))}' >> "$HOME/mountinfo";\n`);
    const r = childReclaimVerb(h, tok, { pre: `${WAIT} ${MOUNTS_SEAM} ${KEEP_HOOK} ${ASK_LOG}` });
    const o = stoppedAt(r, R(c), 'worktree-remove-failed', 'worktree',
      `could not ask whether another registry row names ${wd} or a path inside it: a mount stands at or under`);
    expect(String(o.detail).startsWith('could not ask whether another registry row names '), String(o.detail)).toBe(true);
    expect(asked(wd, 'resolve'), 'the mount ask ran once: the re-ask caught the mount before the second').toBe(1);
    expect(keptFor(wd), 'keep_of was asked of the tree once').toHaveLength(1);
    failedPairAgrees(r);
  }, 120_000);

  it('R32: a re-ask whose walk runs out of its bound answers unmeasured: worktree-remove-failed, the tree standing', () => {
    const c = makeChild(h);
    const wd = workdirOf(CHILD_ID);
    const tok = reclaimToken();
    realMounts(h);
    afterKeep(wd, 'mkfifo "$HOME/walk-fifo"; WS_RECLAIM_WALK_S=1;\n');
    const r = childReclaimVerb(h, tok, { pre: `${WAIT} ${WALK_FIFO_SEAM} ${KEEP_HOOK} ${ASK_LOG} ${WALK_ANSWERS}` });
    stoppedAt(r, R(c), 'worktree-remove-failed', 'worktree', `could not ask whether another registry row names ${wd}`);
    expect(linesIn('walk-answers').pop(), 'the re-ask’s walk ran out of its bound and answered unmeasured')
      .toBe('2|the identity walk did not finish within 1s');
    expect(asked(wd, 'resolve'), 'the mount ask was not reached a second time').toBe(1);
    expect(keptFor(wd), 'keep_of was asked of the tree once').toHaveLength(1);
    failedPairAgrees(r);
  }, 120_000);

  it('CUT: a proof that lists many rows is cut to one journal line, and the site’s own closing words follow the cut', () => {
    const c = makeChild(h);
    const wd = workdirOf(CHILD_ID);
    const ids = Array.from({ length: 40 }, (_, i) => `demo-inner-${String(i).padStart(2, '0')}`);
    hook('at-worktree.sh', ids.map((id) => rowSh(id, path.join(c.wt, id))).join(''));
    const r = childReclaimVerb(h, reclaimToken(), { pre: `${WAIT} ${KEEP_HOOK} ${AT_WORKTREE}` });
    const o = stoppedAt(r, R(c), 'containment-refuted', 'worktree', `${wd} has registry row(s) demo-inner-`);
    const d = String(o.detail);
    const tail = ` — the tree at ${wd} stands; the session was stopped, nothing further was deleted,`
      + ' and a retry finds the same until that tree or row is moved or removed';
    expect(d.endsWith(tail), d).toBe(true);
    const cut = d.slice(0, d.length - tail.length);
    expect(Buffer.byteLength(cut, 'utf8'), cut).toBeLessThanOrEqual(303);
    expect(cut.endsWith('…'), cut).toBe(true);
    failedPairAgrees(r);
  }, 120_000);

  it('E1: ws-expire, a row written inside the archived tree once step 3 is done: containment-refuted (W3’s mirror)', () => {
    const a = makeArchived(h);
    const wd = workdirOf(EXP_ID);
    const plant = path.join(a.wt, 'inner2');
    hook('at-worktree.sh', rowSh('demo-inner2', plant));
    const r = expireVerb(h, expiryToken(), { pre: `${WAIT} ${KEEP_HOOK} ${AT_WORKTREE}` });
    stoppedAt(r, X(a), 'containment-refuted', 'worktree', 'registry row(s) demo-inner2 rooted inside');
    expect(fs.existsSync(path.join(plant, 'live.txt')), 'the other session’s work stands').toBe(true);
    expect(keptFor(wd), 'keep_of was never asked of the tree').toEqual([]);
  }, 120_000);

  it('E2: ws-expire, a row written during the tree’s keep_of: the second re-ask refuses (W4’s mirror)', () => {
    const a = makeArchived(h);
    const wd = workdirOf(EXP_ID);
    afterKeep(wd, rowSh('demo-inner2', path.join(a.wt, 'inner2')));
    const r = expireVerb(h, expiryToken(), { pre: `${WAIT} ${KEEP_HOOK}` });
    stoppedAt(r, X(a), 'containment-refuted', 'worktree', 'registry row(s) demo-inner2 rooted inside');
    expect(keptFor(wd), 'keep_of was asked of the tree once').toHaveLength(1);
  }, 120_000);

  it('E3: ws-expire, the archived tree swapped for a copy: worktree-remove-failed, and both stand (I2’s mirror)', () => {
    const a = makeArchived(h);
    const wd = workdirOf(EXP_ID);
    const real = fs.realpathSync(a.wt);
    hook('at-worktree.sh', swapSh(real));
    const r = expireVerb(h, expiryToken(), { pre: `${WAIT} ${KEEP_HOOK} ${AT_WORKTREE}` });
    stoppedAt(r, X(a), 'worktree-remove-failed', 'worktree', `the tree is not the one the act proved when it began: ${wd} measures`);
    expect(fs.existsSync(path.join(`${real}.orig`, 'f1.txt')), 'the tree the act proved stands').toBe(true);
    expect(keptFor(wd), 'keep_of was never asked of the tree').toEqual([]);
  }, 120_000);

  it('E4: ws-expire, resumed, an archived tree that stands again after the owned call proved it gone is refused (I4’s mirror)', () => {
    const a = makeArchived(h);
    const wd = workdirOf(EXP_ID);
    const tok = expiryAtWorktree(a);
    fs.renameSync(a.wt, `${a.wt}.aside`);
    hook('after-owned.sh', `mv "${a.wt}.aside" "${a.wt}";\n`);
    const r = expireVerb(h, tok, { pre: `${WAIT} ${KEEP_HOOK} ${OWNED_HOOK}` });
    expect(fs.existsSync(path.join(h.home, 'after-owned-ran')), 'the CONTROL: the tree came back after the owned call').toBe(true);
    stoppedAt(r, X(a), 'worktree-remove-failed', 'worktree', `a tree stands again where the act proved none when it began, at ${wd}`);
    expect(keptFor(wd), 'keep_of was never asked of the tree').toEqual([]);
  }, 120_000);

  it('E5: ws-expire, a nested checkout moved out of the archived tree with a link left in its parent path after its proof: worktree-remove-failed, and the moved checkout stands (I5’s mirror)', () => {
    const a = makeArchived(h);
    const realInner = fs.realpathSync(nestedBelow(a, 'sub'));
    const sub = path.dirname(realInner);
    const moved = path.join(h.home, 'moved-sub');
    hook('at-nproof.sh', `mv "${sub}" "${moved}" && ln -s "${moved}" "${sub}";\n`);
    const r = expireVerb(h, expiryToken(), { pre: `${WAIT} ${KEEP_HOOK} ${AT_NPROOF}` });
    expect(fs.existsSync(path.join(h.home, 'at-nproof-ran')), 'the CONTROL: the checkout’s parent was moved and linked inside the tail').toBe(true);
    stoppedAt(r, X(a), 'worktree-remove-failed', 'children', `the checkout is no longer proven inside the tree: ${sub} is a symbolic link`);
    expect(fs.lstatSync(sub).isSymbolicLink(), 'the link stands where the parent was').toBe(true);
    expect(fs.readFileSync(path.join(moved, 'inner', 'f'), 'utf8'), 'the moved checkout stands, with its files').toBe('nested work\n');
    expect(h.git(a.main, 'branch', '--list', 'ws/nested'), 'its branch stands').toContain('ws/nested');
    expect(keptFor(realInner), 'keep_of was never asked of the checkout').toEqual([]);
  }, 120_000);
});

describe.skipIf(!LINUX)('CONTROLs: with nothing changed, every standing site is re-asked and the act completes', () => {
  it('CONTROL N: a nested checkout and the tree, re-asked at all four sites; owned asked at the start and once per re-ask', () => {
    const c = makeChild(h);
    const realInner = fs.realpathSync(nested(c));
    const wd = workdirOf(CHILD_ID);
    const r = childReclaimVerb(h, reclaimToken(), { pre: `${WAIT} ${KEEP_HOOK} ${OWNED_HOOK} ${REASK_LOG} ${PROC_SPY}` });
    done(r, R(c));
    expect(h.git(c.main, 'branch', '--list', 'ws/nested'), 'the nested branch went').toBe('');
    expect(linesIn('reask-calls'), 'each standing site re-asked, twice per tree, each answering 0').toEqual([
      `${wd}|${realInner}|0`, `${wd}|${realInner}|0`, `${wd}||0`, `${wd}||0`]);
    expect(linesIn('owned-calls'), 'owned: the tail’s own call and one per re-ask').toHaveLength(5);
    expect(linesIn('proc-walks').length, 'the tail walks the real /proc: this file is a CLAUDE.md load flake').toBeGreaterThan(0);
  }, 120_000);

  it('CONTROL C: no nested checkout; the tree re-asked twice, owned asked three times', () => {
    const c = makeChild(h);
    const wd = workdirOf(CHILD_ID);
    const r = childReclaimVerb(h, reclaimToken(), { pre: `${WAIT} ${OWNED_HOOK} ${REASK_LOG}` });
    done(r, R(c));
    expect(linesIn('reask-calls')).toEqual([`${wd}||0`, `${wd}||0`]);
    expect(linesIn('owned-calls')).toHaveLength(3);
  }, 120_000);

  it('CONTROL E: ws-expire expires, its tree re-asked twice', () => {
    const a = makeArchived(h);
    const wd = workdirOf(EXP_ID);
    const r = expireVerb(h, expiryToken(), { pre: `${WAIT} ${REASK_LOG}` });
    done(r, X(a));
    expect(linesIn('reask-calls')).toEqual([`${wd}||0`, `${wd}||0`]);
  }, 120_000);

  it('CONTROL OUT: a row written OUTSIDE the child once step 3 is done refuses nothing, and stands', () => {
    const c = makeChild(h);
    const wd = workdirOf(CHILD_ID);
    const elsewhere = path.join(h.home, 'elsewhere');
    hook('at-worktree.sh', rowSh('demo-outside', elsewhere));
    const r = childReclaimVerb(h, reclaimToken(), { pre: `${WAIT} ${AT_WORKTREE} ${REASK_LOG}` });
    expect(fs.existsSync(path.join(h.home, 'at-worktree-ran')), 'the CONTROL: the row was planted inside the tail').toBe(true);
    done(r, R(c));
    expect(linesIn('reask-calls')).toEqual([`${wd}||0`, `${wd}||0`]);
    expect(h.reg('demo-outside', 'workdir'), 'the other row stands').toBe(elsewhere);
    expect(fs.existsSync(path.join(elsewhere, 'live.txt')), 'its work stands').toBe(true);
  }, 120_000);
});

describe('on Darwin the re-ask runs at all four sites and reads no mount table (forced, with the identity shims)', () => {
  it('DARWIN: a nested checkout and the tree, re-asked four times, both trees and both branches go, no table read', () => {
    const c = makeChild(h);
    const inner = nested(c);
    const realInner = fs.realpathSync(inner);
    const wd = workdirOf(CHILD_ID);
    const r = childReclaimVerb(h, reclaimToken(),
      { pre: `CCD_OS=darwin; ${WAIT} ${DARWIN_IDENT_SHIMS} ${DARWIN_LSOF_STUB} ${POISON} ${REASK_LOG}` });
    done(r, R(c));
    expect(fs.existsSync(inner), 'the nested checkout went').toBe(false);
    expect(h.git(c.main, 'branch', '--list', 'ws/nested'), 'the nested branch went').toBe('');
    expect(linesIn('reask-calls')).toEqual([`${wd}|${realInner}|0`, `${wd}|${realInner}|0`, `${wd}||0`, `${wd}||0`]);
    expect(fs.existsSync(path.join(h.home, 'mi-called')), 'no mount table was read').toBe(false);
    expect(h.sh(`${POISON} _ws_collect_mounts_clear "$HOME"; printf '[rc=%s]' "$?"`), 'the CONTROL: the poison answers').toBe('[rc=2]');
    expect(fs.existsSync(path.join(h.home, 'mi-called')), 'the CONTROL: the poison records a read').toBe(true);
  }, 120_000);
});

describe('`_ws_reclaim_reask` itself, and the identity `_ws_reclaim_nested_proven` records (path-identity spec §4.7)', () => {
  interface Subj { c: Child; wd: string; wdid: string; mainid: string }
  const identOf = (p: string, follow = ''): string => h.sh(`_ws_path_ident "${p}" ${follow} && printf '%s' "$_WS_IDENT"`);
  /** The child, and its tree's and its project directory's identities as the tail records them. */
  const subject = (): Subj => {
    const c = makeChild(h);
    const wd = workdirOf(CHILD_ID);
    const wdid = identOf(wd);
    const mainid = identOf(c.main, 'follow');
    expect(wdid, 'the CONTROL: the tree measures').toMatch(IDENT);
    expect(mainid, 'the CONTROL: the project directory measures').toMatch(IDENT);
    return { c, wd, wdid, mainid };
  };
  /** One re-ask: its answer and its reason. */
  const reask = (s: Subj, wdid: string, mainid: string, o: { cpath?: string; cid?: string; pre?: string } = {}): string =>
    h.sh(`${o.pre ?? ''} _ws_reclaim_reask ${CHILD_ID} "${s.wd}" "${s.c.main}" "${wdid}" "${mainid}"`
      + `${o.cpath === undefined ? '' : ` "${o.cpath}" "${o.cid ?? ''}"`}; rc=$?;`
      + ` printf '[rc=%s] %s' "$rc" "\${_WS_REASK_WHY-<unset>}"`);
  /** `_ws_path_ident`, wrapped: logs every path the re-ask itself measures to `$HOME/reask-idents`. */
  const IDENT_SPY = 'eval "_t_pid_real()$(declare -f _ws_path_ident | tail -n +2)";'
    + ' _ws_path_ident() { [[ "${FUNCNAME[1]-}" != _ws_reclaim_reask ]] || printf \'%s\\n\' "$1" >> "$HOME/reask-idents"; _t_pid_real "$@"; };';
  /** One nested proof: its answer and the three globals it sets. */
  const proven = (c: Child, p: string, pre = ''): string =>
    h.sh(`${pre} r=$(cd "${c.wt}" && pwd -P); _ws_reclaim_nested_proven "$r" "${p}"; rc=$?;`
      + ` printf '[rc=%s] gone=%s ident=%s why=%s' "$rc" "$_WS_NPROOF_GONE" "\${_WS_NPROOF_IDENT-<unset>}" "$_WS_NPROOF_WHY"`);

  it('U0: the CONTROL: everything recorded still measures the same: 0', () => {
    const s = subject();
    expect(reask(s, s.wdid, s.mainid)).toBe('[rc=0]');
  }, 60_000);

  it('U1: a project directory that is no longer the one recorded: 2', () => {
    const s = subject();
    expect(reask(s, s.wdid, '1:1:-')).toBe(
      `[rc=2] the project directory is not the one the act proved when it began: ${s.c.main} measures ${s.mainid}, recorded 1:1:-`);
  }, 60_000);

  it('U2: no project-directory identity recorded: 2, never a match', () => {
    const s = subject();
    expect(reask(s, s.wdid, '')).toBe(
      `[rc=2] no identity of the project directory was recorded when the act began, so whether ${s.c.main} is still that directory was never asked`);
  }, 60_000);

  it('U3: a tree that is no longer the one recorded: 2', () => {
    const s = subject();
    expect(reask(s, '1:1:-', s.mainid)).toBe(
      `[rc=2] the tree is not the one the act proved when it began: ${s.wd} measures ${s.wdid}, recorded 1:1:-`);
  }, 60_000);

  it('U4: an EMPTY tree identity with the tree standing (the owned call proved it gone): 2, never a match', () => {
    const s = subject();
    expect(reask(s, '', s.mainid)).toBe(
      `[rc=2] a tree stands again where the act proved none when it began, at ${s.wd}, so it is not the tree the act proved`);
  }, 60_000);

  it('U5: the checkout: its recorded identity is 0, another is 2, an empty one is 2', () => {
    const s = subject();
    const realInner = fs.realpathSync(nested(s.c));
    const cid = identOf(realInner);
    expect(cid, 'the CONTROL: the checkout measures').toMatch(IDENT);
    expect(reask(s, s.wdid, s.mainid, { cpath: realInner, cid }), 'the CONTROL: the checkout proven').toBe('[rc=0]');
    expect(reask(s, s.wdid, s.mainid, { cpath: realInner, cid: '1:1:-' })).toBe(
      `[rc=2] the checkout is not the one proven inside the tree: ${realInner} measures ${cid}, recorded 1:1:-`);
    expect(reask(s, s.wdid, s.mainid, { cpath: realInner, cid: '' })).toBe(
      `[rc=2] no identity of the checkout was recorded when it was proven, so whether ${realInner} is still that checkout was never asked`);
  }, 60_000);

  it('U6: owned is asked first: its proof is 1 even when every measure would fail, and nothing was measured before it', () => {
    const s = subject();
    fs.writeFileSync(reg('demo-twin.uuid'), 'u-demo-twin');
    fs.writeFileSync(reg('demo-twin.workdir'), s.wd);
    expect(reask(s, s.wdid, s.mainid, { pre: `${IDENT_SPY} _plat_devino() { return 1; };` }))
      .toBe(`[rc=1] ${s.wd} is also named by registry row(s) demo-twin`);
    expect(linesIn('reask-idents'), 'no identity was measured before the proof').toEqual([]);
  }, 60_000);

  it('U7: a measure that fails is 2, never a pass', () => {
    const s = subject();
    const pre = 'eval "_t_pid_real()$(declare -f _ws_path_ident | tail -n +2)";'
      + ` _ws_path_ident() { if [[ "\${FUNCNAME[1]-}" == _ws_reclaim_reask && "$1" == "${s.wd}" ]]; then`
      + ` _WS_IDENT=''; _WS_IDENT_KIND=''; _WS_IDENT_WHY='stub: no stat'; return 2; fi; _t_pid_real "$@"; };`;
    expect(reask(s, s.wdid, s.mainid, { pre })).toBe(
      `[rc=2] the tree could not be measured again (stub: no stat), so whether ${s.wd} is still the one the act proved was never asked`);
  }, 60_000);

  it('NP1: a standing checkout’s proof records its identity', () => {
    const c = makeChild(h);
    const realInner = fs.realpathSync(nested(c));
    const cid = identOf(realInner);
    expect(cid, 'the CONTROL: the checkout measures').toMatch(IDENT);
    expect(proven(c, realInner)).toBe(`[rc=0] gone=0 ident=${cid} why=`);
  }, 60_000);

  it('NP2: a checkout PROVEN gone records no identity', () => {
    const c = makeChild(h);
    const realInner = fs.realpathSync(nested(c));
    fs.rmSync(realInner, { recursive: true, force: true });
    expect(proven(c, realInner)).toBe('[rc=0] gone=1 ident= why=');
  }, 60_000);

  it('NP3: a checkout whose identity cannot be measured is 1, never proven', () => {
    const c = makeChild(h);
    const realInner = fs.realpathSync(nested(c));
    const out = proven(c, realInner, '_plat_btime() { echo x; };');
    expect(out.startsWith(`[rc=1] gone=0 ident= why=the checkout at ${realInner} could not be measured by device and inode (`), out).toBe(true);
  }, 60_000);

  it('NP4: an identity left by an earlier proof is cleared at entry', () => {
    const c = makeChild(h);
    const realInner = fs.realpathSync(nested(c));
    const lnk = path.join(fs.realpathSync(c.wt), 'lnk');
    fs.symlinkSync(realInner, lnk);
    const first = `r=$(cd "${c.wt}" && pwd -P); _ws_reclaim_nested_proven "$r" "${realInner}" || exit 9;`;
    expect(proven(c, lnk, first)).toBe(
      `[rc=1] gone=0 ident= why=${lnk} is a symbolic link — ccd never follows a link to a tree it would remove`);
  }, 60_000);
});

describe('the re-asks, read from the source (path-identity spec §4.7)', () => {
  const src = (): string => fs.readFileSync(CCD, 'utf8');
  /** Code lines: whole-line comments dropped, `\`-continuations joined (the six-calls census's reading), blanks dropped. */
  const codeOf = (body: string): string[] => body.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
    .replace(/\s*\\\n\s*/g, ' ').split('\n').filter((l) => l.trim() !== '');
  const fn = (name: string): string => {
    const s = src();
    const at = s.indexOf(`\n${name}() {`);
    expect(at, `the CONTROL: ${name} is defined`).toBeGreaterThan(-1);
    return s.slice(at, s.indexOf('\n}\n', at) + 2);
  };
  const tailCode = (): string[] => {
    const s = src();
    const tail = s.slice(s.indexOf('\n_ws_reclaim_tail() {'), s.indexOf('\ncmd_ws_reclaim() {'));
    expect(tail.length, 'the CONTROL: the tail was found').toBeGreaterThan(1000);
    return codeOf(tail);
  };
  const SITES = /_ws_reclaim_reask |_ws_cwd_users "\$workdir"; cwrc=|_ws_removal_mounts_clear|_ws_reclaim_keep_of "\$main" "\$id" tree "\$(cpath|workdir)"(?! 1)|worktree remove --force/;
  const label = (l: string): string => {
    if (/_ws_reclaim_reask /.test(l)) return /"\$cpath" "\$cid"/.test(l) ? 'reask cpath' : 'reask workdir';
    if (/_ws_cwd_users "\$workdir"; cwrc=/.test(l)) return 'cwd';
    let m = /_ws_removal_mounts_clear "\$(\w+)"( resolve)?/.exec(l);
    if (m) return `mounts ${m[1]}${m[2] ?? ''}`;
    m = /_ws_reclaim_keep_of "\$main" "\$id" tree "\$(\w+)"/.exec(l);
    if (m) return `keep ${m[1]}`;
    m = /worktree remove --force "\$(\w+)"/.exec(l);
    if (m) return `remove ${m[1]}`;
    return `unlabelled: ${l.trim()}`;
  };

  it('SRC1: in order at each standing site: cwd, re-ask, mounts, keep_of; then cwd, re-ask, mounts, the forced removal', () => {
    expect(tailCode().filter((l) => SITES.test(l)).map(label)).toEqual([
      'cwd', 'reask cpath', 'mounts cpath', 'keep cpath', 'cwd', 'reask cpath', 'mounts cpath', 'remove cpath',
      'cwd', 'reask workdir', 'mounts workdir resolve', 'keep workdir',
      'cwd', 'reask workdir', 'mounts workdir resolve', 'remove workdir',
    ]);
  });

  it('SRC2: each re-ask follows the cwd ask and its map, and is its call and its two cut maps, then the mount ask of its own path', () => {
    const code = tailCode();
    const at = code.flatMap((l, i) => (/_ws_reclaim_reask /.test(l) ? [i] : []));
    expect(at.length, 'four re-asks in the tail').toBe(4);
    for (const i of at) {
      const call = code[i]!.trim();
      expect(call).toMatch(/^_ws_reclaim_reask "\$id" "\$workdir" "\$main" "\$wdid" "\$mainid"( "\$cpath" "\$cid")?; rarc=\$\?$/);
      const cp = call.includes('"$cpath" "$cid"');
      const what = cp ? 'the checkout at $cpath' : 'the tree at $workdir';
      expect(code[i + 1]!.trim(), 'the proof map').toBe('(( rarc != 1 )) || { _ws_reclaim_fail "$id" "$lctx" containment-refuted'
        + ` "$(_ws_leaf_why_line "$_WS_REASK_WHY") — ${what} stands; the session was stopped, nothing further was deleted,`
        + ' and a retry finds the same until that tree or row is moved or removed"; return 1; }');
      expect(code[i + 2]!.trim(), 'the unasked map').toBe('(( rarc == 0 )) || { _ws_reclaim_fail "$id" "$lctx" worktree-remove-failed'
        + ` "$(_ws_leaf_why_line "$_WS_REASK_WHY") — ${what} stands, and nothing further was deleted"; return 1; }`);
      expect(code[i - 2]!.trim(), 'after the working-directory probe').toBe('_ws_cwd_users "$workdir"; cwrc=$?');
      expect(code[i - 1]!.trim(), 'and its map').toMatch(/^\(\( cwrc == 0 \)\) \|\| \{/);
      expect(code[i + 3]!.trim(), 'then the mount question, of the same path')
        .toMatch(cp ? /^_ws_removal_mounts_clear "\$cpath" \|\|/ : /^_ws_removal_mounts_clear "\$workdir" resolve \|\|/);
    }
  });

  it('SRC3: no re-ask line spells git, and no vanished arm holds a re-ask', () => {
    const code = tailCode();
    expect(code.filter((l) => /_ws_reclaim_reask /.test(l)).length, 'the CONTROL: four re-asks to look at').toBe(4);
    expect(code.filter((l) => /_ws_reclaim_reask |_WS_REASK_WHY/.test(l) && /\bgit\b/.test(l)), 'a re-ask line that spells git').toEqual([]);
    const vanished = code.flatMap((l, i) => (/_ws_reclaim_keep_of "\$main" "\$id" tree "\$(cpath|workdir)" 1 /.test(l) ? [i] : []));
    expect(vanished.length, 'the CONTROL: the two vanished arms').toBe(2);
    for (const i of vanished) {
      expect(code.slice(Math.max(0, i - 6), i).filter((l) => /_ws_reclaim_reask /.test(l)),
        `before ${code[i]!.trim().slice(0, 70)}`).toEqual([]);
    }
  });

  it('SRC4: `_ws_reclaim_reask` is defined between `_ws_reclaim_nested_record` and `_ws_reclaim_kept_read`, before the tail', () => {
    const s = src();
    const at = ['_ws_reclaim_nested_record', '_ws_reclaim_reask', '_ws_reclaim_kept_read', '_ws_reclaim_tail']
      .map((n) => s.indexOf(`\n${n}() {`));
    expect(at.every((x) => x > -1), at.join(',')).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('SRC5: `_ws_reclaim_reask` asks `_ws_reclaim_owned` once, before any measure, and asks neither the cwd probe nor git', () => {
    const code = codeOf(fn('_ws_reclaim_reask'));
    const owned = code.flatMap((l, i) => (/_ws_reclaim_owned /.test(l) ? [i] : []));
    expect(owned.length, 'one owned call').toBe(1);
    const firstIdent = code.findIndex((l) => /_ws_path_ident /.test(l));
    expect(firstIdent, 'the CONTROL: it measures').toBeGreaterThan(-1);
    expect(owned[0]!, 'owned is asked before the first measure').toBeLessThan(firstIdent);
    expect(code.filter((l) => /_ws_cwd_users|\bgit\b/.test(l)), 'a cwd ask or a git call inside the re-ask').toEqual([]);
  });

  it('SRC6: the tail records the identities once: the tree’s and the project directory’s at the owned call, the checkout’s at its proof', () => {
    const code = tailCode().map((l) => l.trim());
    const o = code.indexOf('_ws_reclaim_owned "$id" "$workdir" "$main"; orc=$?');
    expect(o, 'the owned call').toBeGreaterThan(-1);
    expect(code.slice(o + 1, o + 3)).toEqual(['case "$orc" in', '0) wdid="$_WS_OWNED_WDID"; mainid="$_WS_OWNED_MAINID" ;;']);
    const p = code.indexOf('if ! _ws_reclaim_nested_proven "$wdreal" "$cpath"; then');
    expect(p, 'the nested proof').toBeGreaterThan(-1);
    expect(code[code.indexOf('fi', p) + 1], 'the checkout’s identity, directly after its proof').toBe('cid="$_WS_NPROOF_IDENT"');
    expect(code.filter((l) => /(^|[\s;])(wdid|mainid|cid)=/.test(l)), 'assigned nowhere else').toEqual([
      "local wdid='' mainid='' cid='' rarc", '0) wdid="$_WS_OWNED_WDID"; mainid="$_WS_OWNED_MAINID" ;;', 'cid="$_WS_NPROOF_IDENT"']);
  });
});
