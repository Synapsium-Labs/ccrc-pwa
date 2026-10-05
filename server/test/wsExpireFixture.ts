// The ARCHIVED workspace every `ws-expire` suite builds on (workspace lifecycle spec 2026-09-24 §5.3): a real
// repository with a GitHub-shaped origin (`makeGhRepo`), a workspace minted through the REAL `cmd_ws_add` — NO
// `--child`, so no `.child` marker, which is the expiry's whole population — two commits on its branch, and the
// archive `ws-archive` leaves: `.archived` (an epoch), `.archivedreason`, `.archivemanifest`, no pane, the unit
// unsupervised. The archive's age is set by naming the instant: `NOW_FN` redefines `_ws_expire_now`, the one clock
// rung 2′ reads, so the 604799/604800 boundary is exact rather than a race with the wall clock.
//
// FIXTURE HOME ONLY. `makePrHarness`'s HOME is the single isolation boundary, and `ws-expire` is destructive:
// `CHILD_STUBS` records the unit and pane calls instead of making them, and `CHILD_ENV` keeps the residue probe
// inside that HOME (both from `childReclaimFixture.ts`, whose machinery this verb shares).
import fs from 'node:fs';
import path from 'node:path';
import { WS_ADD } from './ccdWsHelpers.js';
import type { PrHarness } from './ccdPrHelpers.js';
import { CHILD_ENV, CHILD_STUBS } from './childReclaimFixture.js';

export const EXP_ID = 'demo-quiet-dune';
export const EXP_BRANCH = 'ws/quiet-dune';
/** The instant every case lives at — `_ws_expire_now` answers it. */
export const NOW = 1_790_000_000;
/** `WS_EXPIRE_AFTER_S`: seven days (spec §5.3, L3). */
export const WEEK = 604_800;
/** The archive every case starts from: eight days before NOW, so the ladder's rung 2′ passes unless a case moves it. */
export const OLD = NOW - 8 * 86_400;
export const NOW_FN = `_ws_expire_now() { echo ${NOW}; };`;
/** The stubs every expiry call carries: the RECLAIM machinery's recorders, then the clock. */
export const EXP_STUBS = `${CHILD_STUBS} ${NOW_FN}`;

export interface Archived { main: string; wt: string; tip: string }

const regFile = (h: PrHarness, field: string): string => path.join(h.home, '.cc-sessions', `${EXP_ID}.${field}`);

/** Stamps the archive `ws-archive` writes — the epoch on its own line, as `date +%s` prints it. */
export function archiveAt(h: PrHarness, epoch: number): void {
  fs.writeFileSync(regFile(h, 'archived'), `${epoch}\n`);
  fs.writeFileSync(regFile(h, 'archivedreason'), 'operator\n');
  fs.writeFileSync(regFile(h, 'archivemanifest'), '{"paths":[]}\n');
}

export function makeArchived(h: PrHarness, archivedAt = OLD): Archived {
  const main = h.makeGhRepo('demo');
  h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-dune cmd_ws_add demo`);
  const wt = path.join(h.home, 'worktrees', 'demo', 'quiet-dune');
  for (const n of ['1', '2']) {
    fs.writeFileSync(path.join(wt, `f${n}.txt`), `work ${n}\n`);
    h.git(wt, 'add', `f${n}.txt`);
    h.git(wt, 'commit', '-m', `work ${n}`);
  }
  archiveAt(h, archivedAt);
  return { main, wt, tip: h.git(wt, 'rev-parse', 'HEAD') };
}

export interface ExpireAnswer { verdict: string; token: string; detail: string }

/** `_ws_expire_eval`'s own answer, read off the globals it sets. `pre` runs after the stubs. */
export function expireEvalOf(h: PrHarness, opts: { pre?: string } = {}): ExpireAnswer {
  const out = h.sh(`${EXP_STUBS} ${opts.pre ?? ''} _WS_RCL_ACT=expire; _ws_expire_eval ${EXP_ID} >/dev/null;`
    + ` printf '%s\\x1f%s\\x1f%s' "$REAP_VERDICT" "$REAP_TOKEN" "$REAP_DETAIL"`);
  const [verdict = '', token = '', detail = ''] = out.split('\x1f');
  return { verdict, token, detail };
}

/** `ccd ws-audit --session <id> --expire` through the sourced function, answering instead of throwing. */
export function expireAudit(h: PrHarness, opts: { pre?: string } = {}): { code: number; stdout: string; stderr: string } {
  return h.run(`${EXP_STUBS} ${opts.pre ?? ''} cmd_ws_audit --session ${EXP_ID} --expire`);
}

/** The token `ws-audit --expire` mints now (its document's `token`), or '' when it mints none. */
export function expireToken(h: PrHarness, opts: { pre?: string } = {}): string {
  const r = expireAudit(h, opts);
  const doc = JSON.parse(r.stdout) as { token?: string };
  return doc.token ?? '';
}

/** `ws-expire` through the sourced function, answering instead of throwing (a refusal exits 0, a failure 1, a usage
 *  error 1 with nothing on stdout). `CHILD_ENV` rides every call, so the residue probe never leaves the HOME. */
export function expireVerb(
  h: PrHarness, token: string, opts: { extra?: string; pre?: string } = {},
): { code: number; stdout: string; stderr: string } {
  return h.run(`${EXP_STUBS} ${opts.pre ?? ''} ${CHILD_ENV} cmd_ws_expire --expect ${token} --session ${EXP_ID} ${opts.extra ?? ''}`);
}
