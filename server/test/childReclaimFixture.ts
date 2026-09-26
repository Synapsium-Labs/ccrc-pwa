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
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { WS_ADD } from './ccdWsHelpers.js';
import type { PrHarness } from './ccdPrHelpers.js';

export const CHILD_ID = 'demo-quiet-basin';
export const CHILD_RUN = 7;
export const CHILD_BRANCH = 'ws/quiet-basin';

/** A MODEL of the tmux server, as a bash function — never a real tmux. It
 *  RECORDS every argv to `$HOME/ccd-calls` and answers from files in the
 *  fixture HOME, in tmux's own words (the messages `_session_probe`'s header
 *  in `ccd/ccd` lists as measured):
 *
 *  - `$HOME/tmux-sessions`, one session name per line (absent: none). A
 *    `=name` target matches EXACTLY; a bare target matches exactly first and
 *    otherwise the first session it is a PREFIX of — tmux's own resolution,
 *    so an unanchored `cc-<id>` finds a sibling `cc-<id>x`, and the anchoring
 *    is something a case can see fail. No match: `can't find session: <t>`.
 *  - `$HOME/tmux-clients-<name>`: what `list-clients` prints for that session.
 *  - `$HOME/tmux-fault`: while it exists, EVERY call prints its text to
 *    stderr and exits 1 — the server could not be asked (`error connecting
 *    to … (Permission denied)`, `no server running on …`).
 *    `$HOME/tmux-fault-at-tail` becomes `tmux-fault` when the reclaim tail
 *    unsupervises (the `_ws_unsupervise` stub below moves it), so a case can
 *    let rung 5 pass and break tmux between the ladder and the tail's kill.
 *  - `kill-session` removes the session it resolves and exits 0; removing
 *    the LAST one leaves `no server running on …` as the fault — tmux's
 *    exit-empty, the server exiting because it has nothing left to serve.
 *    `$HOME/tmux-kill-noop` makes it exit 0 and remove nothing, and
 *    `$HOME/tmux-fault-after-kill` becomes `tmux-fault` once a kill has
 *    exited 0 — tmux unaskable right AFTER a kill that succeeded.
 *  Every other verb exits 1. */
const TMUX_MODEL = [
  'tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; local verb="$1" t="" s hit=""; shift;',
  ' while (( $# )); do case "$1" in -t) t="$2"; shift 2 ;; *) shift ;; esac; done;',
  ' if [[ -e "$HOME/tmux-fault" ]]; then cat "$HOME/tmux-fault" >&2; return 1; fi;',
  ' if [[ -f "$HOME/tmux-sessions" ]]; then while IFS= read -r s; do',
  '  if [[ "$t" == =* ]]; then [[ "$s" == "${t#=}" ]] && hit="$s";',
  '  elif [[ "$s" == "$t" ]]; then hit="$s"; break;',
  '  elif [[ -z "$hit" && "$s" == "$t"* ]]; then hit="$s"; fi;',
  ' done < "$HOME/tmux-sessions"; fi;',
  ' [[ -n "$hit" ]] || { echo "can\'t find session: $t" >&2; return 1; };',
  ' case "$verb" in',
  '  has-session) return 0 ;;',
  '  list-clients) cat "$HOME/tmux-clients-$hit" 2>/dev/null; return 0 ;;',
  '  kill-session) [[ -e "$HOME/tmux-kill-noop" ]] && return 0;',
  '   { command grep -vxF -- "$hit" "$HOME/tmux-sessions" || :; } > "$HOME/tmux-sessions.new";',
  '   mv "$HOME/tmux-sessions.new" "$HOME/tmux-sessions";',
  '   [[ -s "$HOME/tmux-sessions" ]] || echo "no server running on /tmp/tmux-fixture/default" > "$HOME/tmux-fault";',
  '   if [[ -e "$HOME/tmux-fault-after-kill" ]]; then mv "$HOME/tmux-fault-after-kill" "$HOME/tmux-fault"; fi;',
  '   return 0 ;;',
  '  *) return 1 ;;',
  ' esac; };',
].join('');

