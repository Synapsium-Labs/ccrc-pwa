// Landing-order wave 3e (spec 2026-09-23 §5.7): the coordinator lands a PR by the route the repository's own rules
// give, read fresh before each landing. `references/wave-lifecycle.md` §5b carries ONE fenced bash block, the landing
// verdict: it makes reads 1 to 6 with gh and prints exactly one line, a route with its method and its licence, a
// wait, a red, a merged PR to prove, or a stop with its reason. It never merges.
//
// This file extracts that block and RUNS it, against a stub gh that answers fixture JSON per read, with one case per
// route and per stop the reads decide (§5.7.5). The fixture every case starts from is this repository as measured on
// 2026-10-21 (§5.7.7), which must still answer route Q. A comment is a request; a red suite is a mechanism: the skill's
// prose says what the coordinator does with each line, and this file is what holds the line itself in place.
//
// The stub is an executable `gh` first on PATH in a fixture HOME. It logs every argv and answers an argv it does not
// know with exit 90, so a block that reached for anything but the six reads fails closed.
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
 *  on any non-2xx, with GitHub's error body on stdout (measured: gh prints it there and its message on stderr). */
type Answer = { code: number; body?: unknown; raw?: string };
type Key = 'pr' | 'rules' | 'protection' | 'branch' | 'repo' | 'compare' | 'checkruns' | 'status' | 'ruleset';
type Fixture = Partial<Record<Key, Answer | Answer[]>>;

const ok = (body: unknown): Answer => ({ code: 200, body });
const fail = (code: number, message = 'Server Error'): Answer => ({ code, body: { message, status: String(code) } });
const run = (name: string, conclusion: string | null = 'success', status = 'completed', app: unknown = ACTIONS) =>
  ({ name, status, conclusion: status === 'completed' ? conclusion : null, app, output: { text: 'x'.repeat(64) } });
const pages = (...ps: unknown[]): Answer => ({ code: 200, raw: ps.map((p) => JSON.stringify(p)).join('\n') });
const runs = (...rs: unknown[]): Answer => ok({ total_count: rs.length, check_runs: rs });

/** This repository on 2026-10-21 (§5.7.7): squash only, a queue rule merging by SQUASH, the four classic checks at
 *  one App id with `enforce_admins` on, no approval required, and a head with no commit status at all. */
