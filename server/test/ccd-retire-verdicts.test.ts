// THE RETIRE-VERDICT TABLE (D-7082; ARCH-45, Task C5d; plan 2026-10-27-consolidation-w5-ccd-helpers.md; spec 2026-10-19
// §7: "a shared ccd helper breaks a destructive verb" -> "the retire-verdict table is run against each"). Every input row
// is run through each of ccd's five retire evals, so the table holds each eval's verdict for its own verb's inputs and
// its answer to the other verbs' inputs too. C5e, C5f and C5g re-run it, its literals unedited, in their Step 1 and 6.
//
// COLUMNS AND ARGV (rev 8). A WORKSPACE row is a registered id; a LOOSE row is an entry under `$HOME/.cc-tmp`.
//   `_ws_reap_eval <id>`, `_ws_reclaim_eval <id> 0 ''`, `_ws_expire_eval <id>`, `_ws_collect_eval <id>` and
//   `_ws_loose_eval <name> <hex>` (ccd/lib/disk-retention.sh). A workspace row's loose cell passes its id as `name`
//   (with its hex); a loose row's four id cells pass the entry's basename as `id`. Those cross cells are each eval's
//   answer to an input its verb never hands it, pinned like any other. The residue row (a witnessed temp root at
//   `~/.cc-tmp/<id>`, no registry row) is an id row whose loose cell is NOT absent: its entry stands, by construction.
//   LEFT OUT BY NAME (a cell whose eval does not answer with a verdict): none, measured on the base.
//
// THE DRIVERS. "Called as its verb calls it": each column's driver runs, in one subshell, what its verb runs between its
// entry and the eval call, and nothing else (argument parsing and the verb's own answers before the eval, which these
// fixtures never reach, are not reproduced). The lists, read off the base:
//   reap (`cmd_ws_reap` -> `_ws_reap_locked`): `local token id`; `_ws_reap_reset`; the reap lock opened and taken
//     (`exec {lfd}>>"$REG/.reap-$id.lock"`, `flock -n`); `_reg_get "$id" reaping` (no breadcrumb in any row, so the
//     fresh arm); then `_ws_reap_eval "$id"`. Not reproduced: the usage and token dies, `_json_str probe`, the `.hold`
//     answer, the lock decline, `_ws_reap_crumb_unread`'s answer.
//   reclaim (`cmd_ws_reclaim` -> `_ws_reclaim_locked` -> `_ws_reclaim_fork` -> `_ws_reclaim_fork_contained`): the verb's
//     locals (`lc_surface=none lc_actor='' lc_reason='' defer=0 _WS_STALE_WORD='' _WS_STALE_DIGEST=''`), ccd's top-level
//     `_WS_RCL_ACT=reclaim` default left in force; `token childof id`; the reap lock; `_ws_reclaim_locked`'s locals
//     (`phase resumed declared lctx project workdir main clips pinned=0 start=children lbstate`); under
//     `_ws_reclaim_contained`: `RECLAIM_RESUME_PHASE=''`, `rbc=$(_reg_get "$id" reaping)`; then
//     `_ws_reclaim_eval "$id" 0 ''`. The verb passes its `--child-of` run id as `childof`; the plan's argv passes `''`
//     (no parent compared), which is what `ws-audit --reclaim` passes (slug reclaim-argv-childof, named in the report).
//   expire (`cmd_ws_expire` -> `_ws_expire_locked` -> `_ws_expire_fork_contained`): the verb's locals
//     (`lc_surface=none lc_actor='' lc_reason='' EXPIRE_CHILDOF=''`), `local _WS_RCL_ACT=expire`; the reap lock;
//     `_ws_expire_locked`'s locals; under `_ws_reclaim_contained`: `RECLAIM_RESUME_PHASE=''`, `EXPIRE_STAMP_AT=''`,
//     `EXPIRE_IN_USE=()`, `rbc=$(_reg_get "$id" reaping)`; then `_ws_expire_eval "$id"`.
//   collect (`cmd_ws_collect` -> `_ws_collect_locked` -> `_ws_collect_fork`): the verb's locals (`lc_surface=none
//     lc_actor='' lc_reason=''`), `local _WS_RCL_ACT=collect _WS_RCL_CRUMB=''`, `local wf rrc=0 wrc=0 arc=0 why`;
//     `wf=$(_ws_tmproot_witness_file "$id")`, `_ws_reclaim_absent "$wf"`, `_ws_collect_records_of "$id"`,
//     `_ws_collect_asides_of "$id"` (when no witness and no record), `_ws_collect_prelock "$id"`; the reap lock; under
//     `_ws_reclaim_contained`: `_ws_collect_locked`'s locals, `_ws_collect_gap locked "$id"`, `_ws_collect_paused`,
//     `_ws_tmproot_aside_settle "$id"`; `_ws_collect_fork`'s `_ws_collect_reset`, `_ws_collect_records_of "$id"` and
//     `_WS_COLLECT_RECORDS`; then `_ws_collect_eval "$id"`. Not reproduced: the tmproots-link, not-witnessed, records-
//     and prelock answers, the lock decline, the paused answer.
//   loose (`cmd_ws_collect --loose-hex` -> `_ws_loose_collect` -> `_ws_loose_locked` -> `_ws_loose_fork`): `local token hex
//     surface actor reason lfd rc=0 jid`, `local _WS_RCL_ACT=collect _WS_RCL_CRUMB=''`; `_ws_loose_unhex "$hex"`,
//     `_ws_loose_sha16 "$hex"`, `jid`; the loose lock (`$REG/.collect-loose.lock`); under `_ws_reclaim_contained`:
//     `_ws_loose_locked`'s locals and `name=$_WS_LOOSE_NAME`, `_ws_collect_gap locked`, `_ws_collect_paused`;
//     `_ws_loose_fork`'s `_ws_collect_reset`, `_WS_LOOSE_RECORD='' _WS_LOOSE_PHASE='' _WS_LOOSE_CLASS=''` and
//     `_ws_loose_records_of "$_WS_LOOSE_SHA"`; then `_ws_loose_eval "$name" "$hex"`.
// No driver reaches a reader of `_WS_RCL_ACT` (plan rev 10): its readers (`_ws_wip_commit`, `_ws_reclaim_keep_reflogs`,
// `_ws_reclaim_tomb_fields`, `_ws_reclaim_tail`, `_ws_reclaim_fail`) all lie past the evals and the forks.
//
// A CELL is the eval's rc, `REAP_VERDICT`, `REAP_DETAIL` normalised (`normalise`: the cell's HOME -> `~`, every inode,
// device and birth-time number -> `<ino>`, `<dev>`, `<btime>`) and `REAP_TOKEN`. Each cell gets its own fresh instance of
// its row's fixture. Commit dates are fixed (`GIT_AUTHOR_DATE`, `GIT_COMMITTER_DATE`, set below, on top of
// `makeCcdHarness`'s `gitEnv`, which inherits them) and every workspace row's `$REG/<id>.generation` is one fixed UUID,
// so every OID and generation a token binds is the same on every run (a loose row and the residue row have no registry
// row, and writing `.generation` would make one, so they get none). The reap rows' archive instant is fixed too
// (`ws-archive` stamps the wall clock, which the expiry column reads), and each instance carries its two lock files,
// empty, as an earlier audit leaves them (a lock file is never unlinked), so opening one writes nothing.
// WHAT AN EVAL WRITES (Step 0, measured by running every column twice over one instance): with the lock files planted,
// only `_ws_reap_eval`'s mandatory `git fetch` writes, git's own fetch records (`.git/FETCH_HEAD`, `.git/logs/…`), and
// every cell answered the same both times. So no cell's answer depends on a previous eval's leftovers: the plan's reuse
// mutant could red nothing, and its listing-check mutant stands in its place; the listing leaves git's fetch records out.
// TOKENS, TWO WAYS. (1) Differentially, every cell that mints one: the merge-base's `ccd/ccd` and `ccd/lib/` are
// extracted to a tmp tree and run over the SAME instance as the tip's, base first; the instance's normalised listing
// (paths, sizes, modes; the harness's own call recorders left out) must be unchanged between the two runs, so a base
// eval that wrote into it fails its cell by name. With no `origin/main` or no merge-base the differential half fails on
// CI and skips with a warning locally (as `citations.test.ts` does); the literal cells run either way. (2) Literally,
// the reap, reclaim and expire token cells that were equal across two fresh runs at Step 0 (the rest are held
// differentially only, and the PR body names them).
//
// FIXTURE HOMEs ONLY (`makePrHarness`): every eval and verb runs as a sourced function in a tmp HOME, never on a box.
// Linux only: the collector and the loose arm measure nothing on macOS, as their own suites (`ccd-ws-collect-verb`,
// `ccd-ws-collect-loose`) skip there.
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CCD, CCD_LIB, WS_ADD, ghContainedEnv } from './ccdWsHelpers.js';
import { GH_STUB, makePrHarness, mergedRow, type PrHarness } from './ccdPrHelpers.js';
import { CHILD_ENV, CHILD_STUBS, makeChild } from './childReclaimFixture.js';
import { EXP_STUBS, NOW, makeArchived } from './wsExpireFixture.js';
import { IDLE_FLOOR_SEAM, makeOrphan, COL_ID } from './wsCollectFixture.js';
import { mergeBaseText } from './mergeBase.js';
import { ccdLauncherIn } from './consolidationCensus.js';
import { mkTmp } from './tmpHelpers.js';

