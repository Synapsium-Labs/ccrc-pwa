// The ORPHANED, WITNESSED temp root every `ws-audit --collect` suite builds on (the temp-root collector, spec
// §5.10): a child's leaf handed out by the REAL `_child_tmpdir`, so its witness `$REG/tmproots/<id>` is the line ccd
// writes, then the child's registry row removed by hand — the leaf and its witness stay, which is what an orphan
// is. And the quarantine record a crashed `ws-collect` leaves, written in the record's one-line grammar.
//
// FIXTURE HOME ONLY (`makePrHarness`, which is `makeCcdHarness` plus `run`): every path below derives from `h.home`.
// Nothing here runs a verb that removes anything.
//
// THESE SUITES NEVER LOWER THE IDLE FLOOR. A real leaf's newest ctime is "now", and nothing unprivileged sets a ctime
// back, so a case that needs a leaf past the floor stubs the WALK's answer (`walkAt`: a shell function the snippet
// defines; the walk itself is held by its own suite) and leaves the floor to Task 4's `_ws_collect_floor_held` against
// the real clock. The production knob `WS_COLLECT_IDLE_FLOOR_S` only ever RAISES the floor; the one test-only seam that
// lowers it is redefining `_ws_collect_floor_s` in a sourced harness (ruling G4), which these suites do not need.
// A stub of the walk sets ALL FIVE of its globals: Task 4's token refuses unless `_WS_IDLE_LEAF` ends `/<id>`.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { PrHarness } from './ccdPrHelpers.js';

export const COL_ID = 'demo-quiet-mesa';
/** The run `_child_tmpdir` reads off the marker and writes into the witness. */
export const COL_RUN = '7';
/** A record's name is `<id>.<ns>.<pid>`; these are its two trailing all-digit fields. */
export const REC_NS = '1790000000000000000';
export const REC_PID = '4242';
export const recName = (id: string = COL_ID): string => `${id}.${REC_NS}.${REC_PID}`;

export const regDir = (h: PrHarness): string => path.join(h.home, '.cc-sessions');
export const leafOf = (h: PrHarness, id: string = COL_ID): string => path.join(h.home, '.cc-tmp', id);
export const witnessOf = (h: PrHarness, id: string = COL_ID): string => path.join(regDir(h), 'tmproots', id);
export const lockOf = (h: PrHarness, id: string = COL_ID): string => path.join(regDir(h), `.reap-${id}.lock`);
export const recordsDir = (h: PrHarness): string => path.join(regDir(h), 'tmpquarantine');
/** Q, `<physical ~/.cc-tmp>/.ccd-quarantine` (spec §5.10). `~/.cc-tmp` must exist. */
export const quarantineOf = (h: PrHarness): string =>
  path.join(fs.realpathSync(path.join(h.home, '.cc-tmp')), '.ccd-quarantine');

/** Epoch nanoseconds `s` seconds before now (a negative `s` is in the future). */
export const secondsAgoNs = (s: number): bigint =>
  (BigInt(Math.floor(Date.now() / 1000)) - BigInt(s)) * 1_000_000_000n;
/** The walk's answer, fixed: the newest ctime under the leaf is `newestNs`, over `count` entries. */
export const walkAt = (newestNs: bigint, count = 3): string =>
  `_ws_collect_idle() { _WS_IDLE_NEWEST_NS=${newestNs}; _WS_IDLE_COUNT=${count}; _WS_IDLE_WHY=''; _WS_IDLE_DETAIL='';`
  + ' _WS_IDLE_LEAF="$1"; return 0; };';
/** Two days idle: past the 24 h floor, and fixed for the whole file, so two audits mint one token. */
export const AGED_NS = secondsAgoNs(2 * 86_400);
export const AGED = walkAt(AGED_NS);
/** The walk could not answer, for `why`. */
export const walkUnmeasured = (why: string): string =>
  `_ws_collect_idle() { _WS_IDLE_NEWEST_NS=''; _WS_IDLE_COUNT=''; _WS_IDLE_WHY=${why};`
  + ` _WS_IDLE_DETAIL='stub: the walk did not answer (${why})'; _WS_IDLE_LEAF=''; return 2; };`;
/** A walk that must never run: it leaves `$HOME/walked` behind (an exit-0 answer carries no stderr), and answers
 *  unmeasured. */
export const NO_WALK = '_ws_collect_idle() { : > "$HOME/walked"; _WS_IDLE_NEWEST_NS=\'\'; _WS_IDLE_COUNT=\'\';'
  + ' _WS_IDLE_WHY=walk-failed; _WS_IDLE_DETAIL=\'stub: this walk must never run\'; _WS_IDLE_LEAF=\'\'; return 2; };';
export const walked = (h: PrHarness): boolean => fs.existsSync(path.join(h.home, 'walked'));
/** A box whose mv has no --no-copy: the collector's capability probe, answered no. */
export const NO_MV = '_ws_collect_mv_ok() { return 1; };';
/** Another holder of the id's reap lock: an open file description of this shell, flocked. The audit's own open of
 *  the same file is a second description, which `flock -n` cannot take. */
export const holdLock = (id: string = COL_ID): string => `exec 9>>"$REG/.reap-${id}.lock"; flock -n 9 || exit 99;`;
export const PAUSE = 'touch "$REG/reclaim-paused";';

export interface Identity { dev: string; ino: string; btime: string }
/** The identity of `p` ITSELF, by NODE's lstat — never by ccd — in the witness's spelling. */
export function identityOf(p: string): Identity {
  const st = fs.lstatSync(p, { bigint: true });
  const bt = st.birthtimeNs / 1_000_000_000n;
  return { dev: String(st.dev), ino: String(st.ino), btime: bt > 0n ? String(bt) : '-' };
}

