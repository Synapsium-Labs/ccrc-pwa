// `ccd pr-admin-merge` (D-8124): the one gated door for an admin merge. FIXTURE HOME ONLY (`makePrHarness`); the verb
// runs as a sourced function with `gh`, `tmux` and `timeout` shell functions (`ccdAdminMergeFixture.ts`).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CCD, ccdSource } from './ccdWsHelpers.js';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { AM_GH_STUB, AM_PROT_NONE, HEAD_A, HEAD_B, MERGE_OID, amCaller, amCheckRun, amFixture, amProt, amRoute, amRun, boxEnv, swapLog } from './ccdAdminMergeFixture.js';

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

  describe('the caller is derived from the process, not from the environment the command sets', () => {
    const tmuxCalls = (): string[] => {
      const f = path.join(h.home, 'am', 'tmux-calls');
      return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : [];
    };

    it('asks the fleet\'s default socket by path and ignores TMUX and TMUX_TMPDIR', () => {
      amFixture(h); amCaller(h, 'demo-quiet-basin');
      const r = h.run(`${AM_GH_STUB} export TMUX_PANE=%1 TMUX=/tmp/fake-sock,1,0 TMUX_TMPDIR=/tmp/fake-dir; cmd_pr_admin_merge ${GOOD}`);
      expect(r.stdout).toMatch(/^MERGED /);
      const ask = `-S /tmp/tmux-${process.getuid?.()}/default display-message -p -t %1 #{pane_pid} #S`;
      expect(tmuxCalls(), 'asked once to label the journal and once to judge the caller, the same way').toEqual([ask, ask]);
    });

    it('refuses a pane this command is not running in: another pane\'s id on the command line names its coordinator, not the caller', () => {
      amFixture(h); amCaller(h, 'demo-quiet-basin');
      const other = spawnSync('bash', ['-c', 'sleep 60 & echo $!'], { encoding: 'utf8' }).stdout.trim();   // a process that is not an ancestor
      try {
        fs.writeFileSync(path.join(h.home, 'am', 'tmux-pid'), other);
        const r = amRun(h, GOOD);
        expect([r.code, r.stdout.trim()]).toEqual([2, 'REFUSED caller-unknown: the named pane is not the one this command is running in']);
        expect(h.ghCalls()).toEqual([]);
        expect(swapLog(h).at(-1)).toMatch(/ admin-merge-refused \?: owner-a\/repo-a#42 head=[0-9a-f]{40} reason=caller-unknown$/);
      } finally { try { process.kill(Number(other)); } catch { /* already gone */ } }
    });

    it('accepts a pane whose process is an ancestor further up, not only this shell', () => {
      amFixture(h); amCaller(h, 'demo-quiet-basin');
      fs.writeFileSync(path.join(h.home, 'am', 'tmux-pid'), String(process.pid));
      expect(amRun(h, GOOD).stdout).toMatch(/^MERGED /);
    });

    it('refuses a pane id that is not a pane id, and a pid that is not a pid', () => {
      amFixture(h); amCaller(h, 'demo-quiet-basin');
      for (const pane of ['%1;x', '1', '%', '%a', '$(true)']) {
        const r = amRun(h, GOOD, { pane });
        expect([r.code, r.stdout.trim()], pane).toEqual([2, 'REFUSED caller-unknown: the tmux pane id is not a pane id']);
      }
      fs.writeFileSync(path.join(h.home, 'am', 'tmux-pid'), 'abc');
      expect(amRun(h, GOOD).stdout.trim()).toBe('REFUSED caller-unknown: tmux names no ccrc session for this pane');
      expect(h.ghCalls()).toEqual([]);
    });

    it('reads the registry, the journal and the setting from the account\'s home, not from $HOME', () => {
      amFixture(h); amCaller(h, 'demo-quiet-basin'); boxEnv(h, 'CCRC_ADMIN_MERGE=off\n');
      // a HOME of the caller's making whose ccrc.env says auto, and a registry that names a coordinator
      const fake = path.join(h.home, 'fake-home');
      fs.mkdirSync(path.join(fake, '.ccrc'), { recursive: true });
      fs.writeFileSync(path.join(fake, '.ccrc', 'ccrc.env'), 'CCRC_ADMIN_MERGE=auto\n');
      const r = h.run(`${AM_GH_STUB} export AM_STUB_HOME="$HOME" TMUX_PANE=%1; HOME='${fake}'; cmd_pr_admin_merge ${GOOD}`);
      expect([r.code, r.stdout.trim()]).toEqual([2, 'REFUSED setting-off: CCRC_ADMIN_MERGE is off']);
      expect(swapLog(h).at(-1)).toMatch(/ admin-merge-refused demo-quiet-basin: .* reason=setting-off$/);
      expect(fs.existsSync(path.join(fake, '.cc-sessions'))).toBe(false);
    });

    it('refuses setting-unread when the account\'s home cannot be read', () => {
      amFixture(h); amCaller(h, 'demo-quiet-basin');
      const r = h.run(`${AM_GH_STUB} getent() { return 2; }; id() { [[ "$1" == -u ]] && echo 4242 || command id "$@"; }; dscl() { return 1; }; export TMUX_PANE=%1; cmd_pr_admin_merge ${GOOD}`);
      expect([r.code, r.stdout.trim()]).toEqual([2, "REFUSED setting-unread: the account's home cannot be read (read as off)"]);
      expect(h.ghCalls()).toEqual([]);
    });
  });

  it('journals an unnamed caller as ?', () => {
    amFixture(h);
    amRun(h, GOOD, { pane: null });
    expect(swapLog(h).at(-1)).toMatch(/ admin-merge-refused \?: owner-a\/repo-a#42 head=[0-9a-f]{40} reason=caller-unknown$/);
  });

  it('is dispatched and named in the usage line, and the gate\'s gh calls never carry --admin', () => {
    amFixture(h); amCaller(h, 'demo-quiet-basin');
    amRun(h, GOOD);
    for (const c of h.ghCalls().filter((x) => !x.startsWith('pr merge'))) expect(c).not.toMatch(/--admin/);
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
  /** The door's answer for a run that is not asserted to refuse: the rung under test passed when it is MERGED or refused for another reason. */
  const notRefusedAs = (reason: string, argv: string = ARGV): void => {
    const out = amRun(h, argv).stdout.trim();
    expect(out).toMatch(new RegExp(`^(MERGED |REFUSED (?!${reason}:))`));
    fs.rmSync(path.join(h.home, 'gh-calls'), { force: true });   // a passing run merged: later \`refused()\` calls start clean
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
    notRefusedAs('changes-requested');   // an approval by the same reviewer replaces the request: this rung passes
    amFixture(h, { reviews: [{ id: 11, state: 'CHANGES_REQUESTED', user: { id: 7 } }, { id: 13, state: 'DISMISSED', user: { id: 7 } }] });
    notRefusedAs('changes-requested');   // a dismissal clears it too
  });

  it('checks-not-green names each required check that is not passing: pending, missing, red', () => {
    amFixture(h, {
      required: ['build', 'lint', 'docs', 'e2e', 'unit'],
      runs: { total_count: 4, check_runs: [amCheckRun('build', 'in_progress', null), amCheckRun('lint', 'completed', 'skipped'),
        amCheckRun('docs', 'completed', 'neutral'), amCheckRun('unit', 'completed', 'failure')] },
    });
    expect(refused(), 'skipped and neutral are GitHub\'s own passing set, so they are not named').toBe('REFUSED checks-not-green: build=pending, e2e=missing, unit=red');
    expect(calls()).toEqual(READS);
    journaled('checks-not-green');
  });

  it('a required check a path filter skipped (or that ended neutral) passes, as GitHub and the landing verdict count it, and the journal keeps the word', () => {
    amFixture(h, {
      required: ['build', 'lint', 'docs'],
      runs: { total_count: 3, check_runs: [amCheckRun('build'), amCheckRun('lint', 'completed', 'skipped'), amCheckRun('docs', 'completed', 'neutral')] },
    });
    const r = amRun(h, ARGV);
    expect(r.code, r.stdout).toBe(0);
    expect(r.stdout.trim()).toBe(`MERGED owner-a/repo-a#42 head=${HEAD_A} method=merge merge=${MERGE_OID} checks=build:success,docs:neutral,lint:skipped`);
    expect(swapLog(h).at(-1)).toMatch(/ checks=build:success,docs:neutral,lint:skipped result=merged /);
  });

  it('red beats pending, and cancelled, timed_out and a null conclusion are red; a run with a success and a skipped run passes', () => {
    amFixture(h, {
      required: ['a', 'b', 'c', 'd'],
      runs: { total_count: 6, check_runs: [amCheckRun('a', 'completed', 'cancelled'), amCheckRun('a', 'in_progress', null),
        amCheckRun('b', 'completed', 'timed_out'), amCheckRun('c', 'completed', null),
        amCheckRun('d', 'completed', 'success'), amCheckRun('d', 'completed', 'skipped')] },
    });
    expect(refused()).toBe('REFUSED checks-not-green: a=red, b=red, c=red');
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
    notRefusedAs('checks-not-green');
    // a pinned name wins over the same name unpinned in the classic list
    amFixture(h, { rules, protection: amProt(200, { required_status_checks: { contexts: ['build'] } }, 'OK'),
      runs: { total_count: 1, check_runs: [amCheckRun('build', 'completed', 'success', 7)] } });
    expect(refused()).toBe('REFUSED checks-not-green: build=missing');
  });

  it('a commit status satisfies an unpinned required context', () => {
    amFixture(h, { runs: { total_count: 0, check_runs: [] }, statuses: { state: 'success', statuses: [{ context: 'build', state: 'success' }] } });
    notRefusedAs('checks-not-green');
    amFixture(h, { runs: { total_count: 0, check_runs: [] }, statuses: { state: 'failure', statuses: [{ context: 'build', state: 'failure' }] } });
    expect(refused()).toBe('REFUSED checks-not-green: build=red');
    amFixture(h, { runs: { total_count: 0, check_runs: [] }, statuses: { state: 'pending', statuses: [{ context: 'build', state: 'pending' }] } });
    expect(refused()).toBe('REFUSED checks-not-green: build=pending');
  });

  it('an empty required set is green: the check runs and statuses are not read', () => {
    amFixture(h, { rules: [], required: [] });
    amRun(h, ARGV);
    expect(calls().slice(0, 6)).toEqual(READS.slice(0, 6));
    expect(calls().some((c) => c.includes('/check-runs') || c.includes('/status'))).toBe(false);
  });

  it('all rungs green: every read is made once, in the order of the contract, before the one merge', () => {
    amFixture(h);
    amRun(h, ARGV);
    expect(calls().slice(0, READS.length)).toEqual(READS);
    expect(calls().slice(READS.length).map((c) => c.split(' ').slice(0, 2).join(' '))).toEqual(['pr view', 'pr merge', 'pr view']);
    for (const c of h.ghCalls().filter((x) => !x.startsWith('pr merge'))) expect(c).not.toMatch(/--admin/);
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

  it('refuses squash-not-only when squash and rebase are allowed but no merge commit: the door does not pick a squash', () => {
    amFixture(h, { repo: { permissions: { admin: true }, allow_merge_commit: false, allow_squash_merge: true, allow_rebase_merge: true } });
    expect(refused()).toBe('REFUSED squash-not-only: main allows a squash and a rebase but no merge commit; the door does not choose between them');
    expect(h.ghCalls().some((c) => c.includes('--squash'))).toBe(false);
    journaled('squash-not-only');
  });

  it('refuses unenforced-rules: a rule type the door has no read for, which --admin would get past', () => {
    const rsc = { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'build' }] } };
    for (const [rules, named] of [
      [[rsc, { type: 'code_scanning', parameters: {} }], 'code_scanning'],
      [[rsc, { type: 'required_deployments', parameters: {} }, { type: 'workflows', parameters: {} }], 'required_deployments,workflows'],
      [[rsc, { type: 'required_signatures' }], 'required_signatures'],
      [[rsc, { type: 'pull_request', parameters: { required_review_thread_resolution: true } }], 'conversation_resolution'],
    ] as Array<[unknown[], string]>) {
      amFixture(h, { rules });
      fs.rmSync(path.join(h.home, 'gh-calls'), { force: true });
      expect(refused(), named).toBe(`REFUSED unenforced-rules: main carries ${named}, which GitHub enforces at merge but not against --admin`);
      expect(calls(), 'refused right after the protection read').toEqual(READS.slice(0, 5));
    }
    journaled('unenforced-rules');
    // classic protection: signed commits and conversation resolution
    for (const [prot, named] of [
      [{ required_signatures: { enabled: true }, required_status_checks: { contexts: ['build'] } }, 'required_signatures'],
      [{ required_conversation_resolution: { enabled: true }, required_status_checks: { contexts: ['build'] } }, 'conversation_resolution'],
    ] as Array<[unknown, string]>) {
      amFixture(h, { rules: [], protection: amProt(200, prot, 'OK') });
      expect(refused(), named).toBe(`REFUSED unenforced-rules: main carries ${named}, which GitHub enforces at merge but not against --admin`);
    }
    // the same keys switched off, and a pull_request rule that does not ask for resolution, are not a refusal
    amFixture(h, { rules: [{ type: 'pull_request', parameters: { required_review_thread_resolution: false } }],
      protection: amProt(200, { required_signatures: { enabled: false }, required_conversation_resolution: { enabled: false }, required_status_checks: { contexts: ['build'] } }, 'OK') });
    notRefusedAs('unenforced-rules');
  });

  it('under strict up-to-date the head must not be behind the base: a ruleset or classic protection asks the compare read', () => {
    const COMPARE = `api repos/owner-a/repo-a/compare/main...${HEAD_A}?per_page=1`;
    const strictRules = [{ type: 'required_status_checks', parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: 'build' }] } }];
    amFixture(h, { rules: strictRules, compare: { status: 'diverged', ahead_by: 1, behind_by: 3 } });
    expect(refused()).toBe('REFUSED behind-base: main requires branches up to date and the head is 3 commits behind it');
    expect(calls()).toEqual([...READS.slice(0, 5), COMPARE]);
    journaled('behind-base');
    amFixture(h, { rules: [], protection: amProt(200, { required_status_checks: { strict: true, contexts: ['build'] } }, 'OK'),
      compare: { status: 'behind', ahead_by: 0, behind_by: 1 } });
    expect(refused(), 'classic strict').toBe('REFUSED behind-base: main requires branches up to date and the head is 1 commits behind it');
    // up to date: the read passes and the door goes on to the rest
    amFixture(h, { rules: strictRules });
    fs.rmSync(path.join(h.home, 'gh-calls'), { force: true });
    const r = amRun(h, ARGV);
    expect(r.code, r.stdout).toBe(0);
    expect(calls().slice(0, READS.length + 1)).toEqual([...READS.slice(0, 5), COMPARE, ...READS.slice(5)]);
    // not strict: no compare read at all
    amFixture(h);
    fs.rmSync(path.join(h.home, 'gh-calls'), { force: true });
    fs.rmSync(path.join(h.home, 'gh-calls'), { force: true });
    amRun(h, ARGV);
    expect(calls().some((c) => c.includes('/compare/'))).toBe(false);
    // an unreadable compare answer under strict is unreadable, never a pass
    for (const bad of [null, '', 'not json', '{"behind_by":"0"}', '{"behind_by":-1}', '[]']) {
      amFixture(h, { rules: strictRules, compare: bad });
      fs.rmSync(path.join(h.home, 'gh-calls'), { force: true });
      expect(refused(), String(bad)).toBe('REFUSED unreadable: the compare read');
    }
  });

  it('merge is dropped under linear history, from a rule too, leaving squash', () => {
    amFixture(h, { rules: [{ type: 'required_linear_history' }, { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'build' }] } }] });
    amRun(h, ARGV);
    expect(calls().slice(0, READS.length)).toEqual(READS);   // squash is allowed: the reads all pass and the method is not a refusal
    amFixture(h, { rules: [{ type: 'required_linear_history' }, { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'build' }] } }],
      repo: { permissions: { admin: true }, allow_merge_commit: true, allow_squash_merge: false, allow_rebase_merge: false } });
    fs.rmSync(path.join(h.home, 'gh-calls'), { force: true });
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
        // `[{"id":1,"state":"APPROVED"}]` has no user: a deleted account, which is VALID; it is not part of this table
        if (key === 'reviews' && a === '[{"id":1,"state":"APPROVED"}]') continue;
        amFixture(h, { [key]: a } as never);
        const out = refused();
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

