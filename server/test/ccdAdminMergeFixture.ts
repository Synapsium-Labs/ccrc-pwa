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
export const MERGE_OID = 'c'.repeat(40);

/** `gh` logs its argv to `$HOME/gh-calls` and answers each read from `$HOME/am/routes`: one `pattern|file` line per
 *  route, the pattern a shell glob over the argv joined by spaces, the file under `$HOME/am/`. The first matching route
 *  prints its file; a read no route names answers nothing and rc 1. `tmux display-message` answers `cc-<id>` from
 *  `$HOME/am/tmux-session` (with the pane's pid, `$HOME/am/tmux-pid`, default this shell), and rc 1 when that file is
 *  absent. `getent` answers the fixture home, so the door reads its registry there whatever `$HOME` says; `AM_STUB_HOME`
 *  names the fixture home for the stubs when a test sets `$HOME` to something else. */
export const AM_GH_STUB = `
gh() {
  local H="\${AM_STUB_HOME:-$HOME}" line pat file
  printf '%s\\n' "$*" >> "$H/gh-calls"
  # \`pr merge\` fails with the stderr held in \`$H/am/merge-fail\` when that file exists (a refusal GitHub wrote).
  if [[ "$1 $2" == "pr merge" && -f "$H/am/merge-fail" ]]; then cat "$H/am/merge-fail" >&2; return 1; fi
  [[ -f "$H/am/routes" ]] || return 1
  while IFS= read -r line; do
    pat="\${line%%|*}"; file="\${line#*|}"
    # shellcheck disable=SC2053  # the route's pattern is a glob on purpose
    if [[ "$*" == $pat ]]; then cat "$H/am/$file"; return 0; fi
  done < "$H/am/routes"
  return 1
};
tmux() {
  local H="\${AM_STUB_HOME:-$HOME}"
  printf '%s\\n' "$*" >> "$H/am/tmux-calls"
  # The door asks the fleet's default socket by path: \`tmux -S <path> display-message …\`.
  [[ "$1" == -S ]] && shift 2
  [[ "$1" == display-message && -f "$H/am/tmux-session" ]] || return 1
  # \`#{pane_pid} #S\`: the pane's process (this shell, unless a test names another) and the session name.
  printf '%s %s\\n' "$(cat "$H/am/tmux-pid" 2>/dev/null || echo $$)" "$(cat "$H/am/tmux-session")"
};
getent() { printf 'fleet:x:%s:1::%s:/bin/bash\\n' "$2" "\${AM_STUB_HOME:-$HOME}"; };
timeout() { case "$1" in -*) return 125 ;; esac; shift; "$@"; };
`;

/** What `gh api -i` prints for classic protection: the status line, the headers (CRLF), a blank line, the body. */
export const amProt = (status: number, body: unknown, reason = ''): string =>
  `HTTP/2.0 ${status} ${reason}\nContent-Type: application/json; charset=utf-8\r\nX-Github-Request-Id: 1\r\n\r\n${typeof body === 'string' ? body : JSON.stringify(body)}\n`;
export const AM_PROT_NONE = amProt(404, { message: 'Branch not protected', status: '404' }, 'Not Found');

export const amCheckRun = (name: string, status = 'completed', conclusion: string | null = 'success', app: number | null = 15368): Record<string, unknown> =>
  ({ name, status, conclusion, app: app === null ? null : { id: app, slug: 'github-actions' } });

/** A value is a document (JSON-encoded), a string (the file's bytes, whatever they are) or `null` (NO route: gh answers
 *  nothing and rc 1, the read that "did not answer"). */
