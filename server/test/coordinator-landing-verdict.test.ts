// Landing-order wave 3e (spec 2026-09-23 §5.7): the coordinator lands a PR by the route the repository's own rules
// give, read fresh before each landing. `references/wave-lifecycle.md` §5b carries ONE fenced bash block, the landing
// verdict: it makes reads 1 to 5 with gh (read 1 including the PR's reviews) and prints exactly one line, a route with
// its method and `admin=never` (no route uses `--admin`), a wait, a red, a merged PR to prove, or a stop with its reason. It
// never merges.
//
// This file extracts that block and RUNS it, against a stub gh that answers fixture JSON per read, with one case per
// route and per stop the reads decide (§5.7.5). The fixture every case starts from is this repository as measured on
// 2026-10-21 (§5.7.7), which must still answer route Q. A comment is a request; a red suite is a mechanism: the skill's
// prose says what the coordinator does with each line, and this file is what holds the line itself in place.
//
// The stub is an executable `gh` first on PATH in a fixture HOME. It logs every argv and answers an argv it does not
// know with exit 90, so a block that reached for anything but its reads fails closed.
import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const wl = readFileSync(path.join(root, 'ccd/coordinator-skill/references/wave-lifecycle.md'), 'utf8');
const MARK = '# The landing verdict';
const blocks = [...wl.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]!).filter((b) => b.includes(MARK));

const HC = 'c0ffee'.padEnd(40, '0');
const ACTIONS = { id: 15368, slug: 'github-actions' };
const OTHER_APP = { id: 999, slug: 'third-party-ci' };
const CLASSIC = ['test (server)', 'test (agent)', 'test (pwa)', 'build-pwa'];

/** One gh answer. `raw` is written as is; otherwise `body` is JSON. A code other than 200 makes gh exit 1, as gh does
 *  on any non-2xx, with GitHub's error body on stdout (measured: gh prints it there and its message on stderr). `exit` is
 *  gh's own exit status, a second dimension independent of the HTTP code: left out it is derived from the code as above
 *  (200 exits 0, anything else 1), so every answer that does not name it is what it always was; given, it is written as it
 *  is, so a case can say "HTTP 200 on stdout, and gh exited 1". */
type Answer = { code: number; body?: unknown; raw?: string; exit?: number };
type Key = 'pr' | 'reviews' | 'rules' | 'protection' | 'branch' | 'repo' | 'compare' | 'checkruns' | 'status' | 'ruleset';
type Fixture = Partial<Record<Key, Answer | Answer[]>>;

const ok = (body: unknown): Answer => ({ code: 200, body });
const fail = (code: number, message = 'Server Error'): Answer => ({ code, body: { message, status: String(code) } });
const run = (name: string, conclusion: string | null = 'success', status = 'completed', app: unknown = ACTIONS) =>
  ({ name, status, conclusion: status === 'completed' ? conclusion : null, app, output: { text: 'x'.repeat(64) } });
const pages = (...ps: unknown[]): Answer => ({ code: 200, raw: ps.map((p) => JSON.stringify(p)).join('\n') });
const runs = (...rs: unknown[]): Answer => ok({ total_count: rs.length, check_runs: rs });

const CR_PAGE_1 = { total_count: 5, check_runs: [run('test (server)'), run('test (agent)'), run('map-build', 'failure')] };
const CR_PAGE_2 = { total_count: 5, check_runs: [run('test (pwa)'), run('build-pwa', 'skipped')] };

/** This repository on 2026-10-21 (§5.7.7): squash only, a queue rule merging by SQUASH, the four classic checks at
 *  one App id with `enforce_admins` on, no approval required, and a head with no commit status at all. */
const measured = (): Fixture => ({
  pr: ok({ baseRefName: 'main', headRefOid: HC, state: 'OPEN', reviewDecision: '' }),
  reviews: ok([]),
  rules: ok([
    { type: 'pull_request', ruleset_source_type: 'Repository', ruleset_id: 11, parameters: {
      required_approving_review_count: 0, allowed_merge_methods: ['merge', 'squash', 'rebase'] } },
    { type: 'merge_queue', ruleset_source_type: 'Repository', ruleset_id: 11, parameters: { merge_method: 'SQUASH' } },
  ]),
  protection: ok({
    required_status_checks: { strict: false, contexts: CLASSIC, checks: CLASSIC.map((c) => ({ context: c, app_id: 15368 })) },
    enforce_admins: { enabled: true },
    required_pull_request_reviews: { required_approving_review_count: 0 },
    required_linear_history: { enabled: false },
    required_signatures: { enabled: false },
  }),
  repo: ok({ allow_squash_merge: true, allow_merge_commit: false, allow_rebase_merge: false, allow_auto_merge: true,
    allow_update_branch: false }),
  // Two pages, as `--paginate` prints them, and a NON-required red beside the four required greens.
  checkruns: pages(CR_PAGE_1, CR_PAGE_2),
  status: ok({ state: 'pending', statuses: [] }),
});

/** No ruleset, no classic protection, every method allowed: the ungated repository. */
const bare = (): Fixture => ({
  ...measured(),
  rules: ok([]),
  protection: fail(404, 'Branch not protected'),
  repo: ok({ allow_squash_merge: true, allow_merge_commit: true, allow_rebase_merge: true, allow_auto_merge: false }),
  checkruns: runs(),
});

/** gh's `-i` output: the status line, headers ending in CRLF, a blank CRLF line, then the body (measured 2.45.0). */
const included = (a: Answer): string => a.raw ?? (`HTTP/2.0 ${a.code} X\nX-Github-Request-Id: 0\r\nX-Xss-Protection: 0\r\n\r\n`
  + JSON.stringify(a.body));

// The reviews and the two read 5 arms answer a call without --paginate with page 1 of the same fixture only (pages are
// one line each), as GitHub does, so a block that drops --paginate reads the first page and a case with its evidence on a
// later page goes red.
const STUB = `#!/bin/sh
first=
printf '%s\\n' "$*" >> "$FX/calls"
case "$*" in
  "pr view "*) k=pr ;;
  "api --paginate repos/{owner}/{repo}/pulls/"*/reviews) k=reviews ;;
  "api repos/{owner}/{repo}/pulls/"*/reviews) k=reviews; first=1 ;;
  "api --paginate repos/{owner}/{repo}/rules/branches/"*) k=rules ;;
  "api -i repos/{owner}/{repo}/branches/"*/protection) k=protection ;;
  "api repos/{owner}/{repo}/branches/"*) k=branch ;;
  "api repos/{owner}/{repo}") k=repo ;;
  "api repos/{owner}/{repo}/compare/"*) k=compare ;;
  "api --paginate repos/{owner}/{repo}/commits/"*/check-runs) k=checkruns ;;
  "api repos/{owner}/{repo}/commits/"*/check-runs) k=checkruns; first=1 ;;
  "api --paginate repos/{owner}/{repo}/commits/"*/status) k=status ;;
  "api repos/{owner}/{repo}/commits/"*/status) k=status; first=1 ;;
  "api repos/{owner}/{repo}/rulesets/"*) k=ruleset ;;
  *) echo "fixture gh: unexpected argv: $*" >&2; exit 90 ;;
esac
n=$(( $(cat "$FX/$k.n" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$FX/$k.n"
p="$FX/$k"; [ -f "$FX/$k.$n.out" ] && p="$FX/$k.$n"
[ -f "$p.out" ] || { echo "fixture gh: no answer for $k" >&2; exit 91; }
if [ -n "$first" ]; then head -n1 "$p.out"; else cat "$p.out"; fi
rc=$(cat "$p.rc")
[ "$rc" = 0 ] || echo "gh: fixture (HTTP $(cat "$p.code"))" >&2
exit "$rc"
`;

type Result = { out: string; calls: string[]; stderr: string; sleeps: string[] };

/** A virtual clock for the bounded wait. The block calls `sleep` by name, so a shell function of that name, defined in the
 *  shell that runs the block, logs the duration it was asked for to `$FX/sleeps`, moves bash's own `$SECONDS` forward by
 *  that many seconds and returns at once: no case waits in real time, and the time the block believes has passed is the sum
 *  of what it asked for plus the whole seconds the run really took (a small tick the cases are sized to ignore). A request
 *  that is not a positive whole number is logged as it is and ends the run, so a sleep of zero or less is a red case, not a
 *  loop. After the `$VS_LATE`th sleep every file `<read>.late.*` in `$FX` replaces the read's answer: the answer the read
 *  that follows the last sleep gets. */
const VIRTUAL_CLOCK = `sleep() {
  case "$1" in ''|*[!0-9]*|0) printf 'bad %s\n' "$1" >> "$FX/sleeps"; exit 97 ;; esac
  printf '%s\n' "$1" >> "$FX/sleeps"
  SECONDS=$((SECONDS + $1)); VS_N=$((\${VS_N:-0} + 1))
  [ "$VS_N" = "\${VS_LATE:-0}" ] || return 0
  for f in "$FX"/*.late.*; do [ -e "$f" ] && cp "$f" "\${f%.late.*}.\${f##*.}"; done
  return 0
}
`;

/** `homeFiles` are written into the fixture HOME before the run (a name relative to HOME, nested names allowed: their parent
 *  directories are created; then its content). HOME is also the block's working directory, so a relative name such as
 *  `.git/ccrc-cr-ignore` is a file in the block's cwd. The second
 *  argument is all the block sees besides PATH, HOME and the fixture directory, so a variable it does not name is unset.
 *  With `clock`, the block runs under the virtual clock above and `clock.late` holds the answers that replace the reads'
 *  once the `VS_LATE`th sleep (named in that second argument) has run. */