const LINUX = process.platform === 'linux';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ONE FIXED DATE for every commit a fixture makes (git reads both from the environment `gitEnv` inherits).
process.env['GIT_AUTHOR_DATE'] = '2026-07-20T10:00:00Z';
process.env['GIT_COMMITTER_DATE'] = '2026-07-20T10:00:00Z';
/** The one generation every workspace row carries (`_reg_generation_valid`'s grammar). */
const GENERATION = '0f0e0d0c-0b0a-4908-8706-050403020100';

// ── the rows ─────────────────────────────────────────────────────────────────────────────────────────────────────────
type Row = { kind: 'ws'; id: string; unregistered?: true } | { kind: 'loose'; name: string };
interface RowDef { readonly name: string; readonly from: string; readonly build: (h: PrHarness) => Row }

/** `ccd-ws-reap.test.ts`'s stubs: the archive's and the tail's unit and pane calls, recorded, never made. */
const ARCH = `_ws_unsupervise() { echo "unsupervise $1" >> "$HOME/ccd-calls"; };
  _ws_supervise() { :; }; _spawn() { :; }; _spawn_start() { SPAWN_FROMSWAP=0; }; _spawn_settle() { :; };
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; return 1; }; _session_verdict() { echo gone; };`;
const REAP_ID = 'demo-quiet-basin';

/** `ccd-ws-reap.test.ts`'s `ready()`: a squash-merged workspace on a moved base, its PR merged, archived. */
function ready(h: PrHarness, o: { ignore?: string[]; archive?: boolean } = {}): { main: string; wt: string; tip: string } {
  const ignore = o.ignore ?? [];
  const works = ['1', '2', '3'];
  const main = h.makeGhRepo('demo');
  h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
  const wt = path.join(h.home, 'worktrees', 'demo', 'quiet-basin');
  for (const n of works) {
    fs.writeFileSync(path.join(wt, `f${n}.txt`), `work ${n}\n`);
    h.git(wt, 'add', `f${n}.txt`); h.git(wt, 'commit', '-m', `work ${n}`);
  }
  if (ignore.length) {
    fs.writeFileSync(path.join(wt, '.gitignore'), `${ignore.join('\n')}\n`);
    h.git(wt, 'add', '.gitignore'); h.git(wt, 'commit', '-m', 'ignore');
  }
  const tip = h.git(wt, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(main, 'other.txt'), 'someone else\n');
  h.git(main, 'add', 'other.txt'); h.git(main, 'commit', '-m', 'unrelated');
  for (const n of works) fs.writeFileSync(path.join(main, `f${n}.txt`), `work ${n}\n`);
  if (ignore.length) fs.writeFileSync(path.join(main, '.gitignore'), `${ignore.join('\n')}\n`);
  h.git(main, 'add', '-A'); h.git(main, 'commit', '-m', 'squash (#42)');
  const merge = h.git(main, 'rev-parse', 'HEAD');
  h.git(main, 'push', 'origin', 'main');
  h.git(wt, 'push', '-u', 'origin', 'ws/quiet-basin');
  h.ghRows([mergedRow({ headRefOid: tip, mergeCommit: { oid: merge } })]);
  if (o.archive !== false) {
    h.sh(`${ARCH} cmd_ws_archive --session ${REAP_ID}`);
    // The archive's instant, fixed: `ws-archive` stamps the wall clock, which the expiry column would read.
    fs.writeFileSync(path.join(h.home, '.cc-sessions', `${REAP_ID}.archived`), `${NOW - 86_400}\n`);
  }
  return { main, wt, tip };
}

