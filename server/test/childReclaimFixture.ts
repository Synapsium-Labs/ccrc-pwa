// The CHILD every ccd child-reclaim suite builds on (spec 2026-09-22 §4): a
// real repository with a GitHub-shaped origin (`makeGhRepo`), a workspace
// minted through the REAL `cmd_ws_add --child 7` — wave 1's flag, so the
// `.child` marker is written by the code that ships, never planted — and two
// commits on its branch. Never archived: a child never is, which is the whole
// reason `ccd-ws-reap.test.ts`'s `ready()` cannot be reused here.
//
// FIXTURE HOME ONLY. `makePrHarness`'s HOME is the single isolation boundary,
// and the verb this programme adds is destructive, so the rule is absolute:
// `CHILD_STUBS` records the unit and pane calls instead of making them, and
// `CHILD_ENV` points the residue probe at a directory inside that HOME.
import fs from 'node:fs';
import path from 'node:path';
import { WS_ADD } from './ccdWsHelpers.js';
import type { PrHarness } from './ccdPrHelpers.js';

export const CHILD_ID = 'demo-quiet-basin';
export const CHILD_RUN = 7;
export const CHILD_BRANCH = 'ws/quiet-basin';

/** `_ws_unsupervise` and `tmux` RECORD to `$HOME/ccd-calls` and act on
 *  nothing. `tmux` answers 1 to every verb, `has-session` included, so rung 5
 *  sees no session and therefore no attached client; a case that needs a live
 *  session redefines `tmux` AFTER this string. `_svc_is_active` answers
 *  `inactive` — what systemd prints once the unit is disabled and stopped —
 *  because the harness's `systemctl` poison prints NOTHING, and Task 4's tail
 *  reads an empty answer as "unmeasured", which fails shut; a case that needs
 *  a unit that stayed up redefines it AFTER this string. */
export const CHILD_STUBS =
  '_ws_unsupervise() { echo "unsupervise $*" >> "$HOME/ccd-calls"; };'
  + ' tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; return 1; };'
  + ' _svc_is_active() { printf inactive; };';

/** The residue probe's root, INSIDE the fixture HOME — never the real
 *  `/tmp/claude-<uid>`. Prefixed onto every call that can reach the probe. */
export const CHILD_ENV = 'CCD_RECLAIM_RESIDUE_ROOT="$HOME/residue"';

export interface Child { main: string; wt: string; tip: string }

export function makeChild(h: PrHarness): Child {
  const main = h.makeGhRepo('demo');
  h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add --child ${CHILD_RUN} demo`);
  const wt = path.join(h.home, 'worktrees', 'demo', 'quiet-basin');
  for (const n of ['1', '2']) {
    fs.writeFileSync(path.join(wt, `f${n}.txt`), `work ${n}\n`);
    h.git(wt, 'add', `f${n}.txt`);
    h.git(wt, 'commit', '-m', `work ${n}`);
  }
  return { main, wt, tip: h.git(wt, 'rev-parse', 'HEAD') };
}

/** A UTF-8 locale on this box in which bash's `[1-9]` range admits `²` — found
 *  by MEASURING that property through the harness's own contained shell (wave
 *  1's rule: never by name; `C.utf8` collates by codepoint and could not show
 *  the defect), or '' when the box has none. Assigning `LC_ALL` in bash takes
 *  effect at once, so the subshell measures exactly what a `pre` of
 *  `LC_ALL=<loc>;` will do to the sourced ladder. */
export function wideDigitLocale(h: PrHarness): string {
  return h.sh(`for l in $(locale -a 2>/dev/null | grep -iE 'utf-?8$'); do`
    + ` ( LC_ALL=$l; [[ "²" =~ ^[1-9]$ ]] ) 2>/dev/null && { printf '%s' "$l"; break; }; done; true`);
}

export interface LadderAnswer { verdict: string; token: string; detail: string }

/** `_ws_reclaim_eval`'s own answer, read off the globals it sets. `childOf` ''
 *  is the audit's call (the marker checked, not compared); a run id is the
 *  verb's. `pre` runs after the stubs, so a case can redefine `tmux`. */
export function evalOf(
  h: PrHarness, opts: { defer?: 0 | 1; childOf?: string; pre?: string } = {},
): LadderAnswer {
  const out = h.sh(`${CHILD_STUBS} ${opts.pre ?? ''} _ws_reclaim_eval ${CHILD_ID} ${opts.defer ?? 0}`
    + ` '${opts.childOf ?? ''}' >/dev/null; printf '%s\\x1f%s\\x1f%s' "$REAP_VERDICT" "$REAP_TOKEN" "$REAP_DETAIL"`);
  const [verdict = '', token = '', detail = ''] = out.split('\x1f');
  return { verdict, token, detail };
}

/** `ws-reclaim` through the sourced function, answering instead of throwing
 *  (a refusal exits 0, a failure 1, a usage error 1 with nothing on stdout).
 *  `CHILD_ENV` rides every call, so the residue probe never leaves the HOME. */
export function childReclaimVerb(
  h: PrHarness, token: string, opts: { childOf?: number; extra?: string; pre?: string } = {},
): { code: number; stdout: string; stderr: string } {
  return h.run(`${CHILD_STUBS} ${opts.pre ?? ''} ${CHILD_ENV} cmd_ws_reclaim --expect ${token}`
    + ` --child-of ${opts.childOf ?? CHILD_RUN} --session ${CHILD_ID} ${opts.extra ?? ''}`);
}

/** A sibling worktree `other` of the child's OWN repository, left DIRTY, and
 *  the child's directory replaced by a link to it — the shape in which a
 *  reclaim that followed the leaf would commit `other`'s work into the
 *  child's WIP and remove `other`'s tree (spec §5.5). The same shape the
 *  ladder suite builds, here for the verb end to end. */
export function plantOther(h: PrHarness, c: Child): string {
  const other = path.join(h.home, 'other');
  h.git(c.main, 'worktree', 'add', '-b', 'ws/other', other);
  fs.writeFileSync(path.join(other, 'dirty.txt'), 'uncommitted work of another session\n');
  fs.appendFileSync(path.join(other, 'README.md'), 'edited\n');
  fs.rmSync(c.wt, { recursive: true, force: true });
  fs.symlinkSync(other, c.wt);
  return other;
}

/** Everything of `other` a reclaim could change: every entry under it (path,
 *  type, mode, bytes), git's record of it, its branch tip, its status and its
 *  branch's subjects — or `gone` when the tree itself is not there. */
export function otherSnapshot(h: PrHarness, c: Child, other: string): Record<string, unknown> {
  if (!fs.existsSync(other)) return { gone: true };
  const tree: string[] = [];
  const walk = (d: string): void => {
    for (const n of fs.readdirSync(d).sort()) {
      const p = path.join(d, n);
      const st = fs.lstatSync(p);
      const rel = path.relative(other, p);
      if (st.isDirectory()) { tree.push(`d ${st.mode.toString(8)} ${rel}`); walk(p); }
      else tree.push(`f ${st.mode.toString(8)} ${rel} ${fs.readFileSync(p).toString('base64')}`);
    }
  };
  walk(other);
  const stanza = h.git(c.main, 'worktree', 'list', '--porcelain').split('\n\n')
    .find((s) => s.startsWith(`worktree ${other}\n`)) ?? '<no record>';
  return {
    tree,
    record: stanza,
    tip: h.git(c.main, 'rev-parse', 'refs/heads/ws/other'),
    status: h.git(other, 'status', '--porcelain=v1', '--untracked-files=all'),
    subjects: h.git(c.main, 'log', '--format=%s', 'refs/heads/ws/other'),
  };
}