function verdict(fx: Fixture, env: Record<string, string> = {}, homeFiles: Record<string, string> = {},
  clock?: { late: Fixture }): Result {
  const home = mkTmp('ccrc-landing-verdict-');
  const bin = path.join(home, 'bin');
  const dir = path.join(home, 'fx');
  mkdirSync(bin, { recursive: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(bin, 'gh'), STUB, { mode: 0o755 });
  writeFileSync(path.join(dir, 'calls'), '');
  writeFileSync(path.join(dir, 'sleeps'), '');
  for (const [name, text] of Object.entries(homeFiles)) {
    mkdirSync(path.dirname(path.join(home, name)), { recursive: true });
    writeFileSync(path.join(home, name), text);
  }
  const put = (stem: string, k: Key, a: Answer): void => {
    writeFileSync(`${stem}.out`, k === 'protection' ? included(a) : (a.raw ?? JSON.stringify(a.body ?? null)));
    writeFileSync(`${stem}.rc`, String(a.exit ?? (a.code === 200 ? 0 : 1)));
    writeFileSync(`${stem}.code`, String(a.code));
  };
  for (const [k, v] of Object.entries(fx) as [Key, Answer | Answer[]][]) {
    const seq = Array.isArray(v) ? v : [v];
    seq.forEach((a, i) => put(path.join(dir, Array.isArray(v) && i < seq.length - 1 ? `${k}.${i + 1}` : k), k, a));
  }
  for (const [k, a] of Object.entries(clock?.late ?? {}) as [Key, Answer][]) put(path.join(dir, `${k}.late`), k, a);
  const script = (clock ? VIRTUAL_CLOCK : '') + blocks[0]!.replace(/<pr>/g, '42').replace(/<handoffCommit>/g, HC);
  const r = spawnSync('bash', ['-c', script], {
    cwd: home, encoding: 'utf8', timeout: 15000,
    env: { PATH: `${bin}:${process.env['PATH'] ?? ''}`, HOME: home, FX: dir, ...env },
  });
  const calls = readFileSync(path.join(dir, 'calls'), 'utf8').split('\n').filter(Boolean);
  const sleeps = readFileSync(path.join(dir, 'sleeps'), 'utf8').split('\n').filter(Boolean);
  return { out: r.stdout, calls, stderr: r.stderr, sleeps };
}

/** Each case: what changes from its starting fixture, and the ONE line the verdict must print. */
type Case = [name: string, fx: () => Fixture, line: string, env?: Record<string, string>];

const with_ = (base: () => Fixture, patch: Fixture | ((f: Fixture) => Fixture)) => (): Fixture => {
  const f = base();
  return typeof patch === 'function' ? patch(f) : { ...f, ...patch };
};
const rules = (...rs: unknown[]): Fixture => ({ rules: ok(rs) });
const pull = (params: Record<string, unknown>, id = 11) =>
  ({ type: 'pull_request', ruleset_id: id, parameters: { required_approving_review_count: 0, ...params } });
const queue = (method: string, id = 11) => ({ type: 'merge_queue', ruleset_id: id, parameters: { merge_method: method } });
const rsc = (checks: unknown[], id = 21, strict = false) => ({ type: 'required_status_checks', ruleset_id: id,
  parameters: { strict_required_status_checks_policy: strict, required_status_checks: checks } });
const settings = (squash: boolean, merge: boolean, rebase: boolean, auto = false): Fixture =>
  ({ repo: ok({ allow_squash_merge: squash, allow_merge_commit: merge, allow_rebase_merge: rebase, allow_auto_merge: auto }) });
const classicGreen = (): Answer => runs(...CLASSIC.map((c) => run(c)));
/** The configuration this repository had before its queue (§5.7.7, recorded in the wave 2 plan): a ruleset approval
 *  of one, the four classic checks binding an admin, classic approvals 0, auto-merge off. */
const preQueue = with_(measured, (f) => ({ ...f,
  ...rules(pull({ required_approving_review_count: 1 })), ...settings(true, false, false, false),
  pr: ok({ baseRefName: 'main', headRefOid: HC, state: 'OPEN', reviewDecision: 'REVIEW_REQUIRED' }),
  checkruns: classicGreen() }));
const thirdParty = with_(bare, { ...rules(pull({ allowed_merge_methods: ['merge'] }), rsc([{ context: 'ci/app', integration_id: 999 }])),
  ...settings(false, true, false), checkruns: runs(run('ci/app', 'success', 'completed', OTHER_APP)) });
/** A classic check named for no particular App (`app_id: -1`, "any source"), as the legacy contexts GitHub migrated. */
const classicAny = ok({ required_status_checks: { strict: false, contexts: ['legacy/ci'], checks: [{ context: 'legacy/ci', app_id: -1 }] },
  enforce_admins: { enabled: false }, required_linear_history: { enabled: false }, required_signatures: { enabled: false } });
const via3b = with_(bare, { protection: fail(403, 'Resource not accessible by integration'),
  branch: ok({ name: 'main', protection: { enabled: false } }), compare: ok({ behind_by: 0, ahead_by: 1 }) });
/** The one line a direct route prints when an approval it needs is missing (spec §11, the amendment of 2026-10-25, ruling 5:
 *  no route uses `--admin`, so such a merge could only be refused or pass over the approval by a bypass nobody granted). */
const approvalMissing = (route: 'G' | 'U'): string =>
  `STOP approval-missing: route ${route} needs an approval the fleet cannot give, and --admin is never used`;

const ROUTES: Case[] = [
  ['route Q: this repository as measured (§5.7.7), the four classic checks gating the enqueue', measured,
    'ROUTE Q method=squash admin=never strict=no'],
  ['route Q: a paginated rules answer printed as two arrays is still one rule set',
    with_(measured, { rules: { code: 200, raw: JSON.stringify([pull({})]) + JSON.stringify([queue('SQUASH')]) } }),
    'ROUTE Q method=squash admin=never strict=no'],
  ['route G: merge commits only and a third-party App check in a ruleset (the motivating repository)', thirdParty,
    'ROUTE G method=merge admin=never strict=no'],
  ['route G: the pre-queue configuration stops approval-missing, since no route uses --admin (§5.7.7)', preQueue,
    approvalMissing('G')],
  ['route G: an approval that is given is not missing, so the route stands', with_(preQueue, (f) => ({ ...f,
    pr: ok({ baseRefName: 'main', headRefOid: HC, state: 'OPEN', reviewDecision: 'APPROVED' }) })),
    'ROUTE G method=squash admin=never strict=no'],
  ['route G: another gate (a required workflow) and no required check', with_(bare, rules({ type: 'workflows', ruleset_id: 5, parameters: {} })),
    'ROUTE G method=squash admin=never strict=no'],
  ['route G: a strict ruleset makes the repository strict-protection',
    with_(bare, { ...rules(rsc([{ context: 'build-pwa' }], 21, true)), checkruns: runs(run('build-pwa')) }),
    'ROUTE G method=squash admin=never strict=yes'],
  ['route G: a legacy context no App is named for passes on a commit status', with_(bare, {
    protection: ok({ required_status_checks: { strict: false, contexts: ['legacy/ci'], checks: [{ context: 'legacy/ci', app_id: null }] },
      enforce_admins: { enabled: false }, required_linear_history: { enabled: false }, required_signatures: { enabled: false } }),
    status: ok({ state: 'success', statuses: [{ context: 'legacy/ci', state: 'success' }] }) }),
    'ROUTE G method=squash admin=never strict=no'],
  ['route G: classic protection alone makes the repository strict-protection', with_(bare, {
    protection: ok({ required_status_checks: { strict: true, contexts: ['build-pwa'], checks: [{ context: 'build-pwa', app_id: 15368 }] },
      enforce_admins: { enabled: true }, required_linear_history: { enabled: false }, required_signatures: { enabled: false } }),
    checkruns: runs(run('build-pwa')) }), 'ROUTE G method=squash admin=never strict=yes'],
  ['route G: a classic check that names no App (app_id -1) passes on a commit status', with_(bare, {
    protection: classicAny, status: ok({ state: 'success', statuses: [{ context: 'legacy/ci', state: 'success' }] }) }),
    'ROUTE G method=squash admin=never strict=no'],
  ['route G: a classic check that names no App (app_id -1) passes on a check run from any App', with_(bare, {
    protection: classicAny, checkruns: runs(run('legacy/ci', 'success', 'completed', OTHER_APP)) }),
    'ROUTE G method=squash admin=never strict=no'],
  ['route U: an approval kept in classic protection alone, with enforce_admins on, stops approval-missing (Pre-flight 10(c))', with_(bare, {
    protection: ok({ enforce_admins: { enabled: true }, required_pull_request_reviews: { required_approving_review_count: 1 },
      required_linear_history: { enabled: false }, required_signatures: { enabled: false } }),
    pr: ok({ baseRefName: 'main', headRefOid: HC, state: 'OPEN', reviewDecision: 'REVIEW_REQUIRED' }) }),
    approvalMissing('U')],
  ['route G: an approval is required and the reviewDecision is empty: it is not APPROVED, so approval-missing', with_(preQueue, (f) => ({ ...f,
    pr: ok({ baseRefName: 'main', headRefOid: HC, state: 'OPEN', reviewDecision: '' }) })),
    approvalMissing('G')],
  ['route G: an approval is required and the reviewDecision is null: it is not APPROVED, so approval-missing', with_(preQueue, (f) => ({ ...f,
    pr: ok({ baseRefName: 'main', headRefOid: HC, state: 'OPEN', reviewDecision: null }) })),
    approvalMissing('G')],
  ['route G: an approval is required and the reviewDecision is a word the block does not list: it is not APPROVED, so approval-missing',
    with_(preQueue, (f) => ({ ...f, pr: ok({ baseRefName: 'main', headRefOid: HC, state: 'OPEN', reviewDecision: 'SOMETHING_NEW' }) })),
    approvalMissing('G')],
  ['route G under read 3b: the check set from the branch view, strictness unknown', with_(via3b, {
    branch: ok({ name: 'main', protection: { enabled: true, required_status_checks: { enforcement_level: 'everyone',
      contexts: ['build-pwa'], checks: [{ context: 'build-pwa', app_id: 15368 }] } } }), checkruns: runs(run('build-pwa')) }),
    'ROUTE G method=squash admin=never strict=unknown'],
  ['route U: no rule, branch not protected, nothing required, and nothing waits', bare,
    'ROUTE U method=squash admin=never strict=no'],
  ['route U: squash, then merge (§11 item 7), and a pull_request rule with no allowed_merge_methods allows all three',
    with_(bare, { ...rules(pull({})), ...settings(false, true, true) }), 'ROUTE U method=merge admin=never strict=no'],
  ['route U: EVERY pull_request rule narrows the set, not only the first',
    with_(bare, rules(pull({ allowed_merge_methods: ['squash', 'merge'] }, 1), pull({ allowed_merge_methods: ['merge'] }, 2))),
    'ROUTE U method=merge admin=never strict=no'],
  ['route U: a classic required_linear_history object that is not enabled removes nothing', with_(bare, {
    ...settings(false, true, false), protection: ok({ required_linear_history: { enabled: false }, enforce_admins: { enabled: true } }) }),
    'ROUTE U method=merge admin=never strict=no'],
  ['route U under read 3b: confirmed unprotected, head level with the base', via3b,
    'ROUTE U method=squash admin=never strict=unknown'],
  ['an already MERGED PR goes to the merge proof, not to a stop', with_(measured, {
    pr: ok({ baseRefName: 'main', headRefOid: HC, state: 'MERGED', reviewDecision: '' }) }), `MERGED head=${HC}`],
];

const CHECKS: Case[] = [
  ['a required check still running waits', with_(measured, { checkruns: runs(run('test (server)', null, 'in_progress'),
    run('test (agent)'), run('test (pwa)'), run('build-pwa')) }), 'WAIT pending: test (server)'],
  ['a required name that has not reported waits, though gh pr checks --required would exit 0 (measured 2026-10-22)',
    with_(measured, { checkruns: runs(run('test (agent)'), run('test (pwa)'), run('build-pwa')) }),
    'WAIT not-reported: test (server)'],
  ['a check run from another App does not satisfy a name pinned to the Actions App',
    with_(measured, { checkruns: runs(run('test (server)', 'success', 'completed', OTHER_APP), run('test (agent)'),
      run('test (pwa)'), run('build-pwa')) }), 'WAIT not-reported: test (server)'],
  ['a commit status pending on an unpinned context waits, though the combined state is never read', with_(bare, {
    ...rules(rsc([{ context: 'legacy/ci' }])), status: ok({ state: 'success', statuses: [{ context: 'legacy/ci', state: 'pending' }] }) }),
    'WAIT pending: legacy/ci'],
  ['a required Actions check red on the head', with_(measured, { checkruns: runs(run('test (server)', 'failure'),
    run('test (agent)'), run('test (pwa)'), run('build-pwa')) }), 'RED test (server) [github-actions]'],
  ['red is named before pending: one required name red and another still running prints RED', with_(measured, {
    checkruns: runs(run('test (server)', 'failure'), run('test (agent)', null, 'in_progress'), run('test (pwa)'), run('build-pwa')) }),
    'RED test (server) [github-actions]'],
  ['a required App check red on the head, which no rerun reaches', with_(thirdParty, {
    checkruns: runs(run('ci/app', 'action_required', 'completed', OTHER_APP)) }), 'RED ci/app [app 999]'],
  ['a required commit status in error', with_(bare, { ...rules(rsc([{ context: 'legacy/ci' }])),
    status: ok({ state: 'failure', statuses: [{ context: 'legacy/ci', state: 'error' }] }) }), 'RED legacy/ci [status]'],
  ['the bounded wait: a name that never reports within the bound is a stop',
    with_(measured, { checkruns: runs(run('test (agent)'), run('test (pwa)'), run('build-pwa')) }),
    'STOP not-reported: test (server) within 1s', { BOUND_S: '1', POLL_S: '1' }],
  ['the bounded wait: a name that reports within the bound is read again, and lands', with_(measured, (f) => ({ ...f,
    checkruns: [runs(run('test (agent)'), run('test (pwa)'), run('build-pwa')), classicGreen()] })),
    'ROUTE Q method=squash admin=never strict=no', { BOUND_S: '30', POLL_S: '1' }],
];

const STOPS: Case[] = [
  ['unreadable: read 1 fails', with_(measured, { pr: fail(502) }), 'STOP unreadable: read 1'],
  ['unreadable: read 2 is not a 200', with_(measured, { rules: fail(500) }), 'STOP unreadable: read 2'],
  ['unreadable: read 2 fails and prints nothing on stdout, which jq alone would slurp into an empty rule set',
    with_(measured, { rules: { code: 500, raw: '' } }), 'STOP unreadable: read 2'],
  ['unreadable: read 3 answers 404 Branch not found, the same status with another meaning',
    with_(measured, { protection: fail(404, 'Branch not found') }), 'STOP unreadable: read 3 answered 404'],
  ['unreadable: read 3 answers 404 Not Found', with_(measured, { protection: fail(404, 'Not Found') }),
    'STOP unreadable: read 3 answered 404'],
  ['unreadable: read 3 answers 500', with_(measured, { protection: fail(500) }), 'STOP unreadable: read 3 answered 500'],
  ['unreadable: read 3 does not answer at all', with_(measured, { protection: { code: 0, raw: '' } }),
    'STOP unreadable: read 3 answered nothing'],
  ['unreadable: read 3 answers 403 and read 3b fails', with_(via3b, { branch: fail(500) }),
    'STOP unreadable: read 3b, after read 3 answered 403'],
  ['unreadable: read 3b answers without protection.enabled, which is never read as unprotected',
    with_(via3b, { branch: ok({ name: 'main' }) }), 'STOP unreadable: read 3b, after read 3 answered 403'],
  ['unreadable: read 1 names a base outside the characters a branch path is read with', with_(measured, {
    pr: ok({ baseRefName: 'main?x=1', headRefOid: HC, state: 'OPEN', reviewDecision: '' }) }),
    'STOP unreadable: read 1 gave no usable base'],
  ['unreadable: read 4 is not a 200', with_(measured, { repo: fail(500) }), 'STOP unreadable: read 4'],
  ['unreadable: read 4 lacks a merge setting, which is never read as false', with_(measured, {
    repo: ok({ allow_squash_merge: true, allow_merge_commit: false, allow_rebase_merge: false }) }), 'STOP unreadable: read 4'],
  ['unreadable: read 5 check runs are not a 200', with_(measured, { checkruns: fail(500) }), 'STOP unreadable: read 5'],
  ['unreadable: read 5 statuses are not a 200', with_(measured, { status: fail(500) }), 'STOP unreadable: read 5'],
  ['unreadable: read 5 check runs fail and print nothing on stdout, which jq alone would slurp into no runs',
    with_(measured, { checkruns: { code: 500, raw: '' } }), 'STOP unreadable: read 5'],
  ['unreadable: read 5 statuses fail and print nothing on stdout, which jq alone would slurp into no statuses',
    with_(measured, { status: { code: 500, raw: '' } }), 'STOP unreadable: read 5'],
  ['read 3b leaves the route unknowable: the method is merge', with_(via3b, settings(false, true, false)),
    'STOP read-3b-unknowable: read 3 answered 403 and the method is merge'],
  ['read 3b leaves the route unknowable: the head is behind the base', with_(via3b, { compare: ok({ behind_by: 2 }) }),
    'STOP read-3b-unknowable: read 3 answered 403 and the head is 2 behind the base'],
  ['read 3b: a ruleset approval is required and missing, so the direct route stops approval-missing', with_(via3b, (f) => ({ ...f,
    ...rules(pull({ required_approving_review_count: 1 })),
    pr: ok({ baseRefName: 'main', headRefOid: HC, state: 'OPEN', reviewDecision: 'REVIEW_REQUIRED' }) })),
    approvalMissing('U')],
  ['the PR is not at the reviewed head', with_(measured, {
    pr: ok({ baseRefName: 'main', headRefOid: 'f'.repeat(40), state: 'OPEN', reviewDecision: '' }) }),
    `STOP not-at-head: the PR head is ${'f'.repeat(40)}`],
  ['the PR is CLOSED', with_(measured, { pr: ok({ baseRefName: 'main', headRefOid: HC, state: 'CLOSED', reviewDecision: '' }) }),
    'STOP not-at-head: the PR is CLOSED'],
  ['an unknown rule type', with_(measured, (f) => ({ ...f, ...rules(pull({}), queue('SQUASH'),
    { type: 'file_path_restriction', ruleset_id: 3, parameters: {} }) })), 'STOP unknown-rule-type: file_path_restriction'],
  ['the method set is empty: the settings and a pull_request rule share nothing',
    with_(bare, { ...rules(pull({ allowed_merge_methods: ['merge'] })), ...settings(true, false, false) }),
    'STOP method-set-empty: the settings, the pull_request rules and linear history leave none'],
  ['the method set is empty: a ruleset requires linear history over merge commits only',
    with_(bare, { ...rules({ type: 'required_linear_history', ruleset_id: 4 }), ...settings(false, true, false) }),
    'STOP method-set-empty: the settings, the pull_request rules and linear history leave none'],
  ['the method set is empty: classic protection requires linear history over merge commits only', with_(bare, {
    ...settings(false, true, false), protection: ok({ required_linear_history: { enabled: true }, enforce_admins: { enabled: true } }) }),
    'STOP method-set-empty: the settings, the pull_request rules and linear history leave none'],
  ['rebase is the only method (§11 item 8)', with_(bare, settings(false, false, true)),
    'STOP rebase-only: rebase is the only method left'],
  ['the queue method is not allowed', with_(measured, (f) => ({ ...f, ...rules(pull({}), queue('MERGE')) })),
    'STOP queue-method-not-allowed: the queue merges by merge and the method set is ["squash"]'],
  ['two queue methods', with_(measured, (f) => ({ ...f, ...rules(pull({}), queue('SQUASH', 11), queue('MERGE', 12)) })),
    'STOP two-queue-methods: merge,squash'],
  ['auto-merge is off under a queue rule (a precaution, §5.7.5)', with_(measured, settings(true, false, false, false)),
    'STOP auto-merge-off: a merge_queue rule applies'],
  ['a required check cannot be verified: a name pinned to an App shows only as a commit status', with_(measured, {
    checkruns: runs(run('test (agent)'), run('test (pwa)'), run('build-pwa')),
    status: ok({ state: 'success', statuses: [{ context: 'test (server)', state: 'success' }] }) }),
    'STOP unverifiable: test (server) shows only as a commit status'],
  ['approval-missing: another gate (code scanning) applies: the stop is the same', with_(preQueue, (f) => ({ ...f,
    ...rules(pull({ required_approving_review_count: 1 }), { type: 'code_scanning', ruleset_id: 9, parameters: {} }) })),
    approvalMissing('G')],
  ['approval-missing: classic signatures are another gate: the stop is the same', with_(preQueue, (f) => ({ ...f,
    protection: ok({ ...(measured().protection as Answer).body as object, required_signatures: { enabled: true } }) })),
    approvalMissing('G')],
  ['approval-missing: enforce_admins is off over the classic checks: the stop is the same', with_(preQueue, (f) => ({ ...f,
    protection: ok({ ...(measured().protection as Answer).body as object, enforce_admins: { enabled: false } }) })),
    approvalMissing('G')],
  ['approval-missing: a ruleset requires review threads resolved: the stop is the same', with_(preQueue, (f) => ({ ...f,
    ...rules(pull({ required_approving_review_count: 1, required_review_thread_resolution: true })) })),
    approvalMissing('G')],
  ['approval-missing: classic conversation resolution without enforce_admins: the stop is the same', with_(preQueue, (f) => ({ ...f,
    protection: ok({ required_conversation_resolution: { enabled: true }, enforce_admins: { enabled: false },
      required_linear_history: { enabled: false }, required_signatures: { enabled: false } }) })),
    approvalMissing('U')],
];

/** What read 6 used to weigh: an approval missing beside a ruleset that carries a required check. Read 6 is gone, so nothing asks
 *  the ruleset anything and the line is the approval check's alone. */
const APPROVAL_WITH_RULESET: Case = ['route G: an approval is missing beside a ruleset that carries required checks: approval-missing, no ruleset is asked',
  with_(preQueue, (f) => ({ ...f,
    ...rules(pull({ required_approving_review_count: 1 }), rsc([{ context: 'build-pwa', integration_id: 15368 }], 21)),
    ruleset: ok({ id: 21, current_user_can_bypass: 'never' }) })), approvalMissing('G')];

// ---- Requested changes on every route, and the operator's bounded ignore (fix round 1) ----
// The shapes: a PR with a decision word, reviews with ids and users, the key the stop prints.
const prWith = (decision: string | null, extra: Record<string, unknown> = {}): Answer =>
  ok({ baseRefName: 'main', headRefOid: HC, state: 'OPEN', reviewDecision: decision, ...extra });
const CR = 'CHANGES_REQUESTED';
const rev = (id: number, state: string, user: number | null = 1): Record<string, unknown> =>
  ({ id, state, user: user === null ? null : { id: user, login: 'reviewer-a' } });
/** A review as GitHub shapes it: every field a real answer carries, a long free-text body, the author's login and links. */
const fullReview = (id: number, state: string, user: number, bodyLen: number): Record<string, unknown> => ({
  id, node_id: `PRR_${id}`, state, body: 'x'.repeat(bodyLen), commit_id: HC, submitted_at: '2026-10-22T10:00:00Z',
  author_association: 'MEMBER', html_url: `https://example.test/o/r/pull/42#pullrequestreview-${id}`,
  pull_request_url: 'https://example.test/api/o/r/pulls/42', _links: { html: { href: 'https://example.test/x' } },
  user: { login: 'reviewer-a', id: user, node_id: `U_${user}`, avatar_url: 'https://example.test/a.png', type: 'User', site_admin: false },
});
const withReviews = (base: () => Fixture, decision: string | null, ...rs: unknown[]) =>
  with_(base, { pr: prWith(decision), reviews: ok(rs) });
/** The key the stop prints and CR_IGNORE must equal: this field order, these types, compact (`pr` and `head` strings). */
const keyOf = (summary: boolean, ...ids: number[]): string => JSON.stringify({ pr: '42', head: HC, summary, reviews: ids });
const askLine = (summary: boolean, ...ids: number[]): string =>
  `STOP changes-requested: operator decision required; key=${keyOf(summary, ...ids)}`;
const gStop = 'STOP unreadable: read 1\'s reviews';
const GOOD_Q = 'ROUTE Q method=squash admin=never strict=no';

/** One route per row: its fixture with a required approving review count of zero, then of one, and the route's line. */
const routeFixtures: [string, () => Fixture, () => Fixture, string][] = [
  ['Q', measured, with_(measured, (f) => ({ ...f, ...rules(pull({ required_approving_review_count: 1 }), queue('SQUASH')) })), GOOD_Q],
  ['G', thirdParty, with_(thirdParty, (f) => ({ ...f,
    ...rules(pull({ allowed_merge_methods: ['merge'], required_approving_review_count: 1 }), rsc([{ context: 'ci/app', integration_id: 999 }])) })),
    'ROUTE G method=merge admin=never strict=no'],
  ['U', bare, with_(bare, { protection: ok({ enforce_admins: { enabled: true }, required_pull_request_reviews: { required_approving_review_count: 1 },
    required_linear_history: { enabled: false }, required_signatures: { enabled: false } }) }),
    'ROUTE U method=squash admin=never strict=no'],
];

/** The entry of `routeFixtures` for a route letter, and a loud failure when there is none, so a reordered table cannot silently
 *  test another route. */
const routeFixture = (letter: string): [string, () => Fixture, () => Fixture, string] => {
  const e = routeFixtures.find(([r]) => r === letter);
  if (!e) throw new Error(`routeFixtures has no entry for route ${letter}`);
  return e;
};

const REQUESTS: Case[] = [
  ...routeFixtures.flatMap(([route, zero, positive]): Case[] => [
    [`route ${route}: no approval is required and the summary says changes are requested: the early stop, whatever the route`,
      with_(zero, { pr: prWith(CR) }), askLine(true)],
    [`route ${route}: an approval is required and the summary says changes are requested: the same stop`,
      with_(positive, { pr: prWith(CR) }), askLine(true)],
    [`route ${route}: no approval is required and a review in the list requests changes, with an empty summary`,
      with_(zero, { reviews: ok([rev(7, CR)]) }), askLine(false, 7)],
    [`route ${route}: an approval is required, REVIEW_REQUIRED, and a review in the list requests changes`,
      with_(positive, { pr: prWith('REVIEW_REQUIRED'), reviews: ok([rev(7, CR)]) }), askLine(false, 7)],
  ]),
  ['the summary and the list both say it: the key carries both', withReviews(measured, CR, rev(7, CR)), askLine(true, 7)],
  ['the summary says APPROVED but a review in the list requests changes: the list decides', withReviews(measured, 'APPROVED',
    rev(1, 'APPROVED', 1), rev(2, CR, 2)), askLine(false, 2)],
  ['a deleted account\'s request is not cleared by a user whose id equals its review id', withReviews(measured, '',
    rev(5, CR, null), rev(6, 'APPROVED', 5)), askLine(false, 5)],
  ['a later approval by the same user clears an earlier request', withReviews(measured, '', rev(1, CR), rev(2, 'APPROVED')), GOOD_Q],
  ['a later dismissal by the same user clears an earlier request', withReviews(measured, '', rev(1, CR), rev(2, 'DISMISSED')), GOOD_Q],
  ['a later request by the same user replaces an earlier approval', withReviews(measured, '', rev(1, 'APPROVED'), rev(2, CR)),
    askLine(false, 2)],
  ['a later COMMENTED review does not clear a request', withReviews(measured, '', rev(1, CR), rev(2, 'COMMENTED')), askLine(false, 1)],
  ['a later PENDING review does not clear a request', withReviews(measured, '', rev(1, CR), rev(2, 'PENDING')), askLine(false, 1)],
  ['COMMENTED and PENDING together do not clear a request either',
    withReviews(measured, '', rev(1, CR), rev(2, 'COMMENTED'), rev(3, 'PENDING')), askLine(false, 1)],
  ['a comment-only review by another user clears nothing', withReviews(measured, '', rev(1, CR, 1), rev(2, 'COMMENTED', 2)), askLine(false, 1)],
  ['two users: one approved and the other requests, the request stands', withReviews(measured, '', rev(1, 'APPROVED', 1), rev(2, CR, 2)),
    askLine(false, 2)],
  ['two users: one requests and the other approves, the other user\'s approval clears nothing',
    withReviews(measured, '', rev(1, CR, 1), rev(2, 'APPROVED', 2)), askLine(false, 1)],
  ['null users never clear each other: a deleted account\'s approval is its own identity', withReviews(measured, '',
    rev(5, CR, null), rev(6, 'APPROVED', null)), askLine(false, 5)],
  ['null users: two deleted accounts\' requests both stand, sorted', withReviews(measured, '', rev(9, CR, null), rev(3, CR, null)),
    askLine(false, 3, 9)],
  ['a review with no user key at all reads as a null user, keyed by its review id',
    withReviews(measured, '', { id: 4, state: CR }, rev(5, 'APPROVED', null)), askLine(false, 4)],
  ['the request ids are sorted numerically, not as text', withReviews(measured, '', rev(10, CR, 1), rev(9, CR, 2)), askLine(false, 9, 10)],
  ['one user\'s repeated request counts once, at the latest review', withReviews(measured, '', rev(3, CR, 1), rev(4, CR, 1)), askLine(false, 4)],
  ['reviews: every page is read: a request on page 2 stands', with_(measured, { reviews: pages([rev(1, 'APPROVED', 2)], [rev(2, CR, 1)]) }),
    askLine(false, 2)],
  ['reviews: every page is read: an approval on page 2 clears a request on page 1',
    with_(measured, { reviews: pages([rev(1, CR, 1)], [rev(2, 'APPROVED', 1)]) }), GOOD_Q],
  ['reviews: an entry whose user is a deleted account (user null) is valid', withReviews(measured, '', rev(1, 'COMMENTED', null)), GOOD_Q],
  ['the early stop comes before a red required check', with_(measured, { reviews: ok([rev(7, CR)]), checkruns: runs(run('test (server)', 'failure'),
    run('test (agent)'), run('test (pwa)'), run('build-pwa')) }), askLine(false, 7)],
  ['the early stop comes before a pending required check', with_(measured, { reviews: ok([rev(7, CR)]), checkruns: runs(run('test (server)', null, 'in_progress'),
    run('test (agent)'), run('test (pwa)'), run('build-pwa')) }), askLine(false, 7)],
  ['the early stop comes before an unknown rule type', with_(measured, (f) => ({ ...f, reviews: ok([rev(7, CR)]),
    ...rules(pull({}), queue('SQUASH'), { type: 'file_path_restriction', ruleset_id: 3, parameters: {} }) })), askLine(false, 7)],
  ['the early stop comes before the approval is weighed under read 3b, so it is not approval-missing',
    with_(via3b, (f) => ({ ...f, ...rules(pull({ required_approving_review_count: 1 })), pr: prWith(CR) })), askLine(true)],
  ['the early stop comes before the approval is weighed: another gate does not turn it into approval-missing',
    with_(preQueue, (f) => ({ ...f, ...rules(pull({ required_approving_review_count: 1 }), { type: 'code_scanning', ruleset_id: 9, parameters: {} }),
      pr: prWith(CR) })), askLine(true)],
  ['an already MERGED PR goes to its proof even with a request standing', with_(measured, { pr: prWith(CR, { state: 'MERGED' }),
    reviews: ok([rev(7, CR)]) }), `MERGED head=${HC}`],
  ['a head that is not handoffCommit stops on the head, not on a request', with_(measured, { pr: ok({ baseRefName: 'main',
    headRefOid: 'f'.repeat(40), state: 'OPEN', reviewDecision: CR }), reviews: ok([rev(7, CR)]) }),
    `STOP not-at-head: the PR head is ${'f'.repeat(40)}`],
  // Unreadable reviews are never folded into "no requests".
  // Real-sized answers: GitHub-shaped entries carry a login, a long body and links, and the block must keep only what it
  // reads, or the whole answer lands in one argument and Linux refuses an argument over 128 KiB.
  ['reviews: about a hundred full-size reviews (login, 1.5 KB body, links) are still read', with_(measured, { reviews:
    ok(Array.from({ length: 100 }, (_, i) => fullReview(i + 1, 'APPROVED', i + 1, 1500))) }), GOOD_Q],
  ['reviews: one 140 KB review body is still read', with_(measured, { reviews: ok([fullReview(1, 'APPROVED', 1, 140000)]) }), GOOD_Q],
  ['reviews: full-size reviews still show a request among them', with_(measured, { reviews:
    ok([...Array.from({ length: 99 }, (_, i) => fullReview(i + 1, 'APPROVED', i + 1, 1500)), fullReview(100, CR, 200, 1500)]) }),
    askLine(false, 100)],
  ['reviews: gh fails', with_(measured, { reviews: fail(502) }), gStop],
  ['reviews: gh exits 0 with empty stdout, which jq alone slurps into no pages', with_(measured, { reviews: { code: 200, raw: '' } }), gStop],
  ['reviews: gh fails with empty stdout', with_(measured, { reviews: { code: 500, raw: '' } }), gStop],
  ['reviews: a page that is an object, not an array', with_(measured, { reviews: { code: 200, raw: '{"message":"x"}' } }), gStop],
  ['reviews: a page that is null', with_(measured, { reviews: { code: 200, raw: 'null' } }), gStop],
  ['reviews: a single page that is an object whose values are reviews, not an array of them',
    with_(measured, { reviews: { code: 200, raw: JSON.stringify({ a: rev(1, 'APPROVED') }) } }), gStop],
  ['reviews: page 2 is malformed under a good page 1', with_(measured, { reviews: pages([rev(1, 'APPROVED')], 'x') }), gStop],
  ['reviews: an unknown state', withReviews(measured, '', rev(1, 'WEIRD')), gStop],
  ['reviews: a missing state', withReviews(measured, '', { id: 1, user: { id: 1 } }), gStop],
  ['reviews: an entry that is not an object', withReviews(measured, '', 7), gStop],
  ['reviews: a missing id', withReviews(measured, '', { state: 'APPROVED', user: { id: 1 } }), gStop],
  ['reviews: an id of zero', withReviews(measured, '', rev(0, 'APPROVED')), gStop],
  ['reviews: a negative id', withReviews(measured, '', rev(-3, 'APPROVED')), gStop],
  ['reviews: a fractional id', withReviews(measured, '', rev(1.5, 'APPROVED')), gStop],
  ['reviews: an id that is a string', withReviews(measured, '', { ...rev(1, 'APPROVED'), id: '1' }), gStop],
  ['reviews: an id beyond the safe integers', withReviews(measured, '', { ...rev(1, 'APPROVED'), id: 2 ** 60 }), gStop],
  ['reviews: a user without an id', withReviews(measured, '', { id: 1, state: 'APPROVED', user: { login: 'reviewer-a' } }), gStop],
  ['reviews: a user id of zero', withReviews(measured, '', rev(1, 'APPROVED', 0)), gStop],
  ['reviews: a user that is not an object', withReviews(measured, '', { id: 1, state: 'APPROVED', user: 'reviewer-a' }), gStop],
  ['reviews: a malformed entry is unreadable even beside a clean summary', withReviews(measured, 'APPROVED', rev(0, CR)), gStop],
];

// API order is the source (fix round 2). GitHub lists a pull request's reviews oldest first, and the block follows that
// sequence: not review ids, not `submitted_at`. Each fixture lists ONE identity's reviews in the order the API supplies
// them, with ids and timestamps (all distinct) that disagree with it, and the expected opinion follows the sequence. The
// ids and times are synthetic and non-monotonic: they show the block does not sort, not that GitHub usually emits such ids.
const revAt = (id: number, state: string, at: string | null, user = 1): Record<string, unknown> => ({ ...rev(id, state, user), submitted_at: at });
const hour = (h: number): string => `2026-10-22T${String(h).padStart(2, '0')}:00:00Z`;
/** The two reviews of one identity, in API order, as [id, time]: the ids disagree with the API and the times agree, the ids
 *  agree and the times disagree, or both disagree. A sort by id reds on the first and third, a sort by time on the second
 *  and third, and a reversal on all three. */
const ORDERINGS: [string, [number, string], [number, string]][] = [
  ['ids against the API order, times with it', [30, hour(9)], [10, hour(12)]],
  ['times against the API order, ids with it', [10, hour(12)], [30, hour(9)]],
  ['ids and times both against the API order', [30, hour(12)], [10, hour(9)]],
];
const ORDER: Case[] = [
  ...ORDERINGS.flatMap(([how, a, b]): Case[] => [
    [`API order: a request, then an approval, clears it: ${how}`,
      with_(measured, { reviews: ok([revAt(a[0], CR, a[1]), revAt(b[0], 'APPROVED', b[1])]) }), GOOD_Q],
    [`API order: an approval, then a request, stands at the request: ${how}`,
      with_(measured, { reviews: ok([revAt(a[0], 'APPROVED', a[1]), revAt(b[0], CR, b[1])]) }), askLine(false, b[0])],
    [`API order across two pages: a request on page 1, an approval on page 2, clears it: ${how}`,
      with_(measured, { reviews: pages([revAt(a[0], CR, a[1])], [revAt(b[0], 'APPROVED', b[1])]) }), GOOD_Q],
    [`API order across two pages: an approval on page 1, a request on page 2, stands at the request: ${how}`,
      with_(measured, { reviews: pages([revAt(a[0], 'APPROVED', a[1])], [revAt(b[0], CR, b[1])]) }), askLine(false, b[0])],
  ]),
  ['API order: an opinion changed across three pages follows the sequence to its last, the smallest id and the earliest time',
    with_(measured, { reviews: pages([revAt(70, CR, hour(10))], [revAt(8, CR, hour(9)), revAt(80, 'COMMENTED', hour(8))],
      [revAt(2, 'APPROVED', hour(6))]) }), GOOD_Q],
  ['API order: a dismissal last in the sequence clears an earlier request though its id and time are the smallest',
    with_(measured, { reviews: ok([revAt(40, CR, hour(12)), revAt(5, 'DISMISSED', hour(9))]) }), GOOD_Q],
  ['API order: a COMMENTED review last in the sequence, with the smallest id and the earliest time, replaces nothing',
    with_(measured, { reviews: ok([revAt(40, CR, hour(12)), revAt(5, 'COMMENTED', hour(9))]) }), askLine(false, 40)],
  ['API order: a PENDING review (no timestamp, the smallest id) last in the sequence replaces nothing',
    with_(measured, { reviews: ok([revAt(60, 'APPROVED', hour(7)), revAt(9, CR, hour(8)), revAt(3, 'PENDING', null)]) }), askLine(false, 9)],
  ['API order: COMMENTED and PENDING after an approval, both smaller by id, leave the approval standing',
    with_(measured, { reviews: ok([revAt(9, CR, hour(7)), revAt(60, 'APPROVED', hour(8)), revAt(3, 'PENDING', null),
      revAt(2, 'COMMENTED', hour(5))]) }), GOOD_Q],
  ['API order is per identity: another reviewer\'s approval, later in the sequence, clears nothing of the first reviewer\'s request',
    with_(measured, { reviews: ok([revAt(30, CR, hour(9), 1), revAt(10, 'APPROVED', hour(12), 2)]) }), askLine(false, 30)],
];

const keyFor = (summary: boolean, ...ids: number[]) => ({ CR_IGNORE: keyOf(summary, ...ids) });

const IGNORES: Case[] = [
  ['ignore: the exact key permits route Q, admin never', withReviews(measured, '', rev(7, CR)), GOOD_Q, keyFor(false, 7)],
  ['ignore: the exact key permits route G, admin never', with_(thirdParty, { reviews: ok([rev(7, CR)]) }),
    'ROUTE G method=merge admin=never strict=no', keyFor(false, 7)],
  ['ignore: the exact key permits route U, admin never', with_(bare, { reviews: ok([rev(7, CR)]) }),
    'ROUTE U method=squash admin=never strict=no', keyFor(false, 7)],
  ['ignore: the exact key with the summary and the list both permits the landing', withReviews(measured, CR, rev(7, CR)), GOOD_Q, keyFor(true, 7)],
  ['ignore: a key for another PR stops again', withReviews(measured, '', rev(7, CR)), askLine(false, 7),
    { CR_IGNORE: JSON.stringify({ pr: '43', head: HC, summary: false, reviews: [7] }) }],
  ['ignore: a key for another head stops again', withReviews(measured, '', rev(7, CR)), askLine(false, 7),
    { CR_IGNORE: JSON.stringify({ pr: '42', head: 'f'.repeat(40), summary: false, reviews: [7] }) }],
  ['ignore: a new request the key omits stops again', withReviews(measured, '', rev(7, CR, 1), rev(8, CR, 2)), askLine(false, 7, 8),
    keyFor(false, 7)],
  ['ignore: a request replaced by a new id stops again', withReviews(measured, '', rev(8, CR)), askLine(false, 8), keyFor(false, 7)],
  ['ignore: a key naming a request that is gone stops again', withReviews(measured, '', rev(7, CR, 1)), askLine(false, 7), keyFor(false, 7, 8)],
  ['ignore: a changed summary stops again', withReviews(measured, CR, rev(7, CR)), askLine(true, 7), keyFor(false, 7)],
  ['ignore: a key whose summary the PR no longer has stops again', withReviews(measured, '', rev(7, CR)), askLine(false, 7), keyFor(true, 7)],
  ['ignore: a malformed key stops again', withReviews(measured, '', rev(7, CR)), askLine(false, 7), { CR_IGNORE: '{' }],
  ['ignore: a blank key stops again', withReviews(measured, '', rev(7, CR)), askLine(false, 7), { CR_IGNORE: '' }],
  ['ignore: a key with its fields in another order stops again', withReviews(measured, '', rev(7, CR)), askLine(false, 7),
    { CR_IGNORE: JSON.stringify({ head: HC, pr: '42', summary: false, reviews: [7] }) }],
  ['ignore: a key with a numeric pr stops again', withReviews(measured, '', rev(7, CR)), askLine(false, 7),
    { CR_IGNORE: JSON.stringify({ pr: 42, head: HC, summary: false, reviews: [7] }) }],
  ['ignore: a summary-only request has no identified review and cannot be skipped', with_(measured, { pr: prWith(CR) }), askLine(true),
    keyFor(true)],
  ['ignore: a matching key does not excuse unreadable reviews', with_(measured, { reviews: fail(502) }), gStop, keyFor(false, 7)],
  ['ignore: a key supplied with empty reviews stdout still stops unreadable', with_(measured, { reviews: { code: 200, raw: '' } }), gStop,
    keyFor(false)],
  ['ignore: REVIEW_REQUIRED, a request in the list, a required approval and the matching key still stop approval-missing',
    with_(preQueue, { reviews: ok([rev(7, CR)]) }), approvalMissing('G'), keyFor(false, 7)],
  ['ignore: the summary says changes requested, an approval is required, and the matching key still stops approval-missing',
    with_(preQueue, { pr: prWith(CR), reviews: ok([rev(7, CR)]) }), approvalMissing('G'), keyFor(true, 7)],
  ['ignore: a matching key does not bypass a red required check', with_(measured, { reviews: ok([rev(7, CR)]),
    checkruns: runs(run('test (server)', 'failure'), run('test (agent)'), run('test (pwa)'), run('build-pwa')) }),
    'RED test (server) [github-actions]', keyFor(false, 7)],
  ['ignore: a matching key does not bypass a pending required check', with_(measured, { reviews: ok([rev(7, CR)]),
    checkruns: runs(run('test (server)', null, 'in_progress'), run('test (agent)'), run('test (pwa)'), run('build-pwa')) }),
    'WAIT pending: test (server)', keyFor(false, 7)],
  ['ignore: a matching key does not bypass an unknown rule type', with_(measured, (f) => ({ ...f, reviews: ok([rev(7, CR)]),
    ...rules(pull({}), queue('SQUASH'), { type: 'file_path_restriction', ruleset_id: 3, parameters: {} }) })),
    'STOP unknown-rule-type: file_path_restriction', keyFor(false, 7)],
  ['ignore: a matching key does not bypass a method-set stop', with_(bare, { reviews: ok([rev(7, CR)]), ...settings(false, false, true) }),
    'STOP rebase-only: rebase is the only method left', keyFor(false, 7)],
  ['ignore: a matching key does not bypass a head that is not handoffCommit', with_(measured, { reviews: ok([rev(7, CR)]),
    pr: ok({ baseRefName: 'main', headRefOid: 'f'.repeat(40), state: 'OPEN', reviewDecision: '' }) }),
    `STOP not-at-head: the PR head is ${'f'.repeat(40)}`, keyFor(false, 7)],
  ['ignore: a matching key, a missing approval and another gate (code scanning) still stop approval-missing',
    with_(preQueue, (f) => ({ ...f, reviews: ok([rev(7, CR)]),
      ...rules(pull({ required_approving_review_count: 1 }), { type: 'code_scanning', ruleset_id: 9, parameters: {} }) })),
    approvalMissing('G'), keyFor(false, 7)],
];

// The approval check, its count half and its route-Q half.
const APPROVAL_CHECK: Case[] = [
  ['route U: no approval is required, the decision is REVIEW_REQUIRED and no request stands: no approval is counted missing and the route stands',
    with_(bare, { pr: prWith('REVIEW_REQUIRED') }), 'ROUTE U method=squash admin=never strict=no'],
  ['route Q: an approval is required and missing, REVIEW_REQUIRED, no request: the queue route is never stopped for it',
    with_(measured, (f) => ({ ...f, ...rules(pull({ required_approving_review_count: 1 }), queue('SQUASH')), pr: prWith('REVIEW_REQUIRED') })),
    GOOD_Q],
];

// Read 1's state, read 2's shape and read 3's body must be readable, not merely present.
const prot200 = (body: string): Answer => ({ code: 200, raw: `HTTP/2.0 200 X\nX-Github-Request-Id: 0\r\n\r\n${body}` });
const MALFORMED: Case[] = [
  ['unreadable: read 1 gives no state', with_(measured, { pr: ok({ baseRefName: 'main', headRefOid: HC, reviewDecision: '' }) }),
    'STOP unreadable: read 1'],
  ['unreadable: read 1 gives a null state', with_(measured, { pr: prWith('', { state: null }) }), 'STOP unreadable: read 1'],
  ['unreadable: read 1 gives a state this block does not list', with_(measured, { pr: prWith('', { state: 'DRAFT' }) }),
    'STOP unreadable: read 1'],
  ['unreadable: read 1 gives a lowercase state', with_(measured, { pr: prWith('', { state: 'open' }) }), 'STOP unreadable: read 1'],
  ['unreadable: read 1 gives an unknown state on a head that is not handoffCommit: the state is judged first',
    with_(measured, { pr: ok({ baseRefName: 'main', headRefOid: 'f'.repeat(40), state: 'WEIRD', reviewDecision: '' }) }), 'STOP unreadable: read 1'],
  ['unreadable: read 2 exits 0 with empty stdout', with_(measured, { rules: { code: 200, raw: '' } }), 'STOP unreadable: read 2'],
  ['unreadable: read 2 is a page that is null', with_(measured, { rules: { code: 200, raw: 'null' } }), 'STOP unreadable: read 2'],
  ['unreadable: read 2 is a page that is an object', with_(measured, { rules: { code: 200, raw: '{"message":"x"}' } }), 'STOP unreadable: read 2'],
  ['unreadable: read 2 has a page that is not an array beside a good one', with_(measured, { rules: { code: 200, raw: '[]\n7' } }),
    'STOP unreadable: read 2'],
  ['unreadable: read 2 is a single page that is an object whose values are rules, not an array of them',
    with_(measured, { rules: { code: 200, raw: JSON.stringify({ a: { type: 'deletion', ruleset_id: 3 } }) } }), 'STOP unreadable: read 2'],
  ['unreadable: read 2 has a rule with no type', with_(measured, { rules: ok([{ ruleset_id: 3, parameters: {} }]) }), 'STOP unreadable: read 2'],
  ['unreadable: read 2 has a rule whose type is null', with_(measured, { rules: ok([{ type: null, ruleset_id: 3 }]) }), 'STOP unreadable: read 2'],
  ['unreadable: read 2 has a rule whose type is not a string', with_(measured, { rules: ok([{ type: 7, ruleset_id: 3 }]) }),
    'STOP unreadable: read 2'],
  ['unreadable: read 2 has a rule that is not an object', with_(measured, { rules: ok(['pull_request']) }), 'STOP unreadable: read 2'],
  ['unreadable: read 2 has a pull_request rule with no parameters', with_(measured, { rules: ok([{ type: 'pull_request', ruleset_id: 3 }]) }),
    'STOP unreadable: read 2'],
  ['unreadable: read 2 has a merge_queue rule with null parameters', with_(measured, { rules: ok([{ type: 'merge_queue', ruleset_id: 3, parameters: null }]) }),
    'STOP unreadable: read 2'],
  ['unreadable: read 2 has a required_status_checks rule with no parameters', with_(measured, {
    rules: ok([{ type: 'required_status_checks', ruleset_id: 3 }]) }), 'STOP unreadable: read 2'],
  ['unreadable: read 2 has a required_status_checks rule whose list is missing', with_(measured, {
    rules: ok([{ type: 'required_status_checks', ruleset_id: 3, parameters: { strict_required_status_checks_policy: false } }]) }),
    'STOP unreadable: read 2'],
  ['unreadable: read 2 has a required_status_checks rule whose list is an object', with_(measured, {
    rules: ok([{ type: 'required_status_checks', ruleset_id: 3, parameters: { required_status_checks: { context: 'x' } } }]) }),
    'STOP unreadable: read 2'],
  ['an unknown string type beside well-formed rules is still unknown-rule-type', with_(measured, (f) => ({ ...f,
    ...rules(pull({}), queue('SQUASH'), { type: 'something_new', ruleset_id: 3 }) })), 'STOP unknown-rule-type: something_new'],
  ['a genuine empty rule set is no rules, not unreadable', with_(bare, rules()), 'ROUTE U method=squash admin=never strict=no'],
  ['unreadable: read 3 answers 200 with a null body', with_(measured, { protection: prot200('null') }), 'STOP unreadable: read 3'],
  ['unreadable: read 3 answers 200 with an array body', with_(measured, { protection: prot200('[]') }), 'STOP unreadable: read 3'],
  ['unreadable: read 3 answers 200 with a scalar body', with_(measured, { protection: prot200('7') }), 'STOP unreadable: read 3'],
  ['unreadable: read 3 answers 200 with a string body', with_(measured, { protection: prot200('"x"') }), 'STOP unreadable: read 3'],
  ['unreadable: read 3 answers 200 with an empty body', with_(measured, { protection: prot200('') }), 'STOP unreadable: read 3'],
  ['read 3 answers 200 with a sparse object body: still readable', with_(bare, { protection: prot200('{}') }),
    'ROUTE U method=squash admin=never strict=no'],
];

// ---- Fix round 2: the sources a verdict reads fail closed (read 5, the approval check's fields, the required-check entries) ----
// An empty answer is not an empty list. GitHub's real zero-result answer is an object whose array is empty, so a call
// that printed no page, a page that is not an object, a field that is not an array and an entry that is not an object
// are each `STOP unreadable: read 5`, never "no checks"; a genuine empty array is a successful zero-result answer.
const R5 = 'STOP unreadable: read 5';
const OTHER_STATUS = { context: 'other/ci', state: 'success' };
const raw200 = (text: string): Answer => ({ code: 200, raw: text });
type Source = { label: string; key: 'checkruns' | 'status'; field: string; entry: unknown; populated: Answer[]; emptyOnly: string;
  emptyAfter: Answer; emptyBefore: Answer };
const SOURCES: Source[] = [
  { label: 'check runs', key: 'checkruns', field: 'check_runs', entry: run('map-build'),
    populated: [pages(CR_PAGE_1, CR_PAGE_2)],
    emptyOnly: 'WAIT not-reported: build-pwa, test (agent), test (pwa), test (server)',
    emptyAfter: pages(CR_PAGE_1, CR_PAGE_2, { total_count: 5, check_runs: [] }),
    emptyBefore: pages({ total_count: 5, check_runs: [] }, CR_PAGE_1, CR_PAGE_2) },
  { label: 'statuses', key: 'status', field: 'statuses', entry: OTHER_STATUS,
    populated: [ok({ state: 'success', statuses: [OTHER_STATUS] })],
    emptyOnly: GOOD_Q,
    emptyAfter: pages({ state: 'success', statuses: [OTHER_STATUS] }, { state: 'success', statuses: [] }),
    emptyBefore: pages({ state: 'success', statuses: [] }, { state: 'success', statuses: [OTHER_STATUS] }) },
];
const READ5: Case[] = SOURCES.flatMap(({ label, key, field, entry, emptyOnly, emptyAfter, emptyBefore }): Case[] => {
  const on = (a: Answer): (() => Fixture) => with_(measured, { [key]: a } as Fixture);
  const goodPage = { total_count: 1, [field]: [entry] };
  const bad = (name: string, a: Answer): Case => [`unreadable: read 5 ${label}: ${name}`, on(a), R5];
  return [
    bad('gh exits 0 with empty stdout, which jq alone slurps into no pages', raw200('')),
    bad('gh fails but printed a good-looking page', { code: 500, raw: JSON.stringify(goodPage) }),
    bad('the answer is not JSON', raw200('{')),
    bad(`a page with no ${field}`, raw200('{"total_count":0}')),
    bad(`${field} is null`, raw200(JSON.stringify({ [field]: null }))),
    bad(`${field} is an empty object`, raw200(JSON.stringify({ [field]: {} }))),
    bad(`${field} is an object whose values are entries, not an array of them`, raw200(JSON.stringify({ [field]: { a: entry } }))),
    bad(`${field} is a number`, raw200(JSON.stringify({ [field]: 7 }))),
    bad(`${field} is a string`, raw200(JSON.stringify({ [field]: 'x' }))),
    bad(`${field} is a boolean`, raw200(JSON.stringify({ [field]: false }))),
    bad('a page that is null', raw200('null')),
    bad('a page that is an array', raw200('[]')),
    bad('a page that is an array of entries', raw200(JSON.stringify([entry]))),
    bad('a page that is a number', raw200('7')),
    bad('a page that is a string', raw200('"x"')),
    bad('page 2 has no field, under a good page 1', pages(goodPage, { total_count: 0 })),
    bad('page 2 is null, under a good page 1', pages(goodPage, null)),
    bad('page 2 is a string, under a good page 1', pages(goodPage, 'x')),
    bad(`page 2 has a null ${field}, under a good page 1`, pages(goodPage, { [field]: null })),
    bad(`page 2 has an object ${field}, under a good page 1`, pages(goodPage, { [field]: {} })),
    bad('page 2 is not JSON, under a good page 1', raw200(`${JSON.stringify(goodPage)}\n{`)),
    bad('an entry that is a number', raw200(JSON.stringify({ [field]: [7] }))),
    bad('an entry that is a string', raw200(JSON.stringify({ [field]: ['x'] }))),
    bad('an entry that is null', raw200(JSON.stringify({ [field]: [null] }))),
    bad('an entry that is an array', raw200(JSON.stringify({ [field]: [[]] }))),
    bad('an entry that is a boolean', raw200(JSON.stringify({ [field]: [true] }))),
    bad('an entry on page 2 that is null, beside good ones', pages(goodPage, { [field]: [entry, null] })),
    ...(key === 'checkruns' ? [bad('an app that is a string, which the projection of its id and slug cannot read',
      raw200(JSON.stringify({ check_runs: [run('test (server)', 'success', 'completed', 'github-actions')] })))] : []),
    [`read 5 ${label}: a genuine empty ${field} on its one page is a zero-result answer`,
      on(raw200(JSON.stringify({ total_count: 0, [field]: [] }))), emptyOnly],
    [`read 5 ${label}: an empty page after the populated ones adds nothing and is not unreadable`, on(emptyAfter), GOOD_Q],
    [`read 5 ${label}: an empty page before the populated ones is not unreadable either`, on(emptyBefore), GOOD_Q],
  ];
});

/** An unpinned required name with a green Actions run: the verdict can only see its red in the commit statuses. */
const unpinned = (status: Answer): (() => Fixture) => with_(bare, { ...rules(rsc([{ context: 'ci' }])), checkruns: runs(run('ci')), status });
/** A required name pinned to the Actions App, red on its check run: the verdict can only see it in the check runs. */
const pinnedRed = (checkruns: Answer): (() => Fixture) => with_(bare, { ...rules(rsc([{ context: 'ci', integration_id: 15368 }])), checkruns });
const failingStatus = ok({ state: 'failure', statuses: [{ context: 'ci', state: 'failure' }] });
const MIXED: Case[] = [
  ['read 5 control: an unpinned name green as a run and failing as a status is red, whichever source shows it', unpinned(failingStatus),
    'RED ci [github-actions]'],
  ['read 5: that red is not routed G when the statuses answer is empty on stdout, exit 0', unpinned(raw200('')), R5],
  ['read 5: that red is not routed G when the statuses are an object', unpinned(raw200(JSON.stringify({ state: 'failure', statuses: {} }))), R5],
  ['read 5: that red is not routed G when the statuses field is missing', unpinned(raw200(JSON.stringify({ state: 'failure' }))), R5],
  ['read 5 control: a pinned name red as a run is red', pinnedRed(runs(run('ci', 'failure'))), 'RED ci [github-actions]'],
  ['read 5: that red is not a wait when the check runs answer is empty on stdout, exit 0', pinnedRed(raw200('')), R5],
  ['read 5: that red is not a wait when the check runs are an object', pinnedRed(raw200(JSON.stringify({ check_runs: {} }))), R5],
  ['read 5: that red is not a wait when the check runs field is missing', pinnedRed(raw200('{"total_count":1}')), R5],
  ['read 5: a genuine empty check_runs with no report keeps its original not-reported meaning', pinnedRed(runs()), 'WAIT not-reported: ci'],
  ['read 5: a bounded wait whose second read is an empty answer from the check runs stops unreadable, not a loop or a timeout',
    with_(measured, { checkruns: [runs(run('test (agent)'), run('test (pwa)'), run('build-pwa')), raw200('')] }), R5,
    { BOUND_S: '30', POLL_S: '1' }],
  ['read 5: a bounded wait whose second read is an empty answer from the statuses stops unreadable',
    with_(measured, { checkruns: [runs(run('test (agent)'), run('test (pwa)'), run('build-pwa')), classicGreen()],
      status: [ok({ state: 'pending', statuses: [] }), raw200('')] }), R5, { BOUND_S: '30', POLL_S: '1' }],
];

// The approval check reads two numbers (the review counts). jq orders a string above every number, so a count of "0" would be
// an approval required; each field is typed at the read that owns it. The thread-resolution boolean is no longer read by any
// decision since ruling 5 retired the licence, and its type check stays: a malformed answer still stops, fail closed.
const countRule = (v: unknown, decision = 'REVIEW_REQUIRED'): (() => Fixture) =>
  with_(bare, { ...rules(pull({ required_approving_review_count: v })), pr: prWith(decision) });
const REJECTED_COUNTS: [string, unknown][] = [
  ['the string "0"', '0'], ['the string "1"', '1'], ['an empty string', ''], ['true', true], ['false', false], ['null', null],
  ['a negative integer', -1], ['a fraction', 1.5], ['one beyond the safe integers', 2 ** 53], ['a number far beyond them', 2 ** 60],
  ['an array', [1]], ['an object', {}],
];
const REJECTED_THREADS: [string, unknown][] = [
  ['the string "true"', 'true'], ['the string "false"', 'false'], ['the number 1', 1], ['the number 0', 0], ['null', null],
  ['an array', []], ['an object', {}],
];
const protWith = (reviews?: unknown): Answer => ok({ enforce_admins: { enabled: true }, required_linear_history: { enabled: false },
  required_signatures: { enabled: false }, ...(reviews === undefined ? {} : { required_pull_request_reviews: reviews }) });
const classicCount = (reviews?: unknown): (() => Fixture) => with_(bare, { protection: protWith(reviews), pr: prWith('REVIEW_REQUIRED') });
const FIELDS: Case[] = [
  ...REJECTED_COUNTS.flatMap(([what, v]): Case[] => [
    [`unreadable: read 2: a pull_request rule's required_approving_review_count is ${what}`, countRule(v), 'STOP unreadable: read 2'],
    [`unreadable: read 2: ${what} as the count is refused though a queue would avoid the approval check`,
      with_(measured, (f) => ({ ...f, ...rules(pull({ required_approving_review_count: v }), queue('SQUASH')) })), 'STOP unreadable: read 2'],
    [`unreadable: read 3: classic required_approving_review_count is ${what}`, classicCount({ required_approving_review_count: v }),
      'STOP unreadable: read 3'],
  ]),
  ...REJECTED_THREADS.flatMap(([what, v]): Case[] => [
    [`unreadable: read 2: required_review_thread_resolution is ${what}, beside an approval that is required`,
      with_(preQueue, rules(pull({ required_approving_review_count: 1, required_review_thread_resolution: v }))), 'STOP unreadable: read 2'],
    [`unreadable: read 2: required_review_thread_resolution is ${what}, where no approval is required`,
      with_(bare, rules(pull({ required_review_thread_resolution: v }))), 'STOP unreadable: read 2'],
  ]),
  ...[['a string', 'x'], ['an array', []], ['a number', 7], ['the boolean true', true], ['the boolean false', false], ['an empty string', ''],
    ['zero', 0]].map(([what, v]): Case =>
    [`unreadable: read 3: required_pull_request_reviews is ${what as string}, not an object`, classicCount(v), 'STOP unreadable: read 3']),
  ['unreadable: read 3: a non-object required_pull_request_reviews is refused on route Q too, where the approval is never weighed',
    with_(measured, (f) => ({ ...f, protection: ok({ ...(measured().protection as Answer).body as object, required_pull_request_reviews: [] }) })),
    'STOP unreadable: read 3'],
  // What stays valid: absence, zero, safe integers, booleans, and the sparse classic shapes.
  ['a count of 0 with REVIEW_REQUIRED requires no approval, so the route stands (read 2)', countRule(0), 'ROUTE U method=squash admin=never strict=no'],
  ['a missing count defaults to 0 and requires no approval, so the route stands (read 2)',
    with_(bare, { ...rules({ type: 'pull_request', ruleset_id: 11, parameters: {} }), pr: prWith('REVIEW_REQUIRED') }),
    'ROUTE U method=squash admin=never strict=no'],
  ['the largest safe integer is a count above 0: the approval is required and missing, so the stop is approval-missing (read 2)',
    with_(preQueue, rules(pull({ required_approving_review_count: 9007199254740991 }))), approvalMissing('G')],
  ['a boolean false thread resolution changes nothing: the stop is approval-missing (read 2)',
    with_(preQueue, rules(pull({ required_approving_review_count: 1, required_review_thread_resolution: false }))),
    approvalMissing('G')],
  ['a boolean true thread resolution changes nothing either: the stop is approval-missing (read 2)',
    with_(preQueue, rules(pull({ required_approving_review_count: 1, required_review_thread_resolution: true }))),
    approvalMissing('G')],
  ['classic required_pull_request_reviews absent: no classic review configuration', classicCount(), 'ROUTE U method=squash admin=never strict=no'],
  ['classic required_pull_request_reviews null: no classic review configuration', classicCount(null), 'ROUTE U method=squash admin=never strict=no'],
  ['classic required_pull_request_reviews an object without a count: a sparse shape stays valid', classicCount({}),
    'ROUTE U method=squash admin=never strict=no'],
  ['classic required_approving_review_count 0 requires no approval, so the route stands', classicCount({ required_approving_review_count: 0 }),
    'ROUTE U method=squash admin=never strict=no'],
  ['classic required_approving_review_count 2 is a missing approval: approval-missing', classicCount({ required_approving_review_count: 2 }),
    approvalMissing('U')],
];

// A required-check entry is a name. An entry that names nothing would become a requirement called null.
const BAD_CHECK_ENTRIES: [string, unknown][] = [
  ['null', null], ['an empty object', {}], ['an object with only an integration_id', { integration_id: 15368 }],
  ['a null context', { context: null }], ['an empty context', { context: '' }], ['a numeric context', { context: 7 }],
  ['an array context', { context: ['x'] }], ['an object context', { context: {} }], ['a boolean context', { context: true }],
  ['a string', 'x'], ['a number', 7], ['an array', []], ['a boolean', true],
];
const ENTRIES: Case[] = [
  ...BAD_CHECK_ENTRIES.map(([what, e]): Case => [`unreadable: read 2: a required_status_checks entry is ${what}`,
    with_(bare, rules(rsc([e]))), 'STOP unreadable: read 2']),
  // The list itself must be an array: iterated, an object would yield its values, and `{}` would yield no checks at all.
  ['unreadable: read 2: a required_status_checks list that is an empty object', with_(bare, rules(rsc({} as unknown as unknown[]))),
    'STOP unreadable: read 2'],
  ['unreadable: read 2: a required_status_checks list that is an object whose values are named entries, not a list of them',
    with_(bare, rules(rsc({ a: { context: 'build-pwa' } } as unknown as unknown[]))), 'STOP unreadable: read 2'],
  ['unreadable: read 2: a required_status_checks list that is null', with_(bare, rules(rsc(null as unknown as unknown[]))),
    'STOP unreadable: read 2'],
  ['unreadable: read 2: a required_status_checks list that is a string', with_(bare, rules(rsc('build-pwa' as unknown as unknown[]))),
    'STOP unreadable: read 2'],
  ['unreadable: read 2: a nameless entry after a good one is still refused', with_(bare, rules(rsc([{ context: 'build-pwa' }, null]))),
    'STOP unreadable: read 2'],
  ['unreadable: read 2: a nameless entry before a good one is still refused', with_(bare, rules(rsc([{}, { context: 'build-pwa' }]))),
    'STOP unreadable: read 2'],
  ['unreadable: read 2: a nameless entry in a second rule is still refused', with_(bare, rules(rsc([{ context: 'build-pwa' }], 21), rsc([null], 22))),
    'STOP unreadable: read 2'],
  ['a genuine empty required_status_checks list is no rule checks', with_(bare, rules(rsc([]))),
    'ROUTE U method=squash admin=never strict=no'],
  ['a context keeps its bytes, spaces included: the name is judged as written', with_(bare, {
    ...rules(rsc([{ context: ' padded name ' }])), checkruns: runs(run(' padded name ')) }), 'ROUTE G method=squash admin=never strict=no'],
  ['a context is not trimmed: a run under the trimmed name does not satisfy it', with_(bare, {
    ...rules(rsc([{ context: ' padded name ' }])), checkruns: runs(run('padded name')) }), 'WAIT not-reported:  padded name '],
];

// Classic protection's conversation-resolution switch, and the names of its required checks. No decision reads the switch
// any more (ruling 5 retired the licence that did), but a malformed one is still a stop: a string "true" is not a boolean,
// and the type check stays, fail closed. A nameless check becomes a requirement with an empty label, or is satisfied by a
// nameless status.
const classicBody = (extra: Record<string, unknown>, enforce = true): Answer => ok({ enforce_admins: { enabled: enforce },
  required_pull_request_reviews: { required_approving_review_count: 1 }, required_linear_history: { enabled: false },
  required_signatures: { enabled: false }, ...extra });
const convFx = (conv?: unknown, enforce = true): (() => Fixture) => with_(bare, { pr: prWith('REVIEW_REQUIRED'),
  protection: classicBody(conv === undefined ? {} : { required_conversation_resolution: conv }, enforce) });
const BAD_CONV: [string, unknown][] = [
  ['the string "true"', { enabled: 'true' }], ['the string "false"', { enabled: 'false' }], ['the number 1', { enabled: 1 }],
  ['the number 0', { enabled: 0 }], ['null', { enabled: null }], ['an array', { enabled: [] }], ['an object', { enabled: {} }],
];
const BAD_CONV_CONTAINERS: [string, unknown][] = [
  ['an array', []], ['a string', 'x'], ['a number', 7], ['the boolean true', true], ['the boolean false', false], ['zero', 0], ['an empty string', ''],
];
const CONV: Case[] = [
  ...BAD_CONV.flatMap(([what, v]): Case[] => [
    [`unreadable: read 3: required_conversation_resolution.enabled is ${what}, with enforce_admins on`, convFx(v, true), 'STOP unreadable: read 3'],
    [`unreadable: read 3: required_conversation_resolution.enabled is ${what}, with enforce_admins off`, convFx(v, false), 'STOP unreadable: read 3'],
  ]),
  ...BAD_CONV_CONTAINERS.map(([what, v]): Case => [`unreadable: read 3: required_conversation_resolution is ${what}, not an object`,
    convFx(v, false), 'STOP unreadable: read 3']),
  ['unreadable: read 3: a malformed conversation switch is refused on route Q too, where the approval is never weighed',
    with_(measured, (f) => ({ ...f, protection: ok({ ...(measured().protection as Answer).body as object,
      required_conversation_resolution: { enabled: 'true' } }) })), 'STOP unreadable: read 3'],
  ['classic required_conversation_resolution absent: the stop is approval-missing', convFx(undefined, false), approvalMissing('U')],
  ['classic required_conversation_resolution null: the stop is approval-missing', convFx(null, false), approvalMissing('U')],
  ['classic required_conversation_resolution an object without enabled: a sparse shape stays valid, and the stop is approval-missing',
    convFx({}, false), approvalMissing('U')],
  ['classic required_conversation_resolution false: the stop is approval-missing', convFx({ enabled: false }, false), approvalMissing('U')],
  ['classic required_conversation_resolution true with enforce_admins on: the stop is approval-missing', convFx({ enabled: true }, true),
    approvalMissing('U')],
  ['classic required_conversation_resolution true without enforce_admins: the stop is approval-missing, the switch is no longer read',
    convFx({ enabled: true }, false), approvalMissing('U')],
];

const classicChecks = (rsc: unknown, extra: Record<string, unknown> = {}): Answer => ok({ enforce_admins: { enabled: false },
  required_linear_history: { enabled: false }, required_signatures: { enabled: false },
  ...(rsc === undefined ? {} : { required_status_checks: rsc }), ...extra });
const classicFx = (rsc: unknown, status: Answer = ok({ state: 'pending', statuses: [] })): (() => Fixture) =>
  with_(bare, { protection: classicChecks(rsc), status });
const nameless = (state: string, context: unknown) => ok({ state, statuses: [{ context, state }] });
const BAD_CTX_ENTRIES: [string, unknown][] = [
  ['null', null], ['an empty string', ''], ['a number', 7], ['an array', []], ['an object', {}], ['the boolean true', true],
];
const BAD_CHECK_OBJECTS: [string, unknown][] = [
  ['null', null], ['an empty object', {}], ['an object with only an app_id', { app_id: 15368 }], ['a null context', { context: null }],
  ['an empty context', { context: '' }], ['a numeric context', { context: 7 }], ['an array context', { context: ['x'] }],
  ['an object context', { context: {} }], ['a string', 'x'], ['a number', 7], ['an array', []], ['the boolean true', true],
];
const BAD_LISTS: [string, unknown][] = [['an empty object', {}], ['an object holding named entries', { a: 'legacy/ci' }],
  ['a string', 'legacy/ci'], ['a number', 7], ['the boolean true', true]];
const R3 = 'STOP unreadable: read 3';
const R3B = 'STOP unreadable: read 3b, after read 3 answered 403';
/** Read 3b: the branch view answers 403 for read 3, then protection comes from the branch view's own projection. */
const b3b = (rsc: unknown, protectionExtra: Record<string, unknown> = {}, status: Answer = ok({ state: 'pending', statuses: [] })): (() => Fixture) =>
  with_(via3b, { status, branch: ok({ name: 'main', protection: { enabled: true, ...(rsc === undefined ? {} : { required_status_checks: rsc }),
    ...protectionExtra } }) });
const NAMES: Case[] = [
  ...BAD_CTX_ENTRIES.map(([what, e]): Case => [`unreadable: read 3: a classic contexts entry is ${what}`,
    classicFx({ strict: false, contexts: [e] }), R3]),
  ...BAD_CHECK_OBJECTS.map(([what, e]): Case => [`unreadable: read 3: a classic checks entry is ${what}`,
    classicFx({ strict: false, checks: [e] }), R3]),
  ...BAD_LISTS.flatMap(([what, v]): Case[] => [
    [`unreadable: read 3: classic contexts is ${what}, not an array`, classicFx({ strict: false, contexts: v }), R3],
    [`unreadable: read 3: classic checks is ${what}, not an array`, classicFx({ strict: false, checks: v }), R3],
  ]),
  ['unreadable: read 3: a nameless contexts entry after a good one', classicFx({ contexts: ['legacy/ci', null] }), R3],
  ['unreadable: read 3: a nameless contexts entry before a good one', classicFx({ contexts: ['', 'legacy/ci'] }), R3],
  ['unreadable: read 3: a nameless checks entry after a good one', classicFx({ checks: [{ context: 'legacy/ci', app_id: -1 }, {}] }), R3],
  ['unreadable: read 3: a nameless checks entry before a good one', classicFx({ checks: [{}, { context: 'legacy/ci', app_id: -1 }] }), R3],
  ['unreadable: read 3: a nameless contexts entry is not satisfied by a nameless success status (null)',
    classicFx({ contexts: [null] }, nameless('success', null)), R3],
  ['unreadable: read 3: a nameless contexts entry is not satisfied by a nameless success status (empty)',
    classicFx({ contexts: [''] }, nameless('success', '')), R3],
  ['unreadable: read 3: a nameless contexts entry does not wait as an empty label', classicFx({ contexts: [null] }), R3],
  ['unreadable: read 3: a nameless contexts entry does not wait as an empty label (empty string)', classicFx({ contexts: [''] }), R3],
  ['unreadable: read 3: a nameless checks entry does not wait as an empty label', classicFx({ checks: [{}] }), R3],
  ...[['an array', []], ['a string', 'x'], ['a number', 7], ['the boolean true', true], ['the boolean false', false]].map(([what, v]): Case =>
    [`unreadable: read 3: required_status_checks is ${what as string}, not an object`, classicFx(v), R3]),
  ['unreadable: read 3: a nameless classic entry is refused on route Q too, where the required set still gates the enqueue',
    with_(measured, (f) => ({ ...f, protection: ok({ ...(measured().protection as Answer).body as object,
      required_status_checks: { strict: false, contexts: [null], checks: [] } }) })), R3],
  // What stays valid.
  ['classic required_status_checks absent: no classic checks', classicFx(undefined), 'ROUTE U method=squash admin=never strict=no'],
  ['classic required_status_checks null: no classic checks', classicFx(null), 'ROUTE U method=squash admin=never strict=no'],
  ['classic required_status_checks an empty object: no classic checks', classicFx({}), 'ROUTE U method=squash admin=never strict=no'],
  ['classic genuine empty checks and contexts lists: no classic checks', classicFx({ strict: false, contexts: [], checks: [] }),
    'ROUTE U method=squash admin=never strict=no'],
  ['classic contexts alone, checks absent: a legacy context satisfied by a commit status',
    classicFx({ strict: false, contexts: ['legacy/ci'] }, ok({ state: 'success', statuses: [{ context: 'legacy/ci', state: 'success' }] })),
    'ROUTE G method=squash admin=never strict=no'],
  ['classic context keeps its bytes, spaces included: the name is judged as written',
    classicFx({ strict: false, contexts: [' padded name '] }, ok({ state: 'success', statuses: [{ context: ' padded name ', state: 'success' }] })),
    'ROUTE G method=squash admin=never strict=no'],
  ['classic context is not trimmed: a status under the trimmed name does not satisfy it',
    classicFx({ strict: false, contexts: [' padded name '] }, ok({ state: 'success', statuses: [{ context: 'padded name', state: 'success' }] })),
    'WAIT not-reported:  padded name '],
  ['classic checks entry keeps its bytes, spaces included, and a pinned App is not validated here',
    with_(bare, { protection: classicChecks({ strict: false, checks: [{ context: ' padded name ', app_id: 15368 }] }),
      checkruns: runs(run(' padded name ')) }), 'ROUTE G method=squash admin=never strict=no'],
  ['classic checks null and contexts null are lists with no entries, not a stop', classicFx({ strict: false, checks: null, contexts: null }),
    'ROUTE U method=squash admin=never strict=no'],
  // Read 3b: the same names, from the branch view's projection, stop at read 3b's own spelling.
  ...BAD_CTX_ENTRIES.map(([what, e]): Case => [`unreadable: read 3b: a projected contexts entry is ${what}`,
    b3b({ contexts: [e] }), R3B]),
  ...BAD_CHECK_OBJECTS.map(([what, e]): Case => [`unreadable: read 3b: a projected checks entry is ${what}`, b3b({ checks: [e] }), R3B]),
  ...BAD_LISTS.flatMap(([what, v]): Case[] => [
    [`unreadable: read 3b: projected contexts is ${what}, not an array`, b3b({ contexts: v }), R3B],
    [`unreadable: read 3b: projected checks is ${what}, not an array`, b3b({ checks: v }), R3B],
  ]),
  ...[['an array', []], ['a string', 'x'], ['a number', 7], ['the boolean true', true], ['the boolean false', false]].map(([what, v]): Case =>
    [`unreadable: read 3b: the projected required_status_checks is ${what as string}, not an object`, b3b(v), R3B]),
  ['unreadable: read 3b: a nameless entry after a good one', b3b({ contexts: ['legacy/ci', null] }), R3B],
  ['unreadable: read 3b: a nameless checks entry before a good one', b3b({ checks: [{}, { context: 'legacy/ci', app_id: -1 }] }), R3B],
  ['unreadable: read 3b: a nameless contexts entry is not satisfied by a nameless success status (null)',
    b3b({ contexts: [null] }, {}, nameless('success', null)), R3B],
  ['unreadable: read 3b: a nameless contexts entry is not satisfied by a nameless success status (empty)',
    b3b({ contexts: [''] }, {}, nameless('success', '')), R3B],
  ['unreadable: read 3b: a nameless checks entry does not wait as an empty label', b3b({ checks: [{}] }), R3B],
  ['unreadable: read 3b: the stop keeps the 401 context of read 3',
    with_(b3b({ contexts: [null] }), { protection: fail(401, 'Bad credentials') }), 'STOP unreadable: read 3b, after read 3 answered 401'],
  ['unreadable: read 3b: a nameless entry is refused on route Q too, where the required set still gates the enqueue',
    with_(b3b({ contexts: [null] }), (f) => ({ ...f, ...rules(pull({}), queue('SQUASH')), ...settings(true, false, false, true) })), R3B],
  ['read 3b: enabled false is still no classic configuration, whatever the unread projection holds',
    with_(via3b, { branch: ok({ name: 'main', protection: { enabled: false, required_status_checks: { contexts: [null] } } }) }),
    'ROUTE U method=squash admin=never strict=unknown'],
  ['read 3b: required_status_checks absent is no classic checks', b3b(undefined), 'ROUTE U method=squash admin=never strict=unknown'],
  ['read 3b: a null projected required_status_checks is no classic checks', b3b(null), 'ROUTE U method=squash admin=never strict=unknown'],
  ['read 3b: an empty projected required_status_checks is no classic checks', b3b({}), 'ROUTE U method=squash admin=never strict=unknown'],
  ['read 3b: genuine empty lists and null lists are valid', b3b({ checks: [], contexts: null }), 'ROUTE U method=squash admin=never strict=unknown'],
  ['read 3b: a named contexts entry keeps its bytes, spaces included, and is satisfied by a status of that exact name',
    b3b({ contexts: [' padded name '] }, {}, ok({ state: 'success', statuses: [{ context: ' padded name ', state: 'success' }] })),
    'ROUTE G method=squash admin=never strict=unknown'],
  ['read 3b: a named checks entry still matches by App', b3b({ checks: [{ context: 'build-pwa', app_id: 15368 }] }),
    'WAIT not-reported: build-pwa'],
  ['read 3b: a named checks entry satisfied by its App still routes G', with_(b3b({ checks: [{ context: 'build-pwa', app_id: 15368 }] }),
    { checkruns: runs(run('build-pwa')) }), 'ROUTE G method=squash admin=never strict=unknown'],
  ['read 3b: a named checks entry is not satisfied by another App\'s run', with_(b3b({ checks: [{ context: 'build-pwa', app_id: 15368 }] }),
    { checkruns: runs(run('build-pwa', 'success', 'completed', OTHER_APP)) }), 'WAIT not-reported: build-pwa'],
  ['classic strict keeps the reading it had: a string strict is not this guard\'s to validate, and reads as not strict',
    with_(bare, { protection: classicChecks({ strict: 'yes', checks: [{ context: 'build-pwa', app_id: 15368 }] }),
      checkruns: runs(run('build-pwa')) }), 'ROUTE G method=squash admin=never strict=no'],
];

// ---- Fix round 3: nothing is lost before a route is chosen (an empty queue method, an empty rule type, a source of many values) ----
// A value that prints as nothing is still a value. The block used to join the queue methods, and the unknown rule types,
// into one text and ask whether that text was empty. A queue method of "" or a rule type of "" joins to nothing, so the
// queue (or the unknown type) was treated as absent, and a direct route could be chosen
// over a rule this block does not understand. Now every decision is made on the arrays of values, and the joined text
// is only what a stop prints: an empty value shows as `""`, every other value as it is. A source that is one object
// (read 3's body, read 3b's branch view) is exactly one value, not zero and not several.
const EMPTY = '""';
const queueRule = (parameters: unknown, id = 11) => ({ type: 'merge_queue', ruleset_id: id, parameters });
/** The reproduction: an otherwise bare repository whose only gate is an approval that is missing; the rule that stands in the way is
 *  the queue (or the rule of unknown type), so a direct route can only be chosen by losing it. */
const bareApproval = (...rs: unknown[]) => with_(bare, (f) => ({ ...f, ...rules(pull({ required_approving_review_count: 1 }), ...rs),
  pr: prWith('REVIEW_REQUIRED') }));
const ALL3 = '["squash","merge","rebase"]';
const bareNotAllowed = (shown: string, set = ALL3): string =>
  `STOP queue-method-not-allowed: the queue merges by ${shown} and the method set is ${set}`;
const prettyProt = (o: unknown): Answer => prot200(JSON.stringify(o, null, 2) + '\n');
const sparseProt = { enforce_admins: { enabled: true }, required_linear_history: { enabled: false } };
const branchRaw = (raw: string): (() => Fixture) => with_(via3b, { branch: { code: 200, raw } });

const LOSS: Case[] = [
  // F1: the queue methods are values; a queue rule is present when there is one, whatever its method prints as.
  ['an empty queue method is a queue, not no queue: the reproduction (approval missing, bare repository) never routes direct',
    bareApproval(queueRule({ merge_method: '' })), bareNotAllowed(EMPTY)],
  ['an empty queue method is a queue: the same stop with no approval in play (nothing required, auto-merge off)',
    with_(bare, rules(queueRule({ merge_method: '' }))), bareNotAllowed(EMPTY)],
  ['an empty queue method on this repository as measured: the method is not in the set, whatever auto-merge says',
    with_(measured, (f) => ({ ...f, ...rules(pull({}), queue('')) })), bareNotAllowed(EMPTY, '["squash"]')],
  ['an empty queue method with auto-merge off on this repository: the method stop comes first, as it does for any method',
    with_(measured, (f) => ({ ...f, ...rules(pull({}), queue('')), ...settings(true, false, false, false) })), bareNotAllowed(EMPTY, '["squash"]')],
  ['an empty queue method named by two rules is one empty method', with_(measured, (f) => ({ ...f, ...rules(pull({}), queue('', 11), queue('', 12)) })),
    bareNotAllowed(EMPTY, '["squash"]')],
  ['an empty queue method beside a valid one is two methods: both show, and no route follows',
    with_(measured, (f) => ({ ...f, ...rules(pull({}), queue('', 11), queue('SQUASH', 12)) })), `STOP two-queue-methods: ${EMPTY},squash`],
  ['an empty queue method beside a valid one, on the bare repository with an approval missing: still two methods, never a direct route',
    bareApproval(queueRule({ merge_method: 'SQUASH' }, 12), queueRule({ merge_method: '' }, 13)), `STOP two-queue-methods: ${EMPTY},squash`],
  ['a valid SQUASH queue still routes Q', with_(measured, (f) => ({ ...f, ...rules(pull({}), queue('SQUASH')) })), GOOD_Q],
  ['a lower-case queue method routes Q by that method', with_(measured, (f) => ({ ...f, ...rules(pull({}), queue('squash')) })), GOOD_Q],
  ['two queue rules naming one method (in different case) are one method and route Q',
    with_(measured, (f) => ({ ...f, ...rules(pull({}), queue('SQUASH', 11), queue('squash', 12)) })), GOOD_Q],
  ['a queue rule with no merge_method keeps its reading: unknown, which is not allowed', with_(measured, (f) => ({ ...f,
    ...rules(pull({}), queueRule({})) })), bareNotAllowed('unknown', '["squash"]')],
  ['a queue rule whose merge_method is null keeps its reading: unknown, which is not allowed', with_(measured, (f) => ({ ...f,
    ...rules(pull({}), queueRule({ merge_method: null })) })), bareNotAllowed('unknown', '["squash"]')],
  ['a queue method with a trailing newline is not the listed method: it stops (the stop text shows the value without its newline, a carried display limit)',
    with_(measured, (f) => ({ ...f, ...rules(pull({}), queue('SQUASH\n')) })), bareNotAllowed('squash', '["squash"]')],
  ...([['a number', 7], ['the boolean true', true], ['an array', ['SQUASH']]] as [string, unknown][]).map(([what, v]): Case =>
    [`unreadable: read 2: a queue rule's merge_method is ${what}`, with_(measured, (f) => ({ ...f, ...rules(pull({}), queueRule({ merge_method: v })) })),
      'STOP unreadable: read 2']),
  ['a queue rule whose method this block does not list stays not allowed', with_(measured, (f) => ({ ...f,
    ...rules(pull({}), queue('FAST')) })), bareNotAllowed('fast', '["squash"]')],
  ['one queue method that holds a comma is one method, not two: it is not allowed and shows as it is', with_(measured, (f) => ({ ...f,
    ...rules(pull({}), queue('squash,merge')) })), bareNotAllowed('squash,merge', '["squash"]')],
  ['two distinct queue methods that are both valid for the settings stay two methods', with_(measured, (f) => ({ ...f,
    ...rules(pull({}), queue('SQUASH', 11), queue('MERGE', 12)), ...settings(true, true, false, true) })), 'STOP two-queue-methods: merge,squash'],
  // F2: an unknown rule type is the set of such types; the empty string is one.
  ['an empty rule type is an unknown type: the reproduction (approval missing, bare repository) never routes direct',
    bareApproval({ type: '', ruleset_id: 3 }), `STOP unknown-rule-type: ${EMPTY}`],
  ['an empty rule type on the bare repository with nothing else required is an unknown type',
    with_(bare, rules({ type: '', ruleset_id: 3 })), `STOP unknown-rule-type: ${EMPTY}`],
  ['an empty rule type beside this repository\'s queue stops before route Q',
    with_(measured, (f) => ({ ...f, ...rules(pull({}), queue('SQUASH'), { type: '', ruleset_id: 3 }) })), `STOP unknown-rule-type: ${EMPTY}`],
  ['an empty rule type shown as it is when it stands first among known rules',
    with_(measured, (f) => ({ ...f, ...rules({ type: '', ruleset_id: 3 }, pull({}), queue('SQUASH')) })), `STOP unknown-rule-type: ${EMPTY}`],
  ['an ordinary unknown type is still reported by name (approval missing, bare repository)', bareApproval({ type: 'x', ruleset_id: 3 }),
    'STOP unknown-rule-type: x'],
  ['an empty rule type beside another unknown type cannot cancel it: both are reported', bareApproval({ type: '', ruleset_id: 3 },
    { type: 'x', ruleset_id: 4 }), `STOP unknown-rule-type: ${EMPTY},x`],
  ['another unknown type before an empty one: both are reported in the same order', bareApproval({ type: 'x', ruleset_id: 4 },
    { type: '', ruleset_id: 3 }), `STOP unknown-rule-type: ${EMPTY},x`],
  ['an empty rule type named twice is reported once', bareApproval({ type: '', ruleset_id: 3 }, { type: '', ruleset_id: 4 }),
    `STOP unknown-rule-type: ${EMPTY}`],
  ['an empty rule type on a LATER page of the rules answer is still an unknown type', with_(measured, {
    rules: { code: 200, raw: JSON.stringify([pull({})]) + '\n' + JSON.stringify([queue('SQUASH'), { type: '', ruleset_id: 3 }]) } }),
    `STOP unknown-rule-type: ${EMPTY}`],
  ['an empty rule type on the FIRST page, with a valid second page, is an unknown type', with_(measured, {
    rules: { code: 200, raw: JSON.stringify([{ type: '', ruleset_id: 3 }]) + '\n' + JSON.stringify([pull({}), queue('SQUASH')]) } }),
    `STOP unknown-rule-type: ${EMPTY}`],
  ['a genuine empty rule set is still no rules (positive control)', with_(bare, rules()), 'ROUTE U method=squash admin=never strict=no'],
  ['known rule types only are still routed (positive control: a required workflow)', with_(bare, rules({ type: 'workflows', ruleset_id: 5, parameters: {} },
    { type: 'deletion', ruleset_id: 5 }, { type: 'non_fast_forward', ruleset_id: 5 })), 'ROUTE G method=squash admin=never strict=no'],
  // F3: read 3's body and read 3b's branch view are each exactly one value.
  ['unreadable: read 3 answers 200 with two objects printed back to back', with_(measured, { protection: prot200('{}{}') }), R3],
  ['unreadable: read 3 answers 200 with two objects on separate lines', with_(measured, { protection: prot200('{}\n{}') }), R3],
  ['unreadable: read 3 answers 200 with two objects, the first of them this repository\'s protection',
    with_(measured, { protection: prot200(JSON.stringify((measured().protection as Answer).body) + '\n{}') }), R3],
  ['unreadable: read 3 answers 200 with an object and then a truncated value', with_(measured, { protection: prot200('{}\n{') }), R3],
  ['unreadable: read 3 answers 200 with an object and then null', with_(measured, { protection: prot200('{}\nnull') }), R3],
  ['unreadable: read 3 answers 200 with an object and then a scalar', with_(measured, { protection: prot200('{}\n7') }), R3],
  ['unreadable: read 3 answers 200 with an object and then an array', with_(measured, { protection: prot200('{}\n[]') }), R3],
  ['unreadable: read 3 answers 200 with two objects on a direct route (the bare repository, nothing queued)',
    with_(bare, { protection: prot200('{}{}') }), R3],
  ['read 3 answers 200 with one object printed over many lines is still one value (control)',
    with_(bare, { protection: prettyProt(sparseProt) }), 'ROUTE U method=squash admin=never strict=no'],
  ['read 3 answers 200 with one object and a trailing blank line is still one value (control)',
    with_(bare, { protection: prot200('{}\n\n') }), 'ROUTE U method=squash admin=never strict=no'],
  ['read 3 answers 200 with this repository\'s full protection printed over many lines (control)',
    with_(measured, { protection: prettyProt((measured().protection as Answer).body) }), GOOD_Q],
  ['read 3 answers 404 with exactly Branch not protected is still no protection (control)', with_(bare, { protection: fail(404, 'Branch not protected') }),
    'ROUTE U method=squash admin=never strict=no'],
  ['unreadable: read 3b answers with empty stdout and exit 0', branchRaw(''), R3B],
  ['unreadable: read 3b answers with empty stdout and exit 0, after a 401', with_(branchRaw(''), { protection: fail(401, 'Bad credentials') }),
    'STOP unreadable: read 3b, after read 3 answered 401'],
  ['unreadable: read 3b answers with two usable objects printed back to back',
    branchRaw('{"name":"main","protection":{"enabled":false}}{"name":"main","protection":{"enabled":false}}'), R3B],
  ['unreadable: read 3b answers with two usable objects on separate lines',
    branchRaw('{"name":"main","protection":{"enabled":false}}\n{"name":"main","protection":{"enabled":false}}'), R3B],
  ['unreadable: read 3b answers with two usable objects, after a 401', with_(branchRaw('{"protection":{"enabled":false}}\n{"protection":{"enabled":false}}'),
    { protection: fail(401, 'Bad credentials') }), 'STOP unreadable: read 3b, after read 3 answered 401'],
  ['unreadable: read 3b answers with a usable object and then a truncated value', branchRaw('{"protection":{"enabled":false}}\n{'), R3B],
  ['unreadable: read 3b answers with a usable object and then null', branchRaw('{"protection":{"enabled":false}}\nnull'), R3B],
  ['unreadable: read 3b answers with a usable object and then a truncated value, after a 401', with_(branchRaw('{"protection":{"enabled":false}}\n{'),
    { protection: fail(401, 'Bad credentials') }), 'STOP unreadable: read 3b, after read 3 answered 401'],
  ['unreadable: read 3b answers with two objects, refused on route Q too', with_(branchRaw('{"protection":{"enabled":false}}\n{"protection":{"enabled":false}}'),
    (f) => ({ ...f, ...rules(pull({}), queue('SQUASH')), ...settings(true, false, false, true) })), R3B],
  ['read 3b answers with one object printed over many lines: still one value (control)',
    branchRaw(JSON.stringify({ name: 'main', protection: { enabled: false } }, null, 2) + '\n'), 'ROUTE U method=squash admin=never strict=unknown'],
  ['read 3b answers with one enabled=true projection and a named check: still readable (control)',
    with_(b3b({ checks: [{ context: 'build-pwa', app_id: 15368 }] }), { checkruns: runs(run('build-pwa')) }), 'ROUTE G method=squash admin=never strict=unknown'],
  ['read 3b answers with one sparse enabled=true projection: still readable (control)', b3b(undefined), 'ROUTE U method=squash admin=never strict=unknown'],
];

// ---- Fix round 5: no route uses --admin, and a direct route that needs a missing approval stops (spec §11, ruling 5) ----
// The approval is missing when a pull_request rule's, or classic protection's, required_approving_review_count is above 0 and the
// reviewDecision is anything but APPROVED (REVIEW_REQUIRED, CHANGES_REQUESTED, empty, null, absent, an unlisted word): the stop
// fails closed. It is `approval-missing`, on route G and route U alike, whether or not a request for changes stands (an ignored
// one included), under read 3b too, and never on route Q, whose enqueue the queue gates itself. It comes after read 5's lines.
const missingG = with_(routeFixture('G')[2], { pr: prWith('REVIEW_REQUIRED') });
const missingU = bareApproval();
const missingClassic = with_(routeFixture('U')[2], { pr: prWith('REVIEW_REQUIRED') });
const APPROVAL: Case[] = [
  ['route G: a ruleset requires an approval (count 1) and the decision is REVIEW_REQUIRED: approval-missing, route G', missingG, approvalMissing('G')],
  ['route U: nothing else is required, a ruleset requires an approval and it is missing: approval-missing, route U', missingU, approvalMissing('U')],
  ['route U: classic protection alone requires an approval (count 1) and it is missing: approval-missing', missingClassic, approvalMissing('U')],
  ['route G: an approval is required and the reviewDecision is CHANGES_REQUESTED with the exact key given: approval-missing, route G',
    with_(missingG, { pr: prWith(CR), reviews: ok([rev(7, CR)]) }), approvalMissing('G'), keyFor(true, 7)],
  ['route U: a ruleset approval is required and the reviewDecision is CHANGES_REQUESTED with the exact key given: approval-missing, route U',
    with_(missingU, { pr: prWith(CR), reviews: ok([rev(7, CR)]) }), approvalMissing('U'), keyFor(true, 7)],
  ['route U: a classic approval is required and the reviewDecision is CHANGES_REQUESTED with the exact key given: approval-missing, route U',
    with_(missingClassic, { pr: prWith(CR), reviews: ok([rev(7, CR)]) }), approvalMissing('U'), keyFor(true, 7)],
  ['route U: a classic approval is required and the reviewDecision is empty: approval-missing', with_(missingClassic, { pr: prWith('') }),
    approvalMissing('U')],
  ['route U: a classic approval is required and the reviewDecision is null: approval-missing', with_(missingClassic, { pr: prWith(null) }),
    approvalMissing('U')],
  ['route G: an approval is required and the reviewDecision is absent from read 1: approval-missing', with_(missingG, {
    pr: ok({ baseRefName: 'main', headRefOid: HC, state: 'OPEN' }) }), approvalMissing('G')],
  ['route G: an approval is required and the reviewDecision is an unlisted word: approval-missing', with_(missingG, { pr: prWith('SOMETHING_NEW') }),
    approvalMissing('G')],
  ['read 3b: a direct route U with the reviewDecision empty and a ruleset approval required: approval-missing', with_(via3b, (f) => ({ ...f,
    ...rules(pull({ required_approving_review_count: 1 })), pr: prWith('') })), approvalMissing('U')],
  ['route Q: a ruleset approval is required and the reviewDecision is empty: still the queue route', with_(routeFixture('Q')[2], { pr: prWith('') }),
    GOOD_Q],
  // F2: the approval stop comes after read 5, so a red or pending required check is said first.
  ['order: a required check is red and an approval is missing: the RED line comes first', with_(preQueue, {
    checkruns: runs(run('test (server)', 'failure'), run('test (agent)'), run('test (pwa)'), run('build-pwa')) }),
    'RED test (server) [github-actions]'],
  ['order: a required check is pending and an approval is missing: the WAIT line comes first', with_(preQueue, {
    checkruns: runs(run('test (server)', null, 'in_progress'), run('test (agent)'), run('test (pwa)'), run('build-pwa')) }),
    'WAIT pending: test (server)'],
  ['route G: an approval is required and the decision is APPROVED: the route stands, admin never', with_(missingG, { pr: prWith('APPROVED') }),
    'ROUTE G method=merge admin=never strict=no'],
  ['route U: a classic approval is required and the decision is APPROVED: the route stands, admin never', with_(missingClassic, { pr: prWith('APPROVED') }),
    'ROUTE U method=squash admin=never strict=no'],
  ['route U: an ignored request does not skip the approval check, a ruleset approval missing and the exact key given', with_(missingU, { reviews: ok([rev(7, CR)]) }),
    approvalMissing('U'), keyFor(false, 7)],
  ['route G: an ignored request does not skip the approval check, a ruleset approval missing and the exact key given', with_(missingG, { reviews: ok([rev(7, CR)]) }),
    approvalMissing('G'), keyFor(false, 7)],
  ['route U: an ignored request does not skip the approval check, a classic approval missing and the exact key given', with_(missingClassic, { reviews: ok([rev(7, CR)]) }),
    approvalMissing('U'), keyFor(false, 7)],
  ['route Q: a ruleset approval required and missing is still the queue route, admin never', with_(routeFixture('Q')[2], { pr: prWith('REVIEW_REQUIRED') }),
    GOOD_Q],
  ['route Q: the same with an ignored request and the exact key given', with_(routeFixture('Q')[2], { pr: prWith('REVIEW_REQUIRED'), reviews: ok([rev(7, CR)]) }),
    GOOD_Q, keyFor(false, 7)],
  ['read 3b: a direct route G with a ruleset approval required and missing: approval-missing, route G', with_(via3b, (f) => ({ ...f,
    ...rules(pull({ required_approving_review_count: 1 }), rsc([{ context: 'build-pwa', integration_id: 15368 }], 21)),
    checkruns: runs(run('build-pwa')), pr: prWith('REVIEW_REQUIRED') })), approvalMissing('G')],
  ['read 3b: a direct route U with a ruleset approval required and missing: approval-missing, route U', with_(via3b, (f) => ({ ...f,
    ...rules(pull({ required_approving_review_count: 1 })), pr: prWith('REVIEW_REQUIRED') })), approvalMissing('U')],
  ['read 3b: route Q with a ruleset approval required and missing is still the queue route', with_(via3b, (f) => ({ ...f,
    ...rules(pull({ required_approving_review_count: 1 }), queue('SQUASH')), ...settings(true, false, false, true),
    pr: prWith('REVIEW_REQUIRED') })), 'ROUTE Q method=squash admin=never strict=unknown'],
];

// ---- Fix round 4: read 1, read 3 and read 6 judge the value GitHub sent, not the text a shell makes of it ----
// A command substitution drops the trailing newlines of what it captures, and `jq -r` prints a missing, null, numeric or
// boolean field as the text `null`, `123` or `true`. So a base, a state, a head or a 404 message that was
// never the value the contract names could pass for it, and a direct route was chosen over a source that was unusable; and
// read 3's exit status was thrown away, so HTTP 200 text from a gh that failed was believed.
// Each is now judged on the JSON as gh sent it, and the exit status as gh gave it. The reproduction is the bare repository
// with an approval missing and REVIEW_REQUIRED: a usable read 1 reaches the approval check and stops there, whatever a
// coerced or normalised value would have done (since ruling 5 no such value reaches `--admin`: no route uses it).
const APPROVAL_MISSING_U = approvalMissing('U');
const NO_BASE = 'STOP unreadable: read 1 gave no usable base';
const UNREAD1 = 'STOP unreadable: read 1';
const OTHER_HEAD = 'f'.repeat(40);
/** Read 1 as gh sent it: the reproduction's four fields with `patch` over them (a value of `undefined` leaves the field out of
 *  the JSON altogether). */
const read1 = (patch: Record<string, unknown>): (() => Fixture) =>
  with_(bareApproval(), { pr: ok({ baseRefName: 'main', headRefOid: HC, state: 'OPEN', reviewDecision: 'REVIEW_REQUIRED', ...patch }) });

/** Read 1 as the text gh printed, exactly: several values, a value that is not an object, or nothing at all. */
const read1Raw = (raw: string): (() => Fixture) => with_(bareApproval(), { pr: { code: 200, raw } });
/** The reproduction's PR object, as one JSON value in the given state. */
const prText = (state: string): string =>
  JSON.stringify({ baseRefName: 'main', headRefOid: HC, state, reviewDecision: 'REVIEW_REQUIRED' });

const BAD_BASES: [string, unknown][] = [
  ['absent', undefined], ['null', null], ['the number 123', 123], ['the boolean true', true], ['the boolean false', false],
  ['main with a trailing newline', 'main\n'], ['main with two trailing newlines', 'main\n\n'], ['main with a leading newline', '\nmain'],
  ['a name with a newline inside it', 'ma\nin'], ['an empty string', ''], ['an array holding main', ['main']], ['an empty object', {}],
];
const BAD_STATES: [string, unknown][] = [
  ['OPEN with a trailing newline', 'OPEN\n'], ['MERGED with a trailing newline', 'MERGED\n'], ['CLOSED with a trailing newline', 'CLOSED\n'],
  ['OPEN with two trailing newlines', 'OPEN\n\n'], ['MERGED with two trailing newlines', 'MERGED\n\n'], ['OPEN with a leading newline', '\nOPEN'],
  ['the number 1', 1], ['an array holding OPEN', ['OPEN']],
];
const BAD_HEADS: [string, unknown][] = [
  ['absent', undefined], ['null', null], ['the number 123', 123], ['the boolean true', true], ['the boolean false', false],
  ['an empty string', ''], ['handoffCommit with a trailing newline', `${HC}\n`], ['handoffCommit with two trailing newlines', `${HC}\n\n`],
  ['handoffCommit with a leading newline', `\n${HC}`], ['a hash with a newline inside it', `${HC.slice(0, 20)}\n${HC.slice(20)}`],
  ['an array holding handoffCommit', [HC]], ['an empty object', {}],
];
const READ1: Case[] = [
  ['control: read 1 as the reproduction has it reaches the approval check and stops approval-missing', read1({}), APPROVAL_MISSING_U],
  ...BAD_BASES.map(([what, v]): Case => [`unreadable: read 1: the base is ${what}`, read1({ baseRefName: v }), NO_BASE]),
  ...BAD_STATES.map(([what, v]): Case => [`unreadable: read 1: the state is ${what}`, read1({ state: v }), UNREAD1]),
  ['control: the state MERGED on the exact head prints the MERGED line with that head', read1({ state: 'MERGED' }), `MERGED head=${HC}`],
  ['control: the state CLOSED stops as the PR being closed', read1({ state: 'CLOSED' }), 'STOP not-at-head: the PR is CLOSED'],
  ['control: the state MERGED on another valid head prints the MERGED line with that other head',
    read1({ state: 'MERGED', headRefOid: OTHER_HEAD }), `MERGED head=${OTHER_HEAD}`],
  ['control: the state OPEN on another valid head is not at the reviewed head', read1({ headRefOid: OTHER_HEAD }),
    `STOP not-at-head: the PR head is ${OTHER_HEAD}`],
  ...(['OPEN', 'MERGED', 'CLOSED'] as const).flatMap((state): Case[] => BAD_HEADS.map(([what, v]): Case =>
    [`unreadable: read 1: the head is ${what}, with the state ${state}`, read1({ state, headRefOid: v }), UNREAD1])),
  // Judged in this order: the base, then the state, then the head, each before the MERGED line, the closed stop and the head binding.
  ['order: a bad base is judged before a bad state', read1({ baseRefName: null, state: 'WEIRD' }), NO_BASE],
  ['order: a bad base is judged before a bad head', read1({ baseRefName: null, headRefOid: `${HC}\n` }), NO_BASE],
  ['order: a bad state is judged before the MERGED line, whatever the head', read1({ state: 'MERGED\n', headRefOid: OTHER_HEAD }), UNREAD1],
];

// Read 1's source: the answer is exactly one JSON value, and an object, before anything is extracted or branched on. jq's exit
// status follows only the LAST of several values, and an earlier value it cannot index only prints an error and leaves the
// status alone, so without that guard the base, state and head checks judged the last value by itself: a usable MERGED object
// after a first value of `"x"`, `1`, `[]` or `true` printed the MERGED line, and a usable OPEN one went on to the reviews read.
// Every case here is the text gh printed, as it was. A stop at read 1 is checked twice: the line, and the stub's argv log, which
// must hold the `pr view` call and nothing after it (no reviews and no rules read), so the stop is the read 1 boundary and not some
// later one. The three controls at the end are one usable object each, which keep their lines.
const READ1_CALL = 'pr view 42 --json baseRefName,headRefOid,state,reviewDecision';
const FIRST_VALUES = ['"x"', '1', '[]', 'true'] as const;
const READ1_SOURCE: [name: string, raw: string, line: string, atRead1: boolean][] = [
  ...FIRST_VALUES.flatMap((first) => (['OPEN', 'CLOSED', 'MERGED'] as const).map((state): [string, string, string, boolean] =>
    [`read 1 source: ${first} and then a usable ${state} PR object`, first + prText(state), UNREAD1, true])),
  ['read 1 source: nothing on stdout, and gh exits 0', '', UNREAD1, true],
  ['read 1 source: two objects, the first unusable and the second usable and MERGED, adjacent',
    `{"baseRefName":null,"headRefOid":null,"state":"X"}{"baseRefName":"main","headRefOid":"${HC}","state":"MERGED"}`, UNREAD1, true],
  ['read 1 source: two usable objects, adjacent', prText('OPEN') + prText('OPEN'), UNREAD1, true],
  ['read 1 source: two usable objects, separated by a newline', `${prText('OPEN')}\n${prText('OPEN')}`, UNREAD1, true],
  ['read 1 source: a usable OPEN object and then "x"', `${prText('OPEN')}"x"`, UNREAD1, true],
  ['read 1 source: a usable MERGED object and then "x"', `${prText('MERGED')}"x"`, UNREAD1, true],
  ['read 1 source: a usable MERGED object and then malformed JSON', `${prText('MERGED')}{"baseRefName":`, UNREAD1, true],
  ['read 1 source: malformed JSON alone', '{', UNREAD1, true],
  ['read 1 source: one value, a string', '"main"', UNREAD1, true],
  ['read 1 source: one value, a number', '7', UNREAD1, true],
  ['read 1 source: one value, an array holding the usable object', `[${prText('OPEN')}]`, UNREAD1, true],
  ['read 1 source: one value, true', 'true', UNREAD1, true],
  ['read 1 source: one value, null', 'null', UNREAD1, true],
  ['read 1 source: control: one usable OPEN object reaches the approval check', prText('OPEN'), APPROVAL_MISSING_U, false],
  ['read 1 source: control: one usable CLOSED object stops as closed', prText('CLOSED'), 'STOP not-at-head: the PR is CLOSED', false],
  ['read 1 source: control: one usable MERGED object prints the MERGED line with its head', prText('MERGED'), `MERGED head=${HC}`, false],
];

const NP = 'Branch not protected';
const R3_404 = 'STOP unreadable: read 3 answered 404';
const SPARSE_PROT = { enforce_admins: { enabled: true }, required_pull_request_reviews: null };
/** gh's own exit status for the answer, whatever its HTTP code says. */
const exiting = (a: Answer, exit: number): Answer => ({ ...a, exit });
/** A 404 whose body is `body` as it is, after gh's `-i` status line and headers. */
const prot404 = (body: string): Answer => ({ code: 404, raw: `HTTP/2.0 404 X\nX-Github-Request-Id: 0\r\n\r\n${body}` });
const msg404 = (message: unknown): Answer => ({ code: 404, body: { message } });
const on3 = (a: Answer): (() => Fixture) => with_(bareApproval(), { protection: a });
/** The same usable HTTP 200 on stdout from gh exiting 0, 1 and 2: only the first is a success. */
const exitCases = (what: string, build: (exit: number) => Fixture, good: string): Case[] => [
  [`${what}: HTTP 200 on stdout and gh exits 0 is read as it always was`, () => build(0), good],
  [`unreadable: read 3: ${what}: the same HTTP 200 on stdout, but gh exits 1`, () => build(1), R3],
  [`unreadable: read 3: ${what}: the same HTTP 200 on stdout, but gh exits 2`, () => build(2), R3],
];
const READ3: Case[] = [
  ...exitCases('an empty object', (x) => with_(bareApproval(), { protection: exiting(prot200('{}'), x) })(), APPROVAL_MISSING_U),
  ...exitCases('a sparse valid object', (x) => with_(bareApproval(), { protection: exiting(prot200(JSON.stringify(SPARSE_PROT)), x) })(), APPROVAL_MISSING_U),
  ...exitCases('this repository\'s full protection', (x) => with_(measured, { protection: exiting(measured().protection as Answer, x) })(), GOOD_Q),
  ['control: the exact 404 is no protection, gh exiting 1 as it does', on3(exiting(fail(404, NP), 1)), APPROVAL_MISSING_U],
  ['control: a 403 goes to read 3b, gh exiting 1 as it does',
    with_(via3b, { protection: exiting(fail(403, 'Resource not accessible by integration'), 1) }), 'ROUTE U method=squash admin=never strict=unknown'],
  ['control: a 401 goes to read 3b, gh exiting 1 as it does',
    with_(via3b, { protection: exiting(fail(401, 'Bad credentials'), 1) }), 'ROUTE U method=squash admin=never strict=unknown'],
  // The 404's message is the original JSON value, exactly one value, exactly the words.
  ['control: a 404 whose message is exactly Branch not protected is no protection', on3(msg404(NP)), APPROVAL_MISSING_U],
  ['control: that message in the body gh prints, with the status and the documentation link', on3(prot404(
    JSON.stringify({ message: NP, documentation_url: 'https://example.test/d', status: '404' }))), APPROVAL_MISSING_U],
  ['unreadable: read 3 answers 404 with the message and one trailing newline', on3(msg404(`${NP}\n`)), R3_404],
  ['unreadable: read 3 answers 404 with the message and two trailing newlines', on3(msg404(`${NP}\n\n`)), R3_404],
  ['unreadable: read 3 answers 404 with a leading newline before the message', on3(msg404(`\n${NP}`)), R3_404],
  ['unreadable: read 3 answers 404 with the message and a trailing carriage return', on3(msg404(`${NP}\r`)), R3_404],
  ['unreadable: read 3 answers 404 with another message', on3(msg404('Not Found')), R3_404],
  ['unreadable: read 3 answers 404 with a message that is null', on3(msg404(null)), R3_404],
  ['unreadable: read 3 answers 404 with a message that is an array holding the words', on3(msg404([NP])), R3_404],
  ['unreadable: read 3 answers 404 with no message', on3(prot404('{}')), R3_404],
  ['unreadable: read 3 answers 404 with two values, the last of them carrying the exact message',
    on3(prot404(`{"message":"x"}{"message":"${NP}"}`)), R3_404],
  ['unreadable: read 3 answers 404 with two values, the first of them carrying the exact message',
    on3(prot404(`{"message":"${NP}"}{"message":"x"}`)), R3_404],
  ['unreadable: read 3 answers 404 with two values that both carry the exact message, on separate lines',
    on3(prot404(`{"message":"${NP}"}\n{"message":"${NP}"}`)), R3_404],
  ['unreadable: read 3 answers 404 with two values that both carry the exact message, back to back',
    on3(prot404(`{"message":"${NP}"}{"message":"${NP}"}`)), R3_404],
  ['unreadable: read 3 answers 404 with a malformed body', on3(prot404('{')), R3_404],
  ['unreadable: read 3 answers 404 with an empty body', on3(prot404('')), R3_404],
  ['unreadable: read 3 answers 404 with a body that is null', on3(prot404('null')), R3_404],
  ['unreadable: read 3 answers 404 with a body that is the words as a JSON string', on3(prot404(`"${NP}"`)), R3_404],
  ['unreadable: read 3 answers 404 with a body that is an array holding the object', on3(prot404(`[{"message":"${NP}"}]`)), R3_404],
];

// Read 6 is retired (ruling 5): no route uses `--admin`, so no ruleset is asked what the login may bypass. The fixture stays, for the
// test below that the block never asks: an approval missing beside a ruleset that carries required checks, with whatever answer.
const ruleset6 = (a: Answer | Answer[]): (() => Fixture) => with_(bareApproval(), (f) => ({ ...f,
  ...rules(pull({ required_approving_review_count: 1 }), rsc([{ context: 'build-pwa', integration_id: 15368 }], 21)),
  checkruns: runs(run('build-pwa')), ruleset: a }));
const bypass = (v: unknown): Answer => ok({ id: 21, current_user_can_bypass: v });

/** Every argv the block may send: its reads (read 1 with its reviews, and the compare under read 3b), as GETs. */
const READ = /^(pr view 42 --json baseRefName,headRefOid,state,reviewDecision|api (--paginate |-i )?repos\/\{owner\}\/\{repo\}(\/[^\s]*)?)$/;
/** The same reads as the block's TEXT spells them, from the word `gh` to the end of its quoted path, followed only by
 *  the close of its `$(…)` or a pipe; the one exception is the explicit alternative for read 3's own call, which may
 *  carry exactly ` 2>/dev/null)` and nothing else may. An allowlist, so a write under a
 *  branch no case reaches is still a red: `gh pr review`, `gh api --method=PATCH …` and `gh api -XPATCH …` match none
 *  of it. It judges a LOGICAL line (see `ghSpelled`), so a write split over a `\` continuation cannot hide its flags
 *  on the next physical line. */
const GH_SPELLED = /^gh (pr view "\$PR" --json baseRefName,headRefOid,state,reviewDecision\)|api (--paginate |-i )?"repos\/\{owner\}\/\{repo\}[^"\s]*"(?=\)|\s+\|(?!&))|api -i "repos\/\{owner\}\/\{repo\}\/branches\/\$base\/protection" 2>\/dev\/null\))/;
/** Every gh the block's text spells, each from the word `gh` to the end of its logical line: backslash continuations
 *  are joined first, so the whole call is judged and not only its first physical line. */