/** `ccd-ws-collect-loose.test.ts`'s `mkLoose`: a loose directory with scratch two levels down, or a loose file. */
function mkLoose(h: PrHarness, name: string, kind: 'dir' | 'file'): Row {
  const tmp = path.join(h.home, '.cc-tmp');
  fs.mkdirSync(path.join(h.home, '.cc-sessions', 'tmproots'), { recursive: true });
  fs.mkdirSync(tmp, { recursive: true });
  const p = path.join(tmp, name);
  if (kind === 'file') fs.writeFileSync(p, 'scratch\n');
  else {
    fs.mkdirSync(path.join(p, 'out', 'deep'), { recursive: true });
    fs.writeFileSync(path.join(p, 'out', 'a.txt'), 'a\n');
    fs.writeFileSync(path.join(p, 'b.txt'), 'b\n');
  }
  return { kind: 'loose', name };
}

const ROWS: readonly RowDef[] = [
  { name: 'reap: merged, clean', from: 'ccd-ws-reap.test.ts ready()', build: (h) => { ready(h); return { kind: 'ws', id: REAP_ID }; } },
  { name: 'reap: a dirty tree', from: 'ccd-ws-reap.test.ts ready() + an untracked file',
    build: (h) => { const r = ready(h); fs.writeFileSync(path.join(r.wt, 'late.txt'), 'late\n'); return { kind: 'ws', id: REAP_ID }; } },
  { name: 'reap: an unpushed tip', from: 'ccd-ws-reap.test.ts ready() + a commit never pushed',
    build: (h) => {
      const r = ready(h);
      fs.writeFileSync(path.join(r.wt, 'late.txt'), 'late\n'); h.git(r.wt, 'add', 'late.txt'); h.git(r.wt, 'commit', '-m', 'late');
      return { kind: 'ws', id: REAP_ID };
    } },
  { name: 'reap: a stash', from: 'ccd-ws-reap.test.ts ready() + git stash',
    build: (h) => {
      const r = ready(h);
      fs.writeFileSync(path.join(r.wt, 'f1.txt'), 'changed\n'); h.git(r.wt, 'stash');
      return { kind: 'ws', id: REAP_ID };
    } },
  { name: 'reap: an ignored secret', from: "ccd-ws-reap.test.ts ready(['.env']) + .env",
    build: (h) => { const r = ready(h, { ignore: ['.env'] }); fs.writeFileSync(path.join(r.wt, '.env'), 'TOKEN=x\n'); return { kind: 'ws', id: REAP_ID }; } },
  { name: 'reap: the worktree missing', from: 'ccd-ws-reap.test.ts ready() + the worktree removed',
    build: (h) => { const r = ready(h); fs.rmSync(r.wt, { recursive: true, force: true }); return { kind: 'ws', id: REAP_ID }; } },
  { name: 'reap: not archived', from: 'ccd-ws-reap.test.ts ready() without ws-archive',
    build: (h) => { ready(h, { archive: false }); return { kind: 'ws', id: REAP_ID }; } },
  { name: 'reclaim: a child, clean', from: 'ccd-child-reclaim-verb.test.ts makeChild', build: (h) => { makeChild(h); return { kind: 'ws', id: 'demo-quiet-basin' }; } },
  { name: 'reclaim: a child, dirty', from: 'ccd-child-reclaim-verb.test.ts makeChild + an untracked file',
    build: (h) => { const c = makeChild(h); fs.writeFileSync(path.join(c.wt, 'late.txt'), 'late\n'); return { kind: 'ws', id: 'demo-quiet-basin' }; } },
  { name: 'reclaim: not a child', from: 'ccd-child-reclaim-verb.test.ts: a workspace minted without --child',
    build: (h) => { h.makeGhRepo('demo'); h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`); return { kind: 'ws', id: 'demo-quiet-basin' }; } },
  { name: 'expire: archived past its expiry', from: 'ccd-ws-expire-verb.test.ts makeArchived(OLD)', build: (h) => { makeArchived(h); return { kind: 'ws', id: 'demo-quiet-dune' }; } },
  { name: 'expire: archived within its week', from: 'ccd-ws-expire-verb.test.ts makeArchived(NOW - 3600)',
    build: (h) => { makeArchived(h, NOW - 3600); return { kind: 'ws', id: 'demo-quiet-dune' }; } },
  { name: 'collect: a witnessed orphan', from: 'ccd-ws-collect-verb.test.ts makeOrphan', build: (h) => { makeOrphan(h); return { kind: 'ws', id: COL_ID, unregistered: true }; } },
  { name: 'loose: a directory', from: "ccd-ws-collect-loose.test.ts mkLoose('build-cache')", build: (h) => mkLoose(h, 'build-cache', 'dir') },
  { name: 'loose: a file', from: "ccd-ws-collect-loose.test.ts mkLoose('scratch.txt', 'file')", build: (h) => mkLoose(h, 'scratch.txt', 'file') },
];

// ── the columns ──────────────────────────────────────────────────────────────────────────────────────────────────────
type Column = '_ws_reap_eval' | '_ws_reclaim_eval' | '_ws_expire_eval' | '_ws_collect_eval' | '_ws_loose_eval';
const COLUMNS: readonly Column[] = ['_ws_reap_eval', '_ws_reclaim_eval', '_ws_expire_eval', '_ws_collect_eval', '_ws_loose_eval'];
const hexOf = (s: string): string => Buffer.from(s, 'utf8').toString('hex');
const subject = (r: Row): string => (r.kind === 'ws' ? r.id : r.name);

/** The argv each column's eval is handed for a row (rev 8). */
export function argvOf(col: Column, r: Row): string[] {
  const s = subject(r);
  if (col === '_ws_loose_eval') return [s, hexOf(s)];
  if (col === '_ws_reclaim_eval') return [s, '0', ''];
  return [s];
}

const LOCK_REAP = 'exec {lfd}>>"$REG/.reap-$id.lock" && flock -n "$lfd"';
/** The newest change under `~/.cc-tmp/<name>`, in epoch ns, plus 49 hours: the loose suite's clock past its 48 h floor. */
const looseClock = (h: PrHarness, name: string): string => {
  const p = path.join(h.home, '.cc-tmp', name);
  const newest = (q: string): bigint => {
    let best = fs.lstatSync(q, { bigint: true }).ctimeNs;
    if (fs.lstatSync(q).isDirectory()) for (const n of fs.readdirSync(q)) { const v = newest(path.join(q, n)); if (v > best) best = v; }
    return best;
  };
  const base = fs.existsSync(p) ? newest(p) : 1_790_000_000_000_000_000n;
  return `_ws_collect_now_ns() { echo ${base + 49n * 3600n * 1_000_000_000n}; };`;
};

/** One column's driver over one row: the column's own suite's stubs, its verb's setup (see the header), the eval. */
function driver(col: Column, r: Row, h: PrHarness): string {
  const q = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`;
  const a = argvOf(col, r).map(q).join(' ');
  const report = `rc=$?; printf '%s\\x1f%s\\x1f%s\\x1f%s' "$rc" "\${REAP_VERDICT-}" "\${REAP_DETAIL-}" "\${REAP_TOKEN-}"`;
  switch (col) {
    case '_ws_reap_eval': return `${GH_STUB} ${ARCH}
      __cell() { local token=${'0'.repeat(64)} id=${q(subject(r))} lfd resumed
        _ws_reap_reset; ${LOCK_REAP} || return 99
        resumed=$(_reg_get "$id" reaping)
        _ws_reap_eval ${a}; }
      __cell; ${report}`;
    case '_ws_reclaim_eval': return `${CHILD_STUBS} CCD_RECLAIM_RESIDUE_ROOT="$HOME/residue"
      __inner() { RECLAIM_RESUME_PHASE=''; local rbc; rbc=$(_reg_get "$1" reaping); _ws_reclaim_eval ${a}; }
      __cell() { local lc_surface=none lc_actor='' lc_reason='' defer=0 _WS_STALE_WORD='' _WS_STALE_DIGEST=''
        local token=${'0'.repeat(64)} childof='' id=${q(subject(r))} lfd rc=0
        ${LOCK_REAP} || return 99
        local phase='' resumed='' declared='' lctx project workdir main clips pinned=0 start=children lbstate=''
        _ws_reclaim_contained __inner "$id"; }
      __cell; ${report}`;
    case '_ws_expire_eval': return `${EXP_STUBS} CCD_RECLAIM_RESIDUE_ROOT="$HOME/residue"
      __inner() { RECLAIM_RESUME_PHASE=''; EXPIRE_STAMP_AT=''; EXPIRE_IN_USE=(); local rbc; rbc=$(_reg_get "$1" reaping); _ws_expire_eval ${a}; }
      __cell() { local lc_surface=none lc_actor='' lc_reason='' EXPIRE_CHILDOF=''
        local token=${'0'.repeat(64)} id=${q(subject(r))}
        local _WS_RCL_ACT=expire
        local lfd rc=0; ${LOCK_REAP} || return 99
        local phase='' resumed='' declared='' lctx project workdir main clips pinned=0 start=children lbstate=''
        _ws_reclaim_contained __inner "$id"; }
      __cell; ${report}`;
    case '_ws_collect_eval': return `${IDLE_FLOOR_SEAM}
      __inner() { local token="$1" id="$2" surface=none actor='' reason='' q rroot orig lctx rec arc=0 out rc
        local -a recs=()
        _ws_collect_gap locked "$id"; _ws_collect_paused || :
        _ws_tmproot_aside_settle "$id" || arc=$?
        _ws_collect_reset; out=$(_ws_collect_records_of "$id"); rc=$?
        [[ -z "$out" ]] || mapfile -t recs <<< "$out"; _WS_COLLECT_RECORDS=(\${recs[@]+"\${recs[@]}"})
        _ws_collect_eval ${a}; }
      __cell() { local lc_surface=none lc_actor='' lc_reason=''
        local token=${'0'.repeat(64)} id=${q(subject(r))}
        local _WS_RCL_ACT=collect _WS_RCL_CRUMB=''
        local wf rrc=0 wrc=0 arc=0 why
        wf=$(_ws_tmproot_witness_file "$id"); _ws_reclaim_absent "$wf"; wrc=$?
        _ws_collect_records_of "$id" >/dev/null || rrc=$?
        if (( wrc == 0 && rrc == 0 && \${#_WS_QRECS[@]} == 0 )); then _ws_collect_asides_of "$id" || arc=$?; fi
        _ws_collect_prelock "$id" || :
        local lfd rc=0; ${LOCK_REAP} || return 99
        _ws_reclaim_contained __inner "$token" "$id"; }
      __cell; ${report}`;
    case '_ws_loose_eval': return `_disk_pressure() { return 1; }; ${looseClock(h, subject(r))}
      __inner() { local token="$1" hex="$2" surface=none actor='' reason='' name q rroot orig lctx jid
        name="$_WS_LOOSE_NAME"; jid="loose-$_WS_LOOSE_SHA"
        _ws_collect_gap locked "$jid"; _ws_collect_paused || :
        _ws_collect_reset; _WS_LOOSE_RECORD=''; _WS_LOOSE_PHASE=''; _WS_LOOSE_CLASS=''
        _ws_loose_records_of "$_WS_LOOSE_SHA" || :
        _ws_loose_eval ${a}; }
      __cell() { local token=${'0'.repeat(64)} hex=${q(hexOf(subject(r)))} surface=none actor='' reason='' lfd rc=0 jid
        local _WS_RCL_ACT=collect _WS_RCL_CRUMB=''
        _ws_loose_unhex "$hex" || return 98; _ws_loose_sha16 "$hex" || return 98
        jid="loose-$_WS_LOOSE_SHA"
        exec {lfd}>>"$REG/.collect-loose.lock" && flock -n "$lfd" || return 99
        _ws_reclaim_contained __inner "$token" "$hex"; }
      __cell; ${report}`;
  }
}

// ── the cell ─────────────────────────────────────────────────────────────────────────────────────────────────────────
interface Cell { rc: number; verdict: string; detail: string; token: string }

/** A detail with the cell's HOME as `~` and every inode, device and birth-time number as `<ino>`, `<dev>`, `<btime>`. */
export function normalise(detail: string, home: string): string {
  let s = detail;
  for (const p of [fs.existsSync(home) ? fs.realpathSync(home) : home, home]) s = s.split(p).join('~');
  return s
    .replace(/\b(ino|inode)([ =:]+)\d+/gi, '$1$2<ino>')
    .replace(/\b(dev|device)([ =:]+)\d+/gi, '$1$2<dev>')
    .replace(/\b(btime|birth)([ =:]+)\d+/gi, '$1$2<btime>');
}

/** Runs `snippet` under the harness's own environment with `ccd` sourced from `src` (the tip's `CCD`, or a base tree's). */
function runWith(h: PrHarness, src: string, snippet: string): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('bash', ['-c', 'ccd_h_src=$CCD_HARNESS_SRC ccd_h_snippet=$CCD_HARNESS_SNIPPET; '
      + 'unset CCD_HARNESS_SRC CCD_HARNESS_SNIPPET; source "$ccd_h_src"; eval "$ccd_h_snippet"'],
    { encoding: 'utf8', cwd: h.home, stdio: 'pipe',
      // The harness's own env, its poisons asked for again in this file's text (`ccd-workspaces.test.ts`'s scan).
      env: { ...ghContainedEnv(h.home, h.env(), { systemd: true, tmux: true, net: true }), CCD_HARNESS_SRC: src, CCD_HARNESS_SNIPPET: snippet } });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
  }
}

