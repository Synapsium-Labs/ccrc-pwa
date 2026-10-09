// The ORPHANED, WITNESSED temp root every `ws-collect` suite builds on (child reclamation wave 7, spec §5.2 for the
// witnessed population, §5.10 for the collector): a leaf at `$HOME/.cc-tmp/<id>` holding scratch, witnessed by the
// REAL writer (`_ws_tmproot_witness_write`, the code `_child_tmpdir` runs on every rc 0), and NO registry row for the
// id, so its slug reads free: the collector's whole population. The idle floor is lowered ONLY by redefining
// `_ws_collect_floor_s` in the sourced harness (ruling G4), never through the production knob, which can only raise it.
//
// FIXTURE HOME ONLY. `makePrHarness`'s HOME is the single isolation boundary: every `~/.cc-tmp`, `$REG`, record and
// quarantine path below derives from it, and the verb runs as a SOURCED function, never through the installed
// launcher and never against the live HOME. Every seam here (`_ws_collect_gap`, `_ws_collect_mountinfo`, a stubbed
// probe, rule or `mv`) is a shell FUNCTION a snippet defines after ccd is sourced: it shadows ccd's own for that one
// call and touches nothing else.
//
// A RESUME TOKEN IS NEVER COMPUTED HERE: it binds the record's every field, `checkouts=` included, so a case that
// needs one takes it from `ws-audit --collect`'s own document (`collectToken`).
import fs from 'node:fs';
import path from 'node:path';
import type { PrHarness } from './ccdPrHelpers.js';

export const COL_ID = 'demo-quiet-reef';
export const COL_RUN = 7;
/** A well-formed token no ladder mints. */
export const WRONG_TOKEN = '0'.repeat(64);
/** The floor's ONE test-only seam (ruling G4): Task 4's `_ws_collect_floor_s`, the floor's only definition, redefined. */
export const IDLE_FLOOR_SEAM = '_ws_collect_floor_s() { echo 0; };';

export type Run = { code: number; stdout: string; stderr: string };

const lines = (p: string): string[] =>
  (fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : []);

export const ccTmp = (h: PrHarness): string => path.join(h.home, '.cc-tmp');
export const regOf = (h: PrHarness): string => path.join(h.home, '.cc-sessions');
export const leafOf = (h: PrHarness): string => path.join(ccTmp(h), COL_ID);
/** The leaf's PHYSICAL pre-move spelling: what the verb moves, asks the checkout question of, and passes as the alias. */
export const origOf = (h: PrHarness): string => path.join(fs.realpathSync(ccTmp(h)), COL_ID);
export const witnessOf = (h: PrHarness): string => path.join(regOf(h), 'tmproots', COL_ID);
export const recordsDir = (h: PrHarness): string => path.join(regOf(h), 'tmpquarantine');
export const records = (h: PrHarness): string[] =>
  (fs.existsSync(recordsDir(h)) ? fs.readdirSync(recordsDir(h)).sort() : []);
/** `<physical ~/.cc-tmp>/.ccd-quarantine`, spelled physically, as the verb resolves it. */
export const quarantineOf = (h: PrHarness): string => path.join(fs.realpathSync(ccTmp(h)), '.ccd-quarantine');
export const slots = (h: PrHarness): string[] =>
  (fs.existsSync(quarantineOf(h)) ? fs.readdirSync(quarantineOf(h)).sort() : []);
/** The seam points the verb passed, in order (`GAP_LOG`, `gapAt`, `crashAt`). */
export const gaps = (h: PrHarness): string[] => lines(path.join(h.home, 'gaps'));
export const linesOf = (h: PrHarness, name: string): string[] => lines(path.join(h.home, name));
/** The inode at `p` now, or '' when nothing stands there; the last component is never followed. */
export const inoAt = (p: string): string => {
  try { return String(fs.lstatSync(p, { bigint: true }).ino); } catch { return ''; }
};

export interface Orphan { leaf: string; ino: string; dev: string; witness: string }
/** A witnessed orphan: scratch, a nested directory, and the witness the real writer leaves. */
export function makeOrphan(h: PrHarness): Orphan {
  const leaf = leafOf(h);
  fs.mkdirSync(path.join(leaf, 'cdk.out', 'deep'), { recursive: true });
  fs.chmodSync(leaf, 0o700);
  fs.writeFileSync(path.join(leaf, 'cdk.out', 'manifest.json'), '{}');
  fs.writeFileSync(path.join(leaf, 'scratch.txt'), 'scratch\n');
  h.sh(`_ws_tmproot_witness_write ${COL_ID} '${leaf}' ${COL_RUN}`);
  const st = fs.lstatSync(leaf, { bigint: true });
  return { leaf, ino: String(st.ino), dev: String(st.dev), witness: fs.readFileSync(witnessOf(h), 'utf8') };
}

/** Records every seam point the verb passes to `$HOME/gaps`, and does nothing else. */
export const GAP_LOG = `_ws_collect_gap() { printf '%s\\n' "$1" >> "$HOME/gaps"; };`;
/** Logs, and runs `cmd` (bash: `$2` is the id, `$3` the slot) at `point`. */
export const gapAt = (point: string, cmd: string): string =>
  `_ws_collect_gap() { printf '%s\\n' "$1" >> "$HOME/gaps"; if [[ "$1" == ${point} ]]; then ${cmd}; fi; };`;
/** A crash: the verb's process dies at `point` with no trap, and the kernel frees its lock — a SIGKILL's leftovers. */
export const crashAt = (point: string): string => gapAt(point, 'exit 137');

