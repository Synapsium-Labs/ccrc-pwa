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