function cellOf(h: PrHarness, src: string, col: Column, r: Row): Cell | { died: string } {
  const out = runWith(h, src, driver(col, r, h));
  const parts = out.stdout.split('\x1f');
  if (out.code !== 0 || parts.length !== 4) return { died: `exit ${out.code}: ${out.stderr.trim().split('\n').pop() ?? ''}` };
  return { rc: Number(parts[0]), verdict: parts[1]!, detail: normalise(parts[2]!, h.home), token: parts[3]! };
}

/** The harness's own recorders: what a STUB or the harness's poison appends, never the instance a verb reads. */
const RECORDERS = /^(?:[a-z-]+-calls|gh-poison|probe-asked|rows-asked|gaps)$/;
/** Git's own records of a fetch, which `_ws_reap_eval`'s mandatory `git fetch` rewrites on every run (measured at Step 0:
 *  `FETCH_HEAD` 119 -> 261 bytes, and `logs/refs/remotes/origin/HEAD` growing a line per run, on the expire rows); no
 *  cell's answer reads them (every cell answered the same twice over one instance). */
const GIT_FETCH_RECORDS = /(?:^|\/)\.git\/(?:FETCH_HEAD|logs\/.*)$/;
/** The instance's normalised listing: every path under HOME with its size (files and links) and mode, no times. */
export function listing(home: string): string[] {
  const out: string[] = [];
  const walk = (d: string, rel: string): void => {
    for (const n of fs.readdirSync(d).sort()) {
      const r = rel ? `${rel}/${n}` : n;
      if ((!rel && RECORDERS.test(n)) || GIT_FETCH_RECORDS.test(r)) continue;
      const p = path.join(d, n);
      const st = fs.lstatSync(p);
      const mode = (st.mode & 0o7777).toString(8);
      if (st.isDirectory()) { out.push(`${r}/ ${mode}`); walk(p, r); } else out.push(`${r} ${st.size} ${mode}`);
    }
  };
  walk(home, '');
  return out;
}