/** The evaluation (Task 5's `_ws_collect_fork`) answering collectable with `token`: on a fresh arm a PRESENT leaf, on
 *  a resume the record `rec` at `phase` (default `moved`) — for the cases that pin the VERB's own guards past the
 *  evaluation. It reads the witness in the current shell, as the real one does, so the verb sees the fields its
 *  consent bound; on a resume the verb reads the record itself. */
export const evalSays = (token: string, rec = '', phase = rec ? 'moved' : ''): string =>
  `_ws_collect_fork() { _ws_tmproot_witness_read "$1" >/dev/null 2>&1 || :; REAP_VERDICT=collectable;`
  + ` REAP_TOKEN=${token}; REAP_DETAIL=''; _WS_COLLECT_RECORD='${rec}'; _WS_COLLECT_PHASE='${phase}';`
  + ` _WS_COLLECT_LEAF='${rec ? '' : 'present'}'; return 0; };`;

/** The in-use probe, answering "someone" for a spelling matching the glob in `$HOME/busy-now`, and "unmeasured"
 *  while `$HOME/unmeasured-now` exists. A seam plants either AFTER the move, so the ladder's own ask passes. */
export const PROBE_STUB = '_ws_path_users() { printf \'%s\\n\' "$1" >> "$HOME/probe-asked";'
  + ' if [[ -e "$HOME/busy-now" ]] && [[ "$1" == $(cat "$HOME/busy-now") ]]; then'
  + ' _WS_PATH_USERS_PIDS=4242; _WS_PATH_USERS_WHY="pid 4242 (a stub) uses $1"; return 1; fi;'
  + ' if [[ -e "$HOME/unmeasured-now" ]]; then _WS_PATH_USERS_WHY=\'stub: the process table could not be read\'; return 2; fi;'
  + ' return 0; };';
/** Task 4's row rule, logging `id|leafpath|stands-or-absent` and answering `$HOME/rows-now`'s rc once a seam plants it. */
export const ROWS_STUB = '_ws_collect_rows_clear() {'
  + ' printf \'%s|%s|%s\\n\' "$1" "$2" "$([[ -e "$2" ]] && echo stands || echo absent)" >> "$HOME/rows-asked";'
  + ' if [[ -e "$HOME/rows-now" ]]; then _WS_COLLECT_ROWS_WHY="stub: a row lies inside $2"; return "$(cat "$HOME/rows-now")"; fi;'
  + ' return 0; };';
/** The row rule answering "no row" always, so a case can pin the guard BEFORE it without the rule backstopping. */
export const ROWS_CLEAR = '_ws_collect_rows_clear() { return 0; };';
/** The mount table at `$HOME/mountinfo` (see `realMounts`), so a seam can append to it mid-act. */
export const MOUNTS_SEAM = '_ws_collect_mountinfo() { printf \'%s\' "$HOME/mountinfo"; };';
export function realMounts(h: PrHarness): void {
  fs.writeFileSync(path.join(h.home, 'mountinfo'), fs.readFileSync('/proc/self/mountinfo'));
}

/** A REAL process started from inside a seam, DOUBLE-FORKED so its parent is not the verb's shell: the in-use probe
 *  never counts a child of ccd's own process (`_ws_path_users`, "WHAT IS NOT A USER"). It closes the verb's reap-lock
 *  descriptor first, so the lock is the kernel's to free when the verb's process ends. `body` runs in it (bash: `$3`
 *  is the slot); its pid lands in `$HOME/holder.pid`, and the seam waits up to 5 s for `ready` (a bash test that may
 *  read the pid as `$_hp`). */
export const holderAt = (body: string, ready: string): string =>
  `( ( exec {lfd}>&-; ${body} ) </dev/null >/dev/null 2>&1 & echo $! > "$HOME/holder.pid" );`
  + ` for _ in $(seq 100); do _hp=$(cat "$HOME/holder.pid"); ${ready} && break; sleep 0.05; done`;
/** Kills the holder `holderAt` started, if one is still running. */
export function killHolder(h: PrHarness): void {
  const p = path.join(h.home, 'holder.pid');
  if (!fs.existsSync(p)) return;
  try { process.kill(Number(fs.readFileSync(p, 'utf8').trim()), 'SIGKILL'); } catch { /* gone */ }
}

const floor = (o: { floor?: boolean }): string => (o.floor === false ? '' : IDLE_FLOOR_SEAM);

/** `ccd ws-audit --session <id> --collect` (Task 5) through the sourced function. */
export function collectAudit(h: PrHarness, opts: { pre?: string; floor?: boolean } = {}): Run {
  return h.run(`${floor(opts)} ${opts.pre ?? ''} cmd_ws_audit --session ${COL_ID} --collect`);
}

/** The token the audit mints now; throws, naming the audit's answer, when it mints none. */
export function collectToken(h: PrHarness, opts: { pre?: string; floor?: boolean } = {}): string {
  const r = collectAudit(h, opts);
  const doc = JSON.parse(r.stdout.trim().split('\n').pop() || '{}') as { verdict?: string; token?: string };
  if (doc.verdict !== 'collectable' || !doc.token) throw new Error(`the audit minted no token: ${r.stdout}${r.stderr}`);
  return doc.token;
}

/** `ws-collect` through the sourced function, answering instead of throwing. */
export function collectVerb(
  h: PrHarness, token: string, opts: { pre?: string; extra?: string; id?: string; floor?: boolean } = {},
): Run {
  return h.run(`${floor(opts)} ${opts.pre ?? ''} cmd_ws_collect --expect ${token} --session ${opts.id ?? COL_ID} ${opts.extra ?? ''}`);
}

/** The verb's ONE JSON line. */
export const docOf = (stdout: string): Record<string, unknown> =>
  JSON.parse(stdout.trim().split('\n').pop() || '') as Record<string, unknown>;