/** `_ws_unsupervise` RECORDS to `$HOME/ccd-calls` and acts on nothing (it
 *  also moves `tmux-fault-at-tail` into place — see `TMUX_MODEL`); `tmux` is
 *  `TMUX_MODEL`, which with no files planted answers `can't find session`
 *  to every target, so rung 5 sees no session and therefore no attached
 *  client, and the tail's kill finds none to kill. A case that needs a live
 *  session plants `tmux-sessions`, or redefines `tmux` AFTER this string.
 *  `_svc_is_active` answers `inactive` — what systemd prints once the unit is
 *  disabled and stopped — because the harness's `systemctl` poison prints
 *  NOTHING, and Task 4's tail reads an empty answer as "unmeasured", which
 *  fails shut; a case that needs a unit that stayed up redefines it AFTER
 *  this string. */
export const CHILD_STUBS =
  '_ws_unsupervise() { echo "unsupervise $*" >> "$HOME/ccd-calls";'
  + ' if [[ -e "$HOME/tmux-fault-at-tail" ]]; then mv "$HOME/tmux-fault-at-tail" "$HOME/tmux-fault"; fi; };'
  + ` ${TMUX_MODEL}`
  + ' _svc_is_active() { printf inactive; };';

/** The three ways tmux answers "I could not be asked", in its own words (the
 *  messages `_session_probe`'s header in `ccd/ccd` lists as measured). None of
 *  them says the session is gone: each is UNKNOWN to ws-reclaim (spec §5.5,
 *  rung 5; §5.6, the tail) — a server may be there, or the pane may be. */
export const TMUX_FAULTS = {
  'permission denied': 'error connecting to /tmp/tmux-fixture/default (Permission denied)',
  'no server running': 'no server running on /tmp/tmux-fixture/default',
  'no socket': 'error connecting to /tmp/tmux-fixture/default (No such file or directory)',
} as const;

/** Plants `TMUX_MODEL`'s state in the fixture HOME (see there). */
export function plantTmux(h: PrHarness, o: {
  sessions?: readonly string[]; clients?: Record<string, string>; fault?: string; faultAtTail?: string; killNoop?: boolean;
  faultAfterKill?: string;
}): void {
  if (o.sessions) fs.writeFileSync(path.join(h.home, 'tmux-sessions'), o.sessions.map((s) => `${s}\n`).join(''));
  for (const [s, c] of Object.entries(o.clients ?? {})) fs.writeFileSync(path.join(h.home, `tmux-clients-${s}`), `${c}\n`);
  if (o.fault !== undefined) fs.writeFileSync(path.join(h.home, 'tmux-fault'), `${o.fault}\n`);
  if (o.faultAtTail !== undefined) fs.writeFileSync(path.join(h.home, 'tmux-fault-at-tail'), `${o.faultAtTail}\n`);
  if (o.killNoop) fs.writeFileSync(path.join(h.home, 'tmux-kill-noop'), '');
  if (o.faultAfterKill !== undefined) fs.writeFileSync(path.join(h.home, 'tmux-fault-after-kill'), `${o.faultAfterKill}\n`);
}

/** What `TMUX_MODEL` holds now: the sessions still up, one per entry. */
export function tmuxSessions(h: PrHarness): string[] {
  const p = path.join(h.home, 'tmux-sessions');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
}

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

/** Every commit the child's attic KEEPS: whatever is reachable from any ref
 *  under `refs/ccrc/attic/<id>/` — the reflog keep's parents included, which
 *  are kept by one ref and are not refs of their own. Read from git. */
export function atticReach(h: PrHarness, c: Child): string[] {
  const refs = h.git(c.main, 'for-each-ref', '--format=%(refname)', `refs/ccrc/attic/${CHILD_ID}/`)
    .split('\n').filter(Boolean);
  return refs.length ? h.git(c.main, 'rev-list', ...refs).split('\n').filter(Boolean) : [];
}