/** The merge-base's ccd, extracted into a tmp tree with its library beside it, or null with no origin/main or merge-base. */
function baseCcd(): string | null {
  const body = mergeBaseText(ROOT, path.relative(ROOT, CCD));
  const lib = mergeBaseText(ROOT, path.relative(ROOT, CCD_LIB));
  if (body === null || lib === null) return null;
  const dir = mkTmp('c5d-base-ccd-');
  const launcher = ccdLauncherIn(dir);
  const libAt = path.join(dir, path.relative(ROOT, CCD_LIB));
  fs.mkdirSync(path.dirname(libAt), { recursive: true });
  fs.writeFileSync(launcher, body, { mode: 0o755 });
  fs.writeFileSync(libAt, lib);
  return launcher;
}

/** A fresh instance of `def`'s fixture, with the fixed generation written for a workspace row. */
function fresh(def: RowDef): { h: PrHarness; row: Row } {
  const h = makePrHarness('c5d-retire-');
  const row = def.build(h);
  const reg = path.join(h.home, '.cc-sessions');
  if (row.kind === 'ws' && !row.unregistered) fs.writeFileSync(path.join(reg, `${row.id}.generation`), GENERATION);
  // The two lock files, as an earlier audit leaves them (a lock file is never unlinked): opening one then writes nothing.
  fs.writeFileSync(path.join(reg, `.reap-${subject(row)}.lock`), '');
  fs.writeFileSync(path.join(reg, '.collect-loose.lock'), '');
  return { h, row };
}

const MEASURE = process.env['C5D_MEASURE'] === '1';
const made: PrHarness[] = [];
afterAll(() => { for (const h of made) h.cleanup(); });

/** A literal cell: rc, verdict, normalised detail, and the token: a literal 64-hex, `''` when the eval mints none, or
 *  `DIFFERENTIAL` when it mints one that a fresh instance changes (it binds a witness's or an entry's inode, device and
 *  birth time), so it is held only against the merge-base's eval over the same instance. */
type Literal = readonly [rc: number, verdict: string, detail: string, token: string];
const DIFFERENTIAL = '<differential>';