describe('the merge', () => {
  const ARGV = GOOD;
  const merges = (): string[] => h.ghCalls().filter((c) => c.startsWith('pr merge'));
  const lastJournal = (): string => swapLog(h).at(-1) ?? '';
  beforeEach(() => { amCaller(h, 'demo-quiet-basin'); });

  it('merges with --merge when a merge commit is allowed, pinned to the head, and answers MERGED', () => {
    amFixture(h);
    const r = amRun(h, ARGV);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe(`MERGED owner-a/repo-a#42 head=${HEAD_A} method=merge merge=${MERGE_OID} checks=build:success`);
    expect(r.stdout.trim().split('\n'), 'exactly one line on stdout').toHaveLength(1);
    expect(merges()).toEqual([`pr merge 42 -R owner-a/repo-a --admin --merge --match-head-commit ${HEAD_A}`]);
    expect(lastJournal()).toMatch(new RegExp(`admin-merge demo-quiet-basin: owner-a/repo-a#42 head=${HEAD_A} method=merge checks=build:success result=merged merge=${MERGE_OID}$`));
  });

  it('answers checks=none-required and journals it when the repository requires no checks', () => {
    amFixture(h, { rules: [], required: [] });
    const r = amRun(h, ARGV);
    expect(r.stdout.trim()).toBe(`MERGED owner-a/repo-a#42 head=${HEAD_A} method=merge merge=${MERGE_OID} checks=none-required`);
    expect(lastJournal()).toMatch(/ checks=none-required result=merged /);
  });

  it('merges with --squash only when squash is the whole method set', () => {
    amFixture(h, { repo: { permissions: { admin: true }, allow_merge_commit: false, allow_squash_merge: true, allow_rebase_merge: false } });
    const r = amRun(h, ARGV);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toMatch(/ method=squash /);
    expect(merges()).toEqual([`pr merge 42 -R owner-a/repo-a --admin --squash --match-head-commit ${HEAD_A}`]);
    expect(lastJournal()).toMatch(/ method=squash /);
  });

  it('drops merge under linear history (a rule or classic protection)', () => {
    const rules = [{ type: 'required_linear_history' }, { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'build' }] } }];
    amFixture(h, { rules });
    expect(amRun(h, ARGV).code).toBe(0);
    expect(merges()).toEqual([`pr merge 42 -R owner-a/repo-a --admin --squash --match-head-commit ${HEAD_A}`]);
    fs.rmSync(path.join(h.home, 'gh-calls'));
    amFixture(h, { protection: amProt(200, { required_linear_history: { enabled: true }, required_status_checks: { contexts: ['build'] } }, 'OK'), rules: [] });
    expect(amRun(h, ARGV).code).toBe(0);
    expect(merges()).toEqual([`pr merge 42 -R owner-a/repo-a --admin --squash --match-head-commit ${HEAD_A}`]);
  });

  it('refuses when the head moved between the checks and the merge', () => {
    amFixture(h, { fresh: { state: 'OPEN', isDraft: false, headRefOid: HEAD_B, baseRefName: 'main', reviewDecision: '' } });
    const r = amRun(h, ARGV);
    expect([r.code, r.stdout.trim()]).toEqual([2, `REFUSED head-moved: the PR head moved to ${HEAD_B} since the checks`]);
    expect(merges()).toEqual([]);
    expect(lastJournal()).toMatch(new RegExp(` admin-merge-refused demo-quiet-basin: owner-a/repo-a#42 head=${HEAD_A} reason=head-moved$`));
  });

  it('refuses base-moved when the PR was retargeted between the reads, however the head pin would pass', () => {
    // `dev` (admin, no queue, nothing required) when the reads judge it; `main` (which carries a queue) at the fresh read.
    // The head is the same, so `--match-head-commit` alone would pass and `--admin` would land it past the queue.
    amFixture(h, { pr: { number: 42, state: 'OPEN', isDraft: false, headRefOid: HEAD_A, baseRefName: 'dev', reviewDecision: '' },
                   fresh: { state: 'OPEN', isDraft: false, headRefOid: HEAD_A, baseRefName: 'main', reviewDecision: '' } });
    amRoute(h, 'api --paginate repos/owner-a/repo-a/rules/branches/dev', 'rules-dev.json', []);
    amRoute(h, 'api -i repos/owner-a/repo-a/branches/dev/protection', 'protection-dev.txt', AM_PROT_NONE);
    const r = amRun(h, ARGV);
    expect([r.code, r.stdout.trim()]).toEqual([2, 'REFUSED base-moved: the PR base moved from dev to main since the checks']);
    expect(merges()).toEqual([]);
    expect(lastJournal()).toMatch(new RegExp(` admin-merge-refused demo-quiet-basin: owner-a/repo-a#42 head=${HEAD_A} reason=base-moved$`));
    // control: the same retarget-free PR on `dev` merges, so the refusal above is the base check and nothing else
    amFixture(h, { pr: { number: 42, state: 'OPEN', isDraft: false, headRefOid: HEAD_A, baseRefName: 'dev', reviewDecision: '' } });
    amRoute(h, 'api --paginate repos/owner-a/repo-a/rules/branches/dev', 'rules-dev.json', []);
    amRoute(h, 'api -i repos/owner-a/repo-a/branches/dev/protection', 'protection-dev.txt', AM_PROT_NONE);
    expect(amRun(h, ARGV).stdout.trim()).toMatch(/^MERGED /);
  });

  it('the fresh read refuses an unreadable or option-shaped base', () => {
    for (const baseRefName of [undefined, '-x', 7, 'a b']) {
      amFixture(h, { fresh: { state: 'OPEN', isDraft: false, headRefOid: HEAD_A, baseRefName, reviewDecision: '' } });
      const r = amRun(h, ARGV);
      expect([r.code, r.stdout.trim()]).toEqual([2, 'REFUSED unreadable: the PR read']);
    }
    expect(merges()).toEqual([]);
  });

  it('the fresh read refuses a draft, a closed PR and a changes-requested decision that appeared after the reads', () => {
    for (const [fresh, line] of [
      [{ state: 'OPEN', isDraft: true, headRefOid: HEAD_A, baseRefName: 'main', reviewDecision: '' }, 'REFUSED draft: the PR is a draft'],
      [{ state: 'CLOSED', isDraft: false, headRefOid: HEAD_A, baseRefName: 'main', reviewDecision: '' }, 'REFUSED not-open: the PR is CLOSED'],
      [{ state: 'OPEN', isDraft: false, headRefOid: HEAD_A, baseRefName: 'main', reviewDecision: 'CHANGES_REQUESTED' }, 'REFUSED changes-requested: reviewDecision=CHANGES_REQUESTED'],
      [{ state: 'OPEN', isDraft: false, headRefOid: 'nope', baseRefName: 'main', reviewDecision: '' }, 'REFUSED unreadable: the PR read'],
    ] as const) {
      amFixture(h, { fresh });
      const r = amRun(h, ARGV);
      expect([r.code, r.stdout.trim()]).toEqual([2, line]);
    }
    expect(merges()).toEqual([]);
  });

  it('a refused merge is github-refused, journaled, never retried', () => {
    amFixture(h, { mergeFail: 'GraphQL: Head branch was modified. Review and try the merge again. (mergePullRequest)\nsecond line\n' });
    const r = amRun(h, ARGV);
    expect([r.code, r.stdout.trim()]).toEqual([2, 'REFUSED github-refused: GraphQL: Head branch was modified. Review and try the merge again. (mergePullRequest)']);
    expect(merges(), 'exactly one pr merge call, with no other method tried').toHaveLength(1);
    expect(lastJournal()).toMatch(new RegExp(` admin-merge-refused demo-quiet-basin: owner-a/repo-a#42 head=${HEAD_A} reason=github-refused$`));
    expect(h.ghCalls().at(-1)).toMatch(/^pr merge /);
  });

  it('a refusal\'s text is cut to its first line, control characters dropped, at most 200 bytes', () => {
    amFixture(h, { mergeFail: `bad\u0007\u001b[31m ${'x'.repeat(400)}\nmore\n` });
    const out = amRun(h, ARGV).stdout.trim();
    expect(out).toMatch(/^REFUSED github-refused: bad\[31m x+$/);
    expect(out.length - 'REFUSED github-refused: '.length).toBeLessThanOrEqual(200);
    expect(out).not.toMatch(/[\u0000-\u001f]/);
  });

  it('passes --match-head-commit <sha> to gh, and reads GitHub\'s refusal as github-refused', () => {
    amFixture(h, { mergeFail: 'Head branch is out of date' });
    const r = amRun(h, ARGV);
    expect(merges()).toEqual([`pr merge 42 -R owner-a/repo-a --admin --merge --match-head-commit ${HEAD_A}`]);
    expect(r.stdout.trim()).toBe('REFUSED github-refused: Head branch is out of date');
  });

  it('a gh merge that exits non-zero with no stderr is still github-refused', () => {
    amFixture(h, { mergeFail: '' });
    expect(amRun(h, ARGV).stdout.trim()).toBe('REFUSED github-refused: gh pr merge failed (rc 1)');
    expect(merges()).toHaveLength(1);
  });

  it('a merge gh answered whose read-back is not MERGED at the head is unproven, not merged, and not retried', () => {
    const detail = /^REFUSED unproven: gh answered the merge but the read-back does not show MERGED at a{40} \(method=merge\); not retried$/;
    for (const readback of [
      { state: 'OPEN', headRefOid: HEAD_A, mergeCommit: null },
      { state: 'MERGED', headRefOid: HEAD_B, mergeCommit: { oid: MERGE_OID } },
      { state: 'MERGED', headRefOid: HEAD_A, mergeCommit: null },
      { state: 'MERGED', headRefOid: HEAD_A, mergeCommit: { oid: 'not-an-oid' } },
      '', '[]', null,
    ]) {
      fs.rmSync(path.join(h.home, 'gh-calls'), { force: true });
      amFixture(h, { readback });
      const r = amRun(h, ARGV);
      expect(r.code, JSON.stringify(readback)).toBe(2);
      expect(r.stdout.trim(), JSON.stringify(readback)).toMatch(detail);
      expect(merges(), 'never a second merge call').toHaveLength(1);
      expect(lastJournal()).toMatch(new RegExp(` admin-merge-refused demo-quiet-basin: owner-a/repo-a#42 head=${HEAD_A} reason=unproven$`));
    }
  });

  it('the door\'s argv never carries --admin, and the only --admin it sends is on its one gh pr merge', () => {
    amFixture(h);
    amRun(h, ARGV);
    for (const c of h.ghCalls().filter((x) => !x.startsWith('pr merge'))) expect(c).not.toMatch(/--admin/);
    expect(merges().every((c) => c.split(' ').filter((w) => w === '--admin').length === 1)).toBe(true);
    const src = ccdSource();
    const body = src.slice(src.indexOf('_am_act() {'), src.indexOf('# ── reap guards'));
    const code = body.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(code.match(/--admin/g) ?? [], 'the verb\'s code spells --admin exactly once').toHaveLength(1);
    const head = src.slice(src.indexOf('cmd_pr_admin_merge() {'), src.indexOf('_am_act() {')).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(head.match(/--admin/g) ?? []).toHaveLength(0);
  });
});