/** A dead child's temp root: the REAL spawn path writes the leaf and its witness, two entries go inside, and the
 *  child's dot-free registry fields are removed. The leaf and the witness outlive the row. */
export function makeOrphan(h: PrHarness, id: string = COL_ID): { leaf: string } {
  h.sh(`_reg_set ${id} child ${COL_RUN} && _child_tmpdir ${id} >/dev/null`);
  const leaf = leafOf(h, id);
  fs.mkdirSync(path.join(leaf, 'cdk.out'));
  fs.writeFileSync(path.join(leaf, 'cdk.out', 'manifest.json'), '{}');
  for (const f of fs.readdirSync(regDir(h))) {
    const rest = f.startsWith(`${id}.`) ? f.slice(id.length + 1) : null;
    if (rest !== null && rest !== '' && !rest.includes('.')) fs.rmSync(path.join(regDir(h), f));
  }
  return { leaf };
}

/** ANOTHER directory at the id: the old leaf is renamed aside (kept, so its inode cannot be handed straight back to
 *  the new one — a removed inode is reused at once on ext4), and a fresh directory is made in its place. */
export function replaceLeaf(h: PrHarness, id: string = COL_ID): string {
  const leaf = leafOf(h, id);
  fs.renameSync(leaf, path.join(h.home, `old-${id}`));
  fs.mkdirSync(leaf, { mode: 0o700 });
  return leaf;
}

export interface RecordFields {
  id: string; dev: string; ino: string; btime: string; run: string; at: string; token: string; checkouts: string;
}
/** The record's one line, in its writer's field order (spec §5.10). It carries NO path (ruling G5): the slot is derived
 *  from the record's file name and the physical quarantine directory, so a space in a path never splits a record. */
export const recordLine = (r: RecordFields): string =>
  `v=1 id=${r.id} dev=${r.dev} ino=${r.ino} btime=${r.btime} run=${r.run} at=${r.at}`
  + ` token=${r.token} checkouts=${r.checkouts}\n`;
/** A record of `id` naming `ident`. Its slot is the one its file name gives, `<Q>/slot.<name>`, by derivation. */
export function recordFor(ident: Identity, id: string = COL_ID): RecordFields {
  return { id, ...ident, run: COL_RUN, at: '1790000000000', token: 'a'.repeat(64), checkouts: '' };
}
export function plantRecord(h: PrHarness, name: string, body: string): string {
  fs.mkdirSync(recordsDir(h), { recursive: true, mode: 0o700 });
  const p = path.join(recordsDir(h), name);
  fs.writeFileSync(p, body, { mode: 0o600 });
  return p;
}
/** What `ws-collect`'s move leaves: Q and the slot made 0700, and the leaf RENAMED to `<slot>/leaf` (same inode). */
export function moveIntoSlot(h: PrHarness, id: string = COL_ID, name: string = recName(id)): string {
  const q = quarantineOf(h);
  fs.mkdirSync(q, { recursive: true, mode: 0o700 });
  const slot = path.join(q, `slot.${name}`);
  fs.mkdirSync(slot, { mode: 0o700 });
  fs.renameSync(leafOf(h, id), path.join(slot, 'leaf'));
  return slot;
}

export interface Answer { code: number; stdout: string; stderr: string; doc: Record<string, unknown> | null }
/** `ccd ws-audit --session <id> --collect` through the sourced `cmd_ws_audit`, answering instead of throwing. */
export function collectAudit(h: PrHarness, opts: { id?: string; pre?: string } = {}): Answer {
  const r = h.run(`${opts.pre ?? ''} cmd_ws_audit --session ${opts.id ?? COL_ID} --collect`);
  let doc: Record<string, unknown> | null = null;
  try { doc = JSON.parse(r.stdout) as Record<string, unknown>; } catch { doc = null; }
  return { ...r, doc };
}
export const collectOf = (a: Answer): Record<string, unknown> =>
  (a.doc?.['collect'] ?? {}) as Record<string, unknown>;
export const verdictOf = (a: Answer): string => String(a.doc?.['verdict']);

/** `_ws_collect_fork`'s own answer, with the reap lock held as its callers hold it, read off the globals it sets. */
export function collectForkOf(h: PrHarness, opts: { id?: string; pre?: string } = {}):
{ verdict: string; token: string; detail: string; phase: string } {
  const id = opts.id ?? COL_ID;
  const out = h.sh(`${opts.pre ?? ''} exec {l}>>"$REG/.reap-${id}.lock"; flock -n "$l" || exit 99;`
    + ` _t() { _ws_collect_fork ${id} >/dev/null;`
    + ` printf '%s\\x1f%s\\x1f%s\\x1f%s' "$REAP_VERDICT" "$REAP_TOKEN" "$REAP_DETAIL" "$_WS_COLLECT_PHASE"; };`
    + ' _ws_reclaim_contained _t');
  const [verdict = '', token = '', detail = '', phase = ''] = out.split('\x1f');
  return { verdict, token, detail, phase };
}

/** A process of this uid, NOT in the leaf, whose environment's TMPDIR is `dir`: the shape that re-created a leaf
 *  3.7 s after a reclaim (spec §5.6). Its environment is built, never a spread of process.env. ALWAYS `stop()` it in
 *  a `finally`. */
export function holdTmpdir(dir: string): { pid: number; stop: () => void } {
  const p: ChildProcess = spawn('sleep', ['60'], {
    cwd: '/', stdio: 'ignore', env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', TMPDIR: dir },
  });
  if (p.pid === undefined) throw new Error(`could not start a process with TMPDIR=${dir}`);
  return { pid: p.pid, stop: () => { p.kill('SIGKILL'); } };
}