// Step 0's measurement, re-runnable: `C5D_MEASURE=1` prints every cell over two fresh instances, each cell run twice over
// one instance with the listing before and after, so a driver that writes into its instance is named.
describe.skipIf(!LINUX || !MEASURE)('Step 0: the retire-verdict table, measured (C5D_MEASURE=1)', () => {
  it('prints every cell twice over fresh instances, and whether a driver writes into its instance', () => {
    const report: string[] = [];
    const table: Record<string, Record<string, Literal>> = {};
    for (const def of ROWS) {
      table[def.name] = {};
      for (const col of COLUMNS) {
        const runs: Array<Cell | { died: string }> = [];
        let writes = '';
        let argv: string[] = [];
        for (let k = 0; k < 2; k++) {
          const { h, row } = fresh(def);
          argv = argvOf(col, row);
          const before = listing(h.home);
          const c = cellOf(h, CCD, col, row);
          const after = listing(h.home);
          const c2 = cellOf(h, CCD, col, row);
          const after2 = listing(h.home);
          if (k === 0) {
            const diff = (a: string[], b: string[]): string[] => a.filter((x) => !b.includes(x));
            writes = `run 1 wrote +${JSON.stringify(diff(after, before))} -${JSON.stringify(diff(before, after))}; run 2 wrote ${JSON.stringify([...diff(after2, after), ...diff(after, after2)])}; same answer twice: ${JSON.stringify(c) === JSON.stringify(c2)}`;
          }
          runs.push(c);
          h.cleanup();
        }
        const [a, b] = runs as [Cell | { died: string }, Cell | { died: string }];
        report.push(`ROW ${def.name} | ${col} ${JSON.stringify(argv)}\n  run1 ${JSON.stringify(a)}\n  run2 ${JSON.stringify(b)}\n  ${writes}`);
        if ('died' in a || 'died' in b) continue;
        table[def.name]![col] = [a.rc, a.verdict, a.detail, a.token === '' ? '' : a.token === b.token ? a.token : DIFFERENTIAL];
      }
    }
    console.log(report.join('\n'));
    console.log(`EXPECTED ${JSON.stringify(table, null, 2)}`);
  }, 1_800_000);
});