const measured = (): Fixture => ({
  pr: ok({ baseRefName: 'main', headRefOid: HC, state: 'OPEN', reviewDecision: '' }),
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
  checkruns: pages(
    { total_count: 5, check_runs: [run('test (server)'), run('test (agent)'), run('map-build', 'failure')] },
    { total_count: 5, check_runs: [run('test (pwa)'), run('build-pwa', 'skipped')] }),
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

const STUB = `#!/bin/sh
printf '%s\\n' "$*" >> "$FX/calls"
case "$*" in
  "pr view "*) k=pr ;;
  "api --paginate repos/{owner}/{repo}/rules/branches/"*) k=rules ;;
  "api -i repos/{owner}/{repo}/branches/"*/protection) k=protection ;;
  "api repos/{owner}/{repo}/branches/"*) k=branch ;;
  "api repos/{owner}/{repo}") k=repo ;;
  "api repos/{owner}/{repo}/compare/"*) k=compare ;;
  "api --paginate repos/{owner}/{repo}/commits/"*/check-runs) k=checkruns ;;
  "api --paginate repos/{owner}/{repo}/commits/"*/status) k=status ;;
  "api repos/{owner}/{repo}/rulesets/"*) k=ruleset ;;
  *) echo "fixture gh: unexpected argv: $*" >&2; exit 90 ;;
esac
n=$(( $(cat "$FX/$k.n" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$FX/$k.n"
p="$FX/$k"; [ -f "$FX/$k.$n.out" ] && p="$FX/$k.$n"
[ -f "$p.out" ] || { echo "fixture gh: no answer for $k" >&2; exit 91; }
cat "$p.out"
rc=$(cat "$p.rc")
[ "$rc" = 0 ] || echo "gh: fixture (HTTP $(cat "$p.code"))" >&2
exit "$rc"
`;

type Result = { out: string; calls: string[]; stderr: string };

function verdict(fx: Fixture, env: Record<string, string> = {}): Result {
  const home = mkTmp('ccrc-landing-verdict-');
  const bin = path.join(home, 'bin');
  const dir = path.join(home, 'fx');
  mkdirSync(bin, { recursive: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(bin, 'gh'), STUB, { mode: 0o755 });
  writeFileSync(path.join(dir, 'calls'), '');
  for (const [k, v] of Object.entries(fx) as [Key, Answer | Answer[]][]) {
    const seq = Array.isArray(v) ? v : [v];
    seq.forEach((a, i) => {
      const stem = path.join(dir, Array.isArray(v) && i < seq.length - 1 ? `${k}.${i + 1}` : k);
      const text = k === 'protection' ? included(a) : (a.raw ?? JSON.stringify(a.body ?? null));
      writeFileSync(`${stem}.out`, text);
      writeFileSync(`${stem}.rc`, a.code === 200 ? '0' : '1');
      writeFileSync(`${stem}.code`, String(a.code));
    });
  }
  const script = blocks[0]!.replace(/<pr>/g, '42').replace(/<handoffCommit>/g, HC);
  const r = spawnSync('bash', ['-c', script], {
    cwd: home, encoding: 'utf8', timeout: 15000,
    env: { PATH: `${bin}:${process.env['PATH'] ?? ''}`, HOME: home, FX: dir, ...env },
  });
  const calls = readFileSync(path.join(dir, 'calls'), 'utf8').split('\n').filter(Boolean);
  return { out: r.stdout, calls, stderr: r.stderr };
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

const ROUTES: Case[] = [
  ['route Q: this repository as measured (§5.7.7), the four classic checks gating the enqueue', measured,
    'ROUTE Q method=squash admin=never strict=no'],
  ['route Q: a paginated rules answer printed as two arrays is still one rule set',
    with_(measured, { rules: { code: 200, raw: JSON.stringify([pull({})]) + JSON.stringify([queue('SQUASH')]) } }),
    'ROUTE Q method=squash admin=never strict=no'],
  ['route G: merge commits only and a third-party App check in a ruleset (the motivating repository)', thirdParty,
    'ROUTE G method=merge admin=never strict=no'],
  ['route G: the pre-queue configuration lands under the approval licence (§5.7.7)', preQueue,
    'ROUTE G method=squash admin=licensed strict=no'],
  ['route G: an approval that is given licenses nothing', with_(preQueue, (f) => ({ ...f,
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
  ['route U: an approval kept in classic protection alone, with enforce_admins on, is licensed (Pre-flight 10(c))', with_(bare, {
    protection: ok({ enforce_admins: { enabled: true }, required_pull_request_reviews: { required_approving_review_count: 1 },
      required_linear_history: { enabled: false }, required_signatures: { enabled: false } }),
    pr: ok({ baseRefName: 'main', headRefOid: HC, state: 'OPEN', reviewDecision: 'REVIEW_REQUIRED' }) }),
    'ROUTE U method=squash admin=licensed strict=no'],
  ['route G: an approval is required and the reviewDecision is empty, so nothing is licensed', with_(preQueue, (f) => ({ ...f,
    pr: ok({ baseRefName: 'main', headRefOid: HC, state: 'OPEN', reviewDecision: '' }) })),
    'ROUTE G method=squash admin=never strict=no'],
  ['route G: an approval is required and the reviewDecision is null, so nothing is licensed', with_(preQueue, (f) => ({ ...f,
    pr: ok({ baseRefName: 'main', headRefOid: HC, state: 'OPEN', reviewDecision: null }) })),
    'ROUTE G method=squash admin=never strict=no'],
  ['route G: an approval is required and the reviewDecision is a word the block does not list, so nothing is licensed',
    with_(preQueue, (f) => ({ ...f, pr: ok({ baseRefName: 'main', headRefOid: HC, state: 'OPEN', reviewDecision: 'SOMETHING_NEW' }) })),
    'ROUTE G method=squash admin=never strict=no'],
  ['route U: no approval is required and a review requests changes, so the route is as it was and nothing is licensed',
    with_(bare, { pr: ok({ baseRefName: 'main', headRefOid: HC, state: 'OPEN', reviewDecision: 'CHANGES_REQUESTED' }) }),
    'ROUTE U method=squash admin=never strict=no'],
  ['route Q: no approval is required and a review requests changes, so the queue route is as it was',
    with_(measured, { pr: ok({ baseRefName: 'main', headRefOid: HC, state: 'OPEN', reviewDecision: 'CHANGES_REQUESTED' }) }),
    'ROUTE Q method=squash admin=never strict=no'],
  ['route Q: an approval is required and a review requests changes, which stops no queue landing',
    with_(measured, (f) => ({ ...f, ...rules(pull({ required_approving_review_count: 1 }), queue('SQUASH')),
      pr: ok({ baseRefName: 'main', headRefOid: HC, state: 'OPEN', reviewDecision: 'CHANGES_REQUESTED' }) })),
    'ROUTE Q method=squash admin=never strict=no'],
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
  ['read 3b leaves the route unknowable: the admin licence would be weighed', with_(via3b, (f) => ({ ...f,
    ...rules(pull({ required_approving_review_count: 1 })),
    pr: ok({ baseRefName: 'main', headRefOid: HC, state: 'OPEN', reviewDecision: 'REVIEW_REQUIRED' }) })),
    'STOP read-3b-unknowable: an approval is missing and read 3 answered 403'],
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
  ['changes-requested: a ruleset requires an approval and a review requests changes', with_(preQueue, (f) => ({ ...f,
    pr: ok({ baseRefName: 'main', headRefOid: HC, state: 'OPEN', reviewDecision: 'CHANGES_REQUESTED' }) })),
    'STOP changes-requested: an approval is required and a review requests changes'],
  ['changes-requested: classic protection alone requires an approval and a review requests changes', with_(bare, {
    protection: ok({ enforce_admins: { enabled: true }, required_pull_request_reviews: { required_approving_review_count: 1 },
      required_linear_history: { enabled: false }, required_signatures: { enabled: false } }),
    pr: ok({ baseRefName: 'main', headRefOid: HC, state: 'OPEN', reviewDecision: 'CHANGES_REQUESTED' }) }),
    'STOP changes-requested: an approval is required and a review requests changes'],
  ['changes-requested is decided before the licence is weighed: another gate does not turn it into licence-fails',
    with_(preQueue, (f) => ({ ...f, ...rules(pull({ required_approving_review_count: 1 }), { type: 'code_scanning', ruleset_id: 9, parameters: {} }),
      pr: ok({ baseRefName: 'main', headRefOid: HC, state: 'OPEN', reviewDecision: 'CHANGES_REQUESTED' }) })),
    'STOP changes-requested: an approval is required and a review requests changes'],
  ['changes-requested is decided before read 3b stops the licence: it is not read-3b-unknowable',
    with_(via3b, (f) => ({ ...f, ...rules(pull({ required_approving_review_count: 1 })),
      pr: ok({ baseRefName: 'main', headRefOid: HC, state: 'OPEN', reviewDecision: 'CHANGES_REQUESTED' }) })),
    'STOP changes-requested: an approval is required and a review requests changes'],
  ['the approval licence fails: another gate an admin could skip', with_(preQueue, (f) => ({ ...f,
    ...rules(pull({ required_approving_review_count: 1 }), { type: 'code_scanning', ruleset_id: 9, parameters: {} }) })),
    'STOP licence-fails: an approval is missing and --admin could skip code_scanning'],
  ['the approval licence fails: classic signatures are another gate', with_(preQueue, (f) => ({ ...f,
    protection: ok({ ...(measured().protection as Answer).body as object, required_signatures: { enabled: true } }) })),
    'STOP licence-fails: an approval is missing and --admin could skip classic required_signatures'],
  ['the approval licence fails: enforce_admins is off over the classic checks', with_(preQueue, (f) => ({ ...f,
    protection: ok({ ...(measured().protection as Answer).body as object, enforce_admins: { enabled: false } }) })),
    'STOP licence-fails: an approval is missing and enforce_admins is off over the classic checks'],
  ['the approval licence fails: a ruleset with required checks the login may bypass', with_(preQueue, (f) => ({ ...f,
    ...rules(pull({ required_approving_review_count: 1 }), rsc([{ context: 'build-pwa', integration_id: 15368 }], 21)),
    ruleset: ok({ id: 21, current_user_can_bypass: 'pull_requests_only' }) })),
    'STOP licence-fails: an approval is missing and ruleset 21 answers pull_requests_only'],
  ['the approval licence fails: an unreadable read 6 counts as able to bypass', with_(preQueue, (f) => ({ ...f,
    ...rules(pull({ required_approving_review_count: 1 }), rsc([{ context: 'build-pwa', integration_id: 15368 }], 21)),
    ruleset: fail(404, 'Not Found') })),
    'STOP licence-fails: an approval is missing and ruleset 21 answers unreadable'],
  ['the approval licence fails: a required_status_checks rule that names no ruleset has no read 6, so counts as able to bypass',
    with_(preQueue, (f) => ({ ...f, ...rules(pull({ required_approving_review_count: 1 }), { type: 'required_status_checks',
      parameters: { strict_required_status_checks_policy: false, required_status_checks: [{ context: 'build-pwa', integration_id: 15368 }] } }),
    ruleset: ok({ id: 21, current_user_can_bypass: 'never' }) })),
    'STOP licence-fails: an approval is missing and a required_status_checks rule names no ruleset'],
  ['the approval licence fails: a ruleset requires review threads resolved, which the bypass skips with the approval',
    with_(preQueue, (f) => ({ ...f, ...rules(pull({ required_approving_review_count: 1, required_review_thread_resolution: true })) })),
    'STOP licence-fails: an approval is missing and --admin could skip conversation resolution'],
  ['the approval licence fails: classic conversation resolution without enforce_admins', with_(preQueue, (f) => ({ ...f,
    protection: ok({ required_conversation_resolution: { enabled: true }, enforce_admins: { enabled: false },
      required_linear_history: { enabled: false }, required_signatures: { enabled: false } }) })),
    'STOP licence-fails: an approval is missing and --admin could skip conversation resolution'],
];

const LICENSED_NEVER: Case = ['the approval licence holds: every ruleset with required checks answers never', with_(preQueue, (f) => ({ ...f,
  ...rules(pull({ required_approving_review_count: 1 }), rsc([{ context: 'build-pwa', integration_id: 15368 }], 21)),
  ruleset: ok({ id: 21, current_user_can_bypass: 'never' }) })), 'ROUTE G method=squash admin=licensed strict=no'];

/** Every argv the block may send: the six reads (and the compare under read 3b), as GETs. */
const READ = /^(pr view 42 --json baseRefName,headRefOid,state,reviewDecision|api (--paginate |-i )?repos\/\{owner\}\/\{repo\}(\/[^\s]*)?)$/;
/** The same reads as the block's TEXT spells them, from the word `gh` to the end of its quoted path, followed only by
 *  the close of its `$(…)`, a pipe, or read 3's one `2>/dev/null` before that close. An allowlist, so a write under a
 *  branch no case reaches is still a red: `gh pr review`, `gh api --method=PATCH …` and `gh api -XPATCH …` match none
 *  of it. It judges a LOGICAL line (see `ghSpelled`), so a write split over a `\` continuation cannot hide its flags
 *  on the next physical line. */
const GH_SPELLED = /^gh (pr view "\$PR" --json baseRefName,headRefOid,state,reviewDecision\)|api (--paginate |-i )?"repos\/\{owner\}\/\{repo\}[^"\s]*"(?=\)|\s+\||\s+2>\/dev\/null\)))/;
/** Every gh the block's text spells, each from the word `gh` to the end of its logical line: backslash continuations
 *  are joined first, so the whole call is judged and not only its first physical line. */
const ghSpelled = (b: string): string[] => {
  const logical = b.replace(/\\\n[ \t]*/g, ' ');
  return [...logical.matchAll(/\bgh\b/g)].map((m) => logical.slice(m.index).split('\n')[0]!);
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
    expect(ghSpelled(b).length, 'the block spells fewer gh reads than its nine').toBeGreaterThanOrEqual(9);
    expect(ghOffenders(b), 'the block spells a gh that is not one of the reads').toEqual([]);
    expect(b).not.toContain('graphql');
    expect(b).not.toMatch(/\brm\s/);
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

  it.each([...ROUTES, ...CHECKS, ...STOPS, LICENSED_NEVER])('%s', (_name, fx, line, env) => {
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

  it('reads the head\'s checks only once read 1 has shown the head is handoffCommit', () => {
    const r = verdict(with_(measured, { pr: ok({ baseRefName: 'main', headRefOid: 'f'.repeat(40), state: 'OPEN', reviewDecision: '' }) })());
    expect(r.calls).toEqual(['pr view 42 --json baseRefName,headRefOid,state,reviewDecision']);
  });

  it('weighs read 6 only for the licence, and only for a ruleset that carries required checks', () => {
    expect(verdict(preQueue()).calls.filter((c) => c.includes('/rulesets/'))).toEqual([]);
    expect(verdict(measured()).calls.filter((c) => c.includes('/rulesets/'))).toEqual([]);
    expect(verdict(LICENSED_NEVER[1]()).calls.filter((c) => c.includes('/rulesets/')))
      .toEqual(['api repos/{owner}/{repo}/rulesets/21']);
  });

  it('re-reads only read 5 while it waits within the bound', () => {
    const r = verdict(with_(measured, { checkruns: runs(run('test (agent)'), run('test (pwa)'), run('build-pwa')) })(),
      { BOUND_S: '2', POLL_S: '1' });
    expect(r.out).toBe('STOP not-reported: test (server) within 2s\n');
    expect(r.calls.filter((c) => c.endsWith('/check-runs')).length).toBeGreaterThanOrEqual(2);
    expect(r.calls.filter((c) => c.startsWith('pr view'))).toHaveLength(1);
  });
});
