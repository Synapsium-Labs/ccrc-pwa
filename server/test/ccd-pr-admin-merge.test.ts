// `ccd pr-admin-merge` (D-8124): the one gated door for an admin merge. FIXTURE HOME ONLY (`makePrHarness`); the verb
// runs as a sourced function with `gh`, `tmux` and `timeout` shell functions (`ccdAdminMergeFixture.ts`).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CCD, ccdSource } from './ccdWsHelpers.js';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { AM_GH_STUB, AM_PROT_NONE, HEAD_A, HEAD_B, amCaller, amCheckRun, amFixture, amProt, amRun, boxEnv, swapLog } from './ccdAdminMergeFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-ccd-am-'); });
afterEach(() => { h.cleanup(); });

const GOOD = `--repo owner-a/repo-a --pr 42 --head ${HEAD_A}`;
const reg = (name: string): string => path.join(h.home, '.cc-sessions', name);

describe('the gate before GitHub', () => {
  it('takes exactly --repo, --pr, --head in that order, and nothing else', () => {
    amFixture(h); amCaller(h, 'demo-quiet-basin');
    for (const argv of [`--repo owner-a/repo-a --pr 42`, `--pr 42 --repo owner-a/repo-a --head ${HEAD_A}`,
      `--repo owner-a/repo-a --pr 42 --head ${HEAD_A} --admin`, `--repo owner-a --pr 42 --head ${HEAD_A}`,
      `--repo owner-a/repo-a --pr 042 --head ${HEAD_A}`, `--repo owner-a/repo-a --pr 42 --head ${HEAD_A.slice(1)}`,
      `--repo -x/repo-a --pr 42 --head ${HEAD_A}`, `--repo .x/repo-a --pr 42 --head ${HEAD_A}`,
      `--repo owner-a/-y --pr 42 --head ${HEAD_A}`, `--repo owner-a/repo-a --pr 42 --head ${'A'.repeat(40)}`]) {
      const r = amRun(h, argv);
      expect(r.code, argv).toBe(1);
      expect(r.stderr, argv).toMatch(/usage: ccd pr-admin-merge --repo <owner\/repo> --pr <n> --head <sha>/);
      expect(r.stdout, argv).toBe('');
    }
    expect(h.ghCalls()).toEqual([]);
    expect(swapLog(h), 'argv failures are not journaled').toEqual([]);
  });

  it('refuses setting-off with no gh call', () => {
    amFixture(h); amCaller(h, 'demo-quiet-basin'); boxEnv(h, 'CCRC_ADMIN_MERGE=off\n');
    const r = amRun(h, GOOD);
    expect([r.code, r.stdout.trim()]).toEqual([2, 'REFUSED setting-off: CCRC_ADMIN_MERGE is off']);
    expect(h.ghCalls()).toEqual([]);
  });

  it('an environment CCRC_ADMIN_MERGE=auto does not override the box file\'s off: the switch is the operator\'s', () => {
    amFixture(h); amCaller(h, 'demo-quiet-basin'); boxEnv(h, 'CCRC_ADMIN_MERGE=off\n');
    const r = h.run(`${AM_GH_STUB} export TMUX_PANE=%1; export CCRC_ADMIN_MERGE=auto; cmd_pr_admin_merge ${GOOD}`);
    expect([r.code, r.stdout.trim()]).toEqual([2, 'REFUSED setting-off: CCRC_ADMIN_MERGE is off']);
    expect(h.ghCalls()).toEqual([]);
  });

  it('a refused value or a missing reader reads as off: setting-unread, no gh call', () => {
    amFixture(h); amCaller(h, 'demo-quiet-basin'); boxEnv(h, 'CCRC_ADMIN_MERGE=on\n');
    const r = amRun(h, GOOD);
    expect([r.code, r.stdout.trim()]).toEqual([2, 'REFUSED setting-unread: CCRC_ADMIN_MERGE must be auto or off (read as off)']);
    expect(h.ghCalls()).toEqual([]);

    // The reader moved away: a copy of ccd's directory without lib/ccrc-settings.sh, and no installed one under HOME.
    boxEnv(h, 'CCRC_ADMIN_MERGE=auto\n');
    const copy = path.join(h.home, 'ccd-copy');
    fs.cpSync(path.dirname(CCD), copy, { recursive: true });
    fs.rmSync(path.join(copy, 'lib', 'ccrc-settings.sh'));
    const r2 = spawnSync('bash', ['-c', 'a_src=$A_SRC a_snip=$A_SNIP; unset A_SRC A_SNIP; source "$a_src"; eval "$a_snip"'], {
      env: h.env({ A_SRC: path.join(copy, 'ccd'),
        A_SNIP: `${AM_GH_STUB} export TMUX_PANE=%1; cmd_pr_admin_merge ${GOOD}` }),
      cwd: h.home, encoding: 'utf8',
    });
    const out = r2.stdout.trim();
    expect(r2.status).toBe(2);
    expect(out).toBe('REFUSED setting-unread: the settings reader (ccrc-settings.sh) is missing or broken (read as off)');
    expect(h.ghCalls()).toEqual([]);
  });

  it('refuses a caller it cannot name: no pane, no tmux answer, no registry row', () => {
    amFixture(h);
    // no pane at all
    amCaller(h, 'demo-quiet-basin');
    let r = amRun(h, GOOD, { pane: null });
    expect([r.code, r.stdout.trim()]).toEqual([2, 'REFUSED caller-unknown: no tmux pane']);
    // tmux answers nothing
    fs.rmSync(path.join(h.home, 'am', 'tmux-session'));
    r = amRun(h, GOOD);
    expect([r.code, r.stdout.trim()]).toEqual([2, 'REFUSED caller-unknown: tmux names no ccrc session for this pane']);
    // tmux names a session that is not ccd-managed (no registry row)
    fs.writeFileSync(path.join(h.home, 'am', 'tmux-session'), 'cc-ghost-session\n');
    r = amRun(h, GOOD);
    expect([r.code, r.stdout.trim()]).toEqual([2, 'REFUSED caller-unknown: no registry row for ghost-session']);
    expect(h.ghCalls()).toEqual([]);
  });

  it('refuses a caller whose hold names a programme wave', () => {
    amFixture(h); amCaller(h, 'demo-quiet-basin', { hold: 'program:landing-order wave:2/5 run:17' });
    const r = amRun(h, GOOD);
    expect(r.code).toBe(2);
    expect(r.stdout).toMatch(/^REFUSED not-coordinator: /);
    expect(h.ghCalls()).toEqual([]);
  });

  it('refuses a caller carrying the child marker, readable or not', () => {
    amFixture(h); amCaller(h, 'demo-quiet-basin', { child: true });
    expect(amRun(h, GOOD).stdout).toMatch(/^REFUSED not-coordinator: demo-quiet-basin carries the child marker/);
    fs.chmodSync(reg('demo-quiet-basin.child'), 0o000);
    expect(amRun(h, GOOD).stdout).toMatch(/^REFUSED not-coordinator: demo-quiet-basin carries the child marker/);
    fs.chmodSync(reg('demo-quiet-basin.child'), 0o644);
    expect(h.ghCalls()).toEqual([]);
  });

  it('a hold that names no wave is not a worker hold (the hook reads it the same way)', () => {
    amFixture(h); amCaller(h, 'demo-quiet-basin', { hold: 'waiting on the review' });
    const r = amRun(h, GOOD);
    expect(r.stdout, 'the gate passes; the reads that follow refuse for their own reason').not.toMatch(/not-coordinator|caller-unknown|setting-/);
    expect(h.ghCalls()[0]).toBe('api repos/owner-a/repo-a');
  });

  it('a padded or CRLF hold naming a wave is a worker hold: the door trims as the hook does', () => {
    amFixture(h); amCaller(h, 'demo-quiet-basin');
    for (const raw of [' program:x wave:2\n', 'program:x wave:2 \n', 'program:x wave:2\r\n', '\nprogram:x wave:2\n',
      '\n\n  program:x wave:2/5 run:3 \t\r\n\n', 'program:x wave:2', `program:x wave:2${' '.repeat(200)}`]) {
      fs.writeFileSync(reg('demo-quiet-basin.hold'), raw);
      const r = amRun(h, GOOD);
      expect(r.code, JSON.stringify(raw)).toBe(2);
      expect(r.stdout, JSON.stringify(raw)).toMatch(/^REFUSED not-coordinator: demo-quiet-basin's hold reads program:x wave:2/);
    }
    expect(h.ghCalls()).toEqual([]);
  });

  it('padding does not turn a non-wave hold into a worker hold, and a hold that is not a regular file is refused', () => {
    amFixture(h); amCaller(h, 'demo-quiet-basin');
    for (const raw of ['\n waiting on the review \r\n', 'program:x wave:2 and more\n', 'program:x\nwave:2\n', '\n \n']) {
      fs.writeFileSync(reg('demo-quiet-basin.hold'), raw);
      expect(amRun(h, GOOD).stdout, JSON.stringify(raw)).not.toMatch(/not-coordinator/);
    }
    fs.rmSync(reg('demo-quiet-basin.hold'));
    fs.mkdirSync(reg('demo-quiet-basin.hold'));
    expect(amRun(h, GOOD).stdout).toMatch(/^REFUSED not-coordinator: demo-quiet-basin's hold cannot be read/);
  });

  it('a hold longer than the hook\'s bound is not judged, as the hook does not judge it', () => {
    amFixture(h); amCaller(h, 'demo-quiet-basin', { hold: `program:${'x'.repeat(130)} wave:2` });
    expect(amRun(h, GOOD).stdout).not.toMatch(/not-coordinator/);
  });

  it('journals a refusal past argv in swap.log with the caller and the reason', () => {
    amFixture(h); amCaller(h, 'demo-quiet-basin'); boxEnv(h, 'CCRC_ADMIN_MERGE=off\n');
    amRun(h, GOOD);
    expect(swapLog(h).at(-1)).toMatch(/ admin-merge-refused demo-quiet-basin: owner-a\/repo-a#42 head=[0-9a-f]{40} reason=setting-off$/);
  });

  it('journals an unnamed caller as ?', () => {
    amFixture(h);
    amRun(h, GOOD, { pane: null });
    expect(swapLog(h).at(-1)).toMatch(/ admin-merge-refused \?: owner-a\/repo-a#42 head=[0-9a-f]{40} reason=caller-unknown$/);
  });

  it('is dispatched and named in the usage line, and the gate\'s gh calls never carry --admin', () => {
    amFixture(h); amCaller(h, 'demo-quiet-basin');
    amRun(h, GOOD);
    for (const c of h.ghCalls()) expect(c).not.toMatch(/--admin/);
    const src = ccdSource();
    expect(src).toMatch(/^ {2}pr-admin-merge\) shift; cmd_pr_admin_merge "\$@" ;;$/m);
    expect(src).toMatch(/\|pr-open\|pr-admin-merge\|pr-state\|/);
  });
});

describe('the reads', () => {
  const ARGV = GOOD;
  const READS = [
    'api repos/owner-a/repo-a',
    'pr view 42 -R owner-a/repo-a --json state,isDraft,headRefOid,baseRefName,reviewDecision',
    'api --paginate repos/owner-a/repo-a/rules/branches/main',
    'api graphql',
    'api -i repos/owner-a/repo-a/branches/main/protection',
    'api --paginate repos/owner-a/repo-a/pulls/42/reviews',
    `api --paginate repos/owner-a/repo-a/commits/${HEAD_A}/check-runs?filter=latest`,
    `api --paginate repos/owner-a/repo-a/commits/${HEAD_A}/status`,
  ];
  /** The gh calls, each cut to the words that name the read (the GraphQL call carries its query text). */
  const calls = (): string[] => h.ghCalls().map((c) => (c.startsWith('api graphql') ? 'api graphql' : c));
  const refused = (argv: string = ARGV): string => {
    const r = amRun(h, argv);
    expect(r.code, r.stdout).toBe(2);
    expect(r.stdout.trim().split('\n'), 'exactly one line on stdout').toHaveLength(1);
    expect(h.ghCalls().some((c) => c.startsWith('pr merge')), 'no merge is ever attempted').toBe(false);
    return r.stdout.trim();
  };
  const journaled = (reason: string): void => {
    expect(swapLog(h).at(-1)).toMatch(new RegExp(` admin-merge-refused demo-quiet-basin: owner-a/repo-a#42 head=${HEAD_A} reason=${reason}$`));
  };
  beforeEach(() => { amCaller(h, 'demo-quiet-basin'); });

  it('refuses not-admin when permissions.admin is false, before any other read', () => {
    amFixture(h, { repo: { permissions: { admin: false } } });
    expect(refused()).toBe("REFUSED not-admin: the fleet's GitHub identity is not an admin of owner-a/repo-a");
    expect(h.ghCalls()).toEqual(['api repos/owner-a/repo-a']);
    journaled('not-admin');
  });

  it('a missing admin flag or a missing method setting is unreadable, never false', () => {
    amFixture(h, { repo: { allow_merge_commit: true, allow_squash_merge: true, allow_rebase_merge: true } });
    expect(refused()).toBe('REFUSED unreadable: the repository read');
    amFixture(h, { repo: { permissions: { admin: true }, allow_merge_commit: true, allow_squash_merge: true } });
    expect(refused()).toBe('REFUSED unreadable: the repository read');
    amFixture(h, { repo: { permissions: { admin: 'true' }, allow_merge_commit: true, allow_squash_merge: true, allow_rebase_merge: true } });
    expect(refused()).toBe('REFUSED unreadable: the repository read');
    journaled('unreadable');
  });

  it('refuses a base with a merge_queue rule', () => {
    amFixture(h, { rules: [{ type: 'merge_queue', parameters: { merge_method: 'SQUASH' } }] });
    expect(refused()).toBe('REFUSED merge-queue: main has a merge queue (a merge_queue rule); the queue lands it');
    expect(calls(), 'the rules read is the last').toEqual(READS.slice(0, 3));
    journaled('merge-queue');
  });

  it('refuses a base GraphQL names a mergeQueue for, with no rule in the rules read', () => {
    amFixture(h, { mq: { data: { repository: { mergeQueue: { id: 'MQ_x' } } } } });
    expect(refused()).toBe("REFUSED merge-queue: main has a merge queue (GitHub's mergeQueue read); the queue lands it");
    expect(calls()).toEqual(READS.slice(0, 4));
    const gql = h.ghCalls().find((c) => c.startsWith('api graphql'))!;
    expect(gql, 'the values are -f arguments, never interpolated into the query').toContain('-f o=owner-a -f r=repo-a -f b=main');
    expect(gql).not.toMatch(/query=[^ ]*owner-a/);
  });

  it('refuses when the mergeQueue read fails', () => {
    amFixture(h, { mq: null });
    expect(refused()).toBe('REFUSED unreadable: the merge queue read');
    amFixture(h, { mq: { errors: [{ message: 'nope' }], data: { repository: null } } });
    expect(refused()).toBe('REFUSED unreadable: the merge queue read');
    amFixture(h, { mq: { data: { repository: { id: 'R_x' } } } });
    expect(refused(), 'an answer with no mergeQueue field is not "no queue"').toBe('REFUSED unreadable: the merge queue read');
  });

  it('a base with a slash is read with its slash encoded', () => {
    amFixture(h, { pr: { state: 'OPEN', isDraft: false, headRefOid: HEAD_A, baseRefName: 'release/1.x', reviewDecision: '' } });
    refused();
    expect(h.ghCalls()[2]).toBe('api --paginate repos/owner-a/repo-a/rules/branches/release%2F1.x');
  });

  it('refuses a draft', () => {
    amFixture(h, { pr: { state: 'OPEN', isDraft: true, headRefOid: HEAD_A, baseRefName: 'main', reviewDecision: '' } });
    expect(refused()).toBe('REFUSED draft: the PR is a draft');
    expect(calls()).toEqual(READS.slice(0, 2));
    journaled('draft');
  });

  it('refuses a PR that is not OPEN', () => {
    for (const state of ['MERGED', 'CLOSED']) {
      amFixture(h, { pr: { state, isDraft: false, headRefOid: HEAD_A, baseRefName: 'main', reviewDecision: '' } });
      expect(refused()).toBe(`REFUSED not-open: the PR is ${state}`);
    }
    journaled('not-open');
  });

  it('refuses when the PR head is not the bound sha', () => {
    amFixture(h, { pr: { state: 'OPEN', isDraft: false, headRefOid: HEAD_B, baseRefName: 'main', reviewDecision: '' } });
    expect(refused()).toBe(`REFUSED not-at-head: the PR head is ${HEAD_B}`);
    expect(calls()).toEqual(READS.slice(0, 2));
    journaled('not-at-head');
  });

  it('a PR answer with an unusable head, base or state is unreadable', () => {
    const ok = { state: 'OPEN', isDraft: false, headRefOid: HEAD_A, baseRefName: 'main', reviewDecision: '' };
    for (const bad of [{ ...ok, headRefOid: 'abc' }, { ...ok, baseRefName: '-x' }, { ...ok, baseRefName: 'a b' },
      { ...ok, baseRefName: 'main\n' }, { ...ok, state: 'open' }, { ...ok, isDraft: 'false' }, { ...ok, reviewDecision: 7 }]) {
      amFixture(h, { pr: bad });
      expect(refused(), JSON.stringify(bad)).toBe('REFUSED unreadable: the PR read');
    }
  });

  it('refuses protection-unreadable when classic protection answers 403 to an admin read', () => {
    for (const code of [401, 403]) {
      amFixture(h, { protection: amProt(code, { message: 'Resource not accessible by personal access token' }, 'Forbidden') });
      fs.rmSync(path.join(h.home, 'gh-calls'), { force: true });
      expect(refused()).toBe(`REFUSED protection-unreadable: branch protection answered ${code} to an admin read: the token does not carry admin now`);
      expect(calls()).toEqual(READS.slice(0, 5));
    }
    journaled('protection-unreadable');
  });

  it('classic protection: a 404 that is not "Branch not protected" is unreadable, a 200 adds its required checks and linear history', () => {
    amFixture(h, { protection: amProt(404, { message: 'Not Found' }, 'Not Found') });
    expect(refused()).toBe('REFUSED unreadable: the branch protection read');
    amFixture(h, { required: [], protection: amProt(200, { required_status_checks: { strict: true, contexts: ['lint'], checks: [{ context: 'lint', app_id: -1 }] } }, 'OK'),
      runs: { total_count: 1, check_runs: [amCheckRun('lint', 'in_progress', null)] } });
    expect(refused(), 'the classic contexts are required too').toBe('REFUSED checks-not-green: lint=pending');
    amFixture(h, { required: [], protection: amProt(200, { required_status_checks: { contexts: ['lint'] }, required_linear_history: { enabled: true } }, 'OK'),
      runs: { total_count: 1, check_runs: [amCheckRun('lint')] }, repo: { permissions: { admin: true }, allow_merge_commit: true, allow_squash_merge: false, allow_rebase_merge: false } });
    expect(refused(), 'linear history removes merge; nothing else is allowed').toBe('REFUSED method-none: no merge method is allowed on main of owner-a/repo-a');
  });

  it('refuses a standing changes-requested review, by summary or by a reviewer\'s latest review', () => {
    const pr = (reviewDecision: string) => ({ state: 'OPEN', isDraft: false, headRefOid: HEAD_A, baseRefName: 'main', reviewDecision });
    amFixture(h, { pr: pr('CHANGES_REQUESTED') });
    expect(refused()).toBe('REFUSED changes-requested: reviewDecision=CHANGES_REQUESTED');
    amFixture(h, { reviews: [{ id: 11, state: 'CHANGES_REQUESTED', user: { id: 7 } }, { id: 12, state: 'COMMENTED', user: { id: 7 } }] });
    expect(refused(), 'a later comment does not clear a request').toBe('REFUSED changes-requested: reviews=11');
    amFixture(h, { pr: pr('CHANGES_REQUESTED'), reviews: [{ id: 15, state: 'CHANGES_REQUESTED', user: null }, { id: 11, state: 'CHANGES_REQUESTED', user: { id: 7 } }] });
    expect(refused(), 'a deleted account is its own identity').toBe('REFUSED changes-requested: reviewDecision=CHANGES_REQUESTED reviews=11,15');
    journaled('changes-requested');
    amFixture(h, { reviews: [{ id: 11, state: 'CHANGES_REQUESTED', user: { id: 7 } }, { id: 13, state: 'APPROVED', user: { id: 7 } }] });
    expect(refused(), 'an approval by the same reviewer replaces the request: this rung passes').toMatch(/^REFUSED (?!changes-requested)/);
    amFixture(h, { reviews: [{ id: 11, state: 'CHANGES_REQUESTED', user: { id: 7 } }, { id: 13, state: 'DISMISSED', user: { id: 7 } }] });
    expect(refused(), 'a dismissal clears it too').toMatch(/^REFUSED (?!changes-requested)/);
  });

  it('checks-not-green names each required check that is not success: pending, skipped, neutral, missing, red', () => {
    amFixture(h, {
      required: ['build', 'lint', 'docs', 'e2e', 'unit'],
      runs: { total_count: 4, check_runs: [amCheckRun('build', 'in_progress', null), amCheckRun('lint', 'completed', 'skipped'),
        amCheckRun('docs', 'completed', 'neutral'), amCheckRun('unit', 'completed', 'failure')] },
    });
    expect(refused()).toBe('REFUSED checks-not-green: build=pending, docs=neutral, e2e=missing, lint=skipped, unit=red');
    expect(calls()).toEqual(READS);
    journaled('checks-not-green');
  });

  it('red beats pending, and cancelled, timed_out and a null conclusion are red; a run with a success and a skipped run is skipped', () => {
    amFixture(h, {
      required: ['a', 'b', 'c', 'd'],
      runs: { total_count: 6, check_runs: [amCheckRun('a', 'completed', 'cancelled'), amCheckRun('a', 'in_progress', null),
        amCheckRun('b', 'completed', 'timed_out'), amCheckRun('c', 'completed', null),
        amCheckRun('d', 'completed', 'success'), amCheckRun('d', 'completed', 'skipped')] },
    });
    expect(refused()).toBe('REFUSED checks-not-green: a=red, b=red, c=red, d=skipped');
  });

  it('an App-pinned required name is judged on that App\'s runs only, and a status never stands in for it', () => {
    const rules = [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'build', integration_id: 42 }] } }];
    // another App's run of the same name does not count
    amFixture(h, { rules, runs: { total_count: 1, check_runs: [amCheckRun('build', 'completed', 'success', 7)] } });
    expect(refused()).toBe('REFUSED checks-not-green: build=missing');
    // a status of the same context does not stand in for the pinned App's run
    amFixture(h, { rules, runs: { total_count: 0, check_runs: [] }, statuses: { state: 'success', statuses: [{ context: 'build', state: 'success' }] } });
    expect(refused()).toBe('REFUSED checks-not-green: build=missing');
    // the pinned App's own run is what counts (this rung passes)
    amFixture(h, { rules, runs: { total_count: 1, check_runs: [amCheckRun('build', 'completed', 'success', 42)] } });
    expect(refused()).toMatch(/^REFUSED (?!checks-not-green)/);
    // a pinned name wins over the same name unpinned in the classic list
    amFixture(h, { rules, protection: amProt(200, { required_status_checks: { contexts: ['build'] } }, 'OK'),
      runs: { total_count: 1, check_runs: [amCheckRun('build', 'completed', 'success', 7)] } });
    expect(refused()).toBe('REFUSED checks-not-green: build=missing');
  });

  it('a commit status satisfies an unpinned required context', () => {
    amFixture(h, { runs: { total_count: 0, check_runs: [] }, statuses: { state: 'success', statuses: [{ context: 'build', state: 'success' }] } });
    expect(refused()).toMatch(/^REFUSED (?!checks-not-green)/);
    amFixture(h, { runs: { total_count: 0, check_runs: [] }, statuses: { state: 'failure', statuses: [{ context: 'build', state: 'failure' }] } });
    expect(refused()).toBe('REFUSED checks-not-green: build=red');
    amFixture(h, { runs: { total_count: 0, check_runs: [] }, statuses: { state: 'pending', statuses: [{ context: 'build', state: 'pending' }] } });
    expect(refused()).toBe('REFUSED checks-not-green: build=pending');
  });

  it('an empty required set is green: the check runs and statuses are not read', () => {
    amFixture(h, { rules: [], required: [] });
    refused();
    expect(calls()).toEqual(READS.slice(0, 6));
  });

  it('all rungs green: every read is made once, in the order of the contract, and no merge is made', () => {
    amFixture(h);
    refused();
    expect(calls()).toEqual(READS);
    for (const c of h.ghCalls()) expect(c).not.toMatch(/--admin/);
  });

  it('refuses rebase-only and an empty method set', () => {
    amFixture(h, { repo: { permissions: { admin: true }, allow_merge_commit: false, allow_squash_merge: false, allow_rebase_merge: true } });
    expect(refused()).toBe('REFUSED rebase-only: only a rebase merge is allowed on main; the door does not rebase-merge');
    amFixture(h, { repo: { permissions: { admin: true }, allow_merge_commit: false, allow_squash_merge: false, allow_rebase_merge: false } });
    expect(refused()).toBe('REFUSED method-none: no merge method is allowed on main of owner-a/repo-a');
    // a pull_request rule that names only rebase and squash, over a repository that allows merge and squash
    amFixture(h, { rules: [{ type: 'pull_request', parameters: { allowed_merge_methods: ['rebase'] } }] });
    expect(refused(), 'the intersection of the settings and the rule is empty').toBe('REFUSED method-none: no merge method is allowed on main of owner-a/repo-a');
    amFixture(h, { rules: [{ type: 'pull_request', parameters: { allowed_merge_methods: ['Squash', 'REBASE'] } }],
      repo: { permissions: { admin: true }, allow_merge_commit: true, allow_squash_merge: false, allow_rebase_merge: true } });
    expect(refused(), 'rules are lower-cased; squash is cut by the setting, leaving only rebase').toBe('REFUSED rebase-only: only a rebase merge is allowed on main; the door does not rebase-merge');
    journaled('rebase-only');
  });

  it('merge is dropped under linear history, from a rule too, leaving squash', () => {
    amFixture(h, { rules: [{ type: 'required_linear_history' }, { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'build' }] } }] });
    refused();
    expect(calls()).toEqual(READS);   // squash is allowed: the reads all pass and the method is not a refusal
    amFixture(h, { rules: [{ type: 'required_linear_history' }, { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'build' }] } }],
      repo: { permissions: { admin: true }, allow_merge_commit: true, allow_squash_merge: false, allow_rebase_merge: false } });
    expect(refused()).toBe('REFUSED method-none: no merge method is allowed on main of owner-a/repo-a');
  });

  it('an unreadable answer at every read is unreadable naming that read, never a pass', () => {
    type K = 'repo' | 'pr' | 'rules' | 'mq' | 'protection' | 'reviews' | 'runs' | 'statuses';
    const cases: Array<[K, string, unknown[]]> = [
      ['repo', 'the repository read', [null, '', '{"a":1}{"b":2}', '[]', 'not json']],
      ['pr', 'the PR read', [null, '', '{"a":1}{"b":2}', '[]', 'not json']],
      ['rules', 'the rules read', [null, '', '{}', '[1]', '[{"type":"required_status_checks","parameters":{}}]', '[{"type":"required_status_checks","parameters":{"required_status_checks":[{"context":""}]}}]']],
      ['mq', 'the merge queue read', [null, '', '{"data":{"repository":{"mergeQueue":null}}}{"data":{"repository":{"mergeQueue":null}}}', '[]']],
      ['protection', 'the branch protection read', [null, '{}', 'HTTP/2.0 500 Server Error\n\n{}\n', amProt(200, [], 'OK'), amProt(200, 'not json', 'OK'), amProt(200, { required_status_checks: { contexts: 'build' } }, 'OK')]],
      ['reviews', 'the reviews read', [null, '', '{}', '[{"id":1,"state":"WAT","user":{"id":2}}]', '[{"id":1,"state":"APPROVED"}]']],
      ['runs', 'the check runs read', [null, '', '[]', '{"check_runs":{}}', '{"check_runs":[1]}']],
      ['statuses', 'the commit statuses read', [null, '', '[]', '{"statuses":{}}', '{"statuses":[1]}']],
    ];
    for (const [key, what, answers] of cases) {
      for (const a of answers) {
        amFixture(h, { [key]: a } as never);
        const out = refused();
        // `[{"id":1,"state":"APPROVED"}]` has no user: a deleted account, which is VALID; it is not part of this table
        if (key === 'reviews' && a === '[{"id":1,"state":"APPROVED"}]') continue;
        expect(out, `${key}: ${JSON.stringify(a)}`).toBe(`REFUSED unreadable: ${what}`);
      }
    }
    journaled('unreadable');
  });

  it('prints nothing GitHub wrote: no login, review body or check text reaches a line', () => {
    amFixture(h, { reviews: [{ id: 11, state: 'CHANGES_REQUESTED', user: { id: 7, login: 'secret-login' }, body: 'secret-body' }],
      required: ['build'], runs: { total_count: 1, check_runs: [{ ...amCheckRun('build', 'completed', 'failure'), output: { title: 'secret-title' } }] } });
    refused();
    expect(fs.readFileSync(reg('swap.log'), 'utf8')).not.toMatch(/secret-/);
  });
});