// ── the table, measured on the base (Linux, one fresh instance per cell) ─────────────────────────────────────────────
const EXPECTED: Readonly<Record<string, Readonly<Record<Column, Literal>>>> = {
  // ccd-ws-reap.test.ts ready()
  "reap: merged, clean": {
    _ws_reap_eval: [0, "reapable", "", "02b8b3a025a96faaaa250f3bb313d431a67a4d78e64f719cce468e97cf4d3ab4"],
    _ws_reclaim_eval: [1, "not-a-child", "demo-quiet-basin carries no readable child marker — only a workspace dispatch minted for a run is ever reclaimed", ""],
    _ws_expire_eval: [1, "not-expired", "demo-quiet-basin was archived 86400 seconds ago; it expires 604800 seconds after its archive, at 1790518400", ""],
    _ws_collect_eval: [1, "registered", "~/.cc-sessions/demo-quiet-basin.uuid stands — a workspace is registered as demo-quiet-basin, so the temp root at its id is that workspace's", ""],
    _ws_loose_eval: [1, "not-loose", "the entry is class registered — only a loose entry is this arm's", ""],
  },
  // ccd-ws-reap.test.ts ready() + an untracked file
  "reap: a dirty tree": {
    _ws_reap_eval: [1, "dirty-tree", "1 uncommitted or untracked file(s)", ""],
    _ws_reclaim_eval: [1, "not-a-child", "demo-quiet-basin carries no readable child marker — only a workspace dispatch minted for a run is ever reclaimed", ""],
    _ws_expire_eval: [1, "not-expired", "demo-quiet-basin was archived 86400 seconds ago; it expires 604800 seconds after its archive, at 1790518400", ""],
    _ws_collect_eval: [1, "registered", "~/.cc-sessions/demo-quiet-basin.uuid stands — a workspace is registered as demo-quiet-basin, so the temp root at its id is that workspace's", ""],
    _ws_loose_eval: [1, "not-loose", "the entry is class registered — only a loose entry is this arm's", ""],
  },
  // ccd-ws-reap.test.ts ready() + a commit never pushed
  "reap: an unpushed tip": {
    _ws_reap_eval: [1, "unpushed-commits", "1 commit(s) are not on the remote", ""],
    _ws_reclaim_eval: [1, "not-a-child", "demo-quiet-basin carries no readable child marker — only a workspace dispatch minted for a run is ever reclaimed", ""],
    _ws_expire_eval: [1, "not-expired", "demo-quiet-basin was archived 86400 seconds ago; it expires 604800 seconds after its archive, at 1790518400", ""],
    _ws_collect_eval: [1, "registered", "~/.cc-sessions/demo-quiet-basin.uuid stands — a workspace is registered as demo-quiet-basin, so the temp root at its id is that workspace's", ""],
    _ws_loose_eval: [1, "not-loose", "the entry is class registered — only a loose entry is this arm's", ""],
  },
  // ccd-ws-reap.test.ts ready() + git stash
  "reap: a stash": {
    _ws_reap_eval: [1, "stashes-present", "1 stash entry belonging to ws/quiet-basin (a stash taken from it on a detached HEAD names no branch and is attributed by its base commit, so an anonymous entry based on shared history counts against every workspace of demo): 'git -C ~/projects/demo stash list' names them, and 'git stash branch <name> stash@{N}' keeps one, 'git -C ~/projects/demo stash drop stash@{N}' discards one", ""],
    _ws_reclaim_eval: [1, "not-a-child", "demo-quiet-basin carries no readable child marker — only a workspace dispatch minted for a run is ever reclaimed", ""],
    _ws_expire_eval: [1, "not-expired", "demo-quiet-basin was archived 86400 seconds ago; it expires 604800 seconds after its archive, at 1790518400", ""],
    _ws_collect_eval: [1, "registered", "~/.cc-sessions/demo-quiet-basin.uuid stands — a workspace is registered as demo-quiet-basin, so the temp root at its id is that workspace's", ""],
    _ws_loose_eval: [1, "not-loose", "the entry is class registered — only a loose entry is this arm's", ""],
  },
  // ccd-ws-reap.test.ts ready([
  "reap: an ignored secret": {
    _ws_reap_eval: [1, "sensitive-ignored", ".env", ""],
    _ws_reclaim_eval: [1, "not-a-child", "demo-quiet-basin carries no readable child marker — only a workspace dispatch minted for a run is ever reclaimed", ""],
    _ws_expire_eval: [1, "not-expired", "demo-quiet-basin was archived 86400 seconds ago; it expires 604800 seconds after its archive, at 1790518400", ""],
    _ws_collect_eval: [1, "registered", "~/.cc-sessions/demo-quiet-basin.uuid stands — a workspace is registered as demo-quiet-basin, so the temp root at its id is that workspace's", ""],
    _ws_loose_eval: [1, "not-loose", "the entry is class registered — only a loose entry is this arm's", ""],
  },
  // ccd-ws-reap.test.ts ready() + the worktree removed
  "reap: the worktree missing": {
    _ws_reap_eval: [1, "worktree-missing", "~/worktrees/demo/quiet-basin is gone", ""],
    _ws_reclaim_eval: [1, "not-a-child", "demo-quiet-basin carries no readable child marker — only a workspace dispatch minted for a run is ever reclaimed", ""],
    _ws_expire_eval: [1, "not-expired", "demo-quiet-basin was archived 86400 seconds ago; it expires 604800 seconds after its archive, at 1790518400", ""],
    _ws_collect_eval: [1, "registered", "~/.cc-sessions/demo-quiet-basin.uuid stands — a workspace is registered as demo-quiet-basin, so the temp root at its id is that workspace's", ""],
    _ws_loose_eval: [1, "not-loose", "the entry is class registered — only a loose entry is this arm's", ""],
  },
  // ccd-ws-reap.test.ts ready() without ws-archive
  "reap: not archived": {
    _ws_reap_eval: [1, "not-archived", "archive first — that is the staging", ""],
    _ws_reclaim_eval: [1, "not-a-child", "demo-quiet-basin carries no readable child marker — only a workspace dispatch minted for a run is ever reclaimed", ""],
    _ws_expire_eval: [1, "not-archived", "demo-quiet-basin is not archived — only a workspace archived 604800 seconds ago or more is ever expired", ""],
    _ws_collect_eval: [1, "registered", "~/.cc-sessions/demo-quiet-basin.uuid stands — a workspace is registered as demo-quiet-basin, so the temp root at its id is that workspace's", ""],
    _ws_loose_eval: [1, "not-loose", "the entry is class registered — only a loose entry is this arm's", ""],
  },
  // ccd-child-reclaim-verb.test.ts makeChild
  "reclaim: a child, clean": {
    _ws_reap_eval: [1, "not-archived", "archive first — that is the staging", ""],
    _ws_reclaim_eval: [0, "reclaimable", "", "6a74b2e2d033ff309ae33433b77299a1abc5ad210656e1ad0f9441920c34d6f9"],
    _ws_expire_eval: [1, "not-archived", "demo-quiet-basin is not archived — only a workspace archived 604800 seconds ago or more is ever expired", ""],
    _ws_collect_eval: [1, "registered", "~/.cc-sessions/demo-quiet-basin.child stands — a workspace is registered as demo-quiet-basin, so the temp root at its id is that workspace's", ""],
    _ws_loose_eval: [1, "not-loose", "the entry is class registered — only a loose entry is this arm's", ""],
  },
  // ccd-child-reclaim-verb.test.ts makeChild + an untracked file
  "reclaim: a child, dirty": {
    _ws_reap_eval: [1, "not-archived", "archive first — that is the staging", ""],
    _ws_reclaim_eval: [0, "reclaimable", "", "97474263ee2717ea28590693afe79b4360815aedff54cf30d3217eeb5eacd065"],
    _ws_expire_eval: [1, "not-archived", "demo-quiet-basin is not archived — only a workspace archived 604800 seconds ago or more is ever expired", ""],
    _ws_collect_eval: [1, "registered", "~/.cc-sessions/demo-quiet-basin.child stands — a workspace is registered as demo-quiet-basin, so the temp root at its id is that workspace's", ""],
    _ws_loose_eval: [1, "not-loose", "the entry is class registered — only a loose entry is this arm's", ""],
  },
  // ccd-child-reclaim-verb.test.ts: a workspace minted without --child
  "reclaim: not a child": {
    _ws_reap_eval: [1, "not-archived", "archive first — that is the staging", ""],
    _ws_reclaim_eval: [1, "not-a-child", "demo-quiet-basin carries no readable child marker — only a workspace dispatch minted for a run is ever reclaimed", ""],
    _ws_expire_eval: [1, "not-archived", "demo-quiet-basin is not archived — only a workspace archived 604800 seconds ago or more is ever expired", ""],
    _ws_collect_eval: [1, "registered", "~/.cc-sessions/demo-quiet-basin.uuid stands — a workspace is registered as demo-quiet-basin, so the temp root at its id is that workspace's", ""],
    _ws_loose_eval: [1, "not-loose", "the entry is class registered — only a loose entry is this arm's", ""],
  },
  // ccd-ws-expire-verb.test.ts makeArchived(OLD)
  "expire: archived past its expiry": {
    _ws_reap_eval: [1, "no-upstream", "ws/quiet-dune was never pushed (it has no remote-tracking branch and no tracking configuration), no merged PR binds to it, and its commits are not reachable from refs/remotes/origin/main", ""],
    _ws_reclaim_eval: [1, "not-a-child", "demo-quiet-dune carries no readable child marker — only a workspace dispatch minted for a run is ever reclaimed", ""],
    _ws_expire_eval: [0, "expirable", "", "be0fc926c611034023814d1e0015273a93bddc1e4a394c07f802c0d4288e56f5"],
    _ws_collect_eval: [1, "registered", "~/.cc-sessions/demo-quiet-dune.uuid stands — a workspace is registered as demo-quiet-dune, so the temp root at its id is that workspace's", ""],
    _ws_loose_eval: [1, "not-loose", "the entry is class registered — only a loose entry is this arm's", ""],
  },
  // ccd-ws-expire-verb.test.ts makeArchived(NOW - 3600)
  "expire: archived within its week": {
    _ws_reap_eval: [1, "no-upstream", "ws/quiet-dune was never pushed (it has no remote-tracking branch and no tracking configuration), no merged PR binds to it, and its commits are not reachable from refs/remotes/origin/main", ""],
    _ws_reclaim_eval: [1, "not-a-child", "demo-quiet-dune carries no readable child marker — only a workspace dispatch minted for a run is ever reclaimed", ""],
    _ws_expire_eval: [1, "not-expired", "demo-quiet-dune was archived 3600 seconds ago; it expires 604800 seconds after its archive, at 1790601200", ""],
    _ws_collect_eval: [1, "registered", "~/.cc-sessions/demo-quiet-dune.uuid stands — a workspace is registered as demo-quiet-dune, so the temp root at its id is that workspace's", ""],
    _ws_loose_eval: [1, "not-loose", "the entry is class registered — only a loose entry is this arm's", ""],
  },
  // ccd-ws-collect-verb.test.ts makeOrphan
  "collect: a witnessed orphan": {
    _ws_reap_eval: [1, "no-such-session", "no registry entry for demo-quiet-reef", ""],
    _ws_reclaim_eval: [1, "no-such-session", "no registry entry for demo-quiet-reef", ""],
    _ws_expire_eval: [1, "no-such-session", "no registry entry for demo-quiet-reef", ""],
    _ws_collect_eval: [0, "collectable", "", DIFFERENTIAL],
    _ws_loose_eval: [1, "not-loose", "the entry is class witnessed — only a loose entry is this arm's", ""],
  },
  // ccd-ws-collect-loose.test.ts mkLoose(
  "loose: a directory": {
    _ws_reap_eval: [1, "no-such-session", "no registry entry for build-cache", ""],
    _ws_reclaim_eval: [1, "no-such-session", "no registry entry for build-cache", ""],
    _ws_expire_eval: [1, "no-such-session", "no registry entry for build-cache", ""],
    _ws_collect_eval: [1, "not-witnessed", "no witness stands for build-cache at ~/.cc-sessions/tmproots/build-cache and no quarantine record names it — there is nothing to collect", ""],
    _ws_loose_eval: [0, "collectable", "", DIFFERENTIAL],
  },
  // ccd-ws-collect-loose.test.ts mkLoose(
  "loose: a file": {
    _ws_reap_eval: [1, "no-such-session", "no registry entry for scratch.txt", ""],
    _ws_reclaim_eval: [1, "no-such-session", "no registry entry for scratch.txt", ""],
    _ws_expire_eval: [1, "no-such-session", "no registry entry for scratch.txt", ""],
    _ws_collect_eval: [1, "unmeasured", "scratch.txt names no project and slug, so whether its slug is free cannot be asked", ""],
    _ws_loose_eval: [0, "collectable", "", DIFFERENTIAL],
  },
};