/** `n` commits that NO ref reaches, each a child of `repo`'s HEAD — siblings,
 *  never a chain, so keeping one keeps no other — written by ONE
 *  `git fast-import` (a loop of `commit-tree` would cost n processes). Their
 *  ids, in order. */
export function looseCommits(h: PrHarness, repo: string, n: number, label: string): string[] {
  const base = h.git(repo, 'rev-parse', 'HEAD');
  const ref = 'refs/ccrc-fixture/loose';
  let stream = '';
  for (let i = 1; i <= n; i++) {
    const msg = `${label} ${i}\n`;
    stream += `commit ${ref}\nmark :${i}\ncommitter T <t@x> ${1700000000 + i} +0000\n`
      + `data ${Buffer.byteLength(msg)}\n${msg}from ${base}\n\n`;
  }
  const marks = path.join(h.home, `loose-${label.replace(/[^a-z0-9]+/gi, '-')}.marks`);
  execFileSync('git', ['-C', repo, 'fast-import', '--quiet', `--export-marks=${marks}`],
    { input: stream, env: { ...process.env, HOME: h.home } });
  h.git(repo, 'update-ref', '-d', ref);
  const byMark = new Map(fs.readFileSync(marks, 'utf8').split('\n').filter(Boolean)
    .map((l) => l.split(' ') as [string, string]));
  return Array.from({ length: n }, (_, i) => byMark.get(`:${i + 1}`)!);
}

/** Appends one reflog ENTRY per id to the log FILE git keeps for `ref`,
 *  located through git (`rev-parse --git-path logs/<ref>` run in `dir`, so
 *  `HEAD` in a linked worktree is that worktree's own), then one entry back to
 *  the ref's current value: the shape of a ref moved n times and moved back.
 *  Each entry's old side is the id before it. */
export function appendReflog(h: PrHarness, dir: string, ref: string, ids: readonly string[]): void {
  const file = h.git(dir, 'rev-parse', '--path-format=absolute', '--git-path', `logs/${ref}`);
  const cur = h.git(dir, 'rev-parse', ref);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let prev = cur; let out = '';
  for (const id of [...ids, cur]) { out += `${prev} ${id} T <t@x> 1700000000 +0000\tfixture: moved\n`; prev = id; }
  fs.appendFileSync(file, out);
}

/** The busy repository the review measured: a branch `noise` of `main`'s
 *  repository whose reflog holds `n` entries of commits unrelated to the
 *  child — another session's history, which a reclaim must neither keep nor
 *  let crowd out the child's own. */
export function plantReflogNoise(h: PrHarness, main: string, n: number): void {
  const ids = looseCommits(h, main, n, 'noise');
  h.git(main, 'update-ref', 'refs/heads/noise', ids[n - 1]!);
  appendReflog(h, main, 'refs/heads/noise', ids);
}

/** A commit on `dir`'s HEAD, referenced by nothing, whose id starts with
 *  `c`-`f` — so, of 650 random reflog ids, about 480 sort below it and a keep
 *  capped at the 200 LOWEST (the review's measured defect) never reaches it.
 *  Each case asserts that rank as its CONTROL rather than trusting this. */
export function highCommit(h: PrHarness, dir: string, label: string): string {
  for (let k = 0; ; k++) {
    const id = h.git(dir, 'commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', `${label} ${k}`);
    if (id[0]! >= 'c') return id;
  }
}

/** Expires EVERY reflog of `main`'s repository and runs `git gc
 *  --prune=now` there — the fixture repository only. After it, a commit
 *  exists only if a ref reaches it. */
export function gcNow(h: PrHarness, main: string): void {
  h.git(main, 'reflog', 'expire', '--expire=now', '--expire-unreachable=now', '--all');
  h.git(main, 'gc', '--prune=now', '--quiet');
}

/** Whether `main`'s repository still HAS the commit `id` (`cat-file -e`). */
export function hasCommit(h: PrHarness, main: string, id: string): boolean {
  return h.run(`git -C "${main}" cat-file -e "${id}^{commit}" 2>/dev/null`).code === 0;
}
