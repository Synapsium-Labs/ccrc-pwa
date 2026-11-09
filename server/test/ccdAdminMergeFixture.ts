// The stub layer for the admin-merge door's tests (`ccd pr-admin-merge`, D-8124), on top of `ccdPrHelpers.ts`'s harness.
// FIXTURE HOME ONLY (`makePrHarness`): every path derives from `h.home`, and the verb runs as a SOURCED function. `gh`,
// `tmux` and `timeout` are shell FUNCTIONS in the snippet, so they win over PATH and the harness's poisons answer only
// when a snippet forgets this stub. `timeout N cmd…` drops N and runs cmd in this shell, which is the only way a `tmux`
// function is seen by ccd's `_plat_timeout`.
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';

export const HEAD_A = 'a'.repeat(40);
export const HEAD_B = 'b'.repeat(40);

/** `gh` logs its argv to `$HOME/gh-calls` and answers each read from `$HOME/am/routes`: one `pattern|file` line per
 *  route, the pattern a shell glob over the argv joined by spaces, the file under `$HOME/am/`. The first matching route
 *  prints its file; a read no route names answers nothing and rc 1. `tmux display-message` answers `cc-<id>` from
 *  `$HOME/am/tmux-session`, and rc 1 when that file is absent. */
export const AM_GH_STUB = `
gh() {
  printf '%s\\n' "$*" >> "$HOME/gh-calls"
  local line pat file
  [[ -f "$HOME/am/routes" ]] || return 1
  while IFS= read -r line; do
    pat="\${line%%|*}"; file="\${line#*|}"
    # shellcheck disable=SC2053  # the route's pattern is a glob on purpose
    if [[ "$*" == $pat ]]; then cat "$HOME/am/$file"; return 0; fi
  done < "$HOME/am/routes"
  return 1
};
tmux() {
  printf '%s\\n' "$*" >> "$HOME/am/tmux-calls"
  [[ "$1" == display-message && -f "$HOME/am/tmux-session" ]] || return 1
  cat "$HOME/am/tmux-session"
};
timeout() { case "$1" in -*) return 125 ;; esac; shift; "$@"; };
`;

export interface AmOver {
  /** `GET /repos/owner-a/repo-a` */
  repo?: Record<string, unknown>;
  /** `gh pr view 42 …` */
  pr?: Record<string, unknown>;
}

const put = (h: PrHarness, name: string, body: unknown): void => {
  const dir = path.join(h.home, 'am');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), typeof body === 'string' ? body : JSON.stringify(body));
};

/** Route `pattern` (a glob over the gh argv) to a file holding `body`. */
export const amRoute = (h: PrHarness, pattern: string, file: string, body: unknown): void => {
  put(h, file, body);
  fs.appendFileSync(path.join(h.home, 'am', 'routes'), `${pattern}|${file}\n`);
};

/** A green, eligible repository `owner-a/repo-a`: the identity is an admin, a merge commit is allowed, PR 42 is open at
 *  `HEAD_A` on base `main`. `over` replaces a document whole. */
export function amFixture(h: PrHarness, over: AmOver = {}): void {
  fs.rmSync(path.join(h.home, 'am', 'routes'), { force: true });
  amRoute(h, 'api repos/owner-a/repo-a', 'repo.json', over.repo ?? {
    permissions: { admin: true }, allow_merge_commit: true, allow_squash_merge: true, allow_rebase_merge: false,
  });
  amRoute(h, 'pr view 42 *', 'pr.json', over.pr ?? {
    number: 42, state: 'OPEN', isDraft: false, headRefOid: HEAD_A, baseRefName: 'main', reviewDecision: '',
  });
}

/** A registry row for `id` and a `tmux` that answers `cc-<id>` for the pane. `hold` and `child` write the row's
 *  `.hold` and `.child` fields. */
export function amCaller(h: PrHarness, id: string, f: { hold?: string; child?: boolean } = {}): void {
  const reg = path.join(h.home, '.cc-sessions');
  fs.mkdirSync(reg, { recursive: true });
  fs.writeFileSync(path.join(reg, `${id}.uuid`), '11111111-2222-3333-4444-555555555555\n');
  if (f.hold !== undefined) fs.writeFileSync(path.join(reg, `${id}.hold`), `${f.hold}\n`);
  if (f.child) fs.writeFileSync(path.join(reg, `${id}.child`), '17\n');
  put(h, 'tmux-session', `cc-${id}\n`);
}

/** Run `cmd_pr_admin_merge <argv>` with `TMUX_PANE=%1` (`pane: null` leaves it unset). */
export function amRun(h: PrHarness, argv: string, o: { pane?: string | null } = {}): { code: number; stdout: string; stderr: string } {
  const pane = o.pane === undefined ? '%1' : o.pane;
  return h.run(`${AM_GH_STUB} ${pane === null ? 'unset TMUX_PANE' : `export TMUX_PANE='${pane}'`}; cmd_pr_admin_merge ${argv}`);
}

/** The box's ccrc.env (the box setting file `_ccrc_knob` reads). */
export const boxEnv = (h: PrHarness, text: string): void => {
  fs.mkdirSync(path.join(h.home, '.ccrc'), { recursive: true });
  fs.writeFileSync(path.join(h.home, '.ccrc', 'ccrc.env'), text);
};

export const swapLog = (h: PrHarness): string[] => {
  const p = path.join(h.home, '.cc-sessions', 'swap.log');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
};