const ghSpelled = (b: string): string[] => {
  const logical = b.replace(/\\\n[ \t]*/g, ' ');
  return [...logical.matchAll(/\bgh\b/g)].map((m) => logical.slice(m.index).split('\n')[0]!);
};
/** Every line of the block that redirects stderr, once per redirect: `2>`, `&>` and `|&`. */
const stderrHits = (t: string): string[] => t.split('\n').flatMap((l) => (l.match(/2>|&>|\|&/g) ?? []).map(() => l));
/** The block's code lines (comment-only lines dropped). */
const codeLines = (b: string): string[] => b.split('\n').filter((l) => !/^\s*#/.test(l));
/** The ENUMERATED spellings by which the block could take a value, or code, from a file or from run text it builds, and the
 *  placements the census looks at them in. Spellings: a `$HOME` or `~/` path, `source` or a `.` command (at the start of a
 *  line or after `&&` or `||`, so jq's `. ==` is not one), `cat`, `read` as a command (at the start, after `&&`, `||`, `;`,
 *  `|`, `(`, `{`, `then` or `do`, so "unreadable: read 1" is not one), `mapfile`, `readarray`, `eval`, `head` or `tail` given a
 *  FILE operand or a `<` redirect (in the same command places as `read`, and after a backtick; `head -n1 <<<"$r3"`, a
 *  here-string, and a bare `head -n1` fed by a pipe are not file reads; only `-n` or `-c` with a separate digit count and
 *  single-token flags are skipped before the operand, so `tail -n +2 file`, `head -n "$n" file` and `head -n1<file` are
 *  census limits and not caught), and a `$(<` file read. The block's own file-free reads are its gh calls, numbered 1 to 6
 *  in its comments: read 1's PR view and its paginated reviews, read 2, read 3 (and, after read 3 answers 401 or 403,
 *  read 3b, with the compare under it), read 4, read 5's two endpoints (check runs and statuses) and read 6; it spells
 *  none of the forms above. This is a finite contract check of exactly those spellings and placements, one line at a time,
 *  and NOT a shell parser and not a proof: other ordinary readers and placements the list does not name are census LIMITS
 *  too, for example `jq` given a path operand, `while read`, a `.` command after `then`, or a `<` redirect into a command
 *  not listed, beside the encoded or indirect spellings (a computed command, a here-document fed to a shell). What does
 *  not change is the runtime requirement: the block has no durable file override by any spelling, and the operator's
 *  exact-key ignore is invocation-only. The behaviour cases (a key in a file under HOME or in `.git`, CR_IGNORE unset,
 *  still stops) and the whole-conditional pin in coordinator-skill.test.ts defend that requirement where this list cannot. */
const FILE_FORMS: [string, RegExp][] = [
  ['$HOME', /\$\{?HOME\b/], ['~/', /(^|[\s"'=:])~\//], ['source', /\bsource\b/], ['. file', /(^|&&|\|\|)\s*\.\s+\S/],
  ['cat', /\bcat\b/], ['read', /(^|&&|\|\||[;|({]|\bthen|\bdo)\s*(IFS=\S*\s+)?read\s/], ['mapfile', /\b(mapfile|readarray)\b/], ['eval', /\beval\b/],
  // `head` and `tail` as a command given something other than a here-string: a file operand or a `<` redirect. Their flags
  // (`-n1`, `-n 1`, `-1`) are skipped first, so `head -n1 <<<"$r3"` and a bare `| head -n1` pass.
  ['head/tail file', /(^|&&|\|\||[;|({`]|\bthen|\bdo)\s*(head|tail)(\s+(-[nc]\s+\d+|-\S+))*\s+(?<!\s-[nc]\s+)(?!<<<|-)[^\s|;&)]/],
  // The `(?!<)` only narrows the match so a `$(<<<` here-string is not read as a file read; nothing in the cases depends on it.
  ['$(< file', /\$\(\s*<(?!<)/],
];
const fileForms = (b: string): string[] => codeLines(b).flatMap((l) => FILE_FORMS.filter(([, re]) => re.test(l)).map(([n]) => `${n}: ${l.trim()}`));
/** The lines of the block's CODE (comment-only lines dropped) that name CR_IGNORE once the skip condition's two permitted
 *  expansions are removed. The variable's only legitimate use is those two reads of the invoking shell's value; an
 *  assignment, a `read` or `mapfile` into it, `printf -v`, `declare`, `export`, a default or a third expansion all leave
 *  the name behind, or change the count of the two, and come back here. A contract-grade census of the ordinary spellings,
 *  not a shell parser: an encoded or indirect spelling (a computed name, `eval`, a here-document) is the carried limit. */
const crIgnoreStrays = (b: string): string[] => {
  let code = codeLines(b).join('\n');
  for (const use of ['[ -n "$CR_IGNORE" ]', '[ "$CR_IGNORE" = "$key" ]']) {
    if (code.split(use).length !== 2) return [`the skip condition lost or repeated ${use}`];
    code = code.replace(use, '');
  }
  return code.split('\n').filter((l) => l.includes('CR_IGNORE'));
};
/** The spelled gh calls that are not one of the reads. */
const ghOffenders = (b: string): string[] => ghSpelled(b).filter((s) => !GH_SPELLED.test(s));

describe('the landing verdict block (landing-order wave 3e, spec §5.7)', () => {
  it('wave-lifecycle.md carries exactly one landing verdict block', () => {
    expect(blocks, 'references/wave-lifecycle.md must carry exactly one fenced bash block marked "# The landing verdict"')
      .toHaveLength(1);
  });

  it('reads and never writes: every gh the block spells is one of the reads, with no GraphQL and no rm', () => {
    expect(blocks).toHaveLength(1);
    const b = blocks[0]!;
    expect(ghSpelled(b).length, 'the block spells fewer gh reads than its nine (read 6 is retired)').toBeGreaterThanOrEqual(9);
    expect(ghOffenders(b), 'the block spells a gh that is not one of the reads').toEqual([]);
    expect(b).not.toContain('graphql');
    expect(b).not.toMatch(/\brm\s/);
  });

  it('redirects stderr exactly once: read 3\'s own call, with no exec redirect and none on the reviews read', () => {
    expect(blocks).toHaveLength(1);
    const b = blocks[0]!;
    const hits = stderrHits(b);
    expect(hits, 'the block redirects stderr other than on read 3\'s one call').toHaveLength(1);
    expect(hits[0]).toContain('branches/$base/protection');
    expect(hits[0]).toMatch(/gh api -i "repos\/\{owner\}\/\{repo\}\/branches\/\$base\/protection" 2>\/dev\/null\)$/);
    const reviews = ghSpelled(b).filter((l) => l.includes('/reviews'));
    expect(reviews, 'the block spells the reviews read exactly once').toHaveLength(1);
    expect(reviews[0]).toMatch(/^gh api --paginate "repos\/\{owner\}\/\{repo\}\/pulls\/\$PR\/reviews" \|/);
  });

  it('judges `|&` as a stderr redirect: planted on the reviews read, the spelling allowlist and the census both reject it', () => {
    expect(blocks).toHaveLength(1);
    const b = blocks[0]!;
    const read = 'gh api --paginate "repos/{owner}/{repo}/pulls/$PR/reviews" | jq -sc \'';
    expect(b.split(read), 'the planted pipe lost its anchor').toHaveLength(2);
    const planted = b.replace(read, read.replace(' | jq', ' |& jq'));
    expect(planted).not.toBe(b);
    const offenders = ghOffenders(planted);
    expect(offenders, '`|&` passed the spelling allowlist').toHaveLength(1);
    expect(offenders[0]).toContain('/reviews');
    expect(stderrHits(planted), '`|&` passed the stderr census').toHaveLength(2);
    expect(stderrHits(b)).toHaveLength(1);
  });

  it('a stderr redirect planted before the close of another read is an offender: only read 3\'s own call may carry one', () => {
    expect(blocks).toHaveLength(1);
    const b = blocks[0]!;
    const read = 'r4=$(gh api "repos/{owner}/{repo}" | jq -ce';
    expect(b.split(read), 'the planted redirect lost its anchor').toHaveLength(2);
    const planted = b.replace(read, 'r4=$(gh api "repos/{owner}/{repo}" 2>/dev/null) | jq -ce');
    const offenders = ghOffenders(planted);
    expect(offenders, 'the allowlist passed a redirect on read 4').toHaveLength(1);
    expect(offenders[0]).toContain('2>/dev/null)');
    expect(ghOffenders(b)).toEqual([]);
  });

  it('CR_IGNORE is read from the invoking shell only: the block never assigns, reads into, exports or defaults it', () => {
    expect(blocks).toHaveLength(1);
    const b = blocks[0]!;
    expect(b).toContain('CR_IGNORE');
    expect(b).not.toMatch(/CR_IGNORE=/);
    expect(b).not.toMatch(/CR_IGNORE:?[-=]/);
    expect(b).not.toMatch(/\bexport\b/);
    // The census: the only code that names the variable is the two expansions of the skip condition.
    expect(crIgnoreStrays(b), 'the block names CR_IGNORE other than in the skip condition\'s two expansions').toEqual([]);
    // And the block spells none of the ENUMERATED file-reading forms of FILE_FORMS: a `$HOME` or `~/` path, `source`, a `.`
    // command, `cat`, `read`, `mapfile`/`readarray`, `eval`, `head`/`tail` given a file operand or a `<` redirect, or a `$(<`
    // file read. A finite census of those spellings and placements, not a proof about every shell reader: the unenumerated
    // ordinary ones (jq on a path, `while read`, a `.` after `then`) are census limits, listed at FILE_FORMS.
    expect(fileForms(b), 'the block spells one of the enumerated file-reading forms').toEqual([]);
  });

  it('the CR_IGNORE census rejects an ordinary read into it, a printf -v, a declare and a default, and accepts the block and a comment', () => {
    expect(blocks).toHaveLength(1);
    const b = blocks[0]!;
    const anchor = 'if [ "$standing" = true ]; then\n';
    expect(b.split(anchor), 'the planted spellings lost their anchor').toHaveLength(2);
    const plant = (line: string): string => b.replace(anchor, `${line}\n${anchor}`);
    expect(crIgnoreStrays(b)).toEqual([]);
    expect(crIgnoreStrays(plant('# CR_IGNORE holds the key the operator answered'))).toEqual([]);
    for (const line of [
      '[ -f "$HOME/.ccrc-cr-ignore" ] && read -r CR_IGNORE < "$HOME/.ccrc-cr-ignore"',
      'read -r CR_IGNORE < "$HOME/.ccrc-cr-ignore"',
      '[ -f "$HOME/.ccrc-cr-ignore" ] && IFS= read -r CR_IGNORE < "$HOME/.ccrc-cr-ignore"',
      'printf -v CR_IGNORE "%s" "$(cat "$HOME/.ccrc-cr-ignore")"',
      'declare CR_IGNORE=x',
      'mapfile -t CR_IGNORE < "$HOME/.ccrc-cr-ignore"',
      'export CR_IGNORE',
      ': "${CR_IGNORE:=x}"',
    ]) expect(crIgnoreStrays(plant(line)), `the census passed: ${line}`).toHaveLength(1);
    // The file-reading census rejects each ENUMERATED ordinary spelling planted below (see FILE_FORMS: a finite list, not a
    // shell parser; other ordinary readers and placements, such as jq on a path, `while read` or a `.` after `then`, are
    // census limits) and accepts the block, its here-string `head`, and a comment.
    expect(fileForms(b)).toEqual([]);
    expect(fileForms(plant('# source "$HOME/x"; cat y; read -r z; eval w'))).toEqual([]);
    for (const line of [
      '[ -f "$HOME/.ccrc-cr-ignore.sh" ] && . "$HOME/.ccrc-cr-ignore.sh"',
      '. ./override.sh',
      'true && . ./override.sh',
      'source ./override.sh',
      'cat "$HOME/x"',
      'k=$(cat ./x)',
      'eval "$x"',
      'read -r k < ./x',
      'if [ -f ./x ]; then read -r k < ./x; fi',
      'IFS= read -r k < ./x',
      'readarray -t k < ./x',
      'mapfile -t k < ./x',
      'k=$(< ~/x)',
      'p="$HOME/x"',
      'p="${HOME}/x"',
      'p=~/x',
      // The two ordinary unencoded spellings a review applied to the skip-stop line, and their plain relatives: `head` and
      // `tail` given a file operand or a `<` redirect, and a `$(<` file read with no `~` or `$HOME` in it.
      'head -n1 .git/ccrc-cr-ignore',
      'tail -n1 .git/ccrc-cr-ignore',
      'k=$(head -n1 .git/ccrc-cr-ignore)',
      'k=$(tail -n 1 ./x)',
      'k=$(head -1 < ./x)',
      'if [ -f ./x ]; then head -n 1 ./x; fi',
      'k=`head -c 8 ./x`',
      '[ "$(< .git/ccrc-cr-ignore)" = "$key" ]',
      'k=$(<./x)',
    ]) expect(fileForms(plant(line)), `the file census passed: ${line}`).not.toEqual([]);
    // The block's own `head` reads a here-string, which is no file: these pass, as does a bare `head` fed by a pipe and a
    // comment naming the spellings.
    for (const line of [
      'c=$(head -n1 <<<"$x" | cut -d\' \' -f2)',
      'head -n 1 <<<"$x"',
      'tail -n1 <<<"$x"',
      'k=$(printf x | head -n1)',
      'k=$(printf x | tail -n 2 | cut -d, -f1)',
      '# head -n1 .git/x; k=$(< .git/x); tail ./y',
    ]) expect(fileForms(plant(line)), `the file census rejected: ${line}`).toEqual([]);
    expect(b, 'the block\'s own here-string head is gone, so the control above proves nothing').toContain('head -n1 <<<"$r3"');
    // The same two additions placed where the review put them, on the skip-stop line with both permitted CR_IGNORE
    // expansions untouched. The CR_IGNORE census cannot see them (neither names the variable); the file census must.
    const stopLine = '    || stop "changes-requested: operator decision required; key=$key"\n';
    expect(b.split(stopLine), 'the skip-stop line lost its anchor').toHaveLength(2);
    for (const arm of ['[ "$(head -n1 .git/ccrc-cr-ignore)" = "$key" ]', '[ "$(< .git/ccrc-cr-ignore)" = "$key" ]']) {
      const planted = b.replace(stopLine, `    || ${arm} || stop "changes-requested: operator decision required; key=$key"\n`);
      expect(planted).not.toBe(b);
      expect(crIgnoreStrays(planted), `the CR_IGNORE census was expected to miss: ${arm}`).toEqual([]);
      expect(fileForms(planted), `the file census passed an addition on the skip-stop line: ${arm}`).toHaveLength(1);
    }
    // The permitted expansions are exactly the two of the skip condition, each once: a third copy or a lost one is refused.
    const cond = '[ -n "$CR_IGNORE" ] && [ "$CR_IGNORE" = "$key" ]';
    expect(b.split(cond), 'the skip condition changed shape').toHaveLength(2);
    expect(crIgnoreStrays(b.replace(cond, `${cond} && [ -n "$CR_IGNORE" ]`)), 'a third expansion passed').not.toEqual([]);
    expect(crIgnoreStrays(b.replace(cond, '[ "$CR_IGNORE" = "$key" ]')), 'a lost expansion passed').not.toEqual([]);
  });

  it('CR_IGNORE comes from the invoking shell only: the exact key in a file under HOME, with CR_IGNORE unset, still stops', () => {
    // The fixture HOME is the block's HOME. A durable override read from a file there is the convention check turned into a
    // standing licence, which the operator's ruling excludes: only the operator's answer, in the invocation, skips the stop.
    const fx = withReviews(measured, '', rev(7, CR));
    // The control: the same key supplied in the invoking environment is accepted, so the file below holds the exact accepted key.
    const control = verdict(fx(), keyFor(false, 7));
    expect(control.out, `stderr: ${control.stderr}`).toBe(`${GOOD_Q}\n`);
    for (const [how, text] of [['with a newline', `${keyOf(false, 7)}\n`], ['without one', keyOf(false, 7)]] as const) {
      const r = verdict(fx(), {}, { '.ccrc-cr-ignore': text });
      expect(r.out, `a key in $HOME/.ccrc-cr-ignore (${how}) skipped the stop; stderr: ${r.stderr}`).toBe(`${askLine(false, 7)}\n`);
    }
  });

  it('CR_IGNORE comes from the invoking shell only: the exact key in .git/ccrc-cr-ignore in the working directory, with CR_IGNORE unset, still stops', () => {
    // The block's working directory is the fixture HOME, so `.git/ccrc-cr-ignore` below is a fixture file in its cwd, never
    // this repository's own .git. A key read from there would be the same standing licence as one read from HOME.
    const fx = withReviews(measured, '', rev(7, CR));
    const control = verdict(fx(), keyFor(false, 7));
    expect(control.out, `stderr: ${control.stderr}`).toBe(`${GOOD_Q}\n`);
    for (const [how, text] of [['with a newline', `${keyOf(false, 7)}\n`], ['without one', keyOf(false, 7)]] as const) {
      const r = verdict(fx(), {}, { '.git/ccrc-cr-ignore': text });
      expect(r.out, `a key in .git/ccrc-cr-ignore (${how}) skipped the stop; stderr: ${r.stderr}`).toBe(`${askLine(false, 7)}\n`);
    }
    // And with the file beside the HOME one, still no skip.
    const both = verdict(fx(), {}, { '.git/ccrc-cr-ignore': keyOf(false, 7), '.ccrc-cr-ignore': keyOf(false, 7) });
    expect(both.out, `stderr: ${both.stderr}`).toBe(`${askLine(false, 7)}\n`);
  });

  it('judges a gh call as one logical line: a write split over a backslash continuation is refused', () => {
    expect(blocks).toHaveLength(1);
    const b = blocks[0]!;
    const anchor = '[ "$state" = CLOSED ] && stop "not-at-head: the PR is CLOSED"\n';
    expect(b.split(anchor), 'the planted write lost its anchor').toHaveLength(2);
    const split = b.replace(anchor, anchor + 'x=$(gh api "repos/{owner}/{repo}/pulls/$PR/merge" \\\n  -X PUT -f merge_method=squash | jq .)\n');
    expect(split).not.toBe(b);
    const offenders = ghOffenders(split);
    expect(offenders, 'the allowlist passed a write split over two lines').toHaveLength(1);
    expect(offenders[0]).toContain('pulls/$PR/merge');
    expect(offenders[0], 'the offender is judged whole, flags included').toContain('-X PUT');
    // The same read, on one line, is the control: the allowlist still passes what the block spells.
    expect(ghOffenders(b)).toEqual([]);
  });

  it('under read 3b reads the compare only for a direct route: route Q needs no strictness, so a head behind the base lands', () => {
    expect(blocks).toHaveLength(1);
    const q = verdict(with_(via3b, { ...rules(pull({}), queue('SQUASH')), ...settings(true, false, false, true),
      compare: ok({ behind_by: 2 }) })());
    expect(q.out, `stderr: ${q.stderr}`).toBe('ROUTE Q method=squash admin=never strict=unknown\n');
    expect(q.stderr, 'read 3 answered 403 and its message reached stderr').toBe('');
    expect(q.calls.filter((c) => c.includes('/compare/')), 'route Q under read 3b read the compare').toEqual([]);
    for (const c of q.calls) expect(c, 'the block sent gh something other than a read').toMatch(READ);
    // A direct route under read 3b still reads it, once.
    expect(verdict(via3b()).calls.filter((c) => c.includes('/compare/')))
      .toEqual([`api repos/{owner}/{repo}/compare/main...${HC}`]);
  });

  it.each([...ROUTES, ...CHECKS, ...STOPS, APPROVAL_WITH_RULESET, ...REQUESTS, ...IGNORES, ...APPROVAL_CHECK, ...APPROVAL, ...MALFORMED,
  ...READ5, ...MIXED, ...FIELDS, ...ENTRIES, ...CONV, ...NAMES, ...ORDER, ...LOSS, ...READ1, ...READ3])('%s', (_name, fx, line, env) => {
    expect(blocks).toHaveLength(1);
    const r = verdict(fx(), env);
    expect(r.out, `stderr: ${r.stderr}`).toBe(`${line}\n`);
    // gh prints `gh: <message> (HTTP n)` on any non-2xx. Read 3 meets one on every unprotected repository (404) and under
    // read 3b (403), so it alone is silenced; a line that is not a STOP must leave stderr empty, or the run has two
    // outputs and a coordinator reads `verdict-unread` over a right answer.
    if (!line.startsWith('STOP')) expect(r.stderr, 'a verdict that is not a stop wrote to stderr').toBe('');
    for (const c of r.calls) expect(c, 'the block sent gh something other than a read').toMatch(READ);
  });

  it('asks about the PR\'s own base, never the literal main (§11 item 15)', () => {
    const r = verdict(with_(bare, { pr: ok({ baseRefName: 'release/2', headRefOid: HC, state: 'OPEN', reviewDecision: '' }) })());
    expect(r.out).toBe('ROUTE U method=squash admin=never strict=no\n');
    expect(r.stderr).toBe('');
    expect(r.calls).toContain('api --paginate repos/{owner}/{repo}/rules/branches/release/2');
    expect(r.calls).toContain('api -i repos/{owner}/{repo}/branches/release/2/protection');
    expect(r.calls.filter((c) => c.includes('branches/main'))).toEqual([]);
  });

  it.each(['null', '123'])('a base that is the STRING "%s" is a legitimate branch name: it routes as main does, and the reads ask about it', (name) => {
    const control = verdict(read1({})());
    expect(control.out).toBe(`${APPROVAL_MISSING_U}\n`);
    const r = verdict(read1({ baseRefName: name })());
    expect(r.out, `stderr: ${r.stderr}`).toBe(control.out);
    expect(r.stderr).toBe('');
    expect(r.calls).toContain(`api --paginate repos/{owner}/{repo}/rules/branches/${name}`);
    expect(r.calls).toContain(`api -i repos/{owner}/{repo}/branches/${name}/protection`);
    expect(r.calls.filter((c) => c.includes('branches/main'))).toEqual([]);
  });

  it.each(READ1_SOURCE)('%s', (_name, raw, line, atRead1) => {
    const r = verdict(read1Raw(raw)());
    expect(r.out, `stderr: ${r.stderr}`).toBe(`${line}\n`);
    if (atRead1) expect(r.calls, 'gh was called after read 1: the stop is not at the read 1 boundary').toEqual([READ1_CALL]);
    if (!line.startsWith('STOP')) expect(r.stderr, 'a verdict that is not a stop wrote to stderr').toBe('');
    for (const c of r.calls) expect(c, 'the block sent gh something other than a read').toMatch(READ);
  });

  it('a read 1 whose base, state or head is unusable reads nothing else', () => {
    for (const patch of [{ baseRefName: null }, { state: 'OPEN\n' }, { headRefOid: `${HC}\n` }]) {
      expect(verdict(read1(patch)()).calls).toEqual(['pr view 42 --json baseRefName,headRefOid,state,reviewDecision']);
    }
  });

  it('asks no ruleset what the login may bypass: whatever read 6 would have answered, the line is approval-missing and no call names rulesets/', () => {
    for (const a of [bypass('never'), bypass('always'), bypass('never\n'), fail(404, 'Not Found'), { code: 200, raw: '' }] as Answer[]) {
      const r = verdict(ruleset6(a)());
      expect(r.out, `stderr: ${r.stderr}`).toBe(`${approvalMissing('G')}\n`);
      expect(r.calls.filter((c) => c.includes('rulesets')), 'the block asked a ruleset by id').toEqual([]);
    }
  });

  it('never prints admin=licensed or a --admin spelling, and never sends one: every fixture of the approval cases answers admin=never or the one stop', () => {
    const fixtures = [preQueue, missingG, missingU, missingClassic, ruleset6(bypass('never')), measured, thirdParty, bare, via3b,
      with_(preQueue, { reviews: ok([rev(7, CR)]) })];
    for (const fx of fixtures) {
      const r = verdict(fx(), keyFor(false, 7));
      const [line, ...rest] = r.out.split('\n').filter(Boolean);
      expect(rest, 'the verdict printed more than one line').toEqual([]);
      expect(line, 'a line that names admin=licensed').not.toContain('admin=licensed');
      // The one line allowed to name --admin is the stop that says it is never used.
      if (line!.startsWith('ROUTE')) expect(line).not.toContain('--admin');
      else if (line!.includes('--admin')) expect(line).toMatch(/^STOP approval-missing: route [GU] needs an approval the fleet cannot give, and --admin is never used$/);
      for (const c of r.calls) {
        expect(c, 'a call carries --admin').not.toContain('--admin');
        expect(c, 'a call names a ruleset by id').not.toContain('rulesets');
      }
    }
  });

  it('the block text has no read 6, no licence line and no --admin spelling: no rulesets/ call, no admin=licensed, no current_user_can_bypass', () => {
    const b = blocks[0]!;
    expect(b).not.toContain('rulesets/');
    expect(b).not.toContain('admin=licensed');
    expect(b).not.toContain('licence-fails');
    expect(b).not.toContain('current_user_can_bypass');
    // The only code line that spells --admin is the stop that says it is never used (comment lines are dropped).
    expect(codeLines(b).filter((l) => l.includes('--admin')).map((l) => l.trim())).toEqual([
      'stop "approval-missing: route $route needs an approval the fleet cannot give, and --admin is never used"']);
    expect(b).toContain('stop "approval-missing: route $route needs an approval the fleet cannot give, and --admin is never used"');
    expect(b).toContain('say "ROUTE $route method=$method admin=never strict=$strict"');
  });

  it('reads the head\'s checks only once read 1 has shown the head is handoffCommit', () => {
    const r = verdict(with_(measured, { pr: ok({ baseRefName: 'main', headRefOid: 'f'.repeat(40), state: 'OPEN', reviewDecision: '' }) })());
    expect(r.calls).toEqual(['pr view 42 --json baseRefName,headRefOid,state,reviewDecision']);
  });

  it('reads the head\'s check runs and its statuses once each, paginated: a later page is part of the answer', () => {
    const r = verdict(measured());
    expect(r.out).toBe(`${GOOD_Q}\n`);
    expect(r.calls.filter((c) => c.includes('/commits/'))).toEqual([
      `api --paginate repos/{owner}/{repo}/commits/${HC}/check-runs`, `api --paginate repos/{owner}/{repo}/commits/${HC}/status`]);
    // The stub answers a call without --paginate with page 1 only, so dropping the flag cannot read the later pages.
    const lost = verdict(with_(measured, { checkruns: pages(CR_PAGE_1, { total_count: 5, check_runs: 7 }) })());
    expect(lost.out, 'a malformed page 2 of the check runs was not read').toBe(`${R5}\n`);
  });

  it('reads the PR\'s reviews once, paginated, right after the head guard and before read 2; a MERGED PR reads none', () => {
    const r = verdict(measured());
    expect(r.calls.slice(0, 3)).toEqual(['pr view 42 --json baseRefName,headRefOid,state,reviewDecision',
      'api --paginate repos/{owner}/{repo}/pulls/42/reviews', 'api --paginate repos/{owner}/{repo}/rules/branches/main']);
    expect(r.calls.filter((c) => c.includes('/reviews'))).toHaveLength(1);
    const merged = verdict(with_(measured, { pr: prWith(CR, { state: 'MERGED' }) })());
    expect(merged.calls).toEqual(['pr view 42 --json baseRefName,headRefOid,state,reviewDecision']);
  });

  it('a request stops before read 2: no rules, protection, settings or check read follows the reviews', () => {
    const r = verdict(with_(measured, { reviews: ok([rev(7, CR)]) })());
    expect(r.out).toBe(`${askLine(false, 7)}\n`);
    expect(r.calls).toEqual(['pr view 42 --json baseRefName,headRefOid,state,reviewDecision',
      'api --paginate repos/{owner}/{repo}/pulls/42/reviews']);
    const s = verdict(with_(measured, { reviews: ok([rev(7, CR)]) })(), keyFor(false, 7));
    expect(s.out, `stderr: ${s.stderr}`).toBe(`${GOOD_Q}\n`);
    expect(s.calls.filter((c) => c.includes('/reviews')), 'an ignore still reads and validates the reviews').toHaveLength(1);
  });

  it('prints safe identifiers only: a reviewer login never reaches the stop line', () => {
    const r = verdict(with_(measured, { reviews: ok([rev(7, CR)]) })());
    expect(r.out).not.toContain('reviewer-a');
    expect(r.out.trim().split('\n')).toHaveLength(1);
  });

  it('reads no ruleset by id, for any configuration: the pre-queue one, this repository as measured and a ruleset carrying required checks', () => {
    expect(verdict(preQueue()).calls.filter((c) => c.includes('/rulesets/'))).toEqual([]);
    expect(verdict(measured()).calls.filter((c) => c.includes('/rulesets/'))).toEqual([]);
    expect(verdict(APPROVAL_WITH_RULESET[1]()).calls.filter((c) => c.includes('/rulesets/'))).toEqual([]);
  });

  it('re-reads only read 5 while it waits within the bound', () => {
    const r = verdict(with_(measured, { checkruns: runs(run('test (agent)'), run('test (pwa)'), run('build-pwa')) })(),
      { BOUND_S: '2', POLL_S: '1' });
    expect(r.out).toBe('STOP not-reported: test (server) within 2s\n');
    expect(r.calls.filter((c) => c.endsWith('/check-runs')).length).toBeGreaterThanOrEqual(2);
    expect(r.calls.filter((c) => c.startsWith('pr view'))).toHaveLength(1);
  });
});

// ---- Fix round 2, F9: the bounded wait is a budget of SLEEPING, and no sleep passes what is left of it ----
// The loop sleeps, then reads read 5, and stops once the budget is spent; the read after the last sleep is the one that
// judges the wait. These cases run the block under a virtual clock (`VIRTUAL_CLOCK`), so what they assert is the sleeps
// the block REQUESTED, never how long a loaded box took to run it: no case waits, and none asserts a wall-clock total.
// What stays unbounded is outside this block's reach and is not asserted here: the time a `gh` call takes (the stub answers
// at once), the final read after the last sleep, and the scheduling around them. The Bash call's own timeout is what bounds
// those; nothing in this shell is a hard network deadline.
const STILL_MISSING = (): Fixture =>
  with_(measured, { checkruns: runs(run('test (agent)'), run('test (pwa)'), run('build-pwa')) })();

/** `test (server)` has not reported until the `sleeps`th sleep has run; `late` is what the read that follows that sleep gets. */
const waitedFor = (bound: number, poll: number, sleeps: number, late: Fixture = {}): Result =>
  verdict(STILL_MISSING(), { BOUND_S: String(bound), POLL_S: String(poll), VS_LATE: String(sleeps) }, {}, { late });

/** Every sleep requested is a positive whole number no longer than POLL_S and no longer than the budget that was left when
 *  it was requested. The block's clock never runs slower than the sleeps it asked for, so the sum of the requests is a
 *  ceiling on the budget used, whatever a loaded box adds (a whole-second tick only shortens the wait). */
function expectWithinBudget(r: Result, bound: number, poll: number): void {
  expect(r.sleeps.every((s) => /^[1-9]\d*$/.test(s)), `a sleep that is not a positive whole number: ${r.sleeps.join(',')}`).toBe(true);
  let spent = 0;
  for (const s of r.sleeps.map(Number)) {
    expect(s, `asked to sleep ${s}s with POLL_S=${poll}`).toBeLessThanOrEqual(poll);
    expect(s, `asked to sleep ${s}s with only ${bound - spent}s of the ${bound}s left (requests so far: ${r.sleeps.join(',')})`)
      .toBeLessThanOrEqual(bound - spent);
    spent += s;
  }
}

/** [BOUND_S, POLL_S, sleeps the budget takes]: a budget the interval does not divide, one it divides, and an interval
 *  longer than the whole budget. The sizes keep a tick of a second or two from changing the count. */
const BUDGETS: [bound: number, poll: number, sleeps: number][] = [[70, 30, 3], [90, 30, 3], [100, 60, 2], [20, 300, 1]];

describe('the bounded wait never sleeps past its budget (fix round 2, F9)', () => {
  for (const [bound, poll, n] of BUDGETS) {
    it(`BOUND_S=${bound} POLL_S=${poll}: ${n} sleeps, each within what is left, then a stop for a name that never reports`, () => {
      const r = waitedFor(bound, poll, n);
      expect(r.out, `stderr: ${r.stderr}`).toBe(`STOP not-reported: test (server) within ${bound}s\n`);
      expectWithinBudget(r, bound, poll);
      expect(r.sleeps).toHaveLength(n);
      // A read follows every sleep (the last one included) and no sleep follows the budget's end.
      expect(r.calls.filter((c) => c.endsWith('/check-runs'))).toHaveLength(n + 1);
      expect(r.calls.filter((c) => c.startsWith('pr view'))).toHaveLength(1);
    });
  }

  it('a budget the interval does not divide ends in one shortened sleep, and an interval longer than the budget is itself shortened', () => {
    const r = waitedFor(70, 30, 3);
    expect(r.sleeps.slice(0, 2)).toEqual(['30', '30']);
    expect(Number(r.sleeps[2])).toBeLessThanOrEqual(10);
    const long = waitedFor(20, 300, 1);
    expect(Number(long.sleeps[0]), 'a POLL_S above BOUND_S is asked for whole').toBeLessThanOrEqual(20);
  });

  // The read after the last sleep decides the wait, so each of its three answers is classified, not assumed.
  const FINAL: [name: string, late: Fixture, line: string][] = [
    ['a name that reports at the final read is read again, and lands', { checkruns: classicGreen() }, GOOD_Q],
    ['a name that reports at the final read as still running waits', { checkruns: runs(run('test (server)', null, 'in_progress'),
      run('test (agent)'), run('test (pwa)'), run('build-pwa')) }, 'WAIT pending: test (server)'],
    ['a name that reports at the final read as red is red', { checkruns: runs(run('test (server)', 'failure'), run('test (agent)'),
      run('test (pwa)'), run('build-pwa')) }, 'RED test (server) [github-actions]'],
    ['a final read that is an empty answer from the check runs stops unreadable', { checkruns: raw200('') }, R5],
    ['a final read that fails stops unreadable', { checkruns: fail(500) }, R5],
    ['a final read whose check runs are an object stops unreadable', { checkruns: raw200('{"check_runs":{}}') }, R5],
    ['a final read that is an empty answer from the statuses stops unreadable', { status: raw200('') }, R5],
  ];
  for (const [name, late, line] of FINAL) {
    it(`BOUND_S=70 POLL_S=30: ${name}`, () => {
      const r = waitedFor(70, 30, 3, late);
      expect(r.out, `stderr: ${r.stderr}`).toBe(`${line}\n`);
      expectWithinBudget(r, 70, 30);
      expect(r.sleeps).toHaveLength(3);
      expect(r.calls.filter((c) => c.endsWith('/check-runs')), 'the read after the last sleep was never made').toHaveLength(4);
    });
  }

  it('a name that never reports is still the stop not-reported at the final read, and only a bounded invocation stops', () => {
    const r = waitedFor(70, 30, 3, { checkruns: runs(run('test (agent)'), run('test (pwa)'), run('build-pwa')) });
    expect(r.out).toBe('STOP not-reported: test (server) within 70s\n');
    const once = verdict(STILL_MISSING(), {}, {}, { late: {} });
    expect(once.out, 'without BOUND_S the verdict waits for nothing').toBe('WAIT not-reported: test (server)\n');
    expect(once.sleeps).toEqual([]);
  });

  // F12: only read 5 is read again while the verdict waits. Reviews, rules and the head are this invocation's snapshot, so
  // the route a bounded invocation prints is discarded as permission, and the COMPLETE verdict runs afresh with BOUND_S=0.
  it('the fresh verdict after a bounded wait that routed reads everything again and waits for nothing: a name newly required is a WAIT, not another bound', () => {
    const first = waitedFor(300, 30, 2, { checkruns: classicGreen() });
    // The name reports after the second sleep, so the wait ends with 240 of its 300 seconds unspent.
    expect(first.out, `stderr: ${first.stderr}`).toBe(`${GOOD_Q}\n`);
    expect(first.calls.filter((c) => c.endsWith('/reviews')), 'the bounded run read the reviews once, at its start').toHaveLength(1);
    expect(first.calls.filter((c) => c.endsWith('/rules/branches/main'))).toHaveLength(1);
    // The fresh run, a moment later: an operator added a required name that nothing has reported.
    const added = ok({ ...((measured().protection as Answer).body as Record<string, unknown>),
      required_status_checks: { strict: false, contexts: [...CLASSIC, 'added/ci'],
        checks: [...CLASSIC, 'added/ci'].map((c) => ({ context: c, app_id: 15368 })) } });
    const fresh = verdict(with_(measured, { protection: added, checkruns: classicGreen() })(), { BOUND_S: '0' }, {}, { late: {} });
    expect(fresh.out, `stderr: ${fresh.stderr}`).toBe('WAIT not-reported: added/ci\n');
    expect(fresh.sleeps, 'BOUND_S=0 starts no wait: the bound is not repeated').toEqual([]);
    // It is a COMPLETE verdict: the reviews, the rules and the protection are read again, not carried over.
    expect(fresh.calls.filter((c) => c.endsWith('/reviews'))).toHaveLength(1);
    expect(fresh.calls.filter((c) => c.endsWith('/rules/branches/main'))).toHaveLength(1);
    expect(fresh.calls.filter((c) => c.endsWith('/protection'))).toHaveLength(1);
    // And the same repository without the added name is the route the bounded run printed.
    const same = verdict(with_(measured, { checkruns: classicGreen() })(), { BOUND_S: '0' }, {}, { late: {} });
    expect(same.out).toBe(`${GOOD_Q}\n`);
    expect(same.sleeps).toEqual([]);
  });

  it('the fresh verdict reads a request for changes that arrived during the wait: the snapshot of the bounded run is not carried over', () => {
    const first = waitedFor(300, 30, 2, { checkruns: classicGreen() });
    expect(first.out).toBe(`${GOOD_Q}\n`);
    const fresh = verdict(with_(measured, { checkruns: classicGreen(), reviews: ok([rev(7, CR)]) })(), { BOUND_S: '0' }, {}, { late: {} });
    expect(fresh.out).toBe(`${askLine(false, 7)}\n`);
    expect(fresh.sleeps).toEqual([]);
  });

  // The path through the spent budget the first scenario does not reach: the missing name starts RUNNING during the bound, so
  // the bounded run itself prints WAIT pending (the loop ends on a name that reported, with time left in the bound). These cases
  // show what the BLOCK does, nothing more: it starts no wait of its own, and a run with no bound sleeps for nothing whatever
  // it finds. That the coordinator then reports the line and watches nothing, in this attempt, is the skill's prose, owned by
  // the pins in coordinator-skill.test.ts; no shell test of the verdict alone proves that prose is followed.
  it('block behaviour: a name that starts running during the bound ends the bounded wait with WAIT pending, and a later run with no bound starts no wait of its own', () => {
    const running = runs(run('test (server)', null, 'in_progress'), run('test (agent)'), run('test (pwa)'), run('build-pwa'));
    const first = waitedFor(300, 30, 2, { checkruns: running });
    expect(first.out, `stderr: ${first.stderr}`).toBe('WAIT pending: test (server)\n');
    expectWithinBudget(first, 300, 30);
    expect(first.sleeps, 'the loop ends on the name that reported, with time left in the bound').toHaveLength(2);
    expect(first.calls.filter((c) => c.endsWith('/check-runs'))).toHaveLength(3);
    // A later run in the same attempt uses BOUND_S=0, as every later run does: with the name now passing and another required
    // name that nothing has reported, it prints WAIT not-reported and sleeps for nothing. Reporting that line is the prose's job.
    const added = ok({ ...((measured().protection as Answer).body as Record<string, unknown>),
      required_status_checks: { strict: false, contexts: [...CLASSIC, 'added/ci'],
        checks: [...CLASSIC, 'added/ci'].map((c) => ({ context: c, app_id: 15368 })) } });
    const fresh = verdict(with_(measured, { protection: added, checkruns: classicGreen() })(), { BOUND_S: '0' }, {}, { late: {} });
    expect(fresh.out, `stderr: ${fresh.stderr}`).toBe('WAIT not-reported: added/ci\n');
    expect(fresh.sleeps, 'a run with no bound starts no wait of its own').toEqual([]);
  });

  it('block behaviour: the verdict after a rerun is a run with no bound, so a WAIT it finds is printed with no sleep in it', () => {
    for (const [name, answer, line] of [
      ['a rerun still running', runs(run('test (server)', null, 'in_progress'), run('test (agent)'), run('test (pwa)'), run('build-pwa')),
        'WAIT pending: test (server)'],
      ['a rerun not yet reported', runs(run('test (agent)'), run('test (pwa)'), run('build-pwa')), 'WAIT not-reported: test (server)'],
    ] as const) {
      const r = verdict(with_(measured, { checkruns: answer })(), { BOUND_S: '0' }, {}, { late: {} });
      expect(r.out, `${name}; stderr: ${r.stderr}`).toBe(`${line}\n`);
      expect(r.sleeps, name).toEqual([]);
    }
  });
});