/** The detail normaliser, held on its own (every other cell reads through it). */
describe('the detail normaliser (D-7082)', () => {
  it('FIXTURE: the cell\'s HOME (as given and as resolved) becomes ~; inode, device and birth-time numbers become placeholders', () => {
    const home = mkTmp('c5d-norm-');
    expect(normalise(`${home}/.cc-tmp/x moved: ino 1234, dev=2049, btime:1793000000; ${fs.realpathSync(home)}/y`, home))
      .toBe('~/.cc-tmp/x moved: ino <ino>, dev=<dev>, btime:<btime>; ~/y');
    expect(normalise('no path, no number 42', home)).toBe('no path, no number 42');
  });
});

describe.skipIf(!LINUX)('the retire-verdict table: every row through every retire eval (D-7082)', () => {
  const base = baseCcd();
  afterAll(() => { if (base) fs.rmSync(path.dirname(path.dirname(base)), { recursive: true, force: true }); });

  it('the table covers every row and every column, and holds at least 12 rows', () => {
    expect(ROWS.length).toBeGreaterThanOrEqual(12);
    expect(Object.keys(EXPECTED)).toEqual(ROWS.map((r) => r.name));
    for (const r of ROWS) expect(Object.keys(EXPECTED[r.name]!), r.name).toEqual([...COLUMNS]);
  });

  it('the differential half has the merge-base\'s ccd (it fails on CI without one, and skips locally with a warning)', (ctx) => {
    if (base === null) {
      if (process.env['CI']) throw new Error('retire-verdicts: no origin/main or no merge-base, so the tokens cannot be held against the base');
      console.warn('retire-verdicts: skipped the differential half, no origin/main or merge-base in this checkout');
      ctx.skip();
    }
  });

  for (const def of ROWS) {
    it(`${def.name} (${def.from})`, () => {
      for (const col of COLUMNS) {
        const want = EXPECTED[def.name]![col];
        const { h, row } = fresh(def);
        made.push(h);
        try {
          let baseCell: Cell | { died: string } | null = null;
          if (base !== null) {
            const before = listing(h.home);
            baseCell = cellOf(h, base, col, row);
            expect(listing(h.home), `${def.name} | ${col}: the base's eval wrote into the instance`).toEqual(before);
          }
          const got = cellOf(h, CCD, col, row);
          console.log(`cell ${def.name} | ${col} ${JSON.stringify(argvOf(col, row))} -> ${JSON.stringify(got)}`);
          expect('died' in got ? got : [got.rc, got.verdict, got.detail], `${def.name} | ${col}`).toEqual([want[0], want[1], want[2]]);
          const tok = (got as Cell).token;
          if (want[3] === '') expect(tok, `${def.name} | ${col}: mints no token`).toBe('');
          else {
            expect(tok, `${def.name} | ${col}: a token`).toMatch(/^[0-9a-f]{64}$/);
            if (want[3] !== DIFFERENTIAL) expect(tok, `${def.name} | ${col}: the literal token`).toBe(want[3]);
          }
          if (baseCell !== null) expect(baseCell, `${def.name} | ${col}: the merge-base's eval over the same instance`).toEqual(got);
        } finally { h.cleanup(); }
      }
    }, 600_000);
  }
});