export interface AmOver {
  /** `GET /repos/owner-a/repo-a` */
  repo?: unknown;
  /** `gh pr view 42 …` */
  pr?: unknown;
  /** the fresh `gh pr view 42 --json headRefOid,baseRefName,reviewDecision,state,isDraft` just before the merge; default: \`pr\`'s answer */
  fresh?: unknown;
  /** the read-back after the merge (\`--json state,headRefOid,mergeCommit\`); default: MERGED at HEAD_A with MERGE_OID */
  readback?: unknown;
  /** the stderr \`gh pr merge\` prints when it fails (rc 1); absent: the merge succeeds with no output */
  mergeFail?: string;
  /** the base's rules, pages concatenated as `gh --paginate` prints them; default: one required_status_checks rule over `required` */
  rules?: unknown;
  /** the required contexts of the default rules document (a string, or an {context, integration_id} object) */
  required?: Array<string | { context: string; integration_id?: number }>;
  /** GraphQL `mergeQueue(branch:)`; default: no queue */
  mq?: unknown;
  /** the whole text of `gh api -i …/protection`; default: 404 Branch not protected */
  protection?: string | null;
  /** `pulls/42/reviews`, one page; default none */
  reviews?: unknown;
  /** `compare/main...<head>`, read only under strict up-to-date; default: the head is 0 commits behind */
  compare?: unknown;
  /** `check_runs` of the head; default: one successful run per required context */
  runs?: unknown;
  /** `statuses` of the head; default none */
  statuses?: unknown;
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

const pick = <T>(over: T | undefined, dflt: unknown): unknown => (over === undefined ? dflt : over);

/** A green, eligible repository `owner-a/repo-a`: the identity is an admin, a merge commit is allowed, PR 42 is open at
 *  `HEAD_A` on base `main` with no queue, no protection, no review, and one required check `build` that passed. `over`
 *  replaces a document whole; `null` leaves its read unanswered. */
export function amFixture(h: PrHarness, over: AmOver = {}): void {
  fs.rmSync(path.join(h.home, 'am', 'routes'), { force: true });
  const route = (pattern: string, file: string, body: unknown): void => { if (body !== null) amRoute(h, pattern, file, body); };
  const required = over.required ?? ['build'];
  const names = required.map((r) => (typeof r === 'string' ? r : r.context));
  route('api repos/owner-a/repo-a', 'repo.json', pick(over.repo, {
    permissions: { admin: true }, allow_merge_commit: true, allow_squash_merge: true, allow_rebase_merge: false,
  }));
  const pr = pick(over.pr, {
    number: 42, state: 'OPEN', isDraft: false, headRefOid: HEAD_A, baseRefName: 'main', reviewDecision: '',
  });
  route('pr view 42 -R owner-a/repo-a --json state,isDraft,headRefOid,baseRefName,reviewDecision', 'pr.json', pr);
  route('pr view 42 -R owner-a/repo-a --json headRefOid,baseRefName,reviewDecision,state,isDraft', 'fresh.json', pick(over.fresh, pr));
  route('pr view 42 -R owner-a/repo-a --json state,headRefOid,mergeCommit', 'readback.json', pick(over.readback, {
    state: 'MERGED', headRefOid: HEAD_A, mergeCommit: { oid: MERGE_OID },
  }));
  route('pr merge 42 *', 'merge.out', '');
  fs.rmSync(path.join(h.home, 'am', 'merge-fail'), { force: true });
  if (over.mergeFail !== undefined) put(h, 'merge-fail', over.mergeFail);
  route('api --paginate repos/owner-a/repo-a/rules/branches/main', 'rules.json', pick(over.rules, [{
    type: 'required_status_checks', parameters: { required_status_checks: required.map((r) => (typeof r === 'string' ? { context: r } : r)) },
  }]));
  route('api graphql *', 'mq.json', pick(over.mq, { data: { repository: { mergeQueue: null } } }));
  if (over.protection !== null) amRoute(h, 'api -i repos/owner-a/repo-a/branches/main/protection', 'protection.txt', over.protection ?? AM_PROT_NONE);
  route(`api repos/owner-a/repo-a/compare/main...${HEAD_A}?per_page=1`, 'compare.json', pick(over.compare, { status: 'ahead', ahead_by: 1, behind_by: 0 }));
  route('api --paginate repos/owner-a/repo-a/pulls/42/reviews', 'reviews.json', pick(over.reviews, []));
  route(`api --paginate repos/owner-a/repo-a/commits/${HEAD_A}/check-runs?filter=latest`, 'runs.json',
    pick(over.runs, { total_count: names.length, check_runs: names.map((n) => amCheckRun(n)) }));
  route(`api --paginate repos/owner-a/repo-a/commits/${HEAD_A}/status`, 'status.json', pick(over.statuses, { state: 'success', statuses: [] }));
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
